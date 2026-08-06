// 계정 소유권 — 전수검사 P0 (2026-08-05)
//
// 라이브에서 재현한 것:
//   POST /api/session 세 번 → user_300, user_301, user_302  (순번이라 열거된다)
//   GET  /api/me?userId=user_10 → 남의 닉네임·글·댓글·평가·저장·차단 목록이 그대로
//   쓰기 라우트도 `store.getUser(body.userId)`만 확인한다 — "이 사용자가 존재하는가"이지
//   "당신이 그 사람인가"가 아니다. 즉 아무 이름으로나 글을 쓸 수 있었다.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/feed/server.js";

async function withServer(fn) {
  const source = { id: "clien", kind: "community", async fetch() { return []; } };
  const server = createServer({ sources: [source] });
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://localhost:${server.address().port}`); }
  finally { server.close(); }
}
// set-cookie 는 여러 줄로 온다 — 전부 합쳐 보낸다
function cookiesFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  return raw.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
}
const jsonPost = (base, path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });

test("계정: 새 사용자 ID는 순번이 아니다", async () => {
  await withServer(async (base) => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await (await jsonPost(base, "/api/session", {})).json()).userId);
    // user_1, user_2, user_3 처럼 1씩 늘면 전 사용자를 1부터 세어 얻을 수 있다
    const nums = ids.map((id) => Number(String(id).split("_")[1]));
    assert.ok(nums.some((n) => Number.isNaN(n)), `ID가 아직 순번이다: ${ids.join(", ")}`);
    assert.equal(new Set(ids).size, 3);
  });
});

test("계정: 기기가 묶인 뒤에는 남이 그 계정으로 쓸 수 없다", async () => {
  await withServer(async (base) => {
    // 주인이 정상 접속해 기기가 묶인다
    const res = await jsonPost(base, "/api/session", {});
    const me = await res.json();
    const cookie = cookiesFrom(res);
    assert.match(cookie, /nh_k=/, `계정 열쇠가 안 내려왔다: ${cookie}`);
    // 주인의 첫 요청으로 결속을 확정한다
    assert.equal((await jsonPost(base, "/api/topics", { userId: me.userId, topic: "politics", on: true }, cookie)).status, 200);

    // ── 공격자: 쿠키 없이 그 계정을 주장한다 (첫 판의 구멍이 여기였다)
    assert.equal((await jsonPost(base, "/api/topics", { userId: me.userId, topic: "politics", on: false })).status, 403);
    assert.equal((await jsonPost(base, "/api/comment", { userId: me.userId, itemId: "x", body: "사칭" })).status, 403);
    assert.equal((await fetch(`${base}/api/me?userId=${me.userId}`)).status, 403, "남의 내 공간이 열린다");

    // ── 공격자: 자기 기기 쿠키를 들고 남을 주장한다
    const other = await jsonPost(base, "/api/session", {});
    const otherCookie = cookiesFrom(other);
    assert.equal((await jsonPost(base, "/api/comment", { userId: me.userId, itemId: "x", body: "사칭" }, otherCookie)).status, 403);

    // ── 주인은 그대로 된다
    assert.equal((await jsonPost(base, "/api/topics", { userId: me.userId, topic: "religion", on: true }, cookie)).status, 200);
    assert.equal((await fetch(`${base}/api/me?userId=${me.userId}`, { headers: { cookie } })).status, 200);
  });
});

test("계정: 아직 주인이 없는 계정은 막지 않는다 — 배포 직후 기존 사용자", async () => {
  // 471명이 이미 쓰고 있다. 배포하자마자 전원을 막으면 서비스가 죽는다.
  // 아직 기기가 묶이지 않은 계정은 통과시키고, 그때 묶는다.
  const { FeedStore } = await import("../src/feed/store.js");
  const store = new FeedStore({});
  const u = store.createUser("legacy_user");
  assert.equal(store.bindDevice(u.id, null), true, "쿠키 없는 기존 사용자를 막으면 안 된다");
  assert.equal(store.bindDevice(u.id, "key-A"), true, "처음 온 기기가 주인이 된다");
  assert.equal(store.getUser(u.id).deviceKey, "key-A");
  assert.equal(store.bindDevice(u.id, "key-B"), false, "묶인 뒤에는 다른 기기를 거절한다");
  assert.equal(store.bindDevice(u.id, null), false, "쿠키를 빼면 통과하던 구멍이 막혔다");
});

test("아직 결속 안 된 계정을 남이 먼저 주장할 수 없다 (적대적 검수 2026-08-06 P0)", async () => {
  // 재현되던 것: 피해자가 아직 쓰기를 안 해 열쇠가 없는 동안, 공격자가
  // 피해자 userId로 글을 한 번 쓰면 **공격자 열쇠가 그 계정에 박히고**
  // 진짜 주인은 이후 영구 403이 됐다. 경쟁도 필요 없는 결정적 탈취였다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${server.address().port}`;
    const cookiesOf = (res) => (res.headers.getSetCookie?.() || [])
      .map((c) => c.split(";")[0]).join("; ");

    // 피해자: 세션만 받고 아직 아무것도 안 썼다 (열쇠 미결속)
    const vRes = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const victim = await vRes.json();
    const victimCookies = cookiesOf(vRes);

    // 공격자: 자기 세션(자기 쿠키·자기 열쇠)을 들고 피해자 id를 주장한다
    const aRes = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await aRes.json();
    const attackerCookies = cookiesOf(aRes);

    const forged = await fetch(`${base}/api/post`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: attackerCookies },
      body: JSON.stringify({ userId: victim.userId, title: "가로챈 글입니다", body: "남의 계정으로 씁니다" })
    });
    assert.equal(forged.status, 403, "남의 미결속 계정을 선점할 수 있다");

    // 진짜 주인은 그대로 쓸 수 있어야 한다 — 막는 것이 목적이 아니다
    const mine = await fetch(`${base}/api/post`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: victimCookies },
      body: JSON.stringify({ userId: victim.userId, title: "내 계정 내 글입니다", body: "정상 경로" })
    });
    assert.equal(mine.status, 200, "주인이 자기 계정에서 잠겼다");
  } finally { server.close(); }
});

test("쿠키를 못 쓰는 클라이언트는 여전히 글을 쓸 수 있다", async () => {
  // 첫 결속에 기기 쿠키를 요구하되, **열쇠가 아예 없는** 요청은 예전처럼
  // 통과시킨다. 안 그러면 인앱 브라우저에서 글쓰기가 통째로 막힌다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${server.address().port}`;
    const s = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const res = await fetch(`${base}/api/post`, {
      method: "POST",
      headers: { "content-type": "application/json" },   // 쿠키 없음
      body: JSON.stringify({ userId: s.userId, title: "쿠키 없는 기기에서 씁니다", body: "본문입니다" })
    });
    assert.equal(res.status, 200, "쿠키 못 쓰는 클라이언트가 잠겼다");
  } finally { server.close(); }
});

test("내부 userId가 공개 응답에 실리지 않는다", async () => {
  // 이것이 위 탈취의 재료였다 — 누구나 남의 계정 id를 수집할 수 있었다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${server.address().port}`;
    const s = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    await fetch(`${base}/api/post`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: s.userId, title: "공개 피드에 나갈 글입니다", body: "본문입니다" })
    });
    const feed = await (await fetch(`${base}/api/feed?userId=${s.userId}&limit=30`)).json();
    const mine = (feed.items || []).filter((i) => i.via === "me");
    assert.ok(mine.length > 0, "내 글이 피드에 안 보인다 — 검사가 무의미해진다");
    for (const it of mine) {
      assert.equal(it.userId, undefined, "내부 userId가 응답에 실렸다");
      assert.notEqual(it.author, s.userId, "author 자리에 내부 userId가 실렸다");
      assert.ok(!/^user_[0-9a-f]{6,}$/i.test(String(it.author || "")),
        "author가 내부 id 모양이다 — 수정 전에 저장된 글도 가려야 한다");
    }
  } finally { server.close(); }
});
