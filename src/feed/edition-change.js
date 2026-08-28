import { eventKey, sharedTitleConcepts, titleConcepts } from "./dedupe.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITION_CHANGE_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITION-CHANGE-CONTRACT-001",
  version: 9,
  states: ["baseline", "new", "material_update", "reaction_update", "unchanged"],
  matchOrder: ["shared_ref_id", "shared_normalized_title", "same_subject_and_category", "shared_event_concepts"],
  semanticMatch: {
    minimumSharedConcepts: 3,
    minimumSharedRatio: 0.5,
    concepts: "dedupe.titleConcepts",
    primaryFields: ["subject", "headline", "lead_and_corroborating_titles"],
    excludedEvidenceRoles: ["related_observation"]
  },
  repeatRule: {
    eligible: ["baseline", "new", "material_update"],
    held: ["reaction_update", "unchanged"],
    materialEvidence: [
      "evidence_mode_changed",
      "observed_feed_count_changed",
      "new_observed_source",
      "related_coverage_increased"
    ],
    note: "추천·댓글 변화는 기록하지만 새 사실이나 근거 변화로 과장하지 않는다. 바로 전 판에 없더라도 최근 브리핑에서 다룬 사건이면 새 사건으로 되돌리지 않는다."
  },
  selectionRule: "선택 분야별 중요도 순위 층을 합쳐 같은 층 안에서 전체 중요도순으로 배치하고 동일 사건은 한 번만 유지",
  continuityRule: "과거 사건 ID 하나는 현재 판의 사건 하나만 승계"
});

const stableHash = (text) => {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
};

const unique = (values) => [...new Set((values || []).filter(Boolean))];
const categoriesOf = (issue) => {
  const selected = unique(issue && issue.selectedByCategories || []);
  return selected.length ? selected : unique(issue && issue.categoryIds || []);
};
const intersects = (left, right) => {
  const set = new Set(left || []);
  return (right || []).some((value) => set.has(value));
};

function primaryRefs(issue) {
  const relatedRows = (issue && issue.sourceEvidence || [])
    .filter((row) => row && row.evidenceRole === "related_observation");
  const relatedTitles = new Set(relatedRows
    .map((row) => String(row.title || "").trim())
    .filter(Boolean));
  const relatedItemIds = new Set(relatedRows.map((row) => row.itemId).filter(Boolean));
  return (issue && issue.refs || []).filter((ref) =>
    ref && !relatedTitles.has(String(ref.title || "").trim()) && !relatedItemIds.has(ref.id));
}

function eventTextVariants(issue) {
  return unique([
    issue && issue.subject,
    issue && issue.headline,
    ...primaryRefs(issue).map((ref) => ref.title),
    ...((issue && issue.sourceEvidence) || [])
      .filter((row) => row && row.evidenceRole !== "related_observation")
      .map((row) => row.title)
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

function semanticContinuity(current, previous) {
  if (!intersects(categoriesOf(current), categoriesOf(previous))) return null;
  let best = null;
  for (const currentText of eventTextVariants(current)) {
    const currentTerms = titleConcepts(currentText);
    if (currentTerms.length < EDITION_CHANGE_CONTRACT.semanticMatch.minimumSharedConcepts) continue;
    for (const previousText of eventTextVariants(previous)) {
      const previousTerms = titleConcepts(previousText);
      if (previousTerms.length < EDITION_CHANGE_CONTRACT.semanticMatch.minimumSharedConcepts) continue;
      const sharedTerms = sharedTitleConcepts(currentText, previousText);
      const ratio = sharedTerms.length / Math.min(currentTerms.length, previousTerms.length);
      const sharedCharacters = sharedTerms.reduce((sum, term) => sum + term.length, 0);
      if (
        sharedTerms.length < EDITION_CHANGE_CONTRACT.semanticMatch.minimumSharedConcepts ||
        ratio < EDITION_CHANGE_CONTRACT.semanticMatch.minimumSharedRatio ||
        sharedCharacters < 7
      ) continue;
      if (!best || sharedTerms.length > best.sharedTerms.length ||
        (sharedTerms.length === best.sharedTerms.length && ratio > best.ratio)) {
        best = { sharedTerms, ratio, currentText, previousText };
      }
    }
  }
  return best;
}

function refIdentity(issue) {
  const refs = primaryRefs(issue);
  return {
    ids: unique(refs.map((ref) => ref && ref.id)),
    urls: unique(refs.map((ref) => ref && (ref.canonicalUrl || ref.url))),
    titles: unique(refs.map((ref) => eventKey(ref && ref.title)).filter(Boolean)),
    sources: unique([
      ...refs.map((ref) => ref && ref.sourceLabel),
      ...((issue && issue.evidence && issue.evidence.sources) || []).map((source) => source && (source.label || source.source))
    ].map((value) => String(value || "").trim()).filter(Boolean))
  };
}

function subjectIdentity(issue) {
  return eventKey(issue && (issue.subject || issue.headline)) || "";
}

function additiveIdentityVariants(issue) {
  return unique([
    issue && issue.subject,
    issue && issue.headline,
    ...primaryRefs(issue).map((ref) => ref.title)
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

function sameAdditiveEvent(left, right) {
  const eventId = (issue) => String(
    issue?.event?.eventId || issue?.eventSourceSetId || issue?.clusterId || ""
  ).split(":")[0].trim();
  const leftEvent = eventId(left);
  const rightEvent = eventId(right);
  const leftRefs = refIdentity(left);
  const rightRefs = refIdentity(right);
  if (intersects(leftRefs.ids, rightRefs.ids)) return true;
  if (intersects(leftRefs.urls, rightRefs.urls)) return true;
  if (leftEvent && rightEvent) return leftEvent === rightEvent;
  if (leftEvent || rightEvent) return false;
  if (intersects(leftRefs.titles, rightRefs.titles)) return true;

  for (const leftText of additiveIdentityVariants(left)) {
    for (const rightText of additiveIdentityVariants(right)) {
      const shared = sharedTitleConcepts(leftText, rightText);
      const sharedCharacters = shared.reduce((sum, concept) => sum + concept.length, 0);
      const hasSharedNumber = shared.some((concept) => concept.startsWith("num:"));
      const hasDistinctiveEntity = shared.some((concept) =>
        !concept.startsWith("num:") && /^[가-힣A-Za-z0-9]+$/.test(concept) && concept.length >= 4);
      if (hasSharedNumber && shared.length >= 4 && sharedCharacters >= 12) return true;
      if (hasDistinctiveEntity && shared.length >= 6 && sharedCharacters >= 20) return true;
    }
  }
  return false;
}

function mergeIssueCategories(primary, secondary) {
  return {
    ...primary,
    categoryIds: unique([...(primary?.categoryIds || []), ...(secondary?.categoryIds || [])]),
    selectedByCategories: unique([...categoriesOf(primary), ...categoriesOf(secondary)])
  };
}

export function editionSegmentKey(categories) {
  const ids = unique((categories || []).map((value) => String(value || "").trim())).sort();
  return ids.length ? ids.join(".") : "default";
}

export function issueSnapshotKey(issue) {
  const category = categoriesOf(issue).sort().join(".") || "general";
  const subject = subjectIdentity(issue);
  const refs = refIdentity(issue);
  const identity = subject || refs.titles[0] || refs.ids[0] || issue && issue.headline || "issue";
  return `NHC-${stableHash(`${category}|${identity}`)}`;
}

function matchStrength(current, previous) {
  // 과거판이 현재 카드의 모든 분야를 이미 제공했을 때만 반복으로 본다.
  // 일부 분야에서만 본 사건은 새로 선택한 분야에 처음 노출될 수 있어야 한다.
  const previousCategories = new Set(categoriesOf(previous));
  if (!categoriesOf(current).every((category) => previousCategories.has(category))) {
    return { score: 0, method: null };
  }
  const cur = refIdentity(current);
  const prev = refIdentity(previous);
  if (intersects(cur.ids, prev.ids)) return { score: 4, method: "shared_ref_id" };
  if (intersects(cur.urls, prev.urls)) return { score: 4, method: "shared_canonical_url" };
  if (intersects(cur.titles, prev.titles)) return { score: 3, method: "shared_normalized_title" };
  if (
    subjectIdentity(current) &&
    subjectIdentity(current) === subjectIdentity(previous)
  ) return { score: 2, method: "same_subject_and_category" };
  const semantic = semanticContinuity(current, previous);
  if (semantic) return {
    score: 1 + semantic.ratio / 10,
    method: "shared_event_concepts",
    sharedTerms: semantic.sharedTerms,
    matchRatio: semantic.ratio,
    currentIdentityText: semantic.currentText,
    previousIdentityText: semantic.previousText
  };
  return { score: 0, method: null };
}

function findPreviousMatch(issue, previousEntries) {
  let best = null;
  for (let index = 0; index < previousEntries.length; index += 1) {
    const entry = previousEntries[index];
    const strength = matchStrength(issue, entry.issue);
    if (!strength.score) continue;
    if (!best || strength.score > best.score) best = { ...strength, index, ...entry };
  }
  return best;
}

function comparisonEditions(previousEdition, historyEditions) {
  const seenIds = new Set();
  const seenObjects = new Set();
  const rows = [];
  for (const edition of [previousEdition, ...(historyEditions || [])]) {
    if (!edition || typeof edition !== "object") continue;
    const id = String(edition.editionId || "").trim();
    if ((id && seenIds.has(id)) || (!id && seenObjects.has(edition))) continue;
    if (id) seenIds.add(id); else seenObjects.add(edition);
    rows.push(edition);
  }
  return rows;
}

const metricValue = (issue, field) => Number(issue && issue.metrics && issue.metrics[field]) || 0;
const evidenceMode = (issue) => String(
  issue && issue.evidence && issue.evidence.mode ||
  issue && issue.metrics && issue.metrics.evidenceMode ||
  "unknown"
);

const signed = (value) => value > 0 ? `+${value}` : String(value);

function describeMaterialChange(previous, current, reasons, deltas, newSources) {
  const bits = [];
  if (newSources.length) bits.push(`${newSources.join("·")} 보도가 새로 확인됐습니다.`);
  else if (reasons.includes("observed_feed_count_changed")) {
    bits.push(`직접 확인한 보도가 ${metricValue(previous, "sourceCount")}건에서 ${metricValue(current, "sourceCount")}건으로 늘었습니다.`);
  } else if (reasons.includes("evidence_mode_changed")) {
    bits.push("확인 근거가 더 보강됐습니다.");
  }
  if (reasons.includes("related_coverage_increased")) {
    bits.push("같은 주제를 다룬 보도도 더 늘었습니다.");
  }
  if (deltas.score || deltas.comments) {
    const reaction = [];
    if (deltas.score) reaction.push(`추천 ${signed(deltas.score)}`);
    if (deltas.comments) reaction.push(`댓글 ${signed(deltas.comments)}`);
    bits.push(`${reaction.join(" · ")}의 반응 변화도 확인됐습니다.`);
  }
  return ["지난 브리핑에서 다룬 사안입니다.", ...bits].join(" ");
}

function changeFor(issue, match, hasPreviousEdition) {
  if (!hasPreviousEdition) {
    return {
      state: "baseline",
      repeatEligible: true,
      matchMethod: null,
      changedSincePrevious: "이 카테고리로 저장된 첫 브리핑입니다.",
      deltas: null,
      reasons: ["no_previous_snapshot"]
    };
  }
  if (!match) {
    return {
      state: "new",
      repeatEligible: true,
      matchMethod: null,
      changedSincePrevious: "지난 브리핑에서는 다루지 않은 소식입니다.",
      deltas: null,
      reasons: ["not_in_previous_edition"]
    };
  }

  const previous = match.issue;
  const deltas = {
    sourceCount: metricValue(issue, "sourceCount") - metricValue(previous, "sourceCount"),
    coverage: metricValue(issue, "coverage") - metricValue(previous, "coverage"),
    score: metricValue(issue, "score") - metricValue(previous, "score"),
    comments: metricValue(issue, "comments") - metricValue(previous, "comments")
  };
  const currentRefs = refIdentity(issue);
  const previousRefs = refIdentity(previous);
  const previousSources = new Set(previousRefs.sources);
  const newSources = currentRefs.sources.filter((source) => !previousSources.has(source));
  const reasons = [];
  if (evidenceMode(issue) !== evidenceMode(previous)) reasons.push("evidence_mode_changed");
  if (deltas.sourceCount !== 0) reasons.push("observed_feed_count_changed");
  if (newSources.length) reasons.push("new_observed_source");
  if (deltas.coverage > 0) reasons.push("related_coverage_increased");

  if (reasons.length) {
    return {
      state: "material_update",
      repeatEligible: true,
      matchMethod: match.method,
      changedSincePrevious: describeMaterialChange(previous, issue, reasons, deltas, newSources),
      deltas,
      reasons,
      newSources
    };
  }
  if (deltas.score || deltas.comments) {
    const reaction = [];
    if (deltas.score) reaction.push(`추천 ${signed(deltas.score)}`);
    if (deltas.comments) reaction.push(`댓글 ${signed(deltas.comments)}`);
    return {
      state: "reaction_update",
      repeatEligible: false,
      matchMethod: match.method,
      changedSincePrevious: `지난 브리핑과 같은 내용입니다. ${reaction.join(" · ")}의 반응만 달라졌고 새 사실은 확인되지 않았습니다.`,
      deltas,
      reasons: ["reaction_only"]
    };
  }
  return {
    state: "unchanged",
    repeatEligible: false,
    matchMethod: match.method,
    changedSincePrevious: "지난 브리핑에서 다룬 내용과 같습니다. 새로 확인된 사실은 없습니다.",
    deltas,
    reasons: ["no_observed_change"]
  };
}

function selectEligible(issues, {
  targetLimit,
  selectedCategories,
  minIssuesPerCategory,
  additiveCategoryUnion = false,
  categoryIssueLimit = null
}) {
  const limit = Math.max(1, Number(targetLimit) || issues.length || 1);
  const selected = unique(selectedCategories || []);
  const laneLimit = Math.max(0, Number(categoryIssueLimit) || 0);
  if (additiveCategoryUnion && laneLimit && selected.length) {
    const union = [];
    const laneRank = new Map();
    const originalRank = new Map(issues.map((issue, index) => [issue, index]));
    for (const category of selected) {
      let count = 0;
      const credited = [];
      for (const issue of issues) {
        if (count >= laneLimit) break;
        if (!categoriesOf(issue).includes(category)) continue;
        const newLaneEvent = !credited.some((row) => sameAdditiveEvent(row, issue));
        const duplicateIndex = union.findIndex((selectedIssue) => sameAdditiveEvent(selectedIssue, issue));
        if (duplicateIndex < 0) {
          union.push(issue);
          laneRank.set(issue, count);
        } else {
          const duplicate = union[duplicateIndex];
          const rank = Math.min(laneRank.get(duplicate) ?? count, count);
          const representative = originalRank.get(issue) < originalRank.get(duplicate) ? issue : duplicate;
          const merged = mergeIssueCategories(representative, representative === issue ? duplicate : issue);
          union[duplicateIndex] = merged;
          laneRank.delete(duplicate);
          laneRank.set(merged, rank);
          originalRank.set(merged, Math.min(originalRank.get(issue), originalRank.get(duplicate)));
        }
        if (newLaneEvent) {
          credited.push(issue);
          count += 1;
        }
      }
    }
    return union.sort((left, right) =>
      laneRank.get(left) - laneRank.get(right) ||
      originalRank.get(left) - originalRank.get(right)
    ).slice(0, limit);
  }
  const floor = Math.max(0, Number(minIssuesPerCategory) || 0);
  const chosen = [];
  const used = new Set();
  const add = (issue) => {
    if (!issue || used.has(issue) || chosen.length >= limit) return false;
    used.add(issue);
    chosen.push(issue);
    return true;
  };
  if (floor && selected.length) {
    for (const category of selected) {
      let count = 0;
      for (const issue of issues) {
        if (count >= floor) break;
        if (!categoriesOf(issue).includes(category)) continue;
        if (add(issue)) count += 1;
      }
    }
  }
  for (const issue of issues) add(issue);
  return chosen;
}

export function applyEditionChanges(currentEdition, previousEdition = null, {
  targetLimit = null,
  minIssuesPerCategory = null,
  additiveCategoryUnion = null,
  categoryIssueLimit = null,
  enforceRepeatRule = true,
  historyEditions = []
} = {}) {
  const currentIssues = Array.isArray(currentEdition && currentEdition.issues) ? currentEdition.issues : [];
  const priorEditions = comparisonEditions(previousEdition, historyEditions);
  const previousEntries = priorEditions.flatMap((edition) =>
    (Array.isArray(edition && edition.issues) ? edition.issues : []).map((issue) => ({
      issue,
      editionId: edition.editionId || null
    }))
  );
  const claimedPreviousClusters = new Set();
  const claimedCurrentClusters = new Set();
  const annotated = currentIssues.map((issue) => {
    let match = findPreviousMatch(issue, previousEntries);
    const matchedClusterId = match && (match.issue.clusterId || issueSnapshotKey(match.issue));
    if (matchedClusterId && claimedPreviousClusters.has(matchedClusterId)) match = null;
    const change = changeFor(issue, match, priorEditions.length > 0);
    let clusterId = match && match.issue.clusterId || issue.clusterId || issueSnapshotKey(issue);
    if (claimedCurrentClusters.has(clusterId)) {
      const refs = refIdentity(issue);
      clusterId = `NHC-${stableHash(`${clusterId}|${refs.ids.join(".")}|${issue.headline || issue.subject || "issue"}`)}`;
    }
    if (match) claimedPreviousClusters.add(matchedClusterId);
    claimedCurrentClusters.add(clusterId);
    const publishedAt = match && match.issue.publishedAt || currentEdition.generatedAt || null;
    const previousUpdatedAt = match && match.issue.updatedAt || publishedAt;
    const updatedAt = change.state === "unchanged" ? previousUpdatedAt : currentEdition.generatedAt || previousUpdatedAt;
    return {
      ...issue,
      clusterId,
      editionIds: unique([
        ...((match && match.issue && match.issue.editionIds) || []),
        ...(issue.editionIds || []),
        currentEdition.editionId
      ]),
      whatHappened: issue.whatHappened || issue.paragraph || null,
      changedSincePrevious: change.changedSincePrevious,
      changeState: change.state,
      repeatEligible: change.repeatEligible,
      changeEvidence: {
        matchMethod: change.matchMethod,
        matchedEditionId: match && match.editionId || null,
        matchedTerms: match && match.sharedTerms || [],
        matchRatio: match && match.matchRatio || null,
        currentIdentityText: match && match.currentIdentityText || null,
        previousIdentityText: match && match.previousIdentityText || null,
        reasons: change.reasons,
        deltas: change.deltas,
        newSources: change.newSources || []
      },
      publishedAt,
      updatedAt
    };
  });

  const eligible = annotated.filter((issue) => issue.repeatEligible);
  const selected = enforceRepeatRule
    ? selectEligible(eligible, {
      targetLimit: targetLimit || currentEdition && currentEdition.selection && currentEdition.selection.maxIssues || annotated.length,
      selectedCategories: currentEdition && currentEdition.selectedCategories,
      minIssuesPerCategory: minIssuesPerCategory == null
        ? currentEdition && currentEdition.selection && currentEdition.selection.minIssuesPerCategory
        : minIssuesPerCategory,
      additiveCategoryUnion: additiveCategoryUnion == null
        ? Boolean(currentEdition && currentEdition.selection && currentEdition.selection.additiveCategoryUnion)
        : Boolean(additiveCategoryUnion),
      categoryIssueLimit: categoryIssueLimit == null
        ? currentEdition && currentEdition.selection && currentEdition.selection.categoryIssueLimit
        : categoryIssueLimit
    })
    : annotated.slice(0, targetLimit || annotated.length);
  const counts = Object.fromEntries(EDITION_CHANGE_CONTRACT.states.map((state) => [
    state,
    annotated.filter((issue) => issue.changeState === state).length
  ]));
  const selectedSet = new Set(selected);
  const held = annotated.filter((issue) => !selectedSet.has(issue));
  const receipt = {
    stableId: EDITION_CHANGE_CONTRACT.stableId,
    state: priorEditions.length ? "compared" : "baseline_saved",
    currentEditionId: currentEdition && currentEdition.editionId || null,
    previousEditionId: previousEdition && previousEdition.editionId || null,
    comparedEditionIds: priorEditions.map((edition) => edition.editionId).filter(Boolean),
    observedAt: currentEdition && currentEdition.generatedAt || null,
    candidateIssueCount: annotated.length,
    selectedIssueCount: selected.length,
    heldRepeatCount: held.filter((issue) => !issue.repeatEligible).length,
    heldForLimitCount: held.filter((issue) => issue.repeatEligible).length,
    counts,
    repeatRuleApplied: Boolean(enforceRepeatRule && priorEditions.length),
    reactionThreshold: "none"
  };

  return {
    ...currentEdition,
    issues: selected,
    publishable: selected.length >= 3,
    editionChange: receipt,
    limits: unique([
      ...(currentEdition && currentEdition.limits || []),
      "반응 수치 변화만으로는 같은 사건의 재등장을 허용하지 않는다. 새 근거·출처 변화가 필요하다."
    ])
  };
}
