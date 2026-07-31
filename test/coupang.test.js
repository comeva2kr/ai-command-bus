// 쿠팡파트너스 Open API 실연동 (coupang.js) — 서명·캐시·productFeed 계약.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  coupangSignedDate,
  coupangAuthHeader,
  fetchBestProducts,
  refreshCoupangCache,
  clearCoupangCache,
  makeCoupangProductFeed,
  COUPANG_CATEGORY_MAP
} from "../src/feed/coupang.js";
import { BANNED_AD_CATEGORIES } from "../src/feed/monetize.js";

test("서명: 날짜 형식은 UTC yyMMdd'T'HHmmss'Z'", () => {
  const at = Date.parse("2026-07-31T05:06:07.000Z");
  assert.equal(coupangSignedDate(at), "260731T050607Z");
});

test("서명: HMAC-SHA256(signedDate+method+path+query)와 CEA 헤더 형식", () => {
  const at = Date.parse("2026-07-31T05:06:07.000Z");
  const { authorization, signedDate } = coupangAuthHeader({
    method: "GET",
    path: "/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/1016",
    query: "limit=20",
    accessKey: "AK", secretKey: "SK", nowMs: at
  });
  const expected = crypto.createHmac("sha256", "SK")
    .update(signedDate + "GET" + "/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/1016" + "limit=20")
    .digest("hex");
  assert.equal(signedDate, "260731T050607Z");
  assert.equal(authorization, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=260731T050607Z, signature=${expected}`);
});

test("카테고리 매핑: 금지 카테고리(politics/religion/adult)는 아예 매핑에 없다", () => {
  for (const banned of BANNED_AD_CATEGORIES) {
    assert.ok(!(banned in COUPANG_CATEGORY_MAP), `${banned}는 매핑조차 되면 안 됨`);
  }
});

function mockFetchOk(products) {
  return async () => ({ ok: true, status: 200, json: async () => ({ data: products }) });
}

test("fetchBestProducts: 쿠팡 응답을 실측 필드만으로 정규화하고, 실패는 빈 배열", async () => {
  const rows = [
    { productId: 77, productName: "보조배터리 20000mAh", productPrice: 25900,
      productImage: "https://img/1.jpg", productUrl: "https://link.coupang.com/x/77", isRocket: true, rank: 1 },
    { productName: "이름만 있고 url 없음" } // 필수 필드 미달 -> 걸러짐
  ];
  const { ok, products } = await fetchBestProducts({
    accessKey: "AK", secretKey: "SK", categoryId: 1016, fetchImpl: mockFetchOk(rows)
  });
  assert.ok(ok);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "보조배터리 20000mAh");
  assert.equal(products[0].price, 25900);
  assert.equal(products[0].url, "https://link.coupang.com/x/77");

  const fail = await fetchBestProducts({
    accessKey: "AK", secretKey: "SK", categoryId: 1016,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  });
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.products, []);
});

test("productFeed: 캐시된 실상품으로 슬롯 후보를 만들고, 재고 없는 카테고리는 백필하지 않는다", async () => {
  clearCoupangCache();
  const env = { COUPANG_PARTNER_ID: "AF123", COUPANG_ACCESS_KEY: "AK", COUPANG_SECRET_KEY: "SK" };
  // tech에만 재고를 채운다 (다른 카테고리는 API 실패 시뮬레이션)
  await refreshCoupangCache(env, async (url) => {
    if (url.includes("/1016?")) {
      return { ok: true, status: 200, json: async () => ({ data: [
        { productId: 1, productName: "무선 이어폰", productPrice: 39900, productImage: "https://img/e.jpg",
          productUrl: "https://link.coupang.com/x/1", isRocket: true, rank: 1 },
        { productId: 2, productName: "USB 허브 7포트", productPrice: 15900, productImage: null,
          productUrl: "https://link.coupang.com/x/2", isRocket: false, rank: 9 }
      ] }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });

  const feed = makeCoupangProductFeed(env);
  // tech를 강하게, business도 원하는 유저 — business는 재고가 없으니 tech만 나와야
  const prefs = { categories: { tech: 3, business: 2 }, tags: {}, sources: {}, prefs: {} };
  const out = feed(prefs, { seed: 1 });

  assert.ok(out.length >= 1, "재고 있는 카테고리 후보는 나와야");
  for (const c of out) {
    assert.equal(c.category, "tech", "재고 없는 카테고리(business)로 백필 금지");
    assert.equal(c.sample, false, "실연동 후보는 샘플 표기가 없어야");
    assert.match(c.url, /^https:\/\/link\.coupang\.com\//, "정확한 상품 URL");
    assert.ok(c.productName, "실제 상품명 보조 라인 필수");
    assert.equal(c.priceOriginal, null, "쿠팡이 안 준 정가를 지어내면 안 됨");
    assert.ok(Number.isFinite(c.priceSale), "실측 판매가만");
    assert.ok(c.relevance >= 0 && c.relevance <= 1);
  }

  // 키가 없으면 항상 빈 배열
  const noCreds = makeCoupangProductFeed({});
  assert.deepEqual(noCreds(prefs, { seed: 1 }), []);
  clearCoupangCache();
});

test("productFeed: excludeIds에 있는 상품은 로테이션에서 건너뛴다", async () => {
  clearCoupangCache();
  const env = { COUPANG_PARTNER_ID: "AF123", COUPANG_ACCESS_KEY: "AK", COUPANG_SECRET_KEY: "SK" };
  await refreshCoupangCache(env, async (url) => {
    if (url.includes("/1016?")) {
      return { ok: true, status: 200, json: async () => ({ data: [
        { productId: 1, productName: "상품A", productPrice: 1000, productUrl: "https://link.coupang.com/x/1", rank: 1 },
        { productId: 2, productName: "상품B", productPrice: 2000, productUrl: "https://link.coupang.com/x/2", rank: 2 }
      ] }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
  const feed = makeCoupangProductFeed(env);
  const prefs = { categories: { tech: 3 }, tags: {}, sources: {}, prefs: {} };
  const first = feed(prefs, { seed: 1 })[0];
  const second = feed(prefs, { seed: 1, excludeIds: new Set([first.id]) })[0];
  assert.notEqual(second.id, first.id, "직전에 본 상품은 건너뛰어야");
  clearCoupangCache();
});
