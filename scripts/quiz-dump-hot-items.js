#!/usr/bin/env node
// Weekly quiz pipeline — step 1 of 2 (see quiz-weekly-cron.sh for step 2).
//
// Collects real hot items from the live feed pipeline (src/feed) and dumps
// them in the item shape src/quiz/topics.js's pickWeeklyTopics expects:
//   { title, url, source(sourceId), sourceLabel?, score, commentCount,
//     publishedAt, adult? }
//
// This deliberately reuses src/feed's own registry + fetcher + normalizer
// pipeline (loadRegistry/buildSources from registry.js, makeFetcher from
// fetchers.js, collect/normalizeItem from content.js) instead of
// re-implementing collection here, so this script automatically tracks
// whatever sources/adapters src/feed ships — it never hardcodes a source
// list or a fetch strategy of its own.
//
// Gating mirrors src/feed/server.js's FEED_LIVE path exactly (see that
// file's `live`/`sources` construction), with one deliberate difference:
// seed/FEED_DEV sources are ALWAYS excluded here (seed: false), regardless
// of the FEED_DEV env var — this dump is real-data-only, never the bundled
// offline demo dataset.
//
// Usage:
//   node scripts/quiz-dump-hot-items.js [outPath]
//   (default outPath: data/quiz/hot_items-<weekLabel>.json, weekLabel from
//   src/quiz/weekly.js so the filename lines up with the run this feeds)
//
// Failure handling: each source's fetch() already runs inside its own
// try/catch via Promise.allSettled (see content.js's collect()) — one dead
// source never blocks the others. A collection-wide summary (counts per
// source, failed sources) is printed to stdout. Zero items collected across
// every source is a hard failure (exit 1) — there is nothing for the
// pipeline's QG0 topic gate to work with.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRegistry, buildSources } from "../src/feed/registry.js";
import { makeFetcher } from "../src/feed/fetchers.js";
import { collect } from "../src/feed/content.js";
import { memoizedTranslator } from "../src/feed/translate.js";
import { googleFreeTranslator } from "../src/feed/translator.js";
import { weekLabel } from "../src/quiz/weekly.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Project a normalized feed item down to exactly the fields
// pickWeeklyTopics/topics.js reads. Kept explicit (rather than dumping the
// full normalizeItem shape) so a future normalizeItem field addition can't
// silently leak unrelated internals into this dump file, and so the output
// always matches examples/hot_items.json's existing shape.
function toQuizItem(item) {
  return {
    title: item.title,
    url: item.url,
    source: item.source,
    sourceLabel: item.sourceLabel || null,
    score: item.score,
    commentCount: item.commentCount,
    publishedAt: item.publishedAt,
    adult: item.adult === true
  };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file); // atomic on the same filesystem — no half-written dump file
}

async function main() {
  const outArg = process.argv[2];
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(REPO_ROOT, "data", "quiz", `hot_items-${weekLabel()}.json`);

  const registry = loadRegistry();

  // Mirrors src/feed/server.js's FEED_LIVE construction:
  //   const live = opts.fetcher || (process.env.FEED_LIVE ? makeFetcher : null);
  //   sources = buildSources(registry, { translate, seed: dev, fetcher: live ? (e) => live(e)() : undefined });
  // This script always runs the live-fetcher branch (that's its entire job),
  // and always forces seed:false — never gated behind FEED_LIVE/FEED_DEV env
  // vars, because a cron dump has no reason to ever fall back to demo data.
  const fetcher = (entry) => makeFetcher(entry)();
  // Same optional overseas-translation wiring as server.js: only actually
  // calls the free translate endpoint when FEED_TRANSLATE=1 is set; off by
  // default, matching production's default-safe behavior.
  const translate = {
    targetLang: "ko",
    translateFn: process.env.FEED_TRANSLATE ? memoizedTranslator(googleFreeTranslator()) : null
  };
  const sources = buildSources(registry, { translate, seed: false, fetcher });

  console.log(`[quiz-dump] ${sources.length}개 실데이터 소스에서 1회 수집 시작...`);

  const { items, errors } = await collect(sources, {});

  const bySource = {};
  for (const item of items) {
    const key = item.source || "unknown";
    bySource[key] = (bySource[key] || 0) + 1;
  }

  console.log("[quiz-dump] 소스별 수집 건수:");
  for (const [src, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${src}: ${count}건`);
  }
  if (errors.length) {
    console.log(`[quiz-dump] 실패한 소스 ${errors.length}건 (건너뜀):`);
    for (const e of errors) console.log(`  - ${e.source}: ${e.error}`);
  }

  if (items.length === 0) {
    console.error("[quiz-dump] 수집된 항목이 0건이에요 — 중단.");
    process.exit(1);
  }

  const dump = items.map(toQuizItem);
  writeAtomic(outPath, JSON.stringify(dump, null, 2));
  console.log(`[quiz-dump] 총 ${dump.length}건 저장 완료 → ${outPath}`);
}

main().catch((err) => {
  console.error(`[quiz-dump] 실패: ${err.message}`);
  process.exit(1);
});
