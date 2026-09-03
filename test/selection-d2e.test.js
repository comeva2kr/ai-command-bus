import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildSelectionShadowPacket } from "../tools/prepare-selection-shadow.mjs";
import { CANDIDATE_REGISTRY } from "../tools/selection-candidate-registry.mjs";
import {
  runSelectionShadowCanary,
  runSelectionShadowFull,
  runSelectionShadowShortlist
} from "../tools/run-selection-shadow-canary.mjs";

const CANDIDATE = CANDIDATE_REGISTRY["p6-policy-shadow-haiku"];
const REGISTRY = [
  { id: "source-a", sourceTier: "specialist", country: "KR", lang: "ko", kind: "news" },
  { id: "source-b", sourceTier: "community", country: "US", lang: "en", kind: "community" }
];
const CATEGORIES = ["auto", "art", "realestate", "science", "gaming", "fashion", "sports", "culture", "news", "life", "business", "tech", "humor"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture(dir, candidate = CANDIDATE) {
  const rows = CATEGORIES.flatMap((category, categoryIndex) => Array.from({ length: categoryIndex + 1 }, (_, itemIndex) => ({
    item: {
      id: `${category}-${itemIndex}`,
      source: itemIndex % 2 ? "source-b" : "source-a",
      title: `${category} 기사 ${itemIndex}`,
      summary: `${category} 핵심 내용 ${itemIndex}`,
      category,
      registryCategory: category,
      kind: categoryIndex % 2 ? "community" : "news",
      lang: categoryIndex % 2 ? "en" : "ko",
      hotScorePrev: itemIndex,
      commentCount: itemIndex * 2,
      viewCount: itemIndex * 10,
      publishedAt: `2026-08-22T${String(itemIndex).padStart(2, "0")}:00:00.000Z`
    }
  })));
  const pool = { savedAt: Date.parse("2026-08-22T08:14:49.104Z"), rows };
  const poolRaw = JSON.stringify(pool, null, 2) + "\n";
  const packet = buildSelectionShadowPacket(pool, {
    candidate,
    registry: REGISTRY,
    sourceSnapshotSha256: sha256(poolRaw)
  });
  const poolPath = path.join(dir, "pool.json");
  const packetPath = path.join(dir, "packet.json");
  fs.writeFileSync(poolPath, poolRaw);
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
  return { poolPath, packetPath };
}

test("NH93: shortlist 러너는 전역 반응량보다 부족 분야 미분류 후보를 먼저 실행한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-nh89-shortlist-"));
  const nowMs = Date.parse("2026-08-27T05:42:34.447Z");
  const approved = {
    ...CANDIDATE,
    candidateId: "p11-shortlist-test",
    execution: {
      ...CANDIDATE.execution,
      runnable: true,
      state: "approved_shadow_full",
      maxCalls: 91,
      maxInputTokens: 200000,
      maxOutputTokensPerCall: 500,
      maxCostUsd: 1,
      fullAllowed: true
    }
  };
  approved.candidateRecordSha256 = sha256(JSON.stringify(approved));
  const localRegistry = [
    { id: "etnews", enabled: true, kind: "news", sourceTier: "specialist", category: "tech", country: "KR", lang: "ko", adapter: { type: "rss" } },
    { id: "business-wire", enabled: true, kind: "news", sourceTier: "aggregate", category: "business", country: "KR", lang: "ko", adapter: { type: "rss" } }
  ];
  const makeArticle = (id, source, publishedAt, score) => ({
    id, source, title: `${id} 제목`, summary: `${id} 핵심 내용`, category: source === "etnews" ? "tech" : "business",
    kind: "news", lang: "ko", publishedAt, hotScorePrev: score, score
  });
  const pool = { savedAt: nowMs, rows: [
    { item: { ...makeArticle("selected", "etnews", "2026-08-27T04:00:00.000Z", 10), category: "business" } },
    { item: makeArticle("already", "etnews", "2026-08-27T04:30:00.000Z", 99) },
    { item: makeArticle("other", "business-wire", "2026-08-27T04:00:00.000Z", 100) }
  ] };
  const poolRaw = JSON.stringify(pool, null, 2) + "\n";
  const packet = buildSelectionShadowPacket(pool, {
    candidate: approved,
    registry: localRegistry,
    sourceSnapshotSha256: sha256(poolRaw)
  });
  const packetRaw = JSON.stringify(packet, null, 2) + "\n";
  const poolPath = path.join(root, "pool.json");
  const packetPath = path.join(root, "packet.json");
  const routingSnapshotPath = path.join(root, "routing.json");
  fs.writeFileSync(poolPath, poolRaw);
  fs.writeFileSync(packetPath, packetRaw);
  fs.writeFileSync(routingSnapshotPath, JSON.stringify({
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-shortlist-runner-test",
    generatedAt: new Date(nowMs).toISOString(),
    source: { packetSha256: sha256(packetRaw), predictionsSha256: sha256("predictions") },
    entries: packet.targets.flatMap((target) => target.sourceArticleIds.map((itemId) => ({
      itemId,
      evidenceHash: target.evidenceHash,
      categories: itemId === "already" ? ["tech"] : [],
      contentType: "news",
      sourceId: target.sourceId,
      routingBasis: itemId === "already" ? "current_model" : "withheld"
    })))
  }, null, 2) + "\n");
  const attemptDir = path.join(root, "attempt");
  let calls = 0;

  const result = await runSelectionShadowShortlist({
    attemptId: "nh89-shortlist-test",
    attemptDir,
    poolPath,
    packetPath,
    routingSnapshotPath,
    missingCategoryIds: ["tech"],
    nowMs,
    windowHours: 6,
    maxCalls: 2,
    maxCostUsd: 0.05,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: localRegistry,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      calls += 1;
      resolvedModels.add(candidate.requestedModel);
      return {
        semantic: {
          contentType: "news",
          eventType: "domain_event",
          impactCategories: ["tech"],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 100, outputTokens: 30 },
        request
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "D2_SHADOW_SHORTLIST_MEASURED");
  const preflight = JSON.parse(fs.readFileSync(path.join(attemptDir, "preflight.json")));
  assert.equal(preflight.mode, "shortlist");
  assert.deepEqual(preflight.sample.targetIds, ["selected"]);
  assert.equal(preflight.limits.maxCalls, 1, "실제 부족 분야 후보 수보다 호출 예산을 크게 잡지 않는다");
  assert.equal(preflight.limits.maxCostUsd, 0.05);
  const progress = fs.readFileSync(path.join(attemptDir, "progress-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(progress.map((row) => row.itemId), ["selected"]);
});

test("D2-F: 전량 shadow는 packet 전건을 기존 유료 레일로 한 번씩만 측정한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2f-full-"));
  const approved = {
    ...CANDIDATE,
    candidateId: "p7-full-test",
    execution: {
      ...CANDIDATE.execution,
      runnable: true,
      state: "approved_shadow_full",
      maxCalls: 91,
      maxInputTokens: 200000,
      maxOutputTokensPerCall: 500,
      maxCostUsd: 1,
      perCallTimeoutMs: 60000,
      totalDeadlineMs: 600000,
      fullAllowed: true
    }
  };
  approved.candidateRecordSha256 = sha256(JSON.stringify(approved));
  const { poolPath, packetPath } = fixture(root, approved);
  const attemptDir = path.join(root, "attempt");
  let calls = 0;

  const result = await runSelectionShadowFull({
    attemptId: "d2f-fake-01",
    attemptDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      calls += 1;
      resolvedModels.add(candidate.requestedModel);
      if (calls === 2) throw new Error("api 400 invalid_request_error");
      if (calls === 1) {
        return {
          semantic: {
            contentType: "news",
            eventType: "domain_event",
            impactCategories: ["not-a-category"],
            subjectCategories: [],
            confidence: 0.9
          },
          usage: { inputTokens: 100, outputTokens: 30 }
        };
      }
      return {
        semantic: {
          contentType: request.contentKindHint === "community" ? "community" : "news",
          eventType: request.contentKindHint === "community" ? "community_discussion" : "domain_event",
          impactCategories: [request.declaredSection],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 100, outputTokens: 30 }
      };
    },
    maxProvider400Withholds: 3
  });

  assert.equal(calls, 91);
  assert.equal(result.status, "D2_SHADOW_FULL_MEASURED");
  assert.equal(result.productProven, false);
  const preflight = JSON.parse(fs.readFileSync(path.join(attemptDir, "preflight.json")));
  const receipt = JSON.parse(fs.readFileSync(path.join(attemptDir, "run-receipt.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(attemptDir, "attempt-manifest.json")));
  const ledger = fs.readFileSync(path.join(attemptDir, "usage-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(preflight.mode, "full");
  assert.equal(preflight.sample.targetIds.length, 91);
  assert.equal(receipt.calls, 91);
  assert.equal(receipt.schemaReject, 1);
  assert.equal(receipt.providerRejected, 1);
  assert.equal(receipt.qualityProof, false);
  assert.equal(manifest.mode, "full");
  assert.equal(ledger.filter((row) => row.type === "reserve").length, 91);
  assert.equal(ledger.filter((row) => row.type === "settle").length, 90);
  assert.equal(ledger.filter((row) => row.type === "cancel").length, 1);
  const progress = fs.readFileSync(path.join(attemptDir, "progress-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(progress.length, 91);
  assert.deepEqual(progress.map((row) => row.itemId), preflight.sample.targetIds);
});

test("D2-F: 중단된 전량 checkpoint는 검증된 결과를 재사용하고 남은 항목만 호출한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2f-resume-"));
  const approved = {
    ...CANDIDATE,
    candidateId: "p7-resume-test",
    execution: {
      ...CANDIDATE.execution,
      runnable: true,
      state: "approved_shadow_full",
      maxCalls: 91,
      maxInputTokens: 200000,
      maxOutputTokensPerCall: 500,
      maxCostUsd: 1,
      perCallTimeoutMs: 60000,
      totalDeadlineMs: 600000,
      fullAllowed: true
    }
  };
  approved.candidateRecordSha256 = sha256(JSON.stringify(approved));
  const { poolPath, packetPath } = fixture(root, approved);
  const failedDir = path.join(root, "failed");
  let firstCalls = 0;
  const failed = await runSelectionShadowFull({
    attemptId: "d2f-resume-failed",
    attemptDir: failedDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      firstCalls += 1;
      resolvedModels.add(candidate.requestedModel);
      if (firstCalls === 11) throw new Error("api 429");
      if (firstCalls === 1) {
        return {
          semantic: { contentType: "news", eventType: "domain_event", impactCategories: ["not-a-category"], subjectCategories: [], confidence: 0.9 },
          usage: { inputTokens: 100, outputTokens: 30 }
        };
      }
      return {
        semantic: {
          contentType: request.contentKindHint === "community" ? "community" : "news",
          eventType: request.contentKindHint === "community" ? "community_discussion" : "domain_event",
          impactCategories: [request.declaredSection],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 100, outputTokens: 30 }
      };
    }
  });
  assert.equal(failed.status, "UNSETTLED_USAGE_HOLD");
  assert.equal(failed.providerError, "api 429");

  const resumedDir = path.join(root, "resumed");
  let resumedCalls = 0;
  const resumed = await runSelectionShadowFull({
    attemptId: "d2f-resume-success",
    attemptDir: resumedDir,
    resumeFromDir: failedDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      resumedCalls += 1;
      resolvedModels.add(candidate.requestedModel);
      return {
        semantic: {
          contentType: request.contentKindHint === "community" ? "community" : "news",
          eventType: request.contentKindHint === "community" ? "community_discussion" : "domain_event",
          impactCategories: [request.declaredSection],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 100, outputTokens: 30 }
      };
    }
  });
  assert.equal(resumed.status, "D2_SHADOW_FULL_MEASURED");
  assert.equal(resumedCalls, 81);
  assert.equal(resumed.stats.cacheHits, 9);
  assert.equal(resumed.stats.schemaReject, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(resumedDir, "attempt-manifest.json")));
  assert.equal(manifest.resume.attemptId, "d2f-resume-failed");
  assert.equal(manifest.resume.reusableResults, 10);
});

test("NH89: 400으로 멈춘 shadow는 한 항목만 보류하고 보수적 비용을 승계해 재개한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-nh89-resume-400-"));
  const approved = {
    ...CANDIDATE,
    candidateId: "p11-resume-400-test",
    execution: {
      ...CANDIDATE.execution,
      runnable: true,
      state: "approved_shadow_full",
      maxCalls: 91,
      maxInputTokens: 200000,
      maxOutputTokensPerCall: 500,
      maxCostUsd: 1,
      perCallTimeoutMs: 60000,
      totalDeadlineMs: 600000,
      fullAllowed: true
    }
  };
  approved.candidateRecordSha256 = sha256(JSON.stringify(approved));
  const { poolPath, packetPath } = fixture(root, approved);
  const firstDir = path.join(root, "first");
  let firstCalls = 0;
  const classify = (resolvedModels, candidate, request) => {
    resolvedModels.add(candidate.requestedModel);
    return {
      semantic: {
        contentType: request.contentKindHint === "community" ? "community" : "news",
        eventType: request.contentKindHint === "community" ? "community_discussion" : "domain_event",
        impactCategories: [request.declaredSection],
        subjectCategories: [],
        confidence: 0.9
      },
      usage: { inputTokens: 100, outputTokens: 30 }
    };
  };

  const first = await runSelectionShadowFull({
    attemptId: "nh89-400-first",
    attemptDir: firstDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      firstCalls += 1;
      if (firstCalls === 11) throw new Error("api 400 invalid_request_error");
      return classify(resolvedModels, candidate, request);
    }
  });
  assert.equal(first.status, "UNSETTLED_USAGE_HOLD");
  const firstReceipt = JSON.parse(fs.readFileSync(path.join(firstDir, "run-receipt.json")));
  const frozen = Object.fromEntries(["preflight.json", "progress-results.jsonl", "run-receipt.json", "usage-ledger.jsonl"]
    .map((name) => [name, sha256(fs.readFileSync(path.join(firstDir, name)))]));

  const secondDir = path.join(root, "second-fails");
  let secondCalls = 0;
  const second = await runSelectionShadowFull({
    attemptId: "nh89-400-second",
    attemptDir: secondDir,
    resumeFromDir: firstDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: () => async () => {
      secondCalls += 1;
      throw new Error("api 400 invalid_request_error");
    }
  });
  assert.equal(second.status, "UNSETTLED_USAGE_HOLD");
  assert.equal(secondCalls, 1);

  let blockedKeyReads = 0;
  await assert.rejects(() => runSelectionShadowFull({
    attemptId: "nh89-400-third",
    attemptDir: path.join(root, "third-blocked"),
    resumeFromDir: secondDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => { blockedKeyReads += 1; return "fake-key"; },
    callModelFactory: () => async () => { throw new Error("must not call"); }
  }), /prior_provider_400 chain cap/);
  assert.equal(blockedKeyReads, 0);

  const successDir = path.join(root, "success");
  let resumedCalls = 0;
  const success = await runSelectionShadowFull({
    attemptId: "nh89-400-success",
    attemptDir: successDir,
    resumeFromDir: firstDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      resumedCalls += 1;
      return classify(resolvedModels, candidate, request);
    }
  });
  assert.equal(success.status, "D2_SHADOW_FULL_HOLD");
  assert.equal(resumedCalls, 80);
  assert.equal(success.stats.withheld, 1);
  assert.equal(success.stats.errors, 0);
  const progress = fs.readFileSync(path.join(successDir, "progress-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(progress.filter((row) => row.reason === "prior_provider_400").length, 1);
  const ledger = fs.readFileSync(path.join(successDir, "usage-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(ledger[0], {
    type: "recovery",
    calls: firstReceipt.lifetime.calls,
    inputTokens: firstReceipt.lifetime.inputTokens,
    outputTokens: firstReceipt.lifetime.outputTokens,
    seq: 0
  });
  assert.equal(ledger.some((row) => row.type === "settle" && row.inputTokens === 0 && row.outputTokens === 0), false);
  for (const [name, digest] of Object.entries(frozen)) {
    assert.equal(sha256(fs.readFileSync(path.join(firstDir, name))), digest);
  }
});

test("D2-E: 소비된 p6 승인은 디렉터리·Keychain·모델 호출 전에 차단한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2e-block-"));
  const { poolPath, packetPath } = fixture(root);
  const attemptDir = path.join(root, "attempt");
  let keyReads = 0;
  let factories = 0;

  await assert.rejects(() => runSelectionShadowCanary({
    attemptId: "d2e-blocked-01",
    attemptDir,
    poolPath,
    packetPath,
    candidateId: CANDIDATE.candidateId,
    registry: REGISTRY,
    getApiKey: () => { keyReads += 1; return "fake"; },
    callModelFactory: () => { factories += 1; return async () => null; }
  }), /CANDIDATE_APPROVAL_CONSUMED/);
  assert.equal(fs.existsSync(attemptDir), false);
  assert.equal(keyReads, 0);
  assert.equal(factories, 0);
});

test("D2-E: 가짜 모델 E2E는 현재 풀 대표 12건만 측정하고 품질 PASS를 주장하지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2e-run-"));
  const { poolPath, packetPath } = fixture(root);
  const attemptDir = path.join(root, "attempt");
  const approved = {
    ...CANDIDATE,
    execution: { ...CANDIDATE.execution, runnable: true, state: "approved_canary", maxCostUsd: 0.06 }
  };
  let calls = 0;
  const result = await runSelectionShadowCanary({
    attemptId: "d2e-fake-01",
    attemptDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels, candidate) => async ({ request }) => {
      calls += 1;
      resolvedModels.add(candidate.requestedModel);
      return {
        semantic: {
          contentType: request.contentKindHint === "community" ? "community" : "news",
          eventType: request.contentKindHint === "community" ? "community_discussion" : "domain_event",
          impactCategories: [request.declaredSection],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 100, outputTokens: 30 }
      };
    }
  });

  assert.equal(calls, 12);
  assert.equal(result.status, "D2_SHADOW_CANARY_MEASURED");
  assert.equal(result.productProven, false);
  assert.deepEqual(result.sample.omittedLegacyCategories, ["humor"]);
  const receipt = JSON.parse(fs.readFileSync(path.join(attemptDir, "run-receipt.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(attemptDir, "attempt-manifest.json")));
  const ledger = fs.readFileSync(path.join(attemptDir, "usage-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(receipt.calls, 12);
  assert.equal(receipt.retries, 0);
  assert.equal(receipt.qualityProof, false);
  assert.equal(manifest.resolvedModels[0], approved.requestedModel);
  assert.equal(ledger.filter((row) => row.type === "reserve").length, 12);
  assert.equal(ledger.filter((row) => row.type === "settle").length, 12);
  assert.equal(fs.existsSync(path.join(attemptDir, "full-predictions.json")), false);
});

test("D2-E: 기존 attempt와 packet drift는 어떤 유료 준비보다 먼저 거부한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2e-drift-"));
  const { poolPath, packetPath } = fixture(root);
  const approved = {
    ...CANDIDATE,
    execution: { ...CANDIDATE.execution, runnable: true, state: "approved_canary", maxCostUsd: 0.06 }
  };
  const common = {
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => { throw new Error("Keychain must not be read"); },
    callModelFactory: () => { throw new Error("model must not be prepared"); }
  };
  const existing = path.join(root, "existing");
  fs.mkdirSync(existing);
  await assert.rejects(() => runSelectionShadowCanary({ ...common, attemptId: "d2e-existing-01", attemptDir: existing }), /ATTEMPT_DIR_EXISTS_HOLD/);

  const packet = JSON.parse(fs.readFileSync(packetPath));
  const originalPromptSha = packet.candidate.promptSha256;
  packet.candidate.promptSha256 = "0".repeat(64);
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
  const driftAttempt = path.join(root, "drift-attempt");
  await assert.rejects(() => runSelectionShadowCanary({ ...common, attemptId: "d2e-drift-01", attemptDir: driftAttempt }), /packet candidate mismatch/);
  assert.equal(fs.existsSync(driftAttempt), false);

  packet.candidate.promptSha256 = originalPromptSha;
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
  const policyDriftCandidate = structuredClone(approved);
  policyDriftCandidate.compactPolicy.eventTypes.domain_event.requiredCoreCategories = ["tech"];
  const policyAttempt = path.join(root, "policy-attempt");
  await assert.rejects(() => runSelectionShadowCanary({
    ...common,
    attemptId: "d2e-policy-01",
    attemptDir: policyAttempt,
    candidateDef: policyDriftCandidate
  }), /packet candidate mismatch/);
  assert.equal(fs.existsSync(policyAttempt), false);
});

test("D2-E: 실제 응답 모델이 후보 alias와 다르면 정산 기록만 남기고 측정 manifest를 만들지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2e-model-"));
  const { poolPath, packetPath } = fixture(root);
  const attemptDir = path.join(root, "attempt");
  const approved = {
    ...CANDIDATE,
    execution: { ...CANDIDATE.execution, runnable: true, state: "approved_canary", maxCostUsd: 0.06 }
  };
  const result = await runSelectionShadowCanary({
    attemptId: "d2e-model-01",
    attemptDir,
    poolPath,
    packetPath,
    candidateId: approved.candidateId,
    candidateDef: approved,
    registry: REGISTRY,
    allowNonRunnableCandidateForTest: true,
    getApiKey: () => "fake-key",
    callModelFactory: (_apiKey, resolvedModels) => async ({ request }) => {
      resolvedModels.add("unexpected-model");
      return {
        semantic: {
          contentType: "news",
          eventType: "domain_event",
          impactCategories: [request.declaredSection],
          subjectCategories: [],
          confidence: 0.9
        },
        usage: { inputTokens: 10, outputTokens: 10 }
      };
    }
  });
  assert.equal(result.status, "MODEL_IDENTITY_HOLD");
  assert.equal(fs.existsSync(path.join(attemptDir, "terminal-receipt.json")), true);
  assert.equal(fs.existsSync(path.join(attemptDir, "attempt-manifest.json")), false);
});

test("D2-E: CLI도 소비된 p6 승인을 전용 attempt 쓰기 전에 차단한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-d2e-cli-"));
  const { poolPath, packetPath } = fixture(root);
  const attemptId = `d2e-cli-${process.pid}`;
  const run = spawnSync(process.execPath, ["tools/run-selection-shadow-canary.mjs", "--run-canary", attemptId,
    CANDIDATE.candidateId, "--pool", poolPath, "--packet", packetPath], {
    cwd: path.join(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" }
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /CANDIDATE_APPROVAL_CONSUMED/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", ".nowhot-local", "selection-shadow-attempts", attemptId)), false);
});
