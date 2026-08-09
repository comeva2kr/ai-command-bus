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
import { isBotUserAgent } from "./audience.js";

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
    // 방문자를 무엇으로 알아봤나 — login / cookie / storage / new.
    // 이게 없으면 "쿠키 복구가 실제로 되고 있나"를 영영 확인할 수 없다.
    identity: {},
    clicks: { total: 0, bySource: {}, byCategory: {}, byRank: {} },
    ads: { imp: 0, click: 0, bySlot: {}, byVariant: {} },
    // 기기·OS·브라우저 — 원시 UA는 저장하지 않고 enum 카운트만 남긴다
    // (Phase 1, 2026-08-09). applyEvent가 "view"+entry(그 화면에 처음
    // 도착) 이벤트마다 채운다 — 홈 앱과 발행 페이지(브리핑·랭킹 등)가 같은
    // Track 파이프라인을 타므로 이 한 곳이 두 표면을 다 덮는다.
    device: { mobile: 0, tablet: 0, desktop: 0, unknown: 0 },
    os: {},
    browser: {}
  };
}

// 기기·OS·브라우저 판정 — 자작 정규식(의존성 0 유지). 우선순위가 중요하다:
// 카카오톡·네이버 인앱 브라우저·삼성 인터넷·엣지는 UA에 "Chrome/..."도 함께
// 들어 있어서, 이들을 먼저 걸러내지 않으면 전부 "chrome"으로 뭉친다.
export function parseUserAgent(ua) {
  const s = typeof ua === "string" ? ua : "";

  let device = "unknown";
  if (s) {
    // SM-X는 갤럭시 탭 신형 모델명(검수: desktop으로 새고 있었다).
    if (/iPad|Tablet(?!.*Mobile)|SM-[TX]\d|Nexus (7|9|10)/i.test(s)) device = "tablet";
    else if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(s)) device = "mobile";
    else device = "desktop";
  }

  let os = "other";
  if (/iPhone|iPad|iPod|iOS/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Macintosh|Mac OS X/i.test(s)) os = "macOS";

  let browser = "other";
  if (/KAKAOTALK/i.test(s)) browser = "kakao_webview";
  else if (/NAVER\(/i.test(s)) browser = "naver_webview";
  else if (/SamsungBrowser/i.test(s)) browser = "samsung";
  // 웨일은 UA에 Chrome 토큰을 같이 실으므로 Chrome보다 먼저 본다
  // (검수: 국내 점유 있는 국산 브라우저가 chrome으로 흡수되고 있었다).
  else if (/Whale\//i.test(s)) browser = "whale";
  else if (/Edg(A|iOS)?\//i.test(s)) browser = "edge";
  else if (/Chrome|CriOS/i.test(s)) browser = "chrome";
  else if (/Safari/i.test(s)) browser = "safari";

  return { device, os, browser };
}

// bucket에 UA 판정 결과를 1건 더한다. 세션·방문당 1회 호출을 전제한다
// (store.recordDeviceInfo).
export function bumpDeviceInfo(bucket, ua) {
  const { device, os, browser } = parseUserAgent(ua);
  bucket.device = bucket.device || { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  bucket.os = bucket.os || {};
  bucket.browser = bucket.browser || {};
  bucket.device[device] = (bucket.device[device] || 0) + 1;
  bucket.os[os] = (bucket.os[os] || 0) + 1;
  bucket.browser[browser] = (bucket.browser[browser] || 0) + 1;
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
        // 기기·OS·브라우저 — 그 화면에 처음 도착한 요청(entry)에서만 1회
        // 센다. ctx.ua는 server.js가 이 요청의 User-Agent 헤더를 그대로
        // 넘긴 것 — 원시 문자열은 여기서 곧장 enum으로 바뀌고 저장되지
        // 않는다(parseUserAgent/bumpDeviceInfo 참고).
        // 알려진 봇 UA는 기기 분포에서 뺀다(audience.js와 같은 관문 —
        // 검수: Googlebot 모바일 렌더러가 mobile/chrome으로 섞이고 있었다).
        if (ctx.ua && !isBotUserAgent(ctx.ua)) bumpDeviceInfo(b, ctx.ua);
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
//
// **additive 확장 원칙**: 새 필드를 추가할 때는 여기서도 반드시 합산해야
// 한다 — 안 하면 그 필드만 조용히 0으로 그려진다(발견이 늦다, 검수 지적).
// mergeCounts는 from이 undefined여도 안전하므로 신규 필드가 없는 구버킷과
// 섞여도 죽지 않는다.
export function mergeBuckets(list) {
  const out = emptyBucket();
  const uids = new Set(), news = new Set();
  // uidCount/newUidCount — 60일 초과 버킷은 uids 리스트 대신 개수만 남는다
  // (store._rollupOldAnalyticsUids, 핫 파일 비대 방지). 그 몫은 유니크
  // 집합에 합류할 수 없으니 근사치로 더한다 — 그 구간의 주/월 유니크는
  // 정확하지 않을 수 있다(같은 사람이 여러 날 왔다면 중복 카운트).
  let uidCount = 0, newUidCount = 0;
  for (const b of list) {
    if (!b) continue;
    out.pv += b.pv || 0; out.feed += b.feed || 0; out.sessions += b.sessions || 0;
    out.dwellMs += b.dwellMs || 0; out.dwellN += b.dwellN || 0;
    out.depth += b.depth || 0; out.depthN += b.depthN || 0;
    for (const u of b.uids || []) uids.add(u);
    for (const u of b.newUids || []) news.add(u);
    uidCount += b.uidCount || 0;
    newUidCount += b.newUidCount || 0;
    mergeCounts(out.ref, b.ref); mergeCounts(out.camp, b.camp);
    mergeCounts(out.entry, b.entry); mergeCounts(out.exit, b.exit);
    mergeCounts(out.identity, b.identity);
    out.clicks.total += (b.clicks && b.clicks.total) || 0;
    mergeCounts(out.clicks.bySource, b.clicks && b.clicks.bySource);
    mergeCounts(out.clicks.byCategory, b.clicks && b.clicks.byCategory);
    mergeCounts(out.clicks.byRank, b.clicks && b.clicks.byRank);
    out.ads.imp += (b.ads && b.ads.imp) || 0;
    out.ads.click += (b.ads && b.ads.click) || 0;
    mergeAdMap(out.ads.bySlot, b.ads && b.ads.bySlot);
    mergeAdMap(out.ads.byVariant, b.ads && b.ads.byVariant);
    mergeCounts(out.device, b.device);
    mergeCounts(out.os, b.os);
    mergeCounts(out.browser, b.browser);
  }
  out.uids = [...uids];
  out.newUids = [...news];
  if (uidCount) out.uidCount = uidCount;
  if (newUidCount) out.newUidCount = newUidCount;
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
  // 60일 초과분(uidCount)이 섞인 기간은 유니크 집합에 못 들어간 근사치가
  // 함께 더해진다 — 정확한 유니크는 최근 60일 창까지만 보장된다(위
  // mergeBuckets 주석 참고).
  const visitors = b.uids.length + (b.uidCount || 0);
  const newVisitors = b.newUids.length + (b.newUidCount || 0);
  return {
    key, label,
    visitors,
    newVisitors,
    returning: Math.max(0, visitors - newVisitors),
    uidsApproximate: Boolean(b.uidCount || b.newUidCount),
    pv: b.pv,
    sessions: b.sessions,
    feedCalls: b.feed,
    pvPerVisitor: visitors ? Math.round((b.pv / visitors) * 10) / 10 : null,
    // 표본이 없으면 null. 0을 내보내면 "0초 머물렀다"로 읽힌다.
    avgDwellSec: b.dwellN ? Math.round(b.dwellMs / b.dwellN / 1000) : null,
    dwellSamples: b.dwellN,
    avgDepth: b.depthN ? Math.round((b.depth / b.depthN) * 10) / 10 : null,
    depthSamples: b.depthN,
    contentClicks: b.clicks.total,
    clickPerVisitor: visitors ? Math.round((b.clicks.total / visitors) * 10) / 10 : null,
    adImpressions: b.ads.imp,
    adClicks: b.ads.click,
    adCtr: b.ads.imp ? b.ads.click / b.ads.imp : null,
    referrers: topN(b.ref, 12),
    campaigns: topN(b.camp, 20),
    entries: topN(b.entry, 10),
    // 세션이 어떤 신원 경로로 열렸는지. new가 압도적이면 쿠키가 안 남고 있다는 뜻이다.
    identity: topN(b.identity, 6),
    identityNew: (b.identity && b.identity["new"]) || 0,
    identityRecovered: ((b.identity && b.identity.cookie) || 0) + ((b.identity && b.identity.login) || 0),
    exits: topN(b.exit, 10),
    clickSources: topN(b.clicks.bySource, 12),
    clickCategories: topN(b.clicks.byCategory, 10),
    clickRanks: topN(b.clicks.byRank, 10),
    adSlots: adRows(b.ads.bySlot),
    adVariants: adRows(b.ads.byVariant),
    // 기기·OS·브라우저 — 관리자 화면 개편(다음 단계)이 그리기 전까지는
    // 조회 API 응답에만 실린다.
    devices: { ...(b.device || {}) },
    osBreakdown: topN(b.os, 10),
    browsers: topN(b.browser, 10)
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
