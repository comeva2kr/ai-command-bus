import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CATEGORIES } from "../src/feed/taxonomy.js";
import { createServer } from "../src/feed/server.js";
import {
  activateSlotCanonicalEdition,
  buildSlotCanonicalEdition,
  makeSlotCanonicalEditionReader,
  projectSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";
import {
  assertForeignMajorLaneCoverage,
  assertSamePoolInputs,
  categoryEditionsFromUnion,
  foreignMajorLaneCoverage,
  poolRows,
  resolveSlotCanonicalBuildTarget,
  resolveSlotCanonicalReferenceNow
} from "../tools/build-slot-canonical-edition.mjs";

const packetSha = "a".repeat(64);

test("런타임 풀의 row.item 래퍼를 기사 배열로 정확히 푼다", () => {
  const item = { id: "wrapped", source: "publisher" };
  assert.deepEqual(poolRows({ rows: [{ item, firstSeenAt: 1 }] }), [item]);
  assert.deepEqual(poolRows({ rows: [item] }), [item]);
});

test("판 날짜·슬롯과 근거 시각을 실행 시계와 섞지 않는다", () => {
  const savedAt = Date.parse("2026-08-27T15:15:00.000Z");
  assert.deepEqual(resolveSlotCanonicalBuildTarget({
    pool: { savedAt, rows: [{ item: { id: "a" } }] },
    editionDate: "2026-08-27",
    slotId: "evening"
  }), {
    editionDate: "2026-08-27",
    slotId: "evening",
    evidenceAsOfMs: savedAt
  });
  assert.throws(() => resolveSlotCanonicalBuildTarget({
    pool: { savedAt, rows: [{ item: { id: "a" } }] },
    editionDate: "2026-08-28",
    slotId: "night"
  }), /invalid slot/);
});

test("분류는 수집 풀을 얼린 직후 끝나도 같은 슬롯의 준비 시각으로 인정한다", () => {
  const poolEvidenceAsOf = Date.parse("2026-08-27T12:20:37.780Z");
  const routingGeneratedAt = "2026-08-27T12:23:46.000Z";
  assert.equal(
    resolveSlotCanonicalReferenceNow(poolEvidenceAsOf, routingGeneratedAt),
    Date.parse(routingGeneratedAt)
  );
  assert.throws(() => resolveSlotCanonicalReferenceNow(
    poolEvidenceAsOf,
    "2026-08-29T00:00:00.000Z"
  ), /stale for pool/);
});

function issue(id, selectedByCategories) {
  const sourceLinks = [{ label: `매체 ${id}`, url: `https://publisher.example/${id}` }];
  return {
    clusterId: `cluster-${id}`,
    evidenceHash: `evidence-${id}`,
    headline: `기사 ${id}`,
    paragraph: `기사 ${id}의 핵심 내용을 정리했습니다.`,
    whyImportant: `기사 ${id}가 중요한 이유입니다.`,
    whyHot: `기사 ${id}에서 새로 확인된 내용입니다.`,
    watchNext: `기사 ${id}의 다음 발표를 확인합니다.`,
    selectedByCategories,
    categoryIds: selectedByCategories,
    refs: [{ id, title: `기사 ${id}`, sourceLabel: `매체 ${id}`, canonicalUrl: sourceLinks[0].url }],
    sourceEvidence: [{ evidenceId: id, sourceLabel: `매체 ${id}`, canonicalUrl: sourceLinks[0].url }],
    eventSources: [{ evidenceId: id, sourceLabel: `매체 ${id}`, canonicalUrl: sourceLinks[0].url }],
    reader: {
      headline: `기사 ${id}`,
      summary: `기사 ${id}의 핵심 내용을 정리했습니다.`,
      whyImportant: `기사 ${id}가 중요한 이유입니다.`,
      whyNow: `기사 ${id}에서 새로 확인된 내용입니다.`,
      watchNext: `기사 ${id}의 다음 발표를 확인합니다.`
    },
    articleSummary: {
      status: "ready",
      textKo: "공개 원문에서 확인한 사실을 바탕으로 작성한 한국어 요약입니다. ".repeat(4),
      sourceLinks,
      generatedAt: "2026-08-27T02:50:00.000Z"
    }
  };
}

function editions() {
  const byCategory = {};
  const all = new Map();
  for (const category of CATEGORIES) {
    const rows = Array.from({ length: 13 }, (_, index) => {
      const id = index === 0 && ["tech", "gaming"].includes(category.id)
        ? "shared-tech-gaming"
        : `${category.id}-${index}`;
      const categories = id === "shared-tech-gaming" ? ["tech", "gaming"] : [category.id];
      const row = issue(id, categories);
      if (!all.has(id)) all.set(id, row);
      return row;
    });
    byCategory[category.id] = {
      editionDate: "2026-08-27",
      generatedAt: "2026-08-27T03:00:00.000Z",
      slot: { id: "lunch", label: "런치" },
      issues: rows,
      availableCategories: CATEGORIES,
      publishable: true
    };
  }
  const unionEdition = {
    editionDate: "2026-08-27",
    generatedAt: "2026-08-27T03:00:00.000Z",
    slot: { id: "lunch", label: "런치" },
    issues: [...all.values()],
    availableCategories: CATEGORIES,
    publishable: true,
    serving: { state: "current_machine_verified" }
  };
  return { byCategory, unionEdition };
}

function build() {
  const { byCategory, unionEdition } = editions();
  return buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });
}

test("슬롯 고정판은 복수 분야를 정확한 합집합으로 투영하고 사건 내용은 고정한다", () => {
  const artifact = build();
  const tech = projectSlotCanonicalEdition(artifact, { categories: ["tech"] });
  const gaming = projectSlotCanonicalEdition(artifact, { categories: ["gaming"] });
  const both = projectSlotCanonicalEdition(artifact, { categories: ["tech", "gaming"] });

  assert.equal(tech.issues.length, 13);
  assert.equal(gaming.issues.length, 13);
  assert.equal(both.issues.length, 25);
  assert.equal(both.issues.filter((row) => row.evidenceHash === "evidence-shared-tech-gaming").length, 1);
  assert.deepEqual(
    both.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming").selectedByCategories,
    ["tech", "gaming"]
  );
  const techShared = tech.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming");
  const gamingShared = gaming.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming");
  assert.deepEqual(techShared, gamingShared);
  assert.deepEqual(both.categoryFulfillment.rows.map((row) => row.issueCount), [13, 13]);
});

test("슬롯 고정판은 요청 전에 기존 독자용 제목을 계산해 얼린다", () => {
  const { byCategory, unionEdition } = editions();
  const targetId = unionEdition.issues[0].evidenceHash;
  for (const row of unionEdition.issues) {
    if (row.evidenceHash !== targetId) continue;
    row.headline = `“핵심 제목” · 관련 보도 묶음 포착`;
    delete row.reader;
  }
  for (const edition of Object.values(byCategory)) {
    for (const row of edition.issues) {
      if (row.evidenceHash !== targetId) continue;
      row.headline = `“핵심 제목” · 관련 보도 묶음 포착`;
      delete row.reader;
    }
  }
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });
  assert.equal(artifact.issueTable[targetId].reader.headline, "기사 news-0");
  assert.doesNotMatch(artifact.issueTable[targetId].reader.headline, /관련 보도 묶음 포착/);
  assert.equal(artifact.issueTable[targetId].readerLineage.contentHash.length, 64);
});

test("슬롯 고정판은 기사 사진 대신 사이트 기본 로고가 들어오면 사진 없이 얼린다", () => {
  const { byCategory, unionEdition } = editions();
  const targetId = unionEdition.issues[0].evidenceHash;
  for (const row of unionEdition.issues) {
    if (row.evidenceHash === targetId) row.articleSummary.image = "https://www.ytn.co.kr/img/comm/ytn_sns_default.jpg";
  }
  for (const edition of Object.values(byCategory)) {
    for (const row of edition.issues) {
      if (row.evidenceHash === targetId) row.articleSummary.image = "https://www.ytn.co.kr/img/comm/ytn_sns_default.jpg";
    }
  }
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });

  assert.equal(artifact.issueTable[targetId].articleSummary.image, null);
});

test("슬롯 고정판은 과거 캐시의 게시판 HIT 목록을 기사 본문으로 얼리지 않는다", () => {
  const { byCategory, unionEdition } = editions();
  const targetId = unionEdition.issues[0].evidenceHash;
  const pageChrome = "🔥오늘의 HIT 30 종합 유머 연예 생활 시사 이슈 ".repeat(20);
  for (const row of unionEdition.issues) {
    if (row.evidenceHash === targetId) row.articleSummary.textKo = pageChrome;
  }
  for (const edition of Object.values(byCategory)) {
    for (const row of edition.issues) {
      if (row.evidenceHash === targetId) row.articleSummary.textKo = pageChrome;
    }
  }
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });

  assert.equal(artifact.issueTable[targetId].articleSummary.status, "source_unavailable");
  assert.equal(artifact.issueTable[targetId].articleSummary.textKo, null);
  assert.equal(artifact.issueTable[targetId].articleSummary.unavailableReasonCode, "NO_PUBLIC_BODY");
});

test("한 전체판에서 14개 고정 레인을 파생하고 다른 풀 조합은 거부한다", () => {
  const { unionEdition } = editions();
  const lanes = categoryEditionsFromUnion(unionEdition);
  assert.deepEqual(Object.keys(lanes), CATEGORIES.map((category) => category.id));
  assert.equal(lanes.tech.issues.length, 13);
  assert.equal(lanes.gaming.issues.length, 13);
  assert.deepEqual(
    lanes.tech.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming"),
    lanes.gaming.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming")
  );

  const poolRaw = JSON.stringify({ rows: [{ id: "a" }] });
  const packetRaw = JSON.stringify({ sourceSnapshot: { sha256: "ignored" } });
  const poolSha = crypto.createHash("sha256").update(poolRaw).digest("hex");
  const packetDigest = crypto.createHash("sha256").update(packetRaw).digest("hex");
  assert.doesNotThrow(() => assertSamePoolInputs({
    poolRaw,
    packetRaw,
    packet: { sourceSnapshot: { sha256: poolSha } },
    routingSnapshot: { source: { packetSha256: packetDigest } }
  }));
  assert.throws(() => assertSamePoolInputs({
    poolRaw,
    packetRaw,
    packet: { sourceSnapshot: { sha256: "b".repeat(64) } },
    routingSnapshot: { source: { packetSha256: packetDigest } }
  }), /pool SHA mismatch/);
});

test("13건 미달·미준비 상세·다른 풀의 라우팅 스냅샷은 판 전체를 거부한다", () => {
  const underfilled = editions();
  underfilled.byCategory.politics.issues.pop();
  assert.throws(() => buildSlotCanonicalEdition({
    editionsByCategory: underfilled.byCategory,
    unionEdition: underfilled.unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  }), /politics.*13/);

  const pending = editions();
  pending.unionEdition.issues[0].articleSummary = { status: "pending" };
  assert.throws(() => buildSlotCanonicalEdition({
    editionsByCategory: pending.byCategory,
    unionEdition: pending.unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  }), /articleSummary/);

  const mixed = editions();
  assert.throws(() => buildSlotCanonicalEdition({
    editionsByCategory: mixed.byCategory,
    unionEdition: mixed.unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: "b".repeat(64) } }
  }), /packetSha256/);
});

test("해외 주요 매체 후보가 있으면 뉴스·경제·기술 고정판 하한을 발행 전에 확인한다", () => {
  const nowMs = Date.parse("2026-08-27T12:15:00+09:00");
  const rows = [
    ["n1", "bbc-world", "news"], ["n2", "guardian-world", "news"], ["n3", "nyt-world", "news"],
    ["b1", "bbc-business", "business"], ["b2", "cnbc-economy", "business"],
    ["t1", "wired", "tech"]
  ];
  const pool = rows.map(([id, source]) => ({
    id,
    source,
    publishedAt: new Date(nowMs - 2 * 3600 * 1000).toISOString()
  }));
  const routingSnapshot = {
    entries: rows.map(([itemId, , category]) => ({ itemId, categories: [category] }))
  };
  const unionEdition = {
    issues: rows.map(([id, , category]) => ({
      evidenceHash: id,
      selectedByCategories: [category],
      refs: [{ id }]
    }))
  };
  const registry = [...new Set(rows.map(([, source]) => source))].map((id) => ({
    id, enabled: true, kind: "news", editorialAuthority: "global_major"
  }));
  const coverage = foreignMajorLaneCoverage({ pool, routingSnapshot, unionEdition, registry, nowMs });

  assert.deepEqual(coverage, {
    news: { eligible: 3, staleExcluded: 0, selected: 3, required: 3 },
    business: { eligible: 2, staleExcluded: 0, selected: 2, required: 2 },
    tech: { eligible: 1, staleExcluded: 0, selected: 1, required: 1 }
  });
  assert.doesNotThrow(() => assertForeignMajorLaneCoverage(coverage));
  assert.throws(() => assertForeignMajorLaneCoverage({
    ...coverage, news: { ...coverage.news, selected: 2 }
  }), /news foreign-major floor 2\/3/);

  const stalePool = pool.map((row) => row.id === "t1" ? {
    ...row,
    publishedAt: new Date(nowMs - 14 * 24 * 3600 * 1000).toISOString()
  } : row);
  const staleCoverage = foreignMajorLaneCoverage({
    pool: stalePool,
    routingSnapshot,
    unionEdition: {
      issues: unionEdition.issues.filter((issue) => issue.evidenceHash !== "t1")
    },
    registry,
    nowMs
  });
  assert.deepEqual(staleCoverage.tech,
    { eligible: 0, staleExcluded: 1, selected: 0, required: 0 });
  assert.doesNotThrow(() => assertForeignMajorLaneCoverage(staleCoverage));
});

test("활성화 실패는 이전 포인터를 보존하고 성공판은 날짜·슬롯별로 원자 교체한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-"));
  const pointerFile = path.join(root, "active.json");
  const artifact = build();
  activateSlotCanonicalEdition({ artifact, directory: root, pointerFile });
  const before = fs.readFileSync(pointerFile);

  const invalid = structuredClone(artifact);
  invalid.lanes.politics.pop();
  assert.throws(() => activateSlotCanonicalEdition({ artifact: invalid, directory: root, pointerFile }), /politics.*13/);
  assert.deepEqual(fs.readFileSync(pointerFile), before);

  const reader = makeSlotCanonicalEditionReader({ pointerFile });
  const projected = reader.read({ date: "2026-08-27", slotId: "lunch", categories: ["news"] });
  assert.equal(projected.issues.length, 13);
  assert.equal(projected.editionDate, "2026-08-27");
  assert.equal(projected.slot.id, "lunch");

  assert.throws(() => reader.read({
    date: "2026-08-27", slotId: "evening", categories: ["news"]
  }), (error) => error?.code === "SLOT_CANONICAL_EDITION_UNAVAILABLE");

  assert.throws(() => reader.read({
    date: "2026-08-28", slotId: "morning", categories: ["news"]
  }), (error) => error?.code === "SLOT_CANONICAL_EDITION_UNAVAILABLE");

  const emptyPointer = path.join(root, "empty.json");
  fs.writeFileSync(emptyPointer, JSON.stringify({ editions: {} }));
  assert.throws(() => makeSlotCanonicalEditionReader({ pointerFile: emptyPointer }).read({
    date: "2026-08-27", slotId: "evening", categories: ["news"]
  }), /slot canonical edition unavailable/);
});

async function dispatch(server, url) {
  const handler = server.listeners("request")[0];
  let status = 0;
  let body = "";
  const req = {
    method: "GET", url, headers: { host: "localhost" }, on() {},
    socket: { remoteAddress: "127.0.0.1" }
  };
  const res = {
    req,
    writeHead(code) { status = code; return res; },
    setHeader() {}, getHeader() { return null; },
    write(chunk) { body += chunk; return true; },
    end(chunk) { if (chunk !== undefined && typeof chunk !== "function") body += chunk; }
  };
  await handler(req, res);
  return { status, body: JSON.parse(body) };
}

test("고정판 GET은 수집·요약·저장 없이 포인터 판을 필터링만 한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-server-"));
  const pointerFile = path.join(root, "active.json");
  activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
  let sourceCalls = 0;
  let summaryCalls = 0;
  const server = createServer({
    localEditorial: true,
    localEditorialInventorySchedule: false,
    slotCanonicalEditionEnabled: true,
    slotCanonicalPointerFile: pointerFile,
    clock: () => Date.parse("2026-08-27T12:10:00+09:00"),
    file: null,
    sources: [{ id: "must-not-run", kind: "news", fetch: async () => { sourceCalls += 1; return []; } }],
    articleSummaryPipeline: async (edition) => { summaryCalls += 1; return edition; },
    vapid: null
  });

  const response = await dispatch(server, "/api/today?categories=tech,gaming");
  assert.equal(response.status, 200);
  assert.equal(response.body.issues.length, 25);
  assert.equal(response.body.slotCanonicalEdition.requestWork, "filter_only");
  assert.equal(sourceCalls, 0);
  assert.equal(summaryCalls, 0);
});

test("고정판에서 관심 분야를 저장해도 구형 판 생성을 다시 시작하지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-category-save-"));
  const pointerFile = path.join(root, "active.json");
  activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
  let sourceCalls = 0;
  const server = createServer({
    localEditorial: true,
    slotCanonicalEditionEnabled: true,
    slotCanonicalPointerFile: pointerFile,
    file: null,
    sources: [{ id: "must-not-run", kind: "news", category: "news", fetch: async () => {
      sourceCalls += 1;
      return [];
    } }],
    vapid: null
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sessionResponse = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0] || "";
    const session = await sessionResponse.json();
    const response = await fetch(`${base}/api/today/categories`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: session.userId, categories: ["news"] })
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sourceCalls, 0);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
