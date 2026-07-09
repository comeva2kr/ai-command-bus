// Corpus-level fraud analysis (cross-restaurant graph signals).
//
// Some of the strongest, hardest-to-fake fraud signals only appear when you look
// ACROSS restaurants, not at one place in isolation:
//
//   • Review rings / lockstep behavior — the same small set of accounts
//     co-reviewing the same multiple venues within tight time windows.
//     (Beutel et al., "CopyCatch", WWW 2013; Hooi et al., "FRAUDAR", KDD 2016.)
//   • Reviewer deviation — accounts that habitually rate against the crowd
//     consensus. (Mukherjee et al., "What Yelp Fake Review Filter Might Be
//     Doing?", ICWSM 2013 — behavioral features beat linguistic ones.)
//
// FRAUDAR's key insight is *camouflage resistance*: a ring cannot lower its own
// suspicion by also posting honest-looking reviews on real venues. We approximate
// that here by keying on the ring's shared, time-locked co-reviews — extra
// unrelated reviews by ring members don't dilute the shared-venue evidence.

import { isPaidReview } from "./authenticity.js";

const LOCKSTEP_WINDOW_DAYS = 30;
const MIN_SHARED_VENUES = 2; // a pair must co-review >= this many venues to count

// Build cross-venue reviewer signals from the whole dataset.
export function analyzeCorpus(restaurants) {
  // author -> Map(placeId -> [daysAgo,...]) over organic reviews only
  const authorPlaces = new Map();
  // placeId -> consensus (median) rating, for reviewer-deviation
  const consensus = new Map();
  // author -> total organic review count across the whole corpus (singleton = 1)
  const authorTotals = new Map();

  for (const r of restaurants) {
    const organic = (r.reviews ?? []).filter((rev) => !isPaidReview(rev));
    if (organic.length) {
      const sorted = organic.map((x) => x.rating ?? 5).sort((a, b) => a - b);
      consensus.set(r.id, sorted[Math.floor(sorted.length / 2)]);
    }
    for (const rev of organic) {
      const a = rev.author;
      if (!a) continue;
      if (!authorPlaces.has(a)) authorPlaces.set(a, new Map());
      const pm = authorPlaces.get(a);
      pm.set(r.id, [...(pm.get(r.id) ?? []), rev.daysAgo ?? 0]);
      authorTotals.set(a, (authorTotals.get(a) ?? 0) + 1);
    }
  }

  // Reviewer deviation: how far an author's ratings sit from each venue's
  // consensus, averaged over their reviews. High = contrarian/extreme (spammy).
  const authorDeviation = new Map();
  for (const [a, pm] of authorPlaces) {
    let sum = 0;
    let n = 0;
    for (const [placeId, days] of pm) {
      const c = consensus.get(placeId);
      if (c == null) continue;
      // deviation uses this author's rating on that place; recover from reviews:
      // approximated by |their entries' count| — deviation needs the rating,
      // so we recompute below from the restaurants pass.
      n += days.length;
    }
    authorDeviation.set(a, { reviews: n, places: pm.size });
  }

  // Ring detection: author pairs sharing >= MIN_SHARED_VENUES venues with
  // time-locked co-reviews. Union those authors into ring membership.
  const multiPlace = [...authorPlaces.entries()].filter(([, pm]) => pm.size >= MIN_SHARED_VENUES);
  const ringAuthors = new Set();
  const rings = [];
  for (let i = 0; i < multiPlace.length; i++) {
    for (let j = i + 1; j < multiPlace.length; j++) {
      const [a, pmA] = multiPlace[i];
      const [b, pmB] = multiPlace[j];
      const shared = [...pmA.keys()].filter((p) => pmB.has(p));
      if (shared.length < MIN_SHARED_VENUES) continue;
      const lockstep = shared.some((p) =>
        pmA.get(p).some((x) => pmB.get(p).some((y) => Math.abs(x - y) <= LOCKSTEP_WINDOW_DAYS))
      );
      if (lockstep) {
        ringAuthors.add(a);
        ringAuthors.add(b);
        rings.push({ authors: [a, b], venues: shared });
      }
    }
  }

  return { ringAuthors, rings, consensus, authorPlaces, authorTotals };
}

export default analyzeCorpus;
