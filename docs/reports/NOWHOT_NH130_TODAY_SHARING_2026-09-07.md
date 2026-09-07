# NH130 오늘판·개별 기사 공유

- 안정 ID `NOWHOT-TODAY-SHARING-001`, 변경 레코드 `DEVCHG-NOWHOT-20260907-217`.
- 입력 분류: “오늘판은 공유 버튼이 없어”는 누락 기능 수리 확정 지시. Root가 UI·통합·배포 책임, 기존 보조 Codex `nh127_push_review`가 서버/정본 reader, `live_sticky_review`가 독립 반례·브라우저 회귀를 맡았다. 이번 수리를 실제 Orca Fable/Grok 작업으로 표현하지 않는다.
- 원인: Live에는 `/p?id` 공유와 클립보드 복사가 있으나 Today에는 버튼과 공유 진입 경로가 없었다. Today 내부 hash만 복사하면 수신자 관심 분야나 정정된 판본 때문에 글을 찾지 못할 수 있었다.
- 변경: 판 제목 옆의 전체 공유·상세 상단의 글 공유를 추가했다. 기존과 같이 제목+링크를 복사하고 클립보드가 거부되면 복사 창을 제공한다. 두 테마의 기존 서식과 접근성 버튼을 쓴다. 조회 실패/대기 중 전체 공유는 비활성화한다.
- 링크: 기존 `/p` OG 경로를 재사용한다. 실제 표시된 edition/date/slot/categories와 선택 기사를 연결하고, 수신자의 저장 관심 분야는 방문만으로 바꾸지 않는다. 날짜·슬롯 변경은 공유 고정을 해제하고 URL을 동기화한다. 이전판 폴백은 요청한 날짜가 아닌 실제 표시한 판을 공유한다.
- 정본 보존: 공개 활성 pointer의 현재 entry 또는 atomic 활성 이력이 있는 판본만 정확 ID로 조회한다. 앞으로 정정되어도 기존 공개 entry를 `publishedEditions`에 보존한다. 이미 과거에 교체되어 활성 이력이 없는 파일은 소급 스캔해 허용하지 않는다. 후보/알 수 없는 판/날짜 불일치는 다른 판으로 대체하지 않고 명시 오류다. 기사 데이터와 기존 Live 공유는 보존한다.
- 독립 검토 보완: 공유 고정 해제 후 두 번째 날짜·슬롯 변경도 URL에 반영했다. Back/Forward 복원 시 대기 중 조회/분야 콜백을 무효화하고, 상세 공유는 같은 시점의 판과 기사 쌍을 캡처한다.
- 업데이트 공지: 불변 ID `2026-09-07-today-sharing` 추가, 최종 SW152.

## 검증·운영

- 브라우저: 전체/기사 실제 버튼·복사 실패 창·다른 관심 분야 새 창·원문/Back·목록 복귀·두 차례 슬롯 변경 후 reload·이전판의 실제 날짜 공유·오류 시 버튼 차단을 기존 격리 fixture로 확인했다. 기존 Today 현재판 refresh·상세 원문/Back/Forward/reload도 통과했다. 최초 prompt 검사는 대화창 해제 전에 click 완료를 기다린 검사 순서 오류였고, 이벤트 내 해제 후 통과했다.
- 서버: 정확 활성판 조회·정정 뒤 같은 바이트 유지·미활성 후보 거부·잘못된 ID/날짜/분야/기사 거부·OG/스크립트 이스케이프·기존 Live 공유를 실제 임시 서버에서 검증했다. 정본/사전발행/공유61/61 PASS. 새 기사 생성/요약 요청0, 발행파일 변경0.
- 최종 독립 검사: `live_sticky_review`가 분야 저장 POST 보류→Forward→늦은 응답 해제→복원 분야/상세/공유 동일을 실제 실행했고, 전체 Today 관련4/4 PASS와 최종 GO를 회수했다. 인라인15/15·diff PASS. `/tmp/nh130-forward-race.log`, `/tmp/nh130-today-sharing-review.log`, `/tmp/nh130-server-reader-suite.log`.
- 운영 배포와 공개 화면 확인: 완료. 최종 제품 SHA·시각·증거는 아래 영수증과 일치한다.

### 1차 운영 확인과 마지막 표시 보완

- 제품 `ceb1729bc3f5a193f463c2d4d835e1cf7c41d9bf` 09:22:08 KST 배포·09:22:28 preflight OK.
- 09:22:43 공개 격리 Chrome에서 실제 공유 두 버튼→실제 `/p` OG→새 수신자 상세/같은14개 목록을 밝음393px·어두움320px로 확인했다. 정확 `SCE-7445e300fb51b201`, tech 분야 유지·수신자 분야 저장0·JS 오류0. 새 공지1회/소개16개 이력 보존 PASS. `/tmp/nh130-public-proof.json`, `/tmp/nh130-public-notice-proof.json`.
- 스크린샷 직접 검토에서 Today 토스트 z-index50이 상세 overlay80 뒤에 가려지는 문제를 발견했다. 공통 토스트를100으로 올리고 내용 너비/화면 최대너비를 지정해 복사 완료가 상세 위에서도 표시되게 보완한다. 기존 단일 회귀에 `elementFromPoint`로 실제 가림 여부 확인을 추가하고 SW152로 갱신한다. 이미 배포한 업데이트 공지 ID는 보존한다.

### 최종 운영 영수증

- 최종 제품 `97c0efed670f2d9db585d38e5430fa609a8e7222`, 09:25:07 KST 배포·09:25:29 preflight OK. 최종 표시 보완 후 Today 브라우저4개+인라인구문4개8/8 PASS, 독립 최종 GO.
- 09:25:41 실제 공개 링크 검사를 다시 통과했다. 밝음393px/어두움320px 새 수신자에서 같은 판·기사·Back 목록·재공유 URL 일치, 관심 분야 저장0·JS오류0. OG 제목·정본 URL·기사 이미지 URL 확인. 09:25:39 새 공지1회·소개16개 이력 확인. 공개 두 테마 스크린샷에서 복사 완료 안내가 상세 앞에 온전히 표시됨을 직접 확인했다.
- 증거: `/tmp/nh130-public-proof.json`, `/tmp/nh130-public-notice-proof.json`, `/tmp/nh130-today-share.png`, `/tmp/nh130-article-share.png`, `/tmp/nh130-recipient-dark.png`. 격리 Chromium의 모바일 화면 검증이며 실제 iPhone/삼성 인터넷 또는 카카오/X 앱 미리보기 수신 성공 주장으로 확대하지 않는다.

## WRC 보고

- 작업 시작 전 확인한 MD — 자동 주입: 사용자 AGENTS·메모리 요약·Ponytail Full. 직접 읽음: 이 세션의 START_HERE·CANONICAL13원칙/§11.1·WIKI_RULES·ENFORCEMENT·PMO_LIVE_BOARD·REPORT_READ_INDEX, 이번 턴 공유 gate 머리·NH129 보고·개발현황, 기존 wrc-start/orca-cli/orchestration 지침. 미읽음/불가: 실제 iPhone/삼성 인터넷 수신기기. 이번 작업 전용 파일: Today·navigation-history·server `/p`/`/api/today`·정본 reader/activation·해당 검사.
- 적용한 규칙: 기존 수리/배포 승인·13원칙 전체·Corridor 사전분석·기존 공유/정본 재사용·격리 브라우저·독립 반례·로컬/운영/실기기 증거 구분.
- First Principles 게이트: PASS.
- 개발현황 반영: 대상 안정 ID NOWHOT-TODAY-SHARING-001, 변경 레코드 DEVCHG-NOWHOT-20260907-217. 구현과 관련 검사 대조, 운영 결과는 아래 최종 영수증과 대조한다.
- 금지선 준수: 기존 기사/판본·구독 동의·수신자 저장 관심 분야 보존. 실제 고객 시험 푸시·개인 브라우저·실제 클립보드 변경·메모리 쓰기0.
- David 행동 필요 여부: 배포 후 기존 화면 새로고침. 새 승인 요청 없음.
- Telegram 알림 필요 여부: 없음, 이 대화 보고.
- 이익 우선·과잉방어 점검: GO. 기존 클립보드·공유 미리보기·정본 경로에 연결하며 새 서비스/의존성은 만들지 않는다.
- 하지 않은 일: 과거 비활성 파일 소급 공개·카카오/X 앱의 미리보기 캐시 갱신 보장·실기기 푸시 수신/기본 Back 성공 주장·전체 테스트·자체 기사 파이프라인 변경.
