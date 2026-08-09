// 관리자 분석 재설계 Phase 1 — 사람 판정 한 벌 (src/feed/audience.js) +
// store.markHumanDay + 가짜 사람 구멍 봉쇄 + traffic/analytics 롤업.
//
// 설계·적대적 검수 산출물(과제 A, REVISE #1~#5) 반영분의 회귀 고정.
import test from "node:test";
import assert from "node:assert/strict";
import { FeedStore } from "../src/feed/store.js";
import { classify, isBotUserAgent, QUALIFYING_SIGNAL_TYPES } from "../src/feed/audience.js";
import { emptyBucket, mergeBuckets, parseUserAgent, bumpDeviceInfo } from "../src/feed/analytics.js";
import { createServer } from "../src/feed/server.js";

const fixedClock = () => "2026-07-06T00:00:00.000Z"; // KST 09:00

const jsonPost = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

// ── audience.classify ───────────────────────────────────────────────────────

test("classify: x-nowhot-check 헤더가 있으면 internal (UA와 무관하게 우선)", () => {
  assert.equal(classify({ headers: { "x-nowhot-check": "1" } }), "internal");
  assert.equal(classify({ headers: { "x-nowhot-check": "1", "user-agent": "curl/8.0" } }), "internal");
});

test("classify: 알려진 봇·크롤러·스크립트 UA는 bot", () => {
  const bots = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "kakaotalk-scrap/1.0",
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/119.0.0.0 Safari/537.36",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Wget/1.21"
  ];
  for (const ua of bots) assert.equal(classify({ headers: { "user-agent": ua } }), "bot", ua);
});

test("classify: 평범한 모바일/데스크톱 브라우저 UA는 observed", () => {
  const real = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
  ];
  for (const ua of real) assert.equal(classify({ headers: { "user-agent": ua } }), "observed", ua);
  assert.equal(classify({ headers: {} }), "observed", "UA가 아예 없어도 internal/bot이 아니면 observed");
});

test("isBotUserAgent: 원시 문자열이 아니면 false (분류 결과만 쓴다는 원칙 회귀 고정)", () => {
  assert.equal(isBotUserAgent(null), false);
  assert.equal(isBotUserAgent(undefined), false);
  assert.equal(isBotUserAgent(123), false);
  assert.equal(isBotUserAgent(""), false);
});

test("QUALIFYING_SIGNAL_TYPES: 클릭 게이트가 있는 것만 — dwell·complete·skip 제외", () => {
  const set = new Set(QUALIFYING_SIGNAL_TYPES);
  assert.deepEqual([...set].sort(), ["comment", "open", "rate", "save", "survey"]);
  assert.ok(!set.has("dwell"), "dwell은 몰입 모드 자동 발화와 서버에서 구분 불가라 제외");
  assert.ok(!set.has("complete"), "complete도 같은 이유로 제외");
  assert.ok(!set.has("skip"), "skip은 스크롤 자동 발화");
});

// ── UA 파싱 (기기·OS·브라우저 enum) ──────────────────────────────────────────

test("parseUserAgent: 카카오톡·네이버 인앱은 Chrome UA를 포함해도 각각 분류된다", () => {
  const kakao = "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Version/4.0 Chrome/120.0 Mobile Safari/537.36 KAKAOTALK 10.9.5";
  assert.equal(parseUserAgent(kakao).browser, "kakao_webview");

  const naver = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0 Mobile Safari/537.36 NAVER(inapp; search; 1200; 12.1.0)";
  assert.equal(parseUserAgent(naver).browser, "naver_webview");
});

test("parseUserAgent: 삼성 인터넷·엣지가 chrome으로 뭉치지 않는다", () => {
  const samsung = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36";
  assert.equal(parseUserAgent(samsung).browser, "samsung");

  const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
  assert.equal(parseUserAgent(edge).browser, "edge");
});

test("parseUserAgent: 일반 크롬·사파리·기기·OS 판정", () => {
  const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  assert.deepEqual(parseUserAgent(chromeWin), { device: "desktop", os: "Windows", browser: "chrome" });

  const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  assert.deepEqual(parseUserAgent(safariMac), { device: "desktop", os: "macOS", browser: "safari" });

  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const p = parseUserAgent(iphone);
  assert.equal(p.device, "mobile");
  assert.equal(p.os, "iOS");

  const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.equal(parseUserAgent(ipad).device, "tablet");
});

test("parseUserAgent: 원시 UA가 없으면 unknown/other로 접힌다 (저장은 enum뿐)", () => {
  assert.deepEqual(parseUserAgent(null), { device: "unknown", os: "other", browser: "other" });
  assert.deepEqual(parseUserAgent(""), { device: "unknown", os: "other", browser: "other" });
});

test("bumpDeviceInfo: bucket에 enum 카운트만 남고 원시 UA는 어디에도 안 남는다", () => {
  const b = emptyBucket();
  bumpDeviceInfo(b, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
  bumpDeviceInfo(b, "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36");
  assert.equal(b.device.mobile, 1);
  assert.equal(b.device.desktop, 1);
  assert.equal(JSON.stringify(b).includes("Mozilla"), false, "원시 UA 문자열이 버킷에 남으면 안 된다");
});

// ── store.markHumanDay ──────────────────────────────────────────────────────

test("markHumanDay: humanUids에 중복 없이 쌓이고 hoursHuman은 호출마다(사람 활동 시간대) 늘어난다", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.createUser("u1");
  store.markHumanDay("u1");
  store.markHumanDay("u1"); // 같은 사람이 두 번 qualifying — 사람 수는 그대로
  store.markHumanDay("u1");
  const day = Object.keys(store.traffic).sort().at(-1);
  assert.equal(store.traffic[day].humanUids.length, 1, "같은 uid 중복 없음");
  assert.equal(store.traffic[day].hoursHuman[9], 3, "hoursHuman은 활동 건수 — 호출마다 는다");
  const [row] = store.trafficStats(1);
  assert.equal(row.human, 1);
});

test("markHumanDay: userId 없으면 아무것도 안 한다", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.markHumanDay(null);
  store.markHumanDay(undefined);
  assert.deepEqual(store.traffic || {}, {});
});

test("recordTrafficHour: traffic[day].hours[24]에 KST 시각으로 쌓인다 (hoursHuman과 짝인 전체 축)", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.recordTrafficHour();
  store.recordTrafficHour();
  const day = Object.keys(store.traffic).sort().at(-1);
  assert.equal(store.traffic[day].hours[9], 2);
});

test("trafficStats: human 필드 — humanUids가 없는(도입 이전) 과거 날짜는 engaged로 소급 폴백한다", () => {
  const store = new FeedStore({ clock: fixedClock });
  const su = store.createUser("legacy1");
  store.recordTraffic("feed", su.id);
  store.recordSignal(su.id, "itemX", "open"); // engaged 조건 충족
  const day = Object.keys(store.traffic).sort().at(-1);
  delete store.traffic[day].humanUids; // 이 필드가 아직 없던 과거 버킷 흉내
  const [row] = store.trafficStats(1);
  assert.equal(row.human, row.engaged, "humanUids 없으면 engaged로 폴백 — 이행기 명시");

  // humanUids가 있으면(설령 빈 배열이라도) 그대로 쓴다 — 0명이 "미계측"이 아니다
  store.traffic[day].humanUids = [];
  const [row2] = store.trafficStats(1);
  assert.equal(row2.human, 0, "humanUids 필드가 존재하면 빈 배열도 실측 0으로 쓴다");
});

// ── traffic 90일 prune → trafficArchive 400일 롤업 (REVISE #5) ─────────────

test("_pruneTraffic: 90일 초과분을 지우기 전에 {date,visitors,humanCount,pv} 스칼라로 아카이브에 접는다", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.traffic = {};
  const base = new Date("2026-01-01T00:00:00Z");
  const someHours = new Array(24).fill(0); someHours[9] = 3;
  for (let i = 0; i < 95; i++) {
    const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    store.traffic[d] = {
      pv: i + 1, feed: 0, uids: ["u1", "u2"], humanUids: i % 2 === 0 ? ["u1"] : [],
      hours: i === 0 ? someHours : undefined
    };
  }
  store._pruneTraffic();
  assert.equal(Object.keys(store.traffic).length, 90, "90일만 남는다");
  const archived = Object.keys(store.trafficArchive).sort();
  assert.equal(archived.length, 5, "잘려나간 5일이 아카이브에 남는다");
  const first = store.trafficArchive[archived[0]];
  // 시간대도 함께 접힌다(검수 라운드2 — 장기 시간대 추세는 소급 불가).
  assert.deepEqual(first, {
    date: archived[0], visitors: 2, humanCount: 1, pv: 1,
    hours: someHours, hoursHuman: null
  });
  assert.equal(store.trafficArchive[archived[1]].hours, null, "시간대 없던 날은 null로 정직하게");
});

test("_pruneTraffic: 아카이브 자체도 400일을 넘지 않는다", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.traffic = {};
  store.trafficArchive = {};
  const base = new Date("2020-01-01T00:00:00Z");
  for (let i = 0; i < 500; i++) {
    const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    store.trafficArchive[d] = { date: d, visitors: 1, humanCount: 0, pv: 1 };
  }
  for (let i = 0; i < 91; i++) {
    const d = new Date(base.getTime() + (500 + i) * 86400000).toISOString().slice(0, 10);
    store.traffic[d] = { pv: 1, feed: 0, uids: [] };
  }
  store._pruneTraffic();
  assert.ok(Object.keys(store.trafficArchive).length <= 400, "아카이브도 무한히 자라지 않는다");
});

test("트래픽 카운터 재시작(직렬화 왕복) 후에도 trafficArchive가 유지된다", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fsm = await import("node:fs");
  const f = path.join(os.tmpdir(), `traffic-archive-persist-${process.pid}.json`);
  try {
    const a = new FeedStore({ file: f, clock: fixedClock });
    a.traffic = {};
    const base = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 95; i++) {
      const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
      a.traffic[d] = { pv: 1, feed: 0, uids: ["u1"], humanUids: ["u1"] };
    }
    a._pruneTraffic();
    a._persist(); // 테스트에서 직접 버킷을 조작했으니 디바운스를 기다리지 않고 바로 쓴다
    const b = new FeedStore({ file: f, clock: fixedClock });
    assert.equal(Object.keys(b.trafficArchive).length, 5);
  } finally { try { (await import("node:fs")).unlinkSync(f); } catch {} }
});

// ── analytics uids 60일 초과 롤업 (REVISE #5) ───────────────────────────────

test("_rollupOldAnalyticsUids: 60일 초과 버킷의 uids/newUids를 개수로만 접는다", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.analytics = {};
  const base = new Date("2026-01-01T00:00:00Z");
  for (let i = 0; i < 65; i++) {
    const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    const b = emptyBucket();
    b.uids = ["a", "b", "c"];
    b.newUids = ["c"];
    store.analytics[d] = b;
  }
  store._rollupOldAnalyticsUids(60);
  const keys = Object.keys(store.analytics).sort();
  const oldDay = store.analytics[keys[0]];
  const recentDay = store.analytics[keys.at(-1)];
  assert.equal(oldDay.uidCount, 3, "60일 초과분은 개수로 접힌다");
  assert.deepEqual(oldDay.uids, [], "리스트는 비운다 — 핫 파일 비대 방지가 목적");
  assert.equal(oldDay.newUidCount, 1);
  assert.equal(recentDay.uidCount, undefined, "최근 60일 창은 그대로 리스트를 보존한다");
  assert.deepEqual(recentDay.uids, ["a", "b", "c"]);
});

test("mergeBuckets: uidCount로 접힌 과거 버킷과 uids 리스트인 최근 버킷을 함께 더하면 근사 합산된다", () => {
  const old = emptyBucket(); old.uidCount = 5; old.newUidCount = 2; old.pv = 10;
  const recent = emptyBucket(); recent.uids = ["x", "y"]; recent.newUids = ["y"]; recent.pv = 4;
  const m = mergeBuckets([old, recent]);
  assert.equal(m.uidCount, 5);
  assert.equal(m.newUidCount, 2);
  assert.equal(m.uids.length, 2);
  assert.equal(m.pv, 14);
});

// ── mergeBuckets 구/신 버킷 혼합 — 신규 필드가 조용히 버려지지 않는다 (REVISE #5) ──

test("mergeBuckets: device/os/browser 필드가 없는 구버킷과 있는 신버킷을 섞어도 신버킷 값이 소실되지 않는다", () => {
  const legacy = emptyBucket();
  delete legacy.device; delete legacy.os; delete legacy.browser; // 구버킷 흉내 (필드 자체가 없던 시절)
  legacy.pv = 3;

  const fresh = emptyBucket();
  fresh.pv = 2;
  bumpDeviceInfo(fresh, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
  bumpDeviceInfo(fresh, "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36");

  const merged = mergeBuckets([legacy, fresh]);
  assert.equal(merged.pv, 5, "합산 자체는 정상");
  assert.equal(merged.device.mobile, 1, "신버킷의 device 값이 구버킷과 섞여도 사라지면 안 된다");
  assert.equal(merged.device.desktop, 1);
  assert.equal(merged.os.iOS, 1);
  assert.equal(merged.browser.safari, 1);
});

// ── HTTP: qualifying 신호 → markHumanDay 배선 ───────────────────────────────

async function withEngineServer(fn) {
  const source = {
    id: "clien", kind: "community",
    async fetch() {
      return [{ id: "hitem1", title: "화제글 하나", url: "https://x/1", source: "clien",
                category: "news", score: 80, commentCount: 12, tags: [] }];
    }
  };
  const server = createServer({ sources: [source] });
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://localhost:${server.address().port}`); }
  finally { server.close(); }
}

test("HTTP /api/save: 저장 버튼 클릭은 qualifying 신호 — 그날 사람으로 마킹된다", async () => {
  await withEngineServer(async (base) => {
    const s = await (await jsonPost(base, "/api/session", {})).json();
    const r = await jsonPost(base, "/api/save", { userId: s.userId, itemId: "any-item", on: true },
      { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" });
    assert.equal(r.status, 200);
    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    const today = admin.days.at(-1);
    assert.ok(today && today.human >= 1, `사람으로 안 잡혔다: ${JSON.stringify(today)}`);
  });
});

test("HTTP /api/save: 봇 UA는 저장 버튼을 눌러도 사람으로 안 잡힌다 (UA 관문이 먼저)", async () => {
  await withEngineServer(async (base) => {
    const s = await (await jsonPost(base, "/api/session", {})).json();
    const r = await jsonPost(base, "/api/save", { userId: s.userId, itemId: "any-item", on: true },
      { "user-agent": "python-requests/2.31.0" });
    assert.equal(r.status, 200, "저장 자체는 성공한다");
    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    const today = admin.days.at(-1);
    assert.equal(today ? (today.human || 0) : 0, 0, "봇 UA는 human에 안 잡혀야 한다");
  });
});

test("HTTP /api/signal: type=open만 사람으로 잡고, skip/dwell/complete는 안 잡는다", async () => {
  await withEngineServer(async (base) => {
    const s = await (await jsonPost(base, "/api/session", {})).json();
    const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" };

    for (const type of ["skip", "dwell", "complete"]) {
      await jsonPost(base, "/api/signal", { userId: s.userId, itemId: "hitem1", type }, ua);
    }
    let admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    assert.equal((admin.days.at(-1) || {}).human || 0, 0, "skip/dwell/complete만으로는 사람이 아니다");

    await jsonPost(base, "/api/signal", { userId: s.userId, itemId: "hitem1", type: "open" }, ua);
    admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    assert.ok((admin.days.at(-1) || {}).human >= 1, "open은 qualifying이라 사람으로 잡힌다");
  });
});

test("HTTP /api/rate·/api/comment: 평가·댓글도 qualifying — 사람으로 잡힌다", async () => {
  await withEngineServer(async (base) => {
    const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" };
    const s1 = await (await jsonPost(base, "/api/session", {})).json();
    const rr = await jsonPost(base, "/api/rate", { userId: s1.userId, itemId: "hitem1", signal: 1 }, ua);
    assert.equal(rr.status, 200);

    const s2 = await (await jsonPost(base, "/api/session", {})).json();
    const cr = await jsonPost(base, "/api/comment", { userId: s2.userId, itemId: "hitem1", body: "좋은 글이네요 감사합니다" }, ua);
    assert.equal(cr.status, 200);

    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    assert.ok((admin.days.at(-1) || {}).human >= 2, `평가+댓글 두 사람이 잡혀야 한다: ${JSON.stringify(admin.days.at(-1))}`);
  });
});

// ── 가짜 사람 구멍 — /api/survey·/api/history (REVISE #3) ──────────────────

test("HTTP /api/survey: 이미 존재하는(세션으로 만든) 계정의 설문 제출은 사람으로 잡힌다", async () => {
  await withEngineServer(async (base) => {
    const s = await (await jsonPost(base, "/api/session", {})).json();
    const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" };
    const r = await jsonPost(base, "/api/survey", { userId: s.userId, answers: { categories: ["auto"] } }, ua);
    assert.equal(r.status, 200);
    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    assert.ok((admin.days.at(-1) || {}).human >= 1);
  });
});

test("HTTP /api/survey·/api/history: 무인증으로 지어낸(한 번도 존재한 적 없는) uid는 거부되고 사람으로도 안 잡힌다", async () => {
  await withEngineServer(async (base) => {
    const fakeId = "user_" + Math.random().toString(36).slice(2, 20);
    const r1 = await jsonPost(base, "/api/survey", { userId: fakeId, answers: { categories: ["auto"] } });
    assert.equal(r1.status, 400, "존재한 적 없는 uid는 설문도 거부된다 — denied()가 이미 막는다");
    const r2 = await jsonPost(base, "/api/history", { userId: fakeId, entries: [] });
    assert.equal(r2.status, 400);
    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    const today = admin.days.at(-1);
    assert.equal(today ? (today.human || 0) : 0, 0, "지어낸 uid가 사람으로 잡히면 안 된다");
  });
});

test("HTTP /api/survey·/api/history: IP 분당 상한이 걸린다 (adSignalAllowed 골격 재사용)", async () => {
  await withEngineServer(async (base) => {
    const sessions = [];
    for (let i = 0; i < 25; i++) sessions.push((await (await jsonPost(base, "/api/session", {})).json()).userId);
    const results = [];
    for (const uid of sessions) {
      const r = await jsonPost(base, "/api/history", { userId: uid, entries: [] });
      results.push(r.status);
    }
    assert.ok(results.includes(429), `25건 연속인데 429가 한 번도 없다: ${results.join(",")}`);
  });
});

test("HTTP /api/track: IP 분당 상한이 걸린다", async () => {
  await withEngineServer(async (base) => {
    const results = [];
    for (let i = 0; i < 125; i++) {
      const r = await jsonPost(base, "/api/track", { events: [{ type: "click", source: "x" }] });
      results.push(r.status);
    }
    assert.ok(results.includes(429), "행동 이벤트 배치도 무한정 받으면 안 된다");
  });
});

// ── HTTP: 발행 페이지도 hours/device를 센다 (view+entry가 traffic/analytics를 함께 채운다) ──

test("HTTP /api/track: view+entry 이벤트가 traffic.hours와 analytics.device를 함께 채운다 (발행 페이지도 동일 경로)", async () => {
  await withEngineServer(async (base) => {
    const r = await jsonPost(base, "/api/track",
      { events: [{ type: "view", path: "/briefing", entry: true, referrer: "" }] },
      { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" });
    assert.equal(r.status, 204);
    const admin = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "admin-dev" } }).then((x) => x.json());
    const today = admin.days.at(-1);
    assert.ok(today, "오늘 트래픽 행이 있어야 한다");
  });
});
