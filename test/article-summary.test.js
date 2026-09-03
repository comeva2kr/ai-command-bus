import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ARTICLE_SUMMARY_CONTRACT,
  articleContentId,
  isCurrentArticleSummary,
  isPreparedArticleSummary,
  makeArticleSummaryPipeline
} from "../src/feed/article-summary.js";

function issue() {
  return {
    evidenceHash: "evidence-1",
    subject: "반도체 투자 계획 발표",
    headline: "반도체 투자 계획 발표",
    refs: [
      { id: "a", sourceLabel: "기준 매체", canonicalUrl: "https://example.com/a" },
      { id: "b", sourceLabel: "확인 매체", canonicalUrl: "https://example.com/b" }
    ],
    sourceEvidence: [
      {
        evidenceId: "NHE-a", itemId: "a", sourceLabel: "기준 매체",
        title: "반도체 투자 계획 발표", canonicalUrl: "https://example.com/a", evidenceRole: "lead"
      },
      {
        evidenceId: "NHE-b", itemId: "b", sourceLabel: "확인 매체",
        title: "투자 일정과 생산 계획 공개", canonicalUrl: "https://example.com/b", evidenceRole: "corroborating"
      }
    ]
  };
}

const edition = () => ({ editionId: "edition-1", publishable: true, issues: [issue()], llmCalls: 0 });

function modelResponses({ verified = true, meaningStrengthPreserved = verified, evidenceQuote = "공개 기사 본문" } = {}) {
  let calls = 0;
  const textKo = "공개 기사 본문은 회사가 반도체 생산 역량을 확대하기 위한 투자 계획과 착공 일정을 공개했다고 전했습니다. 공개 기사 본문은 새 설비가 담당할 공정과 단계별 진행 방식도 함께 설명했습니다. 공개 기사 본문은 발표의 핵심 내용과 추진 배경을 전했고, 공개된 일정이 실제 생산 확대로 이어지는 과정에서 추가 확인할 지점을 짚었습니다. 공개 기사 본문만으로 세부 집행 일정과 공급망 영향이 모두 확정된 것은 아니므로 후속 공시와 공식 자료를 함께 확인할 필요가 있습니다. ".repeat(3);
  return {
    count: () => calls,
    invoke: async ({ prompt, purpose, system } = {}) => {
      calls += 1;
      if (purpose === "오늘판 기사 장문 요약" || purpose === "오늘판 기사 장문 요약 1회 교정") {
        assert.match(system, /직접 인용을 제외하고 원문 문장을 통째로 반복하지 마십시오/);
      }
      if (calls === 1) return {
        parsed: { issues: [{
          n: 1,
          evidenceHash: "evidence-1",
          textKo,
          sourceEvidenceIds: ["NHE-a", "NHE-b"]
        }] },
        usage: { input_tokens: 800, output_tokens: 220 }
      };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      return {
        parsed: { issues: [{
          n: 1,
          supported: verified,
          complete: verified,
          coherent: verified,
          unsupportedFragments: verified ? [] : ["근거 밖 주장"],
          sentenceChecks: verified ? draftSentences.map((row) => ({
            n: row.n,
            supported: true,
            meaningStrengthPreserved,
            evidenceQuotes: [evidenceQuote],
            unsupportedFragment: ""
          })) : [],
          reason: verified ? "근거 안에서 핵심 내용을 일관되게 요약함" : "근거 밖 주장"
        }] },
        usage: { input_tokens: 500, output_tokens: 60 }
      };
    }
  };
}

const groundedContextSentences = [
  "회사는 지원 대상과 신청 절차, 제출해야 할 서류를 공식 안내문에 구체적으로 공개했습니다.",
  "신청자는 정해진 기간 안에 온라인 양식을 작성하고 재직 상태를 확인할 수 있는 자료를 함께 제출해야 합니다.",
  "접수된 신청서는 담당 부서가 자격 요건과 서류 완결성을 확인한 뒤 심사위원회에 전달합니다.",
  "심사 과정에서는 지원 목적과 활용 계획, 신청자가 제시한 실행 일정이 안내 기준에 맞는지 검토합니다.",
  "선정 결과는 개별 신청자에게 안내되며 필요한 경우 추가 자료 제출이나 사실 확인을 요청할 수 있습니다.",
  "지원금은 승인된 목적에 맞춰 사용해야 하고 사용 내역과 관련 증빙은 정해진 방식으로 제출해야 합니다.",
  "회사는 신청자가 요건을 충족하지 못하거나 제출 내용이 사실과 다르면 지원 결정을 취소할 수 있다고 밝혔습니다.",
  "신청 기간과 심사 일정은 운영 상황에 따라 조정될 수 있으며 변경 사항은 공식 안내 채널에 게시됩니다.",
  "문의가 필요한 신청자는 담당 부서의 연락처를 이용할 수 있고 자주 묻는 질문도 안내 페이지에서 확인할 수 있습니다.",
  "회사는 제도 운영 과정에서 접수된 의견을 검토하고 다음 모집 안내에 반영할 사항을 별도로 정리할 예정입니다.",
  "최종 지원 범위와 지급 방식은 승인 결과와 개별 조건에 따라 달라질 수 있다고 안내했습니다."
];

const groundedContextQuotes = [
  "회사는 지원 대상과 신청 절차 및 제출 서류를 공식 안내문에 공개했다",
  "신청자는 기간 안에 온라인 양식과 재직 확인 자료를 제출해야 한다",
  "담당 부서는 자격 요건과 서류 완결성을 확인한 뒤 신청서를 심사위원회에 전달한다",
  "심사위원회는 지원 목적과 활용 계획 및 실행 일정을 검토한다",
  "선정 결과는 개별 안내하며 추가 자료나 사실 확인을 요청할 수 있다",
  "지원금은 승인 목적에 사용하고 사용 내역과 증빙을 제출해야 한다",
  "요건 미충족이나 허위 내용이 확인되면 지원 결정을 취소할 수 있다",
  "신청 기간과 심사 일정은 운영 상황에 따라 조정될 수 있으며 변경 사항은 공식 안내 채널에 게시한다",
  "담당 부서 연락처와 자주 묻는 질문은 안내 페이지에서 확인할 수 있다",
  "운영 과정의 의견을 검토해 다음 모집 안내의 반영 사항을 정리할 예정이다",
  "지원 범위와 지급 방식은 승인 결과와 개별 조건에 따라 달라질 수 있다"
];

async function summarizeGroundedClaim(
  sentence, evidenceQuote, verifierQuote = evidenceQuote, verifierSupported = true, verifierPassageIds = null
) {
  const textKo = [sentence, ...groundedContextSentences].join(" ");
  const evidenceQuotes = [evidenceQuote, ...groundedContextQuotes];
  let calls = 0;
  return makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: evidenceQuotes.join(". "), image: null, finalUrl: url
    }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const supported = Array.isArray(verifierSupported)
        ? verifierSupported[Math.min(calls - 2, verifierSupported.length - 1)]
        : verifierSupported;
      const resolvedVerifierQuote = typeof verifierQuote === "function"
        ? verifierQuote(calls - 2)
        : verifierQuote;
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      return {
        parsed: { issues: [{
          n: 1,
          supported,
          complete: true,
          coherent: true,
          unsupportedFragments: [],
          sentenceChecks: draftSentences.map((row, index) => ({
            n: row.n,
            supported,
            meaningStrengthPreserved: supported,
            evidenceQuotes: index === 0 && Array.isArray(resolvedVerifierQuote)
              ? resolvedVerifierQuote
              : [index === 0 ? resolvedVerifierQuote : evidenceQuotes[index]],
            ...(verifierPassageIds ? {
              evidencePassageIds: index === 0 ? verifierPassageIds : [`NHE-a:${index + 1}`]
            } : {}),
            unsupportedFragment: supported ? "" : row.text
          })),
          reason: supported ? "각 문장에 근거가 있음" : "원문에 직접 없는 관계"
        }] }
      };
    }
  })(edition());
}

test("최종 이슈는 기준 기사 중심의 검증된 장문 요약을 한 번 생성하고 캐시한다", async () => {
  const rawAnchor = "공개 기사 본문 ANCHOR_RAW_SENTINEL ".repeat(80);
  const rawSupport = "공개 기사 본문 SUPPORT_RAW_SENTINEL ".repeat(80);
  let fetches = 0;
  const model = modelResponses();
  const cache = new Map();
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return {
        state: "available",
        text: url.endsWith("/a") ? rawAnchor : rawSupport,
        image: url.endsWith("/a") ? "https://img.example.com/a.jpg" : null,
        finalUrl: url
      };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    clock: () => Date.parse("2026-08-24T11:00:00.000Z")
  });

  const first = await pipeline(edition());
  assert.equal(fetches, 2);
  assert.equal(model.count(), 2);
  assert.equal(first.issues[0].articleSummary.status, "ready");
  assert.equal(first.issues[0].articleSummary.sourceEvidenceId, "NHE-a");
  assert.equal(first.issues[0].articleSummary.sourceLabel, "기준 매체");
  assert.equal(first.issues[0].articleSummary.sourceCount, 2);
  assert.equal(first.issues[0].articleSummary.summarySourceCount, 2);
  assert.equal(first.issues[0].articleSummary.image, "https://img.example.com/a.jpg");
  assert.equal(first.issues[0].articleSummary.contractId, ARTICLE_SUMMARY_CONTRACT.stableId);
  assert.equal(first.issues[0].articleSummary.contractVersion, ARTICLE_SUMMARY_CONTRACT.version);
  assert.equal(first.issues[0].articleSummary.promptVersion, ARTICLE_SUMMARY_CONTRACT.promptVersion);
  assert.ok(first.issues[0].articleSummary.textKo.length >= 600);
  assert.deepEqual(first.issues[0].articleSummary.sourceLinks, [
    { evidenceId: "NHE-a", sourceLabel: "기준 매체", sourceGroup: "publisher:기준매체", url: "https://example.com/a" },
    { evidenceId: "NHE-b", sourceLabel: "확인 매체", sourceGroup: "publisher:확인매체", url: "https://example.com/b" }
  ]);
  assert.doesNotMatch(JSON.stringify(first), /ANCHOR_RAW_SENTINEL|SUPPORT_RAW_SENTINEL/);
  assert.doesNotMatch(JSON.stringify([...cache.values()]), /ANCHOR_RAW_SENTINEL|SUPPORT_RAW_SENTINEL/);

  const second = await pipeline(edition());
  assert.equal(fetches, 2, "검증 캐시가 있는데 원문을 다시 읽었다");
  assert.equal(model.count(), 2, "검증 캐시가 있는데 모델을 다시 호출했다");
  assert.equal(second.issues[0].articleSummary.textKo, first.issues[0].articleSummary.textKo);
});

test("발행 전 완성 모드는 모델 장애에도 이미 읽은 공개 원문 발췌를 고정한다", async () => {
  const articleText = [
    "회사는 생산 설비 투자 계획과 착공 일정을 공개했습니다.",
    "새 설비는 반도체 생산 역량을 확대하는 데 사용되며 구체적인 집행 일정은 후속 공시에서 안내할 예정입니다.",
    "이번 발표에는 투자 대상과 단계별 추진 방식, 향후 확인해야 할 절차가 포함됐습니다."
  ].join(" ").repeat(8);
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    completeBeforePublish: true,
    fetchArticle: async (url) => ({
      state: "available",
      text: articleText,
      image: "https://img.example.com/direct.jpg",
      finalUrl: url.replace("example.com", "publisher.example")
    }),
    invoke: async () => { throw new Error("api 529 overloaded_error"); },
    clock: () => Date.parse("2026-08-27T09:00:00.000Z")
  })(edition());

  const summary = result.issues[0].articleSummary;
  assert.equal(summary.status, "excerpt_only");
  assert.match(summary.textKo, /생산 설비 투자 계획/);
  assert.ok(summary.textKo.length <= 900, "공개 원문 폴백이 요약 대신 장문 본문을 노출했다");
  assert.equal(summary.sourceLinks[0].url, "https://publisher.example/a");
  assert.equal(summary.image, "https://img.example.com/direct.jpg");
  assert.equal(isPreparedArticleSummary(summary, result.issues[0]), true);
  assert.equal(isCurrentArticleSummary(summary, result.issues[0], Date.parse("2026-08-27T09:01:00.000Z")), true);
});

test("보류 출처는 사건 근거에 남아도 기사 요약 앵커와 사진보다 뒤에 놓인다", async () => {
  const admittedText = "승인된 기사 본문은 회사의 투자 계획과 실행 일정을 구체적으로 설명했습니다. ".repeat(20);
  const withheldText = "보류된 기사 본문은 사건을 다른 관점에서 전했습니다. ".repeat(20);
  const input = issue();
  input.eventSources = [
    {
      evidenceId: "withheld", sourceLabel: "보류 매체", sourceGroup: "withheld",
      canonicalUrl: "https://example.com/withheld", publishedAt: "2026-08-28T01:00:00.000Z",
      image: "https://img.example.com/withheld.jpg", canLead: false
    },
    {
      evidenceId: "admitted", sourceLabel: "승인 매체", sourceGroup: "admitted",
      canonicalUrl: "https://example.com/admitted", publishedAt: "2026-08-28T02:00:00.000Z",
      image: "https://img.example.com/admitted.jpg", canLead: true
    }
  ];
  const result = await makeArticleSummaryPipeline({
    completeBeforePublish: true,
    fetchArticle: async (url) => url.endsWith("/admitted")
      ? { state: "available", text: admittedText, image: "https://img.example.com/admitted.jpg", finalUrl: url }
      : { state: "available", text: withheldText, image: "https://img.example.com/withheld.jpg", finalUrl: url },
    clock: () => Date.parse("2026-08-28T03:00:00.000Z")
  })({ editionId: "edition-source-order", publishable: true, issues: [input], llmCalls: 0 });

  const summary = result.issues[0].articleSummary;
  assert.equal(summary.sourceLinks[0].sourceLabel, "승인 매체");
  assert.equal(summary.image, "https://img.example.com/admitted.jpg");
  assert.match(summary.textKo, /승인된 기사 본문/);
});

test("발행 전 완성 모드는 공개 본문이 부족해도 준비된 접근불가 종단으로 닫는다", async () => {
  const result = await makeArticleSummaryPipeline({
    completeBeforePublish: true,
    fetchArticle: async (url) => ({
      state: "available",
      text: "상품명과 가격만 공개됐습니다.",
      image: "https://img.example.com/short.jpg",
      finalUrl: url.replace("example.com", "publisher.example")
    }),
    clock: () => Date.parse("2026-08-27T09:00:00.000Z")
  })(edition());

  const summary = result.issues[0].articleSummary;
  assert.equal(summary.status, "source_unavailable");
  assert.equal(summary.unavailableReasonCode, "NO_SUBSTANTIAL_PUBLIC_BODY");
  assert.equal(summary.sourceLinks[0].url, "https://publisher.example/a");
  assert.equal(summary.image, "https://img.example.com/short.jpg");
  assert.equal(isPreparedArticleSummary(summary, result.issues[0]), true);
});

test("공개 본문을 읽지 못해도 수집 때 확보한 매체 공개 요약은 발행 전에 준비한다", async () => {
  const input = issue();
  input.eventSources = [{
    evidenceId: "feed-a",
    sourceLabel: "기준 매체",
    sourceGroup: "publisher-a",
    canonicalUrl: "https://publisher.example/feed-a",
    summary: "기준 매체의 공개 피드는 회사가 반도체 생산 설비 투자를 확대하고 단계별 착공 일정을 공개했다고 전했습니다. " +
      "새 설비의 적용 공정과 예상 가동 시점도 함께 소개했으며, 세부 집행 계획은 후속 공시에서 확인해야 한다고 설명했습니다. ".repeat(4),
    canLead: true
  }];
  const result = await makeArticleSummaryPipeline({
    completeBeforePublish: true,
    fetchArticle: async () => ({ state: "unavailable", reasonCode: "AUTH_REQUIRED", image: null }),
    clock: () => Date.parse("2026-08-28T04:00:00.000Z")
  })({ editionId: "edition-feed-summary", publishable: true, issues: [input], llmCalls: 0 });

  const summary = result.issues[0].articleSummary;
  assert.equal(summary.status, "excerpt_only");
  assert.equal(summary.excerptBasis, "publisher_feed_excerpt");
  assert.match(summary.textKo, /반도체 생산 설비 투자를 확대/);
  assert.equal(summary.sourceLabel, "기준 매체");
  assert.equal(summary.sourceLinks[0].url, "https://publisher.example/feed-a");
  assert.equal(isPreparedArticleSummary(summary, result.issues[0]), true);
});

test("NH108 짧은 공개 소개문은 접근 실패 사유와 메타데이터를 잃지 않고 미확인 상태로 남는다", async () => {
  const input = issue();
  input.eventSources = [{
    evidenceId: "feed-a", sourceLabel: "기준 매체", sourceGroup: "publisher-a",
    canonicalUrl: "https://publisher.example/feed-a",
    summary: "<p>공개 피드는 공장 증설과 착공 일정을 전했습니다.</p>",
    image: "https://img.example.com/feed.jpg",
    originalTitle: "Factory expansion &amp; construction schedule",
    publishedAt: "2026-09-03T01:00:00.000Z"
  }];
  const cache = new Map();
  const result = await makeArticleSummaryPipeline({
    completeBeforePublish: true,
    fetchArticle: async () => ({
      state: "unavailable", reasonCode: "ACCESS_DENIED", httpStatus: 403,
      text: "RAW_FETCH_BODY_MUST_NOT_BE_STORED", image: null
    }),
    invoke: async () => assert.fail("짧은 소개문에 모델을 호출하면 안 된다"),
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  })({ ...edition(), issues: [input] });

  const summary = result.issues[0].articleSummary;
  assert.equal(summary.status, "source_unavailable");
  assert.equal(summary.textKo, null);
  assert.equal(summary.summarySourceCount, 0);
  assert.equal(summary.unavailableReasonCode, "ACCESS_DENIED");
  assert.deepEqual(summary.sourceLinks, [{
    evidenceId: "feed-a", sourceLabel: "기준 매체", sourceGroup: "publisher-a",
    url: "https://publisher.example/feed-a",
    summary: "공개 피드는 공장 증설과 착공 일정을 전했습니다.",
    image: "https://img.example.com/feed.jpg",
    originalTitle: "Factory expansion & construction schedule",
    publishedAt: "2026-09-03T01:00:00.000Z"
  }]);
  assert.equal(result.llmCalls, 0);
  assert.equal(isPreparedArticleSummary(summary, result.issues[0]), true);
  assert.doesNotMatch(JSON.stringify([...cache.values()]), /RAW_FETCH_BODY_MUST_NOT_BE_STORED/);
});

test("NH108 출처 소개문은 200자로 제한하고 정상 요약과 발췌 본문을 바꾸지 않는다", async () => {
  const input = issue();
  const intro = "The publisher reports factory expansion and a construction schedule. ".repeat(6);
  input.sourceEvidence[0].summary = `${intro}FEED_TAIL_MUST_NOT_BE_STORED`;
  for (const status of ["ready", "excerpt_only"]) {
    const run = (item) => makeArticleSummaryPipeline({
      enabled: status === "ready", apiKey: "test", completeBeforePublish: true,
      fetchArticle: async (url) => ({
        state: "available", text: "공개 기사 본문 ".repeat(100),
        image: "https://img.example.com/body.jpg", finalUrl: url
      }),
      invoke: modelResponses().invoke
    })({ ...edition(), issues: [item] });
    const before = (await run(issue())).issues[0].articleSummary;
    const after = (await run(input)).issues[0].articleSummary;

    assert.equal(after.status, status);
    assert.equal(after.textKo, before.textKo);
    assert.equal(after.image, before.image);
    assert.equal(after.sourceLinks[0].summary, intro.slice(0, 200));
    assert.doesNotMatch(JSON.stringify(after), /FEED_TAIL_MUST_NOT_BE_STORED/);
    assert.equal("summary" in after.sourceLinks[1], false);
  }
});

test("NH108 공개 소개문은 화면 장식과 빈 값을 제외하고 실제 텍스트만 전달한다", async () => {
  for (const [metadata, expected] of [
    [{ summary: "본문 기자 Your browser does not support the audio element. 구글 선호 매체 등록 광고 실제 기사 첫 문장입니다." }, "실제 기사 첫 문장입니다."],
    [{ excerpt: "<b>공개된 착공 일정입니다.</b>" }, "공개된 착공 일정입니다."],
    [{ description: "The factory will open next year." }, "The factory will open next year."],
    [{ description: "이토랜드는 유머, 연예, 정보, 이슈를 빠르게 공유하는 커뮤니티입니다…" }, undefined],
    [{ description: "모아보기는 지역 소식과 생활 정보를 공유하는 커뮤니티입니다." }, undefined],
    [{ description: "회사는 지역 교통 정보를 공유하는 커뮤니티를 공개했습니다." }, "회사는 지역 교통 정보를 공유하는 커뮤니티를 공개했습니다."],
    [{ description: "이토랜드는 정보를 공유하는 커뮤니티입니다. 운영사는 3일 장애 복구를 완료했다고 밝혔습니다." }, "이토랜드는 정보를 공유하는 커뮤니티입니다. 운영사는 3일 장애 복구를 완료했다고 밝혔습니다."],
    [{ summary: "로그인 회원가입 이용약관 개인정보처리방침 고객센터" }, undefined],
    [{ summary: "오늘의 HIT 30 종합 유머 연예 생활 시사 이슈" }, undefined],
    [{ summary: "<p>&nbsp;</p>" }, undefined],
    [{ summary: "... ---" }, undefined],
    [{ summary: { text: "not a public excerpt" } }, undefined],
    [{}, undefined]
  ]) {
    const input = issue();
    input.eventSources = [{ ...input.sourceEvidence[0], ...metadata }];
    const result = await makeArticleSummaryPipeline({
      completeBeforePublish: true,
      fetchArticle: async () => ({ state: "unavailable", reasonCode: "TIMEOUT", image: null })
    })({ ...edition(), issues: [input] });
    const summary = result.issues[0].articleSummary;
    assert.equal(summary.sourceLinks[0].summary, expected);
    assert.equal(summary.unavailableReasonCode, "TIMEOUT");
    assert.equal(summary.status, "source_unavailable");
    assert.equal(summary.textKo, null);
  }
});

test("NH108 공개 메타데이터는 직접 원문 정본을 따르고 Google 중계를 다시 병합하지 않는다", async () => {
  const direct = {
    evidenceId: "direct", sourceLabel: "KBS", sourceGroup: "kbs",
    canonicalUrl: "https://news.kbs.co.kr/news/view.do?ncd=1",
    summary: "직접 매체가 공개한 태풍 이동 경로입니다.",
    image: "https://news.kbs.co.kr/photo.jpg"
  };
  const relay = {
    ...direct, evidenceId: "relay", canonicalUrl: "https://news.google.com/rss/articles/opaque",
    summary: "중계 피드의 다른 소개문", image: "https://encrypted-tbn0.gstatic.com/logo.jpg"
  };
  for (const eventSources of [[relay, direct], [direct, relay], [relay]]) {
    const result = await makeArticleSummaryPipeline({
      completeBeforePublish: true,
      fetchArticle: async () => ({ state: "unavailable", reasonCode: "PUBLISHER_URL_UNAVAILABLE", image: null })
    })({ ...edition(), issues: [{ ...issue(), eventSources }] });
    const links = result.issues[0].articleSummary.sourceLinks;
    assert.equal(links.length, 1);
    if (eventSources.length === 1) {
      assert.equal(links[0].url, relay.canonicalUrl);
      assert.equal(links[0].image, undefined);
    } else {
      assert.equal(links[0].url, direct.canonicalUrl);
      assert.equal(links[0].summary, direct.summary);
      assert.equal(links[0].image, direct.image);
      assert.doesNotMatch(JSON.stringify(links), /중계 피드|gstatic/);
    }
  }
});

test("같은 기사의 동시 판 생성은 요약을 한 번만 만들고 같은 정본을 공유한다", async () => {
  const cache = new Map();
  let editorCalls = 0;
  const textKo = groundedContextSentences.join(" ");
  const sourceText = groundedContextQuotes.join(". ");
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      if (purpose === "오늘판 기사 장문 요약") {
        editorCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { parsed: { issues: [{
          n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a", "NHE-b"]
        }] } };
      }
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row, index) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidenceQuotes: [groundedContextQuotes[index]],
          unsupportedFragment: ""
        })),
        reason: "원문 근거 안의 요약"
      }] } };
    },
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    clock: () => Date.parse("2026-08-24T11:00:00.000Z")
  });

  const [left, right] = await Promise.all([pipeline(edition()), pipeline(edition())]);
  assert.equal(editorCalls, 1);
  assert.equal(left.issues[0].articleSummary.status, "ready");
  assert.equal(right.issues[0].articleSummary.textKo, left.issues[0].articleSummary.textKo);
});

test("준비 완료 표시는 실제 요약 본문 또는 유효한 접근불가 종단을 요구한다", () => {
  const base = {
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(issue()),
    generatedAt: "2026-08-24T11:00:00.000Z"
  };
  assert.equal(isPreparedArticleSummary({ ...base, status: "ready", textKo: null }, issue()), false);
  assert.equal(isPreparedArticleSummary({
    ...base,
    status: "source_unavailable",
    textKo: null,
    unavailableReasonCode: null,
    retryAfter: null
  }, issue()), false);
});

test("사건 출처 정본이 있으면 카테고리별 과거 근거 대신 그 원문만 요약한다", async () => {
  const fetched = [];
  const model = modelResponses();
  const canonicalIssue = {
    ...issue(),
    eventSourceSetId: "fixed-event-sources",
    eventSources: [
      { id: "a", evidenceId: "NHE-a", sourceLabel: "기준 매체", title: "반도체 투자 계획 발표",
        canonicalUrl: "https://example.com/a" },
      { id: "b", evidenceId: "NHE-b", sourceLabel: "확인 매체", title: "투자 일정과 생산 계획 공개",
        canonicalUrl: "https://example.com/b" }
    ],
    refs: [{ id: "stale", sourceLabel: "과거 분야 출처", canonicalUrl: "https://stale.example.com/wrong" }],
    sourceEvidence: [{ evidenceId: "stale", sourceLabel: "과거 분야 출처",
      canonicalUrl: "https://stale.example.com/wrong", evidenceRole: "lead" }]
  };
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetched.push(url);
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: model.invoke
  })({ ...edition(), issues: [canonicalIssue] });

  assert.deepEqual(fetched, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.eventSourceSetId, "fixed-event-sources");
  assert.equal(result.issues[0].articleSummary.sourceLinks.some((row) => row.url.includes("stale")), false);
});

test("Google 뉴스 중계로 수집했어도 상세 원문 링크는 확인된 언론사 최종 URL을 쓴다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const model = modelResponses();
  const canonicalIssue = {
    ...issue(),
    eventSources: [{
      id: "a", evidenceId: "NHE-a", sourceLabel: "KBS 뉴스",
      title: "태풍 관련 보도", canonicalUrl: wrapper
    }]
  };
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async () => ({
      state: "available", text: "공개 기사 본문 ".repeat(100), image: "https://news.kbs.co.kr/photo.jpg", finalUrl: direct
    }),
    invoke: async (args) => {
      const response = await model.invoke(args);
      if (response.parsed?.issues?.[0]?.sourceEvidenceIds) response.parsed.issues[0].sourceEvidenceIds = ["NHE-a"];
      return response;
    }
  })({ ...edition(), issues: [canonicalIssue] });

  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.deepEqual(result.issues[0].articleSummary.sourceLinks, [
    { evidenceId: "NHE-a", sourceLabel: "KBS 뉴스", sourceGroup: "kbs", url: direct }
  ]);
});

test("같은 사건에 직접 언론사 URL이 새로 붙으면 과거 원문 없음 캐시를 버린다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque-kbs-cache";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const cache = new Map();
  const fetched = [];
  const model = modelResponses();
  const base = {
    ...issue(),
    clusterId: "EV-source-cache",
    eventSources: [{
      evidenceId: "NHE-a", sourceId: "gnews-top", sourceGroup: "publisher:kbs뉴스",
      sourceLabel: "KBS 뉴스", title: "태풍 관련 보도", canonicalUrl: wrapper
    }]
  };
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => {
      fetched.push(url);
      return url === wrapper
        ? { state: "unavailable", reasonCode: "PUBLISHER_URL_UNAVAILABLE", image: null, finalUrl: null }
        : { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: direct };
    },
    invoke: async (args) => {
      const response = await model.invoke(args);
      if (response.parsed?.issues?.[0]?.sourceEvidenceIds) response.parsed.issues[0].sourceEvidenceIds = ["NHE-a"];
      return response;
    }
  });

  const first = await pipeline({ ...edition(), issues: [base] });
  const second = await pipeline({
    ...edition(),
    issues: [{
      ...structuredClone(base),
      eventSources: [{
        evidenceId: "NHE-a", sourceId: "kbs-news", sourceGroup: "publisher:kbs뉴스",
        sourceLabel: "KBS 뉴스", title: "태풍 관련 보도", canonicalUrl: direct
      }]
    }]
  });

  assert.equal(first.issues[0].articleSummary.status, "source_unavailable");
  assert.equal(second.issues[0].articleSummary.status, "ready");
  assert.deepEqual(fetched, [wrapper, direct]);
});

test("같은 URL에 충분한 공개 피드 발췌가 생기면 원문 없음 캐시보다 먼저 쓴다", async () => {
  const cache = new Map();
  const source = {
    evidenceId: "NHE-feed", sourceId: "publisher-feed", sourceGroup: "publisher:feed",
    sourceLabel: "공개 피드", title: "반도체 투자 계획 발표",
    canonicalUrl: "https://publisher.example/feed-cache"
  };
  const base = {
    ...issue(),
    eventSourceSetId: "EV-feed-cache:publisher:feed",
    eventSources: [source]
  };
  const pipeline = makeArticleSummaryPipeline({
    completeBeforePublish: true,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async () => ({ state: "unavailable", reasonCode: "NO_PUBLIC_BODY", image: null })
  });

  const first = await pipeline({ ...edition(), issues: [base] });
  const second = await pipeline({
    ...edition(),
    issues: [{
      ...base,
      eventSources: [{
        ...source,
        summary: "공개 피드는 회사가 반도체 생산 설비 투자를 확대하고 신규 공정의 단계별 착공 일정을 공개했다고 전했습니다. " +
          "회사는 첫 설비의 가동 목표와 후속 투자 순서를 함께 밝혔으며, 실제 집행 규모와 공급망 영향은 다음 공식 공시에서 확인해야 한다고 설명했습니다. " +
          "신규 설비는 기존 생산 거점과 순차적으로 연결될 예정입니다."
      }]
    }]
  });

  assert.equal(first.issues[0].articleSummary.status, "source_unavailable");
  assert.equal(second.issues[0].articleSummary.status, "excerpt_only");
  assert.match(second.issues[0].articleSummary.textKo, /신규 공정의 단계별 착공 일정/);
});

test("구형 출처 경로도 같은 언론사의 직접 URL과 Google 중계 중 직접 URL만 쓴다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque-kbs-legacy";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const fetched = [];
  const model = modelResponses();
  const input = {
    ...issue(),
    refs: [{
      id: "relay", source: "gnews-top", sourceLabel: "KBS 뉴스",
      canonicalUrl: wrapper
    }],
    sourceEvidence: [{
      evidenceId: "NHE-a", source: "kbs-news", sourceLabel: "KBS",
      title: "태풍 관련 보도", canonicalUrl: direct, evidenceRole: "lead"
    }]
  };
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetched.push(url);
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: async (args) => {
      const response = await model.invoke(args);
      if (response.parsed?.issues?.[0]?.sourceEvidenceIds) response.parsed.issues[0].sourceEvidenceIds = ["NHE-a"];
      return response;
    }
  })({ ...edition(), issues: [input] });

  assert.deepEqual(fetched, [direct]);
  assert.equal(result.issues[0].articleSummary.sourceCount, 1);
  assert.deepEqual(result.issues[0].articleSummary.sourceLinks, [
    { evidenceId: "NHE-a", sourceLabel: "KBS", sourceGroup: "kbs", url: direct }
  ]);
});

test("Google 중계로 만든 요약은 다른 카테고리 판의 직접 언론사 URL에서도 그대로 재사용한다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque-kbs";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const secondUrl = "https://example.com/b";
  const relayIssue = {
    ...issue(),
    eventSources: [
      { evidenceId: "NHE-a", sourceLabel: "KBS 뉴스", title: "반도체 투자 계획 발표", canonicalUrl: wrapper },
      { evidenceId: "NHE-b", sourceLabel: "확인 매체", title: "투자 일정과 생산 계획 공개", canonicalUrl: secondUrl }
    ]
  };
  const directIssue = {
    ...structuredClone(relayIssue),
    evidenceHash: "category-combination-changed",
    eventSources: [
      { ...relayIssue.eventSources[0], canonicalUrl: direct },
      relayIssue.eventSources[1]
    ]
  };
  const cache = new Map();
  const model = modelResponses();
  let fetches = 0;
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url === wrapper ? direct : url };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });

  const first = await pipeline({ ...edition(), issues: [relayIssue] });
  const second = await pipeline({ ...edition(), issues: [directIssue] });

  assert.equal(first.issues[0].articleSummary.status, "ready");
  assert.equal(second.issues[0].articleSummary.status, "ready");
  assert.equal(second.issues[0].articleSummary.articleContentId, first.issues[0].articleSummary.articleContentId);
  assert.equal(fetches, 2);
  assert.equal(model.count(), 2);
});

test("직접 언론사 URL로 만든 요약은 다른 카테고리 판의 Google 중계 URL에서도 재생성하지 않는다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque-kbs-reverse";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const directIssue = {
    ...issue(),
    eventSources: [
      { evidenceId: "NHE-a", sourceLabel: "KBS 뉴스", title: "반도체 투자 계획 발표", canonicalUrl: direct },
      issue().sourceEvidence[1]
    ]
  };
  const relayIssue = {
    ...structuredClone(directIssue),
    evidenceHash: "category-combination-changed",
    eventSources: [{ ...directIssue.eventSources[0], canonicalUrl: wrapper }, directIssue.eventSources[1]]
  };
  const cache = new Map();
  const model = modelResponses();
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available",
      text: "공개 기사 본문 ".repeat(100),
      image: null,
      finalUrl: url === wrapper ? direct : url
    }),
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });

  const first = await pipeline({ ...edition(), issues: [directIssue] });
  const second = await pipeline({ ...edition(), issues: [relayIssue] });

  assert.equal(first.issues[0].articleSummary.status, "ready");
  assert.equal(second.issues[0].articleSummary.status, "ready");
  assert.equal(second.issues[0].articleSummary.textKo, first.issues[0].articleSummary.textKo);
  assert.equal(isCurrentArticleSummary(second.issues[0].articleSummary, relayIssue), true,
    "직접 URL 캐시를 중계 형태에서 재사용하면서 현재 카드의 콘텐츠 별칭을 잃었다");
  assert.equal(model.count(), 2, "같은 사건을 URL 표현만 달라졌다고 다시 생성·검증했다");
});

test("실패한 요약은 같은 사건의 출처가 중계 주소에서 직접 주소로 개선되면 즉시 다시 준비한다", async () => {
  const wrapper = "https://news.google.com/rss/articles/opaque-kbs-refresh";
  const direct = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const support = "https://example.com/support";
  const relayIssue = {
    ...issue(),
    eventSourceSetId: "EV-source-refresh:kbs|support",
    eventSources: [
      { evidenceId: "NHE-a", sourceLabel: "KBS 뉴스", title: "반도체 투자 계획 발표", canonicalUrl: wrapper },
      { evidenceId: "NHE-b", sourceLabel: "확인 매체", title: "투자 일정과 생산 계획 공개", canonicalUrl: support }
    ]
  };
  let sourcesAvailable = false;
  let fetches = 0;
  const model = modelResponses();
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return sourcesAvailable
        ? { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }
        : { state: "unavailable", reasonCode: "NO_PUBLIC_BODY", image: null, finalUrl: url };
    },
    invoke: model.invoke
  });

  const first = await pipeline({ ...edition(), issues: [relayIssue] });
  sourcesAvailable = true;
  const refreshedIssue = {
    ...first.issues[0],
    eventSources: [{ ...relayIssue.eventSources[0], canonicalUrl: direct }, relayIssue.eventSources[1]]
  };
  const second = await pipeline({ ...edition(), issues: [refreshedIssue] });

  assert.equal(first.issues[0].articleSummary.status, "source_unavailable");
  assert.equal(second.issues[0].articleSummary.status, "ready");
  assert.equal(fetches, 4);
  assert.equal(model.count(), 2);
});

test("같은 사건은 판본 슬롯이 바뀌어도 원문과 모델을 다시 호출하지 않는다", async () => {
  let fetches = 0;
  const model = modelResponses();
  const cache = new Map();
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });
  await pipeline({ ...edition(), editionId: "morning", editionSegment: { slotAsOf: "2026-08-24T07:00:00+09:00" } });
  await pipeline({ ...edition(), editionId: "lunch", editionSegment: { slotAsOf: "2026-08-24T12:00:00+09:00" } });
  assert.equal(fetches, 2);
  assert.equal(model.count(), 2);
});

test("같은 사건은 확인 출처가 늘어도 검증된 요약을 다시 만들지 않는다", async () => {
  let fetches = 0;
  const model = modelResponses();
  const cache = new Map();
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });
  await pipeline({ ...edition(), issues: [{ ...issue(), eventSourceSetId: "sources-a" }] });
  const second = await pipeline({ ...edition(), issues: [{ ...issue(), eventSourceSetId: "sources-a-b" }] });

  assert.equal(fetches, 2);
  assert.equal(model.count(), 2);
  assert.equal(cache.size, 1);
  assert.equal(second.issues[0].articleSummary.status, "ready");
});

test("공개 본문을 읽을 수 없으면 우회나 모델 호출 없이 사유를 남긴다", async () => {
  const model = modelResponses();
  const cache = new Map();
  let fetches = 0;
  const now = Date.parse("2026-08-26T00:00:00.000Z");
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return {
        state: "unavailable",
        reasonCode: url.endsWith("/a") ? "ACCESS_DENIED" : "NO_PUBLIC_BODY",
        httpStatus: url.endsWith("/a") ? 403 : 200,
        image: url.endsWith("/b") ? "https://img.example.com/public.jpg" : null,
        finalUrl: null
      };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    clock: () => now
  });

  const result = await pipeline(edition());
  assert.equal(model.count(), 0);
  const { sourceFingerprints, ...unavailableSummary } = result.issues[0].articleSummary;
  assert.equal(sourceFingerprints.length, 1);
  assert.match(sourceFingerprints[0], /^NHSF-[a-f0-9]{24}$/);
  assert.deepEqual(unavailableSummary, {
    status: "source_unavailable",
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(issue()),
    articleContentAliases: [articleContentId(issue())],
    eventSourceSetId: null,
    textKo: null,
    sourceEvidenceId: "NHE-a",
    sourceLabel: "기준 매체",
    sourceCount: 2,
    summarySourceCount: 0,
    sourceLinks: [
      { evidenceId: "NHE-a", sourceLabel: "기준 매체", sourceGroup: "publisher:기준매체", url: "https://example.com/a" },
      { evidenceId: "NHE-b", sourceLabel: "확인 매체", sourceGroup: "publisher:확인매체", url: "https://example.com/b" }
    ],
    image: "https://img.example.com/public.jpg",
    unavailableReasonCode: "ACCESS_DENIED",
    generatedAt: "2026-08-26T00:00:00.000Z",
    retryAfter: "2026-08-26T00:30:00.000Z"
  });
  await pipeline(edition());
  assert.equal(fetches, 2, "같은 판의 접근 실패 원문을 요청마다 다시 읽었다");
});

test("첫 원문이 막히면 실제 요약 기준 기사의 제목을 주제로 사용한다", async () => {
  const fallbackIssue = issue();
  fallbackIssue.subject = "차단된 원문의 더 넓은 제목";
  fallbackIssue.headline = fallbackIssue.subject;
  fallbackIssue.sourceEvidence[0].title = fallbackIssue.subject;
  fallbackIssue.sourceEvidence[1].title = "공개된 기준 기사";
  const textKo = "공개된 기준 기사는 확인 가능한 사실과 당사자의 설명, 현재까지의 진행 상황을 중심으로 전했습니다. ".repeat(12);
  let summaryPacket;
  let calls = 0;
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => url.endsWith("/a")
      ? { state: "unavailable", reasonCode: "ACCESS_DENIED", image: null }
      : { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url },
    invoke: async ({ prompt }) => {
      calls += 1;
      const parsed = JSON.parse(prompt);
      if (calls === 1) {
        summaryPacket = parsed.issues[0];
        return { parsed: { issues: [{
          n: 1,
          evidenceHash: fallbackIssue.evidenceHash,
          textKo,
          sourceEvidenceIds: ["NHE-b"]
        }] } };
      }
      return { parsed: { issues: [{
        n: 1,
        supported: true,
        complete: true,
        coherent: true,
        unsupportedFragments: [],
        sentenceChecks: parsed.issues[0].draftSentences.map((row) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidenceQuotes: ["공개 기사 본문"],
          unsupportedFragment: ""
        })),
        reason: "공개된 기준 기사에 근거함"
      }] } };
    }
  });

  const result = await pipeline({ ...edition(), issues: [fallbackIssue] });
  assert.equal(summaryPacket.subject, "공개된 기준 기사");
  assert.equal(summaryPacket.anchor.title, "공개된 기준 기사");
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.sourceEvidenceId, "NHE-b");
});

test("표시 출처 수와 링크는 요약 가능한 직접 원문 URL 집합 하나를 공유한다", async () => {
  const input = issue();
  input.refs = input.refs.slice(0, 1);
  input.sourceEvidence.push({
    evidenceId: "NHE-c", itemId: "c", sourceLabel: "추가 매체", title: "추가 확인 보도",
    canonicalUrl: "https://example.com/c", evidenceRole: "corroborating"
  }, {
    evidenceId: "NHE-observation", itemId: null, sourceLabel: "관찰 경로", title: "반응",
    canonicalUrl: "https://community.example.com/reaction", evidenceRole: "related_observation"
  });
  const model = modelResponses();
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }),
    invoke: model.invoke
  })({ ...edition(), issues: [input] });
  assert.equal(result.issues[0].articleSummary.sourceCount, 3);
  assert.equal(result.issues[0].articleSummary.summarySourceCount, 3);
  assert.deepEqual(result.issues[0].articleSummary.sourceLinks.map((row) => row.url), [
    "https://example.com/a", "https://example.com/b", "https://example.com/c"
  ]);
});

test("직접 언론사 원문이 있으면 같은 사건의 Google 뉴스 중계 링크는 표시하지 않는다", async () => {
  const input = issue();
  input.eventSources = [
    { evidenceId: "NHE-direct", sourceLabel: "KBS 뉴스", sourceGroup: "kbs", canonicalUrl: "https://news.kbs.co.kr/news/view.do?ncd=1" },
    { evidenceId: "NHE-relay", sourceLabel: "KBS 뉴스", sourceGroup: "gnews", canonicalUrl: "https://news.google.com/rss/articles/kbs-wrapper" }
  ];
  const model = modelResponses();
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }),
    invoke: model.invoke
  })({ ...edition(), issues: [input] });
  assert.deepEqual(result.issues[0].articleSummary.sourceLinks.map((row) => row.url), [
    "https://news.kbs.co.kr/news/view.do?ncd=1"
  ]);
});

test("eventSources 경로에서도 반응 관찰 링크는 기사 원문과 요약 근거에 섞지 않는다", async () => {
  const input = issue();
  input.sourceEvidence.push({
    evidenceId: "NHE-observation", sourceLabel: "반응 관찰", canonicalUrl: "https://community.example.com/reaction",
    evidenceRole: "related_observation"
  });
  input.eventSources = [
    { evidenceId: "NHE-a", sourceLabel: "기준 매체", canonicalUrl: "https://example.com/a" },
    { evidenceId: "NHE-b", sourceLabel: "확인 매체", canonicalUrl: "https://example.com/b" },
    { evidenceId: "NHE-observation", sourceLabel: "반응 관찰", canonicalUrl: "https://community.example.com/reaction" }
  ];
  const model = modelResponses();
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }),
    invoke: model.invoke
  })({ ...edition(), issues: [input] });

  assert.deepEqual(result.issues[0].articleSummary.sourceLinks.map((row) => row.url), [
    "https://example.com/a", "https://example.com/b"
  ]);
});

test("전체 원문은 모두 표시하되 요약에 실제 사용한 공개 본문 수를 따로 밝힌다", async () => {
  const input = issue();
  input.sourceEvidence.push(
    { evidenceId: "NHE-c", sourceLabel: "세 번째 매체", title: "세 번째 보도", canonicalUrl: "https://example.com/c", evidenceRole: "corroborating" },
    { evidenceId: "NHE-d", sourceLabel: "네 번째 매체", title: "네 번째 보도", canonicalUrl: "https://example.com/d", evidenceRole: "corroborating" }
  );
  let fetches = 0;
  const model = modelResponses();
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: model.invoke
  })({ ...edition(), issues: [input] });
  assert.equal(fetches, 3, "기준 기사와 보강 기사 두 건만 요약 모델 입력으로 읽는다");
  assert.equal(result.issues[0].articleSummary.sourceCount, 4);
  assert.equal(result.issues[0].articleSummary.summarySourceCount, 3);
  assert.deepEqual(result.issues[0].articleSummary.sourceLinks.map((row) => row.url), [
    "https://example.com/a", "https://example.com/b", "https://example.com/c", "https://example.com/d"
  ]);
});

test("원문이 오류 메시지나 모델 출력에 복제돼도 로그·캐시에 저장하지 않고 실패 상태만 보존한다", async () => {
  const sentinel = "RAW_SOURCE_SENTINEL_".repeat(20);
  const logs = [];
  const failureCache = new Map();
  const failed = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sentinel.repeat(4), image: null, finalUrl: url }),
    invoke: async () => { throw new Error(`provider echoed ${sentinel}`); },
    cache: { get: (key) => failureCache.get(key), set: (key, value) => failureCache.set(key, value) },
    log: (line) => logs.push(line)
  })(edition());
  assert.equal(failed.issues[0].articleSummary.status, "source_unavailable");
  assert.doesNotMatch(logs.join("\n"), /RAW_SOURCE_SENTINEL/);
  assert.equal(failureCache.size, 1);
  assert.doesNotMatch(JSON.stringify([...failureCache.values()]), /RAW_SOURCE_SENTINEL/);

  let calls = 0;
  const copyCache = new Map();
  const copied = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sentinel.repeat(4), image: null, finalUrl: url }),
    invoke: async () => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: sentinel.repeat(2), sourceEvidenceIds: ["NHE-a"] }] } };
      return { parsed: { issues: [{ n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [], reason: "형식상 통과" }] } };
    },
    cache: { get: (key) => copyCache.get(key), set: (key, value) => copyCache.set(key, value) }
  })(edition());
  assert.equal(copied.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
  assert.equal(copyCache.size, 1);
  assert.doesNotMatch(JSON.stringify([...copyCache.values()]), /RAW_SOURCE_SENTINEL/);
});

test("두 기사 묶음 검증은 문장별 근거 출력이 잘리지 않게 최대 예산을 준다", async () => {
  const second = structuredClone(issue());
  second.evidenceHash = "evidence-2";
  second.refs.forEach((row) => { row.id += "-2"; row.canonicalUrl += "-2"; });
  second.sourceEvidence.forEach((row) => {
    row.evidenceId += "-2";
    row.itemId += "-2";
    row.canonicalUrl += "-2";
  });
  let verifierBudget = null;
  await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    batchSize: 2,
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }),
    invoke: async ({ purpose, maxTokens } = {}) => {
      if (purpose === "오늘판 기사 장문 요약") {
        return { parsed: { issues: [1, 2].map((n) => ({
          n,
          evidenceHash: `evidence-${n}`,
          textKo: "공개 기사 본문을 바탕으로 핵심 사실과 진행 상황을 정리했습니다. ".repeat(12),
          sourceEvidenceIds: [`NHE-a${n === 2 ? "-2" : ""}`]
        })) } };
      }
      verifierBudget = maxTokens;
      throw new Error("budget captured");
    }
  })({ ...edition(), issues: [issue(), second] });
  assert.equal(verifierBudget, 8000);
});

test("한 기사 장문 요약과 문장별 검증에도 충분한 출력 예산을 준다", async () => {
  let editorBudget = null;
  let verifierBudget = null;
  await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url }),
    invoke: async ({ purpose, maxTokens } = {}) => {
      if (purpose === "오늘판 기사 장문 요약") {
        editorBudget = maxTokens;
        return { parsed: { issues: [] } };
      }
      verifierBudget = maxTokens;
      throw new Error("budget captured");
    }
  })(edition());
  assert.ok(editorBudget >= 4000);
  assert.ok(verifierBudget >= 8000);
});

test("한 기사 모델 응답 오류가 다음 기사 요약까지 함께 실패시키지 않는다", async () => {
  const second = structuredClone(issue());
  second.evidenceHash = "evidence-2";
  second.refs.forEach((row) => { row.id += "-2"; row.canonicalUrl += "-2"; });
  second.sourceEvidence.forEach((row) => {
    row.evidenceId += "-2";
    row.itemId += "-2";
    row.canonicalUrl += "-2";
  });
  const textKo = "공개 기사 본문은 회사의 투자 계획과 착공 일정, 새 설비의 역할과 단계별 진행 방식을 설명했습니다. 공개 기사 본문에 확인된 내용만 바탕으로 핵심 사실과 후속 확인 지점을 정리했습니다. ".repeat(4);
  const sourceText = "회사는 투자 계획과 착공 일정을 공개했다. 새 설비의 역할과 단계별 진행 방식도 설명했다. 공개된 핵심 사실과 후속 확인 지점은 공식 자료에서 확인할 수 있다. ".repeat(6);
  const logs = [];
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    batchSize: 0,
    fetchArticle: async (url) => ({
      state: "available",
      text: sourceText,
      image: null,
      finalUrl: url
    }),
    invoke: async ({ prompt, purpose } = {}) => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [] } };
      if (purpose === "오늘판 기사 장문 요약") {
        return { parsed: { issues: [{
          n: 1,
          evidenceHash: "evidence-2",
          textKo,
          sourceEvidenceIds: ["NHE-a-2"]
        }] } };
      }
      const sentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1,
        supported: true,
        complete: true,
        coherent: true,
        unsupportedFragments: [],
        sentenceChecks: sentences.map((row) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidenceQuotes: [sourceText],
          unsupportedFragment: ""
        })),
        reason: "원문 근거 안에 있음"
      }] } };
    },
    log: (line) => logs.push(line)
  })({ ...edition(), issues: [issue(), second] });

  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_GENERATION_ERROR");
  assert.equal(result.issues[1].articleSummary.status, "ready");
  assert.match(logs.join("\n"), /invalid_model_issue_set/);
});

test("같은 배치에서 한 행이 누락돼도 정상 행의 요약은 보존한다", async () => {
  const second = structuredClone(issue());
  second.evidenceHash = "evidence-2";
  second.refs.forEach((row) => { row.id += "-2"; row.canonicalUrl += "-2"; });
  second.sourceEvidence.forEach((row) => {
    row.evidenceId += "-2";
    row.itemId += "-2";
    row.canonicalUrl += "-2";
  });
  const textKo = "공개 기사 본문은 회사의 투자 계획과 착공 일정, 새 설비의 역할과 단계별 진행 방식을 설명했습니다. 공개 기사 본문에 확인된 내용만 바탕으로 핵심 사실과 후속 확인 지점을 정리했습니다. ".repeat(4);
  const sourceText = "회사는 투자 계획과 착공 일정을 공개했다. 새 설비의 역할과 단계별 진행 방식도 설명했다. 공개된 핵심 사실과 후속 확인 지점은 공식 자료에서 확인할 수 있다. ".repeat(6);
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    batchSize: 2,
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ prompt, purpose } = {}) => {
      calls += 1;
      if (purpose === "오늘판 기사 장문 요약") return { parsed: { issues: [{
        n: 2, evidenceHash: "evidence-2", textKo, sourceEvidenceIds: ["NHE-a-2"]
      }] } };
      const secondPacket = JSON.parse(prompt).issues[1];
      return { parsed: { issues: [{
        n: 2, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: secondPacket.draftSentences.map((row) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [sourceText], unsupportedFragment: ""
        })),
        reason: "두 번째 행은 정상"
      }] } };
    }
  })({ ...edition(), issues: [issue(), second] });

  assert.equal(calls, 2);
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_GENERATION_ERROR");
  assert.equal(result.issues[1].articleSummary.status, "ready");
});

test("원문 119자마다 한 글자만 바꾼 짜깁기 요약도 저장하지 않는다", async () => {
  const source = (`${"가".repeat(119)}나`).repeat(6);
  const stitched = (`${"가".repeat(119)}다`).repeat(5);
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: source, image: null, finalUrl: url }),
    invoke: async () => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: stitched, sourceEvidenceIds: ["NHE-a"] }] } };
      return { parsed: { issues: [{ n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [], reason: "형식상 통과" }] } };
    }
  })(edition());
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("근거는 맞지만 원문을 길게 옮긴 초안은 한 번 재서술하고 다시 검증한다", async () => {
  const copiedText = `${"공개 기사 원문의 사실을 그대로 길게 옮긴 문장입니다".repeat(15)}.`;
  const repairedText = groundedContextSentences.join(" ");
  const sourceText = `${copiedText} ${groundedContextQuotes.join(". ")}`;
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ prompt, purpose, system } = {}) => {
      calls += 1;
      if (purpose === "오늘판 기사 장문 요약" || purpose === "오늘판 기사 장문 요약 1회 교정") {
        assert.match(system, /직접 인용을 제외하고 원문 문장을 통째로 반복하지 마십시오/);
      }
      if (calls === 1) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: copiedText, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences || [];
      if (calls === 2) return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [copiedText], unsupportedFragment: ""
        })), reason: "근거는 맞지만 원문 표현을 길게 옮김"
      }] } };
      if (calls === 3) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: repairedText, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const repairedSentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: repairedSentences.map((row, index) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [groundedContextQuotes[index]], unsupportedFragment: ""
        })), reason: "재서술 뒤에도 모든 문장이 원문에 근거함"
      }] } };
    }
  })(edition());

  assert.equal(calls, 4);
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.textKo, repairedText);
});

test("첫 검증이 불완전하거나 두서없다고 판정한 요약은 한 번 교정하고 전체 재검증한다", async () => {
  const draftText = groundedContextSentences.join(" ");
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: groundedContextQuotes.join(". "), image: null, finalUrl: url
    }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1 || calls === 3) return {
        parsed: { issues: [{
          n: 1, evidenceHash: "evidence-1", textKo: draftText, sourceEvidenceIds: ["NHE-a"]
        }] }
      };
      const sentences = JSON.parse(prompt).issues[0].draftSentences || [];
      const accepted = calls === 4;
      return { parsed: { issues: [{
        n: 1,
        supported: true,
        complete: accepted,
        coherent: accepted,
        unsupportedFragments: [],
        sentenceChecks: sentences.map((row, index) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidenceQuotes: [groundedContextQuotes[index]],
          unsupportedFragment: ""
        })),
        reason: accepted ? "교정 뒤 완결성과 흐름을 갖춤" : "핵심 맥락이 빠지고 흐름이 불안정함"
      }] } };
    }
  })(edition());

  assert.equal(calls, 4);
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("600자 미만 요약은 검증자가 통과시켜도 노출하지 않는다", async () => {
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "서로 다른 공개 기사 근거 ".repeat(100), image: null, finalUrl: url }),
    invoke: async () => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: "요".repeat(500), sourceEvidenceIds: ["NHE-a"] }] } };
      return { parsed: { issues: [{ n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [], reason: "형식상 통과" }] } };
    }
  })(edition());
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("근거가 충분해도 900자를 넘는 장문은 요약으로 노출하지 않는다", async () => {
  const textKo = [...groundedContextSentences, ...groundedContextSentences].join(" ");
  const sourceText = [...groundedContextQuotes, ...groundedContextQuotes, ...groundedContextQuotes].join(". ");
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1,
        supported: true,
        complete: true,
        coherent: true,
        unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row, index) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidenceQuotes: [groundedContextQuotes[index % groundedContextQuotes.length]],
          unsupportedFragment: ""
        })),
        reason: "모든 문장이 공개 원문에 근거함"
      }] } };
    }
  })(edition());

  assert.ok(textKo.length > 1200);
  assert.equal(result.issues[0].articleSummary.status, "source_unavailable");
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("검증자가 교정 뒤에도 거부한 요약은 저장하거나 노출하지 않는다", async () => {
  const cache = new Map();
  const model = modelResponses({ verified: false });
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url
    }),
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  })(edition());

  assert.equal(model.count(), 4, "교정과 재검증은 한 번만 수행한다");
  assert.equal(cache.size, 1, "실패 상태만 보존해 같은 기사를 즉시 재과금하지 않는다");
  assert.equal([...cache.values()][0].draft, null);
  assert.equal([...cache.values()][0].verifier, null);
  assert.equal(result.issues[0].articleSummary.status, "source_unavailable");
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
  assert.equal(result.issues[0].articleSummary.textKo, null);
});

test("근거 검증 한 번이 통과하면 같은 요약을 중복 재검증하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 올랐다고 발표했습니다.",
    "회사는 지원금이 올랐다고 발표했다",
    undefined,
    [true, false]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("의미 검증은 통과했지만 인용만 어긋나면 독립 검증 한 번으로 복구한다", async () => {
  const evidenceQuote = "회사는 지원 대상과 신청 절차를 공개했다";
  const result = await summarizeGroundedClaim(
    "회사는 지원 대상과 신청 절차를 공개했습니다.",
    evidenceQuote,
    (verificationIndex) => verificationIndex === 0 ? "원문에 없는 인용" : evidenceQuote
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("문장 근거 대조가 실패한 초안은 같은 검증을 반복하지 않고 한 번 교정해 재검증한다", async () => {
  const textKo = groundedContextSentences.join(" ");
  let calls = 0;
  let rewriteReason = null;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: groundedContextQuotes.join(". "), image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      calls += 1;
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      if (purpose === "오늘판 기사 장문 요약 1회 교정") {
        rewriteReason = JSON.parse(prompt).issues[0].rewriteReason;
        return { parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] } };
      }
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      const firstVerification = purpose === "오늘판 기사 장문 요약 검증";
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row, index) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [firstVerification && index === 0 ? "원문에 없는 인용" : groundedContextQuotes[index]],
          unsupportedFragment: ""
        })),
        reason: firstVerification ? "첫 문장 인용 위치 오류" : "교정 뒤 문장 근거 확인"
      }] } };
    }
  })(edition());
  assert.equal(calls, 4);
  assert.equal(rewriteReason, "evidence_audit");
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("교정 응답이 깨져도 원본 초안과 검증을 버리지 않고 독립 근거 대조로 복구한다", async () => {
  const textKo = groundedContextSentences.join(" ");
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: groundedContextQuotes.join(". "), image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      calls += 1;
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      if (purpose === "오늘판 기사 장문 요약 1회 교정") return { parsed: { issues: [] } };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      const firstVerification = purpose === "오늘판 기사 장문 요약 검증";
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row, index) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [firstVerification && index === 0 ? "원문에 없는 인용" : groundedContextQuotes[index]],
          unsupportedFragment: ""
        })),
        reason: firstVerification ? "첫 문장 인용 위치 오류" : "독립 근거 대조 통과"
      }] } };
    }
  })(edition());

  assert.equal(calls, 5);
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.textKo, textKo);
});

test("모델 응답의 이슈 번호가 중복·누락·범위 밖이면 뒤의 PASS로 덮지 않는다", async () => {
  const textKo = groundedContextSentences.join(" ");
  const cases = [
    ["중복", (row) => [{ ...row, supported: false }, row]],
    ["누락", () => []],
    ["범위 밖", (row) => [{ ...row, n: 2 }]]
  ];

  for (const [label, malformed] of cases) {
    let calls = 0;
    const result = await makeArticleSummaryPipeline({
      enabled: true,
      apiKey: "test",
      fetchArticle: async (url) => ({
        state: "available", text: groundedContextQuotes.join(". "), image: null, finalUrl: url
      }),
      invoke: async ({ prompt } = {}) => {
        calls += 1;
        if (calls === 1) return {
          parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
        };
        const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
        const row = {
          n: 1,
          supported: true,
          complete: true,
          coherent: true,
          unsupportedFragments: [],
          sentenceChecks: draftSentences.map((sentence, index) => ({
            n: sentence.n,
            supported: true,
            meaningStrengthPreserved: true,
            evidenceQuotes: [groundedContextQuotes[index]],
            unsupportedFragment: ""
          })),
          reason: "통과"
        };
        return { parsed: { issues: malformed(row) } };
      }
    })(edition());

    assert.notEqual(result.issues[0].articleSummary.status, "ready", label);
  }
});

test("사실 자체가 맞아도 원문의 범위나 강도를 바꾸면 요약을 노출하지 않는다", async () => {
  const model = modelResponses({ verified: true, meaningStrengthPreserved: false });
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url
    }),
    invoke: model.invoke
  })(edition());

  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("검증자가 원문 밖 구절을 한 개라도 찾으면 요약을 노출하지 않는다", async () => {
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: "공개 기사 본문 근거 ".repeat(100), image: null, finalUrl: url
    }),
    invoke: async () => {
      calls += 1;
      if (calls === 1) return {
        parsed: { issues: [{
          n: 1,
          evidenceHash: "evidence-1",
          textKo: "요".repeat(800),
          sourceEvidenceIds: ["NHE-a"]
        }] }
      };
      return {
        parsed: { issues: [{
          n: 1,
          supported: true,
          complete: true,
          coherent: true,
          unsupportedFragments: ["러프버러가 아닌"],
          sentenceChecks: [{
            n: 1,
            supported: true,
            meaningStrengthPreserved: true,
            evidenceQuotes: ["공개 기사 본문 근거"],
            unsupportedFragment: ""
          }],
          reason: "원문에 없는 비교 표현"
        }] }
      };
    }
  })(edition());

  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("문장별 근거 검증이 요약의 모든 문장을 빠짐없이 덮어야 한다", async () => {
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({
      state: "available", text: "공개 기사 본문 근거 ".repeat(100), image: null, finalUrl: url
    }),
    invoke: async () => {
      calls += 1;
      if (calls === 1) return {
        parsed: { issues: [{
          n: 1,
          evidenceHash: "evidence-1",
          textKo: `${"가".repeat(400)}. ${"나".repeat(400)}.`,
          sourceEvidenceIds: ["NHE-a"]
        }] }
      };
      return {
        parsed: { issues: [{
          n: 1,
          supported: true,
          complete: true,
          coherent: true,
          unsupportedFragments: [],
          sentenceChecks: [{
            n: 1,
            supported: true,
            meaningStrengthPreserved: true,
            evidenceQuotes: ["공개 기사 본문 근거"],
            unsupportedFragment: ""
          }],
          reason: "첫 문장만 확인함"
        }] }
      };
    }
  })(edition());

  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("원문에 없는 정정·비교와 숫자는 독립 검증자가 거부하면 노출하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 30%가 아닌 40% 올랐다고 발표했습니다.",
    "회사는 지원금이 40% 올랐다고 발표했다",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("정정 문장이 아니어도 원문에 없는 숫자는 독립 검증자가 거부한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 30% 올랐다고 발표했습니다.",
    "회사는 지원금이 올랐다고 발표했다",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("검증 모델이 실수로 통과시켜도 원문에 없는 숫자는 기계 검증이 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 30% 올랐다고 발표했습니다.",
    "회사는 지원금이 올랐다고 발표했다",
    undefined,
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("다른 문장의 같은 숫자는 현재 문장의 수치 근거로 쓰지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 40% 올랐다고 발표했습니다.",
    "회사는 지원금이 30% 올랐다고 발표했다. 다른 사업의 매출은 40% 증가했다",
    "회사는 지원금이 30% 올랐다고 발표했다",
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("원문 인접 문장의 숫자를 한 요약 문장으로 합쳐도 전체 원문 근거가 있으면 허용한다", async () => {
  const result = await summarizeGroundedClaim(
    "오세훈 시장은 25일 장관과 주택 공급 관련 2차 회동을 했습니다.",
    "두 사람은 주택 공급 관련 2차 회동을 준비했다. 오세훈 시장은 25일 장관과 만났다",
    "오세훈 시장은 25일 장관과 만났다",
    true,
    ["NHE-a:2"]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("원문의 10,000은 자연스러운 한국어 1만으로 요약할 수 있다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원 대상이 1만 명이라고 밝혔습니다.",
    "회사는 지원 대상이 10,000명이라고 밝혔다"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("같은 근거 문장 안의 수치를 자연스럽게 재배열해도 정상 요약으로 인정한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 공식 발표에서 프로그램 운영 방식과 신청 절차를 설명하며 지원 규모는 300만원, 참여 정원은 120명이라고 밝혔습니다.",
    "회사는 공식 발표에서 프로그램 운영 방식과 신청 절차를 설명하며 수혜 인원은 120명, 지급액은 300만원이라고 밝혔다"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("범위 끝에만 붙은 단위는 양쪽 수치에 적용해 자연스러운 한국어 재서술을 허용한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 금리 전망치를 연 1.5%에서 2.7%로 제시했습니다.",
    "회사는 금리 전망치를 연 1.5~2.7%로 제시했다"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("한국어 문장과 무관한 긴 한국어 인용은 원문에 존재해도 근거로 인정하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 올랐다고 발표했습니다.",
    "회사는 지원금이 올랐다고 발표했다",
    "신청 기간과 심사 일정 변경은 공식 안내 채널에 게시한다"
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("서로 함께 나온 사실만으로 원문에 없는 인과관계를 만들지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "원자재 가격이 올랐다. 회사는 생산을 줄였다",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("두 검수자가 통과시켜도 영문 원문에 없는 인과는 관계 근거가 없으면 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "Raw material prices rose. The company reduced production",
    undefined,
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("두 검수자가 통과시켜도 한국어 원문에 없는 인과는 관계 근거가 없으면 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "원자재 가격이 올랐다. 회사는 생산을 줄였다",
    undefined,
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("두 검수자가 통과시켜도 신청 가능을 제도 신설로 바꾼 시점 왜곡은 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 올해 직원 지원 제도를 신설했습니다.",
    "직원들은 올해 지원 제도에 신청할 수 있다",
    undefined,
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("두 검수자가 통과시켜도 수치의 비교 방향을 뒤집은 요약은 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사의 매출이 경쟁사보다 더 많았습니다.",
    "회사 매출은 100억원이고 경쟁사 매출은 120억원이다",
    undefined,
    true
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("다른 근거 문장의 관계 표현을 빌려 거짓 인과를 통과시키지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "Raw material prices rose. The company reduced production. A separate division expanded because demand increased",
    ["Raw material prices rose. The company reduced production", "A separate division expanded because demand increased"],
    [true, false]
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("생략부호로 무관한 문장들을 이어 거짓 인과를 만들지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "Raw material prices rose. A separate division expanded because demand increased. The company reduced production",
    "Raw material prices rose … because demand increased … The company reduced production"
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("원문에서 실제로 이어지는 두 문장 경계의 연속 인용은 근거로 인정한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사 매출은 증가했고 별도 합병은 무산됐습니다.",
    "회사 매출은 증가했다. 별도 합병은 무산됐다",
    "회사 매출은 증가했다 별도 합병은 무산됐다"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("로 인해 형태의 근거 없는 인과도 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격 상승으로 인해 회사가 생산을 줄였습니다.",
    "Raw material prices rose. The company reduced production",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("다른 근거 문장의 부정 표현을 빌려 거짓 정정을 통과시키지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 기존 제도가 아니라 신규 제도를 채택했습니다.",
    "회사는 신규 제도를 채택했다. 별도 사업은 지원 대상이 아닌 신청자를 제외했다",
    ["회사는 신규 제도를 채택했다", "별도 사업은 지원 대상이 아닌 신청자를 제외했다"],
    [true, false]
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("원문이 직접 밝힌 인과와 대비는 자연스러운 한국어로 요약할 수 있다", async () => {
  const causal = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "The company reduced production because raw material prices rose"
  );
  const contrast = await summarizeGroundedClaim(
    "해외 매출은 늘어난 반면 국내 매출은 줄었습니다.",
    "Overseas sales increased while domestic sales declined"
  );
  assert.equal(causal.issues[0].articleSummary.status, "ready");
  assert.equal(contrast.issues[0].articleSummary.status, "ready");
});

test("원문 한 인용이 직접 뒷받침한 인과는 중복 재검증하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격이 올랐기 때문에 회사가 생산을 줄였습니다.",
    "The company reduced production because raw material prices rose",
    undefined,
    [true, false]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("한 문장을 직접 뒷받침하는 연속 원문 인용은 여러 개여도 허용한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 신규 제도를 채택했고 후속 일정을 공개했습니다.",
    "회사는 신규 제도를 채택했다. 회사는 후속 일정을 공개했다",
    ["회사는 신규 제도를 채택했다", "회사는 후속 일정을 공개했다"]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("충분한 정확 인용이 있으면 검증기의 불필요한 추가 인용 때문에 정상 요약을 버리지 않는다", async () => {
  const evidenceQuote = "회사는 지원 대상과 신청 절차를 공개했다";
  const result = await summarizeGroundedClaim(
    "회사는 지원 대상과 신청 절차를 공개했습니다.",
    evidenceQuote,
    ["원문에 없는 불필요한 보조 인용", evidenceQuote]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("검증기는 원문을 재복사하지 않고 코드가 고정한 구절 ID로 근거를 지정한다", async () => {
  const evidenceQuote = "회사는 지원 대상과 신청 절차를 공개했다";
  const result = await summarizeGroundedClaim(
    "회사는 지원 대상과 신청 절차를 공개했습니다.",
    evidenceQuote,
    "복사 과정에서 달라진 인용",
    true,
    ["NHE-a:1"]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("원문에 없는 구절 ID는 검증자가 통과시켜도 요약 근거로 쓰지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원 대상과 신청 절차를 공개했습니다.",
    "회사는 지원 대상과 신청 절차를 공개했다",
    "복사 과정에서 달라진 인용",
    true,
    ["NHE-a:999"]
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("대비 문장을 두 개의 직접 인용이 함께 뒷받침해도 불필요한 재검증을 하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "해외 매출은 늘어난 반면 국내 매출은 줄었습니다.",
    ["해외 매출은 늘었다", "국내 매출은 줄었다"],
    ["해외 매출은 늘었다", "국내 매출은 줄었다"]
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.llmCalls, 2);
});

test("영문 led 주어 to 결과 형태도 직접 인과 근거로 인정한다", async () => {
  const result = await summarizeGroundedClaim(
    "원자재 가격 상승 때문에 회사가 생산을 줄였습니다.",
    "The rise in raw material prices led the company to reduce production"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("영문 although 대비도 자연스러운 반면 문장으로 옮길 수 있다", async () => {
  const result = await summarizeGroundedClaim(
    "해외 매출은 늘어난 반면 국내 매출은 줄었습니다.",
    "Although overseas sales increased, domestic sales declined"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("아니고 형태의 정정도 원문에 없는 비교 숫자를 차단한다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 30%가 아니고 40% 올랐다고 발표했습니다.",
    "회사는 지원금이 40% 올랐다고 발표했다",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("신청 가능한 시점을 사업 신설 시점으로 유추하면 노출하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 올해 직원 지원 제도를 신설했습니다.",
    "직원들은 올해 지원 제도에 신청할 수 있다",
    undefined,
    false
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("원문이 직접 밝힌 정정·비교는 그대로 요약할 수 있다", async () => {
  const result = await summarizeGroundedClaim(
    "회사는 지원금이 30%가 아닌 40% 올랐다고 발표했습니다.",
    "회사는 지원금이 30%가 아닌 40% 올랐다고 발표했다"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("영문 원문의 no longer를 옮긴 아니라고 간접 인용은 정정문으로 오인하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "대변인은 그가 더 이상 이사가 아니라고 확인했습니다.",
    "The spokesperson confirmed that he was no longer a director"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("영문 원문의 no longer는 아닌 관계를 직접 뒷받침한다", async () => {
  const result = await summarizeGroundedClaim(
    "대변인은 그가 더 이상 이사가 아닌 상태라고 확인했습니다.",
    "The spokesperson confirmed that he was no longer a director"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("영문 축약 부정도 아닌 관계를 직접 뒷받침한다", async () => {
  const result = await summarizeGroundedClaim(
    "대변인은 그가 이사가 아닌 상태라고 확인했습니다.",
    "The spokesperson confirmed that he wasn't a director"
  );
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("검증 인용은 떨어진 원문을 생략부호로 이어 만들지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "단체는 조사에서 직원의 위법 행위가 확인되지 않았고 활동을 계속하겠다고 밝혔습니다.",
    "The charity said the inquiry found no wrongdoing by its staff, and it would continue its work",
    "The charity said the inquiry found no wrongdoing by its staff … it would continue its work"
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("검증 인용은 문장부호가 달라도 단어가 바뀌면 허용하지 않는다", async () => {
  const result = await summarizeGroundedClaim(
    "단체는 조사에서 직원의 위법 행위가 확인되지 않았고 활동을 계속하겠다고 밝혔습니다.",
    "The charity said the inquiry found no wrongdoing by its staff, and it would continue its work",
    "The charity said the inquiry found no wrongdoing by its staff, and it would continue its campaign"
  );
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("검수자가 원문 밖 의미를 특정하면 표현이 달라도 한 번 재작성하고 다시 검증한다", async () => {
  const evidenceQuotes = ["로햄프턴대학교가 장학금을 지급한다", ...groundedContextQuotes];
  const unsafeText = ["러프버러가 아닌 로햄프턴대학교가 장학금을 지급합니다.", ...groundedContextSentences].join(" ");
  const repairedText = ["로햄프턴대학교가 장학금을 지급합니다.", ...groundedContextSentences].join(" ");
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: evidenceQuotes.join(". "), image: null, finalUrl: url }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: unsafeText, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences || [];
      if (calls === 2) return {
        parsed: { issues: [{
          n: 1,
          supported: false,
          complete: true,
          coherent: true,
          unsupportedFragments: ["원문에 없는 대학 대조"],
          sentenceChecks: draftSentences.map((row, index) => ({
            n: row.n,
            supported: index !== 0,
            meaningStrengthPreserved: index !== 0,
            evidenceQuotes: [evidenceQuotes[index]],
            unsupportedFragment: index === 0 ? "원문에 없는 대학 대조" : ""
          })),
          reason: "원문에 없는 대학 비교"
        }] }
      };
      if (calls === 3) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: repairedText, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const repairedSentences = JSON.parse(prompt).issues[0].draftSentences;
      return {
        parsed: { issues: [{
          n: 1,
          supported: true,
          complete: true,
          coherent: true,
          unsupportedFragments: [],
          sentenceChecks: repairedSentences.map((row, index) => ({
            n: row.n,
            supported: true,
            meaningStrengthPreserved: true,
            evidenceQuotes: [evidenceQuotes[index]],
            unsupportedFragment: ""
          })),
          reason: "재작성 뒤 모든 문장이 원문 근거 안에 있음"
        }] }
      };
    }
  })(edition());

  assert.equal(calls, 4);
  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.textKo, repairedText);
});

test("기능이 꺼졌거나 키가 없으면 원문과 모델을 호출하지 않는다", async () => {
  for (const options of [{ enabled: false, apiKey: "test" }, { enabled: true, apiKey: null }]) {
    let fetches = 0;
    let calls = 0;
    const base = edition();
    const result = await makeArticleSummaryPipeline({
      ...options,
      fetchArticle: async () => { fetches += 1; throw new Error("호출되면 안 됨"); },
      invoke: async () => { calls += 1; throw new Error("호출되면 안 됨"); }
    })(base);
    assert.equal(fetches, 0);
    assert.equal(calls, 0);
    assert.equal(result.issues[0].articleSummary, undefined);
  }
});

test("실모델 검증 전 배포와 스테이징은 장문 요약을 기본으로 호출하지 않는다", () => {
  const compose = readFileSync("deploy/docker-compose.yml", "utf8");
  const staging = readFileSync("tools/staging.mjs", "utf8");
  assert.match(compose, /NOWHOT_ARTICLE_SUMMARY=\$\{NOWHOT_ARTICLE_SUMMARY:-0\}/);
  assert.match(staging, /NOWHOT_ARTICLE_SUMMARY: process\.env\.NOWHOT_ARTICLE_SUMMARY \|\| "0"/);
  assert.match(staging, /NOWHOT_CATEGORY_ROUTING: process\.env\.NOWHOT_CATEGORY_ROUTING \|\| "v2"/);
  assert.match(staging, /NOWHOT_ARTICLE_SUMMARY_MODEL: process\.env\.NOWHOT_ARTICLE_SUMMARY_MODEL \|\| "claude-sonnet-5"/);
  assert.match(staging, /NOWHOT_ARTICLE_SUMMARY_VERIFIER_MODEL: process\.env\.NOWHOT_ARTICLE_SUMMARY_VERIFIER_MODEL \|\| "claude-sonnet-5"/);
});

test("기사 콘텐츠 ID는 선택 분야·출처 구성 변화와 무관하고 사건이 바뀔 때만 바뀐다", () => {
  const base = {
    ...issue(),
    eventSourceSetId: "EV-fixed:publisher-a|publisher-b",
    categoryIds: ["news"],
    eventSources: [
      { evidenceId: "NHE-a", canonicalUrl: "https://example.com/a" },
      { evidenceId: "NHE-b", canonicalUrl: "https://example.com/b" },
      { evidenceId: "NHE-c", canonicalUrl: "https://example.com/c" }
    ]
  };
  const otherSelection = { ...structuredClone(base), evidenceHash: "different-edit", categoryIds: ["news", "business"] };
  const reordered = { ...structuredClone(base), eventSources: [...base.eventSources].reverse() };
  const extraSource = { ...structuredClone(base), eventSources: [
    ...base.eventSources,
    { evidenceId: "NHE-z", canonicalUrl: "https://example.com/z" }
  ] };
  const relayed = { ...structuredClone(base), eventSources: [
    { evidenceId: "NHE-wrapper", canonicalUrl: "https://news.google.com/rss/articles/opaque" },
    ...base.eventSources
  ] };
  const changedSources = structuredClone(base);
  changedSources.eventSources[1].canonicalUrl = "https://example.com/d";
  const differentEvent = { ...structuredClone(base), eventSourceSetId: "EV-other:publisher-a|publisher-b" };

  assert.equal(articleContentId(base), articleContentId(otherSelection));
  assert.equal(articleContentId(base), articleContentId(reordered));
  assert.equal(articleContentId(base), articleContentId(extraSource));
  assert.equal(articleContentId(base), articleContentId(relayed));
  assert.equal(articleContentId(base), articleContentId(changedSources));
  assert.notEqual(articleContentId(base), articleContentId(differentEvent));
});

test("짧은 공개 본문도 여유 있는 길이 범위와 문장 경계 근거로 요약한다", async () => {
  const sourceText = "회사는 지원 대상을 공개했다. 신청은 다음 달 시작한다. 세부 절차와 제출 서류를 안내했다. 온라인 접수 방식과 심사 일정을 설명했다. 신청자는 자격 요건을 확인한 뒤 증빙 자료를 제출해야 한다. 결과는 개별 통지하며 일정 변경은 공식 안내에서 확인할 수 있다. 문의 창구와 자주 묻는 질문도 함께 공개했다. 지원 범위와 지급 방식은 심사 결과에 따라 달라질 수 있다고 밝혔다.";
  const textKo = "회사는 지원 대상과 신청 절차를 공개했고 신청은 다음 달 시작됩니다. 신청자는 자격 요건을 확인한 뒤 필요한 증빙 자료를 온라인으로 제출해야 합니다. 회사는 심사 일정과 결과 통지 방식도 안내했으며, 일정이 바뀌면 공식 안내를 통해 확인할 수 있습니다. 문의 창구와 자주 묻는 질문도 함께 제공됩니다.";
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [{
        n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"]
      }] } };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      const evidenceQuotes = [
        ["회사는 지원 대상을 공개했다 신청은 다음 달 시작한다"],
        ["신청자는 자격 요건을 확인한 뒤 증빙 자료를 제출해야 한다"],
        ["온라인 접수 방식과 심사 일정을 설명했다", "결과는 개별 통지하며 일정 변경은 공식 안내에서 확인할 수 있다"],
        ["문의 창구와 자주 묻는 질문도 함께 공개했다"]
      ];
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: evidenceQuotes[row.n - 1], unsupportedFragment: ""
        })),
        reason: "공개 본문에 근거함"
      }] } };
    }
  })(edition());

  assert.equal(calls, 2);
  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("생성·검증 실패 HOLD는 재시작 뒤에도 30분 동안 재과금하지 않는다", async () => {
  const cache = new Map();
  let calls = 0;
  let fetches = 0;
  const options = {
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url };
    },
    invoke: async () => { calls += 1; throw new Error("provider failed"); },
    clock: () => Date.parse("2026-08-26T12:00:00+09:00")
  };

  const first = await makeArticleSummaryPipeline(options)(edition());
  const second = await makeArticleSummaryPipeline(options)(edition());
  assert.equal(first.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_GENERATION_ERROR");
  assert.equal(second.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_GENERATION_ERROR");
  assert.equal(calls, 1);
  assert.equal(fetches, 2, "첫 실행의 출처 두 곳만 읽고 재시작 뒤에는 캐시를 쓴다");
});

test("일시적인 모델 529 오류는 기사 실패로 저장하지 않고 30분 회로만 연다", async () => {
  const cache = new Map();
  let calls = 0;
  let nowMs = Date.parse("2026-08-26T12:00:00+09:00");
  const options = {
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async () => { calls += 1; throw new Error("api 529 overloaded"); },
    clock: () => nowMs
  };

  const pipeline = makeArticleSummaryPipeline(options);
  const first = await pipeline(edition());
  const second = await pipeline(edition());
  assert.equal(calls, 1);
  assert.equal([...cache.values()].some((entry) => entry?.articleSummary), false);
  assert.equal(first.issues[0].articleSummary, undefined);
  assert.equal(second.issues[0].articleSummary, undefined);
  assert.equal(first.articleSummaryReceipt.calls, 1, "공급자가 오류를 반환한 실제 호출도 비용 시도로 센다");
  assert.equal(isPreparedArticleSummary(first.issues[0].articleSummary, first.issues[0]), false);

  nowMs += 31 * 60 * 1000;
  await pipeline(edition());
  assert.equal(calls, 2, "회로 만료 뒤에는 다음 재고 준비에서 다시 시도해야 한다");
});

test("네트워크 전송 오류도 기사 실패로 저장하지 않고 공급자 회로만 연다", async () => {
  const cache = new Map();
  let calls = 0;
  const options = {
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async () => { calls += 1; throw new TypeError("fetch failed"); }
  };

  const first = await makeArticleSummaryPipeline(options)(edition());
  const second = await makeArticleSummaryPipeline(options)(edition());
  assert.equal(calls, 1);
  assert.equal([...cache.values()].some((entry) => entry?.articleSummary), false);
  assert.equal(first.issues[0].articleSummary, undefined);
  assert.equal(second.issues[0].articleSummary, undefined);
});

test("서로 다른 기사 요청이 동시에 실패해도 공급자 장애 호출은 한 번만 한다", async () => {
  let calls = 0;
  const fetchBarrier = new Promise((resolve) => setTimeout(resolve, 10));
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      await fetchBarrier;
      return { state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url };
    },
    invoke: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("api 529 overloaded");
    }
  });
  const other = structuredClone(edition());
  other.editionId = "edition-2";
  other.issues[0].clusterId = "EV-other";
  other.issues[0].sourceEvidence = other.issues[0].sourceEvidence.map((row) => ({
    ...row,
    evidenceId: `${row.evidenceId}-other`,
    canonicalUrl: `${row.canonicalUrl}-other`
  }));
  assert.notEqual(articleContentId(edition().issues[0]), articleContentId(other.issues[0]));

  const [first, second] = await Promise.all([pipeline(edition()), pipeline(other)]);
  assert.equal(calls, 1);
  assert.equal(first.issues[0].articleSummary, undefined);
  assert.equal(second.issues[0].articleSummary, undefined);
});

test("공급자 장애 HOLD는 공유 캐시를 쓰는 새 파이프라인에도 유지된다", async () => {
  const cache = new Map();
  let calls = 0;
  const options = {
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async () => { calls += 1; throw new Error("api 529 overloaded"); }
  };

  await makeArticleSummaryPipeline(options)(edition());
  await makeArticleSummaryPipeline(options)(edition());
  assert.equal(calls, 1);
  assert.equal([...cache.values()].some((entry) => entry?.articleSummary), false);
});

test("fallback 공급자 결제 오류는 기사별 생성 실패로 저장하지 않는다", async () => {
  const cache = new Map();
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fallbackModel: "claude-fallback",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async ({ model, purpose, prompt } = {}) => {
      calls += 1;
      if (model === "claude-fallback") throw new Error("api 400 billing_error");
      if (purpose === "오늘판 기사 장문 요약") return { parsed: { issues: [] } };
      const draftSentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1, supported: false, complete: false, coherent: false,
        unsupportedFragments: [], sentenceChecks: draftSentences.map((row) => ({
          n: row.n, supported: false, meaningStrengthPreserved: false,
          evidenceQuotes: [], unsupportedFragment: row.text
        })), reason: "초안 없음"
      }] } };
    }
  })(edition());

  assert.equal(calls, 3);
  assert.equal(result.issues[0].articleSummary, undefined);
  assert.equal([...cache.values()].some((entry) => entry?.articleSummary), false);
});

test("잘린 응답이나 빈 모델 본문도 기사 실패로 저장하지 않고 30분 회로만 연다", async () => {
  for (const message of ["truncated", "no text block"]) {
    const cache = new Map();
    let calls = 0;
    const options = {
      enabled: true,
      apiKey: "test",
      cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
      fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
      invoke: async () => { calls += 1; throw new Error(message); }
    };
    const pipeline = makeArticleSummaryPipeline(options);
    const first = await pipeline(edition());
    const second = await pipeline(edition());
    assert.equal(calls, 1, message);
    assert.equal([...cache.values()].some((entry) => entry?.articleSummary), false, message);
    assert.equal(first.issues[0].articleSummary, undefined, message);
    assert.equal(second.issues[0].articleSummary, undefined, message);
  }
});

test("숫자와 한국어 인용부호로 시작하는 문장도 문장별 검증 대상으로 분리한다", async () => {
  const textKo = "지원 일정과 대상이 공식 안내를 통해 확정됐습니다. 2026년 8월 26일부터 온라인 접수를 시작하고 대상자는 안내된 절차를 따라야 합니다. 「추가 안내」는 변경된 제출 서류와 심사 일정을 포함해 공식 페이지에 게시됩니다. 신청자는 마감 전에 자격 요건을 확인하고 필요한 증빙 서류를 빠짐없이 제출해야 합니다.";
  const sourceText = "지원 일정과 대상이 공식 안내를 통해 확정됐다. 2026년 8월 26일부터 온라인 접수를 시작하고 대상자는 안내 절차를 따라야 한다. 「추가 안내」는 변경된 제출 서류와 심사 일정을 포함해 공식 페이지에 게시한다. 신청자는 마감 전에 자격 요건을 확인하고 필요한 증빙 서류를 제출해야 한다.";
  let seenSentences = [];
  await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      seenSentences = JSON.parse(prompt).issues[0].draftSentences;
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: seenSentences.map((row) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidenceQuotes: [sourceText], unsupportedFragment: ""
        })),
        reason: "문장별 근거 확인"
      }] } };
    }
  })(edition());
  assert.equal(seenSentences.length, 4);
});

test("같은 사건 요약은 카테고리 조합별 편집 해시가 달라도 한 번만 생성한다", async () => {
  const cache = new Map();
  const model = modelResponses();
  let fetches = 0;
  const base = {
    ...issue(),
    eventSourceSetId: "EV-fixed:publisher-a|publisher-b",
    categoryIds: ["news"],
    eventSources: [
      { evidenceId: "NHE-a", sourceLabel: "기준 매체", title: "반도체 투자 계획 발표", canonicalUrl: "https://example.com/a" },
      { evidenceId: "NHE-b", sourceLabel: "확인 매체", title: "투자 일정과 생산 계획 공개", canonicalUrl: "https://example.com/b" }
    ]
  };
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => {
      fetches += 1;
      return { state: "available", text: "공개 기사 본문 ".repeat(100), image: null, finalUrl: url };
    },
    invoke: model.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });

  const first = await pipeline({ ...edition(), issues: [base] });
  const secondIssue = { ...structuredClone(base), evidenceHash: "different-edit", categoryIds: ["news", "business"] };
  const second = await pipeline({ ...edition(), issues: [secondIssue] });

  assert.equal(first.issues[0].articleSummary.status, "ready");
  assert.equal(second.issues[0].articleSummary.status, "ready");
  assert.equal(model.count(), 2, "편집 조합이 달라도 같은 기사라면 편집+검증 한 번만 호출한다");
  assert.equal(fetches, 2, "같은 출처 본문도 다시 가져오지 않는다");
  assert.equal(isCurrentArticleSummary(second.issues[0].articleSummary, secondIssue), true);
});

test("짧은 원문은 근거량에 맞춘 완결 요약이면 고정 600자 문턱으로 버리지 않는다", async () => {
  const textKo = "회사는 반도체 생산 설비 투자 계획과 착공 일정을 공개했습니다. 새 설비가 맡을 공정과 단계별 진행 방식도 설명했습니다. 신청과 심사에 필요한 세부 절차는 공식 안내에서 확인할 수 있습니다. 일정 변경과 최종 집행 범위는 후속 공시를 통해 다시 확인해야 합니다. 추가 발표에서도 일정과 집행 범위를 함께 대조해야 합니다.";
  const sourceText = "회사는 반도체 생산 설비에 투자한다고 발표했다. 착공 일정과 새 설비가 맡을 공정을 공개했다. 단계별 진행 방식과 신청 절차, 심사에 필요한 제출 서류도 안내했다. 일정 변경은 공식 안내에서 확인할 수 있고 최종 집행 범위는 후속 공시에서 공개할 예정이라고 밝혔다.";
  let calls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1) return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const packet = JSON.parse(prompt).issues[0];
      const draftSentences = packet.draftSentences;
      return { parsed: { issues: [{
        n: 1,
        supported: true,
        complete: true,
        coherent: true,
        unsupportedFragments: [],
        sentenceChecks: draftSentences.map((row) => ({
          n: row.n,
          supported: true,
          meaningStrengthPreserved: true,
          evidencePassageIds: packet.evidencePassages.map((passage) => passage.id),
          unsupportedFragment: ""
        })),
        reason: "원문 근거 안의 완결 요약"
      }] } };
    }
  })(edition());

  assert.equal(result.issues[0].articleSummary.status, "ready");
});

test("기존 초안이 HOLD일 때만 상위 모델로 한 번 재생성해 같은 근거 게이트를 통과시킨다", async () => {
  const sourceText = [
    "회사는 반도체 생산 설비 투자 계획을 발표했다.",
    "신규 설비는 고성능 반도체 생산에 활용될 예정이다.",
    "착공은 다음 분기에 시작하고 생산은 단계적으로 확대한다.",
    "투자 규모와 세부 일정은 이사회 승인 뒤 확정한다.",
    "회사는 시장 수요와 공급 상황을 반영해 집행 시점을 조정할 수 있다고 밝혔다.",
    "관련 내용은 후속 공시를 통해 추가로 안내할 예정이다."
  ].join(" ");
  const fallbackText = "회사는 고성능 반도체 생산을 위한 신규 설비 투자 계획을 발표했습니다. 착공은 다음 분기에 시작하며 생산 능력은 단계적으로 확대할 예정입니다. 다만 투자 규모와 세부 일정은 이사회 승인 뒤 확정되고, 시장 수요와 공급 상황에 따라 집행 시점이 조정될 수 있습니다. 회사는 확정되는 내용을 후속 공시로 안내할 계획입니다.";
  const calls = [];
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    model: "claude-sonnet-5",
    fallbackModel: "claude-fable-5",
    verifierModel: "claude-haiku-4-5-20251001",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ model, purpose, prompt } = {}) => {
      calls.push({ model, purpose });
      if (purpose === "오늘판 기사 장문 요약") {
        return { parsed: { issues: [] } };
      }
      if (purpose === "오늘판 기사 장문 요약 상위 모델 1회 재생성") {
        return { parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo: fallbackText, sourceEvidenceIds: ["NHE-a"] }] } };
      }
      const packet = JSON.parse(prompt).issues[0];
      const supported = packet.draftSentences.length > 0;
      return { parsed: { issues: [{
        n: 1,
        supported,
        complete: supported,
        coherent: supported,
        unsupportedFragments: [],
        sentenceChecks: packet.draftSentences.map((row) => ({
          n: row.n,
          supported,
          meaningStrengthPreserved: supported,
          evidencePassageIds: supported ? packet.evidencePassages.map((passage) => passage.id) : [],
          unsupportedFragment: ""
        })),
        reason: supported ? "원문 근거 확인" : "초안 없음"
      }] } };
    }
  })(edition());

  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.textKo, fallbackText);
  assert.equal(result.issues[0].articleSummary.generationModel, "claude-fable-5");
  assert.equal(calls.filter((row) => row.purpose === "오늘판 기사 장문 요약 상위 모델 1회 재생성").length, 1);
  assert.ok(calls.filter((row) => row.purpose.includes("상위 모델")).every((row) => row.model === "claude-fable-5"));
});

test("기존 초안이 통과하면 상위 모델 fallback을 호출하지 않는다", async () => {
  const sourceText = "회사는 반도체 생산 설비 투자 계획과 착공 일정을 공개했다. 신규 설비는 고성능 반도체 생산에 활용하고 생산 능력은 단계적으로 확대한다. 투자 규모와 세부 일정은 이사회 승인 뒤 확정하며 시장 수요와 공급 상황에 따라 집행 시점을 조정할 수 있다고 밝혔다. 관련 투자 결정과 변경 사항은 후속 공시를 통해 안내한다. 회사는 신규 설비가 생산 안정성과 공급 대응력을 높이는 데 활용될 것이라고 설명했다.";
  const textKo = "회사는 고성능 반도체 생산을 위한 신규 설비 투자 계획과 착공 일정을 공개했습니다. 생산 능력은 단계적으로 확대하며 투자 규모와 세부 일정은 이사회 승인 뒤 확정할 예정입니다. 시장 수요와 공급 상황에 따라 집행 시점은 조정될 수 있습니다. 관련 투자 결정과 변경 사항은 후속 공시로 안내하고, 신규 설비는 생산 안정성과 공급 대응력을 높이는 데 활용할 계획입니다.";
  let fallbackCalls = 0;
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    model: "claude-sonnet-5",
    fallbackModel: "claude-fable-5",
    verifierModel: "claude-haiku-4-5-20251001",
    fetchArticle: async (url) => ({ state: "available", text: sourceText, image: null, finalUrl: url }),
    invoke: async ({ purpose, prompt } = {}) => {
      if (purpose === "오늘판 기사 장문 요약 상위 모델 1회 재생성") {
        fallbackCalls += 1;
        throw new Error("호출되면 안 됨");
      }
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{ n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"] }] }
      };
      const packet = JSON.parse(prompt).issues[0];
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: packet.draftSentences.map((row) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidencePassageIds: packet.evidencePassages.map((passage) => passage.id), unsupportedFragment: ""
        })),
        reason: "원문 근거 확인"
      }] } };
    }
  })(edition());

  assert.equal(result.issues[0].articleSummary.status, "ready");
  assert.equal(result.issues[0].articleSummary.generationModel, "claude-sonnet-5");
  assert.equal(fallbackCalls, 0);
});

test("기본 요약 배치는 여러 기사를 한 호출에 묶는다", async () => {
  const issues = [1, 2, 3].map((n) => ({
    ...structuredClone(issue()),
    evidenceHash: `evidence-${n}`,
    sourceEvidence: issue().sourceEvidence.map((source, index) => ({
      ...source,
      evidenceId: `NHE-${n}-${index}`,
      canonicalUrl: `https://example.com/${n}/${index}`
    }))
  }));
  const batchSizes = [];

  await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async ({ prompt } = {}) => {
      batchSizes.push(JSON.parse(prompt).issues.length);
      throw new Error("api 529 overloaded");
    }
  })({ editionId: "edition-batch", publishable: true, issues, llmCalls: 0 });

  assert.deepEqual(batchSizes, [3]);
});

test("결제 또는 인증 4xx 뒤에는 같은 파이프라인의 추가 모델 호출을 막는다", async () => {
  const issues = [1, 2, 3].map((n) => ({
    ...structuredClone(issue()),
    evidenceHash: `billing-${n}`,
    sourceEvidence: issue().sourceEvidence.map((source, index) => ({
      ...source,
      evidenceId: `NHE-billing-${n}-${index}`,
      canonicalUrl: `https://example.com/billing/${n}/${index}`
    }))
  }));
  let calls = 0;
  const pipeline = makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    batchSize: 1,
    fetchArticle: async (url) => ({ state: "available", text: "공개 기사 본문 ".repeat(80), image: null, finalUrl: url }),
    invoke: async () => {
      calls += 1;
      throw new Error("api 400 billing_error usage limit reached");
    }
  });

  const first = await pipeline({ editionId: "edition-billing-1", publishable: true, issues, llmCalls: 0 });
  const second = await pipeline({
    editionId: "edition-billing-2",
    publishable: true,
    issues: issues.map((row, index) => ({ ...row, evidenceHash: `billing-next-${index}` })),
    llmCalls: 0
  });

  assert.equal(calls, 1);
  assert.ok([...first.issues, ...second.issues].every((row) => !row.articleSummary),
    "결제 장애 한 번을 모든 기사 고유의 요약 실패로 저장하면 안 된다");
});

test("운영 요약은 편집과 검증 두 번 뒤 교정·재검증·상위 모델을 호출하지 않는다", async () => {
  const purposes = [];
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    allowRecovery: false,
    fallbackModel: "claude-fable-5",
    fetchArticle: async (url) => ({
      state: "available", text: groundedContextQuotes.join(". "), image: null, finalUrl: url
    }),
    invoke: async ({ purpose, prompt } = {}) => {
      purposes.push(purpose);
      if (purpose === "오늘판 기사 장문 요약") return {
        parsed: { issues: [{
          n: 1, evidenceHash: "evidence-1",
          textKo: groundedContextSentences.join(" "), sourceEvidenceIds: ["NHE-a"]
        }] }
      };
      const packet = JSON.parse(prompt).issues[0];
      return { parsed: { issues: [{
        n: 1, supported: false, complete: false, coherent: true,
        unsupportedFragments: ["근거 밖 주장"], sentenceChecks: packet.draftSentences.map((row) => ({
          n: row.n, supported: false, meaningStrengthPreserved: false,
          evidencePassageIds: [], unsupportedFragment: row.text
        })), reason: "근거 밖 주장"
      }] } };
    }
  })(edition());

  assert.deepEqual(purposes, ["오늘판 기사 장문 요약", "오늘판 기사 장문 요약 검증"]);
  assert.equal(result.issues[0].articleSummary.unavailableReasonCode, "SUMMARY_VERIFICATION_HOLD");
});

test("운영 요약은 1차 검증을 통과한 자연스러운 번역을 문자열 유사도로 재검증하지 않는다", async () => {
  let calls = 0;
  const textKo = "회사는 새 지원 절차를 공개하고 신청 대상과 제출 서류를 안내했습니다. 신청서는 담당 부서의 자격 확인을 거쳐 심사위원회로 전달됩니다. 심사 과정에서는 지원 목적과 실행 계획을 확인하며 필요하면 추가 자료를 요청할 수 있습니다. 최종 지원 범위와 지급 방식은 승인 결과와 개별 조건에 따라 달라질 수 있습니다.";
  const result = await makeArticleSummaryPipeline({
    enabled: true,
    apiKey: "test",
    allowRecovery: false,
    fetchArticle: async (url) => ({
      state: "available",
      text: "The company published a new application process, including eligibility and required documents. Applications go through an eligibility review before a committee examines the purpose and execution plan. The company may request additional documents. Final support and payment terms depend on each approval.",
      image: null,
      finalUrl: url
    }),
    invoke: async ({ prompt } = {}) => {
      calls += 1;
      if (calls === 1) return { parsed: { issues: [{
        n: 1, evidenceHash: "evidence-1", textKo, sourceEvidenceIds: ["NHE-a"]
      }] } };
      const packet = JSON.parse(prompt).issues[0];
      return { parsed: { issues: [{
        n: 1, supported: true, complete: true, coherent: true, unsupportedFragments: [],
        sentenceChecks: packet.draftSentences.map((row, index) => ({
          n: row.n, supported: true, meaningStrengthPreserved: true,
          evidencePassageIds: [packet.evidencePassages[index].id],
          unsupportedFragment: ""
        })), reason: "원문 근거 확인"
      }] } };
    }
  })(edition());

  assert.equal(calls, 2);
  assert.equal(result.issues[0].articleSummary.status, "ready");
});
