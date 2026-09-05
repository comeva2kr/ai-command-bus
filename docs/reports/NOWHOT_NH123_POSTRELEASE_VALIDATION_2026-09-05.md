# NH123 정시 발행·모바일·콘텐츠·광고 준비 점검

- 안정 ID: `NOWHOT-POSTRELEASE-VALIDATION-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260905-210`
- David 입력: 확정 지시 “진행해”. 앞서 제안한 정시 발행 확인·아이폰 확인·콘텐츠 표본 검수·광고 재심사 준비를 실행한다.
- 범위: 운영 읽기/격리 QA 및 다음 발행 시각의 1회 후속 확인. 제품 변경·광고 계정 신청을 이번 점검 완료로 간주하지 않는다.

## 지금 확인한 결과

- 운영 코드 `f95164b89686ef82bb9f5b929947d33b1dc0c5b8`, 컨테이너는 13:28:08 KST부터 실행 중. 16:56:52 현재 공개 런치는 `SCE-c1e006868413a496`, 선택4분야56건, `slot_canonical_verified`, fallback false.
- 영속 `/data/slot-editions/active.json`과 런치 파일은 11:43:16 생성. 후보 영수증은 전체192이슈·14개 분야 각14·paid/LLM 호출0·원문 발췌159/원문불가33을 기록한다. 선별 분야 고유56과 전체192를 구분한다.
- 오늘판/정본 플래그1, 포인터 경로 정상. `/data/feed-pool.json`은 16:43 갱신돼 현재 발행 입력이 존재한다. 최근4시간 “정시 후보 생성 HOLD” 로그0. 매5분 확인·다음 슬롯20분 전 준비하는 실제 코드/환경을 확인했으며 이것만으로 이브닝 완료를 주장하지 않는다.
- 근거: `/tmp/nh123-runtime-check.txt`, `/tmp/nh123-today.json`, VM `/data/slot-editions/active.json`과 `receipt-2026-09-05-lunch-c1e006868413.json`.

## 모바일 동작

- 개인 프로필과 분리한 실제 Chrome, 393×852, 공개 nowhot.kr, `x-nowhot-check:1`. 사용자 기기 설정/계정 변경 없음. 테스트용 새 익명 세션의 슬라이더 입력/변경 이벤트와 실제 API 저장을 사용했다.
- Today56/광고5, 빈 광고 제목0, 관심 분야 top59px=헤더 bottom59px, 가로 넘침0.
- Live: 커뮤만 핫10/10·최신10/10·새로고침 복원10/10, 뉴스만 최신10/10·핫10/10. 마지막 커뮤만 핫으로 전환도10/10. 광고는 종류 판정에서 제외. 정렬줄 top59px=헤더 bottom59px, 페이지 JS 오류0.
- 근거: `/tmp/nh123-mobile-check.cjs`, `/tmp/nh123-mobile-proof.json`, `/tmp/nh123-today-mobile.png`, `/tmp/nh123-live-hot-mobile.png`. 첫 캡처가 메뉴 닫기 애니메이션 도중이어서 QA 스크립트에 메뉴가 화면 밖으로 나간 뒤 기다리게 하고 동일 시나리오를 다시 통과시켰다. 제품 결함/제품 수정으로 기록하지 않는다. Root가 최종 두 화면을 직접 확인했다.
- 실제 iPhone: USB 목록에 기기 없음, iPhone 미러링 실행 없음, xctrace 사용 불가. 별도 사용자 확인 질문을 보냈으며 답변 대기다. Chrome 결과를 iPhone Safari PASS로 올리지 않는다.

## 19:05 후속 확인

- Codex 대화 heartbeat `automation-3`, “오늘판 이브닝 발행 확인”, ACTIVE, 이 대화에 연결한 1회 일정. 2026-09-05 19:05 KST에 실제 이브닝 판/시각/운영 로그/화면 전환을 확인하도록 등록하고 automation.toml에서 일시·횟수·대화 연결을 읽어 확인했다.
- 18:40 이후 정상 발행기 자체 준비를 기다린다. 현재판을 강제 재발행하거나 시스템 시각을 바꾸지 않았다. 예약 등록과 실제 예약 실행/발행 성공은 별개다.
- 후속 담당은 이 보고서·최신 개발현황을 읽고 실제 현재 시각을 확인한다. 공개 `/api/today?categories=news,business,tech,humor`의 date/slot/serving/editionId를 조회한 뒤, VM `/data/slot-editions/active.json`·새 이브닝 영수증과 비교한다. 성공·실패 모두 이 대화에 결과를 보고하고 아래에 후속 증거를 추가한다.

### 19:05 예약 실행 결과 — 자동 이브닝 확인 완료

- `automation-3`이 **2026-09-05 19:05:26 KST**에 이 대화에서 실행됐다. 실제 시계19:05:47과 공개 응답을 확인했으며 아래는 오후의 미확인 상태를 갱신하는 후속 증거다. 변경 레코드 `DEVCHG-NOWHOT-20260905-212`, 안정 ID는 본 보고의 `NOWHOT-POSTRELEASE-VALIDATION-001`을 유지한다.
- 판 ID **`SCE-8679215252e32946`**, SHA `8679215252e329464ee470261b821498932c93aa9c189fa37f2c3807779e697f`. 기본 `/api/today`와 선택4분야 요청 모두 **9월5일 evening·55건·slot_canonical_verified·fallback false**. 저장 정본의 같은 분야 투영과 공개 issues를 전부 대조해 일치했다. 분야별14건이며 중복 사건을 합친 선택4분야 고유 수가55다.
- VM 포인터 `updatedAt=2026-09-05T09:44:54.659Z`(**18:44:54 KST**), 같은 시각의 candidate/edition/receipt 파일 존재. 동결 준비 입력은18:43 저장됐다. 응답의 generatedAt/verifiedAt18:33:30은 입력 기준 시각이며 실제 파일 생성/활성화 시각과 구분한다. 정본 전체191·발췌153·원문불가38·LLM 사용 배열0. 영수증의 `candidate_ready`만으로 활성화를 주장하지 않고 실제 active pointer와 공개 응답까지 확인했다.
- 운영 HEAD는 NH124 제품 `68145ab8b21e57e152ac4c7b8cb57106bce7a46d`, 컨테이너18:03:07 기동 유지. 기존 자동 발행 경로의 `allowPaid:false`·타이머·활성화 코드를 대조했다. 최근40분 `[slot-canonical]` HOLD 로그0. 성공 로그 문자열은 따로 출력하지 않는 경로이며 저장 영수증/포인터가 성공 근거다. 이번 확인은 발행기·빌더·활성화 함수를 실행하지 않았다.
- **19:07:43 KST** 격리 Chrome393×852의 실제 nowhot.kr에서 날짜9월5일·제목 ‘이브닝 오늘판’·이브닝 탭 선택·55기사·쿠팡6개·가로 넘침0·JS 오류0 확인, Root가 스크린샷을 직접 열람했다. 날짜/슬롯 쿼리·시계 모의 없이 현재 기본 페이지로 진입했다. 19:00:00 순간을 녹화한 증거는 아니며 19:05 이후 정상 전환 확인이다. 실제 iPhone 증거로 올리지 않는다.
- 증거: `/tmp/nh125-evening-public.json`, `/tmp/nh125-evening-default.json`, `/tmp/nh125-evening-runtime.txt`, `/tmp/nh125-evening-files.txt`, `/tmp/nh125-evening-artifact/`, `/tmp/nh125-evening-artifact-proof.json`, `/tmp/nh125-evening-browser-proof.json`, `/tmp/nh125-evening-public-mobile.png`.
- 작업 시작 전 확인한 MD: 자동 주입 AGENTS.md·Ponytail Full·메모리 요약; 직접 읽음 WRC START_HERE/Canonical13원칙·§11.1/Wiki/Enforcement/Live Board/Read Index 관련 범위와 wrc-start 스킬; 미읽음/불가 무관한 보드 과거 하단·iPhone 실기기; 전용 README·최신 개발현황·NH123/NH124·발행기/server 현재 코드·위 운영 자료. 메모리는 현재 운영 재검증 원칙에만 사용했다.
- 적용한 규칙: 이미 승인한 1회 확인, 13원칙 전부, 읽기/격리 QA·문서 기록만, 임시 브라우저 코드 전 Corridor. First Principles 게이트: **PASS**.
- 개발현황 반영: 최신 NH124 항목의 이브닝 미확인을 완료로 갱신하고 본 후속/`DEVCHG-NOWHOT-20260905-212`에 연결했다. 코드 배포/교정 런치와 이브닝 자동 발행 확인을 구분했다.
- 금지선 준수: 강제 발행·날짜/시각 조작·유료 호출·광고 클릭·계정 제출·개인 브라우저·원본 정본 수정0. David 행동 필요 여부: 이번 확인에는 없음. Telegram 알림 필요 여부: 없음, 이 대화에서 보고. 이익 우선·과잉방어 점검: GO, 정상 운영은 그대로 두고 최소 증거만 대조했다. 하지 않은 일: 새 제품 수정/배포·전체 콘텐츠 재검수·광고 신청·iPhone 확인·메모리 쓰기. 이번 1회 확인은 종료한다.

## 3자 검토

- Root: 발행 설정/저장판/운영/모바일 검증 및 종합 판정.
- Fable5.1 max: `task_25aa2b7d5aa4` / `ctx_b504763a2536`, Today12·Live20·원문6건 시도(5건 열람, 1건 접근 거부) 검수. [콘텐츠 검수 원보고](NOWHOT_NH123_FABLE_CONTENT_REVIEW_2026-09-05.md). 완료 메시지 `msg_65c0d48ed034` 수락, exact worker release 및 Delivery ACK 완료.
- Cursor Grok4.6 xhigh: `task_dfe8a62ef3fb` / `ctx_26eae7d3106e`, 현재 공개 HTML/상세3건·업체별 공식 정책2개 기반 AdSense/AdFit 준비 검수. [광고 준비 검수 원보고](NOWHOT_NH123_GROK_AD_READINESS_2026-09-05.md). 완료 메시지 `msg_2416fafe1bb5` 수락, exact worker released/closed_agent_terminal 및 Delivery `delivery_553ff592fa90` ACK 완료. 최종 미수신 메시지0.
- Orca Run `run_d8c3b9ab3886`, 전용 코디네이터 `term_8e483e56-d8a2-4705-95cd-843d85e56d57`.
- Grok 첫 기동은 잘못된 모델 ID `grok-4.6-xhigh`로 CLI가 종료해 준비 실패했다. terminal 오류와 failed Dispatch를 읽고 지원 목록의 `cursor-grok-4.6-xhigh`로 명시적 재시도, ready·input accepted 및 실제 설정을 확인했다. 실패한 Dispatch `ctx_13f3b659850e`는 release 결과 no_owned_resource/retained이며 실제 검토 참여로 세지 않는다.

## 책임자 종합 판정과 다음 수정 순서

1. **우선 수정: 사건 결속과 제목·출처 연결.** 현재 런치 04번은 서로 다른 Hugging Face 관련 사건 3개가 한 이슈에 묶여 있고, 제목의 근거인 Techmeme p25 링크가 독자 출처 목록에 없다. Root도 공개 응답의 reader/ref/sourceLinks와 실제 모바일 제목을 대조했다. 이는 문장 다듬기만의 문제가 아니다. 병합 함수와 모든 호출 경로를 먼저 추적하고, 다른 사건 분리·대표 제목의 근거 링크 보존을 같이 검증해야 한다. 이 점검에서 수리하지 않았다.
2. **발췌 정리와 번역·제목 절단.** 공개 56건은 원문 발췌42·원문불가14이며 생성 요약0. 일부 발췌에 사진 설명·이메일·메뉴가 들어가고, Live에는 타 게시자의 제휴 고지가 소개글처럼 들어간다. `Sources:` 오역, 저자 괄호 중간 절단, 스포츠 기사의 경제 분류도 확인됐다. 원보고의 오염 총수는 서로 다른 판별 범위이고 Fable 나열 ID와 총수에도 차이가 있어 확정 발생률로 채택하지 않는다.
3. **기존 공통 함수부터 재사용.** `enrich.js:cleanArticleTextChrome`가 이미 `article-summary.js`와 `slot-canonical-edition.js`에 연결되어 있다. `publicText`는 figure/nav 등을 제거하고, `engine.js`의 랭킹 출력에는 중복 발췌 제거가 따로 있다. 새 표시 필터를 추가하기 전에 누락 입력 경로와 기존 함수의 정확한 적용 범위를 확인한다. 이메일이 들어간 모든 문장을 지우거나, 사이트 소개인 og:description을 무조건 대체 본문으로 사용하는 제안은 채택하지 않는다. 기존에 본문을 못 찾은 글이 필터만으로 복구된다는 주장도 미검증이다.
4. **광고 재신청 준비: 아직 미완료.** 쿠팡은 Today/Live 정상이고 그대로 유지한다. AdSense/AdFit은 각각 준비 확인이 더 필요하다. JS를 실행하지 않은 Today 최초 HTML에는 기사 내용이 없고, 상세의 발췌와 자체 편집문 구분을 보완할 여지가 있다. 실제 AdFit 단위+SDK는 `/report`에만 있고, 등록 매체 URL·광고 계정 상태는 이번 점검에서 열람하지 않았다. 크롤러의 JS 미실행을 공식 자동 반려 사유로 단정하지 않으며, 기사 수·글자 수 승인 기준을 만들지 않는다. 이미 발행된 정본으로 초기 HTML을 채우는 최소안을 준비 대상으로 두되, 제품 코드·계정 신청은 변경하지 않았다.

Fable의 ‘허위 요소 없음’·‘정확성 문제가 아님’이라는 포괄적 표현은 책임자 결론으로 채택하지 않는다. 직접 열람한 5개 출처의 대조 항목에서 불일치가 없었다는 표본 결과까지만 인정하며, 다른 사건 병합과 번역 의미 변화는 별도 결함이다. Grok의 HOLD는 재신청 준비도 판정이고 광고사의 계정 심사 결과가 아니다.

정책 근거: [Google Publisher Policies](https://support.google.com/adsense/answer/10502938)는 Google 광고가 놓이는 화면의 자체 콘텐츠·부가가치를 다룬다. Root도 해당 원문을 재확인했다. [AdFit FAQ](https://kakaobusiness.gitbook.io/main/partner/adfit/faq)와 [운영정책](https://adfit.kakao.com/web/html/use_kakao.html)은 Grok가 당일 직접 읽고 광고 요청 확인·질적 심사 조건을 기록했다(Root 웹 도구의 FAQ 재열람은 실패, 원보고와 구분).

## 종료 시 남은 확인

- 당장 가능한 운영·모바일 Chrome·3자 표본 검수·재신청 준비 분석은 완료했다. 제품 변경이나 새로운 배포는 없다.
- 실제 iPhone Safari: David 답변 대기. 현재 시험은 모바일 화면 크기의 Chrome 증거다.
- 이브닝 자동 발행: 오늘 19:05 1회 후속 예약 완료, 실행/발행 성공은 아직 미확인.
- 위 콘텐츠 결함과 광고 준비 보완안은 발견·우선순위 확정 상태이며 구현 완료가 아니다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: AGENTS.md, 메모리 요약, Ponytail Full.
  - 직접 읽음: START_HERE·운영 정본13원칙·위키 규칙·집행 프로토콜·PMO_LIVE_BOARD·REPORT_READ_INDEX 관련 범위, README·개발현황·NH113·NH122, Orca CLI/orchestration/computer-use 스킬 및 버전1.4.197 현재 가이드. 메모리 레지스트리는 현재 검증/과거 기록 구분에 사용.
  - 미읽음/불가: 무관한 공용 보드 과거 하단, 실제 iPhone, 아직 오지 않은 이브닝 발행 시각.
  - 이번 작업 전용 파일: server.js·engine.js·enrich.js·article-summary.js·slot-canonical-edition.js·run-slot-canonical-prepublish.mjs·index.html·deploy 설정의 해당 경로, 위 증거와 두 독립 검토.
- 적용한 규칙: 확정 지시·13원칙 전부, 최소 표본/범위, 실제 운영·모의 화면·미래 예약 구분. 임시 QA 코드 생성/수정 전에 Corridor analyzePlan 적용.
- First Principles 게이트: PASS(미완료 항목은 실제 iPhone·19:05 경과 확인으로 구분).
- 개발현황 반영: `docs/NOWHOT_DEVELOPMENT_STATUS.md`의 현재 NH123에 안정 ID `NOWHOT-POSTRELEASE-VALIDATION-001`·변경 레코드 `DEVCHG-NOWHOT-20260905-210` 연결. 현재 검증 결과·미확인 실기기/이브닝·발견된 미수리 결함을 대조했다. 제품 코드 변경0.
- 금지선 준수: 개인 브라우저·고객 메시지·광고 클릭·계정/신청·유료 API·판본 강제 생성·시각 조작0.
- David 행동 필요 여부: iPhone Safari 실제 확인 결과만 대기. 나머지 작업/19:05 후속은 에이전트가 담당.
- Telegram 알림 필요 여부: 없음, 이 대화에서 후속 보고.
- 이익 우선·과잉방어 점검: GO. 현재 광고·서비스 보존, 새 시스템/의존성 없이 기존 발행기·검증 도구와 1회 후속 사용.
- 하지 않은 일: 광고 신청/승인·정산 검증, 실제 iPhone 조작, 제품 수정/배포, 과거 이브닝 복원, 메모리 쓰기.
