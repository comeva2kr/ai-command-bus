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
// R3 품질 게이트 배선(블루프린트 "2026-08-14 P3-A 판정" 결함 3) — 현행 판정
// 함수를 그대로 재사용한다(재발명 금지). 어디서 온 규칙인지: engine.js의
// 대표 지면 풀 필터(briefing 2180-2192·categoryTop 2273-2284·판 후보
// eligiblePool 2441-2452)가 쓰는 promotable()의 구성 요소와, digest 앵커가
// 피하는 딜 판정이다.
import { lowValueReason, unpromotableReason } from "./promotion.js"; // promotion.js:100·91
import { hasProfanity } from "./profanity.js";                       // promotable(promotion.js:129)의 첫 검사
import { isDeal } from "./deals.js";                                 // deals.js:34 — 가격·쇼핑몰 형식 광고 판정

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
    "6. 품질 게이트는 전 팩 공통 선행 — R3에서 실제 배선(옵션 qualityGate 기본 ON, 탈락은 excluded.quality에 사유와 함께 기록). 판정은 현행 코드 재사용: promotion.js lowValueReason·unpromotableReason, profanity.js hasProfanity, deals.js isDeal"
  ]
});

// ---------------------------------------------------------------------------
// R3 — 품질 게이트(결함 3): 광고성·저품질 글이 커뮤 절대선(eng)을 통과해
// 표본 수치를 오염시키는 경로의 선행 차단. **판정 규칙은 전부 현행 코드
// 재사용이다** — 여기서 새 패턴을 발명하지 않는다(오탐 하나가 진짜 화제를
// 죽인다는 promotion.js의 원칙을 그대로 존중).
//
// 재사용한 판정(파일:줄):
//  - engine.js 대표 지면 풀 필터의 구조 규칙(kind ad/affiliate·source seed/me·
//    offMain 제외 — engine.js:2185-2192, 2278-2284, 2444-2451)
//  - promotable() 분해(promotion.js:129): hasProfanity(profanity.js) →
//    unpromotableReason(promotion.js:91) → lowValueReason(promotion.js:100).
//    분해해 쓰는 이유: 탈락 사유를 감사 가능하게 남기기 위해서다(promotable은
//    boolean만 돌려준다).
//  - isDeal(deals.js:34): 가격·쇼핑몰 형식 상품 광고 판정의 현행 정본.
//    피드에서 딜은 삭제가 아니라 지분 규칙(capDeals·DEAL_MAX_SHARE)으로 따로
//    관리되는 상품 광고다 — "오늘의 대표" 판 후보에는 넣지 않는다(engine.js
//    getFeed의 딜 칸 분리·1785 avoid와 같은 취지).
//
// **알려진 구멍(정직 기록):** etoland 공인인증점류 "하루특가) ..." 광고는 위
// 어느 판정에도 걸리지 않는다 — lowValueReason의 "가격형 특가 광고" 패턴이
// 제목 첫머리 "특가"만 보고, isDeal은 가격 표기를 요구해서다. 수리는
// promotion.js(현행 코드) 사전 보강이 필요하므로 이 계층의 범위 밖이고,
// David 게이트 대상으로 보고한다. 동결 테스트가 이 구멍을 그대로 문서화한다.
export function shadowQualityReason(article, { offMainSources = new Set() } = {}) {
  if (!article) return "empty_article";
  if (article.kind === "ad" || article.kind === "affiliate") return `kind_${article.kind}`;
  if (article.source === "seed" || article.source === "me") return `source_${article.source}`;
  if (offMainSources.has(article.source)) return "off_main_source";
  if (hasProfanity(article.title)) return "profanity";
  const unpromotable = unpromotableReason(article.title);
  if (unpromotable) return `unpromotable:${unpromotable}`;
  const lowValue = lowValueReason(article.title);
  if (lowValue) return `low_value:${lowValue}`;
  // 딜 판정은 커뮤글에만 적용한다. 딜은 커뮤 게시판(뽐뿌 등)에서 오는 형식이고,
  // 뉴스 보도의 금액 표기("$500 billion 투자")를 가격 패턴으로 걸면 정상 기사가
  // 죽는다 — 첫 실행 실측에서 pcgamer 투자 기사가 실제로 걸렸다(과잉방어 금지).
  if (article.kind === "community" && isDeal(article)) return "deal_price_or_mall_format";
  return null;
}

// 게이트 적용 — 통과분과 탈락 기록(감사 가능: 글 ID·제목·소스·사유)을 나눈다.
function applyQualityGate(articles, { enabled, registry }) {
  const rows = (articles || []).filter(Boolean);
  if (!enabled) return { kept: rows, excluded: [] };
  const offMainSources = new Set((registry || [])
    .filter((entry) => entry && entry.mainFeed === false)
    .map((entry) => entry.id));
  const kept = [];
  const excluded = [];
  for (const article of rows) {
    const reason = shadowQualityReason(article, { offMainSources });
    if (reason) {
      excluded.push({
        articleId: article.id ?? null,
        title: article.title ?? null,
        source: article.source ?? null,
        category: article.category ?? null,
        reason
      });
    } else kept.push(article);
  }
  return { kept, excluded };
}

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

// ── 공유 준비 단계 (판 전체 1회 원칙)
// R1 클러스터링 순서 교정(블루프린트 "2026-08-14 P3-A 판정" 결함 2):
// 팩/분야로 기사를 자른 뒤 사건을 묶던 구조를 폐기하고, **전체 풀(전 카테고리·
// 전 kind)에서 먼저 사건을 묶는다.** 그 다음 사건을 팩·분야로 라우팅한다.
// 기존 구조에서는 같은 사건의 스포츠 매체 1곳+종합뉴스 1곳이 각 팩에서
// '단일 출처'로 탈락했다(반례 a). 커뮤 반응은 클러스터링이 사건에 자동으로
// 붙인다(evidenceRole=community_reaction — heat 축에만 계수, 정정 3).
//
// 클러스터링·계보는 **판(브리핑) 전체에서 정확히 1회만** 계산한다 — 분야·팩당
// 재계산 금지(직전 검수 P3-b). shadowSelectBriefing이 여러 분야를 선별할 때도
// 이 함수의 반환을 공유한다.
function prepareShadowPool(articles, {
  params, previousLineage, previousEditionFingerprints
}) {
  const rows = (articles || []).filter(Boolean);
  const events = buildEventClusters(rows);

  // R1 영구 계보 — 전체 사건 대상(팩·분야 라우팅 전). 판 사이 승계는 전 사건
  // 공통이어야 하므로 분야별로 자르기 전에 계산한다.
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
    const reactionArticles = event.reactionArticleIds.map((id) => byId.get(id)).filter(Boolean);
    views.push({
      event, memberArticles, reactionArticles,
      // 사건의 팩 귀속 — 구성원 카테고리 분포 기반 복수 귀속(packIdsForEvent 주석).
      packIds: packIdsForEvent(memberArticles, params),
      // 사건의 분야(카테고리) 귀속 — 구성원(보도) 기사들의 카테고리 집합.
      // 반응(community_reaction) 기사는 귀속에 계수하지 않는다.
      categoryIds: [...new Set(memberArticles.map((article) => article.category || "news"))].sort(),
      lineage: lineage.assignments.get(event.eventId) || null
    });
  }
  return { rows, events, lineage, views, prevFingerprintOf };
}

// ── 한 잣대(팩)로 후보 사건들을 선별: 게이트 → S 정렬 → 소스캡 → 동적 분량.
// shadowSelectEdition(팩 단위)과 shadowSelectBriefing(분야 단위)이 공유한다 —
// 잣대는 언제나 팩 계약이고, 무엇이 후보인지(candidateViews)만 다르다.
function selectWithPackYardstick(candidateViews, pack, {
  now, slotId, registryById, params, prevFingerprintOf, officialResultEventIds, roleOf
}) {
  // 1) 팩별 자격 게이트
  const gatePassed = [];
  const gateFailed = [];
  for (const view of candidateViews) {
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

  return { gatePassed, gateFailed, capExcluded, selected, belowVolume, partialEdition };
}

// articles: 원시 기사 배열. 품질 게이트(공통 원칙 6)는 R3에서 실제 배선됐다 —
// 기본 ON(qualityGate: false로만 끔), 탈락은 excluded.quality에 사유와 함께
// 남는다. 반환은 계산·비교용 산출물이다. 서빙에 쓰지 않는다.
//
// **주의 — 이 함수는 팩 단위 선별이다(하위 호환·팩 잣대 단위 관찰용).**
// 정책 팩 전체에서 뽑으므로 "business만 선택했는데 politics가 섞이는" 판
// 조립에는 쓰면 안 된다(블루프린트 "2026-08-14 P3-A 판정" 결함 1).
// **판(브리핑) 조립의 정본 진입점은 shadowSelectBriefing이다** — 선택 분야별
// 최대 14건 → 합집합(동일 사건 1회) → 분야별 중요도 층 교차 배치.
export function shadowSelectEdition(articles, {
  packId,
  now = Date.now(),
  slotId = null,
  registry = [],
  params = SHADOW_PACK_PARAMS,
  previousEditionFingerprints = new Map(),
  // R1 — 영구 사건 계보. 이전 판 반환의 lineage.records를 그대로 넘기면
  // 재등장 게이트가 eventId가 아니라 **계보** 기준으로 판정된다(이른 기사
  // 지연 합류로 eventId가 바뀌어도 같은 사건으로 이어진다 — 결함 4).
  // null이면 구 eventId 키 맵(previousEditionFingerprints)으로 폴백한다.
  previousLineage = null,
  officialResultEventIds = new Set(),
  qualityGate = true
} = {}) {
  const pack = params.packs[packId];
  if (!pack) throw new Error(`shadowSelectEdition: 알 수 없는 팩 ${packId}`);
  const registryById = new Map((registry || []).filter(Boolean).map((entry) => [entry.id, entry]));
  const roleOf = (article) => resolveSourceRole(article, registryById.get(article && article.source));

  // R3 — 품질 게이트 선행(클러스터링보다 먼저): 광고성·저품질 글이 사건을
  // 이루거나 커뮤 절대선을 통과하기 전에 뺀다. 탈락 기록은 결과에 남긴다.
  const quality = applyQualityGate(articles, { enabled: qualityGate !== false, registry });
  const pool = prepareShadowPool(quality.kept, { params, previousLineage, previousEditionFingerprints });
  const base = pool.rows.filter((article) => packIdForArticle(article, params) === packId);
  const views = pool.views.filter((view) => view.packIds.includes(packId));

  const {
    gatePassed, gateFailed, capExcluded, selected, belowVolume, partialEdition
  } = selectWithPackYardstick(views, pack, {
    now, slotId, registryById, params,
    prevFingerprintOf: pool.prevFingerprintOf,
    officialResultEventIds, roleOf
  });
  const rows = pool.rows;
  const lineage = pool.lineage;
  const volume = params.volume;

  return {
    contract: SHADOW_SELECTION_CONTRACT.stableId,
    packId,
    packLabel: pack.label,
    slotId,
    now,
    params: { pack, volume: { ...volume }, axis: { ...params.axis } },
    counts: {
      inputArticles: rows.length,
      qualityExcluded: quality.excluded.length,
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
      quality: quality.excluded,
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

// ---------------------------------------------------------------------------
// R2 — 판(브리핑) 조립의 정본 진입점: 분야(카테고리) 단위 선별 → 합집합 →
// 중요도 층 교차 배치
// ---------------------------------------------------------------------------
//
// 블루프린트 01 "동적 분량 계약" + "2026-08-14 P3-A 판정" 결함 1의 수리.
//
// **선별 단위는 팩이 아니라 카테고리다.** business만 선택하면 politics·
// realestate·tech 사건은 (같은 newsy 팩이어도) 후보에 들어오지 못한다.
// 분야별로 각자 최대 14건(동적 분량 계약)을 선별한 뒤 합치므로, 한 분야의
// 공급이 많아도 다른 분야를 밀어내지 않는다("두 분야 16건" 재발 방지).
//
// ── 규칙
//  1. 전체 풀 클러스터링·계보는 판 전체 1회만 계산(prepareShadowPool 공유 —
//     분야당 재계산 금지, 직전 검수 P3-b).
//  2. 사건의 분야 귀속 = 구성원(보도) 기사들의 카테고리 집합(view.categoryIds).
//     반응 기사는 귀속에 계수하지 않는다. 잣대는 그 카테고리가 속한 팩의
//     계약(게이트·가중·창·캡)이다. kind=community 글의 커뮤 팩 특례는 팩
//     귀속(packIdForArticle)의 규칙이고, 분야 귀속은 카테고리를 따른다 —
//     커뮤글이 tech로 분류돼 있으면 tech 선택의 후보가 되고 tech의 잣대
//     (newsy 준용)로 판정된다(대개 게이트에서 정직하게 탈락한다).
//  3. 합집합: 복수 분야 선택 시 분야별 선별 목록을 합치고 동일 사건은
//     lineageId 기준으로 한 번만 남긴다. 어느 분야들에서 뽑혔는지는
//     selectedByCategories에 기록한다(whyForYou 재료).
//  4. 교차 배치: 각 분야의 1위층, 2위층 순으로 합치며 같은 층에서는 전체 S가
//     높은 사건 먼저. 결정적 tie-break: 층(tier) 오름차순 → S 내림차순 →
//     lineageId 문자열 비교. 양쪽 분야에 다 귀속된 사건의 층은 분야별 순위 중
//     최상위(min), S는 분야별 S 중 최댓값을 쓴다.
//  5. 미선택 분야 사건은 어떤 경로로도 briefing에 혼합되지 않는다.
export function shadowSelectBriefing(articles, {
  requestedCategories,
  now = Date.now(),
  slotId = null,
  registry = [],
  params = SHADOW_PACK_PARAMS,
  previousEditionFingerprints = new Map(),
  previousLineage = null,
  officialResultEventIds = new Set(),
  qualityGate = true
} = {}) {
  if (!Array.isArray(requestedCategories) || requestedCategories.length === 0) {
    throw new Error("shadowSelectBriefing: requestedCategories 필요(비어 있지 않은 배열)");
  }
  const catIndex = new Map();
  for (const [packId, pack] of Object.entries(params.packs)) {
    for (const category of [...pack.categories, ...(pack.appliedCategories || [])]) {
      catIndex.set(category, packId);
    }
  }
  const categories = [...new Set(requestedCategories)];
  for (const category of categories) {
    if (!catIndex.has(category)) {
      throw new Error(`shadowSelectBriefing: 알 수 없는 카테고리 ${category}`);
    }
  }

  const registryById = new Map((registry || []).filter(Boolean).map((entry) => [entry.id, entry]));
  const roleOf = (article) => resolveSourceRole(article, registryById.get(article && article.source));

  // R3 — 품질 게이트 선행(판 전체 1회, 클러스터링보다 먼저). 결함 3의 배선:
  // 광고성 글이 커뮤 절대선(eng)을 통과해 표본을 오염시키기 전에 뺀다.
  const quality = applyQualityGate(articles, { enabled: qualityGate !== false, registry });

  // 판 전체 1회: 클러스터링·계보·뷰.
  const pool = prepareShadowPool(quality.kept, { params, previousLineage, previousEditionFingerprints });

  // 분야별 선별 — 각 분야가 **각자** 동적 분량(최대 14건)으로 선별된다.
  const perCategory = {};
  for (const category of categories) {
    const packId = catIndex.get(category);
    const pack = params.packs[packId];
    const candidates = pool.views.filter((view) => view.categoryIds.includes(category));
    const run = selectWithPackYardstick(candidates, pack, {
      now, slotId, registryById, params,
      prevFingerprintOf: pool.prevFingerprintOf,
      officialResultEventIds, roleOf
    });
    perCategory[category] = {
      packId,
      packLabel: pack.label,
      counts: {
        candidates: candidates.length,
        gatePassed: run.gatePassed.length,
        gateFailed: run.gateFailed.length,
        capExcluded: run.capExcluded.length,
        selected: run.selected.length
      },
      partialEdition: run.partialEdition,
      selected: run.selected,
      excluded: {
        gate: run.gateFailed,
        sourceCap: run.capExcluded,
        belowVolume: run.belowVolume
      }
    };
  }

  // 합집합 — lineageId 기준 동일 사건 1회. 분야별 층(그 분야 선별 목록의
  // 순위)과 S를 함께 기록한다.
  const unionByLineage = new Map();
  for (const category of categories) {
    perCategory[category].selected.forEach((row, index) => {
      const lineageId = row.view.lineage
        ? row.view.lineage.lineageId
        : String(row.view.event.eventId); // 방어 — 계보는 항상 배정되지만 키 부재로 합집합이 깨지지 않게
      const tier = index + 1; // 그 분야 안의 중요도 순위 층(1위층=1)
      const existing = unionByLineage.get(lineageId);
      if (!existing) {
        unionByLineage.set(lineageId, {
          lineageId,
          eventId: row.view.event.eventId,
          view: row.view,
          selectedByCategories: [category],
          byCategory: { [category]: { tier, S: row.score.S, gate: row.gate, score: row.score } },
          tier,
          S: row.score.S
        });
      } else {
        existing.selectedByCategories.push(category);
        existing.byCategory[category] = { tier, S: row.score.S, gate: row.gate, score: row.score };
        existing.tier = Math.min(existing.tier, tier);
        existing.S = Math.max(existing.S, row.score.S);
      }
    });
  }
  for (const entry of unionByLineage.values()) entry.selectedByCategories.sort();

  // 교차 배치 — 층 오름차순 → 같은 층은 전체 S 내림차순 → lineageId(결정적).
  const briefing = [...unionByLineage.values()].sort((a, b) => a.tier - b.tier
    || b.S - a.S
    || String(a.lineageId).localeCompare(String(b.lineageId)));

  return {
    contract: SHADOW_SELECTION_CONTRACT.stableId,
    mode: "briefing",
    requestedCategories: categories,
    slotId,
    now,
    perCategory,
    briefing,
    // R3 — 품질 게이트 탈락 기록(분야 라우팅 전, 판 전체 공통이라 최상위에 둔다).
    excluded: { quality: quality.excluded },
    counts: {
      inputArticles: pool.rows.length,
      qualityExcluded: quality.excluded.length,
      events: pool.views.length,
      briefingSelected: briefing.length,
      perCategorySelected: Object.fromEntries(categories.map((category) =>
        [category, perCategory[category].counts.selected]))
    },
    // 이번 브리핑에 실제 배치(서빙)된 사건에만 서빙 지문을 찍는다 — 다음 판의
    // previousLineage 재료(shadowSelectEdition과 같은 계약).
    lineage: {
      records: markLineageServed(pool.lineage.records,
        new Set(briefing.map((entry) => entry.eventId)))
    }
  };
}

export { engagementOf };
