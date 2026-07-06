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

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Normalize an arbitrary raw item into the canonical content shape. Adapters
// pass their raw objects through this so downstream code sees one schema.
export function normalizeItem(raw, source) {
  const category = isKnownCategory(raw.category) ? raw.category : "news";
  return {
    id: raw.id || nextId(source ? source.id : "item"),
    kind: raw.kind === "community" ? "community" : "news", // "news" | "community"
    source: raw.source || (source ? source.id : "unknown"),
    category,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 12) : [],
    title: String(raw.title || "").slice(0, 300),
    summary: String(raw.summary || raw.body || "").slice(0, 1000),
    url: raw.url || null,
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
