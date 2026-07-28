// Weekly pipeline CLI: theme pool + trend signals → AI quiz draft → approval gate.
//
// David 확정 방향(2026-07-26): "테스트 하나 = 성향 하나"가 주인이다. 핫아이템
// 수집 파이프라인은 폐기가 아니라 유행 테스트 신호 탐지용으로 전환됐다 —
// 이 CLI는 더 이상 "이번 주 화제 소재"를 뽑아 퀴즈에 박아넣지 않는다. 대신
// 테마 풀(매니페스트 pack_contract.theme.pool)에서 최근 no_repeat_weeks 안에
// 쓰지 않은 테마 후보 + 유행 테스트 신호(참고용)를 buildPrompt에 넘기고,
// [0단계]에서 생성자가 테마 1개를 직접 고른다.
//
//   node src/quiz/weekly.js prompt <items.json> [--feedback <reasons.json>] [--theme <id>]
//     Claude Code 예약 세션용: 유행 테스트 신호 + 테마 후보 풀 + buildPrompt()의
//     생성 프롬프트를 stdout에 출력한다. --theme로 테마를 강제 지정하면 선정
//     절차 없이 그 테마로 바로 해부에 들어간다.
//
//   node src/quiz/weekly.js submit <quiz.json> <items.json> [--attempt <n>] [--reasons-out <path>]
//     세션이 생성한 퀴즈 JSON을 게이트 루프 + 테마 재사용(history) 검사를
//     통과시킨다: PASS → 초안 저장(via: "claude-code") + 발행 작업을
//     decision_queue로 라우팅 + 테마 이력 기록, exit 0. 아니면 반려 사유를
//     stderr + reasons 파일로 남기고 exit 2.
//
//   node src/quiz/weekly.js run <items.json>              # (수동/테스트용) API키
//     또는 템플릿으로 자체 생성 + 승인 대기열 등록.
//   node src/quiz/weekly.js approve <slug>                 # 사람 승인 → 발행
//   node src/quiz/weekly.js queue                          # 승인 대기 목록
//
// run/submit 모두 절대 스스로 발행하지 않는다: publish 작업을 routeTask()에
// 태워 decision_queue로 보내고, 사람이 approve를 실행해야 published/로
// 넘어간다 — 리포 안전 규칙 그대로.

import fs from "node:fs";
import path from "node:path";

import { routeTask } from "../router.js";
import { pickTestTrendSignals } from "./topics.js";
import { generateQuiz, quizSlug, buildPrompt } from "./generate.js";
import { runGates } from "./gates.js";
import { QuizStore } from "./store.js";
import { CONTRACT } from "./manifest.js";

// ISO week label like "2026w30" — stable across a week so re-runs collide
// visibly instead of silently stacking near-duplicate drafts.
export function weekLabel(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}w${String(week).padStart(2, "0")}`;
}

// "2026w30" → 대략적인 주 순번(연도*52+주) — theme.history의 no_repeat_weeks
// 거리 비교용. 연 경계에서 오차가 있을 수 있지만 8주 간격 체크엔 충분하다.
function weekOrdinal(label) {
  const m = /^(\d{4})w(\d{1,2})$/.exec(String(label || ""));
  if (!m) return 0;
  return Number(m[1]) * 52 + Number(m[2]);
}

// --- 테마 이력 (history_file) ------------------------------------------------
// 선언 원본은 매니페스트 pack_contract.theme.history_file/no_repeat_weeks.
// 경로는 store.dir 기준으로 해석한다 — 파일 키의 "data/quiz/" 접두는 기본
// dir(cwd/data/quiz)일 때의 예시 경로일 뿐, 커스텀 dir(테스트 등)에서는
// store.dir이 곧 그 루트다 (store.js의 stats/drafts 등과 동일한 규약).
function themeHistoryPath(store) {
  return path.join(store.dir, "theme_history.json");
}

function readThemeHistory(store) {
  try {
    return JSON.parse(fs.readFileSync(themeHistoryPath(store), "utf8"));
  } catch {
    return {};
  }
}

// 매니페스트 no_repeat_weeks 안에 다른 회차로 이미 쓰인 테마인지 확인한다.
// 같은 회차 재실행(run_binding 멱등성)은 충돌로 보지 않는다 — 그 경우는
// 덮어쓰기일 뿐 재사용이 아니다.
function checkThemeHistory(store, themeId, currentWeekLabel) {
  if (!themeId) return { ok: true };
  const history = readThemeHistory(store);
  const lastWeek = history[themeId];
  if (!lastWeek || lastWeek === currentWeekLabel) return { ok: true };
  const noRepeatWeeks = CONTRACT.theme.no_repeat_weeks || 0;
  const gap = weekOrdinal(currentWeekLabel) - weekOrdinal(lastWeek);
  if (gap >= 0 && gap < noRepeatWeeks) {
    return {
      ok: false,
      reason: `[테마 이력] 테마 "${themeId}"는 ${lastWeek}에 이미 썼다 — 최근 ${noRepeatWeeks}주 이내 재사용은 반려. 다른 테마를 고르거나 --theme로 새 테마를 지정하라.`
    };
  }
  return { ok: true };
}

function recordThemeHistory(store, themeId, currentWeekLabel) {
  if (!themeId) return;
  const history = readThemeHistory(store);
  history[themeId] = currentWeekLabel;
  writeAtomic(themeHistoryPath(store), JSON.stringify(history, null, 2));
}

// 이번 회차에 제안할 테마 후보 풀: 최근 no_repeat_weeks 안에 다른 회차로
// 쓰인 테마는 제외한다. 전부 제외돼 후보가 하나도 안 남으면(풀이 작거나
// no_repeat_weeks가 큰 경우) 실패 대신 전체 풀로 완화한다 — 다른 캡 완화
// 패턴(topics.js pickWeeklyTopics)과 동일한 원칙.
function eligibleThemePool(store, currentWeekLabel) {
  const pool = CONTRACT.theme.pool;
  const eligible = pool.filter((t) => checkThemeHistory(store, t.id, currentWeekLabel).ok);
  return eligible.length ? eligible : pool;
}

export async function runWeekly(items, opts = {}) {
  const store = opts.store || new QuizStore(opts);
  const label = opts.weekLabel || weekLabel(opts.now ? new Date(opts.now) : new Date());

  const trendSignals = pickTestTrendSignals(items, { now: opts.now });
  const forcedTheme = opts.theme ? CONTRACT.theme.pool.find((t) => t.id === opts.theme) : null;
  const themePool = forcedTheme ? [forcedTheme] : eligibleThemePool(store, label);

  // 루프게이트: 생성 → 게이트 검사 → 실패 사유를 피드백으로 재생성.
  // 모든 게이트(QG1~QG4)를 통과한 퀴즈만 초안이 될 수 있다. 재시도 예산은
  // 매니페스트 선언(pack_contract.retry_budget)이 원본이다 (docs/quiz-loopgate.md).
  const maxAttempts = opts.maxAttempts || CONTRACT.retry_budget;
  let quiz = null;
  let via = null;
  let gate = null;
  let feedback = null;
  const gateHistory = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ({ quiz, via } = await generateQuiz({ ...opts, weekLabel: label, trendSignals, themePool, forcedTheme, feedback }));
    gate = runGates(quiz);
    const historyCheck = checkThemeHistory(store, quiz.theme && quiz.theme.id, label);
    const bothPass = gate.pass && historyCheck.ok;
    const reasons = gate.pass ? (historyCheck.ok ? [] : [historyCheck.reason]) : gate.reasons;
    gateHistory.push({ attempt, via, decision: bothPass ? "PASS" : gate.pass ? "BLOCK" : gate.decision, pass: bothPass, failures: gate.failures });
    if (bothPass) break;
    feedback = reasons; // "[게이트ID] 사유" 형식 (retry_policy.feedback_format)
    // 결정적 폴백(template)은 재시도해도 같은 결과라 즉시 중단 — 게이트
    // 실패면 게이트 사유로, 테마 이력 충돌이면 사람이 이력을 정리하거나
    // --theme로 다른 테마를 지정해야 한다는 뜻이다.
    if (via === "template") break;
  }
  const historyCheckFinal = checkThemeHistory(store, quiz.theme && quiz.theme.id, label);
  if (!gate.pass || !historyCheckFinal.ok) {
    // 예산 소진은 조용한 드롭이 아니라 fail-loud: 판정과 사유 전체를 실어
    // 중단하고 사람이 테마 교체를 판단한다 (retry_policy.on_exhaustion).
    const decision = gate.pass ? "BLOCK" : gate.decision;
    const reasons = gate.pass ? [historyCheckFinal.reason] : gate.reasons;
    const err = new Error(
      `퀴즈가 루프게이트를 통과하지 못했어요 (${gateHistory.length}회 시도, 판정 ${decision}):\n` + reasons.map((r) => `  ${r}`).join("\n")
    );
    err.decision = decision;
    err.reasons = reasons;
    throw err;
  }

  const slug = quizSlug(quiz, label);
  // 회차 키: 같은 회차·같은 콘텐츠 재실행은 동일 slug에 원자적 덮어쓰기로
  // 수렴해 중복 산출이 없다 (run_binding).
  const runId = `${label}-${slug}`;

  const draft = store.saveDraft(slug, quiz, {
    createdAt: opts.now ? new Date(opts.now).toISOString() : new Date().toISOString(),
    week: label,
    run: { id: runId, week: label },
    via,
    topics: trendSignals,
    gate: { decision: gate.decision, attempts: gateHistory.length, history: gateHistory }
  });
  recordThemeHistory(store, quiz.theme && quiz.theme.id, label);

  // 발행은 승인 게이트를 지나야 한다. routeTask가 제목의 "publish"를 보고
  // decision_queue로 보낸다 (requiresHumanApproval도 명시).
  const publishTask = routeTask({
    id: `quiz-publish-${slug}`,
    title: `publish quiz: ${quiz.title}`,
    status: "ready",
    risk: "high",
    requiresHumanApproval: true,
    slug
  });

  return { draft, publishTask, topics: trendSignals, via };
}

const QUEUE_HINT = "승인: node src/quiz/weekly.js approve <slug>";

// 최소 인자 파서: "--key value" 옵션과 위치 인자를 분리한다. 이 CLI가 받는
// 옵션은 전부 값을 동반하므로(플래그형 없음) 이 정도로 충분하다.
function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      opts[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

// 원자적 쓰기 (tmp→rename) — store.js/quiz-dump-hot-items.js와 같은 패턴.
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, opts } = parseArgs(rest);
  const arg = positional[0];
  const store = new QuizStore();

  if (cmd === "prompt") {
    if (!arg) {
      console.error("Usage: node src/quiz/weekly.js prompt <hot_items.json> [--feedback <reasons.json>] [--theme <id>]");
      process.exit(1);
    }
    const items = JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
    const label = weekLabel();
    const trendSignals = pickTestTrendSignals(items, {});
    let forcedTheme = null;
    if (opts.theme) {
      forcedTheme = CONTRACT.theme.pool.find((t) => t.id === opts.theme);
      if (!forcedTheme) {
        console.error(`[quiz] --theme "${opts.theme}"는 테마 풀에 없어요. 사용 가능: ${CONTRACT.theme.pool.map((t) => t.id).join(", ")}`);
        process.exit(1);
      }
    }
    const themePool = forcedTheme ? [forcedTheme] : eligibleThemePool(store, label);

    let feedback = null;
    if (opts.feedback) {
      feedback = JSON.parse(fs.readFileSync(path.resolve(opts.feedback), "utf8"));
    }

    const prompt = buildPrompt({ weekLabel: label, feedback, trendSignals, themePool, forcedTheme });

    if (forcedTheme) {
      console.error(`[quiz] 테마 강제 지정: "${forcedTheme.name_ko}" (${forcedTheme.id})`);
    } else {
      console.error(`[quiz] 이번 주(${label}) 테마 후보 풀 ${themePool.length}개(최근 사용 테마 제외됨) — 최종 선택은 생성자가 [0단계]에서 한다:`);
      for (const t of themePool) console.error(`  - ${t.id}: "${t.name_ko}"`);
    }
    if (trendSignals.length) {
      console.error(`[quiz] 유행 테스트 신호 ${trendSignals.length}건(참고용):`);
      for (const t of trendSignals) console.error(`  - ${t.title} (${t.source}, hot ${t.score})`);
    }
    if (feedback && feedback.length) {
      console.error(`[quiz] 이전 반려 사유 ${feedback.length}건을 프롬프트에 재주입했어요.`);
    }
    console.error("[quiz] 아래 프롬프트로 퀴즈 JSON을 생성한 뒤 submit으로 제출하세요:");
    console.error(`[quiz]   node src/quiz/weekly.js submit <quiz.json> ${arg}`);

    // 프롬프트 자체만 stdout에 — 예약 세션이 그대로 모델 입력으로 재사용.
    console.log(prompt);
    return;
  }

  if (cmd === "submit") {
    const [quizArg, itemsArg] = positional;
    if (!quizArg || !itemsArg) {
      console.error("Usage: node src/quiz/weekly.js submit <quiz.json> <hot_items.json> [--attempt <n>] [--reasons-out <path>]");
      process.exit(1);
    }
    const quiz = JSON.parse(fs.readFileSync(path.resolve(quizArg), "utf8"));
    const attempt = Number(opts.attempt) || 1;
    const reasonsOutPath = opts["reasons-out"]
      ? path.resolve(opts["reasons-out"])
      : path.join(store.dir, "last_reject_reasons.json");

    const label = weekLabel();
    const gate = runGates(quiz);
    const historyCheck = checkThemeHistory(store, quiz.theme && quiz.theme.id, label);
    const via = "claude-code";

    if (!gate.pass || !historyCheck.ok) {
      const reasons = gate.pass ? [historyCheck.reason] : historyCheck.ok ? gate.reasons : [...gate.reasons, historyCheck.reason];
      const decision = gate.pass ? "BLOCK" : gate.decision;
      console.error(`[quiz] 게이트 반려 (판정 ${decision}, 시도 ${attempt}회):`);
      for (const reason of reasons) console.error(reason);
      writeAtomic(reasonsOutPath, JSON.stringify(reasons, null, 2));
      console.error(`[quiz] 반려 사유 저장 → ${reasonsOutPath}`);
      console.error(`[quiz] 재생성: node src/quiz/weekly.js prompt ${itemsArg} --feedback ${reasonsOutPath}`);
      process.exit(2);
    }

    const slug = quizSlug(quiz, label);
    const runId = `${label}-${slug}`;
    const draft = store.saveDraft(slug, quiz, {
      createdAt: new Date().toISOString(),
      week: label,
      run: { id: runId, week: label },
      via,
      gate: {
        decision: gate.decision,
        attempts: attempt,
        history: [{ attempt, via, decision: gate.decision, pass: gate.pass, failures: gate.failures }]
      }
    });
    recordThemeHistory(store, quiz.theme && quiz.theme.id, label);

    const publishTask = routeTask({
      id: `quiz-publish-${slug}`,
      title: `publish quiz: ${quiz.title}`,
      status: "ready",
      risk: "high",
      requiresHumanApproval: true,
      slug
    });

    console.log(`[quiz] 루프게이트 통과 (시도 ${attempt}회, 판정 ${gate.decision})`);
    console.log(`[quiz] 초안 생성 (${via}): "${draft.quiz.title}" → drafts/${draft.slug}.json`);
    console.log(`[quiz] 발행 작업 라우팅: ${publishTask.nextQueue} (${publishTask.reason})`);
    console.log(`[quiz] ${QUEUE_HINT}`);
    return;
  }

  if (cmd === "run") {
    if (!arg) {
      console.error("Usage: node src/quiz/weekly.js run <hot_items.json>");
      process.exit(1);
    }
    const items = JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
    const { draft, publishTask, topics, via } = await runWeekly(items, {});
    console.log(`[quiz] 유행 테스트 신호 ${topics.length}건 감지(참고용) — 채택 테마는 초안의 theme 참고:`);
    for (const t of topics) console.log(`  - ${t.title} (${t.source}, hot ${t.score})`);
    console.log(`[quiz] 루프게이트 통과 (시도 ${draft.gate.attempts}회, 게이트 QG1~QG4 전체, 판정 ${draft.gate.decision})`);
    console.log(`[quiz] 초안 생성 (${via}): "${draft.quiz.title}" → drafts/${draft.slug}.json`);
    console.log(`[quiz] 발행 작업 라우팅: ${publishTask.nextQueue} (${publishTask.reason})`);
    console.log(`[quiz] ${QUEUE_HINT}`);
    return;
  }

  if (cmd === "approve") {
    if (!arg) {
      console.error("Usage: node src/quiz/weekly.js approve <slug>");
      process.exit(1);
    }
    const rec = store.approve(arg);
    console.log(`[quiz] 발행 완료: "${rec.quiz.title}" → /q/${rec.slug}`);
    return;
  }

  if (cmd === "queue" || !cmd) {
    const drafts = store.listDrafts();
    if (drafts.length === 0) return console.log("[quiz] 승인 대기 중인 초안이 없어요.");
    console.log(`[quiz] 승인 대기 ${drafts.length}건 — ${QUEUE_HINT}`);
    for (const d of drafts) console.log(`  - ${d.slug}: "${d.quiz.title}" (${d.via}, ${d.week})`);
    return;
  }

  console.error(
    "Usage: node src/quiz/weekly.js [prompt <items.json> [--feedback <reasons.json>] [--theme <id>] | " +
      "submit <quiz.json> <items.json> [--attempt <n>] [--reasons-out <path>] | " +
      "run <items.json> | approve <slug> | queue]"
  );
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("weekly.js")) {
  main().catch((err) => {
    console.error(`[quiz] ${err.message}`);
    process.exit(1);
  });
}
