import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeArticleSummaryPipeline, isPreparedArticleSummary } from "../src/feed/article-summary.js";
import {
  CATEGORY_ROUTING_MAX_AGE_MS,
  validateCategoryRoutingSnapshot
} from "../src/feed/category-routing.js";
import { loadRegistry } from "../src/feed/registry.js";
import { activateSlotCanonicalEdition, buildSlotCanonicalEdition } from "../src/feed/slot-canonical-edition.js";
import { SLOTS } from "../src/feed/digest.js";
import { AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS } from "../src/feed/selection-axes.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { memoizedTranslator } from "../src/feed/translate.js";
import { googleFreeTranslator } from "../src/feed/translator.js";
import { buildCategoryRoutingSnapshot } from "./build-category-routing-snapshot.mjs";
import { buildTodayEditionInProcess, groupArticlesAsSources, validateTodayEdition } from "./build-editions.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
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
  if (!SLOTS.some((slot) => slot.id === slotId)) throw new Error("slot edition: invalid slot");
  const numeric = Number(pool?.savedAt);
  const evidenceAsOfMs = Number.isFinite(numeric) ? numeric : Date.parse(pool?.savedAt || "");
  if (!Number.isFinite(evidenceAsOfMs)) throw new Error("slot edition: pool savedAt required");
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
  return { poolSha256, packetSha256 };
}

export function categoryEditionsFromUnion(unionEdition) {
  if (!Array.isArray(unionEdition?.issues)) throw new TypeError("slot edition: union issues required");
  return Object.fromEntries(CATEGORIES.map((category) => [category.id, {
    ...unionEdition,
    issues: unionEdition.issues.filter((issue) => {
      if (!Array.isArray(issue?.selectedByCategories)) {
        throw new Error(`slot edition: selectedByCategories missing '${issue?.evidenceHash || "unknown"}'`);
      }
      return issue.selectedByCategories.includes(category.id);
    })
  }]));
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
    const times = [seen, published].filter(Number.isFinite);
    return times.length ? Math.max(...times) : NaN;
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
  const floors = { news: 3, business: 3, tech: 2 };
  return Object.fromEntries(Object.keys(floors).map((category) => [category, {
    eligible: eligible[category].size,
    staleExcluded: staleExcluded[category].size,
    selected: selected[category].size,
    required: Math.min(floors[category], eligible[category].size)
  }]));
}

export function assertForeignMajorLaneCoverage(coverage) {
  for (const [category, row] of Object.entries(coverage)) {
    if (row.selected < row.required) {
      throw new Error(`slot edition: ${category} foreign-major floor ${row.selected}/${row.required}`);
    }
  }
  return coverage;
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
  apiKey = null,
  summaryModel = process.env.NOWHOT_ARTICLE_SUMMARY_MODEL || "claude-sonnet-5",
  verifierModel = process.env.NOWHOT_ARTICLE_SUMMARY_VERIFIER_MODEL || "claude-sonnet-5",
  invoke,
  fetchArticle,
  fetchImpl = fetch,
  translateText = memoizedTranslator(googleFreeTranslator({ fetchImpl })),
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
    editorialPreselectedPool: true
  });
  if (run.status !== 200 || !run.edition) {
    throw new Error(`slot edition: union build failed (${run.status}) ${run.body?.code || run.body?.error || ""}`.trim());
  }
  const schema = validateTodayEdition(run.edition);
  if (!schema.ok) throw new Error(`slot edition: today schema invalid: ${schema.errors.join("; ")}`);

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
  const unionEdition = await summaryPipeline(run.edition);
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
  const foreignMajorCoverage = assertForeignMajorLaneCoverage(foreignMajorLaneCoverage({
    pool, routingSnapshot: activeRoutingSnapshot, unionEdition, nowMs: referenceNow
  }));
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory,
    unionEdition,
    builderPacketSha256: identity.packetSha256,
    routingSnapshot: activeRoutingSnapshot
  });
  return { artifact, routingSnapshot: activeRoutingSnapshot, unionEdition, identity, foreignMajorCoverage };
}

async function main() {
  const args = process.argv.slice(2);
  const poolFile = arg(args, "--pool");
  const packetFile = arg(args, "--packet");
  const predictionsFile = arg(args, "--predictions");
  const routingSnapshotFile = arg(args, "--routing-snapshot");
  const editionDate = arg(args, "--date");
  const slotId = arg(args, "--slot");
  const outDir = path.resolve(arg(args, "--out-dir") || path.join(ROOT, ".nowhot-local/slot-editions"));
  const activate = args.includes("--activate");
  if (!poolFile || !packetFile || !editionDate || !slotId || (!predictionsFile && !routingSnapshotFile)) {
    throw new Error("usage: --pool <pool.json> --packet <packet.json> (--predictions <predictions.json> | --routing-snapshot <snapshot.json>) --date YYYY-MM-DD --slot <morning|lunch|evening> [--out-dir dir] [--activate]");
  }
  const poolRaw = fs.readFileSync(poolFile, "utf8");
  const packetRaw = fs.readFileSync(packetFile, "utf8");
  const predictionsRaw = predictionsFile ? fs.readFileSync(predictionsFile, "utf8") : null;
  const routingSnapshotRaw = routingSnapshotFile ? fs.readFileSync(routingSnapshotFile, "utf8") : null;
  const pool = JSON.parse(poolRaw);
  const target = resolveSlotCanonicalBuildTarget({ pool, editionDate, slotId });
  const usage = [];
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
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    onUsage: (row) => usage.push(row)
  });
  const candidateFile = path.join(outDir,
    `candidate-${result.artifact.editionDate}-${result.artifact.slot.id}-${result.artifact.contentSha256.slice(0, 12)}.json`);
  atomicJson(candidateFile, result.artifact);
  const activation = activate
    ? activateSlotCanonicalEdition({
        artifact: result.artifact,
        directory: outDir,
        pointerFile: path.join(outDir, "active.json")
      })
    : null;
  const receipt = {
    state: activation ? "activated" : "candidate_ready",
    artifactId: result.artifact.artifactId,
    contentSha256: result.artifact.contentSha256,
    editionDate: result.artifact.editionDate,
    slotId: result.artifact.slot.id,
    poolSha256: result.identity.poolSha256,
    packetSha256: result.identity.packetSha256,
    issueCount: result.artifact.displayOrder.length,
    laneCounts: Object.fromEntries(Object.entries(result.artifact.lanes).map(([id, rows]) => [id, rows.length])),
    detailStatuses: result.artifact.displayOrder.reduce((counts, id) => {
      const status = result.artifact.issueTable[id].articleSummary.status;
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {}),
    routingBasisCounts: result.routingSnapshot.counts?.routingBasis || null,
    foreignMajorCoverage: result.foreignMajorCoverage,
    llmUsage: usage,
    candidateFile,
    activatedFile: activation?.artifactFile || null,
    requestPathWork: "pointer_read_and_filter_only"
  };
  atomicJson(path.join(outDir,
    `receipt-${result.artifact.editionDate}-${result.artifact.slot.id}-${result.artifact.contentSha256.slice(0, 12)}.json`), receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
