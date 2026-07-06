// Feed engine: glue between sources, the store, and the recommender.
//
// Produces the endless personalized stream. Ranking excludes items the user has
// already been shown, so scrolling never repeats — the piece that makes the
// stream feel smooth instead of the page-by-page shuffling of a plain
// aggregator. The client keeps the rendered DOM and restores scroll on back
// navigation; the server just keeps handing out the next best unseen batch.

import { collect, SeedSource } from "./content.js";
import { rankItems, applyFeedback, specializationLevel, feedPhase } from "./recommender.js";
import { categoryLabel } from "./taxonomy.js";

export class FeedEngine {
  constructor(store, sources) {
    this.store = store;
    this.sources = sources && sources.length ? sources : [new SeedSource()];
    this._cache = null; // collected items cache
  }

  async _items() {
    if (!this._cache) {
      const { items, errors } = await collect(this.sources);
      this._cache = items;
      this._errors = errors;
    }
    return this._cache;
  }

  // Force a re-collection on next read (e.g. after wiring a live source).
  invalidate() {
    this._cache = null;
  }

  // Return the next batch for a user. `cursor` is an opaque number = how many
  // items already consumed this session; used only as a deterministic seed so
  // repeated identical requests are stable.
  async getFeed(userId, { limit = 10, cursor = 0, markSeen = true } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);

    const ranked = rankItems(items, user.preferences, { seenIds: seen, seed: cursor + 1 });
    // hand out only unseen items so the infinite scroll never repeats
    const fresh = ranked.filter((r) => !seen.has(r.item.id)).slice(0, limit);

    const level = specializationLevel(user.preferences, user.feedbackCount);
    const phase = feedPhase(level);

    const batch = fresh.map((r) => this._decorate(r.item, r.score, user));

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
    return {
      ...item,
      categoryLabel: categoryLabel(item.category),
      matchScore: Math.round(score * 100) / 100,
      myRating: rating ? rating.signal : 0,
      comments: this.store.commentsFor(item.id).length
    };
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

  // A single item with its full comment thread, for the detail view.
  async getItem(userId, itemId) {
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    const user = this.store.getUser(userId);
    const decorated = this._decorate(item, 0, user || { ratings: {} });
    return { ...decorated, thread: this.store.commentsFor(itemId) };
  }
}
