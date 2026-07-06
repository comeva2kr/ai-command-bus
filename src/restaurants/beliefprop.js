// Network fraud propagation via Loopy Belief Propagation on a reviewer–venue
// Markov Random Field. Based on the FraudEagle / SpEagle family (Akoglu et al.,
// "Opinion Fraud Detection in Online Reviews by Network Effects", ICWSM 2013;
// Rayana & Akoglu, "SpEagle", KDD 2015).
//
// Why this matters: local, per-venue signals miss fraud that only shows up in
// the GRAPH. If a venue is reviewed by accounts that also review known-bad
// venues, suspicion should propagate to it — even if that venue, viewed alone,
// looks clean and no single veto fires. BP does exactly this: it spreads belief
// along the reviewer↔venue graph until it converges, unifying the ring/collusion
// signals into one principled posterior fraud probability per venue.
//
// States: reviewer ∈ {honest, fraud}, venue ∈ {genuine, bad}. Edge potential is
// homophilic (fraud reviewers ↔ bad venues). Priors seed fraud reviewers (ring
// members) high; everything else neutral-honest. We run sum-product LBP.

import { isPaidReview } from "./authenticity.js";

const EPS = 0.2; // edge disagreement potential (smaller = stronger coupling)
const ITERS = 12;
const RING_PRIOR = 0.92; // fraud prior for detected ring accounts
const BASE_PRIOR = 0.32; // fraud prior for ordinary reviewers

// Edge compatibility ψ(reviewerFraud?, venueBad?).
function psi(revFraud, venueBad) {
  return revFraud === venueBad ? 1 - EPS : EPS; // agree(F,B)/(H,G) high; disagree low
}

// Quick per-venue "bad" prior from cheap metadata features (SpEagle-style:
// priors from local signals, then BP refines across the graph). Deliberately
// coarse — the network step does the real work of spreading belief.
function venueBadPrior(restaurant, ringAuthors) {
  const reviews = restaurant.reviews ?? [];
  const organic = reviews.filter((r) => !(r.paid || r.type === "sponsored"));
  const n = organic.length || 1;
  const paidRatio = (reviews.length - organic.length) / (reviews.length || 1);
  const ringShare = organic.filter((r) => ringAuthors.has(r.author)).length / n;
  const s5 = organic.filter((r) => Math.round(r.rating ?? 5) === 5).length / n;
  const mid = organic.filter((r) => [3, 4].includes(Math.round(r.rating ?? 5))).length / n;
  const allFiveMissingMiddle = s5 >= 0.7 && mid < 0.1;
  let p = 0.4;
  if (ringShare >= 0.3) p += 0.35;
  if (paidRatio > 0.5) p += 0.25;
  if (allFiveMissingMiddle) p += 0.2;
  return Math.max(0.1, Math.min(0.9, p));
}

export function propagateFraud(restaurants, { ringAuthors = new Set() } = {}) {
  // Build bipartite edges over organic reviews. Dedupe (author,venue) pairs — a
  // reviewer who posts on a venue multiple times is still one edge, else the
  // message product would count the same message several times and diverge.
  const edgeSet = new Set();
  const edges = []; // { u: authorId, v: venueId }
  const venueIds = [];
  const authorSet = new Set();
  for (const r of restaurants) {
    venueIds.push(r.id);
    for (const rev of r.reviews ?? []) {
      if (isPaidReview(rev) || !rev.author) continue;
      const key = `${rev.author}|${r.id}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ u: rev.author, v: r.id });
      }
      authorSet.add(rev.author);
    }
  }

  // Priors as P(fraud) / P(bad).
  const revPrior = new Map();
  for (const a of authorSet) revPrior.set(a, ringAuthors.has(a) ? RING_PRIOR : BASE_PRIOR);
  const venuePrior = new Map();
  for (const r of restaurants) venuePrior.set(r.id, venueBadPrior(r, ringAuthors));

  // Messages: keyed "u|v" and "v|u", each = [pHonestOrGenuine, pFraudOrBad].
  const mUV = new Map(); // reviewer -> venue
  const mVU = new Map(); // venue -> reviewer
  for (const { u, v } of edges) {
    mUV.set(`${u}|${v}`, [0.5, 0.5]);
    mVU.set(`${v}|${u}`, [0.5, 0.5]);
  }

  // Adjacency.
  const revNbrs = new Map(); // author -> [venueId]
  const venNbrs = new Map(); // venueId -> [author]
  for (const { u, v } of edges) {
    (revNbrs.get(u) ?? revNbrs.set(u, []).get(u)).push(v);
    (venNbrs.get(v) ?? venNbrs.set(v, []).get(v)).push(u);
  }

  const norm = ([a, b]) => {
    const s = a + b || 1;
    return [a / s, b / s];
  };

  for (let it = 0; it < ITERS; it++) {
    // reviewer -> venue messages
    for (const [u, vs] of revNbrs) {
      const prior = [1 - revPrior.get(u), revPrior.get(u)];
      for (const v of vs) {
        // product of incoming venue->reviewer messages except from v
        let pH = prior[0];
        let pF = prior[1];
        for (const v2 of vs) {
          if (v2 === v) continue;
          const m = mVU.get(`${v2}|${u}`);
          pH *= m[0];
          pF *= m[1];
        }
        // marginalize reviewer state against edge potential for each venue state
        const toGenuine = pH * psi(0, 0) + pF * psi(1, 0);
        const toBad = pH * psi(0, 1) + pF * psi(1, 1);
        mUV.set(`${u}|${v}`, norm([toGenuine, toBad]));
      }
    }
    // venue -> reviewer messages
    for (const [v, us] of venNbrs) {
      const vp = venuePrior.get(v) ?? 0.4;
      const prior = [1 - vp, vp];
      for (const u of us) {
        let pG = prior[0];
        let pB = prior[1];
        for (const u2 of us) {
          if (u2 === u) continue;
          const m = mUV.get(`${u2}|${v}`);
          pG *= m[0];
          pB *= m[1];
        }
        const toHonest = pG * psi(0, 0) + pB * psi(0, 1);
        const toFraud = pG * psi(1, 0) + pB * psi(1, 1);
        mVU.set(`${v}|${u}`, norm([toHonest, toFraud]));
      }
    }
  }

  // Venue beliefs.
  const fraud = new Map();
  for (const v of venueIds) {
    const vp = venuePrior.get(v) ?? 0.4;
    let pG = 1 - vp;
    let pB = vp;
    for (const u of venNbrs.get(v) ?? []) {
      const m = mUV.get(`${u}|${v}`);
      pG *= m[0];
      pB *= m[1];
    }
    const [, b] = norm([pG, pB]);
    fraud.set(v, Number(b.toFixed(3)));
  }
  return fraud;
}

export default propagateFraud;
