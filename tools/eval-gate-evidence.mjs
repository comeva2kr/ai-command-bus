// R7 — 반례 4항목 증빙 취합기 (David 게이트 보고용).
//
// 블루프린트 "2026-08-14 P3-A 판정"의 반례 4개를 신선 풀 실측 1회로 재검증하고
// PASS/FAIL 표 + R7 영수증 해시를 출력한다. 이 출력이 "반례 테스트 통과 확인"
// 증빙 문서가 된다.
//
//  ① R2 반례: 분야(카테고리) 단위 선별 — business 단독 요청에 타 분야 혼입 0.
//  ② R1 반례 a: 클러스터링 선행 — 사건 클러스터링은 요청 분야와 무관하게
//     전체 풀에서 1회(요청 조합을 바꿔도 사건 수 동일), 복수 분야 사건 존재 관측.
//  ③ R3 반례: 품질 게이트 — 광고성·저품질 차단 수 실측 + 같은 날짜 저장
//     실제판 존재 여부(실제판 대조 가능 여부)를 정직하게 보고.
//  ④ R4 반례: 이전 판 연속 — 3슬롯 연속 실행에서 판 간 동일 사건(같은 지문)
//     중복 0(재등장 차단 동작).
//
// 정직 규칙: 읽기 전용(.nowhot-local 읽기만·어디에도 쓰지 않는다), 4100 무접촉,
// 현행 서빙 경로 무변경, 실측 없는 숫자 금지(모든 수치는 이 실행의 실측).
//
// 사용:
//   node tools/eval-gate-evidence.mjs [--pool /path/pool.json] [--date YYYY-MM-DD]
//                                     [--code-version <id>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  shadowSelectBriefing, shadowBriefingReceipt, sha256Hex
} from "../src/feed/shadow-selection.js";
import { loadRegistry } from "../src/feed/registry.js";
import {
  kstSlotTime, runContinuity
} from "./eval-shadow-continuity.mjs";
import { SLOTS } from "../src/feed/digest.js";
import { listServedEditions, articlesFromPool } from "./eval-shadow-vs-today.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DATA_FILE = path.join(ROOT, ".nowhot-local", "feed-data.json");
const DEFAULT_SNAPSHOT_POOL =
  "/private/tmp/claude-501/-Users-hyundonghwang-Documents-FreeBoard/76dcd583-4aaf-4a07-929d-2dc5058ae60f/scratchpad/fresh-feed-pool.json";

const kstDateOf = (epochMs) => new Date(epochMs + 9 * 3600000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 4항목 판정 — 각각 순수 검사 함수(테스트가 합성 입력으로 직접 검증한다).
// ---------------------------------------------------------------------------

// ① R2: business 단독 선별에 타 분야 사건 혼입 0.
//    혼입 판정 = 선별 사건의 귀속 분야 집합(view.categoryIds)에 business가
//    없는 사건이 하나라도 있으면 FAIL. (같은 사건이 business+타 분야에 걸치는
//    복수 귀속은 혼입이 아니다 — business 귀속이 있으므로 정당한 후보다.)
export function checkCategoryIsolation(articles, { now, registry }) {
  const out = shadowSelectBriefing(articles, {
    requestedCategories: ["business"], now, registry
  });
  const intruders = out.briefing.filter((entry) => !entry.view.categoryIds.includes("business"));
  return {
    id: "R2_category_isolation",
    label: "① 분야 단위 선별 — business 단독 요청에 타 분야 혼입 0",
    // 선별 0건이면 "혼입 0"이 공허하게 참이 된다(검수 P3-3 위양성) —
    // 증빙 문서로 쓰이는 검사라 최소 1건 선별을 함께 요구한다.
    pass: intruders.length === 0 && out.briefing.length >= 1,
    detail: `business 선별 ${out.briefing.length}건 · 타 분야 혼입 ${intruders.length}건`
      + (out.briefing.length === 0 ? " · FAIL(선별 0건 — 공허한 통과 금지)" : ""),
    out
  };
}

// ② R1a: 클러스터링 선행 — 요청 조합을 바꿔도 전체 풀 사건 수가 동일해야
//    한다(분야로 자른 뒤 묶으면 조합에 따라 사건 수가 달라진다). 복수 분야
//    사건 수는 전체 풀 클러스터링의 실측 관측으로 함께 남긴다.
export function checkClusteringPrecedence(articles, { now, registry, comboA = ["business"], comboB = ["business", "sports", "science"] }) {
  const a = shadowSelectBriefing(articles, { requestedCategories: comboA, now, registry });
  const b = shadowSelectBriefing(articles, { requestedCategories: comboB, now, registry });
  const multiCategorySelected = b.briefing.filter((entry) => entry.view.categoryIds.length >= 2).length;
  return {
    id: "R1a_clustering_first",
    label: "② 클러스터링 선행 — 사건 묶기는 요청 분야와 무관하게 전체 풀 1회",
    pass: a.counts.events === b.counts.events,
    detail: `사건 수 [${comboA.join(",")}]=${a.counts.events} vs [${comboB.join(",")}]=${b.counts.events}`
      + ` · 복수 분야 귀속 선별 사건 ${multiCategorySelected}건(관측)`,
    out: b
  };
}

// ③ R3: 품질 게이트 — 게이트 ON이 실제로 광고성·저품질을 차단하고, 끄면
//    차단 0이어야 한다(게이트가 유일한 차단 경로임을 확인). 실제판 대조
//    가능 여부는 servedEditionDates(호출자가 읽어온 저장 실제판 날짜 목록)로
//    정직하게 보고만 한다 — 없으면 없다고 쓴다.
export function checkQualityGate(articles, { now, registry, requestedCategories = ["business", "humor"], servedEditionDates = [] }) {
  const on = shadowSelectBriefing(articles, { requestedCategories, now, registry });
  const off = shadowSelectBriefing(articles, { requestedCategories, now, registry, qualityGate: false });
  const reasons = {};
  for (const row of on.excluded.quality) reasons[row.reason] = (reasons[row.reason] || 0) + 1;
  const comparable = servedEditionDates.length > 0;
  return {
    id: "R3_quality_gate",
    label: "③ 품질 게이트 — 광고성·저품질 선행 차단 + 실제판 대조 가능 여부",
    pass: on.counts.qualityExcluded > 0 && off.counts.qualityExcluded === 0,
    detail: `게이트 ON 차단 ${on.counts.qualityExcluded}건(사유 ${JSON.stringify(reasons)}) · OFF 차단 ${off.counts.qualityExcluded}건`
      + ` · 실제판 대조: ${comparable ? `가능(저장 실제판 날짜 ${servedEditionDates.join(", ")})` : "불가(저장 실제판 없음 — 없다고 보고)"}`,
    out: on
  };
}

// ④ R4: 이전 판 연속 — 아침→점심→저녁 연속 실행에서 판 간 동일 사건(같은
//    지문) 재등장 0. 재등장 차단 수는 관측으로 남긴다(같은 풀 3판이라 차단
//    압력이 실제보다 높다 — eval-shadow-continuity의 정직성 주의 그대로).
export function checkReappearance(articles, { date, categories = ["business", "sports", "science", "humor"], registry }) {
  const slots = SLOTS.map((slot) => ({ slotId: slot.id, asOf: kstSlotTime(date, slot.publishHour) }));
  const result = runContinuity(articles, { slots, categories, registry });
  const blocked = result.slotReports.reduce((sum, report) => sum + report.counts.reappearBlocked, 0);
  return {
    id: "R4_reappearance",
    label: "④ 이전 판 연속 — 판 간 동일 사건(같은 지문) 재등장 0",
    pass: result.crossSlotDuplicates.length === 0,
    detail: `3슬롯 연속 · 판 간 같은 지문 중복 ${result.crossSlotDuplicates.length}건 · 재등장 차단 누적 ${blocked}건(관측 — 같은 풀 3판이라 압력 과대)`,
    result
  };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--pool") args.pool = argv[++index];
    else if (argv[index] === "--date") args.date = argv[++index];
    else if (argv[index] === "--code-version") args.codeVersion = argv[++index];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const poolPath = args.pool || DEFAULT_SNAPSHOT_POOL;
  if (!fs.existsSync(poolPath)) {
    console.log(`풀 파일 없음: ${poolPath} — 실측 불가(모형 대체 금지).`);
    process.exitCode = 1;
    return;
  }
  const poolRaw = fs.readFileSync(poolPath, "utf8");
  const poolHash = sha256Hex(poolRaw);
  const pool = JSON.parse(poolRaw);
  const articles = articlesFromPool(pool);
  const registry = loadRegistry();
  const date = args.date || kstDateOf(pool.savedAt || Date.now());
  const now = kstSlotTime(date, SLOTS[1].publishHour); // 점심 슬롯 기준 1회 실측
  const codeVersion = args.codeVersion || null;

  // ③의 실제판 대조 재료 — .nowhot-local 읽기만. 없으면 없다고 보고.
  let servedEditionDates = [];
  if (fs.existsSync(LOCAL_DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(LOCAL_DATA_FILE, "utf8"));
    servedEditionDates = [...new Set(listServedEditions(data).map((row) => row.date))].sort();
  }

  console.log("R7 반례 4항목 증빙 취합 — 신선 풀 실측 1회 · 읽기 전용 · 서빙 무접촉");
  console.log(`풀: ${poolPath}`);
  console.log(`poolHash(SHA-256): ${poolHash}`);
  console.log(`savedAt: ${pool.savedAt ? new Date(pool.savedAt).toISOString() : "?"} · 기사 ${articles.length}건 · 기준 asOf ${new Date(now).toISOString()} (KST ${date} ${SLOTS[1].publishHour}시)`);
  console.log(`codeVersion: ${codeVersion || "(미주입 — --code-version으로 실행 환경이 넣는다)"}`);

  const checks = [
    checkCategoryIsolation(articles, { now, registry }),
    checkClusteringPrecedence(articles, { now, registry }),
    checkQualityGate(articles, { now, registry, servedEditionDates }),
    checkReappearance(articles, { date, registry })
  ];

  console.log(`\n${"=".repeat(78)}\n판정 표`);
  for (const check of checks) {
    console.log(`\n[${check.pass ? "PASS" : "FAIL"}] ${check.label}`);
    console.log(`      ${check.detail}`);
  }

  // 영수증 해시 — ①~③은 각 검사의 브리핑 반환에서, ④는 3슬롯 각각.
  console.log(`\n${"=".repeat(78)}\n영수증 해시 (poolHash+paramsHash+codeVersion 포함 · 경량 계약)`);
  for (const check of checks.slice(0, 3)) {
    const { hash } = shadowBriefingReceipt(check.out, { poolHash, codeVersion });
    console.log(`  ${check.id.padEnd(24)} ${hash}`);
  }
  // ④ — 같은 조건으로 슬롯별 영수증 재생성(runContinuity는 관찰 요약만 반환).
  {
    const categories = ["business", "sports", "science", "humor"];
    const slots = SLOTS.map((slot) => ({ slotId: slot.id, asOf: kstSlotTime(date, slot.publishHour) }));
    runContinuity(articles, {
      slots, categories, registry,
      onBriefing: (slot, out) => {
        const { hash } = shadowBriefingReceipt(out, { poolHash, codeVersion });
        console.log(`  R4_${slot.slotId.padEnd(21)} ${hash}`);
      }
    });
  }

  const allPass = checks.every((check) => check.pass);
  console.log(`\n종합: ${allPass ? "PASS 4/4" : `FAIL — ${checks.filter((c) => !c.pass).map((c) => c.id).join(", ")}`}`);
  if (!allPass) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
