import test from "node:test";
import assert from "node:assert/strict";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";

const clock = () => "2026-09-08T09:00:00+09:00";
const article = (id, extra = {}) => ({ id, title: "차세대 기술 연구 결과 공개", kind: "news",
  category: "tech", source: "science-news", tags: [], topics: [], length: 300,
  score: 0, commentCount: 0, coverage: 4, publishedAt: clock(), ...extra });
function setup(rows) {
  const store = new FeedStore({ clock }), user = store.createUser("learning-alerts");
  store.saveSurvey(user.id, { categories: ["tech", "auto"], avoid: ["gaming"] });
  const engine = new FeedEngine(store, []); engine._clock = clock;
  engine._cache = [...rows]; engine._items = async () => rows;
  return { store, user, engine,
    async train(extra, type, count) {
      for (let i = 0; i < count; i++) {
        const item = article(`training-${engine._cache.length}`, extra);
        engine._cache.push(item);
        if (type === "dislike") await engine.rate(user.id, item.id, -1);
        else assert.equal((await engine.signal(user.id, item.id, { type, dwellMs: 60000 })).ok, true);
      }
    },
    async ids() { return (await engine.digest(user.id, { alertsOnly: true, limit: 20 })).top.map(item => item.id); }
  };
}

test("NH152 actual reading signals refine push topic and source ranking without increasing delivery counts", async () => {
  for (const feature of ["tags", "source"]) {
    const preferred = feature === "tags" ? { tags: ["ai"] } : { source: "preferred-news" };
    const other = feature === "tags" ? { tags: ["hardware"] } : { source: "other-news" };
    const h = setup([article("learning-match", preferred), article("louder", { ...other, score: 1000 })]);
    assert.equal((await h.ids())[0], "louder", feature);
    await h.train(preferred, "open", 4);
    await h.train(preferred, "dwell", 4);
    await h.train(preferred, "complete", 12);
    assert.equal((await h.ids())[0], "learning-match", feature);
    assert.deepEqual(h.user.seen.filter(id => !id.startsWith("training-")), []);
    assert.deepEqual(h.user.pushDeliveryTimes || [], []);
  }
});

test("NH152 repeated topic dislikes stop push candidates while source learning demotes without hiding unrelated topics", async () => {
  for (const feature of ["tags", "source"]) {
    const disliked = feature === "tags" ? { tags: ["crypto"] } : { source: "disliked-news" };
    const h = setup([article("unwanted", { ...disliked, score: 1000 }),
      article("wanted", { tags: ["ai"] })]);
    await h.train(disliked, "dislike", 1);
    assert.ok((await h.ids()).includes("unwanted"), "one reaction is not a strong learned exclusion");
    await h.train(disliked, "dislike", 5);
    assert.deepEqual(await h.ids(), feature === "tags" ? ["wanted"] : ["wanted", "unwanted"], feature);
  }
});

test("NH152 learning keeps selected underlearned categories and style-mismatched major news, never excluded games", async () => {
  const h = setup([article("major-ai", { tags: ["ai"], length: 100 }),
    article("major-auto", { category: "auto", title: "전기차 충전 표준 공식 발표" }),
    article("game", { category: "gaming", title: "인공지능 신작 게임 공개", tags: ["ai"], score: 10000 })]);
  for (const tag of ["ai", "hardware", "security"]) await h.train({ tags: [tag] }, "complete", 10);
  h.user.preferences.prefs.longform = 2;
  assert.deepEqual((await h.ids()).sort(), ["major-ai", "major-auto"]);
  const before = JSON.stringify(h.user.preferences);
  h.store.recordPushDelivery(h.user.id, ["prior-notification"], clock());
  assert.equal(JSON.stringify(h.user.preferences), before, "sending without a click must not teach a dislike");
});
