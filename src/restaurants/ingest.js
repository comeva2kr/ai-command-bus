// Ingestion layer.
//
// Takes raw multi-source restaurant records (each carrying review-level
// signals) and runs the 찐맛집 authenticity engine over them: advertising is
// filtered, astroturf/burst/thin-sample places are vetoed, and every place gets
// an explainable authenticity score + verdict. By default only genuinely
// verified places survive.

import { scoreAuthenticity, isPaidReview } from "./authenticity.js";

// Keep a thin backward-compatible name; delegates to the authenticity engine.
export function verifyRestaurant(restaurant, options = {}) {
  const auth = scoreAuthenticity(restaurant, options);
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

// Ingest a batch: score each place, drop non-verified by default.
export function ingest(rawRestaurants, options = {}) {
  const { keepUnverified = false, ...cfg } = options;
  const scored = rawRestaurants.map((r) => verifyRestaurant(r, cfg));
  return keepUnverified ? scored : scored.filter((r) => r.verified);
}

export { isPaidReview };
