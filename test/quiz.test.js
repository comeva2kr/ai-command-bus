import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pickWeeklyTopics } from "../src/quiz/topics.js";
import {
  buildPrompt,
  generateQuiz,
  generateQuizWithClaude,
  templateQuiz,
  validateQuiz,
  quizSlug,
  QUIZ_SCHEMA,
  DEFAULT_MODEL
} from "../src/quiz/generate.js";
import { scoreQuiz } from "../src/quiz/engine.js";
import { QuizStore } from "../src/quiz/store.js";
import { runWeekly, weekLabel } from "../src/quiz/weekly.js";
import { routeTask } from "../src/router.js";

const HOT_ITEMS = JSON.parse(fs.readFileSync(new URL("../examples/hot_items.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-07-23T00:00:00Z");

function tmpStore() {
  return new QuizStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "quiz-")) });
}

// ---- topic picking -------------------------------------------------------

test("pickWeeklyTopics excludes politics/adult topics and ranks by hotness", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { count: 10, now: NOW });
  const titles = topics.map((t) => t.title);
  assert.ok(!titles.some((t) => t.includes("특검")), "정치 소재 제외");
  assert.ok(!titles.some((t) => t.startsWith("ㅇㅎ)")), "성인 소재 제외");
  assert.equal(titles.length, 5);
  // hotness 내림차순
  for (let i = 1; i < topics.length; i++) assert.ok(topics[i - 1].score >= topics[i].score);
});

test("pickWeeklyTopics dedupes identical titles and caps at count", () => {
  const dup = [...HOT_ITEMS, ...HOT_ITEMS];
  const topics = pickWeeklyTopics(dup, { count: 3, now: NOW });
  assert.equal(topics.length, 3);
  assert.equal(new Set(topics.map((t) => t.title)).size, 3);
});

// ---- generation ----------------------------------------------------------

test("templateQuiz produces a valid quiz from topics", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const quiz = templateQuiz(topics, { weekLabel: "2026w30" });
  assert.ok(validateQuiz(quiz));
  assert.ok(quiz.questions.length >= 2);
  assert.ok(quiz.questions[0].q.includes(topics[0].title));
});

test("validateQuiz rejects scores referencing unknown result ids", () => {
  const quiz = templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }));
  quiz.questions[0].answers[0].scores[0].result = "no-such-type";
  assert.throws(() => validateQuiz(quiz), /없는 결과 유형/);
});

test("buildPrompt includes every topic title", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  for (const t of topics) assert.ok(prompt.includes(t.title));
});

test("generateQuizWithClaude sends the structured-output request and parses the reply", async () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const expected = templateQuiz(topics);
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true,
      async json() {
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(expected) }] };
      }
    };
  };
  const quiz = await generateQuizWithClaude(topics, { apiKey: "test-key", fetchImpl });
  assert.equal(quiz.title, expected.title);
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.headers["x-api-key"], "test-key");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.body.model, DEFAULT_MODEL);
  assert.deepEqual(captured.body.thinking, { type: "adaptive" });
  assert.deepEqual(captured.body.output_config.format.schema, QUIZ_SCHEMA);
});

test("generateQuizWithClaude surfaces refusals and non-JSON replies as errors", async () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const refuse = async () => ({ ok: true, async json() { return { stop_reason: "refusal", content: [] }; } });
  await assert.rejects(() => generateQuizWithClaude(topics, { apiKey: "k", fetchImpl: refuse }), /거절/);
  const garbage = async () => ({ ok: true, async json() { return { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }; } });
  await assert.rejects(() => generateQuizWithClaude(topics, { apiKey: "k", fetchImpl: garbage }), /JSON/);
});

test("generateQuiz falls back to the template when no API key is configured", async () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { quiz, via } = await generateQuiz(topics, {});
    assert.equal(via, "template");
    assert.ok(validateQuiz(quiz));
  } finally {
    if (saved != null) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---- scoring -------------------------------------------------------------

test("scoreQuiz is deterministic and breaks ties by results order", () => {
  const quiz = templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }));
  const allFirst = quiz.questions.map(() => 0);
  const a = scoreQuiz(quiz, allFirst);
  const b = scoreQuiz(quiz, allFirst);
  assert.equal(a.resultId, b.resultId);
  // 모든 유형이 0점인 극단 케이스: 앞 순서 유형이 이긴다
  const zero = { ...quiz, questions: quiz.questions.map((q) => ({ ...q, answers: q.answers.map((ans) => ({ ...ans, scores: [{ result: quiz.results[0].id, points: 0 }] })) })) };
  assert.equal(scoreQuiz(zero, allFirst).resultId, quiz.results[0].id);
});

test("scoreQuiz rejects malformed answer arrays", () => {
  const quiz = templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }));
  assert.throws(() => scoreQuiz(quiz, [0]), /답변 수/);
  assert.throws(() => scoreQuiz(quiz, quiz.questions.map(() => 99)), /답변 번호/);
});

// ---- store + approval gate ----------------------------------------------

test("QuizStore: draft is not published until a human approves", () => {
  const store = tmpStore();
  const quiz = templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }));
  store.saveDraft("2026w30-abc", quiz, { week: "2026w30" });

  assert.equal(store.getPublished("2026w30-abc"), null);
  assert.equal(store.listDrafts().length, 1);

  const rec = store.approve("2026w30-abc");
  assert.equal(rec.status, "published");
  assert.ok(store.getPublished("2026w30-abc"));
  assert.equal(store.listDrafts().length, 0);
});

test("QuizStore rejects traversal-shaped slugs", () => {
  const store = tmpStore();
  assert.throws(() => store.saveDraft("../evil", {}), /슬러그/);
  assert.equal(store.getPublished("../../etc/passwd"), null);
});

test("QuizStore.approve refuses when there is no draft", () => {
  assert.throws(() => tmpStore().approve("nope"), /초안/);
});

// ---- weekly pipeline -----------------------------------------------------

test("runWeekly generates a draft and routes publishing to the decision queue", async () => {
  const store = tmpStore();
  const { draft, publishTask, via } = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  assert.equal(via, "template");
  assert.equal(draft.status, "draft");
  assert.equal(draft.week, weekLabel(new Date(NOW)));
  // 발행은 사람 승인 큐로 — 자동 발행 금지
  assert.equal(publishTask.nextQueue, "decision_queue");
  assert.equal(publishTask.reason, "human_approval_required");
  assert.equal(store.listPublished().length, 0);
});

test("router treats quiz publish tasks as approval-required even without the flag", () => {
  const routed = routeTask({ title: "publish quiz: 아무거나", status: "ready" });
  assert.equal(routed.nextQueue, "decision_queue");
});

test("quizSlug is stable for the same title+week and url-safe", () => {
  const quiz = { title: "이번 주 핫이슈 반응 유형테스트" };
  const a = quizSlug(quiz, "2026w30");
  assert.equal(a, quizSlug(quiz, "2026w30"));
  assert.match(a, /^[a-z0-9-]+$/);
});

// ---- server routes -------------------------------------------------------

test("server serves published quizzes with OG tags; drafts stay hidden", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-srv-"));
  const store = new QuizStore({ dir });
  const quiz = templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }), { weekLabel: "이번 주" });
  store.saveDraft("2026w30-live", quiz, { week: "2026w30" });
  store.saveDraft("2026w30-hidden", quiz, { week: "2026w30" });
  store.approve("2026w30-live");

  const server = createServer({ sources: [], quizDir: dir });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    // 발행된 퀴즈 페이지: OG 태그 + 데이터 포함
    const page = await (await fetch(`${base}/q/2026w30-live`)).text();
    assert.ok(page.includes('property="og:title"'));
    assert.ok(page.includes(quiz.title));

    // 결과 공유 페이지: 결과별 고유 OG 타이틀 (바이럴 루프)
    const rid = quiz.results[0].id;
    const resultPage = await (await fetch(`${base}/q/2026w30-live/r/${rid}`)).text();
    assert.ok(resultPage.includes(quiz.results[0].title));
    assert.ok(resultPage.includes("나도 테스트 해보기"));

    // 초안은 서빙 금지
    assert.equal((await fetch(`${base}/q/2026w30-hidden`)).status, 404);
    assert.equal((await fetch(`${base}/q/no-such`)).status, 404);
    assert.equal((await fetch(`${base}/q/2026w30-live/r/no-such-result`)).status, 404);

    // 인덱스/API에는 발행분만
    const api = await (await fetch(`${base}/api/quiz`)).json();
    assert.deepEqual(api.quizzes.map((q) => q.slug), ["2026w30-live"]);
  } finally {
    server.close();
  }
});
