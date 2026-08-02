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
import { eventKey } from "./dedupe.js";
import { SEED_ITEMS } from "./seed-data.js";
import { classifyTopics } from "./topics.js";

// Derive a STABLE id from an item's identifying content. Stability matters:
// sources are re-collected periodically, and ratings/comments reference item
// ids — a counter would reassign ids on every refresh and orphan that data.
function stableId(url, sourceId, title, publishedAt) {
  const basis = [url || "", sourceId || "", title || "", publishedAt || ""].join("|");
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `it_${h.toString(36)}`;
}

// A source's own RSS/API sometimes hands back a plain http:// link even
// though the site itself serves https fine (ppomppu's RSS does this — the
// 2026-07-24 bug: our https-served app iframing an http:// original gets hard
// mixed-content-blocked, which the frame viewer's 5s watchdog only surfaced
// as a stall). Upgrading is opt-in per source (raw.httpsOk, stamped by
// registry.js from the community entry's `httpsOk`, default true) so a
// source we haven't actually verified never gets a link silently rewritten
// to a URL that might not even exist. "me"/"submit"/"seed" items never carry
// this field at all, so they're never touched by this.
function upgradeToHttps(url, httpsOk) {
  if (typeof url !== "string" || !url.startsWith("http://")) return url || null;
  return httpsOk === true ? "https://" + url.slice("http://".length) : url;
}

// Single normalization point for every `image` URL the feed ever shows,
// regardless of which layer found it (fetchers.js's RSS media/enclosure/img
// extraction, its list-adapter thumbRegex, or ingest.js's OG image for
// user-submitted links). We only ever hotlink the source's own URL — never
// download or re-host it (docs/legal.md) — so this just has to turn whatever
// shape a source handed back into a safe, absolute, https(-preferred) URL, or
// drop it outright rather than ship a broken/unsafe src to the client:
//   - protocol-relative ("//cdn.site.co.kr/x.jpg") -> "https:" + it
//   - not an absolute http(s) URL at this point (a stray relative path a
//     source-level resolver had no urlBase to resolve, or garbage) -> null
//   - plain http:// -> upgraded to https:// only when this source's own
//     httpsOk flag (same one url-upgrading already trusts) confirms the
//     source's domain actually serves https
function normalizeImageUrl(url, httpsOk) {
  let raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return null;
  if (raw.startsWith("//")) raw = "https:" + raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  return upgradeToHttps(raw, httpsOk);
}

// Normalize an arbitrary raw item into the canonical content shape. Adapters
// pass their raw objects through this so downstream code sees one schema.
export function normalizeItem(raw, source) {
  const category = isKnownCategory(raw.category) ? raw.category : "news";
  const sourceId = raw.source || (source ? source.id : "unknown");
  const url = upgradeToHttps(raw.url, raw.httpsOk);
  // 분류 태그(키워드+게시판 기반, AI 아님) — topics.js. politics/religion은
  // 유저 토글로 기본 숨김(engine.js), adult는 아래에서 기존 19금 필드에 합류시켜
  // 별도 게이트를 만들지 않고 기존 verify-age/adult 게이트 하나로 처리한다.
  const topics = classifyTopics({ title: raw.title, url, sourceId });
  return {
    id: raw.id || stableId(url, sourceId, raw.title, raw.publishedAt),
    // "news" | "community". 개별 아이템이 kind를 들고 오는 경우는 드물고(대부분
    // 어댑터는 제목/링크만 준다), 실제 구분은 소스 등록 정보(communities.json의
    // kind -> JsonSource.kind)에 있다. 예전엔 raw.kind만 봐서 그 값이 아이템까지
    // 내려오지 않았고, 그 결과 커뮤니티 소스 17곳의 글이 전부 "뉴스"로 표시됐다
    // (카드의 커뮤/뉴스 배지가 항상 "뉴스", 2026-07-28 실측).
    kind: (raw.kind || (source && source.kind)) === "community" ? "community" : "news",
    source: sourceId,
    // 19금(성인) 여부. 인증되지 않은 사용자에게는 엔진 단에서 절대 노출되지 않는다.
    // 게시판/키워드 분류가 adult로 판정한 경우도 같은 필드로 합류(중복 게이트 금지).
    adult: raw.adult === true || topics.includes("adult"),
    topics,
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
    url: url || null, // out-link to the original (required for aggregated items) — https-upgraded above if applicable
    via: raw.via || "seed", // provenance: seed | rss | api | submit | me
    sourceLabel: raw.sourceLabel || null,
    // 원본 서버 URL 핫링크만 — 저장/재호스팅 안 함 (docs/legal.md). 상대/
    // protocol-relative 형태는 normalizeImageUrl이 절대 URL로 정리하거나,
    // 정리 불가하면(urlBase 없는 상대경로 등) 조용히 null로 떨어뜨린다.
    image: normalizeImageUrl(raw.image, raw.httpsOk),
    author: raw.author || null,
    // engagement metadata used as weak popularity signals
    score: Number.isFinite(raw.score) ? raw.score : 0,
    commentCount: Number.isFinite(raw.commentCount) ? raw.commentCount : 0,
    // 뉴스 전용 화제성 신호 — 구글뉴스가 이 사건으로 함께 묶은 관련 기사 수
    // (fetchers.js의 relatedCoverage). 뉴스에는 추천수·댓글수가 아예 없어서
    // 이게 유일한 실측 반응 대용이다. 그 개념이 없는 소스는 0.
    coverage: Number.isFinite(raw.coverage) ? raw.coverage : 0,
    // rough word count drives the longform preference match
    length: Number.isFinite(raw.length)
      ? raw.length
      : String(raw.summary || raw.body || "").split(/\s+/).filter(Boolean).length,
    publishedAt: raw.publishedAt || null,
    // Board-hot rank (David 2026-07-24 home-feed redesign): this item's
    // 0-based position within its own source's *returned* order — RSS doc
    // order, a list-adapter's page-scan order, HN's front-page order, etc.
    // Stamped by registry.js at collection time, one source at a time, so it
    // always means "this source's own hot/best board rank," never mixed
    // across sources. null when the item didn't come through that stamping
    // (seed/me items built directly, or tests constructing raw items by
    // hand) — engine.js falls back to array position in that case. See
    // ingest.js's rankBySource for how this is used.
    sourceRank: Number.isFinite(raw.sourceRank) ? raw.sourceRank : null
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

// Per-source caps applied during collection, tiered by source kind. News RSS
// (gnews' 100+ item pages) is naturally high-volume but low-depth — capped
// tight so it can't flood the shared pool. Community boards are the whole
// point of "베스트게시판 글을 싹 가져와야" (David, 2026-07-24) — capped loose so a
// multi-page list fetch (see fetchers.js) actually shows up in the feed.
// FEED_SOURCE_CAP is kept as a blanket fallback for whichever tier doesn't
// have its own env var set, for backward compatibility with earlier configs.
const DEFAULT_COMMUNITY_CAP = 100;
const DEFAULT_NEWS_CAP = 20;

export function resolveCap(kind, opts) {
  if (opts.perSourceCap != null) return opts.perSourceCap; // universal override wins outright
  const isNews = kind === "news";
  const specificOpt = isNews ? opts.newsCap : opts.communityCap;
  if (specificOpt != null) return Number(specificOpt);
  const specificEnv = isNews ? process.env.FEED_NEWS_CAP : process.env.FEED_COMMUNITY_CAP;
  if (specificEnv != null) return Number(specificEnv);
  if (process.env.FEED_SOURCE_CAP != null) return Number(process.env.FEED_SOURCE_CAP);
  return isNews ? DEFAULT_NEWS_CAP : DEFAULT_COMMUNITY_CAP;
}

// Collect and merge items from many sources. Failures in one source never take
// down the whole collection — the feed degrades gracefully to whatever loaded.
export async function collect(sources, opts = {}) {
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));
  const items = [];
  const errors = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      const list = Array.isArray(res.value) ? res.value : [];
      const src = sources[i];
      // "seed" and "me" are aggregate pseudo-sources (the whole bundled dev
      // dataset / every user's own posts, respectively) — not a single noisy
      // feed, so the per-*community* cap doesn't apply to them.
      const id = src && src.id;
      const exempt = id === "seed" || id === "me";
      const cap = resolveCap(src && src.kind, opts);
      items.push(...(cap > 0 && !exempt ? list.slice(0, cap) : list));
    } else {
      errors.push({ source: sources[i] && sources[i].id, error: String(res.reason) });
    }
  });
  // 중복 제거: URL(또는 id) + 제목 정규화 키를 **함께** 본다.
  //
  // URL만으로는 못 잡는다 — 구글뉴스 항목의 url은 불투명한 리다이렉트라
  // 원문 매체가 같은 기사를 올려도 절대 겹치지 않는다. 말머리만 다른
  // "[속보] X" / "X" 쌍도 마찬가지다(2026-08-02 검수 실측, 첫 화면에 나란히).
  //
  // 제목 키는 짧으면 null이 되어 묶지 않는다(dedupe.js MIN_KEY_LEN). 커뮤니티의
  // "ㅋㅋㅋ" 같은 제목을 묶으면 서로 다른 글이 사라진다 — URL 정규화를 과하게
  // 했다가 게시판 글이 붕괴했던 2026-08-01 회귀와 같은 종류의 사고다.
  const seen = new Set();
  const seenTitle = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (seen.has(key)) continue;
    const tkey = eventKey(item.title);
    if (tkey && seenTitle.has(tkey)) continue;
    seen.add(key);
    if (tkey) seenTitle.add(tkey);
    deduped.push(item);
  }
  return { items: deduped, errors };
}
