# 추천 골격 재설계 설계안 (2026-07-31, 설계 검수 완료)

> 상태: **설계 확정, 미구현**. 다음 세션은 이 문서대로 구현한다.
> 배경: 페르소나 시뮬레이션 실측 — 취향 정반대 6명의 첫 페이지가 동일(1번 카드 전원 같음),
> 전 페르소나에서 첫 페이지 적중률 < 전체 평균(예외 없음). 원인은 튜닝이 아니라 골격:
> 조직 원리가 "소스 순번"이라 취향이 구성에 개입 불가 + topPerSource(K=6)가 소스 7위
> 이하를 영구 불가시화.

## 새 파이프라인 (개인화 유저 전용 — 익명은 기존 경로 유지)

```
풀 필터(기존 유지) → rankBySource (유지: 소스별 정규화가 전역 비교의 전제)
  → flatten → 아이템별 전역 점수:
      taste  = tanh(tasteScore(item, vec) / 2)
      global = hot + 0.4·taste + 0.2·min(1, collabBoost)     (덧셈 — 로지스틱 유계가 전제)
  → selectDiverse (greedy + 자격 검사 + 쿼터 룩어헤드):
      하드: 소스별 페이지 상한 ceil(0.2·limit) / minGap / [1페이지만] hated 0개·picked ≥ 0.6·limit
      매 페이지: other(중립 카테고리) ≥ 0.2·limit
      소프트: global − 0.15·log(1+노출이력) − 0.12·페이지내반복
  → decorate/markSeen/monetize (전부 그대로)
```

핵심 논거:
- 곱셈 결합 금지: hot≈0인 조용한 글에서 taste 지렛대가 0 — 결함 재생산.
- exposure 로그 페널티는 무한 증가 → "모든 소스 결국 등장" 보증 성립하되,
  예전 정수 exposure 1순위 정렬처럼 균등 배분으로 붕괴하지 않음.
- hated 하드 배제는 1페이지 한정(영구 배제는 소스 기아 보증 충돌). 2페이지부턴 감점만.
- 공급 부족 시 쿼터를 공급량으로 클램프 + pageMeta.shortfall로 정직 노출. tooOld 완화 금지.
- exhausted 재정의: `fresh.length < limit && bannedHatedCount === 0`.

## 구현 단계 (각 단계 테스트 그린으로 종료)

1. `src/feed/rank.js` 신설(무배선): rankParams/categorySets/selectDiverse/globalScore + test/rank.test.js
2. 개인화 경로 전환(topPerSource 컷은 아직 유지) — 여기서 상수 튜닝 완료
3. topPerSource 컷 제거 + feed.test.js 1004 재작성(같은 커밋 — 1004는 결함 자체를 고정 중)
4. 첫 페이지 하드 쿼터 + pageMeta/exhausted 수정 + 페르소나 테스트
5. 정리: engine.sourceTasteWeights/TASTE_QUOTA_* 삭제, 주석 갱신

## 주의 (설계 검수에서 확인된 함정)

- feed.test.js 1004·1388 일부 assertion은 "제거할 결함"을 성공 조건으로 고정 중 — 3단계에서 재작성.
- ingest.js HOT_TASTE_W(0.15)는 익명 경로 전용으로 남김. 새 경로는 RANK_TASTE_W(0.4).
- velocity 항이 바이럴 글에서 taste를 무력화할 수 있음 — rank.test.js에 "중간 격차는 taste가
  뒤집고 극단 격차는 못 뒤집는다" 고정 테스트 필수.
- 카테고리 쿼터는 분류기 정확도(~81%)에 노출 — tools/eval-classifier.mjs 정확도가 이 보장의 실질.

## 안전망 (재설계 후에도 그대로 통과해야 하는 테스트)

- feed.test.js 1309: top8 ≤60% + 전 소스 등장
- review-20260729: 검수2(유계) / 검수3(taste 순수성) / 검수4(신선도) / 검수5±3(구성비 [20%,45%] 창)
- feed.test.js 1043(단일 소스 완화 경로), 162(무중복 페이징)
