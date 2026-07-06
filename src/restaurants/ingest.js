// Ingestion + verification layer.
//
// Real-world "맛집" listings are polluted by paid promotion. This module takes
// raw multi-source mentions (Naver blog/place, YouTube, Instagram, community
// posts) and:
//   1. detects & drops advertising / sponsored mentions,
//   2. cross-checks the remaining *organic* signal across platforms,
//   3. produces a 0-100 verification score and a `verified` boolean.
//
// The goal is "검증된 맛집만" — a place earns trust from independent, non-paid
// mentions on multiple platforms, not from a single sponsored post.

// Markers that strongly indicate a paid / sponsored mention. Korea's fair-trade
// rules require disclosure, so these tokens are a reliable ad signal.
const AD_MARKERS = [
  "광고",
  "협찬",
  "제공받아",
  "제공 받아",
  "원고료",
  "소정의",
  "체험단",
  "기자단",
  "sponsored",
  "ad",
  "paidpartnership",
  "유료광고",
  "내돈내산아님"
];

// Platform trust weights. A mention on a platform where reputation is harder to
// fake counts for more.
const PLATFORM_WEIGHT = {
  naver_place: 1.0,
  naver_blog: 0.7,
  youtube: 1.1,
  instagram: 0.6,
  community: 1.2, // 자발적 커뮤니티 후기(예: 지역 카페/레딧류)
  google: 0.9
};

// Decide whether a single mention looks like paid promotion.
export function isAdMention(mention) {
  if (mention.type === "sponsored" || mention.type === "ad" || mention.paid === true) {
    return true;
  }
  const text = [mention.markers, mention.text, mention.disclosure]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");
  return AD_MARKERS.some((m) => text.includes(m.replace(/\s+/g, "")));
}

// Score one restaurant's raw mentions into a verification result.
export function verifyRestaurant(restaurant, options = {}) {
  const {
    minPlatforms = 2, // must appear organically on >= this many platforms
    minOrganicWeight = 2.0, // total organic trust weight threshold
    maxAdRatio = 0.6 // if paid mentions dominate, treat as unverified
  } = options;

  const mentions = restaurant.sources || [];
  const organic = mentions.filter((m) => !isAdMention(m));
  const ads = mentions.filter(isAdMention);

  const platforms = new Set(organic.map((m) => m.platform));
  const organicWeight = organic.reduce((sum, m) => {
    const w = PLATFORM_WEIGHT[m.platform] ?? 0.5;
    const volume = Math.log2(1 + (m.mentions ?? 1)); // diminishing returns
    const sentiment = typeof m.sentiment === "number" ? m.sentiment : 0.6;
    return sum + w * volume * sentiment;
  }, 0);

  const totalMentions = mentions.reduce((s, m) => s + (m.mentions ?? 1), 0) || 1;
  const adMentions = ads.reduce((s, m) => s + (m.mentions ?? 1), 0);
  const adRatio = adMentions / totalMentions;

  // 0-100 score blending breadth (platforms), depth (weight) and cleanliness.
  const breadth = Math.min(1, platforms.size / 4);
  const depth = Math.min(1, organicWeight / 6);
  const cleanliness = 1 - Math.min(1, adRatio);
  const verificationScore = Math.round((breadth * 0.35 + depth * 0.45 + cleanliness * 0.2) * 100);

  const verified =
    platforms.size >= minPlatforms &&
    organicWeight >= minOrganicWeight &&
    adRatio <= maxAdRatio;

  return {
    ...restaurant,
    verified,
    verificationScore,
    signals: {
      platforms: [...platforms],
      platformCount: platforms.size,
      organicMentions: organic.length,
      adMentionsFiltered: ads.length,
      adRatio: Number(adRatio.toFixed(2)),
      organicWeight: Number(organicWeight.toFixed(2))
    }
  };
}

// Ingest a batch: verify each place, drop non-verified by default.
export function ingest(rawRestaurants, options = {}) {
  const { keepUnverified = false } = options;
  const verified = rawRestaurants.map((r) => verifyRestaurant(r, options));
  return keepUnverified ? verified : verified.filter((r) => r.verified);
}
