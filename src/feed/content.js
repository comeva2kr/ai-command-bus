// Content model + normalization + a pluggable source layer.
//
// A "content item" is a single post the feed can show — either a news article
// or a community post. Items come from *sources*. A source is any object with
//   { id, kind, async fetch() -> rawItems[] }
// Adapters (RSS, Reddit-style JSON, an internal community DB, ...) all conform
// to that shape, so the recommender never needs to know where an item came
// from. This file ships an offline SeedSource so the whole system runs with no
// network access, plus a normalizer that every adapter should route through.

import { isKnownCategory } from "./taxonomy.js";
import { SEED_ITEMS } from "./seed-data.js";

// Derive a STABLE id from an item's identifying content. Stability matters:
// sources are re-collected periodically, and ratings/comments reference item
// ids — a counter would reassign ids on every refresh and orphan that data.
function stableId(raw, source) {
  const basis = [
    raw.url || "",
    raw.source || (source ? source.id : ""),
    raw.title || "",
    raw.publishedAt || ""
  ].join("|");
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `it_${h.toString(36)}`;
}

// Normalize an arbitrary raw item into the canonical content shape. Adapters
// pass their raw objects through this so downstream code sees one schema.
export function normalizeItem(raw, source) {
  const category = isKnownCategory(raw.category) ? raw.category : "news";
  return {
    id: raw.id || stableId(raw, source),
    kind: raw.kind === "community" ? "community" : "news", // "news" | "community"
    source: raw.source || (source ? source.id : "unknown"),
    // 19금(성인) 여부. 인증되지 않은 사용자에게는 엔진 단에서 절대 노출되지 않는다.
    adult: raw.adult === true,
    // language + translation metadata (overseas sources flow through translate.js)
    lang: raw.lang || "ko",
    translated: raw.translated === true,
    needsTranslation: raw.needsTranslation === true,
    originalLang: raw.originalLang || null,
    category,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 12) : [],
    title: String(raw.title || "").slice(0, 300),
    // excerpt only for aggregated/out-link items (법적 안전: 발췌 ≤200자);
    // the user's own posts ("me") and the dev seed keep their full body
    summary: String(raw.summary || raw.body || "").slice(
      0,
      raw.via === "me" || raw.via === "seed" || !raw.via ? 1000 : 200
    ),
    url: raw.url || null, // out-link to the original (required for aggregated items)
    via: raw.via || "seed", // provenance: seed | rss | api | submit | me
    sourceLabel: raw.sourceLabel || null,
    image: raw.image || null,
    author: raw.author || null,
    // engagement metadata used as weak popularity signals
    score: Number.isFinite(raw.score) ? raw.score : 0,
    commentCount: Number.isFinite(raw.commentCount) ? raw.commentCount : 0,
    // rough word count drives the longform preference match
    length: Number.isFinite(raw.length)
      ? raw.length
      : String(raw.summary || raw.body || "").split(/\s+/).filter(Boolean).length,
    publishedAt: raw.publishedAt || null
  };
}

// Offline source backed by the bundled seed dataset. Always available.
export class SeedSource {
  constructor(items = SEED_ITEMS) {
    this.id = "seed";
    this.kind = "mixed";
    this._items = items;
  }

  async fetch() {
    return this._items.map((raw) => normalizeItem(raw, this));
  }
}

// Source backed by the store's user-generated posts, so a member's own posts
// flow into the shared feed just like any other community content.
export class StorePostsSource {
  constructor(store) {
    this.id = "me";
    this.kind = "community";
    this._store = store;
  }

  async fetch() {
    const posts = this._store.allPosts ? this._store.allPosts() : [];
    const subs = this._store.allSubmissions ? this._store.allSubmissions() : [];
    // user posts keep source "me"; submissions keep their own out-link source
    return [
      ...posts.map((raw) => normalizeItem(raw, this)),
      ...subs.map((raw) => normalizeItem(raw, { id: raw.source, kind: "community" }))
    ];
  }
}

// Generic adapter for feeds that already return normalized-ish JSON. Useful for
// wiring an internal community database or a proxied API. `loader` is an async
// function returning an array of raw items.
export class JsonSource {
  constructor(id, loader, kind = "mixed") {
    this.id = id;
    this.kind = kind;
    this._loader = loader;
  }

  async fetch() {
    const raw = await this._loader();
    return (Array.isArray(raw) ? raw : []).map((r) => normalizeItem(r, this));
  }
}

// Collect and merge items from many sources. Failures in one source never take
// down the whole collection — the feed degrades gracefully to whatever loaded.
export async function collect(sources) {
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));
  const items = [];
  const errors = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      items.push(...res.value);
    } else {
      errors.push({ source: sources[i] && sources[i].id, error: String(res.reason) });
    }
  });
  // de-duplicate by url when present, otherwise by id
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return { items: deduped, errors };
}
