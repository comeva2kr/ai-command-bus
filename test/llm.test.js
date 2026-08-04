// 브리핑 해설 생성 — 환각 차단과 폴백이 핵심이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWriter, buildPrompt, validParagraph } from "../src/feed/llm.js";

const BRIEF = {
  issues: [
    { headline: "정청래 당선", tone: "논쟁", paragraph: "추천 100·댓글 200",
      refs: [{ title: "정청래 승리", sourceLabel: "클리앙" }, { title: "1등은 정청래", sourceLabel: "딴지일보" }] },
    { headline: "소아과 대기줄", tone: "다발 보도", paragraph: "5개 매체",
      refs: [{ title: "새벽 3시 소아과 대기줄", sourceLabel: "보배드림" }] }
  ],
  summary: "규칙 기반 요약"
};

function mockFetch(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status < 400, status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  });
}
const ok = (parsed) => mockFetch({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(parsed) }],
  usage: { input_tokens: 900, output_tokens: 400 }
});

const GOOD = "정청래 의원의 당선 소식이 여러 커뮤니티에서 동시에 언급되며 화제가 됐다. 정치적 반전에 대한 관심이 쏠렸고, 당내 갈등을 지적하는 목소리도 함께 나왔다.";
const GOOD2 = "새벽 시간대 소아과 앞 대기줄 사진이 육아 부모들의 공감을 얻었다. 아이가 아파도 제때 진료를 받기 어려운 현실에 대한 비판이 이어졌다.";

test("해설이 생기고 측정값 문장은 그대로 남는다", async () => {
  // 해석은 모델이, 수치는 우리가. 둘 다 독자에게 보여야 한다.
  const enrich = makeWriter({ apiKey: "k", fetchImpl: ok({
    issues: [{ n: 1, paragraph: GOOD }, { n: 2, paragraph: GOOD2 }], summary: GOOD
  })});
  const out = await enrich(BRIEF, "a");
  assert.equal(out.issues[0].essay, GOOD);
  assert.equal(out.issues[0].paragraph, "추천 100·댓글 200", "측정값 문장이 사라졌다");
  assert.equal(out.essay, GOOD);
  assert.equal(out.llm.written, 2);
});

test("숫자가 섞인 해설은 버린다", async () => {
  // 모델이 "댓글 300여 개"처럼 그럴듯한 수를 지어내면 사람 눈에는 사실로 보이는데
  // 우리는 그 수를 잰 적이 없다. 실측 없는 숫자 금지는 생성 모델에도 그대로 적용된다.
  const enrich = makeWriter({ apiKey: "k", fetchImpl: ok({
    issues: [{ n: 1, paragraph: "댓글 300여 개가 달리며 화제가 됐다. 여러 커뮤니티에서 언급이 이어졌고 관심이 쏠렸다." }],
    summary: GOOD
  })});
  const out = await enrich(BRIEF, "b");
  assert.equal(out.issues[0].essay, undefined, "숫자가 든 해설이 통과했다");
  assert.equal(out.llm.written, 0);
});

test("API가 죽어도 브리핑은 그대로 나간다", async () => {
  // LLM은 덧칠이지 골격이 아니다. 페이지가 비면 안 된다.
  for (const f of [
    mockFetch({ error: "boom" }, { status: 500 }),
    mockFetch({ stop_reason: "refusal", content: [] }),
    mockFetch({ stop_reason: "max_tokens", content: [] }),
    mockFetch({ stop_reason: "end_turn", content: [] }),
    async () => { throw new Error("network"); }
  ]) {
    const enrich = makeWriter({ apiKey: "k", fetchImpl: f });
    const out = await enrich(BRIEF, "c" + Math.random());
    assert.equal(out.issues[0].headline, "정청래 당선");
    assert.equal(out.issues[0].essay, undefined);
  }
});

test("키가 없으면 호출조차 하지 않는다", async () => {
  let called = 0;
  const enrich = makeWriter({ apiKey: null, fetchImpl: async () => { called++; } });
  const out = await enrich(BRIEF, "d");
  assert.equal(called, 0);
  assert.equal(out, BRIEF);
});

test("같은 슬롯은 한 번만 호출한다", async () => {
  // 하루 3회 호출이 설계의 핵심 — 조회수가 늘어도 비용은 그대로여야 한다.
  let called = 0;
  const enrich = makeWriter({ apiKey: "k", fetchImpl: async (...a) => { called++; return ok({
    issues: [{ n: 1, paragraph: GOOD }], summary: GOOD })(...a); }});
  await enrich(BRIEF, "same");
  await enrich(BRIEF, "same");
  await enrich(BRIEF, "same");
  assert.equal(called, 1, `${called}번 호출됐다`);
});

test("요청에 프롬프트 캐싱을 켜지 않는다", async () => {
  // 호출이 몇 시간 간격이라 5분 TTL 안에 재사용이 안 된다.
  // 캐시 쓰기(1.25배)만 내고 읽기가 0이면 순손해다.
  let sent;
  const enrich = makeWriter({ apiKey: "k", fetchImpl: async (u, o) => {
    sent = JSON.parse(o.body);
    return ok({ issues: [{ n: 1, paragraph: GOOD }], summary: GOOD })();
  }});
  await enrich(BRIEF, "e");
  assert.ok(!JSON.stringify(sent).includes("cache_control"), "캐싱이 켜져 있다");
  assert.equal(sent.output_config.effort, "low");
  assert.equal(sent.output_config.format.type, "json_schema");
});

test("입력에 본문·URL을 싣지 않는다", () => {
  // 토큰 효율 — 제목과 출처만 보낸다.
  const p = buildPrompt({ issues: [{ headline: "H", tone: "논쟁",
    refs: [{ title: "T", sourceLabel: "클리앙", id: "x1", url: "https://a/b", summary: "긴 발췌" }] }] });
  assert.ok(p.includes("T") && p.includes("클리앙"));
  assert.ok(!p.includes("https://"), "URL이 실렸다");
  assert.ok(!p.includes("긴 발췌"), "발췌가 실렸다");
});

test("검증기는 짧은 글·태그·한자 수사를 거른다", () => {
  assert.equal(validParagraph("짧다"), false);
  assert.equal(validParagraph("<b>태그</b>가 섞인 문장입니다. 충분히 길게 써서 길이 조건은 통과하도록 만든 문장."), false);
  assert.equal(validParagraph("관련 글이 십여 건 올라오며 화제가 됐다. 여러 커뮤니티에서 반응이 이어졌고 관심이 쏠렸다."), false);
  assert.equal(validParagraph(GOOD), true);
});
