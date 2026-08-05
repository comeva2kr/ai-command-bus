// 관심사 지수 — 지금 사람들이 실제로 **검색하고 있는 것**.
//
// ── 왜 (David 2026-08-05)
// "인터넷 검색 결과가 많은 트렌드 지수가 높은 관심사와 연관된 소식 중 가장
// 인용도 높고 사람들 반응 높은 중요한 소식들 위주로 합시다. 예를 들어 지금은
// 트럼프의 발표나 주식 관련 소식 반도체 등이 있겠죠."
//
// 그전까지 브리핑은 **반응(추천·댓글)**과 **인용도(여러 매체 동시보도)** 두 축만
// 봤다. 둘 다 "이미 우리 풀 안에서" 재는 값이라, 바깥세상에서 무엇이 화제인지는
// 알 수 없었다. 그래서 커뮤니티에서만 시끄러운 글이 대표 자리에 올랐다.
//
// ── 왜 X 트렌드로는 안 되나 (실측 2026-08-05)
// 우리에게 이미 트렌드 소스가 하나 있었다(trends.js, X 실시간 트렌드). 그런데
// 그날 TOP 12가 이랬다:
//   #해피하민데이_나의자전거소년 · #사랑둥이_치치야_생일축하해료 · #PuppyRyoDay
//   #포카마켓 · 멤버 각각 · #20DreamsWithHamin · 트친 취향표 …
// 전부 팬덤 해시태그다. 이걸 선정에 쓰면 David가 지적한 "사적·매니악함"이
// 오히려 심해진다. X 트렌드는 그대로 두되(그 자체로 볼거리는 된다),
// **브리핑 선정에는 쓰지 않는다.**
//
// ── 그래서 구글 트렌드 (검색량 실측)
// https://trends.google.com/trending/rss?geo=KR 는 급상승 검색어와 함께
// 대략적인 검색량(ht:approx_traffic)과 연관 기사 제목을 준다. 같은 날 실측:
//   재건축 500+ · 최은경 1000+ · 법관 500+ · 현행범 200+ · 서울특별시 200+
// robots.txt는 /explore? 만 막는다 — /trending/rss 는 허용된다(2026-08-05 확인).
//
// 이 모듈은 그 검색어 목록을 우리 글에 **연결만** 한다. 순위를 뒤집지 않고,
// 기존의 반응·인용도 위에 한 축을 더한다.

// "1,000+" → 1000. 구글은 자릿수만 대략 준다 — 정확한 값인 척하지 않는다.
export function trafficValue(text) {
  const m = String(text || "").replace(/[,\s]/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// 급상승 검색어에는 다른 나라 것이 섞여 들어온다(실측: 태국어 축구 경기명이
// 한국 목록에 있었다). 한글·영문·숫자 바깥의 글자가 섞이면 우리 글과 이어질
// 일이 없으므로 버린다. 영문·숫자는 남긴다 — 종목 코드(qqqm)나 기업명이
// 그대로 검색어로 오르는 경우가 많고, 그건 David가 말한 "주식·반도체"다.
export function usefulTerm(term) {
  const t = String(term || "").trim();
  if (t.length < 2) return false;
  if (t.length > 40) return false;
  return !/[^가-힣ㄱ-ㆎa-zA-Z0-9·\-.&'’\s]/.test(t);
}

// 구글 트렌드 RSS 파싱. 의존성 없이 — 이 저장소의 다른 파서들과 같은 방식이다.
// 채널 제목이 첫 <title>로 오므로 <item> 안쪽만 본다.
export function parseInterests(xml, limit = 20) {
  const out = [];
  const text = String(xml || "");
  const items = text.match(/<item\b[\s\S]*?<\/item>/g) || [];
  for (const block of items) {
    const title = pick(block, "title");
    if (!title || !usefulTerm(title)) continue;
    const traffic = trafficValue(pick(block, "ht:approx_traffic"));
    // 연관 기사 제목 — 검색어만으로는 무슨 일인지 모른다. "법관"이 왜 떴는지는
    // 기사 제목이 알려 준다. 우리 글과 이어 붙일 때 보조 단서로 쓴다.
    const news = [...block.matchAll(/<ht:news_item_title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:news_item_title>/g)]
      .map((m) => decode(m[1])).filter(Boolean);
    out.push({ term: title, traffic, news });
    if (out.length >= limit) break;
  }
  return out;
}

function pick(block, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);
  const m = block.match(re);
  return m ? decode(m[1]).trim() : "";
}
function decode(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

export const INTERESTS_URL = "https://trends.google.com/trending/rss?geo=KR";

export async function fetchInterests({ fetchImpl = fetch, timeoutMs = 10000, url = INTERESTS_URL } = {}) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": "nowhot-bot/1.0 (+https://nowhot.kr/about.html)", accept: "application/rss+xml,text/xml" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`interests ${res.status}`);
  return parseInterests(await res.text());
}

// 검색어는 빨리 바뀌지 않는다 — 20분이면 충분하고, 남의 서버를 덜 두드린다.
// trends.js의 캐시와 같은 모양으로 맞췄다.
export function makeInterestsCache({ ttlMs = 20 * 60 * 1000, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  let at = 0, value = [];
  return async function interests() {
    if (value.length && clock() - at < ttlMs) return value;
    try {
      value = await fetchInterests({ fetchImpl });
      at = clock();
    } catch {
      // 실패하면 있던 값을 계속 쓴다. 관심사 축이 없어도 브리핑은 나와야 한다 —
      // 한 축이 빠질 뿐 나머지 두 축(반응·인용도)은 그대로 돈다.
    }
    return value;
  };
}

// ── 글과 검색어를 잇기
//
// 한국어는 조사가 붙어서 단순 포함 검사가 오히려 맞다("재건축이", "재건축을").
// 대신 **너무 짧은 말은 아무 데나 걸린다** — 두 글자 이하는 다루지 않는다.
// 영문은 반대로 단어 경계를 봐야 한다("법"이 "방법"에 걸리듯, "ai"가 "said"에
// 걸린다).
export function mentions(text, term) {
  const t = String(text || "");
  const q = String(term || "").trim();
  if (q.length < 2 || !t) return false;
  if (/^[a-zA-Z0-9.\-&']+$/.test(q)) {
    return new RegExp(`(^|[^a-zA-Z0-9])${escapeRe(q)}($|[^a-zA-Z0-9])`, "i").test(t);
  }
  if (q.length < 3) return false;   // 두 글자 한글은 오탐이 너무 많다
  return t.includes(q);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// 이 글이 지금 화제인 검색어와 이어지는가. 이어지면 **어느 검색어에, 얼마나**
// 이어지는지까지 돌려준다 — 화면에 근거를 밝힐 수 있어야 한다("검색 급상승:
// 재건축"). 근거 없이 순위만 바꾸면 우리도 왜 그 글이 위에 있는지 설명할 수 없다.
export function matchInterest(item, interests) {
  if (!item || !Array.isArray(interests) || !interests.length) return null;
  const hay = `${item.title || ""} ${item.summary || ""}`;
  let best = null;
  for (const it of interests) {
    if (!it || !it.term) continue;
    // 검색어가 제목에 직접 있으면 가장 강한 신호.
    let how = mentions(hay, it.term) ? "term" : null;
    // 아니면 그 검색어의 연관 기사 제목과 같은 사건인지 본다. 구글이 이미
    // "이 검색어는 이 기사들 때문에 떴다"고 알려 준 것이라 지어낸 연결이 아니다.
    if (!how && it.news && it.news.length) {
      for (const n of it.news) {
        if (sharesKeyword(item.title, n)) { how = "news"; break; }
      }
    }
    if (!how) continue;
    const strength = how === "term" ? 1 : 0.6;
    if (!best || it.traffic * strength > best.traffic * best.strength) {
      best = { term: it.term, traffic: it.traffic, strength, how };
    }
  }
  return best;
}

// 두 제목이 같은 사건인가 — 긴 명사 두 개 이상이 겹치면 같은 일로 본다.
// 하나만 겹치면 "서울"처럼 흔한 말로도 엮여 버린다.
export function sharesKeyword(a, b) {
  const wa = keywords(a), wb = new Set(keywords(b));
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit >= 2;
}
function keywords(s) {
  return String(s || "")
    .split(/[^가-힣a-zA-Z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.toLowerCase());
}

// David가 이름 붙인 무게 있는 분야. "경제·정책·사회·정치 중요 이슈 위주로."
// 카테고리 분류기(classify.js)가 붙이는 값과 맞춘다.
// 실측한 카테고리 id에 맞춘다(taxonomy.js): news·tech·auto·science·business·
// gaming·sports·culture·life·humor·politics.
//   경제 → business   정책·사회 → news   정치 → politics   반도체 → tech
export const WEIGHTY = new Set(["business", "news", "politics", "tech"]);
