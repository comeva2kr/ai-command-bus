import assert from "node:assert/strict";
import test from "node:test";
import { ARTICLE_SUMMARY_CONTRACT, articleContentId, makeArticleSummaryPipeline } from "../src/feed/article-summary.js";
import { polishIssueHeadlines, reusePreparedArticleDetails } from "../tools/build-slot-canonical-edition.mjs";

const now = Date.parse("2026-09-03T02:00:00Z");
const issue = {
  clusterId: "event-one", headline: "확인된 기사 제목", subject: "확인된 기사 제목",
  selectedByCategories: ["news"],
  eventSources: [{ evidenceId: "one", canonicalUrl: "https://example.com/news/one", title: "확인된 기사 제목", summary: "원문 피드의 확인된 내용", publishedAt: "2026-09-03T01:00:00Z" }]
};
const previous = { ...structuredClone(issue), articleSummary: {
  contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
  contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
  promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
  articleContentId: articleContentId(issue), status: "excerpt_only",
  textKo: "이미 확인해 준비한 한국어 요약을 다른 분야를 선택해도 그대로 제공합니다. ".repeat(6),
  generatedAt: new Date(now - 60_000).toISOString()
} };

test("동일 근거의 준비된 상세는 새 수집·번역 없이 재사용하고 현재 분야를 유지한다", async () => {
  const current = { ...structuredClone(issue), selectedByCategories: ["news", "business"] };
  const input = { publishable: true, issues: [current] };
  const before = JSON.stringify({ input, previous });
  const reused = reusePreparedArticleDetails(input, [previous], now);
  const pipeline = makeArticleSummaryPipeline({ enabled: false, completeBeforePublish: true,
    clock: () => now,
    fetchArticle: () => assert.fail("no repeated fetch"),
    translateText: () => assert.fail("no repeated translation") });
  const result = await pipeline(reused.edition);
  assert.equal(reused.reused, 1);
  const polished = await polishIssueHeadlines(result, {
    preserveContentIds: reused.contentIds, translateTitle: () => assert.fail("keep prepared headline")
  });
  assert.equal(polished.attempted, 0);
  assert.deepEqual(result.issues[0].articleSummary, previous.articleSummary);
  assert.deepEqual(result.issues[0].selectedByCategories, ["news", "business"]);
  assert.equal(JSON.stringify({ input, previous }), before);
});

test("사실·기사 정체성·신선도 변경과 실패한 상세는 성공 캐시로 재사용하지 않는다", () => {
  for (const changed of [
    { ...issue, clusterId: "different" },
    { ...issue, eventSources: [{ ...issue.eventSources[0], summary: "내용이 수정됨" }] },
    { ...issue, eventSources: [{ ...issue.eventSources[0], sourceLabel: "다른 매체" }] },
    { ...issue, eventSources: [{ ...issue.eventSources[0], evidenceRole: "related_observation", canLead: false }] },
    { ...issue, eventSources: [] }
  ]) assert.equal(reusePreparedArticleDetails({ issues: [changed] }, [previous], now).reused, 0);
  assert.equal(reusePreparedArticleDetails({ issues: [issue] }, [previous], now + 86_400_000).reused, 0);
  assert.equal(reusePreparedArticleDetails({ issues: [issue] }, [{ ...previous,
    articleSummary: { ...previous.articleSummary, status: "source_unavailable" } }], now).reused, 0);
});
