import test from "node:test";
import assert from "node:assert/strict";

import { buildCategoryEventViews } from "../src/feed/category-event-view.js";
import { resolveSourceRole } from "../src/feed/shadow-selection.js";
import {
  assembleClassificationFromCompactCategory,
  normalizeClassifierInput
} from "../src/feed/selection-classifier-lab.js";
import { CANDIDATE_REGISTRY } from "../tools/selection-candidate-registry.mjs";

const P6 = CANDIDATE_REGISTRY["p6-policy-shadow-haiku"];
const VERSIONS = {
  modelVersion: P6.requestedModel,
  promptVersion: P6.promptVersion,
  taxonomyVersion: "d2b-taxonomy-test"
};

const article = (id, title, category, sourceRole = "reported_secondary") => ({
  id,
  title,
  excerpt: `${title} 관련 핵심 내용을 확인했다.`,
  url: "https://example.com/shared-event",
  publishedAt: `2026-08-22T0${id.length}:00:00+09:00`,
  kind: "news",
  category,
  source: `source-${id}`,
  sourceCountry: "KR",
  language: "ko",
  editorialCandidate: { sourceRole }
});

const prediction = (row, impactCategories, versions = VERSIONS) => ({
  itemId: row.id,
  status: "classified",
  classification: assembleClassificationFromCompactCategory({
    contentType: row.kind === "community" ? "community" : "news",
    eventType: "domain_event",
    impactCategories,
    subjectCategories: [],
    confidence: 0.9
  }, {
    input: normalizeClassifierInput(row),
    versions,
    operatorGroup: `operator-${row.id}`,
    originDocumentId: row.id,
    policy: P6.compactPolicy
  })
});

const viewOf = (result, category) => result.events
  .flatMap((event) => event.categoryEventViews)
  .find((view) => view.category === category);

test("D2-B: 전역 사건은 공유하되 카테고리별 승인 근거와 1차 근거만 분리한다", () => {
  const business = article("biz", "반도체 기업이 대규모 투자를 발표했다", "business");
  const tech = article("tech", "새 반도체 공정 기술이 공개됐다", "tech");
  const primary = article("official", "정부가 반도체 지원 정책을 공식 발표했다", "politics", "primary");
  const reaction = {
    ...article("reaction", "투자 발표를 두고 시장 반응이 이어졌다", "business", "community_signal"),
    kind: "community"
  };
  const rows = [business, tech, primary, reaction];
  const before = structuredClone(rows);
  const result = buildCategoryEventViews(rows, [
    prediction(business, ["business"]),
    prediction(tech, ["tech"]),
    prediction(primary, ["politics"]),
    prediction(reaction, ["business"])
  ], { roleOf: resolveSourceRole });

  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0].categoryEventViews.map((view) => view.category), ["tech", "business", "politics"]);
  assert.deepEqual(viewOf(result, "business").admittedArticleIds, ["biz"]);
  assert.deepEqual(viewOf(result, "business").sharedPrimaryArticleIds, ["official"]);
  assert.deepEqual(viewOf(result, "business").evidenceArticleIds, ["biz", "official"]);
  assert.deepEqual(viewOf(result, "tech").evidenceArticleIds, ["tech", "official"]);
  assert.equal(viewOf(result, "business").evidenceArticleIds.includes("tech"), false);
  assert.deepEqual(viewOf(result, "business").reactionArticleIds, ["reaction"]);
  assert.deepEqual(viewOf(result, "tech").reactionArticleIds, []);
  assert.deepEqual(rows, before, "legacy article.category를 포함한 입력을 덮어쓰지 않는다");
});

test("D2-B: 다른 카테고리의 비1차 기사 변화는 선택 분야 지문을 바꾸지 않는다", () => {
  const business = article("biz", "반도체 기업이 대규모 투자를 발표했다", "business");
  const tech = article("tech", "새 반도체 공정 기술이 공개됐다", "tech");
  const first = buildCategoryEventViews([business, tech], [
    prediction(business, ["business"]), prediction(tech, ["tech"])
  ], { roleOf: resolveSourceRole });

  const changedTech = { ...tech, title: "새 반도체 공정 기술과 성능 수치가 공개됐다" };
  const second = buildCategoryEventViews([business, changedTech], [
    prediction(business, ["business"]), prediction(changedTech, ["tech"])
  ], { roleOf: resolveSourceRole });

  assert.equal(viewOf(first, "business").factsFingerprint, viewOf(second, "business").factsFingerprint);
  assert.notEqual(viewOf(first, "tech").factsFingerprint, viewOf(second, "tech").factsFingerprint);
});

test("D2-B: 근거 불일치는 보류하고 한 판의 분류기 버전 혼합은 거부한다", () => {
  const business = article("biz", "반도체 기업이 대규모 투자를 발표했다", "business");
  const bad = prediction(business, ["business"]);
  bad.classification.evidenceHash = "0".repeat(64);
  const withheld = buildCategoryEventViews([business], [bad], { roleOf: resolveSourceRole });
  assert.equal(withheld.events.length, 0);
  assert.equal(withheld.withheld[0].reason, "classification_invalid");

  const tech = article("tech", "새 반도체 공정 기술이 공개됐다", "tech");
  assert.throws(() => buildCategoryEventViews([business, tech], [
    prediction(business, ["business"]),
    prediction(tech, ["tech"], { ...VERSIONS, promptVersion: "different-prompt" })
  ], { roleOf: resolveSourceRole }), /mixed classifier versions/);
});

test("D2-C: 앵커 제목으로 eventId가 바뀌어도 분야별 서빙 지문은 같은 계보로 이어진다", () => {
  const tech = article("t", "게임용 PC 견적에 새 그래픽카드를 반영했다", "tech");
  const business = article("biz", "그래픽카드 가격 인하가 시작됐다", "business");
  const first = buildCategoryEventViews([tech, business], [
    prediction(tech, ["tech", "gaming"]),
    prediction(business, ["business"])
  ], { roleOf: resolveSourceRole, nowMs: Date.parse("2026-08-22T09:00:00+09:00") });
  const firstTech = viewOf(first, "tech");
  const firstBusiness = viewOf(first, "business");
  assert.equal(firstBusiness.reappearedUnchanged, false, "직전 서빙 지문이 없으면 관찰만으로 차단하지 않는다");
  const servedFingerprints = new Map([
    [firstTech.categoryViewKey, firstTech.factsFingerprint],
    [firstBusiness.categoryViewKey, firstBusiness.factsFingerprint]
  ]);

  const changedTech = { ...tech, title: "게임용 PC 견적에 새 그래픽카드와 성능 수치를 반영했다" };
  const second = buildCategoryEventViews([changedTech, business], [
    prediction(changedTech, ["tech", "gaming"]),
    prediction(business, ["business"])
  ], {
    roleOf: resolveSourceRole,
    nowMs: Date.parse("2026-08-22T12:00:00+09:00"),
    previousLineage: first.lineageRecords,
    previousServedCategoryFingerprints: servedFingerprints
  });
  const secondTech = viewOf(second, "tech");
  const secondBusiness = viewOf(second, "business");

  assert.notEqual(second.events[0].eventId, first.events[0].eventId, "앵커 제목 변경 반례여야 한다");
  assert.equal(second.events[0].lineage.inherited, true);
  assert.equal(second.events[0].lineage.lineageId, first.events[0].lineage.lineageId);
  assert.equal(secondBusiness.categoryViewKey, firstBusiness.categoryViewKey);
  assert.equal(secondBusiness.reappearedUnchanged, true, "경제 근거가 그대로면 재등장으로 판정한다");
  assert.equal(secondBusiness.materialChange, false);
  assert.equal(secondTech.reappearedUnchanged, false);
  assert.equal(secondTech.materialChange, true, "기술 근거가 바뀐 분야만 새 변화로 판정한다");
});

test("D2-C: 이전 계보와 실제 서빙 지문은 기형 입력을 조용히 승계하지 않는다", () => {
  const tech = article("tech", "새 반도체 공정 기술이 공개됐다", "tech");
  const predictions = [prediction(tech, ["tech"])];

  assert.throws(() => buildCategoryEventViews([tech], predictions, {
    roleOf: resolveSourceRole,
    previousLineage: [{
      eventIds: ["EV-old"],
      aliasChain: [],
      memberArticleIds: ["tech"],
      titleKeys: [],
      fingerprints: []
    }]
  }), /previousLineage lineageId invalid/);

  assert.throws(() => buildCategoryEventViews([tech], predictions, {
    roleOf: resolveSourceRole,
    previousServedCategoryFingerprints: new Map([["lineage:tech", true]])
  }), /served category fingerprint invalid/);
});
