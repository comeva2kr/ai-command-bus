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
import { createHash } from "node:crypto";
import {
  buildEventClusters, carryEventLineages, markLineageServed, pruneEventLineages
} from "./event-cluster.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";
import {
  AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS,
  heatAxis, importanceAxis, changeAxis, trustMaterials, engagementOf,
  isAuthoritativeForeignNewsSource
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
  version: 2, // R5 — 신뢰 등급제(A/독립2/B)·대표기사 선정·민감 2출처 강제
  mode: "shadow_only",
  servingPathTouched: false,
  blueprintSection: "docs/01_NOWHOT_SYSTEM_BLUEPRINT.md — 2026-08-13 정책 팩별 판 자격(eligibility) 계약",
  commonPrinciples: [
    "1. verified 분리: aggregate·일반 reported_secondary 1건 단독은 어느 뉴스 팩에서도 신뢰 자격 없음(원계약 유지)",
    "2. 뉴스 등급 계약(R5, David 확정 2026-08-14): A등급 primary·first_party 1곳 ∨ 독립 operatorGroup 2곳 ∨ B등급 specialist 단독('단일 출처' 표기, 민감 판정 시 불가 — 민감한 의혹·시장 영향 뉴스만 독립 2출처 강제). 임의 eventId 예외 금지",
    "3. 같은 운영그룹 분야별 피드는 독립 계수 1회(event-cluster C4 재사용)",
    "4. 소스캡 자동 완화 금지 — 부족하면 부분 제공(부분판). 캡은 표시할 대표기사(representativeOf)의 operatorGroup 기준(R5)",
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
  // R5 민감 판별 사전 — David 확정("민감한 의혹·시장 영향 뉴스만 2개 독립
  // 출처 강제")의 코드 정본. **David 검토용으로 목록은 이 한 곳에만 있다.**
  //
  // 어휘의 출처(발명 최소화):
  //  - allegation·market 한국어: 블루프린트 "2026-08-14 P3-A 판정 — 정책 판단"
  //    명시어(의혹·수사·혐의·기소·논란·폭로 / 급등·급락·상장폐지·유상증자·
  //    공시 위반) + 2026-08-13 신선 풀 실물 표본에서 관측된 형태 2개(구속·
  //    압수수색)만 추가.
  //  - english: 신선 풀 실물 표본에서 관측된 단어 형태만(lawsuit·arrested·
  //    investigation·plunge/plunged·surge/surged 계열). scandal·fraud·
  //    allegation 등은 표본 부재로 미동결 — David 검토 대상(과잉 발명 금지).
  //
  // 일치 규칙: 한국어는 제목 부분 문자열, 영어는 소문자 단어 경계(따라서
  // "surgery"는 surge에 걸리지 않는다). 구성원(보도) 기사 제목만 본다 —
  // 반응(community_reaction) 글 제목은 사건 민감도의 근거가 아니다.
  sensitive: {
    basis: "David 확정 2026-08-14 P3-A 판정 — 민감(의혹·시장 영향)만 독립 2출처 강제. B등급(specialist 단독) 경로만 막고 A·독립2 경로는 그대로다.",
    allegation: ["의혹", "수사", "혐의", "기소", "논란", "폭로", "구속", "압수수색"],
    market: ["급등", "급락", "상장폐지", "유상증자", "공시 위반"],
    english: ["lawsuit", "lawsuits", "arrested", "investigation", "investigations",
      "plunge", "plunged", "plunges", "surge", "surged", "surges"]
  },
  // 해외 뉴스 중요도 공식(David 채택 옵션 1, 2026-08-17) — newsy 팩 overseas
  // 서브테이블(componentWeights.marketSignal)이 소비하는 이진 매칭 사전. 조사
  // 실측 어휘만(과잉 발명 금지) — 한국어는 제목 부분 문자열, 영어는 소문자
  // 단어 경계. 구성원(보도) 기사 제목만 본다. **David 검토용으로 사전은 이
  // 한 곳에만 있다.**
  marketSignal: {
    basis: "David 채택 옵션 1(2026-08-17) — allMembersOverseas 사건 한정 importance 성분. 어휘는 조사 실측만(발명 금지).",
    korean: ["연준", "금리", "환율", "성장률", "실적", "반도체", "중국", "일본"],
    english: ["Fed", "rate", "CPI", "GDP", "jobs", "payrolls", "China", "Japan", "dollar",
      "yen", "oil", "earnings", "Nvidia", "Apple", "Microsoft", "Amazon", "Meta", "Tesla",
      "SoftBank", "Anthropic", "OpenAI"]
  },
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
      trustGate: "news_graded", // R5 — A(primary·first_party) ∨ 독립2 ∨ B(specialist 단독·단일 출처 표기·민감 불가)
      sourceCap: { per: "operatorGroup", max: 2 },
      // 해외 뉴스 중요도 공식(David 채택 옵션 1, 2026-08-17) — 구
      // overseasMinPerCategory 강제 스왑(2026-08-17 이전 값 1)은 완전
      // 폐기했다. 대신 allMembersOverseas 사건에 한해 이 서브테이블로
      // shadowScore를 다시 계산한다 — 국내 사건과 같은 S 정렬 안에서
      // marketSignal 성분이 실제 실적·거시 신호가 있는 해외발 경제 사건의
      // importance를 끌어올려 순위 자체로 노출을 얻는다(땜질 스왑 불필요).
      // groupSaturation 2: 해외 사건은 독립 운영그룹 자체가 국내보다 얇다
      // (같은 슬롯 실측에서 사건당 1~2곳) — 5로 두면 groupsRatio가 항상
      // 바닥에 붙는다. componentWeights 합 1.0(0.30/0.15/0.15/0.40) —
      // marketSignal에 가장 큰 비중을 준다(David 채택 옵션 1 그대로).
      overseas: {
        weights: { heat: 0.05, importance: 0.65, change: 0.30 },
        windowHours: AUTHORITATIVE_FOREIGN_NEWS_WINDOW_HOURS,
        groupSaturation: 2,
        componentWeights: {
          groups: 0.20, weighty: 0.10, primary: 0.10, authority: 0.35, marketSignal: 0.25
        }
      }
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
      trustGate: "news_graded", // 기관 primary(NASA 등)=A등급 단독 통과. specialist(livescience 등) 단독은 B등급('단일 출처')
      sourceCap: { per: "operatorGroup", max: 3 }
    },
    sports: {
      label: "스포츠",
      categories: ["sports"],
      appliedCategories: [],
      weights: { heat: 0.2, importance: 0.5, change: 0.3 },
      weightsBasis: "미지정 — newsy 준용 초기값(David 확인 대상)",
      windowHours: 24,
      // R5(미결 1의 David 확정 답): 임의 eventId 예외(officialResultEventIds류)
      // 금지 — 신뢰 등급제로 대체. 공식 리그·협회·팀 결과(primary·first_party)
      // =A등급, 신뢰할 만한 전문매체(ESPN 등 specialist) 단독 결과=B등급
      // ('단일 출처' 표기). soloOfficialResultException 파라미터는 제거됐다.
      trustGate: "news_graded",
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
      // R5 — 문화 팩의 specialist 특례(news_basic_or_specialist)는 등급제에
      // 흡수됐다: specialist 단독=B등급('단일 출처' 표기)이 전 뉴스 팩 공통
      // 규칙이 되면서 문서·코드 모순이 해소됐다(David 확정 정책 2).
      trustGate: "news_graded",
      sourceCap: { per: "operatorGroup", max: 2 }
    }
  },
  // 미결(David 확인 대기)과 이 테이블에서 그 답이 바꿀 파라미터 위치.
  // 구 미결 1(스포츠 단독 결과 예외)은 2026-08-14 David 확정으로 종결 —
  // 신뢰 등급제(trustGate news_graded + sensitive 사전)로 대체, ID 예외 제거.
  openDecisions: {
    "2_category_pack_assignment": "packs.newsy.appliedCategories(tech·auto) / packs.culture.categories(gaming) / packs.community.categories(life)",
    "3_community_eng_and_windows": "packs.community.engMin(30)·packs.community.windowHours(6) 등 각 팩 windowHours",
    "4_sensitive_lexicon_scope": "sensitive.english — scandal·fraud·allegation 등 표본 미관측 어휘의 추가 여부(현재 미포함·과잉 발명 금지)"
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

function declaredSingleSourceClass(memberArticles, pack, registryById) {
  if (!registryById || !memberArticles.length) return false;
  const packCategories = new Set([...pack.categories, ...(pack.appliedCategories || [])]);
  if (memberArticles.every((article) => {
    const entry = registryById.get(article && article.source);
    return entry && entry.sourceTier === "specialist" && packCategories.has(entry.category);
  })) return "specialist";
  if (memberArticles.every((article) => {
    const entry = registryById.get(article && article.source);
    return entry && entry.kind === "news" && entry.sourceTier === "aggregate"
      && entry.size === "large" && typeof entry.operatorGroup === "string"
      && entry.operatorGroup.trim().length > 0;
  })) return "publisher";
  return null;
}

// 해외발 판정 — 소스 레지스트리 country 실코드만 본다(David #과업3, 2026-08-17
// 지시: "판별은 소스 레지스트리 country 필드 실코드 확인"). 구성원 기사 **전부**가
// 해외 소스일 때만 해외발이다 — 국내 매체가 하나라도 섞이면 이미 국내 보도다.
export function allMembersOverseas(memberArticles, registryById) {
  if (!registryById || !memberArticles || !memberArticles.length) return false;
  return memberArticles.every((article) => {
    const entry = registryById.get(article && article.source);
    return Boolean(entry && entry.country && entry.country !== "KR");
  });
}

// ---------------------------------------------------------------------------
// R5 — 민감 판별(보수적): 사전은 SHADOW_PACK_PARAMS.sensitive 한 곳에만 있다.
// ---------------------------------------------------------------------------
//
// 구성원(보도) 기사 제목만 본다. 한국어는 부분 문자열, 영어는 소문자 단어
// 경계 일치("surgery"는 surge에 안 걸린다 — 신선 풀 livescience 실물 반례).
// 반환은 판정과 근거(어느 기사의 어느 어휘): 감사 가능성.
export function sensitiveMatches(view, lexicon) {
  if (!lexicon) return { sensitive: false, matches: [] };
  const korean = [...(lexicon.allegation || []), ...(lexicon.market || [])];
  const english = lexicon.english || [];
  const matches = [];
  for (const article of (view && view.memberArticles) || []) {
    const title = String((article && article.title) || "");
    for (const term of korean) {
      if (term && title.includes(term)) matches.push({ articleId: article.id ?? null, term });
    }
    if (english.length) {
      const lower = title.toLowerCase();
      for (const term of english) {
        if (term && new RegExp(`(?:^|[^a-z])${term}(?:$|[^a-z])`).test(lower)) {
          matches.push({ articleId: article.id ?? null, term });
        }
      }
    }
  }
  return { sensitive: matches.length > 0, matches };
}

// ---------------------------------------------------------------------------
// R5 — 대표기사 선정(Techmeme 계약): 사건별 결정적 규칙 한 벌.
// ---------------------------------------------------------------------------
//
// 우선순위(David 확정 정책 3의 전제 — "표시할 대표기사를 먼저 선정"):
//   1) primary·first_party(1차 출처)  2) specialist(전문매체)
//   3) 동급이면 반응(engagementOf) 큰 기사  4) 이른 발행  5) id 순(결정적).
// 순수 함수: 네트워크·시계 접근 없음. 반환에 선정 근거(basis)를 노출한다.
// 소스캡은 이 대표기사의 operatorGroup(커뮤 팩은 source) 기준으로 센다.
export function representativeOf(view, { roleOf, registryById = null } = {}) {
  const members = (((view && view.memberArticles) || []).filter(Boolean));
  const pool = members.length ? members
    : (((view && view.reactionArticles) || []).filter(Boolean));
  if (!pool.length) return null;
  const classRankOf = (article) => {
    const role = typeof roleOf === "function" ? roleOf(article) : null;
    if (role === "primary" || role === "first_party") return 0;
    const entry = registryById ? registryById.get(article.source) : null;
    if (entry && entry.sourceTier === "specialist") return 1;
    return 2;
  };
  const timeOf = (article) => {
    const t = Date.parse(String((article && article.publishedAt) || ""));
    return Number.isFinite(t) ? t : Infinity; // 발행시각 불명은 최후순위
  };
  // 정렬 키: [등급, -반응, 발행시각, id] 사전식 오름차순의 최솟값이 대표.
  const keyOf = (article) => [classRankOf(article), -engagementOf(article),
    timeOf(article), String(article.id ?? "")];
  const lessThan = (a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return a[3].localeCompare(b[3]) < 0;
  };
  let best = pool[0];
  let bestKey = keyOf(best);
  for (const article of pool.slice(1)) {
    const key = keyOf(article);
    if (lessThan(key, bestKey)) { best = article; bestKey = key; }
  }
  const rank = bestKey[0];
  return {
    article: best,
    articleId: best.id ?? null,
    basis: {
      rule: "primary·first_party > specialist > 반응(engagement) > 이른 발행 > id",
      class: rank === 0 ? "primary_or_first_party" : rank === 1 ? "specialist" : "other",
      engagement: engagementOf(best),
      publishedAt: best.publishedAt ?? null
    }
  };
}

// 사건 하나의 팩 자격 판정.
// 반환: { pass, failures[], passedBy, trustGrade, trustLabel, sensitive, trust, window }.
// R5 — trustGrade: "A"(primary·first_party) | "independent2"(독립 2그룹) |
// "B"(specialist 단독 — trustLabel "단일 출처", 민감 판정 시 불가) | null.
export function shadowEligibility(view, pack, {
  now,
  slotId = null,
  registryById = null,
  previousFingerprint = null,
  sensitiveLexicon = null,
  roleOf
} = {}) {
  const failures = [];
  let passedBy = null;
  let trustGrade = null;
  let trustLabel = null;

  // 창: 팩 신선도 창(모닝 슬롯이면 팩의 morningWindowHours가 있을 때 그 값).
  const overseasFormula = Boolean(pack.overseas)
    && allMembersOverseas(view.memberArticles, registryById);
  const windowHours = overseasFormula && Number.isFinite(pack.overseas.windowHours)
    ? pack.overseas.windowHours
    : slotId === "morning" && Number.isFinite(pack.morningWindowHours)
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
  // R5 민감 판별 — 근거는 늘 결과에 남긴다(A·독립2 통과 사건도 관측 기록).
  const sensitive = sensitiveMatches(view, sensitiveLexicon);
  if (pack.trustGate === "community_absolute_eng") {
    // 언론 계수 무의미(실측: 커뮤 다중 구성 사건 0건) — 절대 반응선만 본다.
    // 커뮤 팩의 구성원은 커뮤글 자체라 communityEng가 곧 사건 반응량이다.
    const eng = trust.communityEng;
    if (eng >= pack.engMin) passedBy = `community_eng>=${pack.engMin}`;
    else failures.push(`community_eng_below_absolute_line(${eng}<${pack.engMin})`);
  } else {
    // R5 뉴스 등급 계약(news_graded — David 확정 2026-08-14, 전 뉴스 팩 공통):
    //   A     primary·first_party 1곳(공식 리그·협회·팀·기관 1차 출처)
    //   독립2  독립 operatorGroup 2곳(원계약 유지)
    //   B     specialist 단독 — trustLabel "단일 출처" 표기. **민감(의혹·시장
    //         영향) 판정 시 불가** — 그 경우 독립 2출처가 강제된다.
    // aggregate·일반 reported_secondary 단독은 여전히 차단(원계약 유지).
    // 임의 eventId 예외(officialResultEventIds류)는 제거됐다 — 등급으로만 판정.
    if (trust.hasPrimaryOrFirstParty) {
      passedBy = "primary_or_first_party";
      trustGrade = "A";
    } else if (trust.independentReportingGroups >= 2) {
      passedBy = "independent_groups>=2";
      trustGrade = "independent2";
    } else if (declaredSingleSourceClass(view.memberArticles, pack, registryById)) {
      if (sensitive.sensitive) {
        const terms = [...new Set(sensitive.matches.map((match) => match.term))].join(",");
        failures.push(`sensitive_single_specialist_needs_independent_2(${terms})`);
      } else {
        passedBy = declaredSingleSourceClass(view.memberArticles, pack, registryById) === "specialist"
          ? "specialist_single_source" : "publisher_single_source";
        trustGrade = "B";
        trustLabel = "단일 출처";
      }
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

  const pass = failures.length === 0;
  return {
    pass,
    passedBy: pass ? passedBy : null,
    trustGrade: pass ? trustGrade : null,   // R5 — 통과 등급(A/independent2/B) 기록
    trustLabel: pass ? trustLabel : null,   // R5 — B등급은 "단일 출처" 표기
    sensitive,                              // R5 — 민감 판정과 근거(항상 관측 기록)
    failures,
    trust,
    windowHours,
    ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100
  };
}

// ---------------------------------------------------------------------------
// 점수 S = w_h·heat + w_i·importance + w_c·change
// ---------------------------------------------------------------------------

// 해외 뉴스 중요도 공식(David 채택 옵션 1, 2026-08-17): allMembersOverseas
// (구성원 전부 country≠KR)인 사건에 한해, pack.overseas가 있는 팩(newsy)만
// overseas 서브테이블로 가중·groupSaturation·componentWeights를 바꿔 쓴다.
// 국내 사건과 overseas 서브테이블이 없는 팩(science 등)은 이 분기를 타지
// 않는다 — 기존 산식 그대로(무변경).
export function shadowScore(view, pack, {
  now, params = SHADOW_PACK_PARAMS, previousFingerprint = null, roleOf, registryById = null
} = {}) {
  const axis = params.axis;
  const overseasFormula = Boolean(pack.overseas)
    && allMembersOverseas(view.memberArticles, registryById);
  const heat = heatAxis(view, { saturationEng: axis.heatSaturationEng });
  const importance = importanceAxis(view, {
    groupSaturation: overseasFormula ? pack.overseas.groupSaturation : axis.importanceGroupSaturation,
    weightyCategories: axis.weightyCategories,
    componentWeights: overseasFormula ? pack.overseas.componentWeights : axis.importanceComponents,
    authorityOf: overseasFormula
      ? (article) => isAuthoritativeForeignNewsSource(registryById?.get(article && article.source))
      : null,
    marketSignalLexicon: overseasFormula ? params.marketSignal : null,
    roleOf
  });
  const windowHours = overseasFormula && Number.isFinite(pack.overseas.windowHours)
    ? pack.overseas.windowHours : pack.windowHours;
  const change = changeAxis(view, {
    now, windowHours, stair: axis.freshnessStair, previousFingerprint
  });
  const w = overseasFormula ? pack.overseas.weights : pack.weights;
  const S = w.heat * heat.value + w.importance * importance.value + w.change * change.value;
  return {
    S: Math.round(S * 10000) / 10000,
    weights: { ...w },
    axes: { heat, importance, change },
    overseasFormula
  };
}

// ---------------------------------------------------------------------------
// shadow 판 구성 — 게이트 → S 정렬 → 소스캡 → 동적 분량
// ---------------------------------------------------------------------------

// R5(David 확정 정책 3) — 소스캡은 **표시할 대표기사** 기준이다. 구
// capKeyOf는 memberArticles[0](클러스터 순서상 가장 앞선 기사) 기준이라
// 화면에 안 나가는 구성원의 그룹이 캡을 소모했다(직전 검수 P2-1). 대표기사
// (representativeOf)의 operatorGroup(커뮤 팩은 source)으로 센다.
const capKeyForRepresentative = (representative, pack) => {
  if (!representative || !representative.article) return "unknown";
  return pack.sourceCap.per === "source"
    ? String(representative.article.source || "unknown")
    : operationalSourceIdentity(representative.article).ownershipGroup;
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
  params, previousLineage, previousEditionFingerprints, now
}) {
  const rows = (articles || []).filter(Boolean);
  const events = buildEventClusters(rows);

  // R1 영구 계보 — 전체 사건 대상(팩·분야 라우팅 전). 판 사이 승계는 전 사건
  // 공통이어야 하므로 분야별로 자르기 전에 계산한다. nowMs는 S2-2 프루닝의
  // 관측 시각 재료(판 시각 주입 — 시계 직접 접근 없음).
  const lineage = carryEventLineages(previousLineage || [], events, { nowMs: now });
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
      categoryIds: [...new Set(memberArticles.flatMap((article) =>
        Array.isArray(article.admittedCategories) ? article.admittedCategories : [article.category || "news"]))].sort(),
      lineage: lineage.assignments.get(event.eventId) || null
    });
  }
  return { rows, events, lineage, views, prevFingerprintOf };
}

// 통과 등급 분포 셈(R5 보고 재료) — 커뮤 팩(등급 없음)은 none으로 센다.
const countByTrustGrade = (selectedRows) => {
  const counts = {};
  for (const row of selectedRows) {
    const grade = row.gate.trustGrade || "none";
    counts[grade] = (counts[grade] || 0) + 1;
  }
  return counts;
};

// ── 한 잣대(팩)로 후보 사건들을 선별: 게이트 → S 정렬 → 소스캡 → 동적 분량.
// shadowSelectEdition(팩 단위)과 shadowSelectBriefing(분야 단위)이 공유한다 —
// 잣대는 언제나 팩 계약이고, 무엇이 후보인지(candidateViews)만 다르다.
function selectWithPackYardstick(candidateViews, pack, {
  now, slotId, registryById, params, prevFingerprintOf, roleOf
}) {
  // 1) 팩별 자격 게이트(R5 — 등급제. 민감 사전은 파라미터 테이블의 것)
  const gatePassed = [];
  const gateFailed = [];
  for (const view of candidateViews) {
    const gate = shadowEligibility(view, pack, {
      now, slotId, registryById,
      previousFingerprint: prevFingerprintOf(view.event),
      sensitiveLexicon: params.sensitive,
      roleOf
    });
    if (gate.pass) gatePassed.push({ view, gate });
    else gateFailed.push({ view, gate });
  }

  // 2) S 정렬(결정적 — 동점은 eventId) + R5 대표기사 선정(표시·캡의 기준)
  const scored = gatePassed.map((row) => {
    const representative = representativeOf(row.view, { roleOf, registryById });
    return {
      ...row,
      representative: representative && {
        articleId: representative.articleId,
        source: representative.article.source ?? null,
        basis: representative.basis,
        capKey: capKeyForRepresentative(representative, pack)
      },
      score: shadowScore(row.view, pack, {
        now, params,
        previousFingerprint: prevFingerprintOf(row.view.event),
        roleOf, registryById
      })
    };
  }).sort((a, b) => b.score.S - a.score.S
    || String(a.view.event.eventId).localeCompare(String(b.view.event.eventId)));

  // 3) 소스캡 — 자동 완화 금지(공통 원칙 4). 캡에 걸린 사건은 제외로 남긴다.
  //    R5: 키는 대표기사의 operatorGroup(커뮤 팩은 source) — 비대표 구성원의
  //    그룹은 캡을 소모하지 않는다(David 확정 정책 3).
  const capCounts = new Map();
  const capped = [];
  const capExcluded = [];
  for (const row of scored) {
    const key = row.representative ? row.representative.capKey : "unknown";
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

  // 구 "해외발 최소 노출 보장" 강제 스왑(pack.overseasMinPerCategory, David
  // #과업3 2026-08-17)은 David 승인으로 완전 폐기했다(2026-08-17 해외 뉴스
  // 중요도 공식 옵션 1 채택). 골라놓은 S 순위를 사후에 다시 바꾸지 않는다 —
  // 대신 shadowScore가 allMembersOverseas 사건에 overseas 서브테이블
  // (marketSignal 포함)을 적용해 S 자체로 노출을 얻는다.

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
  qualityGate = true
} = {}) {
  const pack = params.packs[packId];
  if (!pack) throw new Error(`shadowSelectEdition: 알 수 없는 팩 ${packId}`);
  const registryById = new Map((registry || []).filter(Boolean).map((entry) => [entry.id, entry]));
  const roleOf = (article) => resolveSourceRole(article, registryById.get(article && article.source));

  // R3 — 품질 게이트 선행(클러스터링보다 먼저): 광고성·저품질 글이 사건을
  // 이루거나 커뮤 절대선을 통과하기 전에 뺀다. 탈락 기록은 결과에 남긴다.
  const quality = applyQualityGate(articles, { enabled: qualityGate !== false, registry });
  const pool = prepareShadowPool(quality.kept, { params, previousLineage, previousEditionFingerprints, now });
  const base = pool.rows.filter((article) => packIdForArticle(article, params) === packId);
  const views = pool.views.filter((view) => view.packIds.includes(packId));

  const {
    gatePassed, gateFailed, capExcluded, selected, belowVolume, partialEdition
  } = selectWithPackYardstick(views, pack, {
    now, slotId, registryById, params,
    prevFingerprintOf: pool.prevFingerprintOf,
    roleOf
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
      selected: selected.length,
      // R5 — 통과 등급 분포(A/independent2/B): 재실측 보고의 기본 재료.
      selectedByTrustGrade: countByTrustGrade(selected)
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
  qualityGate = true,
  // S2-2 계보 프루닝(옵션 B, David 승인) — 기본 ON. 끄는 스위치는 여기 한 곳.
  // 서빙 이력 계보는 영구 보존이라 재등장 게이트 판정은 ON/OFF와 무관하게 같다.
  lineagePruning = true
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
  const pool = prepareShadowPool(quality.kept, { params, previousLineage, previousEditionFingerprints, now });

  // 분야별 선별 — 각 분야가 **각자** 동적 분량(최대 14건)으로 선별된다.
  const perCategory = {};
  for (const category of categories) {
    const packId = catIndex.get(category);
    const pack = params.packs[packId];
    const candidates = pool.views.filter((view) => view.categoryIds.includes(category));
    const run = selectWithPackYardstick(candidates, pack, {
      now, slotId, registryById, params,
      prevFingerprintOf: pool.prevFingerprintOf,
      roleOf
    });
    perCategory[category] = {
      packId,
      packLabel: pack.label,
      counts: {
        candidates: candidates.length,
        gatePassed: run.gatePassed.length,
        gateFailed: run.gateFailed.length,
        capExcluded: run.capExcluded.length,
        selected: run.selected.length,
        selectedByTrustGrade: countByTrustGrade(run.selected) // R5
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
          // R5 — 표시할 대표기사(잣대 무관: 사건·레지스트리에만 의존해 분야
          // 사이에 동일). capKey는 그 분야 팩 계약 기준이라 byCategory가 아닌
          // 여기서는 articleId·근거만 의미가 있다.
          representative: row.representative,
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
    // previousLineage 재료(shadowSelectEdition과 같은 계약). S2-2: 서빙 표시
    // **후** 프루닝(옵션 B — 서빙 계보 보존, 미서빙 계보 72h 만료). 순서가
    // 반대면 이번 판 서빙 계보가 미서빙으로 오판돼 지워질 수 있다.
    lineage: (() => {
      const marked = markLineageServed(pool.lineage.records,
        new Set(briefing.map((entry) => entry.eventId)));
      const records = lineagePruning !== false
        ? pruneEventLineages(marked, { nowMs: now })
        : marked;
      // prunedCount — 관찰 계측(S2-3 ③)용. 프루닝 OFF면 0.
      return { records, prunedCount: marked.length - records.length };
    })()
  };
}

// ---------------------------------------------------------------------------
// R7 — 경량 결정 영수증 (David 지시, 수정 순서 6)
// ---------------------------------------------------------------------------
//
// "입력 해시·선택/탈락 ID·사유만 담은 가벼운 영수증" — 3일 관찰 기간에 판마다
// 쌓여도 부담 없고, 나중에 어떤 입력에서 어떤 결정이 났는지 재현·감사할 수
// 있는 최소 형태. **제목·본문·URL은 절대 넣지 않는다**(경량 계약 — 동결
// 테스트가 필드 부재를 강제한다).
//
// 입력 해시 3요소:
//  - poolHash: 풀 파일 원문 SHA-256 — 호출자(도구)가 계산해 넘긴다.
//  - paramsHash: 파라미터 테이블의 결정적 직렬화 SHA-256 — 여기서 계산.
//  - codeVersion: 코드 버전 식별자(HEAD 커밋 등) — **실행 환경에서 주입받는
//    인자다. 이 코드는 git을 직접 호출하지 않는다**(순수 함수 계약).
//
// JSON 직렬화는 결정적(전 깊이 키 정렬) — 같은 입력이면 바이트 동일 영수증.

const sortKeysDeep = (value) => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value === undefined ? null : value;
};

export const stableStringify = (value) => JSON.stringify(sortKeysDeep(value));

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

// 파라미터 테이블 해시 — 결정적 직렬화 기준. 기본 테이블·override 사본 모두 가능.
export function shadowParamsHash(params = SHADOW_PACK_PARAMS) {
  return sha256Hex(stableStringify(params));
}

const lineageIdOfView = (view) => (view.lineage
  ? view.lineage.lineageId
  : String(view.event.eventId));

// shadowSelectBriefing 반환에서 경량 영수증을 만든다. 순수 함수 — 시계·파일·
// git 접근 없음. 반환: { receipt, json, hash } (json은 결정적 직렬화 문자열,
// hash는 그 SHA-256).
export function shadowBriefingReceipt(briefingResult, {
  poolHash = null,
  codeVersion = null,
  params = SHADOW_PACK_PARAMS
} = {}) {
  if (!briefingResult || briefingResult.mode !== "briefing") {
    throw new Error("shadowBriefingReceipt: shadowSelectBriefing 반환이 필요하다(mode=briefing)");
  }

  // ② 선택 사건: lineageId·대표기사 ID·trustGrade·S·층.
  const selected = briefingResult.briefing.map((entry, index) => {
    // 등급은 분야별 게이트 기록의 합집합(대개 1개) — 커뮤 팩(등급 없음)은 none.
    const grades = [...new Set(Object.values(entry.byCategory)
      .map((run) => run.gate.trustGrade || "none"))].sort();
    return {
      rank: index + 1,
      lineageId: entry.lineageId,
      eventId: entry.eventId,
      representativeArticleId: entry.representative ? entry.representative.articleId : null,
      trustGrades: grades,
      tier: entry.tier,
      S: entry.S,
      categories: entry.selectedByCategories
    };
  });

  // ③ 탈락: ID·사유 코드만(제목·본문 미포함 — 경량).
  const excluded = {
    quality: (briefingResult.excluded.quality || []).map((row) => ({
      articleId: row.articleId, reason: row.reason
    })),
    gate: [],
    sourceCap: [],
    belowVolume: []
  };
  for (const category of briefingResult.requestedCategories) {
    const run = briefingResult.perCategory[category];
    for (const row of run.excluded.gate) {
      excluded.gate.push({
        category,
        lineageId: lineageIdOfView(row.view),
        eventId: row.view.event.eventId,
        reasons: [...row.gate.failures]
      });
    }
    for (const row of run.excluded.sourceCap) {
      excluded.sourceCap.push({
        category,
        lineageId: lineageIdOfView(row.view),
        eventId: row.view.event.eventId,
        reason: row.exclusion
      });
    }
    for (const row of run.excluded.belowVolume) {
      excluded.belowVolume.push({
        category,
        lineageId: lineageIdOfView(row.view),
        eventId: row.view.event.eventId,
        reason: row.exclusion
      });
    }
  }

  const receipt = {
    contract: SHADOW_SELECTION_CONTRACT.stableId,
    receiptVersion: 1,
    // ① 입력 해시 — 풀 파일 + 파라미터 테이블 + 코드 버전(주입 인자).
    input: {
      poolHash,
      paramsHash: shadowParamsHash(params),
      codeVersion
    },
    // ④ 슬롯·조합·asOf·판 카운트 요약.
    slotId: briefingResult.slotId,
    asOf: briefingResult.now,
    requestedCategories: briefingResult.requestedCategories,
    counts: {
      inputArticles: briefingResult.counts.inputArticles,
      qualityExcluded: briefingResult.counts.qualityExcluded,
      events: briefingResult.counts.events,
      briefingSelected: briefingResult.counts.briefingSelected,
      perCategorySelected: briefingResult.counts.perCategorySelected
    },
    selected,
    excluded
  };
  const json = stableStringify(receipt);
  return { receipt, json, hash: sha256Hex(json) };
}

export { engagementOf };
