import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { evidenceHashOf } from "../src/feed/selection-classifier-lab.js";
import { candidateCanaryBudget, candidateCanaryPass, stepRunModel } from "../tools/run-selection-d1c.mjs";
import { CANDIDATE_REGISTRY, CANDIDATE_REGISTRY_DOCUMENT, getCandidateExecutionHold, getRunnableCandidate, parseCandidateRegistry } from "../tools/selection-candidate-registry.mjs";
import { D1I_HOLDOUT_LOCK, deriveD1iGoldProjection, deriveD1iHoldout, evaluateD1iCategoryHoldout, validateD1iHoldoutLock } from "../tools/selection-d1i-holdout.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFix = (name) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", name), "utf8"));
const CORPUS = readFix("selection-d1-corpus.json");
const GOLD = readFix("selection-d1-gold.json");
const VERSIONS = { modelVersion: "d1i-test-model", promptVersion: "d1i-test-prompt", taxonomyVersion: "d1i-test-taxonomy" };
const P31_RECORD_SHA = "6b8545cad319ec5eadc4e3cb96c342a838a6bdaa4c42ff9251bebd92cf1ed887";
const P32_RECORD_SHA = "66b9ef1792d9eb1c7b9e65037e967636bb47c30088bcf7b85cd7498c84c45421";

function perfectPredictions() {
  const goldById = new Map(GOLD.labels.map((row) => [row.itemId, row]));
  return deriveD1iHoldout(CORPUS).items.map((item) => {
    const gold = goldById.get(item.itemId);
    const accepts = new Set(gold.goldAcceptedCategories || []);
    const span = String(item.title || item.excerpt || "x").slice(0, 8);
    const admissionCategories = CATEGORIES.map(({ id }) => accepts.has(id)
      ? { category: id, decision: "accept", confidence: 0.95, evidenceSpans: [span], reasonCodes: ["core-topic"] }
      : { category: id, decision: "reject", confidence: 0.05, evidenceSpans: [], reasonCodes: [] });
    return {
      itemId: item.itemId,
      status: "classified",
      classification: {
        contentType: gold.goldContentType,
        primaryCategory: [...accepts][0] || "unknown",
        descriptiveSecondaryCategories: [],
        admissionCategories,
        modelVersion: VERSIONS.modelVersion,
        promptVersion: VERSIONS.promptVersion,
        taxonomyVersion: VERSIONS.taxonomyVersion,
        evidenceHash: evidenceHashOf(item),
        sourceCountry: item.sourceCountry,
        language: item.language,
        eventJurisdictions: [],
        relevanceCountries: [],
        scopeClass: "unknown",
        geoConfidence: 0,
        geoEvidenceSpans: [],
        operatorGroup: "d1i-test",
        originDocumentId: `d1i:${item.itemId}`,
        claimOriginGroup: "unresolved"
      }
    };
  });
}

function removeOneExpectedAdmission(prediction, goldById) {
  const gold = goldById.get(prediction.itemId);
  if (!gold || gold.goldAcceptedCategories.length !== 1) return false;
  const category = gold.goldAcceptedCategories[0];
  const row = prediction.classification.admissionCategories.find((entry) => entry.category === category);
  row.decision = "reject";
  row.confidence = 0.05;
  row.evidenceSpans = [];
  row.reasonCodes = [];
  prediction.classification.primaryCategory = "unknown";
  return true;
}

test("D1I: p4 후보 정의 지문은 보존하고 소비된 1회 승인은 재사용할 수 없다", () => {
  const p4 = CANDIDATE_REGISTRY["p4-category-haiku"];
  assert.equal(CANDIDATE_REGISTRY["p3.1-haiku"].candidateRecordSha256, P31_RECORD_SHA);
  assert.equal(CANDIDATE_REGISTRY["p3.2-haiku"].candidateRecordSha256, P32_RECORD_SHA);
  assert.equal(p4.task, "category_admission_only");
  assert.equal(p4.execution.state, "approved_canary");
  assert.equal(p4.execution.runnable, true);
  assert.equal(p4.execution.maxCalls, 12);
  assert.equal(p4.execution.maxCostUsd, 0.08);
  assert.equal(p4.candidateRecordSha256, "55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6");
  assert.equal(p4.promptSha256, "310438e0cf568c8e4e62ad5df1e4386694f4965357f5a222ce808493410bf700");
  assert.match(p4.system, /Geography is deliberately outside this candidate/);
  assert.match(p4.system, /government decision that is itself the event/);
  assert.match(p4.system, /merely commenting.*secondary context/);
  assert.doesNotMatch(p4.system, /GEO GROUNDING PROTOCOL/);
  assert.deepEqual(getCandidateExecutionHold(p4.candidateId), {
    state: "consumed_hold",
    attemptId: "d1i-20260821-01",
    receiptSha256: "387aad945226ed4a139f71547d297554027cce735d12a20011db71bd059b5d05",
    reason: "single_canary_approval_consumed"
  });
  assert.throws(() => getRunnableCandidate(p4.candidateId), /CANDIDATE_APPROVAL_CONSUMED/);
  const invalid = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  invalid.candidates.find((candidate) => candidate.candidateId === p4.candidateId).task = "unknown_task";
  assert.throws(() => parseCandidateRegistry(invalid), /invalid task/);
  const missingCap = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  delete missingCap.candidates.find((candidate) => candidate.candidateId === p4.candidateId).execution.maxCostUsd;
  assert.throws(() => parseCandidateRegistry(missingCap), /needs cost cap/);
  const invalidHold = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  invalidHold.executionHolds["p4-category-haiku"].receiptSha256 = "not-a-sha";
  assert.throws(() => parseCandidateRegistry(invalidHold), /invalid execution hold/);
});

test("D1I: 소비된 p4 승인은 새 attempt ID와 직접 실행 경로 모두 쓰기 전에 차단된다", async () => {
  const p4 = CANDIDATE_REGISTRY["p4-category-haiku"];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d1i-consumed-"));
  const attemptDir = path.join(tmp, "attempt");
  let keyReads = 0;
  try {
    const result = await stepRunModel({
      dir: attemptDir,
      ledgerPath: path.join(tmp, "usage-ledger.jsonl"),
      lockPath: path.join(tmp, ".run-lock"),
      attemptId: "d1i-new-attempt",
      candidateDef: p4,
      getApiKey: () => { keyReads += 1; return "must-not-read"; }
    });
    assert.equal(result.status, "CANDIDATE_APPROVAL_CONSUMED_HOLD");
    assert.equal(keyReads, 0);
    assert.equal(fs.existsSync(attemptDir), false);
    assert.equal(fs.existsSync(path.join(tmp, "usage-ledger.jsonl")), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("D1I: category-only 후보는 category gate만 사용하고 combined 후보는 AND gate를 유지한다", () => {
  const categoryOnly = CANDIDATE_REGISTRY["p4-category-haiku"];
  const combined = CANDIDATE_REGISTRY["p3.2-haiku"];
  const categoryPassScopeHold = { categoryCandidatePass: true, pass: false };
  assert.equal(candidateCanaryPass(categoryOnly, categoryPassScopeHold), true);
  assert.equal(candidateCanaryPass(combined, categoryPassScopeHold), false);
  assert.equal(candidateCanaryPass(categoryOnly, { categoryCandidatePass: false, pass: true }), false);
  assert.deepEqual(
    { maxCalls: candidateCanaryBudget(categoryOnly).maxCalls, maxCostUsd: candidateCanaryBudget(categoryOnly).maxCostUsd },
    { maxCalls: 12, maxCostUsd: 0.08 }
  );
});

test("D1I: holdout 84건은 canary·감사용과 겹치지 않는 기계적 고정 집합이다", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d1i-holdout-"));
  try {
    const derived = deriveD1iHoldout(CORPUS);
    assert.equal(derived.items.length, 84);
    assert.equal(derived.orderedItemIdsSha256, D1I_HOLDOUT_LOCK.derivation.orderedItemIdsSha256);
    assert.equal(derived.orderedEvidenceRowsSha256, D1I_HOLDOUT_LOCK.derivation.orderedEvidenceRowsSha256);
    assert.equal(deriveD1iGoldProjection(derived, GOLD).orderedGoldProjectionSha256, D1I_HOLDOUT_LOCK.derivation.orderedGoldProjectionSha256);
    assert.deepEqual(validateD1iHoldoutLock({ attemptsDir: tmp }).errors, []);
    assert.deepEqual(D1I_HOLDOUT_LOCK.coverage.uncoveredCategories, ["humor", "news"]);
    assert.equal(D1I_HOLDOUT_LOCK.coverage.allCategoriesCovered, false);
    const tampered = structuredClone(D1I_HOLDOUT_LOCK);
    tampered.derivation.orderedItemIdsSha256 = "0".repeat(64);
    assert.ok(validateD1iHoldoutLock({ lock: tampered, attemptsDir: tmp }).errors.includes("partition_sha"));
    const attempt = path.join(tmp, "exposed");
    fs.mkdirSync(attempt);
    fs.writeFileSync(path.join(attempt, "attempt-manifest.json"), JSON.stringify({ candidateId: "p4-category-haiku" }));
    fs.writeFileSync(path.join(attempt, "full-predictions.json"), "{}\n");
    assert.ok(validateD1iHoldoutLock({ attemptsDir: tmp }).errors.includes("holdout_exposed"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("D1I: 84건 category gate는 1건 miss를 허용하되 unexpected admission은 0건만 허용한다", () => {
  const goldById = new Map(GOLD.labels.map((row) => [row.itemId, row]));
  const perfect = perfectPredictions();
  const p = evaluateD1iCategoryHoldout({ corpus: CORPUS, gold: GOLD, predictions: perfect, versions: VERSIONS });
  assert.equal(p.status, "CATEGORY_HOLDOUT_PASS");
  assert.equal(p.exact, 84);
  assert.equal(p.productPromotionAllowed, false);
  assert.equal(p.allCategoriesCovered, false);
  assert.deepEqual(p.uncoveredCategories, ["humor", "news"]);

  const tamperedGold = structuredClone(GOLD);
  const tamperedLabel = tamperedGold.labels.find((label) => deriveD1iHoldout(CORPUS).rows.some((row) => row.itemId === label.itemId));
  tamperedLabel.goldAcceptedCategories = tamperedLabel.goldAcceptedCategories.includes("politics") ? [] : ["politics"];
  assert.throws(
    () => evaluateD1iCategoryHoldout({ corpus: CORPUS, gold: tamperedGold, predictions: perfect, versions: VERSIONS }),
    /evaluation gold differs from sealed projection/
  );

  const oneMiss = structuredClone(perfect);
  assert.ok(oneMiss.some((prediction) => removeOneExpectedAdmission(prediction, goldById)));
  const one = evaluateD1iCategoryHoldout({ corpus: CORPUS, gold: GOLD, predictions: oneMiss, versions: VERSIONS });
  assert.equal(one.status, "CATEGORY_HOLDOUT_PASS");
  assert.equal(one.exact, 83);
  assert.ok(one.exactRate >= 0.98);

  const twoMisses = structuredClone(perfect);
  let changed = 0;
  for (const prediction of twoMisses) if (changed < 2 && removeOneExpectedAdmission(prediction, goldById)) changed += 1;
  assert.equal(changed, 2);
  assert.equal(evaluateD1iCategoryHoldout({ corpus: CORPUS, gold: GOLD, predictions: twoMisses, versions: VERSIONS }).status, "CATEGORY_HOLDOUT_HOLD");

  const leak = structuredClone(perfect);
  const target = leak.find((prediction) => !goldById.get(prediction.itemId).goldAcceptedCategories.includes("politics"));
  const row = target.classification.admissionCategories.find((entry) => entry.category === "politics");
  row.decision = "accept";
  row.confidence = 0.95;
  row.evidenceSpans = [String(deriveD1iHoldout(CORPUS).items.find((item) => item.itemId === target.itemId).title).slice(0, 8)];
  row.reasonCodes = ["wrong-core-topic"];
  const leaked = evaluateD1iCategoryHoldout({ corpus: CORPUS, gold: GOLD, predictions: leak, versions: VERSIONS });
  assert.equal(leaked.exact, 83);
  assert.equal(leaked.unexpectedAdmission, 1);
  assert.equal(leaked.status, "CATEGORY_HOLDOUT_HOLD");
});
