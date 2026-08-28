import { CATEGORIES, categoryLabel } from "./taxonomy.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_FULFILLMENT_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-FULFILLMENT-CONTRACT-001",
  version: 8,
  unit: "selected_category",
  targetRule: "판본의 동적 카테고리 최소 이슈 수",
  noFixedItemCount: true,
  uniqueIssueRule: {
    maxSelectedCategoryCreditsPerIssue: CATEGORIES.length,
    quotaAllocation: "all_genuinely_admitted_selected_categories",
    displayAllocation: "same_event_once"
  },
  issueBudget: {
    perSelectedCategory: 14,
    oneCategory: 14,
    twoCategories: 28,
    rule: "selected_count * 14",
    maxPublished: 196,
    maxGeneratedWithChangeReserve: 308
  },
  categoryUnionRule: "선택 분야마다 중요도 상위 14건을 선별한 뒤 동일 사건만 한 번 남기고 분야별 중요도 순위 층을 합쳐 같은 층에서는 전체 중요도 순으로 병합",
  minimumRule: "각 선택 분야의 독립 상위 14건을 확보하고 같은 사건만 합집합에서 한 번 표시",
  funnelRule: "수집 아이템, 문장 게이트 통과 클러스터, 근접중복 제거 뒤 기계 유효 클러스터, 변화 검사 전 초안, 최종 판본을 분리 기록",
  states: ["fulfillment_complete", "fulfillment_partial", "fulfillment_insufficient", "no_supply", "no_qualified_supply", "underfilled", "met"]
});

const finiteCount = (value) => Math.max(0, Math.floor(Number(value) || 0));
const issueCategories = (issue) => {
  const selected = [...new Set(issue && issue.selectedByCategories || [])];
  return selected.length ? selected : [...new Set(issue && issue.categoryIds || [])];
};

function countEligibleIssues(selected, issues) {
  const selectedSet = new Set(selected);
  const eligibleIssues = (issues || []).map((issue, index) => ({
    index,
    categoryIds: issueCategories(issue)
      .filter((categoryId) => selectedSet.has(categoryId))
      .sort()
  })).filter((issue) => issue.categoryIds.length > 0);
  const eligibleCounts = new Map(selected.map((categoryId) => [categoryId, 0]));
  for (const issue of eligibleIssues) {
    for (const categoryId of issue.categoryIds) {
      eligibleCounts.set(categoryId, eligibleCounts.get(categoryId) + 1);
    }
  }

  return {
    eligibleCounts,
    eligibleIssueCount: eligibleIssues.length,
    multiCategoryIssueCount: eligibleIssues.filter((issue) => issue.categoryIds.length > 1).length
  };
}

export function editorialIssueBudget(selectedCount) {
  const count = Math.max(1, finiteCount(selectedCount));
  const budget = count * EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.perSelectedCategory;
  return Math.min(EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.maxPublished, budget);
}

export function editorialMinimumPerCategory(selectedCount, issueBudget = null) {
  const count = Math.max(1, finiteCount(selectedCount));
  const budget = Math.max(1, finiteCount(issueBudget) || editorialIssueBudget(count));
  return Math.max(1, Math.min(
    EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.perSelectedCategory,
    Math.floor(budget / count)
  ));
}

export function buildEditorialFulfillment({
  selectedCategories = [],
  issues = [],
  candidateCounts = {},
  qualificationRows = [],
  availableCategories = [],
  minimumIssuesPerCategory = 1
} = {}) {
  const selected = [...new Set((selectedCategories || []).filter(Boolean))];
  const target = Math.max(1, finiteCount(minimumIssuesPerCategory));
  const allocation = countEligibleIssues(selected, issues);
  const available = new Map((availableCategories || []).map((row) => [row.id, finiteCount(row.supply)]));
  const qualification = new Map((qualificationRows || [])
    .filter((row) => row && row.categoryId)
    .map((row) => [row.categoryId, row]));
  const rows = selected.map((categoryId) => {
    const candidateCount = finiteCount(candidateCounts[categoryId] ?? available.get(categoryId));
    const funnel = qualification.get(categoryId) || null;
    const machinePassClusterCount = funnel ? finiteCount(funnel.machinePassClusterCount) : null;
    const qualifiedClusterCount = funnel ? finiteCount(funnel.qualifiedClusterCount) : null;
    const draftSelectedCount = funnel ? finiteCount(funnel.draftSelectedCount) : null;
    const eligibleIssueCount = finiteCount(allocation.eligibleCounts.get(categoryId));
    const issueCount = eligibleIssueCount;
    const state = candidateCount === 0
      ? "no_supply"
      : qualifiedClusterCount === 0
        ? "no_qualified_supply"
      : issueCount >= target
        ? "met"
        : "underfilled";
    return {
      categoryId,
      label: categoryLabel(categoryId),
      candidateCount,
      machinePassClusterCount,
      qualifiedClusterCount,
      draftSelectedCount,
      eligibleIssueCount,
      issueCount,
      postDraftHoldCount: draftSelectedCount == null
        ? null
        : Math.max(0, draftSelectedCount - eligibleIssueCount),
      crossCategoryAssignedAwayCount: 0,
      target,
      state
    };
  });
  const metCount = rows.filter((row) => row.state === "met").length;
  const issuedCount = rows.filter((row) => row.issueCount > 0).length;
  const missingCategoryIds = rows.filter((row) => row.state === "no_supply").map((row) => row.categoryId);
  const noQualifiedCategoryIds = rows.filter((row) => row.state === "no_qualified_supply").map((row) => row.categoryId);
  const underfilledCategoryIds = rows.filter((row) => row.state === "underfilled").map((row) => row.categoryId);
  const state = rows.length > 0 && metCount === rows.length
    ? "fulfillment_complete"
    : issuedCount > 0
      ? "fulfillment_partial"
      : "fulfillment_insufficient";

  return {
    contractId: EDITORIAL_FULFILLMENT_CONTRACT.stableId,
    state,
    selectedCount: rows.length,
    metCount,
    issuedCount,
    selectedEligibleIssueCount: allocation.eligibleIssueCount,
    uniqueCreditedIssueCount: allocation.eligibleIssueCount,
    multiCategoryIssueCount: allocation.multiCategoryIssueCount,
    targetPerCategory: target,
    goalSatisfied: state === "fulfillment_complete",
    missingCategoryIds,
    noQualifiedCategoryIds,
    underfilledCategoryIds,
    rows,
    proves: "각 선택 분야의 독립 상위 목록 깊이와 같은 사건 한 번 표시 원칙, 수집 후보에서 최종 판본까지의 손실 지점",
    doesNotProve: "기계 유효 클러스터의 의미 품질·분야 적합성·사실성·사람 품질 PASS·운영 배포"
  };
}

export function attachEditorialFulfillment(edition) {
  if (!edition) return edition;
  const selection = edition.selection || {};
  const selectedCategories = (selection.categories || []).map((row) => row && row.id).filter(Boolean);
  const candidateCounts = edition.candidateContract && edition.candidateContract.metrics
    ? edition.candidateContract.metrics.categoryCandidateCounts || {}
    : {};
  const qualificationRows = edition.editorialQuality && Array.isArray(edition.editorialQuality.categoryFunnel)
    ? edition.editorialQuality.categoryFunnel
    : [];
  return {
    ...edition,
    categoryFulfillment: buildEditorialFulfillment({
      selectedCategories,
      issues: edition.issues || [],
      candidateCounts,
      qualificationRows,
      availableCategories: edition.availableCategories || [],
      minimumIssuesPerCategory: selection.minIssuesPerCategory || 1
    })
  };
}
