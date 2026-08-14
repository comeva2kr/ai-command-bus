// P3-A shadow 선별 계층 — 현행 서빙·편성 경로와 완전히 분리된 병렬 계산.
//
// **절대 계약(David 조건부 승인, 2026-08-13):** 이 파일은 digest.js의 현행
// 점수·편성, edition-candidates, 서버 응답 어디에도 관여하지 않는다. 옆에서
// 따로 계산해 비교 산출물만 만든다. 실제 판 전환은 shadow 대조 통과 후
// David의 별도 게이트를 거친다.
//
// 정본: 블루프린트 01 "2026-08-13 정책 팩별 판 자격(eligibility) 계약"
// (5팩 테이블 + 공통 원칙 6개). 자격 게이트는 전 분야 공통 규칙이 아니다 —
// 팩별 계약대로 판정한다(정정 1).
//
// ── 파이프라인 (사건 클러스터 단위 — P1-B event-cluster 재사용)
//   기사 → buildEventClusters → 팩 소속 판정 → 팩별 자격 게이트 →
//   통과분만 S = w_h·heat + w_i·importance + w_c·change 정렬 →
//   동적 분량(8~12, 95% 동급일 때만 14까지) → shadow 판 + 감사 근거.
//
// ── 초기값의 위치 (한 곳 원칙)
//   가중·임계·창·미결 3건의 기본값은 전부 아래 SHADOW_PACK_PARAMS 한 테이블에
//   있다. 3일 관찰로 조정될 값이라 하드코딩 산재 금지 — David 답이 오면
//   overrideShadowParams()로 즉시 바꾼다.
import { buildEventClusters, carryEventLineages, markLineageServed } from "./event-cluster.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";
import {
  heatAxis, importanceAxis, changeAxis, trustMaterials, engagementOf
} from "./selection-axes.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const SHADOW_SELECTION_CONTRACT = deepFreeze({
  stableId: "NOWHOT-SHADOW-SELECTION-CONTRACT-001",
  version: 1,
  mode: "shadow_only",
  servingPathTouched: false,
  blueprintSection: "docs/01_NOWHOT_SYSTEM_BLUEPRINT.md — 2026-08-13 정책 팩별 판 자격(eligibility) 계약",
  commonPrinciples: [
    "1. verified 분리: reported_secondary 1건 단독은 어느 팩에서도 신뢰 자격 없음",
    "2. 뉴스 기본 계약: primary·first_party 1곳 ∨ 독립 operatorGroup 2곳",
    "3. 같은 운영그룹 분야별 피드는 독립 계수 1회(event-cluster C4 재사용)",
    "4. 소스캡 자동 완화 금지 — 부족하면 부분 제공(부분판)",
    "5. 재등장 게이트: factsFingerprint 실질 변화 없으면 제외",
    "6. 품질 게이트(editorial-quality)는 전 팩 공통 선행 — 이 계층의 선행 조건(호출부 책임)"
  ]
});

// ---------------------------------------------------------------------------
// 팩 파라미터 테이블 — 모든 초기값의 유일한 위치
// ---------------------------------------------------------------------------
//
// 수치의 출처:
//  - 팩 가중(newsy 0.2/0.5/0.3, 과학 0.15/0.35/0.5, 커뮤 0.6/0.1/0.3)·신선도
//    창(12h/24~48h/24h/6h/24h)·eng≥30: P3 설계안 초기값(블루프린트 eligibility
//    계약 + 미결 3건 추천안). 3일 관찰 후 조정 대상.
//  - sports·culture의 축 가중은 설계안에 명시가 없어 newsy 준용을 초기값으로
//    둔다(weightsBasis에 명시 — David 확인 대상).
//  - heatSaturationEng 100000: digest.js 실측 주석의 반응 스케일 상단(더쿠
//    추천 16만 관측)을 자릿수로 내림한 포화점. 관찰 조정 대상.
//  - importanceGroupSaturation 5: digest.js coveragePoints의 min(5,·) 재사용.
//  - importanceComponents 0.5/0.3/0.2: 실측이 아닌 초기 설계값(독립 계수를
//    절반 비중으로, weighty·primary 순) — 관찰 조정 대상임을 명시한다.
//  - freshnessStair [1,0.75,0.5,0.25]: 창 4등분 계단 초기값 — 관찰 조정 대상.
export const SHADOW_PACK_PARAMS = deepFreeze({
  axis: {
    heatSaturationEng: 100000,
    importanceGroupSaturation: 5,
    importanceComponents: { groups: 0.5, weighty: 0.3, primary: 0.2 },
    freshnessStair: [1, 0.75, 0.5, 0.25],
    // digest.js:175 EDITORIAL_WEIGHTY(=interest.js WEIGHTY + realestate·science)와 동일 집합.
    weightyCategories: ["business", "news", "politics", "tech", "realestate", "science"]
  },
  // 동적 분량 계약(v4 정정 2): 게이트 통과 기준 8~12, 13~14위가 12위 S의
  // 95% 이상일 때만 14까지. 미달이면 그대로 = 부분판. 캡 자동 완화 금지.
  volume: { min: 8, target: 12, max: 14, extensionRatio: 0.95 },
  packs: {
    newsy: {
      label: "경제·정치",
      categories: ["business", "politics", "realestate", "news"],
      // 미결 2 추천안: tech·auto 보도형은 경제·정치 잣대 준용.
      appliedCategories: ["tech", "auto"],
      weights: { heat: 0.2, importance: 0.5, change: 0.3 },
      weightsBasis: "P3 설계안 초기값",
      windowHours: 12,
      morningWindowHours: 24,
      trustGate: "news_basic",
      sourceCap: { per: "operatorGroup", max: 2 }
    },
    science: {
      label: "과학",
      categories: ["science"],
      appliedCategories: [],
      weights: { heat: 0.15, importance: 0.35, change: 0.5 },
      weightsBasis: "P3 설계안 초기값",
      // 논문·보도 리듬 24~48h — 자격 창은 상한 48h, 계단은 같은 창으로 계산.
      windowHours: 48,
      windowHoursMin: 24,
      trustGate: "news_basic", // 기관 primary(NASA 등) 1곳이 유효한 단독 통과 경로(뉴스 기본 계약에 포함)
      sourceCap: { per: "operatorGroup", max: 3 }
    },
    sports: {
      label: "스포츠",
      categories: ["sports"],
      appliedCategories: [],
      weights: { heat: 0.2, importance: 0.5, change: 0.3 },
      weightsBasis: "미지정 — newsy 준용 초기값(David 확인 대상)",
      windowHours: 24,
      trustGate: "news_basic",
      // 미결 1 추천안: v1 예외 없음(부분판 허용) — shadow 실측 후 결정.
      soloOfficialResultException: false,
      sourceCap: { per: "operatorGroup", max: 2 }
    },
    community: {
      label: "유머·커뮤니티",
      categories: ["humor", "life"],
      appliedCategories: [],
      includesKindCommunity: true, // kind=community 전체가 이 팩 잣대
      weights: { heat: 0.6, importance: 0.1, change: 0.3 },
      weightsBasis: "P3 설계안 초기값",
      windowHours: 6, // 당일성(미결 3 — 관찰 후 고정)
      trustGate: "community_absolute_eng",
      engMin: 30, // 미결 3 추천안 초기값
      pressTrustLabel: false, // 언론 신뢰 라벨 미부착
      sourceCap: { per: "source", max: 2 }
    },
    culture: {
      label: "문화·예술·패션",
      // 미결 2 추천안: gaming→문화 팩.
      categories: ["culture", "fashion", "art", "gaming"],
      appliedCategories: [],
      weights: { heat: 0.2, importance: 0.5, change: 0.3 },
      weightsBasis: "미지정 — newsy 준용 초기값(David 확인 대상)",
      windowHours: 24,
      trustGate: "news_basic_or_specialist", // 보도형은 뉴스 기본 계약, 전문 섹션은 specialist 선언 존중
      sourceCap: { per: "operatorGroup", max: 2 }
    }
  },
  // 미결 3건(David 확인 대기)과 이 테이블에서 그 답이 바꿀 파라미터 위치.
  openDecisions: {
    "1_sports_solo_official_result": "packs.sports.soloOfficialResultException (현재 false = 예외 없음·부분판 허용)",
    "2_category_pack_assignment": "packs.newsy.appliedCategories(tech·auto) / packs.culture.categories(gaming) / packs.community.categories(life)",
    "3_community_eng_and_windows": "packs.community.engMin(30)·packs.community.windowHours(6) 등 각 팩 windowHours"
  }
});

// David 답·관찰 결과에 따른 즉시 조정용 — 깊은 병합 후 동결한 사본을 돌려준다.
// 원본 테이블은 불변(감사 가능한 기준선 유지).
export function overrideShadowParams(overrides = {}, base = SHADOW_PACK_PARAMS) {
  const merge = (target, patch) => {
    const out = Array.isArray(target) ? [...target] : { ...target };
    for (const [key, value] of Object.entries(patch || {})) {
      out[key] = value && typeof value === "object" && !Array.isArray(value)
        && target && typeof target[key] === "object" && !Array.isArray(target[key])
        ? merge(target[key], value)
        : value;
    }
    return out;
  };
  return deepFreeze(merge(base, overrides));
}

// ---------------------------------------------------------------------------
// 팩 소속 판정
// ---------------------------------------------------------------------------

function categoryPackIndex(params) {
  const index = new Map();
  for (const [packId, pack] of Object.entries(params.packs)) {
    for (const category of [...pack.categories, ...(pack.appliedCategories || [])]) {
      index.set(category, packId);
    }
  }
  return index;
}

// 커뮤글은 카테고리와 무관하게 커뮤 팩 잣대(팩 테이블: humor·life + kind=community 전체).
export function packIdForArticle(article, params = SHADOW_PACK_PARAMS) {
  if (!article) return null;
  if (article.kind === "community" && params.packs.community
    && params.packs.community.includesKindCommunity) return "community";
  return categoryPackIndex(params).get(article.category || "news") || null;
}

// R1 — 사건의 분야(팩) 귀속 규칙(블루프린트 "2026-08-14 P3-A 판정" 결함 2).
//
// 전체 풀 클러스터링이 선행되므로 한 사건이 여러 카테고리의 기사로 구성될 수
// 있다(스포츠 매체 + 종합뉴스). 귀속은 **구성원(보도) 기사들의 카테고리 분포
// 기반 복수 귀속**이다: 구성원 기사 하나라도 그 팩에 속하면 사건은 그 팩의
// 판 후보다. 대표 1팩·다수결이 아니라 복수 귀속을 택한 이유 — 사건 클러스터
// 계약이 categoryIds 복수를 허용하고, 단일 귀속은 소수 카테고리 판(스포츠 등)
// 에서 사건을 다시 잃는다(결함 2의 재발). 판 간 중복(같은 사건이 두 팩 판에
// 모두 선택)은 R2의 합집합·중복 제거 단계에서 처리 예정이다.
// 반응(community_reaction) 기사는 귀속에 계수하지 않는다 — 구성원만 본다.
export function packIdsForEvent(memberArticles, params = SHADOW_PACK_PARAMS) {
  const ids = new Set();
  for (const article of memberArticles || []) {
    const packId = packIdForArticle(article, params);
    if (packId) ids.add(packId);
  }
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// sourceRole 판정 — edition-candidates.js:35 sourceRole()과 같은 규칙
// (그 함수는 비공개 export라 규칙을 옮겨 적는다 — 현행 파일 무수정 경계).
// ---------------------------------------------------------------------------

const KNOWN_ROLES = new Set(["primary", "reported_secondary", "community_signal", "first_party", "unknown"]);

export function resolveSourceRole(article, registryEntry = null) {
  const declared = article && article.editorialCandidate && article.editorialCandidate.sourceRole;
  if (KNOWN_ROLES.has(declared)) return declared;
  if (registryEntry && KNOWN_ROLES.has(registryEntry.sourceRole)) return registryEntry.sourceRole;
  if ((article && (article.via === "me" || article.via === "ourdeal"))
    || (registryEntry && registryEntry.adapter && registryEntry.adapter.type === "store")) return "first_party";
  if ((article && article.kind === "community") || (registryEntry && registryEntry.kind === "community")) return "community_signal";
  if ((article && article.kind === "news") || (registryEntry && registryEntry.kind === "news")) return "reported_secondary";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 팩별 자격 게이트
// ---------------------------------------------------------------------------

const parseTime = (value) => {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
};

const freshestMemberAt = (memberArticles) => {
  let best = null;
  for (const article of memberArticles) {
    const t = parseTime(article && article.publishedAt);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best;
};

function specialistDeclared(memberArticles, pack, registryById) {
  if (!registryById || !memberArticles.length) return false;
  const packCategories = new Set([...pack.categories, ...(pack.appliedCategories || [])]);
  return memberArticles.every((article) => {
    const entry = registryById.get(article && article.source);
    return entry && entry.sourceTier === "specialist" && packCategories.has(entry.category);
  });
}

// 사건 하나의 팩 자격 판정. 반환: { pass, failures[], passedBy, trust, window }.
export function shadowEligibility(view, pack, {
  now,
  slotId = null,
  registryById = null,
  previousFingerprint = null,
  officialResult = false,
  roleOf
} = {}) {
  const failures = [];
  let passedBy = null;

  // 창: 팩 신선도 창(모닝 슬롯이면 팩의 morningWindowHours가 있을 때 그 값).
  const windowHours = slotId === "morning" && Number.isFinite(pack.morningWindowHours)
    ? pack.morningWindowHours : pack.windowHours;
  const freshest = freshestMemberAt(view.memberArticles);
  let ageHours = freshest === null ? null : (now - freshest) / 3600000;
  // 미래 발행시각(불량 피드·시계 오차)이 영원히 창 안에 머무는 구멍 방지:
  // 1시간 이내 미래는 시계 오차로 보고 0으로 클램프, 그 밖의 미래는 무효.
  if (ageHours !== null && ageHours < 0) {
    if (ageHours >= -1) ageHours = 0;
    else {
      ageHours = null;
      failures.push("freshness_invalid_future_published_at");
    }
  }
  if (ageHours === null || ageHours > windowHours) {
    if (!failures.includes("freshness_invalid_future_published_at")) {
      failures.push(`freshness_window_${windowHours}h`);
    }
  }

  // trust — 팩별 계약. 축 재료는 trustMaterials가 관측만 제공한다.
  const trust = trustMaterials(view, { roleOf });
  if (pack.trustGate === "community_absolute_eng") {
    // 언론 계수 무의미(실측: 커뮤 다중 구성 사건 0건) — 절대 반응선만 본다.
    // 커뮤 팩의 구성원은 커뮤글 자체라 communityEng가 곧 사건 반응량이다.
    const eng = trust.communityEng;
    if (eng >= pack.engMin) passedBy = `community_eng>=${pack.engMin}`;
    else failures.push(`community_eng_below_absolute_line(${eng}<${pack.engMin})`);
  } else {
    // 뉴스 기본 계약: primary·first_party 1곳 ∨ 독립 operatorGroup 2곳.
    if (trust.hasPrimaryOrFirstParty) passedBy = "primary_or_first_party";
    else if (trust.independentReportingGroups >= 2) passedBy = "independent_groups>=2";
    else if (pack.trustGate === "news_basic_or_specialist"
      && specialistDeclared(view.memberArticles, pack, registryById)) {
      passedBy = "specialist_declared";
    } else if (pack.trustGate === "news_basic" && pack.soloOfficialResultException && officialResult) {
      // 미결 1 파라미터가 true로 바뀔 때만 열리는 경로. 초기값 false.
      passedBy = "solo_official_result_exception";
    } else {
      failures.push(trust.roleCounts.reported_secondary
        ? "trust_reported_secondary_alone"
        : "trust_no_qualified_evidence");
    }
  }

  // 재등장 게이트(공통 원칙 5): 직전 판 동일 사건은 지문 변화 없으면 제외.
  if (previousFingerprint && view.event && previousFingerprint === view.event.factsFingerprint) {
    failures.push("reappear_no_material_change");
  }

  return {
    pass: failures.length === 0,
    passedBy: failures.length === 0 ? passedBy : null,
    failures,
    trust,
    windowHours,
    ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100
  };
}

// ---------------------------------------------------------------------------
// 점수 S = w_h·heat + w_i·importance + w_c·change
// ---------------------------------------------------------------------------

export function shadowScore(view, pack, { now, params = SHADOW_PACK_PARAMS, previousFingerprint = null, roleOf } = {}) {
  const axis = params.axis;
  const heat = heatAxis(view, { saturationEng: axis.heatSaturationEng });
  const importance = importanceAxis(view, {
    groupSaturation: axis.importanceGroupSaturation,
    weightyCategories: axis.weightyCategories,
    componentWeights: axis.importanceComponents,
    roleOf
  });
  const windowHours = pack.windowHours;
  const change = changeAxis(view, {
    now, windowHours, stair: axis.freshnessStair, previousFingerprint
  });
  const w = pack.weights;
  const S = w.heat * heat.value + w.importance * importance.value + w.change * change.value;
  return { S: Math.round(S * 10000) / 10000, weights: { ...w }, axes: { heat, importance, change } };
}

// ---------------------------------------------------------------------------
// shadow 판 구성 — 게이트 → S 정렬 → 소스캡 → 동적 분량
// ---------------------------------------------------------------------------

const capKeyOf = (view, pack) => {
  const rep = view.memberArticles[0] || view.reactionArticles[0] || null;
  if (!rep) return "unknown";
  return pack.sourceCap.per === "source"
    ? String(rep.source || "unknown")
    : operationalSourceIdentity(rep).ownershipGroup;
};

// articles: 원시 기사 배열(품질 게이트 등 선행 필터는 호출부 책임 — 공통 원칙 6).
// 반환은 계산·비교용 산출물이다. 서빙에 쓰지 않는다.
export function shadowSelectEdition(articles, {
  packId,
  now = Date.now(),
  slotId = null,
  registry = [],
  params = SHADOW_PACK_PARAMS,
  previousEditionFingerprints = new Map(),
  // R1 — 영구 사건 계보. 이전 판 shadowSelectEdition 반환의 lineage.records를
  // 그대로 넘기면 재등장 게이트가 eventId가 아니라 **계보** 기준으로 판정된다
  // (이른 기사 지연 합류로 eventId가 바뀌어도 같은 사건으로 이어진다 — 결함 4).
  // null이면 구 eventId 키 맵(previousEditionFingerprints)으로 폴백한다.
  previousLineage = null,
  officialResultEventIds = new Set()
} = {}) {
  const pack = params.packs[packId];
  if (!pack) throw new Error(`shadowSelectEdition: 알 수 없는 팩 ${packId}`);
  const registryById = new Map((registry || []).filter(Boolean).map((entry) => [entry.id, entry]));
  const roleOf = (article) => resolveSourceRole(article, registryById.get(article && article.source));

  // R1 클러스터링 순서 교정(블루프린트 "2026-08-14 P3-A 판정" 결함 2):
  // 팩으로 기사를 자른 뒤 사건을 묶던 구조를 폐기하고, **전체 풀(전 카테고리·
  // 전 kind)에서 먼저 사건을 묶는다.** 그 다음 사건을 팩으로 라우팅한다.
  // 기존 구조에서는 같은 사건의 스포츠 매체 1곳+종합뉴스 1곳이 각 팩에서
  // '단일 출처'로 탈락했다(반례 a). 커뮤 반응은 클러스터링이 사건에 자동으로
  // 붙인다(evidenceRole=community_reaction — heat 축에만 계수, 정정 3).
  const rows = (articles || []).filter(Boolean);
  const base = rows.filter((article) => packIdForArticle(article, params) === packId);
  const events = buildEventClusters(rows);

  // R1 영구 계보 — 전체 사건 대상(팩 라우팅 전). 판 사이 승계는 전 사건
  // 공통이어야 하므로 팩별로 자르기 전에 계산한다.
  const lineage = carryEventLineages(previousLineage || [], events);
  const prevFingerprintOf = (event) => {
    if (previousLineage !== null) {
      // 검수 P1 수리: 재등장 게이트는 직전 판에 **서빙(선택)된** 사건의 지문만
      // 본다. 관찰만 된 사건(미선택·게이트 탈락)의 지문으로 차단하면 직전 판에
      // 나간 적도 없는 사건이 전부 재탕 판정된다(실측 450/450 차단).
      const assigned = lineage.assignments.get(event.eventId);
      return assigned && assigned.inherited ? assigned.previousServedFingerprint : null;
    }
    return previousEditionFingerprints.get(event.eventId) || null;
  };

  const byId = new Map(rows.map((article) => [article.id, article]));
  const views = [];
  for (const event of events) {
    const memberArticles = event.memberArticleIds.map((id) => byId.get(id)).filter(Boolean);
    // 사건의 팩 귀속 — 구성원 카테고리 분포 기반 복수 귀속(packIdsForEvent 주석).
    const packIds = packIdsForEvent(memberArticles, params);
    if (!packIds.includes(packId)) continue;
    const reactionArticles = event.reactionArticleIds.map((id) => byId.get(id)).filter(Boolean);
    views.push({
      event, memberArticles, reactionArticles,
      packIds, // 복수 귀속 — 판 간 중복 제거는 R2 합집합 단계 예정
      categoryIds: [...new Set(memberArticles.map((article) => article.category || "news"))].sort(),
      lineage: lineage.assignments.get(event.eventId) || null
    });
  }

  // 1) 팩별 자격 게이트
  const gatePassed = [];
  const gateFailed = [];
  for (const view of views) {
    const gate = shadowEligibility(view, pack, {
      now, slotId, registryById,
      previousFingerprint: prevFingerprintOf(view.event),
      officialResult: officialResultEventIds.has(view.event.eventId),
      roleOf
    });
    if (gate.pass) gatePassed.push({ view, gate });
    else gateFailed.push({ view, gate });
  }

  // 2) S 정렬(결정적 — 동점은 eventId)
  const scored = gatePassed.map((row) => ({
    ...row,
    score: shadowScore(row.view, pack, {
      now, params,
      previousFingerprint: prevFingerprintOf(row.view.event),
      roleOf
    })
  })).sort((a, b) => b.score.S - a.score.S
    || String(a.view.event.eventId).localeCompare(String(b.view.event.eventId)));

  // 3) 소스캡 — 자동 완화 금지(공통 원칙 4). 캡에 걸린 사건은 제외로 남긴다.
  const capCounts = new Map();
  const capped = [];
  const capExcluded = [];
  for (const row of scored) {
    const key = capKeyOf(row.view, pack);
    if ((capCounts.get(key) || 0) >= pack.sourceCap.max) {
      capExcluded.push({ ...row, exclusion: `source_cap_${pack.sourceCap.per}:${key}` });
      continue;
    }
    capCounts.set(key, (capCounts.get(key) || 0) + 1);
    capped.push(row);
  }

  // 4) 동적 분량: 기본 상한 target(12). 13·14위는 12위 S의 extensionRatio(95%)
  //    이상일 때만 이어서 확장(13이 미달이면 14는 보지 않는다). 통과분이
  //    min(8) 미만이면 그대로 부분판 — 무관한 글로 채우지 않는다.
  const volume = params.volume;
  let cut = Math.min(volume.target, capped.length);
  if (capped.length > volume.target && cut === volume.target) {
    const anchorS = capped[volume.target - 1].score.S;
    for (let index = volume.target; index < Math.min(volume.max, capped.length); index += 1) {
      if (capped[index].score.S >= volume.extensionRatio * anchorS) cut = index + 1;
      else break;
    }
  }
  const selected = capped.slice(0, cut);
  const belowVolume = capped.slice(cut).map((row) => ({ ...row, exclusion: "below_dynamic_volume" }));
  const partialEdition = selected.length < volume.min;

  return {
    contract: SHADOW_SELECTION_CONTRACT.stableId,
    packId,
    packLabel: pack.label,
    slotId,
    now,
    params: { pack, volume: { ...volume }, axis: { ...params.axis } },
    counts: {
      inputArticles: rows.length,
      packArticles: base.length,
      events: views.length,
      gatePassed: gatePassed.length,
      gateFailed: gateFailed.length,
      capExcluded: capExcluded.length,
      selected: selected.length
    },
    partialEdition,
    selected,
    excluded: {
      gate: gateFailed,
      sourceCap: capExcluded,
      belowVolume
    },
    // R1 — 다음 판에 previousLineage로 그대로 넘길 계보 레코드(전 사건 대상,
    // 이번 판에 안 나타난 이전 계보 포함). R4(이전 판 상태 연속 관찰)의 재료.
    // 이번 판에 실제 선택(서빙)된 사건에만 서빙 지문을 찍는다 — 재등장 게이트는
    // 이 서빙 지문만 보므로, 미선택 사건은 다음 판에서 차단되지 않는다.
    lineage: {
      records: markLineageServed(lineage.records,
        new Set(selected.map((entry) => entry.view.event.eventId)))
    }
  };
}

export { engagementOf };
