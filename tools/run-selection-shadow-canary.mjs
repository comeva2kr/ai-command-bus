// D2-E — 현재 수집 풀의 12건 shadow canary. 승인·비용·장부는 D1 정본을 재사용한다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  d1cTaxonomyVersion,
  runPricedClassification
} from "../src/feed/selection-classifier-lab.js";
import { loadRegistry } from "../src/feed/registry.js";
import { resolveSourceRole } from "../src/feed/shadow-selection.js";
import { SLOTS } from "../src/feed/digest.js";
import {
  candidateCanaryBudget,
  candidateClassificationAssembler,
  createFileLedger,
  keychainApiKey,
  makeCallModel,
  operatorGroupFor,
  originDocumentIdFor,
  predictionOf
} from "./run-selection-d1c.mjs";
import { getRunnableCandidate, getRunnableFullCandidate } from "./selection-candidate-registry.mjs";
import {
  buildSelectionShadowPacket,
  measureSelectionShadow,
  selectSelectionShadowCanary,
  selectSelectionShadowShortlist
} from "./prepare-selection-shadow.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SELECTION_SHADOW_CANARY_RECEIPT = "NOWHOT-SELECTION-SHADOW-CANARY-001";
export const SELECTION_SHADOW_CANARY_MANIFEST = "NOWHOT-SELECTION-SHADOW-ATTEMPT-MANIFEST-001";
export const SELECTION_SHADOW_FULL_RECEIPT = "NOWHOT-SELECTION-SHADOW-FULL-001";
export const SELECTION_SHADOW_FULL_MANIFEST = "NOWHOT-SELECTION-SHADOW-FULL-MANIFEST-001";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readRaw = (file) => fs.readFileSync(file, "utf8");
const readJson = (file) => JSON.parse(readRaw(file));
const isAttemptId = (value) => /^[a-z0-9][a-z0-9-]{2,63}$/.test(value || "");

function loadResumeCache(resumeDir, { candidate, poolSha256, packetSha256, targetIds, mode }) {
  const preflight = readJson(path.join(resumeDir, "preflight.json"));
  const receiptRaw = readRaw(path.join(resumeDir, "run-receipt.json"));
  const receipt = JSON.parse(receiptRaw);
  const progressRaw = readRaw(path.join(resumeDir, "progress-results.jsonl"));
  const ledgerPath = path.join(resumeDir, "usage-ledger.jsonl");
  const ledgerRaw = readRaw(ledgerPath);
  if (preflight.mode !== mode || preflight.candidateId !== candidate.candidateId
    || preflight.candidateRecordSha256 !== candidate.candidateRecordSha256
    || preflight.poolSha256 !== poolSha256 || preflight.packetSha256 !== packetSha256
    || JSON.stringify(preflight.sample?.targetIds) !== JSON.stringify(targetIds)
    || !["UNSETTLED_USAGE_HOLD", "D2_SHADOW_FULL_HOLD", "D2_SHADOW_SHORTLIST_HOLD"].includes(receipt.status)
    || receipt.candidateId !== candidate.candidateId) {
    throw new Error("SHADOW_RESUME_HOLD: prior attempt identity/status mismatch");
  }
  const rows = progressRaw.trim() ? progressRaw.trim().split("\n").map(JSON.parse) : [];
  const allowedIds = new Set(targetIds);
  const seenIds = new Set();
  const cache = new Map();
  const results = new Map();
  const provider400 = receipt.status === "UNSETTLED_USAGE_HOLD"
    && receipt.providerError === "api 400 invalid_request_error";
  const providerErrors = rows.filter((row) => row?.status === "error" && row.reason === "classifier_call_failed");
  const priorProvider400 = rows.filter((row) => row?.status === "withheld" && row.reason === "prior_provider_400");
  if (provider400 && (providerErrors.length !== 1 || rows.at(-1) !== providerErrors[0])) {
    throw new Error("SHADOW_RESUME_HOLD: provider 400 must be the sole trailing error");
  }
  if (provider400 && priorProvider400.length > 0) {
    throw new Error("SHADOW_RESUME_HOLD: prior_provider_400 chain cap");
  }
  for (const row of rows) {
    if (!allowedIds.has(row?.itemId) || seenIds.has(row.itemId)) {
      throw new Error("SHADOW_RESUME_HOLD: duplicate or foreign progress item");
    }
    seenIds.add(row.itemId);
    if (["classified", "cache_hit"].includes(row.status)) {
      if (typeof row.cacheKey !== "string" || !row.cacheKey || !row.classification) {
        throw new Error("SHADOW_RESUME_HOLD: invalid reusable progress row");
      }
      const prior = cache.get(row.cacheKey);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row.classification)) {
        throw new Error("SHADOW_RESUME_HOLD: conflicting progress cache key");
      }
      cache.set(row.cacheKey, row.classification);
      results.set(row.itemId, { ...row, status: "cache_hit" });
    } else if (row.status === "schema_reject") {
      results.set(row.itemId, { itemId: row.itemId, status: row.status, reason: row.reason });
    } else if (row.status === "withheld" && typeof row.reason === "string" && row.reason) {
      results.set(row.itemId, { itemId: row.itemId, status: row.status, reason: row.reason });
    } else if (provider400 && row === providerErrors[0]) {
      results.set(row.itemId, { itemId: row.itemId, status: "withheld", reason: "prior_provider_400" });
    }
  }
  const priorLifetime = createFileLedger(ledgerPath).summary(candidate.pricing);
  for (const key of ["calls", "settledCalls", "inputTokens", "outputTokens", "costUsd", "unsettledReserves"]) {
    if (receipt.lifetime?.[key] !== priorLifetime[key]) {
      throw new Error(`SHADOW_RESUME_HOLD: prior ledger/receipt mismatch '${key}'`);
    }
  }
  return {
    results,
    recovery: provider400 ? {
      calls: priorLifetime.calls,
      inputTokens: priorLifetime.inputTokens,
      outputTokens: priorLifetime.outputTokens
    } : null,
    provenance: {
      attemptId: preflight.attemptId,
      progressSha256: sha256(progressRaw),
      receiptSha256: sha256(receiptRaw),
      ledgerSha256: sha256(ledgerRaw),
      reusableResults: results.size,
      priorProvider400Withheld: [...results.values()].filter((row) => row.reason === "prior_provider_400").length,
      provider400ItemId: provider400 ? providerErrors[0].itemId : null
    }
  };
}

function packetMatchesCurrentPool(pool, packet, candidate, registry, poolSha256) {
  const current = buildSelectionShadowPacket(pool, { candidate, registry, sourceSnapshotSha256: poolSha256 });
  const sameSemanticCandidate = packet?.candidate?.candidateId === candidate.candidateId
    && packet.candidate.task === current.candidate.task
    && packet.candidate.semanticContract === current.candidate.semanticContract
    && packet.candidate.requestedModel === current.candidate.requestedModel
    && packet.candidate.promptVersion === current.candidate.promptVersion
    && packet.candidate.promptSha256 === current.candidate.promptSha256
    && packet.candidate.compactPolicySha256 === current.candidate.compactPolicySha256
    && packet.candidate.taxonomyVersion === current.candidate.taxonomyVersion;
  const sameSnapshot = JSON.stringify(packet?.sourceSnapshot) === JSON.stringify(current.sourceSnapshot);
  const sameInputs = JSON.stringify(packet?.counts) === JSON.stringify(current.counts)
    && JSON.stringify(packet?.targets) === JSON.stringify(current.targets);
  if (!sameSemanticCandidate || !sameSnapshot || !sameInputs) {
    throw new Error("SHADOW_PREFLIGHT_HOLD: packet candidate mismatch or pool drift");
  }
}

export async function runSelectionShadowCanary({
  attemptId,
  attemptDir,
  poolPath,
  packetPath,
  candidateId,
  candidateDef = null,
  registry = loadRegistry(),
  getApiKey = keychainApiKey,
  callModelFactory = makeCallModel,
  allowNonRunnableCandidateForTest = false,
  mode = "canary",
  resumeFromDir = null,
  routingSnapshotPath = null,
  missingCategoryIds = null,
  nowMs = null,
  windowHours = null,
  maxCalls = null,
  maxCostUsd = null,
  maxProvider400Withholds = 0
} = {}) {
  if (!["canary", "full", "shortlist"].includes(mode)) throw new Error(`SHADOW_PREFLIGHT_HOLD: invalid mode '${mode}'`);
  const full = mode === "full";
  const shortlist = mode === "shortlist";
  const batch = full || shortlist;
  if (!isAttemptId(attemptId) || !attemptDir || !poolPath || !packetPath || !candidateId) {
    throw new Error("SHADOW_PREFLIGHT_HOLD: attemptId, attemptDir, poolPath, packetPath and candidateId required");
  }
  if (fs.existsSync(attemptDir)) throw new Error(`ATTEMPT_DIR_EXISTS_HOLD: ${attemptDir}`);

  const safeTestBypass = allowNonRunnableCandidateForTest === true && callModelFactory !== makeCallModel;
  const candidate = candidateDef && safeTestBypass
    ? candidateDef
    : (batch ? getRunnableFullCandidate(candidateId) : getRunnableCandidate(candidateId));
  const approvedState = batch ? "approved_shadow_full" : "approved_canary";
  if (candidate.candidateId !== candidateId
    || candidate.execution?.runnable !== true
    || candidate.execution?.state !== approvedState
    || candidate.execution?.fullAllowed !== batch) {
    throw new Error(`CANDIDATE_NOT_RUNNABLE: shadow ${mode} needs one approved candidate`);
  }

  const resolvedPoolPath = path.resolve(poolPath);
  const resolvedPacketPath = path.resolve(packetPath);
  const poolRaw = readRaw(resolvedPoolPath);
  const packetRaw = readRaw(resolvedPacketPath);
  const pool = JSON.parse(poolRaw);
  const packet = JSON.parse(packetRaw);
  packetMatchesCurrentPool(pool, packet, candidate, registry, sha256(poolRaw));

  const candidateBudget = candidateCanaryBudget(candidate);
  const shortlistPolicyValid = shortlist && routingSnapshotPath && Array.isArray(missingCategoryIds)
    && Number.isFinite(Number(nowMs)) && Number.isFinite(Number(windowHours))
    && Number.isInteger(Number(maxCalls)) && Number(maxCalls) > 0
    && Number.isFinite(Number(maxCostUsd)) && Number(maxCostUsd) > 0;
  const selected = shortlistPolicyValid
    ? selectSelectionShadowShortlist(pool, packet, {
        routingSnapshot: readJson(path.resolve(routingSnapshotPath)),
        registry,
        missingCategoryIds,
        nowMs: Number(nowMs),
        windowHours: Number(windowHours),
        maxCalls: Math.min(Number(maxCalls), candidateBudget.maxCalls)
      })
    : selectSelectionShadowCanary(pool, packet, { maxCalls: candidateBudget.maxCalls });
  if (shortlist && !shortlistPolicyValid) throw new Error("SHADOW_PREFLIGHT_HOLD: shortlist policy required");
  const sample = full ? { ...selected, purpose: "full_shadow_measurement_not_quality_proof" } : selected;
  const budget = shortlist ? {
    ...candidateBudget,
    maxCalls: sample.targets.length,
    maxOutputTokens: sample.targets.length * candidateBudget.maxOutputTokensPerCall,
    maxCostUsd: Math.min(candidateBudget.maxCostUsd, Number(maxCostUsd))
  } : candidateBudget;
  if (!sample.targets.length || (!shortlist && sample.targets.length !== budget.maxCalls)) {
    throw new Error(`SHADOW_PREFLIGHT_HOLD: ${mode} needs targets, got ${sample.targets.length}`);
  }
  if (resumeFromDir && !batch) throw new Error("SHADOW_RESUME_HOLD: resume is full/shortlist-only");
  const resume = resumeFromDir ? loadResumeCache(path.resolve(resumeFromDir), {
    candidate,
    poolSha256: sha256(poolRaw),
    packetSha256: sha256(packetRaw),
    targetIds: sample.targets.map((target) => target.itemId),
    mode
  }) : null;

  fs.mkdirSync(path.dirname(attemptDir), { recursive: true });
  try { fs.mkdirSync(attemptDir, { mode: 0o700 }); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error(`ATTEMPT_DIR_EXISTS_HOLD: ${attemptDir}`);
    throw error;
  }
  const writeJson = (name, value) => fs.writeFileSync(path.join(attemptDir, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx", mode: 0o600
  });
  const ledgerPath = path.join(attemptDir, "usage-ledger.jsonl");
  fs.writeFileSync(ledgerPath, "", { flag: "wx", mode: 0o600 });
  const ledger = createFileLedger(ledgerPath);
  if (resume?.recovery) ledger.append({ type: "recovery", ...resume.recovery });
  const versions = {
    modelVersion: candidate.requestedModel,
    promptVersion: candidate.promptVersion,
    taxonomyVersion: d1cTaxonomyVersion()
  };
  writeJson("preflight.json", {
    contract: batch ? "NOWHOT-SELECTION-SHADOW-FULL-PREFLIGHT-001" : "NOWHOT-SELECTION-SHADOW-PREFLIGHT-001",
    attemptId,
    candidateId,
    mode,
    candidateRecordSha256: candidate.candidateRecordSha256,
    poolSha256: sha256(poolRaw),
    packetSha256: sha256(packetRaw),
    sample: {
      purpose: sample.purpose,
      targetIds: sample.targets.map((target) => target.itemId),
      selectedLegacyCategories: sample.selectedLegacyCategories,
      omittedLegacyCategories: sample.omittedLegacyCategories,
      contentKinds: sample.contentKinds,
      missingCategoryIds: sample.missingCategoryIds || [],
      selectedSourceIds: sample.selectedSourceIds || []
    },
    resume: resume ? resume.provenance : null,
    limits: budget,
    runtimeWired: false,
    productProven: false
  });

  const apiKey = getApiKey();
  if (!apiKey) {
    writeJson("terminal-receipt.json", {
      contract: batch ? SELECTION_SHADOW_FULL_RECEIPT : SELECTION_SHADOW_CANARY_RECEIPT,
      attemptId,
      candidateId,
      status: "MODEL_KEY_MISSING",
      effect: { keyReads: 1, providerCalls: 0 }
    });
    return { status: "MODEL_KEY_MISSING", productProven: false };
  }

  const resolvedModels = new Set();
  const callModel = callModelFactory(apiKey, resolvedModels, candidate);
  const progressPath = batch ? path.join(attemptDir, "progress-results.jsonl") : null;
  if (progressPath) fs.writeFileSync(progressPath, "");
  const priorResults = resume ? [...resume.results.values()] : [];
  const priorById = new Map(priorResults.map((row) => [row.itemId, row]));
  const pendingTargets = sample.targets.filter((target) => !priorById.has(target.itemId));
  if (progressPath && priorResults.length) {
    const ordered = sample.targets.map((target) => priorById.get(target.itemId)).filter(Boolean);
    fs.appendFileSync(progressPath, `${ordered.map((row) => JSON.stringify(row)).join("\n")}\n`);
  }
  let provider400Withholds = 0;
  const run = await runPricedClassification({
    items: pendingTargets,
    callModel,
    versions,
    operatorGroupOf: operatorGroupFor,
    originDocumentIdOf: originDocumentIdFor,
    budget,
    pricing: candidate.pricing,
    cache: new Map(),
    ledger,
    attemptId,
    phase: `shadow_${mode}`,
    classificationAssembler: candidateClassificationAssembler(candidate),
    onResult: progressPath
      ? (row) => fs.appendFileSync(progressPath, `${JSON.stringify(row)}\n`)
      : null,
    onProviderError: batch && maxProvider400Withholds > 0
      ? ({ providerError }) => {
          if (providerError !== "api 400 invalid_request_error") return "abort";
          provider400Withholds += 1;
          return provider400Withholds <= maxProvider400Withholds ? "withhold" : "abort";
        }
      : null,
    now: () => Date.now()
  });
  const currentById = new Map(run.results.map((row) => [row.itemId, row]));
  run.results = sample.targets.map((target) => priorById.get(target.itemId) || currentById.get(target.itemId)).filter(Boolean);
  run.stats.cacheHits += priorResults.filter((row) => row.status === "cache_hit").length;
  run.stats.schemaReject += priorResults.filter((row) => row.status === "schema_reject").length;
  run.stats.withheld += priorResults.filter((row) => row.status === "withheld").length;
  const lifetime = ledger.summary(candidate.pricing);
  if (run.stats.aborted) {
    const terminal = {
      contract: batch ? SELECTION_SHADOW_FULL_RECEIPT : SELECTION_SHADOW_CANARY_RECEIPT,
      attemptId,
      candidateId,
      status: "UNSETTLED_USAGE_HOLD",
      reason: run.stats.abortReason,
      providerError: run.stats.providerError || null,
      providerDiagnostic: run.stats.providerDiagnostic || null,
      providerRequestId: run.stats.providerRequestId || null,
      lifetime,
      effect: { keyReads: 1, providerCalls: run.stats.calls }
    };
    writeJson("run-receipt.json", terminal);
    writeJson("terminal-receipt.json", terminal);
    return { status: terminal.status, productProven: false, providerError: terminal.providerError, lifetime };
  }
  if (resolvedModels.size !== 1 || !candidate.resolvedAliases.includes([...resolvedModels][0])) {
    const terminal = {
      contract: batch ? SELECTION_SHADOW_FULL_RECEIPT : SELECTION_SHADOW_CANARY_RECEIPT,
      attemptId,
      candidateId,
      status: "MODEL_IDENTITY_HOLD",
      requestedModel: candidate.requestedModel,
      resolvedModels: [...resolvedModels].sort(),
      providerError: run.stats.providerError || null,
      providerDiagnostic: run.stats.providerDiagnostic || null,
      providerRequestId: run.stats.providerRequestId || null,
      lifetime
    };
    writeJson("run-receipt.json", terminal);
    writeJson("terminal-receipt.json", terminal);
    return { status: terminal.status, productProven: false, lifetime };
  }

  const predictions = run.results.map(predictionOf);
  writeJson("predictions.json", { versions, results: predictions });
  const registryById = new Map(registry.map((row) => [row.id, row]));
  const measured = measureSelectionShadow(pool, packet, predictions, {
    roleOf: (article) => resolveSourceRole(article, registryById.get(article.source))
  });
  const measurement = {
    contract: measured.contract,
    runtimeWired: false,
    productProven: false,
    sourceSnapshot: measured.sourceSnapshot,
    candidate: measured.candidate,
    sample: {
      targetIds: sample.targets.map((target) => target.itemId),
      selectedLegacyCategories: sample.selectedLegacyCategories,
      omittedLegacyCategories: sample.omittedLegacyCategories,
      contentKinds: sample.contentKinds,
      missingCategoryIds: sample.missingCategoryIds || [],
      selectedSourceIds: sample.selectedSourceIds || []
    },
    counts: measured.counts,
    categoryViews: measured.categoryViews
  };
  writeJson("measurement.json", measurement);
  const valid = run.stats.classified + run.stats.cacheHits;
  const fullyAccounted = valid + run.stats.schemaReject + (run.stats.providerRejected || 0) === sample.targets.length
    && run.stats.withheld === (run.stats.providerRejected || 0) && run.stats.errors === 0;
  const status = fullyAccounted
    ? (full ? "D2_SHADOW_FULL_MEASURED" : shortlist ? "D2_SHADOW_SHORTLIST_MEASURED" : "D2_SHADOW_CANARY_MEASURED")
    : (full ? "D2_SHADOW_FULL_HOLD" : shortlist ? "D2_SHADOW_SHORTLIST_HOLD" : "D2_SHADOW_CANARY_HOLD");
  const receipt = {
    contract: batch ? SELECTION_SHADOW_FULL_RECEIPT : SELECTION_SHADOW_CANARY_RECEIPT,
    attemptId,
    candidateId,
    status,
    calls: run.stats.calls,
    retries: 0,
    classified: run.stats.classified,
    cacheHits: run.stats.cacheHits,
    schemaReject: run.stats.schemaReject,
    withheld: run.stats.withheld,
    providerRejected: run.stats.providerRejected || 0,
    errors: run.stats.errors,
    qualityProof: false,
    runtimeWired: false,
    lifetime
  };
  writeJson("run-receipt.json", receipt);
  const artifactNames = ["preflight.json", "predictions.json", "measurement.json", "run-receipt.json", "usage-ledger.jsonl"];
  if (progressPath) artifactNames.push("progress-results.jsonl");
  const artifactSha256 = Object.fromEntries(artifactNames
    .map((name) => [name, sha256(readRaw(path.join(attemptDir, name)))]));
  writeJson("attempt-manifest.json", {
    contract: batch ? SELECTION_SHADOW_FULL_MANIFEST : SELECTION_SHADOW_CANARY_MANIFEST,
    attemptId,
    candidateId,
    mode,
    requestedModel: candidate.requestedModel,
    resolvedModels: [...resolvedModels].sort(),
    promptVersion: candidate.promptVersion,
    promptSha256: candidate.promptSha256,
    candidateRecordSha256: candidate.candidateRecordSha256,
    pricing: candidate.pricing,
    poolSha256: sha256(poolRaw),
    packetSha256: sha256(packetRaw),
    resume: resume ? resume.provenance : null,
    artifacts: artifactSha256,
    calls: lifetime.calls,
    retries: 0,
    costUsd: lifetime.costUsd,
    unsettledReserves: lifetime.unsettledReserves,
    integrityNote: "internal-consistency evidence only; not a cryptographic proof against synthesis",
    runtimeWired: false,
    productProven: false
  });
  return { status, productProven: false, sample: measurement.sample, stats: run.stats, measurement };
}

export function runSelectionShadowFull(options = {}) {
  return runSelectionShadowCanary({ ...options, mode: "full" });
}

export function runSelectionShadowShortlist(options = {}) {
  return runSelectionShadowCanary({ ...options, mode: "shortlist" });
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (!['--run-canary', '--run-full', '--run-shortlist'].includes(args[0]) || !isAttemptId(args[1]) || !args[2]) {
    process.stderr.write("usage: node tools/run-selection-shadow-canary.mjs <--run-canary|--run-full|--run-shortlist> <attempt-id> <candidate-id> --pool <pool.json> --packet <packet.json> [--routing-snapshot file --missing-categories tech --slot lunch --max-calls 50 --max-cost 0.25]\n");
    process.exitCode = 2;
    return;
  }
  const [attemptId, candidateId] = [args[1], args[2]];
  const poolPath = argValue(args, "--pool");
  const packetPath = argValue(args, "--packet");
  const resumeFrom = argValue(args, "--resume-from");
  const routingSnapshotPath = argValue(args, "--routing-snapshot");
  const missingCategoryIds = String(argValue(args, "--missing-categories") || "").split(",").filter(Boolean);
  const slotId = argValue(args, "--slot");
  const slot = SLOTS.find((row) => row.id === slotId);
  const maxCalls = Number(argValue(args, "--max-calls"));
  const maxCostUsd = Number(argValue(args, "--max-cost"));
  if (!poolPath || !packetPath) {
    process.stderr.write("SHADOW_PREFLIGHT_HOLD: --pool and --packet are required\n");
    process.exitCode = 2;
    return;
  }
  if (resumeFrom && !isAttemptId(resumeFrom)) {
    process.stderr.write("SHADOW_RESUME_HOLD: --resume-from must be an attempt id\n");
    process.exitCode = 2;
    return;
  }
  const attemptDir = path.join(ROOT, ".nowhot-local", "selection-shadow-attempts", attemptId);
  const resumeFromDir = resumeFrom
    ? path.join(ROOT, ".nowhot-local", "selection-shadow-attempts", resumeFrom)
    : null;
  try {
    const run = args[0] === "--run-full" ? runSelectionShadowFull
      : args[0] === "--run-shortlist" ? runSelectionShadowShortlist : runSelectionShadowCanary;
    const pool = args[0] === "--run-shortlist" ? readJson(path.resolve(poolPath)) : null;
    const result = await run({
      attemptId, attemptDir, poolPath, packetPath, candidateId, resumeFromDir,
      routingSnapshotPath,
      missingCategoryIds,
      nowMs: pool?.savedAt,
      windowHours: slot?.windowHours,
      maxCalls,
      maxCostUsd,
      maxProvider400Withholds: args[0] === "--run-full" ? 3 : 0
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
