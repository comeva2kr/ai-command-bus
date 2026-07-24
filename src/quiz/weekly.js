// Weekly pipeline CLI: hot items → topic pick → AI quiz draft → approval gate.
//
//   node src/quiz/weekly.js run examples/hot_items.json   # 초안 생성 + 승인 대기열 등록
//   node src/quiz/weekly.js approve <slug>                # 사람 승인 → 발행
//   node src/quiz/weekly.js queue                         # 승인 대기 목록
//
// run은 절대 스스로 발행하지 않는다: publish 작업을 routeTask()에 태워
// decision_queue로 보내고 (제목의 "publish"가 승인 규칙에 걸림), 사람이
// approve를 실행해야 published/로 넘어간다 — 리포 안전 규칙 그대로.

import fs from "node:fs";
import path from "node:path";

import { routeTask } from "../router.js";
import { pickWeeklyTopics } from "./topics.js";
import { generateQuiz, quizSlug } from "./generate.js";
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

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const store = new QuizStore();

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

  console.error("Usage: node src/quiz/weekly.js [run <items.json> | approve <slug> | queue]");
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("weekly.js")) {
  main().catch((err) => {
    console.error(`[quiz] ${err.message}`);
    process.exit(1);
  });
}
