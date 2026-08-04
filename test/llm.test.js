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
    issues: [{ n: 1, paragraph: "댓글 400여 개가 달리며 화제가 됐다. 여러 커뮤니티에서 언급이 이어졌고 관심이 쏠렸다." }],
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

test("검증기: 지어낸 수는 막고 출처에 있던 수는 통과시킨다", () => {
  // 2026-08-04 실측 후 정밀화. 처음엔 숫자를 통째로 막았는데 양쪽으로 틀렸다 —
  // 한글 고유수사를 못 걸렀고, 제목에 있던 숫자를 옮겨 쓴 것까지 버렸다
  // (6개 중 5개만 통과한 원인). 기준을 "입력에 없던 수를 썼는가"로 바꿨다.
  const SRC = "[1] 수학·이론 컴퓨터과학 성과 10가지\\n  - Top 10 developments (해커뉴스)";
  assert.equal(validParagraph("짧다"), false);
  assert.equal(validParagraph("<b>태그</b>가 섞인 문장입니다. 충분히 길게 써서 길이 조건은 통과하도록 만든 문장."), false);
  assert.equal(validParagraph("성과 10가지를 정리한 글이 논쟁을 낳았다. 선정 기준을 두고 의견이 갈렸고 관심이 쏠렸다.", { source: SRC }), true,
    "출처 제목에 있던 숫자는 지어낸 게 아니다");
  assert.equal(validParagraph("성과 300가지를 정리한 글이 논쟁을 낳았다. 선정 기준을 두고 의견이 갈렸고 관심이 쏠렸다.", { source: SRC }), false,
    "입력에 없던 300이 통과했다");
  assert.equal(validParagraph("성과 열 가지를 정리한 글이 논쟁을 낳았다. 선정 기준을 두고 의견이 갈렸고 관심이 쏠렸다.", { source: SRC }), true,
    "내용을 설명하는 한글 수사는 막을 이유가 없다");
});

test("검증기: 반응 수치는 입력에 있어도 문장에 못 쓴다", () => {
  // 추천·댓글 수는 코드가 재서 붙이는 값이다. 모델이 문장 안에 또 쓰면
  // 우리 수치와 어긋날 위험이 있다 — 그 자리는 코드가 채운다.
  const SRC = "추천 10건 댓글 300건";
  assert.equal(validParagraph("추천 10건이 모이며 화제가 됐다. 여러 커뮤니티에서 반응이 이어졌고 관심이 쏠렸다.", { source: SRC }), false);
  assert.equal(validParagraph("댓글 수백 건이 이어지며 화제가 됐다. 여러 커뮤니티에서 반응이 이어졌고 관심이 쏠렸다.", { source: SRC }), false);
});

test("구세대 모델에는 effort를 보내지 않는다", async () => {
  // Haiku 4.5 등 4.5대는 effort를 400으로 거부한다. LLM_MODEL로 모델을 갈아끼울
  // 수 있게 해 둔 이상, 그 약속이 Haiku에서 깨지면 안 된다.
  let sent;
  const enrich = makeWriter({ apiKey: "k", model: "claude-haiku-4-5", fetchImpl: async (u, o) => {
    sent = JSON.parse(o.body);
    return ok({ issues: [{ n: 1, paragraph: GOOD }], summary: GOOD })();
  }});
  await enrich(BRIEF, "haiku");
  assert.equal(sent.output_config.effort, undefined, "Haiku에 effort를 보냈다");
  assert.equal(sent.output_config.format.type, "json_schema", "구조화 출력은 유지돼야 한다");
});
