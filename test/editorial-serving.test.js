import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildDigest } from "../src/feed/digest.js";
import { JsonSource } from "../src/feed/content.js";
import { attachEditorialFulfillment } from "../src/feed/editorial-fulfillment.js";
import { attachEditorialLineage } from "../src/feed/editorial-lineage.js";
import { buildBlindReviewPacket } from "../src/feed/editorial-quality.js";
import {
  EDITORIAL_SERVING_CONTRACT,
  assessEditorialServeability,
  omitHeldEditorialIssues,
  sameEditorialCategorySet
} from "../src/feed/editorial-serving.js";
import { FeedStore } from "../src/feed/store.js";
import { createServer } from "../src/feed/server.js";
import { ARTICLE_SUMMARY_CONTRACT, articleContentId } from "../src/feed/article-summary.js";

function runtimeSources() {
  const subjects = [
    "호르무즈 해협 통항 협상 재개",
    "산업단지 공장 투자 착공 일정",
    "S&P 500 목표치 상향 발표",
    "보유세 과세 기준 개편 발표",
    "원달러 환율 변동 대응 방안",
    "반도체 수출 전망 공식 발표",
    "국제유가 공급 계획 조정",
    "기준금리 결정 회의 결과",
    "전기요금 연료비 조정안",
    "중소기업 정책금융 확대",
    "항만 물동량 월간 통계",
    "온라인 유통 매출 동향",
    "고용보험 가입자 통계",
    "기업 설비투자 계획 공개",
    "조선업 수주 잔고 분기 집계",
    "배터리 원재료 장기 공급 계약",
    "항공화물 운임 지수 발표",
    "농산물 도매가격 안정 대책",
    "벤처투자 신규 결성액 통계",
    "통신사 망 투자 로드맵 공개",
    "철강 생산설비 정비 일정",
    "바이오 의약품 수출 허가 획득",
    "관광객 카드 사용액 월간 분석",
    "가계대출 관리 방안 확정",
    "공공조달 납품단가 조정",
    "해운사 친환경 선박 발주",
    "식품 원재료 구매 계약 체결",
    "클라우드 데이터센터 증설",
    "보험사 지급여력비율 공시",
    "면세점 임대료 산정 기준 변경"
  ];
  return subjects.map((subject, index) => new JsonSource(`serving-source-${index}`, async () => [{
    id: `serving-item-${index}`,
    title: subject,
    url: `https://serving-${index}.example.com/article`,
    category: "business",
    sourceLabel: `검증 매체 ${index + 1}`,
    score: 120 - index,
    commentCount: 24 - index,
    coverage: 1,
    publishedAt: "2026-08-11T06:40:00+09:00"
  }], "news"));
}

function combinationRuntimeSources() {
  const techSubjects = [
    "운영체제 보안 취약점 긴급 패치 배포",
    "클라우드 데이터베이스 장애 복구 완료",
    "인공지능 반도체 신제품 성능 공개",
    "오픈소스 웹 프레임워크 새 버전 출시",
    "모바일 운영체제 개인정보 보호 기능 추가",
    "양자컴퓨터 오류 보정 기술 실험 결과",
    "데이터센터 냉각 장치 전력 효율 개선",
    "그래픽처리장치 드라이버 안정화 업데이트",
    "생성형 인공지능 모델 기업용 기능 공개",
    "위성 인터넷 국내 서비스 시험 일정",
    "반도체 미세공정 장비 공급 계약 체결",
    "자율주행 소프트웨어 안전 검증 결과",
    "암호화 통신 표준 전환 일정 확정",
    "로봇 운영 소프트웨어 개발 도구 공개",
    "검색엔진 광고 추적 방지 기능 확대",
    "스마트폰 배터리 관리 알고리즘 개선",
    "컴퓨터 비전 의료영상 판독 연구 발표",
    "기업용 협업 도구 접근권한 기능 개편",
    "해저 통신망 증설 공사 일정 발표",
    "메모리 반도체 생산공정 수율 개선",
    "전자문서 인증서 발급 체계 개편",
    "가상현실 헤드셋 개발자 도구 업데이트",
    "온라인 결제 인증 장애 원인 분석 공개",
    "무선 통신 기지국 소프트웨어 교체",
    "개발자 코드 저장소 보안 점검 강화",
    "인공지능 학습 데이터 공개 기준 발표",
    "스마트홈 기기 공통 연결 규격 확대",
    "차세대 디스플레이 시제품 양산 일정",
    "서버용 중앙처리장치 전력 효율 공개",
    "브라우저 확장프로그램 권한 정책 변경"
  ];
  return [
    ...runtimeSources(),
    ...techSubjects.map((subject, index) => new JsonSource(`tech-serving-source-${index}`, async () => [{
      id: `tech-serving-item-${index}`,
      title: subject,
      url: `https://tech-serving-${index}.example.com/article`,
      category: "tech",
      sourceLabel: `기술 검증 매체 ${index + 1}`,
      score: 220 - index,
      commentCount: 34 - index,
      coverage: 1,
      publishedAt: "2026-08-11T06:40:00+09:00"
    }], "news"))
  ];
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function serveableEdition() {
  const items = [
    { id: "a", title: "정부 주택 공급 일정 발표", source: "hani", sourceLabel: "한겨레", category: "business", coverage: 5 },
    { id: "b", title: "반도체 신규 공정 투자 계획", source: "et", sourceLabel: "전자신문", category: "tech", score: 120 },
    { id: "c", title: "온라인 유행어 확산 배경", source: "community", sourceLabel: "커뮤니티", category: "humor", commentCount: 180 }
  ];
  const digest = buildDigest(items, {
    maxIssues: 3,
    selectedCategories: ["business", "tech", "humor"],
    minIssuesPerCategory: 1
  });
  return attachEditorialFulfillment({
    editionId: "2026-08-11-morning-business.humor.tech",
    generatedAt: "2026-08-10T22:00:00.000Z",
    publishable: true,
    issues: digest.issues.map((issue) => ({
      ...attachEditorialLineage({
        ...issue,
        whatHappened: issue.paragraph,
        whyImportant: `${issue.subject}의 후속 사실과 영향을 판단하려면 공식 자료를 함께 확인할 가치가 있다.`,
        whyHot: "현재 수집 목록의 상위 후보로 확인됐다.",
        whyForYou: "선택한 관심 분야의 오늘판이라 포함했다.",
        watchNext: "공식 자료와 후속 보도를 확인한다.",
        impactLens: "테스트 편집 정책"
      }, { selectedCategories: ["business", "tech", "humor"] }),
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
    })),
    selection: {
      categories: ["business", "tech", "humor"].map((id) => ({ id })),
      minIssuesPerCategory: 1
    },
    candidateContract: {
      metrics: { categoryCandidateCounts: { business: 1, tech: 1, humor: 1 } }
    },
    editorialQuality: digest.quality
  });
}

function preparedSummary(issue, {
  status = "ready",
  textKo = "공개 기사 원문에서 확인한 핵심 사실과 진행 상황을 한국어로 충분히 정리한 검증 요약입니다.",
  reason = null,
  generatedAt = "2026-08-11T03:05:00.000Z"
} = {}) {
  const sources = issue.sourceEvidence || issue.eventSources || issue.refs || [];
  const source = sources[0] || {};
  const preparedText = `${textKo} `.repeat(Math.max(1, Math.ceil(180 / Math.max(1, textKo.length)))).trim();
  return {
    status,
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(issue),
    eventSourceSetId: issue.eventSourceSetId || null,
    textKo: status === "ready" ? preparedText : null,
    sourceEvidenceId: source.evidenceId || null,
    sourceLabel: source.sourceLabel || null,
    sourceCount: sources.length,
    image: null,
    unavailableReasonCode: status === "ready" ? null : reason || "SOURCE_TEMPORARILY_UNAVAILABLE",
    generatedAt,
    ...(status === "source_unavailable" ? {
      retryAfter: "2026-08-11T03:35:00.000Z"
    } : {})
  };
}

test("제공 가능 계약: 실제 응답의 기계·독자 문장·다양성·분야 충족을 함께 통과시킨다", () => {
  const assessment = assessEditorialServeability(serveableEdition());

  assert.equal(assessment.contractId, EDITORIAL_SERVING_CONTRACT.stableId);
  assert.equal(assessment.pass, true, JSON.stringify(assessment.failures));
  assert.equal(assessment.state, "serveable_machine_verified");
  assert.equal(assessment.failures.length, 0);
  assert.match(assessment.packetId, /^BRP-/);
  assert.equal(assessment.metrics.issueCount, 3);
  assert.equal(assessment.metrics.readerIssuePass, 3);
  assert.equal(assessment.fulfillment.goalSatisfied, true);
  assert.equal(EDITORIAL_SERVING_CONTRACT.humanReviewRequired, false);
});

test("제공 가능 계약: 같은 정본 사건 카드가 두 번 있으면 마지막 관문에서 차단한다", () => {
  const duplicate = structuredClone(serveableEdition());
  duplicate.issues[0].eventSourceSetId = "EV-shared:publisher-a|publisher-b";
  duplicate.issues[1].eventSourceSetId = duplicate.issues[0].eventSourceSetId;

  const assessment = assessEditorialServeability(duplicate);
  assert.equal(assessment.pass, false);
  assert.ok(assessment.failures.includes("duplicate_event_hold"));
});

test("제공 가능 계약: eventSourceSetId가 없어도 같은 정본 eventId 중복을 차단한다", () => {
  const duplicate = structuredClone(serveableEdition());
  duplicate.issues[0].eventSourceSetId = null;
  duplicate.issues[1].eventSourceSetId = null;
  duplicate.issues[0].event = { eventId: "EV-canonical-shared" };
  duplicate.issues[1].event = { eventId: "EV-canonical-shared" };

  const assessment = assessEditorialServeability(duplicate);
  assert.equal(assessment.pass, false);
  assert.ok(assessment.failures.includes("duplicate_event_hold"));
});

test("제공 가능 계약: 별개 사건은 보조 기사 하나를 공유해도 중복으로 차단하지 않는다", () => {
  const edition = structuredClone(serveableEdition());
  edition.issues[0].event = { eventId: "EV-distinct-a" };
  edition.issues[1].event = { eventId: "EV-distinct-b" };
  edition.issues[0].eventSourceSetId = null;
  edition.issues[1].eventSourceSetId = null;
  edition.issues[0].clusterId = null;
  edition.issues[1].clusterId = null;
  edition.issues[0].refs = [{ id: "shared-support", canonicalUrl: "https://example.com/support" }];
  edition.issues[1].refs = [{ id: "shared-support", canonicalUrl: "https://example.com/support" }];

  const assessment = assessEditorialServeability(edition);
  assert.equal(assessment.failures.includes("duplicate_event_hold"), false);
});

test("제공 가능 계약: 독자 문장과 분야별 최소 13건 미달을 차단한다", () => {
  const badCopy = structuredClone(serveableEdition());
  badCopy.issues[0].reader = {
    headline: "소식",
    summary: "짧음",
    whyImportant: "중요",
    whyNow: "지금",
    change: "변화",
    confidenceLabel: "확인"
  };
  const copyAssessment = assessEditorialServeability(badCopy);
  assert.equal(copyAssessment.pass, false);
  assert.ok(copyAssessment.failures.includes("reader_copy_hold"));

  const underfilled = structuredClone(serveableEdition());
  underfilled.categoryFulfillment.goalSatisfied = false;
  underfilled.categoryFulfillment.state = "fulfillment_partial";
  const fulfillmentAssessment = assessEditorialServeability(underfilled);
  assert.equal(fulfillmentAssessment.pass, true);

  const productionDepth = structuredClone(underfilled);
  productionDepth.categoryFulfillment.rows = productionDepth.categoryFulfillment.rows.map((row) => ({
    ...row, target: 14, issueCount: 13, state: "underfilled"
  }));
  assert.equal(assessEditorialServeability(productionDepth).pass, true);
  productionDepth.categoryFulfillment.rows[0].issueCount = 12;
  const shallowAssessment = assessEditorialServeability(productionDepth);
  assert.equal(shallowAssessment.pass, false);
  assert.ok(shallowAssessment.failures.includes("category_fulfillment_hold"));

  const emptyCategory = structuredClone(underfilled);
  emptyCategory.categoryFulfillment.rows[0].issueCount = 0;
  const emptyAssessment = assessEditorialServeability(emptyCategory);
  assert.equal(emptyAssessment.pass, false);
  assert.ok(emptyAssessment.failures.includes("category_fulfillment_hold"));
});

test("제공 가능 계약: 문장 보류 한 건만 제외하고 남은 판이 충족되면 제공한다", () => {
  const edition = structuredClone(serveableEdition());
  edition.selection.categories = [{ id: "tech" }];
  edition.candidateContract.metrics.categoryCandidateCounts = { tech: 1 };
  edition.issues[0].reader = {
    headline: "소식", summary: "짧음", whyImportant: "중요",
    whyNow: "지금", change: "변화", confidenceLabel: "확인"
  };

  const projected = omitHeldEditorialIssues(attachEditorialFulfillment(edition));
  const assessment = assessEditorialServeability(projected);

  assert.equal(projected.issues.length, 2);
  assert.equal(projected.servingProjection.heldIssueCount, 1);
  assert.equal(assessment.pass, true);
});

test("제공 가능 계약: 실제 다중 분야 이슈는 두 분야를 채우되 화면에는 한 번만 둔다", () => {
  const overcredited = structuredClone(serveableEdition());
  overcredited.selection.categories = [{ id: "business" }, { id: "tech" }];
  overcredited.issues = [
    {
      ...overcredited.issues[0],
      categoryIds: ["business", "tech"]
    },
    {
      ...overcredited.issues[1],
      categoryIds: ["tech"]
    }
  ];
  overcredited.candidateContract.metrics.categoryCandidateCounts = { business: 1, tech: 1 };

  const refreshed = attachEditorialFulfillment(overcredited);
  const assessment = assessEditorialServeability(refreshed);

  assert.equal(refreshed.categoryFulfillment.goalSatisfied, true);
  assert.equal(refreshed.categoryFulfillment.uniqueCreditedIssueCount, 2);
  assert.equal(refreshed.categoryFulfillment.multiCategoryIssueCount, 1);
  assert.equal(refreshed.categoryFulfillment.metCount, 2);
  assert.deepEqual(
    Object.fromEntries(refreshed.categoryFulfillment.rows.map((row) => [row.categoryId, row.issueCount])),
    { business: 1, tech: 2 }
  );
  assert.equal(refreshed.issues.length, 2);
  assert.equal(assessment.failures.includes("category_fulfillment_hold"), false);
});

test("제공 가능 계약: 분야 조합은 순서와 무관하지만 하나라도 다르면 이전판 대체가 아니다", () => {
  assert.equal(sameEditorialCategorySet(["tech", "business"], ["business", "tech"]), true);
  assert.equal(sameEditorialCategorySet(["business"], ["business", "tech"]), false);
  assert.equal(sameEditorialCategorySet(["business", "business"], ["business"]), true);
});

test("제공 검증 영수증: 같은 응답 지문은 덮어쓰지 않고 재시작 뒤에도 남는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-serving-verification-"));
  const file = path.join(dir, "feed.json");
  try {
    const store = new FeedStore({ file, clock: () => "2026-08-11T03:05:00.000Z" });
    const receipt = {
      contractId: EDITORIAL_SERVING_CONTRACT.stableId,
      contractVersion: EDITORIAL_SERVING_CONTRACT.version,
      packetId: "BRP-response-1",
      editionId: "edition-1",
      date: "2026-08-11",
      slotId: "lunch",
      slotAsOf: "2026-08-11T03:00:00.000Z",
      segmentKey: "v13:business.tech",
      categories: ["business", "tech"],
      verifiedAt: "2026-08-11T03:05:00.000Z"
    };
    const first = store.saveEditorialServingVerification(receipt);
    const replay = store.saveEditorialServingVerification({
      ...receipt,
      verifiedAt: "2026-08-11T04:05:00.000Z"
    });
    assert.equal(replay.verifiedAt, first.verifiedAt);

    const reopened = new FeedStore({ file });
    assert.deepEqual(reopened.listEditorialServingVerifications("v13:business.tech"), [first]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 현재 응답이 분야 충족에 실패하면 빈 성공 대신 409로 닫는다", async () => {
  const sparse = runtimeSources().slice(0, 2);
  const server = createServer({
    sources: sparse,
    localEditorial: true,
    clock: () => "2026-08-11T12:05:00+09:00",
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/today?categories=business&slot=lunch`);
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.code, "EDITORIAL_EDITION_NOT_SERVEABLE");
    assert.equal(body.serving.state, "current_machine_hold");
    assert.equal(body.serving.fallback, false);
    assert.ok(body.serving.failures.includes("canonical_publishable_hold"));
    assert.match(body.serving.responsePacketId, /^BRP-/);
    assert.deepEqual(body.serving.selectedCategories, ["business"]);
    assert.ok(body.serving.availableCategories.some((category) => category.id === "business" && category.label));
    const home = await fetch(`${base}/`).then((result) => result.text());
    assert.match(home, /EDITORIAL_EDITION_NOT_SERVEABLE/);
    assert.match(home, /새 브리핑을 검수 중입니다/);
    assert.match(home, /가장 최근 검증판을 보여드립니다/);
    assert.match(home, /selectedCategories/);
    assert.match(home, /검수 중/);
  } finally {
    await close(server);
  }
});

test("오늘판 API: 현재 슬롯 콜드 스타트는 과거를 꾸미지 않고 관측 지연판으로 복구한다", async () => {
  const server = createServer({
    sources: runtimeSources(),
    localEditorial: true,
    clock: () => "2026-08-11T12:05:00+09:00",
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/today?categories=business&slot=lunch`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.serving || body));
    assert.equal(body.serving.state, "current_machine_verified");
    assert.equal(body.editionSegment.slotAsOf, "2026-08-11T03:00:00.000Z");
    assert.equal(body.editionSegment.evidenceAsOf, "2026-08-11T03:05:00.000Z");
    assert.equal(body.editionSegment.delayedRecovery.applied, true);
    assert.equal(body.editionSegment.delayedRecovery.delayedByMs, 5 * 60 * 1000);
    assert.equal(body.editionSegment.delayedRecovery.historicalSlotBackdated, false);

    const historical = await fetch(
      `${base}/api/today?categories=business&slot=lunch&date=2026-08-10`
    );
    const historicalBody = await historical.json();
    assert.equal(historical.status, 409, JSON.stringify(historicalBody));
    assert.equal(historicalBody.code, "EDITORIAL_EDITION_NOT_SERVEABLE");
  } finally {
    await close(server);
  }
});

test("오늘판 API: 먼저 확정된 분야는 고정하고 늦게 처음 연 분야는 실제 증거 시각을 기록한다", async () => {
  let now = "2026-08-11T12:05:00+09:00";
  const server = createServer({
    sources: combinationRuntimeSources(),
    localEditorial: true,
    clock: () => now,
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    const business = await fetch(`${base}/api/today?categories=business&slot=lunch`).then((response) => response.json());
    assert.equal(business.editionSegment.evidenceAsOf, "2026-08-11T03:05:00.000Z");

    now = "2026-08-11T12:10:00+09:00";
    const tech = await fetch(`${base}/api/today?categories=tech&slot=lunch`).then((response) => response.json());
    const combined = await fetch(`${base}/api/today?categories=business,tech&slot=lunch`).then((response) => response.json());
    const businessAgain = await fetch(`${base}/api/today?categories=business&slot=lunch`).then((response) => response.json());
    assert.equal(businessAgain.editionSegment.evidenceAsOf, business.editionSegment.evidenceAsOf);
    assert.equal(tech.editionSegment.evidenceAsOf, "2026-08-11T03:10:00.000Z");
    assert.equal(combined.editionSegment.evidenceAsOf, tech.editionSegment.evidenceAsOf);
    assert.deepEqual(
      businessAgain.issues.map((issue) => issue.evidenceHash),
      business.issues.map((issue) => issue.evidenceHash),
      "늦게 연 분야가 먼저 확정된 분야의 기사 재고를 바꾸면 안 된다"
    );
  } finally {
    await close(server);
  }
});

test("오늘판 API: 복수 분야는 조합별 과거가 달라도 각 단독 분야 확정판의 합집합이다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-independent-category-history-"));
  const probeFile = path.join(dir, "probe.json");
  const file = path.join(dir, "feed.json");
  try {
    const probeServer = createServer({
      file: probeFile,
      sources: combinationRuntimeSources(),
      localEditorial: true,
      clock: () => "2026-08-11T12:05:00+09:00",
      localEditorialInventorySchedule: false
    });
    const probeBase = await listen(probeServer);
    let currentBusiness;
    let currentCombined;
    try {
      currentBusiness = await fetch(`${probeBase}/api/today?categories=business&slot=lunch`).then((response) => response.json());
      currentCombined = await fetch(`${probeBase}/api/today?categories=business,tech&slot=lunch`).then((response) => response.json());
      assert.equal(currentBusiness.issues.length, 14);
      assert.equal(currentCombined.issues.length, 28);
    } finally {
      await close(probeServer);
    }

    const seeded = new FeedStore({ file });
    const asMorning = (edition, issues) => ({
      ...edition,
      editionId: edition.editionId.replace("-lunch-", "-morning-"),
      generatedAt: "2026-08-10T22:05:00.000Z",
      slot: { ...edition.slot, id: "morning" },
      issues,
      editionSegment: {
        ...edition.editionSegment,
        slotAsOf: "2026-08-10T22:00:00.000Z",
        evidenceAsOf: "2026-08-10T22:05:00.000Z"
      }
    });
    seeded.saveEditorialEdition(
      "2026-08-11",
      "morning",
      currentBusiness.editionSegment.key,
      asMorning(currentBusiness, currentBusiness.issues.slice(0, 4))
    );
    seeded.saveEditorialEdition(
      "2026-08-11",
      "morning",
      currentCombined.editionSegment.key,
      asMorning(currentCombined, currentCombined.issues.filter((issue) =>
        !(issue.selectedByCategories || issue.categoryIds || []).includes("business")))
    );

    const lunchServer = createServer({
      file,
      sources: combinationRuntimeSources(),
      localEditorial: true,
      clock: () => "2026-08-11T12:05:00+09:00",
      localEditorialInventorySchedule: false
    });
    const lunchBase = await listen(lunchServer);
    try {
      const combined = await fetch(`${lunchBase}/api/today?categories=business,tech&slot=lunch`).then((response) => response.json());
      const business = await fetch(`${lunchBase}/api/today?categories=business&slot=lunch`).then((response) => response.json());
      assert.ok(Number(business.editionChange?.heldRepeatCount || 0) > 0, JSON.stringify(business.editionChange));
      const businessIds = business.issues.map((issue) => issue.event?.eventId || issue.clusterId || issue.evidenceHash);
      const combinedBusinessIds = combined.issues
        .filter((issue) => (issue.selectedByCategories || issue.categoryIds || []).includes("business"))
        .map((issue) => issue.event?.eventId || issue.clusterId || issue.evidenceHash);
      assert.deepEqual(combinedBusinessIds, businessIds);
      const canonicalPayload = (issue) => ({
        subject: issue.subject,
        headline: issue.headline,
        paragraph: issue.paragraph,
        eventSources: issue.eventSources,
        sourceEvidence: issue.sourceEvidence,
        refs: issue.refs
      });
      const combinedById = new Map(combined.issues.map((issue) => [
        issue.event?.eventId || issue.clusterId || issue.evidenceHash,
        issue
      ]));
      for (const issue of business.issues) {
        const id = issue.event?.eventId || issue.clusterId || issue.evidenceHash;
        assert.deepEqual(canonicalPayload(combinedById.get(id)), canonicalPayload(issue),
          `같은 사건 ${id}의 제목·출처 정본이 선택 조합에 따라 바뀌었다`);
      }
    } finally {
      await close(lunchServer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 저장 단독판이 없는 사용자 GET도 편집 LLM을 호출하지 않는다", async () => {
  let calls = 0;
  const server = createServer({
    sources: combinationRuntimeSources(),
    localEditorial: true,
    localEditorialInventorySchedule: false,
    clock: () => "2026-08-11T12:05:00+09:00",
    localEditorialLlm: async (edition) => {
      calls += 1;
      return edition;
    }
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/today?categories=business&slot=lunch`);
    assert.equal(response.status, 200);
    assert.equal(calls, 0, "사용자 GET이 편집 모델 호출을 시작했다");
  } finally {
    await close(server);
  }
});

test("오늘판 API: 재고 작업이 최종 이슈 요약을 미리 준비하고 사용자 조회는 저장본만 읽는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-article-summary-serving-"));
  const file = path.join(dir, "feed.json");
  const adminToken = "summary-inventory-test";
  let calls = 0;
  const articleSummaryPipeline = async (edition) => {
    calls += 1;
    return {
      ...edition,
      issues: edition.issues.map((issue) => ({
        ...issue,
        articleSummary: preparedSummary(issue, {
          textKo: "재고 준비 중 공개 원문을 확인해 사용자가 누르기 전에 저장한 한국어 요약입니다."
        })
      }))
    };
  };
  try {
    const server = createServer({
      file,
      sources: runtimeSources(),
      localEditorial: true,
      adminToken,
      articleSummaryPipeline,
      clock: () => "2026-08-11T12:05:00+09:00",
      localEditorialInventorySchedule: false
    });
    const base = await listen(server);
    try {
      const firstResponse = await fetch(`${base}/api/today?categories=business&slot=lunch`);
      const first = await firstResponse.json();
      assert.equal(firstResponse.status, 200, JSON.stringify(first.serving || first));
      assert.equal(calls, 0, "사용자 조회가 요약 준비를 시작하면 안 된다");
      assert.ok(first.issues.every((issue) => !issue.articleSummary));

      const inventory = await fetch(`${base}/api/admin/product-blueprint`, {
        headers: { "x-admin-token": adminToken }
      });
      assert.equal(inventory.status, 200);
      assert.ok(calls > 0, "재고 작업이 저장판의 요약을 준비하지 않았다");

      const callsAfterInventory = calls;
      const second = await fetch(`${base}/api/today?categories=business&slot=lunch`).then((response) => response.json());
      assert.ok(second.issues.every((issue) => issue.articleSummary.status === "ready"));
      const summaryResponse = await fetch(`${base}/api/today/summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceHash: second.issues[0].evidenceHash })
      });
      const summary = await summaryResponse.json();
      await fetch(`${base}/api/today?categories=business&slot=lunch`);
      assert.equal(calls, callsAfterInventory, "클릭이나 재조회가 원문·LLM 호출을 다시 만들었다");
      assert.equal(summaryResponse.status, 410);
      assert.equal(summary.code, "ARTICLE_SUMMARY_IN_EDITION");
      const rawStore = fs.readFileSync(file, "utf8");
      assert.match(rawStore, /articleSummaries/);
      assert.doesNotMatch(rawStore, /공개 기사 원문 전체/);
    } finally {
      await close(server);
    }

    const callsBeforeHeld = calls;
    const heldServer = createServer({
      sources: runtimeSources().slice(0, 2),
      localEditorial: true,
      articleSummaryPipeline: async (edition) => { calls += 1; return edition; },
      clock: () => "2026-08-11T12:05:00+09:00",
      localEditorialInventorySchedule: false
    });
    const heldBase = await listen(heldServer);
    try {
      const response = await fetch(`${heldBase}/api/today?categories=business&slot=lunch`);
      assert.equal(response.status, 409);
      assert.equal(calls, callsBeforeHeld, "서빙 보류판이 기사 원문 조회 단계에 진입했다");
    } finally {
      await close(heldServer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 사용자 조회는 기사 요약 모델을 호출하거나 기다리지 않는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-summary-background-only-"));
  const file = path.join(dir, "feed.json");
  let calls = 0;
  let releaseSummary;
  let rejectSummaryCall;
  const pendingSummary = new Promise((resolve) => { releaseSummary = resolve; });
  const summaryCalled = new Promise((_, reject) => { rejectSummaryCall = reject; });
  const server = createServer({
    file,
    sources: runtimeSources(),
    localEditorial: true,
    articleSummaryPipeline: async (edition) => {
      calls += 1;
      rejectSummaryCall(new Error("today response called the summary pipeline"));
      await pendingSummary;
      return edition;
    },
    clock: () => "2026-08-11T12:05:00+09:00",
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    const response = await Promise.race([
      fetch(`${base}/api/today?categories=business&slot=lunch`),
      summaryCalled
    ]);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.serving || body));
    assert.equal(calls, 0);
    assert.ok(body.issues.every((issue) => !issue.articleSummary));
  } finally {
    releaseSummary();
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 이전 계약의 ready 요약은 조회에서 숨기고 백그라운드 준비 대상으로 남긴다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-article-summary-legacy-retry-"));
  const file = path.join(dir, "feed.json");
  const options = {
    file,
    sources: runtimeSources(),
    localEditorial: true,
    clock: () => "2026-08-11T12:05:00+09:00",
    localEditorialInventorySchedule: false
  };

  try {
    const seedServer = createServer(options);
    const seedBase = await listen(seedServer);
    const edition = await fetch(`${seedBase}/api/today?categories=business&slot=lunch`).then((response) => response.json());
    await close(seedServer);

    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    const savedEdition = stored.editorialEditions[edition.editionDate][edition.slot.id][edition.editionSegment.key];
    savedEdition.issues[0].articleSummary = {
      status: "ready",
      textKo: "계약 버전 표식 없이 저장된 예전 요약",
      unavailableReasonCode: null
    };
    fs.writeFileSync(file, JSON.stringify(stored));

    let calls = 0;
    const recoveryServer = createServer({
      ...options,
      articleSummaryPipeline: async (input) => {
        calls += 1;
        return {
          ...input,
          issues: input.issues.map((issue) => ({
            ...issue,
            articleSummary: preparedSummary(issue, {
              textKo: "재시작 뒤 이전 기록을 완료로 오인하지 않고 공개 원문 요약을 다시 생성했습니다.",
              generatedAt: "2026-08-11T03:05:00.000Z"
            })
          }))
        };
      }
    });
    const recoveryBase = await listen(recoveryServer);
    try {
      const response = await fetch(`${recoveryBase}/api/today?categories=business&slot=lunch`);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body.serving || body));
      assert.equal(body.issues[0].articleSummary, undefined);
      assert.equal(calls, 0, "사용자 조회가 구형 요약의 원문·LLM 재호출을 시작했다");
    } finally {
      await close(recoveryServer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 부분 수집 보류판은 고정하지 않고 다음 수집의 정상판으로 회복한다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-partial-recovery-"));
  const file = path.join(dir, "feed.json");
  const clock = () => "2026-08-11T12:05:00+09:00";
  try {
    const partialServer = createServer({
      file,
      sources: runtimeSources().slice(0, 2),
      localEditorial: true,
      clock,
      localEditorialInventorySchedule: false
    });
    const partialBase = await listen(partialServer);
    try {
      const partial = await fetch(`${partialBase}/api/today?categories=business&slot=lunch`);
      assert.equal(partial.status, 409);
    } finally {
      await close(partialServer);
    }

    const afterHold = new FeedStore({ file });
    assert.equal(
      afterHold.getEditorialEdition("2026-08-11", "lunch", "v30:business"),
      null,
      "미통과 현재판을 저장하면 다음 수집도 첫 판에 묶인다"
    );
    afterHold.saveEditorialEdition("2026-08-11", "lunch", "v19:business", {
      editionId: "legacy-held-v19",
      publishable: false,
      issues: [],
      editionSegment: {
        key: "v19:business",
        baseKey: "business",
        snapshotVersion: "v19"
      }
    });

    const recoveredServer = createServer({
      file,
      sources: runtimeSources(),
      localEditorial: true,
      clock,
      localEditorialInventorySchedule: false
    });
    const recoveredBase = await listen(recoveredServer);
    try {
      let recovered;
      let body;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        recovered = await fetch(`${recoveredBase}/api/today?categories=business&slot=lunch`);
        body = await recovered.json();
        if (recovered.status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(recovered.status, 200, JSON.stringify(body.serving || body));
      assert.equal(body.serving.state, "current_machine_verified");
      assert.equal(body.editionSegment.delayedRecovery.applied, true);
      const afterRecovery = new FeedStore({ file });
      assert.equal(
        afterRecovery.getEditorialEdition("2026-08-11", "lunch", "v19:business").editionId,
        "legacy-held-v19",
        "구버전 보류 증거는 덮어쓰지 않는다"
      );
      assert.ok(
        afterRecovery.getEditorialEdition("2026-08-11", "lunch", "v30:business"),
        "현재 계약은 새 키에 검증판을 저장해야 한다"
      );
    } finally {
      await close(recoveredServer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 같은 분야의 24시간 이내 검증판만 반복 보류 현재판을 대신한다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-serving-fallback-"));
  const file = path.join(dir, "feed.json");
  let now = "2026-08-11T06:35:00+09:00";
  const server = createServer({
    file,
    sources: runtimeSources(),
    localEditorial: true,
    clock: () => now,
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    await fetch(`${base}/communities`);
    now = "2026-08-11T07:05:00+09:00";
    const morningResponse = await fetch(`${base}/api/today?categories=business&slot=morning`);
    const morning = await morningResponse.json();
    assert.equal(morningResponse.status, 200, JSON.stringify(morning.serving));
    assert.equal(morning.serving.state, "current_machine_verified");

    now = "2026-08-11T12:05:00+09:00";
    const lunchResponse = await fetch(`${base}/api/today?categories=business&slot=lunch`);
    const lunch = await lunchResponse.json();
    assert.equal(lunchResponse.status, 200, JSON.stringify(lunch.serving));
    assert.equal(lunch.serving.state, "fallback_machine_verified");
    assert.equal(lunch.serving.fallback, true);
    assert.equal(lunch.serving.requestedSlotId, "lunch");
    assert.equal(lunch.serving.servedSlotId, "morning");
    assert.equal(lunch.serving.ageMs, 5 * 60 * 60 * 1000);
    assert.equal(lunch.serving.responsePacketId, buildBlindReviewPacket(lunch).packetId);
    assert.ok(lunch.serving.currentHold.failures.length > 0);
  } finally {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 이전 검증 영수증 지문이 달라지면 같은 판본도 대체 제공하지 않는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-serving-tamper-"));
  const file = path.join(dir, "feed.json");
  let morningNow = "2026-08-11T06:35:00+09:00";
  const morningServer = createServer({
    file,
    sources: runtimeSources(),
    localEditorial: true,
    clock: () => morningNow,
    localEditorialInventorySchedule: false
  });
  const morningBase = await listen(morningServer);
  try {
    await fetch(`${morningBase}/communities`);
    morningNow = "2026-08-11T07:05:00+09:00";
    const response = await fetch(`${morningBase}/api/today?categories=business&slot=morning`);
    assert.equal(response.status, 200);
  } finally {
    await close(morningServer);
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    const receipt = Object.values(persisted.editorialServingVerifications)[0];
    receipt.packetId = "BRP-tampered";
    fs.writeFileSync(file, JSON.stringify(persisted));

    const lunchServer = createServer({
      file,
      sources: runtimeSources(),
      localEditorial: true,
      clock: () => "2026-08-11T12:05:00+09:00",
      localEditorialInventorySchedule: false
    });
    const lunchBase = await listen(lunchServer);
    try {
      const response = await fetch(`${lunchBase}/api/today?categories=business&slot=lunch`);
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.code, "EDITORIAL_EDITION_NOT_SERVEABLE");
      assert.equal(body.serving.fallback, false);
    } finally {
      await close(lunchServer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판 API: 일부 분야판만 저장된 조합은 누락 분야를 현재 시각으로 보충한다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-missing-lane-recovery-"));
  const file = path.join(dir, "feed.json");
  let now = "2026-08-11T12:05:00+09:00";
  let lateTechAvailable = false;
  const techSubjects = [
    "운영체제 보안 취약점 긴급 패치 배포",
    "클라우드 데이터베이스 장애 복구 완료",
    "인공지능 반도체 신제품 성능 공개",
    "오픈소스 웹 프레임워크 새 버전 출시",
    "모바일 운영체제 개인정보 보호 기능 추가",
    "양자컴퓨터 오류 보정 기술 실험 결과",
    "데이터센터 냉각 장치 전력 효율 개선",
    "그래픽처리장치 드라이버 안정화 업데이트",
    "생성형 인공지능 모델 기업용 기능 공개",
    "위성 인터넷 국내 서비스 시험 일정",
    "반도체 미세공정 장비 공급 계약 체결",
    "자율주행 소프트웨어 안전 검증 결과",
    "암호화 통신 표준 전환 일정 확정",
    "로봇 운영 소프트웨어 개발 도구 공개",
    "검색엔진 광고 추적 방지 기능 확대",
    "스마트폰 배터리 관리 알고리즘 개선"
  ];
  const sources = [
    ...runtimeSources(),
    ...techSubjects.map((subject, index) => new JsonSource(`late-tech-${index}`, async () => lateTechAvailable ? [{
      id: `late-tech-item-${index}`,
      title: subject,
      url: `https://late-tech-${index}.example.com/article`,
      category: "tech",
      sourceLabel: `기술 매체 ${index}`,
      score: 300 - index,
      publishedAt: "2026-08-11T12:20:00+09:00"
    }] : [], "news"))
  ];
  const server = createServer({
    file,
    sources,
    localEditorial: true,
    clock: () => now,
    localEditorialInventorySchedule: false
  });
  const base = await listen(server);
  try {
    const businessResponse = await fetch(`${base}/api/today?categories=business&slot=lunch`);
    const business = await businessResponse.json();
    assert.equal(businessResponse.status, 200, JSON.stringify(business.serving || business));
    assert.equal(business.issues.length, 14);

    lateTechAvailable = true;
    now = "2026-08-11T12:25:00+09:00";
    const combinedResponse = await fetch(`${base}/api/today?categories=business,tech&slot=lunch`);
    const combined = await combinedResponse.json();
    assert.equal(combinedResponse.status, 200, JSON.stringify(combined.serving || combined));
    assert.equal(combined.issues.length, 28, JSON.stringify({
      requestedCategories: combined.requestedCategories,
      servedCategories: combined.servedCategories,
      withheldCategories: combined.withheldCategories,
      fulfillment: combined.categoryFulfillment,
      issueCategories: combined.issues.map((issue) => issue.selectedByCategories || issue.categoryIds)
    }));
    assert.equal(combined.issues.filter((issue) =>
      (issue.selectedByCategories || issue.categoryIds || []).includes("business")).length, 14);
    assert.equal(combined.issues.filter((issue) =>
      (issue.selectedByCategories || issue.categoryIds || []).includes("tech")).length, 14);
  } finally {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
