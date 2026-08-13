#!/usr/bin/env node
// P3-A shadow 선별 평가 — 스냅샷 풀로 [현행판 top-N] vs [shadow판] 나란히 비교.
//
// 읽기 전용 도구다: 서버·라이브·4100 무접촉, 저장소 파일 무수정. 현행판은
// digest.js buildDigest 실코드(무수정 import)로, shadow판은 shadow-selection.js
// 로 같은 풀에서 병렬 계산한다. now는 풀의 savedAt으로 고정해 재실행 재현성을
// 확보한다(실측 시점의 판 재현).
//
// 사용:
//   node tools/eval-shadow-edition.mjs [pack ...]
//   인자 없으면 business humor science sports (팩: newsy·community·science·sports)
//   FEED_POOL_FILE로 풀 경로 오버라이드 가능.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDigest } from "../src/feed/digest.js";
import { buildEventClusters } from "../src/feed/event-cluster.js";
import {
  SHADOW_PACK_PARAMS, shadowSelectEdition, packIdForArticle, resolveSourceRole
} from "../src/feed/shadow-selection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registry = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "src", "feed", "communities.json"), "utf8")).communities;
const registryById = new Map(registry.map((entry) => [entry.id, entry]));

const poolFile = process.env.FEED_POOL_FILE
  || path.join(__dirname, "..", ".nowhot-local", "feed-data-pool.json");
const pool = JSON.parse(fs.readFileSync(poolFile, "utf8"));
const now = Number(pool.savedAt) || Date.now();

// 풀 순서 = 엔진이 저장한 화제성 순서(buildDigest의 입력 계약). 소스 레지스트리
// 의 sourceRole(nasa=primary 등)을 editorialCandidate로 붙여 현행·shadow 양쪽이
// 같은 역할 정보를 보게 한다(발명 없음 — communities.json 명시값만).
const items = (pool.rows || []).map((row) => row.item).filter((item) => item && item.title)
  .map((item) => {
    const entry = registryById.get(item.source);
    return entry && entry.sourceRole
      ? { ...item, editorialCandidate: { ...(item.editorialCandidate || {}), sourceRole: entry.sourceRole } }
      : item;
  });

// CLI 인자(카테고리명)를 팩 id로 해석.
const CATEGORY_TO_PACK = new Map([
  ["business", "newsy"], ["politics", "newsy"], ["realestate", "newsy"], ["news", "newsy"],
  ["tech", "newsy"], ["auto", "newsy"],
  ["science", "science"], ["sports", "sports"],
  ["humor", "community"], ["life", "community"], ["community", "community"],
  ["culture", "culture"], ["fashion", "culture"], ["art", "culture"], ["gaming", "culture"],
  ["newsy", "newsy"]
]);
const args = process.argv.slice(2);
const packIds = [...new Set((args.length ? args : ["business", "humor", "science", "sports"])
  .map((arg) => CATEGORY_TO_PACK.get(arg) || arg))];

const fmtS = (value) => (Math.round(value * 100) / 100).toFixed(2);
const short = (text, max = 46) => {
  const t = String(text || "").replace(/\|/g, "/");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const repOf = (view) => view.memberArticles[0] || view.reactionArticles[0] || {};

console.log(`# P3-A shadow 선별 평가 — ${new Date(now).toISOString()} (now=풀 savedAt 고정)`);
console.log(`풀: ${poolFile} (items ${items.length}) · 파라미터: SHADOW_PACK_PARAMS v${1}`);
console.log("");

for (const packId of packIds) {
  const pack = SHADOW_PACK_PARAMS.packs[packId];
  if (!pack) { console.log(`알 수 없는 팩: ${packId}`); continue; }

  // ── 현행판: 팩 소속 카테고리의 풀 아이템을 그대로 buildDigest(무수정 실코드)
  const packItems = items.filter((item) => packIdForArticle(item) === packId);
  const current = buildDigest(packItems, { maxIssues: 12 });
  const currentIssues = current.issues || [];
  const currentEventIds = new Set(currentIssues.map((issue) => issue.clusterId));

  // ── shadow판
  const shadow = shadowSelectEdition(items, { packId, now, registry });
  const shadowEventIds = new Set(shadow.selected.map((row) => row.view.event.eventId));

  console.log(`## 팩 ${packId} (${pack.label}) — 창 ${pack.windowHours}h · 가중 h${pack.weights.heat}/i${pack.weights.importance}/c${pack.weights.change} · 캡 ${pack.sourceCap.per}:${pack.sourceCap.max}`);
  console.log(`현행판(buildDigest top-12): ${currentIssues.length}건 · shadow판: ${shadow.selected.length}건${shadow.partialEdition ? " **부분판**" : ""} (게이트 통과 ${shadow.counts.gatePassed}/${shadow.counts.events}, 캡 제외 ${shadow.counts.capExcluded})`);
  console.log("");
  console.log("| # | 현행판 (제목·소스) | shadow판 (제목·소스·S=h/i/c·게이트) |");
  console.log("|---|---|---|");
  const height = Math.max(currentIssues.length, shadow.selected.length);
  for (let index = 0; index < height; index += 1) {
    const cur = currentIssues[index];
    const sh = shadow.selected[index];
    const left = cur
      ? `${short(cur.headline || cur.subject)} · ${(cur.refs && cur.refs[0] && cur.refs[0].sourceLabel) || "?"}${shadowEventIds.has(cur.clusterId) ? "" : " ⟂"}`
      : "";
    const right = sh
      ? `${short(repOf(sh.view).title)} · ${repOf(sh.view).sourceLabel || repOf(sh.view).source} · S=${fmtS(sh.score.S)} (h${fmtS(sh.score.axes.heat.value)}/i${fmtS(sh.score.axes.importance.value)}/c${fmtS(sh.score.axes.change.value)}) · ${sh.gate.passedBy}${currentEventIds.has(sh.view.event.eventId) ? "" : " ↑신규"}`
      : "";
    console.log(`| ${index + 1} | ${left} | ${right} |`);
  }
  console.log("");

  // ── diff: 진입(shadow에만)·탈락(현행에만)
  const entered = shadow.selected.filter((row) => !currentEventIds.has(row.view.event.eventId));
  const droppedIssues = currentIssues.filter((issue) => !shadowEventIds.has(issue.clusterId));
  const exclusionByEventId = new Map();
  for (const row of shadow.excluded.gate) exclusionByEventId.set(row.view.event.eventId, `게이트 탈락: ${row.gate.failures.join(", ")}`);
  for (const row of shadow.excluded.sourceCap) exclusionByEventId.set(row.view.event.eventId, `소스캡: ${row.exclusion}`);
  for (const row of shadow.excluded.belowVolume) exclusionByEventId.set(row.view.event.eventId, `순위 밖(S=${fmtS(row.score.S)})`);

  console.log(`### 진입 (shadow에만) — ${entered.length}건`);
  for (const row of entered) {
    console.log(`- [S=${fmtS(row.score.S)} · ${row.gate.passedBy}] ${short(repOf(row.view).title, 70)} · ${repOf(row.view).sourceLabel || repOf(row.view).source} — 진입 사유: 게이트 통과 + S 순위 내 (h${fmtS(row.score.axes.heat.value)}/i${fmtS(row.score.axes.importance.value)}/c${fmtS(row.score.axes.change.value)})`);
  }
  console.log(`### 탈락 (현행에만) — ${droppedIssues.length}건`);
  for (const issue of droppedIssues) {
    const why = exclusionByEventId.get(issue.clusterId)
      || "shadow 사건 집합에 없음(현행 전용 클러스터 구성 또는 팩 창 밖)";
    console.log(`- ${short(issue.headline || issue.subject, 70)} · ${(issue.refs && issue.refs[0] && issue.refs[0].sourceLabel) || "?"} — ${why}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// 동결 표본 1·2·5·9 처리 결과 (선별 관련 표본 — 블루프린트 v4 동결 픽스처)
// 픽스처 제목·시각은 test/event-cluster-samples.test.js와 동일하게 유지한다.
// ---------------------------------------------------------------------------
const FIXTURE_NOW = Date.parse("2026-08-13T12:00:00+09:00");
const fx = (over) => ({
  id: over.id, title: over.title, url: over.url || `https://example.com/${over.id}`,
  publishedAt: over.publishedAt || "2026-08-13T10:00:00+09:00",
  kind: over.kind || "news", category: over.category || "news",
  source: over.source || "gnews-news", sourceLabel: over.sourceLabel || over.source || "매체",
  ...over
});
const s1 = [
  fx({ id: "s1-hn", title: "DeepSeek V4 Pro 0813", url: "https://news.ycombinator.com/item?id=41000001",
    publishedAt: "2026-08-13T01:10:00+09:00", kind: "community", category: "tech",
    source: "hackernews", sourceLabel: "해커뉴스", score: 907, commentCount: 357 }),
  fx({ id: "s1-yna", title: "딥시크 V4 프로 정식 출시", url: "https://www.yonhapnewstv.co.kr/news/MYH20260813001",
    publishedAt: "2026-08-13T09:30:00+09:00", category: "business", source: "gnews-business", sourceLabel: "연합뉴스TV" })
];
const s2 = [
  fx({ id: "s2-hani", title: "8·13 부동산대책 발표…대출 규제 대폭 강화", publishedAt: "2026-08-13T10:00:00+09:00",
    category: "realestate", source: "hani-rank", sourceLabel: "한겨레" }),
  fx({ id: "s2-chosun", title: "정부 8·13 대책, 다주택자 대출 정조준", publishedAt: "2026-08-13T10:20:00+09:00",
    category: "business", source: "chosunbiz", sourceLabel: "조선비즈" }),
  fx({ id: "s2-mk", title: "8·13 부동산대책에 시장 술렁…대출 문턱 높아진다", publishedAt: "2026-08-13T11:00:00+09:00",
    category: "realestate", source: "mk-realestate", sourceLabel: "매일경제" })
];
const s5 = [
  fx({ id: "s5-hn", title: "Show HN: An SQLite extension for vector search", url: "https://example-blog.dev/sqlite-vec",
    publishedAt: "2026-08-13T07:00:00+09:00", kind: "community", category: "tech",
    source: "hackernews", sourceLabel: "해커뉴스", score: 210, commentCount: 48 }),
  fx({ id: "s5-gk", title: "SQLite 벡터 검색 확장 공개", url: "https://example-blog.dev/sqlite-vec?utm_source=geeknews",
    publishedAt: "2026-08-13T09:00:00+09:00", kind: "community", category: "tech",
    source: "geeknews", sourceLabel: "긱뉴스", score: 12, commentCount: 3 })
];
const s9 = [
  fx({ id: "s9-single", title: "관련 보도 묶음 포착 표본 — 단일 기사 coverage 5", publishedAt: "2026-08-13T10:30:00+09:00",
    category: "news", source: "gnews-news", sourceLabel: "연합뉴스", coverage: 5, relatedCoverage: 5 })
];

console.log("## 동결 표본 1·2·5·9 — shadow 처리 결과");
const fixtureReport = (label, articles, packId, expectNote) => {
  const out = shadowSelectEdition(articles, { packId, now: FIXTURE_NOW, registry });
  const rows = [
    ...out.selected.map((row) => ({ row, verdict: `통과(${row.gate.passedBy}) S=${fmtS(row.score.S)} h${fmtS(row.score.axes.heat.value)}/i${fmtS(row.score.axes.importance.value)}/c${fmtS(row.score.axes.change.value)}` })),
    ...out.excluded.gate.map((row) => ({ row, verdict: `게이트 탈락: ${row.gate.failures.join(", ")}` }))
  ];
  console.log(`- 표본 ${label} → 팩 ${packId}: 사건 ${out.counts.events}건${out.partialEdition ? " (부분판)" : ""}`);
  for (const { row, verdict } of rows) {
    const ev = row.view.event;
    console.log(`  · [${ev.eventId}] 독립그룹 ${ev.counts.independentReportingGroups}·커뮤반응 ${ev.counts.communityReactions} — ${verdict}`);
  }
  console.log(`  ${expectNote}`);
};
fixtureReport("1 (딥시크 한/영 이중 게재)", s1, "newsy",
  "판정 근거: HN은 커뮤 반응 축(heat에만 계수), 언론은 연합뉴스TV 1곳(reported_secondary) — 뉴스 기본 계약 미충족이면 게이트가 정직하게 차단한다.");
fixtureReport("2 (8·13 부동산대책 파편 병합)", s2, "newsy",
  "판정 근거: 파편 3건이 한 사건·독립 운영그룹 3곳 — independent_groups>=2로 통과하고 근거는 sourceEvidence에 전부 보존된다.");
fixtureReport("5 (geeknews→HN 재유통)", s5, "community",
  "판정 근거: canonicalUrl 강한 결합으로 한 사건·독립 언론 계수 0(중계 1회 계수) — 커뮤 팩 절대 반응선(eng≥30)으로만 판정, 언론 신뢰 라벨 없음.");
fixtureReport("9 (coverage 이진 포화 — 단일 기사)", s9, "newsy",
  "판정 근거: relatedCoverage=5라도 독립 운영그룹은 1 — importance 근거에 그룹 1로만 남고, reported_secondary 단독이라 게이트 차단(근거 라벨 정직성).");
