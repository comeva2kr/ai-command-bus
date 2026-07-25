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
//     visually jar the feed, but every slot carries an unmissable badge +
//     the Coupang-mandated disclosure line — never a naked look-alike ad.
//   - First-screen protection: the first `skipFirst` items a session sees
//     are always 100% organic, so first impression = trust, not a sales
//     pitch.
//   - Anchoring: sample cards carry both list price and "sale" price when
//     they have one — this file never invents a discount if it has no real
//     price pair to show.
//   - No dark patterns: no countdown timers, no fabricated "N명이 구매중"
//     counters, no auto-navigate-on-load. A slot is inert until tapped, same
//     as every organic card.
//   - Relevance gating over forced fill: a slot with no candidate clearing
//     `minRelevance` is left EMPTY, not backfilled with an irrelevant pick —
//     an irrelevant ad reads as spam and erodes trust faster than a missed
//     impression costs revenue.

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
const BANNED_AD_CATEGORIES = new Set(["politics", "religion", "adult"]);

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
  let poolIdx = 0;
  items.forEach((item, i) => {
    const globalPos = startIndex + i; // this organic item's position in the whole session, ads excluded
    const dueForSlot =
      globalPos >= skipFirst &&
      (globalPos - skipFirst) % every === 0 &&
      slots.length < maxPerPage;
    if (dueForSlot && poolIdx < pool.length) {
      const candidate = pool[poolIdx++];
      built.push(candidate);
      slots.push({ position: built.length - 1, globalPos, id: candidate.id, relevance: candidate.relevance });
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
  summary,
  url,
  image = null,
  source = "coupang",
  sourceLabel = "쿠팡파트너스",
  priceOriginal = null,
  priceSale = null,
  sample = false,
  relevance,
  reason,
  sampleNote = null
}) {
  return {
    id,
    kind, // "affiliate" (P0, this file) | "ad" (P1 CPC network — reserved, not wired yet)
    via: "ad",
    source,
    sourceLabel,
    category,
    categoryLabel: categoryLabel(category),
    tags: [],
    title,
    summary,
    url,
    image,
    adult: false,
    topics: [],
    lang: "ko",
    translated: false,
    needsTranslation: false,
    score: 0,
    commentCount: 0,
    publishedAt: null,
    matchScore: Math.round((relevance ?? 0) * 100) / 100,
    reasons: reason ? [reason] : [],
    myRating: 0,
    saved: false,
    comments: 0,
    sponsored: true,
    sample: Boolean(sample),
    // 2026-07-25 라운드2 검수 #7(경미): "[샘플]·실제 판매 아님" 고지가 summary
    // 문자열 속에 묻혀 있으면 (a) .card p가 2줄로 클램프돼 잘릴 수 있고
    // (b) 가격만 훑는 유저는 summary를 아예 안 읽는다 — 가격/배지 바로 옆에
    // 별도로 렌더할 수 있게 전용 필드로 분리한다(index.html의 adPriceHtml).
    sampleNote: sample ? (sampleNote || "[샘플] 실제 판매 상품 아님") : null,
    priceOriginal,
    priceSale,
    disclosure: DISCLOSURE_TEXT,
    disclosureShort: DISCLOSURE_SHORT_TEXT,
    // 라운드1 검수 #3: "제휴"만으로는 🔥화제 등 유기 배지와 헷갈릴 수 있어
    // "광고"라는 단어를 항상 명시한다.
    badgeLabel: sample ? "제휴광고 · 샘플" : "제휴광고",
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
export function pickAffiliateCandidates(preferences, opts = {}) {
  const partnerId = opts.partnerId ?? process.env.COUPANG_PARTNER_ID ?? null;
  const preview = opts.preview ?? Boolean(process.env.AD_PREVIEW);

  let candidates;
  if (partnerId && opts.productFeed) candidates = opts.productFeed(preferences, opts) || [];
  else if (!preview) return []; // 절대원칙 1: no credential + no preview -> zero affiliate cards, ever
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
const SAMPLE_PRODUCT_TEMPLATES = {
  tech: [
    { name: "무선 노이즈캔슬링 이어버드", priceOriginal: 89000, priceSale: 52900 },
    { name: "65W 초고속 멀티 충전기", priceOriginal: 39900, priceSale: 24900 },
    { name: "보조배터리 (20000mAh 고속충전)", priceOriginal: 49900, priceSale: 32900 }
  ],
  auto: [
    { name: "차량용 블랙박스 (전후방 4K)", priceOriginal: 219000, priceSale: 159000 },
    { name: "트렁크 정리함 + 방수 매트 세트", priceOriginal: 45000, priceSale: 29900 },
    { name: "차량용 무선청소기", priceOriginal: 69000, priceSale: 45900 }
  ],
  science: [
    { name: "천체망원경 입문용 세트", priceOriginal: 129000, priceSale: 89000 },
    { name: "실험용 정밀 저울 (0.01g)", priceOriginal: 32000, priceSale: 22900 },
    { name: "휴대용 현미경 키트", priceOriginal: 45000, priceSale: 31900 }
  ],
  business: [
    { name: "듀얼 모니터암 (가스식)", priceOriginal: 69000, priceSale: 44900 },
    { name: "인체공학 무선 마우스", priceOriginal: 45000, priceSale: 29900 },
    { name: "휴대용 미니 프린터", priceOriginal: 89000, priceSale: 59900 }
  ],
  gaming: [
    { name: "기계식 게이밍 키보드 (저소음)", priceOriginal: 99000, priceSale: 65900 },
    { name: "게이밍 헤드셋 7.1 서라운드", priceOriginal: 79000, priceSale: 49900 },
    { name: "게이밍 마우스패드 (대형)", priceOriginal: 29000, priceSale: 18900 }
  ],
  sports: [
    { name: "폼롤러 + 마사지건 세트", priceOriginal: 89000, priceSale: 59900 },
    { name: "런닝화 (쿠셔닝 강화)", priceOriginal: 129000, priceSale: 79900 },
    { name: "요가매트 + 블록 세트", priceOriginal: 39000, priceSale: 25900 }
  ],
  culture: [
    { name: "블루투스 스피커 (고음질)", priceOriginal: 79000, priceSale: 49900 },
    { name: "휴대용 빔프로젝터", priceOriginal: 159000, priceSale: 109000 },
    { name: "무선 마이크 세트", priceOriginal: 59000, priceSale: 39900 }
  ],
  life: [
    { name: "에어프라이어 (5.5L 대용량)", priceOriginal: 99000, priceSale: 69900 },
    { name: "극세사 이불 세트", priceOriginal: 59000, priceSale: 35900 },
    { name: "무선 핸디청소기", priceOriginal: 79000, priceSale: 52900 }
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
      title: `[샘플] ${t.name}`,
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
