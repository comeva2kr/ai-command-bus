import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  D1B_ADJUDICATION_ASSIGNMENT,
  D1B_REVIEW_RESPONSE,
  buildBlindReviewPacket,
  reconcileBlindReviews,
  validateBlindReview
} from "../tools/selection-d1b-gold.mjs";

const corpusRaw = fs.readFileSync(new URL("./fixtures/selection-d1-corpus.json", import.meta.url), "utf8");
const corpus = JSON.parse(corpusRaw);
const gold = JSON.parse(fs.readFileSync(new URL("./fixtures/selection-d1-gold.json", import.meta.url), "utf8"));
const corpusSha256 = "test-corpus-sha";
const packetA = buildBlindReviewPacket(corpus, { assignmentId: "A", corpusSha256 });
const packetB = buildBlindReviewPacket(corpus, { assignmentId: "B", corpusSha256 });

function response(packet, identity, category = "news") {
  return {
    contract: D1B_REVIEW_RESPONSE,
    assignmentId: packet.assignmentId,
    corpusSha256: packet.corpusSha256,
    reviewerIdentity: identity,
    decisions: packet.items.map((item) => ({
      itemId: item.itemId,
      blindPacketHash: item.blindPacketHash,
      contentType: item.contentKindHint === "community" ? "community" : "news",
      acceptedCategories: [category],
      rejectedCategories: [],
      descriptiveSecondaryCategories: [],
      humanValid: true,
      inScope: true
    }))
  };
}

test("D1-B blind packet contains only 78 real items and hides source/category/gold priors", () => {
  assert.equal(packetA.count, 78);
  assert.deepEqual(packetA.items.map((row) => row.itemId), [...packetA.items.map((row) => row.itemId)].sort());
  for (const row of packetA.items) {
    for (const forbidden of ["sourceId", "sourceTier", "declaredCategory", "declaredSection", "contractGold", "provenance", "stratum"])
      assert.equal(forbidden in row, false, `${row.itemId} hides ${forbidden}`);
  }
  assert.deepEqual(packetA.items, packetB.items);
});

test("D1-B review validation is exact and fail-closed", () => {
  const valid = response(packetA, "blind-labeler-a");
  assert.equal(validateBlindReview(packetA, valid).decisions.length, 78);
  const missing = structuredClone(valid); missing.decisions.pop();
  assert.throws(() => validateBlindReview(packetA, missing), /every packet item/);
  const stale = structuredClone(valid); stale.decisions[0].blindPacketHash = "stale";
  assert.throws(() => validateBlindReview(packetA, stale), /blindPacketHash mismatch/);
  const extra = structuredClone(valid); extra.decisions[0].title = "must not be copied";
  assert.throws(() => validateBlindReview(packetA, extra), /keys must be exactly/);
  const unknown = structuredClone(valid); unknown.decisions[0].acceptedCategories = ["not-a-category"];
  assert.throws(() => validateBlindReview(packetA, unknown), /unknown or empty category/);
  const dependent = structuredClone(valid); dependent.reviewerIdentity = "prod-classifier-v0";
  assert.throws(() => validateBlindReview(packetA, dependent), /not independent/);
  const dependentCaseFold = structuredClone(valid); dependentCaseFold.reviewerIdentity = "PROD-CLASSIFIER-V0";
  assert.throws(() => validateBlindReview(packetA, dependentCaseFold), /not independent/);
  const topExtra = structuredClone(valid); topExtra.sourceAnswers = [];
  assert.throws(() => validateBlindReview(packetA, topExtra), /keys must be exactly/);
});

test("D1-B matching A/B labels produce sufficient independent gold without touching the fixture", () => {
  const before = JSON.stringify(gold);
  const result = reconcileBlindReviews({
    corpus, gold, packetA, reviewA: response(packetA, "blind-labeler-a"),
    packetB, reviewB: response(packetB, "blind-labeler-b")
  });
  assert.equal(result.counts.agreements, 78);
  assert.equal(result.counts.disagreements, 0);
  assert.equal(result.releaseState, "sufficient_independent_gold");
  assert.deepEqual(result.contractCheck.rejectedItemIds, []);
  assert.equal(result.outputGold.counts.agreed, 78);
  assert.equal(result.outputGold.normalization, "goldRejectedCategories = full taxonomy minus goldAcceptedCategories");
  assert.equal(result.outputGold.labels.find((row) => row.origin === "real_local_snapshot").goldRejectedCategories.length, 13);
  assert.equal(JSON.stringify(gold), before);
});

test("D1-B resolved out-of-scope negatives complete gold without entering model metrics", () => {
  const reviewA = response(packetA, "blind-labeler-a");
  const reviewB = response(packetB, "blind-labeler-b");
  for (const review of [reviewA, reviewB]) {
    review.decisions[0].contentType = "other";
    review.decisions[0].acceptedCategories = [];
    review.decisions[0].humanValid = false;
    review.decisions[0].inScope = false;
  }

  const result = reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB });
  const itemId = reviewA.decisions[0].itemId;
  assert.equal(result.releaseState, "sufficient_independent_gold");
  assert.equal(result.contractCheck.resolvedIndependentItemIds.includes(itemId), true);
  assert.equal(result.contractCheck.releaseEligibleItemIds.includes(itemId), false);
});

test("D1-B reviewer reject suggestions are non-authoritative and normalize to taxonomy complement", () => {
  const reviewA = response(packetA, "blind-labeler-a");
  const reviewB = response(packetB, "blind-labeler-b");
  reviewA.decisions[0].rejectedCategories = ["business", "politics"];
  reviewB.decisions[0].rejectedCategories = [];
  const result = reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB });
  assert.equal(result.counts.disagreements, 0);
  const row = result.outputGold.labels.find((label) => label.itemId === reviewA.decisions[0].itemId);
  assert.equal(row.goldAcceptedCategories.includes("news"), true);
  assert.equal(row.goldRejectedCategories.includes("news"), false);
  assert.equal(row.goldRejectedCategories.length, 13);
});

test("D1-B disagreement is isolated and only a third identity can adjudicate it", () => {
  const reviewA = response(packetA, "blind-labeler-a");
  const reviewB = response(packetB, "blind-labeler-b");
  reviewB.decisions[0].acceptedCategories = ["tech"];
  const held = reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB });
  assert.equal(held.counts.disagreements, 1);
  assert.equal(held.releaseState, "insufficient_independent_gold");
  assert.equal(held.adjudicationPacket.assignmentId, D1B_ADJUDICATION_ASSIGNMENT);
  assert.equal(held.adjudicationPacket.count, 1);

  const adjudication = response(held.adjudicationPacket, "blind-adjudicator", "business");
  const final = reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB, adjudication });
  assert.equal(final.counts.adjudicated, 1);
  assert.equal(final.outputGold.counts.adjudicated, 1);
  assert.equal(final.releaseState, "sufficient_independent_gold");
  assert.deepEqual(final.contractCheck.rejectedItemIds, []);

  const sameIdentity = response(held.adjudicationPacket, "blind-labeler-a", "business");
  assert.throws(() => reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB, adjudication: sameIdentity }), /identity must differ/);
  const sameCaseFold = response(held.adjudicationPacket, "BLIND-LABELER-A", "business");
  assert.throws(() => reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB, adjudication: sameCaseFold }), /identity must differ/);
});

test("D1-B rejects a blind packet changed after preparation", () => {
  const changed = structuredClone(packetB);
  changed.items[0].title = "tampered title";
  assert.throws(() => reconcileBlindReviews({
    corpus, gold, packetA, reviewA: response(packetA, "blind-labeler-a"),
    packetB: changed, reviewB: response(changed, "blind-labeler-b")
  }), /content diverges from frozen corpus/);
});
