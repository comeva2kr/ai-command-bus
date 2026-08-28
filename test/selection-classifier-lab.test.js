// D1-A offline classifier lab v4.1 — FINAL MINIMAL CLOSURE. v4 유지 + Codex 실증 4건(R1~R4) 수정 검증.
// 정본: WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
// canonical authority는 frozen corpus에서 별도로 만들어 필수 인자로 넣는다(gold 자기신고 불신뢰). 공격은 public 경로를 친다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  D1_IDENTITIES, D1_GATES_LOCK_SHA256, WILSON_Z,
  evidenceHashOf, blindPacketHashOf, buildCanonicalAuthority, buildStructuredRequest, normalizeClassifierInput,
  validateGoldContract, releaseGoldState, validateGatesLock,
  evaluatePredictions, evaluateGates, runCachedClassification, buildReceipt, wilsonLowerBound,
  runPricedClassification, assembleClassificationFromSemantic, measureLegacyBaseline, compareCandidateVsLegacy,
  pricedCostUsd, D1C_SEMANTIC_SCHEMA, D1C_PROMPT_VERSION, d1cTaxonomyVersion,
  ledgerSummary, createInMemoryLedger, D1_CORPUS_ID, D1_CORPUS_SUPERSEDES_ID, contractProjectionOf, loadAdversarialAuthority
} from "../src/feed/selection-classifier-lab.js";
import { admissionGate, resolveScopeClass } from "../src/feed/selection-contract.js";
import { buildCorpus } from "../tools/build-selection-d1-corpus.mjs";
import {
  buildEligibleFromSnapshots, promoteGoldPlan, validateCandidateGold, canaryItemIds,
  computeReleasePass, buildUserPrompt, versionsForD1c, EXISTING_GOLD_SHA256, CANDIDATE_GOLD_SHA256,
  baselineStrictDrift, FROZEN_CORPUS_SHA256, isConsumedDiagnostic, CONSUMED_ARTIFACT_SHA,
  inspectConsumedDiagnostic, stepRunModel, D1C_BASELINE_CONTRACT, D1C_BASELINE_SUPERSEDES, createFileLedger
} from "../tools/run-selection-d1c.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFix = (n) => JSON.parse(readFileSync(path.join(HERE, "fixtures", n), "utf8"));
const CORPUS = readFix("selection-d1-corpus.json");
const GOLD = readFix("selection-d1-gold.json");
const S = readFix("selection-d1-eval-scenarios.json");
const GATES = readFix("selection-d1-gates.lock.json");
// D1-G FINAL CLOSURE: adversarial 채점 정본(authority-002). stubAuth는 합성 행 geo 검증 전용.
const AUTH_DOC = readFix("selection-d1g-adversarial-authority-002.json");
const authFor = (rows) => loadAdversarialAuthority(AUTH_DOC, { corpusRows: rows });
const stubAuth = { byId: new Map(), auditAmbiguous: new Set(), expectedContractFixtures: 0 };
const V = S.versions; const ID = D1_IDENTITIES;
const clone = (x) => JSON.parse(JSON.stringify(x));
const cn = (items) => buildCanonicalAuthority(items);
const vgc = (gold, items) => validateGoldContract(gold, { identities: ID, canonical: cn(items) });
// canonical을 명시 인자로 넣는 candidate 평가(기본은 items에서, 공격은 originalItems로).
const epc = ({ items, gold, predictions = [], mode = "candidate", canonical, gatesLock = GATES }) =>
  evaluatePredictions({ items, gold, predictions, versions: V, gatesLock, identities: ID, mode, canonical: canonical || cn(items) });

function mkCls(item, o = {}) {
  const title = item.title || "x"; const span = title.slice(0, Math.min(6, title.length)) || "x";
  // D1-G validator 수리(admission 14행 전수 fail-closed)에 맞춰 taxonomy 전 행을 만든다:
  // accept/abstain 지정 외 나머지는 reject. (기존엔 지정 행만 만들어 수리 전 구멍에 의존했다.)
  const acceptSet = new Set(o.accept || []); const abstainSet = new Set(o.abstain || []);
  const rows = GATES.categories.map((c) => (acceptSet.has(c)
    ? { category: c, decision: "accept", confidence: 0.9, evidenceSpans: [span], reasonCodes: ["semantic-topic"] }
    : abstainSet.has(c)
      ? { category: c, decision: "abstain", confidence: 0.4, evidenceSpans: [], reasonCodes: [] }
      : { category: c, decision: "reject", confidence: 0.1, evidenceSpans: [], reasonCodes: [] }));
  const scope = o.scope || "domestic";
  const geo = scope === "domestic" ? { eventJurisdictions: ["KR"], relevanceCountries: ["KR"] }
    : scope === "international" ? { eventJurisdictions: ["US"], relevanceCountries: ["KR", "US"] }
    : scope === "global" ? { eventJurisdictions: ["US"], relevanceCountries: ["US"] }
    : scope === "cross_border" ? { eventJurisdictions: ["US", "IR"], relevanceCountries: ["KR", "US", "IR"] }
    : { eventJurisdictions: [], relevanceCountries: [] }; // unknown: event 없음 → resolveScopeClass unknown
  const hasEvj = geo.eventJurisdictions.length > 0;
  return { contentType: o.contentType || "news", primaryCategory: o.primary || (o.accept && o.accept[0]) || "business",
    descriptiveSecondaryCategories: o.secondary || [], admissionCategories: rows,
    modelVersion: V.modelVersion, promptVersion: V.promptVersion, taxonomyVersion: V.taxonomyVersion,
    evidenceHash: evidenceHashOf(item), sourceCountry: "KR", language: "ko", ...geo,
    scopeClass: scope, geoConfidence: hasEvj ? 0.7 : 0, geoEvidenceSpans: hasEvj ? [span] : [], operatorGroup: "o", originDocumentId: "d", claimOriginGroup: "o" };
}
const advRows = () => CORPUS.rows.filter((r) => r.origin === "adversarial_contract_fixture");
const advItems = () => advRows().map((r) => ({ itemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt, sourceCountry: r.sourceCountry, language: r.language, contentKindHint: r.contentKindHint }));
const advCanon = () => buildCanonicalAuthority(advRows(), { adversarialAuthority: authFor(advRows()) });
const advGold = () => GOLD.labels.filter((l) => l.origin === "adversarial_contract_fixture");
const advGoodPred = () => advRows().map((r) => ({ itemId: r.blindItemId, status: "classified", classification: mkCls({ title: r.title, excerpt: r.excerpt }, { accept: r.contractGold.acceptedCategories, primary: r.contractGold.acceptedCategories[0], contentType: r.contractGold.contentType, scope: r.contractGold.scopeClass }) }));

// ── 기본 신뢰경계 ─────────────────────────────────────────────────────────────
test("gates SHA=상수, corpus read-only byte-identical, validateGatesLock(GATES)=true", () => {
  const raw = readFileSync(path.join(HERE, "fixtures", "selection-d1-gates.lock.json"), "utf8");
  assert.equal(D1_GATES_LOCK_SHA256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(JSON.stringify(buildCorpus()), JSON.stringify(CORPUS));
  assert.equal(validateGatesLock(GATES).ok, true);
});

// ── R1/§4.1·2·3: gates semantic leaf 전수 walker ──────────────────────────────
test("R1: gates semantic 모든 primitive leaf 하나씩 변조 → 전부 reject, extra field도 reject", () => {
  const leafPaths = (obj, prefix = []) => {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      if (prefix.length === 0 && k === "note") continue;
      const p = [...prefix, k];
      if (v !== null && typeof v === "object") out.push(...leafPaths(v, p));
      else out.push(p);
    }
    return out;
  };
  const setPath = (o, p, val) => { let cur = o; for (let i = 0; i < p.length - 1; i++) cur = cur[p[i]]; cur[p[p.length - 1]] = val; };
  const getPath = (o, p) => p.reduce((c, k) => c[k], o);
  const paths = leafPaths(GATES);
  let checked = 0;
  for (const p of paths) {
    const g = clone(GATES); const v = getPath(g, p);
    const mutated = typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : String(v) + "_TAMPER";
    setPath(g, p, mutated);
    assert.equal(validateGatesLock(g).ok, false, `leaf ${p.join(".")} must be rejected`);
    checked += 1;
  }
  // R1이 지목한 8개 문자열 leaf가 실제 검사 대상에 포함됐는지 확인
  const has = (p) => paths.some((x) => x.join(".") === p);
  for (const p of ["gates.precision.roundingRule", "gates.recall.rule", "gates.recall.baseline", "gates.qualifiedSupply.rule", "gates.qualifiedSupply.baseline", "gates.abstain.denominator", "gates.abstain.rationale", "gates.abstain.changeRequires"]) assert.ok(has(p), `walker covers ${p}`);
  assert.ok(checked >= 40, `checked ${checked} leaves`);
  // §4.2 extra semantic field
  const extra = clone(GATES); extra.gates.precision.extraField = 1;
  assert.equal(validateGatesLock(extra).ok, false, "extra field rejected");
  const extraTop = clone(GATES); extraTop.extraTop = 1;
  assert.equal(validateGatesLock(extraTop).ok, false, "top extra field rejected");
  // evaluate가 변조 lock에 throw
  const a = S.eval.admissionPrecisionBasic; const bad = clone(GATES); bad.gates.recall.rule = "changed";
  assert.throws(() => epc({ items: a.items, gold: a.gold, predictions: a.predictions, gatesLock: bad }), /CORRUPT_GATES_LOCK/);
  assert.throws(() => evaluateGates({ mode: "candidate" }, bad, a.gold, { identities: ID }), /CORRUPT_GATES_LOCK/);
});

// ── R2/§4.4: fixture_only 성능 gate 전부 NOT_EVALUATED ────────────────────────
test("R2: fixture_only의 모든 성능 gate pass:false·status NOT_EVALUATED", () => {
  const a = S.eval.admissionPrecisionBasic;
  const m = epc({ items: a.items, gold: a.gold, predictions: [], mode: "fixture_only" });
  assert.equal(m.mode, "fixture_only");
  const g = evaluateGates(m, GATES, a.gold, { identities: ID });
  for (const k of ["contentType", "abstain", "adversarial", "mutation", "precision"]) {
    assert.equal(g[k].pass, false, `${k} pass false`);
    assert.equal(g[k].status, "NOT_EVALUATED", `${k} NOT_EVALUATED`);
  }
  assert.equal(g.release.pass, false);
});

// ── R3/§4.5: effective non-answer (all withheld/error/schema_reject → rate 1·pass false) ──
test("R3: candidate 전건 non-answer면 effectiveNonAnswerRate=1, abstain gate pass:false, 원인별 breakdown", () => {
  const ab = S.eval.abstain; // ab1 agreed real
  for (const status of ["withheld", "error", "schema_reject"]) {
    const preds = [{ itemId: "ab1", status }];
    const m = epc({ items: ab.items, gold: ab.gold, predictions: preds });
    assert.equal(m.effectiveNonAnswer.effectiveNonAnswerRate, 1, `${status} rate 1`);
    assert.equal(m.effectiveNonAnswer.breakdown[status], 1, `${status} breakdown`);
    assert.equal(evaluateGates(m, GATES, ab.gold, { identities: ID }).abstain.pass, false, `${status} abstain pass false`);
  }
  // all-abstain classification도 non-answer
  const mAb = epc({ items: ab.items, gold: ab.gold, predictions: ab.predictions });
  assert.equal(mAb.effectiveNonAnswer.breakdown.all_abstain, 1);
  assert.equal(mAb.effectiveNonAnswer.effectiveNonAnswerRate, 1);
  assert.equal(evaluateGates(mAb, GATES, ab.gold, { identities: ID }).abstain.pass, false);
});

// ── R4/§4.6: canonical 분리 — items+gold+prediction 공동 오답도 corrupt ────────
test("R4: original frozen canonical 유지, items+gold+prediction을 함께 politics로 바꿔도 CORRUPT_EVAL_DATA", () => {
  const r = CORPUS.rows.find((x) => x.blindItemId === "d1a-01-food-as-politics"); // canonical contractGold = life
  const originalCanonical = buildCanonicalAuthority([r], { adversarialAuthority: authFor([r]) }); // frozen 정본(life)
  // 공격: items(contractGold 없음)·gold·prediction 모두 politics
  const attackItems = [{ itemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt, sourceCountry: r.sourceCountry, language: r.language, contentKindHint: r.contentKindHint }];
  const attackGold = [{ ...clone(GOLD.labels.find((l) => l.itemId === r.blindItemId)), goldAcceptedCategories: ["politics"] }];
  const attackPred = [{ itemId: r.blindItemId, status: "classified", classification: mkCls({ title: r.title, excerpt: r.excerpt }, { accept: ["politics"], primary: "politics", contentType: r.contractGold.contentType, scope: r.contractGold.scopeClass }) }];
  assert.throws(() => evaluatePredictions({ items: attackItems, gold: attackGold, predictions: attackPred, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: originalCanonical }), /CORRUPT_EVAL_DATA/);
  // item title 위조(canonical과 다른 title)도 hash 재대조로 corrupt
  const badItem = [{ ...attackItems[0], title: "완전히 다른 제목" }];
  assert.throws(() => evaluatePredictions({ items: badItem, gold: [clone(GOLD.labels.find((l) => l.itemId === r.blindItemId))], predictions: [attackPred[0]], versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: originalCanonical }), /CORRUPT_EVAL_DATA/);
});

// ── §4.7: contractGold가 classifier request에 미노출 ─────────────────────────
test("§4.7: buildStructuredRequest·request에 contractGold/gold 없음", () => {
  const req = buildStructuredRequest(normalizeClassifierInput(S.cacheRequest.requestFieldItem), V);
  assert.equal("contractGold" in req, false);
  assert.ok(!JSON.stringify(req).includes("contractGold") && !JSON.stringify(req).includes("acceptedCategories"));
  for (const f of S.cacheRequest.requiredRequestFields) assert.ok(f in req, `has ${f}`);
});

// ── §4.8 (v4 유지): gold 위조 전수 ───────────────────────────────────────────
test("유지: gold 위조 §9.1-9 canonical authority 기준 reject", () => {
  const items = S.goldContract.validItems, base = S.goldContract.validGold;
  assert.deepEqual(vgc(base, items).releaseEligibleItemIds, ["gv"]);
  const R = (mut) => { const g = clone(base); mut(g[0]); return vgc(g, items).reasons.gv || vgc(g, items).reasons[g[0].itemId]; };
  assert.equal(R((x) => { x.evidenceHash = "deadbeef"; }), "evidence_hash_mismatch");
  assert.equal(R((x) => { x.blindPacketHash = "fake"; }), "top_blind_packet_hash_mismatch");
  assert.equal(R((x) => { x.labelerA.identity = " labelerA "; }), "identity_not_trimmed_or_empty");
  assert.equal(R((x) => { x.labelerA.identity = "prod-classifier-v0"; }), "production_model_is_labeler");
  assert.equal(R((x) => { x.origin = "adversarial_contract_fixture"; }), "origin_invalid_or_mismatch");
  assert.equal(R((x) => { x.state = "weird"; }), "bad_state");
  assert.equal(R((x) => { x.goldContentType = "bogus"; }), "bad_contentType");
  assert.equal(R((x) => { x.goldAcceptedCategories = ["notacat"]; }), "unknown_category");
  assert.equal(R((x) => { x.goldAcceptedCategories = ["business", "business"]; }), "duplicate_category");
  assert.equal(R((x) => { x.goldAcceptedCategories = ["business"]; x.goldRejectedCategories = ["business"]; }), "category_overlap_conflict");
  const g = clone(base); g[0].itemId = "ghost"; assert.equal(vgc(g, items).reasons.ghost, "not_in_canonical_corpus");
});

test("유지: adjudicated blind hash·A/B 계약", () => {
  const items = S.goldContract.adjItems, base = S.goldContract.adjGold;
  assert.deepEqual(vgc(base, items).releaseEligibleItemIds, ["gadj"]);
  const rej = (mut) => { const g = clone(base); mut(g[0]); return vgc(g, items).reasons.gadj; };
  assert.equal(rej((x) => { delete x.adjudicator.blindPacketHash; }), "party_blind_packet_mismatch");
  assert.equal(rej((x) => { x.labelerB = null; }), "adjudicated_missing_party");
  assert.equal(rej((x) => { x.adjudicator = null; }), "adjudicated_missing_party");
  assert.equal(rej((x) => { x.labelerB.decisionDigest = x.labelerA.decisionDigest; }), "adjudicated_ab_agree_should_be_agreed");
});

test("유지: dup/orphan/1:1/mode 데이터셋·candidate 무예측 corrupt", () => {
  const d = S.dataset;
  assert.throws(() => epc({ items: [d.baseItems[0], d.baseItems[0]], gold: d.baseGold }), /CORRUPT_EVAL_DATA/);
  assert.throws(() => epc({ items: d.baseItems, gold: [d.baseGold[0], d.baseGold[0]] }), /CORRUPT_EVAL_DATA/);
  assert.throws(() => epc({ items: d.baseItems, gold: d.baseGold, predictions: [] }), /CORRUPT_EVAL_DATA/); // candidate 무예측
  assert.throws(() => epc({ items: d.baseItems, gold: d.baseGold, predictions: d.basePred, mode: "fixture_only" }), /CORRUPT_EVAL_DATA/); // fixture_only에 예측
});

test("유지→D1-G: adversarial decisive 10 PASS(authority-002 기준, 대체 2 포함), leak/scope-mismatch FAIL", () => {
  // D1-G: 채점 답은 authority-002 소유. decisive 10 = corpus 8 + 대체 반례 2(항목·gold를 authority에서 합성).
  const canon = advCanon();
  const decisive = AUTH_DOC.decisiveItems;
  const corpusRowById = new Map(advRows().map((r) => [r.blindItemId, r]));
  const items = [], gold = [], predictions = [];
  for (const d of decisive) {
    const rec = canon.get(d.blindItemId);
    const src = d.source === "corpus" ? corpusRowById.get(d.blindItemId) : d;
    items.push({ itemId: d.blindItemId, origin: "adversarial_contract_fixture", title: src.title, excerpt: src.excerpt,
      sourceCountry: src.sourceCountry, language: src.language, contentKindHint: src.contentKindHint });
    // gold: corpus 항목은 frozen gold 행, 대체 항목은 authority goldStub+canonical 해시로 합성(frozen gold 무수정)
    if (d.source === "corpus") gold.push(GOLD.labels.find((l) => l.itemId === d.blindItemId));
    else gold.push({ itemId: d.blindItemId, origin: "adversarial_contract_fixture", state: "contract_fixture_only",
      evidenceHash: rec.evidenceHash, blindPacketHash: rec.blindPacketHash, goldContentType: d.expected.contentType,
      humanValid: true, inScope: true, goldAcceptedCategories: [...d.expected.acceptedCategories],
      goldRejectedCategories: [], descriptiveSecondaryCategories: [...(d.expected.secondaryCategories || [])] });
    predictions.push({ itemId: d.blindItemId, status: "classified", classification: mkCls({ title: src.title, excerpt: src.excerpt },
      { accept: [...d.expected.acceptedCategories], primary: d.expected.acceptedCategories[0] || "unknown",
        contentType: d.expected.contentType, scope: d.expected.scope }) });
  }
  const good = evaluatePredictions({ items, gold, predictions, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.equal(good.adversarial.expectedCount, 10); assert.equal(good.adversarial.evaluatedValid, 10);
  assert.equal(good.adversarial.auditAmbiguousExcluded, 2); // d1a-07·d1a-10 감사용 보존, 분모 제외
  assert.equal(evaluateGates(good, GATES, gold, { identities: ID }).adversarial.pass, true);
  // leak: d1a-01의 rejected bait(politics) 승인 → FAIL
  const leakP = predictions.map((p) => { if (p.itemId !== "d1a-01-food-as-politics") return p; const r = corpusRowById.get(p.itemId);
    return { itemId: p.itemId, status: "classified", classification: mkCls({ title: r.title, excerpt: r.excerpt }, { accept: ["politics"], primary: "politics", contentType: "community", scope: "unknown" }) }; });
  const leak = evaluatePredictions({ items, gold, predictions: leakP, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.ok(leak.adversarial.selectedCategoryLeak > 0);
  assert.equal(evaluateGates(leak, GATES, gold, { identities: ID }).adversarial.pass, false);
  // scope-mismatch: d1a-09를 authority 정답(global)이 아닌 domestic으로 → FAIL
  const scopeP = predictions.map((p) => { if (p.itemId !== "d1a-09-domestic-media-overseas-event") return p; const r = corpusRowById.get(p.itemId);
    return { itemId: p.itemId, status: "classified", classification: mkCls({ title: r.title, excerpt: r.excerpt }, { accept: ["business"], primary: "business", contentType: "news", scope: "domestic" }) }; });
  const sc = evaluatePredictions({ items, gold, predictions: scopeP, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.ok(sc.adversarial.scopeMismatch > 0);
  assert.equal(evaluateGates(sc, GATES, gold, { identities: ID }).adversarial.pass, false);
  // 대체 반례 prediction 부재 시: invalidOrMissing으로 정직 집계 → PASS 불가(INCOMPLETE 상태의 코드 표현)
  const onlyCorpus = evaluatePredictions({ items: items.filter((i) => corpusRowById.has(i.itemId)), gold: gold.filter((g) => corpusRowById.has(g.itemId)),
    predictions: predictions.filter((p) => corpusRowById.has(p.itemId)), versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.equal(onlyCorpus.adversarial.expectedCount, 10);
  assert.equal(onlyCorpus.adversarial.invalidOrMissing, 2);
  assert.equal(evaluateGates(onlyCorpus, GATES, gold, { identities: ID }).adversarial.pass, false);
});

test("유지: admission precision·contentType critical·13분야 precision FAIL", () => {
  const a = S.eval.admissionPrecisionBasic;
  const r = epc({ items: a.items, gold: a.gold, predictions: a.predictions });
  assert.equal(r.perCategory.business.tp, 2); assert.equal(r.perCategory.business.fn, 1);
  assert.equal(r.perCategory.politics.tp, 1); assert.equal(r.perCategory.politics.fp, 1);
  const ct = S.eval.contentTypePerType;
  const rc = epc({ items: ct.items, gold: ct.gold, predictions: ct.predictions });
  assert.equal(rc.contentType.criticalConfusionCount, 2);
  assert.equal(evaluateGates(rc, GATES, ct.gold, { identities: ID }).contentType.pass, false);
  const t = S.eval.thirteenEmpty;
  const rt = epc({ items: t.items, gold: t.gold, predictions: t.predictions });
  assert.equal(Object.keys(rt.perCategory).length, 14);
  assert.equal(evaluateGates(rt, GATES, t.gold, { identities: ID }).precision.pass, false);
});

test("유지: releaseGoldState canonical real 정합·Wilson 재현 (D1-C 승격 후 real corpus sufficient)", () => {
  const rs = S.releaseState;
  assert.equal(releaseGoldState(rs.sufficientOne.gold, { identities: ID, canonical: cn(rs.sufficientOne.items), expectedRealItemIds: rs.sufficientOne.expectedRealItemIds }), "sufficient_independent_gold");
  assert.equal(releaseGoldState(rs.partial.gold, { identities: ID, canonical: cn(rs.partial.items), expectedRealItemIds: rs.partial.expectedRealItemIds }), "insufficient_independent_gold");
  assert.throws(() => releaseGoldState(rs.sufficientOne.gold, { identities: ID, expectedRealItemIds: rs.sufficientOne.expectedRealItemIds }), /canonical/);
  for (const v of GATES.wilson.reference) assert.ok(Math.abs(wilsonLowerBound(v.tp, v.n, WILSON_Z) - v.lowerBound) < 1e-12);
  const items = CORPUS.rows.map((r) => ({ itemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt, sourceCountry: r.sourceCountry, language: r.language, contentKindHint: r.contentKindHint, mutationPairId: r.mutationPairId, mutationRole: r.mutationRole, mutationType: r.mutationType }));
  const m = evaluatePredictions({ items, gold: GOLD.labels, predictions: [], versions: V, gatesLock: GATES, identities: ID, mode: "fixture_only", canonical: buildCanonicalAuthority(CORPUS.rows, { adversarialAuthority: authFor(CORPUS.rows) }) });
  assert.equal(m.release.goldState, "sufficient_independent_gold"); // D1-C: 정본 gold 승격 후 78 real 전부 독립 해결
});

test("유지: budget overrun/timeout 회계·no-cache·불변식, receipt raw-text 없음", () => {
  const b = S.budget; const adapter = (req) => mkCls({ title: req.title, excerpt: req.excerpt }, { accept: ["business"] });
  const cacheO = new Map();
  const o = runCachedClassification({ items: b.overrun.items, adapter, versions: b.versions, budget: b.overrun.budget, cache: cacheO, clock: () => 0 });
  assert.ok(o.results.some((r) => r.status === "withheld" && r.reason === "budget_overrun"));
  assert.equal(o.stats.budgetOverrun, 1); assert.equal(o.stats.withheld, 1); assert.equal(cacheO.size, 0);
  const cnt = (s) => o.results.filter((r) => r.status === s).length;
  assert.equal(o.stats.withheld, cnt("withheld"));
  assert.equal(cnt("classified") + cnt("cache_hit") + cnt("withheld") + cnt("schema_reject") + cnt("error"), o.results.length);
  let calls = 0; const cz = runCachedClassification({ items: b.costZero.items, adapter: (r) => { calls += 1; return adapter(r); }, versions: b.versions, budget: b.costZero.budget, cache: new Map(), clock: () => 0 });
  assert.equal(calls, 0); assert.ok(cz.results.every((r) => r.status === "withheld"));
  const seq = b.timeout.clockSeq; let ci = 0; const clk = () => seq[Math.min(ci++, seq.length - 1)];
  const cacheT = new Map();
  const t = runCachedClassification({ items: b.timeout.items, adapter, versions: b.versions, budget: b.timeout.budget, cache: cacheT, clock: clk });
  assert.ok(t.results.some((r) => r.status === "withheld" && r.reason === "budget_timeout")); assert.equal(cacheT.size, 0);
  const rc = S.receipt;
  const run = runCachedClassification({ items: rc.items, adapter, versions: rc.versions, budget: rc.budget, cache: new Map(), clock: () => 1 });
  const receipt = buildReceipt({ ...run, ...rc.shas }, () => 1);
  for (const bad of rc.forbiddenSubstrings) assert.ok(!JSON.stringify(receipt).includes(bad));
});

test("유지: mutation semantic/invariance gate", () => {
  const mut = CORPUS.rows.filter((r) => r.origin === "mutation_fixture");
  const items = mut.map((r) => ({ itemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt, sourceCountry: r.sourceCountry, language: r.language, contentKindHint: r.contentKindHint, mutationPairId: r.mutationPairId, mutationRole: r.mutationRole, mutationType: r.mutationType }));
  const canon = buildCanonicalAuthority(mut);
  const gold = mut.map((r) => clone(GOLD.labels.find((l) => l.itemId === r.blindItemId)));
  const good = mut.map((r) => ({ itemId: r.blindItemId, status: "classified", classification: mkCls({ title: r.title, excerpt: r.excerpt }, { accept: r.contractGold.acceptedCategories, primary: r.contractGold.acceptedCategories[0] }) }));
  const rGood = evaluatePredictions({ items, gold, predictions: good, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.equal(evaluateGates(rGood, GATES, gold, { identities: ID }).mutation.pass, true);
  const bad = good.map((p) => (p.itemId === "d1m-03b" ? { itemId: p.itemId, status: "classified", classification: mkCls({ title: mut.find((r) => r.blindItemId === "d1m-03b").title, excerpt: mut.find((r) => r.blindItemId === "d1m-03b").excerpt }, { accept: ["politics"], primary: "politics" }) } : p));
  const rBad = evaluatePredictions({ items, gold, predictions: bad, versions: V, gatesLock: GATES, identities: ID, mode: "candidate", canonical: canon });
  assert.equal(evaluateGates(rBad, GATES, gold, { identities: ID }).mutation.pass, false);
});

// ── D1-C: 실모델 측정 경로 ────────────────────────────────────────────────────
const D1CV = versionsForD1c();
function mkSemantic(item, o = {}) {
  const title = item.title || "x"; const span = title.slice(0, Math.min(6, title.length)) || "x";
  const accept = new Set(o.accept || []);
  const rows = GATES.categories.map((c) => (accept.has(c)
    ? { category: c, decision: "accept", confidence: 0.9, evidenceSpans: [o.badSpan ? "없는부분문자열" : span], reasonCodes: ["semantic-topic"] }
    : { category: c, decision: "reject", confidence: 0.1, evidenceSpans: [], reasonCodes: [] }));
  return {
    contentType: o.contentType || "news", primaryCategory: o.primary || (o.accept && o.accept[0]) || "unknown",
    descriptiveSecondaryCategories: o.secondary || [], admissionCategories: rows,
    eventJurisdictions: o.evj || ["KR"], relevanceCountries: o.rel || ["KR"], geoEvidenceSpans: [span]
  };
}
const mkItem = (id, title) => ({ blindItemId: id, itemId: id, title, excerpt: "", sourceId: "s", sourceTier: "aggregate", declaredSection: null, contentKindHint: "news", sourceCountry: "KR", language: "ko" });
const BUDGET = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 172800, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
const RUNOPTS = { versions: D1CV, operatorGroupOf: () => "grp", originDocumentIdOf: () => "doc", now: () => 0 };
const okModel = (o = {}) => async ({ input }) => ({ semantic: mkSemantic({ title: input.title }, o), usage: { inputTokens: 100, outputTokens: 50 } });

test("D1-C: 실단가·schema 14분야·taxonomyVersion 결정성", () => {
  assert.equal(pricedCostUsd(1_000_000, 0), 1); // input $1/MTok
  assert.equal(pricedCostUsd(0, 1_000_000), 5); // output $5/MTok
  assert.equal(D1C_SEMANTIC_SCHEMA.properties.admissionCategories.items.properties.category.enum.length, 14);
  assert.equal(D1C_SEMANTIC_SCHEMA.required.length, 7);
  assert.equal(D1C_PROMPT_VERSION, "nowhot-selection-d1c-p1");
  assert.equal(d1cTaxonomyVersion(), d1cTaxonomyVersion()); // 결정적
});

test("D1-C: 비용·호출 preflight 0-call 차단(maxCalls 0 / maxCostUsd 0)", async () => {
  const items = [mkItem("x1", "제목입니다")];
  let calls = 0; const cm = async (a) => { calls += 1; return okModel({ accept: ["business"] })(a); };
  const r0 = await runPricedClassification({ items, callModel: cm, ...RUNOPTS, budget: { ...BUDGET, maxCalls: 0 } });
  assert.equal(calls, 0); assert.ok(r0.results.every((x) => x.status === "withheld" && x.reason === "budget_preflight"));
  const rc = await runPricedClassification({ items, callModel: cm, ...RUNOPTS, budget: { ...BUDGET, maxCostUsd: 0 } });
  assert.equal(calls, 0); assert.ok(rc.results.every((x) => x.status === "withheld"));
});

test("D1-C: cache 변조 거부 → 재분류", async () => {
  const items = [mkItem("c1", "제목입니다")];
  const cache = new Map();
  const r1 = await runPricedClassification({ items, callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: BUDGET, cache });
  assert.equal(r1.results[0].status, "classified"); assert.equal(cache.size, 1);
  const key = [...cache.keys()][0]; cache.set(key, { bogus: true }); // 변조
  let calls2 = 0; const cm2 = async (a) => { calls2 += 1; return okModel({ accept: ["business"] })(a); };
  const r2 = await runPricedClassification({ items, callModel: cm2, ...RUNOPTS, budget: BUDGET, cache });
  assert.equal(calls2, 1); assert.equal(r2.results[0].status, "classified"); // 변조 cache 삭제 후 재분류
});

test("D1-C: canary→full 중복호출 0(cache 공유 → 재실행 전부 cache_hit)", async () => {
  const items = [mkItem("k1", "제목하나"), mkItem("k2", "제목두울")];
  const cache = new Map(); let calls = 0;
  const cm = async (a) => { calls += 1; return okModel({ accept: ["business"] })(a); };
  const first = await runPricedClassification({ items, callModel: cm, ...RUNOPTS, budget: BUDGET, cache });
  assert.ok(first.results.every((r) => r.status === "classified")); assert.equal(calls, 2);
  const again = await runPricedClassification({ items, callModel: cm, ...RUNOPTS, budget: BUDGET, cache });
  assert.equal(calls, 2); assert.ok(again.results.every((r) => r.status === "cache_hit")); // 재호출 0
});

test("D1-C: grounding·primary·other 불변식", async () => {
  const input = normalizeClassifierInput(mkItem("g1", "제목입니다"));
  // other → admit 0(primaryCategory unknown 요구)
  const clsOther = assembleClassificationFromSemantic(mkSemantic({ title: "제목입니다" }, { accept: ["business"], contentType: "other", primary: "unknown" }), { input, versions: D1CV, operatorGroup: "g", originDocumentId: "d" });
  assert.equal(admissionGate(clsOther).admitted.length, 0);
  // ungrounded evidenceSpan → schema_reject(재분류 없이 유효성 실패)
  let calls = 0; const badModel = async (a) => { calls += 1; return { semantic: mkSemantic({ title: a.input.title }, { accept: ["business"], badSpan: true }), usage: { inputTokens: 10, outputTokens: 5 } }; };
  const r = await runPricedClassification({ items: [mkItem("g2", "제목입니다")], callModel: badModel, ...RUNOPTS, budget: BUDGET });
  assert.equal(r.results[0].status, "schema_reject");
  // 정상 grounded는 classified + admit business
  const good = await runPricedClassification({ items: [mkItem("g3", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: BUDGET });
  assert.equal(good.results[0].status, "classified");
  assert.deepEqual(admissionGate(good.results[0].classification).admitted, ["business"]);
});

test("D1-C: gold/라벨 필드 프롬프트 누출 0", () => {
  const req = buildStructuredRequest(normalizeClassifierInput(mkItem("p1", "청와대 발표")), D1CV);
  const prompt = buildUserPrompt(req);
  for (const bad of ["goldAccepted", "acceptedCategories", "declaredCategory", "contractGold", "humanValid", "inScope", "adjudicator", "labeler", "decisionDigest"]) {
    assert.ok(!prompt.includes(bad), `prompt must not leak ${bad}`);
  }
  assert.ok(prompt.includes("청와대 발표")); // title은 포함
});

test("D1-C: snapshot 1:1 매핑 + category/hash 불일치 차단(실데이터)", () => {
  const snapFiles = {};
  for (const s of CORPUS.snapshots) snapFiles[s.id] = JSON.parse(readFileSync(path.join(HERE, "..", s.path), "utf8"));
  const candidate = JSON.parse(readFileSync(path.join(HERE, "..", ".nowhot-local/selection-d1b/final-gold.candidate.json"), "utf8"));
  const { mapped, eligible } = buildEligibleFromSnapshots({ corpus: CORPUS, gold: candidate, snapshotFiles: snapFiles });
  assert.equal(mapped.length, 78); assert.equal(eligible.length, 71);
  // 합성 corpus로 변조 차단 확인
  const one = { rows: [{ origin: "real_local_snapshot", blindItemId: "r1", sourceId: "s1", sourceSnapshotId: "snap1", declaredCategory: "business", evidenceHash: evidenceHashOf({ title: "제목", excerpt: "" }), title: "제목", excerpt: "" }] };
  const g1 = { labels: [{ itemId: "r1", state: "agreed", humanValid: true, inScope: true, goldAcceptedCategories: ["business"] }] };
  assert.equal(buildEligibleFromSnapshots({ corpus: one, gold: g1, snapshotFiles: { snap1: { rows: [{ item: { source: "s1", title: "제목", summary: "", category: "business" } }] } } }).eligible.length, 1);
  assert.throws(() => buildEligibleFromSnapshots({ corpus: one, gold: g1, snapshotFiles: { snap1: { rows: [{ item: { source: "s1", title: "제목", summary: "", category: "humor" } }] } } }), /category/);
  assert.throws(() => buildEligibleFromSnapshots({ corpus: one, gold: g1, snapshotFiles: { snap1: { rows: [{ item: { source: "s1", title: "다른제목", summary: "", category: "business" } }] } } }), /no unique snapshot/);
});

test("D1-C: gold 승격 계획 멱등·거부 + candidate 계약 검증(실데이터)", () => {
  assert.equal(promoteGoldPlan({ currentSha: EXISTING_GOLD_SHA256, candidateSha: CANDIDATE_GOLD_SHA256 }).action, "promote");
  assert.equal(promoteGoldPlan({ currentSha: CANDIDATE_GOLD_SHA256, candidateSha: CANDIDATE_GOLD_SHA256 }).action, "idempotent_existing");
  assert.equal(promoteGoldPlan({ currentSha: "deadbeef", candidateSha: CANDIDATE_GOLD_SHA256 }).action, "reject");
  assert.equal(promoteGoldPlan({ currentSha: EXISTING_GOLD_SHA256, candidateSha: "wrongcand" }).action, "reject");
  const candidate = JSON.parse(readFileSync(path.join(HERE, "..", ".nowhot-local/selection-d1b/final-gold.candidate.json"), "utf8"));
  const vc = validateCandidateGold({ corpus: CORPUS, candidateGold: candidate });
  assert.equal(vc.ok, true); assert.equal(vc.eligibleCount, 71);
  assert.ok(Object.values(vc.checks).every(Boolean));
  assert.equal(canaryItemIds(CORPUS).length, 12);
});

test("D1-C: releasePass는 goldState+7게이트 AND(하나만 false여도 false)", () => {
  const goodGates = { contentType: { pass: true }, abstain: { pass: true }, adversarial: { pass: true }, mutation: { pass: true }, precision: { pass: true } };
  const cmpOk = { recallPass: true, supplyPass: true };
  assert.equal(computeReleasePass({ goldState: "sufficient_independent_gold", gates: goodGates, comparison: cmpOk }).releasePass, true);
  // precision false(현 표본의 실제 상황) → releasePass false
  const pFalse = { ...goodGates, precision: { pass: false } };
  assert.equal(computeReleasePass({ goldState: "sufficient_independent_gold", gates: pFalse, comparison: cmpOk }).releasePass, false);
  // recall false → false
  assert.equal(computeReleasePass({ goldState: "sufficient_independent_gold", gates: goodGates, comparison: { recallPass: false, supplyPass: true } }).releasePass, false);
  // goldState insufficient → false
  assert.equal(computeReleasePass({ goldState: "insufficient_independent_gold", gates: goodGates, comparison: cmpOk }).releasePass, false);
});

test("D1-C: legacy baseline 결정성 + candidate 비교(recall/supply 감소 금지)", () => {
  const eligible = [
    { legacyCategory: "business", goldAcceptedCategories: ["business"] },
    { legacyCategory: "news", goldAcceptedCategories: ["politics"] },
    { legacyCategory: "realestate", goldAcceptedCategories: ["realestate", "politics"] }
  ];
  const b1 = measureLegacyBaseline({ eligible });
  const b2 = measureLegacyBaseline({ eligible });
  assert.deepEqual(b1.perCategory, b2.perCategory); // 결정적
  assert.equal(b1.perCategory.politics.goldPositives, 2);
  assert.equal(b1.perCategory.politics.recall, 0); // 레거시가 politics를 하나도 안 잡음
  // candidate가 politics 2건 다 잡으면 recall/supply 상승
  const better = compareCandidateVsLegacy(b1, { business: { tp: 1, fn: 0 }, politics: { tp: 2, fn: 0 }, realestate: { tp: 1, fn: 0 } });
  assert.equal(better.recallPass, true); assert.equal(better.supplyPass, true);
  // candidate가 realestate를 못 잡으면 supply 감소 → fail
  const worse = compareCandidateVsLegacy(b1, { business: { tp: 1, fn: 0 }, politics: { tp: 0, fn: 2 }, realestate: { tp: 0, fn: 1 } });
  assert.equal(worse.recallPass, false);
});

// ── D1-C INTEGRITY: 4개 결함 수리 RED→GREEN ──────────────────────────────────
const D1CI_DIR = path.join(HERE, "..", ".nowhot-local", "selection-d1c");

test("D1C-integrity #1: cache-hit여도 lifetime usage는 priorUsage 포함(0으로 안 돌아감)", async () => {
  const cache = new Map();
  const r1 = await runPricedClassification({ items: [mkItem("li1", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: BUDGET, cache });
  assert.equal(r1.results[0].status, "classified"); assert.ok(r1.stats.inputTokens > 0);
  const prior = { calls: 12, inputTokens: 20022, outputTokens: 7527 };
  const r2 = await runPricedClassification({ items: [mkItem("li1", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: BUDGET, cache, priorUsage: prior });
  assert.equal(r2.results[0].status, "cache_hit");
  assert.equal(r2.stats.costUsd, 0); // 이번 시도 0
  assert.equal(r2.stats.lifetimeCalls, 12);
  assert.equal(r2.stats.lifetimeInputTokens, 20022);
  assert.equal(r2.stats.lifetimeOutputTokens, 7527);
  assert.ok(r2.stats.lifetimeCostUsd > 0); // lifetime 0 아님
});

test("D1C-integrity #2: canary+full lifetime 통합 상한이 다음 호출 전 차단(cost/calls/token)", async () => {
  const budget = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 172800, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
  // cost 경계: lifetime cost $1.245, 다음 보수적 호출 합쳐 $1.25 초과 → 차단(개별 단계는 통과)
  const priorCost = { calls: 50, inputTokens: 395000, outputTokens: 170000 }; // 0.395 + 0.85 = 1.245
  const rc = await runPricedClassification({ items: [mkItem("bg1", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget, priorUsage: priorCost });
  assert.equal(rc.results[0].status, "withheld"); assert.equal(rc.results[0].reason, "budget_preflight"); assert.equal(rc.stats.calls, 0);
  // calls 경계
  const rk = await runPricedClassification({ items: [mkItem("bg2", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: { ...budget, maxCalls: 50 }, priorUsage: { calls: 50, inputTokens: 0, outputTokens: 0 } });
  assert.equal(rk.results[0].status, "withheld");
  // input token 경계
  const rt = await runPricedClassification({ items: [mkItem("bg3", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: { ...budget, maxInputTokens: 100 }, priorUsage: { calls: 0, inputTokens: 100, outputTokens: 0 } });
  assert.equal(rt.results[0].status, "withheld");
});

test("D1C-integrity #3: consumed guard가 기존 canary 산출물 감지(Keychain/API 0 경로)", () => {
  assert.equal(isConsumedDiagnostic(D1CI_DIR), true); // canary-predictions.json 존재
  assert.equal(isConsumedDiagnostic(path.join(HERE, "..", ".nowhot-local", "selection-d1c-integrity")), false);
});

test("D1C-integrity #4: 기존 D1-C 소비 산출물 SHA 전부 불변", () => {
  for (const [name, exp] of Object.entries(CONSUMED_ARTIFACT_SHA)) {
    assert.equal(createHash("sha256").update(readFileSync(path.join(D1CI_DIR, name))).digest("hex"), exp, `${name} unchanged`);
  }
});

test("D1C-integrity #5: baseline payload/extra/missing/raw-byte/locksha 변조 전부 reject", () => {
  const lockedRaw = readFileSync(path.join(HERE, "fixtures", "selection-d1-legacy-baseline.lock.json"), "utf8");
  const corpusSha = createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-corpus.json"))).digest("hex");
  const goldSha = createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-gold.json"))).digest("hex");
  const payload = { ...JSON.parse(lockedRaw) }; delete payload.lockSha256;
  assert.deepEqual(baselineStrictDrift({ corpusSha, goldSha, lockedRaw, expectedPayload: payload }), []); // 정상
  const val = JSON.parse(lockedRaw); val.eligibleCount = 999;
  assert.ok(baselineStrictDrift({ corpusSha, goldSha, lockedRaw: JSON.stringify(val, null, 2) + "\n", expectedPayload: payload }).includes("baseline_payload_mismatch"));
  const ex = JSON.parse(lockedRaw); ex.extraKey = 1;
  assert.ok(baselineStrictDrift({ corpusSha, goldSha, lockedRaw: JSON.stringify(ex, null, 2) + "\n", expectedPayload: payload }).includes("baseline_payload_mismatch"));
  const miss = JSON.parse(lockedRaw); delete miss.totalQualifiedSupply;
  assert.ok(baselineStrictDrift({ corpusSha, goldSha, lockedRaw: JSON.stringify(miss, null, 2) + "\n", expectedPayload: payload }).includes("baseline_payload_mismatch"));
  assert.ok(baselineStrictDrift({ corpusSha, goldSha, lockedRaw: lockedRaw + " ", expectedPayload: payload }).includes("baseline_raw_byte_sha"));
  const ls = JSON.parse(lockedRaw); ls.lockSha256 = "deadbeef";
  assert.ok(baselineStrictDrift({ corpusSha, goldSha, lockedRaw: JSON.stringify(ls, null, 2) + "\n", expectedPayload: payload }).includes("baseline_locksha_internal_inconsistent"));
  assert.ok(baselineStrictDrift({ corpusSha: "x", goldSha, lockedRaw, expectedPayload: payload }).includes("corpus_raw_sha"));
});

test("D1C-integrity #6: corpus v2 adversarial geo — scope==resolveScopeClass, span grounded, sourceCountry 비추론", () => {
  const adv = CORPUS.rows.filter((r) => r.origin === "adversarial_contract_fixture");
  assert.equal(adv.length, 10);
  for (const r of adv) {
    const cg = r.contractGold;
    assert.equal(cg.scopeClass, resolveScopeClass({ eventJurisdictions: cg.eventJurisdictions, relevanceCountries: cg.relevanceCountries }).scopeClass, `${r.blindItemId} scope==resolve`);
    const hay = (r.title || "") + "\n" + (r.excerpt || "");
    for (const s of (cg.geoEvidenceSpans || [])) assert.ok(hay.includes(s), `${r.blindItemId} geoSpan grounded`);
  }
  // sourceCountry=KR이어도 event 없으면 scope unknown (비추론 증명)
  const krUnknown = adv.filter((r) => r.sourceCountry === "KR" && r.contractGold.scopeClass === "unknown");
  assert.ok(krUnknown.length >= 3, "KR outlet + no event → scope unknown");
});

test("D1C-integrity #7: corpus v2 결정적 build, real 78/mutation 8 불변, gold/gates 불변", () => {
  assert.equal(CORPUS.contract, "NOWHOT-SELECTION-D1-CORPUS-002");
  assert.equal(CORPUS.supersedes, "NOWHOT-SELECTION-D1-CORPUS-001");
  assert.equal(CORPUS.rows.filter((r) => r.origin === "real_local_snapshot").length, 78);
  assert.equal(CORPUS.rows.filter((r) => r.origin === "mutation_fixture").length, 8);
  assert.equal(createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-corpus.json"))).digest("hex"), FROZEN_CORPUS_SHA256);
  assert.equal(createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-gold.json"))).digest("hex"), CANDIDATE_GOLD_SHA256);
  assert.equal(createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-gates.lock.json"))).digest("hex"), "10c3160c9c098e7a4c3ca3fbd0ebaa0561bcb12f3d1bda82605a1f56a1fb7793");
});

test("D1C-integrity #8: full-predictions/evaluation 부재, 나머지 84 sealed", () => {
  assert.equal(existsSync(path.join(D1CI_DIR, "full-predictions.json")), false);
  assert.equal(existsSync(path.join(D1CI_DIR, "evaluation.json")), false);
  const cp = JSON.parse(readFileSync(path.join(D1CI_DIR, "canary-predictions.json"), "utf8"));
  assert.equal(cp.results.length, 12); // canary만, 84 미실행
});

// ── D1-C INTEGRITY-02: Codex 실증 4개 계약을 코드에서 닫는 RED→GREEN ──────────
test("D1CI2 #1-4: canonical scope 재계산·검증(저장 scope 미신뢰), mutation=null", () => {
  const mk = (cg) => [{ blindItemId: "a1", origin: "adversarial_contract_fixture", title: "국회 통과", excerpt: "", contractGold: cg }];
  const base = { acceptedCategories: ["business"], rejectedCategories: [], descriptiveSecondaryCategories: [] };
  // #1 ev=[] scope=domestic → derived unknown != domestic
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [], scopeClass: "domestic" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  // #2 ev=US rel=KR,US scope=global → derived international
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: ["US"], relevanceCountries: ["KR", "US"], geoEvidenceSpans: ["국회"], scopeClass: "global" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  // #3 non-unknown geoSpans 없음
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: [], scopeClass: "domestic" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  // #3b ungrounded span
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["존재하지않는스팬"], scopeClass: "domestic" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  // #4 mutation legacy scope=null; corpus v2 정상 통과
  const mutCanon = buildCanonicalAuthority(CORPUS.rows.filter((r) => r.origin === "mutation_fixture"));
  assert.ok([...mutCanon.values()].every((r) => r.contractProjection.scope === null));
  const full = buildCanonicalAuthority(CORPUS.rows, { adversarialAuthority: authFor(CORPUS.rows) });
  const adv = [...full.values()].filter((r) => r.origin === "adversarial_contract_fixture");
  // D1-G: decisive 10(대체 2 포함, projection.scope 문자열) + 감사용 ambiguous 2(projection null)
  assert.equal(adv.filter((r) => !r.auditAmbiguous).length, 10);
  assert.ok(adv.filter((r) => !r.auditAmbiguous).every((r) => typeof r.contractProjection.scope === "string"));
  assert.equal(adv.filter((r) => r.auditAmbiguous).length, 2);
  assert.ok(adv.filter((r) => r.auditAmbiguous).every((r) => r.contractProjection === null));
});

test("D1CI2 #5,#7: ledger 프로세스 재생성 복원 + 미정산 reserve estimated lifetime", () => {
  const rec = [{ seq: 0, type: "recovery", calls: 12, inputTokens: 20022, outputTokens: 7527 }];
  const reloaded = ledgerSummary(JSON.parse(JSON.stringify(rec))); // 새 프로세스 모사(직렬화→역직렬화)
  assert.equal(reloaded.calls, 12); assert.equal(reloaded.inputTokens, 20022); assert.equal(reloaded.costUsd, 0.057657);
  const uns = ledgerSummary([...rec, { seq: 1, type: "reserve", callId: "a-0", estInput: 1000, maxOutput: 1800 }]);
  assert.equal(uns.unsettledReserves, 1); assert.equal(uns.inputTokens, 21022); assert.equal(uns.outputTokens, 9327);
});

test("D1CI2 #6: runPriced reserve가 provider(settle) 전에 영구 기록", async () => {
  const ledger = createInMemoryLedger();
  const r = await runPricedClassification({ items: [mkItem("l1", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget: BUDGET, ledger, attemptId: "t" });
  assert.equal(r.results[0].status, "classified");
  const recs = ledger.read();
  const resIdx = recs.findIndex((x) => x.type === "reserve"), setIdx = recs.findIndex((x) => x.type === "settle");
  assert.ok(resIdx >= 0 && setIdx > resIdx, "reserve before settle");
});

test("D1CI2 #8: canary+full lifetime 통합 상한 $0.1836+$1.092 차단(ledger)", async () => {
  const budget = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 172800, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
  const ledger = createInMemoryLedger([{ seq: 0, type: "recovery", calls: 50, inputTokens: 395000, outputTokens: 170000 }]); // lifetime cost $1.245
  assert.equal(ledger.summary().costUsd, 1.245);
  const r = await runPricedClassification({ items: [mkItem("l2", "제목입니다")], callModel: okModel({ accept: ["business"] }), ...RUNOPTS, budget, ledger, attemptId: "t2" });
  assert.equal(r.results[0].status, "withheld"); assert.equal(r.results[0].reason, "budget_preflight"); assert.equal(r.stats.calls, 0);
});

test("D1CI2 #9,#10: consumed guard sealed/drift/absent (getApiKey/provider 0)", async () => {
  const dir = path.join(HERE, "..", ".nowhot-local", "selection-d1c");
  assert.equal(inspectConsumedDiagnostic(dir).state, "sealed");
  let spy = 0; const getApiKey = () => { spy += 1; return "k"; };
  const rSealed = await stepRunModel({ dir, getApiKey });
  assert.equal(rSealed.status, "D1C_CONSUMED_DIAGNOSTIC_HOLD"); assert.equal(spy, 0);
  const tmp = mkdtempSync(path.join(tmpdir(), "d1ci2-"));
  writeFileSync(path.join(tmp, "canary-predictions.json"), "tampered"); // partial + SHA mismatch
  assert.equal(inspectConsumedDiagnostic(tmp).state, "drift");
  const rDrift = await stepRunModel({ dir: tmp, getApiKey });
  assert.equal(rDrift.status, "PRECONDITION_HOLD"); assert.equal(spy, 0);
  const tmp2 = mkdtempSync(path.join(tmpdir(), "d1ci2-"));
  assert.equal(inspectConsumedDiagnostic(tmp2).state, "absent"); // 세 파일 없음
  rmSync(tmp, { recursive: true }); rmSync(tmp2, { recursive: true });
});

test("D1CI2 #11,#12: corpus builder byte-identical + current/supersedes ID·baseline lineage exact", () => {
  assert.equal(JSON.stringify(buildCorpus()), JSON.stringify(CORPUS)); // #11 결정적
  assert.equal(createHash("sha256").update(readFileSync(path.join(HERE, "fixtures", "selection-d1-corpus.json"))).digest("hex"), FROZEN_CORPUS_SHA256);
  // #12 ID lineage exact
  assert.equal(D1_CORPUS_ID, "NOWHOT-SELECTION-D1-CORPUS-002");
  assert.equal(D1_CORPUS_SUPERSEDES_ID, "NOWHOT-SELECTION-D1-CORPUS-001");
  assert.equal(CORPUS.contract, D1_CORPUS_ID); assert.equal(CORPUS.supersedes, D1_CORPUS_SUPERSEDES_ID);
  const bl = JSON.parse(readFileSync(path.join(HERE, "fixtures", "selection-d1-legacy-baseline.lock.json"), "utf8"));
  assert.equal(bl.contract, D1C_BASELINE_CONTRACT); assert.equal(bl.supersedes, D1C_BASELINE_SUPERSEDES);
  assert.equal(D1C_BASELINE_CONTRACT, "NOWHOT-SELECTION-D1C-LEGACY-BASELINE-002");
  assert.equal(D1C_BASELINE_SUPERSEDES, "NOWHOT-SELECTION-D1C-LEGACY-BASELINE-001");
});

// ── D1-C INTEGRITY-03: 4개 뿌리 결함 완결 RED→GREEN ──────────────────────────
test("D1CI3 §7: geo 공백 원소·span 공백 reject, contractProjectionOf scope 필수", () => {
  const mk = (cg) => [{ blindItemId: "a1", origin: "adversarial_contract_fixture", title: "국회 통과", excerpt: "", contractGold: cg }];
  const base = { acceptedCategories: ["business"], rejectedCategories: [], descriptiveSecondaryCategories: [] };
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: ["KR", " "], relevanceCountries: ["KR"], geoEvidenceSpans: ["국회"], scopeClass: "domestic" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  assert.throws(() => buildCanonicalAuthority(mk({ ...base, eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["국회", " "], scopeClass: "domestic" }), { adversarialAuthority: stubAuth }), /CORRUPT_EVAL_DATA/);
  assert.throws(() => contractProjectionOf({ acceptedCategories: ["x"] }), /verified scope argument required/); // scope 생략 fail-closed
  assert.equal(contractProjectionOf({ acceptedCategories: ["x"] }, null).scope, null); // mutation 명시 null
  assert.equal(contractProjectionOf({ acceptedCategories: ["x"] }, "domestic").scope, "domestic");
});

test("D1CI3 §5: ledger strict schema 전건 LEDGER_CORRUPT_HOLD + seq 주입 불가", () => {
  const rej = (recs) => assert.throws(() => ledgerSummary(recs), /LEDGER_CORRUPT_HOLD/);
  rej([{ seq: 0, type: "recovery", calls: 1, inputTokens: 1, outputTokens: 1 }, { seq: 5, type: "reserve", callId: "a", estInput: 1, maxOutput: 1 }]); // 비연속 seq
  rej([{ seq: 0, type: "bogus" }]); // unknown type
  rej([{ seq: 0, type: "recovery", calls: -1, inputTokens: 1, outputTokens: 1 }]); // 음수
  rej([{ seq: "0", type: "recovery", calls: 1, inputTokens: 1, outputTokens: 1 }]); // 문자열 seq
  rej([{ seq: 0, type: "reserve", callId: "a", estInput: 1, maxOutput: 1 }, { seq: 1, type: "recovery", calls: 1, inputTokens: 1, outputTokens: 1 }]); // recovery seq!=0
  rej([{ seq: 0, type: "settle", callId: "x", inputTokens: 1, outputTokens: 1 }]); // 고아 settle
  rej([{ seq: 0, type: "reserve", callId: "a", estInput: 1, maxOutput: 1 }, { seq: 1, type: "settle", callId: "a", inputTokens: 1, outputTokens: 1 }, { seq: 2, type: "settle", callId: "a", inputTokens: 1, outputTokens: 1 }]); // 중복 settle
  rej([{ seq: 0, type: "settle", callId: "a", inputTokens: 1.5, outputTokens: 1 }]); // 소수
  // seq 주입 불가
  const led = createInMemoryLedger();
  const r = led.append({ type: "reserve", callId: "a", estInput: 1, maxOutput: 1, seq: 999 });
  assert.equal(r.seq, 0); assert.deepEqual(led.read().map((x) => x.seq), [0]);
});

test("D1CI3 §5: provider throw/usage invalid → 정확히 1회 후 즉시 중단, 미정산, 다음 0", async () => {
  const V = versionsForD1c();
  const B = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 172800, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
  const common = { versions: V, operatorGroupOf: () => "g", originDocumentIdOf: () => "d", budget: B, now: () => 0 };
  let c = 0; const throwM = async () => { c += 1; throw new Error("boom"); };
  const led = createInMemoryLedger();
  const r = await runPricedClassification({ items: [mkItem("a", "제목입니다"), mkItem("b", "제목입니다")], callModel: throwM, ...common, ledger: led, attemptId: "t", phase: "canary" });
  assert.equal(c, 1); assert.equal(r.stats.aborted, true); assert.equal(led.summary().unsettledReserves, 1);
  let c2 = 0; const badU = async () => { c2 += 1; return { semantic: {}, usage: { inputTokens: 1.5, outputTokens: 5 } }; }; // 소수 usage
  const led2 = createInMemoryLedger();
  const r2 = await runPricedClassification({ items: [mkItem("c", "제목입니다"), mkItem("d", "제목입니다")], callModel: badU, ...common, ledger: led2, attemptId: "t2", phase: "canary" });
  assert.equal(c2, 1); assert.equal(r2.stats.aborted, true); assert.equal(led2.summary().unsettledReserves, 1);
});

test("provider 400을 명시적으로 취소 처리하면 해당 항목만 보류하고 배치를 계속한다", async () => {
  const V = versionsForD1c();
  const B = { maxCalls: 4, maxInputTokens: 400000, maxOutputTokens: 7200, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
  let calls = 0;
  const goodModel = okModel({ accept: ["business"] });
  const model = async (args) => {
    calls += 1;
    if (calls === 1) {
      const error = new Error("api 400 invalid_request_error");
      error.providerMessage = "workspace spend limit reached";
      error.requestId = "req_provider_400";
      throw error;
    }
    return goodModel(args);
  };
  const ledger = createInMemoryLedger();
  const result = await runPricedClassification({
    items: [mkItem("bad", "첫 기사입니다"), mkItem("good", "둘째 기사입니다")],
    callModel: model,
    versions: V,
    operatorGroupOf: () => "g",
    originDocumentIdOf: () => "d",
    budget: B,
    ledger,
    attemptId: "batch",
    phase: "full",
    now: () => 0,
    onProviderError: ({ error }) => error.message === "api 400 invalid_request_error" ? "withhold" : "abort"
  });

  assert.equal(calls, 2);
  assert.equal(result.stats.aborted, undefined);
  assert.deepEqual(result.results.map((row) => [row.itemId, row.status]), [["bad", "withheld"], ["good", "classified"]]);
  assert.equal(result.results[0].reason, "provider_rejected");
  assert.equal(result.stats.providerDiagnostic, "workspace spend limit reached");
  assert.equal(result.stats.providerRequestId, "req_provider_400");
  assert.equal(ledger.summary().unsettledReserves, 0);
  assert.equal(ledger.summary().calls, 2);
  assert.equal(ledger.read().filter((row) => row.type === "cancel").length, 1);
});

test("D1CI3 §4/§6: stepRunModel sealed/absent/lock/attemptId (getApiKey 0 on HOLD, 산출물 attemptDir만)", async () => {
  let spy = 0; const gk = () => { spy += 1; return null; };
  assert.equal((await stepRunModel({ getApiKey: gk })).status, "D1C_CONSUMED_DIAGNOSTIC_HOLD"); // 기본 sealed
  assert.equal(spy, 0);
  const tled = path.join(tmpdir(), "led3-" + process.pid + ".jsonl");
  writeFileSync(tled, JSON.stringify({ seq: 0, type: "recovery", calls: 0, inputTokens: 0, outputTokens: 0 }) + "\n"); // 예산 남김 → MODEL_KEY_MISSING 경로 검증
  const t = mkdtempSync(path.join(tmpdir(), "d1ci3-"));
  assert.equal((await stepRunModel({ dir: t, getApiKey: gk, lockPath: path.join(tmpdir(), "lk3a-" + process.pid), ledgerPath: tled })).status, "PRECONDITION_HOLD"); // attemptId 없음
  assert.equal(spy, 0);
  const lk = path.join(tmpdir(), "lk3b-" + process.pid); writeFileSync(lk, "held\n");
  const t2 = mkdtempSync(path.join(tmpdir(), "d1ci3b-"));
  assert.equal((await stepRunModel({ dir: t2, attemptId: "z1", getApiKey: gk, lockPath: lk, ledgerPath: tled,
    callModelFactory: () => { throw new Error("fake model must not run"); }, allowNonRunnableCandidateForTest: true })).status, "RUN_IN_PROGRESS_HOLD"); // 동시 lock
  assert.equal(spy, 0);
  const t3 = mkdtempSync(path.join(tmpdir(), "d1ci3c-")); const lk3 = path.join(tmpdir(), "lk3c-" + process.pid);
  const r4 = await stepRunModel({ dir: t3, attemptId: "z2", getApiKey: gk, lockPath: lk3, ledgerPath: tled,
    callModelFactory: () => { throw new Error("fake model must not run"); }, allowNonRunnableCandidateForTest: true }); // absent + preflight 통과 → key
  assert.equal(r4.status, "MODEL_KEY_MISSING"); assert.equal(spy, 1);
  assert.equal(existsSync(lk3), false); // controlled cleanup
  assert.equal(existsSync(path.join(t3, "preflight.json")), true); // attemptDir에만
  rmSync(t, { recursive: true }); rmSync(t2, { recursive: true }); rmSync(t3, { recursive: true }); rmSync(tled); rmSync(lk);
});

test("D1CI3 §5/§8: corrupt file ledger throw + 기존 consumed 3파일·ledger recovery 정확값", () => {
  const bad = path.join(tmpdir(), "badled-" + process.pid + ".jsonl");
  writeFileSync(bad, JSON.stringify({ seq: 0, type: "bogus" }) + "\n");
  assert.throws(() => createFileLedger(bad).summary(), /LEDGER_CORRUPT_HOLD/);
  rmSync(bad);
  const dir = path.join(HERE, "..", ".nowhot-local", "selection-d1c");
  for (const [n, e] of Object.entries(CONSUMED_ARTIFACT_SHA)) assert.equal(createHash("sha256").update(readFileSync(path.join(dir, n))).digest("hex"), e);
  const led = readFileSync(path.join(HERE, "..", ".nowhot-local", "selection-d1c-integrity", "usage-ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sum = ledgerSummary(led);
  assert.equal(sum.calls, 12); assert.equal(sum.inputTokens, 20022); assert.equal(sum.outputTokens, 7527); assert.equal(sum.costUsd, 0.057657);
});

// ── D1-C INTEGRITY-04 (DEVCHG-122): 121이 미완성으로 남긴 3개 결함 RED→GREEN ──
test("D1CI4 §A: file ledger seq 강제(주입 무시) + malformed 원장 append reject(원본 바이트 불변)", () => {
  const tf = path.join(tmpdir(), "d1ci4a-" + process.pid + ".jsonl");
  writeFileSync(tf, JSON.stringify({ seq: 0, type: "recovery", calls: 0, inputTokens: 0, outputTokens: 0 }) + "\n");
  const r = createFileLedger(tf).append({ type: "reserve", callId: "a", estInput: 1, maxOutput: 1, seq: 999 });
  assert.equal(r.seq, 1); assert.equal(createFileLedger(tf).read().slice(-1)[0].seq, 1);
  rmSync(tf);
  const bad = path.join(tmpdir(), "d1ci4b-" + process.pid + ".jsonl"); writeFileSync(bad, "{not valid json\n");
  const s0 = createHash("sha256").update(readFileSync(bad)).digest("hex");
  assert.throws(() => createFileLedger(bad).append({ type: "reserve", callId: "x", estInput: 1, maxOutput: 1 }), /LEDGER_CORRUPT_HOLD/);
  assert.equal(createHash("sha256").update(readFileSync(bad)).digest("hex"), s0); // 원본 불변
  rmSync(bad);
});

test("D1CI4 §B: BUDGET_PRECONDITION_HOLD(key/provider/write 0) vs MODEL_KEY_MISSING 분리", async () => {
  let spy = 0; const gk = () => { spy += 1; return null; };
  const realLedger = path.join(HERE, "..", ".nowhot-local", "selection-d1c-integrity", "usage-ledger.jsonl"); // calls=12
  const t = mkdtempSync(path.join(tmpdir(), "d1ci4c-")); const lk = path.join(tmpdir(), "lk4c-" + process.pid);
  const rb = await stepRunModel({ dir: t, attemptId: "c1", getApiKey: gk, lockPath: lk, ledgerPath: realLedger,
    callModelFactory: () => { throw new Error("fake model must not run"); }, allowNonRunnableCandidateForTest: true });
  assert.equal(rb.status, "BUDGET_PRECONDITION_HOLD"); assert.equal(spy, 0); assert.equal(existsSync(path.join(t, "preflight.json")), false); // write 0
  const tled0 = path.join(tmpdir(), "led4-" + process.pid + ".jsonl"); writeFileSync(tled0, JSON.stringify({ seq: 0, type: "recovery", calls: 0, inputTokens: 0, outputTokens: 0 }) + "\n");
  const t2 = mkdtempSync(path.join(tmpdir(), "d1ci4d-")); const lk2 = path.join(tmpdir(), "lk4d-" + process.pid);
  const rk = await stepRunModel({ dir: t2, attemptId: "c2", getApiKey: gk, lockPath: lk2, ledgerPath: tled0,
    callModelFactory: () => { throw new Error("fake model must not run"); }, allowNonRunnableCandidateForTest: true });
  assert.equal(rk.status, "MODEL_KEY_MISSING"); assert.equal(spy, 1);
  rmSync(t, { recursive: true }); rmSync(t2, { recursive: true }); rmSync(tled0);
});

test("D1CI4 §C: provider throw/invalid → stats lifetime == 마지막 ledger summary(미정산 estimated 포함)", async () => {
  const V = versionsForD1c();
  const Bd = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 172800, maxOutputTokensPerCall: 1800, maxCostUsd: 1.25, perCallTimeoutMs: 1000, totalDeadlineMs: 1e9 };
  const common = { versions: V, operatorGroupOf: () => "g", originDocumentIdOf: () => "d", budget: Bd, now: () => 0 };
  let c = 0; const throwM = async () => { c += 1; throw new Error("x"); };
  const led = createInMemoryLedger();
  const r = await runPricedClassification({ items: [mkItem("a", "제목입니다"), mkItem("b", "제목입니다")], callModel: throwM, ...common, ledger: led, attemptId: "t", phase: "canary" });
  assert.equal(c, 1); assert.equal(r.stats.aborted, true); assert.equal(r.stats.unsettledReserves, 1);
  const sum = led.summary();
  assert.equal(r.stats.lifetimeCalls, sum.calls); assert.equal(r.stats.lifetimeInputTokens, sum.inputTokens);
  assert.equal(r.stats.lifetimeOutputTokens, sum.outputTokens); assert.equal(r.stats.lifetimeCostUsd, sum.costUsd);
  assert.ok(sum.inputTokens > 0 && r.stats.lifetimeInputTokens > 0); // 미정산 estimated 포함(0 축소 금지)
});
