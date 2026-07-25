import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// weekly.js를 실제 CLI로 실행하기 위한 경로들 — prompt/submit은 자식 프로세스
// 계약(exit code·stdout/stderr)이 곧 스펙이라 함수 호출로는 그 계약을 검증할
// 수 없다.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEEKLY_JS = path.join(REPO_ROOT, "src", "quiz", "weekly.js");

function runWeeklyCli(args, env = {}) {
  return spawnSync(process.execPath, [WEEKLY_JS, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function tmpStore() {
  return new QuizStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "quiz-")) });
}

// render.js의 esc()와 동일한 규칙 (private이라 여기선 로컬 재구현) — 렌더된
// HTML에서 원문 문자열을 비교할 때 escaped 형태로 맞춰본다.
function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

// 2차 적대 검수(v3): theqoo 단일 출처 편중 해소 — 출처당 캡은 지키되, 후보가
// 부족할 때만 캡을 넘겨서라도 요청 개수를 채운다(실패 대신 채움).
test("pickWeeklyTopics caps picks per source but backfills from overflow to still guarantee the requested count", () => {
  const dominant = Array.from({ length: 6 }, (_, i) => ({
    title: `테오쿠 몰빵 소재 ${i}`,
    url: `https://example.com/dom${i}`,
    source: "theqoo",
    score: 9000 - i,
    commentCount: 100,
    publishedAt: "2026-07-22T09:00:00Z"
  }));
  const others = [
    { title: "다른 출처 인생 야식", url: "https://example.com/o1", source: "ppomppu", score: 500, commentCount: 50, publishedAt: "2026-07-21T09:00:00Z" },
    { title: "다른 출처 헬스장 빌런", url: "https://example.com/o2", source: "mlbpark", score: 400, commentCount: 40, publishedAt: "2026-07-21T09:00:00Z" }
  ];

  // 분산 확인: 대체 후보가 충분하면 한 출처가 요청 개수를 독점하지 못한다.
  const spread = pickWeeklyTopics([...dominant, ...others], { count: 4, now: NOW });
  assert.equal(spread.length, 4);
  const bySource = {};
  for (const t of spread) bySource[t.source] = (bySource[t.source] || 0) + 1;
  assert.ok(bySource.theqoo <= 2, `theqoo가 캡(2)을 넘었다: ${bySource.theqoo}`);
  assert.equal(bySource.ppomppu, 1);
  assert.equal(bySource.mlbpark, 1);

  // 개수 보장: 대체 출처가 아예 없으면 캡을 넘겨서라도(overflow) 요청 개수를 채운다.
  const starved = pickWeeklyTopics(dominant, { count: 5, now: NOW });
  assert.equal(starved.length, 5, "대체 출처가 없을 때도 개수는 보장돼야 한다");
  assert.equal(starved.filter((t) => t.source === "theqoo").length, 5);
});

// David 실사용 피드백(2026-07-25): 다른 출처 제목과 핵심 토큰이 2개+
// 겹치면(여러 커뮤니티에서 동시에 화제 = 대중성 신호) hotness에 가산점을
// 준다 — 신호 없는 후보가 raw hotness로는 앞서도, 신호 있는 후보 쌍이
// 가산점으로 역전해 최종 선정 멤버십이 바뀌어야 한다.
test("pickWeeklyTopics boosts topics that share 2+ title tokens with a different source (cross-source popularity signal)", () => {
  const now = NOW;
  const signalA = {
    title: "국민 간식 즉석떡볶이 맛집 총정리",
    url: "https://example.com/s1",
    source: "boardA",
    score: 100,
    commentCount: 50,
    publishedAt: new Date(now).toISOString()
  };
  const signalB = {
    title: "국민 간식 즉석떡볶이 골목 탐방",
    url: "https://example.com/s2",
    source: "boardB",
    score: 100,
    commentCount: 50,
    publishedAt: new Date(now).toISOString()
  };
  const soloHigher = {
    title: "요가원에서 생긋 미소짓는 고양이",
    url: "https://example.com/s3",
    source: "boardC",
    score: 150,
    commentCount: 50,
    publishedAt: new Date(now).toISOString()
  };

  const picked = pickWeeklyTopics([signalA, signalB, soloHigher], { count: 2, now });
  const titles = picked.map((t) => t.title);
  assert.ok(titles.includes(signalA.title) && titles.includes(signalB.title), "교차 출처 신호가 있는 두 소재가 함께 선정돼야 한다");
  assert.ok(!titles.includes(soloHigher.title), "raw hotness가 더 높아도 교차 출처 신호가 없는 단일 소재는 밀려나야 한다");
});

// David 실사용 피드백(2026-07-25): 교차 출처 신호가 없는(단일 커뮤 내수)
// 소재는 최종 선정에서 max_single_source_topics개로 캡을 건다 — 신호가
// 있는 소재는 이 캡에서 면제된다. 대체 후보가 부족하면 캡을 완화해서라도
// 요청 개수(count)는 보장한다.
test("pickWeeklyTopics caps solo (no cross-source signal) topics at max_single_source_topics, replacing overflow with signal topics", () => {
  const now = NOW;
  const iso = new Date(now).toISOString();
  // 서로 다른 출처지만 토큰 2개+ 겹쳐 교차 출처 신호를 가진 한 쌍.
  const signalX = { title: "동네 빵집 신메뉴 소보로", url: "https://example.com/x1", source: "sig1", score: 60, commentCount: 30, publishedAt: iso };
  const signalY = { title: "동네 빵집 오픈런 후기", url: "https://example.com/x2", source: "sig2", score: 60, commentCount: 30, publishedAt: iso };
  // 신호 없는(단일 출처) 소재 4개 — raw hotness는 신호 쌍보다 훨씬 높게.
  const solos = [
    { title: "헬스장 러닝머신 예약 전쟁", url: "https://example.com/o1", source: "solo1", score: 900, commentCount: 100, publishedAt: iso },
    { title: "야식 배달 대기 시간 실측", url: "https://example.com/o2", source: "solo2", score: 800, commentCount: 100, publishedAt: iso },
    { title: "지하철 막차 놓친 사연", url: "https://example.com/o3", source: "solo3", score: 700, commentCount: 100, publishedAt: iso },
    { title: "사무실 탕비실 간식 취향", url: "https://example.com/o4", source: "solo4", score: 600, commentCount: 100, publishedAt: iso }
  ];

  // 캡 적용: count=4 — solo가 4개 다 raw hotness로는 이기지만, 단일 출처
  // 캡(2)에 걸려 상위 2개(solo1,solo2)만 남고, 신호 쌍(signalX,signalY)이
  // 나머지 자리를 채운다.
  const capped = pickWeeklyTopics([signalX, signalY, ...solos], { count: 4, now });
  const cappedTitles = capped.map((t) => t.title);
  assert.equal(cappedTitles.length, 4);
  assert.ok(cappedTitles.includes(signalX.title) && cappedTitles.includes(signalY.title), "신호 있는 소재는 캡에서 면제돼 항상 선정된다");
  assert.ok(cappedTitles.includes(solos[0].title) && cappedTitles.includes(solos[1].title), "단일 출처 소재는 상위 max_single_source_topics개까지만");
  assert.ok(!cappedTitles.includes(solos[2].title) && !cappedTitles.includes(solos[3].title), "캡 초과분은 raw hotness가 높아도 밀려난다");

  // 완화: 신호 있는 대체 후보가 아예 없으면(solo만 존재) 캡을 넘겨서라도
  // 요청 개수를 채운다 — max_per_source 캡의 기존 완화 규칙과 동일한 원칙.
  const starved = pickWeeklyTopics(solos, { count: 4, now });
  assert.equal(starved.length, 4, "대체할 신호 소재가 없을 때도 개수는 보장돼야 한다");
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

// 2차 검수: 케미(bestMatch/worstMatch)가 코드 조합만 보여주고 근거가 없다는
// 지적 반영 — 왜 맞는지/왜 부딪히는지 한 줄 상황극(40자 이내)을 필수화.
test("validateQuiz requires non-empty bestMatchReason/worstMatchReason within 40 chars", () => {
  const missingBest = structuredClone(sampleQuiz());
  delete missingBest.results[0].bestMatchReason;
  assert.throws(() => validateQuiz(missingBest), /bestMatchReason이 비었어요/);

  const missingWorst = structuredClone(sampleQuiz());
  missingWorst.results[0].worstMatchReason = "";
  assert.throws(() => validateQuiz(missingWorst), /worstMatchReason이 비었어요/);

  const tooLong = structuredClone(sampleQuiz());
  tooLong.results[0].bestMatchReason = "가".repeat(41);
  assert.throws(() => validateQuiz(tooLong), /bestMatchReason이 40자를 넘어요/);

  // 템플릿 자체는 정상적으로 채워져 있어야 한다.
  const quiz = sampleQuiz();
  for (const r of quiz.results) {
    assert.ok(r.bestMatchReason && r.bestMatchReason.length <= 40);
    assert.ok(r.worstMatchReason && r.worstMatchReason.length <= 40);
  }
});

// David 실사용 피드백(2026-07-25): 퀴즈가 커뮤니티 내부자 전보체로 나온다는
// 지적 반영 — 사전설명(weeklyBrief)이 스키마 필수 필드가 됐다.
test("validateQuiz requires weeklyBrief with non-empty topic/intro (15~90자) and a valid familiarity tier", () => {
  const missingBrief = structuredClone(sampleQuiz());
  delete missingBrief.weeklyBrief;
  assert.throws(() => validateQuiz(missingBrief), /주간 브리핑\(weeklyBrief\)이 없어요/);

  const emptyBrief = structuredClone(sampleQuiz());
  emptyBrief.weeklyBrief = [];
  assert.throws(() => validateQuiz(emptyBrief), /주간 브리핑\(weeklyBrief\)이 없어요/);

  const emptyIntro = structuredClone(sampleQuiz());
  emptyIntro.weeklyBrief[0].intro = "";
  assert.throws(() => validateQuiz(emptyIntro), /intro가 비었어요/);

  const shortIntro = structuredClone(sampleQuiz());
  shortIntro.weeklyBrief[0].intro = "너무 짧다";
  assert.throws(() => validateQuiz(shortIntro), /15~90자여야 해요/);

  const longIntro = structuredClone(sampleQuiz());
  longIntro.weeklyBrief[0].intro = "가".repeat(91);
  assert.throws(() => validateQuiz(longIntro), /15~90자여야 해요/);

  const badTier = structuredClone(sampleQuiz());
  badTier.weeklyBrief[0].tier = "밈이해도";
  assert.throws(() => validateQuiz(badTier), /tier가 잘못됐어요/);

  const missingTier = structuredClone(sampleQuiz());
  delete missingTier.weeklyBrief[0].tier;
  assert.throws(() => validateQuiz(missingTier), /tier가 잘못됐어요/);

  // 템플릿은 항상 통과해야 한다.
  const quiz = sampleQuiz();
  assert.ok(Array.isArray(quiz.weeklyBrief) && quiz.weeklyBrief.length > 0);
  for (const b of quiz.weeklyBrief) {
    assert.ok(b.topic && b.intro.length >= 15 && b.intro.length <= 90);
    assert.ok(["국민상식", "대중화제", "커뮤내수"].includes(b.tier));
  }
});

// David 실사용 피드백(2026-07-25): "이 테스트가 뭘 확인하는지" 처음 온
// 사람에게 설명하고 시작해야 한다 — 축마다 intro가 필수다.
test("validateQuiz requires a friendly axis intro (15~70자) explaining what the axis measures", () => {
  const missingIntro = structuredClone(sampleQuiz());
  delete missingIntro.axes[0].intro;
  assert.throws(() => validateQuiz(missingIntro), /intro\(이 축이 뭘 확인하는지 설명\)가 없어요/);

  const shortIntro = structuredClone(sampleQuiz());
  shortIntro.axes[0].intro = "짧음";
  assert.throws(() => validateQuiz(shortIntro), /15~70자여야 해요/);

  const longIntro = structuredClone(sampleQuiz());
  longIntro.axes[0].intro = "가".repeat(71);
  assert.throws(() => validateQuiz(longIntro), /15~70자여야 해요/);

  // 템플릿은 항상 통과해야 한다.
  const quiz = sampleQuiz();
  for (const a of quiz.axes) {
    assert.ok(a.intro && a.intro.length >= 15 && a.intro.length <= 70);
  }
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

// 2차 검수 반영: buildPrompt가 룰 나열이 아니라 5단계 전문가 작업 절차로
// 재편됐는지 — 특히 "소재 해부"(0단계, 소재-행동 짜깁기 방지)와
// "셀프 검수"(4단계, 의미 정합을 코드 게이트 대신 생성 시점에 스스로 잡게
// 하는 핵심 단계)가 실제로 프롬프트에 포함돼야 한다.
test("buildPrompt walks the generator through the 5-stage professional workflow (소재 해부 → 셀프 검수)", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  assert.ok(prompt.includes("소재 해부"), "0단계 소재 해부가 있어야 한다");
  assert.ok(prompt.includes("셀프 검수"), "4단계 셀프 검수가 있어야 한다");
  assert.ok(prompt.includes("행동 목록"), "소재별 행동 목록 개념이 있어야 한다(소재-행동 짜깁기 방지)");
  assert.ok(prompt.includes("[0단계") && prompt.includes("[1단계") && prompt.includes("[2단계") && prompt.includes("[3단계") && prompt.includes("[4단계") && prompt.includes("[5단계"), "6단계(0~5)가 모두 번호로 명시돼야 한다");
  // 상표 규칙 충돌 해소: "일반 명사로 우회"가 4단계 셀프 검수 항목 하나로만 존재
  assert.ok(prompt.includes("일반 명사로"));
  assert.ok(prompt.includes("이미 등장한 상표명은 그대로"));
});

// David 실사용 피드백(2026-07-25): 사전설명(브리핑)·친절 문장·용어 친숙도
// 등급·축 intro 규칙이 실제로 프롬프트에 들어가야 한다.
test("buildPrompt instructs the generator to write weeklyBrief, familiarity tiers, plain sentences, and axis intros", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  assert.ok(prompt.includes("weeklyBrief"), "브리핑 필드 이름이 명시돼야 한다");
  assert.ok(prompt.includes("국민상식") && prompt.includes("대중화제") && prompt.includes("커뮤내수"), "친숙도 3등급이 명시돼야 한다");
  assert.ok(prompt.includes("전보체 금지"), "전보체 금지 규칙이 있어야 한다");
  assert.ok(prompt.includes("제목에는 소재를 1개만"), "제목 소재 1개 규칙이 있어야 한다");
  assert.ok(prompt.includes("처음 듣는 사람도 상황을 이해할 수 있게"), "문항 첫 문장 이해 가능성 규칙이 있어야 한다");
  assert.ok(prompt.includes("축마다 intro"), "축 intro 작성 규칙이 있어야 한다");
  assert.ok(prompt.includes("소리 내어 읽어줬을 때"), "4단계 셀프 검수에 낭독 체크가 있어야 한다");
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

// David 실사용 피드백(2026-07-25) 4건: 브리핑·친숙도·축 설명·공유 블록 —
// 전부 선언식 매니페스트가 원본이어야 한다(하드코딩 금지 원칙).
test("pack manifest declares the David-feedback contract blocks (familiarity tiers, share block, popularity signal)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.ok(Array.isArray(CONTRACT.familiarity_tiers.tiers) && CONTRACT.familiarity_tiers.tiers.length === 3);
  assert.deepEqual(CONTRACT.familiarity_tiers.tiers, ["국민상식", "대중화제", "커뮤내수"]);
  assert.ok(CONTRACT.familiarity_tiers.policy_ko);
  assert.ok(Array.isArray(CONTRACT.share_block_template_ko) && CONTRACT.share_block_template_ko.length > 0);
  assert.ok(CONTRACT.share_block_template_ko.some((line) => line.includes("{url}")));
  assert.ok(CONTRACT.share_block_template_ko.some((line) => line.includes("{sharePercent}")));
  assert.equal(typeof CONTRACT.checks.topics.cross_source_bonus, "number");
  assert.equal(typeof CONTRACT.checks.topics.max_single_source_topics, "number");
  assert.equal(CONTRACT.checks.viral.weekly_brief_topic_coverage_required, true);
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

// ---- 8팀 적대 검수 반영(v2) — QG0 소재 세이프티 + QG1/QG2/QG3 확장 ----------

function sampleTopics() {
  return pickWeeklyTopics(HOT_ITEMS, { now: NOW });
}

test("pickWeeklyTopics excludes celebrity-private-life and disaster-fear titled items (topic_safety)", () => {
  const risky = [
    { title: "김하늘 이민호 열애설 스킨십 포착", url: "https://example.com/r1", source: "theqoo", score: 9999, commentCount: 500, publishedAt: "2026-07-22T09:00:00Z" },
    { title: "동해안 지진 경보, 가지 말라는 이유", url: "https://example.com/r2", source: "clien", score: 9998, commentCount: 500, publishedAt: "2026-07-22T09:00:00Z" }
  ];
  const topics = pickWeeklyTopics([...risky, ...HOT_ITEMS], { count: 10, now: NOW });
  const titles = topics.map((t) => t.title);
  assert.ok(!titles.some((t) => t.includes("열애")), "연예인 사생활 소재 제외");
  assert.ok(!titles.some((t) => t.includes("지진")), "재난공포 소재 제외");
});

test("QG1 structure gate rejects non-uniform answer counts per question", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.questions[0].answers.pop(); // Q1만 3개로 줄인다 — 나머지는 4개
  const report = runGates(quiz);
  const fail = report.failures.find((f) => f.gate === "QG1-structure" && f.message.includes("답변 개수"));
  assert.ok(fail, "답변 개수 불일치가 잡혀야 한다");
  assert.match(fail.message, /Q1=3개/, "문항 번호와 개수가 사유에 명시돼야 한다");
});

test("QG1 structure gate rejects near-duplicate question text (same topic/sentence reused)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.questions[2].q = quiz.questions[0].q; // Q1·Q3을 완전히 같은 문장으로
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("Q1") && f.message.includes("Q3") && f.message.includes("재탕")),
    "같은 문장을 재탕한 문항 쌍이 지목돼야 한다"
  );
});

test("QG1 structure gate rejects an axis whose questions all lead with the same pole (reverse-scoring balance)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const q of quiz.questions) {
    if (q.axis === "reaction") q.answers[0].pole = "left"; // 전 문항 1번 답을 강제로 같은 극에 몰아넣는다
  }
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("reaction") && f.message.includes("역채점")),
    "한 축의 1번 답이 전부 같은 극이면 역채점 균형 위반으로 잡혀야 한다"
  );
});

// 2차 검수(전문가 5그룹+이용자 20명): "8개가 전부 '~게 너다'로 끝나면 템플릿
// 티" — 결과 서술 오프닝 종결 패턴이 한 틀로 쏠리면 반려돼야 한다.
test("QG1 structure gate rejects results whose opening sentences all share the same ending pattern (template opening)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const r of quiz.results) {
    r.description = "이건 확실히 게 너다. 나머지 설명은 여기 붙어서 결과문 최소 글자 수 조건도 넉넉하게 채운다.";
  }
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("오프닝 종결")),
    "결과 전부가 같은 오프닝 종결이면 반려돼야 한다"
  );
});

test("QG2 viral gate rejects a title/description with no topic keyword when topics context is given", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  // 토픽 어절과 겹치지 않는 순수 범용 문장 ("유형" 등은 실제 토픽 제목의
  // 어절이라 일부러 피한다 — 우연히 걸리면 이 테스트 자체가 거짓양성이 된다).
  quiz.title = "아무 날이나 봐도 똑같은 심심풀이 문답";
  quiz.description = "누구한테나 뻔하게 들어맞는 흔해빠진 답만 나온다";
  const report = runGates(quiz, { topics: sampleTopics() });
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("토픽 키워드")),
    "토픽 컨텍스트가 있을 때 범용 제목/소개는 반려돼야 한다"
  );
});

test("QG2 viral gate rejects a result description with no topic mention when topics context is given", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[0].description = "이 결과는 누가 봐도 무난하고 흔해서 딱히 특별할 게 없는 반응이다.";
  const report = runGates(quiz, { topics: sampleTopics() });
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes(quiz.results[0].code) && f.message.includes("토픽 소재 인용")),
    "결과 서술에 토픽 소재 인용이 없으면 유형 code와 함께 반려돼야 한다"
  );
});

// 2차 검수: "결과 8종에 이번 주 토픽이 최대한 고르게 — 서로 다른 토픽 최소
// min(토픽 수, 유형 수)개 등장". 개별 결과는 토픽을 인용하더라도(그래서
// result_topic_mention_required는 통과), 전부 같은 토픽 하나만 우려먹으면
// 커버리지 게이트가 따로 잡아야 한다.
test("QG2 viral gate rejects result copy that covers too few distinct topics (topic coverage)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  const topics = sampleTopics();
  const onlyTopic = topics[0].title;
  for (const r of quiz.results) {
    r.description = `"${onlyTopic}" 얘기만 계속 우려먹는 결과 서술이다. 다른 토픽은 전혀 언급하지 않고 이 얘기만 반복해서 채운다.`;
  }
  const report = runGates(quiz, { topics });
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("빠진 토픽")),
    "결과 서술 전체가 한 토픽만 인용하면 빠진 토픽을 명시해 반려돼야 한다"
  );
});

// David 실사용 피드백(2026-07-26, "주제 자체가 별로"): 기계 선정(hotness
// 랭킹)은 이제 후보 풀만 추리고, 최종 채택은 quiz.weeklyBrief로 정의된다 —
// 풀 밖 소재를 지어내면(어떤 후보와도 토큰이 안 겹치면) 반려돼야 한다.
test("QG2 viral gate rejects a weeklyBrief topic that doesn't match any candidate in the pool (invented topic)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  const topics = sampleTopics(); // 후보 풀
  // 풀 후보 제목 어디와도 토큰이 겹치지 않는 완전히 새 소재로 덮어쓴다.
  quiz.weeklyBrief[0] = { topic: "완전히 없는 소재 이름", intro: quiz.weeklyBrief[0].intro, tier: quiz.weeklyBrief[0].tier };
  const report = runGates(quiz, { topics });
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("후보 풀에 없다")),
    "브리핑 소재가 후보 풀 밖이면 반려돼야 한다"
  );
});

// 채택 개수는 checks.topics.count(풀이 더 작으면 그 개수)와 정확히 같아야
// 한다 — 후보 풀에서 몇 개를 고르든 상관없이 '아무 개수'가 아니라 채택
// 절차를 실제로 거쳤는지 확인하는 장치다.
test("QG2 viral gate rejects a weeklyBrief whose length doesn't equal the adoption count (checks.topics.count)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const quiz = structuredClone(sampleQuiz());
  const topics = sampleTopics();
  quiz.weeklyBrief = quiz.weeklyBrief.slice(0, 1); // 채택 개수는 여러 개인데 브리핑은 1개뿐
  const report = runGates(quiz, { topics });
  const requiredCount = Math.min(CONTRACT.checks.topics.count, topics.length);
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes(`정확히 ${requiredCount}개`)),
    "브리핑 개수가 채택 개수와 다르면 반려돼야 한다"
  );
});

test("template quiz's weeklyBrief already clears the QG2 briefing coverage gate", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const topics = sampleTopics();
  const quiz = templateQuiz(topics, { weekLabel: "2026w30" });
  assert.equal(quiz.weeklyBrief.length, topics.length);
  const report = runGates(quiz, { topics });
  assert.ok(!report.failures.some((f) => f.message.includes("주간 브리핑")), "템플릿 브리핑은 커버리지 게이트를 통과해야 한다");
});

// 2차 검수: "9문항 중 최소 6개는 토픽에서 직접 파생(범용 필러 최소화)".
test("QG2 viral gate rejects a question set where too few questions are topic-derived (question topic-bound ratio)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  const topics = sampleTopics();
  for (let i = 0; i < quiz.questions.length; i++) {
    quiz.questions[i].q = `아무 때나 던져도 되는 순수 범용 문항 번호 ${i}`;
  }
  const report = runGates(quiz, { topics });
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("토픽에서 직접 파생")),
    "토픽 어절을 포함한 문항 비율이 낮으면 반려돼야 한다"
  );
});

test("QG2 viral gate rejects share texts that share the same template (low diversity across types)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[1].shareText = quiz.results[0].shareText; // 두 유형이 똑같은 공유 문구
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("템플릿 복붙")),
    "공유 문구가 같은 틀이면 반려돼야 한다"
  );
});

// 2차 검수: "8개 중 물음표 반문형은 절반 이하 — 감탄·선언·도발형을 섞어라".
test("QG2 viral gate rejects share texts that end with '?' too often (question-ending ratio)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const r of quiz.results) {
    r.shareText = `나는 ${r.title} 그 자체다 — 너는?`;
  }
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("물음표로 끝나는 비율")),
    "공유 문구 전부가 물음표로 끝나면 반려돼야 한다"
  );
});

test("QG3 ai-tell gate rejects formal '~합니다'-style endings from the expanded phrase list", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[0].description = "이 유형은 트렌드에 민감하게 반응합니다. 정보를 빠르게 접하는 편입니다.";
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG3-ai-tell" && (f.message.includes("합니다") || f.message.includes("입니다"))),
    "확장된 관용구 목록의 '~합니다'체가 잡혀야 한다"
  );
});

// David 실사용 피드백(2026-07-25): weeklyBrief/축 intro도 사용자 노출
// 텍스트라 AI-티 게이트 대상이다 — 격식체는 잡히고, 친절한 반말 설명톤은
// 통과해야 한다(둘 다 막으면 브리핑 자체를 쓸 수 없다).
test("QG3 ai-tell gate scans weeklyBrief intros for formal phrasing but passes friendly casual explanations", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const formal = structuredClone(sampleQuiz());
  formal.weeklyBrief[0].intro = "이 소재는 이번 주 커뮤니티에서 화제가 되었습니다. 많은 분들이 반응했습니다.";
  const formalReport = runGates(formal);
  assert.ok(
    formalReport.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("브리핑")),
    "브리핑의 격식체는 QG3에서 잡혀야 한다"
  );

  const casual = structuredClone(sampleQuiz());
  casual.weeklyBrief[0].intro = "이 얘기가 이번 주 커뮤니티에서 완전 크게 돌았어 — 다들 이거 하나로 난리 난 거야.";
  const casualReport = runGates(casual);
  assert.ok(
    !casualReport.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("브리핑")),
    "친절한 반말 설명톤(~돌았어/~된 거야)은 AI-티로 잡히면 안 된다"
  );
});

test("runGates skips context-dependent QG2 checks when called without a topics context", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.title = "아무 날이나 봐도 똑같은 심심풀이 문답";
  quiz.description = "누구한테나 뻔하게 들어맞는 흔해빠진 답만 나온다";
  const withoutContext = runGates(quiz);
  const withContext = runGates(quiz, { topics: sampleTopics() });
  assert.ok(!withoutContext.failures.some((f) => f.message.includes("토픽 키워드")), "컨텍스트 없이는 토픽 키워드 검사가 스킵된다");
  assert.ok(withContext.failures.some((f) => f.message.includes("토픽 키워드")), "컨텍스트가 있으면 같은 퀴즈가 반려된다");
});

test("renderResultPage shows the manifest-declared result labels (팩폭 포인트 / 상극 케미)", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-labeltest", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(html.includes("팩폭 포인트"));
  assert.ok(html.includes("상극 케미"));
  assert.ok(html.includes("이건 인정"));
  assert.ok(html.includes("이럴 땐 이렇게"));
  assert.ok(html.includes("잘 맞는 케미"));
});

// 2차 검수: 케미가 코드 조합만 보여주고 근거가 없다는 지적 반영 — 결과
// 페이지에도 bestMatchReason/worstMatchReason이 유형명 아래 작은 텍스트로
// 노출돼야 한다 (기존 렌더러 스타일 재사용, 신규 카드/서머리 제작 금지).
test("renderResultPage displays bestMatchReason/worstMatchReason under the chemistry section", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-reasontest", quiz }, result, "https://example.com", {});
  assert.ok(result.bestMatchReason && result.worstMatchReason, "샘플 데이터에 궁합 이유가 있어야 테스트가 유효하다");
  assert.ok(html.includes(result.bestMatchReason), "bestMatchReason이 렌더링돼야 한다");
  assert.ok(html.includes(result.worstMatchReason), "worstMatchReason이 렌더링돼야 한다");
  assert.match(html, /class="reason"/, "궁합 이유는 기존 스타일(.reason)로 작게 표시돼야 한다");
});

// ---- David 실사용 피드백(2026-07-25): 사전설명 + 축 intro 렌더 ----------

test("renderQuizPage shows a '이 테스트가 알아보는 것' section listing each axis name + intro above the start button", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderQuizPage({ slug: "2026w30-axisintro", quiz }, "https://example.com");
  assert.ok(html.includes("이 테스트가 알아보는 것"));
  for (const a of quiz.axes) {
    assert.ok(html.includes(escHtml(a.name)), `축 이름 "${a.name}"이 노출돼야 한다`);
    assert.ok(html.includes(escHtml(a.intro)), `축 intro "${a.intro}"가 노출돼야 한다`);
  }
  // 섹션이 시작 버튼보다 앞에 나와야 한다.
  assert.ok(html.indexOf("이 테스트가 알아보는 것") < html.indexOf("테스트 시작하기"));
});

test("renderQuizPage shows a '들어가기 전 30초 브리핑' card listing each weeklyBrief topic + intro above the start button", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderQuizPage({ slug: "2026w30-brief", quiz }, "https://example.com");
  assert.ok(html.includes("들어가기 전 30초 브리핑"));
  for (const b of quiz.weeklyBrief) {
    assert.ok(html.includes(escHtml(b.topic)), `브리핑 토픽 "${b.topic}"이 노출돼야 한다`);
    assert.ok(html.includes(escHtml(b.intro)), `브리핑 intro "${b.intro}"가 노출돼야 한다`);
  }
  assert.ok(html.indexOf("들어가기 전 30초 브리핑") < html.indexOf("테스트 시작하기"));
});

test("renderQuizPage omits the briefing card and axis-intro section for legacy quizzes without them (backward compat)", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const legacy = structuredClone(sampleQuiz());
  delete legacy.weeklyBrief;
  for (const a of legacy.axes) delete a.intro;
  const html = renderQuizPage({ slug: "2026w30-legacy", quiz: legacy }, "https://example.com");
  assert.ok(!html.includes("들어가기 전 30초 브리핑"));
  assert.ok(!html.includes("이 테스트가 알아보는 것"));
  // 나머지 랜딩은 그대로 렌더돼야 한다 (에러 없이 하위호환).
  assert.ok(html.includes("테스트 시작하기"));
});

// David 실사용 피드백(2026-07-25): "약 2~2분"처럼 최소~최대가 같아지는
// 분 계산 버그 — 문항수 기반 단일 값(올림)으로 고쳤는지 확인.
test("renderQuizPage shows a single ceil-based minute estimate, never a duplicated range like '약 N~N분'", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  for (const qCount of [8, 9, 10, 11, 12, 13, 14, 15]) {
    const quiz = structuredClone(sampleQuiz());
    // qCount만큼 문항을 복제해 원하는 문항 수를 만든다(축 태그는 유지).
    quiz.questions = Array.from({ length: qCount }, (_, i) => structuredClone(quiz.questions[i % quiz.questions.length]));
    const html = renderQuizPage({ slug: `2026w30-min${qCount}`, quiz }, "https://example.com");
    assert.ok(!/약\s*\d+\s*~\s*\d+\s*분/.test(html), `${qCount}문항에서 분 범위 표기가 남아있으면 안 된다`);
    const match = html.match(/약\s*(\d+)\s*분/);
    assert.ok(match, `${qCount}문항에서 단일 분 표기가 있어야 한다`);
    assert.equal(Number(match[1]), Math.max(1, Math.ceil(qCount / 5)));
  }
});

// ---- David 실사용 피드백(2026-07-25): 복붙 공유 블록 --------------------

test("buildShareBlock fills every placeholder and omits the sharePercent clause entirely when no stat is given", async () => {
  const { buildShareBlock } = await import("../src/quiz/render.js");
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const template = CONTRACT.share_block_template_ko;

  const withPercent = buildShareBlock(template, {
    title: "테스트 제목",
    typeTitle: "유형 이름",
    sharePercent: 12,
    shareText: "나는 이거다",
    url: "https://example.com/q/w-slug/r/CODE"
  });
  assert.ok(withPercent.includes("테스트 제목"));
  assert.ok(withPercent.includes("유형 이름"));
  assert.ok(withPercent.includes("12%"));
  assert.ok(withPercent.includes("나는 이거다"));
  assert.ok(withPercent.includes("https://example.com/q/w-slug/r/CODE"));
  assert.ok(!withPercent.includes("{"), "치환되지 않은 플레이스홀더가 남으면 안 된다");

  const withoutPercent = buildShareBlock(template, {
    title: "테스트 제목",
    typeTitle: "유형 이름",
    sharePercent: null,
    shareText: "나는 이거다",
    url: "https://example.com/q/w-slug/r/CODE"
  });
  assert.ok(!withoutPercent.includes("%"), "퍼센트 통계가 없으면 그 절 전체가 빠져야 한다");
  assert.ok(!withoutPercent.includes("()"), "빈 괄호를 남기면 안 된다");
  assert.ok(withoutPercent.includes("유형 이름"), "퍼센트가 빠져도 나머지 줄(유형 이름)은 그대로 남아야 한다");
  assert.ok(!withoutPercent.includes("{"), "치환되지 않은 플레이스홀더가 남으면 안 된다");
});

test("renderResultPage injects the manifest share-block template into the copy button's payload", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-shareblock", quiz }, result, "https://example.com", {});
  assert.ok(html.includes("결과 복사"), "버튼 라벨이 '결과 복사'로 바뀌어야 한다");
  assert.ok(html.includes("👉 나도 해보기"), "매니페스트 공유 블록 템플릿 문구가 주입돼야 한다");
  assert.ok(html.includes(result.title), "내 유형 제목이 블록에 들어가야 한다");
  assert.ok(html.includes(quiz.title.replace(/"/g, "&quot;")) || html.includes(quiz.title), "테스트 제목이 페이지 어딘가에 있어야 한다(주입 확인)");
  assert.ok(html.includes("붙여넣으면 카드처럼 보여요"), "복사 후 안내 문구가 있어야 한다");
  assert.ok(Array.isArray(CONTRACT.share_block_template_ko) && CONTRACT.share_block_template_ko.length > 0);
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

// ---- Claude Code scheduled-session submit contract (weekly.js CLI) -------
// The generation authority moved from launchd+API-key to a Claude Code
// scheduled session that generates the quiz JSON itself and hands it to the
// pipeline through `prompt`/`submit`. These are child-process tests (not
// direct function calls) because the exit code and stdout/stderr shape ARE
// the contract a scheduled session drives against.

test("weekly.js submit: PASS saves a claude-code draft and routes publish to decision_queue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-submit-pass-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));
  const quiz = sampleQuiz();
  const quizPath = path.join(dir, "quiz.json");
  fs.writeFileSync(quizPath, JSON.stringify(quiz));

  const result = runWeeklyCli(["submit", quizPath, itemsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /decision_queue/);
  assert.match(result.stdout, /초안 생성 \(claude-code\)/);

  const store = new QuizStore({ dir });
  const drafts = store.listDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].via, "claude-code");
  assert.equal(drafts[0].quiz.title, quiz.title);
  assert.ok(Array.isArray(drafts[0].topics) && drafts[0].topics.length > 0);
  assert.equal(drafts[0].gate.decision, "PASS");
  assert.equal(drafts[0].gate.attempts, 1);
  assert.equal(drafts[0].gate.history.length, 1);
  assert.equal(drafts[0].gate.history[0].via, "claude-code");
  assert.equal(store.listPublished().length, 0, "submit never auto-publishes");
});

test("weekly.js submit: honors --attempt for the recorded gate history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-submit-attempt-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));
  const quiz = sampleQuiz();
  const quizPath = path.join(dir, "quiz.json");
  fs.writeFileSync(quizPath, JSON.stringify(quiz));

  const result = runWeeklyCli(["submit", quizPath, itemsPath, "--attempt", "2"], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);

  const store = new QuizStore({ dir });
  const [draft] = store.listDrafts();
  assert.equal(draft.gate.attempts, 2);
  assert.equal(draft.gate.history[0].attempt, 2);
});

test("weekly.js submit: gate rejection exits 2, reports [게이트ID] reasons, and never drafts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-submit-reject-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));
  const bad = structuredClone(sampleQuiz());
  bad.results[0].weaknesses = []; // QG1-structure 위반 (칭찬만 있는 결과)
  const quizPath = path.join(dir, "quiz.json");
  fs.writeFileSync(quizPath, JSON.stringify(bad));

  const result = runWeeklyCli(["submit", quizPath, itemsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QG1-structure\]/);

  const reasonsPath = path.join(dir, "last_reject_reasons.json");
  const reasons = JSON.parse(fs.readFileSync(reasonsPath, "utf8"));
  assert.ok(Array.isArray(reasons) && reasons.length > 0);
  assert.ok(reasons.every((r) => typeof r === "string"));
  assert.ok(reasons.some((r) => r.startsWith("[QG1-structure]")));

  const store = new QuizStore({ dir });
  assert.equal(store.listDrafts().length, 0, "rejected quiz never becomes a draft");
});

test("weekly.js submit: --reasons-out overrides the default reasons file path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-submit-reasonsout-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));
  const bad = structuredClone(sampleQuiz());
  bad.results[0].weaknesses = [];
  const quizPath = path.join(dir, "quiz.json");
  fs.writeFileSync(quizPath, JSON.stringify(bad));
  const customReasonsPath = path.join(dir, "custom-reasons.json");

  const result = runWeeklyCli(["submit", quizPath, itemsPath, "--reasons-out", customReasonsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 2);
  assert.ok(fs.existsSync(customReasonsPath));
  assert.ok(!fs.existsSync(path.join(dir, "last_reject_reasons.json")));
});

test("weekly.js prompt: stdout carries the single-source generation prompt (topics + design rules)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-prompt-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));

  const result = runWeeklyCli(["prompt", itemsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("심리 축"));
  assert.ok(result.stdout.includes("상황 제시형"));
  const topics = pickWeeklyTopics(HOT_ITEMS, {});
  for (const t of topics) assert.ok(result.stdout.includes(t.title));
  assert.ok(!result.stdout.includes("반려됐다"), "no feedback section without --feedback");
  // topic summary/hints are stderr-only, not mixed into the reusable prompt
  assert.ok(result.stderr.includes("토픽"));
});

test("weekly.js prompt: --feedback injects the rejection section for re-generation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-prompt-feedback-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));
  const reasons = ["[QG1-structure] 테스트용 반려 사유"];
  const reasonsPath = path.join(dir, "reasons.json");
  fs.writeFileSync(reasonsPath, JSON.stringify(reasons));

  const result = runWeeklyCli(["prompt", itemsPath, "--feedback", reasonsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("반려됐다"));
  assert.ok(result.stdout.includes("[QG1-structure] 테스트용 반려 사유"));
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
    // 템플릿 제목이 토픽을 큰따옴표로 인용해서(QG2 토픽 인용 규칙) HTML에서는
    // esc()가 " → &quot;로 이스케이프한다 — escaped 형태로 비교.
    assert.ok(page.includes(quiz.title.replace(/"/g, "&quot;")));
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
    assert.ok(personal.includes("팩폭 포인트"), "매니페스트 result_labels_ko.weaknesses");
    assert.ok(personal.includes("상극 케미"), "매니페스트 result_labels_ko.worst_match (환장의 케미 밈 오용 교체)");
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

test("pickWeeklyTopics filters non-Korean titles (hangul_chars_min)", () => {
  const items = [
    { title: "Startup founders urge U.S. government not to shut off AI", source: "hackernews", score: 900 },
    { title: "요즘 편의점 신상 조합 근황", source: "clien", score: 10 }
  ];
  const topics = pickWeeklyTopics(items, { count: 2, now: NOW });
  assert.equal(topics.length, 1, "영문 제목 소재는 제외");
  assert.ok(topics[0].title.includes("편의점"));
});

test("pickWeeklyTopics excludes crime/scandal titles (topic_safety.crime_scandal)", () => {
  const items = [
    { title: "사직한 여중생 성매매 시의원 급여 챙겨감", source: "ppomppu", score: 900 },
    { title: "요즘 편의점 신상 조합 근황", source: "clien", score: 10 }
  ];
  const topics = pickWeeklyTopics(items, { count: 2, now: NOW });
  assert.equal(topics.length, 1, "범죄·스캔들 소재 제외");
  assert.ok(topics[0].title.includes("편의점"));
});

test("pickWeeklyTopics excludes politics titles the feed classifier misses (politics_extra)", () => {
  const items = [
    { title: "유시민 당대표는 대통령 부하 아냐 발언", source: "bobae", score: 900 },
    { title: "요즘 편의점 신상 조합 근황", source: "clien", score: 10 }
  ];
  const topics = pickWeeklyTopics(items, { count: 2, now: NOW });
  assert.equal(topics.length, 1, "정치 소재 제외 (퀴즈팩 보강 키워드)");
  assert.ok(topics[0].title.includes("편의점"));
});

// ===========================================================================
// David 실사용 피드백(2026-07-26, "주제 자체가 별로") — 기계 선정을 후보
// 풀로 낮추고 최종 선정은 생성자가 하도록 개편(매니페스트 version 4→5).
// ===========================================================================

// 15개 브랜드세이프 후보 — 상위 5개(primary)는 서로 뚜렷이 다른 문장이라야
// templateQuiz가 채택했을 때 QG1 문항 유사도 게이트를 통과한다(같은 문구에
// 숫자만 바뀌면 bigram 유사도가 87%까지 치솟아 반려된다 — 실제로 처음
// 시도에서 걸린 버그). 각 primary는 낮은 점수의 echo와 핵심 토큰 2개+를
// 공유해 cross-source 신호를 얻어 max_single_source_topics 캡을 피하고,
// 나머지 5개는 캡을 채우는 필러다. 합쳐서 정확히 15개 = candidate_pool_size.
function manyBrandSafeItems() {
  const primaries = [
    "동네빵집 크루아상 시식 후기",
    "헬스장 러닝머신 예약 전쟁 후기",
    "편의점 신상 디저트 조합 발견",
    "카페 신메뉴 시럽 라떼 리뷰",
    "분식집 떡볶이 신메뉴 출시"
  ];
  const echoes = [
    "동네빵집 크루아상 신상 소식",
    "헬스장 러닝머신 이용 후기 공유",
    "편의점 신상 디저트 인기 폭발",
    "카페 신메뉴 라떼 맛집 추천",
    "분식집 떡볶이 맛집 순위 공개"
  ];
  const fillers = [
    "동네 도서관 열람실 자리 경쟁",
    "지하철 막차 시간표 변경 공지",
    "아파트 단지 택배함 교체 안내",
    "주말 등산로 단풍 절정 소식",
    "동네 세탁소 가격 인상 후기"
  ];
  const iso = new Date(NOW).toISOString();
  const items = [];
  primaries.forEach((title, i) => items.push({ title, url: `https://example.com/p${i}`, source: `primary${i}`, score: 1000 - i, commentCount: 10, publishedAt: iso }));
  echoes.forEach((title, i) => items.push({ title, url: `https://example.com/e${i}`, source: `echo${i}`, score: 500 - i, commentCount: 10, publishedAt: iso }));
  fillers.forEach((title, i) => items.push({ title, url: `https://example.com/f${i}`, source: `filler${i}`, score: 50 - i, commentCount: 10, publishedAt: iso }));
  return items;
}

test("runWeekly's candidate pool scales up to candidate_pool_size while the template still adopts exactly checks.topics.count", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const { runGates } = await import("../src/quiz/gates.js");
  const store = tmpStore();
  const items = manyBrandSafeItems();
  const { draft, topics } = await runWeekly(items, { store, now: NOW, apiKey: null });
  assert.equal(topics.length, CONTRACT.checks.topics.candidate_pool_size, "후보 풀은 candidate_pool_size(15)까지 커진다");
  assert.equal(draft.quiz.weeklyBrief.length, CONTRACT.checks.topics.count, "최종 채택은 checks.topics.count(5)로 유지된다");
  const report = runGates(draft.quiz, { topics });
  assert.equal(report.pass, true, "채택 소재가 실제 풀 후보와 매칭돼 QG2를 통과해야 한다");
});

test("buildPrompt tells the generator to adopt exactly checks.topics.count from the candidate pool using quiz_fit_criteria (Part A)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  assert.ok(prompt.includes("후보"), "후보 풀 표현이 있어야 한다");
  assert.ok(prompt.includes(`정확히 ${CONTRACT.checks.topics.count}개를 채택`));
  assert.ok(prompt.includes("화제성 순위가 높아도"), "화제성이 높아도 퀴즈감 없으면 버리라는 지침이 있어야 한다");
  for (const c of CONTRACT.checks.topics.quiz_fit_criteria_ko) {
    assert.ok(prompt.includes(c), `퀴즈감 채택 기준이 프롬프트에 포함돼야 한다: ${c}`);
  }
});

// 리서치 제안 R1 — 4축 16유형: 매니페스트 generation.axes_count를 buildPrompt가 참조.
test("buildPrompt references generation.axes_count for the axis/type-count formula (R1)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  const n = CONTRACT.generation.axes_count;
  assert.equal(n, 4);
  assert.ok(prompt.includes(`심리 축 정확히 ${n}개`));
  assert.ok(prompt.includes(`유형 2^${n}개`));
  assert.ok(prompt.includes(`${n * 3}~${n * 4}개`));
});

test("validateQuiz still accepts 2~4 axes and templateQuiz keeps 2 axes as the fallback/test path (axes_count is a prompt directive, not a validateQuiz floor)", () => {
  const quiz = sampleQuiz();
  assert.equal(quiz.axes.length, 2, "템플릿 경로는 2축을 유지한다");
  assert.ok(validateQuiz(quiz));
});

// 리서치 제안 R5 — 문항 상황은 타깃의 공유된 일상 경험이어야 한다.
test("buildPrompt requires question vignettes to be a shared everyday experience for the community/SNS 2030 target (R5)", () => {
  const topics = pickWeeklyTopics(HOT_ITEMS, { now: NOW });
  const prompt = buildPrompt(topics, { weekLabel: "2026w30" });
  assert.ok(prompt.includes("공유된 일상 경험"));
  assert.ok(prompt.includes("아 이거 나잖아"));
});

test("pack manifest declares checks.topics.candidate_pool_size and quiz_fit_criteria_ko (Part A)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.checks.topics.candidate_pool_size, 15);
  assert.ok(Array.isArray(CONTRACT.checks.topics.quiz_fit_criteria_ko) && CONTRACT.checks.topics.quiz_fit_criteria_ko.length === 4);
  assert.ok(CONTRACT.checks.quiz_fit_criteria_note_ko, "채택 기준의 근거 note가 선언돼야 한다");
});

test("pack manifest declares generation.axes_count = 4 with a note (R1)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.generation.axes_count, 4);
  assert.ok(CONTRACT.generation.axes_count_note_ko);
});

// E2E — 완료 기준: examples/hot_items.json run(템플릿 경로, 풀→앞 5개 채택) PASS.
test("weekly.js run on examples/hot_items.json passes the loop gate end-to-end via the template path (E2E)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-run-e2e-"));
  const result = runWeeklyCli(["run", path.join(REPO_ROOT, "examples", "hot_items.json")], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /초안 생성 \(template\)/);
  assert.match(result.stdout, /decision_queue/);
  const store = new QuizStore({ dir });
  const drafts = store.listDrafts();
  assert.equal(drafts.length, 1);
  const draft = drafts[0];
  assert.equal(draft.gate.decision, "PASS");
  assert.equal(draft.quiz.weeklyBrief.length, 5, "후보 풀에서 정확히 5개(checks.topics.count)를 채택");
  assert.ok(Array.isArray(draft.topics) && draft.topics.length >= draft.quiz.weeklyBrief.length, "후보 풀은 채택 개수 이상");
});

// ---- 리서치 제안 R2: weeklyPick(유형별 실용 추천물) ------------------------

test("QUIZ_SCHEMA and validateQuiz require a non-empty weeklyPick (<=60자) on every result (R2)", () => {
  assert.ok(QUIZ_SCHEMA.properties.results.items.required.includes("weeklyPick"));

  const missing = structuredClone(sampleQuiz());
  delete missing.results[0].weeklyPick;
  assert.throws(() => validateQuiz(missing), /weeklyPick이 비었어요/);

  const empty = structuredClone(sampleQuiz());
  empty.results[0].weeklyPick = "";
  assert.throws(() => validateQuiz(empty), /weeklyPick이 비었어요/);

  const tooLong = structuredClone(sampleQuiz());
  tooLong.results[0].weeklyPick = "가".repeat(61);
  assert.throws(() => validateQuiz(tooLong), /weeklyPick이 60자를 넘어요/);

  const quiz = sampleQuiz();
  for (const r of quiz.results) assert.ok(r.weeklyPick && r.weeklyPick.length <= 60);
});

test("renderResultPage shows '이번 주 네 픽' with the result's weeklyPick (R2)", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-pick", quiz }, result, "https://example.com", {});
  assert.ok(html.includes("이번 주 네 픽"));
  assert.ok(html.includes(escHtml(result.weeklyPick)));
});

// ---- 리서치 제안 R3: OG 카드 강점 + 케미 보강 ------------------------------

test("renderOgCardSvg type card includes a top strength and the best-match chemistry line (R3)", () => {
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const svg = renderOgCardSvg(quiz, result, {});
  const bestMatchResult = quiz.results.find((r) => r.code === result.bestMatch);
  assert.ok(svg.includes("잘 맞는 케미"));
  assert.ok(svg.includes(bestMatchResult.title.slice(0, 8)), "베스트 매치 유형 제목 일부가 카드에 있어야 한다");
  assert.ok(svg.includes(result.strengths[0].slice(0, 8)), "1강점 일부가 카드에 있어야 한다");
});

// ---- 리서치 제안 R4: 카카오톡 공유 --------------------------------------

test("renderResultPage offers a '카카오톡으로 공유' button that falls back to navigator.share or clipboard copy (R4)", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-kakao", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(html.includes("카카오톡으로 공유"));
  assert.ok(html.includes("function kakaoShare()"));
  assert.ok(html.includes("navigator.share"));
  assert.ok(html.includes("복사됐어요 — 카톡에 붙여넣으면 끝"));
});

test("pack manifest declares share_channels with kakao_sdk_enabled=false (R4)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.share_channels.kakao_sdk_enabled, false);
  assert.ok(CONTRACT.share_channels.note_ko);
});

// ---- 리서치 제안 R6: CTA 계측 --------------------------------------------

test("QuizStore.recordCta increments the cta count and statsFor reports it (R6)", () => {
  const store = tmpStore();
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-cta", quiz);
  store.approve("2026w30-cta");

  let stats = store.statsFor("2026w30-cta", quiz.results.map((r) => r.code));
  assert.equal(stats.cta, 0);

  store.recordCta("2026w30-cta");
  store.recordCta("2026w30-cta");
  stats = store.statsFor("2026w30-cta", quiz.results.map((r) => r.code));
  assert.equal(stats.cta, 2);

  assert.throws(() => store.recordCta("no-such"), /발행된/);
});

test("POST /api/quiz/:slug/cta increments the CTA counter for published quizzes only (R6)", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-cta-"));
  const store = new QuizStore({ dir });
  const quiz = sampleQuiz();
  store.saveDraft("2026w30-ctaroute", quiz, { week: "2026w30" });
  store.saveDraft("2026w30-ctahidden", quiz, { week: "2026w30" });
  store.approve("2026w30-ctaroute");

  const server = createServer({ sources: [], quizDir: dir });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/quiz/2026w30-ctaroute/cta`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cta, 1);

    assert.equal((await fetch(`${base}/api/quiz/2026w30-ctahidden/cta`, { method: "POST" })).status, 404, "초안은 404");
    assert.equal((await fetch(`${base}/api/quiz/no-such/cta`, { method: "POST" })).status, 404, "없는 슬러그도 404");
  } finally {
    server.close();
  }
});

test("pack manifest declares metrics.cta_click_benchmark_ratio (R6)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.metrics.cta_click_benchmark_ratio, 0.33);
  assert.ok(CONTRACT.metrics.note_ko);
});

test("renderResultPage's CTA link fires a fire-and-forget beacon/fetch on click (R6)", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-ctaclick", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(html.includes('onclick="ctaClick()"'));
  assert.ok(html.includes("function ctaClick()"));
  assert.ok(html.includes("sendBeacon"));
  assert.ok(html.includes("/api/quiz/'+SLUG_+'/cta"));
});

// ---- 리서치 제안 R7: 공유 인센티브 슬롯 (선언만) --------------------------

test("pack manifest declares share_incentive disabled by default, and render shows nothing while disabled (R7)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.share_incentive.enabled, false);
  assert.ok(CONTRACT.share_incentive.note_ko);

  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-incentive", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(!html.includes("기부에 동참"), "공유 인센티브는 enabled=false면 렌더되지 않아야 한다");
});
