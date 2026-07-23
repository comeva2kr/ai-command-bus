// Feed engine: glue between sources, the store, and the recommender.
//
// Produces the endless personalized stream. Ranking excludes items the user has
// already been shown, so scrolling never repeats — the piece that makes the
// stream feel smooth instead of the page-by-page shuffling of a plain
// aggregator. The client keeps the rendered DOM and restores scroll on back
// navigation; the server just keeps handing out the next best unseen batch.

import { collect, SeedSource, resolveCap } from "./content.js";
import { rankItems, diversify, applyFeedback, applyImplicit, explain, specializationLevel, feedPhase } from "./recommender.js";
import { collaborativeBoosts } from "./collab.js";
import { categoryLabel, sourceLabel } from "./taxonomy.js";
import { hotness } from "./ingest.js";

// How long a collected item stays in the rolling pool before it's eligible for
// eviction (David 2026-07-24: refresh should *accumulate*, not replace — a
// community board's items outlive any single 15-minute poll interval).
// Override with FEED_RETENTION_MS. "me"/"seed" pseudo-sources are exempt —
// a user's own posts and the offline dev dataset never age out this way.
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;

// Turn a structured reason into a short human label for the "추천 이유" chip.
function reasonLabel(r) {
  switch (r.kind) {
    case "category": return categoryLabel(r.key);
    case "tag": return "#" + r.key;
    case "source": return sourceLabel(r.key) + " 즐겨찾기";
    case "popular": return "인기글";
    case "fresh": return "최신";
    case "explore": return "새로운 탐색";
    default: return r.key;
  }
}

export class FeedEngine {
  constructor(store, sources) {
    this.store = store;
    this.sources = sources && sources.length ? sources : [new SeedSource()];
    this._cache = null; // collected items cache — the capped, ranked-over view of the pool
    this._pool = new Map(); // id -> { item, firstSeenAt } — the rolling accumulation pool
    this._clock = store && store.clock ? store.clock : null; // injectable time for tests
  }

  async _items() {
    if (!this._cache) await this.refresh();
    return this._cache;
  }

  // Force a re-collection on next read (e.g. after wiring a live source).
  // Only clears the *capped view* — the accumulation pool itself is untouched,
  // so this still merges rather than starting the 48h window over.
  invalidate() {
    this._cache = null;
  }

  // Re-collect from all sources and merge into the rolling pool by stableId
  // (a re-collected post keeps its id, so it just updates in place) rather
  // than replacing the pool wholesale — a community board's items live far
  // longer than one poll interval. Pool entries older than FEED_RETENTION_MS
  // (since first seen, not their claimed publish date — many list-adapter
  // items don't reliably carry one) are evicted, then each source is capped
  // again post-accumulation, newest-first, so the pool can't grow unbounded
  // over many refresh cycles even though a single collect() already capped
  // each individual fetch batch.
  async refresh() {
    const { items: freshItems, errors } = await collect(this.sources);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    for (const item of freshItems) {
      const prior = this._pool.get(item.id);
      this._pool.set(item.id, { item, firstSeenAt: prior ? prior.firstSeenAt : now });
    }

    const retentionMs = Number(process.env.FEED_RETENTION_MS || DEFAULT_RETENTION_MS);
    for (const [id, entry] of this._pool) {
      const src = entry.item.source;
      if (src === "seed" || src === "me") continue; // never age out a user's own posts or the dev dataset
      if (now - entry.firstSeenAt > retentionMs) this._pool.delete(id);
    }

    const kindBySource = new Map(this.sources.map((s) => [s.id, s.kind]));
    const bySource = new Map();
    for (const entry of this._pool.values()) {
      const src = entry.item.source || "unknown";
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(entry);
    }
    const capped = [];
    for (const [src, entries] of bySource) {
      if (src === "seed" || src === "me") {
        capped.push(...entries.map((e) => e.item));
        continue;
      }
      // newest-first: prefer the item's own publish date, fall back to when
      // we first saw it (covers list-adapter items with no reliable date)
      entries.sort((a, b) => {
        const at = (a.item.publishedAt && Date.parse(a.item.publishedAt)) || a.firstSeenAt;
        const bt = (b.item.publishedAt && Date.parse(b.item.publishedAt)) || b.firstSeenAt;
        return bt - at;
      });
      const cap = resolveCap(kindBySource.get(src), {});
      capped.push(...(cap > 0 ? entries.slice(0, cap) : entries).map((e) => e.item));
    }

    this._cache = capped;
    this._errors = errors;
    this.lastRefreshedAt = now;
    // memory visibility: the pool can only grow across a 48h window, not forever —
    // this is the number to watch if that ever needs revisiting.
    console.log(`[feed] pool: ${this._pool.size} accumulated (${Math.round(retentionMs / 3.6e6)}h retention) -> ${capped.length} after per-source cap`);
    return { count: capped.length, errors, poolSize: this._pool.size };
  }

  // Periodically update the DB from its sources ("정기적으로 찾으면서 db 업데이트").
  // Returns a stop function; the interval is unref'd so it never blocks exit.
  startAutoRefresh(intervalMs = 15 * 60 * 1000) {
    this.stopAutoRefresh();
    this._timer = setInterval(() => {
      this.refresh().catch(() => {});
    }, intervalMs);
    if (this._timer.unref) this._timer.unref();
    return () => this.stopAutoRefresh();
  }

  stopAutoRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // Return the next batch for a user. `cursor` is an opaque number = how many
  // items already consumed this session; used only as a deterministic seed so
  // repeated identical requests are stable.
  //
  // `source`: when set, scopes the feed to a single community/news source —
  // the "소스별 보기" chip bar. This is a jagei-style board view, not a taste
  // feed, so it skips personalized ranking (and the mute filter, since picking
  // the chip is the opposite of muting it) in favor of latest+공개화제성 order.
  async getFeed(userId, { limit = 10, cursor = 0, markSeen = true, source = null } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);

    // 19금 게이트: 성인인증 + 토글이 모두 켜져 있을 때만 성인 콘텐츠를 후보에 포함.
    // 서버에서 강제하므로 인증되지 않은 사용자에게는 어떤 경우에도 노출되지 않는다.
    const allowAdult = user.ageVerified === true && user.showAdult === true;
    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    let unseen;
    let collabBoosts = new Map();
    if (source) {
      const pool = items.filter(
        (i) => i.source === source && (allowAdult || !i.adult) && !disabled.has(i.source)
      );
      const ranked = pool.map((item) => ({ item, score: hotness(item, now) })).sort((a, b) => b.score - a.score);
      unseen = ranked.filter((r) => !seen.has(r.item.id));
    } else {
      const pool = items.filter(
        (i) => (allowAdult || !i.adult) && !muted.has(i.source) && !disabled.has(i.source)
      );
      // collaborative boost: what similar-taste users liked (no-op with one user)
      collabBoosts = collaborativeBoosts(this.store, userId);
      const ranked = rankItems(pool, user.preferences, { seenIds: seen, seed: cursor + 1, now, collabBoosts });
      // drop already-seen items so the infinite scroll never repeats
      unseen = ranked.filter((r) => !seen.has(r.item.id));
    }
    // diversify so a page isn't dominated by one source/category (a no-op
    // when every candidate already shares the same `source`)
    const fresh = diversify(unseen).slice(0, limit);

    const level = specializationLevel(user.preferences, user.feedbackCount);
    const phase = feedPhase(level);

    const batch = fresh.map((r) => {
      const d = this._decorate(r.item, r.score, user);
      // surface collaborative picks so "사람들이 좋아한" recommendations are visible
      if ((collabBoosts.get(r.item.id) || 0) > 0.2) {
        d.collabPick = true;
        d.reasons = ["비슷한 취향 픽", ...d.reasons].slice(0, 3);
      }
      return d;
    });

    if (markSeen && batch.length) {
      this.store.markSeen(userId, batch.map((b) => b.id));
    }

    return {
      items: batch,
      nextCursor: cursor + batch.length,
      exhausted: batch.length < limit,
      phase,
      level,
      feedbackCount: user.feedbackCount
    };
  }

  _decorate(item, score, user) {
    const rating = user.ratings[item.id];
    const saved = Array.isArray(user.saved) && user.saved.includes(item.id);
    const reasons = user.preferences ? explain(item, user.preferences).map(reasonLabel) : [];
    return {
      ...item,
      adult: item.adult === true,
      categoryLabel: categoryLabel(item.category),
      matchScore: Math.round(score * 100) / 100,
      reasons,
      myRating: rating ? rating.signal : 0,
      saved,
      comments: this.store.commentsFor(item.id).length
    };
  }

  // Resolve a list of item ids to decorated items (for the 스크랩 list).
  async resolveItems(userId, ids) {
    const items = await this._items();
    const byId = new Map(items.map((i) => [i.id, i]));
    const user = this.store.getUser(userId) || { ratings: {}, saved: [] };
    return ids.map((id) => byId.get(id)).filter(Boolean).map((it) => this._decorate(it, 0, user));
  }

  // Record a like/dislike and learn from it. Returns updated confidence.
  async rate(userId, itemId, signal) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error(`unknown item: ${itemId}`);

    applyFeedback(user.preferences, item, signal);
    this.store.recordRating(userId, itemId, signal >= 0 ? 1 : -1);

    const level = specializationLevel(user.preferences, user.feedbackCount);
    return { level, phase: feedPhase(level), feedbackCount: user.feedbackCount };
  }

  // Public share metadata for an item (for OG tags on a shared link). Adult
  // items get no public share page.
  async shareData(itemId) {
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item || item.adult) return null;
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      category: categoryLabel(item.category),
      source: sourceLabel(item.source)
    };
  }

  // Record an implicit engagement signal (dwell / skip / complete / open) and
  // learn from it. The lightweight, high-volume feedback behind TikTok-style
  // personalization.
  async signal(userId, itemId, event) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) return { ok: false };
    const { step } = applyImplicit(user.preferences, item, event || {});
    this.store.recordSignal(userId, itemId, event && event.type, step);
    return { ok: true, type: event && event.type, step };
  }

  // A non-consuming preview of the best unseen items — the payload behind a
  // "관심글 N개가 올라왔어요" re-engagement notification. Does NOT mark items seen,
  // so opening the app afterwards still shows them in the feed.
  async digest(userId, { limit = 5, minScore = 1.0 } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);
    const allowAdult = user.ageVerified === true && user.showAdult === true;
    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
    const pool = items.filter(
      (i) => (allowAdult || !i.adult) && !muted.has(i.source) && !disabled.has(i.source) && !seen.has(i.id)
    );
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    const ranked = rankItems(pool, user.preferences, { seed: 1, now, explore: 0 })
      .filter((r) => r.score >= minScore);
    return {
      count: ranked.length,
      top: ranked.slice(0, limit).map((r) => this._decorate(r.item, r.score, user))
    };
  }

  // A single item with its full comment thread, for the detail view.
  async getItem(userId, itemId) {
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    const user = this.store.getUser(userId);
    // never surface a 19금 item to a user who isn't verified + opted in
    if (item.adult && !(user && user.ageVerified === true && user.showAdult === true)) return null;
    const decorated = this._decorate(item, 0, user || { ratings: {} });
    return { ...decorated, thread: this.store.commentsFor(itemId) };
  }
}
