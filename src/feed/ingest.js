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
  const url = String(input.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("유효한 http(s) 링크가 아니에요.");

  let og = { title: input.title || "", summary: input.summary || "", image: null, siteName: hostOf(url), url };
  if (opts.fetchImpl) {
    try {
      const res = await opts.fetchImpl(url, { headers: { "user-agent": opts.userAgent || "feed-linkbot/0.1" } });
      if (res && res.ok) {
        const parsed = parseOpenGraph(await res.text(), url);
        og = { ...parsed, title: input.title || parsed.title, summary: input.summary || parsed.summary };
      }
    } catch {
      // network/parse failure → fall back to submitter-provided fields
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

// Hotness ("화제성") from public engagement signals only — never from copied
// content. Blends recommends/score, comment volume, and freshness. Communities
// already surface these numbers, so no body scraping is needed to rank.
export function hotness(item, nowMs) {
  const now = nowMs || Date.now();
  const engagement = Math.log10(1 + Math.max(0, (item.score || 0) + (item.commentCount || item.comments || 0) * 2));
  let fresh = 0.5;
  if (item.publishedAt) {
    const ageH = (now - (typeof item.publishedAt === "number" ? item.publishedAt : Date.parse(item.publishedAt))) / 3.6e6;
    if (Number.isFinite(ageH)) fresh = Math.exp(-Math.max(0, ageH) / 48); // 2-day half-life
  }
  return Math.round((engagement * 0.7 + fresh * 0.6) * 1000) / 1000;
}
