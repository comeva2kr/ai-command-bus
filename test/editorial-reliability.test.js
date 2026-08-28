import test from "node:test";
import assert from "node:assert/strict";

import { SLOTS } from "../src/feed/digest.js";
import { buildEditorialSlotObservation } from "../src/feed/editorial-elapsed-evidence.js";
import {
  EDITORIAL_RELIABILITY_HISTORY_CONTRACT,
  buildEditorialReliabilityHistory
} from "../src/feed/editorial-reliability.js";

const atKst = (value) => Date.parse(`${value}+09:00`);
const segment = {
  key: "v13:business.news",
  categories: ["business", "news"],
  isDefault: true,
  audienceCount: 2
};

function observation(date, slotId, {
  delayMinutes = 3,
  publishable = true,
  goalSatisfied = true,
  fingerprintSeed = slotId,
  clockSource = "system"
} = {}) {
  const slot = SLOTS.find((row) => row.id === slotId);
  const asOfMs = atKst(`${date}T${String(slot.publishHour).padStart(2, "0")}:00:00`);
  const row = buildEditorialSlotObservation({
    date,
    slot,
    asOfMs,
    observedAtMs: asOfMs + delayMinutes * 60 * 1000,
    clockSource,
    timingBasis: "inventory_completed",
    inventoryCompletedAt: new Date(asOfMs + delayMinutes * 60 * 1000).toISOString(),
    segments: [segment],
    editions: [{
      segmentKey: segment.key,
      edition: {
        publishable,
        editionSegment: { generationMode: "inventory_backfill" },
        categoryFulfillment: {
          state: goalSatisfied ? "fulfillment_complete" : "fulfillment_partial",
          goalSatisfied,
          metCount: goalSatisfied ? 2 : 1,
          selectedCount: 2,
          underfilledCategoryIds: goalSatisfied ? [] : ["business"],
          noQualifiedCategoryIds: [],
          missingCategoryIds: []
        },
        issues: [{
          eventKey: `event-${date}-${fingerprintSeed}`,
          headline: `headline-${date}-${fingerprintSeed}`,
          refs: [{ id: `ref-${date}-${fingerprintSeed}` }]
        }]
      }
    }]
  });
  return { ...row, savedAt: asOfMs + delayMinutes * 60 * 1000 };
}

test("신뢰도 원장: 오늘은 현재까지 도래한 슬롯만 평가한다", () => {
  const nowMs = atKst("2026-08-11T14:30:00");
  const receipt = buildEditorialReliabilityHistory([
    observation("2026-08-10", "morning", { clockSource: "injected" }),
    observation("2026-08-10", "lunch", { delayMinutes: 60 }),
    observation("2026-08-11", "morning", { delayMinutes: 60 }),
    observation("2026-08-11", "lunch")
  ], { nowMs });
  assert.equal(receipt.contractId, EDITORIAL_RELIABILITY_HISTORY_CONTRACT.stableId);
  assert.equal(receipt.rows[0].state, "healthy_so_far");
  assert.deepEqual(receipt.rows[0].expectedSlotIds, ["lunch"]);
  assert.equal(receipt.rows[0].missingDueCount, 0);
  assert.equal(receipt.totals.onTimeRatePct, 100);
  assert.equal(receipt.firstObservedDate, "2026-08-11");
  assert.equal(receipt.rows.length, 1);
  assert.equal(receipt.excludedNonSystemObservationCount, 1);
  assert.equal(receipt.excludedPreMonitoringObservationCount, 2);
  assert.equal(receipt.monitoringStart.slotId, "lunch");
});

test("신뢰도 원장: 관측 시작 뒤 통째로 빈 과거 날짜를 누락으로 남긴다", () => {
  const receipt = buildEditorialReliabilityHistory([
    observation("2026-08-09", "morning"),
    observation("2026-08-11", "morning")
  ], { nowMs: atKst("2026-08-11T10:30:00") });
  const missing = receipt.rows.find((row) => row.date === "2026-08-10");
  assert.equal(missing.state, "attention_missing_slot");
  assert.equal(missing.expectedSlotCount, 3);
  assert.equal(missing.missingDueCount, 3);
  assert.equal(receipt.state, "reliability_attention_required");
});

test("신뢰도 원장: 정시·완결·서로 다른 세 판과 분야 충족을 하루 완료로 집계한다", () => {
  const date = "2026-08-10";
  const receipt = buildEditorialReliabilityHistory(SLOTS.map((slot) =>
    observation(date, slot.id, { fingerprintSeed: slot.id })
  ), { nowMs: atKst("2026-08-11T06:00:00") });
  const row = receipt.rows.find((entry) => entry.date === date);
  assert.equal(row.state, "daily_evidence_complete");
  assert.equal(row.actualElapsedTimeProof, true);
  assert.equal(row.distinctContentCount, 3);
  assert.equal(receipt.totals.completeDays, 1);
});

test("신뢰도 원장: 늦은 저장과 분야 미충족을 각각 숨기지 않는다", () => {
  const date = "2026-08-10";
  const rows = [
    observation(date, "morning"),
    observation(date, "lunch", { delayMinutes: 12 }),
    observation(date, "evening", { goalSatisfied: false })
  ];
  const receipt = buildEditorialReliabilityHistory(rows, {
    nowMs: atKst("2026-08-11T06:00:00")
  });
  const row = receipt.rows.find((entry) => entry.date === date);
  assert.equal(row.state, "attention_late_capture");
  assert.equal(row.lateCount, 1);
  assert.deepEqual(row.heldCategoryIds, ["business"]);
  assert.equal(receipt.totals.categoryHoldDays, 1);
});
