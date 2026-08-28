# NowHot 카테고리 선택·표시 합집합 적대검수 2

- 검수일: 2026-08-25 (Asia/Seoul)
- 범위: src/feed/engine.js, editorial-fulfillment.js, selection-contract.js, store.js, server.js, public/today.html 및 실제 호출 의존 파일
- 요청 경로 보정: src/server.js는 존재하지 않아 실제 서빙 파일 src/feed/server.js를 추적했다.
- 변경 범위: 읽기 전용. 소스 코드·테스트·저장 데이터는 수정하지 않았다.

## 독립 결론

**종합 판정: HOLD.** 조합별 저장 세그먼트 키 격리는 PASS지만, “같은 사건의 출처와 콘텐츠는 선택 조합으로 바뀌지 않는다”는 런타임 불변식은 현재 코드에서 깨질 수 있다.

가장 작은 공통 원인은 다음 두 경로다.

1. server.js:801-845의 editionForRequest가 저장 판 응답 때도 engine.canonicalEventSources(continuity.issues)를 asOfMs 없이 호출한다. engine.js:2843-2853의 출처 인덱스는 현재 rolling pool과 현재 시계로 다시 계산되므로, 같은 저장 세그먼트라도 요청 시점·선택 조합에 따라 사건 출처 수가 달라질 수 있다.
2. engine.js:150-184의 출처 병합은 issue.refs[0] 하나를 앵커로 삼고, event-cluster.js:153-195의 내용어 병합은 앵커 기준 비추이적 판정이다. 단일 선택과 복수 선택에서 대표 ref가 달라지면 같은 토큰 사슬의 일부 출처가 한쪽 응답에만 붙을 수 있다.

이 둘이 이란·카카오 스크린샷에서 출처 수가 변한 현상에 대한 공통 설명이다. 요약 상태 변화도 별도 독립 장애라기보다 출처 집합·카테고리 집합·evidenceHash가 조합별로 달라져 서로 다른 요약 캐시/생성 경로를 타는 2차 결과로 설명된다.

## 단일·복수 선택별 개수

### 단일 선택

- editorial-fulfillment.js:20-29의 계약은 분야당 예산 14, 단일 maxIssues=14다.
- engine.js:2927-2965는 maxIssues=14, perCategory=14, 생성 단계 최소치 14를 요청한다.
- 하지만 editorial-fulfillment.js:120-124,126-155의 최종 충족 target은 editorialMinimumPerCategory()가 계산한 1~3건이다. 14건이 아니라 3건만 있어도 categoryFulfillment.goalSatisfied=true가 될 수 있다.
- test/local-editorial-edition.test.js:215-230도 perCategory=14를 확인하면서 실제 이슈는 >=3만 요구한다. 따라서 “분야당 13~14건”은 현재 최종 서빙 불변식이 아니다.
- digest.js:850-874는 additiveCategoryUnion=true일 때 전체 14건까지 후충전하지 않고 fillTarget=balanced.length를 사용한다. 유효·중복제거·소스 제한 후 남은 공급량만 반환한다.

### 복수 선택

- engine.js:2927-2937은 선택 분야 수 N에 대해 maxIssues=14*N(최대 196), additiveCategoryUnion=true를 설정한다.
- digest.js:830-848은 분야별 동적 최소치를 먼저 확보하지만, 최종 합집합은 후보·품질 게이트·중복 병합 후의 남은 사건 수다. 공유 사건은 카드 한 장으로 줄어드는 것이 정상이다.
- editorial-fulfillment.js:36-110은 공유 이슈 한 건을 최종 충족 크레딧 한 분야에만 배정한다. 반면 today.html:513-521은 issue.categoryIds 멤버십을 그대로 세어 분야별 카드 수를 표시한다.
- 따라서 UI의 분야 수, categoryFulfillment.rows.issueCount, 전체 카드 수는 서로 다른 의미다. 합집합 한 번 표시와 분야별 고유 이슈 충족은 동일한 카운터가 아니다.

## 표시 합집합·중복 제거

- selection-contract.js:249-303의 assembleUnion()은 안정 사건 키(id 또는 evidenceHash)로 사건을 합치고 display에 한 번만 넣는다.
- 그러나 selection-contract.js:7-10,26-31의 계약은 runtimeWired:false다. engine.js와 server.js는 assembleUnion()을 호출하지 않는다. category-event-view.js도 runtimeWired:false다.
- 실제 경로는 digest.js의 clusterIssues/근접중복/사건 병합, edition-change.js:305-368의 sameAdditiveEvent, UI의 서버 배열 렌더링으로 나뉜다. 정본 합집합 계약 PASS를 오늘판 런타임 PASS로 읽을 수 없다.
- digest.js:68-88은 정규화 제목·정규 URL 중심 초기 클러스터를 만들고, digest.js:772-784에서 사건 판정 병합을 한다. 이후 edition-change.js:315-345가 다른 휴리스틱으로 다시 합친다.
- 두 판정의 동일성 불변식/테스트가 없다. 초기 digest에서 분야 후보가 14개 바깥으로 밀리면 후단 합집합은 원래 분야별 top-14 후보를 재수집하지 못한다.

### 최소 반례: 비추이적 토큰 사슬

읽기 전용 메모리 입력으로 아래 제목을 넣으면 event-cluster의 동일 스크립트 임계(3개 개념)에서 A-B와 B-C는 병합 가능하지만 A-C는 2개라 직접 병합되지 않는 사슬이 된다.

- A(news): 알파 베타 감마 사건
- B(business): 알파 베타 감마 델타 사건
- C(business): 알파 감마 델타 엡실론 사건

이때 단일 news 요청의 출처 보강은 A를 앵커로 A·B를 얻고, 복수 요청은 대표 ref가 B/C 쪽으로 바뀌어 B·C와 A가 별도 카드 또는 다른 source set으로 나타날 수 있다. 이는 한 사건 한 카드와 같은 사건 출처 집합 불변을 동시에 보장하지 못하는 구조적 반례다.

## 출처·콘텐츠·요약 상태 변화

### 출처 집합

- engine.js:144-147은 후보를 lead와 일대일 decideEventMerge한다. event-cluster.js:169-195의 내용어·숫자·시간 가드는 비추이적이므로 대표가 누구냐에 따라 결과가 달라진다.
- engine.js:2843-2850의 인덱스는 선택 분야 subset이 아니라 전체 현재 유효 풀이다. 사건 출처를 분야 속성이 아닌 사건 속성으로 보정하려는 의도는 맞지만 스냅샷 시점 고정이 없다.
- server.js:819는 저장 스냅샷 응답 때 출처 정본을 다시 실행한다. 저장 카드 배열은 불변이어도 eventSources, eventSourceSetId, UI 원문 링크 수는 현재 풀 변화에 따라 달라질 수 있다.

### 콘텐츠와 요약 캐시

- editorial-lineage.js:75-103,128-161의 evidenceHash 입력에는 categoryIds, sourceEvidence, 측정값이 들어간다.
- article-summary.js:153-159의 캐시 키는 evidenceHash와 계약·프롬프트·모델이다. eventSourceSetId 자체는 키에 없지만 source evidence와 categoryIds가 바뀌면 evidenceHash가 달라진다.
- 단일 선택에서 categoryIds=[news], 복수 선택에서 같은 사건의 source members가 달라져 categoryIds=[news,business] 또는 sourceEvidence가 늘면 서로 다른 요약 키가 생성된다. 한쪽은 ready, 다른 쪽은 source_unavailable·검증 보류가 될 수 있다.
- server.js:688-726의 in-flight dedupe 키도 evidenceHash 하나다. 조합별 evidenceHash가 다르면 같은 사건이어도 요청을 공유하지 않는다.
- today.html:419-449는 ready 요약이 없으면 현재 categories, slot, date, editionId, evidenceHash로 /api/today/summary를 호출하고 오류를 source_unavailable로 표시한다. 배경 warm 완료 여부와 조합별 cache miss도 스크린샷 상태 차이를 만든다.

## edition/segment/store 캐시

### PASS: 조합 키 충돌은 확인되지 않음

- editorial-inventory.js:148-155의 segment key는 snapshot version과 정렬·중복제거한 editionSegmentKey(categories)다.
- server.js:888-903은 날짜·슬롯·segmentKey를 모두 build/read 키로 쓴다. [news,business]와 [news]는 서로 다른 segment다.
- store.js:793-832는 date→slot→segmentKey로 저장하고 최초 snapshot을 보존한다. enrichEditorialEdition()도 같은 editionId·같은 segment만 요약으로 보강한다.
- store.js:973-1005의 과거 호환 fallback은 동일 baseKey(같은 정렬 카테고리 조합) 안에서만 계약 버전을 넘나든다. subset/superset 조합을 서로 재사용하는 코드는 확인되지 않았다.

### HOLD: 캐시 충돌이 아니라 응답 재계산으로 불변성이 샘

- 조합 세그먼트는 분리되어 있지만 editionForRequest()가 매 요청마다 현재 pool 기준 출처 정본을 재계산한다. 정확한 진단은 캐시 map 충돌보다 저장 판 응답 projection의 시간·현재 pool 의존이다.
- server.js:862-887은 현재 슬롯이 정시 시점에 최소 충족에 실패하면 serverNowMs()로 evidence 시점을 늦춰 다시 생성한다. 공급 회복 시점에 따라 같은 조합의 최초 생성 후보가 달라질 수 있다. 의도된 delayed recovery지만 조합 불변성과는 별도 변동 경로다.

## UI 판정

- today.html:608-625는 선택 배열을 categories query로 서버에 보낸다.
- today.html:628-647은 선택 토글마다 저장 POST 후 GET을 순차화한다. 클라이언트는 카드를 자체 중복제거하지 않고 서버 배열을 표시한다.
- today.html:341-368은 issue.categoryIds와 issueSourceLinks()를 그대로 그린다. issueSourceLinks()는 eventSources→summary links/evidence/refs 순서로 URL dedupe한다(today.html:297-310).
- today.html:319-335의 “분야 충족”은 14건이 아니라 동적 fulfillment 최소치 결과다. 사용자가 기대하는 13~14건을 표시·검증하는 UI가 아니다.

## 테스트 증거와 공백

- 실행: node --test test/category-routing.test.js test/editorial-fulfillment.test.js test/local-editorial-edition.test.js test/article-summary.test.js
- 결과: 73 tests, 73 pass, 0 fail.
- 기존 테스트는 유리한 fixture에서 단일/복수 출처 정본 동일성을 확인한다(test/category-routing.test.js:213-265). 그러나 editionForRequest()의 현재 pool 재계산, refs[0] 비추이성, 조합별 evidenceHash, UI 멤버십 카운트와 fulfillment 크레딧 불일치를 검증하지 않는다.
- local-editorial 테스트의 14건·합집합 검증(test/local-editorial-edition.test.js:296-315,368-410,446-502)은 공급이 충분하거나 명시된 fixture에 한정된다.

## 최소 불변식·반례

1. 선택 분야별 top-14 후보를 먼저 독립적으로 고른 뒤 안정 사건 키로 합쳐야 하며 한 사건의 최종 카드는 정확히 1이어야 한다. 총 상한은 14*N이고 공급·품질·중복 손실은 별도 receipt로 드러나야 한다.
2. UI 분야별 숫자는 fulfillment의 한 카드 한 크레딧과 같은 정의를 쓰거나, 멤버십 수와 고유 크레딧 수를 명시적으로 분리해야 한다.
3. 동일 event identity와 동일 slot-as-of라면 선택 조합·요청 순서와 무관하게 eventSourceSetId, eventSources의 ownership group·URL·순서가 같아야 한다. 현재 rolling pool로 재계산하면 안 된다.
4. 같은 사건과 동일 근거의 요약 claim은 선택 조합 때문에 다른 evidenceHash/status가 되면 안 된다. whyForYou 문구를 바꾸더라도 원문 근거·검증 상태는 사건 정본 키로 공유해야 한다.
5. 서로 다른 조합은 snapshot/cache를 공유하지 않고 같은 조합은 정렬·순서·재시작 후 같은 segment를 사용해야 한다. 현재 store segment key는 이 불변식을 대체로 만족한다.
6. admittedCategories가 여러 개면 candidate count도 모든 분야에 계수되어야 한다. edition-candidates.js:151-187은 categoryId:item.category 하나만 기록해 multi-admitted 공급을 한 분야에만 귀속할 수 있다.

최소 반례는 다음과 같다: 공급 3건 단일 분야는 perCategory=14여도 fulfillment target=3으로 충족 가능하다; 공유 카드 categoryIds=[A,B]는 UI A=1/B=1인데 fulfillment unique credit 합계는 1이다; A-B-C 토큰 사슬은 refs[0]에 따라 source set과 카드 수가 달라질 수 있다; 저장 후 새 source가 rolling pool에 들어오면 같은 segment snapshot도 응답 eventSources가 달라질 수 있다.

## WRC 보고 필드

### 작업 시작 전 확인한 MD

- 자동 주입: AGENTS.md 지시, 현재 작업 경로·날짜·권한, Orca worker task preamble.
- 직접 읽음: WRC_MANUS_HANDOFF/START_HERE.md, 00_WRC_OPERATING_SYSTEM_CANONICAL.md, 04_WRC_AI_CONTEXT_WIKI_RULES.md, 05_RULE_ENFORCEMENT_PROTOCOL.md, PMO_LIVE_BOARD.md, REPORT_READ_INDEX.md, 프로젝트 README.md, docs/05, docs/06, docs/08.
- 미읽음/불가: 요청의 src/server.js는 없음; 실제 src/feed/server.js로 대체. 원격 runtime·브라우저 스크린샷 원본·운영 계정 상태는 검증하지 않음.
- 이번 작업 전용 파일: 위 target source와 실제 호출 의존 파일, 관련 테스트.

### 적용한 규칙

- First Principles 13개 전부 적용.
- 소스·테스트·저장 스냅샷·서빙 응답·계정/런타임 증거를 분리.
- A0 read-only 범위를 유지하고 사용자 변경·배포·로그인·외부 알림을 하지 않음.
- 캐시 충돌과 응답 재계산을 구분하고, 단위 테스트 PASS를 런타임 PASS로 확장하지 않음.

### First Principles 게이트

**PASS** - 최종 지시는 범위·대상·읽기 전용 조건이 명확했고 실제 실행 경로와 저장/응답 경계를 분리해 검수했다.

### 금지선 준수

코드 수정, 테스트 수정, 저장 데이터 변경, 서버 재기동, 로그인, 배포, 외부 메시지·Telegram 발송을 하지 않았다. 테스트는 읽기 전용 검증 실행이다.

### David 행동 필요 여부

필요함. 조합별 사건 정본·요약 상태 불변을 PASS로 보고하거나 운영 승인하기 전에 HOLD 원인에 대한 구현 선택과 실제 runtime/브라우저 재현 확인이 필요하다.

### Telegram 알림 필요 여부

불필요. 독립 적대검수 결과 보고이며 외부 알림은 명시되지 않았다.

### 이익 우선·과잉방어 점검

조합별 snapshot 격리, 한 카드 한 번 표시 의도, 공급 부족을 숨기지 않는 fulfillment는 유지해야 한다. 해결을 이유로 카테고리를 제거하거나 모든 출처·요약을 반복 표시하는 방안은 제안하지 않는다.

### 하지 않은 일

- 코드를 수정·리팩터링하지 않음.
- 캐시를 삭제하거나 snapshot을 덮어쓰지 않음.
- 운영 API·계정·원문 접근·발행·수익 결과를 주장하지 않음.
- 단위 테스트 PASS를 실제 스크린샷 원인 확정으로 과장하지 않음.
