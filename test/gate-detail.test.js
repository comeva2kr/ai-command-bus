import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

// 2026-08-07 전 구간 감사 P0:
//   "getItem(/api/item 상세)이 원 아이템 자체엔 정치·종교 토글도,
//    관리자 차단 소스도 걸지 않는다."
//
// 관련글(_relatedItems)에는 관문을 걸어 두고 **정작 본 아이템에는 안 걸었다.**
// 그래서 정치를 끈 사용자나 관리자가 차단한 소스의 글이 상세 직접 접근
// (공유 링크·검색 색인·예전에 열어본 기록·사이트맵)으로는 그대로 열렸다.
//
// 관문을 두 벌로 두면 한쪽이 반드시 샌다. 오늘만 이 유형을 세 번 만났다:
// 관련글 우회 → 공개 지면 religion 누락 → 상세 본체 무관문.

const mk = (id, topics = [], source = "s") => ({
  id, title: "글 " + id, url: "https://example.org/" + id,
  source, kind: "news", category: "news", tags: [], topics,
  score: 10, commentCount: 1, publishedAt: new Date().toISOString()
});

async function setup(items) {
  const store = new FeedStore();
  const user = store.createUser({});
  const engine = new FeedEngine(store, [{ id: "s", async fetch() { return items; } }]);
  await engine.refresh();
  return { store, user, engine };
}

test("상세: 정치를 끈 사용자에게는 정치 글이 열리지 않는다", async () => {
  const { user, engine } = await setup([mk("pol", ["politics"]), mk("ok")]);
  assert.equal(await engine.getItem(user.id, "pol"), null);
  assert.ok(await engine.getItem(user.id, "ok"));
});

test("상세: 정치를 켠 사용자에게는 열린다 — 차단이 아니라 사용자 설정이다", async () => {
  const { store, user, engine } = await setup([mk("pol", ["politics"])]);
  store.setTopicFilter(user.id, "politics", true);
  assert.ok(await engine.getItem(user.id, "pol"), "켰는데도 막히면 기능이 망가진 것이다");
});

test("상세: 종교도 같은 관문을 탄다 — politics만 하드코딩하면 샌다", async () => {
  const { user, engine } = await setup([mk("rel", ["religion"])]);
  assert.equal(await engine.getItem(user.id, "rel"), null);
});

test("상세: 관리자가 차단한 소스는 열리지 않는다", async () => {
  const { store, user, engine } = await setup([mk("x", [], "badsrc")]);
  // 차단 목록에 넣는 실제 경로가 있으면 그것을 쓴다
  if (typeof store.setSourceDisabled === "function") {
    store.setSourceDisabled("badsrc", true);
    assert.equal(await engine.getItem(user.id, "x"), null);
  } else {
    // 경로 이름이 다르면 disabledSources를 직접 덮어 계약만 확인한다
    store.disabledSources = () => new Set(["badsrc"]);
    assert.equal(await engine.getItem(user.id, "x"), null);
  }
});

test("공개 지면(랭킹·브리핑)도 기본 숨김 토픽을 전부 거른다", async () => {
  // 로그인 없이 보이고 sitemap에도 올라가는 페이지다.
  // 예전엔 politics만 하드코딩돼 religion이 그대로 색인됐다.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/feed/engine.js", "utf8"));
  const hard = src.match(/!\(i\.topics \|\| \[\]\)\.includes\("politics"\) &&\n\s+i\.kind !== "ad"/g) || [];
  assert.equal(hard.length, 0, `공개 지면에 politics 하드코딩이 ${hard.length}곳 남아 있다`);
  assert.ok(src.includes("topicsBlocked(i, EMPTY_TOPICS)"), "공통 관문을 쓰지 않는다");
});

test("딜 지분 보장이 뮤트를 우회하지 않는다", async () => {
  // 2026-08-07 감사 P1: dealPool을 this._items()(원본 전체)에서 가져와
  // 뮤트·관리자 차단·오프메인·토픽차단·신선도를 **전부 우회**했다.
  // 뮤트는 사용자가 직접 누른 의사표시다 — 그걸 딜 경로가 무시하면
  // 뮤트 기능 자체를 못 믿게 된다.
  const deal = (id, source) => ({
    id, title: "딜 " + id, url: "https://example.org/" + id, source,
    kind: "community", category: "life", tags: [], topics: [], isDeal: true,
    score: 50, commentCount: 2, publishedAt: new Date().toISOString()
  });
  const plain = (id, source) => ({ ...deal(id, source), isDeal: false });
  const items = [plain("a", "good"), plain("b", "good"), deal("d1", "muted"), deal("d2", "good")];
  const { store, user, engine } = await setup(items);
  store.setMute(user.id, "muted", true);
  const res = await engine.getFeed(user.id, { limit: 10 });
  const sources = (res.items || res).map((i) => i.source);
  assert.ok(!sources.includes("muted"), `뮤트한 소스가 딜 경로로 새어 나왔다: ${sources.join(",")}`);
});
