# NOWHOT NH126 Grok 분류 수리 검수 (2026-09-06)

- 작업자: Cursor Grok 4.6 (Orca 워커 `task_1206ce4ea870` / dispatch `ctx_6d52bc27b7ef`). 읽기 전용. 제품·commit·유료 0.
- 대상: git diff 4파일 — `classify.js` 규칙 1줄, `test/classify.test.js`, `test/selection-d2d.test.js`, `test/fixtures/selection-baseline.lock.json`.
- 제외: Fable enrich/reader. 이전 자체기사 proposal·전체 파이프라인 재조사 없음.
- David 입력 분류: **승인**(독립 수리 검토). 구현 채택은 Root.

## 판정

**GO** — Live `definiteCategory`와 Today `deterministicRoutingVote`가 같은 `BOARD_CATEGORY_RULES` 한 줄을 쓴다. 블로킹 반례 없음.

제한(PASS로 접지 않음): 운영 포인터 재생성·실서비스 분류 대조는 이 워커가 하지 않았다. `/tmp/nh126-routing-proof.json`은 3225행 중 변경 3건의 id만 있고 URL은 없다. `sourceRegistry` 지문 불일치는 이번 diff가 만지지 않은 기존 drift다.

## 한 줄 규칙

```text
chosunbiz  /\/sports\/baseball\//i
        →  /^https?:\/\/biz\.chosun\.com\/sports\//i  → sports
```

구규칙은 야구 경로만, 호스트 비고정. 신규칙은 조선비즈 호스트의 `/sports/` 전부. `definiteCategory`는 URL 규칙을 제목 사전보다 먼저 적용한다 (`classify.js` 729–735행).

## 두 경로

**Live.** `engine._classifyItems`가 매 사이클 `item.category`를 등록값으로 되돌린 뒤 `definite`와 `urlDefinite`(제목 빈 값)를 같은 함수로 계산한다 (`engine.js` 1373, 1397–1402행). `chosunbiz`는 레지스트리 `business`라 `isSectionedNews`가 참이다 (`1360–1363행`). 제목 오버라이드 집합은 auto/gaming/science뿐이라(`92행`) 스포츠는 `urlDefinite === definite`일 때만 섹션 선언을 이긴다. URL 규칙이면 둘 다 `sports`라 통과하고 `item.category`가 바뀐다 (`1417–1431행`). `business`는 `UNTRAINED_CATEGORIES`가 아니다.

**Today.** `deterministicRoutingVote`가 aggregate·비-news 선언이면 `urlCategory`를 그대로 투표한다 (`prepare-selection-shadow.mjs` 72–80행). 단표면 `routingBasis: "deterministic_tier_policy"` (`184–192행`). d2d 픽스처는 `sourceTier: aggregate`, `category: business`.

공통 함수 1곳 → 두 소비처. 새 분류기 없음.

## 증거

| 항목 | 결과 |
|---|---|
| 변경 전 RED (`/tmp/nh126-category-before.log`) | NH126 테스트 2/2 FAIL. `sports_general` URL → `definiteCategory` null, 패킷 `business` |
| 변경 후 로그 (`/tmp/nh126-category-tests.log`) | 122/122 PASS |
| 이 워커 재실행 | `NH126` 이름 패턴 2/2 PASS |
| 풀 증명 | rows 3225, changes 3, 전부 `business`→`sports`, `deterministic_tier_policy`. id: `it_10p9qnf`, `it_1ed2amu`, `it_1t3b4uj` |
| lock | `legacyClassifier` `7c46e93e…`→`8e58faba…`만. `BOARD_CATEGORY_RULES`가 그 지문에 들어 있다 (`freeze-selection-baseline.mjs` 102–104행). `sourceRegistry` `7290afd0…` 불변 |

야구 URL 기존 테스트(`classify.test.js` 231–236행)는 `/sports/baseball/`가 새 `/sports/`에 포함되므로 유지된다.

## 반례 (비블로커)

테스트가 이미 막는 것: `/stock/`, `/sportswear/`, 다른 호스트, 쿼리 `?next=/sports/…`.

이 규칙이 안 고치는 것(기존 경계, 이번 1줄의 실패가 아님):

- `www.biz.chosun.com`·경로 `/sports` (슬래시 없음). 레지스트리 RSS는 `biz.chosun.com` 직접 피드.
- Live만: `topics`에 politics가 있으면 확정 스포츠여도 재분류를 건너뛴다 (`engine.js` 1414행). Today 투표는 topics를 보지 않는다.
- 구글뉴스 중계 URL은 호스트가 달라 이 패턴에 안 걸린다. `chosunbiz` 소스는 직접 RSS.

3건 변경은 구규칙이 못 잡던 행이다. 야구 URL이면 이미 `sports`라 proof `changes`에 안 뜬다.

## 다음

Root가 이 4파일을 채택하면 된다. 광역 스위트·운영 판 재생성·enrich/reader는 이 검수 밖이다.

## WRC 보고

- 읽음: START_HERE, Canonical 13원칙·§11.1, 위키 SoT, 집행 프로토콜 머리, PMO 보드 상단, REPORT_READ_INDEX 상단; 위 4파일 diff; `definiteCategory`/`BOARD_CATEGORY_RULES`; `engine.js` `_classifyItems` 해당 분기; `deterministicRoutingVote`; 지정 tmp 로그·proof. 미읽음: enrich/reader, 운영 포인터, 3225행 원문 URL.
- First Principles 게이트: PASS.
- 금지선: 제품 수정 0, 광역 테스트 0, 유료 0.
- 이익 우선: GO. 한 줄이 두 경로를 고친다. 범용 분류기 확장 없음.
- 개발현황 반영: 해당 없음(검수 전용, 채택 레코드는 Root).
- David 행동: 없음. Telegram: 없음.
- 하지 않은 일: 코드 수정, commit/push, 전체 quality 스캔, 자체기사 제안 재심리.
