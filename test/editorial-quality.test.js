import test from "node:test";
import assert from "node:assert/strict";

import { buildDigest } from "../src/feed/digest.js";
import { categoryGuardReason } from "../src/feed/classify.js";
import { attachEditorialLineage } from "../src/feed/editorial-lineage.js";
import {
  EDITORIAL_QUALITY_CONTRACT,
  assessEditorialDraft,
  buildBlindReviewPacket,
  coverageEvidence,
  hasHumanReviewWork,
  summarizeHumanReview,
  subjectQuality
} from "../src/feed/editorial-quality.js";

function groundedReviewIssue(issue, selectedCategories = issue.categoryIds || []) {
  const enriched = attachEditorialLineage({
    ...issue,
    whatHappened: issue.whatHappened || issue.paragraph,
    whyImportant: issue.whyImportant || `${issue.subject}의 후속 사실과 영향을 판단하려면 공식 자료를 함께 확인할 가치가 있다.`,
    whyHot: issue.whyHot || "현재 수집 목록의 상위 후보로 확인됐다.",
    whyForYou: issue.whyForYou || "선택한 관심 분야의 오늘판이라 포함했다.",
    watchNext: issue.watchNext || "공식 자료와 후속 보도를 확인한다.",
    impactLens: issue.impactLens || "테스트 편집 정책"
  }, { selectedCategories });
  return {
    ...enriched,
    changeState: "new",
    changedSincePrevious: "지난 브리핑에서는 다루지 않은 소식입니다.",
    changeEvidence: {
      matchMethod: null,
      matchedEditionId: null,
      matchedTerms: [],
      reasons: ["not_in_previous_edition"],
      deltas: null,
      newSources: []
    }
  };
}

test("편집 근거: 관련기사 묶음과 지금핫 복수 피드 직접 관측을 분리한다", () => {
  const relatedOnly = coverageEvidence([{
    title: "정부 주택 공급 일정 발표",
    source: "gnews",
    sourceLabel: "한겨레",
    coverage: 5
  }]);
  assert.equal(relatedOnly.mode, "related_coverage_signal");
  assert.equal(relatedOnly.observedFeedCount, 1);

  const unsupported = assessEditorialDraft({
    headline: "여러 매체가 다룬 주택 공급 일정",
    paragraph: "여러 매체가 함께 다룬 주택 공급 일정 소식이다.",
    subject: "주택 공급 일정",
    evidence: relatedOnly,
    sourceLabels: ["한겨레"]
  });
  assert.equal(unsupported.state, "machine_gate_hold");
  assert.ok(unsupported.failures.includes("crossSourceWordingSupported"));

  const direct = coverageEvidence([
    { title: "정부 주택 공급 일정 발표", source: "hani", sourceLabel: "한겨레", coverage: 2 },
    { title: "주택 공급 일정 다음 달 확정", source: "yna", sourceLabel: "연합뉴스", coverage: 2 }
  ]);
  assert.equal(direct.mode, "multiple_feed_observed");
  assert.equal(direct.observedFeedCount, 2);
  assert.equal(direct.independentGroupCount, 2);
});

test("편집 근거: 같은 발행사의 직접 RSS와 중계 피드를 독립 관측으로 세지 않는다", () => {
  const samePublisher = coverageEvidence([
    { title: "청년 주거 대책 발표", source: "gnews", sourceLabel: "한겨레", coverage: 2 },
    { title: "청년 주거 대책 발표", source: "hani-rank", sourceLabel: "한겨레 뉴스랭킹", coverage: 0 }
  ]);
  assert.equal(samePublisher.observedFeedCount, 2, "원시 피드 관측은 진단값으로 보존해야 한다");
  assert.equal(samePublisher.independentGroupCount, 1);
  assert.equal(samePublisher.mode, "single_feed_observed");
  assert.deepEqual(samePublisher.ownershipGroups, ["hankyoreh"]);

  const digest = buildDigest([
    { id: "g", title: "청년 주거 대책 발표 일정 확정", source: "gnews", sourceLabel: "한겨레", category: "news", coverage: 2 },
    { id: "h", title: "청년 주거 대책 발표 일정 확정", source: "hani-rank", sourceLabel: "한겨레 뉴스랭킹", category: "news", coverage: 0 }
  ], { maxIssues: 1 });
  assert.equal(digest.issues.length, 1);
  assert.equal(digest.issues[0].evidence.mode, "single_feed_observed");
  assert.doesNotMatch(`${digest.issues[0].headline} ${digest.issues[0].paragraph}`, /서로 다른 운영그룹|복수 피드/);
});

test("편집 문장: 한 글자·조사로 끝나는 주제어를 발행 가능한 제목으로 보지 않는다", () => {
  assert.equal(subjectQuality("李").pass, false);
  assert.equal(subjectQuality("Cooler Master는").pass, false);
  assert.equal(subjectQuality("뉴욕증시 급등에").pass, false);
  assert.equal(subjectQuality("전월세난·임차인 불안 우려에").pass, false);
  assert.equal(subjectQuality("鄭 金, 남탓 전문가·고질병").pass, false);
  assert.equal(subjectQuality("어느 아파트에 올라온 입주민 공지").pass, false);
  assert.equal(subjectQuality("사진 원본 공개되자 발칵 누가 편집했나 소동").pass, false);
  assert.equal(subjectQuality("눈치보는것 같은 넷플릭스 현재 상황").pass, false);
  assert.equal(subjectQuality("靑, 불법 증축 논란 김상호 징계 후 면직 처리 예정").pass, false);
  assert.equal(subjectQuality("여 공급 법안 처리하자").pass, false);
  assert.equal(subjectQuality("삼각김밥만 먹고 살아야 할 판").pass, false);
  assert.equal(subjectQuality("BYD 씨라이언 심각하네").pass, false);
  assert.equal(subjectQuality("던파] 50%에서 멈추넴").pass, false);
  assert.equal(subjectQuality("하영 집안 앙딱정..JPG").pass, false);
  assert.equal(subjectQuality("아반떼 튜닝").pass, false);
  assert.equal(subjectQuality("휴대폰이 먹통이네").pass, false);
  assert.equal(subjectQuality("[연합뉴스 이 시각 헤드라인]").pass, false);
  assert.equal(subjectQuality("찾았습니다 감사합니다").pass, false);
  assert.equal(subjectQuality("전기차 뭐 살지 추천 좀 부탁해요.").pass, false);
  assert.equal(subjectQuality("상승률 32.5%").pass, false);
  assert.equal(subjectQuality("계속 웃기면 드라마예요").pass, false);
  assert.equal(subjectQuality("애들이 차를 안다고요? ㅋㅋ").pass, false);
  assert.equal(subjectQuality("옵치)폐급 프렌즈들 팀으로 만날때 어떻게 대응함?").pass, false);
  assert.equal(subjectQuality("李·與 서울 지지율 뚝").pass, true);
  assert.equal(subjectQuality("BYD 씨라이언 배터리 결함이 심각하네").pass, true,
    "무엇이 심각한지 드러난 제목까지 막으면 안 된다");
  assert.equal(subjectQuality("던파 설치가 50%에서 멈춘 원인과 해결법").pass, true);
  assert.equal(subjectQuality("아반떼 튜닝 규제 완화 발표").pass, true);
  assert.equal(subjectQuality("전국 통신망 장애로 휴대폰이 먹통").pass, true);
  assert.equal(subjectQuality("평택 아파트 화재 대피 공지").pass, true,
    "장소와 사건이 드러난 실제 안전 공지까지 막으면 안 된다");
  assert.equal(subjectQuality("반도체 공급망 투자 확대").pass, true);

  const metricOnly = assessEditorialDraft({
    headline: "더쿠 · 추천 3.4만건",
    paragraph: "반도체 공급망 투자 확대가 더쿠 상위에 올라 추천을 받았다.",
    subject: "반도체 공급망 투자 확대",
    evidence: { mode: "single_feed_observed" },
    sourceLabels: ["더쿠"]
  });
  assert.equal(metricOnly.state, "machine_gate_hold", "주제가 빠진 지표 전용 헤드라인을 발행하면 안 된다");
});

test("편집 문장: 번역되지 않은 영문 원제목은 한국어 오늘판 후보에서 보류한다", () => {
  const english = assessEditorialDraft({
    headline: "“Machan - Korail Community Platform / Paraa” · 관련 보도 묶음 포착",
    paragraph: "Phys 상위 목록에 영문 원제목이 올라왔지만 한국어 번역은 확인되지 않았다.",
    subject: "Machan",
    evidence: { mode: "single_feed_observed" },
    sourceLabels: ["Phys.org"],
    categoryItems: [{ kind: "news", category: "science", title: "Machan - Korail Community Platform / Paraa" }],
    requireKoreanAudience: true
  });
  assert.equal(english.pass, false);
  assert.ok(english.failures.includes("koreanAudienceReadable"));

  const korean = assessEditorialDraft({
    headline: "날씨 예측의 이론적 한계가 129일이라는 연구 결과",
    paragraph: "Phys.org가 날씨 예측 기간의 이론적 한계를 분석한 연구 결과를 보도했다.",
    subject: "날씨 예측의 이론적 한계가 129일이라는 연구 결과",
    evidence: { mode: "single_feed_observed" },
    sourceLabels: ["Phys.org"],
    categoryItems: [{ kind: "news", category: "science", title: "날씨 예측의 이론적 한계가 129일이라는 연구 결과" }],
    requireKoreanAudience: true
  });
  assert.equal(korean.pass, true);
});

test("편집 분야: 출처 라벨이나 비유 한 단어가 실제 사건 분야를 훔치지 않는다", () => {
  assert.equal(
    categoryGuardReason("realestate", "전세계 7월 극한폭염 이유 있었네...해수면 온도 역대 최고"),
    "climate-without-realestate-subject"
  );
  assert.equal(
    categoryGuardReason("science", "Magnitude 7.4 quake rocks western Colombia, killing at least 111 people"),
    "incident-without-science-subject"
  );
  assert.equal(
    categoryGuardReason("science", "Jackie, the California bald eagle who became an internet sensation, dies after illness"),
    "incident-without-science-subject"
  );
  assert.equal(
    categoryGuardReason("tech", "일손 부족 해결, 팰월드 고대문명 멀티작업 팰 추천"),
    "gaming-without-tech-subject"
  );
  assert.equal(
    categoryGuardReason("tech", "Overwatch Season 4 모든 신규 영웅 스킨 총정리"),
    "gaming-without-tech-subject"
  );
  assert.equal(
    categoryGuardReason("tech", "모바일 서브컬처 신작 실버팰리스 2차 CBT 리뷰"),
    "gaming-without-tech-subject"
  );
  assert.equal(
    categoryGuardReason("auto", "경인고속도로 졸음운전 사고 현장.gif"),
    "incident-without-auto-subject"
  );
  assert.equal(
    categoryGuardReason("culture", "나만 수사 김건희 불만에 박지원 계속 웃기면 드라마"),
    "political-process-without-culture-subject"
  );
  assert.equal(
    categoryGuardReason("science", "연구진이 콜롬비아 강진의 깊은 진원을 분석"),
    null,
    "실제 연구 맥락까지 재난 기사로 오인하면 안 된다"
  );
  assert.equal(
    categoryGuardReason("culture", "대통령 역할 배우가 출연한 드라마 방영 일정 공개"),
    null,
    "정치 단어가 등장한 실제 문화 콘텐츠는 남겨야 한다"
  );
  assert.equal(categoryGuardReason("tech", "AI 게임 엔진 성능 분석"), null);
  assert.equal(categoryGuardReason("auto", "테슬라 교통사고 안전성 분석"), null);
});

test("자체 브리핑: 폭력을 직접 권하는 커뮤니티 제목은 후보에서 제외한다", () => {
  const result = assessEditorialDraft({
    headline: "개독을 때려죽여야하는 이유",
    paragraph: "보배드림 상위 목록에 해당 제목의 커뮤니티 게시물이 올라왔습니다.",
    subject: "개독을 때려죽여야하는 이유",
    evidence: { mode: "single_feed_observed" },
    sourceLabels: ["보배드림"],
    categoryItems: [{
      kind: "community",
      category: "politics",
      title: "개독을 때려죽여야하는 이유"
    }]
  });
  assert.equal(result.pass, false);
  assert.equal(result.checks.communityViolentExhortationAbsent, false);
  assert.ok(result.failures.includes("communityViolentExhortationAbsent"));
});

test("민감한 혈통·매국 주장은 커뮤니티 단독 관측으로 대표 이슈가 되지 않는다", () => {
  const base = {
    headline: "더쿠에서 친일 후손 배우 하영 논쟁이 확산됐다",
    paragraph: "더쿠 상위 목록에서 친일 후손 배우 하영 관련 게시물의 반응이 커지고 있다.",
    subject: "친일 후손 배우 하영 논쟁",
    evidence: { mode: "single_feed_observed" },
    sourceLabels: ["더쿠"]
  };
  const communityOnly = assessEditorialDraft({
    ...base,
    categoryItems: [{ kind: "community", category: "culture", title: base.subject }]
  });
  assert.equal(communityOnly.pass, false);
  assert.ok(communityOnly.failures.includes("sensitiveAllegationSupported"));

  const reported = assessEditorialDraft({
    ...base,
    sourceLabels: ["연합뉴스"],
    categoryItems: [{ kind: "news", category: "culture", title: base.subject }]
  });
  assert.equal(reported.pass, true, "보도 출처까지 있는 같은 주장을 일괄 차단하면 안 된다");
});

test("블라인드 검수 패킷: 현재 판은 동적이고 E1은 규모 미정의 층화 평가 경계다", () => {
  const items = [
    { id: "a", title: "정부 주택 공급 일정 발표", source: "hani", sourceLabel: "한겨레", category: "business", coverage: 5 },
    { id: "b", title: "반도체 신규 공정 투자 계획", source: "et", sourceLabel: "전자신문", category: "tech", score: 120 },
    { id: "c", title: "온라인 유행어 확산 배경", source: "community", sourceLabel: "커뮤니티", category: "humor", commentCount: 180 }
  ];
  const digest = buildDigest(items, { maxIssues: 3 });
  const packet = buildBlindReviewPacket({
    editionId: "2026-08-10-evening-business.tech.humor",
    generatedAt: "2026-08-10T12:00:00.000Z",
    issues: digest.issues.map((issue) => groundedReviewIssue(issue, ["business", "tech", "humor"]))
  });

  assert.equal(packet.contractId, EDITORIAL_QUALITY_CONTRACT.stableId);
  assert.equal(packet.sampleMode, "dynamic_current_edition");
  assert.equal(packet.evaluationBoundary.e1State, "not_frozen");
  assert.equal(packet.evaluationBoundary.e1TargetSize, null);
  assert.deepEqual(packet.evaluationBoundary.e1Strata, ["categoryId", "evidenceMode", "sourceRole", "changeState"]);
  assert.equal(packet.metrics.issueCount, digest.issues.length);
  assert.equal(packet.packetVersion, 5);
  assert.equal(packet.readerContractId, "NOWHOT-EDITORIAL-READER-COPY-CONTRACT-001");
  assert.equal(packet.metrics.canonicalMachinePass, digest.issues.length);
  assert.equal(packet.metrics.readerIssuePass, digest.issues.length);
  assert.equal(packet.metrics.readerPacketPass, true);
  assert.equal(digest.quality.sampleMode, "dynamic_current_edition");
  assert.equal(digest.quality.selectedAfterGate, digest.issues.length);
  assert.equal(digest.quality.machineHold, 0);
  assert.equal(packet.metrics.machineHold, 0);
  assert.ok(packet.rows.every((row) => row.reader && row.readerGate && row.readerGate.pass));
  assert.ok(packet.rows.every((row) => !Object.hasOwn(row, "rank")));
  assert.ok(packet.rows.every((row) => Object.values(row.human).every((value) => value === null)));
});

test("블라인드 검수 패킷: 독자 문안과 그 기계 판정을 불변 식별자에 함께 동결한다", () => {
  const issue = groundedReviewIssue({
    subject: "중동 방공 지원 요청",
    headline: "중동 국가가 방공 체계 지원을 요청했다",
    paragraph: "중동 국가가 미사일 위협 대응을 위해 방공 체계 지원을 공식 요청했다.",
    whyImportant: "지역 안보와 방산 공급 일정에 영향을 줄 수 있다.",
    whyHot: "정부 발표가 확인됐다.",
    categoryIds: ["politics"],
    refs: [{ id: "defense-1", title: "방공 지원 요청", sourceLabel: "연합뉴스" }],
    sourceEvidence: [{
      evidenceId: "e-1",
      title: "방공 지원 요청",
      sourceId: "yna",
      sourceLabel: "연합뉴스",
      sourceRole: "reported_secondary",
      ownershipGroup: "yna",
      canonicalUrl: "https://example.com/defense-1",
      evidenceRole: "lead"
    }],
    editorialGate: { pass: true },
    evidence: { mode: "single_feed_observed" }
  }, ["politics"]);
  const edition = { editionId: "edition-reader-gate", issues: [issue] };
  const first = buildBlindReviewPacket(edition);
  const replay = buildBlindReviewPacket(edition);

  assert.equal(first.packetVersion, 5);
  assert.equal(first.packetId, replay.packetId, "같은 계약·문안·판정은 재실행해도 같은 패킷이어야 한다");
  assert.ok(first.rows[0].readerGate);
  assert.match(first.packetId, /^BRP-/);
});

test("2인 검수 판정: 불일치와 만장일치 부정을 PASS로 숨기지 않는다", () => {
  const packet = { rows: [{ blindId: "BR-1" }, { blindId: "BR-2" }] };
  const yes = (blindId) => ({
    blindId,
    include: true,
    clusterCorrect: true,
    headlineFaithful: true,
    evidenceSufficient: true,
    categoryFit: true
  });
  const reviewerA = [yes("BR-1"), yes("BR-2")];
  const reviewerB = [yes("BR-1"), { ...yes("BR-2"), evidenceSufficient: false }];
  const disagreement = summarizeHumanReview(packet, {
    reviewers: {
      "reviewer-a": { annotations: reviewerA, savedAt: 1 },
      "reviewer-b": { annotations: reviewerB, savedAt: 2 }
    }
  });
  assert.equal(disagreement.state, "human_adjudication_required");
  assert.equal(disagreement.qualityPass, false);
  assert.equal(disagreement.comparisonReady, true);
  assert.deepEqual(disagreement.disagreements, [{ blindId: "BR-2", fields: ["evidenceSufficient"] }]);
  assert.equal(disagreement.adjudication.unresolvedFields, 1);
  assert.equal(disagreement.identityProof, false);

  const adjudicated = summarizeHumanReview(packet, {
    reviewers: {
      "reviewer-a": { annotations: reviewerA, savedAt: 1 },
      "reviewer-b": { annotations: reviewerB, savedAt: 2 }
    },
    adjudication: {
      savedAt: 3,
      resolutions: [{ blindId: "BR-2", field: "evidenceSufficient", value: true, notes: "원문 확인" }]
    }
  });
  assert.equal(adjudicated.state, "human_adjudicated_pass");
  assert.equal(adjudicated.qualityPass, true);
  assert.equal(adjudicated.strictConsensusPass, false);
  assert.equal(adjudicated.adjudication.resolvedFields, 1);
  assert.equal(adjudicated.adjudication.unresolvedFields, 0);

  const unanimous = summarizeHumanReview(packet, {
    reviewers: {
      "reviewer-a": { annotations: reviewerA },
      "reviewer-b": { annotations: reviewerA }
    }
  });
  assert.equal(unanimous.state, "human_quality_pass");
  assert.equal(unanimous.qualityPass, true);
  assert.equal(unanimous.strictConsensusPass, true);
  assert.equal(unanimous.agreement.rate, 100);
});

test("2인 검수 독립성: 두 원장이 끝나기 전에는 부분 일치와 답을 공개하지 않는다", () => {
  const packet = { rows: [{ blindId: "BR-1" }, { blindId: "BR-2" }] };
  const answer = (blindId, include = true) => ({
    blindId,
    include,
    clusterCorrect: true,
    headlineFaithful: true,
    evidenceSufficient: true,
    categoryFit: true
  });
  const partial = summarizeHumanReview(packet, {
    reviewers: {
      "reviewer-a": { annotations: [answer("BR-1"), answer("BR-2")] },
      "reviewer-b": { annotations: [answer("BR-1", false)] }
    }
  });

  assert.equal(partial.state, "human_annotation_in_progress");
  assert.equal(partial.comparisonReady, false);
  assert.equal(partial.agreement.rate, null);
  assert.deepEqual(partial.disagreements, []);
  assert.deepEqual(partial.adjudication.rows, []);
});

test("사람 검수 상태: 독자 문장 기계 HOLD를 human ready로 덮어쓰지 않는다", () => {
  const summary = summarizeHumanReview({
    state: "reader_copy_hold",
    rows: [{ blindId: "BR-1" }]
  }, null);
  assert.equal(summary.machineReady, false);
  assert.equal(summary.state, "human_annotation_ready");
  assert.equal(summary.overallState, "reader_copy_hold");
  assert.equal(summary.qualityPass, false);
});

test("사람 검수 보호: 완료 행이 0이어도 저장된 메모·빈 초안·조정 원장은 작업으로 본다", () => {
  assert.equal(hasHumanReviewWork(null), false);
  assert.equal(hasHumanReviewWork({ reviewers: {} }), false);
  assert.equal(hasHumanReviewWork({
    reviewers: { "reviewer-a": { annotations: [], savedAt: 1 } }
  }), true);
  assert.equal(hasHumanReviewWork({
    reviewers: { "reviewer-a": { annotations: [{ blindId: "BR-1", notes: "확인 중" }] } }
  }), true);
  assert.equal(hasHumanReviewWork({
    adjudication: { resolutions: [] }
  }), true);
});
