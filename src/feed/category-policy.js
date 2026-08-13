// P2-A 카테고리 정책 팩 관문 — 분류 이원화의 단일 정의 (DEVCHG-NOWHOT-20260813-082).
//
// 블루프린트 v4 정정 1(공통 엔진/정책 팩 분리)·정정 6(전문 섹션은 분류 금지가
// 아니라 **강한 기본값, 명백한 의미 충돌만 교정**)의 코드 정본. 분류기 자체
// (NB·사전·가드)는 classify.js가 계속 갖고, 이 파일은 "어느 tier에서 어떤
// 재분류가 허용되는가"라는 **관문 규칙 한 벌**만 갖는다. engine._classifyItems가
// 소비한다.
//
// ── tier별 계약 (communities.json sourceTier, P1-A 산출) ──────────────────
//
// specialist  소스 선언 카테고리가 **강한 기본값**. 재분류는 "명백한 의미
//             충돌"일 때만 — 아래 specialistCorrection의 보수적 정의를 따르고,
//             교정 시 원 카테고리·사유를 categoryCorrection으로 남긴다(감사).
//             기존의 좁은 제목 확정 예외(auto·gaming·science,
//             SECTIONED_NEWS_TITLE_OVERRIDES)는 실측으로 검증된 경로라 유지한다.
// aggregate   소스 선언은 약한 prior — 제목 의미 분류(확정 사전·NB 임계 통과)가
//             이기면 재분류 허용. 기존 경로 그대로: 구글뉴스 종합 섹션은
//             news가 정답이고 학습 라벨 소스는 재분류 금지(classify.js
//             isReclassifiable) — 이 예외들은 실측 근거가 있어 좁히지 않는다.
// community   제목 의미 분류(확정 사전 → mixed 폴백 → NB, 기존 커뮤글 경로).
//             UNTRAINED 카테고리 보호(분류기가 못 배운 신설 카테고리 선언을
//             덮지 않는 규칙)도 그대로.
//
// ── "명백한 의미 충돌"의 보수적 정의 (specialist 교정 조건, 전부 AND) ──────
//
//  1. NB 예측이 선언과 다르고, 예측 카테고리가 OVERRIDE_CATEGORIES(주제 어휘로
//     학습된 것)에 속한다 — 구어체 완충재(humor·gaming 예측)로는 교정 안 함.
//  2. NB 신뢰도가 운영 임계 이상: margin ≥ MARGIN_MIN(0.08)·known ≥ KNOWN_MIN(0.2)
//     — 임계는 라이브 홀드아웃 스윕 실측값(classify.js 2026-07-29)을 재사용한다.
//     새 숫자를 발명하지 않는다.
//  3. 대상 카테고리 **전용 사전 신호가 제목에 2개 이상** — 통계 신뢰도만으로는
//     교정하지 않고, 설명 가능한 어휘 근거를 요구한다(예: 부동산 섹션 글을
//     business로 보내려면 "코스피"·"뉴욕증시" 같은 경제 전용어가 2개 이상).
//  4. 대상 카테고리 문맥 가드(categoryGuardReason)에 걸리지 않는다.
//
// 이 조건을 모두 넘지 못하면 **전부 소스 선언 유지**다. 교정은 예외여야 정상
// — 오탐 방지 반례: 한경 부동산 섹션 "금리 인상이 전세시장에 미치는 영향"은
// 타 분야 어휘가 섞여 있어도 조건 3(전용어 2개)에 못 미쳐 realestate로 남는다
// (test/category-policy.test.js 픽스처).

import {
  CATEGORY_KEYWORDS,
  OVERRIDE_CATEGORIES,
  UNTRAINED_CATEGORIES,
  MARGIN_MIN,
  KNOWN_MIN,
  categoryGuardReason,
  includesCategoryKeyword
} from "./classify.js";

// 조건 3의 "2개 이상". 이 숫자는 스윕 산출이 아니라 관문 설계값이다: 1개는
// 표본 7("코디네이터" 속 "코디" 1히트)이 실측으로 보여준 오탐 단위이고, 교정
// 임계를 표본 없이 넓히지 않는다는 경계 규칙에 따라 최소한만 올렸다.
export const SPECIALIST_CORRECTION_MIN_HITS = 2;

const KEYWORDS_BY_CATEGORY = new Map(CATEGORY_KEYWORDS);

// 제목에서 category 전용 사전에 맞은 낱말 목록. classify.js의 경계 매칭
// (영문 약어 내부 부분문자열 차단)을 그대로 재사용한다 — 재발명 금지.
export function categoryDictionaryHits(category, title) {
  const words = KEYWORDS_BY_CATEGORY.get(category) || [];
  const lower = String(title || "").toLowerCase();
  const hits = [];
  for (const w of words) if (includesCategoryKeyword(lower, w)) hits.push(String(w));
  return hits;
}

// specialist tier의 유일한 통계 교정 관문. 통과하면
// { category, correction: { from, to, rule, hits, margin } }, 아니면 null.
// correction은 아이템의 categoryCorrection 필드로 저장돼 감사 가능해야 한다.
export function specialistCorrection({ declaredCategory, title, prediction } = {}) {
  if (!prediction || !prediction.category) return null;
  const predicted = prediction.category;
  if (!declaredCategory || predicted === declaredCategory) return null;
  if (!OVERRIDE_CATEGORIES.has(predicted)) return null; // 조건 1
  const margin = Number(prediction.margin);
  const known = Number(prediction.known);
  if (!(margin >= MARGIN_MIN) || !(known >= KNOWN_MIN)) return null; // 조건 2
  const hits = categoryDictionaryHits(predicted, title);
  if (hits.length < SPECIALIST_CORRECTION_MIN_HITS) return null; // 조건 3
  if (categoryGuardReason(predicted, title)) return null; // 조건 4
  return {
    category: predicted,
    correction: {
      from: declaredCategory,
      to: predicted,
      rule: "specialist-semantic-conflict",
      hits,
      margin: Math.round(margin * 1000) / 1000
    }
  };
}

// 번역 제목이 확정 사전으로 UNTRAINED 카테고리(realestate·fashion·art)에
// 승격되는 것을 막는 관문 — 표본 7 계열의 구조적 방어.
//
// 왜 번역 제목만인가: 사전은 한국어 원문 커뮤니티/뉴스 제목으로 검증됐고,
// 실측 결함(표본 7)은 기계번역이 만든 외래어 충돌("코디네이터")에서 났다.
// 한국어 원문의 1히트 승격(예: 더쿠 "청년주택청약 비과세 폐지" → realestate)은
// 결함 표본이 없으므로 기존 동작을 유지한다 — 표본 없이 임계를 넓히지 않는다.
export function untrainedOverrideAllowed({ toCategory, title, translated } = {}) {
  if (!UNTRAINED_CATEGORIES.has(toCategory)) return true;
  if (!translated) return true;
  return categoryDictionaryHits(toCategory, title).length >= SPECIALIST_CORRECTION_MIN_HITS;
}

// engine이 번역 여부를 한 곳에서 판정하게 하는 도우미 — 필드가 소스 어댑터마다
// 조금씩 다르게 남는 것(translated/needsTranslation/originalLang)을 흡수한다.
export function isTranslatedTitle(item) {
  if (!item) return false;
  if (item.translated || item.needsTranslation) return true;
  return Boolean(item.originalLang && item.originalLang !== "ko");
}
