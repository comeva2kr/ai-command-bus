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

test("본 글은 피드에 다시 나오지 않는다 — seen 상한이 그 보장의 길이다", async () => {
  // David 2026-08-07: "본 걸 굳이 또 볼 필욘 없으니까"
  //
  // 피드는 seen을 후보에서 빼므로(base 필터) 상한이 곧 보장의 길이다.
  // 500이던 때 실측: 821명 중 17명이 도달했고, 잘려나간 만큼 예전에 본 글이
  // 다시 후보로 돌아왔다. 3,000으로 올렸다(id당 약 10바이트, 사용자당 30KB).
  //
  // 곁들여 기록: "빼지 말고 뒤로 밀자"도 구현해 봤으나 되돌렸다.
  // base의 순서를 바꿔도 하류(hotScore·selectDiverse)가 다시 정렬해 지워진다 —
  // 검증에서 본 글이 그대로 0·1·2번 자리에 나왔다. 순서가 아니라 점수에
  // 손대야 하는데 그건 여러 경로를 건드려야 해서, 상한을 올리는 쪽이 맞다.
  const { store, user, engine } = await setup(12);
  const a = await engine.getFeed(user.id, { limit: 4 });
  const seenIds = (a.items || a).map((x) => x.id);
  const b = await engine.getFeed(user.id, { limit: 12 });
  const nextIds = (b.items || b).map((x) => x.id);
  for (const id of seenIds) {
    assert.ok(!nextIds.includes(id), `본 글이 다시 나왔다: ${id}`);
  }
});

test("seen 상한은 3,000이다", () => {
  const store = new FeedStore();
  const user = store.createUser({});
  store.markSeen(user.id, Array.from({ length: 3200 }, (_, i) => "x" + i));
  assert.equal(store.getUser(user.id).seen.length, 3000);
  // 가장 최근 것이 남아야 한다
  assert.equal(store.getUser(user.id).seen.at(-1), "x3199");
});
