import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionGate, ADMISSION_CATEGORY_IDS } from "../src/feed/selection-contract.js";
import {
  assembleClassificationFromCompactCategory,
  d1cTaxonomyVersion,
  normalizeClassifierInput,
  runPricedClassification,
  validateClassifierOutput
} from "../src/feed/selection-classifier-lab.js";
import {
  candidateCanaryBudget,
  candidateClassificationAssembler,
  candidateSemanticSchema,
  stepRunModel
} from "../tools/run-selection-d1c.mjs";
import {
  CANDIDATE_REGISTRY,
  CANDIDATE_REGISTRY_DOCUMENT,
  getCandidateExecutionHold,
  getRunnableCandidate,
  parseCandidateRegistry
} from "../tools/selection-candidate-registry.mjs";
import { D1I_HOLDOUT_LOCK, validateD1iHoldoutLock } from "../tools/selection-d1i-holdout.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFix = (name) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", name), "utf8"));
const P5_LOCK = readFix("selection-d1j-holdout.lock.json");
const P5 = CANDIDATE_REGISTRY["p5-compact-category-haiku"];
const VERSIONS = {
  modelVersion: P5.requestedModel,
  promptVersion: P5.promptVersion,
  taxonomyVersion: d1cTaxonomyVersion()
};

function context(item) {
  return {
    input: normalizeClassifierInput(item),
    versions: VERSIONS,
    operatorGroup: "d1j-test",
    originDocumentId: `d1j:${item.itemId}`,
    policy: P5.compactPolicy
  };
}

function assemble(item, semantic) {
  return assembleClassificationFromCompactCategory(semantic, context(item));
}

test("D1J: p5 compact 후보 정의와 실행 지문을 보존하고 소비된 단일 canary 승인은 재사용하지 않는다", () => {
  assert.equal(CANDIDATE_REGISTRY["p3.1-haiku"].candidateRecordSha256, "6b8545cad319ec5eadc4e3cb96c342a838a6bdaa4c42ff9251bebd92cf1ed887");
  assert.equal(CANDIDATE_REGISTRY["p3.2-haiku"].candidateRecordSha256, "66b9ef1792d9eb1c7b9e65037e967636bb47c30088bcf7b85cd7498c84c45421");
  assert.equal(CANDIDATE_REGISTRY["p4-category-haiku"].candidateRecordSha256, "55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6");
  assert.equal(P5.candidateRecordSha256, "126a693a64f94edd55c7e4ba0bbc3e17447268e0f58cb1ae98884314abb4ad65");
  assert.equal(P5.task, "category_admission_only");
  assert.equal(P5.semanticContract, "compact_category_v1");
  assert.equal(P5.execution.state, "approved_canary");
  assert.equal(P5.execution.runnable, true);
  assert.equal(P5.execution.maxCostUsd, 0.06);
  assert.equal(P5.execution.maxOutputTokensPerCall, 500);
  assert.match(P5.system, /Do not return evidence quotes or 14 admission rows/);
  assert.match(P5.system, /code adds politics automatically/);
  assert.match(P5.system, /The two arrays must be disjoint/);
  assert.deepEqual(
    {
      calls: candidateCanaryBudget(P5).maxCalls,
      cost: candidateCanaryBudget(P5).maxCostUsd,
      perCall: candidateCanaryBudget(P5).maxOutputTokensPerCall,
      total: candidateCanaryBudget(P5).maxOutputTokens
    },
    { calls: 12, cost: 0.06, perCall: 500, total: 6000 }
  );
  assert.equal(candidateCanaryBudget(CANDIDATE_REGISTRY["p4-category-haiku"]).maxOutputTokensPerCall, 1800);
  assert.deepEqual(getCandidateExecutionHold(P5.candidateId), {
    state: "consumed_hold",
    attemptId: "d1j-20260821-01",
    receiptSha256: "3691a543e12bf74f2f427e0ed651f23e35d7e97d7f80a53e10c53224325459f6",
    reason: "single_canary_approval_consumed"
  });
  assert.throws(() => getRunnableCandidate(P5.candidateId), /CANDIDATE_APPROVAL_CONSUMED/);

  const unknownCore = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  unknownCore.candidates.find((candidate) => candidate.candidateId === P5.candidateId).compactPolicy.eventTypes.law_policy.requiredCoreCategories = ["not-a-category"];
  assert.throws(() => parseCandidateRegistry(unknownCore), /invalid compact event policy/);
  const missingEmpty = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  delete missingEmpty.candidates.find((candidate) => candidate.candidateId === P5.candidateId).compactPolicy.emptyEventType;
  assert.throws(() => parseCandidateRegistry(missingEmpty), /invalid compact policy/);
});

test("D1J: 모델 출력 계약은 근거·14행을 제외한 compact 5필드뿐이다", () => {
  const schema = candidateSemanticSchema(P5);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    "confidence", "contentType", "eventType", "impactCategories", "subjectCategories"
  ]);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.eventType.enum, Object.keys(P5.compactPolicy.eventTypes));
  assert.equal(Object.hasOwn(schema.properties, "admissionCategories"), false);
  assert.equal(Object.hasOwn(schema.properties, "evidenceSpans"), false);
});

test("D1J: 음식 커뮤니티 글은 life 한 분야로 조립되고 근거는 제목에서 생성된다", () => {
  const item = {
    itemId: "d1a-01-food-as-politics",
    title: "집에서 만든 마라탕 레시피 대공개",
    excerpt: "육수부터 사천 고추기름까지 직접 끓여 만든 마라탕 만드는 법",
    sourceCountry: "KR",
    language: "ko"
  };
  const output = assemble(item, {
    contentType: "community",
    eventType: "community_discussion",
    impactCategories: ["life"],
    subjectCategories: [],
    confidence: 0.94
  });
  assert.deepEqual(admissionGate(output).admitted, ["life"]);
  assert.equal(output.primaryCategory, "life");
  assert.equal(output.admissionCategories.length, ADMISSION_CATEGORY_IDS.length);
  const life = output.admissionCategories.find((row) => row.category === "life");
  assert.deepEqual(life.evidenceSpans, [item.title]);
  assert.deepEqual(life.reasonCodes, ["compact_direct_impact"]);
  assert.equal(validateClassifierOutput(output, normalizeClassifierInput(item), VERSIONS).ok, true);
});

test("D1J: 법·정책 사건은 politics를 코드가 보장하고 직접 영향과 단순 주제를 분리한다", () => {
  const item = {
    itemId: "d1a-06-genuine-cross-domain",
    title: "국회, 반도체 특별법 본회의 통과… 세액공제 대폭 확대",
    excerpt: "여야 합의로 반도체 기업 세제 지원을 늘리는 특별법이 국회를 통과했다",
    sourceCountry: "KR",
    language: "ko"
  };
  const output = assemble(item, {
    contentType: "news",
    eventType: "law_policy",
    impactCategories: ["business"],
    subjectCategories: ["tech"],
    confidence: 0.91
  });
  assert.deepEqual(admissionGate(output).admitted, ["business", "politics"]);
  assert.equal(output.primaryCategory, "business");
  assert.deepEqual(output.descriptiveSecondaryCategories, ["tech"]);
  assert.equal(output.admissionCategories.find((row) => row.category === "tech").decision, "abstain");
  assert.deepEqual(output.admissionCategories.find((row) => row.category === "politics").reasonCodes, ["compact_event_required_core"]);
  assert.equal(validateClassifierOutput(output, normalizeClassifierInput(item), VERSIONS).ok, true);
});

test("D1J: compact 의미 충돌과 무근거 승인은 모두 fail-closed다", () => {
  const item = { itemId: "bad", title: "제목", excerpt: "본문", sourceCountry: "KR", language: "ko" };
  const base = { contentType: "news", eventType: "domain_event", impactCategories: ["business"], subjectCategories: [], confidence: 0.8 };
  for (const semantic of [
    { ...base, eventType: "unknown_event" },
    { ...base, impactCategories: ["unknown_category"] },
    { ...base, subjectCategories: ["business"] },
    { ...base, confidence: 1.1 },
    { ...base, contentType: "other", eventType: "other", impactCategories: ["life"] },
    { ...base, eventType: "other" },
    { ...base, extra: true }
  ]) assert.throws(() => assemble(item, semantic));

  const empty = { itemId: "empty", title: "", excerpt: "", sourceCountry: "KR", language: "ko" };
  assert.throws(() => assemble(empty, base), /source evidence/);

  const excerptOnly = { ...empty, excerpt: "기업 실적이 크게 늘었다" };
  const fallback = assemble(excerptOnly, base);
  assert.deepEqual(fallback.admissionCategories.find((row) => row.category === "business").evidenceSpans, [excerptOnly.excerpt]);

  const other = assemble(item, { contentType: "other", eventType: "other", impactCategories: [], subjectCategories: [], confidence: 0.7 });
  assert.equal(validateClassifierOutput(other, normalizeClassifierInput(item), VERSIONS).ok, true);
  assert.equal(admissionGate(other).blocked, "content_type_other");
});

test("D1J: 기존 유료 실행 코어는 주입된 compact 조립기를 한 번 사용해 정상 분류한다", async () => {
  const item = { itemId: "priced", title: "기업 실적 발표", excerpt: "매출과 영업이익이 늘었다", sourceCountry: "KR", language: "ko" };
  let calls = 0;
  let tick = 0;
  const result = await runPricedClassification({
    items: [item],
    callModel: async () => {
      calls += 1;
      return {
        semantic: { contentType: "news", eventType: "domain_event", impactCategories: ["business"], subjectCategories: [], confidence: 0.9 },
        usage: { inputTokens: 10, outputTokens: 5 }
      };
    },
    versions: VERSIONS,
    operatorGroupOf: () => "d1j-test",
    originDocumentIdOf: () => "d1j:priced",
    classificationAssembler: candidateClassificationAssembler(P5),
    pricing: P5.pricing,
    budget: { maxCalls: 1, maxInputTokens: 10000, maxOutputTokens: 1000, maxOutputTokensPerCall: 500, maxCostUsd: 1, perCallTimeoutMs: 1000, totalDeadlineMs: 10000 },
    now: () => tick++
  });
  assert.equal(calls, 1);
  assert.equal(result.results[0].status, "classified");
  assert.deepEqual(admissionGate(result.results[0].classification).admitted, ["business"]);
});

test("D1J: 소비된 p5 승인은 직접 실행 경로에서도 Keychain·파일 쓰기 전에 차단된다", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d1j-frozen-"));
  const dir = path.join(tmp, "attempt");
  let keyReads = 0;
  try {
    const result = await stepRunModel({
      dir,
      ledgerPath: path.join(tmp, "usage-ledger.jsonl"),
      lockPath: path.join(tmp, ".run-lock"),
      attemptId: "d1j-no-run",
      candidateDef: P5,
      getApiKey: () => { keyReads += 1; return "must-not-read"; }
    });
    assert.equal(result.status, "CANDIDATE_APPROVAL_CONSUMED_HOLD");
    assert.equal(keyReads, 0);
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fs.existsSync(path.join(tmp, "usage-ledger.jsonl")), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("D1J: p5의 동일 84건 홀드아웃은 미노출 상태로 별도 잠긴다", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d1j-holdout-"));
  try {
    const checked = validateD1iHoldoutLock({ lock: P5_LOCK, attemptsDir: tmp });
    assert.deepEqual(checked, { ok: true, errors: [], holdoutCount: 84, exposures: [] });
    assert.equal(P5_LOCK.candidate.candidateId, P5.candidateId);
    assert.equal(P5_LOCK.candidate.promptSha256, P5.promptSha256);
    assert.equal(P5_LOCK.derivation.orderedItemIdsSha256, D1I_HOLDOUT_LOCK.derivation.orderedItemIdsSha256);
    assert.equal(P5_LOCK.derivation.orderedEvidenceRowsSha256, D1I_HOLDOUT_LOCK.derivation.orderedEvidenceRowsSha256);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
