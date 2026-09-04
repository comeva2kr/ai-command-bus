# NH111 최종 로컬 봉합 보고

기준일: 2026-09-04 KST
대상: David가 수용한 Today 기사 구성과 NH107~109 기능을 보존한 최종 로컬판
판정: **로컬 GO, 라이브 미반영**

## 이용자에게 달라진 결과

1. 카테고리를 바꿔도 이미 고른 기사의 제목·출처·사진·요약·순서는 바뀌지 않는다.
2. ELLE 기사 상세에는 가입 안내와 편집기 문구 대신 실제 기사 본문만 나온다.
3. 월러 기사에서 `연준 총재`, `의원`으로 잘못 표시되던 직함은 `연준 이사`로 정정됐다.
4. MarketWatch처럼 원문 전체가 유료벽인 소스는 새 Today 후보로 수집하지 않는다.
5. 기사 상세는 발행 전에 준비된 데이터로 즉시 열리며 요청 중 LLM 호출은 없다.
6. 알림 중복, 뒤로가기, 오래된 기사 링크 등 NH109에서 고친 동작은 그대로 유지된다.

## 최소 근인 수정

### 기사 본문

- `src/feed/enrich.js`의 기존 공통 본문 경로만 수정했다.
- ELLE는 `atc_body_cont` 안의 문단만 읽는다.
- 가입/CMS 안내, 연합뉴스 상단 안내, 갤러리 메타데이터, Highsnobiety CTA는 확인된
  문구와 문장 경계가 맞을 때만 제거한다.
- `Coupang 쇼핑몰`, `Naver 쇼핑 라이브`, `Amazon 쇼핑객`, `SSG 쇼핑센터`,
  영문 `shop` 기사 문장 등 정상 반례 7종은 보존한다.

### 검수 교정

- `tools/build-slot-canonical-edition.mjs`의 기존 headline review에 선택 필드
  `articleSummaryTextKo`만 확장했다.
- 64자리 근거 SHA와 정확한 원제목 또는 현재 사건에 존재하는 `https` 원문 URL이
  모두 맞아야 적용된다.
- `javascript:` URL, 다른 원문 URL, 추가 키, 근거 불일치는 전부 거부한다.
- 교정은 요약 텍스트만 바꾸며 기사 선택·제목·출처·사진·분류에는 손대지 않는다.

### 유료 소스와 스테이징

- `marketwatch-top` 신규 수집만 비활성화했다. 이미 공개한 기사의 archive/permalink는
  유지해 기존 링크를 깨뜨리지 않는다.
- 실제 로컬 서버에는 있었지만 스테이징에 빠졌던
  `NOWHOT_SLOT_CANONICAL_EDITION=1` 기본값 한 줄을 맞췄다. 빈 임시 저장소에서 옛
  동적 편성을 다시 하던 70초 지연과 영수증 없음은 이 환경 불일치가 원인이었다.
- 스테이징은 고정판을 읽기만 하고 다음 슬롯을 만들지 않도록
  `NOWHOT_SLOT_CANONICAL_PREPUBLISH=0`으로 예약 작업을 분리했다. 저녁 준비 시각에
  스테이징을 다시 돌려도 검수된 로컬 포인터를 임시 풀로 덮지 않는다.

## 선정 보존 증거

- 폐기 후보: `SCE-afa587d56dec...` 계열은 동일 routing 입력인데도 선택 5건과 lane
  순서가 달라져 활성화하지 않았다.
- 최종 활성: `SCE-0b991485de03a38a`
- 콘텐츠 SHA-256: `0b991485de03a38a3191fe43eedb27cf5773b0c7463065ad3f83455401238722`
- 고유 사건 195개, 14개 분야 각각 14건.
- 모든 91개 두 분야 조합은 각 단독 lane의 정확한 중복 제거 합집합이며 27~28건이다.
- 기존 검수판 대비 변경 24건, 변경 필드는 전부 `articleSummary.textKo` 하나다.
- `displayOrder`, `lanes`, `routingSnapshot`, 제목, 출처, 사진은 기준판과 같다.
- 확인된 사이트 UI 잔재 0건, MarketWatch 0건, `llmUsage []`.
- 상세 상태: `excerpt_only` 155건, `source_unavailable` 40건, pending/error 0건.
  후자는 공개 본문 부족·접근 거부·기사 정체성 불일치 등이며 내용을 만들어 채우지 않았다.

## 실제 검증

| 검증 | 결과 |
| --- | --- |
| 실제 4100 API | 뉴스 14, 경제 14, 뉴스+경제 28, 같은 artifact, `filter_only`, LLM 0 |
| 전체 node:test | 1,920건 중 PASS 1,911, FAIL 0, 브라우저 환경 SKIP 9 |
| 실제 Chrome | 9/9 PASS |
| 스테이징 수집 | 103개 소스, 2,807건 |
| 스테이징 Today | 편집 필드 56건, 후보 240건/출처 40곳, 편집 게이트 PASS |
| 스테이징 성능 | 홈 4ms, 피드 10페이지/페이지 충족 PASS |
| 스테이징 한계 | 쿠팡 운영 자격증명이 로컬에 없어 광고 슬롯 1항만 미검증, exit 2 |

스테이징의 광고 한 항목을 숨겨 전체 PASS라고 부르지 않는다. 기사·Today·피드·화면·속도
항목은 모두 통과했다. 실제 Android 단말, 운영 쿠팡 자격증명, 라이브 VM은 아직 검증하지 않았다.

## 3자 상호 검수

- Codex: 전체 경로 구현·TDD·실제 HTTP/Chrome·전체 회귀·스테이징 담당.
- Claude Sonnet 5: 본문 정리 과삭제 반례를 공격해 초기 쇼핑 정규식의 P1을 발견했다.
  수정 뒤 11개 보존/4개 제거 반례와 최종 요약 155건을 대조해 GO(P0/P1 0) 판정했다.
- Cursor Grok 4.6 Extra High: 판본 해시, 14개 lane, 91개 합집합, 변경 필드,
  review 공격 입력, MarketWatch 신규 제외/기존 archive 보존을 독립 계산했다. 최종 검수에서
  스테이징 예약 빌드 P1을 발견했고, OFF 경로 동작 테스트와 재실행 결과를 대조해
  최종 GO(P0/P1 0)로 판정했다.

두 검수자의 지적이 일치하기 전 후보를 활성화하지 않았다. 모델 의견만으로 통과시키지 않고
실제 파일·API·브라우저 결과를 최종 근거로 사용했다.

## 작업 기록

- 입력 분류: 최종 지시 및 커밋 승인. 목표는 수용한 결과를 보존하며 확인된 결함과 유료벽
  신규 수집만 제거하는 것.
- 작업 시작 전 확인한 MD / 자동 주입: 프로젝트 AGENTS.md, WRC 전역 시작 게이트,
  memory summary, Ponytail 지시.
- 작업 시작 전 확인한 MD / 직접 읽음: WRC START_HERE, 운영체계 정본, Wiki 규칙,
  enforcement, PMO board, report index; NowHot README, Blueprint, 개발현황, NH109/NH110;
  Superpowers using/systematic-debugging/TDD/verification, Orca CLI.
- 미읽음/불가: 관련 없는 WRC 프로젝트 문서 전수, 실제 Android 단말, 운영 VM 시크릿.
- 이번 작업 전용 파일: 본 보고서, NH111 후보/영수증/검수 자료, 관련 소스와 테스트.
- 적용한 규칙: 목적·전체 경로 우선, 성공 동작 보존, 최소 근인 수정, TDD,
  무과금 명확 경로, Codex·Claude·Cursor Grok 상호 반례 검수.
- First Principles 게이트: PASS.
- 개발현황 반영 / 대상 안정 ID: `NOWHOT-DEVELOPMENT-STATUS-001`.
- 개발현황 반영 / 변경 레코드: `DEVCHG-NOWHOT-20260904-196`.
- 개발현황 반영 / 대조 결과: 코드·활성 artifact·실제 4100·Chrome·전체 테스트·스테이징 일치.
- 금지선 준수: 유료 기사/API 호출, push, 운영 배포, 라이브 변경 없음.
- David 행동 필요 여부: 로컬 화면 확인 외 없음. 라이브 배포는 별도 최종 GO 필요.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: 수용한 편성을 재생성하지 않고 이용자에게 보인 오류만 제거했다.
- 하지 않은 일: 유료벽 우회, 불확실 본문 생성, 전량 LLM 재요약, 실제 푸시, 라이브 배포.
