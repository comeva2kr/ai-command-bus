import { canonicalContentUrl, eventKey } from "./dedupe.js";
import { isGoogleNewsRedirect } from "./canonical-url.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";
import { categoryLabel } from "./taxonomy.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITION_CANDIDATE_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITION-CANDIDATE-CONTRACT-001",
  version: 8,
  defaultCandidateCap: 60,
  maxCandidateCap: 240,
  carryoverMaxHours: 24,
  carryoverCandidateFloor: 14,
  carryoverSourceRoles: ["primary", "reported_secondary", "community_signal", "first_party", "unknown"],
  purpose: "기존 수집물에서 자체 편집 판본으로 들어간 동적 재료를 재현하는 내부 계약",
  dedupeRule: "canonical_url",
  orderRule: "한국어 독자판은 읽을 수 있는 선택 카테고리 최소 후보와 소스 상한을 먼저 확보한 뒤 원래 편집 점수 순서를 복원",
  sourceCapRule: "소스 상한은 이번 판의 후보 안전 상한에 비례하며 최소 2건",
  categoryFloorRule: "선택 카테고리마다 최소 후보를 확보하고 지역 편성 분야는 검수 전 국내외 후보를 각각 같은 깊이로 보존",
  carryoverRule: "최근 24시간의 미제공 유효 콘텐츠를 부족 분야 목표 깊이까지 이월하고, 이미 제공한 canonical URL은 제외",
  requiredFields: [
    "candidateId", "itemId", "canonicalUrl", "clusterKey", "title",
    "categoryId", "sourceId", "sourceRole", "ownershipGroup",
    "ownershipBasis", "marketPolicyDesk", "signals", "observedAt"
  ],
  sourceRoles: ["primary", "reported_secondary", "community_signal", "first_party", "unknown"],
  humanValidation: "pending",
  llmCalls: 0
});

function sourceRole(entry, item) {
  if (entry && EDITION_CANDIDATE_CONTRACT.sourceRoles.includes(entry.sourceRole)) return entry.sourceRole;
  if (item.via === "me" || item.via === "ourdeal" || (entry && entry.adapter && entry.adapter.type === "store")) return "first_party";
  if (item.kind === "community" || (entry && entry.kind === "community")) return "community_signal";
  if (item.kind === "news" || (entry && entry.kind === "news")) return "reported_secondary";
  return "unknown";
}

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function koreanAudienceReadable(item) {
  const title = String(item && item.title || "");
  const englishWords = (title.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  return /[가-힣]/.test(title) || englishWords <= 3;
}

const categoryIdsOf = (item) => Array.isArray(item?.admittedCategories)
  && item.admittedCategories.length ? item.admittedCategories : [item?.category || "news"];

function unresolvedRelayStub(item) {
  const hasBody = [item?.summary, item?.excerpt, item?.body, item?.content, item?.fullText]
    .some((value) => String(value || "").trim());
  const title = String(item?.title || "").trim();
  return isGoogleNewsRedirect(item?.url) && !item?.canonicalUrl && !hasBody
    && /^\S{1,10}$/u.test(title);
}

export function buildEditionCandidateFixture(items, {
  registry = [],
  selectedCategories = [],
  limit = EDITION_CANDIDATE_CONTRACT.defaultCandidateCap,
  maxPerSource = null,
  minPerSelectedCategory = 6,
  domesticShareBands = {},
  preferKoreanAudience = false,
  observedAt = new Date().toISOString()
} = {}) {
  const max = Math.max(1, Math.min(
    EDITION_CANDIDATE_CONTRACT.maxCandidateCap,
    Math.floor(Number(limit) || EDITION_CANDIDATE_CONTRACT.defaultCandidateCap)
  ));
  const requestedCategoryFloor = Math.max(0, Math.floor(Number(minPerSelectedCategory) || 0));
  const sourceCap = Math.max(2, Math.min(max,
    Math.floor(Number(maxPerSource) || Math.max(Math.ceil(max / 10), requestedCategoryFloor))));
  const sourceById = new Map(registry.filter(Boolean).map((entry) => [entry.id, entry]));
  const selected = new Set((selectedCategories || []).filter(Boolean));
  const seenUrls = new Set();
  const eligible = [];
  const dropped = {
    invalid: 0, category: 0, monetization: 0, duplicateUrl: 0,
    relayStub: 0, sourceCap: 0, overflow: 0
  };

  for (const [rankIndex, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!item || !item.id || !String(item.title || "").trim()) {
      dropped.invalid += 1;
      continue;
    }
    if (["ad", "affiliate"].includes(item.kind) || ["ad", "affiliate"].includes(item.via)) {
      dropped.monetization += 1;
      continue;
    }
    if (unresolvedRelayStub(item)) {
      dropped.relayStub += 1;
      continue;
    }
    if (selected.size && !categoryIdsOf(item).some((category) => selected.has(category))) {
      dropped.category += 1;
      continue;
    }
    const canonicalUrl = canonicalContentUrl(item.url);
    if (!canonicalUrl) {
      dropped.invalid += 1;
      continue;
    }
    if (seenUrls.has(canonicalUrl)) {
      dropped.duplicateUrl += 1;
      continue;
    }
    seenUrls.add(canonicalUrl);
    const entry = sourceById.get(item.source) || null;
    const owner = operationalSourceIdentity(item, { registryEntry: entry });
    eligible.push({ item, entry, owner, canonicalUrl, rankIndex });
  }

  const picked = [];
  const pickedRanks = new Set();
  const sourceCounts = new Map();
  const add = (row) => {
    if (picked.length >= max || pickedRanks.has(row.rankIndex)) return false;
    const sourceId = row.item.source || "unknown";
    if ((sourceCounts.get(sourceId) || 0) >= sourceCap) return false;
    picked.push(row);
    pickedRanks.add(row.rankIndex);
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
    return true;
  };

  const categoryFloor = selected.size
    ? Math.max(1, Math.min(
      Math.floor(Number(minPerSelectedCategory) || 0),
      Math.floor(max / selected.size)
    ))
    : 0;
  if (categoryFloor) {
    for (const category of selected) {
      const categoryRows = eligible.filter((row) => categoryIdsOf(row.item).includes(category));
      if (preferKoreanAudience) categoryRows.sort((left, right) =>
        Number(koreanAudienceReadable(right.item)) - Number(koreanAudienceReadable(left.item)) ||
        left.rankIndex - right.rankIndex);
      if (domesticShareBands?.[category]) {
        const overseas = (row) => Boolean(row.entry?.country && row.entry.country !== "KR");
        const perCategoryBudget = Math.floor(max / selected.size);
        const domesticReserveDepth = Math.min(categoryFloor, Math.ceil(perCategoryBudget / 2));
        const overseasReserveDepth = Math.min(categoryFloor, Math.floor(perCategoryBudget / 2));
        const categoryCount = (predicate = () => true) => picked.filter((row) =>
          categoryIdsOf(row.item).includes(category) && predicate(row)).length;
        const fill = (predicate, reserveDepth) => {
          for (const row of categoryRows) {
            if (categoryCount(predicate) >= reserveDepth || picked.length >= max) break;
            if (!predicate(row)) continue;
            add(row);
          }
        };
        fill((row) => !overseas(row), domesticReserveDepth);
        fill(overseas, overseasReserveDepth);
        continue;
      }
      let count = 0;
      for (const row of categoryRows) {
        if (add(row)) count += 1;
        if (count >= categoryFloor || picked.length >= max) break;
      }
    }
  }
  for (const row of eligible) {
    if (picked.length >= max) break;
    add(row);
  }

  const leftovers = eligible.filter((row) => !pickedRanks.has(row.rankIndex));
  for (const row of leftovers) {
    const sourceId = row.item.source || "unknown";
    if ((sourceCounts.get(sourceId) || 0) >= sourceCap) dropped.sourceCap += 1;
    else dropped.overflow += 1;
  }

  picked.sort((a, b) => a.rankIndex - b.rankIndex);
  const candidates = picked.map(({ item, entry, owner, canonicalUrl }, index) => ({
      candidateId: `EC-${String(index + 1).padStart(3, "0")}`,
      itemId: item.id,
      canonicalUrl,
      clusterKey: eventKey(item.title),
      title: String(item.title).trim(),
      categoryId: item.category || "news",
      categoryLabel: categoryLabel(item.category || "news"),
      sourceId: item.source || "unknown",
      sourceLabel: item.sourceLabel || (entry && (entry.labelKo || entry.label)) || item.source || "unknown",
      sourceRole: sourceRole(entry, item),
      ownershipGroup: owner.ownershipGroup,
      ownershipBasis: owner.ownershipBasis,
      syndicationGroup: (entry && entry.syndicationGroup) || null,
      marketPolicyDesk: (entry && entry.marketPolicyDesk) || null,
      country: (entry && entry.country) || null,
      lang: item.originalLang || item.lang || (entry && entry.lang) || null,
      publishedAt: item.publishedAt || null,
      firstSeenAt: Number.isFinite(item.firstSeenAt) ? item.firstSeenAt : null,
      carryover: item.editorialCarryover ? { ...item.editorialCarryover } : null,
      signals: {
        score: finite(item.score),
        comments: finite(item.commentCount),
        coverage: finite(item.coverage),
        sourceRank: Number.isFinite(item.sourceRank) ? item.sourceRank : null,
        heatPoints: Array.isArray(item.heatHist) ? item.heatHist.length : 0
      },
      observedAt
    }));

  const roleKnown = candidates.filter((row) => row.sourceRole !== "unknown").length;
  const ownershipExplicit = candidates.filter((row) => row.ownershipBasis === "registry_explicit").length;
  const desksAssigned = candidates.filter((row) => row.marketPolicyDesk).length;
  const categoryCandidateCounts = Object.fromEntries(
    [...new Set(candidates.map((row) => row.categoryId))]
      .map((category) => [category, candidates.filter((row) => row.categoryId === category).length])
  );
  const carryoverCandidates = candidates.filter((row) => row.carryover);
  const carryoverCategoryCounts = Object.fromEntries(
    [...new Set(carryoverCandidates.map((row) => row.categoryId))]
      .map((category) => [category, carryoverCandidates.filter((row) => row.categoryId === category).length])
  );
  const metrics = {
    inputCount: Array.isArray(items) ? items.length : 0,
    eligibleCount: eligible.length,
    candidateCount: candidates.length,
    candidateCap: max,
    capReached: candidates.length === max,
    truncated: candidates.length < eligible.length,
    sourceCap,
    categoryFloor,
    koreanAudiencePreference: Boolean(preferKoreanAudience),
    uniqueSourceCount: new Set(candidates.map((row) => row.sourceId)).size,
    uniqueOwnershipGroupCount: new Set(candidates.map((row) => row.ownershipGroup)).size,
    categoryCount: new Set(candidates.map((row) => row.categoryId)).size,
    categoryCandidateCounts,
    carryoverCandidateCount: carryoverCandidates.length,
    carryoverCategoryCounts,
    selectedCategoryCoveragePct: selected.size
      ? Math.round([...selected].filter((category) => categoryCandidateCounts[category]).length / selected.size * 100)
      : null,
    sourceRoleCoveragePct: candidates.length ? Math.round(roleKnown / candidates.length * 100) : 0,
    explicitOwnershipCoveragePct: candidates.length ? Math.round(ownershipExplicit / candidates.length * 100) : 0,
    marketPolicyDeskCoveragePct: candidates.length ? Math.round(desksAssigned / candidates.length * 100) : 0,
    dropped
  };
  const limits = [
    "사람 두 명의 블라인드 포함·제외 및 클러스터 정답 표기는 아직 없다.",
    "ownershipGroup의 fallback은 법적 소유관계가 아니라 중복 독립 출처 계산용 운영 그룹이다."
  ];
  if (selected.size && metrics.selectedCategoryCoveragePct < 100) {
    limits.push("선택한 일부 카테고리는 현재 유효 공급이 없어 후보에 포함되지 않았다.");
  }
  if (metrics.marketPolicyDeskCoveragePct < 100) limits.push("시장·정책 데스크 메타데이터는 일부 또는 전부 비어 있다.");

  return {
    stableId: `${EDITION_CANDIDATE_CONTRACT.stableId}-FIXTURE`,
    contractId: EDITION_CANDIDATE_CONTRACT.stableId,
    state: candidates.length ? "machine_observation_ready" : "insufficient_input",
    label: `${candidates.length} MACHINE OBSERVATION`,
    observedAt,
    selectedCategories: [...selected],
    metrics,
    limits,
    candidates
  };
}

export function candidateFixtureReceipt(fixture, { sampleSize = 0 } = {}) {
  if (!fixture) return null;
  const { candidates, ...receipt } = fixture;
  const size = Math.max(0, Math.min(20, Math.floor(Number(sampleSize) || 0)));
  return size ? { ...receipt, sample: (candidates || []).slice(0, size) } : receipt;
}
