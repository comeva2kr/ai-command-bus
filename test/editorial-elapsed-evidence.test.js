import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SLOTS } from "../src/feed/digest.js";
import {
  buildEditorialSlotObservation,
  classifyEditorialCapture,
  summarizeElapsedEditionEvidence
} from "../src/feed/editorial-elapsed-evidence.js";
import { FeedStore } from "../src/feed/store.js";

const atKst = (value) => Date.parse(`${value}+09:00`);
const segment = {
  key: "v3:business.news",
  categories: ["business", "news"],
  isDefault: true,
  audienceCount: 3
};

function observation(slotId, { delayMinutes = 4, publishable = true, clockSource = "system", headline = slotId } = {}) {
  const slot = SLOTS.find((row) => row.id === slotId);
  const asOfMs = atKst(`2026-08-11T${String(slot.publishHour).padStart(2, "0")}:00:00`);
  return buildEditorialSlotObservation({
    date: "2026-08-11",
    slot,
    asOfMs,
    observedAtMs: asOfMs + delayMinutes * 60 * 1000,
    clockSource,
    segments: [segment],
    editions: [{
      segmentKey: segment.key,
      edition: {
        publishable,
        editionSegment: { generationMode: "inventory_backfill" },
        categoryFulfillment: {
          state: "fulfillment_complete",
          goalSatisfied: true,
          metCount: 2,
          selectedCount: 2,
          underfilledCategoryIds: [],
          noQualifiedCategoryIds: [],
          missingCategoryIds: []
        },
        issues: [{ eventKey: `event-${slotId}`, headline, refs: [{ id: `ref-${slotId}` }] }]
      }
    }]
  });
}

test("실행 영수증: 시스템 시계 10분 안만 정시이고 주입 시계는 증거가 아니다", () => {
  const asOfMs = atKst("2026-08-11T07:00:00");
  assert.equal(classifyEditorialCapture({ asOfMs, observedAtMs: asOfMs + 9 * 60 * 1000 }).mode, "scheduled_window");
  assert.equal(classifyEditorialCapture({ asOfMs, observedAtMs: asOfMs + 11 * 60 * 1000 }).mode, "late_backfill");
  assert.equal(classifyEditorialCapture({ asOfMs, observedAtMs: asOfMs + 2 * 60 * 1000, clockSource: "injected" }).mode, "injected_clock");

  const startedInWindow = observation("lunch", { delayMinutes: 2 });
  const persistedLate = summarizeElapsedEditionEvidence([{
    ...startedInWindow,
    savedAt: atKst("2026-08-11T12:11:00")
  }], { date: "2026-08-11" });
  assert.equal(persistedLate.slots[1].recordedCaptureMode, "scheduled_window");
  assert.equal(persistedLate.slots[1].captureMode, "late_backfill",
    "시작이 빨라도 저장 완료가 정시창을 넘으면 정시 증거가 아니다");
  assert.equal(persistedLate.slots[1].timingBasis, "persisted_after_inventory");
});

test("실행 영수증: 세 판이 정시·완결·서로 다른 내용일 때만 실제 시간차 증거다", () => {
  const report = summarizeElapsedEditionEvidence([
    observation("morning", { headline: "morning-news" }),
    observation("lunch", { headline: "lunch-news" }),
    observation("evening", { headline: "evening-news" })
  ], { date: "2026-08-11" });
  assert.equal(report.state, "actual_elapsed_evidence_complete");
  assert.equal(report.actualElapsedTimeProof, true);
  assert.equal(report.onTimeCount, 3);
  assert.equal(report.distinctContentCount, 3);
  assert.equal(report.chronological, true);
  assert.equal(report.defaultSegmentKey, segment.key);
  assert.equal(report.defaultSegmentActualElapsedTimeProof, true);
  assert.equal(report.segmentProofCount, 1);
  assert.equal(report.segmentCoverageComplete, true);
  assert.equal(report.segmentProofs[0].fulfillmentCount, 3);
});

test("실행 영수증: 기본 조합의 세 판 증명과 다른 조합의 분야 미충족을 분리한다", () => {
  const underfilled = {
    key: "v3:gaming",
    categories: ["gaming"],
    isDefault: false,
    audienceCount: 1
  };
  const observations = SLOTS.map((slot, index) => {
    const asOfMs = atKst(`2026-08-11T${String(slot.publishHour).padStart(2, "0")}:00:00`);
    const makeEdition = (target, goalSatisfied) => ({
      publishable: true,
      editionSegment: { generationMode: "inventory_backfill" },
      categoryFulfillment: {
        state: goalSatisfied ? "fulfillment_complete" : "fulfillment_partial",
        goalSatisfied,
        metCount: goalSatisfied ? target.categories.length : 0,
        selectedCount: target.categories.length,
        underfilledCategoryIds: goalSatisfied ? [] : target.categories,
        noQualifiedCategoryIds: [],
        missingCategoryIds: []
      },
      issues: [{
        eventKey: `${target.key}-${slot.id}`,
        headline: `${target.key}-${slot.id}-${index}`,
        refs: [{ id: `${target.key}-ref-${slot.id}` }]
      }]
    });
    return buildEditorialSlotObservation({
      date: "2026-08-11",
      slot,
      asOfMs,
      observedAtMs: asOfMs + 4 * 60 * 1000,
      segments: [segment, underfilled],
      editions: [
        { segmentKey: segment.key, edition: makeEdition(segment, true) },
        { segmentKey: underfilled.key, edition: makeEdition(underfilled, false) }
      ]
    });
  });

  const report = summarizeElapsedEditionEvidence(observations, { date: "2026-08-11" });
  assert.equal(report.actualElapsedTimeProof, true);
  assert.equal(report.state, "actual_elapsed_evidence_complete_with_segment_holds");
  assert.equal(report.segmentProofCount, 1);
  assert.equal(report.segmentHoldCount, 1);
  assert.equal(report.segmentCoverageComplete, false);
  assert.equal(report.segmentProofs.find((row) => row.segmentKey === underfilled.key).fulfillmentCount, 0);
});

test("실행 영수증: 늦은 백필이나 보류 판을 실제 하루 증거로 승격하지 않는다", () => {
  const report = summarizeElapsedEditionEvidence([
    observation("morning", { delayMinutes: 90 }),
    observation("lunch", { publishable: false }),
    observation("evening")
  ], { date: "2026-08-11" });
  assert.equal(report.state, "elapsed_evidence_complete_with_limits");
  assert.equal(report.actualElapsedTimeProof, false);
  assert.equal(report.onTimeCount, 2);
  assert.equal(report.readyCount, 2);
});

test("실행 영수증: 최초 날짜·슬롯 관측은 재시작 뒤에도 덮어쓰지 않는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-elapsed-evidence-"));
  const file = path.join(dir, "feed.json");
  const store = new FeedStore({ file, clock: () => "2026-08-11T01:00:00.000Z" });
  const late = observation("morning", { delayMinutes: 90 });
  const onTime = observation("morning", { delayMinutes: 2 });
  store.saveEditorialSlotObservation(late);
  const retained = store.saveEditorialSlotObservation(onTime);
  assert.equal(retained.captureMode, "late_backfill");

  const restarted = new FeedStore({ file, clock: () => "2026-08-11T02:00:00.000Z" });
  assert.equal(restarted.editorialSlotObservationsForDate("2026-08-11").length, 1);
  assert.equal(restarted.editorialSlotObservationsForDate("2026-08-11")[0].captureMode, "late_backfill");
  assert.equal(restarted.editorialSlotObservationsForDate("2026-08-11")[0].segmentRows[0].segmentKey, segment.key);
  fs.rmSync(dir, { recursive: true, force: true });
});
