import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildReaderLineage, readerIssueCopy } from "./editorial-reader-copy.js";
import { cleanArticleTextChrome, isJunkImage, looksLikePageChrome } from "./enrich.js";
import { publicExcerpt } from "./article-summary.js";
import { CATEGORIES } from "./taxonomy.js";
import { slotAsOfMs } from "./editorial-inventory.js";
import { SLOTS, VERIFIED_SOURCE_ROLES, slotById } from "./digest.js";
import { EDITORIAL_SERVING_CONTRACT } from "./editorial-serving.js";
import { buildEditorialFulfillment, EDITORIAL_FULFILLMENT_CONTRACT } from "./editorial-fulfillment.js";

export const SLOT_CANONICAL_EDITION_CONTRACT = Object.freeze({
  stableId: "NOWHOT-SLOT-CANONICAL-EDITION-001",
  version: 2,
  legacyVersions: [1],
  // Eight qualified distinct stories is the per-category goal; fewer is an honest partial lane.
  // Fourteen is the baseline lane capacity. Positions 15..20 are open, lane by lane with no
  // shared quota, only to issues whose own evidence already shows a news event reported by two
  // or more independent source groups, led by an article from the current slot's window.
  // This is automated multi-source news selection, not human-validated importance.
  targetPerCategory: 8,
  laneCapacity: 14,
  extraLaneCapacity: EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.flexibleLaneDepth,
  maxPreparedIssues: EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.flexibleMaxPublished,
  legacyMaxPreparedIssues: EDITORIAL_FULFILLMENT_CONTRACT.issueBudget.maxPublished,
  extraLanePolicy: "automated_multi_source_news_selection",
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
  try { return /^https?:\/\//i.test(url || "") && !isJunkImage(new URL(url)) ? url : null; } catch { return null; }
};
const firstPublishedAt = (issue) => {
  const timestamps = [
    ...(issue?.eventSources || []),
    ...(issue?.sourceEvidence || []),
    ...(issue?.refs || []),
    ...(issue?.articleSummary?.sourceLinks || [])
  ].map((row) => Date.parse(row?.publishedAt || "")).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
};

// The current slot's own window: from the previous slot's publish time to this slot's publish
// time. The morning opens at the previous evening's publish hour (19:00), not at the evening
// preparation start, so an 18:59 article belongs to the evening that already published it.
export function extraLaneFreshnessWindow(editionDate, slotId) {
  const index = SLOTS.findIndex((row) => row.id === slotId);
  const midnight = Date.parse(`${editionDate}T00:00:00+09:00`);
  const start = index <= 0
    ? midnight - (24 - slotById("evening").publishHour) * 3600000
    : slotAsOfMs(editionDate, SLOTS[index - 1].id);
  return { start, end: slotAsOfMs(editionDate, slotId) };
}

const leadPublishedMs = (issue) => Date.parse(
  issue?.eventSources?.[0]?.publishedAt || issue?.firstPublishedAt || issue?.refs?.[0]?.publishedAt || "");

// Deterministic from fields the issue already carries; no reviewer decision is minted.
// Only verified news roles (primary, reported_secondary, first_party) count; community-only
// lines, unknown roles and single-feed reports never qualify, whatever their engagement, and
// the lead must come from the current slot's window. Returns null when qualified, else the reason.
// evidence.independentGroupCount also counts community boards; extras need two distinct
// reporting operator groups from the event's own source evidence (1 news + 1 board fails).
function reportingGroupCount(issue) {
  const rows = Array.isArray(issue?.event?.sourceEvidence) ? issue.event.sourceEvidence : null;
  if (rows) {
    return new Set(rows.filter((row) => row?.evidenceRole === "reporting")
      .map((row) => String(row?.operatorGroup || "").trim()).filter(Boolean)).size;
  }
  const counted = Number(issue?.event?.counts?.independentReportingGroups);
  return Number.isFinite(counted) ? counted : 0;
}

export function extraLaneRejection(issue, { editionDate, slotId } = {}) {
  const metrics = issue?.metrics || {};
  const roles = metrics.sourceRoles && typeof metrics.sourceRoles === "object" ? metrics.sourceRoles : {};
  const verifiedRoles = Object.entries(roles).filter(([role, count]) => VERIFIED_SOURCE_ROLES.has(role) && Number(count) > 0);
  const groups = Number(issue?.evidence?.independentGroupCount ?? metrics.independentGroupCount) || 0;
  if (metrics.communityOnly !== false || !verifiedRoles.length || groups < 2) return "not_multi_source_news";
  if (reportingGroupCount(issue) < 2) return "fewer_than_two_reporting_groups";
  if (!editionDate || !slotId) return "slot_window_unknown";
  const { start, end } = extraLaneFreshnessWindow(editionDate, slotId);
  const published = leadPublishedMs(issue);
  if (!Number.isFinite(published) || published < start || published > end) return "outside_current_slot_window";
  return null;
}

export const extraLaneQualified = (issue, target) => extraLaneRejection(issue, target) === null;

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
  const legacy = SLOT_CANONICAL_EDITION_CONTRACT.legacyVersions.includes(artifact?.contractVersion);
  if (artifact.contractId !== SLOT_CANONICAL_EDITION_CONTRACT.stableId ||
      (!legacy && artifact.contractVersion !== SLOT_CANONICAL_EDITION_CONTRACT.version)) errors.push("contract mismatch");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(artifact.editionDate || ""))) errors.push("editionDate invalid");
  if (!String(artifact.slot?.id || "").trim()) errors.push("slot.id missing");
  if (artifact.summaryBuildMode != null && !["free_only", "paid_allowed"].includes(artifact.summaryBuildMode)) {
    errors.push("summaryBuildMode invalid");
  }
  const availableVerified = artifact.coveragePolicy === "available_verified";
  if ("coveragePolicy" in artifact && !availableVerified) errors.push("coveragePolicy invalid");
  if (availableVerified && (!/^[a-f0-9]{64}$/.test(artifact.contentSha256 || "")
      || artifact.artifactId !== `SCE-${artifact.contentSha256.slice(0, 16)}`)) {
    errors.push("artifact identity invalid");
  }
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
    if (!availableVerified && ids.length < SLOT_CANONICAL_EDITION_CONTRACT.activationMinimumPerCategory) {
      errors.push(`${category} lane requires at least 13 issues`);
    }
    const laneMax = legacy ? SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity : SLOT_CANONICAL_EDITION_CONTRACT.extraLaneCapacity;
    if (ids.length > laneMax) errors.push(`${category} lane exceeds ${laneMax} issues`);
    for (const id of ids.slice(SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity, laneMax)) {
      const rejection = extraLaneRejection(artifact.issueTable?.[id], { editionDate: artifact.editionDate, slotId: artifact.slot?.id });
      if (rejection) errors.push(`${category} extra issue not qualified (${rejection}): ${id}`);
    }
    if (new Set(ids).size !== ids.length) errors.push(`${category} lane contains duplicate issue ids`);
    ids.forEach((id) => union.add(id));
  }
  if (!union.size) errors.push("at least one verified issue required");
  const preparedMax = legacy ? SLOT_CANONICAL_EDITION_CONTRACT.legacyMaxPreparedIssues : SLOT_CANONICAL_EDITION_CONTRACT.maxPreparedIssues;
  if (union.size > preparedMax) errors.push(`prepared issues exceed ${preparedMax}`);

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
  summaryBuildMode = "free_only",
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
    if (issues.length > SLOT_CANONICAL_EDITION_CONTRACT.extraLaneCapacity) {
      fail(`${category.id} lane exceeds ${SLOT_CANONICAL_EDITION_CONTRACT.extraLaneCapacity} issues`);
    }
    issues.slice(SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity).forEach((laneIssue) => {
      const rejection = extraLaneRejection(laneIssue, { editionDate: unionEdition?.editionDate, slotId: unionEdition?.slot?.id });
      if (rejection) fail(`${category.id} extra issue not qualified (${rejection}): ${issueId(laneIssue)}`);
    });
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
    delete frozen._categoryLaneRanks;
    if (frozen.articleSummary) {
      frozen.articleSummary.image = safeImage(frozen.articleSummary.image);
      for (const link of frozen.articleSummary.sourceLinks || []) {
        if (link?.image) link.image = safeImage(link.image);
      }
      frozen.articleSummary.textKo = cleanArticleTextChrome(frozen.articleSummary.textKo);
      const chrome = looksLikePageChrome(frozen.articleSummary.textKo);
      if (frozen.articleSummary.status === "excerpt_only") {
        frozen.articleSummary.textKo = publicExcerpt(frozen.articleSummary.textKo);
      }
      if (chrome || (["ready", "excerpt_only"].includes(frozen.articleSummary.status) && !frozen.articleSummary.textKo)) {
        frozen.articleSummary.status = "source_unavailable";
        frozen.articleSummary.textKo = null;
        frozen.articleSummary.summarySourceCount = 0;
        frozen.articleSummary.unavailableReasonCode = "NO_PUBLIC_BODY";
        frozen.articleSummary.excerptBasis = null;
      }
    }
    issueTable[id] = {
      ...frozen,
      firstPublishedAt: firstPublishedAt(source),
      publicationTimeBasis: "source_feed_timestamp",
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
    digestSummary: _digestSummary,
    editionChange: _editionChange,
    continuityProjection: _continuityProjection,
    ...baseEdition
  } = clone(unionEdition);
  const payload = {
    contractId: SLOT_CANONICAL_EDITION_CONTRACT.stableId,
    contractVersion: SLOT_CANONICAL_EDITION_CONTRACT.version,
    coveragePolicy: "available_verified",
    editionDate: unionEdition.editionDate,
    slot: clone(unionEdition.slot),
    createdAt,
    summaryBuildMode,
    builderPacketSha256,
    routingSnapshot: clone(routingSnapshot),
    targetPerCategory: SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory,
    laneCapacity: SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity,
    extraLaneCapacity: SLOT_CANONICAL_EDITION_CONTRACT.extraLaneCapacity,
    maxPreparedIssues: SLOT_CANONICAL_EDITION_CONTRACT.maxPreparedIssues,
    extraLanePolicy: SLOT_CANONICAL_EDITION_CONTRACT.extraLanePolicy,
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
    .map((id) => artifact.issueTable[id]);
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
  const availableVerified = artifact.coveragePolicy === "available_verified";
  const fulfillment = availableVerified ? buildEditorialFulfillment({
    selectedCategories: selected,
    issues,
    candidateCounts: Object.fromEntries(selected.map(category => [category, artifact.lanes[category].length])),
    minimumIssuesPerCategory: SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory
  }) : {
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
  // Union-wide summaries describe the pre-lane edition, not the selected categories.
  const {
    digestSummary: _digestSummary,
    editionChange: _editionChange,
    continuityProjection: _continuityProjection,
    ...baseEdition
  } = clone(artifact.baseEdition);
  return {
    ...baseEdition,
    editionId: artifact.artifactId,
    editionDate: artifact.editionDate,
    slot: clone(artifact.slot),
    generatedAt: artifact.createdAt,
    issues,
    itemCount: issues.length,
    sourceCount: sourceKeys.size,
    overseasShare: issues.length ? Math.round(overseas / issues.length * 100) : 0,
    publishable: availableVerified ? issues.length > 0 : true,
    partial: availableVerified ? !fulfillment.goalSatisfied : false,
    selectedCategories: selected,
    requestedCategories: selected,
    servedCategories: availableVerified ? selected.filter(category => artifact.lanes[category].length > 0) : selected,
    withheldCategories: availableVerified ? fulfillment.rows.filter(row => row.issueCount === 0).map(row => ({
      categoryId: row.categoryId,
      label: row.label,
      reason: `${row.label} 분야에는 현재 검증된 기사가 없습니다.`
    })) : [],
    availableCategories: clone(artifact.availableCategories),
    selection: {
      mode: selectionMode,
      categories: selected.map((id) => clone(categoryById.get(id))),
      explicit,
      perCategory: artifact.extraLaneCapacity || SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity,
      maxIssues: selected.length * (artifact.extraLaneCapacity || SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity),
      categoryIssueLimit: artifact.extraLaneCapacity || SLOT_CANONICAL_EDITION_CONTRACT.laneCapacity,
      additiveCategoryUnion: true,
      minIssuesPerCategory: availableVerified ? SLOT_CANONICAL_EDITION_CONTRACT.targetPerCategory : artifact.activationMinimumPerCategory,
      generationMinIssuesPerCategory: availableVerified ? 0 : artifact.activationMinimumPerCategory
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

export function activateSlotCanonicalEditions({ artifacts, directory, pointerFile }) {
  if (!Array.isArray(artifacts) || !artifacts.length) fail("artifacts required");
  artifacts.forEach(assertSlotCanonicalEdition);
  const keys = artifacts.map((artifact) => pointerKey(artifact.editionDate, artifact.slot.id));
  if (new Set(keys).size !== keys.length) fail("duplicate date-slot artifact");
  fs.mkdirSync(directory, { recursive: true });
  let pointer = { contractId: "NOWHOT-SLOT-CANONICAL-POINTER-001", contractVersion: 1, editions: {} };
  if (fs.existsSync(pointerFile)) pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  const artifactFiles = artifacts.map((artifact) => path.join(directory,
    `edition-${artifact.editionDate}-${artifact.slot.id}-${artifact.contentSha256.slice(0, 12)}.json`));
  artifactFiles.forEach((artifactFile, index) => {
    if (!fs.existsSync(artifactFile)) atomicJson(artifactFile, artifacts[index]);
  });
  const entries = Object.fromEntries(artifacts.map((artifact, index) => [keys[index], {
    artifactId: artifact.artifactId,
    contentSha256: artifact.contentSha256,
    file: path.relative(path.dirname(pointerFile), artifactFiles[index])
  }]));
  // Only this atomic activation receipt authorizes exact shared-version reads.
  // Archive the old current entries before replacing their date-slot pointers.
  const publishedEditions = { ...(pointer.publishedEditions || {}) };
  for (const [key, entry] of [...Object.entries(pointer.editions || {}), ...Object.entries(entries)]) {
    if (entry?.artifactId && entry.file) publishedEditions[entry.artifactId] = { ...entry, key };
  }
  pointer = {
    ...pointer,
    updatedAt: new Date().toISOString(),
    publishedEditions,
    editions: {
      ...(pointer.editions || {}),
      ...entries
    }
  };
  fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
  atomicJson(pointerFile, pointer);
  return { artifactFiles, pointer };
}

export function activateSlotCanonicalEdition({ artifact, directory, pointerFile }) {
  const result = activateSlotCanonicalEditions({ artifacts: [artifact], directory, pointerFile });
  return { artifactFile: result.artifactFiles[0], pointer: result.pointer };
}

export function makeSlotCanonicalEditionReader({ pointerFile }) {
  const cache = new Map();
  const verifiedEntries = new Set();
  function load(entry, key) {
    const base = path.resolve(path.dirname(pointerFile));
    const artifactFile = path.resolve(base, entry.file);
    if (artifactFile !== base && !artifactFile.startsWith(`${base}${path.sep}`)) fail("pointer file escapes directory");
    let artifact = cache.get(artifactFile);
    if (!artifact) {
      artifact = assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(artifactFile, "utf8")));
      cache.set(artifactFile, artifact);
      // Keep payload memory bounded; the activation catalogue stores only identities.
      if (cache.size > 32) cache.delete(cache.keys().next().value);
    }
    if (artifact.artifactId !== entry.artifactId || artifact.contentSha256 !== entry.contentSha256
      || pointerKey(artifact.editionDate, artifact.slot.id) !== key) fail("pointer identity mismatch");
    return artifact;
  }
  return {
    list({ includePrevious = false, date: requestedDate, slotId: requestedSlot } = {}) {
      let pointer;
      try { pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8")); }
      catch { return []; }
      const entries = Object.entries(pointer.editions || {});
      if (includePrevious) entries.push(...Object.values(pointer.publishedEditions || {}).reverse().map(entry => [entry.key, entry]));
      const seen = new Set();
      return entries.flatMap(([key, entry]) => {
        if (typeof key !== "string") return [];
        const [date, slotId] = key.split(":");
        if ((requestedDate && date !== requestedDate) || (requestedSlot && slotId !== requestedSlot)) return [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slotOrder.has(slotId) || !entry?.file || seen.has(entry.artifactId)) return [];
        const identity = JSON.stringify([key, entry.artifactId, entry.contentSha256, entry.file]);
        if (!verifiedEntries.has(identity)) {
          try { load(entry, key); } catch { return []; }
          verifiedEntries.add(identity);
        }
        seen.add(entry.artifactId);
        return [{ date, slotId, editionId: entry.artifactId }];
      }).sort((a, b) => b.date.localeCompare(a.date) || slotOrder.get(b.slotId) - slotOrder.get(a.slotId));
    },
    read({ date, slotId, categories, selectionMode, explicit, editionId }) {
      let pointer;
      try { pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8")); }
      catch { fail(`active pointer unavailable: ${pointerFile}`); }
      const exactKey = pointerKey(date, slotId);
      let artifact;
      if (editionId != null) {
        const unavailable = () => {
          const error = new Error("공유한 오늘판을 찾을 수 없습니다. 링크의 판 정보를 확인해 주세요.");
          error.code = "SLOT_CANONICAL_EDITION_NOT_FOUND";
          return error;
        };
        if (!/^SCE-[a-f0-9]{16}$/.test(editionId)) throw unavailable();
        const current = pointer?.editions?.[exactKey];
        const entry = current?.artifactId === editionId ? { ...current, key: exactKey }
          : pointer?.publishedEditions?.[editionId];
        if (!entry?.file || entry.artifactId !== editionId || entry.key !== exactKey) throw unavailable();
        try { artifact = load(entry, exactKey); }
        catch (error) { if (error.code === "ENOENT") throw unavailable(); throw error; }
      } else {
        const entry = pointer?.editions?.[exactKey];
        artifact = entry?.file ? load(entry, exactKey) : null;
      }
      if (!artifact && editionId == null) {
        const requestedAt = slotAsOfMs(date, slotId);
        const candidates = Object.entries(pointer?.editions || {}).map(([key, row]) => {
          const [candidateDate, candidateSlot] = key.split(":");
          const at = /^\d{4}-\d{2}-\d{2}$/.test(candidateDate) && slotOrder.has(candidateSlot)
            ? slotAsOfMs(candidateDate, candidateSlot) : NaN;
          return { key, row, at };
        }).filter(({ row, at }) => row?.file && at < requestedAt
          && requestedAt - at <= EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs)
          .sort((a, b) => b.at - a.at);
        for (const candidate of candidates) {
          try { artifact = load(candidate.row, candidate.key); break; }
          catch { /* An invalid older candidate must not hide another verified edition. */ }
        }
      }
      if (!artifact) {
        const slotLabel = { morning: "모닝", lunch: "런치", evening: "이브닝" }[slotId] || slotId;
        const error = new Error(`${date} ${slotLabel}판은 아직 준비되지 않았습니다. 다른 시간대를 선택해 주세요.`);
        error.code = "SLOT_CANONICAL_EDITION_UNAVAILABLE";
        throw error;
      }
      return projectSlotCanonicalEdition(artifact, {
        categories,
        selectionMode,
        explicit,
        validated: true,
        fallback: pointerKey(artifact.editionDate, artifact.slot.id) !== exactKey,
        requestedDate: date,
        requestedSlotId: slotId
      });
    }
  };
}
