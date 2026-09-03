# NH95 합의 2라운드 — 수정 최소안 검증 (read-only)

- Date: 2026-09-01 (Asia/Seoul) · Reviewer: Claude Code (Fable 5), task_8f1b40423230
- 대상: 코디네이터 수정안 (RSS/Atom 제외·패킷 시점 deterministic_tier_policy 물질화·라우터 투영 전용·current_model > prior(모델만) > deterministic > withheld·동결 풀 2198/2022/176/0·marketwatch-top 레지스트리 정정)

## 판정: **TWEAK** (5문장)

1. 수정안은 내 P0 2건과 P1-1·P1-2·P1-4를 전부 해소한다 — RSS/Atom 삭제, 패킷 시점 물질화+명명 basis+투영 전용 라우터, evidenceHash 만장일치, 모델 출력만 prior 재사용, deterministic 매 패킷 재계산·prior 재사용 금지, marketwatch-top의 aggregate/news 정정, legacy_classifier_fallback은 우선순위에 아예 없어 부활 위험 0, 순삭제 위주라 과잉설계도 아니다.
2. 산술도 현재 bytes와 정합한다: `life`는 실재 14분류의 하나(taxonomy.js:16), 2022+176=2198, 분야 합계 2022 일치.
3. 남은 결함 하나: 조항 (a) "community kind after mixed-board/definite policy"는 엔진이 provenance 없이 최종 category만 남기므로(engine.js:1323-1329) **NB 기권→`MIXED_NEUTRAL_CATEGORY`(humor) 낙하 행이 humor 384 안에 deterministic으로 섞인다** — "분류 불가"를 의미 humor로 발행 근거화하는 것은 NH94 D2("발행 게이트로는 부적격")와 David 2026-08-02 원칙(종합게시판은 등록값 상속 금지)에 정면 위배다.
4. Tweak은 한 가지뿐이다: community 행은 definite 사전/게시판 규칙 히트가 있을 때만 deterministic으로 하고, neutral-fallback 유래 humor는 withheld(→shortlist 후보)로 남기며, 패킷에 community 하위 근거(definite|board_fallback|neutral) 영수증을 기록한다 — humor lane은 실제 유머 게시판 공급이 커서 13층은 유지될 가능성이 높고, 안 되면 정직 HOLD가 맞다.
5. 이 한 조항을 반영하면 다음 라운드는 CONVERGE_GO이며, 블루프린트 NH92/NH93.2 truth 라인 개정(David 승인)과 무과금 재생의 lane별 사건 수 영수증은 활성 라운드 전 필수 절차로 유지한다.

## 양보 불가 테스트 (구현 라운드)

1. `test/category-routing.test.js` — 라우터는 스냅샷 entry만 투영: URL 섹션·발행사 라벨·missing-entry declared·stale fallback·post-snapshot 경로 삭제를 픽스처로 각각 증명(entry 없는 아이템 → drop, fail-closed 의도 명시); ROUTING_BASES가 `deterministic_tier_policy` 수용.
2. `test/selection-d2d.test.js` — 같은 evidenceHash·다른 최종 분야 2소스 → withheld(0-conflict를 강제로 증명, 가정 금지); 우선순위 테스트: prior 모델 행이 현재 deterministic을 이기고, prior deterministic 행은 무시(재사용 금지).
3. `test/slot-canonical-edition.test.js` — assertSemanticPublicationRouting 허용집합 {current_model, prior_exact_hash, deterministic_tier_policy, 빈 withheld} 수용·legacy/미지 basis 거부; pool=packet=routing 정확 일치·13층 미달 HOLD·last-good 포인터 불변.
4. **신규 적대 픽스처** — mixed 게시판 기권→neutral humor 행은 withheld, definite 사전/게시판 humor 행은 deterministic; 패킷 영수증에 community 하위 근거 카운트.
5. 레지스트리 픽스처 — marketwatch-top=aggregate/news→withheld; gnews 종합(news 선언)→withheld; gnews-biz(비news 선언)→aggregateReclassification 후 deterministic.
6. 동결 풀 무과금 재생 영수증 — 2198/2022/176/0과 분야 카운트를 바이트 재현하고, neutral 제외 후 humor·전체 카운트를 재기록.

- First Principles 게이트: PASS · 금지선: 수정·실행·활성·과금 없음(본 보고서 신규 1건) · David 행동: tweak 채택 + truth 개정 승인
