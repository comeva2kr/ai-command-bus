// NOWHOT D1-I category-only holdout contract. No provider or API access.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { admissionGate } from "../src/feed/selection-contract.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { evidenceHashOf, validateClassifierOutput } from "../src/feed/selection-classifier-lab.js";
import { d1gEvaluationSet } from "./run-selection-d1c.mjs";
import { getCandidate } from "./selection-candidate-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (name) => path.join(ROOT, "test", "fixtures", name);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const jsonSha = (value) => sha256(JSON.stringify(value));

export const D1I_HOLDOUT_PATH = FIX("selection-d1i-holdout.lock.json");
export const D1I_HOLDOUT_LOCK = Object.freeze(JSON.parse(fs.readFileSync(D1I_HOLDOUT_PATH, "utf8")));

export function deriveD1iHoldout(corpus) {
  const set = d1gEvaluationSet(corpus);
  const rowById = new Map(corpus.rows.map((row) => [row.blindItemId, row]));
  const rows = set.restItems.map((item) => {
    const source = rowById.get(item.blindItemId);
    if (!source) throw new Error(`D1I_HOLDOUT_CORRUPT: source row missing '${item.blindItemId}'`);
    return { itemId: item.blindItemId, evidenceHash: evidenceHashOf(source) };
  });
  const canaryIds = new Set(set.canaryItems.map((item) => item.blindItemId));
  if (rows.some((row) => canaryIds.has(row.itemId) || set.auditExcluded.includes(row.itemId))) {
    throw new Error("D1I_HOLDOUT_CORRUPT: canary/audit overlap");
  }
  return {
    items: set.restItems,
    rows,
    canaryCount: set.canaryItems.length,
    auditExcludedCount: set.auditExcluded.length,
    orderedItemIdsSha256: jsonSha(rows.map((row) => row.itemId)),
    orderedEvidenceRowsSha256: jsonSha(rows)
  };
}

export function deriveD1iGoldProjection(derived, gold) {
  const labels = Array.isArray(gold?.labels) ? gold.labels : [];
  const goldById = new Map();
  for (const label of labels) {
    if (!label?.itemId || goldById.has(label.itemId)) {
      throw new Error(`D1I_HOLDOUT_CORRUPT: invalid or duplicate gold '${label?.itemId || "missing"}'`);
    }
    goldById.set(label.itemId, label);
  }
  const rows = derived.rows.map(({ itemId }) => {
    const label = goldById.get(itemId);
    if (!label || typeof label.goldContentType !== "string" || !Array.isArray(label.goldAcceptedCategories)) {
      throw new Error(`D1I_HOLDOUT_CORRUPT: gold row missing '${itemId}'`);
    }
    return {
      itemId,
      goldContentType: label.goldContentType,
      goldAcceptedCategories: [...label.goldAcceptedCategories].sort()
    };
  });
  return { rows, orderedGoldProjectionSha256: jsonSha(rows) };
}

export function scanD1iHoldoutExposure(attemptsDir, candidateId) {
  if (!attemptsDir || !fs.existsSync(attemptsDir)) return [];
  const exposed = [];
  for (const entry of fs.readdirSync(attemptsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(attemptsDir, entry.name);
    const manifestPath = path.join(dir, "attempt-manifest.json");
    const terminalPath = path.join(dir, "terminal-receipt.json");
    let manifest = null;
    let terminal = null;
    try { if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { exposed.push(`${entry.name}:corrupt_manifest`); }
    try { if (fs.existsSync(terminalPath)) terminal = JSON.parse(fs.readFileSync(terminalPath, "utf8")); } catch { exposed.push(`${entry.name}:corrupt_terminal`); }
    if (manifest?.candidateId === candidateId && fs.existsSync(path.join(dir, "full-predictions.json"))) exposed.push(`${entry.name}:full_predictions`);
    if (terminal?.candidateId === candidateId && terminal.phase === "full") exposed.push(`${entry.name}:full_terminal`);
  }
  return [...new Set(exposed)].sort();
}

export function validateD1iHoldoutLock({
  lock = D1I_HOLDOUT_LOCK,
  corpusRaw = fs.readFileSync(FIX("selection-d1-corpus.json"), "utf8"),
  goldRaw = fs.readFileSync(FIX("selection-d1-gold.json"), "utf8"),
  authorityRaw = fs.readFileSync(FIX("selection-d1g-adversarial-authority-002.json"), "utf8"),
  attemptsDir = null
} = {}) {
  const errors = [];
  if (lock?.contract !== "NOWHOT-SELECTION-D1I-HOLDOUT-001" || lock?.schemaVersion !== 1 || lock?.status !== "SEALED_UNRUN") errors.push("contract/status");
  let candidate;
  try { candidate = getCandidate(lock?.candidate?.candidateId); } catch { errors.push("candidate"); }
  if (candidate) {
    if (candidate.task !== "category_admission_only" || !["design_frozen", "approved_canary"].includes(candidate.execution.state)) errors.push("candidate_state");
    if (candidate.requestedModel !== lock.candidate.requestedModel || candidate.promptSha256 !== lock.candidate.promptSha256) errors.push("candidate_identity");
  }
  if (sha256(corpusRaw) !== lock?.sources?.corpusSha256) errors.push("corpus_sha");
  if (sha256(goldRaw) !== lock?.sources?.goldSha256) errors.push("gold_sha");
  if (sha256(authorityRaw) !== lock?.sources?.authoritySha256) errors.push("authority_sha");
  let derived;
  let goldProjection;
  try { derived = deriveD1iHoldout(JSON.parse(corpusRaw)); } catch { errors.push("derivation"); }
  try {
    if (derived) goldProjection = deriveD1iGoldProjection(derived, JSON.parse(goldRaw));
  } catch { errors.push("gold_projection"); }
  if (derived) {
    if (derived.items.length !== lock.derivation.holdoutCount || derived.canaryCount !== lock.derivation.canaryCount || derived.auditExcludedCount !== lock.derivation.auditExcludedCount) errors.push("partition_counts");
    if (derived.orderedItemIdsSha256 !== lock.derivation.orderedItemIdsSha256 || derived.orderedEvidenceRowsSha256 !== lock.derivation.orderedEvidenceRowsSha256) errors.push("partition_sha");
    if (goldProjection?.orderedGoldProjectionSha256 !== lock.derivation.orderedGoldProjectionSha256) errors.push("gold_projection_sha");
    try {
      const counts = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0]));
      for (const label of goldProjection?.rows || []) {
        for (const category of label.goldAcceptedCategories || []) if (Object.hasOwn(counts, category)) counts[category] += 1;
      }
      const uncovered = Object.entries(counts).filter(([, count]) => count === 0).map(([category]) => category).sort();
      if (JSON.stringify(counts) !== JSON.stringify(lock.coverage?.acceptedItemCounts)
        || JSON.stringify(uncovered) !== JSON.stringify(lock.coverage?.uncoveredCategories)
        || lock.coverage?.allCategoriesCovered !== false) errors.push("coverage");
    } catch { errors.push("coverage"); }
  }
  const gate = lock?.gate || {};
  if (gate.exactCategoryAdmissionMinRate !== 0.98 || gate.maxWholeItemCategoryErrors !== 1
    || gate.unexpectedAdmissionMax !== 0 || gate.criticalContentTypeConfusionsMax !== 0 || gate.productPromotionAllowed !== false) errors.push("gate");
  if (derived && (derived.items.length - gate.maxWholeItemCategoryErrors) / derived.items.length < gate.exactCategoryAdmissionMinRate) errors.push("gate_math");
  const exposures = candidate ? scanD1iHoldoutExposure(attemptsDir, candidate.candidateId) : [];
  if (exposures.length > 0) errors.push("holdout_exposed");
  return { ok: errors.length === 0, errors, holdoutCount: derived?.items.length || null, exposures };
}

export function evaluateD1iCategoryHoldout({ corpus, gold, predictions, versions, lock = D1I_HOLDOUT_LOCK } = {}) {
  const checked = validateD1iHoldoutLock({ lock });
  if (!checked.ok) throw new Error(`D1I_HOLDOUT_CORRUPT: ${checked.errors.join(",")}`);
  const derived = deriveD1iHoldout(corpus);
  if (derived.orderedItemIdsSha256 !== lock.derivation.orderedItemIdsSha256
    || derived.orderedEvidenceRowsSha256 !== lock.derivation.orderedEvidenceRowsSha256) {
    throw new Error("D1I_HOLDOUT_CORRUPT: evaluation corpus differs from sealed partition");
  }
  const goldProjection = deriveD1iGoldProjection(derived, gold);
  if (goldProjection.orderedGoldProjectionSha256 !== lock.derivation.orderedGoldProjectionSha256) {
    throw new Error("D1I_HOLDOUT_CORRUPT: evaluation gold differs from sealed projection");
  }
  const { items } = derived;
  const goldById = new Map(gold.labels.map((row) => [row.itemId, row]));
  const predById = new Map((predictions || []).map((row) => [row.itemId, row]));
  let valid = 0;
  let exact = 0;
  let unexpectedAdmission = 0;
  let expectedAdmissionMiss = 0;
  let criticalContentTypeConfusions = 0;
  const failures = [];
  for (const item of items) {
    const expected = goldById.get(item.itemId);
    const prediction = predById.get(item.itemId);
    const cls = prediction && (prediction.status === "classified" || prediction.status === "cache_hit") ? prediction.classification : null;
    const schemaOk = cls && validateClassifierOutput(cls, item, versions).ok;
    if (!expected || !schemaOk) { failures.push({ itemId: item.itemId, reason: !expected ? "missing_gold" : "invalid_prediction" }); continue; }
    valid += 1;
    const actualSet = new Set(admissionGate(cls).admitted);
    const expectedSet = new Set(expected.goldAcceptedCategories || []);
    const unexpected = [...actualSet].filter((category) => !expectedSet.has(category));
    const missed = [...expectedSet].filter((category) => !actualSet.has(category));
    unexpectedAdmission += unexpected.length;
    expectedAdmissionMiss += missed.length;
    const contentTypeMatch = cls.contentType === expected.goldContentType;
    if ((expected.goldContentType === "community" || expected.goldContentType === "deal") && cls.contentType === "news") criticalContentTypeConfusions += 1;
    if (contentTypeMatch && unexpected.length === 0 && missed.length === 0) exact += 1;
    else failures.push({ itemId: item.itemId, expected: [...expectedSet].sort(), actual: [...actualSet].sort(), contentTypeMatch });
  }
  const errors = items.length - exact;
  const exactRate = items.length > 0 ? exact / items.length : 0;
  const pass = valid === items.length && exactRate >= lock.gate.exactCategoryAdmissionMinRate
    && errors <= lock.gate.maxWholeItemCategoryErrors && unexpectedAdmission <= lock.gate.unexpectedAdmissionMax
    && criticalContentTypeConfusions <= lock.gate.criticalContentTypeConfusionsMax;
  return {
    status: pass ? "CATEGORY_HOLDOUT_PASS" : "CATEGORY_HOLDOUT_HOLD",
    pass,
    total: items.length,
    valid,
    exact,
    exactRate,
    errors,
    unexpectedAdmission,
    expectedAdmissionMiss,
    criticalContentTypeConfusions,
    failures,
    productPromotionAllowed: false,
    allCategoriesCovered: lock.coverage.allCategoriesCovered,
    uncoveredCategories: [...lock.coverage.uncoveredCategories],
    claimLimit: lock.gate.claimLimit
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateD1iHoldoutLock({ attemptsDir: path.join(ROOT, ".nowhot-local", "selection-attempts") });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}
