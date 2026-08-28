// NOWHOT D1-E — thin runner: prompt p3(grounding 규율 강제)로 canary 실행. D1-C/D1-D 파일은 read-only 재사용.
// 승인: David 2026-08-20 "3번 먼저 하자" (p3 canary ≈$0.057 → 통과 시 잔여 84건, 누적 상한 $1.25 유지).
//
// 경계: 새 프레임워크·중복 분류기 없음. 분류기·평가·ledger·게이트는 lab.js/run-d1c/run-d1d 재사용, D1-E 특유(p3·별도 ledger/dir/attempt)만.
// 실API는 --canary 단계의 https://api.anthropic.com/v1/messages만. 자동 retry 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  D1C_PRICING, D1C_SEMANTIC_SCHEMA, d1cTaxonomyVersion,
  runPricedClassification, budgetAllowsCall, estTokens, normalizeClassifierInput, buildStructuredRequest
} from "../src/feed/selection-classifier-lab.js";
import {
  operatorGroupFor, originDocumentIdFor, canaryItemIds, d1gCanaryItems, d1gReplacementGoldRows, buildUserPrompt, createFileLedger,
  FROZEN_CORPUS_SHA256, CANDIDATE_GOLD_SHA256, CANDIDATE_MODEL
} from "./run-selection-d1c.mjs";
import { itemsFromCorpus, evaluateCanaryD1d } from "./run-selection-d1d.mjs";
import { callStructuredMessage } from "../src/feed/llm.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (n) => path.join(ROOT, "test", "fixtures", n);
export const D1E_DIR = path.join(ROOT, ".nowhot-local", "selection-d1e");
export const D1E_LEDGER_PATH = path.join(D1E_DIR, "usage-ledger.jsonl");
export const D1E_LOCK_PATH = path.join(D1E_DIR, ".run-lock");
export const D1E_ATTEMPT_ID = "d1e-20260820-01";
export const D1E_PROMPT_VERSION = "nowhot-selection-d1e-p3";
// recovery = D1-C+D1-D 누적(재계산 cost) + D1-D 원본 SHA. seq 0 recovery.
export const D1D_CUMULATIVE = Object.freeze({ calls: 24, inputTokens: 41352, outputTokens: 14596,
  d1dLedgerSha256: "8011cc8394cc5666a5017f63b6e92d1783a33cb20e18fb014ba2c6f19c544c8a",
  d1dPredictionsSha256: "1391663f6faedff84622ebca851f08464a8143b183b89be614fb7f3c7e06a8c7",
  provenance: "d1d_canary_hold_ledger_recovery" });

// p3 prompt — D1-D 오프라인 진단(§22-보론) 겨냥: 남은 실패 4건 전부 grounding 규율.
// p2 대비 변경 = GEO 블록을 ASSERT-AND-QUOTE 프로토콜로 교체 + deal 항목 admission 1절 추가. 나머지는 p2 원문 유지(회귀 최소화).
export const D1E_SYSTEM = [
  "You are the admission classifier for NOWHOT (지금핫), a Korean news/community/deal aggregator.",
  "Return ONLY the semantic classification JSON for this one blind item.",
  "",
  "GEO GROUNDING PROTOCOL (event location, NOT outlet):",
  "- sourceCountry is the OUTLET's location and MUST NOT decide the event location. Outlet nationality, article language,",
  "  or overall vibe are NEVER location evidence.",
  "- ASSERT-AND-QUOTE OR NEITHER: you may put a country into eventJurisdictions ONLY if you also put at least one grounding",
  "  quote into geoEvidenceSpans, copied CHARACTER-FOR-CHARACTER from the title or excerpt (no translation, no paraphrase,",
  "  no composing new text). If you cannot copy such an exact quote, eventJurisdictions MUST be [] and geoEvidenceSpans",
  "  MUST be [] (scope becomes unknown). An asserted location without a copied quote is invalid output.",
  "- Concrete quotable fragments DO ground a jurisdiction: place/city names, government or institution names, retailer or",
  "  platform names, currency amounts, national laws or programs. Quote the exact fragment as it appears in the text.",
  "- relevanceCountries follow the same rule: only countries the event materially affects, each grounded by a copied quote.",
  "",
  "ADMISSION: judge each of the 14 taxonomy categories INDEPENDENTLY. A category is 'accept' ONLY if a user who selected",
  "that single category alone would want this item as a CORE topic. A mere mention, a merely structurally-similar headline,",
  "or an indirect/second-order effect is 'reject' (or 'abstain' if it is a real-but-secondary theme). Precision over volume.",
  "Accept TWO categories ONLY for a genuinely inseparable cross-domain event (e.g. a law that is jointly business AND politics);",
  "when both fields are the shared core, do not drop one of them.",
  "A deal/purchase offer is judged by the PRODUCT'S own domain: a discounted tech gadget is a core 'tech' item, a fashion",
  "deal is core 'fashion'. Do not reject a category merely because the format is promotional.",
  "",
  "contentType is FORMAT (news=reporting, community=user post, deal=purchase offer, other=otherwise), distinct from the",
  "'news' TOPIC. Do not accept the 'news' topic merely because the format is news. If contentType='other' or there is no",
  "accept, primaryCategory MUST be 'unknown'.",
  "",
  "Grounding: every accept evidenceSpans entry and every geoEvidenceSpans entry MUST be an exact substring of the title",
  "or excerpt; accept rows also need non-empty reasonCodes. Never invent spans.",
  "When evidence is insufficient, use unknown/other/abstain — never force a classification.",
  "Never use any gold answer or user-selected category; you only receive the blind fields below.",
  "",
  "admissionCategories MUST contain exactly one row for each of the 14 taxonomy ids (decision accept|abstain|reject,",
  "confidence in [0,1], evidenceSpans, reasonCodes)."
].join("\n");

export function versionsForD1e() {
  return { modelVersion: CANDIDATE_MODEL, promptVersion: D1E_PROMPT_VERSION, taxonomyVersion: d1cTaxonomyVersion() };
}
export function makeCallModelP3(apiKey) {
  return async ({ request, timeoutMs }) => {
    const { parsed, usage } = await callStructuredMessage({
      apiKey, model: CANDIDATE_MODEL, system: D1E_SYSTEM, prompt: buildUserPrompt(request),
      schema: D1C_SEMANTIC_SCHEMA, maxTokens: 1800, timeoutMs, purpose: "d1e-classify"
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

// D1-E ledger 초기화(recovery = D1-C+D1-D 누적). wx로 한 번만.
export function initD1eLedger() {
  fs.mkdirSync(D1E_DIR, { recursive: true });
  if (fs.existsSync(D1E_LEDGER_PATH)) return { status: "exists" };
  const led = createFileLedger(D1E_LEDGER_PATH, { requireExisting: false });
  led.append({ type: "recovery", calls: D1D_CUMULATIVE.calls, inputTokens: D1D_CUMULATIVE.inputTokens, outputTokens: D1D_CUMULATIVE.outputTokens,
    derivedCostUsd: round6(D1C_PRICING.inputPerMTok * D1D_CUMULATIVE.inputTokens / 1e6 + D1C_PRICING.outputPerMTok * D1D_CUMULATIVE.outputTokens / 1e6),
    d1dLedgerSha256: D1D_CUMULATIVE.d1dLedgerSha256, d1dPredictionsSha256: D1D_CUMULATIVE.d1dPredictionsSha256, provenance: D1D_CUMULATIVE.provenance });
  return { status: "initialized", summary: led.summary(D1C_PRICING) };
}

// canary 12건 정확히 1회. 예산: 증분 canary $0.20, 누적(=recovery+이번) $1.25. 게이트는 D1-D와 동일(evaluateCanaryD1d 재사용).
async function stepCanary({ getApiKey = keychainApiKey } = {}) {
  const hold = (status, msg) => { process.stdout.write(`${status}: ${msg} (0 API/Keychain/write beyond stated)\n`); return { status, message: msg }; };
  const { corpus, gold } = loadCorpusGold();
  const versions = versionsForD1e();
  let locked = false;
  try { fs.mkdirSync(D1E_DIR, { recursive: true }); fs.writeFileSync(D1E_LOCK_PATH, `${D1E_ATTEMPT_ID}\n`, { flag: "wx", mode: 0o600 }); locked = true; }
  catch (e) { if (e && e.code === "EEXIST") return hold("RUN_IN_PROGRESS_HOLD", "d1e lock held"); throw e; }
  try {
    const ledger = createFileLedger(D1E_LEDGER_PATH); // 없으면 throw
    const led0 = ledger.summary(D1C_PRICING);
    if (led0.unsettledReserves > 0) return hold("UNSETTLED_USAGE_HOLD", `${led0.unsettledReserves} unsettled`);
    // P1-1: canary = authority decisive 10(대체 d1g-11/12 포함·감사용 d1a-07/10 제외) + mutation 2
    const canaryItems = d1gCanaryItems(corpus);
    const incBudget = { maxCalls: led0.calls + 12, maxInputTokens: 1e7, maxOutputTokens: 1e7, maxOutputTokensPerCall: 1800, maxCostUsd: round6(led0.costUsd + 0.20), perCallTimeoutMs: 60000, totalDeadlineMs: 45 * 60 * 1000 };
    const totalCapCost = 1.25;
    const cache = new Map();
    let needsCall = 0, anyCallable = false;
    for (const raw of canaryItems) {
      const req = buildStructuredRequest(normalizeClassifierInput(raw), versions);
      needsCall += 1;
      const est = estTokens(req);
      if (budgetAllowsCall({ lifetimeCalls: led0.calls, lifetimeInput: led0.inputTokens, lifetimeOutput: led0.outputTokens, estInput: est, budget: incBudget, pricing: D1C_PRICING })
        && budgetAllowsCall({ lifetimeCalls: led0.calls, lifetimeInput: led0.inputTokens, lifetimeOutput: led0.outputTokens, estInput: est, budget: { ...incBudget, maxCostUsd: totalCapCost }, pricing: D1C_PRICING })) { anyCallable = true; break; }
    }
    if (needsCall > 0 && !anyCallable) return hold("BUDGET_PRECONDITION_HOLD", `no callable canary item within incremental $0.20 / cumulative $1.25 (lifetime cost $${round6(led0.costUsd)})`);
    awx(D1E_DIR, "canary-preflight.json", { attemptId: D1E_ATTEMPT_ID, model: CANDIDATE_MODEL, promptVersion: versions.promptVersion, taxonomyVersion: versions.taxonomyVersion,
      incrementalCapUsd: 0.20, cumulativeCapUsd: totalCapCost, priorLifetime: led0, canaryCount: canaryItems.length });
    const apiKey = getApiKey();
    if (!apiKey) return { status: "MODEL_KEY_MISSING" };
    const callModel = makeCallModelP3(apiKey);
    const opts = { versions, operatorGroupOf: operatorGroupFor, originDocumentIdOf: originDocumentIdFor, pricing: D1C_PRICING, now: () => Date.now() };
    const canaryBudget = { ...incBudget, maxCostUsd: Math.min(incBudget.maxCostUsd, totalCapCost) };
    const run = await runPricedClassification({ items: canaryItems, callModel, cache, ...opts, budget: canaryBudget, ledger, attemptId: D1E_ATTEMPT_ID, phase: "canary" });
    if (run.stats.aborted) { const ls = ledger.summary(D1C_PRICING); awx(D1E_DIR, "canary-run-receipt.json", { attemptId: D1E_ATTEMPT_ID, status: "UNSETTLED_USAGE_HOLD", reason: run.stats.abortReason, lifetime: ls, effect: { keyReads: 1, providerCalls: run.stats.calls } }); process.stdout.write(`UNSETTLED_USAGE_HOLD: ${run.stats.abortReason} (provider ${run.stats.calls}x)\n`); return { status: "UNSETTLED_USAGE_HOLD" }; }
    const preds = run.results.map(predictionOf);
    awx(D1E_DIR, "canary-predictions.json", { versions, results: preds });
    const gate = evaluateCanaryD1d({ corpus, gold, canaryItems, canaryPreds: preds, versions, gates: loadGates() });
    const lifetime = ledger.summary(D1C_PRICING);
    const receipt = { attemptId: D1E_ATTEMPT_ID, model: CANDIDATE_MODEL, promptVersion: versions.promptVersion, status: gate.pass ? "CANARY_PASS" : "D1E_CANARY_HOLD",
      canary: { classified: run.stats.classified, cacheHits: run.stats.cacheHits, errors: run.stats.errors, schemaReject: run.stats.schemaReject,
        inputTokens: run.stats.inputTokens, outputTokens: run.stats.outputTokens, costUsd: round6(run.stats.costUsd) },
      gate, lifetime, effect: { keyReads: 1, providerCalls: run.stats.calls } };
    awx(D1E_DIR, "canary-run-receipt.json", receipt);
    process.stdout.write(`D1E canary: ${gate.pass ? "CANARY_PASS" : "D1E_CANARY_HOLD"} | adv ${gate.adversarialDetail ? JSON.stringify(gate.adversarialDetail) : "?"} | mutation01 ${gate.mutationLabelChanged} | cost $${round6(run.stats.costUsd)} lifetime $${round6(lifetime.costUsd)}\n`);
    return { status: gate.pass ? "CANARY_PASS" : "D1E_CANARY_HOLD", gate, receipt };
  } finally { if (locked) { try { fs.unlinkSync(D1E_LOCK_PATH); } catch { /* controlled */ } } }
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--init-ledger") { const r = initD1eLedger(); process.stdout.write(`d1e ledger: ${r.status} ${r.summary ? JSON.stringify(r.summary) : ""}\n`); return; }
  if (arg === "--canary") { await stepCanary(); return; }
  process.stderr.write("usage: node tools/run-selection-d1e.mjs --init-ledger | --canary\n");
  process.exitCode = 2;
}
if (import.meta.url === `file://${process.argv[1]}`) { main().catch((e) => { process.stderr.write(`d1e error: ${e.message}\n`); process.exit(1); }); }
