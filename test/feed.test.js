import test from "node:test";
import assert from "node:assert/strict";

import { buildPreferenceVector, validateAnswers, emptyPreferenceVector } from "../src/feed/survey.js";
import {
  scoreItem,
  rankItems,
  applyFeedback,
  specializationLevel,
  feedPhase
} from "../src/feed/recommender.js";
import { normalizeItem, SeedSource, collect } from "../src/feed/content.js";
import { inferFromHistory, mergeVectors } from "../src/feed/history.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { StorePostsSource } from "../src/feed/content.js";
import { loadRegistry, query, buildSources, summarize } from "../src/feed/registry.js";
import { TranslatingSource, memoizedTranslator } from "../src/feed/translate.js";

const fixedClock = () => "2026-07-06T00:00:00.000Z";

test("survey builds a preference vector from answers", () => {
  const vec = buildPreferenceVector({
    categories: ["auto", "humor"],
    tags: ["cars", "meme"],
    communities: ["bobae"],
    depth: "deep",
    avoid: ["politics"]
  });
  assert.ok(vec.categories.auto > 0);
  assert.ok(vec.categories.politics < 0, "avoided category is negative");
  assert.ok(vec.tags.cars > 0);
  assert.ok(vec.sources.bobae > 0);
  assert.equal(vec.prefs.longform, 1);
});

test("survey validation requires at least one category", () => {
  assert.equal(validateAnswers({ tags: ["cars"] }).ok, false);
  assert.equal(validateAnswers({ categories: ["auto"] }).ok, true);
  assert.equal(validateAnswers({ categories: ["auto"], depth: "nope" }).ok, false);
});

test("recommender ranks items matching the user's taste higher", () => {
  const vec = buildPreferenceVector({ categories: ["auto"], tags: ["cars", "testdrive"] });
  const carItem = normalizeItem({ category: "auto", tags: ["cars", "testdrive"], title: "시승기", score: 10 });
  const politicsItem = normalizeItem({ category: "politics", tags: ["policy"], title: "예산안", score: 10 });
  const ranked = rankItems([politicsItem, carItem], vec, { seed: 1 });
  assert.equal(ranked[0].item.id, carItem.id, "car item ranks first for a car lover");
});

test("liking an item raises the score of similar items", () => {
  const vec = emptyPreferenceVector();
  const carItem = normalizeItem({ category: "auto", tags: ["cars"], title: "신차", score: 0 });
  const before = scoreItem(carItem, vec, { seed: 1 });
  applyFeedback(vec, carItem, 1);
  const after = scoreItem(carItem, vec, { seed: 1 });
  assert.ok(after > before, "score increases after a like");
});

test("disliking pushes similar items down", () => {
  const vec = emptyPreferenceVector();
  const item = normalizeItem({ category: "politics", tags: ["policy"], title: "정치", score: 0 });
  const before = scoreItem(item, vec, { seed: 1 });
  applyFeedback(vec, item, -1);
  const after = scoreItem(item, vec, { seed: 1 });
  assert.ok(after < before, "score decreases after a dislike");
});

test("specialization level and phase rise with signal", () => {
  const empty = emptyPreferenceVector();
  assert.equal(feedPhase(specializationLevel(empty, 0)), "survey");

  const vec = buildPreferenceVector({
    categories: ["auto", "tech"],
    tags: ["cars", "testdrive", "ev", "hardware"],
    communities: ["bobae", "clien"]
  });
  const lvl = specializationLevel(vec, 15);
  assert.ok(lvl > 0.5, `expected a confident level, got ${lvl}`);
  assert.notEqual(feedPhase(lvl), "survey");
});

test("history inference maps hosts and titles to taste", () => {
  const { vector, hits } = inferFromHistory([
    "bobae.co.kr",
    "clien.net",
    "신형 그랜저 시승기 후기",
    "아이폰 신제품 루머"
  ]);
  assert.ok(vector.sources.bobae > 0, "bobae host recognized");
  assert.ok(vector.categories.auto > 0, "auto interest inferred");
  assert.ok(vector.tags.testdrive > 0 || vector.tags.cars > 0, "car tag inferred from title");
  assert.ok(hits.sources > 0 && hits.keywords > 0);
});

test("mergeVectors folds warm-start into survey vector", () => {
  const base = buildPreferenceVector({ categories: ["auto"] });
  const warm = inferFromHistory(["clien.net", "아이폰"]).vector;
  const baseTech = base.categories.tech || 0;
  mergeVectors(base, warm, 0.6);
  assert.ok((base.categories.tech || 0) > baseTech, "tech interest added from history");
});

test("seed source collects a de-duplicated item set", async () => {
  const { items, errors } = await collect([new SeedSource()]);
  assert.equal(errors.length, 0);
  assert.ok(items.length > 20, "seed dataset is non-trivial");
  const ids = new Set(items.map((i) => i.id));
  assert.equal(ids.size, items.length, "ids are unique");
});

test("engine serves unseen batches and never repeats within a session", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("u1");
  store.saveSurvey(user.id, { categories: ["auto"], tags: ["cars"], communities: ["bobae"] });

  const seen = new Set();
  let cursor = 0;
  for (let i = 0; i < 3; i++) {
    const feed = await engine.getFeed(user.id, { cursor, limit: 8 });
    cursor = feed.nextCursor;
    for (const item of feed.items) {
      assert.ok(!seen.has(item.id), `item ${item.id} served twice`);
      seen.add(item.id);
    }
  }
  assert.ok(seen.size >= 20, "paged through many unique items");
});

test("rating through the engine updates confidence and item state", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("u2");
  store.saveSurvey(user.id, { categories: ["auto"], tags: ["cars"] });

  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 5 });
  const first = feed.items[0];
  const res = await engine.rate(user.id, first.id, 1);
  assert.equal(res.feedbackCount, 1);
  assert.ok(res.level >= 0);

  const detail = await engine.getItem(user.id, first.id);
  assert.equal(detail.myRating, 1, "rating reflected on the item");
});

test("19금 items are hidden until age-verified AND toggled on", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("adult1");
  store.saveSurvey(user.id, { categories: ["humor", "life", "culture"] });

  // default: no adult items served
  let all = [];
  for (let c = 0; c < 6; c++) {
    const f = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
    all.push(...f.items);
    if (f.exhausted) break;
  }
  assert.equal(all.some((i) => i.adult), false, "no adult items before verification");

  // toggling on without verification does nothing
  assert.equal(store.setShowAdult(user.id, true), false, "cannot enable adult unverified");

  // verify + enable, fresh user to avoid seen-set masking
  const u2 = store.createUser("adult2");
  store.saveSurvey(u2.id, { categories: ["humor", "life", "culture"] });
  store.verifyAge(u2.id);
  assert.equal(store.setShowAdult(u2.id, true), true, "enabled after verification");

  let withAdult = [];
  for (let c = 0; c < 6; c++) {
    const f = await engine.getFeed(u2.id, { cursor: c * 20, limit: 20 });
    withAdult.push(...f.items);
    if (f.exhausted) break;
  }
  assert.ok(withAdult.some((i) => i.adult), "adult items appear once verified + toggled");
});

test("stable ids survive re-collection so ratings/comments don't orphan", async () => {
  const a = (await collect([new SeedSource()])).items;
  const b = (await collect([new SeedSource()])).items;
  assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id), "ids are stable across collects");
});

test("getItem refuses a 19금 item for an unverified user", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const items = (await collect([new SeedSource()])).items;
  const adultItem = items.find((i) => i.adult);
  assert.ok(adultItem, "seed has an adult item");

  const user = store.createUser("peeker");
  const blocked = await engine.getItem(user.id, adultItem.id);
  assert.equal(blocked, null, "adult detail blocked for unverified user");

  store.verifyAge(user.id);
  store.setShowAdult(user.id, true);
  const allowed = await engine.getItem(user.id, adultItem.id);
  assert.ok(allowed && allowed.adult, "adult detail served after verification");
});

test("comments attach to items and surface in the detail view", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("u3");
  store.saveSurvey(user.id, { categories: ["humor"] });

  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 3 });
  const item = feed.items[0];
  store.addComment(user.id, item.id, "첫 댓글!");
  const detail = await engine.getItem(user.id, item.id);
  assert.equal(detail.thread.length, 1);
  assert.equal(detail.thread[0].body, "첫 댓글!");
});

test("registry loads the community DB and summarizes it", () => {
  const reg = loadRegistry();
  assert.ok(reg.length >= 25, "registry has many communities");
  const s = summarize(reg);
  assert.ok(s.byCountry.KR > 0 && s.byCountry.US > 0, "domestic and overseas present");
  assert.ok(s.adult > 0, "adult communities registered");
  assert.ok(s.byLang.en > 0 && s.byLang.ja > 0, "overseas languages present");
});

test("buildSources only emits fetchable sources and tags seed items", async () => {
  const reg = loadRegistry();
  const sources = buildSources(reg);
  assert.ok(sources.length > 0);
  const collected = await Promise.all(sources.map((s) => s.fetch()));
  const items = collected.flat();
  assert.ok(items.length > 20, "seed-backed communities yield content");
  // enabled non-seed communities (no fetcher) must not appear
  const liveOnly = query(reg, { enabled: true }).filter((c) => c.adapter.type !== "seed");
  for (const c of liveOnly) {
    assert.equal(items.some((i) => i.source === c.id), false, `${c.id} has no offline items`);
  }
});

test("TranslatingSource flags untranslated foreign items and translates when wired", async () => {
  const foreign = {
    id: "en1", kind: "community", async fetch() {
      return [{ id: "x1", title: "Hello world", summary: "a post", lang: "en", category: "tech", tags: [], source: "reddit" }];
    }
  };
  // no translator: flagged, original kept
  const flagged = await new TranslatingSource(foreign, null, "ko").fetch();
  assert.equal(flagged[0].needsTranslation, true);
  assert.equal(flagged[0].title, "Hello world");

  // with translator: translated + metadata
  const tr = memoizedTranslator(async (t) => "[번역] " + t);
  const done = await new TranslatingSource(foreign, tr, "ko").fetch();
  assert.equal(done[0].translated, true);
  assert.equal(done[0].lang, "ko");
  assert.match(done[0].title, /^\[번역\]/);
  assert.equal(done[0].originalTitle, "Hello world");
});

test("user posts flow into the feed and into 내 공간", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new StorePostsSource(store)]);
  const user = store.createUser("author1");
  store.saveSurvey(user.id, { categories: ["auto"], tags: ["cars"] });

  const post = store.createPost(user.id, { title: "내가 쓴 시승기", summary: "직접 타봤다", category: "auto", tags: ["cars", "testdrive"] });
  engine.invalidate();

  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 10 });
  assert.ok(feed.items.some((i) => i.id === post.id), "own post appears in feed");

  store.addComment(user.id, post.id, "셀프 댓글");
  const space = store.mySpace(user.id);
  assert.equal(space.counts.posts, 1);
  assert.equal(space.counts.comments, 1);
  assert.equal(space.posts[0].title, "내가 쓴 시승기");
});

test("engine.refresh keeps item ids stable so ratings survive", async () => {
  const store = new FeedStore({ clock: () => "2026-07-06T00:00:00.000Z" });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("r1");
  store.saveSurvey(user.id, { categories: ["auto"] });
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 3 });
  const id = feed.items[0].id;
  await engine.rate(user.id, id, 1);
  await engine.refresh();
  const detail = await engine.getItem(user.id, id);
  assert.ok(detail, "rated item still resolvable after refresh");
  assert.equal(detail.myRating, 1, "rating survived refresh");
});
