import fs from "node:fs";

import { unsafeForLead } from "./profanity.js";
import { isKnownCategory } from "./taxonomy.js";

export const CATEGORY_ROUTING_CONTRACT = "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001";
export const CATEGORY_ROUTING_MAX_AGE_MS = 30 * 60 * 60 * 1000;

const isId = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const ROUTING_BASES = new Set([
  "current_model", "prior_exact_hash", "specialist_registry_default", "legacy_classifier_fallback", "withheld"
]);
const LEGACY_SECTION_CATEGORIES = new Map(Object.entries({
  politics: "politics", policy: "politics", government: "politics", election: "politics",
  entertainment: "culture", enter: "culture", movie: "culture", music: "culture", television: "culture",
  world: "news", international: "news", society: "news", national: "news", local: "news",
  sports: "sports", science: "science", technology: "tech", tech: "tech",
  automobile: "auto", automotive: "auto", cars: "auto", mobility: "auto",
  business: "business", economy: "business", finance: "business", market: "business",
  gaming: "gaming", games: "gaming", realestate: "realestate", property: "realestate", housing: "realestate",
  fashion: "fashion", style: "fashion", art: "art", design: "art", architecture: "art"
}));

function legacySectionCategory(item) {
  const categories = new Set();
  for (const value of [item?.canonicalUrl, item?.url]) {
    try {
      for (const raw of new URL(value).pathname.toLowerCase().split("/").filter(Boolean)) {
        for (const segment of [raw, raw.replace(/[-_.]/g, ""), ...raw.split(/[-_.]/)]) {
          const category = LEGACY_SECTION_CATEGORIES.get(segment);
          if (category) categories.add(category);
        }
      }
    } catch { /* an invalid URL is not section evidence */ }
  }
  return categories.size === 1 ? [...categories][0] : null;
}

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
      || (entry.routingBasis !== undefined && !ROUTING_BASES.has(entry.routingBasis))) {
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

        const entry = byId.get(item.id);
        const declaredSection = !entry && meta?.categoryRouting === "declared_section"
          && meta.kind === "news" && meta.sourceTier === "specialist"
          && isKnownCategory(meta.category);
        const observedAfterSnapshot = !entry && [Date.parse(item.publishedAt), Number(item.firstSeenAt)]
          .some((at) => Number.isFinite(at) && at > generatedAtMs && at <= referenceNow);
        const existingCategories = (item.admittedCategories || []).filter(isKnownCategory);
        const staleFallback = existingCategories.length ? existingCategories
          : isKnownCategory(item.category) ? [item.category] : [];
        const legacySection = entry?.routingBasis === "legacy_classifier_fallback"
          ? legacySectionCategory(item) : null;
        const categories = entry ? legacySection ? [legacySection] : entry.categories : declaredSection ? [meta.category]
          : staleSnapshot ? staleFallback
          : observedAfterSnapshot && isKnownCategory(item.category) ? [item.category] : [];
        if (!categories.length) return [];

        const projected = {
          ...item,
          routingOriginalId: item.id,
          registryCategory: item.registryCategory === undefined ? item.category : item.registryCategory,
          category: categories[0],
          categoryRoutingBasis: entry ? legacySection
            ? `legacy_url_section_recovery${staleSnapshot ? "_stale" : ""}`
            : staleSnapshot ? `${entry.routingBasis || "classified_snapshot"}_stale`
              : entry.routingBasis || "classified_snapshot"
            : declaredSection ? "declared_specialist_section"
              : staleSnapshot ? "snapshot_stale_declared_category" : "post_snapshot_declared_category"
        };
        if (entry || declaredSection || existingCategories.length) projected.admittedCategories = categories;
        else delete projected.admittedCategories;
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
