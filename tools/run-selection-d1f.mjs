// NOWHOT D1-F — 단일변수 실험: D1-E p3 프롬프트(SHA 769b2d40) 그대로, 호출 모델만
// 저장소 정의 claude-sonnet-5(src/feed/costs.js MODEL_PRICING)로 교체해 canary 1회.
// 승인: David 2026-08-20 "결정: 1번 Sonnet canary만 진행한다."
//
// 목적: haiku-4-5의 5→6→6 정체가 프롬프트 문제인지 모델 능력 한계인지 확인.
// 경계: canary 1회만·항목당 호출 1회·retry 0·증분 $0.30·누적 $1.25(D1-C~E 실비 $0.173198 포함)·
//       PASS여도 full 진행 없음. corpus·fixture·정본·기존 산출물·llm.js 무수정.
// 단가 혼합 왜곡 방지: D1-F ledger는 recovery 없이 sonnet 호출만 기록(단가 $3/$15, costs.js 정가).
//   과거 haiku 실비는 상수 PRIOR_CUMULATIVE(비용 공간, sealed receipt lifetime + 원본 SHA)로 지참,
//   누적 게이트는 "남은 여유 = 1.25 - prior"를 이 ledger 예산 상한으로 써서 같은 순수함수로 판정.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  D1C_SEMANTIC_SCHEMA, d1cTaxonomyVersion,
  runPricedClassification, budgetAllowsCall, estTokens, normalizeClassifierInput, buildStructuredRequest
} from "../src/feed/selection-classifier-lab.js";
import {
  operatorGroupFor, originDocumentIdFor, canaryItemIds, d1gCanaryItems, d1gReplacementGoldRows, buildUserPrompt, createFileLedger,
  FROZEN_CORPUS_SHA256, CANDIDATE_GOLD_SHA256
} from "./run-selection-d1c.mjs";
import { itemsFromCorpus, evaluateCanaryD1d } from "./run-selection-d1d.mjs";
import { D1E_SYSTEM, D1E_PROMPT_VERSION } from "./run-selection-d1e.mjs";
import { MODEL_PRICING } from "../src/feed/costs.js";
import { callStructuredMessage } from "../src/feed/llm.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (n) => path.join(ROOT, "test", "fixtures", n);
export const D1F_DIR = path.join(ROOT, ".nowhot-local", "selection-d1f");
export const D1F_LEDGER_PATH = path.join(D1F_DIR, "usage-ledger.jsonl");
export const D1F_LOCK_PATH = path.join(D1F_DIR, ".run-lock");
export const D1F_ATTEMPT_ID = "d1f-20260820-01";
export const D1F_MODEL = "claude-sonnet-5"; // 저장소 정의(src/feed/llm.js 기본값·costs.js 단가 등록)
// costs.js 정가에서 파생(도입가 $2/$10는 쓰지 않음 — 보수적/고정 회계). 등록 단가와 불일치 시 즉시 throw.
if (!MODEL_PRICING[D1F_MODEL] || MODEL_PRICING[D1F_MODEL].in !== 3.0 || MODEL_PRICING[D1F_MODEL].out !== 15.0) {
  throw new Error("D1F: costs.js MODEL_PRICING[claude-sonnet-5] drift");
}
export const D1F_PRICING = Object.freeze({ inputPerMTok: 3.0, outputPerMTok: 15.0 });
// 고정 조건: D1-E p3 프롬프트 SHA(§23에서 동결한 769b2d40863ab55b) — 대조 실패 시 호출 전 HOLD.
export const P3_SYSTEM_SHA16 = "769b2d40863ab55b";
// D1-C+D1-D+D1-E 실비 누적(sealed D1-E receipt lifetime, haiku 단가 $1/$5 기준) + 원본 SHA.
export const PRIOR_CUMULATIVE = Object.freeze({ costUsd: 0.173198, calls: 36, inputTokens: 64938, outputTokens: 21652,
  d1eLedgerSha256: "5cf67acd0d80dbe59fdcb906e2e3d1730c1432807f0d521bae65fb1a8591552c",
  d1eReceiptSha256: "e69e79255ee612c9834b2e0095017c993cb6c208a0cc17b2d91059480790abc7",
  provenance: "d1e_canary_hold_receipt_lifetime" });
export const D1F_INCREMENTAL_CAP_USD = 0.30;
export const TOTAL_CAP_USD = 1.25;

export function versionsForD1f() {
  return { modelVersion: D1F_MODEL, promptVersion: D1E_PROMPT_VERSION, taxonomyVersion: d1cTaxonomyVersion() };
}
// llm.js 무수정으로 응답의 실제 resolved model을 잡는다: fetchImpl 주입(공식 파라미터) + clone.
export function makeCallModelSonnet(apiKey, resolvedModels) {
  const capturingFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    try { const j = await res.clone().json(); if (j && typeof j.model === "string") resolvedModels.add(j.model); } catch { /* 진단용 캡처 실패는 무시 */ }
    return res;
  };
  return async ({ request, timeoutMs }) => {
    const { parsed, usage } = await callStructuredMessage({
      apiKey, model: D1F_MODEL, system: D1E_SYSTEM, prompt: buildUserPrompt(request),
      schema: D1C_SEMANTIC_SCHEMA, maxTokens: 1800, timeoutMs, purpose: "d1f-classify", fetchImpl: capturingFetch
    });
    return { semantic: parsed, usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } };
  };
}

const sha256 = (buf) => execFileSync("shasum", ["-a", "256"], { input: buf }).toString().split(" ")[0];
const readRaw = (p) => fs.readFileSync(p, "utf8");
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

function keychainApiKey() {
  if (isNonEmptyStr(process.env.ANTHROPIC_API_KEY)) return process.env.ANTHROPIC_API_KEY;
  try { const out = execFileSync("security", ["find-generic-password", "-s", "nowhot-anthropic-api", "-w"], { encoding: "utf8" }); const k = (out || "").trim(); return isNonEmptyStr(k) ? k : null; }
  catch { return null; }
}
function loadCorpusGold() {
  const corpusRaw = readRaw(FIX("selection-d1-corpus.json"));
  if (sha256(corpusRaw) !== FROZEN_CORPUS_SHA256) throw new Error("corpus SHA drift");
  const goldRaw = readRaw(FIX("selection-d1-gold.json"));
  if (sha256(goldRaw) !== CANDIDATE_GOLD_SHA256) throw new Error("gold SHA drift");
  return { corpus: JSON.parse(corpusRaw), gold: JSON.parse(goldRaw) };
}
function loadGates() { return JSON.parse(readRaw(FIX("selection-d1-gates.lock.json"))); }
function awx(dir, name, value) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
function predictionOf(r) { if (!r) return { itemId: null, status: "error" }; const b = { itemId: r.itemId, status: r.status }; if (r.status === "classified" || r.status === "cache_hit") b.classification = r.classification; else if (r.reason) b.reason = r.reason; return b; }
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// canary 12건 정확히 1회. PASS여도 full 진행 없음(해당 스텝 자체가 없음).
async function stepCanary({ getApiKey = keychainApiKey } = {}) {
  const hold = (status, msg) => { process.stdout.write(`${status}: ${msg} (0 API/Keychain/write beyond stated)\n`); return { status, message: msg }; };
  // 고정 조건 SHA 대조(호출 전, fail-closed): p3 프롬프트 + prior 원본(D1-E ledger·receipt).
  const p3sha = crypto.createHash("sha256").update(D1E_SYSTEM).digest("hex").slice(0, 16);
  if (p3sha !== P3_SYSTEM_SHA16) return hold("PRECONDITION_HOLD", `p3 prompt SHA drift ${p3sha}!=${P3_SYSTEM_SHA16}`);
  const d1eLedgerSha = sha256(readRaw(path.join(ROOT, ".nowhot-local", "selection-d1e", "usage-ledger.jsonl")));
  const d1eReceiptSha = sha256(readRaw(path.join(ROOT, ".nowhot-local", "selection-d1e", "canary-run-receipt.json")));
  if (d1eLedgerSha !== PRIOR_CUMULATIVE.d1eLedgerSha256 || d1eReceiptSha !== PRIOR_CUMULATIVE.d1eReceiptSha256) {
    return hold("PRECONDITION_HOLD", "prior D1-E artifact SHA drift");
  }
  const { corpus, gold } = loadCorpusGold();
  const versions = versionsForD1f();
  let locked = false;
  try { fs.mkdirSync(D1F_DIR, { recursive: true }); fs.writeFileSync(D1F_LOCK_PATH, `${D1F_ATTEMPT_ID}\n`, { flag: "wx", mode: 0o600 }); locked = true; }
  catch (e) { if (e && e.code === "EEXIST") return hold("RUN_IN_PROGRESS_HOLD", "d1f lock held"); throw e; }
  try {
    const ledger = createFileLedger(D1F_LEDGER_PATH, { requireExisting: false }); // sonnet 호출만 기록(recovery 없음)
    const led0 = ledger.summary(D1F_PRICING);
    if (led0.unsettledReserves > 0) return hold("UNSETTLED_USAGE_HOLD", `${led0.unsettledReserves} unsettled`);
    if (led0.calls > 0) return hold("D1F_CONSUMED_HOLD", `d1f canary already ran (${led0.calls} calls) — 1회 한정`);
    // P1-1: canary = authority decisive 10(대체 d1g-11/12 포함·감사용 d1a-07/10 제외) + mutation 2
    const canaryItems = d1gCanaryItems(corpus);
    // 예산: 이 ledger(=sonnet 신규분)에 증분 $0.30, 누적은 "1.25 - prior 실비"를 상한으로 같은 순수함수 판정.
    const remainingHeadroom = round6(TOTAL_CAP_USD - PRIOR_CUMULATIVE.costUsd);
    const incBudget = { maxCalls: led0.calls + 12, maxInputTokens: 1e7, maxOutputTokens: 1e7, maxOutputTokensPerCall: 1800, maxCostUsd: round6(led0.costUsd + D1F_INCREMENTAL_CAP_USD), perCallTimeoutMs: 60000, totalDeadlineMs: 45 * 60 * 1000 };
    const cache = new Map();
    let needsCall = 0, anyCallable = false;
    for (const raw of canaryItems) {
      const req = buildStructuredRequest(normalizeClassifierInput(raw), versions);
      needsCall += 1;
      const est = estTokens(req);
      if (budgetAllowsCall({ lifetimeCalls: led0.calls, lifetimeInput: led0.inputTokens, lifetimeOutput: led0.outputTokens, estInput: est, budget: incBudget, pricing: D1F_PRICING })
        && budgetAllowsCall({ lifetimeCalls: led0.calls, lifetimeInput: led0.inputTokens, lifetimeOutput: led0.outputTokens, estInput: est, budget: { ...incBudget, maxCostUsd: remainingHeadroom }, pricing: D1F_PRICING })) { anyCallable = true; break; }
    }
    if (needsCall > 0 && !anyCallable) return hold("BUDGET_PRECONDITION_HOLD", `no callable canary item within incremental $${D1F_INCREMENTAL_CAP_USD} / cumulative $${TOTAL_CAP_USD} (prior $${PRIOR_CUMULATIVE.costUsd})`);
    awx(D1F_DIR, "canary-preflight.json", { attemptId: D1F_ATTEMPT_ID, model: D1F_MODEL, promptVersion: versions.promptVersion, promptSystemSha16: p3sha,
      taxonomyVersion: versions.taxonomyVersion, pricing: D1F_PRICING, incrementalCapUsd: D1F_INCREMENTAL_CAP_USD, cumulativeCapUsd: TOTAL_CAP_USD,
      priorCumulative: PRIOR_CUMULATIVE, canaryCount: canaryItems.length, singleVariable: "model only (p3 prompt, items, order, gold, schema, scorer identical to D1-E)" });
    const apiKey = getApiKey();
    if (!apiKey) return { status: "MODEL_KEY_MISSING" };
    const resolvedModels = new Set();
    const callModel = makeCallModelSonnet(apiKey, resolvedModels);
    const opts = { versions, operatorGroupOf: operatorGroupFor, originDocumentIdOf: originDocumentIdFor, pricing: D1F_PRICING, now: () => Date.now() };
    const canaryBudget = { ...incBudget, maxCostUsd: Math.min(incBudget.maxCostUsd, remainingHeadroom) };
    const run = await runPricedClassification({ items: canaryItems, callModel, cache, ...opts, budget: canaryBudget, ledger, attemptId: D1F_ATTEMPT_ID, phase: "canary" });
    if (run.stats.aborted) { const ls = ledger.summary(D1F_PRICING); awx(D1F_DIR, "canary-run-receipt.json", { attemptId: D1F_ATTEMPT_ID, status: "UNSETTLED_USAGE_HOLD", reason: run.stats.abortReason, lifetime: ls, resolvedModels: [...resolvedModels], effect: { keyReads: 1, providerCalls: run.stats.calls } }); process.stdout.write(`UNSETTLED_USAGE_HOLD: ${run.stats.abortReason} (provider ${run.stats.calls}x)\n`); return { status: "UNSETTLED_USAGE_HOLD" }; }
    const preds = run.results.map(predictionOf);
    awx(D1F_DIR, "canary-predictions.json", { versions, results: preds });
    const gate = evaluateCanaryD1d({ corpus, gold, canaryItems, canaryPreds: preds, versions, gates: loadGates() });
    const lifetime = ledger.summary(D1F_PRICING);
    const trueCumulativeUsd = round6(PRIOR_CUMULATIVE.costUsd + lifetime.costUsd);
    const receipt = { attemptId: D1F_ATTEMPT_ID, model: D1F_MODEL, resolvedModels: [...resolvedModels], promptVersion: versions.promptVersion, promptSystemSha16: p3sha,
      status: gate.pass ? "CANARY_PASS" : "D1F_CANARY_HOLD",
      canary: { classified: run.stats.classified, cacheHits: run.stats.cacheHits, errors: run.stats.errors, schemaReject: run.stats.schemaReject,
        inputTokens: run.stats.inputTokens, outputTokens: run.stats.outputTokens, costUsd: round6(run.stats.costUsd) },
      gate, lifetimeThisAttempt: lifetime, priorCumulativeUsd: PRIOR_CUMULATIVE.costUsd, trueCumulativeUsd,
      effect: { keyReads: 1, providerCalls: run.stats.calls, retries: 0 } };
    awx(D1F_DIR, "canary-run-receipt.json", receipt);
    process.stdout.write(`D1F canary: ${receipt.status} | resolved ${[...resolvedModels].join(",") || "?"} | adv ${gate.adversarialDetail ? JSON.stringify(gate.adversarialDetail) : "?"} | mutation01 ${gate.mutationLabelChanged} | cost $${round6(run.stats.costUsd)} trueCumulative $${trueCumulativeUsd}\n`);
    return { status: receipt.status, gate, receipt };
  } finally { if (locked) { try { fs.unlinkSync(D1F_LOCK_PATH); } catch { /* controlled */ } } }
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--canary") { await stepCanary(); return; }
  process.stderr.write("usage: node tools/run-selection-d1f.mjs --canary\n");
  process.exitCode = 2;
}
if (import.meta.url === `file://${process.argv[1]}`) { main().catch((e) => { process.stderr.write(`d1f error: ${e.message}\n`); process.exit(1); }); }
