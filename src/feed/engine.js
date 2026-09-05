// Feed engine: glue between sources, the store, and the recommender.
//
// Produces the endless personalized stream. Ranking excludes items the user has
// already been shown, so scrolling never repeats — the piece that makes the
// stream feel smooth instead of the page-by-page shuffling of a plain
// aggregator. The client keeps the rendered DOM and restores scroll on back
// navigation; the server just keeps handing out the next best unseen batch.

import fs from "node:fs";
import { ArticleArchive } from "./article-archive.js";
import { collect, SeedSource, resolveCap } from "./content.js";
import { loadRegistry } from "./registry.js";
import { TitleClassifier, classifyTitle, TRAIN_LABELS, isReclassifiable, OVERRIDE_CATEGORIES, UNTRAINED_CATEGORIES, definiteCategory, MIXED_BEST_FALLBACK, MIXED_NEUTRAL_CATEGORY, categoryGuardReason, isGeneralNewsGuardReason } from "./classify.js";
import { hasProfanity } from "./profanity.js";
import { matchInterest, WEIGHTY } from "./interest.js";
import { adUnsafe } from "./promotion.js";
import { AD_DISCLOSURE as COUPANG_DISCLOSURE } from "./ad-copy.js";
import { destForDeal, destForText, destForTags, ensureDealShare, capDeals, dealRank } from "./deals.js";
import { chosenCategories, ensureTasteShare, capOneCategory, ensureForeignShare, isForeignItem, FOREIGN_WINDOW } from "./taste-share.js";

// 상품군 사전을 걸지 않는 분류. 사건·시사 기사에 "연관 광고"가 붙으면
// 무관한 광고보다 더 나쁘다(2026-08-06 실측, engine의 adDest 주석 참고).
const AD_MATCH_OFF = new Set(["news", "politics"]);
import { promotable, isLowValue } from "./promotion.js";
import { isJunkImage } from "./enrich.js";
import { eventKey } from "./dedupe.js";
import { canonicalContentUrl } from "./dedupe.js";
import { buildEventClusters, composeEventFromMembers } from "./event-cluster.js";
import { isGoogleNewsRedirect } from "./canonical-url.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";
import { coverageEvidence } from "./editorial-quality.js";
import {
  buildDigest,
  buildIssueDraft,
  canonicalDisplayDuplicate,
  MIN_ISSUES,
  slotForHour,
  slotById,
  isOverseas
} from "./digest.js";
import { rankParams, categorySets, selectDiverse } from "./rank.js";
import {
  rankItems,
  diversify,
  applyFeedback,
  revertFeedback,
  applyImplicit,
  explain,
  specializationLevel,
  feedPhase,
  scoreItem,
  tasteScore
} from "./recommender.js";
import { collaborativeBoosts } from "./collab.js";
import { CATEGORIES, categoryLabel, sourceLabel } from "./taxonomy.js";
import {
  EDITION_CANDIDATE_CONTRACT,
  buildEditionCandidateFixture,
  candidateFixtureReceipt,
  koreanAudienceReadable
} from "./edition-candidates.js";
import { attachEditorialLineage } from "./editorial-lineage.js";
import {
  EDITORIAL_FULFILLMENT_CONTRACT,
  attachEditorialFulfillment,
  editorialIssueBudget,
  editorialMinimumPerCategory
} from "./editorial-fulfillment.js";
import { sampleSources, evaluate, summarize } from "./health.js";
import { hotGate, rankBySource, topPerSource, roundRobinInterleave, sourceHotScores, hotParams, latestInterleave, diversityKey, COVERAGE_MAX } from "./ingest.js";
import { FILTERABLE_TOPICS, NO_DEAL_TOPIC } from "./topics.js";
import { specialistCorrection, aggregateReclassification, untrainedOverrideAllowed, isTranslatedTitle } from "./category-policy.js";
import { buildEditorialNote } from "./editorial.js";
import {
  AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS,
  OVERSEAS_MARKET_SIGNAL_LEXICON,
  findMarketSignalMatches,
  isAuthoritativeForeignNewsSource
} from "./selection-axes.js";
import {
  injectSlots,
  adParams,
  adaptiveEvery,
  pickAffiliateCandidates,
  assignVariant,
  applyVariant,
  applyNarrowSourceDensity
} from "./monetize.js";

// 섹션 뉴스는 등록 분야가 강한 신호다. 다만 과학·기술 묶음에 게임·과학 기사가
// 실측으로 섞이듯, 제목에 전용어가 있는 분야만 좁게 바로잡는다.
const SECTIONED_NEWS_TITLE_OVERRIDES = new Set(["auto", "gaming", "science"]);
// 이 값은 판본 수집량·발행량 목표가 아니다. 약지도 NB가 두세 제목만 보고
// 오분류하지 않게 하는 프로세스 시작 시점의 내부 준비 보호값이다.
const MIN_NB_TRAINING_ROWS = 100;

function preferCanonicalItem(current, candidate, offMain, engagement) {
  if (!current) return candidate;
  const currentWrapper = isGoogleNewsRedirect(current.url);
  const candidateWrapper = isGoogleNewsRedirect(candidate.url);
  if (currentWrapper !== candidateWrapper) return candidateWrapper ? current : candidate;
  const currentVisible = !offMain.has(current.source);
  const candidateVisible = !offMain.has(candidate.source);
  if (currentVisible !== candidateVisible) return candidateVisible ? candidate : current;
  return engagement(candidate) > engagement(current) ? candidate : current;
}

const eventSourceOrder = (a, b) => {
  const leftWrapper = Number(isGoogleNewsRedirect(a && (a.canonicalUrl || a.url)));
  const rightWrapper = Number(isGoogleNewsRedirect(b && (b.canonicalUrl || b.url)));
  if (leftWrapper !== rightWrapper) return leftWrapper - rightWrapper;
  const left = Date.parse(a && a.publishedAt || "");
  const right = Date.parse(b && b.publishedAt || "");
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
  return String(a && (a.id || a.title) || "").localeCompare(String(b && (b.id || b.title) || ""));
};

const publisherEditionRank = (item) => {
  const text = `${item?.originalTitle || ""} ${item?.title || ""}`;
  if (/[가-힣]/.test(text) && !/[ぁ-んァ-ン一-龯]/.test(item?.originalTitle || "")) return 0;
  if (/[ぁ-んァ-ン一-龯]/.test(text) || /\/jp(?:\/|-)/i.test(item?.canonicalUrl || item?.url || "")) return 2;
  return 1;
};

const presentationOrder = (a, b, canLead = () => true) => {
  const lead = Number(!canLead(a)) - Number(!canLead(b));
  if (lead) return lead;
  const reporting = Number(a?.kind === "community") - Number(b?.kind === "community");
  if (reporting) return reporting;
  const left = Date.parse(a?.publishedAt || "");
  const right = Date.parse(b?.publishedAt || "");
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
  if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
  const wrapper = Number(isGoogleNewsRedirect(a?.canonicalUrl || a?.url))
    - Number(isGoogleNewsRedirect(b?.canonicalUrl || b?.url));
  if (wrapper) return wrapper;
  const edition = publisherEditionRank(a) - publisherEditionRank(b);
  if (edition) return edition;
  return String(a?.id || a?.title || "").localeCompare(String(b?.id || b?.title || ""));
};

function preferredPresentationMembers(members, canLead) {
  const representatives = new Map();
  for (const item of members || []) {
    const group = operationalSourceIdentity(item).ownershipGroup || `item:${item?.id || item?.url}`;
    const current = representatives.get(group);
    const better = !current
      || Number(!canLead(item)) < Number(!canLead(current))
      || Number(!canLead(item)) === Number(!canLead(current))
        && (Number(isGoogleNewsRedirect(item?.canonicalUrl || item?.url))
            < Number(isGoogleNewsRedirect(current?.canonicalUrl || current?.url))
          || Number(isGoogleNewsRedirect(item?.canonicalUrl || item?.url))
              === Number(isGoogleNewsRedirect(current?.canonicalUrl || current?.url))
            && publisherEditionRank(item) < publisherEditionRank(current));
    if (better) representatives.set(group, item);
  }
  const selected = [...representatives.values()];
  const primary = selected.filter(canLead).sort(eventSourceOrder);
  const withheld = selected.filter((item) => !canLead(item)).sort(eventSourceOrder);
  const chosen = new Set(selected);
  return [...primary, ...withheld, ...(members || []).filter((item) => !chosen.has(item)).sort(eventSourceOrder)];
}

function buildEventSourceIndex(items, events = buildEventClusters(items), leadEligibleIds = null) {
  const byId = new Map();
  const byUrl = new Map();
  const add = (map, key, item) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  for (const item of items || []) {
    if (!item) continue;
    if (item.id) byId.set(item.id, item);
    add(byUrl, canonicalContentUrl(item.url), item);
    add(byUrl, canonicalContentUrl(item.canonicalUrl), item);
    for (const alias of item.canonicalAliases || []) {
      if (alias && alias.id) byId.set(alias.id, item);
      add(byUrl, canonicalContentUrl(alias && alias.url), item);
    }
  }
  const groupsByItem = new Map();
  for (const event of events) {
    const members = (event.sourceEvidence || []).map((row) =>
      byId.get(row.articleId) || (byUrl.get(canonicalContentUrl(row.canonicalUrl)) || [])[0]
    ).filter(Boolean).sort(eventSourceOrder);
    for (const member of members) {
      groupsByItem.set(member, members);
    }
  }
  const canLead = (item) => !leadEligibleIds || leadEligibleIds.has(item?.id);
  return { byId, byUrl, groupsByItem, canLead };
}

function attachCanonicalEventSources(issue, index) {
  const eventMemberIds = new Set([
    ...(issue?.event?.memberArticleIds || []),
    ...(issue?.event?.sourceEvidence || []).map((row) => row?.articleId),
    issue?.event?.representativeId
  ].filter(Boolean));
  const belongsToIssueEvent = (item) => !eventMemberIds.size || eventMemberIds.has(item?.id)
    || (item?.canonicalAliases || []).some((alias) => eventMemberIds.has(alias?.id));
  const evidenceRows = [
    ...(issue?.refs || []),
    ...(issue?.sourceEvidence || []),
    ...(issue?.event?.sourceEvidence || [])
  ];
  const leads = [];
  for (const row of evidenceRows) {
    const byId = index.byId.get(row?.id || row?.itemId || row?.articleId);
    if (byId) leads.push(byId);
    for (const value of [row?.canonicalUrl, row?.url]) {
      leads.push(...(index.byUrl.get(canonicalContentUrl(value)) || []));
    }
  }
  const allEligibleLeads = [...new Set(leads)].filter(index.canLead);
  const eligibleLeads = eventMemberIds.size
    ? allEligibleLeads.filter(belongsToIssueEvent)
    : allEligibleLeads;
  if (!eligibleLeads.length) return issue;

  const lead = eligibleLeads.sort(eventSourceOrder)[0];
  const leadMembers = index.groupsByItem.get(lead) || [lead];
  const members = [...new Set(eligibleLeads.flatMap((lead) =>
    index.groupsByItem.get(lead) || [lead]))];
  const presentationMembers = preferredPresentationMembers(members, index.canLead);
  const event = composeEventFromMembers(members);
  const canonicalMembers = preferredPresentationMembers(leadMembers, index.canLead);
  const canonicalEvent = composeEventFromMembers(leadMembers);
  const presentationLead = [...canonicalMembers].sort((a, b) =>
    presentationOrder(a, b, index.canLead))[0];
  const draftMembers = presentationLead
    ? [presentationLead, ...canonicalMembers.filter((item) => item !== presentationLead)]
    : canonicalMembers;
  const draft = buildIssueDraft(draftMembers, null, true);
  const routedCategoryIds = [...new Set(members.flatMap((item) =>
    Array.isArray(item.admittedCategories) ? item.admittedCategories : []))];
  const canonicalCategoryIds = routedCategoryIds.length ? routedCategoryIds : [...new Set(
    members.map((item) => item.category).filter(Boolean)
  )];
  const canonical = enrichDigestIssue({
    ...draft,
    categoryIds: canonicalCategoryIds.length ? canonicalCategoryIds : issue.categoryIds,
    subject: presentationLead?.title || draft.subject,
    headline: canonicalMembers.some((item) => item.kind === "news" && item.editorialImportance === "pass")
      ? presentationLead?.title || draft.subject : draft.headline,
    clusterId: canonicalEvent.eventId,
    event: canonicalEvent
  }, []);
  const hasReporting = members.some((item) => item.kind !== "community");
  const seenSources = new Set();
  const eventSources = presentationMembers.filter((item) => !hasReporting || item.kind !== "community")
    .filter((item) => {
      const key = operationalSourceIdentity(item).ownershipGroup;
      return key && !seenSources.has(key) && seenSources.add(key);
    })
    .map((item) => {
      const url = canonicalContentUrl(item.canonicalUrl || item.url) || item.canonicalUrl || item.url || null;
      return {
        evidenceId: `event-source:${item.id || url}`,
        id: item.id || null,
        title: item.title || "",
        originalTitle: item.originalTitle || null,
        summary: item.summary || item.description || item.excerpt || "",
        sourceId: item.source || null,
        sourceGroup: operationalSourceIdentity(item).ownershipGroup,
        sourceLabel: item.sourceLabel || item.source || "원문",
        url,
        canonicalUrl: url,
        publishedAt: item.publishedAt || null,
        image: item.image || null,
        canLead: index.canLead(item),
        relay: isGoogleNewsRedirect(url)
      };
    }).filter((row) => row.url);
  if (!eventSources.length) return issue;
  const eventEvidence = coverageEvidence(
    presentationMembers.filter((item) => !hasReporting || item.kind !== "community")
  );
  const presentationMetrics = {
    ...canonical.metrics,
    sourceCount: eventEvidence.observedFeedCount,
    independentGroupCount: eventEvidence.independentGroupCount,
    evidenceMode: eventEvidence.mode
  };
  const presentationCopy = enrichDigestIssue({
    ...canonical,
    metrics: presentationMetrics,
    evidence: eventEvidence
  }, []);
  const carryoverById = new Map();
  const rememberCarryover = (row) => {
    if (!row?.carryover) return;
    if (row.id) carryoverById.set(`id:${row.id}`, row.carryover);
    if (row.itemId) carryoverById.set(`id:${row.itemId}`, row.carryover);
    const url = canonicalContentUrl(row.canonicalUrl || row.url);
    if (url) carryoverById.set(`url:${url}`, row.carryover);
  };
  for (const row of [...(issue.refs || []), ...(issue.sourceEvidence || [])]) rememberCarryover(row);
  const withCarryover = (row) => {
    const url = canonicalContentUrl(row.canonicalUrl || row.url);
    const carryover = carryoverById.get(`id:${row.id || row.itemId}`) ||
      url && carryoverById.get(`url:${url}`) || row.carryover;
    return carryover ? { ...row, carryover } : row;
  };
  // 카테고리는 사건의 노출 여부와 순서만 정한다. 같은 사건의 제목·설명·근거를
  // 선택 조합마다 다시 만들면 한 기사가 다른 기사처럼 보인다. 전체 사건 멤버로
  // 한 번 만든 표현 정본만 투영하고, 선택 단계의 게이트 상태는 그대로 둔다.
  const fixedPresentation = canonical ? {
    categoryIds: canonical.categoryIds,
    subject: canonical.subject,
    headline: canonical.headline,
    paragraph: canonical.paragraph,
    whatHappened: canonical.whatHappened,
    tone: canonical.tone,
    shape: canonical.shape,
    metrics: {
      ...presentationMetrics,
      ...(issue.metrics?.carryoverUsed ? {
        carryoverUsed: true,
        carryoverEvidenceCount: issue.metrics.carryoverEvidenceCount || 1
      } : {})
    },
    evidence: eventEvidence,
    sourceEvidence: canonical.sourceEvidence.map(withCarryover),
    refs: canonical.refs.map(withCarryover),
    overseasOnly: canonical.overseasOnly,
    clusterId: canonical.clusterId,
    event: canonical.event,
    impactLens: canonical.impactLens,
    whyImportant: canonical.whyImportant,
    whyHot: presentationCopy.whyHot,
    watchNext: presentationCopy.watchNext,
    confidence: presentationCopy.confidence
  } : {};
  const selectedCategories = [...new Set([
    ...(issue.selectedByCategories || []),
    ...(issue.claimLineage?.claims?.whyForYou?.categoryIds || [])
  ])];
  return attachEditorialLineage({
    ...issue,
    ...fixedPresentation,
    selectedByCategories: selectedCategories,
    eventSourceSetId: `${event.eventId}:${eventSources.map((row) => row.sourceGroup || row.url).sort().join("|")}`,
    eventSources
  }, { selectedCategories });
}

const editionIssueKey = (issue) => String(
  String(issue?.eventSourceSetId || "").split(":")[0] || issue?.event?.eventId || issue?.clusterId || issue?.evidenceHash ||
  canonicalContentUrl(issue?.refs?.[0]?.canonicalUrl || issue?.refs?.[0]?.url) ||
  issue?.refs?.[0]?.id || issue?.subject || ""
);

const sourceKindById = new Map(loadRegistry().map((source) => [source.id, source.kind]));
const finalIssueEvidence = (issue) => (issue?.sourceEvidence?.length
  ? issue.sourceEvidence : issue?.event?.sourceEvidence?.length
    ? issue.event.sourceEvidence : issue?.eventSources || []).map((row) => ({
  title: row.title || issue.headline || "",
  operatorGroup: row.operatorGroup || row.ownershipGroup || row.sourceGroup || row.sourceId || "",
  publishedAt: row.publishedAt || issue.firstPublishedAt || issue?.event?.firstSeenAt || null,
  evidenceRole: ["reporting", "community_post"].includes(row.evidenceRole)
    ? row.evidenceRole : sourceKindById.get(row.sourceId) === "community" ? "community_post" : "reporting"
})).filter((row) => row.title);

const sameFinalDisplayIssue = (left, right) => finalIssueEvidence(left).some((leftEvidence) =>
  finalIssueEvidence(right).some((rightEvidence) => canonicalDisplayDuplicate(leftEvidence, rightEvidence)));

const finalIssuePriority = (issue) => {
  const evidence = finalIssueEvidence(issue);
  const reporting = evidence.filter((row) => row.evidenceRole === "reporting");
  return [
    Number(reporting.length > 0),
    new Set(reporting.map((row) => row.operatorGroup).filter(Boolean)).size,
    evidence.length,
    Number(issue?.metrics?.score) || 0
  ];
};

const preferFinalIssue = (left, right) => {
  const leftPriority = finalIssuePriority(left);
  const rightPriority = finalIssuePriority(right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) {
      return leftPriority[index] > rightPriority[index] ? left : right;
    }
  }
  const leftKey = `${left?.evidenceHash || ""}|${editionIssueKey(left)}`;
  const rightKey = `${right?.evidenceHash || ""}|${editionIssueKey(right)}`;
  return leftKey.localeCompare(rightKey) <= 0 ? left : right;
};

export function mergeCategoryEditions(rows, selectedCategories, candidateCap, includeCandidates) {
  const first = rows[0]?.edition || {};
  const issueLists = rows.map(({ category, edition }) => ({
    category,
    issues: (edition.issues || []).filter((issue) => {
      const lanes = issue.selectedByCategories || [];
      return lanes.length ? lanes.includes(category) : (issue.categoryIds || []).includes(category);
    }).map((issue, rank) => ({
      ...issue,
      selectedByCategories: [...new Set([...(issue.selectedByCategories || []), category])],
      _categoryLaneRanks: { ...(issue._categoryLaneRanks || {}), [category]: rank }
    }))
  }));
  const mergedIssues = [];
  const issueIndex = new Map();
  const maxDepth = Math.max(0, ...issueLists.map((row) => row.issues.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const layer = issueLists.map((row, categoryIndex) => ({
      issue: row.issues[depth],
      categoryIndex
    })).filter((row) => row.issue).sort((left, right) =>
      Number(right.issue.metrics?.score || 0) - Number(left.issue.metrics?.score || 0)
      || left.categoryIndex - right.categoryIndex);
    for (const { issue } of layer) {
      const key = editionIssueKey(issue);
      const exactIdentity = Boolean(key && issueIndex.has(key));
      const existingIndex = exactIdentity ? issueIndex.get(key)
        : mergedIssues.findIndex((current) => sameFinalDisplayIssue(current, issue));
      if (existingIndex < 0) {
        issueIndex.set(key || `row:${mergedIssues.length}`, mergedIssues.length);
        mergedIssues.push(issue);
        continue;
      }
      const current = mergedIssues[existingIndex];
      const survivor = preferFinalIssue(current, issue);
      const categoryIds = exactIdentity
        ? [...new Set([...(current.categoryIds || []), ...(issue.categoryIds || [])])]
        : [...new Set(survivor.categoryIds || [])];
      const selectedByCategories = exactIdentity
        ? [...new Set([...(current.selectedByCategories || []), ...(issue.selectedByCategories || [])])]
        : [...new Set(survivor.selectedByCategories || [])];
      const categoryLaneRanks = exactIdentity
        ? { ...(current._categoryLaneRanks || {}), ...(issue._categoryLaneRanks || {}) }
        : { ...(survivor._categoryLaneRanks || {}) };
      const merged = { ...survivor, categoryIds, selectedByCategories, _categoryLaneRanks: categoryLaneRanks };
      if (!exactIdentity && survivor !== current) {
        for (const [mappedKey, mappedIndex] of issueIndex) {
          if (mappedIndex === existingIndex) issueIndex.delete(mappedKey);
        }
      }
      issueIndex.set(editionIssueKey(survivor), existingIndex);
      mergedIssues[existingIndex] = survivor.claimLineage || survivor.sourceEvidence?.length
        ? attachEditorialLineage(merged, {
          selectedCategories: selectedByCategories
        })
        : merged;
    }
  }
  const fixtures = rows.map((row) => row.edition.candidateFixture).filter(Boolean);
  const candidateRows = [];
  const candidateByUrl = new Map();
  const candidateCategories = new Map();
  const candidateDepth = Math.max(0, ...fixtures.map((fixture) => fixture.candidates?.length || 0));
  for (let depth = 0; depth < candidateDepth; depth += 1) {
    const layer = rows.map(({ category, edition }, categoryIndex) => ({
      category,
      categoryIndex,
      candidate: edition.candidateFixture?.candidates?.[depth]
    })).filter((row) => row.candidate).sort((left, right) =>
      Number(right.candidate.signals?.score || 0) - Number(left.candidate.signals?.score || 0)
      || left.categoryIndex - right.categoryIndex);
    for (const { category, candidate } of layer) {
      const key = candidate.canonicalUrl || `${candidate.sourceId}|${candidate.itemId}`;
      if (!candidateCategories.has(key)) candidateCategories.set(key, new Set());
      candidateCategories.get(key).add(category);
      if (candidateByUrl.has(key) || candidateRows.length >= candidateCap) continue;
      candidateByUrl.set(key, candidateRows.length);
      candidateRows.push(candidate);
    }
  }
  const candidates = candidateRows.map((candidate, index) => ({
    ...candidate,
    candidateId: `EC-${String(index + 1).padStart(3, "0")}`
  }));
  const metricRows = fixtures.map((fixture) => fixture.metrics || {});
  const sum = (field) => metricRows.reduce((total, metrics) => total + Number(metrics[field] || 0), 0);
  const categoryCandidateCounts = Object.fromEntries(selectedCategories.map((category) => [
    category,
    [...candidateByUrl.keys()].filter((key) => candidateCategories.get(key)?.has(category)).length
  ]));
  const carryoverCategoryCounts = Object.fromEntries(selectedCategories.map((category) => [
    category,
    [...candidateByUrl].filter(([key, index]) =>
      candidates[index]?.carryover && candidateCategories.get(key)?.has(category)).length
  ]));
  const dropped = {};
  for (const metrics of metricRows) {
    for (const [reason, count] of Object.entries(metrics.dropped || {})) {
      dropped[reason] = (dropped[reason] || 0) + Number(count || 0);
    }
  }
  const candidateFixture = fixtures.length ? {
    stableId: `${EDITION_CANDIDATE_CONTRACT.stableId}-FIXTURE`,
    contractId: EDITION_CANDIDATE_CONTRACT.stableId,
    state: candidates.length ? "machine_observation_ready" : "insufficient_input",
    label: `${candidates.length} MACHINE OBSERVATION`,
    observedAt: first.generatedAt,
    selectedCategories: [...selectedCategories],
    metrics: {
      inputCount: sum("inputCount"),
      eligibleCount: sum("eligibleCount"),
      candidateCount: candidates.length,
      candidateCap,
      capReached: candidates.length === candidateCap,
      truncated: metricRows.some((metrics) => metrics.truncated) || candidateRows.length >= candidateCap,
      sourceCap: Math.max(0, ...metricRows.map((metrics) => Number(metrics.sourceCap || 0))),
      categoryFloor: Math.max(0, ...metricRows.map((metrics) => Number(metrics.categoryFloor || 0))),
      koreanAudiencePreference: metricRows.every((metrics) => metrics.koreanAudiencePreference !== false),
      uniqueSourceCount: new Set(candidates.map((row) => row.sourceId)).size,
      uniqueOwnershipGroupCount: new Set(candidates.map((row) => row.ownershipGroup)).size,
      categoryCount: selectedCategories.filter((category) => categoryCandidateCounts[category] > 0).length,
      categoryCandidateCounts,
      carryoverCandidateCount: candidates.filter((row) => row.carryover).length,
      carryoverCategoryCounts,
      selectedCategoryCoveragePct: selectedCategories.length
        ? Math.round(selectedCategories.filter((category) => categoryCandidateCounts[category]).length /
          selectedCategories.length * 100)
        : null,
      sourceRoleCoveragePct: candidates.length
        ? Math.round(candidates.filter((row) => row.sourceRole !== "unknown").length / candidates.length * 100)
        : 0,
      explicitOwnershipCoveragePct: candidates.length
        ? Math.round(candidates.filter((row) => row.ownershipBasis === "registry_explicit").length /
          candidates.length * 100)
        : 0,
      marketPolicyDeskCoveragePct: candidates.length
        ? Math.round(candidates.filter((row) => row.marketPolicyDesk).length / candidates.length * 100)
        : 0,
      dropped
    },
    limits: [...new Set(fixtures.flatMap((fixture) => fixture.limits || []))],
    candidates
  } : null;

  const qualityRows = rows.map((row) => row.edition.editorialQuality).filter(Boolean);
  const countMap = (field) => Object.fromEntries([...new Set(qualityRows.flatMap((quality) =>
    Object.keys(quality[field] || {})))].map((key) => [key, qualityRows.reduce((total, quality) =>
    total + Number(quality[field]?.[key] || 0), 0)]));
  const editorialQuality = qualityRows.length ? {
    sampleMode: "independent_category_lists",
    evaluatedClusters: qualityRows.reduce((total, row) => total + Number(row.evaluatedClusters || 0), 0),
    machinePass: qualityRows.reduce((total, row) => total + Number(row.machinePass || 0), 0),
    machineHold: qualityRows.reduce((total, row) => total + Number(row.machineHold || 0), 0),
    qualifiedClusters: qualityRows.reduce((total, row) => total + Number(row.qualifiedClusters || 0), 0),
    nearDuplicateHolds: qualityRows.reduce((total, row) => total + Number(row.nearDuplicateHolds || 0), 0),
    selectedAfterGate: mergedIssues.length,
    failuresByRule: countMap("failuresByRule"),
    evidenceModes: countMap("evidenceModes"),
    categoryFunnel: rows.flatMap(({ category, edition }) =>
      (edition.editorialQuality?.categoryFunnel || []).filter((row) => row.categoryId === category))
  } : null;
  const itemCount = rows.reduce((total, row) => total + Number(row.edition.itemCount || 0), 0);
  const overseasShare = itemCount ? Math.round(rows.reduce((total, row) =>
    total + Number(row.edition.overseasShare || 0) * Number(row.edition.itemCount || 0), 0) / itemCount) : 0;
  const merged = {
    ...first,
    itemCount,
    sourceCount: candidateFixture?.metrics.uniqueSourceCount ||
      Math.max(0, ...rows.map((row) => Number(row.edition.sourceCount || 0))),
    overseasShare,
    issues: mergedIssues,
    digestSummary: `선택한 ${selectedCategories.length}개 분야의 고정 상위 목록을 합쳐 같은 사건은 한 번만 남긴 ${mergedIssues.length}개 이슈입니다.`,
    sections: rows.flatMap(({ category, edition }) =>
      (edition.sections || []).filter((section) => section.category === category)),
    publishable: mergedIssues.length >= MIN_ISSUES,
    personalized: true,
    selectedCategories: [...selectedCategories],
    ...(editorialQuality ? { editorialQuality } : {}),
    ...(candidateFixture ? { candidateContract: candidateFixtureReceipt(candidateFixture) } : {})
  };
  if (includeCandidates && candidateFixture) merged.candidateFixture = candidateFixture;
  else delete merged.candidateFixture;
  const carryoverRows = rows.map((row) => row.edition.editorialCarryover).filter(Boolean);
  if (carryoverRows.length) {
    merged.editorialCarryover = {
      ...carryoverRows[0],
      enabled: carryoverRows.some((row) => row.enabled),
      candidateCount: candidateFixture?.metrics.carryoverCandidateCount || 0,
      categoryCounts: candidateFixture?.metrics.carryoverCategoryCounts || {},
      selectedIssueCount: mergedIssues.filter((issue) => issue.metrics?.carryoverUsed).length
    };
  }
  return merged;
}

// How long a collected item stays in the rolling pool before it's eligible for
// eviction (David 2026-07-24: refresh should *accumulate*, not replace — a
// community board's items outlive any single 15-minute poll interval).
// Override with FEED_RETENTION_MS. "me"/"seed" pseudo-sources are exempt —
// a user's own posts and the offline dev dataset never age out this way.
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;

// 절대 신선도 상한 (David 검수 항목 4 → 2026-07-29 2차 강화).
//
// 1차(14일)는 사실상 아무것도 자르지 못했다. 라이브 풀 실측 결과 발행일이 있는
// 글의 최대 나이가 5.0일(중앙 8.9시간, 상위90% 42.4시간)이라 14일 선은 그냥
// 장식이었다 — David 지적: "지금 핫한 걸 올리는데 왜 14일? 훨씬 타이트해야".
//
// 그리고 더 큰 구멍이 있었다: 발행일이 **아예 없는** 글이 53건(inven_hot·tildes·
// ppomppu·bobae·slashdot·etoland·44bits 7개 소스)이라, 이들은 상한을 어떻게
// 정하든 통과했다. 소스 하나가 통째로 신선도 규칙 밖에 있으면 그 규칙은 없는
// 것과 같다.
//
// 그래서 나이를 두 단계로 구한다:
//   1) publishedAt이 있으면 그걸 쓴다.
//   2) 없으면 firstSeenAt(우리가 이 글을 처음 수집한 시각, engine.refresh가
//      아이템에 찍어 준다)을 쓴다. "언제 쓰인 글인지"는 몰라도 "우리가 언제
//      처음 봤는지"는 항상 안다 — 날짜를 안 주는 게시판에서 이건 합리적인
//      나이 대용이고, 무엇보다 **모든 글에 나이가 생겨** 예외가 사라진다.
//
// 상한은 콘텐츠 종류마다 다르다 (David 제안 2026-07-29: "24시간은 뉴스에만
// 해당해도 되지 않을까"). 실측이 이를 뒷받침한다:
//
//   뉴스(구글뉴스 섹션): 중앙 3~10시간, 최대 22.6시간
//     -> 24시간으로 잘라도 한 건도 안 잃는다. 속보성 매체는 그게 맞다.
//   커뮤니티 베스트보드: clien 중앙 42시간
//     -> 베스트50이 며칠에 걸쳐 쌓이는 구조라 24시간이면 통째로 사라진다.
//
// 단, kind만으로는 부족하다. slownews(47h)·outstanding(46h)·ddanzi(38h)는
// 레지스트리상 kind=news지만 속보가 아니라 논평/칼럼 매체라 주기가 느리다.
// 종류로만 자르면 이 셋이 죽으므로 communities.json의 소스별 `maxAgeH`가
// 종류 기본값을 덮어쓴다.
const MAX_AGE_H_NEWS = Number(process.env.FEED_MAX_ITEM_AGE_H_NEWS ?? 24);
const MAX_AGE_H_DEFAULT = Number(process.env.FEED_MAX_ITEM_AGE_H ?? 48);

// 소스별 예외(communities.json의 maxAgeH). 레지스트리를 못 읽으면 빈 맵 —
// 종류 기본값만 쓰고 조용히 계속한다.
let _sourceMaxAge;
function sourceMaxAgeH(sourceId) {
  if (_sourceMaxAge === undefined) {
    try {
      _sourceMaxAge = new Map(
        loadRegistry().filter((c) => Number.isFinite(c.maxAgeH)).map((c) => [c.id, c.maxAgeH])
      );
    } catch {
      _sourceMaxAge = new Map();
    }
  }
  return _sourceMaxAge.get(sourceId);
}

// 소스별 상한 연장은 **신호가 있을 때만** 준다 (David 실사용 제보 2026-08-06).
//
// 실측: 슬로우뉴스 "라이더는 노동자다"가 추천 0 · 댓글 0 · 2일 전인데 두 번째
// 칸에 있었다. 원인은 그 소스의 maxAgeH: 72 오버라이드다 — 발행 빈도가 낮은
// 매체라 24시간이면 아무것도 안 남아서 넣어 둔 것이었다.
//
// David: "뉴스는 2일 전 꺼는 아닌 거 같아. **중요한 내용도 아닌데** 저게."
// 정확한 지적이다. 발행이 뜸한 매체의 **좋은 글**은 오래 남을 값어치가 있지만,
// 아무 반응도 못 받은 글까지 사흘씩 남길 이유는 없다. 연장은 특혜이지
// 무조건 주는 것이 아니다.
function maxAgeFor(item) {
  const base = item.kind === "news" ? MAX_AGE_H_NEWS : MAX_AGE_H_DEFAULT;
  const override = sourceMaxAgeH(item.source);
  if (!Number.isFinite(override)) return base;
  if (override <= base) return override;   // 더 짧게 잡은 것은 그대로 존중한다
  const signal = (item.score || 0) + (item.commentCount || 0) + (item.coverage || 0);
  return signal > 0 ? override : base;
}

// ── 뉴스 성향 슬라이더 (David 2026-07-31: "좌/중/우 같은 비율로, 슬라이드로") ──
//
// 소스별 성향값(lean, communities.json: -2 진보 ~ +2 보수, 근거는 각 leanNote의
// 1차 자료 URL)과 유저 슬라이더(leanBalance, -1 진보쪽 ~ 0 균형 ~ +1 보수쪽)를
// 곱해 라운드로빈 배정 가중치를 만든다.
//
//   승수 = clamp(1 + balance·(lean/2), 0.2, 1.8)
//
// 성질:
//  - balance=0(기본)이면 모든 소스 승수 1 — 성향이 배정에 전혀 개입하지 않고,
//    "같은 비율"은 lean 절대값이 대칭인 소스 구성(-2·-1 vs +1·+2)이 만든다.
//  - 하한 0.2: 슬라이더를 끝까지 밀어도 반대편이 완전히 사라지지 않는다(약 80:20).
//    조사 리스크 3("끝단에서 매체 역산")의 완화이자 필터버블 방지.
//  - lean이 없는 소스(전문지·풍자지·구글뉴스·커뮤니티)는 항상 1 — "분류 안 함"은
//    중립 판정이 아니라 성향축 밖이라는 뜻이므로 슬라이더의 영향을 받지 않는다.
let _sourceLean;
function sourceLeanOf(sourceId) {
  if (_sourceLean === undefined) {
    try {
      _sourceLean = new Map(
        loadRegistry().filter((c) => Number.isFinite(c.lean)).map((c) => [c.id, c.lean])
      );
    } catch {
      _sourceLean = new Map();
    }
  }
  return _sourceLean.get(sourceId);
}


// 이미 저장된 풀에도 적용되는 마지막 관문.
//
// isJunkImage는 수집 시점에 거르지만, 그 전에 들어온 항목은 이미 저장돼 있다
// (2026-08-03 배포 직후 실측: 라이브 풀 79건 중 5건이 알려진 깨진 URL).
// 파서 수정만으로는 기존 사용자 화면이 안 고쳐지므로, 내보낼 때 한 번 더 본다.
// 깨진 사진 대신 사진 없는 카드가 나간다.
function safeImage(url) {
  if (!url) return null;
  try { return isJunkImage(new URL(url)) ? null : url; } catch { return null; }
}

export function briefingAvailableAt(item, sourceMetadata = null) {
  const seen = Number.isFinite(item?.firstSeenAt) ? item.firstSeenAt : NaN;
  const published = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  if (item?.kind === "community" && sourceMetadata?.adapter?.type === "list"
    && Number.isFinite(seen)) return seen;
  const times = [seen, published].filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
}

function briefingTooOld(item, nowMs, sourceMetadata) {
  const cap = maxAgeFor(item);
  if (!(cap > 0)) return false;
  const available = briefingAvailableAt(item, sourceMetadata);
  return Number.isFinite(available) && (nowMs - available) / 3.6e6 > cap;
}

export function briefingTimestampEligible(item, sourceMetadata = null) {
  const published = item?.publishedAt;
  const publishedAt = published == null
    ? NaN
    : typeof published === "number" ? published : Date.parse(published);
  if (Number.isFinite(publishedAt)) return true;
  return sourceMetadata?.adapter?.type !== "rss";
}

function inBriefingWindow(item, now, slotDef, sourceMetadata) {
  const windowMs = (slotDef.windowHours || 12) * 3600 * 1000;
  const authoritativeForeign = isAuthoritativeForeignNewsSource(sourceMetadata?.get(item.source));
  const itemWindowMs = authoritativeForeign
    ? Math.max(windowMs, AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS * 3600 * 1000)
    : windowMs;
  const available = briefingAvailableAt(item, sourceMetadata?.get(item.source));
  return !Number.isFinite(available) || (available <= now && now - available <= itemWindowMs);
}

export function leanMultiplier(sourceId, balance) {
  const lean = sourceLeanOf(sourceId);
  if (!Number.isFinite(lean) || !Number.isFinite(balance) || balance === 0) return 1;
  return Math.max(0.2, Math.min(1.8, 1 + balance * (lean / 2)));
}

// 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 슬라이더 (David 2026-08-02
// "커뮤니티(오락성) 뉴스(소식성)의 비율을 조절하는 좌우 슬라이더, 정치성향
// 슬라이더처럼"). balance: -1 커뮤니티 쪽 ~ 0 균형 ~ +1 뉴스 쪽.
//
// 중간값은 가중치로 조절하고, 양 끝(-1/+1)은 getFeed 공통 관문에서
// 반대 종류를 제외한다. 광고·제휴·내가 쓴 글은 건드리지 않는다.
export function mixMultiplier(item, balance) {
  if (!Number.isFinite(balance) || balance === 0) return 1;
  const kind = item && item.kind;
  let dir = 0;
  if (kind === "news") dir = 1;
  else if (kind === "community") dir = -1;
  else return 1; // ad/affiliate/me/seed 등은 이 축의 대상이 아니다
  return Math.max(0.2, Math.min(1.8, 1 + dir * balance * 0.8));
}

// 이 글의 나이(시간). 발행일이 없으면 우리가 처음 본 시각으로 대체하고,
// 그마저 없으면 null(판단 불가).
export function itemAgeHours(item, nowMs) {
  const p = item.publishedAt;
  if (p != null) {
    const t = typeof p === "number" ? p : Date.parse(p);
    if (Number.isFinite(t)) return (nowMs - t) / 3.6e6;
  }
  const f = item.firstSeenAt;
  if (Number.isFinite(f)) return (nowMs - f) / 3.6e6;
  return null;
}

function tooOld(item, nowMs) {
  const cap = maxAgeFor(item);
  if (!(cap > 0)) return false; // 0/음수 = 상한 해제
  const age = itemAgeHours(item, nowMs);
  if (age == null) return false; // 발행일도 수집시각도 없음 — 판단 불가
  return age > cap;
}

// 정치/종교처럼 기본 숨김인 토픽을 아이템이 갖고 있는데 유저가 아직 켜지 않았다면
// true. "adult"는 FILTERABLE_TOPICS에 없으므로 여기서 절대 걸리지 않는다 — 그 쪽은
function topicsBlocked(item, showTopicsSet) {
  const topics = item.topics || [];
  return topics.some((t) => FILTERABLE_TOPICS.includes(t) && !showTopicsSet.has(t));
}

// Per-source `score` stats (mean/median/count) across the FULL collected
// pool (not just this page) — feeds editorial.js's "압도적 반응형" template
// ("이 소스 평소보다 반응 N배"), so that comparison is against the source's
// actual current range rather than a made-up baseline. Computed once per
// getFeed() call and shared across every item being decorated that call.
// Note: each source's own array includes the item being compared against it
// (there's no cheap way to exclude "self" once this is reduced to
// mean/median), which slightly understates an outlier's true multiple for
// small pools — a conservative bias, never an inflated one.
function sourceScoreStats(items) {
  const bySource = new Map();
  for (const it of items) {
    const src = it.source || "unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(Number.isFinite(it.score) ? it.score : 0);
  }
  const stats = new Map();
  for (const [src, scores] of bySource) {
    const sorted = scores.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
    const mid = n >> 1;
    const median = n ? (n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0;
    stats.set(src, { mean, median, count: n });
  }
  return stats;
}

// 소스별 취향 배정 가중치 (David 검수 항목 5, 2026-07-29).
//
// 문제: 홈 피드는 소스별 라운드로빈이라 **모든 소스가 같은 횟수**를 배정받았다.
// 취향은 각 라운드 안의 순서만 정할 수 있었고 구성 비율은 못 바꿨다. 실측으로
// 게임 취향 유저와 경제 취향 유저 둘 다 정확히 게임 50% / 경제 50%를 받았다 —
// 취향을 골라도 안 고른 쪽이 절반 오는 것이 David가 본 "취향 미반영"이다.
//
// 방식: 각 소스의 현재 후보들에 대한 평균 취향 점수를 구해 [-1,1]로 눌러 담고,
// 가중치 = 1 + W*적합도 로 만들어 roundRobinInterleave에 넘긴다. 가중치는
// [MIN,MAX]로 클램프해 **어떤 소스도 0이 되지 않게** 한다 — handoff.md의
// "소스별 볼륨 균형 유지" 지시와 "다양성 > 개인화" 결정을 지키면서, 취향이
// 구성에 실제로 반영되게 하는 지점이다.
//
// 취향 벡터가 없으면(설문 전 익명 유저) 전부 1을 돌려줘 예전 동작 그대로다.
const TASTE_QUOTA_W = Number(process.env.HOT_TASTE_QUOTA_W ?? 1.0);
const TASTE_QUOTA_MIN = Number(process.env.HOT_TASTE_QUOTA_MIN ?? 0.5);
const TASTE_QUOTA_MAX = Number(process.env.HOT_TASTE_QUOTA_MAX ?? 2.0);

export function sourceTasteWeights(topKBySource, preferences) {
  const weights = new Map();
  if (!preferences) return weights; // 취향 없음 -> 균등 (weightOf 기본 1)

  const raw = new Map();
  for (const [src, list] of topKBySource) {
    if (!list || !list.length) continue;
    let sum = 0;
    // 순수 취향만 — scoreItem을 쓰면 그 안의 인기도/신선도 항 때문에
    // "시끄러운 소스 = 취향에 맞는 소스"가 되어 편중이 되살아난다.
    for (const e of list) sum += tasteScore(e.item, preferences);
    raw.set(src, sum / list.length);
  }
  if (raw.size < 2) return weights; // 비교 대상이 없으면 가중치 의미 없음

  // 소스 간 상대 비교로 정규화 — scoreItem의 절대 스케일에 의존하지 않는다.
  const vals = Array.from(raw.values());
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);
  if (!(spread > 0)) return weights; // 전부 동점 — 취향이 소스를 가르지 못함

  for (const [src, v] of raw) {
    const affinity = Math.max(-1, Math.min(1, ((v - mean) / spread) * 2)); // [-1,1]
    const w = 1 + TASTE_QUOTA_W * affinity;
    weights.set(src, Math.max(TASTE_QUOTA_MIN, Math.min(TASTE_QUOTA_MAX, w)));
  }
  return weights;
}

// Turn a structured reason into a short human label for the "추천 이유" chip.
function reasonLabel(r) {
  switch (r.kind) {
    case "category": return categoryLabel(r.key);
    case "tag": return "#" + r.key;
    case "source": return sourceLabel(r.key) + " 즐겨찾기";
    case "popular": return "인기글";
    case "fresh": return "최신";
    case "explore": return "새로운 탐색";
    default: return r.key;
  }
}

// 공개 지면용 — 아무 토픽도 켜지 않은 상태(기본 숨김 전부 적용)
const EMPTY_TOPICS = new Set();
const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));
export const DEFAULT_EDITORIAL_PREVIEW = ["news", "business", "tech", "humor"];

function hasFinalConsonant(word) {
  const text = String(word || "").trim();
  if (!text) return false;
  const latinToken = text.match(/[a-z]+$/i)?.[0].toUpperCase();
  if (["AI", "API", "IT", "PC", "UI"].includes(latinToken)) return false;
  const last = text[text.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(last)) return "013678".includes(last);
  return /[lmnkptbcdfgszx]$/i.test(last);
}

function withObjectParticle(text) {
  return `${text}${hasFinalConsonant(text) ? "을" : "를"}`;
}

function normalizedCategories(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(list.map((id) => String(id || "").trim()).filter((id) => CATEGORY_IDS.has(id)))];
}

export function resolveEditorialSelection(categories, user = null) {
  const explicit = normalizedCategories(categories);
  const saved = normalizedCategories(user && user.briefingCategories);
  const survey = normalizedCategories(user && user.surveyAnswers && user.surveyAnswers.categories);
  let selectedCategories = explicit;
  let mode = "request";
  if (!selectedCategories.length && saved.length) { selectedCategories = saved; mode = "saved"; }
  if (!selectedCategories.length && survey.length) { selectedCategories = survey; mode = "survey"; }
  if (!selectedCategories.length) { selectedCategories = DEFAULT_EDITORIAL_PREVIEW.slice(); mode = "preview"; }
  return {
    selectedCategories: selectedCategories.slice().sort(),
    mode,
    explicit: mode !== "preview"
  };
}

export function editorialValue(issue) {
  const categoryIds = issue.categoryIds || [];
  const ids = new Set(categoryIds || []);
  const text = [issue.headline, ...(issue.refs || []).map((ref) => ref.title)].join(" ");
  const market = /(금리|채권|환율|달러|원화|코스피|코스닥|증시|주가|주식|지수|S&P|나스닥|실적|영업이익|매출|배당|목표치)/i;
  const international = /(전쟁|공습|미사일|호르무즈|정유시설|무역|관세|제재|공급망|북한군|북중|미군기지|우크라|이란|외교|안보)/;
  const policy = /(대통령|정부|국회|법안|법률|시행령|정책|규제|세금|교육감|지지율|행정)/;
  const weather = /(폭염|태풍|호우|폭설|날씨|기온|열대야|너울|지진|산불|홍수|강진|붕괴|대피|사망)/;
  const health = /(건강|의료|치료|치매|알츠하이머|퇴행성|백신|항체|신약|임상|질환|병원|영양|임신|모체|바이오|감염)/;
  const sportsSafety = /(구장|경기장|관중|낙하|추락|붕괴|사고|부상|안전|대피|사망)/;
  const sportsIntegrity = /(심판|협회|성접대|승부조작|도핑|비리|수사|조사|징계|의혹|논란)/;

  if (ids.size > 1) {
    return {
      lens: "복합 이슈",
      text: "여러 관심 분야에 걸친 사안이라 현재 확인된 사실과 후속 변화를 함께 볼 가치가 있다."
    };
  }

  // 분야가 판단 가치의 주어다. 제목 속 우연한 단어 하나가 다른 분야의
  // 상투문을 가져가면 개인화 설명 자체가 틀어진다.
  if (ids.has("sports")) {
    if (sportsSafety.test(text)) {
      return { lens: "안전·운영", text: "경기장과 관중 안전에 연결되는 사안이라 사고 원인·시설 조치·후속 운영 변화를 확인할 가치가 있다." };
    }
    if (sportsIntegrity.test(text)) {
      return { lens: "운영·신뢰", text: "심판·협회 운영과 경기 신뢰에 연결되는 사안이라 조사 결과와 공식 후속 조치를 확인할 가치가 있다." };
    }
    return { lens: "경기·선수", text: "경기 일정·선수 상태·순위 흐름을 따라가는 데 필요한 맥락이라 결과와 후속 변화를 함께 볼 가치가 있다." };
  }
  if (ids.has("gaming")) {
    return { lens: "출시·플레이", text: "출시·업데이트와 실제 이용자 반응을 구분해 게임 선택과 흐름을 판단하는 데 참고할 가치가 있다." };
  }
  if (ids.has("realestate")) {
    return { lens: "주거·자산", text: "주거비·공급·대출과 보유 판단에 연결되는 흐름이라 적용 대상과 시행 범위를 이어서 볼 가치가 있다." };
  }
  if (ids.has("business")) {
    if (international.test(text)) return { lens: "거시·공급망", text: "원자재·물류·기업 비용과 시장 변동성에 연결될 수 있어 후속 지표와 공식 발표를 함께 볼 가치가 있다." };
    if (market.test(text)) return { lens: "시장·실적", text: "시장 가격과 기업·자산 판단에 연결되는 흐름이라 후속 수치와 원자료를 확인할 가치가 있다." };
    return { lens: "기업·경제", text: "기업 활동과 경기 흐름을 판단하는 현재 맥락이라 실제 수치와 후속 발표를 함께 볼 가치가 있다." };
  }
  if (ids.has("politics")) {
    if (international.test(text)) return { lens: "외교·안보", text: "외교·안보 결정과 국제 관계의 변화를 판단하는 데 필요한 맥락이라 당사국 발표와 후속 조치를 볼 가치가 있다." };
    if (/(선거|투표|경선|당권|정당|후보|민주당|국민의힘)/.test(text)) return { lens: "선거·권력구도", text: "정당 선택과 권력구도의 변화를 보여주는 흐름이라 실제 투표 결과와 후속 입장을 확인할 가치가 있다." };
    return { lens: "정책·의사결정", text: "정책 결정의 방향과 실제 시행 범위를 구분해 시민·시장에 미칠 후속 변화를 볼 가치가 있다." };
  }
  if (ids.has("science")) {
    return { lens: "연구·근거", text: "새 연구가 기존 설명을 얼마나 바꾸는지 판단하려면 원 연구와 검증 범위를 함께 볼 가치가 있다." };
  }
  if (ids.has("tech")) {
    return { lens: "기술·제품", text: "기술 채택과 제품·산업 경쟁의 변화를 따라가는 데 필요한 맥락이라 실제 적용 범위와 후속 발표를 볼 가치가 있다." };
  }
  if (ids.has("auto")) {
    return { lens: "구매·이동", text: "차량 선택·운행 경험과 모빌리티 시장 변화에 연결되는 흐름이라 제원과 실제 이용 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("life")) {
    if (health.test(text)) return { lens: "건강·근거", text: "건강과 생활 판단에 연결되는 정보라 적용 대상·근거 수준·실제 효용을 구분해 볼 가치가 있다." };
    if (weather.test(text)) return { lens: "생활·안전", text: "이동·야외활동·안전 계획에 연결되는 변화라 지역과 시간대별 후속 정보를 확인할 가치가 있다." };
    return { lens: "생활·활용", text: "일상 선택과 실제 활용에 연결되는 흐름이라 조건과 이용 경험을 함께 볼 가치가 있다." };
  }
  if (ids.has("fashion")) {
    return { lens: "제품·스타일", text: "제품과 스타일이 어디서 주목받는지 보여주는 흐름이라 출시 맥락과 실제 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("art")) {
    return { lens: "작품·디자인", text: "작품·전시·디자인의 현재 흐름을 이해하는 데 필요한 맥락이라 창작 배경과 공개 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("culture")) {
    return { lens: "대중문화", text: "대중문화에서 무엇이 반응을 얻고 확산되는지 보여주는 흐름이라 공식 정보와 대중 반응을 구분해 볼 가치가 있다." };
  }
  if (ids.has("humor")) {
    return { lens: "공유·유행", text: "지금 어떤 소재가 빠르게 공유되고 있는지 보여주는 흐름이라 반응의 규모와 맥락을 함께 볼 가치가 있다." };
  }

  // 종합 뉴스만 교차 분야 신호를 제목에서 해석한다.
  if (weather.test(text)) return { lens: "재난·안전", text: "안전과 이동·생활 계획에 직접 연결되는 사안이라 피해 범위와 공식 후속 정보를 확인할 가치가 있다." };
  if (international.test(text)) return { lens: "국제정세", text: "외교·안보와 공급망 변화에 연결되는 사안이라 당사국 발표와 후속 영향을 함께 볼 가치가 있다." };
  if (market.test(text)) return { lens: "경제 흐름", text: "시장과 기업 판단에 연결될 수 있는 사안이라 실제 수치와 후속 보도를 확인할 가치가 있다." };
  if (policy.test(text)) return { lens: "정책·사회", text: "정책·사회 변화의 방향과 실제 시행 범위를 구분해 후속 보도를 확인할 가치가 있다." };
  if (health.test(text)) return { lens: "건강·사회", text: "건강과 공공 판단에 연결되는 정보라 대상과 근거 범위를 확인할 가치가 있다." };
  return { lens: "공공 맥락", text: "사회 흐름에서 무엇이 달라졌는지 파악하는 데 필요한 사건이라 후속 사실과 영향을 함께 볼 가치가 있다." };
}

function enrichDigestIssue(issue, selectedCategories) {
  const categoryIds = issue.categoryIds || [];
  const labels = categoryIds.map(categoryLabel).filter(Boolean);
  const metrics = issue.metrics || {};
  const evidenceMode = metrics.evidenceMode || issue.evidence && issue.evidence.mode;
  const value = editorialValue(issue);
  const heat = [];
  if (evidenceMode === "multiple_feed_observed") heat.push("서로 다른 운영그룹에서 관측됐다");
  else if (evidenceMode === "related_coverage_signal") heat.push("관련 보도 묶음 신호가 확인됐다");
  if (metrics.score > 0) heat.push(`추천 ${Math.round(metrics.score).toLocaleString("ko-KR")}건`);
  if (metrics.comments > 0) heat.push(`댓글 ${Math.round(metrics.comments).toLocaleString("ko-KR")}건`);
  if (!heat.length) heat.push("현재 수집 목록의 상위 후보로 들어왔다");
  const crossObserved = evidenceMode === "multiple_feed_observed";
  const relatedObserved = evidenceMode === "related_coverage_signal";
  const measured = metrics.score > 0 || metrics.comments > 0;
  const communityOnly = metrics.communityOnly === true;
  const weightyCategory = categoryIds.some((id) => WEIGHTY.has(id) || id === "realestate");
  const enriched = {
    ...issue,
    whatHappened: issue.paragraph,
    impactLens: value.lens,
    whyImportant: communityOnly && weightyCategory
      ? "확정된 보도 사실이 아니라 해당 커뮤니티의 관심·논쟁 신호로만 참고할 가치가 있다."
      : value.text,
    whyHot: heat.join(" · ") + ".",
    whyForYou: selectedCategories.length
      ? `${withObjectParticle(labels.join("·") || "관심 분야")} 선택한 오늘판이라 포함했다.`
      : `${labels.join("·") || "현재 관심사"} 흐름을 보여주기 위해 포함했다.`,
    watchNext: crossObserved
      ? "서로 다른 운영그룹이 같은 핵심 내용을 계속 싣는지 다음 판에서 다시 대조한다."
      : relatedObserved
        ? "현재 풀의 다른 피드에서도 같은 사실이 확인되는지 후속 보도를 대조한다."
        : measured
          ? "추천·댓글의 증가 속도와 후속 반응이 유지되는지 다음 판에서 확인한다."
          : "새 근거가 추가되는지 다음 판에서 다시 확인한다.",
    confidence: crossObserved
      ? { code: "multiple_feed_observed", label: "운영그룹 교차 관측", note: "지금핫 수집 풀의 서로 다른 운영그룹에서 관측했다. 법적 독립성이나 사실 확정을 뜻하지 않는다." }
      : relatedObserved
        ? { code: "related_coverage_signal", label: "관련 보도 신호", note: "관련기사 묶음 신호가 있으나 현재 풀에서 직접 확인한 피드는 하나다." }
        : communityOnly
          ? { code: "community_signal", label: "커뮤니티 반응 신호", note: "보도 사실 확인이 아니라 한 커뮤니티의 공개 반응을 관측했다." }
        : measured
        ? { code: "single_source_measured", label: "단일 출처·반응 확인", note: "한 출처의 공개 반응을 확인했다." }
        : { code: "single_source_observed", label: "단일 출처 관측", note: "추가 교차 확인 전의 관측 후보다." }
  };
  return attachEditorialLineage(enriched, { selectedCategories });
}

// ── 새로고침 앵커 연속성 (David 2026-08-08 승인)
// "완전 랜덤으로 바뀌면 이게 맞게 나오는 거 맞나 싶잖아 — 알고리즘의
// 연속성이 느껴져야." 새로고침(cursor=0)은 서빙 즉시 seen을 소비하는
// 구조라 사실상 "다음 페이지"가 되어 화면이 통째로 갈렸다. 직전 첫 화면의
// 상위 앵커를 짧은 창 안에서 유지해 "아까 1위가 아직 1위"가 보이게 한다 —
// 트위터 당겨서-새로고침·레딧/HN 핫 랭킹의 상단 안정 문법. 창은 앵커가
// 처음 잡힌 시각 기준이라(연속 새로고침으로 갱신 안 됨) TTL이 지나면 새
// 1위에게 자리를 내준다. 수치는 실측이 아니라 승인된 UX 선택값.
// `|| 기본값` — 환경변수 오타(NaN)로 기능이 에러 없이 조용히 꺼지는 것을
// 막는다(검수 2026-08-08). 0으로 끄는 용도가 아니라 값 지정용 변수다.
const HOME_ANCHOR_COUNT = Number(process.env.FEED_ANCHOR_COUNT) || 3;
const HOME_ANCHOR_TTL_MS = Number(process.env.FEED_ANCHOR_TTL_MS) || 15 * 60 * 1000;

export class FeedEngine {
  constructor(store, sources) {
    this.store = store;
    this.sources = sources && sources.length ? sources : [new SeedSource()];
    this._cache = null; // collected items cache — the capped, ranked-over view of the pool
    this._briefingContextCache = null;
    this._pool = new Map(); // id -> { item, firstSeenAt } — the rolling accumulation pool
    // 수집 풀을 디스크에 남긴다.
    //
    // ── 왜 (David 2026-08-06 "관리자 페이지 대시보드 로딩시간이 갑자기 엄청 길어졌어")
    // 풀이 메모리에만 있어서, 재시작하면 첫 요청이 **84개 소스를 전부 수집할
    // 때까지 막혔다.** 실측: 컨테이너 시작 00:23:33 → 수집 완료 00:25:59,
    // 2분 26초. 그 사이 들어온 모든 요청(대시보드·앱·크롤러)이 그만큼 기다린다.
    // 오늘 소스를 5곳 늘리고 배포를 여러 번 하면서 David가 계속 그 창에 걸렸다.
    //
    // 풀을 남겨 두면 재시작 직후 **바로** 지난 사이클 결과로 응답하고, 갱신은
    // 뒤에서 돈다. 48시간 보존 상한은 그대로라 오래된 글이 되살아나지 않는다.
    this._poolFile = process.env.FEED_POOL_FILE
      || (store && store.file ? String(store.file).replace(/\.json$/, "") + "-pool.json" : null);
    this._articleArchive = new ArticleArchive(store?.file ? `${store.file}.articles` : null);
    this._clock = store && store.clock ? store.clock : null; // injectable time for tests
    // 카테고리 분류기 (David 2026-07-29 "칼같은 인덱싱"). 프로세스 수명 동안
    // 구글뉴스 섹션 라벨을 계속 흡수한다 — 15분마다 새 제목 수백 건이 공짜
    // 학습 데이터로 들어오므로(classify.js 참고) 서버가 오래 떠 있을수록
    // 정확해진다. 재시작 시 코퍼스가 초기화되지만 첫 refresh에서 곧바로
    // 수백 건을 다시 배우므로 공백은 15분 안에 메워진다.
    this._classifier = new TitleClassifier();
    // 관심사(구글 급상승 검색어) 공급자 — server.js가 주입한다. 없으면 빈 목록이라
    // 관심사 축만 빠지고 브리핑은 그대로 나온다(테스트도 네트워크 없이 돈다).
    this._interestsFn = null;
    // 쿠팡 실연동 productFeed (server.js가 주입, 없으면 null -> 기존 동작 그대로)
    this._productFeed = null;
    // 썸네일 보강기 (enrich.js, server.js가 주입 — David 2026-07-31 "사진
    // 어지간하면 썸네일 다 끌어오게"). 피드에 image가 없는 아이템의 원문
    // og:image URL만 핫링크로 채운다. 테스트/미주입 시 null = 기존 동작.
    this._enricher = null;
    this._learnedIds = new Set(); // 같은 제목을 중복 학습하지 않기 위한 장부
    // v2 전용(David 승인, 2026-08-17) — server.js가 opts.editorialExternalRank로
    // 주입. Map<itemId, rank>이면 briefing()의 buildDigest 호출에 그대로
    // 전달돼 이슈 순위를 shadow 선별 순서로 고정한다. null이면(운영 서버·
    // v1 인프로세스 인스턴스) briefing() 동작이 기존과 바이트 그대로다.
    this.editorialExternalRank = null;
    // 오늘판 카테고리 입력만 교체한다. null이면 기존 수집 카테고리를 그대로 쓰고,
    // server.js가 v2 스냅샷을 주입한 경우에도 personalized briefing에만 적용된다.
    this.editorialCategoryRouter = null;
    this.editorialCategoryRoutingStatus = { mode: "v1", state: "legacy" };
    // 발행 전 동결 풀은 이미 시간 범위를 확정한 재료다. 이 모드에서는 요청
    // 시각으로 다시 자르지 않고, 카테고리 라우팅은 노출 레인에만 적용한다.
    this.editorialPreselectedPool = false;
  }

  _ensureCategoryIntegrityMetadata() {
    if (this._itemRegistryCategories !== undefined && this._dealSources !== undefined
      && this._itemSourceRoles !== undefined && this._itemSourceMetadata !== undefined) return;
    const registry = loadRegistry();
    if (this._itemSourceMetadata === undefined) {
      this._itemSourceMetadata = new Map(registry.map((entry) => [entry.id, entry]));
    }
    if (this._itemRegistryCategories === undefined) {
      this._itemRegistryCategories = new Map(
        registry.filter((c) => c.category).map((c) => [c.id, c.category]));
    }
    if (this._dealSources === undefined) {
      // 핫딜 여부와 기본 분야는 제목 추정값이 아니라 등록부가 정본이다.
      this._dealSources = new Set(registry.filter((c) => c.isDeal).map((c) => c.id));
    }
    if (this._itemSourceRoles === undefined) {
      this._itemSourceRoles = new Map(
        registry.filter((c) => c.sourceRole).map((c) => [c.id, c.sourceRole])
      );
    }
  }

  async _items() {
    // 디스크에 지난 사이클 결과가 있으면 그것으로 먼저 뜬다. 수집은 뒤에서
    // 돌린다 — 첫 사용자가 84개 소스를 기다릴 이유가 없다.
    if (!this._cache) {
      const warm = this._loadPool();
      if (warm) { this.refresh().catch(() => {}); }
      else await this.refresh();
    }
    // 풀 전체에 한 번 건다. 여기가 피드·랭킹·브리핑·공유가 모두 지나가는
    // 유일한 길목이라, 출력 지점마다 따로 거는 것보다 새는 곳이 없다
    // (2026-08-03 1차 시도에서 shareData에만 걸어 피드는 그대로였다).
    // 두 캐시를 각각 확인한다 — 예전엔 _itemGroups 초기화가 _itemLabels 검사
    // 안에 들어 있어서, 한쪽만 설정된 상태(테스트·부분 초기화)에서는
    // _itemGroups가 undefined인 채로 .get()을 부르며 터졌다.
    if (this._itemLabels === undefined) {
      this._itemLabels = new Map(loadRegistry().map((c) => [c.id, c.labelKo || c.label]));
    }
    if (this._itemGroups === undefined) {
      // feedGroup — 다양성 계산에서 여러 소스를 **한 몫**으로 묶는다.
      //
      // 구글뉴스는 섹션마다 소스 하나씩이라 8칸(주요·세계·대한민국·과학기술·
      // 경제·스포츠·연예·건강)을 차지했다. 라운드로빈은 소스 수가 곧 피드
      // 지분이므로, 47개 소스 중 8개가 구글 하나에서 나오면 구글이 17%를
      // 가져간다 — 실측 2026-08-04: 360건 중 104건(29%)이 gnews-*였다.
      // 섹션을 유지해야 카테고리 균형이 사니까 수집은 그대로 두고,
      // **다양성 계산에서만** 한 소스로 센다.
      this._itemGroups = new Map(
        loadRegistry().filter((c) => c.feedGroup).map((c) => [c.id, c.feedGroup]));
    }
    this._ensureCategoryIntegrityMetadata();
    for (const item of this._cache) {
      const registeredCategory = this._itemRegistryCategories.get(item.source);
      const registeredDeal = this._dealSources.has(item.source);
      if (registeredDeal && registeredCategory) {
        if (item.category !== registeredCategory) item.registryCategory = registeredCategory;
        item.category = registeredCategory;
      } else if (registeredCategory && item.registryCategory !== undefined
        && !isReclassifiable(item.source)) {
        // 규칙 변경 전에 저장된 웜캐시도 즉시 복구한다. 다만 제목 사전으로
        // 확정된 분야(예: 경제지의 자동차 시승기)는 유효한 편집 결과라 보존한다.
        const keywordCategory = definiteCategory({
          title: item.title, url: item.url, sourceId: item.source
        });
        if (!keywordCategory) item.category = registeredCategory;
      }
      if (item.image) item.image = safeImage(item.image);
      const g = this._itemGroups.get(item.source);
      if (g) item.feedGroup = g;
      // sourceLabel이 비면 API를 쓰는 쪽(발행 페이지·공유 카드)에서 소스 id가
      // 그대로 노출된다. 2026-08-04 실측: 피드 30건 중 22건이 null이었고,
      // 커뮤니티 순위에 "dcinside"처럼 id가 찍힌 것과 같은 뿌리다.
      if (!item.sourceLabel) item.sourceLabel = this._itemLabels.get(item.source) || item.source;
      const sourceIdentity = operationalSourceIdentity(item);
      item.ownershipGroup = sourceIdentity.ownershipGroup;
      item.ownershipBasis = sourceIdentity.ownershipBasis;

      // 이 글 **옆에** 광고를 붙여도 되는가. 서버는 자기가 끼우는 슬롯에만
      // 이 판정을 쓰고 있었는데, 화면도 따로 광고를 꽂는다(maybeInsertAdfit).
      // 화면 쪽에는 이 정보가 없어서 욕설·정치 글 옆에 제휴 카드가 붙었다
      // (2026-08-05 전수검사). 판정은 한 곳에서 하고 결과를 실어 보낸다 —
      // 화면이 같은 규칙을 다시 구현하면 두 벌이 되어 또 어긋난다.
      item.adUnsafe = adUnsafe(item);

      // 딜 글인가, 그렇다면 어떤 상품군인가 (David 2026-08-05 "이거 중요한 거 같은데").
      // 화면이 이 표시를 보고 **그 글 바로 아래에 그 상품군 광고**를 붙인다.
      // 판정을 여기서 한 번만 하는 이유: 화면이 같은 규칙을 다시 구현하면 두 벌이
      // 되어 언젠가 어긋난다 — adUnsafe에서 이미 겪은 일이다.
      // 우리가 직접 올린 딜은 **제휴 링크**다. 쿠팡 파트너스 대가성 문구가
      // 반드시 붙어야 한다(David 고정 원칙). 커뮤니티에서 온 딜은 남의 글을
      // 소개하는 것이라 이 문구를 붙이지 않는다 — 우리가 수수료를 받는 링크가
      // 아니기 때문이다. 둘을 섞으면 거짓 고지가 된다.
      if (item.via === "ourdeal") {
        item.affiliate = true;
        item.disclosure = COUPANG_DISCLOSURE;
      }
      if (this._dealSources.has(item.source)) {
        item.isDeal = true;
        // 관리자가 직접 고른 상품군이 있으면 그것을 쓴다. 제목 낱말로 추정하는
        // destForDeal보다 사람이 고른 값이 정확하다 — 예전엔 이 값을 무시하고
        // 무조건 추정했다(적대적 검수 2026-08-06).
        const d = item.dest || destForDeal(item.title);
        if (d) item.dealDest = d;
      }
      // 딜이 아니어도 글에서 상품군이 읽히면 실어 둔다 — 그 옆 광고를 그쪽으로
      // 고른다(David 2026-08-06 "이런 알고리즘은 기본적으로 장착해야지").
      // 딜이면 제목만 보고 고른 dealDest가 더 정확하므로 그것을 그대로 쓴다.
      //
      // **뉴스·시사에는 걸지 않는다.** 사전은 낱말만 보므로 사건 기사에도 걸린다 —
      // 실측(2026-08-06): "'엄마, 신발이 벗겨져'…못 돌아온 아들, 거실 쪽으로 새
      // 구두 놔뒀어"에 '구두'가 걸려 패션 광고가 붙었다. 아이가 숨진 기사다.
      // 문맥이 안 맞는 광고보다 **문맥이 맞아 보이는 광고**가 더 나쁘다.
      // 광고 인접 자체가 위험한 글(adUnsafe)도 같은 이유로 제외한다.
      if (item.dealDest) {
        item.adDest = item.dealDest;
      } else if (!item.adUnsafe && !AD_MATCH_OFF.has(item.category)) {
        // **소스가 밝힌 분야를 먼저 본다** (David 제보 2026-08-06:
        // "스니커즈 글이면 패션이 나오고 구분하기 쉬운 건 잘 연결해야지").
        //
        // 실측: 스니커뉴스 글 "Nike는 인기 있는 Tech Runner를 젤리 신발로
        // 전환했습니다"에 **신선식품** 광고가 붙었다 — 번역된 제목에서 "젤리"를
        // 잡은 것이다. 그런데 그 소스는 이미 `sneakers` 태그를 선언하고 있었다.
        // 제목에서 더듬어 맞히는 것보다 소스가 스스로 밝힌 분야가 훨씬 정확하다.
        //
        // 태그가 없을 때만 제목을 본다. 제목은 **제목만** 본다 — 요약까지 넣었더니
        // 본문 아무 데나 있는 낱말이 걸렸다(실측 2026-08-06: FIFA 회장 기사가
        // 신선식품, 연예 미담이 가전으로 갔다).
        const d = destForTags(item.tags) || destForText(item.title);
        if (d) item.adDest = d;
      }

      // 번역된 글에 옮기지 못한 영문 발췌가 붙어 있으면 여기서도 지운다.
      // 수집 단계(translate.js)에서 이미 거르지만, 풀은 48시간을 안고 가므로
      // **규칙을 바꾸기 전에 들어온 글**이 그대로 남는다 — 2026-08-05 배포
      // 직후 라이브에서 2건이 그 상태였다. 길목에서 한 번 더 걸어 두면
      // 오래된 항목도 즉시 정리되고, 나중에 다른 경로가 생겨도 새지 않는다.
      this._cleanItemSummary(item);
    }
    return this._cache;
  }

  // 과거 슬롯 백필은 현재 노출용 소스 상한을 먼저 적용하면 안 된다. 예를 들어
  // 새 글 100건이 들어온 뒤 전날 저녁판을 만들면, 당시 존재했던 글은 48시간
  // 풀에 남아 있어도 현재 상한 밖이라 전부 사라진다. 누적 풀에서 as-of를 먼저
  // 적용하고 그 시점의 최신 글에 소스 상한을 다시 건다.
  async _itemsAsOf(asOfMs) {
    await this._items();
    if (!Number.isFinite(asOfMs) || !this._pool.size) return this._cache || [];

    this._ensureCategoryIntegrityMetadata();
    const kindBySource = new Map(this.sources.map((source) => [source.id, source.kind]));
    const bySource = new Map();
    for (const entry of this._pool.values()) {
      if (!entry || !entry.item) continue;
      const firstSeenAt = Number.isFinite(entry.firstSeenAt)
        ? entry.firstSeenAt
        : Number.isFinite(entry.item.firstSeenAt) ? entry.item.firstSeenAt : NaN;
      const publishedAt = entry.item.publishedAt ? Date.parse(entry.item.publishedAt) : NaN;
      if ((Number.isFinite(firstSeenAt) && firstSeenAt > asOfMs)
        || (Number.isFinite(publishedAt) && publishedAt > asOfMs)) continue;

      const item = {
        ...entry.item,
        firstSeenAt: Number.isFinite(firstSeenAt) ? firstSeenAt : entry.item.firstSeenAt,
        heatHist: Array.isArray(entry.heatHist) ? [...entry.heatHist] : entry.item.heatHist,
        // 현재 시점에 커진 풀 교차관측 값을 과거 판으로 소급하지 않는다. 구글뉴스가
        // 당시 항목에 실어 준 관련기사 묶음만 보존하고, 풀 관측은 아래에서 다시 센다.
        coverage: Number.isFinite(entry.item.relatedCoverage)
          ? entry.item.relatedCoverage
          : /^gnews(?:-|$)/i.test(entry.item.source || "") ? entry.item.coverage || 0 : 0,
        poolCoverage: 0
      };
      if (item.image) item.image = safeImage(item.image);
      const group = this._itemGroups && this._itemGroups.get(item.source);
      if (group) item.feedGroup = group;
      if (!item.sourceLabel) item.sourceLabel = this._itemLabels && this._itemLabels.get(item.source) || item.source;
      const sourceIdentity = operationalSourceIdentity(item);
      item.ownershipGroup = sourceIdentity.ownershipGroup;
      item.ownershipBasis = sourceIdentity.ownershipBasis;
      item.adUnsafe = adUnsafe(item);

      const sourceId = item.source || "unknown";
      if (!bySource.has(sourceId)) bySource.set(sourceId, []);
      bySource.get(sourceId).push(item);
    }

    const capped = [];
    const availableAt = (item) => {
      const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      const firstSeen = Number.isFinite(item.firstSeenAt) ? item.firstSeenAt : NaN;
      return Number.isFinite(published) ? published : Number.isFinite(firstSeen) ? firstSeen : 0;
    };
    for (const [sourceId, items] of bySource) {
      items.sort((a, b) => availableAt(b) - availableAt(a));
      const cap = resolveCap(kindBySource.get(sourceId), {});
      capped.push(...(cap > 0 ? items.slice(0, cap) : items));
    }

    const engagement = (item) => (item.score || 0) + (item.commentCount || 0) * 2;
    const offMain = this._offMainSet();
    const byUrl = new Map();
    for (const item of capped) {
      const key = canonicalContentUrl(item.canonicalUrl || item.url);
      if (!key) { byUrl.set(Symbol(), item); continue; }
      byUrl.set(key, preferCanonicalItem(byUrl.get(key), item, offMain, engagement));
    }
    const items = [...byUrl.values()];
    // 현재 상한 밖에 있던 과거 행도 현재판과 같은 분류 규칙을 거친다. 그렇지
    // 않으면 보배 베스트의 정치 글이 auto, 루리웹 유머판 글이 gaming으로
    // 되살아나 후보 공급과 분야 충족도를 동시에 오염시킨다.
    this._classifyItems(items);
    const sourcesByEvent = new Map();
    for (const item of items) {
      if (item.kind === "community") continue;
      const key = eventKey(item.title);
      if (!key) continue;
      if (!sourcesByEvent.has(key)) sourcesByEvent.set(key, new Set());
      sourcesByEvent.get(key).add(operationalSourceIdentity(item).ownershipGroup);
    }
    for (const item of items) {
      if (item.kind === "community") continue;
      const key = eventKey(item.title);
      const count = key && sourcesByEvent.has(key) ? sourcesByEvent.get(key).size : 0;
      item.poolCoverage = count >= 2 ? Math.min(count, COVERAGE_MAX) : 0;
      item.coverage = Math.max(item.coverage || 0, item.poolCoverage);
    }
    return items;
  }

  // 현재 수집 상한 안의 글과 늦게 복원한 과거 글이 같은 분류 계약을 쓰게 한다.
  // 학습은 최신 수집 사이클에서만 하고, 이 메서드는 이미 학습된 분류기와
  // 설명 가능한 제목·게시판·혼합소스 규칙만 적용한다.
  _classifyItems(items) {
    this._ensureCategoryIntegrityMetadata();
    const registry = loadRegistry();
    // P2-A 분류 이원화 관문(category-policy.js): tier가 재분류 허용 범위를 정한다.
    const tierBySource = new Map(registry.map((source) => [source.id, source.sourceTier]));
    const routingBySource = new Map(registry.map((source) => [source.id, source.categoryRouting]));
    const mixedSources = new Set(registry.filter((source) => source && source.mixed).map((source) => source.id));
    const newsCategories = new Map(registry.map((source) => [source.id, source.category]));
    const isSectionedNews = (item) => {
      if (item.kind !== "news") return false;
      const category = newsCategories.get(item.source);
      return Boolean(category && category !== "news");
    };

    for (const item of items) {
      if (!item || item.source === "seed" || item.source === "me") continue;
      const registeredCategory = this._itemRegistryCategories.get(item.source);
      // Tier-based reclassification only applies to sources with registry policy.
      // In-process/imported sources already carry their explicit upstream category.
      if (!this._itemSourceMetadata.has(item.source)) continue;
      // 이전 사이클의 편집 결과를 다음 판의 원 분류로 쓰지 않는다.
      if (registeredCategory && item.registryCategory !== undefined) item.category = registeredCategory;
      // 교정 감사 기록도 매 사이클 다시 판정한다 — 지난 판의 교정이 관문을
      // 다시 통과하지 못하면 남아 있으면 안 된다.
      if (item.categoryCorrection !== undefined) delete item.categoryCorrection;
      if (this._dealSources.has(item.source)) {
        if (registeredCategory && item.category !== registeredCategory) {
          item.registryCategory = registeredCategory;
          item.category = registeredCategory;
        }
        continue;
      }
      // 혼합 베스트의 등록 분야는 제목 근거가 아니다. 정치 토픽·학습 분류기보다
      // 먼저 중립화해야 보배 정치글이 auto로 남는 식의 분야 자리 탈취를 막는다.
      // 아래 확정 사전은 계속 돌아가므로 실제 자동차·게임·연예 글은 복구된다.
      const mixed = MIXED_BEST_FALLBACK.get(item.source);
      if (mixed && item.category === mixed.registryCategory) {
        item.registryCategory = item.category;
        item.category = mixed.fallback;
      } else if (mixedSources.has(item.source) && item.category !== MIXED_NEUTRAL_CATEGORY) {
        if (item.registryCategory === undefined) item.registryCategory = item.category;
        item.category = MIXED_NEUTRAL_CATEGORY;
      }
      const sectioned = isSectionedNews(item);
      const classificationTitle = item.title;
      const definite = definiteCategory({
        title: classificationTitle,
        url: item.url,
        sourceId: item.source
      });
      const urlDefinite = definiteCategory({ title: "", url: item.url, sourceId: item.source });
      const politicsTopic = (item.topics || []).includes("politics");
      const declarationGuard = sectioned && tierBySource.get(item.source) === "aggregate"
        ? categoryGuardReason(item.category, item.title, item) : null;
      if (isGeneralNewsGuardReason(declarationGuard)) {
        if (item.registryCategory === undefined) item.registryCategory = item.category;
        item.categoryCorrection = {
          from: item.category, to: "news", rule: "aggregate-general-news-guard", reason: declarationGuard
        };
        item.category = "news";
        continue;
      }
      if (politicsTopic && definite !== "science") continue;
      if (UNTRAINED_CATEGORIES.has(item.category) && definite !== "science") continue;

      if (definite && (!sectioned || SECTIONED_NEWS_TITLE_OVERRIDES.has(definite) || urlDefinite === definite)) {
        // P2-A 관문: 번역 제목이 확정 사전 1히트로 UNTRAINED 카테고리(부동산·
        // 패션·예술)에 승격되는 것을 막는다 — 표본 7 계열의 구조적 방어.
        if (!untrainedOverrideAllowed({
          toCategory: definite, title: classificationTitle, translated: isTranslatedTitle(item)
        })) continue;
        if (definite !== item.category) {
          if (item.registryCategory === undefined) item.registryCategory = item.category;
          if (sectioned && tierBySource.get(item.source) === "specialist") {
            // specialist 선언을 제목 확정 사전이 뒤집는 좁은 기존 예외 —
            // 교정이므로 감사 기록을 남긴다.
            item.categoryCorrection = { from: item.category, to: definite, rule: "specialist-title-definite" };
          }
          item.category = definite;
        }
        continue;
      }
      if (sectioned) {
        // P2-A specialist 관문: 소스 선언은 강한 기본값이고, "명백한 의미 충돌"
        // (NB 임계 + 대상 카테고리 전용 사전 신호 2개 이상, category-policy.js)일
        // 때만 교정한다. 통과 못 하면 전부 선언 유지.
        if (tierBySource.get(item.source) === "specialist"
          && this._classifier.trained >= MIN_NB_TRAINING_ROWS) {
          const corrected = specialistCorrection({
            declaredCategory: item.category,
            title: item.title,
            prediction: this._classifier.predict(item.title)
          });
          if (corrected) {
            if (item.registryCategory === undefined) item.registryCategory = item.category;
            item.categoryCorrection = corrected.correction;
            item.category = corrected.category;
          }
        }
        // aggregate 관문(2026-08-13 P2 HOLD 해소): 전문 섹션 선언은 약한
        // prior — NB가 운영 임계 이상 확신하면 재분류한다(전용어 2히트 요구
        // 없음, category-policy.js aggregateReclassification). gnews 종합
        // (선언 news)은 sectioned가 아니라서 여기 오지 않는다 — 기존 경로
        // 무변경.
        if (tierBySource.get(item.source) === "aggregate"
          && routingBySource.get(item.source) !== "declared_section"
          && this._classifier.trained >= MIN_NB_TRAINING_ROWS) {
          // R6(2026-08-14 David HOLD 결함 6): gnews 전문 섹션은 학습 소스이기도
          // 하다 — 이 행을 그대로 predict하면 방금 학습한 자기 라벨을 암기해
          // 관문이 0건이 된다(신선 풀 실측 0/112 = 관문 무효). 학습 라벨 소스면
          // 자기 기여를 뺀 leave-one-out 예측으로 판정한다. 코퍼스는 그대로라
          // specialist·커뮤글 경로 무파급(대안 '학습 제외'는 관문 밖 12건이
          // 흔들려 기각 — R6 실측).
          const trainLabel = TRAIN_LABELS.get(item.source);
          const prediction = trainLabel && typeof this._classifier.predictExcluding === "function"
            ? this._classifier.predictExcluding(item.title, trainLabel.category, trainLabel.weight)
            : this._classifier.predict(item.title);
          const corrected = aggregateReclassification({
            declaredCategory: item.category,
            title: item.title,
            prediction,
            translated: isTranslatedTitle(item)
          });
          if (corrected) {
            if (item.registryCategory === undefined) item.registryCategory = item.category;
            item.categoryCorrection = corrected.correction;
            item.category = corrected.category;
          }
        }
        continue;
      }
      if (mixed || mixedSources.has(item.source)) continue;
      if (isReclassifiable(item.source) && this._classifier.trained >= MIN_NB_TRAINING_ROWS) {
        const predicted = classifyTitle(this._classifier, item.title);
        if (predicted && predicted !== item.category && OVERRIDE_CATEGORIES.has(predicted)) {
          if (item.registryCategory === undefined) item.registryCategory = item.category;
          item.category = predicted;
          continue;
        }
      }
    }
  }

  // 수집 풀 공개 접근자 — 자체 콘텐츠 페이지(커뮤니티 순위/키워드/그룹별
  // 베스트)가 같은 데이터를 본다.
  async pool() {
    // 발행 페이지(커뮤니티 순위/키워드/그룹별 베스트)용 풀.
    // 수집 금지 소스(enabled:false — 디시 등)는 뺀다: 커뮤니티 순위는 소스
    // 이름을 대놓고 싣는 페이지라 여기서 한 번 더 막는다.
    if (this._poolDisabled === undefined) {
      this._poolDisabled = new Set(loadRegistry().filter((c) => c.enabled === false).map((c) => c.id));
    }
    return (await this._items()).filter((i) => !this._poolDisabled.has(i.source));
  }

  // Per-source item counts in the current collected pool (David 2026-07-24
  // adversarial review #5 — "죽은 소스 칩 자동 숨김"). A source can be
  // `enabled` in the registry yet consistently return 0 items in production
  // (e.g. todayhumor's overseas-IP block) — rather than hand-maintaining an
  // enabled/disabled flag for every such case, the source-chip bar hides
  // itself once there's nothing behind it. See server.js's GET
  // /api/communities and public/index.html's chip-filtering.
  // 마지막 수집 사이클의 소스 헬스 판정 (health.js evaluate 결과).
  // 아직 한 번도 갱신하지 않았으면 빈 배열 — 없는 판정을 지어내지 않는다.
  health() {
    return this._health || [];
  }

  // registry mainFeed:false — 수집은 하되 **우리가 편성하는 자리**에서는 뺀다.
  // 통합 피드·브리핑·랭킹이 모두 여기 해당한다. 소스 칩으로 직접 고르면 나온다.
  //
  // 예전엔 통합 피드에만 걸려 있었다. 그래서 David가 "인벤은 메인에서 좀 빼자,
  // 너무 매니악하고 친목에 비주류"라고 해서 껐는데도 브리핑 1·3위가 인벤
  // 메이플스토리였다(2026-08-04 실측). 우리 이름으로 "오늘의 대표"라고 붙이는
  // 자리야말로 이 설정이 가장 필요한 곳이다.
  _offMainSet() {
    if (!this._offMain) {
      this._offMain = new Set(loadRegistry().filter((c) => c.mainFeed === false).map((c) => c.id));
    }
    return this._offMain;
  }

  async sourceCounts() {
    const items = await this._items();
    const counts = {};
    for (const item of items) {
      const src = item.source || "unknown";
      counts[src] = (counts[src] || 0) + 1;
    }
    return counts;
  }

  // Force a re-collection on next read (e.g. after wiring a live source).
  // Only clears the *capped view* — the accumulation pool itself is untouched,
  // so this still merges rather than starting the 48h window over.
  invalidate() {
    this._cache = null;
    this._briefingContextCache = null;
  }

  // Re-collect from all sources and merge into the rolling pool by stableId
  // (a re-collected post keeps its id, so it just updates in place) rather
  // than replacing the pool wholesale — a community board's items live far
  // longer than one poll interval. Pool entries older than FEED_RETENTION_MS
  // (since first seen, not their claimed publish date — many list-adapter
  // items don't reliably carry one) are evicted, then each source is capped
  // again post-accumulation, newest-first, so the pool can't grow unbounded
  // over many refresh cycles even though a single collect() already capped
  // each individual fetch batch.
  // 재진입 가드. 수집 한 사이클은 보통 10초 안쪽이지만 상대 서버가 느린 날은
  // 분 단위로 늘어난다. 그 사이 15분 타이머가 또 돌면 collect가 겹쳐 실행되고
  // 소켓과 워커가 계속 쌓인다. 이미 도는 사이클이 있으면 **그 약속을 함께
  // 기다린다** — 그냥 return하면 await하던 쪽이 갱신 전 데이터를 받는다.
  // 풀을 원자적으로 저장한다(tmp + rename) — 쓰다가 죽어도 반쪽 파일이
  // 남지 않는다. store._persist와 같은 방식이다. 실패는 조용히 넘긴다:
  // 캐시를 못 남기는 것은 느려질 뿐이지 서비스가 멈출 일은 아니다.
  // 풀의 원시 행(아이템 + 최초 관측 + 열기 시계열). 데이터 리포트(④)가 쓴다 —
  // _items()가 주는 것은 캡·정렬을 거친 아이템뿐이라 시계열이 붙어 있지 않다.
  poolRows() {
    return [...this._pool.values()];
  }

  _savePool() {
    if (!this._poolFile) return;
    try {
      const rows = [...this._pool.values()];
      const tmp = `${this._poolFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), rows }));
      fs.renameSync(tmp, this._poolFile);
    } catch { /* 캐시일 뿐이다 */ }
  }

  // 디스크의 풀을 되살린다. 성공하면 true — 호출부가 "지금 응답할 수 있다"로 읽는다.
  //
  // 너무 오래된 파일은 쓰지 않는다. 48시간 보존 상한을 넘긴 풀을 되살리면
  // 첫 화면이 통째로 만료된 글이 되고, 그건 느린 것보다 나쁘다.
  _loadPool({ maxAgeMs = 6 * 3600 * 1000 } = {}) {
    if (!this._poolFile || this._pool.size) return false;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this._poolFile, "utf8")); } catch { return false; }
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) return false;
    // Old pool rows may no longer be suitable for ranking, but their links still work.
    for (const row of parsed.rows) this._rememberArticle(row?.item);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > maxAgeMs) return false;
    for (const row of parsed.rows) {
      if (row && row.item && row.item.id) this._pool.set(row.item.id, row);
    }
    if (!this._pool.size) return false;
    // 지난 사이클의 노출 후보를 그대로 되살린다 — 순위 재계산 없이 바로 뜬다.
    this._cache = parsed.rows.map((r) => r.item);
    this._briefingContextCache = null;
    this.lastRefreshedAt = parsed.savedAt;
    return true;
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._refresh().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _refresh() {
    const { items: freshItems, errors } = await collect(this.sources);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    // firstSeenAt 우선순위: 메모리 풀 > 영속 기록(재시작 생존) > 지금.
    // 재시작마다 리셋되면 오래된 아카이브 글이 "방금 처음 봄"이 되어 신선도
    // 상한을 재통과한다(적대적 검수 P1-a 실측: 2021년 글이 최신 피드에).
    const newlySeen = [];
    const heatUpdates = [];
    for (const item of freshItems) {
      const prior = this._pool.get(item.id);
      const persisted = this.store && this.store.firstSeenOf ? this.store.firstSeenOf(item.id) : undefined;
      const firstSeenAt = prior ? prior.firstSeenAt : (Number.isFinite(persisted) ? persisted : now);
      if (!prior && !Number.isFinite(persisted)) newlySeen.push([item.id, now]);
      // lastSeenAt: 이번 수집에 "아직 보드 목록에 걸려 있음"의 표시.
      // heatHist: 수집 사이클마다 반응량(추천+댓글×2+교차보도×50)을 한 칸씩
      // 기록한 실측 시계열 — 디자인 시그니처 "열기 눈금"(DESIGN.md)의 원천.
      // 14칸(15분 주기 기준 약 3.5시간) 롤링. 날조 금지 원칙상 이 실측이
      // 쌓이기 전(4칸 미만)에는 클라이언트가 눈금을 그리지 않는다.
      const engNow = (item.score || 0) + (item.commentCount || 0) * 2 + (item.coverage || 0) * 50;
      // 이전 시계열: 메모리 풀 > 영속 기록(배포·재시작 생존) > 빈 배열
      const priorHist = (prior && prior.heatHist)
        || (this.store && this.store.heatOf ? this.store.heatOf(item.id) : null)
        || [];
      const heatHist = [...priorHist, engNow].slice(-14);
      heatUpdates.push([item.id, heatHist]);
      // 보강 결과 이월: 수집이 돌 때마다 아이템 객체가 새것으로 바뀌는데,
      // 그때 enrich가 채워둔 image/summary가 통째로 지워지고 있었다(라이브
      // 실측 2026-08-01: 커뮤니티 소스 이미지 0%, 개별 URL로는 정상 추출).
      // 사이클당 보강 상한(120건) 때문에 나머지는 다음 사이클에 원점으로
      // 돌아가 커버리지가 영원히 제자리였다. 이전 값을 물려준다.
      if (prior && prior.item) {
        if (!item.image && prior.item.image) item.image = prior.item.image;
        if (!item.summary && prior.item.summary) item.summary = prior.item.summary;
        // 직전 점수 — ingest가 관성 계산에 쓴다(목록이 매 수집마다 뒤집히지 않게)
        if (Number.isFinite(prior.item.hotScorePrev)) item.hotScorePrev = prior.item.hotScorePrev;
      }
      this._pool.set(item.id, { item, firstSeenAt, lastSeenAt: now, heatHist });
    }
    // 사이클당 1회 점수 확정 — 다음 사이클이 관성 계산에 쓴다.
    // prior 이월이 끝난 뒤여야 이전 점수가 반영된다.
    sourceHotScores(freshItems, now, { persist: true });

    if (newlySeen.length && this.store && this.store.recordFirstSeen) {
      try { this.store.recordFirstSeen(newlySeen, now); } catch {}
    }
    if (heatUpdates.length && this.store && this.store.recordHeat) {
      try { this.store.recordHeat(heatUpdates, now); } catch {}
    }

    // 풀 퇴장 기준은 "처음 본 지 오래됨"이 아니라 "보드 목록에서 내려간 지
    // 오래됨"이다 (David 2026-07-31 "보배는 베스트글의 최신글 동기화 하면 돼").
    // firstSeenAt 기준이던 시절엔 재시작 리셋 덕에 티가 안 났지만, firstSeenAt
    // 영속화(P1-a) 이후로는 보드에 아직 걸려 있는 장수 베스트글이 48h 만에
    // 풀에서 증발한다 — 보드가 걸어둔 글은 보드가 내릴 때까지 우리 풀에도
    // 있어야 게시판 보기가 실제 게시판과 동기화된다.
    const retentionMs = Number(process.env.FEED_RETENTION_MS || DEFAULT_RETENTION_MS);
    for (const [id, entry] of this._pool) {
      const src = entry.item.source;
      if (src === "seed" || src === "me") continue; // never age out a user's own posts or the dev dataset
      if (now - (entry.lastSeenAt ?? entry.firstSeenAt) > retentionMs) this._pool.delete(id);
    }

    const kindBySource = new Map(this.sources.map((s) => [s.id, s.kind]));
    const bySource = new Map();
    for (const entry of this._pool.values()) {
      const src = entry.item.source || "unknown";
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(entry);
    }
    const capped = [];
    for (const [src, entries] of bySource) {
      if (src === "seed" || src === "me") {
        capped.push(...entries.map((e) => e.item));
        continue;
      }
      // newest-first: prefer the item's own publish date, fall back to when
      // we first saw it (covers list-adapter items with no reliable date)
      entries.sort((a, b) => {
        const at = (a.item.publishedAt && Date.parse(a.item.publishedAt)) || a.firstSeenAt;
        const bt = (b.item.publishedAt && Date.parse(b.item.publishedAt)) || b.firstSeenAt;
        return bt - at;
      });
      const cap = resolveCap(kindBySource.get(src), {});
      // firstSeenAt을 아이템에 실어 준다 — 발행일을 아예 주지 않는 소스(실측:
      // inven_hot·tildes·ppomppu·bobae·slashdot·etoland·44bits)도 나이를 갖게
      // 되어 신선도 상한의 예외가 사라진다(engine.js itemAgeHours 참고).
      capped.push(
        ...(cap > 0 && !this.editorialPreselectedPool ? entries.slice(0, cap) : entries).map((e) => {
          e.item.firstSeenAt = e.firstSeenAt;
          e.item.heatHist = e.heatHist;
          return e.item;
        })
      );
    }

    // ---- 교차보도를 **풀 전체에서** 다시 센다 (2026-08-06) -----------------
    //
    // collect()의 중복 제거는 **한 수집 사이클 안에서만** 접는다. 그런데 매체마다
    // 기사를 올리는 시각이 달라서, 같은 사건이 다른 사이클에 들어오면 서로 안 묶인다.
    // 실제로 그랬다 — 접는 자리에서 세도록 고쳐 배포했는데 라이브 뉴스 18건 중
    // 교차보도 값이 있는 것은 여전히 1건이었다(실측 2026-08-06).
    //
    // 풀은 48시간 누적이다. 89개 소스가 그 사이 올린 것을 **다 놓고 봐야**
    // "몇 곳이 다뤘나"가 나온다. 여기가 그 자리다 — 수집 사이클 안이라
    // 요청 밖이고(확정 규칙: 무거운 계산은 요청 밖에서), 풀 크기에 선형이다.
    //
    // 이게 David가 말한 "인용"에 해당하는 신호다: 언론사는 조회수도 추천수도
    // 주지 않지만, 여러 곳이 동시에 다뤘다는 사실은 우리가 직접 셀 수 있다.
    {
      const bySource = new Map();   // eventKey -> Set(operational publisher group)
      for (const it of capped) {
        // 커뮤니티는 매체가 아니다 — 기사 제목을 그대로 따 온 글을 "매체가 다뤘다"로
        // 세면 문장이 거짓이 된다(검수 2026-08-06 P1). 커뮤니티 반향은 별개 신호다.
        if (it.kind === "community") continue;
        const k = eventKey(it.title);
        if (!k) continue;
        let set = bySource.get(k);
        if (!set) { set = new Set(); bySource.set(k, set); }
        const sourceIdentity = operationalSourceIdentity(it);
        it.ownershipGroup = sourceIdentity.ownershipGroup;
        it.ownershipBasis = sourceIdentity.ownershipBasis;
        set.add(sourceIdentity.ownershipGroup);
      }
      for (const it of capped) {
        if (it.kind === "community") continue;
        const k = eventKey(it.title);
        if (!k) continue;
        // **상한을 여기서 건다.** coverage를 쓰는 곳이 다섯인데 그중 셋
        // (categoryTop·briefing weight·digest)이 `coverage × 50`, `× 80`을
        // 상한 없이 쓴다(설계 검토 2026-08-06). 지금까지 안 터진 것은 구글이
        // 주는 값이 사실상 0 아니면 5여서였을 뿐, 안전장치가 있어서가 아니다.
        //
        // 우리가 직접 세기 시작하면서 그 가정이 깨졌다 — 큰 사건을 15곳이
        // 다루면 750~1,600점이 되어 반응량·검색관심 축을 통째로 눌러 버린다.
        // 소비처마다 캡을 걸면 하나 빠뜨리는 게 시간문제라(실제로 셋이 빠져
        // 있다) **기록하는 이 한 곳에서** 막는다.
        const n = Math.min(bySource.get(k).size, COVERAGE_MAX);
        const relatedCoverage = Number.isFinite(it.relatedCoverage)
          ? it.relatedCoverage
          : /^gnews(?:-|$)/i.test(it.source || "") ? it.coverage || 0 : 0;
        // 원시 피드 수가 아니라 운영상 같은 발행사 계열을 접은 그룹 수만 풀
        // 교차관측으로 기록한다. 법적 독립성 판정은 하지 않는다.
        it.relatedCoverage = relatedCoverage;
        it.poolCoverage = n >= 2 ? n : 0;
        it.coverage = Math.max(relatedCoverage, it.poolCoverage);
      }
    }

    // ---- 동일 기사 URL 중복 제거 (2차 검수 T5, 2026-08-01) -----------------
    // 같은 기사가 다른 아이템 id로 두 번 들어와 랭킹에 나란히 서던 문제
    // (실측: 한겨레 매머드 기사 2건이 16·18위, 동일 URL 6초 간격 2건).
    // 추적 파라미터를 벗긴 URL(origin+pathname) 기준으로 반응 큰 쪽을 남긴다.
    {
      // 정규화: 추적 파라미터(utm_* 등)만 벗기고 나머지 쿼리는 보존·정렬한다.
      // origin+pathname만 남기면 안 된다 — 뽐뿌·보배류는 zboard.php?id=…&no=…
      // 처럼 쿼리스트링이 글의 정체라, 게시판 전체가 한 키로 붕괴한다
      // (2026-08-01 라이브 실측: 뽐뿌 18건 -> 2건 회귀를 즉시 롤백한 교훈).
      const eng = (i) => (i.score || 0) + (i.commentCount || 0) * 2 + (i.coverage || 0);
      const offMain = this._offMainSet();
      const byUrl = new Map();
      for (const item of capped) {
        const key = canonicalContentUrl(item.canonicalUrl || item.url);
        if (!key) { byUrl.set(Symbol(), item); continue; }
        byUrl.set(key, preferCanonicalItem(byUrl.get(key), item, offMain, eng));
      }
      if (byUrl.size < capped.length) capped.length = 0, capped.push(...byUrl.values());
    }

    // ---- 카테고리 분류 (David 2026-07-29 "칼같은 인덱싱") ------------------
    // 1) 학습: 라벨이 신뢰되는 소스(classify.js TRAIN_LABELS)의 새 제목만.
    for (const item of capped) {
      const label = TRAIN_LABELS.get(item.source);
      if (!label || this._learnedIds.has(item.id)) continue;
      this._classifier.learn(item.title, label.category, label.weight);
      this._learnedIds.add(item.id);
    }
    // 장부가 무한히 크지 않게 — 단, 통째로 비우면 풀에 살아있는 학습소스 행이
    // 다음 사이클에 재학습돼 카운트가 2배가 되고, LOO(자기학습 제거)는 1회분만
    // 빼서 관문이 조용히 다시 무효화된다(검수 실측: 이중 학습 행의 63%가 자기
    // 라벨 회귀). 그래서 현재 풀에 없는 id만 걷어낸다 — 장부 상한은 풀 크기로
    // 자연 수렴한다. 잔여 구멍(풀을 떠났다 같은 id로 복귀하는 행)은 별건.
    if (this._learnedIds.size > 20000) {
      const alive = new Set(capped.map((it) => it.id));
      this._learnedIds = new Set([...this._learnedIds].filter((id) => alive.has(id)));
    }

    // 2) 현재 노출 상한과 늦은 백필이 같은 분류 파이프라인을 공유한다.
    this._classifyItems(capped);

    // ---- 썸네일·발췌 보강 (og:image/og:description, enrich.js) -------------
    // 주입된 경우에만 동작(서버 전용), 실패·403은 enrich.js가 조용히 부정캐시로
    // 삼킨다. 최신 글부터 처리한다 — 사이클당 상한(maxPerCycle)이 있으므로,
    // 배열 순서(소스별 그룹)대로 돌면 정작 화면에 뜨는 새 글이 뒷순번에 밀린다
    // (라이브 실측 2026-07-31: 첫 페이지 발췌 3/10). 신선도는 핫·최신 양쪽
    // 랭킹의 공통 지배 변수라 "먼저 노출될 글"의 가장 싼 근사다.
    if (this._enricher) {
      const byFreshness = [...capped].sort((a, b) => itemAgeHours(a, now) - itemAgeHours(b, now));
      try { await this._enricher.enrich(byFreshness); } catch {}
      // enricher가 원문 페이지에서 새로 채운 발췌는 **원문 언어 그대로**다.
      // 번역은 수집 단계(TranslatingSource)에서 이미 끝난 뒤라 여기까지 오지
      // 않았다. 그래서 해외 글은 "제목만 한글, 발췌는 영어" 또는 (오늘 규칙으로
      // 영문 발췌를 버린 뒤로는) 빈 칸이 됐다.
      //
      // 구글 웹번역 프록시는 한국에서 막혀 있다(2026-08-05 David 실기기 확인:
      // "This translation service isn't available in your region"). 하지만
      // **글자를 옮기는 엔드포인트는 우리 서버에서 멀쩡히 돈다** — 제목이 이미
      // 그걸로 번역되고 있다. 남의 프록시로 보내는 대신 우리가 옮긴다.
      await this._translateFilledSummaries(capped);
    }

    this._cache = capped;
    this._briefingContextCache = null;
    this._errors = errors;
    this.lastRefreshedAt = now;
    this._savePool();

    // ---- 소스 헬스 판정 (health.js) ---------------------------------------
    // 여기가 사이클마다 반드시 지나는 자리라, 여기서 재지 않으면 "언제부터
    // 죽어 있었나"를 영영 알 수 없다. 판정은 capped(노출 후보)가 아니라
    // pool 전체가 아닌 이번 수집 결과 기준 — 상한에 잘려 0건으로 보이는
    // 착시를 피한다.
    if (this.store && this.store.saveSourceHealth) {
      try {
        const samples = sampleSources(capped, loadRegistry());
        const { report, next } = evaluate(samples, this.store.getSourceHealth(), now);
        this.store.saveSourceHealth(next);
        this._health = report;
        const sum = summarize(report);
        if (sum.down || sum.signalLost) {
          // 로그에도 남긴다 — 대시보드를 아무도 안 봐도 여기서는 보인다.
          const bad = report.filter((r) => r.status === "down" || r.status === "signal-lost");
          console.warn(`[health] 수집중단 ${sum.down} · 신호소실 ${sum.signalLost} / 전체 ${sum.total}` +
            bad.slice(0, 8).map((r) => `\n  - ${r.id}(${r.label}) ${r.status}: ${r.reason}`).join(""));
        }
      } catch (e) { console.warn("[health] 판정 실패:", e.message); }
    }

    // ---- 일별 에디션 스냅샷 (브리핑+화제랭킹, 자체 콘텐츠 아카이브) --------
    // 사이클마다 그날(KST) 키로 덮어쓴다 — 하루의 마지막 기록이 최종판.
    // /briefing/<날짜> 아카이브와 /ranking 주간·월간 집계의 원천 데이터다.
    if (this.store && this.store.saveDailyEdition) {
      try {
        const dateKey = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
        this.store.saveDailyEdition(dateKey, {
          briefing: await this.briefing(),
          ranking: await this.rankingTop(30)
        });
      } catch {
        // 스냅샷 실패가 수집 자체를 죽여선 안 된다 — 다음 사이클에 재시도된다
      }
    }
    // memory visibility: the pool can only grow across a 48h window, not forever —
    // this is the number to watch if that ever needs revisiting.
    console.log(`[feed] pool: ${this._pool.size} accumulated (${Math.round(retentionMs / 3.6e6)}h retention) -> ${capped.length} after per-source cap`);
    return { count: capped.length, errors, poolSize: this._pool.size };
  }

  // Periodically update the DB from its sources ("정기적으로 찾으면서 db 업데이트").
  // Returns a stop function; the interval is unref'd so it never blocks exit.
  // 기동 직후 **한 번 바로 돌고** 그 다음부터 주기로 돈다.
  //
  // 2026-08-07 실측으로 잡은 사고: setInterval만 걸어 두면 재시작할 때마다
  // 15분(FEED_REFRESH_MS=900000)을 **처음부터 다시** 기다린다. 배포 간격이
  // 그보다 짧으면 수집이 **한 번도 돌지 않는다.**
  //
  // 그날 라이브: 풀 저장 시각이 97분째 그대로였고 컨테이너 로그에 수집 줄이
  // 한 줄도 없었다(기동 로그 3줄이 전부). 그날 배포를 12번 넘게 했다.
  // staging.mjs 주석에 "수집이 끝나기 전에 재배포로 컨테이너가 재시작되기를
  // 반복했다"고 적어 뒀는데, 실제 구조는 그보다 나빴다 — 끝나기 전에 끊긴 게
  // 아니라 **시작조차 안 했다.**
  //
  // 첫 수집을 지연 없이 돌리면 배포가 잦아도 매 배포가 곧 수집 기회가 된다.
  // 실패는 삼킨다(예전과 같다) — 한 번 실패해도 다음 주기가 온다.
  startAutoRefresh(intervalMs = 15 * 60 * 1000) {
    this.stopAutoRefresh();
    // 이벤트 루프가 한 바퀴 돈 뒤에 시작한다. 생성자에서 곧바로 부르는
    // 호출부가 있어, 동기적으로 refresh를 시작하면 아직 배선이 안 끝난
    // 상태(_enricher·_translateText 등)로 첫 사이클이 돈다.
    // 실패를 **로그로 남긴다.** 예전엔 catch(() => {})로 통째로 삼켰다.
    // 2026-08-07 라이브에서 수집이 111분간 멈췄는데 컨테이너 로그가 3줄뿐이라
    // 무엇이 잘못됐는지 알 길이 없었다 — 조용한 실패는 없는 실패가 아니라
    // **진단할 수 없는 실패**다. 삼키는 동작(다음 주기가 온다)은 그대로 두고
    // 흔적만 남긴다.
    const run = (why) => this.refresh().then(
      () => {},
      (e) => console.warn(`[feed] refresh 실패 (${why}):`, (e && e.stack) || e)
    );
    const kick = setTimeout(() => {
      console.log("[feed] 기동 직후 첫 수집 시작");
      run("첫 수집");
    }, 0);
    if (kick.unref) kick.unref();
    this._timer = setInterval(() => run("주기"), intervalMs);
    if (this._timer.unref) this._timer.unref();
    return () => this.stopAutoRefresh();
  }

  stopAutoRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // Return the next batch for a user. `cursor` is an opaque number = how many
  // items already consumed this session; used only as a deterministic seed so
  // repeated identical requests are stable.
  //
  // `source`: when set, scopes the feed to a single community/news source —
  // the "소스별 보기" chip bar. This is a jagei-style board view, not a taste
  // feed, so it skips personalized ranking (and the mute filter, since picking
  // the chip is the opposite of muting it) in favor of latest+공개화제성 order.
  async getFeed(userId, { limit = 10, cursor = 0, markSeen = true, source = null, sort = "hot", category = null } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);
    // editorial.js context: per-source score stats over the whole collected
    // pool (see sourceScoreStats above), so the "outlier vs this source's
    // usual range" note template has something real to compare against.
    const editorialSourceStats = sourceScoreStats(items);

    // 19금 게이트: 성인인증 + 토글이 모두 켜져 있을 때만 성인 콘텐츠를 후보에 포함.
    // 서버에서 강제하므로 인증되지 않은 사용자에게는 어떤 경우에도 노출되지 않는다.
    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
      // 통합 피드에서만 제외하는 소스(registry mainFeed:false).
      // 삭제가 아니라 "메인에 안 올림"이다 — 칩으로 고르면 볼 수 있다.
      const offMain = this._offMainSet();
    const showTopics = new Set(user.showTopics || []);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    const mixBalance = Number.isFinite(user.mixBalance) ? user.mixBalance : 0;

    let unseen;
    let collabBoosts = new Map();
    // 홈 경로의 passesGates를 앵커 재검증이 그대로 쓰도록 승격해 둔다
    // (관문 두 벌 금지 — 앵커용 관문을 따로 만들지 않는다).
    let anchorGate = null;
    // 취향 지분 보장이 끌어올 후보. **인스턴스 필드로 두면 안 된다** —
    // 아래에 await가 끼어 있어 다른 요청이 그 사이에 덮어쓴다.
    let tasteBase = null;
    if (source) {
      // "submit" is a pseudo-source: every user-submitted out-link, grouped by
      // provenance (via) rather than by the item's own out-link domain (which
      // varies per submission, so there's no single registry source id to
      // filter on).
      const matchesSource = (i) => (source === "submit" ? i.via === "submit" : i.source === source);
      // 게시판 보기는 tooOld를 적용하지 않는다 (David 2026-07-31: "보배는
      // 베스트글의 최신글 동기화 하면 돼" — 실측: 보배 베스트는 며칠 누적
      // 리스트라 48h 상한이 대부분을 잘라 8개만 남았다). 여기의 신선도
      // 권위는 게시판 자신이다: 보드가 목록에서 내리면 풀 퇴장(lastSeenAt
      // retention)으로 함께 사라진다. 홈 피드의 상한은 그대로.
      const pool = items.filter(
        (i) =>
          matchesSource(i) &&
          // 소스와 카테고리를 둘 다 고르면 둘 다 좁힌다 — 예전엔 category가
          // 조용히 무시돼 "클리앙의 기술 글"이 "클리앙 전체"로 나왔다(감사 P2).
          (!category || i.category === category) &&
          !disabled.has(i.source) &&
          !topicsBlocked(i, showTopics)
      );
      // Same hot-curation pipeline as the home feed (2026-07-24 hot-curation
      // v1) — HN-gravity time decay + robust-z/percentile normalization +
      // Bayesian shrinkage — applied to the whole filtered pool as one flat
      // group (this view is already scoped to a single source/provenance, so
      // there's nothing to group further; "submit"'s pool spans many out-link
      // domains but was already scored uniformly before this change too).
      // This is what stops a stale-but-still-#1-ranked RSS item from sitting
      // atop a board's own view forever, same as the home feed below.
      const ranked = sourceHotScores(pool, now)
        .map((s) => ({ item: s.item, score: s.hotScore }))
        .sort((a, b) => b.score - a.score);
      // 게시판 보기는 "그 게시판의 현재 베스트 전체"다 — 홈 피드처럼 seen을
      // 숨기면 홈에서 스크롤한 만큼 게시판이 비어 보인다(David 실측 2026-07-31:
      // 보배 8개·클리앙 14개만 노출). 게시판을 다시 들어가면 같은 베스트가
      // 다시 보이는 게 게시판의 문법이므로 seen 필터 없이 오프셋 페이지네이션
      // (아래 fresh 계산에서 cursor 슬라이스)으로 전체를 훑게 한다.
      unseen = ranked;
    } else {
      // Unseen is filtered in up front (not after ranking, as the old
      // hotGate/rankItems path did) so the round-robin/min-gap diversity
      // guarantees below hold on *every* page of the infinite scroll, not
      // just a fresh user's first load.
      // 핫딜 숨기기 (David 2026-08-06). 기본은 보임이라 showTopics에
      // "nodeal"이 **있을 때** 숨긴다 — 정치·종교와 방향이 반대다.
      //
      // **핫딜 탭에는 적용하지 않는다.** 검수(2026-08-06 P1)가 실행으로
      // 재현했다: 숨기기를 켠 사람이 정렬바의 핫딜 탭을 눌러도 0건이었다.
      // 숨기기의 뜻은 "홈 피드에서 안 보고 싶다"이지 "탭을 눌러도 안 보겠다"가
      // 아니다 — 탭을 누른 것 자체가 지금 보겠다는 명시적 의사다.
      // 기능을 줄이지 않는다(확정 규칙 c).
      const hideDeals = showTopics.has(NO_DEAL_TOPIC) && sort !== "deals";
      // 관문을 술어 하나로 뽑는다 — 아래 "본 글 재활용" 폴백이 같은 관문을
      // 그대로 써야 한다(관문 두 벌 금지).
      const passesGates = (i) =>
        // 커뮤만/뉴스만은 핫·최신·재사용·앵커·추가 후보에 같은 관문을 적용한다.
        // 핫딜 탭과 위의 명시 소스 보기는 해당 목록을 직접 선택한 의사를 따른다.
        (sort === "deals" || !((mixBalance === -1 && i.kind === "news") ||
          (mixBalance === 1 && i.kind === "community"))) &&
        !(hideDeals && i.isDeal === true) &&
        !muted.has(i.source) &&
        !disabled.has(i.source) &&
        // mainFeed:false — 수집은 하되 통합 피드에서만 뺀다. 소스 칩으로
        // 직접 고른 경우(source 지정)에는 그대로 나온다.
        !(offMain.has(i.source) && !source) &&
        !topicsBlocked(i, showTopics) &&
        (!category || i.category === category) &&
        !tooOld(i, now);
      anchorGate = passesGates;
      const base = items.filter((i) => passesGates(i) && !seen.has(i.id));
      // ── 안 본 글이 하나도 없으면 본 글을 다시 내보낸다 (2026-08-07 장애)
      //
      // 무한 재로드 버그가 돌 때마다 markSeen을 남겨, 탭을 열어뒀던 사용자는
      // 풀 전체가 seen이 됐다 — 빈 피드에 "새 화제글을 모으는 중"만 남는다.
      // 버그가 아니어도 헤비유저는 언젠가 같은 벽에 닿는다. **빈 화면은
      // 이탈이고, 본 글 재노출은 게시판의 문법이다**(소스 보기가 seen을 안
      // 거르는 것과 같은 이유). 점수순으로 다시 내보내고 seen은 다시 찍지
      // 않는다.
      if (!base.length) {
        // 다양성 배치를 반드시 태운다. 처음엔 점수순 그대로 내보냈더니
        // 글 많은 소스(뽐뿌 70여 건)가 통째로 쏟아졌다(David 실측:
        // "싹다 뽐뿌만 나와"). diversify가 홈과 같은 소스 연속 제한을 건다.
        const recycled = diversify(
          items.filter(passesGates)
            .sort((a, b) => (b.hotScorePrev || 0) - (a.hotScorePrev || 0))
            .map((i) => ({ item: i, score: i.hotScorePrev || 0 }))
        ).map((r) => r.item);
        const page = recycled.slice(cursor, cursor + limit);
        return {
          items: page.map((i) => this._decorate(i, 0, user)),
          cursor: cursor + page.length,
          // 검수(2026-08-08)가 잡은 기존 결함: 클라이언트는 nextCursor를 읽는데
          // 이 응답만 cursor로 내보내 undefined → 0으로 접혀 같은 재활용
          // 페이지가 무한 반복됐고, 카드 중복 방지도 없어 같은 카드가 계속
          // 쌓였다. 이름을 맞춰 페이지가 전진하게 한다.
          nextCursor: cursor + page.length,
          exhausted: cursor + page.length >= recycled.length
        };
      }
      // ── 화제성 신호가 없는 글은 **뒤로 민다** (컷이 아니라 강등) ──────
      //
      // 실측(2026-08-04): 핫 첫 30건 중 16건이 추천 0 · 댓글 0 · 교차보도 0.
      // 7위부터는 사실상 신호 없는 글이 채우고 있었다.
      //
      // 하드 컷을 걸어 봤더니 "모든 활성 소스가 최소 한 번은 나온다"는 다양성
      // 계약이 깨졌다(테스트 2건 실패). 지금 26개 소스가 파서 고장으로 추천수를
      // 0으로 내보내고 있어서, 신호로 자르면 피드가 4개 소스로 쪼그라든다 —
      // 원인(파서)을 안 고치고 증상(0점)으로 자르면 더 나빠진다.
      //
      // 그래서 자르지 않고 순서만 내린다. 신호 있는 글이 먼저 나가고, 신호
      // 없는 글은 그 뒤에 남는다. 파서를 복구하면 이 강등은 저절로 무의미해진다.
      const pool = base;
      // 취향 지분 보장이 끌어올 후보. **여기서 다시 거르지 않는다** —
      // base가 이미 뮤트·차단·정치·성인·신선도 관문을 다 지난 목록이다.
      // 관문을 두 벌로 두면 언젠가 한쪽만 고쳐져 뒤로 샌다(⑤ 검수 2026-08-06에서
      // 관련글이 정확히 그랬고, 이 자리에서도 같은 실수를 한 번 냈다 —
      // 뮤트한 소스가 취향 보장 경로로 되돌아와 테스트가 잡았다).
      tasteBase = base;

      // "게시판별 핫 + 다양성 라운드로빈" (David 2026-07-24 redesign). Every
      // active source is already a community's own best/hot board (see
      // ingest.js's rankBySource header comment for why even a 0-engagement
      // RSS source still has a meaningful hot rank — its own collection
      // order). This: (1) ranks each source's items hot-first, (2) keeps only
      // each source's top HOT_PER_SOURCE hottest, (3) interleaves round-robin
      // across sources so the stream alternates boards instead of one board's
      // list dominating. Personalization only breaks ties *within* a round —
      // diversity wins over taste here by design ("다양성 > 개인화").
      collabBoosts = collaborativeBoosts(this.store, userId);
      // hotScore (2026-07-24 hot-curation v1, ingest.js's rankBySource/
      // sourceHotScores) is now each source's internal sort key — HN-gravity
      // time decay + per-source robust-z/percentile normalization + Bayesian
      // small-sample shrinkage, so a stale-but-still-rank-0 RSS item can no
      // longer win its source's top-K cut just because nothing displaced it.
      const rankedBySource = pool.length ? rankBySource(pool, now) : new Map();
      const seed = cursor + 1;

      if (sort === "deals") {
        // ── 핫딜 모아보기 (David 2026-08-06) ──
        // "설정에 핫딜 모아보기 버튼 하나 만들자. 누르면 제품 판매 딜만
        //  관심도 최신도 적절한 순으로 배열되게. 그리고 여기에 광고 진짜
        //  적절하게 잘 배치하고."
        //
        // 통합 피드의 딜 상한(capDeals)·보장(ensureDealShare)은 여기서 쓰지
        // 않는다 — 딜만 보러 온 화면이다. 다양성 인터리브도 걸지 않는다:
        // 어느 게시판에 올라왔는지보다 무엇을 얼마에 파는지가 중요하다.
        const dealPool = pool.filter((i) => i.isDeal === true);
        // **우리가 직접 올린 딜을 맨 앞에 둔다.**
        //
        // dealRank는 반응(추천·댓글)을 재는데 우리 딜은 우리가 고른 것이라
        // 0에서 시작한다 — 뽐뿌 핫딜과 같은 잣대로 재면 여기서도 뒤로 밀린다
        // (실측 2026-08-06: 12칸 안에 한 건도 못 들었다).
        // 핫딜 모아보기는 **우리 물건을 파는 자리**다. 우리 딜끼리는 최신순으로,
        // 그 뒤에 커뮤니티 딜을 반응·신선도 순으로 잇는다.
        const ourList = dealPool.filter((i) => i.via === "ourdeal")
          .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
          .map((item) => ({ item, score: 1e9 }));
        const rivalList = dealPool.filter((i) => i.via !== "ourdeal")
          .map((item) => ({ item, score: dealRank(item, now) }))
          .sort((a, b) => b.score - a.score);
        const orderedDeals = [...ourList, ...rivalList];
        this._lastSelectMeta = null;
        const dealFresh = orderedDeals.slice(cursor, cursor + limit);
        const dealBatch = dealFresh.map((r) =>
          this._decorate(r.item, r.score, user, { now, sourceStats: editorialSourceStats.get(r.item.source) })
        );
        if (markSeen && dealBatch.length) this.store.markSeen(userId, dealBatch.map((b) => b.id));
        // 광고를 조금 촘촘하게 낸다. 딜을 보러 온 사람은 이미 살 마음으로
        // 읽고 있고, 각 딜의 상품군(dealDest)에 맞춘 배너가 붙는다 —
        // 문맥이 맞는 자리라 같은 밀도라도 성가심이 덜하고 값은 더 나간다.
        // 그래도 첫 두 칸은 콘텐츠로 둔다(광고부터 보이면 광고판이 된다).
        const dealDisplay = this._monetize(userId, user, dealBatch, cursor, false,
                                           { every: 5, skipFirst: 2 }).items;
        return {
          items: dealDisplay,
          nextCursor: cursor + dealBatch.length,
          exhausted: dealBatch.length < limit,
          pageMeta: null,
          phase: feedPhase(specializationLevel(user.preferences, user.feedbackCount)),
          level: specializationLevel(user.preferences, user.feedbackCount),
          feedbackCount: user.feedbackCount
        };
      }

      if (sort === "latest") {
        // ── 최신순: 시간버킷 × 소스 인터리브 (#12, ingest.js latestInterleave) ──
        // 2026-08-01 David 승인: 완전 중립 -> "약한 취향 반영". 시간 질서
        // (버킷 순서)는 절대 유지하고, 같은 버킷 안에서만 취향 카테고리
        // 소스가 먼저 나온다. 명시 회피 카테고리는 홈과 일관되게 제외.
        // 노출 이력·lean 슬라이더는 여전히 미개입.
        const latestPersonalized = Boolean(user.surveyed || (user.feedbackCount || 0) > 0 || user.warmStarted);
        const { picked: lp, hated: lh } = latestPersonalized
          ? categorySets(user.preferences, rankParams())
          : { picked: new Set(), hated: new Set() };
        const latestPool = lh.size ? pool.filter((i) => !lh.has(i.category)) : pool;
        const entries = latestPool.map((i) => ({
          item: i,
          ageH: itemAgeHours(i, now),
          prefer: lp.has(i.category) ? 1 : 0
        }));
        const orderedLatest = latestInterleave(entries);
        this._lastSelectMeta = null;
        const latestFresh = orderedLatest.slice(0, limit).map((item) => ({ item, score: 0 }));
        const latestBatch = latestFresh.map((r) =>
          this._decorate(r.item, r.score, user, { now, sourceStats: editorialSourceStats.get(r.item.source) })
        );
        if (markSeen && latestBatch.length) {
          this.store.markSeen(userId, latestBatch.map((b) => b.id));
          if (this.store.recordSourceExposure) {
            this.store.recordSourceExposure(userId, latestFresh.map((r) => diversityKey(r.item)));
          }
        }
        // 위 홈 피드와 같은 이유로 사용자 단위 차단을 걷어냈다 — 브랜드 안전은
        // injectSlots의 adUnsafe(글 단위)가 지킨다.
        const latestDisplay = this._monetize(userId, user, latestBatch, cursor, false).items;
        return {
          items: latestDisplay,
          nextCursor: cursor + latestBatch.length,
          exhausted: latestBatch.length < limit,
          pageMeta: null,
          phase: feedPhase(specializationLevel(user.preferences, user.feedbackCount)),
          level: specializationLevel(user.preferences, user.feedbackCount),
          feedbackCount: user.feedbackCount
        };
      }

      const minGap = Number(process.env.HOT_MIN_GAP ?? 1);
      const exposure = this.store.sourceExposureFor ? this.store.sourceExposureFor(userId) : {};
      const balance = Number.isFinite(user.leanBalance) ? user.leanBalance : 0;

      // "개인화 유저"의 판별: user.preferences는 createUser가 빈 벡터를 만들어
      // **항상 truthy**다 — 진짜 기준은 취향 신호가 실제로 존재하는가이다
      // (설문 완료, 피드백 이력, 브라우징 워밍업 중 하나).
      const personalized = Boolean(user.surveyed || (user.feedbackCount || 0) > 0 || user.warmStarted);
      if (personalized) {
        // ── 골격 v2: 아이템 경쟁 + 다양성 제약 (rank.js, docs/redesign-rank.md) ──
        //
        // 예전 라운드로빈은 조직 원리가 "소스 순번"이라 취향이 구성에 개입할
        // 수 없었다(페르소나 실측: 정반대 취향 6명의 첫 페이지가 동일). 이제
        // 글 하나하나가 (화제성 + 취향)으로 전역 경쟁하고, 다양성(소스 상한·
        // 연속 금지·노출 이력)은 제약조건으로 내려간다.
        //
        // topPerSource 컷 없이 풀 전체가 후보다 — 소스 내 7위 이하도 취향에
        // 맞으면 도달 가능(예전 구조의 영구 불가시 결함 해소).
        const entries = [];
        for (const list of rankedBySource.values()) for (const e of list) entries.push(e);
        const params = rankParams();
        const { picked, hated } = categorySets(user.preferences, params);
        const cands = entries.map((e) => ({
          item: e.item,
          // 두 슬라이더 모두 hot에 승수로 — 라운드로빈 가중치의 v2 대응물.
          // 축이 달라서(뉴스 내부 성향 / 뉴스↔커뮤 비율) 곱해도 서로를 상쇄하지 않는다.
          hot: (e.hotScore ?? 0)
            * leanMultiplier(e.item.source, balance)
            * mixMultiplier(e.item, mixBalance),
          taste: Math.tanh(tasteScore(e.item, user.preferences) / 2),
          collab: collabBoosts.get(e.item.id) || 0
        }));
        const sel = selectDiverse(cands, {
          limit, minGap, exposure, firstPage: cursor === 0, picked, hated,
          // 비율 슬라이더는 점수(위 mixMultiplier)와 쿼터(여기) 양쪽에 건다 —
          // 점수만으로는 소스 상한에 막혀 구성이 안 바뀐다(rank.js capFor 주석).
          mixBalance
        }, params);
        this._lastSelectMeta = { shortfall: sel.shortfall, bannedHatedCount: sel.bannedHatedCount };
        unseen = sel.picks.map((item) => ({
          item,
          score: scoreItem(item, user.preferences, { now, seed, collabBoosts, explore: 0 })
        }));
      } else {
        // ── 익명: 기존 라운드로빈 그대로 (회귀 0 보증) ──
        const topK = topPerSource(rankedBySource);
        const scoreFn = (item, rank, hasSignal, hotScoreVal) => hotScoreVal ?? 0;
        const weights = new Map();
        if (balance !== 0) {
          for (const src of topK.keys()) {
            const m = leanMultiplier(src, balance);
            if (m !== 1) weights.set(src, m);
          }
        }
        const interleaved = roundRobinInterleave(topK, { minGap, scoreFn, exposure, weights });
        this._lastSelectMeta = null;
        unseen = interleaved.map((item) => ({ item, score: 0 }));
      }
    }
    // diversify so a page isn't dominated by one source/category (a no-op
    // when every candidate already shares the same `source`). For the home
    // feed (no `source`), skip it: the round-robin interleave above already
    // produced a hard-guaranteed diverse order, and re-running the softer MMR
    // pass here would only undo that structure for no benefit.
    // 소스 보기: seen 필터가 없으므로 cursor를 진짜 오프셋으로 쓴다.
    // 홈: seen 기반 페이지네이션 그대로(항상 앞에서 limit개).
    // ── 딜 조정은 **페이지를 자르기 전에** 한다.
    //
    // 처음엔 잘라 낸 페이지에서 딜을 덜어냈다. 그러면 한 페이지가 limit보다
    // 짧아지고, 호출부는 그것을 "풀 소진"으로 읽어 무한스크롤을 멈춘다.
    // 실기기(David 2026-08-06): "밑으로 내리니까 '새 화제글을 모으는 중'이라고
    // 뜨고 더 글이 안 떠 한참 동안." 뒤에서 채우려 해도 후보 목록 자체가
    // limit 길이라 채울 것이 없었다(실측: unseen 12칸).
    //
    // 후보 목록에서 먼저 조정하고 그다음에 자르면, 페이지는 늘 꽉 찬다.
    // 통합 피드에만 적용한다 — 소스 칩으로 한 게시판을 고른 사람에게는
    // 그 게시판을 그대로 보여 준다.
    // 딜을 숨긴 사람에게는 딜 지분 보장도 하지 않는다 — 후보에서 뺐는데
    // 보장이 다시 끌어오면 숨기기가 안 통한다(취향 지분에서 겪은 것과 같은 종류).
    const hideDealsNow = new Set(user.showTopics || []).has(NO_DEAL_TOPIC) && sort !== "deals";
    if (!source && !category && unseen.length && !hideDealsNow) {
      const scoreOf = new Map(unseen.map((r) => [r.item.id, r.score]));
      const list = unseen.map((r) => r.item);
      const inList = new Set(list.map((i) => i.id));
      // **관문을 지난 목록에서만 끌어온다.** 예전엔 this._items()(원본 전체)를
      // 써서 뮤트·관리자 차단·오프메인·토픽차단·신선도를 전부 우회했다 —
      // 뮤트한 소스의 딜이 그대로 보였고, 관리자가 막은 소스도 딜 경로로 샜다.
      // tasteBase는 base(모든 관문 통과)와 같은 목록이다.
      const dealPool = (tasteBase || [])
        .filter((i) => i.isDeal === true && !inList.has(i.id) && !seen.has(i.id));
      const withShare = ensureDealShare(list, dealPool, { is: (i) => i.isDeal === true });
      const balanced = capDeals(withShare, { is: (i) => i.isDeal === true });

      // ── 고른 취향이 피드의 주인이 되게 (2026-08-06)
      //
      // 실측: 스포츠만 고른 사용자의 피드가 sports 32% · humor 45%였다.
      // 점수 경쟁에 맡기면 추천 수가 큰 커뮤니티가 이긴다(LinkedIn이 말하는
      // 캘리브레이션 실패). X의 For You가 In-Network 지분을 아예 정해 두는 것과
      // 같은 방식으로, 고른 카테고리에 최소 지분을 준다.
      //
      // **재료가 없으면 있는 만큼만.** 스포츠 글이 풀에 2%면 그만큼만 채워진다 —
      // 없는 것을 만들지 않는다.
      let arranged = balanced;
      // 설문에서 고른 것 — 단, **학습이 싫다고 판정한 것은 뺀다**.
      //
      // 검수(2026-08-06 P0)가 재현했다: 설문에서 스포츠를 고른 뒤 스포츠 글에
      // 싫어요를 25번 눌러 rank.js가 hated로 판정했는데도, 첫 페이지의 60%가
      // 스포츠였다. chosenCategories는 설문 스냅샷(surveyAnswers)만 보고
      // 학습 가중치(preferences)는 안 보기 때문이다.
      //
      // 이건 내가 세운 원칙 "관문을 두 벌로 두지 않는다"를 그대로 어긴 것이다 —
      // rank.js의 hated 게이트와 여기 지분 보장이 서로 다른 값을 보고,
      // 뒤엣것이 앞엣것을 무력화했다. **아무리 싫어요를 눌러도 안 통하는 피드**는
      // 애매하게 섞이는 것보다 나쁘다. rank.js가 이미 계산한 hated를 그대로 쓴다.
      const { hated: hatedCats } = categorySets(user.preferences, rankParams());
      const cats = new Set([...chosenCategories(user)].filter((c) => !hatedCats.has(c)));
      // 카테고리를 명시했으면 다른 카테고리를 끌어오지 않는다 — "부동산을 보겠다"는
      // 명시적 의사이고, 거기에 취향 지분을 섞으면 요청과 다른 화면이 된다
      // (David 2026-08-07 실측: 부동산 요청에 auto·life가 섞여 나왔다).
      if (cats.size && !category) {
        const inNow = new Set(arranged.map((i) => i.id));
        const tastePool = (tasteBase || []).filter(
          (i) => cats.has(i.category) && !inNow.has(i.id)
        );
        const r = ensureTasteShare(arranged, tastePool, { cats });
        arranged = capOneCategory(r.items);
      }
      unseen = arranged.map((item) => ({ item, score: scoreOf.get(item.id) || 0 }));
    }

    // ── 새로고침 앵커 (HOME_ANCHOR_* 상수 주석 참조) — 직전 첫 화면의 상위
    // 앵커가 아직 살아 있고(풀 폴백 포함) 관문을 통과하면 이번 첫 화면
    // 머리에 유지한다. 앵커는 이미 seen이라 새 글 소비와 겹치지 않는다.
    // hated 카테고리는 앵커로도 안 남긴다 — selectDiverse가 전 페이지에서
    // 하드 배제한 것을 앵커가 15분 더 붙잡고 있으면 "아무리 싫어요를 눌러도
    // 안 통하는 피드"의 창이 된다(검수 라운드4).
    const anchorEntries = [];
    let floorHated = EMPTY_TOPICS;
    if (!source && !category) {
      floorHated = categorySets(user.preferences, rankParams()).hated;
      if (cursor === 0 && markSeen && sort !== "deals" && anchorGate) {
        const saved = user.homeAnchors;
        const anchoredMs = saved && saved.at ? Date.parse(saved.at) : NaN;
        if (saved && Array.isArray(saved.ids) && Number.isFinite(anchoredMs) && now - anchoredMs <= HOME_ANCHOR_TTL_MS) {
          // limit-1 클램프: 아주 작은 limit(API 직접 호출)에서도 페이지가
          // limit를 넘지 않고, 새 글 칸이 최소 하나는 남는다(검수 라운드4).
          for (const id of saved.ids.slice(0, Math.min(HOME_ANCHOR_COUNT, Math.max(0, limit - 1)))) {
            const found = this._findItem(items, id);
            if (found && anchorGate(found) && !floorHated.has(found.category)) {
              anchorEntries.push({ item: found, score: 0 });
            }
          }
        }
      }
    }

    let fresh;
    if (source) {
      fresh = diversify(unseen).slice(cursor, cursor + limit);
    } else if (anchorEntries.length) {
      // 중복 제거 — 앵커가 seen 상한(3,000) 밖으로 밀려나면 unseen 후보로
      // 돌아올 수 있다(검수 라운드4가 실측으로 확인한 실제 경로. 전부-seen
      // 재활용 폴백은 위에서 조기 반환이라 여기 도달하지 않는다).
      const anchorIds = new Set(anchorEntries.map((a) => a.item.id));
      fresh = anchorEntries.concat(
        unseen.filter((r) => !anchorIds.has(r.item.id)).slice(0, Math.max(0, limit - anchorEntries.length))
      );
    } else {
      fresh = unseen.slice(0, limit);
    }

    // ── 해외 글 페이지 하한 (5.7 B단계 채택안, 2026-08-08)
    //
    // 해외 RSS는 추천·댓글 수치가 없어 hotScore의 속도 보너스(ingest.js vel)를
    // 태생적으로 못 받고, 풀 지분 ~5%인데도 첫 화면에서 0~1건으로 죽는다
    // (설계 워크플로 실측: 첫 20칸 중 해외는 19번째 1건뿐). 점수 체계를 고치는
    // lane 재정규화안은 적대적 검수가 기각했다 — "측정된 반응이 무측정 순위를
    // 이긴다"(RANK_ONLY_CONF)는 확정 결정을 수학적으로 되돌리고, 반응 0건 글을
    // 핫 1위에 올린다. 대신 X의 AuthorDiversityFloor 방식으로 **하한만** 둔다:
    // 점수 경쟁은 그대로, 바닥만 있고, 위쪽은 실력대로. (taste-share.js 참조)
    //
    // **최종 페이지(fresh)에 건다** — 검수 라운드4: 병합 전 후보 목록에 걸면
    // 앵커 병합이 꼬리를 잘라 하한 슬롯이 12~15% 확률로 잘려나갔다(실측:
    // 해외 0건 첫 화면 익명 0/60→7/60). 페이지에 걸면 앵커·딜과의 자리
    // 경쟁이 구조적으로 없다(avoid). 후보는 페이지 밖 unseen(이미 순위
    // 경쟁을 거침) → 관문 통과 풀(tasteBase, hated 제외 — 라운드3) 순.
    // 페이지마다 재적용되므로 헤비 스크롤러는 세션 후반에 해외 공급이 자연
    // 고갈될 수 있다 — 재료가 없으면 있는 만큼만, 의도된 동작이다.
    if (!source && !category && fresh.length) {
      const inPage = new Set(fresh.map((r) => r.item.id));
      const anchorIds = new Set(anchorEntries.map((a) => a.item.id));
      const donorIds = new Set();
      const donors = [];
      for (const r of unseen) {
        if (isForeignItem(r.item) && !inPage.has(r.item.id) && !donorIds.has(r.item.id)) {
          donorIds.add(r.item.id);
          donors.push(r);
        }
      }
      const poolDonors = (tasteBase || [])
        .filter((i) => isForeignItem(i) && !inPage.has(i.id) && !donorIds.has(i.id) &&
          !seen.has(i.id) && !floorHated.has(i.category))
        .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
      for (const i of poolDonors) { donorIds.add(i.id); donors.push({ item: i, score: 0 }); }
      fresh = ensureForeignShare(fresh, donors, {
        is: (r) => isForeignItem(r.item),
        idOf: (r) => r.item && r.item.id,
        // 딜 지분 칸(라운드3)과 앵커 칸(라운드4)은 교체하지 않는다.
        avoid: (r) => Boolean(r.item && (r.item.isDeal === true || anchorIds.has(r.item.id))),
        window: Math.min(FOREIGN_WINDOW, limit)
      }).items;
    }

    const level = specializationLevel(user.preferences, user.feedbackCount);
    const phase = feedPhase(level);

    const batch = fresh.map((r) => {
      const d = this._decorate(r.item, r.score, user, {
        now,
        sourceStats: editorialSourceStats.get(r.item.source)
      });
      // surface collaborative picks so "사람들이 좋아한" recommendations are visible
      if ((collabBoosts.get(r.item.id) || 0) > 0.2) {
        d.collabPick = true;
        d.reasons = ["비슷한 취향 픽", ...d.reasons].slice(0, 3);
      }
      return d;
    });

    if (markSeen && batch.length) {
      this.store.markSeen(userId, batch.map((b) => b.id));
      // feed the round-robin fairness ledger (see the `exposure` block above)
      // regardless of view — a source shown via source= should count too, so
      // the home feed doesn't re-show it excessively right after.
      if (this.store.recordSourceExposure) {
        // 노출 이력도 다양성 키로 적는다 — 조회(rank.js/roundRobin)와 기록이
        // 다른 키를 쓰면 그룹 소스의 적자가 영원히 0으로 보인다.
        // 앵커(재표시)는 빼고 적는다 — 새로고침마다 같은 소스의 노출 적자를
        // 이중으로 쌓으면 그 소스가 라운드로빈에서 부당하게 밀린다.
        const anchorIdSet = new Set(anchorEntries.map((a) => a.item.id));
        this.store.recordSourceExposure(
          userId,
          fresh.filter((r) => !anchorIdSet.has(r.item.id)).map((r) => diversityKey(r.item))
        );
      }
    }
    // 이번 첫 화면의 상위를 다음 새로고침의 앵커로 기억한다. 같은 앵커가
    // 유지되는 동안은 처음 잡힌 시각을 보존한다(store.rememberHomeAnchors) —
    // 그래야 연속 새로고침으로 TTL이 영원히 늘어나지 않는다.
    if (!source && !category && cursor === 0 && markSeen && sort !== "deals" && batch.length) {
      this.store.rememberHomeAnchors(userId, batch.slice(0, HOME_ANCHOR_COUNT).map((b) => b.id));
    }

    // ---- monetization: affiliate/ad slot insertion (docs/monetization.md) ----
    // Applied AFTER seen/exposure bookkeeping above so slot items never touch
    // the organic dedup/fairness ledgers — they're generated fresh per
    // request (monetize.js), not drawn from the collected pool, and must
    // never count as "an item this user has been shown" for personalization.
    // `nextCursor` below stays based on `batch.length` (organic count only)
    // so pagination is unaffected by however many slots got inserted.
    //
    // 브랜드 안전은 **글 단위**로 지킨다 — 사용자 단위로 끄지 않는다.
    //
    // 예전에는 정치·종교 보기를 켠 사용자에게 광고를 **아예 안 줬다**. 취지는
    // 옳았지만(민감한 글 옆 광고 금지) 도구가 틀렸다: 그 토글을 한 번 켠 사람은
    // 그 뒤로 영원히 광고가 0이 된다. 실측(2026-08-06) — David가 정치글 보기를
    // 켠 뒤 "쿠팡 광고 안 뜬다"고 반복해서 말한 원인이 이것이다.
    //
    // 정작 필요한 보호는 이미 **글 단위**로 있다: monetize.js의 injectSlots가
    // 광고를 꽂기 전에 위아래 이웃을 adUnsafe()로 검사해, 정치·종교·성인·비속어
    // 글 옆이면 그 자리를 건너뛴다. 사용자 단위 차단은 그 위에 얹힌 중복이었고,
    // 얻는 것 없이 그 사용자의 수익만 통째로 0으로 만들었다.
    const displayItems = this._monetize(userId, user, batch, cursor, Boolean(source)).items;

    const selMeta = this._lastSelectMeta || null;
    return {
      items: displayItems,
      nextCursor: cursor + batch.length,
      // 1페이지 hated 하드 배제 때문에 모자란 것은 "풀 소진"이 아니다 —
      // 거짓 exhausted가 무한스크롤을 죽이는 것을 막는다(설계 Q3).
      exhausted: batch.length < limit && !(selMeta && selMeta.bannedHatedCount > 0),
      // 선택 카테고리 공급 부족을 클라이언트가 알 수 있게 (정직한 부족 안내)
      pageMeta: selMeta ? { shortfall: selMeta.shortfall } : null,
      phase,
      level,
      feedbackCount: user.feedbackCount
    };
  }

  // Insert affiliate/ad slots into an already-decorated organic batch. Thin
  // glue: monetize.js owns the placement rules + candidate shaping — this
  // wires in this request's user preference vector, this user's ad
  // click-through history (for adaptive density), their recently-shown ad ids
  // (rotation), their A/B variant, and the session-total slot cap.
  // Returns { items, slots } (slots kept for callers that want placement
  // metadata; getFeed above only uses .items).
  //
  // `narrowSource`: true when this call is for a source=-scoped view (a single
  // community/board), not the home feed — 라운드1 검수 #8: a niche view feels
  // ad-denser at the same cadence, so applyNarrowSourceDensity thins it out.
  // paramOverrides — 화면마다 광고 밀도가 달라야 할 때만 쓴다(핫딜 모아보기).
  // 세션 총량 캡·민감 글 인접 규칙은 그대로 적용된다.
  _monetize(userId, user, batch, cursor, narrowSource = false, paramOverrides = null) {
    if (this.monetizationDisabled) return { items: batch, slots: [] };
    const partnerId = process.env.COUPANG_PARTNER_ID || null;
    const preview = Boolean(process.env.AD_PREVIEW);
    if (!partnerId && !preview) return { items: batch, slots: [] }; // 절대원칙1: dummy content 금지

    const variant = assignVariant(userId);
    let params = applyVariant(adParams(), variant);
    params = applyNarrowSourceDensity(params, narrowSource);
    if (paramOverrides) params = { ...params, ...paramOverrides };

    // 세션(24h 롤링) 총량 캡 — 라운드1 검수 #7. AD_MAX_PER_PAGE는 "이 요청
    // 1건"의 상한일 뿐이라, 이게 없으면 스크롤을 계속하는 세션은 노출이
    // 무제한으로 누적된다.
    //
    // 2026-07-25 라운드2 검수 #4 (중대, "AD_MAX_PER_SESSION=0 = 무제한 버그"):
    // 기존엔 `maxPerSession>0`일 때만 이 블록이 실행됐다 — 0이면 조건이
    // 거짓이라 블록 전체가 스킵되고 세션 캡이 사실상 무제한이 됐다. AD_EVERY
    // 등 다른 튜너블에서 0/이하는 "완전 비활성"인 것과 비대칭이었다. 이제
    // 0은 명시적으로 "광고 0개"(즉시 차단)로, 음수는 명시적으로 "무제한"
    // (캡 미적용)으로 처리한다 — docs/monetization.md에도 반영.
    // 0은 "광고 완전 차단"이라는 명시적 설정값이다(음수는 무제한). 운영 중에
    // 실수로 0이 들어가면 수익이 조용히 0이 되므로 로그로 알린다 — 조용히
    // 사라지는 것이 가장 나쁘다(David 2026-08-06 "어떤 상황에서도 광고는 떠야지").
    if (params.maxPerSession === 0) {
      if (!this._warnedAdOff) {
        this._warnedAdOff = true;
        console.warn("[ad] AD_MAX_PER_SESSION=0 — 광고를 내보내지 않는 설정입니다");
      }
      return { items: batch, slots: [] };
    }
    if (params.maxPerSession > 0) {
      const already = this.store.adSlotsServedCount ? this.store.adSlotsServedCount(userId) : 0;
      if (already >= params.maxPerSession) return { items: batch, slots: [] };
      params.maxPerPage = Math.min(params.maxPerPage, params.maxPerSession - already);
    }
    // params.maxPerSession < 0 → "무제한": 캡 로직을 적용하지 않고 통과.

    const responsiveness = this.store.adResponsiveness ? this.store.adResponsiveness(userId) : null;
    const every = adaptiveEvery(params.every, responsiveness);
    // 라운드1 검수 #1: seed는 더 이상 cursor에서 유도하지 않는다(짝수 스텝
    // 커서가 seed 패리티를 고정시켜 같은 상품만 반복되던 원인) — 호출마다
    // 항상 전진하는 store 카운터를 쓴다. excludeIds로 최근 노출 상품도
    // 로테이션에서 건너뛴다.
    const seed = this.store.nextAdSeed ? this.store.nextAdSeed(userId) : cursor + 1;
    const excludeIds = this.store.adSeenIdsFor ? this.store.adSeenIdsFor(userId) : undefined;
    const candidates = pickAffiliateCandidates(user.preferences, { partnerId, preview, seed, excludeIds, productFeed: this._productFeed }).map(
      (c) => ({ ...c, variant })
    );
    const result = injectSlots(batch, candidates, { ...params, every, startIndex: cursor });
    if (result.slots.length && this.store.recordAdSlotsServed) {
      this.store.recordAdSlotsServed(userId, result.slots.length);
    }
    return result;
  }

  // `editorialContext` (optional) is engine.js's { now, sourceStats } for
  // editorial.js's buildEditorialNote — see getFeed's editorialSourceStats.
  // Callers that don't pass it (resolveItems/getItem/digest below) still get
  // a note from whichever templates only need the item's own fields; only
  // the source-outlier template is unavailable without it.
  _decorate(item, score, user, editorialContext = null) {
    this._rememberArticle(item);
    const rating = user.ratings[item.id];
    const saved = Array.isArray(user.saved) && user.saved.includes(item.id);
    const reasons = user.preferences ? explain(item, user.preferences).map(reasonLabel) : [];
    const now = (editorialContext && editorialContext.now) || (this._clock ? new Date(this._clock()).getTime() : Date.now());
    // 열기 눈금(디자인 시그니처). **누적량이 아니라 구간별 증가분(속도)**을
    // 그린다 — 누적을 그대로 그리면 반응이 멈춘 글도 막대가 전부 최대 높이로
    // 꽉 차서 그래프가 아니라 색 덩어리로 보인다(David 실기기 2026-08-01).
    // 증가분이 전 구간 0이면(반응이 전혀 안 움직인 글) 아예 그리지 않는다 —
    // 없는 화제성을 있는 척하지 않는다.
    // 값이 안 움직인 글도 **평평한 기준선**으로 그린다(전부 0인 배열을 그대로
    // 넘김) — 클라이언트가 "정지 = 낮은 회색 선, 상승 = 빨간 봉우리"로 구분해
    // 그리므로 정직하면서도 시그니처가 대부분의 카드에 존재하게 된다.
    // (2026-08-01 David: "대부분 없고, 있어도 기대와 다르다")
    const hh = Array.isArray(item.heatHist) ? item.heatHist : null;
    let heat = null;
    // 아직 표본이 모자란 글(수집 중)은 "계산 중"으로 알려 준다 — 클라이언트가
    // 빈칸 대신 스윕 애니메이션을 그린다(David 2026-08-01).
    // ── 화제도 그래프: 증가분이 아니라 **쌓인 값**을 그린다 (2026-08-06)
    //
    // David: "화제성 그래프... 되는 것처럼 보이는 게 없어 모조리 로딩중으로만 보여."
    //
    // 실측(라이브 30건): heatHist는 30건 전부 있는데 heat는 5건뿐이었다.
    // 원인은 **증가분(미분)만 그렸기 때문**이다. 이미 반응이 쌓인 글은 더 이상
    // 안 오르므로 증가분이 전부 0이 되고, 막대 높이가 0이라 빈 줄로 보인다 —
    // **정작 그 글이 화제인 글인데도** 아무것도 안 그려졌다.
    // 게다가 4눈금 미만이면 아예 null이라 "계산 중" 점선만 영원히 남았다.
    //
    // 그래서 누적값 자체를 그린다(스파크라인의 표준). 각 글 안에서 min~max로
    // 정규화하므로 소스마다 스케일이 달라도 모양이 나온다. 변화가 없으면
    // 평평한 선이 보인다 — 그것도 "변화가 없다"는 정보다. 빈 줄보다 낫다.
    //
    // 2눈금이면 그린다. 두 점이면 선분 하나이고, 그 자체로 오르는지 아닌지가 보인다.
    const HEAT_MIN_POINTS = 2;
    const heatPending = Boolean(hh && hh.length > 0 && hh.length < HEAT_MIN_POINTS);
    if (hh && hh.length >= HEAT_MIN_POINTS) {
      const lo = Math.min(...hh);
      const hi = Math.max(...hh);
      const span = hi - lo;
      heat = span > 0
        ? hh.map((v) => Math.round(((v - lo) / span) * 100) / 100)
        // 값이 내내 같으면 반응이 멈춘 글이다. 0이 아니라 낮은 평지로 그린다 —
        // 0으로 두면 막대가 사라져 "그래프가 없는 것"과 구분이 안 된다.
        : hh.map(() => 0.15);
    }
    const publicItem = { ...item };
    publicItem.image = safeImage(publicItem.image);
    // 내부 소유자 id는 공개 응답에 싣지 않는다 — 화면은 쓰지 않고, 새어 나가면
    // 계정 결속 탈취의 재료가 된다(적대적 검수 2026-08-06). 소유권 판정은
    // 서버가 store의 원본 레코드로 한다.
    delete publicItem.userId;
    // 이미 저장돼 있던 글은 author 자리에 내부 id가 박힌 채로 남아 있다
    // (수정 전에 쓰인 글 — 라이브에서 1건 확인). 저장된 값도 여기서 가린다.
    if (typeof publicItem.author === "string" && /^user_[0-9a-f]{6,}$/i.test(publicItem.author)) {
      publicItem.author = null;
    }
    return {
      ...publicItem,
      heat,
      heatPending,
      categoryLabel: categoryLabel(item.category),
      matchScore: Math.round(score * 100) / 100,
      reasons,
      myRating: rating ? rating.signal : 0,
      saved,
      comments: this.store.commentsFor(item.id).length,
      // 편집 코멘트 한 줄 — docs/monetization.md's AdSense "added value"
      // rationale + curation-taste signal. Never populated for affiliate/ad
      // cards (they never reach _decorate at all — see _monetize below,
      // which builds slot items separately and splices them into the
      // already-decorated organic batch).
      editorialNote: buildEditorialNote(item, {
        now,
        sourceStats: editorialContext && editorialContext.sourceStats
      })
    };
  }

  // Resolve a list of item ids to decorated items (for the 스크랩 list).
  async resolveItems(userId, ids) {
    return (await Promise.all(ids.map((id) => this.getItem(userId, id)))).filter(Boolean);
  }

  _rememberArticle(item) {
    try { this._articleArchive?.remember(this._cleanItemSummary(item)); }
    catch (err) { console.error("[article-archive] write failed:", err.message); }
  }

  _cleanItemSummary(item) {
    if (item?.translated && item.summaryTranslated === false) item.summary = "";
    return item;
  }

  rememberPublishedItem(item) {
    // SSR cards can be shortened DTOs; preserve the actual article, not that DTO.
    const saved = this._articleArchive?.get(item?.id);
    const full = (saved && this._findItem(this._cache || [], saved.id))
      || this._findItem(this._cache || [], item?.id) || saved || item;
    this._rememberArticle(full);
  }

  async _detailContext(itemId) {
    let items = this._cache || [];
    const lookup = () => {
      const saved = this._articleArchive?.get(itemId);
      return (saved && this._findItem(items, saved.id))
        || this._findItem(items, itemId) || saved;
    };
    let item = lookup();
    if (!item && !this._cache && this._poolFile && !this._archivePoolRead) {
      this._archivePoolRead = true;
      // Recover existing links even if the old pool is too stale to seed a new feed.
      try {
        const rows = JSON.parse(fs.readFileSync(this._poolFile, "utf8")).rows;
        for (const row of Array.isArray(rows) ? rows : []) this._rememberArticle(row?.item);
      } catch (err) {
        if (err.code !== "ENOENT") console.error("[article-archive] pool recovery failed:", err.message);
      }
      item = lookup();
    }
    if (!item) {
      items = await this._items();
      item = lookup();
    }
    return { item: this._cleanItemSummary(item), items };
  }

  // 아이템 조회는 이 헬퍼 한 벌만 쓴다 — 상한 목록에 없으면 누적 풀(48h)에서
  // 찾는다. 피드가 내놓은 글이 다음 수집 사이클의 소스별 상한 재편성에서
  // 빠질 수 있는데(David 2026-08-07 Alphabet 기사: 풀 8,403 vs 상한 1,973),
  // 상세(getItem)에만 폴백을 달고 평가·신호·공유는 상한 목록만 보면 방금
  // 서빙된 글에 좋아요가 "unknown item"으로 죽고 열람(open)이 발자취에서
  // 빠진다. 조회를 두 벌로 두면 한쪽이 반드시 샌다.
  _findItem(items, itemId) {
    const matches = (item) => item?.id === itemId || (item?.canonicalAliases || []).some((alias) => alias?.id === itemId);
    const hit = items.find(matches);
    if (hit) return hit;
    const pooled = this._pool && this._pool.get(itemId);
    if (pooled?.item) return pooled.item;
    for (const row of this._pool?.values() || []) if (matches(row.item)) return row.item;
    return null;
  }

  // Record a like/dislike and learn from it. Returns updated confidence.
  async rate(userId, itemId, signal) {
    if (![1, 0, -1].includes(signal)) throw new Error("signal must be 1, 0, or -1");
    const user = this.store.requireUser(userId);
    const { item } = await this._detailContext(itemId);
    if (!item) throw new Error(`unknown item: ${itemId}`);

    const previousSignal = Number(user.ratings[itemId] && user.ratings[itemId].signal || 0);
    if (previousSignal !== signal) {
      if (user.preferenceBase) {
        this.store.recordRating(userId, itemId, signal, item);
      } else {
        // Legacy records created before the overlay contract may already have
        // explicit effects folded into preferences. Keep their old mutation
        // path until the last legacy rating is removed; clean users migrate on
        // load without approximation.
        if (previousSignal) revertFeedback(user.preferences, item, previousSignal);
        if (signal) applyFeedback(user.preferences, item, signal);
        this.store.recordRating(userId, itemId, signal, item);
      }
    }

    const level = specializationLevel(user.preferences, user.feedbackCount);
    return { level, phase: feedPhase(level), feedbackCount: user.feedbackCount };
  }

  // Public share metadata for an item (for OG tags on a shared link). Adult
  // items get no public share page.
  async shareData(itemId) {
    const { item } = await this._detailContext(itemId);
    if (!item) return null;
    // 관리자가 차단한 소스는 공유 카드로도 안 내보낸다 — getItem이 상세에
    // 거는 것과 같은 관문. 예전엔 공유 경로에 이 관문이 아예 없었다.
    const disabled = this.store.disabledSources ? this.store.disabledSources() : null;
    if (disabled && disabled.has(item.source)) return null;
    this._rememberArticle(item);
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      category: categoryLabel(item.category),
      source: sourceLabel(item.source),
      url: item.url,
      // 공유 카드에 기사 사진을 싣기 위해 함께 내보낸다. 2026-08-02 검수 실측:
      // /p?id= 5개 글의 og:image가 전부 사이트 로고(icon.svg) 상수였고, 정작
      // 같은 글의 API에는 실제 사진이 있었다(피드 60건 중 45건 보유).
      // 카톡·X 미리보기가 모든 글에서 똑같은 로고로 나가면 클릭률이 죽는다.
      image: safeImage(item.image)
    };
  }

  // Record an implicit engagement signal (dwell / skip / complete / open) and
  // learn from it. The lightweight, high-volume feedback behind TikTok-style
  // personalization.
  async signal(userId, itemId, event) {
    const user = this.store.requireUser(userId);
    // 풀 폴백 필수 — 상한 목록만 보면 방금 서빙된 글의 열람(open)이
    // 발자취(user.opened)에서 조용히 빠진다.
    const { item } = await this._detailContext(itemId);
    if (!item) return { ok: false };
    const { step } = applyImplicit(this.store.learningPreferences(userId), item, event || {});
    this.store.refreshPreferenceProjection(userId);
    this.store.recordSignal(userId, itemId, event && event.type, step);
    return { ok: true, type: event && event.type, step };
  }

  // A non-consuming preview of the best unseen items — the payload behind a
  // "관심글 N개가 올라왔어요" re-engagement notification. Does NOT mark items seen,
  // so opening the app afterwards still shows them in the feed.
  async digest(userId, { limit = 5, minScore = 1.0, excludeIds = [] } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set([...(user.seen || []), ...(user.opened || []), ...excludeIds]);

    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
    const showTopics = new Set(user.showTopics || []);
    const pool = items.filter(
      (i) =>
        !muted.has(i.source) &&
        !disabled.has(i.source) &&
        !topicsBlocked(i, showTopics) &&
        !seen.has(i.id) && !(i.canonicalAliases || []).some((a) => seen.has(a.id))
    );
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    // Same hot-only gate as the main feed (see getFeed) — the digest previews
    // "what you'd see if you opened the app now," so it must draw from the
    // same hot-gated pool, not a superset of it.
    const gated = pool.length ? hotGate(pool, now) : [];
    const hotPool = gated.length ? gated.filter((r) => r.hot).map((r) => r.item) : pool;
    const rankPool = hotPool.length ? hotPool : pool;
    const ranked = rankItems(rankPool, user.preferences, { seed: 1, now, explore: 0 })
      .filter((r) => r.score >= minScore);
    return {
      count: ranked.length,
      top: ranked.slice(0, limit).map((r) => this._decorate(r.item, r.score, user))
    };
  }

  // "오늘의 브리핑" 원자료 (애드핏 보류 대응 2026-08-01: "자체 콘텐츠 보충").
  //
  // 아웃링크 카드 나열이 아니라 **우리가 계산한 실측 데이터로 우리가 쓰는**
  // 일일 편집 페이지의 재료다. 모든 수치는 수집된 공개 신호(추천·댓글·다중보도)
  // 그대로이며, 문장 템플릿은 server.js의 briefingPage가 조립한다.
  // 정치·성인 글은 제외한다(브리핑은 로그인/설정 없이 보는 공개 페이지).
  _labelFor(item) {
    if (item.sourceLabel) return item.sourceLabel;
    const t = sourceLabel(item.source);
    if (t && t !== item.source) return t;
    if (this._registryLabels === undefined) {
      try {
        this._registryLabels = new Map(loadRegistry().map((c) => [c.id, c.labelKo || c.label]));
      } catch { this._registryLabels = new Map(); }
    }
    return this._registryLabels.get(item.source) || item.source;
  }

  // ---- 화제 랭킹 (자체 콘텐츠, David 2026-07-31 "주간 일간 월간 탑 20") ----
  //
  // "납득할만한 화제성만 고르는 게 빡세지 않냐"(David)에 대한 답이 이 4중
  // 장치다 — 리소스가 다양해 절대 숫자 비교는 무의미하다는 지적이 맞고,
  // 그래서 절대 숫자로 겨루지 않는다:
  //   1) 소스 내 이례성: sourceHotScores(백분위·로버스트-z·시간감쇠) 재사용 —
  //      큰 게시판의 평범한 글이 절대 추천수로 도배하는 구조를 차단
  //   2) 교차 신호: 여러 매체가 함께 다룬 뉴스(coverage)는 가산
  //   3) 절대 반응 하한: 소스 안에서 1위여도 절대 반응이 미미하면 전국
  //      랭킹에는 싣지 않는다 — 이례성만으로 올리는 것도 납득이 안 되므로
  //   4) 소스당 최대 2개 (다양성 상한)
  // 그리고 항목마다 근거 수치(추천·댓글·보도량)를 실어 페이지가 그대로
  // 노출한다 — 납득은 알고리즘이 아니라 근거 공개가 만든다.
  async rankingTop(limit = 30) {
    // 랭킹 페이지에도 열기 눈금(시그니처) — 정규화 규칙은 _decorate와 동일.
    const heatOf = (it) => {
      const hh = Array.isArray(it.heatHist) ? it.heatHist : null;
      if (!hh || hh.length < 4) return null;
      const d = [];
      for (let k = 1; k < hh.length; k++) d.push(Math.max(0, (hh[k] || 0) - (hh[k - 1] || 0)));
      const m = Math.max(...d);
      return m > 0 ? d.map((v) => Math.round((v / m) * 100) / 100) : d.map(() => 0);
    };
    const items = await this._items();
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    const pool = items.filter(
      (i) =>
        // 기본 숨김 토픽 전부를 본다 — politics만 하드코딩하면 religion이 샌다.
        // 공개 지면(랭킹·브리핑)은 로그인 없이 보이고 sitemap에도 올라간다.
        !topicsBlocked(i, EMPTY_TOPICS) &&
        i.kind !== "ad" && i.kind !== "affiliate" &&
        i.source !== "seed" && i.source !== "me" &&
        // 우리가 "오늘의 화제"라고 이름 붙이는 자리다. 그 커뮤니티 안에서만
        // 통하는 글(추천 구걸·모집 공고)은 여기 올리지 않는다 — 피드에서는
        // 그대로 보이므로 삭제가 아니라 승격 제외다(promotion.js).
        promotable(i) &&
        !this._offMainSet().has(i.source) &&
        !tooOld(i, now)
    );
    const engagement = (i) => (i.score || 0) + (i.commentCount || 0) * 2;
    const minEng = Number(process.env.RANKING_MIN_ENGAGEMENT ?? 30);
    const scored = sourceHotScores(pool, now)
      .filter((s) => engagement(s.item) >= minEng || (s.item.coverage || 0) >= 3)
      .sort((a, b) =>
        (b.hotScore + Math.min(b.item.coverage || 0, 5) * 0.05) -
        (a.hotScore + Math.min(a.item.coverage || 0, 5) * 0.05));
    const perSrc = new Map();
    const out = [];
    for (const s of scored) {
      if (out.length >= limit) break;
      const src = s.item.source;
      const used = perSrc.get(src) || 0;
      if (used >= 2) continue;
      perSrc.set(src, used + 1);
      const i = s.item;
      out.push({
        id: i.id, title: i.title, url: i.url || null,
        source: i.source, sourceLabel: this._labelFor(i),
        category: i.category || "news", categoryLabel: categoryLabel(i.category || "news"),
        score: i.score || 0, commentCount: i.commentCount || 0,
        // 우리가 쓰는 실측 한 줄 — 홈 서버 렌더의 자체 서술이 8.5%뿐이라
        // (2026-08-07 정책 감사, 애드핏 4회 반려 사유와 일치) 이미 있는
        // 편집 코멘트를 크롤러가 읽는 화면까지 내린다. 새 문장 생성이 아니다.
        editorialNote: buildEditorialNote(i, { now }) || null,
        coverage: i.coverage || 0, image: safeImage(i.image),
        // 발췌 — 홈 서버 렌더(seed)와 랭킹 페이지가 함께 쓴다. 제목만 있으면
        // "남의 제목 모음"과 구분되지 않는다(2026-08-04 검수). 200자 상한은
        // 인용 범위를 지키기 위한 것이고 원문 전체 복제는 어느 경로에도 없다.
        summary: typeof i.summary === "string" ? i.summary.slice(0, 200) : "",
        heat: heatOf(i),
        hot: Math.round(s.hotScore * 1000) / 1000
      });
    }
    // ── 발췌 품질 필터 (2026-08-04) ─────────────────────────────────────
    //
    // 발췌는 원문 페이지의 og:description에서 온다. 그런데 상당수 사이트는
    // 글마다 다른 설명 대신 **사이트 소개문을 통째로** 내려준다. 실측:
    //   "이토랜드는 유머, 연예, 정보, 이슈를 빠르게 공유하는 커뮤니티입니다…"
    //   → 이토랜드 글 전부에 똑같이 붙었다
    //   "직접 눌러서 내용을 확인해 주세요" → 알맹이 없는 유도 문구
    //
    // 이런 걸 그대로 실으면 같은 문단이 페이지에 반복되어, 검색엔진이 보기에
    // 정확히 "템플릿으로 찍어낸 페이지"가 된다 — 발췌를 넣은 이유와 정반대다.
    // 목록 안에서 두 번 이상 겹치는 발췌는 그 글의 것이 아니므로 버린다.
    const seen = new Map();
    for (const o of out) {
      const k = (o.summary || "").trim();
      if (k) seen.set(k, (seen.get(k) || 0) + 1);
    }
    const FILLER = /^(직접 눌러|자세한 내용은|내용을 확인|클릭하여|더 보기)/;
    for (const o of out) {
      const k = (o.summary || "").trim();
      // 너무 짧은 것도 버린다 — 한 문장도 안 되면 알맹이가 없다.
      if (!k || k.length < 20 || seen.get(k) > 1 || FILLER.test(k)) o.summary = "";
    }
    return { generatedAt: new Date(now).toISOString(), items: out };
  }

  // 카테고리 브리핑 페이지 원자료 — 전국 랭킹(rankingTop)과 달리 절대 반응
  // 하한을 걸지 않는다 (David 2026-08-01 "자동차는 게시글이 하나밖에?" 실측:
  // 자동차 뉴스는 추천·댓글이 없는 기사가 대부분이라 전국 하한(반응 30)에서
  // 전멸했다). 카테고리 안에서의 상대 비교는 브리핑과 같은 기준
  // (engagement + coverage·50)으로 충분하고, 소스당 3건 상한만 지킨다.
  async categoryTop(cat, limit = 10) {
    const items = await this._items();
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    // 카테고리 브리핑도 **우리 이름으로 발행하는 지면**이다. 그런데 다른 지면
    // (홈 피드·화제 랭킹·브리핑)에 다 걸려 있는 두 가지가 여기만 빠져 있었다
    // (2026-08-05 전수검사):
    //   promotable    — "300추 가능한가요?" 같은 저가치 제목, 비하 표현 제외
    //   _offMainSet   — 메인에서 빼기로 한 소스
    // 검사 시점에 라이브 27건 중 걸린 것은 0건이었지만, **막는 장치가 없다는 것과
    // 지금 깨끗한 것은 다른 이야기다.** 광고 심사를 앞두고 운에 맡길 자리가 아니다.
    // 종교 태그도 함께 뺀다 — 이 페이지는 로그인 없이 열리는 공개 지면이라
    // 기본 숨김 토픽이 그대로 나가면 앱과 앞뒤가 안 맞는다.
    const offMain = this._offMainSet();
    const pool = items.filter(
      (i) =>
        (i.category || "news") === cat &&
        !topicsBlocked(i, EMPTY_TOPICS) &&
        i.kind !== "ad" && i.kind !== "affiliate" &&
        i.source !== "seed" && i.source !== "me" &&
        !offMain.has(i.source) &&
        promotable(i) &&
        !tooOld(i, now)
    );
    pool.sort((a, b) =>
      ((b.score || 0) + (b.commentCount || 0) * 2 + (b.coverage || 0) * 50) -
      ((a.score || 0) + (a.commentCount || 0) * 2 + (a.coverage || 0) * 50));
    // 같은 사건이 여러 매체·커뮤니티에서 오면 한 번만 싣는다. 브리핑에는 이미
    // 걸려 있는데 여기만 빠져서, 자동차 브리핑 1위와 4위가 같은 사건이었다
    // (David 2026-08-05 실측: "어제자 진주 택시 전복사고" / "오늘자 진주 택시
    // 전복사고 블랙박스"). 10칸짜리 목록에서 중복 한 건은 비싸다.
    const seenEvent = new Set();
    const perSrc = new Map();
    const out = [];
    for (const i of pool) {
      if (out.length >= limit) break;
      const ev = eventKey(i.title);
      if (ev && seenEvent.has(ev)) continue;
      const used = perSrc.get(i.source) || 0;
      if (used >= 3) continue;
      perSrc.set(i.source, used + 1);
      if (ev) seenEvent.add(ev);
      out.push({
        id: i.id, title: i.title, url: i.url || null,
        source: i.source, sourceLabel: this._labelFor(i),
        category: cat, categoryLabel: categoryLabel(cat),
        score: i.score || 0, commentCount: i.commentCount || 0,
        coverage: i.coverage || 0, image: safeImage(i.image)
      });
    }
    return { generatedAt: new Date(now).toISOString(), items: out };
  }

  // slotId를 주면 그 시간대의 성격으로 편성한다 (David 2026-08-04).
  // 안 주면 지금 시각의 슬롯 — 기존 호출부와 호환된다.
  // enrich가 새로 채운 발췌 중 아직 한글이 아닌 것을 옮긴다.
  //
  // 한 사이클에 몇 건까지만 부른다 — 무료 엔드포인트라 몰아치면 막힌다.
  // 못 옮긴 것은 다음 사이클에 다시 후보가 된다(발췌가 그대로 남아 있으므로).
  async _translateFilledSummaries(items, limit = 20) {
    if (!this._translateText) return;
    const needs = [];
    for (const i of items) {
      if (!i || !i.summary || i.summaryTranslated === true) continue;
      // 원문이 한국어면 옮길 것이 없다. 한글이 한 자라도 있으면 우리 글로 본다.
      if (/[가-힣]/.test(i.summary)) continue;
      // 해외 소스로 표시된 것만 — 한글 없는 짧은 제목(숫자·영문 상품명 등)까지
      // 번역기에 보내면 헛돈다.
      if (!(i.translated === true || i.needsTranslation === true || (i.originalLang && i.originalLang !== "ko"))) continue;
      needs.push(i);
      if (needs.length >= limit) break;
    }
    for (const i of needs) {
      try {
        // 번역 **전** 원문을 붙잡아 둔다. 예전엔 i.summary를 바로 덮어써서
        // 원문이 사라졌다 — 상세 화면의 "원문 보기"가 제목만 바꾸고 발췌는
        // 번역문 그대로였던 원인이다(David 2026-08-06: "한글 번역본 볼 수 있는
        // 버튼은 없어. 기형적 구조임").
        //
        // 실측(라이브 풀 8,287건): 번역글 401건 중 originalTitle은 있는데
        // originalSummary는 **0건**이었다. translate.js는 둘 다 저장하는데
        // 여기서 채워진 발췌만 원문을 잃었기 때문이다 — 발췌를 나중에 채우는
        // enricher가 번역 **뒤에** 돌아서, translate.js를 이미 지난 상태다.
        const before = i.summary;
        const out = await this._translateText(before, { from: i.originalLang || "auto", to: "ko" });
        // 원문과 똑같이 돌아왔다면 번역이 안 된 것이다 — 영어를 그대로 남기지
        // 않는다(David 2026-08-05: "진짜 한 것만 띄우자").
        if (out && out !== before && /[가-힣]/.test(out)) {
          // 이미 원문이 있으면 덮지 않는다 — translate.js가 먼저 넣어 둔
          // 진짜 원문이 여기서 밀려나면 안 된다.
          if (!i.originalSummary) i.originalSummary = before;
          i.summary = out;
          i.summaryTranslated = true;
        } else {
          // 발췌를 버릴 때 원문도 함께 버린다. 화면에 한글 발췌가 없는데
          // 원문 발췌만 남으면 "한국어로 보기"를 눌러도 돌아올 곳이 없다.
          i.summary = "";
          if (i.originalSummary === before) i.originalSummary = null;
        }
      } catch { /* 한 건 실패가 나머지를 막지 않는다 */ }
    }
  }

  // 관심사 목록. 실패해도 브리핑을 막지 않는다 — 축 하나가 빠질 뿐이다.
  async _interests() {
    if (!this._interestsFn) return [];
    try { return (await this._interestsFn()) || []; } catch { return []; }
  }

  async _sharedBriefingContext({
    asOfMs = null,
    slotId = null,
    personalized = false,
    allowCarryover = false
  } = {}) {
    const requestedAsOf = asOfMs == null ? NaN : Number(asOfMs);
    const requestedNow = Number.isFinite(requestedAsOf)
      ? requestedAsOf
      : this._clock ? new Date(this._clock()).getTime() : Date.now();
    const requestedKstHour = new Date(requestedNow + 9 * 3600 * 1000).getUTCHours();
    const requestedSlotDef = slotId ? slotById(slotId) : slotForHour(requestedKstHour);
    const routingExpiresAt = Date.parse(this.editorialCategoryRoutingStatus?.expiresAt || "");
    const routingFreshness = Number.isFinite(routingExpiresAt) && requestedNow > routingExpiresAt
      ? "expired"
      : "fresh";
    const timeKey = Number.isFinite(requestedAsOf)
      ? `${requestedAsOf}:${requestedSlotDef.id}`
      : `${new Date(requestedNow + 9 * 3600 * 1000).toISOString().slice(0, 10)}:${requestedSlotDef.id}`;
    const key = JSON.stringify([
      timeKey,
      personalized,
      allowCarryover,
      this.lastRefreshedAt || null,
      this.editorialCategoryRouter ? this.editorialCategoryRoutingStatus : null,
      routingFreshness
    ]);
    if (this._briefingContextCache?.key === key) return this._briefingContextCache.promise;

    const promise = (async () => {
      const collectedItems = !this.editorialPreselectedPool && Number.isFinite(requestedAsOf)
        ? await this._itemsAsOf(requestedAsOf)
        : await this._items();
      // 첫 수집은 firstSeenAt을 요청 시각보다 몇 ms 뒤에 기록한다. 요청 시작
      // 시각으로 창을 자르면 막 모은 모든 글이 미래 글이 되어 첫 화면만 빈다.
      const now = Number.isFinite(requestedAsOf)
        ? requestedAsOf
        : this._clock ? new Date(this._clock()).getTime() : Date.now();
      const kstHour = new Date(now + 9 * 3600 * 1000).getUTCHours();
      const slotDef = slotId ? slotById(slotId) : slotForHour(kstHour);
      const items = personalized && this.editorialCategoryRouter
        ? this.editorialCategoryRouter(collectedItems, now)
        : collectedItems;
      const offMain = this._offMainSet();
      const admissible = (item) => item.kind !== "ad" && item.kind !== "affiliate" &&
        item.source !== "seed" && item.source !== "me" && promotable(item) &&
        !offMain.has(item.source)
        && (this.editorialPreselectedPool
          ? (!Number.isFinite(this.editorialPreselectedReferenceMs)
            || !tooOld(item, this.editorialPreselectedReferenceMs))
          : (
          !briefingTooOld(item, now, this._itemSourceMetadata?.get(item.source)) &&
          briefingTimestampEligible(item, this._itemSourceMetadata?.get(item.source))));
      const baseItems = items.filter(admissible);
      const evidenceBaseItems = collectedItems.filter(admissible);
      const carryoverWindowMs = EDITION_CANDIDATE_CONTRACT.carryoverMaxHours * 3600 * 1000;
      const sourceItems = evidenceBaseItems.filter((item) => {
        if (this.editorialPreselectedPool) return true;
        if (inBriefingWindow(item, now, slotDef, this._itemSourceMetadata)) return true;
        if (!personalized || !allowCarryover) return false;
        const at = briefingAvailableAt(item, this._itemSourceMetadata?.get(item.source));
        return Number.isFinite(at) && at <= now && now - at <= carryoverWindowMs;
      });
      const canonicalEvents = personalized ? buildEventClusters(sourceItems) : null;
      const leadEligibleIds = personalized && this.editorialCategoryRouter
        ? new Set(items.map((item) => item.routingOriginalId || item.id).filter(Boolean))
        : null;
      const routedById = new Map();
      for (const item of items) {
        for (const id of [item.id, item.routingOriginalId]) if (id) routedById.set(id, item);
      }
      const labelledSourceItems = sourceItems.map((item) => {
        const routed = routedById.get(item.id);
        return {
          ...item,
          ...(Array.isArray(routed?.admittedCategories)
            ? { admittedCategories: [...routed.admittedCategories] } : {}),
          ...(routed?.editorialImportance ? { editorialImportance: routed.editorialImportance } : {}),
          sourceLabel: this._labelFor(item)
        };
      });
      return {
        items,
        now,
        slotDef,
        baseItems,
        canonicalEvents,
        eventSourceIndex: personalized
          ? buildEventSourceIndex(labelledSourceItems, canonicalEvents, leadEligibleIds)
          : null,
        interests: await this._interests()
      };
    })();
    this._briefingContextCache = { key, promise };
    try {
      return await promise;
    } catch (error) {
      if (this._briefingContextCache?.promise === promise) this._briefingContextCache = null;
      throw error;
    }
  }

  async canonicalEventSources(issues, { asOfMs = null, slotId = null } = {}) {
    const context = await this._sharedBriefingContext({
      asOfMs,
      slotId,
      personalized: true,
      allowCarryover: false
    });
    return (issues || []).map((issue) => attachCanonicalEventSources(issue, context.eventSourceIndex));
  }

  async briefing({
    slotId = null,
    categories = null,
    userId = null,
    asOfMs = null,
    maxIssues = 6,
    perCategory = 3,
    candidateLimit = 60,
    minimumIssuesPerCategory = null,
    additiveCategoryUnion = false,
    personalized = false,
    includeCandidates = false,
    allowCarryover = false,
    servedCanonicalUrls = [],
    _sharedContext = null
  } = {}) {
    const sharedContext = _sharedContext || await this._sharedBriefingContext({
      asOfMs,
      slotId,
      personalized,
      allowCarryover
    });
    const { items, now, slotDef } = sharedContext;
    const selectedCategories = normalizedCategories(categories);
    const selectedSet = new Set(selectedCategories);
    const user = userId ? this.store.getUser(userId) : null;
    const visibleTopics = new Set(personalized ? (user && user.showTopics) || [] : []);
    for (const category of selectedCategories) {
      if (FILTERABLE_TOPICS.includes(category)) visibleTopics.add(category);
    }
    const perCategoryLimit = Math.max(1, Math.min(20, Math.floor(Number(perCategory) || 3)));
    const issueLimit = Math.max(
      MIN_ISSUES,
      Math.min(
        EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.maxGeneratedWithChangeReserve,
        Math.floor(Number(maxIssues) || 6)
      )
    );
    const fixtureLimit = Math.max(1, Math.min(
      EDITION_CANDIDATE_CONTRACT.maxCandidateCap,
      Math.floor(Number(candidateLimit) || EDITION_CANDIDATE_CONTRACT.defaultCandidateCap)
    ));
    // 그 시간대에 **새로 화제가 된 것**만 본다. 예전엔 풀 전체(48시간)를 그대로
    // 봐서 아침·점심·저녁 브리핑이 사실상 같은 글을 실었다. 창을 나눠야
    // "아침엔 밤사이 일, 저녁엔 오늘 일"이 성립한다.
    const authoritativeForeignNews = (item) => isAuthoritativeForeignNewsSource(
      this._itemSourceMetadata && this._itemSourceMetadata.get(item.source));
    const inWindow = this.editorialPreselectedPool
      ? () => true
      : (item) => inBriefingWindow(item, now, slotDef, this._itemSourceMetadata);
    // 정치 선택은 기존 공개 피드의 기본 숨김 계약을 바꾸지 않는다. 로컬 개인판에서
    // 사용자가 명시적으로 politics를 골랐을 때만 이미 판별된 정치 토픽을 해당
    // 분야의 편집 카테고리로 투영한다.
    const editionCategory = (item) => {
      const category = item.category || "news";
      const explicitScience = category === "science" && definiteCategory({
        title: item.title,
        url: item.url,
        sourceId: item.source
      }) === "science";
      return personalized && selectedSet.has("politics")
        && (item.topics || []).includes("politics") && !explicitScience
        ? "politics"
        : category;
    };
    const editionCategories = (item) => personalized && Array.isArray(item.admittedCategories)
      && item.admittedCategories.length ? item.admittedCategories : [editionCategory(item)];
    const eligibleBasePool = sharedContext.baseItems.filter((item) => !topicsBlocked(item, visibleTopics));
    const eligiblePool = eligibleBasePool
      .filter((i) => !selectedSet.size
        || editionCategories(i).some((category) => selectedSet.has(category)))
      .map((item) => {
      const categories = editionCategories(item);
      const category = selectedCategories.find((id) => categories.includes(id)) || categories[0];
      return category === item.category ? item : {
        ...item,
        registryCategory: item.registryCategory === undefined ? item.category : item.registryCategory,
        category
      };
    });
    const freshPool = eligiblePool.filter(inWindow);
    const servedUrls = new Set((servedCanonicalUrls || [])
      .map((url) => canonicalContentUrl(url))
      .filter(Boolean));
    const carryoverEnabled = personalized && allowCarryover && selectedSet.size > 0;
    const carryoverRows = [];
    if (carryoverEnabled) {
      const carryoverWindowMs = EDITION_CANDIDATE_CONTRACT.carryoverMaxHours * 3600 * 1000;
      const baseTarget = Math.max(
        perCategoryLimit,
        Math.floor(Number(minimumIssuesPerCategory) || 0)
      );
      // 중복·문장 게이트에서 일부가 빠져도 최종 14칸을 채울 수 있게, 이미
      // 판 변화 경로에서 쓰는 최대 8건의 대체 후보를 같은 재고 단계에 둔다.
      const target = baseTarget + Math.min(8, perCategoryLimit);
      // 이 단계는 최종 다양성 선별이 아니라 재고 확보 단계다. 출처별 3건으로
      // 막으면 부동산처럼 전문 매체가 3곳인 분야는 최대 9건밖에 못 모은다.
      // 최종 출처 균형은 후보 계약과 buildDigest가 뒤에서 담당한다.
      const sourceLimit = target;
      const capacity = new Map([...selectedSet].map((category) => [category, {
        count: 0,
        events: new Set(),
        urls: new Set(),
        sources: new Map()
      }]));
      const admitCapacity = (category, item) => {
        const state = capacity.get(category);
        if (!state) return false;
        const url = canonicalContentUrl(item.canonicalUrl || item.url);
        const event = eventKey(item.title);
        const source = item.source || item.sourceLabel || "unknown";
        if ((url && state.urls.has(url)) || (event && state.events.has(event)) ||
            (state.sources.get(source) || 0) >= sourceLimit) return false;
        if (url) state.urls.add(url);
        if (event) state.events.add(event);
        state.sources.set(source, (state.sources.get(source) || 0) + 1);
        state.count += 1;
        return true;
      };
      for (const item of freshPool) {
        if (!koreanAudienceReadable(item)) continue;
        for (const category of editionCategories(item)) {
          admitCapacity(category, item);
        }
      }
      const backlog = eligiblePool.filter((item) => {
        if (inWindow(item)) return false;
        const canonicalUrl = canonicalContentUrl(item.canonicalUrl || item.url);
        if (!canonicalUrl || servedUrls.has(canonicalUrl)) return false;
        const at = briefingAvailableAt(item);
        return Number.isFinite(at) && at <= now && now - at <= carryoverWindowMs;
      }).sort((a, b) =>
        Number(koreanAudienceReadable(b)) - Number(koreanAudienceReadable(a))
        || briefingAvailableAt(b) - briefingAvailableAt(a)
        || Number(a.sourceRank ?? Number.MAX_SAFE_INTEGER) - Number(b.sourceRank ?? Number.MAX_SAFE_INTEGER)
        || String(a.title || "").localeCompare(String(b.title || ""))
      );
      const seenUrls = new Set();
      for (const category of selectedSet) {
        const state = capacity.get(category);
        for (const item of backlog) {
          if (state.count >= target) break;
          if (!editionCategories(item).includes(category)) continue;
          admitCapacity(category, item);
          const canonicalUrl = canonicalContentUrl(item.canonicalUrl || item.url);
          if (!canonicalUrl || seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);
          const at = briefingAvailableAt(item);
          carryoverRows.push({
            ...item,
            editorialCarryover: {
              reason: "unserved_category_inventory",
              maxAgeHours: EDITION_CANDIDATE_CONTRACT.carryoverMaxHours,
              availableAt: new Date(at).toISOString(),
              ageHours: Math.max(0, Math.round((now - at) / 360000) / 10)
            }
          });
        }
      }
    }
    const pool = [...freshPool, ...carryoverRows];
    const engagement = (i) => (i.score || 0) + (i.commentCount || 0) * 2;

    // ── 관심사 축 (David 2026-08-05)
    // "트렌드 지수가 높은 관심사와 연관된 소식 중 가장 인용도 높고 반응 높은
    //  중요한 소식들 위주로."
    //
    // 실측(2026-08-05 라이브 30건)이 이 축의 필요를 그대로 보여 준다:
    //   기존 점수(반응+인용도) 중앙값 0 · 상위25% 105 · 상위10% 250 · 최대 1001
    //   **30건 중 19건이 0점** — 뉴스는 추천·댓글이 없어 서로 구분이 안 된다.
    // 그래서 뉴스끼리는 사실상 무작위였고, 반응이 큰 커뮤니티 글만 대표로 올랐다.
    // 그게 David가 말한 "사적·매니악함"의 뿌리다.
    //
    // 상수는 위 실측에서 그대로 가져왔다 — 지어낸 값이 아니다:
    //   검색량 1000+ 짜리 검색어에 제목이 걸리면 상위10%(250점)만큼 얹는다.
    //   무게 있는 분야(경제·정책·사회·정치)는 상위25%(105점)만큼 얹는다.
    // 순위를 뒤집는 게 아니라 축 하나를 더하는 것이다 — 반응 1001점짜리는
    // 그대로 위에 남는다.
    const INTEREST_MAX = 250;   // 실측 상위 10%
    const WEIGHTY_BONUS = 105;  // 실측 상위 25%
    const interests = sharedContext.interests;
    const interestOf = (i) => matchInterest(i, interests);
    const interestPoints = (m) => (m ? INTEREST_MAX * Math.min(1, (m.traffic || 0) / 1000) * m.strength : 0);
    const authorityPoints = (i) => {
      if (!authoritativeForeignNews(i)) return 0;
      if (i.editorialImportance === "pass") return INTEREST_MAX;
      if (i.editorialImportance === "fail") return 0;
      const observedAcrossFeeds = Math.max(
        Number(i.coverage) || 0,
        Number(i.relatedCoverage) || 0
      ) > 0;
      const marketConsequence = editionCategories(i).some((category) =>
        ["news", "business", "politics", "realestate", "tech", "auto"].includes(category))
        && findMarketSignalMatches([i], OVERSEAS_MARKET_SIGNAL_LEXICON).length > 0;
      if (!observedAcrossFeeds && !marketConsequence) return 0;
      return INTEREST_MAX;
    };
    const weight = (i) => {
      const m = interestOf(i);
      return engagement(i) + (i.coverage || 0) * 50
        + interestPoints(m)
        + (WEIGHTY.has(i.category) ? WEIGHTY_BONUS : 0)
        + authorityPoints(i);
    };

    const byCat = new Map();
    for (const i of pool) {
      for (const category of editionCategories(i)) {
        if (!byCat.has(category)) byCat.set(category, []);
        byCat.get(category).push(i);
      }
    }
    const sections = [];
    for (const [cat, list] of byCat) {
      // 화제성 순: 반응 실측 우선, 무신호 뉴스는 다중보도(coverage) 우선
      list.sort((a, b) => weight(b) - weight(a));
      // 같은 사건 중복 + 한 매체 독식 제거 (2026-08-02 검수 실측: 뉴스 브리핑
      // 10칸 중 동일 사건 2칸, 한 계열 매체 4칸, 제목에 '폭염' 6칸).
      // 브리핑은 10칸짜리 요약본이라 피드보다 중복 비용이 훨씬 크다.
      const seenEvent = new Set();
      const perOutlet = new Map();
      const top = [];
      for (const i of list) {
        const key = eventKey(i.title);
        if (key && seenEvent.has(key)) continue;
        const outlet = i.source || "";
        if ((perOutlet.get(outlet) || 0) >= 2) continue;
        if (key) seenEvent.add(key);
        perOutlet.set(outlet, (perOutlet.get(outlet) || 0) + 1);
        top.push(i);
        if (top.length >= perCategoryLimit) break;
      }
      if (!top.length) continue; // 공급 0인 카테고리만 스킵 — 1건이라도 있으면 싣는다
      // 대표 글(문장을 우리가 직접 쓰는 자리)은 비속어가 없는 것을 앞으로 당긴다.
      // 목록 행의 원문 제목은 그대로 둔다 — 표시 단계에서만 마스킹한다.
      // 대표 문장에 쓸 글 — 비속어뿐 아니라 "그 커뮤니티 안에서만 통하는 글"도
      // 뺀다. 브리핑 대표에 "300추 가능한가요?"가 올라온 실측이 있었다.
      const cleanFirst = top.findIndex((i) => promotable(i));
      if (cleanFirst > 0) top.unshift(top.splice(cleanFirst, 1)[0]);
      sections.push({
        category: cat,
        label: categoryLabel(cat),
        items: top.map((i) => ({
          id: i.id, title: i.title,
          // 발췌·원문 링크가 빠져 있어서 브리핑이 "요약"이 아니라 제목 나열이었다
          // (2026-08-02 검수: 10개 섹션 전부 같은 템플릿, 설명 문장 0개).
          // 피드에는 이미 summary가 있는데 브리핑에서 한 줄도 안 쓰고 있었다.
          // ① 외부 본문 발췌를 브리핑에 싣지 않는다 (2026-08-03).
          // 애드핏 보류 사유가 "외부 콘텐츠 비중"인데, 실측에서 이 자리에
          // 원문 URL("https://xcancel.com/...")과 영어 원문이 그대로 실리고
          // 있었다 — 우리 손으로 그 지적을 증명하던 셈이다.
          // 대신 우리가 측정한 값으로 쓴 문장이 digest.js에서 나온다(④).
          url: i.url || "",
          sourceLabel: this._labelFor(i),
          score: i.score || 0, commentCount: i.commentCount || 0,
          coverage: i.coverage || 0, publishedAt: i.publishedAt || null,
          weight: weight(i),
          // 왜 이 글이 여기 있는지 화면이 말할 수 있어야 한다. 근거 없이
          // 순위만 바꾸면 우리도 설명하지 못한다.
          interest: interestOf(i)
        }))
      });
    }
    // 섹션 정렬: 항목 화제성 합 순
    // 섹션 정렬도 같은 잣대로. 예전엔 반응 합만 봐서, 추천 수가 원래 큰
    // 커뮤니티 계열 섹션이 늘 맨 앞이었다.
    sections.sort((a, b) =>
      b.items.reduce((s, i) => s + i.weight, 0) - a.items.reduce((s, i) => s + i.weight, 0)
    );
    // 오늘 가장 뜨거운 논쟁(댓글 폭발) 한 건
    // '오늘의 논쟁'은 우리가 문장을 붙여 소개하는 자리다 — 비속어 제목은 고르지
    // 않는다(마스킹으로 덮기보다 다른 글을 고르는 편이 페이지 품질에 낫다).
    const debatePool = pool.filter((i) => (i.commentCount || 0) >= 30)
      .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
    const debate = debatePool.find((i) => promotable(i)) || null;
    // ④ 이슈 다이제스트 — 브리핑의 본문. 카테고리별 top3가 아니라 **풀 상위
    // 전체**를 재료로 묶는다(카테고리로 먼저 쪼개면 같은 사건이 서로 다른
    // 카테고리로 흩어져 묶이지 않는다 — 실측에서 6개 이슈가 전부 1건짜리였다).
    const ranked = [...pool]
      .map((i) => ({
        ...i,
        sourceLabel: this._labelFor(i),
        score: i.score || 0, commentCount: i.commentCount || 0,
        coverage: i.coverage || 0, tags: i.tags || [],
        category: i.category || "news", interest: interestOf(i),
        briefingAuthorityBonus: authorityPoints(i),
        briefingWeight: weight(i)
      }))
      .filter((i) => promotable(i))
      .sort((a, b) => b.briefingWeight - a.briefingWeight);

    // 동적 후보 계약은 로컬 개인판과 관리자 증거용이다. 기존 공개 브리핑에는
    // 새 응답 필드나 후보 컷을 끼워 넣지 않아 운영 동작을 그대로 보존한다.
    const useCandidateContract = personalized || includeCandidates;
    const candidateFixture = useCandidateContract ? buildEditionCandidateFixture(ranked, {
      registry: loadRegistry(),
      selectedCategories,
      limit: fixtureLimit,
      minPerSelectedCategory: perCategoryLimit,
      preferKoreanAudience: personalized,
      observedAt: new Date(now).toISOString()
    }) : null;
    const candidateIds = candidateFixture
      ? new Set(candidateFixture.candidates.map((row) => row.itemId))
      : null;
    const fixtureRanked = candidateIds
      ? ranked.filter((item) => candidateIds.has(item.id)).map((item) => ({ ...item, editorialCandidate: candidateFixture.candidates.find((row) => row.itemId === item.id) || null }))
      : ranked;

    // 후보 단계에서 소스 균형을 잡는다.
    //
    // 그냥 상위 60건을 자르면 그 60건이 한 소스로 채워진다 — 소스마다 score의
    // 의미와 스케일이 다르기 때문이다(더쿠 추천 16만 vs 해커뉴스 563, 뉴스는
    // 아예 0). 실측에서 브리핑 이슈 6개 중 5개가 더쿠였다. 다이제스트 쪽
    // 소스 상한만으로는 못 막는다 — 후보에 다른 소스가 아예 없으면 상한이
    // 풀리기 때문이다.
    //
    // 근본 해결은 소스 간 점수 정규화이고 그건 별건이다(검수 P1 "hotScore가
    // 정규화되지 않은 velocity 항 하나로 결정된다"). 여기서는 브리핑이 목적을
    // 잃지 않도록 편성 단계에서 막는다.
    const perSourceCandidates = new Map();
    const balancedPool = [];
    const perSourceLimit = Math.max(perCategoryLimit, Math.ceil(fixtureLimit / 10));
    for (const i of fixtureRanked) {
      const key = i.source || i.sourceLabel;
      const n = perSourceCandidates.get(key) || 0;
      if (n >= perSourceLimit) continue;
      perSourceCandidates.set(key, n + 1);
      balancedPool.push(i);
      if (balancedPool.length >= fixtureLimit) break;
    }
    // 아침에는 해외를 앞으로 당긴다. 한국이 자는 동안 새로 생긴 이야기는
    // 대부분 해외 쪽이고, 국내 커뮤니티는 그 시간에 조용하다.
    // 가중은 순서만 바꾸고 무엇을 뺄지는 정하지 않는다 — 국내가 크게 터진
    // 아침이면 국내가 그대로 앞에 온다.
    const bias = slotDef.overseasBias || 1;
    const slotPool = bias === 1 ? balancedPool : balancedPool.slice().sort((a, b) => {
      const w = (i) => ((i.score || 0) + (i.commentCount || 0) * 2) * (isOverseas(i) ? bias : 1);
      return w(b) - w(a);
    });
    // 사건은 사용자가 고른 분야와 무관한 고정값이다. 전체 유효 풀에서 한 번
    // 계산한 사건 묶음을 분야별 digest가 재사용해야, 분야를 바꿔도 같은 기사에
    // 다른 출처가 붙거나 무관한 기사가 합쳐지지 않는다.
    const canonicalEvents = personalized ? sharedContext.canonicalEvents : null;
    const minIssuesPerCategory = personalized && selectedCategories.length
      ? minimumIssuesPerCategory == null
        ? Math.max(1, Math.min(3, Math.floor(issueLimit / (selectedCategories.length * 2))))
        : Math.max(1, Math.min(
          Math.floor(issueLimit / selectedCategories.length),
          Math.floor(Number(minimumIssuesPerCategory) || 1)
        ))
      : 0;
    const digest = buildDigest(slotPool, {
      maxIssues: issueLimit,
      maxPerSource: personalized ? 3 : 2,
      selectedCategories,
      minIssuesPerCategory,
      additiveCategoryUnion,
      requireKoreanAudience: personalized,
      // v2 전용(David 승인, 2026-08-17) — 엔진 인스턴스에 주입됐을 때만 동작.
      // 운영 서버·v1 인프로세스 인스턴스는 null이라 이 인자가 undefined와
      // 같은 기본값으로 buildDigest에 전달돼 기존 동작이 바이트 그대로다.
      externalRank: this.editorialExternalRank || null,
      canonicalEvents
    });
    // 출처는 사용자가 고른 분야의 속성이 아니라 사건의 속성이다. 카드 선별은
    // 위의 분야별 pool을 그대로 쓰되, 출처 정본만 같은 시각의 전체 유효 풀에서
    // 계산해 분야 조합을 바꿔도 같은 사건이면 같은 매체 목록을 돌려준다.
    const eventSourceIndex = personalized ? sharedContext.eventSourceIndex : null;
    const issues = personalized
      ? digest.issues.map((issue) => attachCanonicalEventSources(
        enrichDigestIssue(issue, selectedCategories), eventSourceIndex))
      : digest.issues;
    const slot = slotDef;

    return {
      generatedAt: new Date(now).toISOString(),
      itemCount: pool.length,
      sourceCount: new Set(pool.map((i) => i.source)).size,
      // ④⑤ 이슈 본문 + 편성. publishable=false면 서버가 발행하지 않는다 —
      // 수집이 멈춘 시간대에 빈 브리핑이 나가는 것을 막는 안전장치.
      slot: { id: slot.id, label: slot.label, lead: slot.lead || null,
        windowHours: slot.windowHours, overseasBias: slot.overseasBias },
      overseasShare: pool.length ? Math.round(pool.filter(isOverseas).length / pool.length * 100) : 0,
      issues,
      digestSummary: digest.summary,
      ...(personalized ? { editorialQuality: digest.quality } : {}),
      ...(personalized ? {
        editorialCarryover: {
          stableId: "NOWHOT-UNSERVED-QUALITY-CARRYOVER-001",
          enabled: carryoverEnabled,
          maxAgeHours: EDITION_CANDIDATE_CONTRACT.carryoverMaxHours,
          sourceRoles: EDITION_CANDIDATE_CONTRACT.carryoverSourceRoles,
          servedCanonicalUrlCount: servedUrls.size,
          candidateCount: carryoverRows.length,
          categoryCounts: Object.fromEntries([...new Set(carryoverRows.flatMap(editionCategories))]
            .map((category) => [category, carryoverRows.filter((item) =>
              editionCategories(item).includes(category)).length])),
          selectedIssueCount: issues.filter((issue) => issue.metrics && issue.metrics.carryoverUsed).length,
          rule: "현재 슬롯 후보가 얇은 분야만 최근 24시간의 미제공 유효 콘텐츠로 목표 깊이까지 보충"
        }
      } : {}),
      publishable: issues.length >= MIN_ISSUES,
      ...(personalized ? {
        personalized: true,
        selectedCategories,
        categoryRouting: this.editorialCategoryRoutingStatus
      } : {}),
      ...(candidateFixture ? { candidateContract: candidateFixtureReceipt(candidateFixture) } : {}),
      ...(includeCandidates && candidateFixture ? { candidateFixture } : {}),
      // 카테고리 컷 없음 (David 2026-08-01 "모든 카테고리 다, 안 빼먹고") —
      // 공급이 2건 이상인 카테고리는 전부 싣는다. 정치만 공개 페이지 원칙상
      // 제외(위 pool 필터), 라이프처럼 공급이 빈 카테고리는 소스가 생기면
      // 자동으로 나타난다.
      sections,
      debate: debate && {
        id: debate.id, title: debate.title, commentCount: debate.commentCount,
        sourceLabel: this._labelFor(debate)
      }
    };
  }

  // 기존 브리핑을 사용자 선택 카테고리와 공급량에 맞춰 넓힌 로컬 오늘판.
  // 수집·랭킹·클러스터·문장 생성은 위 briefing()의 기존 경로를 그대로 쓰고,
  // 여기서는 명시적 선택과 분량만 결정한다. 사용자마다 LLM을 다시 부르지 않는다.
  async todayEdition({
    userId = null,
    categories = null,
    slotId = null,
    asOfMs = null,
    includeCandidates = false,
    reserveIssues = 0,
    sharedCanonical = false,
    allowCarryover = false,
    servedCanonicalUrls = [],
    categoryEditions = null,
    editionDate: requestedEditionDate = null
  } = {}) {
    const user = userId ? this.store.getUser(userId) : null;
    const selection = resolveEditorialSelection(categories, user);
    const selected = selection.selectedCategories;
    const mode = selection.mode;

    const count = selected.length;
    const perCategory = EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.perSelectedCategory;
    const maxIssues = editorialIssueBudget(count);
    const additiveCategoryUnion = true;
    // 이전 판과 같은 사건을 제거한 뒤에도 새 사건으로 지면을 채울 수 있도록
    // 서버의 판본 확정 경로만 여분 이슈를 요청한다. 기본값은 0이라 기존 호출과
    // 테스트·운영 브리핑은 그대로다.
    const changeReserve = Math.max(0, Math.min(8, Math.floor(Number(reserveIssues) || 0)));
    const generatedIssueBudget = Math.min(
      EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.maxGeneratedWithChangeReserve,
      maxIssues + changeReserve * count
    );
    // 후보 수는 제품 법칙이 아니다. 이슈 예산과 선택 분야 수에서 계산한 요청당
    // 안전 상한이며, 공급이 적으면 있는 만큼만 쓰고 많으면 품질 관문 뒤에서 자른다.
    const candidateCap = Math.min(
      EDITION_CANDIDATE_CONTRACT.maxCandidateCap,
      Math.max(generatedIssueBudget * 8, perCategory * count * 2)
    );
    const minIssuesPerCategory = selected.length
      ? editorialMinimumPerCategory(selected.length, maxIssues)
      : 0;
    // 직전 판과 같은 사건 한 건이 보류돼도 분야 최소 깊이가 무너지지 않도록
    // 변화 검사 전에는 분야마다 같은 수의 대체 후보를 더 요청한다. 여분을
    // 조합 전체가 나눠 가지면 선택 분야가 늘수록 각 분야가 먼저 비게 된다.
    const generationMinIssuesPerCategory = selected.length
      ? Math.floor(generatedIssueBudget / selected.length)
      : 0;
    const briefingUserId = sharedCanonical ? null : userId;
    const suppliedCategoryEditions = selected.length > 1 && Array.isArray(categoryEditions)
      ? selected.map((category) => {
        const row = categoryEditions.find((candidate) => candidate?.category === category);
        if (!row?.edition) throw new Error(`missing stored category edition: ${category}`);
        return { category, edition: row.edition };
      })
      : null;
    const sharedContext = suppliedCategoryEditions ? null : await this._sharedBriefingContext({
      asOfMs,
      slotId,
      personalized: true,
      allowCarryover
    });
    const briefingOptions = {
      slotId,
      userId: briefingUserId,
      asOfMs,
      perCategory,
      additiveCategoryUnion,
      personalized: true,
      allowCarryover,
      servedCanonicalUrls,
      _sharedContext: sharedContext
    };
    // 카테고리를 함께 넣고 한 번 더 선별하면 후보·소스 균형이 다시 계산되어
    // 단독판의 상위 기사 일부가 조합판에서 다른 기사로 바뀐다. 분야별 단독판을
    // 같은 예산으로 독립 생성한 뒤 순위 층으로 합치면, 선택은 노출만 바꾸고
    // 기사·출처·요약 정본은 건드리지 않는다.
    const edition = selected.length === 1
      ? await this.briefing({
        ...briefingOptions,
        categories: selected,
        maxIssues: generatedIssueBudget,
        candidateLimit: candidateCap,
        minimumIssuesPerCategory: generationMinIssuesPerCategory,
        includeCandidates
      })
      : mergeCategoryEditions(suppliedCategoryEditions || await Promise.all(selected.map(async (category) => ({
        category,
        edition: await this.briefing({
          ...briefingOptions,
          categories: [category],
          maxIssues: generationMinIssuesPerCategory,
          candidateLimit: Math.min(
            EDITION_CANDIDATE_CONTRACT.maxCandidateCap,
            Math.max(generationMinIssuesPerCategory * 8, perCategory * 2)
          ),
          minimumIssuesPerCategory: generationMinIssuesPerCategory,
          includeCandidates: true
        })
      }))), selected, candidateCap, includeCandidates);
    // 판 ID의 날짜는 **슬롯 기준 시각(asOfMs)** 으로 앵커한다 (2026-08-13
    // 9인 검수 후속): 생성 시각(generatedAt) 파생이면 과거 슬롯 판을 나중에
    // 만들 때 하루 밀린 ID가 붙었다 — 실측: 8-12 저녁 데이터 판이
    // "2026-08-13-evening-science" ID로 저장·서빙돼 servedDate(8-12)와
    // 모순됐다. late-backfill의 as-of 우선 원칙(DEVCHG-021)과 같은 잣대.
    const editionAnchorMs = Number.isFinite(asOfMs) ? Number(asOfMs) : Date.parse(edition.generatedAt);
    const editionDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedEditionDate || ""))
      ? requestedEditionDate
      : Number.isFinite(editionAnchorMs)
      ? new Date(editionAnchorMs + 9 * 3600 * 1000).toISOString().slice(0, 10)
      : String(edition.generatedAt || "").slice(0, 10);
    const availableCategories = CATEGORIES.map((category) => ({
      ...category,
      selected: selected.includes(category.id),
      supply: (edition.sections.find((section) => section.category === category.id) || { items: [] }).items.length
    }));
    const baseEdition = {
      ...edition,
      editionDate,
      editionId: `${editionDate}-${edition.slot.id}-${selected.slice().sort().join(".")}`,
      editorialMode: "deterministic_evidence_editor",
      llmCalls: 0,
      selection: {
        mode,
        categories: selected.map((id) => ({ id, label: categoryLabel(id) })),
        explicit: mode !== "preview",
        perCategory,
        maxIssues,
        categoryIssueLimit: perCategory,
        additiveCategoryUnion,
        generatedIssueBudget,
        changeReserve,
        candidateCap,
        minIssuesPerCategory,
        generationMinIssuesPerCategory
      },
      sharedCanonical,
      availableCategories,
      limits: [
        "현재 로컬 후보는 기존 결정론적 편집 문장만 사용하며 새 LLM 호출은 0회다.",
        "사람 블라인드 클러스터·주장 검수와 운영 배포 승인은 아직 남아 있다."
      ]
    };
    const fulfilled = attachEditorialFulfillment(baseEdition);
    if (!fulfilled.categoryFulfillment.goalSatisfied) {
      const unmet = fulfilled.categoryFulfillment.rows
        .filter((row) => row.state !== "met")
        .map((row) => row.label)
        .join("·");
      fulfilled.limits = [...fulfilled.limits,
        `선택 분야 중 ${unmet || "일부"}는 이번 판의 동적 최소 이슈 수를 충족하지 못했다.`];
    }
    return fulfilled;
  }

  // A single item with its full comment thread, for the detail view.
  // 같은 사건을 다룬 다른 소스 (애드핏 P0-A ⑤, David 2026-08-06).
  //
  // 상세 화면은 지금 발췌 몇 줄 + "원문에서 계속 읽기"라 사실상 **아웃링크
  // 통로**다. 애드핏 4차 반려 사유가 "아웃링크 비중이 높다"인데 이 페이지가
  // 정확히 그 모양이었다.
  //
  // 본문을 퍼오지 않고도 읽을 값어치를 만들 수 있다 — **우리만 아는 것**을
  // 붙이면 된다. 같은 사건을 어느 소스가 함께 다루고 있는지는 우리가 여러
  // 곳을 동시에 보기 때문에 아는 것이고, 원문 한 곳만 봐서는 알 수 없다.
  //
  // eventKey는 브리핑에서 같은 사건 중복을 걸러낼 때 쓰는 것과 **같은 함수**다.
  // 두 벌로 두면 언젠가 판정이 어긋난다.
  //
  // 피드·랭킹·브리핑이 거는 것과 **같은 관문**을 여기서도 건다. 상세의 관련글은
  // 이 글들로 가는 새 진입점이라, 여기만 안 걸면 앞에서 막은 것이 뒤로 샌다
  // (적대적 검수 2026-08-06 P1). 정치·종교는 사용자가 켜야 보이고, 관리자가
  // 끈 소스는 어디에도 나오지 않는다.
  _relatedItems(item, pool, { showTopics = new Set(), disabled = null } = {}) {
    const blocked = (r) =>
      topicsBlocked({ topics: r.topics || [] }, showTopics) ||
      (disabled && disabled.has(r.source));
    const seenSource = new Set([item.source]);
    const out = [];
    // 1) 수집 때 접힌 것들. 실제로는 대부분이 여기서 나온다 — 같은 사건은
    //    풀에 하나만 남기 때문에 풀을 뒤져 봐야 잘 안 나온다.
    //    id가 없으므로 우리 상세로 못 보낸다. 링크 없이 글자로만 보여 준다.
    for (const r of Array.isArray(item.related) ? item.related : []) {
      if (!r || !r.source || seenSource.has(r.source)) continue;
      if (blocked(r)) continue;
      seenSource.add(r.source);
      out.push({
        id: null, title: r.title,
        sourceLabel: r.sourceLabel || r.source, source: r.source,
        score: r.score || 0, commentCount: r.commentCount || 0,
        publishedAt: r.publishedAt || null
      });
      if (out.length >= 5) return out;
    }
    // 2) 접히지 않고 둘 다 살아남은 경우(수집 사이클이 갈렸을 때). 이쪽은
    //    풀에 있으니 눌러서 우리 상세로 넘어갈 수 있다.
    const key = eventKey(item.title);
    if (!key) return out;
    for (const other of pool) {
      if (other.id === item.id) continue;
      if (seenSource.has(other.source)) continue;      // 한 소스당 하나 — 목록이 한 곳으로 쏠리지 않게
      if (blocked(other)) continue;
      if (eventKey(other.title) !== key) continue;
      seenSource.add(other.source);
      out.push({
        id: other.id,
        title: other.title,
        sourceLabel: other.sourceLabel || other.source,
        source: other.source,
        score: other.score || 0,
        commentCount: other.commentCount || 0,
        publishedAt: other.publishedAt || null
      });
      if (out.length >= 5) break;
    }
    return out;
  }

  async getItem(userId, itemId, { explain = false } = {}) {
    // 상한 목록에 없으면 **누적 풀(48h)에서 찾는다.** 피드가 내놓은 글이
    // 다음 수집 사이클의 소스별 상한 재편성에서 빠질 수 있다 — 그러면 방금
    // 누른 글인데 "이 글은 지금 목록에 없어요"가 떴다(David 2026-08-07,
    // Alphabet 기사 실측: 풀 8,403 vs 상한 1,973). 풀에는 그대로 있다.
    const { item, items } = await this._detailContext(itemId);
    if (!item) return null;
    const user = this.store.getUser(userId);
    const showTopics = new Set((user && user.showTopics) || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : null;
    // **본 아이템에도 같은 관문을 건다.** 예전엔 관련글(_relatedItems)에만 걸어서,
    // 정치를 끈 사용자나 관리자가 차단한 소스의 글이 상세 직접 접근(공유 링크,
    // 검색 색인, 예전 기록)으로는 그대로 열렸다. 관문을 두 벌로 두면 한쪽이
    // 반드시 샌다 — 오늘만 이 유형을 세 번 만났다.
    const reason = disabled?.has(item.source) ? "SOURCE_DISABLED"
      : topicsBlocked(item, showTopics) ? "TOPIC_FILTERED" : null;
    if (reason) {
      if (explain) throw Object.assign(new Error(reason), { status: 403, code: reason });
      return null;
    }
    // never surface a 19금 item to a user who isn't verified + opted in
    const decorated = this._decorate(item, 0, user || { ratings: {} });
    return {
      ...decorated,
      thread: this.store.commentsFor(itemId),
      related: this._relatedItems(item, items, { showTopics, disabled })
    };
  }
}
