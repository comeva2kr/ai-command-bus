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

test("내 발자취: 화면 상한 40개는 생존 필터 뒤에 자른다", async () => {
  // 2026-08-08 검수: 상한을 생존 필터 앞에 걸면 죽은 id가 상한을 잠식해
  // 복귀 사용자의 발자취가 통째로 비었다. mySpace는 후보를 여유 있게 주고,
  // 서버가 resolveItems 뒤에 40개로 자른다(server.js /api/me와 같은 순서).
  const { store, user, engine } = await setup(60);
  let served = 0;
  for (let i = 0; i < 4; i++) {
    const f = await engine.getFeed(user.id, { limit: 20 });
    served += f.items.length;
    if (!f.items.length) break;
  }
  const sp = store.mySpace(user.id);
  const recent = (await engine.resolveItems(user.id, sp.recentIds)).slice(0, 40);
  assert.equal(recent.length, Math.min(40, served), `서빙 ${served}건 → 발자취 ${recent.length}개`);
});

test("내 발자취: 죽은 열람 40건이 산 발자취를 가리지 않는다", async () => {
  // 검수 라운드2 P1 재현 — 이틀 비운 사용자의 최근 연 글 40건은 풀(48h)에서
  // 전부 내려가 있다. 구버전은 후보 40개가 전부 죽은 id라 발자취가 0행.
  const { store, user, engine } = await setup();
  for (let i = 0; i < 40; i++) store.recordSignal(user.id, "dead" + i, "open");
  const feed = await engine.getFeed(user.id, { limit: 6 });
  assert.equal(feed.items.length, 6);
  const sp = store.mySpace(user.id);
  const recent = (await engine.resolveItems(user.id, sp.recentIds)).slice(0, 40);
  assert.equal(recent.length, 6, "죽은 id가 상한을 잠식하지 않는다");
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

test("내 발자취: 실제로 연 글이 서빙만 된 글보다 앞에 온다", async () => {
  // 2026-08-08: seen(서빙된 전부)만 보여 주면 스크롤로 스쳐간 글이 "본 글"인
  // 척 섞인다. open 신호(상세를 실제로 연 글)를 앞에 세운다.
  const { store, user, engine } = await setup();
  const feed = await engine.getFeed(user.id, { limit: 6 });
  const openedId = feed.items[3].id;
  await engine.signal(user.id, openedId, { type: "open" });
  const sp = store.mySpace(user.id);
  assert.equal(sp.recentIds[0], openedId, "연 글이 맨 앞");
  assert.equal(sp.recentIds.length, 6, "서빙된 글도 뒤에 그대로 남는다");
  assert.equal(new Set(sp.recentIds).size, 6, "연 글이 중복으로 안 들어간다");
});

test("내 발자취: 같은 글을 다시 열면 맨 앞으로 온다", async () => {
  const { store, user, engine } = await setup();
  const feed = await engine.getFeed(user.id, { limit: 4 });
  await engine.signal(user.id, feed.items[0].id, { type: "open" });
  await engine.signal(user.id, feed.items[2].id, { type: "open" });
  await engine.signal(user.id, feed.items[0].id, { type: "open" });
  const sp = store.mySpace(user.id);
  assert.deepEqual(sp.recentIds.slice(0, 2), [feed.items[0].id, feed.items[2].id]);
});

test("연 글 목록은 100개까지만 쌓인다", () => {
  const store = new FeedStore();
  const user = store.createUser({});
  for (let i = 0; i < 130; i++) store.recordSignal(user.id, "o" + i, "open");
  const opened = store.getUser(user.id).opened;
  assert.equal(opened.length, 100);
  assert.equal(opened.at(-1), "o129", "가장 최근 것이 남는다");
});

test("seen 상한은 3,000이다", () => {
  const store = new FeedStore();
  const user = store.createUser({});
  store.markSeen(user.id, Array.from({ length: 3200 }, (_, i) => "x" + i));
  assert.equal(store.getUser(user.id).seen.length, 3000);
  // 가장 최근 것이 남아야 한다
  assert.equal(store.getUser(user.id).seen.at(-1), "x3199");
});
