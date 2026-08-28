# NOWHOT-B6-CATEGORY-UNIQUE-FULFILLMENT-REPAIR-001

- 변경: `DEVCHG-NOWHOT-20260811-060`
- 환경: local only
- 외부 반영: 없음
- 판정: `local_repair_pass_with_limits`
- 운영 승격: BLOCK 유지

## 확인한 결함

기존 `NOWHOT-EDITORIAL-FULFILLMENT-CONTRACT-001` v3는 최종 이슈의
`categoryIds`를 모두 순회했다. 따라서 이슈 한 건에 `business`와 `realestate`가
함께 있으면 두 분야의 최소 깊이에 각각 한 건씩 더했다. 한 사건이 두 분야를 동시에
채워 공급을 실제보다 넉넉하게 보이는 결함이었다.

RED에서 다음 세 반례를 고정했다.

1. 공유 이슈 한 건이 목표 1건인 두 분야를 모두 충족했다.
2. 공유 이슈 두 건이 목표 2건인 두 분야를 모두 충족했다.
3. 전용 이슈와 공유 이슈를 올바르게 재배정할 계약 영수증이 없었다.

결과는 `5/8 PASS · 3 FAIL`이었다.

## 수리 계약

충족 계약을 v4로 올리고 최종 이슈 한 건의 선택 분야 크레딧을 최대 한 곳으로
제한했다.

1. 공급이 적은 분야부터 배정한다.
2. 분야마다 첫 번째 고유 사건을 먼저 배정한 뒤 두 번째, 세 번째 깊이로 순환한다.
3. 전용 이슈를 공유 이슈보다 먼저 써서 가능한 분야 충족을 놓치지 않는다.
4. 이미 배정된 공유 이슈도 최대 매칭으로 재배정할 수 있다.
5. 최소치 배정 뒤 남은 최종 이슈도 한 분야에만 귀속한다.

고정 표본 수나 새 수집량을 만들지 않았다. 외부 LLM 호출도 없다.

## 영수증 의미

- `eligibleIssueCount`: 해당 분야로 볼 수 있는 최종 이슈 수. 다른 분야와 겹칠 수 있다.
- `issueCount`: 다른 선택 분야와 겹치지 않게 실제 충족에 반영한 고유 배정 수.
- `crossCategoryAssignedAwayCount`: 해당 분야에도 적합하지만 다른 선택 분야에 배정한 수.
- `selectedEligibleIssueCount`: 선택 분야 중 하나 이상에 적합한 서로 다른 최종 이슈 수.
- `uniqueCreditedIssueCount`: 선택 분야 최소치에 한 번씩만 반영한 서로 다른 이슈 수.
- `multiCategoryIssueCount`: 선택 분야 태그가 둘 이상인 최종 이슈 수.

`uniqueCreditedIssueCount`는 `selectedEligibleIssueCount`를 넘지 않으며, 분야별
`issueCount` 합계와 같다. 모든 선택 분야가 고유 배정 기준으로 `met`일 때만
`fulfillment_complete`다. 부족한 판은 기존 정확 응답 서빙 계약에서
`category_fulfillment_hold`로 닫힌다.

## GREEN

- 핵심 충족 회귀: `8/8 PASS`
- 정확 응답 서빙 포함 회귀: `16/16 PASS`
- 실제 판본·재고·신뢰도 통합 회귀: `22/22 PASS`
- 전체 회귀: `1,125/1,125 PASS`
- 외부 LLM 호출: 0회
- 운영·광고·계정·배포 변경: 0건

## 남은 경계

이 수리는 최종 판본에서 한 사건을 여러 선택 분야 최소치에 중복 가산하는 문제만
폐쇄한다. 분야 태그 자체의 의미 정확도, 기사 사실성, 사람 편집 품질, 장기 개인화
효용, 다일 운영 안정성을 증명하지 않는다.

다음 한 단계는 `B6-FEEDBACK-ROLLBACK-REPAIR`다. 명시 평가 뒤 묵시 신호를 쌓고
평가를 해제해도 저장 평가, 특징 벡터, `feedbackCount`가 대조 사용자와 같아지는지
재시작까지 포함해 먼저 반례로 고정한다.
