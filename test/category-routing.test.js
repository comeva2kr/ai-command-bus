import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CATEGORY_ROUTING_MAX_AGE_MS,
  createCategoryRouter,
  createReloadingCategoryRouter,
  validateCategoryRoutingSnapshot
} from "../src/feed/category-routing.js";
import {
  buildRecoveredCategoryRoutingSnapshot,
  parseProgress
} from "../tools/build-category-routing-snapshot.mjs";
import { JsonSource } from "../src/feed/content.js";
import { FeedEngine, mergeCategoryEditions } from "../src/feed/engine.js";
import { loadRegistry } from "../src/feed/registry.js";
import { ADMISSION_CATEGORY_IDS } from "../src/feed/selection-contract.js";
import { FeedStore } from "../src/feed/store.js";

const sha = "a".repeat(64);
const hash = (letter) => letter.repeat(64);
const classification = (evidenceHash, categories, contentType = "news") => ({
  contentType,
  primaryCategory: categories[0] || "news",
  descriptiveSecondaryCategories: [],
  admissionCategories: ADMISSION_CATEGORY_IDS.map((category) => ({
    category,
    decision: categories.includes(category) ? "accept" : "reject",
    confidence: 1,
    evidenceSpans: categories.includes(category) ? ["grounded title"] : [],
    reasonCodes: categories.includes(category) ? ["test"] : []
  })),
  modelVersion: "test-model",
  promptVersion: "test-prompt",
  taxonomyVersion: "test-taxonomy",
  evidenceHash,
  sourceCountry: "KR",
  language: "ko",
  eventJurisdictions: [],
  relevanceCountries: [],
  scopeClass: "unknown",
  geoConfidence: 0,
  geoEvidenceSpans: [],
  operatorGroup: "test",
  originDocumentId: "test",
  claimOriginGroup: "test"
});
const snapshot = {
  contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
  snapshotId: "routing-test",
  generatedAt: "2026-08-24T05:00:00.000Z",
  source: { packetSha256: sha, predictionsSha256: sha },
  counts: { classifiedArticles: 1, withheldArticles: 1 },
  entries: [
    { itemId: "pc", evidenceHash: sha, categories: ["tech", "gaming"], contentType: "news" },
    { itemId: "off", evidenceHash: sha, categories: [], contentType: "other" }
  ]
};

test("분야별 판 합집합은 정본 출처 집합이 같은 사건을 한 장으로 합친다", () => {
  const eventSourceSetId = "EV-canonical:bbc|khan";
  const edition = (issue) => ({
    generatedAt: "2026-08-28T03:00:00.000Z",
    issues: [issue],
    sections: [],
    itemCount: 1,
    overseasShare: 0
  });
  const issue = (eventId, evidenceHash, category) => ({
    evidenceHash,
    event: { eventId },
    eventSourceSetId,
    categoryIds: [category],
    selectedByCategories: [category],
    metrics: { score: 100 }
  });

  const merged = mergeCategoryEditions([
    { category: "news", edition: edition(issue("EV-singleton", hash("1"), "news")) },
    { category: "science", edition: edition(issue("EV-canonical", hash("2"), "science")) }
  ], ["news", "science"], 20, false);

  assert.equal(merged.issues.length, 1);
  assert.deepEqual(new Set(merged.issues[0].selectedByCategories), new Set(["news", "science"]));
});

test("분야별 판을 합칠 때 이미 확정한 사건 문안을 다시 덮지 않는다", () => {
  const eventSourceSetId = "EV-flood:guardian|bbc";
  const base = {
    evidenceHash: hash("flood"),
    event: { eventId: "EV-flood" },
    eventSourceSetId,
    headline: "네팔 홍수로 관광객 피해가 커졌다",
    paragraph: "네팔 홍수 피해와 구조 상황을 전한 보도다.",
    refs: [{ title: "네팔 홍수 피해와 구조 상황" }],
    categoryIds: ["news"],
    selectedByCategories: ["news"],
    impactLens: "정책·의사결정",
    whyImportant: "정책 결정의 방향을 볼 가치가 있다.",
    metrics: { score: 100 },
    sourceEvidence: [{ evidenceId: "flood-source" }]
  };
  const edition = (issue) => ({
    generatedAt: "2026-08-28T03:00:00.000Z",
    issues: [issue],
    sections: [],
    itemCount: 1,
    overseasShare: 0
  });

  const merged = mergeCategoryEditions([
    { category: "news", edition: edition(base) },
    { category: "science", edition: edition({
      ...base,
      categoryIds: ["science"],
      selectedByCategories: ["science"]
    }) }
  ], ["news", "science"], 20, false);

  assert.equal(merged.issues.length, 1);
  assert.equal(merged.issues[0].impactLens, "정책·의사결정");
  assert.equal(merged.issues[0].whyImportant, "정책 결정의 방향을 볼 가치가 있다.");
});

test("여러 완료 attempt의 progress를 한 복구 입력으로 합친다", () => {
  const merged = parseProgress([
    `${JSON.stringify({ itemId: "a", status: "classified", classification: { evidenceHash: hash("a") } })}\n`,
    `${JSON.stringify({ itemId: "b", status: "cache_hit", classification: { evidenceHash: hash("b") } })}\n`
  ], "2026-08-27T06:00:00.000Z");
  assert.equal(merged.generatedAt, "2026-08-27T06:00:00.000Z");
  assert.deepEqual(merged.results.map((row) => row.itemId), ["a", "b"]);
});

test("중단된 현재 분류판은 현재 결과→동일 해시 과거 v2→전문 뉴스 섹션 순으로만 복구한다", () => {
  const packet = {
    sourceSnapshot: { savedAt: "2026-08-26T12:00:00.000Z" },
    candidate: { candidateId: "current" },
    targets: [
      ["current-rekey", hash("a"), "aggregate", "news", "news"],
      ["current-empty", hash("b"), "special-news", "news", "news"],
      ["prior", hash("c"), "aggregate", "news", "news"],
      ["laundered", hash("8"), "aggregate", "news", "business"],
      ["prior-empty", hash("d"), "special-news", "news", "news"],
      ["retired-specialist", hash("9"), "mixed-tech", "news", "tech"],
      ["special", hash("e"), "special-news", "news", "news"],
      ["politics-special", hash("7"), "politics-section", "news", "news"],
      ["community", hash("f"), "community", "community", "life"],
      ["aggregate", hash("1"), "aggregate", "news", "business"]
    ].map(([itemId, evidenceHash, sourceId, contentKindHint, legacyCategory]) => ({
      itemId,
      evidenceHash,
      sourceId,
      contentKindHint,
      legacyCategory,
      sourceArticleIds: [itemId]
    }))
  };
  const current = {
    generatedAt: "2026-08-27T00:00:00.000Z",
    results: [
      { itemId: "old-current-id", status: "classified", classification: classification(hash("a"), ["politics"]) },
      { itemId: "current-empty", status: "cache_hit", classification: classification(hash("b"), []) }
    ]
  };
  const prior = {
    ...snapshot,
    entries: [
      { itemId: "old-prior", evidenceHash: hash("c"), categories: ["tech"], contentType: "news",
        sourceId: "aggregate", routingBasis: "current_model" },
      { itemId: "old-laundered", evidenceHash: hash("8"), categories: ["business"], contentType: "news",
        sourceId: "aggregate", routingBasis: "prior_exact_hash" },
      { itemId: "old-prior-empty", evidenceHash: hash("d"), categories: [], contentType: "news",
        sourceId: "special-news", routingBasis: "withheld" },
      { itemId: "old-retired-specialist", evidenceHash: hash("9"), categories: ["tech"], contentType: "news",
        sourceId: "mixed-tech", routingBasis: "specialist_registry_default" }
    ]
  };
  const registry = [
    { id: "special-news", enabled: true, kind: "news", sourceTier: "specialist", category: "business" },
    { id: "politics-section", enabled: true, kind: "news", sourceTier: "specialist", category: "politics" },
    { id: "mixed-tech", enabled: true, kind: "news", sourceTier: "aggregate", category: "tech" },
    { id: "community", enabled: true, kind: "community", sourceTier: "community", category: "life" },
    { id: "aggregate", enabled: true, kind: "news", sourceTier: "aggregate", category: "business" }
  ];

  const recovered = buildRecoveredCategoryRoutingSnapshot(packet, current, prior, registry, {
    packetSha256: hash("2"), predictionsSha256: hash("3"),
    priorSnapshotSha256: hash("4"), registrySha256: hash("5"), categoryPolicySha256: hash("6")
  });
  const byId = new Map(recovered.entries.map((entry) => [entry.itemId, entry]));

  assert.deepEqual(byId.get("current-rekey").categories, ["politics"], "같은 근거 해시면 기사 ID가 바뀌어도 현재 판정을 쓴다");
  assert.deepEqual(byId.get("current-empty").categories, [], "현재 모델의 명시적 보류는 폴백하면 안 된다");
  assert.deepEqual(byId.get("prior").categories, ["tech"]);
  assert.deepEqual(byId.get("laundered").categories, [], "출처가 세탁된 과거 판정은 종합 피드에서 부활시키지 않는다");
  assert.deepEqual(byId.get("prior-empty").categories, ["business"], "빈 과거 행은 판정이 아니므로 현재 전문 섹션 정책으로 복구한다");
  assert.deepEqual(byId.get("retired-specialist").categories, [], "전문 등급에서 강등된 혼합 피드는 과거 기본값으로 재승인하지 않는다");
  assert.deepEqual(byId.get("special").categories, ["business"]);
  assert.deepEqual(byId.get("politics-special").categories, ["politics"]);
  assert.deepEqual(byId.get("community").categories, []);
  assert.deepEqual(byId.get("aggregate").categories, []);
  assert.deepEqual(Object.fromEntries([...byId].map(([id, entry]) => [id, entry.routingBasis])), {
    "current-rekey": "current_model",
    "current-empty": "current_model",
    prior: "current_model",
    laundered: "withheld",
    "prior-empty": "specialist_registry_default",
    "retired-specialist": "withheld",
    special: "specialist_registry_default",
    "politics-special": "specialist_registry_default",
    community: "withheld",
    aggregate: "withheld"
  });
  assert.deepEqual(recovered.counts.routingBasis, {
    current_model: 3, prior_exact_hash: 0, specialist_registry_default: 3, withheld: 4
  });
  assert.equal(recovered.counts.modelClassifiedArticles, 3);
  assert.equal(recovered.counts.admittedArticles, 5);

  const projected = createCategoryRouter(recovered, registry, {
    now: () => Date.parse(recovered.generatedAt) + 1_000
  }).project(packet.targets.map((target) => ({
    id: target.itemId,
    title: target.itemId,
    source: target.sourceId,
    category: target.legacyCategory
  })));
  assert.deepEqual(projected.map((row) => [row.routingOriginalId, row.categoryRoutingBasis]), [
    ["current-rekey", "current_model"],
    ["prior", "current_model"],
    ["prior-empty", "specialist_registry_default"],
    ["special", "specialist_registry_default"],
    ["politics-special", "specialist_registry_default"]
  ]);
});

test("routingBasis 없는 과거 판정은 직접 모델 스냅샷일 때만 재사용한다", () => {
  const packet = {
    sourceSnapshot: { savedAt: "2026-08-27T01:00:00.000Z" },
    targets: [{
      itemId: "aggregate-row",
      evidenceHash: hash("a"),
      sourceId: "aggregate",
      contentKindHint: "news",
      legacyCategory: "business",
      sourceArticleIds: ["aggregate-row"]
    }]
  };
  const prior = {
    ...snapshot,
    source: { ...snapshot.source, candidateId: "measured-model" },
    entries: [{
      itemId: "old-row",
      evidenceHash: hash("a"),
      categories: ["tech"],
      contentType: "news",
      sourceId: "aggregate"
    }]
  };
  const registry = [{
    id: "aggregate", enabled: true, kind: "news", sourceTier: "aggregate", category: "business"
  }];
  const source = {
    packetSha256: hash("2"), predictionsSha256: hash("3"),
    priorSnapshotSha256: hash("4"), registrySha256: hash("5"), categoryPolicySha256: hash("6")
  };

  const direct = buildRecoveredCategoryRoutingSnapshot(packet, { results: [] }, prior, registry, source);
  assert.deepEqual(direct.entries[0].categories, ["tech"]);
  assert.equal(direct.entries[0].routingBasis, "current_model");

  const recovered = buildRecoveredCategoryRoutingSnapshot(packet, { results: [] }, {
    ...prior,
    source: { ...prior.source, recoveryPolicy: "legacy-recovery" }
  }, registry, source);
  assert.deepEqual(recovered.entries[0].categories, []);
  assert.equal(recovered.entries[0].routingBasis, "withheld");
});

test("API 장애 복구를 명시한 경우에만 현재 기존 분류를 정직하게 사용한다", () => {
  const packet = {
    sourceSnapshot: { savedAt: "2026-08-27T01:00:00.000Z" },
    targets: [
      { itemId: "community-row", evidenceHash: hash("a"), sourceId: "community",
        contentKindHint: "community", legacyCategory: "humor", sourceArticleIds: ["community-row"] },
      { itemId: "aggregate-row", evidenceHash: hash("b"), sourceId: "aggregate",
        contentKindHint: "news", legacyCategory: "politics", sourceArticleIds: ["aggregate-row"] }
    ]
  };
  const registry = [
    { id: "community", enabled: true, kind: "community", sourceTier: "community", category: "life" },
    { id: "aggregate", enabled: true, kind: "news", sourceTier: "aggregate", category: "news" }
  ];
  const recovered = buildRecoveredCategoryRoutingSnapshot(packet, { results: [] }, {
    ...snapshot, entries: []
  }, registry, {
    packetSha256: hash("2"), predictionsSha256: hash("3"), priorSnapshotSha256: hash("4"),
    registrySha256: hash("5"), categoryPolicySha256: hash("6"), allowLegacyFallback: true
  });

  assert.deepEqual(recovered.entries.map((entry) => [entry.categories, entry.routingBasis]), [
    [["politics"], "legacy_classifier_fallback"],
    [["humor"], "legacy_classifier_fallback"]
  ]);
  assert.equal(recovered.source.recoveryPolicy,
    "current_model_then_exact_prior_then_specialist_then_legacy_classifier");
});

test("v2 카테고리 라우팅은 복수 분야를 보존하고 미분류·미승인·성인 글을 보류한다", () => {
  validateCategoryRoutingSnapshot(snapshot);
  const router = createCategoryRouter(snapshot, [
    { id: "special", sourceTier: "specialist", category: "science" },
    { id: "trusted-world", kind: "news", sourceTier: "specialist", category: "news",
      categoryRouting: "declared_section" },
    { id: "adult", sourceTier: "specialist", category: "life", adult: true }
  ], { now: () => Date.parse(snapshot.generatedAt) + 60_000 });
  const rows = router.project([
    { id: "pc", title: "게임용 PC 견적", source: "mixed", category: "tech" },
    { id: "off", title: "분류 밖", source: "special", category: "science" },
    { id: "fresh", title: "새 연구 결과", source: "special", category: "news" },
    { id: "world", title: "BBC world report", source: "trusted-world", category: "news" },
    { id: "unknown", title: "새 종합 글", source: "aggregate", category: "news" },
    { id: "adult-new", title: "성인 글", source: "adult", category: "life" }
  ]);

  assert.deepEqual(rows.map((row) => [row.routingOriginalId, row.category]), [
    ["pc", "tech"],
    ["world", "news"]
  ]);
  assert.deepEqual(rows[0].admittedCategories, ["tech", "gaming"]);
  assert.equal(rows[1].categoryRoutingBasis, "declared_specialist_section");
  assert.equal(rows.some((row) => row.routingOriginalId === "off"), false,
    "명시적으로 보류된 글은 전문소스 폴백으로 되살리면 안 된다");
});

test("스냅샷 생성 뒤 들어온 새 글은 다음 분류판 전까지 기존 실시간 카테고리를 유지한다", () => {
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const router = createCategoryRouter(snapshot, [], { now: () => generatedAtMs + 60_000 });
  const rows = router.project([
    { id: "fresh-general", title: "새 주요 뉴스", source: "aggregate", category: "news",
      publishedAt: new Date(generatedAtMs + 1_000).toISOString() },
    { id: "old-unknown", title: "분류판 이전 미분류 글", source: "aggregate", category: "news",
      publishedAt: new Date(generatedAtMs - 1_000).toISOString() },
    { id: "off", title: "명시적으로 보류된 글", source: "aggregate", category: "news",
      publishedAt: new Date(generatedAtMs + 1_000).toISOString() }
  ]);

  assert.deepEqual(rows.map((row) => row.routingOriginalId), ["fresh-general"]);
  assert.equal(rows[0].category, "news");
  assert.equal("admittedCategories" in rows[0], false,
    "실시간 폴백 카테고리를 LLM 승인 분야로 위장하면 안 된다");
  assert.equal(rows[0].categoryRoutingBasis, "post_snapshot_declared_category");
});

test("해외 주요 원문 소스는 권위·전문 섹션 메타데이터를 명시한다", () => {
  const byId = new Map(loadRegistry().map((entry) => [entry.id, entry]));
  for (const [id, category] of [
    ["bbc-world", "news"],
    ["guardian-world", "news"],
    ["nyt-world", "news"],
    ["bbc-business", "business"],
    ["cnbc-economy", "business"],
    ["marketwatch-top", "business"]
  ]) {
    const source = byId.get(id);
    assert.ok(source, `${id}가 등록돼야 한다`);
    assert.equal(source.category, category);
    assert.equal(source.editorialAuthority, "global_major");
    assert.equal(source.categoryRouting, "declared_section");
  }
});

test("실제 오늘판 랭킹은 최신 해외 주요 언론을 반응 없는 뉴스라는 이유로 탈락시키지 않는다", async () => {
  const now = Date.parse("2026-08-24T12:00:00+09:00");
  const foreign = {
    id: "foreign-major",
    title: "글로벌 시장, 중앙은행 결정 대기",
    url: "https://www.bbc.co.uk/news/articles/foreign-major",
    category: "business",
    source: "bbc-business",
    score: 0,
    commentCount: 0,
    coverage: 0,
    publishedAt: new Date(now - 18 * 3600 * 1000).toISOString()
  };
  const domestic = Array.from({ length: 6 }, (_, index) => ({
    id: `domestic-${index}`,
    title: `국내 기업 실적과 시장 동향 ${index}`,
    url: `https://local-${index}.example.com/article`,
    category: "business",
    source: `local-${index}`,
    score: 100 - index,
    commentCount: 0,
    coverage: 0,
    publishedAt: new Date(now - 60 * 60 * 1000).toISOString()
  }));
  const rows = [foreign, ...domestic];
  const sources = [
    new JsonSource("bbc-business", async () => [foreign], "news"),
    ...domestic.map((item) => new JsonSource(item.source, async () => [item], "news"))
  ];
  const routeRegistry = [
    { id: "bbc-business", kind: "news", category: "business", sourceTier: "specialist",
      country: "GB", editorialAuthority: "global_major", categoryRouting: "declared_section" },
    ...domestic.map((item) => ({ id: item.source, kind: "news", category: "business", sourceTier: "specialist" }))
  ];
  const integrationSnapshot = {
    ...snapshot,
    generatedAt: new Date(now - 60 * 60 * 1000).toISOString(),
    counts: { classifiedArticles: rows.length, withheldArticles: 0 },
    entries: rows.map((row) => ({ itemId: row.id, evidenceHash: sha,
      categories: ["business"], contentType: "news" }))
  };
  const engine = new FeedEngine(new FeedStore({ clock: () => new Date(now).toISOString() }), sources);
  const router = createCategoryRouter(integrationSnapshot, routeRegistry, { now: () => now });
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;

  const briefing = await engine.briefing({
    categories: ["business"], slotId: "lunch", personalized: true, perCategory: 3
  });
  const business = briefing.sections.find((section) => section.category === "business");

  assert.ok(business, "경제 섹션이 있어야 한다");
  assert.ok(business.items.some((item) => item.id === "foreign-major"),
    "반응 수치가 없어도 최신 해외 주요 언론 보도는 경제 상위 목록에 들어와야 한다");
  assert.ok(briefing.issues.some((issue) => issue.refs.some((ref) => ref.id === "foreign-major")),
    "섹션 후보뿐 아니라 사용자가 읽는 최종 브리핑 카드에도 해외 주요 보도가 남아야 한다");
  assert.equal(briefing.issues[0].refs[0].id, "foreign-major",
    "해외 주요 언론 권위 신호가 후보에서 사라지지 않고 최종 이슈 순위까지 전달돼야 한다");
  assert.equal(briefing.sections.some((section) => section.category !== "business"), false,
    "선택하지 않은 분야는 노출하면 안 된다");
});

test("분류 스냅샷이 낡아도 마지막 v2 판을 유지하되 새 기사 폴백을 LLM 승인으로 위장하지 않는다", () => {
  const item = { id: "fresh", title: "국회 예산안 본회의 표결", source: "mixed", category: "news", topics: ["politics"] };
  const router = createCategoryRouter(snapshot, [], {
    now: () => Date.parse(snapshot.generatedAt) + CATEGORY_ROUTING_MAX_AGE_MS + 1
  });

  assert.deepEqual(router.project([item]), [{
    ...item,
    routingOriginalId: "fresh",
    registryCategory: "news",
    categoryRoutingBasis: "snapshot_stale_declared_category"
  }]);
  assert.equal(router.status.mode, "v2");
  assert.equal(router.status.state, "snapshot_stale_last_good_v2");
});

test("판 기준 시각보다 미래에 생성된 분류 스냅샷은 기존 카테고리로 폴백한다", () => {
  const referenceNow = Date.parse(snapshot.generatedAt) - 60_000;
  const item = {
    id: "future-snapshot-item",
    title: "새 기술 발표",
    source: "aggregate",
    category: "tech",
    publishedAt: new Date(referenceNow - 1_000).toISOString()
  };
  const router = createCategoryRouter(snapshot, [], { now: () => referenceNow });

  assert.deepEqual(router.project([item], referenceNow), [{
    ...item,
    routingOriginalId: item.id,
    registryCategory: "tech",
    categoryRoutingBasis: "snapshot_stale_declared_category"
  }]);
  assert.equal(router.status.state, "snapshot_stale_last_good_v2");
});

test("과거 오늘판은 컴퓨터 현재 시각이 아니라 판의 기준 시각으로 분류 유효성을 판단한다", () => {
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const wallNow = generatedAtMs + CATEGORY_ROUTING_MAX_AGE_MS + 1;
  const editionAsOf = generatedAtMs + 60_000;
  const router = createCategoryRouter(snapshot, [], { now: () => wallNow });
  const item = { id: "pc", title: "게임용 PC 견적", source: "mixed", category: "tech" };

  const row = router.project([item], editionAsOf)[0];

  assert.equal(row.categoryRoutingBasis, "classified_snapshot");
  assert.equal(router.status.state, "snapshot_active");
});

test("v2 라우터는 새 정상 스냅샷을 재시작 없이 적용하고 깨진 파일에서는 마지막 정상본을 유지한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-routing-"));
  const file = path.join(dir, "routing.json");
  const first = { ...snapshot, entries: [{ ...snapshot.entries[0], categories: ["tech"] }] };
  fs.writeFileSync(file, JSON.stringify(first));
  const router = createReloadingCategoryRouter(file, [], {
    now: () => Date.parse(snapshot.generatedAt) + 60_000
  });
  const item = { id: "pc", title: "게임용 PC 견적", source: "mixed", category: "tech" };
  assert.deepEqual(router.project([item])[0].admittedCategories, ["tech"]);

  const second = { ...snapshot, snapshotId: "routing-test-2",
    entries: [{ ...snapshot.entries[0], categories: ["tech", "gaming"] }] };
  fs.writeFileSync(file, JSON.stringify(second));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 2_000));
  assert.deepEqual(router.project([item])[0].admittedCategories, ["tech", "gaming"]);
  assert.equal(router.status.snapshotId, "routing-test-2");

  fs.writeFileSync(file, "{broken");
  fs.utimesSync(file, new Date(), new Date(Date.now() + 4_000));
  assert.deepEqual(router.project([item])[0].admittedCategories, ["tech", "gaming"]);
  assert.equal(router.status.mode, "v2");
  assert.equal(router.status.state, "snapshot_reload_failed_last_good_v2");
  fs.rmSync(file);
  assert.deepEqual(router.project([item])[0].admittedCategories, ["tech", "gaming"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("복수 분야 기사는 각 관심사를 충족하되 오늘판에는 한 번만 표시한다", async () => {
  const now = Date.now();
  const subjects = [
    "게임용 PC 견적과 그래픽카드 성능 비교", "반도체 공정 수율 개선", "클라우드 보안 패치 공개",
    "인공지능 모델 성능 갱신", "스마트폰 운영체제 업데이트", "데이터센터 전력 효율 개선",
    "콘솔 신작 출시 일정", "온라인 게임 신규 시즌", "인디 게임 판매 기록",
    "게임 대회 결승 결과", "전략 게임 밸런스 패치", "모바일 게임 사전 예약"
  ];
  const rows = Array.from({ length: 24 }, (_, index) => ({
    id: index === 0 ? "pc" : `routing-${index}`,
    title: `${subjects[index % subjects.length]} ${Math.floor(index / subjects.length) + 1}차 소식`,
    url: `https://routing-${index % 8}.example.com/${index}`,
    category: index < 12 ? "tech" : "gaming",
    score: 500 - index,
    commentCount: 30 - index,
    coverage: 2,
    publishedAt: new Date(now - index * 1000).toISOString()
  }));
  const registry = Array.from({ length: 8 }, (_, index) => ({
    id: `routing-${index}`,
    sourceTier: "specialist",
    category: index < 4 ? "tech" : "gaming"
  }));
  const engine = new FeedEngine(new FeedStore(), registry.map((entry, sourceIndex) =>
    new JsonSource(entry.id, async () => rows.filter((_, index) => index % 8 === sourceIndex), "news")
  ));
  const integrationSnapshot = {
    ...snapshot,
    counts: { classifiedArticles: rows.length, withheldArticles: 0 },
    entries: rows.map((row) => ({
      itemId: row.id,
      evidenceHash: sha,
      categories: row.id === "pc" ? ["tech", "gaming"] : [row.category],
      contentType: "news"
    }))
  };
  const router = createCategoryRouter(integrationSnapshot, registry, {
    now: () => Date.parse(snapshot.generatedAt) + 60_000
  });
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;

  const edition = await engine.todayEdition({ categories: ["tech", "gaming"], slotId: "evening" });
  const pcIssues = edition.issues.filter((issue) => issue.refs.some((ref) => ref.id === "pc"));
  const fulfillment = Object.fromEntries(edition.categoryFulfillment.rows.map((row) => [row.categoryId, row.issueCount]));

  assert.equal(pcIssues.length, 1);
  assert.deepEqual(new Set(pcIssues[0].categoryIds), new Set(["tech", "gaming"]));
  assert.ok(fulfillment.tech > 0 && fulfillment.gaming > 0);
});

test("같은 사건의 출처 정본은 선택 분야가 달라도 같고 직접 무관한 기사는 섞지 않는다", async () => {
  const now = Date.parse("2026-08-25T12:30:00+09:00");
  const rows = [
    { id: "iran-news", title: "이란, 미국 경제 제재 대응 준비 마쳤다", source: "bbc-world",
      sourceLabel: "BBC 월드", category: "news", score: 900 },
    { id: "iran-business", title: "미국 이란 경제 제재 거래망 강화", source: "business-paper",
      ownershipGroup: "business-publisher", sourceLabel: "경제신문", category: "business", score: 850 },
    { id: "iran-business-section", title: "이란, 미국 경제 제재 대응 계획 마련", source: "business-world",
      ownershipGroup: "business-publisher", sourceLabel: "경제신문", category: "business", score: 840 },
    { id: "tariff", title: "미국 중국 경제 거래망 강화 발표", source: "tariff-paper",
      sourceLabel: "관세일보", category: "business", score: 700 },
    { id: "news-2", title: "태풍 북상에 항공편 운항 일정 조정", source: "news-2", category: "news", score: 500 },
    { id: "news-3", title: "전국 병원 응급실 운영 대책 발표", source: "news-3", category: "news", score: 490 },
    { id: "business-2", title: "반도체 기업 설비 투자 계획 공개", source: "business-2", category: "business", score: 480 },
    { id: "business-3", title: "중앙은행 기준금리 결정 일정 확정", source: "business-3", category: "business", score: 470 }
  ].map((row, index) => ({
    ...row,
    url: `https://${row.source}.example.com/${row.id}`,
    summary: `${row.title} 관련해 해당 매체가 공개 피드에 제공한 설명입니다.`,
    commentCount: 20 - index,
    coverage: 1,
    publishedAt: new Date(now - (row.id === "iran-business-section" ? 30_000 : (index + 1) * 60_000)).toISOString()
  }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );

  const one = await engine.briefing({
    categories: ["news"], slotId: "lunch", personalized: true, maxIssues: 6, perCategory: 3
  });
  const businessOnly = await engine.briefing({
    categories: ["business"], slotId: "lunch", personalized: true, maxIssues: 6, perCategory: 3
  });
  const two = await engine.briefing({
    categories: ["news", "business"], slotId: "lunch", personalized: true, maxIssues: 12, perCategory: 3
  });
  const eventOf = (edition) => edition.issues.find((issue) =>
    issue.refs.some((ref) => ref.id === "iran-news" || ref.id === "iran-business"));
  const oneEvent = eventOf(one);
  const businessEvent = eventOf(businessOnly);
  const twoEvent = eventOf(two);

  assert.ok(oneEvent && businessEvent && twoEvent);
  assert.equal(oneEvent.eventSourceSetId, twoEvent.eventSourceSetId);
  assert.equal(oneEvent.eventSourceSetId, businessEvent.eventSourceSetId);
  assert.equal(oneEvent.subject, businessEvent.subject);
  assert.equal(oneEvent.subject, twoEvent.subject);
  assert.equal(oneEvent.headline, businessEvent.headline);
  assert.equal(oneEvent.headline, twoEvent.headline);
  assert.equal(oneEvent.whyImportant, businessEvent.whyImportant);
  assert.equal(oneEvent.whyImportant, twoEvent.whyImportant);
  assert.deepEqual(oneEvent.eventSources.map((row) => row.sourceId), ["business-paper", "bbc-world"]);
  assert.deepEqual(businessEvent.eventSources.map((row) => row.sourceId), ["business-paper", "bbc-world"]);
  assert.deepEqual(twoEvent.eventSources.map((row) => row.sourceId), ["business-paper", "bbc-world"]);
  assert.match(oneEvent.eventSources[0].summary, /공개 피드에 제공한 설명/);
  assert.deepEqual(businessEvent.eventSources.map((row) => row.summary), oneEvent.eventSources.map((row) => row.summary));
  assert.deepEqual(twoEvent.eventSources.map((row) => row.summary), oneEvent.eventSources.map((row) => row.summary));
  assert.equal(twoEvent.eventSources.filter((row) => row.sourceLabel === "경제신문").length, 1);
  assert.equal(oneEvent.eventSources.some((row) => row.sourceId === "tariff-paper"), false);

  const frozen = structuredClone(oneEvent);
  delete frozen.eventSourceSetId;
  delete frozen.eventSources;
  frozen.articleSummary = { status: "ready", eventSourceSetId: "old-category-set" };
  const [rehydrated] = await engine.canonicalEventSources([frozen], { asOfMs: now, slotId: "lunch" });
  assert.equal(rehydrated.eventSourceSetId, oneEvent.eventSourceSetId);
  assert.deepEqual(rehydrated.eventSources, oneEvent.eventSources);
});

test("출처의 등록 분야가 아니라 최종 승인 분야로 왜 중요한가를 만든다", async () => {
  const now = Date.parse("2026-08-28T12:30:00+09:00");
  const row = {
    id: "politics-audit",
    title: "국회, 감사원 감사 결과와 제도 개선안 공개",
    source: "general-business-feed",
    sourceLabel: "종합경제지",
    category: "business",
    kind: "news",
    score: 500,
    coverage: 2,
    url: "https://publisher.example/politics-audit",
    publishedAt: new Date(now - 60_000).toISOString()
  };
  const routing = {
    ...snapshot,
    counts: { classifiedArticles: 1, withheldArticles: 0 },
    entries: [{ itemId: row.id, evidenceHash: sha, categories: ["politics"], contentType: "news" }]
  };
  const router = createCategoryRouter(routing, [{
    id: row.source, enabled: true, kind: "news", sourceTier: "aggregate", category: "business"
  }], { now: () => Date.parse(snapshot.generatedAt) + 60_000 });
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    [new JsonSource(row.source, async () => [row], "news")]
  );
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;

  const edition = await engine.briefing({
    categories: ["politics"], slotId: "lunch", personalized: true, maxIssues: 3, perCategory: 3
  });
  assert.equal(edition.issues.length, 1);
  assert.equal(edition.issues[0].impactLens, "정책·의사결정");
  assert.doesNotMatch(edition.issues[0].whyImportant, /기업 활동과 경기 흐름/);
});

test("분야 보류 기사는 사건 근거에는 남지만 대표 제목과 사진은 가져가지 않는다", async () => {
  const now = Date.parse("2026-08-25T12:30:00+09:00");
  const rows = [
    {
      id: "withheld-lead",
      title: "카카오AI 초대 이사회 인적 개편 발표",
      source: "general-feed",
      sourceLabel: "종합뉴스",
      image: "https://images.example.com/withheld.jpg",
      publishedAt: new Date(now - 120_000).toISOString()
    },
    {
      id: "admitted-lead",
      title: "카카오AI, 초대 이사회에 임혜숙·김대지·오승필 합류",
      source: "business-paper",
      sourceLabel: "경제신문",
      image: "https://images.example.com/admitted.jpg",
      publishedAt: new Date(now - 60_000).toISOString()
    }
  ].map((row) => ({
    ...row,
    kind: "news",
    category: "business",
    url: `https://${row.source}.example.com/kakao-ai-board`,
    canonicalUrl: `https://${row.source}.example.com/kakao-ai-board`,
    score: 500,
    coverage: 2
  }));
  const registry = rows.map((row) => ({
    id: row.source,
    enabled: true,
    kind: "news",
    sourceTier: "aggregate",
    category: "news"
  }));
  const routing = {
    ...snapshot,
    counts: { classifiedArticles: 2, withheldArticles: 1 },
    entries: [
      { itemId: "withheld-lead", evidenceHash: sha, categories: [], contentType: "news" },
      { itemId: "admitted-lead", evidenceHash: sha, categories: ["business"], contentType: "news" }
    ]
  };
  const router = createCategoryRouter(routing, registry, {
    now: () => Date.parse(snapshot.generatedAt) + 60_000
  });
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;

  const edition = await engine.briefing({
    categories: ["business"], slotId: "lunch", personalized: true, maxIssues: 3, perCategory: 3
  });
  const issue = edition.issues.find((row) => row.refs.some((ref) => ref.id === "admitted-lead"));

  assert.ok(issue);
  assert.equal(issue.subject, rows[1].title);
  assert.equal(issue.refs[0].id, "admitted-lead");
  assert.deepEqual(issue.eventSources.map((row) => row.sourceId), ["business-paper", "general-feed"]);
  assert.equal(issue.eventSources[0].image, rows[1].image);
  assert.equal(issue.eventSources[0].canLead, true);
  assert.equal(issue.eventSources[1].canLead, false);
});

test("사전선별 오늘판도 발행 시각이 수명 상한을 넘은 글은 리드 후보에서 제외한다", async () => {
  const now = Date.parse("2026-08-28T12:00:00+09:00");
  const items = [
    {
      id: "stale", title: "일주일 전 인기글", source: "community", category: "humor",
      kind: "community", url: "https://example.com/stale", publishedAt: new Date(now - 7 * 86400000).toISOString(),
      score: 10000, commentCount: 1000
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `fresh-${index}`, title: `오늘 새 소식 ${index}`, source: `source-${index}`, category: "humor",
      kind: "community", url: `https://example.com/fresh-${index}`,
      publishedAt: new Date(now - (index + 1) * 60000).toISOString(), score: 100 - index
    }))
  ];
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    items.map((item) => new JsonSource(item.source, async () => [item], "community"))
  );
  engine.editorialPreselectedPool = true;
  engine.editorialPreselectedReferenceMs = now;

  const edition = await engine.briefing({
    categories: ["humor"], slotId: "lunch", maxIssues: 3, perCategory: 3, asOfMs: now
  });

  assert.equal(edition.issues.some((issue) => issue.refs.some((ref) => ref.id === "stale")), false);
});

test("저장 판 출처 재수화도 최초 판과 같은 슬롯 시간창만 사용한다", async () => {
  const now = Date.parse("2026-08-25T19:00:00+09:00");
  let current = now - 10 * 60 * 60 * 1000;
  let includeRecent = false;
  const recent = {
    id: "recent", title: "반도체 기업 신규 공장 투자 계획 발표", source: "recent-news",
    sourceLabel: "최근일보", category: "business", url: "https://recent.example.com/1",
    publishedAt: new Date(now - 60 * 60 * 1000).toISOString()
  };
  const old = {
    id: "old", title: "반도체 기업 공장 투자 세부 계획 공개", source: "old-news",
    sourceLabel: "과거일보", category: "business", url: "https://old.example.com/1",
    publishedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString()
  };
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(current).toISOString() }),
    [
      new JsonSource(old.source, async () => [old], "news"),
      new JsonSource(recent.source, async () => includeRecent ? [recent] : [], "news")
    ]
  );
  await engine.refresh();
  current = now;
  includeRecent = true;
  await engine.refresh();
  const issue = { refs: [{ ...recent, canonicalUrl: recent.url }] };
  const [rehydrated] = await engine.canonicalEventSources([issue], { asOfMs: now, slotId: "evening" });

  assert.deepEqual(rehydrated.eventSources.map((row) => row.sourceId), ["recent-news"]);
});

test("같은 사건에 직접 언론사 URL이 있으면 Google 뉴스 중계보다 먼저 요약 기준으로 쓴다", async () => {
  const now = Date.parse("2026-08-25T19:00:00+09:00");
  const rows = [
    { id: "wrapper", source: "gnews-news", sourceLabel: "KBS 뉴스", url: "https://news.google.com/rss/articles/opaque" },
    { id: "publisher", source: "kbs-news", sourceLabel: "KBS 뉴스", url: "https://news.kbs.co.kr/news/view.do?ncd=123" }
  ].map((row, index) => ({
    ...row,
    title: "18호 태풍 사우델 결국 중국으로",
    category: "news",
    publishedAt: new Date(now - (2 - index) * 60_000).toISOString()
  }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );
  const [canonical] = await engine.canonicalEventSources([
    { refs: [{ ...rows[0], canonicalUrl: rows[0].url }] }
  ], { asOfMs: now });

  assert.equal(canonical.eventSources[0].canonicalUrl, rows[1].url);
  assert.equal(canonical.eventSources.some((row) => row.canonicalUrl === rows[0].url), false,
    "같은 매체의 중계 링크는 직접 기사와 별도 출처로 부풀리지 않는다");
});

test("같은 발행사의 한국어판과 외국어판이 함께 있으면 한국어 원문을 대표로 쓴다", async () => {
  const now = Date.parse("2026-08-28T14:00:00+09:00");
  const image = "https://biz.chosun.com/resizer/v2/same.jpg";
  const rows = [
    {
      id: "a-jp", source: "chosunbiz-jp", ownershipGroup: "chosun", sourceLabel: "조선비즈",
      title: "지방산 구조로 경피 전달 효율화 광 응답도 실증",
      originalTitle: "脂肪酸構造で経皮送達効率化光応答も実証",
      url: "https://biz.chosun.com/jp/jp-science/2026/08/28/a", image
    },
    {
      id: "z-ko", source: "chosunbiz", ownershipGroup: "chosun", sourceLabel: "조선비즈",
      title: "주사 대신 피부로 약물 전달, 지방산 구조서 해법 찾았다",
      url: "https://biz.chosun.com/science-chosun/2026/08/28/a", image
    }
  ].map((row) => ({ ...row, category: "science", publishedAt: new Date(now).toISOString() }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );
  const [canonical] = await engine.canonicalEventSources([
    { refs: [{ ...rows[0], canonicalUrl: rows[0].url }] }
  ], { asOfMs: now });

  assert.equal(canonical.subject, rows[1].title);
  assert.deepEqual(canonical.eventSources.map((row) => row.canonicalUrl), [rows[1].url]);
});

test("같은 사건의 수치가 갱신되면 최신 보도를 카드 대표로 쓴다", async () => {
  const now = Date.parse("2026-08-28T20:00:00+09:00");
  const rows = [
    {
      id: "nepal-old", source: "travel", sourceLabel: "여행신문",
      title: "네팔 홍수에 826명 실종 165명 사망",
      url: "https://travel.example.com/nepal-old",
      publishedAt: "2026-08-27T15:15:00Z"
    },
    {
      id: "nepal-new", source: "yna", sourceLabel: "연합뉴스",
      title: "네팔 대홍수 사망자 543명 실종자 1535명",
      url: "https://yna.example.com/nepal-new",
      publishedAt: "2026-08-28T10:31:26Z"
    }
  ].map((row) => ({ ...row, kind: "news", category: "news", admittedCategories: ["news"] }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );
  const [canonical] = await engine.canonicalEventSources([{
    refs: rows.map((row) => ({ ...row, canonicalUrl: row.url }))
  }], { asOfMs: now });

  assert.equal(canonical.subject, rows[1].title);
  assert.deepEqual(new Set(canonical.eventSources.map((row) => row.sourceId)), new Set(["travel", "yna"]));
});

test("편집 단계가 한 이슈로 확정한 여러 보도 묶음은 출처 정본에서도 모두 보존한다", async () => {
  const now = Date.parse("2026-08-28T19:00:00+09:00");
  const rows = [
    ["cause-a", "guardian", "네팔 홍수 원인은 빙하호 붕괴", "https://guardian.example.com/nepal-cause"],
    ["cause-b", "bbc-world", "네팔 홍수 원인 빙하호 붕괴로 확인", "https://bbc.example.com/nepal-cause"],
    ["rescue-a", "nyt-world", "네팔 홍수 생존자 구조 작업 계속", "https://nyt.example.com/nepal-rescue"],
    ["rescue-b", "khan-news", "네팔 홍수 구조 당국 수색 확대", "https://khan.example.com/nepal-rescue"]
  ].map(([id, source, title, url], index) => ({
    id, source, sourceLabel: source, title, url, canonicalUrl: url,
    kind: "news", category: "news", publishedAt: new Date(now - index * 60_000).toISOString()
  }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    rows.map((row) => new JsonSource(row.source, async () => [row], "news"))
  );

  const [canonical] = await engine.canonicalEventSources([{
    refs: [
      { ...rows[1], canonicalUrl: rows[1].url },
      { ...rows[2], canonicalUrl: rows[2].url }
    ]
  }], { asOfMs: now });

  assert.deepEqual(
    new Set(canonical.eventSources.map((row) => row.sourceId)),
    new Set(["guardian", "bbc-world", "nyt-world", "khan-news"])
  );
  assert.equal(canonical.metrics.sourceCount, 4);
  assert.equal(canonical.metrics.independentGroupCount, 4);
  assert.equal(canonical.evidence.mode, "multiple_feed_observed");
  assert.equal(canonical.confidence.code, "multiple_feed_observed");
});

test("사건 멤버가 고정된 이슈는 다른 참조 사건의 출처를 섞지 않는다", async () => {
  const now = Date.parse("2026-08-28T19:00:00+09:00");
  const insider = {
    id: "insider", source: "techmeme", sourceLabel: "Techmeme",
    title: "KPMG 직원의 예측시장 내부자 거래 기소 준비",
    url: "https://www.techmeme.com/260827/p62", canonicalUrl: "https://www.techmeme.com/260827/p62",
    kind: "community", category: "business", admittedCategories: ["business"],
    publishedAt: new Date(now - 60_000).toISOString()
  };
  const valuation = {
    id: "valuation", source: "marketwatch-top", sourceLabel: "마켓워치",
    title: "Anthropic 기업가치 2조 달러 토큰 시장",
    url: "https://marketwatch.example.com/anthropic", canonicalUrl: "https://marketwatch.example.com/anthropic",
    kind: "news", category: "business", admittedCategories: ["business"],
    publishedAt: new Date(now).toISOString()
  };
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(now).toISOString() }),
    [insider, valuation].map((row) => new JsonSource(row.source, async () => [row], row.kind))
  );

  const [canonical] = await engine.canonicalEventSources([{
    event: {
      eventId: "EV-insider",
      memberArticleIds: [insider.id],
      sourceEvidence: [{ articleId: insider.id, canonicalUrl: insider.url }]
    },
    refs: [insider, valuation]
  }], { asOfMs: now });

  assert.deepEqual(canonical.eventSources.map((row) => row.sourceId), ["techmeme"]);
});

test("레거시 복구 판정만 명시적 URL 섹션으로 바로잡고 모델 판정은 건드리지 않는다", () => {
  const routing = {
    ...snapshot,
    generatedAt: "2026-08-28T10:00:00.000Z",
    entries: [
      { itemId: "movie", evidenceHash: hash("b"), categories: ["business"], contentType: "news", routingBasis: "legacy_classifier_fallback" },
      { itemId: "world", evidenceHash: hash("c"), categories: ["business"], contentType: "news", routingBasis: "legacy_classifier_fallback" },
      { itemId: "model", evidenceHash: hash("d"), categories: ["business"], contentType: "news", routingBasis: "current_model" }
    ]
  };
  const rows = createCategoryRouter(routing, [], {
    now: () => Date.parse("2026-08-28T10:01:00.000Z")
  }).project([
    { id: "movie", title: "영화 소식", url: "https://biz.chosun.com/entertainment/movie/2026/08/28/a", category: "business" },
    { id: "world", title: "네팔 소식", url: "https://www.mk.co.kr/news/world/2026/08/28/b", category: "business" },
    { id: "model", title: "모델 판정", url: "https://biz.chosun.com/entertainment/movie/2026/08/28/c", category: "business" }
  ]);

  assert.deepEqual(rows.map((row) => [row.id, row.category, row.categoryRoutingBasis]), [
    ["movie", "culture", "legacy_url_section_recovery"],
    ["world", "news", "legacy_url_section_recovery"],
    ["model", "business", "current_model"]
  ]);
});
