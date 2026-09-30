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
import { fileURLToPath } from "node:url";

import { composeEventFromMembers } from "../src/feed/event-cluster.js";
import { loadRegistry } from "../src/feed/registry.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";
import { assembleCategoryLanes, crossSlotMaterialChange, sameServedEvent, selectPublicationEdition, slotSourceArticles, withholdServedEventRepeats } from "../tools/build-slot-canonical-edition.mjs";
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
  slotLabel = "모닝",
  urlBase = "https://example.com",
  preparedHeadlines = {},
  summaryTextByHash = {}
}) {
  const issues = CATEGORIES.flatMap((category) => Array.from({ length: 13 }, (_, index) => ({
    ...(preparedHeadlines[`${category.id}-${index}`]
      ? { preparedHeadline: preparedHeadlines[`${category.id}-${index}`] } : {}),
    evidenceHash: `${category.id}-${index}`,
    clusterId: `${category.id}-${index}`,
    headline: `${category.label} 기사 ${index}`,
    paragraph: "핵심 내용입니다.",
    whyImportant: "중요한 이유입니다.",
    categoryIds: [category.id],
    selectedByCategories: [category.id],
    eventSources: [{ sourceLabel: "매체", canonicalUrl: `${urlBase}/${category.id}/${index}`,
      title: `${category.label} 기사 ${index}`, originalTitle: "Original" }],
    articleSummary: {
      status: "ready",
      textKo: summaryTextByHash[`${category.id}-${index}`]
        || "공개 원문을 바탕으로 충분히 정리한 한국어 기사 요약입니다. ".repeat(4),
      sourceLinks: [{ label: "매체", url: `${urlBase}/${category.id}/${index}` }]
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

// Re-seal a deliberately altered artifact so activation accepts it, as an older builder's file would be.
function resealed(artifact) {
  const { artifactId, contentSha256, ...payload } = artifact;
  const sha = sha256(JSON.stringify(payload));
  return { ...payload, artifactId: `SCE-${sha.slice(0, 16)}`, contentSha256: sha };
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

test("검수 제목 파일은 빌더에 전달되고, 활성판에 반영되기 전에는 같은 슬롯을 건너뛰지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-review-"));
  const pool = path.join(root, "pool.json");
  const packet = path.join(root, "packet.json");
  const routingSnapshot = path.join(root, "routing.json");
  const headlineReview = path.join(root, "review.json");
  const poolRaw = '{"rows":[]}\n';
  fs.writeFileSync(pool, poolRaw);
  const packetRaw = `${JSON.stringify({ sourceSnapshot: { sha256: sha256(poolRaw) } })}\n`;
  fs.writeFileSync(packet, packetRaw);
  const routing = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-review",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: sha256(packetRaw), predictionsSha256: "a".repeat(64) },
    entries: []
  };
  fs.writeFileSync(routingSnapshot, `${JSON.stringify(routing)}\n`);
  const reviewedHash = `${CATEGORIES[0].id}-0`;
  fs.writeFileSync(headlineReview, `${JSON.stringify({
    contract: "NOWHOT-HEADLINE-REVIEW-001",
    entries: [{ evidenceHash: reviewedHash, originalTitle: "Original", headlineKo: "검수한 제목",
      articleSummaryTextKo: "검수한 기사 요약입니다." }]
  })}\n`);
  const activate = (preparedHeadlines, summaryTextByHash = {}) => activateSlotCanonicalEdition({
    artifact: validArtifact({ packetSha: sha256(packetRaw), routingSnapshot: routing, preparedHeadlines, summaryTextByHash }),
    directory: root,
    pointerFile: path.join(root, "active.json")
  });
  const job = { editionDate: "2026-08-28", slotId: "morning", pool, packet, routingSnapshot };

  activate({});
  assert.equal(slotAlreadyActive(job, root), true);
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), false,
    "검수 전 활성판이 새 검수 제목 적용을 건너뛰게 해서는 안 된다");
  activate({ [reviewedHash]: "검수한 제목" });
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), false,
    "제목만 고치고 상세 요약 오역을 남긴 판은 재사용하지 않는다");
  activate({ [reviewedHash]: "검수한 제목" }, { [reviewedHash]: "검수한 기사 요약입니다." });
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), true);

  // The review names a source text; a cached edition whose lead source text differs was not reviewed.
  const reviewRaw = fs.readFileSync(headlineReview, "utf8");
  fs.writeFileSync(headlineReview, reviewRaw.replace('"originalTitle":"Original"', '"originalTitle":"Other original"'));
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), false,
    "검수한 원문 제목과 다른 근거의 활성판을 검수 반영본으로 재사용하지 않는다");
  fs.writeFileSync(headlineReview, reviewRaw);
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), true);
  // A cached edition can carry the corrected preparedHeadline while its stored reader copy still shows the old one.
  const stale = validArtifact({ packetSha: sha256(packetRaw), routingSnapshot: routing,
    preparedHeadlines: { [reviewedHash]: "검수한 제목" }, summaryTextByHash: { [reviewedHash]: "검수한 기사 요약입니다." } });
  stale.issueTable[reviewedHash].reader.headline = "옛 오역 제목";
  activateSlotCanonicalEdition({ artifact: resealed(stale), directory: root, pointerFile: path.join(root, "active.json") });
  assert.equal(slotAlreadyActive({ ...job, headlineReview }, root), false,
    "독자 화면 제목이 검수 제목과 다른 활성판은 재사용하지 않는다");
  activate({ [reviewedHash]: "검수한 제목" }, { [reviewedHash]: "검수한 기사 요약입니다." });

  const seen = [];
  await runBuilder({ ...job, headlineReview }, root, {
    execute: async (_command, args) => {
      seen.push(args);
      return { stdout: '{"state":"candidate_ready","candidateFile":"candidate.json"}\n', stderr: "" };
    }
  });
  assert.equal(seen[0][seen[0].indexOf("--headline-review") + 1], headlineReview);

  const built = [];
  const result = await runPrepublishManifest({
    jobs: [{ ...job, headlineReview: path.basename(headlineReview) }]
  }, {
    baseDir: root,
    outDir: root,
    isActive: () => false,
    runBuild: async (row) => {
      built.push(row);
      return { state: "candidate_ready", slotId: row.slotId, candidateFile: "candidate.json" };
    },
    activateBuilt: () => {}
  });
  assert.equal(built[0].headlineReview, headlineReview);
  const [withoutReview] = (await runPrepublishManifest({ jobs: [job] }, {
    baseDir: root, outDir: root, isActive: () => false,
    runBuild: async (row) => ({ state: "candidate_ready", slotId: row.slotId, candidateFile: "c.json" }),
    activateBuilt: () => {}
  })).jobs;
  assert.notEqual(result.jobs[0].inputIdentity, withoutReview.inputIdentity);
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

test("같은 슬롯 재빌드는 자기 판 상세를 재사용하고, 이전 슬롯이 낸 기사는 첫 빌드·재빌드 모두 다시 받지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-served-"));
  const routing = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-served",
    generatedAt: "2026-09-28T00:00:00.000Z",
    source: { packetSha256: "b".repeat(64), predictionsSha256: "a".repeat(64) },
    entries: []
  };
  const activate = (editionDate, slotId, slotLabel) => activateSlotCanonicalEdition({
    artifact: validArtifact({
      packetSha: "b".repeat(64), routingSnapshot: routing, editionDate, slotId, slotLabel,
      urlBase: `https://example.com/${editionDate}/${slotId}`
    }),
    directory: root,
    pointerFile: path.join(root, "active.json")
  }).artifactFile;
  const calls = [];
  const execute = async (_command, args) => {
    calls.push(args);
    return { stdout: '{"state":"candidate_ready"}\n', stderr: "" };
  };
  const flag = (args, name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const build = async (slotId) => {
    await runBuilder({ editionDate: "2026-09-28", slotId, pool: "p", packet: "k", routingSnapshot: "r" }, root, { execute });
    const args = calls.at(-1);
    return { reuse: flag(args, "--reuse-edition"), served: flag(args, "--served-edition") };
  };
  const metadata = new Map(loadRegistry().map((source) => [source.id, source]));
  const row = (id, url, publishedAt, title = id) => ({ item: { id, kind: "news", source: "yna", title, url, canonicalUrl: url, publishedAt } });
  const candidates = (servedFile, slotId, evidenceAt, rows) => slotSourceArticles({
    pool: { savedAt: Date.parse(evidenceAt), rows },
    target: { editionDate: "2026-09-28", slotId, evidenceAsOfMs: Date.parse(evidenceAt) },
    metadata,
    servedArtifact: servedFile ? JSON.parse(fs.readFileSync(servedFile, "utf8")) : null
  }).map((item) => item.id).sort();

  // The evening edition was cut at 19:10 and published news up to 19:05.
  const evening = activate("2026-09-27", "evening", "이브닝");
  const morningRows = [
    row("evening-1730", "https://example.com/2026-09-27/evening/news/0", "2026-09-27T17:30:00+09:00", "뉴스/시사 기사 0"),
    row("evening-1905", "https://example.com/2026-09-27/evening/news/1", "2026-09-27T19:05:00+09:00", "뉴스/시사 기사 1"),
    row("gap-1845", "https://www.yna.co.kr/view/gap-1845", "2026-09-27T18:45:00+09:00"),
    row("daytime-1650", "https://www.yna.co.kr/view/daytime-1650", "2026-09-27T16:50:00+09:00"),
    row("night-2300", "https://www.yna.co.kr/view/night-2300", "2026-09-27T23:00:00+09:00")
  ];
  const morningIds = ["gap-1845", "night-2300"];
  const initialMorning = await build("morning");
  assert.deepEqual(initialMorning, { reuse: evening, served: evening });
  assert.deepEqual(candidates(initialMorning.served, "morning", "2026-09-28T06:30:00+09:00", morningRows), morningIds);

  const morning = activate("2026-09-28", "morning", "모닝");
  const lunchRows = [
    row("morning-served", "https://example.com/2026-09-28/morning/news/0", "2026-09-28T06:00:00+09:00", "뉴스/시사 기사 0"),
    row("lunch-own", "https://example.com/2026-09-28/lunch/news/0", "2026-09-28T10:30:00+09:00", "뉴스/시사 기사 0"),
    row("lunch-new", "https://www.yna.co.kr/view/lunch-new", "2026-09-28T11:00:00+09:00")
  ];
  const initialLunch = await build("lunch");
  assert.deepEqual(initialLunch, { reuse: morning, served: morning });
  assert.deepEqual(candidates(initialLunch.served, "lunch", "2026-09-28T11:45:00+09:00", lunchRows), ["lunch-new", "lunch-own"]);
  // The same served URL now carries a changed title: an update the change classifier must judge, not a repeat to drop here.
  const updatedRows = [
    ...lunchRows,
    { item: { ...row("morning-updated", "https://example.com/2026-09-28/morning/news/1", "2026-09-28T10:50:00+09:00").item,
      title: "뉴스 기사 1 사망 5명으로 늘어" } },
    { item: { ...row("morning-same", "https://example.com/2026-09-28/morning/news/2", "2026-09-28T10:50:00+09:00").item,
      title: "뉴스/시사 기사 2" } }
  ];
  assert.deepEqual(candidates(initialLunch.served, "lunch", "2026-09-28T11:45:00+09:00", updatedRows),
    ["lunch-new", "lunch-own", "morning-updated"]);

  const lunch = activate("2026-09-28", "lunch", "런치");
  const lunchRebuild = await build("lunch");
  assert.equal(lunchRebuild.reuse, lunch, "same-slot rebuild keeps its own prepared article details");
  assert.equal(lunchRebuild.served, morning, "same-slot rebuild still excludes what morning published");
  assert.deepEqual(candidates(lunchRebuild.served, "lunch", "2026-09-28T11:45:00+09:00", lunchRows), ["lunch-new", "lunch-own"]);

  const morningRebuild = await build("morning");
  assert.deepEqual(morningRebuild, { reuse: morning, served: evening }, "a later active slot is neither cache nor dedupe source");
  assert.deepEqual(candidates(morningRebuild.served, "morning", "2026-09-28T06:30:00+09:00", morningRows), morningIds);

  const eveningArgs = (await build("evening"), calls.at(-1));
  assert.deepEqual(eveningArgs.flatMap((value, index) => eveningArgs[index - 1] === "--served-edition" ? [value] : []),
    [morning, lunch], "evening dedupes against every earlier same-day slot");
});

test("저녁판은 앞선 기사와 별칭 중복을 막고 관련 근거·미제공 11시 보도는 남긴다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-served-union-"));
  const routing = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "routing-served-union",
    generatedAt: "2026-09-28T00:00:00.000Z",
    source: { packetSha256: "b".repeat(64), predictionsSha256: "a".repeat(64) },
    entries: []
  };
  const activate = (slotId, slotLabel) => activateSlotCanonicalEdition({
    artifact: validArtifact({
      packetSha: "b".repeat(64), routingSnapshot: routing, editionDate: "2026-09-28", slotId, slotLabel,
      urlBase: `https://example.com/2026-09-28/${slotId}`
    }),
    directory: root,
    pointerFile: path.join(root, "active.json")
  }).artifactFile;
  const morning = activate("morning", "모닝");
  const lunch = activate("lunch", "런치");
  const calls = [];
  await runBuilder({ editionDate: "2026-09-28", slotId: "evening", pool: "p", packet: "k", routingSnapshot: "r" }, root, {
    execute: async (_command, args) => {
      calls.push(args);
      return { stdout: '{"state":"candidate_ready"}\n', stderr: "" };
    }
  });
  const servedFiles = calls[0].flatMap((value, index) => calls[0][index - 1] === "--served-edition" ? [value] : []);
  assert.deepEqual(servedFiles, [morning, lunch]);

  const metadata = new Map(loadRegistry().map((source) => [source.id, source]));
  const row = (id, url, publishedAt, extra = {}) => ({ item: { id, kind: "news", source: "yna", title: id, url, canonicalUrl: url, publishedAt, ...extra } });
  const morningLead = "https://example.com/2026-09-28/morning/news/0";
  const lunchLead = "https://example.com/2026-09-28/lunch/news/0";
  const rows = [
    row("morning-served", morningLead, "2026-09-28T06:00:00+09:00", { title: "뉴스/시사 기사 0" }),
    row("lunch-served", lunchLead, "2026-09-28T10:30:00+09:00", { title: "뉴스/시사 기사 0" }),
    row("unserved-1100", "https://www.yna.co.kr/view/unserved-1100", "2026-09-28T11:00:00+09:00"),
    row("followup-1500", "https://www.yna.co.kr/view/followup-1500", "2026-09-28T15:00:00+09:00"),
    row("alias-twin", "https://www.yna.co.kr/view/alias-twin", "2026-09-28T16:00:00+09:00",
      { title: "뉴스/시사 기사 0", canonicalAliases: [{ id: "gnews-morning", url: morningLead }] }),
    row("related-only", "https://www.yna.co.kr/view/related-only", "2026-09-28T09:00:00+09:00")
  ];
  const served = servedFiles.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  const morningIssue = Object.values(served[0].issueTable).find((issue) => issue.eventSources[0].canonicalUrl === morningLead);
  morningIssue.sourceEvidence = [
    { canonicalUrl: morningLead, evidenceRole: "lead" },
    { canonicalUrl: "https://www.yna.co.kr/view/related-only", evidenceRole: "related_observation" },
    { canonicalUrl: morningLead, evidenceRole: "related_observation" }
  ];
  morningIssue.eventSources.push({ sourceLabel: "매체", canonicalUrl: "https://www.yna.co.kr/view/related-only" });
  const lunchIssue = Object.values(served[1].issueTable).find((issue) => issue.eventSources[0].canonicalUrl === lunchLead);
  lunchIssue.sourceEvidence = [
    { canonicalUrl: lunchLead, evidenceRole: "lead" },
    { canonicalUrl: "https://www.yna.co.kr/view/corroborated", evidenceRole: "corroborating" },
    { canonicalUrl: "https://www.yna.co.kr/view/corroborated", evidenceRole: "related_observation" }
  ];
  rows.push(row("corroborated", "https://www.yna.co.kr/view/corroborated", "2026-09-28T10:40:00+09:00"));
  morningIssue.articleSummary.sourceLinks.push({ url: "https://www.yna.co.kr/view/followup-1500" });
  const ids = (servedArtifact) => slotSourceArticles({
    pool: { savedAt: Date.parse("2026-09-28T18:30:00+09:00"), rows },
    target: { editionDate: "2026-09-28", slotId: "evening", evidenceAsOfMs: Date.parse("2026-09-28T18:30:00+09:00") },
    metadata,
    servedArtifact
  }).map((item) => item.id).sort();
  assert.deepEqual(ids(served), ["followup-1500", "related-only", "unserved-1100"],
    "같은 기사로 묶인 직접 URL과 이전 구글뉴스 별칭은 재제공하지 않는다");
  assert.deepEqual(ids(served[1]), ["alias-twin", "followup-1500", "morning-served", "related-only", "unserved-1100"],
    "lunch alone lets the morning article back in");

  fs.writeFileSync(morning, "{}\n");
  let executed = false;
  await assert.rejects(() => runBuilder({ editionDate: "2026-09-28", slotId: "evening", pool: "p", packet: "k", routingSnapshot: "r" }, root, {
    execute: async () => { executed = true; return { stdout: "{}\n" }; }
  }), /served edition/);
  assert.equal(executed, false, "an advertised earlier slot that cannot be read must not be silently skipped");
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

test("NH167 served event repeats: paraphrase, outlet or evidence-mode changes are withheld; a new number or confirmed outcome stays", () => {
  const article = (id, title, { publishedAt = "2026-09-30T08:00:00+09:00", url = `https://example.org/${id}`, source = "yonhap" } = {}) =>
    ({ id, title, kind: "news", category: "news", url, source, publishedAt });
  const story = (hash, row, { categories = ["news"], mode = "single_observed_feed", sourceCount = 1, sourceLabel = "연합뉴스" } = {}) => ({
    evidenceHash: hash.repeat(64), clusterId: hash.repeat(64), subject: row.title, headline: row.title,
    paragraph: "핵심 내용입니다.", whyImportant: "중요한 이유입니다.",
    categoryIds: categories, selectedByCategories: categories,
    metrics: { sourceCount, coverage: 1, score: 0, comments: 0, evidenceMode: mode },
    evidence: { mode },
    refs: [{ ...row, sourceLabel, canonicalUrl: row.url }],
    eventSources: [{ sourceLabel, canonicalUrl: row.url, title: row.title, publishedAt: row.publishedAt }],
    event: composeEventFromMembers([row]),
    articleSummary: { status: "ready", textKo: "공개 원문을 바탕으로 정리한 요약입니다. ".repeat(4), sourceLinks: [{ label: sourceLabel, url: row.url }] }
  });
  const fire = "삼성전자 평택 반도체 공장 화재 사망 3명";
  const morningFire = article("fire-a", fire);
  const served = [
    story("a", morningFire),
    story("b", article("launch-a", "누리호 4차 발사 오늘 오후 예정")),
    story("c", article("kleague-a", "K리그 우승 경쟁 재점화"), { categories: ["sports"] }),
    story("3", article("lafc-a", "손흥민 소속팀 LAFC, 도스 산토스 감독 경질⋯새 사령탑 물색"), { categories: ["sports"] })
  ];
  const unionOf = (issues, slotId = "morning") => ({
    editionDate: "2026-09-30", generatedAt: "2026-09-30T00:00:00.000Z", slot: { id: slotId, label: slotId },
    issues, availableCategories: CATEGORIES, publishable: true
  });
  const lanesOf = (issues) => Object.fromEntries(CATEGORIES.map((category) => [category.id, {
    ...unionOf(issues), issues: issues.filter((row) => row.selectedByCategories.includes(category.id))
  }]));
  const servedArtifact = buildSlotCanonicalEdition({
    editionsByCategory: lanesOf(served), unionEdition: unionOf(served),
    builderPacketSha256: "1".repeat(64), routingSnapshot: { source: { packetSha256: "1".repeat(64) } }
  });
  const lunchAt = { publishedAt: "2026-09-30T11:00:00+09:00" };
  const paraphrase = story("d", article("fire-b", `${fire} 확인`, lunchAt));
  assert.notEqual(paraphrase.event.factsFingerprint, served[0].event.factsFingerprint,
    "the real fingerprint changes on a paraphrase, so it cannot stand for a fact change");
  const modeOnly = story("e", article("fire-c", fire, { ...lunchAt, source: "kbs" }), { mode: "multiple_observed_feeds", sourceCount: 2, sourceLabel: "KBS" });
  const sameUrlUpdate = story("f", article("fire-a", "삼성전자 평택 반도체 공장 화재 사망 5명", lunchAt));
  // Same URL, translated title says 5 but the source's own original title still says 3: the original is the fact record.
  const translatedOnly = story("4", { ...article("fire-a", "삼성전자 평택 반도체 공장 화재 사망 5명", lunchAt), originalTitle: "Samsung Pyeongtaek plant fire leaves 3 dead" });
  translatedOnly.eventSources[0].originalTitle = "Samsung Pyeongtaek plant fire leaves 3 dead";
  translatedOnly.refs[0].originalTitle = "Samsung Pyeongtaek plant fire leaves 3 dead";
  const newUrlUpdate = story("0", article("fire-d", "삼성전자 평택 공장 화재 사망자 5명으로 늘어", { ...lunchAt, source: "kbs" }), { sourceLabel: "KBS" });
  const outcome = story("9", article("launch-b", "누리호 4차 발사 성공", lunchAt));
  const distinct = story("8", article("pohang", "포항 제철소 폭발 사고로 2명 부상", lunchAt));
  const newLane = story("7", article("kleague-b", "K리그 우승 경쟁 재점화", lunchAt), { categories: ["sports", "culture"] });
  // Generated headlines share boilerplate concepts; the classifier pairs them, but they are different stories.
  const boilerplate = (row) => ({ ...row, headline: `복수 수집 경로에서 확인된 소식: ${row.subject}` });
  served.push(boilerplate(story("6", article("thai-a", "태국전 2-3 패배 한국, 8강에서 이란 만난다", { publishedAt: "2026-09-30T06:30:00+09:00" }))));
  const unrelated = boilerplate(story("5", article("kim-b", "김하성, 4년 만의 가을야구에서 연타석 삼진 후 교체", lunchAt)));
  // Same dismissal retold with a tenure figure: a background number, not a changed fact (real 9/28 evening case).
  const tenure = story("2", article("lafc-b", "'충격' 손흥민 대표팀 차출되자 결국 터졌다...LAFC, 도스 산토스 감독 전격 경질 '9개월 동행 끝'", { ...lunchAt, source: "mt" }), { categories: ["sports"], sourceLabel: "머니투데이" });
  const current = [paraphrase, modeOnly, sameUrlUpdate, newUrlUpdate, outcome, distinct, newLane, unrelated, translatedOnly, tenure];
  const lunch = { editionDate: "2026-09-30", slotId: "lunch" };
  const result = withholdServedEventRepeats(unionOf(current, "lunch"), [servedArtifact], lunch);
  assert.deepEqual(result.edition.issues.map((row) => row.subject), [
    "삼성전자 평택 반도체 공장 화재 사망 5명",
    "삼성전자 평택 공장 화재 사망자 5명으로 늘어",
    "누리호 4차 발사 성공",
    "포항 제철소 폭발 사고로 2명 부상",
    "K리그 우승 경쟁 재점화",
    "김하성, 4년 만의 가을야구에서 연타석 삼진 후 교체"
  ]);
  assert.deepEqual(result.distinct.map((row) => [row.evidenceHash[0], row.matchMethod, row.basis]),
    [["0", "shared_event_concepts", "distinct:guard_number_conflict"]],
    "a new-URL number change is a distinct event for the merge guard, so it is kept either way");
  assert.deepEqual(result.withheld.map((row) => [row.evidenceHash[0], row.matchedEvidenceHash[0], row.basis]),
    [["d", "a", "no_demonstrated_fact_change"], ["e", "a", "no_demonstrated_fact_change"], ["4", "a", "no_demonstrated_fact_change"],
      ["2", "3", "no_demonstrated_fact_change"]],
    "a translation that disagrees with its own original title does not prove a new number; a tenure figure added to the same dismissal is background");
  assert.deepEqual(result.kept.map((row) => [row.evidenceHash[0], row.basis, row.numbers || null]),
    [["f", "changed_headline_number", ["5명"]], ["9", "confirmed_follow_up", null]]);
  assert.equal(result.comparedEditions, 1);
  assert.equal(result.edition.issues[0].changeState, undefined, "kept issues are the builder's own objects, not re-annotated copies");
  assert.equal(JSON.stringify(result).includes("matchedIssue"), false, "the matched previous issue never enters the receipt");

  // A same-slot rebuild and a later slot are not earlier: nothing is withheld against them.
  assert.equal(withholdServedEventRepeats(unionOf(current), [servedArtifact], { editionDate: "2026-09-30", slotId: "morning" }).withheld.length, 0);
  assert.equal(withholdServedEventRepeats(unionOf(current), [servedArtifact], { editionDate: "2026-09-29", slotId: "evening" }).withheld.length, 0);
  assert.equal(withholdServedEventRepeats(unionOf(current), undefined, lunch).edition.issues.length, current.length);
});

test("NH167 headline reviews are discovered per date-slot from a review directory and merged for the scheduled build", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-review-dir-"));
  const reviews = path.join(root, "reviews");
  fs.mkdirSync(reviews);
  const pool = path.join(root, "pool.json");
  const packet = path.join(root, "packet.json");
  const routingSnapshot = path.join(root, "routing.json");
  fs.writeFileSync(pool, "{}\n");
  fs.writeFileSync(packet, "{}\n");
  fs.writeFileSync(routingSnapshot, "{}\n");
  const review = (entries) => `${JSON.stringify({ contract: "NOWHOT-HEADLINE-REVIEW-001", entries })}\n`;
  const entry = (hash, headlineKo) => ({ evidenceHash: hash.repeat(64), originalTitle: "Original", headlineKo });
  fs.writeFileSync(path.join(reviews, "2026-08-28-morning-nvidia.json"), review([entry("1", "엔비디아 검수 제목")]));
  fs.writeFileSync(path.join(reviews, "2026-08-28-morning-snl.json"), review([entry("2", "SNL 검수 제목")]));
  fs.writeFileSync(path.join(reviews, "2026-08-28-lunch.json"), review([entry("3", "점심 검수 제목")]));
  fs.writeFileSync(path.join(reviews, "2026-08-29-morning.json"), review([entry("4", "다음날 검수 제목")]));
  fs.writeFileSync(path.join(reviews, "notes.txt"), "not a review\n");
  const job = { editionDate: "2026-08-28", slotId: "morning", pool, packet, routingSnapshot };
  const run = (jobs, options = {}) => {
    const seen = [];
    return runPrepublishManifest({ jobs, ...options }, {
      baseDir: root, outDir: root,
      isActive: (row) => { seen.push(row); return false; },
      runBuild: async (row) => ({ state: "candidate_ready", slotId: row.slotId, candidateFile: "c.json", headlineReview: row.headlineReview }),
      activateBuilt: () => {}
    }).then((result) => ({ result, seen }));
  };

  const { result, seen } = await run([job], { headlineReviewDir: "reviews" });
  const merged = seen[0].headlineReview;
  assert.ok(merged.startsWith(root), "merged review lives under the output directory");
  assert.deepEqual(JSON.parse(fs.readFileSync(merged, "utf8")), {
    contract: "NOWHOT-HEADLINE-REVIEW-001",
    entries: [entry("1", "엔비디아 검수 제목"), entry("2", "SNL 검수 제목")]
  }, "only this date-slot's files are merged, in name order");
  assert.equal(result.jobs[0].headlineReview, merged, "the active check and the builder see the same merged review");
  const plain = await run([job]);
  assert.equal(plain.seen[0].headlineReview, null, "without a review directory nothing changes");
  assert.notEqual(result.jobs[0].inputIdentity, plain.result.jobs[0].inputIdentity);

  const lunch = await run([{ ...job, slotId: "lunch" }], { headlineReviewDir: "reviews" });
  assert.equal(lunch.seen[0].headlineReview, path.join(reviews, "2026-08-28-lunch.json"), "a single file is passed as is");
  const explicit = path.join(root, "explicit.json");
  fs.writeFileSync(explicit, review([entry("5", "명시 검수 제목")]));
  const kept = await run([{ ...job, headlineReview: "explicit.json" }], { headlineReviewDir: "reviews" });
  assert.equal(kept.seen[0].headlineReview, explicit, "an explicit job review wins over discovery");

  const previous = process.env.NOWHOT_HEADLINE_REVIEW_DIR;
  process.env.NOWHOT_HEADLINE_REVIEW_DIR = reviews;
  try {
    const viaEnv = await run([{ ...job, slotId: "lunch" }]);
    assert.equal(viaEnv.seen[0].headlineReview, path.join(reviews, "2026-08-28-lunch.json"), "scheduled runs read the directory from the environment");
  } finally {
    if (previous === undefined) delete process.env.NOWHOT_HEADLINE_REVIEW_DIR; else process.env.NOWHOT_HEADLINE_REVIEW_DIR = previous;
  }

  fs.writeFileSync(path.join(reviews, "2026-08-28-morning-dup.json"), review([entry("2", "다른 SNL 제목")]));
  await assert.rejects(run([job], { headlineReviewDir: "reviews" }), /repeats evidenceHash/,
    "two files correcting the same evidence differently hold the slot instead of picking one");
  assert.ok(fs.readdirSync(root).some((name) => name.startsWith("prepublish-hold-2026-08-28-morning-")));
  await assert.rejects(run([job], { headlineReviewDir: "missing-reviews" }), /headline review directory/,
    "a configured but unreadable review directory holds the slot rather than silently skipping reviews");
});

test("NH167 extras are admitted lane by lane up to 20 with no shared quota; rejections and overflow carry reasons", () => {
  const base = (category, index, { qualified = false, publishedAt = "2026-08-28T10:30:00+09:00" } = {}) => ({
    evidenceHash: `${category}-${index}`, clusterId: `${category}-${index}`, headline: `${category} ${index}`,
    selectedByCategories: [category], categoryIds: [category], refs: [],
    eventSources: [{ sourceLabel: "매체", canonicalUrl: `https://example.com/${category}/${index}`, publishedAt }],
    articleSummary: { status: "ready", textKo: "요약", sourceLinks: [] },
    metrics: qualified
      ? { sourceCount: 2, independentGroupCount: 2, sourceRoles: { reported_secondary: 2 }, communityOnly: false }
      : { sourceCount: 1, independentGroupCount: 1, sourceRoles: { reported_secondary: 1 }, communityOnly: false },
    evidence: { independentGroupCount: qualified ? 2 : 1 },
    event: { sourceEvidence: (qualified ? ["yonhap", "kbs"] : ["yonhap"]).map((group, i) => ({ articleId: `${category}-${index}-${i}`, operatorGroup: group, evidenceRole: "reporting" })) }
  });
  const target = { editionDate: "2026-08-28", slotId: "lunch" };
  const full = CATEGORIES.flatMap((category) => Array.from({ length: 14 }, (_, index) => base(category.id, index)));
  const newsExtras = Array.from({ length: 8 }, (_, index) => base("news", 14 + index, { qualified: true }));
  const techExtras = [base("tech", 14, { qualified: true }), base("tech", 15), base("tech", 16, { qualified: true, publishedAt: "2026-08-28T06:00:00+09:00" })];
  const { editions, extras } = assembleCategoryLanes({ issues: [...full, ...newsExtras, ...techExtras] }, target);
  assert.equal(editions.news.issues.length, 20, "news fills to 20 even though every other lane is already full");
  assert.equal(editions.tech.issues.length, 15);
  assert.deepEqual(extras.withheld.map((row) => [row.evidenceHash, row.reason]), [["news-20", "lane_capacity_20"], ["news-21", "lane_capacity_20"]]);
  assert.deepEqual(extras.rejected.map((row) => [row.evidenceHash, row.reason]),
    [["tech-15", "not_multi_source_news"], ["tech-16", "outside_current_slot_window"]]);
  assert.equal(extras.admitted.length, 7);
  assert.equal(extras.policy, "automated_multi_source_news_selection");
  assert.equal(new Set(Object.values(editions).flatMap((edition) => edition.issues.map((row) => row.evidenceHash))).size, 203);
});

test("NH167 shipped headline reviews are discovered by default and packaged in the image", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-prepublish-default-reviews-"));
  for (const name of ["pool.json", "packet.json", "routing.json"]) fs.writeFileSync(path.join(root, name), "{}\n");
  const seen = [];
  const previous = process.env.NOWHOT_HEADLINE_REVIEW_DIR;
  delete process.env.NOWHOT_HEADLINE_REVIEW_DIR;
  try {
    await runPrepublishManifest({ jobs: [
      { editionDate: "2026-09-28", slotId: "evening", pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json" },
      { editionDate: "2026-09-28", slotId: "morning", pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json" },
      { editionDate: "2026-09-29", slotId: "morning", pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json" },
      { editionDate: "2026-09-30", slotId: "lunch", pool: "pool.json", packet: "packet.json", routingSnapshot: "routing.json" }
    ] }, {
      baseDir: root, outDir: root,
      isActive: (row) => { seen.push([`${row.editionDate}:${row.slotId}`, row.headlineReview]); return true; }
    });
  } finally {
    if (previous !== undefined) process.env.NOWHOT_HEADLINE_REVIEW_DIR = previous;
  }
  const shipped = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "headline-reviews");
  assert.deepEqual(seen, [
    ["2026-09-28:morning", path.join(shipped, "2026-09-28-morning-snl.json")],
    ["2026-09-28:evening", path.join(shipped, "2026-09-28-evening-nvidia.json")],
    ["2026-09-29:morning", null],
    ["2026-09-30:lunch", path.join(shipped, "2026-09-30-lunch-bose.json")]
  ], "the reviewed corrections apply to their own slots without any configuration");
  const dockerfile = fs.readFileSync(path.join(shipped, "..", "..", "Dockerfile"), "utf8");
  assert.match(dockerfile, /^COPY examples\/headline-reviews \.\/examples\/headline-reviews$/m,
    "the image ships the default review directory the scheduled publisher reads");
});

test("NH167 repeats are withheld before lane trimming so fresh reserve candidates refill the baseline without extras qualification", () => {
  const article = (id, title, publishedAt = "2026-09-30T11:00:00+09:00") =>
    ({ id, title, kind: "news", category: "news", url: `https://example.org/${id}`, source: "yonhap", publishedAt });
  const story = (hash, row, { qualified = false } = {}) => ({
    evidenceHash: hash, clusterId: hash, subject: row.title, headline: row.title, paragraph: "핵심", whyImportant: "이유",
    categoryIds: ["news"], selectedByCategories: ["news"],
    metrics: qualified
      ? { sourceCount: 2, independentGroupCount: 2, coverage: 1, score: 0, comments: 0, evidenceMode: "multiple_observed_feeds", sourceRoles: { reported_secondary: 2 }, communityOnly: false }
      : { sourceCount: 1, independentGroupCount: 1, coverage: 1, score: 0, comments: 0, evidenceMode: "single_observed_feed", sourceRoles: { reported_secondary: 1 }, communityOnly: false },
    evidence: { mode: qualified ? "multiple_observed_feeds" : "single_observed_feed", independentGroupCount: qualified ? 2 : 1 },
    refs: [{ ...row, sourceLabel: "연합뉴스", canonicalUrl: row.url }],
    eventSources: [{ sourceLabel: "연합뉴스", canonicalUrl: row.url, title: row.title, publishedAt: row.publishedAt }],
    event: { ...composeEventFromMembers([row]), sourceEvidence: (qualified ? ["yonhap", "kbs"] : ["yonhap"])
      .map((group, i) => ({ articleId: `${hash}-${i}`, operatorGroup: group, evidenceRole: "reporting" })) },
    articleSummary: { status: "ready", textKo: "요약입니다. ".repeat(8), sourceLinks: [{ label: "연합뉴스", url: row.url }] }
  });
  const servedTitles = ["정부 추석 연휴 고속도로 통행료 면제 확정", "한국은행 기준금리 동결 결정", "국회 본회의 예산안 처리 합의"];
  const served = servedTitles.map((title, index) => story(`served-${index}`, article(`served-${index}`, title, "2026-09-30T06:00:00+09:00")));
  const unionOf = (issues, slotId) => ({
    editionDate: "2026-09-30", generatedAt: "2026-09-30T00:00:00.000Z", slot: { id: slotId, label: slotId },
    issues, availableCategories: CATEGORIES, publishable: true
  });
  const servedArtifact = buildSlotCanonicalEdition({
    editionsByCategory: Object.fromEntries(CATEGORIES.map((category) => [category.id,
      { ...unionOf(served, "morning"), issues: served.filter((row) => row.selectedByCategories.includes(category.id)) }])),
    unionEdition: unionOf(served, "morning"),
    builderPacketSha256: "1".repeat(64), routingSnapshot: { source: { packetSha256: "1".repeat(64) } }
  });
  // Generated lunch edition: ranks 1..14 include the three morning stories again under other URLs.
  const generated = [
    ...servedTitles.map((title, index) => story(`repeat-${index}`, article(`repeat-${index}`, `${title} 확인`))),
    ...Array.from({ length: 11 }, (_, index) => story(`fresh-${index}`, article(`fresh-${index}`, `점심 새 소식 ${index + 1}번 사건`))),
    ...Array.from({ length: 3 }, (_, index) => story(`reserve-${index}`, article(`reserve-${index}`, `예비 단독 보도 ${index + 1}번 사건`))),
    story("extra-q", article("extra-q", "다수 매체 보도 새 사건 발표"), { qualified: true }),
    story("extra-plain", article("extra-plain", "단일 매체 추가 보도 사건"))
  ];
  const target = { editionDate: "2026-09-30", slotId: "lunch" };
  const { edition, repeatCheck, extras: selectionExtras } = selectPublicationEdition(unionOf(generated, "lunch"), [servedArtifact], target);
  assert.deepEqual(repeatCheck.withheld.map((row) => row.evidenceHash), ["repeat-0", "repeat-1", "repeat-2"]);
  assert.deepEqual(selectionExtras.rejected.map((row) => [row.evidenceHash, row.reason]), [["extra-plain", "not_multi_source_news"]]);
  const { editions, extras } = assembleCategoryLanes(edition, target);
  assert.deepEqual(editions.news.issues.map((row) => row.evidenceHash), [
    ...Array.from({ length: 11 }, (_, index) => `fresh-${index}`),
    "reserve-0", "reserve-1", "reserve-2",
    "extra-q"
  ], "three reserve single-source stories refill the 14 baseline seats; the qualified 15th is the only extra");
  assert.deepEqual(extras.admitted.map((row) => row.evidenceHash), ["extra-q"]);
  assert.equal(edition.issues.some((row) => row.evidenceHash === "extra-plain"), false, "the unqualified 15th is not prepared");

  // The previous order (trim first, then withhold) would have left the lane at eleven.
  const trimmedFirst = assembleCategoryLanes(unionOf(generated, "lunch"), target).editions.news.issues;
  const afterwards = withholdServedEventRepeats({ ...unionOf(generated, "lunch"), issues: trimmedFirst }, [servedArtifact], target);
  assert.equal(afterwards.edition.issues.length, 12);
});

test("NH167 real 9/30 pairs: concept matches on boilerplate are distinct events; true repeats and retitles are the same story", () => {
  const { pairs } = JSON.parse(fs.readFileSync(new URL("./fixtures/nh167-cross-slot-pairs-2026-09-30.json", import.meta.url), "utf8"));
  assert.ok(pairs.length >= 8, "fixture carries the harvested pairs");
  const asIssue = (row) => ({
    evidenceHash: "c".repeat(64), subject: row.title, headline: row.title, categoryIds: ["news"], selectedByCategories: ["news"],
    metrics: { sourceCount: 1, coverage: 1, score: 0, comments: 0, communityOnly: row.kind === "community" },
    refs: [{ id: row.id, title: row.title, source: row.source, canonicalUrl: row.canonicalUrl || row.url, publishedAt: row.publishedAt }],
    eventSources: [{ evidenceId: row.id, sourceId: row.source, title: row.title, originalTitle: row.originalTitle || null,
      canonicalUrl: row.canonicalUrl || row.url, publishedAt: row.publishedAt }]
  });
  for (const pair of pairs) {
    const current = asIssue(pair.currentLead);
    const verdict = sameServedEvent(pair.previous, current, pair.matchMethod);
    assert.equal(verdict.same, pair.expected === "same", `${pair.label}: ${verdict.basis} (matched on ${JSON.stringify(pair.matchedTerms)})`);
    if (pair.expected === "same") {
      assert.equal(crossSlotMaterialChange(pair.previous, current).material, false, `${pair.label} adds no new number or confirmed outcome`);
    }
  }
});

test("NH167 review: substantive first amounts survive but dates, tenure and model numbers are not updates", () => {
  const issue = title => ({eventSources:[{title,originalTitle:title,publishedAt:"2026-09-30T03:00:00Z"}],metrics:{communityOnly:false}});
  for(const [before,after,expected] of [
    ["우즈 원폭 영화 출연 고사", "우즈 원폭 영화 국고지원금 1억5천만원 받는다", true],
    ["공장 화재 사망 3명", "공장 화재 사망 3명, 가동 9개월 만", false],
    ["공장 화재 사망 3명", "공장 화재 사망 5명", true],
    ["Plant fire leaves 3 dead", "Plant fire leaves 5 dead", true],
    ["공장 화재 사망 3명", "Plant fire leaves 3 dead", false],
    ["공장 화재 사망 3명", "2026년 공장 화재 사망 3명", false],
    ["이어폰 가격 99달러", "이어폰 가격 129달러", true],
    ["Earbuds cost $99", "이어폰 가격 99달러", false],
    ["LAFC 감독 경질", "LAFC 감독 경질 9개월 동행 끝", false]
  ]) assert.equal(crossSlotMaterialChange(issue(before),issue(after)).material,expected,after);
  assert.equal(sameServedEvent(issue("2026년 Nike’s Ghostface Air Force 1 Is Scary Good"),issue("2026년 Nike’s Waterproof Air Force 1 Is the Real Winter Soldier"),"shared_event_concepts").same,false);
});

test("NH167 late review corrects the active artifact without rebuilding and preserves old shared editions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-late-review-"));
  const outDir = path.join(root, "editions");
  const workDir = path.join(root, "work");
  const reviews = path.join(root, "reviews");
  fs.mkdirSync(workDir); fs.mkdirSync(reviews);
  const frozenPool = '{"savedAt":1787871600000,"rows":[]}\n';
  const packet = JSON.stringify({ sourceSnapshot: { sha256: sha256(frozenPool) } });
  const routing = { contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001", snapshotId: "late-review-routing",
    generatedAt: "2026-08-28T00:00:00.000Z",
    source: { packetSha256: sha256(packet), predictionsSha256: "b".repeat(64) }, entries: [] };
  for (const [name, bytes] of [["pool", frozenPool], ["packet", packet], ["routing", JSON.stringify(routing)]]) {
    fs.writeFileSync(path.join(workDir, `${name}.json`), bytes);
  }
  const poolFile = path.join(root, "live-pool.json");
  fs.writeFileSync(poolFile, '{"savedAt":0,"rows":[]}\n');
  let original = validArtifact({ packetSha: sha256(packet), routingSnapshot: routing });
  const hash = sha256("reviewed evidence");
  original.issueTable[hash] = { ...original.issueTable["news-0"], evidenceHash: hash };
  delete original.issueTable["news-0"];
  original.lanes.news = original.lanes.news.map(id => id === "news-0" ? hash : id);
  original.displayOrder = original.displayOrder.map(id => id === "news-0" ? hash : id);
  original = resealed(original);
  const pointerFile = path.join(outDir, "active.json");
  activateSlotCanonicalEdition({ artifact: original, directory: outDir, pointerFile });
  const pointerBefore = fs.readFileSync(pointerFile, "utf8");
  const reviewFile = path.join(reviews, "2026-08-28-morning.json");
  const entry = { evidenceHash: hash, originalTitle: "Original", headlineKo: "시청: 뒤늦게 확인한 정확한 제목" };
  const writeReview = row => fs.writeFileSync(reviewFile, JSON.stringify({ contract: "NOWHOT-HEADLINE-REVIEW-001", entries: [row] }));
  writeReview(entry);
  const previous = process.env.NOWHOT_HEADLINE_REVIEW_DIR;
  process.env.NOWHOT_HEADLINE_REVIEW_DIR = reviews;
  let builds = 0;
  const run = () => runDueSlotPrepublish({ nowMs: Date.parse("2026-08-28T08:00:00+09:00"), poolFile, outDir, workDir,
    runManifest: () => { builds += 1; throw new Error("late correction must not rebuild selection"); } });
  try {
    writeReview({ ...entry, originalTitle: "wrong source" });
    const held = await run();
    assert.equal(held.state, "hold");
    assert.match(held.error, /originalTitle mismatch/);
    const holdFile = fs.readdirSync(outDir).find(name => name.startsWith("prepublish-hold-"));
    const heldAt = fs.statSync(path.join(outDir, holdFile)).mtimeMs;
    assert.equal((await run()).state, "hold");
    assert.equal(fs.statSync(path.join(outDir, holdFile)).mtimeMs, heldAt);
    assert.equal(fs.readFileSync(pointerFile, "utf8"), pointerBefore);
    writeReview(entry);
    // A collection failure and missing historical build inputs cannot block a source-bound correction.
    fs.writeFileSync(poolFile, "{");
    fs.rmSync(workDir, { recursive: true });
    assert.equal((await run()).state, "complete");
    const pointer = JSON.parse(fs.readFileSync(pointerFile));
    assert.ok(Object.values(pointer.publishedEditions).some(row => row.artifactId === original.artifactId));
    const corrected = JSON.parse(fs.readFileSync(path.join(outDir, pointer.editions["2026-08-28:morning"].file)));
    assert.notEqual(corrected.artifactId, original.artifactId);
    assert.deepEqual(corrected.lanes, original.lanes);
    assert.deepEqual(corrected.displayOrder, original.displayOrder);
    assert.deepEqual(corrected.routingSnapshot, original.routingSnapshot);
    assert.equal(corrected.issueTable[hash].preparedHeadline, entry.headlineKo);
    assert.equal(corrected.issueTable[hash].reader.headline, "뒤늦게 확인한 정확한 제목");
    for (const id of original.displayOrder.filter(id => id !== hash)) {
      assert.deepEqual(corrected.issueTable[id], original.issueTable[id]);
    }
    const correctedPointer = fs.readFileSync(pointerFile, "utf8");
    assert.equal((await run()).state, "already_active");
    assert.equal(fs.readFileSync(pointerFile, "utf8"), correctedPointer);
    assert.equal(builds, 0);
    fs.rmSync(reviewFile);
    assert.equal((await run()).state, "already_active", "a broken live pool cannot block an active no-op tick");
  } finally {
    if (previous === undefined) delete process.env.NOWHOT_HEADLINE_REVIEW_DIR;
    else process.env.NOWHOT_HEADLINE_REVIEW_DIR = previous;
  }
});
