import test from "node:test";
import assert from "node:assert/strict";

import { scoreAuthenticity, isPaidReview } from "../src/restaurants/authenticity.js";
import { verifyRestaurant, ingest, analyzeCorpus, propagateFraud } from "../src/restaurants/ingest.js";
import { haversineKm, travelBudgetToRadiusKm, resolveOrigin } from "../src/restaurants/geo.js";
import { normalizeStyle, normalizeMenu, normalizeMenuAttr } from "../src/restaurants/taxonomy.js";
import { search } from "../src/restaurants/query.js";
import { SEED_RESTAURANTS } from "../src/restaurants/data/seed.js";

const byId = (id) => SEED_RESTAURANTS.find((r) => r.id === id);

test("paid/sponsored reviews are detected", () => {
  assert.equal(isPaidReview({ paid: true }), true);
  assert.equal(isPaidReview({ type: "sponsored" }), true);
  assert.equal(isPaidReview({ markers: ["#광고"] }), true);
  assert.equal(isPaidReview({ text: "제공받아 작성한 후기" }), true);
  assert.equal(isPaidReview({ rating: 5, local: true }), false);
});

// --- 찐맛집 판별 알고리즘의 핵심: 속성이 아무리 좋아도 가짜는 걸러야 한다 ---

test("authentic local gem scores high (찐맛집)", () => {
  const a = scoreAuthenticity(byId("R-101"));
  assert.ok(a.authenticityScore >= 80);
  assert.equal(a.verdict, "찐맛집");
  assert.equal(a.verified, true);
});

test("astroturf place (few authors, all-5, 2-week burst) is vetoed", () => {
  const a = scoreAuthenticity(byId("R-104"));
  assert.equal(a.verified, false);
  assert.ok(a.flags.some((f) => f.includes("어뷰징") || f.includes("편중")));
  assert.ok(a.authenticityScore < 45);
});

test("ad-dominated place is vetoed as 광고의심", () => {
  const a = scoreAuthenticity(byId("R-103"));
  assert.equal(a.verified, false);
  assert.equal(a.verdict, "광고의심");
  assert.ok(a.flags.includes("광고도배"));
});

test("short-form viral bubble (no behavior/map corroboration) is vetoed", () => {
  const a = scoreAuthenticity(byId("R-105"));
  assert.equal(a.verified, false);
  assert.equal(a.verdict, "바이럴거품");
  assert.ok(a.flags.some((f) => f.includes("바이럴")));
  assert.ok(a.stats.shortFormShare >= 0.55);
});

test("behavioral revealed-preference lifts a genuine hotspot to 찐맛집", () => {
  const a = scoreAuthenticity(byId("R-101"));
  assert.ok(a.stats.behaviorScore >= 0.7);
  assert.ok(a.breakdown.behavior >= 70);
  assert.equal(a.verdict, "찐맛집");
});

test("cross-source-class corroboration is required (multi-class stats)", () => {
  const a = scoreAuthenticity(byId("R-101"));
  assert.ok(a.stats.sourceClasses.length >= 3);
  assert.ok(a.reasons.some((r) => r.includes("교차확증")));
});

// --- Research-applied: cross-venue review-ring / lockstep (CopyCatch/FRAUDAR) ---

test("corpus analysis detects a cross-venue lockstep review ring", () => {
  const ctx = analyzeCorpus(SEED_RESTAURANTS);
  assert.ok(ctx.ringAuthors.has("ring_s1"));
  assert.ok(ctx.rings.some((r) => r.venues.includes("R-104") && r.venues.includes("R-106")));
});

test("camouflaged ring venue is vetoed despite looking clean in isolation", () => {
  // R-106 has diverse authors + a normal J-curve, so per-venue signals miss it.
  const solo = scoreAuthenticity(byId("R-106")); // no corpus context
  assert.equal(solo.verdict !== "담합의심", true); // isolation can't catch it
  // With corpus context the cross-venue ring is caught.
  const ctx = analyzeCorpus(SEED_RESTAURANTS);
  const withCtx = scoreAuthenticity(byId("R-106"), {}, ctx);
  assert.equal(withCtx.verified, false);
  assert.equal(withCtx.verdict, "담합의심");
  assert.ok(withCtx.stats.ringShare >= 0.34);
});

// --- Research-applied: rating-distribution shape (J-curve vs missing-middle) ---

test("distribution-shape realism flags all-5 missing-middle as unnatural", () => {
  const fake = scoreAuthenticity(byId("R-103")); // all-5 ratings
  assert.equal(fake.stats.ratingShape, "중간없음(별5도배)");
  const real = scoreAuthenticity(byId("R-101")); // J-curve with criticism
  assert.equal(real.stats.ratingShape, "정상(J커브)");
  assert.ok(real.breakdown.realism > fake.breakdown.realism);
});

// --- Superpowers: five research-applied signals, scored WITH corpus context ---

const scored = ingest(SEED_RESTAURANTS, { keepUnverified: true });
const S = (id) => scored.find((r) => r.id === id);

test("singleton-account flood is caught even with high author diversity (Xie)", () => {
  const r = S("R-107"); // 20 unique one-shot accounts, all-5, 2-week burst
  assert.equal(r.verified, false);
  assert.equal(r.verdict, "싱글톤공격");
  assert.ok(r.flags.includes("싱글톤계정공격"));
});

test("near-duplicate/template reviews are caught (text integrity)", () => {
  const r = S("R-108");
  assert.equal(r.verified, false);
  assert.equal(r.verdict, "복붙리뷰");
  assert.ok(r.signals.duplicationRatio >= 0.5);
});

test("AI-generated reviews are caught via upstream detector score", () => {
  const r = S("R-109");
  assert.equal(r.verified, false);
  assert.equal(r.verdict, "AI리뷰의심");
  assert.ok(r.signals.aiRatio >= 0.6);
});

test("belief propagation confirms the dense collusion block (FraudEagle/SpEagle)", () => {
  const fraud = propagateFraud(SEED_RESTAURANTS, {
    ringAuthors: analyzeCorpus(SEED_RESTAURANTS).ringAuthors
  });
  assert.ok(fraud.get("R-104") >= 0.8); // all-ring venue → strong network fraud
  assert.ok(fraud.get("R-101") < 0.2); // genuine venue → near zero (no false positive)
  assert.ok(S("R-104").flags.includes("네트워크사기전파"));
});

test("time-series spike catches rating manipulation on an established venue (Xie)", () => {
  const r = S("R-111"); // long healthy history + recent 5★ spike
  assert.equal(r.verified, false);
  assert.equal(r.verdict, "평점급등의심");
  assert.ok(r.flags.includes("평점급등이상(시계열)"));
  // whole-span burst detection alone would miss it (spike is a small fraction).
  assert.ok(S("R-101").verified); // genuine venues have no spike
});

test("author diversity separates real from astroturf", () => {
  const real = scoreAuthenticity(byId("R-101")).breakdown.diversity;
  const fake = scoreAuthenticity(byId("R-104")).breakdown.diversity;
  assert.ok(real > fake + 30);
});

test("longevity + honest criticism boost authenticity", () => {
  const a = scoreAuthenticity(byId("R-402")); // 노포, 900일, 재방문 다수
  assert.ok(a.breakdown.sustain >= 90);
  assert.ok(a.breakdown.local >= 60);
  assert.ok(a.reasons.some((r) => r.includes("단점") || r.includes("꾸준")));
});

test("verifyRestaurant exposes explainable breakdown + reasons", () => {
  const v = verifyRestaurant(byId("R-101"));
  assert.equal(typeof v.authenticityScore, "number");
  assert.equal(v.verificationScore, v.authenticityScore); // backward-compat alias
  assert.ok(Array.isArray(v.reasons) && v.reasons.length > 0);
  for (const k of ["behavior", "diversity", "local", "classBreadth", "sustain", "realism", "texture"]) {
    assert.ok(k in v.breakdown);
  }
});

test("ingest drops every non-verified place (ads + astroturf + thin)", () => {
  const verified = ingest(SEED_RESTAURANTS);
  const ids = verified.map((r) => r.id);
  assert.ok(!ids.includes("R-103")); // 광고
  assert.ok(!ids.includes("R-104")); // 어뷰징+담합
  assert.ok(!ids.includes("R-105")); // 바이럴거품
  assert.ok(!ids.includes("R-106")); // 담합(위장된 리뷰링)
  assert.ok(!ids.includes("R-107")); // 싱글톤 공격
  assert.ok(!ids.includes("R-108")); // 복붙리뷰
  assert.ok(!ids.includes("R-109")); // AI리뷰
  assert.ok(!ids.includes("R-111")); // 평점급등 조작
  assert.ok(verified.every((r) => r.verified));
});

test("taxonomy normalizes synonyms", () => {
  assert.equal(normalizeStyle("고기집"), "고깃집");
  assert.equal(normalizeMenu("활고등어회"), "고등어회");
  assert.equal(normalizeMenuAttr("살아있는"), "활");
});

test("geo: distance, travel budget, landmark resolution", () => {
  const d = haversineKm({ lat: 37.5, lng: 127.0 }, { lat: 37.51, lng: 127.0 });
  assert.ok(d > 1.0 && d < 1.3);
  assert.ok(travelBudgetToRadiusKm(30, "car") > 5);
  const o = resolveOrigin({ near: "세종" });
  assert.ok(o.lat > 36 && o.lat < 37);
});

// --- Worked example A: 프랜차이즈 아닌 뒷고기 고깃집 + 키즈카페 ---
test("example A: authenticity beats attribute-only matching", () => {
  const { results } = search(SEED_RESTAURANTS, {
    styles: ["고깃집"],
    cuisines: ["돼지고기"],
    excludeFranchise: true,
    require: { kidsCafe: true }
  });
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes("R-101"));
  assert.ok(!ids.includes("R-102")); // 프랜차이즈
  assert.ok(!ids.includes("R-103")); // 광고
  assert.ok(!ids.includes("R-104")); // 속성은 맞지만 어뷰징 가짜 → 제외
  assert.ok(!ids.includes("R-106")); // 속성 완벽 일치 + J커브 위장, 그러나 리뷰링 담합 → 제외
  assert.ok(!ids.includes("R-107")); // 속성 일치 + 작성자 다양, 그러나 싱글톤 공격 → 제외
});

// --- Worked example B ---
test("example B: izakaya aged sashimi, not-cheap vibe, partition preferred", () => {
  const { results } = search(SEED_RESTAURANTS, {
    styles: ["이자카야"],
    tagsAll: ["숙성회"],
    excludeTags: ["가성비"],
    prefer: ["고급스러운"],
    preferFeatures: { partition: true },
    priceMin: 2
  });
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes("R-201"));
  assert.ok(!ids.includes("R-202"));
  assert.equal(results[0].id, "R-201");
});

// --- Worked example C ---
test("example C: live mackerel sashimi within 30min drive of Sejong", () => {
  const { results, meta } = search(SEED_RESTAURANTS, {
    location: { near: "세종" },
    travel: { mode: "car", minutes: 30 },
    menu: "고등어회",
    menuAttrs: ["활"]
  });
  const ids = results.map((r) => r.id);
  assert.ok(meta.radiusKm > 5);
  assert.ok(ids.includes("R-301"));
  assert.ok(ids.includes("R-302"));
  assert.ok(!ids.includes("R-303")); // 활 아님(숙성) + 미검증
  assert.ok(results.every((r) => r.distanceKm <= meta.radiusKm));
});

test("results ranked by blended score (authenticity/rating/proximity)", () => {
  const { results } = search(SEED_RESTAURANTS, { location: { near: "강남역" } });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
});
