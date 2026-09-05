# NOWHOT NH124 Grok 후보 검수 (2026-09-05)

- 작업자: Cursor Grok 4.6 xhigh (Orca 워커 `task_0d2904ae6a7b` / dispatch `ctx_77309d851060`). 읽기 전용. 제품 코드·광역 스위트 없음.
- 범위만: `event-cluster.js`의 `\s+before\s+[^,]+,\s*report claims[.!]?$` 배경절, p30 포함 6행, 도착한 Fable Engadget/TechCrunch 번역 캐시 hunk. 선행 NH124 원인 재조사 없음.
- David 입력 분류: **승인**(런치 오병합·발췌 크롬). 채택 여부만.

## 판정

**GO** — 코드. 블로킹 반례 없음.

제한(PASS로 접지 않음): 새 런치 정본·포인터·운영 대조는 이 워커가 만들지 않았다. Root 소유. 7d306 동결 `textKo`는 이 함수를 다시 타기 전에는 번역 위젯이 그대로다.

## 6행 배경절

`eventEntityTokens`만 꼬리 `\s+before\s+[^,]+,\s*report claims`를 뺀다. `prepareEventArticle`의 `eventKey(title)`·canonical URL·`article.originalTitle`/`title`은 원문 전체다.

독립 확인:

| 쌍 | 결과 |
|---|---|
| BBC × p30 캘리포니아 | `merge: false` `guard_entity_overlap_min` (BBC 토큰 `openai, hijacked, german, website`) |
| BBC × p25 | `merge: true` `openai+german+website` |
| p25 × METR | `merge: false` `guard_entity_overlap_min` |
| Nvidia × 긱뉴스 | `merge: true` `nvidia+huggingface`, 커뮤니티는 반응 축 |

`buildEventClusters` 4묶음: p30 단독 / BBC+p25 / METR 단독 / Nvidia+긱뉴스. 집중 테스트 1/1 PASS.

원문·강한키 보존: BBC `eventKey`에 hugging이 남고, `originalTitle` 필드는 불변.

일반 before/after 비삭제: `before Hugging Face hack`(report claims 없음), `after Hugging Face hack, officials say`, `collapsed before merger, investors say`는 huggingface/before/merger가 토큰에 남는다. `event-cluster.js`의 before 치환은 위 한 줄뿐이다.

의미 반례(진사건이 before 꼬리에만 있는 제목)는 이 6행에 없다. 확장하지 말 것.

## Fable 번역 캐시 hunk

도착함. `enrich.js` 700자 머리:

- 영문 `Add Engadget on Google: Preferred Source Google Discover`
- 한국어 `Google에서? Engadget 추가:? 기본 소스 Google Discover` (`Google에` 포함)
- `Loading the player` / `플레이어 로드 중` + `…`/`...`

집중 테스트(영문+번역 픽스처) PASS. 7d306 실측 3 Engadget + Ternus는 같은 경계에서 본문이 남고, Phys.org `기본 소스로 추가`·본문 `플레이어`는 안 지워진다(선행 발췌 추록과 동일, 재조사 아님).

## 없는 증거

- 이 코드로 다시 얼린 런치 후보 SHA
- 활성 포인터 교체·운영 `/api/today` 대조
- 핵심 190/190·엔진 199/199 재실행(Root 주장, 이번 워커는 위 집중 2테스트만)

## 다음 행동

Root가 동일 입력으로 후보를 다시 만들고, 04번이 p30 / p25+BBC / METR / Nvidia+긱뉴스인지와 번역 위젯 4건이 빠졌는지 확인한 뒤 포인터를 활성화한다.

## WRC 보고

- 읽음: 워커 프리앰블, 현재 `event-cluster.js` 141–148·233–250행, 6행 테스트, `enrich.js` 323–332행, 엔가젯 테스트. 미읽음: 운영 포인터, 새 정본(없음). 산출물: 이 보고서.
- First Principles: PASS. 금지선: 제품 0. 유료 0.
- 이익 우선: 주절(독일 사이트)과 캘리포니아 조사를 가르고, 원제·eventKey·표시는 남긴다. 범용 before 삭제 없음.
- 하지 않은 일: 코드 수정, 광역 테스트, 후보 빌드.
