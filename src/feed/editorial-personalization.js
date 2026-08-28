export const EDITORIAL_PERSONALIZATION_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-PERSONALIZATION-CONTRACT-001",
  sharingUnit: "slot_and_sorted_selected_categories",
  projectionUnit: "request_user_response_only",
  canonicalRule: "공유 저장 판본은 사용자 토픽·취향과 무관하게 한 번 생성한다.",
  selectionRule: "명시적으로 선택한 카테고리와 교집합이 없는 이슈를 추가하거나 삭제하지 않는다.",
  rankingRule: "기존 편집 중요도 묶음 안에서만 학습된 카테고리 선호로 순서를 조정한다.",
  mutationRule: "응답 순서만 바꾸며 문장·근거·계보·판본 ID는 바꾸지 않는다.",
  costRule: "사용자별 LLM 호출과 판본 복제를 하지 않는다."
});

export const EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-PERSONALIZATION-UTILITY-CONTRACT-001",
  version: 1,
  comparisonRule: "동일한 공유 판본의 기본 순서와 개인화 후보 순서를 짝지어 비교한다.",
  topWindowRule: "첫 화면 효용은 최대 상위 10건에서 측정한다.",
  gainRule: "학습된 선택 분야 친화도의 할인 누적값이 기본 순서보다 커야 한다.",
  sourceRule: "상단의 확인 가능한 출처 수와 최대 출처 점유율을 악화시키지 않는다.",
  categoryRule: "상단에 최소 3개 선택 분야를 남기고 한 분야 점유와 연속 노출을 과도하게 늘리지 않는다.",
  fallbackRule: "효용 개선이나 다양성 근거가 부족하면 공유 중요도 순서를 그대로 제공한다.",
  costRule: "저장된 판본과 사용자 벡터만 계산하며 외부 호출은 0회다."
});

function selectedCategoryIds(edition) {
  return (edition && edition.selection && edition.selection.categories || [])
    .map((row) => typeof row === "string" ? row : row && row.id)
    .filter(Boolean);
}

function hasTasteSignal(user) {
  return Boolean(user && (
    user.surveyed || Number(user.feedbackCount || 0) > 0 || user.warmStarted
  ));
}

function normalizedCategoryAffinity(user, selected) {
  const weights = user && user.preferences && user.preferences.categories || {};
  const rows = selected.map((categoryId) => ({
    categoryId,
    weight: Number.isFinite(Number(weights[categoryId])) ? Number(weights[categoryId]) : 0
  }));
  const values = rows.map((row) => row.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max > min)) return new Map(rows.map((row) => [row.categoryId, 0]));
  const midpoint = (max + min) / 2;
  const radius = (max - min) / 2;
  return new Map(rows.map((row) => [
    row.categoryId,
    Math.max(-1, Math.min(1, (row.weight - midpoint) / radius))
  ]));
}

function issueCategories(issue) {
  const selected = [...new Set(issue && issue.selectedByCategories || [])];
  return selected.length ? selected : [...new Set(issue && issue.categoryIds || [])];
}

function issueAffinity(issue, affinities, selectedSet) {
  const values = issueCategories(issue)
    .filter((categoryId) => selectedSet.has(categoryId))
    .map((categoryId) => affinities.get(categoryId) || 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function issueIdentityKey(issue) {
  return String(issue && (issue.claimLineage && (
    issue.claimLineage.contentHash || issue.claimLineage.evidenceHash
  )
    || issue.subject || issue.headline) || "");
}

function orderFingerprint(issues) {
  let hash = 2166136261;
  for (const issue of issues || []) {
    const key = issueIdentityKey(issue);
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function sameIssueMultiset(left, right) {
  if (left.length !== right.length) return false;
  const counts = new Map();
  for (const issue of left) {
    const key = issueIdentityKey(issue);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const issue of right) {
    const key = issueIdentityKey(issue);
    const remaining = counts.get(key) || 0;
    if (!remaining) return false;
    if (remaining === 1) counts.delete(key);
    else counts.set(key, remaining - 1);
  }
  return counts.size === 0;
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function primarySelectedCategory(issue, selectedSet) {
  return issueCategories(issue).find((categoryId) => selectedSet.has(categoryId)) || null;
}

function leadSourceKey(issue) {
  const evidence = Array.isArray(issue && issue.sourceEvidence) ? issue.sourceEvidence : [];
  const lead = evidence.find((row) => row && row.evidenceRole === "lead") || evidence[0] || null;
  if (!lead) return null;
  return lead.ownershipGroup || lead.syndicationGroup || lead.sourceId || lead.sourceLabel || null;
}

function maxShare(values) {
  if (!values.length) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

function longestRun(values) {
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    previous = value;
    longest = Math.max(longest, current);
  }
  return longest;
}

function topWindowMetrics(issues, topK, affinities, selectedSet) {
  const top = (issues || []).slice(0, topK);
  const affinityValues = top.map((issue) => issueAffinity(issue, affinities, selectedSet));
  const discountedAffinity = affinityValues.reduce((sum, affinity, index) =>
    sum + ((affinity + 1) / 2) / Math.log2(index + 2), 0);
  const preferredCount = affinityValues.filter((value) => value > 0).length;
  const categories = top.map((issue) => primarySelectedCategory(issue, selectedSet)).filter(Boolean);
  const sources = top.map(leadSourceKey).filter(Boolean);

  return {
    issueCount: top.length,
    discountedAffinity,
    preferredShare: top.length ? preferredCount / top.length : 0,
    selectedCategoryPrecision: top.length ? categories.length / top.length : 0,
    categoryDistinctCount: new Set(categories).size,
    categoryMaxShare: maxShare(categories),
    categoryLongestRun: longestRun(categories),
    sourceKnownCount: sources.length,
    sourceCoverage: top.length ? sources.length / top.length : 0,
    sourceDistinctCount: new Set(sources).size,
    sourceMaxShare: maxShare(sources)
  };
}

export function evaluateEditorialPersonalizationUtility(edition, candidateIssues, user = null) {
  const canonicalIssues = Array.isArray(edition && edition.issues) ? edition.issues : [];
  const projectedIssues = Array.isArray(candidateIssues) ? candidateIssues : canonicalIssues;
  const selected = selectedCategoryIds(edition);
  const selectedSet = new Set(selected);
  const affinities = normalizedCategoryAffinity(user, selected);
  const topK = Math.min(10, canonicalIssues.length);
  const baseline = topWindowMetrics(canonicalIssues, topK, affinities, selectedSet);
  const projected = topWindowMetrics(projectedIssues, topK, affinities, selectedSet);
  const candidateOrderChanged = orderFingerprint(canonicalIssues) !== orderFingerprint(projectedIssues);
  const issueSetUnchanged = sameIssueMultiset(canonicalIssues, projectedIssues);
  const sourceEvidenceReady = baseline.sourceCoverage >= 0.8 && projected.sourceCoverage >= 0.8;
  const minimumCategoryDistinct = Math.min(3, selected.length, baseline.categoryDistinctCount, topK);
  const allowedCategoryMaxShare = Math.max(0.6, baseline.categoryMaxShare);
  const allowedCategoryLongestRun = Math.max(3, baseline.categoryLongestRun);
  const failures = [];

  if (!issueSetUnchanged) failures.push("candidate_issue_set_mutated");

  if (candidateOrderChanged && projected.discountedAffinity <= baseline.discountedAffinity + 1e-9) {
    failures.push("no_discounted_affinity_gain");
  }
  if (projected.preferredShare + 1e-9 < baseline.preferredShare) {
    failures.push("preferred_top_share_loss");
  }
  if (!sourceEvidenceReady) {
    failures.push("source_evidence_insufficient");
  } else if (
    projected.sourceDistinctCount < baseline.sourceDistinctCount
    || projected.sourceMaxShare > baseline.sourceMaxShare + 1e-9
  ) {
    failures.push("source_diversity_loss");
  }
  if (
    projected.categoryDistinctCount < minimumCategoryDistinct
    || projected.categoryMaxShare > allowedCategoryMaxShare + 1e-9
    || projected.categoryLongestRun > allowedCategoryLongestRun
  ) {
    failures.push("category_concentration_increase");
  }
  const projectedUnselectedCount = projectedIssues.filter((issue) =>
    !issueCategories(issue).some((categoryId) => selectedSet.has(categoryId))
  ).length;
  if (projectedUnselectedCount > 0) failures.push("unselected_category_intrusion");

  const applicable = candidateOrderChanged;
  const pass = !applicable || failures.length === 0;
  return {
    stableId: "NOWHOT-EDITORIAL-PERSONALIZATION-UTILITY-EVALUATION-001",
    contractId: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT.stableId,
    state: applicable ? (pass ? "utility_guard_pass" : "utility_guard_hold") : "utility_not_applicable",
    applicable,
    pass,
    pairedSameCanonicalEdition: true,
    issueCountUnchanged: projectedIssues.length === canonicalIssues.length,
    issueSetUnchanged,
    topK,
    failures,
    affinity: {
      baselineDiscounted: rounded(baseline.discountedAffinity),
      projectedDiscounted: rounded(projected.discountedAffinity),
      discountedGain: rounded(projected.discountedAffinity - baseline.discountedAffinity),
      baselinePreferredShare: rounded(baseline.preferredShare),
      projectedPreferredShare: rounded(projected.preferredShare)
    },
    categorySelection: {
      baselinePrecision: rounded(baseline.selectedCategoryPrecision),
      projectedPrecision: rounded(projected.selectedCategoryPrecision),
      unselectedIssueCount: projectedUnselectedCount
    },
    sourceDiversity: {
      evaluable: sourceEvidenceReady,
      pass: sourceEvidenceReady
        && projected.sourceDistinctCount >= baseline.sourceDistinctCount
        && projected.sourceMaxShare <= baseline.sourceMaxShare + 1e-9,
      baselineDistinctCount: baseline.sourceDistinctCount,
      projectedDistinctCount: projected.sourceDistinctCount,
      baselineMaxShare: rounded(baseline.sourceMaxShare),
      projectedMaxShare: rounded(projected.sourceMaxShare),
      baselineCoverage: rounded(baseline.sourceCoverage),
      projectedCoverage: rounded(projected.sourceCoverage)
    },
    categoryConcentration: {
      pass: projected.categoryDistinctCount >= minimumCategoryDistinct
        && projected.categoryMaxShare <= allowedCategoryMaxShare + 1e-9
        && projected.categoryLongestRun <= allowedCategoryLongestRun,
      minimumDistinct: minimumCategoryDistinct,
      baselineDistinctCount: baseline.categoryDistinctCount,
      projectedDistinctCount: projected.categoryDistinctCount,
      baselineMaxShare: rounded(baseline.categoryMaxShare),
      projectedMaxShare: rounded(projected.categoryMaxShare),
      allowedMaxShare: rounded(allowedCategoryMaxShare),
      baselineLongestRun: baseline.categoryLongestRun,
      projectedLongestRun: projected.categoryLongestRun,
      allowedLongestRun: allowedCategoryLongestRun
    },
    llmCalls: 0,
    proves: "동일 공유 판본에서 학습 선호의 상단 대리 효용이 늘고 출처·분야 다양성 가드를 통과했는지",
    doesNotProve: "실제 사용자 만족도·클릭 인과·장기 취향 드리프트·사람 편집 품질"
  };
}

export function projectEditorialPersonalization(edition, user = null) {
  const canonicalIssues = Array.isArray(edition && edition.issues) ? edition.issues : [];
  const selected = selectedCategoryIds(edition);
  const selectedSet = new Set(selected);
  const unselectedIssueCount = canonicalIssues.filter((issue) =>
    !issueCategories(issue).some((categoryId) => selectedSet.has(categoryId))
  ).length;
  const canonicalFingerprint = orderFingerprint(canonicalIssues);
  const affinities = normalizedCategoryAffinity(user, selected);
  const hasDistinctAffinity = new Set([...affinities.values()]).size > 1;
  const eligible = selected.length > 1 && canonicalIssues.length > 1
    && hasTasteSignal(user) && hasDistinctAffinity;

  let candidateIssues = canonicalIssues.slice();
  let mode = "canonical_shared_order";
  let bandSize = 1;
  if (eligible) {
    bandSize = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(canonicalIssues.length))));
    candidateIssues = [];
    for (let start = 0; start < canonicalIssues.length; start += bandSize) {
      const band = canonicalIssues.slice(start, start + bandSize)
        .map((issue, offset) => ({
          issue,
          offset,
          affinity: issueAffinity(issue, affinities, selectedSet)
        }))
        .sort((a, b) => b.affinity - a.affinity || a.offset - b.offset)
        .map((row) => row.issue);
      candidateIssues.push(...band);
    }
    mode = candidateIssues.some((issue, index) => issue !== canonicalIssues[index])
      ? "bounded_category_affinity_reorder"
      : "taste_signal_no_order_change";
  }

  const utility = evaluateEditorialPersonalizationUtility(edition, candidateIssues, user);
  const candidateOrderChanged = candidateIssues.some((issue, index) => issue !== canonicalIssues[index]);
  const utilityFallback = candidateOrderChanged && !utility.pass;
  const projectedIssues = utilityFallback ? canonicalIssues.slice() : candidateIssues;
  if (utilityFallback) mode = "utility_guard_canonical_fallback";

  const originalPositions = new Map(canonicalIssues.map((issue, index) => [issue, index]));
  const maxRankShift = projectedIssues.reduce((max, issue, index) =>
    Math.max(max, Math.abs(index - (originalPositions.get(issue) ?? index))), 0);
  const responseFingerprint = orderFingerprint(projectedIssues);

  return {
    ...edition,
    issues: projectedIssues,
    personalization: {
      stableId: "NOWHOT-EDITORIAL-PERSONALIZATION-PROJECTION-001",
      contractId: EDITORIAL_PERSONALIZATION_CONTRACT.stableId,
      state: unselectedIssueCount ? "personalization_integrity_hold" : "personalization_integrity_pass",
      mode,
      sharedCanonical: true,
      responseOnly: true,
      selectedCategories: selected,
      issueCount: canonicalIssues.length,
      issueCountUnchanged: projectedIssues.length === canonicalIssues.length,
      addedIssueCount: 0,
      removedIssueCount: 0,
      unselectedIssueCount,
      contentMutated: false,
      editorialBandSize: bandSize,
      maxRankShift,
      canonicalOrderFingerprint: canonicalFingerprint,
      responseOrderFingerprint: responseFingerprint,
      orderChanged: canonicalFingerprint !== responseFingerprint,
      candidateOrderChanged,
      utilityFallback,
      utility,
      llmCalls: 0,
      proves: "공유 판본을 복제하지 않고 선택 분야 안에서만 기존 취향 신호가 응답 순서에 제한적으로 반영됨",
      doesNotProve: "개인화 만족도·사람 편집 품질 PASS·운영 배포"
    }
  };
}
