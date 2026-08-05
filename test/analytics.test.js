import test from "node:test";
import assert from "node:assert/strict";
import {
  refLabel, campaignKey, viewLabel, emptyBucket, applyEvent,
  mergeBuckets, topN, summarize, series, weekKey, monthKey
} from "../src/feed/analytics.js";
import {
  costOf, emptyCostBucket, recordCall, mergeCostBuckets,
  fixedForRange, profitAndLoss, daysInMonth, MODEL_PRICING
} from "../src/feed/costs.js";

// ── 유입 출처 ───────────────────────────────────────────────────────────────
test("refLabel: 같은 서비스의 여러 도메인을 하나로 묶는다", () => {
  // m.search.naver.com과 search.naver.com이 따로 세어지면 "네이버에서 얼마나
  // 오나"를 알 수 없다 — 이게 묶는 이유의 전부다.
  assert.equal(refLabel("https://search.naver.com/x"), "네이버");
  assert.equal(refLabel("https://m.search.naver.com/y"), "네이버");
  assert.equal(refLabel("https://www.google.co.kr/z"), "구글");
  assert.equal(refLabel("https://x.com/a"), "X");
  assert.equal(refLabel("https://twitter.com/a"), "X");
});

test("refLabel: 없는 referrer는 '직접 유입', 우리 도메인은 '내부 이동'", () => {
  assert.equal(refLabel(""), "직접 유입");
  assert.equal(refLabel(null), "직접 유입");
  assert.equal(refLabel("깨진문자열"), "직접 유입");
  assert.equal(refLabel("https://nowhot.kr/briefing", "nowhot.kr"), "내부 이동");
  assert.equal(refLabel("https://www.nowhot.kr/x", "nowhot.kr"), "내부 이동");
});

test("campaignKey: utm이 없으면 null — 캠페인 아닌 유입을 캠페인 표에 섞지 않는다", () => {
  assert.equal(campaignKey({}), null);
  assert.equal(campaignKey({ utm_source: "naver_blog", utm_medium: "post", utm_campaign: "0804" }),
    "naver_blog | post | 0804");
  // 일부만 있어도 캠페인으로 잡되 빈 축은 '-'로 남긴다
  assert.equal(campaignKey({ utm_source: "kakao" }), "kakao | - | -");
});

test("viewLabel: 개별 키워드 페이지를 한 종류로 접는다", () => {
  // /keyword/삼성전자를 따로 세면 표가 수천 줄이 된다.
  assert.equal(viewLabel("/keyword/삼성전자"), "키워드");
  assert.equal(viewLabel("/keyword/엔비디아"), "키워드");
  assert.equal(viewLabel("/"), "홈");
  assert.equal(viewLabel("/briefing/2026-08-04"), "브리핑");
});

// ── 이벤트 반영 ─────────────────────────────────────────────────────────────
test("applyEvent: 진입 이벤트만 유입 출처를 센다", () => {
  const b = emptyBucket();
  applyEvent(b, { type: "view", path: "/", entry: true, referrer: "https://search.naver.com/x", params: {} });
  applyEvent(b, { type: "view", path: "/briefing", entry: false, referrer: "https://search.naver.com/x" });
  assert.equal(b.pv, 2);
  assert.equal(b.sessions, 1, "세션은 진입 1회만");
  assert.deepEqual(b.ref, { "네이버": 1 }, "내부 이동이 유입 표를 덮어쓰면 진짜 출처가 안 보인다");
  assert.deepEqual(b.entry, { "홈": 1 });
});

test("applyEvent: 말이 안 되는 체류·깊이는 버린다", () => {
  const b = emptyBucket();
  applyEvent(b, { type: "exit", path: "/", dwellMs: -5, depth: 3 });
  applyEvent(b, { type: "exit", path: "/", dwellMs: 9 * 3600e3, depth: 3 });  // 9시간 = 탭 켜둔 것
  applyEvent(b, { type: "exit", path: "/", dwellMs: 45000, depth: 12 });
  assert.equal(b.dwellN, 1, "이상치 두 건은 표본에서 제외");
  assert.equal(b.dwellMs, 45000);
  assert.equal(b.depthN, 3, "깊이는 세 건 다 정상 범위");
});

test("applyEvent: 클릭 순위는 10단위 구간으로 묶는다", () => {
  const b = emptyBucket();
  applyEvent(b, { type: "click", source: "ppomppu", category: "life", rank: 0 });
  applyEvent(b, { type: "click", source: "ppomppu", category: "life", rank: 7 });
  applyEvent(b, { type: "click", source: "clien", category: "tech", rank: 23 });
  assert.equal(b.clicks.total, 3);
  assert.deepEqual(b.clicks.bySource, { ppomppu: 2, clien: 1 });
  assert.deepEqual(b.clicks.byRank, { "1~10": 2, "21~30": 1 });
});

test("applyEvent: 광고 노출·클릭이 슬롯별·문구별로 갈린다", () => {
  const b = emptyBucket();
  applyEvent(b, { type: "ad_impression", slot: "feed", variant: "dgt_tech_0" });
  applyEvent(b, { type: "ad_impression", slot: "feed", variant: "dgt_tech_0" });
  applyEvent(b, { type: "ad_click", slot: "feed", variant: "dgt_tech_0" });
  applyEvent(b, { type: "ad_impression", slot: "briefing", variant: "home_life_1" });
  assert.deepEqual(b.ads.bySlot.feed, { imp: 2, click: 1 });
  assert.deepEqual(b.ads.bySlot.briefing, { imp: 1, click: 0 });
  assert.equal(b.ads.imp, 3);
  assert.equal(b.ads.click, 1);
});

test("applyEvent: 모르는 타입은 조용히 무시한다", () => {
  const b = emptyBucket();
  assert.equal(applyEvent(b, { type: "해킹시도" }), false);
  assert.equal(b.pv, 0);
});

test("applyEvent: 키가 무한히 늘지 않는다", () => {
  const b = emptyBucket();
  for (let i = 0; i < 300; i++) applyEvent(b, { type: "click", source: "src" + i, rank: 1 });
  assert.ok(Object.keys(b.clicks.bySource).length <= 121, "상한을 넘으면 '기타'로 접는다");
  assert.ok(b.clicks.bySource["기타"] > 0);
  assert.equal(b.clicks.total, 300, "합계는 그대로 정확해야 한다");
});

// ── 롤업 ────────────────────────────────────────────────────────────────────
test("mergeBuckets: 유니크 방문자는 합집합, 나머지는 덧셈", () => {
  const a = emptyBucket(); a.pv = 10; a.uids = ["u1", "u2"];
  const b = emptyBucket(); b.pv = 5; b.uids = ["u2", "u3"];
  const m = mergeBuckets([a, b]);
  assert.equal(m.pv, 15);
  assert.equal(m.uids.length, 3, "같은 사람이 이틀 오면 2가 아니라 1이다");
});

test("weekKey / monthKey", () => {
  assert.equal(weekKey("2026-08-04"), "2026-08-03", "화요일 -> 그 주 월요일");
  assert.equal(weekKey("2026-08-03"), "2026-08-03");
  assert.equal(weekKey("2026-08-09"), "2026-08-03", "일요일도 같은 주");
  assert.equal(monthKey("2026-08-04"), "2026-08");
});

test("summarize: 표본이 없으면 평균을 0이 아니라 null로 낸다", () => {
  // 0을 내보내면 "0초 머물렀다"로 읽혀서 거짓말이 된다.
  const s = summarize(emptyBucket(), { key: "2026-08-04" });
  assert.equal(s.avgDwellSec, null);
  assert.equal(s.dwellSamples, 0);
  assert.equal(s.adCtr, null, "노출 0에서 CTR은 정의되지 않는다");
  assert.equal(s.pvPerVisitor, null);
});

test("summarize: 신규와 재방문을 나눈다", () => {
  const b = emptyBucket();
  b.uids = ["u1", "u2", "u3"]; b.newUids = ["u3"];
  b.pv = 9; b.ads.imp = 100; b.ads.click = 3;
  const s = summarize(b, { key: "d" });
  assert.deepEqual([s.visitors, s.newVisitors, s.returning], [3, 1, 2]);
  assert.equal(s.pvPerVisitor, 3);
  assert.equal(s.adCtr, 0.03);
});

test("series: 일/주/월 축을 바꿔도 같은 원본에서 나온다", () => {
  const mk = (pv, uid) => { const b = emptyBucket(); b.pv = pv; b.uids = [uid]; return b; };
  const buckets = {
    "2026-08-03": mk(10, "u1"),
    "2026-08-04": mk(20, "u1"),
    "2026-08-05": mk(30, "u2")
  };
  const days = series(buckets, "day");
  assert.equal(days.length, 3);
  const weeks = series(buckets, "week");
  assert.equal(weeks.length, 1, "셋 다 같은 주");
  assert.equal(weeks[0].pv, 60);
  assert.equal(weeks[0].visitors, 2, "u1이 이틀 와도 1명");
  const months = series(buckets, "month");
  assert.equal(months[0].key, "2026-08");
});

test("topN: 동점이면 이름순으로 안정 정렬", () => {
  const t = topN({ b: 5, a: 5, c: 9 }, 3);
  assert.deepEqual(t.map((x) => x.key), ["c", "a", "b"]);
});

// ── 지출 ────────────────────────────────────────────────────────────────────
test("costOf: 단가를 모르는 모델은 비용을 지어내지 않는다", () => {
  assert.equal(costOf("존재하지-않는-모델", 1000, 1000), null);
  // sonnet-5: 입력 $3 / 출력 $15 per 1M
  assert.equal(costOf("claude-sonnet-5", 1e6, 0), 3);
  assert.equal(costOf("claude-sonnet-5", 0, 1e6), 15);
});

test("recordCall: 모델별·용도별로 갈라 쌓는다", () => {
  const b = emptyCostBucket();
  recordCall(b, { model: "claude-sonnet-5", inputTokens: 1e6, outputTokens: 1e5, purpose: "브리핑 해설" });
  recordCall(b, { model: "claude-sonnet-5", inputTokens: 1e6, outputTokens: 1e5, purpose: "브리핑 해설" });
  recordCall(b, { model: "미등록모델", inputTokens: 500, outputTokens: 500, purpose: "실험" });
  assert.equal(b.calls, 3);
  assert.equal(b.unpriced, 1, "단가 미등록 호출은 따로 센다");
  assert.equal(Math.round(b.usd * 100) / 100, 9, "(3 + 1.5) x 2");
  assert.equal(b.byPurpose["브리핑 해설"].calls, 2);
  assert.ok(b.byModel["미등록모델"], "비용을 몰라도 호출 수는 남긴다");
  assert.equal(b.byModel["미등록모델"].usd, 0);
});

test("mergeCostBuckets: 여러 날을 합쳐도 축이 유지된다", () => {
  const a = emptyCostBucket(), b = emptyCostBucket();
  recordCall(a, { model: "claude-sonnet-5", inputTokens: 1e6, outputTokens: 0, purpose: "x" });
  recordCall(b, { model: "claude-sonnet-5", inputTokens: 1e6, outputTokens: 0, purpose: "y" });
  const m = mergeCostBuckets([a, b]);
  assert.equal(m.calls, 2);
  assert.equal(m.usd, 6);
  assert.deepEqual(Object.keys(m.byPurpose).sort(), ["x", "y"]);
});

test("daysInMonth", () => {
  assert.equal(daysInMonth("2026-08"), 31);
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
});

test("fixedForRange: 미입력 달은 0이 아니라 '미입력'으로 보고한다", () => {
  // 0으로 두면 순이익이 부풀어 보인다 — 없는 걸 없다고 말해야 한다.
  const fixed = { "2026-08": [{ label: "VM", krw: 31000 }] };
  const r = fixedForRange(fixed, ["2026-08-01", "2026-08-02", "2026-09-01"]);
  assert.equal(Math.round(r.krw), 2000, "31000/31 x 2일");
  assert.deepEqual(r.missingMonths, ["2026-09"]);
});

test("profitAndLoss: 매출 미입력이면 순이익을 계산하지 않는다", () => {
  // 매출을 0으로 가정하면 "적자 -N원"이라는 틀린 결론이 나온다.
  const cost = emptyCostBucket();
  recordCall(cost, { model: "claude-sonnet-5", inputTokens: 1e6, outputTokens: 0, purpose: "x" });
  const pl = profitAndLoss({
    costBucket: cost,
    fixedByMonth: { "2026-08": [{ label: "VM", krw: 31000 }] },
    days: ["2026-08-01"],
    revenueKrw: null,
    usdKrw: 1400
  });
  assert.equal(pl.variableUsd, 3);
  assert.equal(pl.variableKrw, 4200);
  assert.equal(pl.fixedKrw, 1000);
  assert.equal(pl.totalKrw, 5200);
  assert.equal(pl.netKrw, null, "매출을 모르면 순이익도 모른다");

  const pl2 = profitAndLoss({ costBucket: cost, fixedByMonth: {}, days: ["2026-08-01"], revenueKrw: 10000, usdKrw: 1400 });
  assert.equal(pl2.netKrw, 10000 - 4200);
  assert.deepEqual(pl2.fixedMissingMonths, ["2026-08"]);
});

test("MODEL_PRICING: 우리가 실제로 쓰는 모델의 단가가 등록돼 있다", () => {
  // 기본 모델이 목록에 없으면 매달 비용이 통째로 '미등록'으로 빠진다.
  const inUse = process.env.LLM_MODEL || "claude-sonnet-5";
  assert.ok(MODEL_PRICING[inUse], `${inUse} 단가 미등록 — 지출 집계에서 누락된다`);
});

// ── 광고 카드 복구 회귀 (2026-08-04) ────────────────────────────────────────
//
// 실측: 라이브 피드 응답 30건 중 광고 카드 0건, 노출 누적 0. 원인은
// pickAffiliateCandidates가 Open API productFeed 없이는 항상 빈 배열을 냈던 것.
// 우리 방문자 대부분이 익명이라 취향 벡터가 비어 있다는 점까지 함께 못 박는다 —
// 취향 없는 사용자에게 광고가 0이면 사실상 전체가 0이다.
test("광고: 상품 피드가 없어도 실제 카테고리 배너로 후보가 나온다", async () => {
  const { pickAffiliateCandidates, injectSlots, adParams, adaptiveEvery } = await import("../src/feed/monetize.js");
  const partnerId = "AF5818321";
  for (const [label, prefs] of [["익명(취향 없음)", {}], ["취향 있음", { tech: 5, life: 3 }]]) {
    const c = pickAffiliateCandidates(prefs, { partnerId, preview: false, seed: 3, productFeed: null });
    assert.ok(c.length > 0, `${label}: 후보가 0이면 피드 광고가 통째로 사라진다`);
    // 지어낸 상품이 아니라 실제 쿠팡 링크여야 한다.
    assert.ok(c.every((x) => /^https:\/\/link\.coupang\.com\//.test(x.url)), `${label}: 실제 파트너스 링크만`);
    assert.ok(c.every((x) => !x.sample), `${label}: 샘플 카드가 아니다`);
    // 가격을 지어내지 않는다 — 배너는 가격 정보를 주지 않는다.
    assert.ok(c.every((x) => x.priceSale == null && x.priceOriginal == null), `${label}: 없는 가격을 만들지 않는다`);
    const batch = Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, title: "t" + i, category: "life" }));
    const p = adParams();
    const r = injectSlots(batch, c, { ...p, every: adaptiveEvery(p.every, null), startIndex: 0 });
    assert.ok(r.slots.length > 0, `${label}: 30건 피드에 광고가 최소 1건은 실려야 한다`);
  }
});

test("광고: 파트너 ID조차 없으면 여전히 광고를 내지 않는다", async () => {
  const { pickAffiliateCandidates } = await import("../src/feed/monetize.js");
  const c = pickAffiliateCandidates({ tech: 5 }, { partnerId: null, preview: false, productFeed: null });
  assert.equal(c.length, 0, "자격증명 없이 제휴 카드를 내보내지 않는다는 원칙은 그대로다");
});

// ── 신원 확정 (GA4 blended identity 벤치마크) ───────────────────────────────
//
// 실측 2026-08-04: 8/3 방문자 135명 중 133명이 그날 새로 만들어진 ID였다.
// David 제보로 이게 사실이 아님이 확인됐다 — 매일 오는 사람이 실제로 있다.
// 원인은 신원을 localStorage 하나에만 의존한 것. 카카오톡·네이버 앱 내장
// 브라우저가 저장소를 비우면 매번 새 사용자가 발급됐고, 로그인 쿠키가
// 살아 있어도 쓰이지 않았다.
//
// GA4는 client_id를 1st-party 쿠키(2년)에 두고, 로그인하면 user_id로 덮는다.
// 같은 우선순위를 여기서 못 박는다.
test("resolveIdentity: 로그인 세션이 가장 강하다 — 기기가 달라도 한 사람", async () => {
  const { resolveIdentity, SESSION_COOKIE, DEVICE_COOKIE } = await import("../src/feed/auth.js");
  const store = {
    sessionUser: (t) => (t === "tok" ? "acct_1" : null),
    getUser: (id) => (["acct_1", "dev_9", "ls_3"].includes(id) ? { id } : null)
  };
  const r = resolveIdentity({
    cookies: { [SESSION_COOKIE]: "tok", [DEVICE_COOKIE]: "dev_9" },
    bodyUserId: "ls_3", store
  });
  assert.deepEqual([r.userId, r.source, r.loggedIn], ["acct_1", "login", true]);
});

test("resolveIdentity: 저장소가 비어도 기기 쿠키로 같은 사람을 이어간다", async () => {
  const { resolveIdentity, DEVICE_COOKIE } = await import("../src/feed/auth.js");
  const store = { sessionUser: () => null, getUser: (id) => (id === "dev_9" ? { id } : null) };
  // 앱 내장 브라우저가 localStorage를 비운 상황: bodyUserId가 null이다.
  const r = resolveIdentity({ cookies: { [DEVICE_COOKIE]: "dev_9" }, bodyUserId: null, store });
  assert.deepEqual([r.userId, r.source], ["dev_9", "cookie"]);
});

test("resolveIdentity: 쿠키가 없으면 기존 localStorage 사용자를 잃지 않는다", async () => {
  // 배포 직후 기존 사용자는 쿠키가 없다. 여기서 새 사람으로 만들면 그동안의
  // 취향·스크랩이 통째로 끊긴다.
  const { resolveIdentity } = await import("../src/feed/auth.js");
  const store = { sessionUser: () => null, getUser: (id) => (id === "ls_3" ? { id } : null) };
  const r = resolveIdentity({ cookies: {}, bodyUserId: "ls_3", store });
  assert.deepEqual([r.userId, r.source], ["ls_3", "storage"]);
});

test("resolveIdentity: 아무 단서도 없을 때만 신규다", async () => {
  const { resolveIdentity } = await import("../src/feed/auth.js");
  const store = { sessionUser: () => null, getUser: () => null };
  const r = resolveIdentity({ cookies: {}, bodyUserId: null, store });
  assert.deepEqual([r.userId, r.source], [null, "new"]);
  // 서버에 없는 유령 ID를 들고 와도 신규로 떨어져야 한다(데이터 삭제 후 등).
  const r2 = resolveIdentity({ cookies: { nh_cid: "지워진ID" }, bodyUserId: "이것도없음", store });
  assert.equal(r2.source, "new");
});

test("기기 쿠키: GA4와 같은 2년 · HttpOnly · SameSite=Lax", async () => {
  const { serializeDeviceCookie } = await import("../src/feed/auth.js");
  const c = serializeDeviceCookie("user_1", { secure: true });
  assert.match(c, /^nh_cid=user_1/);
  assert.match(c, /Max-Age=63072000/);       // 2년 — 방문마다 갱신된다
  assert.match(c, /HttpOnly/);                // 페이지 스크립트가 실수로 지울 수 없다
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  // http 로컬 개발에서는 Secure를 빼야 브라우저가 쿠키를 버리지 않는다
  assert.ok(!/Secure/.test(serializeDeviceCookie("user_1", { secure: false })));
});

test("analytics: 신원 경로가 집계돼 쿠키 복구가 작동하는지 볼 수 있다", () => {
  const b = emptyBucket();
  for (const s of ["new", "new", "cookie", "cookie", "cookie", "login"]) {
    b.identity[s] = (b.identity[s] || 0) + 1;
  }
  const sum = summarize(b, { key: "d" });
  assert.equal(sum.identityNew, 2);
  assert.equal(sum.identityRecovered, 4, "쿠키+로그인으로 복구된 세션");
  assert.equal(sum.identity[0].key, "cookie");
});

// ── 발췌 품질 (2026-08-04) ──────────────────────────────────────────────────
test("랭킹: 사이트 소개문·유도 문구가 발췌로 새어 나가지 않는다", async () => {
  // 발췌는 원문의 og:description에서 오는데, 상당수 사이트가 글별 설명 대신
  // 사이트 소개문을 통째로 내려준다. 실측: 이토랜드 글 전부에 같은 소개문이
  // 붙었고 "직접 눌러서 내용을 확인해 주세요" 같은 유도 문구도 섞였다.
  // 같은 문단이 페이지에 반복되면 정확히 "템플릿으로 찍어낸 페이지"가 된다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const boiler = "이토랜드는 유머, 연예, 정보, 이슈를 빠르게 공유하는 커뮤니티입니다.";
  const mk = (id, source, summary, score) => ({
    id, source, title: "테스트 게시물 " + id, url: "https://x/" + id, summary,
    score, commentCount: score, category: "humor",
    publishedAt: new Date(Date.now() - 3600e3).toISOString()
  });
  const engine = new FeedEngine({ firstSeenOf: () => undefined, rememberFirstSeen: () => {} }, []);
  engine._cache = [
    mk("a", "etoland", boiler, 90),
    mk("b", "etoland", boiler, 80),
    mk("c", "instiz", "직접 눌러서 내용을 확인해 주세요", 70),
    mk("d", "clien", "새 맥북 프로 사용기를 정리했습니다. 배터리와 발열 위주로 봤습니다.", 60),
    mk("e", "ppomppu", "짧다", 50)
  ];
  engine._itemLabels = new Map();
  const { items } = await engine.rankingTop(10);
  const by = Object.fromEntries(items.map((i) => [i.id, i.summary]));
  assert.equal(by.a, "", "여러 글에 똑같이 붙은 소개문은 그 글의 것이 아니다");
  assert.equal(by.b, "");
  assert.equal(by.c, "", "알맹이 없는 유도 문구");
  assert.equal(by.e, "", "한 문장도 안 되는 발췌");
  assert.match(by.d, /맥북/, "진짜 글별 발췌는 남아야 한다");
});

// ── 승격 제외 (2026-08-04 적대적 검수) ──────────────────────────────────────
test("승격 제외: 알맹이 없는 글은 대표 자리에 올리지 않되 삭제하지 않는다", async () => {
  const { promotable, isLowValue, lowValueReason, adUnsafe } = await import("../src/feed/promotion.js");
  // 실측으로 대표 자리에 올라왔던 것들
  assert.equal(isLowValue("300추 가능한가요?"), true);
  assert.equal(lowValueReason("300추 가능한가요?"), "추천 구걸");
  assert.equal(isLowValue("실시간 세르카 나메 2관 파티모집창"), true);
  assert.equal(isLowValue("출석 체크합니다"), true);

  // 정상 글은 절대 걸리면 안 된다 — 오탐 하나가 진짜 화제를 밀어낸다
  for (const ok of [
    "제작비 100억 이상 쓰고 폭망한 영화.jpg",
    "애플이 잘못하고 있다",
    "이번에 발표된 청년혜택 진짜 파격적이네요",
    "LLMs reward expertise",
    "수학과 이론 컴퓨터 과학의 10가지 발전",
    "5000원으로 장보기 성공한 후기"        // 숫자 + 후기 — 구걸 패턴과 헷갈리기 쉽다
  ]) {
    assert.equal(isLowValue(ok), false, `오탐: "${ok}"`);
  }

  // 광고 인접 판정은 **글을 막는 게 아니라 그 옆에 광고를 안 붙이는 것**이다.
  // 이미 붙어 있는 태그만 쓴다 — 새로 의미를 판별하려 들지 않는다.
  assert.equal(adUnsafe({ title: "평범한 글", topics: [] }), false);
  assert.equal(adUnsafe({ title: "평범한 글", topics: ["politics"] }), true);

  // 종합 판정
  assert.equal(promotable({ title: "애플이 잘못하고 있다", topics: [] }), true);
  assert.equal(promotable({ title: "300추 가능한가요?", topics: [] }), false);
  // 정치는 대표 자리에서 빼지 않는다 — 광고만 안 붙인다(뉴스가 통째로 죽는다)
  assert.equal(promotable({ title: "예산안 처리 무산", topics: ["politics"] }), true);
});

test("광고 인접: 민감한 글 옆에는 광고를 붙이지 않되 글은 그대로 둔다", async () => {
  const { injectSlots, adParams } = await import("../src/feed/monetize.js");
  const cand = Array.from({ length: 4 }, (_, k) => ({
    id: "ad" + k, relevance: 0.9, url: "https://link.coupang.com/a/x" + k
  }));
  const p = { ...adParams(), every: 3, skipFirst: 0, maxPerPage: 5, minRelevance: 0.3 };
  const mk = (id, topics = []) => ({ id, title: "글 " + id, topics });
  // 0번(광고가 붙을 자리)이 정치 글이면 그 자리는 건너뛴다
  const items = [mk("a", ["politics"]), mk("b"), mk("c"), mk("d"), mk("e"), mk("f"), mk("g")];
  const r = injectSlots(items, cand, { ...p, startIndex: 0 });
  // 글은 하나도 사라지지 않는다 — 승격 제외와 같은 원칙이다
  const kept = r.items.filter((x) => !String(x.id).startsWith("ad")).map((x) => x.id);
  assert.deepEqual(kept, ["a", "b", "c", "d", "e", "f", "g"], "민감한 글도 피드에는 그대로 남는다");
  // 정치 글 바로 옆에는 광고가 없다
  const idxA = r.items.findIndex((x) => x.id === "a");
  assert.ok(!String(r.items[idxA - 1]?.id || "").startsWith("ad"), "앞에 광고 없음");
  assert.ok(!String(r.items[idxA + 1]?.id || "").startsWith("ad"), "뒤에 광고 없음");
  // 안전한 자리에는 정상적으로 붙는다
  assert.ok(r.slots.length > 0, "민감하지 않은 자리에는 광고가 들어가야 한다");
});

test("승격 제외: 저속·비하 표현은 대표 자리에서만 빼고 피드에는 남긴다", async () => {
  const { promotable, hasUnpromotableExpression } = await import("../src/feed/promotion.js");
  const { maskProfanity } = await import("../src/feed/profanity.js");
  // 검수 3인이 전원 지적했고, 고친 뒤에도 브리핑 1위였던 실제 제목
  const t = "우리나라 못생남 빨아주느라 단어가 점점 하타치가 됨";
  assert.equal(hasUnpromotableExpression(t), true);
  assert.equal(promotable({ title: t, topics: [] }), false, "브리핑·랭킹 대표에서 제외");
  // 그러나 **마스킹 사전에는 넣지 않았다** — 피드 화면의 제목은 원문 그대로다.
  // 넣었다면 여기서 ● 가 나온다(David 원칙: 삭제·왜곡 금지, 승격 제외만).
  assert.equal(maskProfanity(t), t, "피드 표시는 건드리지 않는다");

  for (const bad of ["미성년자 성매매범을 바라보는 일베의 시선.jpg", "몰카 적발 현장"]) {
    assert.equal(promotable({ title: bad, topics: [] }), false, bad);
  }
  // 오탐 방지 — 짧은 말이 다른 낱말에 묻히면 안 된다.
  // "일베이스캠프"가 "일베"+조사로 읽혀 걸렸던 실제 오탐을 여기 고정한다.
  for (const ok of ["못생겼다고 놀림받던 강아지 근황", "일베이스캠프 등반기", "메갈리아 논쟁사"]) {
    assert.equal(promotable({ title: ok, topics: [] }), true, `오탐: ${ok}`);
  }
  // 조사가 붙어도 잡아야 한다
  for (const bad of ["김어준 일베 추적 결과", "일베 회원 검거", "성매매 처벌법 개정안 국회 통과"]) {
    assert.equal(promotable({ title: bad, topics: [] }), false, `놓침: ${bad}`);
  }
});

// ── 조회수·작성일 (David 2026-08-04, 오늘의베스트 대조) ─────────────────────
test("파서: 조회수와 작성일이 실제로 들어온다", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const fs = await import("node:fs");
  const R = loadRegistry();
  // 실측 2026-08-04: 조회수 0/306건, 작성일도 이토랜드·뽐뿌·인스티즈 전부 0.
  // "얘들은 조회수 추천수 댓글 작성일 다 표시된다. 애들이 가져오는 건 우리도
  // 다 가져올 수 있잖아" — HTML에는 처음부터 다 있었고 정규식만 없었다.
  const cases = [
    { id: "ppomppu", file: "ppomppu_hot.html", charset: "euc-kr", minView: 15 },
    { id: "instiz", file: "instiz_pt.html", charset: "utf-8", minView: 8, minDate: 8 },
    { id: "etoland", file: "etoland_hit.html", charset: "utf-8", minView: 30, minDate: 30 }
  ];
  for (const c of cases) {
    const buf = fs.readFileSync(new URL("./fixtures/" + c.file, import.meta.url));
    const html = new TextDecoder(c.charset).decode(buf);
    const items = parseListPage(html, R.find((x) => x.id === c.id).adapter.list);
    const views = items.filter((i) => i.viewCount > 0).length;
    assert.ok(views >= c.minView, `${c.id}: 조회수 ${views}건 (>= ${c.minView} 기대)`);
    if (c.minDate) {
      const dates = items.filter((i) => i.publishedAt).length;
      assert.ok(dates >= c.minDate, `${c.id}: 작성일 ${dates}건 (>= ${c.minDate} 기대)`);
    }
  }
});

test("날짜: 게시판이 쓰는 네 가지 형식을 다 읽는다", async () => {
  const { normalizeListDate } = await import("../src/feed/fetchers.js");
  const now = () => Date.UTC(2026, 7, 4, 12, 0, 0);
  assert.ok(normalizeListDate("12:52", now), "HH:MM");
  assert.ok(normalizeListDate("00:15:01", now), "HH:MM:SS — 뽐뿌. 이걸 못 읽어 작성일이 통째로 비었다");
  assert.ok(normalizeListDate("08.04 12:52", now), "MM.DD HH:MM — 인스티즈의 지난 날 글");
  assert.ok(normalizeListDate("5분전", now), "상대 시각");
  // 연말·연초 경계: 연도를 안 주는 형식이 미래로 계산되면 작년 글이다
  const y = normalizeListDate("12.31 23:50", now);
  assert.ok(y && new Date(y).getUTCFullYear() === 2025, `작년으로 보정돼야 한다 (실제 ${y})`);
  // 못 읽는 것은 지어내지 않는다
  assert.equal(normalizeListDate("알 수 없음", now), null);
});

test("표시: 조회수는 잡힐 때만 그리고 화제성 점수에는 넣지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  assert.match(html, /function viewMetaHtml\(item\)/);
  // "조회 0"은 "아무도 안 봤다"로 읽힌다 — 안 잡히는 것과 0은 다르다
  assert.match(html, /if\(!Number\.isFinite\(v\) \|\| v <= 0\) return "";/);
  // 조회수는 게시판마다 자릿수가 달라 순위 축에 올리면 순서가 뒤집힌다
  const ingest = readFileSync("src/feed/ingest.js", "utf8");
  const raw = ingest.slice(ingest.indexOf("function rawEngagement"), ingest.indexOf("function rawEngagement") + 700);
  assert.ok(!/viewCount/.test(raw), "조회수를 화제성 점수에 넣으면 순위가 통째로 뒤집힌다");
});

// ── 수집 동시성 (2026-08-04) ────────────────────────────────────────────────
test("수집: 동시 요청을 제한하되 순서와 실패 격리는 그대로다", async () => {
  const { collect } = await import("../src/feed/content.js");
  // 실측: 47곳을 한꺼번에 던지자 15곳이 8초 타임아웃에 걸렸다. 소스가 고장난
  // 게 아니라 동시 요청이 몰려 느려진 것이었고, 활성 47곳 중 20곳만 풀에
  // 들어왔다. 공급이 절반이면 화제성 순위 자체가 흔들린다.
  let running = 0, peak = 0;
  const mk = (id, n, fail) => ({
    id, kind: "news",
    async fetch() {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (fail) throw new Error("boom");
      return Array.from({ length: n }, (_, k) => ({
        id: `${id}-${k}`, title: `${id} 글 ${k}`, url: `https://x/${id}/${k}`, source: id
      }));
    }
  });
  const sources = Array.from({ length: 20 }, (_, i) => mk(`s${i}`, 2, i === 3));
  const { items, errors } = await collect(sources, { concurrency: 4 });
  assert.ok(peak <= 4, `동시 실행이 ${peak}개 — 제한이 안 걸렸다`);
  // 한 소스가 실패해도 나머지는 그대로 들어온다(Promise.allSettled와 같은 계약)
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, "s3");
  assert.equal(items.filter((i) => i.source === "s3").length, 0);
  assert.ok(items.length >= 38, `나머지 19곳 × 2건이 들어와야 한다 (실제 ${items.length})`);
  // 입력 순서가 유지돼야 sourceRank 같은 순서 의존 로직이 안 깨진다
  assert.equal(items[0].source, "s0");
});

test("수집: 동시성 값이 잘못돼도 조용히 죽지 않는다", async () => {
  const { collect } = await import("../src/feed/content.js");
  // 적대적 검수 P0. limit이 NaN이면 워커가 0개가 되고 결과 배열이 통째로
  // 구멍이 된다 → forEach가 한 번도 안 돌아 "신규 0건, 오류 0건"으로 조용히
  // 끝난다. FEED_CONCURRENCY에 오타 하나면 수집이 무증상으로 멈춘다.
  const mk = (id) => ({ id, kind: "news", async fetch() {
    return [{ id: `${id}-1`, title: `${id} 글`, url: `https://x/${id}`, source: id }];
  }});
  const sources = [mk("a"), mk("b"), mk("c")];
  for (const bad of [NaN, 0, -1, undefined, "prod"]) {
    const { items } = await collect(sources, { concurrency: bad });
    assert.equal(items.length, 3, `concurrency=${String(bad)}에서 수집이 죽었다`);
  }
  // 빈 입력에서 멈추지 않는다
  assert.deepEqual((await collect([], { concurrency: 4 })).items, []);
});

test("수집: 갱신이 겹쳐 돌지 않는다", async () => {
  // 상대 서버가 느린 날 한 사이클이 15분을 넘기면 타이머가 또 돈다.
  // 겹치면 소켓·워커가 계속 쌓인다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  let calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  // 생성자는 (store, sources) — 위치 인자다
  const engine = new FeedEngine(null, [{ id: "s", kind: "news", async fetch() {
    calls++; await gate; return [];
  }}]);
  const a = engine.refresh(), b = engine.refresh();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1, "두 번째 refresh가 수집을 또 시작했다");
});

test("카테고리 브리핑도 대표 지면 게이트를 지킨다", async () => {
  // 2026-08-05 전수검사: 홈 피드·화제 랭킹·브리핑에 다 걸려 있는 두 가지가
  // 카테고리 브리핑에만 빠져 있었다 — 저가치 제목 제외(promotable)와
  // 메인 제외 소스(offMain). 검사 시점 라이브 27건 중 걸린 건 0건이었지만,
  // 막는 장치가 없다는 것과 지금 깨끗한 것은 다른 이야기다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const src = {
    id: "clien", kind: "community",
    async fetch() {
      return [
        { id: "beg", title: "300추 가능한가요?", url: "https://x/1", source: "clien",
          category: "humor", score: 900, commentCount: 50 },
        { id: "ok", title: "이번 주 가장 많이 웃은 글 모음", url: "https://x/2", source: "clien",
          category: "humor", score: 100, commentCount: 10 }
      ];
    }
  };
  const engine = new FeedEngine(null, [src]);
  const res = await engine.categoryTop("humor", 10);   // { generatedAt, items }
  const ids = res.items.map((i) => i.id);
  assert.ok(!ids.includes("beg"), `추천 구걸 글이 카테고리 브리핑 대표로 올라왔다: ${ids.join(",")}`);
  assert.ok(ids.includes("ok"), "정상 글까지 사라지면 안 된다");
});

test("대가성 고지문은 흐린 글씨로 쓰지 않는다", async () => {
  // 실측(2026-08-05): --muted 는 흰 배경에서 #848383, 대비 3.78:1로 AA(4.5) 미달.
  // 11.5px 작은 글씨까지 겹쳐서, 하필 법으로 반드시 보여야 하는 문장이 그
  // 페이지에서 가장 안 보이는 글자였다.
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/feed/server.js", "utf8");
  const rule = css.slice(css.indexOf(".ad-disclosure{"), css.indexOf("}", css.indexOf(".ad-disclosure{")));
  assert.ok(!/var\(--muted\)/.test(rule), `고지문이 흐린 색을 쓴다: ${rule}`);
  const size = Number((rule.match(/font-size:([\d.]+)px/) || [])[1]);
  assert.ok(size >= 13, `고지문이 너무 작다 (${size}px)`);
});
