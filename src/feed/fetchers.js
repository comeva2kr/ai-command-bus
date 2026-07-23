// Live ingestion adapters.
//
// The registry (registry.js) accepts an injected `fetcher(entry)` for non-seed
// communities. This module provides real fetchers — RSS/Atom, Hacker News, and
// Reddit-style JSON — and a `makeFetcher` dispatcher that picks one by the
// entry's adapter type. Everything routes raw results into the shape
// normalizeItem expects (title, summary, url, publishedAt, score, commentCount).
//
// Network access is deliberately injectable (`fetchImpl`) so this is testable
// offline with fixtures and works wherever the host's network policy allows the
// target domains. In environments that block outbound HTTP to these hosts, keep
// the communities' `enabled` flag false and the app runs on the seed dataset.
//
// TLS note: behind a re-terminating proxy, set NODE_EXTRA_CA_CERTS to the CA
// bundle so global fetch trusts the proxy (see the environment's proxy README).

const DEFAULT_UA = "ai-command-bus-feed/0.1 (+https://github.com/comeva2kr/ai-command-bus)";

const FETCH_TIMEOUT_MS = 8000; // a slow feed must never stall collection

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": DEFAULT_UA, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": DEFAULT_UA, accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// --- RSS / Atom -----------------------------------------------------------

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (m) return decodeXml(stripCdata(m[1])).trim();
  // self-closing/attribute form, e.g. Atom <link href="..."/>
  const a = block.match(new RegExp(`<${name}[^>]*\\bhref=["']([^"']+)["']`, "i"));
  return a ? a[1].trim() : "";
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

// Parse an RSS 2.0 or Atom document into raw feed items. Pure string parsing,
// no XML dependency — good enough for well-formed feeds.
export function parseRss(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = xml.match(blockRe) || [];
  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;
    const rawDesc = isAtom ? tag(block, "summary") || tag(block, "content") : tag(block, "description");
    items.push({
      title,
      summary: stripHtml(rawDesc),
      url: tag(block, "link") || tag(block, "guid"),
      publishedAt: normalizeDate(tag(block, isAtom ? "updated" : "pubDate"))
    });
  }
  return items;
}

function normalizeDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function rssFetcher(url, fetchImpl = fetch) {
  return async () => parseRss(await getText(url, fetchImpl));
}

// --- Hacker News (Algolia front page) ------------------------------------

export function hackerNewsFetcher(fetchImpl = fetch, hitsPerPage = 30) {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${hitsPerPage}`;
  return async () => {
    const data = await getJson(url, fetchImpl);
    return (data.hits || []).map((h) => ({
      id: `hn_${h.objectID}`,
      title: h.title,
      summary: h.story_text ? stripHtml(h.story_text) : "",
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: h.points || 0,
      commentCount: h.num_comments || 0,
      author: h.author || null,
      publishedAt: h.created_at || null,
      lang: "en"
    }));
  };
}

// --- Reddit-style JSON listing -------------------------------------------

export function redditFetcher(subreddit, fetchImpl = fetch, limit = 30) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
  return async () => {
    const data = await getJson(url, fetchImpl);
    const children = (data.data && data.data.children) || [];
    return children.map((c) => c.data).map((d) => ({
      id: `rd_${d.id}`,
      title: d.title,
      summary: d.selftext ? stripHtml(d.selftext).slice(0, 800) : "",
      url: d.url_overridden_by_dest || `https://reddit.com${d.permalink}`,
      score: d.score || 0,
      commentCount: d.num_comments || 0,
      author: d.author || null,
      publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
      adult: d.over_18 === true,
      lang: "en"
    }));
  };
}

// --- Generic list-page adapter (jagei.co.kr model) -------------------------
//
// Some communities publish no RSS/API but do render their best/hot board as a
// plain server-rendered HTML list. For those we fetch ONE list page and pull
// only { title, url, publishedAt, score, commentCount } — never body/images —
// via small regexes declared per-community in communities.json (adapter.list).
// This keeps site-by-site differences in *data*, not in code: one parser
// (parseListPage) drives every community from its own config.
//
// adapter.list config:
//   urlBase       resolve relative hrefs found by titleRegex (e.g. "https://theqoo.net")
//   titleRegex    string, exactly 2 capture groups: (url, title). Matched with
//                 the "g" flag (repeated) against the raw HTML.
//   windowBefore / windowAfter  chars of HTML context around each title match
//                 to search for the optional fields below (default 0 / 400)
//   dateRegex     1 capture group: a raw timestamp/date string (best-effort
//                 parsed; unparseable text is dropped rather than guessed)
//   scoreRegex    1 capture group: a public engagement number (recommend/view)
//   commentRegex  1 capture group: a public comment count
//   dateIn / scoreIn / commentIn  "after" (default) or "before" — some sites
//                 render the metadata ahead of the title in the DOM (e.g. a
//                 date span before the link). Each field searches only its
//                 own side so a neighboring row's numbers never bleed in.
//   max           stop after this many rows (default 60 — "리스트 1~2페이지")
//   urlGroup / titleGroup  which capture group (1-based) of titleRegex holds
//                 the url / title, for formats where url doesn't come first
//                 textually (e.g. JSON-LD "name" before "item") — default 1/2
//   excludeRegex  if the row wrapper (before-window + the match itself)
//                 matches this, skip the row (e.g. a pinned/notice class)
//   charset       decode the fetched bytes with this charset (default utf-8;
//                 e.g. "euc-kr" for legacy Korean boards that never send one)
const LIST_UA = "taste-feed/1.0 (+https://taste-feed.onrender.com)";

function resolveUrl(base, href) {
  const h = String(href || "").trim();
  if (!h) return h;
  if (/^https?:\/\//i.test(h)) return h;
  if (!base) return h;
  const b = base.replace(/\/$/, "");
  return h.startsWith("/") ? b + h : `${b}/${h}`;
}

function toNumber(s) {
  const n = Number(String(s || "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Best-effort parse of whatever a list page shows as a timestamp. Korean
// boards mix full dates ("2026.07.23"), short dates ("07-23"), bare times
// ("21:23", meaning "today"), and relative text ("5시간전", "6일"). We only
// ever *add* a signal (freshness ranking) — an unparsed date safely yields
// null and the recommender falls back to its default freshness weight.
function normalizeListDate(raw, now = () => Date.now()) {
  if (!raw) return null;
  const s = raw.trim();

  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const d = new Date(now());
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    return d.toISOString();
  }
  const relH = s.match(/^(\d+)\s*시간\s*전$/);
  if (relH) return new Date(now() - Number(relH[1]) * 3.6e6).toISOString();
  const relM = s.match(/^(\d+)\s*분\s*전$/);
  if (relM) return new Date(now() - Number(relM[1]) * 6e4).toISOString();
  const relD = s.match(/^(\d+)\s*일\s*$/);
  if (relD) return new Date(now() - Number(relD[1]) * 8.64e7).toISOString();

  const normalized = s.replace(/^(\d{2})[./](\d{2})[./](\d{2})(?:\s|$)/, "20$1-$2-$3 ").replace(/\./g, "-");
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseListPage(html, cfg = {}) {
  if (!cfg.titleRegex) return [];
  const items = [];
  const titleRe = new RegExp(cfg.titleRegex, "g");
  const before = cfg.windowBefore || 0;
  const after = cfg.windowAfter != null ? cfg.windowAfter : 400;
  const max = cfg.max || 60;
  const urlGroup = cfg.urlGroup || 1;
  const titleGroup = cfg.titleGroup || 2;
  let m;
  while ((m = titleRe.exec(html))) {
    const href = m[urlGroup];
    const titleRaw = m[titleGroup];
    const title = decodeXml(stripCdata(titleRaw || "")).trim();
    if (!href || !title) continue;

    // Two separate, non-overlapping windows — a field only ever reads its own
    // side, so a neighboring row's numbers can never bleed into this one.
    const beforeCtx = html.slice(Math.max(0, m.index - before), m.index);
    const afterCtx = html.slice(m.index + m[0].length, Math.min(html.length, m.index + m[0].length + after));

    if (cfg.excludeRegex && new RegExp(cfg.excludeRegex).test(beforeCtx + m[0])) continue;

    const pick = (regexStr, where) => {
      if (!regexStr) return null;
      const ctx = where === "before" ? beforeCtx : afterCtx;
      return ctx.match(new RegExp(regexStr));
    };

    const raw = { title, url: resolveUrl(cfg.urlBase, href) };
    const dm = pick(cfg.dateRegex, cfg.dateIn);
    if (dm) {
      const iso = normalizeListDate(dm[1]);
      if (iso) raw.publishedAt = iso;
    }
    const sm = pick(cfg.scoreRegex, cfg.scoreIn);
    if (sm) raw.score = toNumber(sm[1]);
    const cm = pick(cfg.commentRegex, cfg.commentIn);
    if (cm) raw.commentCount = toNumber(cm[1]);

    items.push(raw);
    if (items.length >= max) break;
    if (titleRe.lastIndex === m.index) titleRe.lastIndex++; // guard zero-width matches
  }
  return items;
}

const DEFAULT_LIST_PAGES = 3; // "베스트게시판 글을 싹 가져와야" — a single page was only 20~40 posts
const LIST_PAGE_DELAY_MS = 500; // politeness gap between sequential page fetches

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchListPage(url, cfg, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": LIST_UA, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // Decode explicitly rather than res.text(): the Fetch spec's text() always
  // assumes UTF-8, but a few legacy Korean boards still serve EUC-KR without
  // declaring a charset — res.text() would silently mangle every title.
  const buf = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder(cfg.charset || "utf-8").decode(buf);
}

// Fetch adapter.pages (default 3) list pages in sequence, 500ms apart, and
// concatenate what each page parses. Page 1 always uses adapter.url as-is
// (unchanged from the single-page behavior). Pages 2+ need adapter.list.pageUrl
// — a template with {page} (1-based: 2, 3, ...) and/or {page0} (0-based: 1, 2,
// ...) placeholders, since boards number pages inconsistently. A source with
// no pageUrl configured (or a page that fails/returns nothing) simply stops
// there — this never turns a working single-page source into a failure.
export function listFetcher(entry, fetchImpl = fetch) {
  const a = entry.adapter || {};
  const cfg = a.list || {};
  const baseUrl = a.url;
  const pages = Math.max(1, a.pages || DEFAULT_LIST_PAGES);
  return async () => {
    if (!baseUrl) return [];
    const collected = [];
    for (let page = 1; page <= pages; page++) {
      const pageUrl =
        page === 1
          ? baseUrl
          : cfg.pageUrl
          ? cfg.pageUrl.replace(/\{page0\}/g, String(page - 1)).replace(/\{page\}/g, String(page))
          : null;
      if (!pageUrl) break;
      let html;
      try {
        html = await fetchListPage(pageUrl, cfg, fetchImpl);
      } catch {
        break; // a failed page stops pagination but keeps whatever pages already succeeded
      }
      const items = parseListPage(html, cfg);
      if (!items.length) break; // ran off the end of the board
      collected.push(...items);
      if (page < pages && cfg.pageUrl) await sleep(LIST_PAGE_DELAY_MS);
    }
    return collected;
  };
}

// Dispatch: build a fetcher for a registry entry from its adapter config.
// entry.adapter = { type: "rss"|"reddit"|"json"|"list"|"hn", url }
export function makeFetcher(entry, fetchImpl = fetch) {
  const a = entry.adapter || {};
  switch (a.type) {
    case "rss":
      if (!a.url) return async () => [];
      return rssFetcher(a.url, fetchImpl);
    case "reddit":
      // url holds the subreddit name (or a full url we extract the sub from)
      return redditFetcher(a.url || entry.id, fetchImpl);
    case "hn":
      return hackerNewsFetcher(fetchImpl);
    case "list":
      return listFetcher(entry, fetchImpl);
    case "json":
      if (entry.id === "hackernews") return hackerNewsFetcher(fetchImpl);
      if (!a.url) return async () => [];
      return async () => {
        const data = await getJson(a.url, fetchImpl);
        return Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
      };
    default:
      return async () => [];
  }
}
