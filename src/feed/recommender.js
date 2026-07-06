// Personalization engine.
//
// A content-based recommender with online learning. The user's taste lives in a
// preference vector (category + tag + source weights). Each item is scored by
// how well its features line up with that vector, plus small popularity/novelty
// terms. Every like/dislike nudges the weights, so the ranking sharpens over
// time — exactly the "설문으로 시작 → 평가하며 정확도 상승" loop.

import { emptyPreferenceVector } from "./survey.js";

// How hard a single rating moves the weights. Kept small so one click never
// swings the feed violently; the signal accumulates.
const LEARNING_RATE = 0.35;
// Ratings decay the influence of very old preferences slightly so taste can
// drift. 1.0 = no decay.
const WEIGHT_DECAY = 0.995;
// Weights are clamped to keep any single feature from dominating.
const WEIGHT_CLAMP = 6;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Feature contributions from an item given the user's vector.
function featureScore(item, vec) {
  const categoryW = vec.categories[item.category] || 0;
  let tagW = 0;
  for (const tag of item.tags) tagW += vec.tags[tag] || 0;
  // average tag weight so items with many tags aren't unfairly boosted
  const tagAvg = item.tags.length ? tagW / item.tags.length : 0;
  const sourceW = vec.sources[item.source] || 0;

  // style match: longform preference vs item length
  const longformPref = (vec.prefs && vec.prefs.longform) || 0;
  const isLong = item.length >= 400 ? 1 : item.length <= 120 ? -1 : 0;
  const styleMatch = longformPref * isLong * 0.4;

  return { categoryW, tagAvg, sourceW, styleMatch };
}

// Weak popularity prior in [0, ~1]. Log-scaled so a viral post doesn't bury
// everything the user actually likes.
function popularityPrior(item) {
  const raw = (item.score || 0) + (item.commentCount || 0) * 1.5;
  return Math.log10(1 + Math.max(0, raw)) / 3;
}

// Deterministic per-item novelty jitter so the feed isn't identical on every
// reload but also never depends on Math.random (which is unavailable in some
// runtimes and makes results non-reproducible).
function noveltyJitter(item, seed) {
  let h = seed >>> 0;
  const key = String(item.id);
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return ((h % 1000) / 1000 - 0.5) * 0.2; // ~[-0.1, 0.1]
}

// Recency boost in ~[0, 1]. Fresh posts surface; it decays over ~3 days. Only
// applied when a reference time (`opts.now`, ms) is supplied so pure scoring
// stays deterministic for tests.
function recencyBoost(item, now) {
  if (!now || !item.publishedAt) return 0;
  const ageHours = (now - new Date(item.publishedAt).getTime()) / 3.6e6;
  if (!Number.isFinite(ageHours) || ageHours < 0) return 0.5;
  return Math.exp(-ageHours / 72); // half-life ~2 days
}

// Score a single item. Higher = better match. `opts.seenIds` demotes items the
// user has already been shown; `opts.seed` varies novelty jitter per request;
// `opts.now` (ms) enables the recency term.
export function scoreItem(item, vec, opts = {}) {
  const f = featureScore(item, vec);
  const base =
    f.categoryW * 1.0 +
    f.tagAvg * 1.3 +
    f.sourceW * 0.6 +
    f.styleMatch +
    popularityPrior(item) * 0.5 +
    recencyBoost(item, opts.now) * 0.6 +
    noveltyJitter(item, opts.seed || 1);

  const seen = opts.seenIds && opts.seenIds.has(item.id);
  return seen ? base - 3 : base;
}

// Rank items best-first. Returns a new array of { item, score }.
export function rankItems(items, vec, opts = {}) {
  return items
    .map((item) => ({ item, score: scoreItem(item, vec, opts) }))
    .sort((a, b) => b.score - a.score);
}

// Diversity re-ranking (MMR-style). A feed that's all one source or category
// feels repetitive even if every item scores well. This greedily builds the
// order, penalizing a candidate for each recently-picked item that shares its
// source or category, so the stream stays varied without abandoning relevance.
export function diversify(ranked, opts = {}) {
  const sourcePenalty = opts.sourcePenalty ?? 0.6;
  const categoryPenalty = opts.categoryPenalty ?? 0.4;
  const window = opts.window ?? 4; // how far back diversity is enforced

  const pool = ranked.slice();
  const out = [];
  while (pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let penalty = 0;
      const recent = out.slice(-window);
      for (const picked of recent) {
        if (picked.item.source === cand.item.source) penalty += sourcePenalty;
        if (picked.item.category === cand.item.category) penalty += categoryPenalty;
      }
      const val = cand.score - penalty;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    out.push(pool.splice(bestIdx, 1)[0]);
  }
  return out;
}

// Apply a like/dislike (or explicit weight nudge) to the preference vector.
// `signal` is +1 for like, -1 for dislike. Returns the mutated vector.
export function applyFeedback(vec, item, signal) {
  const s = signal >= 0 ? 1 : -1;
  const step = LEARNING_RATE * s;

  // gently decay everything so stale interests fade
  decayAll(vec);

  vec.categories[item.category] = clamp(
    (vec.categories[item.category] || 0) + step,
    -WEIGHT_CLAMP,
    WEIGHT_CLAMP
  );
  for (const tag of item.tags) {
    vec.tags[tag] = clamp((vec.tags[tag] || 0) + step, -WEIGHT_CLAMP, WEIGHT_CLAMP);
  }
  vec.sources[item.source] = clamp(
    (vec.sources[item.source] || 0) + step * 0.7,
    -WEIGHT_CLAMP,
    WEIGHT_CLAMP
  );

  // learn longform preference from the item's length
  if (item.length >= 400) vec.prefs.longform = clamp((vec.prefs.longform || 0) + step * 0.3, -2, 2);
  else if (item.length <= 120) vec.prefs.longform = clamp((vec.prefs.longform || 0) - step * 0.3, -2, 2);

  return vec;
}

function decayAll(vec) {
  for (const map of [vec.categories, vec.tags, vec.sources]) {
    for (const k of Object.keys(map)) {
      map[k] *= WEIGHT_DECAY;
      if (Math.abs(map[k]) < 0.02) delete map[k]; // prune noise
    }
  }
}

// "특정화 정도" — how well we understand this user, in [0, 1].
//
// Combines two things:
//   coverage: how many distinct features carry a meaningful weight
//   contrast: how sharply weights differ (a flat vector = we know nothing)
// The feed uses this to decide when to switch from "설문/탐색" mode into
// "수집해서 보여주기" mode.
export function specializationLevel(vec, feedbackCount = 0) {
  const weights = [
    ...Object.values(vec.categories || {}),
    ...Object.values(vec.tags || {})
  ];
  if (weights.length === 0) return 0;

  const meaningful = weights.filter((w) => Math.abs(w) >= 0.5).length;
  const coverage = Math.min(1, meaningful / 8);

  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  const variance = weights.reduce((a, b) => a + (b - mean) ** 2, 0) / weights.length;
  const contrast = Math.min(1, Math.sqrt(variance) / 2);

  // feedback volume is the strongest confidence driver
  const engagement = Math.min(1, feedbackCount / 20);

  const level = 0.35 * coverage + 0.25 * contrast + 0.4 * engagement;
  return Math.round(level * 100) / 100;
}

// Human-readable phase derived from the specialization level.
export function feedPhase(level) {
  if (level < 0.25) return "survey"; // still cold — keep asking / exploring
  if (level < 0.6) return "calibrating"; // showing content, learning fast
  return "personalized"; // confident, tightly filtered feed
}

export { emptyPreferenceVector };
