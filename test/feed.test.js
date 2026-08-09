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
import { normalizeItem, SeedSource, collect, JsonSource } from "../src/feed/content.js";
import { inferFromHistory, mergeVectors } from "../src/feed/history.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { StorePostsSource } from "../src/feed/content.js";
import { loadRegistry, query, buildSources, summarize } from "../src/feed/registry.js";
import { TranslatingSource, memoizedTranslator } from "../src/feed/translate.js";
import { googleFreeTranslator } from "../src/feed/translator.js";

const fixedClock = () => "2026-07-06T00:00:00.000Z";

// createServer()로 띄우는 테스트는 주입 시계가 없어 실제 현재시각을 쓴다.
// 고정 ISO 날짜를 박아두면 시간이 흐르면서 engine.js의 절대 신선도 하한
// (FEED_MAX_ITEM_AGE_DAYS, David 검수 항목 4)에 걸려 테스트가 썩는다.
// 날짜가 검증 대상이 아닌 테스트는 "몇 시간 전"으로 상대 지정한다.
const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();


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

// David 2026-07-24 적대적 검수 #6: "즐겨 보는 커뮤니티" 설문 옵션이 taxonomy.js의
// 정적 SOURCE_CATALOG(디시인사이드·겟차·엔카·테크와이어 등 15개 seed 더미 포함)를
// 그대로 썼던 문제 — 실제 enabled && non-seed 소스만 동적으로 옵션에 나와야 한다.
test("SURVEY's 'communities' question options are exactly the live (enabled, non-seed) registry sources — no seed dummies, nothing disabled", async () => {
  const { SURVEY } = await import("../src/feed/survey.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const registry = loadRegistry();
  const communitiesQ = SURVEY.find((q) => q.id === "communities");
  assert.ok(communitiesQ, "communities question exists");

  const optionIds = new Set(communitiesQ.options.map((o) => o.id));
  // 2026-08-06: "store" 어댑터(우리가 직접 올리는 딜 지면)도 제외한다 —
  // 우리가 만든 지면이지 사용자가 "즐겨 보는 커뮤니티"로 고를 대상이 아니다.
  const expectedLive = registry.filter((c) => c.enabled === true
    && (!c.adapter || (c.adapter.type !== "seed" && c.adapter.type !== "store")));
  assert.ok(expectedLive.length > 0, "fixture assumption: at least one live source exists");
  assert.equal(optionIds.size, expectedLive.length, "option count matches live-source count exactly");
  for (const c of expectedLive) assert.ok(optionIds.has(c.id), `${c.id} (enabled, non-seed) is offered`);

  // seed-only dummies (개발용, FEED_DEV 전용) must never appear as a survey option
  const seedDummies = registry.filter((c) => c.adapter && c.adapter.type === "seed").map((c) => c.id);
  assert.ok(seedDummies.includes("dcinside") && seedDummies.includes("getcha") && seedDummies.includes("techwire"), "fixture assumption: known seed dummies still exist in the registry");
  for (const id of seedDummies) assert.ok(!optionIds.has(id), `seed dummy "${id}" must not be a survey option`);

  // explicitly-disabled non-seed sources (e.g. pann/mlbpark/humoruniv, robots-blocked) must not appear either
  const disabledLive = registry.filter((c) => c.enabled === false
    && (!c.adapter || (c.adapter.type !== "seed" && c.adapter.type !== "store"))).map((c) => c.id);
  for (const id of disabledLive) assert.ok(!optionIds.has(id), `disabled source "${id}" must not be a survey option`);

  // validateAnswers must accept a live option and reject a stale seed-dummy id
  const live = [...optionIds][0];
  assert.equal(validateAnswers({ categories: ["tech"], communities: [live] }).ok, true);
  assert.equal(validateAnswers({ categories: ["tech"], communities: ["dcinside"] }).ok, false, "dcinside is a seed dummy, not a valid survey answer");
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


test("stable ids survive re-collection so ratings/comments don't orphan", async () => {
  const a = (await collect([new SeedSource()])).items;
  const b = (await collect([new SeedSource()])).items;
  assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id), "ids are stable across collects");
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

// David 2026-07-24 적대적 검수 #9: dev.to 등 소스 전체에 lang:"en"이 못박힌 항목 중
// 실제로는 비영어(포르투갈어 등)인 글이 있어, sl을 고정 lang으로 강제하면 Google이
// 오판해 반쪽만 번역되거나 전혀 안 되는 문제가 있었다.
test("TranslatingSource always requests translation with sl=auto, never the source's stamped lang — a per-source lang tag doesn't reflect a single article's real language", async () => {
  const foreign = {
    id: "devto", kind: "community", async fetch() {
      // dev.to 소스 전체는 communities.json에서 lang:"en"으로 못박혀 있지만
      // 이 특정 글은 실제로는 포르투갈어다 (David 2026-07-24 리포트 재현)
      return [{ id: "pt1", title: "Como usar async/await", summary: "Um guia rápido", lang: "en", category: "tech", tags: [], source: "devto" }];
    }
  };
  const calls = [];
  const tr = async (text, opts) => { calls.push(opts.from); return "[번역] " + text; };
  await new TranslatingSource(foreign, tr, "ko").fetch();
  assert.ok(calls.length > 0, "translator was called");
  assert.ok(calls.every((from) => from === "auto"), `every translate call must pass sl=auto, got: ${calls.join(",")}`);
});

// 원자적 처리: 제목/요약 중 하나만 번역되고 나머지는 원문 그대로 돌아오면(엔드포인트가
// 언어를 오판했거나 일부만 성공한 경우) 절반만 번역된 상태로 보여주지 않고 전체를
// 원문+needsTranslation("원문" 배지)으로 되돌린다.
test("번역: 제목만 옮겨졌으면 제목만 쓰고, 영문 발췌는 버린다", async () => {
  // 예전 규칙은 "둘 중 하나라도 실패하면 전체를 원문으로" 였다. 취지는 절반만
  // 번역된 카드를 막는 것이었는데, 실측에서 정반대로 작동했다: 영문 소스 57건
  // 중 제목이 번역된 건 12건뿐이었고 나머지 45건은 **요약이 보일러플레이트라
  // 번역기가 원문을 그대로 돌려준 탓에** 멀쩡한 제목 번역까지 버려졌다.
  //   예) Tildes 요약 = "23 comments in the discussion of this post on Tildes"
  // 그래서 제목과 요약을 따로 판정한다 — 이 부분은 그대로 유효하다.
  //
  // 다만 **남은 영문 발췌를 그대로 보여 주던 것은 뒤집었다** (David 2026-08-05):
  // "제목 한글 / 요약 영문 섞임. 진짜 한 것만 띄우자." 화면에 두 언어가 섞여
  // 보이는 손해가, 영문 한 줄에서 얻는 정보보다 컸다. 게다가 저 Tildes 예시는
  // 애초에 발췌도 아니다. 발췌가 없으면 제목만 보여 주면 된다.
  const foreign = {
    id: "devto", kind: "community", async fetch() {
      return [{ id: "pt2", title: "Título em português", summary: "23 comments in the discussion", lang: "en", category: "tech", tags: [], source: "devto" }];
    }
  };
  const titleOnly = async (text) => (text.startsWith("Título") ? "번역된 제목" : text);
  const out = await new TranslatingSource(foreign, titleOnly, "ko").fetch();
  assert.equal(out[0].translated, true, "제목이 번역됐으면 번역된 것으로 표시한다");
  assert.equal(out[0].title, "번역된 제목");
  assert.equal(out[0].summary, "", "영문 발췌를 그대로 남기면 안 된다");
  assert.equal(out[0].summaryTranslated, false);

  // 제목이 안 되면 그때는 전체를 원문으로 — 목록에서 먼저 읽는 게 제목이다
  const foreign2 = {
    id: "devto", kind: "community", async fetch() {
      return [{ id: "pt3", title: "Untranslatable Title", summary: "Resumo em português", lang: "en", category: "tech", tags: [], source: "devto" }];
    }
  };
  const summaryOnly = async (text) => (text.startsWith("Resumo") ? "번역된 요약" : text);
  const out2 = await new TranslatingSource(foreign2, summaryOnly, "ko").fetch();
  assert.equal(out2[0].translated, undefined);
  assert.equal(out2[0].needsTranslation, true);
  assert.equal(out2[0].title, "Untranslatable Title");
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

  // digest must NOT consume items — the user's seen set stays untouched
  assert.ok(!store.getUser(user.id).seen.includes(d.top[0].id), "digest did not mark the item seen");

  // ...and the item is still reachable through the feed. The home feed is now
  // a diversity-first round-robin stream (David 2026-07-24), so digest's #1
  // personalization pick isn't guaranteed to land on the very first page —
  // page through until found instead of asserting it's in the first batch.
  let found = false;
  for (let c = 0; c < 10 && !found; c++) {
    const feed = await engine.getFeed(user.id, { cursor: c * 10, limit: 10 });
    if (feed.items.some((i) => i.id === d.top[0].id)) found = true;
    if (feed.exhausted) break;
  }
  assert.ok(found, "digest's pick is still reachable by paging through the (unconsumed) feed");
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
  assert.equal(payload.title, "지금핫");
  assert.match(payload.body, /관심글 2개가 올라왔어요/);
  assert.match(payload.body, /전기차 시승기 첫인상/, "previews the first title");
  assert.doesNotMatch(payload.body, /성인 콘텐츠/, "19금 title never appears in a notification");
  assert.equal(payload.url, "/#post-item_42", "url deep-links to the previewed item");
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

// --- Hot-only home feed ranking (David 2026-07-24 UX overhaul) -------------
// Every active source is already a community's own best/hot board; the home
// feed adds one more engagement cut on top, normalized *per source* (an HN
// score and a Korean 추천수 aren't the same scale) rather than a single raw
// threshold across every source.
//
// hotGate (below) is the original per-source percentile cut; it's kept as-is
// and still powers digest(). getFeed's default (no `source`) path moved on
// 2026-07-24 to a different shape — "게시판별 핫 + 다양성 라운드로빈": see the
// ingest.rankBySource / topPerSource / roundRobinInterleave tests further
// down and engine.js's getFeed for the replacement.

test("hotGate keeps the top engagement items and cuts the low ones within the same source", async () => {
  const { hotGate } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-06T10:00:00Z");
  // 5 items, one source: engagement 100,80,40,5,1 — top 60% (default) keeps 3
  const items = [100, 80, 40, 5, 1].map((score, i) =>
    normalizeItem({ id: `s${i}`, source: "clien", title: `글 ${i}`, category: "tech", score, publishedAt: "2026-07-06T09:00:00Z" })
  );
  const results = hotGate(items, now);
  const byId = Object.fromEntries(results.map((r) => [r.item.id, r]));
  assert.equal(byId.s0.hot, true, "highest engagement clears the cut");
  assert.equal(byId.s1.hot, true);
  assert.equal(byId.s2.hot, true, "top 60% of 5 items = top 3");
  assert.equal(byId.s3.hot, false, "low engagement excluded");
  assert.equal(byId.s4.hot, false, "lowest engagement excluded");
  assert.ok(byId.s0.hotScore > byId.s2.hotScore, "hotScore orders by engagement within the source");
});

test("hotGate never excludes a source with zero engagement signal — included but deprioritized", async () => {
  const { hotGate } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-06T10:00:00Z");
  // an RSS-only source where every item lacks score/commentCount entirely —
  // "이미 best보드 소속" so it must never be gated out
  const signalless = [0, 1, 2].map((i) =>
    normalizeItem({ id: `rss${i}`, source: "some-rss", title: `기사 ${i}`, category: "news", publishedAt: "2026-07-06T09:30:00Z" })
  );
  const hotSourceTop = normalizeItem({ id: "clien-top", source: "clien", title: "화제글", category: "tech", score: 500, publishedAt: "2026-07-06T09:30:00Z" });
  const results = hotGate([...signalless, hotSourceTop], now);
  const byId = Object.fromEntries(results.map((r) => [r.item.id, r]));
  assert.ok(signalless.every((i) => byId[i.id].hot === true), "signal-less source is never excluded");
  assert.ok(signalless.every((i) => byId[i.id].percentile === null), "no percentile to report — no signal to rank against");
  assert.ok(
    byId["clien-top"].hotScore > byId["rss0"].hotScore,
    "a real hot item still outranks the signal-less source's baseline priority"
  );
});

test("hotGate normalizes per source — a small community's top post beats its cut despite a raw score far below a viral HN-scale post", async () => {
  const { hotGate } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-06T10:00:00Z");
  // hackernews-scale source: scores in the hundreds
  const hn = [500, 10].map((score, i) =>
    normalizeItem({ id: `hn${i}`, source: "hackernews", title: `HN ${i}`, category: "tech", score, publishedAt: "2026-07-06T09:00:00Z" })
  );
  // small Korean community: raw scores are tiny by comparison, but this is
  // still that source's own best post right now
  const small = [5, 1].map((score, i) =>
    normalizeItem({ id: `sm${i}`, source: "tinyboard", title: `글 ${i}`, category: "life", score, publishedAt: "2026-07-06T09:00:00Z" })
  );
  const results = hotGate([...hn, ...small], now);
  const byId = Object.fromEntries(results.map((r) => [r.item.id, r]));
  assert.equal(byId.sm0.hot, true, "tinyboard's own top post clears its own source's cut despite a tiny raw score");
  assert.equal(byId.hn0.hot, true, "hackernews' top post clears its own source's cut");
  // both top-of-source items reach a comparable percentile even though their
  // raw engagement numbers are worlds apart
  assert.equal(byId.sm0.percentile, byId.hn0.percentile, "per-source percentile puts both sources' top posts on equal footing");
});

test("hotGate respects HOT_MIN_PERCENTILE / HOT_TOP_N overrides", async () => {
  const { hotGate } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-06T10:00:00Z");
  const items = [50, 40, 30, 20, 10].map((score, i) =>
    normalizeItem({ id: `t${i}`, source: "clien", title: `글 ${i}`, category: "tech", score, publishedAt: "2026-07-06T09:00:00Z" })
  );
  const strict = hotGate(items, now, { minTopFraction: 0.2 });
  assert.equal(strict.filter((r) => r.hot).length, 1, "a strict fraction keeps only the very top item");

  const topN = hotGate(items, now, { topN: 2 });
  assert.equal(topN.filter((r) => r.hot).length, 2, "topN overrides the fraction and keeps exactly N");
});

test("골격 v2: 개인화 홈은 소스 하위권 글도 도달 가능하고(컷 제거), 익명 홈은 top-K 컷 유지", async () => {
  const store = new FeedStore({ clock: fixedClock });
  // 10 items, one source, engagement 90..0 descending — default HOT_PER_SOURCE
  // (6) keeps only the top 6; the bottom 4 are excluded from the home feed.
  const clien = new JsonSource(
    "clien",
    async () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        title: `클리앙 글 ${i}`,
        url: `https://clien.net/${i}`,
        category: "tech",
        score: 90 - i * 10,
        publishedAt: "2026-07-05T00:00:00Z"
      })),
    "community"
  );
  const engine = new FeedEngine(store, [clien]);
  const user = store.createUser("hotfeed_u");
  store.saveSurvey(user.id, { categories: ["tech"] });

  const seenIds = new Set();
  for (let c = 0; c < 6; c++) {
    const f = await engine.getFeed(user.id, { cursor: c * 10, limit: 10 });
    for (const i of f.items) seenIds.add(i.id);
    if (f.exhausted) break;
  }
  // 골격 v2 (2026-07-31, docs/redesign-rank.md): 개인화 유저의 홈은 아이템
  // 전역 경쟁이라 topPerSource(6) 컷이 없다 — 예전 구조에서는 소스 7위 이하가
  // 취향과 무관하게 영구 불가시였다(설계 검수가 "결함 자체를 고정한 테스트"로
  // 지목한 지점). 이제 충분히 스크롤하면 전부 도달 가능해야 한다.
  for (let i = 0; i < 10; i++) assert.ok(seenIds.has(`c${i}`), `c${i}: 개인화 홈에서 도달 가능해야 (컷 제거)`);

  // 익명 유저는 기존 라운드로빈 + top-K 컷 그대로 (회귀 0 보증)
  const anon = store.createUser("hotfeed_anon");
  const anonSeen = new Set();
  for (let c = 0; c < 6; c++) {
    const f = await engine.getFeed(anon.id, { cursor: c * 10, limit: 10 });
    for (const i of f.items) anonSeen.add(i.id);
    if (f.exhausted) break;
  }
  for (let i = 6; i < 10; i++) assert.ok(!anonSeen.has(`c${i}`), `c${i}: 익명 홈은 top-6 컷 유지`);

  // sanity check: the same source's excluded posts ARE reachable through
  // source= (the board-view chip bypasses the top-K cut entirely) — proves
  // this is a home-feed-only cut, not data loss. Fresh user, since `user`
  // above already has the top 6 marked seen from paging the default feed.
  const u2 = store.createUser("hotfeed_u_src");
  const bySource = await engine.getFeed(u2.id, { cursor: 0, limit: 10, source: "clien" });
  assert.equal(bySource.items.length, 10, "source= view still surfaces every item the home feed cut down to top-6");
});

test("default getFeed still includes a signal-less source's items even when a louder source exists", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const rssOnly = new JsonSource(
    "quiet-rss",
    async () => [
      { id: "rss-1", title: "제목만 있는 기사 1", url: "https://example.com/1", category: "news", publishedAt: "2026-07-05T00:00:00Z" },
      { id: "rss-2", title: "제목만 있는 기사 2", url: "https://example.com/2", category: "news", publishedAt: "2026-07-05T00:00:00Z" }
    ],
    "news"
  );
  const engine = new FeedEngine(store, [rssOnly]);
  const user = store.createUser("hotfeed_u2");
  store.saveSurvey(user.id, { categories: ["news"] });

  const seenIds = new Set();
  for (let c = 0; c < 6; c++) {
    const f = await engine.getFeed(user.id, { cursor: c * 10, limit: 10 });
    for (const i of f.items) seenIds.add(i.id);
    if (f.exhausted) break;
  }
  assert.ok(seenIds.has("rss-1") && seenIds.has("rss-2"), "a source with no engagement counters at all is never dropped from the default feed");
});

// --- 게시판별 핫 + 다양성 라운드로빈 (David 2026-07-24 home feed redesign) -----
// rankBySource / topPerSource / roundRobinInterleave (ingest.js) replace the
// old hotGate+rankItems pipeline for getFeed's default (no `source`) path.
// hotGate itself is untouched above and still backs digest().

test("rankBySource sorts a source with real engagement numbers by that engagement, descending", async () => {
  const { rankBySource } = await import("../src/feed/ingest.js");
  const items = [10, 90, 40].map((score, i) =>
    normalizeItem({ id: `e${i}`, source: "clien", title: `글 ${i}`, category: "tech", score })
  );
  const grouped = rankBySource(items);
  const order = grouped.get("clien").map((r) => r.item.id);
  assert.deepEqual(order, ["e1", "e2", "e0"], "90 > 40 > 10");
  assert.ok(grouped.get("clien").every((r) => r.hasSignal === true));
});

test("rankBySource keeps a signal-less source's ORIGINAL collection order (sourceRank), never re-sorted by publishedAt — the core fix for '0점짜리가 최신순으로 섞임'", async () => {
  const { rankBySource } = await import("../src/feed/ingest.js");
  // sourceRank 0,1,2 = the board's own hot order (item 0 is hottest); dates
  // are deliberately the REVERSE of that (item 2 is "newest") so a date-sort
  // regression would flip this order and fail the assertion below.
  const items = [
    { id: "r0", sourceRank: 0, publishedAt: "2026-07-01T00:00:00Z" },
    { id: "r1", sourceRank: 1, publishedAt: "2026-07-02T00:00:00Z" },
    { id: "r2", sourceRank: 2, publishedAt: "2026-07-03T00:00:00Z" }
  ].map((raw) => normalizeItem({ ...raw, source: "some-rss", title: raw.id, category: "news" }));
  const grouped = rankBySource(items);
  const order = grouped.get("some-rss").map((r) => r.item.id);
  assert.deepEqual(order, ["r0", "r1", "r2"], "board's own collection order wins, not newest-first by date");
  assert.ok(grouped.get("some-rss").every((r) => r.hasSignal === false));
});

test("topPerSource caps each source to its top K (default HOT_PER_SOURCE=6), never touching sources already under the cap", async () => {
  const { rankBySource, topPerSource } = await import("../src/feed/ingest.js");
  const many = Array.from({ length: 9 }, (_, i) =>
    normalizeItem({ id: `m${i}`, source: "big", title: `글 ${i}`, category: "tech", score: 90 - i * 10 })
  );
  const few = [0, 1].map((i) => normalizeItem({ id: `f${i}`, source: "small", title: `글 ${i}`, category: "tech", score: 10 - i }));
  const grouped = rankBySource([...many, ...few]);
  const topK = topPerSource(grouped, 6);
  assert.equal(topK.get("big").length, 6, "capped down to K");
  assert.deepEqual(topK.get("big").map((r) => r.item.id), ["m0", "m1", "m2", "m3", "m4", "m5"], "kept the hottest K");
  assert.equal(topK.get("small").length, 2, "a source already under K is untouched");
});

test("roundRobinInterleave alternates across sources (round 0 = every source's #1) and never repeats a source within minGap", async () => {
  const { rankBySource, topPerSource, roundRobinInterleave } = await import("../src/feed/ingest.js");
  const items = [];
  for (const src of ["A", "B", "C"]) {
    for (let i = 0; i < 3; i++) {
      items.push(normalizeItem({ id: `${src}${i}`, source: src, title: `${src}-${i}`, category: "tech", score: 90 - i * 10 }));
    }
  }
  const topK = topPerSource(rankBySource(items), 6);
  const out = roundRobinInterleave(topK, { minGap: 1 }).map((it) => it.id);
  // round 0 = each source's #1 (order among ties is scoreFn-driven, but the
  // *set* of the first 3 must be exactly the three sources' #1 items)
  assert.deepEqual(new Set(out.slice(0, 3)), new Set(["A0", "B0", "C0"]));
  // no two consecutive items share a source anywhere in the stream
  for (let i = 1; i < out.length; i++) {
    const prevSrc = out[i - 1][0];
    const curSrc = out[i][0];
    assert.notEqual(prevSrc, curSrc, `consecutive same-source items at ${i - 1}/${i}: ${out[i - 1]}, ${out[i]}`);
  }
  assert.equal(out.length, 9, "every item from every source's top-K is eventually placed");
});

test("roundRobinInterleave: a genuine outlier's engagement can lead its own round without skipping ahead of an earlier round", async () => {
  const { roundRobinInterleave } = await import("../src/feed/ingest.js");
  // 3 sources, 2 items each. B's rank-1 item is a huge outlier, but
  // round-robin structure means it can only win round 1 (be the first of
  // round 1's three candidates placed), never jump into round 0 ahead of
  // A0/B0/C0.
  const mk = (id, src, rank) => ({ item: { id, source: src }, rank, hasSignal: true });
  const topK = new Map([
    ["A", [mk("A0", "A", 0), mk("A1", "A", 1)]],
    ["B", [mk("B0", "B", 0), mk("B1", "B", 1)]],
    ["C", [mk("C0", "C", 0), mk("C1", "C", 1)]]
  ]);
  const scoreFn = (item) => (item.id === "B1" ? 999 : -0); // B1 is the "outlier"
  const out = roundRobinInterleave(topK, { minGap: 1, scoreFn }).map((it) => it.id);
  assert.deepEqual(new Set(out.slice(0, 3)), new Set(["A0", "B0", "C0"]), "round 0 is still exactly the three sources' #1 items");
  const round1 = out.slice(3);
  assert.equal(round1[0], "B1", "the outlier wins round 1 (its own round) — first among A1/B1/C1 — not earlier");
});

// David 2026-07-24 적대적 검수 #2: "홈 피드 8개 소스 독식" 회귀 픽스.
// 근본원인: 매 getFeed 호출이 라운드로빈을 처음부터 재계산했고, round 0 하나에만도
// (활성 소스 수만큼) limit(기본 10)보다 많은 후보가 들어있는 게 보통이라 매번 round 0의
// scoreFn 상위 10개만 잘려나갔다 — 점수가 낮은 소스의 아이템은 항상 round 0에서 밀려나
// (다음 round로 넘어가지도 못한 채) 다음 호출에서도 똑같이 밀리는 일이 반복돼 사실상
// 영원히 노출되지 않았다. 반면 "시끄러운" 소스는 자기 아이템이 소진(seen)되는 족족
// 다음 순위 아이템으로 채워져(역시 높은 점수) round 0을 계속 이겼다.
// 수정: roundRobinInterleave가 exposure(지금까지 이 유저에게 노출된 횟수)를 1순위
// 정렬 기준으로 삼는다 — engagement/개인화 점수는 노출 횟수가 비슷한 소스끼리의
// 타이브레이크로만 작동한다.
test("roundRobinInterleave: 화제성이 순서를 정하고, 노출은 감점으로 붙는다", async () => {
  // ── 계약 변경 2026-08-04 ─────────────────────────────────────────────
  // 예전 계약: "노출 적자가 화제성 격차를 이긴다"(적자가 1순위 키, hotScore는
  // 동점자 처리용). 실측에서 이게 치명적이었다 — 익명 핫 첫 30건 중 25건이
  // 추천 0·댓글 0이었고, 소스별 노출이 정확히 12씩 균등했다. 화제성 랭킹이
  // 아니라 배급표였다. "핫을 눌렀는데 최신이랑 비슷하면 정렬 버튼 자체를
  // 안 믿게 된다"(헤비유저 검수)가 정확한 진단이다.
  //
  // 새 계약: 화제성이 순서를 정하고 노출 적자는 로그 감점으로 붙는다.
  // 개인화 경로(rank.js)가 이미 쓰던 방식이고, 익명 경로만 구식이었다.
  const { roundRobinInterleave } = await import("../src/feed/ingest.js");
  const mk = (id, src, rank) => ({ item: { id, source: src }, rank, hasSignal: true });
  const topK = new Map([
    ["loud", [mk("loud0", "loud", 0), mk("loud1", "loud", 1)]],
    ["quiet", [mk("quiet0", "quiet", 0)]]
  ]);
  const scoreFn = (item) => (item.source === "loud" ? 999 : 1);

  const noExposure = roundRobinInterleave(topK, { minGap: 1, scoreFn }).map((it) => it.id);
  assert.equal(noExposure[0], "loud0", "노출 이력이 없으면 화제성 높은 쪽이 먼저");

  // 압도적 화제성(999 대 1)은 20회 노출 감점을 이긴다 — 이게 새 계약의 핵심이다.
  // log1p(20) × 1.0 ≈ 3.04 감점이라 998 대 1로 여전히 loud가 앞선다.
  const exposure = new Map([["loud", 20], ["quiet", 0]]);
  const withExposure = roundRobinInterleave(topK, { minGap: 1, scoreFn, exposure }).map((it) => it.id);
  assert.equal(withExposure[0], "loud0",
    "압도적으로 화제인 글은 많이 노출된 소스의 것이라도 앞에 선다");

  // 그러나 화제성이 비슷하면 노출 감점이 순서를 뒤집는다 — 다양성은 살아 있다.
  const evenScore = () => 1;
  const evenOrder = roundRobinInterleave(topK, { minGap: 1, scoreFn: evenScore, exposure }).map((it) => it.id);
  assert.equal(evenOrder[0], "quiet0",
    "화제성이 비슷하면 덜 보여준 소스가 먼저 — 다양성 계약은 유지된다");
});

test("roundRobinInterleave: 한 소스가 연달아 피드를 먹지 않는다", async () => {
  // 감점이 로그라 초반 노출에 크게 반응한다. 같은 소스가 계속 이기지 못한다.
  const { roundRobinInterleave } = await import("../src/feed/ingest.js");
  const mk = (id, src) => ({ item: { id, source: src }, rank: 0, hasSignal: true });
  const topK = new Map([
    ["a", Array.from({ length: 10 }, (_, i) => mk(`a${i}`, "a"))],
    ["b", Array.from({ length: 10 }, (_, i) => mk(`b${i}`, "b"))],
    ["c", Array.from({ length: 10 }, (_, i) => mk(`c${i}`, "c"))]
  ]);
  // a가 조금 더 화제인 상황 — 그래도 독식하면 안 된다.
  const scoreFn = (item) => (item.source === "a" ? 1.5 : 1.0);
  const out = roundRobinInterleave(topK, { minGap: 1, scoreFn }).map((it) => it.source);
  const first9 = out.slice(0, 9);
  const counts = {};
  for (const s of first9) counts[s] = (counts[s] || 0) + 1;
  assert.ok(Math.max(...Object.values(counts)) <= 5,
    `한 소스가 앞 9칸 중 ${Math.max(...Object.values(counts))}칸을 먹었다: ${first9.join(",")}`);
  assert.equal(Object.keys(counts).length, 3, "세 소스가 모두 앞 9칸에 나와야 한다");
});

// --- Hot curation v1 (David 2026-07-24) -------------------------------------
// Ported-formula unit tests: robust z-score, the probit/Φ⁻¹ approximation
// against known standard-normal quantiles, HN gravity decay (older always
// loses to fresher holding signal constant), Bayesian small-sample shrinkage,
// the engagement-less percentile path, and the specific production symptom
// this whole pass exists to fix — a 434-day-old post sitting at a signal-less
// source's rank-0 slot must NOT win over that same source's genuinely fresh
// items just because nothing has displaced it from the board's top slot.

test("robustZScores: known values (median/MAD) and the MAD=0 safe fallback", async () => {
  const { robustZScores } = await import("../src/feed/ingest.js");
  // median=30, absDevs=[20,10,0,10,20] -> MAD=10 -> scale=14.826
  const z = robustZScores([10, 20, 30, 40, 50]);
  assert.ok(Math.abs(z[2]) < 1e-9, "the median itself scores ~0");
  assert.ok(z[0] < z[1] && z[1] < z[2] && z[2] < z[3] && z[3] < z[4], "monotonic with raw value");
  assert.ok(Math.abs(z[4] - 1.34898) < 1e-3, "known z-score for the top of this distribution");
  // every value identical -> MAD=0 -> no divide-by-zero, falls back to all 0
  assert.deepEqual(robustZScores([5, 5, 5, 5]), [0, 0, 0, 0], "flat distribution never NaNs/Infinitys");
  assert.deepEqual(robustZScores([]), [], "empty input is safe");
});

test("probit (Φ⁻¹) approximation matches known standard-normal quantiles within 1e-4", async () => {
  const { probit } = await import("../src/feed/ingest.js");
  assert.ok(Math.abs(probit(0.5) - 0) < 1e-9, "the median maps to z=0");
  assert.ok(Math.abs(probit(0.975) - 1.959964) < 1e-4, "97.5th percentile -> ~1.96 (textbook 95% CI bound)");
  assert.ok(Math.abs(probit(0.025) - -1.959964) < 1e-4, "2.5th percentile -> ~-1.96");
  assert.ok(Math.abs(probit(0.9) - 1.281552) < 1e-4, "90th percentile -> ~1.2816");
  assert.ok(Math.abs(probit(0.1) - -1.281552) < 1e-4, "10th percentile -> ~-1.2816");
  assert.ok(probit(0.5 + 1e-9) > probit(0.5 - 1e-9), "monotonic increasing");
  // boundary safety: exactly 0 or 1 (a real input here — a source's own top
  // or bottom rank maps straight to a percentile of 1 or 0) must stay finite,
  // never ±Infinity/NaN.
  assert.ok(Number.isFinite(probit(1)), "p=1 clamped to a finite z, not +Infinity");
  assert.ok(Number.isFinite(probit(0)), "p=0 clamped to a finite z, not -Infinity");
  assert.ok(probit(1) > probit(0.999), "still ordered correctly right at the clamp boundary");
});

test("hnDecay: older always loses to fresher holding the signal constant, and gravity steepens the drop", async () => {
  const { hnDecay } = await import("../src/feed/ingest.js");
  const fresh = hnDecay(1, 1, 1.8);
  const oneDayOld = hnDecay(1, 24, 1.8);
  const veryOld = hnDecay(1, 434 * 24, 1.8); // the reported production case
  assert.ok(fresh > oneDayOld, "1h old outranks 1 day old at equal signal");
  assert.ok(oneDayOld > veryOld, "1 day old outranks 434 days old at equal signal");
  assert.ok(fresh / veryOld > 1e6, "434-day staleness is a crushing, not a mild, penalty");
  // higher gravity decays faster
  assert.ok(hnDecay(1, 100, 3.0) < hnDecay(1, 100, 1.8), "a steeper gravity value decays the same age harder");
});

test("bayesianConfidence: small-sample items are shrunk toward neutral, large samples approach full trust", async () => {
  const { bayesianConfidence } = await import("../src/feed/ingest.js");
  const small = bayesianConfidence(5, 10); // "반응 5개 반짝"
  const large = bayesianConfidence(1000, 10);
  assert.ok(small < 0.5, "a handful of reactions is mostly shrunk toward neutral");
  assert.ok(large > 0.95, "a large, trustworthy sample keeps nearly all its signal");
  assert.ok(bayesianConfidence(0, 10) === 0, "zero reactions -> zero confidence, fully neutral");
  assert.ok(bayesianConfidence(50, 10) > bayesianConfidence(5, 10), "monotonic in sample size");
});

test("sourceHotScores: engagement-less source path uses sourceRank->percentile->probit, still decayed by age", async () => {
  const { sourceHotScores } = await import("../src/feed/ingest.js");
  const { normalizeItem } = await import("../src/feed/content.js");
  const now = Date.parse("2026-07-24T00:00:00Z");
  const items = [0, 1, 2].map((rank) =>
    normalizeItem({ id: `r${rank}`, source: "quiet-rss", sourceRank: rank, publishedAt: "2026-07-23T00:00:00Z" })
  );
  const scored = sourceHotScores(items, now);
  assert.ok(scored.every((s) => s.hasSignal === false), "no engagement anywhere in this group");
  // 2026-08-04 계약 변경: 순위만 있는 경로는 **약한 증거**라 신뢰도를 할인한다.
  // 예전엔 1.0(중립)이었는데, 그러면 probit(1위 백분위)=4.75가 그대로 살아
  // 추천 466건짜리 실측 신호(z≈2.9)를 이겼다. 아래 별도 테스트가 그 역전이
  // 다시 생기지 않는지 지킨다.
  assert.ok(scored.every((s) => s.confidence > 0 && s.confidence < 1), "순위만 있는 경로는 신뢰도를 할인한다");
  assert.ok(scored[0].hotScore > scored[1].hotScore && scored[1].hotScore > scored[2].hotScore, "board's own rank order preserved when age is equal");
});

test("sourceHotScores: THE core fix — a 434-day-old post at a quiet source's rank-0 loses to that same source's genuinely fresh items", async () => {
  const { sourceHotScores } = await import("../src/feed/ingest.js");
  const { normalizeItem } = await import("../src/feed/content.js");
  const now = Date.parse("2026-07-24T00:00:00Z");
  const hoursAgo = (h) => new Date(now - h * 3.6e6).toISOString();
  // mirrors the reported bug exactly: rank 0 is a 434-day-old post, rank 1 is
  // a 199-day-old post, and rank 2/3 are the source's genuinely fresh items —
  // a signal-less RSS source where score/commentCount are 0 everywhere.
  const items = [
    normalizeItem({ id: "stale_434d", source: "low-activity-rss", sourceRank: 0, publishedAt: hoursAgo(434 * 24) }),
    normalizeItem({ id: "stale_199d", source: "low-activity-rss", sourceRank: 1, publishedAt: hoursAgo(199 * 24) }),
    normalizeItem({ id: "fresh_5h", source: "low-activity-rss", sourceRank: 2, publishedAt: hoursAgo(5) }),
    normalizeItem({ id: "fresh_2h", source: "low-activity-rss", sourceRank: 3, publishedAt: hoursAgo(2) })
  ];
  const byId = Object.fromEntries(sourceHotScores(items, now).map((s) => [s.item.id, s]));
  assert.ok(byId.fresh_2h.hotScore > byId.stale_434d.hotScore, "a 2h-old post outranks the board's stale rank-0 post");
  assert.ok(byId.fresh_5h.hotScore > byId.stale_434d.hotScore, "a 5h-old post outranks the board's stale rank-0 post");
  assert.ok(byId.fresh_2h.hotScore > byId.stale_199d.hotScore, "a fresh post also outranks a 199-day-old one");
  assert.ok(byId.stale_434d.hotScore < 0.01, "the 434-day-old post's hotScore is crushed near zero, not merely lowered");
});

test("rankBySource: the same 434-day fix holds through the full grouping/sorting entry point", async () => {
  const { rankBySource } = await import("../src/feed/ingest.js");
  const { normalizeItem } = await import("../src/feed/content.js");
  const now = Date.parse("2026-07-24T00:00:00Z");
  const hoursAgo = (h) => new Date(now - h * 3.6e6).toISOString();
  const items = [
    normalizeItem({ id: "stale_434d", source: "low-activity-rss", sourceRank: 0, publishedAt: hoursAgo(434 * 24) }),
    normalizeItem({ id: "fresh_2h", source: "low-activity-rss", sourceRank: 1, publishedAt: hoursAgo(2) })
  ];
  const order = rankBySource(items, now).get("low-activity-rss").map((r) => r.item.id);
  assert.equal(order[0], "fresh_2h", "fresh item now ranks first despite its worse board-collection rank");
});

test("taste bias cannot reverse a large hotScore gap at default weight — 화제성 우선, 취향은 재정렬만", async () => {
  const { sourceHotScores, hotParams } = await import("../src/feed/ingest.js");
  const now = Date.parse("2026-07-24T00:00:00Z");
  const items = [
    { id: "hot_fresh", source: "s", score: 500, commentCount: 50, publishedAt: new Date(now - 1 * 3.6e6).toISOString() },
    { id: "cold_stale", source: "s", score: 1, commentCount: 0, publishedAt: new Date(now - 240 * 3.6e6).toISOString() }
  ];
  const byId = Object.fromEntries(sourceHotScores(items, now).map((s) => [s.item.id, s]));
  const { tasteW } = hotParams();
  const maxTasteSwing = 2 * tasteW; // taste term is tanh-bounded to (-1, 1) in engine.js
  const gap = byId.hot_fresh.hotScore - byId.cold_stale.hotScore;
  assert.ok(gap > maxTasteSwing, `hotScore gap (${gap}) must exceed the max possible taste swing (${maxTasteSwing}) for taste to never flip a real hot/cold pair`);
  // even the worst case (taste maximally favors the cold item, maximally
  // disfavors the hot one) cannot flip the order
  assert.ok(byId.hot_fresh.hotScore + tasteW * -1 > byId.cold_stale.hotScore + tasteW * 1, "adversarial taste bias still can't flip a genuine hot/cold pair");
});

// End-to-end reproduction of the reported production symptom (260 items / 26
// pages: 8 sources repeat every page, clien shows once, several sources never
// appear at all) and the ticket's own acceptance target: with N active
// sources, scrolling far enough must surface every one of them at least once,
// and no top-8 clique may dominate more than 60% of the stream.
test("getFeed home feed: scrolling far enough surfaces EVERY active source at least once, and the top 8 never exceed 60% of the stream (2026-07-24 round-robin starvation fix)", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const sources = [];
  // 8 "loud" sources: real engagement numbers, plenty of items (mirrors
  // theqoo/hackernews/pann/inven_hot/tildes/devto/bobae/ppomppu in the report)
  for (let s = 0; s < 8; s++) {
    const id = `loud${s}`;
    sources.push(
      new JsonSource(
        id,
        async () =>
          Array.from({ length: 30 }, (_, i) => ({
            id: `${id}_${i}`,
            title: `${id} 글 ${i}`,
            url: `https://example.com/${id}/${i}`,
            category: "tech",
            score: 500 - i, // consistently high engagement, refills every request
            publishedAt: "2026-07-05T00:00:00Z"
          })),
        "community"
      )
    );
  }
  // 12 "quiet" sources: signal-less (no score/commentCount at all — mirrors a
  // plain RSS board like clien/etoland/44bits/yozm/outstanding/slashdot/
  // ddanzi/newspeppermint/...) but with just as many items available as the
  // loud sources — the reported bug was never "these sources have nothing to
  // show," clien had plenty; they just never got surfaced because the old
  // scoreFn-only sort always lost to the loud sources' real engagement
  // numbers. A small fixed pool would make "starvation" indistinguishable
  // from ordinary pool exhaustion, so this deliberately matches loud's scale.
  for (let s = 0; s < 12; s++) {
    const id = `quiet${s}`;
    sources.push(
      new JsonSource(
        id,
        async () =>
          Array.from({ length: 30 }, (_, i) => ({
            id: `${id}_${i}`,
            title: `${id} 글 ${i}`,
            url: `https://example.com/${id}/${i}`,
            category: "tech",
            publishedAt: "2026-07-05T00:00:00Z" // no score/commentCount at all — signal-less RSS-style
          })),
        "news"
      )
    );
  }
  const engine = new FeedEngine(store, sources);
  const user = store.createUser("fairness_u");
  store.saveSurvey(user.id, { categories: ["tech"] });

  const shown = [];
  let cursor = 0;
  for (let page = 0; page < 40 && shown.length < 260; page++) {
    const f = await engine.getFeed(user.id, { cursor, limit: 10 });
    cursor = f.nextCursor;
    shown.push(...f.items.map((i) => i.source));
    if (f.exhausted) break;
  }

  assert.ok(shown.length >= 100, `expected to accumulate a large sample, got ${shown.length}`);

  const byCount = new Map();
  for (const src of shown) byCount.set(src, (byCount.get(src) || 0) + 1);

  // every registered active source must appear at least once
  for (const s of sources) {
    assert.ok(byCount.has(s.id), `${s.id} never appeared across ${shown.length} shown items — starved`);
  }

  // no top-8 clique dominates more than 60% of the stream
  const top8Total = [...byCount.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  assert.ok(
    top8Total / shown.length <= 0.6,
    `top 8 sources account for ${Math.round((top8Total / shown.length) * 100)}% of the stream (want <=60%)`
  );
});

test("getFeed home feed hits David's diversity target: first 15 span >=8 sources, no source exceeds 3, and each item is drawn from its own board's top ranks", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const sources = [];
  for (let s = 0; s < 10; s++) {
    const id = `src${s}`;
    // half the sources carry real engagement numbers, half are signal-less
    // (RSS-style) — mirrors the real mix of communities.json adapters.
    const hasSignal = s % 2 === 0;
    sources.push(
      new JsonSource(
        id,
        async () =>
          Array.from({ length: 8 }, (_, i) => ({
            id: `${id}_${i}`,
            title: `${id} 글 ${i}`,
            url: `https://example.com/${id}/${i}`,
            category: "tech",
            ...(hasSignal ? { score: 100 - i * 10 } : {}),
            publishedAt: "2026-07-05T00:00:00Z"
          })),
        "community"
      )
    );
  }
  const engine = new FeedEngine(store, sources);
  const user = store.createUser("diversity_target_u");
  store.saveSurvey(user.id, { categories: ["tech"] });

  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 15 });
  assert.equal(feed.items.length, 15);
  const bySource = new Map();
  for (const i of feed.items) bySource.set(i.source, (bySource.get(i.source) || 0) + 1);
  assert.ok(bySource.size >= 8, `expected >=8 distinct sources in the first 15, got ${bySource.size}`);
  for (const [src, count] of bySource) assert.ok(count <= 3, `${src} appeared ${count} times, exceeding the 3-per-source cap`);
  // every served item must be within its own source's top HOT_PER_SOURCE (6)
  // engagement/collection rank — never something the board itself buried.
  for (const i of feed.items) {
    const idx = Number(i.id.split("_")[1]);
    assert.ok(idx < 6, `${i.id} is ranked ${idx} in its own board — outside the top-6 hot cut`);
  }
});

test("GET /api/feed?source= still bypasses the hot gate entirely (latest+hotness order over the whole source, not a percentile cut)", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const clien = new JsonSource(
    "clien",
    async () => [
      { id: "loud", title: "클리앙 화제글", url: "https://clien.net/a", category: "tech", score: 500, publishedAt: hoursAgoIso(6) },
      { id: "quiet", title: "클리앙 조용한 글", url: "https://clien.net/b", category: "tech", score: 0, publishedAt: hoursAgoIso(6) }
    ],
    "community"
  );
  const server = createServer({ sources: [clien] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const res = await fetch(`${base}/api/feed?userId=${session.userId}&source=clien&limit=10`);
    const feed = await res.json();
    const ids = feed.items.map((i) => i.id);
    assert.ok(ids.includes("loud") && ids.includes("quiet"), "source= view is unaffected by the home feed's hot gate — every item in the source is still reachable");
  } finally {
    server.close();
  }
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
  // David 2026-07-24 적대적 검수 #1: 프로덕션에서 publishedAt이 2001-07-23(9132일
  // 전 — 핀 고정 공지의 실제 작성일 오독 추정)으로 고정되던 오염 사례. 픽스처 자체는
  // 정상 날짜만 담고 있으므로(오탐 재현 불가) 여기서는 실제 파싱 결과가 전부 최근
  // 날짜(오늘 기준 5년 이내, 미래 아님)임을 재확인한다 — sanity 가드가 뚫리지 않는 한
  // 이 값들은 항상 정상 범위여야 한다.
  const now = Date.now();
  const fiveYearsMs = 5 * 365.25 * 8.64e7;
  // 미래 허용치가 필요한 이유 (2026-08-02 실측):
  // 더쿠는 당일 글에 "16:09"처럼 시:분만 표기하고, 파서는 그것을 **오늘 그 시각**
  // 으로 찍는다. 픽스처는 특정 시점에 떠 온 스냅샷이므로, 테스트를 그 시각보다
  // 이른 시간에 돌리면 같은 값이 "미래"가 된다 — 실제로 매일 그 시각 이전 구간에
  // 이 테스트가 실패하고 있었다(고정 결함이 아니라 시각 의존 플레이크).
  // 하루치를 허용해 플레이크를 없애되, 그 이상 미래는 여전히 오염으로 잡는다.
  // 근본 대응은 서버 타임존이다 — deploy/docker-compose.yml의 TZ=Asia/Seoul.
  const oneDayMs = 8.64e7;
  assert.ok(items.every((i) => !i.publishedAt ||
      (Date.parse(i.publishedAt) <= now + oneDayMs && now - Date.parse(i.publishedAt) <= fiveYearsMs)),
    "every parsed date is sane (not far-future, not 5+ years stale)");
});

// David 2026-07-24 적대적 검수 #1: fetchers.js의 날짜 정규화 sanity 가드.
// theqoo 버그의 근본 방어선 — 어떤 파서/마크업 변경이 다른 행의 time 요소를 오탐해도
// 미래이거나 5년 이상 과거인 날짜는 여기서 무조건 null로 걸러져 추천엔진의 freshness()가
// 기본 0.5 가중치로 안전하게 폴백한다(ingest.js freshness: `if (!item.publishedAt) return 0.5`).
test("normalizeListDate: sanity guard nulls out future dates and 5+ year stale dates — the last-resort backstop for a parser reading the wrong element", async () => {
  const { normalizeListDate } = await import("../src/feed/fetchers.js");
  const now = () => Date.parse("2026-07-24T12:00:00Z");

  // the exact production bug: theqoo YY.MM.DD "01.07.23" misread as 2001-07-23
  assert.equal(normalizeListDate("01.07.23", now), null, "9132일 전(2001) 같은 5년+ 과거 날짜는 null");
  assert.equal(normalizeListDate("2001-07-23", now), null, "ISO 형식으로 와도 동일하게 걸러짐");
  assert.equal(normalizeListDate("2019-01-01", now), null, "정확히 5년을 넘는 과거 날짜도 null");
  assert.equal(normalizeListDate("2030-01-01", now), null, "미래 날짜는 null");
  assert.equal(normalizeListDate("2027-01-01", now), null, "가까운 미래도 null (1시간 유예만 허용)");

  // sane dates must still pass through untouched
  assert.equal(normalizeListDate("2026-07-23", now), "2026-07-23T00:00:00.000Z", "정상 최근 날짜는 그대로 통과");
  assert.equal(normalizeListDate("11:30", now), "2026-07-24T02:30:00.000Z", "오늘 HH:MM(로컬 상대시간) 형식도 정상 통과 — sanity 가드에 걸리지 않음");
  const relDay = normalizeListDate("3일", now);
  assert.ok(relDay && Date.parse(relDay) < now(), "상대 날짜(N일 전)도 정상 통과");

  // clock-skew grace: a few minutes into the future must still pass (real
  // relative-time parsing can round slightly ahead of `now()`) — uses the
  // absolute-date parse path (timezone-independent) rather than the local-time
  // HH:MM path, to keep this assertion stable across CI timezones.
  assert.notEqual(
    normalizeListDate("2026-07-24T12:30:00Z", () => Date.parse("2026-07-24T12:00:00Z")),
    null,
    "1시간 이내의 미세한 미래는 유예 범위 내에서 통과"
  );
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
  // 적대적 검수 2026-07-24: robots.txt User-agent:* Disallow:/ 이고 화이트리스트에
  // 없음 — 웃대(humoruniv)와 동일 기준으로 비활성 전환. 파싱 설정 자체는 재활성
  // 대비 보존되므로 parseListPage 회귀 테스트는 그대로 유효.
  assert.equal(entry.enabled, false, "robots Disallow:/ 위반, 웃대와 동일 기준 비활성 2026-07-24");
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

test("parseListPage: 이토랜드 힛게시판 — HTML 행에서 조회·추천·댓글까지 읽는다", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "etoland");
  assert.match(entry.adapter.url, /\/hit\/list$/, "David 2026-07-24: 최신순 일반 게시판(etohumor02) 대신 힛게시판");
  // 2026-08-04: JSON-LD ItemList → HTML 행으로 교체. JSON-LD에는 name/item뿐이라
  // 숫자가 원천적으로 없어 38건 전부 신호 0으로 나갔다. 그 상태로는 화제성
  // 순위에서 커뮤니티가 뉴스에게 구조적으로 진다.
  assert.ok(!entry.adapter.list.urlGroup && !entry.adapter.list.titleGroup,
    "HTML 행 정규식은 url/title이 정상 순서 — JSON-LD 시절의 그룹 스왑이 남으면 뒤집힌다");
  const items = parseListPage(fixture("etoland_hit.html"), entry.adapter.list);
  assert.ok(items.length >= 20);
  assert.ok(items.every((i) => i.url.startsWith("https://etoland.co.kr/hit/")), "HIT board urls (span multiple sub-boards)");
  assert.ok(items.every((i) => i.title && !i.title.startsWith("http")), "title/url groups not swapped");
  assert.ok(items.filter((i) => i.commentCount > 0).length >= items.length - 1, "댓글은 사실상 전 건에 붙는다");
  assert.ok(items.filter((i) => i.score > 0).length >= items.length - 2, "추천도 전 건에 붙는다(<span>추천 <!-- -->N</span>)");
});

test("parseListPage: 네이트판 톡커들의 선택 — title attribute + recommend/reply counts", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "pann");
  // 적대적 검수 2026-07-24: robots.txt User-agent:* Disallow:/ 이고 화이트리스트에
  // 없음 — 웃대(humoruniv)와 동일 기준으로 비활성 전환. 파싱 설정 자체는 재활성
  // 대비 보존되므로 parseListPage 회귀 테스트는 그대로 유효.
  assert.equal(entry.enabled, false, "robots Disallow:/ 위반, 웃대와 동일 기준 비활성 2026-07-24");
  assert.match(entry.adapter.note, /robots/);
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

// 2026-08-07 파서 감사: ruliweb-deal의 titleRegex가 옛 마크업
// (class="subject text_over")을 찾고 있었는데 실제 페이지는
// class="subject_link deco"로 바뀌어 실측 0건이었다(이전 감사가 제안한
// 수정안도 픽스처 실행 검증 없이 나와 0건으로 반려됨 — 채택 전 반드시
// 픽스처에 실행해 매치 수를 확인해야 한다는 이 저장소 규칙의 근거).
// 아래 두 테스트는 test/fixtures/ruliweb_deal.html(NowHotBot/1.0 UA로
// 2026-08-07 1회 수집, robots.txt가 /market/board를 막지 않음을 먼저 확인)
// 을 기준으로 복구한 정규식을 검증한다.
test("parseListPage: 루리웹 핫딜예판 — 마크업 변경(subject text_over → subject_link deco)으로 0건이던 titleRegex 복구, 공지 제외 + 추천/댓글수 수집", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "ruliweb-deal");
  assert.equal(entry.adapter.type, "list");
  const html = fixture("ruliweb_deal.html");

  // 실측(2026-08-07): 게시판 행 35개 중 titleRegex가 잡는 것은 34행 —
  // 안 잡히는 1행은 다른 게시판(/etcs/board/10)으로 가는 상단 고정
  // "전체공지"라 URL 패턴(market/board/1020/read/\d+)상 애초에 매치되지
  // 않는다. 거기서 excludeRegex(class="table_body notice...")로 광고성
  // 공지 2행("루리웹 핫딜/예판 유저게시판 통합 공지", "[알리익스프레스]
  // 할인에 파도타기")을 더 빼면 유효 딜은 32/35행 — adapter.list.max(25)가
  // 그중 25건으로 자른다.
  const items = parseListPage(html, entry.adapter.list);
  assert.equal(items.length, 25, "유효 딜 32/35행 중 max:25 cap → 25건 (실측)");
  assert.ok(
    items.every((i) => /^https:\/\/bbs\.ruliweb\.com\/market\/board\/1020\/read\/\d+$/.test(i.url)),
    "urls resolve to this board's read pages only, trailing '?' 제외"
  );
  assert.ok(items.every((i) => !i.title.includes("통합 공지")), "상단 고정 공지 제외");
  assert.ok(items.every((i) => !i.title.includes("할인에 파도타기")), "광고성 안내 공지 행 제외");
  assert.ok(items.every((i) => !("summary" in i) && !("body" in i)), "no body/excerpt collected");

  // 추천수(score)·댓글수(commentCount) 수집. 25건 전부 recomd 셀을 갖고
  // 있어 score는 전건 채워지고, num_reply 태그 자체가 없는(댓글 0건) 행만
  // commentCount가 비어 있다 — 실측 23/25건(아래 별도 테스트가 그 2건이
  // 옆 행 값을 훔쳐온 오염이 아님을 확인한다).
  assert.equal(items.filter((i) => "score" in i).length, 25, "추천수 25/25건 수집 (실측)");
  assert.ok(items.some((i) => i.score > 0), "추천수 > 0인 행 존재");
  assert.equal(items.filter((i) => "commentCount" in i).length, 23, "댓글수 23/25건 수집 (실측)");
  assert.ok(items.some((i) => i.commentCount > 0), "댓글수 > 0인 행 존재");
});

test("parseListPage: 루리웹 핫딜예판 — 댓글 0건(자체 num_reply 태그 없음)인 행이 windowAfter 튜닝 덕에 다음 행의 댓글수를 훔쳐오지 않는다", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "ruliweb-deal");
  const items = parseListPage(fixture("ruliweb_deal.html"), entry.adapter.list);
  // 실측: id 106207([예판런]닌텐도 스위치 2...), 106192([알리] UPERFECT...)
  // 는 페이지에 자체 num_reply 태그가 없는(댓글 0건) 행이다. windowAfter가
  // 900~1300 사이(현재 1000)를 벗어나 더 넓으면 다음 행의 num_reply(오프셋
  // 1335/1453 — 900보다 한참 뒤)를 주워 옆 행 댓글수가 이 행 것처럼 찍힌다.
  const noOwnComment = items.filter((i) => /\/(106207|106192)$/.test(i.url));
  assert.equal(noOwnComment.length, 2, "fixture assumption: 댓글 0건 행 2개가 실제로 파싱 대상에 포함됨 (실측)");
  assert.ok(noOwnComment.every((i) => !("commentCount" in i)), "댓글 0건 행은 옆 행 댓글수를 가져오지 않는다");
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
  // 2026-08-04: UA가 죽은 주소(taste-feed.onrender.com)를 가리키고 있었다.
  // 사이트 운영자가 로그를 보고 문의·차단 요청을 할 수 있어야 "선의의 크롤러"라는
  // 사실관계가 성립한다 — 연락 경로가 끊긴 신원은 방어 근거가 되지 못한다.
  assert.match(calledWith.ua, /^nowhot-bot\/1\.0/, "식별 가능한 UA가 필요하다");
  assert.match(calledWith.ua, /\+https:\/\/nowhot\.kr\//, "UA의 연락 주소가 살아 있어야 한다");
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
      { title: "클리앙 글 A", url: "https://clien.net/a", category: "tech", score: 1, publishedAt: hoursAgoIso(9) },
      { title: "클리앙 글 B", url: "https://clien.net/b", category: "tech", score: 50, publishedAt: hoursAgoIso(1) }
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

// David 2026-07-24 적대적 검수 #5: "죽은 소스 칩 자동 숨김" — enabled=true인 소스가
// 프로덕션에서 꾸준히 0건이어도(todayhumor의 해외IP 차단처럼 enabled는 유지해야 하는
// 경우) 소스칩에서는 빠져야 클릭 시 빈 화면을 보는 당황을 막는다. 서버는 각 소스의
// 현재 풀 내 아이템 수(liveCount)를 함께 내려주고, 실제 숨김 판단은 프론트(index.html
// boot())가 한다 — 여기서는 그 판단의 근거가 되는 데이터 계약만 검증한다.
test("GET /api/communities reports each source's current pool item count (liveCount) so the client can hide dead-source chips", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const withItems = new JsonSource(
    "clien",
    async () => [
      { id: "c1", title: "글1", url: "https://clien.net/1", category: "tech", publishedAt: "2026-07-05T00:00:00Z" },
      { id: "c2", title: "글2", url: "https://clien.net/2", category: "tech", publishedAt: "2026-07-05T00:00:00Z" }
    ],
    "community"
  );
  const empty = new JsonSource("theqoo", async () => [], "community");
  const server = createServer({ sources: [withItems, empty] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/communities`);
    const body = await res.json();
    const clien = body.communities.find((c) => c.id === "clien");
    const theqoo = body.communities.find((c) => c.id === "theqoo");
    const untouched = body.communities.find((c) => c.id === "ppomppu"); // no source wired for it at all in this test
    assert.equal(clien.liveCount, 2, "counts items actually in the current pool");
    assert.equal(theqoo.liveCount, 0, "a wired source that yields nothing reports 0, not undefined");
    assert.equal(untouched.liveCount, 0, "a registry entry with no matching source at all also reports 0");
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


test("classifyTopics: board-slug rules tag etoland 시사(sisabbs)/익명(anony) HIT-ranking items by their own url", async () => {
  const { classifyTopics } = await import("../src/feed/topics.js");
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/sisabbs01/view/12345", sourceId: "etoland" }),
    ["politics"]
  );
  assert.deepEqual(
    classifyTopics({ title: "그냥 일상 잡담", url: "https://etoland.co.kr/hit/anony3/view/12345", sourceId: "etoland" }),
    []
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

test("성인 콘텐츠를 켜는 방법이 아예 없다 (애드핏 2차 보류 사유)", async () => {
  // 애드핏 보류 사유의 두 번째가 성인 콘텐츠였다. 참고 이미지의 빨간 네모는
  // 게시물이 아니라 메뉴의 "성인 콘텐츠(19금) 보기" 토글 자체였다.
  // 화면 토글은 걷어냈지만 경로가 살아 있었다 — 라이브에서 확인했다:
  //   POST /api/verify-age {confirmAdult:true} → {"ok":true,"ageVerified":true}
  //   POST /api/adult      {on:true}           → {"ok":true,"showAdult":true}
  // 체크박스 하나로 통과하는 모의 인증이라 청소년보호 요건을 만족한다고
  // 말할 수 없었다. 글은 그대로 두고(태그 후 가림) 가림을 푸는 방법만 없앴다.
  const { createServer } = await import("../src/feed/server.js");
  const source = { id: "clien", kind: "community", async fetch() { return []; } };
  const server = createServer({ sources: [source] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const s = await (await fetch(`${base}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    })).json();

    // 두 경로 모두 사라졌다
    for (const path of ["/api/verify-age", "/api/adult"]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: s.userId, confirmAdult: true, on: true })
      });
      assert.equal(res.status, 404, `${path} 가 아직 응답한다`);
    }

    // 토픽 경로로도 못 켠다. 다른 모르는 토픽과 **같은** 응답이어야 한다 —
    // 여기만 특별한 오류를 주면 켜는 방법이 어딘가 있다는 뜻이 된다.
    const viaTopic = await fetch(`${base}/api/topics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: s.userId, topic: "adult", on: true })
    });
    assert.equal(viaTopic.status, 400);
    const unknown = await fetch(`${base}/api/topics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: s.userId, topic: "무엇이든", on: true })
    });
    assert.equal((await viaTopic.json()).error, (await unknown.json()).error);

    // 상태가 실제로 안 바뀌었다
    const me = await (await fetch(`${base}/api/me?userId=${s.userId}`)).json();
    assert.notEqual(me.showAdult, true);
  } finally { server.close(); }
});

test("GET /api/config exposes the topic catalog for the UI toggles", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: [] });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const res = await (await fetch(`http://localhost:${server.address().port}/api/config`)).json();
    const ids = res.topics.map((t) => t.id).sort();
    // 계약 변경 2026-08-04: "adult"를 카탈로그에서 뺐다. 애드핏 심사자가 보류
    // 근거로 지목한 것이 게시글이 아니라 "성인 콘텐츠(19금) 보기" 토글 UI
    // 한 줄이었다(참고 이미지 i.imgur.com/tz7vGUc.png). 실측상 그 시점 라이브
    // 피드 160건 중 성인 태그는 0건 — 삭제할 콘텐츠 없이 UI만 비용을 치렀다.
    // 카탈로그에서 빼면 API에도 UI에도 "성인" 항목이 나타나지 않는다.
    assert.deepEqual(ids, ["politics", "religion"]);
    assert.ok(!ids.includes("adult"), "성인 토글이 되살아났다");
    assert.ok(res.topics.every((t) => t.defaultVisible === false), "둘 다 기본 숨김");
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

test("parseListPage: Tildes 베스트(order=votes&period=7d) — internal (relative /~group/id/slug) and external (absolute) links both resolve correctly, votes/comments never bleed across articles", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "tildes");
  assert.equal(entry.adapter.type, "list");
  assert.equal(entry.lang, "en", "overseas source flows through the translation pipeline");
  // 적대적 검수 2026-07-24: period=all(전체기간 고정 명예의전당)은 화제글이 아니라
  // 옛 글/운영 공지만 반복 노출됐음 — period=7d(최근 7일 득표순)로 교체. Tildes의
  // period는 named bucket이 아니라 실측 폼 값(1h/12h/24h/3d/7d/all)만 허용하고
  // period=week/day는 422로 거부됨(2026-07-24 실측 확인) — 반드시 7d여야 한다.
  assert.match(entry.adapter.url, /period=7d/, "period=all의 고정 명예의전당 대신 최근 7일 화제글 정렬로 교체됨 (period=week는 사이트가 422로 거부)");
  const items = parseListPage(fixture("tildes_votes.html"), entry.adapter.list);
  assert.ok(items.length >= 20, `expected many topics, got ${items.length}`);
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
  // ~tildes / ~tildes.official is the site's own meta/announcement group
  // ("질문하세요"류 고정 안내글 포함) — never a real "화제글", must be excluded
  assert.ok(
    items.every((i) => !/tildes\.net\/~tildes(?:\.official)?\//.test(i.url)),
    "~tildes/~tildes.official meta/announcement topics excluded"
  );
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

// --- googleFreeTranslator (src/feed/translator.js) -------------------------
// All tests below run with a mocked fetchImpl — no real network access.

test("googleFreeTranslator: parses a normal gtx response and hits the expected URL", async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      async json() {
        // real shape: data[0] is a list of [translatedChunk, originalChunk, ...] tuples
        return [[["안녕 세상", "Hello world", null, null, 1]], null, "en"];
      }
    };
  };
  const translate = googleFreeTranslator({ fetchImpl });
  const out = await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(out, "안녕 세상");
  assert.match(calledUrl, /^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/);
  assert.match(calledUrl, /sl=en/);
  assert.match(calledUrl, /tl=ko/);
  assert.match(calledUrl, /dt=t/);
  assert.match(calledUrl, /q=Hello(%20|\+)world/);
});

test("googleFreeTranslator: joins multiple response chunks (long input split by Google)", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return [[["첫 문장. ", null], ["둘째 문장.", null]], null, "en"];
    }
  });
  const translate = googleFreeTranslator({ fetchImpl });
  const out = await translate("First sentence. Second sentence.", { from: "en", to: "ko" });
  assert.equal(out, "첫 문장. 둘째 문장.");
});

test("googleFreeTranslator: falls back to the original text on a non-200 response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, async json() { return null; } });
  const translate = googleFreeTranslator({ fetchImpl });
  const out = await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(out, "Hello world");
});

test("googleFreeTranslator: falls back to the original text on a network error (never throws)", async () => {
  const fetchImpl = async () => { throw new Error("ECONNRESET"); };
  const translate = googleFreeTranslator({ fetchImpl });
  const out = await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(out, "Hello world");
});

test("googleFreeTranslator: falls back to the original text on timeout (AbortSignal fires -> fetch rejects with AbortError)", async () => {
  // AbortSignal.timeout's internal timer is unref'd, so actually waiting for
  // a real one to fire in an otherwise-idle test can race the test runner's
  // own event loop bookkeeping. Simulate what a real timeout produces instead
  // (fetch rejecting with a DOMException named "AbortError") — the code path
  // exercised (a blanket catch -> fall back to the original text) is identical.
  const fetchImpl = async () => { throw new DOMException("The operation was aborted", "AbortError"); };
  const translate = googleFreeTranslator({ fetchImpl, timeoutMs: 5 });
  const out = await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(out, "Hello world");
});

test("googleFreeTranslator: falls back to the original text on an unexpected JSON shape", async () => {
  const fetchImpl = async () => ({ ok: true, async json() { return { error: "unexpected" }; } });
  const translate = googleFreeTranslator({ fetchImpl });
  const out = await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(out, "Hello world");
});

test("googleFreeTranslator: empty/falsy input passes through untouched, no fetch call", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, async json() { return [[["x"]]]; } }; };
  const translate = googleFreeTranslator({ fetchImpl });
  assert.equal(await translate("", { from: "en", to: "ko" }), "");
  assert.equal(await translate(null, { from: "en", to: "ko" }), null);
  assert.equal(called, false);
});

test("googleFreeTranslator + memoizedTranslator: identical text is only fetched once", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, async json() { return [[["번역됨"]]]; } };
  };
  const translate = memoizedTranslator(googleFreeTranslator({ fetchImpl }));
  await translate("Hello world", { from: "en", to: "ko" });
  await translate("Hello world", { from: "en", to: "ko" });
  await translate("Hello world", { from: "en", to: "ko" });
  assert.equal(calls, 1, "second/third call served from memoizedTranslator's cache");
});

test("TranslatingSource wired with googleFreeTranslator translates an en item end to end (mocked network)", async () => {
  const foreign = {
    id: "hackernews", kind: "community", async fetch() {
      return [{ id: "hn1", title: "Show HN: a new database", summary: "we built a fast db", lang: "en", category: "tech", tags: [], source: "hackernews" }];
    }
  };
  const fetchImpl = async (url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q"));
    const table = {
      "Show HN: a new database": "Show HN: 새로운 데이터베이스",
      "we built a fast db": "빠른 db를 만들었습니다"
    };
    return { ok: true, async json() { return [[[table[q] || q, q, null, null, 1]]]; } };
  };
  const translateFn = memoizedTranslator(googleFreeTranslator({ fetchImpl }));
  const out = await new TranslatingSource(foreign, translateFn, "ko").fetch();
  assert.equal(out[0].translated, true);
  assert.equal(out[0].lang, "ko");
  assert.equal(out[0].title, "Show HN: 새로운 데이터베이스");
  assert.equal(out[0].summary, "빠른 db를 만들었습니다");
  assert.equal(out[0].originalTitle, "Show HN: a new database");
  assert.equal(out[0].originalLang, "en");
});

test("createServer: opts.translate wiring flows through buildSources to the served feed", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const registry = loadRegistry();
  const enEntry = registry.find((c) => c.enabled && c.lang === "en");
  assert.ok(enEntry, "fixture assumption: an enabled overseas (en) source exists in communities.json");

  // opts.fetcher stands in for FEED_LIVE's makeFetcher — only the target
  // source yields an item, every other registry entry yields nothing so the
  // feed stays small and deterministic.
  const fetcher = (entry) => async () =>
    entry.id === enEntry.id ? [{ title: "Hello world", summary: "a translation test post" }] : [];

  const server = createServer({
    dev: false,
    fetcher,
    translate: { targetLang: "ko", translateFn: memoizedTranslator(async (t) => `[번역] ${t}`) }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const feed = await (
      await fetch(`${base}/api/feed?userId=${session.userId}&source=${enEntry.id}&cursor=0&limit=20`)
    ).json();
    const item = feed.items.find((i) => i.source === enEntry.id);
    assert.ok(item, `an item from ${enEntry.id} is present in the feed`);
    assert.equal(item.translated, true);
    assert.match(item.title, /^\[번역\]/);
  } finally {
    server.close();
  }
});

// opts.translate === undefined (not passed at all) means "let FEED_TRANSLATE decide" —
// with the env var unset in the test run, this must behave exactly like today: items
// pass through untouched and flagged needsTranslation, never silently translated.
test("createServer: without FEED_TRANSLATE (env unset) and no opts.translate, overseas items stay untranslated", async () => {
  assert.equal(process.env.FEED_TRANSLATE, undefined, "test assumption: FEED_TRANSLATE is unset in this run");
  const { createServer } = await import("../src/feed/server.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const registry = loadRegistry();
  const enEntry = registry.find((c) => c.enabled && c.lang === "en");
  assert.ok(enEntry, "fixture assumption: an enabled overseas (en) source exists in communities.json");

  const fetcher = (entry) => async () =>
    entry.id === enEntry.id ? [{ title: "Hello world", summary: "a translation test post" }] : [];

  const server = createServer({ dev: false, fetcher }); // no opts.translate at all
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    const session = await (
      await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ).json();
    const feed = await (
      await fetch(`${base}/api/feed?userId=${session.userId}&source=${enEntry.id}&cursor=0&limit=20`)
    ).json();
    const item = feed.items.find((i) => i.source === enEntry.id);
    assert.ok(item, `an item from ${enEntry.id} is present in the feed`);
    assert.equal(item.translated, false);
    assert.equal(item.needsTranslation, true);
    assert.equal(item.title, "Hello world");
  } finally {
    server.close();
  }
});

// ---- Thumbnail images (David 2026-07-26) -----------------------------------
// docs/legal.md: 원본 서버 URL을 핫링크만 — 절대 우리 서버에 받거나 저장하지
// 않는다. RSS는 그 항목이 이미 실어 온 media:thumbnail/media:content/
// enclosure(image)/description 내 첫 <img>에서 뽑고, list 어댑터는 이미
// 받아온 리스트 HTML의 각 행에서 (커뮤니티별 thumbRegex로) 뽑는다 — 둘 다
// 추가 네트워크 요청이 없다.

test("parseRss: extracts the item's own image — media:thumbnail wins first", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const rss = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>썸네일1</title><link>https://x/1</link>
      <media:thumbnail url="https://img.example.com/t1.jpg"/>
      <media:content url="https://img.example.com/should-not-win.jpg" type="image/jpeg"/>
    </item>
  </channel></rss>`;
  const items = parseRss(rss);
  assert.equal(items[0].image, "https://img.example.com/t1.jpg", "media:thumbnail is checked before media:content");
});

test("parseRss: media:content only counts as an image when explicitly typed/medium=image or genuinely untyped — never a typed video/audio", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const typedImage = parseRss(
    `<rss xmlns:media="x"><channel><item><title>a</title><link>https://x/1</link><media:content url="https://img.example.com/a.jpg" type="image/jpeg"/></item></channel></rss>`
  )[0];
  assert.equal(typedImage.image, "https://img.example.com/a.jpg");

  const mediumImage = parseRss(
    `<rss xmlns:media="x"><channel><item><title>b</title><link>https://x/2</link><media:content url="https://img.example.com/b.jpg" medium="image"/></item></channel></rss>`
  )[0];
  assert.equal(mediumImage.image, "https://img.example.com/b.jpg", "medium=\"image\" (no type attr) also counts");

  const untyped = parseRss(
    `<rss xmlns:media="x"><channel><item><title>c</title><link>https://x/3</link><media:content url="https://img.example.com/c.jpg"/></item></channel></rss>`
  )[0];
  assert.equal(untyped.image, "https://img.example.com/c.jpg", "genuinely untyped media:content is trusted as an image");

  const typedVideo = parseRss(
    `<rss xmlns:media="x"><channel><item><title>d</title><link>https://x/4</link><media:content url="https://vid.example.com/d.mp4" type="video/mp4"/></item></channel></rss>`
  )[0];
  assert.equal(typedVideo.image, null, "an explicitly video-typed media:content must never surface as image");
});

test("parseRss: enclosure only counts as an image with an explicit image/* type — a podcast's audio/mpeg enclosure must never leak through as a thumbnail", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const imageEnclosure = parseRss(
    `<rss><channel><item><title>a</title><link>https://x/1</link><enclosure url="https://img.example.com/a.jpg" type="image/jpeg" length="1"/></item></channel></rss>`
  )[0];
  assert.equal(imageEnclosure.image, "https://img.example.com/a.jpg");

  // real-world case: slownews.kr's RSS <enclosure> is the episode mp3, not a thumbnail
  const audioEnclosure = parseRss(
    `<rss><channel><item><title>팟캐스트 에피소드</title><link>https://slownews.kr/1</link><enclosure url="https://slownews.kr/ep.mp3" type="audio/mpeg" length="12345"/></item></channel></rss>`
  )[0];
  assert.equal(audioEnclosure.image, null, "an audio enclosure must never be treated as a thumbnail image");

  const untypedEnclosure = parseRss(
    `<rss><channel><item><title>b</title><link>https://x/2</link><enclosure url="https://x.example.com/b.bin"/></item></channel></rss>`
  )[0];
  assert.equal(untypedEnclosure.image, null, "unlike media:content, an untyped enclosure is NOT trusted as an image (enclosure type is normally mandatory)");
});

test("parseRss: falls back to the first <img src> inside the item's own description/content HTML — real clien/ruliweb/WordPress-feed shape", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  // clien-style: feedburner RSS, real post image embedded directly in <description>
  const clienStyle = parseRss(
    `<rss><channel><item><title>글</title><link>https://www.clien.net/service/board/park/1</link>` +
      `<description>&lt;body&gt;&lt;img alt="x.jpg" class="fr-dib" src="https://edgio.clien.net/F01/2026/x.jpg?scale=width:740"/&gt;본문&lt;/body&gt;</description>` +
      `</item></channel></rss>`
  )[0];
  assert.equal(clienStyle.image, "https://edgio.clien.net/F01/2026/x.jpg?scale=width:740");
  assert.equal(clienStyle.summary, "본문", "the <img> tag itself never leaks into the plain-text summary");

  // WordPress content:encoded shape (slownews/ddanzi/yozm/outstanding pattern):
  // description has no image, content:encoded (used as Atom-style fallback via
  // the same tag() lookup path) does.
  const wpStyle = parseRss(
    `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>포스트</title><link href="https://slownews.kr/1"/>` +
      `<content type="html"><![CDATA[<p>인트로</p><img decoding="async" src="https://slownews.kr/wp-content/uploads/x.jpg" alt="" width="1000"/>]]></content>` +
      `</entry></feed>`
  )[0];
  assert.equal(wpStyle.image, "https://slownews.kr/wp-content/uploads/x.jpg");
});

test("parseRss: RSS 2.0 <content:encoded> (WordPress full body) is checked as an image fallback when <description> has none — real slownews.kr shape (description is just an excerpt + \"appeared first on\" boilerplate, no image; content:encoded has the featured image)", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const item = parseRss(
    `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>기사</title><link>https://slownews.kr/1</link>` +
      `<description><![CDATA[<p>발췌 텍스트</p><p>The post <a href="https://slownews.kr/1">기사</a> appeared first on <a href="https://slownews.kr">슬로우뉴스</a>.</p>]]></description>` +
      `<content:encoded><![CDATA[<div><h5>부제목</h5><img fetchpriority="high" width="1000" src="https://slownews.kr/wp-content/uploads/2026/07/x.jpg" alt=""/></div>]]></content:encoded>` +
      `</item></channel></rss>`
  )[0];
  assert.equal(item.image, "https://slownews.kr/wp-content/uploads/2026/07/x.jpg");
  assert.equal(item.summary, "발췌 텍스트 The post 기사 appeared first on 슬로우뉴스 .", "summary still comes only from <description> — content:encoded is read for image fallback only, never mixed into the excerpt");
});

test("parseRss: no image anywhere in the item (gnews/geeknews shape) yields image: null, never a guess", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const item = parseRss(
    `<rss><channel><item><title>제목만 있는 기사</title><link>https://news.google.com/rss/articles/x</link>` +
      `<description>&lt;ol&gt;&lt;li&gt;관련기사 링크만, 이미지 없음&lt;/li&gt;&lt;/ol&gt;</description></item></channel></rss>`
  )[0];
  assert.equal(item.image, null);
});

test("parseRss: a protocol-relative image URL (//cdn...) is resolved to https, and a relative path resolves against the item's own link origin", async () => {
  const { parseRss } = await import("../src/feed/fetchers.js");
  const protoRelative = parseRss(
    `<rss xmlns:media="x"><channel><item><title>a</title><link>https://x/1</link><media:thumbnail url="//img.example.com/a.jpg"/></item></channel></rss>`
  )[0];
  assert.equal(protoRelative.image, "https://img.example.com/a.jpg");

  const relativePath = parseRss(
    `<rss xmlns:media="x"><channel><item><title>b</title><link>https://news.example.co.kr/read/1</link><media:thumbnail url="/img/b.jpg"/></item></channel></rss>`
  )[0];
  assert.equal(relativePath.image, "https://news.example.co.kr/img/b.jpg", "resolved against the item's own link origin, since RSS has no adapter.list.urlBase");
});

test("parseListPage: 네이트판 톡커들의 선택 — thumbRegex pulls each row's OWN thumbnail without bleeding into neighboring rows lacking one", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const entry = loadRegistry().find((c) => c.id === "pann");
  assert.equal(entry.adapter.list.thumbIn, "before", "pann's thumbnail <img> renders just before the title <a>, not after");
  const items = parseListPage(fixture("pann_talk_ranking.html"), entry.adapter.list);
  assert.ok(items.length >= 20);
  const withImage = items.filter((i) => i.image);
  const withoutImage = items.filter((i) => !i.image);
  assert.ok(withImage.length > 5, `expected several rows to carry their own thumbnail, got ${withImage.length}`);
  assert.ok(withoutImage.length > 5, "text-only rows (no thumbnail in the list HTML) must not fabricate an image");
  assert.ok(withImage.every((i) => i.image.startsWith("https://thumb.pann.com/")), "every extracted image is pann's own thumbnail CDN, not a stray/neighboring URL");
  // every image must be unique to its own row — a windowBefore wide enough to
  // reach into a neighboring row's <img> would produce duplicate image URLs
  // across different posts
  const urls = withImage.map((i) => i.image);
  assert.equal(new Set(urls).size, urls.length, "no two different posts ever share the exact same thumbnail URL (no cross-row bleed)");
});

test("parseListPage: sources without a real per-post thumbnail in their list HTML (only file-type/HOT badge icons) intentionally carry no thumbRegex — image stays absent, not a guessed badge icon", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const registry = loadRegistry();
  for (const id of ["bobae", "ppomppu", "theqoo", "etoland", "todayhumor", "inven_hot"]) {
    const entry = registry.find((c) => c.id === id);
    assert.ok(entry, `expected a communities.json entry for ${id}`);
    assert.equal(entry.adapter.list.thumbRegex, undefined, `${id}'s list page has no real per-post thumbnail (verified against its fixture 2026-07-26) — must not have a thumbRegex that would pick up a badge icon instead`);
  }
});

test("normalizeItem: image URL normalization — relative path resolves against urlBase, protocol-relative becomes https, plain http upgrades only when httpsOk, and anything unresolvable/unsafe drops to null", async () => {
  const { normalizeItem } = await import("../src/feed/content.js");

  // already absolute + httpsOk true source with a plain http:// link -> upgraded, same policy as `url`
  const httpUpgraded = normalizeItem({ title: "a", url: "https://x/1", image: "http://img.example.com/a.jpg", httpsOk: true }, { id: "src" });
  assert.equal(httpUpgraded.image, "https://img.example.com/a.jpg");

  // httpsOk not confirmed for this source -> left alone rather than guessed
  const httpKept = normalizeItem({ title: "b", url: "https://x/2", image: "http://img.example.com/b.jpg" }, { id: "src" });
  assert.equal(httpKept.image, "http://img.example.com/b.jpg");

  // protocol-relative -> always https, regardless of httpsOk (matches fetchers.js's own resolveUrl behavior)
  const protoRelative = normalizeItem({ title: "c", url: "https://x/3", image: "//img.example.com/c.jpg" }, { id: "src" });
  assert.equal(protoRelative.image, "https://img.example.com/c.jpg");

  // a bare relative path with no urlBase resolution already done upstream is
  // not a usable src — drop it rather than ship a broken <img>
  const unresolvable = normalizeItem({ title: "d", url: "https://x/4", image: "/img/d.jpg" }, { id: "src" });
  assert.equal(unresolvable.image, null);

  // no image at all -> null, never fabricated
  const none = normalizeItem({ title: "e", url: "https://x/5" }, { id: "src" });
  assert.equal(none.image, null);

  // a non-http(s) scheme must never reach the client's <img src>
  const unsafe = normalizeItem({ title: "f", url: "https://x/6", image: "javascript:alert(1)" }, { id: "src" });
  assert.equal(unsafe.image, null);
});

test("parseOpenGraph: og:image resolves relative and protocol-relative paths against the submitted page's own URL", async () => {
  const { parseOpenGraph } = await import("../src/feed/ingest.js");
  const relative = parseOpenGraph(
    `<meta property="og:title" content="글"><meta property="og:image" content="/assets/thumb.jpg">`,
    "https://www.bobae.co.kr/view/123"
  );
  assert.equal(relative.image, "https://www.bobae.co.kr/assets/thumb.jpg");

  const protoRelative = parseOpenGraph(
    `<meta property="og:title" content="글"><meta property="og:image" content="//cdn.bobae.co.kr/thumb.jpg">`,
    "https://www.bobae.co.kr/view/123"
  );
  assert.equal(protoRelative.image, "https://cdn.bobae.co.kr/thumb.jpg");

  const noImage = parseOpenGraph(`<meta property="og:title" content="글">`, "https://www.bobae.co.kr/view/123");
  assert.equal(noImage.image, null);
});

test("getFeed: every organic response item carries a string editorialNote (possibly empty), and a genuinely hot item gets a non-empty one", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const hot = new JsonSource(
    "hn-like",
    async () => [
      {
        id: "hot-1",
        title: "화제글",
        url: "https://example.com/hot-1",
        category: "tech",
        score: 5000,
        commentCount: 200,
        publishedAt: "2026-07-05T22:00:00Z" // 2h before fixedClock's 2026-07-06T00:00:00Z
      },
      {
        id: "quiet-1",
        title: "평범한 글",
        url: "https://example.com/quiet-1",
        category: "tech"
        // no score/commentCount/publishedAt at all -> nothing to say honestly
      }
    ],
    "community"
  );
  const engine = new FeedEngine(store, [hot]);
  const user = store.createUser("editorial_wiring_u");
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 10 });

  assert.ok(feed.items.length >= 2);
  for (const item of feed.items) {
    assert.equal(typeof item.editorialNote, "string", `${item.id} should have a string editorialNote field`);
  }
  const hotItem = feed.items.find((i) => i.id === "hot-1");
  const quietItem = feed.items.find((i) => i.id === "quiet-1");
  assert.ok(hotItem, "expected the hot item to survive filtering/ranking");
  assert.notEqual(hotItem.editorialNote, "", "a huge fresh score/commentCount should produce a non-empty note");
  assert.match(hotItem.editorialNote, /5,000|5000/);
  if (quietItem) assert.equal(quietItem.editorialNote, "", "an item with no measurable signal gets an honest empty note, not filler");
});

test("getFeed: source= (board view) items also carry editorialNote — same _decorate path as the home feed", async () => {
  const store = new FeedStore({ clock: fixedClock });
  const src = new JsonSource(
    "board1",
    async () => [
      { id: "b1", title: "1위 글", url: "https://example.com/b1", category: "tech", sourceRank: 0, score: 10, commentCount: 2, publishedAt: "2026-07-05T20:00:00Z" }
    ],
    "community"
  );
  const engine = new FeedEngine(store, [src]);
  const user = store.createUser("editorial_source_view_u");
  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 10, source: "board1" });
  assert.equal(feed.items.length, 1);
  // 1위 + 실측 지표(추천 10·댓글 2)가 함께 있을 때의 문구
  assert.equal(feed.items[0].editorialNote, "board1 지금 1위 — 추천 10·댓글 2");
});

test("getFeed: affiliate/ad slot items never get a populated editorialNote, even with AD_PREVIEW=1 and a learned taste that guarantees slots", async () => {
  const prevPartner = process.env.COUPANG_PARTNER_ID;
  const prevPreview = process.env.AD_PREVIEW;
  delete process.env.COUPANG_PARTNER_ID;
  process.env.AD_PREVIEW = "1";
  try {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("editorial_ad_u");
    // strong "tech" preference so pickAffiliateCandidates has something to match.
    // 2026-08-02부터 좋아요는 그 글에 대한 의견이고 카테고리는 일부만 받는다
    // (recommender.CATEGORY_STEP_RATIO) — "강한 취향"을 만들려면 반복이 더 필요하다.
    for (let i = 0; i < 32; i++) {
      applyFeedback(user.preferences, { category: "tech", tags: [], source: "clien", length: 200 }, 1);
    }
    const feed = await engine.getFeed(user.id, { cursor: 0, limit: 20 });
    const adItems = feed.items.filter((i) => i.kind === "affiliate");
    assert.ok(adItems.length > 0, "expected at least one preview affiliate slot for this test to be meaningful");
    for (const a of adItems) {
      assert.ok(
        a.editorialNote === undefined || a.editorialNote === "",
        `affiliate item ${a.id} must not have a populated editorialNote, got "${a.editorialNote}"`
      );
    }
    // and organic items around the ad slots DO still get the field
    const organicItems = feed.items.filter((i) => i.kind !== "affiliate");
    assert.ok(organicItems.every((i) => typeof i.editorialNote === "string"));
  } finally {
    if (prevPartner == null) delete process.env.COUPANG_PARTNER_ID; else process.env.COUPANG_PARTNER_ID = prevPartner;
    if (prevPreview == null) delete process.env.AD_PREVIEW; else process.env.AD_PREVIEW = prevPreview;
  }
});

test("public/index.html: editorialNote renders as a distinct .editorial-note line (not a .why chip), only when non-empty, and is HTML-escaped", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /\.editorial-note\s*\{/, "expected a dedicated .editorial-note CSS rule");

  const appendCardFn = html.match(/function appendCard\(item\)\{[\s\S]*?\n\}/)[0];
  assert.match(
    appendCardFn,
    /\$\{item\.editorialNote\?`<div class="editorial-note">\$\{escapeHtml\(item\.editorialNote\)\}<\/div>`:''\}/,
    "editorialNote must render only when truthy, escaped, in its own .editorial-note element"
  );

  // must never be rendered on the ad-card path — that has its own separate
  // reason/disclosure UI (.ad-why / .ad-disclosure-pop)
  const appendAdCardFn = html.match(/function appendAdCard\(item\)\{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(appendAdCardFn, /editorial-note/, "ad cards must not render editorialNote");
});

// --- 트래픽 실측 (David 2026-08-01 "트래픽 어디서 확인함?") ----------------
test("트래픽 카운터: 일별 pv/feed/고유방문자를 세고 admin API로 조회된다", async () => {
  const store = new FeedStore({ clock: fixedClock });
  store.recordTraffic("page");
  store.recordTraffic("page");
  store.recordTraffic("feed", "u1");
  store.recordTraffic("feed", "u1"); // 같은 유저 재방문 -> visitors는 1
  store.recordTraffic("feed", "u2");
  const [day] = store.trafficStats(1);
  assert.equal(day.pv, 2);
  assert.equal(day.feed, 3);
  assert.equal(day.visitors, 2);

  // engaged = 상호작용 흔적 있는 방문자만 (2026-08-09: 방문자 집계 정직화 —
  // 전체 266 중 사람 19였던 날이 있었다. 크롤러·점검은 engaged에 못 든다)
  const su = store.createUser("u1");
  store.recordSignal(su.id, "itemX", "open");
  const [day2] = store.trafficStats(1);
  assert.equal(day2.engaged, 1, "신호 있는 u1만 engaged");
  assert.equal(day2.visitors, 2, "전체 방문자는 그대로");

  // admin 엔드포인트 (토큰 게이트)
  const { createServer } = await import("../src/feed/server.js");
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "t0k";
  try {
    const server = createServer({});
    await new Promise((r) => server.listen(0, r));
    const base = `http://localhost:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/admin/traffic`)).status, 401, "토큰 없으면 거부");
    const ok = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": "t0k" } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(Array.isArray(body.days));
    // 내부 점검 표식(x-nowhot-check)이 붙은 요청은 방문자·PV로 안 센다
    // (2026-08-09: 배포 preflight가 방문자 94명으로 잡혔던 날의 재발 방지)
    const s = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    }).then((r) => r.json());
    await fetch(`${base}/api/feed?userId=${s.userId}&limit=5`, { headers: { "x-nowhot-check": "1" } });
    await fetch(`${base}/`, { headers: { "x-nowhot-check": "1" } });
    const after = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": "t0k" } }).then((r) => r.json());
    const todayRow = after.days.at(-1) || { visitors: 0, pv: 0 };
    assert.equal(todayRow.visitors || 0, 0, "점검 요청이 방문자로 잡히면 안 된다");
    assert.equal(todayRow.pv || 0, 0, "점검 요청이 PV로 잡히면 안 된다");
    // 양성 대조 — 헤더 없는 진짜 요청은 세야 한다. 이게 없으면 "아무도 안
    // 세는" 회귀(조건 오타)도 조용히 통과한다(검수 라운드2).
    await fetch(`${base}/api/feed?userId=${s.userId}&limit=5`);
    await fetch(`${base}/`);
    const after2 = await fetch(`${base}/api/admin/traffic`, { headers: { "x-admin-token": "t0k" } }).then((r) => r.json());
    const row2 = after2.days.at(-1);
    assert.ok(row2 && row2.visitors === 1 && row2.pv >= 1, `일반 요청은 집계된다 (${JSON.stringify(row2)})`);
    server.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev;
  }
});

test("트래픽 카운터: 재시작(직렬화 왕복) 후에도 수치가 유지된다", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fsm = await import("node:fs");
  const f = path.join(os.tmpdir(), `traffic-persist-${process.pid}.json`);
  try {
    const a = new FeedStore({ file: f, clock: fixedClock });
    a.recordTraffic("page");
    a.recordTraffic("feed", "u1");
    // 방문 집계는 요청을 막지 않는다 — 11.8MB 스토어를 요청마다 동기로
    // 쓰던 것이 홈 TTFB 4.2초의 원인이었다(현지 제보 2026-08-06).
    // 대신 종료 훅이 밀린 것을 비운다. 그게 비면 수치가 사라진다.
    assert.equal(a.flushPending(), true, "밀린 저장이 없다 — 지연 저장이 안 걸렸다");
    const b = new FeedStore({ file: f, clock: fixedClock }); // 재시작 시뮬레이션
    const [day] = b.trafficStats(1);
    assert.equal(day.pv, 1, "재시작 후 pv 유실");
    assert.equal(day.visitors, 1, "재시작 후 방문자 유실");
  } finally { try { fsm.unlinkSync(f); } catch {} }
});

// --- 오늘의 브리핑 (애드핏 재심사 대응: 자체 콘텐츠 + 운영 주체 표시) --------
test("/briefing: 실측 데이터 기반 자체 페이지가 렌더되고 정치·성인은 제외된다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const { JsonSource } = await import("../src/feed/content.js");
  const at = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const src = new JsonSource("clien", async () => [
    { id: "b1", title: "화제의 기술 글", url: "https://c/1", category: "tech", score: 500, commentCount: 100, publishedAt: at(2), sourceRank: 0 },
    { id: "b2", title: "두번째 기술 글", url: "https://c/2", category: "tech", score: 100, commentCount: 40, publishedAt: at(3), sourceRank: 1 },
    { id: "b3", title: "국힘 민주당 정치 글", url: "https://c/3", category: "news", score: 900, commentCount: 300, publishedAt: at(1), sourceRank: 2 },
    { id: "b4", title: "일상 글 하나", url: "https://c/4", category: "life", score: 10, commentCount: 2, publishedAt: at(4), sourceRank: 3 }
  ], "community");
  const server = createServer({ sources: [src] });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/briefing`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // 2026-08-03: 브리핑이 시간대 편성(모닝/런치/이브닝)으로 바뀌었다.
    assert.match(html, /지금 브리핑/);
    assert.match(html, /(모닝|런치|이브닝)/, "편성이 표기되어야 한다");
    // 검색 노출용 머리 — 없으면 구글이 스니펫을 만들 재료가 없다
    assert.match(html, /<link rel="canonical"/, "canonical이 있어야 한다");
    assert.match(html, /<meta name="description"/);
    assert.match(html, /화제의 기술 글/, "실측 상위 글이 실려야");
    assert.match(html, /추천 500/, "수치는 실측 그대로");
    assert.ok(!html.includes("정치 글"), "정치 태그 글은 브리핑에서 제외");
    assert.match(html, /페퍼클럽/, "운영 주체 표기 (애드핏 소유관계 사유 대응)");
    assert.match(html, /#post-b1/, "내부 상세(자체 댓글)로 링크 — 아웃링크가 아니라");
  } finally { server.close(); }
});

test("운영 주체 표기: about·privacy·드로어에 페퍼클럽이 명시된다", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public");
  assert.match(fs.readFileSync(path.join(pub, "about.html"), "utf8"), /페퍼클럽/);
  assert.match(fs.readFileSync(path.join(pub, "privacy.html"), "utf8"), /페퍼클럽/);
  const idx = fs.readFileSync(path.join(pub, "index.html"), "utf8");
  assert.match(idx, /페퍼클럽/, "드로어 운영자 표기");
  assert.match(idx, /href="\/briefing"/, "브리핑 진입점");
  // 2026-08-04: 정책 페이지를 확장자 없는 정식 주소로 통일했다(/about, /terms,
  // /privacy). 심사관·크롤러가 관행적으로 치는 주소가 전부 404였다.
  assert.match(idx, /href="\/about"/, "소개 진입점");
  assert.match(idx, /href="\/terms"/, "이용약관 진입점 — 댓글·글쓰기를 운영하면 약관이 필요하다");
  assert.match(idx, /href="\/privacy"/, "개인정보처리방침 진입점");
  // 만들어 놓고 들어갈 길이 없던 자체 콘텐츠 페이지들
  for (const href of ["/communities", "/keywords", "/trends"]) {
    assert.ok(idx.includes(`href="${href}"`), `드로어에 ${href} 누락`);
  }
  // 이용약관 실체와 필수 조항
  const terms = fs.readFileSync(path.join(pub, "terms.html"), "utf8");
  assert.match(terms, /페퍼클럽/);
  assert.match(terms, /제44조의2/, "게시중단 절차 — OSP 면책의 전제");
  assert.match(terms, /제103조/, "저작권 침해 신고 창구");
  assert.match(terms, /nowhot-bot/, "수집 정책과 차단 요청 방법");
  // 개인정보처리방침 법정 필수 항목
  const priv = fs.readFileSync(path.join(pub, "privacy.html"), "utf8");
  assert.match(priv, /개인정보 보호책임자/, "보호법 제31조 — 재량 없는 형식 요건");
  assert.match(priv, /국외/, "AdSense가 미국으로 전송한다 — 제28조의8 고지");
  assert.match(priv, /체류시간/, "실제 수집 항목이 고지보다 넓으면 안 된다");
  assert.ok(!/받을 수 있습니다/.test(priv), "조건부 대가성 표현은 2023 개정에서 금지됐다");
});

// ── 2026-08-04 회귀 방지: 뉴스 편중을 만든 두 가지 구조적 편향 ──────────────
//
// David 질문("html 로 가져오는거에 단점이나 부담이나 위험성은 없는건가")을
// 계기로 소스별 실측을 돌리다 발견한 것들이다. 둘 다 "뉴스가 더 화제라서"가
// 아니라 점수 계산이 커뮤니티를 구조적으로 벌하고 있던 문제였다.
test("hot: 실측 반응이 있는 글이 '순위만 있는' 글에게 지지 않는다 (probit 클램프 인공물)", async () => {
  const { sourceHotScores } = await import("../src/feed/ingest.js");
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const at = new Date(now - 3600e3).toISOString(); // 나이를 동일하게 고정
  // A: 실측 반응이 있는 커뮤니티 베스트
  const withSignal = sourceHotScores([
    { id: "a1", source: "c", publishedAt: at, score: 466, commentCount: 736 },
    { id: "a2", source: "c", publishedAt: at, score: 40, commentCount: 12 },
    { id: "a3", source: "c", publishedAt: at, score: 8, commentCount: 1 }
  ], now);
  // B: 숫자가 전혀 없고 RSS 순서만 있는 소스
  const rankOnly = sourceHotScores([
    { id: "b1", source: "n", publishedAt: at, sourceRank: 0 },
    { id: "b2", source: "n", publishedAt: at, sourceRank: 1 },
    { id: "b3", source: "n", publishedAt: at, sourceRank: 2 }
  ], now);
  assert.equal(withSignal[0].hasSignal, true);
  assert.equal(rankOnly[0].hasSignal, false);
  const topSignal = Math.max(...withSignal.map((s) => s.hotScore));
  const topRank = Math.max(...rankOnly.map((s) => s.hotScore));
  assert.ok(
    topSignal > topRank,
    `추천 466건이 'RSS 1번째'에게 져서는 안 된다 (실측 ${topSignal} vs ${topRank})`
  );
  // 순위 경로 내부의 순서 자체는 그대로여야 한다 — 할인은 단조 곱셈이다.
  assert.ok(rankOnly[0].hotScore > rankOnly[1].hotScore && rankOnly[1].hotScore > rankOnly[2].hotScore);
});

test("hot: 화제성 나이는 firstSeenAt(화제가 된 시각) 기준이다", async () => {
  const { sourceHotScores } = await import("../src/feed/ingest.js");
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  // 어제 써졌지만 방금 베스트에 오른 글 — publishedAt으로 재면 24시간 벌점을
  // 먹는다. 반응이 쌓이는 데 걸린 시간이 곧 감점이 되던 구조가 뉴스 편중의
  // 최대 원인이었다(실측: 신호 있는 소스 중앙 23.0h vs 없는 소스 3.0h).
  const late = { id: "l", source: "c", publishedAt: new Date(now - 24 * 3600e3).toISOString(), firstSeenAt: now - 3600e3, score: 100 };
  const asPublished = { id: "p", source: "c", publishedAt: new Date(now - 24 * 3600e3).toISOString(), score: 100 };
  const [a] = sourceHotScores([late], now);
  const [b] = sourceHotScores([asPublished], now);
  assert.ok(Math.abs(a.age - 1) < 0.01, `firstSeenAt 기준 1시간이어야 한다 (실측 ${a.age})`);
  assert.ok(b.age > 20, "firstSeenAt이 없으면 publishedAt으로 떨어진다");
  assert.ok(a.hotScore > b.hotScore, "베스트 진입이 최근인 글이 앞선다");
});

test("다양성: feedGroup을 준 소스들은 라운드로빈에서 한 몫으로 센다", async () => {
  const { rankBySource, diversityKey } = await import("../src/feed/ingest.js");
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const at = new Date(now - 3600e3).toISOString();
  const mk = (id, source, feedGroup) => ({ id, source, feedGroup, publishedAt: at, sourceRank: 0 });
  const items = [
    mk("g1", "gnews", "gnews"), mk("g2", "gnews-biz", "gnews"),
    mk("g3", "gnews-ent", "gnews"), mk("g4", "gnews-world", "gnews"),
    mk("c1", "clien", undefined)
  ];
  assert.equal(diversityKey(items[0]), "gnews");
  assert.equal(diversityKey(items[4]), "clien");
  const ranked = rankBySource(items, now);
  // 구글뉴스 4개 소스가 큐 4개가 아니라 1개여야 한다 — 아니면 라운드로빈에서
  // 지분을 4배로 가져간다(실측 2026-08-04: 8섹션이 피드의 29%).
  assert.deepEqual([...ranked.keys()].sort(), ["clien", "gnews"]);
  assert.equal(ranked.get("gnews").length, 4);
});

// ── 2026-08-04 파서 복구: 반응 수치가 실제로 들어오는지 ─────────────────────
//
// 실측으로 드러난 세 가지 실패 모드. 전부 "정규식이 틀렸다"가 아니라 서로
// 다른 이유였고, 그래서 셋 다 테스트로 못박아 둔다.
//   뽐뿌·보배  — 정규식은 맞는데 windowAfter가 좁아 추천 컬럼에 닿지 못함
//   이토랜드   — 숫자가 없는 JSON-LD를 읽고 있었음
//   인스티즈   — 숫자가 없는 블록(일반 목록)을 읽고 있었음
test("parseListPage: 커뮤니티 소스의 반응 수치가 실제로 파싱된다 (창 크기·블록 선택 회귀)", async () => {
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const reg = loadRegistry();
  const cases = [
    { id: "ppomppu", file: "ppomppu_hot.html", charset: "euc-kr", minScore: 10, minComment: 15 },
    { id: "bobae", file: "bobaedream_best.html", charset: "utf-8", minScore: 15, minComment: 12 },
    { id: "instiz", file: "instiz_pt.html", charset: "utf-8", minScore: 3, minComment: 8 }
  ];
  for (const c of cases) {
    const entry = reg.find((x) => x.id === c.id);
    const items = parseListPage(fixture(c.file, c.charset), entry.adapter.list);
    const withScore = items.filter((i) => i.score > 0).length;
    const withComment = items.filter((i) => i.commentCount > 0).length;
    assert.ok(withScore >= c.minScore, `${c.id}: 추천이 붙은 글 ${withScore}건 (>= ${c.minScore} 기대)`);
    assert.ok(withComment >= c.minComment, `${c.id}: 댓글이 붙은 글 ${withComment}건 (>= ${c.minComment} 기대)`);
  }
});

test("communities: 클리앙은 robots가 연 게시판을 쿼리 없이 직접 받는다", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const clien = loadRegistry().find((c) => c.id === "clien");

  // ── 2026-08-06: 2026-08-04의 판단을 실측으로 뒤집었다.
  //
  // 그때의 기록은 이랬다: "인기순 목록에 해당하는 경로가 전부 막혀 있다.
  // 조회·공감 숫자가 HTML에는 있지만 **가져올 길이 없으므로** feedburner RSS를
  // 유지한다." robots 사실관계는 지금도 맞다 —
  //   Allow:/service/board/        ← 게시판 목록은 열려 있다
  //   Disallow:/service/group/     ← 통합 인기글
  //   Disallow:/service/recommend  ← 추천글 모음
  //   Disallow: /*?*               ← 쿼리스트링 전부(정렬 파라미터 포함)
  //
  // 틀린 것은 그 다음 한 걸음이었다. **정렬을 클리앙에게 시킬 필요가 없다.**
  // 열려 있는 게시판 목록을 쿼리 없이 받아 거기 실린 추천·댓글 수를 읽고,
  // 무엇이 뜨거운지는 우리 엔진이 고르면 된다 — 그게 이 서비스가 하는 일이다.
  //
  // 그리고 대안으로 유지했던 feedburner RSS는 목적을 배반하고 있었다:
  //   · parseRss는 score/commentCount를 애초에 만들지 않는다 → 숫자가 **구조적으로 0**
  //     (숫자를 얻으려고 고른 수단이 숫자를 하나도 못 가져왔다)
  //   · 클리앙 공식 피드가 아니다 — <generator>PyRSS2Gen</generator>,
  //     제3자가 파이썬으로 긁어 만든 미러. 클리앙은 RSS를 제공하지 않는다
  //     (/service/rss·/rss 등 4경로 404/400 실측)
  //   · <description>에 게시글 본문 HTML 전체가 실려 온다
  //
  // 이 테스트가 지키는 것은 이제 둘이다: robots가 막은 것을 건드리지 않을 것,
  // 그리고 **숫자가 실제로 들어올 것**.
  assert.equal(clien.adapter.type, "list");
  assert.ok(/^https:\/\/www\.clien\.net\/service\/board\//.test(clien.adapter.url),
    `robots가 연 /service/board/ 경로여야 한다: ${clien.adapter.url}`);
  assert.ok(!/\/service\/(group|recommend)/.test(clien.adapter.url),
    "robots가 막은 경로를 수집원으로 쓰지 않는다");
  assert.ok(!clien.adapter.url.includes("?"),
    "Disallow: /*?* — 수집 URL에 쿼리를 붙이지 않는다");
  assert.ok(!/feedburner/i.test(clien.adapter.url),
    "제3자 미러가 아니라 클리앙 본체에서 받는다");

  // 실제 목록 HTML로 숫자가 들어오는지 확인한다. 2026-08-06 실측 스냅숏
  // (추천>0 17건 / 댓글>0 24건). 마크업이 바뀌면 여기서 먼저 드러난다.
  const items = parseListPage(fixture("clien_park.html"), clien.adapter.list);
  assert.ok(items.length >= 25, `목록 파싱 ${items.length}건`);
  const withScore = items.filter((i) => i.score > 0).length;
  const withComment = items.filter((i) => i.commentCount > 0).length;
  assert.ok(withScore >= 12, `추천이 붙은 글 ${withScore}건 (>= 12 기대)`);
  assert.ok(withComment >= 18, `댓글이 붙은 글 ${withComment}건 (>= 18 기대)`);

  // 글 링크에도 쿼리를 남기지 않는다. 목록의 href는 ?od=T31&po=0... 을 달고
  // 오는데, 그대로 두면 우리가 만드는 링크와 enricher의 요청이 Disallow 경로가 된다.
  for (const it of items) {
    assert.ok(!it.url.includes("?"), `글 URL에 쿼리가 남았다: ${it.url}`);
    assert.ok(it.url.startsWith("https://www.clien.net/service/board/"), it.url);
  }
});

test("번역: 규칙 이전에 들어온 글도 내보낼 때 걸러진다", async () => {
  // 수집 단계에서 거르지만 풀은 48시간을 안고 간다 — 규칙을 바꾸기 전에
  // 들어온 글은 영문 발췌를 그대로 달고 남는다(2026-08-05 배포 직후 라이브 2건).
  const { FeedEngine } = await import("../src/feed/engine.js");
  const stale = {
    id: "s", kind: "news", async fetch() {
      return [{ id: "old1", title: "한글 제목", summary: "Longtime Slashdot reader shares",
                translated: true, summaryTranslated: false, url: "https://x/1", source: "slashdot" }];
    }
  };
  const engine = new FeedEngine(null, [stale]);
  const items = await engine.pool();
  const it = items.find((i) => i.id === "old1");
  assert.ok(it, "글이 사라지면 안 된다 — 발췌만 지운다");
  assert.equal(it.summary, "");
  assert.equal(it.title, "한글 제목");
});

test("성인 필터가 통째로 없다 — 글을 걸러내지 않는다", async () => {
  // David 2026-08-05: "성인글을 차단하는 기능을 따로 넣을 필요는 없어.
  //                    필터 기능 자체를 없애기만 하면 돼." / "성인 필터로 글 걸러내지마"
  //
  // 애드핏이 지목한 것은 게시글이 아니라 메뉴의 "성인 콘텐츠(19금) 보기" 토글
  // 한 줄이었다(참고 이미지). 은어 사전을 아무리 키워도 지적된 문제는 해결되지
  // 않는 구조였고, 늘릴 때마다 오탐만 늘었다 — "입욕제", "니트 착샷",
  // "성인용 킥보드", "노출 콘크리트"가 게이트 뒤에 갇혔던 것이 실측으로 확인됐다.
  const topics = await import("../src/feed/topics.js");
  const { normalizeItem } = await import("../src/feed/content.js");
  const { promotable, adUnsafe } = await import("../src/feed/promotion.js");

  // 분류에 adult가 없다
  assert.ok(!("ADULT_KEYWORDS" in topics), "성인 사전이 아직 남아 있다");
  assert.deepEqual(topics.classifyTopics({ title: "19금 야동 후방주의", url: "https://x/1", sourceId: "clien" }), []);
  assert.ok(!topics.FILTERABLE_TOPICS.includes("adult"));

  // 항목에 adult 필드를 붙이지 않는다
  const item = normalizeItem({ title: "노출 화보 공개", url: "https://x/2", source: "clien", adult: true });
  assert.equal(item.adult, undefined, "수집 단계에서 성인 태그를 붙이면 안 된다");

  // 걸러내지 않는다 — 대표 자리에도, 광고 옆에도 adult를 이유로 막지 않는다
  assert.equal(promotable({ title: "평범한 글", adult: true, topics: [] }), true);
  assert.equal(adUnsafe({ title: "평범한 글", adult: true, topics: [] }), false);
  // 정치·종교 인접 광고 가드는 그대로다 — 그건 성인 필터가 아니라 광고주 보호다
  assert.equal(adUnsafe({ title: "평범한 글", topics: ["politics"] }), true);
});

test("해외 글: 뒤늦게 채운 발췌도 우리가 한글로 옮긴다", async () => {
  // David 2026-08-05: 구글 웹번역 프록시는 한국에서 막혀 있다(실기기 확인:
  // "This translation service isn't available in your region"). 하지만 글자를
  // 옮기는 엔드포인트는 우리 서버에서 멀쩡히 돈다 — 제목이 이미 그걸로 번역된다.
  //
  // 문제는 순서였다. enricher가 원문 페이지에서 발췌를 채우는 시점이 번역이
  // 끝난 **다음**이라, 해외 글은 "제목만 한글, 발췌는 영어"가 됐고 영문 발췌를
  // 버리는 규칙이 생긴 뒤로는 빈 칸이 됐다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const engine = new FeedEngine(null, [{ id: "x", kind: "news", async fetch() { return []; } }]);
  const calls = [];
  engine._translateText = async (text, opts) => {
    calls.push({ text, ...opts });
    return text === "Nvidia announced a new chip today" ? "엔비디아가 오늘 새 칩을 발표했다" : text;
  };

  const items = [
    // enricher가 새로 채운 영문 발췌 — 옮겨야 한다
    { id: "en", title: "엔비디아 새 칩", summary: "Nvidia announced a new chip today",
      translated: true, originalLang: "en" },
    // 이미 옮긴 것은 다시 부르지 않는다
    { id: "done", title: "이미 번역", summary: "이미 한글입니다", translated: true, summaryTranslated: true },
    // 한국어 원문은 대상이 아니다
    { id: "ko", title: "국내 글", summary: "국내 커뮤니티 발췌입니다", source: "clien" },
    // 옮기지 못하면 영문을 남기지 않는다
    { id: "fail", title: "안 옮겨짐", summary: "Boilerplate comments on this post",
      translated: true, originalLang: "en" },
    // translate.js가 이미 진짜 원문을 넣어 둔 경우 — 여기서 밀어내면 안 된다
    { id: "keep", title: "원문 있음", summary: "Nvidia announced a new chip today",
      originalSummary: "먼저 저장된 진짜 원문", translated: true, originalLang: "en" }
  ];
  await engine._translateFilledSummaries(items);

  assert.equal(items[0].summary, "엔비디아가 오늘 새 칩을 발표했다");
  assert.equal(items[0].summaryTranslated, true);

  // ── 번역 **전** 원문을 남긴다 (David 2026-08-06)
  //
  // "해외 매체 상세페이지에서 한글로 보기 / 원문 보기 버튼에 기능도 제대로 구현."
  //
  // 실측(라이브 풀 8,287건): 번역글 401건 중 originalTitle은 있는데
  // originalSummary는 **0건**이었다. translate.js는 둘 다 저장하는데, 발췌를
  // 나중에 채우는 enricher가 번역 **뒤에** 돌아 이 함수가 원문을 덮어썼기
  // 때문이다. 그래서 상세의 "원문 보기"가 제목만 바꾸고 발췌는 번역문 그대로였다.
  assert.equal(items[0].originalSummary, "Nvidia announced a new chip today",
    "번역 전 원문을 남겨야 '원문 보기'가 발췌까지 바꿀 수 있다");
  assert.equal(items[4].originalSummary, "먼저 저장된 진짜 원문",
    "translate.js가 먼저 넣은 원문을 밀어내면 안 된다");
  assert.equal(items[1].summary, "이미 한글입니다", "이미 옮긴 것을 또 부르면 안 된다");
  assert.equal(items[2].summary, "국내 커뮤니티 발췌입니다", "한국어 원문은 건드리지 않는다");
  assert.equal(items[3].summary, "", "못 옮긴 영문을 그대로 남기면 안 된다");
  // 발췌를 버렸으면 원문도 함께 버린다 — 화면에 한글 발췌가 없는데 원문 발췌만
  // 남으면 "한국어로 보기"를 눌러도 돌아올 곳이 없다.
  assert.ok(!items[3].originalSummary,
    `발췌를 버렸으면 원문도 남기지 않는다: ${JSON.stringify(items[3].originalSummary)}`);
  // 번역기를 부른 것은 해외 글 셋뿐이다 — 국내 글까지 보내면 헛돈다
  assert.equal(calls.length, 3, `번역기 호출 ${calls.length}회: ${calls.map(c=>c.text.slice(0,20)).join(" | ")}`);
  assert.equal(calls[0].to, "ko");

  // 번역기가 없으면(FEED_TRANSLATE 꺼짐) 아무 일도 하지 않는다
  const off = new FeedEngine(null, [{ id: "x", kind: "news", async fetch() { return []; } }]);
  const untouched = [{ id: "a", summary: "English text", translated: true }];
  await off._translateFilledSummaries(untouched);
  assert.equal(untouched[0].summary, "English text");
});

test("한국 매체가 일본어 기사를 섞어 보내도 한글로 옮긴다", async () => {
  // David 2026-08-05 실기기: 조선비즈 카드가 일본어 제목으로 떴다
  //   "トランプがイランを強攻撃警告 ホルムズ開放迫る"
  // 실측: 조선비즈 RSS 100건 중 19건이 일본어였다. 한국 매체가 일본어판을
  // 같은 피드에 섞어 보내는데, 우리는 그 소스를 "ko"로 선언해 놔서 번역을
  // 통째로 건너뛰었다. David: "이거 대상이 한국인인데."
  const { TranslatingSource } = await import("../src/feed/translate.js");
  const calls = [];
  const translate = async (text, opts) => {
    calls.push(text);
    return text.startsWith("トランプ") ? "트럼프, 이란에 강공격 경고" : text;
  };
  const source = {
    id: "chosunbiz", kind: "news",
    async fetch() {
      return [
        // 선언은 ko인데 실제로는 일본어 — 옮겨야 한다
        { id: "jp", title: "トランプがイランを強攻撃警告 ホルムズ開放迫る", lang: "ko",
          url: "https://biz.chosun.com/1", source: "chosunbiz" },
        // 진짜 한국어 — 번역기를 부르면 안 된다
        { id: "ko", title: "코스피 4%대 급등, 반도체가 이끌었다", lang: "ko",
          url: "https://biz.chosun.com/2", source: "chosunbiz" }
      ];
    }
  };
  const out = await new TranslatingSource(source, translate, "ko").fetch();
  assert.equal(out[0].title, "트럼프, 이란에 강공격 경고");
  assert.equal(out[0].translated, true);
  assert.equal(out[1].title, "코스피 4%대 급등, 반도체가 이끌었다", "한국어 글을 건드리면 안 된다");
  // 국내 글이 대부분이라, 한글 글까지 번역기에 보내면 비용이 폭증한다
  assert.ok(!calls.some((t) => t.startsWith("코스피")), `한국어 글을 번역기에 보냈다: ${calls.join(" | ")}`);
});

test("모든 소스를 번역 대상으로 감싼다 — 선언을 믿지 않는다", async () => {
  const { buildSources } = await import("../src/feed/registry.js");
  const registry = [
    { id: "kr", label: "국내", lang: "ko", kind: "news", enabled: true,
      adapter: { type: "rss", url: "https://example.com/rss" } }
  ];
  const built = buildSources(registry, {
    translate: { targetLang: "ko", translateFn: async (t) => t },
    fetcher: () => async () => []
  });
  assert.equal(built.length, 1);
  // 감싸졌는지 — 감싸지 않으면 일본어가 섞여 와도 그대로 나간다
  assert.equal(built[0].constructor.name, "TranslatingSource",
    "국내 선언 소스를 안 감싸면 섞여 온 외국어를 못 잡는다");
});

test("목록 파서: 링크의 &amp;를 풀지 않으면 글이 아니라 목록으로 간다", async () => {
  // 실측(2026-08-05 SLR클럽): ".../vx2.php?id=hot_article&amp;no=1450305"
  // HTML 속성 안의 "&"는 "&amp;"로 이스케이프돼 있는 것이 정상인데, 그대로
  // 두면 no 파라미터가 전달되지 않아 누른 사람이 글이 아닌 목록을 본다.
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const html = `<tr><td class="list_ctgry">자유게시판</td>
    <td class="sbj"><a href="/bbs/vx2.php?id=hot&amp;no=123">제목입니다</a> [7]</td>
    <td class="list_vote">12</td><td class="list_click">3,456</td></tr>`;
  const rows = parseListPage(html, {
    urlBase: "https://www.slrclub.com",
    titleRegex: 'class="sbj">(?:<span[^>]*>[\\s\\S]*?</span>)?\\s*<a href="([^"]+)"[^>]*>([^<]+)</a>',
    windowBefore: 300, windowAfter: 700,
    commentRegex: "^\\s*\\[(\\d+)\\]",
    scoreRegex: 'class="list_vote[^"]*"[^>]*>([\\d,]+)<',
    viewRegex: 'class="list_click[^"]*"[^>]*>([\\d,]+)<'
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://www.slrclub.com/bbs/vx2.php?id=hot&no=123");
  assert.ok(!/&amp;/.test(rows[0].url), "링크에 &amp;가 남았다");
  assert.equal(rows[0].commentCount, 7);
  assert.equal(rows[0].score, 12);
  assert.equal(rows[0].viewCount, 3456, "쉼표가 든 조회수를 못 읽으면 3이 된다");
});

test("목록 파서: 민감 게시판 행은 제외한다", async () => {
  // SLR클럽 인기글은 전 게시판 통합이라 성인·정치 게시판 글이 섞여 온다.
  // 원 게시판 이름이 제목 앞 칸에 있으므로 그걸로 거른다.
  const { parseListPage } = await import("../src/feed/fetchers.js");
  const row = (cat, title, no) => `<tr><td class="list_ctgry">${cat}</td>
    <td class="sbj"><a href="/bbs/vx2.php?id=hot&amp;no=${no}">${title}</a> [1]</td></tr>`;
  const html = row("자유게시판", "평범한 글", 1) + row("성인게시판", "성인 글", 2) + row("정치게시판", "정치 글", 3);
  const rows = parseListPage(html, {
    urlBase: "https://www.slrclub.com",
    titleRegex: 'class="sbj">(?:<span[^>]*>[\\s\\S]*?</span>)?\\s*<a href="([^"]+)"[^>]*>([^<]+)</a>',
    windowBefore: 300, windowAfter: 700,
    excludeRegex: 'class="list_ctgry"[^>]*>\\s*(성인게시판|정치게시판)'
  });
  assert.deepEqual(rows.map((r) => r.title), ["평범한 글"]);
});

test("온보딩 안내가 떠 있어도 메뉴가 눌린다", async () => {
  // David 제보(2026-08-06): "메뉴의 실시간 트렌드 눌러도 아무것도 안 되는데?"
  // 브라우저로 재현했다 — 링크는 제자리(y=380)에 보이는데 그 좌표에서
  // elementFromPoint가 "지금핫에 오신 걸 환영해요" DIV를 돌려줬다.
  // 온보딩 오버레이 z-index 60 > 드로어 49라 **메뉴 전체가 안 눌리고 있었다.**
  const fsm = await import("node:fs");
  const html = fsm.readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function openDrawer(){"), html.indexOf("function closeDrawer(){"));
  assert.match(fn, /getElementById\("onbBack"\)/, "메뉴를 열 때 온보딩을 안 치운다");
  assert.match(fn, /onb\.remove\(\)/, "온보딩을 안 닫는다");
});

test("반응 없는 글에는 신선도 연장을 주지 않는다", async () => {
  // David 실사용 제보(2026-08-06): 슬로우뉴스 글이 추천 0·댓글 0·2일 전인데
  // 두 번째 칸에 있었다. 그 소스의 maxAgeH:72 오버라이드 때문이었다 —
  // 발행이 뜸한 매체라 24시간이면 아무것도 안 남아서 넣어 둔 것이었다.
  // "중요한 내용도 아닌데 저게" — 연장은 특혜이지 무조건 주는 게 아니다.
  const src = (await import("node:fs")).readFileSync("src/feed/engine.js", "utf8");
  const fn = src.slice(src.indexOf("function maxAgeFor(item) {"), src.indexOf("// ── 뉴스 성향 슬라이더"));
  assert.match(fn, /const signal = \(item\.score \|\| 0\)/, "신호를 안 본다");
  assert.match(fn, /signal > 0 \? override : base/, "신호와 무관하게 연장한다");
  assert.match(fn, /if \(override <= base\) return override/, "더 짧게 잡은 설정을 무시한다");
});

test("탐색은 반응이 있거나 아직 새로운 글에만 붙는다", async () => {
  // "새로운 탐색" 배지가 반응 0인 2일 전 글에 붙어 있었다. 탐색의 뜻은
  // "취향 밖이지만 화제인 글"이지 "아무도 안 본 오래된 글"이 아니다.
  const src = (await import("node:fs")).readFileSync("src/feed/recommender.js", "utf8");
  assert.match(src, /function exploreEligible\(item, now\)/, "자격 조건이 없다");
  assert.match(src, /EXPLORE_MAX_AGE_H/, "신선도 조건이 없다");
  // 날짜를 안 주는 소스가 여럿이라 나이를 모르면 기회를 준다 — "적당히 섞자".
  assert.match(src, /if \(!Number\.isFinite\(t\)\) return true;/, "날짜 없는 소스를 통째로 뺐다");
});
