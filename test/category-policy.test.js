// P2-A 카테고리 정책 팩 관문 (category-policy.js, DEVCHG-NOWHOT-20260813-082).
//
// 고정 평가 표본 6·7(블루프린트 v4)을 픽스처로 동결하고, 전문 섹션 과교정
// 금지(교정은 예외여야 정상)를 반례로 증명한다. 표본 제목은 실측 스냅샷
// (.nowhot-local 판 데이터, 2026-08-13)에서 그대로 가져온 것이다.

import test from "node:test";
import assert from "node:assert/strict";

import { classifyTopics } from "../src/feed/topics.js";
import { keywordCategory } from "../src/feed/classify.js";
import {
  categoryDictionaryHits,
  specialistCorrection,
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
