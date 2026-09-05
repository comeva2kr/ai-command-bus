# NH119 오늘판 관심 분야 상단 고정

- 안정 ID `NOWHOT-TODAY-STICKY-CATEGORIES-001`, 변경 레코드 `DEVCHG-NOWHOT-20260905-206`.
- 입력 분류: 확정 변경 요청. 오늘판의 관심 분야를 목록을 읽는 중에도 선택할 수 있도록 상단 고정한다. Codex 책임 구현·운영 검증, Orca Fable 5.1 max 독립 CSS 검토.
- `today.html` CSS3규칙만 수정: 관심 분야 sticky/불투명 테마 배경/z20, 기존 헤더 바로 아래65px(모바일59px), 데스크톱 요약 레일184px. 기존 관심 분야 가로 스크롤·선택 API·기사/광고·상세 DOM은 유지한다.
- 격리 Chrome에서 로컬 HTML+공개 데이터, 393/320/1100px 화면 검사 PASS. 모바일 헤더 아래/분야 위59px 일치; 데스크톱65px 일치·분야 아래176.28px/레일 위184px. 버튼 hit-test·가로 탐색·라이트/다크 배경·상세 열기/닫기·페이지 가로 넘침0 확인. 신규 안내창이 첫 hit-test를 가린 경우는 안내 정상 닫기 후 재실행해 구분했다. 인라인 스크립트2건 구문/diff PASS. CSS 수정이므로 별도 테스트 프레임워크나 구현을 복제한 검사는 추가하지 않았다.
- Orca Fable5.1 max 독립 검토 GO(`task_ce42dc619e9d`/`ctx_c13003fb76b3`, 응답 `msg_4f0b54098ed1`). 조상 overflow 제약 없음·65/59px 헤더 경계·테마 배경·모달 위계·184px 레일 여유 확인. 620–860px에서는 기존 정적 레일을 유지한다. worker_done 수신 후 release/ack 완료. 운영 영수증은 아래에 추가한다.
- 운영 `7c8f96877e042bca58958d091a46152ae8a4a3ad` 2026-09-05 11:51:07 KST 컨테이너 교체·배포, 11:51:34 자동 preflight OK.
- 최종 공개 Chrome(HTML 덮어쓰기 없음, 서비스워커 허용)에서393px 모바일 헤더 아래/분야 위59px,1100px 데스크톱65px 일치와 레일184px 확인. 두 폭 모두56이슈/6광고·가로 넘침0 유지. 임시 브라우저 프로필/프로세스 종료. 실제 iPhone 확인은 별도다.

## WRC 보고

- 작업 시작 전 확인한 MD: 자동 주입 — 사용자 AGENTS.md·메모리 요약. 직접 읽음 — WRC 시작 게이트6파일의 관련 구간·정본13 First Principles, wrc-start/orchestration, 프로젝트 README/개발현황; 같은 세션의 Orca 버전별 가이드 재사용. 미읽음/불가 — 실제 iPhone 단말. 이번 작업 전용 파일 — Today HTML과 본 보고서.
- 적용한 규칙: 사용자 변경 요청·기존 배포 승인 범위, Canonical11.1 최소 수정, Corridor 사전 계획 검사, CSS native sticky, 전용 브라우저 격리.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드를 `NOWHOT_DEVELOPMENT_STATUS.md`에 연결.
- 금지선 준수: 개인 브라우저·실사용자 관심 분야 설정·광고 링크/계정/클릭·판본 데이터 변경 없음. CSS 배치만 수정.
- David 행동 필요 여부: 운영 반영 후 새로고침1회.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. 읽는 위치에서 분야를 바꿀 수 있게 하며 새 의존성·JS·설정 없이 구현.
- 하지 않은 일: 새 스크롤 제어 JS·필터/랭킹 변경·광고 변경·실제 iPhone 확인.
