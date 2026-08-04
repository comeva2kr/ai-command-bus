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

import { decodeCp949 } from "./cp949-table.js";

const DEFAULT_UA = "ai-command-bus-feed/0.1 (+https://github.com/comeva2kr/ai-command-bus)";

const FETCH_TIMEOUT_MS = 8000; // a slow feed must never stall collection

// 읽지 않은 응답 본문을 안전하게 버린다.
//
// AbortSignal.timeout()을 붙인 fetch에서 `!res.ok`로 조기 반환하면, 소비되지
// 않은 본문 스트림이 그대로 남는다. 잠시 뒤 타임아웃이 발동하면 그 스트림이
// 중단되면서 **아무도 잡지 않는 거부**가 생기고, Node 22 기본값에서는 이게
// 프로세스를 죽인다. 로컬 FEED_LIVE 기동에서 실제로 서버가 사망했다
// (403이 나는 소스마다 8초 뒤 1건씩). 조기 반환 전에 반드시 이걸 부른다.
export function discardBody(res) {
  try {
    if (res && res.body && typeof res.body.cancel === "function") {
      res.body.cancel().catch(() => {});
    }
  } catch { /* 이미 소비/중단된 본문 — 무시 */ }
}


async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": DEFAULT_UA, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) { discardBody(res); throw new Error(`HTTP ${res.status} for ${url}`); }
  return res.text();
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": DEFAULT_UA, accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) { discardBody(res); throw new Error(`HTTP ${res.status} for ${url}`); }
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
  // 태그 제거 → 잔여 엔티티 재디코드. <description>은 "HTML을 XML로 이스케이프"한
  // 이중 인코딩이라 tag()의 1회 디코드 후에도 텍스트 노드의 &nbsp; 등이 남는다 —
  // 실측: 구글뉴스 상세뷰에 "&nbsp;&nbsp;"가 문자 그대로 노출됐다(2026-07-31).
  return decodeXml(String(s || "").replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// ---- Thumbnail image extraction (image: 원본 OG/썸네일 URL 핫링크만, David
// 2026-07-26 — see docs/legal.md) -------------------------------------------
//
// Never a body/image copy: this pulls exactly one representative image URL a
// feed already publishes for the item (its own <media:thumbnail>/
// <media:content>/image <enclosure>, or — failing those — the first <img> the
// item's own description/content already embeds) and hands back the URL
// string only. The client hotlinks it directly (referrerpolicy="no-referrer",
// onerror hides a dead one) — nothing is fetched, stored, or re-served by us.

function tagAttrs(tagText) {
  const url = (tagText.match(/\burl=["']([^"']+)["']/i) || [])[1];
  const type = (tagText.match(/\btype=["']([^"']+)["']/i) || [])[1];
  const medium = (tagText.match(/\bmedium=["']([^"']+)["']/i) || [])[1];
  return { url, type, medium };
}

// Self-closing/attribute-only tags (media:thumbnail, media:content,
// enclosure) never nest other markup, so a simple "<tag ...>" match is enough
// — no need for the block-matching regex title/summary use.
function findTags(block, tagName) {
  return block.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
}

function extractRssImage(block, decodedDescHtml, originBase, extraHtml) {
  // 1. <media:thumbnail url="...">  — a dedicated thumbnail element, always
  //    an image by definition, no type check needed.
  for (const t of findTags(block, "media:thumbnail")) {
    const { url } = tagAttrs(t);
    if (url) return resolveUrl(originBase, decodeXml(url).trim());
  }
  // 2. <media:content url="..." type="image/..." | medium="image">  — MRSS
  //    also carries video/audio this way, so only trust it when explicitly
  //    typed as an image, or genuinely untyped (untyped media:content is
  //    overwhelmingly used for images in the wild; audio/video almost always
  //    declares its type/medium).
  for (const t of findTags(block, "media:content")) {
    const { url, type, medium } = tagAttrs(t);
    if (!url) continue;
    if (type && !/^image\//i.test(type)) continue;
    if (!type && medium && !/^image$/i.test(medium)) continue;
    return resolveUrl(originBase, decodeXml(url).trim());
  }
  // 3. <enclosure url="..." type="image/...">  — enclosure is very commonly a
  //    podcast audio file (audio/mpeg) or video; require an explicit image/*
  //    type, never trust an untyped one here.
  for (const t of findTags(block, "enclosure")) {
    const { url, type } = tagAttrs(t);
    if (url && type && /^image\//i.test(type)) return resolveUrl(originBase, decodeXml(url).trim());
  }
  // 4. Fallback: the first <img src> the item's own description/content HTML
  //    already embeds (WordPress-style feeds routinely inline the featured
  //    image this way; community boards like clien/ruliweb embed post photos
  //    directly in the RSS description). decodedDescHtml is the same
  //    CDATA-unwrapped, entity-decoded string stripHtml() reduces to plain
  //    text for `summary` — read before that stripping happens. extraHtml
  //    (RSS 2.0's <content:encoded> — WordPress's full-body field, separate
  //    from <description>'s short excerpt; slownews/ddanzi/outstanding/yozm
  //    all populate it) is searched too when the excerpt itself had no image
  //    — read-only, never used for `summary` (that stays capped to the
  //    excerpt field only, per docs/legal.md).
  for (const html of [decodedDescHtml, extraHtml]) {
    if (!html) continue;
    const m = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (m) return resolveUrl(originBase, m[1].trim());
  }
  return null;
}

function originOf(url) {
  const m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : null;
}

// Parse an RSS 2.0 or Atom document into raw feed items. Pure string parsing,
// no XML dependency — good enough for well-formed feeds.
// 구글뉴스 RSS는 <description>에 "이 사건을 다룬 관련 기사" 목록을 <ol><li>로
// 함께 실어 준다. 그 개수 = 구글이 같은 사건으로 묶은 기사 수, 즉 **뉴스에
// 유일하게 존재하는 실측 화제성 신호**다(뉴스에는 추천수·댓글수가 없다).
//
// 왜 필요했나 (David 2026-07-28: "뉴스는 어떤 기준으로 핫한 걸 아는 거야?"):
// 뉴스는 반응 지표가 없어 ingest.js가 "그 소스가 실어 준 순서"를 백분위로
// 바꿔 점수를 매긴다. 그게 통하려면 그 순서가 편집된 랭킹이어야 하는데, 당시
// 뉴스 소스 7/8이 구글뉴스 **키워드 검색** 피드(rss/search?q=…)였다 — 실측
// 결과 q=IT 100건 전부 관련기사 0건, 즉 랭킹이 아니라 그냥 검색 결과였고
// "검색 1번째"가 "핫 1위"로 둔갑하고 있었다. 그래서 섹션 피드(rss/topics/…)로
// 교체했고(communities.json), 그 피드에서는 상위 10건 평균 관련기사 5.0 /
// 하위 10건 0.0으로 순서와 화제성이 실제로 붙어 있음을 확인했다.
//
// 주의: 구글은 이 목록을 **최대 5건까지만** 준다(실측: 사실상 0 아니면 5).
// 그래서 이 값은 "정확히 몇 개 매체가 썼는가"가 아니라 "여러 매체가 함께
// 다루는 사건인가"에 가깝다 — 표시할 때 단정적인 매체 수로 쓰면 안 된다
// (editorial.js가 숫자 대신 문구로 처리하는 이유).
const RELATED_LI = /&lt;li&gt;|<li[\s>]/gi;
export const COVERAGE_MAX = 5; // 구글이 돌려주는 관련기사 목록의 상한(실측)

export function relatedCoverage(rawDesc) {
  if (!rawDesc) return 0;
  const m = String(rawDesc).match(RELATED_LI);
  return m ? m.length : 0;
}

export function parseRss(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = xml.match(blockRe) || [];
  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;
    const rawDesc = isAtom ? tag(block, "summary") || tag(block, "content") : tag(block, "description");
    // RSS 2.0 only: WordPress's full-body field, kept separate from the
    // short <description> excerpt — read here purely as an image-fallback
    // source (point 4 above), never mixed into `summary`'s excerpt cap.
    const rawContent = isAtom ? "" : tag(block, "content:encoded");
    const url = tag(block, "link") || tag(block, "guid");
    // 구글뉴스 <description>은 기사 발췌가 아니라 "관련 기사 링크 목록"이다 —
    // 태그만 벗기면 같은 제목+매체명 나열이 발췌인 척 노출된다(실측 스크린샷,
    // 2026-07-31). 링크 목록은 발췌로 쓰지 않는다. 그 외 소스도 발췌가 제목의
    // 단순 반복으로 시작하면 중복 구간을 걷어낸다.
    let summary = stripHtml(rawDesc);
    if (/news\.google\.com/i.test(rawDesc)) summary = "";
    else if (summary.startsWith(title)) summary = summary.slice(title.length).trim();
    items.push({
      title,
      summary,
      url,
      publishedAt: normalizeDate(tag(block, isAtom ? "updated" : "pubDate")),
      image: extractRssImage(block, rawDesc, originOf(url), rawContent),
      coverage: relatedCoverage(rawDesc)
    });
  }
  return items;
}

// ---- Date sanity guard (David 2026-07-24, adversarial review item 1) -----
//
// Any date-normalizing point in this file funnels through here before it's
// trusted. A parsed date that's in the future or more than MAX_PAST_YEARS
// years stale is almost never a real publish date — it's a parser reading
// the wrong element (a neighboring row, a pinned/notice widget with its own
// fixed date, a copyright/founding-year string, ...). The theqoo bug this
// guards against: a pinned notice row's original post date ("01.07.23",
// read as YY.MM.DD = 2001-07-23) leaking through when the notice-exclusion
// regex misses a markup change, silently poisoning that item's freshness
// score forever. Rather than trust a single fragile regex to catch every
// such case, this is the last-resort backstop: an insane date is simply
// dropped (null), which recommender/ingest.js's freshness() already treats
// as "no date" and falls back to a neutral 0.5 weight — never a crash, never
// a poisoned ranking.
const MAX_PAST_YEARS = 5;
const FUTURE_GRACE_MS = 60 * 60 * 1000; // 1h clock-skew tolerance before "future" kicks in

function isSaneDate(ms, nowMs) {
  if (!Number.isFinite(ms)) return false;
  if (ms - nowMs > FUTURE_GRACE_MS) return false; // future date
  if (nowMs - ms > MAX_PAST_YEARS * 365.25 * 8.64e7) return false; // 5+ years stale
  return true;
}

function normalizeDate(s, now = () => Date.now()) {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return isSaneDate(t, now()) ? new Date(t).toISOString() : null;
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

// --- dev.to (top articles API) --------------------------------------------
//
// dev.to's public API returns plain JSON (no auth), but its field names don't
// match normalizeItem's expected shape (positive_reactions_count vs score,
// comments_count vs commentCount, published_at vs publishedAt, description vs
// summary) — so unlike a feed that's already normalized-ish, this needs the
// same kind of dedicated mapping as hackerNewsFetcher/redditFetcher rather
// than the generic makeFetcher "json" passthrough.
export function devtoFetcher(fetchImpl = fetch, top = 7) {
  const url = `https://dev.to/api/articles?top=${top}`;
  return async () => {
    const data = await getJson(url, fetchImpl);
    return (Array.isArray(data) ? data : []).map((a) => ({
      id: `devto_${a.id}`,
      title: a.title,
      summary: a.description ? stripHtml(a.description) : "",
      url: a.url || (a.path ? `https://dev.to${a.path}` : null),
      score: a.positive_reactions_count || 0,
      commentCount: a.comments_count || 0,
      author: (a.user && a.user.username) || null,
      publishedAt: a.published_at || null,
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
// only { title, url, publishedAt, score, commentCount, image } — never a body
// copy — via small regexes declared per-community in communities.json
// (adapter.list). `image` is the row's OWN thumbnail <img src> the list page
// already renders (David 2026-07-26) — still just a URL string, never
// downloaded; see docs/legal.md's hotlink-only rule. This keeps site-by-site
// differences in *data*, not in code: one parser (parseListPage) drives every
// community from its own config.
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
//   viewRegex     1 capture group: 조회수. 화제성 점수에는 넣지 않고 **표시용**
//                 으로만 쓴다 — 조회수는 게시판마다 자릿수가 완전히 달라
//                 (한쪽은 수백, 다른 쪽은 수백만) 같은 축에 올리면 순위가
//                 통째로 뒤집힌다. 다만 화면에는 있어야 한다: 조회·추천·댓글·
//                 시각이 함께 보여야 "지금 화제인 글을 실제로 재고 있구나"가
//                 읽힌다(David 2026-08-04, 오늘의베스트 대조).
//   thumbRegex    1 capture group: the row's own thumbnail <img src> (or a
//                 data-src/lazy-load attribute holding the same). Only add
//                 this where a real per-post thumbnail sits within
//                 windowBefore/windowAfter of the title match, close enough
//                 that a neighboring row's image can never be picked up
//                 instead (verified per-source against a real HTML snapshot
//                 before shipping — most community best/hot list pages only
//                 render a file-type/HOT badge icon here, not an actual
//                 thumbnail, so most sources intentionally have no
//                 thumbRegex at all — no image is the safe, honest default).
//                 Resolved through the same urlBase/protocol-relative/https
//                 rules as the title url.
//   dateIn / scoreIn / commentIn / thumbIn  "after" (default) or "before" —
//                 some sites render the metadata ahead of the title in the
//                 DOM (e.g. a date span, or a thumbnail <a>, before the link).
//                 Each field searches only its own side so a neighboring
//                 row's value never bleeds in.
//   max           stop after this many rows (default 60 — "리스트 1~2페이지")
//   urlGroup / titleGroup  which capture group (1-based) of titleRegex holds
//                 the url / title, for formats where url doesn't come first
//                 textually (e.g. JSON-LD "name" before "item") — default 1/2
//   excludeRegex  if the row wrapper (before-window + the match itself)
//                 matches this, skip the row (e.g. a pinned/notice class)
//   charset       decode the fetched bytes with this charset (default utf-8;
//                 "euc-kr" decodes via the full CP949/UHC table in
//                 cp949-table.js — see that file for why the platform
//                 TextDecoder isn't enough for real Korean boards)
// 수집기 신원. **살아 있는 주소여야 한다** — 사이트 운영자가 로그에서 이 UA를
// 보고 문의하거나 차단을 요청할 수 있어야 하고, 그게 "선의의 크롤러"라는
// 사실관계의 근거다. 예전 값(taste-feed.onrender.com)은 이미 죽은 주소여서
// 연락 경로가 끊겨 있었다(2026-08-04 법무 검수).
// /about.html에 수집 정책과 차단 요청 방법을 게시한다.
const LIST_UA = "nowhot-bot/1.0 (+https://nowhot.kr/about.html)";

function resolveUrl(base, href) {
  const h = String(href || "").trim();
  if (!h) return h;
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("//")) return "https:" + h; // protocol-relative CDN URL — common on Korean image hosts
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
export function normalizeListDate(raw, now = () => Date.now()) {
  if (!raw) return null;
  const s = raw.trim();
  const nowMs = now();
  const finish = (ms) => (isSaneDate(ms, nowMs) ? new Date(ms).toISOString() : null);

  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const d = new Date(nowMs);
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    // "시각만" 주는 게시판의 시각이 지금보다 미래면 어제 글이다 — 게시판이
    // 미래 글을 걸 수는 없다. (자정 직후 "23:54" 같은 케이스. 이 보정이
    // 없으면 sanity 가드가 미래 판정으로 날짜를 통째로 버린다 — 2026-07-31
    // 자정 경계에서 theqoo 픽스처 테스트가 실제로 이렇게 깨졌다.)
    if (d.getTime() > nowMs + 60000) d.setTime(d.getTime() - 8.64e7);
    return finish(d.getTime());
  }
  // "HH:MM:SS" — 뽐뿌가 이 형식을 쓴다. 초까지 주는 것뿐이라 위와 같은 규칙이다.
  // 이걸 못 읽어서 뽐뿌 글 전체에 작성일이 비어 있었다(2026-08-04 실측 0/19).
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const d = new Date(nowMs);
    d.setHours(Number(hms[1]), Number(hms[2]), Number(hms[3]), 0);
    if (d.getTime() > nowMs + 60000) d.setTime(d.getTime() - 8.64e7);
    return finish(d.getTime());
  }
  // "MM.DD HH:MM" — 인스티즈가 지난 날 글에 쓴다. 연도를 안 주므로 올해로 보되,
  // 그 결과가 미래면 작년 글이다(1월에 보는 12월 글).
  const mdhm = s.match(/^(\d{1,2})[.\-\/](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (mdhm) {
    const d = new Date(nowMs);
    d.setMonth(Number(mdhm[1]) - 1, Number(mdhm[2]));
    d.setHours(Number(mdhm[3]), Number(mdhm[4]), 0, 0);
    if (d.getTime() > nowMs + 60000) d.setFullYear(d.getFullYear() - 1);
    return finish(d.getTime());
  }
  const relH = s.match(/^(\d+)\s*시간\s*전$/);
  if (relH) return finish(nowMs - Number(relH[1]) * 3.6e6);
  const relM = s.match(/^(\d+)\s*분\s*전$/);
  if (relM) return finish(nowMs - Number(relM[1]) * 6e4);
  const relD = s.match(/^(\d+)\s*일\s*$/);
  if (relD) return finish(nowMs - Number(relD[1]) * 8.64e7);

  const normalized = s.replace(/^(\d{2})[./](\d{2})[./](\d{2})(?:\s|$)/, "20$1-$2-$3 ").replace(/\./g, "-");
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : finish(t);
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
    const vm = pick(cfg.viewRegex, cfg.viewIn);
    if (vm) raw.viewCount = toNumber(vm[1]);
    const tm = pick(cfg.thumbRegex, cfg.thumbIn);
    if (tm && tm[1]) {
      const img = resolveUrl(cfg.urlBase, tm[1].trim());
      if (img) raw.image = img;
    }

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
  if (!res.ok) { discardBody(res); throw new Error(`HTTP ${res.status} for ${url}`); }
  // Decode explicitly rather than res.text(): the Fetch spec's text() always
  // assumes UTF-8, but a few legacy Korean boards still serve EUC-KR (or
  // claim to) without declaring a charset — res.text() would silently
  // mangle every title.
  const buf = new Uint8Array(await res.arrayBuffer());
  if ((cfg.charset || "utf-8").toLowerCase() === "euc-kr") {
    // Real-world Korean sites that label themselves "euc-kr" almost always
    // actually serve the CP949/UHC superset (thousands of extra precomposed
    // Hangul syllables used in everyday slang, e.g. "앜ㅋㅋ"). Node's
    // built-in TextDecoder('euc-kr') only implements the strict KS X 1001
    // subset and silently corrupts those extra syllables instead of
    // throwing — see cp949-table.js for the reproduction and full mapping.
    return decodeCp949(buf);
  }
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
      if (entry.id === "devto") return devtoFetcher(fetchImpl);
      if (!a.url) return async () => [];
      return async () => {
        const data = await getJson(a.url, fetchImpl);
        return Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
      };
    default:
      return async () => [];
  }
}
