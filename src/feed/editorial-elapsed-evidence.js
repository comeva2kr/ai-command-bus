import { SLOTS } from "./digest.js";

const DEFAULT_CAPTURE_WINDOW_MS = 10 * 60 * 1000;

export const ELAPSED_EDITION_EVIDENCE_CONTRACT = Object.freeze({
  stableId: "NOWHOT-ELAPSED-EDITION-EVIDENCE-CONTRACT-001",
  receiptId: "NOWHOT-ELAPSED-EDITION-EVIDENCE-001",
  captureWindowMs: DEFAULT_CAPTURE_WINDOW_MS,
  clockRule: "시스템 시계로 슬롯 발행 후 10분 안에 저장까지 끝난 최초 관측만 정시 실행으로 인정한다.",
  appendOnly: "날짜·슬롯별 최초 관측은 덮어쓰지 않는다.",
  proofRule: "세 슬롯이 모두 정시 관측·재고 완결·발행 가능·서로 다른 콘텐츠 지문이고 같은 기본 공유 조합도 세 판을 충족할 때만 실제 시간차 증거가 된다."
});

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function classifyEditorialCapture({
  asOfMs,
  observedAtMs,
  clockSource = "system",
  captureWindowMs = DEFAULT_CAPTURE_WINDOW_MS
}) {
  const delayMs = Number(observedAtMs) - Number(asOfMs);
  const windowMs = Math.max(1, Number(captureWindowMs) || DEFAULT_CAPTURE_WINDOW_MS);
  if (!Number.isFinite(delayMs) || delayMs < 0) return { mode: "invalid_future", delayMs, windowMs };
  if (clockSource !== "system") return { mode: "injected_clock", delayMs, windowMs };
  return {
    mode: delayMs <= windowMs ? "scheduled_window" : "late_backfill",
    delayMs,
    windowMs
  };
}

function editionContentRows(editions) {
  return (editions || []).flatMap(({ segmentKey, edition }) =>
    (edition && Array.isArray(edition.issues) ? edition.issues : []).map((issue) => ({
      segmentKey,
      eventKey: issue.eventKey || issue.id || null,
      headline: issue.headline || null,
      refs: (issue.refs || []).map((ref) => ref.id || ref.title || null).filter(Boolean).sort()
    }))
  ).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function segmentObservationRows(segments, editions) {
  const byKey = new Map((editions || []).map((row) => [row.segmentKey, row.edition || null]));
  return (segments || []).map((segment) => {
    const edition = byKey.get(segment.key) || null;
    const fulfillment = edition && edition.categoryFulfillment || null;
    const contentRows = edition ? editionContentRows([{ segmentKey: segment.key, edition }]) : [];
    return {
      segmentKey: segment.key,
      categories: (segment.categories || []).slice().sort(),
      isDefault: Boolean(segment.isDefault),
      audienceCount: Number(segment.audienceCount || 0),
      stored: Boolean(edition),
      publishable: Boolean(edition && edition.publishable),
      fulfillmentState: fulfillment && fulfillment.state || "not_observed",
      fulfillmentGoalSatisfied: fulfillment ? Boolean(fulfillment.goalSatisfied) : null,
      metCount: fulfillment && Number(fulfillment.metCount || 0),
      selectedCount: fulfillment && Number(fulfillment.selectedCount || 0),
      underfilledCategoryIds: fulfillment && fulfillment.underfilledCategoryIds || [],
      noQualifiedCategoryIds: fulfillment && fulfillment.noQualifiedCategoryIds || [],
      missingCategoryIds: fulfillment && fulfillment.missingCategoryIds || [],
      issueCount: contentRows.length,
      contentFingerprint: edition ? stableHash(JSON.stringify(contentRows)) : null,
      generationMode: edition && edition.editionSegment && edition.editionSegment.generationMode || null
    };
  }).sort((a, b) => a.segmentKey.localeCompare(b.segmentKey));
}

export function buildEditorialSlotObservation({
  date,
  slot,
  asOfMs,
  observedAtMs,
  clockSource = "system",
  segments = [],
  editions = [],
  timingBasis = "observed_at",
  inventoryStartedAt = null,
  inventoryCompletedAt = null,
  inventoryDurationMs = null,
  captureWindowMs = DEFAULT_CAPTURE_WINDOW_MS
}) {
  const capture = classifyEditorialCapture({ asOfMs, observedAtMs, clockSource, captureWindowMs });
  const stored = editions.filter((row) => row && row.edition).length;
  const publishable = editions.filter((row) => row && row.edition && row.edition.publishable).length;
  const expected = segments.length;
  const missing = Math.max(0, expected - stored);
  const contentRows = editionContentRows(editions);
  const generationModes = [...new Set(editions
    .map((row) => row && row.edition && row.edition.editionSegment && row.edition.editionSegment.generationMode)
    .filter(Boolean))].sort();
  const segmentRows = segmentObservationRows(segments, editions);
  const state = missing
    ? "slot_observed_with_missing"
    : publishable < stored
      ? "slot_observed_with_holds"
      : "slot_observed_complete";

  return {
    stableId: ELAPSED_EDITION_EVIDENCE_CONTRACT.receiptId,
    contractId: ELAPSED_EDITION_EVIDENCE_CONTRACT.stableId,
    key: `${date}|${slot.id}`,
    date,
    slotId: slot.id,
    slotLabel: slot.label,
    asOf: new Date(Number(asOfMs)).toISOString(),
    observedAt: new Date(Number(observedAtMs)).toISOString(),
    timingBasis,
    inventoryStartedAt,
    inventoryCompletedAt,
    inventoryDurationMs: inventoryDurationMs != null && Number.isFinite(Number(inventoryDurationMs))
      ? Number(inventoryDurationMs)
      : null,
    clockSource,
    captureMode: capture.mode,
    delayMs: capture.delayMs,
    captureWindowMs: capture.windowMs,
    state,
    expected,
    stored,
    publishable,
    held: stored - publishable,
    missing,
    segmentKeys: segments.map((segment) => segment.key).sort(),
    segmentRows,
    generationModes,
    issueCount: contentRows.length,
    contentFingerprint: stableHash(JSON.stringify(contentRows)),
    actualWindowCandidate: capture.mode === "scheduled_window" && state === "slot_observed_complete"
  };
}

function proofTiming(row) {
  const completedAtMs = Date.parse(row && row.inventoryCompletedAt || "");
  const savedAtMs = Number(row && row.savedAt);
  const observedAtMs = Date.parse(row && row.observedAt || "");
  const proofObservedAtMs = Number.isFinite(completedAtMs)
    ? completedAtMs
    : Number.isFinite(savedAtMs)
      ? savedAtMs
      : observedAtMs;
  const timingBasis = Number.isFinite(completedAtMs)
    ? "inventory_completed"
    : Number.isFinite(savedAtMs)
      ? "persisted_after_inventory"
      : row && row.timingBasis || "observed_at";
  const capture = classifyEditorialCapture({
    asOfMs: Date.parse(row && row.asOf || ""),
    observedAtMs: proofObservedAtMs,
    clockSource: row && row.clockSource || "system",
    captureWindowMs: row && row.captureWindowMs
  });
  return {
    timingBasis,
    proofObservedAt: Number.isFinite(proofObservedAtMs) ? new Date(proofObservedAtMs).toISOString() : null,
    proofCaptureMode: capture.mode,
    proofDelayMs: capture.delayMs
  };
}

function summarizeSegmentProofs(slots) {
  const keys = [...new Set(slots.flatMap((slot) =>
    (slot.segmentRows || []).map((row) => row.segmentKey)
  ))].sort();
  return keys.map((segmentKey) => {
    const rows = slots.map((slot) => ({
      slot,
      segment: (slot.segmentRows || []).find((row) => row.segmentKey === segmentKey) || null
    }));
    const observed = rows.filter((row) => row.segment);
    const sample = observed[0] && observed[0].segment;
    const fingerprints = new Set(observed
      .map((row) => row.segment.contentFingerprint)
      .filter(Boolean));
    const chronological = observed.length === SLOTS.length && observed.every((row, index) =>
      index === 0 || Date.parse(row.slot.proofObservedAt || row.slot.observedAt) >
        Date.parse(observed[index - 1].slot.proofObservedAt || observed[index - 1].slot.observedAt)
    );
    const onTimeCount = observed.filter((row) => row.slot.captureMode === "scheduled_window").length;
    const storedCount = observed.filter((row) => row.segment.stored).length;
    const publishableCount = observed.filter((row) => row.segment.publishable).length;
    const fulfillmentCount = observed.filter((row) => row.segment.fulfillmentGoalSatisfied === true).length;
    const actualElapsedTimeProof = observed.length === SLOTS.length &&
      onTimeCount === SLOTS.length &&
      storedCount === SLOTS.length &&
      publishableCount === SLOTS.length &&
      fulfillmentCount === SLOTS.length &&
      fingerprints.size === SLOTS.length &&
      chronological;
    return {
      segmentKey,
      categories: sample && sample.categories || [],
      isDefault: Boolean(sample && sample.isDefault),
      observedCount: observed.length,
      onTimeCount,
      storedCount,
      publishableCount,
      fulfillmentCount,
      distinctContentCount: fingerprints.size,
      chronological,
      actualElapsedTimeProof,
      slots: rows.map(({ slot, segment }) => ({
        slotId: slot.slotId,
        captureMode: slot.captureMode,
        stored: Boolean(segment && segment.stored),
        publishable: Boolean(segment && segment.publishable),
        fulfillmentGoalSatisfied: segment && segment.fulfillmentGoalSatisfied,
        issueCount: segment && segment.issueCount || 0,
        contentFingerprint: segment && segment.contentFingerprint || null,
        underfilledCategoryIds: segment && segment.underfilledCategoryIds || [],
        noQualifiedCategoryIds: segment && segment.noQualifiedCategoryIds || [],
        missingCategoryIds: segment && segment.missingCategoryIds || []
      }))
    };
  });
}

export function summarizeElapsedEditionEvidence(observations, { date = null } = {}) {
  const bySlot = new Map((observations || []).map((row) => [row.slotId, row]));
  const slots = SLOTS.map((slot) => {
    const stored = bySlot.get(slot.id);
    if (!stored) return {
      date,
      slotId: slot.id,
      slotLabel: slot.label,
      state: "slot_not_observed",
      captureMode: "not_observed",
      actualWindowCandidate: false
    };
    const timing = proofTiming(stored);
    return {
      ...stored,
      recordedCaptureMode: stored.captureMode,
      timingBasis: timing.timingBasis,
      proofObservedAt: timing.proofObservedAt,
      captureMode: timing.proofCaptureMode,
      delayMs: timing.proofDelayMs,
      actualWindowCandidate: timing.proofCaptureMode === "scheduled_window" &&
        stored.state === "slot_observed_complete"
    };
  });
  const captured = slots.filter((row) => row.state !== "slot_not_observed");
  const onTimeCount = captured.filter((row) => row.captureMode === "scheduled_window").length;
  const readyCount = captured.filter((row) => row.state === "slot_observed_complete").length;
  const fingerprints = new Set(captured.filter((row) => row.issueCount > 0).map((row) => row.contentFingerprint));
  const ordered = captured.length === SLOTS.length && captured.every((row, index) =>
    index === 0 || Date.parse(row.proofObservedAt || row.observedAt) >
      Date.parse(captured[index - 1].proofObservedAt || captured[index - 1].observedAt)
  );
  const segmentProofs = summarizeSegmentProofs(slots);
  const defaultSegmentProof = segmentProofs.find((row) => row.isDefault) ||
    (segmentProofs.length === 1 ? segmentProofs[0] : null);
  const aggregateElapsedProof = captured.length === SLOTS.length &&
    onTimeCount === SLOTS.length &&
    readyCount === SLOTS.length &&
    fingerprints.size === SLOTS.length &&
    ordered;
  const actualElapsedTimeProof = aggregateElapsedProof && Boolean(
    defaultSegmentProof && defaultSegmentProof.actualElapsedTimeProof
  );
  const segmentProofCount = segmentProofs.filter((row) => row.actualElapsedTimeProof).length;
  const segmentCoverageComplete = segmentProofs.length > 0 && segmentProofCount === segmentProofs.length;
  const state = actualElapsedTimeProof
    ? segmentCoverageComplete
      ? "actual_elapsed_evidence_complete"
      : "actual_elapsed_evidence_complete_with_segment_holds"
    : captured.length < SLOTS.length
      ? "elapsed_evidence_collecting"
      : "elapsed_evidence_complete_with_limits";

  return {
    stableId: ELAPSED_EDITION_EVIDENCE_CONTRACT.receiptId,
    contractId: ELAPSED_EDITION_EVIDENCE_CONTRACT.stableId,
    date: date || captured[0] && captured[0].date || null,
    state,
    slots,
    capturedCount: captured.length,
    onTimeCount,
    readyCount,
    heldOrMissingCount: captured.filter((row) => row.held || row.missing).length,
    distinctContentCount: fingerprints.size,
    chronological: ordered,
    aggregateElapsedProof,
    defaultSegmentKey: defaultSegmentProof && defaultSegmentProof.segmentKey || null,
    defaultSegmentActualElapsedTimeProof: Boolean(defaultSegmentProof && defaultSegmentProof.actualElapsedTimeProof),
    segmentProofCount,
    segmentHoldCount: segmentProofs.length - segmentProofCount,
    segmentCoverageComplete,
    segmentProofs,
    actualElapsedTimeProof,
    proves: actualElapsedTimeProof
      ? segmentCoverageComplete
        ? "시스템 시계 기준 실제 07·12·19시 정시 실행과 관측된 공유 조합의 완결된 서로 다른 세 판"
        : "시스템 시계 기준 기본 공유 조합의 실제 07·12·19시 정시 실행과 서로 다른 세 판"
      : "현재까지 보존된 슬롯 실행 시각·지연·재고·발행 상태",
    doesNotProve: actualElapsedTimeProof
      ? segmentCoverageComplete
        ? "사람 편집 품질 PASS·운영 배포"
        : "보류된 공유 조합의 세 판 충족·사람 편집 품질 PASS·운영 배포"
      : "완결된 실제 시간차 세 판·사람 편집 품질 PASS·운영 배포"
  };
}
