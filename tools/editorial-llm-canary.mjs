#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EDITORIAL_LLM_CANARY_CONTRACT,
  makeEvidenceEditorialPipeline
} from "../src/feed/editorial-llm.js";
import { verifyEditorialLineage } from "../src/feed/editorial-lineage.js";

export { EDITORIAL_LLM_CANARY_CONTRACT };

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

export function assertLoopbackBase(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("canary base must be a local http loopback address");
  }
  return url;
}

export function assertCanaryExecutionAllowed(execute, env = process.env) {
  if (!execute) return "dry_run";
  if (env[EDITORIAL_LLM_CANARY_CONTRACT.approvalEnv] !== "1") {
    throw new Error(`${EDITORIAL_LLM_CANARY_CONTRACT.approvalEnv}=1 approval is required`);
  }
  if (!env[EDITORIAL_LLM_CANARY_CONTRACT.keyEnv]) {
    throw new Error(`${EDITORIAL_LLM_CANARY_CONTRACT.keyEnv} is required`);
  }
  return "execute";
}

export function selectDiverseCanaryIssues(issues, requestedLimit = EDITORIAL_LLM_CANARY_CONTRACT.maxIssues) {
  const limit = Math.max(1, Math.min(
    EDITORIAL_LLM_CANARY_CONTRACT.maxIssues,
    Math.floor(Number(requestedLimit) || EDITORIAL_LLM_CANARY_CONTRACT.maxIssues)
  ));
  const rows = Array.isArray(issues) ? issues : [];
  const selected = [];
  const selectedHashes = new Set();
  const coveredCategories = new Set();
  const add = (issue) => {
    const key = issue && (issue.evidenceHash || issue.eventKey || issue.id);
    if (!key || selectedHashes.has(key) || selected.length >= limit) return false;
    selected.push(issue);
    selectedHashes.add(key);
    for (const category of issue.categoryIds || []) coveredCategories.add(category);
    return true;
  };

  for (const issue of rows) {
    if ((issue.categoryIds || []).some((category) => !coveredCategories.has(category))) add(issue);
    if (selected.length >= limit) return selected;
  }
  for (const issue of rows) {
    add(issue);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function buildCanaryPlan(edition, { maxIssues = 3, execute = false } = {}) {
  const eligible = (edition && Array.isArray(edition.issues) ? edition.issues : [])
    .filter((issue) => verifyEditorialLineage(issue).pass);
  const selected = selectDiverseCanaryIssues(eligible, maxIssues);
  return {
    stableId: EDITORIAL_LLM_CANARY_CONTRACT.stableId,
    mode: execute ? "execute_requested" : "dry_run",
    sourceEditionId: edition && edition.editionId || null,
    sourceIssueCount: edition && edition.issues && edition.issues.length || 0,
    eligibleIssueCount: eligible.length,
    requestedIssueCount: selected.length,
    maxIssues: EDITORIAL_LLM_CANARY_CONTRACT.maxIssues,
    maxCalls: EDITORIAL_LLM_CANARY_CONTRACT.maxCalls,
    selected: selected.map((issue) => ({
      evidenceHash: issue.evidenceHash,
      subject: issue.subject,
      categoryIds: issue.categoryIds || []
    })),
    proves: "실제 호출 전 대상·범위·최대 호출 수가 제한됐음",
    doesNotProve: "실제 모델 품질·사람 검수 PASS·운영 배포"
  };
}

function issueDiff(before, after) {
  const fields = ["headline", "whatHappened", "whyImportant"];
  const changedFields = fields.filter((field) => {
    const beforeValue = field === "whatHappened" ? before.whatHappened || before.paragraph : before[field];
    const afterValue = field === "whatHappened" ? after.whatHappened || after.paragraph : after[field];
    return String(beforeValue || "") !== String(afterValue || "");
  });
  return {
    evidenceHash: before.evidenceHash,
    subject: before.subject,
    categoryIds: before.categoryIds || [],
    state: after.editorialEdit && after.editorialEdit.state || "deterministic_fallback",
    changedFields,
    before: {
      headline: before.headline,
      whatHappened: before.whatHappened || before.paragraph,
      whyImportant: before.whyImportant
    },
    after: {
      headline: after.headline,
      whatHappened: after.whatHappened || after.paragraph,
      whyImportant: after.whyImportant
    },
    verifierReason: after.editorialEdit && after.editorialEdit.verifierReason || null
  };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export async function runCanary(argv = process.argv.slice(2), env = process.env) {
  const execute = argv.includes("--execute");
  const mode = assertCanaryExecutionAllowed(execute, env);
  const base = assertLoopbackBase(argValue(argv, "--base", "http://127.0.0.1:4100"));
  const categories = argValue(argv, "--categories", "business,news,realestate")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const maxIssues = Math.max(1, Math.min(3, Number(argValue(argv, "--max-issues", "3")) || 3));
  const url = new URL("/api/today", base);
  url.searchParams.set("categories", categories.join(","));
  const slot = argValue(argv, "--slot");
  const date = argValue(argv, "--date");
  if (slot) url.searchParams.set("slot", slot);
  if (date) url.searchParams.set("date", date);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`local edition api ${response.status}`);
  const edition = await response.json();
  if (!edition.publishable) throw new Error("source edition is not publishable");
  const plan = buildCanaryPlan(edition, { maxIssues, execute });
  if (!plan.requestedIssueCount) throw new Error("no lineage-verified issues available for canary");
  if (mode === "dry_run") return { ...plan, externalCalls: 0 };

  const selectedHashes = new Set(plan.selected.map((row) => row.evidenceHash));
  const selectedIssues = edition.issues.filter((issue) => selectedHashes.has(issue.evidenceHash));
  const usage = [];
  const pipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.NOWHOT_EDITORIAL_MODEL || env.LLM_MODEL || "claude-sonnet-5",
    verifierModel: env.NOWHOT_EDITORIAL_VERIFIER_MODEL || "claude-haiku-4-5",
    maxIssues,
    onUsage: (row) => usage.push(row),
    log: (message) => process.stderr.write(`${message}\n`)
  });
  const canaryEdition = {
    ...edition,
    editionId: `${edition.editionId}:canary`,
    issues: selectedIssues
  };
  const result = await pipeline(canaryEdition);
  if (Number(result.editorialLlm && result.editorialLlm.calls || 0) > EDITORIAL_LLM_CANARY_CONTRACT.maxCalls) {
    throw new Error("canary call ceiling exceeded");
  }

  const receipt = {
    stableId: EDITORIAL_LLM_CANARY_CONTRACT.stableId,
    state: result.editorialLlm && result.editorialLlm.state || "unknown",
    executedAt: new Date().toISOString(),
    sourceEditionId: edition.editionId,
    categories,
    constraints: {
      localBase: base.origin,
      requestedIssueCount: selectedIssues.length,
      maxIssues: EDITORIAL_LLM_CANARY_CONTRACT.maxIssues,
      maxCalls: EDITORIAL_LLM_CANARY_CONTRACT.maxCalls
    },
    pipeline: result.editorialLlm,
    usage,
    totals: {
      calls: Number(result.editorialLlm && result.editorialLlm.calls || 0),
      inputTokens: usage.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0),
      outputTokens: usage.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0)
    },
    issues: selectedIssues.map((issue, index) => issueDiff(issue, result.issues[index])),
    proves: "승인된 로컬 단발 편집·독립 검증 호출의 실제 출력·토큰·폴백 상태",
    doesNotProve: "사람 A/B 품질 PASS·실제 세 슬롯·운영 배포"
  };
  const output = path.resolve(argValue(
    argv,
    "--output",
    path.join(os.tmpdir(), "nowhot-staging", "editorial-llm-canary.json")
  ));
  atomicWriteJson(output, receipt);
  return { ...receipt, output };
}

const main = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (main) {
  runCanary().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`editorial canary: ${error.message}\n`);
    process.exitCode = 1;
  });
}
