// 찐맛집 판별 엔진 (authenticity scoring) — multi-source edition.
//
// The hard problem: across an ocean of restaurant data (TikTok, YouTube Shorts,
// Instagram/Reels, blogs, communities, Naver/Daum/Kakao Map, discovery apps like
// CatchTable/MangoPlate/DiningCode…), *words are cheap and easy to fake*. Two
// ideas make the algorithm robust as sources multiply:
//
//   1. SOURCE-CLASS trust + cross-class corroboration. Short-form video has huge
//      reach but low trust (ad/viral-driven); map/app/community are harder to
//      game. A place must be corroborated across INDEPENDENT classes — not just
//      go viral on one.
//   2. BEHAVIORAL signals (revealed preference): reservations, waitlist, revisit
//      rate, saves. People actually returning and waiting in line is far harder
//      to fake than posting, so it carries the most weight — and a "viral bubble"
//      (short-form spike with no behavioral/map corroboration) is vetoed.
//
// Every sub-score and veto reason is reported (explainable), so no black box.

const AD_MARKERS = [
  "광고", "협찬", "제공받아", "제공 받아", "원고료", "소정의",
  "체험단", "기자단", "sponsored", "paidpartnership", "유료광고"
];

// Map each platform to a trust CLASS. New platforms just need one line here.
const PLATFORM_CLASS = {
  tiktok: "short_video",
  youtube_shorts: "short_video",
  reels: "short_video",
  instagram_reels: "short_video",
  instagram: "social",
  naver_blog: "social",
  youtube: "social",
  naver_place: "map",
  naver_map: "map",
  daum_map: "map",
  kakao_map: "map",
  google: "map",
  catchtable: "app",
  mangoplate: "app",
  diningcode: "app",
  siksin: "app",
  community: "community"
};

// Trust weight per class. Short-form is discounted; behavior corroboration and
// low-incentive communities are trusted most.
const CLASS_WEIGHT = {
  short_video: 0.5,
  social: 0.75,
  map: 1.0,
  app: 1.0,
  community: 1.2
};

// "Hard" classes are the ones expensive to astroturf at scale — a genuine place
// almost always shows up in at least one of them.
const HARD_CLASSES = new Set(["map", "app", "community"]);

const CFG = {
  MIN_ORGANIC: 6,
  CLASS_BREADTH_TARGET: 2.8, // 가중 클래스 신뢰 합이 이 정도면 breadth 만점
  LONGEVITY_DAYS: 365,
  SUSTAIN_TARGET_DAYS: 540,
  BURST_WINDOW_DAYS: 30,
  BURST_FRACTION: 0.7,
  BURST_MAX_SPAN: 150,
  ASTROTURF_UNIQUE_RATIO: 0.4,
  ASTROTURF_HHI: 0.35,
  AD_DOMINATED_RATIO: 0.6,
  VIRAL_SHORT_SHARE: 0.55, // 숏폼 비중이 이 위이고
  VIRAL_BEHAVIOR_FLOOR: 0.4 // 행동 확증이 이 아래면 "바이럴 거품"
};

// Factor weights (sum = 1). Behavioral revealed-preference carries the most.
const WEIGHTS = {
  behavior: 0.22, // 예약·웨이팅·재방문·저장 (조작 최난이도)
  diversity: 0.18, // 작성자 다양성 (어뷰징 반대)
  local: 0.17, // 로컬·재방문 리뷰
  classBreadth: 0.13, // 독립 소스 클래스 교차 확증
  sustain: 0.12, // 시간 지속성 + 노포
  realism: 0.10, // 평점 분포 현실성
  texture: 0.08 // 후기 구체성
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export const classOf = (platform) => PLATFORM_CLASS[platform] ?? "social";

export function isPaidReview(review) {
  if (review.paid === true || review.type === "sponsored" || review.type === "ad") return true;
  const text = [review.markers, review.text, review.disclosure]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");
  return AD_MARKERS.some((m) => text.includes(m.replace(/\s+/g, "")));
}

function authorHHI(reviews) {
  const counts = new Map();
  for (const r of reviews) {
    const a = r.author ?? "anon";
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const total = reviews.length || 1;
  let hhi = 0;
  for (const n of counts.values()) hhi += (n / total) ** 2;
  return { hhi, uniqueAuthors: counts.size };
}

function maxWindowFraction(daysAgo) {
  if (daysAgo.length === 0) return 0;
  const sorted = [...daysAgo].sort((a, b) => a - b);
  let best = 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] > CFG.BURST_WINDOW_DAYS) j++;
    best = Math.max(best, i - j + 1);
  }
  return best / sorted.length;
}

// Revealed-preference score from behavioral data (0..1). Absent => neutral 0.5.
function behaviorScore(b) {
  if (!b) return { score: 0.5, present: false };
  // Benchmarks tuned to realistic "excellent" values (revisit ~50% is superb;
  // a genuine hotspot sees ~50 reservations/wk, ~30min waits, ~1.8k saves).
  const revisit = clamp01((b.revisitRate ?? 0) / 0.5);
  const resv = clamp01((b.reservationsPerWeek ?? 0) / 50);
  const wait = clamp01((b.avgWaitMin ?? 0) / 30);
  const saves = clamp01((b.saves ?? 0) / 1800);
  const score = clamp01(0.45 * revisit + 0.25 * resv + 0.15 * wait + 0.15 * saves);
  return { score, present: true };
}

export function scoreAuthenticity(restaurant, cfg = {}) {
  const C = { ...CFG, ...cfg };
  const reviews = restaurant.reviews ?? [];
  const total = reviews.length;
  const organic = reviews.filter((r) => !isPaidReview(r));
  const paidCount = total - organic.length;
  const paidRatio = total ? paidCount / total : 0;

  // --- source classes present (organic) ---
  const classSet = new Set(organic.map((r) => classOf(r.platform)));
  const platformSet = new Set(organic.map((r) => r.platform));
  const trust = [...classSet].reduce((s, c) => s + (CLASS_WEIGHT[c] ?? 0.6), 0);
  const classBreadth = clamp01(trust / C.CLASS_BREADTH_TARGET);
  const shortCount = organic.filter((r) => classOf(r.platform) === "short_video").length;
  const shortShare = organic.length ? shortCount / organic.length : 0;
  const hasHardClass = [...classSet].some((c) => HARD_CLASSES.has(c));

  // --- author diversity (anti-astroturf) ---
  const { hhi, uniqueAuthors } = authorHHI(organic);
  const uniqueRatio = organic.length ? uniqueAuthors / organic.length : 0;
  const diversity = clamp01(0.5 * uniqueRatio + 0.5 * (1 - Math.min(1, hhi)));

  // --- temporal sustain + longevity, minus burst ---
  const days = organic.map((r) => r.daysAgo ?? 0);
  const span = days.length ? Math.max(...days) - Math.min(...days) : 0;
  const hasLongevity = days.some((d) => d >= C.LONGEVITY_DAYS);
  const burstFrac = maxWindowFraction(days);
  const isBurst = burstFrac >= C.BURST_FRACTION && span <= C.BURST_MAX_SPAN;
  const sustain = clamp01(
    Math.min(1, span / C.SUSTAIN_TARGET_DAYS) + (hasLongevity ? 0.15 : 0) - (isBurst ? 0.4 : 0)
  );

  // --- local / repeat-visit reviews ---
  const localRatio = organic.length ? organic.filter((r) => r.local).length / organic.length : 0;
  const repeatRatio = organic.length ? organic.filter((r) => r.repeat).length / organic.length : 0;
  const local = clamp01(0.5 * localRatio + 0.5 * repeatRatio);

  // --- behavioral revealed preference ---
  const behavior = behaviorScore(restaurant.behavior);

  // --- text specificity + rating realism ---
  const texture = clamp01(mean(organic.map((r) => r.specificity ?? 0.5)));
  const ratings = organic.map((r) => r.rating ?? 5);
  const allFive = ratings.length > 0 && ratings.every((x) => x >= 5);
  const hasCriticism = ratings.some((x) => x <= 3);
  const sd = stdev(ratings);
  const realism = clamp01((allFive ? 0 : 0.5) + Math.min(0.3, sd * 0.4) + (hasCriticism ? 0.2 : 0));

  const factors = {
    behavior: behavior.score, diversity, local, classBreadth, sustain, realism, texture
  };
  const raw = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + factors[k] * w, 0);

  const adCleanliness = 1 - 0.5 * Math.min(1, paidRatio);
  let score = raw * adCleanliness * 100;

  // --- veto rules ---
  const flags = [];
  const astroturf = organic.length >= 3 && (uniqueRatio < C.ASTROTURF_UNIQUE_RATIO || hhi > C.ASTROTURF_HHI);
  const adDominated = paidRatio > C.AD_DOMINATED_RATIO;
  const thin = organic.length < C.MIN_ORGANIC;
  const narrow = classSet.size < 2;
  const viralBubble =
    shortShare >= C.VIRAL_SHORT_SHARE && !hasHardClass && behavior.score < C.VIRAL_BEHAVIOR_FLOOR;

  if (thin) { flags.push("표본부족"); score = Math.min(score, 42); }
  if (narrow) { flags.push("단일소스클래스"); score = Math.min(score, 45); }
  if (isBurst) flags.push("단기폭발");
  if (viralBubble) { flags.push("바이럴거품(행동확증없음)"); score = Math.min(score, 40); }
  if (astroturf) { flags.push("작성자편중(어뷰징의심)"); score = Math.min(score, 35); }
  if (adDominated) { flags.push("광고도배"); score = Math.min(score, 28); }

  score = Math.round(score);

  const hardFake = astroturf || adDominated || thin || narrow || viralBubble;
  let verdict;
  let verified;
  if (hardFake) {
    verdict = adDominated ? "광고의심"
      : viralBubble ? "바이럴거품"
      : thin || narrow ? "정보부족"
      : "어뷰징의심";
    verified = false;
  } else if (score >= 80) { verdict = "찐맛집"; verified = true; }
  else if (score >= 65) { verdict = "검증됨"; verified = true; }
  else if (score >= 45) { verdict = "보통"; verified = false; }
  else { verdict = "미검증"; verified = false; }

  const reasons = buildReasons(factors, {
    hasLongevity, isBurst, astroturf, adDominated, viralBubble,
    localRatio, repeatRatio, hasCriticism, uniqueAuthors,
    classes: [...classSet], shortShare, paidCount,
    behaviorPresent: behavior.present, behaviorScore: behavior.score,
    b: restaurant.behavior
  });

  return {
    authenticityScore: score,
    verdict,
    verified,
    flags,
    reasons,
    breakdown: Object.fromEntries(
      Object.entries(factors).map(([k, v]) => [k, Math.round(v * 100)])
    ),
    stats: {
      organicReviews: organic.length,
      paidFiltered: paidCount,
      paidRatio: Number(paidRatio.toFixed(2)),
      sourceClasses: [...classSet],
      platforms: [...platformSet],
      platformCount: platformSet.size,
      shortFormShare: Number(shortShare.toFixed(2)),
      uniqueAuthors,
      authorHHI: Number(hhi.toFixed(3)),
      spanDays: span,
      localRatio: Number(localRatio.toFixed(2)),
      repeatRatio: Number(repeatRatio.toFixed(2)),
      behaviorScore: Number(behavior.score.toFixed(2))
    }
  };
}

function buildReasons(f, ctx) {
  const R = [];
  if (ctx.classes.length >= 3) R.push(`독립 소스 클래스 ${ctx.classes.length}종 교차확증 (${ctx.classes.join("·")})`);
  if (ctx.behaviorPresent && ctx.behaviorScore >= 0.55) {
    const b = ctx.b || {};
    const bits = [];
    if (b.revisitRate) bits.push(`재방문율 ${Math.round(b.revisitRate * 100)}%`);
    if (b.reservationsPerWeek) bits.push(`주간예약 ${b.reservationsPerWeek}건`);
    if (b.avgWaitMin) bits.push(`평균웨이팅 ${b.avgWaitMin}분`);
    R.push(`실제 행동 데이터 강함${bits.length ? " (" + bits.join(", ") + ")" : ""}`);
  }
  if (f.diversity >= 0.8) R.push(`서로 다른 작성자 ${ctx.uniqueAuthors}명 (도배 아님)`);
  if (ctx.hasLongevity) R.push("1년 이상 꾸준히 언급된 곳");
  if (ctx.localRatio >= 0.4) R.push(`로컬 리뷰 비중 ${Math.round(ctx.localRatio * 100)}%`);
  if (ctx.repeatRatio >= 0.35) R.push(`재방문/단골 언급 ${Math.round(ctx.repeatRatio * 100)}%`);
  if (ctx.hasCriticism) R.push("솔직한 단점 리뷰 존재(별점 조작 아님)");
  if (ctx.paidCount > 0) R.push(`협찬/광고 ${ctx.paidCount}건 제외 후 계산`);
  if (ctx.isBurst) R.push("⚠ 단기간 리뷰 폭발(신뢰도 감점)");
  if (ctx.viralBubble) R.push(`⚠ 숏폼 비중 ${Math.round(ctx.shortShare * 100)}%인데 행동/지도 확증 없음(바이럴 거품)`);
  if (ctx.astroturf) R.push("⚠ 소수 계정 편중(어뷰징 의심)");
  if (ctx.adDominated) R.push("⚠ 광고성 리뷰 과다");
  return R;
}

export default scoreAuthenticity;
