import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITORIAL_REVIEW_DESK_CONTRACT,
  EDITORIAL_REVIEW_FIELD_SCHEMA,
  buildEditorialReviewDesk
} from "../src/feed/editorial-review-desk.js";

const packet = {
  packetId: "packet-1",
  editionId: "edition-1",
  sourceDate: "2026-08-11",
  sourceSlotId: "morning",
  frozenAt: "2026-08-11T07:02:00+09:00",
  rows: [{
    blindId: "BR-1",
    categoryIds: ["business"],
    subject: "호르무즈 협상 난항에 국제유가 급등",
    headline: "호르무즈 협상 난항에 국제유가 급등 · 관련 보도 묶음 포착",
    paragraph: "관련 보도 묶음 신호를 수집 풀에서 확인했다.",
    whyImportant: "내부 편집 문장",
    whyHot: "관련 보도 묶음 신호가 확인됐다.",
    changedSincePrevious: "지난 브리핑에서 다룬 사안의 후속 보도다.",
    whyForYou: "사용자가 경제를 골랐기 때문",
    evidenceHash: "hash-1",
    evidence: {
      mode: "related_coverage_signal",
      observedFeedCount: 1,
      independentGroupCount: 1
    },
    sourceEvidence: [{
      evidenceId: "source-1",
      title: "호르무즈 협상 난항에 국제유가 급등",
      sourceLabel: "남도일보",
      sourceRole: "reported_secondary",
      evidenceRole: "lead",
      canonicalUrl: "https://example.com/hormuz"
    }],
    refs: [{ title: "호르무즈 협상 난항에 국제유가 급등", sourceLabel: "남도일보" }],
    machineGate: { pass: true, state: "machine_gate_pass" },
    human: { include: null }
  }]
};

test("편집 데스크: 독자용 문장과 현재 검수자 답만 제공한다", () => {
  const view = buildEditorialReviewDesk({
    packet,
    reviewerId: "reviewer-a",
    review: {
      savedAt: "2026-08-11T15:00:00+09:00",
      annotations: [{
        blindId: "BR-1",
        include: true,
        clusterCorrect: true,
        headlineFaithful: false,
        evidenceSufficient: true,
        categoryFit: true,
        notes: "문장이 부자연스럽다"
      }]
    },
    humanReview: {
      state: "human_annotation_in_progress",
      comparisonReady: false,
      disagreements: []
    }
  });

  assert.equal(view.stableId, EDITORIAL_REVIEW_DESK_CONTRACT.stableId);
  assert.deepEqual(view.reviewFields.map((field) => field.id), EDITORIAL_REVIEW_FIELD_SCHEMA.map((field) => field.id));
  assert.equal(view.packet.issueCount, 1);
  assert.equal(view.progress.completed, 1);
  assert.equal(view.progress.held, 1);
  assert.equal(view.rows[0].reader.headline, "호르무즈 협상 난항에 국제유가 급등");
  assert.match(view.rows[0].reader.summary, /남도일보가/);
  assert.equal(view.rows[0].reader.change, "지난 브리핑에서 다룬 사안의 후속 보도다.");
  assert.equal(view.rows[0].canonical.headline, packet.rows[0].headline);
  assert.equal(view.rows[0].annotation.notes, "문장이 부자연스럽다");
  assert.equal(view.rows[0].complete, true);

  const serialized = JSON.stringify(view.rows);
  assert.doesNotMatch(serialized, /machineGate|machine_gate_pass/);
  assert.doesNotMatch(serialized, /whyForYou|사용자가 경제를 골랐기 때문/);
  assert.doesNotMatch(serialized, /otherReviewerAnnotations/);
});

test("편집 데스크: 미판정은 완성 행이나 보류 행으로 계산하지 않는다", () => {
  const view = buildEditorialReviewDesk({ packet, reviewerId: "reviewer-b" });
  assert.equal(view.rows[0].complete, false);
  assert.equal(view.rows[0].held, false);
  assert.equal(view.progress.completed, 0);
  assert.equal(view.progress.remaining, 1);
  assert.equal(view.progress.held, 0);
  assert.equal(view.rows[0].annotation.include, null);
});
