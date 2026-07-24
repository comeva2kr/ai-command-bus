// Feed engine: glue between sources, the store, and the recommender.
//
// Produces the endless personalized stream. Ranking excludes items the user has
// already been shown, so scrolling never repeats — the piece that makes the
// stream feel smooth instead of the page-by-page shuffling of a plain
// aggregator. The client keeps the rendered DOM and restores scroll on back
// navigation; the server just keeps handing out the next best unseen batch.

import { collect, SeedSource, resolveCap } from "./content.js";
import {
  rankItems,
  diversify,
  applyFeedback,
  applyImplicit,
  explain,
  specializationLevel,
  feedPhase,
  scoreItem
} from "./recommender.js";
import { collaborativeBoosts } from "./collab.js";
import { categoryLabel, sourceLabel } from "./taxonomy.js";
import { hotGate, rankBySource, topPerSource, roundRobinInterleave, sourceHotScores, hotParams } from "./ingest.js";
import { FILTERABLE_TOPICS } from "./topics.js";
import { injectSlots, adParams, adaptiveEvery, pickAffiliateCandidates, assignVariant, applyVariant } from "./monetize.js";

// How long a collected item stays in the rolling pool before it's eligible for
// eviction (David 2026-07-24: refresh should *accumulate*, not replace — a
// community board's items outlive any single 15-minute poll interval).
// Override with FEED_RETENTION_MS. "me"/"seed" pseudo-sources are exempt —
// a user's own posts and the offline dev dataset never age out this way.
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;

// 정치/종교처럼 기본 숨김인 토픽을 아이템이 갖고 있는데 유저가 아직 켜지 않았다면
// true. "adult"는 FILTERABLE_TOPICS에 없으므로 여기서 절대 걸리지 않는다 — 그 쪽은
// allowAdult(위)가 이미 기존 19금 게이트로 전담한다(중복 게이트 방지).
function topicsBlocked(item, showTopicsSet) {
  const topics = item.topics || [];
  return topics.some((t) => FILTERABLE_TOPICS.includes(t) && !showTopicsSet.has(t));
}

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

  // Per-source item counts in the current collected pool (David 2026-07-24
  // adversarial review #5 — "죽은 소스 칩 자동 숨김"). A source can be
  // `enabled` in the registry yet consistently return 0 items in production
  // (e.g. todayhumor's overseas-IP block) — rather than hand-maintaining an
  // enabled/disabled flag for every such case, the source-chip bar hides
  // itself once there's nothing behind it. See server.js's GET
  // /api/communities and public/index.html's chip-filtering.
  async sourceCounts() {
    const items = await this._items();
    const counts = {};
    for (const item of items) {
      const src = item.source || "unknown";
      counts[src] = (counts[src] || 0) + 1;
    }
    return counts;
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
    const showTopics = new Set(user.showTopics || []);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    let unseen;
    let collabBoosts = new Map();
    if (source) {
      // "submit" is a pseudo-source: every user-submitted out-link, grouped by
      // provenance (via) rather than by the item's own out-link domain (which
      // varies per submission, so there's no single registry source id to
      // filter on).
      const matchesSource = (i) => (source === "submit" ? i.via === "submit" : i.source === source);
      const pool = items.filter(
        (i) =>
          matchesSource(i) &&
          (allowAdult || !i.adult) &&
          !disabled.has(i.source) &&
          !topicsBlocked(i, showTopics)
      );
      // Same hot-curation pipeline as the home feed (2026-07-24 hot-curation
      // v1) — HN-gravity time decay + robust-z/percentile normalization +
      // Bayesian shrinkage — applied to the whole filtered pool as one flat
      // group (this view is already scoped to a single source/provenance, so
      // there's nothing to group further; "submit"'s pool spans many out-link
      // domains but was already scored uniformly before this change too).
      // This is what stops a stale-but-still-#1-ranked RSS item from sitting
      // atop a board's own view forever, same as the home feed below.
      const ranked = sourceHotScores(pool, now)
        .map((s) => ({ item: s.item, score: s.hotScore }))
        .sort((a, b) => b.score - a.score);
      unseen = ranked.filter((r) => !seen.has(r.item.id));
    } else {
      // Unseen is filtered in up front (not after ranking, as the old
      // hotGate/rankItems path did) so the round-robin/min-gap diversity
      // guarantees below hold on *every* page of the infinite scroll, not
      // just a fresh user's first load.
      const pool = items.filter(
        (i) =>
          (allowAdult || !i.adult) &&
          !muted.has(i.source) &&
          !disabled.has(i.source) &&
          !topicsBlocked(i, showTopics) &&
          !seen.has(i.id)
      );
      // "게시판별 핫 + 다양성 라운드로빈" (David 2026-07-24 redesign). Every
      // active source is already a community's own best/hot board (see
      // ingest.js's rankBySource header comment for why even a 0-engagement
      // RSS source still has a meaningful hot rank — its own collection
      // order). This: (1) ranks each source's items hot-first, (2) keeps only
      // each source's top HOT_PER_SOURCE hottest, (3) interleaves round-robin
      // across sources so the stream alternates boards instead of one board's
      // list dominating. Personalization only breaks ties *within* a round —
      // diversity wins over taste here by design ("다양성 > 개인화").
      collabBoosts = collaborativeBoosts(this.store, userId);
      // hotScore (2026-07-24 hot-curation v1, ingest.js's rankBySource/
      // sourceHotScores) is now each source's internal sort key — HN-gravity
      // time decay + per-source robust-z/percentile normalization + Bayesian
      // small-sample shrinkage, so a stale-but-still-rank-0 RSS item can no
      // longer win its source's top-K cut just because nothing displaced it.
      const rankedBySource = pool.length ? rankBySource(pool, now) : new Map();
      const topK = topPerSource(rankedBySource);
      const seed = cursor + 1;
      const { tasteW } = hotParams();
      const scoreFn = (item, rank, hasSignal, hotScoreVal) => {
        const taste = user.preferences
          ? Math.tanh(scoreItem(item, user.preferences, { now, seed, collabBoosts, explore: 0 }) / 4)
          : 0;
        // Lobsters-style additive taste bias: hotScore (objective "화제성")
        // leads, taste only re-sorts within it — never flips a genuinely
        // hotter item behind a merely on-taste one (tasteW default 0.15).
        return (hotScoreVal ?? 0) + tasteW * taste;
      };
      const minGap = Number(process.env.HOT_MIN_GAP ?? 1);
      // Fairness ledger: how many times each source has already been shown to
      // this user across past getFeed calls (see store.recordSourceExposure).
      // Primary sort key in roundRobinInterleave — this is what stops a
      // handful of high-engagement sources from permanently dominating every
      // page (2026-07-24 adversarial review #2). See ingest.js's
      // roundRobinInterleave header for the full root-cause story.
      const exposure = this.store.sourceExposureFor ? this.store.sourceExposureFor(userId) : {};
      const interleaved = roundRobinInterleave(topK, { minGap, scoreFn, exposure });
      unseen = interleaved.map((item) => ({
        item,
        score: user.preferences ? scoreItem(item, user.preferences, { now, seed, collabBoosts, explore: 0 }) : 0
      }));
    }
    // diversify so a page isn't dominated by one source/category (a no-op
    // when every candidate already shares the same `source`). For the home
    // feed (no `source`), skip it: the round-robin interleave above already
    // produced a hard-guaranteed diverse order, and re-running the softer MMR
    // pass here would only undo that structure for no benefit.
    const fresh = source ? diversify(unseen).slice(0, limit) : unseen.slice(0, limit);

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
      // feed the round-robin fairness ledger (see the `exposure` block above)
      // regardless of view — a source shown via source= should count too, so
      // the home feed doesn't re-show it excessively right after.
      if (this.store.recordSourceExposure) {
        this.store.recordSourceExposure(userId, batch.map((b) => b.source));
      }
    }

    // ---- monetization: affiliate/ad slot insertion (docs/monetization.md) ----
    // Applied AFTER seen/exposure bookkeeping above so slot items never touch
    // the organic dedup/fairness ledgers — they're generated fresh per
    // request (monetize.js), not drawn from the collected pool, and must
    // never count as "an item this user has been shown" for personalization.
    // `nextCursor` below stays based on `batch.length` (organic count only)
    // so pagination is unaffected by however many slots got inserted.
    //
    // 19금/정치/종교 필터가 켜진 뷰에는 절대 노출하지 않는다 — 신뢰 훼손 방지
    // + 광고 네트워크 계정정지 리스크 (docs/monetization.md Non-Goals).
    const monetizeAllowed = !allowAdult && !showTopics.has("politics") && !showTopics.has("religion");
    const displayItems = monetizeAllowed ? this._monetize(userId, user, batch, cursor).items : batch;

    return {
      items: displayItems,
      nextCursor: cursor + batch.length,
      exhausted: batch.length < limit,
      phase,
      level,
      feedbackCount: user.feedbackCount
    };
  }

  // Insert affiliate/ad slots into an already-decorated organic batch. Thin
  // glue: monetize.js owns the placement rules + candidate shaping — this
  // wires in this request's user preference vector, this user's ad
  // click-through history (for adaptive density), and their A/B variant.
  // Returns { items, slots } (slots kept for callers that want placement
  // metadata; getFeed above only uses .items).
  _monetize(userId, user, batch, cursor) {
    const partnerId = process.env.COUPANG_PARTNER_ID || null;
    const preview = Boolean(process.env.AD_PREVIEW);
    if (!partnerId && !preview) return { items: batch, slots: [] }; // 절대원칙1: dummy content 금지

    const variant = assignVariant(userId);
    const params = applyVariant(adParams(), variant);
    const responsiveness = this.store.adResponsiveness ? this.store.adResponsiveness(userId) : null;
    const every = adaptiveEvery(params.every, responsiveness);
    const candidates = pickAffiliateCandidates(user.preferences, { partnerId, preview, seed: cursor + 1 }).map(
      (c) => ({ ...c, variant })
    );
    return injectSlots(batch, candidates, { ...params, every, startIndex: cursor });
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
    const showTopics = new Set(user.showTopics || []);
    const pool = items.filter(
      (i) =>
        (allowAdult || !i.adult) &&
        !muted.has(i.source) &&
        !disabled.has(i.source) &&
        !topicsBlocked(i, showTopics) &&
        !seen.has(i.id)
    );
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    // Same hot-only gate as the main feed (see getFeed) — the digest previews
    // "what you'd see if you opened the app now," so it must draw from the
    // same hot-gated pool, not a superset of it.
    const gated = pool.length ? hotGate(pool, now) : [];
    const hotPool = gated.length ? gated.filter((r) => r.hot).map((r) => r.item) : pool;
    const rankPool = hotPool.length ? hotPool : pool;
    const ranked = rankItems(rankPool, user.preferences, { seed: 1, now, explore: 0 })
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
