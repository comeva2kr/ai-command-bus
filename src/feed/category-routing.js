import fs from "node:fs";

import { unsafeForLead } from "./profanity.js";
import { isKnownCategory } from "./taxonomy.js";

export const CATEGORY_ROUTING_CONTRACT = "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001";
export const CATEGORY_ROUTING_MAX_AGE_MS = 30 * 60 * 60 * 1000;

const isId = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const ROUTING_BASES = new Set([
  "current_model", "prior_exact_hash", "deterministic_tier_policy",
  "specialist_registry_default", "legacy_classifier_fallback", "withheld"
]);
const EDITORIAL_IMPORTANCE_STATES = new Set(["pass", "fail"]);

export function validateCategoryRoutingSnapshot(snapshot) {
  if (!snapshot || snapshot.contract !== CATEGORY_ROUTING_CONTRACT || !isId(snapshot.snapshotId)
    || !Array.isArray(snapshot.entries) || !isSha(snapshot.source?.packetSha256)
    || !isSha(snapshot.source?.predictionsSha256)
    || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new TypeError("category routing: invalid snapshot");
  }
  const ids = new Set();
  for (const entry of snapshot.entries) {
    if (!entry || !isId(entry.itemId) || !isSha(entry.evidenceHash)
      || !Array.isArray(entry.categories) || entry.categories.some((id) => !isKnownCategory(id))
      || new Set(entry.categories).size !== entry.categories.length || ids.has(entry.itemId)
      || (entry.routingBasis !== undefined && !ROUTING_BASES.has(entry.routingBasis))
      || (entry.editorialImportance !== undefined
        && !EDITORIAL_IMPORTANCE_STATES.has(entry.editorialImportance))) {
      throw new TypeError(`category routing: invalid entry '${entry?.itemId || ""}'`);
    }
    ids.add(entry.itemId);
  }
  return snapshot;
}

export function loadCategoryRoutingSnapshot(file) {
  return validateCategoryRoutingSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function createCategoryRouter(snapshot, registry = [], {
  now = Date.now,
  maxAgeMs = CATEGORY_ROUTING_MAX_AGE_MS
} = {}) {
  validateCategoryRoutingSnapshot(snapshot);
  if (typeof now !== "function" || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError("category routing: invalid freshness policy");
  }
  const byId = new Map(snapshot.entries.map((entry) => [entry.itemId, entry]));
  const sourceMeta = new Map(registry.map((entry) => [entry.id, entry]));
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const status = {
    mode: "v2",
    state: "snapshot_active",
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    expiresAt: new Date(generatedAtMs + maxAgeMs).toISOString(),
    classifiedArticleCount: snapshot.counts?.modelClassifiedArticles
      ?? snapshot.counts?.classifiedArticles ?? 0,
    admittedArticleCount: snapshot.counts?.admittedArticles
      ?? snapshot.counts?.classifiedArticles ?? 0,
    withheldArticleCount: snapshot.counts?.withheldArticles || 0
  };
  const stale = (referenceNow = now()) => {
    const expired = referenceNow < generatedAtMs || referenceNow - generatedAtMs > maxAgeMs;
    status.mode = "v2";
    status.state = expired ? "snapshot_stale_last_good_v2" : "snapshot_active";
    return expired;
  };
  stale();

  return {
    status,
    project(items, referenceNow = now()) {
      const staleSnapshot = stale(referenceNow);
      return (items || []).flatMap((item) => {
        const meta = sourceMeta.get(item.source) || null;
        if (item.adultGateRequired === true || item.adult === true || meta?.adult === true
          || unsafeForLead(item.title)) return [];

        const entries = [item.id,
          ...(item.canonicalAliases || []).map((alias) => alias?.id),
          ...(item.related || []).map((related) => related?.id)]
          .map((id) => byId.get(id)).filter(Boolean);
        const entry = byId.get(item.id) || entries[0];
        const categories = [...new Set(entries.flatMap((row) => row.categories || []))];
        if (!categories.length) return [];
        const editorialImportance = entries.some((row) => row.editorialImportance === "pass") ? "pass"
          : entries.some((row) => row.editorialImportance === "fail") ? "fail" : undefined;

        const projected = {
          ...item,
          routingOriginalId: item.id,
          registryCategory: item.registryCategory === undefined ? item.category : item.registryCategory,
          category: entry.categories[0] || categories[0],
          admittedCategories: categories,
          ...(editorialImportance ? { editorialImportance } : {}),
          categoryRoutingBasis: staleSnapshot
            ? `${entry.routingBasis || "classified_snapshot"}_stale`
            : entry.routingBasis || "classified_snapshot"
        };
        return [projected];
      });
    }
  };
}

export function createReloadingCategoryRouter(file, registry = [], options = {}) {
  let modifiedAt = fs.statSync(file).mtimeMs;
  let active = createCategoryRouter(loadCategoryRoutingSnapshot(file), registry, options);
  const status = { ...active.status };
  let reloadError = null;

  const reload = () => {
    let nextModifiedAt;
    try {
      nextModifiedAt = fs.statSync(file).mtimeMs;
    } catch (error) {
      reloadError = String(error?.message || error);
      return;
    }
    if (nextModifiedAt === modifiedAt) return;
    modifiedAt = nextModifiedAt;
    try {
      active = createCategoryRouter(loadCategoryRoutingSnapshot(file), registry, options);
      reloadError = null;
    } catch (error) {
      reloadError = String(error?.message || error);
    }
  };

  return {
    status,
    project(items, referenceNow) {
      reload();
      const rows = active.project(items, referenceNow);
      Object.assign(status, active.status);
      if (reloadError) {
        status.mode = "v2";
        status.state = "snapshot_reload_failed_last_good_v2";
        status.lastError = reloadError;
      } else {
        delete status.lastError;
      }
      return rows;
    }
  };
}
