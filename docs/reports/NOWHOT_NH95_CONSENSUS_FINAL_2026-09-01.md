# NH95 합의 최종 라운드 — 바인딩 오너 의미론 하 기술 판정 (read-only)

- Date: 2026-09-01 (Asia/Seoul) · Reviewer: Claude Code (Fable 5), task_9c5d70a02f18
- 바인딩 의미론(요건으로 수용): ① humor(유머/일상)=일반 커뮤니티 lane — 확정 주제 없는 mixed 글 잔류 허용(등록 게시판 주제 비상속) ② 명백한 분야 전문지는 기존 교정 정책 후 직접 라우팅(홈피드라는 이유로 LLM 보내지 않음) ③ 종합뉴스/aggregate 모호분만 withheld.

## 판정: **CONVERGE_GO** (5문장)

1. 최종안은 내 P0 2건(RSS/Atom 서브시스템 제거, 패킷 시점 물질화+정본 게이트 4-basis 수용+투영 전용 라우터)과 P1 불변식 전부(만장일치 vote, deterministic의 prior 재사용 영구 금지, 모델 유래 prior만 재사용, legacy_classifier_fallback 우선순위 부재, 순삭제 위주 무과잉)를 기술적으로 충족하고, 산술도 정확하다(2022+176=2198, 14분야 합계 2022, 다기사 evidence 그룹 1건은 pool 2199−targets 2198과 정합).
2. 내 2라운드 tweak(neutral humor 제외)은 바인딩 의미론 ①이 명시 오버룰했고, 이는 David 2026-08-02 원칙(게시판 등록값 비상속)을 침해하지 않는 정당한 제품 정의이므로 기록만 남기고 수용한다 — humor lane 하류의 promotion 저가치 가드는 현행 유지가 전제다.
3. marketwatch-top 유지도 레지스트리에 실측 근거("표본 제목 전부 시장·투자·기업 실적, 혼합 섹션 아님")가 기록돼 있고 조항 (b)의 specialistCorrection이 기사 단위 교차주제 안전망으로 남으므로 기술 결함이 아니다.
4. vote 모델(무자격 기사는 무투표, 유자격 vote ≥1 + 전원 일치 시에만 deterministic)은 2라운드의 전원-유자격 요건보다 단순하며, 동일 텍스트 전재본에 전문지 vote가 투영되는 것은 evidenceHash 동일성 전제에서 안전하고 충돌은 fail-closed다.
5. 잔여 절차 2건은 구현 라운드 전제 조건으로 유지한다: 블루프린트 NH92(`specialist_registry_default` 금지)·NH93.2(basis 집합) truth 라인의 David 승인 개정, 그리고 활성 전 무과금 재생의 lane별 사건(클러스터) 수 ≥13 영수증.

## 양보 불가 테스트

1. `test/selection-d2d.test.js` — vote 4픽스처: 유자격 vote 불일치→withheld / 유자격 1 + 무투표(gnews 종합) 혼재→deterministic / 유자격 0→withheld / 우선순위(prior 모델 > 현재 deterministic, prior deterministic·비모델 basis는 재사용 무시).
2. `test/category-routing.test.js` — 라우터 투영 전용: URL·발행사 라벨·declared-section·missing-entry·stale·post-snapshot 경로 삭제를 각각 픽스처로 증명(entry 없는 아이템 drop), ROUTING_BASES에 `deterministic_tier_policy` 수용.
3. `test/slot-canonical-edition.test.js` — 정본 게이트 {current_model, prior_exact_hash, deterministic_tier_policy, 빈 withheld} 수용·legacy/미지 거부; pool=packet=routing ID 정확 일치; 13층 미달 HOLD + last-good 포인터·성인 게이트·요청 중 LLM 0 불변.
4. 동결 풀 무과금 재생 영수증 — 2198/2022/176/0·분야 카운트·다기사 그룹 1건 바이트 재현, paid calls 0, 활성 포인터 SHA `0306f917…` 불변.
5. 레지스트리 픽스처 — marketwatch-top specialist/business 유지 + 조항 (b) 경로로 vote(specialistCorrection 적용 확인); gnews 종합·딜·미지 소스는 무투표.

- First Principles 게이트: PASS · 금지선: 수정·실행·과금·활성·커밋 없음(본 보고서 신규 1건) · David 행동: truth 라인 개정 승인(구현 라운드 전)
