import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

// 새로고침 앵커 연속성 (David 2026-08-08 승인)
// "완전 랜덤으로 바뀌면 이게 맞게 나오는 거 맞나 싶잖아 — 알고리즘의
// 연속성이 느껴져야." 새로고침(cursor=0)은 서빙 즉시 seen을 소비해 사실상
// "다음 페이지"였다. 직전 첫 화면의 상위 앵커(≤3)를 15분 창 안에서 머리에
// 유지하고, 나머지 칸만 새 글로 채운다. 창은 앵커가 처음 잡힌 시각
// 기준이라 연속 새로고침으로 늘어나지 않는다.

function mkItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "i" + i, title: "글 " + i, url: "https://example.org/" + i,
    source: "s" + (i % 3), kind: "community", tags: [], topics: [],
    score: 200 - i * 5, commentCount: 5, publishedAt: new Date().toISOString()
  }));
}

async function setup(n = 30) {
  const items = mkItems(n);
  const store = new FeedStore();
  const user = store.createUser({});
  const engine = new FeedEngine(store, [{ id: "s", async fetch() { return items; } }]);
  await engine.refresh();
  return { store, user, engine };
}

test("새로고침하면 직전 상위 앵커가 머리에 그대로 있다", async () => {
  const { user, engine } = await setup();
  const a = await engine.getFeed(user.id, { limit: 10 });
  const top3 = a.items.slice(0, 3).map((x) => x.id);
  const b = await engine.getFeed(user.id, { limit: 10 });
  assert.deepEqual(b.items.slice(0, 3).map((x) => x.id), top3, "아까 1위가 아직 1위");
  assert.equal(b.items.length, 10, "페이지 길이 보존");
  // 앵커 밖은 전부 새 글
  const aIds = new Set(a.items.map((x) => x.id));
  for (const it of b.items.slice(3)) assert.ok(!aIds.has(it.id), `앵커 밖 재노출: ${it.id}`);
});

test("연속 새로고침에도 앵커가 유지된다 — 그리고 창은 처음 잡힌 시각 기준", async () => {
  const { store, user, engine } = await setup(40);
  const a = await engine.getFeed(user.id, { limit: 10 });
  const top3 = a.items.slice(0, 3).map((x) => x.id);
  const at0 = store.getUser(user.id).homeAnchors.at;
  for (let i = 0; i < 3; i++) {
    const f = await engine.getFeed(user.id, { limit: 10 });
    assert.deepEqual(f.items.slice(0, 3).map((x) => x.id), top3, `연쇄 ${i + 1}번째`);
  }
  assert.equal(store.getUser(user.id).homeAnchors.at, at0,
    "같은 앵커가 유지되는 동안 처음 잡힌 시각이 갱신되지 않는다(TTL 영구화 방지)");
});

test("창(15분)이 지나면 앵커를 접고 새 목록을 준다", async () => {
  const { store, user, engine } = await setup();
  const a = await engine.getFeed(user.id, { limit: 10 });
  const aIds = new Set(a.items.map((x) => x.id));
  // 앵커가 16분 전에 잡힌 것으로 되돌린다
  const u = store.getUser(user.id);
  u.homeAnchors.at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const b = await engine.getFeed(user.id, { limit: 10 });
  for (const it of b.items) assert.ok(!aIds.has(it.id), `만료된 앵커가 남았다: ${it.id}`);
});

test("앵커 소스를 뮤트하면 앵커도 사라진다 — 관문은 한 벌", async () => {
  const { store, user, engine } = await setup();
  const a = await engine.getFeed(user.id, { limit: 10 });
  const anchorSrc = a.items[0].source;
  store.getUser(user.id).mutedSources = [anchorSrc];
  const b = await engine.getFeed(user.id, { limit: 10 });
  for (const it of b.items) {
    assert.ok(it.source !== anchorSrc, `뮤트한 소스가 앵커로 살아남았다: ${it.id}`);
  }
});

test("카테고리·소스 보기와 다음 페이지(cursor>0)에는 앵커가 없다", async () => {
  const { user, engine } = await setup(40);
  const a = await engine.getFeed(user.id, { limit: 10 });
  const aIds = new Set(a.items.map((x) => x.id));
  // 다음 페이지 — 본 글이 다시 오면 안 된다
  const p2 = await engine.getFeed(user.id, { limit: 10, cursor: a.nextCursor });
  for (const it of p2.items) assert.ok(!aIds.has(it.id), `다음 페이지에 앵커: ${it.id}`);
  // 소스 보기 — seen 필터가 없는 자체 문법이라 앵커 개입 없음(자기 순위 그대로)
  const s = await engine.getFeed(user.id, { limit: 10, source: "s0" });
  assert.ok(s.items.length > 0);
  assert.ok(s.items.every((it) => it.source === "s0"), "소스 보기는 그 소스만");
});

test("앵커 일부만 교체돼도(churn) 살아남은 앵커의 창이 리셋되지 않는다", async () => {
  // 검수 라운드4 — 목록 전체 일치로만 시각을 보존하면 10분마다 하나씩
  // 교체될 때 최초 1위가 60분 넘게 머리에 고정됐다(TTL 4배 초과).
  const { store, user, engine } = await setup();
  await engine.getFeed(user.id, { limit: 10 });
  const at0 = store.getUser(user.id).homeAnchors.at;
  const anchors = store.getUser(user.id).homeAnchors.ids;
  // 앵커 하나를 죽인다(그 소스만 뮤트) — 나머지 둘은 생존
  const deadSrc = anchors.length ? (await engine.resolveItems(user.id, [anchors[2]]))[0].source : null;
  store.getUser(user.id).mutedSources = [deadSrc];
  await engine.getFeed(user.id, { limit: 10 });
  assert.equal(store.getUser(user.id).homeAnchors.at, at0,
    "일부 교체는 겹침이 있으므로 처음 잡힌 시각을 유지한다");
});

test("limit이 아주 작아도 페이지가 limit를 넘지 않는다", async () => {
  const { user, engine } = await setup();
  await engine.getFeed(user.id, { limit: 10 });
  const b = await engine.getFeed(user.id, { limit: 2 });
  assert.ok(b.items.length <= 2, `limit=2인데 ${b.items.length}건`);
});

test("이전 앵커도 새 핫 페이지의 출처 상한에 포함된다", async () => {
  const store = new FeedStore();
  const user = store.createUser({});
  const engine = new FeedEngine(store);
  engine._cache = mkItems(40).map((item, i) => ({
    ...item, source: i < 3 ? "same" : `source-${i % 10}`, category: "tech"
  }));
  store.rememberHomeAnchors(user.id, ["i0", "i1", "i2"]);
  store.markSeen(user.id, ["i0", "i1", "i2"]);
  store.getUser(user.id).mixBalance = -1;
  const page = await engine.getFeed(user.id, { limit: 10 });
  assert.equal(page.items.length, 10);
  assert.equal(new Set(page.items.map(item => item.id)).size, 10);
  assert.equal(page.items.filter(item => item.source === "same").length, 2);
  assert.deepEqual(page.items.filter(item => item.source === "same").map(item => item.id), ["i0", "i1"]);
});

test("전부 본 뒤 재활용 폴백도 nextCursor로 페이지가 전진한다", async () => {
  // 검수 라운드4가 잡은 기존 결함 — 폴백 응답만 nextCursor가 없어 클라가
  // 같은 재활용 페이지를 무한 반복하며 같은 카드를 계속 쌓았다.
  const { store, user, engine } = await setup(12);
  store.markSeen(user.id, Array.from({ length: 12 }, (_, i) => "i" + i));
  const r1 = await engine.getFeed(user.id, { limit: 5 });
  assert.ok(r1.items.length, "폴백이 빈 화면 대신 재활용 페이지를 준다");
  assert.ok(Number.isFinite(r1.nextCursor), "폴백 응답에도 nextCursor가 있다");
  const r2 = await engine.getFeed(user.id, { limit: 5, cursor: r1.nextCursor });
  const ids1 = new Set(r1.items.map((x) => x.id));
  assert.ok(r2.items.length, "다음 페이지가 나온다");
  for (const it of r2.items) assert.ok(!ids1.has(it.id), `재활용 페이지가 반복됐다: ${it.id}`);
});

test("rememberHomeAnchors: 앵커가 바뀌면 창이 새로 열린다", () => {
  const store = new FeedStore();
  const user = store.createUser({});
  const first = store.rememberHomeAnchors(user.id, ["a", "b", "c"]);
  const same = store.rememberHomeAnchors(user.id, ["a", "b", "c"]);
  assert.equal(same.at, first.at, "같은 앵커면 시각 유지");
  const changed = store.rememberHomeAnchors(user.id, ["x", "b", "c"]);
  assert.deepEqual(changed.ids, ["x", "b", "c"]);
});
