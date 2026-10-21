// 안심스캔 코어 — 원재료 파싱, 알레르기 차단, 근거 기반 감점, 나이·걱정거리 개인화, 대체품.
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeProduct, buyLinks, detectAllergens, detectMall, inferCategory, noticeToProduct,
  listingKeys, parseIngredients, parseNutrition, rankAlternatives, rowsFromText
} from "../src/ansim/core/index.js";
import { loadSampleProducts } from "../src/ansim/catalog.js";

const products = loadSampleProducts();
const byName = (n) => products.find((p) => p.name === n);

test("원재료: 괄호 안 하위 원재료까지 읽고 '같은 제조시설' 문장은 함유로 세지 않는다", () => {
  const r = parseIngredients("돼지고기(국산) 72%, 복합조미식품[정제소금, L-글루탐산나트륨(향미증진제)], 아질산나트륨(발색제) / 대두, 밀 함유 이 제품은 메밀, 땅콩을 사용한 제품과 같은 제조시설에서 제조하고 있습니다.");
  assert.deepEqual(r.top, ["돼지고기", "복합조미식품", "아질산나트륨", "대두", "밀"]);
  assert.ok(r.tokens.includes("L-글루탐산나트륨"));
  assert.deepEqual(r.mayContainTokens, ["메밀", "땅콩"]);
  assert.deepEqual(detectAllergens(r.tokens), ["soy", "wheat", "pork"]);
  assert.deepEqual(detectAllergens(r.mayContainTokens), ["buckwheat", "peanut"]);
});

test("알레르기 매칭: 흔한 오탐을 피한다", () => {
  assert.deepEqual(detectAllergens(["메밀가루"]), ["buckwheat"]);          // 메밀 ≠ 밀
  assert.deepEqual(detectAllergens(["밀크초콜릿향"]), []);                 // 밀크 ≠ 밀
  assert.deepEqual(detectAllergens(["땅콩버터"]), ["peanut"]);            // 땅콩버터 ≠ 우유
  assert.deepEqual(detectAllergens(["코코아버터"]), []);
  assert.deepEqual(detectAllergens(["완두콩", "강낭콩"]), []);            // 대두 아님
  assert.deepEqual(detectAllergens(["검은콩"]), ["soy"]);
  assert.deepEqual(detectAllergens(["굴비"]), []);
  assert.deepEqual(detectAllergens(["굴소스"]), ["shellfish"]);
  assert.deepEqual(detectAllergens(["유청분말", "소맥분"]), ["milk", "wheat"]);
});

test("등록한 알레르기 성분이 있으면 점수와 무관하게 '먹이지 마세요'", () => {
  const vanilla = byName("4가지 원료 바닐라 아이스크림");
  assert.equal(analyzeProduct(vanilla, { age: 6 }).verdict.code, "good");
  const a = analyzeProduct(vanilla, { age: 6, allergies: ["milk"] });
  assert.equal(a.verdict.code, "block");
  assert.ok(a.reasons[0].block && a.reasons[0].title.includes("우유"));
});

test("같은 제조시설 혼입 가능은 그 알레르기가 있는 아이에게만 감점한다", () => {
  const fish = byName("분홍 어육소시지");   // 우유·새우 사용 시설
  const plain = analyzeProduct(fish, { age: 6 });
  const allergic = analyzeProduct(fish, { age: 6, allergies: ["shrimp"] });
  assert.equal(allergic.verdict.code === "block", false);
  assert.equal(plain.score - allergic.score, 15);
  assert.ok(plain.notes.some((n) => n.includes("같은 제조시설")));
});

test("MSG는 감점하지 않고 오해 바로잡기 메모로만 보여준다", () => {
  const a = analyzeProduct({ name: "조미김", ingredientsText: "김(국산) 80%, 들기름, 정제소금, L-글루탐산나트륨(향미증진제)" }, { age: 6 });
  assert.equal(a.score, 100);
  assert.ok(a.notes.some((n) => n.includes("MSG")));
});

test("가공육: 아질산·가공육 감점, '무첨가'라도 셀러리 분말은 천연 아질산원으로 잡는다", () => {
  const vienna = analyzeProduct(byName("꼬마 비엔나 소시지"), { age: 6 });
  const keys = vienna.reasons.map((r) => r.key);
  assert.ok(keys.includes("nitrite") && keys.includes("processed-meat"));
  const celery = analyzeProduct(byName("무첨가 그릴 소시지"), { age: 6 });
  assert.ok(celery.reasons.some((r) => r.key === "celery-nitrite"));
  // 셀러리 분말은 가공육이 아닐 때는 문제 삼지 않는다
  const soup = analyzeProduct({ name: "야채수프", category: "noodle", ingredientsText: "감자, 양파, 셀러리분말, 천일염" }, { age: 6 });
  assert.ok(!soup.reasons.some((r) => r.key === "celery-nitrite"));
});

test("합성색소 6종은 '주의력' 걱정을 고르면 1.5배로 본다", () => {
  const chips = byName("나초 치즈 칩");
  const base = analyzeProduct(chips, { age: 6 });
  const strict = analyzeProduct(chips, { age: 6, concerns: ["attention"] });
  const color = (a) => a.reasons.find((r) => r.key === "allura-red").penalty;
  assert.equal(color(base), 10);
  assert.equal(color(strict), 15);
  assert.ok(strict.score < base.score);
});

test("나이: 같은 당류도 어린 아이일수록 하루 상한 대비 비중이 커진다", () => {
  const drink = byName("레몬라임 스포츠 드링크");
  const young = analyzeProduct(drink, { age: 3 }).reasons.find((r) => r.key === "sugar");
  const teen = analyzeProduct(drink, { age: 13 }).reasons.find((r) => r.key === "sugar");
  assert.ok(young.penalty > teen.penalty);
  assert.match(young.title, /하루 권장 상한의 91%/);   // 3~5세 상한 35g
});

test("나이: 돌 전 아기에게 꿀은 차단, 만 2세 미만 첨가당은 감점", () => {
  const yogurt = { name: "꿀 요거트", ingredientsText: "원유, 벌꿀 5%, 설탕, 유산균" };
  assert.equal(analyzeProduct(yogurt, { age: 0 }).verdict.code, "block");
  assert.notEqual(analyzeProduct(yogurt, { age: 3 }).verdict.code, "block");
  assert.ok(analyzeProduct(yogurt, { age: 1 }).reasons.some((r) => r.key === "under2-sugar"));
});

test("고열량·저영양: 간식류에서 단백질 2g 미만 + 당류 17g 초과면 해당", () => {
  const a = analyzeProduct(byName("새콤 딸기 젤리"), { age: 6 });
  assert.ok(a.reasons.some((r) => r.key === "hfln"));
  // 같은 수치라도 간식이 아닌 분류(소스)에는 적용하지 않는다
  const sauce = analyzeProduct({ name: "돈가스 소스", category: "sauce", ingredientsText: "토마토, 설탕", nutrition: { basis: "serving", sugarG: 20, proteinG: 0.5, kcal: 90 } }, { age: 6 });
  assert.ok(!sauce.reasons.some((r) => r.key === "hfln"));
});

test("정보가 없으면 점수를 지어내지 않는다", () => {
  const a = analyzeProduct({ name: "모르는 제품" }, { age: 6 });
  assert.equal(a.score, null);
  assert.equal(a.verdict.code, "unknown");
});

test("영양정보 파서: 한국 표시 형식", () => {
  const n = parseNutrition("총 내용량 70g 350kcal 나트륨 1,280mg 64% 탄수화물 46g 당류 20g 지방 17g 트랜스지방 0.5g 포화지방 6g 단백질 4g");
  assert.equal(n.basis, "total");
  assert.equal(n.kcal, 350);
  assert.equal(n.sodiumMg, 1280);
  assert.equal(n.sugarG, 20);
  assert.equal(n.transFatG, 0.5);
  assert.equal(n.satFatG, 6);
  assert.equal(n.proteinG, 4);
  assert.equal(parseNutrition("100g당 나트륨 400mg").basis, "per100");
  assert.equal(parseNutrition("상세페이지 참조"), null);
});

test("대체품: 같은 분류·이 아이에게 안전·추천 등급만, 왜 나은지 함께", () => {
  const vienna = byName("꼬마 비엔나 소시지");
  const alts = rankAlternatives(vienna, products, { age: 6 }, { mall: "coupang" });
  assert.ok(alts.length >= 2);
  for (const a of alts) {
    assert.equal(a.analysis.category, "processed-meat");
    assert.equal(a.analysis.verdict.code, "good");
    assert.equal(a.tier, "good");
    assert.equal(a.links[0].mall, "coupang");      // 지금 쓰는 몰이 맨 앞
  }
  assert.ok(alts[0].improvements.includes("아질산나트륨(발색제) 없음"));
  assert.ok(alts[0].improvements.some((i) => i.startsWith("나트륨 520mg →")));

  // 닭 알레르기 아이에게 닭가슴살 소시지를 추천하지 않는다
  const forChickenAllergy = rankAlternatives(vienna, products, { age: 6, allergies: ["chicken"] });
  assert.ok(!forChickenAllergy.some((a) => a.product.name.includes("닭")));
});

test("쇼핑몰 감지와 구매 링크", () => {
  assert.equal(detectMall("www.coupang.com"), "coupang");
  assert.equal(detectMall("smartstore.naver.com"), "naver");
  assert.equal(detectMall("www.kurly.com"), "kurly");
  assert.equal(detectMall("example.com"), null);
  const links = buyLinks({ name: "보리차" }, "kurly");
  assert.equal(links[0].mall, "kurly");
  assert.equal(links[0].kind, "search");
  assert.match(links[0].url, /^https:\/\/www\.kurly\.com\/search\?sword=/);
  const direct = buyLinks({ name: "보리차", offers: { coupang: { url: "https://www.coupang.com/vp/products/1" } } }, "coupang");
  assert.equal(direct[0].kind, "direct");
});

test("상품정보제공고시 표 → 제품", () => {
  const p = noticeToProduct({
    title: "꼬마 비엔나 소시지 500g - 쿠팡!",
    rows: [
      ["식품의 유형", "소시지"],
      ["원재료명 및 함량", "돼지고기 80%, 정제수, 아질산나트륨"],
      ["영양성분", "상세페이지 참조"],
      ["알레르기 유발물질", "돼지고기 함유"]
    ]
  });
  assert.equal(p.name, "꼬마 비엔나 소시지 500g");
  assert.equal(p.category, "processed-meat");
  assert.equal(p.nutritionText, "");                 // '상세페이지 참조'는 정보가 아니다
  assert.match(p.ingredientsText, /아질산나트륨/);
  const rows = rowsFromText("제품명 : 보리차\n원재료명 : 정제수, 볶은보리\n아무 문장");
  assert.deepEqual(rows, [["제품명", "보리차"], ["원재료명", "정제수, 볶은보리"]]);
  assert.equal(inferCategory({ name: "딸기맛 젤리" }), "candy");
  assert.equal(inferCategory({ name: "치즈 소시지" }), "processed-meat");
});

test("몰 상품 키: 상품번호 우선, 상품명은 꼬리표를 떼고 정규화", () => {
  assert.deepEqual(listingKeys({ url: "https://www.coupang.com/vp/products/123?itemId=9", title: "[무료배송] 꼬마 소시지 1kg (2+1)", mall: "coupang" }),
    ["coupang:id:123", "title:꼬마소시지1kg"]);
  assert.deepEqual(listingKeys({ url: "https://m.smartstore.naver.com/shop/products/77", title: "", mall: "naver" }), ["naver:id:77"]);
  assert.deepEqual(listingKeys({ url: "https://www.ssg.com/item/itemView.ssg?itemId=1000", title: "", mall: "ssg" }), ["ssg:id:1000"]);
  assert.deepEqual(listingKeys({ title: "햄" }), []);    // 너무 짧은 제목은 키로 쓰지 않는다
});
