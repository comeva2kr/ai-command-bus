import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

// David 2026-08-07: "본 걸 다시 찾고 싶을 수 있으니까 내 공간에 가면
// 내 발자취 란에서 방금 전에 본 피드 몇십 개 정도 확인 가능하게 하자."
//
// 피드는 본 글을 후보에서 빼기 때문에(unseen), 다시 찾을 길이 없었다.
// seen을 최근순으로 뒤집어 돌려준다.

function mkItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "i" + i, title: "글 " + i, url: "https://example.org/" + i,
    source: "s" + (i % 3), kind: "community", tags: [], topics: [],
    score: 200 - i * 10, commentCount: 5, publishedAt: new Date().toISOString()
  }));
}

async function setup(n = 12) {
  const items = mkItems(n);
  const store = new FeedStore();
  const user = store.createUser({});
  const engine = new FeedEngine(store, [{ id: "s", async fetch() { return items; } }]);
  await engine.refresh();
  return { store, user, engine };
}

test("내 발자취: 본 글이 최근순으로 남는다", async () => {
  const { store, user, engine } = await setup();
  await engine.getFeed(user.id, { limit: 6 });
  const sp = store.mySpace(user.id);
  assert.equal(sp.recentIds.length, 6);
  // seen은 오래된 것이 앞 → 뒤집어 최근이 먼저
  const resolved = await engine.resolveItems(user.id, sp.recentIds);
  assert.equal(resolved.length, 6);
  assert.equal(resolved[0].id, sp.recentIds[0]);
});

test("내 발자취: 40개까지만 준다 — 내 공간이 무한정 길어지지 않게", async () => {
  const { store, user, engine } = await setup(60);
  await engine.getFeed(user.id, { limit: 60 });
  const sp = store.mySpace(user.id);
  assert.ok(sp.recentIds.length <= 40, `${sp.recentIds.length}개`);
});

test("내 발자취: 아무것도 안 봤으면 빈 목록", async () => {
  const { store, user } = await setup();
  const sp = store.mySpace(user.id);
  assert.deepEqual(sp.recentIds, []);
});

test("내 발자취: 풀에서 내려간 글은 조용히 빠진다 — 없는 것을 있는 척하지 않는다", async () => {
  const { store, user, engine } = await setup();
  await engine.getFeed(user.id, { limit: 4 });
  const sp = store.mySpace(user.id);
  const withGhost = ["없는id_1", ...sp.recentIds];
  const resolved = await engine.resolveItems(user.id, withGhost);
  assert.equal(resolved.length, sp.recentIds.length);
  assert.ok(!resolved.some((r) => r.id === "없는id_1"));
});
