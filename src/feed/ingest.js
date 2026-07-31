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

// og:image is sometimes a relative or protocol-relative path rather than a
// full URL. Resolve it against the submitted page's own URL so the client
// gets a real, absolute hotlink — never fetched/stored here, just resolved.
// content.js's normalizeImageUrl does the final http->https upgrade + safety
// check when the item is normalized.
function resolveOgImage(raw, pageUrl) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    return new URL(s, pageUrl).toString();
  } catch {
    return null;
  }
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
    image: resolveOgImage(meta(html, "og:image", "twitter:image"), url),
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

// ---- Hot curation v1 (David 2026-07-24) ------------------------------------
//
// Problem this section fixes: rankBySource (further below) used to sort a
// signal-less source (score=0/commentCount=0 everywhere — every RSS/list
// board that doesn't expose public counters) purely by sourceRank — its
// position in that board's own scan order. That's a fine proxy for "hot"
// *at collection time*, but it has no notion of time passing afterward: if a
// low-traffic board's #1 slot doesn't change for weeks, a 434-day-old post
// can sit at rank 0 forever and keep winning that source's top-K cut. The
// fix below is "지금 검증된 화제" — every item, regardless of source type,
// always gets HN-style age decay applied on top of its normalized signal, so
// staleness always drags a score down.
//
// Ported, well-known formulas, adapted (not copied verbatim) to this
// project's data shape:
//   1. robust (median/MAD) z-score       — per-source scale normalization
//   2. probit (inverse normal CDF)       — bridges a percentile rank onto
//                                           the same z-scale as real counters
//   3. Hacker News "gravity" time decay  — signal / (age_hours + 2) ^ G
//   4. IMDB-style Bayesian shrinkage     — n / (n + m), small-sample penalty
//   5. engagement-per-hour "velocity"    — v1 proxy, see the note below
//
// All tunables are env-overridable (opts.* wins over env wins over default),
// mirroring the pattern hotGate/topPerSource already use elsewhere in this
// file:
//   HOT_GRAVITY      default 1.8   — HN decay steepness (bigger = faster drop)
//   HOT_BAYES_M      default 10    — Bayesian shrinkage pseudo-count
//   HOT_VEL_W        default 0.3   — weight of the velocity-proxy bonus
//   HOT_TASTE_W      default 0.15  — weight of the taste bias engine.js adds
//                                    on top of hotScore (Lobsters-style: base
//                                    ranking is objective "화제성", taste only
//                                    re-sorts, never dominates)
//   HOT_NEUTRAL_AGE_H default 12   — age (hours) assigned when publishedAt is
//                                    missing/unparseable, so a dateless item
//                                    is neither favored nor punished
const HOT_GRAVITY_DEFAULT = 1.8;
// 뉴스 coverage 보너스의 최대 가산치(z축 단위). probit이 만드는 순위 축이
// 대략 ±2.5이므로 0.8이면 "같은 순위대에서는 확실히 이기지만 순위를 통째로
// 뒤집지는 못하는" 크기다. HOT_COVERAGE_W로 조정 가능.
const HOT_COVERAGE_W_DEFAULT = 0.8;
const COVERAGE_MAX = 5; // 구글뉴스 RSS가 돌려주는 관련기사 목록의 상한(실측)
const HOT_BAYES_M_DEFAULT = 10;
const HOT_VEL_W_DEFAULT = 0.3;
const HOT_TASTE_W_DEFAULT = 0.15; // read by engine.js, exported below too
const HOT_NEUTRAL_AGE_H_DEFAULT = 12;

function envNum(name, dflt) {
  const v = process.env[name];
  return v != null && v !== "" ? Number(v) : dflt;
}

// How this call's tunables resolve: opts.<key> > env HOT_<KEY> > default.
export function hotParams(opts = {}) {
  return {
    gravity: opts.gravity ?? envNum("HOT_GRAVITY", HOT_GRAVITY_DEFAULT),
    bayesM: opts.bayesM ?? envNum("HOT_BAYES_M", HOT_BAYES_M_DEFAULT),
    velW: opts.velW ?? envNum("HOT_VEL_W", HOT_VEL_W_DEFAULT),
    tasteW: opts.tasteW ?? envNum("HOT_TASTE_W", HOT_TASTE_W_DEFAULT),
    neutralAgeH: opts.neutralAgeH ?? envNum("HOT_NEUTRAL_AGE_H", HOT_NEUTRAL_AGE_H_DEFAULT),
    coverageW: opts.coverageW ?? envNum("HOT_COVERAGE_W", HOT_COVERAGE_W_DEFAULT)
  };
}

function median(sortedAsc) {
  const n = sortedAsc.length;
  if (!n) return 0;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// Robust per-group z-score: z = (raw - median) / (1.4826 * MAD). 1.4826 is
// the standard consistency constant that makes MAD estimate the same scale
// as a normal distribution's standard deviation, so these z-scores are
// comparable across sources with wildly different raw scales (an HN score of
// 40 vs a Korean board's 추천수 40). MAD=0 (every value identical, or a
// single-item group) has nothing to normalize against — falls back to 0 for
// every item rather than dividing by zero.
export function robustZScores(values) {
  if (!values.length) return [];
  const med = median(values.slice().sort((a, b) => a - b));
  const absDevs = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(absDevs);
  const scale = 1.4826 * mad;
  if (!(scale > 0)) return values.map(() => 0);
  return values.map((v) => (v - med) / scale);
}

// Inverse standard normal CDF (probit / Φ⁻¹), Peter Acklam's rational
// approximation (relative error < 1.15e-9 across (0,1), no external
// dependency). p is clamped to [1e-6, 1-1e-6] first — a percentile of
// exactly 0 or 1 (the top/bottom rank of a source) would otherwise diverge
// to ±Infinity, which is a numerically real edge case here since
// engagement-less sources map their sourceRank straight to a percentile.
const AKM_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
const AKM_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const AKM_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
const AKM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
const PROBIT_EPS = 1e-6;
const PROBIT_LOW = 0.02425;
const PROBIT_HIGH = 1 - PROBIT_LOW;

export function probit(p) {
  const x = Math.min(1 - PROBIT_EPS, Math.max(PROBIT_EPS, p));
  if (x < PROBIT_LOW) {
    const q = Math.sqrt(-2 * Math.log(x));
    return (((((AKM_C[0] * q + AKM_C[1]) * q + AKM_C[2]) * q + AKM_C[3]) * q + AKM_C[4]) * q + AKM_C[5]) /
      ((((AKM_D[0] * q + AKM_D[1]) * q + AKM_D[2]) * q + AKM_D[3]) * q + 1);
  }
  if (x <= PROBIT_HIGH) {
    const q = x - 0.5;
    const r = q * q;
    return (((((AKM_A[0] * r + AKM_A[1]) * r + AKM_A[2]) * r + AKM_A[3]) * r + AKM_A[4]) * r + AKM_A[5]) * q /
      (((((AKM_B[0] * r + AKM_B[1]) * r + AKM_B[2]) * r + AKM_B[3]) * r + AKM_B[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - x));
  return -(((((AKM_C[0] * q + AKM_C[1]) * q + AKM_C[2]) * q + AKM_C[3]) * q + AKM_C[4]) * q + AKM_C[5]) /
    ((((AKM_D[0] * q + AKM_D[1]) * q + AKM_D[2]) * q + AKM_D[3]) * q + 1);
}

// IMDB-style Bayesian shrinkage confidence, conf = n / (n + m). n = this
// item's own raw engagement count (its "sample size" — how many reactions it
// actually has), m = HOT_BAYES_M. A post with 5 reactions gets conf≈0.33
// (mostly shrunk toward neutral) so "반응 5개 반짝" can't outrank a post with
// genuinely large, trustworthy engagement (conf→1 as n grows). Sources with
// no engagement concept at all (percentile-ranked) have no sample-size axis,
// so callers pass conf=1 (neutral, per the spec) for that path instead.
export function bayesianConfidence(n, m) {
  const nn = Math.max(0, n || 0);
  const mm = m > 0 ? m : HOT_BAYES_M_DEFAULT;
  return nn / (nn + mm);
}

function hoursSincePublished(item, nowMs, neutralAgeH) {
  if (item.publishedAt == null) return neutralAgeH;
  const t = typeof item.publishedAt === "number" ? item.publishedAt : Date.parse(item.publishedAt);
  if (!Number.isFinite(t)) return neutralAgeH;
  return Math.max(0, (nowMs - t) / 3.6e6);
}

// HN-style "gravity" decay: signal / (age_hours + 2) ^ gravity. Exported
// standalone (in addition to being folded into sourceHotScores below) so the
// decay behavior itself — "older always loses to fresher, holding the signal
// constant" — can be unit-tested directly.
export function hnDecay(signal, ageHours, gravity) {
  const g = gravity > 0 ? gravity : HOT_GRAVITY_DEFAULT;
  return signal / Math.pow(Math.max(0, ageHours) + 2, g);
}

// The full v1 hot-curation pipeline for ONE source's current item pool (or
// any single flat group the caller wants scored together — see engine.js's
// source= view, which treats its whole filtered pool as one group exactly
// like the old plain hotness() call it replaces).
//
//   1. normalize this group's raw engagement to a z-score (robust z), or —
//      if the group has no engagement numbers anywhere — map each item's
//      sourceRank to a percentile and probit that onto the same z-axis.
//   2. shrink engagement z-scores by Bayesian confidence (small-sample
//      posts pulled toward neutral); percentile-path items get conf=1.
//   3. turn the (confidence-weighted) z-score positive (Math.exp — always
//      >0, strictly order-preserving) and apply HN gravity decay by age.
//   4. add a small velocity-proxy bonus (engagement/hour, log-scaled so a
//      single viral outlier's raw count can't swamp the decay term).
//
// Returns items in the SAME order as input, each annotated with hotScore
// (what callers sort by) plus the intermediate numbers for inspection/tests.
export function sourceHotScores(items, nowMs, opts = {}) {
  const now = nowMs || Date.now();
  const { gravity, bayesM, velW, neutralAgeH, coverageW } = hotParams(opts);
  const n = items.length;
  const raws = items.map((item) => rawEngagement(item));
  const hasSignal = raws.some((r) => r > 0);

  let norms;
  let confs;
  if (hasSignal) {
    norms = robustZScores(raws);
    confs = raws.map((r) => bayesianConfidence(r, bayesM));
  } else {
    // No engagement anywhere in this group (뉴스 RSS는 추천수·댓글수를 아예
    // 주지 않는다). 두 가지가 남는다:
    //
    //  (a) 이 소스가 스스로 실어 준 순서(sourceRank) — 편집된 랭킹일 때만
    //      의미가 있다. 구글뉴스 섹션 피드(rss/topics/…)에서는 상위 10건의
    //      평균 관련기사가 5.0, 하위 10건이 0.0으로 순서와 화제성이 실제로
    //      붙어 있음을 실측 확인했다(2026-07-28). 반대로 예전에 쓰던 키워드
    //      검색 피드(rss/search?q=…)는 이 상관이 0이라 순서가 무의미했고,
    //      그래서 소스 자체를 섹션 피드로 교체했다(communities.json).
    //  (b) coverage — 구글이 같은 사건으로 묶어 준 관련 기사 수
    //      (fetchers.js의 relatedCoverage). 구글이 최대 5건까지만 주므로
    //      사실상 "여러 매체가 함께 다루는 사건인가"의 0/1 신호에 가깝다.
    //
    // (a)를 주 축으로 두고 (b)를 가산 보너스로 얹는다. 순서를 뒤집지는
    // 못하되(최대 +COVERAGE_W, probit 범위 ±2.5 대비 작다), 같은 순위대에서
    // 단독 보도보다 여러 매체가 달려든 사건을 확실히 위로 올린다.
    norms = items.map((item, i) => {
      const order = Number.isFinite(item.sourceRank) ? item.sourceRank : i;
      const pct = 1 - order / Math.max(n - 1, 1);
      const cov = Number.isFinite(item.coverage) ? item.coverage : 0;
      const covBonus = coverageW * Math.min(1, cov / COVERAGE_MAX);
      return probit(pct) + covBonus;
    });
    confs = items.map(() => 1); // no sample-size concept to shrink against — neutral
  }

  return items.map((item, i) => {
    const raw = raws[i];
    const normScore = norms[i] * confs[i];
    // z -> (0,1) 로지스틱. 예전엔 Math.exp(z)였는데, z가 상한이 없어서 점수가
    // 지수적으로 폭발했다 (실측 2026-07-29, 전형적 커뮤니티 풀:
    // 8055.7 / 2.55 / 0.60 / 0.37 / 0.25 / 0.13 / 0.06 / 0.02).
    //
    // 이게 왜 문제였나: engine.js는 여기에 취향 보정을 **덧셈**으로 얹는다
    // (hotScore + tasteW*taste, tasteW=0.15). 1위와 2위가 8053점 차이 나면
    // 어떤 취향도 그 순서를 못 바꾸고, 반대로 하위권은 간격이 0.003이라
    // 취향이 순서를 통째로 뒤집는다. 즉 같은 가중치가 위에서는 무의미하고
    // 아래에서는 과잉 지배 — David 검수 항목 5 "취향 설정이 추천에 반영 안 됨"의
    // 근본 원인 중 하나다.
    //
    // 로지스틱은 z에 대해 여전히 순증가라 **같은 소스 안의 정렬 순서는 그대로**
    // 유지되고, 다만 소스 간 크기 차이가 (0,1)로 묶여 덧셈 보정이 일정한
    // 의미를 갖게 된다.
    const shifted = 1 / (1 + Math.exp(-normScore));
    const age = hoursSincePublished(item, now, neutralAgeH);
    const decayed = hnDecay(shifted, age, gravity);
    // v1 velocity proxy: engagement/hour, NOT true Δreaction/Δt (that needs
    // periodic snapshots stored over time so a real delta can be computed —
    // out of scope for this pass; see the plan for a v2 that persists
    // per-item engagement snapshots and derives real velocity from them).
    // log10-scaled and weighted small so it nudges rather than dominates.
    const vel = hasSignal ? raw / (age + 2) : 0;
    const hotScoreVal = decayed + velW * Math.log10(1 + vel);
    return {
      item,
      raw,
      hasSignal,
      normScore,
      confidence: confs[i],
      age,
      decayed,
      vel,
      hotScore: Math.round(hotScoreVal * 1e6) / 1e6
    };
  });
}

export { HOT_TASTE_W_DEFAULT };

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

// ---- Board-hot ranking + diversity round-robin (David 2026-07-24 redesign) ---
//
// The home feed's old shape (hotGate above, still used by digest()) cut each
// source down by a raw-engagement percentile, then let one global
// personalized ranking decide the final order. In practice most sources
// (every RSS board, several list boards) parse with score=0/commentCount=0 —
// there's no engagement number to normalize at all — so those items fell back
// to being interleaved by *publish date*, which reads as "그냥 최신순 게시판
// 나열," not "핫한 것." And because ranking was global rather than per-source,
// whichever one or two sources scored highest (by raw count or by having a
// tight recent cluster) could dominate the whole feed.
//
// The fix leans on an insight that's true of every adapter in fetchers.js: a
// source is *already collected in its own board's hot/best order* — an RSS
// feed's document order, a list-adapter's page-scan order top-to-bottom, HN's
// front-page order, dev.to's top=N order, reddit's hot.json order. That
// position is stamped onto each item as `sourceRank` at collection time (see
// registry.js). So even a source with zero engagement numbers still has a
// meaningful hot rank: where it sits in that original order. This lets every
// source be ranked "hot first" on its own terms:
//   - has real engagement anywhere in its current pool -> sort by that engagement
//   - no engagement signal anywhere -> keep original collection order (never
//     re-sorted by date/freshness, which would erase the board's own ranking)
//
// rankBySource groups + orders; topPerSource keeps each source's best K
// ("게시판별로 가장 핫한 것만"); roundRobinInterleave alternates across sources
// so the stream reads as many boards taking turns, not one board's list.

// Group items by source and sort each group hot-first. Returns
// Map<source, Array<{ item, rank, hasSignal, hotScore, normScore }>> —
// `rank` is 0-based position within that source's hot order (0 = that
// source's hottest item right now).
//
// The sort key is `hotScore` from sourceHotScores (see above) — HN-gravity
// time-decayed, Bayesian-shrunk, per-source-normalized engagement (or, for a
// signal-less source, its sourceRank's probit-mapped percentile, same decay
// applied). This replaced a plain raw-engagement/sourceRank sort on
// 2026-07-24: that sort had no time axis at all, so a low-activity source's
// rank-0 item could be a months-old post that simply never got displaced from
// the top of that board's own scan order — hotScore always decays it by age
// regardless of source type, on top of whatever `nowMs` the caller supplies
// (real time by default; injectable for deterministic tests).
export function rankBySource(items, nowMs, opts = {}) {
  const now = nowMs || Date.now();
  const bySource = new Map();
  items.forEach((item, i) => {
    const src = item.source || "unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(item);
  });

  const out = new Map();
  for (const [src, group] of bySource) {
    const scored = sourceHotScores(group, now, opts)
      .map((s, i) => ({ ...s, i })) // stable tie-break on original arrival order
      .sort((a, b) => b.hotScore - a.hotScore || a.i - b.i);
    out.set(
      src,
      scored.map((s, rank) => ({
        item: s.item,
        rank,
        hasSignal: s.hasSignal,
        hotScore: s.hotScore,
        normScore: s.normScore
      }))
    );
  }
  return out;
}

// Keep only each source's top K hottest items — "게시판별로 가장 핫한 것만" —
// env HOT_PER_SOURCE (default 6). A source with fewer than K items keeps all
// of them untouched (this is a ceiling, not a percentile cut).
export function topPerSource(rankedBySource, k) {
  const kk = k ?? Number(process.env.HOT_PER_SOURCE ?? 6);
  const out = new Map();
  for (const [src, list] of rankedBySource) {
    out.set(src, kk > 0 ? list.slice(0, kk) : list.slice());
  }
  return out;
}

// Round-robin interleave across sources: round 0 = every source's #1 hottest
// item, round 1 = every source's #2, and so on — so the stream alternates
// between boards instead of exhausting one before moving to the next.
//
// Within a round, candidates are ordered by `opts.scoreFn(item, rank,
// hasSignal)` (higher first) — the caller supplies this (engine.js blends
// normalized engagement with a light personalization tiebreak) so a genuine
// outlier can still float toward the front of *its own round* without
// breaking the round-robin shape: it can win its round, never skip a round.
//
// `opts.minGap` (default 1) enforces that the same source never appears
// within that many slots of its own last appearance. When every remaining
// candidate in a round would violate the gap (few sources left with items),
// the best one is placed anyway rather than stalling the feed.
//
// `opts.exposure` (Map<source, count> or plain object) — how many times each
// source has ALREADY been shown to this user before this call (persisted
// across requests; see engine.js/store.js's sourceExposureFor). This is the
// 2026-07-24 adversarial-review fix for "8개 소스가 매 페이지 반복, 나머지는
// 0회": every getFeed call used to rebuild this interleave from scratch and
// only ever slice off the front of round 0 (see engine.js's getFeed —
// `unseen.slice(0, limit)`). Because round 0 alone typically holds one item
// per *every* active source (more than `limit`), whichever handful of
// sources scored highest under the old scoreFn-only sort would win the slice
// every single time, while lower-scoring sources' round-0 item just sat
// there unconsumed — and since a "loud" source's items keep getting marked
// seen and replaced by its own next-hottest item (also scoring well), it
// re-wins forever. The fix: exposure-so-far is now the PRIMARY sort key
// (ascending — least-shown source goes first), with scoreFn only breaking
// ties among similarly-exposed sources. A source nobody has seen yet always
// sorts to the front of its round regardless of engagement score, so it
// surfaces almost immediately instead of being starved indefinitely; loud
// sources naturally fall back once their exposure count catches up.
// `opts.weights` (Map<source, number> | object) — 소스별 배정 가중치. 기본 1.
//
// 왜 필요한가 (David 검수 항목 5, 2026-07-29): 위의 exposure 정렬은 "가장 적게
// 보여준 소스 먼저"를 **정수 비교**로 강제했다. 그래서 모든 소스가 정확히 같은
// 횟수를 배정받고, scoreFn에 실린 취향은 "그 라운드에서 누가 먼저 나오나"만
// 정할 뿐 **구성 비율은 절대 못 바꿨다**. 실측: 게임 취향 유저와 경제 취향
// 유저의 피드가 둘 다 정확히 게임 50% / 경제 50%였다. 취향을 골라도 안 고른
// 카테고리가 정확히 절반 오는 것이 David가 본 "취향 미반영" 증상이다.
//
// 고친 방식은 가중 공정배분(weighted fair queueing)이다. 정렬키를 정수
// exposure가 아니라 `exposure / weight`(적자, deficit)로 바꾼다. 가중치 2인
// 소스는 가중치 1인 소스보다 두 배 자주 뽑히면서도 "적게 받은 쪽 먼저"라는
// 공정성 성질은 그대로 유지된다.
//
// 다양성 하한은 호출부가 가중치 범위를 좁게 잡아 지킨다(engine.js가 [0.5, 2.0]로
// 클램프) — 취향이 구성을 실제로 움직이되, 어떤 소스도 0이 되지는 않는다.
// handoff.md의 "소스별 볼륨 균형 유지" 지시와 David의 "다양성 > 개인화" 결정을
// 둘 다 만족시키는 지점이다.
export function roundRobinInterleave(topKBySource, opts = {}) {
  const minGap = opts.minGap ?? 1;
  const weights = opts.weights || null;
  const weightOf = (src) => {
    if (!weights) return 1;
    const v = typeof weights.get === "function" ? weights.get(src) : weights[src];
    return Number.isFinite(v) && v > 0 ? v : 1;
  };
  // scoreFn(item, rank, hasSignal, hotScore) — hotScore (from rankBySource,
  // when present) is the default tie-break so callers that don't supply
  // their own scoreFn still order by the objective hot-curation score rather
  // than raw rank; falls back to -rank for hand-built entries without it
  // (e.g. tests constructing topKBySource directly).
  const scoreFn = opts.scoreFn || ((item, rank, hasSignal, hotScore) => (hotScore ?? -rank));
  const exposure = opts.exposure || null;
  const exposureOf = (src) => {
    if (!exposure) return 0;
    const v = typeof exposure.get === "function" ? exposure.get(src) : exposure[src];
    return Number.isFinite(v) ? v : 0;
  };

  const queues = new Map();
  for (const [src, list] of topKBySource) if (list.length) queues.set(src, list.slice());

  // Local running count, seeded from prior exposure and incremented as items
  // are placed *within this call* too — so a source that wins one slot in
  // this page doesn't keep winning every subsequent slot in the same page
  // ahead of sources that haven't appeared at all yet.
  const localExposure = new Map();
  for (const src of queues.keys()) localExposure.set(src, exposureOf(src));

  const out = [];
  let remaining = 0;
  for (const q of queues.values()) remaining += q.length;

  // 한 번에 한 건씩, 매번 적자가 가장 큰 소스에서 뽑는다.
  //
  // 예전에는 "라운드"(모든 큐의 머리 하나씩)를 통째로 만들어 전부 소진한 뒤
  // 다음 라운드로 넘어갔다. 그 구조에서는 정렬을 어떻게 바꾸든 **모든 소스가
  // 라운드마다 정확히 한 자리씩** 가져가므로 가중치가 구성 비율에 영향을 줄 수
  // 없었다. 한 건씩 뽑으면 가중치가 실제 배정 횟수로 이어진다.
  //
  // 가중치가 전부 1이면 뽑을 때마다 그 소스의 적자가 1 올라가 큐 뒤로 밀리므로,
  // 결과적으로 모든 소스를 한 바퀴 돈 뒤 다시 도는 예전 라운드로빈과 동일한
  // 순서가 나온다(하위호환).
  while (remaining > 0) {
    const cands = [];
    for (const [src, q] of queues) {
      if (q.length) cands.push({ src, entry: q[0] });
    }
    if (!cands.length) break; // 방어: remaining과 큐가 어긋나도 무한루프 금지
    cands.sort((a, b) => {
      // 적자(deficit) = 지금까지 보여준 횟수 / 이 소스의 배정 가중치.
      const defA = localExposure.get(a.src) / weightOf(a.src);
      const defB = localExposure.get(b.src) / weightOf(b.src);
      if (defA !== defB) return defA - defB; // 덜 받은 소스 먼저
      return (
        scoreFn(b.entry.item, b.entry.rank, b.entry.hasSignal, b.entry.hotScore) -
        scoreFn(a.entry.item, a.entry.rank, a.entry.hasSignal, a.entry.hotScore)
      );
    });

    const recentSrcs = out.slice(-minGap).map((it) => it.source);
    let idx = cands.findIndex((c) => !recentSrcs.includes(c.src));
    if (idx === -1) idx = 0; // 남은 후보가 전부 gap 위반 — 그래도 최선을 놓는다
    const cand = cands[idx];
    out.push(cand.entry.item);
    const q = queues.get(cand.src);
    q.shift();
    if (!q.length) queues.delete(cand.src);
    localExposure.set(cand.src, localExposure.get(cand.src) + 1);
    remaining--;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 최신순 정렬 — 시간버킷 × 소스 인터리브 (#12, David 2026-07-30)
// ---------------------------------------------------------------------------
//
// David 원문: "최신순일경우 절대적 시간순이라기보단 최신순+여러리소스 가
// 적절하게 섞여나오는건데". 순수 시간순이 왜 파탄나는지는 실측으로 확인했다
// (2026-07-31): 한겨레랭킹은 70건 전부가 피드 생성 시각의 동일 타임스탬프라
// 정렬 시 70연속 벽을 치고, 전체 풀 882건 중 326건은 발행일 자체가 없다.
//
// 방식:
//   1. age(시간)를 폭 bucketH(기본 0.5h)의 버킷으로 양자화한다. age는 호출측이
//      itemAgeHours(publishedAt ?? firstSeenAt)로 계산해 넘긴다 — 무일자 글도
//      "우리가 처음 본 시각"으로 최신성에 참여한다(신선도 상한과 같은 원칙).
//   2. 버킷을 최신부터 순회하며 버킷 안에서 소스 라운드로빈. 한 소스는 버킷당
//      perSourceCap(기본 2)개까지만 — 초과분은 다음(더 오래된) 버킷으로 이월돼
//      전체 스트림에 골고루 스민다. 동일 타임스탬프 벽이 이 이월로 해체된다.
//   3. 마지막 버킷 이후 남은 이월분은 캡 없이 라운드로빈으로 흘려보낸다
//      (버리지 않는다 — 캡은 배치 제약이지 검열이 아니다).
//
// 취향/노출 이력은 개입하지 않는다 — 최신순은 "지금 무엇이 올라오고 있나"의
// 중립 뷰다(개인화는 핫 탭의 일이다).
export function latestParams(opts = {}) {
  return {
    bucketH: opts.bucketH ?? envNum("FEED_LATEST_BUCKET_H", 0.5),
    perSourceCap: opts.perSourceCap ?? envNum("FEED_LATEST_SOURCE_CAP", 2)
  };
}

// entries: [{ item, ageH }] — 반환은 item 배열 (최신 버킷부터).
export function latestInterleave(entries, opts = {}) {
  const p = latestParams(opts);
  const buckets = new Map(); // bucketIndex -> entries
  for (const e of entries) {
    const age = Number.isFinite(e.ageH) ? Math.max(0, e.ageH) : 0;
    const b = Math.floor(age / p.bucketH);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(e);
  }
  const order = [...buckets.keys()].sort((a, b) => a - b);
  const out = [];
  let carry = []; // 이전(더 새로운) 버킷에서 캡을 넘긴 이월분 — 항상 버킷 자체 글보다 먼저
  for (const bi of order) {
    const own = buckets.get(bi).slice().sort((a, b) => a.ageH - b.ageH);
    const bySrc = new Map();
    for (const e of [...carry, ...own]) {
      const s = e.item.source || "?";
      if (!bySrc.has(s)) bySrc.set(s, []);
      bySrc.get(s).push(e);
    }
    carry = [];
    const taken = new Map();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [s, q] of bySrc) {
        if (!q.length || (taken.get(s) || 0) >= p.perSourceCap) continue;
        out.push(q.shift());
        taken.set(s, (taken.get(s) || 0) + 1);
        progressed = true;
      }
    }
    for (const q of bySrc.values()) if (q.length) carry.push(...q);
  }
  // 마지막 버킷 뒤 잔여 이월분: 캡 없이 라운드로빈 소진
  if (carry.length) {
    const bySrc = new Map();
    for (const e of carry) {
      const s = e.item.source || "?";
      if (!bySrc.has(s)) bySrc.set(s, []);
      bySrc.get(s).push(e);
    }
    let left = carry.length;
    while (left > 0) {
      for (const q of bySrc.values()) {
        if (q.length) { out.push(q.shift()); left--; }
      }
    }
  }
  return out.map((e) => e.item);
}
