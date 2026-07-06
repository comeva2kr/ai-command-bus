import test from "node:test";
import assert from "node:assert/strict";

import { verifyRestaurant, ingest, isAdMention } from "../src/restaurants/ingest.js";
import { haversineKm, travelBudgetToRadiusKm, resolveOrigin } from "../src/restaurants/geo.js";
import { normalizeStyle, normalizeMenu, normalizeMenuAttr } from "../src/restaurants/taxonomy.js";
import { search } from "../src/restaurants/query.js";
import { SEED_RESTAURANTS } from "../src/restaurants/data/seed.js";

test("ad/sponsored mentions are detected and filtered", () => {
  assert.equal(isAdMention({ type: "sponsored" }), true);
  assert.equal(isAdMention({ type: "organic", markers: ["#광고"] }), true);
  assert.equal(isAdMention({ type: "organic", text: "제공받아 작성" }), true);
  assert.equal(isAdMention({ type: "organic", mentions: 10 }), false);
});

test("cross-platform organic signal yields verified; ad-dominated does not", () => {
  const good = verifyRestaurant(SEED_RESTAURANTS.find((r) => r.id === "R-101"));
  assert.equal(good.verified, true);
  assert.ok(good.verificationScore > 50);
  assert.ok(good.signals.adMentionsFiltered >= 1);

  const adHeavy = verifyRestaurant(SEED_RESTAURANTS.find((r) => r.id === "R-103"));
  assert.equal(adHeavy.verified, false); // 협찬 위주 → 검증 실패
});

test("ingest drops unverified restaurants by default", () => {
  const verified = ingest(SEED_RESTAURANTS);
  assert.ok(!verified.some((r) => r.id === "R-103"));
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
  assert.ok(travelBudgetToRadiusKm(30, "car") > 5); // 차 30분이면 반경 수 km 이상
  assert.deepEqual(resolveOrigin({ near: "세종" }).lat > 36 && resolveOrigin({ near: "세종" }).lat < 37, true);
});

// --- Worked example A: 프랜차이즈 아닌 뒷고기 고깃집 + 키즈카페 ---
test("example A: non-franchise pork gogijip with kids cafe", () => {
  const { results } = search(SEED_RESTAURANTS, {
    styles: ["고깃집"],
    cuisines: ["돼지고기"],
    excludeFranchise: true,
    require: { kidsCafe: true }
  });
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes("R-101"));
  assert.ok(!ids.includes("R-102")); // 프랜차이즈 제외
  assert.ok(!ids.includes("R-103")); // 광고성 → 미검증 제외
});

// --- Worked example B: 이자카야 숙성회 + 싼 분위기 아님 + 파티션 선호 ---
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
  assert.ok(!ids.includes("R-202")); // 가성비(싼 분위기) 태그 → 제외
  assert.equal(results[0].id, "R-201");
});

// --- Worked example C: 세종 근처 차 30분(청주·대전 포함) 활고등어회 ---
test("example C: live mackerel sashimi within 30min drive of Sejong", () => {
  const { results, meta } = search(SEED_RESTAURANTS, {
    location: { near: "세종" },
    travel: { mode: "car", minutes: 30 },
    menu: "고등어회",
    menuAttrs: ["활"]
  });
  const ids = results.map((r) => r.id);
  assert.ok(meta.radiusKm > 5);
  assert.ok(ids.includes("R-301")); // 세종 활고등어
  assert.ok(ids.includes("R-302")); // 대전 활고등어 (30분 내)
  assert.ok(!ids.includes("R-303")); // 청주지만 활 아님(숙성) → 제외
  assert.ok(results.every((r) => r.distanceKm <= meta.radiusKm));
});

test("results are ranked by blended score (verification/rating/proximity)", () => {
  const { results } = search(SEED_RESTAURANTS, { location: { near: "강남역" } });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score);
  }
});
