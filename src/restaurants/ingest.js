// Ingestion layer.
//
// Runs the 찐맛집 authenticity engine over raw multi-source records. First it
// analyzes the whole corpus for cross-venue graph fraud (review rings / lockstep
// collusion), then scores each place with that context so ring members are
// caught even when a place looks clean in isolation (camouflage-resistant).
// By default only genuinely verified places survive.

import { scoreAuthenticity, isPaidReview } from "./authenticity.js";
import { analyzeCorpus } from "./corpus.js";

// Score a single place. Pass `context` (from analyzeCorpus) to enable the
// cross-venue ring signal; omit it for standalone scoring.
export function verifyRestaurant(restaurant, options = {}, context = {}) {
  const auth = scoreAuthenticity(restaurant, options, context);
  return {
    ...restaurant,
    verified: auth.verified,
    verdict: auth.verdict,
    authenticityScore: auth.authenticityScore,
    // Alias retained so existing ranking/query code keeps working.
    verificationScore: auth.authenticityScore,
    flags: auth.flags,
    reasons: auth.reasons,
    breakdown: auth.breakdown,
    signals: auth.stats
  };
}

// Ingest a batch: analyze corpus once, score each place, drop non-verified.
export function ingest(rawRestaurants, options = {}) {
  const { keepUnverified = false, ...cfg } = options;
  const context = analyzeCorpus(rawRestaurants);
  const scored = rawRestaurants.map((r) => verifyRestaurant(r, cfg, context));
  return keepUnverified ? scored : scored.filter((r) => r.verified);
}

export { isPaidReview, analyzeCorpus };
