#!/usr/bin/env node
// P2-A 오분류율 수동 대조 표본 추출기 (DEVCHG-NOWHOT-20260813-082).
//
// 스냅샷 풀(.nowhot-local/feed-data-pool.json)에서 무작위 N건(기본 50)을 뽑아
// tier·선언·현재 분류·판정 근거를 사람 대조용 마크다운 표로 출력한다.
// 판정은 하지 않는다 — 사람(David/메인 세션)이 제목을 보고 현재 분류가 맞는지
// 대조하는 것이 목적이다(블루프린트 v4 성공지표: 오분류율 무작위 50건 수동 대조).
//
// 사용:  node tools/eval-category-tiers.mjs [poolFile] [--n=50] [--seed=20260813]
// 시드 고정 = 같은 스냅샷에서 같은 표본 — 대조 결과를 재현·추적할 수 있다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  definiteCategory, UNTRAINED_CATEGORIES, MIXED_BEST_FALLBACK,
  AUTO_KEYWORDS, BOARD_CATEGORY_RULES, includesCategoryKeyword
} from "../src/feed/classify.js";
import { categoryDictionaryHits, isTranslatedTitle } from "../src/feed/category-policy.js";
import { classifyTopics } from "../src/feed/topics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const poolFile = args.find((a) => !a.startsWith("--"))
  || path.join(__dirname, "..", ".nowhot-local", "feed-data-pool.json");
const N = Number((args.find((a) => a.startsWith("--n=")) || "--n=50").slice(4));
const seed = Number((args.find((a) => a.startsWith("--seed=")) || "--seed=20260813").slice(7));

// mulberry32 — 시드 고정 결정적 난수 (npm 의존성 0 원칙)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const registry = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "src", "feed", "communities.json"), "utf8")).communities;
const bySource = new Map(registry.map((c) => [c.id, c]));

const pool = JSON.parse(fs.readFileSync(poolFile, "utf8"));
const rows = (pool.rows || []).map((r) => r.item).filter((it) => it && it.title);
if (!rows.length) {
  console.error(`풀이 비어 있다: ${poolFile}`);
  process.exit(1);
}

// 시드 셔플(Fisher–Yates) 후 앞 N건
const rand = mulberry32(seed);
const shuffled = [...rows];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, N);

function basisOf(it, src) {
  const declared = src ? src.category : "?";
  const parts = [];
  if (it.category === declared) parts.push("선언 유지");
  else parts.push(`선언 ${declared}→${it.category}`);
  if (it.categoryCorrection) {
    parts.push(`교정기록 ${it.categoryCorrection.rule}(${(it.categoryCorrection.hits || []).join("·")})`);
  }
  const definite = definiteCategory({ title: it.title, url: it.url, sourceId: it.source });
  if (definite) {
    const boardRule = BOARD_CATEGORY_RULES.some((r) => r.source === it.source && it.url && r.pattern.test(it.url));
    const words = definite === "auto"
      ? AUTO_KEYWORDS.filter((w) => includesCategoryKeyword(String(it.title).toLowerCase(), w))
      : categoryDictionaryHits(definite, it.title);
    parts.push(`사전확정 ${definite}${boardRule ? "(게시판URL)" : `[${words.join("·")}]`}`);
  }
  const mixed = MIXED_BEST_FALLBACK.get(it.source);
  if (mixed) parts.push(`혼합폴백(${mixed.registryCategory}→${mixed.fallback})`);
  else if (src && src.mixed) parts.push("혼합중립(humor)");
  if (UNTRAINED_CATEGORIES.has(it.category)) parts.push("UNTRAINED 보호");
  if (isTranslatedTitle(it)) parts.push("번역제목");
  const topics = classifyTopics({ title: it.title, url: it.url, sourceId: it.source });
  if (topics.length) parts.push(`토픽 ${topics.join("·")}`);
  return parts.join(" · ");
}

const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const stamp = pool.savedAt ? new Date(pool.savedAt).toISOString() : "?";
console.log(`# 오분류 수동 대조 표본 — ${N}건 / 풀 ${rows.length}건 (seed=${seed}, 스냅샷 ${stamp})`);
console.log();
console.log("| # | tier | 소스 | 현재 분류 | 제목 | 판정 근거 |");
console.log("|---|------|------|-----------|------|-----------|");
sample.forEach((it, i) => {
  const src = bySource.get(it.source);
  const tier = src ? src.sourceTier : "?";
  console.log(`| ${i + 1} | ${tier} | ${esc(it.source)} | ${esc(it.category)} | ${esc(it.title).slice(0, 60)} | ${esc(basisOf(it, src))} |`);
});
console.log();
console.log("판정 근거 읽는 법: '선언 유지'=소스 등록 카테고리 그대로, '선언 a→b'=현재값이 선언과 다름,");
console.log("'사전확정'=제목 확정 사전이 가리키는 값[맞은 낱말], '혼합폴백/혼합중립'=종합게시판 규칙,");
console.log("'UNTRAINED 보호'=신설 카테고리 선언 보호, '번역제목'=기계번역 제목(외래어 충돌 주의 대상).");
