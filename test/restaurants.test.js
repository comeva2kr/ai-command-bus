import test from "node:test";
import assert from "node:assert/strict";

import { scoreAuthenticity, isPaidReview } from "../src/restaurants/authenticity.js";
import { verifyRestaurant, ingest } from "../src/restaurants/ingest.js";
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
  assert.ok(!ids.includes("R-104")); // 어뷰징
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
