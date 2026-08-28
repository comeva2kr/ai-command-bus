import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITORIAL_EVENT_FRAME_CONTRACT,
  EDITORIAL_READER_COPY_CONTRACT,
  assessReaderCopyDiversity,
  assessReaderIssueCopy,
  buildReaderLineage,
  projectEditorialReaderCopy,
  readerIssueCopy
} from "../src/feed/editorial-reader-copy.js";
import { attachEditorialLineage } from "../src/feed/editorial-lineage.js";

function hormuzIssue() {
  const sourceEvidence = [{
    evidenceId: "NHE-hormuz-001",
    itemId: "hormuz-001",
    title: "[미국시황]호르무즈 협상 난항에 국제유가 급등…뉴욕증시 일제히 하락",
    sourceId: "namdonews",
    sourceLabel: "남도일보",
    sourceRole: "reported_secondary",
    ownershipGroup: "namdonews",
    ownershipBasis: "registry_explicit",
    syndicationGroup: null,
    canonicalUrl: "https://example.com/hormuz",
    publishedAt: "2026-08-11T01:00:00.000Z",
    observedAt: "2026-08-11T01:05:00.000Z",
    carryover: null,
    evidenceRole: "lead"
  }];
  return attachEditorialLineage({
    subject: "호르무즈 협상 난항에 국제유가 급등",
    headline: "“호르무즈 협상 난항에 국제유가 급등” · 관련 보도 묶음 포착",
    paragraph: "관련 보도 묶음 신호에서 보도를 포착했다. 지금핫 수집 풀에서 직접 확인한 원문은 남도일보 기사 한 건이다.",
    whatHappened: "관련 보도 묶음 신호에서 보도를 포착했다. 지금핫 수집 풀에서 직접 확인한 원문은 남도일보 기사 한 건이다.",
    whyImportant: "원자재·물류·기업 비용과 시장 변동성에 연결될 수 있어 후속 지표와 공식 발표를 함께 볼 가치가 있다.",
    whyHot: "관련 보도 묶음 신호가 확인됐다.",
    whyForYou: "경제·비즈니스를 선택한 오늘판이라 포함했다.",
    watchNext: "현재 풀의 다른 피드에서도 같은 사실이 확인되는지 후속 보도를 대조한다.",
    impactLens: "거시·공급망",
    shape: "coverage",
    categoryIds: ["business"],
    metrics: { score: 0, comments: 0, coverage: 5, sourceCount: 1, evidenceMode: "related_coverage_signal" },
    evidence: { mode: "related_coverage_signal", observedFeedCount: 1, relatedCoverageSignal: true, sources: [{ label: "남도일보" }] },
    sourceEvidence,
    refs: [{
      title: "[미국시황]호르무즈 협상 난항에 국제유가 급등…뉴욕증시 일제히 하락",
      sourceLabel: "남도일보"
    }],
    confidence: { code: "related_coverage_signal", label: "관련 보도 신호" },
    changedSincePrevious: "지난 브리핑에서 다룬 사안입니다. 남도일보 보도가 새로 확인됐습니다.",
    changeState: "material_update",
    changeEvidence: {
      matchMethod: "shared_event_terms",
      matchedEditionId: "morning",
      matchedTerms: ["호르무즈", "협상", "난항", "국제유가"],
      reasons: ["new_observed_source"],
      deltas: { sourceCount: 0, coverage: 0, score: 0, comments: 0 },
      newSources: ["남도일보"]
    }
  }, { selectedCategories: ["business"] });
}

test("독자 문장: 호르무즈 기계 문구를 기자식 제목·리드·변화 문장으로 투영한다", () => {
  const copy = readerIssueCopy(hormuzIssue());
  assert.equal(copy.headline, "호르무즈 협상 난항에 국제유가 급등");
  assert.match(copy.summary, /^남도일보가 /);
  assert.match(copy.summary, /보도했습니다/);
  assert.doesNotMatch(copy.summary, /같은 주제를 다룬 보도|이어지고/);
  assert.doesNotMatch(copy.summary, /관련 보도 묶음 신호|수집 풀|포착했다/);
  assert.match(copy.whyImportant, /국제유가와 운임, 기업 물류비/);
  assert.equal(copy.whyNow,
    "“호르무즈 협상 난항에 국제유가 급등” 관련해 남도일보의 보도가 새로 확인됐습니다.");
  assert.match(copy.watchNext, /해협 통항 상황, 국제유가·운임/);
  assert.match(copy.change, /지난 브리핑에서 다룬 사안/);
  assert.equal(copy.confidenceLabel, "단일 기사 확인");
  assert.equal("whyForYou" in copy, false);
  assert.equal(assessReaderIssueCopy(hormuzIssue(), copy).state, "reader_copy_pass");
});

test("독자 문장: 단일 기사도 실제 중요성을 설명하고 출처 수는 신뢰 라벨로 알린다", () => {
  const issue = {
    ...hormuzIssue(),
    subject: "지역 상권 동향 보도",
    headline: "지역 상권 동향 보도",
    categoryIds: ["business"],
    refs: [{ title: "지역 상권 동향 보도", sourceLabel: "경제일보" }],
    sourceEvidence: [{
      ...hormuzIssue().sourceEvidence[0],
      title: "지역 상권 동향 보도",
      sourceLabel: "경제일보"
    }]
  };
  const copy = readerIssueCopy(issue);
  assert.equal(copy.summary, "경제일보가 “지역 상권 동향 보도”라고 보도했습니다.");
  assert.equal(copy.whyNow,
    "“지역 상권 동향 보도” 관련해 경제일보의 보도가 새로 확인됐습니다.");
  assert.equal(copy.confidenceLabel, "단일 기사 확인");
  assert.match(copy.whyImportant, /기업 활동과 경기 흐름에 영향을 줄 수/);
  assert.doesNotMatch(copy.whyImportant, /추가 보도나 공식 자료가 나와야/);
});

test("독자 문장: 영문 약어 매체명 뒤 조사를 발음에 맞춘다", () => {
  const issue = {
    ...hormuzIssue(),
    subject: "오프시즌 대학 자격 기준 변경",
    headline: "오프시즌 대학 자격 기준 변경",
    shape: "single",
    evidence: { mode: "single_feed_observed", observedFeedCount: 1, sources: [{ label: "ESPN" }] },
    metrics: { score: 0, comments: 0, sourceCount: 1, evidenceMode: "single_feed_observed" },
    sourceEvidence: [{
      ...hormuzIssue().sourceEvidence[0],
      title: "오프시즌 대학 자격 기준 변경",
      sourceLabel: "ESPN"
    }],
    refs: [{ title: "오프시즌 대학 자격 기준 변경", sourceLabel: "ESPN" }]
  };

  assert.match(readerIssueCopy(issue).whyNow, /ESPN이 새 보도를 냈습니다/);
});

test("독자 문장: 온라인 반응을 기사 발행 언론사의 반응으로 돌리지 않는다", () => {
  const issue = {
    ...hormuzIssue(),
    metrics: { score: 42000, comments: 120, sourceCount: 1, evidenceMode: "single_feed_observed", communityOnly: false },
    sourceEvidence: [{
      ...hormuzIssue().sourceEvidence[0],
      sourceLabel: "BBC 월드"
    }]
  };
  const whyNow = readerIssueCopy(issue).whyNow;
  assert.match(whyNow, /온라인에서 추천 42,000건과 댓글 120건/);
  assert.doesNotMatch(whyNow, /BBC 월드에서 추천/);
});

test("독자 문장: 발행 전 준비한 제목을 모든 분야에 같은 읽기 제목으로 쓴다", () => {
  const issue = {
    ...hormuzIssue(),
    preparedHeadline: "맥카시, 스틸러스 쿼터백 4명이 자리를 얻었다고 평가"
  };
  const copy = readerIssueCopy(issue);
  assert.equal(copy.headline, issue.preparedHeadline);
  assert.equal(buildReaderLineage(issue, copy).basis.headline.kind, "prepublish_translation");
});

test("독자 문장: 원본 이슈와 근거 계보는 바꾸지 않고 reader 필드만 추가한다", () => {
  const issue = hormuzIssue();
  const before = JSON.stringify(issue);
  const edition = { editionId: "lunch", issues: [issue] };
  const projected = projectEditorialReaderCopy(edition);
  assert.equal(JSON.stringify(issue), before);
  assert.equal(projected.issues.length, 1);
  assert.equal(projected.issues[0].headline, issue.headline);
  assert.equal(projected.issues[0].reader.headline, "호르무즈 협상 난항에 국제유가 급등");
  assert.equal(projected.readerPresentation.contractId, EDITORIAL_READER_COPY_CONTRACT.stableId);
  assert.equal(projected.readerPresentation.canonicalContentMutated, false);
  assert.equal(projected.readerPresentation.hiddenWhyForYou, true);
  assert.equal(projected.readerPresentation.llmCalls, 0);
});

test("독자 문장: 저장 내부의 이전 판 표현을 대중적인 브리핑 문장으로 바꾼다", () => {
  const copy = readerIssueCopy({
    ...hormuzIssue(),
    changedSincePrevious: "이전 판에 없던 새 사건이다."
  });
  assert.equal(copy.change, "이번 브리핑에서 새로 전하는 소식입니다.");
  assert.doesNotMatch(copy.change, /이전 판|새 사건/);
});

test("독자 문장: 긴 원문 제목은 사건명을 보존한 채 화면 제한 안으로 줄인다", () => {
  const title = "WX242 무선 전동드라이버 ($17) ETENWOLF 에어펌프 S3 ($28) 샤오미 미지아 차량용 무선 청소기 ($34) WORX WU139.1 무선 전동드릴 ($41) 생활용품 할인 모음";
  const copy = readerIssueCopy({
    subject: title,
    headline: title,
    refs: [{ title, sourceLabel: "해외핫딜" }]
  });

  assert.ok(copy.headline.length <= 90);
  assert.match(copy.headline, /^WX242 무선 전동드라이버/);
  assert.match(copy.headline, /…$/);
});

test("독자 문장 게이트: 내부 용어와 같은 관전 문구의 대량 반복을 PASS로 숨기지 않는다", () => {
  const issue = hormuzIssue();
  const copy = readerIssueCopy(issue);
  const internal = assessReaderIssueCopy(issue, {
    ...copy,
    summary: "지금핫 수집 풀에서 관련 보도 묶음 신호를 확인했습니다."
  });
  assert.equal(internal.pass, false);
  assert.ok(internal.failures.includes("internalLanguageAbsent"));

  const repeated = assessReaderCopyDiversity(Array.from({ length: 8 }, (_, index) => ({
    ...copy,
    whyImportant: `사건 ${index + 1}의 판단 영향을 확인해야 합니다.`,
    whyNow: `사건 ${index + 1} 관련 새 보도가 나왔습니다.`,
    watchNext: "추가 보도나 공식 발표가 나오는지 확인해야 합니다."
  })));
  assert.equal(repeated.pass, false);
  assert.equal(repeated.fields.watchNext.maxExactRepeat, 8);
  assert.equal(repeated.fields.watchNext.pass, false);
});

test("독자 문장: 같은 분야·출처의 여러 사건도 사건명을 붙여 반복 관문을 통과한다", () => {
  const copies = Array.from({ length: 8 }, (_, index) => readerIssueCopy({
    subject: `자동차 신차 소식 ${index + 1}`,
    headline: `자동차 신차 소식 ${index + 1}`,
    paragraph: `자동차 신차 소식 ${index + 1} 관련 보도가 나왔습니다.`,
    categoryIds: ["auto"],
    metrics: { score: 100, comments: 0, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", sources: [{ label: "자동차뉴스" }] },
    refs: [{ title: `자동차 신차 소식 ${index + 1}`, sourceLabel: "자동차뉴스" }]
  }));
  const diversity = assessReaderCopyDiversity(copies);

  assert.equal(diversity.pass, true);
  assert.ok(Object.values(diversity.fields).every((field) => field.maxExactRepeat === 1));
});

test("독자 문장: 같은 분야 정책 문장도 근거에 있는 한국어 사건명으로 구분한다", () => {
  const makeIssue = (subject, suffix) => attachEditorialLineage({
    subject,
    headline: subject,
    paragraph: `${subject}에 관한 연구 결과가 새로 보도됐습니다.`,
    whatHappened: `${subject}에 관한 연구 결과가 새로 보도됐습니다.`,
    whyImportant: "새 연구가 기존 설명을 얼마나 바꾸는지 판단하려면 원 연구와 검증 범위를 함께 볼 가치가 있다.",
    whyHot: "새 보도가 확인됐다.",
    whyForYou: "과학을 선택한 오늘판이라 포함했다.",
    watchNext: "원 연구와 후속 검증을 확인한다.",
    impactLens: "연구·근거",
    shape: "single",
    categoryIds: ["science"],
    metrics: { score: 0, comments: 0, sourceCount: 1, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", observedFeedCount: 1, sources: [{ label: "과학뉴스" }] },
    sourceEvidence: [{
      evidenceId: `NHE-science-${suffix}`,
      itemId: `science-${suffix}`,
      title: subject,
      sourceId: "science-news",
      sourceLabel: "과학뉴스",
      sourceRole: "reported_secondary",
      ownershipGroup: "science-news",
      canonicalUrl: `https://example.com/science/${suffix}`,
      evidenceRole: "lead"
    }],
    refs: [{ title: subject, sourceLabel: "과학뉴스" }],
    changedSincePrevious: "지난 브리핑에서는 다루지 않은 소식입니다.",
    changeState: "new",
    changeEvidence: {
      matchMethod: null,
      matchedEditionId: null,
      matchedTerms: [],
      reasons: ["not_in_previous_edition"],
      deltas: null,
      newSources: []
    }
  }, { selectedCategories: ["science"] });

  const weather = makeIssue("날씨 예측의 이론적 한계 연구", "weather");
  const crystal = makeIssue("위그너 결정 내부 움직임 관측 연구", "crystal");
  const copies = [readerIssueCopy(weather), readerIssueCopy(crystal)];

  assert.notEqual(copies[0].whyImportant, copies[1].whyImportant);
  assert.match(copies[0].whyImportant, /날씨 예측의 이론적 한계 연구/);
  assert.match(copies[1].whyImportant, /위그너 결정 내부 움직임 관측 연구/);
  assert.equal(assessReaderIssueCopy(weather, copies[0]).pass, true);
  assert.equal(assessReaderIssueCopy(crystal, copies[1]).pass, true);
});

test("독자 문장 게이트: 이전 브리핑 대비 변화 근거가 없으면 HOLD다", () => {
  const issue = hormuzIssue();
  delete issue.changedSincePrevious;
  const copy = readerIssueCopy(issue);
  assert.equal(copy.change, "");
  const result = assessReaderIssueCopy(issue, copy);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("changeEvidencePresent"));
});

test("독자 문장 게이트: 구조화 근거 없는 중요성·변화 문장은 HOLD다", () => {
  const issue = {
    subject: "삼성전자 신규 투자 발표",
    headline: "삼성전자 신규 투자 발표",
    paragraph: "삼성전자가 신규 투자 계획을 발표했다는 보도가 나왔습니다.",
    whatHappened: "삼성전자가 신규 투자 계획을 발표했다는 보도가 나왔습니다.",
    whyImportant: "삼성전자 주가가 반드시 오를 것이므로 지금 매수해야 합니다.",
    categoryIds: ["business"],
    metrics: { score: 0, comments: 0, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", sources: [{ label: "테스트뉴스" }] },
    refs: [{ title: "삼성전자 신규 투자 발표", sourceLabel: "테스트뉴스" }],
    changedSincePrevious: "이전 보도와 달리 주가 상승이 확정됐습니다."
  };
  const result = assessReaderIssueCopy(issue, readerIssueCopy(issue));
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("canonicalLineageValid"));
  assert.ok(result.failures.includes("whyImportantGrounded"));
  assert.ok(result.failures.includes("changeEvidenceGrounded"));
});

test("독자 문장 게이트: 일곱 필드는 현재 근거 지문과 일치해야 한다", () => {
  const issue = hormuzIssue();
  const copy = readerIssueCopy(issue);
  const base = assessReaderIssueCopy(issue, copy);
  assert.equal(base.pass, true);
  assert.match(base.readerFingerprint, /^[a-f0-9]{64}$/);

  for (const field of EDITORIAL_READER_COPY_CONTRACT.visibleFields) {
    const changed = assessReaderIssueCopy(issue, {
      ...copy,
      [field]: `${copy[field]} 사후 변조`
    });
    assert.equal(changed.pass, false, `${field} 변조가 HOLD여야 한다`);
    assert.ok(changed.failures.includes(`readerFieldMismatch:${field}`));
    assert.notEqual(changed.readerFingerprint, base.readerFingerprint);
  }
});

test("독자 문장: 서로 다른 뉴스 사건을 사회·지정학 상용구 하나로 뭉치지 않는다", () => {
  const makeIssue = (subject, categoryIds = ["news"]) => ({
    subject,
    headline: subject,
    paragraph: `${subject} 관련 보도가 나왔습니다.`,
    categoryIds,
    metrics: { score: 0, comments: 0, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", sources: [{ label: "테스트뉴스" }] },
    refs: [{ title: subject, sourceLabel: "테스트뉴스" }],
    whyImportant: "사회 흐름에서 달라진 점이 있는 사안입니다. 후속 사실과 영향을 확인해야 합니다.",
    changedSincePrevious: "이번 브리핑에서 새로 전하는 소식입니다."
  });

  const weather = readerIssueCopy(makeIssue("한낮 35도 폭염 이어져"));
  const earthquake = readerIssueCopy(makeIssue("콜롬비아 10년래 최악 강진"));
  const election = readerIssueCopy(makeIssue("투표 마감 뒤 투표자 수백 명 오차"));
  const sports = readerIssueCopy(makeIssue("김주형, 윈덤 챔피언십 공동 5위"));
  assert.match(weather.whyImportant, /건강 피해와 전력 수요/);
  assert.match(earthquake.whyImportant, /인명 피해와 구조·복구/);
  assert.match(election.whyImportant, /선거 절차의 신뢰/);
  assert.match(sports.whyImportant, /순위와 다음 대회/);
  assert.equal(new Set([weather.whyImportant, earthquake.whyImportant, election.whyImportant, sports.whyImportant]).size, 4);
});

test("독자 문장: 지정학 사건별로 실제 다음 확인 대상을 나눈다", () => {
  const makeIssue = (subject) => attachEditorialLineage({
    subject,
    headline: subject,
    paragraph: `${subject} 관련 보도가 나왔습니다.`,
    whatHappened: `${subject} 관련 보도가 나왔습니다.`,
    whyImportant: "정책과 안보 판단에 연결되는 사안이라 당사자 발표와 후속 조치를 확인할 가치가 있다.",
    whyHot: "새 보도가 확인됐다.",
    whyForYou: "정치 분야를 선택한 오늘판이라 포함했다.",
    watchNext: "공식 발표와 후속 조치를 확인한다.",
    impactLens: "외교·안보",
    categoryIds: ["politics"],
    metrics: { score: 0, comments: 0, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", sources: [{ label: "테스트뉴스" }] },
    sourceEvidence: [{
      evidenceId: `NHE-${subject}`,
      title: subject,
      sourceId: "test-news",
      sourceLabel: "테스트뉴스",
      sourceRole: "reported_secondary",
      ownershipGroup: "test-news",
      canonicalUrl: `https://example.com/${encodeURIComponent(subject)}`,
      evidenceRole: "lead"
    }],
    refs: [{ title: subject, sourceLabel: "테스트뉴스" }],
    changedSincePrevious: "지난 브리핑에서는 다루지 않은 소식입니다.",
    changeState: "new",
    changeEvidence: {
      matchMethod: null,
      matchedEditionId: null,
      matchedTerms: [],
      reasons: ["not_in_previous_edition"],
      deltas: null,
      newSources: []
    }
  }, { selectedCategories: ["politics"] });
  const issues = [
    makeIssue("우크라, 한국에 방공 무기 지원 요청"),
    makeIssue("북한군 추가 배치·탄도미사일 지원"),
    makeIssue("우크라 드론, 러 석유화학 도시 타격"),
    makeIssue("트럼프, 이란에 배상 요구")
  ];
  const rows = issues.map((issue) => readerIssueCopy(issue));
  assert.match(rows[0].watchNext, /지원 품목·일정/);
  assert.match(rows[1].watchNext, /병력·미사일 규모/);
  assert.match(rows[2].watchNext, /시설 가동 변화/);
  assert.match(rows[3].watchNext, /양국 협상·제재/);
  assert.equal(new Set(rows.map((row) => row.watchNext)).size, rows.length);
  assert.ok(rows.every((row, index) => assessReaderIssueCopy(issues[index], row).pass));
});

test("독자 문장: 검증된 LLM 편집문은 결정론적 사건 프레임보다 우선한다", () => {
  const base = hormuzIssue();
  const issue = attachEditorialLineage({
    ...base,
    editorialEdit: {
      contractId: "NOWHOT-EDITORIAL-LLM-RUNTIME-001",
      state: "verified_edit",
      evidenceHash: base.evidenceHash,
      support: { whyImportant: [base.sourceEvidence[0].evidenceId] }
    },
    whyImportant: "검증된 편집자가 원문 근거 안에서 작성한 사건별 중요성 문장입니다."
  }, { selectedCategories: ["business"] });
  assert.equal(readerIssueCopy(issue).whyImportant, issue.whyImportant);
});

test("독자 문장: 관련기사의 임상시험 키워드가 문화행사 프레임을 바꾸지 않는다", () => {
  assert.equal(EDITORIAL_EVENT_FRAME_CONTRACT.version, 1);
  assert.deepEqual(EDITORIAL_EVENT_FRAME_CONTRACT.excludedInputs, ["refs", "related_observation"]);
  const sourceEvidence = [
    {
      evidenceId: "NHE-culture-lead",
      title: "서울 독립출판 문화행사 오늘 개막",
      sourceId: "culture-news",
      sourceLabel: "문화일보",
      sourceRole: "reported_secondary",
      ownershipGroup: "culture-news",
      canonicalUrl: "https://example.com/culture",
      evidenceRole: "lead"
    },
    {
      evidenceId: "NHE-unrelated-clinical",
      title: "신약 임상시험 3상 대상 공개",
      sourceId: "science-news",
      sourceLabel: "과학뉴스",
      sourceRole: "reported_secondary",
      ownershipGroup: "science-news",
      canonicalUrl: "https://example.com/clinical",
      evidenceRole: "related_observation"
    }
  ];
  const originalWhyImportant = "독립출판 행사와 참여 규모는 지역 문화 소비 흐름을 이해하는 데 중요합니다.";
  const issue = attachEditorialLineage({
    subject: "서울 독립출판 문화행사 개막",
    headline: "서울 독립출판 문화행사 개막",
    paragraph: "서울에서 독립출판 문화행사가 개막했다는 보도가 나왔습니다.",
    whatHappened: "서울에서 독립출판 문화행사가 개막했다는 보도가 나왔습니다.",
    whyImportant: originalWhyImportant,
    whyHot: "문화일보의 새 보도가 확인됐습니다.",
    whyForYou: "문화·연예를 선택한 오늘판이라 포함했습니다.",
    watchNext: "주최 측의 공식 프로그램과 참여 규모를 확인합니다.",
    impactLens: "문화행사",
    shape: "single",
    categoryIds: ["culture"],
    metrics: { score: 0, comments: 0, sourceCount: 1, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", observedFeedCount: 1, sources: [{ label: "문화일보" }] },
    sourceEvidence,
    refs: [
      { title: "서울 독립출판 문화행사 오늘 개막", sourceLabel: "문화일보" },
      { title: "신약 임상시험 3상 대상 공개", sourceLabel: "과학뉴스" }
    ],
    changedSincePrevious: "지난 브리핑에서는 다루지 않은 소식입니다.",
    changeState: "new",
    changeEvidence: {
      matchMethod: null,
      matchedEditionId: null,
      matchedTerms: [],
      reasons: ["not_in_previous_edition"],
      deltas: null,
      newSources: []
    }
  }, { selectedCategories: ["culture"] });

  const copy = readerIssueCopy(issue);
  const lineage = buildReaderLineage(issue, copy);
  assert.match(copy.whyImportant, /서울 독립출판 문화행사 개막/);
  assert.ok(copy.whyImportant.endsWith(originalWhyImportant));
  assert.doesNotMatch(`${copy.whyImportant} ${copy.watchNext}`, /신약|임상시험|원 연구/);
  assert.match(lineage.basis.whyImportant.kind, /^editorial_policy:/);
  assert.deepEqual(lineage.basis.whyImportant.evidenceIds, ["NHE-culture-lead"]);
  assert.equal(assessReaderIssueCopy(issue, copy).pass, true);
});
