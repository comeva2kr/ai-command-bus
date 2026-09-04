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
  activateSlotCanonicalEditions,
  buildSlotCanonicalEdition,
  makeSlotCanonicalEditionReader,
  projectSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";
import {
  applyHeadlineReview,
  assertSemanticLaneCoverage,
  assertSemanticPublicationRouting,
  assertSamePoolInputs,
  categoryEditionsFromUnion,
  editionObservationReceipt,
  foreignMajorLaneCoverage,
  headlineNeedsPolish,
  polishIssueHeadlines,
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

  assert.throws(() => resolveSlotCanonicalBuildTarget({
    pool: { savedAt: Date.parse("2026-08-27T07:31:21.590Z"), rows: [{ item: { id: "stale" } }] },
    editionDate: "2026-08-28",
    slotId: "morning"
  }), /outside morning preparation window/);

  for (const [slotId, savedAt] of [
    ["morning", "2026-08-27T22:30:00.000Z"],
    ["lunch", "2026-08-28T04:40:40.535Z"],
    ["evening", "2026-08-28T10:59:22.216Z"]
  ]) {
    assert.doesNotThrow(() => resolveSlotCanonicalBuildTarget({
      pool: { savedAt: Date.parse(savedAt), rows: [{ item: { id: slotId } }] },
      editionDate: "2026-08-28",
      slotId
    }));
  }
});

test("불량 기계번역 제목만 발행 전에 고치고 사건·카테고리·요약은 그대로 둔다", async () => {
  const { unionEdition } = editions();
  const original = unionEdition.issues[0];
  const broken = {
    ...original,
    subject: "McCarthy은 Steelers의 4 QBs이 자리를 얻었다고 말합니다.",
    eventSources: [{
      ...original.eventSources[0],
      title: "McCarthy은 Steelers의 4 QBs이 자리를 얻었다고 말합니다.",
      originalTitle: "McCarthy says four Steelers QBs have earned their place"
    }]
  };
  const before = JSON.stringify({
    clusterId: broken.clusterId,
    selectedByCategories: broken.selectedByCategories,
    articleSummary: broken.articleSummary
  });
  const polished = await polishIssueHeadlines({ ...unionEdition, issues: [broken] }, {
    translateTitle: async () => "맥카시, 스틸러스 쿼터백 4명이 자리를 얻었다고 평가"
  });

  assert.equal(headlineNeedsPolish(broken), true);
  assert.equal(polished.attempted, 1);
  assert.equal(polished.changed, 1);
  assert.equal(polished.edition.issues[0].preparedHeadline, "맥카시, 스틸러스 쿼터백 4명이 자리를 얻었다고 평가");
  assert.equal(JSON.stringify({
    clusterId: polished.edition.issues[0].clusterId,
    selectedByCategories: polished.edition.issues[0].selectedByCategories,
    articleSummary: polished.edition.issues[0].articleSummary
  }), before);
});

test("읽을 수 있는 혼합 한글 제목과 무료 빌드는 유료 제목 호출을 만들지 않는다", async () => {
  const readable = {
    subject: "84일 만에 Nintendo 64 게임 디컴파일",
    eventSources: [{ title: "84일 만에 Nintendo 64 게임 디컴파일", originalTitle: "Decompiling a Nintendo 64 game in 84 days" }]
  };
  let calls = 0;
  assert.equal(headlineNeedsPolish(readable), false);
  const untouched = await polishIssueHeadlines({ issues: [readable] }, { translateTitle: null });
  assert.equal(calls, 0);
  assert.strictEqual(untouched.edition.issues[0], readable);
});

test("별도 제목 번역기가 없으면 기존 무료 본문 번역기를 약한 제목 마감에 재사용한다", async () => {
  const issue = {
    subject: "McCarthy은 Steelers의 4 QBs이 자리를 얻었다고 말합니다.",
    eventSources: [{
      title: "McCarthy은 Steelers의 4 QBs이 자리를 얻었다고 말합니다.",
      originalTitle: "McCarthy says four Steelers QBs have earned their place"
    }]
  };
  let calls = 0;
  const result = await polishIssueHeadlines({ issues: [issue] }, {
    translateText: async (_text, options) => {
      assert.deepEqual(options, { from: "auto", to: "ko" });
      calls += 1;
      return "맥카시, 스틸러스 쿼터백 4명이 자리를 얻었다고 평가";
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.edition.issues[0].preparedHeadline,
    "맥카시, 스틸러스 쿼터백 4명이 자리를 얻었다고 평가");
});

test("사람이 확인한 제목은 원문과 근거 해시가 정확히 맞을 때만 준비 제목으로 적용한다", () => {
  const evidenceHash = "9".repeat(64);
  const originalTitle = "U.S. and Iran Exchange Strikes Overnight After Monthlong Calm";
  const issue = {
    evidenceHash,
    headline: "잘못 옮긴 제목",
    eventSources: [{ originalTitle }]
  };
  const review = {
    contract: "NOWHOT-HEADLINE-REVIEW-001",
    entries: [{
      evidenceHash,
      originalTitle,
      headlineKo: "미국과 이란, 한 달간의 소강 뒤 밤사이 공습 주고받아"
    }]
  };
  const applied = applyHeadlineReview({ issues: [issue] }, review, "a".repeat(64));

  assert.equal(applied.applied, 1);
  assert.equal(applied.edition.issues[0].preparedHeadline, review.entries[0].headlineKo);
  assert.equal(applied.edition.issues[0].headline, issue.headline);
  assert.deepEqual(applied.edition.issues[0].eventSources, issue.eventSources);
  assert.deepEqual(applied.edition.headlineReviewReceipt, {
    contract: review.contract,
    sha256: "a".repeat(64),
    applied: 1
  });
  assert.throws(() => applyHeadlineReview({ issues: [issue] }, {
    ...review,
    entries: [{ ...review.entries[0], originalTitle: "different" }]
  }, "a".repeat(64)), /originalTitle mismatch/);
  assert.throws(() => applyHeadlineReview({ issues: [issue] }, {
    ...review,
    entries: [{ ...review.entries[0], evidenceHash: "8".repeat(64) }]
  }, "a".repeat(64)), /unknown evidenceHash/);
  assert.throws(() => applyHeadlineReview({ issues: [issue] }, {
    ...review,
    entries: [{ ...review.entries[0], headlineKo: "비키니 화보를 대표 기사로 선정" }]
  }, "a".repeat(64)), /unsafe headline/);
});

test("제목 검수에서 확인한 요약 교정은 같은 근거에만 적용하고 나머지 상세 메타데이터는 보존한다", () => {
  const evidenceHash = "7".repeat(64);
  const originalTitle = "Fed Governor Waller indicates he will support holding rates steady";
  const articleSummary = {
    status: "excerpt_only",
    textKo: "월러 연준 총재는 금리 동결을 지지한다고 말했습니다. 월러 의원은 물가 흐름도 설명했습니다.",
    sourceEvidenceId: "event-source:waller",
    sourceLinks: [{ evidenceId: "event-source:waller", originalTitle }],
    image: "https://images.example/waller.jpg"
  };
  const issue = {
    evidenceHash,
    headline: "기존 제목",
    eventSources: [{ originalTitle }],
    articleSummary
  };
  const corrected = "크리스토퍼 월러 연방준비제도 이사는 금리 동결을 지지한다고 말했습니다. 월러 이사는 물가 흐름도 설명했습니다.";
  const review = {
    contract: "NOWHOT-HEADLINE-REVIEW-001",
    entries: [{
      evidenceHash,
      originalTitle,
      headlineKo: "월러 연준 이사, 금리 동결 지지 시사",
      articleSummaryTextKo: corrected
    }]
  };

  const applied = applyHeadlineReview({ issues: [issue] }, review, "b".repeat(64));
  assert.equal(applied.edition.issues[0].articleSummary.textKo, corrected);
  assert.deepEqual({ ...applied.edition.issues[0].articleSummary, textKo: articleSummary.textKo }, articleSummary);
  assert.throws(() => applyHeadlineReview({ issues: [{ ...issue, eventSources: [{ originalTitle: "다른 원문" }] }] }, review, "b".repeat(64)), /originalTitle mismatch/);
});

test("원문 제목이 없는 기사도 정확한 출처 URL과 근거 해시에 묶인 본문 교정만 허용한다", () => {
  const evidenceHash = "6".repeat(64);
  const sourceUrl = "https://www.elle.co.kr/article/1909047";
  const articleSummary = {
    status: "excerpt_only",
    textKo: "제휴 문구와 추천 기사까지 섞인 본문",
    sourceEvidenceId: "event-source:elle",
    sourceLinks: [{ evidenceId: "event-source:elle", url: sourceUrl }],
    image: "https://images.example/elle.jpg"
  };
  const issue = {
    evidenceHash,
    headline: "홈웨어도 가을맞이",
    eventSources: [{ title: "홈웨어도 가을맞이", originalTitle: null, url: sourceUrl }],
    articleSummary
  };
  const corrected = "아침저녁으로 선선해지면서 긴팔 파자마와 포근한 홈웨어를 찾는 시기입니다.";
  const review = {
    contract: "NOWHOT-HEADLINE-REVIEW-001",
    entries: [{ evidenceHash, sourceUrl, articleSummaryTextKo: corrected }]
  };

  const applied = applyHeadlineReview({ issues: [issue] }, review, "c".repeat(64));
  assert.equal(applied.edition.issues[0].articleSummary.textKo, corrected);
  assert.equal(applied.edition.issues[0].preparedHeadline, undefined);
  assert.deepEqual({ ...applied.edition.issues[0].articleSummary, textKo: articleSummary.textKo }, articleSummary);
  assert.throws(() => applyHeadlineReview({ issues: [issue] }, {
    ...review,
    entries: [{ ...review.entries[0], sourceUrl: "https://www.elle.co.kr/article/other" }]
  }, "c".repeat(64)), /sourceUrl mismatch/);
  assert.throws(() => applyHeadlineReview({ issues: [issue] }, {
    ...review,
    entries: [{ ...review.entries[0], sourceUrl: "javascript:alert(1)" }]
  }, "c".repeat(64)), /invalid entry/);
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

function editions({ editionDate = "2026-08-27", slotId = "lunch", slotLabel = "런치" } = {}) {
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
      editionDate,
      generatedAt: "2026-08-27T03:00:00.000Z",
      slot: { id: slotId, label: slotLabel },
      issues: rows,
      availableCategories: CATEGORIES,
      publishable: true
    };
  }
  const unionEdition = {
    editionDate,
    generatedAt: "2026-08-27T03:00:00.000Z",
    slot: { id: slotId, label: slotLabel },
    issues: [...all.values()],
    availableCategories: CATEGORIES,
    publishable: true,
    serving: { state: "current_machine_verified" }
  };
  return { byCategory, unionEdition };
}

function build(options) {
  const { byCategory, unionEdition } = editions(options);
  return buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });
}

test("사건 원문 표기시각은 카테고리와 무관하게 가장 이른 피드 시각으로 고정한다", () => {
  const { byCategory, unionEdition } = editions();
  const targetId = unionEdition.issues[0].evidenceHash;
  const eventSources = [
    { sourceId: "later", sourceGroup: "later", sourceLabel: "후속", publishedAt: "2026-08-27T02:30:00.000Z" },
    { sourceId: "first", sourceGroup: "first", sourceLabel: "최초", publishedAt: "2026-08-27T01:10:00.000Z" }
  ];
  for (const row of unionEdition.issues) if (row.evidenceHash === targetId) row.eventSources = eventSources;
  for (const edition of Object.values(byCategory)) {
    for (const row of edition.issues) if (row.evidenceHash === targetId) row.eventSources = eventSources;
  }
  unionEdition.issues.find((row) => row.evidenceHash === targetId).publishedAt = "2026-08-26T23:00:00.000Z";

  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });
  assert.equal(artifact.issueTable[targetId].firstPublishedAt, "2026-08-27T01:10:00.000Z");
  assert.equal(artifact.issueTable[targetId].publicationTimeBasis, "source_feed_timestamp");
});

test("관찰 영수증은 레인을 바꾸지 않고 소스·운영주체·국내외 편중만 측정한다", () => {
  const { byCategory, unionEdition } = editions();
  const targetId = unionEdition.issues[0].evidenceHash;
  const extra = {
    sourceId: "news-extra",
    sourceGroup: "news-extra",
    sourceLabel: "추가 매체",
    publishedAt: "2026-08-27T02:00:00.000Z"
  };
  for (const row of unionEdition.issues) if (row.evidenceHash === targetId) row.eventSources.push(extra);
  for (const edition of Object.values(byCategory)) {
    for (const row of edition.issues) if (row.evidenceHash === targetId) row.eventSources.push(extra);
  }
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });
  const registry = artifact.displayOrder.flatMap((id) => artifact.issueTable[id].eventSources || [])
    .map((source) => ({
      id: source.sourceId || source.sourceGroup || source.sourceLabel,
      label: source.sourceLabel,
      country: source.sourceId === "news-extra" ? "US" : "KR",
      operatorGroup: source.sourceGroup || source.sourceId
    }));
  const before = JSON.stringify(artifact.lanes);
  const receipt = editionObservationReceipt(artifact, { registry });

  assert.equal(JSON.stringify(artifact.lanes), before);
  assert.equal(receipt.lanes.news.issueCount, 13);
  assert.equal(receipt.lanes.news.domesticIssueCount, 12);
  assert.equal(receipt.lanes.news.mixedIssueCount, 1);
  assert.equal(receipt.lanes.news.multiSourceIssueCount, 1);
  assert.equal(receipt.lanes.news.sourceGroupCount, 14);
});

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
  assert.strictEqual(tech.issues[0], artifact.issueTable[artifact.lanes.tech[0]],
    "요청 경로는 이미 동결된 기사 객체를 다시 깊은 복제하지 않는다");
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

test("NH108 출처 사진도 기존 안전 경계를 통과하고 정상 상세와 입력 판은 보존한다", () => {
  for (const status of ["ready", "excerpt_only", "source_unavailable"]) {
    const { byCategory, unionEdition } = editions();
    const target = unionEdition.issues[0];
    const textKo = target.articleSummary.textKo.trim();
    target.articleSummary.textKo = textKo;
    target.articleSummary.status = status;
    target.articleSummary.unavailableReasonCode = status === "source_unavailable" ? "ACCESS_DENIED" : null;
    target.articleSummary.image = "https://img.example.com/summary.jpg";
    target.articleSummary.sourceLinks = [
      "https://img.example.com/article.jpg",
      "https://encrypted-tbn0.gstatic.com/news.jpg",
      "https://www.ytn.co.kr/img/comm/ytn_sns_default.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,abc",
      "not-an-image-url"
    ].map((image, index) => ({
      url: `https://publisher.example/article-${index}`, image,
      summary: "공개 피드의 짧은 소개문입니다.",
      originalTitle: "Public article title", publishedAt: "2026-09-03T01:00:00.000Z"
    }));
    const before = structuredClone(unionEdition);
    const artifact = buildSlotCanonicalEdition({
      editionsByCategory: byCategory, unionEdition, builderPacketSha256: packetSha,
      routingSnapshot: { source: { packetSha256: packetSha } }
    });
    const summary = artifact.issueTable[target.evidenceHash].articleSummary;

    assert.deepEqual(summary.sourceLinks.map((row) => row.image), [
      "https://img.example.com/article.jpg", null, null, null, null, null
    ]);
    assert.equal(summary.textKo, textKo);
    assert.equal(summary.status, status);
    assert.equal(summary.unavailableReasonCode, target.articleSummary.unavailableReasonCode);
    assert.equal(summary.image, target.articleSummary.image);
    assert.deepEqual(summary.sourceLinks[0], target.articleSummary.sourceLinks[0]);
    assert.deepEqual(unionEdition, before);
  }
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
  unionEdition.issues.push(
    issue("tech-reserve-13", ["tech"]),
    issue("tech-reserve-14", ["tech"])
  );
  const lanes = categoryEditionsFromUnion(unionEdition);
  assert.deepEqual(Object.keys(lanes), CATEGORIES.map((category) => category.id));
  assert.equal(lanes.tech.issues.length, 14, "예비 후보는 최종 분야 상한까지만 채운다");
  assert.equal(lanes.tech.issues.at(-1).evidenceHash, "evidence-tech-reserve-13");
  assert.equal(lanes.gaming.issues.length, 13);
  assert.deepEqual(
    lanes.tech.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming"),
    lanes.gaming.issues.find((row) => row.evidenceHash === "evidence-shared-tech-gaming")
  );

  const lowInTech = issue("shared-low-in-tech", ["news", "tech"]);
  lowInTech._categoryLaneRanks = { news: 0, tech: 20 };
  const highInTech = issue("tech-high", ["tech"]);
  highInTech._categoryLaneRanks = { tech: 0 };
  const ranked = categoryEditionsFromUnion({
    ...unionEdition,
    issues: [lowInTech, highInTech]
  });
  assert.deepEqual(
    ranked.tech.issues.map((row) => row.evidenceHash),
    ["evidence-tech-high", "evidence-shared-low-in-tech"],
    "다른 분야에서 먼저 뽑힌 공유 사건이 기술 분야 자체 순위를 앞지르면 안 된다"
  );

  const poolRaw = JSON.stringify({ rows: [{ id: "a" }] });
  const poolSha = crypto.createHash("sha256").update(poolRaw).digest("hex");
  const packet = { sourceSnapshot: { sha256: poolSha }, targets: [{ sourceArticleIds: ["a"] }] };
  const packetRaw = JSON.stringify(packet);
  const packetDigest = crypto.createHash("sha256").update(packetRaw).digest("hex");
  assert.doesNotThrow(() => assertSamePoolInputs({
    poolRaw,
    packetRaw,
    packet,
    routingSnapshot: { source: { packetSha256: packetDigest }, entries: [{ itemId: "a" }] }
  }));
  const poolWithUnclassifiedExtra = JSON.stringify({ rows: [{ id: "a" }, { id: "outside-snapshot" }] });
  assert.throws(() => assertSamePoolInputs({
    poolRaw: poolWithUnclassifiedExtra,
    packetRaw,
    packet: {
      ...packet,
      sourceSnapshot: { sha256: crypto.createHash("sha256").update(poolWithUnclassifiedExtra).digest("hex") }
    },
    routingSnapshot: { source: { packetSha256: packetDigest }, entries: [{ itemId: "a" }] }
  }), /pool article coverage mismatch/);
  assert.throws(() => assertSamePoolInputs({
    poolRaw,
    packetRaw,
    packet: { sourceSnapshot: { sha256: "b".repeat(64) } },
    routingSnapshot: { source: { packetSha256: packetDigest }, entries: [{ itemId: "a" }] }
  }), /pool SHA mismatch/);
  assert.throws(() => assertSamePoolInputs({
    poolRaw,
    packetRaw,
    packet,
    routingSnapshot: { source: { packetSha256: packetDigest }, entries: [] }
  }), /routing entry coverage mismatch/);
});

test("분야 내부 순위 표식은 최종 사용자 판에 남기지 않는다", () => {
  const { byCategory, unionEdition } = editions();
  unionEdition.issues[0]._categoryLaneRanks = { news: 0 };
  const artifact = buildSlotCanonicalEdition({
    editionsByCategory: byCategory,
    unionEdition,
    builderPacketSha256: packetSha,
    routingSnapshot: { source: { packetSha256: packetSha } }
  });

  assert.equal("_categoryLaneRanks" in artifact.issueTable[unionEdition.issues[0].evidenceHash], false);
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

test("발행판은 모델·동일 근거 모델·현재 패킷 deterministic만 승인한다", () => {
  const routingSnapshot = {
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "semantic-publication-test",
    generatedAt: "2026-08-27T03:00:00.000Z",
    source: { packetSha256: "a".repeat(64), predictionsSha256: "b".repeat(64) },
    entries: [
      { itemId: "model", evidenceHash: "c".repeat(64), categories: ["news"], routingBasis: "current_model" },
      { itemId: "cached", evidenceHash: "d".repeat(64), categories: ["business"], routingBasis: "prior_exact_hash" },
      { itemId: "deterministic", evidenceHash: "f".repeat(64), categories: ["tech"], routingBasis: "deterministic_tier_policy" },
      { itemId: "withheld", evidenceHash: "e".repeat(64), categories: [], routingBasis: "withheld" }
    ]
  };
  assert.doesNotThrow(() => assertSemanticPublicationRouting(routingSnapshot));

  for (const routingBasis of [undefined, "specialist_registry_default", "legacy_classifier_fallback"]) {
    const invalid = structuredClone(routingSnapshot);
    const entry = {
      itemId: routingBasis,
      evidenceHash: "f".repeat(64),
      categories: ["tech"]
    };
    if (routingBasis !== undefined) entry.routingBasis = routingBasis;
    else entry.itemId = "missing-basis";
    invalid.entries.push(entry);
    assert.throws(() => assertSemanticPublicationRouting(invalid), /semantic classification required/);
  }

  const emptyLegacy = structuredClone(routingSnapshot);
  emptyLegacy.entries.push({
    itemId: "empty-legacy",
    evidenceHash: "f".repeat(64),
    categories: [],
    routingBasis: "legacy_classifier_fallback"
  });
  assert.throws(() => assertSemanticPublicationRouting(emptyLegacy), /semantic classification required/,
    "빈 분류도 구형 근거라면 URL·출처 규칙으로 되살아나기 전에 거부해야 한다");
});

test("분야별 의미 승인 13건 미달은 기사 요약 전에 확인한다", () => {
  const { unionEdition } = editions();
  assert.doesNotThrow(() => assertSemanticLaneCoverage(unionEdition));

  const index = unionEdition.issues.findIndex((row) => row.selectedByCategories.includes("politics"));
  unionEdition.issues.splice(index, 1);
  assert.throws(() => assertSemanticLaneCoverage(unionEdition), /politics 12\/13/);
});

test("해외 주요 매체 건수는 발행 차단 조건이 아니라 관측 영수증이다", () => {
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
    news: { eligible: 3, staleExcluded: 0, selected: 3 },
    business: { eligible: 2, staleExcluded: 0, selected: 2 },
    tech: { eligible: 1, staleExcluded: 0, selected: 1 }
  });
  assert.deepEqual({ ...coverage, news: { ...coverage.news, selected: 0 } }.news,
    { eligible: 3, staleExcluded: 0, selected: 0 },
  "선택 0건이어도 출력 좌석을 만들거나 판을 실패시키지 않는 관측값이다");

  const stalePool = pool.map((row) => row.id === "t1" ? {
    ...row,
    firstSeenAt: nowMs,
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
    { eligible: 0, staleExcluded: 1, selected: 0 });
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

  for (const [date, slotId] of [["2026-08-27", "evening"], ["2026-08-28", "morning"]]) {
    const fallback = reader.read({ date, slotId, categories: ["news"] });
    assert.equal(fallback.serving.fallback, true);
    assert.equal(fallback.serving.requestedDate, date);
    assert.equal(fallback.serving.requestedSlotId, slotId);
    assert.equal(fallback.serving.servedDate, "2026-08-27");
    assert.equal(fallback.serving.servedSlotId, "lunch");
    assert.deepEqual(fallback.issues, projected.issues);
    assert.equal(fallback.llmCalls, 0);
  }
  assert.deepEqual(fs.readFileSync(pointerFile), before);

  const emptyPointer = path.join(root, "empty.json");
  fs.writeFileSync(emptyPointer, JSON.stringify({ editions: {} }));
  assert.throws(() => makeSlotCanonicalEditionReader({ pointerFile: emptyPointer }).read({
    date: "2026-08-27", slotId: "evening", categories: ["news"]
  }), /이브닝판은 아직 준비되지 않았습니다/);
});

test("누락판 복구는 24시간 안의 가장 최근 정상판만 쓰고 미래·위조 포인터를 제외한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-fallback-"));
  const pointerFile = path.join(root, "active.json");
  for (const [slotId, slotLabel] of [["morning", "모닝"], ["lunch", "런치"]]) {
    activateSlotCanonicalEdition({ artifact: build({ slotId, slotLabel }), directory: root, pointerFile });
  }
  const pointer = JSON.parse(fs.readFileSync(pointerFile));
  const lunch = pointer.editions["2026-08-27:lunch"];
  pointer.editions["2026-08-28:lunch"] = lunch;
  pointer.editions["2026-08-27:evening"] = { ...lunch, file: "../outside.json" };
  fs.writeFileSync(pointerFile, JSON.stringify(pointer));
  const reader = makeSlotCanonicalEditionReader({ pointerFile });
  const query = { date: "2026-08-28", slotId: "morning", categories: ["news", "tech"] };
  assert.equal(reader.read(query).serving.servedSlotId, "lunch");
  pointer.editions["2026-08-27:evening"] = lunch;
  fs.writeFileSync(pointerFile, JSON.stringify(pointer));
  assert.equal(reader.read(query).serving.servedSlotId, "lunch");
  pointer.editions["2026-08-27:lunch"] = { ...lunch, contentSha256: "0".repeat(64) };
  fs.writeFileSync(pointerFile, JSON.stringify(pointer));
  assert.equal(reader.read(query).serving.servedSlotId, "morning");
  assert.throws(() => reader.read({ ...query, date: "2026-08-27", slotId: "lunch" }),
    (error) => error.code === "SLOT_CANONICAL_EDITION_INVALID");
  assert.throws(() => reader.read({ ...query, date: "2026-08-29" }),
    (error) => error.code === "SLOT_CANONICAL_EDITION_UNAVAILABLE");
});

test("같은 날짜의 모닝·런치·이브닝은 한 포인터에 독립적으로 누적된다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-three-slots-"));
  const pointerFile = path.join(root, "active.json");
  for (const [slotId, slotLabel] of [["morning", "모닝"], ["lunch", "런치"], ["evening", "이브닝"]]) {
    activateSlotCanonicalEdition({
      artifact: build({ slotId, slotLabel }),
      directory: root,
      pointerFile
    });
  }

  const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  assert.deepEqual(Object.keys(pointer.editions).sort(), [
    "2026-08-27:evening",
    "2026-08-27:lunch",
    "2026-08-27:morning"
  ]);
  const reader = makeSlotCanonicalEditionReader({ pointerFile });
  for (const slotId of ["morning", "lunch", "evening"]) {
    assert.equal(reader.read({ date: "2026-08-27", slotId, categories: ["news"] }).issues.length, 13);
  }
});

test("세 슬롯 활성화는 전부 검증된 뒤 포인터를 한 번만 교체한다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-batch-"));
  const pointerFile = path.join(root, "active.json");
  activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
  const before = fs.readFileSync(pointerFile);
  const invalid = build({ slotId: "lunch", slotLabel: "런치" });
  invalid.lanes.politics.pop();

  assert.throws(() => activateSlotCanonicalEditions({
    artifacts: [build({ slotId: "morning", slotLabel: "모닝" }), invalid],
    directory: root,
    pointerFile
  }), /politics.*13/);
  assert.deepEqual(fs.readFileSync(pointerFile), before);

  const activated = activateSlotCanonicalEditions({
    artifacts: [
      build({ slotId: "morning", slotLabel: "모닝" }),
      build({ slotId: "lunch", slotLabel: "런치" }),
      build({ slotId: "evening", slotLabel: "이브닝" })
    ],
    directory: root,
    pointerFile
  });
  assert.deepEqual(Object.keys(activated.pointer.editions).sort(), [
    "2026-08-27:evening",
    "2026-08-27:lunch",
    "2026-08-27:morning"
  ]);
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
  let nowMs = Date.parse("2026-08-27T12:10:00+09:00");
  const server = createServer({
    localEditorial: true,
    localEditorialInventorySchedule: false,
    slotCanonicalEditionEnabled: true,
    slotCanonicalPointerFile: pointerFile,
    clock: () => nowMs,
    file: null,
    sources: [{ id: "must-not-run", kind: "news", fetch: async () => { sourceCalls += 1; return []; } }],
    articleSummaryPipeline: async (edition) => { summaryCalls += 1; return edition; },
    vapid: null
  });

  const response = await dispatch(server, "/api/today?categories=tech,gaming");
  assert.equal(response.status, 200);
  assert.equal(response.body.issues.length, 25);
  assert.equal(response.body.slotCanonicalEdition.requestWork, "filter_only");
  nowMs = Date.parse("2026-08-28T07:01:00+09:00");
  const missing = await dispatch(server, "/api/today?categories=tech,gaming");
  assert.equal(missing.status, 200);
  assert.equal(missing.body.serving.fallback, true);
  assert.equal(missing.body.serving.requestedSlotId, "morning");
  assert.equal(missing.body.serving.servedSlotId, "lunch");
  assert.deepEqual(missing.body.issues, response.body.issues);
  assert.equal((await dispatch(server, "/api/today?date=2026-08-28&slot=evening&categories=tech")).status, 409);
  assert.equal(sourceCalls, 0);
  assert.equal(summaryCalls, 0);
});

test("로컬 정본 모드는 빌드 중 요청을 처리하고 중복 빌드·유료 모드를 열지 않는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-scheduler-"));
  const pointerFile = path.join(root, "active.json");
  const poolFile = path.join(root, "pool.json");
  activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
  fs.writeFileSync(poolFile, '{"savedAt":1,"rows":[]}\n');
  const calls = [];
  const pending = new Promise(() => {});
  const server = createServer({
    localEditorial: true,
    slotCanonicalEditionEnabled: true,
    slotCanonicalPointerFile: pointerFile,
    localCanonicalPoolFile: poolFile,
    localCanonicalPrepublishDelayMs: 1,
    localCanonicalPrepublishCheckMs: 5,
    localCanonicalPublisher: async (options) => { calls.push(options); await pending; },
    file: null,
    sources: [],
    vapid: null
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await dispatch(server, "/api/health")).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].poolFile, poolFile);
  assert.equal(calls[0].outDir, root);
  assert.equal(calls[0].allowPaid, false);
});

test("고정판 사전발행 OFF는 판 조회를 유지하고 예약 빌드만 막는다", async () => {
  const previous = process.env.NOWHOT_SLOT_CANONICAL_PREPUBLISH;
  process.env.NOWHOT_SLOT_CANONICAL_PREPUBLISH = "0";
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-manual-"));
    const pointerFile = path.join(root, "active.json");
    const poolFile = path.join(root, "pool.json");
    activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
    fs.writeFileSync(poolFile, '{"savedAt":1,"rows":[]}\n');
    let calls = 0;
    const server = createServer({
      localEditorial: true,
      slotCanonicalEditionEnabled: true,
      slotCanonicalPointerFile: pointerFile,
      localCanonicalPoolFile: poolFile,
      clock: () => Date.parse("2026-08-27T12:10:00+09:00"),
      localCanonicalPrepublishDelayMs: 1,
      localCanonicalPrepublishCheckMs: 5,
      localCanonicalPublisher: async () => { calls += 1; },
      file: null,
      sources: [],
      vapid: null
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const response = await dispatch(server, "/api/today?categories=news");
    assert.equal(response.status, 200);
    assert.equal(response.body.slotCanonicalEdition.requestWork, "filter_only");
    assert.equal(calls, 0);
  } finally {
    if (previous == null) delete process.env.NOWHOT_SLOT_CANONICAL_PREPUBLISH;
    else process.env.NOWHOT_SLOT_CANONICAL_PREPUBLISH = previous;
  }
});

test("날짜만 지정한 고정판 GET도 그 날짜의 현재 슬롯 판을 읽는다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-sce-date-only-"));
  const pointerFile = path.join(root, "active.json");
  activateSlotCanonicalEdition({ artifact: build(), directory: root, pointerFile });
  const server = createServer({
    localEditorial: true,
    slotCanonicalEditionEnabled: true,
    slotCanonicalPointerFile: pointerFile,
    clock: () => Date.parse("2026-08-28T12:10:00+09:00"),
    file: null,
    sources: [],
    vapid: null
  });

  const response = await dispatch(server, "/api/today?date=2026-08-27&categories=news");
  assert.equal(response.status, 200);
  assert.equal(response.body.editionDate, "2026-08-27");
  assert.equal(response.body.slot.id, "lunch");
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
