#!/usr/bin/env node
// P4 LLM 편집 canary — 고정 표본 한정 실측 도구.
//
// David 승인 범위: canary 실측만(비용·지연·미지원 주장률 측정). 상시 ON은
// 이 실측 이후 별도 결정. 라이브·VM·4100 서버는 절대 건드리지 않는다 — 이
// 도구는 로컬 서버를 호출하지 않고 tools/fixed-eval-samples.mjs의 동결
// 표본만 입력으로 쓴다.
//
// ANTHROPIC_API_KEY가 없으면 실호출 없이 프롬프트 구성·토큰 근사치만
// 계산하고 "실호출 미수행(키 부재)"를 정직히 표시한다 — 가짜 수치 금지.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FIXED_EVAL_SAMPLES, FIXED_EVAL_SAMPLE_NOTE } from "./fixed-eval-samples.mjs";
import {
  CANARY_FIXED_SAMPLE_CONTRACT,
  CANARY_FIXED_SAMPLE_SCHEMA,
  CANARY_FIXED_SAMPLE_SYSTEM,
  buildCanaryFixedSamplePrompt,
  unsupportedClaimRateForDraft,
  compareToRuleBasedBaseline
} from "../src/feed/editorial-llm.js";
import { callStructuredMessage } from "../src/feed/llm.js";

export const CANARY_MODELS = ["claude-haiku-4-5", "claude-sonnet-5"];

// $ per 1K 토큰. Sonnet 5는 2026-08-31까지 도입가($2/$10 per MTok) 적용
// 구간이라 오늘(2026-08-17) 기준 도입가를 쓴다 — claude-api 스킬 캐시된
// 가격표(2026-06-24) 근거. 정가($3/$15)로 바뀌면 이 표를 갱신해야 한다.
export const CANARY_PRICING_PER_1K_USD = Object.freeze({
  "claude-haiku-4-5": { input: 1.00 / 1000, output: 5.00 / 1000, note: "정가" },
  "claude-sonnet-5": { input: 2.00 / 1000, output: 10.00 / 1000, note: "도입가(2026-08-31까지, 정가 $3/$15)" }
});

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// API 미호출 시의 대략치 — 절대 "실측"이라 부르지 않는다. Claude count_tokens
// 엔드포인트 자체도 인증이 필요해 키 없이는 진짜 토큰 수를 알 방법이 없다.
export function roughTokenEstimate(text) {
  return Math.ceil(String(text || "").length / 2.3);
}

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = CANARY_PRICING_PER_1K_USD[model];
  if (!pricing) return null;
  return {
    usd: (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output,
    pricingNote: pricing.note
  };
}

function corpusFor(sample) {
  return (sample.members || []).map((m) => `${m.title} ${m.excerpt || ""}`).join(" ");
}

async function measureSampleWithModel(sample, model, { apiKey, fetchImpl = fetch } = {}) {
  const prompt = buildCanaryFixedSamplePrompt(sample);
  if (!apiKey) {
    const inputEstimate = roughTokenEstimate(CANARY_FIXED_SAMPLE_SYSTEM + prompt);
    return {
      sampleNo: sample.sampleNo, label: sample.label, model,
      mode: "dry_run_no_key",
      promptChars: prompt.length,
      estimatedInputTokensRough: inputEstimate,
      note: "실호출 미수행(키 부재) — 토큰·비용·지연 수치 없음. count_tokens API도 인증이 필요해 정확한 사전 추정 불가."
    };
  }

  const t0 = Date.now();
  let out;
  try {
    out = await callStructuredMessage({
      apiKey, model, system: CANARY_FIXED_SAMPLE_SYSTEM, prompt,
      schema: CANARY_FIXED_SAMPLE_SCHEMA,
      maxTokens: 1200,
      fetchImpl,
      purpose: "P4 canary 고정표본 편집 측정"
    });
  } catch (error) {
    return { sampleNo: sample.sampleNo, label: sample.label, model, mode: "error", error: error.message };
  }
  const latencyMs = Date.now() - t0;
  const draft = (out.parsed.issues || []).find((row) => row.sampleNo === sample.sampleNo) || null;
  if (!draft) {
    return {
      sampleNo: sample.sampleNo, label: sample.label, model, mode: "no_draft_returned",
      latencyMs, usage: out.usage
    };
  }
  const claims = unsupportedClaimRateForDraft(draft, sample);
  const ruleCompare = compareToRuleBasedBaseline(draft, sample);
  const inputTokens = out.usage.input_tokens || 0;
  const outputTokens = out.usage.output_tokens || 0;
  const cost = estimateCostUsd(model, inputTokens, outputTokens);

  return {
    sampleNo: sample.sampleNo, label: sample.label, model,
    mode: "executed",
    latencyMs,
    inputTokens, outputTokens,
    costUsd: cost && cost.usd,
    pricingNote: cost && cost.pricingNote,
    draft,
    unsupportedClaimCheck: claims,
    ruleBasedComparison: ruleCompare
  };
}

export async function runFixedSampleCanary({
  apiKey = process.env.ANTHROPIC_API_KEY || null,
  models = CANARY_MODELS,
  samples = FIXED_EVAL_SAMPLES,
  fetchImpl = fetch
} = {}) {
  const results = [];
  for (const sample of samples) {
    for (const model of models) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await measureSampleWithModel(sample, model, { apiKey, fetchImpl }));
    }
  }
  const executed = results.filter((r) => r.mode === "executed");
  const summary = {
    contractId: CANARY_FIXED_SAMPLE_CONTRACT.stableId,
    executedAt: new Date().toISOString(),
    keyPresent: Boolean(apiKey),
    sampleCount: samples.length,
    modelsCompared: models,
    fixedEvalSampleNote: FIXED_EVAL_SAMPLE_NOTE,
    totals: executed.length ? {
      calls: executed.length,
      totalInputTokens: executed.reduce((s, r) => s + (r.inputTokens || 0), 0),
      totalOutputTokens: executed.reduce((s, r) => s + (r.outputTokens || 0), 0),
      totalCostUsd: executed.reduce((s, r) => s + (r.costUsd || 0), 0),
      unsupportedClaimRate: executed.length
        ? executed.filter((r) => r.unsupportedClaimCheck && !r.unsupportedClaimCheck.pass).length / executed.length
        : null
    } : null,
    proves: apiKey
      ? "지정 모델별 고정 표본 실제 호출의 토큰·비용·지연·미지원 주장 검출"
      : "프롬프트 설계·표본 커버리지 — 실제 비용·지연·미지원 주장률은 키 부재로 미측정",
    doesNotProve: "사람 품질 판정·상시 ON 여부·운영 배포 효과"
  };
  return { summary, results };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function main() {
  const argv = process.argv.slice(2);
  const output = path.resolve(argValue(
    argv, "--output",
    path.join(os.tmpdir(), "nowhot-staging", "editorial-llm-fixed-sample-canary.json")
  ));
  const result = await runFixedSampleCanary();
  atomicWriteJson(output, result);
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  process.stdout.write(`전체 결과: ${output}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`fixed-sample canary: ${error.message}\n`);
    process.exitCode = 1;
  });
}
