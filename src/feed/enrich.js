import { decodeEntities } from "./html-text.js";
import { discardBody } from "./fetchers.js";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { isGoogleNewsRedirect } from "./canonical-url.js";
// 썸네일 보강(enrichment) — image가 없는 피드 아이템의 원문 URL에서 og:image/
// twitter:image "URL 문자열"만 뽑아 채워 넣는다.
//
// docs/legal.md 4번(이미지: 핫링크만, 저장·재호스팅 금지) 원칙을 그대로 따른다:
// 여기서 하는 일은 원문 서버가 이미 공개적으로 내보내는 대표 이미지 "링크"를
// 읽어오는 것뿐이다. 이미지 바이트 자체는 절대 다운로드/캐시/재서빙하지 않고,
// 클라이언트가 그 URL로 직접 핫링크(hotlink)한다 — 카카오톡/트위터 링크
// 미리보기와 동일한 모델.
//
// 403/404/타임아웃/네트워크 오류는 전부 "조용히" null로 처리한다(fetchOgImage).
// 이는 실수가 아니라 설계다: 403은 그 사이트가 명시적으로 요청을 거부한
// 것이므로 헤더 위조나 재시도로 우회하지 않는다(로봇배제·ToS 준수, 위
// docs/legal.md의 "robots.txt/ToS 허용 범위 내에서만" 원칙). 콘솔 스팸도
// 남기지 않는다 — 피드 소스가 수백 개인 운영 환경에서 이미지 하나 실패했다고
// 로그를 채우면 진짜 장애 신호가 묻힌다.
//
// 부정 캐시(negative cache, negativeTtlMs)가 필요한 이유: og:image가 없는
// 페이지는 다음 수집 주기에도 여전히 없을 확률이 압도적으로 높다. 캐시가
// 없으면 사이클마다 같은 URL을 계속 두드리게 되고, 이는 곧 "실패하는 요청을
// 반복 발사"하는 것 — 우리가 지양하는 재시도 폭탄과 본질이 같다. 성공 캐시
// (ttlMs)는 반대로 원문 서버가 og:image를 자주 바꾸지 않는다는 전제로, 이미
// 알아낸 URL을 매 사이클 재조회하지 않기 위한 것이다.

const DEFAULT_UA = "ai-command-bus-feed/0.1 (+https://github.com/comeva2kr/ai-command-bus)";

const MAX_HTML_BYTES = 200 * 1024; // og 메타는 <head>에 있다 — 200KB면 충분하고, 그 이상은 읽지 않는다
const ARTICLE_HTML_MAX_BYTES = 700 * 1024;
const ARTICLE_TEXT_MAX = 16000;
const ARTICLE_TEXT_MIN = 250;

// 2026-07-31 확장 (David: "상세창에 무조건 본문내용 축약버전을"): 같은 HTML
// 요청에서 og:description/meta description도 뽑아 summary가 빈 아이템의
// 발췌로 쓴다. 본문 스크래핑이 아니다 — 원문 사이트가 링크 미리보기용으로
// 스스로 공개한 요약 메타데이터이며, docs/legal.md의 발췌 상한(200자)을
// 그대로 적용한다.

// --- extractOgImage: 순수 문자열 파싱, 네트워크 없음 -----------------------

const IMG_META_NAMES = ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"];
const DESC_META_NAMES = ["og:description", "twitter:description", "description"];
const EXCERPT_MAX = 200; // docs/legal.md 발췌 상한
const EXCERPT_MIN = 15; // 이보다 짧으면 사이트명 따위일 뿐 발췌가 아니다


// name 하나에 대해 content 값을 찾는다. 정방향(property 먼저, content 나중)과
// 역방향(content가 property/name보다 먼저 오는 마크업 — 실제로 종종 있다) 둘
// 다 시도한다.
function metaContent(html, name) {
  const forward = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const m1 = html.match(forward);
  if (m1) return m1[1];
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
    "i"
  );
  const m2 = html.match(reversed);
  if (m2) return m2[1];
  return null;
}

// og:image → og:image:secure_url → twitter:image → twitter:image:src 순서로
// 첫 매치를 채택한다. 상대 URL은 baseUrl 기준으로 절대화하고, http(s)가
// 아니면(예: data:, javascript:) null — 핫링크 대상은 반드시 실제 이미지
// 서버 URL이어야 한다.
// 로고·아이콘·추적픽셀처럼 대표 이미지가 될 수 없는 URL 패턴 (본문 폴백 전용)
const NON_CONTENT_IMG = /(logo|icon|sprite|avatar|profile|blank|spacer|pixel|1x1|banner_|btn_|emoticon)/i;

// 대표 이미지가 될 수 없는 URL — **모든 후보**(og/twitter/영상/본문)에 적용한다.
//
// 2026-08-03 실측(David: "82쿡 사진 x박스, 오유도 일부, 뉴스 일부"). 라이브 피드
// 39개 호스트를 실제로 받아 보니 깨지는 건 핫링크 차단이 아니라 전부 **파서가
// 본문 사진 대신 사이트 장식물을 집어온** 경우였다:
//   - 82쿡    https://www.82cook.com//banner/data/20130725_kit.gif
//             2013년 배너 광고. 게다가 그 호스트는 443 포트가 닫혀 있어
//             https로는 ECONNREFUSED — 브라우저에서 무조건 깨진다.
//   - 오늘의유머 http://thimg.todayhumor.co.kr/test.png
//             페이지에 박혀 있는 플레이스홀더. 404.
//   - 인스티즈  https://img.youtube.com/vi/player/cliplink/<네이버클립ID>/mqdefault.jpg
//             유튜브 영상 ID 자리에 네이버TV 클립 ID가 들어가 404.
// 기존 NON_CONTENT_IMG는 본문 폴백에만 걸려서 og:image로 들어온 것들을 못 막았다.
const JUNK_IMG_PATH = /(?:^|\/)(?:banner|banners|ad|ads|adimg)\//i;
const JUNK_IMG_FILE = /(?:^|\/)(?:test|sample|noimage|no_image|noimg|default|dummy|thumb_default)\.(?:png|jpe?g|gif|webp)$/i;
const GENERIC_IMG_FILE = /(?:^|\/)(?:[^/]*(?:[_-]default|default[_-]|placeholder)[^/]*|headtitle|logo-news-sns|kakao_theqoo|search[_-]s|spinner)\.(?:png|jpe?g|gif|webp|svg)$/i;
const JUNK_IMG_HOST = /^(?:lh\d+\.googleusercontent\.com|encrypted-tbn\d*\.gstatic\.com)$/i;

// 유튜브 썸네일은 경로가 /vi/<11자 영상ID>/... 여야 한다. 다른 서비스의 클립
// ID를 끼워 넣은 URL은 200처럼 보여도 실제로는 404다.
function badYoutubeThumb(u) {
  if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/(^|\.)ytimg\.com$/i.test(u.hostname)) return false;
  const m = u.pathname.match(/^\/vi\/([^/]+)\//);
  return !m || !/^[\w-]{11}$/.test(m[1]);
}

// 후보 URL이 대표 이미지로 쓸 수 없는 것인지 판정. 절대 URL(URL 객체)을 받는다.
export function isJunkImage(u) {
  if (JUNK_IMG_HOST.test(u.hostname)) return true;
  if (u.hostname === "ssl.gstatic.com" && /\/news\//i.test(u.pathname)) return true;
  if (JUNK_IMG_PATH.test(u.pathname)) return true;
  if (JUNK_IMG_FILE.test(u.pathname)) return true;
  if (GENERIC_IMG_FILE.test(u.pathname)) return true;
  if (badYoutubeThumb(u)) return true;
  return false;
}

// 유튜브·비메오 임베드에서 공개 썸네일 URL을 유도한다 — 영상 글도 대표
// 이미지를 갖게 하는 경로(David 2026-08-01: "첫번째 사진이나 영상을 썸네일로").
// 두 서비스 모두 공개 썸네일 엔드포인트를 제공하므로 핫링크 원칙 그대로다.
function videoThumb(html) {
  const yt = String(html).match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  return null;
}

// 본문 첫 이미지 — og/twitter가 없을 때만. 로고·아이콘류는 걸러내고,
// width/height가 선언됐다면 너무 작은 것(150px 미만)은 버린다.
function firstContentImage(html) {
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    const url = decodeEntities(src).trim();
    if (!url || url.startsWith("data:")) continue;
    if (NON_CONTENT_IMG.test(url)) continue;
    const w = Number((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const h = Number((tag.match(/\bheight=["']?(\d+)/i) || [])[1] || 0);
    if ((w && w < 150) || (h && h < 150)) continue;
    return url;
  }
  return null;
}

export function extractOgImage(html, baseUrl) {
  if (!html) return null;
  const text = String(html);
  const candidates = [];
  for (const name of IMG_META_NAMES) {
    const raw = metaContent(text, name);
    if (raw !== null) candidates.push(decodeEntities(raw).trim());
  }
  // 폴백 순서: 메타 → 영상 썸네일 → 본문 첫 사진
  const vt = videoThumb(text);
  if (vt) candidates.push(vt);
  const fi = firstContentImage(text);
  if (fi) candidates.push(fi);

  for (const decoded of candidates) {
    if (!decoded) continue;
    let abs;
    try { abs = new URL(decoded, baseUrl); } catch { continue; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (isJunkImage(abs)) continue;
    return abs.toString();
  }
  return null;
}

// og:description → twitter:description → meta description 순 첫 매치.
// 엔티티 디코드 + 공백 정리 + 200자 컷. 사이트명 수준의 초단문은 버린다.
export function extractOgDesc(html) {
  if (!html) return null;
  const text = String(html);
  for (const name of DESC_META_NAMES) {
    const raw = metaContent(text, name);
    if (raw === null) continue;
    const cleaned = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (cleaned.length < EXCERPT_MIN) continue;
    return cleaned.length > EXCERPT_MAX ? cleaned.slice(0, EXCERPT_MAX - 1).trimEnd() + "…" : cleaned;
  }
  return null;
}

// --- fetchOgImage: 네트워크 1회, 조용한 실패 -------------------------------

// 스트림 reader로 응답 본문을 MAX_HTML_BYTES까지만 읽고 자른다. fetchImpl이
// 테스트 목처럼 스트리밍 body가 없는 단순 Response 흉내일 수도 있어 그 경우엔
// text()로 폴백한다.
// 문자셋 감지 디코드 — UTF-8 고정이면 EUC-KR 사이트(뽐뿌 등)의 og:description
// 이 "������"로 깨진 채 발췌에 들어간다(2차 검수 실측). content-type 헤더 →
// HTML meta charset 순으로 찾고, 못 찾으면 utf-8.
function decodeHtmlBytes(bytes, contentType) {
  let cs = (String(contentType || "").match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = new TextDecoder("utf-8").decode(bytes.slice(0, 2048));
    cs = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  }
  try {
    return new TextDecoder((cs || "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(res, maxBytes, contentType, { allowTextFallback = true } = {}) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    if (!allowTextFallback) return "";
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const chunks = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - received;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      received += chunk.byteLength;
      chunks.push(chunk);
    }
  } finally {
    try {
      reader.cancel().catch(() => {});
    } catch {
      // 이미 끝났거나 취소 불가한 스트림 — 무시
    }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return decodeHtmlBytes(buf, contentType);
}

function normalizeArticleText(value) {
  const text = decodeEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > ARTICLE_TEXT_MAX ? text.slice(0, ARTICLE_TEXT_MAX).trimEnd() : text;
}

export function cleanArticleTextChrome(value) {
  let text = normalizeArticleText(value);
  const hasHighsnobietyAppPrompt = /(?:계속(?:해서)?\s*)?(?:최신\s*)?소식을 받고 싶(?:지 않습니까|으십니까|으신가요)\?\s*지금 Highsnobiety 앱을 다운로드하세요\./i.test(text);
  text = text
    .replace(/전체\s*페이지를\s*읽으시려면\s*회원가입\s*(?:및|또는)\s*로그인을\s*해\s*주세요[.!?]*/gi, " ")
    .replace(/기사\s*제목\s*내용을\s*입력해\s*주세요[.!?]*(?:\s*삭제하시겠습니까[.!?]*)?(?:\s*등록이\s*완료되었습니다[.!?]*)?/gi, " ")
    .replace(/(?:계속(?:해서)?\s*)?(?:최신\s*)?소식을 받고 싶(?:지 않습니까|으십니까|으신가요)\?\s*지금 Highsnobiety 앱을 다운로드하세요\.\s*/gi, " ")
    .replace(/(^\s*|[.!?]["'’”]\s+)\bshop\s+[A-Z][A-Za-z0-9&'’.-]*(?:\s+[A-Z][A-Za-z0-9&'’.-]*){0,2}(?=\s+[가-힣]|$)\s*/g, "$1")
    .replace(/(^\s*|[.!?]["'’”]?\s+)(?:[A-Z][A-Za-z0-9&'’.-]*\s+){1,3}쇼핑하기(?=\s+[A-Za-z0-9]|$)\s*/g, "$1");
  if (hasHighsnobietyAppPrompt) {
    text = text.replace(/(^\s*|[.!?]["'’”]?\s+)(?:[A-Z][A-Za-z0-9&'’.-]*\s+){1,3}쇼핑(?=\s|$)\s*/g, "$1");
  }
  text = text
    .replace(/\s+/g, " ")
    .trim();

  const yonhapPromo = "연합뉴스만의 특별한 뉴스 서비스를 경험해보세요!";
  const yonhapGoogle = "구글 검색에서 연합뉴스 기사를 우선적으로 보여줍니다.";
  if (text.startsWith(yonhapPromo)) {
    const markerAt = text.slice(0, 1200).indexOf(yonhapGoogle);
    if (markerAt >= 0) text = text.slice(markerAt + yonhapGoogle.length).trim();
  }

  // 연합뉴스 사진 표기. 대괄호 크레딧은 실측 형식 네 가지만 지운다 — "[… 자료사진]",
  // "[촬영 이름]", "[… 제작] 사진합성·일러스트", "[… 제공. 재판매 및 DB 금지]". "[제작비 논란]",
  // "[촬영본 유출]" 같은 제목 라벨은 이 형식이 아니라 남는다(Grok 반례). 사진 설명은
  // "(장소=연합뉴스) 기자 = 설명. 2026.9.4 abc@yna.co.kr" 뒤에 진짜 본문 발신지가 다시 온다.
  // 마지막 "날짜 [이메일]" 다음에 발신지 표기가 이어질 때만 그 앞을 사진 설명으로 본다 —
  // 본문 속 날짜나 이메일 문장은 이 조건을 만족하지 않는다(NH123 #3·#16·#20·#23·#29·#31·#35).
  text = text
    .replace(/\[[^\[\]]{0,60}?(?:자료사진|촬영\s+[^\[\]]{1,20}|제공\.?\s*재판매\s*및\s*DB\s*금지)\]\s*/g, " ")
    .replace(/\[[^\[\]]{0,60}?제작\]\s*사진합성·일러스트\s*/g, " ");
  const yonhapDateline = /\b\d{4}\.\d{1,2}\.\d{1,2}\.?\s+(?:[\w.+-]+@yna\.co\.kr\s+)?(?=\((?:[^()]|\([^()]*\))*=연합뉴스\)\s)/g;
  let captionEnd = -1;
  for (const caption of text.slice(0, 1400).matchAll(yonhapDateline)) captionEnd = caption.index + caption[0].length;
  if (captionEnd > 0) text = text.slice(captionEnd).trim();

  const galleryMeta = text.slice(0, 1400).match(
    /(?:패션|Fashion)(?:\s*제공)?\s*\d+\s*시간\s*전\s*[\d,.]+\s*조회수\s*[\d,.]+\s*댓글(?:\s*댓글)*\s*저장(?:\s*요약)?\s*/u
  );
  if (galleryMeta) text = text.slice(galleryMeta.index + galleryMeta[0].length).trim();

  const head = text.slice(0, 700);
  const readAloud = head.match(/읽어주기 기능은 크롬기반의 브라우저에서만 사용하실 수 있습니다\.\s*AI 요약\s*/i);
  if (readAloud) text = text.slice(readAloud.index + readAloud[0].length).trim();

  const googleMedia = text.slice(0, 700).match(/Your browser does not support the audio element\.\s*구글 선호 매체 등록\s*/i);
  if (googleMedia) {
    text = text.slice(googleMedia.index + googleMedia[0].length).trim();
    const ad = text.slice(0, 180).match(/(?:^|\s)광고\s+/);
    if (ad) text = text.slice(ad.index + ad[0].length).trim();
  }

  const ytnHead = text.slice(0, 700);
  const arrows = [...ytnHead.matchAll(/-->/g)];
  if (arrows.length >= 3) text = text.slice(arrows.at(-1).index + 3).trim();

  const dongAHead = text.slice(0, 1200);
  if (/구글검색 선호 추가/.test(dongAHead)) {
    const printAt = dongAHead.indexOf("프린트");
    if (printAt >= 0) text = text.slice(printAt + "프린트".length).replace(/^\s*구독\s*/, "").trim();
  }

  const photoBig = text.slice(0, 350).match(/photo big-->/i);
  if (photoBig) text = text.slice(photoBig.index + photoBig[0].length).trim();

  const autoSummary = text.slice(0, 700).match(/요약보기 자동요약[\s\S]*?본문 보기를 권장합니다\./);
  if (autoSummary) text = text.slice(autoSummary.index + autoSummary[0].length).trim();

  const seoulHead = text.slice(0, 1200);
  if (/기사 (?:소리로 듣기|읽어주기)/.test(seoulHead)) {
    const preferred = "구글에서 서울신문 먼저 보기";
    const preferredAt = seoulHead.indexOf(preferred);
    if (preferredAt >= 0) text = text.slice(preferredAt + preferred.length).replace(/^\s*세줄 요약\s*/, "").trim();
  }

  const googlePreferred = text.slice(0, 700).match(/구글 검색 선호 매체 추가\s*/);
  if (googlePreferred) text = text.slice(googlePreferred.index + googlePreferred[0].length).trim();

  const imageViewer = text.slice(0, 500).match(/이미지 확대\s*닫기\s*이미지 확대 보기\s*/);
  if (imageViewer) text = text.slice(imageViewer.index + imageViewer[0].length).trim();

  // 영문 기사는 번역 전에 여기를 지난다. 엔가젯은 카테고리·제목·부제·바이라인·사진 크레딧
  // 뒤에 "Add Engadget on Google: Preferred Source Google Discover" 위젯이 오고 본문이
  // 시작한다. 테크크런치 영상 페이지는 사이트 메뉴 뒤 "Loading the player…" 자리표시 다음이
  // 설명 본문이다(NH123 #27·#30·#9). 이미 번역돼 정본·캐시에 고정된 발췌는 같은 경계가
  // "Google에 Engadget 추가: 기본 소스 Google Discover", "플레이어 로드 중…"으로 남아 있어
  // 번역문 형태도 같은 자리에서 자른다(정본 고정 단계 재정리 경로).
  const engadgetWidget = text.slice(0, 700).match(/(?:Add Engadget on Google:\s*Preferred Source|Google에서?\s*Engadget\s*추가:?\s*기본 소스)\s*Google Discover\s*/i);
  if (engadgetWidget) text = text.slice(engadgetWidget.index + engadgetWidget[0].length).trim();
  const playerPlaceholder = text.slice(0, 700).match(/(?:^|\s)(?:Loading the player|플레이어 로드 중)(?:…|\.{3})\s*/);
  if (playerPlaceholder) text = text.slice(playerPlaceholder.index + playerPlaceholder[0].length).trim();

  // 게시자 자신의 제휴 고지문("이 포스팅은 ○○ 활동의 일환으로, 이에 따른 일정액의 수수료를
  // 제공받습니다")은 그 글의 내용이 아니고, 우리 화면에 실리면 지금핫의 고지처럼 읽힌다
  // (NH123 실시간 1위 이토랜드 핫딜). 고지 문장만 지우고 상품·가격·쿠폰 내용은 그대로 둔다.
  // 지금핫 자체 광고 고지(ad-copy.js AD_DISCLOSURE)는 광고 슬롯이 상수로 그리며 이 함수를
  // 지나지 않는다.
  text = text.replace(/(?:^|\s)[✱※*]?\s*(?:이|본)\s*(?:포스팅|게시물|글)은\s+[^.!?]{0,40}?활동의 일환으로,?\s*이에 따른 일정액의 수수료를 (?:제공|지급)받(?:을 수 있)?습니다[.!]?/g, " ");

  const chromeTail = text.match(/\s(?:닫기 음성으로 듣기|제보는 카카오톡|연합뉴스TV 기사문의 및 제보|<저작권자|이야기를 실시간으로 팔로우하세요\.?\s*하위 섹션)/i);
  if (chromeTail) text = text.slice(0, chromeTail.index).trim();
  // 기사 끝의 연합뉴스 기자 이메일 한 토큰("…말했다. jaya@yna.co.kr")만 지운다. 다른 주소나
  // 문장 안의 이메일("문의는 press@example.com")은 기사 내용일 수 있어 건드리지 않는다.
  text = text.replace(/\s+[\w.+-]+@yna\.co\.kr\s*$/, "");
  return normalizeArticleText(text);
}

function publicText(html) {
  return cleanArticleTextChrome(String(html || "")
    .replace(/<(?:script|style|nav|footer|aside|form|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|nav|footer|aside|form|svg|noscript)>/gi, " ")
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*\bdata-block\s*=\s*["'](?:metadata|links|topicList|promoList)["'])[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:p|div|li|h[1-6]|section|br)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " "));
}

function jsonLdArticleBody(html) {
  const scripts = String(html || "").match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = (script.match(/>([\s\S]*?)<\/script>/i) || [])[1];
    if (!raw) continue;
    try {
      const queue = [JSON.parse(raw)];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== "object") continue;
        const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (types.some((type) => /article$/i.test(String(type))) && typeof value.articleBody === "string") {
          return normalizeArticleText(value.articleBody);
        }
        for (const child of Object.values(value)) {
          if (child && typeof child === "object") queue.push(child);
        }
      }
    } catch {
      // Invalid JSON-LD is not public body evidence; continue to the HTML paths.
    }
  }
  return "";
}

function sectionText(html, tag) {
  const match = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? publicText(match[1]) : "";
}

function articleBodyText(html) {
  const source = String(html || "");
  const opening = /<([a-z][\w:-]*)\b(?=[^>]*(?:\bid|\bitemprop)\s*=\s*["']articleBody["'])[^>]*>/i.exec(source);
  const inner = elementInnerHtml(source, opening);
  return inner ? publicText(inner) : "";
}

function elementInnerHtml(source, opening) {
  if (!opening) return "";
  const tag = opening[1];
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  const start = opening.index + opening[0].length;
  tags.lastIndex = start;
  let depth = 1;
  let match;
  while ((match = tags.exec(source))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return source.slice(start, match.index);
  }
  return "";
}

function elleArticleText(html) {
  const source = String(html || "");
  const opening = /<([a-z][\w:-]*)\b[^>]*\bclass\s*=\s*["'][^"']*\batc_body_cont\b[^"']*["'][^>]*>/i.exec(source);
  const inner = elementInnerHtml(source, opening);
  return inner ? paragraphText(inner) : "";
}

// 문단 폴백은 페이지 전체에서 <p>를 모은다. 그래서 publicText가 컨테이너째 걷어내는
// figure·header·nav·footer·aside와 script 템플릿 안의 <p>도 그대로 딸려 왔다 — 연합뉴스의
// <figcaption><p class="txt-desc">(장소=연합뉴스) 기자 = 사진 설명 2026.9.4 abc@yna.co.kr</p>,
// 핸들바 <script> 템플릿 속 가입 유도 <p>, 테크크런치 헤더 메가메뉴 <p>가 발췌 첫머리를 채운
// 원인이다(NH123 #3·#23·#35·#9). form은 일부러 남긴다 — 옛 게시판은 본문 전체를 <form>으로
// 감싸고, 이 폴백이 그 글의 마지막 통로다.
const PARAGRAPH_SKIP_BLOCKS = /<(figure|header|nav|footer|aside|script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

function paragraphText(html) {
  const paragraphs = [];
  const source = String(html || "").replace(PARAGRAPH_SKIP_BLOCKS, " ");
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = re.exec(source))) paragraphs.push(publicText(match[1]));
  return normalizeArticleText(paragraphs.join(" "));
}

function articleText(html) {
  const publisherBody = elleArticleText(html);
  const explicit = [jsonLdArticleBody(html), articleBodyText(html), publisherBody];
  const explicitLongest = explicit.reduce((longest, text) => text.length > longest.length ? text : longest, "");
  if (explicitLongest) {
    const minimum = explicitLongest === publisherBody ? EXCERPT_MAX : ARTICLE_TEXT_MIN;
    return explicitLongest.length >= minimum
      ? { text: explicitLongest, tooShort: false }
      : { text: null, tooShort: true };
  }
  let longest = "";
  for (const text of [sectionText(html, "article"), sectionText(html, "main"), paragraphText(html)]) {
    if (text.length >= ARTICLE_TEXT_MIN) return { text, tooShort: false };
    if (text.length > longest.length) longest = text;
  }
  return { text: null, tooShort: longest.length > 0 };
}

export function looksLikePageChrome(text) {
  const value = String(text || "");
  // Match standalone site introductions, not articles with further reporting.
  if (/^[^.!?…]{1,80}(?:은|는)\s+[^.!?…]{1,160}(?:공유|제공)하는\s+(?:온라인\s+)?(?:커뮤니티|사이트|포털)입니다[.!?…]*(?:\s*[^.!?…]{0,120}(?:참여하세요|확인하세요|만나보세요)[.!?…]*)?$/u.test(value.trim())) return true;
  if (/오늘의\s*HIT\s*30/i.test(value)) return true;
  if (/(?:rptHeader\s*\+=|읽어주기 기능은 크롬기반|구글 선호 매체 등록|구글검색 선호 추가|구글 검색 선호 매체 추가|기사 (?:소리로 듣기|읽어주기)|요약보기 자동요약|photo big-->|Your browser does not support the audio element|-->\s*가(?:\s|-->)*-->)/i.test(value.slice(0, 1200))) return true;
  const markers = [
    /로그인/i,
    /회원가입/i,
    /이용약관/i,
    /개인정보처리방침/i,
    /사업자등록번호/i,
    /통신판매업신고/i,
    /copyright\s*(?:©|\(c\))?/i,
    /고객센터/i
  ];
  return markers.reduce((count, marker) => count + Number(marker.test(value)), 0) >= 3;
}

function pageTitle(html) {
  const meta = metaContent(String(html || ""), "og:title");
  const title = meta || (String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return decodeEntities(String(title || "")).replace(/\s+/g, " ").trim();
}

function canonicalPageUrl(html, baseUrl) {
  const tag = (String(html || "").match(/<link\b[^>]*\brel=["'][^"']*canonical[^"']*["'][^>]*>/i) || [])[0];
  const href = tag && (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
  try { return href ? new URL(decodeEntities(href), baseUrl) : null; } catch { return null; }
}

function articleIdentityMatches(html, requestedUrl, finalUrl, expectedTitle, { strict = false } = {}) {
  let requested;
  let final;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  const root = (url) => !url.pathname || url.pathname === "/";
  if (!root(requested) && root(final)) return false;
  const canonical = canonicalPageUrl(html, final);
  if (canonical && !root(requested) && root(canonical)) return false;

  const expected = String(expectedTitle || "").trim();
  const observed = pageTitle(html);
  if (!expected) return true;
  if (!observed) return false;
  if (/(?:access denied|request (?:was )?blocked|security check|attention required|forbidden|not found|error page)/i.test(observed)) {
    return false;
  }
  if (/[가-힣]/.test(expected) !== /[가-힣]/.test(observed)) return !strict;
  const normalizedExpected = expected.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedObserved = observed.toLowerCase().replace(/\s+/g, " ").trim();
  const shorter = normalizedExpected.length <= normalizedObserved.length ? normalizedExpected : normalizedObserved;
  const longer = shorter === normalizedExpected ? normalizedObserved : normalizedExpected;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const tokens = (value) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
  const left = tokens(expected);
  const right = tokens(observed);
  if (!strict) {
    const smaller = Math.min(left.size, right.size);
    if (!smaller) return false;
    const overlap = [...left].filter((token) => right.has(token)).length;
    return overlap >= (smaller <= 2 ? smaller : 2);
  }
  const overlap = [...left].filter((token) => right.has(token)).length;
  return Math.min(left.size, right.size) >= 2 &&
    overlap >= Math.max(2, Math.ceil(Math.min(left.size, right.size) / 2));
}

function unavailable(reasonCode, httpStatus = null, image = null, finalUrl = null) {
  return { state: "unavailable", reasonCode, httpStatus, image, finalUrl };
}

const googleNewsPublisherCache = new Map();

async function resolveGoogleNewsPublisherUrl(url, { fetchImpl, signal }) {
  const cached = googleNewsPublisherCache.get(url);
  if (cached) return cached;
  const articleId = (() => {
    try { return new URL(url).pathname.match(/\/(?:rss\/)?articles\/([^/]+)/)?.[1] || null; } catch { return null; }
  })();
  if (!articleId) return null;
  try {
    const pageOptions = {
      headers: { "user-agent": DEFAULT_UA, accept: "text/html,*/*;q=0.8" },
      redirect: "manual",
      signal
    };
    let page = await fetchImpl(url, pageOptions);
    if ([301, 302, 303, 307, 308].includes(Number(page && page.status))) {
      const location = page.headers && page.headers.get && page.headers.get("location");
      discardBody(page);
      let redirected;
      try { redirected = new URL(location, url); } catch { return null; }
      const redirectedId = redirected.pathname.match(/\/(?:rss\/)?articles\/([^/]+)/)?.[1];
      if (!isGoogleNewsRedirect(redirected.href) || redirectedId !== articleId) return null;
      page = await fetchImpl(redirected.href, pageOptions);
    }
    if (!page || !page.ok) { discardBody(page); return null; }
    const contentType = page.headers && page.headers.get && page.headers.get("content-type") || "";
    const html = await readCapped(page, ARTICLE_HTML_MAX_BYTES, contentType);
    const pageId = (html.match(/data-n-a-id=["']([^"']+)/i) || [])[1];
    const timestamp = (html.match(/data-n-a-ts=["'](\d+)/i) || [])[1];
    const signature = (html.match(/data-n-a-sg=["']([^"']+)/i) || [])[1];
    if (!timestamp || !signature || pageId && pageId !== articleId) return null;

    const request = [
      "Fbv4je",
      JSON.stringify([
        "garturlreq",
        [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
          "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
        articleId,
        Number(timestamp),
        signature
      ]),
      null,
      "generic"
    ];
    const body = new URLSearchParams({ "f.req": JSON.stringify([[request]]) });
    const rpc = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": DEFAULT_UA
      },
      body,
      signal
    });
    if (!rpc || !rpc.ok) { discardBody(rpc); return null; }
    const responseText = await readCapped(rpc, 64 * 1024, rpc.headers && rpc.headers.get && rpc.headers.get("content-type"));
    const jsonStart = responseText.indexOf("[");
    if (jsonStart < 0) return null;
    const outer = JSON.parse(responseText.slice(jsonStart));
    const resultRow = outer.find((row) => Array.isArray(row) && row[1] === "Fbv4je");
    const decoded = resultRow && JSON.parse(resultRow[2]);
    const publisherUrl = decoded && decoded[0] === "garturlres" ? decoded[1] : null;
    if (!/^https?:\/\//i.test(publisherUrl || "") || isGoogleNewsRedirect(publisherUrl)) return null;
    if (googleNewsPublisherCache.size >= 2000) googleNewsPublisherCache.clear();
    googleNewsPublisherCache.set(url, publisherUrl);
    return publisherUrl;
  } catch {
    return null;
  }
}

function publicIp(address) {
  const value = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:")) return publicIp(value.slice(7));
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(value) === 6) {
    return !(value === "::" || value === "::1" || /^f[cd]/.test(value) ||
      /^fe[89ab]/.test(value) || /^fe[c-f]/.test(value) ||
      value.startsWith("ff") || value.startsWith("2001:db8:"));
  }
  return false;
}

function fixedLookup(address, family) {
  return (_hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    const resolvedFamily = Number(family) || isIP(address);
    if (options && typeof options === "object" && options.all) {
      done(null, [{ address, family: resolvedFamily }]);
    } else {
      done(null, address, resolvedFamily);
    }
  };
}

function pinnedFetch(url, { headers, signal, lookup }) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      method: "GET",
      headers,
      signal,
      lookup,
      agent: false,
      autoSelectFamily: false,
      ...(url.protocol === "https:" && !isIP(url.hostname) ? { servername: url.hostname } : {})
    }, (res) => {
      const status = Number(res.statusCode || 0);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        url: url.href,
        headers: {
          get(name) {
            const value = res.headers[String(name || "").toLowerCase()];
            return Array.isArray(value) ? value.join(", ") : value == null ? null : String(value);
          }
        },
        body: Readable.toWeb(res)
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function publicArticleUrl(value, resolveHost, signal) {
  let parsed;
  try { parsed = new URL(value); } catch { return { reasonCode: "UNSAFE_URL" }; }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return { reasonCode: "UNSAFE_URL" };
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { reasonCode: "UNSAFE_URL" };
  }
  if (isIP(hostname)) {
    return publicIp(hostname)
      ? { url: parsed, lookup: fixedLookup(hostname, isIP(hostname)) }
      : { reasonCode: "UNSAFE_URL" };
  }
  if (resolveHost) {
    try {
      const addresses = await abortable(resolveHost(hostname, { all: true, verbatim: true }), signal);
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((row) => !publicIp(row && row.address))) {
        return { reasonCode: "UNSAFE_URL" };
      }
      const selected = addresses[0];
      return { url: parsed, lookup: fixedLookup(selected.address, selected.family) };
    } catch {
      return { reasonCode: signal && signal.aborted ? "TIMEOUT" : "NETWORK_ERROR" };
    }
  }
  return { url: parsed, lookup: null };
}

// Public-page read for a later Korean summary. The fetched HTML is transient:
// only capped plain text and an existing OG image URL leave this function.
export async function fetchPublicArticle(url, {
  timeoutMs = 5000,
  fetchImpl = fetch,
  resolveHost,
  expectedTitle = null
} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const requestedUrl = url;
  if (isGoogleNewsRedirect(url)) {
    url = await resolveGoogleNewsPublisherUrl(url, { fetchImpl, signal });
    if (!url) return unavailable(signal.aborted ? "TIMEOUT" : "PUBLISHER_URL_UNAVAILABLE");
  }
  const resolver = resolveHost === undefined ? (fetchImpl === fetch ? dnsLookup : null) : resolveHost;
  let checked = await publicArticleUrl(url, resolver, signal);
  if (!checked.url) return unavailable(checked.reasonCode);
  let res;
  let currentUrl = checked.url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    try {
      const requestOptions = {
        headers: { "user-agent": DEFAULT_UA, accept: "text/html,*/*;q=0.8" },
        redirect: "manual",
        signal,
        lookup: checked.lookup
      };
      res = fetchImpl === fetch && checked.lookup
        ? await pinnedFetch(currentUrl, requestOptions)
        : await fetchImpl(currentUrl.href, requestOptions);
    } catch {
      return unavailable(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
    }
    if (![301, 302, 303, 307, 308].includes(Number(res && res.status))) break;
    const location = res.headers && res.headers.get && res.headers.get("location");
    discardBody(res);
    if (!location || redirects === 5) return unavailable("HTTP_ERROR", res.status);
    let redirectedUrl;
    try { redirectedUrl = new URL(location, currentUrl).href; } catch { return unavailable("HTTP_ERROR", res.status); }
    checked = await publicArticleUrl(redirectedUrl, resolver, signal);
    if (!checked.url) return unavailable(checked.reasonCode);
    currentUrl = checked.url;
  }
  if (!res) return unavailable("NETWORK_ERROR");
  if (!res.ok) {
    const code = res.status === 401 ? "AUTH_REQUIRED"
      : res.status === 403 ? "ACCESS_DENIED"
      : res.status === 429 ? "RATE_LIMITED"
      : res.status === 404 || res.status === 410 ? "NOT_FOUND"
      : "HTTP_ERROR";
    discardBody(res);
    return unavailable(code, res.status);
  }
  const contentType = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  if (!/text\/html/i.test(contentType)) {
    discardBody(res);
    return unavailable("NON_HTML", res.status);
  }
  let html;
  try {
    html = await readCapped(res, ARTICLE_HTML_MAX_BYTES, contentType, { allowTextFallback: false });
  } catch {
    return unavailable(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
  }
  const finalUrl = res.url || currentUrl.href;
  const image = extractOgImage(html, finalUrl);
  const documentChanged = (() => {
    try {
      const before = new URL(url);
      const after = new URL(finalUrl);
      const path = (value) => value.pathname.replace(/\/+$/, "") || "/";
      return before.hostname !== after.hostname || path(before) !== path(after);
    } catch {
      return true;
    }
  })();
  if (!articleIdentityMatches(html, url, finalUrl, expectedTitle, {
    strict: isGoogleNewsRedirect(requestedUrl) || documentChanged
  })) {
    return unavailable("ARTICLE_IDENTITY_MISMATCH", res.status);
  }
  const article = articleText(html);
  if (article.text && looksLikePageChrome(article.text)) {
    return unavailable("NO_PUBLIC_BODY", res.status, image, finalUrl);
  }
  if (!article.text) {
    const reason = article.tooShort ? "PUBLIC_BODY_TOO_SHORT" : "NO_PUBLIC_BODY";
    return unavailable(reason, res.status, image, finalUrl);
  }
  return { state: "available", text: article.text, image, finalUrl };
}

// url을 GET해 공개 메타만 읽는다. Google 뉴스 중계 URL은 언론사 원문이나
// 대표 이미지가 아니므로 요청하지 않는다. content-type이 text/html이 아니면 이미지/PDF 등을 og 파싱하지
// 않고 null. 403/404/타임아웃/네트워크 오류는 전부 조용히 null — 우회나
// 재시도는 하지 않는다.
export async function fetchOgImage(url, opts = {}) {
  const meta = await fetchOgMeta(url, opts);
  return meta.image;
}

// 네트워크 1회로 image+desc를 함께 뽑는다. 실패 시 { image:null, desc:null }.
export async function fetchOgMeta(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const empty = { image: null, desc: null };
  if (isGoogleNewsRedirect(url)) return empty;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": DEFAULT_UA, accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return empty; // 네트워크 오류/타임아웃 — 조용히 포기
  }
  if (!res || !res.ok) { discardBody(res); return empty; } // 403/404 등 — 조용히 포기, 우회 금지
  const contentType = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  if (!/text\/html/i.test(contentType)) { discardBody(res); return empty; }
  let html;
  try {
    html = await readCapped(res, MAX_HTML_BYTES, contentType);
  } catch {
    return empty;
  }
  return { image: extractOgImage(html, res.url || url), desc: extractOgDesc(html) };
}

// --- makeEnricher: 사이클마다 image 없는 아이템을 골라 동시성 있게 채운다 --

// URL별 캐시: 성공은 ttlMs, 실패(null)는 negativeTtlMs 동안 재조회하지 않는다
// (부정 캐시의 이유는 파일 상단 주석 참고).
export function makeEnricher({
  fetchImpl = fetch,
  maxPerCycle = 20,
  concurrency = 8,
  ttlMs = 6 * 3600 * 1000,
  negativeTtlMs = 3600 * 1000,
  clock = () => Date.now(),
  initialCache = null,   // 재시작 복구용 (store에서 주입)
  onPersist = null       // 사이클 끝에 직렬화된 캐시를 넘겨준다
} = {}) {
  const cache = new Map(Object.entries(initialCache || {}));

  function cacheGet(url) {
    const hit = cache.get(url);
    if (!hit) return undefined;
    if (clock() >= hit.expiresAt) {
      cache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url, meta) {
    const positive = Boolean(meta.image || meta.desc);
    cache.set(url, { ...meta, expiresAt: clock() + (positive ? ttlMs : negativeTtlMs) });
  }

  // image가 비었거나 summary(발췌)가 빈 아이템이 후보다 — 한 번의 fetch로
  // 둘 다 채운다. desc가 제목의 단순 복제면 발췌 가치가 없으므로 버린다.
  const needsWork = (it) => !it.image || !it.summary;

  // 메타를 아이템에 적용. 채운 게 있으면 true.
  function applyMeta(item, meta) {
    if (!meta) return false;
    let touched = false;
    if (!item.image && meta.image) { item.image = meta.image; touched = true; }
    // og:description도 원문 발췌와 같은 정리를 지난다 — 실시간 요약 칸은 이 값을 그대로
    // 그려서 게시자의 제휴 고지문이 지금핫 고지처럼 보였다(NH123 실시간 이토랜드 핫딜).
    // 사이트 소개·메뉴 같은 페이지 크롬은 그 글의 발췌가 아니므로 비워 둔다
    // (article-summary.js sourceLinks와 같은 판정). 캐시 형식은 그대로다.
    const desc = !item.summary && meta.desc ? cleanArticleTextChrome(meta.desc) : "";
    // U+FFFD(\uFFFD)가 남았으면 디코딩 실패 잔재 — 깨진 발췌는 없느니만 못하다
    if (desc && desc !== item.title && !desc.includes("\uFFFD") && !looksLikePageChrome(desc)) {
      item.summary = desc; touched = true;
    }
    return touched;
  }

  async function enrich(items) {
    // 이미지 없는 글을 먼저 처리한다 — 발췌보다 이미지가 화면에서 더 크게
    // 비고, 몰입 모드는 사진이 주인공이라 체감 차이가 크다(David 2026-08-01).
    // 호출측이 이미 신선도 순으로 넘겨주므로, 같은 조건이면 최신이 앞선다.
    const pool = (Array.isArray(items) ? items : [])
      .filter((it) => it && needsWork(it) && typeof it.url === "string" && /^https?:\/\//i.test(it.url));
    // 캐시에 이미 답이 있는 항목은 **상한과 무관하게** 즉시 적용한다 —
    // 네트워크를 쓰지 않으므로 제한할 이유가 없고, 이걸 상한에 포함시키면
    // 사이클마다 같은 120건만 갱신되어 커버리지가 늘지 않는다(실측 버그).
    let cacheApplied = 0;
    const needFetch = [];
    for (const it of pool) {
      const hit = cacheGet(it.url);
      if (hit !== undefined) { if (applyMeta(it, hit)) cacheApplied++; }
      else needFetch.push(it);
    }
    const noImage = needFetch.filter((it) => !it.image);
    const rest = needFetch.filter((it) => it.image);
    const candidates = [...noImage, ...rest].slice(0, maxPerCycle);

    const attempted = candidates.length;
    let filled = cacheApplied;
    let cursor = 0;

    async function worker() {
      while (cursor < candidates.length) {
        const item = candidates[cursor++];
        const meta = await fetchOgMeta(item.url, { fetchImpl });
        cacheSet(item.url, meta);
        if (applyMeta(item, meta)) filled++;
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
    await Promise.all(Array.from({ length: workerCount }, worker));

    // 캐시를 밖으로 넘겨 저장하게 한다 — 배포·재시작에도 이미지가 살아남는다
    if (onPersist && (candidates.length || cacheApplied)) {
      try { onPersist(Object.fromEntries(cache), clock()); } catch { /* 저장 실패가 수집을 막지 않는다 */ }
    }

    return { attempted, filled };
  }

  return {
    enrich,
    cacheSize: () => cache.size
  };
}
