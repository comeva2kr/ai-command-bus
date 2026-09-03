# NH94 최종 독립 적대 검수 (Claude Fable 5, read-only)

- Date: 2026-09-01 (Asia/Seoul) · Reviewer: dispatched worker task_9c571cb1144c
- Scope: dirty worktree 전체 bytes(HEAD `e79856c` + uncommitted), 대상 5파일·4테스트·Blueprint NH94·동결 재생 산출물·활성 포인터. 프로덕션 코드·테스트·픽스처·포인터·산출물 무수정(본 보고서 1건만 생성). 검증용 테스트 실행만 수행(임시 파일은 세션 스크래치패드).

## 판정: **GO** — P0 0건 · P1 0건

합의된 제품 의미론과 기술 계약이 현재 bytes에 전부 구현돼 있고, 전체 회귀 **1,813/1,813 PASS**(직접 실행), `git diff --check` PASS, 동결 재생 산출물이 코디네이터 주장 수치와 바이트 단위로 일치하며, 활성 포인터는 변경되지 않았다.

---

## 1. 코드 진실 (직접 확인)

| 요구 | 확인 | 근거 |
|---|---|---|
| 투표 자격: 커뮤니티→humor 허용, 전문지 post-engine `article.category`, aggregate 비일반 섹션 투표, 일반뉴스/딜/미지 무투표 | ✅ | `deterministicRoutingVote`(prepare-selection-shadow.mjs) — `feedGroup:"deal"` 선차단, community×community, specialist+known category, aggregate+category≠news 만 투표; 무meta·비뉴스 kind는 null |
| 유자격 만장일치만, 일반뉴스 sibling 비거부권 | ✅ | 투표는 evidenceHash별 Set — 무투표 기사는 Set에 안 들어가 `size===1` 판정에 영향 없음; 불일치 시 deterministicRouting 미부여 |
| 우선순위 current_model > 모델유래 prior만 > 현재 패킷 deterministic > withheld | ✅ | recovered 빌더: `reusablePrior`가 `["current_model","prior_exact_hash"]`만 수용, 그 다음 `deterministicRouting(target)`, 아니면 withheld. plain 빌더: model > deterministic > withheld |
| deterministic은 prior 재사용 불가 | ✅ | prior의 `deterministic_tier_policy` 행은 reusablePrior 불통과 → 매 패킷 재계산만. basis 없는 구형 prior도 `withheld`로 강등돼 재사용 차단 |
| 라우터 투영 전용 + 성인 게이트 | ✅ | category-routing.js 140줄로 축소 — URL 사전·발행사 라벨·declared_section·stale 폴백·post-snapshot 경로 전부 삭제, `entry.categories` 없으면 drop, adult/unsafeForLead 게이트 유지, stale은 `_stale` 표기만 |
| 정본 게이트 4-basis만 | ✅ | `assertSemanticPublicationRouting`: current_model·prior_exact_hash·deterministic_tier_policy·빈 withheld; legacy/specialist_registry_default 거부 |
| pool=packet=routing 정확 일치 | ✅ | `assertSamePoolInputs`가 3자 ID 집합 동일성 검사 |
| 13층·성인·last-good·요청 LLM 0 | ✅ | `assertSemanticLaneCoverage` 요약 전 실행, 해외 주요매체는 관측 영수증화(차단 플로어 삭제 — NH93 무쿼터 정합), receipt `requestPathWork:"pointer_read_and_filter_only"` |
| `--allow-legacy-fallback` 제거 | ✅ | CLI 플래그·분기·recoveryPolicy 문자열 전부 삭제 — 레거시 부활 경로 없음 |

`deterministicRouting()` 검증기는 패킷의 주입 행도 방어한다(shape·단일 분야·contentType==contentKindHint 불일치 시 빌드 실패) — 패킷 위조로 게이트를 우회할 수 없다.

## 2. 테스트 진실 (직접 실행)

- 전체 `npm test` **1,813/1,813 PASS** (19.98s), 지목 5파일 focused 91/91 PASS.
- 요구 의미론 6종이 한 적대 픽스처에 전부 있다(selection-d2d "NH94: 엔진 최종 분야는 명확한 소스만 투표…"): community→humor 투표, specialist 투표, 섹션 투표, 일반뉴스 무투표, 딜 무투표, 충돌 보류, **general sibling이 specialist 투표를 무효화하지 않음**.
- 우선순위·무근거 prior 비재사용·API 장애 복구의 무레거시(category-routing.test.js), 게이트 수용/거부·13층 사전검사·해외 관측 영수증화(slot-canonical-edition.test.js), 라우터 무재분류·스냅샷 밖 보류·stale 보류(category-routing/local-editorial-edition) 모두 신규 테스트로 고정됐다.

## 3. 제품 진실 (동결 재생 — 바이트 검증)

- `.nowhot-local/nh94-verification-20260901/`: packet 2,199 기사/2,198 target(다기사 evidence 그룹 정확히 1), routing 2,199 entries — **deterministic 1,923 target(기사 1,924)·withheld 275·current_model 0·충돌 0**. 코디네이터 수치와 일치.
- 이전 2,022/176 산수 오류의 실체 확인: 딜 6소스(전부 `feedGroup:"deal"`, 등록 category **life**)의 99건이 과거 life로 투표하던 것을 무투표로 봉인 → life 202→103, withheld 176→275. **딜을 라이프 편성 재료로 쓰지 않게 된 것이라 제품적으로도 옳다.**
- 해시 사슬 무결: routing.source.packetSha256 == sha(packet.json) == receipt.packetSha256, candidate artifactId == contentSha256 접두 ✓.
- 후보 SCE-5ef1ac07d78811ca: 195 고유 이슈, 14 lane×14, 상세 source_unavailable 49 + excerpt_only 146 = 195(pending 0), llmUsage `[]`, activatedFile `null` — 전부 주장과 일치.
- **성격 규정(중요)**: 이 후보는 current_model 0 — 순수 deterministic 재생이므로 **계보·게이트 메커니즘 증명이지 의미 분류 품질 증명이 아니다**. 같은 슬롯의 활성판(SCE-e35dc283, 모델 판정 포함)을 대체할 근거가 아니며, 실제 상품판은 신선한 풀 + 모델 실행(current_model>0)으로 만들어야 한다. 활성화하지 않은 현재 상태가 정확히 옳다.

## 4. 라이브 진실

- 활성 포인터 `.nowhot-local/slot-editions/active.json`: `2026-08-28:evening` = **SCE-e35dc2831e2ac6f1** (contentSha256 `e35dc283…6cf`) — **불변** ✓. 검증 후보는 별도 디렉터리에만 존재, 포인터 미참조.
- 커밋·푸시·배포·유료 호출 없음(worktree만 dirty, llmUsage 빈 배열).
- Blueprint NH94 절(1793행~)과 truth 라인이 구현 의미론과 일치(PACKET_DETERMINISTIC_VOTE·MODEL_ONLY_PRIOR_REUSE·PROJECTION_ONLY_REQUEST_ROUTER·ACTIVE_POINTER_UNCHANGED 등).

## P2 (기록만, 차단 아님)

- `ROUTING_BASES`에 `specialist_registry_default`·`legacy_classifier_fallback` 이름이 구형 스냅샷 파일 검증 호환용으로 남아 있고, 라이브 v2 라우터는 basis 무관하게 categories 있는 entry를 투영한다(구형 파일의 무basis 행 포함). 정본 발행은 게이트가 봉인하고 현재 어떤 도구도 레거시 basis를 생산하지 못하므로 위험은 구형 파일을 라이브 v2에 수동 공급하는 경우로 한정된다 — 다음 정리 라운드에서 이름 제거 또는 로드 시 거부를 결정하면 된다.

---

## WRC 보고 필드

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: Blueprint NH94 절, 본인 선행 보고 3건(NH95 시리즈)
  - 미읽음/불가: WRC 스타트 게이트 전문(선행 라운드와 동일 — dispatched TASK가 범위·금지선 완결 지정)
  - 이번 작업 전용 파일: 지목 5코드파일 현재 bytes + diff, 지목 4테스트 diff, communities.json 딜 6행, 재생 산출물 4종, active.json
- 적용한 규칙: 13 First Principles 게이트, 수정·개발 범위 법칙(read-only, 보고서 1건), 이익 우선·default-GO
- First Principles 게이트: PASS
- 금지선 준수: 프로덕션·테스트·픽스처·포인터·산출물 무수정, 유료 호출 0, 활성/커밋/배포 없음. 테스트 실행은 검증 목적(스크래치패드 TMPDIR).
- David 행동 필요 여부: 이번 검수 자체로는 없음. 실제 상품판 활성은 신선한 풀+모델 실행 결과를 별도 검수 후 결정(P2 정리도 그때).
- Telegram 알림 필요 여부: 코디네이터 판단 위임
- 이익 우선·과잉방어 점검: 딜 99건 무투표는 기능 축소가 아니라 오편성 제거; 레거시 폴백 전면 삭제로 유지비 감소. 과잉 조치 없음.
- 하지 않은 일: 코드·문서 수정, 신선한 풀 수집, 유료 재분류, 활성화, NH92 활성판 재검증
