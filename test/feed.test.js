import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Fixtures captured 2026-07-23 with a single real fetch each, used to test the
// "list" adapter's regex parsing entirely offline (no network in tests).
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
function fixture(name, charset = "utf-8") {
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
  return new TextDecoder(charset).decode(buf);
}

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

test("seed isolation: buildSources({seed:false}) never emits dev seed content", async () => {
  const reg = loadRegistry();
  // without a fetcher there is nothing to serve — and no seed fallback either
  assert.equal(buildSources(reg, { seed: false }).length, 0, "no seed fallback in production mode");
  // with a live fetcher, only non-seed communities produce items
  const seedIds = new Set(
    query(reg, { enabled: true }).filter((c) => c.adapter.type === "seed").map((c) => c.id)
  );
  const sources = buildSources(reg, {
    seed: false,
    fetcher: async (e) => [
      { id: `${e.id}-live-1`, title: "live item", url: "https://example.com/1", body: "가".repeat(500) }
    ]
  });
  assert.ok(sources.length > 0, "live adapters still build");
  const items = (await Promise.all(sources.map((s) => s.fetch()))).flat();
  assert.ok(items.length > 0, "live items flow");
  assert.equal(items.some((i) => seedIds.has(i.source)), false, "no seed community content leaks");
  // aggregated provenance + legal excerpt cap: live items are never via:"seed"
  // and their summaries stay within the 200-char out-link excerpt limit
  for (const i of items) {
    assert.ok(i.via === "rss" || i.via === "api", `${i.source} carries live provenance (got ${i.via})`);
    assert.ok(i.summary.length <= 200, `${i.source} excerpt capped at 200 chars`);
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

test("cosine similarity is high for aligned taste, low for opposed", async () => {
  const { cosineSimilarity } = await import("../src/feed/collab.js");
  const a = buildPreferenceVector({ categories: ["auto"], tags: ["cars"] });
  const b = buildPreferenceVector({ categories: ["auto"], tags: ["cars", "testdrive"] });
  const c = buildPreferenceVector({ categories: ["politics"], tags: ["policy"] });
  assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c), "aligned users are more similar");
  assert.ok(cosineSimilarity(a, b) > 0.3);
});

test("collaborative boosts come from similar users' likes", async () => {
  const { collaborativeBoosts } = await import("../src/feed/collab.js");
  const store = new FeedStore({ clock: fixedClock });
  const me = store.createUser("cf_me");
  store.saveSurvey(me.id, { categories: ["auto"], tags: ["cars"] });
  const twin = store.createUser("cf_twin");   // same taste as me
  store.saveSurvey(twin.id, { categories: ["auto"], tags: ["cars", "testdrive"] });
  const stranger = store.createUser("cf_stranger"); // opposite taste
  store.saveSurvey(stranger.id, { categories: ["politics"], tags: ["policy"] });

  store.recordRating(twin.id, "item_liked_by_twin", 1);
  store.recordRating(stranger.id, "item_liked_by_stranger", 1);

  const boosts = collaborativeBoosts(store, me.id);
  assert.ok((boosts.get("item_liked_by_twin") || 0) > 0, "twin's like boosts the item for me");
  assert.ok((boosts.get("item_liked_by_stranger") || 0) <= (boosts.get("item_liked_by_twin") || 0),
    "stranger's like matters less");
});

test("collaborative picks surface in the feed with a reason", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new SeedSource()]);
  const me = store.createUser("cf2_me");
  store.saveSurvey(me.id, { categories: ["auto"], tags: ["cars"] });
  const twin = store.createUser("cf2_twin");
  store.saveSurvey(twin.id, { categories: ["auto"], tags: ["cars", "testdrive"] });

  // find a real item the twin likes, then confirm it surfaces for me as a pick
  const twinFeed = await engine.getFeed(twin.id, { cursor: 0, limit: 5 });
  const liked = twinFeed.items[2]; // some auto item the twin rates up
  store.recordRating(twin.id, liked.id, 1);

  const myFeed = await engine.getFeed(me.id, { cursor: 0, limit: 30 });
  const pick = myFeed.items.find((i) => i.id === liked.id);
  assert.ok(pick, "the twin-liked item appears in my feed");
  assert.ok(pick.collabPick === true && pick.reasons.includes("비슷한 취향 픽"), "marked as a collaborative pick");
});

test("web push: VAPID JWT signs and verifies", async () => {
  const { generateVapidKeys, vapidJwt, verifyVapidJwt } = await import("../src/feed/push.js");
  const keys = generateVapidKeys();
  const jwt = vapidJwt("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:a@b.c", 3600, 1000000);
  assert.equal(jwt.split(".").length, 3);
  assert.equal(verifyVapidJwt(jwt, keys.publicKey), true, "JWT verifies with its public key");
});

test("web push: aes128gcm payload round-trips", async () => {
  const crypto = await import("node:crypto");
  const { encryptPayload, decryptPayload } = await import("../src/feed/push.js");
  // simulate a subscriber's keypair
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: "https://push/x", keys: {
    p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const recipientKeys = { p256dh: sub.keys.p256dh, auth: sub.keys.auth, private: ua.getPrivateKey().toString("base64url") };

  const body = encryptPayload(sub, "관심글 3개가 올라왔어요");
  const out = decryptPayload(body, recipientKeys);
  assert.equal(out.toString("utf8"), "관심글 3개가 올라왔어요", "decrypted payload matches");
});

test("sendDigestPushes pushes only subscribers with a non-empty digest, payload matches sw.js's shape", async () => {
  const { sendDigestPushes } = await import("../src/feed/push.js");
  const store = new FeedStore({ clock: fixedClock });
  const withItems = store.createUser("pd_with");
  const empty = store.createUser("pd_empty");
  store.createUser("pd_nosub"); // never subscribes — must never be pushed to
  store.savePushSubscription(withItems.id, { endpoint: "https://push/with", keys: { p256dh: "p", auth: "a" } });
  store.savePushSubscription(empty.id, { endpoint: "https://push/empty", keys: { p256dh: "p", auth: "a" } });

  // engine is faked out here — sendDigestPushes only calls engine.digest(userId),
  // so this isolates the fan-out/payload logic from ranking specifics.
  const fakeEngine = {
    async digest(userId) {
      if (userId === withItems.id)
        return {
          count: 2,
          top: [
            { id: "item_19", title: "성인 콘텐츠 제목", adult: true }, // must never reach a lock screen
            { id: "item_42", title: "전기차 시승기 첫인상" }
          ]
        };
      return { count: 0, top: [] };
    }
  };
  const sentTo = [];
  const sendImpl = async (sub, payload) => { sentTo.push({ sub, payload }); return { status: 201 }; };
  const vapidKeys = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" };

  const result = await sendDigestPushes(store, fakeEngine, vapidKeys, { sendImpl });

  assert.equal(result.sent, 1, "only the subscriber with a non-empty digest gets pushed");
  assert.equal(result.failed, 0);
  assert.equal(sentTo.length, 1);
  assert.equal(sentTo[0].sub.endpoint, "https://push/with");
  const payload = JSON.parse(sentTo[0].payload);
  assert.equal(payload.title, "내 취향 피드");
  assert.match(payload.body, /관심글 2개가 올라왔어요/);
  assert.match(payload.body, /전기차 시승기 첫인상/, "previews the first non-adult title");
  assert.doesNotMatch(payload.body, /성인 콘텐츠/, "19금 title never appears in a notification");
  assert.equal(payload.url, "/#post-item_42", "url deep-links to the previewed (non-adult) item");
});

test("sendDigestPushes is a no-op without VAPID keys (never even checks digests)", async () => {
  const { sendDigestPushes } = await import("../src/feed/push.js");
  const store = new FeedStore({ clock: fixedClock });
  const u = store.createUser("pd_novapid");
  store.savePushSubscription(u.id, { endpoint: "https://push/x", keys: { p256dh: "p", auth: "a" } });
  let digestChecked = false;
  const fakeEngine = { async digest() { digestChecked = true; return { count: 1, top: [{ id: "i1", title: "t" }] }; } };

  const result = await sendDigestPushes(store, fakeEngine, null, { sendImpl: async () => ({ status: 201 }) });

  assert.deepEqual(result, { sent: 0, failed: 0 });
  assert.equal(digestChecked, false);
});

test("GET /api/push/vapid-key returns the injected public key, or null when unset", async () => {
  const { createServer } = await import("../src/feed/server.js");

  const withKey = createServer({ vapid: { publicKey: "test-pub-key", privateKey: "test-priv-key" } });
  await new Promise((resolve) => withKey.listen(0, resolve));
  try {
    const res = await fetch(`http://localhost:${withKey.address().port}/api/push/vapid-key`);
    assert.deepEqual(await res.json(), { key: "test-pub-key" });
  } finally {
    withKey.close();
  }

  const withoutKey = createServer({}); // no opts.vapid, and no VAPID_* env vars in the test run
  await new Promise((resolve) => withoutKey.listen(0, resolve));
  try {
    const res = await fetch(`http://localhost:${withoutKey.address().port}/api/push/vapid-key`);
    assert.deepEqual(await res.json(), { key: null }, "no VAPID configured — client falls back to local notifications");
  } finally {
    withoutKey.close();
  }
});

test("parseOpenGraph pulls title/excerpt/source from a page's own tags", async () => {
  const { parseOpenGraph } = await import("../src/feed/ingest.js");
  const html = `<html><head>
    <meta property="og:title" content="신형 전기차 실측 후기">
    <meta property="og:description" content="충전 속도와 실주행 거리를 직접 재봤습니다. 결론부터 말하면...">
    <meta property="og:site_name" content="보배드림">
    <meta property="og:image" content="https://x/y.jpg"></head><body>full body text here</body></html>`;
  const og = parseOpenGraph(html, "https://www.bobae.co.kr/view/123");
  assert.equal(og.title, "신형 전기차 실측 후기");
  assert.ok(og.summary.length <= 200 && og.summary.startsWith("충전"));
  assert.equal(og.siteName, "보배드림");
  assert.ok(!og.summary.includes("full body"), "never captures the article body");
});

test("normalizeSubmission builds a legal out-link item (title+excerpt+source+url)", async () => {
  const { normalizeSubmission } = await import("../src/feed/ingest.js");
  const fakeFetch = async () => ({ ok: true, async text() {
    return `<meta property="og:title" content="핫한 유머 글"><meta property="og:description" content="짧은 미리보기">`;
  }});
  const item = await normalizeSubmission({ url: "https://web.humoruniv.com/board/1", category: "humor" }, { fetchImpl: fakeFetch });
  assert.equal(item.via, "submit");
  assert.equal(item.url, "https://web.humoruniv.com/board/1");
  assert.equal(item.source, "web.humoruniv.com");
  assert.equal(item.title, "핫한 유머 글");
  assert.ok(item.summary.length <= 200);

  // rejects non-http and needs a title when OG is unavailable
  await assert.rejects(() => normalizeSubmission({ url: "ftp://x" }), /링크/);
  await assert.rejects(() => normalizeSubmission({ url: "https://x/y" }, { fetchImpl: async () => ({ ok: false }) }), /제목/);
});

test("submitted links flow into the feed as out-links", async () => {
  const { normalizeSubmission } = await import("../src/feed/ingest.js");
  const store = new FeedStore({ clock: fixedClock });
  const engine = new FeedEngine(store, [new StorePostsSource(store)]);
  const user = store.createUser("sub_u");
  store.saveSurvey(user.id, { categories: ["humor"] });
  const item = await normalizeSubmission({ url: "https://theqoo.net/hot/9", title: "화제의 짤", category: "humor" });
  const rec = store.addSubmission(user.id, item);
  engine.invalidate();
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 10 });
  const found = feed.items.find((i) => i.id === rec.id);
  assert.ok(found, "submission appears in feed");
  assert.equal(found.url, "https://theqoo.net/hot/9", "keeps the out-link");
  assert.equal(found.via, "submit");
});

test("hotness ranks by public engagement + freshness only", async () => {
  const { hotness } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-06T10:00:00Z");
  const hot = hotness({ score: 800, commentCount: 300, publishedAt: "2026-07-06T09:00:00Z" }, now);
  const cold = hotness({ score: 5, commentCount: 1, publishedAt: "2026-07-01T00:00:00Z" }, now);
  assert.ok(hot > cold, "viral fresh post outranks a quiet old one");
});

test("users get a stable anonymous nickname; comments carry it (never 나)", async () => {
  const { nicknameFor } = await import("../src/feed/nickname.js");
  const store = new FeedStore({ clock: fixedClock });
  const u = store.createUser("nick_u");
  assert.ok(u.nickname && /\s/.test(u.nickname), "has a nickname");
  assert.equal(u.nickname, nicknameFor("nick_u"), "nickname is deterministic from id");

  store.saveSurvey(u.id, { categories: ["humor"] });
  const c = store.addComment(u.id, "some_item", "첫 댓글");
  assert.equal(c.author, u.nickname, "comment records the author nickname");
  assert.notEqual(c.author, "나");

  const space = store.mySpace(u.id);
  assert.equal(space.nickname, u.nickname);
});

// --- "list" adapter (jagei.co.kr model) — offline, fixture-driven ----------
// Each community below ships with its actual adapter.list config in
// communities.json; these tests replay that exact config against a real HTML
// snapshot (test/fixtures/*.html, captured 2026-07-23) so the regexes are
// verified against real markup without ever touching the network in CI.

test("parseListPage: theqoo 핫게시판 — title/url/date/score/comment parse, notices excluded", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "theqoo");
  const items = parseListPage(fixture("theqoo_hot.html"), entry.adapter.list);
  assert.ok(items.length >= 15, `expected many rows, got ${items.length}`);
  assert.ok(items.every((i) => i.url.startsWith("https://theqoo.net/hot/")), "urls resolved against urlBase");
  assert.ok(items.every((i) => !("summary" in i) && !("body" in i)), "no body/excerpt collected");
  assert.ok(items.some((i) => i.commentCount > 0), "comment counts captured");
  assert.ok(items.some((i) => i.score > 0), "view counts captured as score");
  // the pinned/notice rows ("더쿠 이용 규칙" etc.) must not leak into the feed
  assert.ok(items.every((i) => !i.title.includes("더쿠 이용 규칙")), "pinned notices excluded");
});

test("parseListPage: 보배드림 베스트 — title/url/comment parse via title attribute", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "bobae");
  assert.equal(entry.adapter.type, "list");
  const items = parseListPage(fixture("bobaedream_best.html"), entry.adapter.list);
  assert.ok(items.length >= 15, `expected many rows, got ${items.length}`);
  assert.ok(items.every((i) => i.url.includes("code=best")));
  assert.ok(items.some((i) => i.commentCount > 0));
});

test("parseListPage: 오늘의유머 베오베 — date/score/comment all parse without bleeding across rows", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "todayhumor");
  assert.equal(entry.enabled, true);
  const items = parseListPage(fixture("todayhumor_beobe.html"), entry.adapter.list);
  assert.ok(items.length >= 15);
  // distinct rows must not all collapse onto the same score/comment (the bug a
  // context-window overlap would produce)
  const scores = new Set(items.map((i) => i.score));
  assert.ok(scores.size > 3, "scores vary across rows, not bled from a neighbor");
  assert.ok(items.every((i) => i.publishedAt), "every row got a parsed date");
});

test("parseListPage: 엠엘비파크 불펜 — date is read from BEFORE the title (dateIn:'before')", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "mlbpark");
  assert.equal(entry.enabled, true, "enabled despite robots Disallow:/ — WARN accepted per handoff.md 절대원칙 2");
  assert.match(entry.adapter.note, /robots/);
  const items = parseListPage(fixture("mlbpark_bullpen.html"), entry.adapter.list);
  assert.ok(items.length >= 10);
  assert.ok(items.every((i) => i.url.includes("b=bullpen")));
  assert.ok(items.some((i) => i.publishedAt), "relative Korean dates ('N시간전') parsed");
});

test("parseListPage: 웃긴대학 웃긴자료(pds) — EUC-KR page decodes correctly via adapter.list.charset", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "humoruniv");
  assert.equal(entry.adapter.list.charset, "euc-kr");
  const html = fixture("humoruniv_pds.html", "euc-kr"); // decoded the same way listFetcher would
  const items = parseListPage(html, entry.adapter.list);
  assert.ok(items.length >= 10);
  assert.ok(items.every((i) => !/�/.test(i.title)), "no mojibake/replacement chars in titles");
  assert.ok(items.some((i) => i.commentCount > 0));
});

test("parseListPage: 이토랜드 힛게시판(HIT, 사이트 전역 인기글) — parses the page's own JSON-LD ItemList (url/title group order swapped)", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "etoland");
  assert.match(entry.adapter.url, /\/hit\/list$/, "David 2026-07-24: 최신순 일반 게시판(etohumor02) 대신 힛게시판으로 교체");
  assert.equal(entry.adapter.list.urlGroup, 2);
  assert.equal(entry.adapter.list.titleGroup, 1);
  const items = parseListPage(fixture("etoland_hit.html"), entry.adapter.list);
  assert.ok(items.length >= 20);
  assert.ok(items.every((i) => i.url.startsWith("https://etoland.co.kr/hit/")), "HIT board urls (span multiple sub-boards)");
  assert.ok(items.every((i) => i.title && !i.title.startsWith("http")), "title/url groups not swapped");
});

test("parseListPage: 네이트판 톡커들의 선택 — title attribute + recommend/reply counts", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "pann");
  assert.equal(entry.enabled, true);
  const items = parseListPage(fixture("pann_talk_ranking.html"), entry.adapter.list);
  assert.ok(items.length >= 20);
  assert.ok(items.every((i) => i.url.startsWith("https://pann.nate.com/talk/")));
  assert.ok(items.some((i) => i.score > 0 && i.commentCount > 0));
});

test("parseListPage: 뽐뿌 HOT게시글 (David 2026-07-24: 단일 핫딜게시판 대신 전 게시판 통합 인기랭킹으로 교체) — cross-board urls, EUC-KR decode", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "ppomppu");
  assert.match(entry.adapter.url, /hot\.php$/, "switched from the single-board RSS to the site-wide HOT ranking");
  assert.equal(entry.adapter.list.charset, "euc-kr");
  const items = parseListPage(fixture("ppomppu_hot.html", "euc-kr"), entry.adapter.list);
  assert.ok(items.length >= 15);
  assert.ok(items.every((i) => i.url.startsWith("https://www.ppomppu.co.kr/zboard/")));
  // the HOT ranking spans multiple boards (car/money/humor/freeboard/...), unlike the old single hotdeal-board RSS
  const boardIds = new Set(items.map((i) => new URL(i.url).searchParams.get("id")));
  assert.ok(boardIds.size >= 3, `expected posts from several boards, got ${[...boardIds]}`);
  assert.ok(items.some((i) => i.commentCount > 0));
});

test("listFetcher decodes 'euc-kr' as the real-world CP949/UHC superset, not just strict EUC-KR — regression for mojibake like '앜ㅋㅋ'", async () => {
  const { listFetcher } = await import("../src/feed/fetchers.js");
  // Bytes captured from a live ppomppu HOT row (2026-07-24). The syllable
  // "앜" (bytes 9d da) is outside strict KS X 1001 — Node's built-in
  // TextDecoder('euc-kr') mangled it into "聞빱�" mojibake even with
  // adapter.list.charset set correctly, which was the exact production
  // symptom this test guards against (see cp949-table.js).
  const asciiPre = Buffer.from(
    '<a href="/zboard/view.php?id=hit&no=10052217" class="baseList-title" >',
    "ascii"
  );
  const koreanBytes = Buffer.from(
    "9ddaa4bba4bb20c0ccc0e7b8ed20b6c72078c1fa20bdc3c0dba4bba4bb",
    "hex"
  ); // "앜ㅋㅋ 이재명 또 x질 시작ㅋㅋ" as raw EUC-KR/CP949 bytes
  const asciiPost = Buffer.from("</a>", "ascii");
  const bytes = Buffer.concat([asciiPre, koreanBytes, asciiPost]);
  const fetchImpl = async () => ({
    ok: true,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  });
  const entry = {
    adapter: {
      type: "list",
      url: "https://www.ppomppu.co.kr/hot.php",
      list: {
        urlBase: "https://www.ppomppu.co.kr",
        titleRegex:
          '<a href="(/zboard/(?:view|zboard)\\.php\\?id=[a-zA-Z0-9_]+&no=\\d+)" class="baseList-title"\\s*>(?:<img[^>]*>)?\\s*([^<]+)',
        charset: "euc-kr"
      }
    }
  };
  const items = await listFetcher(entry, fetchImpl)();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "앜ㅋㅋ 이재명 또 x질 시작ㅋㅋ");
  assert.ok(!/�/.test(items[0].title), "no U+FFFD replacement characters");
});

test("makeFetcher dispatches adapter.type 'list' through listFetcher, decoding bytes itself (not res.text())", async () => {
  const { makeFetcher } = await import("../src/feed/fetchers.js");
  const html = fixture("theqoo_hot.html");
  const bytes = new TextEncoder().encode(html);
  let calledWith = null;
  const fakeFetch = async (url, opts) => {
    calledWith = { url, ua: opts.headers["user-agent"] };
    return { ok: true, async arrayBuffer() { return bytes.buffer; } };
  };
  const entry = {
    id: "theqoo",
    adapter: {
      type: "list",
      url: "https://theqoo.net/hot",
      list: {
        urlBase: "https://theqoo.net",
        titleRegex: "<td class=\"title\">\\s*<a href=\"(/hot/\\d+)\"[^>]*>(?:<strong>)?(?:<span[^>]*>)?([^<]+)",
        windowBefore: 280,
        excludeRegex: "<tr class=\"notice[\\s\"]"
      }
    }
  };
  const rows = await makeFetcher(entry, fakeFetch)();
  assert.ok(rows.length > 0);
  assert.equal(calledWith.url, "https://theqoo.net/hot");
  assert.match(calledWith.ua, /^taste-feed\/1\.0/, "identifying UA required by handoff.md's list-page adapter rule");
});

test("communities.json: fmkorea/arca stay disabled and dcinside stays seed-only per David's 2026-07-23 exclusion", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const reg = loadRegistry();
  const fmkorea = reg.find((c) => c.id === "fmkorea");
  const arca = reg.find((c) => c.id === "arca");
  const dcinside = reg.find((c) => c.id === "dcinside");
  assert.equal(fmkorea.enabled, false);
  assert.match(fmkorea.adapter.note, /David/);
  assert.equal(arca.enabled, false);
  assert.match(arca.adapter.note, /David/);
  assert.equal(dcinside.adapter.type, "seed", "no live adapter built for dcinside");
  assert.match(dcinside.adapter.note, /David/);

  // buildSources must never invoke a fetcher for these three ids
  const called = [];
  const spyFetcher = async (entry) => {
    called.push(entry.id);
    return [];
  };
  const { buildSources } = await import("../src/feed/registry.js");
  const sources = buildSources(reg, { seed: true, fetcher: spyFetcher });
  await Promise.all(sources.map((s) => s.fetch()));
  assert.ok(!called.includes("fmkorea"));
  assert.ok(!called.includes("arca"));
  assert.ok(!called.includes("dcinside"));
});

// --- Phase 3: per-source volume cap (gnews-style 100+ item sources must not
// drown out communities that only ever surface a few dozen posts) ----------

test("collect() applies tiered default caps: community sources 100, news sources 20 (David 2026-07-24: '베스트게시판 글을 싹 가져와야')", async () => {
  const bigNews = {
    id: "gnews",
    kind: "news",
    async fetch() {
      return Array.from({ length: 150 }, (_, i) => normalizeItem({ id: `g${i}`, source: "gnews", title: `기사 ${i}`, url: `https://n/${i}` }));
    }
  };
  const bigCommunity = {
    id: "theqoo",
    kind: "community",
    async fetch() {
      return Array.from({ length: 150 }, (_, i) => normalizeItem({ id: `t${i}`, source: "theqoo", title: `글 ${i}`, url: `https://t/${i}` }));
    }
  };
  const smallCommunity = {
    id: "clien",
    kind: "community",
    async fetch() {
      return [normalizeItem({ id: "c1", source: "clien", title: "글", url: "https://c/1" })];
    }
  };
  const { items } = await collect([bigNews, bigCommunity, smallCommunity]);
  assert.equal(items.filter((i) => i.source === "gnews").length, 20, "news defaults to FEED_NEWS_CAP=20");
  assert.equal(items.filter((i) => i.source === "theqoo").length, 100, "community defaults to FEED_COMMUNITY_CAP=100");
  assert.equal(items.filter((i) => i.source === "clien").length, 1, "small source unaffected by either cap");
});

test("collect() lets FEED_COMMUNITY_CAP / FEED_NEWS_CAP override their own tier independently, with FEED_SOURCE_CAP as a shared fallback", async () => {
  const news = {
    id: "gnews",
    kind: "news",
    async fetch() {
      return Array.from({ length: 50 }, (_, i) => normalizeItem({ id: `n${i}`, source: "gnews", title: `t${i}`, url: `https://n/${i}` }));
    }
  };
  const community = {
    id: "theqoo",
    kind: "community",
    async fetch() {
      return Array.from({ length: 50 }, (_, i) => normalizeItem({ id: `c${i}`, source: "theqoo", title: `t${i}`, url: `https://c/${i}` }));
    }
  };

  const prevNews = process.env.FEED_NEWS_CAP;
  const prevCommunity = process.env.FEED_COMMUNITY_CAP;
  const prevSource = process.env.FEED_SOURCE_CAP;
  try {
    // tier-specific env vars override their own tier only
    process.env.FEED_NEWS_CAP = "3";
    process.env.FEED_COMMUNITY_CAP = "12";
    delete process.env.FEED_SOURCE_CAP;
    let r = await collect([news, community]);
    assert.equal(r.items.filter((i) => i.source === "gnews").length, 3);
    assert.equal(r.items.filter((i) => i.source === "theqoo").length, 12);

    // with the tier-specific vars unset, FEED_SOURCE_CAP is a shared fallback for both tiers
    delete process.env.FEED_NEWS_CAP;
    delete process.env.FEED_COMMUNITY_CAP;
    process.env.FEED_SOURCE_CAP = "9";
    r = await collect([news, community]);
    assert.equal(r.items.filter((i) => i.source === "gnews").length, 9);
    assert.equal(r.items.filter((i) => i.source === "theqoo").length, 9);
  } finally {
    if (prevNews == null) delete process.env.FEED_NEWS_CAP; else process.env.FEED_NEWS_CAP = prevNews;
    if (prevCommunity == null) delete process.env.FEED_COMMUNITY_CAP; else process.env.FEED_COMMUNITY_CAP = prevCommunity;
    if (prevSource == null) delete process.env.FEED_SOURCE_CAP; else process.env.FEED_SOURCE_CAP = prevSource;
  }
});

test("collect() honors FEED_SOURCE_CAP env override and opts.perSourceCap", async () => {
  const source = {
    id: "gnews",
    kind: "news",
    async fetch() {
      return Array.from({ length: 50 }, (_, i) => normalizeItem({ id: `e${i}`, source: "gnews", title: `t${i}`, url: `https://n/${i}` }));
    }
  };
  const viaOpt = await collect([source], { perSourceCap: 5 });
  assert.equal(viaOpt.items.length, 5);

  const prev = process.env.FEED_SOURCE_CAP;
  process.env.FEED_SOURCE_CAP = "7";
  try {
    const viaEnv = await collect([source]);
    assert.equal(viaEnv.items.length, 7);
  } finally {
    if (prev == null) delete process.env.FEED_SOURCE_CAP;
    else process.env.FEED_SOURCE_CAP = prev;
  }
});

// --- Phase 4: source-select chip bar (GET /api/feed?source=) ---------------

test("GET /api/feed?source= scopes to one source in latest+hotness order (not personalized); unknown source is 400", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const { JsonSource } = await import("../src/feed/content.js");

  const clien = new JsonSource(
    "clien",
    async () => [
      { title: "클리앙 글 A", url: "https://clien.net/a", category: "tech", score: 1, publishedAt: "2026-07-06T00:00:00Z" },
      { title: "클리앙 글 B", url: "https://clien.net/b", category: "tech", score: 50, publishedAt: "2026-07-06T09:00:00Z" }
    ],
    "community"
  );
  const ppomppu = new JsonSource(
    "ppomppu",
    async () => [{ title: "뽐뿌 글", url: "https://ppomppu.co.kr/a", category: "business", score: 1 }],
    "community"
  );
  const server = createServer({ sources: [clien, ppomppu] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const userId = session.userId;
    await fetch(`${base}/api/survey`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, answers: { categories: ["business"] } }) // taste favors ppomppu's category
    });

    const res = await fetch(`${base}/api/feed?userId=${userId}&source=clien&limit=10`);
    assert.equal(res.status, 200);
    const feed = await res.json();
    assert.ok(feed.items.length > 0, "source-scoped feed returns items");
    assert.ok(feed.items.every((i) => i.source === "clien"), "only the requested source appears, even though the user's taste favors the other one");
    // hotness order (fresher/higher-score first), not the taste-personalized order
    assert.equal(feed.items[0].title, "클리앙 글 B");

    const bad = await fetch(`${base}/api/feed?userId=${userId}&source=not-a-real-source`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /unknown source/);
  } finally {
    server.close();
  }
});

// --- frame viewer (jagei-style hybrid): every source carries a static
// `frameable` flag, verified per-source against real response headers
// (2026-07-24) and surfaced to the client via /api/communities ------------

test("communities.json: every community carries a boolean `frameable` field", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const reg = loadRegistry();
  assert.ok(reg.length > 0);
  for (const c of reg) {
    assert.equal(typeof c.frameable, "boolean", `${c.id} is missing a boolean frameable flag`);
  }
});

test("communities.json: frameable matches the 2026-07-24 header verification (jagei cross-check)", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const byId = Object.fromEntries(loadRegistry().map((c) => [c.id, c]));
  // Same-domain community boards where a static per-source flag is meaningful.
  // jagei reported bobae/ppomppu/theqoo/pann/todayhumor as iframe-embedded and
  // clien/ruliweb/etoland/mlbpark as direct-link; our verification agrees on
  // all of these except humoruniv (see report for the discrepancy + the
  // load-timeout fallback that covers it).
  const expectFrameable = { bobae: true, ppomppu: true, theqoo: true, pann: true, todayhumor: true };
  const expectNotFrameable = { clien: false, ruliweb: false, etoland: false, mlbpark: false };
  for (const [id, want] of Object.entries({ ...expectFrameable, ...expectNotFrameable })) {
    assert.equal(byId[id].frameable, want, `${id} frameable should be ${want}`);
  }
  // Heterogeneous-destination sources (each item links to a different external
  // domain) can't carry a meaningful single flag — always out-link.
  assert.equal(byId.hackernews.frameable, false);
  assert.equal(byId.gnews.frameable, false);
});

test("GET /api/communities surfaces the frameable flag to the client (no server change needed — it's part of the registry passthrough)", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: [] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/communities`);
    const body = await res.json();
    const theqoo = body.communities.find((c) => c.id === "theqoo");
    const clien = body.communities.find((c) => c.id === "clien");
    assert.equal(theqoo.frameable, true);
    assert.equal(clien.frameable, false);
  } finally {
    server.close();
  }
});

// --- 수집량 확대 (David 2026-07-24): rolling pool + multi-page list fetch ----

test("engine.refresh accumulates into a rolling pool (merge by stableId) instead of replacing it, and evicts only past FEED_RETENTION_MS", async () => {
  let clockMs = Date.parse("2026-07-06T00:00:00.000Z");
  const clock = () => new Date(clockMs).toISOString();
  const store = new FeedStore({ clock });

  const raw1 = { source: "theqoo", title: "옛날 글", url: "https://t/1" };
  const raw2 = { source: "theqoo", title: "새 글", url: "https://t/2" };
  const id1 = normalizeItem(raw1).id;
  const id2 = normalizeItem(raw2).id;

  let batch = [raw1];
  const source = { id: "theqoo", kind: "community", async fetch() { return batch.map((r) => normalizeItem(r, this)); } };
  const engine = new FeedEngine(store, [source]);

  await engine.refresh();
  assert.deepEqual((await engine._items()).map((i) => i.id), [id1], "first refresh seeds the pool");

  // 47h later, the source's own list page no longer shows item 1 (it scrolled
  // off) — a naive replace would drop it, but the rolling pool must keep it
  clockMs += 47 * 3600 * 1000;
  batch = [raw2];
  await engine.refresh();
  let ids = (await engine._items()).map((i) => i.id);
  assert.ok(ids.includes(id1) && ids.includes(id2), "item 1 survives a refresh that didn't re-return it (merge, not replace)");

  // 2 more hours (item 1 is now 49h old, item 2 only 2h old) — only item 1 crosses FEED_RETENTION_MS
  clockMs += 2 * 3600 * 1000;
  await engine.refresh();
  ids = (await engine._items()).map((i) => i.id);
  assert.ok(!ids.includes(id1), "item 1 evicted once its age passes the 48h default retention");
  assert.ok(ids.includes(id2), "item 2 (only 2h old) is unaffected");
});

test("engine.refresh never evicts a user's own posts (via 'me') even past the retention window", async () => {
  let clockMs = Date.parse("2026-07-06T00:00:00.000Z");
  const clock = () => new Date(clockMs).toISOString();
  const store = new FeedStore({ clock });
  const engine = new FeedEngine(store, [new StorePostsSource(store)]);
  const author = store.createUser("author_ret");
  const post = store.createPost(author.id, { title: "오래된 내 글", category: "life" });

  await engine.refresh();
  assert.ok((await engine._items()).some((i) => i.id === post.id));

  clockMs += 100 * 3600 * 1000; // 100h — well past the 48h default
  await engine.refresh();
  assert.ok((await engine._items()).some((i) => i.id === post.id), "own posts are exempt from the 48h retention eviction");
});

test("listFetcher fetches adapter.pages sequential pages via pageUrl and merges them (page 1 always uses adapter.url as-is)", async () => {
  const { listFetcher } = await import("../src/feed/fetchers.js");
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const isPage2 = url.includes("page=2");
    const html = isPage2
      ? `<a href="/p/3">Title C</a>`
      : `<a href="/p/1">Title A</a><a href="/p/2">Title B</a>`;
    return { ok: true, async arrayBuffer() { return new TextEncoder().encode(html).buffer; } };
  };
  const entry = {
    id: "test",
    adapter: {
      type: "list",
      url: "https://x.example/list",
      pages: 2,
      list: {
        urlBase: "https://x.example",
        titleRegex: '<a href="(/p/\\d+)">([^<]+)</a>',
        pageUrl: "https://x.example/list?page={page}"
      }
    }
  };
  const rows = await listFetcher(entry, fakeFetch)();
  assert.equal(calls.length, 2, "fetched exactly adapter.pages=2 pages");
  assert.equal(calls[0], "https://x.example/list", "page 1 uses adapter.url as-is, unchanged from single-page behavior");
  assert.equal(calls[1], "https://x.example/list?page=2", "page 2 built from the pageUrl template");
  assert.deepEqual(rows.map((r) => r.title), ["Title A", "Title B", "Title C"], "items from every page are merged");
});

test("listFetcher stops paginating (without failing) once a source has no pageUrl or a page returns nothing", async () => {
  const { listFetcher } = await import("../src/feed/fetchers.js");
  let calls = 0;
  const noPageUrlEntry = {
    id: "test2",
    adapter: {
      type: "list", url: "https://x.example/list", pages: 3,
      list: { titleRegex: '<a href="(/p/\\d+)">([^<]+)</a>' } // no pageUrl configured
    }
  };
  const fetchImpl = async () => { calls++; return { ok: true, async arrayBuffer() { return new TextEncoder().encode('<a href="/p/1">A</a>').buffer; } }; };
  const rows = await listFetcher(noPageUrlEntry, fetchImpl)();
  assert.equal(calls, 1, "no pageUrl configured -> only page 1 is fetched, same as before multi-page support existed");
  assert.equal(rows.length, 1);
});

// --- mixed-content bug fix (2026-07-24): ppomppu's RSS hands back http://
// links, which a frame viewer running on our https-served app hard-blocks —
// normalizeItem upgrades those to https:// when the source is verified to
// support it (raw.httpsOk, stamped by registry.js from communities.json). --

test("normalizeItem upgrades http:// to https:// when raw.httpsOk === true", () => {
  const item = normalizeItem({
    source: "ppomppu",
    title: "핫딜",
    url: "http://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1",
    httpsOk: true
  });
  assert.equal(item.url, "https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1");
});

test("normalizeItem leaves http:// alone when httpsOk is false or unset (unverified source)", () => {
  const untouched = normalizeItem({ source: "x", title: "t", url: "http://example.com/a", httpsOk: false });
  assert.equal(untouched.url, "http://example.com/a", "explicit httpsOk:false never rewrites");

  const unset = normalizeItem({ source: "me", title: "t", url: "http://example.com/b" });
  assert.equal(unset.url, "http://example.com/b", "no httpsOk field at all (e.g. user posts/submissions) never rewrites");

  const alreadyHttps = normalizeItem({ source: "ppomppu", title: "t", url: "https://example.com/c", httpsOk: true });
  assert.equal(alreadyHttps.url, "https://example.com/c", "already-https urls pass through unchanged");
});

test("registry.js stamps httpsOk onto live-adapter items from the community entry's flag (default true, ppomppu explicit true, hackernews explicit false)", async () => {
  const { loadRegistry, buildSources } = await import("../src/feed/registry.js");
  const reg = loadRegistry();
  const ppomppu = reg.find((c) => c.id === "ppomppu");
  const hackernews = reg.find((c) => c.id === "hackernews");
  assert.equal(ppomppu.httpsOk, true);
  assert.equal(hackernews.httpsOk, false);

  const fetcher = async (entry) => [{ title: "t", url: `http://${entry.id}.example/1` }];
  const sources = buildSources([ppomppu, hackernews], { seed: false, fetcher });
  const items = (await Promise.all(sources.map((s) => s.fetch()))).flat();
  const ppItem = items.find((i) => i.source === "ppomppu");
  const hnItem = items.find((i) => i.source === "hackernews");
  assert.equal(ppItem.url, "https://ppomppu.example/1", "ppomppu (httpsOk:true) gets upgraded");
  assert.equal(hnItem.url, "http://hackernews.example/1", "hackernews (httpsOk:false) is left as-is");
});

// --- best-board audit + new sources (David 2026-07-24) --------------------

test("communities.json: humoruniv disabled (ClaudeBot robots Disallow: / re-confirmed)", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const humoruniv = loadRegistry().find((c) => c.id === "humoruniv");
  assert.equal(humoruniv.enabled, false);
  assert.match(humoruniv.adapter.note, /ClaudeBot/);
});

test("parseRss: 긱뉴스 (GeekNews) Atom feed parses with the existing rss adapter — no code change needed", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "geeknews");
  assert.equal(entry.enabled, true);
  assert.equal(entry.adapter.type, "rss");
  const items = parseRss(fixture("geeknews.xml"));
  assert.ok(items.length >= 20);
  assert.ok(items.every((i) => i.url.startsWith("https://news.hada.io/")));
  assert.ok(items.every((i) => i.title));
});

test("parseListPage: 인벤 핫벤 (hot.inven.co.kr) — cross-game ranked list with recommend/comment counts", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "inven_hot");
  assert.equal(entry.enabled, true);
  const items = parseListPage(fixture("inven_hot.html"), entry.adapter.list);
  assert.ok(items.length >= 30);
  assert.ok(items.every((i) => i.url.startsWith("https://www.inven.co.kr/board/")));
  assert.ok(items.some((i) => i.score > 0), "recommend counts (추천) captured");
  assert.ok(items.some((i) => i.commentCount > 0));
  // spans multiple games' boards, not a single-game feed
  const boards = new Set(items.map((i) => i.url.split("/")[4]));
  assert.ok(boards.size >= 3, `expected several game boards, got ${[...boards]}`);
});

// --- 콘텐츠 필터 스위치 (정치/종교/성인) — 키워드+게시판 기반 분류, AI 아님 ------

test("classifyTopics: keyword rules tag politics/religion/adult from the title alone", async () => {
  const { classifyTopics } = await import("../src/feed/topics.js");
  assert.deepEqual(
    classifyTopics({ title: "이재명 국민의힘 총선 전망 분석", url: "https://x/1", sourceId: "clien" }),
    ["politics"]
  );
  assert.deepEqual(
    classifyTopics({ title: "신천지 목사 논란, 교회 측 입장 발표", url: "https://x/2", sourceId: "clien" }),
    ["religion"]
  );
  assert.deepEqual(
    classifyTopics({ title: "[19금] 성인인증 후 열람 가능한 후방주의 글", url: "https://x/3", sourceId: "clien" }),
    ["adult"]
  );
  assert.deepEqual(
    classifyTopics({ title: "오늘 점심 뭐 먹지 다들 추천좀", url: "https://x/4", sourceId: "clien" }),
    []
  );
});

test("classifyTopics: board-slug rules tag etoland 시사(sisabbs)/익명(anony) HIT-ranking items by their own url", async () => {
  const { classifyTopics } = await import("../src/feed/topics.js");
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/sisabbs01/view/12345", sourceId: "etoland" }),
    ["politics"]
  );
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/anony3/view/12345", sourceId: "etoland" }),
    ["adult"]
  );
  // a non-political etoland board stays untagged
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/etohumor07/view/12345", sourceId: "etoland" }),
    []
  );
  // the same url pattern on a different source must NOT match (source-scoped rules)
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/sisabbs01/view/12345", sourceId: "clien" }),
    []
  );
});

test("classifyTopics: board-slug rules tag ppomppu 정치자유게시판/진보·보수공감 HOT-ranking items by id=", async () => {
  const { classifyTopics } = await import("../src/feed/topics.js");
  assert.deepEqual(
    classifyTopics({ title: "화제의 이슈", url: "https://www.ppomppu.co.kr/zboard/view.php?id=issue&no=1", sourceId: "ppomppu" }),
    ["politics"]
  );
  assert.deepEqual(
    classifyTopics({ title: "화제의 이슈", url: "https://www.ppomppu.co.kr/zboard/view.php?id=pol_left&no=1", sourceId: "ppomppu" }),
    ["politics"]
  );
  assert.deepEqual(
    classifyTopics({ title: "핫딜 정보", url: "https://www.ppomppu.co.kr/zboard/view.php?id=freeboard&no=1", sourceId: "ppomppu" }),
    []
  );
});

test("normalizeItem folds an adult topic tag into the existing `adult` field — no separate gate", async () => {
  const item = normalizeItem({
    title: "익명 게시판 글",
    url: "https://etoland.co.kr/hit/anony2/view/1",
    source: "etoland"
  });
  assert.equal(item.adult, true, "board-detected adult topic upgrades item.adult");
  assert.deepEqual(item.topics, ["adult"]);

  // keyword-detected adult also upgrades the field, on a source that isn't registry-flagged adult
  const item2 = normalizeItem({ title: "19금 후방주의 글", url: "https://x/z", source: "clien" });
  assert.equal(item2.adult, true);

  // a plain item stays untouched
  const item3 = normalizeItem({ title: "오늘 날씨 좋네요", url: "https://x/y", source: "clien" });
  assert.equal(item3.adult, false);
  assert.deepEqual(item3.topics, []);
});

test("engine hides politics/religion items by default; per-user toggle (showTopics) reveals them", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const politicsItem = normalizeItem({ title: "이재명 국민의힘 관련 속보", url: "https://x/p1", source: "clien" });
  const religionItem = normalizeItem({ title: "교회 목사 인터뷰", url: "https://x/r1", source: "clien" });
  const plainItem = normalizeItem({ title: "오늘의 IT 뉴스 모음", url: "https://x/n1", source: "clien" });
  const source = { id: "clien", kind: "community", async fetch() { return [politicsItem, religionItem, plainItem]; } };
  const engine = new FeedEngine(store, [source]);

  const user = store.createUser("topicfilter1");
  store.saveSurvey(user.id, { categories: ["news", "tech"] });
  const f1 = await engine.getFeed(user.id, { cursor: 0, limit: 20 });
  const ids1 = f1.items.map((i) => i.id);
  assert.ok(!ids1.includes(politicsItem.id), "politics hidden by default");
  assert.ok(!ids1.includes(religionItem.id), "religion hidden by default");
  assert.ok(ids1.includes(plainItem.id), "unrelated item still shows");

  // toggle politics on for a fresh user (avoid seen-set masking from user 1)
  const user2 = store.createUser("topicfilter2");
  store.saveSurvey(user2.id, { categories: ["news", "tech"] });
  store.setTopicFilter(user2.id, "politics", true);
  const f2 = await engine.getFeed(user2.id, { cursor: 0, limit: 20 });
  const ids2 = f2.items.map((i) => i.id);
  assert.ok(ids2.includes(politicsItem.id), "politics shows once toggled on");
  assert.ok(!ids2.includes(religionItem.id), "religion still hidden (only politics was toggled)");
});

test("topic filter also applies to the per-source board view (소스별 보기), not just the personalized feed", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const politicsItem = normalizeItem({ title: "무관한 제목", url: "https://etoland.co.kr/hit/sisabbs05/view/9", source: "etoland" });
  const humorItem = normalizeItem({ title: "웃긴 짤", url: "https://etoland.co.kr/hit/etohumor07/view/9", source: "etoland" });
  const source = { id: "etoland", kind: "community", async fetch() { return [politicsItem, humorItem]; } };
  const engine = new FeedEngine(store, [source]);
  const user = store.createUser("srcview1");

  const f1 = await engine.getFeed(user.id, { cursor: 0, limit: 20, source: "etoland" });
  const ids1 = f1.items.map((i) => i.id);
  assert.ok(!ids1.includes(politicsItem.id), "politics-board item hidden even in the source-scoped 소스별 보기");
  assert.ok(ids1.includes(humorItem.id));

  store.setTopicFilter(user.id, "politics", true);
  const f2 = await engine.getFeed(user.id, { cursor: 0, limit: 20, source: "etoland" });
  assert.ok(f2.items.some((i) => i.id === politicsItem.id), "shows once the user turns politics on");
});

test("store.setTopicFilter rejects the adult topic — it must stay on the existing verify-age/adult gate", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("topicreject1");
  assert.throws(() => store.setTopicFilter(user.id, "adult", true), /unknown filterable topic/);
});

test("POST /api/topics toggles politics/religion and is reflected in GET /api/feed and /api/me", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const politicsItem = normalizeItem({ title: "정청래 한동훈 관련 발언 논란", url: "https://x/api1", source: "clien" });
  const source = { id: "clien", kind: "community", async fetch() { return [politicsItem]; } };
  const server = createServer({ sources: [source] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.deepEqual(session.showTopics, []);

    const before = await (await fetch(`${base}/api/feed?userId=${session.userId}&cursor=0&limit=20`)).json();
    assert.ok(!before.items.some((i) => i.id === politicsItem.id), "politics hidden before toggling on");

    const toggled = await (await fetch(`${base}/api/topics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, topic: "politics", on: true })
    })).json();
    assert.equal(toggled.ok, true);
    assert.deepEqual(toggled.showTopics, ["politics"]);

    const me = await (await fetch(`${base}/api/me?userId=${session.userId}`)).json();
    assert.deepEqual(me.showTopics, ["politics"]);

    const after = await (await fetch(`${base}/api/feed?userId=${session.userId}&cursor=0&limit=20`)).json();
    assert.ok(after.items.some((i) => i.id === politicsItem.id), "politics visible after toggling on");
  } finally {
    server.close();
  }
});

test("POST /api/topics for adult requires age verification, exactly like /api/adult (no duplicate gate)", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: [] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();

    const denied = await fetch(`${base}/api/topics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, topic: "adult", on: true })
    });
    assert.equal(denied.status, 403, "adult topic still requires age verification");

    await fetch(`${base}/api/verify-age`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, confirmAdult: true })
    });
    const allowed = await (await fetch(`${base}/api/topics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, topic: "adult", on: true })
    })).json();
    assert.equal(allowed.showAdult, true, "adult topic toggle flips the same showAdult flag /api/adult uses");
  } finally {
    server.close();
  }
});

test("GET /api/config exposes the topic catalog for the UI toggles", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: [] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const res = await (await fetch(`http://localhost:${server.address().port}/api/config`)).json();
    const ids = res.topics.map((t) => t.id).sort();
    assert.deepEqual(ids, ["adult", "politics", "religion"]);
    assert.ok(res.topics.every((t) => t.defaultVisible === false), "all three default to hidden");
  } finally {
    server.close();
  }
});

// --- 유저 링크 제출 (user link submission) end-to-end -----------------------
// createServer({}) with no `sources` override defaults to just the
// store-backed source (registry-driven live/dev sources are both off in the
// test env), so submitted items are the only content in the pool — exactly
// what these tests need.

test("POST /api/submit creates a via:submit out-link item that appears in the feed", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const userId = session.userId;

    // FEED_LIVE is off in the test run, so the server never actually fetches
    // OG tags — normalizeSubmission falls back to the submitter-provided title,
    // exactly like the network-failure path already covered in ingest.js's unit test.
    const res = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://example.com/cool-post", title: "테스트로 제출한 글" })
    });
    assert.equal(res.status, 200);
    const rec = await res.json();
    assert.equal(rec.via, "submit");
    assert.equal(rec.url, "https://example.com/cool-post");
    assert.equal(rec.title, "테스트로 제출한 글");
    assert.ok(rec.summary.length <= 200);

    const feed = await (await fetch(`${base}/api/feed?userId=${userId}&limit=10`)).json();
    const found = feed.items.find((i) => i.id === rec.id);
    assert.ok(found, "submitted item shows up in the personalized feed");
    assert.equal(found.via, "submit");
    assert.equal(found.url, "https://example.com/cool-post", "out-link preserved, never framed");
  } finally {
    server.close();
  }
});

test("POST /api/submit: a malformed URL is 400 with a Korean error, unknown user is 400", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();

    const bad = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, url: "not-a-url", title: "x" })
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /http\(s\)/);

    const noUser = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "ghost-user", url: "https://example.com/x", title: "x" })
    });
    assert.equal(noUser.status, 400);
  } finally {
    server.close();
  }
});

test("POST /api/submit: SSRF guard rejects loopback/private-IP/localhost targets", async () => {
  const { normalizeSubmission } = await import("../src/feed/ingest.js");
  const { createServer } = await import("../src/feed/server.js");

  // unit-level: every obvious internal target is blocked before any fetch happens
  for (const url of [
    "http://127.0.0.1/admin",
    "http://localhost:4000/api",
    "http://169.254.169.254/latest/meta-data", // cloud metadata endpoint
    "http://10.0.0.5/internal",
    "http://192.168.1.1/router",
    "http://[::1]/x"
  ]) {
    await assert.rejects(
      () => normalizeSubmission({ url, title: "x" }),
      /안전하지 않은/,
      `${url} should be rejected as unsafe`
    );
  }
  // a normal public host is unaffected
  await assert.doesNotReject(() => normalizeSubmission({ url: "https://example.com/x", title: "x" }));

  // end-to-end: the API surfaces the same guard as a 400
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const res = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, url: "http://127.0.0.1:9999/steal", title: "x" })
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /안전하지 않은/);
  } finally {
    server.close();
  }
});

test("POST /api/submit rate-limits a burst of submissions from one user (429)", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const userId = session.userId;

    const submit = (i) =>
      fetch(`${base}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, url: `https://example.com/p${i}`, title: `글 ${i}` })
      });

    // DEFAULT_RULES.submit.perWindow === 5 — same shape as post/comment rate limits
    for (let i = 0; i < 5; i++) {
      const r = await submit(i);
      assert.equal(r.status, 200, `submission ${i} should succeed`);
    }
    const sixth = await submit(5);
    assert.equal(sixth.status, 429);
    const body = await sixth.json();
    assert.ok(body.rule && body.rule.rateLimited, "429 carries rule.rateLimited so the client can distinguish it");
  } finally {
    server.close();
  }
});

test("submitted items are classified by topics.js like any other item — politics hidden by default, shown after the user's own toggle", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const userId = session.userId;

    const sub = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://example.com/politics-post", title: "이재명 관련 소식 정리" })
    });
    assert.equal(sub.status, 200);
    const rec = await sub.json();

    const hidden = await (await fetch(`${base}/api/feed?userId=${userId}&limit=20`)).json();
    assert.ok(!hidden.items.some((i) => i.id === rec.id), "politics-tagged submission stays hidden by default, same as any other source");

    await fetch(`${base}/api/topics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, topic: "politics", on: true })
    });
    const shown = await (await fetch(`${base}/api/feed?userId=${userId}&limit=20`)).json();
    const found = shown.items.find((i) => i.id === rec.id);
    assert.ok(found, "shows up once the user opts into politics");
    assert.ok(found.topics.includes("politics"), "classifyTopics ran on the submitted item's title");
  } finally {
    server.close();
  }
});

test("GET /api/feed?source=submit scopes to every via:submit item regardless of its own out-link domain", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({});
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const userId = session.userId;

    await fetch(`${base}/api/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://siteA.example.com/x", title: "A 사이트 글" })
    });
    await fetch(`${base}/api/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, url: "https://siteB.example.com/y", title: "B 사이트 글" })
    });

    const res = await fetch(`${base}/api/feed?userId=${userId}&source=submit&limit=10`);
    assert.equal(res.status, 200);
    const feed = await res.json();
    assert.equal(feed.items.length, 2, "both submissions appear even though their out-link domains differ");
    assert.ok(feed.items.every((i) => i.via === "submit"));
    // "submit" is a pseudo-source, not a registry id — a real unknown source id still 400s
    const bad = await fetch(`${base}/api/feed?userId=${userId}&source=not-a-real-source`);
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

// --- 2026-07-24 new sources: 44bits/yozm/outstanding/techmeme/slashdot/ddanzi/
// slownews/newspeppermint (rss) + devto (json) + tildes (list) — offline,
// fixture-driven per handoff.md's rule (real 1-time fetch captured the
// fixture; tests never touch the network). Only a representative 4 are
// exercised here (rss/RDF-variant, json custom mapper, list), matching the
// existing "list adapter" fixture-test pattern above.

test("parseRss: 44bits RSS 2.0 feed — plain feed parses via the registry's own adapter.url", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "44bits");
  assert.equal(entry.adapter.type, "rss");
  const items = parseRss(fixture("44bits_feed.xml"));
  assert.ok(items.length >= 20, `expected many posts, got ${items.length}`);
  assert.ok(items.every((i) => i.url && i.url.startsWith("https://www.44bits.io/")));
  assert.ok(items.every((i) => i.title), "every item has a title");
  assert.ok(items.some((i) => i.publishedAt), "dates parsed");
});

test("parseRss: 딴지일보 시사 큐레이션 RSS — title/link/date parse (429-sensitive source, note says low-frequency polling)", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "ddanzi");
  assert.equal(entry.kind, "news", "news-kind source gets the tighter FEED_NEWS_CAP");
  assert.match(entry.adapter.note, /429|저빈도/, "429 sensitivity documented so nobody re-polls this aggressively");
  const items = parseRss(fixture("ddanzi_news.xml"));
  assert.ok(items.length >= 10, `expected posts, got ${items.length}`);
  assert.ok(items.every((i) => i.url && i.url.startsWith("https://www.ddanzi.com/")));
  assert.ok(items.some((i) => i.publishedAt));
});

test("devtoFetcher maps dev.to's own field names (positive_reactions_count/comments_count/published_at/description) onto the canonical shape", async () => {
  const { devtoFetcher } = await import("../src/feed/fetchers.js");
  const raw = JSON.parse(fixture("devto_top.json"));
  const fakeFetch = async (url) => {
    assert.match(url, /^https:\/\/dev\.to\/api\/articles\?top=/);
    return { ok: true, async json() { return raw; } };
  };
  const items = await devtoFetcher(fakeFetch)();
  assert.equal(items.length, raw.length);
  assert.equal(items[0].title, raw[0].title);
  assert.equal(items[0].url, raw[0].url);
  assert.equal(items[0].score, raw[0].positive_reactions_count);
  assert.equal(items[0].commentCount, raw[0].comments_count);
  assert.equal(items[0].publishedAt, raw[0].published_at);
  assert.equal(items[0].lang, "en");

  // wired through makeFetcher by entry.id, not adapter.url shape
  const { makeFetcher } = await import("../src/feed/fetchers.js");
  const viaMakeFetcher = await makeFetcher({ id: "devto", adapter: { type: "json", url: "https://dev.to/api/articles?top=7" } }, fakeFetch)();
  assert.equal(viaMakeFetcher.length, raw.length);
});

test("parseListPage: Tildes 베스트(order=votes&period=all) — internal (relative /~group/id/slug) and external (absolute) links both resolve correctly, votes/comments never bleed across articles", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "tildes");
  assert.equal(entry.adapter.type, "list");
  assert.equal(entry.lang, "en", "overseas source flows through the translation pipeline");
  const items = parseListPage(fixture("tildes_votes.html"), entry.adapter.list);
  assert.ok(items.length >= 40, `expected many topics, got ${items.length}`);
  // resolveUrl() must leave absolute (external out-link) hrefs untouched while
  // still prefixing urlBase onto relative (Tildes' own self-post) hrefs
  assert.ok(items.some((i) => i.url.startsWith("https://tildes.net/~")), "internal self-posts resolved against urlBase");
  assert.ok(items.some((i) => !i.url.startsWith("https://tildes.net/")), "external out-links kept as-is, not mangled");
  assert.ok(items.every((i) => i.score > 0), "every row's own vote count captured");
  assert.ok(items.every((i) => i.commentCount > 0), "every row's own comment count captured");
  // regression guard for the windowAfter bleed risk: scores must vary across
  // rows (a bleed bug would show many rows collapsing onto a neighbor's number)
  const uniqueScores = new Set(items.map((i) => i.score));
  assert.ok(uniqueScores.size > 10, "vote counts vary per row, not bled from a neighboring article");
});

test("communities.json: all 10 sources added 2026-07-24 are registered, enabled, https, and lang-tagged for translation where overseas", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const reg = loadRegistry();
  const expected = {
    "44bits": { lang: "ko", kind: "community", type: "rss" },
    yozm: { lang: "ko", kind: "community", type: "rss" },
    outstanding: { lang: "ko", kind: "community", type: "rss" },
    techmeme: { lang: "en", kind: "community", type: "rss" },
    slashdot: { lang: "en", kind: "community", type: "rss" },
    ddanzi: { lang: "ko", kind: "news", type: "rss" },
    slownews: { lang: "ko", kind: "news", type: "rss" },
    newspeppermint: { lang: "ko", kind: "news", type: "rss" },
    devto: { lang: "en", kind: "community", type: "json" },
    tildes: { lang: "en", kind: "community", type: "list" }
  };
  for (const [id, exp] of Object.entries(expected)) {
    const c = reg.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.enabled, true, `${id} enabled`);
    assert.equal(c.httpsOk, true, `${id} httpsOk`);
    assert.equal(c.lang, exp.lang, `${id} lang`);
    assert.equal(c.kind, exp.kind, `${id} kind`);
    assert.equal(c.adapter.type, exp.type, `${id} adapter type`);
    assert.ok(c.label, `${id} has a display label`);
  }
});
