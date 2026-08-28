import { SLOTS, slotById } from "./digest.js";
import { EDITION_CHANGE_CONTRACT, editionSegmentKey } from "./edition-change.js";
import { EDITORIAL_FULFILLMENT_CONTRACT } from "./editorial-fulfillment.js";
import { EDITORIAL_LINEAGE_CONTRACT } from "./editorial-lineage.js";
import { EDITORIAL_QUALITY_CONTRACT } from "./editorial-quality.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-SNAPSHOT-COMPATIBILITY-CONTRACT-001",
  version: 10,
  snapshotVersion: "v30",
  requires: Object.freeze({
    editionChangeVersion: 9,
    fulfillmentVersion: 8,
    lineageVersion: 4,
    lineageFingerprintVersion: 5,
    qualityVersion: 13
  }),
  rule: "정본 판본을 바꾸는 계약 버전이 달라지면 기존 키를 재사용하지 않고 새 snapshotVersion을 명시적으로 발급한다."
});

export function editorialSnapshotCompatibilityStatus(actualOverride = null) {
  const expected = EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.requires;
  const actual = actualOverride || {
    editionChangeVersion: EDITION_CHANGE_CONTRACT.version,
    fulfillmentVersion: EDITORIAL_FULFILLMENT_CONTRACT.version,
    lineageVersion: EDITORIAL_LINEAGE_CONTRACT.version,
    lineageFingerprintVersion: EDITORIAL_LINEAGE_CONTRACT.fingerprintVersion,
    qualityVersion: EDITORIAL_QUALITY_CONTRACT.version
  };
  const mismatches = Object.keys(expected).filter((key) => expected[key] !== actual[key]);
  return {
    contractId: EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.stableId,
    contractVersion: EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.version,
    snapshotVersion: EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.snapshotVersion,
    pass: mismatches.length === 0,
    state: mismatches.length ? "snapshot_contract_mismatch" : "snapshot_contract_compatible",
    fingerprint: [
      `edition-change:${actual.editionChangeVersion}`,
      `fulfillment:${actual.fulfillmentVersion}`,
      `lineage:${actual.lineageVersion}`,
      `lineage-fingerprint:${actual.lineageFingerprintVersion}`,
      `quality:${actual.qualityVersion}`
    ].join("|"),
    expected: { ...expected },
    actual,
    mismatches
  };
}

export function assertEditorialSnapshotCompatibility(actualOverride = null) {
  const status = editorialSnapshotCompatibilityStatus(actualOverride);
  if (status.pass) return status;
  const error = new Error(`editorial snapshot contract mismatch: ${status.mismatches.join(",")}`);
  error.code = "EDITORIAL_SNAPSHOT_CONTRACT_MISMATCH";
  error.compatibility = status;
  throw error;
}

export const EDITORIAL_INVENTORY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-INVENTORY-CONTRACT-001",
  receiptId: "NOWHOT-EDITORIAL-INVENTORY-001",
  snapshotVersion: EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.snapshotVersion,
  compatibilityContractId: EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.stableId,
  cadence: ["morning", "lunch", "evening"],
  sharingUnit: "sorted_category_combination",
  privacy: "카테고리 ID 조합과 집계 인원만 사용하며 사용자 ID를 판본 키에 넣지 않는다.",
  costRule: "같은 카테고리 조합은 슬롯당 한 번만 결정론적으로 생성하고 제한 큐로 백필한다.",
  queuePriorityRule: "기존 판의 요약 워밍업은 모든 분야의 최신 슬롯을 먼저 처리하고, 누락 판 생성은 기본 조합·이용자 수·시간순을 지킨다.",
  backfillOrderRule: "48시간 누적 풀에서 슬롯 as-of를 먼저 적용하고 그 시점의 소스 상한 뒤 현재판과 같은 항목 분류를 적용한다.",
  llmCallsPerSegment: 0,
  llmCallsPerNewEvidenceSegmentWhenEnabledMax: 2
});

export function kstDate(ms) {
  return new Date(Number(ms) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function slotAsOfMs(date, slotId) {
  const slot = slotById(slotId);
  const hour = String(slot.publishHour).padStart(2, "0");
  return Date.parse(`${date}T${hour}:00:00+09:00`);
}

export function dueEditorialSlots(nowMs, slots = SLOTS) {
  const date = kstDate(nowMs);
  return slots
    .map((slot) => ({
      date,
      slot,
      asOfMs: slotAsOfMs(date, slot.id)
    }))
    .filter((entry) => entry.asOfMs <= nowMs);
}

export function nextEditorialSlot(nowMs, slots = SLOTS) {
  const today = kstDate(nowMs);
  for (const slot of slots) {
    const asOfMs = slotAsOfMs(today, slot.id);
    if (asOfMs > nowMs) return { date: today, slot, asOfMs };
  }
  const tomorrow = kstDate(Number(nowMs) + DAY_MS);
  const slot = slots[0];
  return { date: tomorrow, slot, asOfMs: slotAsOfMs(tomorrow, slot.id) };
}

// 자정부터 첫 모닝판 전에는 오늘 도래 슬롯이 0개다. 그때 서버가 재기동되면
// 전날 누락 세 판을 복구할 마지막 자연스러운 창이므로 전날 전체를 점검한다.
export function inventoryEditorialSlots(nowMs, slots = SLOTS) {
  const due = dueEditorialSlots(nowMs, slots);
  if (due.length) return due;
  const yesterday = kstDate(nowMs - DAY_MS);
  return slots.map((slot) => ({
    date: yesterday,
    slot,
    asOfMs: slotAsOfMs(yesterday, slot.id)
  }));
}

export function resolveEditorialTarget(nowMs, requestedSlotId = null) {
  const today = kstDate(nowMs);
  if (requestedSlotId) {
    const slot = slotById(requestedSlotId);
    const asOfMs = slotAsOfMs(today, slot.id);
    return {
      available: asOfMs <= nowMs,
      date: today,
      slot,
      asOfMs
    };
  }

  const due = dueEditorialSlots(nowMs);
  if (due.length) return { available: true, ...due[due.length - 1] };

  const yesterday = kstDate(nowMs - DAY_MS);
  const slot = SLOTS[SLOTS.length - 1];
  return {
    available: true,
    date: yesterday,
    slot,
    asOfMs: slotAsOfMs(yesterday, slot.id)
  };
}

export function editorialInventorySegmentKey(categories) {
  return `${EDITORIAL_INVENTORY_CONTRACT.snapshotVersion}:${editionSegmentKey(categories)}`;
}

function normalizeCategories(categories, known) {
  return [...new Set((Array.isArray(categories) ? categories : [])
    .map((value) => String(value || "").trim())
    .filter((value) => value && (!known || known.has(value))))].sort();
}

export function collectEditorialSegments(store, defaultCategories, knownCategoryIds = null) {
  const known = knownCategoryIds ? new Set(knownCategoryIds) : null;
  const segments = new Map();
  const add = (categories, { isDefault = false, audienceCount = 0 } = {}) => {
    const normalized = normalizeCategories(categories, known);
    if (!normalized.length) return;
    const key = editorialInventorySegmentKey(normalized);
    const previous = segments.get(key);
    segments.set(key, {
      key,
      categories: normalized,
      isDefault: Boolean(isDefault || previous && previous.isDefault),
      audienceCount: Number(audienceCount) + Number(previous && previous.audienceCount || 0)
    });
  };

  add(defaultCategories, { isDefault: true });
  for (const categoryId of known || []) add([categoryId]);
  for (const user of store && store.users ? store.users.values() : []) {
    const saved = normalizeCategories(user && user.briefingCategories, known);
    const survey = normalizeCategories(user && user.surveyAnswers && user.surveyAnswers.categories, known);
    add(saved.length ? saved : survey.length ? survey : defaultCategories, { audienceCount: 1 });
  }

  return [...segments.values()].sort((a, b) =>
    Number(b.isDefault) - Number(a.isDefault) ||
    b.audienceCount - a.audienceCount ||
    a.key.localeCompare(b.key)
  );
}

function slotSummary(expected, store) {
  return expected.map(({ date, slot, asOfMs, segments }) => {
    const stored = segments.filter((segment) =>
      store.getEditorialEdition(date, slot.id, segment.key)
    );
    const publishable = stored.filter((segment) =>
      store.getEditorialEdition(date, slot.id, segment.key).publishable
    ).length;
    return {
      id: slot.id,
      label: slot.label,
      date,
      asOf: new Date(asOfMs).toISOString(),
      expected: segments.length,
      stored: stored.length,
      publishable,
      held: stored.length - publishable,
      missing: segments.length - stored.length
    };
  });
}

export async function buildEditorialInventory({
  store,
  buildEdition,
  nowMs = Date.now(),
  clock = () => nowMs,
  defaultCategories,
  knownCategoryIds = null,
  batchLimit = 12,
  needsRefresh = null
}) {
  const compatibility = assertEditorialSnapshotCompatibility();
  const segments = collectEditorialSegments(store, defaultCategories, knownCategoryIds);
  const dueSlots = inventoryEditorialSlots(nowMs);
  const expected = dueSlots.map((entry) => ({ ...entry, segments }));
  const queue = [];

  // 제한 큐가 저이용 조합의 과거 누락에 잠기지 않게 조합을 먼저 우선한다.
  // 한 조합 안에서는 모닝→런치→이브닝을 지켜 직전 판 변화 계보를 보존한다.
  for (const segment of segments) {
    for (const entry of expected) {
      const existing = store.getEditorialEdition(entry.date, entry.slot.id, segment.key);
      const refresh = Boolean(existing && needsRefresh && needsRefresh(existing));
      if (existing && !refresh) continue;
      queue.push({ ...entry, segment, refresh });
    }
  }
  queue.sort((a, b) =>
    Number(b.refresh) - Number(a.refresh) ||
    (a.refresh ? b.asOfMs - a.asOfMs : 0)
  );

  const limit = Math.max(1, Math.min(48, Math.floor(Number(batchLimit) || 12)));
  const attempted = queue.slice(0, limit);
  const built = [];
  const errors = [];
  for (const job of attempted) {
    try {
      const edition = await buildEdition({
        categories: job.segment.categories,
        slotId: job.slot.id,
        targetDate: job.date,
        asOfMs: job.asOfMs,
        generationMode: job.refresh ? "inventory_summary_warmup" : "inventory_backfill"
      });
      if (edition) built.push({
        slotId: job.slot.id,
        segmentKey: job.segment.key,
        publishable: Boolean(edition.publishable),
        llmCalls: Number(edition.editorialLlm && edition.editorialLlm.calls || 0),
        llmCacheHits: Number(edition.editorialLlm && edition.editorialLlm.cacheHits || 0)
      });
    } catch (error) {
      errors.push({
        slotId: job.slot.id,
        segmentKey: job.segment.key,
        error: String(error && error.message || error).slice(0, 160)
      });
    }
  }

  const slots = slotSummary(expected, store);
  const expectedCount = slots.reduce((sum, slot) => sum + slot.expected, 0);
  const storedCount = slots.reduce((sum, slot) => sum + slot.stored, 0);
  const publishableCount = slots.reduce((sum, slot) => sum + slot.publishable, 0);
  const missingCount = expectedCount - storedCount;
  const state = missingCount
    ? "inventory_backlog"
    : storedCount > publishableCount
      ? "inventory_complete_with_holds"
      : "inventory_complete";
  const completedRaw = clock();
  const completedAtMs = typeof completedRaw === "number" ? completedRaw : Date.parse(completedRaw);
  const safeCompletedAtMs = Number.isFinite(completedAtMs) ? completedAtMs : Number(nowMs);

  return {
    stableId: EDITORIAL_INVENTORY_CONTRACT.receiptId,
    contractId: EDITORIAL_INVENTORY_CONTRACT.stableId,
    snapshotVersion: EDITORIAL_INVENTORY_CONTRACT.snapshotVersion,
    compatibility,
    state,
    startedAt: new Date(Number(nowMs)).toISOString(),
    completedAt: new Date(safeCompletedAtMs).toISOString(),
    observedAt: new Date(safeCompletedAtMs).toISOString(),
    durationMs: Math.max(0, safeCompletedAtMs - Number(nowMs)),
    date: kstDate(nowMs),
    segmentCount: segments.length,
    representedUserCount: segments.reduce((sum, segment) => sum + segment.audienceCount, 0),
    segmentSharing: EDITORIAL_INVENTORY_CONTRACT.sharingUnit,
    privacy: EDITORIAL_INVENTORY_CONTRACT.privacy,
    segments,
    slots,
    expectedCount,
    storedCount,
    publishableCount,
    heldCount: storedCount - publishableCount,
    builtCount: built.length,
    missingCount,
    backlogCount: missingCount,
    batchLimit: limit,
    errors,
    llmCalls: built.reduce((sum, row) => sum + row.llmCalls, 0),
    llmCacheHits: built.reduce((sum, row) => sum + row.llmCacheHits, 0),
    actualElapsedTimeProof: false,
    proves: "슬롯 발행시각 기준 생성·누락 판 백필·동일 카테고리 조합 공유 저장 경로",
    doesNotProve: "실제 시간차 수집 충분성·사람 편집 품질 PASS·운영 배포"
  };
}
