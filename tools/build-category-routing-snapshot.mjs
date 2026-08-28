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

export function buildCategoryRoutingSnapshot(packet, predictions, source = {}) {
  if (!Array.isArray(packet?.targets) || !Array.isArray(predictions?.results)) {
    throw new TypeError("category routing build: packet and recovered predictions required");
  }
  const byTarget = new Map(predictions.results.map((row) => [row.itemId, row]));
  if (byTarget.size !== packet.targets.length) throw new Error("category routing build: incomplete predictions");

  const entries = packet.targets.flatMap((target) => {
    const prediction = byTarget.get(target.itemId);
    const classified = ["classified", "cache_hit"].includes(prediction?.status);
    if (!prediction || (classified && prediction.classification?.evidenceHash !== target.evidenceHash)) {
      throw new Error(`category routing build: prediction mismatch '${target.itemId}'`);
    }
    const categories = classified
      ? admittedCategories(prediction.classification)
      : [];
    return target.sourceArticleIds.map((itemId) => ({
      itemId,
      evidenceHash: target.evidenceHash,
      categories,
      contentType: prediction.classification?.contentType || "other"
    }));
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));

  const snapshot = {
    contract: CATEGORY_ROUTING_CONTRACT,
    snapshotId: `routing-${String(packet.sourceSnapshot?.savedAt || "unknown")}`,
    generatedAt: predictions.generatedAt || new Date().toISOString(),
    source: {
      packetSha256: source.packetSha256,
      predictionsSha256: source.predictionsSha256,
      candidateId: predictions.candidate?.candidateId || packet.candidate?.candidateId || null
    },
    counts: {
      entries: entries.length,
      classifiedArticles: entries.filter((entry) => entry.categories.length > 0).length,
      withheldArticles: entries.filter((entry) => entry.categories.length === 0).length
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
  const priorIsPureModelSnapshot = Boolean(priorSnapshot.source?.candidateId)
    && !priorSnapshot.source?.recoveryPolicy
    && priorSnapshot.entries.every((entry) => entry.routingBasis == null);
  const priorByHash = new Map();
  for (const entry of priorSnapshot.entries) {
    const value = {
      categories: [...entry.categories],
      contentType: entry.contentType || "other",
      routingBasis: entry.routingBasis || (priorIsPureModelSnapshot ? "current_model" : "prior_exact_hash")
    };
    const prior = priorByHash.get(entry.evidenceHash);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value)) {
      throw new Error(`category routing recovery: conflicting prior hash '${entry.evidenceHash}'`);
    }
    priorByHash.set(entry.evidenceHash, value);
  }
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const entriesById = new Map();
  const allowLegacyFallback = source.allowLegacyFallback === true;
  const targetBasis = {
    current_model: 0, prior_exact_hash: 0, specialist_registry_default: 0,
    ...(allowLegacyFallback ? { legacy_classifier_fallback: 0 } : {}), withheld: 0
  };
  let policyCorrectionSkipped = 0;

  for (const target of packet.targets) {
    if (!target?.itemId || !/^[0-9a-f]{64}$/.test(target.evidenceHash)
      || !Array.isArray(target.sourceArticleIds) || !target.sourceArticleIds.length) {
      throw new Error(`category routing recovery: invalid target '${target?.itemId || ""}'`);
    }
    const current = currentByHash.get(target.evidenceHash);
    const currentClassified = Boolean(current);
    const meta = registryById.get(target.sourceId);
    const specialist = meta?.enabled === true && meta.kind === "news"
      && meta.sourceTier === "specialist" && isKnownCategory(meta.category);
    const prior = priorByHash.get(target.evidenceHash);
    const reusablePrior = prior?.categories.length > 0
      && (prior.routingBasis === "current_model"
        || (prior.routingBasis === "specialist_registry_default"
          && specialist && prior.categories.length === 1 && prior.categories[0] === meta.category));
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
      routingBasis = prior.routingBasis;
    } else {
      const legacy = allowLegacyFallback && isKnownCategory(target.legacyCategory)
        && ["news", "community", "deal"].includes(target.contentKindHint);
      value = specialist
        ? { categories: [meta.category], contentType: "news" }
        : legacy ? { categories: [target.legacyCategory], contentType: target.contentKindHint }
          : { categories: [], contentType: ["news", "community", "deal"].includes(target.contentKindHint)
            ? target.contentKindHint : "other" };
      routingBasis = specialist ? "specialist_registry_default"
        : legacy ? "legacy_classifier_fallback" : "withheld";
      if (specialist && isKnownCategory(target.legacyCategory) && target.legacyCategory !== meta.category) {
        policyCorrectionSkipped += 1;
      }
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
      recoveryPolicy: allowLegacyFallback
        ? "current_model_then_exact_prior_then_specialist_then_legacy_classifier"
        : "current_model_then_current_specialist_registry_default",
      policyCorrectionSkipped
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
  const allowLegacyFallback = args.includes("--allow-legacy-fallback");
  const outFile = arg(args, "--out");
  if (!packetFile || !outFile || (!predictionsFile && !progressFile)) {
    throw new Error("usage: --packet <packet.json> (--predictions <predictions.json> | --progress <progress.jsonl> --prior-snapshot <snapshot.json> --registry <communities.json> --category-policy <file>) --out <snapshot.json>");
  }
  const packetRaw = fs.readFileSync(packetFile, "utf8");
  const progressRaws = progressFiles.map((file) => fs.readFileSync(file, "utf8"));
  const predictionsRaw = predictionsFile
    ? fs.readFileSync(predictionsFile, "utf8")
    : progressRaws.join("\n");
  let snapshot;
  if (progressFile) {
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
        categoryPolicySha256: sha256(policyRaw), allowLegacyFallback
      }
    );
  } else {
    snapshot = buildCategoryRoutingSnapshot(JSON.parse(packetRaw), JSON.parse(predictionsRaw), {
      packetSha256: sha256(packetRaw), predictionsSha256: sha256(predictionsRaw)
    });
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(snapshot)}\n`);
  process.stdout.write(`${JSON.stringify({ outFile, snapshotId: snapshot.snapshotId, counts: snapshot.counts })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
