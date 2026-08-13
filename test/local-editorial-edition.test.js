import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalContentUrl } from "../src/feed/dedupe.js";
import { applyEditionChanges } from "../src/feed/edition-change.js";
import {
  EDITION_CANDIDATE_CONTRACT,
  buildEditionCandidateFixture,
  candidateFixtureReceipt
} from "../src/feed/edition-candidates.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";
import { buildBlindReviewPacket } from "../src/feed/editorial-quality.js";
import { CATEGORIES as TAXONOMY_CATEGORIES } from "../src/feed/taxonomy.js";

const CATEGORIES = ["business", "politics", "tech", "humor"];
const SUBJECTS = [
  "기준금리 전망", "원달러 환율 흐름", "반도체 공급 변화", "고용 지표 발표",
  "주택 거래 동향", "플랫폼 규제 논의", "인공지능 모델 공개", "보안 취약점 대응",
  "총선 공약 비교", "예산안 처리 과정", "무역 협상 결과", "기업 실적 발표",
  "유통 소비 변화", "전기차 판매 추이", "클라우드 가격 개편", "개발 도구 업데이트",
  "온라인 밈 확산", "방송 장면 화제", "스포츠 팬 반응", "게임 패치 평가",
  "과학 연구 결과", "신제품 사용 후기", "콘텐츠 흥행 기록", "커뮤니티 토론 쟁점",
  "물가 전망 수정", "산업 투자 계획", "정책 시행 일정", "서비스 장애 복구",
  "해외 시장 반응", "국내 이용자 변화"
];
const SERVEABLE_SUBJECTS = [
  "호르무즈 해협 통항 협상", "서부 지역 강진 구조 상황", "전국 폭염 경보 확대",
  "개표 오류 재검표 일정", "전월세 공급 대책 발표", "보유세 과세 기준 개편",
  "취업 비자 취소 절차", "이주민 귀환 지원 계획", "북극항로 시험 운항 일정",
  "산업단지 공장 투자 착공", "의료 행정처분 법원 판단", "S&P 500 목표치 상향",
  "방공 체계 지원 요청", "북한군 추가 배치 확인", "정유시설 미사일 공격 피해"
];

function fixtureItems(count = 121) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `fixture-${index}`,
    title: `${SUBJECTS[index % SUBJECTS.length]} ${Math.floor(index / SUBJECTS.length) + 1}차 관측`,
    url: `https://source.example.com/article?id=${index}&utm_source=fixture`,
    category: CATEGORIES[index % CATEGORIES.length],
    source: `source-${index % 12}`,
    sourceLabel: `표본 출처 ${index % 12}`,
    kind: index % 5 === 0 ? "community" : "news",
    score: 300 - index,
    commentCount: index % 17,
    coverage: index % 4,
    publishedAt: new Date(Date.now() - index * 1000).toISOString()
  }));
  rows.splice(1, 0, {
    ...rows[0],
    id: "fixture-duplicate",
    url: "https://source.example.com/article?utm_medium=social&id=0"
  });
  return rows;
}

function editorialSources(baseMs = Date.now(), spacingMs = 60_000, subjects = SUBJECTS, sourceCount = 8) {
  return Array.from({ length: sourceCount }, (_, sourceIndex) => {
    const category = CATEGORIES[sourceIndex % CATEGORIES.length];
    return new JsonSource(`editorial-${sourceIndex}`, async () =>
      Array.from({ length: 15 }, (_, itemIndex) => {
        const subject = subjects[(sourceIndex * 7 + itemIndex) % subjects.length];
        return {
          id: `editorial-${sourceIndex}-${itemIndex}`,
          title: `${subject}: ${sourceIndex + 1}번 출처의 새 관측 ${itemIndex + 1}`,
          url: `https://editorial-${sourceIndex}.example.com/${itemIndex}`,
          category,
          score: 500 - sourceIndex * 20 - itemIndex,
          commentCount: 60 - itemIndex,
          coverage: itemIndex % 3 === 0 ? 3 : 1,
          publishedAt: new Date(baseMs - itemIndex * spacingMs).toISOString()
        };
      }), "news");
  });
}

function allCategoryEditorialSources(baseMs) {
  const subjects = [...SUBJECTS, ...SERVEABLE_SUBJECTS];
  const sourcesByCategory = {
    news: ["gasengi", "newswire", "gnews"],
    tech: ["clien", "hackernews", "geeknews"],
    auto: ["bobae", "getcha", "encar"],
    science: ["sciencedaily", "physorg", "review-science"],
    business: ["marketpost", "mk-news", "hankyung"],
    gaming: ["ruliweb", "gamemeca", "inven"],
    sports: ["mlbpark", "sportsline", "gnews-sports"],
    culture: ["instiz", "theqoo", "entnews"],
    life: ["82cook", "damoang", "gnews-science"],
    humor: ["humoruniv", "fmkorea", "todayhumor"],
    politics: ["review-politics-a", "review-politics-b", "review-politics-c"],
    realestate: ["mk-realestate", "hankyung-realestate", "ppomppu-house"],
    fashion: ["hypebeast-fashion", "sneakernews", "fashionista"],
    art: ["designboom", "hyperallergic", "archdaily", "creativeboom"]
  };
  const politicsSubjects = [
    "국회 예산안 본회의 표결 일정 확정",
    "정부 개각 후보자 인사청문회 개최",
    "지방선거 선거구 획정안 의결"
  ];
  return TAXONOMY_CATEGORIES.flatMap((category, categoryIndex) =>
    Array.from({ length: category.id === "art" ? 4 : 3 }, (_, sourceIndex) => {
      const subject = category.id === "politics"
        ? politicsSubjects[sourceIndex]
        : category.id === "science" && sourceIndex === 2
          ? "국립천문대 외계행성 대기 성분 관측 결과"
          : subjects[categoryIndex * 3 + sourceIndex];
      const sourceId = sourcesByCategory[category.id][sourceIndex];
      return new JsonSource(`review-${category.id}-${sourceIndex}`, async () => [{
        id: `review-${category.id}-${sourceIndex}`,
        title: subject,
        url: `https://review-${category.id}-${sourceIndex}.example.com/article`,
        source: sourceId,
        category: category.id,
        score: 900 - categoryIndex * 20 - sourceIndex,
        commentCount: 80 - sourceIndex,
        coverage: 3,
        publishedAt: new Date(baseMs - sourceIndex * 60_000).toISOString()
      }], "news");
    })
  );
}

function snapshotEngine(items) {
  const store = new FeedStore();
  const sources = [
    { id: "sciencedaily", kind: "news" },
    { id: "physorg", kind: "news" },
    { id: "ruliweb", kind: "community" }
  ];
  const engine = new FeedEngine(store, sources);
  engine._cache = items.map((item) => ({ ...item }));
  engine._pool = new Map(items.map((item) => [item.id, {
    item: { ...item },
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.firstSeenAt,
    heatHist: []
  }]));
  return engine;
}

test("동적 후보 계약: 추적값만 제거하고 식별 쿼리·다양성·한계를 보존한다", () => {
  assert.equal(
    canonicalContentUrl("https://board.example.com/zboard.php?utm_source=x&no=7&id=free"),
    "https://board.example.com/zboard.php?id=free&no=7"
  );
  assert.notEqual(
    canonicalContentUrl("https://board.example.com/zboard.php?id=free&no=7"),
    canonicalContentUrl("https://board.example.com/zboard.php?id=free&no=8")
  );

  const registry = Array.from({ length: 12 }, (_, index) => ({
    id: `source-${index}`,
    sourceRole: index % 2 ? "reported_secondary" : "community_signal",
    ownershipGroup: `group-${Math.floor(index / 2)}`,
    marketPolicyDesk: index < 4 ? "market" : null
  }));
  const fixture = buildEditionCandidateFixture(fixtureItems(), {
    registry,
    selectedCategories: CATEGORIES,
    limit: 37
  });
  assert.equal(fixture.contractId, EDITION_CANDIDATE_CONTRACT.stableId);
  assert.equal(fixture.state, "machine_observation_ready");
  assert.equal(fixture.metrics.candidateCount, 37);
  assert.equal(fixture.metrics.candidateCap, 37);
  assert.equal(fixture.metrics.selectedCategoryCoveragePct, 100);
  assert.ok(fixture.metrics.uniqueSourceCount >= 10);
  assert.ok(!("targetCount" in fixture.metrics));
  assert.ok(!("exactTarget" in fixture.metrics));
  assert.equal(fixture.metrics.dropped.duplicateUrl, 1);
  assert.ok(fixture.candidates.every((row) => row.canonicalUrl && row.clusterKey));
  assert.ok(fixture.candidates.every((row) => row.sourceRole !== "unknown"));
  assert.ok(fixture.limits.some((line) => /사람 두 명/.test(line)));

  const receipt = candidateFixtureReceipt(fixture);
  assert.ok(!("candidates" in receipt));
  assert.ok(!("sample" in receipt), "일반 API 영수증에 후보 제목 표본을 싣지 않는다");
  assert.equal(candidateFixtureReceipt(fixture, { sampleSize: 3 }).sample.length, 3);
});

test("동적 후보 계약: 한국어 독자판은 분야 최소 후보에서 읽을 수 있는 항목을 먼저 확보한다", () => {
  const items = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `english-art-${index}`,
      title: `international contemporary architecture exhibition opens in city number ${index}`,
      url: `https://art-${index}.example.com/english`,
      category: "art",
      source: `art-source-${index}`,
      kind: "news",
      score: 100 - index
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `korean-art-${index}`,
      title: `현대미술 전시 ${index + 1}차 개막`,
      url: `https://art-ko-${index}.example.com/article`,
      category: "art",
      source: `art-ko-source-${index}`,
      kind: "news",
      score: 10 - index
    }))
  ];
  const fixture = buildEditionCandidateFixture(items, {
    selectedCategories: ["art"],
    limit: 6,
    preferKoreanAudience: true
  });
  assert.equal(fixture.metrics.koreanAudiencePreference, true);
  assert.equal(fixture.candidates.filter((row) => /[가-힣]/.test(row.title)).length, 2);
});

test("오늘판: 명시적으로 고른 한 분야가 지면을 소유하고 편집 근거가 붙는다", async () => {
  const store = new FeedStore();
  const engine = new FeedEngine(store, editorialSources());
  const edition = await engine.todayEdition({
    categories: ["business"],
    slotId: "midday",
    includeCandidates: true
  });

  assert.deepEqual(edition.selection.categories.map((row) => row.id), ["business"]);
  assert.equal(edition.selection.perCategory, 14);
  assert.equal(edition.selection.maxIssues, 14);
  assert.equal(edition.selection.candidateCap, 112);
  assert.ok(edition.issues.length >= 3);
  assert.ok(edition.sections.every((section) => section.category === "business"));
  assert.ok(edition.issues.every((issue) => issue.categoryIds.every((id) => id === "business")));
  for (const issue of edition.issues) {
    assert.ok(issue.whyImportant && issue.whyHot && issue.whyForYou && issue.watchNext);
    assert.ok(issue.confidence && issue.confidence.code);
    assert.equal(issue.editorialGate.state, "machine_gate_pass");
    assert.ok(issue.evidence && issue.evidence.mode);
  }
  assert.equal(edition.llmCalls, 0);
  assert.equal(edition.candidateContract.contractId, EDITION_CANDIDATE_CONTRACT.stableId);
  assert.equal(edition.candidateContract.metrics.candidateCap, edition.selection.candidateCap);
  assert.ok(edition.candidateFixture.candidates.length > 0);
  assert.ok(edition.editorialQuality.categoryFunnel.length > 0);
  assert.ok(edition.categoryFulfillment.rows.every((row) => row.qualifiedClusterCount != null));

  const publicBriefing = await engine.briefing();
  assert.ok(!("candidateContract" in publicBriefing), "기존 공개 API에는 로컬 계약을 추가하지 않는다");
  assert.ok(!("personalized" in publicBriefing), "기존 공개 API 형태를 보존한다");
});

test("오늘판: 분야별 점수 분포가 달라도 단독 상위 목록을 순위 층으로 섞는다", async () => {
  const now = Date.now();
  const businessSubjects = [
    "코스피 장중 3000선 돌파", "원달러 환율 1300원대 하락",
    "삼성전자 분기 영업이익 증가", "SK하이닉스 HBM 매출 전망 상향",
    "국제유가 배럴당 80달러 돌파", "금값 온스당 최고가 경신",
    "서울 아파트 거래량 전월 대비 증가", "수출액 화학제품 중심 두 자릿수 증가",
    "소비자물가 상승률 2퍼센트 기록", "한국은행 기준금리 동결 결정",
    "미국 연준 금리 인하 시점 전망", "중국 제조업 구매관리자지수 반등",
    "일본 엔화 달러 대비 강세 전환", "유럽중앙은행 성장률 전망 수정"
  ];
  const scienceSubjects = [
    "제임스웹 망원경 외계행성 대기 관측", "화성 탐사선 지하 얼음층 발견",
    "국내 연구진 상온 초전도 후보 검증", "신약 임상시험 종양 감소 효과 확인",
    "알츠하이머 조기진단 혈액검사 개발", "태양 흑점 폭발 지구 자기장 영향 분석",
    "남극 빙하 녹는 속도 관측치 갱신", "양자컴퓨터 오류 보정 기술 성능 개선",
    "핵융합 장치 플라스마 유지시간 연장", "심해 탐사에서 신종 생물 발견",
    "유전자 편집 치료제 희귀질환 효과 확인", "인공위성 우주쓰레기 회피 기동 성공",
    "기후모델 해수면 상승 전망 수정", "공룡 화석 분석 새 이동경로 확인"
  ];
  const business = businessSubjects.map((subject, index) => ({
    id: `union-business-${index}`,
    title: subject,
    url: `https://union-business.example.com/${index}`,
    source: `union-business-source-${index}`,
    category: "business",
    score: 1000 - index * 2,
    commentCount: 0,
    coverage: 1,
    publishedAt: new Date(now - index * 1000).toISOString()
  }));
  const science = scienceSubjects.map((subject, index) => ({
    id: `union-science-${index}`,
    title: subject,
    url: `https://union-science.example.com/${index}`,
    source: `union-science-source-${index}`,
    category: "science",
    score: 500 - index * 2,
    commentCount: 0,
    coverage: 1,
    publishedAt: new Date(now - index * 1000).toISOString()
  }));
  const engine = new FeedEngine(new FeedStore(), [
    new JsonSource("union-business", async () => business, "news"),
    new JsonSource("union-science", async () => science, "news")
  ]);

  const businessOnly = await engine.todayEdition({ categories: ["business"], slotId: "evening" });
  const scienceOnly = await engine.todayEdition({ categories: ["science"], slotId: "evening" });
  const combined = await engine.todayEdition({ categories: ["business", "science"], slotId: "evening" });
  const finalized = applyEditionChanges(combined, null, {
    targetLimit: combined.selection.maxIssues,
    minIssuesPerCategory: combined.selection.minIssuesPerCategory,
    additiveCategoryUnion: combined.selection.additiveCategoryUnion,
    categoryIssueLimit: combined.selection.categoryIssueLimit
  });
  const ids = (edition) => edition.issues.map((issue) => issue.refs[0].id);
  const expected = business.flatMap((row, index) => [row.id, science[index].id]);

  assert.equal(businessOnly.issues.length, 14);
  assert.equal(scienceOnly.issues.length, 14);
  assert.equal(combined.selection.maxIssues, 28);
  assert.equal(combined.selection.categoryIssueLimit, 14);
  assert.equal(finalized.issues.length, 28);
  assert.deepEqual(new Set(ids(finalized)), new Set([...ids(businessOnly), ...ids(scienceOnly)]));
  assert.deepEqual(ids(finalized), expected);
});

test("오늘판: 서로 다른 URL과 제목 변형으로 들어온 같은 사건은 두 분야 합집합에서 한 번만 제공한다", async () => {
  const now = Date.now();
  const rows = [
    { id: "cross-duplicate-business", title: "바이오기업 신약 임상 3상 환자 300명 결과 발표로 주가 상승", category: "business", score: 1000 },
    { id: "business-kospi", title: "코스피 장중 3000선 돌파", category: "business", score: 980 },
    { id: "business-fx", title: "원달러 환율 1300원대 하락", category: "business", score: 960 },
    { id: "business-oil", title: "국제유가 배럴당 80달러 돌파", category: "business", score: 940 },
    { id: "cross-duplicate-science", title: "바이오기업 신약 임상 3상 환자 300명 종양 감소 결과 확인", category: "science", score: 999 },
    { id: "science-webb", title: "제임스웹 망원경 외계행성 대기 관측", category: "science", score: 979 },
    { id: "science-mars", title: "화성 탐사선 지하 얼음층 발견", category: "science", score: 959 },
    { id: "science-fusion", title: "핵융합 장치 플라스마 유지시간 연장", category: "science", score: 939 }
  ].map((row, index) => ({
    ...row,
    url: `https://${row.category}-${index}.example.com/article`,
    source: `${row.category}-source-${index}`,
    commentCount: 0,
    coverage: 3,
    publishedAt: new Date(now - index * 1000).toISOString()
  }));
  const engine = new FeedEngine(new FeedStore(), [
    new JsonSource("cross-url-business", async () => rows.filter((row) => row.category === "business"), "news"),
    new JsonSource("cross-url-science", async () => rows.filter((row) => row.category === "science"), "news")
  ]);

  const businessOnly = await engine.todayEdition({ categories: ["business"], slotId: "evening" });
  const scienceOnly = await engine.todayEdition({ categories: ["science"], slotId: "evening" });
  const combined = await engine.todayEdition({ categories: ["business", "science"], slotId: "evening" });
  const finalized = applyEditionChanges(combined, null, {
    targetLimit: combined.selection.maxIssues,
    minIssuesPerCategory: combined.selection.minIssuesPerCategory,
    additiveCategoryUnion: combined.selection.additiveCategoryUnion,
    categoryIssueLimit: combined.selection.categoryIssueLimit
  });
  const selectedIds = finalized.issues.flatMap((issue) => issue.refs.map((ref) => ref.id));
  const duplicateIds = selectedIds.filter((id) => id.startsWith("cross-duplicate-"));

  assert.equal(businessOnly.issues.length, 4);
  assert.equal(scienceOnly.issues.length, 4);
  assert.equal(combined.issues.length, 8);
  assert.equal(finalized.issues.length, 7);
  assert.equal(duplicateIds.length, 1);
  assert.equal(new Set(finalized.issues.map((issue) => issue.clusterId)).size, 7);
});

test("오늘판: 저장 선택이 설문보다 우선하고 기존 설문·취향은 보존된다", async () => {
  const store = new FeedStore();
  store.createUser("today-user");
  store.saveSurvey("today-user", { categories: ["tech", "humor"] });
  const before = store.getUser("today-user").surveyAnswers;
  store.setBriefingCategories("today-user", ["business"]);
  const engine = new FeedEngine(store, editorialSources());
  const edition = await engine.todayEdition({ userId: "today-user", slotId: "evening" });

  assert.equal(edition.selection.mode, "saved");
  assert.deepEqual(edition.selection.categories.map((row) => row.id), ["business"]);
  assert.deepEqual(store.getUser("today-user").surveyAnswers, before);
});

test("오늘판: 여러 선택 분야는 대표 이슈를 확보하고 남은 자리는 중요도 순으로 채운다", async () => {
  const engine = new FeedEngine(new FeedStore(), editorialSources());
  const edition = await engine.todayEdition({ categories: CATEGORIES, slotId: "evening" });
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const issue of edition.issues) {
    for (const category of issue.categoryIds) {
      if (category in counts) counts[category] += 1;
    }
    assert.doesNotMatch(issue.whyForYou, /(?:디자인|게임|패션|부동산|과학|일상)를 선택/,
      `받침에 맞지 않는 조사: ${issue.whyForYou}`);
    assert.doesNotMatch(issue.whyForYou, /기술\/IT을 선택/,
      `영문 약어의 읽는 소리에 맞지 않는 조사: ${issue.whyForYou}`);
  }
  assert.equal(edition.selection.minIssuesPerCategory, 3);
  for (const category of CATEGORIES) {
    assert.ok(counts[category] >= 3, `${category} 대표 이슈 부족: ${JSON.stringify(counts)}`);
  }
  assert.ok(edition.issues.length <= edition.selection.maxIssues);
});

test("오늘판: 선택 분야별 유효 이슈를 최대 14건씩 합쳐 공급량만큼 늘린다", async () => {
  const categoryIds = TAXONOMY_CATEGORIES.map((category) => category.id);
  const now = Date.now();
  const distinctTopics = [
    "공급망 생산 확대", "이용료 정책 개편", "보안 사고 복구",
    "연구 성과 공개", "규제 시행 연기"
  ];
  const sources = categoryIds.map((category, categoryIndex) =>
    new JsonSource(`density-${category}`, async () =>
      Array.from({ length: 5 }, (_, itemIndex) => ({
        id: `density-${category}-${itemIndex}`,
        title: `${category} ${distinctTopics[itemIndex]} 분야-${categoryIndex}`,
        url: `https://density-${category}.example.com/${itemIndex}`,
        category,
        score: 500 - itemIndex,
        commentCount: 50 - itemIndex,
        coverage: 2,
        publishedAt: new Date(now - itemIndex * 60_000).toISOString()
      })), "news")
  );
  const engine = new FeedEngine(new FeedStore(), sources);
  const edition = await engine.todayEdition({
    categories: categoryIds,
    slotId: "evening"
  });
  const counts = Object.fromEntries(categoryIds.map((category) => [category, 0]));
  for (const issue of edition.issues) {
    for (const category of issue.categoryIds) if (category in counts) counts[category] += 1;
  }

  assert.equal(edition.selection.maxIssues, 196);
  assert.equal(edition.selection.categoryIssueLimit, 14);
  assert.equal(edition.selection.additiveCategoryUnion, true);
  assert.equal(edition.selection.minIssuesPerCategory, 3);
  assert.equal(edition.candidateContract.metrics.categoryFloor, 14);
  assert.equal(edition.issues.length, categoryIds.length * 5);
  for (const category of categoryIds) {
    assert.equal(counts[category], 5, `${category} 유효 이슈 누락: ${JSON.stringify(counts)}`);
  }

  const reserved = await engine.todayEdition({
    categories: categoryIds,
    slotId: "evening",
    reserveIssues: 8
  });
  const reservedCounts = Object.fromEntries(categoryIds.map((category) => [category, 0]));
  for (const issue of reserved.issues) {
    for (const category of issue.categoryIds) if (category in reservedCounts) reservedCounts[category] += 1;
  }
  assert.equal(reserved.selection.minIssuesPerCategory, 3, "최종 품질 최소치는 바뀌지 않는다");
  assert.equal(reserved.selection.generationMinIssuesPerCategory, 14,
    "반복 제거 전에는 선택 분야별 상위 목록 전체를 확보한다");
  for (const category of categoryIds) {
    assert.equal(reservedCounts[category], 5,
      `${category} 유효 이슈 누락: ${JSON.stringify(reservedCounts)}`);
  }
});

test("오늘판: 사용자가 정치를 명시 선택하면 정치 토픽을 정치 분야로 편성한다", async () => {
  const now = Date.now();
  const titles = [
    "국회 예산안 본회의 표결 일정 확정",
    "대통령 국무회의에서 정부 개편안 의결",
    "민주당 지도부 새 원내대표 선출",
    "국민의힘 전당대회 후보 등록 시작"
  ];
  const source = new JsonSource("gnews", async () => titles.map((title, index) => ({
    id: `politics-${index}`,
    title,
    url: `https://politics.example.com/${index}`,
    category: "news",
    score: 100 - index,
    publishedAt: new Date(now - index * 60_000).toISOString()
  })), "news");
  const edition = await new FeedEngine(new FeedStore(), [source]).todayEdition({
    categories: ["politics"],
    slotId: "evening"
  });

  assert.ok(edition.issues.length >= 3);
  assert.ok(edition.issues.every((issue) => issue.categoryIds.includes("politics")));
  assert.equal(edition.categoryFulfillment.rows[0].state, "met");
  assert.ok(edition.candidateContract.metrics.categoryCandidateCounts.politics >= 3);
});

test("오늘판: 동적 최소 깊이를 생성 단계에도 전달해 공급 많은 분야의 독식을 막는다", async () => {
  const categoryIds = TAXONOMY_CATEGORIES.slice(0, 9).map((category) => category.id);
  const now = Date.now();
  const sources = categoryIds.map((category, categoryIndex) => new JsonSource(
    `minimum-${category}`,
    async () => Array.from({ length: categoryIndex === 0 ? 60 : 2 }, (_, itemIndex) => ({
      id: `minimum-${category}-${itemIndex}`,
      title: `${category} 독립 변화 ${categoryIndex}-${itemIndex}`,
      url: `https://minimum-${category}.example.com/${itemIndex}`,
      category,
      score: categoryIndex === 0 ? 10_000 - itemIndex : 10 - itemIndex,
      publishedAt: new Date(now - itemIndex * 1000).toISOString()
    })),
    "news"
  ));
  const edition = await new FeedEngine(new FeedStore(), sources).todayEdition({
    categories: categoryIds,
    slotId: "evening"
  });
  const counts = Object.fromEntries(categoryIds.map((category) => [category, 0]));
  for (const issue of edition.issues) {
    for (const category of issue.categoryIds) if (category in counts) counts[category] += 1;
  }

  assert.equal(edition.selection.minIssuesPerCategory, 3);
  for (const category of categoryIds) assert.ok(counts[category] >= 2, `${category}: ${JSON.stringify(counts)}`);
});

test("오늘판: 얇은 분야만 최근 24시간의 미제공 보도형 재고로 보충한다", async () => {
  const asOfMs = Date.parse("2026-08-11T10:00:00.000Z");
  const row = (id, title, hoursAgo, {
    source = "sciencedaily",
    kind = "news",
    url = `https://science.example.com/${id}`,
    score = 10
  } = {}) => {
    const at = asOfMs - hoursAgo * 3600 * 1000;
    return {
      id,
      title,
      url,
      category: "science",
      source,
      sourceLabel: source === "sciencedaily" ? "사이언스데일리" : source,
      kind,
      score,
      commentCount: 0,
      coverage: 1,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  };
  const servedUrl = "https://science.example.com/served?id=7";
  const items = [
    row("fresh", "태양풍 관측 자료로 우주기상 예측 오차를 줄인 연구", 2, { score: 100 }),
    row("older-1", "심해 생태계에서 새로운 탄소 순환 경로를 확인한 연구", 8),
    row("older-2", "은하 형성 과정의 암흑물질 분포를 분석한 관측 결과", 9),
    row("older-3", "면역세포 반응을 조절하는 단백질 구조를 밝힌 연구", 10),
    row("older-4", "극지방 빙하 감소 속도를 추적한 위성 관측 결과", 11),
    row("served", "화성 대기 변화를 추적한 탐사선 관측 결과", 9, {
      source: "physorg",
      url: `${servedUrl}&utm_source=morning`
    }),
    row("community", "과학 게시판에서 화제가 된 우주 사진", 9, {
      source: "ruliweb",
      kind: "community"
    }),
    row("stale", "오래된 해양 온도 변화 관측 자료", 25)
  ];

  const withoutCarryover = await snapshotEngine(items).todayEdition({
    categories: ["science"],
    slotId: "evening",
    asOfMs,
    includeCandidates: true
  });
  assert.equal(withoutCarryover.editorialCarryover.enabled, false);
  assert.equal(withoutCarryover.editorialCarryover.candidateCount, 0);
  assert.equal(withoutCarryover.candidateFixture.metrics.carryoverCandidateCount, 0);
  assert.deepEqual(withoutCarryover.candidateFixture.candidates.map((candidate) => candidate.itemId), ["fresh"]);

  const edition = await snapshotEngine(items).todayEdition({
    categories: ["science"],
    slotId: "evening",
    asOfMs,
    includeCandidates: true,
    reserveIssues: 8,
    allowCarryover: true,
    servedCanonicalUrls: [servedUrl]
  });
  const candidateIds = new Set(edition.candidateFixture.candidates.map((candidate) => candidate.itemId));
  const carryoverCandidates = edition.candidateFixture.candidates.filter((candidate) => candidate.carryover);
  const carryoverIssues = edition.issues.filter((issue) => issue.metrics.carryoverUsed);

  assert.equal(edition.editorialCarryover.enabled, true);
  assert.equal(edition.editorialCarryover.candidateCount, 4);
  assert.equal(edition.candidateFixture.metrics.carryoverCandidateCount, 4);
  assert.equal(edition.candidateFixture.metrics.carryoverCategoryCounts.science, 4);
  assert.ok(candidateIds.has("fresh"));
  assert.ok(!candidateIds.has("served"), "이미 제공한 canonical URL은 다시 후보가 되면 안 된다");
  assert.ok(!candidateIds.has("community"), "커뮤니티 글은 이월 재고가 아니다");
  assert.ok(!candidateIds.has("stale"), "24시간을 넘긴 글은 이월하지 않는다");
  assert.ok(carryoverCandidates.every((candidate) => candidate.sourceRole === "reported_secondary"));
  assert.ok(edition.issues.length >= 3);
  assert.equal(edition.issues[0].metrics.carryoverUsed, false,
    "이월분은 현재 슬롯의 새 기사보다 앞에 서면 안 된다");
  assert.ok(carryoverIssues.length >= 2);
  assert.equal(edition.editorialCarryover.selectedIssueCount, carryoverIssues.length);
  assert.ok(carryoverIssues.every((issue) =>
    issue.refs.some((ref) => ref.carryover) && issue.sourceEvidence.some((evidence) => evidence.carryover)));
});

test("검수 패킷 승계: 사람 입력이 없는 같은 저장 판만 새 계약 패킷으로 교체한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-upgrade-"));
  const file = path.join(dir, "feed.json");
  const adminToken = "review-upgrade-test";
  const clock = () => "2026-08-11T03:30:00.000Z";
  const edition = {
    editionId: "2026-08-11-morning-business",
    editionDate: "2026-08-11",
    generatedAt: "2026-08-10T22:00:00.000Z",
    issues: [{
      subject: "중동 방공 지원 요청",
      headline: "중동 국가가 방공 체계 지원을 요청했다",
      paragraph: "중동 국가가 미사일 위협 대응을 위해 방공 체계 지원을 공식 요청했다.",
      whyImportant: "지역 안보와 방산 공급 일정에 영향을 줄 수 있다.",
      whyHot: "정부 발표가 확인됐다.",
      changedSincePrevious: "이번 브리핑에서 새로 전하는 소식입니다.",
      categoryIds: ["business"],
      refs: [{ id: "defense-1", title: "방공 지원 요청", sourceLabel: "연합뉴스" }],
      sourceEvidence: [{ evidenceId: "e-1", title: "방공 지원 요청", sourceLabel: "연합뉴스" }],
      editorialGate: { pass: true },
      evidence: { mode: "single_feed_observed" }
    }]
  };
  const seeded = new FeedStore({ file, clock });
  seeded.saveEditorialEdition("2026-08-11", "morning", "v13:business", edition);
  const currentPacket = buildBlindReviewPacket(edition);
  const legacyPacket = {
    ...currentPacket,
    packetId: "BRP-legacy-reader-contract",
    packetVersion: 2,
    readerContractVersion: 4
  };
  seeded.saveEditorialReviewPacket(legacyPacket, {
    date: "2026-08-11",
    slotId: "morning",
    segmentKey: "v13:business"
  });

  const server = createServer({
    file,
    sources: editorialSources(Date.parse("2026-08-11T12:20:00+09:00")),
    localEditorial: true,
    adminToken,
    clock,
    localEditorialInventorySchedule: false
  });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/admin/product-blueprint`, {
      headers: { "x-admin-token": adminToken }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const active = body.blueprint.localEditorialEvidence.reviewPacket;
    assert.equal(active.editionId, edition.editionId);
    assert.equal(active.packetVersion, 5);
    assert.notEqual(active.packetId, legacyPacket.packetId);
    assert.equal(active.readerContractVersion, currentPacket.readerContractVersion);
    assert.equal(active.queue.items.some((row) => row.packetId === legacyPacket.packetId), true,
      "이전 패킷은 대기열에서 삭제하지 않아야 한다");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("검수 패킷 고정: 42행을 파일에 보존하고 재시작 뒤 같은 입력을 돌려준다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-freeze-"));
  const file = path.join(dir, "feed.json");
  const adminToken = "review-freeze-test";
  const now = Date.parse("2026-08-12T13:00:00+09:00");
  const options = {
    file,
    sources: allCategoryEditorialSources(now - 30 * 60_000),
    localEditorial: true,
    adminToken,
    clock: () => new Date(now).toISOString(),
    localEditorialInventorySchedule: false
  };
  const headers = { "content-type": "application/json", "x-admin-token": adminToken };

  const first = createServer(options);
  await new Promise((resolve) => first.listen(0, resolve));
  let frozen;
  try {
    const base = `http://127.0.0.1:${first.address().port}`;
    const response = await fetch(`${base}/api/admin/editorial-review-freeze`, {
      method: "POST",
      headers,
      body: "{}"
    });
    frozen = await response.json();
    assert.equal(response.status, 200, JSON.stringify(frozen));
    assert.equal(frozen.state, "review_packet_frozen");
    assert.equal(frozen.persisted, true);
    assert.equal(frozen.issueCount, 42);
    assert.equal(frozen.packetState, "human_annotation_ready");
    assert.equal(frozen.canonicalEditionMutated, false);
    assert.equal(frozen.externalLlmCalls, 0);

    const desk = await fetch(`${base}/api/admin/editorial-desk?reviewerId=reviewer-a`, { headers }).then((res) => res.json());
    assert.equal(desk.packet.packetId, frozen.packetId);
    assert.equal(desk.rows.length, 42);
  } finally {
    await new Promise((resolve) => first.close(resolve));
  }

  const restarted = createServer(options);
  await new Promise((resolve) => restarted.listen(0, resolve));
  try {
    const base = `http://127.0.0.1:${restarted.address().port}`;
    const desk = await fetch(`${base}/api/admin/editorial-desk?reviewerId=reviewer-b`, { headers }).then((res) => res.json());
    assert.equal(desk.packet.packetId, frozen.packetId);
    assert.equal(desk.packet.editionId, frozen.editionId);
    assert.equal(desk.rows.length, 42);
    const replay = await fetch(`${base}/api/admin/editorial-review-freeze`, {
      method: "POST",
      headers,
      body: "{}"
    }).then((res) => res.json());
    assert.equal(replay.state, "review_packet_reused");
    assert.equal(replay.packetId, frozen.packetId);
  } finally {
    await new Promise((resolve) => restarted.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("서버: 로컬 플래그가 오늘판 홈·선택 저장을 열고 꺼지면 기존 홈을 보존한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const adminToken = "editorial-review-test";
  const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-canary-test-"));
  const canaryReceiptFile = path.join(canaryDir, "editorial-llm-canary.json");
  fs.writeFileSync(canaryReceiptFile, JSON.stringify({
    stableId: "NOWHOT-EDITORIAL-LLM-CANARY-001",
    state: "verified_edit",
    executedAt: "2026-08-10T10:05:00.000Z",
    constraints: { localBase: "http://127.0.0.1:4100", requestedIssueCount: 3 },
    pipeline: { edited: 2, rejected: 1 },
    totals: { calls: 2, inputTokens: 500, outputTokens: 180 }
  }));
  let testNow = Date.parse("2026-08-10T06:30:00+09:00");
  const local = createServer({
    sources: editorialSources(
      Date.parse("2026-08-10T18:20:00+09:00"),
      60 * 60_000,
      SERVEABLE_SUBJECTS,
      12
    ),
    localEditorial: true,
    adminToken,
    clock: () => new Date(testNow).toISOString(),
    editorialLlmCanaryReceiptFile: canaryReceiptFile,
    localEditorialInventorySchedule: false
  });
  await new Promise((resolve) => local.listen(0, resolve));
  const base = `http://127.0.0.1:${local.address().port}`;
  try {
    const home = await fetch(`${base}/`).then((res) => res.text());
    assert.match(home, /<title>지금핫 오늘판<\/title>/);
    assert.match(home, /editionDate>today\|\|\(editionDate===today&&hour>kstHour\)/,
      "07시 전 전날 판을 보여줄 때 전날 모닝·런치 탭까지 잠그면 안 된다");
    assert.match(home, /query\.set\("date",targetDate\)/,
      "전날 판의 다른 슬롯을 누를 때 표시 날짜를 서버에 전달해야 한다");
    await fetch(`${base}/api/briefing`).then((res) => res.json());
    testNow = Date.parse("2026-08-10T13:00:00+09:00");
    const session = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }).then((res) => res.json());
    const saved = await fetch(`${base}/api/today/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, categories: ["business"] })
    });
    assert.equal(saved.status, 200);
    // 무효 카테고리 슬러그는 조용히 기본판으로 폴백하지 않는다 (9인 검수 P0,
    // 2026-08-13): economy 오타가 유머 포함 기본판을 받던 결함의 회귀 고정.
    const badCat = await fetch(`${base}/api/today?categories=economy,science`);
    assert.equal(badCat.status, 400, "무효 슬러그는 400");
    const badBody = await badCat.json();
    assert.equal(badBody.code, "UNKNOWN_CATEGORY");
    assert.deepEqual(badBody.unknown, ["economy"]);
    assert.ok(badBody.validCategories.some((c) => c.id === "business"),
      "유효 카테고리 목록을 함께 안내한다");
    const adminHeaders = { "content-type": "application/json", "x-admin-token": adminToken };
    const blueprint = await fetch(`${base}/api/admin/product-blueprint`, { headers: adminHeaders }).then((res) => res.json());
    const edition = await fetch(`${base}/api/today?userId=${encodeURIComponent(session.userId)}&slot=midday`).then((res) => res.json());
    assert.equal(edition.serving.state, "current_machine_verified", JSON.stringify(edition.serving));
    assert.equal(edition.serving.fallback, false);
    assert.match(edition.serving.responsePacketId, /^BRP-/);
    assert.equal(edition.serving.responsePacketId, buildBlindReviewPacket(edition).packetId,
      "저장된 활성 검수 패킷이 아니라 실제 반환 응답의 지문이어야 한다");
    assert.equal(edition.selection.mode, "saved");
    assert.deepEqual(edition.selection.categories.map((row) => row.id), ["business"]);
    assert.equal(edition.slot.id, "lunch", "midday 별칭이 모닝판으로 떨어지면 안 된다");
    assert.equal(edition.editionChange.state, "compared");
    assert.ok(edition.editionChange.previousEditionId);
    assert.ok(edition.issues.every((issue) => issue.changedSincePrevious));
    assert.equal(edition.personalization.state, "personalization_integrity_pass");
    assert.equal(edition.personalization.mode, "canonical_shared_order");
    assert.equal(edition.personalization.issueCountUnchanged, true);
    assert.equal(edition.personalization.unselectedIssueCount, 0);
    assert.equal(edition.personalization.contentMutated, false);
    assert.equal(edition.personalization.llmCalls, 0);
    assert.equal(edition.continuityProjection.responseOnly, true);
    assert.equal(edition.continuityProjection.canonicalSnapshotMutated, false);
    assert.equal(edition.readerPresentation.state, "reader_copy_projection_pass");
    assert.equal(edition.readerPresentation.hiddenWhyForYou, true);
    assert.equal(edition.readerPresentation.canonicalContentMutated, false);
    assert.equal(edition.readerPresentation.llmCalls, 0);
    assert.ok(edition.issues.every((issue) => issue.whyForYou && issue.reader));
    assert.ok(edition.issues.every((issue) => !("whyForYou" in issue.reader)));

    testNow = Date.parse("2026-08-11T00:30:00+09:00");
    const previousMorningResponse = await fetch(
      `${base}/api/today?userId=${encodeURIComponent(session.userId)}&slot=morning&date=2026-08-10`
    );
    assert.equal(previousMorningResponse.status, 200, "07시 전에는 전날 모닝판을 다시 열 수 있어야 한다");
    const previousMorning = await previousMorningResponse.json();
    assert.equal(previousMorning.editionDate, "2026-08-10");
    const futureMorning = await fetch(
      `${base}/api/today?userId=${encodeURIComponent(session.userId)}&slot=morning&date=2026-08-11`
    );
    assert.equal(futureMorning.status, 409, "표시 날짜 파라미터로 미래 슬롯을 우회하면 안 된다");

    const packet = blueprint.blueprint.localEditorialEvidence.reviewPacket;
    const replay = blueprint.blueprint.localEditorialEvidence.editionReplay;
    const inventory = blueprint.blueprint.localEditorialEvidence.inventory;
    const elapsedEvidence = blueprint.blueprint.localEditorialEvidence.elapsedEvidence;
    const qualityHistory = blueprint.blueprint.localEditorialEvidence.qualityHistory;
    const qualityReviewSampling = blueprint.blueprint.localEditorialEvidence.qualityReviewSampling;
    const scheduler = blueprint.blueprint.localEditorialEvidence.scheduler;
    const personalization = blueprint.blueprint.localEditorialEvidence.personalization;
    const servingGate = blueprint.blueprint.localEditorialEvidence.servingGate;
    assert.equal(replay.mode, "same_current_pool_no_elapsed_time");
    assert.equal(replay.projectedOnly, true);
    assert.equal(replay.fixedItemCount, false);
    assert.deepEqual(replay.slots.map((row) => row.id), ["morning", "lunch", "evening"]);
    assert.ok(replay.slots.every((row) => row.categoryFulfillment));
    assert.ok(replay.slots.every((row) =>
      row.categoryFulfillment.metCount <= row.categoryFulfillment.selectedCount));
    assert.ok(replay.slots.every((row) => row.preflightReview));
    assert.ok(replay.slots.every((row) => row.preflightReview.projectedOnly === true));
    assert.ok(replay.slots.every((row) => row.preflightReview.persisted === false));
    assert.ok(replay.slots.every((row) => row.preflightReview.actualElapsedProof === false));
    assert.ok(replay.slots.every((row) => row.preflightReview.humanInputAllowed === false));
    assert.ok(replay.slots.every((row) =>
      row.preflightReview.rows.length === row.selectedIssueCount));
    assert.ok(replay.slots.every((row) =>
      row.preflightReview.metrics.machinePass + row.preflightReview.metrics.machineHold === row.selectedIssueCount));
    assert.equal(inventory.stableId, "NOWHOT-EDITORIAL-INVENTORY-001");
    assert.equal(inventory.snapshotVersion, "v26");
    assert.equal(inventory.compatibility.pass, true);
    assert.equal(inventory.state, "inventory_backlog");
    assert.equal(inventory.missingCount, 1, JSON.stringify({
      state: inventory.state,
      slots: inventory.slots,
      segments: inventory.segments
    }));
    const lunchInventory = inventory.slots.find((row) => row.id === "lunch");
    assert.equal(lunchInventory.missing, 1, "불완전한 기본 런치판은 저장하지 않고 재수집 대상으로 남겨야 한다");
    assert.equal(lunchInventory.held, 0, "저장된 런치판은 모두 발행 가능해야 한다");
    assert.match(inventory.privacy, /사용자 ID를 판본 키에 넣지 않는다/);
    assert.equal(elapsedEvidence.actualElapsedTimeProof, false, "주입 시계 테스트를 실제 시간차 증거로 올리면 안 된다");
    assert.ok(elapsedEvidence.slots
      .filter((row) => row.captureMode !== "not_observed")
      .every((row) => row.captureMode === "injected_clock"));
    assert.ok(elapsedEvidence.slots.some((row) => row.captureMode === "not_observed"),
      "13시에는 이브닝 슬롯을 관측한 것처럼 만들면 안 된다");
    assert.equal(qualityHistory.stableId, "NOWHOT-EDITORIAL-QUALITY-HISTORY-001");
    assert.equal(qualityHistory.fixedItemCount, false);
    assert.ok(qualityHistory.rows.length >= 1);
    assert.ok(qualityHistory.totals.editions >= inventory.storedCount);
    assert.equal(qualityReviewSampling.stableId, "NOWHOT-QUALITY-REVIEW-SAMPLING-001");
    assert.equal(qualityReviewSampling.fixedItemCount, false);
    assert.ok(qualityReviewSampling.frozenPacketCount >= 1);
    assert.equal(qualityReviewSampling.activationChanged, false);
    assert.equal(scheduler.stableId, "NOWHOT-EDITORIAL-SCHEDULER-STATUS-001");
    assert.equal(scheduler.enabled, false);
    assert.equal(scheduler.state, "manual_only");
    assert.equal(scheduler.clockSource, "injected");
    assert.equal(scheduler.nextAction.slotId, "evening");
    assert.equal(personalization.state, "personalization_integrity_pass");
    assert.equal(personalization.sharedCanonical, true);
    assert.equal(personalization.addedIssueCount, 0);
    assert.equal(personalization.removedIssueCount, 0);
    assert.equal(servingGate.contractId, "NOWHOT-EDITORIAL-SERVING-CONTRACT-001");
    assert.equal(servingGate.contractVersion, 1);
    assert.equal(servingGate.humanReviewRequired, false);
    assert.match(servingGate.state, /^serveable_machine_(verified|hold)$/);
    assert.ok(Number.isInteger(servingGate.verificationCount));
    assert.ok(packet.rows.length > 0);
    assert.equal(packet.packetVersion, 5);
    assert.equal(packet.metrics.readerIssuePass, packet.rows.length);
    assert.equal(typeof packet.metrics.readerPacketPass, "boolean");
    assert.ok(packet.rows.every((row) => row.reader && row.readerGate && row.readerGate.pass));
    assert.equal(packet.queue.stableId, "NOWHOT-HUMAN-REVIEW-QUEUE-001");
    assert.equal(packet.queue.activePacketId, packet.packetId);
    assert.equal(packet.queue.state, "active_current_packet");
    assert.equal(blueprint.blueprint.localEditorialEvidence.editorialLineage.holdCount, 0);
    assert.ok(blueprint.blueprint.localEditorialEvidence.editorialLineage.sourceEvidenceCount > 0);
    assert.equal(blueprint.blueprint.localEditorialEvidence.editorialLlm.state, "disabled");
    assert.equal(blueprint.blueprint.localEditorialEvidence.editorialLlm.calls, 0);
    assert.equal(blueprint.blueprint.localEditorialEvidence.editorialLlm.model, null);
    assert.equal(blueprint.blueprint.localEditorialEvidence.editorialLlm.configuredModel, "claude-sonnet-5");
    assert.equal(blueprint.blueprint.localEditorialEvidence.llmCanary.actualReceipt, true);
    assert.equal(blueprint.blueprint.localEditorialEvidence.llmCanary.externalCalls, 2);
    assert.equal(blueprint.blueprint.localEditorialEvidence.llmCanary.edited, 2);
    assert.equal(blueprint.blueprint.localEditorialEvidence.llmCanary.inputTokens, 500);
    const deskPage = await fetch(`${base}/admin/editorial-desk`).then((res) => res.text());
    assert.match(deskPage, /<title>편집 데스크 · 지금핫<\/title>/);
    assert.match(deskPage, /name="robots" content="noindex,nofollow"/);
    assert.match(deskPage, /api\/admin\/editorial-desk/);
    const desk = await fetch(`${base}/api/admin/editorial-desk?reviewerId=reviewer-a`, { headers: adminHeaders }).then((res) => res.json());
    assert.equal(desk.stableId, "NOWHOT-EDITORIAL-REVIEW-DESK-001");
    assert.equal(desk.packet.packetId, packet.packetId);
    assert.equal(desk.rows.length, packet.rows.length);
    assert.deepEqual(desk.reviewFields.map((field) => field.id), [
      "include", "clusterCorrect", "headlineFaithful", "evidenceSufficient", "categoryFit"
    ]);
    assert.ok(desk.rows.every((row) => row.reader && row.annotation));
    assert.ok(desk.rows.every((row) => !("machineGate" in row) && !("human" in row)));
    assert.doesNotMatch(JSON.stringify(desk.rows), /whyForYou/);
    const blank = await fetch(`${base}/api/admin/editorial-review?reviewerId=reviewer-a`, { headers: adminHeaders }).then((res) => res.json());
    assert.deepEqual(blank.annotations, []);
    const annotations = packet.rows.map((row) => ({
      blindId: row.blindId,
      include: true,
      clusterCorrect: true,
      headlineFaithful: true,
      evidenceSufficient: true,
      categoryFit: true,
      notes: "로컬 테스트"
    }));
    const duplicated = annotations.map((row) => ({ ...row, blindId: annotations[0].blindId }));
    const duplicateReview = await fetch(`${base}/api/admin/editorial-review`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: packet.packetId,
        editionId: packet.editionId,
        reviewerId: "reviewer-a",
        annotations: duplicated
      })
    });
    assert.equal(duplicateReview.status, 400);
    const savedReview = await fetch(`${base}/api/admin/editorial-review`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: packet.packetId,
        editionId: packet.editionId,
        reviewerId: "reviewer-a",
        annotations
      })
    });
    assert.equal(savedReview.status, 200);
    testNow = Date.parse("2026-08-11T08:00:00+09:00");
    const reread = await fetch(`${base}/api/admin/editorial-review?reviewerId=reviewer-a`, { headers: adminHeaders }).then((res) => res.json());
    assert.equal(reread.annotations.length, packet.rows.length);
    assert.equal(reread.humanReview.state, "human_annotation_in_progress");
    assert.equal(reread.humanReview.identityProof, false);
    assert.equal(reread.humanReview.comparisonReady, false);
    assert.deepEqual(reread.humanReview.disagreements, [], "B가 끝나기 전에는 부분 답을 공개하면 안 된다");
    const reviewerBDesk = await fetch(`${base}/api/admin/editorial-desk?reviewerId=reviewer-b`, { headers: adminHeaders }).then((res) => res.json());
    assert.equal(reviewerBDesk.humanReview.comparisonReady, false);
    assert.doesNotMatch(JSON.stringify(reviewerBDesk.rows), /로컬 테스트/, "다른 검수자의 메모를 노출하면 안 된다");
    const afterReview = await fetch(`${base}/api/admin/product-blueprint`, { headers: adminHeaders }).then((res) => res.json());
    assert.equal(afterReview.blueprint.localEditorialEvidence.reviewPacket.humanReview.completedByReviewer["reviewer-a"].completed, packet.rows.length);
    assert.equal(afterReview.blueprint.localEditorialEvidence.reviewPacket.metrics.humanCompleted, 0, "한 사람 입력만으로 2인 완료가 되면 안 된다");
    const queued = afterReview.blueprint.localEditorialEvidence.reviewPacket.queue;
    assert.equal(queued.state, "active_packet_pinned");
    assert.ok(queued.pendingCount >= 1);
    assert.notEqual(queued.currentCandidatePacketId, packet.packetId);
    const blockedRotation = await fetch(`${base}/api/admin/editorial-review-packet`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: queued.currentCandidatePacketId,
        editionId: queued.currentCandidateEditionId
      })
    });
    assert.equal(blockedRotation.status, 409, "진행 중 검수 패킷을 다음 슬롯으로 바꾸면 안 된다");

    const reviewerBAnnotations = annotations.map((row, index) => ({
      ...row,
      evidenceSufficient: index === 0 ? false : row.evidenceSufficient
    }));
    const reviewerBReview = await fetch(`${base}/api/admin/editorial-review`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: packet.packetId,
        editionId: packet.editionId,
        reviewerId: "reviewer-b",
        annotations: reviewerBAnnotations
      })
    }).then((res) => res.json());
    assert.equal(reviewerBReview.humanReview.state, "human_adjudication_required");
    assert.equal(reviewerBReview.humanReview.comparisonReady, true);
    assert.equal(reviewerBReview.humanReview.adjudication.unresolvedFields, 1);

    const adjudication = await fetch(`${base}/api/admin/editorial-review-adjudication`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: packet.packetId,
        editionId: packet.editionId,
        resolutions: reviewerBReview.humanReview.adjudication.rows.map((row) => ({
          blindId: row.blindId,
          field: row.field,
          value: true,
          notes: "테스트 원문 재확인"
        }))
      })
    }).then((res) => res.json());
    assert.equal(adjudication.humanReview.state, "human_adjudicated_pass");
    assert.equal(adjudication.humanReview.qualityPass, packet.machineState === "human_annotation_ready");
    assert.equal(adjudication.humanReview.strictConsensusPass, false);

    const activated = await fetch(`${base}/api/admin/editorial-review-packet`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        packetId: queued.currentCandidatePacketId,
        editionId: queued.currentCandidateEditionId
      })
    });
    assert.equal(activated.status, 200, "조정이 끝난 뒤에는 다음 고정 패킷으로 전환할 수 있어야 한다");
    const afterActivation = await fetch(`${base}/api/admin/product-blueprint`, { headers: adminHeaders }).then((res) => res.json());
    assert.equal(afterActivation.blueprint.localEditorialEvidence.reviewPacket.packetId, queued.currentCandidatePacketId);
    const live = await fetch(`${base}/live`).then((res) => res.text());
    assert.match(live, /data-view-switch data-active="live"/);
    assert.match(live, /data-view="today">오늘<\/a>[\s\S]*data-view="live" aria-current="page">실시간<\/a>/);
  } finally {
    await new Promise((resolve) => local.close(resolve));
    fs.rmSync(canaryDir, { recursive: true, force: true });
  }

  const unchanged = createServer({ sources: editorialSources(), localEditorial: false });
  await new Promise((resolve) => unchanged.listen(0, resolve));
  const oldBase = `http://127.0.0.1:${unchanged.address().port}`;
  try {
    const home = await fetch(`${oldBase}/`).then((res) => res.text());
    assert.doesNotMatch(home, /<title>지금핫 오늘판<\/title>/);
    assert.equal((await fetch(`${oldBase}/api/today`)).status, 404);
  } finally {
    await new Promise((resolve) => unchanged.close(resolve));
  }
});
