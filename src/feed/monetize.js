// Monetization: affiliate/ad slot placement for the outbound feed.
//
// Design brief: docs/monetization.md ("구현 상세"). Core constraint carried
// over from docs/handoff.md's 절대원칙 1 ("더미 콘텐츠 금지") — a slot must
// never fabricate a real-looking product unless it's either (a) backed by a
// real partner credential, or (b) explicitly, visibly flagged as a preview
// sample (AD_PREVIEW=1, dev/reviewer-only, same isolation pattern as
// FEED_DEV/seed-data.js). Production with neither set gets exactly 0 ad
// items, always.
//
// Psychology/UX principles this file encodes (see docs/monetization.md for
// citations):
//   - 동화(assimilation) + 명시(disclosure): the slot is shaped exactly like
//     an organic card (same fields the client already renders) so it doesn't
//     visually jar the feed. 2026-07-26 리디자인(24개 네이티브광고 리서치 +
//     David 최종지시) 이후: "명시"는 이제 배지 하나로 최소화한다 — 짧은 "AD"
//     라벨은 항상 렌더되지만(법적 방패, 절대 제거·위장 금지), 상단 축약고지·
//     하단 법정고지 전문·가격 블록의 상시 노출은 뺐다. 고지 전문은
//     progressive disclosure로 배지를 탭해야 보인다(index.html의
//     appendAdCard/.ad-disclosure-pop) — "존재+인지가능+접근가능"이면
//     상시노출 없이도 법적 요건을 충족한다는 리서치 결론에 따른 것.
//   - First-screen protection: the first `skipFirst` items a session sees
//     are always 100% organic, so first impression = trust, not a sales
//     pitch.
//   - No dark patterns: no countdown timers, no fabricated "N명이 구매중"
//     counters, no auto-navigate-on-load. A slot is inert until tapped, same
//     as every organic card.
//   - Relevance gating over forced fill: a slot with no candidate clearing
//     `minRelevance` is left EMPTY, not backfilled with an irrelevant pick —
//     an irrelevant ad reads as spam and erodes trust faster than a missed
//     impression costs revenue.

import { adCopy } from "./ad-copy.js";
import { adUnsafe } from "./promotion.js";
import { loadBanners } from "./manual-products.js";
import { topPreferences } from "./recommender.js";
import { categoryLabel } from "./taxonomy.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function envNum(name, dflt) {
  const v = process.env[name];
  return v != null && v !== "" ? Number(v) : dflt;
}

// ---- tunables (opts.* > env AD_* > default), mirroring ingest.js's hotParams pattern ----
const AD_EVERY_DEFAULT = 9; // 유기 카드 N개당 슬롯 1개
// 2026-07-25 라운드1 검수 #9: 4 -> 6으로 상향 (첫 화면 보호를 더 넉넉하게).
const AD_SKIP_FIRST_DEFAULT = 6; // 첫 화면 보호: 앞 K개엔 슬롯 없음
const AD_MAX_PER_PAGE_DEFAULT = 2; // 페이지(요청 1건)당 슬롯 상한 — 세션 총량 상한은 AD_MAX_PER_SESSION
// 2026-07-25 라운드1 검수 #7: AD_MAX_PER_PAGE는 "요청 1건"의 상한일 뿐이라 스크롤을
// 계속하면 세션 전체 노출이 무제한으로 누적된다. 유저(세션/24h)당 총 노출 상한.
const AD_MAX_PER_SESSION_DEFAULT = 6;
const AD_MIN_RELEVANCE_DEFAULT = 0.3; // 관련성 게이팅 임계치
const AD_EVERY_MIN = 4; // adaptiveEvery 하한 — 고반응 유저라도 이보다 촘촘히는 안 감
const AD_EVERY_MAX = 24; // adaptiveEvery 상한 — 저반응 유저라도 이보다 성글게는 안 감
const AD_RESPONSIVENESS_SENSITIVITY_DEFAULT = 0.35;
const AD_BASELINE_CTR_DEFAULT = 0.02;
// 2026-07-25 라운드1 검수 #8: source= 좁은 소스 뷰(게시판별 보기)는 트래픽이
// 작고 니치라 같은 빈도의 광고가 상대적으로 더 자주 느껴진다 — 기본 배수만큼
// every를 늘려(=성글게) 완화한다. applyNarrowSourceDensity가 이 값을 사용한다.
const AD_NARROW_EVERY_MULT_DEFAULT = 1.6;
export const DISCLOSURE_TEXT =
  "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다";
// 상단 배지 옆에 붙는 축약 고지 (라운드1 검수 #5) — 전체 법정문구는 하단에
// 그대로 유지하고, 이건 첫눈에 "이거 광고구나"를 알려주는 짧은 버전.
export const DISCLOSURE_SHORT_TEXT = "쿠팡파트너스 제휴 · 수수료 수취";

// 2026-07-25 라운드2 검수 #2 (치명, "정치 게이트 갭"): engine.js의 monetizeAllowed는
// showTopics 토글(정치/종교 콘텐츠 "노출" 여부)만 본다 — 이건 취향 카테고리로
// "politics"를 상위에 고른(토글은 안 켠) 유저에게 정치 카테고리 광고 후보가
// 만들어지는 것까지는 막지 못한다. 정치/종교/성인 카테고리는 광고 후보 생성
// 단계에서 원천 제외한다(요청 단위 토글과 무관하게 항상). taxonomy.js의
// CATEGORIES엔 "politics"가 실제 카테고리로 존재하고("religion"/"adult"는
// 카테고리로는 없지만 향후 확장 방어 차원에서 함께 배제) — 이 세 값을 가진
// 후보는 pickAffiliateCandidates가 어떤 소스(sample/실연동 productFeed)에서
// 나왔든 무조건 걸러낸다.
export const BANNED_AD_CATEGORIES = new Set(["politics", "religion", "adult"]);

// ---- hook copy: legal guardrail ---------------------------------------------
//
// 2026-07-25 "후킹 카피" 기능 — 광고 카드 헤드라인을 딱딱한 상품명이 아니라
// 커뮤니티 후기 말투의 후킹 문장으로 바꾼다(taste-feed 톤에 맞춤). David 승인
// 원칙: 위법(허위·과장광고)만 아니면 회색지대는 적극 활용한다.
//
// 카드는 이미 badgeLabel("AD"/"AD · 샘플", 2026-07-26 리디자인 이후 항상
// 렌더) + disclosure(쿠팡 법정 고지문, 배지 탭 시 팝오버로 항상 접근 가능,
// makeSlotItem 하단 참고) — "광고 명시"라는 합법 방패는 이 파일의 어떤
// 후킹 카피 로직도 제거/약화하지 않는다.
//
// 후킹 카피에 허용:
//   - 제품 실제 특징·장점 어필 (features 배열에 있는, 상품명/스펙에서 실제로
//     확인되는 속성만)
//   - 커뮤니티 캐주얼 말투 ("~하는 그거", "이거 하나면 끝" 등)
//   - 상황 제안 ("출장러 필수템", "여름 필수템")
//   - 관심 유발 ("요즘 화제인 이유") — 단, "몇 명이 샀다/후기가 몇 개다" 같은
//     구체적 수치를 붙이면 안 됨(아래 금지 항목 3번)
//
// 후킹 카피에 금지 (허위광고/과장광고 표시법 위반 소지):
//   1. 검증 가능한 구체적 허위 수치 — 예: "3개월 써보니 배터리 20%도 안 줆"
//      처럼 실사용 기간·정량 변화를 단정하는 문구. 상품 스펙표에 있는 정적
//      수치(예: "20000mAh", "65W", "0.01g")는 허용(사실이므로), 사용 후
//      경과/변화를 지어내는 수치는 금지.
//   2. 근거 없는 최상급 — "업계 1위", "최저가", "무조건", "100% 보장" 등
//      비교/보증을 사실 확인 없이 단정하는 표현.
//   3. 가짜 리뷰/구매자수 — "OOO명이 구매했어요", "후기 4.9점" 등 실측하지
//      않은 사회적 증거를 지어내는 표현.
//
// hasBannedHookClaim()은 위 2·3번 패턴(정량화 가능한 금지 표현)을 정규식으로
// 걸러내는 방어선이다 — 카피라이팅 판단(1번, "실제로 확인되지 않은 변화 수치를
// 단정했는가")까지 정규식으로 완전히 잡아낼 수는 없으므로, 이건 테스트에서
// SAMPLE_PRODUCT_TEMPLATES/buildHookCopy 출력을 검증하는 최종 방어선이지 유일한
// 방어선이 아니다 — 새 템플릿을 추가하는 사람이 위 원칙을 직접 지켜야 한다.
const BANNED_HOOK_PATTERNS = [
  /업계\s*1위/, // 근거 없는 최상급
  /판매\s*1위/,
  /최저가/,
  /무조건/,
  /100%\s*(보장|확실|만족)/,
  /보장(합니다|돼요|됩니다|해요)/,
  /\d+(\.\d+)?%\s*(덜|줄어|감소|늘어|증가)/, // 검증 불가능한 사용 후 변화 수치
  /\d+\s*(명|개)\s*(이|가)?\s*(구매|판매|주문|샀)/, // 가짜 구매자수
  /후기\s*\d+(\.\d+)?\s*점/, // 가짜 평점
  /리뷰\s*\d+/ // 가짜 리뷰 개수
];

export function hasBannedHookClaim(text) {
  if (!text) return false;
  return BANNED_HOOK_PATTERNS.some((re) => re.test(text));
}

// 커뮤니티 후기톤 폴백 문구 빌더 — 상품별 명시적 `hook`이 없을 때만 쓰인다.
// name/category(+features[0])만으로 결정론적으로(같은 입력 → 항상 같은 출력)
// 하나를 고른다(테스트 가능성 유지, Math.random 미사용). "feature"는 항상
// 호출자가 실제 상품 스펙/제목에서 뽑아 넘긴 값이어야 한다 — 이 함수 자체는
// feature를 지어내지 않는다.
const FALLBACK_HOOK_BUILDERS = [
  ({ name, feature }) => `${feature} 하나는 확실한 ${name}`,
  ({ name, feature }) => `${feature} 챙기려면 눈에 띄는 ${name}`,
  ({ name, feature }) => `요즘 ${feature} 좋다고 화제인 ${name}`,
  ({ name, feature, catLabel }) => `${catLabel} 취향이면 ${feature} 보고 눈이 가는 ${name}`
];

function hookTemplateIndex(key, n) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % n;
}

// 특징 태그 → 후킹 문구. `product.hook`이 있으면(상품별로 직접 쓴 커뮤톤
// 헤드라인) 그걸 그대로 우선 사용한다 — 폴백 규칙보다 사람이 쓴 카피가 항상
// 더 자연스럽기 때문. 없을 때만 category+topFeature 조합으로 생성한다.
//
// 실연동(`opts.productFeed`) 확장 경로: 실제 상품의 `title`/`attributes`에서
// feature 문자열을 추출해 `{ category, name, features }`로 넘기면 이 함수가
// 동일하게 폴백 헤드라인을 만들어준다 — 이 함수는 카테고리/상품명에 의존할 뿐
// 샘플 전용 로직이 없다. LLM 기반 카피 생성(상품 설명 전체를 요약해 더 자연스러운
// 후킹 문장을 만드는 것)은 API 키·비용이 필요한 향후 업그레이드 대상으로 남겨둔다
// — 지금은 규칙 기반 폴백으로 충분한 품질을 낸다.
export function buildHookCopy(product = {}) {
  const { category, name, features = [], hook = null } = product;
  if (hook) return hook;
  if (!name) return null;
  const catLabel = categoryLabel(category) || "이 카테고리";
  const feature = features && features[0] ? features[0] : null;
  if (!feature) return `${catLabel} 취향이면 한 번쯤 보게 되는 ${name}`;
  const idx = hookTemplateIndex(`${category || ""}:${name}`, FALLBACK_HOOK_BUILDERS.length);
  return FALLBACK_HOOK_BUILDERS[idx]({ name, feature, catLabel });
}

export function adParams(opts = {}) {
  return {
    every: opts.every ?? envNum("AD_EVERY", AD_EVERY_DEFAULT),
    skipFirst: opts.skipFirst ?? envNum("AD_SKIP_FIRST", AD_SKIP_FIRST_DEFAULT),
    maxPerPage: opts.maxPerPage ?? envNum("AD_MAX_PER_PAGE", AD_MAX_PER_PAGE_DEFAULT),
    maxPerSession: opts.maxPerSession ?? envNum("AD_MAX_PER_SESSION", AD_MAX_PER_SESSION_DEFAULT),
    minRelevance: opts.minRelevance ?? envNum("AD_MIN_RELEVANCE", AD_MIN_RELEVANCE_DEFAULT)
  };
}

// ---- slot placement engine -------------------------------------------------

// Insert monetization slots into a page of already-ranked, already-decorated
// organic feed items. Pure function — no I/O, no env reads beyond the plain
// numeric knobs resolved by the caller into `opts` (adParams already does
// that resolution; tests can bypass it entirely by passing exact numbers).
//
// `items`: this page's organic items, in final display order.
// `candidates`: slot-item objects for THIS request, best-first, each already
//   shaped like a feed item and carrying a numeric `.relevance` in [0,1] (see
//   makeSlotItem/pickAffiliateCandidates below). Building candidates is a
//   separate concern on purpose — this function never touches user
//   preferences, env credentials, or the sample/live split, which keeps it
//   trivially unit-testable.
// `opts.startIndex`: how many organic items this user has already been shown
//   in the session (== the request's `cursor`). Slot placement is anchored to
//   this *global* position, not the page's local index, so first-screen
//   protection and the N-per-slot cadence hold seamlessly across pagination
//   rather than resetting every page.
//
// Returns `{ items, slots }`. `items` is organic+slot items interleaved in
// display order (length == items.length + slots.length). `slots` is placement
// metadata (position in the output array, global position, candidate id,
// relevance) for logging/testing — callers stamp additional fields (e.g. A/B
// variant) onto it as needed.
export function injectSlots(items, candidates, opts = {}) {
  const { every, skipFirst, maxPerPage, minRelevance } = adParams(opts);
  const startIndex = Math.max(0, opts.startIndex ?? 0);

  const out = items.slice();
  const slots = [];

  if (every <= 0 || maxPerPage <= 0) return { items: out, slots };

  const pool = (candidates || []).filter((c) => (c.relevance ?? 0) >= minRelevance);
  if (!pool.length) return { items: out, slots }; // nothing clears relevance — every due slot stays empty

  const built = [];
  // 로테이션 순서는 그대로 두되, 이웃이 딜 글이면 **그 상품군 후보를 먼저**
  // 집는다. 슬롯은 items[i] **앞**에 들어가므로 위·아래 둘 다 이웃이다.
  // 못 찾으면 원래 순서대로 집는다 — 억지로 맞추지 않는다(David 2026-08-05
  // "내용글과 직접 연관 있는 카테고리나 상품으로").
  const used = new Set();
  const take = (wantDest) => {
    if (wantDest) {
      for (let k = 0; k < pool.length; k++) {
        if (!used.has(k) && pool[k].dest === wantDest) { used.add(k); return pool[k]; }
      }
    }
    for (let k = 0; k < pool.length; k++) if (!used.has(k)) { used.add(k); return pool[k]; }
    return null;
  };
  // 자리가 됐는데 두세 칸 뒤에 딜 글이 있으면 **그 아래까지 기다린다.**
  //
  // 왜: 딜 옆 광고를 매 N칸 규칙에 맡기면 붙는 건 우연이다 — 실측
  // (2026-08-05 라이브 126칸): 딜 10건, 광고 6건이었는데 서로 이웃한 경우가
  // 0건이었다. 광고 개수는 그대로 두고 **자리만 옮기는** 것이라 광고가
  // 늘지 않는다. 기다림은 3칸까지만 — 그 이상 밀면 원래 밀도가 무너진다.
  const DEAL_WAIT = 3;
  let due = false;
  items.forEach((item, i) => {
    const globalPos = startIndex + i; // this organic item's position in the whole session, ads excluded
    if (globalPos >= skipFirst && (globalPos - skipFirst) % every === 0) due = true;
    // 이 글 **옆에** 광고를 붙여도 되는가 (promotion.adUnsafe).
    // 성인·정치/종교·비속어가 붙은 글 바로 옆의 광고는 광고주 브랜드 안전
    // 문제이고, 애드센스·애드핏 양쪽이 문제 삼는 지점이다. 글은 그대로 두고
    // 광고만 다음 자리로 미룬다 — 콘텐츠를 지우지 않는다.
    // 슬롯은 items[i] **앞**에 들어가므로 실제 이웃은 items[i-1]과 items[i]다.
    // 예전엔 items[i]와 items[i+1]을 봤다 — 자리가 고정일 때는 티가 안 났지만,
    // 자리가 밀릴 수 있게 되자 정치 글 **바로 아래**에 광고가 붙었다
    // (2026-08-05 analytics 테스트가 잡음).
    const neighborUnsafe = adUnsafe(items[i - 1]) || adUnsafe(item);
    if (due && !neighborUnsafe && slots.length < maxPerPage && used.size < pool.length) {
      // 슬롯은 items[i] **앞**에 들어간다. 그래서 "딜 바로 아래"가 되려면
      // 바로 윗칸(items[i-1])이 딜이어야 한다.
      const above = items[i - 1] && (items[i - 1].dealDest || items[i - 1].adDest) || null;
      let waitForDeal = false;
      if (!above) {
        for (let k = i; k < Math.min(items.length, i + DEAL_WAIT); k++) {
          if (items[k] && items[k].dealDest) { waitForDeal = true; break; }
        }
      }
      if (!waitForDeal) {
        const candidate = take(above || item.dealDest || item.adDest || null);
        if (candidate) {
          built.push(candidate);
          slots.push({ position: built.length - 1, globalPos, id: candidate.id, relevance: candidate.relevance });
          due = false;
        }
      }
    }
    built.push(item);
  });

  return { items: built, slots };
}

// ---- adaptive density -------------------------------------------------------

// Turn a user's observed ad click-through history into a ratio against a
// reference CTR: >1 = more responsive than baseline, <1 = less. Returns null
// when there isn't enough data yet ("신호 부족 시 기본값") — the caller must
// then leave `every` at its configured default rather than guessing.
export function adResponsivenessRatio(clicks, impressions, opts = {}) {
  const minSample = opts.minSample ?? 5;
  if (!impressions || impressions < minSample) return null;
  const ctr = clicks / impressions;
  const baseline = opts.baselineCtr ?? Number(process.env.AD_BASELINE_CTR || AD_BASELINE_CTR_DEFAULT);
  return baseline > 0 ? ctr / baseline : null;
}

// Nudge the base cadence by responsiveness: higher CTR ratio -> smaller
// `every` (denser slots), lower ratio -> larger `every` (sparser). `ratio ==
// null` (no signal yet) is a no-op — returns baseEvery unchanged, the
// documented "신호 부족 시 기본값" behavior.
export function adaptiveEvery(baseEvery, ratio, opts = {}) {
  if (ratio == null || !Number.isFinite(baseEvery) || baseEvery <= 0) return baseEvery;
  const sensitivity = opts.sensitivity ?? AD_RESPONSIVENESS_SENSITIVITY_DEFAULT;
  const r = clamp(ratio, 0.2, 3);
  const factor = clamp(1 / (1 + sensitivity * (r - 1)), 0.5, 1.8);
  const every = Math.round(baseEvery * factor);
  return clamp(every, opts.min ?? AD_EVERY_MIN, opts.max ?? AD_EVERY_MAX);
}

// ---- A/B assignment ---------------------------------------------------------

// Deterministic per-user bucket (no server-side session state needed — same
// userId always maps to the same variant). Only active when AD_AB=1 (or
// opts.enabled); otherwise everyone is "A" (today's single-variant behavior).
export function assignVariant(userId, opts = {}) {
  const enabled = opts.enabled ?? Boolean(process.env.AD_AB);
  if (!enabled || !userId) return "A";
  let h = 2166136261 >>> 0;
  const key = String(userId);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 2 === 0 ? "A" : "B";
}

// Frequency/placement variants. B tests a denser cadence with slightly more
// first-screen grace, to see whether it moves the click-count proxy without
// moving the retention guardrail (docs/monetization.md Success Metrics).
export const AD_VARIANTS = {
  A: { everyMultiplier: 1, skipFirstDelta: 0 },
  B: { everyMultiplier: 0.75, skipFirstDelta: 1 }
};

export function applyVariant(params, variant) {
  const v = AD_VARIANTS[variant] || AD_VARIANTS.A;
  return {
    ...params,
    every: Math.max(AD_EVERY_MIN, Math.round(params.every * v.everyMultiplier)),
    skipFirst: params.skipFirst + v.skipFirstDelta
  };
}

// ---- narrow (source=) view density -----------------------------------------

// 라운드1 검수 #8: 특정 소스/게시판 뷰는 니치라 같은 every라도 체감 빈도가
// 높다 — every를 늘려(성글게) 완화한다. isNarrow=false면 no-op(홈 피드는
// 영향받지 않음).
export function applyNarrowSourceDensity(params, isNarrow, opts = {}) {
  if (!isNarrow) return params;
  const mult = opts.mult ?? envNum("AD_NARROW_EVERY_MULT", AD_NARROW_EVERY_MULT_DEFAULT);
  return { ...params, every: clamp(Math.round(params.every * mult), AD_EVERY_MIN, AD_EVERY_MAX) };
}

// ---- slot item shape ---------------------------------------------------------

// Shape a slot candidate to match the fields the client's card renderer
// already expects from a decorated organic item (see engine.js's _decorate
// and public/index.html's appendCard), plus the monetization-only fields the
// UI needs for the badge/price/disclosure. `relevance` is REQUIRED — every
// caller must state, numerically, why this candidate is being offered to
// this user, so injectSlots' gating has something real to filter on.
export function makeSlotItem({
  id,
  kind = "affiliate",
  category,
  title,
  // 후킹 카피(커뮤 후기톤 헤드라인). 있으면 title보다 우선해서 카드 h3에
  // 렌더된다(index.html appendAdCard) — title은 hook이 없는 호출자를 위한
  // 하위호환 폴백일 뿐, 실제 헤드라인 자리는 항상 hook이 이긴다.
  hook = null,
  // 실제 상품명 — 정직성 방어선: 후킹 헤드라인 아래 보조 라인으로 항상 노출돼
  // "이게 무슨 상품인지"를 유저가 알 수 있게 한다(index.html adProductNameHtml).
  productName = null,
  summary,
  url,
  image = null,
  source = "coupang",
  sourceLabel = "쿠팡파트너스",
  priceOriginal = null,
  priceSale = null,
  // 하단 지표 행(index.html adMetaHtml)용 — **실측 데이터만**. productFeed 연동 시
  // 쿠팡이 주는 실제 평점/리뷰수/베스트여부를 채우고, 샘플은 채우지 않는다(가짜
  // 순위·급상승·추천수는 허위광고라 금지). null이면 카드 하단 행 자체가 생략된다.
  rating = null,
  reviewCount = null,
  bestseller = false,
  sample = false,
  // 쿠팡 도착지(fresh·dgt·fashion…). 딜 글 옆에 그 상품군 배너를 고를 때 쓴다 —
  // 후보가 도착지를 들고 있지 않으면 맞출 방법 자체가 없다(2026-08-05).
  dest = null,
  relevance,
  reason,
  sampleNote = null
}) {
  // 헤드라인 우선순위: 명시적 hook > 호출자가 넘긴 title > 상품명 자체.
  // 셋 다 없으면 빈 문자열(호출자 버그를 여기서 숨기지 않음).
  const headline = hook || title || productName || "";
  return {
    id,
    kind, // "affiliate" (P0, this file) | "ad" (P1 CPC network — reserved, not wired yet)
    via: "ad",
    source,
    sourceLabel,
    category,
    categoryLabel: categoryLabel(category),
    tags: [],
    title: headline,
    hook: hook || null,
    productName: productName || null,
    summary,
    url,
    image,
    topics: [],
    lang: "ko",
    translated: false,
    needsTranslation: false,
    score: 0,
    commentCount: 0,
    publishedAt: null,
    dest: dest || null,
    matchScore: Math.round((relevance ?? 0) * 100) / 100,
    reasons: reason ? [reason] : [],
    myRating: 0,
    saved: false,
    comments: 0,
    // 하단 지표 — 실측만(productFeed 제공 시), 샘플은 null이라 카드에서 생략됨
    rating: typeof rating === "number" ? rating : null,
    reviewCount: typeof reviewCount === "number" ? reviewCount : null,
    bestseller: Boolean(bestseller),
    sponsored: true,
    sample: Boolean(sample),
    // 2026-07-26 리디자인: "[샘플]" 고지는 이제 productName 보조 라인
    // (index.html adProductNameHtml)이 전담한다 — 이 필드는 하위호환을 위해
    // 계속 채워 두지만(sample=true면 여전히 non-null) index.html은 더 이상
    // 렌더하지 않는다(가격 블록 자체를 상시 노출에서 뺐다, 아래 priceOriginal/
    // priceSale 주석 참고).
    sampleNote: sample ? (sampleNote || "[샘플] 실제 판매 상품 아님") : null,
    // 2026-07-26 리디자인(docs/monetization.md "AD 배지 최소화") — David
    // 최종지시: 가격/할인율의 "상시 노출"을 제거해 카드가 커뮤 게시글처럼
    // 자연스럽게 보이게 한다. 필드 자체는 실연동(productFeed) 대비 계속
    // 채워 두지만(장래 UI가 다시 쓸 수 있게), index.html은 더 이상 렌더하지
    // 않는다 — adPriceHtml/.ad-price는 제거됐다.
    priceOriginal,
    priceSale,
    // disclosure(법정 고지 전문)는 이제 상시 렌더가 아니라 배지 탭 시 뜨는
    // 팝오버 전용 데이터다(index.html appendAdCard). disclosureShort(축약
    // 고지)는 하위호환을 위해 필드는 유지하되 UI에서는 미사용 — "광고 명시"
    // 라는 법적 방패는 배지(badgeLabel, 항상 렌더) + 이 disclosure(탭하면
    // 항상 접근 가능)로 충족되므로 상시 노출 텍스트 두 줄이 굳이 필요 없다.
    disclosure: DISCLOSURE_TEXT,
    disclosureShort: DISCLOSURE_SHORT_TEXT,
    // 2026-07-26 리디자인: "제휴광고"(긴 라벨)에서 "AD"(짧은 라벨)로 축소.
    // 24개 네이티브광고 리서치 결론(짧은 라벨 + 위장 금지) + David 최종지시
    // — 배지 문구는 절대 "추천/카테고리" 등으로 위장하지 않는다(기사형광고
    // 규제선). 짧아졌어도 "AD"는 광고라는 뜻이 명확해 표시광고법상 고지
    // 요건(인지 가능)을 그대로 충족한다.
    badgeLabel: sample ? "AD · 샘플" : "AD",
    relevance: relevance ?? 0
  };
}

// ---- candidate sourcing -------------------------------------------------------

// Entry point engine.js calls. Production behavior (no COUPANG_PARTNER_ID and
// no AD_PREVIEW): returns [] unconditionally — no live product feed
// integration is wired into this project yet (docs/monetization.md Open
// Questions — 쿠팡파트너스 약관 원문 확인이 David 확인 대기), so a bare
// credential with nothing behind it must not fabricate cards either. Only
// AD_PREVIEW=1 (dev/reviewer-only, isolated the same way FEED_DEV/seed-data.js
// is) generates clearly-labeled [샘플] cards for UX/persona review.
//
// opts.productFeed acceptance criteria (라운드1 검수 #10, docs/monetization.md
// "구현 상세" 참고): a real productFeed(preferences, opts) implementation
// MUST return items whose `title` links to the exact product detail URL (never
// a category/search page) and whose `priceOriginal` is a verified, recently
// observed list price (never a fabricated/stale "정가") — the same anti-dummy
// bar this file already holds `sampleAffiliateCandidates` to. 2026-07-25
// 라운드2 검수 #1 추가 acceptance: a candidate's `reason`/matching claim MUST
// only name the category it was ACTUALLY matched against — never fall back to
// a different category's inventory while still claiming the user's original
// (unmatched) category in the copy. If productFeed has no real inventory for
// a user's top category, it must omit that slot, not backfill from an
// unrelated category and mislabel it. politics/religion/adult are additionally
// hard-excluded below regardless of what productFeed returns (라운드2 검수 #2).
// 카테고리 배너를 슬롯 후보로. 가격·상품명·평점을 만들지 않는다 — 배너가
// 여는 곳(dest)을 문구로 정확히 예고하기만 한다.
//
// 관련성: 취향 벡터에 그 카테고리가 있으면 그 가중치를, 없으면 바닥값을 준다.
// 바닥값이 필요한 이유는 우리 방문자 대부분이 익명이라 취향 벡터가 비어 있고,
// 그러면 minRelevance 게이트에 전부 걸려 또 광고가 0이 되기 때문이다.
// 취향이 있는 사람에겐 맞는 배너가 먼저 가고, 없는 사람에겐 골고루 돈다.
const BANNER_BASE_RELEVANCE = 0.35;
export function bannerCandidates(preferences, opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const excludeIds = opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds || []);
  const banners = (opts.banners || loadBanners()).filter((b) => !BANNED_AD_CATEGORIES.has(b.category));
  if (!banners.length) return [];

  const weights = new Map(topPreferences(preferences, 6).categories.map((c) => [c.id, c.weight]));
  const scored = banners.map((b, i) => {
    const w = weights.get(b.category);
    const relevance = w != null ? clamp(w / 6, BANNER_BASE_RELEVANCE, 1) : BANNER_BASE_RELEVANCE;
    return { b, i, relevance };
  });
  // 최근 본 배너는 뒤로 민다(제외가 아니라 강등 — 재고가 32개뿐이라 제외하면
  // 금방 후보가 비어 광고가 다시 0이 된다).
  scored.sort((a, b) => {
    const sa = excludeIds.has(a.b.id) ? -1 : 0, sb = excludeIds.has(b.b.id) ? -1 : 0;
    if (sa !== sb) return sb - sa;
    if (a.relevance !== b.relevance) return b.relevance - a.relevance;
    return ((a.i + seed) % scored.length) - ((b.i + seed) % scored.length);
  });

  // 후보를 6개만 넘기면 **문맥 매칭이 사실상 안 된다.** 재고 18개 중 6개만
  // 손에 들고 있으니, 옆 글이 "신선식품"을 원해도 그 배너가 후보에 없다 —
  // 실측(2026-08-06 라이브): 광고 18건 중 문맥 이웃이 6건이었는데 도착지
  // 일치는 0건이었다. 슬롯은 페이지당 1~2개뿐이라 후보를 넉넉히 들고 있어도
  // 비용은 없고, 못 고르면 어차피 순서대로 집는다.
  return scored.slice(0, 14).map(({ b, relevance }) => {
    const [hook, brand] = adCopy(b.dest || "_");
    return makeSlotItem({
      id: b.id,
      category: b.category,
      dest: b.dest || null,
      hook,
      // productName 자리에 도착지 이름을 넣는다 — 카드에 "어디로 가는지"가
      // 항상 보여야 한다(2026-08-03 문구≠도착지 사고의 재발 방지).
      productName: brand,
      summary: brand,
      url: b.href,
      image: b.img,
      relevance,
      reason: null
    });
  });
}

export function pickAffiliateCandidates(preferences, opts = {}) {
  const partnerId = opts.partnerId ?? process.env.COUPANG_PARTNER_ID ?? null;
  const preview = opts.preview ?? Boolean(process.env.AD_PREVIEW);

  let candidates;
  if (partnerId && opts.productFeed) candidates = opts.productFeed(preferences, opts) || [];
  // ── 상품 피드가 없을 때: 실제 카테고리 배너로 채운다 (2026-08-04) ────────
  //
  // 그동안 여기서 곧바로 빈 배열을 돌려줬다. 그 결과 **서비스 시작 이래 피드
  // 광고 노출이 0건**이었다(실측: 라이브 응답 30건 중 광고 카드 0). 쿠팡
  // Open API 키(ACCESS_KEY/SECRET)가 서버에 없어서 opts.productFeed가 null인데,
  // 그 상태를 "광고를 아예 안 낸다"로 처리한 탓이다.
  //
  // 하지만 "자격증명 없으면 광고 금지"의 진짜 취지는 **가짜 상품 카드 금지**다
  // (없는 가격·재고를 지어내지 말라는 것). 카테고리 배너는 우리가 파트너스에서
  // 직접 받아 products.json에 넣어 둔 **실제 링크**이고, 가격도 상품명도 쓰지
  // 않는다 — 발행 페이지가 이미 같은 배너를 쓰고 있다. 지어내는 게 없으므로
  // 그 원칙에 걸리지 않는다.
  //
  // 상품 단위 카드는 Open API 키가 배포되면 위 분기가 알아서 가져간다.
  else if (partnerId) candidates = bannerCandidates(preferences, opts);
  else if (!preview) return []; // 파트너 ID조차 없으면 광고 자체가 없다
  else candidates = sampleAffiliateCandidates(preferences, opts);

  // 라운드2 검수 #2 (치명, "정치 게이트 갭"): 토글 상태와 무관하게, 정치/종교/
  // 성인 카테고리 후보는 이 시점에서 항상 걸러낸다 — sample/실연동 productFeed
  // 어느 경로로 왔든 동일하게 적용되는 단일 체크포인트.
  return candidates.filter((c) => !BANNED_AD_CATEGORIES.has(c.category));
}

// Plausible product ideas per category, so a preview card at least looks like
// it belongs in that category's feed. Never a real listing — every title is
// prefixed "[샘플]" by sampleAffiliateCandidates, and the url always points at
// the bare coupang.com homepage, never a fabricated product page. No
// review-count/timer fields anywhere here — this file's no-dark-patterns rule
// applies just as much to a preview sample as to a live card.
//
// 2026-07-25 라운드1 검수 #1: 카테고리당 2개뿐이면 로테이션 폭이 너무 좁아
// (특히 유저별 노출 이력 제외 로직과 맞물릴 때) 금방 다시 반복된다 — 3개로
// 늘렸다.
// 각 항목의 `hook`은 사람이 직접 쓴 커뮤니티 후기톤 헤드라인이다(위 "hook copy:
// legal guardrail" 주석의 허용/금지 원칙을 지킨 문구만 여기 들어간다 — 검증
// 불가능한 사용 후 변화 수치·근거 없는 최상급·가짜 리뷰/구매자수 금지, 정적
// 스펙(mAh/W/L 등 상품명 자체에 있는 숫자)은 사실이므로 허용). `features`는
// 실연동 productFeed가 실제 상품 title/attributes에서 뽑아 넣을 값의 자리를
// 미리 잡아둔 것 — buildHookCopy의 폴백 경로가 이 배열의 첫 값을 topFeature로
// 쓴다.
const SAMPLE_PRODUCT_TEMPLATES = {
  tech: [
    {
      name: "무선 노이즈캔슬링 이어버드",
      priceOriginal: 89000,
      priceSale: 52900,
      features: ["노이즈캔슬링", "장시간 배터리", "통화음질"],
      hook: "지하철 소음 싹 사라지는 그 이어버드"
    },
    {
      name: "65W 초고속 멀티 충전기",
      priceOriginal: 39900,
      priceSale: 24900,
      features: ["멀티포트", "초고속충전", "슬림"],
      hook: "노트북까지 이거 하나로 다 충전됨 (멀티포트 65W)"
    },
    {
      name: "보조배터리 (20000mAh 고속충전)",
      priceOriginal: 49900,
      priceSale: 32900,
      features: ["고속충전", "대용량", "휴대성"],
      hook: "출장·여행 짐 확 줄여주는 20000mAh, 이거 하나면 끝"
    }
  ],
  auto: [
    {
      name: "차량용 블랙박스 (전후방 4K)",
      priceOriginal: 219000,
      priceSale: 159000,
      features: ["전후방 4K", "야간화질", "주차녹화"],
      hook: "밤길 사고나도 걱정 덜어주는 전후방 4K 블랙박스"
    },
    {
      name: "트렁크 정리함 + 방수 매트 세트",
      priceOriginal: 45000,
      priceSale: 29900,
      features: ["방수", "정리", "세트구성"],
      hook: "트렁크 안이 순식간에 정리되는 방수 세트"
    },
    {
      name: "차량용 무선청소기",
      priceOriginal: 69000,
      priceSale: 45900,
      features: ["무선", "강력흡입", "휴대성"],
      hook: "세차장 갈 일이 줄어드는, 차 안에 두고 쓰는 무선청소기"
    }
  ],
  science: [
    {
      name: "천체망원경 입문용 세트",
      priceOriginal: 129000,
      priceSale: 89000,
      features: ["입문용", "가벼움", "조립간편"],
      hook: "베란다에서 별 보는 재미 알게 해준 입문용 망원경"
    },
    {
      name: "실험용 정밀 저울 (0.01g)",
      priceOriginal: 32000,
      priceSale: 22900,
      features: ["정밀측정", "0.01g 단위", "소형"],
      hook: "0.01g까지 잡아내는 정밀 저울, 취미 계량도 이 정도는 돼야죠"
    },
    {
      name: "휴대용 현미경 키트",
      priceOriginal: 45000,
      priceSale: 31900,
      features: ["휴대용", "확대배율", "키트구성"],
      hook: "아이 자유탐구 준비물 고민 끝내주는 휴대용 현미경 키트"
    }
  ],
  business: [
    {
      name: "듀얼 모니터암 (가스식)",
      priceOriginal: 69000,
      priceSale: 44900,
      features: ["가스식", "각도조절", "책상정리"],
      hook: "책상 위가 넓어지는 마법, 가스식 듀얼 모니터암"
    },
    {
      name: "인체공학 무선 마우스",
      priceOriginal: 45000,
      priceSale: 29900,
      features: ["인체공학", "손목부담 완화 설계", "무선"],
      hook: "손목 부담 줄이려고 다들 바꾼다는 인체공학 무선 마우스"
    },
    {
      name: "휴대용 미니 프린터",
      priceOriginal: 89000,
      priceSale: 59900,
      features: ["휴대용", "무선연결", "소형"],
      hook: "회의실 어디든 들고 다니는 손바닥만한 프린터"
    }
  ],
  gaming: [
    {
      name: "기계식 게이밍 키보드 (저소음)",
      priceOriginal: 99000,
      priceSale: 65900,
      features: ["저소음", "기계식", "타건감"],
      hook: "밤에 게임해도 안 시끄러운 저소음 기계식 키보드"
    },
    {
      name: "게이밍 헤드셋 7.1 서라운드",
      priceOriginal: 79000,
      priceSale: 49900,
      features: ["7.1 서라운드", "발소리 방향감", "착용감"],
      hook: "적 발소리 방향이 다 들리는 7.1 서라운드 헤드셋"
    },
    {
      name: "게이밍 마우스패드 (대형)",
      priceOriginal: 29000,
      priceSale: 18900,
      features: ["대형", "미끄럼방지", "키보드까지 커버"],
      hook: "책상 전체를 덮는 대형 패드, 마우스 헛돎이 사라짐"
    }
  ],
  sports: [
    {
      name: "폼롤러 + 마사지건 세트",
      priceOriginal: 89000,
      priceSale: 59900,
      features: ["세트구성", "근막이완", "휴대용"],
      hook: "운동 다음날 뭉친 근육 풀 때 찾게 되는 폼롤러+마사지건 세트"
    },
    {
      name: "런닝화 (쿠셔닝 강화)",
      priceOriginal: 129000,
      priceSale: 79900,
      features: ["쿠셔닝 강화", "경량", "착화감"],
      hook: "무릎 부담 덜어주는 쿠셔닝, 러닝화 바꿀 때 되지 않았어요?"
    },
    {
      name: "요가매트 + 블록 세트",
      priceOriginal: 39000,
      priceSale: 25900,
      features: ["세트구성", "미끄럼방지", "휴대용"],
      hook: "집에서 요가 시작하기 딱 좋은 매트+블록 세트"
    }
  ],
  culture: [
    {
      name: "블루투스 스피커 (고음질)",
      priceOriginal: 79000,
      priceSale: 49900,
      features: ["고음질", "휴대용", "방수"],
      hook: "캠핑 갈 때 꼭 챙기게 되는 고음질 블루투스 스피커"
    },
    {
      name: "휴대용 빔프로젝터",
      priceOriginal: 159000,
      priceSale: 109000,
      features: ["휴대용", "무선연결", "자동초점"],
      hook: "거실 벽이 순식간에 영화관 되는 휴대용 빔프로젝터"
    },
    {
      name: "무선 마이크 세트",
      priceOriginal: 59000,
      priceSale: 39900,
      features: ["무선", "세트구성", "노이즈감소"],
      hook: "노래방 안 가도 되는 이유, 집에서 완성되는 무선 마이크 세트"
    }
  ],
  life: [
    {
      name: "에어프라이어 (5.5L 대용량)",
      priceOriginal: 99000,
      priceSale: 69900,
      features: ["대용량", "5.5L", "간편조리"],
      hook: "치킨 한 마리 통째 들어가는 5.5L, 밥할 맛 남"
    },
    {
      name: "극세사 이불 세트",
      priceOriginal: 59000,
      priceSale: 35900,
      features: ["극세사", "보온", "세트구성"],
      hook: "한 번 덮으면 다른 이불 못 쓰는 극세사 이불"
    },
    {
      name: "무선 핸디청소기",
      priceOriginal: 79000,
      priceSale: 52900,
      features: ["무선", "경량", "강력흡입"],
      hook: "차 안, 소파 틈까지 싹 빨아들이는 무선 핸디청소기"
    }
  ]
};

// Build candidates from this user's own top learned categories — the
// "취향벡터 상위 카테고리" match. Returns [] for a cold-start user with no
// learned preference yet (topPreferences only returns weight>0 entries), so
// injectSlots' relevance gate naturally empties every slot instead of this
// function guessing a generic pick — no forced fill for someone we know
// nothing about yet.
//
// 2026-07-25 라운드1 검수 #1 (치명, "같은 광고 무한 반복"): the previous
// `templates[(seed + i) % templates.length]` picked its index purely off
// `cursor` parity — a client paging with an even `limit` (e.g. 10) always saw
// `seed = cursor + 1` land on the same parity, so the same template repeated
// forever. Fixed two ways, per the review's own prescription:
//   1. `opts.seed` is now expected to come from a call counter that advances
//      once per request regardless of step size (engine.js's
//      `store.nextAdSeed`), not from `cursor` itself — so it changes on every
//      call, even/odd cursor steps alike.
//   2. `opts.excludeIds` (this user's recently-shown ad ids, from
//      store.adSeenIdsFor) lets the rotation skip forward past whatever this
//      user was just shown, so consecutive calls provably differ even if the
//      caller's seed happened to repeat.
//
// 2026-07-25 라운드2 검수 #1 (치명, "가짜 관련성 문구"): SAMPLE_PRODUCT_TEMPLATES는
// tech/auto/science/business/gaming/sports/culture/life 8개 카테고리만 커버한다.
// taxonomy.js의 CATEGORIES엔 news/humor/politics도 있는데, 이전 코드는 매칭
// 템플릿이 없으면 `SAMPLE_PRODUCT_TEMPLATES.life`로 "조용히" 폴백하면서도
// reason 문구엔 `categoryLabel(c.id)`(실제 카테고리, 예: "정치")를 그대로 박아
// "정치 관심사와 관련있어요"라 말하면서 실은 청소기(life 템플릿)를 보여주는
// 거짓 매칭 주장이 발생했다. 매칭 템플릿이 없는 카테고리는 이제 그 슬롯을
// 아예 비운다(관련성 게이팅 취지대로) — 실제 매칭된 카테고리에 대해서만
// reason이 쓰인다. politics/religion/adult는 라운드2 검수 #2(정치 게이트 갭)에
// 따라 pickAffiliateCandidates에서 한 번 더 걸러지지만, 애초에 템플릿이 없어
// 여기서도 자연히 제외된다.
//
// 2026-07-25 라운드2 검수 #3 (중대, "다중 카테고리 유저 → 항상 1위만"): 이전엔
// `top`(취향 상위 카테고리, weight 내림차순) 순서 그대로 injectSlots에 넘겼다
// — 한 페이지에 due 슬롯이 보통 1개뿐이라(기본 AD_EVERY=9) 매 호출마다
// pool[0](=1위 카테고리)만 뽑혀, 세션 전체에서 사실상 1위 카테고리만 노출됐다
// (tech/auto/gaming을 골라도 6슬롯이 전부 tech). `opts.seed`(engine.js가
// store.nextAdSeed로 매 호출 전진시키는 카운터, 템플릿 로테이션에 이미 쓰는
// 값)로 후보 배열의 시작 오프셋 자체를 회전시켜, 호출마다 어느 카테고리가
// pool[0]에 오는지 바뀌게 한다 — 세션에 걸쳐 top 카테고리들이 고르게
// 로테이션된다(같은 호출 안에 due 슬롯이 여러 개면 그 안에서도 서로 다른
// 카테고리가 순서대로 소비된다).
export function sampleAffiliateCandidates(preferences, opts = {}) {
  const top = topPreferences(preferences, 3).categories;
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const excludeIds = opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds || []);

  // only categories with a real, matched template — never a silent fallback
  // to a different category's inventory (라운드2 검수 #1), and never a
  // politics/religion/adult candidate regardless of template availability
  // (라운드2 검수 #2, defense-in-depth alongside pickAffiliateCandidates).
  const eligible = top.filter((c) => SAMPLE_PRODUCT_TEMPLATES[c.id] && !BANNED_AD_CATEGORIES.has(c.id));
  if (!eligible.length) return [];

  // rotate the starting category so consecutive calls (each typically
  // producing just 1 due slot) don't all pick the same top-weighted category
  // (라운드2 검수 #3).
  const catN = eligible.length;
  const catOffset = ((seed % catN) + catN) % catN;
  const rotated = eligible.map((_, i) => eligible[(i + catOffset) % catN]);

  return rotated.map((c, i) => {
    const templates = SAMPLE_PRODUCT_TEMPLATES[c.id];
    const n = templates.length;
    let idx = (((seed + i) % n) + n) % n; // normalize: seed can be any integer
    // rotate forward past anything this user was already shown recently
    // (bounded to `n` tries so a fully-exhausted window still returns *a*
    // candidate rather than nothing — the relevance gate stays the only hard
    // empty-slot condition).
    for (let tries = 0; tries < n && excludeIds.has(`ad_sample_${c.id}_${idx}`); tries++) {
      idx = (idx + 1) % n;
    }
    const t = templates[idx];
    // c.weight is on the recommender's WEIGHT_CLAMP=6 scale (recommender.js) —
    // reuse that ceiling so relevance lands on the same [0,1] scale injectSlots
    // gates against, without inventing a second scoring formula.
    const relevance = clamp(c.weight / 6, 0, 1);
    // 라운드1 검수 #11: 관련성 수치를 UI에 그대로 노출하진 않되(과설계 방지),
    // 매칭 강도에 따라 문구 톤만 가볍게 차등한다. c.id는 항상 이 템플릿이
    // 실제로 속한 카테고리이므로(폴백 없음, 라운드2 검수 #1) 거짓 매칭
    // 주장이 될 수 없다.
    const reason = relevance >= 0.6
      ? `${categoryLabel(c.id)} 관심사와 잘 맞아요`
      : `${categoryLabel(c.id)} 관심사와 관련있어요`;
    return makeSlotItem({
      id: `ad_sample_${c.id}_${idx}`,
      category: c.id,
      // 후킹 카피: 상품별로 직접 쓴 커뮤톤 헤드라인(t.hook)이 있으면 그대로,
      // 없으면 buildHookCopy가 category+topFeature로 폴백 생성한다. 실제
      // 헤드라인 자리는 hook이 채우고(makeSlotItem), 딱딱한 상품명은
      // productName으로 따로 넘겨 헤드라인 아래 보조 라인에 노출한다(정직성
      // 방어선 — 유저가 실제 상품이 뭔지 알 수 있게).
      hook: buildHookCopy({ category: c.id, name: t.name, features: t.features, hook: t.hook }),
      productName: t.name,
      // 라운드2 검수 #7(경미): "검수용 샘플·실제 판매 아님" 고지는 summary가
      // 아니라 makeSlotItem의 sampleNote로 분리해 가격/배지 근처에 렌더한다
      // (index.html) — summary만 훑고 지나가는 유저도 놓치지 않게.
      summary: `${categoryLabel(c.id)} 취향에 맞춰 골라본 상품이에요`,
      url: "https://www.coupang.com/",
      priceOriginal: t.priceOriginal,
      priceSale: t.priceSale,
      sample: true,
      relevance,
      reason
    });
  });
}
