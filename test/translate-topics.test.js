import test from "node:test";
import assert from "node:assert/strict";
import { TranslatingSource } from "../src/feed/translate.js";

// 2026-08-06 적대적 검수가 정치 관문 누수를 지적했고, 라이브 풀 실측으로
// 원인이 확인됐다 — 다만 검수가 지목한 소스(clien)가 아니라 **번역 순서**였다.
//
// 분류(classifyTopics)는 content.js가 normalize 시점에 한 번 한다. 번역은
// 그 **뒤에** 감싸인다(registry.js:161). 즉 주제 판정은 언제나 원문 제목으로
// 끝나고, 옮겨진 한글 제목은 아무도 다시 보지 않았다.
//
// politics 사전은 한글 고유명사다("트럼프"·"젤렌스키"·"민주당"). 원문이
// "Trump ..."이면 안 걸린다. 그래서 **정치 안 보기를 켠 사용자에게 해외 정치
// 글이 그대로 나갔다.** politics는 기본 숨김이라, 새는 것은 취향 문제가
// 아니라 약속을 어기는 것이다.
//
// 라이브 풀 실측(번역된 제목을 다시 넣으면 politics로 잡히는데 topics가 빈 글):
//   livedoor-jp 2 · chosunbiz 2 · slashdot 1 · techmeme 1
//   예) "트럼프 대통령이 헤그세스 국방장관에 불만" → topics: []

const KO = {
  "Trump slams defense secretary over missile stockpile": "트럼프 대통령이 국방장관에 불만",
  "Zelensky appeals for support after Kyiv strike": "젤렌스키가 키이우 공격 후 지원 호소",
  "New JavaScript runtime released": "새 자바스크립트 런타임 공개"
};
const fakeTranslate = async (t) => KO[t] || t;

function sourceOf(items) {
  return { async fetch() { return items.map((i) => ({ ...i })); } };
}

test("옮긴 제목으로 주제를 다시 판정한다 — 해외 정치 글이 관문을 통과하면 안 된다", async () => {
  const src = sourceOf([
    { id: "a", title: "Trump slams defense secretary over missile stockpile",
      url: "https://example.org/1", source: "livedoor-jp", lang: "en", topics: [] },
    { id: "b", title: "Zelensky appeals for support after Kyiv strike",
      url: "https://example.org/2", source: "techmeme", lang: "en", topics: [] }
  ]);
  const out = await new TranslatingSource(src, fakeTranslate, "ko").fetch();
  for (const it of out) {
    assert.ok(it.topics.includes("politics"),
      `번역 후 politics로 잡혀야 한다: ${it.title} → ${JSON.stringify(it.topics)}`);
  }
});

test("정치가 아닌 해외 글에 정치 딱지를 붙이지 않는다", async () => {
  // 오탐은 조용한 검열이 된다 — politics는 기본 숨김이라 잘못 붙으면 사라진다.
  const src = sourceOf([
    { id: "c", title: "New JavaScript runtime released",
      url: "https://example.org/3", source: "lobsters", lang: "en", topics: [] }
  ]);
  const out = await new TranslatingSource(src, fakeTranslate, "ko").fetch();
  assert.deepEqual(out[0].topics, []);
});

test("원문으로 이미 붙은 주제를 번역이 지우지 않는다 — 합집합이다", async () => {
  // url 기반 게시판 규칙(BOARD_TOPIC_RULES)으로 붙은 주제가 번역 때문에
  // 사라지면 관문이 반대 방향으로 뚫린다.
  const src = sourceOf([
    { id: "d", title: "New JavaScript runtime released",
      url: "https://example.org/4", source: "lobsters", lang: "en",
      topics: ["religion"] }
  ]);
  const out = await new TranslatingSource(src, fakeTranslate, "ko").fetch();
  assert.ok(out[0].topics.includes("religion"), "원래 있던 주제가 사라졌다");
});

test("주제가 중복되지 않는다", async () => {
  const src = sourceOf([
    { id: "e", title: "Trump slams defense secretary over missile stockpile",
      url: "https://example.org/5", source: "livedoor-jp", lang: "en",
      topics: ["politics"] }
  ]);
  const out = await new TranslatingSource(src, fakeTranslate, "ko").fetch();
  assert.deepEqual(out[0].topics, ["politics"]);
});

test("번역이 안 된 글(한글 제목)은 그대로 통과한다 — 재판정 대상이 아니다", async () => {
  const src = sourceOf([
    { id: "f", title: "국내 커뮤니티 글입니다", url: "https://example.org/6",
      source: "clien", lang: "ko", topics: [] }
  ]);
  const out = await new TranslatingSource(src, fakeTranslate, "ko").fetch();
  assert.equal(out[0].title, "국내 커뮤니티 글입니다");
  assert.ok(!out[0].translated);
});
