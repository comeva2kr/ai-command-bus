// R-a — 판 생성기 확장: v1(기존 편성)·v2(새 선별) **신문형 판 JSON 2벌**.
//
// 공통 정본 스키마 = 로컬판 GET /api/today 응답(그대로, 임의 변경 금지).
// 슬롯당 수집 1회 후:
//   ① v1 판 — 로컬판 기존 오늘판 편성 경로(server.js의 editorial 파이프라인)를
//      **서버를 띄우지 않고** 그대로 호출한다. buildServeableTodayEdition은
//      createServer 클로저 내부라 직접 import가 불가능하므로, createServer로
//      요청 핸들러만 만들고(포트 리슨 없음) GET /api/today를 인프로세스로
//      디스패치한다 — 서버 코드는 무수정, 호출만.
//   ② v2 판 — shadowSelectBriefing(새 선별)으로 이슈 클러스터를 고른 뒤,
//      선택된 클러스터의 기사(대표+구성원+반응)만 소스로 넣은 두 번째
//      인프로세스 핸들러에 **같은 편집 문장 계층**(editorial-* 파이프라인
//      전체)을 통과시켜 같은 구조의 판을 만든다. 새 선별 고유 정보(신뢰
//      등급·단일 출처)는 기존 v2 계약 파일(edition-<date>-<slot>.json)에
//      그대로 남는다 — /api/today 스키마에는 억지로 넣지 않는다.
//   ③ 산출 — .nowhot-local/v2-production/에
//        edition-v1-<date>-<slot>.json + edition-v1-latest.json
//        edition-v2-<date>-<slot>.json + edition-v2-latest.json
//      (내용 = /api/today 응답 JSON 그대로) + 스키마 자가 검증.
//      영수증·계보·v2 계약 판은 기존 build-v2-edition 흐름 그대로 —
//      해당 슬롯 산출물이 없을 때만 같은 방식으로 생성한다(멱등).
//
// 정직 규칙:
//  - src/feed/* 무수정 — import·호출만. 4100 서버·포트 무접촉(리슨 없음).
//  - 수집은 슬롯당 1회: 같은 슬롯 pool-<date>-<slot>.json이 있으면 재사용.
//  - LLM 호출 0 (localEditorialLlmEnabled: false) — 판의 llmCalls로 검증.
//  - 멱등: edition-v1·v2 파일이 모두 있으면 재실행 없이 종료. runlog에 기록.
//
// 사용: node tools/build-editions.mjs        # 현재 KST 기준 슬롯 자동 판정
//       node tools/build-editions.mjs --now 2026-08-17T12:05:00+09:00
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SLOTS } from "../src/feed/digest.js";
import { READER_COPY_REQUIRED_FIELDS } from "../src/feed/editorial-reader-copy.js";
import {
  SHADOW_PACK_PARAMS, shadowSelectBriefing, shadowBriefingReceipt,
  stableStringify, sha256Hex
} from "../src/feed/shadow-selection.js";
import { resolveObservationSlot, findPreviousLineageFile } from "./observe-shadow-slot.mjs";
import { memoizedTranslator, TranslatingSource } from "../src/feed/translate.js";
import { googleFreeTranslator } from "../src/feed/translator.js";
import {
  V2_DIR, V2_COMBO_KEY, listV2Categories, v2Paths, v2SlotAlreadyDone,
  buildV2Edition, validateV2Edition
} from "./build-v2-edition.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 해외 영문 소스 한글 번역 — 운영(docker-compose FEED_TRANSLATE=1)과 동일하게
// 기본 ON이다. 미리보기 판이 운영과 다른 화면을 보여주면 검증 자체가 거짓이
// 되므로(해외 뉴스가 한국어 독자 게이트에 걸려 빠지던 것) 이 도구도 운영처럼
// 번역을 켠다. FEED_TRANSLATE=0으로만 끈다(결정론 재현이 필요한 테스트용).
const editionTranslateFn = process.env.FEED_TRANSLATE === "0"
  ? null
  : memoizedTranslator(googleFreeTranslator());
const editionTranslate = { targetLang: "ko", translateFn: editionTranslateFn };

// 신문형 판(오늘판 스키마) 산출 경로 — v2 계약 파일(edition-<date>-<slot>.json)과
// 접두사로 구분한다.
export const todayEditionPaths = (dir, date, slotId) => ({
  v1: path.join(dir, `edition-v1-${date}-${slotId}.json`),
  v1Latest: path.join(dir, "edition-v1-latest.json"),
  v2: path.join(dir, `edition-v2-${date}-${slotId}.json`),
  v2Latest: path.join(dir, "edition-v2-latest.json")
});

// ---------------------------------------------------------------------------
// 오늘판(/api/today) 스키마 자가 검증 — public/today.html이 실제로 소비하는
// 필드만 본다(정본 추종, 발명 금지). 실패 목록을 돌려준다.
// ---------------------------------------------------------------------------
const SLOT_IDS = new Set(SLOTS.map((slot) => slot.id));
const isIso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

export function validateTodayEdition(edition) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!edition || typeof edition !== "object") return { ok: false, errors: ["not an object"] };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(edition.editionDate))) err("editionDate not YYYY-MM-DD");
  if (!isIso(edition.generatedAt)) err("generatedAt not ISO8601");
  if (!edition.slot || !SLOT_IDS.has(edition.slot.id) || !nonEmpty(edition.slot.label)) {
    err("slot {id,label} invalid");
  }
  if (!Array.isArray(edition.issues)) err("issues not array");
  if (!edition.selection || !Array.isArray(edition.selection.categories)
    || !edition.selection.categories.length
    || !nonEmpty(edition.selection.mode)) err("selection {mode,categories[]} invalid");
  if (!Array.isArray(edition.availableCategories) || !edition.availableCategories.length
    || edition.availableCategories.some((c) => !c || !nonEmpty(c.id) || !nonEmpty(c.label))) {
    err("availableCategories not [{id,label}]");
  }
  const fulfillment = edition.categoryFulfillment;
  if (!fulfillment || !Array.isArray(fulfillment.rows)
    || !Number.isInteger(fulfillment.metCount) || !Number.isInteger(fulfillment.selectedCount)) {
    err("categoryFulfillment {rows,metCount,selectedCount} invalid");
  }
  for (const key of ["sourceCount", "overseasShare", "llmCalls"]) {
    if (!Number.isFinite(Number(edition[key]))) err(`${key} not a number`);
  }
  if (!edition.serving || !nonEmpty(edition.serving.state)) err("serving.state missing");

  (Array.isArray(edition.issues) ? edition.issues : []).forEach((issue, index) => {
    const at = (m) => err(`issues[${index}] ${m}`);
    if (!issue || typeof issue !== "object") { at("not object"); return; }
    const copy = issue.reader || {};
    // today.html은 copy.x || issue.x 순으로 읽는다 — 같은 폴백으로 본다.
    if (!nonEmpty(copy.headline) && !nonEmpty(issue.headline)) at("headline empty");
    if (!nonEmpty(copy.summary) && !nonEmpty(issue.paragraph)) at("summary/paragraph empty");
    if (!nonEmpty(copy.whyImportant) && !nonEmpty(issue.whyImportant)) at("whyImportant empty");
    if (!nonEmpty(copy.whyNow) && !nonEmpty(issue.whyHot)) at("whyNow/whyHot empty");
    if (!nonEmpty(copy.watchNext) && !nonEmpty(issue.watchNext)) at("watchNext empty");
    if (issue.reader) {
      for (const field of READER_COPY_REQUIRED_FIELDS) {
        if (!nonEmpty(copy[field])) at(`reader.${field} empty`);
      }
    }
    if (!Array.isArray(issue.categoryIds) || !issue.categoryIds.length) at("categoryIds empty");
    if (!Array.isArray(issue.refs) || !issue.refs.length) at("refs empty");
    else {
      issue.refs.forEach((ref, refIndex) => {
        if (!ref || !nonEmpty(String(ref.id ?? "")) || !nonEmpty(ref.title) || !nonEmpty(ref.sourceLabel)) {
          at(`refs[${refIndex}] missing id/title/sourceLabel`);
        }
      });
    }
    if (!issue.evidence || !Array.isArray(issue.evidence.sources)) at("evidence.sources not array");
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 수집 풀 → 인프로세스 소스. 실 수집과 같은 collect() 경로를 다시 지나므로
// 정규화·캡이 그대로 적용된다. 소스별 캡(뉴스 20)에 걸려 풀이 잘리지 않게
// 소스당 chunk(기본 20) 단위의 유사 소스로 쪼갠다 — id·kind는 원본 유지라
// 소스 역할·등록부 매칭이 그대로 성립한다.
// ---------------------------------------------------------------------------
export function groupArticlesAsSources(articles, { chunk = 20 } = {}) {
  const bySource = new Map();
  for (const article of articles || []) {
    if (!article || !article.id) continue;
    const key = String(article.source || "unknown");
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(article);
  }
  const sources = [];
  for (const [id, rows] of bySource) {
    const kind = rows[0] && rows[0].kind === "community" ? "community" : "news";
    for (let start = 0; start < rows.length; start += chunk) {
      const slice = rows.slice(start, start + chunk);
      sources.push({ id, kind, fetch: async () => slice });
    }
  }
  return sources;
}

// shadow 선별 결과에서 선택된 클러스터의 기사 전체(대표·구성원·반응)를 모은다 —
// v2 판의 재료. 편집 문장 계층은 이 재료 위에서만 돈다.
export function collectShadowArticles(briefingOut) {
  const byId = new Map();
  for (const category of briefingOut.requestedCategories || []) {
    const run = briefingOut.perCategory && briefingOut.perCategory[category];
    for (const row of (run && run.selected) || []) {
      const view = row && row.view;
      if (!view) continue;
      for (const article of [...(view.memberArticles || []), ...(view.reactionArticles || [])]) {
        if (article && article.id && !byId.has(article.id)) byId.set(article.id, article);
      }
    }
  }
  return [...byId.values()];
}

// v2 2차 재랭킹 제거(David 승인, 2026-08-17 — "골라놓은 순서 그대로"). shadow
// 선별은 이미 `briefingOut.briefing`에 판 전체 정본 순서(분야별 중요도 층
// 오름차순 → 전체 S 내림차순)를 계산해 뒀다 — digest.js의 편집 문장 계층이
// 반응량으로 다시 정렬하지 못하게, 그 순서를 사건별 기사 id → 순위 맵으로
// 펴서 engine.editorialExternalRank(→ buildDigest externalRank)에 그대로
// 넘긴다. 사건의 대표·구성원·반응 기사 전부에 같은 순위를 매긴다 — digest.js가
// 자체 클러스터링(clusterIssues)에서 어느 멤버로 그 사건을 다시 묶어도 순위를
// 찾을 수 있게 하기 위해서다(재계산 금지 — 매핑만 찾는다).
export function shadowBriefingRankMap(briefingOut) {
  const rank = new Map();
  (briefingOut.briefing || []).forEach((entry, index) => {
    const view = entry && entry.view;
    if (!view) return;
    for (const article of [...(view.memberArticles || []), ...(view.reactionArticles || [])]) {
      if (article && article.id && !rank.has(article.id)) rank.set(article.id, index);
    }
  });
  return rank;
}

// ---------------------------------------------------------------------------
// 인프로세스 /api/today 호출 — createServer의 요청 핸들러를 리슨 없이 디스패치.
// ---------------------------------------------------------------------------
export async function dispatchGet(server, pathWithQuery) {
  const handler = server.listeners("request")[0];
  if (typeof handler !== "function") throw new Error("request handler not found");
  const req = {
    method: "GET",
    url: pathWithQuery,
    headers: { host: "localhost" },
    on() {},
    socket: { remoteAddress: "127.0.0.1" }
  };
  let status = 0;
  const headers = {};
  let body = "";
  const res = {
    req,
    writeHead(code, extra) { status = code; Object.assign(headers, extra || {}); return res; },
    setHeader(name, value) { headers[name] = value; },
    getHeader(name) { return headers[name]; },
    write(chunk) { body += chunk; return true; },
    end(chunk) { if (chunk !== undefined && typeof chunk !== "function") body += chunk; }
  };
  await handler(req, res);
  return { status, headers, body };
}

// 오늘판 한 벌을 인프로세스로 만든다. sources는 이미 수집된 기사(정규화 완료)를
// 감싼 인프로세스 소스 — 재수집(네트워크) 없음.
export async function buildTodayEditionInProcess({
  sources,
  nowMs,
  storeFile = null,
  poolFile = null,
  query = "/api/today",
  categoryRoutingSnapshot = null,
  translate = editionTranslate,
  // v2 전용(David 승인, 2026-08-17). v1 호출은 이 인자를 절대 넘기지 않는다 —
  // undefined → createServer의 opts.editorialExternalRank도 undefined라 v1
  // 동작은 바이트 그대로다.
  editorialExternalRank = null,
  directBuild = false,
  categories = null,
  slotId = null,
  editionDate = null,
  reserveIssues = 0,
  editorialPreselectedPool = false,
  editorialPreselectedReferenceMs = null
} = {}) {
  const previousPoolFile = process.env.FEED_POOL_FILE;
  // 웜캐시로 이전 실행의 (제한된) 풀이 새 판에 새어 들지 않게 비운다.
  if (poolFile) {
    process.env.FEED_POOL_FILE = poolFile;
    try { fs.rmSync(poolFile, { force: true }); } catch {}
  } else {
    delete process.env.FEED_POOL_FILE;
  }
  try {
    const { createServer } = await import("../src/feed/server.js");
    let engine = null;
    const preparedSources = translate && translate.targetLang
      ? sources.map((source) => new TranslatingSource(
          source,
          translate.translateFn,
          translate.targetLang
        ))
      : sources;
    const server = createServer({
      sources: preparedSources,
      localEditorial: true,
      slotCanonicalEditionEnabled: false,    // 생성기는 운영 포인터·예약기를 상속하지 않는다.
      localEditorialLlmEnabled: false,        // LLM 호출 0 계약
      localEditorialInventorySchedule: false, // 배경 재고 점검 없음(1회성 도구)
      file: storeFile,
      clock: () => nowMs,
      translate,
      vapid: null,
      ...(categoryRoutingSnapshot ? {
        categoryRoutingMode: "v2",
        categoryRoutingSnapshot
      } : {}),
      ...(editorialExternalRank ? { editorialExternalRank } : {}),
      editorialPreselectedPool,
      onEngineReady: (value) => {
        engine = value;
        if (Number.isFinite(editorialPreselectedReferenceMs)) {
          engine.editorialPreselectedReferenceMs = Number(editorialPreselectedReferenceMs);
        }
      }
    });
    if (directBuild) {
      if (!engine) throw new Error("direct edition engine unavailable");
      const edition = await engine.todayEdition({
        categories,
        slotId,
        asOfMs: nowMs,
        sharedCanonical: true,
        allowCarryover: false,
        reserveIssues,
        editionDate
      });
      const body = {
        ...edition,
        requestedCategories: edition.selection.categories.map((category) => category.id),
        serving: {
          state: "build_candidate",
          fallback: false,
          requestedDate: edition.editionDate,
          requestedSlotId: edition.slot.id,
          servedDate: edition.editionDate,
          servedSlotId: edition.slot.id
        }
      };
      return { status: 200, edition: body, body };
    }
    const response = await dispatchGet(server, query);
    let parsed = null;
    try { parsed = JSON.parse(response.body); } catch { parsed = null; }
    return { status: response.status, edition: response.status === 200 ? parsed : null, body: parsed };
  } finally {
    if (previousPoolFile === undefined) delete process.env.FEED_POOL_FILE;
    else process.env.FEED_POOL_FILE = previousPoolFile;
  }
}

// ---------------------------------------------------------------------------
// v1·v2 판 diff — 이슈의 refs(id·canonicalUrl) 겹침으로 같은 이슈인지 본다.
// ---------------------------------------------------------------------------
const issueKeys = (issue) => {
  const keys = new Set();
  for (const ref of (issue && issue.refs) || []) {
    if (ref && ref.canonicalUrl) keys.add(`u:${ref.canonicalUrl}`);
    if (ref && ref.id) keys.add(`i:${ref.id}`);
  }
  return keys;
};

export function editionIssueDiff(editionA, editionB) {
  const issuesA = (editionA && editionA.issues) || [];
  const issuesB = (editionB && editionB.issues) || [];
  const keysB = issuesB.map(issueKeys);
  const matchedB = new Set();
  let shared = 0;
  for (const issueA of issuesA) {
    const keys = issueKeys(issueA);
    const hit = keysB.findIndex((set, index) =>
      !matchedB.has(index) && [...keys].some((key) => set.has(key)));
    if (hit >= 0) { matchedB.add(hit); shared += 1; }
  }
  return {
    v1Issues: issuesA.length,
    v2Issues: issuesB.length,
    shared,
    v1Only: issuesA.length - shared,
    v2Only: issuesB.length - shared
  };
}

const appendRunlog = (dir, row) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "runlog.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
};

const fulfillmentSummary = (edition) => {
  const fulfillment = edition && edition.categoryFulfillment || {};
  return {
    issues: edition && edition.issues ? edition.issues.length : 0,
    metCount: fulfillment.metCount ?? null,
    selectedCount: fulfillment.selectedCount ?? null,
    goalSatisfied: fulfillment.goalSatisfied ?? null,
    partial: Boolean(edition && edition.partial),
    llmCalls: edition ? Number(edition.llmCalls) : null,
    sourceCount: edition ? edition.sourceCount ?? null : null,
    servingState: edition && edition.serving ? edition.serving.state : null
  };
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
  const outPaths = todayEditionPaths(V2_DIR, date, slotId);
  fs.mkdirSync(V2_DIR, { recursive: true });

  if (fs.existsSync(outPaths.v1) && fs.existsSync(outPaths.v2)) {
    appendRunlog(V2_DIR, { event: "editions-skip", date, slotId, reason: "edition-v1/v2 exist (idempotent)" });
    console.log(JSON.stringify({ status: "skip", date, slotId, reason: "이미 완료된 슬롯(edition-v1·v2 존재)" }));
    return;
  }

  // 인프로세스 편집 경로가 외부로 나가지 않게 — 이미지 보강·트렌드 캐시 off.
  process.env.FEED_ENRICH_IMAGES = "0";
  process.env.FEED_X_TRENDS = "0";

  let codeVersion = null;
  try { codeVersion = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); }
  catch { codeVersion = null; }

  try {
    // ── ① 수집 1회 (같은 슬롯 풀이 있으면 재사용 — 슬롯당 수집 1회 원칙) ──
    const { loadRegistry, buildSources } = await import("../src/feed/registry.js");
    const registry = loadRegistry();
    let articles;
    let poolSource;
    if (fs.existsSync(paths.pool)) {
      const parsed = JSON.parse(fs.readFileSync(paths.pool, "utf8"));
      articles = (parsed.rows || []).map((row) => row && row.item).filter(Boolean);
      poolSource = "reused";
      if (!articles.length) throw new Error(`풀 파일이 비어 있음: ${paths.pool}`);
    } else {
      const { makeFetcher } = await import("../src/feed/fetchers.js");
      const { FeedEngine } = await import("../src/feed/engine.js");
      const { FeedStore } = await import("../src/feed/store.js");
      process.env.FEED_POOL_FILE = paths.pool;
      const sources = buildSources(registry, {
        translate: editionTranslate,
        seed: false,
        fetcher: (entry) => makeFetcher(entry)()
      });
      const store = new FeedStore({ file: null });
      const engine = new FeedEngine(store, sources);
      await engine.refresh();
      articles = engine.poolRows().map((row) => row && row.item ? row.item : row).filter(Boolean);
      poolSource = "collected";
      delete process.env.FEED_POOL_FILE;
    }
    const poolHash = fs.existsSync(paths.pool)
      ? sha256Hex(fs.readFileSync(paths.pool, "utf8")) : null;

    // ── ② v2 새 선별 (수집 재사용, 선별은 순수 함수) ──
    const prevFile = findPreviousLineageFile(V2_DIR, date, slotId);
    const prevAll = prevFile ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
    const previousLineage = prevAll && prevAll.byCombo && prevAll.byCombo[V2_COMBO_KEY]
      ? prevAll.byCombo[V2_COMBO_KEY] : [];
    const v2Categories = listV2Categories();
    const shadowOut = shadowSelectBriefing(articles, {
      requestedCategories: v2Categories,
      now: asOf,
      slotId,
      registry,
      previousLineage
    });

    // ── ②-b 영수증·계보·v2 계약 판 — 기존 build-v2-edition 흐름 그대로.
    //        이미 있으면 손대지 않는다(그 실행의 영수증이 정본).
    let contractStatus = "existing";
    if (!v2SlotAlreadyDone(V2_DIR, date, slotId)) {
      const { hash, receipt } = shadowBriefingReceipt(shadowOut, { poolHash, codeVersion });
      const registryById = new Map((registry || []).filter(Boolean).map((entry) => [entry.id, entry]));
      const contractEdition = buildV2Edition(shadowOut, {
        date, slotId, generatedAt: new Date(asOf).toISOString(), codeVersion, registryById
      });
      const contractCheck = validateV2Edition(contractEdition);
      if (!contractCheck.ok) throw new Error(`v2 계약 자가 검증 실패: ${contractCheck.errors.join("; ")}`);
      fs.writeFileSync(paths.receipts, stableStringify({ [V2_COMBO_KEY]: { receiptHash: hash, receipt } }));
      fs.writeFileSync(paths.lineage, stableStringify({
        date, slotId, byCombo: { [V2_COMBO_KEY]: shadowOut.lineage.records }
      }));
      fs.writeFileSync(paths.edition, JSON.stringify(contractEdition, null, 1));
      fs.writeFileSync(paths.latest, JSON.stringify(contractEdition, null, 1));
      contractStatus = "written";
    }

    // ── ③ v1 판 — 전체 풀을 기존 편성 경로에 그대로 태운다 ──
    const v1Run = await buildTodayEditionInProcess({
      sources: groupArticlesAsSources(articles),
      nowMs,
      storeFile: path.join(V2_DIR, "v1-editorial-store.json"),
      poolFile: path.join(V2_DIR, "v1-inproc-pool.json")
    });

    // ── ④ v2 판 — 새 선별이 고른 클러스터 기사만 같은 편집 계층에 태운다.
    //        순위는 shadow S 정본(shadowBriefingRankMap)으로 고정 — 편집
    //        문장 계층(digest.js)은 문장만 만들고 다시 정렬하지 않는다.
    const shadowArticles = collectShadowArticles(shadowOut);
    const v2Run = await buildTodayEditionInProcess({
      sources: groupArticlesAsSources(shadowArticles),
      nowMs,
      storeFile: path.join(V2_DIR, "v2-editorial-store.json"),
      poolFile: path.join(V2_DIR, "v2-inproc-pool.json"),
      editorialExternalRank: shadowBriefingRankMap(shadowOut)
    });

    // ── ⑤ 자가 검증 + 기록 (불합격·비200은 파일을 쓰지 않는다 — 정직 실패) ──
    const results = {};
    for (const [label, run, file, latest] of [
      ["v1", v1Run, outPaths.v1, outPaths.v1Latest],
      ["v2", v2Run, outPaths.v2, outPaths.v2Latest]
    ]) {
      if (run.status !== 200 || !run.edition) {
        results[label] = {
          written: false, status: run.status,
          hold: run.body && (run.body.code || run.body.error) || null
        };
        continue;
      }
      const check = validateTodayEdition(run.edition);
      const llmOk = Number(run.edition.llmCalls) === 0;
      if (!check.ok || !llmOk) {
        results[label] = {
          written: false, status: 200,
          schemaErrors: check.errors.slice(0, 12),
          llmCalls: Number(run.edition.llmCalls)
        };
        continue;
      }
      fs.writeFileSync(file, JSON.stringify(run.edition, null, 1));
      fs.writeFileSync(latest, JSON.stringify(run.edition, null, 1));
      results[label] = { written: true, status: 200, ...fulfillmentSummary(run.edition) };
    }

    const diff = v1Run.edition && v2Run.edition
      ? editionIssueDiff(v1Run.edition, v2Run.edition) : null;

    const summary = {
      status: "run", date, slotId, publishHour,
      asOf: new Date(asOf).toISOString(), codeVersion,
      poolSource, poolHash, articles: articles.length,
      shadowArticles: shadowArticles.length,
      v2Contract: contractStatus,
      v1: results.v1, v2: results.v2, diff
    };
    appendRunlog(V2_DIR, {
      event: "editions-run", date, slotId, poolSource,
      articles: articles.length, shadowArticles: shadowArticles.length,
      v1Written: results.v1.written, v2Written: results.v2.written,
      diff
    });
    console.log(JSON.stringify(summary, null, 1));
    if (!results.v1.written || !results.v2.written) process.exitCode = 1;
  } catch (err) {
    appendRunlog(V2_DIR, { event: "editions-fail", date, slotId, error: String(err && err.message || err) });
    console.error(`신문형 판 생성 실패: ${err && err.stack || err}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
