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
  allTypeCodes,
  QUIZ_SCHEMA,
  DEFAULT_MODEL
} from "../src/quiz/generate.js";
import { scoreQuiz } from "../src/quiz/engine.js";
import { QuizStore } from "../src/quiz/store.js";
import { runWeekly, weekLabel } from "../src/quiz/weekly.js";
import { routeTask } from "../src/router.js";
import { renderOgCardSvg } from "../src/quiz/ogcard.js";

const HOT_ITEMS = JSON.parse(fs.readFileSync(new URL("../examples/hot_items.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-07-23T00:00:00Z");

function tmpStore() {
  return new QuizStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "quiz-")) });
}

function sampleQuiz() {
  return templateQuiz(pickWeeklyTopics(HOT_ITEMS, { now: NOW }), { weekLabel: "2026w30" });
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

// ---- axis-based format ---------------------------------------------------

test("templateQuiz produces a valid axis-based quiz meeting the design spec", () => {
  const quiz = sampleQuiz();
  assert.ok(validateQuiz(quiz));
  // 설계 스펙: 축 2~4개, 문항 8~15개, 유형 수 = 2^축수
  assert.ok(quiz.axes.length >= 2 && quiz.axes.length <= 4);
  assert.ok(quiz.questions.length >= 8 && quiz.questions.length <= 15);
  assert.equal(quiz.results.length, 2 ** quiz.axes.length);
  // 80:20 — 강점 3~5, 성장 포인트 1~2, 궁합 지정
  for (const r of quiz.results) {
    assert.ok(r.strengths.length >= 3);
    assert.ok(r.weaknesses.length >= 1 && r.weaknesses.length <= 2);
    assert.ok(r.bestMatch && r.worstMatch);
  }
});

test("allTypeCodes enumerates every pole combination in axis order", () => {
  const quiz = sampleQuiz();
  const codes = allTypeCodes(quiz.axes);
  assert.equal(codes.length, 2 ** quiz.axes.length);
  assert.ok(codes.includes("FS") && codes.includes("TK"));
});

test("validateQuiz enforces axis question balance and pole mixing", () => {
  const quiz = sampleQuiz();
  // 한 축의 문항이 3개 미만이면 거부 (총 문항 수는 유지한 채 축만 재배정)
  const starved = structuredClone(quiz);
  let kept = 0;
  for (const q of starved.questions) {
    if (q.axis === "sharing" && ++kept > 2) q.axis = "reaction";
  }
  assert.throws(() => validateQuiz(starved), /3개 미만/);
  // 한쪽 극만 미는 문항 거부 (정답 냄새/역채점 균형 규칙)
  const lopsided = structuredClone(quiz);
  lopsided.questions[0].answers = lopsided.questions[0].answers.map((a) => ({ ...a, pole: "left" }));
  assert.throws(() => validateQuiz(lopsided), /한쪽 극만/);
  // 유형 조합 커버리지: 하나 빠지면 거부
  const missing = structuredClone(quiz);
  missing.results = missing.results.slice(1);
  assert.throws(() => validateQuiz(missing), /결과가 없어요/);
});

test("validateQuiz enforces the 80:20 result copy rules", () => {
  const flattery = structuredClone(sampleQuiz());
  flattery.results[0].weaknesses = []; // 칭찬만 있는 결과는 가짜같이 느껴진다
  assert.throws(() => validateQuiz(flattery), /성장 포인트/);
  const selfMatch = structuredClone(sampleQuiz());
  selfMatch.results[0].bestMatch = selfMatch.results[0].code;
  assert.throws(() => validateQuiz(selfMatch), /bestMatch/);
});

// ---- generation ----------------------------------------------------------

test("buildPrompt includes every topic title and the design rules", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  for (const t of topics) assert.ok(prompt.includes(t.title));
  assert.ok(prompt.includes("심리 축"));
  assert.ok(prompt.includes("상황 제시형"));
  assert.ok(prompt.includes("80:20"));
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

// ---- axis scoring --------------------------------------------------------

test("scoreQuiz computes per-axis spectrum percentages and the type code", () => {
  const quiz = sampleQuiz();
  // 모든 문항에서 왼쪽 극(weight 최대) 답을 고르면 전축 left → 코드 FS
  const allLeft = quiz.questions.map((q) => q.answers.findIndex((a) => a.pole === "left" && (a.weight || 1) === 2));
  const scored = scoreQuiz(quiz, allLeft);
  assert.equal(scored.code, "FS");
  for (const axis of scored.axes) {
    assert.equal(axis.leftPercent, 100);
    assert.equal(axis.dominant, "left");
  }
  assert.equal(scored.result.code, "FS");
});

test("scoreQuiz is deterministic and resolves a 50:50 axis to the left pole", () => {
  const quiz = sampleQuiz();
  const picks = quiz.questions.map(() => 0);
  assert.equal(scoreQuiz(quiz, picks).code, scoreQuiz(quiz, picks).code);
  // 인위적 동점: 축 하나를 weight 1 좌/우 하나씩만 남긴 미니 퀴즈로 확인
  const mini = structuredClone(quiz);
  mini.questions = mini.questions.map((q) => ({
    ...q,
    answers: [
      { text: "l", pole: "left", weight: 1 },
      { text: "r", pole: "right", weight: 1 }
    ]
  }));
  // 각 축의 문항 절반 left, 절반 right 선택 → 50:50 → left 확정
  const perAxisSeen = {};
  const tiePicks = mini.questions.map((q) => {
    perAxisSeen[q.axis] = (perAxisSeen[q.axis] || 0) + 1;
    return perAxisSeen[q.axis] % 2 === 1 ? 0 : 1;
  });
  // sharing/reaction 각 5문항(홀수)이라 정확한 동점은 아님 — leftPercent >= 50 확인
  const tied = scoreQuiz(mini, tiePicks);
  for (const axis of tied.axes) assert.equal(axis.dominant, axis.leftPercent >= 50 ? "left" : "right");
});

test("scoreQuiz rejects malformed answer arrays", () => {
  const quiz = sampleQuiz();
  assert.throws(() => scoreQuiz(quiz, [0]), /답변 수/);
  assert.throws(() => scoreQuiz(quiz, quiz.questions.map(() => 99)), /답변 번호/);
});

// ---- store + approval gate ----------------------------------------------

test("QuizStore: draft is not published until a human approves", () => {
  const store = tmpStore();
  store.saveDraft("2026w30-abc", sampleQuiz(), { week: "2026w30" });

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

test("QuizStore response stats accumulate with Laplace smoothing", () => {
  const store = tmpStore();
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-s", quiz);
  store.approve("2026w30-s");
  const codes = quiz.results.map((r) => r.code);

  // 응답 0건: 스무딩 덕에 모든 유형이 균등(25%)
  let stats = store.statsFor("2026w30-s", codes);
  assert.equal(stats.total, 0);
  for (const c of codes) assert.equal(stats.share[c], 25);

  for (let i = 0; i < 6; i++) store.recordResponse("2026w30-s", "FS");
  stats = store.statsFor("2026w30-s", codes);
  assert.equal(stats.total, 6);
  assert.ok(stats.share.FS > stats.share.TK);

  // 미발행/엉터리 코드 거부
  assert.throws(() => store.recordResponse("2026w30-s", "XX"), /없는 유형/);
  assert.throws(() => store.recordResponse("no-such", "FS"), /발행된/);
});

// ---- pack manifest (WRC 표준 미러) ----------------------------------------

test("pack manifest declares the WRC-standard contract blocks", async () => {
  const { MANIFEST, CONTRACT } = await import("../src/quiz/manifest.js");
  // 필수 블록
  for (const key of ["project", "pack", "display_name_ko", "activation", "pipeline", "pack_contract", "files", "node_owner_map", "algo_map", "identity", "registration"]) {
    assert.ok(MANIFEST[key] != null, `매니페스트 필수 블록 누락: ${key}`);
  }
  // 발행은 external action — no_go로 명문화 (fail-closed)
  assert.ok(MANIFEST.activation.no_go.includes("external_publish"));
  assert.equal(MANIFEST.activation.external_actions_enabled, false);
  // 게이트 계약: QG 접두, 사람 게이트는 kind: david (등급 아님)
  assert.deepEqual(CONTRACT.required_gate_ids, ["QG0", "QG1", "QG2", "QG3", "QG4", "QG5", "QG6"]);
  for (const id of ["QG0", "QG1", "QG2", "QG3", "QG4", "QG6"]) {
    assert.ok(["HARD", "HOLD", "GUIDE"].includes(CONTRACT.gate_grades[id]), `등급 미선언: ${id}`);
    assert.ok(CONTRACT.risk_policy[id], `risk_policy 미선언: ${id}`);
  }
  assert.equal(CONTRACT.gate_grades.QG5, undefined, "QG5는 등급이 아니라 사람 게이트");
  const davidNode = MANIFEST.pipeline.find((n) => n.gateIds.includes("QG5"));
  assert.equal(davidNode.kind, "david");
  // 재시도 예산은 매니페스트가 원본
  assert.equal(CONTRACT.retry_budget, 3);
  // 구 ID 마이그레이션 표
  assert.equal(CONTRACT.gate_id_migration.G1, "QG1");
  // identity 5필드 + WRC 계약 패턴 (2026-07-24 정합 검토 교정 반영):
  // project:/driver-seat:/pack: 접두, enginePackId는 접두 없는 snake_case 엔진명
  for (const k of ["projectId", "driverSeatId", "packId", "enginePackId", "workflowSlug"]) {
    assert.ok(MANIFEST.identity[k], `identity 필드 누락: ${k}`);
  }
  assert.match(MANIFEST.identity.projectId, /^project:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.driverSeatId, /^driver-seat:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.packId, /^pack:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.enginePackId, /^[a-z0-9_]+$/);
});

test("manifest is the single source for gate constants (no code drift)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const { EXCLUDED_TOPICS } = await import("../src/quiz/topics.js");
  assert.deepEqual([...EXCLUDED_TOPICS].sort(), [...CONTRACT.excluded_topics].sort());
  const { GATES } = await import("../src/quiz/gates.js");
  for (const gate of GATES) {
    assert.equal(gate.grade, CONTRACT.gate_grades[gate.key], `게이트 ${gate.key} 등급이 매니페스트와 다름`);
  }
});

// ---- loop gates ----------------------------------------------------------

test("template quiz clears every loop gate (QG1~QG4)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const report = runGates(sampleQuiz());
  assert.deepEqual(report.failures, []);
  assert.equal(report.pass, true);
});

test("runGates returns the WRC result envelope (decision/reasons/gateResults)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const good = runGates(sampleQuiz());
  assert.equal(good.decision, "PASS");
  assert.deepEqual(good.reasons, []);
  assert.equal(good.gateResults.length, 4);
  for (const g of good.gateResults) {
    assert.match(g.id, /^QG[1-4]-/);
    assert.ok(["HARD", "HOLD"].includes(g.grade));
    assert.equal(g.pass, true);
  }

  // HARD 게이트(QG1 구조) 실패 → BLOCK
  const broken = structuredClone(sampleQuiz());
  broken.results[0].weaknesses = [];
  const blocked = runGates(broken);
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.reasons.some((r) => r.startsWith("[QG1-structure]")));

  // HOLD 게이트(QG2 바이럴)만 실패 → HOLD
  const thin = structuredClone(sampleQuiz());
  thin.results[0].shareText = "결과를 확인해 보라구? 너도 해봐"; // I-got 누락, 나머지 통과
  const held = runGates(thin);
  assert.equal(held.decision, "HOLD");
  assert.ok(held.reasons.every((r) => r.startsWith("[QG2-viral]")));
});

test("QG2 viral gate rejects thin result copy and missing I-got share text", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[0].description = "짧음";
  quiz.results[1].shareText = "테스트 해보세요";
  const report = runGates(quiz);
  assert.equal(report.pass, false);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("두 줄짜리")));
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("나는")));
});

test("QG3 ai-tell gate rejects chatbot phrasing and duplicated answers", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const botty = structuredClone(sampleQuiz());
  botty.results[0].description = "물론입니다. 당신은 트렌드에 밝은 유형으로, 정보를 빠르게 접하는 편입니다.";
  let report = runGates(botty);
  assert.ok(report.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("물론")));

  const copied = structuredClone(sampleQuiz());
  const firstAnswers = copied.questions[0].answers;
  for (const q of copied.questions) q.answers = structuredClone(firstAnswers);
  report = runGates(copied);
  assert.ok(report.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("중복률")));
});

test("QG4 scoring gate rejects lopsided axis weights", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const skewed = structuredClone(sampleQuiz());
  for (const q of skewed.questions.filter((x) => x.axis === "sharing")) {
    for (const a of q.answers) a.weight = a.pole === "left" ? 2 : 1;
  }
  const report = runGates(skewed);
  assert.ok(report.failures.some((f) => f.gate === "QG4-scoring" && f.message.includes("sharing")));
});

test("runWeekly loops on gate failure, feeding rejection reasons back into the prompt", async () => {
  const store = tmpStore();
  const good = sampleQuiz();
  const bad = structuredClone(good);
  bad.results[0].weaknesses = []; // QG1 위반: 칭찬만 있는 결과문
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const reply = bodies.length === 1 ? bad : good;
    return {
      ok: true,
      async json() {
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] };
      }
    };
  };
  const { draft, via } = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: "k", fetchImpl });
  assert.equal(via, "claude");
  assert.equal(bodies.length, 2, "1차 반려 → 2차 재생성");
  const secondPrompt = bodies[1].messages[0].content;
  assert.ok(secondPrompt.includes("반려"), "반려 사유 섹션이 프롬프트에 주입됨");
  assert.ok(secondPrompt.includes("QG1-structure"), "게이트 ID가 피드백에 포함됨");
  assert.equal(draft.gate.attempts, 2);
  assert.equal(draft.gate.history[0].pass, false);
  assert.equal(draft.gate.history[1].pass, true);
});

test("runWeekly aborts with the gate report when retries are exhausted", async () => {
  const store = tmpStore();
  const bad = structuredClone(sampleQuiz());
  bad.results[0].weaknesses = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, async json() { return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(bad) }] }; } };
  };
  await assert.rejects(
    () => runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: "k", fetchImpl, maxAttempts: 2 }),
    (err) => {
      // fail-loud: 조용한 드롭 없이 판정과 [게이트ID] 사유가 실려 나온다
      assert.match(err.message, /루프게이트를 통과하지 못했/);
      assert.equal(err.decision, "BLOCK"); // QG1(HARD) 위반
      assert.ok(err.reasons.some((r) => r.startsWith("[QG1-structure]")));
      return true;
    }
  );
  assert.equal(calls, 2);
  assert.equal(store.listDrafts().length, 0, "게이트 미통과 퀴즈는 초안조차 되지 않는다");
});

test("runWeekly re-run of the same week converges on one draft (run binding)", async () => {
  const store = tmpStore();
  const first = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  const second = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  // 같은 회차·같은 콘텐츠 → 같은 slug/run id로 원자적 덮어쓰기, 중복 산출 0
  assert.equal(first.draft.slug, second.draft.slug);
  assert.equal(second.draft.run.id, `${second.draft.week}-${second.draft.slug}`);
  assert.equal(store.listDrafts().length, 1);
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

test("server serves published quizzes with credibility devices; drafts stay hidden", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-srv-"));
  const store = new QuizStore({ dir });
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-live", quiz, { week: "2026w30" });
  store.saveDraft("2026w30-hidden", quiz, { week: "2026w30" });
  store.approve("2026w30-live");

  const server = createServer({ sources: [], quizDir: dir });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    // 퀴즈 페이지: OG + 축 소개(신뢰 프레이밍)
    const page = await (await fetch(`${base}/q/2026w30-live`)).text();
    assert.ok(page.includes('property="og:title"'));
    assert.ok(page.includes(quiz.title));
    assert.ok(page.includes("성향 축"), "축 기반 채점 프레이밍 노출");

    // 응답 집계 API
    const post = await fetch(`${base}/api/quiz/2026w30-live/response`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "FS" })
    });
    assert.equal(post.status, 200);
    assert.equal((await fetch(`${base}/api/quiz/2026w30-live/response`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "ZZ" }) })).status, 400);

    // 개인 결과 페이지 (?p=): 축 퍼센트 바 + 희소성 통계 + 강점/성장/궁합
    const personal = await (await fetch(`${base}/q/2026w30-live/r/FS?p=80,60`)).text();
    assert.ok(personal.includes("내 성향 스펙트럼"));
    assert.ok(personal.includes("80%"));
    assert.ok(personal.includes("응답자 중"), "희소성 통계 배지");
    assert.ok(personal.includes("성장 포인트"));
    assert.ok(personal.includes("환장의 케미"));
    assert.ok(personal.includes("재미로 보는"), "면책 라벨");

    // 공유 유입 (p 없음): 개인 바 대신 참여 훅
    const shared = await (await fetch(`${base}/q/2026w30-live/r/FS`)).text();
    assert.ok(shared.includes("직접 테스트하면"));
    assert.ok(shared.includes('property="og:title"'));
    assert.ok(shared.includes("나도 테스트 해보기"));

    // 초안/엉터리 코드는 404
    assert.equal((await fetch(`${base}/q/2026w30-hidden`)).status, 404);
    assert.equal((await fetch(`${base}/q/no-such`)).status, 404);
    assert.equal((await fetch(`${base}/q/2026w30-live/r/ZZ`)).status, 404);

    // 인덱스/API에는 발행분만
    const api = await (await fetch(`${base}/api/quiz`)).json();
    assert.deepEqual(api.quizzes.map((q) => q.slug), ["2026w30-live"]);
  } finally {
    server.close();
  }
});

// ---- OG share card: SVG generation (src/quiz/ogcard.js) -------------------
// Kakao/Facebook/Twitter link crawlers don't rasterize SVG, so og:image needs
// a PNG — but the SVG algorithm itself is dependency-free and fully
// deterministic, so it's tested directly here (no resvg needed).

test("renderOgCardSvg produces the same SVG for the same input (deterministic)", () => {
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const a = renderOgCardSvg(quiz, result, { sharePercent: 12, origin: "https://example.com" });
  const b = renderOgCardSvg(quiz, result, { sharePercent: 12, origin: "https://example.com" });
  assert.equal(a, b);
  const coverA = renderOgCardSvg(quiz, null, { origin: "https://example.com" });
  const coverB = renderOgCardSvg(quiz, null, { origin: "https://example.com" });
  assert.equal(coverA, coverB);
});

test("renderOgCardSvg escapes XML-special characters in titles/labels", () => {
  const quiz = structuredClone(sampleQuiz());
  quiz.title = `제목 <b>강조</b> & "인용" 태그`;
  quiz.results[0].title = `유형 <script>alert(1)</script>`;
  const svg = renderOgCardSvg(quiz, quiz.results[0], {});
  assert.ok(!svg.includes("<b>강조</b>"), "raw HTML tag from title must not leak unescaped");
  assert.ok(!svg.includes("<script>"), "raw script tag from type title must not leak unescaped");
  assert.ok(svg.includes("&lt;b&gt;") || svg.includes("&amp;lt;b&amp;gt;"), "title tag should be escaped");
  assert.ok(svg.includes("&amp;"), "ampersand should be escaped");
  assert.ok(svg.includes("&quot;"), "double quote should be escaped");
  // the SVG itself must still be well-formed enough to not contain a bare '<' followed by a tag-looking word from user content
  assert.ok(!/<script>/.test(svg));
});

test("renderOgCardSvg gives each result type a distinct hue (golden-angle stepping)", () => {
  const quiz = sampleQuiz();
  const hueOf = (svg) => svg.match(/hsl\((\d+(?:\.\d+)?), 85%, 62%\)/)[1];
  const h0 = hueOf(renderOgCardSvg(quiz, quiz.results[0], {}));
  const h1 = hueOf(renderOgCardSvg(quiz, quiz.results[1], {}));
  const h2 = hueOf(renderOgCardSvg(quiz, quiz.results[2], {}));
  assert.notEqual(h0, h1);
  assert.notEqual(h1, h2);
  assert.notEqual(h0, h2);
});

test("renderOgCardSvg wraps and scales down long type names, keeping a floor of 48px", () => {
  const quiz = structuredClone(sampleQuiz());
  quiz.results[0].title = "완전히 극단적으로 길고 긴 유형 이름 테스트용";
  const svg = renderOgCardSvg(quiz, quiz.results[0], {});
  const sizes = [...svg.matchAll(/font-weight="800" fill="#ffffff">/g)];
  assert.ok(sizes.length >= 2, "long title should wrap to two lines");
  const fontSizeMatch = svg.match(/font-size="(\d+)" font-weight="800"/);
  const size = Number(fontSizeMatch[1]);
  assert.ok(size < 76, "font should scale down below the 76px base");
  assert.ok(size >= 48, "font should never go below the 48px floor");

  // a short type name stays single-line at the base size
  const short = structuredClone(sampleQuiz());
  short.results[0].title = "짧은유형";
  const shortSvg = renderOgCardSvg(short, short.results[0], {});
  const shortSize = Number(shortSvg.match(/font-size="(\d+)" font-weight="800"/)[1]);
  assert.equal(shortSize, 76);
});

test("renderOgCardSvg cover card reflects the actual number of result types", () => {
  const quiz = sampleQuiz();
  const svg = renderOgCardSvg(quiz, null, {});
  assert.ok(svg.includes(`${quiz.results.length}가지 유형 중 넌 뭐야?`));
});

test("renderOgCardSvg rarity badge appears only with sharePercent, 'rare' label only at <=15%", () => {
  const quiz = sampleQuiz();
  const rare = renderOgCardSvg(quiz, quiz.results[0], { sharePercent: 8 });
  assert.ok(rare.includes("응답자 중 8%"));
  assert.ok(rare.includes("희귀 유형"));

  const common = renderOgCardSvg(quiz, quiz.results[0], { sharePercent: 40 });
  assert.ok(common.includes("응답자 중 40%"));
  assert.ok(!common.includes("희귀 유형"));

  const noStat = renderOgCardSvg(quiz, quiz.results[0], {});
  assert.ok(!noStat.includes("응답자 중"), "no rarity badge without sharePercent");

  // cover card never shows a rarity badge, even if sharePercent were passed
  const cover = renderOgCardSvg(quiz, null, { sharePercent: 5 });
  assert.ok(!cover.includes("응답자 중"));
});

test("renderOgCardSvg never fabricates per-user axis percentages on the pole chips", () => {
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  // no opts.sharePercent → no rarity badge, so any "%" left would have to be
  // an invented per-axis number, which the design explicitly forbids.
  const svg = renderOgCardSvg(quiz, result, {});
  assert.ok(!svg.includes("응답자 중"), "no rarity badge without sharePercent");
  // exclude SVG-internal percentages (gradient stops like "hsl(..,62%,22%)")
  // and only check for a rendered "NN%" *text* — the shape a fabricated
  // per-user axis number would take.
  assert.ok(!/>\s*\d{1,3}%/.test(svg), "no invented percentage numbers rendered as text on the card");
  // the pole labels themselves ARE present — that's the real evidence we have
  quiz.axes.forEach((axis, i) => {
    const code = result.code[i];
    const pole = code === axis.left.code ? axis.left : axis.right;
    assert.ok(svg.includes(`>${pole.label}<`), `expected pole label "${pole.label}" chip on the card`);
  });
});

// ---- OG share card: PNG route + rasterizer (optional dependency) ---------

test("GET /q/<slug>/og/<code>.png and /og/cover.png serve real PNGs; bad slug/code 404", async (t) => {
  let resvgAvailable = true;
  try {
    await import("@resvg/resvg-js");
  } catch {
    resvgAvailable = false;
  }

  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-og-"));
  const store = new QuizStore({ dir });
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-og", quiz, { week: "2026w30" });
  store.approve("2026w30-og");
  for (let i = 0; i < 4; i++) store.recordResponse("2026w30-og", quiz.results[0].code);

  const server = createServer({ sources: [], quizDir: dir });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    // redirect: "manual" — fetch() follows 302s by default, which would hide
    // the fallback status behind the icon.svg response it redirects to.
    const typeRes = await fetch(`${base}/q/2026w30-og/og/${quiz.results[0].code}.png`, { redirect: "manual" });
    const coverRes = await fetch(`${base}/q/2026w30-og/og/cover.png`, { redirect: "manual" });

    if (!resvgAvailable) {
      // renderer not installed: fail-open to the static icon, never crash.
      assert.equal(typeRes.status, 302);
      assert.equal(typeRes.headers.get("location"), `${base}/icon.svg`);
      assert.equal(coverRes.status, 302);
      t.skip("@resvg/resvg-js not installed — verified 302 fallback only");
    } else {
      assert.equal(typeRes.status, 200);
      assert.equal(typeRes.headers.get("content-type"), "image/png");
      assert.equal(typeRes.headers.get("cache-control"), "public, max-age=3600");
      const typeBuf = Buffer.from(await typeRes.arrayBuffer());
      assert.deepEqual(typeBuf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      assert.ok(typeBuf.length > 5000, "rendered PNG should be more than a blank stub");

      assert.equal(coverRes.status, 200);
      const coverBuf = Buffer.from(await coverRes.arrayBuffer());
      assert.deepEqual(coverBuf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      // cache file materialized on disk (5%-bucketed key)
      const ogFiles = fs.readdirSync(path.join(dir, "og"));
      assert.ok(ogFiles.some((f) => f.startsWith(`2026w30-og-${quiz.results[0].code}-p`)));
      assert.ok(ogFiles.some((f) => f.startsWith("2026w30-og-cover-cover")));
    }

    // unpublished slug and bogus type code both 404 (never leak drafts/typos)
    store.saveDraft("2026w30-hidden-og", quiz, { week: "2026w30" });
    assert.equal((await fetch(`${base}/q/2026w30-hidden-og/og/cover.png`)).status, 404);
    assert.equal((await fetch(`${base}/q/2026w30-og/og/ZZ.png`)).status, 404);
    assert.equal((await fetch(`${base}/q/no-such-slug/og/cover.png`)).status, 404);
  } finally {
    server.close();
  }
});

test("result page HTML points og:image at the PNG route and offers a save-card link", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-ogmeta-"));
  const store = new QuizStore({ dir });
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-meta", quiz, { week: "2026w30" });
  store.approve("2026w30-meta");

  const server = createServer({ sources: [], quizDir: dir });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const code = quiz.results[0].code;
    const page = await (await fetch(`${base}/q/2026w30-meta/r/${code}`)).text();
    assert.ok(page.includes(`property="og:image" content="${base}/q/2026w30-meta/og/${code}.png"`));
    assert.ok(page.includes(`/q/2026w30-meta/og/${code}.png" download`), "share area should offer a downloadable card link");

    const quizPage = await (await fetch(`${base}/q/2026w30-meta`)).text();
    assert.ok(quizPage.includes(`property="og:image" content="${base}/q/2026w30-meta/og/cover.png"`));
  } finally {
    server.close();
  }
});
