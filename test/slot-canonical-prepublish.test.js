import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CATEGORIES } from "../src/feed/taxonomy.js";
import {
  activateSlotCanonicalEdition,
  buildSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";
import {
  runBuilder,
  runPrepublishManifest,
  slotAlreadyActive
} from "../tools/run-slot-canonical-prepublish.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function validArtifact({ packetSha, routingSnapshot, summaryBuildMode }) {
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
    editionDate: "2026-08-28",
    generatedAt: "2026-08-28T00:00:00.000Z",
    slot: { id: "morning", label: "모닝" },
    issues: issues.filter((row) => row.categoryIds.includes(category.id)),
    availableCategories: CATEGORIES,
    publishable: true
  }]));
  return buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition: {
      editionDate: "2026-08-28",
      generatedAt: "2026-08-28T00:00:00.000Z",
      slot: { id: "morning", label: "모닝" },
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

test("기존 빌더 호출은 기본적으로 키를 숨기고 명시적 유료 실행에만 전달한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-builder-"));
  const seen = [];
  const spawn = (_command, args, options) => {
    seen.push({ args, env: options.env });
    return { status: 0, stdout: '{"state":"candidate_ready","candidateFile":"candidate.json"}\n', stderr: "" };
  };
  const job = {
    editionDate: "2026-08-28", slotId: "morning",
    pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json"
  };
  runBuilder(job, root, { spawn, environment: { ANTHROPIC_API_KEY: "secret", KEEP: "yes" } });
  assert.equal(seen[0].args.includes("--activate"), false);
  assert.equal(seen[0].args.includes("--allow-paid"), false);
  assert.equal(seen[0].env.ANTHROPIC_API_KEY, undefined);
  assert.equal(seen[0].env.KEEP, "yes");
  runBuilder(job, root, {
    allowPaid: true,
    spawn,
    environment: { ANTHROPIC_API_KEY: "secret", KEEP: "yes" }
  });
  assert.equal(seen[1].args.includes("--allow-paid"), true);
  assert.equal(seen[1].env.ANTHROPIC_API_KEY, "secret");
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
