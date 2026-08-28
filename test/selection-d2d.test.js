import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { assembleClassificationFromCompactCategory, d1cTaxonomyVersion } from "../src/feed/selection-classifier-lab.js";
import { resolveSourceRole } from "../src/feed/shadow-selection.js";
import { CANDIDATE_REGISTRY } from "../tools/selection-candidate-registry.mjs";
import {
  buildSelectionShadowPacket,
  expandSelectionShadowPredictions,
  measureSelectionShadow,
  selectSelectionShadowCanary,
  selectSelectionShadowShortlist
} from "../tools/prepare-selection-shadow.mjs";
import { projectShadowArticles } from "../tools/build-selection-shadow-comparison.mjs";

const CANDIDATE = CANDIDATE_REGISTRY["p6-policy-shadow-haiku"];
const SNAPSHOT_SHA = crypto.createHash("sha256").update("d2d-test-pool").digest("hex");
const registry = [
  { id: "source-a", sourceTier: "specialist", country: "KR", lang: "ko", kind: "news" },
  { id: "source-b", sourceTier: "news", country: "US", lang: "en", kind: "news" }
];
const item = (id, source, title, category) => ({
  id, source, title, summary: `${title} 핵심 내용`, category, registryCategory: category,
  kind: "news", lang: source === "source-b" ? "en" : "ko", publishedAt: "2026-08-22T03:00:00.000Z"
});

test("D2-D: 실제 풀은 증거 해시당 한 번만 분류하는 무URL shadow packet으로 동결된다", () => {
  const duplicateTitle = "게임용 PC 견적에 새 그래픽카드를 반영했다";
  const pool = { savedAt: Date.parse("2026-08-22T08:14:49.104Z"), rows: [
    { item: item("a", "source-a", duplicateTitle, "tech") },
    { item: item("b", "source-b", duplicateTitle, "gaming") },
    { item: item("c", "source-a", "반도체 기업이 대규모 투자를 발표했다", "business") }
  ] };

  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });

  assert.equal(packet.counts.sourceArticles, 3);
  assert.equal(packet.counts.classificationTargets, 2);
  assert.equal(packet.counts.reusedEvidenceArticles, 1);
  assert.deepEqual(packet.targets[0].sourceArticleIds, ["a", "b"]);
  assert.equal(packet.targets.some((row) => Object.hasOwn(row, "url")), false);
  assert.equal(packet.candidate.recordSha256, CANDIDATE.candidateRecordSha256);
  assert.equal(packet.candidate.compactPolicySha256,
    crypto.createHash("sha256").update(JSON.stringify(CANDIDATE.compactPolicy)).digest("hex"));
  assert.equal(packet.runtimeWired, false);
});

test("D2-D: 같은 원문은 종합 피드보다 직접 전문 섹션을 대표 출처로 고정한다", () => {
  const title = "4년 만에 모아주택 1호 준공";
  const specialist = {
    ...item("z-specialist", "mk-realestate", title, "realestate"),
    tags: ["realestate"]
  };
  const aggregate = item("a-aggregate", "mk-news", title, "business");
  const sourceRegistry = [
    { id: "mk-news", sourceTier: "specialist", country: "KR", lang: "ko", kind: "news", category: "business" },
    { id: "mk-realestate", sourceTier: "specialist", country: "KR", lang: "ko", kind: "news", category: "realestate", defaultTags: ["realestate"] }
  ];

  for (const rows of [[aggregate, specialist], [specialist, aggregate]]) {
    const packet = buildSelectionShadowPacket({
      savedAt: Date.parse("2026-08-27T10:00:00.000Z"),
      rows: rows.map((row) => ({ item: row }))
    }, {
      candidate: CANDIDATE,
      registry: sourceRegistry,
      sourceSnapshotSha256: SNAPSHOT_SHA
    });

    assert.equal(packet.targets.length, 1);
    assert.equal(packet.targets[0].itemId, "z-specialist");
    assert.equal(packet.targets[0].sourceId, "mk-realestate");
    assert.equal(packet.targets[0].legacyCategory, "realestate");
    assert.deepEqual(packet.targets[0].sourceArticleIds, ["a-aggregate", "z-specialist"]);
  }
});

test("D2-D: 저장 예측은 원 기사로 확장돼 실제 분야별 사건 predicate를 측정한다", () => {
  const pool = { savedAt: Date.parse("2026-08-22T08:14:49.104Z"), rows: [
    { item: item("a", "source-a", "비키니 캐릭터 게임용 PC 견적에 새 그래픽카드를 반영했다", "tech") },
    { item: item("b", "source-a", "반도체 기업이 대규모 투자를 발표했다", "business") }
  ] };
  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });
  const versions = {
    modelVersion: CANDIDATE.requestedModel,
    promptVersion: CANDIDATE.promptVersion,
    taxonomyVersion: d1cTaxonomyVersion()
  };
  const predictions = packet.targets.map((target) => ({
    itemId: target.itemId,
    status: "classified",
    classification: assembleClassificationFromCompactCategory({
      contentType: "news",
      eventType: "domain_event",
      impactCategories: target.sourceArticleIds.includes("a") ? ["tech", "gaming"] : ["business"],
      subjectCategories: [],
      confidence: 0.9
    }, {
      input: target,
      versions,
      operatorGroup: `operator-${target.sourceId}`,
      originDocumentId: target.itemId,
      policy: CANDIDATE.compactPolicy
    })
  }));

  const expanded = expandSelectionShadowPredictions(packet, predictions);
  assert.deepEqual(expanded.map((row) => row.itemId), ["a", "b"]);

  const projected = projectShadowArticles(pool, packet, predictions);
  assert.deepEqual(projected.articles.map((row) => [row.id, row.admittedCategories]), [
    ["a", ["tech", "gaming"]],
    ["b", ["business"]]
  ]);
  assert.equal(projected.articles[0].adultGateRequired, true);
  assert.equal(projected.stats.adultTaggedArticles, 1);
  assert.equal(projected.stats.admittedArticles, 2);
  assert.equal(projected.stats.multiCategoryArticles, 1);

  const measured = measureSelectionShadow(pool, packet, predictions, {
    roleOf: (article) => resolveSourceRole(article, registry.find((row) => row.id === article.source))
  });
  assert.equal(measured.counts.sourceArticles, 2);
  assert.equal(measured.counts.predictedTargets, 2);
  assert.equal(measured.counts.admittedArticles, 2);
  assert.deepEqual(measured.categoryViews, { business: 1, gaming: 1, tech: 1 });
  assert.equal(measured.productProven, false);
  assert.equal(measured.runtimeWired, false);

  assert.throws(() => measureSelectionShadow({ ...pool, savedAt: pool.savedAt + 1 }, packet, predictions, {
    roleOf: resolveSourceRole
  }), /packet\/pool snapshot mismatch/);
  const wrongVersion = structuredClone(predictions);
  wrongVersion[0].classification.promptVersion = "wrong-prompt";
  assert.throws(() => measureSelectionShadow(pool, packet, wrongVersion, {
    roleOf: resolveSourceRole
  }), /packet\/prediction version mismatch/);
});

test("D2-F: 측정은 모델이 본 packet excerpt와 같은 근거만 검증한다", () => {
  const title = "긴 요약을 가진 기술 기사";
  const summary = `${"기술 투자와 제품 출시를 설명하는 문장 ".repeat(20)}측정에서만 보이는 꼬리`;
  const pool = { savedAt: Date.parse("2026-08-24T00:55:00.000Z"), rows: [
    { item: { ...item("long-a", "source-a", title, "tech"), summary } }
  ] };
  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });
  const target = packet.targets[0];
  assert.equal(target.excerpt.length, 300);
  const versions = {
    modelVersion: CANDIDATE.requestedModel,
    promptVersion: CANDIDATE.promptVersion,
    taxonomyVersion: d1cTaxonomyVersion()
  };
  const predictions = [{
    itemId: target.itemId,
    status: "classified",
    classification: assembleClassificationFromCompactCategory({
      contentType: "news",
      eventType: "domain_event",
      impactCategories: ["tech"],
      subjectCategories: [],
      confidence: 0.9
    }, {
      input: target,
      versions,
      operatorGroup: "operator-source-a",
      originDocumentId: target.itemId,
      policy: CANDIDATE.compactPolicy
    })
  }];

  const measured = measureSelectionShadow(pool, packet, predictions, {
    roleOf: (article) => resolveSourceRole(article, registry[0])
  });
  assert.equal(measured.counts.admittedArticles, 1);
  assert.equal(measured.counts.withheldArticles, 0);
  assert.deepEqual(measured.categoryViews, { tech: 1 });
});

test("D2-E: 현재 풀 canary는 공급이 적은 분야부터 한 건씩 12건을 결정적으로 고른다", () => {
  const categories = ["auto", "art", "realestate", "science", "gaming", "fashion", "sports", "culture", "news", "life", "business", "tech", "humor"];
  const rows = categories.flatMap((category, categoryIndex) => Array.from({ length: categoryIndex + 1 }, (_, itemIndex) => ({
    item: {
      ...item(`${category}-${itemIndex}`, itemIndex % 2 ? "source-b" : "source-a", `${category} 기사 ${itemIndex}`, category),
      kind: categoryIndex % 2 ? "community" : "news",
      hotScorePrev: itemIndex,
      commentCount: itemIndex * 2,
      viewCount: itemIndex * 10
    }
  })));
  const pool = { savedAt: Date.parse("2026-08-22T08:14:49.104Z"), rows };
  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });

  const first = selectSelectionShadowCanary(pool, packet, { maxCalls: 12 });
  const second = selectSelectionShadowCanary(pool, packet, { maxCalls: 12 });

  assert.deepEqual(first, second);
  assert.equal(first.targets.length, 12);
  assert.deepEqual(first.omittedLegacyCategories, ["humor"]);
  assert.equal(first.targets.some((target) => target.legacyCategory === "humor"), false);
  assert.equal(first.targets.every((target) => target.itemId.endsWith(`-${categories.indexOf(target.legacyCategory)}`)), true);
  assert.deepEqual(first.contentKinds, ["community", "news"]);
  assert.equal(first.purpose, "operational_smoke_not_quality_proof");
});

test("NH91: 미분류 shortlist는 현재 슬롯의 일반 뉴스와 커뮤니티를 출처별로 고르게 고른다", () => {
  const nowMs = Date.parse("2026-08-27T05:42:34.447Z");
  const sourceRegistry = [
    { id: "etnews", enabled: true, kind: "news", sourceTier: "aggregate", category: "tech", adapter: { type: "rss" } },
    { id: "bloter", enabled: true, kind: "news", sourceTier: "aggregate", category: "tech", adapter: { type: "rss" } },
    { id: "mixed-community", enabled: true, kind: "community", category: "life", adapter: { type: "rss" } },
    { id: "deal-board", enabled: true, kind: "community", category: "tech", feedGroup: "deal", adapter: { type: "list" } },
    { id: "gnews-tech", enabled: true, kind: "news", sourceTier: "aggregate", category: "tech", feedGroup: "gnews", adapter: { type: "rss" } },
    { id: "tech-specialist", enabled: true, kind: "news", sourceTier: "specialist", category: "tech", adapter: { type: "rss" } },
    { id: "business-wire", enabled: true, kind: "news", sourceTier: "aggregate", category: "business", adapter: { type: "rss" } },
    { id: "disabled-news", enabled: false, kind: "news", sourceTier: "aggregate", category: "news", adapter: { type: "rss" } }
  ];
  const article = (id, source, publishedAt, score = 0, kind = "news") => ({
    id, source, title: `${id} 제목`, summary: `${id} 요약`, category: "tech", kind, lang: "ko",
    publishedAt, hotScorePrev: score, score, commentCount: score, viewCount: score
  });
  const rows = [
    article("etnews-high", "etnews", "2026-08-27T04:40:00.000Z", 100),
    article("etnews-second", "etnews", "2026-08-27T04:30:00.000Z", 90),
    article("wrong-lane", "business-wire", "2026-08-27T04:20:00.000Z", 80),
    article("community", "mixed-community", "2026-08-27T04:10:00.000Z", 70, "community"),
    article("deal", "deal-board", "2026-08-27T04:15:00.000Z", 1000, "community"),
    article("bloter", "bloter", "2026-08-27T04:00:00.000Z", 60),
    article("already-admitted", "etnews", "2026-08-27T04:00:00.000Z", 99),
    article("too-old", "etnews", "2026-08-26T20:00:00.000Z", 100),
    article("future", "etnews", "2026-08-27T06:00:00.000Z", 100),
    article("relay", "gnews-tech", "2026-08-27T04:00:00.000Z", 100),
    article("specialist", "tech-specialist", "2026-08-27T04:00:00.000Z", 100),
    article("disabled", "disabled-news", "2026-08-27T04:00:00.000Z", 100),
    { ...article("undated-rss", "etnews", null, 100), publishedAt: null }
  ];
  const build = (orderedRows) => {
    const pool = { savedAt: nowMs, rows: orderedRows.map((row) => ({ item: row })) };
    const packet = buildSelectionShadowPacket(pool, {
      candidate: CANDIDATE,
      registry: sourceRegistry,
      sourceSnapshotSha256: SNAPSHOT_SHA
    });
    const entries = packet.targets.flatMap((target) => target.sourceArticleIds.map((itemId) => ({
      itemId,
      evidenceHash: target.evidenceHash,
      categories: itemId === "already-admitted" ? ["tech"] : [],
      contentType: "news",
      sourceId: target.sourceId,
      routingBasis: itemId === "already-admitted" ? "current_model" : "withheld"
    })));
    const routingSnapshot = {
      contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
      snapshotId: "routing-shortlist-test",
      generatedAt: new Date(nowMs).toISOString(),
      source: { packetSha256: SNAPSHOT_SHA, predictionsSha256: SNAPSHOT_SHA },
      entries
    };
    return selectSelectionShadowShortlist(pool, packet, {
      routingSnapshot,
      registry: sourceRegistry,
      missingCategoryIds: ["tech"],
      nowMs,
      windowHours: 6,
      maxCalls: 5
    });
  };

  const first = build(rows);
  const second = build([...rows].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.purpose, "ambiguous_source_shortlist_not_quality_proof");
  assert.deepEqual(first.targets.map((target) => target.itemId), [
    "etnews-high", "wrong-lane", "community", "bloter", "etnews-second"
  ]);
  assert.deepEqual(first.missingCategoryIds, ["tech"]);
  assert.deepEqual(first.selectedSourceIds, ["bloter", "business-wire", "etnews", "mixed-community"]);
  assert.deepEqual(first.contentKinds, ["community", "news"]);
  assert.equal(first.targets.some((target) => target.itemId === "deal"), false);
});
