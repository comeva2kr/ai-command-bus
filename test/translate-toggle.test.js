// 해외 글: 원문 보기 ↔ 번역본 보기 (David 2026-08-06).
//
// "해외 기사나 컨텐츠의 경우 원문보러가기/번역본 보기 두 개를 넣고
//  실제 활용 가능하게 만들자."
//
// 우리는 무료 기계번역을 쓴다(David 결정: 유지). 그래서 어색한 문장이 나올 수
// 있고, 그때 원문을 바로 대조할 수 있어야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TranslatingSource } from "../src/feed/translate.js";
import { normalizeItem, JsonSource } from "../src/feed/content.js";

const foreign = {
  id: "a", title: "Awich Headlines Japan's Inaugural Red Bull Symphonic",
  summary: "Red Bull Symphonic brings Awich together with an orchestra.",
  url: "https://example.com/a", source: "hypebeast", sourceLabel: "하입비스트",
  lang: "en", publishedAt: new Date().toISOString(), category: "culture"
};

test("번역하면 원문 제목과 발췌를 둘 다 남긴다", async () => {
  // 제목만 남기고 발췌를 안 남기면 "원문 보기"가 반쪽이 된다 —
  // 무엇을 어떻게 옮겼는지 대조가 안 된다.
  const base = { id: "s", kind: "news", async fetch() { return [foreign]; } };
  // 생성자는 위치 인자다: (inner, translateFn, targetLang)
  const src = new TranslatingSource(base, async (t) => `[번역] ${t}`, "ko");
  const [it] = await src.fetch();
  assert.equal(it.translated, true);
  assert.equal(it.originalTitle, foreign.title, "원문 제목이 없다");
  assert.equal(it.originalSummary, foreign.summary, "원문 발췌가 없다");
  assert.notEqual(it.title, foreign.title, "번역이 안 됐다");
});

test("원문 필드가 정규화에서 잘리지 않는다", () => {
  // price·dest·defaultTags가 화이트리스트에 없어 조용히 사라진 전례가 있다.
  const src = new JsonSource("s", async () => [], "news");
  const it = normalizeItem({
    ...foreign, translated: true, originalLang: "en",
    originalTitle: foreign.title, originalSummary: foreign.summary
  }, src);
  assert.equal(it.originalTitle, foreign.title);
  assert.equal(it.originalSummary, foreign.summary);
});

test("화면에 원문 보기 토글이 배선돼 있다", () => {
  const html = fs.readFileSync("src/feed/public/index.html", "utf8");
  assert.match(html, /function transToggleHtml\(item\)/, "토글 UI가 없다");
  assert.match(html, /function wireTransToggle\(\)/, "핸들러가 없다");
  assert.match(html, /\$\{transToggleHtml\(item\)\}/, "상세에 안 붙었다");
  assert.match(html, /wireTransToggle\(\);/, "렌더 후 배선을 안 한다");
  // 번역 안 된 글에는 안 나온다 — 국내 글에 "원문 보기"가 뜨면 이상하다.
  const fn = html.slice(html.indexOf("function transToggleHtml(item){"),
                        html.indexOf("function wireTransToggle()"));
  assert.match(fn, /!item\.translated \|\| !item\.originalTitle/, "번역 안 된 글에도 뜬다");
});

test("원문 발췌가 없으면 발췌는 그대로 둔다", () => {
  // 빈 칸을 만들지 않는다 — 없는 것을 만들지 않는 것과 같은 원칙.
  const html = fs.readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function wireTransToggle()"),
                        html.indexOf("// 상세 화면에 **우리가 만든 것**"));
  assert.match(fn, /if\(sum && \(showingOriginal \? d\.oSum : d\.tSum\)\)/, "빈 발췌로 덮어쓴다");
  // 제목 옆 ↗ 아이콘을 지우면 원문 바로가기를 잃는다.
  assert.match(fn, /const icon = h3\.querySelector\("\.newtab-hint"\)/, "아이콘을 보존하지 않는다");
});

test("'원문 보러가기'와 '원문 보기'는 다른 일이다", () => {
  // 하나는 그 매체로 나가고, 하나는 여기서 글자만 바꾼다. 둘 다 있어야 한다.
  const html = fs.readFileSync("src/feed/public/index.html", "utf8");
  assert.match(html, /원문에서 계속 읽기/, "매체로 나가는 버튼이 사라졌다");
  assert.match(html, /원문 보기/, "여기서 보는 토글이 없다");
  assert.match(html, /번역본 보기/, "되돌아오는 라벨이 없다");
});
