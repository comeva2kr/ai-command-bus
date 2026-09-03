import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { assembleClassificationFromCompactCategory, d1cTaxonomyVersion } from "../src/feed/selection-classifier-lab.js";
import { resolveSourceRole } from "../src/feed/shadow-selection.js";
import { findMarketSignalMatches, OVERSEAS_MARKET_SIGNAL_LEXICON } from "../src/feed/selection-axes.js";
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

test("NH94: 엔진 최종 분야는 명확한 소스만 투표하고 충돌은 패킷에서 보류한다", () => {
  const sources = [
    { id: "community", enabled: true, kind: "community", sourceTier: "community", category: "tech", mixed: true },
    { id: "yozm", enabled: true, kind: "community", sourceTier: "community", category: "tech" },
    { id: "special-tech", enabled: true, kind: "news", sourceTier: "specialist", category: "tech" },
    { id: "special-business", enabled: true, kind: "news", sourceTier: "specialist", category: "business" },
    { id: "motorgraph", enabled: true, kind: "news", sourceTier: "specialist", category: "auto",
      categoryRouting: "declared_section" },
    { id: "yna-sports", enabled: true, kind: "news", sourceTier: "specialist", category: "sports",
      categoryRouting: "declared_section" },
    { id: "hankyung", enabled: true, kind: "news", sourceTier: "aggregate", category: "business" },
    { id: "section", enabled: true, kind: "news", sourceTier: "aggregate", category: "business" },
    { id: "general", enabled: true, kind: "news", sourceTier: "aggregate", category: "news", country: "KR" },
    { id: "gnews-world", enabled: true, kind: "news", sourceTier: "aggregate", category: "news",
      country: "KR", feedGroup: "gnews" },
    { id: "foreign-world", enabled: true, kind: "news", sourceTier: "specialist", category: "news",
      country: "GB" },
    { id: "trusted-world", enabled: true, kind: "news", sourceTier: "specialist", category: "news",
      country: "GB", editorialAuthority: "global_major", categoryRouting: "declared_section" },
    { id: "deal", enabled: true, kind: "community", sourceTier: "community", category: "tech", feedGroup: "deal" }
  ];
  const article = (id, source, title, category, kind = "news") => ({
    ...item(id, source, title, category), kind, summary: `${title} 공통 근거`
  });
  const pool = { savedAt: Date.parse("2026-08-28T10:00:00.000Z"), rows: [
    { item: article("community-row", "community", "혼합 게시판 일상 글", "humor", "community") },
    { item: { ...article("yozm-row", "yozm", "그록 4.6 + 그록 봇 = 스페이스X > 구글?", "science", "community"),
      registryCategory: "tech" } },
    { item: article("special-row", "special-tech", "전문 기술 기사", "tech") },
    { item: { ...article("motorgraph-row", "motorgraph",
      "현대자동차, 모바일 레이싱 게임 '레이싱 마스터' 협업 e스포츠 대회 개최", "gaming"),
      registryCategory: "auto",
      categoryCorrection: { from: "auto", to: "gaming", rule: "specialist-title-definite" } } },
    { item: { ...article("yna-sports-row", "yna-sports",
      "임성재, 10월 제네시스 챔피언십 출전…반년 만에 고국 나들이", "auto"),
      registryCategory: "sports",
      categoryCorrection: { from: "sports", to: "auto", rule: "specialist-title-definite" } } },
    { item: { ...article("hankyung-row", "hankyung",
      "현대차증권, IB 조직 개편…구조화금융·기업금융 양대 체제로", "auto"),
      registryCategory: "business" } },
    { item: article("section-row", "section", "경제 섹션 기사", "business") },
    { item: article("general-row", "general", "종합뉴스 기사", "politics") },
    { item: article("general-clear", "general", "AI 반도체 신제품 공개", "news") },
    { item: { ...article("general-cross", "general", "국내 주요 사건 교차보도", "news"), coverage: 5 } },
    { item: article("world-filler", "gnews-world", "런던 지역 행사 일정 공개", "news") },
    { item: article("foreign-market", "foreign-world", "Fed interest rates shake global markets", "news") },
    { item: article("foreign-filler", "foreign-world", "London local festival schedule announced", "news") },
    { item: article("trusted-world-report", "trusted-world", "US Supreme Court issues a major ruling", "news") },
    { item: article("deal-row", "deal", "할인 판매 글", "tech", "community") },
    { item: article("conflict-tech", "special-tech", "같은 사건 충돌", "tech") },
    { item: article("conflict-business", "special-business", "같은 사건 충돌", "business") },
    { item: article("trusted-sibling", "special-tech", "전문 원문과 종합뉴스 중계", "tech") },
    { item: article("general-sibling", "general", "전문 원문과 종합뉴스 중계", "news") }
  ] };

  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry: sources,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });
  const byArticle = (id) => packet.targets.find((target) => target.sourceArticleIds.includes(id));

  assert.deepEqual(byArticle("community-row").deterministicRouting, {
    categories: ["humor"], contentType: "community", routingBasis: "deterministic_tier_policy"
  });
  assert.deepEqual(byArticle("yozm-row").deterministicRouting.categories, ["tech"]);
  assert.deepEqual(byArticle("special-row").deterministicRouting.categories, ["tech"]);
  assert.deepEqual(byArticle("motorgraph-row").deterministicRouting.categories, ["gaming"]);
  assert.deepEqual(byArticle("yna-sports-row").deterministicRouting.categories, ["sports"]);
  assert.deepEqual(byArticle("hankyung-row").deterministicRouting.categories, ["business"]);
  assert.deepEqual(byArticle("section-row").deterministicRouting.categories, ["business"]);
  assert.equal(byArticle("general-row").deterministicRouting, undefined);
  assert.deepEqual(byArticle("general-clear").deterministicRouting.categories, ["tech"]);
  assert.deepEqual(byArticle("general-cross").deterministicRouting.categories, ["news"]);
  assert.equal(byArticle("world-filler").deterministicRouting, undefined);
  assert.deepEqual(byArticle("foreign-market").deterministicRouting.categories, ["news"]);
  assert.equal(byArticle("foreign-filler").deterministicRouting, undefined);
  assert.deepEqual(byArticle("trusted-world-report").deterministicRouting.categories, ["news"],
    "검증된 해외 주요매체의 정식 세계뉴스 섹션은 시장 키워드 없이도 입장한다");
  assert.equal(byArticle("deal-row").deterministicRouting, undefined);
  assert.equal(byArticle("conflict-tech").deterministicRouting, undefined,
    "같은 근거의 유효 투표가 다르면 대표 기사 값으로 덮지 않는다");
  assert.deepEqual(byArticle("trusted-sibling").deterministicRouting.categories, ["tech"],
    "투표권 없는 종합뉴스 중계는 전문 원문의 명확한 투표를 무효화하지 않는다");
});

test("NH106: 발행사 연예 URL은 오래된 aggregate 분류를 발행 전에 바로잡는다", () => {
  const pool = {
    savedAt: Date.parse("2026-09-02T11:00:00.000Z"),
    rows: [{ item: {
      ...item("entertainment-photo", "chosunbiz", "[사진]차희, '메이드 인 코리아 2' 기대하세요", "business"),
      kind: "news",
      url: "https://biz.chosun.com/entertainment/entertainment_photo/2026/09/02/example/"
    } }]
  };
  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry: [{ id: "chosunbiz", kind: "news", sourceTier: "aggregate", category: "business", country: "KR" }],
    sourceSnapshotSha256: SNAPSHOT_SHA
  });
  assert.deepEqual(packet.targets[0].deterministicRouting.categories, ["culture"]);
});

test("NH106: 종합 섹션의 정치·세계 사건은 IT로 동결하지 않고 실제 IT는 보존한다", () => {
  const sources = [
    { id: "etnews", kind: "news", sourceTier: "aggregate", category: "tech", country: "KR" },
    { id: "hani-rank", kind: "news", sourceTier: "aggregate", category: "news", country: "KR" },
    { id: "theqoo", kind: "community", sourceTier: "community", category: "humor", mixed: true },
    { id: "etoland", kind: "community", sourceTier: "community", category: "humor", mixed: true }
  ];
  const pool = { savedAt: Date.parse("2026-09-02T10:00:00.000Z"), rows: [
    { item: item("tanker-etnews", "etnews", "韓 유조선 호르무즈서 피격…이란 긴장 고조", "tech") },
    { item: item("tanker-hani", "hani-rank", "호르무즈서 한국 유조선 피격", "tech") },
    { item: {
      ...item("restaurant-incident", "etnews", "바퀴벌레 100마리 대만 식당에 뿌린 20대 체포", "news"),
      registryCategory: "tech",
      categoryCorrection: {
        from: "tech", to: "news", rule: "aggregate-general-news-guard",
        reason: "incident-without-tech-subject"
      }
    } },
    { item: item("real-tech", "etnews", "정부 AI 반도체 정책 발표", "tech") },
    { item: { ...item("wedding-report", "theqoo", "[단독]지예은♥바타, 부부 된다… 12월 12일 결혼", "humor"),
      kind: "community", summary: "" } },
    { item: { ...item("wedding-advice", "theqoo", "결혼 준비 체크리스트 공유", "humor"),
      kind: "community", summary: "" } },
    { item: { ...item("boilerplate", "etoland", "젓가락질 못하는게 가정교육 운운할 일이야?", "art"),
      kind: "community",
      summary: "이토랜드는 유머, 연예, 정보, 이슈를 공유하는 커뮤니티입니다. 자유게시판, 갤러리, 승부예측 등 다양한 게시판을 확인하세요." } }
  ] };

  const packet = buildSelectionShadowPacket(pool, {
    candidate: CANDIDATE,
    registry: sources,
    sourceSnapshotSha256: SNAPSHOT_SHA
  });
  const categoryOf = (id) => packet.targets.find((target) => target.sourceArticleIds.includes(id))
    ?.deterministicRouting?.categories;

  assert.deepEqual(categoryOf("tanker-etnews"), ["news"]);
  assert.deepEqual(categoryOf("tanker-hani"), ["news"]);
  assert.equal(categoryOf("restaurant-incident"), undefined);
  assert.deepEqual(categoryOf("real-tech"), ["tech"]);
  assert.deepEqual(categoryOf("wedding-report"), ["culture"]);
  assert.deepEqual(categoryOf("wedding-advice"), ["humor"]);
  assert.deepEqual(categoryOf("boilerplate"), ["humor"]);
});

test("NH99: 해외 중요도 신호는 번역 제목에서 사라져도 원제목에서 보존된다", () => {
  const matches = findMarketSignalMatches([{
    id: "translated-fed",
    title: "해외 중앙은행의 새 발표",
    originalTitle: "Fed interest rates decision moves global markets"
  }], OVERSEAS_MARKET_SIGNAL_LEXICON);

  assert.deepEqual(matches.map((row) => row.term), ["Fed", "interest rates"]);
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

test("NH93: 미분류 shortlist는 부족 분야 후보와 전문 원문 소스를 먼저 고른다", () => {
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
  const article = (id, source, publishedAt, score = 0, kind = "news", category = "tech") => ({
    id, source, title: `${id} 제목`, summary: `${id} 요약`, category, kind, lang: "ko",
    publishedAt, hotScorePrev: score, score, commentCount: score, viewCount: score
  });
  const rows = [
    article("etnews-high", "etnews", "2026-08-27T04:40:00.000Z", 100),
    article("etnews-second", "etnews", "2026-08-27T04:30:00.000Z", 90),
    article("wrong-lane", "business-wire", "2026-08-27T04:20:00.000Z", 80, "news", "business"),
    article("community", "mixed-community", "2026-08-27T04:10:00.000Z", 70, "community", "life"),
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
      maxCalls: 4
    });
  };

  const first = build(rows);
  const second = build([...rows].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.purpose, "ambiguous_source_shortlist_not_quality_proof");
  assert.deepEqual(first.targets.map((target) => target.itemId), [
    "etnews-high", "specialist", "bloter", "etnews-second"
  ]);
  assert.deepEqual(first.missingCategoryIds, ["tech"]);
  assert.deepEqual(first.selectedSourceIds, ["bloter", "etnews", "tech-specialist"]);
  assert.deepEqual(first.contentKinds, ["news"]);
  assert.equal(first.targets.some((target) => target.itemId === "deal"), false);
  assert.equal(first.targets.some((target) => target.itemId === "wrong-lane"), false);
});
