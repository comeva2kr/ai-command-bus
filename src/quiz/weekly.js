// Weekly pipeline CLI: hot items → topic pick → AI quiz draft → approval gate.
//
//   node src/quiz/weekly.js prompt <items.json> [--feedback <reasons.json>]
//     Claude Code 예약 세션용: QG0 통과 토픽 + buildPrompt()의 생성 프롬프트를
//     그대로 stdout에 출력한다. 세션이 그 프롬프트로 퀴즈 JSON을 생성한다.
//     --feedback은 이전 반려 사유(JSON 문자열 배열 파일)를 프롬프트에 재주입.
//
//   node src/quiz/weekly.js submit <quiz.json> <items.json> [--attempt <n>] [--reasons-out <path>]
//     세션이 생성한 퀴즈 JSON을 기존 게이트 루프와 동일한 계약으로 처리한다:
//     PASS → 초안 저장(via: "claude-code") + 발행 작업을 decision_queue로
//     라우팅, exit 0. PASS 아니면 반려 사유를 stderr + reasons 파일로 남기고
//     exit 2 — 세션이 그 파일을 --feedback으로 되먹여 재생성한다(예산은
//     매니페스트 retry_budget).
//
//   node src/quiz/weekly.js run <items.json>              # (수동/테스트용) API키
//     또는 템플릿으로 자체 생성 + 승인 대기열 등록 — 신규 정본 경로는 위
//     prompt/submit 왕복이고, run은 API 키 보유 환경의 수동 실행·테스트용으로
//     존치한다.
//   node src/quiz/weekly.js approve <slug>                 # 사람 승인 → 발행
//   node src/quiz/weekly.js queue                          # 승인 대기 목록
//
// run/submit 모두 절대 스스로 발행하지 않는다: publish 작업을 routeTask()에
// 태워 decision_queue로 보내고 (제목의 "publish"가 승인 규칙에 걸림), 사람이
// approve를 실행해야 published/로 넘어간다 — 리포 안전 규칙 그대로.

import fs from "node:fs";
import path from "node:path";

import { routeTask } from "../router.js";
import { pickWeeklyTopics } from "./topics.js";
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

export async function runWeekly(items, opts = {}) {
  const store = opts.store || new QuizStore(opts);
  const label = opts.weekLabel || weekLabel(opts.now ? new Date(opts.now) : new Date());

  const topics = pickWeeklyTopics(items, { count: opts.topicCount, now: opts.now });
  if (topics.length === 0) throw new Error("브랜드 세이프한 핫토픽이 없어요."); // QG0 토픽 게이트

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
    ({ quiz, via } = await generateQuiz(topics, { ...opts, weekLabel: label, feedback }));
    gate = runGates(quiz);
    gateHistory.push({ attempt, via, decision: gate.decision, pass: gate.pass, failures: gate.failures });
    if (gate.pass) break;
    feedback = gate.reasons; // "[게이트ID] 사유" 형식 (retry_policy.feedback_format)
    if (via === "template") break; // 결정적 폴백은 재시도해도 같은 결과
  }
  if (!gate.pass) {
    // 예산 소진은 조용한 드롭이 아니라 fail-loud: 판정과 [게이트ID] 사유 전체를
    // 실어 중단하고 사람이 토픽 교체를 판단한다 (retry_policy.on_exhaustion).
    const err = new Error(
      `퀴즈가 루프게이트를 통과하지 못했어요 (${gateHistory.length}회 시도, 판정 ${gate.decision}):\n` +
        gate.reasons.map((r) => `  ${r}`).join("\n")
    );
    err.decision = gate.decision;
    err.reasons = gate.reasons;
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
    topics,
    gate: { decision: gate.decision, attempts: gateHistory.length, history: gateHistory }
  });

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

  return { draft, publishTask, topics, via };
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
      console.error("Usage: node src/quiz/weekly.js prompt <hot_items.json> [--feedback <reasons.json>]");
      process.exit(1);
    }
    const items = JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
    const label = weekLabel();
    const topics = pickWeeklyTopics(items, {});
    if (topics.length === 0) throw new Error("브랜드 세이프한 핫토픽이 없어요."); // QG0 토픽 게이트

    let feedback = null;
    if (opts.feedback) {
      feedback = JSON.parse(fs.readFileSync(path.resolve(opts.feedback), "utf8"));
    }

    const prompt = buildPrompt(topics, { weekLabel: label, feedback });

    console.error(`[quiz] 이번 주(${label}) 토픽 ${topics.length}건:`);
    for (const t of topics) console.error(`  - ${t.title} (${t.source}, hot ${t.score})`);
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
    const items = JSON.parse(fs.readFileSync(path.resolve(itemsArg), "utf8"));
    const attempt = Number(opts.attempt) || 1;
    const reasonsOutPath = opts["reasons-out"]
      ? path.resolve(opts["reasons-out"])
      : path.join(store.dir, "last_reject_reasons.json");

    const label = weekLabel();
    const topics = pickWeeklyTopics(items, {});
    const gate = runGates(quiz);
    const via = "claude-code";

    if (!gate.pass) {
      console.error(`[quiz] 게이트 반려 (판정 ${gate.decision}, 시도 ${attempt}회):`);
      for (const reason of gate.reasons) console.error(reason);
      writeAtomic(reasonsOutPath, JSON.stringify(gate.reasons, null, 2));
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
      topics,
      gate: {
        decision: gate.decision,
        attempts: attempt,
        history: [{ attempt, via, decision: gate.decision, pass: gate.pass, failures: gate.failures }]
      }
    });

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
    console.log(`[quiz] 이번 주 토픽 ${topics.length}건:`);
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
    "Usage: node src/quiz/weekly.js [prompt <items.json> [--feedback <reasons.json>] | " +
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
