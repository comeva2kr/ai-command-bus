// 서비스워커 캐시 정책 — 2026-08-02 적대적 검수 P0 회귀 방지.
//
// sw.js는 브라우저에서만 도는 파일이라 테스트가 없었고, 그 사이에 오리진 가드가
// 없는 cache-first 분기가 광고 SDK까지 영구 고정하고 있었다. 여기서는 sw.js를
// 최소 워커 환경에 실제로 로드해 fetch 핸들러를 **호출**한다 — 정규식으로 소스를
// 훑는 방식은 "코드가 이렇게 생겼다"만 보증하고 동작은 보증하지 못한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SW = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "sw.js");
const ORIGIN = "https://nowhot.kr";

// sw.js를 로드하고 등록된 리스너와 캐시 스파이를 돌려준다.
function loadWorker() {
  const listeners = new Map();
  const puts = [];
  const cache = {
    addAll: async () => {},
    put: async (req, resp) => { puts.push({ url: typeof req === "string" ? req : req.url, status: resp.status }); },
    keys: async () => []
  };
  const caches = {
    open: async () => cache,
    match: async () => undefined, // 캐시 미스 → 네트워크 경로를 타게 한다
    keys: async () => [],
    delete: async () => true
  };
  const fetched = [];
  const sandbox = {
    self: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [] },
      registration: { showNotification: () => {} }
    },
    caches,
    fetch: async (req) => {
      const url = typeof req === "string" ? req : req.url;
      fetched.push(url);
      return { ok: true, status: 200, clone: () => ({ ok: true, status: 200 }) };
    },
    URL,
    Response,
    Promise,
    console
  };
  sandbox.addEventListener = sandbox.self.addEventListener;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW, "utf8"), sandbox);
  return { listeners, puts, fetched, sandbox };
}

// respondWith가 불렸는지 기록하는 가짜 fetch 이벤트
function fetchEvent(url, { mode = "no-cors", method = "GET" } = {}) {
  const ev = { request: { url, method, mode }, responded: null };
  ev.respondWith = (p) => { ev.responded = p; };
  return ev;
}

test("서비스워커: 교차 출처 요청은 가로채지 않는다 (광고 SDK 영구 고정 P0)", async () => {
  const { listeners } = loadWorker();
  const onFetch = listeners.get("fetch");
  assert.ok(onFetch, "fetch 리스너가 등록되어야 한다");

  // 실측으로 캐시에 박혀 있던 실제 URL들 — 하나라도 respondWith를 타면 회귀다
  const crossOrigin = [
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9799388228968567",
    "https://ep1.adtrafficquality.google/pagead/sodar?id=sodar2&v=255",
    "https://serv.ds.kakao.com/sdk/banner?id=DAN-ay04FFmKGxgYuWeQ",
    "https://img.yna.co.kr/photo/thumb.jpg",
    "https://fonts.gstatic.com/s/archivo/v19/x.woff2"
  ];
  for (const url of crossOrigin) {
    const ev = fetchEvent(url);
    onFetch(ev);
    assert.equal(ev.responded, null, `교차 출처를 가로챘다: ${url}`);
  }
});

test("서비스워커: 자기 출처 정적 자산은 계속 캐시한다 (오프라인 실행 유지)", async () => {
  const { listeners, puts } = loadWorker();
  const onFetch = listeners.get("fetch");
  const ev = fetchEvent(`${ORIGIN}/icon.svg`);
  onFetch(ev);
  assert.ok(ev.responded, "자기 출처 자산은 서비스워커가 처리해야 한다");
  await ev.responded;
  assert.deepEqual(puts.map((p) => p.url), [`${ORIGIN}/icon.svg`], "캐시에 담겨야 한다");
});

test("서비스워커: 실패 응답(404/5xx)은 캐시하지 않는다", async () => {
  const { listeners, puts, sandbox } = loadWorker();
  sandbox.fetch = async () => ({ ok: false, status: 404, clone: () => ({ ok: false, status: 404 }) });
  const ev = fetchEvent(`${ORIGIN}/app.abc123.js`);
  listeners.get("fetch")(ev);
  await ev.responded;
  assert.deepEqual(puts, [], "404가 캐시에 박히면 다음 CACHE 인상까지 그 사용자에게 영구 404다");
});

test("서비스워커: /api/*와 비GET은 손대지 않는다 (개인화 응답 캐시 금지)", () => {
  const { listeners } = loadWorker();
  const onFetch = listeners.get("fetch");
  for (const ev of [
    fetchEvent(`${ORIGIN}/api/feed?userId=x`),
    fetchEvent(`${ORIGIN}/api/save`, { method: "POST" })
  ]) {
    onFetch(ev);
    assert.equal(ev.responded, null);
  }
});

test("서비스워커: 문서 이동은 network-first 유지 (의도된 트레이드오프)", async () => {
  const { listeners, fetched } = loadWorker();
  const ev = fetchEvent(`${ORIGIN}/briefing`, { mode: "navigate" });
  listeners.get("fetch")(ev);
  assert.ok(ev.responded, "navigate는 서비스워커가 처리한다");
  await ev.responded;
  assert.deepEqual(fetched, [`${ORIGIN}/briefing`], "캐시보다 네트워크를 먼저 타야 한다");
});

test("서비스워커: 오프라인 오늘 주소를 실시간 셸로 바꾸지 않는다", async () => {
  const { listeners, sandbox, puts } = loadWorker();
  const live = new Response("live shell");
  sandbox.fetch = async () => { throw new TypeError("offline"); };
  sandbox.caches.match = async (request) => {
    const url = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
    return url === `${ORIGIN}/live` ? live : undefined;
  };
  for (const pathname of ["/", "/?date=2026-09-02", "/today.html"]) {
    const ev = fetchEvent(`${ORIGIN}${pathname}`, { mode: "navigate" });
    listeners.get("fetch")(ev);
    const response = await ev.responded;
    assert.equal(response.status, 503, pathname);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /서버에 연결할 수 없습니다/);
  }
  const ev = fetchEvent(`${ORIGIN}/live?tab=hot`, { mode: "navigate" });
  listeners.get("fetch")(ev);
  assert.equal(await ev.responded, live, "실시간 경로에만 기존 실시간 셸을 허용한다");
  assert.deepEqual(puts, [], "연결 오류 화면은 캐시하지 않는다");

  const today = new Response("today shell");
  sandbox.caches.match = async () => today;
  const samePage = fetchEvent(`${ORIGIN}/`, { mode: "navigate" });
  listeners.get("fetch")(samePage);
  assert.equal(await samePage.responded, today, "요청한 주소의 캐시는 그대로 사용한다");
});

test("서비스워커: activate가 이전 버전 캐시를 비운다 (오염된 캐시 회수 경로)", async () => {
  const deleted = [];
  const listeners = new Map();
  const sandbox = {
    self: {
      addEventListener: (t, f) => listeners.set(t, f),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      registration: {}
    },
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => ["feed-shell-v42", "feed-shell-v41"],
      delete: async (k) => { deleted.push(k); return true; },
      match: async () => undefined
    },
    fetch: async () => ({ ok: true, status: 200, clone: () => ({}) }),
    URL, Promise, console
  };
  sandbox.addEventListener = sandbox.self.addEventListener;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW, "utf8"), sandbox);

  let waited;
  listeners.get("activate")({ waitUntil: (p) => { waited = p; } });
  await waited;
  // 광고·추적 117건이 박힌 구버전 캐시는 이 경로로만 회수된다 —
  // 그래서 sw.js 캐시 정책을 고칠 때는 CACHE 상수도 반드시 함께 올려야 한다.
  assert.deepEqual(deleted.sort(), ["feed-shell-v41", "feed-shell-v42"]);
});
