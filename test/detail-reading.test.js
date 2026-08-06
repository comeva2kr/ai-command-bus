// 상세 화면을 읽을 것이 있는 쪽으로 (애드핏 P0-A ⑤, David 2026-08-06).
//
// 애드핏 4차 반려: "아웃링크만으로 구성되었거나 그 비중이 높은 콘텐츠만
// 게재되어 있는 경우" 제한. 상세 화면은 발췌 몇 줄 + "원문에서 계속 읽기"라
// 정확히 그 모양이었다 — 우리가 쓴 것이 하나도 없었다.
//
// **본문은 퍼오지 않는다.** 우리만 아는 것을 붙여 읽을 값어치를 만든다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const mk = (id, title, source, extra = {}) => ({
  id, title, url: `https://example.com/${id}`, source,
  publishedAt: new Date().toISOString(),
  tags: [], topics: [], summary: "발췌", category: "news", lang: "ko",
  score: 0, commentCount: 0, ...extra
});

async function engineWith(items) {
  const store = new FeedStore();
  const engine = new FeedEngine(store, [{ id: "s", kind: "community", async fetch() { return items; } }]);
  const user = store.createUser();
  return { engine, userId: user.id };
}

test("같은 사건을 다룬 다른 소스를 상세에 함께 준다", async () => {
  // 여러 곳을 동시에 봐야만 알 수 있는 것이다 — 원문 한 곳만 봐서는 알 수 없고,
  // 그게 이 페이지를 읽을 이유다.
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const { engine, userId } = await engineWith([
    mk("a", same, "hani", { score: 10 }),
    mk("b", same, "donga", { commentCount: 20 }),
    mk("c", "전혀 다른 사건입니다 오늘 날씨", "khan")
  ]);
  const one = await engine.getItem(userId, "a");
  assert.ok(Array.isArray(one.related), "related가 없다");
  // 같은 사건은 수집 때 하나로 접히므로 풀에는 "b"가 없다. 접힌 기록으로
  // 살아남아야 한다 — 접을 때 버렸다면 여기서 걸린다.
  assert.ok(one.related.some((r) => r.source === "donga"), "같은 사건 글을 못 찾았다");
  assert.ok(one.related.every((r) => r.title === same), "다른 사건이 섞였다");
  assert.ok(!one.related.some((r) => r.source === "hani"), "자기 자신이 들어갔다");
});

test("같은 소스가 목록을 독식하지 않는다", async () => {
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const { engine, userId } = await engineWith([
    mk("a", same, "hani"),
    mk("b1", same, "donga"), mk("b2", same, "donga"), mk("c1", same, "khan")
  ]);
  const one = await engine.getItem(userId, "a");
  const sources = one.related.map((r) => r.source);
  assert.equal(new Set(sources).size, sources.length, "한 소스가 여러 칸을 먹었다");
});

test("브리핑과 같은 사건 판정을 쓴다 — 두 벌로 두지 않는다", async () => {
  // 판정이 두 벌이면 언젠가 어긋난다. 브리핑의 중복 제거와 같은 eventKey다.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/engine.js", "utf8");
  assert.match(src, /import \{ eventKey \} from "\.\/dedupe\.js"/, "eventKey를 재사용하지 않는다");
  assert.match(src, /_relatedItems\(item, pool\)[\s\S]{0,2000}eventKey\(item\.title\)/);
});

test("상세 화면이 우리가 만든 것을 그린다 — 재료가 없으면 줄을 뺀다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function ourReadingHtml(item){"),
                        html.indexOf("async function renderDetail(itemId){"));
  assert.match(fn, /item\.editorialNote/, "편집 코멘트를 안 쓴다");
  assert.match(fn, /item\.related/, "같은 사건 목록을 안 쓴다");
  // 없는 것을 만들지 않는다 — 재료가 없으면 통째로 뺀다.
  assert.match(fn, /if\(!parts\.length\) return "";/, "빈 껍데기가 남는다");
  // 상세 본문에 실제로 꽂혀야 한다.
  assert.match(html, /\$\{ourReadingHtml\(item\)\}/, "상세에 안 붙었다");
  // 제목·출처는 이스케이프한다(남의 글 제목이 들어온다).
  assert.match(fn, /escapeHtml\(r\.title\)/);
  assert.match(fn, /escapeHtml\(r\.sourceLabel\)/);
});

test("접힌 중복은 버리지 않고 기록으로 남는다", async () => {
  // 여기서 버리면 어디서도 복원할 수 없다 — 접힌 글은 풀에 남지 않는다.
  const { collect } = await import("../src/feed/content.js");
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const src = (id, source) => ({
    id, kind: "news",
    async fetch() { return [mk(id, same, source, { sourceLabel: source })]; }
  });
  const { items } = await collect([src("s1", "hani"), src("s2", "donga")]);
  assert.equal(items.length, 1, "같은 사건이 접히지 않았다");
  assert.ok((items[0].related || []).some((r) => r.source === "donga"), "접힌 기록이 사라졌다");
});
