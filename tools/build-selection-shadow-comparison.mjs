// D2-F — 전량 분류 결과를 기존 사건·랭킹 엔진에 넣어 현행판과 오프라인 비교한다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { admittedCategories } from "../src/feed/selection-contract.js";
import { unsafeForLead } from "../src/feed/profanity.js";
import { loadRegistry } from "../src/feed/registry.js";
import { shadowSelectBriefing } from "../src/feed/shadow-selection.js";
import {
  buildV2Edition,
  listV2Categories,
  validateV2Edition,
  V2_COMBO_KEY
} from "./build-v2-edition.mjs";
import { findPreviousLineageFile } from "./observe-shadow-slot.mjs";
import { expandSelectionShadowPredictions } from "./prepare-selection-shadow.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readRaw = (file) => fs.readFileSync(file, "utf8");
const readJson = (file) => JSON.parse(readRaw(file));
const articlesFromPool = (pool) => (Array.isArray(pool?.rows) ? pool.rows : [])
  .map((row) => row && typeof row === "object" && Object.hasOwn(row, "item") ? row.item : row)
  .filter(Boolean);

export function projectShadowArticles(pool, packet, predictions, { registry = [] } = {}) {
  const expanded = expandSelectionShadowPredictions(packet, predictions);
  const byId = new Map(expanded.filter((row) => ["classified", "cache_hit"].includes(row.status))
    .map((row) => [row.itemId, row.classification]));
  const sourceMeta = new Map(registry.map((row) => [row.id, row]));
  const articles = [];
  const byCategory = {};
  const byContentType = {};
  let multiCategoryArticles = 0;
  let adultTaggedArticles = 0;

  for (const article of articlesFromPool(pool)) {
    const classification = byId.get(article.id);
    if (!classification) continue;
    const categories = admittedCategories(classification);
    if (!categories.length) continue;
    const adultGateRequired = article.adult === true
      || sourceMeta.get(article.source)?.adult === true
      || unsafeForLead(article.title);
    if (categories.length > 1) multiCategoryArticles += 1;
    if (adultGateRequired) adultTaggedArticles += 1;
    for (const category of categories) byCategory[category] = (byCategory[category] || 0) + 1;
    byContentType[classification.contentType] = (byContentType[classification.contentType] || 0) + 1;
    articles.push({ ...article, admittedCategories: categories, adultGateRequired });
  }

  const sourceArticles = articlesFromPool(pool).length;
  return {
    articles,
    stats: {
      sourceArticles,
      predictedArticles: byId.size,
      admittedArticles: articles.length,
      withheldArticles: sourceArticles - articles.length,
      multiCategoryArticles,
      adultTaggedArticles,
      byCategory: Object.fromEntries(Object.entries(byCategory).sort()),
      byContentType: Object.fromEntries(Object.entries(byContentType).sort())
    }
  };
}

function verifyFullAttempt(attemptDir, poolRaw, packetRaw) {
  const manifest = readJson(path.join(attemptDir, "attempt-manifest.json"));
  const receipt = readJson(path.join(attemptDir, "run-receipt.json"));
  const predictionsPath = path.join(attemptDir, "predictions.json");
  if (manifest.contract !== "NOWHOT-SELECTION-SHADOW-FULL-MANIFEST-001" || manifest.mode !== "full"
    || receipt.contract !== "NOWHOT-SELECTION-SHADOW-FULL-001" || receipt.status !== "D2_SHADOW_FULL_MEASURED"
    || manifest.poolSha256 !== sha256(poolRaw) || manifest.packetSha256 !== sha256(packetRaw)
    || manifest.artifacts?.["predictions.json"] !== sha256(readRaw(predictionsPath))
    || manifest.unsettledReserves !== 0 || manifest.retries !== 0) {
    throw new Error("SHADOW_COMPARISON_HOLD: full attempt integrity/status mismatch");
  }
  return { manifest, receipt, predictions: readJson(predictionsPath).results };
}

function compareEditions(current, next) {
  const categories = {};
  for (const category of Object.keys(next.categories)) {
    const before = current.categories?.[category]?.items || [];
    const after = next.categories[category].items;
    const beforeUrls = new Set(before.map((row) => row.url));
    const afterUrls = new Set(after.map((row) => row.url));
    categories[category] = {
      current: before.length,
      next: after.length,
      delta: after.length - before.length,
      overlap: after.filter((row) => beforeUrls.has(row.url)).length,
      entered: after.filter((row) => !beforeUrls.has(row.url)).slice(0, 5).map((row) => row.title),
      left: before.filter((row) => !afterUrls.has(row.url)).slice(0, 5).map((row) => row.title),
      partial: next.categories[category].partial
    };
  }
  return categories;
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function main() {
  const args = process.argv.slice(2);
  const poolPath = argValue(args, "--pool");
  const packetPath = argValue(args, "--packet");
  const attemptDir = argValue(args, "--attempt");
  const currentPath = argValue(args, "--current");
  const editionOut = argValue(args, "--edition-out");
  const reportOut = argValue(args, "--report-out");
  if (![poolPath, packetPath, attemptDir, currentPath, editionOut, reportOut].every(Boolean)) {
    throw new Error("usage: --pool --packet --attempt --current --edition-out --report-out 모두 필요");
  }

  const poolRaw = readRaw(poolPath);
  const packetRaw = readRaw(packetPath);
  const pool = JSON.parse(poolRaw);
  const packet = JSON.parse(packetRaw);
  const current = readJson(currentPath);
  const attempt = verifyFullAttempt(attemptDir, poolRaw, packetRaw);
  const registry = loadRegistry();
  const projected = projectShadowArticles(pool, packet, attempt.predictions, { registry });
  const previousFile = findPreviousLineageFile(path.dirname(currentPath), current.date, current.slotId);
  const previous = previousFile ? readJson(previousFile)?.byCombo?.[V2_COMBO_KEY] || [] : [];
  const categories = listV2Categories();
  const briefing = shadowSelectBriefing(projected.articles, {
    requestedCategories: categories,
    now: Date.parse(current.generatedAt),
    slotId: current.slotId,
    registry,
    previousLineage: previous
  });
  const registryById = new Map(registry.map((row) => [row.id, row]));
  const next = buildV2Edition(briefing, {
    date: current.date,
    slotId: current.slotId,
    generatedAt: current.generatedAt,
    codeVersion: current.codeVersion,
    registryById
  });
  const validation = validateV2Edition(next);
  if (!validation.ok) throw new Error(`SHADOW_COMPARISON_HOLD: ${validation.errors.join("; ")}`);

  const selected = Object.values(next.categories).flatMap((block) => block.items);
  const selectedSources = new Set(selected.map((row) => row.source));
  const projectedByUrl = new Map(projected.articles.map((row) => [row.url, row]));
  const representativeCategoryMismatches = Object.entries(next.categories).flatMap(([category, block]) =>
    block.items.filter((row) => !projectedByUrl.get(row.url)?.admittedCategories?.includes(category))
      .map((row) => ({ category, title: row.title, url: row.url })));
  const report = {
    contract: "NOWHOT-SELECTION-SHADOW-COMPARISON-001",
    generatedAt: new Date().toISOString(),
    runtimeWired: false,
    productProven: false,
    source: {
      poolSha256: sha256(poolRaw),
      packetSha256: sha256(packetRaw),
      attemptId: attempt.manifest.attemptId,
      candidateId: attempt.manifest.candidateId,
      costUsd: attempt.manifest.costUsd
    },
    classification: projected.stats,
    routing: {
      qualityExcluded: briefing.counts.qualityExcluded,
      selectedUniqueEvents: briefing.counts.briefingSelected,
      communityInput: projected.articles.filter((row) => row.kind === "community").length,
      newsInput: projected.articles.filter((row) => row.kind !== "community").length,
      communityEngagementGateApplied: true,
      newsTrustAndHotRankingApplied: true,
      adultGateRequiredSelected: selected.filter((row) => row.adultGateRequired === true).length,
      representativeCategoryMismatches,
      selectedSourceCount: selectedSources.size,
      categories: compareEditions(current, next)
    }
  };
  fs.writeFileSync(editionOut, JSON.stringify(next, null, 2) + "\n");
  fs.writeFileSync(reportOut, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${JSON.stringify({
    status: "SHADOW_COMPARISON_READY",
    editionOut,
    reportOut,
    classification: report.classification,
    routing: { qualityExcluded: report.routing.qualityExcluded, selectedUniqueEvents: report.routing.selectedUniqueEvents },
    runtimeWired: false,
    productProven: false
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
