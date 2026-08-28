// D0 freeze — semantic admission 계약(selection-contract.js) 단위 + 반례 동결.
// Codex D0 HOLD 수리 반영(단일 canonical gate·강화 스키마·엄격 precedence·
// unclassified 항상 withheld·union/withholding 순수 함수·baseline drift).
// 정본: WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//
// D0 범위: 계약(순수 함수)만. 랭킹·서빙·UI는 RUNTIME_NOT_WIRED — 거짓 PASS 금지.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SELECTION_CONTRACT, ADMISSION_CATEGORY_IDS, CONTENT_TYPES, ADMISSION_DECISIONS,
  SCOPE_CLASSES, EVIDENCE_PRECEDENCE, STAGE_STATES,
  validateClassificationSchema, admissionGate, admittedCategories, isAdmittedTo, isNonAdmittingPrimary,
  exposureViolations, admissionInvariantHolds, selectedByCategories, assembleUnion, fulfillmentFromDisplay, resolveEventEditorial,
  distinctClaimOriginGroups, hasPrimaryEvidence, sharedFactQualifies,
  resolveScopeClass, overseasWeightAllowed, precedenceRespected,
  degradedState, isNewsTrustEligible, contentTypeConfusionIsCritical
} from "../src/feed/selection-contract.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { compareToLock } from "../tools/freeze-selection-baseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(HERE, "fixtures", "selection-d0-counterexamples.json"), "utf8"));
const caseById = (id) => FIX.cases.find((c) => c.id === id);

// 스키마 완전 통과하는 기준 분류(모든 필수 필드 포함).
// v3: admissionCategories는 taxonomy 14종 정확히 1행씩(누락·잉여·중복 fail-closed).
const fullAdmissionRows = (acceptSet = new Set(["business"])) => ADMISSION_CATEGORY_IDS.map((c) => (acceptSet.has(c)
  ? { category: c, confidence: 0.9, decision: "accept", evidenceSpans: ["x"], reasonCodes: ["semantic-topic"] }
  : { category: c, confidence: 0.1, decision: "reject", evidenceSpans: [], reasonCodes: [] }));
const goodClassification = (over = {}) => ({
  contentType: "news",
  primaryCategory: "business",
  descriptiveSecondaryCategories: [],
  admissionCategories: fullAdmissionRows(),
  modelVersion: "m", promptVersion: "p", taxonomyVersion: "t", evidenceHash: "h",
  sourceCountry: "KR", language: "ko", eventJurisdictions: ["KR"], relevanceCountries: ["KR"],
  scopeClass: "domestic", geoConfidence: 0.7, geoEvidenceSpans: ["x"],
  operatorGroup: "outletA", originDocumentId: "d", claimOriginGroup: "outletA",
  ...over
});

// ── 계약 상수 ───────────────────────────────────────────────────────────────
test("계약: enum은 taxonomy 정본과 일치하고 runtime 미연결(v2)", () => {
  assert.deepEqual([...ADMISSION_CATEGORY_IDS], CATEGORIES.map((c) => c.id));
  assert.equal(SELECTION_CONTRACT.runtimeWired, false);
  assert.equal(SELECTION_CONTRACT.version, 3);
  assert.deepEqual([...CONTENT_TYPES], ["news", "community", "deal", "other"]);
  assert.deepEqual([...ADMISSION_DECISIONS], ["accept", "abstain", "reject"]);
  assert.deepEqual([...SCOPE_CLASSES], ["domestic", "international", "global", "cross_border", "unknown"]);
  assert.deepEqual([...STAGE_STATES], ["pass", "fail", "narrow"]);
  assert.deepEqual([...EVIDENCE_PRECEDENCE],
    ["source_item_eligibility", "event_category_admission", "editorial_claim_grounding"]);
});

// ── 스키마 검증 (강화) ───────────────────────────────────────────────────────
test("스키마: 모든 필수 필드(지역성·근거 기원 포함)를 갖춘 분류만 통과", () => {
  assert.equal(validateClassificationSchema(goodClassification()).ok, true);
  assert.equal(validateClassificationSchema(null).ok, false);
  assert.equal(validateClassificationSchema(goodClassification({ contentType: "bogus" })).ok, false);
  assert.equal(validateClassificationSchema(goodClassification({ primaryCategory: "notacat" })).ok, false);
  // 지역성·근거 기원 누락
  for (const f of ["sourceCountry", "language", "scopeClass", "geoConfidence", "operatorGroup", "originDocumentId", "claimOriginGroup"]) {
    const bad = goodClassification(); delete bad[f];
    assert.equal(validateClassificationSchema(bad).ok, false, `누락 ${f}`);
  }
  // 근거 없는데 scopeClass가 unknown이 아니면 거부(추측 금지)
  assert.equal(validateClassificationSchema(goodClassification({ eventJurisdictions: [], scopeClass: "domestic" })).ok, false);
});

test("스키마: accept 행은 비어 있지 않은 evidenceSpans·reasonCodes 요구 (수리 3)", () => {
  // v3: 14행 전수 유지한 채 business 행만 결함 주입
  const withBusinessRow = (row) => {
    const rows = fullAdmissionRows(new Set());
    rows[rows.findIndex((r) => r.category === "business")] = row;
    return rows;
  };
  assert.equal(validateClassificationSchema(goodClassification({
    admissionCategories: withBusinessRow({ category: "business", confidence: 0.9, decision: "accept", evidenceSpans: [], reasonCodes: ["y"] })
  })).ok, false);
  assert.equal(validateClassificationSchema(goodClassification({
    admissionCategories: withBusinessRow({ category: "business", confidence: 0.9, decision: "accept", evidenceSpans: ["x"], reasonCodes: [] })
  })).ok, false);
  // abstain/reject는 빈 배열 허용 (primary는 accept 없으므로 unknown이어야 gate 통과와 무관한 스키마만 검사)
  assert.equal(validateClassificationSchema(goodClassification({
    primaryCategory: "unknown",
    admissionCategories: withBusinessRow({ category: "business", confidence: 0.4, decision: "abstain", evidenceSpans: [], reasonCodes: [] })
  })).ok, true);
});

// ── 단일 canonical gate (수리 1·2) ───────────────────────────────────────────
test("canonical gate: 스키마 통과 분류만 admission 가능", () => {
  const bad = goodClassification({ evidenceHash: "" }); // 스키마 무효
  assert.equal(admissionGate(bad).blocked, "schema_invalid");
  assert.deepEqual(admittedCategories(bad), []);
});

test("canonical gate: contentType=other·primaryCategory=unknown은 accept 있어도 비승인", () => {
  const other = goodClassification({ contentType: "other" });
  assert.equal(admissionGate(other).blocked, "content_type_other");
  assert.deepEqual(admittedCategories(other), []);
  const unk = goodClassification({ primaryCategory: "unknown" });
  assert.equal(admissionGate(unk).blocked, "primary_unknown");
  assert.deepEqual(admittedCategories(unk), []);
});

test("admission: accept 행만 자격 — secondary·abstain·reject 불가", () => {
  const secondaryOnly = goodClassification({
    primaryCategory: "politics",
    descriptiveSecondaryCategories: ["business"],
    admissionCategories: fullAdmissionRows(new Set(["politics"])) // v3: 14행 유지, politics만 accept
  });
  assert.equal(isAdmittedTo(secondaryOnly, "business"), false);
  assert.equal(isAdmittedTo(secondaryOnly, "politics"), true);
  assert.equal(isNonAdmittingPrimary(goodClassification({ primaryCategory: "unknown" })), true);
});

// ── 근거 우선순위 (엄격, 수리 5) ─────────────────────────────────────────────
test("precedence: 모든 단계·enum 요구, 앞단 fail 뒤 fail 외 결과 금지", () => {
  assert.equal(precedenceRespected({ source_item_eligibility: "pass", event_category_admission: "pass", editorial_claim_grounding: "pass" }).ok, true);
  // 단계 누락 → 위반
  assert.equal(precedenceRespected({ source_item_eligibility: "pass", event_category_admission: "pass" }).ok, false);
  // 잘못된 상태값 → 위반
  assert.equal(precedenceRespected({ source_item_eligibility: "pass", event_category_admission: "maybe", editorial_claim_grounding: "pass" }).ok, false);
  // fail 뒤 pass → 위반
  assert.equal(precedenceRespected({ source_item_eligibility: "fail", event_category_admission: "pass", editorial_claim_grounding: "fail" }).ok, false);
  // fail 뒤 narrow → 위반(수리 5)
  assert.equal(precedenceRespected({ source_item_eligibility: "fail", event_category_admission: "narrow", editorial_claim_grounding: "fail" }).ok, false);
  // fail 뒤 fail만 → OK
  assert.equal(precedenceRespected({ source_item_eligibility: "fail", event_category_admission: "fail", editorial_claim_grounding: "fail" }).ok, true);
});

// ── 실패 상태 (수리 6: unclassified 항상 withheld) ───────────────────────────
test("degraded: 정상·장애 모두 unclassified는 항상 withheld", () => {
  const normal = degradedState({ surface: "live", classifierAvailable: true, hasVerifiedCache: true, hasVerifiedItem: true });
  assert.equal(normal.state, "normal");
  assert.equal(normal.withholdUnclassified, true); // 정상 상태에서도 true
  const outage = degradedState({ surface: "live", classifierAvailable: false, hasVerifiedCache: false, hasVerifiedItem: false });
  assert.equal(outage.withholdUnclassified, true);
  assert.equal(outage.useKeywordFallback, false);
});

// ── contentType 하드 게이트 ──────────────────────────────────────────────────
test("contentType: community→news / deal→news는 치명, 뉴스 신뢰는 news만", () => {
  assert.equal(isNewsTrustEligible(goodClassification({ contentType: "community" })), false);
  assert.equal(isNewsTrustEligible(goodClassification({ contentType: "news" })), true);
  assert.equal(contentTypeConfusionIsCritical("community", "news"), true);
  assert.equal(contentTypeConfusionIsCritical("deal", "news"), true);
  assert.equal(contentTypeConfusionIsCritical("news", "community"), false);
});

// ── union·withholding 순수 함수 (수리 8) ─────────────────────────────────────
test("assembleUnion: 표시만 담당 — 1회 표시·매칭 카테고리 기록(크레딧 배정은 안 함)", () => {
  const c = caseById(3);
  const out = assembleUnion(c.exposedItems, c.selectedCategories);
  assert.equal(out.display.length, 1); // display-once (같은 id 중복 제거)
  assert.deepEqual(out.display[0].selectedByCategories, ["business", "politics"]);
  assert.equal(out.display[0].fulfillmentByCategory, undefined); // 크레딧 배정 안 함(fulfillment 몫)
});

test("assembleUnion: 분류 행 분리도 병합·1회 표시 / id 없으면 evidenceHash로 중복 방지", () => {
  const c = caseById(25);
  const out = assembleUnion(c.exposedItems, c.selectedCategories);
  assert.equal(out.display.length, 1);
  assert.deepEqual(out.display[0].selectedByCategories, ["business", "politics"]); // 병합
  const noId = [
    { byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...c.exposedItems[0].classification, evidenceHash: "same" } },
    { byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...c.exposedItems[0].classification, evidenceHash: "same" } }
  ];
  assert.equal(assembleUnion(noId, ["business"]).display.length, 1);
});

test("반례 26: fulfillment는 실제 복수 소속을 보존 — A(biz+pol)·B(biz) → biz 2·pol 1", () => {
  const c = caseById(26);
  // assembleUnion은 표시만. fulfillment는 각 사건의 실제 선택 분야 소속을 집계한다.
  const display = c.events.map((e) => ({ selectedByCategories: e.categoryIds }));
  const ff = fulfillmentFromDisplay(display, c.selectedCategories, { candidateCounts: c.candidateCounts, minimumIssuesPerCategory: 1 });
  const issueCountOf = (cat) => ff.rows.find((r) => r.categoryId === cat).issueCount;
  assert.equal(issueCountOf("business"), c.expect.issueCountByCategory.business); // 1
  assert.equal(issueCountOf("politics"), c.expect.issueCountByCategory.politics); // 1 (부족 분야 우선)
});

test("반례 27: rank-layer 정렬 실제 적용 — 늦은 politics보다 이른 business가 앞 (재검수 P1-2)", () => {
  const c = caseById(27);
  const cls = (cat) => ({
    contentType: "news", primaryCategory: cat, descriptiveSecondaryCategories: [],
    admissionCategories: fullAdmissionRows(new Set([cat])), // v3: 14행 전수
    modelVersion: "m", promptVersion: "p", taxonomyVersion: "t", evidenceHash: "eh-" + cat,
    sourceCountry: "KR", language: "ko", eventJurisdictions: ["KR"], relevanceCountries: ["KR"],
    scopeClass: "domestic", geoConfidence: 0.7, geoEvidenceSpans: ["x"],
    operatorGroup: "o", originDocumentId: "d", claimOriginGroup: "o"
  });
  // 입력 순서는 politics 먼저지만, business가 tier1이라 정렬 결과 앞에 와야 한다.
  const events = [
    { id: "late-pol", classification: cls("politics"), byCategory: { politics: { tier: 2, S: 0.9 } } },
    { id: "early-biz", classification: cls("business"), byCategory: { business: { tier: 1, S: 0.4 } } }
  ];
  const out = assembleUnion(events, c.selectedCategories);
  assert.equal(out.display[0].id, c.expect.firstDisplayId); // early-biz
});

test("반례 28: 공백 id는 서로 다른 evidenceHash 사건을 합치지 않는다 (재검수 P2)", () => {
  const base = {
    contentType: "news", primaryCategory: "business", descriptiveSecondaryCategories: [],
    admissionCategories: fullAdmissionRows(new Set(["business"])),
    modelVersion: "m", promptVersion: "p", taxonomyVersion: "t",
    sourceCountry: "KR", language: "ko", eventJurisdictions: ["KR"], relevanceCountries: ["KR"],
    scopeClass: "domestic", geoConfidence: 0.7, geoEvidenceSpans: ["x"],
    operatorGroup: "o", originDocumentId: "d", claimOriginGroup: "o"
  };
  const events = [
    { id: " ", byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...base, evidenceHash: "A" } },
    { id: " ", byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...base, evidenceHash: "B" } }
  ];
  // 공백 id는 유효 키가 아니므로 evidenceHash로 폴백 → 서로 다른 사건 2장(합쳐지지 않음).
  assert.equal(assembleUnion(events, ["business"]).display.length, 2);
  // 같은 공백 id라도 evidenceHash가 같으면 한 사건으로 병합.
  const sameHash = [
    { id: " ", byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...base, evidenceHash: "same" } },
    { id: " ", byCategory: { business: { tier: 1, S: 0.5 } }, classification: { ...base, evidenceHash: "same" } }
  ];
  assert.equal(assembleUnion(sameHash, ["business"]).display.length, 1);
  // 스키마가 evidenceHash를 필수로 강제하므로 승인 항목은 항상 안정 키를 갖는다
  // (id·hash 둘 다 없는 승인 항목은 존재할 수 없음 — no_stable_event_id 가드는
  //  방어용). 스키마 무효(빈 evidenceHash)는 애초에 승인되지 않아 표시 0.
  assert.equal(assembleUnion([{ id: "  ", classification: { ...base, evidenceHash: "" } }], ["business"]).display.length, 0);
});

// ── D0 FINAL CLOSURE 인수 테스트 (F1·F2·R1·I1) ───────────────────────────────
test("F1: assembleUnion→fulfillmentFromDisplay 전체 결합·복수 분야 소속 보존", () => {
  const c = caseById(29);
  const out = assembleUnion(c.events, c.selectedCategories);
  assert.equal(out.display.length, c.expect.displayCount); // 2
  const ff = fulfillmentFromDisplay(out.display, c.selectedCategories, {
    candidateCounts: c.candidateCounts,
    minimumIssuesPerCategory: c.minimumIssuesPerCategory
  });
  const row = (cat) => ff.rows.find((r) => r.categoryId === cat);
  assert.equal(row("business").issueCount, c.expect.issueCountByCategory.business); // 1
  assert.equal(row("politics").issueCount, c.expect.issueCountByCategory.politics); // 1
  assert.equal(row("business").candidateCount, c.expect.candidateCountByCategory.business); // 2
  assert.equal(row("politics").candidateCount, c.expect.candidateCountByCategory.politics); // 1
  assert.equal(row("business").state, c.expect.rowState); // met
  assert.equal(row("politics").state, c.expect.rowState); // met
  assert.equal(ff.state, c.expect.state); // fulfillment_complete
  assert.equal(ff.goalSatisfied, c.expect.goalSatisfied); // true
  assert.equal(ff.metCount, c.expect.metCount); // 2
  assert.equal(ff.selectedCount, c.expect.selectedCount); // 2
  assert.deepEqual(ff.missingCategoryIds, []);
  assert.deepEqual(ff.noQualifiedCategoryIds, []);
  assert.deepEqual(ff.underfilledCategoryIds, []);
  assert.equal(ff.uniqueCreditedIssueCount, c.expect.uniqueCreditedIssueCount); // 2
  // 표시 카드는 2장이지만 A는 business와 politics 모두의 실제 상위 목록에 속한다.
  const sum = ff.rows.reduce((s, r) => s + r.issueCount, 0);
  assert.equal(sum, 3);
});

test("F2: fulfillmentFromDisplay 입력 진실성 — fail-closed·명시0=no_supply·qualified0=no_qualified·availableCategories", () => {
  const c = caseById(32);
  const S = c.scenarios;
  // 공급 메타 누락 → TypeError (후보 수를 display에서 추정하지 않음)
  assert.throws(() => fulfillmentFromDisplay(c.display, c.selectedCategories, S.missing.opts), TypeError);
  // 음수 → TypeError
  assert.throws(() => fulfillmentFromDisplay(c.display, c.selectedCategories, S.negative.opts), TypeError);
  // 비수치 → TypeError
  assert.throws(() => fulfillmentFromDisplay(c.display, c.selectedCategories, S.nonNumeric.opts), TypeError);
  // NaN → TypeError (JSON 미표현이라 인라인)
  assert.throws(() => fulfillmentFromDisplay(c.display, c.selectedCategories, { candidateCounts: { business: Number.NaN } }), TypeError);
  // 명시적 0은 오류가 아니라 정상 no_supply
  const z = fulfillmentFromDisplay(c.display, c.selectedCategories, S.explicitZero.opts);
  assert.equal(z.rows.find((r) => r.categoryId === "business").state, S.explicitZero.expectRowState);
  // candidateCount>0 + qualifiedClusterCount=0 → no_qualified_supply
  const nq = fulfillmentFromDisplay(c.display, c.selectedCategories, S.noQualified.opts);
  assert.equal(nq.rows.find((r) => r.categoryId === "business").state, S.noQualified.expectRowState);
  // availableCategories 공급행만으로도 정확히 동작
  const av = fulfillmentFromDisplay(c.display, c.selectedCategories, S.availableOnly.opts);
  const avRow = av.rows.find((r) => r.categoryId === "business");
  assert.equal(avRow.state, S.availableOnly.expectRowState);
  assert.equal(avRow.candidateCount, S.availableOnly.expectCandidateCount);
});

test("R1: rank metadata — 유효 정렬·역순 결정성 / 누락·무효 tier·S는 폴백 없이 사건 전체 withheld", () => {
  const c = caseById(30);
  // 유효: tier asc → biz-early(tier1)가 pol-late(tier2)보다 앞
  const outV = assembleUnion(c.validEvents, c.selectedCategories);
  assert.deepEqual(outV.display.map((d) => d.id), c.expectValidOrder);
  assert.equal(outV.withheld.length, 0);
  // 입력 역순도 같은 정렬(결정성)
  const outR = assembleUnion([...c.validEvents].reverse(), c.selectedCategories);
  assert.deepEqual(outR.display.map((d) => d.id), c.expectValidOrder);
  // 누락·tier0·음수·소수·S음수·S초과 각각 사건 전체 withheld, display 0, key/id·실패 category 기록
  for (const ev of c.invalidEvents) {
    const out = assembleUnion([ev], c.selectedCategories);
    assert.equal(out.display.length, 0, `invalid ${ev.id} must not display`);
    const w = out.withheld.find((x) => x.reason === "missing_or_invalid_rank_metadata");
    assert.ok(w, `invalid ${ev.id} withheld reason`);
    assert.equal(w.category, ev.failCategory, `invalid ${ev.id} failing category`);
    assert.equal(w.id, ev.id, `invalid ${ev.id} records id`);
  }
});

test("I1: 사건 ID namespace — id:<x> vs eh:<x> 분리, 공백 id 폴백, 입력순 무관", () => {
  const c = caseById(31);
  for (const sc of c.scenarios) {
    const out = assembleUnion(sc.events, c.selectedCategories);
    assert.equal(out.display.length, sc.expectCount, sc.label);
  }
  // 입력 순서 변경에도 결과 동일(키·순서)
  const dsc = c.scenarios[c.determinismScenarioIndex];
  const fwd = assembleUnion(dsc.events, c.selectedCategories).display.map((d) => d.key);
  const rev = assembleUnion([...dsc.events].reverse(), c.selectedCategories).display.map((d) => d.key);
  assert.deepEqual(rev, fwd, "namespace 결과 입력순 무관");
});

test("resolveEventEditorial: 지원되는 편집 주장이 없으면 event withheld", () => {
  assert.equal(resolveEventEditorial({ supportedClaimFields: [] }).withheld, true);
  assert.equal(resolveEventEditorial({ supportedClaimFields: ["whatHappened"] }).withheld, false);
});

// ── baseline drift (수리 7) ──────────────────────────────────────────────────
test("baseline lock: 현재 지문이 고정 lock과 drift 없음(--check가 exit 1 낼 상태 아님)", () => {
  const res = compareToLock();
  assert.equal(res.ok, true, "drift: " + JSON.stringify(res.drift));
});

// ── 동결 반례 1~20 (fixture 구동) ────────────────────────────────────────────
test("반례 1·2·4: 승인 행 없는 노출 → 위반", () => {
  for (const id of [1, 2, 4]) {
    const c = caseById(id);
    assert.equal(exposureViolations(c.exposedItems, c.selectedCategories).length, 1, `case ${id}`);
    assert.equal(admissionInvariantHolds(c.exposedItems, c.selectedCategories), false, `case ${id}`);
  }
});

test("반례 3: 양분야 accept + 둘 다 선택 → 불변식 성립·union 1회", () => {
  const c = caseById(3);
  assert.equal(admissionInvariantHolds(c.exposedItems, c.selectedCategories), true);
  assert.deepEqual(selectedByCategories(c.exposedItems[0].classification, c.selectedCategories), c.expect.selectedByCategories);
});

test("반례 5: 같은 보도자료 두 매체 → claimOriginGroup 1, 공유 사실 자격 없음", () => {
  const c = caseById(5);
  assert.equal(distinctClaimOriginGroups(c.evidence).length, 1);
  assert.equal(sharedFactQualifies(c.evidence).qualifies, false);
  assert.equal(hasPrimaryEvidence([{ sourceRole: "primary", claimOriginGroup: "a" }]), true);
  assert.equal(sharedFactQualifies([
    { claimOriginGroup: "a", sourceRole: "reported_secondary" },
    { claimOriginGroup: "b", sourceRole: "reported_secondary" }
  ]).qualifies, true);
});

test("반례 6~10: 지역성은 사건 위치 기준", () => {
  for (const id of [6, 7, 8, 9, 10]) {
    const c = caseById(id);
    const scope = resolveScopeClass(c.scope);
    assert.equal(scope.scopeClass, c.expect.scopeClass, `case ${id} scopeClass`);
    assert.equal(overseasWeightAllowed(scope), c.expect.overseasWeightAllowed, `case ${id} overseasWeight`);
  }
  assert.equal(isAdmittedTo(caseById(8).classification, "sports"), true);
});

test("반례 11·20: unclassified withheld (장애·정상)", () => {
  const c11 = caseById(11);
  const s11 = degradedState(c11.degraded);
  assert.equal(s11.state, "live_preparing");
  assert.equal(s11.withholdUnclassified, true);
  const c20 = caseById(20);
  const s20 = degradedState(c20.degraded);
  assert.equal(s20.state, "normal");
  assert.equal(s20.withholdUnclassified, true);
});

test("반례 12: 지원 편집 주장 없으면 withheld", () => {
  assert.equal(resolveEventEditorial(caseById(12).editorial).withheld, true);
});

test("반례 13·19: 앞단 fail 뒤 pass·narrow 모두 위반", () => {
  assert.equal(precedenceRespected(caseById(13).stageResults).ok, false);
  assert.equal(precedenceRespected(caseById(19).stageResults).ok, false);
});

test("반례 14·17·18: 스키마 무효 분류는 canonical gate가 비승인", () => {
  for (const id of [14, 17, 18]) {
    const cls = caseById(id).classification;
    assert.equal(validateClassificationSchema(cls).ok, false, `case ${id} schema`);
    assert.equal(admissionGate(cls).blocked, "schema_invalid", `case ${id} gate`);
    assert.deepEqual(admittedCategories(cls), [], `case ${id} admitted`);
  }
});

test("반례 15·16: other·unknown은 accept 있어도 비승인", () => {
  const c15 = caseById(15);
  assert.equal(admissionGate(c15.classification).blocked, "content_type_other");
  assert.equal(admittedCategories(c15.classification).length, 0);
  const c16 = caseById(16);
  assert.equal(admissionGate(c16.classification).blocked, "primary_unknown");
  assert.equal(admittedCategories(c16.classification).length, 0);
});

test("반례 21·22: 공백 관할·빈 근거·scopeClass 불일치는 fail-open 아니라 reject (재검수 수리 3)", () => {
  assert.equal(validateClassificationSchema(caseById(21).classification).ok, false);
  assert.equal(validateClassificationSchema(caseById(22).classification).ok, false);
});

test("반례 23·24: 라벨만으로 fail-open 금지 — primary는 claimOriginGroup, 뉴스신뢰는 스키마 요구", () => {
  assert.equal(hasPrimaryEvidence(caseById(23).evidence), false);
  assert.equal(sharedFactQualifies(caseById(23).evidence).qualifies, false);
  assert.equal(isNewsTrustEligible(caseById(24).classification), false);
});

// ── D1-G FINAL CLOSURE(v3): admission 14행 전수 + accept∩secondary — canonical gate 반례 ──
test("v3 반례: admission 누락·잉여·중복치환은 스키마 거부 + canonical gate 비승인", () => {
  const missing = goodClassification();
  missing.admissionCategories = missing.admissionCategories.slice(0, 13);
  assert.equal(validateClassificationSchema(missing).ok, false);
  assert.ok(validateClassificationSchema(missing).errors.includes("admission_rows_not_exact_taxonomy"));
  assert.equal(admissionGate(missing).blocked, "schema_invalid");
  assert.deepEqual(admissionGate(missing).admitted, []);

  const extra = goodClassification();
  extra.admissionCategories = [...extra.admissionCategories, { ...extra.admissionCategories[1] }]; // 15행
  assert.equal(validateClassificationSchema(extra).ok, false);
  assert.equal(admissionGate(extra).blocked, "schema_invalid");

  const dupReplace = goodClassification();
  dupReplace.admissionCategories = [...dupReplace.admissionCategories];
  dupReplace.admissionCategories[13] = { ...dupReplace.admissionCategories[0] }; // 길이 14, 중복1+누락1
  assert.equal(validateClassificationSchema(dupReplace).ok, false);
  assert.equal(admissionGate(dupReplace).blocked, "schema_invalid");
});

test("v3 반례: accept∩descriptiveSecondary 겹침 거부·비accept secondary는 허용", () => {
  const overlap = goodClassification({ descriptiveSecondaryCategories: ["business"] }); // business=accept 행
  assert.equal(validateClassificationSchema(overlap).ok, false);
  assert.ok(validateClassificationSchema(overlap).errors.includes("accepted_secondary_overlap"));
  assert.equal(admissionGate(overlap).blocked, "schema_invalid");
  assert.deepEqual(admissionGate(overlap).admitted, []);

  const okSecondary = goodClassification({ descriptiveSecondaryCategories: ["tech"] }); // tech=reject 행 → 부차 서술 정당
  assert.equal(validateClassificationSchema(okSecondary).ok, true);
  assert.deepEqual(admissionGate(okSecondary).admitted, ["business"]);
});
