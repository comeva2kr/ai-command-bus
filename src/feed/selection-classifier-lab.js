// NOWHOT D1-A — offline classifier laboratory (pure core), Codex HOLD correction v2.
//
// 정본: WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//   (SHA-256 1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5)
// D0 계약 재사용: selection-contract.js(validateClassificationSchema·admissionGate 등).
//
// **순수 코어.** 네트워크·파일 쓰기·시계·실제 LLM/API 호출 없음. 분류기는 injected
// adapter로만 받는다. D2 런타임 미연결(REAL_MODEL_NOT_RUN·D2_RUNTIME_NOT_WIRED).
//
// v2 계약 변경(Codex HOLD):
//  - prediction 정본 = {itemId,status,classification}. accepted는 D0 admissionGate에서만 유도.
//  - top-level output.abstain 우회 제거. 모델 abstain은 admission row decision:"abstain".
//  - gold는 decisionDigest 감사 필드로 독립성 검증. production/generator identity 필수(fail-closed).
//  - gates lock 전체 바이트 SHA를 코드 상수로 동결 + 엄격 검증(기본값 대입 금지).
//  - buildStructuredRequest에 sourceId/sourceTier/declaredSection 포함(prior일 뿐).
//  - budget 5필드 fail-closed·실패 호출도 maxCalls 포함·output/cost overrun no-cache·timeout 정지.
//  - admission·geo evidenceSpans 모두 grounding. 14 admission category 행 항상 생성.
import crypto from "node:crypto";
import { validateClassificationSchema, admissionGate, ADMISSION_CATEGORY_IDS, CONTENT_TYPES, SCOPE_CLASSES, resolveScopeClass } from "./selection-contract.js";
import { isKnownCategory } from "./taxonomy.js";

export const CLASSIFIER_LAB_CONTRACT = Object.freeze({
  stableId: "NOWHOT-SELECTION-CLASSIFIER-LAB-001",
  phase: "D1-A",
  runtimeWired: false,
  realModelRun: false,
  canonicalSpecSha256: "1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5",
  reusesD0Schema: true
});
export const D1_CORPUS_ID = "NOWHOT-SELECTION-D1-CORPUS-002"; // integrity-02: current corpus lineage
export const D1_CORPUS_SUPERSEDES_ID = "NOWHOT-SELECTION-D1-CORPUS-001"; // superseded by 002
export const D1_GOLD_ID = "NOWHOT-SELECTION-D1-GOLD-001";
export const D1_GATES_ID = "NOWHOT-SELECTION-D1-GATES-001";

// 평가 상수(§8). 변경은 append-only David 결정 필요.
export const WILSON_Z = 1.6448536269514722; // 0.95 one-sided
export const PRECISION_TARGET = 0.98;
export const ABSTAIN_MAX_DEFAULT = 0.20;
export const QUALIFIED_SUPPLY_MIN = 8;

// A1: gold labeler 금지 identity 정본(단일 출처). CLI·test·fixture가 이를 공유하고 별도 하드코딩 금지.
export const D1_IDENTITIES = Object.freeze({ productionModelIdentity: "prod-classifier-v0", corpusGeneratorIdentity: "build-selection-d1-corpus" });

// gates lock 전체 바이트 SHA 동결(§8). 파일이 바뀌면 --check-lock/검증에서 drift.
export const D1_GATES_LOCK_SHA256 = "10c3160c9c098e7a4c3ca3fbd0ebaa0561bcb12f3d1bda82605a1f56a1fb7793";

export const CORPUS_ORIGINS = Object.freeze(["real_local_snapshot", "adversarial_contract_fixture", "mutation_fixture"]);
export const GOLD_STATES = Object.freeze(["pending", "agreed", "disputed", "adjudicated", "contract_fixture_only"]);
export const PREDICTION_STATUSES = Object.freeze(["classified", "cache_hit", "withheld", "error", "schema_reject"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const isFiniteNonNeg = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// ---------------------------------------------------------------------------
// 원시 함수(결정적·순수).
// ---------------------------------------------------------------------------
export function normalizeText(s) {
  if (typeof s !== "string") return "";
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
}
const EVIDENCE_SEP = String.fromCharCode(0); // NUL 구분자(기존 corpus 지문과 동일 — 변경 금지).
export function evidenceHashOf({ title = "", excerpt = "" } = {}) {
  const norm = normalizeText(title) + EVIDENCE_SEP + normalizeText(excerpt);
  return crypto.createHash("sha256").update(norm).digest("hex");
}
export function cacheKeyOf(evidenceHash, { modelVersion, promptVersion, taxonomyVersion } = {}) {
  if (!isNonEmptyStr(evidenceHash)) throw new TypeError("cacheKeyOf: evidenceHash required");
  for (const [k, v] of [["modelVersion", modelVersion], ["promptVersion", promptVersion], ["taxonomyVersion", taxonomyVersion]]) {
    if (!isNonEmptyStr(v)) throw new TypeError(`cacheKeyOf: ${k} required`);
  }
  return `${evidenceHash}|${modelVersion}|${promptVersion}|${taxonomyVersion}`;
}

// decisionDigest(§6) = SHA-256(canonical(contentType, sorted accepted/rejected/secondary, humanValid, inScope, reason)).
export function decisionDigestOf(decision) {
  const d = decision || {};
  const canonical = JSON.stringify({
    contentType: d.contentType ?? null,
    accepted: [...(d.accepted || [])].map(String).sort(),
    rejected: [...(d.rejected || [])].map(String).sort(),
    secondary: [...(d.secondary || [])].map(String).sort(),
    humanValid: d.humanValid ?? null,
    inScope: d.inScope ?? null,
    reason: d.reason ?? null
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// 입력 정규화·요청·blind packet. source/section은 prior일 뿐 자동 admission 근거 아님(§4).
// ---------------------------------------------------------------------------
export function normalizeClassifierInput(row) {
  if (!isPlainObject(row)) throw new TypeError("normalizeClassifierInput: row required");
  const title = typeof row.title === "string" ? row.title : "";
  const excerpt = typeof row.excerpt === "string" ? row.excerpt : "";
  return {
    itemId: row.blindItemId || row.itemId || null,
    title, excerpt,
    sourceId: isNonEmptyStr(row.sourceId) ? row.sourceId : (isNonEmptyStr(row.source) ? row.source : "unknown"),
    sourceTier: isNonEmptyStr(row.sourceTier) ? row.sourceTier : "unknown",
    declaredSection: isNonEmptyStr(row.declaredSection) ? row.declaredSection : null,
    contentKindHint: isNonEmptyStr(row.contentKindHint) ? row.contentKindHint : "unknown",
    sourceCountry: isNonEmptyStr(row.sourceCountry) ? row.sourceCountry : "unknown",
    language: isNonEmptyStr(row.language) ? row.language : "unknown",
    evidenceHash: evidenceHashOf({ title, excerpt })
  };
}

export function buildStructuredRequest(input, versions) {
  const norm = isPlainObject(input) && isNonEmptyStr(input.evidenceHash) ? input : normalizeClassifierInput(input);
  for (const k of ["modelVersion", "promptVersion", "taxonomyVersion"]) {
    if (!isNonEmptyStr(versions && versions[k])) throw new TypeError(`buildStructuredRequest: versions.${k} required`);
  }
  return {
    itemId: norm.itemId, title: norm.title, excerpt: norm.excerpt,
    sourceId: norm.sourceId, sourceTier: norm.sourceTier, declaredSection: norm.declaredSection,
    contentKindHint: norm.contentKindHint, sourceCountry: norm.sourceCountry, language: norm.language,
    evidenceHash: norm.evidenceHash,
    versions: { modelVersion: versions.modelVersion, promptVersion: versions.promptVersion, taxonomyVersion: versions.taxonomyVersion },
    taxonomy: [...ADMISSION_CATEGORY_IDS],
    cacheKey: cacheKeyOf(norm.evidenceHash, versions)
  };
}

export function buildBlindPacket(row) {
  const n = normalizeClassifierInput(row);
  // declaredCategory/section·sourceId·gold 제외(라벨러 편향 방지).
  return { itemId: n.itemId, title: n.title, excerpt: n.excerpt, contentKindHint: n.contentKindHint, sourceCountry: n.sourceCountry, language: n.language };
}

// A2: blind packet 지문. gold 각 행의 blindPacketHash·labeler blindPacketHash가 이 정본과 일치해야 한다.
export function blindPacketHashOf(row) {
  return crypto.createHash("sha256").update(JSON.stringify(buildBlindPacket(row))).digest("hex");
}

// A3: gold decision digest. 저장 digest를 신뢰하지 않고 항상 이 함수로 재계산해 대조한다. reason=null 고정.
export function goldDecisionDigestOf(label) {
  const l = label || {};
  return decisionDigestOf({
    contentType: l.goldContentType ?? null,
    accepted: l.goldAcceptedCategories || [],
    rejected: l.goldRejectedCategories || [],
    secondary: l.descriptiveSecondaryCategories || [],
    humanValid: l.humanValid ?? null,
    inScope: l.inScope ?? null,
    reason: null
  });
}

// §4(integrity-02): canonical scope는 저장 scopeClass를 신뢰하지 않고 resolveScopeClass로 재계산·검증한다.
// adversarial fixture는 geo 3필드 필수 + grounded, mutation/legacy는 scope=null(저장 scope 미신뢰).
export function resolveCanonicalContractScope({ contractGold, origin, title, excerpt } = {}) {
  if (!contractGold) return null;
  if (origin !== "adversarial_contract_fixture") return null; // mutation/legacy: 저장 scope 신뢰 안 함
  const ev = contractGold.eventJurisdictions, rel = contractGold.relevanceCountries, spans = contractGold.geoEvidenceSpans;
  // §7: 세 배열 모두 원소가 trim 기준 non-empty string이어야 한다(공백 원소 하나라도 섞이면 reject).
  const goodStr = (x) => typeof x === "string" && x.trim().length > 0 && x === x.trim();
  if (!Array.isArray(ev) || !ev.every(goodStr)) throw new Error("CORRUPT_EVAL_DATA: eventJurisdictions must be [trimmed non-empty string]");
  if (!Array.isArray(rel) || !rel.every(goodStr)) throw new Error("CORRUPT_EVAL_DATA: relevanceCountries must be [trimmed non-empty string]");
  if (!Array.isArray(spans) || !spans.every(goodStr)) throw new Error("CORRUPT_EVAL_DATA: geoEvidenceSpans must be [trimmed non-empty string]");
  const derived = resolveScopeClass({ eventJurisdictions: ev, relevanceCountries: rel }).scopeClass;
  if (contractGold.scopeClass !== derived) throw new Error(`CORRUPT_EVAL_DATA: stored scope '${contractGold.scopeClass}' != derived '${derived}'`);
  if (derived === "unknown") {
    if (ev.length > 0 || spans.length > 0) throw new Error("CORRUPT_EVAL_DATA: unknown scope requires empty eventJurisdictions and geoEvidenceSpans");
  } else {
    if (ev.length === 0) throw new Error("CORRUPT_EVAL_DATA: non-unknown scope requires eventJurisdictions");
    if (spans.length === 0) throw new Error("CORRUPT_EVAL_DATA: non-unknown scope requires geoEvidenceSpans");
  }
  const hay = `${title || ""}\n${excerpt || ""}`;
  for (const s of spans) if (!hay.includes(s)) throw new Error(`CORRUPT_EVAL_DATA: geo span not an exact substring '${s}'`);
  return derived;
}

// §5: contract fixture 정본 projection(평가 전용 authority — request/adapter엔 절대 노출 금지). scope는 검증된 canonical 값.
export function contractProjectionOf(contractGold, scope) {
  // §7: 검증된 scope 인자 필수. 생략 시 저장 scope로 폴백하지 않고 fail-closed. mutation은 명시적 null만.
  if (scope === undefined) throw new TypeError("contractProjectionOf: verified scope argument required (no stored-scope fallback)");
  const g = contractGold || {};
  return {
    contentType: g.contentType ?? null,
    accepted: [...(g.acceptedCategories || [])].map(String).sort(),
    rejected: [...(g.rejectedCategories || [])].map(String).sort(),
    secondary: [...(g.descriptiveSecondaryCategories || [])].map(String).sort(),
    scope
  };
}

// §3: frozen corpus row에서 item별 canonical authority. evidenceHash·blindPacketHash 재계산, origin 필수(기본값 없음).
// 중복·누락 itemId, 잘못된 origin은 CORRUPT_EVAL_DATA. gold가 적어둔 hash/origin은 정본이 아니다.
// ---------------------------------------------------------------------------
// D1-G FINAL CLOSURE: adversarial 평가 정본은 superseding fixture authority(authority-002)다.
// corpus contractGold를 adversarial 채점 답으로 조용히 쓰는 경로를 금지한다(fail-closed).
// ---------------------------------------------------------------------------
export const D1G_AUTHORITY_CONTRACT = "NOWHOT-SELECTION-D1G-ADVERSARIAL-AUTHORITY-002";
export function loadAdversarialAuthority(doc, { corpusRows, expectedContract = D1G_AUTHORITY_CONTRACT } = {}) {
  if (!doc || doc.contract !== expectedContract) {
    throw new Error(`CORRUPT_EVAL_DATA: adversarial authority missing or wrong contract id (need ${expectedContract})`);
  }
  const expectedN = doc.expectedContractFixtures;
  if (!Array.isArray(doc.decisiveItems) || doc.decisiveItems.length !== expectedN) {
    throw new Error(`CORRUPT_EVAL_DATA: authority decisiveItems must be exactly ${expectedN}`);
  }
  const rowById = new Map((corpusRows || []).filter((r) => r && r.origin === "adversarial_contract_fixture").map((r) => [r.blindItemId, r]));
  const byId = new Map();
  // P1-3(fail-closed 전체 스키마): accepted·rejected·secondary 모두 배열·taxonomy 등록·중복 금지,
  // accepted∩rejected=∅·accepted∩secondary=∅ (rejected∩secondary는 gold 계약과 동일하게 정당).
  const catListStrict = (v) => Array.isArray(v) && v.every((c) => isKnownCategory(c)) && new Set(v).size === v.length;
  for (const it of doc.decisiveItems) {
    if (!isNonEmptyStr(it.blindItemId) || byId.has(it.blindItemId)) throw new Error("CORRUPT_EVAL_DATA: authority item id invalid/duplicate");
    const e = it.expected || {};
    if (!CONTENT_TYPES.includes(e.contentType) || !SCOPE_CLASSES.includes(e.scope)) {
      throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' contentType/scope invalid`);
    }
    if (!catListStrict(e.acceptedCategories) || !catListStrict(e.rejectedCategories ?? [])
      || !catListStrict(e.secondaryCategories ?? [])) {
      throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' category lists must be duplicate-free taxonomy arrays`);
    }
    const accSet = new Set(e.acceptedCategories);
    if ((e.rejectedCategories || []).some((c) => accSet.has(c)) || (e.secondaryCategories || []).some((c) => accSet.has(c))) {
      throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' accepted overlaps rejected/secondary`);
    }
    if (!isNonEmptyStr(it.evidenceHash)) throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' evidenceHash missing`);
    if (it.source === "replacement_fixture") {
      for (const f of ["title", "excerpt", "sourceCountry", "language", "contentKindHint"]) {
        if (!isNonEmptyStr(it[f])) throw new Error(`CORRUPT_EVAL_DATA: authority replacement '${it.blindItemId}' missing ${f}`);
      }
    }
    if (it.source === "corpus") {
      // 부분집합 평가(canary 등) 허용: 행이 제공된 경우에만 hash 대조(부재 행은 canonical에 안 들어간다).
      const row = rowById.get(it.blindItemId);
      if (row && evidenceHashOf({ title: row.title, excerpt: row.excerpt }) !== it.evidenceHash) {
        throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' evidenceHash diverges from corpus`);
      }
    } else if (it.source === "replacement_fixture") {
      if (evidenceHashOf({ title: it.title, excerpt: it.excerpt }) !== it.evidenceHash) {
        throw new Error(`CORRUPT_EVAL_DATA: authority replacement '${it.blindItemId}' evidenceHash invalid`);
      }
    } else throw new Error(`CORRUPT_EVAL_DATA: authority '${it.blindItemId}' unknown source`);
    byId.set(it.blindItemId, it);
  }
  const audit = new Set();
  for (const x of doc.auditAmbiguousItems || []) {
    if (!x || !isNonEmptyStr(x.blindItemId) || audit.has(x.blindItemId)) throw new Error("CORRUPT_EVAL_DATA: authority audit item id invalid/duplicate");
    if (byId.has(x.blindItemId)) throw new Error(`CORRUPT_EVAL_DATA: authority '${x.blindItemId}' cannot be both decisive and audit`);
    audit.add(x.blindItemId);
  }
  // corpus의 모든 adversarial 행은 decisive이거나 감사용 ambiguous여야 한다(누락 항목 무단 사용 금지).
  for (const id of rowById.keys()) {
    if (!byId.has(id) && !audit.has(id)) throw new Error(`CORRUPT_EVAL_DATA: corpus adversarial '${id}' not covered by authority (decisive/audit)`);
  }
  return { byId, auditAmbiguous: audit, expectedContractFixtures: expectedN };
}

export function buildCanonicalAuthority(rows, { adversarialAuthority } = {}) {
  const map = new Map();
  const hasAdversarial = (rows || []).some((r) => r && r.origin === "adversarial_contract_fixture");
  if (hasAdversarial && !adversarialAuthority) {
    throw new Error("CORRUPT_EVAL_DATA: adversarial rows require superseding authority-002 (corpus contractGold는 adversarial 평가 답이 될 수 없다)");
  }
  const projOf = (entry) => ({
    contentType: entry.expected.contentType,
    accepted: [...entry.expected.acceptedCategories].sort(),
    rejected: [...(entry.expected.rejectedCategories || [])].sort(),
    secondary: [...(entry.expected.secondaryCategories || [])].sort(),
    scope: entry.expected.scope
  });
  for (const r of rows || []) {
    const itemId = (r && (r.blindItemId || r.itemId)) || null;
    if (!isNonEmptyStr(itemId)) throw new Error("CORRUPT_EVAL_DATA: canonical row missing itemId");
    if (map.has(itemId)) throw new Error(`CORRUPT_EVAL_DATA: duplicate canonical itemId '${itemId}'`);
    if (!isNonEmptyStr(r.origin) || !CORPUS_ORIGINS.includes(r.origin)) throw new Error(`CORRUPT_EVAL_DATA: canonical '${itemId}' invalid origin`);
    const item = { blindItemId: itemId, title: r.title, excerpt: r.excerpt, sourceCountry: r.sourceCountry, language: r.language, contentKindHint: r.contentKindHint };
    const rec = {
      itemId, origin: r.origin,
      evidenceHash: evidenceHashOf({ title: r.title, excerpt: r.excerpt }),
      blindPacketHash: blindPacketHashOf(item),
      contractGold: r.contractGold || null,
      contractProjection: null,
      auditAmbiguous: false
    };
    if (r.origin === "adversarial_contract_fixture") {
      // D1CI2 유지: frozen corpus 자체의 geo 자기일관성은 계속 fail-closed 검증(저장 scope 미신뢰).
      // 채점 답은 아래 authority가 소유하고, 이 검증은 corpus 변조 감지 전용이다.
      if (r.contractGold) {
        resolveCanonicalContractScope({ contractGold: r.contractGold, origin: r.origin, title: r.title, excerpt: r.excerpt });
      }
      const entry = adversarialAuthority.byId.get(itemId);
      if (entry) {
        if (entry.evidenceHash !== rec.evidenceHash) throw new Error(`CORRUPT_EVAL_DATA: '${itemId}' evidenceHash diverges from authority`);
        rec.contractProjection = projOf(entry); // 채점 답은 authority 단독 소유
      } else if (adversarialAuthority.auditAmbiguous.has(itemId)) {
        rec.auditAmbiguous = true; // 감사용 보존 — 하드게이트 분모 제외
      } else {
        throw new Error(`CORRUPT_EVAL_DATA: adversarial '${itemId}' not covered by authority`);
      }
    } else if (r.contractGold) {
      rec.contractProjection = contractProjectionOf(r.contractGold, resolveCanonicalContractScope({ contractGold: r.contractGold, origin: r.origin, title: r.title, excerpt: r.excerpt }));
    }
    map.set(itemId, rec);
  }
  // authority의 대체 반례(corpus 밖)를 canonical에 편입 — sealed prediction이 없으면 평가에서 정직하게 미충족으로 남는다.
  if (adversarialAuthority) {
    for (const [id, entry] of adversarialAuthority.byId) {
      if (map.has(id) || entry.source !== "replacement_fixture") continue;
      const item = { blindItemId: id, title: entry.title, excerpt: entry.excerpt, sourceCountry: entry.sourceCountry, language: entry.language, contentKindHint: entry.contentKindHint };
      map.set(id, {
        itemId: id, origin: "adversarial_contract_fixture",
        evidenceHash: entry.evidenceHash, blindPacketHash: blindPacketHashOf(item),
        contractGold: null, contractProjection: projOf(entry), auditAmbiguous: false, replacementFixture: true
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// grounding + 분류 출력 검증(D0 스키마 재사용). admission·geo evidenceSpans 모두 grounding(§10).
// ---------------------------------------------------------------------------
export function checkEvidenceGrounding(output, input) {
  const hay = `${input && input.title ? input.title : ""}\n${input && input.excerpt ? input.excerpt : ""}`;
  const spans = [];
  for (const row of (output && output.admissionCategories) || []) for (const s of (row && row.evidenceSpans) || []) spans.push(s);
  for (const s of (output && output.geoEvidenceSpans) || []) spans.push(s);
  const ungrounded = spans.filter((s) => typeof s !== "string" || s.trim().length === 0 || !hay.includes(s));
  return { grounded: ungrounded.length === 0, ungrounded, checked: spans.length };
}

export function validateClassifierOutput(output, input, versions) {
  const errors = [];
  // D1-G FINAL CLOSURE: 14행 전수·accept∩secondary 규칙은 정본 validateClassificationSchema(v3)
  // 한곳에서만 검증한다 — lab에 중복 규칙을 두지 않는다.
  const schema = validateClassificationSchema(output);
  if (!schema.ok) for (const e of schema.errors) errors.push("schema:" + e);
  const expectedHash = evidenceHashOf({ title: input && input.title, excerpt: input && input.excerpt });
  if (!output || output.evidenceHash !== expectedHash) errors.push("evidence_hash_mismatch");
  for (const k of ["modelVersion", "promptVersion", "taxonomyVersion"]) {
    if (!output || !versions || output[k] !== versions[k]) errors.push(`version_mismatch:${k}`);
  }
  if (!checkEvidenceGrounding(output || {}, input || {}).grounded) errors.push("evidence_not_grounded");
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 독립 gold 계약(§6). production/generator identity 필수(fail-closed). decisionDigest 감사.
// ---------------------------------------------------------------------------
// §4: 모든 gold 행을 canonical authority(frozen corpus 파생) 기준으로 fail-closed 검증한다.
// gold가 적어둔 hash/origin은 정본이 아니다. canonical 인자는 필수.
const trimEq = (id) => typeof id === "string" && id.length > 0 && id === id.trim();
export function validateGoldContract(goldLabels, { identities, canonical } = {}) {
  if (!identities || !isNonEmptyStr(identities.productionModelIdentity) || !isNonEmptyStr(identities.corpusGeneratorIdentity)) {
    throw new TypeError("validateGoldContract: identities required (fail-closed)");
  }
  if (!(canonical instanceof Map)) throw new TypeError("validateGoldContract: canonical authority (Map) required (fail-closed)");
  const labels = Array.isArray(goldLabels) ? goldLabels : (goldLabels && goldLabels.labels) || [];
  const prod = identities.productionModelIdentity, gen = identities.corpusGeneratorIdentity;
  const forbidden = (id) => id === prod || id === gen;
  const rejectedItemIds = [], resolvedIndependentItemIds = [], releaseEligibleItemIds = [], reasons = {};
  const reject = (l, r) => { rejectedItemIds.push(l.itemId); reasons[l.itemId] = r; };
  for (const l of labels) {
    const rec = canonical.get(l.itemId);
    if (!rec) { reject(l, "not_in_canonical_corpus"); continue; }
    if (!isNonEmptyStr(l.origin) || l.origin !== rec.origin) { reject(l, "origin_invalid_or_mismatch"); continue; }
    if (l.evidenceHash !== rec.evidenceHash) { reject(l, "evidence_hash_mismatch"); continue; }
    if (l.blindPacketHash !== rec.blindPacketHash) { reject(l, "top_blind_packet_hash_mismatch"); continue; }
    if (!GOLD_STATES.includes(l.state)) { reject(l, "bad_state"); continue; }
    const acc = l.goldAcceptedCategories || [], rej = l.goldRejectedCategories || [], sec = l.descriptiveSecondaryCategories || [];
    if (![...acc, ...rej, ...sec].every(isKnownCategory)) { reject(l, "unknown_category"); continue; }
    if (new Set(acc).size !== acc.length || new Set(rej).size !== rej.length || new Set(sec).size !== sec.length) { reject(l, "duplicate_category"); continue; }
    const accS = new Set(acc), rejS = new Set(rej), secS = new Set(sec);
    // accepted는 rejected·secondary와 겹칠 수 없다(admit vs reject/descriptive 충돌). rejected∩secondary는 정당(예: secondary인데 admission reject).
    if ([...accS].some((c) => rejS.has(c)) || [...accS].some((c) => secS.has(c))) { reject(l, "category_overlap_conflict"); continue; }
    const labeled = l.state === "agreed" || l.state === "adjudicated" || l.state === "contract_fixture_only";
    if (labeled && !CONTENT_TYPES.includes(l.goldContentType)) { reject(l, "bad_contentType"); continue; }
    if (labeled && (typeof l.humanValid !== "boolean" || typeof l.inScope !== "boolean")) { reject(l, "humanValid_inScope_not_boolean"); continue; }
    const A = l.labelerA, B = l.labelerB, J = l.adjudicator;
    const nrm = (x) => (x && typeof x.identity === "string" ? x.identity : null);
    const parties = [A, B, J].filter(Boolean);
    if (parties.some((x) => x.identity != null && !trimEq(x.identity))) { reject(l, "identity_not_trimmed_or_empty"); continue; }
    const pIds = parties.map((x) => x.identity).filter((x) => x != null);
    if (pIds.some((id) => forbidden(id))) { reject(l, pIds.some((id) => id === prod) ? "production_model_is_labeler" : "corpus_generator_is_labeler"); continue; }
    const aId = nrm(A), bId = nrm(B), jId = nrm(J);
    const recomputed = goldDecisionDigestOf(l);
    if (l.state === "agreed") {
      if (!A || !B || !aId || !bId) { reject(l, "agreed_missing_labeler"); continue; }
      if (aId === bId) { reject(l, "labeler_ab_same_identity"); continue; }
      if (A.blindPacketHash !== rec.blindPacketHash || B.blindPacketHash !== rec.blindPacketHash) { reject(l, "labeler_blind_packet_mismatch"); continue; }
      if (A.decisionDigest !== B.decisionDigest || A.decisionDigest !== l.finalDecisionDigest || recomputed !== l.finalDecisionDigest) { reject(l, "agreed_digest_mismatch"); continue; }
    } else if (l.state === "adjudicated") {
      if (!A || !B || !J || !aId || !bId || !jId) { reject(l, "adjudicated_missing_party"); continue; }
      if (aId === bId) { reject(l, "labeler_ab_same_identity"); continue; }
      if (jId === aId || jId === bId) { reject(l, "adjudicator_not_independent"); continue; }
      if (A.decisionDigest === B.decisionDigest) { reject(l, "adjudicated_ab_agree_should_be_agreed"); continue; }
      if (A.blindPacketHash !== rec.blindPacketHash || B.blindPacketHash !== rec.blindPacketHash || J.blindPacketHash !== rec.blindPacketHash) { reject(l, "party_blind_packet_mismatch"); continue; }
      if (J.decisionDigest !== l.finalDecisionDigest || recomputed !== l.finalDecisionDigest) { reject(l, "adjudicator_digest_mismatch"); continue; }
    }
    // 골드 완성 여부와 모델 성능 분모를 분리한다. 독립 판정된 범위 밖 음성 표본도
    // 골드에는 필요하지만, humanValid·inScope가 아닌 항목은 성능 분모에는 넣지 않는다.
    if (rec.origin === "real_local_snapshot" && (l.state === "agreed" || l.state === "adjudicated")) {
      resolvedIndependentItemIds.push(l.itemId);
      if (l.humanValid === true && l.inScope === true) releaseEligibleItemIds.push(l.itemId);
    }
  }
  return { rejectedItemIds, resolvedIndependentItemIds, releaseEligibleItemIds, reasons };
}

// §4: releaseGoldState는 validator 결과만 사용. canonical origin 기준 real ID가 expectedRealItemIds와 정확히 일치하고
// 그 전부가 독립 해결됐을 때만 sufficient. 모델 성능 분모 eligibility와는 분리한다.
export function releaseGoldState(gold, { identities, canonical, expectedRealItemIds } = {}) {
  const labels = Array.isArray(gold) ? gold : (gold && gold.labels) || [];
  if (!Array.isArray(expectedRealItemIds) || expectedRealItemIds.length === 0) return "insufficient_independent_gold";
  if (!(canonical instanceof Map)) throw new TypeError("releaseGoldState: canonical authority required (fail-closed)");
  const contract = validateGoldContract(labels, { identities, canonical });
  const resolved = new Set(contract.resolvedIndependentItemIds);
  const goldRealIds = new Set(labels.filter((l) => { const r = canonical.get(l.itemId); return r && r.origin === "real_local_snapshot"; }).map((l) => l.itemId));
  const expected = new Set(expectedRealItemIds);
  if (goldRealIds.size !== expected.size || [...expected].some((id) => !goldRealIds.has(id))) return "insufficient_independent_gold";
  return [...expected].every((id) => resolved.has(id)) ? "sufficient_independent_gold" : "insufficient_independent_gold";
}

// ---------------------------------------------------------------------------
// Wilson one-sided lower bound + 추가 표본 계획(§8).
// ---------------------------------------------------------------------------
export function wilsonLowerBound(tp, total, z = WILSON_Z) {
  if (!Number.isFinite(total) || total <= 0) return "insufficient_sample";
  const p = tp / total, z2 = z * z;
  return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / (1 + z2 / total);
}
export function planAdditionalSamples(tp, fp, targetLB = PRECISION_TARGET, z = WILSON_Z, cap = 1e6) {
  const cur = wilsonLowerBound(tp, tp + fp, z);
  if (cur !== "insufficient_sample" && cur >= targetLB) return { needed: 0, projectedLowerBound: cur };
  for (let k = 1; k <= cap; k += 1) {
    const lb = wilsonLowerBound(tp + k, tp + fp + k, z);
    if (lb !== "insufficient_sample" && lb >= targetLB) return { needed: k, projectedLowerBound: lb };
  }
  return { needed: null, capExceeded: true, cap };
}

// prediction에서 accepted를 admissionGate로만 유도한다(§5). bare/무효/미분류는 accepts 없음.
function derivePrediction(pred, input, versions) {
  if (!pred || (pred.status !== "classified" && pred.status !== "cache_hit")) {
    return { accepts: [], abstained: false, valid: false, contentType: null };
  }
  const cls = pred.classification;
  if (!isPlainObject(cls)) return { accepts: [], abstained: false, valid: false, contentType: null };
  if (!validateClassifierOutput(cls, input || {}, versions).ok) return { accepts: [], abstained: false, valid: false, contentType: cls.contentType };
  const abstained = Array.isArray(cls.admissionCategories) && cls.admissionCategories.length > 0
    && cls.admissionCategories.every((r) => r && r.decision === "abstain");
  return { accepts: admissionGate(cls).admitted, abstained, valid: true, contentType: cls.contentType };
}

// A7: 평가 데이터셋 단일 진입 게이트. 빈 ID·중복·orphan·origin 불일치·1:1 불일치·잘못된 status는 즉시 CORRUPT_EVAL_DATA.
export function validateEvaluationDataset({ items = [], gold = [], predictions = [], mode, canonical } = {}) {
  if (mode !== "fixture_only" && mode !== "candidate") throw new Error("CORRUPT_EVAL_DATA: mode must be 'fixture_only' or 'candidate'");
  for (const [label, list] of [["item", items], ["gold", gold], ["prediction", predictions]]) {
    const ids = list.map((x) => x && x.itemId);
    if (ids.some((id) => !isNonEmptyStr(id))) throw new Error(`CORRUPT_EVAL_DATA: empty ${label} id`);
    const seen = new Set();
    for (const id of ids) { if (seen.has(id)) throw new Error(`CORRUPT_EVAL_DATA: duplicate ${label} id '${id}'`); seen.add(id); }
  }
  const itemIds = new Set(items.map((i) => i.itemId));
  const goldIds = new Set(gold.map((g) => g.itemId));
  for (const g of gold) if (!itemIds.has(g.itemId)) throw new Error(`CORRUPT_EVAL_DATA: orphan gold '${g.itemId}'`);
  for (const it of items) if (!goldIds.has(it.itemId)) throw new Error(`CORRUPT_EVAL_DATA: item without gold '${it.itemId}' (not 1:1)`);
  if (canonical instanceof Map) {
    for (const it of items) {                                     // §3.A: item을 canonical과 재대조(itemId/origin/재계산 evidenceHash/blindPacketHash)
      const rec = canonical.get(it.itemId);
      if (!rec) throw new Error(`CORRUPT_EVAL_DATA: item '${it.itemId}' absent from canonical corpus`);
      if (!isNonEmptyStr(it.origin) || it.origin !== rec.origin) throw new Error(`CORRUPT_EVAL_DATA: item origin diverges from canonical '${it.itemId}'`);
      if (evidenceHashOf({ title: it.title, excerpt: it.excerpt }) !== rec.evidenceHash) throw new Error(`CORRUPT_EVAL_DATA: item evidenceHash diverges from canonical '${it.itemId}'`);
      if (blindPacketHashOf(it) !== rec.blindPacketHash) throw new Error(`CORRUPT_EVAL_DATA: item blindPacketHash diverges from canonical '${it.itemId}'`);
    }
    const gById = new Map(gold.map((g) => [g.itemId, g]));
    for (const [id, rec] of canonical) {                        // §5: contract fixture gold가 canonical과 다르면 평가 전 corrupt
      const g = gById.get(id);
      if (rec.contractGold && g && g.state === "contract_fixture_only") {
        const proj = (o, k) => JSON.stringify({ contentType: o.contentType, accepted: [...(o[k.a] || [])].map(String).sort(), rejected: [...(o[k.r] || [])].map(String).sort(), secondary: [...(o[k.s] || [])].map(String).sort() });
        const gp = proj({ contentType: g.goldContentType, a: g.goldAcceptedCategories, r: g.goldRejectedCategories, s: g.descriptiveSecondaryCategories }, { a: "a", r: "r", s: "s" });
        const cp = proj({ contentType: rec.contractGold.contentType, a: rec.contractGold.acceptedCategories, r: rec.contractGold.rejectedCategories, s: rec.contractGold.descriptiveSecondaryCategories }, { a: "a", r: "r", s: "s" });
        if (gp !== cp) throw new Error(`CORRUPT_EVAL_DATA: contract fixture '${id}' gold diverges from canonical contractGold`);
      }
    }
  }
  for (const p of predictions) {
    if (!itemIds.has(p.itemId)) throw new Error(`CORRUPT_EVAL_DATA: orphan prediction '${p.itemId}'`);
    if (!PREDICTION_STATUSES.includes(p.status)) throw new Error(`CORRUPT_EVAL_DATA: bad prediction status '${p.status}'`);
    if ((p.status === "classified" || p.status === "cache_hit") && !isPlainObject(p.classification)) throw new Error(`CORRUPT_EVAL_DATA: ${p.status} missing classification '${p.itemId}'`);
  }
  if (mode === "candidate") {
    const predIds = new Set(predictions.map((p) => p.itemId));
    for (const it of items) if (!predIds.has(it.itemId)) throw new Error(`CORRUPT_EVAL_DATA: candidate mode missing prediction for '${it.itemId}'`);
  } else if (predictions.length > 0) {
    throw new Error("CORRUPT_EVAL_DATA: fixture_only mode requires 0 predictions");
  }
  return { ok: true, items: items.length, gold: gold.length, predictions: predictions.length };
}

// ---------------------------------------------------------------------------
// 평가(§7). 단위 = item × category admission row(14행 항상). release는 독립 검증 gold만.
// A10: gates lock을 시작 즉시 검증(빈·변조에 기본값 대입 금지). A7 데이터셋 게이트 통과 필수.
// ---------------------------------------------------------------------------
export function evaluatePredictions({ items = [], gold = [], predictions = [], versions = {}, gatesLock = {}, identities, mode, canonical } = {}) {
  const lockCheck = validateGatesLock(gatesLock);
  if (!lockCheck.ok) throw new Error(`CORRUPT_GATES_LOCK: ${lockCheck.errors.join(",")}`);
  // §3.A: canonical authority는 frozen corpus에서 만들어 필수 인자로 넣는다. items에서 내부 생성하지 않는다.
  if (!(canonical instanceof Map)) throw new Error("CORRUPT_EVAL_DATA: canonical authority (Map) required (fail-closed)");
  validateEvaluationDataset({ items, gold, predictions, mode, canonical });
  const expectedRealItemIds = [...canonical.values()].filter((r) => r.origin === "real_local_snapshot").map((r) => r.itemId);
  const goldById = new Map(gold.map((g) => [g.itemId, g]));
  const predById = new Map(predictions.map((p) => [p.itemId, p]));
  const contract = validateGoldContract(gold, { identities, canonical });
  const releaseSet = new Set(contract.releaseEligibleItemIds);
  const CATS = [...ADMISSION_CATEGORY_IDS];

  const perCategory = {};
  for (const c of CATS) perCategory[c] = { tp: 0, fp: 0, fn: 0, predictedAccepts: 0, goldPositives: 0 };
  const evaluableItemIds = [];
  let secondaryOnlyAdmission = 0, unknownOtherOrdinaryAdmission = 0, selectedCategoryLeak = 0;
  // §3.D: effective non-answer(all-abstain·withheld·error·schema_reject·missing/invalid). 분모 = eligible·goldContentType≠other.
  let enaDenom = 0, enaCount = 0;
  const enaBreakdown = { all_abstain: 0, withheld: 0, error: 0, schema_reject: 0, missing_or_invalid: 0 };

  for (const it of items) {
    const g = goldById.get(it.itemId);
    if (!g || !releaseSet.has(it.itemId)) continue;
    evaluableItemIds.push(it.itemId);
    const pred = predById.get(it.itemId);
    const d = derivePrediction(pred, it, versions);
    const predAccepts = new Set(d.accepts);
    const goldAccepts = new Set(g.goldAcceptedCategories || []);
    const goldRejects = new Set(g.goldRejectedCategories || []);
    const secondary = new Set(g.descriptiveSecondaryCategories || []);
    for (const c of CATS) {
      const pa = predAccepts.has(c), ga = goldAccepts.has(c), row = perCategory[c];
      if (pa) row.predictedAccepts += 1;
      if (ga) row.goldPositives += 1;
      if (pa && ga) row.tp += 1;
      else if (pa && !ga) row.fp += 1;
      else if (!pa && ga) row.fn += 1;
    }
    for (const c of predAccepts) {
      if (!goldAccepts.has(c) && secondary.has(c)) secondaryOnlyAdmission += 1;
      if (c === "unknown" || c === "other") unknownOtherOrdinaryAdmission += 1;
      if (goldRejects.has(c)) selectedCategoryLeak += 1;
    }
    if (g.goldContentType !== "other") {
      enaDenom += 1;
      let cause = null;
      if (!pred) cause = "missing_or_invalid";
      else if (pred.status === "withheld") cause = "withheld";
      else if (pred.status === "error") cause = "error";
      else if (pred.status === "schema_reject") cause = "schema_reject";
      else if (!d.valid) cause = "missing_or_invalid";
      else if (d.abstained) cause = "all_abstain";
      if (cause) { enaCount += 1; enaBreakdown[cause] += 1; }
    }
  }
  for (const c of CATS) {
    const r = perCategory[c];
    r.precision = (r.tp + r.fp) > 0 ? r.tp / (r.tp + r.fp) : null;
    r.recall = (r.tp + r.fn) > 0 ? r.tp / (r.tp + r.fn) : null;
    r.precisionLowerBound = (r.tp + r.fp) > 0 ? wilsonLowerBound(r.tp, r.tp + r.fp, WILSON_Z) : "insufficient_sample";
  }

  const CT = ["news", "community", "deal", "other"];
  const confusion = {}; for (const a of CT) { confusion[a] = {}; for (const b of CT) confusion[a][b] = 0; }
  const perType = {}; for (const t of CT) perType[t] = { tp: 0, fp: 0, fn: 0 };
  const critSet = new Set((gatesLock.gates && gatesLock.gates.contentType && gatesLock.gates.contentType.criticalConfusions) || ["community->news", "deal->news"]);
  let criticalConfusionCount = 0;
  for (const it of items) {
    const g = goldById.get(it.itemId);
    if (!g) continue;
    const d = derivePrediction(predById.get(it.itemId), it, versions);
    if (!d.valid || !CT.includes(g.goldContentType) || !CT.includes(d.contentType)) continue;
    confusion[g.goldContentType][d.contentType] += 1;
    for (const t of CT) {
      if (d.contentType === t && g.goldContentType === t) perType[t].tp += 1;
      else if (d.contentType === t && g.goldContentType !== t) perType[t].fp += 1;
      else if (d.contentType !== t && g.goldContentType === t) perType[t].fn += 1;
    }
    if (g.goldContentType !== d.contentType && critSet.has(`${g.goldContentType}->${d.contentType}`)) criticalConfusionCount += 1;
  }
  for (const t of CT) {
    const r = perType[t];
    r.precisionLowerBound = (r.tp + r.fp) > 0 ? wilsonLowerBound(r.tp, r.tp + r.fp, WILSON_Z) : "insufficient_sample";
  }

  const pairMap = new Map();
  for (const it of items) {
    if (!it.mutationPairId) continue;
    if (!pairMap.has(it.mutationPairId)) pairMap.set(it.mutationPairId, { type: it.mutationType, original: null, variant: null });
    const p = pairMap.get(it.mutationPairId);
    const d = derivePrediction(predById.get(it.itemId), it, versions);
    const acc = d.valid ? [...d.accepts].sort() : null;
    if (it.mutationRole === "original") p.original = acc;
    else if (it.mutationRole === "variant") p.variant = acc;
  }
  const mutationPairs = [];
  for (const [pairId, p] of pairMap) {
    const complete = p.original !== null && p.variant !== null;
    const same = complete && JSON.stringify(p.original) === JSON.stringify(p.variant);
    const ok = complete ? (p.type === "semantic" ? !same : p.type === "invariance" ? same : false) : false;
    mutationPairs.push({ pairId, type: p.type, complete, labelChanged: complete ? !same : null, ok });
  }
  mutationPairs.sort((a, b) => (a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0));
  const mutationAllOk = mutationPairs.length > 0 && mutationPairs.every((m) => m.ok);

  // D1-G FINAL CLOSURE: adversarial 채점 답은 superseding authority(canonical rec.contractProjection)가
  // 단독 소유한다 — corpus contractGold를 채점에 쓰지 않는다. 분모는 canonical의 decisive 레코드
  // (대체 반례 포함, items 부재 시 invalidOrMissing으로 정직 집계). 감사용 ambiguous는 분모 제외.
  const expectedAdversarial = (gatesLock.gates && gatesLock.gates.adversarial && Number.isFinite(gatesLock.gates.adversarial.expectedContractFixtures))
    ? gatesLock.gates.adversarial.expectedContractFixtures : null;
  const adv = { expectedContractFixtures: expectedAdversarial, expectedCount: 0, evaluatedValid: 0, contentTypeMismatch: 0, scopeMismatch: 0, invalidOrMissing: 0, selectedCategoryLeak: 0, unexpectedAdmission: 0, expectedAdmissionMiss: 0, secondaryOnlyAdmission: 0, unknownOtherOrdinaryAdmission: 0, auditAmbiguousExcluded: 0 };
  const itemById = new Map(items.map((i) => [i.itemId, i]));
  for (const [advId, rec] of canonical) {
    if (rec.origin !== "adversarial_contract_fixture") continue;
    if (rec.auditAmbiguous) { adv.auditAmbiguousExcluded += 1; continue; }
    adv.expectedCount += 1;
    const proj = rec.contractProjection;
    const it = itemById.get(advId);
    const pred = predById.get(advId);
    const d = it ? derivePrediction(pred, it, versions) : { valid: false };
    if (!proj || !d.valid) { adv.invalidOrMissing += 1; continue; }
    adv.evaluatedValid += 1;
    const cAcc = new Set(proj.accepted || []), cRej = new Set(proj.rejected || []), cSec = new Set(proj.secondary || []);
    if (d.contentType !== proj.contentType) adv.contentTypeMismatch += 1;
    const predScope = pred && pred.classification ? pred.classification.scopeClass : null;
    if (proj.scope && predScope !== proj.scope) adv.scopeMismatch += 1;
    const accSet = new Set(d.accepts);
    for (const c of accSet) {
      if (cRej.has(c)) adv.selectedCategoryLeak += 1;
      if (!cAcc.has(c)) adv.unexpectedAdmission += 1;
      if (!cAcc.has(c) && cSec.has(c)) adv.secondaryOnlyAdmission += 1;
      if (c === "unknown" || c === "other") adv.unknownOtherOrdinaryAdmission += 1;
    }
    for (const c of cAcc) if (!accSet.has(c)) adv.expectedAdmissionMiss += 1;
  }
  const completeAdversarialSet = expectedAdversarial !== null && adv.expectedCount === expectedAdversarial
    && adv.evaluatedValid === expectedAdversarial && adv.invalidOrMissing === 0;
  // D1-H: selected-category admission and event geography are independent quality axes.
  // Keep the historical combined pass for backward compatibility; callers can now see which axis failed.
  adv.categoryAdmissionPass = completeAdversarialSet && adv.contentTypeMismatch === 0 && adv.selectedCategoryLeak === 0
    && adv.unexpectedAdmission === 0 && adv.expectedAdmissionMiss === 0 && adv.secondaryOnlyAdmission === 0
    && adv.unknownOtherOrdinaryAdmission === 0;
  adv.scopePass = completeAdversarialSet && adv.scopeMismatch === 0;
  adv.pass = adv.categoryAdmissionPass && adv.scopePass;

  const evaluableItems = evaluableItemIds.length;
  const anyAccepts = CATS.some((c) => (perCategory[c].tp + perCategory[c].fp) > 0);
  const reasons = [];
  if (evaluableItems === 0) reasons.push("insufficient_independent_gold");
  if (!anyAccepts) reasons.push("no_evaluable_accepts");
  const verdict = (evaluableItems > 0 && anyAccepts) ? "METRICS_EVALUABLE" : "HOLD";
  const goldState = releaseGoldState(gold, { identities, canonical, expectedRealItemIds });

  return {
    mode, // §3.C: mode 보존 — evaluateGates가 non-candidate 성능 gate를 NOT_EVALUATED로 만든다.
    perCategory,
    contentType: { confusion, perType, criticalConfusionCount },
    effectiveNonAnswer: { denominator: enaDenom, effectiveNonAnswerCount: enaCount, effectiveNonAnswerRate: enaDenom > 0 ? enaCount / enaDenom : null, breakdown: enaBreakdown },
    adversarial: adv,
    releaseChecks: { selectedCategoryLeak, secondaryOnlyAdmission, unknownOtherOrdinaryAdmission },
    mutation: { pairs: mutationPairs, allOk: mutationAllOk },
    goldContract: contract,
    release: { goldState, evaluableItems, evaluableItemIds: [...evaluableItemIds].sort(), verdict, reasons }
  };
}

// ---------------------------------------------------------------------------
// 게이트(§7·§8). release는 D1-A에서 항상 false(real gold pending·실모델 미실행).
// ---------------------------------------------------------------------------
export function evaluateGates(metrics, gatesLock = {}, gold = [], { identities } = {}) {
  const lockCheck = validateGatesLock(gatesLock); // A10: 빈·변조 lock에 기본값 대입 금지 — 즉시 throw.
  if (!lockCheck.ok) throw new Error(`CORRUPT_GATES_LOCK: ${lockCheck.errors.join(",")}`);
  const gates = gatesLock.gates;
  const goldState = metrics.release ? metrics.release.goldState : "insufficient_independent_gold";
  // §3.C: candidate가 아니면(fixture_only 등) 어떤 성능 gate도 PASS할 수 없다 — 전부 NOT_EVALUATED.
  if (metrics.mode !== "candidate") {
    const ne = () => ({ pass: false, status: "NOT_EVALUATED" });
    return { contentType: ne(), abstain: ne(), adversarial: ne(), mutation: ne(), precision: ne(),
      recall: { pass: false, status: gates.recall.baseline }, qualifiedSupply: { pass: false, status: gates.qualifiedSupply.baseline },
      release: { pass: false, goldState, reason: "not_candidate_mode / real_model_not_run" } };
  }
  const contentType = { pass: metrics.contentType.criticalConfusionCount === 0, criticalConfusionCount: metrics.contentType.criticalConfusionCount, perType: metrics.contentType.perType };
  // §3.D: abstain(effective non-answer) gate — rate ≤ maxRate. 0분모는 PASS가 아니라 insufficient.
  const ena = metrics.effectiveNonAnswer || {};
  const abstain = ena.denominator === 0 || ena.effectiveNonAnswerRate == null
    ? { pass: false, status: "insufficient_sample", rate: null, max: gates.abstain.maxRate }
    : { pass: ena.effectiveNonAnswerRate <= gates.abstain.maxRate, rate: ena.effectiveNonAnswerRate, max: gates.abstain.maxRate, breakdown: ena.breakdown };
  const adversarial = { pass: metrics.adversarial.pass === true, ...metrics.adversarial }; // A9 contract-fixture 평가 결과
  const mutation = { pass: metrics.mutation.allOk, pairs: metrics.mutation.pairs };
  const target = gates.precision.targetLowerBound;
  const rows = Object.entries(metrics.perCategory).map(([category, r]) => ({ category, lowerBound: r.precisionLowerBound }));
  const precision = {
    pass: rows.length > 0 && rows.every((r) => r.lowerBound !== "insufficient_sample" && r.lowerBound >= target),
    insufficient: rows.some((r) => r.lowerBound === "insufficient_sample"), target, rows
  };
  const recall = { pass: false, status: gates.recall.baseline };
  const qualifiedSupply = { pass: false, status: gates.qualifiedSupply.baseline };
  return { contentType, abstain, adversarial, mutation, precision, recall, qualifiedSupply,
    release: { pass: false, goldState, reason: "insufficient_independent_gold / real_model_not_run" } };
}

// §3.B: gates.lock semantic 트리 정본(note 제외). 값·배열 순서·키 집합까지 exact deep comparison.
const D1_EXPECTED_GATES = Object.freeze({
  contract: "NOWHOT-SELECTION-D1-GATES-001",
  phase: "D1-A",
  categories: ["news", "tech", "auto", "science", "business", "gaming", "sports", "culture", "life", "humor", "politics", "realestate", "fashion", "art"],
  wilson: {
    z: 1.6448536269514722, confidence: "0.95_one_sided",
    reference: [
      { tp: 97, n: 100, lowerBound: 0.927289656713096 }, { tp: 49, n: 50, lowerBound: 0.915194705751690 },
      { tp: 20, n: 20, lowerBound: 0.880842162639036 }, { tp: 20, n: 21, lowerBound: 0.812196428623541 },
      { tp: 196, n: 200, lowerBound: 0.956196542832956 }
    ]
  },
  gates: {
    precision: { unit: "item_x_category_admission_row", targetLowerBound: 0.98, zeroSampleIsInsufficient: true, roundingRule: "gate on raw value before rounding", allCategoriesRequired: true },
    recall: { rule: "candidate_recall >= frozen legacy baseline on same gold", baseline: "pending_exact_legacy_measurement", hardHold: true },
    qualifiedSupply: { minAcceptWhenUpstreamAtLeast: 8, preserveAllValidWhenUpstreamBelow: true, rule: "candidate qualified supply >= frozen legacy qualified supply", baseline: "not_measured", hardHold: true },
    abstain: { maxRate: 0.20, denominator: "humanValid_true_and_inScope_true_and_real_and_goldContentType_not_other", rationale: "precision gaming 방지 Codex 기술 기본값", changeRequires: "append_only_david_decision" },
    adversarial: { expectedContractFixtures: 10, selectedCategoryLeak: 0, secondaryOnlyAdmission: 0, unknownOtherOrdinaryAdmission: 0, contentTypeMismatch: 0, invalidOrMissing: 0, unexpectedAdmission: 0, expectedAdmissionMiss: 0, contractFixtureHardGate: true },
    contentType: { criticalConfusions: ["community->news", "deal->news"], maxCritical: 0, perTypePrecisionLowerBound: "reported" },
    mutation: { semanticPairMustChangeLabel: true, invariancePairMustHoldLabel: true, incompleteOrPendingPairBlocksPass: true }
  },
  releaseGoldState: "insufficient_independent_gold",
  releasePass: false,
  doesNotProve: ["실제 모델의 분류 정확도(REAL_MODEL_NOT_RUN)", "제품 품질 PASS(PRODUCT_NOT_PROVEN)", "런타임 서빙 개선(D2_RUNTIME_NOT_WIRED)", "라이브 피드 변경(LIVE_UNCHANGED)"]
});

function deepEqualStrict(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqualStrict(x, b[i]));
  }
  if (typeof a === "object") {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false; // missing·extra key 거부
    return ak.every((k) => deepEqualStrict(a[k], b[k]));
  }
  return false;
}

// gates lock 엄격 검증(§3.B). note 제외 semantic tree를 frozen expected와 exact deep-compare + Wilson 독립 재계산.
export function validateGatesLock(gates) {
  if (!isPlainObject(gates)) return { ok: false, errors: ["not_an_object"] };
  const errors = [];
  const { note, ...semantic } = gates; // note만 제외, 그 외 모든 semantic leaf는 정확 일치해야 함
  void note;
  if (!deepEqualStrict(semantic, D1_EXPECTED_GATES)) errors.push("semantic_tree_mismatch");
  const wl = gates.wilson;
  if (!isPlainObject(wl) || !Array.isArray(wl.reference)
    || !wl.reference.every((v) => v && Math.abs(wilsonLowerBound(v.tp, v.n, WILSON_Z) - v.lowerBound) < 1e-12)) errors.push("wilson_recompute");
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 캐시·예산·장애(§9). adapter injected. budget 5필드 fail-closed. 실패 호출도 maxCalls 포함.
// verified cache hit만 0비용. schema/hash/version 재검증. overrun/timeout no-cache.
// ---------------------------------------------------------------------------
export const estTokens = (v) => Math.ceil((typeof v === "string" ? v.length : JSON.stringify(v || "").length) / 4);
const COST_PER_1K_USD = 0.001;
const estCost = (tokens) => Math.round((tokens * COST_PER_1K_USD / 1000) * 1e6) / 1e6;

export function runCachedClassification({ items = [], adapter, versions, budget = {}, cache = new Map(), clock = () => 0 } = {}) {
  if (typeof adapter !== "function") throw new TypeError("runCachedClassification: adapter function required");
  for (const k of ["modelVersion", "promptVersion", "taxonomyVersion"]) {
    if (!isNonEmptyStr(versions && versions[k])) throw new TypeError(`runCachedClassification: versions.${k} required`);
  }
  for (const k of ["maxCalls", "maxInputTokens", "maxOutputTokens", "maxEstimatedCost", "timeoutMs"]) {
    if (!isFiniteNonNeg(budget[k])) throw new TypeError(`runCachedClassification: budget.${k} must be a finite number >= 0 (fail-closed)`);
  }
  const stats = { calls: 0, cacheHits: 0, withheld: 0, schemaReject: 0, errors: 0, explicitAbstain: 0, budgetOverrun: 0, inputTokens: 0, outputTokens: 0, secondPass: 0 };
  const startedAt = clock();
  const results = [];
  for (const rawItem of items) {
    const now = clock();
    const input = normalizeClassifierInput(rawItem);
    const request = buildStructuredRequest(input, versions);
    const key = request.cacheKey;
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (validateClassifierOutput(cached, input, versions).ok) {
        stats.cacheHits += 1;
        results.push({ itemId: input.itemId, status: "cache_hit", cacheKey: key, classification: cached });
        continue;
      }
      cache.delete(key); // 손상 cache 제거 → 재분류(예산 있으면)
    }
    const nextInputTokens = estTokens(request);
    // A11: preflight — maxCalls·input tokens·timeout·비용(nextInputTokens 포함) 상한 도달 전 호출 시작 0.
    if (stats.calls >= budget.maxCalls
      || stats.inputTokens + nextInputTokens > budget.maxInputTokens
      || stats.outputTokens > budget.maxOutputTokens
      || estCost(stats.inputTokens + nextInputTokens + stats.outputTokens) > budget.maxEstimatedCost
      || (now - startedAt) >= budget.timeoutMs) {
      stats.withheld += 1;
      results.push({ itemId: input.itemId, status: "withheld", reason: "budget_stop" });
      continue;
    }
    stats.calls += 1; // adapter 시작 전 증가 — 실패 호출도 예산 포함
    stats.inputTokens += nextInputTokens;
    let output;
    try {
      output = adapter({
        ...request,
        limits: {
          remainingCalls: budget.maxCalls - stats.calls,
          remainingInputTokens: budget.maxInputTokens - stats.inputTokens,
          remainingOutputTokens: budget.maxOutputTokens - stats.outputTokens,
          remainingCost: budget.maxEstimatedCost - estCost(stats.inputTokens + stats.outputTokens),
          remainingMs: budget.timeoutMs - (now - startedAt)
        }
      });
    } catch {
      stats.errors += 1;
      results.push({ itemId: input.itemId, status: "error", reason: "classifier_unavailable" });
      continue;
    }
    stats.outputTokens += estTokens(output);
    // A11: adapter 반환 직후 clock() 재호출(stale pre-call now 사용 금지). timeout이면 no-cache.
    const postNow = clock();
    if ((postNow - startedAt) >= budget.timeoutMs) {
      stats.withheld += 1;
      results.push({ itemId: input.itemId, status: "withheld", reason: "budget_timeout" }); // no-cache
      continue;
    }
    if (stats.outputTokens > budget.maxOutputTokens || estCost(stats.inputTokens + stats.outputTokens) > budget.maxEstimatedCost) {
      stats.budgetOverrun += 1; stats.withheld += 1; // §8: overrun은 budgetOverrun+withheld 동시, no-cache
      results.push({ itemId: input.itemId, status: "withheld", reason: "budget_overrun" });
      continue;
    }
    const valid = validateClassifierOutput(output, input, versions);
    if (!valid.ok) { stats.schemaReject += 1; results.push({ itemId: input.itemId, status: "schema_reject", reason: valid.errors[0] }); continue; } // no-cache
    // A11: 유효 all-abstain 결과는 explicitAbstain 증가.
    if (Array.isArray(output.admissionCategories) && output.admissionCategories.length > 0 && output.admissionCategories.every((r) => r && r.decision === "abstain")) {
      stats.explicitAbstain += 1;
    }
    cache.set(key, output); // verified 결과만 캐시
    results.push({ itemId: input.itemId, status: "classified", cacheKey: key, classification: output, cached: true });
  }
  stats.estimatedCost = estCost(stats.inputTokens + stats.outputTokens);
  stats.currency = "USD";
  return { results, stats, cache, versions: { ...versions }, startedAt, budget };
}

// ---------------------------------------------------------------------------
// 결정적 receipt(§10). calls≠classified 분리. runId digest에 corpus/gold/gates SHA·버전·집계·사용량.
// title/excerpt/url/cacheKey/secret/error 원문 없음.
// ---------------------------------------------------------------------------
export function buildReceipt(runState, clock = () => 0) {
  const s = (runState && runState.stats) || {};
  const v = (runState && runState.versions) || {};
  const results = Array.isArray(runState && runState.results) ? runState.results : [];
  const classified = results.filter((r) => r.status === "classified").length;
  const cacheHit = results.filter((r) => r.status === "cache_hit").length;
  const at = clock();
  const digestBasis = {
    corpusSha: (runState && runState.corpusSha) || null, goldSha: (runState && runState.goldSha) || null, gatesSha: (runState && runState.gatesSha) || null,
    v, at, calls: s.calls || 0, classified, cacheHit, withheld: s.withheld || 0, schemaReject: s.schemaReject || 0, errors: s.errors || 0, budgetOverrun: s.budgetOverrun || 0,
    inputTokens: s.inputTokens || 0, outputTokens: s.outputTokens || 0
  };
  const runId = crypto.createHash("sha256").update(JSON.stringify(digestBasis)).digest("hex").slice(0, 16);
  return {
    runId,
    contract: CLASSIFIER_LAB_CONTRACT.stableId,
    corpusSha: digestBasis.corpusSha, goldSha: digestBasis.goldSha, gatesSha: digestBasis.gatesSha,
    modelVersion: v.modelVersion || null, promptVersion: v.promptVersion || null, taxonomyVersion: v.taxonomyVersion || null,
    totalInputs: results.length,
    calls: s.calls || 0,        // adapter 호출 수(실패·overrun 포함)
    classified,                 // 유효 분류 수(status classified)
    cacheHit,
    withheld: s.withheld || 0, schemaReject: s.schemaReject || 0, error: s.errors || 0, budgetOverrun: s.budgetOverrun || 0, explicitAbstain: s.explicitAbstain || 0,
    inputTokens: s.inputTokens || 0, outputTokens: s.outputTokens || 0, estimatedCost: s.estimatedCost || 0, currency: s.currency || "USD",
    latencyP50: 0, latencyP95: 0, secondPassCount: s.secondPass || 0,
    doesNotProve: [
      "실제 모델 분류 정확도(REAL_MODEL_NOT_RUN)",
      "제품 품질 PASS(PRODUCT_NOT_PROVEN)",
      "런타임 서빙(D2_RUNTIME_NOT_WIRED)",
      "라이브 변경(LIVE_UNCHANGED)"
    ]
  };
}

// ===========================================================================
// D1-C — 실모델 측정 경로(가격 인식 async). 순수성 유지: 실제 호출은 injected
// callModel(async)로만, legacy baseline은 injected snapshot 데이터로만 계산한다.
// 기존 동기 runCachedClassification 동작은 손대지 않는다(§5).
// ===========================================================================

// §9: 공식 단가를 코드 계약으로 잠근다(flat estCost와 별개 — 실제 usage 토큰 기준).
export const D1C_PRICING = Object.freeze({ inputPerMTok: 1, outputPerMTok: 5, currency: "USD" });
export function pricedCostUsd(inputTokens, outputTokens, pricing = D1C_PRICING) {
  const i = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const o = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  return (i / 1e6) * pricing.inputPerMTok + (o / 1e6) * pricing.outputPerMTok;
}

// §B(122): 예산 판정 단일 순수 함수(runner·실행 루프가 공유, 중복 공식 금지). deadline은 시계 기반이라 별도.
export function budgetAllowsCall({ lifetimeCalls, lifetimeInput, lifetimeOutput, estInput, budget, pricing = D1C_PRICING }) {
  const projCost = pricedCostUsd(lifetimeInput + estInput, lifetimeOutput + budget.maxOutputTokensPerCall, pricing);
  return lifetimeCalls < budget.maxCalls
    && lifetimeInput + estInput <= budget.maxInputTokens
    && lifetimeOutput + budget.maxOutputTokensPerCall <= budget.maxOutputTokens
    && projCost <= budget.maxCostUsd;
}

// §5(integrity-02): 영속 lifetime ledger 요약. recovery + settle을 누적하고, 미정산 reserve는
// estimated input + max output을 lifetime 사용량에 포함한다. cost는 저장값을 신뢰하지 않고 token+pricing으로 재계산.
export function ledgerSummary(records, pricing = D1C_PRICING) {
  const recs = records || [];
  let calls = 0, canceledCalls = 0, inputTokens = 0, outputTokens = 0, recoveryCount = 0;
  const reserves = new Map(); const seenCall = new Map(); // callId -> "reserve"|"settle"
  const nnInt = (v) => Number.isInteger(v) && v >= 0; // 유한 0 이상 정수만
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("LEDGER_CORRUPT_HOLD: record not an object");
    if (r.seq !== i) throw new Error(`LEDGER_CORRUPT_HOLD: seq must be contiguous integer(${i}), got ${JSON.stringify(r.seq)}`);
    if (r.type === "recovery") {
      recoveryCount += 1;
      if (recoveryCount > 1) throw new Error("LEDGER_CORRUPT_HOLD: multiple recovery");
      if (i !== 0) throw new Error("LEDGER_CORRUPT_HOLD: recovery must be seq 0");
      if (!nnInt(r.calls) || !nnInt(r.inputTokens) || !nnInt(r.outputTokens)) throw new Error("LEDGER_CORRUPT_HOLD: recovery calls/tokens must be non-neg int");
      calls += r.calls; inputTokens += r.inputTokens; outputTokens += r.outputTokens;
    } else if (r.type === "reserve") {
      const cid = typeof r.callId === "string" ? r.callId.trim() : "";
      if (!cid) throw new Error("LEDGER_CORRUPT_HOLD: reserve callId empty");
      if (seenCall.has(cid)) throw new Error("LEDGER_CORRUPT_HOLD: duplicate callId");
      if (!nnInt(r.estInput) || !nnInt(r.maxOutput)) throw new Error("LEDGER_CORRUPT_HOLD: reserve estimate must be non-neg int");
      seenCall.set(cid, "reserve"); reserves.set(cid, { estInput: r.estInput, maxOutput: r.maxOutput });
    } else if (r.type === "settle") {
      const cid = typeof r.callId === "string" ? r.callId.trim() : "";
      if (!cid) throw new Error("LEDGER_CORRUPT_HOLD: settle callId empty");
      if (!reserves.has(cid)) throw new Error("LEDGER_CORRUPT_HOLD: settle without matching unsettled reserve");
      if (!nnInt(r.inputTokens) || !nnInt(r.outputTokens)) throw new Error("LEDGER_CORRUPT_HOLD: settle usage must be non-neg int");
      reserves.delete(cid); seenCall.set(cid, "settle");
      calls += 1; inputTokens += r.inputTokens; outputTokens += r.outputTokens;
    } else if (r.type === "cancel") {
      const cid = typeof r.callId === "string" ? r.callId.trim() : "";
      if (!cid || !reserves.has(cid)) throw new Error("LEDGER_CORRUPT_HOLD: cancel without matching unsettled reserve");
      if (!isNonEmptyStr(r.reason)) throw new Error("LEDGER_CORRUPT_HOLD: cancel reason empty");
      reserves.delete(cid); seenCall.set(cid, "cancel");
      calls += 1; canceledCalls += 1;
    } else {
      throw new Error(`LEDGER_CORRUPT_HOLD: unknown record type ${JSON.stringify(r.type)}`);
    }
  }
  let unsettledInput = 0, unsettledOutput = 0;
  for (const [, v] of reserves) { unsettledInput += v.estInput; unsettledOutput += v.maxOutput; }
  const totIn = inputTokens + unsettledInput, totOut = outputTokens + unsettledOutput;
  return { calls: calls + reserves.size, settledCalls: calls - canceledCalls, canceledCalls, inputTokens: totIn, outputTokens: totOut, costUsd: pricedCostUsd(totIn, totOut, pricing), unsettledReserves: reserves.size };
}
// 테스트용 in-memory ledger(단조 seq). production CLI는 파일 ledger(run-d1c)를 주입한다.
export function createInMemoryLedger(seed = []) {
  const records = seed.slice();
  return {
    append(rec) {
      ledgerSummary(records); // §5: 기존 ledger 전수검증 아래에서만 append
      const r = { ...rec, seq: records.length }; // §5: seq는 파일 순서로 강제(호출자 주입 불가)
      records.push(r);
      ledgerSummary(records); // §5: append 후 재검증
      return r;
    },
    read() { return records.slice(); },
    summary(pricing) { return ledgerSummary(records, pricing); }
  };
}

// §8: 모델이 반환하는 semantic 필드 json_schema(코드가 나머지 필드를 채운다).
export const D1C_PROMPT_VERSION = "nowhot-selection-d1c-p1";
export const D1C_CLAIM_ORIGIN_GROUP = "unresolved"; // D1 실험실 보수값(주장 기원 미해결).
export const D1C_SEMANTIC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    contentType: { type: "string", enum: [...CONTENT_TYPES] },
    primaryCategory: { type: "string", enum: [...ADMISSION_CATEGORY_IDS, "unknown"] },
    descriptiveSecondaryCategories: { type: "array", items: { type: "string", enum: [...ADMISSION_CATEGORY_IDS] } },
    admissionCategories: {
      type: "array",
      // D1-G 실측 정정(2026-08-20): API structured-output이 min/maxItems를 거부(400 실증,
      // d1h-20260820-01 UNSETTLED_HOLD의 원인) — 와이어 스키마에서는 뺀다. 14행 정확 강제는
      // 정본 validator v3(admission_rows_not_exact_taxonomy)가 응답 후 fail-closed로 수행한다.
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: [...ADMISSION_CATEGORY_IDS] },
          decision: { type: "string", enum: ["accept", "abstain", "reject"] },
          confidence: { type: "number" },
          evidenceSpans: { type: "array", items: { type: "string" } },
          reasonCodes: { type: "array", items: { type: "string" } }
        },
        required: ["category", "decision", "confidence", "evidenceSpans", "reasonCodes"]
      }
    },
    eventJurisdictions: { type: "array", items: { type: "string" } },
    relevanceCountries: { type: "array", items: { type: "string" } },
    geoEvidenceSpans: { type: "array", items: { type: "string" } }
  },
  required: ["contentType", "primaryCategory", "descriptiveSecondaryCategories", "admissionCategories", "eventJurisdictions", "relevanceCountries", "geoEvidenceSpans"]
});

export function compactCategorySemanticSchema(policy) {
  if (!isPlainObject(policy) || policy.sourceEvidence !== "title_then_excerpt"
    || !isPlainObject(policy.eventTypes) || Object.keys(policy.eventTypes).length === 0
    || !isNonEmptyStr(policy.emptyEventType) || !Object.hasOwn(policy.eventTypes, policy.emptyEventType)) {
    throw new TypeError("compactCategorySemanticSchema: valid policy required");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      contentType: { type: "string", enum: [...CONTENT_TYPES] },
      eventType: { type: "string", enum: Object.keys(policy.eventTypes) },
      impactCategories: { type: "array", items: { type: "string", enum: [...ADMISSION_CATEGORY_IDS] } },
      subjectCategories: { type: "array", items: { type: "string", enum: [...ADMISSION_CATEGORY_IDS] } },
      confidence: { type: "number" }
    },
    required: ["contentType", "eventType", "impactCategories", "subjectCategories", "confidence"]
  };
}

function compactSemanticParts(semantic, policy) {
  if (!isPlainObject(semantic)) throw new TypeError("compact semantic object required");
  const semanticKeys = ["confidence", "contentType", "eventType", "impactCategories", "subjectCategories"];
  if (Object.keys(semantic).sort().join(",") !== semanticKeys.join(",")) throw new TypeError("compact semantic fields invalid");
  if (!isPlainObject(policy) || policy.sourceEvidence !== "title_then_excerpt" || !isPlainObject(policy.eventTypes)) {
    throw new TypeError("compact policy required");
  }
  if (!CONTENT_TYPES.includes(semantic.contentType)) throw new TypeError("compact contentType invalid");
  const eventPolicy = policy.eventTypes[semantic.eventType];
  if (!isPlainObject(eventPolicy) || !Array.isArray(eventPolicy.requiredCoreCategories)) {
    throw new TypeError("compact eventType invalid");
  }
  if (!isFiniteNonNeg(semantic.confidence) || semantic.confidence > 1) throw new TypeError("compact confidence invalid");
  for (const field of ["impactCategories", "subjectCategories"]) {
    const values = semantic[field];
    if (!Array.isArray(values) || values.some((category) => !ADMISSION_CATEGORY_IDS.includes(category))
      || new Set(values).size !== values.length) throw new TypeError(`compact ${field} invalid`);
  }
  const impacts = new Set(semantic.impactCategories);
  const subjects = new Set(semantic.subjectCategories);
  if ([...impacts].some((category) => subjects.has(category))) throw new TypeError("compact impact_subject_overlap");
  if (semantic.contentType === "other"
    && (semantic.eventType !== policy.emptyEventType || impacts.size > 0 || subjects.size > 0)) {
    throw new TypeError("compact other must be empty");
  }
  if (semantic.contentType !== "other" && semantic.eventType === policy.emptyEventType) {
    throw new TypeError("compact eventType other requires contentType other");
  }
  const required = new Set(eventPolicy.requiredCoreCategories);
  if ([...required].some((category) => !ADMISSION_CATEGORY_IDS.includes(category))) {
    throw new TypeError("compact required category invalid");
  }
  if (semantic.contentType === "other" && required.size > 0) throw new TypeError("compact other policy must not admit");
  return { eventPolicy, impacts, subjects, required };
}

export function assembleClassificationFromCompactCategory(semantic, { input, versions, operatorGroup, originDocumentId, policy } = {}) {
  const { impacts, subjects, required } = compactSemanticParts(semantic, policy);
  const norm = isPlainObject(input) && isNonEmptyStr(input.evidenceHash) ? input : normalizeClassifierInput(input);
  const accepted = new Set([...required, ...impacts]);
  if ([...subjects].some((category) => accepted.has(category))) throw new TypeError("compact accepted_secondary_overlap");
  const evidenceSpan = norm.title.trim() || norm.excerpt.trim();
  if (accepted.size > 0 && !evidenceSpan) throw new TypeError("compact accepted item needs source evidence");
  const primaryCategory = semantic.impactCategories.find((category) => accepted.has(category))
    || ADMISSION_CATEGORY_IDS.find((category) => required.has(category)) || "unknown";
  const fullSemantic = {
    contentType: semantic.contentType,
    primaryCategory,
    descriptiveSecondaryCategories: ADMISSION_CATEGORY_IDS.filter((category) => subjects.has(category)),
    admissionCategories: ADMISSION_CATEGORY_IDS.map((category) => {
      if (accepted.has(category)) {
        const reasonCodes = [];
        if (required.has(category)) reasonCodes.push("compact_event_required_core");
        if (impacts.has(category)) reasonCodes.push("compact_direct_impact");
        return { category, decision: "accept", confidence: semantic.confidence, evidenceSpans: [evidenceSpan], reasonCodes };
      }
      if (subjects.has(category)) {
        return { category, decision: "abstain", confidence: semantic.confidence, evidenceSpans: evidenceSpan ? [evidenceSpan] : [], reasonCodes: ["compact_subject_secondary"] };
      }
      return { category, decision: "reject", confidence: semantic.confidence, evidenceSpans: [], reasonCodes: [] };
    }),
    eventJurisdictions: [],
    relevanceCountries: [],
    geoEvidenceSpans: []
  };
  return assembleClassificationFromSemantic(fullSemantic, { input: norm, versions, operatorGroup, originDocumentId });
}

// taxonomyVersion을 CATEGORIES 정본의 결정적 SHA에서 파생(§8).
export function d1cTaxonomyVersion() {
  return "d1c-tax-" + crypto.createHash("sha256").update(JSON.stringify([...ADMISSION_CATEGORY_IDS])).digest("hex").slice(0, 12);
}

// §8: semantic → full classification. version/hash/sourceCountry/language/originDocumentId는 코드가
// 복사, operatorGroup 재사용, claimOriginGroup=보수값, scope/geoConfidence는 resolveScopeClass가 계산.
// eventJurisdictions가 없으면 scope=unknown·geoConfidence=0·geoSpan=[].
export function assembleClassificationFromSemantic(semantic, { input, versions, operatorGroup, originDocumentId } = {}) {
  if (!isPlainObject(semantic)) throw new TypeError("assembleClassificationFromSemantic: semantic object required");
  const norm = isPlainObject(input) && isNonEmptyStr(input.evidenceHash) ? input : normalizeClassifierInput(input);
  for (const k of ["modelVersion", "promptVersion", "taxonomyVersion"]) {
    if (!isNonEmptyStr(versions && versions[k])) throw new TypeError(`assembleClassificationFromSemantic: versions.${k} required`);
  }
  if (!isNonEmptyStr(operatorGroup)) throw new TypeError("assembleClassificationFromSemantic: operatorGroup required");
  if (!isNonEmptyStr(originDocumentId)) throw new TypeError("assembleClassificationFromSemantic: originDocumentId required");
  const evj = Array.isArray(semantic.eventJurisdictions) ? semantic.eventJurisdictions : [];
  const rel = Array.isArray(semantic.relevanceCountries) ? semantic.relevanceCountries : [];
  const hasEvj = evj.filter(isNonEmptyStr).length > 0;
  const scope = resolveScopeClass({ eventJurisdictions: evj, relevanceCountries: rel });
  return {
    contentType: semantic.contentType,
    primaryCategory: semantic.primaryCategory,
    descriptiveSecondaryCategories: Array.isArray(semantic.descriptiveSecondaryCategories) ? semantic.descriptiveSecondaryCategories : [],
    admissionCategories: Array.isArray(semantic.admissionCategories) ? semantic.admissionCategories : [],
    modelVersion: versions.modelVersion, promptVersion: versions.promptVersion, taxonomyVersion: versions.taxonomyVersion,
    evidenceHash: norm.evidenceHash,
    sourceCountry: norm.sourceCountry, language: norm.language,
    eventJurisdictions: evj, relevanceCountries: rel,
    scopeClass: scope.scopeClass,
    geoConfidence: hasEvj ? scope.geoConfidence : 0,
    geoEvidenceSpans: hasEvj ? (Array.isArray(semantic.geoEvidenceSpans) ? semantic.geoEvidenceSpans : []) : [],
    operatorGroup, originDocumentId, claimOriginGroup: D1C_CLAIM_ORIGIN_GROUP
  };
}

// §9/§10: 가격 인식 순차 실행. 실제 호출은 injected callModel(async)만. 자동 retry 0.
// budget 필수 7필드 fail-closed. preflight: 다음 호출 보수적 최대비용까지 합쳐 상한 초과 가능하면 호출 전 중단.
// 실제 usage 토큰으로 정확 누적. overrun/실패/미근거는 no-cache. verified classified만 cache.
export async function runPricedClassification({
  items = [], callModel, versions, operatorGroupOf, originDocumentIdOf,
  budget = {}, pricing = D1C_PRICING, cache = new Map(), now = null,
  priorUsage = { calls: 0, inputTokens: 0, outputTokens: 0 }, ledger = null, attemptId = "run", phase = "run",
  classificationAssembler = assembleClassificationFromSemantic, onResult = null, onProviderError = null
} = {}) {
  if (typeof callModel !== "function") throw new TypeError("runPricedClassification: callModel(async) required");
  if (typeof classificationAssembler !== "function") throw new TypeError("runPricedClassification: classificationAssembler function required");
  if (onResult !== null && typeof onResult !== "function") throw new TypeError("runPricedClassification: onResult must be function|null");
  if (onProviderError !== null && typeof onProviderError !== "function") throw new TypeError("runPricedClassification: onProviderError must be function|null");
  for (const k of ["modelVersion", "promptVersion", "taxonomyVersion"]) {
    if (!isNonEmptyStr(versions && versions[k])) throw new TypeError(`runPricedClassification: versions.${k} required`);
  }
  for (const k of ["maxCalls", "maxInputTokens", "maxOutputTokens", "maxOutputTokensPerCall", "maxCostUsd", "perCallTimeoutMs", "totalDeadlineMs"]) {
    if (!isFiniteNonNeg(budget[k])) throw new TypeError(`runPricedClassification: budget.${k} must be finite >= 0 (fail-closed)`);
  }
  if (typeof operatorGroupOf !== "function" || typeof originDocumentIdOf !== "function") {
    throw new TypeError("runPricedClassification: operatorGroupOf/originDocumentIdOf functions required");
  }
  for (const k of ["calls", "inputTokens", "outputTokens"]) {
    if (!isFiniteNonNeg(priorUsage && priorUsage[k])) throw new TypeError(`runPricedClassification: priorUsage.${k} must be finite >= 0 (fail-closed)`);
  }
  if (typeof now !== "function") throw new TypeError("runPricedClassification: now() clock required (fail-closed)");
  const clock = now;
  // §5: runner 실제 경로는 ledger summary만 lifetime으로 사용(임의 priorUsage 아님). ledger 없으면 priorUsage(테스트 하위호환).
  const lifetime0 = ledger ? ledger.summary(pricing) : priorUsage;
  for (const k of ["calls", "inputTokens", "outputTokens"]) {
    if (!isFiniteNonNeg(lifetime0 && lifetime0[k])) throw new TypeError(`runPricedClassification: lifetime0.${k} invalid (fail-closed)`);
  }
  const stats = { calls: 0, classified: 0, cacheHits: 0, withheld: 0, schemaReject: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latenciesMs: [] };
  const startedAt = clock();
  const results = [];
  const recordResult = (row) => {
    results.push(row);
    if (onResult) onResult(row);
  };
  for (const [idx, rawItem] of items.entries()) {
    const input = normalizeClassifierInput(rawItem);
    const request = buildStructuredRequest(input, versions);
    const key = request.cacheKey;
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (validateClassifierOutput(cached, input, versions).ok) {
        stats.cacheHits += 1;
        recordResult({ itemId: input.itemId, status: "cache_hit", cacheKey: key, classification: cached });
        continue;
      }
      cache.delete(key);
    }
    const estInput = estTokens(request);
    // §B(122): 예산 판정은 단일 순수 함수 budgetAllowsCall만 사용(중복 공식 금지). deadline은 시계 기반 별도.
    const allowed = budgetAllowsCall({ lifetimeCalls: lifetime0.calls + stats.calls, lifetimeInput: lifetime0.inputTokens + stats.inputTokens, lifetimeOutput: lifetime0.outputTokens + stats.outputTokens, estInput, budget, pricing });
    const elapsed = clock() - startedAt;
    if (!allowed || elapsed >= budget.totalDeadlineMs) {
      stats.withheld += 1;
      recordResult({ itemId: input.itemId, status: "withheld", reason: "budget_preflight" });
      continue;
    }
    stats.calls += 1; // 호출 시작 전 증가 — 실패 호출도 예산에 포함
    const callId = `${attemptId}:${phase}:${idx}`; // §4: 전역 유일 <attemptId>:<phase>:<index>
    if (ledger) ledger.append({ type: "reserve", callId, estInput, maxOutput: budget.maxOutputTokensPerCall }); // §5: provider 호출 직전 reserve+fsync
    const callStart = clock();
    let modelOut;
    try {
      modelOut = await callModel({ request, input, timeoutMs: budget.perCallTimeoutMs });
    } catch (error) {
      const providerError = /^api \d{3}( [a-z_]+)?$/.test(error?.message || "") ? error.message : "provider_error";
      const providerDiagnostic = typeof error?.providerMessage === "string" ? error.providerMessage : "";
      if (onProviderError && onProviderError({ error, providerError, input, rawItem }) === "withhold") {
        if (ledger) ledger.append({ type: "cancel", callId, reason: providerError });
        stats.withheld += 1;
        stats.providerRejected = (stats.providerRejected || 0) + 1;
        stats.providerError = providerError;
        stats.providerDiagnostic = providerDiagnostic;
        stats.providerRequestId = typeof error?.requestId === "string" ? error.requestId : "";
        recordResult({ itemId: input.itemId, status: "withheld", reason: "provider_rejected" });
        continue;
      }
      // §5: provider throw → reserve 미정산 유지, 즉시 실행 전체 중단(다음 아이템 호출 0).
      stats.errors += 1; stats.aborted = true; stats.abortReason = "provider_throw_unsettled";
      stats.providerError = providerError;
      stats.providerDiagnostic = providerDiagnostic;
      stats.providerRequestId = typeof error?.requestId === "string" ? error.requestId : "";
      recordResult({ itemId: input.itemId, status: "error", reason: "classifier_call_failed" });
      break;
    }
    const usage = (modelOut && modelOut.usage) || {};
    // §5: usage는 유한 0이상 정수만 신뢰. 누락·음수·소수·형식오류면 settle 없이 즉시 중단(reserve 미정산).
    if (!Number.isInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isInteger(usage.outputTokens) || usage.outputTokens < 0) {
      stats.errors += 1; stats.aborted = true; stats.abortReason = "usage_invalid_unsettled";
      recordResult({ itemId: input.itemId, status: "error", reason: "usage_invalid" });
      break;
    }
    const inTok = usage.inputTokens, outTok = usage.outputTokens;
    stats.inputTokens += inTok;
    stats.outputTokens += outTok;
    if (ledger) ledger.append({ type: "settle", callId, inputTokens: inTok, outputTokens: outTok }); // §5: 유효 usage만 정산(reserve 하나 대응)
    stats.costUsd = pricedCostUsd(stats.inputTokens, stats.outputTokens, pricing);
    stats.latenciesMs.push(clock() - callStart);
    const lifeCostNow = pricedCostUsd(lifetime0.inputTokens + stats.inputTokens, lifetime0.outputTokens + stats.outputTokens, pricing);
    if (lifeCostNow > budget.maxCostUsd || lifetime0.inputTokens + stats.inputTokens > budget.maxInputTokens || lifetime0.outputTokens + stats.outputTokens > budget.maxOutputTokens) {
      stats.withheld += 1;
      recordResult({ itemId: input.itemId, status: "withheld", reason: "budget_overrun" }); // no cache, lifetime 기준
      continue;
    }
    let classification;
    try {
      classification = classificationAssembler(modelOut && modelOut.semantic, {
        input, versions, operatorGroup: operatorGroupOf(rawItem), originDocumentId: originDocumentIdOf(rawItem)
      });
    } catch {
      stats.schemaReject += 1;
      recordResult({ itemId: input.itemId, status: "schema_reject", reason: "assemble_failed" }); // no cache
      continue;
    }
    const valid = validateClassifierOutput(classification, input, versions);
    if (!valid.ok) {
      stats.schemaReject += 1;
      recordResult({ itemId: input.itemId, status: "schema_reject", reason: valid.errors[0] }); // no cache
      continue;
    }
    cache.set(key, classification); // verified 결과만 캐시
    stats.classified += 1;
    recordResult({ itemId: input.itemId, status: "classified", cacheKey: key, classification });
  }
  stats.costUsd = pricedCostUsd(stats.inputTokens, stats.outputTokens, pricing);
  // §C(122): ledger가 있으면 lifetime은 마지막 strict ledger summary와 정확히 일치한다(미정산 reserve의 estimated 토큰·비용 포함, 0 축소 금지).
  //          ledger 없으면 lifetime0(priorUsage) + 이번 실행 stats.
  const lifeFinal = ledger
    ? ledger.summary(pricing)
    : { calls: lifetime0.calls + stats.calls, inputTokens: lifetime0.inputTokens + stats.inputTokens, outputTokens: lifetime0.outputTokens + stats.outputTokens,
        costUsd: pricedCostUsd(lifetime0.inputTokens + stats.inputTokens, lifetime0.outputTokens + stats.outputTokens, pricing), unsettledReserves: 0 };
  stats.lifetimeCalls = lifeFinal.calls;
  stats.lifetimeInputTokens = lifeFinal.inputTokens;
  stats.lifetimeOutputTokens = lifeFinal.outputTokens;
  stats.lifetimeCostUsd = lifeFinal.costUsd;
  stats.unsettledReserves = lifeFinal.unsettledReserves;
  stats.currency = pricing.currency;
  const lat = [...stats.latenciesMs].sort((a, b) => a - b);
  const pctl = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * (lat.length - 1)))] : 0);
  stats.latencyP50 = pctl(0.5); stats.latencyP95 = pctl(0.95);
  return { results, stats, cache, versions: { ...versions }, startedAt };
}

// §7: legacy baseline은 frozen snapshot에서 측정한다(라이브 아님). eligible 각 행의
// legacyCategory(= 검증된 snapshot item.category == corpus declaredCategory)를 legacy 예측으로,
// goldAcceptedCategories를 정답으로 분야별 goldPositives/TP/FN/FP/recall/qualifiedSupply를 낸다.
// 0 goldPositive 분야는 not_applicable_sample(정밀도 표본 부족과 구분).
export function measureLegacyBaseline({ eligible = [] } = {}) {
  const CATS = [...ADMISSION_CATEGORY_IDS];
  const per = {};
  for (const c of CATS) per[c] = { goldPositives: 0, legacyTP: 0, legacyFN: 0, legacyFP: 0, observedAdmission: 0 };
  for (const e of eligible) {
    const legacy = e.legacyCategory;
    const gold = new Set(e.goldAcceptedCategories || []);
    for (const c of CATS) {
      const isLegacy = legacy === c, isGold = gold.has(c);
      if (isGold) per[c].goldPositives += 1;
      if (isLegacy) per[c].observedAdmission += 1;
      if (isLegacy && isGold) per[c].legacyTP += 1;
      else if (!isLegacy && isGold) per[c].legacyFN += 1;
      else if (isLegacy && !isGold) per[c].legacyFP += 1;
    }
  }
  let totalTP = 0;
  for (const c of CATS) {
    const r = per[c];
    r.applicable = r.goldPositives > 0;
    r.recall = r.applicable ? r.legacyTP / r.goldPositives : null;
    r.qualifiedSupply = r.legacyTP;
    totalTP += r.legacyTP;
  }
  return { perCategory: per, categories: CATS, eligibleCount: eligible.length, totalQualifiedSupply: totalTP };
}

// §11: candidate(실모델) perCategory(evaluatePredictions.perCategory)를 legacy baseline과 비교한다.
// candidate recall은 goldPositive가 있는 모든 분야에서 legacy 이상, qualified supply(TP)도 분야별·전체 합계 감소 금지.
export function compareCandidateVsLegacy(legacyBaseline, candidatePerCategory = {}) {
  const CATS = legacyBaseline.categories;
  const rows = [];
  let recallPass = true, perCategorySupplyPass = true, candTotalTP = 0;
  for (const c of CATS) {
    const L = legacyBaseline.perCategory[c];
    const C = candidatePerCategory[c] || { tp: 0, fn: 0, goldPositives: 0 };
    candTotalTP += C.tp;
    const candRecall = L.goldPositives > 0 ? C.tp / L.goldPositives : null;
    const candSupply = C.tp;
    let status = "not_applicable_sample", rOk = true, sOk = true;
    if (L.applicable) {
      rOk = candRecall >= L.recall;
      sOk = candSupply >= L.qualifiedSupply;
      if (!rOk) recallPass = false;
      if (!sOk) perCategorySupplyPass = false;
      status = (rOk && sOk) ? "meets_or_exceeds" : "below_legacy";
    }
    rows.push({ category: c, applicable: L.applicable, legacyRecall: L.recall, candidateRecall: candRecall,
      legacyQualifiedSupply: L.qualifiedSupply, candidateQualifiedSupply: candSupply, recallOk: rOk, supplyOk: sOk, status });
  }
  const totalSupplyNonDecrease = candTotalTP >= legacyBaseline.totalQualifiedSupply;
  return {
    rows, recallPass, supplyPass: perCategorySupplyPass && totalSupplyNonDecrease,
    legacyTotalQualifiedSupply: legacyBaseline.totalQualifiedSupply, candidateTotalQualifiedSupply: candTotalTP,
    totalSupplyNonDecrease
  };
}
