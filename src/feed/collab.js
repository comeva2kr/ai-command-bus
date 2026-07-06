// Collaborative filtering — "사람들이 좋아한" the other half of TikTok's engine.
//
// Content-based ranking only knows what *you* told it. Collaborative filtering
// adds the crowd: find users whose taste vector is close to yours, then boost
// the items they liked that you haven't seen. With one user it's a no-op; as the
// space grows it surfaces things your own signals never would.

// Flatten a preference vector into a namespaced sparse map for similarity.
function flatten(vec) {
  const m = new Map();
  for (const [k, v] of Object.entries(vec.categories || {})) m.set("c:" + k, v);
  for (const [k, v] of Object.entries(vec.tags || {})) m.set("t:" + k, v);
  for (const [k, v] of Object.entries(vec.sources || {})) m.set("s:" + k, v);
  return m;
}

export function cosineSimilarity(vecA, vecB) {
  const a = flatten(vecA);
  const b = flatten(vecB);
  if (!a.size || !b.size) return 0;
  let dot = 0;
  for (const [k, v] of a) if (b.has(k)) dot += v * b.get(k);
  const norm = (m) => Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0));
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot / denom;
}

// Top-k users most similar to the target (excluding the target and empty vectors).
export function neighbors(users, targetUserId, k = 10) {
  const target = users.find((u) => u.id === targetUserId);
  if (!target) return [];
  const sims = [];
  for (const u of users) {
    if (u.id === targetUserId) continue;
    if (!u.preferences || !Object.keys(u.preferences.categories || {}).length) continue;
    const sim = cosineSimilarity(target.preferences, u.preferences);
    if (sim > 0) sims.push({ user: u, sim });
  }
  return sims.sort((x, y) => y.sim - x.sim).slice(0, k);
}

// Boost map: itemId -> collaborative score, from what similar users liked.
// `store` supplies all users; boosts are similarity-weighted sums of neighbours'
// positive ratings, capped so CF nudges rather than dominates content relevance.
export function collaborativeBoosts(store, targetUserId, opts = {}) {
  const k = opts.k ?? 10;
  const minSim = opts.minSim ?? 0.15;
  const scale = opts.scale ?? 0.6;
  const cap = opts.cap ?? 1.5;

  const users = [...store.users.values()];
  const neigh = neighbors(users, targetUserId, k).filter((n) => n.sim >= minSim);

  const boosts = new Map();
  for (const { user, sim } of neigh) {
    for (const [itemId, r] of Object.entries(user.ratings || {})) {
      if (r.signal > 0) {
        boosts.set(itemId, Math.min(cap, (boosts.get(itemId) || 0) + sim * scale));
      } else if (r.signal < 0) {
        boosts.set(itemId, Math.max(-cap, (boosts.get(itemId) || 0) - sim * scale * 0.5));
      }
    }
  }
  return boosts;
}
