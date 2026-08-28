import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITORIAL_FULFILLMENT_CONTRACT,
  attachEditorialFulfillment,
  buildEditorialFulfillment,
  editorialIssueBudget,
  editorialMinimumPerCategory
} from "../src/feed/editorial-fulfillment.js";

test("선택 분야 수가 늘면 판본 예산과 분야 최소 깊이가 함께 늘어난다", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 8, 9, 14].map((count) => editorialIssueBudget(count)),
    [14, 28, 42, 56, 70, 112, 126, 196]
  );
  assert.deepEqual(
    [1, 2, 4, 8, 9, 14].map((count) => editorialMinimumPerCategory(count)),
    [14, 14, 14, 14, 14, 14]
  );
  assert.equal(EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.maxPublished, 196);
  assert.equal(EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.perSelectedCategory, 14);
  assert.match(EDITORIAL_FULFILLMENT_CONTRACT.categoryUnionRule, /동일 사건만 한 번/);
});

test("선택 분야 충족도: 전체 판본 수가 아니라 분야별 공급과 이슈를 판정한다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["business", "news", "politics", "realestate"],
    issues: [
      { categoryIds: ["business"] },
      { categoryIds: ["business", "realestate"] },
      { categoryIds: ["news"] }
    ],
    candidateCounts: { business: 12, news: 4, politics: 0, realestate: 8 },
    minimumIssuesPerCategory: 2
  });

  assert.equal(receipt.contractId, EDITORIAL_FULFILLMENT_CONTRACT.stableId);
  assert.equal(receipt.state, "fulfillment_partial");
  assert.equal(receipt.selectedCount, 4);
  assert.equal(receipt.metCount, 1);
  assert.deepEqual(receipt.missingCategoryIds, ["politics"]);
  assert.deepEqual(receipt.underfilledCategoryIds, ["news", "realestate"]);
  assert.equal(receipt.rows.find((row) => row.categoryId === "business").issueCount, 2);
  assert.equal(receipt.rows.find((row) => row.categoryId === "business").eligibleIssueCount, 2);
  assert.equal(receipt.rows.find((row) => row.categoryId === "realestate").state, "underfilled");
});

test("선택 분야 충족도: 다중 분야 이슈 한 건은 실제 속한 모든 선택 분야를 충족한다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["business", "realestate"],
    issues: [{ categoryIds: ["business", "realestate"] }],
    candidateCounts: { business: 1, realestate: 1 },
    minimumIssuesPerCategory: 1
  });

  assert.equal(EDITORIAL_FULFILLMENT_CONTRACT.version, 8);
  assert.equal(receipt.state, "fulfillment_complete");
  assert.equal(receipt.goalSatisfied, true);
  assert.equal(receipt.metCount, 2);
  assert.equal(receipt.selectedEligibleIssueCount, 1);
  assert.equal(receipt.uniqueCreditedIssueCount, 1);
  assert.equal(receipt.multiCategoryIssueCount, 1);
  assert.equal(receipt.rows.reduce((sum, row) => sum + row.issueCount, 0), 2);
  assert.deepEqual(receipt.rows.map((row) => row.eligibleIssueCount), [1, 1]);
});

test("선택 분야 충족도: 공유 이슈도 각 분야의 독립 상위 목록 깊이에 반영한다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["business", "realestate"],
    issues: [
      { categoryIds: ["business", "realestate"] },
      { categoryIds: ["business", "realestate"] }
    ],
    candidateCounts: { business: 2, realestate: 2 },
    minimumIssuesPerCategory: 2
  });

  assert.equal(receipt.metCount, 2);
  assert.deepEqual(receipt.underfilledCategoryIds, []);
  assert.deepEqual(receipt.rows.map((row) => row.issueCount), [2, 2]);
  assert.deepEqual(receipt.rows.map((row) => row.crossCategoryAssignedAwayCount), [0, 0]);
});

test("선택 분야 충족도: 전용 이슈와 공유 이슈를 각 분야에 빠짐없이 반영한다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["business", "realestate"],
    issues: [
      { categoryIds: ["business", "realestate"] },
      { categoryIds: ["business"] }
    ],
    candidateCounts: { business: 2, realestate: 1 },
    minimumIssuesPerCategory: 1
  });

  assert.equal(receipt.goalSatisfied, true);
  assert.equal(receipt.uniqueCreditedIssueCount, 2);
  assert.deepEqual(receipt.rows.map((row) => row.issueCount), [2, 1]);
});

test("선택 분야 충족도: 후보가 많아도 실제 판본 이슈가 부족하면 통과시키지 않는다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["tech"],
    issues: [{ categoryIds: ["tech"] }],
    candidateCounts: { tech: 50 },
    minimumIssuesPerCategory: 3
  });

  assert.equal(receipt.state, "fulfillment_partial");
  assert.equal(receipt.goalSatisfied, false);
  assert.deepEqual(receipt.underfilledCategoryIds, ["tech"]);
});

test("선택 분야 충족도: 수집 후보가 많아도 기계 유효 클러스터가 없으면 별도로 드러낸다", () => {
  const receipt = buildEditorialFulfillment({
    selectedCategories: ["tech"],
    issues: [],
    candidateCounts: { tech: 46 },
    qualificationRows: [{
      categoryId: "tech",
      machinePassClusterCount: 0,
      qualifiedClusterCount: 0,
      draftSelectedCount: 0
    }],
    minimumIssuesPerCategory: 2
  });

  assert.equal(receipt.rows[0].state, "no_qualified_supply");
  assert.equal(receipt.rows[0].candidateCount, 46);
  assert.equal(receipt.rows[0].qualifiedClusterCount, 0);
  assert.deepEqual(receipt.noQualifiedCategoryIds, ["tech"]);
});

test("선택 분야 충족도: 판본 변경 뒤 남은 이슈로 다시 계산할 수 있다", () => {
  const edition = attachEditorialFulfillment({
    issues: [
      { categoryIds: ["business"] },
      { categoryIds: ["business"] },
      { categoryIds: ["news"] },
      { categoryIds: ["news"] }
    ],
    selection: {
      categories: [{ id: "business" }, { id: "news" }],
      minIssuesPerCategory: 2
    },
    candidateContract: {
      metrics: { categoryCandidateCounts: { business: 10, news: 8 } }
    }
  });

  assert.equal(edition.categoryFulfillment.state, "fulfillment_complete");
  assert.equal(edition.categoryFulfillment.metCount, 2);
});
