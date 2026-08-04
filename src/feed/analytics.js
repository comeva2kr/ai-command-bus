// 행동 분석 — 누가 어디서 들어와 무엇을 누르고 어디서 나갔나.
//
// ── 왜 (2026-08-04, David "어디에서 누가 얼만큼 들어오고 뭘 누르고 어디에서
//    나가고 광고 뭐 누르고 등등 행동을 볼 수 있는 장치가 필요하다")
//
// 지금까지 남는 건 셋뿐이었다: 페이지뷰 수, 피드 API 호출 수, 그날 본 userId
// 목록. 이걸로는 "사람이 늘었다"는 말밖에 못 한다. 어디서 왔는지, 무엇을
// 눌렀는지, 어디서 나갔는지, 우리가 집행한 광고가 사람을 데려왔는지 —
// 돈에 직결되는 질문에 하나도 답할 수 없었다.
//
// ── 설계: 원본 로그가 아니라 일 버킷 사전집계
// store는 단일 JSON 파일이다. 이벤트 원본을 그대로 쌓으면 파일이 선형으로
// 커지고 어느 시점에 못 읽는다. 그래서 들어오는 즉시 **그날 버킷에 더한다.**
// 주/월은 일 버킷을 합산해서 만든다 — 따로 저장하지 않는다.
//
// 예외가 하나 있다. 유니크 방문자는 합산이 안 된다(같은 사람이 3일 오면 3이
// 아니라 1이다). 그래서 uid 목록만 원본으로 남기고 주/월은 합집합으로 센다.
//
// ── 원칙: 세지 못한 것은 만들지 않는다
// 체류시간·스크롤 깊이는 브라우저가 알려줄 때만 쌓고, 표본 수(n)를 함께
// 보관해 평균이 몇 건에 근거한 값인지 화면에서 밝힌다. 표본이 없으면 null을
// 내보내지 0을 내보내지 않는다 — 0은 "0초 머물렀다"로 읽혀서 거짓말이 된다.

// 유입 출처를 사람이 읽는 이름으로. 도메인을 그대로 두면 m.search.naver.com과
// search.naver.com이 따로 세어져서 정작 "네이버에서 얼마나 오나"를 알 수 없다.
const REF_GROUPS = [
  [/(^|\.)naver\.com$/, "네이버"],
  [/(^|\.)google\.[a-z.]+$/, "구글"],
  [/(^|\.)daum\.net$/, "다음"],
  [/(^|\.)kakao\.com$/, "카카오"],
  [/(^|\.)instagram\.com$/, "인스타그램"],
  [/(^|\.)youtube\.com$/, "유튜브"],
  [/(^|\.)facebook\.com$/, "페이스북"],
  [/(^|\.)threads\.(net|com)$/, "스레드"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)tistory\.com$/, "티스토리"],
  [/(^|\.)brunch\.co\.kr$/, "브런치"],
  [/(^|\.)bing\.com$/, "빙"]
];

// referrer는 사용자가 보낸 문자열이다 — 길이를 자르고 형태를 검증한 뒤에만
// 키로 쓴다. 검증 없이 객체 키로 쓰면 아무 문자열이나 버킷에 쌓여 파일이
// 부풀고, 화면에도 그대로 그려진다.
export function refLabel(referrer, selfHost) {
  if (!referrer) return "직접 유입";
  let host;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return "직접 유입"; }
  if (!host) return "직접 유입";
  if (selfHost && (host === selfHost || host.endsWith("." + selfHost))) return "내부 이동";
  for (const [re, label] of REF_GROUPS) if (re.test(host)) return label;
  return host.replace(/^www\./, "").slice(0, 60);
}

// 대외 광고 캠페인 키. David 채널별·매체별 성과를 갈라 보기 위한 축이다.
// utm이 없으면 null — 캠페인이 아닌 유입까지 캠페인 표에 섞지 않는다.
export function campaignKey(params = {}) {
  const clean = (v) => (typeof v === "string" ? v.trim().slice(0, 40).replace(/[|]/g, "/") : "");
  const s = clean(params.utm_source), m = clean(params.utm_medium), c = clean(params.utm_campaign);
  if (!s && !m && !c) return null;
  return [s || "-", m || "-", c || "-"].join(" | ");
}

// 화면 경로 정규화 — /keyword/삼성전자 같은 걸 개별로 세면 표가 수천 줄이 된다.
// 어느 "종류"의 화면인지만 남긴다.
export function viewLabel(path) {
  if (typeof path !== "string" || !path) return "기타";
  const p = path.split("?")[0].slice(0, 120);
  if (p === "/" || p === "") return "홈";
  if (p.startsWith("/briefing")) return "브리핑";
  if (p.startsWith("/ranking")) return "화제랭킹";
  if (p.startsWith("/community")) return "커뮤니티별";
  if (p.startsWith("/keyword")) return "키워드";
  if (p.startsWith("/deals")) return "딜";
  if (p.startsWith("/admin")) return "관리자";
  return p.slice(0, 40);
}

export function emptyBucket() {
  return {
    pv: 0, feed: 0, uids: [], newUids: [], sessions: 0,
    ref: {}, camp: {}, entry: {}, exit: {},
    dwellMs: 0, dwellN: 0,
    depth: 0, depthN: 0,
    clicks: { total: 0, bySource: {}, byCategory: {}, byRank: {} },
    ads: { imp: 0, click: 0, bySlot: {}, byVariant: {} }
  };
}

// 키 폭발 방지 — 한 버킷의 한 축에 이만큼 넘게 쌓이면 새 키는 "기타"로 접는다.
// 상위 항목은 이미 자리를 잡았을 시점이라 순위가 왜곡되지 않는다.
const MAX_KEYS = 120;
function bump(map, key, n = 1) {
  if (key == null || key === "") return;
  const k = String(key).slice(0, 60);
  if (!(k in map) && Object.keys(map).length >= MAX_KEYS) { map["기타"] = (map["기타"] || 0) + n; return; }
  map[k] = (map[k] || 0) + n;
}

// 이벤트 하나를 버킷에 반영. 신뢰할 수 없는 값(음수 체류, 미래 시각 등)은
// 조용히 버린다 — 한 건의 이상치가 평균을 통째로 망가뜨리는 게 더 나쁘다.
const MAX_DWELL_MS = 2 * 3600 * 1000; // 2시간 이상은 탭을 켜둔 것이지 읽은 게 아니다
export function applyEvent(bucket, ev = {}, ctx = {}) {
  const b = bucket;
  switch (ev.type) {
    case "view": {
      b.pv += 1;
      if (ev.entry) {
        b.sessions += 1;
        bump(b.ref, refLabel(ev.referrer, ctx.selfHost));
        const ck = campaignKey(ev.params);
        if (ck) bump(b.camp, ck);
        bump(b.entry, viewLabel(ev.path));
      }
      break;
    }
    case "exit": {
      bump(b.exit, viewLabel(ev.path));
      const d = Number(ev.dwellMs);
      if (Number.isFinite(d) && d > 0 && d <= MAX_DWELL_MS) { b.dwellMs += d; b.dwellN += 1; }
      const k = Number(ev.depth);
      if (Number.isFinite(k) && k >= 0 && k <= 2000) { b.depth += k; b.depthN += 1; }
      break;
    }
    case "click": {
      b.clicks.total += 1;
      bump(b.clicks.bySource, ev.source);
      bump(b.clicks.byCategory, ev.category);
      // 순위는 10단위로 묶는다 — 1위와 2위를 가르는 것보다 "첫 화면에서
      // 눌리나 한참 내려가서 눌리나"가 훨씬 실행 가능한 정보다.
      const r = Number(ev.rank);
      if (Number.isFinite(r) && r >= 0) bump(b.clicks.byRank, `${Math.floor(r / 10) * 10 + 1}~${Math.floor(r / 10) * 10 + 10}`);
      break;
    }
    case "ad_impression":
    case "ad_click": {
      const isClick = ev.type === "ad_click";
      if (isClick) b.ads.click += 1; else b.ads.imp += 1;
      for (const [map, key] of [[b.ads.bySlot, ev.slot], [b.ads.byVariant, ev.variant]]) {
        if (!key) continue;
        const k = String(key).slice(0, 60);
        if (!(k in map)) {
          if (Object.keys(map).length >= MAX_KEYS) continue;
          map[k] = { imp: 0, click: 0 };
        }
        map[k][isClick ? "click" : "imp"] += 1;
      }
      break;
    }
    default:
      return false;
  }
  return true;
}

// ── 기간 롤업 ───────────────────────────────────────────────────────────────
// 일자 키는 KST 기준 'YYYY-MM-DD'. 주는 그 주 월요일 날짜, 월은 'YYYY-MM'.
export function weekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export const monthKey = (dateStr) => dateStr.slice(0, 7);

function mergeCounts(into, from) {
  for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v;
}
function mergeAdMap(into, from) {
  for (const [k, v] of Object.entries(from || {})) {
    if (!into[k]) into[k] = { imp: 0, click: 0 };
    into[k].imp += v.imp || 0;
    into[k].click += v.click || 0;
  }
}

// 여러 일 버킷을 하나로. 유니크 방문자만 합집합이고 나머지는 덧셈이다.
export function mergeBuckets(list) {
  const out = emptyBucket();
  const uids = new Set(), news = new Set();
  for (const b of list) {
    if (!b) continue;
    out.pv += b.pv || 0; out.feed += b.feed || 0; out.sessions += b.sessions || 0;
    out.dwellMs += b.dwellMs || 0; out.dwellN += b.dwellN || 0;
    out.depth += b.depth || 0; out.depthN += b.depthN || 0;
    for (const u of b.uids || []) uids.add(u);
    for (const u of b.newUids || []) news.add(u);
    mergeCounts(out.ref, b.ref); mergeCounts(out.camp, b.camp);
    mergeCounts(out.entry, b.entry); mergeCounts(out.exit, b.exit);
    out.clicks.total += (b.clicks && b.clicks.total) || 0;
    mergeCounts(out.clicks.bySource, b.clicks && b.clicks.bySource);
    mergeCounts(out.clicks.byCategory, b.clicks && b.clicks.byCategory);
    mergeCounts(out.clicks.byRank, b.clicks && b.clicks.byRank);
    out.ads.imp += (b.ads && b.ads.imp) || 0;
    out.ads.click += (b.ads && b.ads.click) || 0;
    mergeAdMap(out.ads.bySlot, b.ads && b.ads.bySlot);
    mergeAdMap(out.ads.byVariant, b.ads && b.ads.byVariant);
  }
  out.uids = [...uids];
  out.newUids = [...news];
  return out;
}

// 상위 N개만 배열로. 화면에 그릴 형태까지 여기서 만든다 — 서버와 화면이
// 서로 다르게 정렬하면 같은 표가 두 곳에서 달라 보인다.
export function topN(map, n = 10) {
  return Object.entries(map || {})
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

function adRows(map, n = 20) {
  return Object.entries(map || {})
    .map(([key, v]) => ({ key, imp: v.imp, click: v.click, ctr: v.imp ? v.click / v.imp : null }))
    .sort((a, b) => b.click - a.click || b.imp - a.imp)
    .slice(0, n);
}

// 한 기간의 요약. 평균에는 반드시 표본 수를 붙인다.
export function summarize(bucket, { key, label } = {}) {
  const b = bucket;
  return {
    key, label,
    visitors: b.uids.length,
    newVisitors: b.newUids.length,
    returning: Math.max(0, b.uids.length - b.newUids.length),
    pv: b.pv,
    sessions: b.sessions,
    feedCalls: b.feed,
    pvPerVisitor: b.uids.length ? Math.round((b.pv / b.uids.length) * 10) / 10 : null,
    // 표본이 없으면 null. 0을 내보내면 "0초 머물렀다"로 읽힌다.
    avgDwellSec: b.dwellN ? Math.round(b.dwellMs / b.dwellN / 1000) : null,
    dwellSamples: b.dwellN,
    avgDepth: b.depthN ? Math.round((b.depth / b.depthN) * 10) / 10 : null,
    depthSamples: b.depthN,
    contentClicks: b.clicks.total,
    clickPerVisitor: b.uids.length ? Math.round((b.clicks.total / b.uids.length) * 10) / 10 : null,
    adImpressions: b.ads.imp,
    adClicks: b.ads.click,
    adCtr: b.ads.imp ? b.ads.click / b.ads.imp : null,
    referrers: topN(b.ref, 12),
    campaigns: topN(b.camp, 20),
    entries: topN(b.entry, 10),
    exits: topN(b.exit, 10),
    clickSources: topN(b.clicks.bySource, 12),
    clickCategories: topN(b.clicks.byCategory, 10),
    clickRanks: topN(b.clicks.byRank, 10),
    adSlots: adRows(b.ads.bySlot),
    adVariants: adRows(b.ads.byVariant)
  };
}

// 일/주/월 시계열. buckets는 { 'YYYY-MM-DD': bucket }.
export function series(buckets, granularity = "day", limit = 30) {
  const keyOf = granularity === "week" ? weekKey : granularity === "month" ? monthKey : (d) => d;
  const groups = new Map();
  for (const day of Object.keys(buckets || {}).sort()) {
    const k = keyOf(day);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(buckets[day]);
  }
  const keys = [...groups.keys()].sort().slice(-limit);
  return keys.map((k) => summarize(mergeBuckets(groups.get(k)), {
    key: k,
    label: granularity === "week" ? `${k} 주` : granularity === "month" ? `${k}` : k
  }));
}
