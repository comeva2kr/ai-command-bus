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

test("recency boost surfaces fresher posts", async () => {
  const { scoreItem } = await import("../src/feed/recommender.js");
  const now = new Date("2026-07-06T10:00:00Z").getTime();
  const vec = emptyPreferenceVector();
  const fresh = normalizeItem({ category: "tech", tags: [], title: "새 글", score: 5, publishedAt: "2026-07-06T09:00:00Z" });
  const old = normalizeItem({ category: "tech", tags: [], title: "오래된 글", score: 5, publishedAt: "2026-07-01T09:00:00Z" });
  assert.ok(scoreItem(fresh, vec, { seed: 1, now }) > scoreItem(old, vec, { seed: 1, now }), "fresh outranks old");
});

test("diversify avoids long runs of one source/category", async () => {
  const { diversify } = await import("../src/feed/recommender.js");
  // 6 items, all high score, alternating desired; make source A dominate the top
  const ranked = [
    { item: { id: "1", source: "A", category: "tech" }, score: 5.0 },
    { item: { id: "2", source: "A", category: "tech" }, score: 4.9 },
    { item: { id: "3", source: "A", category: "tech" }, score: 4.8 },
    { item: { id: "4", source: "B", category: "auto" }, score: 4.0 },
    { item: { id: "5", source: "C", category: "life" }, score: 3.9 }
  ];
  const out = diversify(ranked, { sourcePenalty: 1.0, categoryPenalty: 0.5, window: 4 });
  // the top pick is still the best, but B/C should be pulled up ahead of the 3rd A
  const top3Sources = out.slice(0, 3).map((r) => r.item.source);
  assert.ok(new Set(top3Sources).size >= 2, "top of feed isn't a single source run");
});

test("feed pages are internally diverse across sources", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("div1");
  // broad taste so many sources qualify
  store.saveSurvey(user.id, { categories: ["auto", "tech", "humor", "sports", "culture"] });
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 8 });
  const sources = new Set(feed.items.map((i) => i.source));
  assert.ok(sources.size >= 3, `expected varied sources on a page, got ${sources.size}`);
});

test("scrap/save toggles and surfaces in 내 공간", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("s1");
  store.saveSurvey(user.id, { categories: ["auto"] });
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 3 });
  const id = feed.items[0].id;

  assert.equal(store.toggleSave(user.id, id), true, "saved");
  assert.equal(store.mySpace(user.id).counts.saved, 1);
  const detail = await engine.getItem(user.id, id);
  assert.equal(detail.saved, true, "saved flag on item");
  assert.equal(store.toggleSave(user.id, id), false, "un-saved");
  assert.equal(store.mySpace(user.id).counts.saved, 0);
});

test("muting a source removes it from the feed", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("m1");
  store.saveSurvey(user.id, { categories: ["auto", "tech", "humor", "sports"] });

  // find a source that currently appears
  const before = [];
  for (let c = 0; c < 6; c++) { const f = await engine.getFeed(user.id, { cursor: c*20, limit: 20 }); before.push(...f.items); if (f.exhausted) break; }
  const target = before[0].source;
  store.setMute(user.id, target, true);

  // fresh user's seen set is dirty; use a new user with same mute to check cleanly
  const u2 = store.createUser("m2");
  store.saveSurvey(u2.id, { categories: ["auto", "tech", "humor", "sports"] });
  store.setMute(u2.id, target, true);
  const after = [];
  for (let c = 0; c < 6; c++) { const f = await engine.getFeed(u2.id, { cursor: c*20, limit: 20 }); after.push(...f.items); if (f.exhausted) break; }
  assert.equal(after.some((i) => i.source === target), false, `${target} muted out of feed`);
});

test("parseRss handles RSS 2.0 and Atom", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const rss = `<rss><channel>
    <item><title>첫 글</title><description><![CDATA[<b>본문</b> 내용]]></description><link>http://x/1</link><pubDate>Mon, 06 Jul 2026 09:00:00 GMT</pubDate></item>
    <item><title>둘째 글</title><description>plain</description><guid>http://x/2</guid></item>
  </channel></rss>`;
  const items = parseRss(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "첫 글");
  assert.equal(items[0].summary, "본문 내용");
  assert.equal(items[0].url, "http://x/1");
  assert.ok(items[0].publishedAt.startsWith("2026-07-06"));

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom Post</title><summary>hello</summary><link href="http://a/1"/><updated>2026-07-06T10:00:00Z</updated></entry>
  </feed>`;
  const aitems = parseRss(atom);
  assert.equal(aitems.length, 1);
  assert.equal(aitems[0].title, "Atom Post");
  assert.equal(aitems[0].url, "http://a/1");
});

test("makeFetcher maps HN and reddit payloads through a fake network", async () => {
  const { makeFetcher } = await import("../src/feed/fetchers.js");
  const fakeFetch = async (url) => {
    if (url.includes("hn.algolia.com")) {
      return { ok: true, async json() { return { hits: [{ objectID: "1", title: "HN Story", url: "http://h/1", points: 42, num_comments: 7, author: "pg", created_at: "2026-07-06T00:00:00Z" }] }; } };
    }
    if (url.includes("reddit.com")) {
      return { ok: true, async json() { return { data: { children: [{ data: { id: "abc", title: "Reddit Post", selftext: "body", permalink: "/r/x/abc", score: 100, num_comments: 12, author: "u", created_utc: 1782345600, over_18: false } }] } }; } };
    }
    throw new Error("unexpected url " + url);
  };
  const hn = await makeFetcher({ id: "hackernews", adapter: { type: "json" } }, fakeFetch)();
  assert.equal(hn[0].title, "HN Story");
  assert.equal(hn[0].score, 42);
  assert.equal(hn[0].lang, "en");

  const rd = await makeFetcher({ id: "reddit", adapter: { type: "reddit", url: "programming" } }, fakeFetch)();
  assert.equal(rd[0].title, "Reddit Post");
  assert.equal(rd[0].commentCount, 12);
});

test("live sources flow through registry + translation end to end", async () => {
  const { buildSources, loadRegistry } = await import("../src/feed/registry.js");
  const reg = [
    { id: "reddit", label: "Reddit", country: "US", lang: "en", kind: "community", category: "tech", adult: false, enabled: true, adapter: { type: "reddit", url: "programming" } }
  ];
  const fetcher = async () => [{ id: "rd_1", title: "English Title", summary: "body", url: "http://r/1", lang: "en" }];
  const tr = (t) => "[ko] " + t;
  const sources = buildSources(reg, { fetcher, translate: { targetLang: "ko", translateFn: async (t) => tr(t) } });
  const items = (await Promise.all(sources.map((s) => s.fetch()))).flat();
  assert.equal(items[0].source, "reddit");
  assert.equal(items[0].translated, true);
  assert.match(items[0].title, /^\[ko\]/);
});

test("post rules reject empty/banned/too-many-tags", async () => {
  const { validatePost, validateComment } = await import("../src/feed/rules.js");
  assert.equal(validatePost({ title: "" }).ok, false);
  assert.equal(validatePost({ title: "정상 제목", summary: "도박사이트 광고" }).ok, false);
  assert.equal(validatePost({ title: "ok", tags: Array(20).fill("t") }).ok, false);
  const good = validatePost({ title: "신형 시승기", summary: "연비 좋아요", category: "auto", tags: ["cars"] });
  assert.equal(good.ok, true);
  assert.match(good.norm, /실사용/);
});

test("rate limiting blocks a burst of posts", async () => {
  const { validatePost } = await import("../src/feed/rules.js");
  const limited = validatePost({ title: "글" }, { recentPosts: 5 });
  assert.equal(limited.ok, false);
  assert.equal(limited.rateLimited, true);
});

test("levels rise with participation and gate perks", async () => {
  const { userLevel, can } = await import("../src/feed/rules.js");
  const rookie = userLevel({ posts: 0, comments: 0, likesReceived: 0 });
  assert.equal(rookie.level, 0);
  assert.equal(can({ posts: 0 }, "moderate"), false);
  const veteran = userLevel({ posts: 20, comments: 20, likesReceived: 20 });
  assert.ok(veteran.level >= 2, `expected higher level, got ${veteran.level}`);
  assert.equal(can({ posts: 30, comments: 30, likesReceived: 30 }, "moderate"), true);
});

test("store enforces rules on createPost and addComment", async () => {
  const store = new FeedStore({ clock: fixedClock });
  store.createUser("g1");
  assert.throws(() => store.createPost("g1", { title: "" }), /제목/);
  assert.throws(() => store.createPost("g1", { title: "정상", summary: "불법 스팸홍보" }), /금지어/);
  const ok = store.createPost("g1", { title: "괜찮은 글", category: "auto" });
  assert.ok(ok.id);
  assert.throws(() => store.addComment("g1", ok.id, ""), /댓글/);
});

test("mySpace reports level and likes received on own posts", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const author = store.createUser("author9");
  const fan = store.createUser("fan9");
  const post = store.createPost(author.id, { title: "내 인기 글", category: "humor" });
  store.recordRating(fan.id, post.id, 1); // someone likes the author's post
  const space = store.mySpace(author.id);
  assert.equal(space.counts.likesReceived, 1);
  assert.ok(space.level && typeof space.level.level === "number");
});

test("implicit signals: long dwell up, quick bounce and skip down", async () => {
  const { applyImplicit, scoreItem } = await import("../src/feed/recommender.js");
  const item = normalizeItem({ category: "auto", tags: ["cars"], title: "시승기", length: 100 });

  const up = emptyPreferenceVector();
  const before = scoreItem(item, up, { seed: 1, explore: 0 });
  applyImplicit(up, item, { type: "dwell", dwellMs: 60000 }); // lingered
  assert.ok(scoreItem(item, up, { seed: 1, explore: 0 }) > before, "long dwell raises score");

  const down = emptyPreferenceVector();
  const b2 = scoreItem(item, down, { seed: 1, explore: 0 });
  applyImplicit(down, item, { type: "dwell", dwellMs: 500 }); // bounced instantly
  assert.ok(scoreItem(item, down, { seed: 1, explore: 0 }) < b2, "quick bounce lowers score");

  const sk = emptyPreferenceVector();
  const b3 = scoreItem(item, sk, { seed: 1, explore: 0 });
  applyImplicit(sk, item, { type: "skip" });
  assert.ok(scoreItem(item, sk, { seed: 1, explore: 0 }) < b3, "skip lowers score");
});

test("complete is a stronger positive than open", async () => {
  const { applyImplicit } = await import("../src/feed/recommender.js");
  const item = normalizeItem({ category: "tech", tags: ["ai"], title: "x", length: 300 });
  const a = applyImplicit(emptyPreferenceVector(), item, { type: "open" });
  const b = applyImplicit(emptyPreferenceVector(), item, { type: "complete" });
  assert.ok(b.step > a.step && a.step > 0, "complete > open > 0");
});

test("exploration lifts cold-interest items but not known ones", async () => {
  const { scoreItem } = await import("../src/feed/recommender.js");
  const vec = buildPreferenceVector({ categories: ["auto"], tags: ["cars"] });
  // a cold item in an unknown category; find one whose hash gate opens
  let lifted = false;
  for (let s = 1; s < 12 && !lifted; s++) {
    const cold = normalizeItem({ category: "science", tags: ["space"], title: "우주 " + s, length: 200 });
    const withE = scoreItem(cold, vec, { seed: s, explore: 0.5 });
    const without = scoreItem(cold, vec, { seed: s, explore: 0 });
    if (withE > without) lifted = true;
  }
  assert.ok(lifted, "some cold item gets an exploration lift");

  // a known-interest item should not receive the exploration bonus
  const hot = normalizeItem({ category: "auto", tags: ["cars"], title: "신차", length: 200 });
  assert.equal(scoreItem(hot, vec, { seed: 1, explore: 0.5 }), scoreItem(hot, vec, { seed: 1, explore: 0 }));
});

test("engine.signal applies implicit feedback and counts it", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("sig1");
  store.saveSurvey(user.id, { categories: ["auto"] });
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 3 });
  const id = feed.items[0].id;
  const r = await engine.signal(user.id, id, { type: "dwell", dwellMs: 40000 });
  assert.equal(r.ok, true);
  assert.equal(store.getUser(user.id).implicitCount, 1);
});

test("explain surfaces the top reasons an item matched", async () => {
  const { explain } = await import("../src/feed/recommender.js");
  const vec = buildPreferenceVector({ categories: ["auto"], tags: ["cars", "testdrive"], communities: ["bobae"] });
  const item = normalizeItem({ category: "auto", tags: ["cars", "testdrive"], source: "bobae", title: "시승기", length: 400 });
  const reasons = explain(item, vec);
  assert.ok(reasons.length >= 1 && reasons.length <= 3);
  const kinds = reasons.map((r) => r.kind);
  assert.ok(kinds.includes("category") || kinds.includes("tag") || kinds.includes("source"), "reasons reflect learned taste");
});

test("topPreferences ranks learned interests and separates dislikes", async () => {
  const { topPreferences } = await import("../src/feed/recommender.js");
  const vec = buildPreferenceVector({ categories: ["auto", "tech"], tags: ["cars"], communities: ["bobae"], avoid: ["politics"] });
  const t = topPreferences(vec);
  assert.ok(t.categories.some((c) => c.id === "auto"));
  assert.ok(t.tags.some((x) => x.id === "cars"));
  assert.ok(t.sources.some((s) => s.id === "bobae"));
  assert.ok(t.disliked.some((d) => d.id === "politics"), "avoided category shows as disliked");
});

test("decorated feed items carry recommendation reasons", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("why1");
  store.saveSurvey(user.id, { categories: ["auto"], tags: ["cars"], communities: ["bobae"] });
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 5 });
  const withReasons = feed.items.filter((i) => i.reasons && i.reasons.length);
  assert.ok(withReasons.length > 0, "top items explain themselves");
});

test("digest previews top unseen matches without consuming them", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const user = store.createUser("dg1");
  store.saveSurvey(user.id, { categories: ["auto"], tags: ["cars"], communities: ["bobae"] });

  const d = await engine.digest(user.id, { limit: 5 });
  assert.ok(d.count > 0, "there are matching unseen items");
  assert.ok(d.top.length > 0 && d.top.length <= 5);
  assert.ok(d.top[0].matchScore >= 1.0, "digest items clear the score threshold");

  // digest must NOT consume items — the feed still serves them
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 5 });
  assert.ok(feed.items.some((i) => i.id === d.top[0].id), "digest did not mark items seen");
});

test("push subscription persists and flips notify flag", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("pn1");
  assert.equal(store.savePushSubscription(user.id, { endpoint: "https://x/y" }), true);
  assert.equal(store.getUser(user.id).notifyEnabled, true);
  assert.equal(store.savePushSubscription(user.id, null), false);
});
