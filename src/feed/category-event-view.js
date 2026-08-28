// D2-B/C — 전역 사건 계보를 유지한 채 승인 근거만 카테고리별로 투영한다.
// 순수 오프라인 계약이며 shadow/runtime/UI에는 아직 연결하지 않는다.
import crypto from "node:crypto";

import { buildEventClusters, carryEventLineages, eventEntityTokens } from "./event-cluster.js";
import {
  ADMISSION_CATEGORY_IDS,
  admissionGate,
  hasPrimaryEvidence
} from "./selection-contract.js";
import {
  PREDICTION_STATUSES,
  normalizeClassifierInput,
  validateClassifierOutput
} from "./selection-classifier-lab.js";

export const CATEGORY_EVENT_VIEW_CONTRACT = Object.freeze({
  stableId: "NOWHOT-CATEGORY-EVENT-VIEW-001",
  phase: "D2-B",
  runtimeWired: false
});

export const CATEGORY_EVENT_LINEAGE_CONTRACT = Object.freeze({
  stableId: "NOWHOT-CATEGORY-EVENT-LINEAGE-001",
  phase: "D2-C",
  runtimeWired: false
});

const FINAL_STATUSES = new Set(["classified", "cache_hit"]);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

const inputOf = (article) => normalizeClassifierInput({
  ...article,
  itemId: article.id,
  excerpt: typeof article.excerpt === "string" ? article.excerpt : (article.summary || "")
});

const versionsOf = (classification) => ({
  modelVersion: classification.modelVersion,
  promptVersion: classification.promptVersion,
  taxonomyVersion: classification.taxonomyVersion
});

const versionKeyOf = (versions) => JSON.stringify([
  versions.modelVersion,
  versions.promptVersion,
  versions.taxonomyVersion
]);

function categoryFactsFingerprint(articleIds, articleById, admittedById) {
  const facts = new Set();
  for (const id of articleIds) {
    const tokens = eventEntityTokens(articleById.get(id)?.title);
    for (const token of tokens) facts.add(token);
    if (tokens.length === 0) facts.add(`evidence:${admittedById.get(id).evidenceHash}`);
  }
  return `CEVF-${sha(JSON.stringify([...facts].sort())).slice(0, 16)}`;
}

export function buildCategoryEventViews(articles, predictions, {
  roleOf,
  previousLineage = [],
  previousServedCategoryFingerprints = new Map(),
  nowMs = null
} = {}) {
  if (!Array.isArray(articles) || !Array.isArray(predictions)) {
    throw new TypeError("buildCategoryEventViews: articles and predictions arrays required");
  }
  if (typeof roleOf !== "function") throw new TypeError("buildCategoryEventViews: roleOf required");
  if (!Array.isArray(previousLineage)) throw new TypeError("buildCategoryEventViews: previousLineage array required");
  if (previousLineage.some((record) => !isObject(record) || !isId(record.lineageId))) {
    throw new TypeError("buildCategoryEventViews: previousLineage lineageId invalid");
  }
  if (!(previousServedCategoryFingerprints instanceof Map)) {
    throw new TypeError("buildCategoryEventViews: previousServedCategoryFingerprints Map required");
  }
  for (const fingerprint of previousServedCategoryFingerprints.values()) {
    if (typeof fingerprint !== "string" || !/^CEVF-[0-9a-f]{16}$/.test(fingerprint)) {
      throw new TypeError("buildCategoryEventViews: served category fingerprint invalid");
    }
  }
  if (nowMs !== null && !Number.isFinite(nowMs)) throw new TypeError("buildCategoryEventViews: nowMs must be finite");

  const articleById = new Map();
  for (const article of articles) {
    if (!isObject(article) || !isId(article.id)) throw new TypeError("category event view: article id invalid");
    if (articleById.has(article.id)) throw new TypeError(`category event view: duplicate article '${article.id}'`);
    articleById.set(article.id, article);
  }

  const predictionById = new Map();
  for (const prediction of predictions) {
    if (!isObject(prediction) || !isId(prediction.itemId)) throw new TypeError("category event view: prediction itemId invalid");
    if (!articleById.has(prediction.itemId)) throw new TypeError(`category event view: unknown prediction item '${prediction.itemId}'`);
    if (predictionById.has(prediction.itemId)) throw new TypeError(`category event view: duplicate prediction '${prediction.itemId}'`);
    if (!PREDICTION_STATUSES.includes(prediction.status)) throw new TypeError(`category event view: unknown prediction status '${prediction.status}'`);
    predictionById.set(prediction.itemId, prediction);
  }

  const admittedById = new Map();
  const withheld = [];
  let classifierVersions = null;
  let classifierVersionKey = null;
  for (const article of articles) {
    const prediction = predictionById.get(article.id);
    if (!prediction) {
      withheld.push({ articleId: article.id, reason: "missing_prediction" });
      continue;
    }
    if (!FINAL_STATUSES.has(prediction.status)) {
      withheld.push({ articleId: article.id, reason: `prediction_${prediction.status}` });
      continue;
    }

    const classification = prediction.classification;
    const versions = versionsOf(classification || {});
    const validation = validateClassifierOutput(classification, inputOf(article), versions);
    if (!validation.ok) {
      withheld.push({ articleId: article.id, reason: "classification_invalid", errors: validation.errors });
      continue;
    }
    const gate = admissionGate(classification);
    if (gate.blocked || gate.admitted.length === 0) {
      withheld.push({ articleId: article.id, reason: gate.blocked || "no_admitted_category" });
      continue;
    }

    const versionKey = versionKeyOf(versions);
    if (classifierVersionKey !== null && versionKey !== classifierVersionKey) {
      throw new Error("category event view: mixed classifier versions");
    }
    classifierVersions = classifierVersions || versions;
    classifierVersionKey = classifierVersionKey || versionKey;
    admittedById.set(article.id, {
      categories: gate.admitted,
      evidenceHash: classification.evidenceHash,
      sharedPrimary: hasPrimaryEvidence([{
        sourceRole: roleOf(article),
        claimOriginGroup: classification.claimOriginGroup
      }])
    });
  }

  const clusteredEvents = buildEventClusters(articles);
  const lineage = carryEventLineages(previousLineage, clusteredEvents, { nowMs });
  const events = [];
  for (const event of clusteredEvents) {
    const assignedLineage = lineage.assignments.get(event.eventId);
    const eligibleIds = event.memberArticleIds.filter((id) => admittedById.has(id));
    const categoryIds = ADMISSION_CATEGORY_IDS.filter((category) =>
      eligibleIds.some((id) => admittedById.get(id).categories.includes(category)));
    const categoryEventViews = categoryIds.map((category) => {
      const admittedArticleIds = eligibleIds.filter((id) =>
        admittedById.get(id).categories.includes(category));
      const sharedPrimaryArticleIds = eligibleIds.filter((id) =>
        !admittedById.get(id).categories.includes(category) && admittedById.get(id).sharedPrimary);
      const evidenceArticleIds = [...admittedArticleIds, ...sharedPrimaryArticleIds];
      const reactionArticleIds = event.reactionArticleIds.filter((id) =>
        admittedById.get(id)?.categories.includes(category));
      const factsFingerprint = categoryFactsFingerprint(evidenceArticleIds, articleById, admittedById);
      const categoryViewKey = `${assignedLineage.lineageId}:${category}`;
      const previousServedFactsFingerprint = previousServedCategoryFingerprints.get(categoryViewKey) || null;
      return {
        eventId: event.eventId,
        lineageId: assignedLineage.lineageId,
        categoryViewKey,
        category,
        admittedArticleIds,
        sharedPrimaryArticleIds,
        evidenceArticleIds,
        reactionArticleIds,
        factsFingerprint,
        previousServedFactsFingerprint,
        reappearedUnchanged: Boolean(previousServedFactsFingerprint
          && previousServedFactsFingerprint === factsFingerprint),
        materialChange: Boolean(previousServedFactsFingerprint
          && previousServedFactsFingerprint !== factsFingerprint)
      };
    });
    if (categoryEventViews.length > 0) {
      events.push({
        eventId: event.eventId,
        lineage: {
          lineageId: assignedLineage.lineageId,
          inherited: assignedLineage.inherited,
          basis: assignedLineage.basis
        },
        categoryEventViews
      });
    }
  }

  return {
    contract: CATEGORY_EVENT_VIEW_CONTRACT.stableId,
    lineageContract: CATEGORY_EVENT_LINEAGE_CONTRACT.stableId,
    runtimeWired: false,
    classifierVersions,
    events,
    lineageRecords: lineage.records,
    withheld
  };
}
