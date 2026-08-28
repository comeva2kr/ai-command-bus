// NOWHOT D1-G — validator v3 반례 + FINAL CLOSURE P1 반례(실API 없음).
// P1-4: .nowhot-local 의존 금지 — 커밋되는 test/fixtures만 읽는 자급 빌더로 구성(깨끗한 환경에서도 통과).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateClassifierOutput, evidenceHashOf, loadAdversarialAuthority } from "../src/feed/selection-classifier-lab.js";
import { canaryItemIds, d1gCanaryItems } from "../tools/run-selection-d1c.mjs";
import { rescoreD1g } from "../tools/rescore-selection-d1g.mjs";
import { CANDIDATE_REGISTRY, CANDIDATE_REGISTRY_DOCUMENT, P31_SYSTEM, parseCandidateRegistry } from "../tools/selection-candidate-registry.mjs";
const CAND = CANDIDATE_REGISTRY["p3.1-haiku"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFix = (n) => JSON.parse(readFileSync(path.join(HERE, "fixtures", n), "utf8"));
const CORPUS = readFix("selection-d1-corpus.json");
const GATES = readFix("selection-d1-gates.lock.json");
const AUTH_DOC = readFix("selection-d1g-adversarial-authority-002.json");
const V = { modelVersion: "m", promptVersion: "p", taxonomyVersion: "t" };

// 자급 분류 빌더(P1-4): 커밋 fixture의 taxonomy로 14행 전수 — sealed 산출물 미의존.
function mkCls(item, o = {}) {
  const title = item.title || "x"; const span = title.slice(0, Math.min(6, title.length)) || "x";
  const acceptSet = new Set(o.accept || []);
  const rows = GATES.categories.map((c) => (acceptSet.has(c)
    ? { category: c, decision: "accept", confidence: 0.9, evidenceSpans: [span], reasonCodes: ["semantic-topic"] }
    : { category: c, decision: "reject", confidence: 0.1, evidenceSpans: [], reasonCodes: [] }));
  const scope = o.scope || "unknown";
  const geo = scope === "domestic" ? { eventJurisdictions: ["KR"], relevanceCountries: ["KR"] }
    : scope === "international" ? { eventJurisdictions: ["US"], relevanceCountries: ["KR", "US"] }
    : scope === "global" ? { eventJurisdictions: ["US"], relevanceCountries: ["US"] }
    : { eventJurisdictions: [], relevanceCountries: [] };
  const hasEvj = geo.eventJurisdictions.length > 0;
  return { contentType: o.contentType || "news", primaryCategory: o.primary || (o.accept && o.accept[0]) || "unknown",
    descriptiveSecondaryCategories: o.secondary || [], admissionCategories: rows,
    modelVersion: V.modelVersion, promptVersion: V.promptVersion, taxonomyVersion: V.taxonomyVersion,
    evidenceHash: evidenceHashOf(item), sourceCountry: "KR", language: "ko", ...geo,
    scopeClass: scope, geoConfidence: hasEvj ? 0.7 : 0, geoEvidenceSpans: hasEvj ? [span] : [],
    operatorGroup: "o", originDocumentId: "d", claimOriginGroup: "o" };
}
const baseRow = CORPUS.rows.find((r) => r.blindItemId === "d1a-01-food-as-politics");
const baseInput = { title: baseRow.title, excerpt: baseRow.excerpt };
const baseCls = () => mkCls(baseInput, { accept: ["life"], primary: "life", contentType: "community", scope: "unknown" });

// ── validator v3(정본 재사용) 반례 ───────────────────────────────────────────
test("D1G: 자급 기준선 분류는 유효(수리가 정상 출력을 깨지 않음)", () => {
  assert.equal(validateClassifierOutput(baseCls(), baseInput, V).ok, true);
});

test("D1G: admission 13행(누락) fail-closed", () => {
  const c = baseCls(); c.admissionCategories = c.admissionCategories.slice(0, 13);
  const v = validateClassifierOutput(c, baseInput, V);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("admission_rows_not_exact_taxonomy")));
});

test("D1G: 14행이지만 중복+누락(치환) fail-closed", () => {
  const c = baseCls(); c.admissionCategories[13] = structuredClone(c.admissionCategories[0]);
  const v = validateClassifierOutput(c, baseInput, V);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("admission_rows_not_exact_taxonomy")));
});

test("D1G: 15행(잉여) fail-closed", () => {
  const c = baseCls(); c.admissionCategories = [...c.admissionCategories, structuredClone(c.admissionCategories[0])];
  assert.equal(validateClassifierOutput(c, baseInput, V).ok, false);
});

test("D1G: accept∩descriptiveSecondary fail-closed·비accept secondary는 허용", () => {
  const bad = baseCls(); bad.descriptiveSecondaryCategories = ["life"]; // life=accept
  const v = validateClassifierOutput(bad, baseInput, V);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("accepted_secondary_overlap")));
  const ok = baseCls(); ok.descriptiveSecondaryCategories = ["tech"]; // tech=reject 행 → 정당
  assert.equal(validateClassifierOutput(ok, baseInput, V).ok, true);
});

// ── P1-1: canary 입력 단일화 ─────────────────────────────────────────────────
test("D1G-P1-1: canary = authority decisive 10 + mutation 2 (감사용 제외·대체 포함)", () => {
  const ids = canaryItemIds(CORPUS);
  assert.equal(ids.length, 12);
  assert.ok(ids.includes("d1g-11-clear-secondary-politics"));
  assert.ok(ids.includes("d1g-12-clear-product-launch"));
  assert.ok(!ids.includes("d1a-07-secondary-only-admission"));
  assert.ok(!ids.includes("d1a-10-same-structure-diff-meaning"));
  assert.ok(ids.includes("d1m-01a") && ids.includes("d1m-01b"));
  const items = d1gCanaryItems(CORPUS);
  assert.deepEqual(items.map((i) => i.blindItemId), ids);
  for (const it of items) { // 대체 반례 포함 전 항목이 호출 가능한 완전한 blind 필드를 가진다
    for (const f of ["title", "excerpt", "sourceCountry", "language", "contentKindHint"]) assert.ok(it[f], `${it.blindItemId}.${f}`);
  }
});

// ── P1-3: authority 전체 스키마 fail-closed (Codex 주입 공격 재현 포함) ───────
test("D1G-P1-3: authority 스키마 공격 전부 거부", () => {
  const ok = loadAdversarialAuthority(AUTH_DOC, { corpusRows: CORPUS.rows });
  assert.equal(ok.byId.size, 10); assert.equal(ok.auditAmbiguous.size, 2);
  const attacks = [
    ["미등록 rejected(Codex)", (d) => { d.decisiveItems[0].expected.rejectedCategories = ["not-a-category"]; }],
    ["문자열 secondary(Codex)", (d) => { d.decisiveItems[0].expected.secondaryCategories = "politics"; }],
    ["accepted 중복", (d) => { d.decisiveItems[0].expected.acceptedCategories = ["life", "life"]; }],
    ["accepted∩rejected", (d) => { d.decisiveItems[0].expected.rejectedCategories = [d.decisiveItems[0].expected.acceptedCategories[0]]; }],
    ["accepted∩secondary", (d) => { d.decisiveItems[0].expected.secondaryCategories = [d.decisiveItems[0].expected.acceptedCategories[0]]; }],
    ["decisive=audit 겹침", (d) => { d.auditAmbiguousItems.push({ blindItemId: d.decisiveItems[0].blindItemId }); }],
    ["replacement title 누락", (d) => { delete d.decisiveItems.find((x) => x.source === "replacement_fixture").title; }],
    ["잘못된 contract id", (d) => { d.contract = "WRONG"; }],
    ["decisive 9건", (d) => { d.decisiveItems = d.decisiveItems.slice(0, 9); }]
  ];
  for (const [name, mut] of attacks) {
    const c = structuredClone(AUTH_DOC); mut(c);
    assert.throws(() => loadAdversarialAuthority(c, { corpusRows: CORPUS.rows }), /CORRUPT_EVAL_DATA/, name);
  }
});

// ── P1-2: rescore 실제 점수·실패항목·게이트 판정 (주입 offline, sealed 미의존) ──
function predsFor(mutator = null) {
  const items = d1gCanaryItems(CORPUS);
  const byId = new Map(AUTH_DOC.decisiveItems.map((d) => [d.blindItemId, d]));
  const results = items.map((it) => {
    const d = byId.get(it.blindItemId);
    const input = { title: it.title, excerpt: it.excerpt };
    if (d) return { itemId: it.blindItemId, status: "classified", classification: mkCls(input, { accept: [...d.expected.acceptedCategories], primary: d.expected.acceptedCategories[0] || "unknown", contentType: d.expected.contentType, scope: d.expected.scope }) };
    // mutation 쌍: semantic pair가 라벨이 달라지도록 구성(01a=business, 01b=politics)
    return { itemId: it.blindItemId, status: "classified", classification: mkCls(input, { accept: [it.blindItemId.endsWith("a") ? "business" : "politics"], primary: it.blindItemId.endsWith("a") ? "business" : "politics", contentType: "news", scope: "unknown" }) };
  });
  if (mutator) mutator(results);
  return { versions: V, results };
}

test("D1G-P1-2: decisive 10 전건 예측이면 COMPLETE — 공용 게이트 판정·wholeRow·실패항목", () => {
  const perfect = predsFor();
  const r = rescoreD1g({ predsByRun: { synthetic: perfect } });
  assert.equal(r.status, "COMPLETE");
  assert.equal(r.runs.synthetic.wholeRow, "10/10");
  assert.equal(r.runs.synthetic.categoryAdmission.exact, "10/10");
  assert.equal(r.runs.synthetic.scope.exact, "10/10");
  assert.equal(r.runs.synthetic.candidateState, "FULL_CONTRACT_PASS");
  assert.deepEqual(r.runs.synthetic.failures, []);
  assert.equal(r.runs.synthetic.gate.pass, true); // adversarial 10/10 + mutation labelChanged
  assert.equal(r.runs.synthetic.gate.mutationLabelChanged, true);
});

test("D1H: 지역성만 틀리면 카테고리 선별 PASS와 지역성 HOLD를 분리 보고", () => {
  const scopeWrong = predsFor((results) => {
    const target = results.find((x) => x.itemId === "d1a-01-food-as-politics");
    const item = d1gCanaryItems(CORPUS).find((x) => x.blindItemId === target.itemId);
    target.classification = mkCls(item, { accept: ["life"], primary: "life", contentType: "community", scope: "domestic" });
  });
  const r = rescoreD1g({ predsByRun: { synthetic: scopeWrong } });
  assert.equal(r.runs.synthetic.categoryAdmission.exact, "10/10");
  assert.equal(r.runs.synthetic.categoryAdmission.pass, true);
  assert.equal(r.runs.synthetic.scope.exact, "9/10");
  assert.equal(r.runs.synthetic.scope.pass, false);
  assert.equal(r.runs.synthetic.wholeRow, "9/10");
  assert.equal(r.runs.synthetic.candidateState, "CATEGORY_PASS_SCOPE_HOLD");
  assert.equal(r.runs.synthetic.gate.pass, false); // historical combined gate remains fail-closed
});

test("D1G-P1-2: 오답 1건은 실패항목·게이트 FAIL로 정직 보고", () => {
  const oneWrong = predsFor((results) => {
    const t = results.find((x) => x.itemId === "d1g-12-clear-product-launch");
    t.classification = mkCls({ title: t.classification ? d1gCanaryItems(CORPUS).find((i) => i.blindItemId === t.itemId).title : "x", excerpt: d1gCanaryItems(CORPUS).find((i) => i.blindItemId === t.itemId).excerpt }, { accept: ["business"], primary: "business", contentType: "news", scope: "global" });
  });
  const r = rescoreD1g({ predsByRun: { synthetic: oneWrong } });
  assert.equal(r.status, "COMPLETE");
  assert.equal(r.runs.synthetic.wholeRow, "9/10");
  assert.equal(r.runs.synthetic.categoryAdmission.exact, "9/10");
  assert.equal(r.runs.synthetic.scope.exact, "10/10");
  assert.equal(r.runs.synthetic.candidateState, "CATEGORY_HOLD");
  assert.equal(r.runs.synthetic.failures.length, 1);
  assert.equal(r.runs.synthetic.failures[0].itemId, "d1g-12-clear-product-launch");
  assert.equal(r.runs.synthetic.gate.pass, false);
});

test("D1G-P1-2: 대체 반례 예측 부재면 점수·순위 없이 HOLD", () => {
  const missing = predsFor((results) => {
    const i = results.findIndex((x) => x.itemId === "d1g-11-clear-secondary-politics");
    results[i] = { itemId: "d1g-11-clear-secondary-politics", status: "error" };
  });
  const r = rescoreD1g({ predsByRun: { synthetic: missing } });
  assert.equal(r.status, "INCOMPLETE_NEW_FIXTURE_PREDICTIONS");
  assert.equal(r.holds, true);
  assert.equal(r.runs, undefined); // 부분 점수·순위 미산출
});

// ── 재검수 P1: 평가 집합 단일 함수 + stepRunModel 전 경로(E2E, 가짜 모델·임시 디렉터리) ──
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { d1gEvaluationSet, stepRunModel } from "../tools/run-selection-d1c.mjs";

const GOLD = readFix("selection-d1-gold.json");

test("D1G-재검수: d1gEvaluationSet — 정확히 96 = canary 12 + rest 84, 감사 제외·대체 포함", () => {
  const s = d1gEvaluationSet(CORPUS);
  assert.equal(s.canaryItems.length, 12);
  assert.equal(s.restItems.length, 84);
  assert.equal(s.allItems.length, 96);
  assert.deepEqual(s.auditExcluded, ["d1a-07-secondary-only-admission", "d1a-10-same-structure-diff-meaning"]);
  const allIds = new Set(s.allItems.map((i) => i.blindItemId));
  assert.ok(!allIds.has("d1a-07-secondary-only-admission") && !allIds.has("d1a-10-same-structure-diff-meaning"));
  assert.ok(allIds.has("d1g-11-clear-secondary-politics") && allIds.has("d1g-12-clear-product-launch"));
  assert.equal(new Set(s.allItems.map((i) => i.blindItemId)).size, 96); // 중복 없음
});

// 가짜 모델: authority 정답을 semantic으로 반환(제목으로 항목 식별). 네트워크 0.
function fakeCallModelFactory(callLog) {
  const expByTitle = new Map(AUTH_DOC.decisiveItems.map((d) => {
    const src = d.source === "corpus" ? CORPUS.rows.find((r) => r.blindItemId === d.blindItemId) : d;
    return [src.title, { d, src }];
  }));
  const mutByTitle = new Map(CORPUS.rows.filter((r) => r.origin === "mutation_fixture").map((r) => [r.title, r]));
  return (_apiKey, resolvedModels, candidateDef) => { if (resolvedModels && candidateDef) resolvedModels.add(candidateDef.requestedModel); return async ({ request }) => {
    const title = request.title || ""; const span = title.slice(0, Math.min(4, title.length)) || "x";
    const hit = expByTitle.get(title);
    let accept, contentType, scope, secondary = [];
    if (hit) {
      accept = [...hit.d.expected.acceptedCategories]; contentType = hit.d.expected.contentType;
      scope = hit.d.expected.scope; secondary = [...(hit.d.expected.secondaryCategories || [])];
      callLog.push(hit.d.blindItemId);
    } else {
      const mut = mutByTitle.get(title);
      if (mut && mut.mutationPairId === "m01") { accept = [mut.mutationRole === "original" ? "business" : "politics"]; }
      else accept = ["business"];
      contentType = "news"; scope = "unknown";
      callLog.push(mut ? mut.blindItemId : `real:${title.slice(0, 10)}`);
    }
    const geo = scope === "domestic" ? { eventJurisdictions: ["KR"], relevanceCountries: ["KR"] }
      : scope === "global" ? { eventJurisdictions: ["US"], relevanceCountries: ["US"] }
      : { eventJurisdictions: [], relevanceCountries: [] };
    const rows = GATES.categories.map((c) => (accept.includes(c)
      ? { category: c, decision: "accept", confidence: 0.9, evidenceSpans: [span], reasonCodes: ["semantic-topic"] }
      : { category: c, decision: "reject", confidence: 0.1, evidenceSpans: [], reasonCodes: [] }));
    const semantic = { contentType, primaryCategory: accept[0] || "unknown", descriptiveSecondaryCategories: secondary,
      admissionCategories: rows, ...geo, geoEvidenceSpans: geo.eventJurisdictions.length ? [span] : [] };
    return { semantic, usage: { inputTokens: 100, outputTokens: 50 } };
  }; };
}
// 깨끗한 checkout에서도 통과: computeBaseline은 .nowhot-local snapshot을 읽으므로,
// E2E는 커밋된 legacy baseline lock에서 파생한 스텁을 주입한다(실경로 기본값은 불변).
const LEGACY_LOCK = readFix("selection-d1-legacy-baseline.lock.json");
const baselineStub = () => ({ baseline: { categories: Object.keys(LEGACY_LOCK.perCategory), perCategory: LEGACY_LOCK.perCategory,
  eligibleCount: LEGACY_LOCK.eligibleCount, totalQualifiedSupply: LEGACY_LOCK.totalQualifiedSupply } });

test("D1G-재검수 E2E(full, 명시 승인): canary 12 → full 96, 정확한 ID·상태·캐시 적중 고정", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1g-e2e-"));
  try {
    const attemptDir = path.join(tmp, "attempt");
    const ledgerPath = path.join(tmp, "ledger.jsonl"); writeFileSync(ledgerPath, "");
    const lockPath = path.join(tmp, "run.lock");
    const callLog = [];
    const res = await stepRunModel({ dir: attemptDir, ledgerPath, lockPath, attemptId: "d1g-e2e-01",
      getApiKey: () => "fake-key-offline", callModelFactory: fakeCallModelFactory(callLog),
      mode: "full", fullApproved: true, computeBaselineImpl: baselineStub, baselineDriftImpl: () => [],
      candidateDef: CAND, allowNonRunnableCandidateForTest: true });
    assert.equal(res.status, "measured", JSON.stringify(res).slice(0, 300));
    // canary 선두 12콜 = decisive 10(대체 2 포함) + mutation 2, 감사용 0
    const first12 = callLog.slice(0, 12);
    assert.ok(first12.includes("d1g-11-clear-secondary-politics"));
    assert.ok(first12.includes("d1g-12-clear-product-launch"));
    assert.ok(first12.includes("d1m-01a") && first12.includes("d1m-01b"));
    assert.ok(!callLog.includes("d1a-07-secondary-only-admission"));
    assert.ok(!callLog.includes("d1a-10-same-structure-diff-meaning"));
    for (const d of AUTH_DOC.decisiveItems) assert.ok(callLog.includes(d.blindItemId), `decisive called: ${d.blindItemId}`);
    // 재검수 P2: 느슨한 94~96 대신 정확 고정 — d1m-04b만 캐시 적중(정규화 키 동일 + 원문 grounding 재검증 통과;
    // d1m-03b는 키는 같지만 03a 스팬이 03b 원문에 grounding 실패 → 정직한 재호출). provider 호출 = 95.
    assert.equal(callLog.length, 95, `calls ${callLog.length}`);
    for (const f of ["preflight.json", "canary-predictions.json", "full-predictions.json", "evaluation.json", "run-receipt.json", "attempt-manifest.json"]) {
      assert.ok(existsSync(path.join(attemptDir, f)), f);
    }
    const receipt = JSON.parse(readFileSync(path.join(attemptDir, "run-receipt.json"), "utf8"));
    assert.equal(receipt.canary.gate, true); // authority 정답이면 공용 게이트 PASS
    const fullPreds = JSON.parse(readFileSync(path.join(attemptDir, "full-predictions.json"), "utf8"));
    assert.equal(fullPreds.results.length, 96);
    const ids = fullPreds.results.map((r) => r.itemId);
    assert.equal(new Set(ids).size, 96); // ID 전건 고유
    assert.ok(fullPreds.results.every((r) => r.status === "classified" || r.status === "cache_hit")); // 전건 정상 상태
    assert.deepEqual(fullPreds.results.filter((r) => r.status === "cache_hit").map((r) => r.itemId), ["d1m-04b"]); // 정확한 캐시 대상
    assert.ok(ids.includes("d1g-11-clear-secondary-politics"));
    assert.ok(!ids.includes("d1a-07-secondary-only-admission"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1G-재검수 P1: canary_only — 정확히 12건 뒤 무조건 종료, full 미진입, manifest 기록", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1g-co-"));
  try {
    const attemptDir = path.join(tmp, "attempt");
    const ledgerPath = path.join(tmp, "ledger.jsonl"); writeFileSync(ledgerPath, "");
    const callLog = [];
    const res = await stepRunModel({ dir: attemptDir, ledgerPath, lockPath: path.join(tmp, "run.lock"), attemptId: "d1g-co-01",
      getApiKey: () => "fake-key-offline", callModelFactory: fakeCallModelFactory(callLog),
      mode: "canary_only", computeBaselineImpl: baselineStub, baselineDriftImpl: () => [],
      candidateDef: CAND, allowNonRunnableCandidateForTest: true });
    assert.equal(res.status, "D1C_CANARY_MEASURED");
    assert.equal(callLog.length, 12); // PASS여도 84건 미호출
    assert.ok(!existsSync(path.join(attemptDir, "full-predictions.json")));
    assert.ok(!existsSync(path.join(attemptDir, "evaluation.json")));
    const man = JSON.parse(readFileSync(path.join(attemptDir, "attempt-manifest.json"), "utf8"));
    assert.equal(man.contract, "NOWHOT-SELECTION-D1G-ATTEMPT-MANIFEST-002");
    assert.equal(man.attemptId, "d1g-co-01");
    assert.equal(man.candidateId, "p3.1-haiku");
    assert.equal(man.requestedModel, CAND.requestedModel);
    assert.equal(man.promptSha256, CAND.promptSha256); // 전체 SHA-256 = 레지스트리 정확 일치
    assert.equal(man.calls, 12); assert.equal(man.retries, 0); assert.equal(man.unsettledReserves, 0);
    assert.deepEqual(man.resolvedModels, [CAND.requestedModel]); // 실제 모델 정확 1개·요청 모델 일치
    for (const f of ["corpusSha256", "goldSha256", "gatesSha256", "authoritySha256", "predictionsSha256", "receiptSha256", "ledgerSha256"]) assert.match(man[f], /^[0-9a-f]{64}$/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1G-재검수 P1: full 모드도 fullApproved 미명시면 canary 후 차단(FULL_NOT_APPROVED_HOLD)", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1g-fa-"));
  try {
    const ledgerPath = path.join(tmp, "ledger.jsonl"); writeFileSync(ledgerPath, "");
    const callLog = [];
    const res = await stepRunModel({ dir: path.join(tmp, "attempt"), ledgerPath, lockPath: path.join(tmp, "run.lock"), attemptId: "d1g-fa-01",
      getApiKey: () => "fake-key-offline", callModelFactory: fakeCallModelFactory(callLog),
      mode: "full", computeBaselineImpl: baselineStub, baselineDriftImpl: () => [],
      candidateDef: CAND, allowNonRunnableCandidateForTest: true }); // fullApproved 생략 = 기본 false
    assert.equal(res.status, "FULL_NOT_APPROVED_HOLD");
    assert.equal(callLog.length, 12); // 84건 과금 차단
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1G-재검수 P1: rescore --attempt는 검증된 manifest 디렉터리만 — 실제 CLI subprocess 회귀", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1g-sub-"));
  try {
    const attemptDir = path.join(tmp, "attempt");
    const ledgerPath = path.join(attemptDir, "usage-ledger.jsonl");
    const callLog = [];
    // canary_only로 검증 가능한 attempt 생성(가짜 모델·API 0) — ledger는 attempt 디렉터리 안(manifest 대조 대상)
    const { mkdirSync } = await import("node:fs");
    mkdirSync(attemptDir, { recursive: true }); writeFileSync(ledgerPath, "");
    const res = await stepRunModel({ dir: attemptDir, ledgerPath, lockPath: path.join(tmp, "run.lock"), attemptId: "d1g-sub-01",
      getApiKey: () => "fake-key-offline", callModelFactory: fakeCallModelFactory(callLog),
      mode: "canary_only", computeBaselineImpl: baselineStub, baselineDriftImpl: () => [],
      candidateDef: CAND, allowNonRunnableCandidateForTest: true });
    assert.equal(res.status, "D1C_CANARY_MEASURED");
    // 실제 CLI subprocess: --attempt <이름>=<디렉터리> → COMPLETE·10/10 (주입이 아니라 진짜 실행 경로)
    const { execFileSync } = await import("node:child_process");
    const rescorePath = path.join(HERE, "..", "tools", "rescore-selection-d1g.mjs");
    const out = execFileSync(process.execPath, [rescorePath, "--attempt", `e2e=${attemptDir}`], { encoding: "utf8" });
    assert.match(out, /COMPLETE/);
    const report = JSON.parse(readFileSync(path.join(HERE, "..", ".nowhot-local", "selection-d1g", "rescore-authority-002.json"), "utf8"));
    assert.equal(report.runs.e2e.wholeRow, "10/10");
    assert.equal(report.runs.e2e.gate.pass, true);
    // 변조 거부: predictions 1바이트 변조 → RESCORE_ATTEMPT_CORRUPT (subprocess 비정상 종료)
    const pp = path.join(attemptDir, "canary-predictions.json");
    const orig = readFileSync(pp, "utf8");
    writeFileSync(pp, orig.replace("\"results\"", "\"results\" "));
    let threw = false;
    try { execFileSync(process.execPath, [rescorePath, "--attempt", `e2e=${attemptDir}`], { encoding: "utf8", stdio: "pipe" }); }
    catch (e) { threw = true; assert.match(String(e.stderr || e.message), /RESCORE_ATTEMPT_CORRUPT/); }
    assert.ok(threw, "변조 predictions가 통과하면 안 된다");
    // 기본(무 attempt) subprocess: sealed에 대체 반례가 없으므로 HOLD(exit 3)
    let code = 0;
    try { execFileSync(process.execPath, [rescorePath], { encoding: "utf8", stdio: "pipe" }); }
    catch (e) { code = e.status; }
    assert.equal(code, 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    // 기본 상태 report로 결정적 복원(sealed-only)
    const { execFileSync } = await import("node:child_process");
    try { execFileSync(process.execPath, [path.join(HERE, "..", "tools", "rescore-selection-d1g.mjs")], { stdio: "pipe" }); } catch { /* exit 3 정상 */ }
  }
});

test("D1G-재검수 P1: manifest 위조 거부 — 빈 디렉터리·retries·resolvedModels 변조", async () => {
  const { loadAttemptDir } = await import("../tools/rescore-selection-d1g.mjs");
  const tmp = mkdtempSync(path.join(tmpdir(), "d1g-forge-"));
  try {
    assert.throws(() => loadAttemptDir(tmp), /RESCORE_ATTEMPT_CORRUPT.*manifest/);
    // 정상 attempt 생성 후 manifest 필드 변조
    const attemptDir = path.join(tmp, "a");
    const ledgerPath = path.join(attemptDir, "usage-ledger.jsonl");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(attemptDir, { recursive: true }); writeFileSync(ledgerPath, "");
    await stepRunModel({ dir: attemptDir, ledgerPath, lockPath: path.join(tmp, "l"), attemptId: "d1g-forge-01",
      getApiKey: () => "k", callModelFactory: fakeCallModelFactory([]), mode: "canary_only",
      computeBaselineImpl: baselineStub, baselineDriftImpl: () => [], candidateDef: CAND, allowNonRunnableCandidateForTest: true });
    const mp = path.join(attemptDir, "attempt-manifest.json");
    const man = JSON.parse(readFileSync(mp, "utf8"));
    writeFileSync(mp, JSON.stringify({ ...man, retries: 1 }, null, 2));
    assert.throws(() => loadAttemptDir(attemptDir), /retries/);
    writeFileSync(mp, JSON.stringify({ ...man, resolvedModels: [] }, null, 2));
    assert.throws(() => loadAttemptDir(attemptDir), /resolvedModels/);
    writeFileSync(mp, JSON.stringify(man, null, 2) + "\n");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1G-재검수: rescore 혼합 — 완결 attempt만 점수화, 미완결은 INCOMPLETE 표기·순위 제외", () => {
  const perfect = predsFor();
  const missing = predsFor((results) => {
    const i = results.findIndex((x) => x.itemId === "d1g-11-clear-secondary-politics");
    results[i] = { itemId: "d1g-11-clear-secondary-politics", status: "error" };
  });
  const r = rescoreD1g({ predsByRun: { newAttempt: perfect, oldSealed: missing } });
  assert.equal(r.status, "COMPLETE");
  assert.ok(r.runs.newAttempt && r.runs.newAttempt.gate.pass === true);
  assert.equal(r.runs.oldSealed, undefined); // 부분 8건 점수 미산출
  assert.ok(r.incompleteRuns && r.incompleteRuns.oldSealed);
});

// ── 4차 재검수: 후보 레지스트리·모델 일치·출처 보존·별칭 위조 반례 ──────────
test("D1G-4차: p3.1 후보 — 최신 지역성 정본 정렬, 구 통화 일반규칙 제거", () => {
  assert.equal(CAND.candidateId, "p3.1-haiku");
  assert.equal(CAND.requestedModel, "claude-haiku-4-5-20251001");
  assert.equal(CAND.promptVersion, "nowhot-selection-d1g-p3.1");
  assert.match(CAND.promptSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual({ ...CAND.pricing }, { inputPerMTok: 1, outputPerMTok: 5 });
  assert.equal(CAND.execution.runnable, false);
  assert.equal(CAND.execution.state, "historical_hold");
  // 최신 정본 반영: unknown 결정적·뉴스/커뮤니티 통화 단독 금지·딜 한정 허용·일반어 금지
  assert.ok(P31_SYSTEM.includes("'unknown' is a VALID, DECISIVE answer"));
  assert.ok(P31_SYSTEM.includes("for NEWS and COMMUNITY items, a currency amount alone does NOT determine"));
  assert.ok(P31_SYSTEM.includes("for DEAL items only, retailer/platform names, currency amounts, and shipping terms"));
  assert.ok(P31_SYSTEM.includes("의원/여야/정치권"));
  // p3의 구 일반규칙(모든 항목에 통화=근거) 문구가 없어야 한다
  assert.ok(!P31_SYSTEM.includes("place/city names, government or institution names, retailer or\n  platform names, currency amounts, national laws or programs"));
});

test("D1H: 후보 정의는 JSON data-driven이고 불합격 후보는 실행 불가", () => {
  const loaderSource = readFileSync(path.join(HERE, "..", "tools", "selection-candidate-registry.mjs"), "utf8");
  assert.ok(!loaderSource.includes("GEO GROUNDING PROTOCOL"));
  assert.ok(!loaderSource.includes("claude-haiku-4-5-20251001"));
  assert.equal(CANDIDATE_REGISTRY_DOCUMENT.contract, "NOWHOT-SELECTION-CANDIDATE-REGISTRY-001");
  assert.equal(CANDIDATE_REGISTRY["p3.2-haiku"].execution.state, "diagnostic_hold");
  assert.equal(CANDIDATE_REGISTRY["p3.2-haiku"].independentEvidence, false);

  const badPrompt = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  badPrompt.prompts["p3.1"].systemLines[0] += " tampered";
  assert.throws(() => parseCandidateRegistry(badPrompt), /prompt SHA mismatch/);
  const badPricing = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  badPricing.models["haiku-4.5"].pricing.inputPerMTok = -1;
  assert.throws(() => parseCandidateRegistry(badPricing), /invalid pricing/);
  const fakeApproval = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  fakeApproval.candidates[0].execution.runnable = true;
  assert.throws(() => parseCandidateRegistry(fakeApproval), /not approved_canary/);
});

test("D1G-4차: loader — 모델 불일치·promptSha·pricing·미등록 후보·callId·별칭 위조 거부", async () => {
  const { loadAttemptDir } = await import("../tools/rescore-selection-d1g.mjs");
  const { mkdtempSync: mkd, writeFileSync: wf, rmSync: rmr, mkdirSync: mkdir2 } = await import("node:fs");
  const { tmpdir: td } = await import("node:os");
  const tmp = mkd(path.join(td(), "d1g-c4-"));
  try {
    const attemptDir = path.join(tmp, "a");
    const ledgerPath = path.join(attemptDir, "usage-ledger.jsonl");
    mkdir2(attemptDir, { recursive: true }); wf(ledgerPath, "");
    await stepRunModel({ dir: attemptDir, ledgerPath, lockPath: path.join(tmp, "l"), attemptId: "d1g-c4-01",
      getApiKey: () => "k", callModelFactory: fakeCallModelFactory([]), mode: "canary_only",
      computeBaselineImpl: baselineStub, baselineDriftImpl: () => [], candidateDef: CAND,
      allowNonRunnableCandidateForTest: true });
    const mp = path.join(attemptDir, "attempt-manifest.json");
    const man = JSON.parse(readFileSync(mp, "utf8"));
    const put = (m) => wf(mp, JSON.stringify(m, null, 2));
    // (a) 실제 모델 불일치 — Codex 반례: 요청 haiku인데 다른 모델 기록
    put({ ...man, resolvedModels: ["fake-e2e-model"] });
    assert.throws(() => loadAttemptDir(attemptDir), /alias와 불일치/);
    // (b) 실제 모델 2개
    put({ ...man, resolvedModels: [CAND.requestedModel, "another"] });
    assert.throws(() => loadAttemptDir(attemptDir), /정확히 1개/);
    // (c) promptSha256 변조(전체 SHA 대조)
    put({ ...man, promptSha256: man.promptSha256.replace(/^./, man.promptSha256[0] === "a" ? "b" : "a") });
    assert.throws(() => loadAttemptDir(attemptDir), /promptSha256/);
    // (d) pricing 변조
    put({ ...man, pricing: { inputPerMTok: 3, outputPerMTok: 15 } });
    assert.throws(() => loadAttemptDir(attemptDir), /pricing/);
    // (e) 미등록 후보
    put({ ...man, candidateId: "p9-unknown" });
    assert.throws(() => loadAttemptDir(attemptDir), /CANDIDATE_UNKNOWN|RESCORE_ATTEMPT_CORRUPT/);
    // (f) 다른 attempt의 ledger 짜깁기: callId prefix 불일치(ledger SHA는 manifest도 같이 위조했다고 가정)
    const forgedLedger = readFileSync(ledgerPath, "utf8").replaceAll("d1g-c4-01:", "other-attempt:");
    wf(ledgerPath, forgedLedger);
    const crypto2 = await import("node:crypto");
    put({ ...man, ledgerSha256: crypto2.createHash("sha256").update(forgedLedger).digest("hex") });
    assert.throws(() => loadAttemptDir(attemptDir), /callId/);
    // 복구 후 정상 통과 + (g) 별칭은 표시용 — 출처(provenance)가 점수에 보존된다
    wf(ledgerPath, forgedLedger.replaceAll("other-attempt:", "d1g-c4-01:"));
    put(man);
    const att = loadAttemptDir(attemptDir);
    assert.equal(att.provenance.candidateId, "p3.1-haiku");
    assert.equal(att.provenance.attemptId, "d1g-c4-01");
    assert.equal(att.provenance.resolvedModel, CAND.requestedModel);
    const r = rescoreD1g({ predsByRun: { "pretty-alias": att } });
    assert.equal(r.runs["pretty-alias"].provenance.attemptId, "d1g-c4-01"); // 별칭이 출처를 가리지 못한다
    assert.equal(r.runs["pretty-alias"].provenance.candidateId, "p3.1-haiku");
    assert.equal(r.runs["pretty-alias"].provenance.promptSha256, CAND.promptSha256);
  } finally { rmr(tmp, { recursive: true, force: true }); }
});

test("D1G-4차: --run-canary CLI — 후보 필수·전용 경로·기존 디렉터리 사전 중단(쓰기 0)", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdirSync: mkdir3, rmSync: rmr2, existsSync: ex } = await import("node:fs");
  const cli = path.join(HERE, "..", "tools", "run-selection-d1c.mjs");
  const run = (args) => { try { execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: "pipe" }); return { code: 0 }; } catch (e) { return { code: e.status, err: String(e.stderr || "") }; } };
  // 후보 미지정 → exit 2
  let r = run(["--run-canary", "test-nocand"]);
  assert.equal(r.code, 2); assert.match(r.err, /candidate-id/);
  // 미등록 후보 → exit 2
  r = run(["--run-canary", "test-badcand", "p9-unknown"]);
  assert.equal(r.code, 2); assert.match(r.err, /CANDIDATE_UNKNOWN/);
  // 등록돼도 HOLD인 후보는 유료 실행 불가, attempt 디렉터리도 만들지 않는다.
  const held = path.join(HERE, "..", ".nowhot-local", "selection-attempts", "test-held-candidate");
  rmr2(held, { recursive: true, force: true });
  r = run(["--run-canary", "test-held-candidate", "p3.2-haiku"]);
  assert.equal(r.code, 2); assert.match(r.err, /CANDIDATE_NOT_RUNNABLE/);
  assert.ok(!ex(held));
  // 기존 디렉터리 → 쓰기 전 중단
  const existing = path.join(HERE, "..", ".nowhot-local", "selection-attempts", "test-exists-hold");
  mkdir3(existing, { recursive: true });
  try {
    r = run(["--run-canary", "test-exists-hold", "p3.1-haiku"]);
    assert.equal(r.code, 2); assert.match(r.err, /ATTEMPT_DIR_EXISTS_HOLD/);
    assert.ok(!ex(path.join(existing, "usage-ledger.jsonl")), "중단 전 ledger가 생기면 안 된다");
  } finally { rmr2(existing, { recursive: true, force: true }); }
});

test("D1H: stepRunModel 직접 호출도 non-runnable 후보를 쓰기 전에 차단", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1h-direct-hold-"));
  try {
    const attemptDir = path.join(tmp, "attempt");
    const res = await stepRunModel({ dir: attemptDir, ledgerPath: path.join(tmp, "ledger.jsonl"),
      lockPath: path.join(tmp, "lock"), attemptId: "d1h-direct-hold", candidateDef: CAND });
    assert.equal(res.status, "CANDIDATE_NOT_RUNNABLE_HOLD");
    assert.ok(!existsSync(attemptDir));
    assert.ok(!existsSync(path.join(tmp, "ledger.jsonl")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1H: 테스트 우회 플래그만으로 production 모델 경로를 열 수 없다", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "d1h-bypass-hold-"));
  let keyReads = 0;
  try {
    const attemptDir = path.join(tmp, "attempt");
    const res = await stepRunModel({ dir: attemptDir, ledgerPath: path.join(tmp, "ledger.jsonl"),
      lockPath: path.join(tmp, "lock"), attemptId: "d1h-bypass-hold", candidateDef: CAND,
      getApiKey: () => { keyReads += 1; return "must-not-read"; }, allowNonRunnableCandidateForTest: true });
    assert.equal(res.status, "CANDIDATE_NOT_RUNNABLE_HOLD");
    assert.equal(keyReads, 0);
    assert.ok(!existsSync(attemptDir));
    assert.ok(!existsSync(path.join(tmp, "ledger.jsonl")));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("D1G-4차: 실패 종단은 terminal receipt — MODEL_KEY_MISSING에 manifest 없음", async () => {
  const { mkdtempSync: mkd2, writeFileSync: wf2, rmSync: rmr3, existsSync: ex2, mkdirSync: mkdir4 } = await import("node:fs");
  const { tmpdir: td2 } = await import("node:os");
  const tmp = mkd2(path.join(td2(), "d1g-term-"));
  try {
    const attemptDir = path.join(tmp, "a");
    const ledgerPath = path.join(attemptDir, "usage-ledger.jsonl");
    mkdir4(attemptDir, { recursive: true }); wf2(ledgerPath, "");
    const res = await stepRunModel({ dir: attemptDir, ledgerPath, lockPath: path.join(tmp, "l"), attemptId: "d1g-term-01",
      getApiKey: () => null, callModelFactory: fakeCallModelFactory([]), mode: "canary_only",
      computeBaselineImpl: baselineStub, baselineDriftImpl: () => [], candidateDef: CAND,
      allowNonRunnableCandidateForTest: true });
    assert.equal(res.status, "MODEL_KEY_MISSING");
    assert.ok(ex2(path.join(attemptDir, "terminal-receipt.json")), "terminal receipt 필요");
    assert.ok(!ex2(path.join(attemptDir, "attempt-manifest.json")), "실패 종단에 manifest 금지(정산 완료 전용)");
    const tr = JSON.parse(readFileSync(path.join(attemptDir, "terminal-receipt.json"), "utf8"));
    assert.equal(tr.status, "MODEL_KEY_MISSING"); assert.equal(tr.candidateId, "p3.1-haiku");
  } finally { rmr3(tmp, { recursive: true, force: true }); }
});
