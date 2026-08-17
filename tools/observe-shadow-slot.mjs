// G2 — 3일 관찰 슬롯 실행 도구 (David 승인 A안의 기계 부분).
//
// 하루 3회(모닝 07·런치 12·이브닝 19 KST) cron이 Claude 없이 순수 node로
// 실행한다: 수집 → shadow 브리핑 → R7 영수증 기록.
//
// 정직 규칙:
//  - 현행 서빙 경로(digest·edition-candidates·server·engine) 무수정 — import만.
//  - 4100 서버·.nowhot-local 기존 파일 무접촉. 산출물은 전부
//    .nowhot-local/shadow-observation/ 신설 하위 디렉토리에만 쓴다.
//    (엔진 풀 파일은 FEED_POOL_FILE 환경변수로 관찰 디렉토리에 격리 —
//     서버가 읽는 feed-data.json / feed-data-pool.json은 건드리지 않는다.)
//  - FeedStore({ file: null }) — 서버 DB 파일을 읽지도 쓰지도 않는다.
//  - previousLineage는 관찰 디렉토리에 저장된 직전 슬롯 lineage 파일에서
//    조합별로 로드. 첫 실행이면 빈 배열(정직 기록: previousLineageSource).
//  - 멱등: 같은 날짜·슬롯 요약 파일이 이미 있으면 재수집 없이 종료(cron
//    중복 발화 안전). 실행·스킵·실패는 runlog.jsonl에 append.
//
// 사용: node tools/observe-shadow-slot.mjs        # 현재 KST 기준 슬롯 자동 판정
//       node tools/observe-shadow-slot.mjs --now 2026-08-14T12:05:00+09:00  # 테스트용
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SLOTS } from "../src/feed/digest.js";
import {
  shadowSelectBriefing, shadowBriefingReceipt, stableStringify, sha256Hex
} from "../src/feed/shadow-selection.js";
import { DEFAULT_EDITORIAL_PREVIEW } from "../src/feed/engine.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OBS_DIR = path.join(ROOT, ".nowhot-local", "shadow-observation");

// 조합: 4100 실서빙 기본 조합(engine.js DEFAULT_EDITORIAL_PREVIEW — 하드코딩
// 금지, import로 동일 보장) + 관찰용 추가 2개(business 단독 / science·sports
// 포함 1개 — David 승인 A안 관찰 범위).
export const OBSERVE_COMBOS = [
  { key: "default", categories: [...DEFAULT_EDITORIAL_PREVIEW] },
  { key: "business-only", categories: ["business"] },
  { key: "science-sports", categories: ["science", "sports"] }
];

const KST_MS = 9 * 3600000;
const kstDateOf = (epochMs) => new Date(epochMs + KST_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 슬롯 자동 판정 — 가장 최근 지난 publishHour (digest.js SLOTS 재사용).
// 07시 이전이면 전날 이브닝 슬롯이 "가장 최근 지난 슬롯"이다.
// ---------------------------------------------------------------------------
export function resolveObservationSlot(nowMs, slots = SLOTS) {
  const hours = [...slots].sort((a, b) => a.publishHour - b.publishHour);
  const kst = new Date(nowMs + KST_MS);
  const kstHour = kst.getUTCHours();
  let date = kstDateOf(nowMs);
  let slot = null;
  for (const s of hours) if (kstHour >= s.publishHour) slot = s;
  if (!slot) { // 오늘 첫 슬롯 이전 → 전날 마지막 슬롯
    slot = hours[hours.length - 1];
    date = kstDateOf(nowMs - 24 * 3600000);
  }
  const asOf = Date.parse(`${date}T${String(slot.publishHour).padStart(2, "0")}:00:00+09:00`);
  return { date, slotId: slot.id, publishHour: slot.publishHour, asOf };
}

// 산출물 경로 규약 — 날짜·슬롯 단위.
export const obsPaths = (dir, date, slotId) => ({
  pool: path.join(dir, `pool-${date}-${slotId}.json`),
  lineage: path.join(dir, `lineage-${date}-${slotId}.json`),
  receipts: path.join(dir, `receipts-${date}-${slotId}.json`),
  summary: path.join(dir, `summary-${date}-${slotId}.json`),
  runlog: path.join(dir, "runlog.jsonl")
});

// 멱등 판정 — 요약 파일이 마지막에 쓰이므로 그 존재가 "완료" 표식이다.
export function slotAlreadyDone(dir, date, slotId) {
  return fs.existsSync(obsPaths(dir, date, slotId).summary);
}

// 현재 날짜·슬롯보다 앞선 관찰 산출물 파일 목록 — 시간 오름차순.
// 슬롯 순서는 publishHour 오름차순. prefix: "lineage" | "summary" 등.
export function listPriorObservationFiles(dir, date, slotId, prefix = "lineage", slots = SLOTS) {
  const order = new Map([...slots].sort((a, b) => a.publishHour - b.publishHour)
    .map((s, i) => [s.id, i]));
  let entries = [];
  try {
    const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})-([a-z]+)\\.json$`);
    entries = fs.readdirSync(dir)
      .map((name) => {
        const m = re.exec(name);
        return m && order.has(m[2]) ? { name, date: m[1], slotId: m[2] } : null;
      })
      .filter(Boolean);
  } catch { return []; }
  const key = (e) => `${e.date}#${order.get(e.slotId)}`;
  const self = key({ date, slotId });
  return entries.filter((e) => key(e) < self)
    .sort((a, b) => key(a) < key(b) ? -1 : 1);
}

// 직전 슬롯 lineage 파일 탐색 — 앞선 파일 중 가장 최근 것.
export function findPreviousLineageFile(dir, date, slotId, slots = SLOTS) {
  const prior = listPriorObservationFiles(dir, date, slotId, "lineage", slots);
  return prior.length ? path.join(dir, prior[prior.length - 1].name) : null;
}

// ---------------------------------------------------------------------------
// S2-3 계측 — 순수 판정 함수(단위 테스트 대상). 엔진 무수정, 도구 레벨.
// ---------------------------------------------------------------------------

// ① 소스 결측 대조 — 레지스트리의 enabled 비시드 소스 대비 수집 bySource 결측.
// prevBySource(직전 슬롯 summary의 bySource)가 있으면 직전 슬롯 존재 여부를
// 같이 기록한다(instiz류 간헐 결측 추적). 없으면 null(첫 슬롯 — 정직 기록).
export function computeMissingSources(registry, bySource, prevBySource = null) {
  const expected = (registry || [])
    .filter((c) => c && c.enabled && !(c.adapter && c.adapter.type === "seed"))
    .map((c) => c.id);
  return expected
    .filter((id) => !((bySource || {})[id] > 0))
    .map((id) => ({
      id,
      inPreviousSlot: prevBySource ? (prevBySource[id] > 0) : null
    }));
}

// ② 마지막 서빙 슬롯 유도 — 계보 히스토리(시간 오름차순 [{date, slotId,
// records}])에서 lineageId별로 lastServedFactsFingerprint가 **새 값으로 바뀐**
// 슬롯을 찾는다. markLineageServed는 서빙된 판에서만 이 지문을 갱신하므로
// 값이 바뀐 슬롯이 곧 그 사건이 마지막으로 서빙된 슬롯이다(레코드에서 유도
// 가능한 범위 — 엔진에 서빙 슬롯 필드를 추가하지 않는다).
export function deriveLastServedSlots(history) {
  const current = new Map();    // lineageId → 지문
  const lastServed = new Map(); // lineageId → "date-slotId"
  for (const h of history || []) {
    for (const record of (h && h.records) || []) {
      if (!record || record.lastServedFactsFingerprint == null) continue;
      if (current.get(record.lineageId) !== record.lastServedFactsFingerprint) {
        current.set(record.lineageId, record.lastServedFactsFingerprint);
        lastServed.set(record.lineageId, `${h.date}-${h.slotId}`);
      }
    }
  }
  return lastServed;
}

const appendRunlog = (dir, row) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(obsPaths(dir, "", "").runlog,
    JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
};

// ---------------------------------------------------------------------------
// 본 실행
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const nowArg = args.includes("--now") ? args[args.indexOf("--now") + 1] : null;
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error(`--now 파싱 실패: ${nowArg}`);

  const { date, slotId, publishHour, asOf } = resolveObservationSlot(nowMs);
  const paths = obsPaths(OBS_DIR, date, slotId);
  fs.mkdirSync(OBS_DIR, { recursive: true });

  if (slotAlreadyDone(OBS_DIR, date, slotId)) {
    appendRunlog(OBS_DIR, { event: "skip", date, slotId, reason: "summary exists (idempotent)" });
    console.log(JSON.stringify({ status: "skip", date, slotId, reason: "이미 완료된 슬롯" }));
    return;
  }

  // codeVersion — 읽기 전용 rev-parse. 실패하면 정직하게 null.
  let codeVersion = null;
  try { codeVersion = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); }
  catch { codeVersion = null; }

  try {
    // ① 수집 — 엔진 풀 파일을 관찰 디렉토리로 격리(FEED_POOL_FILE, import 전
    //    이 아니라 FeedEngine 생성 전이면 된다 — 생성자에서 읽는다).
    process.env.FEED_POOL_FILE = paths.pool;
    const { loadRegistry, buildSources } = await import("../src/feed/registry.js");
    const { makeFetcher } = await import("../src/feed/fetchers.js");
    const { FeedEngine } = await import("../src/feed/engine.js");
    const { FeedStore } = await import("../src/feed/store.js");

    const registry = loadRegistry();
    const sources = buildSources(registry, {
      translate: { targetLang: "ko", translateFn: null },
      seed: false,
      fetcher: (e) => makeFetcher(e)()
    });
    const store = new FeedStore({ file: null });
    const engine = new FeedEngine(store, sources);
    await engine.refresh(); // 엔진이 paths.pool에 풀 스냅샷을 쓴다
    const rows = engine.poolRows();
    const articles = rows.map((r) => r && r.item ? r.item : r).filter(Boolean);
    const bySource = {};
    for (const a of articles) bySource[a.source] = (bySource[a.source] || 0) + 1;
    const poolHash = fs.existsSync(paths.pool)
      ? sha256Hex(fs.readFileSync(paths.pool, "utf8")) : null;

    // S2-3 ① — 소스 결측 대조(runlog warn + summary.missingSources).
    const prevSummaries = listPriorObservationFiles(OBS_DIR, date, slotId, "summary");
    let prevBySource = null;
    if (prevSummaries.length) {
      try {
        const prev = JSON.parse(fs.readFileSync(
          path.join(OBS_DIR, prevSummaries[prevSummaries.length - 1].name), "utf8"));
        prevBySource = prev.collected && prev.collected.bySource ? prev.collected.bySource : null;
      } catch { prevBySource = null; }
    }
    const missingSources = computeMissingSources(registry, bySource, prevBySource);
    if (missingSources.length) {
      appendRunlog(OBS_DIR, {
        event: "warn", type: "missing_sources", date, slotId, missing: missingSources
      });
    }

    // ② shadow — 조합별. previousLineage는 직전 슬롯 lineage 파일에서 조합별 로드.
    const prevFile = findPreviousLineageFile(OBS_DIR, date, slotId);
    const prevAll = prevFile ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;

    // S2-3 ② — 계보 히스토리(앞선 lineage 파일 전부, 시간 오름차순) 로드.
    // 조합별 lastServed 유도에 쓴다. 파싱 실패 파일은 건너뛴다(정직: 유도 불가 → null).
    const lineageHistoryFiles = listPriorObservationFiles(OBS_DIR, date, slotId, "lineage")
      .map((e) => {
        try {
          return { ...e, parsed: JSON.parse(fs.readFileSync(path.join(OBS_DIR, e.name), "utf8")) };
        } catch { return null; }
      })
      .filter(Boolean);

    const receipts = {};
    const lineageOut = { date, slotId, byCombo: {} };
    const comboSummaries = {};
    for (const combo of OBSERVE_COMBOS) {
      const previousLineage = prevAll && prevAll.byCombo && prevAll.byCombo[combo.key]
        ? prevAll.byCombo[combo.key] : [];
      const out = shadowSelectBriefing(articles, {
        requestedCategories: combo.categories,
        now: asOf,
        slotId,
        registry,
        previousLineage
      });
      const { receipt, json, hash } = shadowBriefingReceipt(out, { poolHash, codeVersion });
      receipts[combo.key] = { receiptHash: hash, receipt };
      lineageOut.byCombo[combo.key] = out.lineage.records;

      // S2-3 ② — 이 조합의 계보 히스토리에서 lineageId별 마지막 서빙 슬롯 유도.
      const lastServedMap = deriveLastServedSlots(lineageHistoryFiles.map((e) => ({
        date: e.date, slotId: e.slotId,
        records: e.parsed && e.parsed.byCombo && e.parsed.byCombo[combo.key]
          ? e.parsed.byCombo[combo.key] : []
      })));

      // 요약 카운트 — 게이트 기록에서 재등장 차단·B등급을 센다.
      let reappearBlocked = 0;
      let bGrade = 0;
      const partial = [];
      const reappearBlockedDetails = []; // S2-3 ② — 차단 영수증 보강
      for (const category of out.requestedCategories) {
        const run = out.perCategory[category];
        if (run.partialEdition) partial.push(category);
        for (const row of run.excluded.gate) {
          if ((row.gate.failures || []).some((f) => String(f).includes("reappear"))) {
            reappearBlocked += 1;
            const lineageId = row.view.lineage
              ? row.view.lineage.lineageId : `event:${row.view.event.eventId}`;
            reappearBlockedDetails.push({
              category, lineageId,
              lastServedSlot: lastServedMap.get(lineageId) || null
            });
          }
        }
        for (const row of run.selected) {
          if (row.gate && row.gate.trustGrade === "B") bGrade += 1;
        }
      }
      comboSummaries[combo.key] = {
        categories: combo.categories,
        selected: out.counts.briefingSelected,
        perCategorySelected: out.counts.perCategorySelected,
        partialEditionCategories: partial,
        reappearBlocked,
        reappearBlockedDetails,   // S2-3 ② — [{category, lineageId, lastServedSlot|null}]
        // S2-3 ③ — 계보 계측. pruned는 S2-2 프루닝(서빙 보존·미서빙 72h 만료)이
        // 이번 판에서 제거한 레코드 수(briefing 반환의 prunedCount).
        lineage: {
          records: out.lineage.records.length,
          previousRecords: previousLineage.length,
          delta: out.lineage.records.length - previousLineage.length,
          pruned: out.lineage.prunedCount ?? null
        },
        qualityExcluded: out.counts.qualityExcluded,
        bGradeSelected: bGrade,
        receiptHash: hash,
        previousLineageSource: prevFile ? path.basename(prevFile) : null,
        previousLineageCount: previousLineage.length
      };
    }

    // ③ 기록 — 영수증·lineage·요약. 요약이 마지막(완료 표식).
    fs.writeFileSync(paths.receipts, stableStringify(receipts));
    fs.writeFileSync(paths.lineage, stableStringify(lineageOut));
    const summary = {
      date, slotId, publishHour, asOf: new Date(asOf).toISOString(),
      codeVersion, poolHash,
      collected: { articles: articles.length, sources: Object.keys(bySource).length, bySource },
      missingSources, // S2-3 ① — [{id, inPreviousSlot|null}] (enabled 비시드 대비 결측)
      combos: comboSummaries
    };
    fs.writeFileSync(paths.summary, JSON.stringify(summary, null, 1));
    appendRunlog(OBS_DIR, {
      event: "run", date, slotId, articles: articles.length,
      combos: Object.fromEntries(Object.entries(comboSummaries)
        .map(([k, v]) => [k, v.selected]))
    });
    console.log(JSON.stringify(summary, null, 1));
  } catch (err) {
    appendRunlog(OBS_DIR, { event: "fail", date, slotId, error: String(err && err.message || err) });
    console.error(`관찰 슬롯 실패: ${err && err.stack || err}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
