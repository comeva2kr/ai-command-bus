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
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
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

// Dispatch: build a fetcher for a registry entry from its adapter config.
// entry.adapter = { type: "rss"|"reddit"|"json"|"hn", url }
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
