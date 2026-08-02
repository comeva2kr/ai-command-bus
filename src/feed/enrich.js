import { discardBody } from "./fetchers.js";
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

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

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

async function readCapped(res, maxBytes, contentType) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const chunks = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      // 이미 끝났거나 취소 불가한 스트림 — 무시
    }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return decodeHtmlBytes(buf, contentType);
}

// url을 GET, 리다이렉트는 fetch 기본 동작대로 따라간다(news.google.com 같은
// 리다이렉트 링크가 퍼블리셔 페이지에 도달하는 것도 이걸로 충분 — 별도 처리
// 불필요). content-type이 text/html이 아니면 이미지/PDF 등을 og 파싱하지
// 않고 null. 403/404/타임아웃/네트워크 오류는 전부 조용히 null — 우회나
// 재시도는 하지 않는다.
export async function fetchOgImage(url, opts = {}) {
  const meta = await fetchOgMeta(url, opts);
  return meta.image;
}

// 네트워크 1회로 image+desc를 함께 뽑는다. 실패 시 { image:null, desc:null }.
export async function fetchOgMeta(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const empty = { image: null, desc: null };
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
  if (!/text\/html/i.test(contentType)) return empty;
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
    // U+FFFD(\uFFFD)가 남았으면 디코딩 실패 잔재 — 깨진 발췌는 없느니만 못하다
    if (!item.summary && meta.desc && meta.desc !== item.title && !meta.desc.includes("\uFFFD")) {
      item.summary = meta.desc; touched = true;
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
