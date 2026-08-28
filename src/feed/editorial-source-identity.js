import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const EDITORIAL_SOURCE_IDENTITY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-EDITORIAL-SOURCE-IDENTITY-CONTRACT-001",
  version: 2,
  decisionUnit: "operational_publisher_group",
  rawFeedRule: "원시 피드 관측 수는 진단값으로 보존한다.",
  scoringRule: "교차관측 표시와 가산점은 서로 다른 운영그룹 수로만 결정한다.",
  legalBoundary: "운영그룹은 중복 방지용 식별값이며 법적 소유관계나 편집 독립성의 증명이 아니다."
});

const identityToken = (value) => clean(value)
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/^www\./, "")
  .replace(/\.(?:com|co\.kr|kr|net|org)$/i, "")
  .replace(/[^a-z0-9가-힣]+/g, "");

const aliasRows = {
  hankyoreh: ["한겨레", "한겨레 뉴스랭킹", "hani", "hani-rank", "hankyoreh"],
  maekyung: ["매일경제", "매경", "매경 뉴스", "매경 증권", "매경 부동산", "mk", "mk-news", "mk-stock", "mk-realestate"],
  hankyung: ["한국경제", "한경", "한경 증권", "한경 부동산", "hankyung", "hankyung-stock", "hankyung-realestate"],
  chosun: ["조선일보", "조선비즈", "조선비즈 증권", "조선비즈 부동산", "chosun", "chosunbiz", "chosunbiz-stock", "chosunbiz-realestate"],
  khan: ["경향", "경향신문", "khan"],
  donga: ["동아", "동아일보", "donga", "donga.com"],
  yonhap: ["연합", "연합뉴스", "yna"],
  etnews: ["전자신문", "etnews"],
  etoday: ["이투데이", "etoday"],
  herald: ["헤럴드경제", "heraldbiz"],
  moneytoday: ["머니투데이", "mt"],
  kbs: ["KBS", "KBS 뉴스", "KBS뉴스", "kbs", "kbs-news"],
  ppomppu: ["뽐뿌", "뽐뿌 부동산", "ppomppu", "ppomppu-house"],
  hypebeast: ["하입비스트", "hypebeast", "hypebeast.com"]
};

// 한 벌 원칙(블루프린트 v4 정정 6): 운영그룹·중계 관계의 정본은 communities.json의
// `operatorGroup`/`aliasOf` 선택 속성이다. 여기서 읽어 위 하드코딩 aliasRows와
// 병합하되 **json이 우선**하고, json을 못 읽거나 항목이 없으면 하드코딩이 폴백으로
// 남는다(오프라인·부분 레지스트리에서도 기존 동작 무변경).
function loadRegistryIdentityRows() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "communities.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const communities = Array.isArray(raw && raw.communities) ? raw.communities : [];
    const byId = new Map(communities.map((c) => [clean(c && c.id), c]));
    const rows = [];
    for (const c of communities) {
      if (!c || typeof c !== "object") continue;
      // aliasOf(중계·재유통: geeknews→hackernews)는 대상 소스의 운영그룹으로
      // 귀속시킨다 — 대상에 operatorGroup이 있으면 그 그룹, 없으면 대상 id.
      const target = clean(c.aliasOf) ? byId.get(clean(c.aliasOf)) : null;
      const group = clean(
        (target && (target.operatorGroup || target.id)) || c.operatorGroup
      );
      if (!group) continue;
      for (const key of [c.id, c.label, c.labelKo, ...(Array.isArray(c.aliases) ? c.aliases : [])]) {
        const token = identityToken(key);
        if (token) rows.push([token, group]);
      }
    }
    return rows;
  } catch {
    return [];
  }
}

const FAMILY_BY_TOKEN = new Map([
  // 하드코딩 폴백을 먼저 깔고, json 파생 행으로 덮어쓴다(json 우선).
  ...Object.entries(aliasRows).flatMap(([group, values]) => values.map((value) => [identityToken(value), group])),
  ...loadRegistryIdentityRows()
]);

const isGoogleNewsSource = (sourceId) => /^gnews(?:-|$)/i.test(clean(sourceId));
const isGenericGoogleLabel = (label) => /^구글뉴스(?:\s|$)/.test(clean(label)) || /^google\s*news/i.test(clean(label));

function rowMeta(row) {
  return row && row.editorialCandidate && typeof row.editorialCandidate === "object"
    ? row.editorialCandidate
    : {};
}

// This is an operational de-duplication identity, not a claim about legal
// ownership or newsroom independence. Known aliases only collapse labels that
// the current source registry already treats as one publisher family.
export function operationalSourceIdentity(row, { registryEntry = null } = {}) {
  const meta = rowMeta(row);
  const sourceId = clean(meta.sourceId || row && row.source || registryEntry && registryEntry.id || "unknown");
  const label = clean(meta.sourceLabel || row && row.sourceLabel
    || registryEntry && (registryEntry.labelKo || registryEntry.label) || sourceId);
  const explicitGroup = clean(
    registryEntry && registryEntry.ownershipGroup
    || meta.ownershipBasis === "registry_explicit" && meta.ownershipGroup
    || row && row.ownershipBasis === "registry_explicit" && row.ownershipGroup
  );
  if (explicitGroup) {
    return {
      sourceId,
      label,
      ownershipGroup: FAMILY_BY_TOKEN.get(identityToken(explicitGroup)) || explicitGroup,
      ownershipBasis: "registry_explicit"
    };
  }

  const alias = FAMILY_BY_TOKEN.get(identityToken(label)) || FAMILY_BY_TOKEN.get(identityToken(sourceId));
  if (alias) {
    return { sourceId, label, ownershipGroup: alias, ownershipBasis: "publisher_alias_operational" };
  }

  if (isGoogleNewsSource(sourceId) && !isGenericGoogleLabel(label) && identityToken(label)) {
    return {
      sourceId,
      label,
      ownershipGroup: `publisher:${identityToken(label)}`,
      ownershipBasis: "publisher_label_operational"
    };
  }

  const declaredGroup = clean(meta.ownershipGroup || row && row.ownershipGroup);
  if (declaredGroup && declaredGroup !== "gnews") {
    return {
      sourceId,
      label,
      ownershipGroup: FAMILY_BY_TOKEN.get(identityToken(declaredGroup)) || declaredGroup,
      ownershipBasis: clean(meta.ownershipBasis || row && row.ownershipBasis) || "declared_operational"
    };
  }

  const feedGroup = clean(registryEntry && registryEntry.feedGroup || row && row.feedGroup);
  if (feedGroup && feedGroup !== "gnews") {
    return { sourceId, label, ownershipGroup: feedGroup, ownershipBasis: "feed_group_operational" };
  }

  if (isGoogleNewsSource(sourceId)) {
    return { sourceId, label, ownershipGroup: "gnews", ownershipBasis: "aggregator_transport_fallback" };
  }

  const labelToken = identityToken(label);
  const sourceToken = identityToken(sourceId);
  if (labelToken && labelToken !== sourceToken) {
    return {
      sourceId,
      label,
      ownershipGroup: `publisher:${labelToken}`,
      ownershipBasis: "publisher_label_operational"
    };
  }

  return { sourceId, label, ownershipGroup: sourceId || "unknown", ownershipBasis: "source_id_fallback" };
}

export function sameOperationalSourceGroup(left, right) {
  return operationalSourceIdentity(left).ownershipGroup === operationalSourceIdentity(right).ownershipGroup;
}
