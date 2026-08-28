// NOWHOT D1-G/D1-H candidate registry loader.
// Product prompts, model aliases, pricing and execution state live in JSON data;
// this module only validates, resolves and exposes that data.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ADMISSION_CATEGORY_IDS } from "../src/feed/selection-contract.js";
import {
  CATEGORY_ADMISSION_POLICY,
  renderCategoryAdmissionPrompt
} from "../src/feed/category-admission-policy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CANDIDATE_REGISTRY_PATH = path.join(ROOT, "test", "fixtures", "selection-d1-candidates.json");

const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const CATEGORY_IDS = new Set(ADMISSION_CATEGORY_IDS);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(message) {
  throw new Error(`CANDIDATE_REGISTRY_CORRUPT: ${message}`);
}

export function parseCandidateRegistry(raw) {
  let document;
  try { document = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw); }
  catch (error) { fail(`JSON parse failed: ${error.message}`); }
  if (!isObject(document) || document.contract !== "NOWHOT-SELECTION-CANDIDATE-REGISTRY-001" || document.schemaVersion !== 1) {
    fail("contract/schemaVersion mismatch");
  }
  if (!isObject(document.models) || !isObject(document.prompts) || !Array.isArray(document.candidates)) {
    fail("models, prompts and candidates are required");
  }

  const promptCache = new Map();
  const resolvePrompt = (promptId, stack = new Set()) => {
    if (promptCache.has(promptId)) return promptCache.get(promptId);
    const prompt = document.prompts[promptId];
    if (!isObject(prompt) || !isText(prompt.promptVersion) || !/^[0-9a-f]{64}$/.test(prompt.promptSha256 || "")) {
      fail(`invalid prompt '${promptId}'`);
    }
    if (stack.has(promptId)) fail(`prompt cycle '${promptId}'`);
    stack.add(promptId);
    let system;
    if (Array.isArray(prompt.systemLines) && prompt.systemLines.every((line) => typeof line === "string")) {
      system = prompt.systemLines.join("\n");
    } else if (isText(prompt.basePromptId) && Array.isArray(prompt.replacements)) {
      system = resolvePrompt(prompt.basePromptId, stack).system;
      for (const replacement of prompt.replacements) {
        if (!isObject(replacement) || !isText(replacement.find) || typeof replacement.replace !== "string") {
          fail(`invalid replacement in prompt '${promptId}'`);
        }
        if (system.split(replacement.find).length !== 2) fail(`replacement target must occur once in prompt '${promptId}'`);
        system = system.replace(replacement.find, replacement.replace);
      }
    } else {
      fail(`prompt '${promptId}' needs systemLines or basePromptId/replacements`);
    }
    if (prompt.policyProjection != null) {
      if (prompt.policyProjection !== "category-admission-v1") {
        fail(`unknown policy projection '${promptId}'`);
      }
      system += `\n\n${renderCategoryAdmissionPrompt(CATEGORY_ADMISSION_POLICY)}`;
    }
    stack.delete(promptId);
    if (sha256Hex(system) !== prompt.promptSha256) fail(`prompt SHA mismatch '${promptId}'`);
    const resolved = { promptId, promptVersion: prompt.promptVersion, promptSha256: prompt.promptSha256, system };
    promptCache.set(promptId, resolved);
    return resolved;
  };

  const candidates = {};
  for (const row of document.candidates) {
    if (!isObject(row) || !isText(row.candidateId) || candidates[row.candidateId]) fail("candidateId missing or duplicated");
    const model = document.models[row.modelId];
    if (!isObject(model) || !isText(model.requestedModel) || !Array.isArray(model.resolvedAliases)
      || model.resolvedAliases.length === 0 || !model.resolvedAliases.every(isText)) fail(`invalid model '${row.modelId}'`);
    if (new Set(model.resolvedAliases).size !== model.resolvedAliases.length || !model.resolvedAliases.includes(model.requestedModel)) {
      fail(`model aliases invalid '${row.modelId}'`);
    }
    if (!isObject(model.pricing) || !isFiniteNonNegative(model.pricing.inputPerMTok)
      || !isFiniteNonNegative(model.pricing.outputPerMTok) || model.currency !== "USD") fail(`invalid pricing '${row.modelId}'`);
    const prompt = resolvePrompt(row.promptId);
    const execution = row.execution;
    if (!isObject(execution) || typeof execution.runnable !== "boolean" || !isText(execution.state)
      || !Number.isInteger(execution.maxCalls) || execution.maxCalls <= 0 || typeof execution.fullAllowed !== "boolean") {
      fail(`invalid execution policy '${row.candidateId}'`);
    }
    const approvedCanary = execution.state === "approved_canary" && execution.maxCalls === 12 && execution.fullAllowed === false;
    const approvedFull = execution.state === "approved_shadow_full" && execution.fullAllowed === true;
    if (execution.runnable && !approvedCanary && !approvedFull) {
      fail(`runnable candidate is not approved_canary or approved_shadow_full '${row.candidateId}'`);
    }
    if (execution.maxCostUsd != null && (!isFiniteNonNegative(execution.maxCostUsd) || execution.maxCostUsd === 0)) {
      fail(`invalid canary cost cap '${row.candidateId}'`);
    }
    if (execution.maxOutputTokensPerCall != null
      && (!Number.isInteger(execution.maxOutputTokensPerCall) || execution.maxOutputTokensPerCall < 128 || execution.maxOutputTokensPerCall > 1800)) {
      fail(`invalid output token cap '${row.candidateId}'`);
    }
    for (const field of ["maxInputTokens", "perCallTimeoutMs", "totalDeadlineMs"]) {
      if (execution[field] != null && (!Number.isInteger(execution[field]) || execution[field] <= 0)) {
        fail(`invalid ${field} '${row.candidateId}'`);
      }
    }
    if (execution.runnable && !isFiniteNonNegative(execution.maxCostUsd)) fail(`approved candidate needs cost cap '${row.candidateId}'`);
    if (typeof row.independentEvidence !== "boolean" || !isText(row.evidenceUse)) fail(`invalid evidence policy '${row.candidateId}'`);
    if (row.task != null && !["category_admission_only"].includes(row.task)) fail(`invalid task '${row.candidateId}'`);
    if (row.semanticContract != null) {
      if (row.semanticContract !== "compact_category_v1" || !isObject(row.compactPolicy)
        || row.compactPolicy.sourceEvidence !== "title_then_excerpt" || !isObject(row.compactPolicy.eventTypes)
        || Object.keys(row.compactPolicy.eventTypes).length === 0 || !isText(row.compactPolicy.emptyEventType)
        || !Object.hasOwn(row.compactPolicy.eventTypes, row.compactPolicy.emptyEventType)
        || Object.keys(row.compactPolicy).sort().join(",") !== "emptyEventType,eventTypes,sourceEvidence") {
        fail(`invalid compact policy '${row.candidateId}'`);
      }
      for (const [eventType, policy] of Object.entries(row.compactPolicy.eventTypes)) {
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(eventType) || !isObject(policy)
          || !Array.isArray(policy.requiredCoreCategories)
          || policy.requiredCoreCategories.some((category) => !CATEGORY_IDS.has(category))
          || new Set(policy.requiredCoreCategories).size !== policy.requiredCoreCategories.length
          || Object.keys(policy).join(",") !== "requiredCoreCategories") {
          fail(`invalid compact event policy '${row.candidateId}:${eventType}'`);
        }
      }
    } else if (row.compactPolicy != null) {
      fail(`compactPolicy without semanticContract '${row.candidateId}'`);
    }

    const candidate = {
      candidateId: row.candidateId,
      requestedModel: model.requestedModel,
      resolvedAliases: [...model.resolvedAliases],
      promptVersion: prompt.promptVersion,
      system: prompt.system,
      promptSha256: prompt.promptSha256,
      pricing: { ...model.pricing },
      currency: model.currency,
      execution: { ...execution },
      evidenceUse: row.evidenceUse,
      independentEvidence: row.independentEvidence,
      registryContract: document.contract
    };
    if (row.task != null) candidate.task = row.task;
    if (row.semanticContract != null) {
      candidate.semanticContract = row.semanticContract;
      candidate.compactPolicy = structuredClone(row.compactPolicy);
    }
    candidate.candidateRecordSha256 = sha256Hex(JSON.stringify(candidate));
    candidates[row.candidateId] = candidate;
  }
  if (Object.keys(candidates).length === 0) fail("at least one candidate is required");

  const executionHolds = {};
  if (document.executionHolds != null && !isObject(document.executionHolds)) fail("executionHolds must be an object");
  for (const [candidateId, hold] of Object.entries(document.executionHolds || {})) {
    if (!candidates[candidateId]) fail(`execution hold references unknown candidate '${candidateId}'`);
    if (!isObject(hold) || hold.state !== "consumed_hold" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(hold.attemptId || "")
      || !/^[0-9a-f]{64}$/.test(hold.receiptSha256 || "") || !isText(hold.reason)) {
      fail(`invalid execution hold '${candidateId}'`);
    }
    executionHolds[candidateId] = { ...hold };
  }
  return deepFreeze({ document, candidates, prompts: Object.fromEntries(promptCache), executionHolds });
}

const rawRegistry = fs.readFileSync(CANDIDATE_REGISTRY_PATH, "utf8");
const parsedRegistry = parseCandidateRegistry(rawRegistry);
export const CANDIDATE_REGISTRY_SHA256 = sha256Hex(rawRegistry);
export const CANDIDATE_REGISTRY_DOCUMENT = parsedRegistry.document;
export const CANDIDATE_REGISTRY = parsedRegistry.candidates;
export const CANDIDATE_EXECUTION_HOLDS = parsedRegistry.executionHolds;
export const P31_SYSTEM = parsedRegistry.prompts["p3.1"].system;
export const P32_SYSTEM = parsedRegistry.prompts["p3.2"].system;

export function getCandidate(candidateId) {
  const candidate = CANDIDATE_REGISTRY[candidateId];
  if (!candidate) throw new Error(`CANDIDATE_UNKNOWN: '${candidateId}' — registered: ${Object.keys(CANDIDATE_REGISTRY).join(", ")}`);
  return candidate;
}

export function getCandidateExecutionHold(candidateId) {
  return CANDIDATE_EXECUTION_HOLDS[candidateId] || null;
}

export function getRunnableCandidate(candidateId) {
  const candidate = getCandidate(candidateId);
  const executionHold = getCandidateExecutionHold(candidateId);
  if (executionHold) {
    throw new Error(`CANDIDATE_APPROVAL_CONSUMED: '${candidateId}' attempt=${executionHold.attemptId}`);
  }
  if (!candidate.execution.runnable || candidate.execution.state !== "approved_canary") {
    throw new Error(`CANDIDATE_NOT_RUNNABLE: '${candidateId}' state=${candidate.execution.state}`);
  }
  return candidate;
}

export function getRunnableFullCandidate(candidateId) {
  const candidate = getCandidate(candidateId);
  const executionHold = getCandidateExecutionHold(candidateId);
  if (executionHold) {
    throw new Error(`CANDIDATE_APPROVAL_CONSUMED: '${candidateId}' attempt=${executionHold.attemptId}`);
  }
  if (!candidate.execution.runnable || candidate.execution.state !== "approved_shadow_full" || candidate.execution.fullAllowed !== true) {
    throw new Error(`CANDIDATE_NOT_RUNNABLE: '${candidateId}' state=${candidate.execution.state}`);
  }
  return candidate;
}
