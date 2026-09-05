import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalContentUrl } from "../src/feed/dedupe.js";
import { applyEditionChanges } from "../src/feed/edition-change.js";
import { createCategoryRouter } from "../src/feed/category-routing.js";
import {
  EDITION_CANDIDATE_CONTRACT,
  buildEditionCandidateFixture,
  candidateFixtureReceipt
} from "../src/feed/edition-candidates.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";
import { buildBlindReviewPacket } from "../src/feed/editorial-quality.js";
import { EDITORIAL_SERVING_CONTRACT } from "../src/feed/editorial-serving.js";
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
  "방공 체계 지원 요청", "북한군 추가 배치 확인", "정유시설 미사일 공격 피해",
  "기준금리 결정 회의 결과", "원달러 환율 변동 대응 방안", "반도체 수출 전망 공식 발표",
  "국제유가 공급 계획 조정", "전기요금 연료비 조정안", "중소기업 정책금융 확대",
  "항만 물동량 월간 통계", "온라인 유통 매출 동향", "고용보험 가입자 통계",
  "기업 설비투자 계획 공개", "조선업 수주 잔고 분기 집계", "배터리 원재료 장기 공급 계약",
  "항공화물 운임 지수 발표", "농산물 도매가격 안정 대책", "벤처투자 신규 결성액 통계"
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

function editorialSources(baseMs = Date.now(), spacingMs = 60_000, subjects = SUBJECTS, sourceCount = 8, categories = CATEGORIES, itemsPerSource = 15) {
  return Array.from({ length: sourceCount }, (_, sourceIndex) => {
    const category = categories[sourceIndex % categories.length];
    return new JsonSource(`editorial-${sourceIndex}`, async () =>
      Array.from({ length: itemsPerSource }, (_, itemIndex) => {
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
    { id: "ruliweb", kind: "community" },
    { id: "inven", kind: "community" }
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

test("동적 후보 계약: 분야 목표보다 작은 출처 상한으로 유효 후보를 잘라내지 않는다", () => {
  const items = Array.from({ length: 18 }, (_, index) => ({
    id: `single-source-${index}`,
    title: `게임 대회와 신작 소식 ${index + 1}차 발표`,
    url: `https://gaming.example.com/${index}`,
    category: "gaming",
    source: "gamemeca",
    kind: "news",
    score: 100 - index
  }));
  const fixture = buildEditionCandidateFixture(items, {
    selectedCategories: ["gaming"],
    limit: 112,
    minPerSelectedCategory: 14,
    preferKoreanAudience: true
  });

  assert.ok(fixture.metrics.sourceCap >= 14);
  assert.ok(fixture.candidates.length >= 14);
});

test("동적 후보 계약: 본문 없는 Google 중계 한 단어 페이지 제목은 후보로 쓰지 않는다", () => {
  const fixture = buildEditionCandidateFixture([{
    id: "relay-page-title",
    title: "열린도지사실",
    summary: "",
    url: "https://news.google.com/rss/articles/opaque-token?oc=5",
    canonicalUrl: null,
    category: "politics",
    source: "gnews-biz",
    kind: "news",
    coverage: 5
  }, {
    id: "direct-story",
    title: "경기도 청년 주거 지원 예산안 발표",
    summary: "지원 대상과 시행 일정을 발표했다.",
    url: "https://publisher.example.com/politics/1",
    category: "politics",
    source: "publisher",
    kind: "news"
  }], {
    selectedCategories: ["politics"],
    limit: 2,
    minPerSelectedCategory: 1
  });

  assert.deepEqual(fixture.candidates.map((row) => row.itemId), ["direct-story"]);
  assert.equal(fixture.metrics.dropped.relayStub, 1);
});

test("동적 후보 계약: 단일 지역 편성 분야는 검수 전 국내외 후보 한 지면씩을 유지한다", () => {
  const registry = [];
  const items = [
    ...Array.from({ length: 40 }, (_, index) => {
      const source = `foreign-tech-${index}`;
      registry.push({ id: source, country: "US" });
      return { id: source, title: `Global technology report number ${index + 1}`,
        url: `https://${source}.example.com/article`, category: "tech", source, kind: "news",
        score: 1_000 - index };
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      const source = `domestic-tech-${index}`;
      registry.push({ id: source, country: "KR" });
      return { id: source, title: `국내 기술 산업 동향 ${index + 1}`,
        url: `https://${source}.example.com/article`, category: "tech", source, kind: "news",
        score: 100 - index };
    })
  ];

  const fixture = buildEditionCandidateFixture(items, {
    registry,
    selectedCategories: ["tech"],
    domesticShareBands: { tech: [0.5, 0.7] },
    limit: 28,
    minPerSelectedCategory: 14
  });

  assert.equal(fixture.candidates.filter((row) => row.country === "KR").length, 14);
  assert.equal(fixture.candidates.filter((row) => row.country === "US").length, 14);
});

test("동적 후보 계약: 지역 편성 예약이 앞 분야에 두 지면을 써서 뒤 분야를 굶기지 않는다", () => {
  const registry = [];
  const items = ["tech", "science"].flatMap((category, categoryIndex) => [
    ...Array.from({ length: 20 }, (_, index) => {
      const source = `foreign-${category}-${index}`;
      registry.push({ id: source, country: "US" });
      return { id: source, title: `Global ${category} report number ${index + 1}`,
        url: `https://${source}.example.com/article`, category, source, kind: "news",
        score: 1_000 - categoryIndex * 100 - index };
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      const source = `domestic-${category}-${index}`;
      registry.push({ id: source, country: "KR" });
      return { id: source, title: `국내 ${category} 산업 동향 ${index + 1}`,
        url: `https://${source}.example.com/article`, category, source, kind: "news",
        score: 100 - categoryIndex * 10 - index };
    })
  ]);

  const fixture = buildEditionCandidateFixture(items, {
    registry,
    selectedCategories: ["tech", "science"],
    domesticShareBands: { tech: [0.5, 0.7], science: [0.5, 0.7] },
    limit: 28,
    minPerSelectedCategory: 14
  });

  for (const category of ["tech", "science"]) {
    const rows = fixture.candidates.filter((row) => row.categoryId === category);
    assert.equal(rows.length, 14, `${category} 후보 최소선이 다른 분야 예약에 먹히면 안 된다`);
    assert.equal(rows.filter((row) => row.country === "KR").length, 7);
    assert.equal(rows.filter((row) => row.country === "US").length, 7);
  }
  assert.equal(fixture.metrics.candidateCount, 28);
});

test("동적 후보 계약: 두 분야 13건의 홀수 지역 예약도 각각 최소선을 채운다", () => {
  const registry = [];
  const items = ["tech", "science"].flatMap((category, categoryIndex) => [
    ...Array.from({ length: 20 }, (_, index) => {
      const source = `odd-foreign-${category}-${index}`;
      registry.push({ id: source, country: "US" });
      return { id: source, title: `Global ${category} report ${index + 1}`,
        url: `https://${source}.example.com/article`, category, source, kind: "news",
        score: 1_000 - categoryIndex * 100 - index };
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      const source = `odd-domestic-${category}-${index}`;
      registry.push({ id: source, country: "KR" });
      return { id: source, title: `국내 ${category} 산업 보고 ${index + 1}`,
        url: `https://${source}.example.com/article`, category, source, kind: "news",
        score: 100 - categoryIndex * 10 - index };
    })
  ]);

  const fixture = buildEditionCandidateFixture(items, {
    registry,
    selectedCategories: ["tech", "science"],
    domesticShareBands: { tech: [0.5, 0.7], science: [0.5, 0.7] },
    limit: 26,
    minPerSelectedCategory: 13
  });

  for (const category of ["tech", "science"]) {
    const rows = fixture.candidates.filter((row) => row.categoryId === category);
    assert.equal(rows.length, 13, `${category}가 홀수 목표 13건을 채워야 한다`);
    assert.equal(rows.filter((row) => row.country === "KR").length, 7);
    assert.equal(rows.filter((row) => row.country === "US").length, 6);
  }
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

test("오늘판: 복수 선택은 단독 분야의 고정 상위 목록을 다시 뽑지 않고 합친다", async () => {
  const now = Date.now();
  const categories = ["business", "tech"];
  const fixed = Object.fromEntries(categories.map((category, categoryIndex) => [
    category,
    Array.from({ length: 4 }, (_, index) => ({
      evidenceHash: `fixed-${category}-${index}`,
      clusterId: `fixed-${category}-${index}`,
      subject: `${category} 고정 기사 ${index}`,
      headline: `${category} 고정 기사 ${index}`,
      paragraph: `${category} 고정 기사 ${index}의 고정 설명입니다.`,
      whyImportant: `${category} 고정 중요성 ${index}`,
      watchNext: `${category} 고정 후속 ${index}`,
      categoryIds: [category],
      refs: [{ id: `fixed-${category}-${index}`, title: `${category} 고정 기사 ${index}` }],
      metrics: { score: 1_000 - categoryIndex * 100 - index }
    }))
  ]));
  const replacements = categories.flatMap((category, categoryIndex) =>
    Array.from({ length: 4 }, (_, index) => ({
      evidenceHash: `replacement-${category}-${index}`,
      clusterId: `replacement-${category}-${index}`,
      subject: `${category} 조합 재선정 기사 ${index}`,
      headline: `${category} 조합 재선정 기사 ${index}`,
      categoryIds: [category],
      refs: [{ id: `replacement-${category}-${index}`, title: `${category} 조합 재선정 기사 ${index}` }],
      metrics: { score: 2_000 - categoryIndex * 100 - index }
    })));
  const engine = new FeedEngine(new FeedStore(), []);
  const calls = [];
  engine.briefing = async ({ categories: requested }) => {
    calls.push([...requested]);
    const issues = requested.length === 1 ? fixed[requested[0]] : replacements;
    return {
      generatedAt: new Date(now).toISOString(),
      slot: { id: "evening" },
      itemCount: issues.length,
      sourceCount: issues.length,
      overseasShare: 0,
      issues,
      sections: requested.map((category) => ({
        category,
        items: issues.filter((issue) => issue.categoryIds.includes(category))
      })),
      editorialQuality: { categoryFunnel: [] },
      publishable: true
    };
  };

  const businessOnly = await engine.todayEdition({ categories: ["business"], slotId: "evening" });
  const techOnly = await engine.todayEdition({ categories: ["tech"], slotId: "evening" });
  calls.length = 0;
  const combined = await engine.todayEdition({ categories, slotId: "evening" });
  const key = (issue) => issue.clusterId || issue.evidenceHash;
  const combinedByKey = new Map(combined.issues.map((issue) => [key(issue), issue]));

  assert.deepEqual(calls, [["business"], ["tech"]]);
  for (const issue of [...businessOnly.issues, ...techOnly.issues]) {
    const merged = combinedByKey.get(key(issue));
    assert.ok(merged, `단독 분야 기사가 조합에서 사라짐: ${issue.subject}`);
    for (const field of ["subject", "headline", "paragraph", "whyImportant", "watchNext"]) {
      assert.equal(merged[field], issue[field], `${field}가 카테고리 조합 때문에 바뀜`);
    }
  }
});

test("오늘판: 여러 분야도 이전 판 중복을 분야별로 대체해 각 14건을 유지한다", async () => {
  const categories = ["business", "science", "tech"];
  const now = Date.now();
  const currentIssues = categories.flatMap((category, categoryIndex) =>
    Array.from({ length: 22 }, (_, itemIndex) => ({
      evidenceHash: `reserve-${category}-${itemIndex}`,
      headline: `${category} 확정 이슈 ${itemIndex}`,
      subject: `${category} 확정 이슈 ${itemIndex}`,
      categoryIds: [category],
      refs: [{ id: `reserve-${category}-${itemIndex}`, title: `${category} 확정 이슈 ${itemIndex}` }],
      metrics: { score: 1_000 - categoryIndex * 100 - itemIndex, sourceCount: 2, coverage: 2 },
      publishedAt: new Date(now - itemIndex * 1000).toISOString()
    })));
  const engine = new FeedEngine(new FeedStore(), []);
  engine.briefing = async ({ categories: selected }) => ({
    generatedAt: new Date(now).toISOString(),
    slot: { id: "evening" },
    issues: currentIssues,
    sections: selected.map((category) => ({
      category,
      items: currentIssues.filter((issue) => issue.categoryIds.includes(category))
    }))
  });
  const candidate = await engine.todayEdition({
    categories,
    slotId: "evening",
    reserveIssues: 8
  });
  const previousIssues = categories.flatMap((category) =>
    candidate.issues.filter((issue) => issue.categoryIds.includes(category)).slice(0, 8));
  const finalized = applyEditionChanges(candidate, {
    editionId: "previous-evening",
    generatedAt: new Date(now - 6 * 3600 * 1000).toISOString(),
    issues: previousIssues
  }, {
    targetLimit: candidate.selection.maxIssues,
    minIssuesPerCategory: candidate.selection.minIssuesPerCategory,
    additiveCategoryUnion: candidate.selection.additiveCategoryUnion,
    categoryIssueLimit: candidate.selection.categoryIssueLimit
  });
  const counts = Object.fromEntries(categories.map((category) => [
    category,
    finalized.issues.filter((issue) => issue.categoryIds.includes(category)).length
  ]));

  assert.equal(candidate.selection.generatedIssueBudget, 66);
  assert.equal(candidate.selection.generationMinIssuesPerCategory, 22);
  assert.deepEqual(counts, { business: 14, science: 14, tech: 14 });
  assert.equal(finalized.issues.length, 42);
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
  const duplicateIssues = finalized.issues.filter((issue) =>
    issue.refs.some((ref) => ref.id.startsWith("cross-duplicate-")));
  const duplicateIn = (edition) => edition.issues.find((issue) =>
    issue.refs.some((ref) => ref.id.startsWith("cross-duplicate-")));
  const canonicalFields = (issue) => Object.fromEntries([
    "subject", "headline", "paragraph", "eventSourceSetId", "eventSources", "sourceEvidence", "refs"
  ].map((field) => [field, issue[field]]));
  const businessDuplicate = duplicateIn(businessOnly);
  const scienceDuplicate = duplicateIn(scienceOnly);
  const combinedDuplicate = duplicateIn(combined);

  assert.equal(businessOnly.issues.length, 4);
  assert.equal(scienceOnly.issues.length, 4);
  assert.equal(combined.issues.length, 7);
  assert.equal(finalized.issues.length, 7);
  assert.equal(duplicateIssues.length, 1);
  assert.equal(new Set(finalized.issues.map((issue) => issue.clusterId)).size, 7);
  assert.deepEqual(canonicalFields(scienceDuplicate), canonicalFields(businessDuplicate));
  assert.deepEqual(canonicalFields(combinedDuplicate), canonicalFields(businessDuplicate));
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
    const creditedCategories = issue.selectedByCategories?.length
      ? issue.selectedByCategories : issue.categoryIds;
    for (const category of creditedCategories) {
      if (category in counts) counts[category] += 1;
    }
    assert.doesNotMatch(issue.whyForYou, /(?:디자인|게임|패션|부동산|과학|일상)를 선택/,
      `받침에 맞지 않는 조사: ${issue.whyForYou}`);
    assert.doesNotMatch(issue.whyForYou, /기술\/IT을 선택/,
      `영문 약어의 읽는 소리에 맞지 않는 조사: ${issue.whyForYou}`);
  }
  assert.equal(edition.selection.minIssuesPerCategory, 14);
  for (const category of CATEGORIES) {
    assert.ok(counts[category] >= 13, `${category} 대표 이슈 부족: ${JSON.stringify(counts)}`);
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
        title: `${category} ${distinctTopics[itemIndex]} 사건번호 ${1000 + categoryIndex}`,
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
  assert.equal(edition.selection.minIssuesPerCategory, 14);
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
  assert.equal(reserved.selection.minIssuesPerCategory, 14, "최종 품질 최소치는 바뀌지 않는다");
  assert.equal(reserved.selection.generationMinIssuesPerCategory, 22,
    "반복 제거 여유분은 최종 14건 목표보다 넓게 확보한다");
  for (const category of categoryIds) {
    assert.equal(reservedCounts[category], 5,
      `${category} 유효 이슈 누락: ${JSON.stringify(reservedCounts)}`);
  }
});

test("오늘판: 낡은 빈 v2 스냅샷은 정치 토픽을 요청 경로에서 재분류하지 않는다", async () => {
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
  const engine = new FeedEngine(new FeedStore(), [source]);
  const router = createCategoryRouter({
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001",
    snapshotId: "stale-politics-test",
    generatedAt: new Date(now - 31 * 60 * 60 * 1000).toISOString(),
    source: { packetSha256: "a".repeat(64), predictionsSha256: "b".repeat(64) },
    counts: { classifiedArticles: 0, withheldArticles: 0 },
    entries: []
  }, [], { now: () => now });
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;
  const edition = await engine.todayEdition({
    categories: ["politics"],
    slotId: "evening"
  });

  assert.equal(edition.issues.length, 0);
  assert.equal(edition.categoryFulfillment.rows[0].state, "no_supply");
  assert.equal(edition.candidateContract.metrics.categoryCandidateCounts.politics ?? 0, 0);
  assert.equal(router.status.state, "snapshot_stale_last_good_v2");
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

  assert.equal(edition.selection.minIssuesPerCategory, 14);
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
      source: "inven",
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
  assert.equal(edition.editorialCarryover.candidateCount, 5);
  assert.equal(edition.candidateFixture.metrics.carryoverCandidateCount, 5);
  assert.equal(edition.candidateFixture.metrics.carryoverCategoryCounts.science, 5);
  assert.ok(candidateIds.has("fresh"));
  assert.ok(!candidateIds.has("served"), "이미 제공한 canonical URL은 다시 후보가 되면 안 된다");
  assert.ok(candidateIds.has("community"), "검증된 베스트글도 부족 분야의 미제공 재고로 쓴다");
  assert.ok(!candidateIds.has("stale"), "24시간을 넘긴 글은 이월하지 않는다");
  assert.ok(carryoverCandidates.some((candidate) => candidate.sourceRole === "community_signal"));
  assert.ok(edition.issues.length >= 3);
  assert.equal(edition.issues[0].metrics.carryoverUsed, false,
    "이월분은 현재 슬롯의 새 기사보다 앞에 서면 안 된다");
  assert.ok(carryoverIssues.length >= 2);
  assert.equal(edition.editorialCarryover.selectedIssueCount, carryoverIssues.length);
  assert.ok(carryoverIssues.every((issue) =>
    issue.refs.some((ref) => ref.carryover) && issue.sourceEvidence.some((evidence) => evidence.carryover)));
});

test("오늘판: 현재 슬롯 공급이 2건이어도 최근 24시간 미제공 재고로 분야 14건을 채운다", async () => {
  const asOfMs = Date.parse("2026-08-11T10:00:00.000Z");
  const titles = [
    "신작 우주 탐험 게임이 첫 번째 확장팩을 공개했다",
    "프로리그 결승전에서 새로운 우승팀이 탄생했다",
    "전략 게임 밸런스 패치가 주요 유닛 능력치를 바꿨다",
    "휴대용 콘솔 신제품의 출시 일정이 확정됐다",
    "인디 게임 축제가 올해 수상작 명단을 발표했다",
    "온라인 역할 게임이 신규 대륙 업데이트를 예고했다",
    "레이싱 게임 대회가 새로운 경기 규칙을 도입했다",
    "퍼즐 게임 후속작이 협동 모드를 처음 공개했다",
    "게임 유통 플랫폼이 가족 공유 기능을 정식 도입했다",
    "액션 게임 개발진이 전투 시스템 개편안을 공개했다",
    "호러 게임 제작진이 장편 영화화 계약을 체결했다",
    "축구 게임 시즌 업데이트가 선수 명단을 교체했다",
    "생존 게임이 이용자 제작 지도 기능을 추가했다",
    "스토리 게임이 한국어 음성 지원 계획을 발표했다"
  ];
  const sources = ["gamemeca", "pcgamer", "inven", "gamespot"];
  const items = Array.from({ length: 14 }, (_, index) => {
    const hoursAgo = index < 2 ? index + 1 : index + 7;
    const at = asOfMs - hoursAgo * 3600 * 1000;
    return {
      id: `gaming-depth-${index}`,
      title: titles[index],
      url: `https://gaming.example.com/${index}`,
      category: "gaming",
      source: sources[index % sources.length],
      kind: index % 2 ? "community" : "news",
      score: 100 - index,
      commentCount: index,
      coverage: 1,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });

  const edition = await snapshotEngine(items).todayEdition({
    categories: ["gaming"],
    slotId: "evening",
    asOfMs,
    allowCarryover: true
  });

  assert.equal(edition.issues.length, 14);
  assert.equal(edition.categoryFulfillment.rows[0].issueCount, 14);
  assert.equal(edition.categoryFulfillment.goalSatisfied, true);
});

test("오늘판: 현재 슬롯 원시 글이 14건이어도 한 매체 편중이면 24시간 재고로 편집 깊이를 채운다", async () => {
  const asOfMs = Date.parse("2026-08-11T10:00:00.000Z");
  const freshTitles = [
    "콘솔 신제품 출시 일정 공개", "프로게임단 새 감독 선임", "인디게임 수상작 발표",
    "온라인게임 신규 대륙 추가", "레이싱게임 대회 규칙 개편", "퍼즐게임 협동 모드 공개",
    "게임 플랫폼 가족 공유 도입", "액션게임 전투 시스템 개편", "호러게임 영화화 계약",
    "축구게임 선수 명단 교체", "생존게임 지도 제작 기능", "스토리게임 한국어 음성 지원",
    "모바일게임 글로벌 사전예약", "전략게임 신규 진영 공개"
  ];
  const backlogTitles = [
    "게임 엔진 새 렌더링 기능 발표", "휴대용 게임기 배터리 개선", "e스포츠 결승 개최지 확정",
    "클라우드 게임 지원 국가 확대", "게임 구독 서비스 작품 추가", "가상현실 게임 후속작 공개",
    "교육용 게임 연구 결과 발표", "게임 접근성 옵션 표준 제안", "보드게임 디지털판 출시",
    "게임 음악 공연 일정 확정", "아케이드 복원 프로젝트 시작", "게임 개발자 행사 연사 공개",
    "시뮬레이션 게임 확장팩 예고", "게임 번역 지원 언어 확대"
  ];
  const fresh = freshTitles.map((title, index) => {
    const at = asOfMs - (index + 1) * 60 * 1000;
    return {
      id: `fresh-concentrated-${index}`,
      title,
      url: `https://fresh.example.com/${index}`,
      category: "gaming",
      source: "fresh-source",
      kind: "news",
      score: 200 - index,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });
  const backlog = backlogTitles.map((title, index) => {
    const at = asOfMs - (8 + index / 10) * 3600 * 1000;
    return {
      id: `backlog-diverse-${index}`,
      title,
      url: `https://backlog-${index}.example.com/story`,
      category: "gaming",
      source: `backlog-source-${index}`,
      kind: "news",
      score: 100 - index,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });

  const edition = await snapshotEngine([...fresh, ...backlog]).todayEdition({
    categories: ["gaming"],
    slotId: "evening",
    asOfMs,
    allowCarryover: true
  });

  assert.equal(edition.issues.length, 14);
  assert.equal(edition.categoryFulfillment.rows[0].issueCount, 14);
  assert.equal(edition.categoryFulfillment.goalSatisfied, true);
  assert.ok(edition.editorialCarryover.candidateCount > 0);
});

test("오늘판: 세 전문 매체의 24시간 재고만으로도 부동산 분야 14건을 채운다", async () => {
  const asOfMs = Date.parse("2026-08-11T10:00:00.000Z");
  const sources = ["mk-realestate", "hankyung-realestate", "chosunbiz-realestate"];
  const titles = [
    "서울 재건축 용적률 완화안 발표", "전세 보증금 반환 지원 확대",
    "신규 택지 후보지 공개", "오피스텔 취득세 감면",
    "분양가 상한제 기준 조정", "청년 임대주택 착공",
    "그린벨트 해제 검토", "상업용 건물 공실률 통계",
    "주택담보대출 규제 변경", "재개발 조합 사업 승인",
    "수도권 아파트 거래량 증가", "종부세 공제 기준 개편",
    "PF 사업장 인수 계획", "공공임대 입주자 모집",
    "건설사 미분양 할인", "전월세 신고제 보완",
    "도시정비사업 일정 확정", "토지거래허가구역 조정",
    "상가 임대차 분쟁 조정", "고령자 주거 지원 확대",
    "지역주택조합 회계 공개", "건축 인허가 기간 단축",
    "신혼부부 특별공급 개편", "생활형 숙박시설 용도 변경"
  ];
  const items = Array.from({ length: 24 }, (_, index) => {
    const hoursAgo = index < 4 ? index + 1 : 8 + index / 10;
    const at = asOfMs - hoursAgo * 3600 * 1000;
    return {
      id: `realestate-depth-${index}`,
      title: titles[index],
      url: `https://realestate-${index}.example.com/story`,
      category: "realestate",
      source: sources[index % sources.length],
      kind: "news",
      score: 200 - index,
      coverage: 1,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });

  const edition = await snapshotEngine(items).todayEdition({
    categories: ["realestate"],
    slotId: "evening",
    asOfMs,
    allowCarryover: true
  });

  assert.equal(edition.issues.length, 14);
  assert.equal(edition.categoryFulfillment.rows[0].issueCount, 14);
  assert.equal(edition.categoryFulfillment.goalSatisfied, true);
});

test("오늘판: 영문 최신글이 앞서도 한국어 24시간 재고로 게임 분야를 채운다", async () => {
  const asOfMs = Date.parse("2026-08-11T10:00:00.000Z");
  const english = Array.from({ length: 12 }, (_, index) => {
    const at = asOfMs - (index + 1) * 60 * 1000;
    return {
      id: `english-gaming-${index}`,
      title: `Major game showcase announces a new release update number ${index + 1}`,
      url: `https://pcgamer.example.com/${index}`,
      category: "gaming",
      source: "pcgamer",
      kind: "news",
      score: 300 - index,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });
  const koreanTitles = [
    "우주 탐험 신작 확장팩 공개", "프로리그 결승전 우승팀 확정",
    "전략 게임 밸런스 패치 배포", "휴대용 콘솔 출시 일정 발표",
    "인디 게임 축제 수상작 선정", "온라인 역할 게임 신규 대륙 추가",
    "레이싱 대회 경기 규칙 개편", "퍼즐 후속작 협동 모드 공개",
    "게임 플랫폼 가족 공유 도입", "액션 신작 전투 시스템 개편",
    "호러 게임 장편 영화화 계약", "축구 게임 선수 명단 교체",
    "생존 게임 지도 제작 기능 추가", "스토리 게임 한국어 음성 지원",
    "모바일 신작 글로벌 사전예약", "가상현실 게임 후속작 발표",
    "클라우드 게임 지원 국가 확대", "게임 음악 공연 일정 확정"
  ];
  const korean = Array.from({ length: koreanTitles.length }, (_, index) => {
    const at = asOfMs - (8 + index / 10) * 3600 * 1000;
    return {
      id: `korean-gaming-${index}`,
      title: koreanTitles[index],
      url: `https://gamemeca.example.com/${index}`,
      category: "gaming",
      source: "gamemeca",
      kind: "news",
      score: 100 - index,
      publishedAt: new Date(at).toISOString(),
      firstSeenAt: at
    };
  });

  const edition = await snapshotEngine([...english, ...korean]).todayEdition({
    categories: ["gaming"],
    slotId: "evening",
    asOfMs,
    allowCarryover: true
  });

  assert.equal(edition.issues.length, 14);
  assert.equal(edition.categoryFulfillment.goalSatisfied, true);
  assert.ok(edition.issues.every((issue) => /[가-힣]/.test(issue.headline)));
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

test("서버: 오늘판 홈·선택·지난 판은 유지하고 플래그가 꺼지면 실시간으로 이동한다", async () => {
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
      Date.parse("2026-08-10T12:20:00+09:00"),
      6 * 60 * 60_000,
      SERVEABLE_SUBJECTS,
      30,
      ["business"],
      2
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
    assert.match(home, /serviceWorker\.register\("\/sw\.js"\)/,
      "오늘판만 열어도 이전 워커의 잘못된 실시간 폴백이 갱신돼야 한다");
    assert.match(home, /editionDate>today\|\|\(editionDate===today&&hour>kstHour\)/,
      "07시 전 전날 판을 보여줄 때 전날 모닝·런치 탭까지 잠그면 안 된다");
    assert.match(home, /query\.set\("date",targetDate\)/,
      "전날 판의 다른 슬롯을 누를 때 표시 날짜를 서버에 전달해야 한다");
    await fetch(`${base}/communities`).then((res) => res.text());
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
    const previousMorning = await previousMorningResponse.json();
    assert.equal(previousMorningResponse.status, 200,
      `07시 전에는 전날 모닝판을 다시 열 수 있어야 한다: ${JSON.stringify(previousMorning.serving || previousMorning)}`);
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
    assert.equal(inventory.snapshotVersion, "v30");
    assert.equal(inventory.compatibility.pass, true);
    assert.equal(inventory.state, "inventory_backlog");
    assert.equal(inventory.missingCount, inventory.slots.reduce((sum, row) => sum + row.missing, 0), JSON.stringify({
      state: inventory.state,
      slots: inventory.slots,
      segments: inventory.segments
    }));
    const lunchInventory = inventory.slots.find((row) => row.id === "lunch");
    assert.ok(lunchInventory.missing >= 13, "아직 준비되지 않은 분야별 런치판은 재수집 대상으로 남겨야 한다");
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
    assert.equal(servingGate.contractVersion, EDITORIAL_SERVING_CONTRACT.version);
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
