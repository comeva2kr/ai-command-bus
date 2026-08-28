import { createHash } from "node:crypto";
import { canonicalContentUrl } from "./dedupe.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_LINEAGE_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-LINEAGE-CONTRACT-001",
  version: 4,
  fingerprintVersion: 5,
  claimFields: ["headline", "paragraph", "whatHappened", "whyImportant", "whyHot", "whyForYou", "watchNext"],
  primaryEvidenceClaimFields: ["headline", "paragraph", "whatHappened", "whyImportant", "watchNext"],
  excludedPrimaryEvidenceRoles: ["related_observation"],
  basis: ["source_titles", "measured_signal", "explicit_selection", "editorial_policy", "editorial_watch"],
  excludes: ["원문 전문", "모델 사전지식", "추정 출처 수", "추정 반응 수"]
});

const hash = (value) => createHash("sha256").update(String(value || "")).digest("hex");
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).filter(Boolean))];

function sourceEvidenceRow(item, role) {
  const meta = item && item.editorialCandidate || {};
  const sourceIdentity = operationalSourceIdentity(item);
  const title = clean(item && item.title || meta.title);
  const sourceId = clean(meta.sourceId || item && item.source || "unknown");
  const sourceLabel = clean(meta.sourceLabel || item && (item.sourceLabel || item.source) || sourceId);
  const canonicalUrl = meta.canonicalUrl || canonicalContentUrl(item && item.url) || null;
  const identity = canonicalUrl || `${sourceId}|${title}`;
  return {
    evidenceId: `NHE-${hash(identity).slice(0, 16)}`,
    itemId: item && item.id || meta.itemId || null,
    title,
    sourceId,
    sourceLabel,
    sourceRole: meta.sourceRole || "unknown",
    ownershipGroup: sourceIdentity.ownershipGroup,
    ownershipBasis: sourceIdentity.ownershipBasis,
    syndicationGroup: meta.syndicationGroup || null,
    canonicalUrl,
    publishedAt: item && item.publishedAt || meta.publishedAt || null,
    observedAt: meta.observedAt || null,
    carryover: item && item.editorialCarryover ? { ...item.editorialCarryover }
      : meta.carryover ? { ...meta.carryover } : null,
    evidenceRole: role
  };
}

export function buildSourceEvidence(items) {
  const rows = [];
  const seen = new Set();
  for (const [index, item] of (items || []).entries()) {
    const candidates = [
      { item, role: index ? "corroborating" : "lead" },
      ...(Array.isArray(item && item.related) ? item.related.map((related) => ({
        item: related,
        role: "related_observation"
      })) : [])
    ];
    for (const candidate of candidates) {
      const row = sourceEvidenceRow(candidate.item, candidate.role);
      if (!row.title || !row.sourceId || seen.has(row.evidenceId)) continue;
      seen.add(row.evidenceId);
      rows.push(row);
    }
  }
  return rows;
}

function inputFingerprint(issue) {
  return {
    subject: clean(issue && issue.subject),
    categoryIds: unique(issue && issue.categoryIds).sort(),
    evidence: (issue && issue.sourceEvidence || []).map((row) => ({
      evidenceId: row.evidenceId,
      title: row.title,
      sourceId: row.sourceId,
      sourceRole: row.sourceRole,
      ownershipGroup: row.ownershipGroup,
      syndicationGroup: row.syndicationGroup,
      canonicalUrl: row.canonicalUrl,
      publishedAt: row.publishedAt
    })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    measured: {
      evidenceMode: issue && issue.evidence && issue.evidence.mode || issue && issue.metrics && issue.metrics.evidenceMode || "unknown",
      observedFeedCount: finite(issue && issue.evidence && issue.evidence.observedFeedCount || issue && issue.metrics && issue.metrics.sourceCount),
      independentGroupCount: finite(issue && issue.evidence && issue.evidence.independentGroupCount || issue && issue.metrics && issue.metrics.independentGroupCount),
      relatedCoverageSignal: Boolean(issue && issue.evidence && issue.evidence.relatedCoverageSignal),
      score: finite(issue && issue.metrics && issue.metrics.score),
      comments: finite(issue && issue.metrics && issue.metrics.comments),
      coverage: finite(issue && issue.metrics && issue.metrics.coverage)
    }
  };
}

export function editorialEvidenceHash(issue) {
  return hash(JSON.stringify(inputFingerprint(issue)));
}

function editorialContentHash(issue, claims) {
  const text = EDITORIAL_LINEAGE_CONTRACT.claimFields.map((field) => [
    field,
    clean(issue && issue[field])
  ]);
  const claimBasis = EDITORIAL_LINEAGE_CONTRACT.claimFields.map((field) => {
    const claim = claims && claims[field] || {};
    return [field, {
      basis: claim.basis || null,
      evidenceIds: unique(claim.evidenceIds).sort(),
      categoryIds: unique(claim.categoryIds).sort(),
      policyRule: clean(claim.policyRule),
      measured: claim.measured || null
    }];
  });
  return hash(JSON.stringify({
    contractId: EDITORIAL_LINEAGE_CONTRACT.stableId,
    fingerprintVersion: EDITORIAL_LINEAGE_CONTRACT.fingerprintVersion,
    text,
    claimBasis
  }));
}

export function attachEditorialLineage(issue, { selectedCategories = [] } = {}) {
  const sourceEvidence = Array.isArray(issue && issue.sourceEvidence) ? issue.sourceEvidence : [];
  const evidenceIds = sourceEvidence.map((row) => row.evidenceId);
  const primaryEvidenceIds = sourceEvidence
    .filter((row) => row && row.evidenceRole !== "related_observation")
    .map((row) => row.evidenceId);
  const selected = unique(selectedCategories).sort();
  const measured = inputFingerprint({ ...issue, sourceEvidence }).measured;
  const claims = {
    headline: { basis: "source_titles", evidenceIds: primaryEvidenceIds },
    paragraph: { basis: "source_titles", evidenceIds: primaryEvidenceIds },
    whatHappened: { basis: "source_titles", evidenceIds: primaryEvidenceIds },
    whyImportant: {
      basis: "editorial_policy",
      evidenceIds: primaryEvidenceIds,
      policyRule: clean(issue && issue.impactLens || "현재 흐름")
    },
    whyHot: { basis: "measured_signal", evidenceIds, measured },
    whyForYou: { basis: "explicit_selection", categoryIds: selected },
    watchNext: { basis: "editorial_watch", evidenceIds: primaryEvidenceIds }
  };
  const evidenceHash = editorialEvidenceHash({ ...issue, sourceEvidence });
  return {
    ...issue,
    sourceEvidence,
    evidenceHash,
    claimLineage: {
      contractId: EDITORIAL_LINEAGE_CONTRACT.stableId,
      fingerprintVersion: EDITORIAL_LINEAGE_CONTRACT.fingerprintVersion,
      state: "lineage_attached",
      claims,
      contentHash: editorialContentHash(issue, claims)
    }
  };
}

export function verifyEditorialLineage(issue) {
  const evidence = issue && issue.sourceEvidence || [];
  const lineage = issue && issue.claimLineage || {};
  const claims = lineage.claims || {};
  const ids = evidence.map((row) => row.evidenceId);
  const known = new Set(ids);
  const relatedEvidenceIds = new Set(evidence
    .filter((row) => row && row.evidenceRole === "related_observation")
    .map((row) => row.evidenceId));
  const failures = [];
  if (lineage.contractId !== EDITORIAL_LINEAGE_CONTRACT.stableId) failures.push("lineage_contract_mismatch");
  if (lineage.fingerprintVersion !== EDITORIAL_LINEAGE_CONTRACT.fingerprintVersion) {
    failures.push("fingerprint_version_mismatch");
  }
  if (lineage.contentHash !== editorialContentHash(issue, claims)) failures.push("content_hash_mismatch");
  if (!evidence.length) failures.push("source_evidence_missing");
  if (known.size !== ids.length) failures.push("duplicate_evidence_id");
  for (const row of evidence) {
    if (!row.evidenceId || !row.title || !row.sourceId) failures.push("invalid_source_evidence");
    if (row.canonicalUrl && !/^https?:\/\//.test(row.canonicalUrl)) failures.push("invalid_canonical_url");
  }
  for (const field of EDITORIAL_LINEAGE_CONTRACT.claimFields) {
    const claim = claims[field];
    if (!claim || !EDITORIAL_LINEAGE_CONTRACT.basis.includes(claim.basis)) {
      failures.push(`claim_missing:${field}`);
      continue;
    }
    for (const evidenceId of claim.evidenceIds || []) {
      if (!known.has(evidenceId)) failures.push(`unknown_evidence:${field}`);
      if (
        EDITORIAL_LINEAGE_CONTRACT.primaryEvidenceClaimFields.includes(field) &&
        relatedEvidenceIds.has(evidenceId)
      ) failures.push(`related_evidence_for_primary_claim:${field}`);
    }
  }
  if (issue && issue.evidenceHash !== editorialEvidenceHash(issue)) failures.push("evidence_hash_mismatch");
  const expectedMeasured = inputFingerprint(issue).measured;
  if (JSON.stringify(claims.whyHot && claims.whyHot.measured) !== JSON.stringify(expectedMeasured)) {
    failures.push("measured_lineage_mismatch");
  }
  const uniqueFailures = unique(failures);
  return {
    state: uniqueFailures.length ? "lineage_hold" : "lineage_pass",
    pass: uniqueFailures.length === 0,
    evidenceCount: evidence.length,
    claimCount: Object.keys(claims).length,
    failures: uniqueFailures
  };
}
