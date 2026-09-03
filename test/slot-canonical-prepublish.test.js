import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";

import { CATEGORIES } from "../src/feed/taxonomy.js";
import {
  activateSlotCanonicalEdition,
  buildSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";
import {
  runDueSlotPrepublish,
  runBuilder,
  runPrepublishManifest,
  slotAlreadyActive
} from "../tools/run-slot-canonical-prepublish.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function validArtifact({
  packetSha,
  routingSnapshot,
  summaryBuildMode,
  editionDate = "2026-08-28",
  slotId = "morning",
  slotLabel = "모닝"
}) {
  const issues = CATEGORIES.flatMap((category) => Array.from({ length: 13 }, (_, index) => ({
    evidenceHash: `${category.id}-${index}`,
    clusterId: `${category.id}-${index}`,
    headline: `${category.label} 기사 ${index}`,
    paragraph: "핵심 내용입니다.",
    whyImportant: "중요한 이유입니다.",
    categoryIds: [category.id],
    selectedByCategories: [category.id],
    eventSources: [{ sourceLabel: "매체", canonicalUrl: `https://example.com/${category.id}/${index}` }],
    articleSummary: {
      status: "ready",
      textKo: "공개 원문을 바탕으로 충분히 정리한 한국어 기사 요약입니다. ".repeat(4),
      sourceLinks: [{ label: "매체", url: `https://example.com/${category.id}/${index}` }]
    }
  })));
  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category.id, {
    editionDate,
    generatedAt: "2026-08-28T00:00:00.000Z",
    slot: { id: slotId, label: slotLabel },
    issues: issues.filter((row) => row.categoryIds.includes(category.id)),
    availableCategories: CATEGORIES,
    publishable: true
  }]));
  return buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition: {
      editionDate,
      generatedAt: "2026-08-28T00:00:00.000Z",
      slot: { id: slotId, label: slotLabel },
      issues,
      availableCategories: CATEGORIES,
      publishable: true
    },
    builderPacketSha256: packetSha,
    routingSnapshot,
    summaryBuildMode
  });
}

function manifest(root) {
  return {
    jobs: ["morning", "lunch", "evening"].map((slotId) => ({
      editionDate: "2026-08-28",
      slotId,
      pool: path.join(root, `${slotId}-pool.json`),
      packet: path.join(root, `${slotId}-packet.json`),
      routingSnapshot: path.join(root, `${slotId}-routing.json`)
    }))
  };
}

test("사전 발행 실행기는 활성 슬롯을 건너뛰고 나머지를 시간순으로 기존 빌더에 맡긴다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-"));
  for (const slotId of ["morning", "lunch", "evening"]) {
    for (const suffix of ["pool", "packet", "routing"]) {
      fs.writeFileSync(path.join(root, `${slotId}-${suffix}.json`), "{}\n");
    }
  }
  const calls = [];
  const activations = [];
  const reversed = manifest(root);
  reversed.jobs.reverse();
  const result = await runPrepublishManifest(reversed, {
    outDir: root,
    isActive: (job) => job.slotId === "morning",
    runBuild: async (job) => {
      calls.push(job.slotId);
      return { state: "candidate_ready", slotId: job.slotId, candidateFile: `${job.slotId}.json` };
    },
    activateBuilt: (rows) => activations.push(rows.map((row) => row.slotId))
  });

  assert.deepEqual(calls, ["lunch", "evening"]);
  assert.deepEqual(activations, [["lunch", "evening"]]);
  assert.deepEqual(result.jobs.map((row) => row.state), ["already_active", "activated", "activated"]);
});

test("한 슬롯이 실패하면 활성 포인터를 보존하고 뒤 슬롯을 실행하지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-hold-"));
  const input = manifest(root);
  for (const job of input.jobs) {
    fs.writeFileSync(job.pool, "{}\n");
    fs.writeFileSync(job.packet, "{}\n");
    fs.writeFileSync(job.routingSnapshot, "{}\n");
  }
  const pointerFile = path.join(root, "active.json");
  const pointerBytes = '{"editions":{"2026-08-27:evening":{"artifactId":"stable"}}}\n';
  fs.writeFileSync(pointerFile, pointerBytes);
  const calls = [];
  await assert.rejects(() => runPrepublishManifest(input, {
    outDir: root,
    isActive: () => false,
    runBuild: async (job) => {
      calls.push(job.slotId);
      if (job.slotId === "lunch") throw new Error("candidate rejected");
      const candidateFile = path.join(root, `${job.slotId}-candidate.json`);
      fs.writeFileSync(candidateFile, JSON.stringify({ candidate: job.slotId }));
      return { state: "candidate_ready", slotId: job.slotId, candidateFile };
    }
  }), /lunch.*candidate rejected/);

  assert.deepEqual(calls, ["morning", "lunch"]);
  assert.equal(fs.readFileSync(pointerFile, "utf8"), pointerBytes);
  const receipts = fs.readdirSync(root).filter((name) => name.startsWith("prepublish-hold-"));
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, receipts[0]))).state, "hold");
});

test("활성판 재사용은 포인터와 풀·패킷·분류 입력이 모두 같을 때만 허용한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-active-"));
  const pool = path.join(root, "pool.json");
  const packet = path.join(root, "packet.json");
  const routingSnapshot = path.join(root, "routing.json");
  const poolRaw = '{"rows":[]}\n';
  fs.writeFileSync(pool, poolRaw);
  const packetRaw = `${JSON.stringify({ sourceSnapshot: { sha256: sha256(poolRaw) } })}\n`;
  fs.writeFileSync(packet, packetRaw);
  const routing = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-1",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: sha256(packetRaw), predictionsSha256: "a".repeat(64) },
    entries: []
  };
  fs.writeFileSync(routingSnapshot, `${JSON.stringify(routing)}\n`);
  activateSlotCanonicalEdition({
    artifact: validArtifact({ packetSha: sha256(packetRaw), routingSnapshot: routing }),
    directory: root,
    pointerFile: path.join(root, "active.json")
  });
  const job = { editionDate: "2026-08-28", slotId: "morning", pool, packet, routingSnapshot };

  assert.equal(slotAlreadyActive(job, root), true);
  assert.equal(slotAlreadyActive(job, root, { allowPaid: true }), false,
    "무료 전처리 판이 승인된 유료 보강 실행까지 건너뛰게 해서는 안 된다");
  fs.writeFileSync(routingSnapshot, `${JSON.stringify({ ...routing, snapshotId: "routing-2" })}\n`);
  assert.equal(slotAlreadyActive(job, root), false);
  fs.writeFileSync(routingSnapshot, `${JSON.stringify(routing)}\n`);
  fs.writeFileSync(pool, '{"rows":[1]}\n');
  assert.equal(slotAlreadyActive(job, root), false);
});

test("predictions 입력이 바뀌면 같은 날짜·슬롯도 활성판을 재사용하지 않는다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-predictions-"));
  const pool = path.join(root, "pool.json");
  const packet = path.join(root, "packet.json");
  const predictions = path.join(root, "predictions.json");
  const poolRaw = '{"rows":[]}\n';
  const predictionsRaw = '{"predictions":[]}\n';
  fs.writeFileSync(pool, poolRaw);
  const packetRaw = `${JSON.stringify({ sourceSnapshot: { sha256: sha256(poolRaw) } })}\n`;
  fs.writeFileSync(packet, packetRaw);
  fs.writeFileSync(predictions, predictionsRaw);
  const routing = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-predictions",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: sha256(packetRaw), predictionsSha256: sha256(predictionsRaw) },
    entries: []
  };
  activateSlotCanonicalEdition({
    artifact: validArtifact({ packetSha: sha256(packetRaw), routingSnapshot: routing }),
    directory: root,
    pointerFile: path.join(root, "active.json")
  });
  const job = { editionDate: "2026-08-28", slotId: "morning", pool, packet, predictions };

  assert.equal(slotAlreadyActive(job, root), true);
  fs.writeFileSync(predictions, '{"predictions":[1]}\n');
  assert.equal(slotAlreadyActive(job, root), false);
});

test("손상되거나 포인터 디렉터리 밖에 있는 artifact는 활성판으로 재사용하지 않는다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-corrupt-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-outside-"));
  const pool = path.join(root, "pool.json");
  const packet = path.join(root, "packet.json");
  const routingSnapshot = path.join(root, "routing.json");
  fs.writeFileSync(pool, '{}\n');
  fs.writeFileSync(packet, `${JSON.stringify({ sourceSnapshot: { sha256: sha256('{}\n') } })}\n`);
  fs.writeFileSync(routingSnapshot, '{}\n');
  const outsideFile = path.join(outside, "artifact.json");
  fs.writeFileSync(outsideFile, JSON.stringify({ editionDate: "2026-08-28", slot: { id: "morning" } }));
  fs.writeFileSync(path.join(root, "active.json"), JSON.stringify({
    editions: { "2026-08-28:morning": { file: path.relative(root, outsideFile) } }
  }));

  assert.equal(slotAlreadyActive({
    editionDate: "2026-08-28", slotId: "morning", pool, packet, routingSnapshot
  }, root), false);
});

test("기존 빌더 호출은 기본적으로 키를 숨기고 명시적 유료 실행에만 전달한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-builder-"));
  const seen = [];
  const execute = async (_command, args, options) => {
    seen.push({ args, env: options.env });
    return { stdout: '{"state":"candidate_ready","candidateFile":"candidate.json"}\n', stderr: "" };
  };
  const job = {
    editionDate: "2026-08-28", slotId: "morning",
    pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json"
  };
  await runBuilder(job, root, { execute, environment: { ANTHROPIC_API_KEY: "secret", KEEP: "yes" } });
  assert.equal(seen[0].args.includes("--activate"), false);
  assert.equal(seen[0].args.includes("--allow-paid"), false);
  assert.equal(seen[0].env.ANTHROPIC_API_KEY, undefined);
  assert.equal(seen[0].env.KEEP, "yes");
  await runBuilder(job, root, {
    allowPaid: true,
    execute,
    environment: { ANTHROPIC_API_KEY: "secret", KEEP: "yes" }
  });
  assert.equal(seen[1].args.includes("--allow-paid"), true);
  assert.equal(seen[1].env.ANTHROPIC_API_KEY, "secret");
});

test("사전 빌드가 끝나기 전에도 HTTP 요청을 처리하고 자식 실패는 전달한다", async (t) => {
  const server = createServer((_req, res) => res.end("available"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const execute = promisify(execFile);
  const job = { editionDate: "2026-09-03", slotId: "morning", pool: "unused", packet: "unused", routingSnapshot: "unused" };
  let finished = false;
  const building = runBuilder(job, os.tmpdir(), {
    execute: (command, _args, options) => execute(command, ["-e",
      'setTimeout(() => console.log(JSON.stringify({state:"candidate_ready"})), 1000)'
    ], options)
  }).then((result) => { finished = true; return result; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
    signal: AbortSignal.timeout(750)
  });
  assert.equal(await response.text(), "available");
  assert.equal(finished, false, "서버는 빌드 완료를 기다리지 않는다");
  assert.equal((await building).state, "candidate_ready");
  await assert.rejects(() => runBuilder(job, os.tmpdir(), {
    execute: (command, _args, options) => execute(command, ["-e", 'process.exit(2)'], options)
  }), /Command failed/);
});

test("전량 빌드 뒤 활성화가 실패해도 포인터를 보존하고 activation HOLD를 남긴다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-activate-hold-"));
  const input = manifest(root);
  for (const job of input.jobs) {
    fs.writeFileSync(job.pool, "{}\n");
    fs.writeFileSync(job.packet, "{}\n");
    fs.writeFileSync(job.routingSnapshot, "{}\n");
  }
  const pointerFile = path.join(root, "active.json");
  const pointerBytes = '{"editions":{"2026-08-27:evening":{"artifactId":"stable"}}}\n';
  fs.writeFileSync(pointerFile, pointerBytes);

  await assert.rejects(() => runPrepublishManifest(input, {
    outDir: root,
    isActive: () => false,
    runBuild: async (job) => ({
      state: "candidate_ready",
      editionDate: job.editionDate,
      slotId: job.slotId,
      candidateFile: path.join(root, `${job.slotId}.json`)
    }),
    activateBuilt: () => { throw new Error("pointer write failed"); }
  }), /activation.*pointer write failed/);

  assert.equal(fs.readFileSync(pointerFile, "utf8"), pointerBytes);
  const receipts = fs.readdirSync(root).filter((name) => name.startsWith("prepublish-hold-activation-"));
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, receipts[0]))).stage, "activation");
});

test("정시 실행은 현재 풀에서 무료 packet·routing을 준비해 기존 원자 발행기에 한 번만 맡긴다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-due-"));
  const outDir = path.join(root, "editions");
  const workDir = path.join(root, "work");
  const poolFile = path.join(root, "pool.json");
  const savedAt = Date.parse("2026-08-28T07:30:00+09:00");
  fs.writeFileSync(poolFile, `${JSON.stringify({
    savedAt,
    rows: [{ item: {
      id: "article-1",
      title: "국내 주요 정책 발표",
      summary: "정부가 오늘 주요 정책을 발표했습니다.",
      source: "unknown-source",
      category: "news",
      registryCategory: "news",
      kind: "news",
      publishedAt: new Date(savedAt - 60_000).toISOString()
    } }]
  })}\n`);
  const priorRouting = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "prior-routing",
    generatedAt: "2026-08-27T12:00:00.000Z",
    source: { packetSha256: "a".repeat(64), predictionsSha256: "b".repeat(64) },
    entries: []
  };
  activateSlotCanonicalEdition({
    artifact: validArtifact({
      packetSha: "a".repeat(64),
      routingSnapshot: priorRouting,
      editionDate: "2026-08-27",
      slotId: "evening",
      slotLabel: "이브닝"
    }),
    directory: outDir,
    pointerFile: path.join(outDir, "active.json")
  });
  let received = null;
  const poolBeforeBuild = fs.readFileSync(poolFile, "utf8");

  const result = await runDueSlotPrepublish({
    nowMs: Date.parse("2026-08-28T07:40:00+09:00"),
    poolFile,
    outDir,
    workDir,
    runManifest: async (manifest, options) => {
      received = { manifest, options };
      fs.writeFileSync(poolFile, '{"rows":[]}\n');
      return { state: "complete", jobs: [] };
    }
  });

  assert.equal(result.editionDate, "2026-08-28");
  assert.equal(result.slotId, "morning");
  assert.equal(result.paidCalls, 0);
  assert.equal(received.options.allowPaid, false);
  assert.equal(received.manifest.jobs.length, 1);
  assert.equal(received.manifest.jobs[0].pool, path.join(workDir, "pool.json"));
  assert.equal(fs.readFileSync(received.manifest.jobs[0].pool, "utf8"), poolBeforeBuild,
    "수집 풀이 바뀌어도 빌더에는 패킷과 같은 원본 바이트를 전달한다");
  assert.ok(fs.existsSync(received.manifest.jobs[0].packet));
  assert.ok(fs.existsSync(received.manifest.jobs[0].routingSnapshot));
  const packet = JSON.parse(fs.readFileSync(received.manifest.jobs[0].packet));
  const routing = JSON.parse(fs.readFileSync(received.manifest.jobs[0].routingSnapshot));
  assert.equal(packet.candidate.candidateId, "p14-policy-shadow-haiku-full-nh91-20260828-evening");
  assert.deepEqual(routing.entries.map((entry) => entry.itemId), ["article-1"]);
  assert.equal(routing.counts.routingBasis.withheld, 1);
});

test("발행 20분 전에는 현재판 대신 다음 슬롯을 미리 준비한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-next-"));
  const outDir = path.join(root, "editions");
  const poolFile = path.join(root, "pool.json");
  const savedAt = Date.parse("2026-08-28T11:44:00+09:00");
  fs.writeFileSync(poolFile, `${JSON.stringify({
    savedAt,
    rows: [{ item: {
      id: "article-next",
      title: "런치 주요 기사",
      summary: "정오 전에 확인된 주요 기사입니다.",
      source: "unknown-source",
      category: "news",
      registryCategory: "news",
      kind: "news",
      publishedAt: new Date(savedAt - 60_000).toISOString()
    } }]
  })}\n`);
  const routingSnapshot = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "active-morning-routing",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: "a".repeat(64), predictionsSha256: "b".repeat(64) },
    entries: []
  };
  activateSlotCanonicalEdition({
    artifact: validArtifact({ packetSha: "a".repeat(64), routingSnapshot }),
    directory: outDir,
    pointerFile: path.join(outDir, "active.json")
  });
  let received = null;

  const result = await runDueSlotPrepublish({
    nowMs: Date.parse("2026-08-28T11:45:00+09:00"),
    poolFile,
    outDir,
    runManifest: async (manifest) => {
      received = manifest;
      return { state: "complete", jobs: [] };
    }
  });

  assert.equal(result.slotId, "lunch");
  assert.equal(received.jobs[0].slotId, "lunch");
  assert.equal(result.paidCalls, 0);
});

test("이미 활성화된 날짜·슬롯은 풀이 시간창 밖이어도 고정판을 다시 만들지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-fixed-slot-"));
  const outDir = path.join(root, "editions");
  const workDir = path.join(root, "work");
  const poolFile = path.join(root, "pool.json");
  fs.writeFileSync(poolFile, `${JSON.stringify({
    savedAt: Date.parse("2026-08-26T07:30:00+09:00"),
    rows: [{ item: { id: "newer", title: "더 늦게 들어온 기사" } }]
  })}\n`);
  const routingSnapshot = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "active-routing",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: "a".repeat(64), predictionsSha256: "b".repeat(64) },
    entries: []
  };
  activateSlotCanonicalEdition({
    artifact: validArtifact({ packetSha: "a".repeat(64), routingSnapshot }),
    directory: outDir,
    pointerFile: path.join(outDir, "active.json")
  });
  let called = 0;

  const result = await runDueSlotPrepublish({
    nowMs: Date.parse("2026-08-28T07:40:00+09:00"),
    poolFile,
    outDir,
    workDir,
    runManifest: async () => { called += 1; }
  });

  assert.equal(result.state, "already_active");
  assert.equal(called, 0);
  assert.equal(fs.existsSync(workDir), false);
});

test("정시 실행은 슬롯 시간창 밖 풀을 작업 파일·빌더·포인터 변경 전에 거부한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-stale-"));
  const outDir = path.join(root, "editions");
  const workDir = path.join(root, "work");
  fs.mkdirSync(outDir, { recursive: true });
  const pointerFile = path.join(outDir, "active.json");
  const pointerBytes = '{"stable":true}\n';
  fs.writeFileSync(pointerFile, pointerBytes);
  const poolFile = path.join(root, "pool.json");
  fs.writeFileSync(poolFile, `${JSON.stringify({
    savedAt: Date.parse("2026-08-26T07:30:00+09:00"),
    rows: [{ item: { id: "stale", title: "오래된 기사" } }]
  })}\n`);
  let called = 0;

  await assert.rejects(() => runDueSlotPrepublish({
    nowMs: Date.parse("2026-08-28T07:40:00+09:00"),
    poolFile,
    outDir,
    workDir,
    runManifest: async () => { called += 1; }
  }), /outside morning preparation window/);

  assert.equal(called, 0);
  assert.equal(fs.existsSync(workDir), false);
  assert.equal(fs.readFileSync(pointerFile, "utf8"), pointerBytes);
});
