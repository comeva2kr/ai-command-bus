// State store for the personalized feed.
//
// Holds users, their preference vectors, rating history, and comments. Backed
// by an in-memory map with optional JSON-file persistence so a running server
// survives restarts. No external database required — this keeps the project's
// zero-dependency posture while still being real enough to demo end to end.

import fs from "node:fs";
import { emptyPreferenceVector, buildPreferenceVector } from "./survey.js";
import { inferFromHistory, mergeVectors } from "./history.js";
import { validatePost, validateComment, userLevel } from "./rules.js";

function nowIso(clock) {
  // `clock` is injected so tests and reproducible runs don't depend on the
  // wall clock (Date.now is also unavailable in some sandboxes).
  return clock ? clock() : new Date().toISOString();
}

export class FeedStore {
  // opts.clock: () => ISO string, opts.file: path for persistence
  constructor(opts = {}) {
    this.clock = opts.clock || null;
    this.file = opts.file || null;
    this.users = new Map(); // userId -> user record
    this._seq = 0;
    if (this.file && fs.existsSync(this.file)) this._load();
  }

  _id(prefix) {
    this._seq += 1;
    return `${prefix}_${this._seq}`;
  }

  createUser(userId) {
    const id = userId || this._id("user");
    if (this.users.has(id)) return this.users.get(id);
    const user = {
      id,
      preferences: emptyPreferenceVector(),
      surveyed: false,
      feedbackCount: 0,
      ageVerified: false, // 성인인증 여부 — 19금 콘텐츠 노출의 필수 조건
      showAdult: false, // 19금 토글 상태 (인증된 경우에만 유효)
      saved: [], // 스크랩한 itemId 목록
      mutedSources: [], // 사용자가 피드에서 숨긴 소스
      ratings: {}, // itemId -> { signal, at }
      seen: [], // itemIds shown, most-recent last
      comments: [], // { id, itemId, body, at }
      createdAt: nowIso(this.clock)
    };
    this.users.set(id, user);
    this._persist();
    return user;
  }

  getUser(userId) {
    return this.users.get(userId) || null;
  }

  requireUser(userId) {
    const user = this.getUser(userId);
    if (!user) throw new Error(`unknown user: ${userId}`);
    return user;
  }

  // Store survey answers and seed the initial preference vector.
  saveSurvey(userId, answers) {
    const user = this.requireUser(userId);
    const surveyVec = buildPreferenceVector(answers);
    // if the user warm-started from browsing history, fold that signal in at a
    // reduced weight so the explicit survey answers lead but the inferred taste
    // isn't thrown away
    if (user.warmStarted) mergeVectors(surveyVec, user.preferences, 0.6);
    user.preferences = surveyVec;
    user.surveyAnswers = answers;
    user.surveyed = true;
    this._persist();
    return user;
  }

  // Warm-start from browsing history: infer a vector and merge it in. Runs
  // before or after the survey; survey/feedback still dominate via bigger steps.
  applyHistory(userId, entries) {
    const user = this.requireUser(userId);
    const { vector, hits, entriesSeen } = inferFromHistory(entries);
    mergeVectors(user.preferences, vector, 1);
    user.warmStarted = true;
    user.historyHits = hits;
    // a strong footprint gives a small confidence head start
    const signalCount = hits.sources + hits.keywords;
    if (signalCount >= 3) user.feedbackCount = Math.max(user.feedbackCount, Math.min(6, Math.floor(signalCount / 3)));
    this._persist();
    return { hits, entriesSeen, preferences: user.preferences };
  }

  // Mark a user as age-verified (real deployments wire this to an actual
  // 성인인증/PASS flow; here it records the verified result).
  verifyAge(userId) {
    const user = this.requireUser(userId);
    user.ageVerified = true;
    this._persist();
    return user;
  }

  // Toggle the 19금 view. Only takes effect when the user is age-verified;
  // an unverified user can never turn it on.
  setShowAdult(userId, on) {
    const user = this.requireUser(userId);
    user.showAdult = Boolean(on) && user.ageVerified === true;
    this._persist();
    return user.showAdult;
  }

  // Record that an implicit signal was applied (for observability/metrics). The
  // preference-vector mutation itself happens in the engine via applyImplicit.
  recordSignal(userId, itemId, type, step) {
    const user = this.requireUser(userId);
    user.implicitCount = (user.implicitCount || 0) + 1;
    user.lastSignal = { itemId, type, step, at: nowIso(this.clock) };
    this._persist();
    return user.implicitCount;
  }

  recordRating(userId, itemId, signal) {
    const user = this.requireUser(userId);
    const prev = user.ratings[itemId];
    user.ratings[itemId] = { signal, at: nowIso(this.clock) };
    // only count the first rating of an item toward confidence volume
    if (!prev) user.feedbackCount += 1;
    this._persist();
    return user.ratings[itemId];
  }

  markSeen(userId, itemIds) {
    const user = this.requireUser(userId);
    const set = new Set(user.seen);
    for (const id of itemIds) set.add(id);
    user.seen = [...set].slice(-500); // cap memory
    this._persist();
    return user.seen.length;
  }

  seenSet(userId) {
    const user = this.getUser(userId);
    return new Set(user ? user.seen : []);
  }

  // User-generated post. Becomes a first-class feed item (kind "community",
  // source "me"), so the space really behaves like a community built for you.
  _nowMs() {
    return Date.parse(nowIso(this.clock));
  }

  // Count a user's recent posts/comments within a window, for rate limiting.
  recentActionCount(userId, type, windowMs) {
    const now = this._nowMs();
    if (type === "post") {
      return (this.posts || []).filter(
        (p) => p.userId === userId && now - Date.parse(p.publishedAt) < windowMs
      ).length;
    }
    const user = this.getUser(userId);
    return (user && user.comments ? user.comments : []).filter(
      (c) => now - Date.parse(c.at) < windowMs
    ).length;
  }

  createPost(userId, post) {
    const user = this.requireUser(userId);
    // enforce the space's posting rules (length, banned words, tags, rate limit)
    const check = validatePost(post, {
      recentPosts: this.recentActionCount(userId, "post", 10 * 60 * 1000)
    });
    if (!check.ok) {
      const err = new Error(check.errors.join(" "));
      err.rule = check;
      throw err;
    }
    const title = String(post.title || "").trim();
    const record = {
      id: this._id("post"),
      userId,
      kind: "community",
      source: "me",
      category: post.category || "life",
      tags: Array.isArray(post.tags) ? post.tags.slice(0, 8) : [],
      title: title.slice(0, 300),
      summary: String(post.summary || post.body || "").slice(0, 2000),
      author: userId,
      adult: post.adult === true,
      lang: "ko",
      score: 0,
      commentCount: 0,
      publishedAt: nowIso(this.clock)
    };
    if (!this.posts) this.posts = [];
    this.posts.push(record);
    user.posts = user.posts || [];
    user.posts.push(record.id);
    this._persist();
    return record;
  }

  // All user posts, for a store-backed feed source.
  allPosts() {
    return this.posts || [];
  }

  // Scrap / un-scrap an item. Returns the new saved state (boolean).
  toggleSave(userId, itemId, on) {
    const user = this.requireUser(userId);
    user.saved = user.saved || [];
    const has = user.saved.includes(itemId);
    const want = on == null ? !has : Boolean(on);
    if (want && !has) user.saved.push(itemId);
    if (!want && has) user.saved = user.saved.filter((id) => id !== itemId);
    this._persist();
    return want;
  }

  savedIds(userId) {
    const user = this.getUser(userId);
    return user && user.saved ? user.saved : [];
  }

  // Mute / unmute a source so it stops appearing in the feed. Returns muted list.
  setMute(userId, source, muted) {
    const user = this.requireUser(userId);
    user.mutedSources = user.mutedSources || [];
    const has = user.mutedSources.includes(source);
    if (muted && !has) user.mutedSources.push(source);
    if (!muted && has) user.mutedSources = user.mutedSources.filter((s) => s !== source);
    this._persist();
    return user.mutedSources;
  }

  mutedSet(userId) {
    const user = this.getUser(userId);
    return new Set(user && user.mutedSources ? user.mutedSources : []);
  }

  // "내 공간" — everything the user has created or reacted to in one place.
  mySpace(userId) {
    const user = this.requireUser(userId);
    const myPosts = (this.posts || []).filter((p) => p.userId === userId);
    const myComments = user.comments || [];
    const ratings = Object.entries(user.ratings || {}).map(([itemId, r]) => ({ itemId, ...r }));
    const liked = ratings.filter((r) => r.signal > 0).length;
    const disliked = ratings.filter((r) => r.signal < 0).length;

    // likes received on this user's own posts, across everyone's ratings —
    // the reputation signal that drives level progression
    const myPostIds = new Set(myPosts.map((p) => p.id));
    let likesReceived = 0;
    for (const u of this.users.values()) {
      for (const [itemId, r] of Object.entries(u.ratings || {})) {
        if (r.signal > 0 && myPostIds.has(itemId)) likesReceived += 1;
      }
    }

    const counts = {
      posts: myPosts.length,
      comments: myComments.length,
      likes: liked,
      dislikes: disliked,
      saved: (user.saved || []).length,
      likesReceived
    };
    return {
      posts: myPosts,
      comments: myComments,
      ratings: { total: ratings.length, liked, disliked, items: ratings },
      savedIds: user.saved || [],
      mutedSources: user.mutedSources || [],
      level: userLevel(counts),
      counts
    };
  }

  addComment(userId, itemId, body) {
    const user = this.requireUser(userId);
    const check = validateComment(body, {
      recentComments: this.recentActionCount(userId, "comment", 10 * 60 * 1000)
    });
    if (!check.ok) {
      const err = new Error(check.errors.join(" "));
      err.rule = check;
      throw err;
    }
    const text = String(body || "").trim();
    const comment = {
      id: this._id("cmt"),
      userId,
      itemId,
      body: text.slice(0, 2000),
      at: nowIso(this.clock)
    };
    user.comments.push(comment);
    if (!this.commentsByItem) this.commentsByItem = new Map();
    const list = this.commentsByItem.get(itemId) || [];
    list.push(comment);
    this.commentsByItem.set(itemId, list);
    this._persist();
    return comment;
  }

  commentsFor(itemId) {
    if (!this.commentsByItem) return [];
    return this.commentsByItem.get(itemId) || [];
  }

  _persist() {
    if (!this.file) return;
    const data = {
      seq: this._seq,
      users: [...this.users.values()],
      posts: this.posts || []
    };
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this._seq = data.seq || 0;
      this.users = new Map();
      this.commentsByItem = new Map();
      this.posts = data.posts || [];
      for (const user of data.users || []) {
        this.users.set(user.id, user);
        for (const c of user.comments || []) {
          const list = this.commentsByItem.get(c.itemId) || [];
          list.push(c);
          this.commentsByItem.set(c.itemId, list);
        }
      }
    } catch (err) {
      // corrupt persistence should not crash startup — start fresh
      this.users = new Map();
    }
  }
}
