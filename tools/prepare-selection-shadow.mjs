// D2-D — 실제 수집 풀을 유료 호출 없이 semantic shadow 입력으로 동결한다.
// legacy category는 감사용으로만 보존하고 모델의 declaredSection으로 승격하지 않는다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCategoryEventViews } from "../src/feed/category-event-view.js";
import {
  categoryGuardReason,
  definiteCategory,
  isGeneralNewsGuardReason,
  MIXED_NEUTRAL_CATEGORY
} from "../src/feed/classify.js";
import { validateCategoryRoutingSnapshot } from "../src/feed/category-routing.js";
import { d1cTaxonomyVersion, normalizeClassifierInput } from "../src/feed/selection-classifier-lab.js";
import { loadRegistry } from "../src/feed/registry.js";
import { findMarketSignalMatches, OVERSEAS_MARKET_SIGNAL_LEXICON } from "../src/feed/selection-axes.js";
import { isKnownCategory } from "../src/feed/taxonomy.js";
import { getCandidate } from "./selection-candidate-registry.mjs";

export const SELECTION_SHADOW_PACKET_CONTRACT = "NOWHOT-SELECTION-SHADOW-PACKET-001";
export const SELECTION_SHADOW_MEASUREMENT_CONTRACT = "NOWHOT-SELECTION-SHADOW-MEASUREMENT-001";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sortedCounts = (values) => Object.fromEntries([...values].sort().map((key) => [key, values.filter((value) => value === key).length]));

const articlesFromPool = (pool) => (Array.isArray(pool?.rows) ? pool.rows : [])
  .map((row) => isObject(row) && Object.hasOwn(row, "item") ? row.item : row)
  .filter(Boolean);

const representativePriority = (article, meta = {}) =>
  (Array.isArray(meta.defaultTags) && meta.defaultTags.length > 0 ? 4 : 0)
  + (meta.sourceTier === "specialist" ? 2 : 0)
  + (meta.sourceTier === "aggregate" ? 0 : 1);

const deterministicRoutingVote = (article, meta = {}) => {
  if (!isKnownCategory(article?.category) || meta.feedGroup === "deal") return null;
  const declared = isKnownCategory(article.registryCategory) ? article.registryCategory
    : isKnownCategory(meta.category) ? meta.category : null;
  if (article.kind === "community" && meta.kind === "community") {
    const mixedCategory = meta.mixed === true ? definiteCategory({
      title: article.title,
      url: article.url,
      sourceId: article.source
    }) : null;
    return meta.mixed === true ? mixedCategory || MIXED_NEUTRAL_CATEGORY : declared || article.category;
  }
  if (article.kind !== "news") return null;
  const generalNews = meta.category === "news";
  const foreignOrWorld = meta.feedGroup === "gnews"
    || Boolean(meta.country && meta.country !== "KR");
  if (generalNews && foreignOrWorld
    && meta.editorialAuthority === "global_major"
    && meta.categoryRouting === "declared_section") {
    return "news";
  }
  if (generalNews && foreignOrWorld) {
    return findMarketSignalMatches([article], OVERSEAS_MARKET_SIGNAL_LEXICON).length ? "news" : null;
  }
  const generalNewsGuard = meta.sourceTier === "aggregate"
    ? categoryGuardReason(declared || article.category, article.title, article) : null;
  if (isGeneralNewsGuardReason(generalNewsGuard)) {
    const observedAcrossFeeds = Math.max(
      Number(article.coverage) || 0,
      Number(article.relatedCoverage) || 0
    ) > 0;
    return generalNewsGuard !== "incident-without-tech-subject" || observedAcrossFeeds ? "news" : null;
  }
  const freshCategory = definiteCategory({ title: article.title, url: article.url, sourceId: article.source });
  const urlCategory = definiteCategory({ title: "", url: article.url, sourceId: article.source });
  if ((meta.sourceTier === "specialist" || meta.categoryRouting === "declared_section") && declared) {
    const validCorrection = article.categoryCorrection?.rule === "specialist-title-definite"
      && freshCategory === article.category;
    return validCorrection ? article.category : declared;
  }
  if (meta.sourceTier === "aggregate" && declared && meta.category !== "news") {
    if (urlCategory) return urlCategory;
    if (article.category === "auto" && freshCategory !== "auto") return declared;
    return article.category;
  }
  if (meta.sourceTier === "aggregate" && generalNews && meta.country === "KR") {
    return freshCategory
      || (Math.max(Number(article.coverage) || 0, Number(article.relatedCoverage) || 0) > 0 ? "news" : null);
  }
  return null;
};

const selectionShadowRank = (articles) => {
  const representative = (target) => target.sourceArticleIds.map((id) => articles.get(id)).filter(Boolean)
    .sort((a, b) => (Number(b.hotScorePrev) || 0) - (Number(a.hotScorePrev) || 0)
      || (Number(b.score) || 0) - (Number(a.score) || 0)
      || (Number(b.commentCount) || 0) - (Number(a.commentCount) || 0)
      || (Number(b.viewCount) || 0) - (Number(a.viewCount) || 0)
      || String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""))
      || String(a.id).localeCompare(String(b.id)))[0];
  return (a, b) => {
    const left = representative(a) || {};
    const right = representative(b) || {};
    return (Number(right.hotScorePrev) || 0) - (Number(left.hotScorePrev) || 0)
      || (Number(right.score) || 0) - (Number(left.score) || 0)
      || (Number(right.commentCount) || 0) - (Number(left.commentCount) || 0)
      || (Number(right.viewCount) || 0) - (Number(left.viewCount) || 0)
      || String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""))
      || String(a.itemId).localeCompare(String(b.itemId));
  };
};

export function buildSelectionShadowPacket(pool, {
  candidate,
  registry = [],
  sourceSnapshotSha256
} = {}) {
  if (!isObject(pool) || !Array.isArray(pool.rows) || !Number.isFinite(pool.savedAt)) {
    throw new TypeError("selection shadow: valid pool snapshot required");
  }
  if (!isObject(candidate) || candidate.task !== "category_admission_only"
    || candidate.semanticContract !== "compact_category_v1"
    || !isObject(candidate.compactPolicy)
    || !/^[0-9a-f]{64}$/.test(String(candidate.candidateRecordSha256 || ""))) {
    throw new TypeError("selection shadow: compact category candidate required");
  }
  if (!/^[0-9a-f]{64}$/.test(String(sourceSnapshotSha256 || ""))) {
    throw new TypeError("selection shadow: source snapshot SHA-256 required");
  }

  const sourceMeta = new Map(registry.filter(isObject).map((row) => [row.id, row]));
  const articles = articlesFromPool(pool).sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const articleIds = new Set();
  const targetsByEvidence = new Map();
  const routingVotesByEvidence = new Map();
  const legacyCategories = [];
  const contentKinds = [];

  for (const article of articles) {
    if (!isObject(article) || !isId(article.id) || !isId(article.title)) {
      throw new TypeError("selection shadow: article id/title invalid");
    }
    if (articleIds.has(article.id)) throw new TypeError(`selection shadow: duplicate article '${article.id}'`);
    articleIds.add(article.id);
    const meta = sourceMeta.get(article.source) || {};
    const input = normalizeClassifierInput({
      itemId: article.id,
      title: article.title,
      excerpt: typeof article.summary === "string" ? article.summary.slice(0, 300) : "",
      sourceId: article.source,
      sourceTier: meta.sourceTier,
      declaredSection: article.registryCategory,
      contentKindHint: article.kind,
      sourceCountry: meta.country,
      language: article.lang || meta.lang
    });
    const routingVote = deterministicRoutingVote(article, meta);
    if (routingVote) {
      const votes = routingVotesByEvidence.get(input.evidenceHash) || new Set();
      votes.add(routingVote);
      routingVotesByEvidence.set(input.evidenceHash, votes);
    }
    const existing = targetsByEvidence.get(input.evidenceHash);
    if (existing) {
      existing.sourceArticleIds.push(article.id);
      const currentArticle = articlesById.get(existing.itemId);
      const currentPriority = representativePriority(currentArticle, sourceMeta.get(currentArticle?.source));
      const nextPriority = representativePriority(article, meta);
      if (nextPriority > currentPriority) {
        const sourceArticleIds = existing.sourceArticleIds;
        Object.assign(existing, input, {
          legacyCategory: isId(article.category) ? article.category : null,
          sourceArticleIds
        });
      }
    } else targetsByEvidence.set(input.evidenceHash, {
      ...input,
      legacyCategory: isId(article.category) ? article.category : null,
      sourceArticleIds: [article.id]
    });
    legacyCategories.push(isId(article.category) ? article.category : "unknown");
    contentKinds.push(isId(article.kind) ? article.kind : "unknown");
  }

  const targets = [...targetsByEvidence.values()].map((target) => {
    const votes = routingVotesByEvidence.get(target.evidenceHash);
    return votes?.size === 1 ? {
      ...target,
      deterministicRouting: {
        categories: [...votes],
        contentType: target.contentKindHint,
        routingBasis: "deterministic_tier_policy"
      }
    } : target;
  });
  return {
    contract: SELECTION_SHADOW_PACKET_CONTRACT,
    runtimeWired: false,
    productProven: false,
    sourceSnapshot: {
      savedAt: pool.savedAt,
      sha256: sourceSnapshotSha256
    },
    candidate: {
      candidateId: candidate.candidateId,
      task: candidate.task,
      semanticContract: candidate.semanticContract,
      requestedModel: candidate.requestedModel,
      promptVersion: candidate.promptVersion,
      promptSha256: candidate.promptSha256,
      compactPolicySha256: sha256(JSON.stringify(candidate.compactPolicy)),
      recordSha256: candidate.candidateRecordSha256,
      taxonomyVersion: d1cTaxonomyVersion(),
      executionState: candidate.execution?.state || null
    },
    counts: {
      sourceArticles: articles.length,
      classificationTargets: targets.length,
      reusedEvidenceArticles: articles.length - targets.length,
      byLegacyCategory: sortedCounts(legacyCategories),
      byContentKind: sortedCounts(contentKinds)
    },
    targets
  };
}

export function selectSelectionShadowCanary(pool, packet, { maxCalls } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new TypeError("selection shadow: positive maxCalls required");
  if (packet?.contract !== SELECTION_SHADOW_PACKET_CONTRACT || !Array.isArray(packet.targets)
    || pool?.savedAt !== packet.sourceSnapshot?.savedAt) {
    throw new TypeError("selection shadow: matching pool and packet required");
  }

  const articles = new Map(articlesFromPool(pool).map((article) => [article.id, article]));
  const rank = selectionShadowRank(articles);

  const byCategory = new Map();
  for (const target of packet.targets) {
    const category = isId(target.legacyCategory) ? target.legacyCategory : "unknown";
    const rows = byCategory.get(category) || [];
    rows.push(target);
    byCategory.set(category, rows);
  }
  const strata = [...byCategory].sort(([a, left], [b, right]) => left.length - right.length || a.localeCompare(b));
  const selected = strata.slice(0, maxCalls).map(([, rows]) => [...rows].sort(rank)[0]);
  if (selected.length < Math.min(maxCalls, packet.targets.length)) {
    const selectedIds = new Set(selected.map((target) => target.itemId));
    selected.push(...packet.targets.filter((target) => !selectedIds.has(target.itemId)).sort(rank)
      .slice(0, maxCalls - selected.length));
  }
  const selectedCategories = new Set(selected.map((target) => target.legacyCategory || "unknown"));
  const contentKinds = new Set(selected.flatMap((target) => target.sourceArticleIds)
    .map((id) => articles.get(id)?.kind).filter(isId));
  return {
    purpose: "operational_smoke_not_quality_proof",
    targets: selected,
    selectedLegacyCategories: [...selectedCategories],
    omittedLegacyCategories: [...byCategory.keys()].filter((category) => !selectedCategories.has(category)).sort(),
    contentKinds: [...contentKinds].sort()
  };
}

export function selectSelectionShadowShortlist(pool, packet, {
  routingSnapshot,
  registry = [],
  missingCategoryIds,
  nowMs = pool?.savedAt,
  windowHours,
  maxCalls
} = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls <= 0 || !Number.isFinite(nowMs)
    || !Number.isFinite(windowHours) || windowHours <= 0
    || !Array.isArray(missingCategoryIds) || !missingCategoryIds.length
    || missingCategoryIds.some((category) => !isKnownCategory(category))) {
    throw new TypeError("selection shadow: valid shortlist policy required");
  }
  if (packet?.contract !== SELECTION_SHADOW_PACKET_CONTRACT || !Array.isArray(packet.targets)
    || pool?.savedAt !== packet.sourceSnapshot?.savedAt || !Array.isArray(registry)) {
    throw new TypeError("selection shadow: matching pool, packet, and registry required");
  }
  validateCategoryRoutingSnapshot(routingSnapshot);

  const articles = new Map(articlesFromPool(pool).map((article) => [article.id, article]));
  const routingById = new Map(routingSnapshot.entries.map((entry) => [entry.itemId, entry]));
  const sourceById = new Map(registry.map((source) => [source.id, source]));
  const missing = new Set(missingCategoryIds);
  const shortlistCategory = (target) => {
    const source = sourceById.get(target.sourceId);
    return source?.enabled === true && source.kind === "news" && source.sourceTier === "specialist"
      && isKnownCategory(source.category) ? source.category : target.legacyCategory;
  };
  const windowMs = windowHours * 3600 * 1000;
  const rank = selectionShadowRank(articles);
  const eligible = packet.targets.filter((target) => {
    const source = sourceById.get(target.sourceId);
    const article = articles.get(target.itemId);
    const routes = target.sourceArticleIds.map((itemId) => routingById.get(itemId));
    if (routes.some((route) => !route)) {
      throw new Error(`selection shadow: routing entry missing '${target.itemId}'`);
    }
    const publishedAt = article?.publishedAt ? Date.parse(article.publishedAt) : NaN;
    return routes.every((route) => route.categories.length === 0)
      && ["news", "community"].includes(target.contentKindHint)
      && source?.enabled === true
      && !["gnews", "deal"].includes(source.feedGroup)
      && Number.isFinite(publishedAt) && publishedAt <= nowMs && nowMs - publishedAt <= windowMs;
  }).sort((a, b) => Number(missing.has(shortlistCategory(b))) - Number(missing.has(shortlistCategory(a)))
    || rank(a, b));
  const roundRobin = (rows, limit) => {
    const bySource = new Map();
    for (const target of rows) {
      const bucket = bySource.get(target.sourceId) || [];
      bucket.push(target);
      bySource.set(target.sourceId, bucket);
    }
    const selected = [];
    for (let offset = 0; selected.length < limit; offset += 1) {
      let added = false;
      for (const bucket of bySource.values()) {
        if (bucket[offset]) {
          selected.push(bucket[offset]);
          added = true;
          if (selected.length === limit) break;
        }
      }
      if (!added) break;
    }
    return selected;
  };
  const targeted = eligible.filter((target) => missing.has(shortlistCategory(target)));
  const targets = roundRobin(targeted, maxCalls);

  return {
    purpose: "ambiguous_source_shortlist_not_quality_proof",
    targets,
    missingCategoryIds: [...missing].sort(),
    selectedSourceIds: [...new Set(targets.map((target) => target.sourceId))].sort(),
    selectedLegacyCategories: [...new Set(targets.map((target) => target.legacyCategory || "unknown"))].sort(),
    omittedLegacyCategories: [],
    contentKinds: [...new Set(targets.map((target) => target.contentKindHint).filter(isId))].sort()
  };
}

export function expandSelectionShadowPredictions(packet, predictions) {
  if (packet?.contract !== SELECTION_SHADOW_PACKET_CONTRACT || !Array.isArray(packet.targets)
    || !Array.isArray(predictions)) throw new TypeError("selection shadow: packet and predictions required");
  const targetIds = new Set(packet.targets.map((target) => target.itemId));
  const byTarget = new Map();
  for (const prediction of predictions) {
    if (!isObject(prediction) || !targetIds.has(prediction.itemId)) {
      throw new TypeError(`selection shadow: unknown prediction '${prediction?.itemId || ""}'`);
    }
    if (byTarget.has(prediction.itemId)) throw new TypeError(`selection shadow: duplicate prediction '${prediction.itemId}'`);
    byTarget.set(prediction.itemId, prediction);
  }
  return packet.targets.flatMap((target) => {
    const prediction = byTarget.get(target.itemId);
    return prediction ? target.sourceArticleIds.map((itemId) => ({ ...prediction, itemId })) : [];
  });
}

export function measureSelectionShadow(pool, packet, predictions, { roleOf } = {}) {
  if (typeof roleOf !== "function") throw new TypeError("selection shadow: roleOf required");
  if (pool?.savedAt !== packet?.sourceSnapshot?.savedAt) {
    throw new Error("selection shadow: packet/pool snapshot mismatch");
  }
  for (const prediction of predictions) {
    if (!["classified", "cache_hit"].includes(prediction?.status)) continue;
    const classification = prediction.classification || {};
    if (classification.modelVersion !== packet.candidate.requestedModel
      || classification.promptVersion !== packet.candidate.promptVersion
      || classification.taxonomyVersion !== packet.candidate.taxonomyVersion) {
      throw new Error("selection shadow: packet/prediction version mismatch");
    }
  }
  const excerptByArticleId = new Map(packet.targets.flatMap((target) =>
    target.sourceArticleIds.map((id) => [id, target.excerpt])));
  const articlesById = new Map(articlesFromPool(pool).map((article) => [article.id, {
    ...article,
    excerpt: excerptByArticleId.get(article.id) || ""
  }]));
  const articleIds = packet.targets.flatMap((target) => target.sourceArticleIds);
  const articles = articleIds.map((id) => articlesById.get(id));
  if (articles.some((article) => !article)) throw new Error("selection shadow: packet/pool article mismatch");
  const expanded = expandSelectionShadowPredictions(packet, predictions);
  const eventView = buildCategoryEventViews(articles, expanded, { roleOf });
  const categoryViewCounts = new Map();
  const admittedArticleIds = new Set();
  for (const event of eventView.events) {
    for (const view of event.categoryEventViews) {
      categoryViewCounts.set(view.category, (categoryViewCounts.get(view.category) || 0) + 1);
      for (const id of view.admittedArticleIds) admittedArticleIds.add(id);
    }
  }
  return {
    contract: SELECTION_SHADOW_MEASUREMENT_CONTRACT,
    runtimeWired: false,
    productProven: false,
    sourceSnapshot: packet.sourceSnapshot,
    candidate: packet.candidate,
    counts: {
      sourceArticles: articles.length,
      classificationTargets: packet.targets.length,
      predictedTargets: new Set(predictions.map((row) => row.itemId)).size,
      expandedPredictions: expanded.length,
      admittedArticles: admittedArticleIds.size,
      withheldArticles: eventView.withheld.length,
      events: eventView.events.length
    },
    categoryViews: Object.fromEntries([...categoryViewCounts].sort(([a], [b]) => a.localeCompare(b))),
    eventView
  };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function main() {
  const args = process.argv.slice(2);
  const poolPath = argValue(args, "--pool");
  const candidateId = argValue(args, "--candidate");
  const outPath = argValue(args, "--out");
  if (!poolPath || !candidateId || !outPath) {
    throw new Error("usage: node tools/prepare-selection-shadow.mjs --pool <pool.json> --candidate <candidate-id> --out <packet.json>");
  }
  const resolvedPool = path.resolve(poolPath);
  const resolvedOut = path.resolve(outPath);
  if (fs.existsSync(resolvedOut)) throw new Error(`selection shadow: output exists '${resolvedOut}'`);
  const raw = fs.readFileSync(resolvedPool, "utf8");
  const packet = buildSelectionShadowPacket(JSON.parse(raw), {
    candidate: getCandidate(candidateId),
    registry: loadRegistry(),
    sourceSnapshotSha256: sha256(raw)
  });
  const serialized = JSON.stringify(packet, null, 2) + "\n";
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, serialized, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: "SHADOW_PACKET_PREPARED",
    output: resolvedOut,
    packetSha256: sha256(serialized),
    counts: packet.counts,
    paidCalls: 0,
    runtimeWired: false
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
