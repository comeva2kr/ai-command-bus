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
    id, source, title: "글 " + id, url: "https://x/" + id, summary,
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
