// Legally-safe ingestion helpers.
//
// The product is an *out-link aggregator*: we store and show only a title, a
// short excerpt, the source, and a link back to the original — never a full
// copy, never a framed/embedded view. Korean case law makes this the safe zone
// (plain hyperlinks aren't transmission-right infringement; wholesale copying of
// another site's DB risks unfair-competition liability). See docs/legal.md.
//
// Two legal intake paths live here:
//   1. parseOpenGraph  — read a page's own OG/meta tags (title/excerpt/source),
//      used for user-submitted links and for feeds that expose OG.
//   2. normalizeSubmission — turn a user-submitted URL into an out-link item.
//
// Nothing here reproduces article bodies; excerpts are hard-capped.

const EXCERPT_MAX = 200; // short snippet only — never the full body

function meta(html, ...names) {
  for (const name of names) {
    // <meta property="og:title" content="..."> or name="..."
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      "i"
    );
    const m = html.match(re);
    if (m) return decode(m[1]).trim();
    // attribute order reversed (content before property)
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      "i"
    );
    const m2 = html.match(re2);
    if (m2) return decode(m2[1]).trim();
  }
  return "";
}

function decode(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&amp;/g, "&");
}

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].replace(/^www\./, "") : "";
}

// SSRF guard for user-submitted URLs: literal-hostname checks only (no DNS
// resolution) — blocks the obvious loopback/private/link-local targets a
// submission could point the server's own fetch at. Node's URL parser already
// normalizes obfuscated IPv4 forms (hex/octal/decimal-integer) to dotted
// decimal, so those collapse into the same checks. Not a full SSRF defense
// (DNS rebinding — a hostname that resolves to a private IP only at fetch
// time — is out of scope for this "simple host validation"), but it's the
// meaningful low-cost bar per docs/legal.md's out-link-only intake model.
function isBlockedHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 0) return true;
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return true; // IPv6 unique-local / link-local
  return false;
}

// Parse + validate a submitted URL. Returns the parsed URL on success; throws
// a user-facing Korean error otherwise. Centralizes the http(s)-only +
// SSRF-host checks so both normalizeSubmission and the server route the same
// validation.
export function validateSubmissionUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    throw new Error("유효한 http(s) 링크가 아니에요.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("유효한 http(s) 링크가 아니에요.");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("안전하지 않은 주소예요.");
  }
  return parsed;
}

// Wrap a fetchImpl call with a hard timeout so a slow/unresponsive submitted
// URL can never stall the request. Any abort/network error is swallowed by
// normalizeSubmission's existing try/catch and falls back to the
// submitter-provided title, same as any other fetch failure.
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer.unref) timer.unref();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Extract just the linkable metadata from a page. Pure string parsing.
export function parseOpenGraph(html, url) {
  const title =
    meta(html, "og:title", "twitter:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
    "";
  const desc = meta(html, "og:description", "twitter:description", "description");
  return {
    title: decode(title).trim().slice(0, 300),
    summary: desc.slice(0, EXCERPT_MAX),
    image: meta(html, "og:image", "twitter:image") || null,
    siteName: meta(html, "og:site_name") || hostOf(url),
    url
  };
}

// Turn a user-submitted link into a canonical out-link item. Fetches the page's
// own OG tags via the injected `fetchImpl` (so it's testable offline and honors
// whatever network policy the host allows). Falls back to any title/summary the
// submitter provided. Always keeps the original URL for the out-link.
export async function normalizeSubmission(input, opts = {}) {
  const parsedUrl = validateSubmissionUrl(input.url); // http(s)-only + SSRF host check
  const url = parsedUrl.toString();

  let og = { title: input.title || "", summary: input.summary || "", image: null, siteName: hostOf(url), url };
  if (opts.fetchImpl) {
    try {
      const res = await fetchWithTimeout(
        opts.fetchImpl,
        url,
        { headers: { "user-agent": opts.userAgent || "feed-linkbot/0.1" } },
        opts.timeoutMs || 5000
      );
      if (res && res.ok) {
        const parsed = parseOpenGraph(await res.text(), url);
        og = { ...parsed, title: input.title || parsed.title, summary: input.summary || parsed.summary };
      }
    } catch {
      // network/parse/timeout failure → fall back to submitter-provided fields
    }
  }
  if (!og.title) throw new Error("제목을 찾지 못했어요. 제목을 직접 입력해 주세요.");

  return {
    kind: "community",
    via: "submit", // provenance: user-submitted out-link (no crawling)
    source: hostOf(url) || "link",
    sourceLabel: og.siteName || hostOf(url),
    category: input.category || "news",
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 6) : [],
    title: og.title,
    summary: og.summary.slice(0, EXCERPT_MAX),
    url, // REQUIRED — clicking always leaves to the original
    image: og.image,
    adult: input.adult === true
  };
}

// Raw public-engagement number behind "화제성" — recommends/score plus
// comment volume (weighted 2x, comments being a stronger intent signal than a
// passive upvote). Never derived from copied content, only from the counters
// communities already surface publicly.
export function rawEngagement(item) {
  return Math.max(0, (item.score || 0) + (item.commentCount || item.comments || 0) * 2);
}

// Freshness decay in [0,1], ~2-day half-life. Items with no publish date
// (some list-parsed adapters don't reliably carry one) get a neutral 0.5
// rather than being penalized as either brand-new or stale.
export function freshness(item, nowMs) {
  const now = nowMs || Date.now();
  if (!item.publishedAt) return 0.5;
  const ageH = (now - (typeof item.publishedAt === "number" ? item.publishedAt : Date.parse(item.publishedAt))) / 3.6e6;
  if (!Number.isFinite(ageH)) return 0.5;
  return Math.exp(-Math.max(0, ageH) / 48);
}

// Hotness ("화제성") from public engagement signals only — never from copied
// content. Blends recommends/score, comment volume, and freshness. Communities
// already surface these numbers, so no body scraping is needed to rank.
export function hotness(item, nowMs) {
  const engagement = Math.log10(1 + rawEngagement(item));
  const fresh = freshness(item, nowMs);
  return Math.round((engagement * 0.7 + fresh * 0.6) * 1000) / 1000;
}

// ---- Home-feed hot gate (David 2026-07-24 UX overhaul) --------------------
//
// The home feed is meant to be "지금 핫한 것만" — one unified stream of only
// the highest-engagement items across every active source. Every source is
// already a community's own best/hot board (or an overseas hot-topics feed),
// so this is one more cut on top of that, not a replacement for it.
//
// Raw engagement numbers aren't comparable across sources: an HN score of 40
// is a big deal, a Korean board's "추천 40" is unremarkable, and a
// list-parsed RSS item's "댓글 3" might be totally normal for that board. A
// single global engagement threshold would just favor whichever source's
// scale happens to run highest. So each item is ranked only against its own
// source's *current* pool and cut by relative position within that group —
// per-source normalization instead of a shared raw cutoff.
//
// Sources with literally no engagement signal at all right now (every item's
// raw engagement is 0 — some sources only carry a title+link, no public
// counters) are never gated out. Per the "이미 best보드 소속" rule they stay
// in the stream, ranked by freshness alone, at a lower baseline priority than
// anything that actually cleared its own source's engagement bar.
//
// Returns one { item, hot, percentile, hotScore, raw } record per input item
// (order not guaranteed — callers sort/filter as needed).
//   hot        : true if it clears its own source's engagement cut (or the
//                source has no signal, so nothing to cut against)
//   percentile : this item's relative rank within its own source, 0..1 (1 =
//                the source's own top item right now); null when the source
//                has no signal at all
//   hotScore   : a single sortable number blending percentile + freshness —
//                what the unified stream sorts by before personalization
export function hotGate(items, nowMs, opts = {}) {
  const now = nowMs || Date.now();
  // Keep the top X fraction of each source's items by engagement (env
  // HOT_MIN_PERCENTILE, default 0.6 = top 60%).
  const minTopFraction = opts.minTopFraction ?? Number(process.env.HOT_MIN_PERCENTILE ?? 0.6);
  // Alternative absolute cut: keep only the top N items per source (env
  // HOT_TOP_N). Wins over minTopFraction when set.
  const topNRaw = opts.topN ?? process.env.HOT_TOP_N;
  const topN = topNRaw != null && topNRaw !== "" ? Number(topNRaw) : null;

  const bySource = new Map();
  for (const item of items) {
    const src = item.source || "unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(item);
  }

  const results = [];
  for (const group of bySource.values()) {
    const withRaw = group.map((item) => ({ item, raw: rawEngagement(item) }));
    const hasSignal = withRaw.some((x) => x.raw > 0);

    if (!hasSignal) {
      // no engagement data anywhere in this source's current pool — never
      // excluded, just deprioritized to a freshness-only baseline.
      for (const { item } of withRaw) {
        results.push({ item, hot: true, percentile: null, hotScore: freshness(item, now) * 0.5 });
      }
      continue;
    }

    // stable sort descending by raw engagement (ties keep arrival order)
    const sorted = withRaw
      .map((x, i) => ({ ...x, i }))
      .sort((a, b) => b.raw - a.raw || a.i - b.i);
    const n = sorted.length;
    // at least 1 kept per source even at a strict fraction — "top 60% of 1
    // item" should keep that item, not round down to zero.
    const keepCount = topN != null ? Math.max(0, topN) : Math.max(1, Math.ceil(minTopFraction * n));

    sorted.forEach(({ item }, rank) => {
      const percentile = Math.round(((n - rank) / n) * 1000) / 1000; // 1 = this source's own top item
      const hot = rank < keepCount;
      const hotScore = Math.round((percentile * 0.7 + freshness(item, now) * 0.6) * 1000) / 1000;
      results.push({ item, hot, percentile, hotScore });
    });
  }
  return results;
}
