# NOWHOT NH117 Fable 광고 검토 — 쿠팡 부재 원인과 AdFit 심사 모드 정책 대조 (2026-09-05)

- 검토자: Claude Fable 5.1 (읽기 전용, Orca 워커 `task_aaae7de31ba5`)
- 대상: `/Users/hyundonghwang/Documents/NowHot-Local-Dev`, HEAD `da7cb32` (branch `codex/adfit-content-rescue-20260810`)
- 범위: 소스 라인 추적 + 정책 문서/커밋 이력 대조. 코드·테스트 수정, 테스트 실행, 배포, 광고 계정·유료 API 접근 없음. 생성 파일은 이 보고서 1건.
- 아래 소스 라인은 HEAD `da7cb32` 기준이다. 검토 도중 작업 트리에 root의 미커밋 수정(`src/feed/server.js`, `test/briefing-quality.test.js`)이 나타났고, §5에서 별도로 다룬다. 작업 트리에서는 3579행 이후 라인이 2행씩 위로 이동한다.

## 1. 결론 3줄

1. 쿠팡 광고가 전부 사라진 직접 원인은 운영 환경의 `ADFIT_ENABLED=1` + `ADFIT_UNIT_MOBILE`이 켜는 **AdFit 심사 모드**가 Live 쿠팡까지 끄도록 구현돼 있기 때문이다. 편집 지면의 쿠팡 제거는 문서화된 정책이지만, **Live(`/live`, `/api/config`, `/api/feed`)의 쿠팡 제거는 정책 문서에 없는 자체 부과 구현**이다.
2. 자체 부과 구현은 세 줄이다: `src/feed/server.js:2134`(엔진 차단), `:3583`(`monetization.enabled` 강제 false), `:3636`(`coupang` null). 2026-08-13 로컬 체크포인트에서 두 줄이 생겼고, 2026-09-04 NH112가 세 번째 줄을 추가해 운영에 배포했다.
3. 편집 지면 AdFit 단일 배치와 Live 쿠팡 복원은 **서로 다른 코드 경로**라 양립한다. 편집 지면 게이트(`adPage`·`displayAdHtml`·`adLoadersHtml`)는 손대지 않고 위 세 줄만 걷어내면 정책 문서(`NOWHOT_ADFIT_RESCUE_001.md`) 승인 조건 4·5를 그대로 만족한다. root의 작업 트리 수정이 정확히 이 범위다.

## 2. 현재 동작 추적 (HEAD `da7cb32`)

| 구분 | 소스 | 동작 |
|---|---|---|
| 심사 모드 판정 | `src/feed/server.js:2132-2133` | `ADFIT_ENABLED === "1" && ADFIT_UNIT_MOBILE` 이면 true. 한 곳에서만 판정(`test/inline-js.test.js:64-77`이 고정). |
| **Live 차단 ①** | `src/feed/server.js:2134` → `src/feed/engine.js:2401` | `engine.monetizationDisabled = adfitReviewMode()`. `_monetize()`가 빈 슬롯을 반환해 `/api/feed`의 `via:"ad"` 카드(hot·latest·deals 공통)가 0건. |
| **Live 차단 ②** | `src/feed/server.js:3581-3583` | `monetization.enabled = !reviewMode && (COUPANG_PARTNER_ID \|\| AD_PREVIEW)`. 클라이언트 상단 제휴 고지 배너(`index.html:1835`)가 숨는다. |
| **Live 차단 ③** | `src/feed/server.js:3636` | `coupang = reviewMode ? null : {...}`. 클라이언트 삽입 경로 `maybeInsertAdfit()`(`index.html:2238-2243`)이 `!unit && !cp`로 즉시 return → 화면 삽입 쿠팡 카드 0건. |
| 편집 지면 쿠팡 배너 OFF | `src/feed/server.js:2147-2148` | `adPage()`가 심사 모드면 빈 문자열 반환. `/briefing`·`/report` 등(3129·3336·3470행 호출)에서 쿠팡 배너 제거. **정책 요구 사항.** |
| 편집 지면 AdFit 1단위 | `src/feed/server.js:2366-2371`, `2384-2388`, `2583`, `2588`, `4706-4707` | 색인 가능한 편집 페이지와 Today 정적 셸에 `kakao_ad_area` 1개 + Kakao SDK 로더. AdSense는 심사 모드에서 미로드. **정책 요구 사항.** |
| Live에 AdFit 단위 미전달 | `src/feed/server.js:3613` | `adfit = { mobileUnit: null, reviewMode }`. `ensureAdfitPlacement()`(`index.html:2191-2193`)는 unit 없으면 아무것도 안 그림, 피드 내 AdFit은 `useAdfit = false`(`index.html:2279`)로 원래 꺼져 있음. **정책 요구 사항.** |

즉 운영에서 관측된 `monetization.enabled=false`, `adfit.reviewMode=true`, `coupang=null`은 코드가 설계대로 동작한 결과이며, 세 차단 모두 `ADFIT_ENABLED=1` 하나에 묶여 있다. 운영 VM에 이 플래그가 켜져 있다는 점은 공개 `/api/config`의 `reviewMode=true`로 확인된다(직접 VM 확인은 이번 범위 밖).

## 3. 정책 원문 vs 자체 부과 구현

### 3.1 문서화된 정책 (실제 정책)

- `docs/NOWHOT_ADFIT_RESCUE_001.md:13` — "AdFit 심사 모드: 편집 지면당 AdFit 최대 1개, AdSense·쿠팡 동시 노출 금지, `/live` 광고단위 전달 금지."
- 같은 문서 승인 조건 4·5(`:27-28`) — "심사 모드의 `/`에는 AdFit 한 단위만 있고 AdSense·쿠팡이 없다" / "심사 모드의 `/live`에는 AdFit 광고단위와 광고 네트워크 로더가 없다."
- 같은 문서 로컬 검증 영수증 — 심사 모드 `/live`는 "피드 카드 10개 확인, AdFit/AdSense 실제 지면 0개"만 확인. 쿠팡 부재는 요구도 확인도 하지 않았다.
- `docs/monetization.md:393-395` — 동일 정책. "심사 모드가 아니면 기존 쿠팡 피드 수익화는 유지"라고만 적혀 있고, 심사 모드에서 Live 쿠팡을 끄라는 문장은 없다.
- 외부 근거: Kakao 보류 사유는 "외부 콘텐츠·외부 링크 비중"과 "성인 콘텐츠 토글"(`docs/monetization.md:360-365`, `NOWHOT_ADFIT_SHADOW_REPORT_2026-08-17.md:32-34`). 제휴 링크 동시 노출을 금지하는 Kakao 규정은 저장소 어디에도 인용돼 있지 않다.

정리: 정책은 **편집 지면**에서 쿠팡을 빼고 **`/live`에 AdFit 단위·SDK를 주지 않는 것**까지다. `/live`의 쿠팡 제휴 카드 제거는 정책 요구가 아니다.

### 3.2 자체 부과 구현 (이력)

| 시점 | 커밋 | 내용 |
|---|---|---|
| 2026-08-10 | 정책 문서 작성 | `NOWHOT_ADFIT_RESCUE_001.md`. Live 쿠팡 언급 없음. |
| 2026-08-13 | `f2ca3da` 로컬 체크포인트 | `adfitReviewMode()` 신설과 함께 `/api/config`에 `!reviewMode &&`(3583)와 `reviewMode ? null`(3636) 추가. 주석 "이때는 … /live에서 모든 광고를 빼고"(2129-2131)가 정책을 확장 해석했다. 직전 커밋 `f2ca3da~1`에서는 `monetization.enabled`가 파트너 ID/프리뷰만 보고 `coupang`은 항상 내려갔다. |
| 2026-08-17 | `d712efd` | `test/briefing-quality.test.js:466-467, 476-477`이 `enabled=false`·`coupang=null`을 고정. |
| 2026-08-28 | `34f26ce` | `deploy/docker-compose.yml:65-67` 주석 "AdSense·쿠팡과 /live 광고는 끈다". |
| 2026-09-04 | `0b613c1` NH112 | 운영 자격증명 점검에서 `/api/feed`에 남은 `via=ad` 2건을 "결함"으로 규정하고 `engine.monetizationDisabled` 배선(2134, `engine.js:2401`) 추가. `main`과 운영 VM에 반영(`NH112 보고서:37-39, 57, 61-62`, `NOWHOT_DEVELOPMENT_STATUS.md:481, 483`). |

세 단계 모두 정책 문서를 고치지 않은 채 구현이 "Live 완전 무광고"로 굳어졌다. NH112가 결함이라 부른 `via=ad` 2건은 정책상 결함이 아니라 정상 동작이었다.

부수 관찰: `ADFIT_ENABLED`의 원래 의미는 "승인 전에는 지면을 내주지 않는다"(2026-08-04 `c9c8d24`, `src/feed/ad-networks.js:36-38`)였고, 08-10 정책이 "재심사 배포에서만 1로 전환하는 심사 모드"로 재정의했다. 운영은 현재 승인 전 재심사 준비 상태에서 1이며(`NH112:68-70`), 이는 정책 운영 전환 순서 4항과 일치한다. 이번 복원과 무관하므로 건드릴 이유가 없다.

## 4. 편집 AdFit 단일 배치 유지 + Live 쿠팡 복원 양립 판단

가능하다. 근거:

- 편집 지면 게이트는 `adfitReviewMode()`를 직접 읽는 별도 함수 셋(`adPage` 2147-2148, `displayAdHtml` 2369, `adLoadersHtml` 2386)이며 `/api/config`·엔진과 무관하다. 세 줄을 걷어내도 `/`의 `kakao_ad_area` 1개, AdSense 0, `link.coupang.com` 0은 유지된다.
- `adfit.mobileUnit: null`(3613)은 그대로 두므로 `/live`에 AdFit 단위·Kakao SDK가 생기지 않는다(정책 승인 조건 5). 피드 내 AdFit은 `useAdfit=false`(`index.html:2279`)로 원래 꺼져 있다.
- Live 쿠팡의 두 경로가 모두 `coupang` 데이터와 엔진 슬롯만 필요로 한다: 화면 삽입은 `cp` 존재만 보고(`index.html:2243`), 서버 슬롯 카드는 `item.disclosure || cp.disclosure`로 고지문을 붙인다(`index.html:3661-3662`). 카드별 법정 고지(`COUPANG_DISCLOSURE`)는 변경 대상이 아니다.

## 5. root 작업 트리 수정 검토 (미커밋, 검토 시점 관측)

`git diff` 요약: `src/feed/server.js` 3곳(2134 삭제, 3583 `!reviewMode &&` 제거, 3636 `reviewMode ? null :` 제거, 2129-2131 주석 교체), `test/briefing-quality.test.js`(테스트명 변경, `t.after` 정리 추가, 466-467·476-477 단언을 `enabled=true`·`coupang.items>0`·`via=ad` 존재로 반전).

- 범위 판정: §1·§4의 최소 변경과 정확히 일치한다. 편집 지면 게이트·`adfit` 형태·엔진 슬롯 규칙(민감 글 인접·세션 캡)은 불변이다.
- 다른 테스트 영향: `test/inline-js.test.js:64-77`은 `const adfit = { mobileUnit: null, reviewMode }` 형태만 보므로 통과 유지. `test/monetize.test.js:1195-1226`은 `adfit` 형태와 `reviewMode` 값만 본다. `test/admin.test.js:322-326`(serving 플래그)·`test/monetize.test.js:1350-1351`(compose 기본값 0)은 무관. 저장소 내 `coupang, null`·`enabled, false` 단언은 briefing-quality 외에 없다.
- 남는 흔적: `src/feed/engine.js:2401`의 `this.monetizationDisabled` 검사는 이제 아무도 세팅하지 않는 사문이다. 무해하지만 함께 제거하거나 남기는 이유를 주석으로 적는 편이 정합적이다(선택).
- 미확인: 테스트 실행은 이번 범위가 아니라 결과를 주장하지 않는다. root가 전체 `node:test`와 `git diff --check`를 돌려야 한다.

## 6. root가 마무리할 항목 (권고)

1. 문서 정합: `deploy/docker-compose.yml:65-67` 주석, `docs/NOWHOT_DEVELOPMENT_STATUS.md:52, 55` 단계 문구, 신규 DEVCHG 행(198의 Live 차단을 정책 재확인으로 되돌렸다는 사실). `NH112` 보고서는 이력이므로 고치지 말고 이 보고서를 참조로 연결. `docs/monetization.md:393-395`에 "Live 쿠팡은 심사 모드와 독립" 한 줄을 더하면 재발을 막는다.
2. 운영 검증(배포 후, 공개 GET만): `/api/config` → `monetization.enabled=true`, `coupang.items>0`, `adfit.mobileUnit=null`, `adfit.reviewMode=true`. `/` → `kakao_ad_area` 정확히 1, `link.coupang.com` 0, `adsbygoogle` 0. `/live` → `kakaocdn`·`googlesyndication` 스크립트 0. `/api/feed`(tech 취향 세션) → `via=ad` 존재.
3. 운영 `COUPANG_PARTNER_ID` 존재는 간접 증거만 있다(NH112:37 — 운영 자격증명 점검에서 `via=ad` 2건 관측). 위 2번의 `enabled=true`가 최종 확인이다. 없으면 화면 삽입 쿠팡 카드는 뜨되 상단 통합 고지 배너가 뜨지 않는 상태가 되므로 2번에서 반드시 본다.
4. 판단 메모(WARN, BLOCK 아님): Kakao 심사자가 `noindex`인 `/live`까지 열어 제휴 카드를 볼 가능성은 정책 문서가 다루지 않았고, 이를 금지하는 Kakao 규정 인용도 저장소에 없다. David가 복원을 승인했으므로 실행에 하드 스톱은 없다. 재심사 제출 시점에 David가 이 점만 인지하면 된다.

## 7. WRC 보고 블록

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: `WRC_MANUS_HANDOFF/START_HERE.md`(전반부), `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(§0 First Principles), `05_RULE_ENFORCEMENT_PROTOCOL.md`(보고 게이트 행), `04_WRC_AI_CONTEXT_WIKI_RULES.md`·`PMO_LIVE_BOARD.md`·`REPORT_READ_INDEX.md`(NowHot 항목 grep — 해당 행 없음)
  - 미읽음/불가: 위 게이트 문서 전문, 운영 VM 환경변수, 광고 계정 현재 화면, Kakao AdFit 운영정책 원문
  - 이번 작업 전용 파일: `src/feed/server.js`, `src/feed/engine.js`, `src/feed/public/index.html`, `src/feed/ad-networks.js`, `deploy/docker-compose.yml`, `test/briefing-quality.test.js`, `test/monetize.test.js`, `test/inline-js.test.js`, `test/admin.test.js`, `docs/NOWHOT_ADFIT_RESCUE_001.md`, `docs/monetization.md`, `docs/NOWHOT_DEVELOPMENT_STATUS.md`, `docs/reports/NOWHOT_ADFIT_SHADOW_REPORT_2026-08-17.md`, `docs/reports/NOWHOT_NH112_RELEASE_ONBOARDING_DEPLOY_2026-09-04.md`, `docs/reports/NOWHOT_OWNER_TAKEOVER_2026-09-05.md`, git 이력(`f2ca3da`, `d712efd`, `34f26ce`, `0b613c1`)
- 적용한 규칙: 13 First Principles 게이트, Minimal Sufficient Change, 이익 우선·기본 허용(GO/WARN/BLOCK), 읽기 전용 경계, 5-filter(미검증 사실은 미확인으로 표기)
- First Principles 게이트: PASS
- 금지선 준수: 코드·테스트 수정 0, 테스트 실행 0, 커밋·push·배포 0, 유료 API·광고 계정·VM 접근 0, Corridor analyzePlan은 코드 생성이 없어 미사용. 신규 파일은 이 보고서 1건.
- David 행동 필요 여부: 없음(복원 승인 완료). §6-4 인지만 필요.
- Telegram 알림 필요 여부: 없음(root 판단).
- 이익 우선·과잉방어 점검: Live 쿠팡 차단은 정책 근거 없는 과잉방어였다. 복원은 GO. 편집 지면 AdFit 단일 배치와 카드별 고지는 유지.
- 하지 않은 일: 테스트 실행, 운영 환경변수 확인, Kakao 정책 원문 조회, 광고 재설계, 문서 갱신, root 작업 트리 수정 평가 외 추가 리팩터링 제안.
