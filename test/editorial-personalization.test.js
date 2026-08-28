import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITORIAL_PERSONALIZATION_CONTRACT,
  EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT,
  evaluateEditorialPersonalizationUtility,
  projectEditorialPersonalization
} from "../src/feed/editorial-personalization.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";

function edition(categories = ["business", "tech"]) {
  const issue = (id, categoryId) => ({
    subject: id,
    headline: `${id} 핵심 변화`,
    paragraph: `${id} 근거 문장`,
    categoryIds: [categoryId],
    sourceEvidence: [{
      evidenceRole: "lead",
      ownershipGroup: `publisher:${id}`,
      sourceId: `source-${id}`
    }],
    evidence: { mode: "single_feed_observed" }
  });
  return {
    editionId: "2026-08-11-lunch-business.tech",
    selection: { categories: categories.map((id) => ({ id })) },
    issues: [
      issue("tech-a", "tech"),
      issue("business-a", "business"),
      issue("tech-b", "tech"),
      issue("business-b", "business"),
      issue("tech-c", "tech"),
      issue("business-c", "business")
    ]
  };
}

function user(categoryWeights, extra = {}) {
  return {
    surveyed: true,
    feedbackCount: 0,
    warmStarted: false,
    preferences: { categories: categoryWeights },
    ...extra
  };
}

test("개인 오늘판 투영: 공유 판본의 내용·개수·선택 분야는 그대로 두고 가까운 중요도 묶음 안에서만 순서를 바꾼다", () => {
  const canonical = edition();
  const projected = projectEditorialPersonalization(canonical, user({ business: 1, tech: 0 }));

  assert.equal(projected.personalization.contractId, EDITORIAL_PERSONALIZATION_CONTRACT.stableId);
  assert.equal(projected.personalization.state, "personalization_integrity_pass");
  assert.equal(projected.personalization.mode, "bounded_category_affinity_reorder");
  assert.equal(projected.personalization.issueCountUnchanged, true);
  assert.equal(projected.personalization.addedIssueCount, 0);
  assert.equal(projected.personalization.removedIssueCount, 0);
  assert.equal(projected.personalization.contentMutated, false);
  assert.equal(projected.personalization.unselectedIssueCount, 0);
  assert.equal(projected.personalization.llmCalls, 0);
  assert.equal(
    projected.personalization.utility.contractId,
    EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT.stableId
  );
  assert.equal(projected.personalization.utility.state, "utility_guard_pass");
  assert.ok(projected.personalization.utility.affinity.discountedGain > 0);
  assert.equal(projected.personalization.utility.sourceDiversity.pass, true);
  assert.equal(projected.personalization.utility.categoryConcentration.pass, true);
  assert.ok(projected.personalization.maxRankShift < projected.personalization.editorialBandSize);
  assert.deepEqual(new Set(projected.issues), new Set(canonical.issues));
  assert.notDeepEqual(projected.issues, canonical.issues);
  assert.equal(canonical.issues[0].subject, "tech-a", "공유 원본 배열을 바꾸면 안 된다");
});

test("개인 오늘판 투영: 취향 신호가 없거나 한 분야만 골랐으면 공유 중요도 순서를 보존한다", () => {
  const canonical = edition();
  const anonymous = projectEditorialPersonalization(canonical, null);
  assert.equal(anonymous.personalization.mode, "canonical_shared_order");
  assert.deepEqual(anonymous.issues, canonical.issues);

  const oneCategory = edition(["tech"]);
  oneCategory.issues = oneCategory.issues.filter((issue) => issue.categoryIds[0] === "tech");
  const projected = projectEditorialPersonalization(oneCategory, user({ tech: 3 }));
  assert.equal(projected.personalization.mode, "canonical_shared_order");
  assert.deepEqual(projected.issues, oneCategory.issues);
});

test("개인 오늘판 투영: 선택 밖 이슈를 조용히 숨기지 않고 무결성 HOLD로 드러낸다", () => {
  const contaminated = edition(["business"]);
  const projected = projectEditorialPersonalization(contaminated, user({ business: 1 }));
  assert.equal(projected.personalization.state, "personalization_integrity_hold");
  assert.equal(projected.personalization.unselectedIssueCount, 3);
  assert.equal(projected.issues.length, contaminated.issues.length);
});

test("개인 오늘판 투영: 선택 분야 하나와 맞는 복수 분야 이슈는 침입으로 보지 않는다", () => {
  const canonical = edition(["business"]);
  canonical.issues = [{
    ...canonical.issues[0],
    categoryIds: ["business", "tech"]
  }];
  const projected = projectEditorialPersonalization(canonical, user({ business: 1 }));
  assert.equal(projected.personalization.state, "personalization_integrity_pass");
  assert.equal(projected.personalization.unselectedIssueCount, 0);
});

test("개인 오늘판 효용 가드: 선호 적중이 늘어도 상단 출처 다양성을 깎으면 공유 순서로 되돌린다", () => {
  const canonical = edition();
  canonical.issues = Array.from({ length: 12 }, (_, index) => {
    const preferred = index % 2 === 1;
    const id = `${preferred ? "business" : "tech"}-${index}`;
    return {
      subject: id,
      headline: `${id} 핵심 변화`,
      paragraph: `${id} 근거 문장`,
      categoryIds: [preferred ? "business" : "tech"],
      sourceEvidence: [{
        evidenceRole: "lead",
        ownershipGroup: preferred ? "publisher:concentrated" : `publisher:diverse-${index}`,
        sourceId: preferred ? "concentrated" : `diverse-${index}`
      }]
    };
  });

  const projected = projectEditorialPersonalization(canonical, user({ business: 1, tech: 0 }));

  assert.equal(projected.personalization.mode, "utility_guard_canonical_fallback");
  assert.equal(projected.personalization.candidateOrderChanged, true);
  assert.equal(projected.personalization.orderChanged, false);
  assert.equal(projected.personalization.utility.state, "utility_guard_hold");
  assert.ok(projected.personalization.utility.affinity.discountedGain > 0);
  assert.ok(projected.personalization.utility.failures.includes("source_diversity_loss"));
  assert.equal(projected.personalization.utility.sourceDiversity.pass, false);
  assert.deepEqual(projected.issues, canonical.issues);

  const deletedCandidate = evaluateEditorialPersonalizationUtility(
    canonical,
    canonical.issues.slice(1),
    user({ business: 1, tech: 0 })
  );
  assert.equal(deletedCandidate.issueCountUnchanged, false);
  assert.equal(deletedCandidate.issueSetUnchanged, false);
  assert.ok(deletedCandidate.failures.includes("candidate_issue_set_mutated"));
});

test("공유 오늘판 생성: 첫 요청자의 종교 토픽 설정을 카테고리 공유 원본에 섞지 않는다", async () => {
  const now = Date.now();
  const source = new JsonSource("shared-topic-source", async () => [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `plain-${index}`,
      title: `일반 사회 현안 후속 조치 ${index + 1}`,
      url: `https://example.com/plain/${index}`,
      category: "news",
      score: 100 - index,
      publishedAt: new Date(now - index * 1000).toISOString()
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `religion-${index}`,
      title: `교회 목사 지역 행사 발표 ${index + 1}`,
      url: `https://example.com/religion/${index}`,
      category: "news",
      score: 200 - index,
      publishedAt: new Date(now - index * 1000).toISOString()
    }))
  ], "news");
  const store = new FeedStore();
  store.createUser("topic-user");
  store.setBriefingCategories("topic-user", ["news"]);
  store.setTopicFilter("topic-user", "religion", true);
  const engine = new FeedEngine(store, [source]);

  const privateEdition = await engine.todayEdition({
    userId: "topic-user",
    slotId: "lunch",
    includeCandidates: true
  });
  const sharedEdition = await engine.todayEdition({
    userId: "topic-user",
    slotId: "lunch",
    includeCandidates: true,
    sharedCanonical: true
  });
  const candidateIds = (value) => new Set(value.candidateFixture.candidates.map((row) => row.itemId));

  assert.ok([...candidateIds(privateEdition)].some((id) => id.startsWith("religion-")));
  assert.ok([...candidateIds(sharedEdition)].every((id) => !id.startsWith("religion-")));
  assert.equal(sharedEdition.sharedCanonical, true);
  assert.deepEqual(sharedEdition.selection.categories.map((row) => row.id), ["news"]);
});
