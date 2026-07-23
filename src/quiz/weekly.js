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
import { QuizStore } from "./store.js";

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

  const topics = pickWeeklyTopics(items, { count: opts.topicCount || 5, now: opts.now });
  if (topics.length === 0) throw new Error("브랜드 세이프한 핫토픽이 없어요.");

  const { quiz, via } = await generateQuiz(topics, { ...opts, weekLabel: label });
  const slug = quizSlug(quiz, label);

  const draft = store.saveDraft(slug, quiz, {
    createdAt: opts.now ? new Date(opts.now).toISOString() : new Date().toISOString(),
    week: label,
    via,
    topics
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
