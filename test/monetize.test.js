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
  makeSlotItem,
  pickAffiliateCandidates,
  sampleAffiliateCandidates,
  DISCLOSURE_TEXT
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
      assert.equal(a.badgeLabel, "제휴 · 샘플");
      assert.ok(a.disclosure && a.disclosure.length > 0);
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
