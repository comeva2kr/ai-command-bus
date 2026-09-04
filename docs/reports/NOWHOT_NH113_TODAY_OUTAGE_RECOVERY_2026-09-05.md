# NH113 오늘판 운영 장애 복구 — 2026-09-05

상태: 운영 복구 확인. 책임자 Codex GPT-6, Orca Fable 5.1·Cursor Grok 병렬 검수 회수 완료.
대상 안정 ID: `NOWHOT-TODAY-PUBLISHING-RECOVERY-001` · 변경 레코드 `DEVCHG-NOWHOT-20260905-200`.

## 결과와 현재 증거

- 운영 코드: `b5517ebd183be970dd81fdc7744aa2e901a05968`. VM 자동 배포 07:34:06 KST, 공개 preflight 07:34:28 PASS.
- 공개 기본 `/api/today`는 2026-09-05 모닝, 56건, `fallback:false`, `llmCalls:0`을 반환한다. 특별 검수 헤더 없이 확인했다.
- David 화면과 같은 `news,tech,business`는 42건. 실제 Chrome과 393×852 모바일 크기에서 모닝 날짜·탭·기사 목록·새로고침·상세 열기/닫기·목록 복귀를 확인했다. 가로 넘침 0, 오류 영역 0. 실제 iPhone Safari 조작은 하지 않았다.
- 새 모닝판: `SCE-310f1fb916c40db6`, 콘텐츠 SHA `310f1fb916c40db6957268e96432edf503bd7f911834ae81b12067e962af7ff1`. 운영 포인터 활성화 시각 07:25:58.749 KST. 응답의 `generatedAt` 07:20:07.130은 풀 근거 시각이며 활성화 시각과 구분한다.
- 14개 분야 각 14건, 전체 고유 이슈 195건. 새 판은 기존 무료 생성 경로를 사용한다. 상세 상태 `excerpt_only:162`, `source_unavailable:33`; 장문 생성 요약 완료로 표현하지 않는다.
- 검수된 9월 4일 런치 `SCE-0b991485de03a38a`의 포인터 ID·콘텐츠 SHA `0b991485de03a38a3191fe43eedb27cf5773b0c7463065ad3f83455401238722`는 그대로다.
- 9월 4일 이브닝은 당시 생성되지 않았다. 해당 날짜·슬롯 요청은 HTTP 200으로 검증된 런치 42건을 제공하면서 요청=이브닝, 제공=런치, `fallback:true`를 명시한다. 화면에서도 이브닝 탭과 런치 제공 안내를 확인했다. 과거 이브닝을 새로 복원했다고 주장하지 않는다.
- 아직 발행 전인 9월 5일 런치 요청은 HTTP 409 `EDITORIAL_SLOT_NOT_DUE`. 과거 판을 미래 판으로 둔갑시키지 않는다.
- 최신 이미지의 동일 발행 명령 재실행: `already_active`, 모닝 ID 일치, `paidCalls:0`. 운영 `ps`에서 서버 외 중복 생성 프로세스 0, 새 이미지 로그에 발행기 누락 오류 없음.

## 근인과 최소 수정

1. **배포 이미지 누락**: 서버는 `../../tools/run-slot-canonical-prepublish.mjs`를 동적으로 호출하지만 Dockerfile은 `src/`만 복사했다. 운영 로그에 5분마다 `Cannot find module '/app/tools/run-slot-canonical-prepublish.mjs'`가 반복됐다. `tools/`와 실제 필수 레지스트리 JSON 하나를 포함하고, 이미지 빌드 시 발행기 import를 실행해 재발을 차단했다. `.env`·로컬 판본·불필요한 테스트 자료는 포함하지 않는다.
2. **생성기 안의 예약기 재귀**: 운영 환경의 `NOWHOT_SLOT_CANONICAL_EDITION=1`이 자식 생성기의 `createServer`에도 상속됐다. 패키징 복구 직후 운영에서 중복 생성 프로세스 3개를 확인했다. 해당 빌더들만 중단하고, 공통 `buildTodayEditionInProcess`에서 `slotCanonicalEditionEnabled:false`로 차단했다. 기존 재고 예약 OFF와 합쳐 생성기는 일회 생성만 한다.
3. **누락판 읽기 경로**: 고정판 reader가 정확한 날짜·슬롯 하나만 찾고 즉시 409를 반환했다. 기존 24시간 제공 계약과 기존 fallback 화면을 재사용해 가장 최근의 정상 이전판을 표시한다. 정확한 현재판이 손상되면 실패를 유지하고, 이전 후보의 경로 이탈·해시/ID·날짜·슬롯 위조는 제외한다. GET은 계속 `filter_only`, 저장·수집·LLM 호출 없음.
4. **브라우저의 어제 판 고정**: 일반 목록 재로드가 저장된 런치를 복원하고 서버 조회를 생략했다. 일반 재로드·새로고침은 최신판을 조회하고, 명시적으로 선택한 과거 판·상세·원문에서 뒤로가기는 보존한다. 실제 오류 시 이전 성공 제목·검증 상태·선택 탭을 남기지 않는다.

제품 변경 commit: `05e93d6` → `6940b8a` → `b5517eb`. 모두 main push와 VM 반영을 확인했다. 광고 신청·계정 설정·과금 옵션은 변경하지 않았다.

## 검증

- RED: 기존 reader는 누락 모닝·이브닝 회귀 2건 실패. 운영 환경을 상속한 생성기는 200 대신 409. 브라우저는 최신판 조회를 생략하고 오류 후 런치 제목을 남김.
- GREEN: `test/build-editions.test.js`, `test/slot-canonical-edition.test.js`, `test/slot-canonical-prepublish.test.js` 52/52 PASS. 누락 최신 GET, 미래 발행 전 409, 정확한 손상판 실패, 24시간 제한, 과거 콘텐츠 보존, 포인터 위조·경로 이탈 제외 포함.
- 실제 Chrome `test/browser-navigation.test.js` 15/15 PASS, SKIP 0. 새로고침과 오류 회귀뿐 아니라 기존 상세→원문→Back/Forward/재로드·스크롤·공용 안내·서비스워커 알림 동작까지 확인.
- VM Docker 빌드의 발행기 import PASS, 최신 자동 배포 preflight PASS, 공개 URL·모바일 크기 실화면 PASS, `git diff --check` PASS.
- 전체 저장소 1,900여 개 테스트를 다시 실행한 것으로 표현하지 않는다. 이번 변경 경로 67개와 운영 증거로 확인했다.
- 실행 증거: `/tmp/nowhot-nh113-tests.log`, `/tmp/nowhot-nh113-browser.log`, `/tmp/nowhot-nh113-public-morning.json`, `/tmp/nowhot-nh113-public-all.json`, `/tmp/nowhot-nh113-runtime-check.txt`.

## 셋의 역할과 검수 회수

- Codex: 전체 장애 책임, 운영 로그 확인, 핵심 수정·테스트·배포·공개 화면 검증.
- Fable 5.1: 발행기의 전체 import·데이터 의존성과 운영 환경 상속 검수. 실제 Orca 요청/실효 모델 `claude-fable-5-1`, effort `max`, `ultracode` 지시. task `task_9f07da799800`, dispatch `ctx_98150d26f00d`, 완료 `msg_6cf431847f4c`.
- Cursor Grok: 누락판·변조·미래판·브라우저 저장 화면 반례. 실제 요청/실효 모델 `cursor-grok-4.6-xhigh`. task `task_0c8296b91fde`, dispatch `ctx_000613288c2f`, 완료 `msg_76426d28cf3e`.
- Run `run_dcbbf230b8f9`. 두 작업 모두 succeeded 완료 신호를 회수·ack하고 정확한 해당 worker terminal을 release했다. 기존 다른 작업자는 건드리지 않았다.
- 독립 원본: [Fable 검수](NOWHOT_NH113_FABLE_PREPUBLISH_REVIEW_2026-09-05.md), [Grok 검수](NOWHOT_NH113_GROK_SLOT_CONTINUITY_REVIEW_2026-09-05.md).
- 대조: Fable 원문의 `6940b8a 미push`와 `07:4x`는 오래된 로컬 ref/작성 표기이며 운영 증거가 아니다. 위의 실제 push·VM 시각으로 정정한다. Grok의 미완료 GET/손상판/브라우저 지적은 이번 최종 테스트로 보완했다. 손상된 정확한 판은 HTTP 500을 유지한다; 파일 손상을 정상적인 누락 409로 바꾸는 추가 변경은 하지 않았다. 일반 오류 화면은 이제 정직하게 표시한다.

## 남은 범위

- 다음 런치/이브닝의 실제 시각 경과를 아직 관측하지 않았다. 예약 코드, 단일 생성 경로, 다음 슬롯 선택 테스트, 최신 모닝 자동 생성은 확인했다. 예약 일정은 기존 07:00/12:00/19:00, 다음 판 준비는 20분 전이다.
- 과거 이브닝을 다른 시점의 풀로 꾸며 만들지 않았다. 장문 한국어 요약·광고 재심사 문제는 이번 가용성 수리와 별도다.

## WRC 실행 기록

- 입력 분류: 확정 지시. 사람들에게 배포한 nowhot.kr 장애를 셋이 즉시 분석하고 고치라는 요청을 운영 복구까지의 권한으로 적용했다.
- 작업 시작 전 확인한 MD:
  - 자동 주입: New project AGENTS.md, 전역 시작 게이트·13 First Principles·이익 우선 규칙, memory_summary.
  - 직접 읽음: 이 세션의 앞선 인수에서 `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`, `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`, `PMO_LIVE_BOARD.md`, `REPORT_READ_INDEX.md` 및 NowHot 제품 헌장·Blueprint·개발현황·NH111/NH112 보고를 확인했다. 이번 장애에서는 관련 현재 파일과 실제 VM 증거를 재확인했다.
  - 미읽음/불가: 무관한 과거 자료 전수, 실제 iPhone Safari, 다음 발행 시각 경과, 광고 계정 현재 화면.
  - 이번 작업 전용 파일: `Dockerfile`, `.dockerignore`, `deploy/README.md`, `deploy/docker-compose.yml`, `deploy/autodeploy.sh`, 서버/reader/생성기/Today 화면 및 위 4개 테스트 파일, 첨부 사진 2장, Orca 두 검수 보고.
- 적용한 규칙: WRC start·Orca CLI orchestration·systematic-debugging·test-driven-development·verification-before-completion. 코드 변경 전 Corridor analyzePlan 실행, 최소 공통 근인 수정, 독립 검수 대조, 증거별 완료 판정.
- First Principles 게이트: PASS.
- 개발현황 반영: `NOWHOT-TODAY-PUBLISHING-RECOVERY-001`, `DEVCHG-NOWHOT-20260905-200`. 개발현황·Blueprint·실제 운영 commit 및 공개 판 ID를 대조했다.
- 금지선 준수: 유료 콘텐츠 API 0, 기존 승인 판 보존, 개인 브라우저 탭 조작 없음, 광고·결제·고객 메시지·계정 변경 없음. 운영 수리는 David의 현재 지시 범위다.
- David 행동 필요 여부: 추가 승인 불필요. 기존 오류 화면을 열어 둔 경우 브라우저 새로고침 한 번이면 새 코드와 모닝판을 받는다.
- Telegram 알림 필요 여부: 없음. 현재 대화에서 즉시 복구 결과 보고.
- 이익 우선·과잉방어 점검: GO. 공개 서비스 가용성을 먼저 복구하고 품질·출처·요금 경계를 유지했다.
- 하지 않은 일: 과거 판 조작 복원, 전량 유료 재요약, 광고 재신청, 다른 프로젝트·기존 개인 설정 변경, 별도 무기한 감시 자동화 생성.
