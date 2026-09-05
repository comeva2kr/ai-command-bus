// 고른 취향이 피드의 주인이 되게 (David 2026-08-06).
//
// 라이브 실측: 스포츠만 고른 사용자의 피드가 sports 32% · humor 45%였다.
// 고른 것보다 안 고른 것이 더 많았다 — David 본인이 "취향 설정했는데도
// 애매하게 섞여서 피딩된다"고 한 그 상태다.
//
// 원인은 개인화 점수와 인기 점수를 그냥 더한 것이다. 스케일이 다르면 큰 쪽이
// 이긴다(LinkedIn이 말하는 캘리브레이션 실패). X의 For You가 In-Network 지분을
// 아예 정해 두는 방식을 카피해, 고른 카테고리에 최소 지분을 준다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureTasteShare, capOneCategory, chosenCategories, TASTE_MIN_SHARE } from "../src/feed/taste-share.js";

const mk = (id, category) => ({ id, category, title: `t${id}` });

test("고른 카테고리가 최소 지분을 갖는다", () => {
  const list = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, i < 3 ? "sports" : "humor"));
  const pool = Array.from({ length: 20 }, (_, i) => mk(`p${i}`, "sports"));
  const r = ensureTasteShare(list, pool, { cats: new Set(["sports"]) });
  const got = r.items.filter((i) => i.category === "sports").length;
  assert.ok(got >= Math.ceil(10 * TASTE_MIN_SHARE), `지분 미달: ${got}/10`);
});

test("재료가 없으면 있는 만큼만 채우고 부족하다고 알린다", () => {
  // 스포츠 글이 풀에 2%뿐이면 아무리 지분을 정해도 그만큼은 안 나온다.
  // 없는 것을 만들지 않는다 — 대신 부족했다는 사실을 숨기지 않는다.
  const list = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, i < 3 ? "sports" : "humor"));
  const r = ensureTasteShare(list, [mk("x", "sports")], { cats: new Set(["sports"]) });
  assert.equal(r.added, 1);
  assert.equal(r.short, true, "부족한데 부족하다고 안 한다");
});

test("길이가 줄지 않는다 — 무한 스크롤이 끊기면 안 된다", () => {
  // 딜 상한에서 실제로 겪은 회귀다(2026-08-06): 지우면 페이지가 짧아지고
  // 무한 스크롤이 "더 없음"으로 읽는다. 지우지 않고 뒤로 민다.
  const list = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, "humor"));
  const pool = Array.from({ length: 10 }, (_, i) => mk(`p${i}`, "sports"));
  const r = ensureTasteShare(list, pool, { cats: new Set(["sports"]) });
  assert.equal(r.items.length, 10);
  assert.equal(new Set(r.items.map((i) => i.id)).size, 10, "중복이 생겼다");
});

test("끌어온 글이 앞쪽에도 온다 — 첫 화면이 안 바뀌면 고친 의미가 없다", () => {
  const list = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, "humor"));
  const pool = Array.from({ length: 10 }, (_, i) => mk(`p${i}`, "sports"));
  const r = ensureTasteShare(list, pool, { cats: new Set(["sports"]) });
  const firstFive = r.items.slice(0, 5).filter((i) => i.category === "sports").length;
  assert.ok(firstFive >= 1, "앞 5칸에 고른 취향이 하나도 없다");
});

test("한 카테고리가 통째로 도배하지 않는다", () => {
  // 지분은 주되 전부를 주지는 않는다 — X의 floor와 같은 발상.
  const list = Array.from({ length: 20 }, (_, i) => mk(`d${i}`, "humor"));
  const out = capOneCategory(list);
  assert.equal(out.length, 20, "지웠다");
  const front = out.slice(0, 17).filter((i) => i.category === "humor").length;
  assert.ok(front <= 17);
});

test("명시적으로 고른 것만 본다 — 학습된 가중치로는 지분을 주지 않는다", () => {
  // 지분 보장은 강한 개입이라 사용자가 직접 고른 의사에만 건다.
  assert.equal(chosenCategories({ preferences: { categories: { sports: 1 } } }).size, 0);
  assert.equal(chosenCategories({ surveyAnswers: { categories: ["sports"] } }).size, 1);
  assert.equal(chosenCategories(null).size, 0);
});
