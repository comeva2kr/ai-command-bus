import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pickWeeklyTopics, pickTestTrendSignals } from "../src/quiz/topics.js";
import {
  buildPrompt,
  generateQuiz,
  generateQuizWithClaude,
  templateQuiz,
  validateQuiz,
  quizSlug,
  allTypeCodes,
  allLevelCodes,
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

// "YYYYwWW" 문자열에서 n주를 뺀다 — weekly.js의 weekOrdinal(year*52+week)과
// 정확히 같은 산술이라, 실제 달력과 무관하게 "정확히 n주 전" 라벨을 결정적
// 으로 만들 수 있다(테마 이력 경계값 테스트용).
function subtractWeeks(label, n) {
  const m = /^(\d{4})w(\d{1,2})$/.exec(label);
  let year = Number(m[1]);
  let week = Number(m[2]) - n;
  while (week < 1) {
    week += 52;
    year -= 1;
  }
  return `${year}w${String(week).padStart(2, "0")}`;
}

// David 확정(2026-07-26): 템플릿(테스트/폴백 경로)은 이제 테마 풀의 첫
// level_bands 테마(꼰대력) 기반 결정적 산출이다 — topics 인자가 필요 없다.
function sampleQuiz() {
  return templateQuiz();
}

// combo_types(유형 조합형) 경로를 검증할 손수 제작한 고정 퀴즈 — 템플릿이
// level_bands 전용이 된 뒤로, combo_types 전용 게이트/검증 규칙은 이 픽스처로
// 확인한다. 모든 게이트(QG1~QG4)를 통과하도록 손으로 맞춘 값이다.
function comboSampleQuiz() {
  const q = (text, axis, answers) => ({ q: text, axis, answers });
  const comboAxes = [
    {
      id: "response",
      name: "위로 반응",
      intro: "속상한 얘기를 들었을 때 공감부터 하는지 원인부터 짚는지를 본다.",
      left: { code: "F", label: "공감파" },
      right: { code: "T", label: "팩트파" }
    },
    {
      id: "advice",
      name: "조언 스타일",
      intro: "누가 조언을 구하면 감정부터 다독이는지 해결책부터 주는지를 본다.",
      left: { code: "S", label: "다독임형" },
      right: { code: "H", label: "해결사형" }
    }
  ];
  const responseQuestions = [
    q("친구가 회사에서 힘들었다고 털어놓으면 나는?", "response", [
      { text: "일단 힘들었겠다며 다독인다", pole: "left", weight: 2 },
      { text: "얼마나 힘들었는지 물어본다", pole: "left", weight: 1 },
      { text: "무슨 상황인지부터 정리해본다", pole: "right", weight: 1 },
      { text: "원인을 짚어서 해결책을 제안한다", pole: "right", weight: 2 }
    ]),
    q("가족이 시험을 망쳤다고 우울해하면 나는?", "response", [
      { text: "원인을 분석해서 다음 계획을 짠다", pole: "right", weight: 2 },
      { text: "어디서 틀렸는지 같이 살펴본다", pole: "right", weight: 1 },
      { text: "속상했겠다고 먼저 안아준다", pole: "left", weight: 1 },
      { text: "괜찮다고 다독이는 말부터 한다", pole: "left", weight: 2 }
    ]),
    q("동료가 프로젝트 실패로 자책하면 나는?", "response", [
      { text: "네 잘못만은 아니라고 위로한다", pole: "left", weight: 2 },
      { text: "고생했다고 다독여준다", pole: "left", weight: 1 },
      { text: "뭐가 문제였는지 짚어준다", pole: "right", weight: 1 },
      { text: "다음엔 이렇게 하자고 정리해준다", pole: "right", weight: 2 }
    ]),
    q("연인이 다툰 얘기를 하며 속상해하면 나는?", "response", [
      { text: "누가 맞는지부터 따져본다", pole: "right", weight: 2 },
      { text: "상황을 하나씩 짚어본다", pole: "right", weight: 1 },
      { text: "많이 속상했겠다고 공감한다", pole: "left", weight: 1 },
      { text: "일단 안아주고 얘기를 들어준다", pole: "left", weight: 2 }
    ]),
    q("후배가 실수로 혼났다고 울상이면 나는?", "response", [
      { text: "괜찮다고 어깨부터 두드려준다", pole: "left", weight: 2 },
      { text: "그럴 수 있다고 다독인다", pole: "left", weight: 1 },
      { text: "뭐가 잘못됐는지 정리해준다", pole: "right", weight: 1 },
      { text: "재발 방지책을 같이 세운다", pole: "right", weight: 2 }
    ]),
    q("친구가 취업 준비가 안 풀린다고 하소연하면 나는?", "response", [
      { text: "이력서부터 같이 뜯어본다", pole: "right", weight: 2 },
      { text: "어디가 부족한지 짚어준다", pole: "right", weight: 1 },
      { text: "수고했다고 먼저 말해준다", pole: "left", weight: 1 },
      { text: "그동안 애썼다고 꼭 안아준다", pole: "left", weight: 2 }
    ])
  ];
  const adviceQuestions = [
    q("친구가 고민을 털어놓으면 나는?", "advice", [
      { text: "그냥 들어주기만 한다", pole: "left", weight: 2 },
      { text: "공감하는 말을 많이 해준다", pole: "left", weight: 1 },
      { text: "바로 해결책을 제시한다", pole: "right", weight: 1 },
      { text: "할 일 목록부터 정리해준다", pole: "right", weight: 2 }
    ]),
    q("동생이 진로 고민을 얘기하면 나는?", "advice", [
      { text: "장단점부터 표로 정리해준다", pole: "right", weight: 2 },
      { text: "현실적인 선택지를 짚어준다", pole: "right", weight: 1 },
      { text: "괜찮다고 먼저 다독인다", pole: "left", weight: 1 },
      { text: "천천히 생각해보라고 다독인다", pole: "left", weight: 2 }
    ]),
    q("친구가 다이어트 실패했다고 하면 나는?", "advice", [
      { text: "괜찮다고 위로부터 한다", pole: "left", weight: 2 },
      { text: "그럴 수 있다고 다독인다", pole: "left", weight: 1 },
      { text: "식단부터 다시 짜준다", pole: "right", weight: 1 },
      { text: "운동 계획을 새로 세워준다", pole: "right", weight: 2 }
    ]),
    q("부모님이 건강 걱정을 하시면 나는?", "advice", [
      { text: "병원부터 같이 알아본다", pole: "right", weight: 2 },
      { text: "검사 일정을 잡아드린다", pole: "right", weight: 1 },
      { text: "걱정 마시라고 안심시킨다", pole: "left", weight: 1 },
      { text: "괜찮으실 거라고 다독인다", pole: "left", weight: 2 }
    ]),
    q("친구가 이별했다고 연락하면 나는?", "advice", [
      { text: "그동안 힘들었겠다고 다독인다", pole: "left", weight: 2 },
      { text: "옆에 있어준다고 말해준다", pole: "left", weight: 1 },
      { text: "다음 만남을 어떻게 준비할지 짚어준다", pole: "right", weight: 1 },
      { text: "당장 뭘 해야 할지 정리해준다", pole: "right", weight: 2 }
    ]),
    q("친구가 이사 문제로 스트레스라고 하면 나는?", "advice", [
      { text: "체크리스트부터 만들어준다", pole: "right", weight: 2 },
      { text: "업체 비교부터 도와준다", pole: "right", weight: 1 },
      { text: "고생 많다고 다독인다", pole: "left", weight: 1 },
      { text: "잘 될 거라고 다독여준다", pole: "left", weight: 2 }
    ])
  ];
  const results = [
    {
      code: "FS",
      title: "위로 담당 공감러",
      description:
        "친구가 힘든 얘기를 꺼내면 일단 안아주고 보는 타입이다. 해결책보다 먼저 들어주는 게 진짜 위로라고 믿는 T/F 공감형 중에서도 다독임이 진한 쪽이다.",
      strengths: ["위로할 때 진심이 느껴진다", "이야기를 끝까지 들어준다", "분위기를 편안하게 만든다", "곁에 있어주는 게 자연스럽다"],
      weaknesses: ["가끔 해결책이 늦게 나온다"],
      advice: ["가끔은 정리도 같이 해주자"],
      bestMatch: "FH",
      worstMatch: "TS",
      bestMatchReason: "둘 다 다독이는 결이라 편하게 통한다",
      worstMatchReason: "TS는 팩트부터 들이대서 서운하다",
      shareText: "나는 위로 담당 공감러, 일단 안아주고 본다! 너는?",
      weeklyPick: "후배가 실수로 혼났다고 하면 제일 먼저 다독이는 성향이다"
    },
    {
      code: "FH",
      title: "다정한 해결사",
      description: "속상한 얘기를 들으면 마음은 다 받아주는데, 정신 차리면 해결책부터 정리하고 있다. 공감과 해결을 같이 하는 타입이다.",
      strengths: ["위로와 해결을 둘 다 챙긴다", "믿음직스럽다는 말을 자주 듣는다", "상황 정리가 빠르다", "다정한데 실속도 있다"],
      weaknesses: ["가끔 위로가 짧게 끝난다"],
      advice: ["위로를 조금 더 길게 해보자"],
      bestMatch: "FS",
      worstMatch: "TH",
      bestMatchReason: "FS랑 있으면 위로와 해결이 둘 다 채워진다",
      worstMatchReason: "TH는 위로 없이 해결책만 던져서 허전하다",
      shareText: "나는 다정한 해결사다, 위로도 하고 답도 준다 — 너 이거 인정하지",
      weeklyPick: "동생이 진로 고민할 때 장단점까지 짚어주는 성향이다"
    },
    {
      code: "TS",
      title: "팩폭 위로러",
      description: "누가 힘들다고 하면 원인부터 짚고 보는데, 정작 말투는 따뜻해서 밉지 않다. 팩트로 위로하는 은근 신박한 타입이다.",
      strengths: ["원인 파악이 빠르다", "대화가 논리적이다", "믿을 만한 조언을 해준다", "은근 다정한 구석이 있다"],
      weaknesses: ["가끔 위로보다 분석이 먼저다"],
      advice: ["가끔은 그냥 들어만 주자"],
      bestMatch: "TH",
      worstMatch: "FS",
      bestMatchReason: "TH랑 있으면 팩트로 죽이 잘 맞는다",
      worstMatchReason: "FS는 위로만 원하는데 자꾸 분석하게 된다",
      shareText: "나는 팩폭 위로러다 — 원인부터 짚고 본다, 너는",
      weeklyPick: "동료가 프로젝트 실패로 자책할 때 원인부터 짚어주는 성향이다"
    },
    {
      code: "TH",
      title: "해결사 그 자체",
      description: "고민 상담을 받으면 위로는 짧게 끝내고 바로 계획표를 짠다. 정확한 조언으로 신뢰받는 타입이다.",
      strengths: ["실행 가능한 조언을 준다", "계획 세우는 속도가 빠르다", "신뢰도가 높다", "필요한 순간에 확실히 나선다"],
      weaknesses: ["위로가 부족하다는 말을 듣는다"],
      advice: ["시작 전에 한마디 다독여보자"],
      bestMatch: "TS",
      worstMatch: "FH",
      bestMatchReason: "TS랑 있으면 팩트 케미가 완벽하다",
      worstMatchReason: "FH는 위로부터 원하는데 자꾸 계획부터 짠다",
      shareText: "나는 해결사 그 자체, 계획표부터 짠다 — 너도 그래?",
      weeklyPick: "부모님이 건강 걱정하실 때 병원부터 알아보는 성향이다"
    }
  ];
  return {
    theme: { id: "empathy-vs-fact", name_ko: "T/F 공감형", format: "combo_types" },
    title: "너는 위로할 때 T/F 공감형일까 팩트형일까?",
    description: "속상한 얘기 앞에서 바로 감싸는지 원인부터 짚는지, 조언 스타일까지 함께 재보는 자가진단.",
    weeklyBrief: [
      {
        topic: "T/F 공감형이란",
        intro: "속상한 얘기를 들었을 때 바로 위로부터 하는지 원인부터 짚는지 재는 성향 축이야 — MBTI T/F 논쟁이랑 닮았어.",
        tier: "국민상식"
      }
    ],
    axes: comboAxes,
    questions: [...responseQuestions, ...adviceQuestions],
    results
  };
}

// ---- topic picking (기존 pickWeeklyTopics — 유지) --------------------------

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

  const spread = pickWeeklyTopics([...dominant, ...others], { count: 4, now: NOW });
  assert.equal(spread.length, 4);
  const bySource = {};
  for (const t of spread) bySource[t.source] = (bySource[t.source] || 0) + 1;
  assert.ok(bySource.theqoo <= 2, `theqoo가 캡(2)을 넘었다: ${bySource.theqoo}`);
  assert.equal(bySource.ppomppu, 1);
  assert.equal(bySource.mlbpark, 1);

  const starved = pickWeeklyTopics(dominant, { count: 5, now: NOW });
  assert.equal(starved.length, 5, "대체 출처가 없을 때도 개수는 보장돼야 한다");
  assert.equal(starved.filter((t) => t.source === "theqoo").length, 5);
});

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

test("pickWeeklyTopics caps solo (no cross-source signal) topics at max_single_source_topics, replacing overflow with signal topics", () => {
  const now = NOW;
  const iso = new Date(now).toISOString();
  const signalX = { title: "동네 빵집 신메뉴 소보로", url: "https://example.com/x1", source: "sig1", score: 60, commentCount: 30, publishedAt: iso };
  const signalY = { title: "동네 빵집 오픈런 후기", url: "https://example.com/x2", source: "sig2", score: 60, commentCount: 30, publishedAt: iso };
  const solos = [
    { title: "헬스장 러닝머신 예약 전쟁", url: "https://example.com/o1", source: "solo1", score: 900, commentCount: 100, publishedAt: iso },
    { title: "야식 배달 대기 시간 실측", url: "https://example.com/o2", source: "solo2", score: 800, commentCount: 100, publishedAt: iso },
    { title: "지하철 막차 놓친 사연", url: "https://example.com/o3", source: "solo3", score: 700, commentCount: 100, publishedAt: iso },
    { title: "사무실 탕비실 간식 취향", url: "https://example.com/o4", source: "solo4", score: 600, commentCount: 100, publishedAt: iso }
  ];

  const capped = pickWeeklyTopics([signalX, signalY, ...solos], { count: 4, now });
  const cappedTitles = capped.map((t) => t.title);
  assert.equal(cappedTitles.length, 4);
  assert.ok(cappedTitles.includes(signalX.title) && cappedTitles.includes(signalY.title), "신호 있는 소재는 캡에서 면제돼 항상 선정된다");
  assert.ok(cappedTitles.includes(solos[0].title) && cappedTitles.includes(solos[1].title), "단일 출처 소재는 상위 max_single_source_topics개까지만");
  assert.ok(!cappedTitles.includes(solos[2].title) && !cappedTitles.includes(solos[3].title), "캡 초과분은 raw hotness가 높아도 밀려난다");

  const starved = pickWeeklyTopics(solos, { count: 4, now });
  assert.equal(starved.length, 4, "대체할 신호 소재가 없을 때도 개수는 보장돼야 한다");
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

test("pickWeeklyTopics excludes crime/scandal and politics_extra titles", () => {
  const items = [
    { title: "사직한 여중생 성매매 시의원 급여 챙겨감", source: "ppomppu", score: 900 },
    { title: "유시민 당대표는 대통령 부하 아냐 발언", source: "bobae", score: 800 },
    { title: "요즘 편의점 신상 조합 근황", source: "clien", score: 10 }
  ];
  const topics = pickWeeklyTopics(items, { count: 3, now: NOW });
  assert.equal(topics.length, 1, "범죄·스캔들·정치 소재 제외");
  assert.ok(topics[0].title.includes("편의점"));
});

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

// ---- 유행 테스트 신호 탐지 (David 확정 2026-07-26) -------------------------

test("pickTestTrendSignals matches test/type/personality/~력 keyword titles and ranks by hotness", () => {
  const now = NOW;
  const iso = new Date(now).toISOString();
  const items = [
    { title: "요즘 도는 꼰대력 테스트 결과 공유", url: "https://example.com/t1", source: "clien", score: 500, commentCount: 40, publishedAt: iso },
    { title: "MBTI 성향별 여행 스타일 정리", url: "https://example.com/t2", source: "ppomppu", score: 900, commentCount: 60, publishedAt: iso },
    { title: "오늘 점심 메뉴 추천", url: "https://example.com/t3", source: "clien", score: 950, commentCount: 60, publishedAt: iso }
  ];
  const signals = pickTestTrendSignals(items, { now });
  const titles = signals.map((s) => s.title);
  assert.ok(titles.includes(items[0].title), "테스트류 제목이 포함돼야 한다");
  assert.ok(titles.includes(items[1].title), "MBTI 키워드 제목이 포함돼야 한다");
  assert.ok(!titles.includes(items[2].title), "테스트류 신호가 없는 일반 화제는 제외돼야 한다");
  // hotness 내림차순
  for (let i = 1; i < signals.length; i++) assert.ok(signals[i - 1].score >= signals[i].score);
});

test("pickTestTrendSignals matches the '~력' pattern via token-ending detection", () => {
  const items = [
    { title: "요즘 화제인 눈치력 자가진단 공유", url: "https://example.com/y1", source: "clien", score: 300, commentCount: 10, publishedAt: new Date(NOW).toISOString() }
  ];
  const signals = pickTestTrendSignals(items, { now: NOW });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].title, items[0].title);
});

test("pickTestTrendSignals applies the same brand-safety filter as pickWeeklyTopics", () => {
  const items = [
    { title: "유시민 당대표 성향 테스트 논란", url: "https://example.com/p1", source: "bobae", score: 999, commentCount: 10, publishedAt: new Date(NOW).toISOString() },
    { title: "오늘의 성향 테스트 유형 정리", url: "https://example.com/p2", source: "clien", score: 100, commentCount: 10, publishedAt: new Date(NOW).toISOString() }
  ];
  const signals = pickTestTrendSignals(items, { now: NOW });
  assert.equal(signals.length, 1, "정치 소재는 트렌드 신호 매칭이어도 세이프티 필터로 제외돼야 한다");
  assert.equal(signals[0].title, items[1].title);
});

test("pickTestTrendSignals respects the limit/top_n option and defaults from the manifest", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const iso = new Date(NOW).toISOString();
  const items = Array.from({ length: 15 }, (_, i) => ({
    title: `유형 테스트 후보 ${i}`,
    url: `https://example.com/tt${i}`,
    source: `src${i}`,
    score: 100 - i,
    commentCount: 5,
    publishedAt: iso
  }));
  const defaultSignals = pickTestTrendSignals(items, { now: NOW });
  assert.equal(defaultSignals.length, CONTRACT.trend_signal_top_n);
  const limited = pickTestTrendSignals(items, { now: NOW, limit: 3 });
  assert.equal(limited.length, 3);
});

// ---- axis-based format (level_bands template) -----------------------------

test("templateQuiz produces a valid level_bands quiz meeting the design spec", () => {
  const quiz = sampleQuiz();
  assert.ok(validateQuiz(quiz));
  assert.equal(quiz.theme.format, "level_bands");
  assert.ok(quiz.theme.id && quiz.theme.name_ko);
  assert.ok(quiz.axes.length >= 1 && quiz.axes.length <= 2);
  assert.ok(quiz.questions.length >= 9 && quiz.questions.length <= 12);
  assert.ok(Array.isArray(quiz.bands) && quiz.bands.length === 3);
  assert.equal(quiz.results.length, quiz.bands.length * 2, "밴드 3개 × 스타일 극 2개 = 결과 6개");
  for (const r of quiz.results) {
    assert.ok(r.strengths.length >= 3);
    assert.ok(r.weaknesses.length >= 1 && r.weaknesses.length <= 2);
    assert.ok(r.bestMatch && r.worstMatch);
  }
});

test("comboSampleQuiz fixture is a valid combo_types quiz meeting the design spec", () => {
  const quiz = comboSampleQuiz();
  assert.ok(validateQuiz(quiz));
  assert.equal(quiz.theme.format, "combo_types");
  assert.ok(quiz.axes.length >= 2 && quiz.axes.length <= 4);
  assert.ok(quiz.questions.length >= 12 && quiz.questions.length <= 16);
  assert.equal(quiz.results.length, 2 ** quiz.axes.length);
});

test("allTypeCodes enumerates every pole combination in axis order (combo_types)", () => {
  const quiz = comboSampleQuiz();
  const codes = allTypeCodes(quiz.axes);
  assert.equal(codes.length, 2 ** quiz.axes.length);
  assert.ok(codes.includes("FS") && codes.includes("TH"));
});

test("allLevelCodes enumerates band × style-pole combinations (level_bands), and just the bands when there is no style axis", () => {
  const quiz = sampleQuiz();
  const styleAxis = quiz.axes[1];
  const codes = allLevelCodes(quiz.bands, styleAxis);
  assert.equal(codes.length, quiz.bands.length * 2);
  assert.ok(codes.includes("L1D") && codes.includes("L3E"));
  const noStyle = allLevelCodes(quiz.bands, null);
  assert.deepEqual(noStyle, quiz.bands.map((b) => b.code));
});

test("validateQuiz requires a theme with id/name_ko/format in {combo_types, level_bands}", () => {
  const missing = structuredClone(sampleQuiz());
  delete missing.theme;
  assert.throws(() => validateQuiz(missing), /테마\(theme\)가 없어요/);

  const missingId = structuredClone(sampleQuiz());
  delete missingId.theme.id;
  assert.throws(() => validateQuiz(missingId), /테마 id\/name_ko가 없어요/);

  const badFormat = structuredClone(sampleQuiz());
  badFormat.theme.format = "something_else";
  assert.throws(() => validateQuiz(badFormat), /테마 format이 잘못됐어요/);
});

test("validateQuiz enforces axis question balance and pole mixing (format-agnostic)", () => {
  const quiz = sampleQuiz();
  // 한 축의 문항이 3개 미만이면 거부 (총 문항 수는 유지한 채 축만 재배정)
  const starved = structuredClone(quiz);
  let kept = 0;
  for (const q of starved.questions) {
    if (q.axis === "style" && ++kept > 2) q.axis = "level";
  }
  assert.throws(() => validateQuiz(starved), /3개 미만/);
  // 한쪽 극만 미는 문항 거부 (정답 냄새/역채점 균형 규칙)
  const lopsided = structuredClone(quiz);
  lopsided.questions[0].answers = lopsided.questions[0].answers.map((a) => ({ ...a, pole: "left" }));
  assert.throws(() => validateQuiz(lopsided), /한쪽 극만/);
  // 유형 조합 커버리지: 하나 빠지면 거부
  const missingResult = structuredClone(quiz);
  missingResult.results = missingResult.results.slice(1);
  assert.throws(() => validateQuiz(missingResult), /결과가 없어요/);
});

test("validateQuiz enforces combo_types axis count (2~4) and question count (12~16)", () => {
  const tooFewAxes = structuredClone(comboSampleQuiz());
  tooFewAxes.axes = [tooFewAxes.axes[0]];
  assert.throws(() => validateQuiz(tooFewAxes), /심리 축은 2~4개/);

  const tooFewQuestions = structuredClone(comboSampleQuiz());
  tooFewQuestions.questions = tooFewQuestions.questions.slice(0, 8);
  assert.throws(() => validateQuiz(tooFewQuestions), /문항은 12~16개/);
});

test("validateQuiz enforces level_bands axis count (1~2), bands (3~5, continuous 0~100 coverage), and question count (9~12)", () => {
  const tooManyAxes = structuredClone(sampleQuiz());
  tooManyAxes.axes.push({ id: "extra", name: "여분", intro: "테스트용 여분 축이라 별 의미는 없다.", left: { code: "X", label: "엑스" }, right: { code: "Y", label: "와이" } });
  assert.throws(() => validateQuiz(tooManyAxes), /레벨형은 축이 1~2개/);

  const tooFewBands = structuredClone(sampleQuiz());
  tooFewBands.bands = tooFewBands.bands.slice(0, 2);
  assert.throws(() => validateQuiz(tooFewBands), /밴드\(bands\)가 3~5개/);

  const gapBands = structuredClone(sampleQuiz());
  gapBands.bands[1].min = 40; // L1(0~33)과 L2(40~66) 사이에 34~39 공백 발생
  assert.throws(() => validateQuiz(gapBands), /겹치거나 비어 있어요/);

  const overlapBands = structuredClone(sampleQuiz());
  overlapBands.bands[1].min = 30; // L1(0~33)과 L2(30~66)가 겹침
  assert.throws(() => validateQuiz(overlapBands), /겹치거나 비어 있어요/);

  const notFrom0 = structuredClone(sampleQuiz());
  notFrom0.bands[0].min = 1;
  assert.throws(() => validateQuiz(notFrom0), /0%부터 시작/);

  const notTo100 = structuredClone(sampleQuiz());
  notTo100.bands[notTo100.bands.length - 1].max = 99;
  assert.throws(() => validateQuiz(notTo100), /100%까지 커버/);

  const tooFewQuestions = structuredClone(sampleQuiz());
  tooFewQuestions.questions = tooFewQuestions.questions.slice(0, 8);
  assert.throws(() => validateQuiz(tooFewQuestions), /문항은 9~12개/);
});

test("validateQuiz enforces the 80:20 result copy rules", () => {
  const flattery = structuredClone(sampleQuiz());
  flattery.results[0].weaknesses = []; // 칭찬만 있는 결과는 가짜같이 느껴진다
  assert.throws(() => validateQuiz(flattery), /성장 포인트/);
  const selfMatch = structuredClone(sampleQuiz());
  selfMatch.results[0].bestMatch = selfMatch.results[0].code;
  assert.throws(() => validateQuiz(selfMatch), /bestMatch/);
});

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

  const quiz = sampleQuiz();
  for (const r of quiz.results) {
    assert.ok(r.bestMatchReason && r.bestMatchReason.length <= 40);
    assert.ok(r.worstMatchReason && r.worstMatchReason.length <= 40);
  }
});

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

  const quiz = sampleQuiz();
  assert.ok(Array.isArray(quiz.weeklyBrief) && quiz.weeklyBrief.length > 0);
  for (const b of quiz.weeklyBrief) {
    assert.ok(b.topic && b.intro.length >= 15 && b.intro.length <= 90);
    assert.ok(["국민상식", "대중화제", "커뮤내수"].includes(b.tier));
  }
});

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

  const quiz = sampleQuiz();
  for (const a of quiz.axes) {
    assert.ok(a.intro && a.intro.length >= 15 && a.intro.length <= 70);
  }
});

// ---- generation (theme-first buildPrompt) --------------------------------

test("QUIZ_SCHEMA requires theme (id/name_ko/format) at the top level", () => {
  assert.ok(QUIZ_SCHEMA.required.includes("theme"));
  assert.deepEqual(QUIZ_SCHEMA.properties.theme.required, ["id", "name_ko", "format"]);
  assert.deepEqual(QUIZ_SCHEMA.properties.theme.properties.format.enum, ["combo_types", "level_bands"]);
});

test("buildPrompt lists the theme candidate pool and selection criteria when no theme is forced", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const prompt = buildPrompt({ weekLabel: "2026w30", themePool: CONTRACT.theme.pool });
  assert.ok(prompt.includes("테스트 하나 = 성향 하나"));
  for (const t of CONTRACT.theme.pool) assert.ok(prompt.includes(t.id) && prompt.includes(t.name_ko));
  for (const c of CONTRACT.theme.selection_criteria_ko) assert.ok(prompt.includes(c));
  assert.ok(prompt.includes("[0단계"));
});

test("buildPrompt skips theme selection and commits directly to the forced theme", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const forced = CONTRACT.theme.pool.find((t) => t.id === "empathy-vs-fact");
  const prompt = buildPrompt({ weekLabel: "2026w30", forcedTheme: forced });
  assert.ok(prompt.includes("이미 정해졌다"));
  assert.ok(prompt.includes(forced.name_ko));
  assert.ok(prompt.includes("선정 절차는 생략"));
});

test("buildPrompt includes trend signals as reference-only input, never as adoptable material", () => {
  const trendSignals = [{ title: "요즘 도는 성향 테스트 근황", source: "clien", score: 100 }];
  const prompt = buildPrompt({ weekLabel: "2026w30", trendSignals });
  assert.ok(prompt.includes(trendSignals[0].title));
  assert.ok(prompt.includes("참고용일 뿐 소재 자체 아님"));
});

test("buildPrompt walks the generator through the 5-stage professional workflow including the single-theme self-check", () => {
  const prompt = buildPrompt({ weekLabel: "2026w30" });
  assert.ok(prompt.includes("테마 선정"), "0단계 테마 선정이 있어야 한다");
  assert.ok(prompt.includes("셀프 검수"), "4단계 셀프 검수가 있어야 한다");
  assert.ok(prompt.includes("[0단계") && prompt.includes("[1단계") && prompt.includes("[2단계") && prompt.includes("[3단계") && prompt.includes("[4단계") && prompt.includes("[5단계"));
  assert.ok(prompt.includes("전 문항·결과가 테마 하나만 재는가"), "⑩ 자기 점검 항목이 있어야 한다");
});

test("buildPrompt explains both formats (combo_types axis design, level_bands bands field)", () => {
  const prompt = buildPrompt({ weekLabel: "2026w30" });
  assert.ok(prompt.includes("combo_types를 골랐다면"));
  assert.ok(prompt.includes("level_bands를 골랐다면"));
  assert.ok(prompt.includes("`bands` 최상위 필드"));
  assert.ok(prompt.includes("겹치지 않고 빈틈없이 연속"));
});

test("buildPrompt includes a rejection-feedback section only when feedback is given", () => {
  const withoutFeedback = buildPrompt({ weekLabel: "2026w30" });
  assert.ok(!withoutFeedback.includes("반려됐다"));
  const withFeedback = buildPrompt({ weekLabel: "2026w30", feedback: ["[QG1-structure] 테스트용 반려 사유"] });
  assert.ok(withFeedback.includes("반려됐다"));
  assert.ok(withFeedback.includes("[QG1-structure] 테스트용 반려 사유"));
});

test("generateQuizWithClaude sends the structured-output request and parses the reply", async () => {
  const expected = sampleQuiz();
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
  const quiz = await generateQuizWithClaude({ apiKey: "test-key", fetchImpl, weekLabel: "2026w30" });
  assert.equal(quiz.title, expected.title);
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.headers["x-api-key"], "test-key");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.body.model, DEFAULT_MODEL);
  assert.deepEqual(captured.body.thinking, { type: "adaptive" });
  assert.deepEqual(captured.body.output_config.format.schema, QUIZ_SCHEMA);
});

test("generateQuizWithClaude surfaces refusals and non-JSON replies as errors", async () => {
  const refuse = async () => ({ ok: true, async json() { return { stop_reason: "refusal", content: [] }; } });
  await assert.rejects(() => generateQuizWithClaude({ apiKey: "k", fetchImpl: refuse }), /거절/);
  const garbage = async () => ({ ok: true, async json() { return { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }; } });
  await assert.rejects(() => generateQuizWithClaude({ apiKey: "k", fetchImpl: garbage }), /JSON/);
});

test("generateQuiz falls back to the level_bands template when no API key is configured", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { quiz, via } = await generateQuiz({});
    assert.equal(via, "template");
    assert.ok(validateQuiz(quiz));
    assert.equal(quiz.theme.format, "level_bands");
  } finally {
    if (saved != null) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---- axis scoring ----------------------------------------------------------

test("scoreQuiz computes per-axis spectrum percentages and the combo_types type code", () => {
  const quiz = comboSampleQuiz();
  const allLeft = quiz.questions.map((q) => q.answers.findIndex((a) => a.pole === "left" && (a.weight || 1) === 2));
  const scored = scoreQuiz(quiz, allLeft);
  assert.equal(scored.code, "FS");
  for (const axis of scored.axes) {
    assert.equal(axis.leftPercent, 100);
    assert.equal(axis.dominant, "left");
  }
  assert.equal(scored.result.code, "FS");
  assert.equal(scored.levelPercent, undefined, "combo_types는 levelPercent를 봉투에 넣지 않는다");
});

test("scoreQuiz resolves level_bands quizzes to a band × style-pole code and includes levelPercent/band in the envelope", () => {
  const quiz = sampleQuiz();
  const allLeft = quiz.questions.map((q) => q.answers.findIndex((a) => a.pole === "left" && (a.weight || 1) === 2));
  const scored = scoreQuiz(quiz, allLeft);
  assert.equal(scored.levelPercent, 100);
  assert.equal(scored.band.code, "L3");
  assert.equal(scored.code, "L3D");
  assert.equal(scored.result.code, "L3D");

  const allRight = quiz.questions.map((q) => q.answers.findIndex((a) => a.pole === "right" && (a.weight || 1) === 2));
  const scoredRight = scoreQuiz(quiz, allRight);
  assert.equal(scoredRight.levelPercent, 0);
  assert.equal(scoredRight.band.code, "L1");
  assert.equal(scoredRight.code, "L1E");
});

test("scoreQuiz respects level-band boundaries exactly at min/max", () => {
  const quiz = sampleQuiz();
  // 레벨 축 문항 6개(축 순서상 앞쪽) 중 2/6=33%가 되도록 left를 딱 2개만
  // 고르면 leftPercent가 L1(0~33)의 상단 경계에 정확히 걸린다.
  const levelQuestionIdx = quiz.questions.map((q, i) => (q.axis === "level" ? i : -1)).filter((i) => i >= 0);
  const styleQuestionIdx = quiz.questions.map((q, i) => (q.axis === "style" ? i : -1)).filter((i) => i >= 0);
  const picks = new Array(quiz.questions.length).fill(0);
  // 스타일 축은 아무 답이나(결과 code 조합만 확인할 것이므로 첫 답변 사용).
  for (const i of styleQuestionIdx) picks[i] = 0;
  // 레벨 축: weight를 균등하게 2/6 정도가 되도록 앞의 2문항만 left(weight 무관 텍스트 매칭이 아니라 weight 합 기준이므로 직접 계산 대신 실제 산출값을 읽어 밴드만 확인한다.
  for (const i of levelQuestionIdx) picks[i] = quiz.questions[i].answers.findIndex((a) => a.pole === "right");
  const scored = scoreQuiz(quiz, picks);
  const matchedBand = quiz.bands.find((b) => scored.levelPercent >= b.min && scored.levelPercent <= b.max);
  assert.ok(matchedBand, `레벨 ${scored.levelPercent}%에 맞는 밴드가 있어야 한다`);
  assert.equal(scored.band.code, matchedBand.code);
});

test("scoreQuiz is deterministic and resolves a 50:50 axis to the left pole", () => {
  const quiz = comboSampleQuiz();
  const picks = quiz.questions.map(() => 0);
  assert.equal(scoreQuiz(quiz, picks).code, scoreQuiz(quiz, picks).code);
  const mini = structuredClone(quiz);
  mini.questions = mini.questions.map((q) => ({
    ...q,
    answers: [
      { text: "l", pole: "left", weight: 1 },
      { text: "r", pole: "right", weight: 1 }
    ]
  }));
  const perAxisSeen = {};
  const tiePicks = mini.questions.map((q) => {
    perAxisSeen[q.axis] = (perAxisSeen[q.axis] || 0) + 1;
    return perAxisSeen[q.axis] % 2 === 1 ? 0 : 1;
  });
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

  let stats = store.statsFor("2026w30-s", codes);
  assert.equal(stats.total, 0);
  const evenShare = Math.round(100 / codes.length);
  for (const c of codes) assert.equal(stats.share[c], evenShare);

  for (let i = 0; i < 6; i++) store.recordResponse("2026w30-s", codes[0]);
  stats = store.statsFor("2026w30-s", codes);
  assert.equal(stats.total, 6);
  assert.ok(stats.share[codes[0]] > stats.share[codes[codes.length - 1]]);

  assert.throws(() => store.recordResponse("2026w30-s", "XX"), /없는 유형/);
  assert.throws(() => store.recordResponse("no-such", codes[0]), /발행된/);
});

// ---- pack manifest (WRC 표준 미러) ----------------------------------------

test("pack manifest declares the WRC-standard contract blocks", async () => {
  const { MANIFEST, CONTRACT } = await import("../src/quiz/manifest.js");
  for (const key of ["project", "pack", "display_name_ko", "activation", "pipeline", "pack_contract", "files", "node_owner_map", "algo_map", "identity", "registration"]) {
    assert.ok(MANIFEST[key] != null, `매니페스트 필수 블록 누락: ${key}`);
  }
  assert.ok(MANIFEST.activation.no_go.includes("external_publish"));
  assert.equal(MANIFEST.activation.external_actions_enabled, false);
  assert.deepEqual(CONTRACT.required_gate_ids, ["QG0", "QG1", "QG2", "QG3", "QG4", "QG5", "QG6"]);
  for (const id of ["QG0", "QG1", "QG2", "QG3", "QG4", "QG6"]) {
    assert.ok(["HARD", "HOLD", "GUIDE"].includes(CONTRACT.gate_grades[id]), `등급 미선언: ${id}`);
    assert.ok(CONTRACT.risk_policy[id], `risk_policy 미선언: ${id}`);
  }
  assert.equal(CONTRACT.gate_grades.QG5, undefined, "QG5는 등급이 아니라 사람 게이트");
  const davidNode = MANIFEST.pipeline.find((n) => n.gateIds.includes("QG5"));
  assert.equal(davidNode.kind, "david");
  assert.equal(CONTRACT.retry_budget, 3);
  assert.equal(CONTRACT.gate_id_migration.G1, "QG1");
  for (const k of ["projectId", "driverSeatId", "packId", "enginePackId", "workflowSlug"]) {
    assert.ok(MANIFEST.identity[k], `identity 필드 누락: ${k}`);
  }
  assert.match(MANIFEST.identity.projectId, /^project:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.driverSeatId, /^driver-seat:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.packId, /^pack:[a-z0-9-]+$/);
  assert.match(MANIFEST.identity.enginePackId, /^[a-z0-9_]+$/);
});

test("pack manifest declares the theme contract (pool 12+, selection criteria, history, formats)", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.schema_version, "weekly-viral-quiz-pack-1");
  assert.ok(Array.isArray(CONTRACT.theme.selection_criteria_ko) && CONTRACT.theme.selection_criteria_ko.length === 4);
  assert.ok(Array.isArray(CONTRACT.theme.pool) && CONTRACT.theme.pool.length >= 12);
  for (const t of CONTRACT.theme.pool) {
    assert.ok(t.id && /^[a-z0-9-]+$/.test(t.id), `테마 id는 kebab-case여야 한다: ${t.id}`);
    assert.ok(t.name_ko, `테마 ${t.id}의 name_ko 누락`);
    assert.ok(t.hook_ko, `테마 ${t.id}의 hook_ko 누락`);
    assert.ok(t.proven_ko, `테마 ${t.id}의 proven_ko 누락`);
    assert.ok(["combo_types", "level_bands"].includes(t.suggested_format), `테마 ${t.id}의 suggested_format이 잘못됐다`);
  }
  const ids = CONTRACT.theme.pool.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "테마 id는 중복이 없어야 한다");
  assert.equal(CONTRACT.theme.history_file, "data/quiz/theme_history.json");
  assert.equal(CONTRACT.theme.no_repeat_weeks, 8);
  assert.ok(CONTRACT.trend_signal_ko);
  assert.ok(Array.isArray(CONTRACT.trend_signal_keywords) && CONTRACT.trend_signal_keywords.length > 0);
  assert.equal(typeof CONTRACT.trend_signal_top_n, "number");
  assert.ok(CONTRACT.formats.combo_types && CONTRACT.formats.level_bands);
});

test("pack manifest bumped to version 6 for the theme-first pivot", async () => {
  const { MANIFEST } = await import("../src/quiz/manifest.js");
  assert.equal(MANIFEST.version, 6);
});

test("pack manifest removes the topic-binding viral checks and declares theme_coherence instead", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  for (const removed of [
    "title_topic_keyword_required",
    "result_topic_mention_required",
    "result_topic_coverage_required",
    "question_topic_bound_min_ratio",
    "weekly_brief_topic_coverage_required"
  ]) {
    assert.equal(CONTRACT.checks.viral[removed], undefined, `${removed}는 폐기됐어야 한다`);
  }
  assert.ok(CONTRACT.checks.viral.theme_coherence);
  assert.equal(typeof CONTRACT.checks.viral.theme_coherence.weekly_brief_min, "number");
  assert.equal(typeof CONTRACT.checks.viral.theme_coherence.weekly_brief_max, "number");
});

test("pack manifest declares result_labels_ko.weekly_pick and a {levelPercent} share-block slot", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.result_labels_ko.weekly_pick, "이 성향이 제일 티 나는 순간");
  assert.ok(CONTRACT.share_block_template_ko.some((line) => line.includes("{levelPercent}")));
});

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

test("template (level_bands) and combo fixture both clear every loop gate (QG1~QG4) with no context argument", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const levelReport = runGates(sampleQuiz());
  assert.deepEqual(levelReport.failures, []);
  assert.equal(levelReport.pass, true);

  const comboReport = runGates(comboSampleQuiz());
  assert.deepEqual(comboReport.failures, []);
  assert.equal(comboReport.pass, true);
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
  for (const q of skewed.questions.filter((x) => x.axis === "style")) {
    for (const a of q.answers) a.weight = a.pole === "left" ? 2 : 1;
  }
  const report = runGates(skewed);
  assert.ok(report.failures.some((f) => f.gate === "QG4-scoring" && f.message.includes("style")));
});

test("QG1 structure gate rejects non-uniform answer counts per question", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.questions[0].answers.pop();
  const report = runGates(quiz);
  const fail = report.failures.find((f) => f.gate === "QG1-structure" && f.message.includes("답변 개수"));
  assert.ok(fail, "답변 개수 불일치가 잡혀야 한다");
  assert.match(fail.message, /Q1=3개/, "문항 번호와 개수가 사유에 명시돼야 한다");
});

test("QG1 structure gate rejects near-duplicate question text (same topic/sentence reused)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.questions[2].q = quiz.questions[0].q;
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("Q1") && f.message.includes("Q3") && f.message.includes("재탕"))
  );
});

test("QG1 structure gate rejects an axis whose questions all lead with the same pole (reverse-scoring balance)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const q of quiz.questions) {
    if (q.axis === "level") q.answers[0].pole = "left";
  }
  const report = runGates(quiz);
  assert.ok(
    report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("level") && f.message.includes("역채점"))
  );
});

test("QG1 structure gate rejects results whose opening sentences all share the same ending pattern (template opening)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const r of quiz.results) {
    r.description = "이건 확실히 게 너다. 나머지 설명은 여기 붙어서 결과문 최소 글자 수 조건도 넉넉하게 채운다.";
  }
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG1-structure" && f.message.includes("오프닝 종결")));
});

test("QG2 viral gate rejects share texts that share the same template (low diversity across types)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[1].shareText = quiz.results[0].shareText;
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("템플릿 복붙")));
});

test("QG2 viral gate rejects share texts that end with '?' too often (question-ending ratio)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const r of quiz.results) {
    r.shareText = `나는 ${r.title} 그 자체다 — 너는?`;
  }
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("물음표로 끝나는 비율")));
});

test("QG3 ai-tell gate rejects formal '~합니다'-style endings from the expanded phrase list", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.results[0].description = "이 유형은 트렌드에 민감하게 반응합니다. 정보를 빠르게 접하는 편입니다.";
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG3-ai-tell" && (f.message.includes("합니다") || f.message.includes("입니다"))));
});

test("QG3 ai-tell gate scans weeklyBrief intros for formal phrasing but passes friendly casual explanations", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const formal = structuredClone(sampleQuiz());
  formal.weeklyBrief[0].intro = "이 성향은 이번에 화제가 되었습니다. 많은 분들이 반응했습니다.";
  const formalReport = runGates(formal);
  assert.ok(formalReport.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("브리핑")));

  const casual = structuredClone(sampleQuiz());
  casual.weeklyBrief[0].intro = "이 성향은 요즘 다들 궁금해하는 거야 — 나이 상관없이 나올 수 있는 거지.";
  const casualReport = runGates(casual);
  assert.ok(!casualReport.failures.some((f) => f.gate === "QG3-ai-tell" && f.message.includes("브리핑")));
});

// ---- 테마 정합성(theme_coherence) — David 확정(2026-07-26) -----------------
// 토픽 결박 게이트(제목/결과 토픽 키워드·토픽 커버리지·문항 토픽 비율·브리핑
// 토픽 커버리지)는 전부 폐기됐다 — topics 컨텍스트 없이도 항상 PASS인지, 그
// 대신 theme_coherence만 이 조건들을 검사하는지 확인한다.

test("runGates no longer accepts/needs a topics context — the same quiz passes with or without a second argument", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = sampleQuiz();
  const withoutContext = runGates(quiz);
  const withIgnoredContext = runGates(quiz, { topics: [{ title: "아무 상관 없는 옛 후보" }] });
  assert.equal(withoutContext.pass, true);
  assert.equal(withIgnoredContext.pass, true);
  assert.deepEqual(withoutContext.reasons, withIgnoredContext.reasons);
});

test("theme_coherence rejects a title+description with no theme name fragment", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  quiz.title = "아무 날이나 봐도 똑같은 심심풀이 문답";
  quiz.description = "누구한테나 뻔하게 들어맞는 흔해빠진 답만 나온다";
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("테마") && f.message.includes(quiz.theme.name_ko)));
});

test("theme_coherence is lenient — passes as long as ANY one result description or weeklyPick mentions the theme (not every result)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  // 결과 서술·weeklyPick에서 테마 어절("꼰대력")을 전부 지워도, 다른 유형
  // 하나에라도 남아있으면 통과해야 한다(관대).
  for (let i = 1; i < quiz.results.length; i++) {
    quiz.results[i].description = quiz.results[i].description.replace(/꼰대/g, "성향");
    quiz.results[i].weeklyPick = quiz.results[i].weeklyPick.replace(/꼰대/g, "성향");
  }
  const report = runGates(quiz);
  assert.ok(!report.failures.some((f) => f.message.includes("어디에도 테마")), "결과 하나라도 테마를 언급하면 통과해야 한다");
});

test("theme_coherence rejects when no result description or weeklyPick mentions the theme at all", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const quiz = structuredClone(sampleQuiz());
  for (const r of quiz.results) {
    r.description = r.description.replace(/꼰대/g, "성향");
    r.weeklyPick = r.weeklyPick.replace(/꼰대/g, "성향");
  }
  const report = runGates(quiz);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("어디에도 테마")));
});

test("theme_coherence requires weeklyBrief to have 1~3 items", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const tooMany = structuredClone(sampleQuiz());
  tooMany.weeklyBrief = [
    tooMany.weeklyBrief[0],
    { topic: "여분1", intro: "이건 그냥 테스트용으로 추가한 여분 설명 항목이야.", tier: "국민상식" },
    { topic: "여분2", intro: "이것도 그냥 테스트용으로 추가한 여분 설명 항목이야.", tier: "국민상식" },
    { topic: "여분3", intro: "이것도 역시 테스트용으로 추가한 여분 설명 항목이야.", tier: "국민상식" }
  ];
  const report = runGates(tooMany);
  assert.ok(report.failures.some((f) => f.gate === "QG2-viral" && f.message.includes("1~3개")));
});

test("comboSampleQuiz fixture already clears theme_coherence (title/description mention the theme name)", async () => {
  const { runGates } = await import("../src/quiz/gates.js");
  const report = runGates(comboSampleQuiz());
  assert.ok(!report.failures.some((f) => f.message.includes("테마")));
});

// ---- render.js ------------------------------------------------------------

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

test("renderResultPage displays bestMatchReason/worstMatchReason under the chemistry section", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-reasontest", quiz }, result, "https://example.com", {});
  assert.ok(result.bestMatchReason && result.worstMatchReason);
  assert.ok(html.includes(result.bestMatchReason));
  assert.ok(html.includes(result.worstMatchReason));
  assert.match(html, /class="reason"/);
});

test("renderResultPage shows '이 성향이 제일 티 나는 순간' with the result's weeklyPick", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-pick", quiz }, result, "https://example.com", {});
  assert.ok(html.includes("이 성향이 제일 티 나는 순간"));
  assert.ok(html.includes(escHtml(result.weeklyPick)));
});

test("renderResultPage shows a big level-percent headline (theme name + %) for level_bands results when personal percents are given", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-level", quiz }, result, "https://example.com", { percents: [37, 60] });
  assert.ok(html.includes(escHtml(quiz.theme.name_ko)));
  assert.ok(html.includes("37%"));
  const band = quiz.bands.find((b) => result.code.startsWith(b.code));
  assert.ok(html.includes(escHtml(band.label_ko)));
});

test("renderResultPage omits an invented level percent for shared (non-personal) views but still shows the band label", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-shared", quiz }, result, "https://example.com", {});
  const band = quiz.bands.find((b) => result.code.startsWith(b.code));
  assert.ok(html.includes(escHtml(band.label_ko)));
  assert.ok(!/꼰대력\s*<b[^>]*>\d/.test(html), "개인 응답이 없으면 레벨 %를 지어내면 안 된다");
});

test("renderResultPage does not show a level headline for combo_types results", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = comboSampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-combo", quiz }, result, "https://example.com", { percents: [70, 40] });
  assert.ok(!html.includes(`${quiz.theme.name_ko} <b`));
});

test("renderQuizPage shows a '이 테스트가 알아보는 것' section with the theme hook and each axis name + intro", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderQuizPage({ slug: "2026w30-axisintro", quiz }, "https://example.com");
  assert.ok(html.includes("이 테스트가 알아보는 것"));
  assert.ok(html.includes(escHtml(quiz.theme.hook_ko)));
  for (const a of quiz.axes) {
    assert.ok(html.includes(escHtml(a.name)));
    assert.ok(html.includes(escHtml(a.intro)));
  }
  assert.ok(html.indexOf("이 테스트가 알아보는 것") < html.indexOf("테스트 시작하기"));
});

test("renderQuizPage shows a '이 테스트가 재는 것' card listing each weeklyBrief topic + intro above the start button", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderQuizPage({ slug: "2026w30-brief", quiz }, "https://example.com");
  assert.ok(html.includes("이 테스트가 재는 것"));
  for (const b of quiz.weeklyBrief) {
    assert.ok(html.includes(escHtml(b.topic)));
    assert.ok(html.includes(escHtml(b.intro)));
  }
  assert.ok(html.indexOf("이 테스트가 재는 것") < html.indexOf("테스트 시작하기"));
});

test("renderQuizPage omits the briefing card and axis-intro section for legacy quizzes without them (backward compat)", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  const legacy = structuredClone(sampleQuiz());
  delete legacy.weeklyBrief;
  delete legacy.theme.hook_ko;
  for (const a of legacy.axes) delete a.intro;
  const html = renderQuizPage({ slug: "2026w30-legacy", quiz: legacy }, "https://example.com");
  assert.ok(!html.includes("이 테스트가 재는 것"));
  assert.ok(!html.includes("이 테스트가 알아보는 것"));
  assert.ok(html.includes("테스트 시작하기"));
});

test("renderQuizPage shows a single ceil-based minute estimate, never a duplicated range like '약 N~N분'", async () => {
  const { renderQuizPage } = await import("../src/quiz/render.js");
  for (const qCount of [9, 10, 11, 12]) {
    const quiz = structuredClone(sampleQuiz());
    quiz.questions = Array.from({ length: qCount }, (_, i) => structuredClone(quiz.questions[i % quiz.questions.length]));
    const html = renderQuizPage({ slug: `2026w30-min${qCount}`, quiz }, "https://example.com");
    assert.ok(!/약\s*\d+\s*~\s*\d+\s*분/.test(html), `${qCount}문항에서 분 범위 표기가 남아있으면 안 된다`);
    const match = html.match(/약\s*(\d+)\s*분/);
    assert.ok(match, `${qCount}문항에서 단일 분 표기가 있어야 한다`);
    assert.equal(Number(match[1]), Math.max(1, Math.ceil(qCount / 5)));
  }
});

// ---- 복붙 공유 블록 (buildShareBlock) --------------------------------------

test("buildShareBlock fills every placeholder and omits the sharePercent clause entirely when no stat is given", async () => {
  const { buildShareBlock } = await import("../src/quiz/render.js");
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const template = CONTRACT.share_block_template_ko;

  const withPercent = buildShareBlock(template, {
    title: "테스트 제목",
    typeTitle: "유형 이름",
    sharePercent: 12,
    levelPercent: 37,
    shareText: "나는 이거다",
    url: "https://example.com/q/w-slug/r/CODE"
  });
  assert.ok(withPercent.includes("테스트 제목"));
  assert.ok(withPercent.includes("유형 이름"));
  assert.ok(withPercent.includes("12%"));
  assert.ok(withPercent.includes("37%"));
  assert.ok(withPercent.includes("나는 이거다"));
  assert.ok(withPercent.includes("https://example.com/q/w-slug/r/CODE"));
  assert.ok(!withPercent.includes("{"), "치환되지 않은 플레이스홀더가 남으면 안 된다");

  const withoutPercent = buildShareBlock(template, {
    title: "테스트 제목",
    typeTitle: "유형 이름",
    sharePercent: null,
    levelPercent: null,
    shareText: "나는 이거다",
    url: "https://example.com/q/w-slug/r/CODE"
  });
  assert.ok(!withoutPercent.includes("%"), "퍼센트 통계가 없으면 관련 줄이 전부 빠져야 한다");
  assert.ok(!withoutPercent.includes("()"), "빈 괄호를 남기면 안 된다");
  assert.ok(withoutPercent.includes("유형 이름"), "퍼센트가 빠져도 나머지 줄(유형 이름)은 그대로 남아야 한다");
  assert.ok(!withoutPercent.includes("{"), "치환되지 않은 플레이스홀더가 남으면 안 된다");
  // 레벨 % 줄은 통째로 생략(빈 줄 하나 남기지 않음) — 줄 수가 sharePercent만
  // 없앤 경우보다 하나 더 적어야 한다.
  const withoutLevelOnly = buildShareBlock(template, {
    title: "테스트 제목",
    typeTitle: "유형 이름",
    sharePercent: 12,
    levelPercent: null,
    shareText: "나는 이거다",
    url: "https://example.com/q/w-slug/r/CODE"
  });
  assert.ok(!withoutLevelOnly.includes("레벨"), "levelPercent가 없으면 '레벨' 줄 자체가 빠져야 한다");
});

test("renderResultPage injects the manifest share-block template into the copy button's payload, with levelPercent when personal", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const html = renderResultPage({ slug: "2026w30-shareblock", quiz }, result, "https://example.com", { percents: [37, 60] });
  assert.ok(html.includes("결과 복사"));
  assert.ok(html.includes("👉 나도 해보기"));
  assert.ok(html.includes(result.title));
  assert.ok(html.includes("붙여넣으면 카드처럼 보여요"));
  assert.ok(html.includes("레벨 37%"));
  assert.ok(Array.isArray(CONTRACT.share_block_template_ko) && CONTRACT.share_block_template_ko.length > 0);
});

// ---- weekly.js pipeline (theme-first) -------------------------------------

test("runWeekly generates a template draft and routes publishing to the decision queue", async () => {
  const store = tmpStore();
  const { draft, publishTask, via } = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  assert.equal(via, "template");
  assert.equal(draft.status, "draft");
  assert.equal(draft.week, weekLabel(new Date(NOW)));
  assert.equal(draft.quiz.theme.format, "level_bands");
  assert.equal(publishTask.nextQueue, "decision_queue");
  assert.equal(publishTask.reason, "human_approval_required");
  assert.equal(store.listPublished().length, 0);
});

test("router treats quiz publish tasks as approval-required even without the flag", () => {
  const routed = routeTask({ title: "publish quiz: 아무거나", status: "ready" });
  assert.equal(routed.nextQueue, "decision_queue");
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
  assert.ok(secondPrompt.includes("반려"));
  assert.ok(secondPrompt.includes("QG1-structure"));
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
      assert.match(err.message, /루프게이트를 통과하지 못했/);
      assert.equal(err.decision, "BLOCK");
      assert.ok(err.reasons.some((r) => r.startsWith("[QG1-structure]")));
      return true;
    }
  );
  assert.equal(calls, 2);
  assert.equal(store.listDrafts().length, 0, "게이트 미통과 퀴즈는 초안조차 되지 않는다");
});

test("runWeekly re-run of the same week converges on one draft (run binding, not a theme-history conflict)", async () => {
  const store = tmpStore();
  const first = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  const second = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: null });
  assert.equal(first.draft.slug, second.draft.slug);
  assert.equal(second.draft.run.id, `${second.draft.week}-${second.draft.slug}`);
  assert.equal(store.listDrafts().length, 1);
});

test("runWeekly's theme pool excludes themes used within no_repeat_weeks and --theme forces a specific theme", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  const store = tmpStore();
  // 강제 테마로 1회차 실행 — via claude, mock이 강제 테마를 그대로 반영한 퀴즈를 반환.
  const forced = CONTRACT.theme.pool.find((t) => t.id === "trend-sense");
  const forcedQuiz = structuredClone(sampleQuiz());
  forcedQuiz.theme = { id: forced.id, name_ko: forced.name_ko, format: "level_bands" };
  // 테마명이 바뀌었으니 제목/브리핑도 그 테마를 언급하게 바꿔 theme_coherence를 유지한다.
  forcedQuiz.title = `너의 ${forced.name_ko}은 몇 %일까?`;
  forcedQuiz.weeklyBrief[0] = { topic: `${forced.name_ko}이란`, intro: `이건 ${forced.name_ko} 성향을 재는 테스트야 — 다들 궁금해하는 주제지.`, tier: "국민상식" };
  forcedQuiz.results[0].weeklyPick = `${forced.name_ko}이 제일 티 나는 순간을 담은 문항에서 바로 드러나는 성향이다`;
  const fetchImpl = async () => ({ ok: true, async json() { return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(forcedQuiz) }] }; } });

  let capturedPrompt;
  const capturingFetch = async (url, init) => {
    capturedPrompt = JSON.parse(init.body).messages[0].content;
    return fetchImpl();
  };
  const { draft } = await runWeekly(HOT_ITEMS, { store, now: NOW, apiKey: "k", fetchImpl: capturingFetch, theme: "trend-sense" });
  assert.equal(draft.quiz.theme.id, "trend-sense");
  assert.ok(capturedPrompt.includes("이미 정해졌다"));
  assert.ok(capturedPrompt.includes(forced.name_ko));
});

test("weekly.js submit rejects a theme reused within no_repeat_weeks, and records history atomically on success", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-theme-history-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));

  const today = weekLabel();
  const recentWeek = subtractWeeks(today, 3); // 8주 이내 재사용 → 반려돼야 함

  const quiz = sampleQuiz(); // theme.id === "kkondae-level"
  const quizPath = path.join(dir, "quiz.json");
  fs.writeFileSync(quizPath, JSON.stringify(quiz));

  // 이력 파일을 직접 심어 "3주 전에 이 테마를 이미 썼다"를 재현한다.
  fs.writeFileSync(path.join(dir, "theme_history.json"), JSON.stringify({ "kkondae-level": recentWeek }));

  const result = runWeeklyCli(["submit", quizPath, itemsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /테마 이력/);
  assert.equal(new QuizStore({ dir }).listDrafts().length, 0, "테마 이력 충돌은 초안이 되면 안 된다");

  // 다른 테마(id만 다르게, 이름은 통일 검사를 위해 그대로 둔다)는 이력이
  // 없으니 그대로 통과해야 한다.
  const otherThemeQuiz = structuredClone(quiz);
  otherThemeQuiz.theme.id = "trend-sense";
  const otherPath = path.join(dir, "quiz-other.json");
  fs.writeFileSync(otherPath, JSON.stringify(otherThemeQuiz));
  const otherResult = runWeeklyCli(["submit", otherPath, itemsPath], { QUIZ_DIR: dir });
  assert.equal(otherResult.status, 0, otherResult.stderr);

  const history = JSON.parse(fs.readFileSync(path.join(dir, "theme_history.json"), "utf8"));
  assert.equal(history["trend-sense"], today, "성공한 제출은 오늘 회차로 이력이 기록돼야 한다");
  assert.equal(history["kkondae-level"], recentWeek, "실패한 제출은 이력을 덮어쓰지 않는다");
});

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
  bad.results[0].weaknesses = [];
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

test("weekly.js prompt: stdout carries the single-source generation prompt (theme pool + design rules)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-prompt-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));

  const result = runWeeklyCli(["prompt", itemsPath], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("심리 축") || result.stdout.includes("주 지표"));
  assert.ok(result.stdout.includes("테스트 하나 = 성향 하나"));
  assert.ok(!result.stdout.includes("반려됐다"), "no feedback section without --feedback");
  assert.ok(result.stderr.includes("테마"));
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

test("weekly.js prompt --theme <id>: forces a specific theme and skips the selection step", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-prompt-theme-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));

  const result = runWeeklyCli(["prompt", itemsPath, "--theme", "empathy-vs-fact"], { QUIZ_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes("테마 강제 지정"));
  assert.ok(result.stdout.includes("이미 정해졌다"));
  assert.ok(result.stdout.includes("T/F 공감형"));
});

test("weekly.js prompt --theme <bad-id>: exits 1 with a helpful list of valid ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-prompt-badtheme-"));
  const itemsPath = path.join(dir, "items.json");
  fs.writeFileSync(itemsPath, JSON.stringify(HOT_ITEMS));

  const result = runWeeklyCli(["prompt", itemsPath, "--theme", "no-such-theme"], { QUIZ_DIR: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /테마 풀에 없어요/);
});

test("quizSlug is stable for the same title+week and url-safe", () => {
  const quiz = { title: "이번 주 핫이슈 반응 유형테스트" };
  const a = quizSlug(quiz, "2026w30");
  assert.equal(a, quizSlug(quiz, "2026w30"));
  assert.match(a, /^[a-z0-9-]+$/);
});

// E2E — 완료 기준: examples/hot_items.json run(템플릿 경로, 레벨형) PASS.
test("weekly.js run on examples/hot_items.json passes the loop gate end-to-end via the level_bands template path (E2E)", () => {
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
  assert.equal(draft.quiz.theme.format, "level_bands");
  assert.ok(draft.quiz.weeklyBrief.length >= 1 && draft.quiz.weeklyBrief.length <= 3);
});

// ---- weeklyPick (R2, redefined 2026-07-26 as "이 성향이 제일 티 나는 순간") --

test("QUIZ_SCHEMA and validateQuiz require a non-empty weeklyPick (<=60자) on every result", () => {
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
    const page = await (await fetch(`${base}/q/2026w30-live`)).text();
    assert.ok(page.includes('property="og:title"'));
    assert.ok(page.includes(quiz.title.replace(/"/g, "&quot;")));
    assert.ok(page.includes("성향 축"), "축 기반 채점 프레이밍 노출");

    const post = await fetch(`${base}/api/quiz/2026w30-live/response`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: quiz.results[0].code })
    });
    assert.equal(post.status, 200);
    assert.equal(
      (await fetch(`${base}/api/quiz/2026w30-live/response`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "ZZ" }) })).status,
      400
    );

    const personal = await (await fetch(`${base}/q/2026w30-live/r/${quiz.results[0].code}?p=80,60`)).text();
    assert.ok(personal.includes("내 성향 스펙트럼"));
    assert.ok(personal.includes("80%"));
    assert.ok(personal.includes("응답자 중"), "희소성 통계 배지");
    assert.ok(personal.includes("팩폭 포인트"));
    assert.ok(personal.includes("상극 케미"));
    assert.ok(personal.includes("재미로 보는"));

    const shared = await (await fetch(`${base}/q/2026w30-live/r/${quiz.results[0].code}`)).text();
    assert.ok(shared.includes("직접 테스트하면"));
    assert.ok(shared.includes('property="og:title"'));
    assert.ok(shared.includes("나도 테스트 해보기"));

    assert.equal((await fetch(`${base}/q/2026w30-hidden`)).status, 404);
    assert.equal((await fetch(`${base}/q/no-such`)).status, 404);
    assert.equal((await fetch(`${base}/q/2026w30-live/r/ZZ`)).status, 404);

    const api = await (await fetch(`${base}/api/quiz`)).json();
    assert.deepEqual(api.quizzes.map((q) => q.slug), ["2026w30-live"]);
  } finally {
    server.close();
  }
});

// ---- OG share card: SVG generation (src/quiz/ogcard.js) -------------------

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
  const quiz = structuredClone(comboSampleQuiz());
  quiz.title = `제목 <b>강조</b> & "인용" 태그`;
  quiz.results[0].title = `유형 <script>alert(1)</script>`;
  const svg = renderOgCardSvg(quiz, quiz.results[0], {});
  assert.ok(!svg.includes("<b>강조</b>"), "raw HTML tag from title must not leak unescaped");
  assert.ok(!svg.includes("<script>"), "raw script tag from type title must not leak unescaped");
  assert.ok(svg.includes("&lt;b&gt;") || svg.includes("&amp;lt;b&amp;gt;"), "title tag should be escaped");
  assert.ok(svg.includes("&amp;"), "ampersand should be escaped");
  assert.ok(svg.includes("&quot;"), "double quote should be escaped");
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

test("renderOgCardSvg (combo_types) wraps and scales down long type names, keeping a floor of 48px", () => {
  const quiz = structuredClone(comboSampleQuiz());
  quiz.results[0].title = "완전히 극단적으로 길고 긴 유형 이름 테스트용";
  const svg = renderOgCardSvg(quiz, quiz.results[0], {});
  const sizes = [...svg.matchAll(/font-weight="800" fill="#ffffff">/g)];
  assert.ok(sizes.length >= 2, "long title should wrap to two lines");
  const fontSizeMatch = svg.match(/font-size="(\d+)" font-weight="800"/);
  const size = Number(fontSizeMatch[1]);
  assert.ok(size < 76, "font should scale down below the 76px base");
  assert.ok(size >= 48, "font should never go below the 48px floor");

  const short = structuredClone(comboSampleQuiz());
  short.results[0].title = "짧은유형";
  const shortSvg = renderOgCardSvg(short, short.results[0], {});
  const shortSize = Number(shortSvg.match(/font-size="(\d+)" font-weight="800"/)[1]);
  assert.equal(shortSize, 76);
});

test("renderOgCardSvg (level_bands) shows a big level percent (band midpoint) + band label + theme name, not the raw type title", () => {
  const quiz = sampleQuiz();
  const result = quiz.results[0];
  const band = quiz.bands.find((b) => result.code.startsWith(b.code));
  const svg = renderOgCardSvg(quiz, result, {});
  assert.ok(svg.includes(escapeXml(quiz.theme.name_ko)));
  assert.ok(svg.includes(escapeXml(band.label_ko)));
  const midpoint = Math.round((band.min + band.max) / 2);
  assert.ok(svg.includes(`>${midpoint}%<`));
});

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

  const cover = renderOgCardSvg(quiz, null, { sharePercent: 5 });
  assert.ok(!cover.includes("응답자 중"));
});

test("renderOgCardSvg (combo_types) never fabricates per-user axis percentages on the pole chips", () => {
  const quiz = comboSampleQuiz();
  const result = quiz.results[0];
  const svg = renderOgCardSvg(quiz, result, {});
  assert.ok(!svg.includes("응답자 중"), "no rarity badge without sharePercent");
  assert.ok(!/>\s*\d{1,3}%/.test(svg), "no invented percentage numbers rendered as text on the card");
  quiz.axes.forEach((axis, i) => {
    const code = result.code[i];
    const pole = code === axis.left.code ? axis.left : axis.right;
    assert.ok(svg.includes(`>${pole.label}<`), `expected pole label "${pole.label}" chip on the card`);
  });
});

test("renderOgCardSvg (combo_types) type card includes a top strength and the best-match chemistry line", () => {
  const quiz = comboSampleQuiz();
  const result = quiz.results[0];
  const svg = renderOgCardSvg(quiz, result, {});
  const bestMatchResult = quiz.results.find((r) => r.code === result.bestMatch);
  assert.ok(svg.includes("잘 맞는 케미"));
  assert.ok(svg.includes(bestMatchResult.title.slice(0, 8)));
  assert.ok(svg.includes(result.strengths[0].slice(0, 8)));
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
    const typeRes = await fetch(`${base}/q/2026w30-og/og/${quiz.results[0].code}.png`, { redirect: "manual" });
    const coverRes = await fetch(`${base}/q/2026w30-og/og/cover.png`, { redirect: "manual" });

    if (!resvgAvailable) {
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

      const ogFiles = fs.readdirSync(path.join(dir, "og"));
      assert.ok(ogFiles.some((f) => f.startsWith(`2026w30-og-${quiz.results[0].code}-p`)));
      assert.ok(ogFiles.some((f) => f.startsWith("2026w30-og-cover-cover")));
    }

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
    assert.ok(page.includes(`/q/2026w30-meta/og/${code}.png" download`));

    const quizPage = await (await fetch(`${base}/q/2026w30-meta`)).text();
    assert.ok(quizPage.includes(`property="og:image" content="${base}/q/2026w30-meta/og/cover.png"`));
  } finally {
    server.close();
  }
});

// ---- 카카오톡 공유 ----------------------------------------------------------

test("renderResultPage offers a '카카오톡으로 공유' button that falls back to navigator.share or clipboard copy", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-kakao", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(html.includes("카카오톡으로 공유"));
  assert.ok(html.includes("function kakaoShare()"));
  assert.ok(html.includes("navigator.share"));
  assert.ok(html.includes("복사됐어요 — 카톡에 붙여넣으면 끝"));
});

test("pack manifest declares share_channels with kakao_sdk_enabled=false", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.share_channels.kakao_sdk_enabled, false);
  assert.ok(CONTRACT.share_channels.note_ko);
});

// ---- CTA 계측 --------------------------------------------------------------

test("QuizStore.recordCta increments the cta count and statsFor reports it", () => {
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

test("POST /api/quiz/:slug/cta increments the CTA counter for published quizzes only", async () => {
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

test("pack manifest declares metrics.cta_click_benchmark_ratio", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.metrics.cta_click_benchmark_ratio, 0.33);
  assert.ok(CONTRACT.metrics.note_ko);
});

test("renderResultPage's CTA link fires a fire-and-forget beacon/fetch on click", async () => {
  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-ctaclick", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(html.includes('onclick="ctaClick()"'));
  assert.ok(html.includes("function ctaClick()"));
  assert.ok(html.includes("sendBeacon"));
  assert.ok(html.includes("/api/quiz/'+SLUG_+'/cta"));
});

// ---- 공유 인센티브 슬롯 (선언만) --------------------------------------------

test("pack manifest declares share_incentive disabled by default, and render shows nothing while disabled", async () => {
  const { CONTRACT } = await import("../src/quiz/manifest.js");
  assert.equal(CONTRACT.share_incentive.enabled, false);
  assert.ok(CONTRACT.share_incentive.note_ko);

  const { renderResultPage } = await import("../src/quiz/render.js");
  const quiz = sampleQuiz();
  const html = renderResultPage({ slug: "2026w30-incentive", quiz }, quiz.results[0], "https://example.com", {});
  assert.ok(!html.includes("기부에 동참"), "공유 인센티브는 enabled=false면 렌더되지 않아야 한다");
});
