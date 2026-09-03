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
  SLOT_CANONICAL_EDITION_CONTRACT
} from "../src/feed/slot-canonical-edition.js";
import { SLOTS } from "../src/feed/digest.js";
import { AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS } from "../src/feed/selection-axes.js";
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
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

export function poolRows(pool) {
  const rows = Array.isArray(pool) ? pool : pool?.rows || pool?.articles || pool?.items;
  if (!Array.isArray(rows) || !rows.length) throw new Error("slot edition: pool rows required");
  return rows.map((row) => row?.item || row);
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

export function categoryEditionsFromUnion(unionEdition) {
  if (!Array.isArray(unionEdition?.issues)) throw new TypeError("slot edition: union issues required");
  return Object.fromEntries(CATEGORIES.map((category) => [category.id, {
    ...unionEdition,
    issues: unionEdition.issues.map((issue, unionRank) => ({ issue, unionRank })).filter(({ issue }) => {
      if (!Array.isArray(issue.selectedByCategories)) {
        throw new Error(`slot edition: selectedByCategories missing '${issue?.evidenceHash || "unknown"}'`);
      }
      return issue.selectedByCategories.includes(category.id);
    }).sort((left, right) =>
      (left.issue._categoryLaneRanks?.[category.id] ?? Number.MAX_SAFE_INTEGER)
      - (right.issue._categoryLaneRanks?.[category.id] ?? Number.MAX_SAFE_INTEGER)
      || left.unionRank - right.unionRank
    ).slice(0, SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory).map(({ issue }) => issue)
  }]));
}

export function assertSemanticLaneCoverage(unionEdition) {
  const editions = categoryEditionsFromUnion(unionEdition);
  const minimum = SLOT_CANONICAL_EDITION_CONTRACT.activationMinimumPerCategory;
  const underfilled = Object.entries(editions)
    .filter(([, edition]) => edition.issues.length < minimum)
    .map(([category, edition]) => `${category} ${edition.issues.length}/${minimum}`);
  if (underfilled.length) {
    throw new Error(`slot edition: semantic lane coverage short (${underfilled.join(", ")})`);
  }
  return editions;
}

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const latinRatio = (value) => {
  const text = clean(value);
  return text.length ? (text.match(/[A-Za-z]/g) || []).length / text.length : 0;
};

function headlineSource(issue) {
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
    const translated = clean(await translateTitle(source.originalTitle, { from: "auto", to: "ko" }));
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
    const headlineKo = clean(entry?.headlineKo);
    if (!hasExactKeys(entry, ["evidenceHash", "originalTitle", "headlineKo"])
      || !isSha(entry.evidenceHash) || reviewed.has(entry.evidenceHash)
      || typeof entry.originalTitle !== "string" || !entry.originalTitle.trim()
      || !headlineKo || !/[가-힣]/.test(headlineKo)) {
      throw new TypeError("slot edition headline review: invalid entry");
    }
    if (unsafeForLead(headlineKo)) throw new Error("slot edition headline review: unsafe headline");
    const issue = issues.get(entry.evidenceHash);
    if (!issue) throw new Error("slot edition headline review: unknown evidenceHash");
    if (clean(headlineSource(issue)?.originalTitle) !== clean(entry.originalTitle)) {
      throw new Error("slot edition headline review: originalTitle mismatch");
    }
    reviewed.set(entry.evidenceHash, headlineKo);
  }
  const receipt = {
    contract: HEADLINE_REVIEW_CONTRACT,
    sha256: reviewSha256,
    applied: reviewed.size
  };
  return {
    edition: {
      ...edition,
      issues: edition.issues.map((issue) => reviewed.has(issue.evidenceHash)
        ? { ...issue, preparedHeadline: reviewed.get(issue.evidenceHash) }
        : issue),
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
  const windowMs = AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS * 3600 * 1000;
  const availableAt = (row) => {
    const seen = Number.isFinite(row?.firstSeenAt) ? row.firstSeenAt : NaN;
    const published = row?.publishedAt ? Date.parse(row.publishedAt) : NaN;
    return Number.isFinite(published) ? published : seen;
  };
  const eligible = { news: new Set(), business: new Set(), tech: new Set() };
  const staleExcluded = { news: new Set(), business: new Set(), tech: new Set() };
  for (const entry of routingSnapshot.entries) {
    if (!majorArticleIds.has(entry.itemId)) continue;
    const timestamp = availableAt(articleById.get(entry.itemId));
    const inWindow = !Number.isFinite(timestamp)
      || (timestamp <= nowMs && nowMs - timestamp <= windowMs);
    for (const category of entry.categories) {
      if (!eligible[category]) continue;
      if (inWindow) eligible[category].add(entry.itemId);
      else if (Number.isFinite(timestamp) && nowMs - timestamp > windowMs) {
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
  const poolEvidenceAsOf = Number.isFinite(Number(evidenceAsOfMs))
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
  const sources = groupArticlesAsSources(poolRows(pool));
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
    editorialPreselectedPool: true,
    editorialPreselectedReferenceMs: referenceNow
  });
  if (run.status !== 200 || !run.edition) {
    throw new Error(`slot edition: union build failed (${run.status}) ${run.body?.code || run.body?.error || ""}`.trim());
  }
  const schema = validateTodayEdition(run.edition);
  if (!schema.ok) throw new Error(`slot edition: today schema invalid: ${schema.errors.join("; ")}`);
  const publicationLanes = assertSemanticLaneCoverage(run.edition);
  const publicationIssues = new Set(Object.values(publicationLanes)
    .flatMap((edition) => edition.issues));
  const publicationEdition = {
    ...run.edition,
    issues: run.edition.issues.filter((issue) => publicationIssues.has(issue))
  };

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
  const editionsByCategory = categoryEditionsFromUnion(unionEdition);
  const foreignMajorCoverage = foreignMajorLaneCoverage({
    pool, routingSnapshot: activeRoutingSnapshot, unionEdition, nowMs: referenceNow
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
  const editionDate = arg(args, "--date");
  const slotId = arg(args, "--slot");
  const outDir = path.resolve(arg(args, "--out-dir") || path.join(ROOT, ".nowhot-local/slot-editions"));
  const activate = args.includes("--activate");
  if (!poolFile || !packetFile || !editionDate || !slotId || (!predictionsFile && !routingSnapshotFile)) {
    throw new Error("usage: --pool <pool.json> --packet <packet.json> (--predictions <predictions.json> | --routing-snapshot <snapshot.json>) --date YYYY-MM-DD --slot <morning|lunch|evening> [--headline-review review.json] [--reuse-edition edition.json] [--out-dir dir] [--activate] [--allow-paid]");
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
