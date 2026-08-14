// P2-A 카테고리 정책 팩 관문 (category-policy.js, DEVCHG-NOWHOT-20260813-082).
//
// 고정 평가 표본 6·7(블루프린트 v4)을 픽스처로 동결하고, 전문 섹션 과교정
// 금지(교정은 예외여야 정상)를 반례로 증명한다. 표본 제목은 실측 스냅샷
// (.nowhot-local 판 데이터, 2026-08-13)에서 그대로 가져온 것이다.

import test from "node:test";
import assert from "node:assert/strict";

import { classifyTopics } from "../src/feed/topics.js";
import { keywordCategory, TitleClassifier } from "../src/feed/classify.js";
import {
  categoryDictionaryHits,
  specialistCorrection,
  aggregateReclassification,
  untrainedOverrideAllowed,
  isTranslatedTitle,
  SPECIALIST_CORRECTION_MIN_HITS
} from "../src/feed/category-policy.js";
import { FeedEngine } from "../src/feed/engine.js";

// ---------------------------------------------------------------------------
// 고정 표본 6 — 커뮤글 의미 분류: "줄여야" 속 "여야" 부분문자열 정치 오탐
// ---------------------------------------------------------------------------

test("표본 6: 더쿠 '40대가 되면 줄여야 하는 음식들'이 politics로 태그되지 않는다", () => {
  // 실측(2026-08-13 판 스냅샷): 이 제목이 topics:['politics']로 politics 칸에
  // 실렸다. 원인은 "줄여야" 안의 부분문자열 "여야".
  const topics = classifyTopics({
    title: "40대가 되면 줄여야 하는 음식들",
    url: "https://theqoo.net/hot/1",
    sourceId: "theqoo"
  });
  assert.ok(!topics.includes("politics"), `politics 오탐: ${topics}`);
});

test("표본 6 회귀 방어: 용언 어미 '-여야'는 정치가 아니다", () => {
  for (const t of ["정책은 보여야 산다", "이건 무조건 해봐야 안다던데 줄여야 하나",
    "살 빼려면 이것부터 줄여야 함"]) {
    assert.ok(!classifyTopics({ title: t, url: "https://x/1", sourceId: "theqoo" }).includes("politics"), t);
  }
});

test("표본 6 반대 방어: 진짜 '여야' 정치 제목은 계속 잡힌다", () => {
  for (const t of ["여야, 부동산 세제 개편안 논의 착수", "여야 원내대표 회동 결렬",
    "(속보) 여야 예산안 합의", "부동산 세제 개편 두고 여야 공방"]) {
    assert.ok(classifyTopics({ title: t, url: "https://x/1", sourceId: "gnews" }).includes("politics"), t);
  }
});

// ---------------------------------------------------------------------------
// 고정 표본 7 — dev.to 공지가 패션 1위: 번역 제목 "코디네이터" 속 "코디" 오탐
// ---------------------------------------------------------------------------

// 실측(2026-08-13 판 스냅샷): devto_4323325의 번역 제목. tech 선언(devto 등록
// 카테고리, 선언 자체는 점검 결과 정상)이 fashion으로 뒤집혀 패션 1위였다.
const SAMPLE7_TITLE = "안녕하세요 여러분! 저는 DEV 커뮤니티 프로그램 코디네이터인 Jem입니다.";

test("표본 7: '코디네이터' 제목이 확정 사전에서 fashion으로 가지 않는다", () => {
  assert.notEqual(keywordCategory(SAMPLE7_TITLE), "fashion");
});

test("표본 7 엔진 관통: devto 공지가 tech 선언을 유지한다", () => {
  const engine = new FeedEngine(null, []);
  const item = {
    source: "devto", kind: "community", category: "tech", topics: [],
    title: SAMPLE7_TITLE, url: "https://dev.to/devteam/hey-all-2g2",
    translated: true, originalLang: "en"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "tech");
  assert.equal(item.categoryCorrection, undefined);
});

test("표본 7 구조 관문: 번역 제목의 UNTRAINED 1히트 승격은 막힌다", () => {
  // "컬렉션"은 개발 용어(collection)의 기계번역으로도 흔히 나온다 — 표본 7과
  // 같은 계열의 외래어 충돌. 번역 제목이면 전용어 2개 이상을 요구한다.
  assert.equal(untrainedOverrideAllowed({
    toCategory: "fashion", title: "새 컬렉션 기능을 출시했습니다", translated: true
  }), false);
  // 전용어가 2개 이상이면 번역 제목이라도 허용
  assert.equal(untrainedOverrideAllowed({
    toCategory: "fashion", title: "나이키 신상 스니커즈 컬렉션 공개", translated: true
  }), true);
  // 한국어 원문은 기존 동작 유지(결함 표본 없음 — 표본 없이 임계를 넓히지 않는다)
  assert.equal(untrainedOverrideAllowed({
    toCategory: "fashion", title: "새 컬렉션 기능을 출시했습니다", translated: false
  }), true);
  // 학습된 카테고리는 이 관문의 대상이 아니다
  assert.equal(untrainedOverrideAllowed({
    toCategory: "business", title: "코스피", translated: true
  }), true);
});

test("표본 7 관문 엔진 관통: 번역 1히트는 유지, 한국어 원문 승격은 그대로", () => {
  const engine = new FeedEngine(null, []);
  const translatedItem = {
    source: "devto", kind: "community", category: "tech", topics: [],
    title: "새 컬렉션 기능을 출시했습니다", url: "https://dev.to/x/1",
    translated: true, originalLang: "en"
  };
  engine._classifyItems([translatedItem]);
  assert.equal(translatedItem.category, "tech", "번역 1히트 승격은 관문에서 막혀야");

  // 한국어 원문 커뮤글의 다히트 패션 승격은 기존대로 동작한다
  const koItem = {
    source: "theqoo", kind: "community", category: "culture", topics: [],
    title: "나이키 조던 신상 스니커즈 드로우 응모 후기", url: "https://theqoo.net/hot/2"
  };
  engine._classifyItems([koItem]);
  assert.equal(koItem.category, "fashion");
});

// ---------------------------------------------------------------------------
// specialist 관문 — 강한 기본값, 명백한 의미 충돌만 교정 (정정 6)
// ---------------------------------------------------------------------------

test("반례(과교정 금지): 한경 부동산 섹션의 금리 기사가 realestate 선언을 유지한다", () => {
  const engine = new FeedEngine(null, []);
  // NB가 아무리 확신해도(스텁: business, margin 0.2) 교정되면 안 된다 —
  // 신설 카테고리 선언 보호(UNTRAINED)가 먼저 지키고, 전용어 2개 조건도 미달.
  engine._classifier = { trained: 1000, predict: () => ({ category: "business", margin: 0.2, known: 0.9 }) };
  const item = {
    source: "hankyung-realestate", kind: "news", category: "realestate", topics: [],
    title: "금리 인상이 전세시장에 미치는 영향", url: "https://www.hankyung.com/re/1"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "realestate");
  assert.equal(item.categoryCorrection, undefined);
});

test("반례(과교정 금지): 전문 경제 섹션의 부동산 어휘 1개는 교정 근거가 못 된다", () => {
  // mk-stock(전문·business 선언)에 부동산 낱말이 하나 섞인 제목 — NB 스텁이
  // realestate를 확신해도 전용어 2개 미달이라 선언 유지.
  const engine = new FeedEngine(null, []);
  engine._classifier = { trained: 1000, predict: () => ({ category: "realestate", margin: 0.3, known: 0.9 }) };
  const item = {
    source: "mk-stock", kind: "news", category: "business", topics: [],
    title: "금리 인상이 전세시장에 미치는 영향은", url: "https://www.mk.co.kr/stock/1"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "business");
  assert.equal(item.categoryCorrection, undefined);
});

test("specialist 교정: 임계+전용어 2개 이상의 명백한 충돌만 교정되고 감사 기록이 남는다", () => {
  const engine = new FeedEngine(null, []);
  engine._classifier = { trained: 1000, predict: () => ({ category: "sports", margin: 0.2, known: 0.9 }) };
  const item = {
    source: "mk-stock", kind: "news", category: "business", topics: [],
    title: "손흥민 프리미어리그 결승골…월드컵 예선 전망", url: "https://www.mk.co.kr/stock/2"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "sports");
  assert.ok(item.categoryCorrection, "교정 감사 기록이 있어야");
  assert.equal(item.categoryCorrection.from, "business");
  assert.equal(item.categoryCorrection.to, "sports");
  assert.equal(item.categoryCorrection.rule, "specialist-semantic-conflict");
  assert.ok(item.categoryCorrection.hits.length >= SPECIALIST_CORRECTION_MIN_HITS);
  assert.equal(item.registryCategory, "business", "원 선언이 보존되어야");
});

test("specialistCorrection 단위: 각 조건이 하나라도 빠지면 교정하지 않는다", () => {
  const base = {
    declaredCategory: "business",
    title: "손흥민 프리미어리그 결승골…월드컵 예선 전망",
    prediction: { category: "sports", margin: 0.2, known: 0.9 }
  };
  assert.ok(specialistCorrection(base), "기준 케이스는 교정되어야");
  // 조건 2: NB 임계 미달
  assert.equal(specialistCorrection({ ...base, prediction: { category: "sports", margin: 0.01, known: 0.9 } }), null);
  assert.equal(specialistCorrection({ ...base, prediction: { category: "sports", margin: 0.2, known: 0.1 } }), null);
  // 조건 3: 전용어 미달
  assert.equal(specialistCorrection({
    ...base, title: "국가대표 발탁 소식에 회사가 들썩"
  }), null);
  // 조건 1: 구어체 완충재(humor 등)는 OVERRIDE_CATEGORIES 밖 — 교정 금지
  assert.equal(specialistCorrection({
    ...base, prediction: { category: "humor", margin: 0.5, known: 0.9 }
  }), null);
  // 조건 4: 대상 카테고리 문맥 가드에 걸리면 교정 금지 (science 가드의 ETF)
  assert.equal(specialistCorrection({
    declaredCategory: "business",
    title: "노벨상 논문 발표 연구진, ETF 출시 자문",
    prediction: { category: "science", margin: 0.3, known: 0.9 }
  }), null);
  // 선언과 같으면 교정 아님
  assert.equal(specialistCorrection({
    ...base, prediction: { category: "business", margin: 0.5, known: 0.9 }
  }), null);
});

test("categoryDictionaryHits: 경계 매칭을 재사용하고 맞은 낱말을 그대로 보여준다", () => {
  const hits = categoryDictionaryHits("sports", "손흥민 프리미어리그 결승골");
  assert.ok(hits.includes("손흥민") && hits.includes("프리미어리그") && hits.includes("결승골"));
  assert.deepEqual(categoryDictionaryHits("business", "금리 인상이 전세시장에 미치는 영향"), []);
  // 영문 약어 내부 부분문자열 차단(classify.js 경계 규칙)이 그대로 적용된다
  assert.ok(!categoryDictionaryHits("business", "disappeared 후기").includes("ISA"));
});

test("isTranslatedTitle: 번역 표식 필드를 한 곳에서 판정한다", () => {
  assert.equal(isTranslatedTitle({ translated: true }), true);
  assert.equal(isTranslatedTitle({ needsTranslation: true }), true);
  assert.equal(isTranslatedTitle({ originalLang: "en" }), true);
  assert.equal(isTranslatedTitle({ originalLang: "ko" }), false);
  assert.equal(isTranslatedTitle({}), false);
  assert.equal(isTranslatedTitle(null), false);
});

test("교정 감사 기록은 매 사이클 재판정된다 — 관문을 다시 못 넘으면 남지 않는다", () => {
  const engine = new FeedEngine(null, []);
  engine._classifier = { trained: 1000, predict: () => ({ category: "sports", margin: 0.2, known: 0.9 }) };
  const item = {
    source: "mk-stock", kind: "news", category: "business", topics: [],
    title: "손흥민 프리미어리그 결승골…월드컵 예선 전망", url: "https://www.mk.co.kr/stock/2"
  };
  engine._classifyItems([item]);
  assert.ok(item.categoryCorrection);
  // 다음 사이클: NB가 더 이상 확신하지 않으면 선언으로 복귀하고 기록도 사라진다
  engine._classifier = { trained: 1000, predict: () => ({ category: "sports", margin: 0.001, known: 0.9 }) };
  engine._classifyItems([item]);
  assert.equal(item.category, "business");
  assert.equal(item.categoryCorrection, undefined);
});

// ---------------------------------------------------------------------------
// aggregate 관문 — 약한 prior, NB 운영 임계 통과 시 재분류 (2026-08-13 P2
// HOLD 해소). 동결 픽스처(교정 3·유지 4·완충재 2)의 제목은 실측 스냅샷
// (.nowhot-local/feed-data-pool.json, savedAt 2026-08-13)의 실물이고, 단위
// 관문 테스트의 가드·UNTRAINED용 2건(ETF 자문·새 컬렉션)은 경계 조건 검증용
// 합성 제목이다. NB 예측 스텁의 margin·known은 스냅샷 풀
// leave-one-out 학습(402행) 실측값 또는 실측과 같은 임계 관계를 재현한 값이다.
// ---------------------------------------------------------------------------

// 실물 오분류 3건 — 선언 섹션과 제목 의미가 어긋난 aggregate 기사.
//   1) gnews-biz(business 선언)에 실린 AI 제품 출시 기사 → tech
//      (LOO 실측: NB tech margin 0.355로 유일하게 명확 통과한 실물)
//   2) gnews-tech(tech 선언)에 실린 우주 관측 기사 → science
//   3) gnews-science(life 선언·구글뉴스 건강 섹션)에 실린 유전자 연구 기사 → science
const AGG_MISCLASSIFIED = [
  {
    source: "gnews-biz", declared: "business",
    title: "딥시크 ‘V4 프로’ 정식 출시…AI 에이전트 강화·가격 인상 예고",
    to: "tech", stub: { category: "tech", margin: 0.355, known: 1.0 }
  },
  {
    source: "gnews-tech", declared: "tech",
    title: "\"초기 우주 '붉은 점', 초고밀도 가스에 둘러싸인 블랙홀\"",
    to: "science", stub: { category: "science", margin: 0.3, known: 0.9 }
  },
  {
    source: "gnews-science", declared: "life",
    title: "기존 검사로 못 찾던 천식 핵심 유전자, 새 분석법으로 찾아낸다",
    to: "science", stub: { category: "science", margin: 0.3, known: 0.9 }
  }
];

test("aggregate 교정 동결: 실물 오분류 3건이 임계 통과 시 재분류되고 감사 기록이 남는다", () => {
  for (const s of AGG_MISCLASSIFIED) {
    const out = aggregateReclassification({
      declaredCategory: s.declared, title: s.title, prediction: s.stub
    });
    assert.ok(out, `교정되어야: ${s.title}`);
    assert.equal(out.category, s.to);
    assert.equal(out.correction.from, s.declared);
    assert.equal(out.correction.to, s.to);
    assert.equal(out.correction.rule, "aggregate-semantic-reclass");
    assert.ok(Array.isArray(out.correction.hits));
    assert.equal(typeof out.correction.margin, "number");
  }
});

// 실물 정분류 유지 4건 — 진짜 경제/스포츠/연예 기사가 선언에 남는다.
// pred·margin은 LOO 실측값: 전부 임계(margin 0.08) 미달이거나 OVERRIDE 밖이라
// 관문이 기권한다. "건일 엑디즈 탈퇴"는 David 지시에 언급된 표본의 실제 소스
// 확인 결과 — gnews-biz가 아니라 gnews-ent(culture 선언, 정분류)였다.
const AGG_CORRECT_KEEP = [
  {
    source: "gnews-biz", declared: "business",
    title: "코스피 급등 출발… 삼성전자·SK하이닉스 동반 강세",
    stub: { category: "business", margin: 0.5, known: 1.0 } // 선언과 일치 — 교정 아님
  },
  {
    source: "gnews-biz", declared: "business",
    title: "스타벅스, 2분기 영업손실 184억 전년비 '적자전환'…‘탱크데이’ 논란 이어 ‘써머 프리퀀시’ 중단 여파",
    stub: { category: "culture", margin: 0.002, known: 0.42 } // LOO 실측 — 임계 미달 기권
  },
  {
    source: "gnews-ent", declared: "culture",
    title: "'언행 논란' 건일, 엑디즈 탈퇴…\"JYP 전속계약도 해지\"",
    stub: { category: "sports", margin: 0.035, known: 0.38 } // LOO 실측 — 임계 미달 기권
  },
  {
    source: "gnews-sports", declared: "sports",
    title: "LA 레이커스, 트럼프 사위 일가에 인수…125억 달러 ‘세계 구단 최고가’",
    stub: { category: "business", margin: 0.021, known: 0.39 } // LOO 실측 — 임계 미달 기권
  }
];

test("aggregate 유지 동결: 실물 정분류 4건은 선언을 유지한다", () => {
  for (const s of AGG_CORRECT_KEEP) {
    assert.equal(aggregateReclassification({
      declaredCategory: s.declared, title: s.title, prediction: s.stub
    }), null, `유지되어야: ${s.title}`);
  }
});

test("aggregate 관문 단위: OVERRIDE 밖(구어체 완충재)·가드·UNTRAINED 번역 1히트는 기권", () => {
  // humor·gaming 예측은 재분류 금지 — 기존 커뮤글 재분류 경로와 같은 규칙.
  // 제목은 실물(gnews-ent, LOO 실측 pred humor).
  assert.equal(aggregateReclassification({
    declaredCategory: "culture",
    title: "BTS, 통산 세 번째 일본 오리콘 100만 포인트...해외 가수 최초",
    prediction: { category: "humor", margin: 0.5, known: 0.9 }
  }), null);
  assert.equal(aggregateReclassification({
    declaredCategory: "tech",
    title: "승리의 여신: 니케, 페르소나 시리즈 3개와 콜라보레이션 진행",
    prediction: { category: "gaming", margin: 0.5, known: 0.9 }
  }), null);
  // 대상 카테고리 문맥 가드(science 가드의 ETF) — specialist와 같은 방어.
  assert.equal(aggregateReclassification({
    declaredCategory: "business",
    title: "노벨상 논문 발표 연구진, ETF 출시 자문",
    prediction: { category: "science", margin: 0.3, known: 0.9 }
  }), null);
  // UNTRAINED 승격 관문: 번역 제목 1히트는 막힌다(표본 7 계열 — P2-A 요구 유지).
  assert.equal(aggregateReclassification({
    declaredCategory: "tech",
    title: "새 컬렉션 기능을 출시했습니다",
    prediction: { category: "fashion", margin: 0.5, known: 0.9 },
    translated: true
  }), null);
  // NB 임계 미달은 기권 — 운영점(MARGIN_MIN 0.08·KNOWN_MIN 0.2) 재사용 확인.
  assert.equal(aggregateReclassification({
    declaredCategory: "business",
    title: "딥시크 ‘V4 프로’ 정식 출시…AI 에이전트 강화·가격 인상 예고",
    prediction: { category: "tech", margin: 0.01, known: 1.0 }
  }), null);
  assert.equal(aggregateReclassification({
    declaredCategory: "business",
    title: "딥시크 ‘V4 프로’ 정식 출시…AI 에이전트 강화·가격 인상 예고",
    prediction: { category: "tech", margin: 0.355, known: 0.1 }
  }), null);
});

// ---------------------------------------------------------------------------
// R6 (2026-08-14 David HOLD 결함 6) — 운영 조건은 이제 "자기학습 없는 판정"이다.
// 엔진은 학습 라벨 소스(gnews 전문 섹션)의 aggregate 관문 판정에 자기 기여를
// 뺀 leave-one-out 예측(predictExcluding)을 쓴다. 아래 엔진 관통 스텁은 그
// 운영 조건을 그대로 동결한다: predict(자기암기 경로)는 관문과 반대 답을 주게
// 두고, predictExcluding(LOO 경로)만 기대 판정을 준다 — 엔진이 잘못된 경로를
// 쓰면 테스트가 즉시 깨진다.
// ---------------------------------------------------------------------------

test("aggregate 엔진 관통: gnews-biz 실물 오분류가 LOO 예측으로 교정되고 원 선언이 보존된다", () => {
  const engine = new FeedEngine(null, []);
  engine._classifier = {
    trained: 1000,
    // 자기암기 경로: 학습 라벨(business)을 그대로 되뱉는다 — 이 경로를 쓰면 교정 0건.
    predict: () => ({ category: "business", margin: 0.5, known: 1.0 }),
    // 운영 경로(LOO): 자기 기여 제거 후 실측값(신선 풀 2026-08-14, margin 0.378).
    predictExcluding: (title, category, weight) => {
      assert.equal(category, "business", "학습 라벨 카테고리로 자기 기여를 빼야");
      assert.equal(weight, 1.0, "gnews 섹션 학습 가중치 1.0으로 빼야");
      return { category: "tech", margin: 0.378, known: 1.0 };
    }
  };
  const item = {
    source: "gnews-biz", kind: "news", category: "business", topics: [],
    title: "딥시크 ‘V4 프로’ 정식 출시…AI 에이전트 강화·가격 인상 예고",
    url: "https://news.google.com/rss/x1"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "tech");
  assert.ok(item.categoryCorrection);
  assert.equal(item.categoryCorrection.rule, "aggregate-semantic-reclass");
  assert.equal(item.categoryCorrection.from, "business");
  assert.equal(item.categoryCorrection.to, "tech");
  assert.equal(item.registryCategory, "business", "원 선언이 보존되어야");
});

test("aggregate 엔진 관통: 임계 미달 실물(건일 엑디즈)은 culture 선언을 유지한다", () => {
  const engine = new FeedEngine(null, []);
  engine._classifier = {
    trained: 1000,
    // 잘못된 경로(자기암기 predict)가 쓰이면 sports로 교정돼 테스트가 깨진다.
    predict: () => ({ category: "sports", margin: 0.5, known: 0.9 }),
    // 운영 경로(LOO) 실측: 임계 미달 기권.
    predictExcluding: () => ({ category: "sports", margin: 0.035, known: 0.38 })
  };
  const item = {
    source: "gnews-ent", kind: "news", category: "culture", topics: [],
    title: "'언행 논란' 건일, 엑디즈 탈퇴…\"JYP 전속계약도 해지\"",
    url: "https://news.google.com/rss/x2"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "culture");
  assert.equal(item.categoryCorrection, undefined);
});

test("aggregate 엔진 관통: 학습 라벨 밖 aggregate 소스(techmeme)는 기존 predict 경로를 쓴다", () => {
  // techmeme은 TRAIN_LABELS에 없다 — 자기학습이 없으므로 LOO를 강제하지 않는다.
  const engine = new FeedEngine(null, []);
  engine._classifier = {
    trained: 1000,
    predict: () => ({ category: "science", margin: 0.3, known: 0.9 }),
    predictExcluding: () => { throw new Error("학습 라벨 없는 소스에 LOO를 쓰면 안 된다"); }
  };
  // 제목은 확정 사전 무히트로 고른다("블랙홀"은 science 사전 히트라 관문 전에
  // 사전 확정 경로로 빠져 predict가 아예 호출되지 않는다).
  const item = {
    source: "techmeme", kind: "news", category: "tech", topics: [],
    title: "초기 우주 붉은 점의 정체에 대한 새로운 해석",
    url: "https://techmeme.com/x1"
  };
  engine._classifyItems([item]);
  assert.equal(item.category, "science");
  assert.equal(item.categoryCorrection.rule, "aggregate-semantic-reclass");
});

test("aggregate 교정도 매 사이클 재판정된다 — 관문을 다시 못 넘으면 남지 않는다", () => {
  const engine = new FeedEngine(null, []);
  const stub = (pred) => ({
    trained: 1000,
    predict: () => ({ category: "business", margin: 0.5, known: 1.0 }),
    predictExcluding: () => pred
  });
  engine._classifier = stub({ category: "tech", margin: 0.378, known: 1.0 });
  const item = {
    source: "gnews-biz", kind: "news", category: "business", topics: [],
    title: "딥시크 ‘V4 프로’ 정식 출시…AI 에이전트 강화·가격 인상 예고",
    url: "https://news.google.com/rss/x1"
  };
  engine._classifyItems([item]);
  assert.ok(item.categoryCorrection);
  engine._classifier = stub({ category: "tech", margin: 0.001, known: 1.0 });
  engine._classifyItems([item]);
  assert.equal(item.category, "business");
  assert.equal(item.categoryCorrection, undefined);
});

// ---------------------------------------------------------------------------
// R6 단위 — TitleClassifier.predictExcluding: 자기 라벨 암기가 실제로 제거되는가
// ---------------------------------------------------------------------------

test("predictExcluding: 자기 라벨로 암기된 제목이 자기 기여 제거 후 의미 분류로 돌아온다", () => {
  // 소형 결정적 코퍼스 — 운영 결함의 축소 재현: tech 어휘 코퍼스가 있는데도
  // 대상 제목이 business로 학습돼 있으면 plain predict는 business를 암기한다.
  const cl = new TitleClassifier();
  const target = "딥시크 신형 AI 에이전트 모델 정식 출시와 가격 정책";
  for (const t of [
    "오픈AI 새 인공지능 모델 발표", "구글 제미나이 모델 업데이트 공개",
    "앤스로픽 클로드 AI 기능 강화", "메타 라마 모델 성능 개선",
    "마이크로소프트 코파일럿 AI 출시"
  ]) cl.learn(t, "tech", 1.0);
  for (const t of [
    "코스피 사상 최고치 경신에 증시 환호", "한국은행 기준금리 동결 결정",
    "환율 급등에 수출 기업 실적 비상", "뉴욕증시 3대 지수 동반 상승 마감",
    "공모주 청약 경쟁률 역대 최고"
  ]) cl.learn(t, "business", 1.0);
  cl.learn(target, "business", 1.0); // 운영과 동일: gnews-biz 행이 business로 학습됨

  assert.equal(cl.predict(target).category, "business", "plain predict는 자기 라벨을 암기해야(결함 재현)");
  const loo = cl.predictExcluding(target, "business", 1.0);
  assert.equal(loo.category, "tech", "자기 기여를 빼면 의미(tech)로 분류되어야");
});

test("predictExcluding: 비파괴 — 호출 후 코퍼스 카운트·총량이 그대로다", () => {
  const cl = new TitleClassifier();
  cl.learn("코스피 급등 마감", "business", 1.0);
  cl.learn("오픈AI 신형 모델 공개", "tech", 1.0);
  cl.learn("딥시크 AI 모델 출시", "business", 1.0);
  const before = JSON.stringify(cl.toJSON());
  cl.predictExcluding("딥시크 AI 모델 출시", "business", 1.0);
  assert.equal(JSON.stringify(cl.toJSON()), before);
});

test("predictExcluding: 학습된 적 없는 카테고리·짧은 제목은 plain predict와 같다", () => {
  const cl = new TitleClassifier();
  cl.learn("코스피 급등 마감 증시 환호", "business", 1.0);
  cl.learn("오픈AI 신형 모델 공개 출시", "tech", 1.0);
  const title = "코스피 상한가 종목 속출";
  assert.deepEqual(cl.predictExcluding(title, "sports", 1.0), cl.predict(title));
});
