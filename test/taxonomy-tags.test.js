import test from "node:test";
import assert from "node:assert/strict";
import { TAGS, TAG_LABELS, tagLabel, CATEGORIES } from "../src/feed/taxonomy.js";

// David 2026-08-06: "사용성이 아주 매끄러울 수 있게 모든 화제나 정보에 대한
// 모든 유형별 태그들을 뽑아서 정리하자."
//
// 그동안 취향 대시보드에 "#sneakers", "#realestate", "#pc-gaming"처럼 영문 id가
// 그대로 찍혔다(server.js가 `"#" + x.id`로 만들었다). 한국어 서비스에서 관심사를
// 영어로 보여 주는 것은 그 자체로 새는 곳이다.
//
// 이 테스트가 지키는 것은 **앞으로 태그를 추가할 때 이름 붙이는 것을 잊지 않는
// 것**이다. 태그는 카테고리가 늘 때마다 함께 늘어 왔고(2026-08-06에만 6개 추가),
// 그때 라벨을 빠뜨리면 화면에 영문 id가 조용히 다시 나타난다.

test("모든 태그에 한국어 이름이 있다 — 새 태그를 추가하면서 빠뜨리지 않게", () => {
  const missing = TAGS.filter((t) => !TAG_LABELS[t]);
  assert.deepEqual(missing, [],
    `이름 없는 태그: ${missing.join(", ")} — taxonomy.js의 TAG_LABELS에 추가하세요`);
});

test("태그 이름에 영문 id가 그대로 남아 있지 않다", () => {
  // "AI"·"PC게임"·"e스포츠"처럼 영문이 **정식 표기인** 것은 예외다.
  const okEnglish = new Set(["ai", "pc-gaming", "esports"]);
  const raw = TAGS.filter((t) => !okEnglish.has(t) && TAG_LABELS[t] === t);
  assert.deepEqual(raw, [], `이름이 id와 같음: ${raw.join(", ")}`);
});

test("한국어 이름은 한글을 포함한다 (표기가 영문인 예외 제외)", () => {
  const okEnglish = new Set(["ai"]);
  const noKo = TAGS.filter((t) => !okEnglish.has(t) && !/[가-힣]/.test(TAG_LABELS[t] || ""));
  assert.deepEqual(noKo, [], `한글이 없는 이름: ${noKo.map((t) => `${t}=${TAG_LABELS[t]}`).join(", ")}`);
});

test("학습된 태그(사전에 없는 것)는 id를 그대로 쓴다 — 없는 이름을 지어내지 않는다", () => {
  // 실측 예: 추천기가 제목에서 뽑은 "nike", "아이돌", "awich"
  assert.equal(tagLabel("nike"), "nike");
  assert.equal(tagLabel("아이돌"), "아이돌");
  assert.equal(tagLabel(""), "");
  assert.equal(tagLabel(null), "");
  assert.equal(tagLabel(undefined), "");
});

test("사전에 있는 태그는 한국어로 바뀐다", () => {
  assert.equal(tagLabel("sneakers"), "스니커즈");
  assert.equal(tagLabel("realestate"), "부동산");
  assert.equal(tagLabel("parenting"), "육아");
});

test("TAG_LABELS에 TAGS에 없는 유령 항목이 없다", () => {
  const known = new Set(TAGS);
  const orphan = Object.keys(TAG_LABELS).filter((k) => !known.has(k));
  assert.deepEqual(orphan, [], `TAGS에 없는 라벨: ${orphan.join(", ")}`);
});

test("카테고리도 전부 한국어 이름을 갖는다 (같은 규칙)", () => {
  const bad = CATEGORIES.filter((c) => !c.label || !/[가-힣]/.test(c.label));
  assert.deepEqual(bad.map((c) => c.id), []);
});
