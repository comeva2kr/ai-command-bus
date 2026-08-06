// /trends의 아웃링크를 없앤다 (2026-08-06, 재심사 준비 실측에서 발견).
//
// 실측: 자체 콘텐츠 페이지 7곳 중 /trends만 외부 링크 20개였고 우리 글자는
// 783자였다 — 애드핏이 말한 "아웃링크만으로 구성되었거나 그 비중이 높은"
// 화면 그 자체다. 수익으로 봐도 최악이다: 사용자를 트위터로 보내면
// 우리 광고 노출이 거기서 끝난다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keywordPage } from "../src/feed/pages.js";

const item = (id, title) => ({
  id, title, source: "clien", sourceLabel: "클리앙", category: "tech",
  score: 1, commentCount: 1, url: `https://example.com/${id}`
});

test("사전에 없는 말도 제목에서 찾는다", () => {
  // 실시간 트렌드에서 오는 말(아이돌 이름·해시태그·신조어)은 태그 사전에 없다.
  // 폴백이 없으면 그 키워드를 우리 페이지로 보낼 수 없고, 그래서 X로 나갔다.
  const items = [item("a", "오디세이 시즌제 논란 정리"), item("b", "전혀 다른 글")];
  const page = keywordPage(items, "오디세이");
  assert.ok(page, "제목에 있는 말을 못 찾는다");
  assert.equal(page.total, 1);
  assert.equal(page.matchedBy, "text");
});

test("한 글자 말로는 찾지 않는다 — 아무 제목에나 걸린다", () => {
  assert.equal(keywordPage([item("a", "가나다라")], "가"), null);
});

test("우리 풀에 없는 말은 페이지를 만들지 않는다", () => {
  assert.equal(keywordPage([item("a", "무관한 제목")], "존재하지않는말"), null);
});

test("/trends가 트윗 검색으로 내보내지 않는다", () => {
  const src = readFileSync("src/feed/server.js", "utf8");
  const route = src.slice(src.indexOf('if (p === "/trends"'), src.indexOf('if (p.startsWith("/briefing/")'));
  assert.ok(!/x\.searchUrl/.test(route), "아직 X 검색 링크로 내보낸다");
  assert.ok(!/twitter\.com|x\.com/.test(route), "외부 주소가 남아 있다");
  assert.match(route, /href="\/keyword\//, "우리 키워드 페이지로 안 보낸다");
  // 우리 풀에 없으면 링크를 만들지 않는다 — 죽은 링크 금지(⑤와 같은 원칙).
  assert.match(route, /x\.hits\s*\n?\s*\?/, "매칭 여부와 무관하게 링크를 만든다");
  // 실측값을 화면에 적는다.
  assert.match(route, /우리 피드 \$\{?x?\.?hits|우리 피드 \$\{x\.hits\}건/);
});
