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

// --- extractOgImage: 순수 문자열 파싱, 네트워크 없음 -----------------------

const IMG_META_NAMES = ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"];

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
export function extractOgImage(html, baseUrl) {
  if (!html) return null;
  const text = String(html);
  for (const name of IMG_META_NAMES) {
    const raw = metaContent(text, name);
    if (raw === null) continue;
    const decoded = decodeEntities(raw).trim();
    if (!decoded) continue;
    let abs;
    try {
      abs = new URL(decoded, baseUrl);
    } catch {
      return null; // 이 후보를 파싱할 수 없으면 그대로 실패 — 다음 후보로 넘어가지 않는다
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    return abs.toString();
  }
  return null;
}

// --- fetchOgImage: 네트워크 1회, 조용한 실패 -------------------------------

// 스트림 reader로 응답 본문을 MAX_HTML_BYTES까지만 읽고 자른다. fetchImpl이
// 테스트 목처럼 스트리밍 body가 없는 단순 Response 흉내일 수도 있어 그 경우엔
// text()로 폴백한다.
async function readCapped(res, maxBytes) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      // 이미 끝났거나 취소 불가한 스트림 — 무시
    }
  }
  return out;
}

// url을 GET, 리다이렉트는 fetch 기본 동작대로 따라간다(news.google.com 같은
// 리다이렉트 링크가 퍼블리셔 페이지에 도달하는 것도 이걸로 충분 — 별도 처리
// 불필요). content-type이 text/html이 아니면 이미지/PDF 등을 og 파싱하지
// 않고 null. 403/404/타임아웃/네트워크 오류는 전부 조용히 null — 우회나
// 재시도는 하지 않는다.
export async function fetchOgImage(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": DEFAULT_UA, accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null; // 네트워크 오류/타임아웃 — 조용히 포기
  }
  if (!res || !res.ok) return null; // 403/404 등 — 조용히 포기, 우회 금지
  const contentType = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  if (!/text\/html/i.test(contentType)) return null;
  let html;
  try {
    html = await readCapped(res, MAX_HTML_BYTES);
  } catch {
    return null;
  }
  return extractOgImage(html, res.url || url);
}

// --- makeEnricher: 사이클마다 image 없는 아이템을 골라 동시성 있게 채운다 --

// URL별 캐시: 성공은 ttlMs, 실패(null)는 negativeTtlMs 동안 재조회하지 않는다
// (부정 캐시의 이유는 파일 상단 주석 참고).
export function makeEnricher({
  fetchImpl = fetch,
  maxPerCycle = 20,
  concurrency = 4,
  ttlMs = 6 * 3600 * 1000,
  negativeTtlMs = 3600 * 1000,
  clock = () => Date.now()
} = {}) {
  const cache = new Map(); // url -> { image: string|null, expiresAt: number }

  function cacheGet(url) {
    const hit = cache.get(url);
    if (!hit) return undefined;
    if (clock() >= hit.expiresAt) {
      cache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url, image) {
    cache.set(url, { image, expiresAt: clock() + (image ? ttlMs : negativeTtlMs) });
  }

  async function enrich(items) {
    const candidates = (Array.isArray(items) ? items : [])
      .filter((it) => it && !it.image && typeof it.url === "string" && /^https?:\/\//i.test(it.url))
      .slice(0, maxPerCycle);

    const attempted = candidates.length;
    let filled = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < candidates.length) {
        const item = candidates[cursor++];
        const cached = cacheGet(item.url);
        let image;
        if (cached !== undefined) {
          image = cached.image; // 캐시 히트 — fetch 없이 즉시 적용
        } else {
          image = await fetchOgImage(item.url, { fetchImpl });
          cacheSet(item.url, image);
        }
        if (image) {
          item.image = image;
          filled++;
        }
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
    await Promise.all(Array.from({ length: workerCount }, worker));

    return { attempted, filled };
  }

  return {
    enrich,
    cacheSize: () => cache.size
  };
}
