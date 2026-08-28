import { buildBlindReviewPacket } from "./editorial-quality.js";
import { attachEditorialFulfillment } from "./editorial-fulfillment.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_SERVING_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-SERVING-CONTRACT-001",
  version: 3,
  maxFallbackAgeMs: 24 * 60 * 60 * 1000,
  currentRule: "독자에게 반환할 정확한 응답이 기계·독자 문장·다양성 게이트를 통과하고 14건 목표 분야마다 최소 13건을 채우면 제공한다.",
  fallbackRule: "같은 분야 조합의 24시간 이내 판본 중 현재 계약으로 다시 계산한 응답 지문이 저장 영수증과 같은 판본만 제공한다.",
  failureRule: "현재판과 검증된 이전판이 모두 없으면 HTTP 409로 닫는다.",
  humanReviewRequired: false,
  humanReviewBoundary: "자동 하루 세 판 제공 게이트와 표본 사람 검수·운영 배포 승인은 별도 증거다."
});

const categoryIds = (value) => {
  const rows = Array.isArray(value)
    ? value
    : value && value.selection && Array.isArray(value.selection.categories)
      ? value.selection.categories
      : [];
  return [...new Set(rows.map((row) => typeof row === "string" ? row : row && row.id)
    .map((id) => String(id || "").trim())
    .filter(Boolean))].sort();
};

export function sameEditorialCategorySet(left, right) {
  const a = categoryIds(left);
  const b = categoryIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function canonicalIdentityKeys(issue) {
  const value = (prefix, input, { eventBase = false } = {}) => {
    const text = String(input || "").trim();
    if (!text) return null;
    return `${prefix}:${eventBase ? text.split(":")[0] : text}`;
  };
  const strong = [
    value("canonical", issue?.event?.eventId, { eventBase: true }),
    value("canonical", issue?.eventSourceSetId, { eventBase: true }),
    value("canonical", issue?.clusterId)
  ].filter(Boolean);
  if (strong.length) return [...new Set(strong)];
  const evidence = value("evidence", issue?.evidenceHash);
  if (evidence) return [evidence];
  const primary = issue?.refs?.[0] || null;
  return [
    value("url", primary?.canonicalUrl || primary?.url),
    value("ref", primary?.id)
  ].filter(Boolean).slice(0, 1);
}

export function assessEditorialServeability(edition) {
  const packet = buildBlindReviewPacket(edition || {});
  const issues = Array.isArray(edition && edition.issues) ? edition.issues : [];
  const selectedCategories = categoryIds(edition);
  const fulfillment = edition && edition.categoryFulfillment || null;
  const seenCanonicalKeys = new Set();
  const uniqueCanonicalEvents = issues.every((issue) => {
    const keys = canonicalIdentityKeys(issue);
    if (keys.some((key) => seenCanonicalKeys.has(key))) return false;
    for (const key of keys) seenCanonicalKeys.add(key);
    return true;
  });
  const checks = {
    publishable: edition && edition.publishable === true,
    issueCountPresent: issues.length > 0,
    responsePacketComplete: packet.rows.length === issues.length && packet.editionId === (edition && edition.editionId || null),
    canonicalMachinePass: packet.metrics.canonicalMachinePass === issues.length,
    readerIssuePass: packet.metrics.readerIssuePass === issues.length,
    readerPacketPass: packet.metrics.readerPacketPass === true,
    reviewPacketReady: packet.state === "human_annotation_ready",
    uniqueCanonicalEvents,
    categoryFulfillmentPass: Boolean(
      fulfillment &&
      Array.isArray(fulfillment.rows) &&
      fulfillment.rows.length === selectedCategories.length &&
      fulfillment.rows.every((row) => {
        const target = Math.max(1, Number(row.target) || 1);
        const minimum = target >= 14 ? 13 : target;
        return Number(row.issueCount) >= minimum;
      })
    ),
    categorySetAccounted: Boolean(
      fulfillment &&
      selectedCategories.length > 0 &&
      Number(fulfillment.selectedCount) === selectedCategories.length
    )
  };
  const failures = [];
  if (!checks.publishable) failures.push("canonical_publishable_hold");
  if (!checks.issueCountPresent) failures.push("empty_edition_hold");
  if (!checks.responsePacketComplete) failures.push("response_packet_mismatch");
  if (!checks.canonicalMachinePass) failures.push("canonical_machine_hold");
  if (!checks.readerIssuePass || !checks.reviewPacketReady) failures.push("reader_copy_hold");
  if (!checks.readerPacketPass) failures.push("reader_diversity_hold");
  if (!checks.uniqueCanonicalEvents) failures.push("duplicate_event_hold");
  if (!checks.categoryFulfillmentPass || !checks.categorySetAccounted) failures.push("category_fulfillment_hold");
  const uniqueFailures = [...new Set(failures)];

  return {
    contractId: EDITORIAL_SERVING_CONTRACT.stableId,
    contractVersion: EDITORIAL_SERVING_CONTRACT.version,
    state: uniqueFailures.length ? "serveable_machine_hold" : "serveable_machine_verified",
    pass: uniqueFailures.length === 0,
    failures: uniqueFailures,
    editionId: edition && edition.editionId || null,
    packetId: packet.packetId,
    selectedCategories,
    checks,
    metrics: { ...packet.metrics },
    fulfillment: fulfillment ? {
      state: fulfillment.state || null,
      goalSatisfied: fulfillment.goalSatisfied === true,
      selectedCount: Number(fulfillment.selectedCount) || 0,
      metCount: Number(fulfillment.metCount) || 0,
      issuedCount: Number(fulfillment.issuedCount) || 0,
      missingCategoryIds: fulfillment.missingCategoryIds || [],
      noQualifiedCategoryIds: fulfillment.noQualifiedCategoryIds || [],
      underfilledCategoryIds: fulfillment.underfilledCategoryIds || []
    } : null,
    packet
  };
}

export function omitHeldEditorialIssues(edition) {
  const issues = Array.isArray(edition?.issues) ? edition.issues : [];
  const kept = issues.filter((issue) => {
    const row = buildBlindReviewPacket({ ...edition, issues: [issue] }).rows[0];
    return row?.machineGate?.pass === true && row?.readerGate?.pass === true;
  });
  return kept.length === issues.length ? edition : attachEditorialFulfillment({
    ...edition,
    issues: kept,
    servingProjection: {
      ...(edition.servingProjection || {}),
      heldIssueCount: issues.length - kept.length,
      rule: "omit_machine_or_reader_held_issues"
    }
  });
}
