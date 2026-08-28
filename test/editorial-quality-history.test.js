import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITORIAL_QUALITY_HISTORY_CONTRACT,
  buildEditorialQualityHistory
} from "../src/feed/editorial-reliability.js";
import {
  attachEditorialLineage,
  buildSourceEvidence
} from "../src/feed/editorial-lineage.js";

const atKst = (value) => Date.parse(`${value}+09:00`);

function qualityIssue(id, mode = "single_feed_observed") {
  const sourceEvidence = buildSourceEvidence([{
    id: `item-${id}`,
    title: `기준금리와 시장 변화 ${id}`,
    source: `source-${id}`,
    sourceLabel: `출처 ${id}`,
    url: `https://example.com/${id}`,
    editorialCandidate: {
      sourceId: `source-${id}`,
      sourceLabel: `출처 ${id}`,
      sourceRole: "reported_secondary",
      ownershipGroup: `publisher:${id}`,
      ownershipBasis: "publisher_label_operational",
      canonicalUrl: `https://example.com/${id}`
    }
  }]);
  return attachEditorialLineage({
    subject: `기준금리 시장 변화 ${id}`,
    categoryIds: ["business"],
    headline: `기준금리 시장 변화 ${id} 관련 보도`,
    paragraph: `기준금리 시장 변화 ${id}를 다룬 보도가 현재 수집 목록에서 확인됐다.`,
    whatHappened: `기준금리 시장 변화 ${id}를 다룬 보도가 확인됐다.`,
    whyImportant: "시장 판단에 연결되는 흐름이라 확인할 가치가 있다.",
    whyHot: "현재 수집 신호에서 반응이 확인됐다.",
    whyForYou: "경제·비즈니스를 선택한 오늘판이라 포함했다.",
    watchNext: "공식 자료와 후속 보도가 추가되는지 확인한다.",
    impactLens: "시장·실적",
    metrics: {
      score: 2,
      comments: 1,
      coverage: mode === "related_coverage_signal" ? 4 : 0,
      sourceCount: 1,
      evidenceMode: mode
    },
    evidence: {
      mode,
      observedFeedCount: 1,
      independentGroupCount: 1,
      relatedCoverageSignal: mode === "related_coverage_signal"
    },
    sourceEvidence,
    editorialGate: { state: "machine_gate_pass", pass: true, failures: [] }
  }, { selectedCategories: ["business"] });
}

function editionRow(slotId, {
  goalSatisfied = true,
  issue = qualityIssue(slotId),
  overseasShare = 25
} = {}) {
  const editionId = `2026-08-11-${slotId}-business`;
  return {
    date: "2026-08-11",
    slotId,
    segmentKey: "v13:business",
    edition: {
      editionId,
      generatedAt: `2026-08-11T${slotId === "morning" ? "00" : "03"}:00:00.000Z`,
      publishable: true,
      overseasShare,
      categoryFulfillment: {
        goalSatisfied,
        selectedCount: 1,
        metCount: goalSatisfied ? 1 : 0
      },
      editorialQuality: {
        evaluatedClusters: 4,
        machinePass: 3,
        machineHold: 1,
        qualifiedClusters: 2,
        nearDuplicateHolds: 1
      },
      issues: [issue]
    }
  };
}

test("판본 품질 원장: 저장 판의 기계·계보·근거 유형과 사람 검수 진행률을 슬롯별로 누적한다", () => {
  const morning = editionRow("morning", { issue: qualityIssue("morning", "related_coverage_signal") });
  const lunch = editionRow("lunch", { goalSatisfied: false, overseasShare: 50 });
  const receipt = buildEditorialQualityHistory([morning, lunch], {
    nowMs: atKst("2026-08-11T14:30:00"),
    reviewSummaries: [{
      editionId: morning.edition.editionId,
      state: "human_annotation_in_progress",
      requiredRows: 1,
      doubleReviewed: 0,
      qualityPass: false
    }]
  });

  assert.equal(receipt.contractId, EDITORIAL_QUALITY_HISTORY_CONTRACT.stableId);
  assert.equal(receipt.fixedItemCount, false);
  assert.equal(receipt.rows.length, 2);
  const morningRow = receipt.rows.find((row) => row.slotId === "morning");
  const lunchRow = receipt.rows.find((row) => row.slotId === "lunch");
  assert.equal(morningRow.state, "quality_human_pending");
  assert.equal(morningRow.machineHold, 0);
  assert.equal(morningRow.lineageHold, 0);
  assert.equal(morningRow.evidenceModes.related_coverage_signal, 1);
  assert.equal(morningRow.humanReviewCoveragePct, 0);
  assert.equal(lunchRow.state, "quality_supply_hold");
  assert.equal(lunchRow.overseasSharePct, 50);
  assert.equal(receipt.totals.editions, 2);
  assert.equal(receipt.totals.issues, 2);
  assert.equal(receipt.totals.sourceEvidence, 2);
  assert.equal(receipt.totals.reviewPackets, 1);
});

test("판본 품질 원장: 저장 뒤 근거 계보가 변조된 판은 사람 검수 대기와 별개로 기계 주의다", () => {
  const tampered = qualityIssue("tampered");
  tampered.evidenceHash = "tampered";
  const receipt = buildEditorialQualityHistory([
    editionRow("evening", { issue: tampered })
  ], { nowMs: atKst("2026-08-11T20:00:00") });

  assert.equal(receipt.rows[0].state, "quality_machine_attention");
  assert.equal(receipt.rows[0].lineageHold, 1);
  assert.equal(receipt.state, "quality_history_attention_required");
});

test("판본 품질 원장: 계보 계약 전 구형 판은 해시 불일치와 분리한다", () => {
  const legacy = qualityIssue("legacy");
  delete legacy.claimLineage.claims.whyHot.measured.independentGroupCount;
  legacy.evidenceHash = "legacy-fingerprint";
  const receipt = buildEditorialQualityHistory([
    editionRow("morning", { issue: legacy })
  ], { nowMs: atKst("2026-08-11T08:00:00") });

  assert.equal(receipt.rows[0].lineagePass, 0);
  assert.equal(receipt.rows[0].lineageHold, 0);
  assert.equal(receipt.rows[0].lineageUnavailable, 1);
  assert.equal(receipt.rows[0].state, "quality_lineage_unavailable");
  assert.equal(receipt.totals.lineageUnavailable, 1);
  assert.equal(receipt.state, "quality_history_collecting");
});
