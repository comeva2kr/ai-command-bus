// NOWHOT semantic admission contract — D0 freeze (2026-08-18), Codex HOLD 수리본.
//
// 정본: WRC_MANUS_HANDOFF/system/reports/
//   NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//   (SHA-256 1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5)
//
// **계약(스키마·불변식·실패 상태)만 담는다.** 순수 함수·상수뿐이고 네트워크·
// 저장소·시계·LLM 접근이 없다. D0 범위에서 이 계약은 어떤 런타임(랭킹·서빙·UI)에도
// 연결되지 않는다(runtimeWired:false).
//
// Codex D0 검수 수리(2026-08-18):
//  1. 단일 canonical gate — 스키마 통과 분류만 admission 가능.
//  2. contentType=other / primaryCategory=unknown / 중복·충돌 행은 accept가 있어도 비승인.
//  3. accept 행은 비어 있지 않은 evidenceSpans·reasonCodes 요구.
//  4. 지역성·claim provenance 필수 필드를 스키마 validator에 포함.
//  5. precedence는 모든 단계·상태 enum 요구, 앞단 fail 뒤 fail 외 결과 금지.
//  6. unclassified는 정상·장애 모두 항상 withheld.
//  8. display-once/fulfillment-once·unsupported-claim withheld를 순수 함수로 구현.
//
// 기존 코드 경계(정본 §3·§6-D): taxonomy.js CATEGORIES가 카테고리 enum 정본.
// operationalSourceIdentity / independentReportingGroups(legacy 운영그룹 계수)는
// 의미를 바꾸지 않고 보존한다. 이 파일의 claimOriginGroup(주장 기원)은 별개 개념.
import { CATEGORIES, isKnownCategory } from "./taxonomy.js";
import { buildEditorialFulfillment } from "./editorial-fulfillment.js";

export const SELECTION_CONTRACT = Object.freeze({
  stableId: "NOWHOT-SELECTION-ADMISSION-CONTRACT-001",
  version: 3, // D1-G FINAL CLOSURE: admission 14행 전수(누락·잉여 fail-closed) + accept∩secondary 금지
  phase: "D0-freeze",
  runtimeWired: false,
  canonicalSpecSha256: "1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5"
});

export const ADMISSION_CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));
export const CONTENT_TYPES = Object.freeze(["news", "community", "deal", "other"]);
export const ADMISSION_DECISIONS = Object.freeze(["accept", "abstain", "reject"]);
export const NON_ADMITTING_PRIMARY = Object.freeze(["other", "unknown"]);
export const SCOPE_CLASSES = Object.freeze([
  "domestic", "international", "global", "cross_border", "unknown"
]);
export const EVIDENCE_PRECEDENCE = Object.freeze([
  "source_item_eligibility", "event_category_admission", "editorial_claim_grounding"
]);
export const STAGE_STATES = Object.freeze(["pass", "fail", "narrow"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const isUnit = (v) => isFiniteNum(v) && v >= 0 && v <= 1;
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const isNonEmptyStrArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyStr);

// ---------------------------------------------------------------------------
// B. 스키마 검증 (정본 §5 + D0 명령 6-B 지역성·근거 기원 필드 포함).
//   fail-closed: 모르는 값·중복·충돌·필수 누락은 통과가 아니라 거부.
// ---------------------------------------------------------------------------
export function validateClassificationSchema(raw) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isPlainObject(raw)) return { ok: false, errors: ["classification: not an object"] };

  if (!CONTENT_TYPES.includes(raw.contentType)) err(`contentType invalid: ${raw.contentType}`);
  if (!(raw.primaryCategory === "unknown" || isKnownCategory(raw.primaryCategory))) {
    err(`primaryCategory not taxonomy id or unknown: ${raw.primaryCategory}`);
  }
  if (!Array.isArray(raw.descriptiveSecondaryCategories)
    || !raw.descriptiveSecondaryCategories.every((c) => isKnownCategory(c))) {
    err("descriptiveSecondaryCategories not [taxonomy id]");
  }

  // admissionCategories — 중복/충돌 fail-closed. accept는 evidenceSpans·reasonCodes 필수(수리 3).
  if (!Array.isArray(raw.admissionCategories)) {
    err("admissionCategories not array");
  } else {
    const seen = new Set();
    for (const [i, row] of raw.admissionCategories.entries()) {
      if (!isPlainObject(row)) { err(`admissionCategories[${i}] not object`); continue; }
      if (!isKnownCategory(row.category)) err(`admissionCategories[${i}].category not taxonomy id: ${row.category}`);
      if (!ADMISSION_DECISIONS.includes(row.decision)) err(`admissionCategories[${i}].decision invalid: ${row.decision}`);
      if (!isUnit(row.confidence)) err(`admissionCategories[${i}].confidence not 0..1`);
      if (!isStrArray(row.evidenceSpans)) err(`admissionCategories[${i}].evidenceSpans not [string]`);
      if (!isStrArray(row.reasonCodes)) err(`admissionCategories[${i}].reasonCodes not [string]`);
      if (row.decision === "accept") {
        if (!isNonEmptyStrArray(row.evidenceSpans)) err(`admissionCategories[${i}] accept needs non-empty evidenceSpans`);
        if (!isNonEmptyStrArray(row.reasonCodes)) err(`admissionCategories[${i}] accept needs non-empty reasonCodes`);
      }
      if (isKnownCategory(row.category)) {
        if (seen.has(row.category)) err(`admissionCategories duplicate category: ${row.category}`);
        seen.add(row.category);
      }
    }
    // D1-G FINAL CLOSURE(v3): taxonomy 14종 정확히 1행씩 — 누락·잉여 fail-closed
    // (v2는 중복만 거부하고 누락 행·잉여 길이를 통과시켰다).
    if (raw.admissionCategories.length !== ADMISSION_CATEGORY_IDS.length
      || !ADMISSION_CATEGORY_IDS.every((id) => seen.has(id))) {
      err("admission_rows_not_exact_taxonomy");
    }
    // D1-G FINAL CLOSURE(v3): accept된 카테고리는 descriptiveSecondaryCategories와 겹칠 수 없다 —
    // 같은 카테고리가 핵심(accept)이면서 동시에 부차 서술일 수 없다(fail-closed).
    const acceptedSet = new Set(raw.admissionCategories
      .filter((r) => isPlainObject(r) && r.decision === "accept").map((r) => r.category));
    if (Array.isArray(raw.descriptiveSecondaryCategories)
      && raw.descriptiveSecondaryCategories.some((c) => acceptedSet.has(c))) {
      err("accepted_secondary_overlap");
    }
  }

  for (const field of ["modelVersion", "promptVersion", "taxonomyVersion", "evidenceHash"]) {
    if (!isNonEmptyStr(raw[field])) err(`${field} empty`);
  }

  // 지역성 필수 필드 (수리 4, D0 명령 6-B). 소스 국적은 매체 위치일 뿐 사건
  // 국내/해외 판정이 아니다 — scopeClass가 정본 결정값이다. 재검수 수리 3:
  // 공백 항목·빈 근거·scopeClass 불일치를 fail-open이 아니라 거부한다.
  if (!isNonEmptyStr(raw.sourceCountry)) err("sourceCountry empty");
  if (!isNonEmptyStr(raw.language)) err("language empty");
  // 관할·관련국 배열 항목은 공백이 아니어야 한다([" "] 통과 금지).
  if (!Array.isArray(raw.eventJurisdictions) || !raw.eventJurisdictions.every(isNonEmptyStr)) {
    err("eventJurisdictions not [non-empty string]");
  }
  if (!Array.isArray(raw.relevanceCountries) || !raw.relevanceCountries.every(isNonEmptyStr)) {
    err("relevanceCountries not [non-empty string]");
  }
  if (!SCOPE_CLASSES.includes(raw.scopeClass)) err(`scopeClass invalid: ${raw.scopeClass}`);
  if (!isUnit(raw.geoConfidence)) err("geoConfidence not 0..1");
  if (!isStrArray(raw.geoEvidenceSpans)) err("geoEvidenceSpans not [string]");
  // scopeClass가 unknown이 아니면 사건 위치 근거(geoEvidenceSpans)가 비면 안 된다.
  if (raw.scopeClass !== "unknown" && !isNonEmptyStrArray(raw.geoEvidenceSpans)) {
    err("geoEvidenceSpans must be non-empty when scopeClass != unknown");
  }
  // scopeClass는 관할·관련국에서 도출한 값과 일치해야 한다(["KR"]+global 통과 금지).
  if (Array.isArray(raw.eventJurisdictions) && raw.eventJurisdictions.every(isNonEmptyStr)
    && SCOPE_CLASSES.includes(raw.scopeClass)) {
    const expected = resolveScopeClass({
      eventJurisdictions: raw.eventJurisdictions,
      relevanceCountries: Array.isArray(raw.relevanceCountries) ? raw.relevanceCountries : []
    }).scopeClass;
    if (raw.scopeClass !== expected) {
      err(`scopeClass ${raw.scopeClass} inconsistent with event jurisdictions (expected ${expected})`);
    }
  }

  // 근거 기원 필수 필드 (수리 4, §6-D). claimOriginGroup은 operatorGroup과 별개.
  if (!isNonEmptyStr(raw.operatorGroup)) err("operatorGroup empty");
  if (!isNonEmptyStr(raw.originDocumentId)) err("originDocumentId empty");
  if (!isNonEmptyStr(raw.claimOriginGroup)) err("claimOriginGroup empty");

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 단일 canonical admission gate (수리 1·2). 스키마 통과 + contentType≠other +
// primaryCategory≠unknown 일 때만 accept 행이 자격을 만든다. 그 외 전부 비승인.
// admittedCategories·isAdmittedTo·exposureViolations는 모두 이 게이트를 경유한다.
// ---------------------------------------------------------------------------
export function admissionGate(classification) {
  const schema = validateClassificationSchema(classification);
  if (!schema.ok) return { admitted: [], blocked: "schema_invalid", schemaErrors: schema.errors };
  if (classification.contentType === "other") return { admitted: [], blocked: "content_type_other" };
  if (classification.primaryCategory === "unknown") return { admitted: [], blocked: "primary_unknown" };
  const admitted = classification.admissionCategories
    .filter((r) => r.decision === "accept" && isKnownCategory(r.category))
    .map((r) => r.category);
  return { admitted: [...new Set(admitted)], blocked: null };
}

export function admittedCategories(classification) {
  return admissionGate(classification).admitted;
}

export function isNonAdmittingPrimary(classification) {
  return !isPlainObject(classification) || NON_ADMITTING_PRIMARY.includes(classification.primaryCategory);
}

export function isAdmittedTo(classification, category) {
  return admittedCategories(classification).includes(category);
}

// ---------------------------------------------------------------------------
// C. 릴리스 불변식 (정본 §5): count(선택 카테고리 승인 행 없는 노출 항목) == 0.
// ---------------------------------------------------------------------------
export function exposureViolations(exposedItems, selectedCategories) {
  const selected = new Set((selectedCategories || []).filter(isKnownCategory));
  const violations = [];
  for (const item of exposedItems || []) {
    const gate = admissionGate(item && item.classification);
    const admitted = gate.admitted;
    const hasSelectedAdmission = admitted.some((c) => selected.has(c));
    if (!hasSelectedAdmission) {
      violations.push({
        id: item && item.id != null ? item.id : null,
        admitted,
        selected: [...selected],
        reason: gate.blocked
          ? `blocked:${gate.blocked}`
          : (admitted.length === 0 ? "no_accepted_admission_row" : "no_admission_row_matches_selected_category")
      });
    }
  }
  return violations;
}

export function admissionInvariantHolds(exposedItems, selectedCategories) {
  return exposureViolations(exposedItems, selectedCategories).length === 0;
}

export function selectedByCategories(classification, selectedCategories) {
  const selected = new Set((selectedCategories || []).filter(isKnownCategory));
  return admittedCategories(classification).filter((c) => selected.has(c));
}

// taxonomy 안정 순서 인덱스(tie-break용).
const TAXONOMY_INDEX = new Map(ADMISSION_CATEGORY_IDS.map((id, i) => [id, i]));

// I1: 사건 동일성 키 namespace. 유효 id → "id:<trim>", 없거나 공백 → "eh:<trim(hash)>".
//   id는 비어 있지 않은 문자열 또는 유한 숫자만 인정한다. 객체·배열 id는 무시하고
//   evidenceHash로 폴백한다. 둘 다 없으면 null(→ withheld). id namespace와 eh
//   namespace는 절대 섞이지 않는다(같은 문자열 값이라도 서로 다른 사건).
function eventIdentity(ev) {
  const id = ev.id;
  let idPart = null;
  if (typeof id === "number" && Number.isFinite(id)) idPart = String(id);
  else if (typeof id === "string" && id.trim().length > 0) idPart = id.trim();
  if (idPart !== null) return { key: `id:${idPart}`, id: idPart };
  const hash = ev.classification && ev.classification.evidenceHash;
  if (typeof hash === "string" && hash.trim().length > 0) return { key: `eh:${hash.trim()}`, id: null };
  return { key: null, id: null };
}

// R1: rank metadata 계약. tier는 1 이상 정수, S는 0..1 유한수. 폴백하지 않는다.
const isValidTier = (t) => Number.isInteger(t) && t >= 1;
const isValidS = (s) => Number.isFinite(s) && s >= 0 && s <= 1;

// ---------------------------------------------------------------------------
// assembleUnion은 **표시(display)만** 담당한다 — admission gate 통과·namespaced
// stable key·동일 사건 병합·selectedByCategories 보존·byCategory 검증/병합·실제
// rank 정렬·표시/withheld 반환. **fulfillment 크레딧을 계산하지 않는다**(그건
// buildEditorialFulfillment의 선택 분야별 실제 소속 집계 몫 — fulfillmentFromDisplay).
//   events: [{ id?, classification, byCategory: {cat:{tier,S}} }]
//     byCategory는 shadowSelectBriefing(947)이 만드는 사건별 분야 층·S 구조를 그대로
//     소비한다(새 랭킹 알고리즘을 만들지 않는다).
//   반환: { display:[{id,key,categoryIds(=selectedByCategories),tier,S,byCategory}],
//           withheld:[{reason,...}] } — display 정렬 = (tier asc, S desc, 안정 taxonomy ID, key).
//   R1: 매칭된 카테고리에 유효 byCategory(tier≥1 정수·S 0..1)가 없으면 폴백하지 않고
//       사건 전체를 missing_or_invalid_rank_metadata로 withheld(key/id·실패 category 기록).
//   I1: 키는 eventIdentity(id namespace vs evidenceHash namespace 분리).
//   사건별 tier=min(카테고리 tier), S=max(카테고리 S). 분류 행 분리도 같은 규칙으로 병합.
// ---------------------------------------------------------------------------
export function assembleUnion(events, selectedCategories) {
  const byEvent = new Map();
  const order = [];
  const withheld = [];
  const poisoned = new Map(); // key -> 첫 실패 기록. 한 행이라도 무효면 사건 전체 withheld.
  for (const ev of events || []) {
    if (!isPlainObject(ev) || !isPlainObject(ev.classification)) { withheld.push({ reason: "not_an_event" }); continue; }
    const matched = selectedByCategories(ev.classification, selectedCategories);
    if (matched.length === 0) continue; // 승인 없는 사건은 노출 안 함(불변식).
    const identity = eventIdentity(ev);
    if (identity.key === null) { withheld.push({ reason: "no_stable_event_id" }); continue; }
    const key = identity.key;
    // R1: 매칭된 모든 카테고리는 유효 byCategory[c]를 가져야 한다(taxonomy/0 폴백 금지).
    const incoming = isPlainObject(ev.byCategory) ? ev.byCategory : {};
    let badCategory = null;
    for (const c of matched) {
      const rc = incoming[c];
      if (!isPlainObject(rc) || !isValidTier(rc.tier) || !isValidS(rc.S)) { badCategory = c; break; }
    }
    if (badCategory !== null) {
      if (!poisoned.has(key)) {
        poisoned.set(key, { reason: "missing_or_invalid_rank_metadata", key, id: identity.id, category: badCategory });
      }
      continue;
    }
    if (!byEvent.has(key)) { byEvent.set(key, { key, id: identity.id, cats: new Set(), byCategory: {} }); order.push(key); }
    const slot = byEvent.get(key);
    for (const c of matched) {
      slot.cats.add(c);
      const cur = slot.byCategory[c];
      const inc = incoming[c];
      slot.byCategory[c] = cur
        ? { tier: Math.min(cur.tier, inc.tier), S: Math.max(cur.S, inc.S) }
        : { tier: inc.tier, S: inc.S };
    }
  }
  // 한 행이라도 rank가 무효였던 사건은 display에서 제외하고 사유를 남긴다(사건 전체 withheld).
  for (const [key, rec] of poisoned) {
    byEvent.delete(key);
    withheld.push(rec);
  }
  const display = order.filter((key) => byEvent.has(key)).map((key) => {
    const { id, cats, byCategory } = byEvent.get(key);
    const matched = [...cats].sort((a, b) => (TAXONOMY_INDEX.get(a) ?? Infinity) - (TAXONOMY_INDEX.get(b) ?? Infinity));
    const tier = Math.min(...matched.map((c) => byCategory[c].tier));
    const S = Math.max(...matched.map((c) => byCategory[c].S));
    return { id, key, categoryIds: matched, selectedByCategories: matched, tier, S, byCategory };
  });
  // 실제 정렬: earliest rank layer → 높은 S → 안정 taxonomy(대표 카테고리) → namespaced key.
  display.sort((a, b) =>
    a.tier - b.tier
    || b.S - a.S
    || (TAXONOMY_INDEX.get(a.categoryIds[0]) ?? Infinity) - (TAXONOMY_INDEX.get(b.categoryIds[0]) ?? Infinity)
    || String(a.key).localeCompare(String(b.key)));
  return { display, withheld };
}

// ---------------------------------------------------------------------------
// fulfillment는 새로 만들지 않고 기존 분야별 소속 집계
// (editorial-fulfillment.buildEditorialFulfillment)을 **정확히 한 번** 적용한다.
//   fulfillmentFromDisplay(display, selectedCategories, { candidateCounts,
//     qualificationRows=[], availableCategories=[], minimumIssuesPerCategory=1 })
//   F2: 선택 분야마다 candidateCounts own-property 또는 availableCategories 공급행이
//       반드시 존재해야 한다(후보 수를 display에서 추정하지 않는다). 누락·음수·NaN·
//       비수치는 fail-closed TypeError. 명시적 0은 오류가 아니라 정상 no_supply.
//   기존 buildEditorialFulfillment 결과를 일부 재작성하지 않고 그대로 반환한다.
// ---------------------------------------------------------------------------
const isSupplyNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function fulfillmentFromDisplay(display, selectedCategories, {
  candidateCounts,
  qualificationRows = [],
  availableCategories = [],
  minimumIssuesPerCategory = 1
} = {}) {
  const selected = [...new Set((selectedCategories || []).filter(isKnownCategory))];
  const counts = isPlainObject(candidateCounts) ? candidateCounts : {};
  const availableRows = Array.isArray(availableCategories) ? availableCategories : [];
  const availById = new Map();
  for (const row of availableRows) {
    if (isPlainObject(row) && isNonEmptyStr(row.id)) availById.set(row.id, row.supply);
  }
  for (const cat of selected) {
    const hasCount = Object.prototype.hasOwnProperty.call(counts, cat);
    const hasAvail = availById.has(cat);
    if (!hasCount && !hasAvail) {
      throw new TypeError(`fulfillmentFromDisplay: no supply metadata for selected category '${cat}'`);
    }
    if (hasCount && !isSupplyNumber(counts[cat])) {
      throw new TypeError(`fulfillmentFromDisplay: candidateCounts['${cat}'] must be a finite number >= 0`);
    }
    if (!hasCount && hasAvail && !isSupplyNumber(availById.get(cat))) {
      throw new TypeError(`fulfillmentFromDisplay: availableCategories supply for '${cat}' must be a finite number >= 0`);
    }
  }
  const issues = (display || []).map((d) => ({ categoryIds: d.selectedByCategories || d.categoryIds || [] }));
  return buildEditorialFulfillment({
    selectedCategories: selected,
    issues,
    candidateCounts: counts,
    qualificationRows,
    availableCategories: availableRows,
    minimumIssuesPerCategory
  });
}

// ---------------------------------------------------------------------------
// 수리 8: unsupported-claim withheld (순수 함수). 근거 우선순위 #1 —
//   eligible 사건이라도 지원되는 편집 주장 필드가 하나도 없으면 event withheld.
//   supportedClaimFields: string[] (원문 근거로 지원되는 편집 필드 목록)
// ---------------------------------------------------------------------------
export function resolveEventEditorial({ supportedClaimFields = [] } = {}) {
  const supported = (supportedClaimFields || []).filter(isNonEmptyStr);
  if (supported.length === 0) {
    return { withheld: true, reason: "no_supported_editorial_claim", supportedFields: [] };
  }
  return { withheld: false, reason: null, supportedFields: supported };
}

// ---------------------------------------------------------------------------
// D. 주장 독립성 — operatorGroup(운영 독립) vs claimOriginGroup(주장 기원) 분리.
// ---------------------------------------------------------------------------
const PRIMARY_ROLES = Object.freeze(new Set(["primary", "first_party"]));

export function distinctClaimOriginGroups(evidence) {
  const groups = new Set();
  for (const e of evidence || []) {
    if (!isPlainObject(e)) continue;
    if (isNonEmptyStr(e.claimOriginGroup)) groups.add(e.claimOriginGroup.trim());
  }
  return [...groups];
}
// 재검수 수리 3: 역할 라벨만으로 인정하지 않는다 — 식별된 1차 출처
// (claimOriginGroup 존재)여야 primary 근거로 센다(fail-open 차단).
export function hasPrimaryEvidence(evidence) {
  return (evidence || []).some((e) => isPlainObject(e)
    && PRIMARY_ROLES.has(e.sourceRole) && isNonEmptyStr(e.claimOriginGroup));
}
export function sharedFactQualifies(evidence) {
  if (hasPrimaryEvidence(evidence)) return { qualifies: true, basis: "primary_or_first_party" };
  const groups = distinctClaimOriginGroups(evidence);
  if (groups.length >= 2) return { qualifies: true, basis: "independent_claim_origin_groups", groups };
  return { qualifies: false, basis: "insufficient_independent_claim_origin", groups };
}

// ---------------------------------------------------------------------------
// 지역성 — 사건 위치 기준(정본 §5). 근거 부족 시 unknown(추측 금지).
// classification.scopeClass가 정본 결정값이며, 이 함수는 원천 판정 보조.
// ---------------------------------------------------------------------------
export function resolveScopeClass({ eventJurisdictions = [], relevanceCountries = [] } = {}) {
  const evt = [...new Set((eventJurisdictions || []).filter(isNonEmptyStr).map((c) => c.trim().toUpperCase()))];
  const rel = (relevanceCountries || []).filter(isNonEmptyStr).map((c) => c.trim().toUpperCase());
  if (evt.length === 0) return { scopeClass: "unknown", basis: "no_event_jurisdiction", geoConfidence: 0 };
  if (evt.length >= 2) return { scopeClass: "cross_border", basis: "multiple_event_jurisdictions", geoConfidence: 0.5 };
  if (evt[0] === "KR") return { scopeClass: "domestic", basis: "event_in_kr", geoConfidence: 0.7 };
  const krRelevant = rel.includes("KR");
  return {
    scopeClass: krRelevant ? "international" : "global",
    basis: krRelevant ? "overseas_event_kr_relevant" : "overseas_event_no_kr_relevance",
    geoConfidence: 0.6
  };
}

// scope는 { scopeClass } 또는 scopeClass 문자열 모두 받는다.
export function overseasWeightAllowed(scope) {
  const cls = isPlainObject(scope) ? scope.scopeClass : scope;
  return cls === "international" || cls === "global" || cls === "cross_border";
}

// ---------------------------------------------------------------------------
// 근거 우선순위 (수리 5). 모든 단계·상태 enum 요구. 앞단 fail 뒤에는 fail만
// 허용(pass·narrow 모두 위반). stageResults: { <stage>: "pass"|"fail"|"narrow" }.
// ---------------------------------------------------------------------------
export function precedenceRespected(stageResults) {
  if (!isPlainObject(stageResults)) return { ok: false, violation: "stageResults not object" };
  // 모든 단계 존재 + enum 검증.
  for (const stage of EVIDENCE_PRECEDENCE) {
    if (!STAGE_STATES.includes(stageResults[stage])) {
      return { ok: false, violation: `${stage} state invalid: ${stageResults[stage]}` };
    }
  }
  let earlierFailed = false;
  for (const stage of EVIDENCE_PRECEDENCE) {
    const r = stageResults[stage];
    if (earlierFailed && r !== "fail") {
      return { ok: false, violation: `${stage}=${r} after earlier stage failed (only fail allowed)` };
    }
    if (r === "fail") earlierFailed = true;
  }
  return { ok: true, violation: null };
}

// ---------------------------------------------------------------------------
// E. 실패 상태 (수리 6). unclassified는 정상·장애 모두 항상 withheld.
// ---------------------------------------------------------------------------
export const FAILURE_STATES = Object.freeze({
  TODAY_PREPARING: "업데이트 준비 중",
  LIVE_STALE: "업데이트 지연",
  LIVE_PREPARING: "업데이트 준비 중"
});

export function degradedState({ surface, classifierAvailable, hasVerifiedCache, hasVerifiedItem } = {}) {
  // unclassified 항목은 어떤 상태에서도 노출하지 않는다(정본 §8, 수리 6).
  const base = { withholdUnclassified: true, useKeywordFallback: false };
  if (classifierAvailable && hasVerifiedCache) {
    return { ...base, state: "normal" };
  }
  if (surface === "today") {
    return hasVerifiedCache
      ? { ...base, state: "today_cached_fallback", label: null }
      : { ...base, state: "today_preparing", label: FAILURE_STATES.TODAY_PREPARING };
  }
  return hasVerifiedItem
    ? { ...base, state: "live_stale", label: FAILURE_STATES.LIVE_STALE }
    : { ...base, state: "live_preparing", label: FAILURE_STATES.LIVE_PREPARING };
}

// ---------------------------------------------------------------------------
// contentType 하드 게이트 (정본 §9 gate 7).
// ---------------------------------------------------------------------------
// 재검수 수리 3: contentType 라벨만으로 인정하지 않는다 — 스키마 통과 분류여야
// 뉴스 신뢰 자격이 있다(fail-open 차단).
export function isNewsTrustEligible(classification) {
  return validateClassificationSchema(classification).ok && classification.contentType === "news";
}
export function contentTypeConfusionIsCritical(fromType, toType) {
  const pair = `${fromType}->${toType}`;
  return pair === "community->news" || pair === "deal->news";
}
