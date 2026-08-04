// Zero-dependency HTTP server for the personalized feed.
//
// Serves the REST API and the static single-page client. Built on node:http so
// the project keeps its no-dependency footprint. Run with:
//   node src/feed/server.js            # in-memory, ephemeral
//   FEED_DB=./feed-data.json node src/feed/server.js   # persisted

import http from "node:http";
import { pickBanner, loadBanners } from "./manual-products.js";
import { adCopy, AD_DISCLOSURE, withSubId } from "./ad-copy.js";
import { makeWriter } from "./llm.js";
import { makeIndexNow } from "./indexnow.js";
import { maskProfanity } from "./profanity.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FeedStore } from "./store.js";
import { FeedEngine } from "./engine.js";
import { SeedSource, StorePostsSource } from "./content.js";
import { SURVEY, validateAnswers } from "./survey.js";
import { CATEGORIES, SOURCE_CATALOG } from "./taxonomy.js";
import { loadRegistry, buildSources, summarize } from "./registry.js";
import { makeFetcher } from "./fetchers.js";
import { memoizedTranslator } from "./translate.js";
import { googleFreeTranslator } from "./translator.js";
import { TOPIC_CATALOG, FILTERABLE_TOPICS } from "./topics.js";
import { DEFAULT_RULES } from "./rules.js";
import { normalizeSubmission } from "./ingest.js";
import { topPreferences } from "./recommender.js";
import { categoryLabel, sourceLabel } from "./taxonomy.js";
import { sendDigestPushes } from "./push.js";
import { makeCoupangProductFeed, refreshCoupangCache, coupangCreds } from "./coupang.js";
import { makeEnricher } from "./enrich.js";
import { makeTrendsCache } from "./trends.js";
import {
  enabledProviders,
  providerConfig,
  buildAuthorizeUrl,
  completeOAuth,
  AuthStateStore,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookie
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Best-effort origin for building absolute URLs (OAuth redirect_uri, the
// share page). Trusts x-forwarded-proto since the production deploy sits
// behind a reverse proxy/CDN that terminates TLS.
function originOf(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// A tiny HTML page carrying Open Graph tags so a shared link renders a rich
// preview in KakaoTalk / social, then bounces a human to the in-app view.
function sharePage(data, origin, id) {
  if (!data) {
    return `<!doctype html><meta charset="utf-8"><title>지금핫 NowHot</title><meta http-equiv="refresh" content="0; url=/"><p>이동 중…</p>`;
  }
  const url = `${origin}/p?id=${encodeURIComponent(id)}`;
  const title = escapeHtml(data.title);
  const desc = escapeHtml((data.summary || "").slice(0, 160) || `${data.source} · ${data.category}`);
  const appUrl = `/#post-${encodeURIComponent(id)}`;
  // 글에 사진이 있으면 그 사진이 공유 카드 그림이 된다. 없을 때만 앱 아이콘.
  // 폴백은 SVG가 아니라 PNG를 쓴다 — 다수 SNS 크롤러가 SVG를 미리보기 이미지로
  // 처리하지 않는다(설령 처리하더라도, 글마다 사진이 있는데 전부 같은 로고를
  // 주는 것 자체가 결함이므로 이 수정의 근거는 SVG 지원 여부와 무관하다).
  const shareImage = data.image && /^https?:\/\//i.test(data.image)
    ? data.image
    : `${origin}/icon-512.png`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="지금핫 NowHot">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(shareImage)}">
<meta name="twitter:card" content="${data.image ? "summary_large_image" : "summary"}">
<meta name="twitter:image" content="${escapeHtml(shareImage)}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<noscript><meta http-equiv="refresh" content="0; url=${appUrl}"></noscript>
</head><body style="background:#faf9f8;color:#14100e;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;padding:40px;text-align:center">
<p>${title}</p><p><a style="color:#e02b0f;font-weight:700" href="${appUrl}">앱에서 열기 →</a></p>
<script>
/* meta refresh 대신 replace: 일부 브라우저가 meta refresh를 "reload"로 보고해
   앱의 "새로고침은 홈으로" 규칙에 걸리고, 공유링크가 기사가 아니라 홈으로
   튕겼다(실사용 제보 2026-08-02). replace는 정상 내비게이션으로 보고된다. */
location.replace(${JSON.stringify(appUrl)});
</script>
</body></html>`;
}

function serveStatic(res, urlPath, seedHtml = "") {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  // prevent path traversal outside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    // 애드센스 사이트 소유 확인 + 광고 로더 (ADSENSE_CLIENT = "ca-pub-…").
    // 심사 단계에서는 이 스크립트 존재 자체가 사이트 확인 수단이다. env가
    // 없으면 아무것도 주입하지 않는다 — 광고 없는 배포는 완전히 무광고.
    const adsense = process.env.ADSENSE_CLIENT;
    const ga = process.env.GA_MEASUREMENT_ID; // GA4 측정 ID ("G-…") — 설정 시 gtag 주입

    // 홈 정적 콘텐츠 — 호출부(라우트)가 engine으로 만들어 넘긴다.
    // serveStatic은 engine을 모르는 순수 파일 서빙 함수라 여기서 만들 수 없다.
    // 브리핑 스트립 자리에 정적 링크를 심는다.
    //
    // 스트립은 JS로 채워지므로 크롤러에게는 빈 div다. 자체 콘텐츠 페이지로 가는
    // 유일한 통로가 그 안에 있는데 색인에서는 안 보이는 상태였다. 여기에 정적
    // <a>를 넣어두면 크롤러가 읽고, JS가 뜨면 실제 브리핑 카드가 같은 자리를
    // 대체한다(seed-list와 같은 방식). 별도 칩줄을 두는 것보다 화면이 깔끔하다.
    if (ext === ".html" && rel === "index.html") {
      const html0 = buf.toString("utf8");
      const mk = '<div class="brief-strip" id="briefStrip" hidden></div>';
      if (html0.includes(mk)) {
        buf = Buffer.from(html0.replace(mk,
          '<div class="brief-strip" id="briefStrip">' +
          '<a class="bs-seed" href="/briefing">지금 브리핑</a>' +
          '<a class="bs-seed" href="/ranking/daily">화제 랭킹 TOP 20</a>' +
          '<a class="bs-seed" href="/trends">실시간 트렌드</a>' +
          '</div>'));
      }
    }

    if (seedHtml && ext === ".html" && rel === "index.html") {
      const html = buf.toString("utf8");
      const marker = '<div id="feedSkel">';
      const start = html.indexOf(marker);
      const endMark = "</div>\n    </div>";
      const end = start >= 0 ? html.indexOf(endMark, start) : -1;
      if (start >= 0 && end > start) {
        buf = Buffer.from(
          html.slice(0, start) +
          `<div id="feedSkel"><h2 class="seed-h">지금 화제인 글</h2>${seedHtml}</div>` +
          html.slice(end + endMark.length)
        );
      }
    }

    if ((adsense || ga) && ext === ".html" && rel === "index.html") {
      let tags = "";
      if (adsense) tags += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsense}" crossorigin="anonymous"></script>\n`;
      if (ga) tags += `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${ga}');</script>\n`;
      buf = Buffer.from(buf.toString("utf8").replace("</head>", tags + "</head>"));
    }
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

// IndexNow 키 — 없으면 기능 전체가 비활성(키 파일도, 통보도 없다).
// 모듈 로드 시점이 아니라 **쓰는 시점**에 읽는다. 상수로 굳히면 프로세스를
// 재시작하지 않고는 켤 수 없고, 테스트에서도 설정을 바꿀 수 없다.
const indexNowKey = () => process.env.INDEXNOW_KEY || null;

export function createServer(opts = {}) {
  const store = new FeedStore({ file: opts.file || process.env.FEED_DB || null });

  // Social login (src/feed/auth.js). authStates is the short-lived CSRF-state
  // ledger for the login->callback round trip; opts.authFetch lets tests mock
  // every provider's token/userinfo endpoints with no network access (server
  // itself always defaults to the real global fetch).
  const authStates = new AuthStateStore();
  const authEnv = opts.authEnv || process.env;

  // Build sources from the community registry DB (国内+해외+성인), plus the
  // store-backed source that surfaces users' own posts. Overseas sources are
  // wrapped for translation when a translator is wired via opts.translate.
  let registry = [];
  let sources;
  // FEED_DEV=1 enables the bundled dev seed dataset. Off by default: the
  // hardcoded sample content must never appear in a real feed (원칙: 실데이터만).
  const dev = opts.dev != null ? Boolean(opts.dev) : Boolean(process.env.FEED_DEV);
  // FEED_LIVE turns on real ingestion for enabled non-seed communities.
  const live = opts.fetcher || (process.env.FEED_LIVE ? makeFetcher : null);
  // FEED_TRANSLATE turns on free machine translation for overseas sources
  // (techmeme, slashdot, hackernews, devto, tildes, ...). registry.js wraps
  // every source whose lang !== targetLang ("ko") in TranslatingSource
  // whenever a `translate` config is passed at all — that wrapping itself
  // (title/summary pass-through + `needsTranslation` flag for the UI's "원문"
  // badge, see translate.js) is always on, regardless of the env var. Only
  // the *translateFn* is gated behind FEED_TRANSLATE=1, because the free
  // endpoint (translator.js) is unofficial/no-SLA, so a deploy opts in
  // explicitly to actually calling it. Off (default): TranslatingSource still
  // wraps overseas sources but with no translateFn -> items pass through
  // untouched, flagged `needsTranslation`, exactly like before this feature
  // existed. On: the same wrapping now actually translates title+excerpt.
  const translate =
    opts.translate !== undefined
      ? opts.translate
      : { targetLang: "ko", translateFn: process.env.FEED_TRANSLATE ? memoizedTranslator(googleFreeTranslator()) : null };
  try {
    registry = loadRegistry();
    sources = buildSources(registry, { translate, seed: dev, fetcher: live ? (e) => live(e)() : undefined });
  } catch (err) {
    sources = dev ? [new SeedSource()] : [];
  }
  if (!dev && !live) {
    console.warn(
      "[feed] FEED_LIVE off & FEED_DEV off — feed will only contain user posts. " +
        "Set FEED_LIVE=1 for real ingestion, or FEED_DEV=1 for the dev seed dataset."
    );
  }
  sources.push(new StorePostsSource(store));
  const engine = new FeedEngine(store, opts.sources || sources);

  // 썸네일 보강 (enrich.js): image 없는 아이템의 원문 og:image URL 핫링크 채움.
  // FEED_ENRICH_IMAGES=0 으로 끌 수 있다. node --test 자식 프로세스에서는
  // 기본 비활성 — 테스트 픽스처의 가짜 url로 실제 네트워크를 치지 않기 위해.
  if (process.env.FEED_ENRICH_IMAGES !== "0" && !process.env.NODE_TEST_CONTEXT) {
    // 사이클당 120건(15분 주기 = 분당 8건, 대부분 서로 다른 도메인이라 부담이
    // 아주 낮다). 40건일 때 라이브 이미지 보유율이 40%에 머물렀다 — 900건 풀을
    // 도는 데 5시간 넘게 걸렸기 때문(David 2026-08-01 사진 우선 요구 대응).
    engine._enricher = makeEnricher({
      maxPerCycle: Number(process.env.FEED_ENRICH_PER_CYCLE || 250),
      initialCache: store.loadEnrichCache ? store.loadEnrichCache() : null,
      onPersist: (entries, nowMs) => { if (store.saveEnrichCache) store.saveEnrichCache(entries, nowMs); }
    });
  }

  // X 실시간 트렌드 캐시 (trends.js — 키워드만, 트윗 본문 없음). 테스트
  // 프로세스에서는 네트워크를 치지 않도록 기본 비활성.
  const trendsCache = process.env.FEED_X_TRENDS !== "0" && !process.env.NODE_TEST_CONTEXT
    ? makeTrendsCache() : null;

  // 정기 DB 갱신: refresh the collected pool on an interval when configured.
  const refreshMs = Number(opts.refreshMs || process.env.FEED_REFRESH_MS || 0);
  if (refreshMs > 0) engine.startAutoRefresh(refreshMs);

  // 쿠팡파트너스 실연동 — 키 3종(COUPANG_PARTNER_ID/ACCESS_KEY/SECRET_KEY)이
  // 모두 있을 때만. 베스트 상품 캐시를 시작 시 1회 + 1시간마다 갱신하고,
  // 엔진에 동기 productFeed를 주입한다. 키가 없으면 아무것도 안 한다(무광고).
  if (coupangCreds()) {
    engine._productFeed = makeCoupangProductFeed();
    const warm = () => refreshCoupangCache().then(
      (r) => console.log("[coupang] product cache:", JSON.stringify(r.counts || r)),
      (e) => console.warn("[coupang] cache refresh failed:", e && e.message)
    );
    warm();
    const t = setInterval(warm, Number(process.env.COUPANG_CACHE_TTL_MS || 3600000));
    if (t.unref) t.unref();
  }

  // Admin auth. Set ADMIN_TOKEN in production; a dev default is used otherwise.
  const ADMIN_TOKEN = opts.adminToken || process.env.ADMIN_TOKEN || "admin-dev";
  if (ADMIN_TOKEN === "admin-dev") {
    console.warn("[admin] ADMIN_TOKEN not set — using insecure dev token 'admin-dev'");
  }
  const isAdmin = (req, url) =>
    (req.headers["x-admin-token"] || url.searchParams.get("token")) === ADMIN_TOKEN;

  // Web Push (VAPID / RFC 8292). opts.vapid lets tests inject a keypair without
  // env vars; production sets VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (generate a
  // pair with `npm run push:keys`). Missing keys just disable server-sent push
  // — the in-app digest banner (GET /api/digest) still works without them.
  const vapid = opts.vapid || (
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? {
          publicKey: process.env.VAPID_PUBLIC_KEY,
          privateKey: process.env.VAPID_PRIVATE_KEY,
          subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com"
        }
      : null
  );
  if (!vapid) {
    console.warn(
      "[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — Web Push disabled " +
        "(in-app digest banner still works). Run `npm run push:keys` to generate a pair."
    );
  }

  // 관심글 다이제스트 푸시: PUSH_DIGEST_MS(ms)가 설정되어 있으면 주기적으로 모든
  // 구독자를 훑어 안 본 관심글이 있는 사람에게만 보낸다. VAPID가 없으면 보낼 수
  // 없으니 그냥 꺼둔다.
  const pushDigestMs = Number(opts.pushDigestMs || process.env.PUSH_DIGEST_MS || 0);
  if (pushDigestMs > 0 && vapid) {
    const pushTimer = setInterval(() => {
      sendDigestPushes(store, engine, vapid, { sendImpl: opts.pushSendImpl }).catch(() => {});
    }, pushDigestMs);
    if (pushTimer.unref) pushTimer.unref();
  }

  // IndexNow — 수집 사이클마다 자체 콘텐츠 URL을 통보한다.
  // 브리핑이 하루 3회 갱신되는데 크롤러를 기다리면 그만큼 유입이 늦다.
  // 키가 없으면 아무 일도 하지 않는다(no-op).
  const indexNow = makeIndexNow({
    key: indexNowKey(),
    host: process.env.PUBLIC_HOST || "nowhot.kr"
  });
  if (indexNowKey()) {
    const notify = () => {
      indexNow.ping(["/", "/briefing", "/ranking/daily", "/trends"]).catch(() => {});
    };
    notify();
    const t = setInterval(notify, Number(process.env.INDEXNOW_INTERVAL_MS || 6 * 3600 * 1000));
    if (t.unref) t.unref();
  }

  // ---- 자체 콘텐츠 페이지(브리핑·랭킹) 공통 렌더링 --------------------------
  // 애드핏 3차 보류("자체 콘텐츠 부족") 대응 + David 지시(2026-07-31: 홈 최상단
  // 테마별 브리핑, 일·주·월간 화제 랭킹 TOP 20). 문장·수치는 전부 실측 신호로만
  // 조립하고, 페이지들이 서로(그리고 상세뷰로) 내부 링크를 걸어 "대부분
  // 아웃링크" 구조를 실제로 희석한다.
  // 자체 콘텐츠 페이지의 광고 지면.
  //
  // 2026-08-03 실측: /briefing·/ranking·/trends에 광고 코드가 **0개**였다.
  // sitemap에 올린 21개 URL의 대부분이 이 페이지들이고, 검색으로 들어온 사람이
  // 실제로 보는 화면인데 수익 지면이 없어 유입이 통째로 새고 있었다.
  //
  // 배치 원칙: 본문 위에 얹지 않고 **본문이 한 덩어리 끝난 뒤**에 넣는다.
  // 읽는 흐름을 끊으면 체류가 죽고, 애드센스 정책상으로도 콘텐츠보다 광고가
  // 앞서는 배치는 위험하다. 페이지당 2개까지만 — 애드핏 정책 상한(3개)보다
  // 보수적으로 두되, 지면이 0인 지금보다는 확실히 낫다.
  // 쿠팡 파트너스 배너 — API 승인 전에도 쓸 수 있는 유일한 제휴 수익 경로.
  //
  // 대가성 문구는 **법적 의무**이고 쿠팡도 "활동 준수 사항을 지키지 않으면
  // 수익금 지급이 중단될 수 있습니다"라고 명시한다. 배너가 렌더될 때 반드시
  // 함께 나가야 하므로 같은 함수 안에서 붙인다 — 따로 두면 한쪽만 빠진다.
  // 브리핑 해설 생성기. ANTHROPIC_API_KEY가 없으면 호출 자체를 안 하고
  // 규칙 기반 브리핑이 그대로 나간다 — 로컬 개발과 키 미설정 배포가 안 깨진다.
  const llmWriter = makeWriter({
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    log: (m) => console.log(m)
  });
  // 슬롯(모닝/런치/이브닝)과 이슈 구성이 같으면 같은 해설을 쓴다. 15분마다
  // 갱신되는 브리핑이 매번 API를 부르지 않도록 헤드라인 조합을 키에 넣는다.
  const llmKey = (b) => `${b.date}|${b.slot}|${(b.issues || []).map((i) => i.headline).join("|")}`;
  const withEssay = async (b) => (b && b.publishable ? llmWriter(b, llmKey(b)) : b);

  const COUPANG_DISCLOSURE = AD_DISCLOSURE;
  // pick — 회전 인덱스. 예전엔 인자를 안 넘겨 pick=0으로 고정됐고, 그래서
  // 32장 재고가 있어도 **모든 방문자가 매 페이지에서 같은 배너 한 장**을 봤다
  // (2026-08-03 검수 실측: /briefing·/trends·/ranking 전부 tech 배너).
  // size도 이미지 시대의 유물이다 — 크리에이티브를 우리가 그리므로 배너의
  // 픽셀 크기는 의미가 없고, 필터로 두면 재고만 절반으로 자른다.
  const coupangBannerHtml = (category, size = null, pick = 0, slot = "page") => {
    const b = pickBanner({ category, size, pick });
    if (!b) return "";
    const [hook, brand] = adCopy(b.dest);
    // 배너 사진을 **다시 싣는다.**
    //
    // 2026-08-03 오전에는 실기기에서 사진이 안 떠서 이미지를 통째로 뺐다.
    // 그날 오후 재실측: 아이폰 사파리 UA + Referer로 요청해도 302 → 200
    // image/png 46KB가 정상으로 온다. 즉 쿠팡이 막은 게 아니라 그 폰의
    // 콘텐츠 차단기가 ads-partners 도메인을 거른 것이다.
    // 사진이 있는 광고가 글자만 있는 광고보다 확실히 잘 눌린다. 그래서
    // **사진을 기본으로 두고, 못 받는 사용자에게만** 글자 카드가 남게 한다
    // (onerror로 img만 지운다 — 나머지 문구가 그 자체로 완결된 카드다).
    // 프록시로 우회하지 않는 이유: 노출 집계가 사용자 IP가 아니라 우리 서버
    // IP에서 발생해 무효 트래픽으로 읽힐 수 있다. 계정을 오래 지키는 게 우선이다.
    const [w, h] = String(b.size || "320x100").split("x");
    return `<aside class="ad-slot ad-coupang">
      <p class="ad-mark"><span class="ad-tag">AD</span> 쿠팡 파트너스</p>
      <a class="ad-native" href="${escapeHtml(withSubId(b.href, slot))}" target="_blank" rel="nofollow sponsored noopener" referrerpolicy="unsafe-url">
        <img class="ad-img" src="${escapeHtml(b.img)}" width="${escapeHtml(w)}" height="${escapeHtml(h)}"
             alt="${escapeHtml(brand)}" loading="lazy" onerror="this.remove()">
        <b>${escapeHtml(hook)}</b><span class="ad-brand">${escapeHtml(brand)}</span>
        <span class="ad-go">쿠팡에서 보기 &rarr;</span></a>
      <p class="ad-disclosure">${COUPANG_DISCLOSURE}</p></aside>`;
  };

  const adSlotHtml = (slot) => {
    const adsense = process.env.ADSENSE_CLIENT;
    const adfitUnit = process.env.ADFIT_UNIT_MOBILE;
    if (slot === "adfit" && adfitUnit) {
      return `<div class="ad-slot"><span class="ad-mark">AD</span>
        <ins class="kakao_ad_area" style="display:none;" data-ad-unit="${escapeHtml(adfitUnit)}" data-ad-width="320" data-ad-height="100"></ins></div>`;
    }
    if (slot === "adsense" && adsense) {
      // 반응형 자동 크기 — 페이지 폭(720px)에 맞춰 구글이 채운다
      return `<div class="ad-slot"><span class="ad-mark">AD</span>
        <ins class="adsbygoogle" style="display:block" data-ad-client="${escapeHtml(adsense)}"
          data-ad-format="auto" data-full-width-responsive="true"></ins>
        <script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`;
    }
    return "";
  };
  // 광고 로더 — 자체 콘텐츠 페이지는 index.html의 주입 경로를 타지 않으므로
  // 여기서 직접 넣는다.
  const adLoadersHtml = () => {
    let out = "";
    if (process.env.ADSENSE_CLIENT) {
      out += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeHtml(process.env.ADSENSE_CLIENT)}" crossorigin="anonymous"></script>`;
    }
    if (process.env.ADFIT_UNIT_MOBILE) {
      out += `<script async src="https://t1.kakaocdn.net/kas/static/ba.min.js"></script>`;
    }
    return out;
  };

  // 자체 콘텐츠 페이지의 검색 노출용 공통 머리. canonical·og:image가 없으면
  // 같은 내용이 여러 주소로 인식되거나 공유 카드가 비어 나간다.
  const editionShell = (title, desc, inner, canonicalPath = "", ownLinks = "", coupangBanner = "") => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — 지금핫 NowHot</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:title" content="${escapeHtml(title)} — 지금핫 NowHot">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="지금핫 NowHot">
<meta property="og:image" content="https://nowhot.kr/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="지금핫 NowHot" href="https://nowhot.kr/rss.xml">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: title,
  description: desc,
  inLanguage: "ko",
  isPartOf: { "@type": "WebSite", name: "지금핫 NowHot", url: "https://nowhot.kr/" },
  publisher: { "@type": "Organization", name: "페퍼클럽", url: "https://nowhot.kr/" }
})}</script>
${canonicalPath ? `<link rel="canonical" href="https://nowhot.kr${escapeHtml(canonicalPath)}">
<meta property="og:url" content="https://nowhot.kr${escapeHtml(canonicalPath)}">` : ""}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&display=swap" rel="stylesheet">
<style>/* Modernist 스킨 (NowHot.dc, 2026-08-01) — 라이트 기본, OS 다크 추종 */
:root{--bg:#f3f2f2;--surface:#eae9e9;--text:#201e1d;--accent:#ec3013;
--divider:color-mix(in srgb,#201e1d 40%,transparent);--line:color-mix(in srgb,#201e1d 16%,transparent);
--muted:color-mix(in srgb,#201e1d 55%,transparent)}
@media (prefers-color-scheme:dark){:root{--bg:#171615;--surface:#201e1d;--text:#f3f2f2;--accent:#ff563c;
--divider:color-mix(in srgb,#f3f2f2 34%,transparent);--line:color-mix(in srgb,#f3f2f2 18%,transparent);
--muted:color-mix(in srgb,#f3f2f2 55%,transparent)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:"Archivo","Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.75;font-size:15px}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px 80px}
h1{font:800 24px/1.2 "Archivo",sans-serif;letter-spacing:-.015em;margin:0 0 2px}
h2{font-size:16px;font-weight:800;letter-spacing:-.01em;margin:26px 0 8px;padding-top:14px;border-top:2px solid var(--divider)}
.muted{color:var(--muted);font-size:13px}a{color:var(--accent);text-decoration:none;text-underline-offset:3px}
ul{padding-left:18px;margin:8px 0}li{margin:6px 0}.m{color:var(--muted);font-size:12.5px;display:block}
/* 자체 콘텐츠 상호 링크 — 검색으로 들어온 사람이 다음 페이지로 가는 통로 */
.own-links{margin:28px 0 0;padding-top:14px;border-top:2px solid var(--divider)}
.own-links h2{border:none;padding:0;margin:0 0 8px;font-size:15px}
.own-links ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.own-links li{margin:0}
.own-links a{display:inline-block;border:1px solid var(--line);padding:5px 11px;font-size:13px;font-weight:700}
/* ④ 이슈 블록 — 본문이 읽히는 글이 되도록 문단에 무게를 준다 */
.issue{margin:22px 0}
.issue h2{font-size:17px;margin:0 0 6px}
.issue p{font-size:15px;line-height:1.7;margin:0 0 8px}
.issue .tone{border:1px solid var(--line);padding:1px 6px;font-size:11px}
/* 브리핑 목록의 한 줄 요약 — 제목보다 약하고 지표줄보다 강한 층위 */
.s{display:block;margin:3px 0 1px;font-size:13.5px;line-height:1.5;color:var(--color-text)}
ol.rank{padding-left:0;margin:14px 0;list-style:none;counter-reset:r;border-top:2px solid var(--divider)}
ol.rank li{counter-increment:r;display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);margin:0}
ol.rank li::before{content:counter(r);font:800 20px "Archivo",sans-serif;color:var(--muted);min-width:30px}
ol.rank li:first-child::before{color:var(--accent)}
ol.rank li a{color:var(--text);font-weight:700}
.nav{display:flex;gap:0;flex-wrap:wrap;margin:14px 0;border:1px solid var(--line)}
.nav a{border-right:1px solid var(--line);padding:8px 14px;font:800 13px "Archivo",sans-serif;color:var(--text)}
.nav a:last-child{border-right:none}
.nav a.on{background:var(--accent);color:var(--bg)}
.back{display:inline-block;margin-bottom:18px;color:var(--accent);font-weight:700}
.heat{display:inline-flex;align-items:flex-end;gap:3px;height:18px;margin-top:6px}
.heat i{display:block;width:4px;background:color-mix(in srgb,var(--text) 30%,transparent)}
.heat i.a{background:var(--accent)}
.heat i.e{height:3px;background:color-mix(in srgb,var(--text) 12%,transparent)}
/* 광고 지면 — 본문과 확실히 분리되게 괘선으로 감싸고 AD 표기를 붙인다.
   콘텐츠로 오인되면 애드센스 정책 위반이고, 사용자 신뢰도 깎인다. */
/* 광고 지면 — 본문과 확실히 분리되게 면으로 감싸고 AD 표기를 붙인다.
  콘텐츠로 오인되면 애드센스 게재위치 정책 위반이고 신뢰도 깎인다.
  radius 0 — 이 페이지의 다른 모든 요소와 같은 문법을 쓴다. */
.ad-slot{margin:28px 0;padding:14px 16px;border:1px solid var(--line)}
.ad-mark{display:flex;align-items:center;gap:9px;margin:0 0 12px;
  font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--text)}
/* AD 칩 = 잉크/종이 반전. 페이지 최대 대비라 라이트·다크 양쪽에서 확실히 보인다.
  예전엔 본문과 같은 회색이라 표시로서 기능하지 못했다. */
.ad-tag{background:var(--text);color:var(--bg);padding:3px 9px;
  font-size:11px;font-weight:800;letter-spacing:.08em}
.ad-coupang{text-align:left}
/* 사진 자리 타일 — 배너 이미지가 차단당해 사라진 자리를 글자로 메운다.
  해칭·스켈레톤은 "사진이 깨졌다"로 읽히지만(실기기 전례) 글자는 그렇지 않다. */
.ad-native{display:block;text-decoration:none;color:inherit;min-height:44px}
/* 배너 사진 — 차단기에 걸려 못 받으면 onerror가 이 요소만 지우고, 남은
  문구가 그대로 완결된 카드가 된다. 빈 자리나 깨진 아이콘은 남지 않는다. */
.ad-native .ad-img{display:block;max-width:100%;height:auto;margin-bottom:12px;
  border:1px solid var(--line)}
.ad-native b{display:block;font-size:17px;line-height:1.35;margin-bottom:3px}
.ad-native .ad-brand{display:block;font-size:13px;color:var(--muted)}
.ad-native .ad-go{display:block;margin-top:8px;font-size:14px;font-weight:800;color:var(--text)}
.ad-disclosure{margin:10px 0 0;padding-top:9px;border-top:1px solid var(--line);
  font-size:11.5px;line-height:1.55;color:var(--muted)}</style>${adLoadersHtml()}</head><body><div class="wrap">
<a class="back" href="/">← 지금핫 피드로</a>
${inner}
${coupangBanner}
${ownLinks}
${adSlotHtml("adsense")}
${adSlotHtml("adfit")}
<p class="muted">이 페이지는 지금핫 NowHot이 수집한 공개 반응 지표(추천·댓글·보도량)만으로 작성한 자체 편집 콘텐츠입니다. 각 글의 전문은 출처에서 읽을 수 있습니다. ⓒ 페퍼클럽</p>
</div></body></html>`;
  const fmtNum = (n) => n >= 10000 ? `${Math.round(n / 1000) / 10}만` : String(n);
  // 받침 유무 조사 선택 — "(한겨레)이 있습니다" 같은 오류(2차 검수) 방지용.
  const josa = (w, withBatchim, without) => {
    const c = String(w || "").replace(/[^가-힣a-zA-Z0-9]+$/g, "").slice(-1).charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? withBatchim : without;
    return withBatchim; // 한글 아님(숫자·영문) — 단정 대신 무난한 쪽
  };
  const kstLabel = (iso) => {
    const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
  };
  // 항목별 "왜 뽑혔나" 근거 배지 — 납득은 근거 공개가 만든다
  const evidenceBits = (i) => {
    const bits = [];
    if (i.score > 0) bits.push(`추천 ${fmtNum(i.score)}`);
    if (i.commentCount > 0) bits.push(`댓글 ${fmtNum(i.commentCount)}`);
    if (i.coverage >= 3) bits.push(`${i.coverage}개 매체 교차보도`);
    return bits;
  };
  // 열기 눈금 — 실측 시계열이 있을 때만 (없으면 아무것도 안 그린다)
  // 앱과 동일 규칙: 13칸 고정 폭, 미수집 구간은 옅은 기준선, 최신 3칸만 액센트
  const heatBar = (h) => {
    if (!Array.isArray(h) || h.length < 3) return "";
    const rising = h.some((v) => v > 0);
    const pad = Math.max(0, 13 - h.length);
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push('<i class="e"></i>');
    h.forEach((v, idx) => {
      const recent = rising && idx >= h.length - 3;
      cells.push(`<i class="${recent ? "a" : ""}" style="height:${Math.max(3, Math.round(v * 18))}px"></i>`);
    });
    return `<span class="heat" title="최근 화제도 추이">${cells.join("")}</span>`;
  };
  const rankRow = (i, n) => {
    const bits = evidenceBits(i);
    return `<li value="${n}"><div><a href="/#post-${encodeURIComponent(i.id)}">${escapeHtml(maskProfanity(i.title))}</a>
      <span class="m">${escapeHtml(i.sourceLabel)} · ${escapeHtml(i.categoryLabel)}${bits.length ? " · " + bits.join(" · ") : ""}</span>
      ${heatBar(i.heat)}</div></li>`;
  };
  // 랭킹을 구간별 h2 섹션으로 나눈다.
  //
  // 구글 SEO 가이드: "긴 콘텐츠를 단락과 섹션으로 나누고 사용자가 페이지를
  // 탐색하는 데 도움이 되는 제목을 제공". 실측(2026-08-03)에서 랭킹 페이지는
  // h1 하나 아래 20개가 통째로 있어 h2가 0개였다(브리핑은 19개).
  // 구간 제목에 순위를 넣으면 검색 결과에서 "TOP 5" 같은 질의와도 맞는다.
  const RANK_BANDS = [
    { from: 1, to: 5, label: "1~5위 — 오늘 가장 크게 터진 글" },
    { from: 6, to: 10, label: "6~10위" },
    { from: 11, to: 20, label: "11~20위" }
  ];
  // mid — 첫 밴드 뒤에 끼워 넣을 지면. 광고를 페이지 맨 아래에만 두면 TOP 20을
  // 전부 스크롤한 사람만 보게 되고, 실제로 아무도 보지 못했다(David 2026-08-03:
  // "제일 하단에만 하나 띡 들어가있고 하면 누가 이걸 보지도 못하겠다").
  const rankingRows = (items, mid = "") => {
    let placed = false;
    return RANK_BANDS.map((b) => {
      const slice = items.slice(b.from - 1, b.to);
      if (!slice.length) return "";
      const html = `<section><h2>${escapeHtml(b.label)}</h2>
      <ol class="rank" start="${b.from}">${slice.map((i, k) => rankRow(i, b.from + k)).join("")}</ol></section>`;
      if (mid && !placed) { placed = true; return html + mid; }
      return html;
    }).join("");
  };
  // 주간/월간: 일별 스냅샷 병합 — 같은 글은 최고 기록으로 dedup, 소스당 2개 상한 재적용
  const mergeRankings = (editions, limit = 20) => {
    const best = new Map();
    for (const e of editions) {
      for (const it of ((e && e.ranking && e.ranking.items) || [])) {
        const prev = best.get(it.id);
        if (!prev || (it.hot || 0) > (prev.hot || 0)) best.set(it.id, it);
      }
    }
    const sorted = [...best.values()].sort((a, b) => (b.hot || 0) - (a.hot || 0));
    const perSrc = new Map();
    const out = [];
    for (const it of sorted) {
      if (out.length >= limit) break;
      const c = perSrc.get(it.source) || 0;
      if (c >= 2) continue;
      perSrc.set(it.source, c + 1);
      out.push(it);
    }
    return out;
  };
  // ④ 이슈 다이제스트 렌더 — 브리핑의 본문.
  // 예전엔 카테고리마다 같은 템플릿 한 줄 + 원문 발췌였다. 발췌 자리에 원문
  // URL과 영어 원문이 그대로 실려, 애드핏이 지적한 "외부 콘텐츠 비중"을 우리
  // 손으로 증명하고 있었다(2026-08-03 실측). 이제 본문은 전부 우리가 측정한
  // 값으로 쓴 문장이고(digest.js), 외부 원문은 한 줄도 싣지 않는다.
  const issuesHtml = (b) => (b.issues || []).map((is, n) => `<section class="issue">
      <h2>${n + 1}. ${escapeHtml(maskProfanity(is.headline))}</h2>
      ${is.essay ? `<p>${escapeHtml(maskProfanity(is.essay))}</p>` : ""}
      <p>${escapeHtml(maskProfanity(is.paragraph))}</p>
      <div class="m"><span class="tone">${escapeHtml(is.tone)}</span> · 관련 글 ${is.refs.length}건</div>
      <ul>${is.refs.map((r) => `<li><a href="/#post-${encodeURIComponent(r.id)}">${escapeHtml(maskProfanity(r.title))}</a>
        <span class="m">${escapeHtml(r.sourceLabel)}${evidenceBits(r).length ? " · " + evidenceBits(r).join(" · ") : ""}</span></li>`).join("")}</ul>
    </section>`).join("");

  const briefingSectionsHtml = (b, mid = "") => { let midPlaced = false; return b.sections.map((sec) => {
    const lead = sec.items[0];
    // 실측이 0인 지표는 문장에서 아예 뺀다 — "추천 0·댓글 86을 모으며 화제의
    // 중심"은 자기모순이다(적대적 검수 2026-07-31, 태호·지영 페르소나 지적).
    const leadParts = [];
    if (lead.score > 0) leadParts.push(`추천 ${fmtNum(lead.score)}`);
    if (lead.commentCount > 0) leadParts.push(`댓글 ${fmtNum(lead.commentCount)}`);
    const leadLine = leadParts.length
      ? `현재 반응은 ${leadParts.join(" · ")} — ${escapeHtml(sec.label)} 화제의 중심입니다.`
      : (lead.coverage >= 3 ? `여러 매체가 동시에 다루고 있는 사안입니다.` : `${escapeHtml(lead.sourceLabel)}의 상위 글로 올라와 있습니다.`);
    const rows = sec.items.map((i) => {
      const bits = evidenceBits(i);
      // 발췌를 실으면 비로소 "요약"이 된다. 2026-08-02 검수 실측에서는 10개
      // 섹션 전부가 같은 템플릿 문장 + 제목 나열이었고 설명 문장이 0개였다 —
      // 애드핏이 요구한 "자체 콘텐츠"의 반대편이다. 피드에는 이미 summary가
      // 있는데 브리핑에서 한 줄도 쓰지 않고 있었다.
      return `<li><a href="/#post-${encodeURIComponent(i.id)}">${escapeHtml(maskProfanity(i.title))}</a>
        <span class="m">${escapeHtml(i.sourceLabel)}${bits.length ? " · " + bits.join(" · ") : ""}</span></li>`;
    }).join("");
    const html = `<section><h2><a href="/briefing/${encodeURIComponent(sec.category)}" style="color:inherit">${escapeHtml(sec.label)}</a></h2>
      <p>${escapeHtml(sec.label)} 분야에서 가장 뜨거운 글은 <b>“${escapeHtml(maskProfanity(lead.title))}”</b>(${escapeHtml(lead.sourceLabel)})입니다. ${leadLine}</p>
      <ul>${rows}</ul></section>`;
    if (mid && !midPlaced) { midPlaced = true; return html + mid; }
    return html;
  }).join(""); };
  // 자체 콘텐츠 상호 링크.
  //
  // 실측(2026-08-03): sitemap에 /briefing/tech 등 카테고리 브리핑 10개가 있는데
  // **어느 페이지에서도 링크가 없는 고아 페이지**였다. 구글은 내부 링크로
  // 발견 가능한지를 중요하게 보고, 링크 없는 페이지는 색인 우선순위가 낮다.
  // 사용자 쪽으로도 이득이다 — 검색으로 한 페이지에 들어온 사람이 다른 자체
  // 콘텐츠로 넘어갈 길이 생기면 체류·페이지뷰가 늘고 그게 곧 광고 수익이다.
  const ownContentNav = (current = "") => {
    const cats = [...new Set(registry.filter((c) => c.enabled && c.category).map((c) => c.category))];
    const links = [
      { href: "/briefing", label: "지금 브리핑" },
      { href: "/ranking/daily", label: "화제 랭킹" },
      { href: "/trends", label: "실시간 트렌드" },
      ...cats.map((c) => ({ href: `/briefing/${encodeURIComponent(c)}`, label: `${categoryLabel(c)} 브리핑` }))
    ].filter((l) => l.href !== current);
    return `<nav class="own-links" aria-label="지금핫이 만든 다른 콘텐츠">
      <h2>다른 브리핑도 보기</h2>
      <ul>${links.map((l) => `<li><a href="${l.href}">${escapeHtml(l.label)}</a></li>`).join("")}</ul>
    </nav>`;
  };

  const rankingNav = (active) => `<div class="nav">
    <a href="/ranking/daily" class="${active === "daily" ? "on" : ""}">일간</a>
    <a href="/ranking/weekly" class="${active === "weekly" ? "on" : ""}">주간</a>
    <a href="/ranking/monthly" class="${active === "monthly" ? "on" : ""}">월간</a>
    <a href="/briefing">브리핑</a></div>`;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    // HEAD를 GET처럼 라우팅하고 본문만 비운다.
    //
    // 2026-08-03 실측: 서치콘솔에 sitemap을 제출했더니 "가져올 수 없음"이 떴다.
    // XML도 유효하고 GET은 200인데, **HEAD가 404**였다 — 모든 라우트가
    // `req.method === "GET"`만 보기 때문이다. 구글은 sitemap·robots를 가져오기
    // 전에 HEAD를 보내는 경우가 있고, 404를 받으면 가져오기 실패로 판정한다.
    // HEAD는 GET과 같은 헤더에 본문만 없어야 한다는 것이 HTTP 규약이기도 하다.
    const isHead = req.method === "HEAD";
    if (isHead) {
      req.method = "GET";
      const origEnd = res.end.bind(res);
      const origWrite = res.write.bind(res);
      res.write = () => true;                 // 본문은 버린다
      res.end = (...args) => origEnd(typeof args[0] === "function" ? args[0] : undefined);
      void origWrite; // 위에서 교체됐음을 명시 (원본은 쓰지 않는다)
    }

    try {
      // --- API ---
      if (p === "/api/health") return send(res, 200, { ok: true });

      // "오늘의 브리핑" — 실측 데이터로 서버가 직접 작성하는 일일 편집 페이지.
      // 애드핏 보류 사유("대부분 아웃링크, 자체 콘텐츠 부족") 대응이자 애드센스
      // "부가가치" 요건 보강. 문장은 전부 실측 수치로만 조립한다(숫자 조작 금지).
      // ---- RSS 피드 (2026-08-03) ------------------------------------------
      //
      // 네이버 서치어드바이저는 사이트맵과 **별개로 RSS를 받아** 새 글을 훨씬
      // 빨리 수집한다. 우리는 브리핑이 하루 3회 갱신되는 구조라 RSS가 붙으면
      // 그 리듬을 검색엔진이 따라온다.
      //
      // 싣는 것은 **우리가 쓴 문장**뿐이다 — 이슈 문단과 실측 지표. 외부 원문
      // 본문을 RSS로 재배포하면 저작권 문제이자, 애드핏이 지적한 "외부 콘텐츠
      // 비중"을 스스로 키우는 짓이다.
      if (p === "/rss.xml" && req.method === "GET") {
        const origin = originOf(req);
        const b = await withEssay(await engine.briefing());
        const rankTop = ((await engine.rankingTop(20)) || {}).items || [];
        const now = new Date().toUTCString();
        const esc = (t) => escapeHtml(maskProfanity(String(t || "")));
        const items = [];
        // 1) 이번 편 브리핑 이슈 — 우리가 쓴 문단이 그대로 description이 된다
        for (const is of (b.issues || [])) {
          items.push({
            title: `${b.slot ? b.slot.label + " · " : ""}${is.headline}`,
            link: `${origin}/briefing`,
            desc: is.paragraph,
            guid: `${origin}/briefing#${encodeURIComponent(is.headline)}`
          });
        }
        // 2) 화제 랭킹 상위 — 설명은 원문 발췌가 아니라 우리 실측 지표다
        for (const i of rankTop.slice(0, 15)) {
          const bits = [];
          if (i.score > 0) bits.push(`추천 ${i.score}`);
          if (i.commentCount > 0) bits.push(`댓글 ${i.commentCount}`);
          if (i.coverage >= 3) bits.push(`${i.coverage}개 매체 보도`);
          items.push({
            title: i.title,
            link: `${origin}/#post-${encodeURIComponent(i.id)}`,
            desc: `${i.sourceLabel || ""}${bits.length ? " — " + bits.join(" · ") : ""} (지금핫 실측)`,
            guid: `${origin}/#post-${encodeURIComponent(i.id)}`
          });
        }
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>지금핫 NowHot — 커뮤니티·뉴스 실시간 인기글</title>
<link>${esc(origin)}/</link>
<description>여러 커뮤니티와 주요 뉴스에서 지금 가장 화제인 글을 지금핫이 실측 반응 수치로 정리합니다.</description>
<language>ko</language>
<lastBuildDate>${now}</lastBuildDate>
${items.map((it) => `<item><title>${esc(it.title)}</title><link>${esc(it.link)}</link>` +
  `<guid isPermaLink="false">${esc(it.guid)}</guid><description>${esc(it.desc)}</description>` +
  `<pubDate>${now}</pubDate></item>`).join("\n")}
</channel></rss>
`;
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(body);
        return;
      }

      // ---- IndexNow 키 파일 -------------------------------------------------
      // 네이버·빙이 지원하는 즉시 색인 통보 프로토콜(네이버 웹마스터 공지
      // 2023-07-25). 새 콘텐츠가 생기면 우리가 먼저 알린다 — 크롤러가 올 때까지
      // 기다리지 않아도 된다. 키는 env로 주고, 이 파일이 소유 증명이 된다.
      const inKey = indexNowKey();
      if (inKey && p === `/${inKey}.txt` && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(inKey);
        return;
      }

      // ② robots.txt · sitemap.xml (2026-08-03)
      //
      // 둘 다 404였다. 즉 이미 만들어 둔 자체 콘텐츠 페이지들이 검색엔진에
      // 제출된 적이 없다 — 심사에서도 검색에서도 존재하지 않는 것과 같았다.
      // /api/*는 개인화 응답이라 색인 대상이 아니다.
      if (p === "/robots.txt" && req.method === "GET") {
        const origin = originOf(req);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end([
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "Disallow: /admin",
          "Disallow: /p?",           // 공유 링크는 앱으로 튕기는 중계 페이지
          `Sitemap: ${origin}/sitemap.xml`,
          `Sitemap: ${origin}/rss.xml`,
          ""
        ].join("\n"));
        return;
      }

      if (p === "/sitemap.xml" && req.method === "GET") {
        const origin = originOf(req);
        const cats = registry
          .filter((c) => c.enabled && c.category)
          .map((c) => c.category);
        const urls = [
          { loc: "/", freq: "hourly", pri: "1.0" },
          { loc: "/briefing", freq: "hourly", pri: "0.9" },
          { loc: "/ranking/daily", freq: "daily", pri: "0.8" },
          { loc: "/ranking/weekly", freq: "daily", pri: "0.7" },
          { loc: "/ranking/monthly", freq: "weekly", pri: "0.6" },
          { loc: "/trends", freq: "hourly", pri: "0.6" },
          { loc: "/about.html", freq: "monthly", pri: "0.4" },
          { loc: "/privacy.html", freq: "yearly", pri: "0.2" }
        ];
        for (const cat of [...new Set(cats)]) {
          urls.push({ loc: `/briefing/${encodeURIComponent(cat)}`, freq: "hourly", pri: "0.7" });
        }
        // ⑤ 날짜별 아카이브 — 매일 쌓이므로 sitemap이 함께 자란다
        const dates = store.listEditionDates ? store.listEditionDates().slice(-90) : [];
        for (const d of dates) urls.push({ loc: `/briefing/${d}`, freq: "never", pri: "0.5" });

        const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map((u) =>
            `  <url><loc>${escapeHtml(origin + u.loc)}</loc>` +
            `<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`
          ).join("\n") + `\n</urlset>\n`;
        res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
        res.end(body);
        return;
      }

      if (p === "/briefing" && req.method === "GET") {
        const b = await withEssay(await engine.briefing());
        const dateStr = kstLabel(b.generatedAt);
        const debateHtml = b.debate
          ? `<section><h2>오늘의 논쟁</h2><p>가장 많은 댓글이 달린 글은 <b>“${escapeHtml(b.debate.title)}”</b>(${escapeHtml(b.debate.sourceLabel)})입니다 — 댓글 ${fmtNum(b.debate.commentCount)}개가 이어지고 있습니다. <a href="/#post-${encodeURIComponent(b.debate.id)}">지금핫 댓글로 의견 남기기 →</a></p></section>`
          : "";
        const archiveDates = store.listEditionDates ? store.listEditionDates().slice(-14).reverse() : [];
        const archiveHtml = archiveDates.length > 1
          ? `<section><h2>지난 브리핑</h2><div class="nav">${archiveDates.map((d) => `<a href="/briefing/${d}">${d}</a>`).join("")}</div></section>`
          : "";
        // ⑤ 편성 — 하루 3회(모닝/런치/이브닝). 지금 시간대의 편이 정본이고,
        // 지난 편은 아카이브(/briefing/<날짜>)로 남는다.
        const slotLabel = b.slot ? b.slot.label : "";
        const slotNav = `<div class="nav">${["모닝", "런치", "이브닝"]
          .map((l) => `<span class="${l === slotLabel ? "on" : ""}">${l}</span>`).join("")}</div>`;
        // publishable=false = 수집이 얇아 이슈가 MIN_ISSUES 미만. 빈 글을 발행하지
        // 않는다 — 알맹이 없는 페이지는 자체 콘텐츠가 아니라 오히려 감점이다.
        const bodyHtml = b.publishable
          ? `${slotNav}${issuesHtml(b)}`
          : `<p class="muted">이 시간대는 아직 정리할 만큼 화제가 모이지 않았습니다. 다음 편에서 이어집니다.</p>`;
        const inner = `<h1>지금 브리핑 · ${escapeHtml(slotLabel)}</h1>
<p class="muted">${dateStr} · 커뮤니티·뉴스 ${b.sourceCount}곳에서 모은 ${b.itemCount}건을 지금핫이 실측 데이터로 정리했습니다. 원문 인용 없이 우리가 잰 수치로만 씁니다.</p>
${bodyHtml}
${b.essay || b.digestSummary ? `<section class="issue"><h2>종합 분석</h2>${b.essay ? `<p>${escapeHtml(maskProfanity(b.essay))}</p>` : ""}${b.digestSummary ? `<p>${escapeHtml(b.digestSummary)}</p>` : ""}</section>` : ""}
${rankingNav("")}
<h2 style="margin-top:28px">분야별 상위 글</h2>
${briefingSectionsHtml(b, coupangBannerHtml(null, null, 3, "brief_mid"))}
${debateHtml}
${archiveHtml}`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(editionShell(`지금 브리핑 · ${escapeHtml(slotLabel)} (${dateStr})`, `${dateStr} ${slotLabel} — 더쿠·클리앙·뽐뿌·보배드림 등 커뮤니티와 주요 뉴스에서 지금 화제인 이슈를 지금핫이 실측 반응 수치로 정리했습니다.`, inner, "/briefing", ownContentNav("/briefing"), coupangBannerHtml(null, null, 7, "page_bot")));
      }

      // 홈 최상단 브리핑 스트립용 원자료 (David 2026-07-31: "최상단에 테마별로
      // 시간별 브리핑") — 클라이언트는 섹션별 대표 이슈만 카드로 얹는다.
      if (p === "/api/briefing" && req.method === "GET") {
        return send(res, 200, await engine.briefing());
      }

      // X 실시간 트렌드 — 키워드+X 검색 링크만 (트윗 본문 없음, trends.js 헤더 참고)
      if (p === "/api/trends" && req.method === "GET") {
        const t = trendsCache ? await trendsCache.get() : null;
        return send(res, 200, t || { trends: [], fetchedAt: null });
      }

      if (p === "/trends" && req.method === "GET") {
        const t = trendsCache ? await trendsCache.get() : null;
        if (!t || !t.trends.length) return send(res, 404, { error: "no trends yet" });
        const row = (x) =>
          `<li><div><a href="${escapeHtml(x.searchUrl)}" target="_blank" rel="noopener">${escapeHtml(x.name)}</a>${x.count ? `<span class="m">게시물 ${escapeHtml(x.count)}</span>` : ""}</div></li>`;
        const inner = `<h1>지금 X(트위터) 실시간 트렌드</h1>
<p class="muted">${kstLabel(t.fetchedAt)} 기준 한국 실시간 트렌드 TOP ${t.trends.length} · 약 20분마다 갱신 · 키워드를 누르면 X 검색이 새 탭으로 열립니다.</p>
${rankingNav("")}
<ol class="rank">${t.trends.slice(0, 8).map(row).join("")}</ol>
${coupangBannerHtml(null, null, 6, "trends_mid")}
<ol class="rank" start="9">${t.trends.slice(8).map(row).join("")}</ol>
<p class="muted">트렌드 집계 출처: trends24.in · 지금핫은 트윗 본문을 수집·게재하지 않습니다.</p>`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(editionShell("실시간 트렌드", "지금 한국에서 가장 많이 언급되는 실시간 트렌드 키워드 TOP 20 — 지금핫", inner, "/trends", ownContentNav("/trends"), coupangBannerHtml(null, null, 7, "page_bot")));
      }

      // /briefing/<YYYY-MM-DD> = 일별 아카이브, /briefing/<카테고리> = 라이브
      // 카테고리 브리핑. 아카이브는 스냅샷이 쌓인 날짜만 존재한다(날조 없음).
      if (p.startsWith("/briefing/") && req.method === "GET") {
        const seg = decodeURIComponent(p.slice("/briefing/".length));
        if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) {
          const ed = store.getDailyEdition ? store.getDailyEdition(seg) : null;
          if (!ed || !ed.briefing) return send(res, 404, { error: "no edition for that date" });
          const inner = `<h1>${seg} 브리핑</h1>
<p class="muted">해당 일자의 마지막 수집 시점 기준 스냅샷입니다 · 화제글 ${ed.briefing.itemCount}건 / 소스 ${ed.briefing.sourceCount}곳</p>
${rankingNav("")}
${briefingSectionsHtml(ed.briefing, coupangBannerHtml(null, null, 4, "archive_mid"))}`;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(editionShell(`${seg} 브리핑`, `${seg} 하루 동안 커뮤니티와 뉴스에서 가장 화제였던 글 — 지금핫 브리핑 아카이브`, inner, `/briefing/${seg}`, ownContentNav(), coupangBannerHtml(null, null, 5, "archive_bot")));
        }
        // 카테고리 내부 기준(하한 없음) — 전국 랭킹 기준을 빌리면 무반응
        // 뉴스가 많은 카테고리(자동차 등)가 텅 비어 보인다 (2026-08-01 실측).
        const catTop = await engine.categoryTop(seg, 10);
        const catItems = catTop.items;
        if (!catItems.length) return send(res, 404, { error: "unknown category" });
        const all = { generatedAt: catTop.generatedAt };
        const label = catItems[0].categoryLabel;
        const lead = catItems[0];
        const leadBits = evidenceBits(lead);
        const inner = `<h1>${escapeHtml(label)} 브리핑</h1>
<p class="muted">${kstLabel(all.generatedAt)} · 지금 ${escapeHtml(label)} 분야에서 가장 화제인 글을 실측 반응 기준으로 정리했습니다. 15분마다 갱신됩니다.</p>
${rankingNav("")}
<p>지금 ${escapeHtml(label)} 분야에서 가장 뜨거운 글은 <b>“${escapeHtml(lead.title)}”</b>(${escapeHtml(lead.sourceLabel)})입니다${leadBits.length ? ` — ${leadBits.join(" · ")}` : ""}.</p>
${rankingRows(catItems, coupangBannerHtml(seg, null, 1, "briefcat_mid"))}`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(editionShell(`${label} 인기글 브리핑`, `${label} 분야에서 지금 가장 화제인 커뮤니티 글과 뉴스 — 지금핫이 실측 반응 수치로 정리했습니다.`, inner, `/briefing/${encodeURIComponent(seg)}`, ownContentNav(`/briefing/${encodeURIComponent(seg)}`), coupangBannerHtml(seg, null, 8, "briefcat_bot")));
      }

      // 화제 랭킹 TOP 20 — 일간(라이브) / 주간·월간(일별 스냅샷 병합).
      // 데이터가 기간만큼 쌓이기 전에는 있는 날짜만 합산하고 그 사실을 밝힌다.
      if ((p === "/ranking" || /^\/ranking\/(daily|weekly|monthly)$/.test(p)) && req.method === "GET") {
        const period = p.split("/")[2] || "daily";
        const label = period === "daily" ? "일간" : period === "weekly" ? "주간" : "월간";
        const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
        const dates = store.listEditionDates ? store.listEditionDates() : [];
        let list;
        let note = "";
        if (period === "daily") {
          list = mergeRankings([{ ranking: await engine.rankingTop(60) }], 20);
        } else {
          const use = dates.slice(-days);
          list = mergeRankings(use.map((d) => store.getDailyEdition(d)).filter(Boolean), 20);
          if (use.length < days) note = `아카이브 집계 시작일(${dates[0] || "오늘"}) 이후 ${use.length}일치 데이터로 집계 중입니다 — ${days}일이 쌓이면 완전한 ${label} 랭킹이 됩니다.`;
        }
        if (!list.length) return send(res, 404, { error: "no ranking data yet" });
        const inner = `<h1>${label} 화제 랭킹 TOP ${Math.min(20, list.length)}</h1>
<p class="muted">소스별 반응 분포로 정규화한 화제성 순위입니다 — 큰 게시판의 절대 추천수가 아니라 "그 동네에서 얼마나 이례적으로 터졌는가"와 교차 보도를 봅니다. 항목마다 근거 수치를 함께 표기합니다.</p>
${note ? `<p class="muted">${escapeHtml(note)}</p>` : ""}
${rankingNav(period)}
${rankingRows(list, coupangBannerHtml(null, null, 2, "rank_mid"))}`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(editionShell(`${label} 인기글 랭킹 TOP 20`, `${label} 커뮤니티·뉴스 인기글 TOP 20 — 추천·댓글 실측 반응으로 매긴 지금핫 화제 랭킹`, inner, `/ranking/${period}`, ownContentNav("/ranking/daily"), coupangBannerHtml(null, null, 7, "page_bot")));
      }

      // 애드센스 판매자 확인 파일 (https://nowhot.kr/ads.txt). ADSENSE_CLIENT
      // 미설정이면 404 — 빈 ads.txt를 내는 것보다 없는 게 낫다(구글 크롤러가
      // "인증된 판매자 0"으로 캐시하면 심사에 불리).
      if (p === "/ads.txt" && req.method === "GET") {
        const adsense = process.env.ADSENSE_CLIENT;
        if (!adsense) return send(res, 404, { error: "not configured" });
        const pub = adsense.replace(/^ca-/, ""); // ads.txt 표기는 "pub-…"
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
      }

      if (p === "/api/config" && req.method === "GET") {
        // `monetization.enabled`: whether this deploy can ever show an
        // affiliate/ad slot at all (real partner credential OR preview mode).
        // Drives the client's one-time top-of-app disclosure banner — it must
        // never show that banner on a deploy that will never actually serve
        // an ad (docs/monetization.md "①앱 전역 상단 1회 통합 고지").
        const monetization = { enabled: Boolean(process.env.COUPANG_PARTNER_ID) || Boolean(process.env.AD_PREVIEW) };
        // 소셜 로그인: provider별 클라이언트 id/secret 둘 다 있어야 활성 —
        // 키가 하나도 없으면 빈 배열이라 클라이언트는 로그인 버튼을 아예
        // 렌더하지 않는다(회귀 없는 완전 익명 동작).
        // kakaoJsKey: 카카오톡 **앱**으로 넘겨 원탭 로그인시키기 위한 JavaScript
        // 키. 리다이렉트(REST) 방식만으로는 앱 전환이 카카오 문서상 보장되지
        // 않고, JavaScript SDK만 "모바일 웹에서 카카오톡을 실행, 미설치 시
        // 카카오계정으로 폴백"을 명시한다(David 2026-07-28: "웹은 로그인 안 한
        // 사람 많은데 앱은 누구나 쓰니까"). 클라이언트에 노출되는 게 정상인
        // 공개 키다(시크릿 아님). 없으면 클라이언트는 기존 리다이렉트 방식
        // 그대로 — 즉 이 값은 순수 부가 기능이다.
        // 카카오 애드핏 배너 광고단위(공개값). 미설정이면 클라이언트는 배너를
        // 아예 렌더하지 않는다. 애드센스 심사 기간(수일~2주)의 수익 공백을
        // 메우는 국내 모바일 배너 — docs/monetization.md 채널 구성 참고.
        const adfit = { mobileUnit: process.env.ADFIT_UNIT_MOBILE || null };
        const auth = {
          providers: enabledProviders(authEnv),
          kakaoJsKey: process.env.KAKAO_JS_KEY || null
        };
        // 유령 소스 정리(적대적 검수 2026-07-31, 민준 페르소나): 레지스트리에서
        // 비활성(enabled:false — 디시 등 수집 금지/차단 소스)인 항목은 카탈로그
        // 에서도 뺀다. 목록에는 있는데 피드에 0건인 소스는 신뢰만 깎는다.
        const disabledIds = new Set(registry.filter((c) => c.enabled === false).map((c) => c.id));
        const liveCatalog = SOURCE_CATALOG.filter((s) => !disabledIds.has(s.id));

        // 피드용 제휴 카드 데이터.
        //
        // **이미지를 보내지 않는다.** 쿠팡 배너 크리에이티브는
        // ads-partners.coupang.com에서 오는데, 도메인 이름에 "ads-"가 들어가
        // 모바일 사파리의 크로스사이트 추적 차단과 광고 차단 목록에 걸린다
        // (2026-08-03 David 실기기: 배너 자리에 alt 텍스트만 떴다). 광고 수익을
        // 남의 도메인 이미지 한 장에 걸어두면 차단하는 사용자 비율만큼 통째로 0이 된다.
        //
        // 대신 **링크는 그대로 쓰고 크리에이티브만 우리가 그린다.** 수수료를 만드는
        // 것은 link.coupang.com 클릭이지 이미지가 아니다. 링크는 내비게이션이라
        // 차단 목록의 서브리소스 규칙에 걸리지 않는다. 덤으로 피드 카드와 같은
        // 디자인이 되어 다크모드에서 흰 배너가 튀는 문제도 사라진다.
        const coupang = (() => {
          // 카테고리당 하나가 아니라 **전 재고**를 내려보낸다. 예전엔 첫 배너만
          // 담아서 32장 중 24장이 앱에서 영원히 도달 불가였다(검수 실측).
          // 카피도 여기서 붙인다 — 클라이언트가 같은 표를 복사해 두면 한쪽만
          // 고쳐질 때 피드와 발행 페이지가 다른 말을 한다.
          const items = loadBanners()
            .filter((b) => b.size === "320x100")
            .map((b) => {
              const [hook, brand] = adCopy(b.dest);
              // dest도 함께 — 클라이언트가 "방금 이 도착지를 썼는지"로
              // 중복을 거른다. href는 사이즈마다 달라 같은 도착지를 못 잡는다.
              return { category: b.category, dest: b.dest, href: b.href, img: b.img, hook, brand };
            });
          return items.length ? { disclosure: COUPANG_DISCLOSURE, items } : null;
        })();

        return send(res, 200, { survey: SURVEY, categories: CATEGORIES, sources: liveCatalog, topics: TOPIC_CATALOG, monetization, adfit, coupang, auth });
      }

      if (p === "/api/communities" && req.method === "GET") {
        // liveCount: how many items this source currently has in the
        // collected pool — lets the client hide a source chip once it's
        // reliably yielding nothing (2026-07-24 adversarial review #5,
        // "죽은 소스 칩 자동 숨김") without hand-flipping `enabled` for every
        // source that goes quiet (some, like todayhumor's overseas-IP block,
        // are expected to recover later).
        const counts = await engine.sourceCounts();
        const communities = registry.map((c) => ({ ...c, liveCount: counts[c.id] || 0 }));
        return send(res, 200, { summary: summarize(registry), communities });
      }

      if (p === "/api/rules" && req.method === "GET") {
        return send(res, 200, { rules: DEFAULT_RULES });
      }

      if (p === "/api/post" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          const post = store.createPost(body.userId, body);
          engine.invalidate(); // make the new post visible in the feed
          return send(res, 200, post);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      if (p === "/api/submit" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          // fetch the page's own OG tags for title/excerpt where the network
          // allows; otherwise fall back to the submitter-provided title.
          const item = await normalizeSubmission(body, {
            fetchImpl: process.env.FEED_LIVE ? fetch : null
          });
          const rec = store.addSubmission(body.userId, item);
          engine.invalidate();
          return send(res, 200, rec);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      if (p === "/api/me" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const space = store.mySpace(userId);
        // resolve scrapped item ids into displayable items
        space.saved = await engine.resolveItems(userId, space.savedIds);
        // taste dashboard: top learned preferences, labelled for display
        const prefs = store.getUser(userId).preferences;
        const t = topPreferences(prefs);
        space.taste = {
          categories: t.categories.map((c) => ({ ...c, label: categoryLabel(c.id) })),
          tags: t.tags.map((x) => ({ ...x, label: "#" + x.id })),
          sources: t.sources.map((s) => ({ ...s, label: sourceLabel(s.id) })),
          disliked: t.disliked.map((d) => ({ ...d, label: categoryLabel(d.id) }))
        };
        return send(res, 200, space);
      }

      if (p === "/api/save" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const saved = store.toggleSave(body.userId, body.itemId, body.on);
        return send(res, 200, { ok: true, saved });
      }

      if (p === "/api/mute" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const muted = store.setMute(body.userId, body.source, body.on === true);
        return send(res, 200, { ok: true, mutedSources: muted });
      }

      // 콘텐츠 필터 토글: 정치/종교(기본 숨김, FILTERABLE_TOPICS) + 성인(adult).
      // adult는 별도 상태를 새로 만들지 않고 기존 verify-age/adult 게이트를 그대로
      // 호출한다 — /api/adult와 동작이 항상 일치하도록(중복 게이트 금지).
      // 뉴스 성향 슬라이더 저장 (David 2026-07-31 "슬라이드로")
      if (p === "/api/lean" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        // "abc" 같은 비수치가 조용히 0으로 접히면 클라이언트 버그가 은폐된다
        if (typeof body.balance !== "number" || !Number.isFinite(body.balance)) {
          return send(res, 400, { error: "balance must be a number in [-1, 1]" });
        }
        const balance = store.setLeanBalance(body.userId, body.balance);
        return send(res, 200, { ok: true, balance });
      }

      // 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 (David 2026-08-02).
      // /api/lean과 같은 계약 — 검증도 똑같이 엄격하게 한다.
      if (p === "/api/mix" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        if (typeof body.balance !== "number" || !Number.isFinite(body.balance)) {
          return send(res, 400, { error: "balance must be a number in [-1, 1]" });
        }
        const balance = store.setMixBalance(body.userId, body.balance);
        return send(res, 200, { ok: true, balance });
      }

      if (p === "/api/topics" && req.method === "POST") {
        const body = await readBody(req);
        const user = store.getUser(body.userId);
        if (!user) return send(res, 400, { error: "unknown user" });
        const topic = body.topic;
        const on = body.on === true;

        if (topic === "adult") {
          if (on && user.ageVerified !== true) {
            return send(res, 403, { error: "age verification required", ageVerified: false });
          }
          const showAdult = store.setShowAdult(body.userId, on);
          return send(res, 200, { ok: true, topic, on: showAdult, showAdult, showTopics: user.showTopics || [] });
        }
        if (!FILTERABLE_TOPICS.includes(topic)) {
          return send(res, 400, { error: "unknown topic", topics: FILTERABLE_TOPICS });
        }
        const showTopics = store.setTopicFilter(body.userId, topic, on);
        return send(res, 200, { ok: true, topic, on: showTopics.includes(topic), showTopics });
      }

      if (p === "/api/session" && req.method === "POST") {
        const body = await readBody(req);
        const user = store.createUser(body.userId);
        return send(res, 200, {
          userId: user.id,
          nickname: user.nickname,
          surveyed: user.surveyed,
          feedbackCount: user.feedbackCount,
          ageVerified: user.ageVerified === true,
          showAdult: user.showAdult === true,
          showTopics: user.showTopics || [],
          leanBalance: Number.isFinite(user.leanBalance) ? user.leanBalance : 0,
          mixBalance: Number.isFinite(user.mixBalance) ? user.mixBalance : 0
        });
      }

      // --- social login (OAuth 2.0: google/kakao/naver) ---
      const authRouteMatch = p.match(/^\/api\/auth\/([a-z]+)\/(login|callback|state)$/);
      if (authRouteMatch) {
        const [, provider, action] = authRouteMatch;
        const cfg = providerConfig(provider, authEnv);
        // No credentials configured for this provider (or an unknown provider
        // name) -> 404, same as any other missing route. The client never
        // even shows a button for a provider /api/config didn't list, but
        // this also guards a hand-typed URL.
        if (!cfg) return send(res, 404, { error: "provider not configured" });
        const redirectUri = `${originOf(req)}/api/auth/${provider}/callback`;

        if (action === "login" && req.method === "GET") {
          // `userId`: the caller's current (possibly anonymous) userId, if
          // any — carried through the CSRF state so the callback can inherit
          // that user's preferences/ratings/saved posts onto the linked
          // account instead of starting a fresh empty one (취향 승계).
          const anonymousUserId = url.searchParams.get("userId") || null;
          const state = authStates.issue(provider, anonymousUserId);
          const target = buildAuthorizeUrl(cfg, { state, redirectUri });
          res.writeHead(302, { location: target });
          return res.end();
        }

        // 카카오톡 앱 간편로그인용. 카카오 JavaScript SDK가 인가 요청을 직접
        // 띄우므로(그래야 앱으로 전환된다) 서버가 302로 만들어 주던 CSRF state를
        // 대신 여기서 발급해 넘긴다 — 콜백 검증 경로는 아래와 완전히 동일해
        // 앱 로그인이라고 해서 검증이 느슨해지지 않는다. 익명 userId도 똑같이
        // state에 실어 취향 승계를 유지한다.
        //
        // state 토큰이 JSON으로 노출되는 것은 /login이 Location 헤더로 노출하던
        // 것과 같은 수준이다(둘 다 1회용·10분 만료, authStates.consume).
        if (action === "state" && req.method === "GET") {
          const anonymousUserId = url.searchParams.get("userId") || null;
          return send(res, 200, {
            state: authStates.issue(provider, anonymousUserId),
            redirectUri
          });
        }

        if (action === "callback" && req.method === "GET") {
          const entry = authStates.consume(url.searchParams.get("state"));
          const code = url.searchParams.get("code");
          // Invalid/expired/replayed/forged state, or the provider didn't
          // hand back a code (e.g. the user cancelled consent) -> bounce home
          // with an error flag rather than a raw 400, since a human just got
          // redirected here from the provider's own consent screen.
          if (!entry || entry.provider !== provider || !code) {
            res.writeHead(302, { location: "/?auth=error" });
            return res.end();
          }
          try {
            const profile = await completeOAuth(provider, cfg, { code, redirectUri }, { fetchImpl: opts.authFetch });
            if (!profile.providerUserId) throw new Error(`${provider}: no user id in userinfo response`);

            // 취향 승계: 이미 이 소셜계정으로 연결된 유저가 있으면 그 유저로
            // 로그인(기존 데이터 유지) — 없으면 state에 실려온 익명
            // userId(있다면 그 유저에 계정을 연결해 취향을 그대로 승계)로,
            // 그마저 없으면(그 브라우저에 앵커할 익명 유저가 없던 경우) 새
            // 유저를 만들어 연결한다.
            let user = store.findUserBySocial(provider, profile.providerUserId);
            if (!user) {
              const anonUser = entry.anonymousUserId ? store.getUser(entry.anonymousUserId) : null;
              user = anonUser || store.createUser();
            }
            store.linkSocialAccount(user.id, provider, profile.providerUserId, profile);
            const token = store.createSession(user.id);
            const secure = (req.headers["x-forwarded-proto"] || "http") === "https";
            res.writeHead(302, {
              location: `/?auth=success&userId=${encodeURIComponent(user.id)}`,
              "set-cookie": serializeSessionCookie(token, { secure })
            });
            return res.end();
          } catch (err) {
            console.warn(`[auth] ${provider} callback failed:`, err && err.message ? err.message : err);
            res.writeHead(302, { location: "/?auth=error" });
            return res.end();
          }
        }
      }

      if (p === "/api/auth/session" && req.method === "GET") {
        const cookies = parseCookies(req.headers.cookie);
        const userId = store.sessionUser(cookies.feed_session);
        const user = userId ? store.getUser(userId) : null;
        if (!user) return send(res, 200, { loggedIn: false });
        return send(res, 200, {
          loggedIn: true,
          userId: user.id,
          nickname: user.nickname,
          social: user.socialProfile || null
        });
      }

      if (p === "/api/auth/logout" && req.method === "POST") {
        const cookies = parseCookies(req.headers.cookie);
        if (cookies.feed_session) store.destroySession(cookies.feed_session);
        const secure = (req.headers["x-forwarded-proto"] || "http") === "https";
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "set-cookie": clearSessionCookie({ secure }) });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (p === "/api/verify-age" && req.method === "POST") {
        // Mock 성인인증. A real deployment integrates PASS/휴대폰 본인확인 here and
        // only calls verifyAge on a confirmed adult result.
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        if (body.confirmAdult !== true) return send(res, 400, { error: "adult confirmation required" });
        store.verifyAge(body.userId);
        return send(res, 200, { ok: true, ageVerified: true });
      }

      if (p === "/api/adult" && req.method === "POST") {
        const body = await readBody(req);
        const user = store.getUser(body.userId);
        if (!user) return send(res, 400, { error: "unknown user" });
        if (body.on === true && user.ageVerified !== true) {
          return send(res, 403, { error: "age verification required", ageVerified: false });
        }
        const on = store.setShowAdult(body.userId, body.on === true);
        return send(res, 200, { ok: true, showAdult: on });
      }

      if (p === "/api/survey" && req.method === "POST") {
        const body = await readBody(req);
        const { ok, errors } = validateAnswers(body.answers);
        if (!ok) return send(res, 400, { error: "invalid survey", details: errors });
        store.createUser(body.userId);
        store.saveSurvey(body.userId, body.answers);
        return send(res, 200, { ok: true });
      }

      if (p === "/api/history" && req.method === "POST") {
        const body = await readBody(req);
        store.createUser(body.userId);
        if (!Array.isArray(body.entries)) return send(res, 400, { error: "entries must be an array" });
        const result = store.applyHistory(body.userId, body.entries.slice(0, 500));
        return send(res, 200, { ok: true, hits: result.hits, entriesSeen: result.entriesSeen });
      }

      if (p === "/api/feed" && req.method === "GET") {
        // 트래픽 실측: 피드 요청 1회 = 실사용 1회 (userId로 고유 방문자 집계)
        try { store.recordTraffic("feed", url.searchParams.get("userId")); } catch {}
        const userId = url.searchParams.get("userId");
        if (!userId || !store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        // 음수·비수치 cursor/limit은 400이 아니라 안전값으로 접는다 — 무한
        // 스크롤 클라이언트가 저장해 둔 값이 깨져도 피드는 계속 나와야 한다.
        const rawCursor = Number(url.searchParams.get("cursor") || 0);
        const cursor = Number.isFinite(rawCursor) && rawCursor > 0 ? Math.floor(rawCursor) : 0;
        const rawLimit = Number(url.searchParams.get("limit") || 10);
        const limit = Math.min(30, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 10));
        // 소스별 보기 ("전체" 칩이 아닌 특정 소스 칩 선택 시): 존재하는 소스인지
        // 레지스트리로 확인 — 없으면 400 (오타/삭제된 소스로 조용히 빈 피드가
        // 나오는 것을 방지).
        // "submit" is a pseudo-source (every via:"submit" item, whatever its
        // own out-link domain is) — not a registry entry, so it's exempt from
        // the registry-membership check below.
        const source = url.searchParams.get("source") || null;
        if (source && source !== "submit" && !registry.some((c) => c.id === source)) {
          return send(res, 400, { error: "unknown source" });
        }
        // 정렬: hot(기본) | latest — 그 외 값은 hot으로 접는다 (열린 enum 방지)
        const sort = url.searchParams.get("sort") === "latest" ? "latest" : "hot";
        const feed = await engine.getFeed(userId, { cursor, limit, source, sort });
        return send(res, 200, feed);
      }

      if (p === "/api/digest" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const limit = Math.min(10, Number(url.searchParams.get("limit") || 5));
        return send(res, 200, await engine.digest(userId, { limit }));
      }

      if (p === "/api/push/subscribe" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const enabled = store.savePushSubscription(body.userId, body.subscription || null);
        return send(res, 200, { ok: true, notifyEnabled: enabled });
      }

      // The client's pushManager.subscribe() needs this as applicationServerKey
      // (base64url → Uint8Array). null means the server has no VAPID keypair —
      // the client degrades to local-only notifications.
      if (p === "/api/push/vapid-key" && req.method === "GET") {
        return send(res, 200, { key: vapid ? vapid.publicKey : null });
      }

      if (p === "/api/item" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        const itemId = url.searchParams.get("itemId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const item = await engine.getItem(userId, itemId);
        if (!item) return send(res, 404, { error: "not found" });
        return send(res, 200, item);
      }

      if (p === "/api/signal" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const result = await engine.signal(body.userId, body.itemId, {
          type: body.type,
          dwellMs: Number(body.dwellMs || 0)
        });
        return send(res, 200, result);
      }

      // Ad/affiliate slot event logging (docs/monetization.md section D).
      // Slot items are generated fresh per request (monetize.js) and never
      // live in the engine's collected pool, so this goes straight to the
      // store rather than through engine.signal (which does an item lookup
      // that would always miss for a slot id).
      if (p === "/api/ad-signal" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const type = body.type === "click" || body.type === "impression" ? body.type : null;
        if (!type) return send(res, 400, { error: "type must be impression or click" });
        const stats = store.recordAdEvent(body.userId, body.itemId, type, { variant: body.variant });
        return send(res, 200, { ok: true, stats });
      }

      if (p === "/api/rate" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        // signal 화이트리스트 — signal:99 같은 임의 값이 그대로 수용되면
        // 취향 벡터가 한 번에 오염된다(적대적 검수 P1-c, API 페르소나 실측).
        if (![1, 0, -1].includes(body.signal)) return send(res, 400, { error: "signal must be 1, 0, or -1" });
        const result = await engine.rate(body.userId, body.itemId, body.signal);
        return send(res, 200, result);
      }

      if (p === "/api/comment" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          const comment = store.addComment(body.userId, body.itemId, body.body);
          return send(res, 200, comment);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      // --- admin API (token-guarded) ---
      if (p.startsWith("/api/admin/")) {
        if (!isAdmin(req, url)) return send(res, 401, { error: "admin auth required" });

        if (p === "/api/admin/traffic" && req.method === "GET") {
          return send(res, 200, { days: store.trafficStats(Number(url.searchParams.get("days") || 14)) });
        }
        if (p === "/api/admin/stats" && req.method === "GET") {
          return send(res, 200, { stats: store.adminStats(), communities: summarize(registry), ads: store.adminAdStats() });
        }
        if (p === "/api/admin/users" && req.method === "GET") {
          return send(res, 200, { users: store.adminUsers() });
        }
        if (p === "/api/admin/posts" && req.method === "GET") {
          return send(res, 200, { posts: store.allPosts().slice().reverse() });
        }
        if (p === "/api/admin/comments" && req.method === "GET") {
          const all = [];
          for (const u of store.users.values()) for (const c of u.comments || []) all.push(c);
          all.sort((a, b) => (a.at < b.at ? 1 : -1));
          return send(res, 200, { comments: all });
        }
        if (p === "/api/admin/communities" && req.method === "GET") {
          const disabled = store.disabledSources();
          return send(res, 200, {
            communities: registry.map((c) => ({ ...c, disabled: disabled.has(c.id) }))
          });
        }
        // 소스 헬스 (관리자 대시보드용, 읽기 전용): /api/communities의
        // liveCount(수집 풀 내 현재 아이템 수 — 실측)와 /api/admin/communities의
        // disabled 상태를 한 번에 준다. 수치는 전부 실측 — 0건이면 0으로 보인다.
        if (p === "/api/admin/source-health" && req.method === "GET") {
          const counts = await engine.sourceCounts();
          const disabled = store.disabledSources();
          const sources = registry.map((c) => ({
            id: c.id,
            label: c.label,
            category: c.category,
            kind: c.kind,
            enabled: c.enabled === true,
            disabled: disabled.has(c.id),
            seed: Boolean(c.adapter && c.adapter.type === "seed"),
            liveCount: counts[c.id] || 0
          }));
          return send(res, 200, { sources });
        }
        if (p === "/api/admin/delete-post" && req.method === "POST") {
          const body = await readBody(req);
          const ok = store.deletePost(body.id);
          engine.invalidate();
          return send(res, 200, { ok });
        }
        if (p === "/api/admin/delete-comment" && req.method === "POST") {
          const body = await readBody(req);
          return send(res, 200, { ok: store.deleteComment(body.id) });
        }
        // Source health check: actually fetch every enabled live adapter once
        // and report per-source status. This is how candidate feed URLs get
        // VERIFIED at runtime instead of being trusted blindly (no hardcoded
        // assumptions — where the network is closed, this shows exactly that).
        if (p === "/api/admin/check-sources" && req.method === "POST") {
          const targets = registry.filter((c) => c.enabled && c.adapter && c.adapter.type !== "seed");
          const results = [];
          for (const entry of targets) {
            const t0 = Date.now();
            try {
              const rows = await makeFetcher(entry)();
              results.push({ id: entry.id, label: entry.label, ok: true, items: rows.length, ms: Date.now() - t0 });
            } catch (err) {
              results.push({ id: entry.id, label: entry.label, ok: false, error: String(err && err.message ? err.message : err).slice(0, 140), ms: Date.now() - t0 });
            }
          }
          return send(res, 200, { checkedAt: new Date().toISOString(), results });
        }

        if (p === "/api/admin/community" && req.method === "POST") {
          const body = await readBody(req);
          const list = store.setSourceDisabled(body.id, body.disabled === true);
          return send(res, 200, { ok: true, disabledSources: list });
        }
        if (p === "/api/admin/banned-word" && req.method === "POST") {
          const body = await readBody(req);
          const words = body.action === "remove" ? store.removeBannedWord(body.word) : store.addBannedWord(body.word);
          return send(res, 200, { ok: true, bannedWords: words });
        }
        // Manual trigger for the digest push job (normally run on PUSH_DIGEST_MS).
        // Sends right away and reports how many subscribers got a push.
        if (p === "/api/admin/push-digest" && req.method === "POST") {
          const result = await sendDigestPushes(store, engine, vapid, { sendImpl: opts.pushSendImpl });
          return send(res, 200, result);
        }
        return send(res, 404, { error: "not found" });
      }

      // --- admin page ---
      if (p === "/admin" && req.method === "GET") return serveStatic(res, "/admin.html");

      // --- shareable link with OG tags (crawlers read this; humans bounce to app) ---
      if (p === "/p" && req.method === "GET") {
        const id = url.searchParams.get("id");
        const data = id ? await engine.shareData(id) : null;
        const origin = originOf(req);
        res.writeHead(data ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        res.end(sharePage(data, origin, id));
        return;
      }

      // --- static client ---
      if ((p === "/" || p === "/index.html") && req.method === "GET") {
        try { store.recordTraffic("page"); } catch {}
      }
      if (req.method === "GET") {
        // 홈은 크롤러가 읽을 정적 콘텐츠를 함께 심는다 (2026-08-03).
        //
        // 실측: 홈 175KB 중 정적 텍스트가 1,499B(0%)였다. 읽히는 것은
        // "준비 중 / 메뉴 / 화면 테마"뿐이고 글 목록은 전부 JS로 그려진다.
        // 네이버는 자바스크립트를 거의 실행하지 않고 구글도 JS 렌더링은 뒤로
        // 밀린다 — 홈이 검색엔진에게 빈 페이지였다.
        //
        // **클로킹이 아니다.** 사용자도 첫 페인트에 이 목록을 그대로 보고
        // (스켈레톤보다 유용하다), JS가 뜨면 개인화 피드가 같은 자리를 대체한다.
        // 사람이 보는 것을 크롤러도 읽게 만드는 것이지 다른 것을 보여주는 게 아니다.
        let seed = "";
        if (p === "/" || p === "/index.html") {
          try {
            // rankingTop은 { generatedAt, items } 를 돌려준다 — 배열이 아니다.
            const top = (await engine.rankingTop(12) || {}).items || [];
            if (top.length) {
              seed = `<ul class="seed-list">` + top.map((i) =>
                `<li><a href="/#post-${encodeURIComponent(i.id)}">${escapeHtml(maskProfanity(i.title))}</a>` +
                ` <span class="seed-src">${escapeHtml(i.sourceLabel || "")}</span></li>`
              ).join("") + `</ul>`;
            }
          } catch {
            // 수집 전이거나 실패하면 기존 스켈레톤이 남는다 — 홈은 계속 뜬다.
            // rankingTop은 source가 "seed"인 항목을 제외하므로 FEED_DEV 개발
            // 모드에서는 비어 있는 것이 정상이다(실수집 배포에서만 채워진다).
          }
        }
        return serveStatic(res, p, seed);
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: String(err && err.message ? err.message : err) });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  // 떠 있는 것이 이 서비스의 일이다 — 수집기 하나의 실수로 프로세스가 죽으면
  // 안 된다. Node 22는 unhandledRejection 기본값이 throw라, 수집 경로 어딘가의
  // 떠도는 프로미스 하나(예: 응답 헤더는 왔는데 본문 읽는 중 타임아웃)가
  // 서버 전체를 내린다. 로컬 FEED_LIVE 기동에서 실제로 재현됐다:
  //   DOMException [TimeoutError]: The operation was aborted due to timeout
  // 컨테이너는 재시작하지만 그 사이 요청은 전부 실패한다 — 실사용자 제보였던
  // "가끔 불러오기 실패"와 증상이 일치한다.
  //
  // 삼키지 않고 크게 남긴다. 조용한 무시는 원인을 영원히 못 찾게 만든다.
  process.on("unhandledRejection", (err) => {
    console.error("[feed] unhandled rejection (서버는 계속 실행):",
      err && err.stack ? err.stack : err);
  });
  process.on("uncaughtException", (err) => {
    console.error("[feed] uncaught exception (서버는 계속 실행):",
      err && err.stack ? err.stack : err);
  });

  const port = Number(process.env.PORT || 4000);
  const server = createServer();
  server.listen(port, () => {
    console.log(`personalized feed running at http://localhost:${port}`);
    if (process.env.FEED_DB) console.log(`persisting to ${process.env.FEED_DB}`);
  });
}
