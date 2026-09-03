import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CATEGORY_ROUTING_CONTRACT, validateCategoryRoutingSnapshot } from "../src/feed/category-routing.js";
import { admittedCategories, validateClassificationSchema } from "../src/feed/selection-contract.js";
import { isKnownCategory } from "../src/feed/taxonomy.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const arg = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const argsFor = (args, name) => args.flatMap((value, index) =>
  value === name && args[index + 1] ? [args[index + 1]] : []);
export const EDITORIAL_IMPORTANCE_CONTRACT = "NOWHOT-EDITORIAL-IMPORTANCE-001";
const IMPORTANCE_REASON_CLASSES = new Set(["market", "security", "diplomacy", "disaster", "policy", "none"]);
const KOREA_IMPACT_LEVELS = new Set(["direct", "indirect", "none"]);
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const hasExactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

const deterministicRouting = (target) => {
  const value = target?.deterministicRouting;
  if (value === undefined) return null;
  if (!value || value.routingBasis !== "deterministic_tier_policy"
    || !Array.isArray(value.categories) || value.categories.length !== 1
    || !isKnownCategory(value.categories[0])
    || !["news", "community", "deal"].includes(value.contentType)
    || value.contentType !== target.contentKindHint) {
    throw new Error(`category routing build: invalid deterministic routing '${target?.itemId || ""}'`);
  }
  return value;
};

function validateEditorialImportanceReview(review, packet, registry, packetSha256) {
  if (!hasExactKeys(review, ["contract", "generatedAt", "source", "entries"])
    || review.contract !== EDITORIAL_IMPORTANCE_CONTRACT
    || !Number.isFinite(Date.parse(review.generatedAt))
    || !hasExactKeys(review.source, ["packetSha256", "promptVersion", "reviewers"])
    || !isSha(review.source.packetSha256)
    || typeof review.source.promptVersion !== "string" || !review.source.promptVersion.trim()
    || !Array.isArray(review.source.reviewers) || review.source.reviewers.length !== 3
    || new Set(review.source.reviewers).size !== 3
    || review.source.reviewers.some((value) => typeof value !== "string" || !value.trim())
    || !Array.isArray(review.entries)) {
    throw new TypeError("category routing importance: invalid review");
  }
  if (review.source.packetSha256 !== packetSha256) {
    throw new Error("category routing importance: packet SHA mismatch");
  }
  if (!Array.isArray(registry)) throw new TypeError("category routing importance: registry required");

  const sources = new Map(registry.map((entry) => [entry.id, entry]));
  const required = new Set(packet.targets.filter((target) => {
    const meta = sources.get(target.sourceId);
    return target.contentKindHint === "news" && meta?.enabled === true && meta.kind === "news"
      && meta.country && meta.country !== "KR" && meta.editorialAuthority === "global_major"
      && ["news", "business"].includes(meta.category);
  }).map((target) => target.evidenceHash));
  const decisions = new Map();
  for (const entry of review.entries) {
    if (!hasExactKeys(entry, ["evidenceHash", "important", "reasonClass", "koreaImpact"])
      || !isSha(entry.evidenceHash) || typeof entry.important !== "boolean"
      || !IMPORTANCE_REASON_CLASSES.has(entry.reasonClass)
      || !KOREA_IMPACT_LEVELS.has(entry.koreaImpact)
      || decisions.has(entry.evidenceHash)) {
      throw new TypeError("category routing importance: invalid review entry");
    }
    decisions.set(entry.evidenceHash, entry);
  }
  if (required.size !== decisions.size || [...required].some((hash) => !decisions.has(hash))
    || [...decisions.keys()].some((hash) => !required.has(hash))) {
    throw new Error("category routing importance: incomplete target coverage");
  }
  return decisions;
}

export function buildCategoryRoutingSnapshot(packet, predictions, source = {}, {
  editorialImportanceReview = null,
  registry = []
} = {}) {
  if (!Array.isArray(packet?.targets) || !Array.isArray(predictions?.results)) {
    throw new TypeError("category routing build: packet and recovered predictions required");
  }
  const importance = editorialImportanceReview
    ? validateEditorialImportanceReview(editorialImportanceReview, packet, registry, source.packetSha256)
    : null;
  const byTarget = new Map(predictions.results.map((row) => [row.itemId, row]));
  if (byTarget.size !== packet.targets.length) throw new Error("category routing build: incomplete predictions");
  const targetBasis = { current_model: 0, deterministic_tier_policy: 0, withheld: 0 };

  const entries = packet.targets.flatMap((target) => {
    const prediction = byTarget.get(target.itemId);
    const classified = ["classified", "cache_hit"].includes(prediction?.status);
    if (!prediction || (classified && prediction.classification?.evidenceHash !== target.evidenceHash)) {
      throw new Error(`category routing build: prediction mismatch '${target.itemId}'`);
    }
    const deterministic = classified ? null : deterministicRouting(target);
    let categories = classified ? admittedCategories(prediction.classification) : deterministic?.categories || [];
    let basis = classified ? "current_model"
      : categories.length ? "deterministic_tier_policy" : "withheld";
    const importanceDecision = importance?.get(target.evidenceHash);
    const editorialImportance = importanceDecision
      ? importanceDecision.important ? "pass" : "fail" : undefined;
    if (editorialImportance === "fail") {
      categories = [];
      basis = "withheld";
    }
    targetBasis[basis] += 1;
    return target.sourceArticleIds.map((itemId) => ({
      itemId,
      evidenceHash: target.evidenceHash,
      categories,
      contentType: prediction.classification?.contentType
        || deterministic?.contentType || "other",
      routingBasis: basis,
      ...(editorialImportance ? { editorialImportance } : {})
    }));
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));

  const snapshot = {
    contract: CATEGORY_ROUTING_CONTRACT,
    snapshotId: `routing-${String(packet.sourceSnapshot?.savedAt || "unknown")}`,
    generatedAt: predictions.generatedAt || new Date().toISOString(),
    source: {
      packetSha256: source.packetSha256,
      predictionsSha256: source.predictionsSha256,
      ...(editorialImportanceReview ? {
        editorialImportanceContract: EDITORIAL_IMPORTANCE_CONTRACT,
        editorialImportanceReviewSha256: source.editorialImportanceReviewSha256
      } : {}),
      candidateId: predictions.candidate?.candidateId || packet.candidate?.candidateId || null
    },
    counts: {
      entries: entries.length,
      classifiedArticles: entries.filter((entry) => entry.categories.length > 0).length,
      modelClassifiedArticles: entries.filter((entry) => entry.routingBasis === "current_model").length,
      admittedArticles: entries.filter((entry) => entry.categories.length > 0).length,
      withheldArticles: entries.filter((entry) => entry.categories.length === 0).length,
      routingBasis: targetBasis
    },
    entries
  };
  return validateCategoryRoutingSnapshot(snapshot);
}

export function buildRecoveredCategoryRoutingSnapshot(packet, predictions, priorSnapshot, registry, source = {}) {
  if (!Array.isArray(packet?.targets) || !Array.isArray(predictions?.results) || !Array.isArray(registry)) {
    throw new TypeError("category routing recovery: packet, partial predictions, and registry required");
  }
  validateCategoryRoutingSnapshot(priorSnapshot);
  const currentByHash = new Map();
  for (const row of predictions.results) {
    if (!row?.itemId) throw new Error("category routing recovery: prediction itemId required");
    if (!["classified", "cache_hit"].includes(row.status)) continue;
    const classification = row.classification;
    if (!/^[0-9a-f]{64}$/.test(classification?.evidenceHash)
      || !validateClassificationSchema(classification).ok) {
      throw new Error(`category routing recovery: invalid current prediction '${row.itemId}'`);
    }
    const prior = currentByHash.get(classification.evidenceHash);
    if (prior && JSON.stringify(prior.classification) !== JSON.stringify(classification)) {
      throw new Error(`category routing recovery: conflicting current hash '${classification.evidenceHash}'`);
    }
    currentByHash.set(classification.evidenceHash, row);
  }
  const priorByHash = new Map();
  for (const entry of priorSnapshot.entries) {
    const value = {
      categories: [...entry.categories],
      contentType: entry.contentType || "other",
      routingBasis: entry.routingBasis || "withheld"
    };
    const prior = priorByHash.get(entry.evidenceHash);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value)) {
      throw new Error(`category routing recovery: conflicting prior hash '${entry.evidenceHash}'`);
    }
    priorByHash.set(entry.evidenceHash, value);
  }
  const entriesById = new Map();
  const targetBasis = {
    current_model: 0, prior_exact_hash: 0, deterministic_tier_policy: 0, withheld: 0
  };

  for (const target of packet.targets) {
    if (!target?.itemId || !/^[0-9a-f]{64}$/.test(target.evidenceHash)
      || !Array.isArray(target.sourceArticleIds) || !target.sourceArticleIds.length) {
      throw new Error(`category routing recovery: invalid target '${target?.itemId || ""}'`);
    }
    const current = currentByHash.get(target.evidenceHash);
    const currentClassified = Boolean(current);
    const prior = priorByHash.get(target.evidenceHash);
    const reusablePrior = prior?.categories.length > 0
      && ["current_model", "prior_exact_hash"].includes(prior.routingBasis);
    let value;
    let routingBasis;
    if (currentClassified) {
      if (current.classification?.evidenceHash !== target.evidenceHash
        || !validateClassificationSchema(current.classification).ok) {
        throw new Error(`category routing recovery: current prediction mismatch '${target.itemId}'`);
      }
      value = {
        categories: admittedCategories(current.classification),
        contentType: current.classification.contentType
      };
      routingBasis = "current_model";
    } else if (reusablePrior) {
      value = prior;
      routingBasis = "prior_exact_hash";
    } else {
      const deterministic = deterministicRouting(target);
      value = deterministic || {
        categories: [],
        contentType: ["news", "community", "deal"].includes(target.contentKindHint)
          ? target.contentKindHint : "other"
      };
      routingBasis = deterministic ? "deterministic_tier_policy" : "withheld";
    }
    targetBasis[routingBasis] += 1;
    for (const itemId of target.sourceArticleIds) {
      const entry = {
        itemId,
        evidenceHash: target.evidenceHash,
        categories: [...value.categories],
        contentType: value.contentType,
        sourceId: target.sourceId,
        routingBasis
      };
      const prior = entriesById.get(itemId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) {
        throw new Error(`category routing recovery: conflicting article '${itemId}'`);
      }
      entriesById.set(itemId, entry);
    }
  }

  const entries = [...entriesById.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const modelClassifiedArticles = entries.filter((entry) => entry.routingBasis === "current_model").length;
  const admittedArticles = entries.filter((entry) => entry.categories.length > 0).length;
  return validateCategoryRoutingSnapshot({
    contract: CATEGORY_ROUTING_CONTRACT,
    snapshotId: `routing-recovered-${String(packet.sourceSnapshot?.savedAt || "unknown")}`,
    generatedAt: predictions.generatedAt || source.generatedAt || packet.sourceSnapshot?.savedAt,
    source: {
      packetSha256: source.packetSha256,
      predictionsSha256: source.predictionsSha256,
      priorSnapshotSha256: source.priorSnapshotSha256,
      registrySha256: source.registrySha256,
      categoryPolicySha256: source.categoryPolicySha256,
      candidateId: predictions.candidate?.candidateId || packet.candidate?.candidateId || null,
      recoveryPolicy: "current_model_then_exact_prior_then_current_packet_deterministic"
    },
    counts: {
      entries: entries.length,
      classifiedArticles: admittedArticles,
      modelClassifiedArticles,
      admittedArticles,
      withheldArticles: entries.length - admittedArticles,
      routingBasis: targetBasis
    },
    entries
  });
}

export function parseProgress(raws, generatedAt) {
  const list = Array.isArray(raws) ? raws : [raws];
  return {
    generatedAt,
    results: list.flatMap((raw) => raw.trim() ? raw.trim().split("\n").map(JSON.parse) : [])
  };
}

function main() {
  const args = process.argv.slice(2);
  const packetFile = arg(args, "--packet");
  const predictionsFile = arg(args, "--predictions");
  const progressFiles = argsFor(args, "--progress");
  const progressFile = progressFiles[0] || null;
  const priorSnapshotFile = arg(args, "--prior-snapshot");
  const registryFile = arg(args, "--registry");
  const categoryPolicyFile = arg(args, "--category-policy");
  const editorialImportanceFile = arg(args, "--editorial-importance");
  const outFile = arg(args, "--out");
  if (!packetFile || !outFile || (!predictionsFile && !progressFile)) {
    throw new Error("usage: --packet <packet.json> (--predictions <predictions.json> [--editorial-importance <review.json> --registry <communities.json>] | --progress <progress.jsonl> --prior-snapshot <snapshot.json> --registry <communities.json> --category-policy <file>) --out <snapshot.json>");
  }
  const packetRaw = fs.readFileSync(packetFile, "utf8");
  const progressRaws = progressFiles.map((file) => fs.readFileSync(file, "utf8"));
  const predictionsRaw = predictionsFile
    ? fs.readFileSync(predictionsFile, "utf8")
    : progressRaws.join("\n");
  let snapshot;
  if (progressFile) {
    if (editorialImportanceFile) throw new Error("category routing recovery: importance review unsupported");
    if (!priorSnapshotFile || !registryFile || !categoryPolicyFile) {
      throw new Error("category routing recovery: --prior-snapshot, --registry, and --category-policy required");
    }
    const priorRaw = fs.readFileSync(priorSnapshotFile, "utf8");
    const registryRaw = fs.readFileSync(registryFile, "utf8");
    const policyRaw = fs.readFileSync(categoryPolicyFile, "utf8");
    const registryJson = JSON.parse(registryRaw);
    snapshot = buildRecoveredCategoryRoutingSnapshot(
      JSON.parse(packetRaw),
      parseProgress(progressRaws, new Date(Math.max(...progressFiles
        .map((file) => fs.statSync(file).mtimeMs))).toISOString()),
      JSON.parse(priorRaw),
      Array.isArray(registryJson) ? registryJson : registryJson.communities,
      {
        packetSha256: sha256(packetRaw), predictionsSha256: sha256(predictionsRaw),
        priorSnapshotSha256: sha256(priorRaw), registrySha256: sha256(registryRaw),
        categoryPolicySha256: sha256(policyRaw)
      }
    );
  } else {
    if (editorialImportanceFile && !registryFile) {
      throw new Error("category routing importance: --registry required");
    }
    const importanceRaw = editorialImportanceFile ? fs.readFileSync(editorialImportanceFile, "utf8") : null;
    const registryJson = registryFile ? JSON.parse(fs.readFileSync(registryFile, "utf8")) : [];
    snapshot = buildCategoryRoutingSnapshot(JSON.parse(packetRaw), JSON.parse(predictionsRaw), {
      packetSha256: sha256(packetRaw), predictionsSha256: sha256(predictionsRaw),
      ...(importanceRaw ? { editorialImportanceReviewSha256: sha256(importanceRaw) } : {})
    }, {
      editorialImportanceReview: importanceRaw ? JSON.parse(importanceRaw) : null,
      registry: Array.isArray(registryJson) ? registryJson : registryJson.communities
    });
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(snapshot)}\n`);
  process.stdout.write(`${JSON.stringify({ outFile, snapshotId: snapshot.snapshotId, counts: snapshot.counts })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
