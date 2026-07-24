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
const AD_SKIP_FIRST_DEFAULT = 4; // 첫 화면 보호: 앞 K개엔 슬롯 없음
const AD_MAX_PER_PAGE_DEFAULT = 2; // 세션(요청)당 슬롯 상한
const AD_MIN_RELEVANCE_DEFAULT = 0.3; // 관련성 게이팅 임계치
const AD_EVERY_MIN = 4; // adaptiveEvery 하한 — 고반응 유저라도 이보다 촘촘히는 안 감
const AD_EVERY_MAX = 24; // adaptiveEvery 상한 — 저반응 유저라도 이보다 성글게는 안 감
const AD_RESPONSIVENESS_SENSITIVITY_DEFAULT = 0.35;
const AD_BASELINE_CTR_DEFAULT = 0.02;
export const DISCLOSURE_TEXT =
  "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다";

export function adParams(opts = {}) {
  return {
    every: opts.every ?? envNum("AD_EVERY", AD_EVERY_DEFAULT),
    skipFirst: opts.skipFirst ?? envNum("AD_SKIP_FIRST", AD_SKIP_FIRST_DEFAULT),
    maxPerPage: opts.maxPerPage ?? envNum("AD_MAX_PER_PAGE", AD_MAX_PER_PAGE_DEFAULT),
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
  reason
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
    priceOriginal,
    priceSale,
    disclosure: DISCLOSURE_TEXT,
    badgeLabel: sample ? "제휴 · 샘플" : "제휴",
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
export function pickAffiliateCandidates(preferences, opts = {}) {
  const partnerId = opts.partnerId ?? process.env.COUPANG_PARTNER_ID ?? null;
  const preview = opts.preview ?? Boolean(process.env.AD_PREVIEW);

  if (partnerId && opts.productFeed) return opts.productFeed(preferences, opts) || [];
  if (!preview) return []; // 절대원칙 1: no credential + no preview -> zero affiliate cards, ever
  return sampleAffiliateCandidates(preferences, opts);
}

// A couple of plausible product ideas per category, so a preview card at
// least looks like it belongs in that category's feed. Never a real listing —
// every title is prefixed "[샘플]" by sampleAffiliateCandidates, and the url
// always points at the bare coupang.com homepage, never a fabricated product
// page. No review-count/timer fields anywhere here — this file's no-dark-
// patterns rule applies just as much to a preview sample as to a live card.
const SAMPLE_PRODUCT_TEMPLATES = {
  tech: [
    { name: "무선 노이즈캔슬링 이어버드", priceOriginal: 89000, priceSale: 52900 },
    { name: "65W 초고속 멀티 충전기", priceOriginal: 39900, priceSale: 24900 }
  ],
  auto: [
    { name: "차량용 블랙박스 (전후방 4K)", priceOriginal: 219000, priceSale: 159000 },
    { name: "트렁크 정리함 + 방수 매트 세트", priceOriginal: 45000, priceSale: 29900 }
  ],
  science: [
    { name: "천체망원경 입문용 세트", priceOriginal: 129000, priceSale: 89000 },
    { name: "실험용 정밀 저울 (0.01g)", priceOriginal: 32000, priceSale: 22900 }
  ],
  business: [
    { name: "듀얼 모니터암 (가스식)", priceOriginal: 69000, priceSale: 44900 },
    { name: "인체공학 무선 마우스", priceOriginal: 45000, priceSale: 29900 }
  ],
  gaming: [
    { name: "기계식 게이밍 키보드 (저소음)", priceOriginal: 99000, priceSale: 65900 },
    { name: "게이밍 헤드셋 7.1 서라운드", priceOriginal: 79000, priceSale: 49900 }
  ],
  sports: [
    { name: "폼롤러 + 마사지건 세트", priceOriginal: 89000, priceSale: 59900 },
    { name: "런닝화 (쿠셔닝 강화)", priceOriginal: 129000, priceSale: 79900 }
  ],
  culture: [
    { name: "블루투스 스피커 (고음질)", priceOriginal: 79000, priceSale: 49900 },
    { name: "휴대용 빔프로젝터", priceOriginal: 159000, priceSale: 109000 }
  ],
  life: [
    { name: "에어프라이어 (5.5L 대용량)", priceOriginal: 99000, priceSale: 69900 },
    { name: "극세사 이불 세트", priceOriginal: 59000, priceSale: 35900 }
  ]
};

// Build candidates from this user's own top learned categories — the
// "취향벡터 상위 카테고리" match. Returns [] for a cold-start user with no
// learned preference yet (topPreferences only returns weight>0 entries), so
// injectSlots' relevance gate naturally empties every slot instead of this
// function guessing a generic pick — no forced fill for someone we know
// nothing about yet.
export function sampleAffiliateCandidates(preferences, opts = {}) {
  const top = topPreferences(preferences, 3).categories;
  if (!top.length) return [];
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  return top.map((c, i) => {
    const templates = SAMPLE_PRODUCT_TEMPLATES[c.id] || SAMPLE_PRODUCT_TEMPLATES.life;
    const t = templates[(seed + i) % templates.length];
    // c.weight is on the recommender's WEIGHT_CLAMP=6 scale (recommender.js) —
    // reuse that ceiling so relevance lands on the same [0,1] scale injectSlots
    // gates against, without inventing a second scoring formula.
    const relevance = clamp(c.weight / 6, 0, 1);
    return makeSlotItem({
      id: `ad_sample_${c.id}_${i}`,
      category: c.id,
      title: `[샘플] ${t.name}`,
      summary: `${categoryLabel(c.id)} 취향에 맞춰 골라본 상품이에요 · 검수용 샘플이며 실제 판매 상품이 아니에요`,
      url: "https://www.coupang.com/",
      priceOriginal: t.priceOriginal,
      priceSale: t.priceSale,
      sample: true,
      relevance,
      reason: `${categoryLabel(c.id)} 관심사와 맞아요`
    });
  });
}
