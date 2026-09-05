// Zero-dependency HTTP server for the personalized feed.
//
// Serves the REST API and the static single-page client. Built on node:http so
// the project keeps its no-dependency footprint. Run with:
//   node src/feed/server.js            # in-memory, ephemeral
//   FEED_DB=./feed-data.json node src/feed/server.js   # persisted

import http from "node:http";
import { randomUUID } from "node:crypto";
import { pickBanner, loadBanners } from "./manual-products.js";
import { buildReport } from "./datastory.js";
import { barsSvg, lineSvg, CHART_CSS } from "./chart.js";
import { adCopy, AD_DISCLOSURE, withSubId } from "./ad-copy.js";
import {
  EDITORIAL_LLM_CANARY_CONTRACT,
  EDITORIAL_LLM_CONTRACT,
  makeEvidenceEditorialPipeline
} from "./editorial-llm.js";
import {
  articleContentId,
  isCurrentArticleSummary,
  makeArticleSummaryPipeline
} from "./article-summary.js";
import { verifyEditorialLineage } from "./editorial-lineage.js";
import { attachEditorialFulfillment } from "./editorial-fulfillment.js";
import { SLOTS, slotById } from "./digest.js";
import { series } from "./analytics.js";
import { mergeCostBuckets, profitAndLoss, daysInMonth } from "./costs.js";
import { communityRanking, sourceBest, keywordIndex, keywordPage } from "./pages.js";
import { loadMatrix, pickVariant } from "./ad-matrix.js";
import { makeIndexNow } from "./indexnow.js";
import { maskProfanity } from "./profanity.js";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FeedStore } from "./store.js";
import { FeedEngine, DEFAULT_EDITORIAL_PREVIEW, resolveEditorialSelection } from "./engine.js";
import { SeedSource, StorePostsSource } from "./content.js";
import { SURVEY, validateAnswers } from "./survey.js";
import { CATEGORIES, SOURCE_CATALOG } from "./taxonomy.js";
import { loadRegistry, buildSources, summarize } from "./registry.js";
import { makeFetcher } from "./fetchers.js";
import { memoizedTranslator } from "./translate.js";
import { anthropicTranslator, fallbackTranslator, googleFreeTranslator } from "./translator.js";
import { TOPIC_CATALOG, FILTERABLE_TOPICS, FILTER_KEYS } from "./topics.js";
import { latestRelease, releaseHistoryHtml } from "./release-notes.js";
import { DEFAULT_RULES } from "./rules.js";
import { normalizeSubmission } from "./ingest.js";
import { topPreferences } from "./recommender.js";
import { categoryLabel, sourceLabel, tagLabel, isKnownCategory } from "./taxonomy.js";
import { sendDigestPushes } from "./push.js";
import { makeCoupangProductFeed, refreshCoupangCache, coupangCreds } from "./coupang.js";
import { makeEnricher } from "./enrich.js";
import { makeInterestsCache } from "./interest.js";
import { readWiredStatus, CANDIDATE_NETWORKS, REFERENCE_ADSTXT, splitMeasured, ctr, MEASURE_CAVEATS } from "./ad-networks.js";
import { makeTrendsCache } from "./trends.js";
import { destForText } from "./deals.js";
import { classify as classifyAudience } from "./audience.js";
import { projectProductBlueprint } from "./product-blueprint.js";
import {
  buildBlindReviewPacket,
  hasHumanReviewWork,
  HUMAN_REVIEW_QUEUE_CONTRACT,
  HUMAN_REVIEW_FIELDS,
  summarizeHumanReview
} from "./editorial-quality.js";
import {
  applyEditionChanges,
  editionSegmentKey
} from "./edition-change.js";
import {
  EDITORIAL_INVENTORY_CONTRACT,
  assertEditorialSnapshotCompatibility,
  buildEditorialInventory,
  dueEditorialSlots,
  editorialInventorySegmentKey,
  kstDate as editorialKstDate,
  nextEditorialSlot,
  resolveEditorialTarget,
  slotAsOfMs
} from "./editorial-inventory.js";
import {
  ELAPSED_EDITION_EVIDENCE_CONTRACT,
  buildEditorialSlotObservation,
  summarizeElapsedEditionEvidence
} from "./editorial-elapsed-evidence.js";
import {
  buildEditorialQualityHistory,
  buildEditorialReliabilityHistory
} from "./editorial-reliability.js";
import { projectEditorialPersonalization } from "./editorial-personalization.js";
import { projectEditorialReaderCopy } from "./editorial-reader-copy.js";
import { buildEditorialReviewDesk } from "./editorial-review-desk.js";
import {
  createCategoryRouter,
  createReloadingCategoryRouter
} from "./category-routing.js";
import {
  EDITORIAL_SERVING_CONTRACT,
  assessEditorialServeability,
  omitHeldEditorialIssues,
  sameEditorialCategorySet
} from "./editorial-serving.js";
import { makeSlotCanonicalEditionReader } from "./slot-canonical-edition.js";

// 상품군 사전을 걸지 않는 분류. engine.js의 AD_MATCH_OFF와 같은 원칙이다 —
// 사건·시사 글 옆에 "문맥이 맞아 보이는" 광고가 붙으면 무관한 광고보다 나쁘다.
const AD_MATCH_OFF_CATS = new Set(["news", "politics"]);
import {
  enabledProviders,
  providerConfig,
  buildAuthorizeUrl,
  completeOAuth,
  AuthStateStore,
  parseCookies,
  DEVICE_COOKIE,
  VISITOR_COOKIE,
  serializeVisitorCookie,
  SESSION_COOKIE,
  KEY_COOKIE,
  serializeKeyCookie,
  serializeSessionCookie,
  clearSessionCookie,
  serializeDeviceCookie,
  resolveIdentity
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

function sendHtml(res, html, status = 200) {
  const body = Buffer.from(String(html));
  const etag = '"' + createHash("sha1").update(body).digest("base64").slice(0, 22) + '"';
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    etag
  };
  if (status === 200 && res.req && res.req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(status, headers);
  return res.end(body);
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

// Secure 속성은 실제로 https로 들어온 요청에만 붙인다 — 브라우저는 http에서
// 설정된 Secure 쿠키를 조용히 버려서 로컬 개발이 통째로 깨진다(auth.js 주석).
function isSecureRequest(req) {
  return (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

// 조사 자동 선택. "'xbox'이(가) 언급된"처럼 두 형태를 괄호로 함께 쓰면
// 기계가 만든 문장이라는 게 그대로 드러난다(2026-08-04 검색 품질 검수 지적).
//
// 한글은 마지막 글자의 받침 유무로 갈린다. 한글이 아닌 경우(영문·숫자)는
// 한국인이 그 말을 읽을 때의 소리를 따른다 — "xbox"는 "엑스박스"라 받침이
// 있고, "ai"는 "에이아이"라 없다. 영문 끝 글자로 근사하되, 틀릴 수 있는
// 경우(l, m, n, ng 등 받침으로 읽히는 자음)를 목록으로 둔다.
export const hasFinalConsonant = (word) => {
  const w = String(word || "").trim();
  if (!w) return false;
  const last = w[w.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // 숫자: 읽는 소리 기준 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 → 받침 있음)
  if (/[0-9]/.test(last)) return "0136780".includes(last);
  // 영문: 받침으로 읽히는 자음으로 끝나면 있음 (l, m, n, ng, k, p, t 계열)
  if (/[a-zA-Z]/.test(last)) return /[lmnkptbcdfgszx]$/i.test(last);
  return false;
};
export const particle = (word, withFinal, withoutFinal) =>
  hasFinalConsonant(word) ? withFinal : withoutFinal;


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
  const appUrl = `/live#post-${encodeURIComponent(id)}`;
  // 글에 사진이 있으면 그 사진이 공유 카드 그림이 된다. 없을 때만 앱 아이콘.
  // 폴백은 SVG가 아니라 PNG를 쓴다 — 다수 SNS 크롤러가 SVG를 미리보기 이미지로
  // 처리하지 않는다(설령 처리하더라도, 글마다 사진이 있는데 전부 같은 로고를
  // 주는 것 자체가 결함이므로 이 수정의 근거는 SVG 지원 여부와 무관하다).
  const shareImage = data.image && /^https?:\/\//i.test(data.image)
    ? data.image
    : `${origin}/og.png?v=20260904-brand`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="지금핫 NowHot">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(shareImage)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1">
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

// 캐시 정책 — 2026-08-04까지 **헤더가 아예 없었다.**
//
// Cache-Control도 ETag도 Last-Modified도 안 나가면 브라우저가 자체 판단으로
// 캐시한다(휴리스틱 캐싱). 그중 치명적인 게 /sw.js다: 서비스워커 파일이
// HTTP 캐시에서 나오면 브라우저가 **새 워커의 존재 자체를 모르고**, 옛 워커가
// 계속 옛 index.html을 Cache API에서 서빙한다. 아이폰 사파리가 특히 오래 붙든다.
//
// 실증(2026-08-04): 메뉴 버튼 회귀를 고쳐 배포하고 서버에서 정상 동작을 확인한
// 뒤에도 David 폰에서는 여전히 안 눌렸다. 서버는 멀쩡했고 폰이 옛 번들을 쓰고
// 있었다. 이 클래스는 "배포했는데 사용자에겐 안 닿는" 침묵 실패라, 배포 검증을
// 아무리 해도 잡히지 않는다.
//
// 정책:
//   HTML·sw.js·manifest → no-cache (= 매번 서버에 물어보되 안 바뀌었으면 304)
//   아이콘·이미지        → 1주일 (파일명이 안 바뀌지만 아이콘은 거의 안 바뀐다)
// no-store가 아니라 no-cache인 이유: 재검증만 강제하고, 안 바뀌었으면 304로
// 본문을 안 보낸다 — 오프라인 폴백(서비스워커)도 그대로 산다.
const REVALIDATE = new Set([".html", ".js", ".webmanifest", ".json", ".xml", ".txt"]);
// 이 배포가 어느 빌드인지 한 줄로 식별한다.
//
// ── 왜 (David 2026-08-06 "얼마나 기다려야 되는데 새로고침 해도 이지랄인데")
// 광고 카드가 고쳐졌는지 아닌지를 두고 서로 다른 것을 보고 있었다. 내 브라우저는
// 매번 서비스워커를 지우고 봐서 항상 최신이었고, David 폰은 어느 빌드를 돌고
// 있는지 **알 방법이 없었다.** 코드가 맞는지 아무리 확인해도 그 폰에 닿았는지는
// 별개 문제다.
//
// 그래서 화면이 자기 빌드를 스스로 말하게 한다. index.html의 내용에서 뽑으므로
// 파일이 바뀌면 반드시 바뀌고, 배포와 어긋날 수 없다.
let _buildId = null;
function buildId() {
  if (_buildId) return _buildId;
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"));
    _buildId = createHash("sha1").update(buf).digest("base64url").slice(0, 8);
  } catch { _buildId = "unknown"; }
  return _buildId;
}

// 제때 안 오면 포기한다. 홈처럼 "있으면 좋은" 데이터를 기다리다 페이지 자체가
// 안 뜨는 것을 막는다 — 거부하지 않고 null을 돌려주므로 호출부는 seed 없이 간다.

function cacheHeadersFor(ext) {
  return REVALIDATE.has(ext)
    ? "no-cache"
    : "public, max-age=604800";
}

function serveStatic(res, urlPath, seedHtml = "", pageExtras = null) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  // prevent path traversal outside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    if (rel === "about.html") {
      buf = Buffer.from(buf.toString("utf8").replace("<!-- NOWHOT_RELEASE_HISTORY -->", releaseHistoryHtml()));
    }
    // 애드센스 사이트 소유 확인 + 광고 로더 (ADSENSE_CLIENT = "ca-pub-…").
    // 심사 단계에서는 이 스크립트 존재 자체가 사이트 확인 수단이다. env가
    // 없으면 아무것도 주입하지 않는다 — 광고 없는 배포는 완전히 무광고.
    const adsense = process.env.ADSENSE_CLIENT;
    const ga = process.env.GA_MEASUREMENT_ID; // GA4 측정 ID ("G-…") — 설정 시 gtag 주입

    // 홈 정적 콘텐츠 — 호출부(라우트)가 engine으로 만들어 넘긴다.
    // serveStatic은 engine을 모르는 순수 파일 서빙 함수라 여기서 만들 수 없다.
    if (ext === ".html" && rel === "index.html") {
      // 화면이 자기 빌드를 알 수 있게 심는다. /api/config가 주는 값과 다르면
      // 낡은 화면이라는 뜻이고, 클라이언트가 스스로 한 번 새로고침한다.
      // 자리표시자의 **값만** 갈아 끼운다.
      //
      // 처음엔 <head> 뒤에 태그를 새로 끼우려 했는데 라이브에서만 조용히
      // 실패했다. 원인을 좇는 대신 실패할 수 없는 모양으로 바꿨다 —
      // 태그는 index.html에 이미 있고(content="dev"), 서버는 값만 바꾼다.
      // 치환 대상이 없으면 그건 그 자체로 눈에 띈다(화면이 "dev"를 보고
      // 서버 값과 다르다며 한 번 새로고침한 뒤 멈춘다).
      buf = Buffer.from(buf.toString("utf8").replace(
        '<meta name="nh-build" content="dev">',
        `<meta name="nh-build" content="${escapeHtml(buildId())}">`));
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

    if ((adsense || ga) && ext === ".html" && ["index.html", "today.html"].includes(rel)) {
      let tags = "";
      if (adsense) tags += `<meta name="google-adsense-account" content="${escapeHtml(adsense)}">\n`;
      if (ga) tags += `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${ga}');</script>\n`;
      buf = Buffer.from(buf.toString("utf8").replace("</head>", tags + "</head>"));
    }
    if (pageExtras && ext === ".html") {
      let html = buf.toString("utf8");
      if (pageExtras.headHtml) html = html.replace("</head>", `${pageExtras.headHtml}</head>`);
      if (pageExtras.bodyHtml) html = html.replace("<!-- NOWHOT_DISPLAY_AD -->", pageExtras.bodyHtml);
      buf = Buffer.from(html);
    }
    // ETag는 **주입 후 최종 바이트** 기준이어야 한다. 파일 mtime으로 만들면
    // 시드 주입·애드센스 태그가 바뀌어도 같은 ETag가 나가 304로 옛 화면이 남는다.
    const etag = '"' + createHash("sha1").update(buf).digest("base64").slice(0, 22) + '"';
    const headers = {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": cacheHeadersFor(ext),
      etag
    };
    if (res.req && res.req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

// IndexNow 키 — 없으면 기능 전체가 비활성(키 파일도, 통보도 없다).
// 모듈 로드 시점이 아니라 **쓰는 시점**에 읽는다. 상수로 굳히면 프로세스를
// 재시작하지 않고는 켤 수 없고, 테스트에서도 설정을 바꿀 수 없다.
const indexNowKey = () => process.env.INDEXNOW_KEY || null;

export function createServer(opts = {}) {
  const store = new FeedStore({
    file: opts.file || process.env.FEED_DB || null,
    clock: opts.clock || null
  });
  const serverNowMs = () => {
    const raw = opts.clock ? opts.clock() : Date.now();
    const value = typeof raw === "number" ? raw : Date.parse(raw);
    return Number.isFinite(value) ? value : Date.now();
  };

  // Social login (src/feed/auth.js). authStates is the short-lived CSRF-state
  // ledger for the login->callback round trip; opts.authFetch lets tests mock
  // every provider's token/userinfo endpoints with no network access (server
  // itself always defaults to the real global fetch).
  // 홈에 심는 자체 콘텐츠(SSR seed)를 만든다. **요청 밖에서** 돈다.
  // 여기서 도는 rankingTop()은 수만 건 풀을 훑는 동기 계산이라,
  // 요청 안에서 부르면 그 시간만큼 서버가 통째로 멈춘다(실측 4.0초).
  const HOME_SEED_TTL_MS = 3 * 60 * 1000;
  const HOME_SEED_RETRY_MS = 20 * 1000;   // 빈 결과였을 때의 재시도 간격
  const homeSeed = { html: null, at: 0, building: false };
  async function buildHomeSeed() {
    let seed = "";
        try {
          // rankingTop은 { generatedAt, items } 를 돌려준다 — 배열이 아니다.
          const top = ((await engine.rankingTop(20)) || {}).items || [];
          // 우리가 직접 만드는 페이지로 가는 길 — 사람에게도 크롤러에게도
          // 서비스의 구성이 보여야 한다. 예전엔 이 링크들이 드로어 안에만
          // 있어서 /communities·/keywords는 홈에서 갈 방법이 아예 없었다
          // (2026-08-04 실측: 링크 0개).
          const navHtml =
            `<nav class="seed-nav" aria-label="지금핫이 만드는 페이지">` +
            [["/", "오늘판"], ["/ranking/daily", "화제 랭킹"],
             ["/communities", "커뮤니티 순위"], ["/keywords", "화제 키워드"],
               ["/report", "데이터 리포트"],
             ["/trends", "실시간 트렌드"]]
              .map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join("") +
            `</nav>`;
          if (top.length) {
            // 제목만 심던 것을 **출처·실측 반응·발췌**까지로 넓힌다.
            // 제목 12줄로는 "남의 제목 모음"과 구분되지 않고, 실제로 크롤러가
            // 읽는 본문이 936자에 그쳤다. 반응 수치는 우리가 잰 값이고
            // 발췌는 원문 200자 이내 인용이라 여기가 이 페이지의 알맹이다.
            seed = navHtml + `<ol class="seed-list">` + top.map((i) => {
              const react = [];
              if (Number(i.score) > 0) react.push(`추천 ${Number(i.score).toLocaleString("ko-KR")}`);
              if (Number(i.commentCount) > 0) react.push(`댓글 ${Number(i.commentCount).toLocaleString("ko-KR")}`);
              const meta = [escapeHtml(i.sourceLabel || ""), react.join(" · ")].filter(Boolean).join(" · ");
              const summary = typeof i.summary === "string" && i.summary.trim()
                ? `<p class="seed-sum">${escapeHtml(maskProfanity(i.summary.slice(0, 200)))}</p>` : "";
              // **원문으로 나가는 진짜 링크를 남긴다** (2026-08-07 애드센스 점검).
              //
              // 실측: 홈 초기 HTML의 외부 <a href>가 **0개**였다. 제목 링크가
              // 내부 앵커(/live#post-…)뿐이라, 크롤러 눈에는 남의 제목·발췌만 모아 둔
              // 페이지로 보인다. 우리 방어 논리 전체가 "발췌만 싣고 트래픽은
              // 원문으로 보낸다"인데 **그 사실이 HTML에 없었다.**
              //
              // rel: nofollow는 붙이지 않는다 — 우리가 실제로 추천하는 출처이고,
              // 광고가 아니다. noopener만 붙인다(보안).
              const src = typeof i.url === "string" && /^https?:\/\//i.test(i.url)
                ? ` <a class="seed-out" href="${escapeHtml(i.url)}" rel="noopener" target="_blank">${escapeHtml(i.sourceLabel || "원문")}에서 보기</a>`
                : "";
              // 우리가 쓴 실측 한 줄(편집 코멘트). 인용(제목·발췌)이 아니라
              // 자체 서술이다 — 이 페이지의 자체 콘텐츠 비중이 8.5%뿐이었다.
              const note = i.editorialNote
                ? `<p class="seed-note">${escapeHtml(i.editorialNote)}</p>` : "";
              return `<li><a href="${livePostHref(i)}">${escapeHtml(maskProfanity(i.title))}</a>` +
                `<span class="seed-src">${meta}${src}</span>${note}${summary}</li>`;
            }).join("") + `</ol>`;
          } else {
            seed = navHtml;   // 수집 전이라도 구성은 보여준다
          }
        } catch {
          // 수집 전이거나 실패하면 기존 스켈레톤이 남는다 — 홈은 계속 뜬다.
          // rankingTop은 source가 "seed"인 항목을 제외하므로 FEED_DEV 개발
          // 모드에서는 비어 있는 것이 정상이다(실수집 배포에서만 채워진다).
        }
      
    return { seed };
  }

  // 요청은 이미 만들어 둔 시드만 읽는다. 갱신은 뒤에서 돌려 실시간 피드와
  // 편집 홈 모두 첫 응답 시간을 수집 비용과 분리한다.
  const homeSeedSnapshot = () => {
    const cached = homeSeed.html;
    const age = cached ? Date.now() - homeSeed.at : Infinity;
    const ttl = cached && cached.seed
      ? HOME_SEED_TTL_MS : HOME_SEED_RETRY_MS;
    if (age > ttl && !homeSeed.building) {
      homeSeed.building = true;
      buildHomeSeed().then((next) => {
        if (next) { homeSeed.html = next; homeSeed.at = Date.now(); }
      }).catch(() => {}).finally(() => { homeSeed.building = false; });
    }
    return cached || { seed: "" };
  };

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
  const translate = opts.translate !== undefined ? opts.translate : (() => {
    if (!process.env.FEED_TRANSLATE) return { targetLang: "ko", translateFn: null };
    const free = memoizedTranslator(googleFreeTranslator());
    const paid = process.env.ANTHROPIC_API_KEY
      ? memoizedTranslator(anthropicTranslator({
          apiKey: process.env.ANTHROPIC_API_KEY,
          onUsage: (usage) => { try { store.recordLlmCall(usage); } catch {} }
        }))
      : null;
    return {
      targetLang: "ko",
      translateFn: free,
      authoritativeTranslateFn: paid ? fallbackTranslator(free, paid) : free
    };
  })();
  // 같은 번역기를 엔진에도 넘긴다. 수집 뒤에 enricher가 원문 페이지에서 발췌를
  // 새로 채우는데, 그건 번역이 끝난 **다음**이라 영어 그대로 들어왔다
  // (David 2026-08-05: "지금도 한글요약 만들어서 상세화면에 나오고 있지 않니?"
  //  — 나오긴 하는데 소스가 발췌를 준 경우에만 나왔다).
  const translateText = translate && translate.translateFn ? translate.translateFn : null;
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
  const livePostHref = (item) => {
    engine.rememberPublishedItem(item);
    return `/live#post-${encodeURIComponent(item.id)}`;
  };
  const localEditorial = opts.localEditorial != null
    ? Boolean(opts.localEditorial)
    : process.env.NOWHOT_LOCAL_EDITORIAL === "1";
  const slotCanonicalEditionEnabled = localEditorial && (opts.slotCanonicalEditionEnabled != null
    ? Boolean(opts.slotCanonicalEditionEnabled)
    : process.env.NOWHOT_SLOT_CANONICAL_EDITION === "1");
  const slotCanonicalPointerFile = opts.slotCanonicalPointerFile || process.env.NOWHOT_SLOT_CANONICAL_POINTER ||
    path.resolve(process.cwd(), ".nowhot-local/slot-editions/active.json");
  const slotCanonicalEditionReader = slotCanonicalEditionEnabled
    ? makeSlotCanonicalEditionReader({
        pointerFile: slotCanonicalPointerFile
      })
    : null;
  // v2 전용(David 승인, 2026-08-17 — "골라놓은 순서 그대로"). opts에 없으면
  // null이라 engine.briefing()의 buildDigest 호출이 기존 weight 정렬 그대로다
  // — 운영 서버는 이 옵션을 절대 주지 않는다(build-editions.mjs v2 인프로세스
  // 인스턴스 전용).
  if (opts.editorialExternalRank) engine.editorialExternalRank = opts.editorialExternalRank;
  const requestedRoutingMode = opts.categoryRoutingMode
    || process.env.NOWHOT_CATEGORY_ROUTING || "v1";
  if (requestedRoutingMode === "v2") {
    const file = opts.categoryRoutingFile || process.env.NOWHOT_CATEGORY_ROUTING_FILE
      || path.join(__dirname, "category-routing.snapshot.json");
    const router = opts.categoryRoutingSnapshot
      ? createCategoryRouter(opts.categoryRoutingSnapshot, registry || [])
      : createReloadingCategoryRouter(file, registry || []);
    engine.editorialCategoryRouter = (items, referenceNow) => router.project(items, referenceNow);
    engine.editorialCategoryRoutingStatus = router.status;
  }
  if (opts.editorialPreselectedPool) engine.editorialPreselectedPool = true;
  if (typeof opts.onEngineReady === "function") opts.onEngineReady(engine);
  // 새 편집 홈은 로컬 스테이징에서만 연다. 플래그가 없으면 운영 `/`와
  // 기존 API 동작은 그대로라, 로컬 고도화 중인 화면이 실사용자에게 새지 않는다.
  const localEditorialCanaryReceiptFile = opts.editorialLlmCanaryReceiptFile !== undefined
    ? opts.editorialLlmCanaryReceiptFile
    : process.env.NOWHOT_EDITORIAL_CANARY_RECEIPT || null;
  const localEditorialLlmEnabled = localEditorial && (opts.localEditorialLlmEnabled != null
    ? Boolean(opts.localEditorialLlmEnabled)
    : process.env.NOWHOT_LOCAL_EDITORIAL_LLM === "1");
  const localEditorialLlmModel = process.env.NOWHOT_EDITORIAL_MODEL || process.env.LLM_MODEL || "claude-sonnet-5";
  const localEditorialVerifierModel = process.env.NOWHOT_EDITORIAL_VERIFIER_MODEL || "claude-haiku-4-5";
  const localEditorialLlm = opts.localEditorialLlm || makeEvidenceEditorialPipeline({
    enabled: localEditorialLlmEnabled,
    apiKey: opts.editorialLlmApiKey !== undefined
      ? opts.editorialLlmApiKey
      : process.env.ANTHROPIC_API_KEY || null,
    model: localEditorialLlmModel,
    verifierModel: localEditorialVerifierModel,
    maxIssues: process.env.NOWHOT_EDITORIAL_LLM_MAX_ISSUES || 24,
    fetchImpl: opts.editorialLlmFetch || fetch,
    invoke: opts.editorialLlmInvoke,
    cache: {
      get: (key) => store.getEditorialLlmEdit(key),
      set: (key, value) => store.saveEditorialLlmEdit(key, value)
    },
    onUsage: (usage) => { try { store.recordLlmCall(usage); } catch {} },
    log: (message) => console.log(message),
    clock: serverNowMs
  });
  const localArticleSummaryEnabled = localEditorial && (opts.articleSummaryEnabled != null
    ? Boolean(opts.articleSummaryEnabled)
    : process.env.NOWHOT_ARTICLE_SUMMARY === "1");
  const localArticleSummary = opts.articleSummaryPipeline || makeArticleSummaryPipeline({
    enabled: localArticleSummaryEnabled,
    apiKey: opts.articleSummaryApiKey !== undefined
      ? opts.articleSummaryApiKey
      : process.env.ANTHROPIC_API_KEY || null,
    model: process.env.NOWHOT_ARTICLE_SUMMARY_MODEL || process.env.LLM_MODEL || "claude-sonnet-5",
    verifierModel: process.env.NOWHOT_ARTICLE_SUMMARY_VERIFIER_MODEL || "claude-sonnet-5",
    fallbackModel: process.env.NOWHOT_ARTICLE_SUMMARY_FALLBACK_MODEL || null,
    allowRecovery: false,
    batchSize: opts.articleSummaryBatchSize ?? Number(process.env.NOWHOT_ARTICLE_SUMMARY_BATCH_SIZE || 8),
    fetchImpl: opts.articleSummaryFetch || fetch,
    fetchArticle: opts.articleSummaryFetchArticle,
    invoke: opts.articleSummaryInvoke,
    cache: {
      get: (key) => store.getEditorialLlmEdit(key),
      set: (key, value) => store.saveEditorialLlmEdit(key, value)
    },
    onUsage: (usage) => { try { store.recordLlmCall(usage); } catch {} },
    log: (message) => console.log(message),
    clock: serverNowMs
  });
  const shouldWarmArticleSummaries = Boolean(opts.articleSummaryPipeline) || localArticleSummaryEnabled;
  const LOCAL_SLOT_ORDER = SLOTS.map((slot) => slot.id);
  const localEditionInFlight = new Map();
  const hasCurrentArticleSummary = (issue) =>
    isCurrentArticleSummary(issue?.articleSummary, issue, serverNowMs());

  async function ensureArticleSummaries(edition) {
    const issues = edition && edition.issues || [];
    if (!issues.length || issues.every(hasCurrentArticleSummary)) return edition;
    return localArticleSummary(edition);
  }

  function validEditorialDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const parsed = Date.parse(`${value}T00:00:00+09:00`);
    return Number.isFinite(parsed) && new Date(parsed + 9 * 3600 * 1000).toISOString().slice(0, 10) === value;
  }

  function localEditionTarget({ slotId = null, targetDate = null, asOfMs = null } = {}) {
    if (targetDate) {
      const slot = slotId ? slotById(slotId) : resolveEditorialTarget(serverNowMs()).slot;
      const requestedAsOf = asOfMs == null ? slotAsOfMs(targetDate, slot.id) : Number(asOfMs);
      return {
        available: validEditorialDate(targetDate) && Number.isFinite(requestedAsOf) && requestedAsOf <= serverNowMs(),
        date: targetDate,
        slot,
        asOfMs: requestedAsOf
      };
    }
    return resolveEditorialTarget(serverNowMs(), slotId);
  }

  function normalizedEditorialLlmReceipt(receipt) {
    if (!receipt) return {
      contractId: EDITORIAL_LLM_CONTRACT.stableId,
      state: localEditorialLlmEnabled ? "not_observed" : "disabled",
      enabled: localEditorialLlmEnabled,
      calls: 0,
      cacheHits: 0,
      configuredModel: localEditorialLlmModel,
      configuredVerifierModel: localEditorialVerifierModel,
      model: null,
      verifierModel: null
    };
    const usedModel = Number(receipt.calls || 0) > 0 || Number(receipt.cacheHits || 0) > 0;
    return {
      ...receipt,
      configuredModel: receipt.configuredModel || receipt.model || null,
      configuredVerifierModel: receipt.configuredVerifierModel || receipt.verifierModel || null,
      model: usedModel ? receipt.model || receipt.configuredModel || null : null,
      verifierModel: usedModel ? receipt.verifierModel || receipt.configuredVerifierModel || null : null
    };
  }

  function priorEditorialHistory(date, slotId, segmentKey, baseKey) {
    return store.priorCompatibleEditorialEditions(
      date,
      slotId,
      segmentKey,
      baseKey,
      LOCAL_SLOT_ORDER,
      LOCAL_SLOT_ORDER.length
    );
  }

  function servedEditorialCanonicalUrls(editions, categories = []) {
    const selected = new Set(categories || []);
    const urls = new Set();
    for (const edition of editions || []) {
      for (const issue of edition && edition.issues || []) {
        const issueCategories = issue?.selectedByCategories?.length
          ? issue.selectedByCategories
          : [...(issue?.categoryIds || []), issue?.category].filter(Boolean);
        if (selected.size && !issueCategories.some((category) => selected.has(category))) continue;
        for (const row of issue && issue.sourceEvidence || []) {
          if (row && row.canonicalUrl) urls.add(row.canonicalUrl);
        }
        for (const row of issue && issue.refs || []) {
          if (row && row.canonicalUrl) urls.add(row.canonicalUrl);
        }
      }
    }
    return [...urls];
  }

  async function editionForRequest(snapshot, preview, includeCandidates, editionDate, user = null) {
    const segmentKey = snapshot && snapshot.editionSegment && snapshot.editionSegment.key ||
      editorialInventorySegmentKey(preview.selectedCategories);
    const baseKey = snapshot && snapshot.editionSegment && snapshot.editionSegment.baseKey ||
      editionSegmentKey(preview.selectedCategories);
    const history = priorEditorialHistory(
      editionDate,
      snapshot && snapshot.slot && snapshot.slot.id || preview.slot.id,
      segmentKey,
      baseKey
    );
    const [previous = null, ...olderEditions] = history;
    const continuity = applyEditionChanges(snapshot, previous, {
      targetLimit: snapshot && snapshot.issues && snapshot.issues.length || 1,
      minIssuesPerCategory: snapshot && snapshot.selection && snapshot.selection.minIssuesPerCategory || 0,
      enforceRepeatRule: false,
      historyEditions: olderEditions
    });
    const storedAnchor = store.getEditorialEvidenceAnchor(
      editionDate,
      snapshot?.slot?.id || preview.slot.id
    );
    const segmentAnchor = Date.parse(snapshot?.editionSegment?.evidenceAsOf || "");
    const slotAnchor = Date.parse(snapshot?.editionSegment?.slotAsOf || "");
    const evidenceAsOf = Number.isFinite(segmentAnchor) ? segmentAnchor
      : Number.isFinite(storedAnchor) ? storedAnchor
      : Number.isFinite(slotAnchor) ? slotAnchor
      : null;
    // 저장 조합은 어떤 분야 조합으로 열어도 같은 사건 정본을 다시 투영한다.
    // eventSources가 이미 있다는 이유로 오래된 조합별 제목·출처를 신뢰하면 같은
    // 사건이 선택 분야에 따라 다른 기사처럼 보인다.
    const canonicalIssues = await engine.canonicalEventSources(continuity.issues, {
      asOfMs: evidenceAsOf,
      slotId: preview.slot.id
    });
    const canonical = attachEditorialFulfillment({
      ...snapshot,
      issues: canonicalIssues.map((issue) => {
        const sharedSummary = store.getArticleSummary(articleContentId(issue));
        if (isCurrentArticleSummary(sharedSummary, issue, serverNowMs())) {
          return { ...issue, articleSummary: sharedSummary };
        }
        if (hasCurrentArticleSummary(issue)) return issue;
        if (!issue.articleSummary) return issue;
        const { articleSummary, ...currentIssue } = issue;
        return currentIssue;
      }),
      continuityProjection: {
        ...continuity.editionChange,
        responseOnly: true,
        canonicalSnapshotMutated: false
      },
      editorialLlm: normalizedEditorialLlmReceipt(snapshot.editorialLlm),
      editionDate,
      selection: {
        ...snapshot.selection,
        mode: preview.selection.mode,
        explicit: preview.selection.explicit
      },
      ...(includeCandidates && preview.candidateFixture ? {
        candidateContract: preview.candidateContract,
        candidateFixture: preview.candidateFixture
      } : {})
    });
    return projectEditorialReaderCopy(projectEditorialPersonalization(canonical, user));
  }

  async function buildLocalTodayEdition({
    userId = null,
    categories = null,
    slotId = null,
    includeCandidates = false,
    targetDate = null,
    asOfMs = null,
    generationMode = "on_demand",
    fixedEvidenceAsOfMs = null
  } = {}) {
    const target = localEditionTarget({ slotId, targetDate, asOfMs });
    if (!target.available) {
      const error = new Error(`${target.slot.label}판은 아직 발행 시각 전입니다.`);
      error.code = "EDITORIAL_SLOT_NOT_DUE";
      throw error;
    }
    const currentTarget = resolveEditorialTarget(serverNowMs());
    const isCurrentTarget = target.date === currentTarget.date &&
      target.slot.id === currentTarget.slot.id;
    const requestUser = userId ? store.getUser(userId) : null;
    const resolvedSelection = resolveEditorialSelection(categories, requestUser);
    const selectedCategories = resolvedSelection.selectedCategories;
    const date = target.date;
    const compatibility = assertEditorialSnapshotCompatibility();
    const baseKey = editionSegmentKey(selectedCategories);
    const segmentKey = editorialInventorySegmentKey(selectedCategories);
    const categoryLaneUnion = selectedCategories.length > 1;
    const storedExisting = store.getEditorialEdition(date, target.slot.id, segmentKey);
    const previewForRequest = (snapshot) => ({
      ...snapshot,
      slot: snapshot?.slot || target.slot,
      selectedCategories,
      selection: {
        ...(snapshot?.selection || {}),
        mode: resolvedSelection.mode,
        explicit: resolvedSelection.explicit
      }
    });

    // 단독 분야판은 이미 확정된 상품 재고다. 생성 엔진을 먼저 호출하면 수집
    // 순간의 공급 부족이 저장된 정상판까지 가로막고, 클릭 요청에서 요약 생성도
    // 다시 시작한다. 일반 조회는 읽기만 하고 백그라운드 준비 작업만 보강한다.
    if (!categoryLaneUnion && storedExisting) {
      const preview = previewForRequest(storedExisting);
      let response = await editionForRequest(storedExisting, preview, includeCandidates, date, requestUser);
      if (generationMode === "inventory_summary_warmup" && shouldWarmArticleSummaries &&
          assessEditorialServeability(response).pass && !response.issues.every(hasCurrentArticleSummary)) {
        const detailed = await ensureArticleSummaries(response);
        store.enrichEditorialEdition(date, target.slot.id, segmentKey, detailed);
        response = await editionForRequest(
          store.getEditorialEdition(date, target.slot.id, segmentKey) || storedExisting,
          preview,
          includeCandidates,
          date,
          requestUser
        );
      }
      return response;
    }

    let evidenceAsOfMs = fixedEvidenceAsOfMs == null ? Number.NaN : Number(fixedEvidenceAsOfMs);
    const hasFixedEvidenceAsOf = Number.isFinite(evidenceAsOfMs);
    if (!Number.isFinite(evidenceAsOfMs)) {
      evidenceAsOfMs = store.getEditorialEvidenceAnchor(date, target.slot.id);
    }
    const hasAllCurrentLanes = selectedCategories.every((category) =>
      store.getEditorialEdition(date, target.slot.id, editorialInventorySegmentKey([category])));
    if (!Number.isFinite(evidenceAsOfMs)) {
      if (isCurrentTarget) await engine.refresh();
      evidenceAsOfMs = store.saveEditorialEvidenceAnchor(
        date,
        target.slot.id,
        isCurrentTarget ? serverNowMs() : target.asOfMs
      );
    } else if (isCurrentTarget && !hasAllCurrentLanes &&
        (!Number.isFinite(engine.lastRefreshedAt) || serverNowMs() - engine.lastRefreshedAt >= 5 * 60 * 1000)) {
      await engine.refresh();
      if (!hasFixedEvidenceAsOf) evidenceAsOfMs = serverNowMs();
    }
    const delayedCurrentSlotRecovery = isCurrentTarget && evidenceAsOfMs > target.asOfMs;
    let preview;
    if (categoryLaneUnion) {
      const categoryEditions = await Promise.all(selectedCategories.map(async (category) => {
        const laneSegmentKey = editorialInventorySegmentKey([category]);
        let edition = store.getEditorialEdition(date, target.slot.id, laneSegmentKey);
        if (!edition) {
          const laneEvidenceAsOfMs = isCurrentTarget ? serverNowMs() : evidenceAsOfMs;
          const generated = await buildLocalTodayEdition({
            categories: [category],
            slotId: target.slot.id,
            includeCandidates,
            targetDate: target.date,
            asOfMs: target.asOfMs,
            generationMode: generationMode === "inventory_summary_warmup"
              ? generationMode
              : "category_lane",
            fixedEvidenceAsOfMs: laneEvidenceAsOfMs
          });
          edition = store.getEditorialEdition(date, target.slot.id, laneSegmentKey) || generated;
        }
        const laneAnchor = Date.parse(edition?.editionSegment?.evidenceAsOf || "");
        const canonicalIssues = await engine.canonicalEventSources(edition?.issues || [], {
          asOfMs: Number.isFinite(laneAnchor) ? laneAnchor : evidenceAsOfMs,
          slotId: target.slot.id
        });
        return {
          category,
          edition: {
            ...edition,
            issues: canonicalIssues.map((issue) => {
              const sharedSummary = store.getArticleSummary(articleContentId(issue));
              if (isCurrentArticleSummary(sharedSummary, issue, serverNowMs())) {
                return { ...issue, articleSummary: sharedSummary };
              }
              const { articleSummary, ...withoutLaneSummary } = issue;
              return withoutLaneSummary;
            })
          }
        };
      }));
      evidenceAsOfMs = Math.max(evidenceAsOfMs, ...categoryEditions.map(({ edition }) =>
        Date.parse(edition?.editionSegment?.evidenceAsOf || "")).filter(Number.isFinite));
      preview = await engine.todayEdition({
        categories: selectedCategories,
        slotId: target.slot.id,
        asOfMs: evidenceAsOfMs,
        includeCandidates,
        sharedCanonical: true,
        allowCarryover: true,
        categoryEditions
      });
      preview.selection = {
        ...preview.selection,
        mode: resolvedSelection.mode,
        explicit: resolvedSelection.explicit
      };
    } else {
      preview = await engine.todayEdition({
        userId,
        categories: selectedCategories,
        slotId: target.slot.id,
        asOfMs: evidenceAsOfMs,
        includeCandidates,
        sharedCanonical: true,
        allowCarryover: true
      });
      preview.selection = {
        ...preview.selection,
        mode: resolvedSelection.mode,
        explicit: resolvedSelection.explicit
      };
    }

    const buildKey = `${date}|${preview.slot.id}|${segmentKey}`;
    let running = localEditionInFlight.get(buildKey);
    if (!running) {
      running = (async () => {
        const history = priorEditorialHistory(date, preview.slot.id, segmentKey, baseKey);
        const [prior = null, ...olderEditions] = history;
        const candidate = categoryLaneUnion
          ? preview
          : prior
          ? await engine.todayEdition({
            categories: selectedCategories,
            slotId: target.slot.id,
            asOfMs: evidenceAsOfMs,
            includeCandidates,
            reserveIssues: Math.min(
              preview.selection.maxIssues,
              Math.max(8, history.length * 8)
            ),
            sharedCanonical: true,
            allowCarryover: true,
            servedCanonicalUrls: servedEditorialCanonicalUrls(history, preview.selectedCategories)
          })
          : preview;
        const finalized = categoryLaneUnion
          ? attachEditorialFulfillment(candidate)
          : attachEditorialFulfillment(applyEditionChanges(candidate, prior, {
            targetLimit: preview.selection.maxIssues,
            minIssuesPerCategory: preview.selection.minIssuesPerCategory,
            additiveCategoryUnion: preview.selection.additiveCategoryUnion,
            categoryIssueLimit: preview.selection.categoryIssueLimit,
            enforceRepeatRule: true,
            historyEditions: olderEditions
          }));
        const edited = categoryLaneUnion || !generationMode.startsWith("inventory_")
          ? finalized
          : await localEditorialLlm(finalized);
        const snapshot = {
          ...edited,
          editionSegment: {
            key: segmentKey,
            baseKey,
            snapshotVersion: EDITORIAL_INVENTORY_CONTRACT.snapshotVersion,
            compatibility,
            categories: selectedCategories,
            previousEditionId: prior && prior.editionId || null,
            slotAsOf: new Date(target.asOfMs).toISOString(),
            evidenceAsOf: new Date(evidenceAsOfMs).toISOString(),
            generationMode,
            compositionMode: categoryLaneUnion ? "stored_category_lane_union_v1" : "category_lane_v1",
            delayedRecovery: {
              applied: delayedCurrentSlotRecovery,
              reason: delayedCurrentSlotRecovery
                ? "slot_canonical_anchor_after_scheduled_time"
                : null,
              delayedByMs: delayedCurrentSlotRecovery
                ? Math.max(0, evidenceAsOfMs - target.asOfMs)
                : 0,
              historicalSlotBackdated: false
            },
            personalizationBase: "user_neutral_shared_canonical"
          }
        };
        // 현재 슬롯의 보류 후보를 첫 저장으로 굳히면, 다음 수집에서 공급이
        // 회복돼도 inventory가 기존 판으로 오인해 영구 409가 된다. 보류 후보는
        // 응답·관측에는 쓰되 저장하지 않아 다음 점검이 다시 만들게 하고,
        // 기계 서빙 관문을 통과한 판만 불변 스냅샷으로 고정한다.
        const serveableSnapshot = omitHeldEditorialIssues(snapshot);
        const snapshotAssessment = assessEditorialServeability(
          projectEditorialReaderCopy(serveableSnapshot)
        );
        if (!snapshotAssessment.pass) {
          if (isCurrentTarget) return snapshot;
          return store.saveEditorialEdition(date, preview.slot.id, segmentKey, snapshot);
        }
        const storedSnapshot = store.saveEditorialEdition(
          date,
          preview.slot.id,
          segmentKey,
          serveableSnapshot,
          { replace: categoryLaneUnion || Boolean(storedExisting) }
        );
        // 요약은 판 생성의 부가 재고다. 사용자 조회에서 모델을 호출하지 않고,
        // 기존 inventory 작업만 검증 요약을 준비해 공유 저장소에 보강한다.
        if (shouldWarmArticleSummaries && generationMode.startsWith("inventory_")) {
          const preparedSnapshot = await ensureArticleSummaries(storedSnapshot);
          store.enrichEditorialEdition(date, preview.slot.id, segmentKey, preparedSnapshot);
        }
        return storedSnapshot;
      })().finally(() => localEditionInFlight.delete(buildKey));
      localEditionInFlight.set(buildKey, running);
    }
    return editionForRequest(await running, preview, includeCandidates, date, requestUser);
  }

  function editorialServingStatus(assessment, extra = {}) {
    return {
      contractId: EDITORIAL_SERVING_CONTRACT.stableId,
      contractVersion: EDITORIAL_SERVING_CONTRACT.version,
      state: assessment.pass ? "current_machine_verified" : "current_machine_hold",
      responsePacketId: assessment.packetId,
      editionId: assessment.editionId,
      selectedCategories: assessment.selectedCategories,
      availableCategories: CATEGORIES.map(({ id, label }) => ({ id, label })),
      failures: assessment.failures,
      metrics: assessment.metrics,
      readerDiversity: assessment.packet && assessment.packet.readerDiversity || null,
      fulfillment: assessment.fulfillment,
      humanReviewRequired: EDITORIAL_SERVING_CONTRACT.humanReviewRequired,
      ...extra
    };
  }

  function saveEditorialServingVerification(edition, assessment) {
    return store.saveEditorialServingVerification({
      contractId: EDITORIAL_SERVING_CONTRACT.stableId,
      contractVersion: EDITORIAL_SERVING_CONTRACT.version,
      packetId: assessment.packetId,
      editionId: assessment.editionId,
      date: edition.editionDate || null,
      slotId: edition.slot && edition.slot.id || null,
      slotAsOf: edition.editionSegment && edition.editionSegment.slotAsOf || edition.generatedAt || null,
      segmentKey: edition.editionSegment && edition.editionSegment.key ||
        editorialInventorySegmentKey(assessment.selectedCategories),
      categories: assessment.selectedCategories,
      verifiedAt: new Date(serverNowMs()).toISOString()
    });
  }

  async function verifiedEditorialFallback(currentEdition, currentAssessment, userId) {
    const segmentKey = currentEdition && currentEdition.editionSegment && currentEdition.editionSegment.key ||
      editorialInventorySegmentKey(currentAssessment.selectedCategories);
    const currentAsOf = Date.parse(
      currentEdition && currentEdition.editionSegment && currentEdition.editionSegment.slotAsOf ||
      currentEdition && currentEdition.generatedAt || ""
    );
    if (!Number.isFinite(currentAsOf)) return null;
    const requestUser = userId ? store.getUser(userId) : null;

    for (const receipt of store.listEditorialServingVerifications(segmentKey)) {
      if (receipt.contractId !== EDITORIAL_SERVING_CONTRACT.stableId ||
          Number(receipt.contractVersion) !== EDITORIAL_SERVING_CONTRACT.version ||
          receipt.editionId === currentAssessment.editionId ||
          !sameEditorialCategorySet(receipt.categories, currentAssessment.selectedCategories)) continue;
      const fallbackAsOf = Date.parse(receipt.slotAsOf || "");
      const ageMs = currentAsOf - fallbackAsOf;
      if (!Number.isFinite(fallbackAsOf) || ageMs < 0 || ageMs > EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs) continue;
      const snapshot = store.getEditorialEdition(receipt.date, receipt.slotId, receipt.segmentKey);
      if (!snapshot || snapshot.editionId !== receipt.editionId) continue;
      const fallback = await editionForRequest(snapshot, currentEdition, false, receipt.date, requestUser);
      const assessment = assessEditorialServeability(fallback);
      if (!assessment.pass || assessment.packetId !== receipt.packetId ||
          !sameEditorialCategorySet(assessment.selectedCategories, currentAssessment.selectedCategories)) continue;
      return {
        edition: fallback,
        assessment,
        receipt,
        ageMs
      };
    }
    return null;
  }

  async function buildServeableTodayEdition(options = {}) {
    const current = await buildLocalTodayEdition(options);
    const assessment = assessEditorialServeability(current);
    if (assessment.pass) {
      const receipt = saveEditorialServingVerification(current, assessment);
      return {
        ...current,
        requestedCategories: assessment.selectedCategories,
        servedCategories: assessment.selectedCategories,
        withheldCategories: [],
        serving: editorialServingStatus(assessment, {
          fallback: false,
          requestedDate: current.editionDate || null,
          servedDate: receipt.date,
          servedSlotId: receipt.slotId,
          verifiedAt: receipt.verifiedAt
        })
      };
    }

    const fallback = await verifiedEditorialFallback(current, assessment, options.userId || null);
    if (fallback) {
      return {
        ...fallback.edition,
        serving: editorialServingStatus(fallback.assessment, {
          state: "fallback_machine_verified",
          fallback: true,
          requestedDate: current.editionDate || null,
          requestedSlotId: current.slot && current.slot.id || null,
          servedDate: fallback.receipt.date,
          servedSlotId: fallback.receipt.slotId,
          verifiedAt: fallback.receipt.verifiedAt,
          ageMs: fallback.ageMs,
          currentHold: editorialServingStatus(assessment)
        })
      };
    }

    const error = new Error("새 브리핑을 검수 중입니다. 검증된 이전 브리핑도 아직 없습니다.");
    error.code = "EDITORIAL_EDITION_NOT_SERVEABLE";
    error.serving = editorialServingStatus(assessment, {
      fallback: false,
      requestedDate: current.editionDate || null,
      requestedSlotId: current.slot && current.slot.id || null,
      fallbackSearchedWithinMs: EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs
    });
    throw error;
  }

  async function buildLocalEditionReplay(categories = CATEGORIES.map((category) => category.id)) {
    const history = [];
    const slots = [];
    const date = resolveEditorialTarget(serverNowMs()).date;
    for (const slot of SLOTS) {
      const candidate = await engine.todayEdition({
        categories,
        slotId: slot.id,
        asOfMs: slotAsOfMs(date, slot.id),
        reserveIssues: Math.min(Math.max(8, categories.length * 3), history.length * 8),
        sharedCanonical: true,
        allowCarryover: history.length > 0,
        servedCanonicalUrls: servedEditorialCanonicalUrls(history, categories)
      });
      const [previous = null, ...olderEditions] = history;
      const edition = attachEditorialFulfillment(applyEditionChanges(candidate, previous, {
        targetLimit: candidate.selection.maxIssues,
        minIssuesPerCategory: candidate.selection.minIssuesPerCategory,
        additiveCategoryUnion: candidate.selection.additiveCategoryUnion,
        categoryIssueLimit: candidate.selection.categoryIssueLimit,
        enforceRepeatRule: true,
        historyEditions: olderEditions
      }));
      const preflightReviewPacket = buildBlindReviewPacket(edition);
      slots.push({
        id: slot.id,
        label: slot.label,
        editionId: edition.editionId,
        candidateIssueCount: edition.editionChange.candidateIssueCount,
        selectedIssueCount: edition.editionChange.selectedIssueCount,
        heldRepeatCount: edition.editionChange.heldRepeatCount,
        counts: edition.editionChange.counts,
        comparedEditionIds: edition.editionChange.comparedEditionIds || [],
        carryover: edition.editorialCarryover || null,
        publishable: edition.publishable,
        candidateQuality: edition.editorialQuality || null,
        categoryFulfillment: edition.categoryFulfillment ? {
          state: edition.categoryFulfillment.state,
          goalSatisfied: edition.categoryFulfillment.goalSatisfied,
          selectedCount: edition.categoryFulfillment.selectedCount,
          metCount: edition.categoryFulfillment.metCount,
          targetPerCategory: edition.categoryFulfillment.targetPerCategory,
          missingCategoryIds: edition.categoryFulfillment.missingCategoryIds || [],
          noQualifiedCategoryIds: edition.categoryFulfillment.noQualifiedCategoryIds || [],
          underfilledCategoryIds: edition.categoryFulfillment.underfilledCategoryIds || []
        } : null,
        preflightReview: {
          stableId: "NOWHOT-PROJECTED-EDITION-PREFLIGHT-001",
          contractId: preflightReviewPacket.contractId,
          packetId: preflightReviewPacket.packetId,
          editionId: preflightReviewPacket.editionId,
          state: preflightReviewPacket.state,
          projectedOnly: true,
          persisted: false,
          actualElapsedProof: false,
          humanInputAllowed: false,
          metrics: preflightReviewPacket.metrics,
          rows: preflightReviewPacket.rows,
          boundary: "현재 수집 풀의 비저장 코드 경로 사전검수다. 실제 슬롯 수집·저장·사람 품질 PASS 증거가 아니다."
        }
      });
      history.unshift(edition);
    }
    return {
      stableId: "NOWHOT-THREE-SLOT-REPLAY-001",
      state: "same_pool_replay_complete",
      observedAt: new Date(serverNowMs()).toISOString(),
      mode: "same_current_pool_no_elapsed_time",
      projectedOnly: true,
      fixedItemCount: false,
      selectedCategories: categories.slice().sort(),
      slots,
      llmCalls: 0,
      proves: "세 슬롯 순서·직전 판 연결·반복 보류 코드 경로",
      doesNotProve: "실제 시간차 수집량·세 판 콘텐츠 충분성·사람 품질 PASS"
    };
  }

  const LOCAL_INVENTORY_BATCH_LIMIT = Math.max(1, Math.min(
    48,
    Number(process.env.NOWHOT_EDITORIAL_INVENTORY_BATCH || 12)
  ));
  const LOCAL_INVENTORY_CHECK_MS = Math.max(
    1_000,
    Number(process.env.NOWHOT_EDITORIAL_INVENTORY_CHECK_MS || 5 * 60 * 1000)
  );
  const LOCAL_EDITORIAL_CLOCK_SOURCE = opts.clock ? "injected" : "system";
  const LOCAL_INVENTORY_SCHEDULE_ENABLED = localEditorial && !slotCanonicalEditionEnabled &&
    !process.env.NODE_TEST_CONTEXT && opts.localEditorialInventorySchedule !== false;
  const LOCAL_CANONICAL_SCHEDULE_ENABLED = localEditorial && slotCanonicalEditionEnabled &&
    process.env.NOWHOT_SLOT_CANONICAL_PREPUBLISH !== "0" &&
    (!process.env.NODE_TEST_CONTEXT || typeof opts.localCanonicalPublisher === "function") &&
    opts.localCanonicalPrepublishSchedule !== false;
  let localInventoryPending = null;
  let localCanonicalPending = null;
  let localInventoryReceipt = null;
  let localElapsedReceipt = null;
  let localQualityReviewSamplingReceipt = null;

  function freezeInventoryQualityReviewPackets(inventory) {
    const segment = [...(inventory && inventory.segments || [])].sort((a, b) =>
      (b.categories || []).length - (a.categories || []).length ||
      Number(b.audienceCount || 0) - Number(a.audienceCount || 0) ||
      String(a.key).localeCompare(String(b.key))
    )[0] || null;
    const frozen = [];
    if (segment) {
      for (const slotRow of inventory && inventory.slots || []) {
        const edition = store.getEditorialEdition(slotRow.date, slotRow.id, segment.key);
        if (!edition) continue;
        const packet = buildBlindReviewPacket(edition);
        const record = store.saveEditorialReviewPacket(packet, {
          date: slotRow.date,
          slotId: slotRow.id,
          segmentKey: segment.key,
          activateIfEmpty: false
        });
        frozen.push({
          packetId: record.packetId,
          editionId: record.editionId,
          date: record.date,
          slotId: record.slotId,
          segmentKey: record.segmentKey,
          issueCount: record.packet && record.packet.rows && record.packet.rows.length || 0,
          readerFrozenCount: record.packet && record.packet.rows
            ? record.packet.rows.filter((row) => row.reader).length
            : 0,
          readerGateState: record.packet && record.packet.state || null
        });
      }
    }
    return {
      stableId: "NOWHOT-QUALITY-REVIEW-SAMPLING-001",
      state: frozen.length ? "quality_review_packets_frozen" : "quality_review_packet_waiting",
      strategy: "widest_shared_category_segment_per_due_slot",
      fixedItemCount: false,
      selectedSegmentKey: segment && segment.key || null,
      selectedCategories: segment && segment.categories || [],
      frozenPacketCount: frozen.length,
      frozen,
      activationChanged: false,
      proves: "관리자 화면을 열지 않아도 슬롯별 가장 넓은 공유 판의 사람 검수 입력 대상이 불변 보존됨",
      doesNotProve: "사람 검수 완료·검수자 신원·사람 품질 PASS"
    };
  }

  function upgradeLegacyActiveReviewPacket(record) {
    if (!record) return record;
    const ledger = store.getEditorialReview(record.packetId, record.editionId);
    if (hasHumanReviewWork(ledger)) return record;
    const edition = store.getEditorialEdition(record.date, record.slotId, record.segmentKey);
    if (!edition) return record;
    const expected = buildBlindReviewPacket(edition);
    if (record.packetId === expected.packetId && Number(record.packet && record.packet.packetVersion || 0) >= 3) {
      return record;
    }
    const packet = {
      ...expected,
      supersedes: {
        packetId: record.packetId,
        reason: Number(record.packet && record.packet.packetVersion || 0) >= 2
          ? "reader_projection_changed_before_human_review"
          : "legacy_packet_missing_frozen_reader_payload"
      }
    };
    const upgraded = store.saveEditorialReviewPacket(packet, {
      date: record.date,
      slotId: record.slotId,
      segmentKey: record.segmentKey,
      activateIfEmpty: false
    });
    store.activateEditorialReviewPacket(upgraded.packetId, upgraded.editionId);
    return upgraded;
  }

  function captureElapsedInventoryEvidence(inventory, nowMs) {
    const dates = new Set();
    const observations = [];
    for (const slotRow of inventory && inventory.slots || []) {
      dates.add(slotRow.date);
      const editions = (inventory.segments || []).map((segment) => ({
        segmentKey: segment.key,
        edition: store.getEditorialEdition(slotRow.date, slotRow.id, segment.key)
      }));
      const observation = buildEditorialSlotObservation({
        date: slotRow.date,
        slot: slotById(slotRow.id),
        asOfMs: Date.parse(slotRow.asOf),
        observedAtMs: nowMs,
        clockSource: LOCAL_EDITORIAL_CLOCK_SOURCE,
        segments: inventory.segments || [],
        editions,
        timingBasis: "inventory_completed",
        inventoryStartedAt: inventory.startedAt,
        inventoryCompletedAt: inventory.completedAt,
        inventoryDurationMs: inventory.durationMs
      });
      observations.push(observation);
    }
    store.saveEditorialSlotObservations(observations);
    const latestDate = [...dates].sort().at(-1) || null;
    return summarizeElapsedEditionEvidence(
      latestDate ? store.editorialSlotObservationsForDate(latestDate) : [],
      { date: latestDate }
    );
  }

  function localEditorialSchedulerStatus(nowMs = serverNowMs()) {
    const date = editorialKstDate(nowMs);
    const due = dueEditorialSlots(nowMs);
    const observations = store.editorialSlotObservationsForDate(date);
    const observedIds = new Set(observations.map((row) => row.slotId));
    const pendingDue = due.filter((entry) => !observedIds.has(entry.slot.id));
    const captureWindowMs = ELAPSED_EDITION_EVIDENCE_CONTRACT.captureWindowMs;
    const open = pendingDue.find((entry) => nowMs - entry.asOfMs <= captureWindowMs) || null;
    const overdue = pendingDue.filter((entry) => nowMs - entry.asOfMs > captureWindowMs);
    const target = open || nextEditorialSlot(nowMs);
    const state = !localEditorial
      ? "disabled"
      : slotCanonicalEditionEnabled
        ? LOCAL_CANONICAL_SCHEDULE_ENABLED ? "slot_scheduler_armed" : "manual_only"
        : !LOCAL_INVENTORY_SCHEDULE_ENABLED
        ? "manual_only"
        : overdue.length
          ? "slot_capture_overdue"
          : open
            ? "slot_capture_window_open"
            : "slot_scheduler_armed";
    return {
      stableId: "NOWHOT-EDITORIAL-SCHEDULER-STATUS-001",
      state,
      enabled: LOCAL_INVENTORY_SCHEDULE_ENABLED || LOCAL_CANONICAL_SCHEDULE_ENABLED,
      mode: slotCanonicalEditionEnabled ? "slot_canonical_prepublish" : "editorial_inventory",
      clockSource: LOCAL_EDITORIAL_CLOCK_SOURCE,
      checkIntervalMs: LOCAL_INVENTORY_CHECK_MS,
      captureWindowMs,
      serverNow: new Date(nowMs).toISOString(),
      date,
      dueSlotIds: due.map((entry) => entry.slot.id),
      observedSlotIds: observations.map((row) => row.slotId),
      pendingDueSlotIds: pendingDue.map((entry) => entry.slot.id),
      overdueSlotIds: overdue.map((entry) => entry.slot.id),
      nextAction: {
        mode: open ? "capture_window_open" : "upcoming_slot",
        date: target.date,
        slotId: target.slot.id,
        slotLabel: target.slot.label,
        scheduledAt: new Date(target.asOfMs).toISOString(),
        captureWindowEndsAt: new Date(target.asOfMs + captureWindowMs).toISOString()
      }
    };
  }

  async function runLocalEditorialInventory(nowMs = serverNowMs()) {
    if (!localEditorial) return null;
    if (localInventoryPending) return localInventoryPending;
    localInventoryPending = buildEditorialInventory({
      store,
      buildEdition: buildLocalTodayEdition,
      nowMs,
      clock: serverNowMs,
      defaultCategories: DEFAULT_EDITORIAL_PREVIEW,
      knownCategoryIds: CATEGORIES.map((category) => category.id),
      batchLimit: LOCAL_INVENTORY_BATCH_LIMIT,
      needsRefresh: shouldWarmArticleSummaries
        ? (edition) => (edition?.issues || []).some((issue) => {
          const shared = store.getArticleSummary(articleContentId(issue));
          return !isCurrentArticleSummary(shared, issue, serverNowMs()) && !hasCurrentArticleSummary(issue);
        })
        : null
    }).then((receipt) => {
      localInventoryReceipt = receipt;
      localQualityReviewSamplingReceipt = freezeInventoryQualityReviewPackets(receipt);
      // 정시 증거는 작업을 시작한 시각이 아니라 모든 제한 큐 처리가 끝나
      // 실제 저장 판을 관측한 시각으로 판정한다.
      localElapsedReceipt = captureElapsedInventoryEvidence(
        receipt,
        Date.parse(receipt.completedAt) || serverNowMs()
      );
      return receipt;
    }).finally(() => { localInventoryPending = null; });
    return localInventoryPending;
  }

  // 로컬판에서만 슬롯 재고를 점검한다. 사용자별 생성이 아니라 선택 조합별
  // 제한 큐라 같은 취향을 가진 이용자는 한 저장 판을 함께 읽는다.
  if (LOCAL_INVENTORY_SCHEDULE_ENABLED) {
    const inventoryTick = () => runLocalEditorialInventory().catch((error) => {
      console.warn("[editorial-inventory] 판본 점검 실패:", error && error.message);
    });
    const interval = setInterval(inventoryTick, LOCAL_INVENTORY_CHECK_MS);
    interval.unref?.();
    const warm = setTimeout(inventoryTick, Number(process.env.NOWHOT_EDITORIAL_INVENTORY_DELAY_MS || 30_000));
    warm.unref?.();
  }

  async function runLocalCanonicalPrepublish(nowMs = serverNowMs()) {
    if (localCanonicalPending) return localCanonicalPending;
    const poolFile = opts.localCanonicalPoolFile || engine._poolFile;
    if (!poolFile) throw new Error("canonical prepublish: persistent pool file required");
    const publish = opts.localCanonicalPublisher || (async (options) => {
      const { runDueSlotPrepublish } = await import("../../tools/run-slot-canonical-prepublish.mjs");
      return runDueSlotPrepublish(options);
    });
    localCanonicalPending = publish({
      nowMs,
      poolFile,
      outDir: path.dirname(slotCanonicalPointerFile),
      allowPaid: false
    }).finally(() => { localCanonicalPending = null; });
    return localCanonicalPending;
  }

  if (LOCAL_CANONICAL_SCHEDULE_ENABLED) {
    const canonicalTick = () => runLocalCanonicalPrepublish().catch((error) => {
      console.warn("[slot-canonical] 정시 후보 생성 HOLD:", error && error.message);
    });
    const interval = setInterval(canonicalTick,
      Number(opts.localCanonicalPrepublishCheckMs || LOCAL_INVENTORY_CHECK_MS));
    interval.unref?.();
    const warm = setTimeout(canonicalTick,
      Number(opts.localCanonicalPrepublishDelayMs ?? process.env.NOWHOT_EDITORIAL_INVENTORY_DELAY_MS ?? 30_000));
    warm.unref?.();
  }

  const localEditorialEvidenceCache = { at: 0, value: null, pending: null };

  async function freezeCurrentEditorialReviewPacket() {
    if (!store.file) {
      const error = new Error("persistent local store is required");
      error.code = "EDITORIAL_REVIEW_PERSISTENCE_REQUIRED";
      throw error;
    }

    const target = resolveEditorialTarget(serverNowMs());
    const categories = CATEGORIES.map((category) => category.id);
    const reviewSegmentKey = `review:${EDITORIAL_INVENTORY_CONTRACT.snapshotVersion}:${editionSegmentKey(categories)}`;
    const active = store.activeEditorialReviewPacket();
    const reusable = active &&
      active.date === target.date &&
      active.segmentKey === reviewSegmentKey &&
      active.packet && active.packet.state === "human_annotation_ready" &&
      active.packet.rows && active.packet.rows.length === 42;
    if (reusable) return { record: active, reused: true };

    const activeLedger = active && store.getEditorialReview(active.packetId, active.editionId);
    if (active && hasHumanReviewWork(activeLedger)) {
      const error = new Error("active review has unfinished annotations or adjudication");
      error.code = "EDITORIAL_REVIEW_ACTIVE_IN_PROGRESS";
      throw error;
    }

    // 검수용 현재 표본은 수집 완료 뒤의 시각을 기준으로 만든다. 정시 슬롯의
    // canonical 저장판은 건드리지 않으며, 이 경로에서는 외부 LLM도 부르지 않는다.
    await engine.refresh();
    const observedAtMs = serverNowMs();
    const preview = await engine.todayEdition({
      categories,
      slotId: target.slot.id,
      asOfMs: observedAtMs,
      includeCandidates: true,
      sharedCanonical: true
    });
    const finalized = projectEditorialReaderCopy(attachEditorialFulfillment(applyEditionChanges(preview, null, {
      targetLimit: preview.selection.maxIssues,
      minIssuesPerCategory: preview.selection.minIssuesPerCategory,
      enforceRepeatRule: false,
      historyEditions: []
    })));
    const provisional = buildBlindReviewPacket(finalized, {
      observedAt: new Date(observedAtMs).toISOString()
    });
    const edition = {
      ...finalized,
      editionId: `${preview.editionId}-review-${provisional.packetId.slice(4)}`,
      reviewFreeze: {
        stableId: "NOWHOT-REVIEW-PACKET-FREEZE-001",
        reviewOnly: true,
        canonicalEditionMutated: false,
        externalLlmCalls: 0
      }
    };
    const packet = buildBlindReviewPacket(edition, {
      observedAt: new Date(observedAtMs).toISOString()
    });
    if (packet.rows.length !== 42 || packet.state !== "human_annotation_ready") {
      const error = new Error("current review packet did not satisfy the 42-row machine-ready gate");
      error.code = "EDITORIAL_REVIEW_PACKET_HOLD";
      error.freeze = {
        expectedIssueCount: 42,
        issueCount: packet.rows.length,
        state: packet.state,
        metrics: packet.metrics,
        selectedCategories: categories,
        categoryFulfillment: finalized.categoryFulfillment || null,
        candidateMetrics: preview.candidateFixture && preview.candidateFixture.metrics || null
      };
      throw error;
    }

    const record = store.saveEditorialReviewPacket(packet, {
      date: target.date,
      slotId: target.slot.id,
      segmentKey: reviewSegmentKey,
      activateIfEmpty: false
    });
    store.activateEditorialReviewPacket(record.packetId, record.editionId);
    localEditorialEvidenceCache.at = 0;
    localEditorialEvidenceCache.value = null;
    return { record, reused: false };
  }

  function readLocalEditorialCanaryReceipt() {
    if (!localEditorialCanaryReceiptFile) return null;
    try {
      const receipt = JSON.parse(fs.readFileSync(localEditorialCanaryReceiptFile, "utf8"));
      const constraints = receipt && receipt.constraints || {};
      const totals = receipt && receipt.totals || {};
      const pipeline = receipt && receipt.pipeline || {};
      const calls = Number(totals.calls || 0);
      const requested = Number(constraints.requestedIssueCount || 0);
      if (receipt.stableId !== EDITORIAL_LLM_CANARY_CONTRACT.stableId) return null;
      if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(String(constraints.localBase || ""))) return null;
      if (calls < 0 || calls > EDITORIAL_LLM_CANARY_CONTRACT.maxCalls) return null;
      if (requested < 1 || requested > EDITORIAL_LLM_CANARY_CONTRACT.maxIssues) return null;
      return {
        contractId: receipt.stableId,
        state: receipt.state || pipeline.state || "unknown",
        actualReceipt: true,
        executedAt: receipt.executedAt || null,
        requestedIssueCount: requested,
        maxIssues: EDITORIAL_LLM_CANARY_CONTRACT.maxIssues,
        maxCalls: EDITORIAL_LLM_CANARY_CONTRACT.maxCalls,
        externalCalls: calls,
        edited: Number(pipeline.edited || 0),
        rejected: Number(pipeline.rejected || 0),
        inputTokens: Number(totals.inputTokens || 0),
        outputTokens: Number(totals.outputTokens || 0),
        outputReceipt: path.basename(localEditorialCanaryReceiptFile)
      };
    } catch {
      return null;
    }
  }

  async function localEditorialEvidenceSnapshot() {
    if (!localEditorial) return null;
    if (localEditorialEvidenceCache.value && Date.now() - localEditorialEvidenceCache.at < 60_000) {
      return localEditorialEvidenceCache.value;
    }
    if (localEditorialEvidenceCache.pending) return localEditorialEvidenceCache.pending;
    localEditorialEvidenceCache.pending = (async () => {
      const inventory = await runLocalEditorialInventory();
      const edition = await buildLocalTodayEdition({
        categories: CATEGORIES.map((category) => category.id),
        includeCandidates: true
      });
      const servingAssessment = assessEditorialServeability(edition);
      const servingVerifications = store.listEditorialServingVerifications();
      const latestServingVerification = servingVerifications[0] || null;
      const editionReplay = await buildLocalEditionReplay();
      const fixture = edition.candidateFixture;
      const candidatePacket = buildBlindReviewPacket(edition);
      const candidateRecord = store.saveEditorialReviewPacket(candidatePacket, {
        date: edition.editionDate || null,
        slotId: edition.slot && edition.slot.id || null,
        segmentKey: edition.editionSegment && edition.editionSegment.key || null
      });
      let activeRecord = store.activeEditorialReviewPacket() || candidateRecord;
      activeRecord = upgradeLegacyActiveReviewPacket(activeRecord);
      const packet = activeRecord.packet;
      const humanReview = summarizeHumanReview(
        packet,
        store.getEditorialReview(packet.packetId, packet.editionId)
      );
      const reviewQueueItems = store.listEditorialReviewPackets().map((record) => {
        const summary = summarizeHumanReview(
          record.packet,
          store.getEditorialReview(record.packetId, record.editionId)
        );
        return {
          packetId: record.packetId,
          editionId: record.editionId,
          date: record.date,
          slotId: record.slotId,
          segmentKey: record.segmentKey,
          issueCount: record.packet && record.packet.rows && record.packet.rows.length || 0,
          frozenAt: record.frozenAt,
          state: summary.overallState,
          humanState: summary.state,
          hasProgress: Object.values(summary.completedByReviewer).some((row) => row.completed > 0),
          isActive: record.key === activeRecord.key,
          isCurrentCandidate: record.key === candidateRecord.key
        };
      });
      const reviewQueue = {
        stableId: HUMAN_REVIEW_QUEUE_CONTRACT.stableId,
        state: activeRecord.key === candidateRecord.key ? "active_current_packet" : "active_packet_pinned",
        activation: HUMAN_REVIEW_QUEUE_CONTRACT.activation,
        packetRule: HUMAN_REVIEW_QUEUE_CONTRACT.packetRule,
        independenceRule: HUMAN_REVIEW_QUEUE_CONTRACT.independenceRule,
        adjudicationRule: HUMAN_REVIEW_QUEUE_CONTRACT.adjudicationRule,
        activePacketId: activeRecord.packetId,
        activeEditionId: activeRecord.editionId,
        currentCandidatePacketId: candidateRecord.packetId,
        currentCandidateEditionId: candidateRecord.editionId,
        queuedCount: reviewQueueItems.length,
        pendingCount: reviewQueueItems.filter((row) => !row.isActive).length,
        items: reviewQueueItems
      };
      const reviewPacket = {
        ...packet,
        frozenAt: activeRecord.frozenAt,
        sourceDate: activeRecord.date,
        sourceSlotId: activeRecord.slotId,
        sourceSegmentKey: activeRecord.segmentKey,
        machineState: packet.state,
        state: humanReview.overallState,
        humanState: humanReview.state,
        metrics: { ...packet.metrics, humanCompleted: humanReview.doubleReviewed },
        humanReview,
        queue: reviewQueue
      };
      const qualityReviewSummaries = store.listEditorialReviewPackets().map((record) => ({
        editionId: record.editionId,
        ...summarizeHumanReview(
          record.packet,
          store.getEditorialReview(record.packetId, record.editionId)
        )
      }));
      const value = {
        stableId: "NOWHOT-LOCAL-EDITORIAL-EDITION-001",
        state: edition.publishable && fixture && fixture.state === "machine_observation_ready"
          && edition.categoryFulfillment && edition.categoryFulfillment.goalSatisfied
          ? "local_candidate_ready" : "local_candidate_with_limits",
        observedAt: edition.generatedAt,
        route: "/",
        api: "/api/today",
        featureFlag: "NOWHOT_LOCAL_EDITORIAL=1",
        llmCalls: edition.llmCalls,
        preview: {
          issueCount: edition.issues.length,
          sectionCount: edition.sections.length,
          sourceCount: edition.sourceCount,
          itemCount: edition.itemCount,
          publishable: edition.publishable,
          selectedCategoryCount: edition.selection && edition.selection.categories.length || 0,
          maxIssues: edition.selection && edition.selection.maxIssues || 0,
          minIssuesPerCategory: edition.selection && edition.selection.minIssuesPerCategory || 0
        },
        editorialQuality: edition.editorialQuality || null,
        categoryFulfillment: edition.categoryFulfillment || null,
        servingGate: {
          contractId: EDITORIAL_SERVING_CONTRACT.stableId,
          contractVersion: EDITORIAL_SERVING_CONTRACT.version,
          state: servingAssessment.state,
          pass: servingAssessment.pass,
          responsePacketId: servingAssessment.packetId,
          editionId: servingAssessment.editionId,
          failures: servingAssessment.failures,
          metrics: servingAssessment.metrics,
          readerDiversity: servingAssessment.packet && servingAssessment.packet.readerDiversity || null,
          fulfillment: servingAssessment.fulfillment,
          humanReviewRequired: EDITORIAL_SERVING_CONTRACT.humanReviewRequired,
          verificationCount: servingVerifications.length,
          latestVerification: latestServingVerification ? {
            packetId: latestServingVerification.packetId,
            editionId: latestServingVerification.editionId,
            date: latestServingVerification.date,
            slotId: latestServingVerification.slotId,
            segmentKey: latestServingVerification.segmentKey,
            categories: latestServingVerification.categories,
            verifiedAt: latestServingVerification.verifiedAt,
            savedAt: latestServingVerification.savedAt
          } : null,
          fallbackRule: EDITORIAL_SERVING_CONTRACT.fallbackRule,
          doesNotProve: "사람 편집 품질 PASS·기사 사실성·운영 배포 가능"
        },
        personalization: edition.personalization || null,
        editorialLineage: (() => {
          const receipts = edition.issues.map((issue) => verifyEditorialLineage(issue));
          const sourceEvidence = edition.issues.flatMap((issue) => issue.sourceEvidence || []);
          const sourceRoles = {};
          const ownershipBases = {};
          for (const row of sourceEvidence) {
            const role = row.sourceRole || "unknown";
            const basis = row.ownershipBasis || "unknown";
            sourceRoles[role] = (sourceRoles[role] || 0) + 1;
            ownershipBases[basis] = (ownershipBases[basis] || 0) + 1;
          }
          const passCount = receipts.filter((receipt) => receipt.pass).length;
          return {
            contractId: "NOWHOT-EDITORIAL-LINEAGE-CONTRACT-001",
            state: passCount === receipts.length ? "machine_lineage_pass" : "machine_lineage_hold",
            issueCount: receipts.length,
            passCount,
            holdCount: receipts.length - passCount,
            sourceEvidenceCount: sourceEvidence.length,
            sourceRoles,
            ownershipBases,
            failures: receipts.flatMap((receipt) => receipt.failures || []),
            proves: "판본 문장별 원문·측정·개인 선택·편집 판단의 기계 계보",
            doesNotProve: "원문 사실의 진실성·사람 검수 PASS·운영 배포"
          };
        })(),
        editorialLlm: normalizedEditorialLlmReceipt(edition.editorialLlm),
        llmCanary: readLocalEditorialCanaryReceipt(),
        editionChange: edition.editionChange || null,
        inventory: inventory || localInventoryReceipt,
        elapsedEvidence: localElapsedReceipt,
        reliabilityHistory: buildEditorialReliabilityHistory(
          store.allEditorialSlotObservations(),
          { nowMs: serverNowMs() }
        ),
        qualityHistory: buildEditorialQualityHistory(
          store.allEditorialEditions(),
          { nowMs: serverNowMs(), reviewSummaries: qualityReviewSummaries }
        ),
        qualityReviewSampling: localQualityReviewSamplingReceipt,
        scheduler: localEditorialSchedulerStatus(),
        editionReplay,
        reviewPacket,
        fixture
      };
      localEditorialEvidenceCache.value = value;
      localEditorialEvidenceCache.at = Date.now();
      return value;
    })().finally(() => { localEditorialEvidenceCache.pending = null; });
    return localEditorialEvidenceCache.pending;
  }

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
  // 관심사(구글 급상승 검색어)를 엔진에 주입한다. 브리핑이 "지금 사람들이
  // 실제로 검색하는 것"을 한 축으로 쓰게 만든다(David 2026-08-05).
  // 20분 캐시라 남의 서버를 자주 두드리지 않는다.
  engine._interestsFn = makeInterestsCache();
  engine._translateText = translateText;

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
      indexNow.ping(["/", "/report"]).catch(() => {});
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
  // 광고 문구 행렬. 배치가 파일을 새로 쓰면 다음 기동 때 반영된다.
  const adMatrix = loadMatrix();
  if (adMatrix) {
    const n = Object.values(adMatrix.variants || {})
      .reduce((a, ctxs) => a + Object.values(ctxs).reduce((b, arr) => b + arr.length, 0), 0);
    console.log(`[admatrix] 문구 ${n}개 로드 (${adMatrix.generatedAt})`);
  }

  const COUPANG_DISCLOSURE = AD_DISCLOSURE;
  // 심사 모드는 편집 지면의 AdFit 배치만 결정한다.
  // /live의 기존 쿠팡 제휴 링크는 이 모드와 독립적으로 제공한다.
  const adfitReviewMode = () =>
    process.env.ADFIT_ENABLED === "1" && Boolean(process.env.ADFIT_UNIT_MOBILE);
  // pick — 회전 인덱스. 예전엔 인자를 안 넘겨 pick=0으로 고정됐고, 그래서
  // 32장 재고가 있어도 **모든 방문자가 매 페이지에서 같은 배너 한 장**을 봤다
  // (2026-08-03 검수 실측: /briefing·/trends·/ranking 전부 tech 배너).
  // size도 이미지 시대의 유물이다 — 크리에이티브를 우리가 그리므로 배너의
  // 픽셀 크기는 의미가 없고, 필터로 두면 재고만 절반으로 자른다.
  // 한 페이지 안에서 같은 상품이 두 번 나오지 않게 하려면 **누가 이미
  // 나갔는지**를 알아야 한다. pickBanner는 진작 seen을 받게 돼 있었는데
  // 여기서 한 번도 넘기지 않았다 — 그래서 브리핑에 같은 광고가 둘 나왔다
  // (David 제보 2026-08-06). 페이지마다 adPage()로 하나 만들어 쓴다.
  // 방문 순번. 페이지를 그릴 때마다 하나씩 올린다. 난수를 안 쓰는 이유는
  // 난수가 같은 것을 연달아 뽑는 일이 잦기 때문이다 — 순번은 반드시 한 바퀴 돈다.
  let adTurn = 0;
  const adPage = (eligible = true) => {
    if (!eligible || adfitReviewMode()) return () => "";
    adTurn = (adTurn + 1) % 997;      // 소수 — 문구 개수와 주기가 맞물리지 않게
    const seen = new Set();
    return (category, size = null, pick = 0, slot = "page", dest = null) =>
      coupangBannerHtml(category, size, pick, slot, dest, seen);
  };

  // 데이터 리포트도 **요청 밖에서** 만든다.
  //
  // buildReport는 풀 원시행 수천 건과 저장된 에디션 전부를 훑는 동기 계산이다.
  // 홈이 정확히 같은 이유로 TTFB 4초였고(현지 제보 2026-08-06), 그 교훈을
  // 확정 표에 "홈 SSR seed는 요청 밖에서 만든다"로 못 박았다. 새 페이지를
  // 만들면서 같은 실수를 되풀이하지 않는다.
  //
  // 리포트는 하루 단위 데이터라 10분 낡아도 아무 문제가 없다. 빈 결과는
  // 성공으로 치지 않는다 — 그러면 "아직 안 모였습니다"가 10분 동안 굳는다.
  const REPORT_TTL_MS = 10 * 60 * 1000;
  const REPORT_RETRY_MS = 30 * 1000;
  const reportCache = { data: null, at: 0, building: false };
  const buildReportNow = () => {
    const editions = store.listEditionDates()
      .map((d) => ({ date: d, ...(store.getDailyEdition(d) || {}) }));
    const rows = engine.poolRows ? engine.poolRows() : [];
    return buildReport({ editions, rows });
  };
  const reportNow = () => {
    const cached = reportCache.data;
    // **첫 한 번만 기다린다.** 배경으로만 만들면 프로세스가 뜬 직후 들어온
    // 첫 방문자 — 하필 심사 봇일 수 있다 — 에게 "아직 안 모였습니다"가
    // 나간다. 이 페이지의 존재 이유를 생각하면 그건 4초 기다림보다 나쁘다.
    // 한 번 만들고 나면 그 뒤로는 아무도 안 기다린다.
    if (!cached) {
      try {
        reportCache.data = buildReportNow();
        reportCache.at = Date.now();
      } catch { /* 다음 요청이 다시 시도한다 */ }
      return reportCache.data;
    }
    if (reportStale()) scheduleReportRefresh();
    return cached;
  };
  const reportStale = () => {
    const cached = reportCache.data;
    if (!cached) return false;
    const ttl = cached.publishable ? REPORT_TTL_MS : REPORT_RETRY_MS;
    return Date.now() - reportCache.at > ttl;
  };
  // 갱신은 응답 뒤로 민다 — 지금 요청은 있는 것으로 답한다. /report와
  // 리포트 요청은 같은 캐시 갱신을 공유한다.
  const scheduleReportRefresh = () => {
    if (reportCache.building) return;
    reportCache.building = true;
    setImmediate(() => {
      try {
        reportCache.data = buildReportNow();
        reportCache.at = Date.now();
      } catch { /* 다음 요청이 다시 시도한다 */ }
      finally { reportCache.building = false; }
    });
  };

  // 부팅 90초 뒤 리포트 캐시를 백그라운드로 한 번 데워 둔다 — 이 배포
  // 체계(하루 십수 회)는 재시작마다 캐시가 콜드라, 워밍 없이는 /report에
  // 누가 들어올 때까지 홈의 리포트 한 줄이 계속 비어 있게 된다. 90초는
  // 첫 수집(소스별 데드라인 45초)이 끝난 뒤라는 뜻의 여유값. 동기 빌드가
  // 도는 그 순간만큼은 이벤트 루프가 서므로 "공짜"는 아니고, /report 콜드
  // 방문이 치르는 것과 같은 값을 한 번 미리 치르는 것이다. 실패해도 다음
  // /report 방문이나 홈의 낡음 갱신이 다시 시도한다.
  const reportWarm = setTimeout(() => {
    if (reportCache.data) return;
    try {
      reportCache.data = buildReportNow();
      reportCache.at = Date.now();
    } catch { /* 다음 방문이 다시 시도 */ }
  }, 90 * 1000);
  if (reportWarm.unref) reportWarm.unref();

  // 방문자 쿠키를 아무 페이지에서나 심는다.
  //
  // 이게 없으면 검색으로 발행 페이지에 도착한 사람이 다음에 또 와도
  // 처음 보는 사람이 된다 — 취향도 재방문도 거기서 끊긴다.
  // 계정을 만들지는 않는다(빈 계정이 늘지 않게). 식별자만 준다.
  // 사람이 읽는 발행 페이지들. 여기 들른 사람도 다음에 알아봐야 한다.
  const PUBLISHED_PATH = /^\/(ranking|report|communities|community|keywords|keyword|trends)(\/|$)/;

  const ensureVisitor = (req, res) => {
    const existing = parseCookies(req.headers.cookie)[VISITOR_COOKIE];
    if (existing) return { vid: existing, isNew: false };
    const vid = randomUUID().replace(/-/g, "");
    const prev = res.getHeader("set-cookie");
    const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
    list.push(serializeVisitorCookie(vid, { secure: isSecureRequest(req) }));
    res.setHeader("set-cookie", list);
    return { vid, isNew: true };
  };

  // 우리가 실제로 그리는 자리 이름. 새 자리를 만들면 여기에도 더한다 —
  // 안 더하면 그 자리 성과가 "unknown"으로 뭉쳐 보이므로 곧바로 눈에 띈다.
  const KNOWN_AD_SLOT = /^(page_bot|brief_mid|brief_s\d{1,2}|archive_(mid|bot)|briefcat_(mid|bot)|communities(_bot)?|community_(mid|bot)|keywords(_bot)?|keyword_(mid|bot)|rank_mid|trends_mid|report_(mid|bot)|feed\d{1,3}|feed-passback)$/;

  // 아주 가벼운 분당 상한. 디스크를 안 건드리는 O(1) 카운터라 요청을 막지 않는다.
  // 사람이 한 화면에서 낼 수 있는 광고 신호는 많아야 수십 건이다.
  const AD_SIGNAL_PER_MIN = 120;
  const adSignalHits = new Map();   // ip -> { minute, n }
  const adSignalAllowed = (req) => {
    // XFF 마지막 토큰 — makeIpRateLimiter와 같은 이유(첫 토큰은 위조 자유).
    const xffA = String(req.headers["x-forwarded-for"] || "").split(",");
    const ip = (xffA[xffA.length - 1] || "").trim() ||
      (req.socket && req.socket.remoteAddress) || "?";
    const minute = Math.floor(Date.now() / 60000);
    const cur = adSignalHits.get(ip);
    if (!cur || cur.minute !== minute) {
      // 분이 바뀌면 통째로 비운다 — 맵이 무한히 자라지 않게.
      if (adSignalHits.size > 5000) adSignalHits.clear();
      adSignalHits.set(ip, { minute, n: 1 });
      return true;
    }
    cur.n += 1;
    return cur.n <= AD_SIGNAL_PER_MIN;
  };

  // 같은 골격을 재사용한 IP 분당 상한 (Phase 1, 2026-08-09 — 관리자 분석
  // 재설계 적대적 검수 REVISE #3·#4). adSignalAllowed와 상태를 공유하지
  // 않는다 — 예산이 다른 자리(설문/이력 생성 vs 행동 이벤트 배치)라 서로의
  // 트래픽에 영향을 주면 안 된다.
  const makeIpRateLimiter = (perMin) => {
    const hits = new Map(); // ip -> { minute, n }
    return (req) => {
      // XFF는 **마지막** 토큰을 쓴다 — 우리 앞단 Caddy가 실제 접속 IP를 뒤에
      // 붙이므로 마지막이 신뢰값이고, 첫 토큰은 클라이언트가 마음대로 미리
      // 붙일 수 있어 요청마다 바꾸면 상한이 무력화된다(검수 2026-08-09 P1).
      const xff = String(req.headers["x-forwarded-for"] || "").split(",");
      const ip = (xff[xff.length - 1] || "").trim() ||
        (req.socket && req.socket.remoteAddress) || "?";
      const minute = Math.floor(Date.now() / 60000);
      const cur = hits.get(ip);
      if (!cur || cur.minute !== minute) {
        if (hits.size > 5000) hits.clear();
        hits.set(ip, { minute, n: 1 });
        return true;
      }
      cur.n += 1;
      return cur.n <= perMin;
    };
  };
  // /api/survey·/api/history — 무인증 createUser+저장을 매 요청 반복할 수
  // 있는 자리라, 사람이 낼 수 없는 빈도만 자른다(정상 온보딩은 세션당 1회).
  const surveyOrHistoryAllowed = makeIpRateLimiter(20);
  // /api/track — sendBeacon 배치라 ad-signal과 같은 예산을 쓴다(한 화면
  // 체류 동안 view/click/exit 몇 건이 뭉쳐서 온다).
  const trackAllowed = makeIpRateLimiter(AD_SIGNAL_PER_MIN);
  // /api/session — uid 대량 발급이 "사람" 지표 부풀리기의 출발점이라(검수
  // P1) 사람이 낼 수 없는 빈도만 자른다. 정상 사용은 브라우저당 방문 시
  // 1회 수준이고, 통신사 공유 IP(CGNAT)를 고려해 넉넉히 둔다.
  const sessionAllowed = makeIpRateLimiter(60);

  const coupangBannerHtml = (category, size = null, pick = 0, slot = "page", dest = null, seen = null) => {
    const b = pickBanner({ category, dest, size, pick, seen: seen || new Set() });
    if (!b) return "";
    if (seen) seen.add(b.id);
    // 맥락별 문구 행렬에서 고른다. 행렬이 없으면 ad-copy.js 기본 문구로
    // 떨어진다 — 배치가 실패해도 광고가 사라지지 않는다.
    // 문구 회전값. pick은 자리마다 고정이라 **같은 자리엔 늘 같은 문장**이
    // 나왔다 — 270개를 만들어 두고 몇 개만 돌려쓴 셈이다(David 2026-08-06).
    // 자리 번호에 방문 순번을 더해 골고루 돈다. 난수가 아니라 순번이라
    // 뭉치지 않고 전부가 균등하게 나온다.
    const v = pickVariant(b.dest, category, { matrix: adMatrix, rotate: pick + adTurn });
    // 줄(line)은 게시글의 발췌 자리에 해당한다 — 제목만 있고 본문이 없으면
    // 게시글로 안 읽힌다(David 2026-08-05). 옛 행렬이면 도착지 이름이 온다.
    const hook = v.hook, brand = v.line || v.brand;
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
    return `<aside class="ad-slot ad-coupang" data-slot="${escapeHtml(slot)}">
      <p class="ad-mark"><span class="ad-tag">AD</span> 쿠팡 파트너스</p>
      <a class="ad-native" href="${escapeHtml(withSubId(b.href, `${slot}~${v.variant}`))}" target="_blank" rel="nofollow sponsored noopener" referrerpolicy="unsafe-url">
        <span class="go-row">
          <span class="go-text">
            <b>${escapeHtml(hook)}</b><span class="go-line">${escapeHtml(brand)}</span>
            <span class="ad-go">${escapeHtml(v.cta || "보러 가기")}</span>
          </span>
          <span class="go-thumb"><img class="go-img" src="${escapeHtml(b.img)}" width="${escapeHtml(w)}" height="${escapeHtml(h)}"
             alt="${escapeHtml(brand)}" loading="eager" fetchpriority="high" onerror="this.parentNode.remove()"></span>
        </span></a>
      <p class="ad-disclosure">${COUPANG_DISCLOSURE}</p></aside>`;
  };

  const displayAdHtml = () => {
    const adsense = process.env.ADSENSE_CLIENT;
    const adfitUnit = process.env.ADFIT_UNIT_MOBILE;
    if (adfitReviewMode()) {
      return `<div class="ad-slot"><span class="ad-mark">AD</span>
        <ins class="kakao_ad_area" style="display:none;" data-ad-unit="${escapeHtml(adfitUnit)}" data-ad-width="320" data-ad-height="100"></ins></div>`;
    }
    if (adsense) {
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
  const adLoadersHtml = (eligible) => {
    if (!eligible) return "";
    if (adfitReviewMode()) {
      return `<script async src="https://t1.kakaocdn.net/kas/static/ba.min.js"></script>`;
    }
    if (process.env.ADSENSE_CLIENT) {
      return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeHtml(process.env.ADSENSE_CLIENT)}" crossorigin="anonymous"></script>`;
    }
    return "";
  };

  // 자체 콘텐츠 페이지의 검색 노출용 공통 머리. canonical·og:image가 없으면
  // 같은 내용이 여러 주소로 인식되거나 공유 카드가 비어 나간다.
  // noindex: 페이지는 그대로 열리되 검색 색인만 막는다. 알맹이가 얇은 페이지를
  // 대량으로 색인시키면 사이트 전체 품질 평가가 그쪽으로 끌려간다
  // (2026-08-04 검색 품질 검수: 키워드 43개 중 28개가 수록 글 4건 이하).
  // 발행 페이지 광고 계측 (2026-08-06).
  //
  // 여기 배너가 페이지마다 두 장씩 나가는데 **노출·클릭을 한 줄도 세지 않고
  // 있었다.** 쿠팡 콘솔에는 subId로 남지만 우리 관리자 화면에는 0이라,
  // 어느 자리가 돈이 되는지 우리 손으로 판단할 방법이 없었다.
  // 블루프린트 대목적의 첫 문장이 "알고리즘보다 측정과 구매 의도가 먼저다"인데
  // 정작 발행 페이지가 측정 밖에 있었다.
  //
  // 앱 화면과 **같은 API**로 보낸다(/api/ad-signal). 세는 곳이 둘로 갈리면
  // 언젠가 숫자가 어긋난다. 자리 이름(slot)은 배너를 그릴 때 이미 정해 둔 값이라
  // data 속성으로 내려보내기만 하면 된다.
  const adTrackScript = `<script>
(function(){
  var seen = {};
  function send(type, slot){
    if(!slot) return;
    if(type === "impression"){ if(seen[slot]) return; seen[slot] = 1; }
    var body = JSON.stringify({ type: type, slot: slot, page: location.pathname });
    try {
      if(navigator.sendBeacon){
        navigator.sendBeacon("/api/ad-signal", new Blob([body], {type:"application/json"}));
        return;
      }
    } catch(e){}
    try { fetch("/api/ad-signal", {method:"POST", headers:{"content-type":"application/json"}, body: body, keepalive: true}); } catch(e){}
  }
  function wire(){
    var slots = document.querySelectorAll("aside.ad-slot[data-slot]");
    for(var i=0;i<slots.length;i++){
      (function(el){
        var slot = el.getAttribute("data-slot");
        var a = el.querySelector("a.ad-native");
        if(a) a.addEventListener("click", function(){ send("click", slot); });
        if(window.IntersectionObserver){
          var io = new IntersectionObserver(function(es){
            for(var k=0;k<es.length;k++) if(es[k].isIntersecting){ send("impression", slot); io.disconnect(); }
          }, { threshold: 0.5 });
          io.observe(el);
        } else { send("impression", slot); }
      })(slots[i]);
    }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
</script>`;

  const editionShell = (title, desc, inner, canonicalPath = "", ownLinks = "", coupangBanner = "", noindex = false) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
${process.env.ADSENSE_CLIENT ? `<meta name="google-adsense-account" content="${escapeHtml(process.env.ADSENSE_CLIENT)}">` : ""}
<meta name="naver-site-verification" content="0d469593c15f0aca6694a0eac43985579c104a4d">
${noindex
  ? '<meta name="robots" content="noindex,follow">'
  // 자체 콘텐츠 페이지(브리핑·랭킹·커뮤니티순위)가 정작 Discover가 가장
  // 필요한 쪽인데 이 줄이 공유 페이지에만 들어가 있었다(2026-08-04 배포 후 실측).
  : '<meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1">'}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(canonicalPath === "/" ? title : `${title} — 지금핫 NowHot`)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:title" content="${escapeHtml(canonicalPath === "/" ? title : `${title} — 지금핫 NowHot`)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="지금핫 NowHot">
<meta property="og:image" content="https://nowhot.kr/og.png?v=20260904-brand">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": canonicalPath === "/" ? "WebSite" : "CollectionPage",
  name: canonicalPath === "/" ? "지금핫 NowHot" : title,
  description: desc,
  ...(canonicalPath === "/" ? { url: "https://nowhot.kr/" } : {}),
  inLanguage: "ko",
  isPartOf: { "@type": "WebSite", name: "지금핫 NowHot", url: "https://nowhot.kr/" },
  publisher: { "@type": "Organization", name: "페퍼클럽", url: "https://nowhot.kr/" }
})}</script>
${canonicalPath ? `<link rel="canonical" href="https://nowhot.kr${escapeHtml(canonicalPath)}">
<meta property="og:url" content="https://nowhot.kr${escapeHtml(canonicalPath)}">` : ""}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&display=swap" rel="stylesheet">
<style>${CHART_CSS}/* Modernist 스킨 (NowHot.dc, 2026-08-01) — 라이트 기본, OS 다크 추종 */
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
/* 순위 번호는 CSS 카운터로 그린다. 그런데 목록이 광고 때문에 여러 <ol>로
   쪼개지면 카운터가 <ol>마다 1로 되돌아간다 — David 실측 "제목 앞 숫자가
   계속 1부터 반복됨". <li value>와 <ol start>는 이미 정확했지만
   list-style:none + counter 조합에서는 그 값들이 무시된다.
   그래서 각 <ol>이 자기 start 값에서 이어지도록 인라인으로 카운터를 세운다
   (--rank-start는 서버가 심는다). */
/* 오늘의 편성 레일 — 슬롯 이름만 나열하면 무엇인지 알 수 없다.
   발행 시각과 그 편의 성격을 함께 보여주고, 발행된 편은 눌러 갈 수 있게 한다. */
.slot-rail{display:flex;gap:8px;margin:16px 0 20px;flex-wrap:wrap}
.slot-item{display:flex;flex-direction:column;gap:2px;min-width:140px;flex:1 1 140px;
  border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--text)}
.slot-item b{font-size:14px}
.slot-item .t{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.slot-item .d{font-size:12px;color:var(--muted);line-height:1.4}
.slot-item.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.slot-item.on b{color:var(--accent)}
.slot-item.pending{opacity:.55}
a.slot-item:hover,a.slot-item:focus-visible{border-color:var(--accent)}
.muted.small{font-size:12.5px}
.day-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0 6px;font-size:14px}
.day-nav a{color:var(--accent);text-decoration:none;font-weight:700}
.day-cur{font-weight:800}
.slot-nav{display:flex;gap:8px;margin:6px 0 14px}
.slot-nav a{font-size:13px;font-weight:700;color:var(--muted);text-decoration:none;
  border:1px solid var(--line);border-radius:999px;padding:5px 12px}
.slot-nav a.on{color:var(--accent);border-color:var(--accent)}
ol.rank{padding-left:0;margin:14px 0;list-style:none;counter-reset:r var(--rank-start,0);border-top:2px solid var(--divider)}
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
/* 제목 왼쪽 · 정사각 썸네일 오른쪽 — 앱 카드와 같은 규격.
   예전엔 가로 배너를 카드 폭 전체에 깔아서 광고만 혼자 다른 모양이었다. */
.ad-native .go-row{display:flex;gap:12px;align-items:flex-start}
.ad-native .go-text{flex:1 1 auto;min-width:0;display:block}
.ad-native .go-thumb{flex:0 0 auto;width:76px;height:76px;border-radius:10px;
  overflow:hidden;border:1px solid var(--line);display:block}
.ad-native .go-thumb .go-img{width:100%;height:100%;object-fit:cover;display:block}
.ad-native b{display:block;font-size:17px;line-height:1.35;margin-bottom:3px}
.ad-native .go-line{display:block;font-size:13px;color:var(--muted)}
.ad-native .ad-go{display:block;margin-top:8px;font-size:14px;font-weight:800;color:var(--text)}
/* 대가성 고지문 — 법으로 표시해야 하는 문장이다. 여기만 --muted를 쓰지 않는다.
   실측(2026-08-05): --muted는 흰 배경에서 #848383, 대비 3.78:1로 AA(4.5) 미달이었다.
   11.5px 작은 글씨까지 겹쳐서, 하필 반드시 보여야 하는 문장이 이 페이지에서 가장
   안 보이는 글자였다. David의 시인성 수정(2026-08-02)이 앱에만 들어가고 여기는
   빠진 결과다. 본문색을 그대로 쓰고 크기를 올린다. */
.ad-disclosure{margin:10px 0 0;padding-top:9px;border-top:1px solid var(--line);
  font-size:13px;line-height:1.6;color:var(--text)}
.home-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:30px;border-bottom:2px solid var(--divider);padding-bottom:14px}
.home-brand{font:800 18px/1 "Archivo",sans-serif;color:var(--text)}
.home-live{font-size:13px;font-weight:800}.home-actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 28px}
.home-actions a{display:inline-flex;align-items:center;min-height:42px;padding:8px 14px;border:1px solid var(--divider);font-weight:800;color:var(--text)}
.home-actions a.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.home-kicker{font-size:12px;font-weight:800;color:var(--accent);margin:0 0 6px}.home-lead{font-size:17px;line-height:1.65;margin:10px 0 0}
</style>${adLoadersHtml(!noindex)}</head><body><div class="wrap">
${canonicalPath === "/" ? '<header class="home-head"><a class="home-brand" href="/">지금핫</a><a class="home-live" href="/live">실시간 피드 →</a></header>' : '<a class="back" href="/">← 지금핫 홈</a>'}
${inner}
${coupangBanner}
${ownLinks}
${noindex ? "" : displayAdHtml()}
<p class="muted">이 페이지는 지금핫 NowHot이 수집한 공개 반응 지표(추천·댓글·보도량)만으로 작성한 자체 편집 콘텐츠입니다. 각 글의 전문은 출처에서 읽을 수 있습니다. ⓒ 페퍼클럽</p>
</div>${pageTracker()}${adTrackScript}</body></html>`;
  // ── 발행 페이지 방문 측정 (2026-08-05 전수검사)
  //
  // 브리핑·화제랭킹·커뮤니티별·키워드는 사이트맵에 올리고 IndexNow로 통보하고
  // RSS까지 내보내는 **검색 유입의 착지점**인데, 방문자를 세는 코드가 한 줄도
  // 없었다. 분석 계층(analytics.js)에는 이미 그 라벨들이 준비돼 있었는데
  // 이벤트가 도착한 적이 없어 **영원히 0**이었다.
  //
  // 그래서 "광고를 고쳐도 좋아졌는지 확인할 방법이 없다"가 성립했다.
  // 애드센스 심사 문서가 지목한 유일한 지연 사유도 "코드를 삽입한 페이지에서
  // 정기적인 조회가 발생하지 않는 경우"다 — 그 조회를 우리가 못 세고 있었다.
  //
  // 앱과 같은 /api/track 을 쓴다. 보내는 것은 앱과 동일하게 **유입 도메인,
  // 화면 종류, 체류 시간**뿐이다 — 제목이나 URL 자체는 보내지 않는다.
  const pageTracker = () => `<script>
(function(){
  var t0=Date.now(), sent=false;
  function send(evs, beacon){
    var body=JSON.stringify({userId:null, events:evs});
    if(beacon && navigator.sendBeacon){
      try{ navigator.sendBeacon("/api/track", new Blob([body],{type:"application/json"})); return; }catch(e){}
    }
    fetch("/api/track",{method:"POST",headers:{"content-type":"application/json"},body:body,keepalive:true}).catch(function(){});
  }
  send([{type:"view", entry:true, path:location.pathname, referrer:document.referrer||"", params:location.search||""}], false);
  function bye(){
    if(sent) return; sent=true;
    send([{type:"exit", path:location.pathname, dwellMs:Date.now()-t0}], true);
  }
  addEventListener("pagehide", bye);
  addEventListener("visibilitychange", function(){ if(document.visibilityState==="hidden") bye(); });
})();
</script>`;

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
    // 검색 급상승과 이어진 글이면 그 사실을 밝힌다 (David 2026-08-05).
    // 이게 브리핑에서 순위를 바꾸는 새 축이므로, 바꿔 놓고 말하지 않으면
    // 우리도 왜 그 글이 위에 있는지 설명하지 못한다. 검색량은 구글이
    // 자릿수만 대략 주므로 "500+"처럼 그대로 옮긴다 — 정확한 값인 척하지 않는다.
    if (i.interest && i.interest.term) {
      bits.push(i.interest.traffic > 0
        ? `검색 급상승 ${i.interest.term} ${fmtNum(i.interest.traffic)}+`
        : `검색 급상승 ${i.interest.term}`);
    }
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
    return `<li value="${n}"><div><a href="${livePostHref(i)}">${escapeHtml(maskProfanity(i.title))}</a>
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
  // mid는 문자열이거나 **바로 위 글을 받는 함수**다. 함수로 주면 광고 문구를
  // 그 자리의 글에 맞출 수 있다 — "근처 콘텐츠 제목·내용이랑 맞는 걸로"
  // (David 2026-08-06). 문자열도 계속 받는다.
  const rankingRows = (items, mid = "") => {
    let placed = false;
    return RANK_BANDS.map((b) => {
      const slice = items.slice(b.from - 1, b.to);
      if (!slice.length) return "";
      const html = `<section><h2>${escapeHtml(b.label)}</h2>
      <ol class="rank" start="${b.from}" style="--rank-start:${b.from - 1}">${slice.map((i, k) => rankRow(i, b.from + k)).join("")}</ol></section>`;
      if (mid && !placed) {
        placed = true;
        const above = slice[slice.length - 1];
        const ad = typeof mid === "function" ? mid(above) : mid;
        return html + (ad || "");
      }
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
  const ownContentNav = (current = "") => {
    const links = [
      { href: "/", label: "오늘판" },
      { href: "/ranking/daily", label: "화제 랭킹" },
      { href: "/trends", label: "실시간 트렌드" },
      { href: "/communities", label: "커뮤니티 순위" },
      { href: "/keywords", label: "화제 키워드" },
      { href: "/report", label: "데이터 리포트" },
    ].filter((l) => l.href !== current);
    return `<nav class="own-links" aria-label="지금핫이 만든 다른 콘텐츠">
      <h2>다른 콘텐츠 보기</h2>
      <ul>${links.map((l) => `<li><a href="${l.href}">${escapeHtml(l.label)}</a></li>`).join("")}</ul>
    </nav>`;
  };

  const rankingNav = (active) => `<div class="nav">
    <a href="/ranking/daily" class="${active === "daily" ? "on" : ""}">일간</a>
    <a href="/ranking/weekly" class="${active === "weekly" ? "on" : ""}">주간</a>
    <a href="/ranking/monthly" class="${active === "monthly" ? "on" : ""}">월간</a>
    <a href="/">오늘판</a></div>`;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    // 사람이 보는 화면이면 **어디서든** 기기 표식을 심는다. 라우트 분기보다
    // 앞이어야 한다 — 처음엔 정적 파일 서빙 직전에 뒀는데, /briefing 같은
    // 발행 페이지는 그보다 위에서 응답하고 끝나 표식이 안 심겼다(로컬 실측).
    //
    // 이게 없으면 검색으로 발행 페이지에 도착해 읽고 나간 사람이 다음에 또 와도
    // 처음 보는 사람이 된다 — 취향도 재방문도 거기서 끊긴다.
    // 계정을 만들지는 않는다(빈 계정이 늘지 않게). 표식만 준다.
    if (req.method === "GET" && !p.startsWith("/api/") &&
        (p === "/" || p === "/live" || p === "/index.html" || PUBLISHED_PATH.test(p))) {
      try { ensureVisitor(req, res); } catch {}
    }

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
      // ── 이 요청이 정말 그 사람인가 (2026-08-05 전수검사 P0)
      //
      // 예전에는 라우트들이 `store.getUser(body.userId)`만 확인했다. 그건
      // "이 사용자가 존재하는가"이지 "당신이 그 사람인가"가 아니다.
      // 순번 ID(user_1, user_2 …)와 겹쳐서, 아무나 남의 내 공간을 읽고 그
      // 이름으로 글을 쓸 수 있었다 — 라이브에서 재현했다.
      //
      // 판정 순서: 로그인 세션 > 기기 결속 > (처음 보는 짝이면) 결속하고 통과.
      // 어긋나면 403. 자세한 근거는 store.bindDevice의 주석에 있다.
      const ownerOf = (claimedId) => {
        if (!claimedId) return { ok: false, status: 400, error: "userId required" };
        const cookies = parseCookies(req.headers.cookie);
        const sessionUserId = cookies[SESSION_COOKIE] ? store.sessionUser(cookies[SESSION_COOKIE]) : null;
        if (sessionUserId) {
          // 로그인한 사람은 자기 계정만 만질 수 있다.
          if (sessionUserId !== claimedId) return { ok: false, status: 403, error: "not your account" };
          return { ok: true, userId: sessionUserId };
        }
        const claimed = store.getUser(claimedId);
        if (!claimed) return { ok: false, status: 400, error: "unknown user" };
        const key = cookies[KEY_COOKIE] || null;

        // **첫 결속은 그 계정의 기기 쿠키를 들고 온 요청만 할 수 있다.**
        // (적대적 검수 2026-08-06 P0 — 재현 확인)
        //
        // 예전에는 아직 열쇠가 없는 계정이면 **아무 열쇠나** 첫 주장을 이겼다.
        // userId는 공개 응답에 평문으로 나가고 있었으므로, 공격자가 남의
        // userId로 쓰기 요청을 한 번 보내면 자기 열쇠가 그 계정에 박히고
        // 진짜 주인은 영구 403이 됐다. 경쟁조차 필요 없는 결정적 탈취였다.
        //
        // 기기 쿠키(nh_cid)는 그 계정을 발급받은 브라우저에만 있다. 공격자는
        // 자기 계정의 쿠키를 들고 있으므로 남의 계정 id를 주장하면 어긋난다.
        //
        // 쿠키를 아예 못 쓰는 클라이언트는 열쇠도 없으므로 이 분기에 걸리지
        // 않는다 — 예전처럼 통과한다. 막으려는 것은 "열쇠는 있는데 남의 id를
        // 주장하는" 요청뿐이다.
        if (!claimed.deviceKey && key) {
          const deviceId = cookies[DEVICE_COOKIE] || null;
          if (deviceId !== claimedId) {
            return { ok: false, status: 403, error: "not your account" };
          }
        }

        if (!store.bindDevice(claimedId, key)) {
          return { ok: false, status: 403, error: "not your account" };
        }
        return { ok: true, userId: claimedId };
      };
      // 라우트에서 한 줄로 쓰기 위한 래퍼 — 거절이면 응답까지 보내고 true를 준다.
      const denied = (claimedId) => {
        const r = ownerOf(claimedId);
        if (r.ok) return false;
        send(res, r.status, { error: r.error });
        return true;
      };

      if (p === "/api/feedback" && req.method === "POST") {
        if ((req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
          return send(res, 415, { error: "JSON 요청이 필요합니다." });
        }
        if (req.headers["sec-fetch-site"] === "cross-site" ||
            (req.headers.origin && req.headers.origin !== originOf(req))) {
          return send(res, 403, { error: "지금핫 화면에서 다시 보내 주세요." });
        }
        const cookies = parseCookies(req.headers.cookie);
        if (!(cookies[SESSION_COOKIE] && store.sessionUser(cookies[SESSION_COOKIE])) &&
            !(cookies[DEVICE_COOKIE] && cookies[KEY_COOKIE])) {
          return send(res, 403, { error: "화면을 새로고침한 뒤 다시 보내 주세요." });
        }
        let body;
        try { body = await readBody(req); } catch { return send(res, 400, { error: "요청 내용을 읽지 못했어요." }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "요청 내용을 확인해 주세요." });
        try {
          if (denied(body.userId)) return;
          const record = store.addServiceFeedback(body.userId, { kind: body.kind, message: body.message, requestId: body.requestId, build: buildId() });
          return send(res, 201, { ok: true, id: record.id, createdAt: record.createdAt });
        } catch (error) {
          const status = [400, 409, 429].includes(error.status) ? error.status : 503;
          return send(res, status, { error: status === 503 ? "저장하지 못했어요. 내용을 그대로 두고 다시 보내 주세요." : error.message });
        }
      }

      if (p === "/api/health") return send(res, 200, {
        ok: true,
        categoryRouting: engine.editorialCategoryRoutingStatus
      });

      // NH121: 옛 브리핑과 송출 RSS 종료. 오늘판 편집기·수집 RSS는 유지한다.
      if ((p === "/api/briefing" || p === "/rss.xml") && req.method === "GET") {
        return send(res, 410, {
          code: "LEGACY_BRIEFING_RETIRED",
          error: "기존 오늘의 브리핑과 RSS 제공이 종료되었습니다."
        }, { "cache-control": "no-store", "x-robots-tag": "noindex" });
      }
      if ((p === "/briefing" || p.startsWith("/briefing/")) && req.method === "GET") {
        res.writeHead(410, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
        return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>기존 브리핑 종료 — 지금핫</title><style>body{max-width:640px;margin:80px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.7}a{color:#d42d12}</style></head>
<body><main><h1>기존 오늘의 브리핑을 종료했습니다</h1><p>이 주소의 브리핑과 RSS는 더 이상 제공하지 않습니다. 새로운 오늘판에서 관심 분야별 소식을 확인해 주세요.</p><a href="/">오늘판 보기 →</a></main></body></html>`);
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
          // 색인 가능한 홈은 서버가 자체 편집 본문을 완성해 응답한다. 개인화
          // 데이터 API를 크롤러에 열 이유가 없어졌고, /live는 자체 noindex를 낸다.
          "Disallow: /api/",
          "Disallow: /admin",
          "Disallow: /p?",           // 공유 링크는 앱으로 튕기는 중계 페이지
          `Sitemap: ${origin}/sitemap.xml`,
          ""
        ].join("\n"));
        return;
      }

      if (p === "/sitemap.xml" && req.method === "GET") {
        const origin = originOf(req);
        // lastmod — 구글이 "이 페이지가 언제 바뀌었나"를 판단하는 사실상 유일한
        // 신호다. 없으면 사이트맵을 다시 읽어도 무엇이 바뀌었는지 알 수 없어
        // 재크롤링 우선순위가 안 올라간다. 반대로 changefreq·priority는 구글이
        // 사실상 무시한다고 공식적으로 밝힌 항목이다.
        // 실측(2026-08-04): 61개 URL 전부 lastmod가 없었다 — 3일 전 제출한
        // 사이트맵이 그 뒤 바뀐 걸 구글에 알릴 방법이 없던 상태다.
        //
        // **지어내지 않는다.** 수집이 15분마다 도는 목록형 페이지는 마지막
        // 갱신 시각이 실제로 지금에 가깝고, 날짜 아카이브는 그날 저장 시각이,
        // 정책 문서는 파일의 수정 시각이 진짜 값이다.
        const isoOf = (ms) => new Date(ms).toISOString();
        const liveMod = isoOf(engine.lastRefreshedAt || Date.now());
        const fileMod = (rel) => {
          try { return isoOf(fs.statSync(path.join(PUBLIC_DIR, rel)).mtimeMs); } catch { return undefined; }
        };
        const urls = [
          { loc: "/", freq: "hourly", pri: "1.0", mod: liveMod },
          { loc: "/report", freq: "daily", pri: "0.8", mod: liveMod },
          { loc: "/about", freq: "monthly", pri: "0.4", mod: fileMod("about.html") },
          { loc: "/terms", freq: "yearly", pri: "0.2", mod: fileMod("terms.html") },
          { loc: "/privacy", freq: "yearly", pri: "0.2", mod: fileMod("privacy.html") }
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map((u) =>
            `  <url><loc>${escapeHtml(origin + u.loc)}</loc>` +
            (u.mod ? `<lastmod>${u.mod}</lastmod>` : "") +
            `<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`
          ).join("\n") + `\n</urlset>\n`;
        res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
        res.end(body);
        return;
      }

      // 로컬 고도화 후보: 기존 수집·랭킹·브리핑을 사용자의 명시적 카테고리로
      // 넓혀 한 페이지 오늘판으로 조립한다. 플래그가 없는 운영에서는 404다.
      if (p === "/api/today" && req.method === "GET" && localEditorial) {
        const userId = url.searchParams.get("userId") || null;
        if (userId && !store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const categories = url.searchParams.has("categories")
          ? url.searchParams.get("categories").split(",").map((c) => c.trim()).filter(Boolean) : null;
        // 무효 슬러그는 조용히 버리지 않는다 (9인 검수 P0, 2026-08-13):
        // economy·game 같은 오타가 에러 없이 무시되고 기본판(유머 포함)으로
        // 폴백돼 "내 관심사만"이라는 약속이 깨졌다. POST /api/today/categories는
        // 이미 known 검증을 하는데 GET만 구멍이었다 — 같은 잣대로 400을 준다.
        if (categories) {
          const known = new Set(CATEGORIES.map((category) => category.id));
          const unknown = categories.filter((id) => !known.has(id));
          if (unknown.length) {
            return send(res, 400, {
              error: `알 수 없는 카테고리: ${unknown.join(", ")}`,
              code: "UNKNOWN_CATEGORY",
              unknown,
              validCategories: CATEGORIES.map(({ id, label }) => ({ id, label }))
            });
          }
        }
        const slotId = url.searchParams.get("slot") || null;
        const targetDate = url.searchParams.get("date") || null;
        if (targetDate && !validEditorialDate(targetDate)) {
          return send(res, 400, { error: "invalid editorial date", code: "INVALID_EDITORIAL_DATE" });
        }
        try {
          if (slotCanonicalEditionReader) {
            const target = localEditionTarget({ slotId, targetDate });
            if (!target.available) {
              const error = new Error(`${target.slot.label}판은 아직 발행 시각 전입니다.`);
              error.code = "EDITORIAL_SLOT_NOT_DUE";
              throw error;
            }
            const requestUser = userId ? store.getUser(userId) : null;
            const resolvedSelection = resolveEditorialSelection(categories, requestUser);
            return send(res, 200, slotCanonicalEditionReader.read({
              date: target.date,
              slotId: target.slot.id,
              categories: resolvedSelection.selectedCategories,
              selectionMode: resolvedSelection.mode,
              explicit: resolvedSelection.explicit
            }));
          }
          return send(res, 200, await buildServeableTodayEdition({ userId, categories, slotId, targetDate }));
        } catch (error) {
          if (error && [
            "EDITORIAL_SLOT_NOT_DUE",
            "EDITORIAL_EDITION_NOT_SERVEABLE",
            "SLOT_CANONICAL_EDITION_UNAVAILABLE"
          ].includes(error.code)) {
            return send(res, 409, {
              error: error.message,
              code: error.code,
              ...(error.serving ? { serving: error.serving } : {})
            });
          }
          throw error;
        }
      }

      if (p === "/api/today/summary" && req.method === "POST" && localEditorial) {
        return send(res, 410, {
          error: "기사 요약은 오늘판 응답에 미리 포함됩니다.",
          code: "ARTICLE_SUMMARY_IN_EDITION"
        });
      }

      if (p === "/api/today/categories" && req.method === "POST" && localEditorial) {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        const known = new Set(CATEGORIES.map((category) => category.id));
        const categories = [...new Set(
          (Array.isArray(body.categories) ? body.categories : [])
            .map((id) => String(id || "").trim())
            .filter((id) => known.has(id))
        )];
        if (!categories.length) return send(res, 400, { error: "select at least one category" });
        const savedCategories = store.setBriefingCategories(body.userId, categories);
        localEditorialEvidenceCache.at = 0;
        if (!slotCanonicalEditionReader) {
          const queued = setTimeout(() => runLocalEditorialInventory().catch(() => {}), 0);
          queued.unref?.();
        }
        return send(res, 200, {
          ok: true,
          categories: savedCategories
        });
      }

      // X 실시간 트렌드 — 키워드+X 검색 링크만 (트윗 본문 없음, trends.js 헤더 참고)
      if (p === "/api/trends" && req.method === "GET") {
        const t = trendsCache ? await trendsCache.get() : null;
        return send(res, 200, t || { trends: [], fetchedAt: null });
      }

      if (p === "/trends" && req.method === "GET") {
        const t = trendsCache ? await trendsCache.get() : null;
        if (!t || !t.trends.length) return send(res, 404, { error: "no trends yet" });
        const AD = adPage(false);
        // ── 키워드를 **우리 페이지로** 보낸다 (2026-08-06)
        //
        // 예전엔 20개 전부 X(트위터) 검색으로 나갔다. 실측하면 이 페이지는
        // 우리 글자 783자에 아웃링크 20개 — 애드핏이 말한 "아웃링크만으로
        // 구성되었거나 그 비중이 높은" 화면 그 자체였다. 수익으로 봐도 최악이다:
        // 사용자를 트위터로 보내면 우리 광고 노출이 거기서 끝난다.
        //
        // **다만 X 링크를 없애지는 않는다.**
        //
        // 처음엔 매칭 안 된 키워드의 링크를 통째로 뺐다. 실측하니 20개 중
        // 14개가 그랬다 — 실시간 트렌드에서 키워드를 눌렀는데 아무 데도 못
        // 가는 화면이 된다. 그건 심사를 위해 기능을 줄인 것이고,
        // David가 그 자리에서 짚었다: "목적을 위해 어거지로 맞추지마."
        //
        // 맞는 지적이다. 트렌드 키워드를 눌러 그 말을 더 보고 싶은 것은
        // 이 페이지의 당연한 쓰임이다. 우리 글이 있으면 우리 쪽이 낫고
        // (사용자에게도, 광고 노출에도), 없으면 X로 보내는 것이 정직하다.
        // 우리 페이지로 가는 길을 **더한** 것이지 밖으로 가는 길을 막은 게 아니다.
        const tPool = await engine.pool();
        const tTitles = tPool.map((i) => String(i.title || "").toLowerCase());
        const hitsOf = (name) => {
          const q = String(name || "").replace(/^#/, "").trim().toLowerCase();
          if (q.length < 2) return 0;
          let n = 0;
          for (const t2 of tTitles) if (t2.includes(q)) n += 1;
          return n;
        };
        const scored = t.trends.map((x) => ({ ...x, hits: hitsOf(x.name) }));
        const covered = scored.filter((x) => x.hits > 0).length;
        const row = (x) => {
          const meta = [];
          if (x.count) meta.push(`X 게시물 ${x.count}`);
          if (x.hits) meta.push(`우리 피드 ${x.hits}건`);
          const label = escapeHtml(x.name);
          const mineHref = `/keyword/${encodeURIComponent(String(x.name).replace(/^#/, ""))}`;
          const x2 = `<a class="m" href="${escapeHtml(x.searchUrl)}" target="_blank" rel="noopener">X에서 보기</a>`;
          // 우리 글이 있으면 우리 쪽이 첫 번째 길, X는 곁길. 없으면 X가 유일한 길.
          const head = x.hits ? `<a href="${mineHref}">${label}</a>` : `<a href="${escapeHtml(x.searchUrl)}" target="_blank" rel="noopener">${label}</a>`;
          const tail = x.hits ? ` ${x2}` : "";
          return `<li><div>${head}${meta.length ? `<span class="m">${escapeHtml(meta.join(" · "))}</span>` : ""}${tail}</div></li>`;
        };
        const inner = `<h1>지금 X(트위터) 실시간 트렌드</h1>
<p class="muted">${kstLabel(t.fetchedAt)} 기준 한국 실시간 트렌드 TOP ${t.trends.length} · 약 20분마다 갱신.</p>
<p class="muted">이 중 <b>${covered}개</b>는 지금 우리가 수집 중인 커뮤니티·뉴스 글 제목에서도 발견됐습니다.
그 키워드를 누르면 <b>지금핫이 모은 글</b>로 가고, 나머지는 X 검색으로 갑니다.</p>
${rankingNav("")}
<ol class="rank">${scored.slice(0, 8).map(row).join("")}</ol>
${AD(null, null, 6, "trends_mid")}
<ol class="rank" start="9" style="--rank-start:8">${scored.slice(8).map(row).join("")}</ol>
<p class="muted">트렌드 집계 출처: trends24.in · 지금핫은 트윗 본문을 수집·게재하지 않습니다.
"우리 피드 N건"은 지금 우리 수집 풀에서 그 말이 제목에 들어간 글의 수이며, 우리가 직접 센 값입니다.</p>`;
        return sendHtml(res, editionShell("실시간 트렌드", "지금 한국에서 가장 많이 언급되는 실시간 트렌드 키워드 TOP 20 — 지금핫", inner, "/trends", ownContentNav("/trends"), "", true));
      }

      // 화제 랭킹 TOP 20 — 일간(라이브) / 주간·월간(일별 스냅샷 병합).
      // 데이터가 기간만큼 쌓이기 전에는 있는 날짜만 합산하고 그 사실을 밝힌다.
      // ── 커뮤니티 순위 (2026-08-04) ────────────────────────────────────
      // 벤치마킹한 오늘의베스트는 "방문 289.5M" 같은 외부 트래픽 추정치로
      // 줄을 세운다. 우리는 그 수를 잰 적이 없으므로 쓰지 않고, **우리가
      // 실제로 측정한 값**(수집한 베스트글 수, 총 반응량, 평균 댓글)으로
      // 매긴다. 지어낸 수가 없어 검증이 우리 로그로 끝나고, 남이 복사할 수
      // 없는 데이터라는 점에서도 이쪽이 낫다.
      if (p === "/communities" && req.method === "GET") {
        const items = await engine.pool();
        const rank = communityRanking(items);
        if (!rank.length) return send(res, 404, { error: "no data yet" });
        const AD = adPage(false);
        const total = rank.reduce((a, b) => a + b.posts, 0);
        const lead = rank[0];
        const inner = `<h1>커뮤니티 순위</h1>
<p class="muted">지금핫이 지금 수집해 둔 화제글 ${total}건을 커뮤니티별로 집계했습니다. 순위 기준은 <b>반응량</b>(추천 + 댓글)이며, 방문자수 같은 외부 추정치는 쓰지 않습니다 — 우리가 직접 잰 값만 싣습니다.</p>
${rankingNav("")}
<p>지금 반응이 가장 큰 곳은 <b>${escapeHtml(lead.label)}</b>입니다. 화제글 ${lead.posts}건에 추천과 댓글을 합쳐 ${fmtNum(lead.reactions)}의 반응이 모였고, 글 하나당 댓글은 평균 ${lead.avgComments}개입니다${lead.topCategory ? `. 오늘 이곳에서 가장 많이 다룬 분야는 ${escapeHtml(categoryLabel(lead.topCategory))}입니다` : ""}.</p>
<section><h2>반응량 순위</h2>
<ol class="rank">${rank.map((e) => `<li><div><a href="/community/${encodeURIComponent(e.source)}">${escapeHtml(e.label)}</a>
  <span class="m">화제글 ${e.posts}건 · 반응 ${fmtNum(e.reactions)} · 글당 댓글 ${e.avgComments}${e.topCategory ? ` · 주로 ${escapeHtml(categoryLabel(e.topCategory))}` : ""}</span></div></li>`).join("")}</ol></section>
${AD(null, null, 10, "communities")}
<p class="muted">집계 대상은 각 커뮤니티의 베스트·인기 게시판이며, 15분마다 갱신됩니다. 전체 게시물이 아니라 <b>반응이 큰 글만</b> 모으므로 커뮤니티의 총 활동량과는 다릅니다.</p>`;
        return sendHtml(res, editionShell("커뮤니티 순위 — 어디가 지금 가장 뜨거운가",
          "국내 커뮤니티를 지금핫이 실측한 반응량(추천+댓글)으로 줄 세운 순위. 방문자 추정치가 아니라 직접 잰 값입니다.",
          inner, "/communities", ownContentNav("/communities"), "", true));
      }

      // ── 커뮤니티별 베스트 ────────────────────────────────────────────
      // 소스마다 페이지를 쪼갠다 — 색인 대상이 소스 수만큼 늘고,
      // "클리앙 인기글" 같은 검색어에 각각 대응된다.
      if (p.startsWith("/community/") && req.method === "GET") {
        const seg = decodeURIComponent(p.slice("/community/".length));
        const b = sourceBest(await engine.pool(), seg);
        if (!b) return send(res, 404, { error: "no data for source" });
        const AD = adPage(false);
        // 알맹이가 얇으면 색인만 막는다. 페이지는 그대로 열린다 —
        // 목록에서 눌러 들어온 사람에게 404를 주는 건 다른 문제다.
        const cats = b.categories.slice(0, 3)
          .map((c) => `${escapeHtml(categoryLabel(c.key))} ${c.count}건`).join(" · ");
        const inner = `<h1>${escapeHtml(b.label)} 인기글</h1>
<p class="muted">${escapeHtml(b.label)}에서 지금 반응이 큰 글 ${b.total}건을 지금핫이 모아 정리했습니다. 추천과 댓글을 합친 반응량 순입니다.</p>
${rankingNav("")}
${cats ? `<p>지금 ${escapeHtml(b.label)}에서 가장 많이 다뤄지는 분야는 ${cats} 순입니다.</p>` : ""}
<section><h2>반응량 TOP ${b.items.length}</h2>
<ol class="rank">${b.items.map((i) => `<li><div><a href="${livePostHref(i)}">${escapeHtml(maskProfanity(i.title))}</a>
  <span class="m">${escapeHtml(categoryLabel(i.category))}${evidenceBits(i).length ? " · " + evidenceBits(i).join(" · ") : ""}</span></div></li>`).join("")}</ol></section>
${AD(b.items[0] && b.items[0].category, null, 12, "community_mid")}
<p class="muted"><a href="/communities">다른 커뮤니티 순위도 보기 →</a></p>`;
        return sendHtml(res, editionShell(`${b.label} 인기글 모아보기`,
          `${b.label}에서 지금 반응이 큰 글을 지금핫이 실측 추천·댓글 순으로 정리했습니다.`,
          inner, `/community/${encodeURIComponent(seg)}`, ownContentNav(), "", true));
      }

      // ── 키워드 ───────────────────────────────────────────────────────
      // 두 곳 이상에서 나온 말만 페이지로 만든다. 한 커뮤니티에서만 나온
      // 단어는 그 글의 고유명사일 뿐이고, 알맹이 없는 페이지를 수백 개
      // 만들면 자체 콘텐츠를 늘리는 게 아니라 오히려 감점이다.
      // ── 데이터 리포트 (블루프린트 P0-A ④, 2026-08-06)
      //
      // 여기 실리는 문장과 그림에는 **남의 글이 하나도 없다.** 재료가 전부
      // 우리가 잰 값이라, 아웃링크가 0이어도 페이지가 성립한다 — 애드핏 4차
      // 반려("외부 콘텐츠·외부 링크 비중")에 정면으로 답하는 유일한 형태다.
      //
      // 레퍼런스(2026-08-06 조사): Google Year in Search·Spotify Wrapped·
      // hnrankings.info 계열은 "해설 없이 순위·숫자·그래프를 템플릿에 채우는"
      // 구조라 자동 생성에 맞는다. 마부작침·The Pudding 계열은 기자의 해석이
      // 구조의 핵심이라 자동화 대상이 아니다. 후자를 흉내 내지 않는다.
      if (p === "/report" && req.method === "GET") {
        const rep = reportNow();
        if (!rep || !rep.publishable) {
          // 알맹이 없는 글을 발행하지 않는다 — 브리핑과 같은 규칙이다.
          // 빈 페이지를 대량으로 색인시키면 사이트 전체 평가가 그쪽으로 끌려간다.
          return sendHtml(res, editionShell("지금핫 데이터 리포트",
            "지금핫이 직접 집계한 커뮤니티·뉴스 화제 데이터 리포트",
            `<h1>지금핫 데이터 리포트</h1><p class="muted">아직 며칠치 기록이 모이지 않았습니다. 하루치 스냅샷이 쌓이면 발행합니다.</p>`,
            "/report", ownContentNav("/report"), "", true));
        }
        const AD = adPage();
        const chartHtml = (c) => {
          if (!c) return "";
          if (c.type === "line") return lineSvg(c);
          return barsSvg(c);
        };
        const body = rep.sections.map((sec, i) => {
          const html = `<section class="issue"><h2>${escapeHtml(sec.heading)}</h2>` +
            sec.paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`).join("") +
            chartHtml(sec.chart) + `</section>`;
          // 절 사이에만 광고를 넣는다. 마지막 절 뒤에 붙이면 글 끝이 광고로 끝난다.
          return i === 0 && rep.sections.length > 1 ? html + AD(null, null, 18, "report_mid") : html;
        }).join("");
        const inner = `<h1>${escapeHtml(rep.title)}</h1>
<p class="muted">${escapeHtml(rep.lead)}</p>
<p class="muted small">이 페이지의 수치와 그림은 지금핫이 직접 수집·계측해 만든 것입니다.
원문을 옮기지 않으므로 외부 링크가 없습니다.</p>
${body}
<section class="issue"><h2>어떻게 만드나</h2>
<p>지금핫은 커뮤니티와 뉴스 매체를 정해진 주기로 돌며 글의 제목·출처·공개 반응 수치를 기록합니다.
본문은 수집하지 않습니다. 그 기록을 날짜별로 저장해 두었다가, 여러 날을 겹쳐 봐야 보이는 것만 여기에 씁니다.</p>
<p>표본이 모자란 항목은 문장에서 빼고, 모든 집계에는 표본 수를 함께 적습니다.
수치를 반올림하는 것 외에 보정하지 않습니다.</p></section>
${rankingNav("")}`;
        return sendHtml(res, editionShell(rep.title,
          `커뮤니티·뉴스 ${rep.landscape.sources.length}곳에서 ${rep.dayCount}일간 모은 화제 랭킹 ${rep.landscape.total}건을 지금핫이 직접 집계했습니다.`,
          inner, "/report", ownContentNav("/report"), AD(null, null, 19, "report_bot")));
      }

      if (p === "/keywords" && req.method === "GET") {
        const idx = keywordIndex(await engine.pool());
        if (!idx.length) return send(res, 404, { error: "no keywords yet" });
        const AD = adPage(false);
        const inner = `<h1>지금 화제 키워드</h1>
<p class="muted">여러 커뮤니티에서 동시에 언급되고 있는 말들입니다. 한 곳에서만 나온 단어는 싣지 않습니다 — 두 곳 이상에서 나와야 실제로 퍼지는 말입니다.</p>
${rankingNav("")}
<section><h2>키워드 ${idx.length}개</h2>
<ol class="rank">${idx.map((k) => `<li><div><a href="/keyword/${encodeURIComponent(k.tag)}">${escapeHtml(k.tag)}</a>
  <span class="m">${k.sources}곳에서 ${k.count}건 · 반응 ${fmtNum(k.reactions)}</span></div></li>`).join("")}</ol></section>
${AD(null, null, 14, "keywords")}`;
        return sendHtml(res, editionShell("지금 화제 키워드",
          "여러 커뮤니티에서 동시에 언급되는 키워드를 지금핫이 실측 반응량으로 정리했습니다.",
          inner, "/keywords", ownContentNav("/keywords"), "", true));
      }

      if (p.startsWith("/keyword/") && req.method === "GET") {
        const tag = decodeURIComponent(p.slice("/keyword/".length));
        const k = keywordPage(await engine.pool(), tag);
        if (!k) return send(res, 404, { error: "no data for keyword" });
        const AD = adPage(false);
        const srcs = k.sources.slice(0, 4).map((x) => `${escapeHtml(x.key)} ${x.count}건`).join(" · ");
        const inner = `<h1>“${escapeHtml(tag)}” 관련 화제글</h1>
<p class="muted">‘${escapeHtml(tag)}’${particle(tag, "이", "가")} 언급된 글 ${k.total}건을 커뮤니티·뉴스에서 모았습니다. 반응량 순입니다.</p>
${rankingNav("")}
${srcs ? `<p>이 키워드는 ${srcs} 순으로 언급되고 있습니다.</p>` : ""}
<section><h2>관련 글</h2>
<ol class="rank">${k.items.map((i) => `<li><div><a href="${livePostHref(i)}">${escapeHtml(maskProfanity(i.title))}</a>
  <span class="m">${escapeHtml(i.sourceLabel || i.source)}${evidenceBits(i).length ? " · " + evidenceBits(i).join(" · ") : ""}</span></div></li>`).join("")}</ol></section>
${AD(k.categories[0] && k.categories[0].key, null, 16, "keyword_mid")}
<p class="muted"><a href="/keywords">다른 화제 키워드도 보기 →</a></p>`;
        return sendHtml(res, editionShell(`${tag} — 지금 커뮤니티 반응`,
          `‘${tag}’이 언급된 커뮤니티·뉴스 화제글을 지금핫이 실측 반응 순으로 모았습니다.`,
          inner, `/keyword/${encodeURIComponent(tag)}`, ownContentNav(), "", true));
      }

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
        const AD = adPage(false);
        const inner = `<h1>${label} 화제 랭킹 TOP ${Math.min(20, list.length)}</h1>
<p class="muted">소스별 반응 분포로 정규화한 화제성 순위입니다 — 큰 게시판의 절대 추천수가 아니라 "그 동네에서 얼마나 이례적으로 터졌는가"와 교차 보도를 봅니다. 항목마다 근거 수치를 함께 표기합니다.</p>
${note ? `<p class="muted">${escapeHtml(note)}</p>` : ""}
${rankingNav(period)}
${rankingRows(list, (above) => {
  const cat = above && !AD_MATCH_OFF_CATS.has(above.category) ? above.category : null;
  return AD(cat, null, 2, "rank_mid", cat ? destForText(above.title) : null);
})}`;
        return sendHtml(res, editionShell(`${label} 인기글 랭킹 TOP 20`, `${label} 커뮤니티·뉴스 인기글 TOP 20 — 추천·댓글 실측 반응으로 매긴 지금핫 화제 랭킹`, inner, `/ranking/${period}`, ownContentNav("/ranking/daily"), "", true));
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
        const reviewMode = adfitReviewMode();
        const monetization = {
          enabled: Boolean(process.env.COUPANG_PARTNER_ID) || Boolean(process.env.AD_PREVIEW)
        };
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
        // 심사 통과 전에는 슬롯을 아예 그리지 않는다 (2026-08-04).
        //
        // 실측: 애드핏 SDK는 정상 동작하는데 심사 보류 상태에서 **onfail을 부르지
        // 않는다** — 아무것도 안 보여주면서 "채웠다"로 처리한다. ins 안에
        // safeframe iframe이 생기고 크로스오리진이라, 우리 쪽에서는 채워졌는지
        // 빈 칸인지 구분할 방법이 없다. 그래서 워터폴 패스백으로도 안 잡힌다.
        // 그 결과 169px 빈 칸이 지면만 먹고 수익은 0이었다(David 실기기 제보
        // "하나도 안 보이는데"). 그 자리를 쿠팡이 대신 받는다.
        //
        // 승인되면 ADFIT_ENABLED=1로 켠다. 패스백 배선(data-ad-onfail →
        // 쿠팡)은 그대로 두므로, 켠 뒤 미충족이 생기면 그때는 넘어간다.
        // 화면이 자기 빌드와 서버 빌드를 대조할 수 있게 함께 준다.
        const build = buildId();
        // 실시간 피드는 목록이 계속 바뀌는 지면이라 AdFit을 내려보내지 않는다.
        // reviewMode는 운영 점검용 공개 상태값이며 광고단위 식별자는 아니다.
        const adfit = { mobileUnit: null, reviewMode };
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
          // 크기로 거르지 않는다. 2026-08-05에 재고를 200x200 정사각으로 통째로
          // 갈았는데 여기 필터가 남아 있어서 **앱에서만 광고가 사라졌다** —
          // 발행 페이지는 pickBanner를 쓰니 멀쩡했고, 그래서 눈치채기 어려웠다.
          // 크기는 이제 의미가 없다: 76px 정사각 썸네일에 object-fit:cover로 넣는다.
          const items = loadBanners()
            .map((b) => {
              const [hook, brand] = adCopy(b.dest);
              // dest도 함께 — 클라이언트가 "방금 이 도착지를 썼는지"로
              // 중복을 거른다. href는 사이즈마다 달라 같은 도착지를 못 잡는다.
              return { category: b.category, dest: b.dest, href: b.href, img: b.img, hook, brand };
            });
          // 행렬을 함께 내려보낸다(짧은 문자열 240개, 세션당 1회).
          // 노출마다 서버를 부르면 지연이 생기고, 그러면 스크롤 중에 빈 칸이
          // 뜨거나 레이아웃이 밀린다 — 2026-08-03에 고친 그 증상이다.
          return items.length
            ? { disclosure: COUPANG_DISCLOSURE, items, matrix: adMatrix ? adMatrix.variants : null }
            : null;
        })();

        return send(res, 200, {
          build, survey: SURVEY, categories: CATEGORIES, sources: liveCatalog, topics: TOPIC_CATALOG,
          monetization, adfit, coupang, auth, localEditorial,
          // 업데이트 소식 — 화면이 "이미 본 것"과 대조해 새것일 때만 띄운다.
          // 목록 전체가 아니라 최신 하나만 보낸다(사용자가 볼 것은 이번 변화뿐이다).
          release: latestRelease() });
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
        if (denied(body.userId)) return;
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
        // 바로 위 /api/post에는 있는 소유권 검사가 여기만 빠져 있었다
        // (적대적 검수 2026-08-06). userId만 알면 남의 이름으로 제보가 올라간다.
        if (denied(body.userId)) return;
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
        if (denied(url.searchParams.get("userId"))) return;
        const userId = url.searchParams.get("userId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const space = store.mySpace(userId);
        // resolve scrapped item ids into displayable items
        space.saved = await engine.resolveItems(userId, space.savedIds);
        // 최근 본 글. 풀에서 내려간 글은 resolveItems가 알아서 뺀다 —
        // 없는 것을 있는 척하지 않는다. 화면 상한 40개는 생존 필터 **뒤에**
        // 자른다(2026-08-08 검수: 먼저 자르면 죽은 id가 상한을 잠식해
        // 복귀 사용자의 발자취가 통째로 비었다). mySpace가 후보를 여유 있게
        // 주는 이유가 이것이다.
        space.recent = (await engine.resolveItems(userId, space.recentIds)).slice(0, 40);
        space.recentIds = space.recent.map((r) => r.id);
        // taste dashboard: top learned preferences, labelled for display
        const prefs = store.getUser(userId).preferences;
        const t = topPreferences(prefs);
        space.taste = {
          categories: t.categories.map((c) => ({ ...c, label: categoryLabel(c.id) })),
          // 한국어 이름을 붙인다 (David 2026-08-06). 예전엔 "#sneakers"처럼
          // 영문 id가 그대로 화면에 찍혔다. 학습된 태그는 사전에 없어 id를 그대로 쓴다.
          tags: t.tags.map((x) => ({ ...x, label: "#" + tagLabel(x.id) })),
          sources: t.sources.map((s) => ({ ...s, label: sourceLabel(s.id) })),
          disliked: t.disliked.map((d) => ({ ...d, label: categoryLabel(d.id) }))
        };
        return send(res, 200, space);
      }

      if (p === "/api/save" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const saved = store.toggleSave(body.userId, body.itemId, body.on);
        // 저장 버튼은 클릭 게이트가 확실한 qualifying 신호다 (src/feed/audience.js).
        // 봇 UA는 신호가 있어도 사람이 아니다 — UA 관문이 먼저다.
        if (classifyAudience(req) === "observed") { try { store.markHumanDay(body.userId); } catch {} }
        return send(res, 200, { ok: true, saved });
      }

      if (p === "/api/mute" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const muted = store.setMute(body.userId, body.source, body.on === true);
        return send(res, 200, { ok: true, mutedSources: muted });
      }

      // 콘텐츠 필터 토글: 정치/종교(기본 숨김, FILTERABLE_TOPICS) + 성인(adult).
      // adult는 켤 수 없는 토픽이다 — 노출 경로 자체를 없앴다(아래 주석 참고).
      // 뉴스 성향 슬라이더 저장 (David 2026-07-31 "슬라이드로")
      if (p === "/api/lean" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
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
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        if (typeof body.balance !== "number" || !Number.isFinite(body.balance)) {
          return send(res, 400, { error: "balance must be a number in [-1, 1]" });
        }
        const balance = store.setMixBalance(body.userId, body.balance);
        return send(res, 200, { ok: true, balance });
      }

      if (p === "/api/topics" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        const user = store.getUser(body.userId);
        if (!user) return send(res, 400, { error: "unknown user" });
        const topic = body.topic;
        const on = body.on === true;

        // adult는 켤 수 있는 토픽이 아니다 (위 주석 참고). 다른 토픽 이름과
        // 똑같이 "모르는 토픽"으로 답한다 — 여기만 특별한 오류를 주면
        // 켜는 방법이 어딘가 있다는 뜻이 된다.
        if (!FILTER_KEYS.includes(topic)) {
          return send(res, 400, { error: "unknown topic", topics: FILTER_KEYS });
        }
        const showTopics = store.setTopicFilter(body.userId, topic, on);
        return send(res, 200, { ok: true, topic, on: showTopics.includes(topic), showTopics });
      }

      if (p === "/api/session" && req.method === "POST") {
        if (!sessionAllowed(req)) return send(res, 429, { error: "too many sessions" });
        const body = await readBody(req);
        // 신원 확정은 GA4 blended identity와 같은 순서다 (auth.js resolveIdentity):
        // 로그인 세션 > 기기 쿠키 > localStorage > 신규.
        //
        // 예전에는 body.userId(=localStorage) 하나만 봤다. 카카오톡·네이버 앱
        // 내장 브라우저가 localStorage를 비우면 그 값이 null이라 **매번 새
        // 사용자**가 발급됐고, 로그인 쿠키가 살아 있어도 쓰이지 않았다.
        // 실측(2026-08-04): 8/3 방문자 135명 중 133명이 그날 새로 만들어진 ID.
        const ident = resolveIdentity({ cookies: parseCookies(req.headers.cookie), bodyUserId: body.userId, store });
        const user = store.createUser(ident.userId);
        try { store.recordIdentity(ident.source); } catch {}
        // 방문마다 다시 내보내 만료를 미룬다(GA4 동작). localStorage에서 온
        // 기존 사용자도 이 순간 쿠키로 승격되므로, 다음 방문부터는 저장소가
        // 비워져도 같은 사람으로 이어진다.
        // 기기 쿠키(누구인지 기억)와 **열쇠**(본인임을 증명)를 함께 심는다.
        //
        // 열쇠는 **아직 열쇠 쿠키가 없을 때만** 새로 만든다. 이미 들고 있으면
        // 그대로 둔다 — 새로 발급해 덮어쓰면 이미 묶인 계정이 자기 열쇠를
        // 잃고 스스로 잠긴다.
        //
        // 여기서는 계정에 저장하지 않는다. 저장은 **클라이언트가 그 열쇠를
        // 실제로 돌려보냈을 때**(bindDevice) 일어난다. 세션 생성 시점에 박으면
        // 쿠키를 못 쓰는 클라이언트가 곧바로 잠긴다.
        const secureCookie = isSecureRequest(req);
        // 이 브라우저의 기기 표식과 계정을 묶는다. 표식이 아직 없으면 지금 심는다 —
        // 그래야 다음에 localStorage가 날아가도 같은 계정을 찾는다.
        try {
          const v = ensureVisitor(req, res);
          if (v && v.vid) store.linkVisitor(v.vid, user.id);
        } catch {}
        const setCookies = [serializeDeviceCookie(user.id, { secure: secureCookie })];
        if (!parseCookies(req.headers.cookie)[KEY_COOKIE]) {
          setCookies.push(serializeKeyCookie(randomUUID().replace(/-/g, ""), { secure: secureCookie }));
        }
        // **이미 심어 둔 쿠키를 덮어쓰지 않는다.** ensureVisitor가 방금 넣은
        // 기기 표식이 여기서 통째로 날아갈 뻔했다 — setHeader는 배열을 갈아 끼운다.
        {
          const prevSet = res.getHeader("set-cookie");
          const prevList = prevSet ? (Array.isArray(prevSet) ? prevSet : [prevSet]) : [];
          res.setHeader("set-cookie", [...prevList, ...setCookies]);
        }
        return send(res, 200, {
          userId: user.id,
          identitySource: ident.source,
          loggedIn: ident.loggedIn,
          nickname: user.nickname,
          surveyed: user.surveyed,
          feedbackCount: user.feedbackCount,
          briefingCategories: user.briefingCategories || [],
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

      // 성인인증·19금 노출 경로는 **없앴다** (David 2026-08-05, 애드핏 2차 보류).
      //
      // 애드핏 보류 사유의 두 번째가 성인 콘텐츠였고, 참고 이미지의 빨간 네모는
      // 게시물이 아니라 메뉴의 "🔞 성인 콘텐츠(19금) 보기" 토글 자체였다.
      // 화면 토글은 이미 걷어냈지만 **경로가 살아 있었다** — 라이브에서 확인했다:
      //   POST /api/verify-age {confirmAdult:true} → {"ok":true,"ageVerified":true}
      //   POST /api/adult      {on:true}           → {"ok":true,"showAdult":true}
      // 체크박스 하나로 통과하는 모의 인증이었다. 실제 본인확인(PASS 등)이
      // 아니므로 청소년보호 요건을 만족한다고 말할 수 없고, 지금 풀에 성인 글이
      // 없을 뿐 하나라도 들어오면 그대로 노출된다.
      //
      // 글을 지우지는 않는다 — David의 원칙은 "삭제가 아니라 태그 후 가림"이다.
      // adult 태그는 소스 등록정보에만 남는다 — **아이템 단위 필터는 지금 코드에 없다**
    // (2026-08-07 감사 확인: normalizeItem이 adult를 보존하지 않고 engine에 .adult 조건도 0건).
    // 지금 성인물이 안 나오는 이유는 게이트가 아니라 adult:true 소스 3곳이 전부 enabled:false여서다. 없앤 것은
      // **가림을 풀 수 있는 방법**뿐이다. 제대로 된 본인확인을 붙일 수 있게 되면
      // 그때 다시 연다.

      if (p === "/api/survey" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        // 가짜 사람 구멍 봉쇄(적대적 검수 P0급, 2026-08-09): denied()가 이미
        // "존재하는 계정"을 요구하지만, 방어를 한 겹만 믿지 않는다 — 무인증
        // /api/session이 IP 상한 없이 uid를 계속 찍어낼 수 있어, "막 만든
        // uid로 곧장 설문 제출"이 여전히 싸다. IP 분당 상한(adSignalAllowed
        // 골격 재사용)을 먼저 건다.
        if (!surveyOrHistoryAllowed(req)) return send(res, 429, { error: "too many" });
        const { ok, errors } = validateAnswers(body.answers);
        if (!ok) return send(res, 400, { error: "invalid survey", details: errors });
        // 이 요청이 오기 **전에** 이미 있던 계정인지 — 방금 이 요청으로 막
        // 생긴 계정(성립은 안 되지만 방어적으로 다시 확인)은 사람으로 세지
        // 않는다. 설문 저장 자체는 그대로 성공시킨다.
        const existedBefore = Boolean(store.getUser(body.userId));
        store.createUser(body.userId);
        store.saveSurvey(body.userId, body.answers);
        if (existedBefore && classifyAudience(req) === "observed") {
          try { store.markHumanDay(body.userId); } catch {}
        }
        return send(res, 200, { ok: true });
      }

      if (p === "/api/history" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        // 같은 상한 — /api/history도 무인증 createUser+쓰기 경로다. 이력
        // 가져오기는 qualifying 신호가 아니므로(스스로 클릭한 게 아니라
        // 클라이언트가 로컬 방문기록을 그대로 보낸 것) markHumanDay는 애초에
        // 걸지 않는다.
        if (!surveyOrHistoryAllowed(req)) return send(res, 429, { error: "too many" });
        store.createUser(body.userId);
        if (!Array.isArray(body.entries)) return send(res, 400, { error: "entries must be an array" });
        const result = store.applyHistory(body.userId, body.entries.slice(0, 500));
        return send(res, 200, { ok: true, hits: result.hits, entriesSeen: result.entriesSeen });
      }

      if (p === "/api/feed" && req.method === "GET") {
        // 트래픽 실측: 피드 요청 1회 = 실사용 1회 (userId로 고유 방문자 집계).
        // 내부 점검(배포 preflight·운영 확인)은 x-nowhot-check 헤더로 자기
        // 정체를 밝히고, 방문자로 세지 않는다 — 2026-08-09 실측: 8/6 방문자
        // 266명 중 94명이 preflight였다(그날 배포 80회 = 가짜 방문자 80명).
        if (!req.headers["x-nowhot-check"]) {
          try { store.recordTraffic("feed", url.searchParams.get("userId")); } catch {}
        }
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
        // "deals" — 핫딜 모아보기(David 2026-08-06). 엔진에는 이미 구현돼
        // 있었는데 **이 라우트가 값을 막고 있어서** 화면에서 쓸 수 없었다.
        const rawSort = url.searchParams.get("sort");
        const sort = rawSort === "latest" ? "latest" : rawSort === "deals" ? "deals" : "hot";
        // 카테고리 보기 — 예전엔 화면에서 이미 그려진 카드를 숨기기만 했다.
        // 그래서 홈 20개 중 그 카테고리가 2개면 2개만 보였다(David 2026-08-07).
        const rawCat = url.searchParams.get("category");
        const category = rawCat && isKnownCategory(rawCat) ? rawCat : null;
        const feed = await engine.getFeed(userId, { cursor, limit, source, sort, category });
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
        // 검사가 없으면 userId만 알아도 남의 푸시 구독을 자기 엔드포인트로
        // 덮어써 알림을 가로챌 수 있다(적대적 검수 2026-08-06).
        if (denied(body.userId)) return;
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
        try {
          const item = await engine.getItem(userId, itemId, { explain: true });
          if (!item) return send(res, 404, { error: "not found", code: "ITEM_UNAVAILABLE" });
          return send(res, 200, item);
        } catch (err) {
          if (err.status === 403) return send(res, 403, { error: err.message, code: err.code });
          throw err;
        }
      }

      if (p === "/api/signal" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const result = await engine.signal(body.userId, body.itemId, {
          type: body.type,
          dwellMs: Number(body.dwellMs || 0)
        });
        // qualifying 신호 중 "open"만 사람 증거로 친다(src/feed/audience.js).
        // dwell·complete는 몰입 모드가 스크롤만으로 자동 발화하는 것과 서버가
        // 구분할 수 없어 제외했다(적대적 검수 2026-08-09 라운드2) — skip도
        // 원래부터 제외.
        if (body.type === "open" && classifyAudience(req) === "observed") {
          try { store.markHumanDay(body.userId); } catch {}
        }
        return send(res, 200, result);
      }

      // Ad/affiliate slot event logging (docs/monetization.md section D).
      // Slot items are generated fresh per request (monetize.js) and never
      // live in the engine's collected pool, so this goes straight to the
      // store rather than through engine.signal (which does an item lookup
      // that would always miss for a slot id).
      // **익명도 받는다**(2026-08-06). 발행 페이지 방문자 대부분이 세션 없는
      // 검색 유입이라 userId를 요구하면 그 노출이 통째로 안 잡힌다.
      // sendBeacon으로도 오므로 응답 본문을 기다리지 않게 짧게 닫는다.
      //
      // 다만 **아무 값이나 받지는 않는다**(적대적 검수 2026-08-06 P1, 재현됨).
      // 인증이 없으니 임의의 slot 문자열 3,000개를 0.8초에 밀어 넣을 수 있었고,
      // 그러면 (1) 관리자 화면의 자리별 성과가 통째로 거짓이 되고
      // — 우리는 그 표로 광고 배치를 정한다 —
      // (2) adSlotStats에 키가 무한히 늘어 저장 파일이 부풀고, 결국 지연 저장이
      // 커진 파일을 계속 쓰게 된다(홈 TTFB 4초 사고와 같은 구조).
      //
      // 자리 이름은 **우리가 코드에 박아 둔 리터럴뿐**이다. 목록 밖의 값은
      // 집계에 넣지 않는다. 지우지 않고 "unknown" 한 칸으로 몰아 두어,
      // 누가 이상한 값을 밀어 넣고 있다는 사실 자체는 보이게 남긴다.
      if (p === "/api/ad-signal" && req.method === "POST") {
        let body = null;
        try { body = await readBody(req); } catch { body = null; }
        if (!body) return send(res, 400, { error: "bad body" });
        if (body.userId && !store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const type = body.type === "click" || body.type === "impression" ? body.type : null;
        if (!type) return send(res, 400, { error: "type must be impression or click" });
        const raw = typeof body.slot === "string" ? body.slot.slice(0, 40) : null;
        const slot = raw ? (KNOWN_AD_SLOT.test(raw) ? raw : "unknown") : null;
        if (!adSignalAllowed(req)) return send(res, 429, { error: "too many" });
        const page = typeof body.page === "string" ? body.page.slice(0, 60) : null;
        const stats = store.recordAdEvent(body.userId || null, body.itemId, type,
          { variant: body.variant, slot, page });
        return send(res, 200, { ok: true, stats });
      }

      // 행동 이벤트 수집 (analytics.js). sendBeacon으로 오므로 응답 본문을
      // 기다리지 않는다 — 204로 즉시 닫는다. 인증은 걸지 않는다: 익명 방문자의
      // 유입 경로가 우리가 가장 알고 싶은 것이고, userId가 없어도 집계는 된다.
      if (p === "/api/track" && req.method === "POST") {
        // 무인증 배치 수집 자리라 임의 이벤트를 밀어 넣으면 analytics 버킷이
        // 부풀 수 있다(ad-signal이 이미 겪은 것과 같은 구조) — 같은 골격의
        // IP 분당 상한을 건다(적대적 검수 REVISE #4).
        if (!trackAllowed(req)) return send(res, 429, { error: "too many" });
        let body = null;
        try { body = await readBody(req); } catch { body = null; }
        const events = body && Array.isArray(body.events) ? body.events : null;
        if (!events) { res.writeHead(204); return res.end(); }
        try {
          store.recordEvents(events, {
            userId: body.userId && store.getUser(body.userId) ? body.userId : null,
            selfHost: (req.headers.host || "").split(":")[0].toLowerCase(),
            // "view"+entry 이벤트(그 화면에 처음 도착)에서 시간대·기기를
            // 함께 센다. 홈 앱과 발행 페이지(브리핑·랭킹 등)가 같은 Track
            // 파이프라인을 쓰므로 이 한 곳이 두 표면을 다 덮는다 — 검색
            // 유입 착지점만 UA 관문이 빠지던 문제(검수 지적)의 해법.
            ua: req.headers["user-agent"] || null
          });
        } catch {}
        res.writeHead(204);
        return res.end();
      }

      if (p === "/api/rate" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        // signal 화이트리스트 — signal:99 같은 임의 값이 그대로 수용되면
        // 취향 벡터가 한 번에 오염된다(적대적 검수 P1-c, API 페르소나 실측).
        if (![1, 0, -1].includes(body.signal)) return send(res, 400, { error: "signal must be 1, 0, or -1" });
        const result = await engine.rate(body.userId, body.itemId, body.signal);
        // 평가 버튼 클릭 — qualifying 신호(src/feed/audience.js).
        if (classifyAudience(req) === "observed") { try { store.markHumanDay(body.userId); } catch {} }
        return send(res, 200, result);
      }

      if (p === "/api/comment" && req.method === "POST") {
        const body = await readBody(req);
        if (denied(body.userId)) return;
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          const comment = store.addComment(body.userId, body.itemId, body.body);
          // 댓글 작성 — qualifying 신호. 규칙 위반으로 실패한 시도는 아래
          // catch로 빠지므로 성공한 경우만 여기서 마킹된다.
          if (classifyAudience(req) === "observed") { try { store.markHumanDay(body.userId); } catch {} }
          return send(res, 200, comment);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      // --- admin API (token-guarded) ---
      if (p.startsWith("/api/admin/")) {
        if (!isAdmin(req, url)) return send(res, 401, { error: "admin auth required" });
        if (p === "/api/admin/feedback" && req.method === "GET") {
          return send(res, 200, { requests: (store.serviceFeedback || []).slice(-200).reverse() });
        }

        if (p === "/api/admin/product-blueprint" && req.method === "GET") {
          const localEditorialEvidence = await localEditorialEvidenceSnapshot();
          return send(res, 200, {
            blueprint: projectProductBlueprint(registry, { localEditorialEvidence })
          });
        }
        if (p === "/api/admin/editorial-review-freeze" && req.method === "POST") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          try {
            const { record, reused } = await freezeCurrentEditorialReviewPacket();
            return send(res, 200, {
              ok: true,
              stableId: "NOWHOT-REVIEW-PACKET-FREEZE-001",
              state: reused ? "review_packet_reused" : "review_packet_frozen",
              persisted: true,
              reused,
              packetId: record.packetId,
              editionId: record.editionId,
              issueCount: record.packet.rows.length,
              packetState: record.packet.state,
              frozenAt: record.frozenAt,
              canonicalEditionMutated: false,
              externalLlmCalls: 0
            });
          } catch (error) {
            const known = new Set([
              "EDITORIAL_REVIEW_PERSISTENCE_REQUIRED",
              "EDITORIAL_REVIEW_ACTIVE_IN_PROGRESS",
              "EDITORIAL_REVIEW_PACKET_HOLD"
            ]);
            if (known.has(error && error.code)) {
              return send(res, 409, {
                error: error.message,
                code: error.code,
                freeze: error.freeze || null
              });
            }
            throw error;
          }
        }
        if (p === "/api/admin/editorial-desk" && req.method === "GET") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          const reviewerId = url.searchParams.get("reviewerId") || "";
          if (!new Set(["reviewer-a", "reviewer-b"]).has(reviewerId)) {
            return send(res, 400, { error: "reviewerId must be reviewer-a or reviewer-b" });
          }
          const evidence = await localEditorialEvidenceSnapshot();
          const packet = evidence && evidence.reviewPacket;
          if (!packet) return send(res, 409, { error: "review packet is not ready" });
          const review = store.getEditorialReview(packet.packetId, packet.editionId, reviewerId);
          const humanReview = summarizeHumanReview(
            packet,
            store.getEditorialReview(packet.packetId, packet.editionId)
          );
          return send(res, 200, buildEditorialReviewDesk({
            packet,
            reviewerId,
            review,
            humanReview
          }));
        }
        if (p === "/api/admin/editorial-review" && req.method === "GET") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          const reviewerId = url.searchParams.get("reviewerId") || "";
          if (!new Set(["reviewer-a", "reviewer-b"]).has(reviewerId)) {
            return send(res, 400, { error: "reviewerId must be reviewer-a or reviewer-b" });
          }
          const evidence = await localEditorialEvidenceSnapshot();
          const packet = evidence && evidence.reviewPacket;
          if (!packet) return send(res, 409, { error: "review packet is not ready" });
          const review = store.getEditorialReview(packet.packetId, packet.editionId, reviewerId);
          const summary = summarizeHumanReview(
            packet,
            store.getEditorialReview(packet.packetId, packet.editionId)
          );
          return send(res, 200, {
            packetId: packet.packetId,
            editionId: packet.editionId,
            reviewerId,
            annotations: review && review.annotations || [],
            savedAt: review && review.savedAt || null,
            humanReview: summary
          });
        }
        if (p === "/api/admin/editorial-review" && req.method === "POST") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          const body = await readBody(req);
          const reviewerId = String(body.reviewerId || "");
          if (!new Set(["reviewer-a", "reviewer-b"]).has(reviewerId)) {
            return send(res, 400, { error: "reviewerId must be reviewer-a or reviewer-b" });
          }
          const evidence = await localEditorialEvidenceSnapshot();
          const packet = evidence && evidence.reviewPacket;
          if (!packet) return send(res, 409, { error: "review packet is not ready" });
          if (body.packetId !== packet.packetId || body.editionId !== packet.editionId) {
            return send(res, 409, { error: "review packet changed; reload before saving" });
          }
          const rows = new Set(packet.rows.map((row) => row.blindId));
          const incoming = Array.isArray(body.annotations) ? body.annotations : [];
          const incomingIds = incoming.map((annotation) => annotation && annotation.blindId);
          if (new Set(incomingIds).size !== incomingIds.length) {
            return send(res, 400, { error: "annotations must not duplicate blind review rows" });
          }
          const annotations = incoming.filter((annotation) => rows.has(annotation && annotation.blindId)).map((annotation) => {
            const normalized = { blindId: annotation.blindId };
            for (const field of HUMAN_REVIEW_FIELDS) normalized[field] = typeof annotation[field] === "boolean" ? annotation[field] : null;
            normalized.notes = String(annotation.notes || "").trim().slice(0, 500);
            return normalized;
          });
          if (annotations.length !== packet.rows.length) {
            return send(res, 400, { error: "annotations must include every blind review row" });
          }
          const saved = store.saveEditorialReview(packet.packetId, packet.editionId, reviewerId, annotations);
          localEditorialEvidenceCache.at = 0;
          localEditorialEvidenceCache.value = null;
          const summary = summarizeHumanReview(
            packet,
            store.getEditorialReview(packet.packetId, packet.editionId)
          );
          return send(res, 200, {
            ok: true,
            packetId: packet.packetId,
            editionId: packet.editionId,
            reviewerId,
            annotations: saved.annotations,
            savedAt: saved.savedAt,
            humanReview: summary
          });
        }
        if (p === "/api/admin/editorial-review-packet" && req.method === "POST") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          const body = await readBody(req);
          const evidence = await localEditorialEvidenceSnapshot();
          const activePacket = evidence && evidence.reviewPacket;
          if (!activePacket) return send(res, 409, { error: "review packet is not ready" });
          const target = store.getEditorialReviewPacket(String(body.packetId || ""), String(body.editionId || ""));
          if (!target) return send(res, 404, { error: "review packet was not found" });
          const currentLedger = store.getEditorialReview(activePacket.packetId, activePacket.editionId);
          const currentSummary = summarizeHumanReview(activePacket, currentLedger);
          const hasProgress = hasHumanReviewWork(currentLedger);
          const terminal = new Set(["human_quality_pass", "human_adjudicated_pass", "human_quality_hold"]);
          if (`${activePacket.packetId}|${activePacket.editionId}` !== target.key && hasProgress && !terminal.has(currentSummary.state)) {
            return send(res, 409, { error: "active review has unfinished annotations or adjudication" });
          }
          const activated = store.activateEditorialReviewPacket(target.packetId, target.editionId);
          localEditorialEvidenceCache.at = 0;
          localEditorialEvidenceCache.value = null;
          return send(res, 200, {
            ok: true,
            packetId: activated.packetId,
            editionId: activated.editionId,
            frozenAt: activated.frozenAt
          });
        }
        if (p === "/api/admin/editorial-review-adjudication" && req.method === "POST") {
          if (!localEditorial) return send(res, 404, { error: "local editorial review is disabled" });
          const body = await readBody(req);
          const evidence = await localEditorialEvidenceSnapshot();
          const packet = evidence && evidence.reviewPacket;
          if (!packet) return send(res, 409, { error: "review packet is not ready" });
          if (body.packetId !== packet.packetId || body.editionId !== packet.editionId) {
            return send(res, 409, { error: "active review packet changed; reload before adjudicating" });
          }
          const ledger = store.getEditorialReview(packet.packetId, packet.editionId);
          const before = summarizeHumanReview(packet, ledger);
          if (!before.comparisonReady) return send(res, 409, { error: "both reviewers must finish before adjudication" });
          const required = new Set(before.adjudication.rows.map((row) => `${row.blindId}|${row.field}`));
          const incoming = Array.isArray(body.resolutions) ? body.resolutions : [];
          const incomingKeys = incoming.map((row) => `${row && row.blindId}|${row && row.field}`);
          if (new Set(incomingKeys).size !== incomingKeys.length) {
            return send(res, 400, { error: "adjudication resolutions must not contain duplicates" });
          }
          if (incomingKeys.length !== required.size || incomingKeys.some((key) => !required.has(key))) {
            return send(res, 400, { error: "adjudication must include every disagreement field and no other fields" });
          }
          const resolutions = incoming.map((row) => ({
            blindId: row.blindId,
            field: row.field,
            value: typeof row.value === "boolean" ? row.value : null,
            notes: String(row.notes || "").trim().slice(0, 500)
          }));
          const saved = store.saveEditorialReviewAdjudication(
            packet.packetId,
            packet.editionId,
            "editorial-adjudicator",
            resolutions
          );
          localEditorialEvidenceCache.at = 0;
          localEditorialEvidenceCache.value = null;
          const summary = summarizeHumanReview(
            packet,
            store.getEditorialReview(packet.packetId, packet.editionId)
          );
          return send(res, 200, {
            ok: true,
            packetId: packet.packetId,
            editionId: packet.editionId,
            savedAt: saved.savedAt,
            humanReview: summary
          });
        }
        if (p === "/api/admin/traffic" && req.method === "GET") {
          // days 상한 31 — engaged 계산이 uids×users 조인이라 워스트(10만 uid)
          // ×90일이면 ~수백 ms 동기 블록이 된다(검수 실측 14일 워스트 85~96ms).
          const tDays = Math.min(31, Math.max(1, Number(url.searchParams.get("days")) || 14));
          return send(res, 200, { days: store.trafficStats(tDays) });
        }
        // 날짜 선택기용 기간 조회 — live traffic(90일)+trafficArchive(400일)
        // 합산. 응답은 스파스 필드만(행마다 top-N 배열을 싣지 않는다 — 검수).
        if (p === "/api/admin/traffic-range" && req.method === "GET") {
          const from = url.searchParams.get("from") || "";
          const to = url.searchParams.get("to") || "";
          const g = url.searchParams.get("granularity") || "day";
          const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
          if (!DATE_RE.test(from) || !DATE_RE.test(to)) return send(res, 400, { error: "from/to must be YYYY-MM-DD" });
          if (!["day", "week", "month"].includes(g)) return send(res, 400, { error: "granularity must be day|week|month" });
          const fromMs = Date.parse(from + "T00:00:00Z");
          const toMs = Date.parse(to + "T00:00:00Z");
          // 존재하지 않는 날짜(2월 30일 등)는 Date.parse가 NaN — 아래 비교가 걸러낸다.
          if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return send(res, 400, { error: "invalid range: from must be a real date <= to" });
          const spanDays = (toMs - fromMs) / 86400000 + 1;
          // 400일 상한 — trafficArchive 보존과 같은 창. 그 밖은 데이터가 없다.
          if (spanDays > 400) return send(res, 400, { error: "range must be <= 400 days" });
          return send(res, 200, { from, to, granularity: g, rows: store.trafficRange(from, to, g) });
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
          // 판정(health.js)은 수집 사이클마다 engine.refresh가 계산해 둔다.
          // 여기서 다시 세지 않는 이유: "언제부터 0건인가"는 지금 이 순간의
          // 스냅샷으로는 알 수 없고, 사이클마다 쌓아 둔 기록에서만 나온다.
          const health = new Map((engine.health() || []).map((h) => [h.id, h]));
          const sources = registry.map((c) => {
            const h = health.get(c.id);
            return {
              id: c.id,
              label: c.label,
              category: c.category,
              kind: c.kind,
              enabled: c.enabled === true,
              disabled: disabled.has(c.id),
              seed: Boolean(c.adapter && c.adapter.type === "seed"),
              liveCount: counts[c.id] || 0,
              // 아래 넷이 이번에 추가된 것 — 건수만으로는 "38건 들어오는데
              // 반응 수치가 전부 0"인 파서 고장을 잡을 수 없었다.
              withSignal: h ? h.withSignal : null,
              expectsSignal: h ? h.expectsSignal : null,
              status: h ? h.status : null,
              statusReason: h ? h.reason : null
            };
          });
          const bad = { down: 0, signalLost: 0, stalled: 0 };
          for (const s2 of sources) {
            if (s2.status === "down") bad.down++;
            else if (s2.status === "signal-lost") bad.signalLost++;
            else if (s2.status === "stalled") bad.stalled++;
          }
          return send(res, 200, { sources, alerts: bad, checkedAt: engine.lastRefreshedAt || null });
        }
        // 행동 분석 — 일/주/월. 기간 축만 바꿔 같은 표를 그린다.
        if (p === "/api/admin/analytics" && req.method === "GET") {
          const g = url.searchParams.get("granularity") || "day";
          const granularity = ["day", "week", "month"].includes(g) ? g : "day";
          const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit")) || 30));
          let buckets = store.analyticsBuckets();
          // 날짜 선택기 지원(2026-08-09) — from/to가 오면 그 구간의 일 버킷만
          // 남기고 롤업한다. 기존 limit 호출은 그대로 동작(호환 유지).
          const aFrom = url.searchParams.get("from");
          const aTo = url.searchParams.get("to");
          let effLimit = limit;
          if (aFrom || aTo) {
            const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
            if (!DATE_RE.test(aFrom || "") || !DATE_RE.test(aTo || "") || aFrom > aTo) {
              return send(res, 400, { error: "from/to must be YYYY-MM-DD and from <= to" });
            }
            const filtered = {};
            for (const [k, v] of Object.entries(buckets)) if (k >= aFrom && k <= aTo) filtered[k] = v;
            buckets = filtered;
            effLimit = 400; // 구간을 이미 좁혔으니 그 안은 전부 준다(보존 상한과 동일)
          }
          const rows = series(buckets, granularity, effLimit);
          // 최신 기간의 상세(출처·화면·클릭·광고 표)를 함께 준다 — 화면이
          // 한 번 더 왕복하지 않도록.
          return send(res, 200, { granularity, rows, latest: rows[rows.length - 1] || null });
        }

        // 지출·손익. 실비는 실측(토큰×공개단가), 고정비와 매출은 David 입력값.
        // ── 광고 연결 현황 (David 2026-08-05: 관리자에 광고 메뉴)
        //
        // 지어내지 않는 것이 이 화면의 전부다. 연결 여부는 환경변수가 실제로
        // 있는지로만 말하고, 노출·클릭은 우리가 센 값만 쓰며, **정산 금액은
        // 연동된 곳이 하나도 없으므로 비워 둔다.** 시크릿 값은 응답에 담지 않는다 —
        // 있다/없다만 판정한다(David 원칙: 자격증명을 화면으로 옮기지 않는다).
        if (p === "/api/admin/ads" && req.method === "GET") {
          const dayMs = 24 * 3600 * 1000;
          const now = Date.now();
          const events = store.adEvents || [];
          const today = splitMeasured(events, now - dayMs);
          const week = splitMeasured(events, now - 7 * dayMs);
          return send(res, 200, {
            wired: readWiredStatus(process.env),
            candidates: CANDIDATE_NETWORKS,
            reference: REFERENCE_ADSTXT,
            measured: {
              // 애드핏은 SDK가 자체 집계하므로 우리 쪽 숫자에 안 잡힌다.
              // 그 사실을 숨기지 않는다 — 0을 "성과 없음"으로 오독하면 안 된다.
              scope: "우리가 직접 센 것만 (쿠팡 제휴 카드). 애드핏·애드센스는 각 콘솔에서 본다.",
              // 쿠팡 콘솔과 숫자가 다른 이유를 화면에 함께 준다 — 안 그러면
              // 둘 중 하나가 틀린 것으로 읽힌다(David 2026-08-07 실제 제보).
              caveats: MEASURE_CAVEATS,
              today: { ...today.coupang, ctr: ctr(today.coupang.impressions, today.coupang.clicks) },
              week: { ...week.coupang, ctr: ctr(week.coupang.impressions, week.coupang.clicks) },
              // 쿠팡이 아닌 광고 이벤트(우리 딜·카테고리 링크 등)를 따로 보여준다.
              // 예전엔 이것까지 쿠팡으로 세고 있었다.
              todayOther: today.unknown,
              weekOther: week.unknown,
              // 자리별 성과. 발행 페이지 배너가 어느 자리에서 눌리는지는
              // 여기 말고 볼 곳이 없다 — 쿠팡 콘솔은 subId만 알고, 그 subId가
              // 어느 화면의 몇 번째 칸인지는 우리만 안다.
              slots7d: store.adSlotReport(7)
            },
            revenue: {
              // 정산 API가 연결된 곳이 없다. 추정치를 넣지 않는다.
              connected: false,
              note: "정산 연동은 아직 없다. 애드센스·쿠팡은 API가 있어 붙일 수 있고, 애드핏은 API가 없어 손으로 넣어야 한다.",
              manualHint: "수익·지출 탭에 실제 정산액을 입력하면 손익이 계산된다."
            }
          });
        }

        if (p === "/api/admin/finance" && req.method === "GET") {
          const month = url.searchParams.get("month") || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
          const costBuckets = store.costBuckets();
          const days = Object.keys(costBuckets).filter((d) => d.startsWith(month));
          // 그 달에 지출 기록이 없는 날도 고정비는 발생한다 — 달의 모든 날을 쓴다.
          const allDays = [];
          const dim = daysInMonth(month);
          for (let i = 1; i <= dim; i++) allDays.push(`${month}-${String(i).padStart(2, "0")}`);
          const merged = mergeCostBuckets(days.map((d) => costBuckets[d]));
          const revenue = store.revenueAll()[month];
          const pl = profitAndLoss({
            costBucket: merged,
            fixedByMonth: store.fixedCostsAll(),
            days: allDays,
            revenueKrw: revenue == null ? null : revenue
          });
          return send(res, 200, {
            month, usage: merged, pl,
            fixed: store.fixedCostsAll()[month] || null,
            months: [...new Set([...Object.keys(costBuckets).map((d) => d.slice(0, 7)), ...Object.keys(store.fixedCostsAll())])].sort()
          });
        }

        if (p === "/api/admin/finance" && req.method === "POST") {
          const body = await readBody(req);
          const month = typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
          if (!month) return send(res, 400, { error: "month must be YYYY-MM" });
          const out = {};
          if (Array.isArray(body.fixed)) out.fixed = store.setFixedCosts(month, body.fixed);
          if (body.revenueKrw != null) out.revenueKrw = store.setRevenue(month, body.revenueKrw);
          return send(res, 200, { ok: true, month, ...out });
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
        // ── 우리 딜 (애드핏 P0-A ①) ────────────────────────────────────
        if (p === "/api/admin/our-deals" && req.method === "GET") {
          return send(res, 200, { deals: store.ourDeals() });
        }
        if (p === "/api/admin/our-deal" && req.method === "POST") {
          const body = await readBody(req);
          try {
            const deal = store.createOurDeal(body || {});
            // **캐시를 비우지 않는다.** invalidate()는 노출 후보(_cache)를 지우는데,
            // 그러면 다음 요청이 84개 소스를 전부 다시 수집할 때까지 막힌다 —
            // 딜 하나 등록하고 홈이 40초 넘게 멈췄다(2026-08-06 실측).
            // 대신 재수집을 **뒤에서** 돌린다. 그동안 응답은 기존 캐시로 나가고,
            // 수집이 끝나면 새 딜이 자연히 들어온다.
            engine.refresh().catch(() => {});
            return send(res, 200, { ok: true, deal });
          } catch (e) {
            // 입력 문제는 400이다 — 500으로 던지면 화면이 "서버 고장"으로 읽는다.
            return send(res, 400, { error: e.message });
          }
        }
        if (p === "/api/admin/our-deal-delete" && req.method === "POST") {
          const body = await readBody(req);
          const gone = store.deleteOurDeal(String(body.id || ""));
          if (gone) engine.refresh().catch(() => {});   // 위와 같은 이유로 캐시를 비우지 않는다
          return send(res, 200, { ok: gone });
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
      if (p === "/admin/editorial-desk" && req.method === "GET") return serveStatic(res, "/editorial-desk.html");
      // 정책 페이지는 확장자 없는 주소로도 열린다. 심사관·크롤러·다른 사이트가
      // 관행적으로 /privacy, /terms, /about을 치는데 예전엔 전부 404였다
      // (2026-08-04 실측). 링크가 죽으면 "필수 페이지 없음"으로 판정된다.
      const STATIC_ALIASES = { "/privacy": "/privacy.html", "/terms": "/terms.html", "/about": "/about.html", "/feedback": "/feedback.html" };
      if (STATIC_ALIASES[p] && req.method === "GET") return serveStatic(res, STATIC_ALIASES[p]);

      // --- shareable link with OG tags (crawlers read this; humans bounce to app) ---
      if (p === "/p" && req.method === "GET") {
        const id = url.searchParams.get("id");
        const data = id ? await engine.shareData(id) : null;
        const origin = originOf(req);
        res.writeHead(data ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        res.end(sharePage(data, origin, id));
        return;
      }

      // --- editorial home + live client ---
      if ((p === "/" || p === "/live") && req.method === "GET") {
        // 내부 점검은 PV로도 안 센다 (위 /api/feed와 같은 이유).
        if (!req.headers["x-nowhot-check"]) {
          try { store.recordTraffic("page"); } catch {}
        }
      }
      if (p === "/" && req.method === "GET") {
        if (localEditorial) {
          // 오늘판은 기존 쿠팡 재고를 본문·상세에서 사용한다 (David, NH118).
          return serveStatic(res, "/today.html");
        }
        res.writeHead(307, { location: "/live", "cache-control": "no-cache" });
        return res.end();
      }
      if (p === "/index.html" && req.method === "GET") {
        res.writeHead(308, { location: "/live", "cache-control": "no-cache" });
        return res.end();
      }
      if (p === "/live" && req.method === "GET") {
        const cached = homeSeedSnapshot();
        return serveStatic(res, "/index.html", cached.seed);
      }
      if (req.method === "GET") {
        return serveStatic(res, p);
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
    // 홈 SSR seed를 미리 만들어 둔다. 만드는 일이 요청 밖으로 나갔으니
    // 아무도 안 부르면 첫 방문자(또는 심사 봇)가 빈 자체 콘텐츠 블록을 본다.
    // 요청 한 번이 곧 "만들어 둬라"라서, 우리가 먼저 한 번 부른다.
    setTimeout(() => {
      fetch(`http://127.0.0.1:${port}/`).catch(() => {});
      fetch(`http://127.0.0.1:${port}/report`).catch(() => {});
      // 첫 호출은 캐시가 비어 있어 배경 작업만 걸어 놓고 끝난다.
      // 다 만들어졌을 때쯤 한 번 더 불러 캐시가 실제로 찼는지 확인한다.
      setTimeout(() => {
        fetch(`http://127.0.0.1:${port}/`).catch(() => {});
        fetch(`http://127.0.0.1:${port}/report`).catch(() => {});
      }, 20000);
    }, 3000).unref?.();
    if (process.env.FEED_DB) console.log(`persisting to ${process.env.FEED_DB}`);
  });
}
