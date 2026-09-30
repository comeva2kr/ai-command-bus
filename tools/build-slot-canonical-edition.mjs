import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeArticleSummaryPipeline, isPreparedArticleSummary, isCurrentArticleSummary, articleContentId } from "../src/feed/article-summary.js";
import {
  CATEGORY_ROUTING_MAX_AGE_MS,
  validateCategoryRoutingSnapshot
} from "../src/feed/category-routing.js";
import { loadRegistry } from "../src/feed/registry.js";
import { unsafeForLead } from "../src/feed/profanity.js";
import {
  activateSlotCanonicalEdition,
  assertSlotCanonicalEdition,
  buildSlotCanonicalEdition,
  SLOT_CANONICAL_EDITION_CONTRACT,
  extraLaneRejection
} from "../src/feed/slot-canonical-edition.js";
import { SLOTS, slotForHour } from "../src/feed/digest.js";
import { expandRelatedNews } from "../src/feed/content.js";
import { canonicalContentUrl } from "../src/feed/dedupe.js";
import { applyEditionChanges } from "../src/feed/edition-change.js";
import { decideEventMerge, eventEntityTokens, isConfirmedEventFollowUp, parseExactNumber, sharedEventTokens } from "../src/feed/event-cluster.js";
import { VIDEO_TITLE_PREFIX } from "../src/feed/editorial-reader-copy.js";
import { briefingAvailableAt, inBriefingWindow } from "../src/feed/engine.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { memoizedTranslator } from "../src/feed/translate.js";
import { anthropicTranslator, googleFreeTranslator } from "../src/feed/translator.js";
import { buildCategoryRoutingSnapshot } from "./build-category-routing-snapshot.mjs";
import { buildTodayEditionInProcess, groupArticlesAsSources, validateTodayEdition } from "./build-editions.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HEADLINE_REVIEW_CONTRACT = "NOWHOT-HEADLINE-REVIEW-001";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const hasExactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const arg = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const argsFor = (args, name) => args.flatMap((value, index) =>
  value === name && args[index + 1] ? [args[index + 1]] : []);
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

export function poolRows(pool) {
  const rows = Array.isArray(pool) ? pool : pool?.rows || pool?.articles || pool?.items;
  if (!Array.isArray(rows) || !rows.length) throw new Error("slot edition: pool rows required");
  return expandRelatedNews(rows.map((row) => row?.item || row));
}

export function resolveSlotCanonicalBuildTarget({ pool, editionDate, slotId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(editionDate || ""))) {
    throw new Error("slot edition: invalid edition date");
  }
  const slot = SLOTS.find((row) => row.id === slotId);
  if (!slot) throw new Error("slot edition: invalid slot");
  const numeric = Number(pool?.savedAt);
  const evidenceAsOfMs = Number.isFinite(numeric) ? numeric : Date.parse(pool?.savedAt || "");
  if (!Number.isFinite(evidenceAsOfMs)) throw new Error("slot edition: pool savedAt required");
  const publishAtMs = Date.parse(`${editionDate}T${String(slot.publishHour).padStart(2, "0")}:00:00+09:00`);
  const windowStartMs = publishAtMs - slot.windowHours * 60 * 60 * 1000;
  const slotEndMs = publishAtMs + ((slot.toHour - slot.publishHour + 24) % 24) * 60 * 60 * 1000;
  if (evidenceAsOfMs < windowStartMs || evidenceAsOfMs > slotEndMs) {
    throw new Error(`slot edition: pool savedAt outside ${slotId} preparation window`);
  }
  return { editionDate, slotId, evidenceAsOfMs };
}

export function resolveSlotCanonicalReferenceNow(evidenceAsOfMs, routingGeneratedAt) {
  const routingGeneratedAtMs = Date.parse(routingGeneratedAt || "");
  if (!Number.isFinite(evidenceAsOfMs) || !Number.isFinite(routingGeneratedAtMs)
    || Math.abs(evidenceAsOfMs - routingGeneratedAtMs) > CATEGORY_ROUTING_MAX_AGE_MS) {
    throw new Error("slot edition: category routing snapshot is stale for pool");
  }
  return Math.max(evidenceAsOfMs, routingGeneratedAtMs);
}

export function assertSamePoolInputs({ poolRaw, packet, packetRaw, routingSnapshot }) {
  const poolSha256 = sha256(poolRaw);
  const packetSha256 = sha256(packetRaw);
  if (packet?.sourceSnapshot?.sha256 !== poolSha256) {
    throw new Error("slot edition: packet source pool SHA mismatch");
  }
  if (routingSnapshot?.source?.packetSha256 !== packetSha256) {
    throw new Error("slot edition: routing snapshot packet SHA mismatch");
  }
  const packetIds = (packet?.targets || []).flatMap((target) => target.sourceArticleIds || []).sort();
  const routingIds = (routingSnapshot?.entries || []).map((entry) => entry.itemId).sort();
  if (!packetIds.length || JSON.stringify(packetIds) !== JSON.stringify(routingIds)) {
    throw new Error("slot edition: routing entry coverage mismatch");
  }
  const poolIds = poolRows(JSON.parse(poolRaw)).map((row) => row?.id).sort();
  if (poolIds.some((id) => !id) || JSON.stringify(poolIds) !== JSON.stringify(packetIds)) {
    throw new Error("slot edition: pool article coverage mismatch");
  }
  return { poolSha256, packetSha256 };
}

export function assertSemanticPublicationRouting(snapshot) {
  validateCategoryRoutingSnapshot(snapshot);
  const invalid = snapshot.entries.filter((entry) =>
    !["current_model", "prior_exact_hash", "deterministic_tier_policy"].includes(entry.routingBasis)
    && !(entry.routingBasis === "withheld" && entry.categories.length === 0));
  if (invalid.length) {
    throw new Error(`slot edition: semantic classification required for ${invalid.length} admitted rows`);
  }
  return snapshot;
}

// Every lane takes its first 14 by lane rank. Positions 15..20 are filled lane by lane, with
// no shared quota, only by issues that already qualify on their own evidence (news lead from
// the current slot window, two independent source groups). Extras that do not qualify or do
// not fit are reported with their reason, not silently dropped.
export function assembleCategoryLanes(unionEdition, target = { editionDate: unionEdition?.editionDate, slotId: unionEdition?.slot?.id }) {
  if (!Array.isArray(unionEdition?.issues)) throw new TypeError("slot edition: union issues required");
  const { laneCapacity, extraLaneCapacity } = SLOT_CANONICAL_EDITION_CONTRACT;
  const extras = { policy: SLOT_CANONICAL_EDITION_CONTRACT.extraLanePolicy, admitted: [], withheld: [], rejected: [] };
  const editions = Object.fromEntries(CATEGORIES.map((category) => {
    const ranked = unionEdition.issues.map((issue, unionRank) => ({ issue, unionRank })).filter(({ issue }) => {
      if (!Array.isArray(issue.selectedByCategories)) {
        throw new Error(`slot edition: selectedByCategories missing '${issue?.evidenceHash || "unknown"}'`);
      }
      return issue.selectedByCategories.includes(category.id);
    }).sort((left, right) =>
      (left.issue._categoryLaneRanks?.[category.id] ?? Number.MAX_SAFE_INTEGER)
      - (right.issue._categoryLaneRanks?.[category.id] ?? Number.MAX_SAFE_INTEGER)
      || left.unionRank - right.unionRank).map(({ issue }) => issue);
    // NH167 F1: the same event is one card at every lane position. A candidate that the
    // single-truth event merge (plus the cross-slot identity guard) judges to be the same story
    // as an issue already placed in this lane is rejected, whether it would take a baseline or
    // an extra seat, and the freed seat goes to the next ranked candidate.
    const lane = [];
    for (const issue of ranked) {
      const record = { evidenceHash: issue.evidenceHash, category: category.id,
        headline: issue.preparedHeadline || issue.subject || issue.headline || null };
      const repeat = sameLaneEvent(lane, issue);
      if (repeat) { extras.rejected.push({ ...record, reason: "same_event_in_lane", sameAs: repeat.evidenceHash, basis: repeat.basis }); continue; }
      if (lane.length < laneCapacity) { lane.push(issue); continue; }
      const rejection = extraLaneRejection(issue, target);
      if (rejection) extras.rejected.push({ ...record, reason: rejection });
      else if (lane.length >= extraLaneCapacity) extras.withheld.push({ ...record, reason: `lane_capacity_${extraLaneCapacity}` });
      else { lane.push(issue); extras.admitted.push(record); }
    }
    return [category.id, { ...unionEdition, issues: lane }];
  }));
  return { editions, extras };
}

export function categoryEditionsFromUnion(unionEdition) {
  return assembleCategoryLanes(unionEdition).editions;
}

// Order matters: withhold cross-slot repeats on the whole generated edition first, so a
// repeated top-14 story frees its baseline seat for a fresh reserve candidate (which needs no
// extras qualification), and only then trim to lanes and qualified extras.
export function selectPublicationEdition(runEdition, servedArtifacts, target) {
  const repeatCheck = withholdServedEventRepeats(runEdition, servedArtifacts, target);
  const { editions: publicationLanes, extras } = assembleCategoryLanes(repeatCheck.edition, target);
  if (!Object.values(publicationLanes).some((edition) => edition.issues.length)) {
    throw new Error("slot edition: no qualified issues in any category");
  }
  const publicationIssues = new Set(Object.values(publicationLanes).flatMap((edition) => edition.issues));
  return {
    edition: { ...repeatCheck.edition, issues: repeatCheck.edition.issues.filter((issue) => publicationIssues.has(issue)) },
    repeatCheck,
    extras,
    generated: runEdition.issues.length
  };
}

export function assertSemanticLaneCoverage(unionEdition) {
  const editions = categoryEditionsFromUnion(unionEdition);
  if (!Object.values(editions).some(edition => edition.issues.length)) {
    throw new Error("slot edition: no qualified issues in any category");
  }
  // A quiet category must not stop the entire scheduled edition. The artifact
  // records actual verified coverage; its reader exposes underfilled lanes.
  return editions;
}

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const latinRatio = (value) => {
  const text = clean(value);
  return text.length ? (text.match(/[A-Za-z]/g) || []).length / text.length : 0;
};

export function headlineSource(issue) {
  const current = clean(issue?.subject || issue?.headline || issue?.reader?.headline);
  const rows = [...(issue?.eventSources || []), ...(issue?.refs || []), ...(issue?.sourceEvidence || [])]
    .filter((row) => row?.canLead !== false && clean(row?.originalTitle));
  return rows.find((row) => clean(row.title) === current) || rows[0] || null;
}

export function headlineNeedsPolish(issue) {
  const source = headlineSource(issue);
  if (!source) return false;
  const headline = clean(issue?.subject || issue?.headline || issue?.reader?.headline);
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(headline)
    || /(?:습니다|됩니다)[.!。]?$/.test(headline)
    || /(?:[A-Za-z][A-Za-z'’.-]*\s+){3,}[A-Za-z][A-Za-z'’.-]*/.test(headline)
    || /[A-Za-z][A-Za-z0-9'’.-]*(?:은|을)(?=\s|$|[.,!?])/.test(headline)
    || (headline.includes(" 및 ") && latinRatio(headline) > 0.45);
}

export async function polishIssueHeadlines(edition, {
  translateTitle,
  translateText = null,
  maxCalls = 24,
  preserveContentIds = new Set()
} = {}) {
  if (translateTitle === undefined) translateTitle = translateText;
  if (!translateTitle) return { edition, attempted: 0, changed: 0 };
  let attempted = 0;
  let changed = 0;
  const issues = [];
  for (const issue of edition?.issues || []) {
    if (preserveContentIds.has(articleContentId(issue))) { issues.push(issue); continue; }
    const source = headlineNeedsPolish(issue) ? headlineSource(issue) : null;
    if (!source || attempted >= maxCalls) { issues.push(issue); continue; }
    attempted += 1;
    // NH167 F3: a broadcaster's video prefix (Watch: / 시청:) is not part of the story.
    const translated = clean(await translateTitle(clean(source.originalTitle).replace(VIDEO_TITLE_PREFIX, ""), { from: "auto", to: "ko" }));
    if (translated && /[가-힣]/.test(translated) && !headlineNeedsPolish({
      ...issue,
      subject: translated,
      eventSources: [{ ...source, title: translated }],
      refs: [],
      sourceEvidence: []
    })) {
      issues.push({ ...issue, preparedHeadline: translated });
      changed += 1;
    } else {
      issues.push(issue);
    }
  }
  return { edition: { ...edition, issues }, attempted, changed };
}

export function applyHeadlineReview(edition, review = null, reviewSha256 = null) {
  if (!review) return { edition, applied: 0, receipt: null };
  if (!hasExactKeys(review, ["contract", "entries"])
    || review.contract !== HEADLINE_REVIEW_CONTRACT || !Array.isArray(review.entries)
    || !review.entries.length || !isSha(reviewSha256)) {
    throw new TypeError("slot edition headline review: invalid review");
  }
  const issues = new Map((edition?.issues || []).map((issue) => [issue.evidenceHash, issue]));
  const reviewed = new Map();
  for (const entry of review.entries) {
    const sourceUrl = clean(entry?.sourceUrl);
    const summaryOnly = Object.hasOwn(entry || {}, "sourceUrl");
    const headlineKo = summaryOnly ? null : clean(entry?.headlineKo);
    const hasSummaryReview = Object.hasOwn(entry || {}, "articleSummaryTextKo");
    const articleSummaryTextKo = hasSummaryReview ? clean(entry.articleSummaryTextKo) : null;
    const entryKeys = summaryOnly
      ? ["evidenceHash", "sourceUrl", "articleSummaryTextKo"]
      : ["evidenceHash", "originalTitle", "headlineKo",
        ...(hasSummaryReview ? ["articleSummaryTextKo"] : [])];
    let sourceProtocol = null;
    try { sourceProtocol = new URL(sourceUrl).protocol; } catch { /* validated below */ }
    if (!hasExactKeys(entry, entryKeys)
      || !isSha(entry.evidenceHash) || reviewed.has(entry.evidenceHash)
      || (summaryOnly
        ? (!hasSummaryReview || !sourceUrl || !["http:", "https:"].includes(sourceProtocol))
        : (typeof entry.originalTitle !== "string" || !entry.originalTitle.trim()
          || !headlineKo || !/[가-힣]/.test(headlineKo)))) {
      throw new TypeError("slot edition headline review: invalid entry");
    }
    if (headlineKo && unsafeForLead(headlineKo)) throw new Error("slot edition headline review: unsafe headline");
    const issue = issues.get(entry.evidenceHash);
    if (!issue) throw new Error("slot edition headline review: unknown evidenceHash");
    if (summaryOnly) {
      const issueSourceUrls = [
        ...(issue.eventSources || []),
        ...(issue.articleSummary?.sourceLinks || [])
      ].flatMap((row) => [clean(row?.url), clean(row?.canonicalUrl)]).filter(Boolean);
      if (!issueSourceUrls.includes(sourceUrl)) {
        throw new Error("slot edition headline review: sourceUrl mismatch");
      }
    } else if (clean(headlineSource(issue)?.originalTitle) !== clean(entry.originalTitle)) {
      throw new Error("slot edition headline review: originalTitle mismatch");
    }
    if (hasSummaryReview && (!articleSummaryTextKo || !/[가-힣]/.test(articleSummaryTextKo)
      || !["ready", "excerpt_only"].includes(issue.articleSummary?.status))) {
      throw new TypeError("slot edition headline review: invalid summary review");
    }
    reviewed.set(entry.evidenceHash, { headlineKo, articleSummaryTextKo });
  }
  const receipt = {
    contract: HEADLINE_REVIEW_CONTRACT,
    sha256: reviewSha256,
    applied: reviewed.size
  };
  return {
    edition: {
      ...edition,
      issues: edition.issues.map((issue) => {
        const entry = reviewed.get(issue.evidenceHash);
        if (!entry) return issue;
        return {
          ...issue,
          ...(entry.headlineKo ? { preparedHeadline: entry.headlineKo } : {}),
          ...(entry.articleSummaryTextKo ? {
            articleSummary: { ...issue.articleSummary, textKo: entry.articleSummaryTextKo }
          } : {})
        };
      }),
      headlineReviewReceipt: receipt
    },
    applied: reviewed.size,
    receipt
  };
}

export function foreignMajorLaneCoverage({
  pool,
  routingSnapshot,
  unionEdition,
  registry = loadRegistry(),
  nowMs = Date.now()
}) {
  const majorSources = new Set(registry
    .filter((source) => source.enabled === true && source.kind === "news"
      && source.editorialAuthority === "global_major")
    .map((source) => source.id));
  const articleById = new Map(poolRows(pool).map((row) => [row.id, row]));
  const majorArticleIds = new Set([...articleById]
    .filter(([, row]) => majorSources.has(row.source)).map(([itemId]) => itemId));
  const metadata = new Map(registry.map(source => [source.id, source]));
  const slot = SLOTS.find(row => row.id === unionEdition.slot?.id)
    || slotForHour(new Date(nowMs + 9 * 3600000).getUTCHours());
  const eligible = { news: new Set(), business: new Set(), tech: new Set() };
  const staleExcluded = { news: new Set(), business: new Set(), tech: new Set() };
  for (const entry of routingSnapshot.entries) {
    if (!majorArticleIds.has(entry.itemId)) continue;
    const row = articleById.get(entry.itemId);
    const timestamp = briefingAvailableAt(row, metadata.get(row.source));
    const inWindow = inBriefingWindow(row, nowMs, slot, metadata, unionEdition.editionDate);
    for (const category of entry.categories) {
      if (!eligible[category]) continue;
      if (inWindow) eligible[category].add(entry.itemId);
      else if (Number.isFinite(timestamp) && timestamp <= nowMs) {
        staleExcluded[category].add(entry.itemId);
      }
    }
  }
  const selected = { news: new Set(), business: new Set(), tech: new Set() };
  for (const issue of unionEdition.issues || []) {
    const ids = new Set([
      ...(issue.refs || []).map((row) => row.id),
      ...(issue.eventSources || []).map((row) => row.id),
      ...(issue.sourceEvidence || []).map((row) => row.itemId)
    ].filter(Boolean));
    const major = [...ids].some((id) => majorArticleIds.has(id))
      || (issue.eventSources || []).some((row) => majorSources.has(row.sourceId));
    if (!major) continue;
    for (const category of issue.selectedByCategories || []) if (selected[category]) selected[category].add(issue.evidenceHash);
  }
  return Object.fromEntries(Object.keys(eligible).map((category) => [category, {
    eligible: eligible[category].size,
    staleExcluded: staleExcluded[category].size,
    selected: selected[category].size
  }]));
}

export function editionObservationReceipt(artifact, { registry = loadRegistry() } = {}) {
  assertSlotCanonicalEdition(artifact);
  const registryByKey = new Map();
  for (const source of registry) {
    for (const key of [source.id, source.label, source.labelKo].filter(Boolean)) {
      registryByKey.set(String(key), source);
    }
  }
  const sourceRows = (issue) => [
    issue.eventSources,
    issue.articleSummary?.sourceLinks,
    issue.refs,
    issue.sourceEvidence
  ].find((rows) => Array.isArray(rows) && rows.length) || [];
  const lanes = {};
  for (const [category, ids] of Object.entries(artifact.lanes)) {
    const groups = new Set();
    const operatorIssueCounts = new Map();
    const counts = { domestic: 0, foreign: 0, mixed: 0, unknown: 0, multiSource: 0 };
    for (const id of ids) {
      const sources = sourceRows(artifact.issueTable[id]);
      const issueGroups = new Set();
      const issueOperators = new Set();
      const countries = new Set();
      for (const row of sources) {
        const group = String(row?.sourceGroup || row?.sourceId || row?.sourceLabel || row?.url || "").trim();
        if (group) { groups.add(group); issueGroups.add(group); }
        const source = registryByKey.get(String(row?.sourceId || ""))
          || registryByKey.get(String(row?.sourceGroup || ""))
          || registryByKey.get(String(row?.sourceLabel || ""));
        if (source?.country) countries.add(source.country);
        const operator = String(source?.operatorGroup || row?.sourceGroup || row?.sourceId || row?.sourceLabel || "").trim();
        if (operator) issueOperators.add(operator);
      }
      const hasDomestic = countries.has("KR");
      const hasForeign = [...countries].some((country) => country !== "KR");
      counts[hasDomestic && hasForeign ? "mixed" : hasDomestic ? "domestic" : hasForeign ? "foreign" : "unknown"] += 1;
      if (issueGroups.size > 1) counts.multiSource += 1;
      for (const operator of issueOperators) {
        operatorIssueCounts.set(operator, (operatorIssueCounts.get(operator) || 0) + 1);
      }
    }
    const topOperatorIssueCount = Math.max(0, ...operatorIssueCounts.values());
    lanes[category] = {
      issueCount: ids.length,
      sourceGroupCount: groups.size,
      operatorGroupCount: operatorIssueCounts.size,
      topOperatorShare: ids.length ? Number((topOperatorIssueCount / ids.length).toFixed(4)) : 0,
      multiSourceIssueCount: counts.multiSource,
      domesticIssueCount: counts.domestic,
      foreignIssueCount: counts.foreign,
      mixedIssueCount: counts.mixed,
      unknownOriginIssueCount: counts.unknown
    };
  }
  return {
    contractId: "NOWHOT-SLOT-OBSERVATION-001",
    artifactId: artifact.artifactId,
    editionDate: artifact.editionDate,
    slotId: artifact.slot.id,
    lanes
  };
}

// Article URLs earlier slots already published, each with the titles served under it.
// A same-slot rebuild is not earlier. Related observations were only cited, not served,
// so they stay eligible. The same URL carrying a changed title (사망 3명 → 5명) is an
// update the change classifier must see, so it is not removed here.
const servedTitleKey = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
function earlierSlotServedUrls(servedArtifacts, target) {
  const served = new Map();
  const note = (row) => {
    for (const url of [row?.url, row?.canonicalUrl].map(canonicalContentUrl).filter(Boolean)) {
      if (!served.has(url)) served.set(url, new Set());
      for (const title of [row?.title, row?.originalTitle].map(servedTitleKey).filter(Boolean)) served.get(url).add(title);
    }
  };
  for (const artifact of earlierServedArtifacts(servedArtifacts, target)) {
    for (const issue of Object.values(artifact.issueTable)) {
      const evidence = issue.sourceEvidence || [];
      const related = new Set(evidence.filter((row) => row?.evidenceRole === "related_observation")
        .flatMap((row) => [row?.url, row?.canonicalUrl]).map(canonicalContentUrl).filter(Boolean));
      const rows = [...evidence.filter((row) => ["lead", "corroborating"].includes(row?.evidenceRole)),
        ...[...(issue.refs || []), ...(issue.eventSources || []), ...evidence]
          .filter((row) => row?.evidenceRole !== "related_observation")];
      for (const row of rows) {
        const urls = [row?.url, row?.canonicalUrl].map(canonicalContentUrl).filter(Boolean);
        const servedAsEvidence = ["lead", "corroborating"].includes(row?.evidenceRole);
        if (!servedAsEvidence && urls.length && urls.every((url) => related.has(url))) continue;
        note(row);
      }
    }
  }
  return served;
}

// Artifacts strictly earlier than the target, in the same order earlierSlotServedUrls uses.
function earlierServedArtifacts(servedArtifacts, target) {
  const order = (date, slotId) => `${date}:${SLOTS.findIndex(row => row.id === slotId)}`;
  return [servedArtifacts].flat().filter((artifact) => artifact?.issueTable
    && order(artifact.editionDate, artifact.slot?.id) < order(target.editionDate, target.slotId));
}

// Exact-URL dedupe cannot see the same event arriving under another outlet's URL, and a
// same-URL update passes it on purpose. Reuse the edition change classifier against every
// earlier slot of the day to find the previous issue, then judge the change on demonstrated
// facts only: a number the earlier headline did not state (사망 3명 → 5명) or a confirmed
// outcome of a scheduled event (발사 예정 → 발사 성공). A paraphrase (같은 말 + 확인), another
// outlet, an evidence-mode change or a fingerprint difference alone is not new evidence.
// Kept issues stay the builder's own objects; only the decision is taken from the classifier.
// Quantities are read from the lead article title only: generated headlines embed reaction
// counts (추천 734건) and secondary references carry unrelated figures. Where the source keeps
// its original title, that original is the fact record; a translated title that states a
// different number than its original does not prove a new fact.
const leadArticle = (issue) => {
  const lead = issue?.eventSources?.[0] || issue?.refs?.[0] || {};
  const ref = issue?.refs?.[0] || {};
  return {
    id: lead.evidenceId || ref.id || issue?.evidenceHash || null,
    kind: issue?.metrics?.communityOnly === true ? "community" : "news",
    source: lead.sourceId || ref.source || ref.ownershipGroup || null,
    url: lead.canonicalUrl || lead.url || ref.canonicalUrl || ref.url || null,
    publishedAt: lead.publishedAt || ref.publishedAt || issue?.firstPublishedAt || null,
    title: lead.title || ref.title || issue?.subject || issue?.headline || "",
    originalTitle: lead.originalTitle || null
  };
};
// The in-slot classifier's concept match also fires on boilerplate tokens shared by generated
// headlines (복수·수집·경로·확인, 이토랜드·상위·댓글). Across slots only an identity match, or a
// concept match confirmed by the single-truth event merge decision on the two lead articles,
// counts as the same story.
const IDENTITY_MATCHES = new Set(["shared_ref_id", "shared_canonical_url", "shared_normalized_title", "same_subject_and_category"]);
// Conservative identity for a merge-confirmed concept match: most of the shorter headline's
// entities must be shared (product variants like 고스트페이스 에어포스 1 vs 방수 에어포스 1 fail;
// a witness statement or political response to an earlier incident also fails and stays a new
// development), unless the two headlines share a large stated quantity (8700억 군산 수주).
const CROSS_SLOT_MIN_ENTITY_SHARE = 0.6;
const CROSS_SLOT_STRONG_QUANTITY = 100;
const leadTitle = (issue) => { const lead = leadArticle(issue); return lead.originalTitle || lead.title; };
// ponytail: explicit headline quantities cover demonstrated updates; unrecognized prose needs editorial review.
// Keep units so a new amount is distinguishable from a year, tenure, or a product model number.
// NH167 F1: the same amount spelled differently (1천60만대 = 1060만대 = 1,060만대, $99 = $99.00)
// is one quantity; the exact value is kept and rendered back in Korean units for receipts.
function formatKoreanNumber(value) {
  if (!Number.isSafeInteger(value) || value < 10000) return String(value);
  const parts = [];
  let rest = value;
  for (const [unit, size] of [["조", 1e12], ["억", 1e8], ["만", 1e4]]) {
    const count = Math.floor(rest / size);
    if (count) { parts.push(`${count}${unit}`); rest -= count * size; }
  }
  if (rest) parts.push(String(rest));
  return parts.join("");
}
function canonicalQuantity(value) {
  const parsed = parseExactNumber(value);
  return parsed ? `${formatKoreanNumber(parsed.value)}${value.replace(/^[\d.,조억만천백]+/u, "")}` : value;
}
const quantityValue = (value) => parseExactNumber(value)?.value ?? parseFloat(value.replace(/^[$€£₩]/, ""));
function headlineQuantities(title) {
  const text = String(title || "").toLowerCase();
  const quantities = text.match(/[$€£₩]\s*\d[\d,.]*(?:\s*(?:million|billion|trillion))?|\d[\d,.]*(?:(?:억|조|만|천)\d*)*(?:원|달러|명|건|가구|관왕|%|배|개(?!월)|곳|대)|\d[\d,.]*(?:억|조)|\d[\d,.]*\s+(?:dead|killed|injured|people|dollars|percent)\b/giu) || [];
  return [...new Set(quantities.map(value => canonicalQuantity(value.replace(/[\s,]/g, "")
    .replace(/(?:dead|killed|injured|people)$/, "명").replace(/dollars$/, "달러").replace(/percent$/, "%")
    .replace(/([억조])원$/, "$1").replace(/^\$(\d+(?:\.\d+)?)$/, "$1달러"))))];
}
function conservativeSameEventTitles(beforeTitle, afterTitle) {
  const before = eventEntityTokens(beforeTitle);
  const after = eventEntityTokens(afterTitle);
  const shared = sharedEventTokens(beforeTitle, afterTitle);
  const shorter = Math.min(before.length, after.length);
  if (!shorter) return { same: false, basis: "distinct:no_entities" };
  const share = shared.length / shorter;
  const afterQuantities = new Set(headlineQuantities(afterTitle));
  const strongQuantity = headlineQuantities(beforeTitle).some(value => afterQuantities.has(value) && quantityValue(value) >= CROSS_SLOT_STRONG_QUANTITY);
  if (share >= CROSS_SLOT_MIN_ENTITY_SHARE || (strongQuantity && shared.length >= 3)) {
    return { same: true, basis: `entity_share:${share.toFixed(2)}${strongQuantity ? "+quantity" : ""}` };
  }
  return { same: false, basis: `distinct:low_entity_share:${share.toFixed(2)}` };
}
const conservativeSameEvent = (previous, current) => conservativeSameEventTitles(leadTitle(previous), leadTitle(current));
// A merge that passed the number guard on corroborated summary evidence (NH167 F1) already shares a
// stated sales quantity of at least 1000, which is the strong-quantity identity the guard looks for.
const identityAfterMerge = (decision, guard) => guard.same || decision.reason.includes("|summary_number:")
  ? { same: true, basis: `event_merge:${decision.reason}|${guard.same ? guard.basis : "corroborated_quantity"}` }
  : guard;
export function sameServedEvent(previous, current, matchMethod) {
  if (IDENTITY_MATCHES.has(matchMethod)) return { same: true, basis: matchMethod };
  const decision = decideEventMerge(leadArticle(previous), leadArticle(current));
  if (!decision.merge) return { same: false, basis: `distinct:${decision.reason}` };
  return identityAfterMerge(decision, conservativeSameEvent(previous, current));
}
// Lead-eligible reporting rows of an issue as event articles (title, original title, summary,
// time). Two issues in one lane are the same story when any pair of their rows passes the same
// two-step test used across slots: the single-truth event merge, then the conservative identity
// guard. Community-only issues keep their strong-match-only behaviour through decideEventMerge.
const leadEligibleArticles = (issue) => {
  const kind = issue?.metrics?.communityOnly === true ? "community" : "news";
  const rows = (issue?.eventSources || []).filter((row) => row?.canLead !== false && clean(row?.title || row?.originalTitle));
  const articles = rows.map((row) => ({
    id: row.evidenceId || null, kind, source: row.sourceId || null,
    url: row.canonicalUrl || row.url || null, publishedAt: row.publishedAt || issue?.firstPublishedAt || null,
    title: row.title || row.originalTitle || "", originalTitle: row.originalTitle || null, summary: row.summary || null
  }));
  return articles.length ? articles : [leadArticle(issue)];
};
const articleTitle = (article) => article.originalTitle || article.title;
// Two lead titles that both state quantities, neither set containing the other, are two facts
// (22년 1060만대 vs 22년 1100만대): the later card stays even though the event merge accepts the
// shared year. A title without a stated quantity (1000만 고지) does not conflict.
function leadQuantityConflict(placed, candidate) {
  const before = new Set(headlineQuantities(leadTitle(placed)));
  const after = new Set(headlineQuantities(leadTitle(candidate)));
  if (!before.size || !after.size) return false;
  const subset = (left, right) => [...left].every((value) => right.has(value));
  return !subset(before, after) && !subset(after, before);
}
export function sameEditionEvent(placed, candidate) {
  if (leadQuantityConflict(placed, candidate)) return { same: false, basis: "distinct:lead_quantity_conflict" };
  for (const a of leadEligibleArticles(placed)) {
    for (const b of leadEligibleArticles(candidate)) {
      const decision = decideEventMerge(a, b);
      if (!decision.merge) continue;
      const identity = identityAfterMerge(decision, conservativeSameEventTitles(articleTitle(a), articleTitle(b)));
      if (identity.same) return identity;
    }
  }
  return { same: false, basis: "distinct" };
}
function sameLaneEvent(lane, issue) {
  for (const placed of lane) {
    const identity = sameEditionEvent(placed, issue);
    if (identity.same) return { evidenceHash: placed.evidenceHash, basis: identity.basis };
  }
  return null;
}
// A first stated amount or changed count can be new evidence; a date, model number or tenure cannot.
export function crossSlotMaterialChange(previous, current) {
  const before = new Set(headlineQuantities(leadTitle(previous)));
  const newNumbers = headlineQuantities(leadTitle(current)).filter((number) => !before.has(number));
  if (newNumbers.length) return { material: true, basis: "changed_headline_number", numbers: newNumbers };
  if (isConfirmedEventFollowUp(leadArticle(previous), leadArticle(current))) {
    return { material: true, basis: "confirmed_follow_up" };
  }
  return { material: false, basis: "no_demonstrated_fact_change" };
}
export function withholdServedEventRepeats(edition, servedArtifacts, target) {
  const earlier = earlierServedArtifacts(servedArtifacts, target);
  const issues = Array.isArray(edition?.issues) ? edition.issues : [];
  if (!earlier.length || !issues.length) {
    return { edition, withheld: [], kept: [], comparedEditions: earlier.length };
  }
  const historyEditions = earlier.map((artifact) => ({
    editionId: artifact.artifactId,
    issues: Object.values(artifact.issueTable)
  }));
  // One candidate at a time: the classifier's one-to-one continuity claim must not let a
  // second repeat of the same served story pass as "new" because a first repeat claimed it.
  const annotated = issues.map((issue) => applyEditionChanges({ ...edition, issues: [issue] }, null, {
    historyEditions, enforceRepeatRule: false, attachMatchedIssue: true
  }).issues[0]);
  const withheld = [];
  const kept = [];
  const distinct = [];
  const filtered = issues.filter((issue, index) => {
    const row = annotated[index];
    const evidence = row.changeEvidence || {};
    if (!evidence.matchMethod || !evidence.matchedIssue) return true;
    const identity = sameServedEvent(evidence.matchedIssue, issue, evidence.matchMethod);
    if (!identity.same) {
      distinct.push({ evidenceHash: issue.evidenceHash || null, matchMethod: evidence.matchMethod,
        matchedEvidenceHash: evidence.matchedIssue.evidenceHash || null, basis: identity.basis });
      return true;
    }
    const change = crossSlotMaterialChange(evidence.matchedIssue, issue);
    const record = {
      sameEventBasis: identity.basis,
      evidenceHash: issue.evidenceHash || null,
      headline: issue.preparedHeadline || issue.subject || issue.headline || null,
      changeState: row.changeState,
      matchMethod: evidence.matchMethod,
      matchedEditionId: evidence.matchedEditionId || null,
      matchedEvidenceHash: evidence.matchedIssue.evidenceHash || null,
      matchedHeadline: evidence.matchedIssue.preparedHeadline || evidence.matchedIssue.subject || evidence.matchedIssue.headline || null,
      matchRatio: evidence.matchRatio ?? null,
      matchedTerms: evidence.matchedTerms || [],
      basis: change.basis,
      ...(change.numbers ? { numbers: change.numbers } : {})
    };
    (change.material ? kept : withheld).push(record);
    return change.material;
  });
  return { edition: { ...edition, issues: filtered }, withheld, kept, distinct, comparedEditions: earlier.length };
}

// Filter before collection deduplication, caps, category ranking and event formation.
// An unchanged article is not a new slot candidate; newer reports of its event are.
export function slotSourceArticles({ pool, target, metadata, servedArtifact = null }) {
  const slot = SLOTS.find(row => row.id === target.slotId);
  const served = earlierSlotServedUrls(servedArtifact, target);
  return poolRows(pool).filter(item =>
    ((item.kind || metadata.get(item.source)?.kind || "news") !== "news"
      || inBriefingWindow({ ...item, kind: "news" }, target.evidenceAsOfMs, slot, metadata, target.editionDate))
    && ![item.url, item.canonicalUrl, ...(item.canonicalAliases || []).map((alias) => alias?.url)]
      .some((url) => {
        const titles = served.get(canonicalContentUrl(url));
        if (!titles) return false;
        const current = [item.title, item.originalTitle].map(servedTitleKey).filter(Boolean);
        // Unknown served titles (older artifacts) or an unchanged title: already served.
        return !titles.size || !current.length || current.some((title) => titles.has(title));
      }));
}

export function reusePreparedArticleDetails(edition, previousIssues = [], nowMs = Date.now()) {
  const facts = (issue) => JSON.stringify((issue.eventSources || []).map((row) =>
    [row.evidenceId, row.canonicalUrl, row.sourceId, row.sourceLabel, row.sourceGroup,
      row.title, row.originalTitle, row.originalLang, row.summary, row.publishedAt, row.image,
      row.evidenceRole, row.canLead, row.relay]
      .map((value) => value ?? null)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const previous = new Map(previousIssues.map((issue) => [articleContentId(issue), issue]));
  const contentIds = new Set();
  let reused = 0;
  const issues = edition.issues.map((issue) => {
    const prior = previous.get(articleContentId(issue));
    if (!issue.eventSources?.length || !prior
      || !["ready", "excerpt_only"].includes(prior.articleSummary?.status)
      || !isCurrentArticleSummary(prior.articleSummary, issue, nowMs)
      || facts(issue) !== facts(prior)) return issue;
    reused += 1;
    contentIds.add(articleContentId(issue));
    return { ...issue,
      subject: prior.subject || issue.subject,
      headline: prior.headline || issue.headline,
      ...(prior.preparedHeadline ? { preparedHeadline: prior.preparedHeadline } : {}),
      articleSummary: structuredClone(prior.articleSummary) };
  });
  return { edition: { ...edition, issues }, reused, contentIds };
}

export async function buildSlotCanonicalEditionCandidate({
  pool,
  packet,
  packetRaw,
  predictions,
  predictionsRaw,
  routingSnapshot = null,
  poolRaw,
  editionDate,
  slotId,
  evidenceAsOfMs = null,
  workDir,
  previousArtifact = null,
  servedArtifact = previousArtifact,
  apiKey = null,
  summaryModel = process.env.NOWHOT_ARTICLE_SUMMARY_MODEL || "claude-sonnet-5",
  verifierModel = process.env.NOWHOT_ARTICLE_SUMMARY_VERIFIER_MODEL || "claude-sonnet-5",
  invoke,
  fetchArticle,
  fetchImpl = fetch,
  translateText = memoizedTranslator(googleFreeTranslator({ fetchImpl })),
  translateTitle,
  headlineReview = null,
  headlineReviewSha256 = null,
  onUsage = null
}) {
  const target = resolveSlotCanonicalBuildTarget({ pool, editionDate, slotId });
  const poolEvidenceAsOf = evidenceAsOfMs != null && Number.isFinite(Number(evidenceAsOfMs))
    ? Number(evidenceAsOfMs)
    : target.evidenceAsOfMs;
  const activeRoutingSnapshot = routingSnapshot
    ? validateCategoryRoutingSnapshot(routingSnapshot)
    : buildCategoryRoutingSnapshot(packet, predictions, {
        packetSha256: sha256(packetRaw), predictionsSha256: sha256(predictionsRaw)
      });
  assertSemanticPublicationRouting(activeRoutingSnapshot);
  const identity = assertSamePoolInputs({ poolRaw, packet, packetRaw, routingSnapshot: activeRoutingSnapshot });
  const referenceNow = resolveSlotCanonicalReferenceNow(
    poolEvidenceAsOf,
    activeRoutingSnapshot.generatedAt
  );
  fs.mkdirSync(workDir, { recursive: true });
  const metadata = new Map(loadRegistry().map(source => [source.id, source]));
  const sources = groupArticlesAsSources(slotSourceArticles({
    pool, target: { ...target, evidenceAsOfMs: poolEvidenceAsOf }, metadata, servedArtifact
  }));
  const allCategories = CATEGORIES.map((category) => category.id);
  const run = await buildTodayEditionInProcess({
    sources,
    nowMs: referenceNow,
    storeFile: path.join(workDir, "feed-data.json"),
    poolFile: path.join(workDir, "feed-pool.json"),
    categoryRoutingSnapshot: activeRoutingSnapshot,
    directBuild: true,
    categories: allCategories,
    slotId: target.slotId,
    editionDate: target.editionDate,
    reserveIssues: 8,
    laneDepth: SLOT_CANONICAL_EDITION_CONTRACT.extraLaneCapacity,
    editorialPreselectedPool: true,
    editorialPreselectedReferenceMs: poolEvidenceAsOf
  });
  if (run.status !== 200 || !run.edition) {
    throw new Error(`slot edition: union build failed (${run.status}) ${run.body?.code || run.body?.error || ""}`.trim());
  }
  const schema = validateTodayEdition(run.edition);
  if (!schema.ok) throw new Error(`slot edition: today schema invalid: ${schema.errors.join("; ")}`);
  const { edition: publicationEdition, repeatCheck, extras: selectionExtras, generated } = selectPublicationEdition(run.edition, servedArtifact, target);
  const detailReuse = reusePreparedArticleDetails(publicationEdition,
    previousArtifact ? Object.values(assertSlotCanonicalEdition(previousArtifact).issueTable) : [], referenceNow);
  const summaryPipeline = makeArticleSummaryPipeline({
    enabled: Boolean(apiKey),
    apiKey,
    model: summaryModel,
    verifierModel,
    allowRecovery: false,
    completeBeforePublish: true,
    batchSize: Number(process.env.NOWHOT_ARTICLE_SUMMARY_BATCH_SIZE || 8),
    fetchArticle,
    fetchImpl,
    translateText,
    invoke,
    onUsage,
    clock: () => referenceNow
  });
  const summarizedEdition = await summaryPipeline(detailReuse.edition);
  const headlinePolish = await polishIssueHeadlines(summarizedEdition, {
    translateTitle, translateText, preserveContentIds: detailReuse.contentIds
  });
  const headlineReviewResult = applyHeadlineReview(
    headlinePolish.edition, headlineReview, headlineReviewSha256
  );
  const unionEdition = headlineReviewResult.edition;
  const unprepared = unionEdition.issues.filter((issue) => !isPreparedArticleSummary(issue.articleSummary, issue));
  if (unprepared.length) {
    const sample = unprepared.slice(0, 3).map((issue) => ({
      evidenceHash: issue.evidenceHash,
      headline: issue.headline,
      status: issue.articleSummary?.status || null,
      reason: issue.articleSummary?.unavailableReasonCode || issue.articleSummary?.failureCode || null
    }));
    throw new Error(`slot edition: ${unprepared.length} article details are not prepared ${JSON.stringify(sample)}`);
  }
  // Rejections and overflow were decided on the generated edition; the prepared union only re-derives the lanes.
  const { editions: editionsByCategory, extras: preparedExtras } = assembleCategoryLanes(unionEdition,
    { editionDate: target.editionDate, slotId: target.slotId });
  const laneExtras = { ...preparedExtras, withheld: selectionExtras.withheld, rejected: selectionExtras.rejected };
  const foreignMajorCoverage = foreignMajorLaneCoverage({
    pool, routingSnapshot: activeRoutingSnapshot, unionEdition, nowMs: poolEvidenceAsOf
  });
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory,
    unionEdition,
    builderPacketSha256: identity.packetSha256,
    routingSnapshot: activeRoutingSnapshot,
    summaryBuildMode: apiKey ? "paid_allowed" : "free_only"
  });
  return {
    artifact,
    routingSnapshot: activeRoutingSnapshot,
    unionEdition,
    identity,
    foreignMajorCoverage,
    detailReuse: { reused: detailReuse.reused, total: publicationEdition.issues.length },
    laneExtras,
    servedEventRepeats: {
      comparedEditions: repeatCheck.comparedEditions,
      candidates: generated,
      published: publicationEdition.issues.length,
      withheld: repeatCheck.withheld.length,
      keptAsMaterialUpdate: repeatCheck.kept.length,
      conceptMatchesJudgedDistinct: repeatCheck.distinct.length,
      withheldIssues: repeatCheck.withheld,
      keptIssues: repeatCheck.kept,
      distinctIssues: repeatCheck.distinct
    },
    headlinePolish: { attempted: headlinePolish.attempted, changed: headlinePolish.changed },
    headlineReview: headlineReviewResult.receipt
  };
}

async function main() {
  const args = process.argv.slice(2);
  const poolFile = arg(args, "--pool");
  const packetFile = arg(args, "--packet");
  const predictionsFile = arg(args, "--predictions");
  const routingSnapshotFile = arg(args, "--routing-snapshot");
  const headlineReviewFile = arg(args, "--headline-review");
  const reuseEditionFile = arg(args, "--reuse-edition");
  const servedEditionFiles = argsFor(args, "--served-edition");
  const editionDate = arg(args, "--date");
  const slotId = arg(args, "--slot");
  const outDir = path.resolve(arg(args, "--out-dir") || path.join(ROOT, ".nowhot-local/slot-editions"));
  const activate = args.includes("--activate");
  if (!poolFile || !packetFile || !editionDate || !slotId || (!predictionsFile && !routingSnapshotFile)) {
    throw new Error("usage: --pool <pool.json> --packet <packet.json> (--predictions <predictions.json> | --routing-snapshot <snapshot.json>) --date YYYY-MM-DD --slot <morning|lunch|evening> [--headline-review review.json] [--reuse-edition edition.json] [--served-edition edition.json ...] [--out-dir dir] [--activate] [--allow-paid]");
  }
  const poolRaw = fs.readFileSync(poolFile, "utf8");
  const packetRaw = fs.readFileSync(packetFile, "utf8");
  const predictionsRaw = predictionsFile ? fs.readFileSync(predictionsFile, "utf8") : null;
  const routingSnapshotRaw = routingSnapshotFile ? fs.readFileSync(routingSnapshotFile, "utf8") : null;
  const headlineReviewRaw = headlineReviewFile ? fs.readFileSync(headlineReviewFile, "utf8") : null;
  const pool = JSON.parse(poolRaw);
  const target = resolveSlotCanonicalBuildTarget({ pool, editionDate, slotId });
  const usage = [];
  const apiKey = args.includes("--allow-paid") ? process.env.ANTHROPIC_API_KEY || null : null;
  const result = await buildSlotCanonicalEditionCandidate({
    pool,
    packet: JSON.parse(packetRaw),
    packetRaw,
    predictions: predictionsRaw ? JSON.parse(predictionsRaw) : null,
    predictionsRaw,
    routingSnapshot: routingSnapshotRaw ? JSON.parse(routingSnapshotRaw) : null,
    poolRaw,
    editionDate: target.editionDate,
    slotId: target.slotId,
    evidenceAsOfMs: target.evidenceAsOfMs,
    workDir: path.join(outDir, `.work-${process.pid}`),
    previousArtifact: reuseEditionFile ? assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(reuseEditionFile, "utf8"))) : null,
    servedArtifact: servedEditionFiles.length
      ? servedEditionFiles.map((file) => assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(file, "utf8"))))
      : undefined,
    apiKey,
    translateTitle: apiKey
      ? memoizedTranslator(anthropicTranslator({ apiKey, onUsage: (row) => usage.push(row) }))
      : undefined,
    headlineReview: headlineReviewRaw ? JSON.parse(headlineReviewRaw) : null,
    headlineReviewSha256: headlineReviewRaw ? sha256(headlineReviewRaw) : null,
    onUsage: (row) => usage.push(row)
  });
  const candidateFile = path.join(outDir,
    `candidate-${result.artifact.editionDate}-${result.artifact.slot.id}-${result.artifact.contentSha256.slice(0, 12)}.json`);
  atomicJson(candidateFile, result.artifact);
  const receiptFile = path.join(outDir,
    `receipt-${result.artifact.editionDate}-${result.artifact.slot.id}-${result.artifact.contentSha256.slice(0, 12)}.json`);
  const receipt = {
    state: "candidate_ready",
    artifactId: result.artifact.artifactId,
    contentSha256: result.artifact.contentSha256,
    editionDate: result.artifact.editionDate,
    slotId: result.artifact.slot.id,
    poolSha256: result.identity.poolSha256,
    packetSha256: result.identity.packetSha256,
    issueCount: result.artifact.displayOrder.length,
    headlinePolish: result.headlinePolish,
    detailReuse: result.detailReuse,
    servedEventRepeats: result.servedEventRepeats,
    laneExtras: result.laneExtras,
    headlineReview: result.headlineReview,
    laneCounts: Object.fromEntries(Object.entries(result.artifact.lanes).map(([id, rows]) => [id, rows.length])),
    detailStatuses: result.artifact.displayOrder.reduce((counts, id) => {
      const status = result.artifact.issueTable[id].articleSummary.status;
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {}),
    routingBasisCounts: result.routingSnapshot.counts?.routingBasis || null,
    foreignMajorCoverage: result.foreignMajorCoverage,
    observation: editionObservationReceipt(result.artifact),
    llmUsage: usage,
    candidateFile,
    activatedFile: null,
    requestPathWork: "pointer_read_and_filter_only"
  };
  atomicJson(receiptFile, receipt);
  const activation = activate
    ? activateSlotCanonicalEdition({
        artifact: result.artifact,
        directory: outDir,
        pointerFile: path.join(outDir, "active.json")
      })
    : null;
  if (activation) {
    receipt.state = "activated";
    receipt.activatedFile = activation.artifactFile;
    atomicJson(receiptFile, receipt);
  }
  process.stdout.write(`${JSON.stringify(activation ? {
    ...receipt,
    state: "activated",
    activatedFile: activation.artifactFile
  } : receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
