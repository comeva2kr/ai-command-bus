import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

// David 2026-08-07: "부동산 카테고리에서 누르니까 글이 몇개 안나와."
//
// 카테고리 필터가 **이미 그려진 카드를 숨기기만** 했다(card.style.display).
// 서버에 요청하지 않으니, 홈 20개 중 부동산이 2개면 2개만 보였다.
// 풀에는 부동산이 140건(24시간 내 122건) 있는데도.

function mk(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "i" + i, title: "글" + i, url: "https://example.org/" + i,
    source: "s" + (i % 4), kind: "news", tags: [], topics: [],
    category: i < 20 ? "realestate" : "tech",
    score: 100 - i, commentCount: 2, publishedAt: new Date().toISOString()
  }));
}

async function setup() {
  const items = mk(30);
  const store = new FeedStore();
  const user = store.createUser({});
  const engine = new FeedEngine(store, [{ id: "s", async fetch() { return items; } }]);
  await engine.refresh();
  return { store, user, engine };
}

test("카테고리를 지정하면 그 카테고리만 나온다", async () => {
  const { user, engine } = await setup();
  const res = await engine.getFeed(user.id, { limit: 20, category: "realestate" });
  const items = res.items || res;
  assert.ok(items.length >= 10, `${items.length}건 — 카테고리 요청인데 너무 적다`);
  assert.equal(items.filter((i) => i.category !== "realestate").length, 0);
});

test("카테고리를 안 주면 예전처럼 전체가 나온다", async () => {
  const { user, engine } = await setup();
  const res = await engine.getFeed(user.id, { limit: 20 });
  const items = res.items || res;
  assert.ok(items.length > 0);
});

test("모르는 카테고리는 빈 결과가 아니라 서버가 거른다 — 엔진은 값 그대로 쓴다", async () => {
  // 라우트가 isKnownCategory로 검증해 null로 접는다. 엔진까지 온 값은 신뢰한다.
  const { user, engine } = await setup();
  const res = await engine.getFeed(user.id, { limit: 20, category: "없는카테고리" });
  const items = res.items || res;
  assert.equal(items.length, 0, "엔진은 주어진 값으로 거른다");
});
