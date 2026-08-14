// R3 — 실제 todayEdition 대 shadow판 비교기 (블루프린트 "2026-08-14 P3-A 판정"
// 결함 5의 수리).
//
// 결함 5: 이전 비교기(eval-shadow-edition.mjs)는 "현행판"을 buildDigest 임시
// 모형으로 만들었다 — 실제 사용자에게 나간 판이 아니다. 이 도구는 4100 서버가
// **실제로 저장·서빙한 판**(.nowhot-local/feed-data.json → editorialEditions
// [date][slotId][segmentKey], store.js:796 saveEditorialEdition의 저장 구조
// 그대로)을 꺼내, 같은 카테고리 조합·같은 슬롯·같은 시점(asOf = 그 판의
// generatedAt)으로 shadowSelectBriefing을 돌려 나란히 diff를 낸다.
//
// 정직 규칙:
//  - 저장된 판이 없으면 "해당 조합·슬롯의 서빙판 없음"을 출력한다. 모형으로
//    대체하지 않는다(그게 결함 5였다).
//  - 읽기 전용: .nowhot-local/ 어떤 파일도 쓰지 않는다. 4100 프로세스 무접촉.
//  - 실제 서빙판은 **구버전 코드(runtime HOLD 상태)의 산출**이다 — 그래서 이
//    비교가 "구버전 제품 vs 새 선별"의 정직한 비교다.
//
// shadow 입력 풀은 feed-data-pool.json(서버가 저장한 기사 풀 스냅샷, rows[].item)
// 이다. 풀 savedAt과 판 generatedAt의 간격을 함께 출력한다 — 간격이 크면 같은
// 재료 비교가 아니므로 수치를 그대로 믿으면 안 된다.
//
// 사용:
//   node tools/eval-shadow-vs-today.mjs                       # 기본 조합(서빙 기본값) 자동 탐색
//   node tools/eval-shadow-vs-today.mjs --date 2026-08-13 --slot lunch --cats business,humor,news,tech
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shadowSelectBriefing } from "../src/feed/shadow-selection.js";
import { editorialInventorySegmentKey } from "../src/feed/editorial-inventory.js";
import { loadRegistry } from "../src/feed/registry.js";
import { DEFAULT_EDITORIAL_PREVIEW } from "../src/feed/engine.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, ".nowhot-local", "feed-data.json");
const POOL_FILE = path.join(ROOT, ".nowhot-local", "feed-data-pool.json");

// ---------------------------------------------------------------------------
// 로딩 — server.js가 저장하는 실제 키·스키마 그대로 읽는다(테스트 대상 단위).
// ---------------------------------------------------------------------------

// 저장 키: editorialInventorySegmentKey(현재 "v26:" + 정렬 조합) — server.js:762.
export function servedSegmentKey(categories) {
  return editorialInventorySegmentKey(categories);
}

// 실제 서빙판 꺼내기. 없으면 found:false — 모형 대체 금지.
export function loadServedEdition(data, { date, slotId, categories }) {
  const segmentKey = servedSegmentKey(categories);
  const edition = data && data.editorialEditions
    && data.editorialEditions[date]
    && data.editorialEditions[date][slotId]
    && data.editorialEditions[date][slotId][segmentKey] || null;
  if (!edition || !Array.isArray(edition.issues) || edition.issues.length === 0) {
    return { found: false, segmentKey, edition: null };
  }
  return { found: true, segmentKey, edition };
}

// 저장돼 있는 판 목록(비어 있지 않은 것만) — 조합 자동 탐색·안내용.
export function listServedEditions(data) {
  const rows = [];
  for (const [date, slots] of Object.entries(data && data.editorialEditions || {})) {
    for (const [slotId, segments] of Object.entries(slots || {})) {
      for (const [segmentKey, edition] of Object.entries(segments || {})) {
        if (edition && Array.isArray(edition.issues) && edition.issues.length > 0) {
          rows.push({
            date, slotId, segmentKey,
            generatedAt: edition.generatedAt || null,
            issueCount: edition.issues.length
          });
        }
      }
    }
  }
  return rows.sort((a, b) => `${a.date}|${a.slotId}|${a.segmentKey}`
    .localeCompare(`${b.date}|${b.slotId}|${b.segmentKey}`));
}

// 풀 스냅샷 → shadow 입력 기사 배열(rows[].item — 서버 저장 구조 그대로).
export function articlesFromPool(pool) {
  return (pool && Array.isArray(pool.rows) ? pool.rows : [])
    .map((row) => row && typeof row === "object" && "item" in row ? row.item : row)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// diff — [실제 서빙판 항목] vs [shadow판 항목]: 진입·탈락·순위 변화·사유
// ---------------------------------------------------------------------------

const issueArticleIds = (issue) => (issue && Array.isArray(issue.refs) ? issue.refs : [])
  .map((ref) => ref && ref.id).filter(Boolean);

const shadowEntryArticleIds = (entry) => [
  ...entry.view.memberArticles.map((article) => article.id),
  ...entry.view.reactionArticles.map((article) => article.id)
].filter(Boolean);

// shadow 결과의 탈락 기록에서, 이 기사 집합이 왜 빠졌는지 찾는다.
function shadowExclusionReason(shadow, ids) {
  const idSet = new Set(ids);
  for (const row of shadow.excluded && shadow.excluded.quality || []) {
    if (idSet.has(row.articleId)) return `품질 게이트: ${row.reason}`;
  }
  for (const [category, run] of Object.entries(shadow.perCategory || {})) {
    const hit = (rows, label, describe) => {
      for (const row of rows || []) {
        if (row.view.memberArticles.some((article) => idSet.has(article.id))) {
          return `${category} ${label}: ${describe(row)}`;
        }
      }
      return null;
    };
    const found = hit(run.excluded && run.excluded.gate, "자격 게이트 탈락",
      (row) => row.gate.failures.join(","))
      || hit(run.excluded && run.excluded.sourceCap, "소스캡 탈락", (row) => row.exclusion)
      || hit(run.excluded && run.excluded.belowVolume, "동적 분량 밖", (row) => row.exclusion);
    if (found) return found;
  }
  return "shadow 후보 아님(풀 부재·다른 분야 귀속 등)";
}

export function diffServedVsShadow(edition, shadow) {
  const issues = (edition && edition.issues || []).map((issue, index) => ({
    rank: index + 1,
    headline: issue.headline || issue.subject || "(제목 없음)",
    categoryIds: issue.categoryIds || [],
    articleIds: issueArticleIds(issue)
  }));
  const shadowRows = (shadow.briefing || []).map((entry, index) => ({
    rank: index + 1,
    lineageId: entry.lineageId,
    categories: entry.selectedByCategories,
    tier: entry.tier,
    S: entry.S,
    title: entry.view.memberArticles[0] && entry.view.memberArticles[0].title
      || entry.view.reactionArticles[0] && entry.view.reactionArticles[0].title || "(제목 없음)",
    articleIds: shadowEntryArticleIds(entry)
  }));
  const shadowByArticleId = new Map();
  for (const row of shadowRows) for (const id of row.articleIds) shadowByArticleId.set(id, row);

  const both = [];
  const servedOnly = [];
  const matchedShadowRanks = new Set();
  for (const issue of issues) {
    const match = issue.articleIds.map((id) => shadowByArticleId.get(id)).find(Boolean) || null;
    if (match) {
      matchedShadowRanks.add(match.rank);
      both.push({ served: issue, shadow: match, rankDelta: match.rank - issue.rank });
    } else {
      servedOnly.push({ served: issue, reason: shadowExclusionReason(shadow, issue.articleIds) });
    }
  }
  const shadowOnly = shadowRows.filter((row) => !matchedShadowRanks.has(row.rank));
  return { both, servedOnly, shadowOnly, servedCount: issues.length, shadowCount: shadowRows.length };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date") args.date = argv[++index];
    else if (argv[index] === "--slot") args.slot = argv[++index];
    else if (argv[index] === "--cats") args.cats = String(argv[++index]).split(",").map((v) => v.trim()).filter(Boolean);
  }
  return args;
}

function runOne(data, articles, poolSavedAt, registry, { date, slotId, categories }) {
  const head = `조합 [${[...categories].sort().join(", ")}] · 슬롯 ${slotId} · 날짜 ${date}`;
  const served = loadServedEdition(data, { date, slotId, categories });
  console.log(`\n${"=".repeat(78)}\n${head} · 저장 키 ${served.segmentKey}`);
  if (!served.found) {
    console.log("해당 조합·슬롯의 서빙판 없음 — 비교 불가(모형 대체 금지).");
    return;
  }
  const edition = served.edition;
  const asOf = Date.parse(edition.generatedAt);
  const gapMin = Math.round((asOf - poolSavedAt) / 60000);
  console.log(`실제 서빙판: generatedAt ${edition.generatedAt} · 이슈 ${edition.issues.length}건 (구버전 코드 산출 — runtime HOLD)`);
  console.log(`shadow 입력 풀: savedAt ${new Date(poolSavedAt).toISOString()} · 판과의 간격 ${gapMin}분${Math.abs(gapMin) > 60 ? " ⚠ 간격 큼 — 같은 재료 비교 아님" : ""}`);

  const shadow = shadowSelectBriefing(articles, {
    requestedCategories: categories,
    now: asOf,
    slotId: edition.slot && edition.slot.id || slotId,
    registry
  });
  const diff = diffServedVsShadow(edition, shadow);

  console.log(`\nshadow판: 선택 ${diff.shadowCount}건 · 품질 게이트 탈락 ${shadow.counts.qualityExcluded}건 · 분야별 ${JSON.stringify(shadow.counts.perCategorySelected)}`);
  console.log(`\n── 양쪽 모두 (${diff.both.length}건) — 순위 [실제→shadow]`);
  for (const row of diff.both) {
    console.log(`  [${row.served.rank}→${row.shadow.rank}] ${row.served.headline.slice(0, 56)}`);
  }
  console.log(`\n── 실제 서빙판에만 (${diff.servedOnly.length}건) — shadow 탈락·부재 사유`);
  for (const row of diff.servedOnly) {
    console.log(`  [실제 ${row.served.rank}위·${row.served.categoryIds.join(",")}] ${row.served.headline.slice(0, 48)}`);
    console.log(`      └ ${row.reason}`);
  }
  console.log(`\n── shadow판에만 진입 (${diff.shadowOnly.length}건)`);
  for (const row of diff.shadowOnly) {
    console.log(`  [shadow ${row.rank}위·층${row.tier}·S ${row.S}·${row.categories.join(",")}] ${row.title.slice(0, 48)}`);
  }
  const qualityRows = shadow.excluded.quality;
  if (qualityRows.length) {
    console.log(`\n── 품질 게이트 탈락 기록 (${qualityRows.length}건 — 감사용, 상위 20)`);
    for (const row of qualityRows.slice(0, 20)) {
      console.log(`  [${row.source}·${row.category}] ${String(row.title).slice(0, 44)} — ${row.reason}`);
    }
  }
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const pool = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
  const articles = articlesFromPool(pool);
  const registry = loadRegistry();
  const args = parseArgs(process.argv.slice(2));

  console.log(`실제 서빙 저장소: ${DATA_FILE} (읽기 전용)`);
  console.log(`shadow 입력 풀: ${POOL_FILE} · 기사 ${articles.length}건`);

  if (args.date && args.slot && args.cats) {
    runOne(data, articles, pool.savedAt, registry, { date: args.date, slotId: args.slot, categories: args.cats });
    return;
  }

  // 기본: 풀 savedAt과 생성 시각이 가장 가까운, 서빙 기본 조합의 저장판을 찾는다.
  const defaultKey = servedSegmentKey(DEFAULT_EDITORIAL_PREVIEW);
  const candidates = listServedEditions(data)
    .filter((row) => row.segmentKey === defaultKey && row.generatedAt)
    .sort((a, b) => Math.abs(Date.parse(a.generatedAt) - pool.savedAt)
      - Math.abs(Date.parse(b.generatedAt) - pool.savedAt));
  if (!candidates.length) {
    console.log(`기본 조합(${defaultKey})의 서빙판 없음 — --date/--slot/--cats로 지정하라.`);
    console.log("저장된 판:", listServedEditions(data).slice(-10).map((row) => `${row.date}/${row.slotId}/${row.segmentKey}`).join(", "));
    return;
  }
  runOne(data, articles, pool.savedAt, registry, {
    date: candidates[0].date, slotId: candidates[0].slotId, categories: DEFAULT_EDITORIAL_PREVIEW
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
