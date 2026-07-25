import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  injectSlots,
  adParams,
  adResponsivenessRatio,
  adaptiveEvery,
  assignVariant,
  applyVariant,
  applyNarrowSourceDensity,
  makeSlotItem,
  pickAffiliateCandidates,
  sampleAffiliateCandidates,
  DISCLOSURE_TEXT,
  DISCLOSURE_SHORT_TEXT
} from "../src/feed/monetize.js";
import { emptyPreferenceVector } from "../src/feed/survey.js";
import { applyFeedback } from "../src/feed/recommender.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { SeedSource } from "../src/feed/content.js";

// Push a user's "tech" category weight up past the relevance-gating threshold
// without depending on any particular seed item's (hashed, non-sequential)
// id — applyFeedback only reads .category/.tags/.source/.length off the item
// it's given, so a minimal stand-in is enough.
function learnTech(vec, times = 8) {
  for (let i = 0; i < times; i++) {
    applyFeedback(vec, { category: "tech", tags: [], source: "clien", length: 200 }, 1);
  }
}

const fixedClock = () => "2026-07-06T00:00:00.000Z";

// ---- env helpers (save/restore, mirrors test/feed.test.js's pattern) ------
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}
async function withEnvAsync(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function organicItems(n, startId = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: `it_${startId + i}`, kind: "news", source: "s" }));
}
function candidate(id, relevance = 1) {
  return makeSlotItem({
    id,
    category: "tech",
    title: "[샘플] 테스트 상품",
    summary: "테스트",
    url: "https://www.coupang.com/",
    relevance
  });
}

// ---- injectSlots: frequency + first-screen protection ---------------------

test("injectSlots: no slot within the first-screen protection window", () => {
  const items = organicItems(4); // exactly AD_SKIP_FIRST items
  const { items: out, slots } = injectSlots(items, [candidate("ad1")], {
    every: 9,
    skipFirst: 4,
    maxPerPage: 2,
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.equal(slots.length, 0);
  assert.deepEqual(out.map((i) => i.id), items.map((i) => i.id));
});

test("injectSlots: first slot lands right after skipFirst organic items", () => {
  const items = organicItems(6);
  const { items: out, slots } = injectSlots(items, [candidate("ad1")], {
    every: 9,
    skipFirst: 4,
    maxPerPage: 2,
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].globalPos, 4);
  // 4 organic items, then the slot, then the remaining 2 organic items
  assert.deepEqual(
    out.map((i) => i.id),
    ["it_0", "it_1", "it_2", "it_3", "ad1", "it_4", "it_5"]
  );
});

test("injectSlots: cadence repeats every N organic items across a long page", () => {
  const items = organicItems(23);
  const { slots } = injectSlots(items, [candidate("ad1"), candidate("ad2"), candidate("ad3")], {
    every: 9,
    skipFirst: 4,
    maxPerPage: 10, // no cap in play for this assertion
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.deepEqual(slots.map((s) => s.globalPos), [4, 13, 22]);
});

test("injectSlots: cadence continues seamlessly across pages via startIndex", () => {
  const page2 = organicItems(10, 100);
  // page 1 already consumed 20 organic items (cursor=20 going into page 2)
  const { slots } = injectSlots(page2, [candidate("ad1"), candidate("ad2")], {
    every: 9,
    skipFirst: 4,
    maxPerPage: 5,
    minRelevance: 0.3,
    startIndex: 20
  });
  // next boundary after 4,13,22 is... 22 falls in [20,30) at local index 2
  assert.deepEqual(slots.map((s) => s.globalPos), [22]);
});

// ---- session cap ------------------------------------------------------------

test("injectSlots: session cap limits slots per call regardless of how many boundaries fire", () => {
  const items = organicItems(40);
  const many = Array.from({ length: 10 }, (_, i) => candidate(`ad${i}`));
  const { slots } = injectSlots(items, many, {
    every: 5,
    skipFirst: 0,
    maxPerPage: 2,
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.equal(slots.length, 2);
});

test("injectSlots: maxPerPage=0 or every<=0 disables insertion entirely", () => {
  const items = organicItems(20);
  const a = injectSlots(items, [candidate("ad1")], { every: 9, skipFirst: 0, maxPerPage: 0, minRelevance: 0.3 });
  const b = injectSlots(items, [candidate("ad1")], { every: 0, skipFirst: 0, maxPerPage: 2, minRelevance: 0.3 });
  assert.equal(a.slots.length, 0);
  assert.equal(b.slots.length, 0);
});

// ---- relevance gating -------------------------------------------------------

test("injectSlots: a due slot with no candidate clearing minRelevance is left empty, not force-filled", () => {
  const items = organicItems(10);
  const lowRelevance = [candidate("ad1", 0.1), candidate("ad2", 0.15)];
  const { items: out, slots } = injectSlots(items, lowRelevance, {
    every: 9,
    skipFirst: 4,
    maxPerPage: 2,
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.equal(slots.length, 0);
  assert.equal(out.length, items.length); // no filler inserted
});

test("injectSlots: only candidates clearing the threshold are consumed", () => {
  const items = organicItems(14);
  const mixed = [candidate("low", 0.1), candidate("high", 0.9)];
  const { slots } = injectSlots(items, mixed, {
    every: 9,
    skipFirst: 4,
    maxPerPage: 2,
    minRelevance: 0.3,
    startIndex: 0
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].id, "high");
});

// ---- adaptive density --------------------------------------------------------

test("adaptiveEvery: no responsiveness signal -> baseline unchanged", () => {
  assert.equal(adaptiveEvery(9, null), 9);
});

test("adaptiveEvery: high responsiveness (ratio > 1) makes the cadence denser (smaller every)", () => {
  const every = adaptiveEvery(9, 3);
  assert.ok(every < 9, `expected denser than 9, got ${every}`);
});

test("adaptiveEvery: low responsiveness (ratio < 1) makes the cadence sparser (larger every)", () => {
  const every = adaptiveEvery(9, 0.2);
  assert.ok(every > 9, `expected sparser than 9, got ${every}`);
});

test("adaptiveEvery: stays within the configured floor/ceiling", () => {
  assert.ok(adaptiveEvery(9, 100, { min: 4, max: 24 }) >= 4);
  assert.ok(adaptiveEvery(9, 0.001, { min: 4, max: 24 }) <= 24);
});

test("adResponsivenessRatio: null under the minimum sample size", () => {
  assert.equal(adResponsivenessRatio(2, 3, { minSample: 5 }), null);
  assert.equal(adResponsivenessRatio(0, 0), null);
});

test("adResponsivenessRatio: >1 when CTR beats baseline, <1 when it lags", () => {
  const good = adResponsivenessRatio(4, 20, { minSample: 5, baselineCtr: 0.02 }); // ctr 0.2
  const bad = adResponsivenessRatio(0, 20, { minSample: 5, baselineCtr: 0.02 }); // ctr 0
  assert.ok(good > 1);
  assert.ok(bad < 1);
});

// ---- A/B variant assignment --------------------------------------------------

test("assignVariant: deterministic for the same userId", () => {
  const a1 = assignVariant("user-42", { enabled: true });
  const a2 = assignVariant("user-42", { enabled: true });
  assert.equal(a1, a2);
  assert.ok(a1 === "A" || a1 === "B");
});

test("assignVariant: always A when AD_AB is disabled", () => {
  assert.equal(assignVariant("anyone", { enabled: false }), "A");
});

test("applyVariant: B is a denser/longer-grace variant of the base params", () => {
  const base = { every: 9, skipFirst: 4, maxPerPage: 2, minRelevance: 0.3 };
  const b = applyVariant(base, "B");
  assert.ok(b.every < base.every);
  assert.ok(b.skipFirst > base.skipFirst);
  const a = applyVariant(base, "A");
  assert.deepEqual(a, base);
});

// ---- narrow (source=) view density (라운드1 검수 #8) --------------------------

test("applyNarrowSourceDensity: no-op for the home feed (isNarrow=false)", () => {
  const base = { every: 9, skipFirst: 6, maxPerPage: 2, minRelevance: 0.3 };
  assert.deepEqual(applyNarrowSourceDensity(base, false), base);
});

test("applyNarrowSourceDensity: widens (sparser) every for a narrow source= view", () => {
  const base = { every: 9, skipFirst: 6, maxPerPage: 2, minRelevance: 0.3 };
  const narrow = applyNarrowSourceDensity(base, true);
  assert.ok(narrow.every > base.every, `expected sparser than 9, got ${narrow.every}`);
});

// ---- candidate sourcing: dummy-content gate ----------------------------------

test("pickAffiliateCandidates: production (no credential, no preview) returns zero candidates", () => {
  withEnv({ COUPANG_PARTNER_ID: null, AD_PREVIEW: null }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.tech = 3;
    const out = pickAffiliateCandidates(vec, {});
    assert.deepEqual(out, []);
  });
});

test("pickAffiliateCandidates: AD_PREVIEW=1 without a credential yields clearly-labeled [샘플] cards", () => {
  withEnv({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.tech = 3;
    const out = pickAffiliateCandidates(vec, {});
    assert.ok(out.length > 0);
    for (const c of out) {
      assert.ok(c.title.startsWith("[샘플]"), `expected [샘플] prefix, got "${c.title}"`);
      assert.equal(c.sample, true);
      assert.equal(c.disclosure, DISCLOSURE_TEXT);
    }
  });
});

test("pickAffiliateCandidates: a real partner id with no wired product feed still yields zero cards", () => {
  withEnv({ COUPANG_PARTNER_ID: "AF1234567", AD_PREVIEW: null }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.tech = 3;
    const out = pickAffiliateCandidates(vec, {}); // no opts.productFeed supplied
    assert.deepEqual(out, []);
  });
});

test("sampleAffiliateCandidates: cold-start (no learned category) yields zero candidates", () => {
  const out = sampleAffiliateCandidates(emptyPreferenceVector(), {});
  assert.deepEqual(out, []);
});

test("sampleAffiliateCandidates: relevance tracks the learned category weight", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6; // WEIGHT_CLAMP ceiling
  const out = sampleAffiliateCandidates(vec, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].relevance, 1); // 6/6 clamped to 1
  assert.equal(out[0].category, "tech");
});

// ---- round-2 review #1 (치명, "가짜 관련성 문구"): categories with no matching
// template (news/humor/politics — SAMPLE_PRODUCT_TEMPLATES only covers 8 of
// taxonomy's 11 categories) must never silently fall back to a different
// category's inventory while still claiming the original category name in
// the reason copy. The slot must simply stay empty for that category.

test("sampleAffiliateCandidates: a top category with no matching template (e.g. 'news') yields no candidate for it, not a mislabeled life-category fallback", () => {
  const vec = emptyPreferenceVector();
  vec.categories.news = 6; // no SAMPLE_PRODUCT_TEMPLATES.news entry
  const out = sampleAffiliateCandidates(vec, {});
  assert.deepEqual(out, []); // must NOT silently substitute the 'life' templates
});

test("sampleAffiliateCandidates: 'humor' (also untemplated) yields no candidate either", () => {
  const vec = emptyPreferenceVector();
  vec.categories.humor = 6;
  const out = sampleAffiliateCandidates(vec, {});
  assert.deepEqual(out, []);
});

test("sampleAffiliateCandidates: mixing a templated and an untemplated top category only returns the templated one, correctly labeled", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6; // templated
  vec.categories.news = 5; // untemplated -- must be silently dropped, not faked
  const out = sampleAffiliateCandidates(vec, {});
  assert.ok(out.length >= 1);
  for (const c of out) {
    assert.notEqual(c.category, "news");
    assert.ok(!c.reasons[0].includes("뉴스"), `reason must never claim an untemplated category: ${c.reasons[0]}`);
  }
});

// ---- rotation regression (라운드1 검수 #1, 치명: "같은 광고 무한 반복") -------
//
// Root cause was `templates[(seed + i) % templates.length]` with
// `seed = cursor + 1` — an even client paging step (limit=10) kept the
// seed's parity fixed forever, so the picked template never changed. These
// tests cover both parities explicitly (the old tests only ever exercised
// even cursor steps and so never caught it).

test("sampleAffiliateCandidates: consecutive seeds of the SAME parity (even step) still rotate the pick", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  // seeds 1, 3, 5, ... are all odd -- exactly what `cursor+1` degenerates to
  // when a client pages with an even `limit`. The fix must not depend on
  // parity at all, so these must still differ across calls once excludeIds
  // (this user's just-shown ids) are threaded through, exactly as engine.js
  // now does.
  const seenTitles = [];
  let excludeIds = new Set();
  for (let i = 0; i < 3; i++) {
    const seed = 1 + i * 2; // 1, 3, 5 -- constant odd parity, like the old bug
    const [item] = sampleAffiliateCandidates(vec, { seed, excludeIds });
    seenTitles.push(item.title);
    excludeIds = new Set([item.id]);
  }
  assert.equal(new Set(seenTitles).size, seenTitles.length, `expected all-distinct picks, got ${JSON.stringify(seenTitles)}`);
});

test("sampleAffiliateCandidates: odd-parity seeds also rotate (both parities covered)", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  const seenTitles = [];
  let excludeIds = new Set();
  for (let i = 0; i < 3; i++) {
    const seed = 2 + i * 2; // 2, 4, 6 -- constant even parity
    const [item] = sampleAffiliateCandidates(vec, { seed, excludeIds });
    seenTitles.push(item.title);
    excludeIds = new Set([item.id]);
  }
  assert.equal(new Set(seenTitles).size, seenTitles.length, `expected all-distinct picks, got ${JSON.stringify(seenTitles)}`);
});

test("sampleAffiliateCandidates: excludeIds skips forward past a recently-shown id even with the SAME seed", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  const [first] = sampleAffiliateCandidates(vec, { seed: 7 });
  const [second] = sampleAffiliateCandidates(vec, { seed: 7, excludeIds: new Set([first.id]) });
  assert.notEqual(second.id, first.id);
});

test("sampleAffiliateCandidates: at least 3 distinct templates exist per learned category (rotation headroom)", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  const ids = new Set();
  for (let seed = 0; seed < 6; seed++) {
    const [item] = sampleAffiliateCandidates(vec, { seed });
    ids.add(item.id);
  }
  assert.ok(ids.size >= 3, `expected >=3 distinct templates in rotation, got ${ids.size}`);
});

// ---- makeSlotItem shape ------------------------------------------------------

test("makeSlotItem: carries the mandated Coupang disclosure text verbatim", () => {
  const item = candidate("ad1", 0.5);
  assert.equal(
    item.disclosure,
    "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다"
  );
  assert.equal(item.kind, "affiliate");
  assert.equal(item.via, "ad");
});

// ---- engine integration -------------------------------------------------------

test("engine: production mode (no credential, no preview) never shows an ad/affiliate item", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: null }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-prod-1");
    learnTech(user.preferences);
    let sawAd = false;
    for (let c = 0; c < 6; c++) {
      const feed = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
      if (feed.items.some((i) => i.kind === "ad" || i.kind === "affiliate")) sawAd = true;
      if (feed.exhausted) break;
    }
    assert.equal(sawAd, false);
  });
});

test("engine: AD_PREVIEW=1 shows [샘플] affiliate slots for a user with learned taste, obeying first-screen protection", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "9", AD_SKIP_FIRST: "4", AD_MAX_PER_PAGE: "2", AD_AB: null }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-preview-1");
    learnTech(user.preferences); // strong "tech" preference so sampleAffiliateCandidates has something to match

    const feed = await engine.getFeed(user.id, { cursor: 0, limit: 20 });
    const adItems = feed.items.filter((i) => i.kind === "affiliate");
    assert.ok(adItems.length > 0, "expected at least one preview affiliate slot");
    for (const a of adItems) {
      assert.ok(a.title.startsWith("[샘플]"));
      assert.equal(a.badgeLabel, "제휴광고 · 샘플");
      assert.ok(a.disclosure && a.disclosure.length > 0);
      assert.equal(a.disclosureShort, DISCLOSURE_SHORT_TEXT);
    }
    // first-screen protection: none of the first 4 rendered items are ads
    assert.ok(feed.items.slice(0, 4).every((i) => i.kind !== "affiliate"));
  });
});

test("engine: 19금 뷰(showAdult on)에는 제휴 슬롯이 노출되지 않는다", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-adult-1");
    learnTech(user.preferences);
    store.verifyAge(user.id);
    store.setShowAdult(user.id, true);

    let sawAd = false;
    for (let c = 0; c < 6; c++) {
      const feed = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
      if (feed.items.some((i) => i.kind === "affiliate")) sawAd = true;
      if (feed.exhausted) break;
    }
    assert.equal(sawAd, false);
  });
});

test("engine: 정치 필터가 켜진 뷰에는 제휴 슬롯이 노출되지 않는다", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-politics-1");
    learnTech(user.preferences);
    store.setTopicFilter(user.id, "politics", true);

    let sawAd = false;
    for (let c = 0; c < 6; c++) {
      const feed = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
      if (feed.items.some((i) => i.kind === "affiliate")) sawAd = true;
      if (feed.exhausted) break;
    }
    assert.equal(sawAd, false);
  });
});

// ---- round-2 review #2 (치명, "정치 게이트 갭") -------------------------------
// The old `monetizeAllowed` only checked the showTopics TOGGLE (whether
// politics/religion-tagged organic items are visible at all) — it never
// looked at the *category* of the ad candidate itself. A user who simply has
// "politics" as a top learned preference CATEGORY (taxonomy.js lists it
// alongside tech/auto/etc, independent of the politics/religion content-topic
// toggle) could still get a "정치 관심사와 관련있어요" ad candidate even with
// the topic toggle left off (its default). Candidates must be excluded by
// category at the source, regardless of any toggle.

test("pickAffiliateCandidates: a politics-category candidate is hard-excluded even with AD_PREVIEW=1 and the topics toggle OFF", () => {
  withEnv({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.politics = 6; // top preference CATEGORY, unrelated to the showTopics toggle
    const out = pickAffiliateCandidates(vec, {});
    assert.deepEqual(out, []);
  });
});

test("sampleAffiliateCandidates: never returns a politics or religion category candidate, regardless of learned weight", () => {
  const vec = emptyPreferenceVector();
  vec.categories.politics = 6;
  vec.categories.tech = 6; // a legitimate templated category alongside it
  const out = sampleAffiliateCandidates(vec, {});
  assert.ok(out.every((c) => c.category !== "politics"), "must never surface a politics-category candidate");
});

test("engine: a user whose TOP preference category is 'politics' (topic-filter toggle left OFF, its default) still never sees an ad", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-politics-cat-1");
    for (let i = 0; i < 8; i++) {
      applyFeedback(user.preferences, { category: "politics", tags: [], source: "clien", length: 200 }, 1);
    }
    // deliberately NOT calling store.setTopicFilter — toggle stays at its
    // default (off), which is exactly the gap round-2 flagged.

    let sawAd = false;
    for (let c = 0; c < 6; c++) {
      const feed = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
      if (feed.items.some((i) => i.kind === "affiliate")) sawAd = true;
      if (feed.exhausted) break;
    }
    assert.equal(sawAd, false);
  });
});

test("engine: ad slots never appear in the raw organic dedup pool (nextCursor tracks organic items only)", async () => {
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-cursor-1");
    learnTech(user.preferences);
    const feed = await engine.getFeed(user.id, { cursor: 0, limit: 20 });
    const organicCount = feed.items.filter((i) => i.kind !== "affiliate").length;
    assert.equal(feed.nextCursor, organicCount);
  });
});

// ---- rotation across an even-cursor paging session (라운드1 검수 #1, 치명) ----
// This is the exact regression scenario the review called out: a client
// paging with an EVEN `limit` (10) previously kept `seed = cursor + 1` at a
// fixed odd parity for the whole session, so the same [샘플] product repeated
// on every page. Assert the product actually changes across pages.
//
// AD_MAX_PER_SESSION is set to a large "effectively unlimited" number (1000)
// here on purpose, NOT "0" — 라운드2 검수 #4 redefined 0 as "block all ads"
// (see the store-cap test below), so these rotation tests need a cap that
// simply never binds across their few pages, not the old "0 = unlimited" reading.

test("engine: affiliate candidate rotates across pages when paging with an EVEN limit (10)", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "2", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "1", AD_MAX_PER_SESSION: "1000", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const user = store.createUser("mon-rotate-even-1");
      learnTech(user.preferences);

      const seenTitles = [];
      for (let page = 0; page < 4; page++) {
        const feed = await engine.getFeed(user.id, { cursor: page * 10, limit: 10 }); // even step, matches the bug report
        const ad = feed.items.find((i) => i.kind === "affiliate");
        if (ad) seenTitles.push(ad.title);
      }
      assert.ok(seenTitles.length >= 3, `expected several ad impressions across pages, got ${seenTitles.length}`);
      assert.ok(new Set(seenTitles).size > 1, `expected rotation, but every page showed: ${JSON.stringify(seenTitles)}`);
    }
  );
});

test("engine: affiliate candidate also rotates when paging with an ODD limit (both parities covered)", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "2", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "1", AD_MAX_PER_SESSION: "1000", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const user = store.createUser("mon-rotate-odd-1");
      learnTech(user.preferences);

      const seenTitles = [];
      let cursor = 0;
      for (let page = 0; page < 4; page++) {
        const feed = await engine.getFeed(user.id, { cursor, limit: 7 }); // odd step
        const ad = feed.items.find((i) => i.kind === "affiliate");
        if (ad) seenTitles.push(ad.title);
        cursor = feed.nextCursor;
      }
      assert.ok(seenTitles.length >= 3, `expected several ad impressions across pages, got ${seenTitles.length}`);
      assert.ok(new Set(seenTitles).size > 1, `expected rotation, but every page showed: ${JSON.stringify(seenTitles)}`);
    }
  );
});

// ---- round-2 review #3 (중대, "다중 카테고리 유저 → 항상 1위만") -----------------
// A page typically has just ONE due ad slot (default AD_EVERY=9), so
// `poolIdx=0` always picked `pool[0]` — and since candidates were rebuilt
// fresh, top-weighted-category-first, every single-slot call across an
// entire session kept landing on the #1 category. A user who picked
// tech/auto/gaming should see slots rotate across those categories, not see
// 6 straight tech slots.

test("sampleAffiliateCandidates: rotates which top category leads the pool across calls", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  vec.categories.auto = 5;
  vec.categories.gaming = 4;
  const firstCategories = [];
  for (let seed = 1; seed <= 6; seed++) {
    const out = sampleAffiliateCandidates(vec, { seed });
    firstCategories.push(out[0].category);
  }
  assert.ok(
    new Set(firstCategories).size > 1,
    `expected the leading category to rotate across calls, got ${JSON.stringify(firstCategories)}`
  );
});

test("engine: a user with multiple top categories sees ad slots rotate across those categories over a session, not just the #1 category", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "9", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "1", AD_MAX_PER_SESSION: "1000", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const user = store.createUser("mon-multicat-1");
      for (const cat of ["tech", "auto", "gaming"]) {
        for (let i = 0; i < 8; i++) {
          applyFeedback(user.preferences, { category: cat, tags: [], source: "clien", length: 200 }, 1);
        }
      }

      const seenCategories = [];
      let cursor = 0;
      for (let page = 0; page < 6; page++) {
        const feed = await engine.getFeed(user.id, { cursor, limit: 9 }); // == AD_EVERY -> ~1 ad slot per page
        const ad = feed.items.find((i) => i.kind === "affiliate");
        if (ad) seenCategories.push(ad.category);
        cursor = feed.nextCursor;
        if (feed.exhausted) break;
      }
      assert.ok(seenCategories.length >= 3, `expected several ad impressions across pages, got ${seenCategories.length}`);
      assert.ok(
        new Set(seenCategories).size > 1,
        `expected the ad category to rotate, but every slot was: ${JSON.stringify(seenCategories)}`
      );
    }
  );
});

// ---- session-total cap (라운드1 검수 #7) --------------------------------------

test("engine: AD_MAX_PER_SESSION stops serving ad slots once the session total is reached", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "1", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "5", AD_MAX_PER_SESSION: "3", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const user = store.createUser("mon-sesscap-1");
      learnTech(user.preferences);

      let totalAds = 0;
      let cursor = 0;
      for (let page = 0; page < 6; page++) {
        const feed = await engine.getFeed(user.id, { cursor, limit: 10 });
        totalAds += feed.items.filter((i) => i.kind === "affiliate").length;
        cursor = feed.nextCursor;
        if (feed.exhausted) break;
      }
      assert.equal(totalAds, 3, `expected the session cap (3) to be enforced, got ${totalAds}`);
    }
  );
});

// ---- round-2 review #4 (중대, "AD_MAX_PER_SESSION=0 = 무제한 버그") -------------
// `if (maxPerSession > 0)` skipped the cap block entirely when it was 0,
// which meant 0 behaved as "no cap" (unlimited) instead of AD_EVERY=0's
// "fully disabled" semantics. 0 must now mean zero ads, immediately.

test("engine: AD_MAX_PER_SESSION=0 disables ad slots entirely (0 = blocked, not unlimited)", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "1", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "5", AD_MAX_PER_SESSION: "0", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const user = store.createUser("mon-sesscap-zero-1");
      learnTech(user.preferences);

      let totalAds = 0;
      let cursor = 0;
      for (let page = 0; page < 6; page++) {
        const feed = await engine.getFeed(user.id, { cursor, limit: 10 });
        totalAds += feed.items.filter((i) => i.kind === "affiliate").length;
        cursor = feed.nextCursor;
        if (feed.exhausted) break;
      }
      assert.equal(totalAds, 0, `expected AD_MAX_PER_SESSION=0 to serve zero ads, got ${totalAds}`);
    }
  );
});

test("engine: source= narrow view thins ad density vs. the home feed (라운드1 검수 #8)", async () => {
  await withEnvAsync(
    { COUPANG_PARTNER_ID: null, AD_PREVIEW: "1", AD_EVERY: "3", AD_SKIP_FIRST: "0", AD_MAX_PER_PAGE: "10", AD_MAX_PER_SESSION: "1000", AD_AB: null },
    async () => {
      const store = new FeedStore({ clock: fixedClock });
      const engine = new FeedEngine(store, [new SeedSource()]);
      const homeUser = store.createUser("mon-narrow-home-1");
      const narrowUser = store.createUser("mon-narrow-src-1");
      learnTech(homeUser.preferences);
      learnTech(narrowUser.preferences);

      const homeFeed = await engine.getFeed(homeUser.id, { cursor: 0, limit: 30 });
      const narrowFeed = await engine.getFeed(narrowUser.id, { cursor: 0, limit: 30, source: "seed" });

      const homeAds = homeFeed.items.filter((i) => i.kind === "affiliate").length;
      const narrowAds = narrowFeed.items.filter((i) => i.kind === "affiliate").length;
      assert.ok(narrowAds <= homeAds, `expected source= view to show <= ads than home, got narrow=${narrowAds} home=${homeAds}`);
    }
  );
});

// ---- store: ad event tracking -------------------------------------------------

test("store: recordAdEvent tallies impressions/clicks and adResponsiveness needs a minimum sample", () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("adstat-1");
  assert.equal(store.adResponsiveness(user.id), null); // no data yet
  for (let i = 0; i < 4; i++) store.recordAdEvent(user.id, "ad_x", "impression");
  assert.equal(store.adResponsiveness(user.id, { minSample: 5 }), null); // below minSample
  store.recordAdEvent(user.id, "ad_x", "impression");
  store.recordAdEvent(user.id, "ad_x", "click");
  const ratio = store.adResponsiveness(user.id, { minSample: 5, baselineCtr: 0.02 });
  assert.ok(ratio > 0);
  const admin = store.adminAdStats();
  assert.equal(admin.impressions, 5);
  assert.equal(admin.clicks, 1);
});

test("store: nextAdSeed always advances, one call per invocation, regardless of caller's cursor step", () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("adseed-1");
  const seeds = [store.nextAdSeed(user.id), store.nextAdSeed(user.id), store.nextAdSeed(user.id)];
  assert.deepEqual(seeds, [1, 2, 3]);
});

test("store: adSeenIdsFor tracks a rolling window of recently-impressed ad ids", () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("adseen-1");
  assert.deepEqual([...store.adSeenIdsFor(user.id)], []);
  store.recordAdEvent(user.id, "ad_sample_tech_0", "impression");
  store.recordAdEvent(user.id, "ad_sample_tech_1", "impression");
  const seen = store.adSeenIdsFor(user.id);
  assert.ok(seen.has("ad_sample_tech_0"));
  assert.ok(seen.has("ad_sample_tech_1"));
  // clicks don't count as an impression/exposure
  store.recordAdEvent(user.id, "ad_sample_tech_2", "click");
  assert.equal(store.adSeenIdsFor(user.id).has("ad_sample_tech_2"), false);
});

test("store: adSlotsServedCount / recordAdSlotsServed track a session-total counter (라운드1 검수 #7)", () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("adcap-1");
  assert.equal(store.adSlotsServedCount(user.id), 0);
  store.recordAdSlotsServed(user.id, 2);
  store.recordAdSlotsServed(user.id, 1);
  assert.equal(store.adSlotsServedCount(user.id), 3);
});

// ---- lightweight regression guard on the client's ad-card rendering -----------

test("public/index.html renders the disclosure text and a distinct badge for ad/affiliate cards", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /appendAdCard/);
  assert.match(html, /ad-disclosure/);
  assert.match(html, /ad-badge/);
  assert.match(html, /item\.disclosure/);
  assert.match(html, /adSignal/);
});

// ---- round-1 review regressions: badge/color/reason-chip separation, top disclosure, impression dedup ----

test("public/index.html: ad badge uses its own color token, not the 🔥화제 hot-badge color", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  // the 🔥화제 hot badge is hardcoded #f0a13d in hotBadge() — the ad badge must not share that value
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*#f0a13d/);
  assert.match(html, /--ad:\s*#8b6cf0/); // dedicated ad color token exists
});

test("public/index.html: ad badge is explicitly left-aligned, overriding .badge's default margin-left:auto", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /\.card-top \.ad-badge\s*\{[^}]*margin-left:\s*0/);
});

test("public/index.html: ad badge label explicitly says 광고 (제휴광고), not just 제휴", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /badgeLabel\|\|"제휴광고"/);
});

test("public/index.html: ad reason chips use a distinct class/color from organic .why", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /class="ad-why"/); // appendAdCard's reason chip markup
  assert.match(html, /\.ad-why\s*\{/); // dedicated style, separate from .why
});

test("public/index.html: a short top-of-card disclosure line renders at >=13px, distinct from the bottom legal text", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /ad-disclosure-short/);
  assert.match(html, /item\.disclosureShort/);
  assert.match(html, /\.ad-disclosure-short\s*\{[^}]*font-size:\s*13px/);
});

test("public/index.html: discount % uses its own color token, not --like (green, used for the 👍 button)", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /\.ad-price \.off\s*\{[^}]*var\(--discount\)/);
  assert.doesNotMatch(html, /\.ad-price \.off\s*\{[^}]*var\(--like\)/);
});

test("public/index.html: ad impression dedup is per DOM card instance, not per (repeatable) item id (라운드1 검수 #2)", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /impressionLogged/); // per-element flag, not a module-level `logged` id Set
  assert.doesNotMatch(html, /const logged = new Set\(\)/);
});

// ---- round-2 review regressions: badge contrast, ad-why chip visibility, sample-note placement ----

// WCAG 2.1 relative-luminance/contrast-ratio formulas, used only to assert
// the ad badge's background+white-text pairing actually clears AA for small
// bold text (4.5:1) — a plain regex can't verify a numeric contrast ratio.
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function relLuminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(hexA, hexB) {
  const l1 = relLuminance(hexToRgb(hexA));
  const l2 = relLuminance(hexToRgb(hexB));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

test("public/index.html: the ad badge's background+white-text pairing clears WCAG AA (>=4.5:1) for small bold text (라운드2 검수 #5, 치명)", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tokenMatch = html.match(/--ad-badge-bg:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(tokenMatch, "expected a dedicated --ad-badge-bg color token");
  const bg = tokenMatch[1];
  const ratio = contrastRatio(bg, "#ffffff");
  assert.ok(ratio >= 4.5, `expected ad badge bg ${bg} vs white text to clear 4.5:1 AA, got ${ratio.toFixed(2)}:1`);
  // the badge itself must actually use the AA-compliant token, not the old (3.82:1) --ad
  assert.match(html, /\.card-top \.ad-badge\s*\{[^}]*var\(--ad-badge-bg\)/);
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*background:\s*var\(--ad\);/);
  // still visually distinct from every other card-top badge (round-1 requirement holds)
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*#f0a13d/);
});

test("public/index.html: the ad-why reason chip's background/border are visibly stronger than the round-1 baseline (라운드2 검수 #6, 경미)", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/\.ad-why\s*\{[^}]*background:\s*rgba\(139,108,240,\s*([\d.]+)\)[^}]*border:\s*1px solid rgba\(139,108,240,\s*([\d.]+)\)/);
  assert.ok(m, "expected .ad-why background/border to use rgba(139,108,240, alpha)");
  const [, bgAlpha, borderAlpha] = m.map(Number);
  assert.ok(bgAlpha > 0.14, `expected background alpha strengthened past the round-1 baseline (.14), got ${bgAlpha}`);
  assert.ok(borderAlpha > 0.32, `expected border alpha strengthened past the round-1 baseline (.32), got ${borderAlpha}`);
});

test("monetize.js: sampleAffiliateCandidates carries the sample disclaimer as a dedicated field, not buried in summary text (라운드2 검수 #7)", () => {
  const vec = emptyPreferenceVector();
  vec.categories.tech = 6;
  const [item] = sampleAffiliateCandidates(vec, {});
  assert.ok(item.sampleNote && item.sampleNote.length > 0, "expected a non-empty sampleNote field");
  assert.doesNotMatch(item.summary, /실제 판매/, "the '실제 판매 아님' disclaimer must not be embedded in summary text anymore");
});

test("public/index.html: the sample-not-real-product note renders next to the price row, not only inside the (2-line-clamped) summary", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /item\.sampleNote/);
  assert.match(html, /class="ad-sample-note"/);
  // it must be emitted from inside adPriceHtml (the price-row builder), not as a standalone summary concatenation
  const fnMatch = html.match(/function adPriceHtml\(item\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch && /sampleNote/.test(fnMatch[0]), "expected adPriceHtml to render item.sampleNote alongside the price");
});
