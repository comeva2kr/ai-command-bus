import test from "node:test";
import { normalizeItem } from "../src/feed/content.js";
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
  buildHookCopy,
  hasBannedHookClaim,
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
// "tech 취향이 학습된 유저"를 만든다.
// 2026-08-02부터 좋아요 한 번은 **그 글에 대한 의견**이고 카테고리는 그 일부만
// 받는다(recommender.CATEGORY_STEP_RATIO) — 자동차 글 하나에 누른 좋아요가 곧
// "자동차 좋아함" 선언이 되던 문제를 없앤 변경이다. 그래서 같은 카테고리 취향에
// 도달하려면 예전보다 더 많은 반복이 필요하다. 여기서 횟수를 늘리는 것은
// 테스트를 코드에 맞춰 무르게 만드는 게 아니라, 헬퍼의 의도("이 유저는 tech를
// 확실히 좋아한다")를 새 학습 속도로 다시 표현하는 것이다.
// 태그가 빈 아이템이라 내용 신호는 없고 카테고리·소스로만 학습된다.
function learnTech(vec, times = 32) {
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

test("injectSlots: 가격·평점을 주장하는 상품 카드는 관련성 미달이면 자리를 비운다", () => {
  // 원래 규칙은 그대로 산다 — 특정 상품을 가격과 함께 들이미는데 문맥이 안 맞으면
  // 그건 스팸이다.
  const items = organicItems(10);
  const lowRelevance = [
    { ...candidate("ad1", 0.1), priceSale: 19900, rating: 4.5 },
    { ...candidate("ad2", 0.15), priceSale: 29900, rating: 4.2 }
  ];
  const { items: out, slots } = injectSlots(items, lowRelevance, {
    every: 9, skipFirst: 4, maxPerPage: 2, minRelevance: 0.3, startIndex: 0
  });
  assert.equal(slots.length, 0);
  assert.equal(out.length, items.length); // no filler inserted
});

test("injectSlots: 카테고리 배너는 관련성이 낮아도 자리를 비우지 않는다", () => {
  // 계약 정정 2026-08-06 (David "어떤 상황에서도 광고는 떠야지").
  // "쿠팡 도서"는 어느 글 옆에 놓아도 가격도 재고도 지어내지 않는다 — 스팸이
  // 아니다. 그런데 상품 카드와 같은 게이트에 묶여 있어서, 문맥이 안 맞는
  // 페이지는 광고가 통째로 0이 됐다.
  const items = organicItems(10);
  const banners = [candidate("banner1", 0.1), candidate("banner2", 0.15)];
  const { slots } = injectSlots(items, banners, {
    every: 9, skipFirst: 4, maxPerPage: 2, minRelevance: 0.3, startIndex: 0
  });
  assert.ok(slots.length > 0, "관련성이 낮다고 배너 자리까지 비웠다 — 그 페이지 수익이 0이다");
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
      // 후킹 카피 기능(2026-07-25) 이후: 헤드라인(title/hook)은 커뮤 후기톤이라
      // "[샘플]" 접두를 달지 않는다 — 그 표시는 이제 실제 상품명 보조 라인
      // (productName)에 붙는다(정직성 방어선). sampleNote("실제 판매 상품
      // 아님")는 계속 유지된다.
      assert.ok(c.productName && c.productName.length > 0, "expected a productName field");
      assert.ok(c.title && c.title.length > 0, "expected a non-empty hook headline");
      assert.notEqual(c.title, c.productName, "hook headline must differ from the raw product name");
      assert.ok(!hasBannedHookClaim(c.title), `hook must not contain a banned claim: "${c.title}"`);
      assert.equal(c.sample, true);
      assert.ok(c.sampleNote && c.sampleNote.includes("실제 판매"), "sampleNote disclaimer must still be present");
      assert.equal(c.disclosure, DISCLOSURE_TEXT);
    }
  });
});

test("pickAffiliateCandidates: 상품 피드가 없으면 실제 카테고리 배너로 채운다 (2026-08-04 계약 변경)", () => {
  // 예전 계약은 "빈 배열"이었다. 그 결과 **서비스 시작 이래 피드 광고 노출이
  // 0건**이었다 — 쿠팡 Open API 키가 서버에 없어 productFeed가 null이었고,
  // 그 상태를 "광고를 아예 안 낸다"로 처리했기 때문이다(라이브 실측: 응답
  // 30건 중 광고 카드 0, 노출·클릭 누적 0).
  //
  // "자격증명 없으면 광고 금지"의 취지는 **가짜 상품 카드 금지**다. 카테고리
  // 배너는 우리가 파트너스에서 받아 products.json에 넣어 둔 실제 링크이고
  // 가격도 상품명도 지어내지 않는다 — 발행 페이지가 이미 같은 배너를 쓴다.
  withEnv({ COUPANG_PARTNER_ID: "AF1234567", AD_PREVIEW: null }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.tech = 3;
    const out = pickAffiliateCandidates(vec, {}); // no opts.productFeed supplied
    assert.ok(out.length > 0, "후보가 0이면 피드 광고가 통째로 사라진다");
    assert.ok(out.every((c) => /^https:\/\/link\.coupang\.com\//.test(c.url)), "실제 파트너스 링크만");
    assert.ok(out.every((c) => c.priceSale == null && c.priceOriginal == null), "없는 가격을 만들지 않는다");
    assert.ok(out.every((c) => !c.sample), "샘플 카드가 아니다");
  });
});

test("pickAffiliateCandidates: 파트너 ID조차 없으면 여전히 광고가 0이다", () => {
  // 원래 원칙은 그대로다 — 자격증명 없이 제휴 카드를 내보내지 않는다.
  withEnv({ COUPANG_PARTNER_ID: null, AD_PREVIEW: null }, () => {
    const vec = emptyPreferenceVector();
    vec.categories.tech = 3;
    assert.deepEqual(pickAffiliateCandidates(vec, {}), []);
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

// ---- makeSlotItem: hook copy headline priority (2026-07-25 "후킹 카피") -------
// Headline priority is hook > title > productName. A bare `title` call (no
// hook/productName, the pre-existing calling convention used by `candidate()`
// above and any legacy caller) must keep working unchanged.

test("makeSlotItem: with no hook/productName, `title` alone is still the headline (backward compatible)", () => {
  const item = makeSlotItem({ id: "x1", category: "tech", title: "그냥 타이틀", summary: "s", url: "https://www.coupang.com/", relevance: 1 });
  assert.equal(item.title, "그냥 타이틀");
  assert.equal(item.hook, null);
  assert.equal(item.productName, null);
});

test("makeSlotItem: hook wins over title as the rendered headline; productName is carried separately", () => {
  const item = makeSlotItem({
    id: "x2",
    category: "tech",
    title: "보조배터리 (20000mAh 고속충전)", // legacy-style raw title, should NOT win
    hook: "출장·여행 짐 확 줄여주는 20000mAh, 이거 하나면 끝",
    productName: "보조배터리 (20000mAh 고속충전)",
    summary: "s",
    url: "https://www.coupang.com/",
    relevance: 1
  });
  assert.equal(item.title, "출장·여행 짐 확 줄여주는 20000mAh, 이거 하나면 끝");
  assert.equal(item.hook, "출장·여행 짐 확 줄여주는 20000mAh, 이거 하나면 끝");
  assert.equal(item.productName, "보조배터리 (20000mAh 고속충전)");
});

// ---- hook copy algorithm: buildHookCopy (2026-07-25 "후킹 카피") --------------
//
// 법적 가드레일: hasBannedHookClaim이 근거 없는 최상급/가짜 구매자수·평점/
// 검증 불가능한 사용 후 변화 수치를 잡아낸다 — buildHookCopy의 출력과 아래
// 커뮤톤 큐레이션 문구 전부가 이 체크를 통과해야 한다.

test("buildHookCopy: an explicit product.hook always wins over the fallback rule", () => {
  const hook = buildHookCopy({ category: "tech", name: "상품A", features: ["기능1"], hook: "직접 쓴 후킹 문구" });
  assert.equal(hook, "직접 쓴 후킹 문구");
});

test("buildHookCopy: falls back to a category+topFeature rule when no explicit hook is given", () => {
  const hook = buildHookCopy({ category: "tech", name: "상품A", features: ["초경량"] });
  assert.ok(hook && hook.length > 0);
  assert.ok(hook.includes("상품A"), `expected fallback headline to mention the product name, got "${hook}"`);
  assert.ok(hook.includes("초경량"), `expected fallback headline to use the top feature, got "${hook}"`);
});

test("buildHookCopy: fallback is deterministic (same category/name/features -> same headline every call)", () => {
  const input = { category: "gaming", name: "상품B", features: ["초저지연"] };
  const a = buildHookCopy(input);
  const b = buildHookCopy({ ...input });
  assert.equal(a, b);
});

test("buildHookCopy: with no features at all, still produces a non-empty category-only fallback headline", () => {
  const hook = buildHookCopy({ category: "life", name: "상품C" });
  assert.ok(hook && hook.length > 0);
  assert.ok(hook.includes("상품C"));
});

test("buildHookCopy: returns null when there's no name and no explicit hook (nothing to build from)", () => {
  assert.equal(buildHookCopy({ category: "tech", features: ["기능1"] }), null);
});

test("hasBannedHookClaim: flags baseless superlatives, fake purchase counts, and unverifiable post-use stats", () => {
  assert.ok(hasBannedHookClaim("업계 1위 보조배터리"));
  assert.ok(hasBannedHookClaim("무조건 사야 하는 이유"));
  assert.ok(hasBannedHookClaim("최저가 직구 찬스"));
  assert.ok(hasBannedHookClaim("100% 만족 보장"));
  assert.ok(hasBannedHookClaim("3000명이 구매한 인기템"));
  assert.ok(hasBannedHookClaim("후기 4.9점 받은 이유"));
  assert.ok(hasBannedHookClaim("3개월 써보니 배터리 20% 덜 닳음"));
});

test("hasBannedHookClaim: does not flag honest feature/situational hooks (allowed style)", () => {
  assert.ok(!hasBannedHookClaim("출장·여행 짐 확 줄여주는 20000mAh, 이거 하나면 끝"));
  assert.ok(!hasBannedHookClaim("노트북까지 이거 하나로 다 충전됨 (멀티포트 65W)"));
  assert.ok(!hasBannedHookClaim("요즘 난리난 이유가 있는 저소음 기계식 키보드"));
  assert.ok(!hasBannedHookClaim(null));
  assert.ok(!hasBannedHookClaim(""));
});

// ---- hook copy curated content: every sample template's hook + productName ----
// (2026-07-25 "후킹 카피") — exercises all 24 curated SAMPLE_PRODUCT_TEMPLATES
// entries (3 per category x 8 categories) via the public sampleAffiliateCandidates
// API (rotating idx 0..2 by seed with a single learned category so the pool
// offset stays fixed at 0), rather than reaching into the private template map.

const HOOK_TEMPLATE_CATEGORIES = ["tech", "auto", "science", "business", "gaming", "sports", "culture", "life"];

test("sampleAffiliateCandidates: every curated template across all 8 categories has a hook + productName, and no hook contains a banned claim", () => {
  let checked = 0;
  for (const cat of HOOK_TEMPLATE_CATEGORIES) {
    const vec = emptyPreferenceVector();
    vec.categories[cat] = 6;
    for (let seed = 0; seed < 3; seed++) {
      const [item] = sampleAffiliateCandidates(vec, { seed });
      assert.ok(item, `expected a candidate for category="${cat}" seed=${seed}`);
      assert.equal(item.category, cat);
      assert.ok(item.productName && item.productName.length > 0, `missing productName for ${cat}/${seed}`);
      assert.ok(!item.productName.startsWith("[샘플]"), `productName must be the bare product name (no [샘플] prefix), got "${item.productName}"`);
      assert.ok(item.title && item.title.length > 0, `missing hook headline for ${cat}/${seed}`);
      assert.notEqual(item.title, item.productName, `hook headline must differ from the raw product name for ${cat}/${seed}`);
      assert.ok(!hasBannedHookClaim(item.title), `hook contains a banned claim for ${cat}/${seed}: "${item.title}"`);
      checked++;
    }
  }
  assert.equal(checked, HOOK_TEMPLATE_CATEGORIES.length * 3, "expected to have exercised all 24 curated templates");
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
      // 헤드라인은 후킹 카피(hook), "[샘플]" 표시는 productName 보조 라인 쪽
      // (index.html adProductNameHtml)으로 옮겨졌다 — 배지·고지는 그대로.
      assert.ok(a.title && !a.title.startsWith("[샘플]"), `expected a hook headline without a [샘플] prefix, got "${a.title}"`);
      assert.ok(a.productName && a.productName.length > 0);
      // 2026-07-26 리디자인: 배지 라벨이 "제휴광고 · 샘플"(긴 라벨)에서
      // "AD · 샘플"(짧은 라벨)로 바뀌었다 — docs/monetization.md 참고.
      assert.equal(a.badgeLabel, "AD · 샘플");
      assert.ok(a.disclosure && a.disclosure.length > 0);
      // disclosureShort 필드는 하위호환으로 계속 채워지지만(값 자체는 그대로),
      // UI(index.html)는 더 이상 상시 렌더하지 않는다 — 배지 탭 시 뜨는
      // 팝오버가 item.disclosure(전문)만 사용한다.
      assert.equal(a.disclosureShort, DISCLOSURE_SHORT_TEXT);
    }
    // first-screen protection: none of the first 4 rendered items are ads
    assert.ok(feed.items.slice(0, 4).every((i) => i.kind !== "affiliate"));
  });
});


test("engine: 정치 글 **옆에는** 광고가 붙지 않는다 (사용자 단위 차단이 아니라 글 단위)", async () => {
  // 계약 정정 2026-08-06. 예전 계약은 "정치 보기를 켠 사용자에게는 광고 0"이었다.
  // 취지는 옳았지만 도구가 틀렸다 — 그 토글을 한 번 켠 사람은 그 뒤로 영원히
  // 광고가 0이 된다. David가 정치글 보기를 켠 뒤 "쿠팡 광고 안 뜬다"고 반복해서
  // 말한 원인이 이것이었다.
  //
  // 정작 필요한 보호는 **글 단위**다: injectSlots가 광고를 꽂기 전에 위아래
  // 이웃을 adUnsafe()로 검사해 정치·종교·비속어 글 옆이면 그 자리를 건너뛴다.
  // 이 테스트는 그 보호가 실제로 도는지를 고정한다.
  await withEnvAsync({ COUPANG_PARTNER_ID: null, AD_PREVIEW: "1" }, async () => {
    const store = new FeedStore({ clock: fixedClock });
    const engine = new FeedEngine(store, [new SeedSource()]);
    const user = store.createUser("mon-politics-1");
    learnTech(user.preferences);
    store.setTopicFilter(user.id, "politics", true);

    let checked = 0;
    for (let c = 0; c < 6; c++) {
      const feed = await engine.getFeed(user.id, { cursor: c * 20, limit: 20 });
      const items = feed.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind !== "affiliate") continue;
        checked++;
        for (const nb of [items[i - 1], items[i + 1]]) {
          if (!nb || nb.kind === "affiliate") continue;
          const t = Array.isArray(nb.topics) ? nb.topics : [];
          assert.ok(!t.includes("politics") && !t.includes("religion"),
            `정치·종교 글 옆에 광고가 붙었다: ${nb.title}`);
          assert.ok(nb.category !== "politics" && nb.category !== "religion",
            `정치·종교 분류 글 옆에 광고가 붙었다: ${nb.title}`);
        }
      }
      if (feed.exhausted) break;
    }
    // 사용자 단위로 막지 않으므로 광고는 나와야 한다 — 안 나오면 수익이 0이다.
    assert.ok(checked > 0, "정치 보기를 켠 사용자에게 광고가 한 건도 안 나갔다");
  });
});

test("세션 총량 상한을 두지 않는다 — 촘촘함은 밀도가 막는다", async () => {
  // David 2026-08-06: "광고에 상한선이 왜 필요해? 일정 컨텐츠 → 광고는 계속
  // 반복되어야지. 너무 자주 나오지 않는 선에서."
  //
  // 총량 상한이 하는 일은 하나뿐이었다 — 많이 읽는 사람일수록 광고를 덜 보게
  // 만드는 것. 실측(6일 때): 12페이지를 넘겨도 6건에서 멈췄다.
  const { adParams } = await import("../src/feed/monetize.js");
  const p = adParams();
  assert.ok(p.maxPerSession < 0,
    `세션 상한 ${p.maxPerSession} — 상한이 되살아나면 많이 읽는 사용자의 수익이 묶인다`);
  // 대신 밀도는 살아 있어야 한다 — 없으면 광고판이 된다.
  assert.ok(p.every >= 5, `광고 간격 ${p.every}칸 — 너무 촘촘하다`);
  assert.ok(p.maxPerPage <= 3, `요청당 ${p.maxPerPage}개 — 한 화면이 광고로 찬다`);
  assert.ok(p.skipFirst >= 4, `앞 ${p.skipFirst}칸 — 첫 화면이 광고로 시작한다`);
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
      // learnTech와 같은 이유로 반복 횟수를 늘렸다 — 카테고리 취향은 이제
      // 반복된 일관 근거로만 쌓인다(recommender.CATEGORY_STEP_RATIO).
      for (const cat of ["tech", "auto", "gaming"]) {
        for (let i = 0; i < 32; i++) {
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

test("public/index.html: ad badge uses its own neutral color token, not the 🔥화제 hot-badge color or a brand accent (2026-07-26 리디자인: 배지 톤을 브랜드 보라에서 중립 회색으로)", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  // the 🔥화제 hot badge is hardcoded #f0a13d in hotBadge() — the ad badge must not share that value
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*#f0a13d/);
  assert.match(html, /--ad-badge-bg:\s*#[0-9a-fA-F]{6}/); // dedicated ad badge color token exists
  // must not reuse the accent (blue, used for CTAs/links) or like (green) tokens either
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*background:\s*var\(--accent\)/);
  assert.doesNotMatch(html, /\.card-top \.ad-badge\s*\{[^}]*background:\s*var\(--like\)/);
});

test("public/index.html: ad badge is right-aligned (margin-left:auto), sitting in the organic category-tag position — David 2026-07-26 format-match", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  // AD 배지는 유기 카드의 카테고리("뉴스") 라벨과 같은 우상단 위치로 — 단어는
  // 반드시 "AD"라 위장 아님(아래 별도 테스트가 문구를 검증). 좌상단엔 소스명(쿠팡파트너스).
  assert.match(html, /\.card-top \.ad-badge\s*\{[^}]*margin-left:\s*auto/);
});
test("public/index.html: ad card carries source (쿠팡파트너스) top-left and shows metrics only from real data", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  // 하단 지표 행은 실측(rating/reviewCount/bestseller)만으로 구성 — 없으면 생략(가짜 금지)
  assert.match(html, /function adMetaHtml/);
  assert.match(html, /if\(!parts\.length\) return ""/);
});

// 2026-07-26 리디자인: 배지 문구가 "제휴광고"(긴 라벨)에서 "AD"(짧은 라벨)로
// 축소됐다 — 다만 David 최종지시의 금지선("추천/IT/카테고리 등으로 위장
// 금지", 기사형광고 규제선)은 그대로 지켜야 하므로, 배지가 "AD"/"광고"라는
// 뜻이 명확한 단어만 쓰고 카테고리명·추천 문구로 대체되지 않았는지도 함께
// 검증한다.
test("monetize.js: makeSlotItem's badgeLabel is always exactly 'AD' or 'AD · 샘플', regardless of category", () => {
  for (const sample of [true, false]) {
    const item = makeSlotItem({ id: "badge-check", category: "tech", title: "t", summary: "s", url: "https://www.coupang.com/", relevance: 1, sample });
    assert.equal(item.badgeLabel, sample ? "AD · 샘플" : "AD");
  }
});

test("public/index.html: the disclosure line is NO LONGER persistently rendered — old .ad-disclosure-short/item.disclosureShort render calls are gone", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /ad-disclosure-short/);
  const fnMatch = html.match(/function appendAdCard\(item\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find appendAdCard's function body");
  assert.doesNotMatch(fnMatch[0], /item\.disclosureShort/, "the top-of-card short disclosure line must no longer be rendered");
});

test("public/index.html: the price/discount block is fully removed — no .ad-price render, no adPriceHtml function", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /function adPriceHtml/);
  assert.doesNotMatch(html, /class="ad-price"/);
  const fnMatch = html.match(/function appendAdCard\(item\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find appendAdCard's function body");
  assert.doesNotMatch(fnMatch[0], /adPriceHtml\(item\)/, "appendAdCard must no longer call a price renderer");
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

// 2026-07-26 리디자인: 가격 블록 자체가 사라졌으므로 "가격 줄 옆 sampleNote"
// 렌더도 함께 사라진다 — 샘플 여부는 이제 productName 보조 라인의 "[샘플]"
// 표시(adProductNameHtml) 하나로 충분하다(David 최종지시 #3). sampleNote
// 필드는 monetize.js가 하위호환으로 계속 채우지만(데이터 레벨 테스트는
// 위 "monetize.js: sampleAffiliateCandidates carries..." 참고) UI는 더 이상
// 별도로 렌더하지 않는다.
test("public/index.html: item.sampleNote / .ad-sample-note are no longer rendered — [샘플] now lives only on the productName subtitle line", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /class="ad-sample-note"/);
  const fnMatch = html.match(/function appendAdCard\(item\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find appendAdCard's function body");
  assert.doesNotMatch(fnMatch[0], /item\.sampleNote/, "appendAdCard must not render item.sampleNote anymore");
});

// ---- round: hook copy client render (2026-07-25 "후킹 카피") ------------------
// Headline (h3) now renders item.title (hook-first per makeSlotItem), and a
// new subtitle line renders item.productName right below it — the honesty
// backstop so the user can always tell what the real product is, even though
// the headline itself is a community-review-toned hook sentence. Badge and
// disclosure markup must be completely unchanged (regression guard).

test("public/index.html: the [샘플] tag is appended on the productName subtitle line, not stripped from it, when item.sample is true", () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const fnMatch = html.match(/function adProductNameHtml\(item\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find adProductNameHtml's function body");
  assert.match(fnMatch[0], /item\.sample/);
  assert.match(fnMatch[0], /\[샘플\]/);
});

// 2026-07-26 리디자인 이후 버전: 배지(badgeLabel)는 여전히 렌더되지만,
// 고지문은 이제 상시 렌더 두 줄(disclosureShort/하단 전문) 대신 배지 탭
// 팝오버(item.disclosure) 하나로 통합됐다 — hook/productName 라인은 회귀 없이
// 그대로다.
test("ads.txt: ADSENSE_CLIENT 설정 시 판매자 라인, 미설정 시 404", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const prev = process.env.ADSENSE_CLIENT;
  try {
    delete process.env.ADSENSE_CLIENT;
    let server = createServer({});
    await new Promise((r) => server.listen(0, r));
    let base = `http://localhost:${server.address().port}`;
    assert.equal((await fetch(`${base}/ads.txt`)).status, 404, "미설정이면 404");
    server.close();

    process.env.ADSENSE_CLIENT = "ca-pub-1234567890123456";
    server = createServer({});
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
    const txt = await (await fetch(`${base}/ads.txt`)).text();
    assert.equal(txt.trim(), "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
      "ads.txt 표기는 ca- 접두사를 뗀 pub- ID여야");
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"),
      "index.html에 애드센스 로더가 주입되어야");
    server.close();

    delete process.env.ADSENSE_CLIENT;
    server = createServer({});
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
    const clean = await (await fetch(`${base}/`)).text();
    assert.ok(!clean.includes("adsbygoogle"), "미설정 배포는 완전 무광고");
    server.close();
  } finally {
    if (prev === undefined) delete process.env.ADSENSE_CLIENT;
    else process.env.ADSENSE_CLIENT = prev;
  }
});

test("privacy.html: 개인정보처리방침이 존재하고 실수집 항목·광고 고지를 담는다", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "privacy.html");
  const html = fs.readFileSync(p, "utf8");
  // 실제로 수집하는 것만 적혀 있어야 한다 — 없는 수집 항목을 적으면 그게 거짓
  assert.match(html, /소셜 로그인/);
  assert.match(html, /닉네임/);
  assert.match(html, /비밀번호는 수집하지 않습니다/);
  assert.match(html, /AdSense/, "애드센스 쿠키 고지는 심사 필수");
  assert.match(html, /쿠팡 파트너스/, "제휴 고지");
  assert.match(html, /comeva2kr@gmail\.com/, "문의처");
});

test("adfit: 광고단위는 env + 승인 플래그가 모두 있을 때만 노출되고, 애드핏은 페이지당 1회만 쓴다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const prevUnit = process.env.ADFIT_UNIT_MOBILE;
  const prevOn = process.env.ADFIT_ENABLED;
  // 서버는 assert가 던져도 반드시 닫는다 — 안 닫으면 테스트 러너가
  // 핸들이 살아 있어 그대로 멈춘다(2026-08-04에 실제로 10분 행이 났다).
  const withServer = async (fn) => {
    const server = createServer({});
    await new Promise((r) => server.listen(0, r));
    try { return await fn(server.address().port); }
    finally { server.close(); }
  };
  try {
    // 2026-08-04 계약 추가: 심사 보류 상태의 애드핏은 onfail을 부르지 않으면서
    // 아무것도 안 보여준다(실측). 크로스오리진이라 채워졌는지 알 수 없어
    // 패스백으로도 못 잡으므로, 승인 전에는 지면 자체를 내주지 않는다.
    process.env.ADFIT_UNIT_MOBILE = "DAN-testunit";
    process.env.ADFIT_ENABLED = "1";
    let cfg = await withServer(async (port) => (await fetch(`http://localhost:${port}/api/config`)).json());
    assert.equal(cfg.adfit.mobileUnit, "DAN-testunit");

    delete process.env.ADFIT_ENABLED;
    cfg = await withServer(async (port) => (await fetch(`http://localhost:${port}/api/config`)).json());
    assert.equal(cfg.adfit.mobileUnit, null, "승인 전에는 빈 지면을 만들지 않는다");

    process.env.ADFIT_ENABLED = "1";
    delete process.env.ADFIT_UNIT_MOBILE;
    cfg = await withServer(async (port) => (await fetch(`http://localhost:${port}/api/config`)).json());
    assert.equal(cfg.adfit.mobileUnit, null, "광고단위 미설정 배포는 배너 없음");
  } finally {
    if (prevUnit === undefined) delete process.env.ADFIT_UNIT_MOBILE;
    else process.env.ADFIT_UNIT_MOBILE = prevUnit;
    if (prevOn === undefined) delete process.env.ADFIT_ENABLED;
    else process.env.ADFIT_ENABLED = prevOn;
  }

  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html"), "utf8");
  // 애드핏 지면은 2026-08-06부터 전용 함수(ensureAdfitPlacement)가 만든다 —
  // 심사 보류 상태의 빈 지면이 쿠팡 수익 슬롯을 먹던 것을 떼어낸 결과다.
  // 두 함수를 함께 본다: 지면 계약은 앞쪽, 쿠팡 슬롯 계약은 뒤쪽에 있다.
  const fn = html.slice(html.indexOf("function ensureAdfitPlacement"), html.indexOf("// Soft, dismissible"));
  assert.ok(fn.includes('getElementById("adfitSlot")'), "애드핏은 페이지당 1회 — 같은 광고단위 중복 노출 금지");
  // 계약 변경 2026-08-03: 예전엔 "4번째 카드 뒤에 딱 1개"였다. 실기기에서
  // David가 "제일 하단에만 하나 띡 들어가 있으면 누가 이걸 보지도 못하겠다"고
  // 지적했고, 실제로 지면이 1개면 스크롤하는 사용자 대부분에게 노출이 0이다.
  // 이제 AD_FIRST 뒤부터 AD_EVERY마다 들어가고, 애드핏 자리 하나를 뺀 나머지는
  // 쿠팡 제휴 카드가 채운다. 첫 화면 보호(AD_FIRST >= 4)는 그대로다.
  assert.ok(Number(html.match(/const AD_FIRST = (\d+)/)[1]) >= 4, "첫 화면은 콘텐츠로만");
  assert.ok(fn.includes("display:none"), "애드핏 실광고 수신 전 빈 박스 금지");
  assert.ok(fn.includes("if(!unit && !cp) return;"), "지면이 채울 게 없으면 만들지 않는다");
  assert.match(html, /maybeInsertAdfit\(\);/, "loadMore에서 호출되어야");
  assert.match(html, /ensureAdfitPlacement\(\);/, "애드핏 지면도 loadMore에서 호출되어야");
  // David 2026-08-03: "제일 하단에만 하나 띡 들어가 있으면 누가 이걸 보지도
  // 못하겠다." 목록 끝에 붙이면 스크롤하는 사용자 대부분에게 노출이 0이다.
  assert.ok(!/feed\.appendChild\(slot\)/.test(html), "애드핏 지면이 목록 끝에 붙었다");
});

test("광고: 판정은 서버가 하고 화면은 그 표시를 읽는다", async () => {
  // 2026-08-05 전수검사: 광고를 꽂는 곳이 둘인데 서로를 몰랐다.
  //   서버 injectSlots      — adUnsafe 검사 있음
  //   화면 maybeInsertAdfit — 검사 없음 → 욕설·정치 글 옆에 제휴 카드가 붙었다
  // 화면이 같은 규칙을 다시 구현하면 두 벌이 되어 또 어긋난다. 서버가 판정하고
  // 결과만 실어 보낸다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const src = {
    id: "clien", kind: "community",
    async fetch() {
      // 실제 경로처럼 정규화를 거친다 — 토픽 분류가 여기서 붙는다
      return [
        normalizeItem({ title: "오늘 점심 뭐 먹지", url: "https://x/1", source: "clien", category: "life" }),
        normalizeItem({ title: "정청래 한동훈 발언 논란", url: "https://x/2", source: "clien", category: "news" })
      ];
    }
  };
  const items = await new FeedEngine(null, [src]).pool();
  const safe = items.find((i) => /점심/.test(i.title));
  const pol = items.find((i) => /정청래/.test(i.title));
  assert.equal(safe.adUnsafe, false, "평범한 글 옆에는 광고를 붙일 수 있어야 한다");
  assert.equal(pol.adUnsafe, true, "정치 글 옆에 광고가 붙으면 안 된다");

  // 화면이 그 표시를 실제로 쓰는지 — 안 쓰면 서버가 표시해도 소용없다
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  assert.match(html, /card\.dataset\.adUnsafe = "1"/, "카드에 표시를 안 싣는다");
  assert.match(html, /anchor\.dataset\.adUnsafe \|\| \(nextCard && nextCard\.dataset\.adUnsafe\)/,
    "광고 자리를 고를 때 표시를 안 본다");
});

test("광고: 화면이 꽂은 카드도 클릭을 보고한다", async () => {
  // 예전엔 노출만 보냈다. 그러면 클릭률의 분모만 커지고 분자는 안 커진다 —
  // 서버는 그 낮은 값을 보고 adaptiveEvery로 광고를 스스로 성글게 낸다.
  // 돈 되는 자리를 우리 손으로 줄이고 있었다.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 함수 전체를 본다. 예전엔 앞 4000자만 잘라 봤는데, 주석 몇 줄이 늘자
  // 클릭 보고 줄이 창 밖으로 밀려 멀쩡한 코드가 빨간불이 났다(2026-08-06).
  const start = html.indexOf("function maybeInsertAdfit");
  const end = html.indexOf("\nfunction ", start + 30);
  const block = html.slice(start, end > start ? end : start + 12000);
  assert.match(block, /observeAdImpression\(slot/, "노출 보고가 사라졌다");
  assert.match(block, /API\.adSignal\(state\.userId, `feed\$\{i \+ 1\}`, "click"/, "클릭 보고가 없다");

  // 낮은 클릭률이 실제로 광고를 성글게 만든다는 것도 함께 고정한다
  const { adaptiveEvery } = await import("../src/feed/monetize.js");
  const base = 9;
  assert.ok(adaptiveEvery(base, 0.3) > base, "반응이 낮으면 성글어져야 한다(그래서 클릭 누락이 비쌌다)");
  assert.ok(adaptiveEvery(base, 2.0) < base, "반응이 높으면 촘촘해져야 한다");
});

test("애드핏 폴백: 지면을 지우지 않고 접는다", async () => {
  // 2026-08-05 애드핏 매체 심사 보류 사유:
  //   "광고를 설치한 이후 심사 진행이 가능합니다."
  // 그런데 우리 폴백은 3초 뒤 slot.innerHTML을 쿠팡 카드로 통째로 갈아치웠다 —
  // **애드핏 지면이 DOM에서 사라진다.** 심사관이 3초만 지나 봐도 볼 광고가 없었다.
  // David 실기기 확인: "애드핏은 안 보이고 쿠팡 파트너스만 보여."
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const from = html.indexOf("function adfitFallback(slot){");
  const block = html.slice(from, html.indexOf("\n}\n", from));

  // 애드핏 ins를 갈아치우지 않는다
  assert.doesNotMatch(block, /slot\.innerHTML\s*=/, "애드핏 지면을 통째로 갈아치운다");
  assert.match(block, /slot\.style\.display = "none"/, "빈 칸을 접지 않는다");
  assert.match(block, /dataset\.adCollapsed/, "접힌 상태 표시가 없다");
  // 쿠팡은 **새 카드**로 덧붙인다
  assert.match(block, /insertAdjacentElement\("afterend", alt\)/, "쿠팡을 새 카드로 붙이지 않는다");
  // 폴백 카드도 클릭을 보고한다 — 안 그러면 또 클릭률 분모만 커진다
  assert.match(block, /API\.adSignal\(state\.userId, "feed-passback", "click"/, "폴백 카드 클릭 보고 누락");
});

test("광고: 승인 전 애드핏은 지면 자체를 내주지 않는다 (빈 칸 금지)", async () => {
  // David 2026-08-06: "쿠팡 파트너스 광고 또 안 뜬다 자리만 차지하고 링크 없어.
  // 재발 안 되게 해라 진짜."
  //
  // 애드핏은 승인 전까지 지면을 만들되 아무것도 채우지 않는다. 화면에는
  // "제휴 광고 / AD"와 고지문만 남은 169px 빈 칸이 생기고, 크로스오리진이라
  // 비었는지 알 수 없어 폴백도 안 걸린다. 사용자에게는 깨진 화면, 수익은 0.
  //
  // 3차 반려("광고를 설치한 이후 심사 진행이 가능합니다") 때문에 켰던 것인데,
  // 4차 반려 사유는 "자체 콘텐츠 비중"으로 바뀌었다 — 지면 설치는 쟁점이 아니다.
  const { readFileSync } = await import("node:fs");
  const compose = readFileSync("deploy/docker-compose.yml", "utf8");
  const m = compose.match(/ADFIT_ENABLED=\$\{ADFIT_ENABLED:-(\d)\}/);
  assert.ok(m, "ADFIT_ENABLED 기본값 설정을 찾을 수 없다");
  assert.equal(m[1], "0",
    "기본값이 켜짐이면 새 배포마다 빈 광고 칸이 되살아난다 — 재심사 직전에만 켠다");

  // 배선은 지운 게 아니다. 승인되면 되살릴 수 있어야 한다.
  const html = readFileSync("src/feed/public/index.html", "utf8");
  assert.match(html, /function ensureAdfitPlacement\(\)/, "애드핏 배선이 통째로 사라졌다");
  assert.match(html, /if\(!unit \|\| document\.getElementById\("adfitSlot"\)\) return;/,
    "광고단위가 없을 때 지면을 안 그리는 가드가 없다");
});

test("광고가 0이 되는 길이 남아 있지 않다 (David 2026-08-06 '어떤 상황에서도 광고는 떠야지')", async () => {
  // 사흘 동안 광고가 됐다 안 됐다 한 원인을 한자리에 고정한다. 아래 넷이
  // **동시에** 걸려 있었고, 하나씩 고치면 다른 하나가 남아 또 0이 됐다.
  const { readFileSync } = await import("node:fs");
  const engine = readFileSync("src/feed/engine.js", "utf8");
  const mon = readFileSync("src/feed/monetize.js", "utf8");

  // ① 사용자 단위 차단 — 정치·종교 보기를 켜면 그 사람은 영원히 광고 0이었다.
  assert.ok(!/const monetizeAllowed = !showTopics/.test(engine),
    "사용자 단위 광고 차단이 되살아났다 — 토글 한 번이면 그 사람 수익이 영구히 0이다");
  assert.ok(!/latestMonetizeAllowed/.test(engine), "최신 탭에 사용자 단위 차단이 남아 있다");

  // ② 세션 상한 — 밀도가 아니라 이 값이 수익을 묶고 있었다(하루 6건).
  const { adParams } = await import("../src/feed/monetize.js");
  assert.ok(adParams().maxPerSession < 0, "세션 총량 상한이 되살아났다 — 많이 읽을수록 광고가 줄어든다");

  // ③ 관련성 게이트 — 배너까지 묶어 문맥 안 맞는 페이지를 0으로 만들었다.
  assert.match(mon, /const pool = relevant\.length \? relevant : claimless;/,
    "관련성 미달일 때 배너 폴백이 사라졌다");

  // ④ 반응 적응 — 안 보여서 안 눌리는데 더 성글게 내는 자기 강화 고리.
  assert.match(mon, /clamp\(1 \/ \(1 \+ sensitivity \* \(r - 1\)\), 0\.5, 1\.15\)/,
    "낮은 클릭률이 광고를 무한정 성글게 만들 수 있다");

  // 브랜드 안전은 글 단위로 계속 지킨다 — 이건 약해지면 안 된다.
  const promo = readFileSync("src/feed/promotion.js", "utf8");
  assert.match(promo, /item\.category === "politics" \|\| item\.category === "religion"/,
    "글 단위 보호가 topics만 보고 분류를 안 본다");
  assert.match(mon, /const neighborUnsafe = adUnsafe\(items\[i - 1\]\) \|\| adUnsafe\(item\);/,
    "광고 인접 안전검사가 사라졌다");
});

// ── 광고 카드 통합 계약 (2026-08-06) ─────────────────────────────────────────
//
// 예전에는 광고를 그리는 곳이 둘이었다. 서버가 꽂은 광고는 appendAdCard가
// 유기 카드 비슷한 마크업으로, 화면이 꽂은 광고는 coupangCardHtml이 3단 카드로
// 그렸다. **같은 광고인데 어느 경로로 왔느냐에 따라 다르게 생겼다.**
// 한쪽을 고치면 다른 쪽이 그대로 남아, David가 "하나 고치면 하나 틀어진다"고
// 한 상태가 반복됐다. 아래 테스트들은 그 둘이 다시 갈라지는 것을 막는다.

test("광고 카드는 한 곳에서만 그린다 — 서버 경로도 같은 함수를 쓴다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function appendAdCard(item){"),
                        html.indexOf("// 슬롯 노출 로깅"));
  assert.match(fn, /coupangCardHtml\(link,/, "서버 광고가 다시 자기만의 마크업을 그린다");
  assert.ok(!/card-row|adProductNameHtml|ad-disclosure-pop/.test(fn),
    "옛 두 번째 렌더러가 되살아났다");
  // 화면 삽입 경로도 같은 함수를 쓴다.
  const ins = html.slice(html.indexOf("function maybeInsertAdfit(){"),
                         html.indexOf("function maybeInsertAdfit(){") + 6000);
  assert.match(ins, /coupangCardHtml\(link,/, "화면 삽입 경로가 다른 마크업을 쓴다");
});

test("광고 카드에 법적 요건이 항상 들어간다 — AD 배지와 대가성 고지문", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function coupangCardHtml("),
                        html.indexOf("// 문맥에 맞는 제휴 링크를 고른다"));
  // 배지는 조건 없이 항상 그린다 — 토글 뒤에 숨기지 않는다.
  assert.match(fn, /class="badge ad-badge-static">AD/, "AD 배지가 사라졌다");
  assert.match(fn, /sr-only"> 광고<\/span>/, "스크린리더용 표시가 사라졌다");
  // 고지문은 **상시 노출**이다. 예전엔 배지를 눌러야 보이는 팝오버였는데,
  // 지금은 카드 안에 그대로 있다 — 요건 면에서 더 강하다.
  assert.match(fn, /<p class="ad-disclosure">\$\{escapeHtml\(disclosure\)\}<\/p>/,
    "대가성 고지문이 카드에서 사라졌다");
});

test("광고 카드가 3단(문구·본문·CTA)과 도착지를 모두 갖춘다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function coupangCardHtml("),
                        html.indexOf("// 문맥에 맞는 제휴 링크를 고른다"));
  assert.match(fn, /<h3>\$\{escapeHtml\(v\.hook\)\}<\/h3>/, "제목(hook)이 없다");
  assert.match(fn, /class="ad-brand">\$\{escapeHtml\(v\.line \|\| link\.brand\)\}/, "본문(line)이 없다");
  assert.match(fn, /class="ad-cta">\$\{escapeHtml\(v\.cta \|\| /, "CTA가 없다");
  assert.match(fn, /class="ad-dest">\$\{escapeHtml\(link\.brand\)\}/, "도착지 표시가 없다");
  // 썸네일은 있을 때만 — 없으면 글자 카드로 완결된다.
  assert.match(fn, /link\.img\?`<div class="ad-thumb">/, "썸네일 조건부 렌더가 깨졌다");
  assert.match(fn, /onerror="this\.parentNode\.remove\(\)"/, "이미지 차단 시 폴백이 없다");
});

test("대가성 고지문 스타일이 한 곳에만 정의된다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 세 곳에 흩어져 크기가 서로 달랐다(11.5 / 11.5 / .ad-net은 12.5px).
  // 같은 문구가 카드마다 다른 크기로 나왔고 줄바꿈도 어색했다
  // (David 2026-08-06: "폰트 커지고 줄바꿈도 이상하네").
  const defs = html.match(/\.ad-disclosure\{/g) || [];
  assert.equal(defs.length, 1, `고지문 스타일이 ${defs.length}곳에 정의돼 있다`);
  assert.ok(!/\.ad-disclosure\{[^}]*text-wrap:balance/.test(html),
    "고지문에 text-wrap:balance가 남아 줄바꿈이 어색해진다");
});

test("광고 카드는 어느 자리에 있든 같은 모양이다 — 스코프로 갈라지지 않는다", async () => {
  // 실측(2026-08-06): 같은 광고가 피드에서는 썸네일 88x88, 상세 화면에서는
  // 76x76이었다. 기본값 76px 위에 `#feed .card ...`가 88px로 덮는 구조라,
  // #feed 밖(상세·모달)에서는 덮개가 안 닿았다.
  //
  // "같은 광고인데 자리마다 다르게 생긴다"가 David가 반복해서 지적한 것이고,
  // 렌더러를 하나로 합친 뒤 마지막까지 남아 있던 조각이 이 CSS 스코프였다.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");

  // 광고 썸네일 크기를 정하는 규칙은 하나여야 하고, #feed에 갇히면 안 된다.
  // **주석을 먼저 걷어낸다.** 이 검사를 처음 쓸 때 정규식이 내가 쓴 주석 안의
  // "#feed .card …" 문구를 잡아서 거짓 실패를 냈다. 검사 대상은 규칙이지 설명이 아니다.
  const css = html.replace(/\/\*[\s\S]*?\*\//g, "");
  const scoped = css.match(/#feed[^{;]*\.ad-native \.ad-thumb\{/g) || [];
  assert.equal(scoped.length, 0,
    "광고 썸네일 크기가 #feed 안에서만 적용된다 — 상세 화면에서 달라진다");
  assert.match(css, /\.card \.ad-native \.ad-thumb\{[^}]*width:88px/,
    "광고 썸네일이 콘텐츠(88px)와 다른 크기다");
});

test("낡은 화면은 스스로 갱신한다 — 두 번 새로고침을 요구하지 않는다", async () => {
  // David 2026-08-06: "얼마나 기다려야 되는데 새로고침 해도 이지랄인데"
  //
  // 서비스워커가 이미 설치돼 있으면 새 배포가 나가도 열려 있던 화면은 옛 앱
  // 셸로 계속 돈다. 새 워커는 설치·활성화되지만 제어권은 다음 네비게이션부터라
  // 사용자가 새로고침을 두 번 해야 했다. 그리고 자기가 어느 빌드를 보고 있는지
  // 알 방법이 없었다 — 나는 매번 워커를 지우고 확인해서 늘 최신을 봤고,
  // David 폰은 옛 마크업을 그리고 있었다.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const server = readFileSync("src/feed/server.js", "utf8");

  assert.match(server, /function buildId\(\)/, "빌드 식별자가 없다");
  assert.match(server, /name="nh-build"/, "화면에 빌드 식별자를 안 심는다");
  assert.match(server, /const build = buildId\(\);/, "config가 서버 빌드를 안 준다");

  assert.match(html, /function ensureFreshBuild\(serverBuild\)/, "빌드 대조가 없다");
  assert.match(html, /if\(ensureFreshBuild\(config && config\.build\)\) return;/,
    "config를 받은 뒤 빌드를 대조하지 않는다");
  // 무한 새로고침 방지 — 같은 빌드로는 한 번만.
  assert.match(html, /sessionStorage\.getItem\("nh_build_reload"\)/, "재시도 가드가 없다");
});
