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
