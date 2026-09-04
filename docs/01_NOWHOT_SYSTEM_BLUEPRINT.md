# NOWHOT-SYSTEM-BLUEPRINT-003

## 상태와 경계

- 기준 헌장: `NOWHOT-PRODUCT-CHARTER-001`
- 벤치마크 입력: `NOWHOT-BENCHMARK-DIRECTION-002`
- 선별·편집 엔진: `NOWHOT-SELECTION-EDITORIAL-001`
- 현재 변경: `DEVCHG-NOWHOT-20260901-184`
- 현재 상태: NH94 구현·검증 완료, 새 후보 비활성 / 로컬 활성판·운영 불변
- 개정: v5 (2026-09-01 상시 개발 행동원칙 — 아래 개정 섹션이 이전 서술과 충돌하면 v5가 우선)
- 대상 환경: `/Users/hyundonghwang/Documents/NowHot-Local-Dev`
- 운영 반영: 없음

이 문서는 영구 사명을 실제 제품 구조로 번역한다. 화면과 기술은 검증 결과에 따라
버전업할 수 있지만, 변경 시 헌장 원칙과 안정 ID별 영향 대조가 필요하다.

## 상시 개발 행동원칙

이 원칙은 NowHot의 계획·개발·수리·검수 전 라운드에 자동 적용한다. WRC 13 First
Principles와 충돌하지 않으며, 중복되는 최소 변경·비용·보고 규칙은 이 절로 합쳐 해석한다.

1. **목적·전체 경로 우선**: 기능 완성과 사용자 가치를 기준으로 수집→분류→편성→요약→화면의
   실제 경로를 먼저 확인하고, 눈앞의 증상만 고치지 않는다.
2. **최소 근인 수정**: 이미 성공한 동작은 보존하고 모든 관련 호출자가 지나는 공통 원인 한 곳을
   가장 작고 단순한 비하드코딩 방식으로 고친다. 필요 없는 프레임워크·규칙·테스트는 만들지 않는다.
3. **비용 효율**: 명확한 일은 기존 데이터와 무료 결정 규칙으로 처리하고, LLM은 중요하면서
   애매한 소수 항목에만 사용한다. 품질을 낮춰 비용을 줄이지 않는다.
4. **3자 역할 견제**: Codex는 전체 경로 추적과 구현, Claude는 제품·편집·근거 품질, Cursor
   Grok은 구조·회귀·반례 공격을 맡아 서로의 결론을 독립적으로 검수한다.
5. **합의 뒤 실행**: 세 판단이 갈리면 구현을 밀어붙이지 않고 차이의 근거를 대조해 먼저 해소한다.
   합의된 최소안만 실행하며 외부 반영·유료 확대는 기존 승인 경계를 따른다.
6. **라운드 보고**: 매 라운드가 끝날 때 개선된 것, 유지된 것, 남은 문제, Blueprint상 현재 위치와
   다음 행동을 이용자 언어로 보고한다. 테스트 통과와 제품·로컬 활성·라이브 완료를 섞지 않는다.

## 기준 조합

- Techmeme: 이슈 클러스터와 높은 정보 밀도
- Google Trends: 상승 근거, 시작 시각, 활성 상태
- 뉴닉·Axios: 짧은 자체 해설 문법
- Ground News·Particle: 다중 출처 상세와 출처 투명성
- 네이버 뉴스: 한국 사용자에게 익숙한 탭·순위·시간 표기

어느 하나를 복제하지 않는다. 지금핫의 공개 반응 데이터와 한국어 사용 상황에 맞는
요소만 가져온다.

## 전체 구조

```mermaid
flowchart LR
  A[공개 소스 수집] --> B[시계열 신호·출처 정규화]
  B --> C[사건 클러스터·독립 출처 판정]
  C --> D[화제·중요·신뢰·개인 적합·변화 측정]
  D --> E[LLM 의미 판정·구조화 편집]
  E --> F[주장·수치·출처 검증]
  F --> G[아침·낮·저녁 판본 재고]
  G --> H[선택 카테고리별 개인 페이지 조립]
  H --> I[오늘의 브리핑]
  G --> J[실시간·사건 상세·아카이브]
  I --> K[이용·재방문·평가 신호]
  J --> K
  K --> H
  I --> L[문맥형 광고·제휴]
```

## 정보 구조

| 경로 | 역할 | 색인 | 핵심 수용 조건 |
|---|---|---|---|
| `/` | 최신 개인 브리핑 판본 | index | 선택 카테고리의 국내외 필수·화제·유용 정보를 고정 개수 없이 한 페이지에 완결 |
| `/live` | 같은 셸의 실시간 모드 | noindex | 홈 복귀, 개인화·필터·읽던 위치를 보존 |
| `/story/:clusterId` | 사건 단위 상세 | 조건부 index | 타임라인·측정 근거·출처·해설·관전을 한곳에 제공 |
| `/briefing` | 판본 아카이브 | index | 날짜와 아침·낮·저녁 판본을 탐색하되 오늘 본문을 복제하지 않음 |
| `/briefing/YYYY-MM-DD` | 하루 판본 색인 | index | 해당 날짜의 세 판과 수정 이력을 제공 |
| `/briefing/YYYY-MM-DD/:edition` | 검증된 개별 판본 | index | 발행 당시 근거·구성·이전 판과의 차이를 고정 |
| `/report` | 방법론·데이터 리포트 | index | 측정 정의와 한계를 구체적으로 공개 |

## 공통 셸

- 모든 화면에 `지금핫` 브랜드와 `오늘·실시간·관심 분야·저장` 주 내비게이션을 둔다.
- 브랜드는 항상 `/`로 이동한다.
- 현재 모드는 시각적으로 명확히 표시한다.
- 현재 판본, 마지막 검증 시각, 선택 카테고리와 다음 판 상태를 표시한다.
- 상세에서 `뒤로`는 직전 목록·필터·스크롤 위치를 복원하고 `홈`은 `/`로 이동한다.
- 서버 페이지와 실시간 앱이 서로 다른 제품처럼 보이지 않도록 헤더, 폭, 타이포,
  상태 표시 규칙을 공유한다.

## 첫 화면 도면

### 데스크톱

```text
[지금핫] [오늘] [실시간] [관심 분야] [저장]   [낮판 · 검증 시각]
----------------------------------------------------------------
내가 고른 분야의 필수 브리핑                 지금 급상승
이슈 행: 무슨 일·왜 중요·왜 뜨나·변화·근거  상승 사건·속도·출처 폭
이슈 행: 무슨 일·왜 중요·왜 뜨나·변화·근거  상승 사건·속도·출처 폭
이슈 행: 무슨 일·왜 중요·왜 뜨나·변화·근거  상승 사건·속도·출처 폭
----------------------------------------------------------------
선택 분야별 주요 소식 / 이전 판 이후 변화 / 전체 필수 / 판본 아카이브
```

고정된 `상위 3~5개` 수용 조건을 두지 않는다. 첫 900px에는 자세한 핵심 행과
실시간 상승을 함께 보여 정보 밀도를 확보하고, 다음 섹션의 시작이 보여야 한다.
장식용 대형 히어로와 기능 설명 카드는 두지 않는다.

### 모바일

```text
[지금핫]             [검색] [메뉴]
[오늘] [실시간] [관심 분야] [저장]
낮판 · 마지막 검증 · 선택 분야
--------------------------------
첫 핵심 사건 전체
다음 핵심 사건의 제목·요약
--------------------------------
선택 분야의 나머지 사건이 한 페이지로 계속 이어짐
```

고정 요소가 본문을 가리지 않아야 하고, 가장 긴 한국어 제목에서도 가로 넘침이 없어야
한다. 필수 내용을 `더보기`나 별도 페이지 뒤에 숨기지 않는다.

### 동적 분량 계약

- 선택 분야마다 품질을 통과한 중요도 상위 이슈를 최대 14건까지 선별하므로 선택 분야가 늘면 유효 공급량만큼 판본도 늘어난다.
- 여러 분야를 선택하면 각 분야의 선별 목록을 합치고 동일 사건은 한 번만 남긴다.
- 최종 순서는 각 분야의 1위층, 2위층 순으로 합치며 같은 층에서는 전체 중요도가 높은 이슈를 먼저 둔다.
- 선택하지 않은 카테고리는 일반 지면에 자동 혼합하지 않는다.
- 선택 밖의 중대 사건은 `전체 필수` 레인에 분리하고 포함 이유를 표시한다.
- 후보가 적은 날에는 관련 없는 글이나 품질 미달 글로 분량을 채우지 않는다.

## 사건 클러스터 계약

| 필드 | 역할 | 필수 |
|---|---|---|
| `clusterId` | 페이지 전체가 공유하는 사건 안정 ID | 예 |
| `categoryIds` | 복수 선택 분야와 세부 주제 | 예 |
| `editionIds` | 포함된 아침·낮·저녁 판본 ID | 예 |
| `headline` | 사실과 의미를 함께 담은 지금핫 제목 | 예 |
| `whatHappened` | 교차 확인된 사실 한 문장 | 예 |
| `whyImportant` | 놓치면 잃는 판단·맥락·활용 가치 | 예 |
| `whyHot` | 반응이 지금 커진 측정 근거 한 문장 | 예 |
| `whyForYou` | 선택 카테고리·세부 주제와의 연결 근거 | 예 |
| `changedSincePrevious` | 이전 판 이후 달라진 사실·수치·상태 | 예 |
| `scorecard` | 화제·중요·신뢰·개인 적합·변화 축과 근거 | 예 |
| `metrics` | 독립 출처·플랫폼·반응·속도·가속도·시각 | 예 |
| `sourceEvidence` | 원문 URL·매체·발행 시각·원출처·근거 역할 | 예 |
| `watchNext` | 아직 확정되지 않은 다음 확인점 | 조건부 |
| `confidence` | 근거 충족 상태와 미확인 사유 | 예 |
| `publishedAt` | 처음 공개한 시각 | 예 |
| `updatedAt` | 근거 또는 해설이 마지막으로 바뀐 시각 | 예 |
| `corrections` | 수정 전후·사유·시각 | 조건부 |

홈·실시간·상세·아카이브는 같은 클러스터를 서로 다른 깊이로 투영한다. 페이지마다
해설을 다시 생성하지 않는다.

## 해설 문법

1. `무슨 일`: 두 곳 이상에서 확인된 사건의 현재 사실
2. `왜 중요한가`: 놓치면 잃는 판단·맥락·활용 가치
3. `왜 뜨나`: 평소 대비 반응량·증가 속도·독립 출처 확산의 실제 측정 근거
4. `왜 내게`: 명시적으로 선택한 카테고리·세부 주제와의 연결
5. `달라진 점`: 이전 판 이후 새로 확인된 사실·수치·상태
6. `관전`: 아직 일어나지 않았거나 확인되지 않은 다음 체크포인트

출처 하나뿐인 사건은 핵심 브리핑으로 자동 승격하지 않는다. 예외는 공식 발표처럼
단일 1차 출처가 사건 자체인 경우이며, 그 사실을 표시한다.

## 선별·편집·LLM 경계

상세 계약은 `NOWHOT-SELECTION-EDITORIAL-001`을 따른다.

- 코드는 댓글·클릭·공유·언급·속도·독립 출처를 측정하고 정규화한다.
- LLM은 검증 가능한 근거 묶음 안에서 분류·의미 판정·한국어 편집을 수행한다.
- 별도 검증 단계가 LLM의 주장과 수치·출처를 대조한다.
- 출처 신뢰도는 레지스트리의 관측 근거로 판정하고 LLM 인상으로 만들지 않는다.
- 정렬된 선택 카테고리 조합별 판본 재고를 먼저 생성하고 같은 조합의 사용자가
  공유한다. 사용자마다 전체 브리핑을 다시 생성하지 않는다.
- 모델·수집·검증 실패 시 마지막 검증 판본과 결정론적 피드로 폴백한다.

## 하루 세 판

- `morning` 07:00 KST: 밤사이 핵심 변화와 오늘의 관전
- `lunch` 12:00 KST: 오전 이후 새 사건과 중요 변화 (`midday`는 요청 별칭)
- `evening` 19:00 KST: 오늘의 결론, 놓친 핵심, 다음 관전

같은 사건은 실질적인 변화가 있을 때만 다시 등장한다. 각 판은 발행 시각을 후보
시간창의 as-of로 사용하고, 근거 스냅샷과 이전 판 차이를 보존한다. 로컬 구현 계약은
`NOWHOT-EDITORIAL-INVENTORY-CONTRACT-001`을 따른다.

슬롯별 저장 여부와 실제 시간 경과 실행은 분리한다. 날짜·슬롯별 최초 시스템 시계
관측, 지연, 당시 재고, 발행 상태와 내용 지문은
`NOWHOT-ELAPSED-EDITION-EVIDENCE-CONTRACT-001`에 따라 덮어쓰지 않고 보존한다.

## 수익 구조

- 편집 대상과 광고 대상 선정은 분리한다.
- 광고는 핵심 이슈를 읽기 전에 화면을 막지 않는다.
- `광고`, `쿠팡 파트너스 활동` 등 네트워크별 고지를 명확히 표시한다.
- 심사 모드는 한 네트워크만 사용하고 실시간 피드는 별도 정책을 유지한다.
- 광고 수익은 서버 측 자체 노출·클릭과 광고 콘솔 정산을 구분한다.
- 수익 최적화는 재방문·이탈·기여이익과 함께 판단한다.

## 장애와 복구

- 마지막 성공 수집 시각과 현재 수집 상태를 사용자·관리자에 표시한다.
- 일부 소스 장애는 전체 발행을 멈추지 않되, 출처 다양성 기준을 못 채운 클러스터는
  핵심 브리핑에서 내린다.
- 새 브리핑 생성 실패 시 마지막 검증 판본을 제공하고 오래된 정보임을 표시한다.
- DB 스키마와 발행 포맷 변경은 이전 판본을 읽을 수 있는 마이그레이션·롤백을 가진다.
- 배포는 로컬 실데이터, 전체 테스트, 데스크톱·모바일 시각 검수 뒤 한 번의 묶음으로
  진행한다.

## 개발 단계

| 단계 | 내용 | 진입 조건 | 현재 |
|---|---|---|---|
| B0 | 영구 제품헌장 | 사명·약속·비목표 초안 | 정본 유지 |
| B1 | 시스템 블루프린트 | 정보 구조·클러스터 계약·장애 원칙 | 정본 유지 |
| B1.5 | 선별·편집 엔진 | 다축 점수·검증·세 판·동적 분량 계약 | 로컬 구현·기계 검증 |
| B2 | 실데이터 와이어프레임 | 기존 브리핑을 충분한 개인판으로 확장 | 기존 구현 완료·현재 실행 검증 별도 |
| B3 | 공통 셸·통합 홈 구현 | 오늘·실시간 왕복과 모바일 밀도 | 로컬 구현 완료 |
| B4 | 클러스터 파이프라인 | 사건 결합·중복 억제·근거 계보 | D2-D 오늘 실기사 shadow 입력·분야별 사건 측정 경로 준비·runtime 미연결 |
| B5 | 로컬 릴리스 후보 | 독자 문장·분야 공급·정상 서빙 | 로컬 실사용 진입 PASS·다일/실이용자 검증 대기 |
| B6 | 운영 전환 | David 배포 승인·롤백 영수증 | 금지 |

## 2026-08-12~13 실사용 진입 게이트

초기 단계표를 최신 개발 원장 `NH75 / DEVCHG-NOWHOT-20260813-070`과 맞췄다.
과거 문서 영수증과 현재 런타임을 구분해 새 불변 패킷부터 네 단계를 다시 검증했다.
각 단계는 구현·표적 테스트·별도 적대적 독립검수까지 완료했다.

| 순서 | 안정 ID | 완료 조건 | 현재 |
|---|---|---|---|
| 1 | NH70-REVIEW-PACKET-PERSISTENCE | 같은 42행을 영구 저장하고 재시작 뒤 같은 패킷·지문을 복원 | PASS · `BRP-07rqta4` · 42행 · 재시작 동일 |
| 2 | NH71-INDEPENDENT-EDITORIAL-REVIEW | 독립 AI 검수 A·B가 상대 답을 보지 않고 각각 42행을 완료하고 불일치만 조정 | PASS · 84/84 · 11행/16필드 조정 · 과거 패킷 4 PASS/38 HOLD |
| 3 | NH72-DEFAULT-SUPPLY-RECOVERY | 유머를 포함한 기본 조합과 부족 분야를 품질 미달 채우기 없이 충족 | PASS · 기본 4/4·28건 · 전체 14/14·42건 · v21 |
| 4 | NH73-DEFAULT-TODAY-SERVEABLE | 재시작 뒤 기본 `/api/today`가 검증된 브리핑을 HTTP 200으로 제공 | PASS · HTTP 200 · 재시작 동일 · LAN/390px 정상 |
| 정정 | NH74-CATEGORY-COMBINATION-SERVEABILITY | 선택 수·조합이 달라도 공급 충족 판을 반복 문장 오탐 없이 제공 | PASS · 단일 14/14 · 두 분야 91/91 · 3~14개 층화 34/34 |
| 정정 | NH75-ADDITIVE-CATEGORY-UNION | 각 선택 분야의 상위 이슈를 합치고 같은 사건은 한 번만, 분야별 중요도 순위 층으로 혼합 | PASS · 경제+과학 28건 · 14/14 · 고유 사건 28/28 · 390px 정상 |
| 출시후보 | NH76-V2-CATEGORY-ROUTING-RUNTIME | 선택 분야 승인만 Today에 연결하고 복수 분야는 1장, 미분류·성인·문안 HOLD는 보류하며 v1 즉시 복귀 | 로컬 PASS · 게임 13 · 기술+게임 24 · 분야 밖 0 · 전체 1,512/1,512 · 운영 대기 |

각 순서는 구현·표적 테스트·별도 적대적 독립검수의 세 증거가 모두 PASS일 때만
다음으로 이동한다. 외부 LLM 확대, 새 기능, 운영 배포는 이 실행 범위에 포함하지 않는다.

NH70 실행 영수증은 파일 저장 로컬 서버에서 생성한 `BRP-07rqta4`다. 정렬한 42행
SHA-256은 `c36eafd025502366ef6f287298f3d7c8e334e0e59a1f9827800204d6c970f6bd`,
재시작 전후 패킷·판본·행 대조 지문은
`d4ccdf4726e990a1bd211a380a74a440d1ebc3d5cd56271c6e04046c22ad80cb`로 같았다.
정시 canonical 판본 변경과 외부 LLM 호출은 모두 0이다.

NH71은 동일한 42행을 두 독립 AI 검수자에게 분리 제공해 84/84 판정을 완료했다.
11행 16필드의 의견 차이만 세 번째 독립 조정으로 닫았다. 동결된 과거 패킷은
`human_quality_hold` 38행, 통과 4행으로 그대로 보존했고, 확인된 문체·제목·중요성·
변화 설명 결함은 미래 생성 판에만 최소 수리했다. 실제 사람 검수나 사람 신원 확인을
뜻하지 않으며 제품 런타임 LLM 호출은 0이다.

NH72는 새 소스를 늘리지 않고 후보 선택 순서만 바로잡았다. 개인 오늘판에서 한국어로
읽을 수 있는 유효 후보를 분야 최소치에 먼저 쓰고 나머지는 기존 순위로 복원한다.
기본 조합은 4/4·28건, 전체 선택은 14/14·42건이며 NH72 당시 계약 재고는 `v21`이다.
현재 시각에 품질 HOLD인 부분 재고는 저장하지 않고, 구버전 `v17·v18·v20`은 보존했다.

NH73 기본판은 판본 `2026-08-12-lunch-business.humor.news.tech`, 패킷
`BRP-1657l0y`, 28건, HTTP 200이다. 재시작 전후 응답 SHA-256
`696bbff505899752fa4599032c903ee48e5a1fd3848069e6eca005545850c362`와 이슈 지문
`30f5aec67a553dcaeb6ffef198292b016404fd7ea6d9aea22739d8814fbf4190`가 같았다.
같은 Wi-Fi의 LAN 응답과 390px 모바일 레이아웃도 정상이며, 최종 독립 AI 검수는
원시 파일·파싱 대조 뒤 PASS했다. 전체 회귀는 1,138/1,138 PASS다.

NH74는 실사용 중 발견된 조합별 409를 정정한다. 원문 공급과 분야 최소치는
충족했지만 사건명이 빠진 자동 중요성·지금 이유·다음 확인 문장이 반복되면서
판 전체 다양성 관문이 정상판까지 막았다. 품질 관문을 낮추지 않고 문장을 근거
사건명에 연결했으며, 실데이터에서 단일 14/14, 두 분야 전 조합 91/91,
3~14개 선택 층화 표본 34/34가 모두 HTTP 200을 반환했다. 표적 37/37과 전체
1,139/1,139 회귀도 통과했고 새 소스·제품 런타임 LLM·운영 배포는 0이다.

NH75는 단일 분야 14건씩이 두 분야 선택에서 16건으로 잘리던 전역 예산·최소 할당을
분야별 합집합으로 바꿨다. 분야마다 최대 14건을 먼저 선별하고, 같은 사건은 한 번만
남긴 뒤 분야별 중요도 순위 층과 같은 층의 전체 중요도를 함께 적용한다. 현재 `v26` 실데이터에서
경제 단독 14건, 과학 단독 14건, 경제+과학 28건(각 14건)이 제공됐다. 조합판 사건 ID는
28/28 고유하고 분야 전환은 27회다. 서로 다른 URL·제목 변형도 핵심 숫자와 고유
사건어가 함께 일치할 때만 한 번으로 접고, 핵심 숫자가 다른 사건은 따로 유지한다.
자동 생성된 본문 문구는 사건 정체성 비교에서 제외해 별개 사건을 이전 보도로 잘못
잇지 않는다.
단독 경제 12건은 반복·품질 관문을 통과한 공급만
제공한 결과이며 14건을 맞추기 위한 품질 미달 채우기는 하지 않는다. 390x844 화면은
28개 카드와 안내 문구가 일치하고 가로 넘침·브라우저 오류가 없다. 표적 통합 회귀는
69/69, 전체 회귀는 1,145/1,145 PASS다. 최종 독립 AI 적대검수도 P0/P1/P2 0건으로
PASS했으며 실제 사람 검수나 운영 승인을 뜻하지 않는다.

## 구현 수용 기준

- 홈은 별도 설명 없이 최신 개인 브리핑 판을 완결한다.
- 선택 카테고리 수와 유효 후보량에 따라 페이지 분량이 실제로 달라진다.
- 안 고른 카테고리는 일반 지면에 자동 혼합되지 않고 전체 필수는 별도 표시된다.
- 아침·낮·저녁 세 판과 이전 판 이후의 변화가 데이터 계약에 남는다.
- `/live`에서 홈으로 항상 돌아갈 수 있다.
- 뒤로가기는 목록 상태와 스크롤을 보존한다.
- 핵심 사건은 중복 없이 다섯 점수 축·근거·LLM 주장 검증 상태를 보여준다.
- 1440x900, 390x844에서 넘침·겹침·빈 화면이 없다.
- 광고를 끄거나 수집 일부가 실패해도 핵심 읽기 흐름이 유지된다.
- 기존 사용자 기능의 회귀 테스트가 모두 통과한다.

## 지금 하지 않는 것

- 운영 `main` 배포와 GitHub push
- LLM의 인상만으로 만든 편향·출처 신뢰 점수
- 사용자별 전체 브리핑 실시간 재생성
- 대화형 AI 질문 기능
- 새 결제·구독 시스템
- 관리자에서 블루프린트를 직접 수정하는 쓰기 기능

관리자 개발관리 화면은 현재 정본을 읽는 투영 화면이다. 수정 권한과 승인 워크플로는
별도 설계 없이 추가하지 않는다.

## 2026-08-10 기존 제품 로컬 고도화 후보

- 변경 ID: `DEVCHG-NOWHOT-20260810-010`
- 편집 후보 계약: `NOWHOT-EDITION-CANDIDATE-CONTRACT-001`
- 로컬 오늘판: `NOWHOT-LOCAL-EDITORIAL-EDITION-001`

이 단계는 새 제품 구현이 아니라 기존 `FeedEngine.briefing`, `buildDigest`, 설문
개인화와 실시간 피드를 재사용하는 고도화다. 로컬 플래그가 켜진 `/`는 선택 분야의
충분한 오늘판을 제공하고 `/live`와 왕복한다. 플래그가 꺼진 기존 홈과 공개
`/api/briefing`은 로컬 후보 계약을 받지 않는다.

동적 후보 관측과 결정론적 `왜 중요·왜 지금·왜 내게`는 구현됐지만, 사람
블라인드 정답표·출처 역할과 운영 그룹 메타데이터의 완전한 커버리지·실제 모델
소량 canary와 사람 품질 판정·운영 전환은 계속 HOLD다. 주장 계보와 선택형 LLM
검증·폴백 코드 경로는 016에서 로컬 구현됐지만 실모델 품질을 증명하지 않는다.
E1은 제품 후보 수와 분리된 사람 평가 코퍼스다. 규모는 미리 정하지 않고 분야·근거
유형·출처 역할·변화 상태를 층화한 뒤, 파일럿 불일치율과 목표 정밀도·검수 예산으로
결정한다. 이 경계는 `DEVCHG-NOWHOT-20260811-019`에서 다시 정정했다.

## 2026-08-11 개인화 효용 게이트

- 변경 ID: `DEVCHG-NOWHOT-20260811-062`
- 현재 게이트: `B6-PERSONALIZATION-UTILITY-EVIDENCE-CLOSED`
- 다음 게이트: `B6-HUMAN-BLIND-EDITORIAL-PILOT`

개인화는 같은 공유 판본의 상위 10건 안에서만 기준 순서와 후보 순서를 짝지어
측정한다. 할인 선호 점수가 개선되고 선택 밖 침범이 없으며 출처·분야 다양성을
악화시키지 않을 때만 후보 순서를 제공한다. 근거가 부족하거나 다양성이 낮아지면
공유 중요도 순서로 되돌린다. 이 오프라인 대리 효용은 실제 사용자 만족도나
클릭·완독 인과를 증명하지 않는다.

다음 단계는 기능 확대가 아니라 다일 증거와 실제 이용자 판단이다. 여러 날 07·12·19시
자동 발행, 서버 재시작과 수집 장애 복구를 검증하고 소규모 비공개 이용자가 “하루 세
번이면 충분한가”를 평가한다. 사건 상세·아카이브와 운영 전환은 이 증거 뒤에 진행하며,
David 승인·배포·롤백 영수증 전까지 B6는 계속 막는다.

## 2026-08-13 개선 방향 v4 — 검수 HOLD 반영 개정

- 변경 ID: `DEVCHG-NOWHOT-20260813-077`
- 입력: 9인 AI 적대검수 실측(DEVCHG-071~076에서 서빙 구조 수리 완료) + 레퍼런스
  딥리서치(Techmeme·Ground News·Particle·뉴닉/Axios·Google Trends·네이버 랭킹·
  커뮤니티 베스트 문법, 출처 URL 동봉) + 계획 초안에 대한 PMO 적대검수 HOLD 판정.
- 원칙: 소스 물량보다 **재방문을 만드는 편집 가치**를 먼저 완성한다. 지금핫이
  "많이 모은 RSS 피드"로 퇴행하는 방향의 확장은 하지 않는다.

### 정정 1 — 공통 엔진과 카테고리 정책 팩 분리 재확인 (헌장 준수)

교차 보도 수·24시간 창·독립 언론 2곳 같은 뉴스 규칙은 경제·정치 정책 팩에만
속한다. 유머·과학·예술·패션·지식은 팩별 잣대(커뮤니티 반응, 전문지 큐레이션,
시각 자료 유무 등)를 따로 정의하며, 공통 엔진은 수집·클러스터·서빙 골격만 갖는다.

### 정정 2 — 동적 분량 계약 (12건 고정 보장 폐기)

`max(절대 최소선, 12번째 점수)` 산식은 12번째 점수가 최소선보다 낮으면 보장이
성립하지 않는다(계획 초안의 산식 결함). 확정 계약:

- 분야당 **품질 통과 목표 8~12건, 최대 14건**. 임계는 회차별 후보 풀의 분위수로
  능동 조정하되 절대 최소선 아래로 내리지 않는다.
- 부족하면 관련 없는 글로 채우지 않고 **정직한 부분 제공**(부분 서빙 고지)을 쓴다.
- 선택 분야가 늘면 합집합이 늘되 동일 사건만 한 번 남긴다. 배열은 분야 순위 층 →
  같은 층 전체 중요도.

### 신설 — 사건 생명주기 계약

판 내부 중복 제거를 넘어 사건을 계층으로 관리한다.

- **기사(article)와 사건(event)은 별도 계층이다.** 근접 기사는 삭제하지 않고
  사건의 **근거로 병합**한다 — 다른 매체의 근거가 사라지는 현재 방식
  (digest.js 근접 중복 첫 건만 보존)을 대체한다.
- 사건 ID는 아침→런치→이브닝 판 사이에서 **안정적으로 유지**된다.
- 병합·분리·별칭은 append-only 이력으로 남긴다.
- 같은 사건의 재등장은 **실질적 변화(새 사실·수치·상태)** 가 있을 때만 허용한다.
  지속 보너스도 같은 조건에서만 가산한다(자동 2일 가산은 재탕 강화라 금지).

### 정정 3 — 신호 축 (교차 보도의 위치)

- 교차 보도 수는 `importance`가 아니라 주로 **`trust`·`heat` 신호**다. 공식 발표·
  공시·논문 같은 중요한 단일 1차 출처 예외를 유지한다.
- **커뮤니티 반응(화제성)과 독립 언론 보도(확인 근거)는 합산하지 않는다** —
  서로 다른 축으로 별도 집계한다.
- 다축 선별 `heat·importance·trust·personalFit·change`를 유지한다.
- 국내발과 해외발은 잣대를 분리하고, 해외에서 크지만 국내 미보도인 사건은
  중요 해외뉴스 후보로 승격한다(국내 blindspot 규칙).

### 정정 4 — 헤드라인 편집 원칙

"헤드라인 재작성 안 함"(계획 초안)은 폐기한다. Techmeme 공식 설명대로 편집자
(우리는 LLM canary)가 설명형 헤드라인을 최종 작성한다. **원제목은 근거로
보존**하고, 지금핫 헤드라인은 근거 안에서 다시 쓴다. 파편 인용 제목·기계 문체를
사용자 화면에 그대로 내보내지 않는다.

### 정정 5 — LLM 경계 (상시 ON 아님, canary)

선별·편집 엔진 계약(02 문서)대로 LLM은 분류·판정·편집·검증에 쓰되:

- **클러스터당 1회 호출**로 `헤드라인·무슨 일·왜 중요·달라진 점·다음 확인`을 함께
  생성하고 캐시한다. `왜 뜨나`의 수치는 코드가 쓴다.
- 근거가 동결된 **대표 결함 표본으로만 canary 실행** — 주장별 근거 ID, 비용, 지연,
  미지원 주장률을 측정한 뒤 상시 ON 여부를 별도 결정한다.
- 다중 소스 게이트(독립 소스 2곳·기사 3건 미만이면 생성 금지)와 근거 검증 2차
  패스(Particle Reality Check 차용)를 전제로 한다.

### 정정 6 — 소스 정책

- 새 소스 테이블을 만들지 않는다. **기존 `communities.json`을 확장**한다(국내/해외·
  전문/종합·기본 카테고리 prior 속성).
- 전문 섹션은 `분류 금지`가 아니라 **강한 기본값** — 명백한 의미 충돌만 교정한다.
- Bloomberg·FT 등은 무료 RSS 전제 금지(라이선스 상품·계약 기반) — 공식 무료
  피드가 실제로 열리는 소스만 후보로 한다.
- 소스 채택 기준: 실제로 열리는 공식 피드 · 독립 운영그룹 · 슬롯별 고유 사건 공급 ·
  오분류율 · 중복률. "카테고리당 최소 N개" 같은 개수 목표는 쓰지 않는다.

### 정정 7 — 트렌드

- 현황을 정확히: `trends.js`는 trends24.in 목록의 20분 메모리 캐시, `interest.js`는
  Google Trends RSS 수신. **시계열 저장·누락 구간 처리·기준선·클러스터 연결이
  아직 없다.**
- 트렌드는 중요도의 단독 증거가 아니라 여러 신호 중 하나다(Google 공식 안내).
- 전용 최상단 메뉴를 먼저 만들지 않는다 — **오늘판 안에 선택 분야 관련 트렌드
  한 레인**으로 제공하고 `/trends`는 상세 진입로. 전용 메뉴는 실제 효용 확인 뒤.

### 단계 계획 P0→P6

| 단계 | 내용 | 게이트 |
|---|---|---|
| P0 | 블루프린트 v4(이 개정) + 평가 표본·성공지표 고정 | 이 문서 |
| P1 | 출처 신원·사건 클러스터 — 레지스트리 확장, 기사/사건 계층 분리, 근거 병합, 안정 사건 ID·판간 연속성. 소스 대량 추가 금지 | 고정 표본 검수 |
| P2 | 카테고리 정책 팩·소스 보강(경제·과학·스포츠부터 하나씩) — 전문 섹션 강한 prior, 종합·커뮤니티 의미 분류 | 오분류율 |
| P3 | 다축 선별·동적 분량(품질 통과 목표 범위·분야별 신선도 창) | 표본+회귀 |
| P4 | LLM 편집 canary(동결 표본 한정, 비용·지연·미지원 주장률 측정) | David 결정 |
| P5 | 오늘판 표현(기자 문체·정보 계층) + 관련 트렌드 레인 통합 | 사람 눈 확인 |
| P6 | 다일 07·12·19 연속 실행 + 실제 사람 2인 블라인드 평가 | B단계 게이트 |

각 단계: 설계·오탐 방지 기준·테스트 표본 선행 → 구현 → diff 검수 1명 + **고정
사건 표본 검수(코드 리뷰와 별도)** → 표적·전체 테스트 → 로컬 커밋. push 없음.

### 고정 평가 표본 (2026-08-13 동결 — P1~P5 공통 검수 기준)

9인 검수에서 실측된 대표 결함 사례. 각 단계는 이 표본에서의 개선을 증명해야 한다.

1. DeepSeek V4 Pro 출시 — tech(영문 HN)과 business(연합뉴스TV 한국어)로 이중
   게재: **한/영 동일 사건 결합** 표본.
2. 8·13 부동산대책 — 한 판에 6~8개 파편: **파편 병합 + 근거 보존** 표본.
3. 대통령 동일 발언이 경향신문·조선비즈로 2회 게재: **동일 발언 사건 결합** 표본.
4. 니케×페르소나 콜라보 — tech와 gaming 별건: **카테고리 간 동일 사건** 표본.
5. geeknews→해커뉴스 재유통이 "복수 출처 확인"으로 집계: **중계·독립 구분** 표본.
6. politics 분류에 "40대가 되면 줄여야 하는 음식들"(더쿠): **커뮤글 의미 분류** 표본.
7. 패션 1위가 dev.to 개발자 공지: **소스 prior 대 의미 충돌 교정** 표본.
8. science 기계번역 제목("우주 사자를 포착합니다"): **헤드라인 편집 가치** 표본.
9. "관련 보도 묶음 포착"이 단일 기사에 부착(coverage 0/5 이진 포화): **근거 라벨
   정직성** 표본.

성공지표: 판 내 동일 사건 중복 0 / 표본 1~5의 사건 결합 정확(오병합 0 포함) /
오분류율(표본 6~7 및 무작위 50건 수동 대조) / 클러스터 근거 보존율(병합 시 타
매체 근거 소실 0) / LLM canary 미지원 주장률·비용·지연 / 부분 제공 발생률 추이.
오탐(다른 사건 오병합)은 미병합보다 나쁜 실패로 계수한다.

### 2026-08-13 P2 단계 상태 판정 (David 지시 반영)

P2는 부분 통과다. 일괄 PASS로 기록하지 않는다.

| 영역 | 판정 | 근거 |
|---|---|---|
| source(소스 보강) | **PASS** | 후보 전수 실측 후 6종 등재(경제 3·과학 2·스포츠 1). 단 "공급 +90건/24h"는 부정확한 표현이었다 — 정확히는 **원시 후보 약 100건/24h**이며, 고유 사건 수·분류 통과 수·신선도 통과 수는 별도 측정한다(측정 도구·결과는 원장 기록). |
| test | **PASS** | 전체 1,197/1,197·cancelled 0, 단계별 diff 검수 3회 SHIP. |
| aggregate(종합 tier 의미 분류) | **코드 경로 PASS / 운영 효과 HOLD** (2026-08-14 David 판정 정정) | 관문 코드·동결 테스트는 커밋 a970603로 존재하나, 엔진이 현재 풀로 NB를 학습한 직후 같은 기사를 분류해 **자기 라벨을 암기** — 운영 조건 재분류 0/112은 "과교정 없음"이 아니라 **관문 무효** 상태였다(DeepSeek 표본도 전체 학습에선 business, 자기 자신 제외 시 tech). 현재 데이터 자기학습을 제거하고 운영 효과를 재측정한 뒤에만 PASS로 전환한다(수정 순서 R6). |
| runtime(실행 반영) | **HOLD** | 4100 로컬 서버는 P2 코드 미반영(구버전 가동 중), 라이브 반영 없음. 반영은 P3 shadow 비교와 묶어 staging 게이트 통과 후에만. |

P3 착수 조건(2026-08-13 David 조건부 승인): ①aggregate HOLD 해소 ②정책 팩별
eligibility 문서 고정(경제·정치 / 과학 / 스포츠 / 유머·커뮤니티 / 문화·예술·패션)
③verified 분리 — 일반 reported_secondary 1건 단독 신뢰 통과 금지, 뉴스 기본 계약
= primary·first_party 1곳 ∨ 독립 operatorGroup 2곳 ④같은 운영그룹의 분야별
피드는 수집 가능하되 독립 출처 계수 1회(BBC Sport·연합 스포츠 재검토), 소스캡
자동 완화 금지 — 부족하면 부분 제공 ⑤공급 수치 분리 측정 ⑥이 상태 표 선반영.
P3는 shadow 방식(현행판과 새 판 병렬 비교)으로 진행하며, 3일은 초기 관찰
기간이지 가중치 영구 확정 근거가 아니다. 동결 표본과 실제 판 대조 후 구현
게이트를 연다.

### 2026-08-13 정책 팩별 판 자격(eligibility) 계약 — P3 선행 고정 (David 지시 #2·#3·#4)

자격 게이트는 전 분야 공통 규칙이 아니다. 아래 팩별 계약이 P3 shadow와 구현의
정본이며, 수치 초기값은 shadow 관찰 후 고정한다(3일은 관찰 기간이지 영구 확정
근거가 아니다).

**공통 원칙 (전 팩)**
1. verified 분리: 일반 reported_secondary 기사 1건은 어느 팩에서도 단독으로
   신뢰 자격을 얻지 못한다.
2. 뉴스 기본 계약: **primary·first_party 1곳 ∨ 독립 operatorGroup 2곳**.
3. 같은 운영그룹의 분야별 피드는 수집·편성 재료로 쓰되 독립 출처 계수는 1회
   (증명 테스트: event-cluster-samples).
4. 소스캡 자동 완화 금지. 자격 통과분이 부족하면 **부분 제공(S3b)** — 무관한
   글로 채우지 않는다.
5. 재등장 게이트: 직전 판 동일 사건은 factsFingerprint 실질 변화 없으면 제외.
6. 품질 게이트(editorial-quality)는 전 팩 공통 선행.

**팩 테이블**

| 팩 | 카테고리 | 신뢰 자격 | 신선도 창(초기값) | 소스캡 |
|---|---|---|---|---|
| 경제·정치 | business·politics·realestate·news(종합) — tech·auto 보도형은 이 잣대 준용 | 뉴스 기본 계약 | 12h(모닝판 24h) | 운영그룹당 2 |
| 과학 | science | 뉴스 기본 계약 — 기관 primary(NASA 등) 1곳이 유효한 단독 통과 경로 | 24~48h(논문·보도 리듬) | 운영그룹당 3 |
| 스포츠 | sports | 뉴스 기본 계약(공식 경기 결과 단독 보도 예외는 미결 — 아래) | 24h | 운영그룹당 2 |
| 유머·커뮤니티 | humor·life + kind=community 전체 | 언론 계수 무의미(실측: 커뮤 다중 구성 사건 0건) — 절대 반응선 eng≥30(초기값) + 커뮤 자체 신호. 언론 신뢰 라벨 미부착 | 6h(당일성) | 소스당 2 |
| 문화·예술·패션 | culture·fashion·art·gaming | 보도형은 뉴스 기본 계약, 전문 섹션은 specialist 선언 존중. 커뮤글은 커뮤 팩 잣대 | 24h | 운영그룹당 2 |

**실측 파급 (C5, 2026-08-13, tools/eval-source-supply.mjs)**
- 신규 8소스 공급: 원시 24h 219 → 고유 사건 192 → 분류 통과 191 → 신선도
  통과 191. ("원시 후보 약 100건"은 6소스 시점 수치.)
- 과학: 고유 사건 14건/24h 중 livescience 9건은 reported_secondary 단독이라
  자격 미달 — primary(NASA) 경로만 남아 **과학판은 구조적으로 부분판 확률이
  높다**. 계약대로 부분 제공하며 무리하게 채우지 않는다.
- 스포츠: 독립 운영그룹 3개(disney·bbc·yonhap) 확보 — 대형 사건은 독립 2
  충족 가능. 단독 경기 결과는 미결 규칙에 따라 달라진다.

**미결 (David 확인 필요)**
1. 스포츠 공식 결과·기록의 단독 보도 예외 여부 — 추천: v1 예외 없음(부분판
   허용), shadow 실측 후 결정.
2. 카테고리→팩 배속: tech·auto→경제·정치 잣대 준용, gaming→문화 팩,
   life→커뮤 팩 — 추천안. 이견 시 조정.
3. 커뮤 절대선 eng≥30·신선도 창 초기값 — shadow 관찰 후 고정.

### 2026-08-14 P3-A 판정 — 3일 관찰 HOLD (David PMO 검수 반영)

P3-A는 테스트 1,231 통과에도 **제품 승격 HOLD**다. 테스트 PASS·코드 경로
PASS·운영/제품 효과 PASS를 구분해 기록한다. 운영 서빙 무변경이라 현재 서비스
훼손은 없다.

**치명 결함 (검수 확정)**
1. 카테고리가 아니라 정책 팩 전체에서 14건을 뽑는다 — `선택 분야별 최대
   14건 → 합집합 → 교차 배치`(이 문서 동적 분량 계약)와 정면 충돌. "두 분야
   골랐는데 16건" 문제 재발 구조.
2. 클러스터링 순서 역전 — 팩으로 기사를 자른 뒤 사건을 묶어, 같은 사건의
   스포츠 매체 1곳+종합뉴스 1곳이 각각 '단일 출처'로 탈락하는 반례 확인.
   **전체 기사 클러스터링이 카테고리 라우팅보다 먼저다.**
3. 품질 게이트가 shadow 평가에 미연결 — 광고성 글 통과, 표본 수치 오염.
4. 이전 판 상태를 평가에 안 넘겨 재등장 검사가 꺼져 있고, 이른 기사 합류로
   eventId가 바뀌면 같은 사건이 신규로 재선택되는 반례 재현(호르무즈형).
5. "현행판"이 실제 todayEdition이 아니라 임시 buildDigest 모형 — 동일
   사용자·동일 분야·동일 슬롯 비교가 아님.
6. aggregate 분류는 자기학습 암기로 운영 효과 0 (위 상태 표 정정).

**정책 판단 (David 확정)**
- 스포츠: 임의 eventId 예외 금지. **신뢰 등급제** — A등급: 공식 리그·협회·
  팀 결과(1차 출처), B등급: 신뢰할 만한 전문매체 단독 보도는 '단일 출처'
  표기로 허용.
- 단일 전문매체 무조건 차단은 과잉 — **민감한 의혹·시장 영향 뉴스만 2개
  출처 강제.** (문화 분야가 이미 전문매체 1곳 통과라 문서·코드 모순이었음.)
- 소스캡: **표시할 대표기사를 먼저 선정한 뒤 그 대표기사 기준** 적용.
- 커뮤니티 문턱(eng≥30) 조정: 품질 필터 연결 전 보류.
- 3일 자동 관찰: 위 구조 수정 전 시작 금지 — 잘못된 구조의 숫자만 쌓인다.

**최소 수정 순서 (R1~R7)**
1. R1: 전체 기사 사건 클러스터링 선행 + 지속 가능한 사건 계보(eventId가
   바뀌어도 이전 판 사건이 이어지는 영구 지문/별칭)
2. R2: requestedCategories별 선별 후 합집합·중복 제거·중요도 교차 배치
3. R3: 품질 게이트 연결 + 실제 todayEdition 대 P3판 비교기(동일 사용자·
   동일 분야·동일 슬롯)
4. R4: 이전 아침·점심·저녁 판 상태를 넘기는 연속 관찰
5. R5: 신뢰 등급(A/B)·대표기사 선정 확정, 캡을 대표기사 기준으로
6. R6: aggregate 자기학습 제거 + 운영 효과 재측정
7. R7: 입력 해시·선택/탈락 ID·사유만 담은 가벼운 영수증 → R1·R2·R3·R4
   반례 테스트 통과 확인 → David 게이트 → 3일 관찰

그전까지 금지: 추가 소스, LLM, 대규모 검수(단계별 diff 검수 1명만 유지).

### 2026-08-17 3일 관찰 판정 — 재등장 의미론 명문화 + S2 수리 (David 승인)

**관찰 결과 요지** (원본: docs/reports/NOWHOT_ADFIT_SHADOW_REPORT_2026-08-17.md,
S0 전수 분석·원장 DEVCHG-105): 11슬롯 완주·재등장 차단 574건 전수 감사 **과잉
차단 0건** — "선별 침식"은 버그가 아니라 신규 공급 감소(과학 -32%)와 재등장
차단의 정직한 상호작용. 초기값(팩 가중·신선도 창·커뮤 eng≥30·소스캡 2)은
**전부 유지 판정** — 3일 병목은 공급·캡·게이트였고 가중 기인 탈락 0건.

**재등장 의미론 확정**: "하루 세 판" 계약 원문 — *같은 사건은 실질적인 변화가
있을 때만 다시 등장한다* — 가 정본이며, 구현(마지막 서빙 이후 factsFingerprint
불변이면 무기한 차단)이 이와 일치한다. eligibility 계약 공통 원칙 5의 "직전 판"
표현은 이 문언으로 읽는다(직전 판 한정 아님 — 한정으로 좁히면 최대 이틀 묵은
재탕이 들어와 계약이 깨진다. 기각).

**S2 수리 반영**:
1. 하루특가류 광고 사전 보강 — 관찰 3일간 이 계열 47건 게이트 전량 통과·3건
   실선별(판 오염 실측)이 근거. 실물 45종 전수에서 접두 라벨형·가격 병기형
   2패턴 도출, 오탐 0 실측(양 풀 전수).
2. 계보 프루닝 계약(NOWHOT-EVENT-LINEAGE-PRUNE-CONTRACT-001): 서빙 이력
   계보는 영구 보존(재등장 게이트 재료), 미서빙 계보는 마지막 관측 후 72h
   만료. 3일 데이터 재생 실측: 8,432→7,240~7,270(약 14% 제거), 서빙 결과
   무영향(ON/OFF 동일).
3. 관찰 도구 계측: 소스 결측 경고(runlog warn + missingSources), 재등장 차단
   영수증에 마지막 서빙 슬롯, 계보 수·증분·프루닝 카운트.

**다음 단계 (2026-08-17 David 승인 — 공개 베타)**: "지금핫 beta" 3탭(오늘 v1=
현행판 / 오늘 v2=새 선별판 / 실시간) + 업데이트 고지 + 원탭 선호 투표. v2 판은
이 맥에서 슬롯당(07·12·19) 계산해 판 JSON만 라이브에 배포(엔진 이식 없음 —
임시 검증 구조, 1~2주 투표·행동 데이터로 승자 판정 후 단일판 통합 게이트).
관심분야 선택은 3탭 일괄 적용. 라이브 반영은 staging 게이트 통과 후에만.

### 2026-08-18 D0 계약 동결 정정 (append-only supersede)

정본: `WRC_MANUS_HANDOFF/system/reports/NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md`
(SHA-256 `1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5`).
아래는 이전 서술을 **삭제하지 않고 덮어쓰는(supersede)** 정정이다. D0는 계약
동결 단계이며 런타임 적용이 아니다 — 이 정정으로 서빙 동작은 바뀌지 않는다.

1. **선택하지 않은 카테고리는 일반 지면에 자동 혼합하지 않는다.** 이전
   `전체 필수 / globalMustKnow` 레인의 "선택 밖 사건을 일반 지면에 섞는" 해석은
   폐기한다. 중대 알림은 별도 opt-in category 또는 alert로만 제공한다
   (`personalizationPolicy.automaticUnselectedMixShare = 0` 유지).
2. **노출 자격은 `admissionCategories`의 accept 행만 만든다.** `secondaryCategory`
   (descriptiveSecondaryCategories)는 어떤 지면에도 노출 자격을 만들지 않는다.
   릴리스 불변식: `선택 카테고리와 일치하는 승인 행이 없는 노출 항목 수 == 0`.
3. **소스 국적과 사건 지역성을 분리한다.** 해외 판정은 매체 위치가 아니라
   사건 위치(event jurisdiction) 기준이다. 근거가 부족하면 `unknown`으로
   유보하며 소스 국적으로 추측하지 않는다. (현행 `allMembersOverseas`가 소스
   국적 기반인 것은 알려진 한계로 기준선에 기록됨 — 런타임은 D2 이후 교체.)
4. **소스 독립성(operatorGroup)과 주장 독립성(claimOriginGroup)을 분리한다.**
   서로 다른 두 매체가 같은 보도자료를 받아써도 독립 주장 2개가 아니다. 공유
   사실은 primary/first-party 1곳 ∨ 서로 다른 claimOriginGroup 2곳 이상에서만
   성립한다. 현행 `independentReportingGroups`는 legacy 운영그룹 계수로 의미를
   바꾸지 않고 보존한다.
5. **D0는 계약 동결이다.** 계약(`src/feed/selection-contract.js`)은 순수 함수·
   불변식·실패 상태만 담으며 랭킹·서빙·UI에 연결되지 않는다(`runtimeWired: false`).

### 2026-08-18 D1-A 분류기 실험실 동결 (append-only, D0 완료 상태 보존)

튜닝 전에 표본·정답 절차·평가 산식·비용 경계를 동결했다. D0 계약 완료 상태는 그대로 유지된다.

1. **Seed corpus를 동결한다.** 실제 로컬 스냅샷(2026-08-14·15·16 lunch) 과반(81.25%)
   + 적대/변형 계약 fixture. declared category는 표집 stratum일 뿐 gold가 아니다.
   공급 없는 분야(politics·deal·other)는 합성으로 채우지 않고 shortage로 기록한다.
   빌더는 같은 입력에서 byte-identical corpus를 만든다. (`test/fixtures/selection-d1-corpus.json`)
2. **정답은 독립 절차로만 확정한다.** 실제 기사 78행은 pending — 구현자가 정답을
   채우지 않는다. labelerA/B 독립 판정·일치만 provisional·불일치는 adjudicator.
   production classifier·corpus generator·동일 identity는 라벨러가 될 수 없다.
   현재 `releaseGoldState = insufficient_independent_gold`.
3. **평가 단위는 item × category admission row다.** primaryCategory 적중률이 아니다.
   precision은 Wilson one-sided 95% lower bound(목표 0.98)로 판정하고, 표본 0은
   PASS가 아니라 insufficient_sample. abstain ≤20%, contentType community/deal→news=0,
   adversarial 누수 0, mutation 민감도. recall/qualified-supply baseline은 D1-A에서
   pending/not_measured(legacy 실측 확정은 D1-B).
4. **실제 모델은 아직 돌리지 않았다.** 분류기는 injected adapter로만 받고, 캐시·예산·
   영수증 계약만 순수 함수로 동결했다. `REAL_MODEL_NOT_RUN`·`D2_RUNTIME_NOT_WIRED`·
   `PRODUCT_NOT_PROVEN`·`LIVE_UNCHANGED`. 상세: `docs/reports/NOWHOT_D1_CLASSIFIER_LAB_2026-08-18.md`.

### 2026-08-18 Codex D1-A HOLD correction (append-only, 위 D1-A 동결 강화)

Codex 재검수 HOLD를 반영해 계약을 강화했다(위 항목 유지).

- 평가 입력 정본은 `{itemId, status, classification}`이고 accepted는 D0 `admissionGate`에서만 유도한다.
  bare acceptedCategories·secondary·schema-invalid는 노출 자격이 없다. 모델 abstain은 admission row
  `decision:"abstain"`으로만 표현한다(top-level 우회 제거).
- 독립 gold는 labelerA/B·adjudicator의 decisionDigest로 검증하고, production classifier·corpus generator·
  동일 identity는 라벨러가 될 수 없으며 이 두 identity는 validator 필수 인자다.
- 평가 게이트 lock은 전체 바이트 SHA를 코드 상수로 동결하고 precision 0.98·abstain 0.20·14 category·필수
  필드를 fail-closed로 검증한다. 변조는 `--check-lock` exit 1.
- 분류 요청에 sourceId·sourceTier·declaredSection을 담되 prior로만 쓴다. 예산 5필드는 fail-closed이고 실패
  호출도 예산에 포함하며 초과/타임아웃 결과는 캐시하지 않는다. admission·geo 근거 span은 모두 본문에 grounding한다.

### 2026-08-18 Codex D1-A FINAL CLOSURE v3 (append-only, 측정기 결함 수리)

- gold digest는 저장값을 신뢰하지 않고 항상 재계산해 대조하고(reason=null), blindPacketHash를 item 정본과
  대조한다. adjudication은 A/B가 모두 있고 독립 adjudicator가 있을 때만 유효하다.
- release gold는 items에서 도출한 frozen real 전 건과 정확히 일치하고 그 전부가 독립 검증될 때만 sufficient다.
  부분 라벨 1건으로는 절대 sufficient가 아니다.
- 적대 표본 10건은 release precision과 분리해 전수 하드 게이트로 평가하며, 오승인·all-abstain은 실패다.
- 평가 데이터셋은 단일 게이트에서 중복·orphan·origin 불일치·1:1 위반을 즉시 거부하고, gates lock은 전체
  바이트 SHA와 모든 의미 필드를 검증한다(빈·변조 lock에 기본값을 넣지 않는다).
- 비용 preflight는 다음 호출 입력까지 반영하고, 타임아웃은 호출 후 시각을 다시 읽어 판정하며, 어느 경우에도
  초과·타임아웃 결과를 캐시하지 않는다.

### 2026-08-18 Codex D1-A ONE-SHOT TRUST CLOSURE v4 (append-only, 단일 신뢰경계)

- 평가기는 gold가 적어둔 hash·origin을 신뢰하지 않는다. frozen corpus에서 item별 canonical authority
  (재계산 evidenceHash·blindPacketHash·contractGold projection)를 파생해 그것만 정본으로 쓰고, gold의 모든
  hash·origin·category·identity·digest를 canonical 기준으로 fail-closed 검증한다. CLI는 frozen corpus raw SHA도 확인한다.
- 적대/변형의 정답은 gold가 아니라 frozen corpus contractGold다. gold와 예측을 함께 오답으로 바꿔도 통과할 수
  없고, contractGold는 분류 요청에 노출되지 않는다.
- 평가 모드를 fixture_only와 candidate로 명시 분리한다. fixture_only는 예측 0건이며 성능 게이트가 통과할 수 없고,
  candidate는 item과 예측이 1:1이어야 한다.
- gates lock은 바이트 SHA와 모든 의미 필드(Wilson 참조 재계산 포함)를 정확히 검증하고, 예산·통계는 초과·타임아웃을
  withheld로 회계하며 캐시하지 않는 불변식을 유지한다.

### 2026-08-18 Codex D1-A v4.1 FINAL MINIMAL CLOSURE (append-only, 실증 4건)

- gates lock 검증은 note를 제외한 semantic 트리를 frozen expected와 값·순서·키 집합까지 exact 비교한다(빈 문자열 확인이
  아니라 모든 leaf·extra·누락을 거부).
- 평가 모드가 candidate가 아니면 모든 성능 gate는 NOT_EVALUATED이며 어떤 PASS도 만들 수 없다.
- 무응답(all-abstain·withheld·error·schema_reject·무효 분류)을 effective non-answer로 집계해 abstain gate에 쓴다. 전건 비응답이면 실패.
- canonical authority는 frozen corpus에서 별도로 만들어 필수 인자로 넣는다. items에는 contractGold를 두지 않으며, item의
  itemId·origin·재계산 hash를 canonical과 대조하므로 items+gold+prediction 공동 오답도 통과할 수 없다.

### 2026-08-19 D1-B 독립 골드 후보 완결 (append-only)

- 실제 로컬 기사 78행은 독립 A/B 전수 판정 후 57건 합의, 21건 불일치로 분리했고, 불일치 전부를 A/B와 다른
  Claude Opus 4.8 adjudicator가 판정했다. 미판정·disputed 행은 0이다.
- 골드 완성 여부와 모델 성능 평가 대상을 분리한다. 계약을 통과한 `agreed`/`adjudicated` 실제 행은
  `resolvedIndependentItemIds`로 골드 완성에 포함한다. 그중 `humanValid=true && inScope=true`인 71행만
  `releaseEligibleItemIds`로 모델 성능 분모에 포함한다. 정당한 `other`·범위 밖 음성표본 7행을 억지 카테고리에
  넣지 않는다.
- 로컬 후보는 `releaseGoldState=sufficient_independent_gold`이며
  `.nowhot-local/selection-d1b/final-gold.candidate.json`에 격리했다(SHA-256 `9a82b0920e56606a8553b39616c6736ee7011699266b2f2d67958fc40f07fdeb`).
  기존 정본 골드로 승격하지 않았고 실제 모델/API 호출, D2 런타임 연결, 제품/라이브 변경도 하지 않았다.

### D1-C 측정 (2026-08-19, 실모델 canary → D1C_CANARY_HOLD)

- **정본 gold 승격**: D1-B 후보(`9a82b0920e56…`)를 `test/fixtures/selection-d1-gold.json`로 원자적·멱등 승격했다(기존 `4eed688d…`는 `.nowhot-local/selection-d1c/selection-d1-gold.before.json`에 보존). 승격 전 `buildCanonicalAuthority`·`validateGoldContract`·`releaseGoldState`로 96/78/71/57/21/18 및 `sufficient_independent_gold`를 재검증. `CANONICAL_GOLD_PROMOTED`.
- **legacy baseline은 라이브가 아니라 동결 snapshot에서 측정**: frozen snapshot 3종(pool-2026-08-14/15/16-lunch, SHA를 corpus·상수 이중 대조)에서 real 78행을 snapshotId+sourceId+재계산 evidenceHash로 정확히 1:1 대응하고 `snapshot item.category == corpus declaredCategory`를 확인했다. eligible 71행에서 분야별 recall·gold-qualified supply(TP)를 측정해 `test/fixtures/selection-d1-legacy-baseline.lock.json`에 raw SHA 상수로 잠갔다(totalQS 44, lockSha `04da5c7b…`, applicable 12, news/humor 양성 0=not_applicable_sample). `--check` drift는 exit 1. `LEGACY_BASELINE_MEASURED`.
- **실모델**(candidate `claude-haiku-4-5-20251001`, promptVersion `nowhot-selection-d1c-p1`, taxonomyVersion은 CATEGORIES SHA 파생): 가격 인식 순차 경로(input $1/output $5 per MTok 코드 잠금, 호출당 max_tokens 1800·timeout 60초, 실제 usage 토큰 기준 비용)로 canary 12건(adversarial 10 + mutation d1m-01a/01b)을 실제 호출했다(실비 $0.0577, 입력 20022 / 출력 7527 tok, canary 상한 $0.20 내). canary adversarial gate가 **5/10**(scopeMismatch 4·expectedAdmissionMiss 3·selectedCategoryLeak 1)으로 통과하지 못해 **`D1C_CANARY_HOLD`** — 계약대로 프롬프트 튜닝·재호출 없이 종료했고 나머지 84건은 실행하지 않았다. releasePass는 미도달. `REAL_MODEL_RUN`(canary only).
- **표본 한계(위장 금지)**: eligible 71·분야 최대 양성 9·news/humor 양성 0이라 Wilson 0.98 정밀도 하한은 이 표본으로 도달 불가능하다. 이를 모델 실패로 위장하거나 threshold를 낮추지 않고, D1-C 측정 완료와 RELEASE_READY를 분리한다. 추가 표본은 관측 오류 기반으로 계산한다.
- **불변**: `selection-d1-gates.lock.json`·corpus·D0 계약/baseline·corpus builder·D1-B 후보/응답 원본은 한 바이트도 바꾸지 않았다. `D2_RUNTIME_NOT_WIRED`·`PRODUCT_NOT_PROVEN`·`LIVE_UNCHANGED`. commit/push/deploy/server 0.

### D1-C 무결성 수리 (2026-08-19, 실모델/API/Keychain 0)

Codex가 실증한 4개 결함을 외부 호출 0으로 닫았다.
- **재실행 덮어쓰기**: `--run-model`은 소비된 canary 산출물이 있으면 Keychain 조회 전에 `D1C_CONSUMED_DIAGNOSTIC_HOLD`로 종료한다(새 호출·기존 파일 재작성 0). `runPricedClassification`은 `priorUsage`(lifetime)를 받아 cache-hit여도 usage가 0으로 돌아가지 않는다.
- **예산 통합 상한**: canary/full/재시도 전체 lifetime 누적으로 preflight한다. 반례 `$0.1836 + $1.092 = $1.2756`처럼 두 단계가 개별 통과해도 다음 호출 전 통합 $1.25 상한에서 차단된다(cost·calls·token 경계 각각).
- **baseline checker strict**: corpus/gold/baseline raw-byte SHA 상수 + payload 전체 exact + lockSha 내부/기대 일관성으로 값·extra/missing key·whitespace/raw-byte·lockSha 변조를 모두 exit 1로 잡는다(canonical 무오염, 임시 복사 반례로 증명).
- **지역성 정정 corpus v2(002)**: `sourceCountry`(매체 위치)를 사건 위치로 취급한 adversarial scope 결함을 supersede로 고쳤다. real 78·mutation 8·모든 title/excerpt/itemId/evidenceHash·content/category gold는 불변이고 adversarial 10행의 geo(event/relevance/geoSpan/scope)만 정정했다. scope는 `resolveScopeClass()`와 exact 일치, 모든 geo span은 title/excerpt substring, KR 매체라도 사건 근거가 없으면 scope=unknown이다(sourceCountry 비추론). corpus SHA `e9afa42b`→`b8f2d458`, gold/gates 불변.
- 소비된 canary 예측을 corpus v2로 offline 재평가: contentType 10/10, category admission 7/10, geo scope 7/10, whole-row exact 5/10. 이는 release PASS가 아니라 소비된 진단의 정정이며 나머지 84건은 계속 sealed다.
- 검증: RED→GREEN 8, lab 32/32, 전체 `npm test` 1,413/1,413, corpus `--check` byte-identical, gates/D0/baseline lock drift 0, `--integrity-check` OK, `git diff --check` PASS. 외부/API/Keychain/commit/deploy 0.

### D1-C 무결성 TRUE FINAL (2026-08-19, 실모델/API/Keychain 0)

직전 수리가 "코드로 닫았다"고 본 4개를 Codex가 데이터-only(테스트만 통과)로 판정 → 코드에서 재수리했다.
- **canonical scope 정본**: `contractProjectionOf`/`buildCanonicalAuthority`가 저장 `scopeClass`를 신뢰하지 않고 `resolveCanonicalContractScope()`로 재계산·검증한다. adversarial fixture는 event/relevance/geoSpan 3필드 필수 + grounded, 저장≠계산 scope는 `CORRUPT_EVAL_DATA`, mutation legacy는 canonical scope=null. adversarial 평가도 `cg.scopeClass`가 아니라 검증된 `contractProjection.scope`를 쓴다.
- **영속 lifetime ledger**: `.nowhot-local/selection-d1c-integrity/usage-ledger.jsonl`(append-only+fsync, reserve/settle). 미정산 reserve는 estimated input+max output을 lifetime에 포함하고 `UNSETTLED_USAGE_HOLD`; cost는 저장값 미신뢰 token+pricing 재계산; runner는 임의 priorUsage가 아니라 ledger summary만 사용한다. 프로세스 재생성 후에도 usage가 복원된다.
- **consumed guard 3-state**: `inspectConsumedDiagnostic()`이 sealed/absent/drift를 구분한다. `stepRunModel`은 drift=`PRECONDITION_HOLD`, sealed=`D1C_CONSUMED_DIAGNOSTIC_HOLD`를 Keychain 조회 전에 판정한다(injected getApiKey 호출 0 실증). 파일 존재만으로 정상 HOLD를 위장하지 않는다.
- **ID lineage exact**: `D1_CORPUS_ID`="…002"/`D1_CORPUS_SUPERSEDES_ID`="…001", baseline contract "…002"/supersedes "…001"(interim `4dd864`→final `b31f6dbf`). corpus builder는 literal 없이 두 상수를 쓰고 출력은 `b8f2d458` byte-identical.
- 검증: RED→GREEN 12, lab 38/38, 전체 `npm test` 1,419/1,419, corpus/eval-lock/check-baseline/integrity-check OK, `git diff --check` PASS. gold·gates·D0·evaluator·corpus v2·D1-B·기존 selection-d1c 산출물 불변. ledger recovery 12/20022/7527/$0.057657, 잔여 $1.192343.
- 남은 제한: `stepRunModel`의 absent(신규 실행) 경로는 sealed consumed guard가 항상 먼저 종료하므로 이번 및 consumed 존재 하에 도달 불가하나, 완전한 attempt-dir 격리(산출물 wx)는 다음 실제 실행 전 별도 수리 대상이다.

### D1-C 무결성 ONE-SHOT FINAL (2026-08-19, 실모델/API/Keychain 0)

120의 TRUE FINAL 주장을 121이 supersede — 120이 남긴 4개 뿌리 결함을 미루지 않고 코드에서 완결했다.
- **attemptDir 완전 격리**: `stepRunModel`의 검사·캐시·preflight·prediction·evaluation·receipt 쓰기가 전달된 단일 `dir`(wx no-overwrite)만 사용하고 `D1C_DIR` 쓰기는 0이다. 구형 `isConsumedDiagnostic`은 3-state inspector에 위임(competing truth path 제거)하고 `CONSUMED_ARTIFACTS`를 삭제했다. 전역 실행 lock을 `wx`로 획득하며 두 번째/crash 잔여 lock은 `RUN_IN_PROGRESS_HOLD`(자동 삭제 안 함, controlled exit에서만 정리)다. `attemptId`는 non-empty 유일, `callId`는 `<attemptId>:<phase>:<index>`다.
- **ledger strict**: `ledgerSummary`가 seq 연속 정수·type 3종·non-neg int·recovery 최대 1개(seq 0)·callId trim·고아/중복/역순 settle을 `LEDGER_CORRUPT_HOLD`로 거부한다. append는 전수검증 + seq 강제(주입 불가) + fsync + 재검증. provider throw·usage 누락/음수/소수는 reserve를 미정산으로 유지하고 정확히 1회 호출 후 즉시 중단(`UNSETTLED_USAGE_HOLD`, 다음 호출 0)한다. lifetime 통계는 ledger summary에서만 파생한다.
- **Keychain 이전 완전 preflight 순서**: consumed→lock→strict ledger·unsettled 0→corpus/gold/gates/D0/baseline raw SHA→baseline strict→snapshot 1:1→canonical(geo)→counts→`getApiKey`. 어느 로컬 조건이든 실패하면 key/API/write 0이다.
- **canonical geo 완결**: geo 3배열의 모든 원소가 trim 기준 non-empty(공백 원소 reject), span은 title/excerpt exact substring(공백 span reject), scope는 `resolveScopeClass` 재계산값만, `contractProjectionOf`는 검증된 scope 인자 필수(생략 fail-closed, mutation은 명시적 null만)다.
- 검증: RED→GREEN, lab 43/43, 전체 `npm test` 1,424/1,424, corpus/eval-lock/D0/check-baseline/integrity-check OK, `git diff --check` PASS. builder·corpus·gold·gates·D0·baseline·evaluator·ledger·D1-B·기존 selection-d1c 산출물 불변. ledger recovery 12/20022/7527/$0.057657, 잔여 $1.192343. **미룬 제한 0.**

### D1-C CODEX FINAL HOLD 수리 (2026-08-19, 실API/Keychain 0)

121이 "닫았다"고 기록한 3개가 Codex 재검수에서 미완성으로 드러나 코드·반례로 완결했다(121의 append 전수검증·seq 강제·재검증, 예산 뒤 Keychain, lifetime=ledger summary·0 side-effect 표기 주장을 122가 supersede).
- **A createFileLedger 완결**: `readAll`의 JSON 파싱 오류도 `LEDGER_CORRUPT_HOLD`로 정규화한다. `append`는 기존 records를 `ledgerSummary`로 먼저 검증하고, 호출자 seq를 무시한 채 저장 순번을 마지막에 강제하며, 추가 예정 record 포함 strict 재검증 후 fsync하고, 쓰기 뒤 재읽기→strict 재검증→마지막 record가 예정값과 정확히 같은지 확인한다. 손상 원장이면 append 전에 중단하고 원본 바이트가 변하지 않는다.
- **B Keychain 이전 실제 예산 게이트**: 예산 판정을 단일 순수 함수 `budgetAllowsCall`로 추출해 runner와 실행 루프가 공유한다(중복 공식 제거). valid cache를 먼저 계산하고 provider 호출 가능한 canary 항목이 하나도 없으면(lifetime calls 12 / maxCalls 12) `BUDGET_PRECONDITION_HOLD`로 key/provider/write 0이다. 전건 valid cache는 Keychain 없이 offline 진행하고 `MODEL_KEY_MISSING`은 예산 남은 경로로 분리된다.
- **C 실패 회계·영수증**: ledger가 있으면 `runPricedClassification` 종료 시 lifetime이 마지막 strict `ledger.summary`와 정확히 일치한다(미정산 reserve의 estimated 토큰·비용을 0으로 축소하지 않음). `stepRunModel` 중단 receipt에 strict ledger lifetime·`unsettledReserves`·실제 key/provider/write 횟수를 기록하고, provider 호출 후에는 "0 API/write" 사전-HOLD 출력 함수를 쓰지 않는다.
- 검증: RED→GREEN(D1CI4 §A/§B/§C), lab 46/46, 전체 `npm test` 1,427/1,427, `--integrity-check`·`--check-baseline` OK, `git diff --check` PASS. corpus·gold·gates·D0·baseline·기존 ledger·기존 D1-C 산출물 read-only 불변, 허용목록 밖 변화 0.

### D1-D 후보 프롬프트 p2 canary (2026-08-19, 실API canary 12회만)

D1-C에서 candidate haiku-4-5가 adversarial 5/10으로 HOLD였다. D1-D는 분류기·평가·ledger·게이트·정본 gold·corpus·gates·D0·baseline을 전부 read-only로 재사용하고 **프롬프트만 1벌(p2)** 바꿔 같은 표본에 canary를 다시 쳤다(새 프레임워크·중복 분류기 0).
- **thin runner + p2**: `tools/run-selection-d1d.mjs`의 `D1D_SYSTEM`은 D1-C 실패 3패턴을 겨냥한다(사건위치≠매체국적·근거 없으면 unknown / 교차도메인은 분리불가일 때만 2범주 / 간접·구조유사=reject). 별도 attempt·dir·usage-ledger·lock 분리, seq0 recovery에 D1-C 누적(12/20022/7527/$0.057657)+원본 SHA(`176c9e78…`/`6c6bdcdd…`).
- **Keychain 이전 예산 게이트**: 증분 $0.20 AND 누적 $1.25를 `budgetAllowsCall`로 판정, 호출 가능 항목 0이면 `BUDGET_PRECONDITION_HOLD`로 key/provider/write 0.
- **측정(실호출 1회·retry 0)**: canary 12건 중 2건 schema reject → classified 10/12 → `D1D_CANARY_HOLD`. 증분 $0.056675·누적 $0.114332(상한 내), ledger receipt 정확 일치(unsettled 0).
- **계약 준수**: canary FAIL이므로 튜닝·다른 모델·재호출 없이 즉시 HOLD, STAGE 2~4(full 96·D2 shadow·로컬 미리보기 UI) 미수행. secret·raw body·API 응답 로그/문서 0.
- **독립 검토**: fresh-context Opus 리뷰어 8불변식+also-check 전부 CONFIRMED-OK·`NO FIXABLE DEFECT`; dead import 2개만 제거(게이트·회계 무관).
- **검증**: 신규 테스트 4/4, 전체 `npm test` 1,431/1,431, frozen fixture byte-identical, D1-C 산출물·selection-contract.js·D1-B 원본 불변, D1D_DIR 밖 쓰기 0.
- **위장 금지 해석**: p2로도 haiku-4-5가 엄격 스키마(14행+geo grounding)를 12건 전부 만족 못 함 → schema 적합이 adversarial 정밀도보다 앞선 병목. 다음 후보(모델 교체/스키마 완화)는 David 승인 후.

truth: D1D_CANARY_HOLD·CANDIDATE_PROMPT_P2_INSUFFICIENT·FULL_96_NOT_RUN·D2_RUNTIME_NOT_WIRED·PRODUCT_NOT_PROVEN·LIVE_UNCHANGED·READY_FOR_CODEX_REVIEW.

**오프라인 진단 보론(2026-08-20, 실API 0)**: sealed p1·p2 canary 예측을 같은 정본(corpus v2)으로 재평가 — wholeRow p1 5/10→p2 6/10, p2가 admission 계열(교차도메인·구조유사·leak)은 해결했으나 회귀 2건 포함 **남은 실패 4건 전부 geo/근거 grounding 규율**(스키마는 근거 없는 단정을 정확히 잡음 — 완화=위장, 비권장). 산출물 `.nowhot-local/selection-d1d/canary-adversarial-diagnosis.json`, 상세·옵션 비용은 리포트 §22-보론. 다음 후보(③ p3 grounding 강제 ≈누적 $0.57 / ① sonnet 교체 ≈누적 $1.47 상한 초과 / ② 완화 비권장)는 David 결정 대기.

### D1-E 후보 프롬프트 p3 canary (2026-08-20, 실API canary 12회만) — David 승인 실행

David가 p3(grounding 강제)를 승인해 실행. thin runner `tools/run-selection-d1e.mjs`(별도 attempt·dir·ledger, recovery=누적 $0.114332, 게이트는 run-d1d 재사용). p3 = ASSERT-AND-QUOTE OR NEITHER(위치 주장 시 원문 그대로 인용 강제·없으면 unknown) + quotable 단서 예시 + deal은 제품 도메인 판정.
- **결과**: schema reject 0으로 해소(12/12 유효)했으나 adversarial wholeRow **6/10** → `D1E_CANARY_HOLD`. 증분 $0.058866, 누적 $0.173198(상한 내). mutation 통과.
- **3벌 비교**: p1 5/10 → p2 6/10 → p3 6/10 정체+출렁임(d1a-10 회귀, d1a-04/08 scope는 3벌 전부 실패). 프롬프트 단독 반복으로 10/10 도달 가능성 낮음 — haiku-4-5 경계 사례 일관성 한계 신호. 진단: `.nowhot-local/selection-d1e/canary-adversarial-diagnosis.json`.
- **검증**: 테스트 3/3 신규, 전체 1,434/1,434, frozen·기존 산출물 불변, D1E_DIR 밖 쓰기 0.
- **다음(대기)**: 유력안 sonnet-4-6 canary ≈$0.17(상한 내, full 96은 상한 상향 필요) — David 결정.

truth: D1E_CANARY_HOLD·PROMPT_ITERATION_PLATEAUED(5-6-6)·MODEL_CAPABILITY_LIMIT_SUSPECTED·FULL_96_NOT_RUN·D2_RUNTIME_NOT_WIRED·PRODUCT_NOT_PROVEN·LIVE_UNCHANGED·NEXT_CANDIDATE_AWAITS_DAVID.

### D1-F 단일변수 실험 — Sonnet canary (2026-08-20, 실API canary 12회만) — David 최종 지시

p3 프롬프트 SHA `769b2d40` 그대로·동일 항목/순서/gold/schema/채점기, **모델만** 저장소 정의 `claude-sonnet-5`(costs.js $3/$15 정가)로 교체(`tools/run-selection-d1f.mjs`). preflight에서 p3 SHA·D1-E 원본 SHA 대조(불일치=호출 전 HOLD), ledger는 sonnet분만 기록(단가 혼합 왜곡 방지, 과거 실비 $0.173198은 상수+SHA 지참), resolved model은 fetchImpl 주입으로 캡처(llm.js 무수정), 1회 한정.
- **결과**: 실호출 12·retry 0·resolved `claude-sonnet-5` 12/12, schema reject 0, mutation 통과, adversarial **7/10** → `D1F_CANARY_HOLD`. 이번 $0.2418(상한 $0.30 내), **실누적 $0.414998/$1.25**. 계약대로 즉시 종료(full·재시도·타모델 0).
- **4벌 비교**: haiku 5→6→6 vs sonnet(p3) **7**. sonnet이 d1a-08(최초 통과)·09·10 해결, d1a-05·07 회귀(과잉 보수·cross-domain 과발동). **d1a-04는 4벌·2모델 전부 실패**(제목의 "쿠팡"·"89000원"에도 domestic 거부) — fixture 근거 강도 경계선 관찰, 정본 수정 금지라 기록만(Codex·David 판단 사항).
- **검증**: 테스트 3/3 신규, 전체 1,437/1,437, frozen·기존 산출물·llm.js·costs.js 불변, D1F_DIR 밖 쓰기 0. 진단: `.nowhot-local/selection-d1f/canary-adversarial-diagnosis.json`.

truth: D1F_CANARY_HOLD·SONNET_BEST_7_OF_10·GATE_10_OF_10_UNMET_BY_BOTH_MODELS·D1A04_FIXTURE_BOUNDARY_OBSERVATION·FULL_96_NOT_RUN·D2_RUNTIME_NOT_WIRED·PRODUCT_NOT_PROVEN·LIVE_UNCHANGED·NEXT_AWAITS_DAVID_AND_CODEX.

### D1-G EVALUATION TRUTH REPAIR (2026-08-20, 실API 0) — David 지시

측정 반복 전에 평가 정본의 진실성을 수리했다(corpus·gold·gates·D1-C~F 산출물·D0 계약 read-only 유지).
- **독립 blind 재판정**: adversarial 10건을 구현 세션과 분리된 A/B가 중립 ID·비노출·파일접근금지로 판정 → **완전 합의 10/10, adjudication 불요**. superseding authority `test/fixtures/selection-d1g-adversarial-authority-001.json` 신설(원본 무수정·평가 전용, scopeClass는 동결 공식 기계 파생, 합의 ambiguous d1a-07/08은 분모 제외). 구 canonical과 5건 차이(모델별 유불리 혼재 = 모델 맞춤 아님). d1a-04(쿠팡)는 독립 검수도 domestic·tech 확인 — fixture가 옳았음.
- **validator 최소 수리**: lab `validateClassifierOutput` — admission 14행 전수(누락 fail-closed)·accept∩secondary 겹침 fail-closed. RED 실증→반례 6 GREEN. 부수: mkCls 14행 전수화, eval-scenarios 예측 9건 14행 확장(all-abstain 의미 보존).
- **offline 재채점(decisive 8)**: p1 2/8 · p2 3/8 · **p3(haiku) 5/8 최고** · sonnet 3/8 — 구 정본 순위(sonnet 7/10 최고)가 역전. 억지 PASS 없음. `.nowhot-local/selection-d1g/rescore-report.json`.
- **정정(append-only)**: D1-F 토큰 문서 서술 "in 23,586/out ~11,400"은 오기 — 실측 **input 30,380/output 10,044**($0.2418 정확 일치, 산출물은 처음부터 정확).
- **검증**: 전체 1,443/1,443, git diff --check PASS, 동결 전부 불변.

truth: EVAL_AUTHORITY_REPAIRED·INDEPENDENT_AB_FULL_AGREEMENT·AMBIGUOUS_2_EXCLUDED·RANKING_REVERSED_UNDER_TRUE_AUTHORITY·NO_FORCED_PASS·NEXT_MODEL_CALL_AWAITS_CODEX.

### D1-G FINAL CLOSURE (2026-08-20, 실API·모델 호출 0) — David 지시

직전 `EVAL_AUTHORITY_REPAIRED`를 `CANDIDATE_AUTHORITY_NOT_WIRED`로 supersede(001은 배선 안 된 후보였음·보존) 후 정본을 확정 배선했다.
- **지역성 규칙 고정**: unknown=유효·결정적(geo unknown만으로 ambiguous 금지)·뉴스/커뮤니티 통화 금액만으로 위치 확정 금지·딜은 리테일러/통화/배송이 관할 근거 가능 → A03/A05/A08 unknown·A04 domestic·A09 global. 경계선 A07·A10은 감사용 ambiguous 보존 + **대체 반례 2건**(모델 결과 무참조 설계·blind A/B 완전 합의 검증)으로 **분모 정확히 10 유지**.
- **authority-002 신설**(append-only): decisive 10·evidenceHash·provenance·raw receipt 4종 SHA·검수자=동일 모델 별도 실행 정직 표기·채점값 단독 소유.
- **정본 validator v3**(selection-contract.js 한곳): admission 14행 전수·누락/잉여/중복 fail-closed·accept∩secondary 금지, lab은 정본 재사용(중복 제거), 스키마 minItems/maxItems 14, gate 반례 추가. baseline lock 재생성(contract 지문·버전 2필드만 변경)·d0 핀 갱신.
- **실배선**: adversarial 행은 authority 필수(없거나 SHA/ID/evidenceHash 불일치=CORRUPT_EVAL_DATA), corpus contractGold 채점 사용 금지(무결성 대조 전용), 분모=decisive 10(미예측=invalidOrMissing 정직 집계), 호출부 6곳 전환, expectedContractFixtures=10 유지.
- **재현 rescore 도구**: 결정적 재생성, 대체 반례 예측 부재 → `INCOMPLETE_NEW_FIXTURE_PREDICTIONS` HOLD·8건 부분 점수/순위 주장 금지.
- **검증**: focused 95/95·전체 1,445/1,445·git diff --check PASS·3종 무결성 CLI OK·frozen 전부 불변.

truth: **D1G_EVAL_CONTRACT_WIRED**·AUTHORITY_002_IS_SCORING_OWNER·DENOMINATOR_10_FIXED·REPLACEMENT_PREDICTIONS_ABSENT(HOLD_BY_DESIGN)·NO_MODEL_RANKING_CLAIMED·NEXT_MODEL_CALL_AWAITS_CODEX.

### D1-G P1 일괄 봉합 (2026-08-20, 실API·모델 호출 0) — Codex HOLD 4건

직전 `D1G_EVAL_CONTRACT_WIRED`는 배선까지만 참 — 실행 경로 P1 4건을 한 묶음 봉합.
- **P1-1**: canary를 authority decisive 10(대체 d1g-11/12 포함·감사용 d1a-07/10 제외)+mutation 2로 단일화 — `canaryItemIds`/`d1gCanaryItems`/`d1gReplacementGoldRows`(frozen gold 무수정 합성), 러너 4곳+`evaluateCanaryD1d` 전환.
- **P1-2**: rescore가 공용 게이트(`evaluateCanaryD1d`) 재사용으로 실제 wholeRow·실패항목·게이트 판정 산출(placeholder 제거). 주입 반례로 완전=PASS·오답=특정+FAIL 실증. sealed 기본 실행은 여전히 `INCOMPLETE_NEW_FIXTURE_PREDICTIONS` HOLD — 8건 부분 점수·순위 금지 유지.
- **P1-3**: authority 로더 전면 fail-closed(Codex 주입 2종 RED 재현 → 배열·taxonomy·중복·교집합·겹침·replacement 필드 검증, 공격 9종 거부).
- **P1-4**: selection-d1g.test.js의 `.nowhot-local` 의존 제거 — 커밋 fixture 자급 빌더, 깨끗한 환경 통과.
- **검증**: focused 99/99·전체 1,449/1,449·git diff --check PASS·frozen/sealed 불변·모델 호출 0.

truth: D1G_P1_EXECUTION_PATH_SEALED·CANARY_INPUT_UNIFIED·RESCORE_SCORING_COMPLETE·AUTHORITY_SCHEMA_FAIL_CLOSED·CLEAN_ENV_TESTS·**READY_FOR_CODEX_RECHECK**·NO_MODEL_CALL.

### D1-G 재검수 HOLD 일괄 봉합 (2026-08-20, 실API·모델 호출 0) — 3 P1 + 1 P2

직전까지는 게이트·로더·테스트 격리였고 **실행 경로 3곳 단절**을 Codex가 재현 실증 — 한 묶음 봉합.
- **P1-a**: 공용 평가기 `evaluateCanaryShared`를 run-d1c로 이동(대체 gold 합성 내장)·**D1-C 중복 평가기 삭제**·run-d1d는 별칭 재export — 전 러너·rescore·테스트가 단일 함수(`item without gold` 단절 해소).
- **P1-b**: 단일 집합 함수 `d1gEvaluationSet` = corpus 96 - 감사 2 + 대체 2 = **정확히 96**(canary 12·rest 84, 불변식 CORRUPT fail-closed). stepRunModel은 이 집합+goldForEval만 사용(98건 조립·감사 부활 제거).
- **P1-c**: rescore `--attempt <이름>=<경로>` CLI 연결 + per-run 완결성(완결 실행만 점수화·미완결 INCOMPLETE 표기·부분 8건 금지 유지). 실경로 실증: 합성 attempt=COMPLETE·10/10·gate PASS, 무 attempt=HOLD 결정적 복원.
- **E2E**: `callModelFactory` 주입으로 가짜 모델+임시 디렉터리 stepRunModel 전 경로 실증 — canary에 d1g-11/12 포함·감사 호출 0·full 96·산출물 5종·measured.
- **P2 정정**: `CLEAN_ENV_TESTS` → **`SELECTION_D1G_TEST_SELF_CONTAINED`**(lab D1CI 테스트의 `.nowhot-local` 의존은 범위 밖 기존 이슈, 깨끗한 checkout 실증 전 과잉 주장 금지).
- **검증**: d1g 13/13(E2E 포함)·전체 1,452/1,452·git diff --check PASS·frozen/sealed 불변·모델 호출 0.

truth: D1G_RUNNER_ASSEMBLY_SEALED·SINGLE_EVAL_SET_96·SINGLE_SHARED_EVALUATOR·RESCORE_ATTEMPT_PATH_WIRED·SELECTION_D1G_TEST_SELF_CONTAINED·REPLACEMENT_PREDICTIONS_STILL_ABSENT(HOLD_BY_DESIGN)·**READY_FOR_CODEX_RECHECK**·NO_MODEL_CALL.

### D1-G 유료 canary 실행 준비 봉합 (2026-08-20, 실API·모델 호출 0) — 3차 재검수 6항

병목=실행 경로. 한 묶음 봉합:
- **canary-only**: CLI `--run-canary <attempt-id>` + `mode="canary_only"` — 12건 뒤 무조건 종료(PASS→`D1C_CANARY_MEASURED`, 재실행 fail-closed). 함수 경로도 `fullApproved=false` 기본 → `FULL_NOT_APPROVED_HOLD`. **12건 승인→96건 과금 경로 이중 차단**.
- **attempt manifest**: 전 종단에서 기록(resolvedModels 캡처·프롬프트 SHA·정본 4지문·산출물 3지문·strict ledger·retries 0·비용). rescore `--attempt`는 **디렉터리+manifest만** — `loadAttemptDir` fail-closed 전 지문 대조(`RESCORE_ATTEMPT_CORRUPT`), 임의 합성 JSON 거부.
- **깨끗한 복사본 실증**: baseline 주입 심(커밋 lock 파생 스텁·실경로 불변)+rescore 부재 파일 graceful → `.nowhot-local` 제외 복사본에서 **D1-G 17/17 실측**.
- **subprocess·정밀 회귀**: 진짜 attempt로 CLI subprocess COMPLETE·10/10, 1바이트 변조 거부, 기본 exit 3; full E2E 정확 95콜·96 ID 고유·캐시 적중 정확히 d1m-04b(메커니즘 명기).
- **검증**: d1g 17/17·focused 106/106·전체 1,456/1,456·git diff PASS·frozen/sealed 불변·모델 호출 0.

truth: CANARY_ONLY_CLI_WIRED·FULL_84_DOUBLE_GATED·ATTEMPT_MANIFEST_FAIL_CLOSED·**CLEAN_COPY_D1G_PROVEN(17/17)**·EXACT_CACHE_REGRESSION_PINNED·REPLACEMENT_PREDICTIONS_STILL_ABSENT(HOLD_BY_DESIGN)·**READY_FOR_CODEX_RECHECK**·NO_MODEL_CALL.

### D1-G 후보 고정·출처 보존 봉합 (2026-08-20, 실API·모델 호출 0) — 4차 재검수

- **후보 레지스트리**: 유일 등록 후보 **`p3.1-haiku`**(p3 지역성 블록만 authority-002 정본 정렬 — unknown 결정적·뉴스/커뮤니티 통화 단독 금지·딜 한정 허용·일반어 금지; p3는 충돌로 미등록). requestedModel·별칭·promptVersion·**전체 promptSha256**·pricing 고정. `--run-canary <attempt-id> <candidate-id>` 후보 필수, stepRunModel은 후보 정의에서만 모델/프롬프트/단가 취득(몰래 p1 고정 제거).
- **실제 모델 대조**: resolvedModels **정확 1개 & 요청/alias 일치**(Codex 반례 `fake-e2e-model` 거부 실증).
- **출처 보존**: 로더가 레지스트리·receipt model·**ledger callId attempt 소속** 대조, rescore runs에 provenance(attemptId·후보·실제 모델·프롬프트 SHA) 보존 — 별칭은 표시용(위조 반례 실증).
- **종단·경로**: manifest=정산 완료 채점용 전용, 실패 종단=terminal-receipt(key-missing에 manifest 미생성 실증); 전용 경로 `selection-attempts/<id>`+기존 디렉터리 사전 중단(쓰기 0 실증). **정직 정정: manifest는 내부 일관성 증거이지 암호학적 위조 방지 증명이 아님**(integrityNote 명기).
- **검증**: d1g 21/21·clean-copy 21/21·focused 110/110·전체 **1,460/1,460**·git diff PASS·frozen/sealed 불변·모델 호출 0.

truth: CANDIDATE_REGISTRY_PINNED(p3.1-haiku)·RESOLVED_MODEL_EXACT_MATCH·PROVENANCE_PRESERVED(ALIAS_DISPLAY_ONLY)·TERMINAL_RECEIPT_SPLIT·ATTEMPT_DIR_PREWRITE_GUARD·MANIFEST_IS_CONSISTENCY_EVIDENCE_NOT_CRYPTO_PROOF·**READY_FOR_CODEX_RECHECK**·NO_MODEL_CALL.

### David 승인 canary 실측 — 파이프라인 완주 + p3.2-haiku 5/10 HOLD (2026-08-20)

David 직접 실행 시도(승인)→산출물·과금 0 확인→세션 승계 실행. 실측 결함 2건 수리 후 파이프라인 최초 완주.
- **(a) 와이어 스키마**: API가 min/maxItems 거부(400, attempt-01 UNSETTLED — 1회 후 중단·retry 0 작동·실청구 0) → 와이어에서 제거, 14행 강제는 validator v3가 계속 수행(프로브 2회로 확정, $0.0045).
- **(b) 프롬프트-계약 격차**: p3.1 attempt-02 9/12 accepted∩secondary reject($0.061) → **p3.2 등록**(금지 1줄 추가, p3.1 계보 보존).
- **완주(attempt-03, $0.063)**: 12건 무조건 종료→manifest→rescore 검증 COMPLETE·provenance 보존·per-item 실패 — 재검수 요구 전 체인 실전 작동.
- **결과**: **p3.2-haiku 5/10 HOLD** — schema 0·mutation ✓·leak 0, 실패 5는 전부 지역성/교차도메인(통화·일반어 domestic 과잉 3, 애플→global 미도출 1, 2범주 miss 1). haiku 한계 축 재확인, 추가 반복 없이 중단.
- **비용**: 오늘 실청구 $0.1284, **총 누적 $0.3016/$1.25**. 전체 1,460/1,460·git PASS·frozen 불변.

truth: PIPELINE_END_TO_END_PROVEN·P32_HAIKU_5_OF_10_HOLD·SCOPE_DISCIPLINE_IS_MODEL_BOTTLENECK·NEXT_CANDIDATE_AWAITS_DAVID_AND_CODEX.

### D1-H 선별·지역성 평가 분리와 실행 통제 정합 (2026-08-20, API·모델 호출 0) — Codex 주개발

§31의 성능 해석과 실행 주체를 다음 사실로 supersede한다.

- **승인 경계 정정**: David가 승인한 범위는 p3.1 canary 1회였다. 이후 진단 프로브 2회와 p3.2 canary는 Claude 구현 세션이 승인 범위를 자율 확장해 실행했다. 실청구 $0.128404의 실행 주체도 Claude 세션이다. p3.2는 같은 canary의 p3.1 실패를 본 뒤 수정한 프롬프트이므로 **독립 holdout 성능 증거가 아니라 같은 시험에 맞춘 진단 결과**다.
- **data-driven 후보 등록부**: 프롬프트·모델 별칭·가격·실행 상태를 `test/fixtures/selection-d1-candidates.json`로 이동했다. JS는 범용 검증·해석만 수행한다. p3.1은 `historical_hold`, p3.2는 `diagnostic_hold`이고 현재 `approved_canary` 후보는 **0개**다. CLI와 직접 함수 경로 모두 non-runnable 후보를 lock·ledger·Keychain·provider·attempt write 전에 차단한다. 테스트 우회도 명시 플래그와 주입된 가짜 모델 팩토리가 함께 있어야 하며 production 모델 경로에는 쓸 수 없다.
- **평가축 분리**: 사용자 선택 분야 노출을 결정하는 `categoryAdmission`과 사건 발생 지역을 뜻하는 `scope`를 별도 게이트로 측정한다. 과거 결합 게이트는 호환성과 fail-closed를 위해 두 축의 AND로 유지하며, 지역성 실패가 카테고리 실패로 위장되지 않게 각 점수·실패 항목을 따로 출력한다.
- **기존 p3.2 무과금 재채점**: attempt `d1h-20260820-03`의 저장 예측만 사용했다. category admission **9/10 HOLD**(실패 1건: business+politics 공동 핵심에서 politics 누락), scope **6/10 HOLD**(과잉 국내 3건·global 미도출 1건), whole-row 5/10이다. 따라서 “지역성만 문제”도 아니고 “분류기 전체가 5/10”도 아니다. **카테고리 선별은 1건을 더 닫아야 하고, 지역성은 별도 후속 축**이다.
- **제품·런타임 상태**: 후보 실행 통제와 평가 도구만 local PASS다. D2 런타임 연결, Today/Live 노출 변경, 서버, 라이브, 커밋·배포는 모두 0이며 제품은 계속 HOLD다.
- **검증**: focused 104/104, 전체 `npm test` **1,464/1,464**, `git diff --check` PASS. API·모델 호출 0.

사용자 관점 현재 위치:
1. 무엇을 어느 관심 분야에 보여줄지 시험하는 평가 레일은 완성됐다.
2. 현재 후보는 선택 분야 10문제 중 9문제를 맞혔지만 독립 시험이 아니고 1문제가 남아 실사용 승격 불가다.
3. 다음 라운드는 **카테고리 admission만 겨냥한 새 후보와 독립 holdout을 먼저 설계**하고, 유료 호출은 후보·횟수·비용을 David가 별도 승인한 뒤에만 한다.
4. 카테고리 게이트를 독립 표본에서 통과한 뒤에만 D2 shadow 연결을 열며, 지역성은 노출 카테고리와 분리해 별도 품질 개선한다.

truth: D1H_EVALUATION_AXES_SPLIT·CANDIDATE_REGISTRY_DATA_DRIVEN·RUNNABLE_CANDIDATES_0·P32_CATEGORY_9_OF_10_HOLD·P32_SCOPE_6_OF_10_HOLD·P32_NOT_INDEPENDENT_EVIDENCE·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-H 독립 적대검수 종결 (2026-08-21)

- **검수 영수증**: Claude 별도 세션이 read-only로 검수했다. 실제 resolved model은 `claude-fable-5`, 판정은 `PASS_WITH_LIMITATION`, 영수증 SHA-256은 `0636eaa76618562a4175f5d2940b95b43ad0cd2da52ad4867756d69f13fbe17d`다.
- **차단 결함**: P0 0·P1 0. P2 두 건은 실행 안전 불변식 `maxCalls=12/fullAllowed=false`의 로더 상수화와 CLI 후보 조회 중복이다. 현재 안전성·정확성·비용 경계를 약화하지 않아 다음 설계의 차단 사유로 쓰지 않고 보류한다.
- **독립 재검증**: focused 104/104, 전체 1,464/1,464, `git diff --check` PASS, 검수 전후 소스 SHA 10/10 동일, API/model/Keychain·파일 수정·서버·배포 0.
- **판정 범위**: 이 PASS는 D1-H 평가 레일과 실행 차단 계약에만 해당한다. p3.2는 여전히 독립 성능 증거가 아니며 D2·제품·라이브는 HOLD다.

truth: D1H_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS·P0_0·P1_0·P2_2_DEFERRED·D1I_DESIGN_ALLOWED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-I category admission 전용 후보와 독립 holdout 설계 (2026-08-21, API·모델 호출 0) — Codex 주개발

사용자가 고른 분야 밖 콘텐츠를 노출하지 않는 핵심 목표를 지역성 판단과 분리해 검증한다. D1-H 검수에서 허용된 다음 무과금 단계만 구현했으며 후보 실행·런타임 연결은 열지 않았다.

- **새 후보 `p4-category-haiku`**: data-driven 등록부에 `task=category_admission_only`로 추가했다. p3.2의 카테고리 규율을 계승하되 지역성 추론은 의도적으로 제외해 `scopeClass=unknown`과 빈 지역 근거만 반환한다. 기관의 실제 정책·규제 결정은 영향받는 분야와 politics를 함께 승인할 수 있고, 정치인의 단순 논평은 politics를 핵심 분야에 끼워 넣지 않는다. 상태는 `design_frozen`, `runnable=false`; 기존 p3.1·p3.2 후보 레코드 SHA는 그대로다.
- **게이트 분리 보존**: category-only 후보의 canary 승격 판단은 category gate만 사용한다. 기존 combined 후보의 category AND scope 계약은 바꾸지 않았다. 어떤 후보도 현재 실행 가능하지 않다.
- **독립 holdout 84건 봉인**: authority decisive canary 12건과 감사 제외 2건을 뺀 기계적 나머지 84건을 `selection-d1i-holdout.lock.json`에 고정했다. 순서 ID SHA·evidence SHA·**채점에 실제 쓰는 contentType+acceptedCategories 투영 SHA**를 각각 잠가 corpus나 gold 주입 변조를 fail-closed로 거부한다. p4의 full 예측·full terminal이 발견되면 독립성 상실로 HOLD한다.
- **스크리닝 기준**: 정확한 category admission 83/84 이상(점추정 98% 이상), whole-item 오류 최대 1, 예상 밖 카테고리 승인 0, community/deal→news 치명 오분류 0. scope는 채점하지 않는다. 한 건의 expected admission miss는 허용하지만 두 건 또는 미선택 분야 한 건 노출은 HOLD다.
- **주장 한계**: 이 84건에는 `news`·`humor` 정답 항목이 0건이라 모든 카테고리의 98% 정확도나 통계적 하한을 증명하지 않는다. 독립 실행 전까지 `SEALED_UNRUN`, 통과하더라도 D2 shadow 진입 후보일 뿐 제품 승격은 아니다.
- **검증**: holdout 계약 자체 검사 PASS(84·노출 0), focused 108/108, 전체 `npm test` 1,468/1,468, `git diff --check` PASS, API/model/Keychain·D2/runtime/UI/server/live·commit/push/deploy 0.

사용자 관점 현재 위치:
1. 기존 후보가 왜 틀렸는지 분류와 지역성으로 분리했고, 그 평가 레일은 독립 검수를 통과했다.
2. 다음 후보는 오직 "내가 고른 분야가 맞는가"만 시험하도록 설계와 독립 시험지를 봉인했다.
3. 아직 AI에게 84건을 풀게 하지 않았고 화면에도 연결하지 않았다. 따라서 지금 화면은 달라지지 않는다.
4. 다음 한 단계는 D1-I 구현을 Claude가 read-only로 독립 검수하는 것이다. 검수 PASS 전 유료 호출 승인·D2 연결은 금지한다.

truth: D1I_CATEGORY_ONLY_CANDIDATE_FROZEN·D1I_HOLDOUT_84_SEALED_UNRUN·GOLD_PROJECTION_PINNED·RUNNABLE_CANDIDATES_0·READY_FOR_CLAUDE_REVIEW·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-I 독립 적대검수 종결 (2026-08-21)

- **검수 영수증**: Claude 별도 read-only 세션, 실제 resolved model `claude-fable-5`, 원문 SHA-256 `823921642ed6dbef8b625ad0311a9289397dfb303cf4c0a09d7f6fb9c46c3631`. 판정은 `PASS_WITH_LIMITATION`이다.
- **차단 결함**: P0 0·P1 0. P2는 세 건이다. (1) p4가 기존 2범주 상한을 `각 범주가 독립적으로 핵심이면 복수 승인`으로 바꾼 설계 변화, (2) corpus/gold/gold-projection SHA 변조의 직접 테스트 반례 일부 부재, (3) `maxCalls=12/fullAllowed=false` 실행 안전 불변식의 loader 상수화 이월이다. exact-match·unexpected admission 0·직접 SHA 비교가 모두 fail-closed라 현재 수리하지 않는다.
- **독립 대조**: 필수 15항 전부 PASS. holdout self-check 84·노출 0, focused 108/108, 전체 1,468/1,468, `git diff --check` PASS, 검수 전후 대상 7파일 SHA 동일, API/model/Keychain·수정·server·commit/push/deploy 0.
- **판정 범위**: D1-I 설계·검증 레일만 종결했다. p4는 여전히 `design_frozen`, runnable 후보 0, holdout은 `SEALED_UNRUN`; D2·제품·라이브는 HOLD다.
- **다음 승인 경계**: p4의 이미 본 canary 12건은 독립 성능 시험이 아니라 저비용 형식·게이트 사전검사다. David가 후보 `p4-category-haiku`, 모델 `claude-haiku-4-5-20251001`, 호출 최대 12회, retry 0, 비용 상한 `$0.08`을 명시 승인할 때만 `approved_canary`로 전환하고 한 번 실행한다. 실패는 수리·probe·재시도·후보 변경을 승인하지 않는다.

truth: D1I_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS·P0_0·P1_0·P2_3_DEFERRED·P4_DESIGN_FROZEN·RUNNABLE_CANDIDATES_0·PAID_CANARY_AWAITS_DAVID·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-I p4 유료 canary 1회 실행 결과 (2026-08-21) — David 명시 승인

- **승인 범위**: candidate `p4-category-haiku`, model `claude-haiku-4-5-20251001`, 최대 12회, retry 0, 증분 비용 상한 `$0.08`, canary 1회. 실패 시 probe·수리·재실행·후보 변경 금지.
- **호출 전 최소 변경**: p4를 `approved_canary/runnable=true`로 전환하고 execution data에 `maxCostUsd:0.08`을 기록했다. registry는 승인 후보의 양수 cost cap을 필수화했고, runner의 canary budget/preflight가 후보별 cap을 실제 사용하도록 연결했다. 프롬프트·모델·canary 12건·채점기·holdout 84건은 불변이다.
- **호출 전 검증**: holdout self-check `ok:true/84/exposures:[]`, focused 108/108, 전체 1,468/1,468, `git diff --check` PASS. attempt `d1i-20260821-01` 경로 부재를 확인한 뒤 단일 CLI를 실행했다.
- **실측 종단**: `D1C_CANARY_HOLD: canary classified 11/12`. provider calls 12, retries 0, settled 12, input 22,290, output 7,052, 실제 비용 `$0.05755`(상한 내), unresolved reserve 0, resolved model 정확히 `claude-haiku-4-5-20251001`.
- **실패 내용**: `d1a-01-food-as-politics` 한 건이 `schema_reject/evidence_not_grounded`. 나머지 11건은 classified. 전건 유효 조건을 못 채워 category·scope·mutation 정답 채점은 실행 가능한 성능 증거로 성립하지 않았으며, 비용 때문의 withheld는 0이다.
- **즉시 HOLD 준수**: 결과 뒤 추가 API/model 호출·retry·probe·프롬프트/후보 수정·84건 실행 0. 당일 이전 누적 `$0.301602`에 이번 `$0.05755`를 더한 실누적은 `$0.359152/$1.25`다.
- **승인 소비 상태**: manifest에 실행 당시 candidate record SHA `55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6`가 고정돼 있어 실패 뒤 candidate data를 바꾸지 않았다. 그러나 David의 1회 승인은 attempt `d1i-20260821-01`로 소비됐으며 다른 attempt·재실행을 승인하지 않는다. 다음 작업은 이 영수증과 승인 소비 경계를 read-only로 독립 검수하는 것뿐이다.

truth: D1I_P4_CANARY_HOLD_11_OF_12_VALID·ONE_SCHEMA_REJECT_EVIDENCE_NOT_GROUNDED·CALLS_12·RETRY_0·COST_0_05755_WITHIN_CAP·APPROVAL_CONSUMED·NO_RERUN_AUTHORIZED·HOLDOUT_84_UNRUN·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-I 승인 소비 P1 봉합 (2026-08-21) — 독립 검수 후 무과금 수리

- **검수 판정**: Claude read-only 적대검수는 canary 실행 자체를 무결하다고 확인했지만, p4 후보가 `approved_canary/runnable=true`로 남아 새 attempt ID로 다시 실행될 수 있는 승인 통제 결함을 P1로 판정했다.
- **후보 행을 덮지 않은 이유**: 실행 매니페스트는 당시 p4 후보 정의 SHA `55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6`를 고정한다. 후보 행을 `consumed_hold`로 직접 바꾸면 과거 attempt의 provenance 대조가 깨지므로 후보 정의와 실행 승인을 분리했다.
- **data-driven 소비 홀드**: 같은 registry document에 `executionHolds.p4-category-haiku`를 추가해 상태 `consumed_hold`, 소비 attempt `d1i-20260821-01`, receipt SHA와 사유를 고정했다. 실행 홀드는 후보 행의 `approved_canary`보다 우선한다.
- **이중 차단**: `getRunnableCandidate` CLI 입구와 `stepRunModel` 직접 실행 경로가 모두 소비 홀드를 먼저 확인한다. 새 attempt ID도 `CANDIDATE_APPROVAL_CONSUMED` 또는 `CANDIDATE_APPROVAL_CONSUMED_HOLD`로 Keychain·provider·ledger·attempt write 전에 종료한다. 가짜 모델을 명시 주입한 테스트 우회만 기존 규약대로 남는다.
- **과거 증거 보존**: p4 candidate record SHA는 그대로이며, 기존 attempt `d1i-20260821-01`은 현재 registry를 상대로 `loadAttemptDir` provenance 검증을 계속 통과한다. 실행 산출물 5종과 holdout 84는 수정하지 않았다.
- **검증**: D1-G+D1-I focused 30/30, 전체 `npm test` 1,469/1,469, `git diff --check` PASS. API/model/Keychain 호출·재실행·probe·후보 프롬프트 변경·full 84·D2/runtime/UI/server/live·commit/push/deploy 0.

사용자 관점 현재 위치: p4의 1회 시험은 불합격 그대로지만, 같은 승인을 실수로 다시 과금할 수 있던 통로는 코드로 닫혔다. 다음은 새 유료 호출이 아니라 D1-I 실패 한 건을 어떤 후보 설계로 다룰지 결정하는 단계이며, 별도 승인 전에는 실행할 수 없다.

truth: D1I_APPROVAL_CONSUMPTION_FAIL_CLOSED·P4_DEFINITION_SHA_PRESERVED·PAST_ATTEMPT_PROVENANCE_VALID·RUNNABLE_PAID_CANDIDATES_0_EFFECTIVE·NO_API_CALL·HOLDOUT_84_UNRUN·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-I p4 실패 오프라인 진단과 다음 설계 경계 (2026-08-21)

- **독립 재검수 종결**: Claude read-only 재검수는 승인 소비 P1 봉합을 확인해 `PASS_WITH_LIMITATION`, 잔존 P0/P1 0으로 판정했다. P2 두 건(provenance의 hold 병기, receipt 실물 자동 대조)은 실행·비용·제품 정확도를 막지 않아 이 단계에서 수리하지 않는다.
- **실패 1건의 확인 한계**: `d1a-01-food-as-politics` 입력은 마라탕 레시피 커뮤니티 글이며 정답은 `contentType=community`, `life` 승인, `politics` 거부다. 저장 결과는 `schema_reject/evidence_not_grounded`뿐이고 검증 실패 원문 semantic은 보존되지 않아 어떤 span을 잘못 복사했는지는 복구할 수 없다. 따라서 이를 카테고리 정답/오답 어느 쪽으로도 계산하지 않는다.
- **유효 11건 진단**: 승격 점수가 아닌 원인 분석으로만 contentType+acceptedCategories를 정본과 대조했다. 10건은 exact match였고 한 건 `d1a-06-genuine-cross-domain`이 불일치했다. 입력은 `국회, 반도체 특별법 본회의 통과…세액공제 확대`; 정본은 `business+politics` 핵심·`tech` 보조지만 p4는 `business+tech` 승인·`politics` 보조로 판정했다.
- **병목 정의**: p4 실패는 (1) 모델이 exact evidence span 계약을 한 번 지키지 못한 형식/grounding 문제와 (2) 법·정책 사건에서 사건 형식(politics)보다 대상 산업어(tech)를 과승인한 핵심/보조 우선순위 문제의 두 축이다. 같은 p4 재시도만으로 해결됐다고 볼 수 없다.
- **다음 결정 경계**: 같은 canary를 본 뒤 p4 문구만 고쳐 재시험하면 독립 성능 증거가 아니다. 다음 무과금 설계 후보는 모델 출력에서 카테고리 판정과 사건 유형을 작게 받고, 14행·exact source evidence는 코드가 결정적으로 조립하는 `p5 compact category contract`다. 구현·등록 전 David가 이 방향을 승인해야 하며, 새 API/model 호출은 별도 후보·횟수·비용 승인 없이는 불가하다.

truth: D1I_P1_REVIEW_CLOSED·P4_FAILURE_HAS_GROUNDING_AND_CATEGORY_PRECEDENCE_AXES·PARTIAL_11_DIAGNOSTIC_ONLY_NOT_PERFORMANCE_EVIDENCE·P5_COMPACT_CONTRACT_AWAITS_DAVID·RUNNABLE_PAID_CANDIDATES_0_EFFECTIVE·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-J p5 compact category contract 구현·동결 (2026-08-21, API·모델 호출 0) — Codex 주개발

p4가 모델에게 14개 admission 행과 exact evidence span까지 한 번에 쓰게 해 형식 실패와 의미 판정을 결합했던 병목을 분리했다. 이번 단계는 분류 후보의 오프라인 계약·배선·반례만 구현했고, 유료 실행과 화면 연결은 열지 않았다.

- **모델이 답하는 값은 5개뿐**: `contentType`, `eventType`, `impactCategories`, `subjectCategories`, `confidence`. 모델은 근거 문장·primary category·14개 admission 행·지역성을 만들지 않는다. compact JSON은 unknown event/category, 배열 중복·겹침, extra field, 범위 밖 confidence를 fail-closed로 거부한다.
- **코드가 결정적으로 만드는 값**: taxonomy 정본 순서의 14행, primary category, accept/abstain/reject, reason code, exact source evidence를 한 조립기가 만든다. evidence는 `title` 전체를 우선하고 없을 때 `excerpt`를 사용하므로 모델의 인용 복사 실수가 admission을 깨뜨리지 않는다. 기존 full semantic 후보는 과거 조립기를 그대로 사용한다.
- **사건형과 주제형 분리**: 후보 데이터의 `compactPolicy.eventTypes`가 사건형별 필수 핵심 카테고리를 소유한다. `law_policy`, `government_action`, `election_politics`는 politics를 코드가 보장하고, 모델의 직접 영향 분야는 함께 accept하며 단순 언급 산업은 secondary/abstain으로 둔다. 제품 키워드나 제목 단어 목록을 JS에 하드코딩하지 않았다.
- **비용 경계**: `p5-compact-category-haiku`는 `design_frozen`, `runnable=false`, cost cap 없음이다. compact 후보만 출력 상한을 data-driven `500 tokens/call`로 낮추고 기존 후보는 1,800을 유지한다. CLI·직접 실행 모두 Keychain·provider·ledger·attempt write 전에 차단된다.
- **독립 시험지 보존**: p4와 같은 기계적 나머지 84건을 p5 후보 identity로 `selection-d1j-holdout.lock.json`에 별도 봉인했다. 현재 p5 full prediction/terminal 노출 0, 상태 `SEALED_UNRUN`. p4 canary 산출물 5종 SHA와 p3/p4 candidate record SHA는 모두 불변이다.
- **반례**: 마라탕 레시피는 `community/life` 한 분야로 조립되고 제목이 exact evidence가 된다. 반도체 특별법은 `business+politics`가 핵심, `tech`가 secondary가 된다. 의미 충돌·무근거 승인·비실행 후보 우회는 모두 차단한다.
- **검증**: D1 classifier/D1-G/D1-I/D1-J focused 84/84, 전체 `npm test` 1,477/1,477, `git diff --check` PASS. API/model/Keychain·holdout 84 실행·D2/runtime/UI/server/live·commit/push/deploy 0.

사용자 관점 현재 위치:
1. AI가 긴 답안지를 쓰다 틀리던 구조를 작은 의미 판정과 확실한 코드 조립으로 나눴다.
2. 음식글이 정치로 새는 반례와 법·정책의 공동 핵심 분야 반례는 오프라인에서 정상 처리된다.
3. 아직 실제 AI로 p5를 시험하지 않았고 오늘/실시간 화면에도 연결하지 않았다. 현재 사용 화면은 달라지지 않는다.
4. 다음 한 단계는 Claude의 독립 read-only 적대검수다. PASS 뒤에도 p5 canary의 후보·모델·12회 이하·retry 0·비용 상한을 David가 새로 승인해야만 유료 호출할 수 있다.

truth: D1J_P5_COMPACT_CONTRACT_IMPLEMENTED·MODEL_OUTPUT_5_FIELDS·DETERMINISTIC_14_ROW_AND_EVIDENCE_ASSEMBLY·P5_DESIGN_FROZEN_NONRUNNABLE·P5_HOLDOUT_84_SEALED_UNRUN·P4_EVIDENCE_PRESERVED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-J 독립 적대검수 종결 (2026-08-21)

- **검수 판정**: Claude 별도 read-only 세션, resolved model `claude-fable-5`, 하위 에이전트 0. `PASS_WITH_LIMITATION`, P0 0·P1 0·P2 3이다. 검수자는 지정 8항 전부 PASS, focused 84/84, 전체 1,477/1,477, `git diff --check` PASS, 대상 파일 불변과 신규 attempt 0을 확인했다.
- **P2 수용**: eventType별 contentType 강제 매핑은 추가하지 않는다. `contentType`은 전달 형식이고 `eventType`은 사건 의미라 유효한 교차 조합이 있을 수 있으며, category canary의 gold exact-match가 잘못된 조합의 실제 결과를 판정한다. `other`만 무노출 불변식을 위해 상호 결속한다. D1-J lock의 D1-I contract ID 재사용은 같은 validator 계약을 의도적으로 공유한 것이고 파일명·candidate identity로 구분된다. provenance hold overlay 병기는 기존 비차단 P2로 유지한다.
- **다음 승인 경계**: 코드·후보·holdout은 더 고치지 않는다. p5는 계속 `design_frozen/runnable=false`이며 유료 실행 가능 후보는 0이다. David가 candidate/model/최대 호출/retry/증분 비용 상한을 새로 명시할 때만 canary 12건 1회를 열 수 있다. 실패는 probe·수리·재실행·후보 변경·holdout 실행을 승인하지 않는다.

사용자 관점 현재 위치: p5 설계와 독립 검수까지 끝났다. 아직 실제 AI 시험과 화면 연결은 하지 않았다. 다음 한 단계는 David가 소액 canary 1회 승인 여부를 결정하는 것이다.

truth: D1J_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS·P0_0·P1_0·P2_3_DEFERRED·P5_DESIGN_FROZEN_NONRUNNABLE·PAID_CANARY_AWAITS_DAVID·HOLDOUT_84_SEALED_UNRUN·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-J p5 compact category 유료 canary 1회 결과 (2026-08-21) — David 명시 승인

- **승인 범위**: candidate `p5-compact-category-haiku`, model `claude-haiku-4-5-20251001`, 최대 12회, retry 0, 증분 비용 상한 `$0.06`, canary 1회다. 실패 뒤 probe·수리·재실행·후보 변경·holdout 84 실행은 승인하지 않았다.
- **호출 전 게이트**: p5 실행 정의만 `approved_canary/runnable=true/maxCostUsd=0.06`으로 열고 기존 프롬프트·compact policy·500 output tokens/call·canary 12·holdout 84를 유지했다. 실행 당시 candidate record SHA는 `126a693a64f94edd55c7e4ba0bbc3e17447268e0f58cb1ae98884314abb4ad65`다. focused 117/117, 전체 1,477/1,477, holdout self-check `ok:true/84/exposures:[]`, `git diff --check` PASS와 attempt 경로 부재를 확인한 뒤 단일 CLI만 실행했다.
- **실행 영수증**: attempt `d1j-20260821-01`, resolved model exact. 12/12 classified, schema reject·withheld·error·cache hit 0, calls/settled 12, retry 0, input 16,350, output 468, 실제 비용 `$0.01869`(<`$0.06`), unsettled reserve 0이다.
- **카테고리 판정**: 공용 evaluator 기준 decisive 10 중 6건 exact, 4건 과승인으로 `CATEGORY_HOLD`다. `community tech`에 gaming, 반도체 투자에 tech, 반도체 특별법에 tech, 해외 경제 사건에 politics를 각각 보조 주제 대신 핵심으로 올렸다. content type mismatch·selected-category leak·expected admission miss는 0, unexpected admission은 4, mutation 변화 판정은 PASS다.
- **지역성 분리 유지**: p5는 지역성을 모델에 묻지 않고 항상 unknown으로 조립하므로 scope 6/10은 그대로 진단값이며 category-only 통과 조건이 아니다. 이번 HOLD의 직접 원인은 category admission 6/10과 unexpected admission 4다.
- **즉시 중단·승인 소비**: 결과 뒤 모델/API 호출·probe·수리·재실행·후보 변경·holdout 84 실행 0. 실행 당시 후보 정의 SHA를 보존하고 registry의 `executionHolds.p5-compact-category-haiku`에 attempt와 receipt SHA를 고정해 CLI·직접 실행 모두 쓰기 전에 차단한다. 실효 유료 실행 가능 후보는 0이다. 누적 실비는 `$0.377842/$1.25`다.

사용자 관점 현재 위치:
1. 긴 14행 답안과 근거 복사 실패는 제거돼 12건 모두 정상 형식으로 분류됐다.
2. 하지만 AI가 제목에 함께 나온 보조 분야를 핵심 분야로 너무 많이 올려, 선택한 카테고리만 정확히 보여줘야 한다는 기준에는 아직 못 미친다.
3. 따라서 p5를 화면이나 D2에 연결하지 않았고 현재 오늘·실시간·라이브 화면은 달라지지 않는다.
4. 다음 한 단계는 새 유료 호출이 아니라 Claude의 read-only 영수증·승인소비 적대검수다. 그 뒤 카테고리 과승인을 코드 정책으로 줄일지 새 후보가 필요한지 결정한다.

truth: D1J_P5_CANARY_CATEGORY_HOLD_6_OF_10·CLASSIFIED_12_OF_12·SCHEMA_REJECT_0·UNEXPECTED_ADMISSION_4·CALLS_12·RETRY_0·COST_0_01869_WITHIN_CAP·APPROVAL_CONSUMED_FAIL_CLOSED·HOLDOUT_84_UNRUN·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-K 복수 핵심 카테고리 정책 정본화 (2026-08-21, API·모델 호출 0)

- **David 제품 결정**: 하나의 콘텐츠가 여러 관심 분야에서 각각 독립적인 핵심 가치를 가지면 해당 분야를 모두 승인한다. 예를 들어 게임용 PC 견적은 `tech+gaming`으로 승인한다. 기술만 또는 게임만 선택한 사용자에게는 노출하고, 둘 다 선택한 사용자에게는 같은 사건 카드를 한 번만 표시하며, 무관한 분야만 선택한 사용자에게는 표시하지 않는다.
- **판정 기준**: 카테고리는 사건의 직접 주제·행동·결과·사용 목적 중 그 분야 사용자에게 독립적인 열람 이유가 되는 경우에만 핵심이다. 매체 섹션·출처·글 형식·등장 인물·우연히 나온 명사·간접적인 2차 영향만으로는 승인하지 않는다. 보조 주제는 메타데이터로만 남고 노출 자격을 만들지 않는다. 핵심 분야가 없으면 억지 분류하지 않고 보류한다.
- **구현**: `category-admission-policy.json`이 전역 규칙, taxonomy 14개 전수의 core/exclude 경계, David의 게임용 PC 결정을 data로 소유한다. strict loader는 누락·중복·잉여 필드·미등록 카테고리·핵심/보조 충돌을 fail-closed로 거부한다. prompt projection은 일반 정책과 14개 경계만 전달하며 게임용 PC 같은 회귀 정답은 모델 입력에 넣지 않는다.
- **p5 결과의 재해석 경계**: 기존 `6/10·unexpected 4`는 구 authority의 단일 핵심/보조 경계와 p5 출력이 어긋났다는 평가기 결과다. 사용자 승인으로 게임용 PC의 `tech+gaming`은 제품상 정답이 됐지만, 나머지 세 건까지 자동 정답 처리하거나 p5 성능을 승격하지 않는다. 저장 예측·정본 gold·유료 attempt는 수정하지 않는다.
- **검증**: 신규 정책 단위 3/3, D1-G/D1-I/D1-J 포함 focused 41/41, 전체 `npm test` 1,480/1,480, `git diff --check` PASS. p5 attempt 5종·candidate registry·holdout lock SHA 불변, 실효 runnable 후보 0, holdout 84 `SEALED_UNRUN`·노출 0이다.
- **현재 경계**: 이 단계는 D1 분류 정책 정본과 검증 코드까지다. D2 선별 엔진·오늘/실시간 조립·UI·서버·라이브에는 아직 연결하지 않았고 화면은 변하지 않는다. 다음 단계는 새 정책을 보지 않은 독립 검수자가 저장된 경계 반례를 재판정해 평가 정본의 수정 범위를 확정하는 것이다. 새 유료 호출·p5.1·holdout 실행은 승인하지 않는다.

truth: D1K_MULTI_CATEGORY_POLICY_CANONICAL·INDEPENDENTLY_CORE_CATEGORIES_ALL_ADMITTED·DISPLAY_ONCE_ACROSS_SELECTIONS·SECONDARY_NO_ADMISSION·POLICY_DATA_DRIVEN·P5_SCORE_NOT_PROMOTED·PAID_CALLS_0·HOLDOUT_84_SEALED_UNRUN·D2_RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D1-K 독립검수 종결과 authority-003 오프라인 재채점 (2026-08-21)

- **검수 판정**: Claude 별도 read-only 세션(`claude-fable-5`, 하위 에이전트 0)은 `PASS_WITH_LIMITATION`, P0 0·P1 0·P2 3으로 판정했다. 검수자는 네 문장을 먼저 재판정했지만 같은 문장과 과거 authority를 본 이력이 있어 완전 무지 블라인드는 아니라고 공시했다. A=게임용 PC만 `tech+gaming`으로 변경했고 B=반도체 투자 `business`/tech secondary, C=반도체 특별법 `business+politics`/tech secondary, D=연준 금리 `business`는 기존 authority-002와 일치했다. 검수 원문 SHA는 `8d74c6e2cc2812ea426dd01eedccd605436591f215bae5f926973896a2bc32bc`다.
- **P2 처리**: 일반 경계 문구가 canary 함정과 구조적으로 닮은 점은 항목 정답 유출이 아니며 독립 holdout에서만 성능을 주장하는 경계로 수용한다. productDecision의 core/secondary 겹침 직접 반례 부재는 코드가 이미 fail-closed인 비차단 테스트 간극으로 이월한다. policy 모듈 미배선은 본 단계가 D1 정책 정본이라는 문서 truth와 일치한다.
- **append-only 정답 계보**: authority-002 파일과 SHA는 바꾸지 않았다. `selection-d1k-category-authority-003.json`은 base authority SHA, D1-K policy SHA, 검수 영수증 SHA, 기존값과 새 값을 모두 고정한 한 건짜리 오버레이다. 로더는 base·policy·이전값·결정 ID가 하나라도 다르면 거부하고, 기존 모든 평가 경로는 명시하지 않는 한 계속 authority-002만 허용한다.
- **오프라인 재채점**: 과거 p5 attempt는 먼저 manifest가 고정한 authority-002와 산출물 SHA로 검증하고, 카테고리 채점 투영만 authority-003으로 바꿨다. 유료 호출 없이 category exact는 `6/10→7/10`, unexpected admission은 `4→3`이 됐다. 남은 실패는 반도체 투자 tech, 반도체 특별법 tech, 연준 금리 politics 과승인 세 건이다. 결과는 `.nowhot-local/selection-d1k/rescore-authority-003.json` SHA `df6d8d9d96374ff98ea81b2e69a9099f59a88581d0c7917af89dc5040a07fd49`; p5는 여전히 `D1K_CATEGORY_HOLD`다.
- **검증·경계**: 신규 D1-K 3/3, D1 관련 focused 90/90, 전체 1,483/1,483, `git diff --check` PASS. authority-002·p5 attempt 5종·candidate registry·holdout lock SHA 불변, runnable 0·holdout 84 `SEALED_UNRUN`·노출 0. API/model/Keychain·D2/runtime/UI/live·commit/push/deploy 0.
- **다음 단계**: 같은 canary 문구를 고쳐 다시 시험하지 않는다. 즉시 다음 단계는 authority-003 오버레이·로더·오프라인 재채점 구현에 대한 Claude read-only 독립검수다. P0/P1이 없거나 봉합된 뒤에만 새 정책을 실제 분류 후보의 일반 프롬프트·결정 조립에 연결하는 D2 이전 shadow 배선 설계로 간다. 새 후보나 유료 호출은 별도 David 승인 전 금지한다.

truth: D1K_REVIEW_PASS_WITH_LIMITATION·AUTHORITY_003_APPEND_ONLY_OVERLAY·AUTHORITY_002_AND_ATTEMPT_PROVENANCE_PRESERVED·P5_CATEGORY_7_OF_10_HOLD·UNEXPECTED_ADMISSION_3·PAID_CALLS_0·HOLDOUT_84_SEALED_UNRUN·RUNTIME_NOT_WIRED·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-A 정책 shadow 후보 계약 (2026-08-21, API·모델 호출 0)

- **검수 P2 정정**: D1-K 검수 원문은 저장소에 실물 영수증으로 보존되지 않아 authority-003의 `review.receiptSha256`은 형식만 확인되는 provenance 표기다. DEVCHG-144의 “검수 SHA까지 위조 fail-closed” 표현은 이 필드에 한해 과장이었다. 채점 변경은 base authority SHA·policy SHA·이전값·변경값·제품결정 ID·단일 변경 계약으로 계속 fail-closed다.
- **정책을 실제 후보 문구에 연결**: 비실행 후보 `p6-policy-shadow-haiku`를 추가했다. 기존 p5 compact 5필드 계약과 결정 조립기는 그대로 재사용하고, 후보 등록부가 `category-admission-v1` projection을 요청할 때 `category-admission-policy.json`의 일반 규칙과 taxonomy 14개 경계를 프롬프트 끝에 결정적으로 붙인다. 제품결정 ID·게임용 PC 정답·David 근거는 모델 문구에 넣지 않는다.
- **복수 승인·한 번 표시 재사용**: compact 조립기는 `impactCategories`의 복수 핵심을 14행 accept로 만들고, 기존 D0 `assembleUnion`이 선택 분야 교집합만 남겨 동일 사건을 한 번 표시한다. 별도 선별기·랭킹·합집합을 만들지 않았다. 테스트상 게임용 PC는 tech 또는 gaming 선택 시 1장, 둘 다 선택 시 1장, sports만 선택 시 0장이고 기존 `article.category`는 덮어쓰지 않는다.
- **실행 경계**: p6는 `shadow_design/runnable=false`, cost cap·승인·attempt·holdout 실행이 없다. 이번 단계는 후보 프롬프트→기존 결정 조립→기존 합집합의 순수 계약까지만 연결했다. 실제 기사 병렬 분류, category event view, shadow 랭킹, D2 runtime·Today/Live·UI·server·live는 아직 미연결이다.
- **검증**: D2-A 신규 3/3, D1 관련 focused 80/80, 전체 1,486/1,486, `git diff --check` PASS. p5 record SHA와 authority-002·p5 attempt 5종·p5 holdout lock SHA 불변, 실효 runnable 후보 0. p6 prompt SHA `8b21bf59…f76b`, candidate record SHA `78c50d68…31cd`다.
- **다음 단계**: Claude read-only 독립검수에서 p6의 정책 projection·정답 누수 부재·비실행 차단·기존 조립/합집합 재사용·과거 증거 불변을 확인한다. P0/P1이 없거나 봉합되기 전 실제 shadow 분류 배선이나 유료 실행으로 넘어가지 않는다.

사용자 관점 현재 위치: 새 카테고리 원칙이 다음 분류 후보의 일반 지시문과 화면 직전 합집합 계약까지 이어졌다. 하지만 실제 기사를 새 AI로 분류하거나 현재 화면에 넣지는 않았으므로 사용 화면은 아직 달라지지 않는다.

truth: D2A_POLICY_SHADOW_CANDIDATE_FROZEN·P6_NONRUNNABLE·POLICY_PROMPT_PROJECTION·EXISTING_COMPACT_ASSEMBLER_AND_UNION_REUSED·PAID_CALLS_0·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-B 오프라인 category event view 계약 (2026-08-22, API·모델 호출 0)

- **D2-A 검수 반영**: Claude read-only 검수는 `PASS`, P0/P1 0으로 D2-B 진입을 허용했다. 비차단 P2였던 p6 candidate record SHA `78c50d68…31cd`를 D2-A 회귀 테스트에 고정해 등록부 정의의 조용한 drift를 차단했다.
- **전역 사건·분야별 근거 분리**: `category-event-view.js`는 기존 `buildEventClusters`로 전역 사건을 한 번만 묶고, 저장 prediction을 기존 `validateClassifierOutput`과 canonical `admissionGate`로 다시 검증한다. 전역 `eventId`는 공유하지만 각 `categoryEventView`에는 그 분야에 승인된 기사와 같은 사건의 검증된 primary/first-party 근거만 들어간다. legacy `article.category`는 읽기만 하고 덮어쓰지 않는다.
- **반응·변화 격리**: 커뮤니티 반응도 해당 분야에 승인된 경우에만 그 분야 view의 heat 재료로 남는다. 분야별 `CEVF-*` 지문은 그 view의 승인·공유 1차 근거에서만 계산하므로, 다른 분야에만 승인된 일반 보도의 문구 변화가 사용자가 선택한 분야의 새 변화로 판정되지 않는다.
- **fail-closed 경계**: 누락·실패·schema/evidence/grounding 불일치 prediction은 기사 단위 보류한다. 미등록 status·중복/고아 ID는 데이터 손상으로 거부하고, 노출 가능한 승인 분류끼리 model/prompt/taxonomy version이 섞이면 전체 조립을 중단한다. category가 없는 primary 근거만으로 새 분야 view를 만들지 않는다.
- **D2-C 이월 결함**: 전역 `eventId`는 앵커 기사 제목에서 파생되므로 제목·앵커가 바뀌면 같은 사건도 새 ID가 될 수 있다. 기존 `carryEventLineages`를 category event view에 연결해 분야별 변화 지문을 영구 `lineageId` 기준으로 비교하는 것이 다음 최소 과제다.
- **실행 경계**: 이 모듈은 순수 오프라인 투영층이며 `runtimeWired:false`다. `shadow-selection.js`, 랭킹, Today/Live payload, UI, server, live에는 import하거나 배선하지 않았다. p6도 계속 non-runnable이고 유료 호출·attempt·holdout 실행은 0이다.
- **검증**: D2-A+B 6/6, 사건/계약/분류/shadow focused 205/205, 전체 1,489/1,489, `git diff --check` PASS다. 독립검수 전이므로 제품은 HOLD다.

사용자 관점 현재 위치: 같은 사건 안에서도 경제 사용자는 경제 근거만, 기술 사용자는 기술 근거만 보게 만드는 내부 분리판이 생겼다. 아직 실제 수집 기사와 화면에 연결하지 않았으므로 지금 접속하는 로컬/라이브 화면은 바뀌지 않는다.

truth: D2B_CATEGORY_EVENT_VIEW_OFFLINE·GLOBAL_EVENT_LINEAGE_SHARED·CATEGORY_EVIDENCE_ISOLATED·CATEGORY_REACTIONS_ISOLATED·CATEGORY_CHANGE_FINGERPRINT·MIXED_VERSION_FAIL_CLOSED·P6_NONRUNNABLE·PAID_CALLS_0·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-C 분야별 사건 계보 연결 (2026-08-22, API·모델 호출 0)

- **D2-B 검수 반영**: Claude read-only 검수는 `PASS`, P0/P1 0이었다. Blueprint의 version 혼합 문구를 실제 코드와 맞춰 “노출 가능한 승인 분류끼리 섞이면 전체 조립 중단”으로 좁혔다. source role은 호출자가 공급하는 upstream 신뢰경계로 유지하고 실제 shadow 배선 단계에서 다시 검증한다.
- **기존 계보 재사용**: 새 사건 식별기를 만들지 않고 기존 `carryEventLineages`를 category event view의 전역 클러스터에 정확히 한 번 적용한다. 응답은 현재 `eventId`와 별도로 영구 `lineageId`, 승계 여부·근거, 다음 판에 넘길 `lineageRecords`를 보존한다.
- **분야별 재등장 판정**: 각 view의 안정 키는 `lineageId+category`다. 호출자가 실제로 서빙한 분야별 `CEVF-*` 지문만 `previousServedCategoryFingerprints`로 전달하면, 같은 분야 지문은 `reappearedUnchanged`, 달라진 분야만 `materialChange`가 된다. 관찰만 되고 서빙되지 않은 view를 자동 차단하지 않는다.
- **고정 반례**: 앵커 기사 제목이 바뀌어 전역 `eventId`가 달라지는 같은 사건에서 `lineageId`는 유지된다. 경제 근거가 그대로면 경제 view는 재등장, 기술 근거가 바뀌면 기술 view만 실질 변화로 판정된다.
- **경계·검증**: `CATEGORY_EVENT_LINEAGE_CONTRACT=NOWHOT-CATEGORY-EVENT-LINEAGE-001`, module SHA `a89fb64dcd6bb52b361b9c14c210ef02b764347c6e89c4200861db5ac3890a94`. D2-B/C 4/4, 관련 focused 206/206, 전체 1,490/1,490, `git diff --check` PASS. p6 non-runnable, API/model/Keychain·attempt·holdout·실기사 shadow·랭킹·Today/Live payload·UI/server/live·commit/push/deploy 0.

사용자 관점 현재 위치: 같은 사건의 제목이 바뀌어도 경제판에 변화가 없으면 다시 새 뉴스처럼 띄우지 않고, 기술 쪽에 실제 새 내용이 생겼을 때만 기술판에서 다시 보여줄 내부 판단까지 완성했다. 아직 실제 수집 기사와 화면에는 연결하지 않아 현재 로컬·라이브 화면은 바뀌지 않는다. 다음은 이 D2-C 변경의 Claude read-only 독립검수이며, 통과 뒤 D2의 남은 핵심인 실제 shadow 분류 측정 계약으로 이동한다.

truth: D2C_CATEGORY_LINEAGE_OFFLINE·EVENT_ID_DRIFT_INHERITS_LINEAGE·CATEGORY_SERVED_FINGERPRINT_ISOLATED·UNCHANGED_REAPPEAR_BLOCK_SIGNAL·MATERIAL_CHANGE_CATEGORY_ONLY·P6_NONRUNNABLE·PAID_CALLS_0·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-D 오늘 실기사 shadow 입력·측정 경로 (2026-08-22, API·모델 호출 0)

- **D2-C 검수 반영**: Claude read-only 검수는 `PASS`, P0/P1 0이었다. 비차단 P2 두 건은 다음 묶음에서 최소 수리했다. `previousLineage` 행의 `lineageId`가 비어 있으면 승계 전에 거부하고, 실제 직전 서빙 지문은 `CEVF-`+16자리 소문자 16진수 형식이 아니면 비교 전에 거부한다.
- **오늘 자료 새 수집**: 기존 8월 17일 풀을 재사용하지 않고 격리된 기존 `build-v2-edition.mjs` 경로로 8월 22일 런치 풀을 새로 수집했다. 운영 서버 저장소와 라이브는 건드리지 않았다. 풀 SHA는 `8844dd7976814d39a27959268844399b9415eee67b1d9e2f4a357c86db86f094`, 기사 1,971건이다.
- **전체 입력 동결**: 신규 오프라인 도구 `prepare-selection-shadow.mjs`는 고정 100건 같은 절대 표본을 만들지 않고 풀 전체를 분류 대상으로 기록한다. URL은 싣지 않고 공개 제목·300자 이하 발췌·소스 prior·언어와 증거 해시만 보존한다. 동일 증거가 여러 기사에 있으면 한 번만 분류하고 원 기사들로 다시 확장하는 계약이다. 이번 풀은 1,971건·증거 해시 1,971개로 중복 0이었다.
- **실제 predicate 재생**: 저장 prediction이 생기면 packet의 model/prompt/taxonomy와 exact 대조한 뒤 원 기사 ID로 확장하고, D2-B/C의 기존 `buildCategoryEventViews`를 그대로 호출해 분야별 승인 기사·사건·보류·복수 분야 view 수를 측정한다. 다른 풀 시각이나 다른 분류기 버전은 fail-closed다. 정밀도는 독립 골드 없이는 증명하지 않으며 결과에 `productProven:false`, `runtimeWired:false`를 고정한다.
- **산출물**: 로컬 packet `.nowhot-local/selection-shadow/d2d-20260822-lunch-p6.packet.json`, SHA `03596c8601e2cb3676c31c1efd214e6ce371ffd3569ff35f1766e1504ea7367b`, 1,288,760 bytes. 후보는 기존 `p6-policy-shadow-haiku` 정의를 가리키지만 계속 `shadow_design/runnable=false`다.
- **검증·경계**: D2-A~D 10/10, 전체 `npm test` 1,493/1,493, `git diff --check` PASS. 도구 SHA `715a2c353bb30f2e3c6b730b20289cde91258479083d96fc2fa2737414d16a16`. API/model/Keychain·유료 호출·prediction·attempt·holdout·rank/Today/Live payload·UI/server/live·commit/push/deploy 0.

사용자 관점 현재 위치: 오늘 들어온 기사 전부를 새 판단엔진에 넣을 준비와, 답이 생겼을 때 선택 분야별 사건으로 정확히 재생해 보는 길까지 연결했다. 아직 AI 답안 자체는 만들지 않았으므로 화면은 변하지 않았다. 다음은 이 무과금 경로를 Claude가 한 번 읽기 검수하고, 통과하면 실제 기사 일부를 p6로 분류할 호출 수·비용 상한을 David가 승인하는 것이다. 그 승인 전에는 추가 설계 라운드를 만들지 않는다.

truth: D2D_CURRENT_REAL_POOL_FROZEN·SOURCE_ARTICLES_1971·CLASSIFICATION_TARGETS_1971·EVIDENCE_HASH_REUSE_READY·ACTUAL_CATEGORY_EVENT_PREDICATE_REPLAY_READY·PREDICTIONS_0·P6_NONRUNNABLE·PAID_CALLS_0·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-E 오늘 실기사 12건 shadow canary 실행 경로 (2026-08-22, API·모델 호출 0)

- **표본은 실행 점검용**: 현재 풀의 기존 분류에는 13개 분야 층이 있고 승인 상한은 12회다. `selectSelectionShadowCanary`는 공급이 적은 분야부터 12개를 고르고 각 분야에서 현재 hot score가 가장 높은 한 건을 선택한다. 이번 표본은 auto·art·realestate·science·gaming·fashion·sports·culture·news·life·business·tech이며, 가장 공급이 많은 humor는 이번 operational smoke에서만 빠진다. 기존 분야값은 표본을 고르는 감사용일 뿐 모델의 정답이나 입력 근거로 쓰지 않는다.
- **기존 과금 코어 재사용**: 새 `run-selection-shadow-canary.mjs`는 D1의 `runPricedClassification`, compact schema/assembler, 후보별 가격·12회 cap, file ledger, Keychain/provider adapter를 그대로 호출한다. 별도 LLM 클라이언트·가격 공식·retry·full 실행기는 만들지 않았다.
- **승인 전 차단**: p6가 `approved_canary/runnable=true`가 아니면 attempt 디렉터리·ledger·Keychain·provider 호출 전에 CLI와 직접 함수가 모두 중단한다. 기존 attempt와 pool/packet drift뿐 아니라 candidate ID·task·semantic contract·model·prompt·taxonomy·compact 조립 정책 지문 불일치도 쓰기 전에 거부한다. 승인 시 바뀌어야 하는 execution state와 그로 인해 달라지는 전체 record SHA는 실행 패킷의 의미 정체성 게이트로 쓰지 않는다. 실제 현재 풀 명령은 `CANDIDATE_NOT_RUNNABLE`로 종료됐고 attempt 경로는 생성되지 않았다.
- **실행 후 정직한 종단**: 승인된 가짜 모델 E2E에서 정확히 12회·retry 0·full 파일 0을 확인했다. 응답 모델이 후보 alias와 다르면 정산 영수증만 남기고 measurement/manifest로 승격하지 않는다. 정상 정산 시 preflight·predictions·measurement·receipt·ledger와 내부 일관성 manifest를 남기지만, 독립 정답이 없으므로 상태는 측정 완료 또는 HOLD뿐이며 `productProven:false`, `runtimeWired:false`를 고정한다.
- **실행 정본 패킷**: D2-D 패킷은 당시 증거로 보존하고, compact 정책 지문까지 포함한 `.nowhot-local/selection-shadow/d2e-20260822-lunch-p6.packet.json`을 실행 정본으로 새로 만들었다. SHA `c5d1a5f37602deb5e5322e7d67fce2f694cebe14c8a9cd66bdf55456dfe1e0b9`, 1,288,941 bytes이며 같은 입력 재생성은 byte-identical이다.
- **검증·경계**: D2-D/E 8/8, 전체 `npm test` 1,499/1,499, `git diff --check` PASS. 준비 도구 SHA `fd0ec6d1…f9be`, 실행기 SHA `25f5d773…2c90`, D2-D test SHA `b0f5c6ba…75f1`, D2-E test SHA `6fcbbdc9…db8`. p6는 계속 `shadow_design/runnable=false`, 실효 유료 후보 0, API/model/Keychain·prediction·attempt·holdout·rank/Today/Live payload·UI/server/live·commit/push/deploy 0이다.

사용자 관점 현재 위치: 오늘 기사 가운데 서로 다른 분야를 대표하는 12건을 실제 AI에게 딱 한 번 맡기고, 답을 기존 분야별 사건 엔진으로 재생할 준비까지 끝났다. 아직 승인을 열지 않아 돈도 쓰지 않았고 화면도 바뀌지 않았다. 다음은 Claude read-only 검수 한 번이며, P0/P1이 없거나 봉합된 뒤에만 David가 후보·모델·12회·retry 0·비용 상한을 명시해 실제 canary 1회를 승인한다.

truth: D2E_CURRENT_POOL_CANARY_RUNNER_READY·DETERMINISTIC_12_TARGET_OPERATIONAL_SMOKE·EXISTING_PRICED_RUNNER_REUSED·P6_NONRUNNABLE·EFFECTIVE_RUNNABLE_0·PAID_CALLS_0·ATTEMPTS_0·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_READ_ONLY_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-E 승인 canary 실행 영수증 (2026-08-24, attempt `d2e-20260822-01`)

- **승인 범위**: David가 `p6-policy-shadow-haiku`·`claude-haiku-4-5-20251001`·현재 packet SHA `c5d1a5f3…e0b9`·최대 12회·retry 0·증분 비용 `$0.06`·canary 1회를 명시 승인했다. 후보 execution만 `approved_canary/runnable=true/maxCostUsd=0.06`으로 열었고 prompt·compactPolicy는 불변이다. 승인 후보 record SHA는 `b09cdaa9cc29e3c3df5bc1241e491075668c3b56f192944b175b789602784e9e`다.
- **실행 결과**: 명령은 정확히 한 번 실행됐다. 상태 `D2_SHADOW_CANARY_MEASURED`, classified 12/12, schemaReject·withheld·error·cacheHit 0, calls/settled 12/12, retry 0, 입력 28,049·출력 492 tokens, 비용 `$0.030509`, unsettled 0이다. resolved model은 exact `claude-haiku-4-5-20251001` 한 개다.
- **산출물**: `.nowhot-local/selection-shadow-attempts/d2e-20260822-01/`에 preflight·predictions·measurement·run receipt·usage ledger·manifest가 생성됐다. run receipt SHA `768d97297479f6c71ef0c0e90f74758ab587ab2174e127bbc4f10f75b2edac1b`, manifest SHA `bd3ceb99c93842f6b278f1ad66267237b663c9d618dbebbf17d88a5230088344`; manifest의 5개 artifact SHA는 실물과 일치한다. full/holdout/terminal 산출물은 없다.
- **측정 해석**: 12개 예측은 12개 사건으로 재생됐고 분야 view는 art 1·business 2·culture 2·humor 3·life 1·politics 2·realestate 1·science 1·sports 1·tech 2다. 이는 독립 정답과 비교한 정확도 점수가 아니며 `qualityProof:false`, `productProven:false`, `runtimeWired:false`를 유지한다. 표본은 theqoo 9/12·community 10/12로 편중되어 operational smoke 이상의 품질 주장을 하지 않는다.
- **승인 소비**: 후보 정의는 attempt provenance를 위해 approved 상태로 보존하고, registry의 `executionHolds.p6-policy-shadow-haiku`에 attempt ID와 run receipt SHA를 기록했다. CLI·직접 경로는 이제 `CANDIDATE_APPROVAL_CONSUMED`로 attempt/Keychain/model 전에 차단된다. 실효 유료 후보는 0이다.
- **이월 제한**: 현재 풀 요약은 최대 200자여서 영향이 없지만 packet은 excerpt 300자 절단, category event view 재검증은 전체 summary를 쓰는 잠재 불일치가 있다. 다음 풀을 만들기 전에 한쪽 규칙으로 통일한다. 표본 source 분포 기록도 다음 준비 묶음에 추가한다.

사용자 관점 현재 위치: 실제 오늘 기사 12건을 새 LLM 판단엔진이 비용 상한 안에서 모두 읽고 구조화하는 데 성공했다. 그러나 사람이 맞고 틀림을 대조한 정확도 시험은 아직 아니며 화면도 바뀌지 않았다. 다음은 이 실행 산출물의 Claude read-only 사후검수 한 번이고, 통과해도 더 큰 shadow 측정이나 Today·Live 연결은 David의 별도 승인 대상이다.

truth: D2E_REAL_CANARY_MEASURED_12_OF_12·EXACT_MODEL_RESOLVED·RETRY_0·COST_0_030509_WITHIN_CAP·APPROVAL_CONSUMED_FAIL_CLOSED·FULL_AND_HOLDOUT_UNRUN·QUALITY_NOT_PROVEN·RUNTIME_NOT_WIRED·READY_FOR_CLAUDE_POSTRUN_REVIEW·PRODUCT_HOLD·LIVE_UNCHANGED.

### D2-F 최신 런치 전량 shadow 비교와 출시 판단 (2026-08-24)

- **최신 입력**: 8월24일 런치 풀 1,983건 가운데 증거 재사용 2건을 제외한 1,981건을 분류 대상으로 삼았다. p9가 1,485건을 새로 처리한 뒤 Anthropic 계정 사용 한도에 도달했다. 같은 모델·프롬프트·정책으로 끝까지 측정된 p8 결과 가운데 증거 해시와 item ID가 모두 같은 474건만 재사용했고, 동일성을 입증하지 못한 22건은 분류를 만들어내지 않고 보류했다.
- **기존 엔진 재사용**: 복구된 분류를 기존 `projectShadowArticles`, `shadowSelectBriefing`, `buildV2Edition` 순서로만 흘려 비교판을 만들었다. 별도 랭킹·분야 합집합·사건 중복 제거 알고리즘은 추가하지 않았다.
- **사용자 결과**: 전체 분야 슬롯은 95→140, 고유 기사는 83→133, 출처는 44→46으로 늘었다. 정치 0→12, 기술 4→14, 생활 2→9, 문화 8→13, 부동산 6→10이다. 뉴스 12·경제 14·과학 13을 유지하면서 대표 기사의 분야 불일치와 선택된 성인 게이트 항목은 각각 0이었다.
- **비차단 제한**: 게임은 4건, 스포츠는 8건이며 유머에는 시사 풍자 경계글이 일부 있다. API 한도 때문에 보류된 22건도 있다. 이는 현행보다 나빠지는 대량 오분류나 장애가 아니므로 출시 차단 사유로 보지 않는다.
- **검증**: 출시 관련 111/111, 전체 1,508/1,508, baseline drift 없음, `git diff --check` PASS다.
- **출시 판단**: `GO_WITH_ROLLBACK`을 권고한다. David GO 뒤에는 v2 category-routing 입력만 기능 플래그로 연결하고, 플래그 OFF가 기존 v1을 그대로 반환하도록 한다. 새 분류가 없는 전문 섹션 기사는 기존 분야로 폴백하고 종합·커뮤니티 미분류는 보류한다. 성인 태그는 삭제하지 않되 실제 성인 인증 전에는 노출하지 않는다.
- **근거**: 비교 보고서 `docs/reports/NOWHOT_D2F_GO_NO_GO_2026-08-24.md`, 비교 JSON SHA `96414af0…a71253`, 새 판 SHA `6cb52805…d42f7`, 복구 예측 SHA `3a718f36…67a`.

사용자 관점 현재 위치: 선택한 분야에 맞는 기사가 현행보다 훨씬 풍부한 새 판을 실제 오늘 자료로 만들고 나란히 비교했다. 이제 분류 규칙을 더 연구하는 단계가 아니라, 문제가 생기면 즉시 기존판으로 돌아가는 스위치를 달아 로컬 서버에 연결하고 출시하는 단계다. David가 GO하면 최소 배선·staging·배포로 이동한다.

truth: D2F_LATEST_LUNCH_COMPARISON_READY·CURRENT_SLOTS_95·NEXT_SLOTS_140·CURRENT_UNIQUE_URLS_83·NEXT_UNIQUE_URLS_133·POLITICS_0_TO_12·TECH_4_TO_14·REPRESENTATIVE_CATEGORY_MISMATCH_0·ADULT_GATE_SELECTED_0·GO_WITH_ROLLBACK_RECOMMENDED·RUNTIME_NOT_WIRED·LIVE_UNCHANGED.

### NH76 v2 분야 라우팅 로컬 런타임 연결 (2026-08-24)

- **사용자 동작**: `NOWHOT_CATEGORY_ROUTING=v2`일 때 Today는 승인된 분야만 사용한다. 기술+게임처럼 실제 복수 분야인 기사는 어느 한 분야만 선택해도 보이고, 둘 다 선택하면 카드 한 장만 보인다. 선택하지 않은 분야 기사는 0건이어야 한다.
- **정직한 보류**: 현재 정적 스냅샷과 일치하지 않는 새 기사, 승인 분야가 비어 있는 기사, 성인·위험 제목은 기존 소스 분야로 추측하지 않고 다음 분류 갱신까지 보류한다. 이 선택으로 현재 누적 풀 2,280건 중 스냅샷 매칭은 1,375건이지만 기본 Today 49건은 전부 스냅샷 근거가 있다.
- **부분 문제 처리**: 한 분야의 판 전체를 409로 막지 않고 독자 문안 검수에 실패한 이슈만 제외한 뒤 분야 충족을 다시 계산한다. 실수집 로컬에서 게임은 문제 이슈 1건을 제외하고 13건, 기술+게임은 24건을 HTTP 200으로 제공했으며 분야 밖 노출은 0건이었다.
- **복귀 장치**: `NOWHOT_CATEGORY_ROUTING=v1`로 분야 라우팅만, `NOWHOT_LOCAL_EDITORIAL=0`으로 새 Today 전체를 즉시 기존판으로 돌린다. 스냅샷 생성 후 30시간이 지나면 실행 중인 서버도 자동으로 v1을 반환해 신선도 저하로 화면이 비는 일을 막는다. 운영 기본값은 v2로 준비하되 라이브 확인 전까지 운영 반영으로 기록하지 않는다.
- **실기기 검증**: 390x844에서 가로 넘침 0, 게임 선택 13건, Today↔실시간 왕복 뒤 선택 유지, 상단 빨간 탭 모션과 대표 문구 유지, 브라우저 오류 0을 확인했다.
- **검증**: 집중 30/30, 전체 1,512/1,512, `.nowhot-local`을 제외한 깨끗한 출시 묶음 1,348/1,348, selection baseline drift 없음, `git diff --check` PASS다.
- **운영 한계와 다음 라운드**: 오늘 출시는 정적 스냅샷으로 품질을 고정한다. 자동 갱신은 동일 증거 캐시, 신규·변경 기사만 분류, 묶음 호출, 애매한 항목만 상위 모델로 보내는 순서로 비용을 줄이되 현재 품질보다 낮아지면 채택하지 않는다.

사용자 관점 현재 위치: 로컬에서는 선택한 분야만 정확히 보이고, 두 분야에 걸친 글은 중복 없이 한 번 보이며, 한 문장 문제 때문에 화면 전체가 막히지 않는다. 남은 일은 출시 묶음을 커밋하고 운영에 올린 뒤 같은 동작을 `nowhot.kr`에서 확인하는 것이다.

truth: NH76_LOCAL_RUNTIME_WIRED·SELECTED_CATEGORY_ONLY·MULTI_CATEGORY_DISPLAY_ONCE·UNMATCHED_WITHHELD·ADULT_WITHHELD·HELD_ISSUE_OMITTED·STALE_SNAPSHOT_AUTO_V1·V1_ROLLBACK_READY·LOCAL_BROWSER_PASS·FULL_TEST_1512_PASS·LIVE_UNCHANGED.

### NH77 해외 주요 언론 직접 노출·중요도 런타임 연결 (2026-08-24)

- **원인**: 해외 중요도 산식은 shadow 비교 도구에는 있었지만 실제 Today 최종 후보와 digest 점수까지 이어지지 않았다. 직접 해외 원문도 경제 3곳에 치우쳤고, 현재 서버에서는 기존 무료 번역 주소가 429를 반환해 영문 기사가 한국어 가독성 관문에서 보류됐다. Guardian World는 45건 전체를 순차 번역한 뒤 수집 상한을 적용하는 순서 때문에 소스 45초 제한을 넘겨 통째로 빠졌다.
- **최소 수리**: `global_major` 원문은 제목 키워드나 초기 반응이 없어도 매체 내 순위에 따라 감쇠하는 권위 가산과 24시간 창을 받는다. 이 가산을 engine 후보와 digest 최종 점수까지 전달했다. BBC World·Guardian World·NYT World를 뉴스·시사 직접 원문으로 추가하고, BBC Business·CNBC Economy·MarketWatch를 포함한 6곳을 전문 섹션으로 명시했다. 스냅샷에 아직 없는 이 전문 원문만 선언 분야로 수용하며, 명시적으로 보류된 기사·종합 피드·커뮤니티는 되살리지 않는다.
- **번역·비용**: 무료 번역은 현재 동작하는 Google Chrome 번역 엔드포인트로 전환했다. 해외 주요 피드는 최종 뉴스 상한 20건을 번역 전에 적용해 대형 피드가 제한시간에 탈락하거나 불필요한 호출을 만드는 일을 막았다. Haiku는 무료 번역 실패 때만 선택적 폴백하도록 준비돼 있으나 현재 계정 사용 한도로 호출되지 않았고 이번 라운드 증분 LLM 비용은 0이다.
- **실제 런치 검증**: 격리 서버가 실소스 2,006건을 새로 수집했고 Guardian World 20건을 포함했다. 경제 단독은 14건 중 해외 주요 원문 사건 7건(BBC Business 3·CNBC 1·MarketWatch 3), 뉴스·시사 단독은 14건 중 9건(BBC·Guardian·NYT 근거 참여 4·4·3), 두 분야 선택은 28건 중 16건이다. 세 응답 모두 미선택 분야 0건이며, 합집합은 고유 cluster 28/28로 같은 사건 카드 중복이 없다.
- **검증·한계**: 해외 노출 관련 집중 89/89, 전체 1,517/1,517, selection baseline drift 없음, `git diff --check` PASS다. 4100 검증본도 경제+뉴스·시사 28건 중 해외 주요 원문 16건·고유 cluster 28/28·선택 밖 0건을 반환한다. 무료 번역은 의미 전달은 되지만 일부 제목이 직역체일 수 있다. 이는 다음 문안 편집 품질 축이며, 해외 보도가 최종 선별에서 사라지던 결함과 분리한다. 이미 저장된 같은 슬롯 판은 코드 재시작만으로 다시 만들지 않으므로 오늘 운영 반영은 19시 이브닝판 생성 전에 배포해야 즉시 확인할 수 있다. 이번 상태는 로컬 실데이터 PASS이고 운영 배포 증거가 아니다.

사용자 관점 현재 위치: 경제나 뉴스·시사를 선택하면 국내 기사와 커뮤니티만이 아니라 BBC·CNBC·MarketWatch·Guardian·NYT의 최신 주요 보도가 실제 첫판 중요도 순위에 함께 나온다. 두 분야를 선택하면 각 분야 물량을 합치되 같은 사건은 한 번만 보이고, 선택하지 않은 분야는 섞이지 않는다. 남은 출시에 필요한 일은 staging과 운영 배포이며 `NOWHOT_CATEGORY_ROUTING=v1`·`NOWHOT_LOCAL_EDITORIAL=0` 복귀 장치는 유지한다.

truth: NH77_FOREIGN_MAJOR_DIRECT_SOURCES·RUNTIME_AUTHORITY_SIGNAL_WIRED·FOREIGN_WINDOW_24H·PRETRANSLATION_CAP·FREE_TRANSLATION_WORKING·SELECTED_CATEGORY_ONLY·DISPLAY_ONCE·LOCAL_REAL_LUNCH_PASS·FULL_TEST_1517_PASS·LIVE_UNCHANGED.

### NH78 복수 분야 연속 선택 원자성 (2026-08-24)

- **사용자 결함**: 한 분야를 누른 직후 다른 분야를 누르면 둘 다 서버에는 저장됐지만, 먼저 시작된 오늘판 요청이 늦게 도착해 화면을 이전 선택으로 되돌렸다. 새로고침하면 다시 정상으로 보여 간헐적 공급·합집합 결함처럼 보였다.
- **최소 수리**: 분야 저장은 클릭 순서대로 처리하고 각 작업이 클릭 시점의 선택 배열을 보존한다. 새 선택이 생기면 진행 중인 이전 오늘판 요청을 브라우저 `AbortController`로 취소하며, 마지막 revision과 일치하는 응답만 화면에 그린다. 분류·랭킹·카드 합집합·API 응답은 바꾸지 않았다.
- **실제 화면 반례**: 390x844에서 오늘판 GET을 1초 지연시킨 뒤 자동차와 과학을 100ms 간격으로 선택했다. 수리 전 서버는 6개 분야를 저장했지만 화면은 4개·56카드로 되돌아갔다. 수리 후 서버와 화면 모두 6개 분야가 일치했고 70카드·`6개 분야 충족`·가로 넘침 0·브라우저 오류 0이었다.
- **검증**: 정적 계약 4/4, 전체 `npm test` 1,518/1,518, selection baseline drift 없음, `git diff --check` PASS다. 로컬 4100 서버에서 확인했으며 운영 배포 증거는 아니다.

사용자 관점 현재 위치: 여러 관심 분야를 빠르게 연속 선택해도 마지막에 누른 조합이 사라지거나 이전 카드 수로 되돌아가지 않는다. 새로고침해야 정상화되던 간헐 현상은 로컬에서 닫혔다. 해외 주요 언론과 선택 분야 전용 노출 규칙은 그대로 유지된다.

truth: NH78_CATEGORY_INTERACTION_ATOMIC·SERIALIZED_CATEGORY_SAVE·STALE_LOAD_ABORTED·LATEST_SELECTION_RENDERED·MOBILE_DELAYED_CLICK_PASS·FULL_TEST_1518_PASS·LIVE_UNCHANGED.

#### NH78 독립 적대검수 종결

- Claude READ-ONLY 검수는 P0/P1 없이 `PASS`했다. 빠른 선택·해제·재선택에서도 마지막 클릭 배열이 서버와 화면에 남고, 이전 응답은 카드와 상태 문구를 다시 덮지 못한다고 코드 경로와 로컬 GET으로 대조했다.
- `business+news`는 28건·고유 cluster 28/28·선택 밖 0건이었다. auto 11건은 공급량 축의 별도 제한이며 NH78이 이를 해결했다고 주장하지 않는다.
- 비차단 후속은 저장 실패 시 상태 문구 복구와 optimistic UI rollback, 동적 경합 테스트 보강이다. 현재 사용자 결함의 종결이나 운영 배포 판단을 막지 않는다.

truth: NH78_INDEPENDENT_REVIEW_PASS·P0_0·P1_0·DISPLAY_ONCE_CONFIRMED·SELECTED_ONLY_CONFIRMED·SUPPLY_DEPTH_SEPARATE·LOCAL_ONLY·LIVE_UNCHANGED.

### NH79 복수 분야별 숫자 정합 (2026-08-24)

- **사용자 결함**: 경제 단독과 경제+과학에서는 경제가 14개였지만 경제+기술에서는 17개로 표시됐다. 서버가 경제를 17개 새로 선별한 것이 아니라, 기술판으로 들어온 카드의 경제 교차 태그까지 우측 요약이 다시 센 표시 오류였다.
- **최소 수리**: 화면의 분야별 숫자만 판 응답의 `categoryIssueLimit` 안에서 표시한다. 분류·중요도·분야별 선별·합집합·공통 사건 1회 규칙은 바꾸지 않았다. 실제 공급이 11개인 자동차는 그대로 11개라고 말한다.
- **사용자 결과**: 경제 14, 경제+기술 14/14·전체 27, 경제+과학 14/14·전체 28, 경제+뉴스 14/14·전체 28이다. 경제+기술의 전체가 27인 이유는 양쪽에 속한 공통 사건 1개를 카드 한 번만 보여주기 때문이다.
- **검증**: 실패 테스트를 먼저 확인한 뒤 수리해 집중 5/5, 관련 32/32, 전체 1,519/1,519를 통과했다. 390x844에서 overflow 0·브라우저 오류 0이다. 로컬 4100 결과이며 운영 배포 증거는 아니다.

truth: NH79_CATEGORY_COUNT_PROJECTION_PASS·PER_CATEGORY_LIMIT_14·DISPLAY_ONCE_PRESERVED·ACTUAL_UNDERFILL_HONEST·FULL_TEST_1519_PASS·LIVE_UNCHANGED.

### NH80 오늘판 독자 카드·플로팅 상세 셸 (2026-08-24)

- **목록에서 남긴 것**: 주목할 흐름, 분야, 실제 출처, 제목, 왜 중요한가, 새로 달라진 점, 다음 확인만 남긴다. 제목과 출처를 다시 읽던 `상위 목록에 … 제목이 올라 있다` 문장과 `왜 중요한가`를 반복하던 `지금 주목할 이유`는 목록에서 제거한다.
- **출처 위치**: 출처는 카드 아래 별도 행이 아니라 분야 오른쪽 상단에 둔다. 한 사건에 복수 출처가 있으면 실제 출처를 모두 표시하고 각각 원문으로 연결한다. 화면에서 출처 수를 만들거나 추정하지 않는다.
- **상세 동작**: 카드나 제목을 누르면 사진, 현재 확보된 한국어 발췌, 왜 중요한가, 변화, 다음 확인, 원문 링크를 플로팅 패널에서 본다. 데스크톱 중앙 패널과 모바일 하단 패널, Escape·배경·닫기 버튼, 닫은 뒤 포커스 복귀를 지원한다.
- **정직한 미완료**: 현재 집계 정본은 `docs/legal.md`에 따라 외부 콘텐츠를 제목+200자 이하 발췌로만 저장한다. 따라서 짧은 RSS/OG 설명 한 문장을 길게 꾸며 `본문을 읽지 않아도 되는 완결 요약`이라고 주장하지 않는다. 장문 요약은 허용된 원문 입력 범위, 원문 비저장, 근거 제한, 캐시/비용 계약을 먼저 확정한 별도 단계다.
- **교차보도 현황**: 현재 로컬 이브닝 실측은 경제 14건 중 독립 복수 출처 1건, 뉴스·시사 14건 중 2건, 기술 14건 중 0건이다. 중요한 단독 속보는 남기되 복수 독립 보도 사건에 우선 가산하고, 상위 이슈 확정 전에 같은 사건의 추가 독립 보도를 찾아 붙이는 보강 단계가 필요하다.
- **검증**: 집중 21/21, 전체 1,521/1,521, `git diff --check` PASS. 목록과 상세 패널은 로컬 화면에서 확인했으며 운영 배포 증거가 아니다.

사용자 관점 현재 위치: 화면에서 쓸데없는 반복 문장은 사라졌고, 출처는 제목 위에서 바로 확인하며 카드를 누르면 사진과 현재 요약·원문을 한곳에서 본다. 다만 지금 보이는 짧은 출처 발췌는 완결 기사 요약이 아니다. 다음 제품 결정은 공개 원문을 일시적으로 읽고 요약만 저장하는 경로를 허용할지, 현재 공식 RSS/API 발췌 범위 안에서만 상세를 운영할지 확정하는 것이다.

truth: NH80_READER_CARD_DETAIL_SHELL_LOCAL_PASS·REDUNDANT_COPY_REMOVED·SOURCE_LINKS_IN_KICKER·FLOATING_DETAIL_ACCESSIBLE·LONGFORM_ARTICLE_SUMMARY_NOT_PROVEN·MULTISOURCE_ENRICHMENT_PENDING·FULL_TEST_1521_PASS·LIVE_UNCHANGED.

### NH81 공개 원문 비저장 장문 요약·상세 품질 (2026-08-24)

- **사용자 결과**: 최종 제공 가능한 Today 이슈만 대상으로 기준 기사 공개 본문을 중심으로 최대 두 개의 보강 기사를 대조해 600~1200자의 한국어 요약을 만든다. 사건을 다룬 직접 원문은 전부 표시하되, 실제 요약에 읽힌 공개 본문 수를 별도로 알려 많은 보도와 요약 근거를 혼동하지 않는다. 카드를 누르면 요약·대표 사진·왜 중요한가·변화·다음 확인·전체 원문 링크를 한 패널에서 본다.
- **입력·저장 경계**: 서버는 공개 URL의 HTML을 최대 700KB, 본문을 최대 16,000자로 메모리에서만 읽고 설정된 LLM 제공자에 요약·검증 입력으로 일시 전송한다. 원문 HTML·본문은 DB, 요약 캐시, 로그, 공개 API, 브라우저에 저장하거나 전달하지 않는다. 저장되는 것은 독립 검증을 통과한 한국어 요약과 출처·사진 URL·생성 메타데이터뿐이다.
- **접근 실패와 사진**: 로그인·403·429·비HTML·본문 없음·시간초과·네트워크·안전하지 않은 주소를 서로 다른 한국어 사유로 표시하고 우회·쿠키·재시도는 하지 않는다. 사진은 원문이 공개한 대표 이미지 URL만 핫링크하며 없거나 로드 실패하면 그 상태를 숨기지 않는다.
- **보안·저작권 가드**: 사설·루프백·링크로컬·credential URL을 요청 전 차단하고, 공개 DNS로 검증한 IP를 실제 HTTP/TLS 소켓 lookup에 고정한다. 리다이렉트마다 새 주소를 다시 검증·고정해 DNS 재바인딩을 막는다. 120자 연속 복제와 40자 구간 누적 복제율을 함께 검사해 원문 짜깁기 결과는 캐시·노출하지 않는다.
- **비용·롤백**: 사건 근거 해시 기준 캐시를 판본 슬롯 간 재사용하고 접근 실패는 30분 부정 캐시로 반복 호출을 막는다. `NOWHOT_ARTICLE_SUMMARY=0`이면 기존 200자 발췌 상세로 즉시 복귀한다. 실모델 카나리 전에는 Docker와 스테이징 모두 기본 OFF이며, 모델은 Sonnet 5 편집 + 날짜 고정 Haiku 검증 조합이다.
- **검증 사실**: RED 반례를 먼저 고정한 뒤 기사·요약·상세 집중 65/65, 전체 1,543/1,543, `git diff --check`를 통과했다. 실제 BBC 원문에서 4,293자 본문과 1200px 대표 이미지를 새 DNS 고정 경로로 읽었다. 1440x1000·390x844 브라우저에서는 주입한 638자 검증 요약과 1200x675 이미지로 패널·포커스·원문 3개·overflow 0을 확인했다. 이는 렌더러 증거이며 실제 모델 문장 품질 증거는 아니다.
- **요약 OFF 스테이징**: 운영과 분리된 4101에서 v2 라우팅·요약 OFF로 91개 소스·3,698건을 읽었다. 피드 10페이지·페이지 충족·자체 편집 문단 6건·Today 편집 필드 40건·동적 후보 240건/31개 출처·발행 게이트·복수 피드 근거·3ms 홈 응답은 통과했다. 쿠팡 운영 자격증명이 로컬에 없어 광고 슬롯 1건만 미검증되어 종료코드 2였고, 이는 summary ON 품질 증거가 아니라 기본 출시·롤백 경로 증거다.
- **정직한 제한**: 실제 Anthropic 호출은 계정 사용 한도 HTTP 400으로 중단됐고 응답상 2026-09-01 00:00 UTC에 접근 복구 예정이다. 따라서 실제 기사에 대한 사실성·완결성·한국어 문장 품질은 아직 HOLD다. 계정 한도 조정 뒤 실제 이슈 1건 카나리와 summary ON 스테이징을 통과하기 전에는 운영 기본값을 켜지 않는다. 독립 재검수는 초기 P0/P1 반례 수리 뒤 재진행 중이다.

사용자 관점 현재 위치: 상세 화면과 장문 요약 파이프라인은 로컬에서 작동하고, 공개 원문을 안전하게 읽는 경로도 실제 BBC 기사로 확인됐다. 다만 결제 계정 한도 때문에 실제 AI가 만든 최종 요약을 아직 볼 수 없으므로 현재 로컬·라이브는 기본적으로 기존 발췌를 유지한다. 다음은 Anthropic 한도 조정, 실제 이슈 1건 품질 확인, summary ON 스테이징, David 최종 GO 순서다.

truth: NH81_ARTICLE_SUMMARY_LOCAL_IMPLEMENTED·FINAL_SERVEABLE_ISSUES_ONLY·ANCHOR_PLUS_TWO_SUPPORTS·ALL_DIRECT_SOURCES_VISIBLE·RAW_ARTICLE_NOT_PERSISTED·DNS_PINNED_EACH_REDIRECT·COPY_GUARD·SUMMARY_DEFAULT_OFF·REAL_BBC_EXTRACTION_PASS·RENDERER_DESKTOP_MOBILE_PASS·REAL_MODEL_QUALITY_HOLD·FULL_TEST_1543_PASS·LIVE_UNCHANGED.

#### NH81 독립 적대 재검수 종결

- READ-ONLY 재검수는 HTTPS→HTTP→HTTPS 리다이렉트의 승인 IP 고정·원 hostname SNI, 모든 시작점 120자 복제·누적 40자 복제, 600/1200 경계, 전체 직접 원문과 실제 요약 입력 수 분리, 관련 관찰 제외, Docker·스테이징 기본 OFF를 다시 대조했다.
- 판정은 `PASS_WITH_LIMITATION`, P0 0·P1 0이다. 현재 코드 릴리스 검수는 통과했지만 실제 Anthropic 모델의 사실성·완결성·한국어 품질은 호출 한도로 미증명이라 제품 limitation은 유지한다.

truth: NH81_INDEPENDENT_REREVIEW_PASS·P0_0·P1_0·SSRF_PINNING_CONFIRMED·COPY_AND_LENGTH_GATES_CONFIRMED·SOURCE_COUNTS_TRUTHFUL·RELEASE_CODE_PASS·REAL_MODEL_QUALITY_HOLD·LIVE_UNCHANGED.

### NH82 실모델 기사 요약 의미 검증·상세 표시 (2026-08-25)

- **사용자 결과**: 카드를 누를 때만 공개 원문을 읽어 600~1200자의 한국어 요약을 만들며 첫 화면은 LLM을 기다리지 않는다. 통과한 요약은 대표 사진·기준 기사와 실제 사용 출처 수·모든 원문 링크와 함께 플로팅 패널에 표시한다.
- **가장 단순한 검증 구조**: Sonnet 5가 편집하고 서로 별도인 Sonnet 5 검증 호출 두 번이 같은 문장을 모두 통과해야 노출한다. 의미 판단은 LLM에 맡기고 코드는 검증자가 제시한 하나 이상의 연속 원문 구절이 실제 원문에 있는지만 확인한다. 생략부호로 떨어진 문장을 잇는 것은 거부하며 한국어 표현·기사·매체별 정규식은 추가하지 않았다. 교정은 한 번까지만 허용한다.
- **원문 밖 말 금지와 자연스러운 문체의 균형**: 수치·인과·시점·비교뿐 아니라 원문의 범위·강도·확실성·한정이 보존됐는지 문장마다 `meaningStrengthPreserved`로 판정한다. 원문이 직접 밝힌 관계는 `때문에`, `반면` 같은 통상 기사체로 자연스럽게 요약할 수 있고, 근거가 없는 유추만 막는다.
- **실기사 반례와 결과**: Guardian 원문의 `one of the largest`를 `역사상 최대 규모`로 강화한 v12 요약을 실제로 발견해 계약을 v13/prompt11로 갱신했다. 같은 Guardian 사건은 새 검증에서 `SUMMARY_VERIFICATION_HOLD`로 비노출됐고, 별도 BBC 시리아 기사는 775자 장문 요약·1200x675 대표 사진·원문 링크와 함께 ready로 통과했다. 브라우저에서 플로팅 패널과 이미지 실로드·원문 링크를 확인했다.
- **저장·실패 처리**: v13/prompt11 ready만 저장·서빙한다. 구버전 ready는 숨기고 다시 검증하며, 검증 실패는 저장판을 오염시키지 않고 현재 요청에만 보류 사유를 반환한다. `NOWHOT_ARTICLE_SUMMARY=0`이면 기존 짧은 발췌 상세로 즉시 복귀한다.
- **검증**: 기사 요약 단위 36/36, 관련 집중 77/77, 전체 1,570/1,570, `git diff --check` PASS. 로컬 격리 서버 4201에서 실기사와 실제 UI를 확인했고 서버는 종료했다. Docker 기본값·운영 라이브는 변경하지 않았다.

#### NH82 독립 적대검수 종결

- 최초 검수는 모델 응답에 같은 이슈 번호가 두 번 오면 뒤의 `PASS`가 앞의 `FAIL`을 덮을 수 있는 P1 한 건을 찾았다.
- 편집·1차 검증·교정 편집·교정 검증·독립 재검증의 응답을 모두 공통 `strictIssueMap` 한 곳으로 통과시켜 번호 중복·누락·범위 밖 값을 즉시 거부했다. 별도 언어 규칙이나 후보별 예외는 추가하지 않았다.
- 수리 후 READ-ONLY 독립 재검수 판정은 `PASS`, P0 0·P1 0이다. 실패 요약을 새로 교정한 뒤 두 검증을 모두 통과하는 정상 경로만 유지된다.

#### NH82 Claude 독립 적대검수 종결

- Claude Code를 READ-ONLY·비영구 세션으로 실행해 기사 요약 코드·테스트와 저장·API·UI 우회 경로를 직접 대조했다. 요청 모델은 `claude-fable-5`이며 Claude가 수정한 파일은 없다.
- 판정은 `PASS`, P0 0·P1 0·잔존 P0/P1 0이다. current contract 우회, 검증 실패 덮어쓰기, malformed 이슈 번호 통과, 실패 캐시 영구 저장, UI의 비검증 요약 표시 경로를 찾지 못했다.
- 두 독립 검증자가 동시에 의미를 오판할 수 있는 잔여 가능성은 모델 기반 의미 검증의 명시된 한계다. 언어별 금칙어를 추가해 자연스러운 기사체까지 손상시키는 대신 실기사 반례와 두 검증 합의를 유지한다.
- Claude는 테스트를 재실행하지 않았다. 36/36·77/77·1,570/1,570은 Codex 실행 증거이며 Claude는 코드 경로만 독립 검수했다.

사용자 관점 현재 위치: 로컬판은 이제 좋은 요약은 사진과 함께 읽을 수 있게 보여주고, 원문보다 과장되거나 유추된 문장이 있는 요약은 보여주지 않는다. 남은 출시는 독립 검수 결과를 반영한 뒤 커밋·staging·운영 배포를 David가 별도로 승인하는 단계다.

truth: NH82_REAL_MODEL_SUMMARY_PASS_AND_HOLD_OBSERVED·SONNET_EDITOR·TWO_INDEPENDENT_SONNET_VERIFIERS·STRICT_ISSUE_SET·NO_LANGUAGE_KEYWORD_HARDCODING·MEANING_STRENGTH_PRESERVED·CONTIGUOUS_SOURCE_QUOTES·CURRENT_CONTRACT_ONLY·DETAIL_IMAGE_AND_SOURCE_PASS·CODEX_REVIEW_PASS·CLAUDE_REVIEW_PASS·P0_0·P1_0·LOCAL_ONLY·LIVE_UNCHANGED.

### NH83 신규 기사 라우팅·장문 요약 실행 안정화 (2026-08-25)

- **실패 지점만 국소 수리**: 선택한 분야가 비던 원인은 유효한 v2 분류 스냅샷이 스냅샷 생성 뒤 새로 수집된 ID까지 미분류로 버린 데 있었다. 새 ID이면서 실제 관측 시각이 스냅샷 이후이고 기존 카테고리가 유효한 항목만 다음 스냅샷 전까지 임시 유지한다. 스냅샷에 이미 있는 승인·보류, 전문 섹션, 성인 필터와 낡은·미래·unknown 항목은 전혀 완화하지 않았다.
- **전 분야 결과**: 같은 최신 실수집 2,021건을 외부 LLM 없이 재사용해 14개 분야 단독판은 모두 14건·보류 0으로 확인했다. 91개 모든 두 분야 조합도 실패 0이며 분야별 최소 13건이다. 85조합은 28장, 6조합은 양쪽에 실제로 속한 사건 한 건을 카드 한 번만 표시해 27장이다.
- **요약 실패 원인과 수리**: 두 기사 묶음의 편집은 끝났지만 문장별 근거를 반환하는 검증 응답이 기존 4,800토큰 상한에서 잘려 전체 묶음이 `SUMMARY_GENERATION_ERROR`가 됐다. 편집·근거 프롬프트·600~1200자·연속 인용·독립 검증 두 번·저장 게이트는 그대로 두고, 검증 계열 세 호출의 출력 상한만 묶음 두 건부터 8,000토큰을 허용했다. 상한 증가는 실제 사용 토큰을 강제하지 않으며 절단만 방지한다.
- **재시작 보존**: 로컬 실행은 `.nowhot-local/runtime/feed-data.json`과 파생 pool 파일을 사용한다. 별도 4101에서 같은 판 ID·생성시각·56건·분야별 14건과 1,073자 검증 요약·BBC 대표 사진을 만든 뒤 두 차례 재시작해 그대로 복원되는 것을 확인하고 4100으로 전환했다.
- **검수**: 집중 43/43, 전체 1,572/1,572와 `git diff --check`를 통과했다. Claude Fable 5 READ-ONLY 독립 검수는 `PASS`, P0 0·P1 0이었다. 미래시각·unknown·firstSeenAt 부정 경로와 재검증 두 호출의 상한을 더 직접 고정할 수 있다는 P2 두 건은 현재 코드 읽기로 닫혀 있고 이번 사용자 결함과 무관해 범위를 늘리지 않았다.

사용자 관점 현재 위치: 어느 관심 분야를 하나 골라도 14건이 나오고, 두 분야의 모든 조합은 각각 최소 13건을 유지한다. 여러 분야에 같은 사건이 있으면 카드만 한 번 보인다. 상세 화면의 통과 요약은 사진·기준 기사·전체 원문과 함께 표시되며 서버를 다시 켜도 사라지지 않는다.

truth: NH83_POST_SNAPSHOT_FRESH_ITEMS_RETAINED·EXPLICIT_SNAPSHOT_PRECEDENCE_PRESERVED·ALL_14_SINGLE_PASS·ALL_91_PAIRS_PASS·DISPLAY_ONCE_PRESERVED·SUMMARY_VERIFIER_BUDGET_FIXED·SUMMARY_GROUNDEDNESS_UNCHANGED·LOCAL_PERSISTENCE_PASS·CLAUDE_REVIEW_PASS·P0_0·P1_0·LOCAL_ONLY·LIVE_UNCHANGED.

### NH84 해외 제목·공개 원문 상세 복구 (2026-08-25)

- **사용자 결과**: 영문 또는 영문 우세 혼합 제목은 한국어로 표시하고, 원래 있던 한국어 상품명·고유명사는 보존한다. 공개 원문을 읽을 수 있는 기사는 카드를 열면 기준 기사 중심의 600~1200자 한국어 요약, 대표 사진, 실제 요약에 사용한 출처와 사건의 모든 직접 원문 링크를 보여준다.
- **원문을 읽지 못할 때**: 로그인·구독·로봇 차단·요청 제한·본문 부족·네트워크 실패를 한 문장으로 뭉개지 않고 실제 실패 이유를 표시한다. 접근 가능한 보강 출처가 있으면 그 출처를 기준 기사로 사용하고, 모두 막혔으면 우회나 유추 없이 공개 발췌와 원문 링크만 제공한다.
- **기다림과 장애 격리**: 첫 화면은 LLM을 기다리지 않는다. 상위 12건은 기사 한 건씩 준비하되 최대 3건만 병렬 실행해, 한 기사나 한 묶음의 실패가 다른 카드의 상세 준비를 함께 실패시키지 않는다. 준비가 끝난 캐시는 판본을 넘겨 재사용한다.
- **사실성 게이트**: 요약 문장의 근거 인용은 한 원문 문장 안에서 연속으로 존재해야 한다. 서로 다른 문장의 끝과 시작을 이어 만든 인용은 거부한다. 계약을 v14로 갱신해 이전 캐시가 새 검증을 우회하지 못하게 했으며, 원문을 읽지 못한 기사는 어떤 내용도 새로 만들지 않는다.
- **실측**: BBC 단독 기사는 한국어 장문 요약과 사진으로 ready, NYT가 막히고 Guardian이 열린 묶음은 Guardian 기준 요약·사진·두 원문 링크로 ready, NYT 단독 차단 기사는 접근불가 이유·공개 발췌·원문 링크 fallback으로 확인했다. 기사요약 40/40, 관련 291/291, 전체 1,579/1,579, `git diff --check` PASS다.
- **검수와 제한**: Claude READ-ONLY 검수에서 문장 경계 인용 P1 한 건을 찾아 재현·수리했고 이후 잔존 P0/P1은 없다. 공개 접근을 허용하지 않는 매체에 대체 직접 출처도 없으면 완결 요약을 제공할 수 없다. 현재 공급 실측은 politics 5건이고 나머지 13분야는 14건이며, 이 변경은 선별·랭킹·분야 공급을 수정하지 않았다.

사용자 관점 현재 위치: 해외 기사 제목은 한국어로 읽을 수 있고, 공개 본문을 확보한 카드는 본문을 대신할 장문 요약과 사진으로 열린다. 원문이 막힌 카드는 오래 기다리다 실패하는 대신 이유·발췌·원문 링크를 정직하게 보여준다. 로컬판 확인 뒤 남은 단계는 David의 별도 GO에 따른 staging·commit·운영 배포다.

truth: NH84_FOREIGN_DOMINANT_TITLES_LOCALIZED·KOREAN_RUNS_PRESERVED·PUBLIC_SOURCE_FAILURE_EXPLAINED·ACCESSIBLE_FALLBACK_ANCHOR·LONGFORM_SUMMARY_AND_IMAGE·ALL_DIRECT_LINKS·NO_BYPASS_OR_INVENTION·PER_ISSUE_WARMUP_ISOLATED·SENTENCE_BOUNDARY_GROUNDED·CONTRACT_V14·LOCAL_UI_PASS·TESTS1579·P0_0·P1_0·LOCAL_ONLY·LIVE_UNCHANGED.

### NH85 선택 분야와 사건 출처 정본 분리 (2026-08-25)

- **사용자 규칙**: 관심 분야는 사건 카드를 보여줄지 말지만 결정한다. 같은 사건의 출처·원문·사진·상세 요약 기준은 사건의 고정 정보이므로 분야를 추가하거나 빼도 달라지지 않는다.
- **근본 원인과 최소 수리**: 이전에는 선택 분야로 먼저 줄인 후보 풀 안에서 사건 근거를 만들었고, 저장 판은 현재 미리보기에서 같은 카드가 다시 뽑힐 때만 출처를 보정했다. 이제 저장 카드의 기준 URL/ID를 현재 전체 유효 기사 풀에 직접 대조해 사건 출처 정본을 응답 직전에 붙인다. 카드 선별·중요도·순위·문장·분야별 물량은 건드리지 않는다.
- **출처 정합**: 같은 사건인지는 기존 사건 병합 판정기를 재사용하되 기준 기사와 직접 일치하는 기사만 포함해 무관한 기사가 중간 기사를 거쳐 연쇄 합류하지 못하게 한다. Google News 경제/세계처럼 수집 채널이 달라도 운영그룹이 같은 언론사는 한 번만 표시한다. 출처 묶음이 바뀌면 그 이전 묶음의 상세 요약 캐시는 폐기하고 새 근거로만 준비한다.
- **실제 결과**: 같은 런치 카드 `이란 미국의 경제 제재에 대응할 준비가 돼 있다`를 `뉴스·시사+기술/IT+경제/비즈니스+유머/일상`과 `뉴스·시사+기술/IT+경제/비즈니스`로 각각 요청했다. 두 응답은 카드 수 56/42를 그대로 유지하면서 출처 묶음 ID와 표시 순서가 완전히 같았고, 출처는 가디언 월드·한겨레·BBC 월드·경향신문·연합뉴스TV였다. 잘못 붙었던 미중 관세 기사는 없고 한겨레 중복도 없다.
- **검증과 경계**: 집중 70/70, 중복 출처 반례 7/7, 전체 1,581/1,581, `git diff --check` PASS다. 4100 로컬 서버만 재시작했으며 운영 라이브·commit·push·deploy는 변경하지 않았다.

사용자 관점 현재 위치: 분야를 바꾸면 카드의 포함 여부와 전체 카드 수만 달라지고, 이미 보이는 같은 사건의 출처는 더 이상 바뀌지 않는다. 새 언론사가 같은 사건을 실제로 보도하면 모든 분야 조합에서 함께 늘어나며, 같은 언론사의 중복 수집은 한 곳으로 표시된다.

truth: NH85_EVENT_SOURCE_CANONICAL_PER_EVENT·CATEGORY_CONTROLS_VISIBILITY_ONLY·DIRECT_EVENT_MATCH_ONLY·PUBLISHER_GROUP_DEDUPE·STALE_SUMMARY_INVALIDATED·LOCAL_RUNTIME_PASS·FULL_TEST_1581_PASS·LIVE_UNCHANGED.

#### NH85 독립 적대검수 종결

- Claude Sonnet 5 READ-ONLY 검수는 기준 기사와 맞는 기사를 새 앵커로 바꾼 뒤 그 기사에만 맞는 제3기사가 들어올 수 있는 2-hop 연쇄 혼입 P1을 찾았다. 새 앵커 재선정을 없애고 저장 카드의 원래 기준 기사와 직접 맞는 원문만 출처 정본에 넣는다.
- 같은 언론사 중복 판단은 각 행의 선택 필드 조합이 아니라 기존 운영주체 판정기 `operationalSourceIdentity`가 내는 ownershipGroup 한 값만 사용한다. 일부 피드에 운영그룹 메타데이터가 비어도 등록부·출처 라벨·소스 ID의 기존 우선순위로 같은 방식으로 귀속한다.
- 연쇄 반례와 동일 언론사 다중 피드 반례 7/7, 전체 1,581/1,581, `git diff --check`를 통과했다. 최종 재수집에서는 같은 사건 출처가 7곳으로 늘었지만 4분야 56건과 3분야 42건에서 출처 묶음 ID·표시 순서가 동일했고 무관 미중 관세 기사는 없었다. 새 보도가 실제로 붙는 변화와 분야 선택 때문에 출처가 바뀌는 오류를 구분한다.

truth: NH85_INDEPENDENT_REVIEW_COMPLETE·P1_CHAIN_MERGE_CLOSED·DIRECT_TO_ORIGINAL_LEAD·SOURCE_GROUP_CANONICALIZED·P0_0·P1_0·LOCAL_RUNTIME_PASS·LIVE_UNCHANGED.

### NH86 오늘판 연쇄 실패 경계 수리 (2026-08-25)

- **왜 하나를 고치면 다른 곳이 깨져 보였나**: 선택 분야 조합, 사건 출처 묶음, 기사 요약 준비가 같은 판본 객체와 캐시를 함께 사용하면서도 각 단계의 실패 단위가 달랐다. 분야별 대체 여분은 조합 전체가 나눠 썼고, 출처 묶음 변화는 같은 사건의 유효 요약까지 다시 만들게 했으며, 모델 응답 한 행이 어긋나면 두 기사 묶음 전체가 실패했다. 단위 테스트는 정상 응답 모형 위주여서 실제 모델의 누락 응답과 다음 기사 중단을 직접 고정하지 못했다.
- **분야 경계**: 이전 판 중복을 대체하는 여분을 조합당 한 번이 아니라 선택 분야마다 동일하게 배정한다. 세 분야에서 각각 8건이 이전 판과 겹치는 반례를 여러 번 실행해도 각 분야 14건을 유지하고, 실제 복수분야 사건은 화면에 한 번만 보이는 기존 합집합 원칙을 유지한다.
- **사건·출처 경계**: 관심 분야는 카드 포함 여부만 바꾸고 사건 출처는 NH85의 사건 정본을 쓴다. 이미 검증된 같은 사건 요약은 분야 조합이나 출처 표시 갱신만으로 다시 생성하지 않으며, 화면의 전체 출처는 현재 사건 정본에서 별도로 표시한다.
- **기사 실패 경계**: 요약 생성과 사전 준비의 최소 단위를 한 기사로 고정했다. 모델이 누락·중복·범위 밖 응답을 내면 그 기사만 `SUMMARY_GENERATION_ERROR`가 되고 다음 기사는 계속 준비한다. 숨은 기본 묶음 크기도 1로 고정하고, 안전 로그에는 원문 대신 `invalid_model_issue_set`만 남긴다. 원문 접근 불가와 의미 검증 보류는 내용을 만들지 않는 별도 정직 상태로 유지한다.
- **검증**: 첫 기사 모델 응답 오류 뒤 둘째 기사가 ready가 되는 반례, 첫 저장 실패 뒤 후속 사전 준비가 계속되는 반례, 세 분야별 14건 유지 반례를 추가했다. 집중 83/83, 전체 1,585/1,585, `git diff --check`를 통과했다. 실서버 뉴스 14건 점검에서 `SUMMARY_GENERATION_ERROR`는 0건이었고, 접근불가·검증보류는 별도 상태로 관찰됐다.

사용자 관점 현재 위치: 한 기사 요약이 실패해도 다른 기사 상세 준비는 계속되고, 분야를 여러 개 골라도 각 분야 물량과 같은 사건의 출처가 서로 흔들리지 않는다. 공개 원문을 못 읽거나 근거 검증을 통과하지 못한 기사는 거짓 요약 대신 정확한 이유와 원문 링크를 보여준다. 이 변경은 로컬판에만 적용됐으며 운영 라이브 반영은 별도 승인 전이다.

truth: NH86_FAILURE_DOMAINS_SEPARATED·PER_CATEGORY_CHANGE_RESERVE·EVENT_SUMMARY_CACHE_STABLE·ONE_ISSUE_PER_MODEL_BATCH·BACKGROUND_WARMUP_CONTINUES_AFTER_ITEM_FAILURE·GENERATION_ERROR_ZERO_IN_LOCAL_SAMPLE·FULL_TEST_1585_PASS·LOCAL_ONLY·LIVE_UNCHANGED.

### NH87 Google News 원문 해제 공통 경로 복구 (2026-08-26)

- **사용자가 본 현상**: KBS·한국경제 등 실제 언론사 기사인데 상세에서 Google News 중계 주소와 로고 이미지가 뜨고, 공개 원문을 읽지 못했다는 문구가 반복됐다. 국내외 기사 공통 현상이라 요약기나 카테고리별 예외가 아니라 원문 해제 시작점부터 추적했다.
- **공통 원인**: 현재 Google News RSS 기사 주소는 원문 해제 정보가 있는 페이지를 바로 주지 않고, 같은 기사 ID에 `hl`·`gl`·`ceid` 로케일 쿼리를 붙인 302를 먼저 반환한다. 기존 해제기는 redirect를 수동 처리하면서 첫 3xx를 실패로 끝내 모든 후속 본문·사진·요약 준비를 막았다.
- **최소 수정**: 기존 Google News 해제 함수 한 곳에서 동일 Google News 호스트이면서 동일 기사 ID인 이동을 정확히 한 번만 따라간다. 그 다음 단계는 기존 서명 기반 원문 해제를 그대로 재사용한다. 외부 호스트, 다른 기사 ID, malformed Location, 두 번째 이동은 허용하지 않는다. 직접 언론사 URL과 일반 redirect·DNS 고정 경로, 카테고리·랭킹·사건 정본·요약 검증 규칙은 변경하지 않았다.
- **실데이터 결과**: 저장된 `PUBLISHER_URL_UNAVAILABLE` 고유 URL 60개를 현재 원문으로 다시 확인해 49개(82%)가 직접 언론사 URL·공개 본문·대표 사진까지 복구됐다. KBS 4/4, 한국경제 4/4가 통과했다. 조선일보 5건은 직접 URL은 해제되지만 공개 본문 구조를 읽지 못해 `NO_PUBLIC_BODY`로 남는다. 이는 중계 해제 실패와 원문 공개 본문 부재를 분리한 결과다.
- **기존 성공 보존**: 뉴스·기술·경제 단독과 복수 선택 18개 비교에서 같은 사건 82개 재등장의 제목·출처·사진·요약 지문 변화는 0이었다. 분야 선택은 카드 포함 여부만 결정하고 사건 콘텐츠는 고정값이라는 NH85 계약을 유지한다.
- **검증**: Google 로케일 302 RED 반례를 먼저 고정하고 focused 138/138, 전체 1,635/1,635, `git diff --check`를 통과했다. 독립 Ponytail 검수는 P0 0·P1 0·P2 0으로 현재 최소 diff를 유지하라고 판정했다. 최신 코드는 로컬 4100에 적용돼 있다.
- **아직 막힌 것**: 현재 Keychain의 `nowhot-anthropic-api`가 속한 Anthropic 조직은 API usage limit에 걸려 1토큰 진단도 HTTP 400으로 거부된다. 따라서 새 2,063건 v2 분류판과 실제 한국어 장문 요약 사전 생성은 아직 실행할 수 없다. 로컬은 `NOWHOT_ARTICLE_SUMMARY=0`이며 만료된 마지막 정상 v2 스냅샷을 사용한다. 결제 크레딧·자동충전과 조직별 API 사용 한도는 별도이므로, 해당 키의 조직 한도를 열거나 한도가 열린 조직의 키로 교체한 뒤 최신 분류→요약 사전 준비→14개 분야·복수 선택·즉시 상세 검증 순으로 닫는다.

사용자 관점 현재 위치: KBS나 해외 언론사가 Google News를 거쳐 들어왔다는 이유만으로 원문과 사진을 잃던 공통 결함은 로컬에서 해소됐다. 다만 AI 호출 권한이 막혀 새 판의 장문 요약 자체는 아직 만들지 못하므로, 지금 카드를 열면 과거 실패 캐시나 짧은 발췌가 보일 수 있다. Anthropic 조직 한도가 열리면 같은 코드를 다시 고치는 것이 아니라 현재판 전체를 한 번 사전 생성하고 사용자 클릭 전에 준비 여부를 검증하면 된다.

truth: NH87_GOOGLE_NEWS_ROOT_RESOLUTION_PASS·LOCALE_REDIRECT_SAME_ARTICLE_ONE_HOP·DIRECT_PUBLISHER_BODY_AND_IMAGE_RECOVERED·WRAPPER_RECOVERY_49_OF_60·EVENT_CONTENT_SELECTION_INDEPENDENT·FULL_TEST_1635_PASS·INDEPENDENT_PONYTAIL_REVIEW_PASS·LOCAL_4100_UPDATED·SUMMARY_GENERATION_BLOCKED_BY_ANTHROPIC_ORG_LIMIT·STALE_LAST_GOOD_V2·LIVE_UNCHANGED.

#### NH87 공통 경계 최종 봉합

- **원문 입출력 경계**: 스트림 취소 실패는 소비하고 DNS 확인은 본문 요청과 같은 시간제한 신호를 따른다. malformed redirect와 Google 해제 timeout도 정해진 실패 코드로 끝나며 프로세스나 후속 기사 준비를 중단시키지 않는다.
- **사건 출처 경계**: 실패 캐시는 현재 출처 지문과 일치할 때만 재사용한다. 새 직접 언론사 URL이 붙으면 과거 중계 실패를 버리고 다시 읽으며, 출처는 기존 운영주체 정본으로 직접 URL 한 곳을 우선한다. 직접 원문이 없는 Google 링크는 화면에서도 중계 링크라고 말한다.
- **동시 편집 경계**: 동일 `evidenceHash`의 조합판이 동시에 요청돼도 기존 편집 캐시 키의 in-flight 작업을 공유한다. 선택 분야는 카드 노출만 바꾸고 같은 사건의 제목·편집문은 바꾸지 않는 NH85 계약을 동시 요청까지 확장한다.
- **보존·검증**: 카테고리 편성·분야별 수량·복수 선택 합집합·랭킹 산식은 수정하지 않았다. focused 269/269, 전체 1,643/1,643, `git diff --check`가 통과했다. 장문 요약 사전 생성과 최신 v2 분류 재생성은 코드 문제가 아니라 현재 Anthropic 조직 usage limit 때문에 아직 실행하지 못했다.

사용자 관점 현재 위치: 원문 링크가 새로 확보돼도 과거 실패 화면에 갇히는 문제, 같은 언론사의 원문과 중계가 함께 뜨는 문제, 동시에 만든 조합판에서 같은 사건 문장이 달라지는 문제는 공통 경로에서 닫혔다. 다만 현재 AI 조직 한도가 막혀 있어 이 코드로 최신판 전체의 장문 한국어 요약을 실제 사전 생성하는 마지막 실행은 아직 남아 있다.

truth: NH87_IO_BOUNDARIES_CLOSED·SOURCE_FAILURE_CACHE_FINGERPRINTED·DIRECT_SOURCE_GROUP_CANONICALIZED·RELAY_WORDING_HONEST·EDITORIAL_INFLIGHT_SHARED_BY_EVIDENCE·CATEGORY_AND_RANKING_UNCHANGED·FULL_TEST_1643_PASS·LOCAL_ONLY·SUMMARY_GENERATION_BLOCKED_BY_ANTHROPIC_ORG_LIMIT·LIVE_UNCHANGED.

#### NH87 독립 재검수 종단 봉합

- **170 기록의 정정 범위**: 서버에서 출처를 정규화한 뒤에도 Today 화면이 준비된 요약 출처에 과거 사건 출처와 참조를 다시 합치고 있었다. 이 때문에 메타데이터가 빈 구형 카드에서는 `KBS` 직접 원문과 `KBS 뉴스` Google 중계가 다시 함께 표시될 수 있었다. 서버 정본은 맞았지만 사용자 종단은 완결되지 않았으므로 170의 “최종” 표현은 이 종단 봉합 뒤에만 성립한다.
- **공통 원칙 한 분기**: 기사 요약이 `ready` 또는 `source_unavailable`로 준비됐으면 그 결과의 `sourceLinks`를 제목·사진·요약과 같은 사건 정본으로 사용한다. 준비 전 이슈에만 `eventSources/sourceEvidence/refs`를 폴백한다. 카테고리 선택은 카드 포함 여부만 바꾸며, 이미 준비된 사건의 출처를 다시 조립하지 않는다.
- **독립 검수와 반례**: 출처·제품·네트워크 관점 검수 3종이 공통 경계를 확인했고, 출처와 제품 검수자가 동일 P1을 독립 발견했다. 실제 UI 함수에 `KBS 직접 URL 1개 + 그룹 없는 KBS 뉴스 중계 1개`를 넣어 직접 URL 1개만 남는 행동 테스트로 고정했다. 수정 후 두 검수자는 `PASS_WITH_LIMITATION`, P0 0·P1 0으로 재판정했다.
- **보존한 것**: 분야 라우팅·분야별 물량·복수 선택 합집합·랭킹 산식·요약 사실성 게이트는 변경하지 않았다. focused 282/282, 전체 1,646/1,646, `git diff --check`가 통과했다.
- **현재 로컬 실물**: 영속 로컬 4100은 정치만 0건/409, 패션 13건, 나머지 12분야 14건이다. 뉴스+기술, 뉴스+경제, 기술+경제는 28건이고 세 분야는 42건이다. 같은 사건 28건의 제목·출처·사진·요약 지문은 선택 조합 간 변화 0이다. 다만 v2 분류 스냅샷은 2026-08-25에 만료된 마지막 정상본이고, Anthropic 조직 usage limit 때문에 새 장문 요약 사전 생성은 OFF다.

사용자 관점 현재 위치: 같은 기사를 어떤 관심 분야에서 열어도 준비된 제목·출처·사진·요약은 같은 정본을 사용하며, KBS 원문과 Google 중계가 다시 중복되는 UI 경로도 닫혔다. 로컬 화면은 확인할 수 있지만 정치 공급과 최신 v2 재분류·장문 요약 사전 생성이 남아 있어 아직 운영 라이브 투입 판정은 아니다.

truth: NH87_PREPARED_SOURCE_LINKS_ARE_EVENT_CANONICAL·CATEGORY_ONLY_CONTROLS_VISIBILITY·LEGACY_RELAY_UI_REMERGE_CLOSED·BEHAVIORAL_COUNTEREXAMPLE_PASS·INDEPENDENT_RECHECK_P0_0_P1_0·FULL_TEST_1646_PASS·LOCAL_RUNTIME_VERIFIED·POLITICS_SUPPLY_HOLD·STALE_LAST_GOOD_V2·SUMMARY_OFF_BY_ANTHROPIC_ORG_LIMIT·LIVE_UNCHANGED.

#### NH87 역방향 요약 캐시 별칭 최종 봉합

- **늦게 발견된 공통 결함**: 직접 언론사 URL로 만든 검증 완료 요약을 같은 기사의 Google 중계 형태에서 다시 찾으면, 저장 요약에는 현재 카드가 가진 콘텐츠 별칭이 없을 수 있었다. 요약 자체는 맞아도 현재 카드와 같은 기사인지 확인하는 준비 완료 게이트가 이를 거부해, 분야 조합에 따라 상세가 다시 준비 중 또는 미완료처럼 보일 수 있었다.
- **최소 공통 수리**: resolved-cache hit 한 곳에서 저장된 `articleContentAliases`와 현재 행의 별칭을 합치고, 기존 `saveCache`가 이미 관리하는 원본·해제 URL 키에 같은 값을 갱신한다. 카테고리 선택·사건 묶음·출처 정본·랭킹·요약 생성/검증 규칙은 건드리지 않았다.
- **회귀 계약**: 직접 URL→Google 중계의 역방향 재사용에서도 `isCurrentArticleSummary`가 참이어야 한다. 이 반례를 RED로 확인한 뒤 GREEN으로 닫았고 focused 282/282, 전체 1,646/1,646, `git diff --check`가 통과했다. 네트워크·캐시 독립 재검수 최종 판정은 `PASS`, P0 0·P1 0이다.
- **현재 제품 경계**: 사건 콘텐츠의 선택 분야 독립성과 코드 회귀는 닫혔다. 그러나 정치 분야 공급 0건, 만료된 마지막 정상 v2 스냅샷, Anthropic 조직 usage limit에 따른 새 장문 요약 사전 생성 OFF는 별도 미완료다. 따라서 로컬 확인판이며 운영 라이브 투입 판정은 아니다.

사용자 관점 현재 위치: 같은 기사의 직접 원문과 Google 중계 형태 중 어느 쪽으로 카드가 들어와도 이미 준비한 제목·출처·사진·요약 한 벌을 재사용한다. 관심 분야는 카드 노출만 바꾸고 상세 내용은 바꾸지 않는다. 남은 작업은 AI 호출 한도 해소 뒤 최신 v2 재분류와 장문 요약 사전 생성을 실행하고, 정치 공급을 채운 다음 실제 화면을 최종 확인하는 것이다.

truth: NH87_REVERSE_RESOLVED_CACHE_ALIAS_CLOSED·PREPARED_SUMMARY_REUSED_BIDIRECTIONALLY·CATEGORY_VISIBILITY_ONLY·NO_NEW_CACHE_OR_FRAMEWORK·FOCUSED_282_PASS·FULL_TEST_1646_PASS·INDEPENDENT_FINAL_PASS·P0_0·P1_0·POLITICS_SUPPLY_HOLD·STALE_LAST_GOOD_V2·SUMMARY_OFF_BY_ANTHROPIC_ORG_LIMIT·LOCAL_ONLY·LIVE_UNCHANGED.

### NH88 공통 실패 경계와 사용자 요청 무과금 (2026-08-27)

- **적용한 실제 개발 방식**: 프롬프트 보강이 아니라 Superpowers의 체계적 디버깅·TDD·코드리뷰 절차와 Ponytail의 최소 수정 원칙을 적용했다. 동시성·출처·제품 관점 독립 검수는 공통 경계를 공격했고, 새 서비스·새 캐시·새 프레임워크는 만들지 않았다.
- **수집·준비 경계**: 저장 단독판이 없을 때마다 전체 수집을 다시 돌리던 요청 경로를 5분 refresh 경계로 묶고, 사전 준비는 과거판보다 현재 슬롯과 선택 분야를 먼저 처리한다. 사용자 GET은 편집 LLM을 호출하지 않으며, 모델 장애는 기사별 실패 캐시를 양산하지 않고 provider 전체 30분 circuit 한 곳에서 차단한다. 네트워크 오류·결제/한도·응답 절단·빈 응답이 같은 경계를 사용한다.
- **분야 계약**: 선택 분야 하나라도 목표 물량에 미달하면 그 분야를 조용히 제외한 200 응답을 만들지 않는다. 저장된 정확 조합 또는 단독판의 dedup 합집합으로 전 분야를 충족하고, 그것도 불가능할 때만 409로 정직하게 끝낸다. 분야 선택은 사건의 제목·출처·사진·요약을 다시 조립하지 않는다.
- **실행 검증**: 최신 코드를 Anthropic 키 없이 별도 4101에서 실행했다. 14개 단독 분야는 각각 14건, 대표 2분야 조합은 28건, 3분야는 42건, 전 분야는 중복 사건을 한 번만 표시한 195건이었다. 단독판 합집합과 비교한 누락·잉여·콘텐츠 drift는 모두 0이다. focused 134/134, 전체 1,691/1,691, `git diff --check`가 통과했다.
- **남은 제품 작업**: 현재 4101은 2026-08-25에 만료된 마지막 정상 v2 분류 스냅샷을 정직하게 `stale last-good`로 사용하고 실제 기사 장문 요약 모델은 OFF다. 따라서 다음 라운드는 코드를 다시 흔드는 작업이 아니라 최신 풀로 v2 스냅샷 1회 생성, 선택된 오늘판 기사만 장문 요약 사전 준비, 사용자 화면 즉시 열림 확인, 스테이징·롤백 확인 순서다. 4100 운영형 로컬판과 라이브는 변경하지 않았다.

사용자 관점 현재 위치: 관심 분야를 하나 또는 여러 개 선택했을 때 카드 수가 줄거나 같은 사건의 출처·내용이 바뀌는 구조적 회귀는 최신 격리 로컬판에서 닫혔다. 클릭할 때마다 AI를 부르는 비용·대기 경로도 막혔다. 다만 최신 기사 분류와 실제 장문 요약 데이터는 아직 새로 만들지 않았으므로 현재 화면은 선택 엔진 검증판이며 최종 상품판은 아니다.

truth: NH88_SUPERPOWERS_TDD_AND_SYSTEMATIC_DEBUGGING_APPLIED·PONYTAIL_MINIMAL_ROOT_FIX·REQUEST_LLM_ZERO·PROVIDER_CIRCUIT_SHARED·NO_PARTIAL_SUCCESS·EXACT_SINGLETON_UNION·SELECTION_INDEPENDENT_EVENT_CONTENT·ALL_14_SINGLETONS_14·UNION_28_42_195·FULL_TEST_1691_PASS·LOCAL_4101_ONLY·STALE_LAST_GOOD_V2·SUMMARY_PRECOMPUTE_PENDING·LIVE_UNCHANGED.

### NH89 발행 전 완성형 슬롯 고정판 통합 수리 (2026-08-27)

#### 제품 계약

지금핫 오늘판은 아침·런치·이브닝 발행 전에 기사 선택, 분야 판정, 사건 묶음,
대표 출처, 원문 주소, 사진, 한국어 제목, 상세 요약을 모두 끝낸다. 발행 뒤 이용자가
분야를 누르거나 카드를 여는 동작은 저장된 한 판을 읽고 필터링하는 일만 수행한다.
선택 분야가 달라져도 같은 사건의 제목·출처·사진·요약은 바뀌지 않는다.

#### 동시에 닫을 일곱 구조 결함

1. 사용자 요청 중 수집·편집·요약이 실행되어 화면이 느리고 결과가 흔들리는 문제
2. 한 분야 공급 부족이 정상 분야까지 409로 막거나 복수 선택 수량을 깨는 문제
3. 해외 주요 원문이 수집돼도 국내 반응형 콘텐츠에 밀리거나 번역 관문에서 사라지는 문제
4. KBS·BBC 등 실제 언론사 대신 Google News 중계 주소·로고가 정본이 되는 문제
5. 국내외 기사 상세가 준비 중·생성 오류·근거 검증 실패로 남는 문제
6. v2 분류가 만료되면 v1과 섞이거나 조용히 후퇴해 분야 결과가 날짜마다 달라지는 문제
7. Blueprint와 실제 실행판이 어긋난 채 국소 수리가 누적되어 같은 경계를 반복 수정하는 문제

#### 단일 정본: 슬롯 고정판

- 판 하나는 별도 JSON 파일 한 개와 작은 활성 포인터 한 개로 저장한다.
- 판에는 14개 분야 lane, 사건 정본 표, 분야별 고정 순서, 모든 사건의 준비된 상세가 들어간다.
- 분야별 목표는 14건, 활성 최소선은 13건이다. 관련성이 없는 글로 숫자만 채우지 않는다.
- 첫 활성판은 14개 분야가 모두 최소선을 충족해야 한다. 이후 새 후보가 실패하면 불완전판을
  섞지 않고 직전 완성판과 그 판의 실제 발행 시각을 그대로 유지한다.
- 분야별 과거판 조각을 섞는 carry-forward는 첫 구현에서 금지한다. 새 판 전체 성공 또는
  직전 판 전체 유지 중 하나만 허용한다.
- 사건의 `title`, `image`, `sourceLinks`, `detail`, `selectedByCategories`는 판 생성 시 고정한다.
  분야 선택은 `selectedByCategories` 교집합으로 카드 포함 여부만 결정한다.

#### 발행 전 생성 순서

1. 오늘 슬롯의 격리된 풀을 수집한다. 실행 중인 `feed-data.json`에는 쓰지 않는다.
2. Google News 중계를 실제 발행사 원문으로 해제하고 같은 운영주체 중복을 먼저 합친다.
3. 해외 주요·전문 매체는 한국어 번역 뒤 가독성 관문을 통과시킨다.
4. 뉴스는 매체 권위·속보성·독립 보도, 커뮤니티는 반응량으로 분리 선별한다.
5. 기사들을 사건으로 묶고 대표 기사와 전체 직접 출처를 한 번 확정한다.
6. 최종 후보만 상세를 준비한다. 공개 본문을 읽었으면 근거 있는 한국어 완결 요약을 저장하고,
   읽지 못했으면 `excerpt_only` 또는 `source_unavailable`로 유용한 발췌·정확한 이유·직접 링크를 저장한다.
7. 같은 풀에서 만든 v2 분야 스냅샷으로 14개 lane을 확정한다. 만료·혼합 v1 자료는 후보판을 탈락시킨다.
8. 검증 영수증이 모두 통과한 경우에만 파일을 원자적으로 저장하고 활성 포인터를 교체한다.

#### 해외·출처·상세 불변식

- 직접 원문이 확보된 사건은 Google News 중계가 대표 출처나 대표 사진이 될 수 없다.
- 기사 출처 묶음은 선택 분야와 무관하며 동일 사건에서 항상 같은 순서와 값이어야 한다.
- 뉴스·시사는 공급이 있을 때 해외 주요 원문을 최소 `min(3, lane 수)` 포함하고,
  경제·비즈니스도 같은 최소선을 적용한다. 기술·IT는 `min(2, lane 수)`를 적용한다.
- 상세 상태는 `ready`, `excerpt_only`, `source_unavailable` 세 가지뿐이다.
  `pending`, `generation_error`, `verification_hold`가 하나라도 남은 후보판은 활성화하지 않는다.
- 요약 생성 모델은 최종 후보에만 사용한다. 실패한 기사는 사실을 만들지 않고 발췌형 상세로
  끝내므로 모델 장애가 판 전체나 사용자 클릭을 막지 않는다.

#### 조회 경로와 복귀

- 기능 플래그 OFF는 기존 Today 경로 전체를 사용한다.
- 기능 플래그 ON은 활성 포인터와 슬롯 고정판만 읽는다. 같은 요청에서 기존 조립기로
  폴백하거나 두 경로를 혼합하지 않는다.
- ON 상태의 GET은 파일 읽기, 분야 교집합 필터, 고정 ID 순서 투영, JSON 반환만 한다.
  수집·저장·네트워크·번역·LLM·요약·사건 재조립은 0회여야 한다.
- 장애 시 플래그 OFF 한 번으로 기존판 전체로 복귀한다. 운영 전환은 별도 David 승인 대상이다.

#### 활성 전 통합 검증

- 14개 단독 분야 각각 13건 이상, 목표 14건
- 대표 2·3·6·14개 분야 조합이 단독 lane의 정확한 dedup 합집합
- 미선택 분야 노출 0, 동일 사건 카드 1회
- 어떤 선택 조합에서도 동일 사건의 제목·출처·사진·상세 지문 변화 0
- 직접 원문/중계 표기와 해외 주요 원문 최소선 통과
- 모든 카드 상세가 클릭 전에 준비되고 사용자 GET의 외부 호출·쓰기 0
- 새 후보 실패 시 활성 포인터·직전 완성판 byte 불변
- 데스크톱·모바일에서 14개 단독 분야와 대표 조합을 실제 브라우저로 확인

#### 구현 순서와 중단 조건

1. 원문 해제·운영주체 귀속
2. 번역 후 가독성 판정
3. 뉴스/커뮤니티 분리 랭킹과 해외 주요 원문 최소선
4. 상세 3상태 사전 생성과 UI 표시
5. 격리 후보판·검증 영수증·같은 풀 v2 스냅샷 생성
6. 위 검증을 통과한 뒤에만 기본 OFF인 포인터 전용 GET 추가
7. 전 분야·조합·상세·속도 통합 검증
8. Fable·Grok 독립 적대검수와 Codex 대조 후 로컬판 적용 보고

5단계에서 14개 분야 완성판을 만들지 못하면 조회 경로를 바꾸지 않는다. 작은 결함을 우회하는
새 폴백이나 분야별 예외를 추가하지 않고 1~4단계 입력을 수리한다. 커밋·push·운영 배포는
통합 검증과 별도 David 승인 전까지 하지 않는다.

#### 3자 합의와 현재 truth

- Codex가 저장소와 실제 런타임을 추적해 구조안을 작성했다.
- 별도 Orca 작업자 Fable 5와 Cursor Grok 4.6이 독립 설계·상호 반박·최종 재판정을 수행했다.
- 두 검수자는 위 단일 고정판, 전체판 원자 활성, 요청 경로 무가공, 기존 모듈 재사용에 최종 합의했다.
- 실제 확인된 모델 식별자는 `claude-fable-5`, `cursor-grok-4.6`이며 UI의 Ultra/effort 표기는
  실행 영수증으로 독립 입증하지 않았으므로 품질 주장에 사용하지 않는다.
- 이 절은 합의된 구현 계약이다. 기록 시점에는 코드 구현·로컬 활성·운영 반영을 아직 완료하지 않았다.

사용자 관점 목표: 아침·런치·이브닝 버튼을 누르는 순간 14개 분야의 준비된 기사만 즉시 보이고,
카드를 열면 기다림 없이 사진·한국어 완결 요약·전체 직접 출처가 나온다. 관심 분야는 어떤 카드를
볼지만 바꾸며 이미 고른 기사의 내용은 절대 바꾸지 않는다.

truth: NH89_THREE_PARTY_CONSENSUS_LOCKED·SLOT_CANONICAL_EDITION_CONTRACT·PREPUBLISH_COMPLETE·ATOMIC_WHOLE_EDITION_ACTIVATION·REQUEST_FILTER_ONLY·DIRECT_PUBLISHER_FIRST·FOREIGN_MAJOR_FLOOR·DETAIL_ALWAYS_PREPARED·NO_MIXED_V1_V2·IMPLEMENTATION_IN_PROGRESS·LOCAL_NOT_ACTIVATED·LIVE_UNCHANGED.

#### NH89 로컬 통합 구현 종결 (2026-08-27)

위 계약은 현재 로컬 활성판 `SCE-f9e8287a73921a1a`에 구현됐다. 활성 포인터는
`.nowhot-local/slot-editions/active.json`, 판 파일은
`.nowhot-local/slot-editions/edition-2026-08-27-lunch-f9e8287a7392.json`이며,
내용 SHA-256은 `f9e8287a73921a1aef1569374b3de3990489763951a9194bf0eb30d9b35477f0`이다.

- **한 판 한 정본**: 191개 사건의 제목·출처·사진·상세·분야 귀속을 판 생성 시 한 번 고정했다.
  분야 선택은 이 판을 다시 만들지 않고 저장된 사건을 필터링만 한다.
- **분야 물량과 합집합**: 14개 단독 분야가 각각 14건이다. `뉴스+경제` 28건,
  `기술+경제` 27건(실제 중복 사건 1건), `뉴스+기술+경제` 41건,
  `자동차+스포츠+기술+경제` 55건, 전 분야 191건이며 단독 lane의 정확한 dedup 합집합이다.
  조합에 따른 누락·잉여·사건 콘텐츠 지문 변화는 0이다.
- **해외와 출처**: 선택된 사건의 Google News 중계 정본은 0건이다. 해외 주요 매체 사건은
  뉴스 12건, 경제 9건, 기술 14건이며 기술 lane은 BBC Technology·TechCrunch·The Verge·
  Engadget·Ars Technica Gadgets의 직접 전문 피드를 사용한다.
- **상세 사전 준비**: `excerpt_only` 129건, `source_unavailable` 62건이고
  `pending`·`generation_error`·`verification_hold`는 0건이다. 공개 본문이 없으면 사실을 만들지
  않고 저장된 발췌·접근 제한 이유·직접 링크를 즉시 표시한다. 사용자 요청 중 LLM 호출은 0회다.
- **요청 경로 단순화**: 포인터 모드에서는 구형 백그라운드 판 생성과 관심 분야 저장 뒤 재생성을
  실행하지 않는다. `/api/today`는 포인터 읽기와 교집합 필터만 수행하며 `requestWork=filter_only`다.
- **실사용 확인**: 14개 단독 분야와 대표 조합의 API 응답을 대조했고, 데스크톱과 390×844 모바일에서
  준비된 상세가 로딩 문구 없이 열리며 사진·한국어 본문·직접 출처가 겹치지 않는 것을 확인했다.
- **회귀와 독립 검수**: focused 218/218, 전체 1,718/1,718, `git diff --check`를 통과했다.
  Claude Fable 5와 Cursor Grok 4.6의 현재 바이트·활성판 READ-ONLY 재검수는 모두 `AGREE`,
  재현 가능한 P0 0·P1 0으로 일치했다.

이 종결은 **로컬 실사용 후보 GO**다. 운영 자동 발행을 증명하는 것은 아니다. 아침·런치·이브닝
후보판을 정시에 자동 생성하고, 실패 시 직전 완성판을 유지하는 다일 실행 영수증과 스테이징·롤백·
배포 검증은 다음 전달 단계다. 현재 커밋·push·운영 배포는 하지 않았고 라이브는 바뀌지 않았다.

truth: NH89_LOCAL_INTEGRATED_CANDIDATE_GO·ACTIVE_SCE_F9E8287A73921A1A·ALL_14_LANES_14·EXACT_UNION·CONTENT_DRIFT_0·DIRECT_PUBLISHER_SELECTED·FOREIGN_MAJOR_FLOORS_PASS·DETAIL_PRECOMPUTED_191·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·FULL_TEST_1718_PASS·FABLE_AGREE·GROK_AGREE·P0_0·P1_0·AUTOMATED_THREE_SLOT_DELIVERY_NOT_PROVEN·LOCAL_ONLY·LIVE_UNCHANGED.

### NH90 발행 전 단일 선별 파이프라인과 균형 편성 (2026-08-27)

#### 목표와 변경 경계

NH89의 슬롯 고정판, 정확 합집합, 사건별 고정 콘텐츠, 직접 언론사 우선, 요청 중 작업 0을
그대로 보존한다. NH90은 새 화면이나 새 프레임워크를 만드는 작업이 아니다. 수집된 전체 풀에서
사건을 만들고, 분야를 판정하고, 중요도를 매기고, 분야별 13~14건을 배정하고, 상세를 준비하는
**발행 전 단일 경로**를 정본으로 만든다. GET은 완성된 판의 교집합 필터만 수행한다.

#### 단일 데이터 흐름

1. 슬롯별 수집 종료 시각을 판의 `asOf`로 사용한다. 런치판을 오후에 수집해 놓고 정오로 잘라
   국내 기사를 버리는 식의 시각 혼합을 금지한다.
2. Google News 중계는 가능한 경우 직접 언론사 URL과 운영주체로 해소한다.
3. 뉴스·커뮤니티·딜을 먼저 구분한다. 세 종류는 같은 인기 점수를 공유하지 않는다.
4. 분야 라우팅 전에 전체 유효 풀을 사건 단위로 묶는다. 분야 판정에서 보류된 기사도 같은 사건의
   근거·출처로 남으며, 대표 카드 후보만 보류된다.
5. 기사 의미를 기준으로 복수 분야를 승인한다. 전문 피드의 분야는 강한 prior일 뿐이고,
   종합뉴스 기사도 기술·자동차·과학·게임·문화 등 실제 내용에 맞게 들어갈 수 있다.
6. 중요도 점수는 한 번만 계산한다. 기존 `selection-axes`와 shadow 점수 재료를 재사용하되,
   shadow의 8~12건 동적 물량 선택은 사용하지 않는다.
7. 최종 배정기 한 곳만 분야별 13~14건, 운영주체 다양성, 국내외 soft band, 해외 주요뉴스
   reserve와 예외 영수증을 소유한다.
8. 최종 선택된 사건만 제목·사진·출처·한국어 요약을 준비한다. 같은 근거 지문은 캐시하며
   새 기사나 근거가 바뀐 사건만 모델을 호출한다.
9. 아침·런치·이브닝을 각각 불변 파일로 쓰고 검증을 통과한 뒤 포인터를 원자 교체한다.
10. `/api/today`와 Today 화면은 저장된 판을 읽고 선택 분야로 필터링만 한다.

#### 분야 편성 계약

- 각 선택 분야는 목표 14건, 최소 13건이다. 관련 없는 글로 숫자를 채우지 않는다.
- 여러 분야 선택 결과는 각 단독 lane의 정확한 사건 합집합이며 같은 사건은 한 번만 보인다.
- 같은 사건의 제목·사진·출처·요약·최초 발행시각은 선택 분야와 무관하게 동일하다.
- 운영주체는 가능한 후보를 한 번씩 사용한 뒤 두 번째 자리를 준다. 넓은 분야는 활성 후보가
  충분할 때 최소 4개 운영주체를 요구한다. 공급이 부족한 날은 거짓 채움 대신 예외 영수증을 남긴다.
- 국내 비중 soft band는 뉴스/시사 50~70%, 경제/비즈니스 50~60%, 정치 80~90%, 기술/IT
  50~70%다. 이는 경직된 삭제 필터가 아니며 명백히 더 중요한 해외 사건은 포함하고
  `importance_override` 이유를 남긴다.
- 커뮤니티는 추천·댓글·확산, 뉴스는 매체 권위·신선도·독립 보도·시장/사회 영향, 딜은 가격·할인·
  판매처 신뢰·신선도로 각각 순위를 매긴다.
- 커뮤니티 선두 카드는 유머/일상·게임·문화/연예·자동차·기술/IT에서만 허용하고, 뉴스/시사·정치·
  경제/비즈니스·부동산·과학에서는 뉴스 사건이 우선한다.
- `전체 필수` 2~4건은 별도 영역이며 개인 분야 13~14건 충족 수에 이중 계산하지 않는다.

#### 상세와 시간 계약

- 카드의 한국어 제목, 대표 사진, 직접 출처 목록, 최초 발행시각, 600~1200자 한국어 요약은
  발행 전에 준비한다. 클릭 시 수집·번역·요약·LLM 호출·파일 쓰기를 하지 않는다.
- 요약은 기준 원문 한 곳을 중심으로 작성하고 다른 독립 출처는 사실 확인과 추가 맥락에만 쓴다.
  여러 출처를 사용한 경우 기준 출처와 전체 출처를 표시한다.
- 인명·수치·시점·인과는 근거 구절과 대조한다. 한 번의 교정 뒤에도 통과하지 못하면 사실을
  만들지 않고 공개 발췌 또는 접근 불가 이유와 직접 링크를 제공한다. `pending`과 `error`는 발행 금지다.
- 최초 발행시각은 원문 국가 시간과 한국 시간을 함께 저장한다.
- 실제 아침·런치·이브닝 세 판과 날짜별 보관이 확인된 뒤 Today 상단에 네이티브 날짜 입력을
  추가한다. 날짜를 바꾸면 존재하는 저장판만 읽고 없는 판을 즉석 생성하지 않는다.

#### 라운드와 완료 기준

1. 시각·근거 보존·분류 선후관계를 실패 테스트로 고정한다.
2. 단일 중요도 점수와 최종 배정기를 연결해 14개 분야 수량·출처·국내외 편성을 검증한다.
3. 고정 카드와 상세 사전 준비, 세 슬롯 파일, 날짜 탐색을 연결한다.
4. 최신 실풀로 후보판을 만들고 14개 단독·대표 복수 조합·상세 즉시 열림을 브라우저에서 확인한다.
5. Claude Fable 5와 Grok 4.6이 각각 READ-ONLY로 반례를 만들고 서로의 반론을 검수한다.
   P0/P1을 공통 뿌리에서 닫은 뒤에만 로컬 실사용 후보를 GO로 판정한다.

완료 증거는 14개 분야의 수량, 정확 합집합, 사건 콘텐츠 drift 0, 분야별 운영주체 분포와 국내외
비중, 해외 주요 사건 포함, 요약 상태, 요청 중 작업 0, 세 슬롯과 날짜 이동, focused·전체 테스트,
데스크톱·모바일 화면이다. 테스트 통과만으로 제품 PASS나 운영 배포를 주장하지 않는다.

현재 상태: 이 절은 Codex·Claude·Grok의 합의 구현 계약이며 실행을 시작했다. NH89 활성판과
라이브는 구현·검수 완료 전까지 유지한다.

truth: NH90_THREE_PARTY_PLAN_LOCKED·NH89_INVARIANTS_PRESERVED·ONE_PREPUBLISH_PIPELINE·FULL_POOL_EVENT_EVIDENCE·SEMANTIC_MULTI_LABEL_ADMISSION·TYPE_AWARE_RANKING·ONE_LANE_ALLOCATOR·SOURCE_DIVERSITY_SOFT_GEO_BANDS·PRECOMPUTED_DETAILS·THREE_SLOT_ARCHIVE·REQUEST_FILTER_ONLY·IMPLEMENTATION_IN_PROGRESS·LIVE_UNCHANGED.

#### NH90.1 독립 적대검수 반영 정정

Claude Fable 5와 Grok 4.6의 독립 검수 결과, 위 방향은 유지하되 구현 순서와 제약 우선순위를
다음처럼 고정한다. 이 정정이 NH90의 실행 정본이며 앞 절과 충돌하면 이 절이 우선한다.

1. **판 날짜·발행 슬롯·수집 종료시각을 분리한다.** 판 키는 `편집 날짜+슬롯`이고, 후보 멤버십과
   해외 주요뉴스 검사는 풀의 `savedAt`을 기준으로 한다. 풀 파일에 이미 들어온 기사를 슬롯의 과거
   발행시각이나 국내 6~7시간/해외 24시간 비대칭 창으로 다시 자르지 않는다. 이브닝 수집이 자정을
   넘겨도 전날 이브닝판 키를 유지한다.
2. **발행 전 전용 경로만 사용한다.** 기존 `/api/today` 생성, 분야별 `briefing()`, carryover,
   shadow의 8~12건 물량 선택은 호출하지 않는다. 저장 풀에서 Google 중계를 직접 원문으로 해소하고,
   제목만 한국어화한 뒤, 성인·위험 행을 제거하고, 전체 풀 사건 묶음을 한 번 만든다.
3. **근거와 카드 자격을 분리한다.** 분야 보류 행은 사건의 독립 출처·근거로 남을 수 있지만 대표
   카드가 될 수 없다. 직접 원문이 있으면 Google 중계는 대표 제목·사진·링크가 될 수 없다.
4. **점수는 사건에 한 번, 배정은 분야별로 독립 수행한다.** 뉴스·커뮤니티·딜은 각자 신호로 점수를
   계산하고 분야별 순위 키로 변환한다. 한 분야의 운영주체 회전이나 국내외 조정이 다른 분야의
   14건을 바꾸지 않는다. 복수 선택은 고정된 단독 lane의 정확 합집합이다.
5. **제약 우선순위는 고정한다.** 의미 승인·관련성(거짓 채움 금지) → 분야 최소 13건 미달 시 후보판
   전체 실패·직전 완성판 유지 → 뉴스/경제/기술 해외 주요언론 최소선 → 분야 안 운영주체 순환과
   가능한 경우 4개 이상 → 국내외 비중은 점수 보정과 감사 영수증. 국내 비율을 맞추려고 낮은 품질
   기사를 넣지 않으며, 비율 미달은 `geo_band_miss`, 운영주체 부족은 `operator_shortfall`로 남긴다.
6. 국내외 비중의 단위는 **대표 카드 언론사의 국가**다. 해외 주요언론 최소선은 사건 멤버 중
   `global_major` 보유 여부로 별도 계산한다. 언어나 번역 여부를 국내외 판정에 쓰지 않는다.
7. 전문 피드 분야는 분류 prior일 뿐 승인 자체가 아니다. 종합뉴스 기사도 의미가 맞으면 여러 분야에
   승인되며, 캐시는 근거 지문이 같은 분류를 재사용하고 신규·변경 기사만 재판정한다. 만료되거나
   혼합된 라우팅 스냅샷은 후보판을 실패시키고 v1로 조용히 후퇴하지 않는다.
8. 상세는 선택된 사건만 발행 전에 준비한다. 접근 가능한 원문은 기존 요약 계약 범위 안에서 한국어로
   정리하고, 실패하면 사실을 만들지 않고 공개 발췌 또는 접근 불가 이유를 즉시 보여준다. `ready`,
   `excerpt_only`, `source_unavailable`은 정직한 종단 상태이고 `pending`·`error`는 활성화 금지다.
9. `전체 필수` 별도 카드 영역은 이번 NH90에서 제외한다. 14개 lane과 정확 합집합을 먼저 완결하고
   이후 별도 제품 결정으로 다룬다.
10. 날짜 입력은 실제 아침·런치·이브닝 저장판이 존재한 뒤 추가한다. 명시한 `날짜+슬롯`이 없으면
    다른 날짜 판으로 조용히 대체하지 않고 `SLOT_CANONICAL_EDITION_UNAVAILABLE`을 반환한다.

완료 순서는 시각·원문·묶음 RED→GREEN, 분야별 배정 RED→GREEN, 세 슬롯과 상세 준비, 실데이터
브라우저 검증, Claude·Grok 상호 반례 검수다. NH89 활성 포인터는 새 후보가 전부 통과할 때까지
유지하며 운영 commit·push·배포는 별도 승인 전까지 하지 않는다.

truth: NH90_1_REVIEW_CORRECTION_LOCKED·CIVIL_DATE_SLOT_IDENTITY·POOL_SAVED_AT_MEMBERSHIP·NO_REWINDOW·PREPUBLISH_ONLY·DIRECT_BEFORE_CLUSTER·TITLE_LOCALIZE_BEFORE_RANK·FULL_POOL_ONE_CLUSTER·EVIDENCE_NOT_LEAD·LANE_LOCAL_ALLOCATE_THEN_FREEZE·CONSTRAINT_ORDER_LOCKED·GEO_TILT_NOT_FILLER·MUST_READ_DEFERRED·EXACT_DATE_SLOT_ONLY·NH89_ACTIVE_PRESERVED·LIVE_UNCHANGED.

#### NH90.2 로컬 후보판 완료 영수증 (2026-08-28)

로컬 이브닝 후보 `SCE-8c830e97df2425ac`를 활성화했다. 정본은
`.nowhot-local/slot-editions/edition-2026-08-27-evening-8c830e97df24.json`이며,
콘텐츠 SHA-256은 `8c830e97df2425ac46c141141a1f83707ae2a2dc9af59aa88ae0d3326c7ba41e`,
파일 SHA-256은 `e7c553bb5eb43b06f8b1d85363d4fe45905cb57f6224da749851631d36ebc3d1`이다.

- 14개 분야는 단독 선택 시 각각 정확히 14건이다. 91개 두 분야 조합은 단독 lane의 사건 ID를
  합친 정확 합집합이며 25~28건이다. 같은 사건의 제목·출처·사진·요약은 선택 조합과 무관하게 같다.
- 분야별 관측 출처는 6~12곳이고, 뉴스/경제/기술의 해외 주요 보도는 각각 7/6/7건이다.
  오늘의유머·자동차 등 한 운영주체 쏠림은 완화됐으나 문화/연예의 단일 운영그룹 4/14는 후속 P2다.
- 상세 상태는 `excerpt_only` 132건, `source_unavailable` 47건, `pending/error` 0건이다.
  직접 언론사 링크가 있으면 Google 뉴스 중계 링크와 대표 이미지는 사용자 화면에 노출하지 않는다.
- API 요청은 저장판 포인터 조회와 분야 필터만 수행한다(`requestWork=filter_only`, `llmCalls=0`).
  데스크톱 분야 전환은 실측 0.29~0.50초, 준비된 상세는 데스크톱 0.31초·390x844 모바일 0.30초에
  로딩/실패 문구 없이 열렸다.
- 화면 날짜는 생성 시각이 아니라 저장판의 `servedDate+servedSlot`을 표시한다. 확인 화면은
  `8월 27일 (목) · 이브닝판`이다.
- focused 266/266, 전체 1,740/1,740, `git diff --check` PASS. Claude Fable 5와 Grok 4.6
  독립 재검수는 모두 `PASS_WITH_LIMITATION`, P0 0/P1 0이다.

이번 완료 범위는 **로컬 이브닝 후보판**이다. 아침·런치·이브닝 세 판의 최신 자동 생성과 날짜별
아카이브 완결, 스테이징, 커밋·푸시·운영 배포는 아직 하지 않았다. 자동차 분야의 관찰된 오분류 1건과
접근 불가 원문 47건은 사실을 만들지 않는 현재 종단을 유지한 채 후속 개선 대상으로 남긴다.

truth: NH90_2_LOCAL_CANDIDATE_GO·SCE_8C830E97DF2425AC_ACTIVE_LOCAL·ALL_14_LANES_14·ALL_91_PAIRS_EXACT_UNION·EVENT_CONTENT_STABLE·DETAILS_PRECOMPUTED_NO_PENDING·REQUEST_FILTER_ONLY·CLAUDE_GROK_P0_0_P1_0·THREE_SLOT_AUTOMATION_PENDING·LIVE_UNCHANGED.

### NH91 슬롯 사전 발행과 최신 로컬 체크포인트 (2026-08-28)

NH90.2의 고정 lane·정확 합집합·사전 준비 상세를 보존하면서 기존 슬롯 빌더를 여러 명시 슬롯에
순서대로 적용하는 `run-slot-canonical-prepublish.mjs`를 추가했다. 새 저장소·새 분류기·요청 중
생성 경로를 만들지 않았다. 각 작업은 `날짜+슬롯+입력 파일 SHA`로 식별하며, 후보를 모두 검증한
뒤 포인터를 한 번에 원자 교체한다. 중간 빌드나 활성화가 실패하면 HOLD 영수증만 남기고 기존
포인터 바이트를 유지한다. 기본 실행은 API 키를 환경에서 제거해 유료 호출을 허용하지 않는다.

현재 로컬 포인터에는 다음 두 판이 준비됐다.

- 런치 `SCE-2c3e84eb5ebea59e`: 181개 사건, 12개 분야 14건, 정치·부동산 13건.
- 이브닝 `SCE-f6548112c651284a`: 192개 사건, 14개 분야 모두 14건.
- 모닝판은 만들지 않았으며 정확한 `2026-08-28+morning` 요청은 한국어 안내와 HTTP 409를 반환한다.
  다른 날짜·슬롯 판으로 조용히 대체하지 않는다.

이브닝판의 14개 단독 분야와 91개 두 분야 조합을 실행 서버에서 전수 대조했다. 모든 조합은 단독
lane의 정확한 사건 합집합이며 중복·누락·잉여·제목/출처/사진/요약/시각 지문 변화가 0이다.
두 분야는 실제 공유 사건 수에 따라 26~28건이고 전 분야 선택은 192건이다. 최초 요청을 포함한
응답은 최대 67.93ms, 평균 7.69ms였고 이후 분야 전환은 포인터 읽기와 교집합 필터만 수행한다.

상세는 이브닝 192건 전부 발행 전에 종단 상태가 고정됐다(`excerpt_only` 134,
`source_unavailable` 58, `pending/generating/error` 0). 클릭 함수에는 네트워크·번역·요약·파일 쓰기가
없고 `/api/today/summary`는 410으로 봉인돼 있다. 판과 요청의 LLM 호출은 0회이며
`summaryBuildMode=free_only`, `requestWork=filter_only`다.

독립 검수에서 발견한 네팔 홍수의 과거 피해 수치 대표 제목과 KITA.NET의 무관한 두 기사 오병합은
공통 사건 경계에서 수리했다. 최신판은 사망자 543명·실종자 1천535명 후속 보도를 대표로 쓰고,
빙하 원인·외교부 대피·신규 호수 보도는 별도 사건이다. 무역협회 달러 예금과 OpenAI/MS 사이버
기사는 별도 사건이며 선택 분야가 바뀌어도 사건 출처 정본은 변하지 않는다.

검증은 focused 148/148, 동시성 단독 6/6, 전체 1,799/1,799, `git diff --check`를 통과했다.
Claude Opus 5와 Cursor Grok 4.6 high의 최신 바이트·실행판 READ-ONLY 재검수는 모두
`PASS_WITH_LIMITATION`, P0 0·P1 0이다.

남은 비차단 경계는 숨기지 않는다. `firstPublishedAt`은 대표 제목 기사의 시각이 아니라 사건 묶음의
가장 이른 `source_feed_timestamp`다. 따라서 화면의 `원문 표기 시각`을 대표 기사 시각으로 읽지
않도록 후속 문구 검토가 필요하다. 런치와 이브닝은 서로 다른 유효 라우팅 스냅샷으로 만들어졌으며,
다음 자동 발행 실행에서는 한 슬롯 입력 정체성과 다일 정시 영수증을 관찰해야 한다. 현재 결과는
**로컬 사전 발행 후보 GO**이며 스케줄러의 실제 모닝·런치·이브닝 정시 운전, 스테이징, push,
운영 배포를 증명하지 않는다.

truth: NH91_LOCAL_PREPUBLISH_CANDIDATE_GO·LUNCH_SCE_2C3E84EB5EBEA59E·EVENING_SCE_F6548112C651284A·MORNING_HONEST_409·MANIFEST_IDEMPOTENT_INPUT_IDENTITY·ATOMIC_MULTI_SLOT_ACTIVATION·ALL_91_PAIRS_EXACT_UNION·CONTENT_DRIFT_0·DETAIL_PRECOMPUTED_192·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·FULL_TEST_1799_PASS·CLAUDE_OPUS5_P0_0_P1_0·GROK46_P0_0_P1_0·SCHEDULE_RUNTIME_NOT_PROVEN·LOCAL_ONLY·LIVE_UNCHANGED.

### NH92 분류·편성 근인 수리 로컬 활성 체크포인트 (2026-08-31)

NH91의 슬롯 정본·분야별 고정 lane·정확 합집합·사전 준비 상세·요청 중 LLM 0회를 그대로
유지하면서, 실제 카드에서 확인된 분야 오분류와 저가치 콘텐츠를 공통 분류·승격 경계에서 수리했다.
선택 분야별 예외를 만들지 않고 모든 승인 분야에 같은 품질 가드를 적용했으며, 딜·채용·운세·일일
사진·참여 모집처럼 오늘판 대표 카드로 부적합한 행은 기존 공통 승격 함수에서 제외했다. 국내외
후보 reserve는 조합 전체가 아니라 각 분야 예산 안에서 계산해 한 분야의 비중 보정이 다른 분야의
14건을 잠식하지 않게 했다.

Google 뉴스의 `아이러브PC방` 기사가 기술로 남던 마지막 사례는 분류 규칙을 더 붙이지 않고 누락된
원 매체 정체성 메타데이터 한 건을 복구해 게임으로 이동시켰다. 해당 등록 행은
`enabled:false`·seed adapter라 직접 수집 소스로 실행되지 않는다. v8 대비 변경된 lane 멤버십은
기술과 게임 각 한 건뿐이며, 다른 12개 분야는 그대로다.

활성 로컬판은 `SCE-e35dc2831e2ac6f1`(콘텐츠 SHA
`e35dc2831e2ac6f10333cc5009320591fdc98fdf48b2e407b3b3466df06da6cf`)이다. 193개 고유
사건으로 14개 분야가 각각 정확히 14건이며 상세는 `excerpt_only 139`,
`source_unavailable 54`, `pending/error 0`이다. 뉴스·경제·기술·정치의 국내 대표 카드 수는
각각 9/8/7/12건이고 해외 주요 보도는 뉴스·경제·기술 각각 5/6/7건이다. 실행 중 유료 API와
LLM 사용은 0회이며 요청 경로는 포인터 읽기와 분야 필터만 수행한다.

focused 209/209, 전체 1,808/1,808, `git diff --check`를 통과했다. Claude Fable 5와 Cursor
Grok 4.6 Extra High가 동일 후보와 전체 변경분을 READ-ONLY로 독립 검수했고 모두
`APPROVE_LOCAL_ACTIVATION`, P0 0·P1 0을 반환했다. 다음 신선한 라우팅 스냅샷에서는 과거
`specialist_registry_default` 827건을 재사용하지 않는 새 정책 결과를 별도 검수해야 하며,
일부 분야의 편집 취향 P2는 제품 운영 관찰 대상으로 남긴다. 이번 반영은 로컬 포인터만 변경했고
commit·push·staging·운영 배포는 하지 않았다.

truth: NH92_LOCAL_ROOTFIX_ACTIVE·SCE_E35DC2831E2AC6F1·ALL_14_LANES_14·ISSUE_COUNT_193·R2_GAMING_ONLY·OTHER_12_LANES_UNCHANGED·PER_CATEGORY_GEO_RESERVE·COMMON_PROMOTION_GUARDS·DETAILS_PRECOMPUTED_NO_PENDING·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·FULL_TEST_1808_PASS·FABLE5_APPROVED_P0_0_P1_0·GROK46_APPROVED_P0_0_P1_0·FRESH_ROUTING_REBUILD_REVIEW_PENDING·LOCAL_ONLY·LIVE_UNCHANGED.

### NH93 중요도 우선 지역성 편성 정합 수리 (2026-08-31)

#### 사용자 규칙

- 해외 기사는 일정 비율을 채우기 위해 넣지 않는다. 한국 이용자에게 실제 파급이 큰
  세계 사건이면 중요도 순위로 선택하고, 그렇지 않으면 0건이어도 정상이다.
- 뉴스·경제·정치·기술의 국내 비중 범위는 사용자에게 자연스러운지 보는 관측값이다.
  낮은 가치의 국내·해외 기사를 넣거나 높은 가치의 기사를 빼는 좌석 쿼터가 아니다.
- 분야당 목표 14건·최소 13건은 유지하되 관련 있는 유효 사건만 사용한다. 13건이 안 되면
  잡기사로 채우지 않고 새 후보판을 실패시켜 직전 완성판을 유지한다.

#### 3자 검토 합의

Codex는 공통 호출 경로를 추적했고, Claude Fable 5는 해외 최소 좌석이 영국 지역 행정·
개인 재무·행사 홍보 같은 저가치 필러를 넣는 반례를 확인했다. Cursor Grok 4.6 xhigh는
좌석만 지우면 연준·한국 시장·외교·재난과 같은 중요 해외 사건까지 빠질 수 있다는 반대
반례를 제시했다. 따라서 두 조건을 같이 잠근다.

1. 최종 lane에서 국내·해외 최소 선발과 `global_major` 건수 미달 예외를 제거한다.
2. 이 제거 전·후에 중요도 상위의 해외 사건은 유지되고 저순위 해외 필러는 강제 삽입되지
   않는지 적대 테스트로 증명한다. 현재 점수가 이 반례를 못 지키면 새 예외 쿼터를
   넣지 않고 기존 `selection-axes`/shadow 중요도 재료를 발행 전 순위에 재사용한다.

후보 풀의 국내·해외 여유분은 최종 출력 쿼터가 아니다. 어느 쪽에서 중요 사건이 나와도
최종 14건을 고를 수 있게 두는 검수용 재료 창이므로 이 라운드에서는 유지한다. 사용자 출력에서는
국적이 좌석을 소유하지 않는다.

#### 수리 경계와 증거

- 수정 소유자는 `buildDigest()`의 분야별 최종 배정과 슬롯 후보 빌더의 해외 주요매체
  관측 검사다. 분류·사건 묶음·제목·사진·출처·요약·성인 게이트·GET 필터는 변경하지 않는다.
- 검증은 `중요 해외 사건 유지`, `저순위 해외 사건 비강제`, `분야 13~14건`, `복수 선택 정확 합집합`,
  `사건 콘텐츠 지문 불변`, `요청 중 LLM 0` 순으로 실행한다.
- 유료 호출 없이 동일 풀을 재생하고 Claude와 Cursor Grok이 서로 반대 위험을 다시 검수한다.
  새 후보가 통과하기 전에는 활성 포인터를 바꾸지 않으며 commit·push·배포를 하지 않는다.

현재 상태: **NH93 계획 잠금·RED 테스트 작성 시작**. NH92 활성 로컬판과 라이브는 변경하지 않았다.

truth: NH93_THREE_PARTY_PLAN_LOCKED·IMPORTANCE_BEFORE_GEO·NO_FOREIGN_MINIMUM_OUTPUT·GEO_BANDS_OBSERVATION_ONLY·CANDIDATE_OPTIONALITY_PRESERVED·NO_FILLER_FOR_13·IMPORTANT_GLOBAL_REGRESSION_GATE·UNPAID_REPLAY_REQUIRED·NH92_ACTIVE_PRESERVED·LIVE_UNCHANGED.

#### NH93.1 근인 수리 실행·반대검수 정정 (2026-08-31)

NH93의 사용자 규칙을 발행 경로 전체에 적용했다. 이 절은 NH90.1 제약 순서 5의
`뉴스/경제/기술 해외 주요언론 최소선`과 위 NH93의 후보 지역 예약 설명을 정정한다.
국내외 비중과 해외 주요매체 수는 관측 영수증이며 후보·최종 지면 어느 단계에서도
국적별 좌석을 예약하지 않는다. 해외 기사는 한국 독자에게 중요한 시장·정책·안보·재난
영향 또는 독립 교차보도 근거가 있을 때 중요도 순위로 남고, 비율을 채우기 위한 기사는 넣지 않는다.

발행 입력은 다음 한 경로로 닫았다.

1. 직접 모델 판정은 `current_model`, 근거 지문이 같은 검증 결과 재사용은
   `prior_exact_hash`, 그 밖의 행은 `withheld`로 기록한다. 출처 기본값·레거시 URL·발행사
   라벨만으로 승인된 행은 정본 슬롯 빌더가 거부한다.
2. 수집 풀 기사 ID, 분류 패킷의 모든 `sourceArticleIds`, 라우팅 스냅샷의 `itemId` 집합이
   정확히 같아야 한다. 스냅샷 밖 전문피드 기사가 `declared_section`으로 끼어드는 경로도
   작업 폴더·요약 호출 전에 실패한다.
3. 전체 풀을 사건으로 묶고 분야를 투영한 뒤 14개 분야가 각각 의미 승인 사건 13건 이상인지
   요약 전에 검사한다. 부족하면 잡기사나 지역 좌석으로 채우지 않고 후보판 전체를 HOLD한다.
4. 재분류가 필요하면 기존 shortlist가 부족 분야와 연결된 미분류 원문만 고르고, 대상이
   적으면 호출 수를 줄이며 다른 분야 기사로 패딩하지 않는다. 자동 유료 반복은 만들지 않는다.
5. Today 후보 생성에서 `CATEGORY_DOMESTIC_SHARE_BANDS` 전달을 제거했다. 중요 해외
   `global_major` 사건의 기존 중요도 가산은 교차보도 또는 한국 독자 파급 신호가 있는
   뉴스·경제·정치·부동산·기술·자동차에만 적용한다.

Claude Fable 5 중간 검수는 모델 근거·shortlist·중요 해외 회귀를 PASS로 보았으나 풀 밖
기사 반례를 놓쳤다. Cursor Grok 4.6 반대검수가 `pool ⊃ packet/routing`과 기술 후보의
지역 예약을 재현했고, Codex가 두 반례를 RED로 고정한 뒤 위 2·5에서 공통 원인을 수리했다.
수리 후 관련 10파일 **234/234**, 전체 **1,811/1,811**, `git diff --check`를 통과했다.

무과금 실데이터 재생은 2,199건 풀을 정확히 결속한 뒤 요약 전에 다음과 같이 정직하게 HOLD했다:
뉴스 6, 자동차 2, 과학 4, 게임 2, 스포츠 0, 문화 7, 유머 5, 정치 9, 부동산 1,
패션 0, 예술 1건. 부족 분야용 미분류 후보 200건은 별도로 선택됐지만 모델 호출·요약 호출은
0회였다. 따라서 **코드 근인 수리는 GREEN, 새 상품판은 신선한 의미 분류 공급 전까지 HOLD**다.
현재 활성 로컬 포인터 `SCE-e35dc2831e2ac6f1`과 라이브는 변경하지 않았다.

truth: NH93_ROOT_GATES_GREEN·POOL_PACKET_ROUTING_EXACT·SEMANTIC_BASIS_REQUIRED·SEMANTIC_LANE_MIN_13·MISSING_LANE_SHORTLIST_NO_PADDING·NO_GEO_SEAT_RESERVATION·IMPORTANT_GLOBAL_CAN_RANK·UNPAID_REPLAY_HOLD·MODEL_CALLS_ZERO·FULL_TEST_1811_PASS·NH92_ACTIVE_PRESERVED·PRODUCT_HOLD·LIVE_UNCHANGED.

#### NH93.2 최종 반례 봉합·3자 재검수 (2026-08-31)

NH93.1 뒤의 Claude·Grok 독립 반대검수에서 발견된 두 경계만 공통 소유자에서
최소 수정했다. `assertSemanticPublicationRouting`은 카테고리 배열의 유무보다
`routingBasis`를 먼저 검사해, 카테고리가 빈 구형·출처 기반 행도 이후 URL 복구로
되살아나기 전에 거부한다. 허용값은 `current_model`, `prior_exact_hash`, 그리고
카테고리가 비어 있는 `withheld`뿐이다.

해외 파급 신호의 공용 사전에서는 국가명 `중국/일본/China/Japan`과 일반 영단어
`rate`를 제거하고 `interest rate(s)`를 명시했다. 따라서 국가명·호텔의 `first-rate`
만으로 해외 주요 기사가 승격되지 않으며 Fed·CPI·GDP·고용·금리·환율·실적·반도체와
주요 기업 신호는 기존처럼 shadow와 실제 Today 중요도 경로가 함께 사용한다.
국내외 최소 비율이나 해외 좌석 예약은 다시 도입하지 않았다.

Codex는 RED 3건을 확인한 뒤 반례 묶음 **106/106**, 관련 회귀 **318/318**, 전체
**1,812/1,812**, `git diff --check` PASS를 확인했다. Claude Fable 5는 출판 근거
게이트와 풀·패킷·라우팅 결속을 **GO(P0 0/P1 0)**, Cursor Grok 4.6 Extra High는
해외 파급 신호와 실제 서빙 무쿼터 경로를 **GO(P0 0/P1 0)**로 재검수했다.
활성 포인터 SHA `0306f9178e33416dc225fa48788ebbffadb26c975230b1a2be8b444a480f57a4`
(`SCE-e35dc2831e2ac6f1`)는 그대로다. 코드 근인은 GREEN이지만 새 실제판은
신선한 의미 분류와 오프라인 결과 검수 전까지 HOLD다.

truth: NH93_FINAL_COUNTEREXAMPLES_GREEN·BASIS_FIRST_FAIL_CLOSED·COUNTRY_NAME_NOT_IMPORTANCE·GENERIC_RATE_NOT_IMPORTANCE·IMPORTANT_GLOBAL_SIGNALS_PRESERVED·NO_GEO_QUOTA·FOCUSED_318_PASS·FULL_TEST_1812_PASS·THREE_PARTY_P0_0_P1_0·ACTIVE_SHA_PRESERVED·PRODUCT_HOLD·LIVE_UNCHANGED.

### NH94 기존 분류 결과의 패킷 고정·요청 경로 단일화 (2026-09-01)

#### 근인과 사용자 규칙

현재 수집 엔진은 이미 소스 성격과 제목 근거를 이용해 커뮤니티·전문 매체·종합 매체 섹션을
서로 다른 강도로 분류한다. 그러나 NH93.2 발행 스냅샷은 모델 판정과 동일 해시 과거 판정만
허용해, 엔진이 계산한 명확한 결과까지 버리고 있었다. 그 뒤 요청 시점 라우터가 URL 경로와
발행사 라벨로 다시 분야를 바꾸면서 같은 사건이 선택 분야에 따라 다른 출처·분야로 보일 수
있는 두 번째 분류 경로도 생겼다. 수집 부족이 아니라 **이미 계산한 결과를 발행 정본에 고정하지
않고 뒤에서 다시 해석한 구조**가 근인이다.

제품 의미는 다음처럼 고정한다.

- `유머/일상`은 혼합 커뮤니티의 일반 일상 글을 담는 의도된 기본 lane이다. 게시판의 등록
  분야를 상속하지 않고 엔진이 더 명확한 분야를 찾지 못한 커뮤니티 글이 여기에 남는 것은
  정상이다.
- 경제·스포츠·연예·기술·과학·자동차·패션·예술·부동산처럼 주제가 명확한 전문 매체는 기존
  엔진의 교정 규칙을 거친 최종 분야를 그대로 쓴다. 단지 홈페이지 피드라는 이유로 전량 LLM에
  보내지 않는다.
- 일반 종합뉴스와 출처 불명확 행만 보류한다. RSS/Atom의 발행사별 category 문자열을 새로
  파싱하거나 매핑하는 시스템은 만들지 않는다.

#### 합의 구현 계약

1. `buildSelectionShadowPacket`은 수집 엔진이 이미 계산한 `article.category`만 읽는다.
   커뮤니티, 전문 뉴스, 일반 `news`가 아닌 종합매체 섹션은 분야 투표권을 갖고, 종합뉴스·딜·
   미등록 소스는 투표하지 않는다.
2. 같은 `evidenceHash` 안에 유효 투표가 하나 이상 있고 모든 유효 투표가 같을 때만
   `deterministic_tier_policy` 제안을 패킷에 저장한다. 유효 투표끼리 충돌하면 대표 기사 한 건의
   값을 고르지 않고 보류한다. 투표권 없는 종합뉴스 형제는 명확한 전문 원문의 투표를 무효화하지
   않는다.
3. 라우팅 우선순위는 `current_model` → 모델에서 나온 동일 해시 과거 판정
   `prior_exact_hash` → **현재 패킷의** `deterministic_tier_policy` → 빈 `withheld`다.
   deterministic 행은 다음 판의 prior로 재사용하지 않고 매 패킷 다시 계산한다.
4. 요청 시점 라우터는 스냅샷 행만 투영한다. URL·발행사 라벨·등록 분야·누락 행·스냅샷 이후
   기사·stale 기사 자체 분야로 재분류하지 않는다. 성인 게이트는 그대로 유지한다.
5. 수집 풀·패킷·라우팅 ID 정확 일치, 분야별 발행 최소 13건, 직전 완성판 유지, 사건별 제목·
   출처·사진·요약 고정, 요청 중 LLM 0회는 변경하지 않는다. 새 후보가 이 검증을 통과해도 이
   라운드에서는 활성 포인터·commit·push·staging·deploy·live를 바꾸지 않는다.

동결 풀 2,199개 기사(분류 대상 2,198)의 실제 패킷 재생 기준선은 deterministic 1,923,
no-vote withheld 275, 유효 투표 충돌 0이다. 대상 수는 예술 75·자동차 86·경제 255·문화 98·
패션 71·게임 85·유머/일상 384·라이프 103·뉴스 59·정치 45·부동산 77·과학 72·스포츠 92·
기술 421이다. 계획 검수 때 적었던 2,022/176은 투표 금지로 합의한 딜 99건을 라이프에 포함한
산술 오류였고, 구현 RED 픽스처와 전체 동결 풀 재생에서 바로잡았다. 이는 공급 가능성 좌표이며
실제 발행 가능성은 사건 묶음·시간창·승격 가드 뒤의 분야별 13건으로 별도 검증한다.

Codex가 전체 경로와 동결 풀을 대조했고, Claude Fable 5와 Cursor Grok 4.6 Extra High가
각각 뉴스룸 분류·대규모 애그리게이터 관점으로 세 차례 반대검수했다. RSS 신규 파서, 요청 시
레지스트리 fallback, 혼합 커뮤니티 과보류를 제거한 최종안에 두 검수자 모두
`CONVERGE_GO`를 반환했다. 현재 상태는 **계획 잠금·RED 반례 테스트 착수**이며 로컬 활성판과
라이브는 변경하지 않았다.

truth: NH94_THREE_PARTY_PLAN_LOCKED·EXISTING_ENGINE_RESULT_REUSED·PACKET_DETERMINISTIC_VOTE·MODEL_ONLY_PRIOR_REUSE·PROJECTION_ONLY_REQUEST_ROUTER·NO_RSS_CATEGORY_SYSTEM·GENERAL_NEWS_WITHHELD·MIXED_COMMUNITY_LANE_PRESERVED·POOL_PACKET_ROUTING_EXACT_REQUIRED·LANE_MIN_13_REQUIRED·REQUEST_LLM_ZERO·ACTIVE_POINTER_UNCHANGED·LOCAL_ONLY·LIVE_UNCHANGED.

#### 구현·검증 종료

위 계약을 새 분류기 없이 기존 네 경계에만 구현했다. 패킷 빌더는 엔진의 최종 분야를 조건부
결정 투표로 저장하고, 라우팅 빌더는 모델·모델 유래 과거 판정·현재 패킷 결정 판정 순서로 한
번만 결론을 낸다. 요청 라우터는 봉인된 결과를 투영만 하며, 슬롯 발행 게이트는
`current_model`·`prior_exact_hash`·`deterministic_tier_policy`·빈 `withheld`만 허용한다.

동결 풀 재생 결과는 풀·패킷·라우팅 기사 ID **2,199/2,199/2,199**, 분류 대상 2,198,
결정 대상 1,923, 보류 275(딜 99 + 일반 종합뉴스 176), 충돌 0이다. 기사 행 기준 승인 수는
같은 사건에 기사 2개가 묶인 한 건 때문에 1,924이고, 대상 기준 1,923과 모순이 아니다. 생성된
비활성 후보 `SCE-5ef1ac07d78811ca`는 고유 사건 195개, 14개 분야 각각 14건, 상세
`source_unavailable` 49·`excerpt_only` 146·pending/error 0이며 `llmUsage: []`,
`activatedFile: null`이다. 활성 포인터 SHA
`0306f9178e33416dc225fa48788ebbffadb26c975230b1a2be8b444a480f57a4`
(`SCE-e35dc2831e2ac6f1`)는 재생 전후 동일하다.

focused **91/91**, 전체 **1,813/1,813**, `git diff --check` PASS다. Claude Fable 5 최종
독립검수는 **GO(P0 0/P1 0)**, Cursor Grok 4.6 Extra High는 기능 **GO**를 반환했다.
Grok의 문서 지연은 본 절로 닫았고, 기사 행/대상 수 구분은 위에 명기했다. 구형 스냅샷 검증용
legacy basis 이름과 미래 `isDeal`-only 소스 가능성은 현재 발행 경로·현재 소스에서 재현되지 않아
호환성 관찰로 남기며 새 분기나 추상화를 추가하지 않는다. 이 결과는 무과금 동결 데이터의 구조
증명이며 새 실제판 활성 승인이 아니다.

truth: NH94_IMPLEMENTED_UNACTIVATED·FROZEN_REPLAY_2199_EXACT·DETERMINISTIC_TARGETS_1923·WITHHELD_275·CONFLICTS_0·CANDIDATE_195·ALL_14_LANES_14·DETAILS_PRECOMPUTED·REQUEST_LLM_ZERO·FULL_TEST_1813_PASS·THREE_PARTY_GO·ACTIVE_SHA_PRESERVED·LOCAL_CANDIDATE_ONLY·LIVE_UNCHANGED.

### NH99 전체 경로 근인 수리·검수본 로컬 활성 (2026-09-01)

#### 해결한 공통 원인

NH99는 상단의 NowHot 실행원칙 v5에 따라 수집→분류→편성→상세→화면을 한 경로로
대조한 뒤 세 공통 경계만 수정했다.

1. 같은 사건의 중복 여부는 최종 화면에 실제 노출되는 출처를 기준으로 공용 판정 함수 한
   곳에서 결정한다. 분야별 후보 단계의 임시 대표 출처로 다시 판정하지 않는다.
2. 복수 분야 선택은 동일 사건을 한 번만 남기고 그 사건의 승인 분야만 합친다. 제목·대표
   출처·사진·발행시각·상세 요약은 선택한 분야와 무관한 고정 카드 정체성을 유지한다.
3. shadow 패킷은 새 분류기나 RSS 매핑을 만들지 않고 기존 수집 엔진이 이미 정한 명확한
   분야와 등록 소스 정책을 재사용한다. 종합뉴스·불명확 행은 기존 보류 경계를 유지한다.

추가로 `AI`라는 공통 단어 하나 때문에 서로 무관한 6개 기사가 한 사건으로 묶이던 반례는
기존 사건 군집의 일반 토큰 집합에 `ai` 한 항목만 추가해 분리했다. 게임 lane에는 실제
위쳐·사이버펑크 기사, 기술 lane에는 영란은행의 AI 금융안정 기사로 각각 정상 대체됐다.

#### 실제 검수 결과

동결 풀 2,241건과 현재 패킷·routing을 결속해 routing 결정 1,913건, 보류 325건을 얻었다.
검수 정본은 `SCE-116a2d55df910888`, SHA
`116a2d55df9108886339bedef78fe6ebda0ad14175d03ebe7ea0cf5e2f1345a0`이다.

- 14개 분야 각각 14건, 전체 고유 카드 193건
- 91개 모든 두 분야 조합 27~28건, 최종 화면 중복 0건
- 상세 193건 전부 사전 종결: `excerpt_only 146`, `source_unavailable 47`, pending/error 0
- 요청 경로 `llmUsage: []`; 14개 단독·91개 조합 HTTP 응답 모두 정확한 합집합
- 실제 브라우저에서 기사 클릭 즉시 사전 준비된 한국어 상세·사진·발행시각·원문 링크 표시,
  클릭 후 요약 생성 API 요청 0
- focused 265/265, 전체 1,821/1,821, `git diff --check` PASS
- Claude Fable 5 제품·편집 검수와 Cursor Grok 4.6 Extra High 구조·회귀 검수 모두
  **로컬 GO**, P0 0

위 정본만 `/Users/hyundonghwang/Documents/NowHot-Local-Dev/.nowhot-local/slot-editions/active.json`
의 `2026-09-01:lunch` 포인터로 원자 활성화했다. 요청 서버는 이 파일을 다시 분류하거나
재요약하지 않고 분야 선택에 따라 고정 카드를 필터링만 한다.

#### 남은 제한과 활성 경계

같은 동결 pool·packet·routing으로 빌더를 다시 실행했을 때 고유 카드 수가 192건과 194건으로
달라지는 **빌드 단계 비결정성**을 새로 발견했다. 원인은 아직 격리하지 않았으므로 두 재빌드본은
검수 정본으로 채택하지 않았고, SHA까지 검수된 193건 산출물을 직접 활성화했다. 따라서 현재
로컬 요청 결과는 고정됐지만, 정시 자동 발행 전에 “검수 후 재빌드”를 금지하고 빌드 재현성의
공통 원인을 별도 봉합해야 한다.

무료 결정 규칙은 시장·한국 파급 신호가 약한 일부 해외 주요뉴스를 보류할 수 있고, 일부 해외
제목의 한국어 표현은 아직 어색하다. 이는 이번 합집합·정체성·사전 상세 근인 수리의 차단 결함은
아니며 다음 편집 품질 라운드에서 실제 사용자 표본으로 다룬다. 새 프레임워크·전량 LLM·지역
쿼터는 추가하지 않았다.

이 활성화는 **로컬 확인판만** 해당한다. 유료 API/model/Keychain 호출, commit, push,
staging, 운영 deploy, live 변경은 하지 않았다.

truth: NH99_REVIEWED_LOCAL_ACTIVE·EXACT_REVIEWED_ARTIFACT_ACTIVATED·ALL_14_LANES_14·ALL_91_PAIRS_27_OR_28·FIXED_CARD_IDENTITY·FINAL_DISPLAY_DUPLICATES_ZERO·DETAILS_PRECOMPUTED·REQUEST_LLM_ZERO·FULL_TEST_1821_PASS·THREE_PARTY_LOCAL_GO·BUILD_REPRODUCIBILITY_P1·LOCAL_ONLY·LIVE_UNCHANGED.

### NH103 캐시·대표 제목 공통 경계와 발행 전 제목 검수 후보 (2026-09-01)

NH99 활성판은 유지한 채 전체 경로에서 두 공통 원인을 수리했다. 첫째, 과거의
`source_unavailable` 캐시는 같은 기사에 뒤늦게 들어온 충분한 피드 발췌보다 앞설 수 없다.
검증된 요약 캐시는 계속 최우선이지만, 본문 미확인 캐시는 새 근거를 가리지 않는다. 둘째,
뉴스 사건의 정본 제목은 기존 `presentationLead.title` 또는 완전한 사건 제목 한 곳에서 정하고,
digest의 별도 표시 제목 분기를 제거했다. 잘린 네팔 제목 반례와 캐시 반례를 회귀 테스트로
고정했다.

무료 번역의 의미 오역은 번역기를 새로 만들지 않고 기존 `preparedHeadline` 경로에 발행 전
사람 검수 오버레이를 붙였다. 오버레이는 현재 `evidenceHash`와 영어 `originalTitle`이 정확히
일치하고, 한국어이며 기존 위험 제목 검사를 통과할 때만 적용된다. 독자용 제목·요약·중요성·
주목 이유·다음 확인은 같은 검수 제목을 쓰되 원래 기계번역과 영어 제목은 감사용 정본에
남는다. 검수 파일 SHA와 적용 건수는 후보 내용 SHA와 별도 영수증에 함께 고정한다.

최종 미활성 후보 `SCE-c43b20a67c92a517`은 194개 사건, 기술 13건·나머지 13개 분야 각
14건이며, NH103 직전 후보와 lane·표시 순서·issue key가 같다. 뉴스는 국내 10·해외 3·혼합 1,
경제는 국내 13·해외 1이고 해외 주요 보도는 뉴스 3·경제 1·기술 7건이다. 상세는
`excerpt_only 144/source_unavailable 50`, `llmUsage []`다. 이란 기사 독자 필드에서는
`거래소/파업` 오역이 0건이며 원문 감사 필드는 보존됐다.

재빌드 사이 공개 페이지 상대시각·사이드바가 바뀌어 5개 `excerpt_only` 본문 조각이 달라진
현상은 선택·카드 키·lane을 바꾸지 않으며 활성화 뒤 후보 SHA에 고정된다. 같은 입력의 완전한
byte 재현은 아직 P2 관찰로 남긴다. focused 회귀와 전체 **1,827/1,827**, `git diff --check`가
통과했고 Claude Fable 5와 Cursor Grok 4.6 Extra High가 각각 편집·구조 관점에서 GO,
P0 0·P1 0으로 합의했다.

현재 로컬 포인터는 계속 `SCE-116a2d55df910888`이며 SHA도 불변이다. 후보 활성화, 유료
API/model/Keychain, commit, push, staging, deploy, live 변경은 하지 않았다.

truth: NH103_ROOTFIX_CANDIDATE_GO·CACHE_UNAVAILABLE_NO_LONGER_MASKS_NEW_EXCERPT·ONE_CANONICAL_HEADLINE_OWNER·EXACT_REVIEWED_HEADLINE_OVERLAY·READER_FIELDS_CONSISTENT·RAW_AUDIT_PRESERVED·CANDIDATE_SCE_C43B20A67C92A517·FULL_TEST_1827_PASS·THREE_PARTY_GO·ACTIVE_POINTER_PRESERVED·LOCAL_UNACTIVATED·LIVE_UNCHANGED.

### NH103 검수 정본 로컬 활성 (2026-09-01)

David 승인에 따라 후보를 다시 빌드하지 않고 검수된 정확한 산출물
`SCE-c43b20a67c92a517`(콘텐츠 SHA
`c43b20a67c92a517a2e14a3c202d490045557cd02a334a48846f53714f38f2c1`)만
`2026-09-01:lunch` 로컬 포인터에 원자 활성화했다. 후보와 활성 파일의 직렬화 SHA는
모두 `5092cad7b74624994a5e52c6585ef7ff3c6ead2776dfbcb4f50f67ce55fce97f`로
byte-identical이고, 갱신된 포인터 파일 SHA는
`9d753887b090f8f60df0fee11ee52a5717c31397c448b0f6265aa42b0fc0fd31`이다.

로컬 4100 실응답에서 14개 단독 분야는 기술 13건·나머지 각 14건, 뉴스+경제는
28건이며 전부 같은 artifact SHA, `slot_canonical_verified`, `filter_only`,
`llmCalls: 0`을 반환했다. 브라우저에는 이란 기사가 `미국과 이란, 한 달간의 소강 뒤
밤사이 공격 주고받아`로 표시되고 상세 창도 요청 중 생성 없이 즉시 열렸다. 활성화 집중
테스트 23/23과 `git diff --check`가 통과했으며 Claude Fable 5 제품 검수와 Cursor Grok
4.6 Extra High 구조 검수도 사후 `GO`, P0 0·P1 0으로 일치했다.

현재 시각 기준 이브닝판은 아직 준비되지 않아 기본 진입에서 정직한 미준비 상태가 보일 수
있고, NYT 단독 이란 기사는 공개 본문을 충분히 읽지 못해 상세가 `source_unavailable`로
표시된다. 둘 다 이번 런치 정본 활성 범위 밖의 P2다. 유료 API/model/Keychain 호출,
commit, push, staging, deploy, live 변경은 하지 않았다.

truth: NH103_REVIEWED_LOCAL_ACTIVE·EXACT_SAVED_ARTIFACT_ACTIVATED·ACTIVE_POINTER_SHA_9D753887·ALL_14_SINGLETONS_13_OR_14·NEWS_BUSINESS_UNION_28·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·IRAN_READER_HEADLINE_CORRECTED·DETAIL_OPENS_PRECOMPUTED·POST_ACTIVATION_THREE_PARTY_GO·P0_0·P1_0·LOCAL_ONLY·LIVE_UNCHANGED.

### NH104 정본 자동 발행 연결·무료 제목 마감 계획 (2026-09-02)

#### 3자 역할과 상호 반박

- Codex 5.6 Sol Ultra는 현재 수집→분류→편성→상세→GET 전체 호출 경로와 실제 구현을 맡는다.
- Claude Fable 5.1 Ultra Code는 장기 운영·제품 편집 관점에서 자동 발행과 독자 품질을 검수한다.
- Cursor Grok 4.6 Extra High는 포인터 원자성·회귀·반례와 비용 경계를 공격 검수한다.

세 검토자는 현재 활성판의 13~14건, 정확 합집합, 선택 분야와 무관한 카드 정체성,
사전 준비 상세, 요청 중 LLM 0회를 유지해야 한다는 데 일치했다. 분야 수 하향과 전 카드
유료 LLM은 근인을 가리지 못하고 비용만 늘리므로 모두 거부했다. Fable의 수동 검수 의존
자동화 제안은 검수 오버레이가 선택 입력이라는 현재 코드와 맞지 않아 채택하지 않았고,
Grok의 구조 결론은 제품 의미와 대조해 아래 세 경계로 좁혔다.

#### 합의된 최소 실행

1. 정본 모드가 구형 재고 스케줄러를 끄면서 새 정본 빌더를 연결하지 않은 단절을 수리한다.
   기존 `run-slot-canonical-prepublish.mjs`가 현재 풀에서 패킷·라우팅을 준비하고 기존 후보
   빌더와 원자 포인터 활성화를 그대로 호출한다. 새 프레임워크와 별도 발행 엔진은 만들지 않는다.
2. 서버의 로컬 정본 모드에서만 기동 후와 5분 점검 때 위 한 경로를 호출한다. 동시 실행은
   한 번으로 제한하고, 풀 시간창·13건·상세 준비·입력 SHA 중 하나라도 실패하면 HOLD 영수증만
   남기며 활성 포인터는 바꾸지 않는다. 요청 핸들러는 계속 파일 필터만 수행한다.
3. 외국어 제목은 이미 존재하는 무료 번역기를 약한 제목의 발행 전 2차 마감에도 재사용한다.
   유료 Anthropic은 명시 승인 없이는 환경에서 제거하며 이번 실행에서는 호출하지 않는다.

검증은 먼저 실패 테스트를 만든 뒤 `현재 슬롯 1회 완주`, `다음 정시 자동 호출`, `실패 시
포인터 byte 불변`, `14개 분야 13~14건`, `91개 복수 선택 정확 합집합`, `카드 내용 지문 불변`,
`상세 사전 준비`, `요청 중 LLM 0회`를 순서대로 확인한다. 통과 뒤 Fable과 Grok이 같은 현재
바이트와 산출물을 다시 독립 검수한다. 로컬 정본 활성화는 검증 통과 범위 안에서만 허용하고,
commit·push·staging·deploy·live는 별도 승인 전까지 변경하지 않는다.

현재 상태: **NH104 계획 잠금·RED 테스트 착수**.

truth: NH104_THREE_PARTY_PLAN_LOCKED·EXISTING_PREPUBLISH_REUSED·CANONICAL_SCHEDULE_ROOTFIX·FREE_HEADLINE_SECOND_PASS·NO_BLANKET_LLM·NO_CATEGORY_COUNT_REDUCTION·RED_BEFORE_FIX·ATOMIC_POINTER_REQUIRED·LOCAL_ONLY·LIVE_UNCHANGED.

#### 구현·로컬 검증 완료

정본 모드에서 끊겨 있던 자동 발행 연결을 새 엔진 없이 복구했다. 서버의 기존 로컬 점검
주기는 현재 영속 풀을 기존 packet·결정 라우팅·후보 빌더·원자 포인터 경로에 한 번만
전달하며, 동시 실행 가드와 `allowPaid:false`를 유지한다. 다음 발행이 20분 이내면 기존
`nextEditorialSlot` 결과를 사용해 모닝·런치·이브닝판을 발행 전에 준비한다. 이미 완성된
날짜·슬롯은 새 풀의 시간창과 무관하게 먼저 재사용해 불필요한 재빌드와 HOLD 경고를 만들지
않는다. 요청 경로는 계속 활성 포인터를 읽고 선택 분야를 필터링만 한다.

첫 실데이터 실행에서는 기존 무료 번역기의 인자 계약 차이가 쓰기 전에 실패했고 직전 포인터가
보존됐다. 번역기 자체나 유료 폴백을 새로 만들지 않고 호출 옵션을 기존 계약에 맞춘 뒤 같은
경로가 성공했다. 활성 로컬판은 `SCE-55d43713440229e2`(콘텐츠 SHA
`55d43713440229e2a7781415440e45efe2f9e0f2885a321e82df4a849e54d8e1`)이며 고유 사건
195건, 14개 분야 각각 14건이다. 상세는 발행 전에 `excerpt_only 141`,
`source_unavailable 54`로 고정돼 요청 중 생성은 없다.

실서버에서 단독 분야 14개는 모두 14건이고, 91개 모든 2분야 조합은 각 단독 목록의 정확한
집합 합성이며 중복 0·사건 제목/출처/요약/최초발행시각 변화 0이다. 뉴스·경제·기술의 국내/해외
관측은 각각 10/4, 11/3, 7/7이고 해외 주요 보도는 4/3/7건이다. 뉴스에는 Guardian·BBC·NYT,
경제에는 CNBC·MarketWatch가 실제 선택 카드로 확인됐다. 실응답은
`slot_canonical_verified`, `requestWork:filter_only`, `llmCalls:0`이다.

사전 발행과 서버 집중 회귀 36/36, 전체 1,833/1,833, `git diff --check`를 통과했다.
Claude Fable 5.1 Ultra Code 재검수는 시간 경계 수정 뒤 P0 0·P1 0으로 판정했다. 실제
Cursor Grok 4.6 Extra High의 현재 바이트 독립 재검수도 LOCAL GO·P0 0·P1 0으로 판정했다.
18:40 이브닝 선행 생성과 19:00 자동 전환은 아직 시각이 오지 않아 코드 결함이 아닌 시간대별
운영 증거로 남긴다. 유료 API/model/Keychain, commit, push, staging, deploy, live 변경은 0이다.

truth: NH104_LOCAL_AUTOPUBLISH_WIRED·PREPUBLISH_20M·ACTIVE_SLOT_SHORT_CIRCUIT·SCE_55D43713440229E2·ALL_14_LANES_14·ISSUE_COUNT_195·ALL_91_PAIRS_EXACT_UNION·FIXED_CARD_CONTENT·FOREIGN_MAJOR_NEWS_4_BUSINESS_3_TECH_7·DETAILS_PRECOMPUTED·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·FULL_TEST_1833_PASS·FABLE51_P0_0_P1_0·GROK46_P0_0_P1_0·EVENING_CLOCK_OBSERVATION_PENDING·LOCAL_ONLY·LIVE_UNCHANGED.

### NH105 AdFit Web SDK 신규 도메인 전환 (2026-09-02)

공식 AdFit Web 가이드의 SDK 주소는
`https://t1.kakaocdn.net/kas/static/ba.min.js`다. 서버 렌더 경로와 보조 클라이언트
경로는 이미 신규 주소였지만, 실제 피드 렌더 뒤 호출되는 `ensureAdfitPlacement()` 한 곳만
구 주소 `t1.daumcdn.net`을 사용하고 있었다. 해당 한 줄을 공식 HTTPS 주소로 통일하고,
배포 HTML에 구 SDK 주소가 다시 들어오면 실패하는 회귀 테스트를 추가했다.

RED에서 구 주소를 실측한 뒤 GREEN으로 전환했고 광고 회귀 93/93과 `git diff --check`가
통과했다. 로컬 `/live`와 `/index.html` 응답은 구 주소 0·신규 주소 1이다. 광고 단위,
배치, 폴백, 수익 로직은 변경하지 않았으며 commit·push·staging·deploy·live 변경은 0이다.

truth: NH105_ADFIT_SDK_DOMAIN_MIGRATED·OFFICIAL_KAKAO_SDK_CDN_HTTPS_ONLY·OLD_DAUMCDN_SDK_ZERO·MONETIZE_TEST_93_PASS·LOCAL_ONLY·LIVE_UNCHANGED.

### NH106 분야 의미 경계·동일 사건 중복 최소 수리 계획 (2026-09-02)

현재 활성판의 분야별 14건, 복수 선택 정확 합집합, 카드 정체성 고정, 상세 사전 준비,
요청 중 LLM 0회는 변경 금지 기준선으로 잠근다. 활성 실데이터와 Codex·Claude Fable
5.1 Ultra Code·Cursor Grok 4.6 Extra High의 상호 검수에서 재현된 결함만 고친다.

1. 혼합 커뮤니티는 제목만으로 불명확할 때 이미 수집된 짧은 요약도 기존 확정 분류기에
   함께 제공한다. 배우 결혼 보도를 유머로 남기는 문제를 별도 모델 없이 해결한다.
2. 종합 성격의 분야 피드가 명백한 사건·세계정세 보도를 IT로 선언한 경우 기존 문맥
   가드로 뉴스에 돌린다. 전역 임계·소스 라벨·정상 IT/게임 인접 기사는 건드리지 않는다.
3. 같은 사건의 보도와 커뮤니티 전재가 숫자 표현만 달라 중복된 경우에 한해, 서로 다른
   역할·핵심 개념 3개 이상·24시간 이내 조건으로 최종 화면에서 한 장으로 합친다.
4. 자동 교정이 `스포츠`를 선택할 때만 스포츠 전용어가 하나 이상 있어야 통과시킨다.
   메디포스트 인사처럼 근거 없는 스포츠 오분류를 분류 단계에서 막고, 다른 분야의 정상
   자동 교정과 단일 기사·복수분야 승계는 그대로 유지한다.

실패 테스트를 먼저 만들고 집중·전체 회귀 뒤 새 후보만 생성한다. 14개 단독 분야와 91개
복수 조합, 정체성 고정, 상세 준비, 국내외 주요 매체 유지, 요청 중 LLM 0회를 통과한
후에만 로컬 포인터를 바꾼다. commit·push·staging·deploy·live는 별도 확정 전까지 금지한다.

truth: NH106_PLAN_LOCKED·THREE_PARTY_ROOT_CAUSE_CONSENSUS·PRESERVE_CURRENT_WINS·THREE_REPRODUCED_BOUNDARIES_ONLY·NO_GLOBAL_THRESHOLD_CHANGE·NO_NEW_LLM·RED_BEFORE_FIX·LOCAL_CANDIDATE_FIRST·LIVE_UNCHANGED.

#### 구현·3자 검수·로컬 활성 완료

실제 남은 오분류는 전역 임계나 새 필터 문제가 아니라, 조선비즈의
`/entertainment/` 기사와 Google 연예 묶음이 집계 소스의 기본값·약한 무근거 추론으로
IT에 덮어써지던 한 경계였다. 기존 분류기와 출처 설정만 최소 수정해 연예 URL은
문화/연예로 확정하고 `gnews-ent`만 선언된 연예 섹션을 유지하게 했다. 다른 Google
분야 피드와 `gnews-biz`의 정상 의미 교정은 그대로 보존했다. Today/v1 수집 경로와
슬롯 정본 준비 경로가 같은 결론을 쓰도록 두 기존 호출 지점에 동일 설정을 연결했다.

최종 로컬판은 `SCE-cd956b3b20ab2eb1`(콘텐츠 SHA
`cd956b3b20ab2eb126c05a39036c645fc3dae5063bfda020c5fef83d1b3dc6d2`)이며 193개
고유 사건, 14개 분야 각각 14건, 91개 모든 두 분야 조합 27~28건이다. 문제가 된
`차희, '메이드 인 코리아 2' 기대하세요`는 IT 목록에서 제거됐고 Apple Maps의
뉴스+기술 복수 분류 등 정상 장점은 유지됐다. 상세 193건은 발행 전
`excerpt_only 136/source_unavailable 57`로 종결돼 pending·failed 0이며 사용자 요청은
계속 파일 필터만 수행하고 `llmUsage: []`다.

최종 릴리스 후보에서는 화면에 직접 보도 한 곳만 남았는데도 집계 피드 때문에 복수
출처로 설명되던 OpenAI·Blue Origin 두 장의 출처 설명도 같은 화면 근거에서 다시
계산하도록 바로잡았다. 기사 선정·제목·사진·출처·요약·분야·순서는 바꾸지 않았다.

집중 회귀 282/282, 전체 1,845/1,845, baseline lock check와 `git diff --check`가
통과했다. Claude Fable 5.1 Ultra Code는 제품·편집 관점, Cursor Grok 4.6 Extra High는
구조·회귀 관점에서 각각 PASS(P0 0/P1 0)했으며 Codex가 실제 브라우저에서 IT 14건과
문제 기사 제거, 준비된 상세의 즉시 표시를 재확인했다. 로컬 포인터만 이 검수본으로
전환했고 유료 API/model 호출·commit·push·staging·deploy·운영 변경은 없다.

truth: NH106_LOCAL_REVIEWED_ACTIVE·SCE_CD956B3B20AB2EB1·ALL_14_LANES_14·ALL_91_PAIRS_27_OR_28·ENTERTAINMENT_NOT_TECH·PRESERVED_VALID_MULTI_CATEGORY·SOURCE_COPY_COHERENT·DETAILS_PRECOMPUTED·REQUEST_FILTER_ONLY·LLM_ZERO·FULL_TEST_1845_PASS·THREE_PARTY_P0_0_P1_0·LOCAL_ONLY·LIVE_UNCHANGED.

### NH107 로컬 오늘 진입·서버 응답 복구 (2026-09-03)

David의 `/` 접속이 실시간 skeleton으로 보인 원인은 기본 라우트 변경이 아니었다.
4100 서버가 꺼진 상태에서 SW v141이 모든 navigation 실패를 `/live` 캐시로 대체했다.
재기동 시에는 정시 빌더의 `spawnSync` 때문에 HTTP 전체가 빌드 완료까지 정지했다.

- SW v142: 같은 주소 캐시만 폴백하고 `/live` 셸은 `/live`에만 사용한다. 그 외에는
  503/no-store 연결 오류와 다시 시도를 제공한다. Today도 `/sw.js`를 등록해 갱신받는다.
- 기존 빌더 호출만 비동기 `execFile`로 바꾼다. 명시 인자·키 차단·30분 제한·1MiB
  출력상한·실패 시 이전 포인터 보존은 유지한다. 빌드 중 갱신되는 수집 풀 대신 이미
  해시한 `poolRaw`를 기존 원자 쓰기로 고정해 패킷과 동일한 입력을 전달한다.
- 실행은 Orca 소유 터미널 `term_5342fa45-dc06-46c5-b089-3467a0660f33`에서 유지한다.
  앱 종료·Mac 재부팅 후 자동 기동까지 보장한 것은 아니다.

수정 전 실패 재현 2건, 수정 후 관련 6파일 75/75·diff PASS. Claude Fable 5.1과
Cursor Grok 4.6은 각자 좁은 코드 검수 PASS. Chrome 실제 서버 중지/재시작으로
연결 오류→Today 복구를 확인했고, 9/3 모닝 55건(기본 4분야)과 상세 열기를 확인했다.
직접 요청 측정은 `/` 151ms, health 7ms, Today 경제+기술 49ms(28건)였다.
기사 선정·분류·비율·요약 로직과 어제 검수판 `cd956b3b…dc6d2`는 바꾸지 않았다.

주의: 재기동 시 기존 스케줄러가 9/3 모닝 `SCE-43e8348e2fd334a3`을 생성했다.
192건·14분야 각14·발췌159/원문불가33이며, 이는 새 판 전체의 기사 품질 PASS가 아니다.
부모 프로세스의 짧은 패킷 준비는 그대로다. 이번 완료 범위는 진입·응답 문제이며
유료 모델 호출·commit·push·staging·배포·라이브 변경은 없다.

truth: NH107_LOCAL_ENTRY_FIXED·SAME_ROUTE_OFFLINE_FALLBACK·NONBLOCKING_CHILD_BUILD·FROZEN_POOL_INPUT·FOCUSED_75_PASS·THREE_PARTY_REVIEW_PASS·PRODUCT_COMPLETION_NOT_CLAIMED·LIVE_UNCHANGED.

NH107 실행 영수증: 입력은 로컬 장애 수정 지시로 분류했다. 작업 전 자동 주입 MD는
WRC AGENTS 지침이며, 직접 읽은 문서는 START_HERE·Canonical 13원칙·Wiki Rules·
Enforcement·PMO Live Board·Report Read Index의 해당 절, 이 Blueprint·개발현황,
Superpowers using/systematic-debugging/TDD/verification·wrc-start·Orca CLI다.
이번 전용 파일은 SW·Today HTML·prepublish 실행기와 해당 테스트다. 공유 장부의
무관한 과거 항목 전체는 정독하지 않았다. 적용 규칙은 전체 경로 확인·최소 근본 수정·
3자 견제·기존 기능 보존이다. First Principles 게이트: PASS.
개발현황 반영: NOWHOT-DEVELOPMENT-STATUS-001 / DEVCHG-NOWHOT-20260903-190,
실측·테스트·기록 대조 일치. 금지선 준수: 운영/배포/결제/유료 모델 변경 없음.
David 행동 필요: 없음(기존에 열린 오류 화면은 새로고침 가능). Telegram: 불요.
이익 우선·과잉방어: 사용을 막는 진입·동기 정지만 수리. 하지 않은 일: 전체 품질
재검수, LLM 재요약, 국내외 비율 재조정, 부팅 자동실행, 전체 테스트 재실행.

### NH108 현재 품질 보존형 상세·편성 통합 보완 (2026-09-03)

David 확정 지시: 현재 기사 품질과 구성을 유지하면서 원문 미확인 안내, 지정 분야의
국내외 가이드, Today 번역 버튼, 커뮤니티 상세, 국내 패션 공급을 함께 보완한다.
Codex·Claude Fable 5.1·Cursor Grok 4.6은 계획·구현·검수 단계마다 변경 경계와
반례를 서로 대조한다. 서브에이전트는 독립 파일 범위만 담당한다.

**Goal:** 정상 기사·요약을 보존하며 이미 확보한 내용을 빠짐없이 즉시 제공하고,
명시된 편성 가이드와 국내 패션 공급을 실제 발행 전 경로에 연결한다.
**Architecture:** 수집 → 기존 확정 분류 → 중요도/분야별 편성 → 상세 사전 준비 →
불변 슬롯 파일 → 화면 필터의 기존 경로를 재사용한다. 신규 프레임워크·유료 API·
클릭 시 수집/요약·전체 재분류는 추가하지 않는다.
**Tech Stack:** 기존 Node.js ES modules, node:test, RSS/HTML adapters, 정적 Today UI.
**Spec:** 본 절과 NH106/NH107의 검증된 분류·합집합·고정 상세·서버 응답 계약.

#### 작업 계획표

| 단계 | 책임과 허용 파일 | 구체적 산출물 | 검증과 상태 |
| --- | --- | --- | --- |
| 1 기준선 | Codex: `.nowhot-local/nh108/baseline/` | SCE-43e8348e2fd334a3 판·영수증·포인터 복사. 기존 dirty 변경은 되돌리지 않음 | [x] 기준 파일 보존, 선정·출처·텍스트 비교 기준 확보 |
| 2 본문 정본 | Claude 설계/검수, 한 명의 구현자: `article-summary.js`, 대응 테스트 | `sourceLinks`에 동일 기사에서 확인된 200자 이하 소개문·원제목·공개 사진/시각 전달. 실제 fetch 오류와 부족한 본문/번역 결과 구분. UI에서 원시 출처를 다시 병합하지 않음 | [x] 짧은 소개문/403/사진/정상 요약 보존 RED→GREEN 130/130. 교차검수 후 사이트 자체 소개문은 공통 chrome 판정에서 추가 구분 |
| 3 Today 번역 | Codex UI worker: `public/today.html`, `detail-reading.test.js` | 준비된 해외 원문을 식별해 기존 Live의 PC 안내와 모바일 네이버 앱 연결을 제공. 확인된 오류 문구 매핑. 동일 출처 정본만 사용 | [x] UI 20/20, 실제 Chrome PC·모바일 형태·직접 URL/네이버 딥링크·클릭 상세 API 0 확인. 네이버 앱 자체 실행은 미검증 |
| 4 편성 가이드 | Grok 설계/검수, 전용 구현자: `digest.js`, 대응 테스트 | 명시된 뉴스 50~70%, 경제 50~60%, 기술 50~70%, 정치 80~90% 국내 범위를 적격·유사 중요도 후보의 소프트 편성에 반영. 중요 보도는 비율보다 우선. 미지정 분야 해외 하한 없음 | [x] 실제 14개 발행 접두부·상대 weight 차이 10% 이내. 해외 추가 승격에는 기존 시장 파급 또는 독립 교차보도 근거가 필요하며 대형 매체 이름만으로 승격하지 않음. 관련 76/76 |
| 5 국내 패션 | Grok 소스 조사, Codex 통합: `communities.json`, 필요한 기존 adapter와 테스트 | 공개 RSS/편집 콘텐츠를 실제 확인한 국내 패션 소스부터 연결. 전체 쇼핑 카탈로그·쿠폰 목록 투입 금지. 기존 종합뉴스의 패션 승인 경로 유지 | [x] ELLE 공식 RSS 15개 중 명시 FASHION 4개, 기존 어댑터 section 필터·26/26 검사. 후보판 국내 패션 4/14 |
| 6 후보·통합 | Codex: 기존 슬롯 빌더/테스트, 두 reviewer | 동일 근거의 준비된 성공 상세 재사용, 신규/실패 자료만 발행 전에 준비. 신규 후보와 기준선 비교. 변경은 상세 보완·지정 가이드·패션 공급과 통합 중 입증된 사건 오병합 근인에 한정 | [x] 최종 모닝·점심 각 194건, 성공 상세 158/154건 재사용, 각각 14개 단독+91쌍·동일 사건 출처/상세·pending 0. 기존 자동 점심판의 Broadcom/HPE 오병합은 일반 동사 `beat` 제외 한 곳으로 수리, 실기사 분리·같은 회사 병합 보존 2/2·사건 61/61 |
| 7 로컬 적용 | Codex, Claude/Grok 교차 검수 | 표적 및 전체 회귀, 실제 PC·모바일 화면, 새 후보의 수치와 유지/변경 항목 확인 후 로컬만 적용 | [x] Claude/Grok 정확 후보 로컬 GO, 전체 1,871/1,871·diff PASS. 12:23 KST 모닝/점심 원자 활성, 4100 재시작 후 각 14+91 재검증·실제 Chrome 기본 Today/경제14/상세 API0 확인 |

#### 구현 경계

- 현재 좋아하는 기사들을 잘라 비율 숫자만 맞추지 않는다. 기존 편집 적격성·출처 다양성·
  사건 중복 제거를 유지한 채 지정 분야에만 소프트 가이드를 적용한다. 중요도 차이가
  큰 후보를 대체하는 하드 쿼터는 금지한다. 실제 허용 범위와 적용 지점은 3자 검토로 확정한다.
- 상세는 `articleSummary.sourceLinks`가 출처 정본이다. `eventSources`를 UI에서 다시
  섞어 Google 중계/직접 기사 중복을 재도입하지 않는다. 준비 단계에서 동일 URL/근거에만
  짧은 소개문·사진을 보충하고, 원문 접근 거부를 본문 확보 성공으로 표시하지 않는다.
- 본문 실패가 있어도 이미 준비된 정상 요약을 지우거나 전부 재생성하지 않는다.
  신규 후보의 상세 재사용은 기사/출처 정체성을 검증한 경우에만 허용한다.
- 원문 접근의 public-only/DNS pinning/응답 크기·시간 제한을 유지한다. 로그인·유료벽·
  자동 접근 차단 우회는 하지 않는다. 외부 href/text 이스케이프와 noopener를 유지한다.
- 새 후보를 만들기 전 현재 판·포인터를 보존한다. 포인터는 후보 검수 후 바꾸며,
  현재 판을 수정해 과거 발행 내용을 몰래 재작성하지 않는다.
- commit·push·staging·deploy·운영 변경·유료 콘텐츠 API 호출은 이번 승인에 포함하지 않는다.

상태: 3자 계획 대조·실제 후보 비교·PC/모바일 검증·최종 교차검수 후 정확 후보를
로컬 활성했다. 모닝 `SCE-c1dc3db823640d73`, 점심 `SCE-3613dacdf8c825b5`.
라이브/배포 PASS 아님. 최종 상세와 증거는
`docs/reports/NOWHOT_NH108_LOCAL_INTEGRATION_2026-09-03.md`에 기록한다.
원래 활성판의 원본 입력 풀 SHA는 복원되지 않았으므로 활성판과의 완전 일치를 주장하지 않는다.
효과 비교는 동일 재생 풀 2,243건·동일 routing·동일 관심 RSS로 구/신 digest를 비교했다.
고정 전 스포츠 2건 순위 차이는 실행 사이 Google 관심 신호 변경으로 확인됐고, 관심 RSS를
고정한 `control-selection-fixed.json`/`candidate-selection-fixed.json`에서 해소됐다.
비율 가이드는 강제 배당이 아니다. 최종 모닝은 뉴스 13KR/1F·경제 12KR/2F·기술 8KR/6F·
정치 14KR/0F, 점심은 뉴스 10KR/3F/혼합1·경제 10KR/4F·기술 7KR/7F·정치 14KR/0F다.
일부 분야는 목표 범위 밖이다. 이를 비율 충족이나 제품 전체 PASS로 표현하지 않는다.
두 판 모두 국내 ELLE 패션 4건을 포함한다. 동일 풀/관심 신호의 구 digest 대조군에는
ELLE도 들어 있으므로 대조군과의 동일성은 신규 공급 효과까지 없다는 뜻이 아니다.
모닝 대조군 대비 14개 분야 집합·순서 동일, 점심은 뉴스 순서·기술 1건·경제 오병합 분리만
달라졌고 나머지 11개 분야는 집합·순서 동일했다.
기존 교차언어 Broadcom/브로드컴 중복과 경제·정치 복수 분류 경계 사례는 보고서의 잔여
관찰로 남긴다. 이번의 상세·가이드 보완 완료를 제품 전체 결함 0으로 확대하지 않는다.
truth: NH108_REVIEWED_LOCAL_ACTIVE·ALL_14_LANES_14·ALL_91_PAIRS_VERIFIED·PREPARED_DETAILS_REUSED·BASELINE_PRESERVED·FULL_TEST_1871_PASS·NO_PAID_API·NO_LIVE_CHANGE.

### NH109 알림·뒤로가기·기사 링크 연속성 (2026-09-03)

David 승인: NH108의 기사 구성·분류·요약·고정 판본을 유지하고 반복 알림,
Android 뒤로가기 이탈, 목록에서 내려간 기사의 빈 상세를 함께 수리한다.
Codex 구현, Claude 알림·제품 검수, Cursor Grok 구조·회귀 검수를 교차한다.

| 단계 | 최소 변경 | 상태 |
| --- | --- | --- |
| 1 원인·합의 | 라이브 JS/SW와 로컬 공통 코드 대조, 읽음/발송·history·48h 풀 만료 재현 | 완료 |
| 2 실패 재현 | 같은 기사 재알림, 콜드 상세 진입, 풀 제외·재시작 이후 링크를 무료 테스트로 고정 | 완료 |
| 3 공통 수정 | 성공 발송/열람 이력, 앱 소유 목록→상세 history, 기존 저장 패턴으로 공개 발췌 영속 조회 | 완료: 로컬 코드 |
| 4 통합 검수 | 기존 창/새 창·원문 왕복·목록 위치·Today·오래된 링크·조회 장애·기존 토픽/관리자 제한 | 완료: 집중 45/45, 실제 Chrome SW 현재/구페이지, PC/모바일 에뮬 |
| 5 결과 대조 | Claude/Grok 실제 diff 공격 검수, 로컬 실행과 배포 상태 분리 보고 | 완료: 두 모델 합의, 14:21 KST 로컬 재기동·14:22 화면 재검증 |

일반 알림은 KST 날짜당 최대 3회·성공 발송 간 최소 4시간으로 묶고, 이미 알린 글이나
열어 본 글만 남으면 보내지 않는다. 운영 환경의 예약 간격 변경은 별도 배포 범위다.
Live 응답·알림·공유에 쓰인 공개 기사만 별도 작은 파일에 보관하고, Today는 기존
불변 판본을 그대로 쓴다. 원문 전체·사용자 정보는 보관하지 않고, 기록을 선별 풀에
다시 넣지 않는다. 임의 30일 만료로 링크를 다시 깨뜨리지 않는다.
원문은 같은 창으로 열고 뒤로가기는 상세→보던 목록으로 복원한다. 목록에서의
정상 이탈은 허용하며 외부 앱의 창 닫기까지 통제한다고 약속하지 않는다.
기존 요약·편성 재생성, 유료 API, 실제 푸시, commit/push/운영 배포는 실행하지 않는다.

최종 독립 검수에서 발견한 별칭의 과거 분류 재노출, 보관 글의 홈 목록 재진입,
SSR/RSS 링크 미보관, 의도적으로 비운 영문 발췌 복원을 공통 조회/출력 경계에서 수리했다.
실제 Chrome의 `WindowClient.navigate()`가 상세 A 위에 B를 쌓던 반례도 확인했다.
SW v144는 기존 앱의 이동 처리에 ACK를 먼저 받고, 구페이지가 500ms 안에 응답하지
않을 때만 새 문서를 연다. 현재/구페이지 모두 B→뒤로가기 목록→앞으로가기 B를 확인했다.
전체 검사 결과는 1,905 PASS·실패 0·기존 동시성 파일 180초 시간초과 취소 1이다.
그 파일의 단독 재검사는 6/6 PASS(97.8초)이며 전체 일괄 실행 PASS로 바꿔 기록하지 않는다.
NH108 active 포인터·모닝·점심 SHA-256은 변경 0, 점심 단독 14분야·모든 91쌍과
상세 열기 새 API 0을 재검증했다. 실제 Android 단말·운영 배포는 아직 검증하지 않았다.
상세 근거: `docs/reports/NOWHOT_NH109_CONTINUITY_FIX_2026-09-03.md`.
truth: NH109_LOCAL_APPLIED·ACCEPTED_EDITION_BYTES_UNCHANGED·FOCUSED_45_PASS·REAL_SW_BACK_PASS·THREE_PARTY_REVIEW·NO_PAID_CONTENT_API·NO_REAL_PUSH·NO_COMMIT_OR_DEPLOY.

### NH111 수용판 보존형 기사 정리·유료 소스 제외 (2026-09-04)

David 확정 지시: 현재 마음에 드는 기사 구성과 NH107~109 동작은 유지하고,
검수에서 확인된 잘못된 기사 본문·직함과 유료벽 소스만 한 번에 정리한다.

- 편성을 다시 돌려 고치지 않는다. 현재 검수된 `displayOrder`·`lanes`·
  `routingSnapshot`을 입력으로 삼아 본문 정리 결과만 기존 슬롯 빌더로 다시 봉인한다.
- 사이트별 본문은 공통 추출기에서 정확한 기사 컨테이너를 우선한다. UI 제거는 확인된
  고정 문구와 문장 경계에만 적용하며 쇼핑·로그인 등을 다룬 정상 기사 문장은 보존한다.
- 사람 검수 교정은 `evidenceHash`와 원제목 또는 정확한 `sourceUrl`이 동시에 맞을 때만
  `articleSummary.textKo`에 적용한다. 제목·사진·출처·분류·순서는 바꾸지 않는다.
- 신규 유료벽 전용 소스는 수집하지 않는다. MarketWatch Top Stories는 비활성화하되
  과거에 노출한 기사 permalink/archive는 깨뜨리지 않는다.
- Today 요청은 발행 전 완성된 슬롯 파일을 필터링만 한다. 스테이징도 실제 로컬과 같은
  슬롯 정본 플래그를 기본값으로 사용하되 예약 사전발행은 끈다. 클릭 시
  수집·번역·요약·LLM을 호출하지 않고 스테이징도 검수된 포인터를 바꾸지 않는다.

최종 로컬판 `SCE-0b991485de03a38a`는 고유 사건 195개, 14개 분야 각 14건,
91개 두 분야 조합 27~28건의 정확 합집합이다. 기준 검수판 대비 24건의
`articleSummary.textKo`만 바뀌었고 제목·출처·사진·분류·순서 변화는 0이다.
MarketWatch 노출과 확인된 UI 잔재는 0, `llmUsage []`다. 전체 테스트는
1,920건 중 1,911 PASS·실패 0·브라우저 환경 SKIP 9이며 실제 Chrome 9/9가 통과했다.
무과금 스테이징은 오늘판 제품 검사를 모두 통과했고 홈 응답은 4ms였다. 로컬에 없는
쿠팡 운영 자격증명 한 항목만 미검증(exit 2)이며 이를 전체 스테이징 PASS로 표현하지 않는다.
Claude와 Cursor Grok의 독립 공격 검수는 모두 GO(P0/P1 0)다. 라이브·push·deploy는 별도다.
상세: `docs/reports/NOWHOT_NH111_FINAL_LOCAL_RELEASE_2026-09-04.md`.
truth: NH111_LOCAL_FINAL_ACTIVE·ACCEPTED_SELECTION_PRESERVED·ARTICLE_TEXT_ONLY_REPAIR·PAYWALL_NEW_INGEST_DISABLED·ALL_14_LANES_14·ALL_91_PAIRS_EXACT_UNION·REQUEST_FILTER_ONLY·REQUEST_LLM_ZERO·FULL_TEST_NO_FAILURE·CHROME_9_PASS·STAGING_PRODUCT_PASS_AD_CREDENTIAL_UNVERIFIED·LIVE_UNCHANGED.

### NH112 대규모 업데이트 안내·튜토리얼·검수판 배포 (2026-09-04)

David 배포 승인: NH111의 검수된 기사 선택·순서·출처·사진·요약을 그대로 운영에
옮기고, 새 이용자 사용법과 기존 이용자 업데이트 소식을 Today/Live 공용 안내로 제공한다.

- 새 이용자는 Today와 Live의 차이, 관심 분야 선택, 기사 상세·원문 이동을 한 번만 본다.
  기존 이용자는 아직 보지 않은 최신 업데이트만 한 번 본다. 두 화면은 기존
  `feed_onboarded_v1`·`feed_seen_release` 저장값을 공유한다.
- 상세·알림 딥링크를 안내가 가리지 않는다. 목록에서 뜬 안내는 브라우저/Android
  뒤로가기로 닫히며 목록에 남는다. 안내 위에서 상세가 열리면 상세→안내→목록 순서를
  유지하고 기존 history state를 덮어쓰지 않는다.
- 공지는 사용자가 체감하는 변화와 Today/Live 사용법만 보여준다. 새 프레임워크,
  실시간 API 호출, 기사 재편성, 유료 LLM 호출은 추가하지 않는다.
- 운영은 검수 완료 슬롯 포인터 `/data/slot-editions/active.json`만 읽는다. 판본 파일을
  먼저 검증·설치하고 포인터를 마지막에 바꾼다. 장애 시 `NOWHOT_LOCAL_EDITORIAL=0`으로
  기존 홈에 즉시 복귀한다.
- Today에도 기존 광고 로더·단일 표시 슬롯과 검색/심사 메타를 같은 서버 경로로 넣는다.
  Live에는 광고 네트워크 SDK를 직접 싣지 않는다. 기술 준비와 광고 플랫폼 승인은
  서로 다른 사실로 보고한다.

배포 전 전체 `node:test` 1,925/1,925, 실제 Chrome 내비게이션 13/13,
격리 스테이징 102개 소스·2,347건과 제품 점검 전부 PASS다. 로컬 기본판은
`SCE-0b991485de03a38a`, 14개 분야 각 14건, 요청 경로 `filter_only`, LLM 0이다.
운영 반영은 commit·push·VM 판본 seed·compose build 뒤 공개 URL과 헤더로 별도 확인한다.
상세: `docs/reports/NOWHOT_NH112_RELEASE_ONBOARDING_DEPLOY_2026-09-04.md`.
truth: NH112_PREDEPLOY_GO·ACCEPTED_EDITION_PRESERVED·SHARED_ONE_TIME_GUIDE·TODAY_LIVE_HISTORY_PRESERVED·FULL_TEST_1925_PASS·CHROME_13_PASS·STAGING_PASS·NO_PAID_API·LIVE_PENDING.
