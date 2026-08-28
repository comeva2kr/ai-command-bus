import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_REGISTRY,
  CANDIDATE_EXECUTION_HOLDS,
  CANDIDATE_REGISTRY_DOCUMENT,
  parseCandidateRegistry,
  getRunnableCandidate,
  getRunnableFullCandidate
} from "../tools/selection-candidate-registry.mjs";
import {
  CATEGORY_ADMISSION_POLICY,
  renderCategoryAdmissionPrompt
} from "../src/feed/category-admission-policy.js";
import {
  assembleClassificationFromCompactCategory,
  normalizeClassifierInput
} from "../src/feed/selection-classifier-lab.js";
import { admittedCategories, assembleUnion } from "../src/feed/selection-contract.js";
import { shadowSelectBriefing } from "../src/feed/shadow-selection.js";
import { buildV2Edition } from "../tools/build-v2-edition.mjs";

const P6_ID = "p6-policy-shadow-haiku";
const P5_SHA = "126a693a64f94edd55c7e4ba0bbc3e17447268e0f58cb1ae98884314abb4ad65";
const P6_SHA = "b09cdaa9cc29e3c3df5bc1241e491075668c3b56f192944b175b789602784e9e";
const P7_ID = "p7-policy-shadow-haiku-full-20260824";
const P7_SHA = "ed35c7d184e4d8c91ed14df110856a8f561cbba0191ac16c45f293228d9d531a";
const P8_ID = "p8-policy-shadow-haiku-full-20260824";
const P8_SHA = "89396d6e1b399d879e8d5c6eff5b6e161ec85679afb40ec808c33fc16b437763";
const P9_ID = "p9-policy-shadow-haiku-full-20260824-lunch";
const P9_SHA = "f595791b5503f58c5bb46c6e67b87be32e2028a08f62383a0bf3bb7e89fbce4b";
const P10_ID = "p10-policy-shadow-haiku-full-20260826";
const P10_SHA = "a8269189f29aceb73d3efbb64af8603e5a95c2369b12478e4685f4a0fa8ed9b7";
const P11_ID = "p11-policy-shadow-haiku-full-20260826-current";
const P11_SHA = "b691c0613172b712b816b2fef61849bf300d8d58e74a6e2a770692e553869251";
const P12_ID = "p12-policy-shadow-haiku-full-nh90-20260827-evening";
const P12_SHA = "bb1a894838c04ba475eef6822c05c31251df3c4e75c48728a097be85bae6e7d6";
const P13_ID = "p13-policy-shadow-haiku-nh90-provider-diagnostic";
const P13_SHA = "8e77aa42fdabad434224faed9f503e81b1b5a2219038376ad0f577af07ac0b1e";

test("D2-A 후보: D1-K 일반 정책만 투영하고 소비된 단일 승인은 재사용하지 않는다", () => {
  const p6 = CANDIDATE_REGISTRY[P6_ID];
  assert.ok(p6);
  assert.equal(CANDIDATE_REGISTRY["p5-compact-category-haiku"].candidateRecordSha256, P5_SHA);
  assert.equal(p6.candidateRecordSha256, P6_SHA);
  assert.equal(p6.execution.runnable, true);
  assert.equal(p6.execution.state, "approved_canary");
  assert.deepEqual(CANDIDATE_EXECUTION_HOLDS[P6_ID], {
    state: "consumed_hold",
    attemptId: "d2e-20260822-01",
    receiptSha256: "768d97297479f6c71ef0c0e90f74758ab587ab2174e127bbc4f10f75b2edac1b",
    reason: "single_canary_approval_consumed"
  });
  assert.throws(() => getRunnableCandidate(P6_ID), /CANDIDATE_APPROVAL_CONSUMED/);

  const projection = renderCategoryAdmissionPrompt(CATEGORY_ADMISSION_POLICY);
  assert.equal(p6.system.endsWith(`\n\n${projection}`), true);
  assert.equal(p6.system.includes("gaming-pc-tech-gaming"), false);
  assert.equal(p6.system.includes("david_explicit_2026-08-21"), false);
});

test("NH90 전량 후보는 최신 풀의 정확한 호출 수와 비용 상한을 고정한다", () => {
  const p12 = getRunnableFullCandidate(P12_ID);
  assert.equal(p12.candidateRecordSha256, P12_SHA);
  assert.equal(p12.promptSha256, CANDIDATE_REGISTRY[P11_ID].promptSha256);
  assert.equal(p12.execution.maxCalls, 2208);
  assert.equal(p12.execution.maxCostUsd, 9);
  assert.equal(p12.execution.fullAllowed, true);
});

test("NH90 공급자 진단 후보는 같은 요청을 단 한 번만 보낸다", () => {
  const p13 = getRunnableFullCandidate(P13_ID);
  assert.equal(p13.candidateRecordSha256, P13_SHA);
  assert.equal(p13.promptSha256, CANDIDATE_REGISTRY[P12_ID].promptSha256);
  assert.equal(p13.execution.maxCalls, 1);
  assert.equal(p13.execution.maxCostUsd, 0.01);
});

test("D2-F 전량 후보: 오늘 packet 1,967건 측정 후 추가 유료 실행을 차단한다", () => {
  const p7 = CANDIDATE_REGISTRY[P7_ID];
  assert.equal(p7.candidateRecordSha256, P7_SHA);
  assert.equal(p7.execution.maxCalls, 1967);
  assert.equal(p7.execution.maxCostUsd, 10);
  assert.equal(p7.execution.fullAllowed, true);
  assert.deepEqual(CANDIDATE_EXECUTION_HOLDS[P7_ID], {
    state: "consumed_hold",
    attemptId: "d2f-20260824-03",
    receiptSha256: "bb2ea434ca8a8f9e34f9769d1b6c7fcb3d3bab0566db75152e083099ba21f173",
    reason: "full_shadow_approval_consumed"
  });
  assert.throws(() => getRunnableFullCandidate(P7_ID), /CANDIDATE_APPROVAL_CONSUMED/);
  assert.throws(() => getRunnableCandidate(P7_ID), /CANDIDATE_APPROVAL_CONSUMED/);
});

test("D2-F 교정 후보: 일상 행정은 자동 정치가 아니며 법·선거 정치는 유지한다", () => {
  const p8 = CANDIDATE_REGISTRY[P8_ID];
  assert.equal(p8.candidateRecordSha256, P8_SHA);
  assert.deepEqual(CANDIDATE_EXECUTION_HOLDS[P8_ID], {
    state: "consumed_hold",
    attemptId: "d2f-20260824-04",
    receiptSha256: "59c53db19c230e3456653a3a291af298c1f4ca9c7c188bf2873de12c82e1ac47",
    reason: "full_shadow_approval_consumed"
  });
  assert.throws(() => getRunnableFullCandidate(P8_ID), /CANDIDATE_APPROVAL_CONSUMED/);

  const p9 = CANDIDATE_REGISTRY[P9_ID];
  assert.equal(p9.candidateRecordSha256, P9_SHA);
  assert.equal(p9.execution.maxCalls, 1981);
  assert.throws(() => getRunnableFullCandidate(P9_ID), /CANDIDATE_APPROVAL_CONSUMED/);

  const p10 = CANDIDATE_REGISTRY[P10_ID];
  assert.equal(p10.candidateRecordSha256, P10_SHA);
  assert.equal(p10.execution.maxCalls, 2063);
  assert.equal(p10.execution.maxCostUsd, 8);
  assert.throws(() => getRunnableFullCandidate(P10_ID), /CANDIDATE_APPROVAL_CONSUMED/);

  const p11 = getRunnableFullCandidate(P11_ID);
  assert.equal(p11.candidateRecordSha256, P11_SHA);
  assert.equal(p11.execution.maxCalls, 2597);
  assert.equal(p11.execution.maxCostUsd, 10);
  assert.equal(p11.promptSha256, p8.promptSha256);
  assert.equal(p10.promptSha256, p8.promptSha256);
  assert.equal(p9.promptSha256, p8.promptSha256);
  assert.deepEqual(p9.compactPolicy.eventTypes.government_action.requiredCoreCategories, []);
  assert.deepEqual(p9.compactPolicy.eventTypes.law_policy.requiredCoreCategories, ["politics"]);
  assert.deepEqual(p9.compactPolicy.eventTypes.election_politics.requiredCoreCategories, ["politics"]);
  assert.match(p9.system, /routine administration/);
});

test("D2-F 뉴스 랭킹: 직접 발행 대형 언론의 비민감 단독 속보는 B등급으로 통과한다", () => {
  const now = Date.parse("2026-08-24T07:00:00+09:00");
  const out = shadowSelectBriefing([{
    id: "major-news-1", title: "도심 교량 오늘부터 전면 통행 재개", url: "https://publisher.test/1",
    source: "major-publisher", kind: "news", category: "news", admittedCategories: ["news"],
    publishedAt: "2026-08-23T21:30:00.000Z"
  }], {
    requestedCategories: ["news"], now, slotId: "morning", previousLineage: [],
    registry: [{
      id: "major-publisher", kind: "news", category: "news", sourceTier: "aggregate",
      size: "large", operatorGroup: "major-publisher", country: "KR"
    }]
  });
  assert.equal(out.perCategory.news.selected.length, 1);
  assert.equal(out.perCategory.news.selected[0].gate.passedBy, "publisher_single_source");
  assert.equal(out.perCategory.news.selected[0].gate.trustLabel, "단일 출처");
});

test("D2-F 판 조립: 각 분야에는 그 분야로 승인된 대표 제목을 쓴다", () => {
  const politics = {
    id: "politics-1", title: "의회, 건강보험 지원법 표결", url: "https://publisher.test/politics",
    source: "major-publisher", admittedCategories: ["politics"], publishedAt: "2026-08-23T21:00:00.000Z"
  };
  const life = {
    id: "life-1", title: "실직 후 건강보험료 줄이는 법", url: "https://publisher.test/life",
    source: "major-publisher", admittedCategories: ["life"], publishedAt: "2026-08-23T20:00:00.000Z"
  };
  const edition = buildV2Edition({
    requestedCategories: ["politics"],
    perCategory: { politics: { partialEdition: false, selected: [{
      representative: { articleId: life.id },
      view: { memberArticles: [life, politics], reactionArticles: [], categoryIds: ["life", "politics"] },
      gate: { trustGrade: "B", trustLabel: "단일 출처" }
    }] } }
  }, {
    date: "2026-08-24", slotId: "morning", generatedAt: "2026-08-23T22:00:00.000Z",
    registryById: new Map([["major-publisher", { label: "대형 언론" }]])
  });
  assert.equal(edition.categories.politics.items[0].title, politics.title);
  assert.equal(edition.categories.politics.items[0].adultGateRequired, false);
});

test("D2-A 후보: 미등록 정책 projection과 projection 제거는 fail-closed", () => {
  const unknown = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  unknown.prompts["p6-policy-shadow"].policyProjection = "unknown-policy";
  assert.throws(() => parseCandidateRegistry(unknown), /unknown policy projection/);

  const removed = structuredClone(CANDIDATE_REGISTRY_DOCUMENT);
  delete removed.prompts["p6-policy-shadow"].policyProjection;
  assert.throws(() => parseCandidateRegistry(removed), /prompt SHA mismatch/);
});

test("D2-A 종단 계약: tech+gaming 복수 승인·선택 조합별 한 번 표시", () => {
  const p6 = CANDIDATE_REGISTRY[P6_ID];
  const article = {
    id: "game-pc-1",
    title: "게임용 PC 견적과 그래픽 설정 안내",
    excerpt: "게임 성능에 맞춘 부품 구성과 조립 방법을 정리했다.",
    category: "tech",
    source: "fixture",
    sourceCountry: "KR",
    language: "ko"
  };
  const classification = assembleClassificationFromCompactCategory({
    contentType: "news",
    eventType: "domain_event",
    impactCategories: ["tech", "gaming"],
    subjectCategories: [],
    confidence: 0.9
  }, {
    input: normalizeClassifierInput(article),
    versions: {
      modelVersion: p6.requestedModel,
      promptVersion: p6.promptVersion,
      taxonomyVersion: "d2a-taxonomy-test"
    },
    operatorGroup: "fixture-owner",
    originDocumentId: article.id,
    policy: p6.compactPolicy
  });

  assert.deepEqual(admittedCategories(classification), ["tech", "gaming"]);
  assert.equal(article.category, "tech", "기존 category는 덮어쓰지 않는다");

  const event = {
    id: "game-pc-event",
    classification,
    byCategory: {
      tech: { tier: 1, S: 0.9 },
      gaming: { tier: 1, S: 0.8 }
    }
  };
  assert.equal(assembleUnion([event], ["tech"]).display.length, 1);
  assert.equal(assembleUnion([event], ["gaming"]).display.length, 1);
  const both = assembleUnion([event], ["tech", "gaming"]).display;
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].selectedByCategories, ["tech", "gaming"]);
  assert.equal(assembleUnion([event], ["sports"]).display.length, 0);
});

test("D2-F 비교판: 새 복수 승인 분야를 기존 사건 랭킹이 그대로 사용한다", () => {
  const article = {
    id: "projection-1",
    title: "게임용 PC 견적과 그래픽 설정 안내",
    summary: "게임 성능에 맞춘 부품 구성과 조립 방법을 정리했다.",
    url: "https://example.com/projection-1",
    source: "fixture-news",
    sourceLabel: "fixture-news",
    kind: "news",
    category: "tech",
    admittedCategories: ["tech", "gaming"],
    editorialCandidate: { sourceRole: "primary" },
    publishedAt: "2026-08-24T00:00:00.000Z",
    score: 100,
    hotScorePrev: 100
  };
  const registry = [{
    id: "fixture-news", kind: "news", category: "tech", sourceTier: "specialist", country: "KR"
  }];
  const out = shadowSelectBriefing([article], {
    requestedCategories: ["gaming"],
    now: Date.parse("2026-08-24T01:00:00.000Z"),
    registry,
    qualityGate: false
  });

  assert.equal(out.perCategory.gaming.counts.candidates, 1);
  assert.equal(out.perCategory.gaming.selected.length, 1);
  assert.deepEqual(out.perCategory.gaming.selected[0].view.categoryIds, ["gaming", "tech"]);
});
