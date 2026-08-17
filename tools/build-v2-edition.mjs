// B2 — v2 판 생성기 (개인화 브리핑 v2의 서버측 산출물).
//
// observe-shadow-slot.mjs의 검증된 경로(수집 → shadowSelectBriefing → 계보
// 체이닝·프루닝·영수증)를 재사용하되, 산출물로 **v2 판 JSON 계약**(아래
// 스키마 — 양쪽 공통 정본, 임의 변경 금지)을 추가 생성한다.
//
// 계약과 다른 점(관찰 도구 대비):
//  - 대상 카테고리는 요청 조합이 아니라 **라이브가 지원하는 전체 카테고리**
//    (SHADOW_PACK_PARAMS 팩의 categories+appliedCategories 합집합 — 하드코딩
//    금지, listV2Categories()로 유도). 분야별 전체 산출 — 조립은 클라이언트 몫.
//  - 상태(계보)는 관찰 디렉토리와 **별도의** .nowhot-local/v2-production/
//    하위에 격리한다(관찰 데이터 오염 금지). 엔진 풀 파일도 같은 디렉토리로
//    격리(FEED_POOL_FILE) — 서버가 읽는 feed-data*.json 무접촉.
//  - 운영 저장소 복사는 하지 않는다(B4 배포 크론 몫). 여기서는 로컬 산출만.
//
// v2 판 JSON 계약(version 1):
// {
//   "version": 1,
//   "date": "YYYY-MM-DD", "slotId": "morning|lunch|evening",
//   "generatedAt": ISO8601, "codeVersion": "<git sha>"|null,
//   "categories": {
//     "<categoryId>": {
//       "partial": bool,
//       "items": [{
//         "rank": n, "title": str, "url": str,
//         "source": str, "sourceLabel": str,
//         "categoryIds": [str],
//         "trustGrade": "A|independent2|B|community",
//         "trustLabel": str|null,        // B등급만 "단일 출처"(R5)
//         "publishedAt": ISO8601|null,
//         "evidenceCount": n
//       }]
//     }
//   }
// }
//
// 정직 규칙(관찰 도구와 동일):
//  - 현행 서빙 경로 무수정 — import만. 4100 서버·기존 .nowhot-local 파일 무접촉.
//  - 멱등: 같은 날짜·슬롯 edition 파일이 있으면 재수집 없이 종료.
//    실행·스킵·실패는 runlog.jsonl에 append.
//  - previousLineage는 v2 디렉토리의 직전 슬롯 lineage에서 로드. 첫 실행이면
//    빈 배열(정직 기록: previousLineageSource=null).
//
// 사용: node tools/build-v2-edition.mjs        # 현재 KST 기준 슬롯 자동 판정
//       node tools/build-v2-edition.mjs --now 2026-08-17T12:05:00+09:00
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SLOTS } from "../src/feed/digest.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import {
  SHADOW_PACK_PARAMS, shadowSelectBriefing, shadowBriefingReceipt,
  stableStringify, sha256Hex
} from "../src/feed/shadow-selection.js";
// 슬롯 자동 판정·직전 lineage 탐색은 관찰 도구의 검증된 함수를 그대로 재사용
// (디렉토리 인자만 v2 전용으로 준다 — 관찰 디렉토리는 읽지도 쓰지도 않는다).
import {
  resolveObservationSlot, findPreviousLineageFile
} from "./observe-shadow-slot.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const V2_DIR = path.join(ROOT, ".nowhot-local", "v2-production");
export const V2_SLOT_IDS = SLOTS.map((s) => s.id); // morning|lunch|evening
export const V2_COMBO_KEY = "v2-all"; // lineage 파일의 byCombo 키(관찰 파일 형식 호환)

// 라이브가 지원하는 전체 카테고리 — 팩 테이블에서 유도(하드코딩 금지).
// 순서는 taxonomy CATEGORIES 순(결정적 산출).
export function listV2Categories(params = SHADOW_PACK_PARAMS) {
  const supported = new Set();
  for (const pack of Object.values(params.packs)) {
    for (const category of [...pack.categories, ...(pack.appliedCategories || [])]) {
      supported.add(category);
    }
  }
  return CATEGORIES.map((c) => c.id).filter((id) => supported.has(id));
}

// 산출물 경로 규약 — 날짜·슬롯 단위. lineage 파일명은 관찰 도구와 같은 패턴
// (findPreviousLineageFile 재사용 조건).
export const v2Paths = (dir, date, slotId) => ({
  pool: path.join(dir, `pool-${date}-${slotId}.json`),
  lineage: path.join(dir, `lineage-${date}-${slotId}.json`),
  receipts: path.join(dir, `receipts-${date}-${slotId}.json`),
  edition: path.join(dir, `edition-${date}-${slotId}.json`),
  latest: path.join(dir, "latest.json"),
  runlog: path.join(dir, "runlog.jsonl")
});

// 멱등 판정 — edition 파일이 마지막(latest 직전)에 쓰이므로 완료 표식이다.
export function v2SlotAlreadyDone(dir, date, slotId) {
  return fs.existsSync(v2Paths(dir, date, slotId).edition);
}

// ---------------------------------------------------------------------------
// 판 조립 — shadowSelectBriefing 결과 → v2 판 JSON (순수 함수, 단위 테스트 대상)
// ---------------------------------------------------------------------------
export function buildV2Edition(briefingOut, {
  date, slotId, generatedAt, codeVersion = null, registryById = new Map()
}) {
  const categories = {};
  for (const category of briefingOut.requestedCategories) {
    const run = briefingOut.perCategory[category];
    const items = run.selected.map((row, index) => {
      const view = row.view;
      const repId = row.representative ? row.representative.articleId : null;
      const pool = [...view.memberArticles, ...view.reactionArticles];
      const article = pool.find((a) => a && a.id === repId) || pool[0] || {};
      const entry = registryById.get(article.source) || null;
      return {
        rank: index + 1,
        title: String(article.title ?? ""),
        url: String(article.url ?? ""),
        source: String(article.source ?? "unknown"),
        sourceLabel: String(article.sourceLabel || (entry && entry.label) || article.source || "unknown"),
        categoryIds: view.categoryIds,
        // 커뮤 팩(trustGate community_absolute_eng)은 등급이 없다 → "community".
        trustGrade: row.gate.trustGrade || "community",
        trustLabel: row.gate.trustLabel ?? null, // R5 — B등급만 "단일 출처"
        publishedAt: article.publishedAt ?? null,
        evidenceCount: view.memberArticles.length
      };
    });
    categories[category] = { partial: Boolean(run.partialEdition), items };
  }
  return { version: 1, date, slotId, generatedAt, codeVersion, categories };
}

// ---------------------------------------------------------------------------
// 계약 자가 검증 — 생성 직후 게이트(불합격이면 파일을 쓰지 않는다) + 단위 테스트.
// ---------------------------------------------------------------------------
const TRUST_GRADES = new Set(["A", "independent2", "B", "community"]);
const isIso = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));

export function validateV2Edition(edition) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!edition || typeof edition !== "object") return { ok: false, errors: ["not an object"] };
  if (edition.version !== 1) err("version !== 1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(edition.date))) err("date not YYYY-MM-DD");
  if (!V2_SLOT_IDS.includes(edition.slotId)) err(`slotId not in ${V2_SLOT_IDS.join("|")}`);
  if (!isIso(edition.generatedAt)) err("generatedAt not ISO8601");
  if (!(edition.codeVersion === null || typeof edition.codeVersion === "string")) {
    err("codeVersion not string|null");
  }
  if (!edition.categories || typeof edition.categories !== "object") {
    err("categories not object");
    return { ok: false, errors };
  }
  for (const [category, block] of Object.entries(edition.categories)) {
    const at = (m) => err(`categories.${category}: ${m}`);
    if (!block || typeof block !== "object") { at("not object"); continue; }
    if (typeof block.partial !== "boolean") at("partial not bool");
    if (!Array.isArray(block.items)) { at("items not array"); continue; }
    const urls = new Set();
    block.items.forEach((item, index) => {
      const it = (m) => at(`items[${index}] ${m}`);
      if (!item || typeof item !== "object") { it("not object"); return; }
      if (item.rank !== index + 1) it(`rank ${item.rank} !== ${index + 1}`);
      for (const key of ["title", "url", "source", "sourceLabel"]) {
        if (typeof item[key] !== "string" || !item[key]) it(`${key} not non-empty string`);
      }
      if (urls.has(item.url)) it("duplicate url in category");
      urls.add(item.url);
      if (!Array.isArray(item.categoryIds) || !item.categoryIds.length
        || item.categoryIds.some((c) => typeof c !== "string")) {
        it("categoryIds not non-empty string array");
      }
      if (!TRUST_GRADES.has(item.trustGrade)) it(`trustGrade ${item.trustGrade} invalid`);
      // R5 — trustLabel은 B등급에만 붙는다("단일 출처"). 그 외는 null.
      if (item.trustGrade === "B") {
        if (item.trustLabel !== "단일 출처") it("B trustLabel !== 단일 출처");
      } else if (item.trustLabel !== null) it("non-B trustLabel not null");
      if (!(item.publishedAt === null || isIso(item.publishedAt))) it("publishedAt not ISO8601|null");
      if (!Number.isInteger(item.evidenceCount) || item.evidenceCount < 0) {
        it("evidenceCount not non-negative int");
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

const appendRunlog = (dir, row) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "runlog.jsonl"),
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
  const paths = v2Paths(V2_DIR, date, slotId);
  fs.mkdirSync(V2_DIR, { recursive: true });

  if (v2SlotAlreadyDone(V2_DIR, date, slotId)) {
    appendRunlog(V2_DIR, { event: "skip", date, slotId, reason: "edition exists (idempotent)" });
    console.log(JSON.stringify({ status: "skip", date, slotId, reason: "이미 완료된 슬롯" }));
    return;
  }

  let codeVersion = null;
  try { codeVersion = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); }
  catch { codeVersion = null; }

  try {
    // ① 수집 — 엔진 풀 파일을 v2 디렉토리로 격리(FEED_POOL_FILE).
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
    await engine.refresh();
    const rows = engine.poolRows();
    const articles = rows.map((r) => r && r.item ? r.item : r).filter(Boolean);
    const poolHash = fs.existsSync(paths.pool)
      ? sha256Hex(fs.readFileSync(paths.pool, "utf8")) : null;

    // ② 선별 — 전체 카테고리 1회 브리핑(클러스터링·계보는 판 전체 1회 원칙).
    const prevFile = findPreviousLineageFile(V2_DIR, date, slotId);
    const prevAll = prevFile ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
    const previousLineage = prevAll && prevAll.byCombo && prevAll.byCombo[V2_COMBO_KEY]
      ? prevAll.byCombo[V2_COMBO_KEY] : [];

    const v2Categories = listV2Categories();
    const out = shadowSelectBriefing(articles, {
      requestedCategories: v2Categories,
      now: asOf,
      slotId,
      registry,
      previousLineage
    });
    const { hash, receipt } = shadowBriefingReceipt(out, { poolHash, codeVersion });

    // ③ 판 조립 + 계약 자가 검증(불합격이면 산출물 미기록 — 정직 실패).
    const registryById = new Map((registry || []).filter(Boolean).map((e) => [e.id, e]));
    const edition = buildV2Edition(out, {
      date, slotId, generatedAt: new Date(asOf).toISOString(), codeVersion, registryById
    });
    const check = validateV2Edition(edition);
    if (!check.ok) throw new Error(`v2 계약 자가 검증 실패: ${check.errors.join("; ")}`);

    // ④ 기록 — 영수증·lineage(다음 슬롯 재료)·edition·latest. edition이 완료 표식.
    fs.writeFileSync(paths.receipts, stableStringify({ [V2_COMBO_KEY]: { receiptHash: hash, receipt } }));
    fs.writeFileSync(paths.lineage, stableStringify({
      date, slotId, byCombo: { [V2_COMBO_KEY]: out.lineage.records }
    }));
    fs.writeFileSync(paths.edition, JSON.stringify(edition, null, 1));
    fs.writeFileSync(paths.latest, JSON.stringify(edition, null, 1));

    const perCategory = Object.fromEntries(v2Categories.map((category) => {
      const block = edition.categories[category];
      return [category, {
        items: block.items.length,
        partial: block.partial,
        trustGrades: block.items.reduce((acc, item) => {
          acc[item.trustGrade] = (acc[item.trustGrade] || 0) + 1;
          return acc;
        }, {})
      }];
    }));
    const summary = {
      status: "run", date, slotId, publishHour,
      asOf: new Date(asOf).toISOString(), codeVersion, poolHash,
      articles: articles.length,
      categories: perCategory,
      lineage: {
        records: out.lineage.records.length,
        previousRecords: previousLineage.length,
        pruned: out.lineage.prunedCount ?? null,
        previousLineageSource: prevFile ? path.basename(prevFile) : null
      },
      receiptHash: hash,
      contractValid: check.ok,
      editionFile: path.basename(paths.edition)
    };
    appendRunlog(V2_DIR, {
      event: "run", date, slotId, articles: articles.length,
      perCategory: Object.fromEntries(Object.entries(perCategory)
        .map(([k, v]) => [k, v.items]))
    });
    console.log(JSON.stringify(summary, null, 1));
  } catch (err) {
    appendRunlog(V2_DIR, { event: "fail", date, slotId, error: String(err && err.message || err) });
    console.error(`v2 판 생성 실패: ${err && err.stack || err}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
