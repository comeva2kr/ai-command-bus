// X(트위터) 실시간 트렌드 — 키워드만, 트윗 본문 없음 (David 2026-08-01
// "스레드나 트위터글도 좀 가져오고싶은데"의 실행 가능 절반).
//
// 왜 이 경로인가: X 본문 수집은 공식 API가 유료(월 수십만 원)이고 비로그인
// 스크래핑은 기술 차단 + ToS 명시 금지라 "걸릴 위험 있는" 쪽이다. 반면
// 트렌드 집계 사이트 trends24.in은 서버렌더 HTML에 한국 트렌드를 그대로
// 실어 주며, robots.txt가 일반 에이전트에 Content-Signal
// search=yes / use=reference 를 명시한다(2026-08-01 실측) — 우리 용도가
// 정확히 그것(참조 + 링크)이다. ai-train=no 는 우리와 무관(학습 안 함).
//
// 키워드는 X 검색 아웃링크로만 연결한다 — 트윗 저작물을 복제하지 않으므로
// 저작권·ToS 리스크가 없고, 출처(trends24)는 페이지에 명시한다.

const TRENDS_URL = "https://trends24.in/korea/";
const UA = "ai-command-bus-feed/0.1 (+https://github.com/comeva2kr/ai-command-bus)";

// 서버렌더 마크업 실측(2026-08-01): 속성 따옴표가 없는 형태로 나온다 —
//   <a href="https://twitter.com/search?q=%E2%80%A6" class=trend-link>오하욘사</a>
//   <span class=tweet-count data-count="12345">12K</span> (count는 없을 수도)
const TREND_RE = /<a href="(https:\/\/twitter\.com\/search\?q=[^"]+)"[^>]*class=["']?trend-link["']?[^>]*>([^<]+)<\/a>(?:<span[^>]*class=["']?tweet-count[^>]*>([^<]*)<\/span>)?/g;

export function parseTrends(html, limit = 20) {
  const out = [];
  const seen = new Set();
  let m;
  TREND_RE.lastIndex = 0;
  while ((m = TREND_RE.exec(String(html || ""))) && out.length < limit) {
    const name = m[2].trim();
    if (!name || seen.has(name)) continue; // 페이지는 시간대별 카드 반복 — 최신(첫 등장)만
    seen.add(name);
    out.push({ name, searchUrl: m[1], count: (m[3] || "").trim() || null });
  }
  return out;
}

export async function fetchXTrends({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  let res;
  try {
    res = await fetchImpl(TRENDS_URL, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null; // 네트워크 실패 — 조용히 (트렌드는 부가 기능, 피드를 못 죽인다)
  }
  if (!res || !res.ok) return null; // 403 등 — 우회하지 않는다
  const trends = parseTrends(await res.text());
  return trends.length ? trends : null;
}

// 캐시: 20분 TTL. 실패 시 기존 캐시를 유지한다(빈 화면보다 20분 전 트렌드가
// 낫다). 완전히 처음부터 실패면 null — 클라이언트는 카드 자체를 숨긴다.
export function makeTrendsCache({ ttlMs = 20 * 60 * 1000, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  let cached = null;
  let fetchedAt = 0;
  let inflight = null;
  async function get() {
    const now = clock();
    if (cached && now - fetchedAt < ttlMs) return cached;
    if (!inflight) {
      inflight = fetchXTrends({ fetchImpl }).then((t) => {
        if (t) { cached = { trends: t, fetchedAt: new Date(clock()).toISOString() }; fetchedAt = clock(); }
        inflight = null;
        return cached;
      });
    }
    return (await inflight) || cached;
  }
  return { get };
}
