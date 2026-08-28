import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildReaderLineage, readerIssueCopy } from "./editorial-reader-copy.js";
import { cleanArticleTextChrome, isJunkImage, looksLikePageChrome } from "./enrich.js";
import { CATEGORIES } from "./taxonomy.js";

export const SLOT_CANONICAL_EDITION_CONTRACT = Object.freeze({
  stableId: "NOWHOT-SLOT-CANONICAL-EDITION-001",
  version: 1,
  targetPerCategory: 14,
  activationMinimumPerCategory: 13,
  preparedDetailStatuses: ["ready", "excerpt_only", "source_unavailable"]
});

const categoryOrder = new Map(CATEGORIES.map((category, index) => [category.id, index]));
const categoryById = new Map(CATEGORIES.map((category) => [category.id, category]));
const slotOrder = new Map(["morning", "lunch", "evening"].map((slotId, index) => [slotId, index]));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => structuredClone(value);
const issueId = (issue) => String(issue?.evidenceHash || issue?.clusterId || "").trim();
const pointerKey = (date, slotId) => `${date}:${slotId}`;
const safeImage = (url) => {
  try { return url && !isJunkImage(new URL(url)) ? url : null; } catch { return null; }
};

function payloadFingerprint(issue) {
  return sha256(JSON.stringify({
    headline: issue?.headline || null,
    paragraph: issue?.paragraph || null,
    whyImportant: issue?.whyImportant || null,
    whyHot: issue?.whyHot || null,
    watchNext: issue?.watchNext || null,
    reader: issue?.reader || null,
    refs: issue?.refs || [],
    sourceEvidence: issue?.sourceEvidence || [],
    eventSources: issue?.eventSources || [],
    articleSummary: issue?.articleSummary || null
  }));
}

function artifactPayload(artifact) {
  const { artifactId, contentSha256, ...payload } = artifact;
  return payload;
}

function fail(message) {
  const error = new Error(`slot canonical edition: ${message}`);
  error.code = "SLOT_CANONICAL_EDITION_INVALID";
  throw error;
}

function preparedDetail(issue) {
  const summary = issue?.articleSummary;
  if (!summary || !SLOT_CANONICAL_EDITION_CONTRACT.preparedDetailStatuses.includes(summary.status)) return false;
  const links = Array.isArray(summary.sourceLinks) ? summary.sourceLinks : [];
  if (!links.some((row) => /^https?:\/\//i.test(String(row?.url || "")))) return false;
  if (summary.status === "ready" && !String(summary.textKo || "").trim()) return false;
  if (summary.status === "excerpt_only" && !String(summary.textKo || "").trim()) return false;
  if (summary.status === "source_unavailable" && !String(summary.unavailableReasonCode || "").trim()) return false;
  return true;
}

export function validateSlotCanonicalEdition(artifact) {
  const errors = [];
  if (!artifact || typeof artifact !== "object") return { ok: false, errors: ["artifact object required"] };
  if (artifact.contractId !== SLOT_CANONICAL_EDITION_CONTRACT.stableId ||
      artifact.contractVersion !== SLOT_CANONICAL_EDITION_CONTRACT.version) errors.push("contract mismatch");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(artifact.editionDate || ""))) errors.push("editionDate invalid");
  if (!String(artifact.slot?.id || "").trim()) errors.push("slot.id missing");
  if (artifact.builderPacketSha256 !== artifact.routingSnapshot?.source?.packetSha256) {
    errors.push("routingSnapshot source packetSha256 mismatch");
  }

  const lanes = artifact.lanes || {};
  const laneIds = Object.keys(lanes).sort((a, b) => (categoryOrder.get(a) ?? 99) - (categoryOrder.get(b) ?? 99));
  const expectedIds = CATEGORIES.map((category) => category.id);
  if (JSON.stringify(laneIds) !== JSON.stringify(expectedIds)) errors.push("14 category lanes required");
  const union = new Set();
  for (const category of expectedIds) {
    const ids = lanes[category];
    if (!Array.isArray(ids)) { errors.push(`${category} lane missing`); continue; }
    if (ids.length < SLOT_CANONICAL_EDITION_CONTRACT.activationMinimumPerCategory) {
      errors.push(`${category} lane requires at least 13 issues`);
    }
    if (ids.length > SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory) {
      errors.push(`${category} lane exceeds 14 issues`);
    }
    if (new Set(ids).size !== ids.length) errors.push(`${category} lane contains duplicate issue ids`);
    ids.forEach((id) => union.add(id));
  }

  const issueTable = artifact.issueTable || {};
  const displayOrder = artifact.displayOrder || [];
  if (!Array.isArray(displayOrder) || new Set(displayOrder).size !== displayOrder.length) {
    errors.push("displayOrder invalid");
  }
  if (displayOrder.length !== union.size || displayOrder.some((id) => !union.has(id))) {
    errors.push("displayOrder must equal lane union");
  }
  for (const id of union) {
    const issue = issueTable[id];
    if (!issue) { errors.push(`issueTable missing ${id}`); continue; }
    if (issueId(issue) !== id) errors.push(`issueTable id mismatch ${id}`);
    const memberships = expectedIds.filter((category) => lanes[category]?.includes(id));
    if (JSON.stringify(issue.selectedByCategories) !== JSON.stringify(memberships)) {
      errors.push(`selectedByCategories mismatch ${id}`);
    }
    if (!preparedDetail(issue)) errors.push(`articleSummary not prepared ${id}`);
  }
  for (const id of Object.keys(issueTable)) if (!union.has(id)) errors.push(`unreferenced issue ${id}`);

  if (artifact.contentSha256 && artifact.contentSha256 !== sha256(JSON.stringify(artifactPayload(artifact)))) {
    errors.push("contentSha256 mismatch");
  }
  return { ok: errors.length === 0, errors };
}

export function assertSlotCanonicalEdition(artifact) {
  const result = validateSlotCanonicalEdition(artifact);
  if (!result.ok) fail(result.errors.join("; "));
  return artifact;
}

export function buildSlotCanonicalEdition({
  editionsByCategory,
  unionEdition,
  builderPacketSha256,
  routingSnapshot,
  createdAt = unionEdition?.generatedAt || new Date().toISOString()
}) {
  if (!unionEdition || !Array.isArray(unionEdition.issues)) fail("unionEdition required");
  const unionIssues = new Map();
  for (const issue of unionEdition.issues) {
    const id = issueId(issue);
    if (!id || unionIssues.has(id)) fail(`union issue id invalid or duplicate: ${id || "empty"}`);
    unionIssues.set(id, issue);
  }

  const lanes = {};
  const memberships = new Map();
  for (const category of CATEGORIES) {
    const edition = editionsByCategory?.[category.id];
    const issues = edition?.issues;
    if (!Array.isArray(issues)) fail(`${category.id} lane missing`);
    if (issues.length < SLOT_CANONICAL_EDITION_CONTRACT.activationMinimumPerCategory) {
      fail(`${category.id} lane requires at least 13 issues`);
    }
    if (issues.length > SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory) {
      fail(`${category.id} lane exceeds 14 issues`);
    }
    lanes[category.id] = issues.map((laneIssue) => {
      const id = issueId(laneIssue);
      const canonical = unionIssues.get(id);
      if (!id || !canonical) fail(`${category.id} lane issue missing from union: ${id || "empty"}`);
      if (payloadFingerprint(laneIssue) !== payloadFingerprint(canonical)) {
        fail(`${category.id} lane content drift: ${id}`);
      }
      if (!memberships.has(id)) memberships.set(id, new Set());
      memberships.get(id).add(category.id);
      return id;
    });
  }

  const issueTable = {};
  for (const [id, source] of unionIssues) {
    const selectedByCategories = CATEGORIES
      .map((category) => category.id)
      .filter((category) => memberships.get(id)?.has(category));
    if (!selectedByCategories.length) fail(`union issue is not in a lane: ${id}`);
    const reader = readerIssueCopy(source);
    const frozen = clone(source);
    if (frozen.articleSummary) {
      frozen.articleSummary.image = safeImage(frozen.articleSummary.image);
      frozen.articleSummary.textKo = cleanArticleTextChrome(frozen.articleSummary.textKo);
      if (looksLikePageChrome(frozen.articleSummary.textKo)) {
        frozen.articleSummary.status = "source_unavailable";
        frozen.articleSummary.textKo = null;
        frozen.articleSummary.summarySourceCount = 0;
        frozen.articleSummary.unavailableReasonCode = "NO_PUBLIC_BODY";
        frozen.articleSummary.excerptBasis = null;
      }
    }
    issueTable[id] = {
      ...frozen,
      reader,
      readerLineage: buildReaderLineage(source, reader),
      selectedByCategories
    };
  }
  const displayOrder = unionEdition.issues.map(issueId);
  const {
    issues: _issues,
    selection: _selection,
    selectedCategories: _selectedCategories,
    requestedCategories: _requestedCategories,
    servedCategories: _servedCategories,
    withheldCategories: _withheldCategories,
    categoryFulfillment: _categoryFulfillment,
    serving: _serving,
    ...baseEdition
  } = clone(unionEdition);
  const payload = {
    contractId: SLOT_CANONICAL_EDITION_CONTRACT.stableId,
    contractVersion: SLOT_CANONICAL_EDITION_CONTRACT.version,
    editionDate: unionEdition.editionDate,
    slot: clone(unionEdition.slot),
    createdAt,
    builderPacketSha256,
    routingSnapshot: clone(routingSnapshot),
    targetPerCategory: SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory,
    activationMinimumPerCategory: SLOT_CANONICAL_EDITION_CONTRACT.activationMinimumPerCategory,
    availableCategories: CATEGORIES.map(({ id, label }) => ({ id, label })),
    baseEdition,
    lanes,
    displayOrder,
    issueTable
  };
  const contentSha256 = sha256(JSON.stringify(payload));
  return assertSlotCanonicalEdition({
    ...payload,
    artifactId: `SCE-${contentSha256.slice(0, 16)}`,
    contentSha256
  });
}

function selectedCategories(categories) {
  const unique = [...new Set((categories || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!unique.length) fail("at least one category required");
  for (const category of unique) if (!categoryById.has(category)) fail(`unknown category ${category}`);
  return unique.sort((a, b) => categoryOrder.get(a) - categoryOrder.get(b));
}

export function projectSlotCanonicalEdition(artifact, {
  categories,
  selectionMode = "request",
  explicit = true,
  validated = false,
  fallback = false,
  requestedDate = artifact.editionDate,
  requestedSlotId = artifact.slot.id
} = {}) {
  if (!validated) assertSlotCanonicalEdition(artifact);
  const selected = selectedCategories(categories);
  const selectedSet = new Set(selected);
  const issues = artifact.displayOrder
    .filter((id) => artifact.issueTable[id].selectedByCategories.some((category) => selectedSet.has(category)))
    .map((id) => clone(artifact.issueTable[id]));
  const categoryRows = selected.map((category) => ({
    categoryId: category,
    label: categoryById.get(category).label,
    issueCount: artifact.lanes[category].length,
    eligibleIssueCount: artifact.lanes[category].length,
    target: artifact.activationMinimumPerCategory,
    state: "met"
  }));
  const sourceKeys = new Set(issues.flatMap((issue) => issue.eventSources || issue.sourceEvidence || [])
    .map((row) => row?.sourceGroup || row?.canonicalUrl || row?.url).filter(Boolean));
  const overseas = issues.filter((issue) => issue.overseasOnly).length;
  const fulfillment = {
    contractId: "NOWHOT-SLOT-CANONICAL-FULFILLMENT-001",
    state: "fulfillment_complete",
    selectedCount: selected.length,
    metCount: selected.length,
    issuedCount: selected.length,
    selectedEligibleIssueCount: issues.length,
    uniqueCreditedIssueCount: issues.length,
    multiCategoryIssueCount: issues.filter((issue) => issue.selectedByCategories.length > 1).length,
    targetPerCategory: artifact.activationMinimumPerCategory,
    goalSatisfied: true,
    missingCategoryIds: [],
    noQualifiedCategoryIds: [],
    underfilledCategoryIds: [],
    rows: categoryRows
  };
  return {
    ...clone(artifact.baseEdition),
    editionId: artifact.artifactId,
    editionDate: artifact.editionDate,
    slot: clone(artifact.slot),
    generatedAt: artifact.createdAt,
    issues,
    itemCount: issues.length,
    sourceCount: sourceKeys.size,
    overseasShare: issues.length ? Math.round(overseas / issues.length * 100) : 0,
    publishable: true,
    partial: false,
    selectedCategories: selected,
    requestedCategories: selected,
    servedCategories: selected,
    withheldCategories: [],
    availableCategories: clone(artifact.availableCategories),
    selection: {
      mode: selectionMode,
      categories: selected.map((id) => clone(categoryById.get(id))),
      explicit,
      perCategory: artifact.targetPerCategory,
      maxIssues: selected.length * artifact.targetPerCategory,
      categoryIssueLimit: artifact.targetPerCategory,
      additiveCategoryUnion: true,
      minIssuesPerCategory: artifact.activationMinimumPerCategory,
      generationMinIssuesPerCategory: artifact.activationMinimumPerCategory
    },
    categoryFulfillment: fulfillment,
    serving: {
      contractId: "NOWHOT-SLOT-CANONICAL-SERVING-001",
      contractVersion: 1,
      state: fallback ? "fallback_slot_pointer" : "slot_canonical_verified",
      responsePacketId: artifact.contentSha256,
      editionId: artifact.artifactId,
      selectedCategories: selected,
      availableCategories: clone(artifact.availableCategories),
      failures: [],
      metrics: { issueCount: issues.length },
      fulfillment,
      fallback,
      requestedDate,
      requestedSlotId,
      servedDate: artifact.editionDate,
      servedSlotId: artifact.slot.id,
      verifiedAt: artifact.createdAt
    },
    llmCalls: 0,
    slotCanonicalEdition: {
      contractId: artifact.contractId,
      contractVersion: artifact.contractVersion,
      artifactId: artifact.artifactId,
      contentSha256: artifact.contentSha256,
      requestWork: "filter_only"
    }
  };
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function activateSlotCanonicalEdition({ artifact, directory, pointerFile }) {
  assertSlotCanonicalEdition(artifact);
  fs.mkdirSync(directory, { recursive: true });
  const artifactFile = path.join(directory,
    `edition-${artifact.editionDate}-${artifact.slot.id}-${artifact.contentSha256.slice(0, 12)}.json`);
  if (!fs.existsSync(artifactFile)) atomicJson(artifactFile, artifact);
  let pointer = { contractId: "NOWHOT-SLOT-CANONICAL-POINTER-001", contractVersion: 1, editions: {} };
  if (fs.existsSync(pointerFile)) pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  pointer = {
    ...pointer,
    updatedAt: new Date().toISOString(),
    editions: {
      ...(pointer.editions || {}),
      [pointerKey(artifact.editionDate, artifact.slot.id)]: {
        artifactId: artifact.artifactId,
        contentSha256: artifact.contentSha256,
        file: path.relative(path.dirname(pointerFile), artifactFile)
      }
    }
  };
  fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
  atomicJson(pointerFile, pointer);
  return { artifactFile, pointer };
}

export function makeSlotCanonicalEditionReader({ pointerFile }) {
  const cache = new Map();
  return {
    read({ date, slotId, categories, selectionMode, explicit }) {
      let pointer;
      try { pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8")); }
      catch { fail(`active pointer unavailable: ${pointerFile}`); }
      const exactKey = pointerKey(date, slotId);
      const entry = pointer?.editions?.[exactKey];
      if (!entry?.file) {
        const error = new Error(`slot canonical edition unavailable: ${date} ${slotId}`);
        error.code = "SLOT_CANONICAL_EDITION_UNAVAILABLE";
        throw error;
      }
      const base = path.resolve(path.dirname(pointerFile));
      const artifactFile = path.resolve(base, entry.file);
      if (artifactFile !== base && !artifactFile.startsWith(`${base}${path.sep}`)) fail("pointer file escapes directory");
      let artifact = cache.get(artifactFile);
      if (!artifact) {
        artifact = assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(artifactFile, "utf8")));
        if (artifact.artifactId !== entry.artifactId || artifact.contentSha256 !== entry.contentSha256) {
          fail("pointer identity mismatch");
        }
        cache.set(artifactFile, artifact);
      }
      return projectSlotCanonicalEdition(artifact, {
        categories,
        selectionMode,
        explicit,
        validated: true,
        fallback: false,
        requestedDate: date,
        requestedSlotId: slotId
      });
    }
  };
}
