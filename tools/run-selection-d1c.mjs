// NOWHOT D1-C — one-shot measurement orchestrator.
// 정본: WRC_MANUS_HANDOFF/system/reports/NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//   (SHA-256 1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5)
//
// 단계(서브커맨드):
//   --promote-gold       : D1-B final-gold candidate를 정본 gold로 원자적·멱등 승격(§6).
//   --measure-baseline   : frozen snapshot에서 legacy recall/qualified-supply 측정 + lock 저장(§7).
//   --check-baseline     : baseline lock drift 검사(raw SHA 상수). drift면 exit 1.
//   --run-model          : preflight → canary 12 → 나머지 84 → 96행 평가(§8-§11). 실모델(haiku) 호출.
//
// 순수 함수(buildEligibleFromSnapshots/promoteGoldPlan/canaryItemIds/computeReleasePass 등)는 export해
// 테스트가 직접 호출한다. 실제 네트워크는 --run-model 단계의 https://api.anthropic.com/v1/messages만.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  D1_IDENTITIES, D1C_PRICING, D1C_SEMANTIC_SCHEMA, D1C_PROMPT_VERSION, d1cTaxonomyVersion,
  compactCategorySemanticSchema, assembleClassificationFromCompactCategory, assembleClassificationFromSemantic,
  evidenceHashOf, cacheKeyOf, buildStructuredRequest, normalizeClassifierInput,
  buildCanonicalAuthority, validateGoldContract, releaseGoldState,
  evaluatePredictions, evaluateGates,
  runPricedClassification, measureLegacyBaseline, compareCandidateVsLegacy, ledgerSummary,
  budgetAllowsCall, estTokens, validateClassifierOutput, loadAdversarialAuthority
} from "../src/feed/selection-classifier-lab.js";
import { callStructuredMessage } from "../src/feed/llm.js";
import { getCandidate, getCandidateExecutionHold, getRunnableCandidate } from "./selection-candidate-registry.mjs";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { operationalSourceIdentity } from "../src/feed/editorial-source-identity.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (n) => path.join(ROOT, "test", "fixtures", n);
const D1C_DIR = path.join(ROOT, ".nowhot-local", "selection-d1c");
const D1C_INTEGRITY_DIR = path.join(ROOT, ".nowhot-local", "selection-d1c-integrity");
const DEFAULT_LOCK_PATH = path.join(D1C_INTEGRITY_DIR, ".run-lock");     // §4: 전역 실행 lock(wx)
const DEFAULT_LEDGER_PATH = path.join(D1C_INTEGRITY_DIR, "usage-ledger.jsonl");

const CORPUS_PATH = FIX("selection-d1-corpus.json");
const GOLD_PATH = FIX("selection-d1-gold.json");
const CANDIDATE_PATH = path.join(ROOT, ".nowhot-local", "selection-d1b", "final-gold.candidate.json");
const BASELINE_LOCK_PATH = FIX("selection-d1-legacy-baseline.lock.json");

// §1 정본 상수(코드 계약으로 잠금).
export const FROZEN_CORPUS_SHA256 = "b8f2d45842fa94d5ddd5630fc35660ccd8b13986fd3f1a0291ab6e52def07b8b"; // v2(002): adversarial geo 정정
export const FROZEN_CORPUS_SHA256_V1 = "e9afa42bbf5357444f509e7aee7bf9d7701f7d4ab0a96f4bf07bd4fbba1cf765"; // superseded
export const EXISTING_GOLD_SHA256 = "4eed688d589613f796ae976ab001792a88d17b5ec6ee609a9d01b4fa14dfdc6a";
export const CANDIDATE_GOLD_SHA256 = "9a82b0920e56606a8553b39616c6736ee7011699266b2f2d67958fc40f07fdeb";
export const CANONICAL_SPEC_SHA256 = "1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5";
// §8 candidate model 고정(구현 모델과 혼동 금지).
export const CANDIDATE_MODEL = "claude-haiku-4-5-20251001";
// §7 snapshot 정본 SHA(corpus.snapshots와 이중 대조).
export const SNAPSHOT_SHA256 = Object.freeze({
  "pool-2026-08-14-lunch": "faf354420acb8f420d4c287898ac729399d2ac4958eda47990d8165a2d133eaa",
  "pool-2026-08-15-lunch": "11d68b09977f3eec2cdab0f309d9ca3cd10a4c268ee547d7ed18949cff3505cd",
  "pool-2026-08-16-lunch": "b3aca64fcf84ae2f3f2edadcb7ec6e874d9f6941496b4567feaf52db54cf3e95"
});
export const D1C_BASELINE_CONTRACT = "NOWHOT-SELECTION-D1C-LEGACY-BASELINE-002"; // integrity-02: baseline lineage 002
export const D1C_BASELINE_SUPERSEDES = "NOWHOT-SELECTION-D1C-LEGACY-BASELINE-001";
// §5/§6: baseline final(002) lock의 raw-byte SHA 상수(whitespace/raw 변조 감지). interim 4dd864→final.
export const BASELINE_LOCK_RAW_SHA256 = "b31f6dbf7fee9c64c5e61bea6d08f7e9ad81c6c14a338bcae5b78e2e81fdf7fe";
export const EXPECTED_COUNTS = Object.freeze({ total: 96, real: 78, eligible: 71, agreed: 57, adjudicated: 21, contract_fixture_only: 18 });

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// §5: 값·배열 순서·키 집합(extra/missing 포함)까지 exact 비교.
function deepEqualStrict(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqualStrict(x, b[i]));
  }
  if (typeof a === "object") {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) => deepEqualStrict(a[k], b[k]));
  }
  return false;
}
const readRaw = (p) => fs.readFileSync(p, "utf8");
const readJson = (p) => JSON.parse(readRaw(p));
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

function writeJsonAtomic(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// 순수 함수(테스트 대상).
// ---------------------------------------------------------------------------

// §8: operatorGroup은 기존 operationalSourceIdentity 재사용. corpus row(sourceId 필드)를 source로 매핑.
export function operatorGroupFor(row) {
  try {
    const id = operationalSourceIdentity({
      source: row.sourceId, sourceLabel: row.sourceLabel,
      ownershipGroup: row.ownershipGroup, ownershipBasis: row.ownershipBasis, feedGroup: row.feedGroup
    });
    return isNonEmptyStr(id && id.ownershipGroup) ? id.ownershipGroup : (isNonEmptyStr(row.sourceId) ? row.sourceId : "unknown");
  } catch {
    return isNonEmptyStr(row.sourceId) ? row.sourceId : "unknown";
  }
}
export function originDocumentIdFor(row) {
  return isNonEmptyStr(row.blindItemId) ? row.blindItemId : (isNonEmptyStr(row.itemId) ? row.itemId : "unknown");
}

export function versionsForD1c() {
  return { modelVersion: CANDIDATE_MODEL, promptVersion: D1C_PROMPT_VERSION, taxonomyVersion: d1cTaxonomyVersion() };
}

// §10→D1-G P1-1: canary = authority-002 decisive 10(대체 d1g-11/12 포함) + mutation d1m-01a/d1m-01b(총 12).
// 감사용 ambiguous(d1a-07/10)는 호출하지 않는다 — 옛 corpus 10건 선택 경로 제거.
const CANARY_MUTATION_IDS = Object.freeze(["d1m-01a", "d1m-01b"]);
function d1gAuthorityDoc() { return JSON.parse(readRaw(FIX("selection-d1g-adversarial-authority-002.json"))); }
export function canaryItemIds(corpus) {
  const doc = d1gAuthorityDoc();
  loadAdversarialAuthority(doc, { corpusRows: corpus.rows }); // fail-closed 검증
  const decisive = doc.decisiveItems.map((d) => d.blindItemId);
  if (decisive.length !== 10) throw new Error(`canary: expected 10 decisive, got ${decisive.length}`);
  for (const id of CANARY_MUTATION_IDS) if (!corpus.rows.some((r) => r.blindItemId === id)) throw new Error(`canary: mutation ${id} absent`);
  return [...decisive, ...CANARY_MUTATION_IDS];
}
// canary 항목 원본: corpus 상주 항목은 frozen corpus 행, 대체 반례는 authority 항목에서 구성.
export function d1gCanaryItems(corpus) {
  const doc = d1gAuthorityDoc();
  loadAdversarialAuthority(doc, { corpusRows: corpus.rows });
  const rowById = new Map(corpus.rows.map((r) => [r.blindItemId, r]));
  const toItem = (src, id) => ({ itemId: id, blindItemId: id, origin: src.origin || "adversarial_contract_fixture",
    title: src.title, excerpt: src.excerpt, sourceId: src.sourceId, sourceTier: src.sourceTier,
    declaredSection: src.declaredSection, contentKindHint: src.contentKindHint,
    sourceCountry: src.sourceCountry, language: src.language,
    mutationPairId: src.mutationPairId, mutationRole: src.mutationRole, mutationType: src.mutationType });
  const items = doc.decisiveItems.map((d) => toItem(d.source === "corpus" ? rowById.get(d.blindItemId) : d, d.blindItemId));
  for (const id of CANARY_MUTATION_IDS) items.push(toItem(rowById.get(id), id));
  return items;
}
// D1-G P1(재검수): 평가 집합 단일 구성 함수 — corpus 96 - 감사용 2 + 대체 2 = 정확히 96.
// canary 12(decisive 10 + mutation 2) 고정, rest 84 고정. 다른 곳에서 집합을 다시 거르지 않는다.
export function d1gEvaluationSet(corpus) {
  const authority = loadD1gAdversarialAuthority(corpus.rows);
  const canaryItems = d1gCanaryItems(corpus);
  const canaryIds = new Set(canaryItems.map((i) => i.blindItemId));
  const restItems = corpus.rows
    .filter((r) => !canaryIds.has(r.blindItemId) && !authority.auditAmbiguous.has(r.blindItemId))
    .map((r) => ({ itemId: r.blindItemId, blindItemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt,
      sourceId: r.sourceId, sourceTier: r.sourceTier, declaredSection: r.declaredSection,
      contentKindHint: r.contentKindHint, sourceCountry: r.sourceCountry, language: r.language,
      mutationPairId: r.mutationPairId, mutationRole: r.mutationRole, mutationType: r.mutationType }));
  const allItems = [...canaryItems, ...restItems];
  if (canaryItems.length !== 12) throw new Error(`CORRUPT_EVAL_DATA: canary must be 12, got ${canaryItems.length}`);
  if (restItems.length !== 84) throw new Error(`CORRUPT_EVAL_DATA: rest must be 84, got ${restItems.length}`);
  if (allItems.length !== 96) throw new Error(`CORRUPT_EVAL_DATA: evaluation set must be 96, got ${allItems.length}`);
  return { authority, canaryItems, restItems, allItems, auditExcluded: [...authority.auditAmbiguous].sort() };
}

// 대체 반례의 gold 행 합성(frozen gold 무수정): authority goldStub 의미 + canonical 해시.
export function d1gReplacementGoldRows(canonical, authority) {
  const rows = [];
  for (const [id, entry] of authority.byId) {
    if (entry.source !== "replacement_fixture") continue;
    const rec = canonical.get(id);
    if (!rec) throw new Error(`CORRUPT_EVAL_DATA: replacement '${id}' absent from canonical`);
    rows.push({ itemId: id, origin: "adversarial_contract_fixture", state: "contract_fixture_only",
      evidenceHash: rec.evidenceHash, blindPacketHash: rec.blindPacketHash,
      goldContentType: entry.expected.contentType, humanValid: true, inScope: true,
      goldAcceptedCategories: [...entry.expected.acceptedCategories],
      goldRejectedCategories: [...(entry.expected.rejectedCategories || [])],
      descriptiveSecondaryCategories: [...(entry.expected.secondaryCategories || [])] });
  }
  return rows;
}

// §7: frozen snapshot에서 real 78행을 1:1 대응(snapshotId+sourceId+재계산 evidenceHash)하고
// snapshot item.category == corpus declaredCategory를 확인한다. eligible은 gold humanValid&inScope real.
export function buildEligibleFromSnapshots({ corpus, gold, snapshotFiles }) {
  // snapshotFiles: { snapshotId: { savedAt, rows:[{item}]} }  (SHA는 호출부에서 이미 대조)
  const index = new Map(); // snapshotId -> Map(`${source}|${evidenceHash}` -> item)
  for (const [sid, snap] of Object.entries(snapshotFiles)) {
    const m = new Map();
    for (const wrap of (snap.rows || [])) {
      const it = wrap.item || wrap;
      const eh = evidenceHashOf({ title: it.title, excerpt: it.summary != null ? it.summary : it.excerpt });
      m.set(`${it.source}|${eh}`, it);
    }
    index.set(sid, m);
  }
  const realRows = corpus.rows.filter((r) => r.origin === "real_local_snapshot");
  const mapped = [];
  for (const r of realRows) {
    const snap = index.get(r.sourceSnapshotId);
    if (!snap) throw new Error(`baseline: snapshot '${r.sourceSnapshotId}' not loaded for '${r.blindItemId}'`);
    const hit = snap.get(`${r.sourceId}|${r.evidenceHash}`);
    if (!hit) throw new Error(`baseline: no unique snapshot item for '${r.blindItemId}' (source ${r.sourceId})`);
    if (hit.category !== r.declaredCategory) {
      throw new Error(`baseline: snapshot category '${hit.category}' != declaredCategory '${r.declaredCategory}' for '${r.blindItemId}'`);
    }
    mapped.push({ itemId: r.blindItemId, sourceId: r.sourceId, snapshotId: r.sourceSnapshotId, legacyCategory: r.declaredCategory });
  }
  if (mapped.length !== realRows.length) throw new Error(`baseline: mapped ${mapped.length} != ${realRows.length} real rows`);
  const goldById = new Map((gold.labels || []).map((l) => [l.itemId, l]));
  const eligible = [];
  for (const m of mapped) {
    const g = goldById.get(m.itemId);
    if (!g) throw new Error(`baseline: gold missing for real '${m.itemId}'`);
    if ((g.state === "agreed" || g.state === "adjudicated") && g.humanValid === true && g.inScope === true) {
      eligible.push({ itemId: m.itemId, legacyCategory: m.legacyCategory, goldAcceptedCategories: g.goldAcceptedCategories || [] });
    }
  }
  return { mapped, eligible };
}

// §6: 승격 계획(멱등·검증). currentSha가 candidate면 재작성 없음, 기존 gold면 승격, 그 외 HOLD.
export function promoteGoldPlan({ currentSha, candidateSha }) {
  if (candidateSha !== CANDIDATE_GOLD_SHA256) return { action: "reject", reason: `candidate sha ${candidateSha} != expected ${CANDIDATE_GOLD_SHA256}` };
  if (currentSha === CANDIDATE_GOLD_SHA256) return { action: "idempotent_existing", reason: "gold already equals candidate" };
  if (currentSha === EXISTING_GOLD_SHA256) return { action: "promote", reason: "existing gold -> candidate" };
  return { action: "reject", reason: `current gold sha ${currentSha} is neither existing nor candidate` };
}

// D1-G FINAL CLOSURE: adversarial 평가 정본(authority-002) 로더 — 모든 표준 평가 경로가 이걸 지나야 한다.
export function loadD1gAdversarialAuthority(corpusRows) {
  return loadAdversarialAuthority(JSON.parse(readRaw(FIX("selection-d1g-adversarial-authority-002.json"))), { corpusRows });
}

// candidate gold를 canonical/contract/release로 재검증하고 계약 수치와 대조.
export function validateCandidateGold({ corpus, candidateGold }) {
  const canonical = buildCanonicalAuthority(corpus.rows, { adversarialAuthority: loadD1gAdversarialAuthority(corpus.rows) });
  const labels = candidateGold.labels || [];
  const expectedRealItemIds = corpus.rows.filter((r) => r.origin === "real_local_snapshot").map((r) => r.blindItemId);
  const contract = validateGoldContract(labels, { identities: D1_IDENTITIES, canonical });
  const releaseState = releaseGoldState(labels, { identities: D1_IDENTITIES, canonical, expectedRealItemIds });
  const counts = { pending: 0, agreed: 0, disputed: 0, adjudicated: 0, contract_fixture_only: 0 };
  for (const l of labels) if (l.state in counts) counts[l.state] += 1;
  const checks = {
    total: labels.length === EXPECTED_COUNTS.total,
    real: expectedRealItemIds.length === EXPECTED_COUNTS.real,
    agreed: counts.agreed === EXPECTED_COUNTS.agreed,
    adjudicated: counts.adjudicated === EXPECTED_COUNTS.adjudicated,
    contract_fixture_only: counts.contract_fixture_only === EXPECTED_COUNTS.contract_fixture_only,
    eligible: contract.releaseEligibleItemIds.length === EXPECTED_COUNTS.eligible,
    noRejected: contract.rejectedItemIds.length === 0,
    releaseSufficient: releaseState === "sufficient_independent_gold"
  };
  const ok = Object.values(checks).every(Boolean);
  return { ok, checks, counts, releaseState, rejectedItemIds: contract.rejectedItemIds, eligibleCount: contract.releaseEligibleItemIds.length };
}

// §11: releasePass = sufficient gold AND 7 gate 전부 true.
export function computeReleasePass({ goldState, gates, comparison }) {
  const parts = {
    sufficientGold: goldState === "sufficient_independent_gold",
    contentType: gates.contentType.pass === true,
    abstain: gates.abstain.pass === true,
    adversarial: gates.adversarial.pass === true,
    mutation: gates.mutation.pass === true,
    precision: gates.precision.pass === true,
    recall: comparison.recallPass === true,
    qualifiedSupply: comparison.supplyPass === true
  };
  return { releasePass: Object.values(parts).every(Boolean), parts };
}

// ---------------------------------------------------------------------------
// 프롬프트(§8). gold/declaredCategory 등 라벨 필드는 절대 넣지 않는다.
// ---------------------------------------------------------------------------
export const D1C_SYSTEM = [
  "You are the admission classifier for NOWHOT (지금핫), a Korean news/community/deal aggregator.",
  "You receive one item's blind fields and must return ONLY the semantic classification JSON.",
  "",
  "acceptedCategories rule: a category is 'accept' ONLY if a user who selected that single category alone",
  "would legitimately want this item as a core topic. A mere mention or indirect effect is NOT accept —",
  "it is 'reject', or 'abstain' if it is a real-but-secondary theme. Precision is more important than volume.",
  "Two 'accept' categories are allowed ONLY when two fields are a genuinely inseparable joint core.",
  "",
  "contentType is FORMAT (news=reporting, community=user/community post, deal=concrete purchase offer, other=otherwise),",
  "which is different from the 'news' taxonomy TOPIC. Do not accept the 'news' topic just because the format is news.",
  "If contentType is 'other' or there is no accept, primaryCategory MUST be 'unknown'.",
  "",
  "sourceCountry is the OUTLET's location, NOT the event location. Judge event location from the text and set",
  "eventJurisdictions (ISO country codes for where the event happens) and relevanceCountries (countries the event",
  "materially affects). If you cannot ground an event location, leave eventJurisdictions empty.",
  "",
  "Grounding: every evidenceSpans entry (for accept rows) and every geoEvidenceSpans entry MUST be an exact",
  "substring of the given title or excerpt. Never invent spans. accept rows also need non-empty reasonCodes.",
  "",
  "admissionCategories MUST contain exactly one row for each of the 14 taxonomy ids, each with decision",
  "accept | abstain | reject, a confidence in [0,1], evidenceSpans and reasonCodes arrays."
].join("\n");

export function taxonomyBlock() {
  return CATEGORIES.map((c) => `- ${c.id} (${c.label} / ${c.labelEn})`).join("\n");
}

// user prompt는 §8 허용 입력만: title, excerpt, sourceId, sourceTier, declaredSection, contentKindHint,
// sourceCountry, language, evidenceHash, taxonomy. gold/declaredCategory는 절대 넣지 않는다.
export function buildUserPrompt(request) {
  return [
    "Classify this item. Return only the semantic JSON per the schema.",
    "",
    "Taxonomy (14 ids, in order):",
    taxonomyBlock(),
    "",
    "Item (blind):",
    `- title: ${request.title || ""}`,
    `- excerpt: ${request.excerpt || ""}`,
    `- sourceId: ${request.sourceId || ""}`,
    `- sourceTier: ${request.sourceTier || ""}`,
    `- declaredSection: ${request.declaredSection == null ? "null" : request.declaredSection}`,
    `- contentKindHint: ${request.contentKindHint || ""}`,
    `- sourceCountry (outlet location, not event): ${request.sourceCountry || ""}`,
    `- language: ${request.language || ""}`,
    `- evidenceHash: ${request.evidenceHash || ""}`
  ].join("\n");
}

// ---------------------------------------------------------------------------
// I/O + snapshot 로딩(SHA 이중 대조).
// ---------------------------------------------------------------------------
function loadCorpusAndGold() {
  const corpusRaw = readRaw(CORPUS_PATH);
  const corpusSha = sha256(corpusRaw);
  if (corpusSha !== FROZEN_CORPUS_SHA256) throw new Error(`corpus SHA drift ${corpusSha}`);
  const corpus = JSON.parse(corpusRaw);
  const goldRaw = readRaw(GOLD_PATH);
  const gold = JSON.parse(goldRaw);
  return { corpus, corpusSha, gold, goldSha: sha256(goldRaw) };
}

function loadSnapshots(corpus) {
  const files = {};
  for (const snap of (corpus.snapshots || [])) {
    const p = path.join(ROOT, snap.path);
    const raw = readRaw(p);
    const s = sha256(raw);
    if (s !== snap.sha256) throw new Error(`snapshot ${snap.id} SHA drift ${s} != corpus ${snap.sha256}`);
    if (SNAPSHOT_SHA256[snap.id] && SNAPSHOT_SHA256[snap.id] !== snap.sha256) throw new Error(`snapshot ${snap.id} SHA != frozen constant`);
    files[snap.id] = JSON.parse(raw);
  }
  return files;
}

export function isConsumedDiagnostic(dir) {
  return inspectConsumedDiagnostic(dir).state !== "absent"; // §4: 3-state inspector에 위임(competing truth path 제거)
}
// §6: consumed 상태를 sealed/absent/drift로 구분 — 파일 존재만으로 정상 HOLD 위장 금지.
export function inspectConsumedDiagnostic(dir) {
  const names = Object.keys(CONSUMED_ARTIFACT_SHA);
  const present = names.filter((n) => fs.existsSync(path.join(dir, n)));
  if (present.length === 0) return { state: "absent", drift: [] };
  const drift = [];
  for (const n of names) {
    const fp = path.join(dir, n);
    if (!fs.existsSync(fp)) { drift.push(`missing:${n}`); continue; }
    try { if (sha256(readRaw(fp)) !== CONSUMED_ARTIFACT_SHA[n]) drift.push(`sha_mismatch:${n}`); } catch { drift.push(`unreadable:${n}`); }
  }
  return drift.length > 0 ? { state: "drift", drift } : { state: "sealed", drift: [] };
}
// §5: 영속 파일 ledger(append-only, per-record fsync). production은 이 ledger만 신뢰하고 누락이면 fail-closed.
export function createFileLedger(filePath, { requireExisting = true } = {}) {
  if (requireExisting && !fs.existsSync(filePath)) throw new Error("PRECONDITION_HOLD: usage ledger missing (fail-closed)");
  const readAll = () => {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    try { return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
    catch (e) { throw new Error(`LEDGER_CORRUPT_HOLD: malformed JSON (${e.message})`); } // §A: 파싱 오류도 정규화
  };
  return {
    append(rec) {
      const records = readAll();            // §A: 손상 JSON이면 여기서 throw(원본 바이트 불변)
      ledgerSummary(records);               // §A: 기존 전수검증 — 손상이면 append 전 중단
      const seq = records.length;
      const next = { ...rec, seq };          // §A: 호출자 seq는 저장 순번을 덮을 수 없음(마지막에 강제)
      ledgerSummary([...records, next]);    // §A: 추가 예정 record 포함 strict 재검증
      const fd = fs.openSync(filePath, "a", 0o600);
      try { fs.writeSync(fd, JSON.stringify(next) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const after = readAll();              // §A: 쓰기 뒤 재읽기 → strict 재검증 → 마지막 record 예정값 확인
      ledgerSummary(after);
      const last = after[after.length - 1];
      if (!last || last.seq !== seq || JSON.stringify(last) !== JSON.stringify(next)) throw new Error("LEDGER_CORRUPT_HOLD: post-append verification mismatch");
      return next;
    },
    read: readAll,
    summary: (pricing) => ledgerSummary(readAll(), pricing)
  };
}
export function keychainApiKey() {
  if (isNonEmptyStr(process.env.ANTHROPIC_API_KEY)) return process.env.ANTHROPIC_API_KEY;
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", "nowhot-anthropic-api", "-w"], { encoding: "utf8" });
    const k = (out || "").trim();
    return isNonEmptyStr(k) ? k : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// 단계 실행.
// ---------------------------------------------------------------------------
function stepPromoteGold() {
  const { corpus } = loadCorpusAndGold();
  const currentSha = sha256(readRaw(GOLD_PATH));
  const candidateRaw = readRaw(CANDIDATE_PATH);
  const candidateSha = sha256(candidateRaw);
  const candidateGold = JSON.parse(candidateRaw);
  const plan = promoteGoldPlan({ currentSha, candidateSha });
  const validation = validateCandidateGold({ corpus, candidateGold });
  if (!validation.ok) {
    writeReceipt("gold-promotion-receipt.json", { action: "reject", plan, validation, currentSha, candidateSha });
    throw new Error(`PRECONDITION_HOLD: candidate gold validation failed ${JSON.stringify(validation.checks)}`);
  }
  if (plan.action === "reject") {
    writeReceipt("gold-promotion-receipt.json", { action: "reject", plan, validation, currentSha, candidateSha });
    throw new Error(`PRECONDITION_HOLD: ${plan.reason}`);
  }
  if (plan.action === "idempotent_existing") {
    writeReceipt("gold-promotion-receipt.json", { action: "idempotent_existing", plan, validation, currentSha, candidateSha, promotedSha: candidateSha });
    process.stdout.write(`gold promotion: idempotent_existing (already ${candidateSha.slice(0, 12)})\n`);
    return;
  }
  // promote: 기존 gold 보존 후 원자적 승격
  writeJsonAtomic(path.join(D1C_DIR, "selection-d1-gold.before.json"), JSON.parse(readRaw(GOLD_PATH)), 0o600);
  const tmp = `${GOLD_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, candidateRaw); // 후보 원본 바이트 그대로
  fs.renameSync(tmp, GOLD_PATH);
  const promotedSha = sha256(readRaw(GOLD_PATH));
  if (promotedSha !== CANDIDATE_GOLD_SHA256) throw new Error(`promotion SHA mismatch ${promotedSha}`);
  writeReceipt("gold-promotion-receipt.json", { action: "promote", plan, validation, currentSha, candidateSha, promotedSha });
  process.stdout.write(`gold promotion: promote OK -> ${promotedSha.slice(0, 12)}\n`);
}

function computeBaseline() {
  const { corpus, gold } = loadCorpusAndGold();
  const snapshotFiles = loadSnapshots(corpus);
  const { mapped, eligible } = buildEligibleFromSnapshots({ corpus, gold, snapshotFiles });
  if (mapped.length !== EXPECTED_COUNTS.real) throw new Error(`baseline: mapped ${mapped.length} != ${EXPECTED_COUNTS.real} real`);
  const baseline = measureLegacyBaseline({ eligible });
  return { corpus, gold, mapped, eligible, baseline };
}

function baselineLockPayload(baseline, eligible) {
  const per = {};
  for (const c of baseline.categories) {
    const r = baseline.perCategory[c];
    per[c] = { goldPositives: r.goldPositives, legacyTP: r.legacyTP, legacyFN: r.legacyFN, legacyFP: r.legacyFP,
      observedAdmission: r.observedAdmission, recall: r.recall, qualifiedSupply: r.qualifiedSupply, applicable: r.applicable };
  }
  return {
    contract: D1C_BASELINE_CONTRACT, supersedes: D1C_BASELINE_SUPERSEDES, phase: "D1-C",
    corpusSha256: FROZEN_CORPUS_SHA256, goldSha256: CANDIDATE_GOLD_SHA256, canonicalSpecSha256: CANONICAL_SPEC_SHA256,
    snapshots: SNAPSHOT_SHA256, eligibleCount: eligible.length, totalQualifiedSupply: baseline.totalQualifiedSupply,
    perCategory: per
  };
}
// baseline lock의 결정적 raw SHA(내용에서 파생, 상수로 잠금 후 --check drift 대조).
function baselineLockSha(payload) {
  return sha256(JSON.stringify(payload));
}

function stepMeasureBaseline() {
  const { baseline, eligible } = computeBaseline();
  const payload = baselineLockPayload(baseline, eligible);
  const lockSha = baselineLockSha(payload);
  const locked = { ...payload, lockSha256: lockSha };
  writeJsonAtomic(BASELINE_LOCK_PATH, locked, 0o644);
  writeReceipt("legacy-baseline-candidate.json", locked);
  process.stdout.write(`legacy baseline: eligible=${eligible.length} totalQS=${baseline.totalQualifiedSupply} lockSha=${lockSha.slice(0, 12)}\n`);
}

// §5: strict — corpus/gold/baseline raw SHA 상수 + payload 전체 exact + lockSha 내부/기대 일관성.
// extra/missing key, 값 변조, whitespace/raw-byte 변조 모두 잡는다.
// §5: 순수 strict 비교 — 임시 복사 반례로 테스트 가능(canonical 파일 오염 없음).
export function baselineStrictDrift({ corpusSha, goldSha, lockedRaw, expectedPayload }) {
  const drift = [];
  if (corpusSha !== FROZEN_CORPUS_SHA256) drift.push("corpus_raw_sha");
  if (goldSha !== CANDIDATE_GOLD_SHA256) drift.push("gold_raw_sha");
  if (typeof lockedRaw !== "string") { drift.push("baseline_lock_missing"); return drift; }
  if (sha256(lockedRaw) !== BASELINE_LOCK_RAW_SHA256) drift.push("baseline_raw_byte_sha");
  let locked;
  try { locked = JSON.parse(lockedRaw); } catch { drift.push("baseline_corrupt_json"); return drift; }
  const { lockSha256, ...lockedPayload } = locked;
  if (!deepEqualStrict(lockedPayload, expectedPayload)) drift.push("baseline_payload_mismatch");
  if (lockSha256 !== baselineLockSha(lockedPayload)) drift.push("baseline_locksha_internal_inconsistent");
  if (lockSha256 !== baselineLockSha(expectedPayload)) drift.push("baseline_locksha_expected_mismatch");
  return drift;
}
function baselineDrift() {
  let lockedRaw = null;
  try { lockedRaw = readRaw(BASELINE_LOCK_PATH); } catch { return ["baseline_lock_missing"]; }
  const { baseline, eligible } = computeBaseline();
  return baselineStrictDrift({
    corpusSha: sha256(readRaw(CORPUS_PATH)), goldSha: sha256(readRaw(GOLD_PATH)),
    lockedRaw, expectedPayload: baselineLockPayload(baseline, eligible)
  });
}
function stepCheckBaseline() {
  const drift = baselineDrift();
  if (drift.length === 0) { process.stdout.write("baseline check: OK (corpus/gold/baseline raw SHA + payload exact + lockSha strict, no drift)\n"); return; }
  process.stderr.write("baseline check DRIFT:\n" + drift.map((d) => "  " + d).join("\n") + "\n"); process.exit(1);
}

// §3/§5: 전체 무결성 — corpus v2/gold/baseline SHA + 기존 D1-C 소비 산출물 불변 + baseline strict.
export const CONSUMED_ARTIFACT_SHA = Object.freeze({
  "canary-predictions.json": "6c6bdcdd91ec8ddd0fe399dcd73e4a2ca4f3e9b34150c9a0411d95bb5584ed61",
  "run-receipt.json": "35c5fea670792fd42f9b45b1e3709a915152cbff22e34351618614d4874519a1",
  "canary-adversarial-diagnosis.json": "2f94b93c0260d82bd6b23c1e9334c98bc2f36f0a156ce3bb1826405efdfb4a3e"
});
function stepIntegrityCheck() {
  const drift = [];
  const chk = (rel, exp, label) => { try { const s = sha256(readRaw(path.join(ROOT, rel))); if (s !== exp) drift.push(`${label} ${s}`); } catch { drift.push(`${label} missing`); } };
  chk("test/fixtures/selection-d1-corpus.json", FROZEN_CORPUS_SHA256, "corpus_v2");
  chk("test/fixtures/selection-d1-gold.json", CANDIDATE_GOLD_SHA256, "gold");
  chk("test/fixtures/selection-d1-legacy-baseline.lock.json", BASELINE_LOCK_RAW_SHA256, "baseline_v2_raw");
  const old = path.join(ROOT, ".nowhot-local", "selection-d1c");
  for (const [name, exp] of Object.entries(CONSUMED_ARTIFACT_SHA)) {
    const fp = path.join(old, name);
    if (!fs.existsSync(fp)) { drift.push(`consumed_missing ${name}`); continue; }
    if (sha256(readRaw(fp)) !== exp) drift.push(`consumed_changed ${name}`);
  }
  for (const d of baselineDrift()) drift.push("baseline:" + d);
  if (drift.length === 0) { process.stdout.write("integrity check: OK (corpus v2/gold/baseline + consumed D1-C artifacts unchanged, baseline strict)\n"); return; }
  process.stderr.write("integrity check DRIFT:\n" + drift.map((x) => "  " + x).join("\n") + "\n"); process.exit(1);
}

// 4차 재검수 P1-1: 레거시 D1-C 후보 정의(--run-model 봉인 경로 전용). 유료 canary는 레지스트리 후보 필수.
function legacyD1cCandidateDef() {
  const system = typeof D1C_SYSTEM === "string" ? D1C_SYSTEM : D1C_SYSTEM.join("\n");
  return { candidateId: "d1c-p1-haiku-legacy", requestedModel: CANDIDATE_MODEL,
    resolvedAliases: [CANDIDATE_MODEL, "claude-haiku-4-5"], promptVersion: D1C_PROMPT_VERSION,
    system, promptSha256: crypto.createHash("sha256").update(system).digest("hex"), pricing: D1C_PRICING };
}
export function candidateSemanticSchema(candidateDef) {
  if (candidateDef?.semanticContract === "compact_category_v1") {
    return compactCategorySemanticSchema(candidateDef.compactPolicy);
  }
  return D1C_SEMANTIC_SCHEMA;
}

export function candidateClassificationAssembler(candidateDef) {
  if (candidateDef?.semanticContract === "compact_category_v1") {
    return (semantic, context) => assembleClassificationFromCompactCategory(semantic, {
      ...context,
      policy: candidateDef.compactPolicy
    });
  }
  return assembleClassificationFromSemantic;
}

export function candidateOutputTokenLimit(candidateDef) {
  return candidateDef?.execution?.maxOutputTokensPerCall || 1800;
}

export function makeCallModel(apiKey, resolvedModels, candidateDef = legacyD1cCandidateDef()) {
  // 재검수 P1: 응답의 실제 resolved model을 manifest에 남긴다(fetchImpl clone — llm.js 무수정).
  const capturingFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    try { const j = await res.clone().json(); if (j && typeof j.model === "string" && resolvedModels) resolvedModels.add(j.model); } catch { /* 진단 캡처 실패 무시 */ }
    return res;
  };
  return async ({ request, timeoutMs }) => {
    const { parsed, usage } = await callStructuredMessage({
      apiKey, model: candidateDef.requestedModel, system: candidateDef.system, prompt: buildUserPrompt(request),
      schema: candidateSemanticSchema(candidateDef), maxTokens: candidateOutputTokenLimit(candidateDef), timeoutMs, purpose: "selection-classify", fetchImpl: capturingFetch
    });
    return { semantic: parsed, usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } };
  };
}

function itemsForCorpus(corpus) {
  return corpus.rows.map((r) => ({
    itemId: r.blindItemId, blindItemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt,
    sourceId: r.sourceId, sourceTier: r.sourceTier, declaredSection: r.declaredSection,
    contentKindHint: r.contentKindHint, sourceCountry: r.sourceCountry, language: r.language,
    mutationPairId: r.mutationPairId, mutationRole: r.mutationRole, mutationType: r.mutationType
  }));
}

// 재검수 P1: mode="canary_only"면 canary 12건 뒤 무조건 종료(PASS여도 full 미진입).
// mode="full"이어도 fullApproved=true 명시 없이는 canary 후 FULL_NOT_APPROVED_HOLD — David 승인 없는 84건 과금 차단.
export async function stepRunModel({ dir = D1C_DIR, getApiKey = keychainApiKey, lockPath = DEFAULT_LOCK_PATH, ledgerPath = DEFAULT_LEDGER_PATH, attemptId = null, callModelFactory = makeCallModel, mode = "full", fullApproved = false, computeBaselineImpl = computeBaseline, baselineDriftImpl = baselineDrift, candidateDef = legacyD1cCandidateDef(), allowNonRunnableCandidateForTest = false } = {}) {
  const hold = (status, msg) => { process.stdout.write(`${status}: ${msg} (0 API/Keychain/write)\n`); return { status, message: msg }; };
  // §6 순서 1: consumed/attempt 상태 — 기본 dir(sealed evidence) → CONSUMED_HOLD. lock/Keychain/write 0.
  const inspect = inspectConsumedDiagnostic(dir);
  if (inspect.state === "drift") return hold("PRECONDITION_HOLD", `consumed diagnostic drift ${inspect.drift.join(",")}`);
  if (inspect.state === "sealed") return hold("D1C_CONSUMED_DIAGNOSTIC_HOLD", "sealed canary diagnostic (exact 3 SHA)");
  if (!isNonEmptyStr(attemptId)) return hold("PRECONDITION_HOLD", "attemptId required (non-empty)");
  // D1-H: registry state is the paid-execution authority. A test bypass is valid only with a non-production model factory.
  const candidateRunnable = candidateDef.execution?.runnable === true && candidateDef.execution?.state === "approved_canary";
  const safeTestBypass = allowNonRunnableCandidateForTest === true && callModelFactory !== makeCallModel;
  const executionHold = getCandidateExecutionHold(candidateDef.candidateId);
  if (executionHold && !safeTestBypass) {
    return hold("CANDIDATE_APPROVAL_CONSUMED_HOLD", `${candidateDef.candidateId} approval consumed by ${executionHold.attemptId}`);
  }
  if (!candidateRunnable && !safeTestBypass) {
    return hold("CANDIDATE_NOT_RUNNABLE_HOLD", `${candidateDef.candidateId || "unknown"} is not approved_canary`);
  }
  // §6 순서 2: 전역 실행 lock(wx). 두 번째 실행/crash 잔여 lock = RUN_IN_PROGRESS_HOLD(자동 삭제 안 함).
  let locked = false;
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); fs.writeFileSync(lockPath, `${attemptId}\n`, { flag: "wx", mode: 0o600 }); locked = true; }
  catch (e) { if (e && e.code === "EEXIST") return hold("RUN_IN_PROGRESS_HOLD", "run lock held (or stale crash lock; fail-closed, not auto-removed)"); throw e; }
  try {
    // §6 순서 3: strict ledger + unsettled=0 + attemptId 전역 유일
    const PR = candidateDef.pricing; // 4차 P1-1: 단가는 후보 정의에서만
    const ledger = createFileLedger(ledgerPath);
    const led0 = ledger.summary(PR); // corrupt면 LEDGER_CORRUPT_HOLD throw
    if (led0.unsettledReserves > 0) return hold("UNSETTLED_USAGE_HOLD", `${led0.unsettledReserves} unsettled reserve(s)`);
    if (ledger.read().some((r) => typeof r.callId === "string" && r.callId.startsWith(`${attemptId}:`))) return hold("PRECONDITION_HOLD", "attemptId already used in ledger");
    // §6 순서 4-5: corpus/gold/gates/D0/baseline raw SHA + baseline strict payload
    for (const [f, exp, lbl] of [
      ["src/feed/selection-contract.js", "8c586d5e2c4da240f606fe5eee76e86c9d1b6b3d3de61c80a9811d103b4dca5d", "d0_contract"],
      ["test/fixtures/selection-d1-gates.lock.json", "10c3160c9c098e7a4c3ca3fbd0ebaa0561bcb12f3d1bda82605a1f56a1fb7793", "gates"]
    ]) { if (sha256(readRaw(path.join(ROOT, f))) !== exp) return hold("PRECONDITION_HOLD", `${lbl} SHA drift`); }
    const bDrift = baselineDriftImpl(); // corpus/gold/baseline raw SHA + payload exact + lockSha(테스트는 주입 — 실경로 기본 불변)
    if (bDrift.length > 0) return hold("PRECONDITION_HOLD", `baseline ${bDrift.join(",")}`);
    // §6 순서 6-7: gold promoted + canonical(geo 재계산) + snapshot SHA/1:1
    const { corpus, gold, goldSha } = loadCorpusAndGold();
    if (goldSha !== CANDIDATE_GOLD_SHA256) return hold("PRECONDITION_HOLD", "gold not promoted");
    // 4차 P1-1: versions·모델·프롬프트·단가는 후보 정의에서만 나온다(러너 몰래 고정 금지).
    const versions = { modelVersion: candidateDef.requestedModel, promptVersion: candidateDef.promptVersion, taxonomyVersion: d1cTaxonomyVersion() };
    const canonical = buildCanonicalAuthority(corpus.rows, { adversarialAuthority: loadD1gAdversarialAuthority(corpus.rows) });
    computeBaselineImpl(); // snapshot 3 SHA + real 78 1:1 매핑 검증(테스트는 커밋 lock 기반 주입 가능)
    // §6 순서 8: counts — D1-G P1(재검수): 평가 집합은 단일 함수 d1gEvaluationSet(정확히 96 = corpus 96 - 감사 2 + 대체 2).
    const evalSet = d1gEvaluationSet(corpus);
    const { canaryItems, restItems, allItems } = evalSet;
    // full 평가용 gold: frozen gold에서 감사용 2건 제외 + 대체 반례 2건 합성(frozen gold 파일 무수정).
    const auditSet = new Set(evalSet.auditExcluded);
    const goldForEval = [
      ...gold.labels.filter((l) => !auditSet.has(l.itemId)),
      ...d1gReplacementGoldRows(canonical, evalSet.authority)
    ];
    // §B(122): valid cache 계산 + provider 호출 가능 canary 항목 판정 — Keychain·write 이전. 읽기만.
    const cache = new Map();
    loadPriorPredictionsIntoCache(cache, versions, dir);
    const canaryBudget = candidateCanaryBudget(candidateDef);
    let needsCall = 0, anyCallable = false; // led0는 순서 3(unsettled 체크)에서 이미 계산됨(그 사이 ledger 불변)
    for (const rawItem of canaryItems) {
      const inp = normalizeClassifierInput(rawItem);
      const req = buildStructuredRequest(inp, versions);
      if (cache.has(req.cacheKey) && validateClassifierOutput(cache.get(req.cacheKey), inp, versions).ok) continue; // valid cache
      needsCall += 1;
      if (budgetAllowsCall({ lifetimeCalls: led0.calls, lifetimeInput: led0.inputTokens, lifetimeOutput: led0.outputTokens, estInput: estTokens(req), budget: canaryBudget, pricing: PR })) { anyCallable = true; break; }
    }
    if (needsCall > 0 && !anyCallable) return hold("BUDGET_PRECONDITION_HOLD", `no callable canary item within budget (lifetime calls ${led0.calls}/max ${canaryBudget.maxCalls})`); // key/provider/write 0
    // §6 순서 write: 예산 통과 후에만 attemptDir 산출물 시작. wx no-overwrite.
    fs.mkdirSync(dir, { recursive: true });
    const aw = (name, value) => { fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); };
    aw("preflight.json", { contract: "NOWHOT-SELECTION-D1C-PREFLIGHT-001", attemptId, model: candidateDef.requestedModel, promptVersion: versions.promptVersion,
      taxonomyVersion: versions.taxonomyVersion, pricing: PR, candidateId: candidateDef.candidateId,
      limits: { canary: { maxCalls: canaryBudget.maxCalls, maxCostUsd: canaryBudget.maxCostUsd }, full: { maxCalls: 96, maxCostUsd: 1.25 }, maxTokensPerCall: candidateOutputTokenLimit(candidateDef), perCallTimeoutMs: 60000, totalDeadlineMs: 45 * 60 * 1000 },
      canaryCount: canaryItems.length, totalCount: allItems.length, needsCall });
    // §6 순서 9: Keychain은 provider 호출이 필요할 때만(전건 valid cache면 offline).
    let apiKey = null;
    if (needsCall > 0) {
      apiKey = getApiKey();
      if (!apiKey) { // 4차 P2: 실패 종단도 terminal receipt로 남긴다(manifest는 정산 완료 전용).
        aw("terminal-receipt.json", { contract: "NOWHOT-SELECTION-D1G-TERMINAL-001", attemptId, mode, candidateId: candidateDef.candidateId, status: "MODEL_KEY_MISSING", effect: { keyReads: 1, providerCalls: 0 } });
        return { status: "MODEL_KEY_MISSING" };
      }
    }
    const resolvedModels = new Set(); // 재검수 P1: 응답의 실제 resolved model — manifest에 기록
    const callModel = apiKey ? callModelFactory(apiKey, resolvedModels, candidateDef) : (async () => { throw new Error("all-cache offline path: no provider call expected"); });
    // 재검수 P1: 검증 가능한 attempt manifest — rescore가 이 지문 체인을 fail-closed 대조한다.
    const writeManifest = () => {
      const s = ledger.summary(PR);
      // manifest는 "채점 가능한 정산 완료 attempt" 전용. 실패 종단은 terminal-receipt.json으로만 남긴다.
      // 정직 표기: 본 manifest는 내부 일관성 증거이며, 임의 합성을 암호학적으로 막는 증명이 아니다.
      aw("attempt-manifest.json", { contract: "NOWHOT-SELECTION-D1G-ATTEMPT-MANIFEST-002", attemptId, mode,
        candidateId: candidateDef.candidateId, requestedModel: candidateDef.requestedModel,
        candidateTask: candidateDef.task || "combined_selection",
        candidateRecordSha256: candidateDef.candidateRecordSha256 || null,
        candidateRegistryContract: candidateDef.registryContract || null,
        resolvedModels: [...resolvedModels].sort(),
        promptVersion: candidateDef.promptVersion, promptSha256: candidateDef.promptSha256, pricing: PR,
        integrityNote: "internal-consistency evidence only; not a cryptographic proof against synthesis",
        corpusSha256: FROZEN_CORPUS_SHA256, goldSha256: CANDIDATE_GOLD_SHA256,
        gatesSha256: sha256(readRaw(FIX("selection-d1-gates.lock.json"))),
        authoritySha256: sha256(readRaw(FIX("selection-d1g-adversarial-authority-002.json"))),
        predictionsSha256: sha256(readRaw(path.join(dir, "canary-predictions.json"))),
        receiptSha256: sha256(readRaw(path.join(dir, "run-receipt.json"))),
        ledgerSha256: sha256(readRaw(ledgerPath)),
        calls: s.calls, retries: 0, costUsd: s.costUsd, unsettledReserves: s.unsettledReserves });
    };
    const opts = { versions, operatorGroupOf: operatorGroupFor, originDocumentIdOf: originDocumentIdFor, pricing: PR,
      classificationAssembler: candidateClassificationAssembler(candidateDef), now: () => Date.now() };
    const canaryRun = await runPricedClassification({ items: canaryItems, callModel, cache, ...opts, budget: canaryBudget, ledger, attemptId, phase: "canary" });
    if (canaryRun.stats.aborted) { // §C: provider 호출됨 — hold()('0 API/write') 사용 금지, 실제 효과 정직 기록.
      const lifeSum = ledger.summary(PR);
      aw("run-receipt.json", { attemptId, status: "UNSETTLED_USAGE_HOLD", reason: canaryRun.stats.abortReason, lifetime: lifeSum, unsettledReserves: lifeSum.unsettledReserves, effect: { keyReads: 1, providerCalls: canaryRun.stats.calls, attemptWrites: true } });
      aw("terminal-receipt.json", { contract: "NOWHOT-SELECTION-D1G-TERMINAL-001", attemptId, mode, candidateId: candidateDef.candidateId, status: "UNSETTLED_USAGE_HOLD", phase: "canary", reason: canaryRun.stats.abortReason, lifetime: lifeSum });
      process.stdout.write(`UNSETTLED_USAGE_HOLD: canary ${canaryRun.stats.abortReason} (provider ${canaryRun.stats.calls}x, unsettled ${lifeSum.unsettledReserves})\n`);
      return { status: "UNSETTLED_USAGE_HOLD", reason: canaryRun.stats.abortReason, lifetime: lifeSum };
    }
    const canaryPreds = canaryRun.results.map((r) => predictionOf(r));
    aw("canary-predictions.json", { versions, results: canaryPreds });
    const canaryGate = evaluateCanaryShared({ corpus, gold, canaryItems, canaryPreds, versions, gates: loadGates(), adversarialAuthority: evalSet.authority });
    const effectiveCanaryPass = candidateCanaryPass(candidateDef, canaryGate);
    const ledgerAfterCanary = ledger.summary(PR);
    const runReceiptBase = { contract: "NOWHOT-SELECTION-D1C-RUN-001", attemptId, model: candidateDef.requestedModel, candidateId: candidateDef.candidateId, versions, corpusSha: FROZEN_CORPUS_SHA256, goldSha: CANDIDATE_GOLD_SHA256,
      canary: { classified: canaryRun.stats.classified, cacheHits: canaryRun.stats.cacheHits, withheld: canaryRun.stats.withheld, schemaReject: canaryRun.stats.schemaReject, errors: canaryRun.stats.errors,
        categoryAdmissionPass: canaryGate.categoryAdmissionPass, scopePass: canaryGate.scopePass,
        adversarialPass: canaryGate.adversarialPass, adversarialDetail: canaryGate.adversarialDetail,
        mutationLabelChanged: canaryGate.mutationLabelChanged, categoryCandidatePass: canaryGate.categoryCandidatePass,
        task: candidateDef.task || "combined_selection", combinedGate: canaryGate.pass, gate: effectiveCanaryPass } };
    if (!effectiveCanaryPass) { aw("run-receipt.json", { ...runReceiptBase, status: "D1C_CANARY_HOLD", reason: canaryGate.reason, lifetime: ledgerAfterCanary }); writeManifest(); process.stdout.write(`D1C_CANARY_HOLD: ${canaryGate.reason}\n`); return { status: "D1C_CANARY_HOLD", canaryGate }; }
    // 재검수 P1: canary 12건 뒤 무조건 종료 경로 — PASS여도 full 84는 별도 David 승인 전 호출 금지.
    if (mode === "canary_only") {
      aw("run-receipt.json", { ...runReceiptBase, status: "D1C_CANARY_MEASURED", canaryOnly: true, fullSkipped: "david_approval_required", lifetime: ledgerAfterCanary });
      writeManifest();
      process.stdout.write(`D1C_CANARY_MEASURED: canary gate PASS — full 84는 David 승인 전 호출하지 않음\n`);
      return { status: "D1C_CANARY_MEASURED", canaryGate };
    }
    if (!fullApproved) {
      aw("run-receipt.json", { ...runReceiptBase, status: "FULL_NOT_APPROVED_HOLD", reason: "canary PASS했으나 fullApproved=false — 84건 과금 차단", lifetime: ledgerAfterCanary });
      writeManifest();
      process.stdout.write("FULL_NOT_APPROVED_HOLD: canary PASS — full 84는 fullApproved=true 명시 승인 필요\n");
      return { status: "FULL_NOT_APPROVED_HOLD", canaryGate };
    }
    const fullOutputLimit = candidateOutputTokenLimit(candidateDef);
    const fullBudget = { maxCalls: 96, maxInputTokens: 400000, maxOutputTokens: 96 * fullOutputLimit, maxOutputTokensPerCall: fullOutputLimit, maxCostUsd: 1.25, perCallTimeoutMs: 60000, totalDeadlineMs: 45 * 60 * 1000 };
    const restRun = await runPricedClassification({ items: restItems, callModel, cache, ...opts, budget: fullBudget, ledger, attemptId, phase: "full" });
    if (restRun.stats.aborted) { // §C: provider 호출됨 — hold() 금지, 실제 효과 정직 기록.
      const lifeSum = ledger.summary(PR);
      aw("run-receipt.json", { ...runReceiptBase, status: "UNSETTLED_USAGE_HOLD", reason: restRun.stats.abortReason, lifetime: lifeSum, unsettledReserves: lifeSum.unsettledReserves, effect: { keyReads: 1, providerCalls: canaryRun.stats.calls + restRun.stats.calls, attemptWrites: true } });
      aw("terminal-receipt.json", { contract: "NOWHOT-SELECTION-D1G-TERMINAL-001", attemptId, mode, candidateId: candidateDef.candidateId, status: "UNSETTLED_USAGE_HOLD", phase: "full", reason: restRun.stats.abortReason, lifetime: lifeSum });
      process.stdout.write(`UNSETTLED_USAGE_HOLD: full ${restRun.stats.abortReason} (provider ${canaryRun.stats.calls + restRun.stats.calls}x, unsettled ${lifeSum.unsettledReserves})\n`);
      return { status: "UNSETTLED_USAGE_HOLD", reason: restRun.stats.abortReason, lifetime: lifeSum };
    }
    const combined = [...canaryRun.results, ...restRun.results];
    const predictions = allItems.map((it) => predictionOf(combined.find((r) => r.itemId === it.blindItemId)));
    aw("full-predictions.json", { versions, results: predictions });
    const metrics = evaluatePredictions({ items: allItems, gold: goldForEval, predictions, versions, gatesLock: loadGates(), identities: D1_IDENTITIES, mode: "candidate", canonical });
    const gates = evaluateGates(metrics, loadGates(), goldForEval, { identities: D1_IDENTITIES });
    const { baseline } = computeBaselineImpl();
    const comparison = compareCandidateVsLegacy(baseline, metrics.perCategory);
    const release = computeReleasePass({ goldState: metrics.release.goldState, gates, comparison });
    const plan = planFromMetrics(metrics, gates);
    const lifetime = ledger.summary(PR); // §5: lifetime 통계는 strict ledger summary에서만
    aw("evaluation.json", { contract: "NOWHOT-SELECTION-D1C-EVAL-001", attemptId, model: candidateDef.requestedModel, versions, goldState: metrics.release.goldState, evaluableItems: metrics.release.evaluableItems, gates: gateSummary(gates), comparison, release, samplePlan: plan, effectiveNonAnswer: metrics.effectiveNonAnswer, lifetime });
    const runReceipt = { ...runReceiptBase, status: "measured", lifetime, releasePass: release.releasePass, releaseParts: release.parts, samplePlan: plan };
    aw("run-receipt.json", runReceipt);
    writeManifest();
    process.stdout.write(`D1-C measured: releasePass=${release.releasePass}\n`);
    return { status: "measured", evaluation: runReceipt, runReceipt };
  } finally {
    if (locked) { try { fs.unlinkSync(lockPath); } catch { /* controlled cleanup only */ } }
  }
}

// ---- 실행 헬퍼 ----
function loadPriorPredictionsIntoCache(cache, versions, dir) {
  let loaded = 0;
  for (const name of ["canary-predictions.json", "full-predictions.json"]) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    let data; try { data = readJson(p); } catch { continue; }
    for (const r of (data.results || [])) {
      if ((r.status === "classified" || r.status === "cache_hit") && r.classification && isNonEmptyStr(r.classification.evidenceHash)) {
        try { cache.set(cacheKeyOf(r.classification.evidenceHash, versions), r.classification); loaded += 1; } catch { /* skip corrupt */ }
      }
    }
  }
  return loaded;
}
export function predictionOf(result) {
  if (!result) return { itemId: null, status: "error", reason: "no_result" };
  const base = { itemId: result.itemId, status: result.status };
  if (result.status === "classified" || result.status === "cache_hit") base.classification = result.classification;
  else if (result.reason) base.reason = result.reason;
  return base;
}
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function pricedTotal(a, b) {
  return (a.stats.costUsd || 0) + (b ? (b.stats.costUsd || 0) : 0);
}
let _gatesCache = null;
function loadGates() {
  if (_gatesCache) return _gatesCache;
  _gatesCache = readJson(FIX("selection-d1-gates.lock.json"));
  return _gatesCache;
}
// D1-G P1(재검수): 검증된 공용 canary 평가기 — D1-C 내부 중복 평가기를 제거하고 이 하나만 쓴다.
// (run-d1d가 re-export해 d1d/e/f·rescore가 같은 함수를 쓴다. 대체 반례 gold는 authority에서 합성.)
export function evaluateCanaryShared({ corpus, gold, canaryItems, canaryPreds, versions, gates, adversarialAuthority }) {
  const classified = canaryPreds.filter((p) => p.status === "classified" || p.status === "cache_hit").length;
  if (classified !== canaryItems.length) return { pass: false, reason: `canary classified ${classified}/${canaryItems.length}`,
    adversarialPass: false, categoryAdmissionPass: false, scopePass: false, categoryCandidatePass: false,
    mutationLabelChanged: null, adversarialDetail: null };
  const canaryRows = corpus.rows.filter((r) => canaryItems.some((it) => it.blindItemId === r.blindItemId));
  const auth = adversarialAuthority || loadD1gAdversarialAuthority(canaryRows);
  const canon = buildCanonicalAuthority(canaryRows, { adversarialAuthority: auth });
  const canaryIdSet = new Set(canaryItems.map((it) => it.blindItemId));
  const goldSub = [
    ...gold.labels.filter((l) => canaryIdSet.has(l.itemId)),
    ...d1gReplacementGoldRows(canon, auth).filter((g) => canaryIdSet.has(g.itemId))
  ];
  let m;
  try {
    m = evaluatePredictions({ items: canaryItems, gold: goldSub, predictions: canaryPreds, versions, gatesLock: gates, identities: D1_IDENTITIES, mode: "candidate", canonical: canon });
  } catch (e) { return { pass: false, reason: `canary eval ${e.message}`, adversarialPass: false,
    categoryAdmissionPass: false, scopePass: false, categoryCandidatePass: false,
    mutationLabelChanged: null, adversarialDetail: null }; }
  const complete = m.adversarial.expectedCount === 10 && m.adversarial.evaluatedValid === 10;
  const categoryAdmissionPass = complete && m.adversarial.categoryAdmissionPass === true;
  const scopePass = complete && m.adversarial.scopePass === true;
  const advPass = complete && m.adversarial.pass === true;
  const pair01 = m.mutation.pairs.find((p) => p.pairId && String(p.pairId).includes("01"));
  const mutChanged = pair01 ? pair01.labelChanged === true : null;
  const pass = advPass && mutChanged === true;
  const categoryCandidatePass = categoryAdmissionPass && mutChanged === true;
  const adversarialDetail = { evaluatedValid: m.adversarial.evaluatedValid, contentTypeMismatch: m.adversarial.contentTypeMismatch,
    scopeMismatch: m.adversarial.scopeMismatch, selectedCategoryLeak: m.adversarial.selectedCategoryLeak,
    unexpectedAdmission: m.adversarial.unexpectedAdmission, expectedAdmissionMiss: m.adversarial.expectedAdmissionMiss };
  return { pass, adversarialPass: advPass, categoryAdmissionPass, scopePass, categoryCandidatePass,
    mutationLabelChanged: mutChanged, adversarialDetail,
    reason: pass ? null : `categoryAdmissionPass=${categoryAdmissionPass} scopePass=${scopePass} mutation01LabelChanged=${mutChanged}` };
}
function gateSummary(g) {
  return {
    contentType: g.contentType.pass, abstain: g.abstain.pass, adversarial: g.adversarial.pass,
    mutation: g.mutation.pass, precision: g.precision.pass, precisionInsufficient: g.precision.insufficient,
    recallStatus: g.recall.status, qualifiedSupplyStatus: g.qualifiedSupply.status
  };
}

export function candidateCanaryPass(candidateDef, canaryGate) {
  return candidateDef?.task === "category_admission_only"
    ? canaryGate?.categoryCandidatePass === true
    : canaryGate?.pass === true;
}

export function candidateCanaryBudget(candidateDef) {
  const execution = candidateDef?.execution || {};
  const approved = execution.runnable === true
    && ["approved_canary", "approved_shadow_full"].includes(execution.state);
  const maxCalls = approved ? candidateDef.execution.maxCalls : 12;
  const maxCostUsd = approved ? candidateDef.execution.maxCostUsd : 0.20;
  if (!Number.isInteger(maxCalls) || maxCalls <= 0 || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error("CANDIDATE_BUDGET_CORRUPT");
  }
  const maxOutputTokensPerCall = candidateOutputTokenLimit(candidateDef);
  return { maxCalls, maxInputTokens: execution.maxInputTokens || 400000,
    maxOutputTokens: maxCalls * maxOutputTokensPerCall, maxOutputTokensPerCall,
    maxCostUsd, perCallTimeoutMs: execution.perCallTimeoutMs || 60000,
    totalDeadlineMs: execution.totalDeadlineMs || 45 * 60 * 1000 };
}

function planFromMetrics(metrics, gates) {
  // §11: 관측 오류에 따라 추가 표본 계산(고정 100 아님). precision insufficient 분야별 planAdditionalSamples.
  const rows = [];
  for (const [category, r] of Object.entries(metrics.perCategory)) {
    const tp = r.tp, fp = r.fp;
    if (r.goldPositives === 0 && tp + fp === 0) { rows.push({ category, status: "not_applicable_sample" }); continue; }
    rows.push({ category, tp, fp, precisionLowerBound: r.precisionLowerBound });
  }
  return { note: "Wilson 0.98 unreachable on current 71-eligible sample (max positives per category ~9; news/humor positives 0). D1-C 완료 != RELEASE_READY.", perCategory: rows };
}
function writeReceipt(name, value) {
  writeJsonAtomic(path.join(D1C_DIR, name), value, 0o600);
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
async function main() {
  const arg = process.argv[2];
  if (arg === "--promote-gold") return stepPromoteGold();
  if (arg === "--measure-baseline") return stepMeasureBaseline();
  if (arg === "--check-baseline") return stepCheckBaseline();
  if (arg === "--integrity-check") return stepIntegrityCheck();
  if (arg === "--run-model") { await stepRunModel(); return; } // 역사 경로 — consumed-sealed로 도달 불가(fail-closed)
  // 재검수 P1: canary 12건만 호출하고 무조건 종료하는 CLI. full 84는 이 경로로 절대 진입하지 않는다.
  if (arg === "--run-canary") {
    const attemptId = process.argv[3];
    const candidateId = process.argv[4];
    if (!attemptId || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(attemptId) || !candidateId) {
      process.stderr.write("usage: node tools/run-selection-d1c.mjs --run-canary <attempt-id: [a-z0-9-]> <candidate-id>\n");
      process.exitCode = 2; return;
    }
    let candidateDef;
    try { candidateDef = getCandidate(candidateId); }
    catch (e) { process.stderr.write(e.message + "\n"); process.exitCode = 2; return; }
    // 4차 P2: 전용 경로 + 기존 디렉터리면 어떤 쓰기(ledger 포함)도 하기 전에 중단.
    const dir = path.join(ROOT, ".nowhot-local", "selection-attempts", attemptId);
    if (fs.existsSync(dir)) {
      process.stderr.write(`ATTEMPT_DIR_EXISTS_HOLD: ${dir} — 새 attempt-id를 사용하라(쓰기 0)\n`);
      process.exitCode = 2; return;
    }
    try { candidateDef = getRunnableCandidate(candidateId); }
    catch (e) { process.stderr.write(e.message + "\n"); process.exitCode = 2; return; }
    fs.mkdirSync(dir, { recursive: true });
    const ledgerPath = path.join(dir, "usage-ledger.jsonl");
    fs.writeFileSync(ledgerPath, "", { mode: 0o600, flag: "wx" });
    await stepRunModel({ dir, ledgerPath, lockPath: path.join(dir, ".run-lock"), attemptId, mode: "canary_only", candidateDef });
    return;
  }
  process.stderr.write("usage: node tools/run-selection-d1c.mjs --promote-gold | --measure-baseline | --check-baseline | --integrity-check | --run-model | --run-canary <attempt-id>\n");
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`d1c error: ${e.message}\n`); process.exit(1); });
}
