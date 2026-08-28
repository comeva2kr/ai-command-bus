import { SLOTS } from "./digest.js";
import { summarizeElapsedEditionEvidence } from "./editorial-elapsed-evidence.js";
import { dueEditorialSlots, kstDate } from "./editorial-inventory.js";
import { verifyEditorialLineage } from "./editorial-lineage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const EDITORIAL_RELIABILITY_HISTORY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-RELIABILITY-HISTORY-CONTRACT-001",
  receiptId: "NOWHOT-EDITORIAL-RELIABILITY-HISTORY-001",
  defaultWindowDays: 30,
  source: "append_only_system_clock_editorial_slot_observations",
  rule: "실제 시스템 시계 관측만 사용한다. 오늘은 현재까지 도래한 슬롯만 평가하고, 관측이 시작된 뒤 통째로 비어 있는 과거 날짜는 누락으로 남긴다.",
  fixedItemCount: false
});

export const EDITORIAL_QUALITY_HISTORY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-QUALITY-HISTORY-CONTRACT-001",
  receiptId: "NOWHOT-EDITORIAL-QUALITY-HISTORY-001",
  defaultWindowDays: 30,
  source: "immutable_saved_editions_and_frozen_human_review_ledgers",
  samplingRule: "각 슬롯의 가장 넓은 공유 카테고리 조합을 자동 동결하되 활성 검수 대상은 바꾸지 않는다.",
  rule: "저장 판의 최종 기계 게이트·주장 계보·근거 유형·분야 충족과 별도 사람 검수 진행률을 날짜·슬롯별로 집계한다.",
  fixedItemCount: false
});

const addDays = (date, offset) => new Date(
  Date.parse(`${date}T00:00:00.000Z`) + Number(offset) * DAY_MS
).toISOString().slice(0, 10);

function dateRange(start, end) {
  const rows = [];
  for (let date = start; date <= end; date = addDays(date, 1)) rows.push(date);
  return rows;
}

function dueSlotIdsForDate(date, today, nowMs, monitoringStart) {
  if (!monitoringStart || date < monitoringStart.date) return [];
  const eligibleSlots = date === monitoringStart.date
    ? SLOTS.slice(monitoringStart.slotIndex)
    : SLOTS;
  if (date < today) return eligibleSlots.map((slot) => slot.id);
  if (date > today) return [];
  const eligibleIds = new Set(eligibleSlots.map((slot) => slot.id));
  return dueEditorialSlots(nowMs)
    .map((entry) => entry.slot.id)
    .filter((slotId) => eligibleIds.has(slotId));
}

function categoryHolds(rows) {
  const ids = new Set();
  for (const observation of rows) {
    for (const segment of observation.segmentRows || []) {
      for (const id of [
        ...(segment.underfilledCategoryIds || []),
        ...(segment.noQualifiedCategoryIds || []),
        ...(segment.missingCategoryIds || [])
      ]) ids.add(id);
    }
  }
  return [...ids].sort();
}

export function buildEditorialReliabilityHistory(observations, {
  nowMs = Date.now(),
  windowDays = EDITORIAL_RELIABILITY_HISTORY_CONTRACT.defaultWindowDays
} = {}) {
  const today = kstDate(nowMs);
  const limit = Math.max(1, Math.min(90, Math.floor(Number(windowDays) || 30)));
  const eligibleRows = (Array.isArray(observations) ? observations : [])
    .filter((row) => row && row.date && row.date <= today);
  const systemRows = eligibleRows.filter((row) => row.clockSource === "system");
  const baselineRows = systemRows
    .filter((row) => row.actualWindowCandidate === true || row.captureMode === "scheduled_window")
    .map((row) => ({
      row,
      slotIndex: SLOTS.findIndex((slot) => slot.id === row.slotId)
    }))
    .filter((entry) => entry.slotIndex >= 0)
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.slotIndex - b.slotIndex);
  const baseline = baselineRows[0] || null;
  const monitoringStart = baseline ? {
    date: baseline.row.date,
    slotId: baseline.row.slotId,
    slotIndex: baseline.slotIndex,
    observedAt: baseline.row.proofObservedAt || baseline.row.observedAt || null
  } : null;
  const sourceRows = monitoringStart ? systemRows.filter((row) => {
    if (row.date > monitoringStart.date) return true;
    if (row.date < monitoringStart.date) return false;
    const slotIndex = SLOTS.findIndex((slot) => slot.id === row.slotId);
    return slotIndex >= monitoringStart.slotIndex;
  }) : [];
  const excludedNonSystemObservationCount = eligibleRows.length - systemRows.length;
  const excludedPreMonitoringObservationCount = systemRows.length - sourceRows.length;
  const observedDates = [...new Set(sourceRows.map((row) => row.date))].sort();
  const windowStart = addDays(today, -(limit - 1));
  const firstObserved = monitoringStart ? monitoringStart.date : today;
  const start = firstObserved > windowStart ? firstObserved : windowStart;

  const rows = dateRange(start, today).map((date) => {
    const dateRows = sourceRows.filter((row) => row.date === date);
    const expectedSlotIds = dueSlotIdsForDate(date, today, nowMs, monitoringStart);
    const dueSet = new Set(expectedSlotIds);
    const report = summarizeElapsedEditionEvidence(dateRows, { date });
    const dueRows = report.slots.filter((row) => dueSet.has(row.slotId));
    const captured = dueRows.filter((row) => row.state !== "slot_not_observed");
    const onTime = captured.filter((row) => row.captureMode === "scheduled_window");
    const ready = captured.filter((row) => row.state === "slot_observed_complete");
    const fingerprints = new Set(captured
      .filter((row) => Number(row.issueCount || 0) > 0 && row.contentFingerprint)
      .map((row) => row.contentFingerprint));
    const missingDueCount = Math.max(0, expectedSlotIds.length - captured.length);
    const lateCount = captured.length - onTime.length;
    const heldCount = captured.filter((row) => row.state !== "slot_observed_complete").length;
    const repeatedContentCount = Math.max(0, captured.length - fingerprints.size);
    const heldCategoryIds = categoryHolds(captured);
    const fullyDue = expectedSlotIds.length === SLOTS.length;

    let state = "waiting_for_first_slot";
    if (expectedSlotIds.length) {
      if (missingDueCount) state = "attention_missing_slot";
      else if (lateCount) state = "attention_late_capture";
      else if (heldCount) state = "attention_inventory_hold";
      else if (heldCategoryIds.length) state = "attention_category_hold";
      else if (captured.length > 1 && repeatedContentCount) state = "attention_repeated_content";
      else if (fullyDue && report.actualElapsedTimeProof && report.segmentCoverageComplete) {
        state = "daily_evidence_complete";
      } else if (fullyDue) state = "attention_evidence_limit";
      else state = "healthy_so_far";
    }

    return {
      date,
      state,
      expectedSlotIds,
      expectedSlotCount: expectedSlotIds.length,
      capturedCount: captured.length,
      onTimeCount: onTime.length,
      readyCount: ready.length,
      distinctContentCount: fingerprints.size,
      missingDueCount,
      lateCount,
      heldCount,
      repeatedContentCount,
      heldCategoryIds,
      actualElapsedTimeProof: Boolean(report.actualElapsedTimeProof),
      segmentCoverageComplete: Boolean(report.segmentCoverageComplete)
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.expectedSlots += row.expectedSlotCount;
    acc.capturedSlots += row.capturedCount;
    acc.onTimeSlots += row.onTimeCount;
    acc.readySlots += row.readyCount;
    acc.missingDueSlots += row.missingDueCount;
    acc.lateSlots += row.lateCount;
    acc.heldSlots += row.heldCount;
    if (row.heldCategoryIds.length) acc.categoryHoldDays += 1;
    if (row.state === "daily_evidence_complete") acc.completeDays += 1;
    return acc;
  }, {
    expectedSlots: 0,
    capturedSlots: 0,
    onTimeSlots: 0,
    readySlots: 0,
    missingDueSlots: 0,
    lateSlots: 0,
    heldSlots: 0,
    categoryHoldDays: 0,
    completeDays: 0
  });
  totals.onTimeRatePct = totals.expectedSlots
    ? Math.round(totals.onTimeSlots / totals.expectedSlots * 100)
    : null;
  const attentionDays = rows.filter((row) => row.state.startsWith("attention_")).length;
  const state = attentionDays
    ? "reliability_attention_required"
    : totals.completeDays
      ? "reliability_history_complete"
      : "reliability_collecting";

  return {
    stableId: EDITORIAL_RELIABILITY_HISTORY_CONTRACT.receiptId,
    contractId: EDITORIAL_RELIABILITY_HISTORY_CONTRACT.stableId,
    state,
    today,
    windowDays: limit,
    firstObservedDate: observedDates[0] || null,
    monitoringStart,
    evaluatedObservationCount: sourceRows.length,
    excludedNonSystemObservationCount,
    excludedPreMonitoringObservationCount,
    rows: rows.reverse(),
    totals: { ...totals, attentionDays },
    fixedItemCount: false,
    proves: "관측 시작 뒤 날짜별 도래 슬롯의 정시·누락·완결·분야 보류·내용 변화 추세",
    doesNotProve: "사람 편집 품질 PASS·원문 사실성·운영 배포"
  };
}

const SLOT_INDEX = new Map(SLOTS.map((slot, index) => [slot.id, index]));

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  }
  return target;
}

function summarizeSavedEdition(row, reviewByEdition) {
  const edition = row && row.edition || {};
  const issues = Array.isArray(edition.issues) ? edition.issues : [];
  const machinePass = issues.filter((issue) => issue && issue.editorialGate && issue.editorialGate.pass === true).length;
  const lineageReceipts = issues.map((issue) => {
    const measured = issue && issue.claimLineage && issue.claimLineage.claims &&
      issue.claimLineage.claims.whyHot && issue.claimLineage.claims.whyHot.measured;
    const auditable = Boolean(
      issue && issue.evidenceHash &&
      Array.isArray(issue.sourceEvidence) && issue.sourceEvidence.length &&
      measured && Object.prototype.hasOwnProperty.call(measured, "independentGroupCount")
    );
    return { auditable, receipt: auditable ? verifyEditorialLineage(issue) : null };
  });
  const lineageAuditable = lineageReceipts.filter((entry) => entry.auditable).length;
  const lineagePass = lineageReceipts.filter((entry) => entry.receipt && entry.receipt.pass).length;
  const evidenceModes = {};
  let sourceEvidenceCount = 0;
  for (const issue of issues) {
    const mode = issue && issue.evidence && issue.evidence.mode || "unknown";
    evidenceModes[mode] = Number(evidenceModes[mode] || 0) + 1;
    sourceEvidenceCount += Array.isArray(issue && issue.sourceEvidence) ? issue.sourceEvidence.length : 0;
  }
  const quality = edition.editorialQuality || {};
  const fulfillment = edition.categoryFulfillment || null;
  const review = reviewByEdition.get(edition.editionId) || null;
  return {
    date: row.date,
    slotId: row.slotId,
    segmentKey: row.segmentKey,
    editionId: edition.editionId || null,
    issueCount: issues.length,
    publishable: Boolean(edition.publishable),
    machinePass,
    machineHold: issues.length - machinePass,
    lineagePass,
    lineageHold: lineageAuditable - lineagePass,
    lineageUnavailable: issues.length - lineageAuditable,
    sourceEvidenceCount,
    evidenceModes,
    overseasSharePct: Number(edition.overseasShare || 0),
    fulfillmentGoalSatisfied: fulfillment ? Boolean(fulfillment.goalSatisfied) : false,
    selectedCategoryCount: fulfillment && Number(fulfillment.selectedCount || 0),
    metCategoryCount: fulfillment && Number(fulfillment.metCount || 0),
    candidateEvaluated: Number(quality.evaluatedClusters || 0),
    candidateMachinePass: Number(quality.machinePass || 0),
    candidateMachineHold: Number(quality.machineHold || 0),
    candidateQualified: Number(quality.qualifiedClusters || 0),
    nearDuplicateHolds: Number(quality.nearDuplicateHolds || 0),
    review: review ? {
      state: review.state,
      requiredRows: Number(review.requiredRows || 0),
      doubleReviewed: Number(review.doubleReviewed || 0),
      qualityPass: Boolean(review.qualityPass),
      adjudicationRequired: review.state === "human_adjudication_required"
    } : null
  };
}

export function buildEditorialQualityHistory(editionRows, {
  nowMs = Date.now(),
  windowDays = EDITORIAL_QUALITY_HISTORY_CONTRACT.defaultWindowDays,
  reviewSummaries = []
} = {}) {
  const today = kstDate(nowMs);
  const limit = Math.max(1, Math.min(90, Math.floor(Number(windowDays) || 30)));
  const windowStart = addDays(today, -(limit - 1));
  const reviewByEdition = new Map((reviewSummaries || [])
    .filter((row) => row && row.editionId)
    .map((row) => [row.editionId, row]));
  const editions = (Array.isArray(editionRows) ? editionRows : [])
    .filter((row) => row && row.date >= windowStart && row.date <= today && row.edition)
    .map((row) => summarizeSavedEdition(row, reviewByEdition));
  const grouped = new Map();

  for (const edition of editions) {
    const key = `${edition.date}|${edition.slotId}`;
    const row = grouped.get(key) || {
      date: edition.date,
      slotId: edition.slotId,
      slotLabel: (SLOTS.find((slot) => slot.id === edition.slotId) || {}).label || edition.slotId,
      editionCount: 0,
      publishableCount: 0,
      fulfillmentCount: 0,
      issueCount: 0,
      machinePass: 0,
      machineHold: 0,
      lineagePass: 0,
      lineageHold: 0,
      lineageUnavailable: 0,
      sourceEvidenceCount: 0,
      candidateEvaluated: 0,
      candidateMachinePass: 0,
      candidateMachineHold: 0,
      candidateQualified: 0,
      nearDuplicateHolds: 0,
      evidenceModes: {},
      overseasWeightedTotal: 0,
      overseasWeight: 0,
      reviewPacketCount: 0,
      humanRequiredRows: 0,
      humanDoubleReviewed: 0,
      humanQualityPassEditions: 0,
      humanAdjudicationRequiredEditions: 0
    };
    row.editionCount += 1;
    row.publishableCount += Number(edition.publishable);
    row.fulfillmentCount += Number(edition.fulfillmentGoalSatisfied);
    row.issueCount += edition.issueCount;
    row.machinePass += edition.machinePass;
    row.machineHold += edition.machineHold;
    row.lineagePass += edition.lineagePass;
    row.lineageHold += edition.lineageHold;
    row.lineageUnavailable += edition.lineageUnavailable;
    row.sourceEvidenceCount += edition.sourceEvidenceCount;
    row.candidateEvaluated += edition.candidateEvaluated;
    row.candidateMachinePass += edition.candidateMachinePass;
    row.candidateMachineHold += edition.candidateMachineHold;
    row.candidateQualified += edition.candidateQualified;
    row.nearDuplicateHolds += edition.nearDuplicateHolds;
    addCounts(row.evidenceModes, edition.evidenceModes);
    if (edition.issueCount) {
      row.overseasWeightedTotal += edition.overseasSharePct * edition.issueCount;
      row.overseasWeight += edition.issueCount;
    }
    if (edition.review) {
      row.reviewPacketCount += 1;
      row.humanRequiredRows += edition.review.requiredRows;
      row.humanDoubleReviewed += edition.review.doubleReviewed;
      row.humanQualityPassEditions += Number(edition.review.qualityPass);
      row.humanAdjudicationRequiredEditions += Number(edition.review.adjudicationRequired);
    }
    grouped.set(key, row);
  }

  const rows = [...grouped.values()].map((row) => {
    const overseasSharePct = row.overseasWeight
      ? Math.round(row.overseasWeightedTotal / row.overseasWeight)
      : 0;
    const { overseasWeightedTotal: _overseasWeightedTotal, overseasWeight: _overseasWeight, ...visibleRow } = row;
    let state = "quality_review_not_sampled";
    if (row.machineHold || row.lineageHold) state = "quality_machine_attention";
    else if (row.publishableCount < row.editionCount) state = "quality_publish_hold";
    else if (row.fulfillmentCount < row.editionCount) state = "quality_supply_hold";
    else if (row.lineageUnavailable) state = "quality_lineage_unavailable";
    else if (row.humanAdjudicationRequiredEditions) state = "quality_human_adjudication_required";
    else if (row.reviewPacketCount && row.humanDoubleReviewed < row.humanRequiredRows) state = "quality_human_pending";
    else if (row.reviewPacketCount && row.humanQualityPassEditions < row.reviewPacketCount) state = "quality_human_hold";
    else if (row.reviewPacketCount) state = "quality_human_pass";
    return {
      ...visibleRow,
      overseasSharePct,
      humanReviewCoveragePct: row.humanRequiredRows
        ? Math.round(row.humanDoubleReviewed / row.humanRequiredRows * 100)
        : null,
      state,
      evidenceModes: Object.fromEntries(Object.entries(row.evidenceModes).sort())
    };
  }).sort((a, b) =>
    a.date.localeCompare(b.date) ||
    Number(SLOT_INDEX.get(a.slotId) ?? 99) - Number(SLOT_INDEX.get(b.slotId) ?? 99)
  ).reverse();

  const totals = rows.reduce((acc, row) => {
    acc.editions += row.editionCount;
    acc.publishableEditions += row.publishableCount;
    acc.fulfilledEditions += row.fulfillmentCount;
    acc.issues += row.issueCount;
    acc.machineHolds += row.machineHold;
    acc.lineageHolds += row.lineageHold;
    acc.lineageUnavailable += row.lineageUnavailable;
    acc.sourceEvidence += row.sourceEvidenceCount;
    acc.reviewPackets += row.reviewPacketCount;
    acc.humanRequiredRows += row.humanRequiredRows;
    acc.humanDoubleReviewed += row.humanDoubleReviewed;
    acc.humanQualityPassEditions += row.humanQualityPassEditions;
    addCounts(acc.evidenceModes, row.evidenceModes);
    return acc;
  }, {
    editions: 0,
    publishableEditions: 0,
    fulfilledEditions: 0,
    issues: 0,
    machineHolds: 0,
    lineageHolds: 0,
    lineageUnavailable: 0,
    sourceEvidence: 0,
    reviewPackets: 0,
    humanRequiredRows: 0,
    humanDoubleReviewed: 0,
    humanQualityPassEditions: 0,
    evidenceModes: {}
  });
  totals.humanReviewCoveragePct = totals.humanRequiredRows
    ? Math.round(totals.humanDoubleReviewed / totals.humanRequiredRows * 100)
    : null;
  totals.evidenceModes = Object.fromEntries(Object.entries(totals.evidenceModes).sort());
  const attention = rows.some((row) => [
    "quality_machine_attention",
    "quality_publish_hold",
    "quality_supply_hold",
    "quality_human_adjudication_required",
    "quality_human_hold"
  ].includes(row.state));
  const state = attention
    ? "quality_history_attention_required"
    : rows.length && rows.every((row) => row.state === "quality_human_pass")
      ? "quality_history_human_pass"
      : "quality_history_collecting";

  return {
    stableId: EDITORIAL_QUALITY_HISTORY_CONTRACT.receiptId,
    contractId: EDITORIAL_QUALITY_HISTORY_CONTRACT.stableId,
    state,
    today,
    windowDays: limit,
    firstEditionDate: editions.length ? editions.map((edition) => edition.date).sort()[0] : null,
    rows,
    totals,
    fixedItemCount: false,
    samplingRule: EDITORIAL_QUALITY_HISTORY_CONTRACT.samplingRule,
    proves: "불변 저장 판의 최종 기계 게이트·주장 계보·근거 유형·분야 충족과 별도 사람 검수 진행 추세",
    doesNotProve: "원문 사실의 진실성·검수자 신원·사람 품질 PASS·운영 배포"
  };
}
