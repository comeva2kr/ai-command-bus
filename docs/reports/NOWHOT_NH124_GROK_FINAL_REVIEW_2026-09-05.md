# NOWHOT NH124 Grok 최종 diff 검수 (2026-09-05)

- 작업자: Cursor Grok 4.6 xhigh (Orca 워커 `task_7f0f08fc4a81` / dispatch `ctx_32e7453d6266`). 코드 읽기·집중 재현만. 제품·데이터·정본 포인터 미수정. 커밋·배포·광고·계정·유료·브라우저 없음.
- 대상: 현재 워킹트리 diff (`event-cluster.js`, `digest.js`, `engine.js`, `editorial-reader-copy.js`, 집중 테스트 3파일). 선행 원인 보고 `docs/reports/NOWHOT_NH124_GROK_MERGE_REVIEW_2026-09-05.md`.
- David 입력 분류: **승인**(현재 사용자 화면 결함 수리). 이 검수는 구현 채택 여부다.
- 선행 원인: 보도 4건이 `open+hugging+face` 접두 비교와 Hugging Face 2토큰으로 전부 쌍 병합. 제목은 Techmeme p25, 링크는 PC 게이머/p17.

## 판정

**GO** — 코드. 블로킹 버그 없음.

제한(PASS로 접지 않음):

1. 런치 정본 재생성·포인터 활성화 증거는 아직 없다. `/tmp/nh124-input/slot-editions/edition-2026-09-05-lunch-c1e006868413.json`은 기존 혼합 카드 아티팩트다. 입력만 `/tmp/nh124-input/slot-prepublish/2026-09-05-lunch/`에 있다. Root가 동일 입력으로 후보를 만들고 검증·활성화하기 전에는 **서빙 화면 GO가 아니다**.
2. Fable `enrich.js` / `test/enrich.test.js` diff는 **최종 검수 시점에 워킹트리에 없다**(HEAD와 동일, 미커밋 변경 0). 발췌 보일러플레이트는 이번 채택 범위 밖이다.

## 코드가 원인과 맞는지

`/tmp/nh124-event-repro.json` 실제 5행을 현재 모듈로 돌리면 클러스터 3개다.

| 묶음 | 구성 |
|---|---|
| 인수 | PC 게이머 `it_5p2s6w` + 긱뉴스 반응 `it_1rkmmd6` (`nvidia+huggingface`, 한/영 2) |
| DseWiki | BBC `it_rtm6ml` + Techmeme p25 `it_1l1wxbx` (`openai+german+website+huggingface`) |
| METR | Techmeme p17 `it_1pnw8a3` 단독 |

Nvidia×p25·BBC×METR은 `guard_entity_overlap_min`. `open`/`openai` 공유 토큰 0. digest `nearIssueGroups(..., canonicalEvents)`도 3이다. 선행 권고 1~3과 같다.

표시: 같은 운영그룹 안에서는 여전히 canLead → 직접 URL → 한국어판 → 그다음 최신이다. 대표 배열을 `presentationOrder`로 다시 정렬하므로 **그룹 사이** 첫 링크는 최신 보도가 된다. 같은 매체 두 Techmeme URL이면 제목 기사와 링크가 같다. 출처 수는 매체 그룹 수이며, 커뮤니티 반응은 보도가 있으면 링크에 안 넣는다(허커뉴스 픽스처 길이 1).

## 회귀 커버

충분하다. 음/양이 원인 쌍과 맞는다.

- 음: 인수 vs DseWiki vs METR 분리, `open model` vs `OpenAI` 비공유, 번역 제목으로 digest 재병합 금지, 커뮤니티가 두 번째 언론으로 안 잡힘, 같은 매체 링크 수 2(테크밈+BBC).
- 양: 긱뉴스×PC 게이머, BBC×p25, 한국어판>일본어판(동일 발행사), 직접 URL>Google 뉴스 중계, (API/SDK) 내용 괄호 보존.

`/tmp/nh124-baseline-test.log`는 HEAD에서 옛 테스트가 `multiple_feed_observed`로 깨진 기록이다. 레지스트리상 Techmeme은 `kind: news`·`sourceTier: aggregate`인데 픽스처가 `kind: community`로 속였다. 허커뉴스로 바꾼 것은 계약 후퇴가 아니라 픽스처 정정이다.

빠진 전용 테스트: `canLead=false` 행이 제목 대표가 되지 않는다는 단건. 코드는 `selected.filter(canLead)`가 앞이고 `canonicalMembers[0]`이 그 목록의 첫 항이라 구조상 유지된다. 블로킹 아님.

## 선행순위·출처 부풀리기·정규식

- canLead: 그룹 대표 선택과 최종 배열 모두 canLead가 먼저다.
- 직접 URL: 같은 그룹에서 중계보다 앞선다. 기존 중계 접기 테스트 PASS.
- 한국어판: `publisherEditionRank`가 최신보다 앞이라, 같은 조선비즈라도 한국어가 일본어 최신본을 이긴다. 테스트 PASS.
- 출처 부풀리기 없음: 운영그룹 1URL. NH124 표시 테스트 길이 2. 커뮤니티 테스트 길이 1. `eventSourceSetId`는 그룹 정렬 키라 URL이 p17→p25로 바뀌어도 집합 ID가 늘어나지 않는다.
- 정규식: `hugging\s+face`, 라틴+한글 조사, Techmeme 저자 `(Name Name/Outlet)` 모두 상한·앵커가 있어 파국적 백트래킹이 아니다. `(API/SDK)`는 `{1,3}`이 공백+대문자 이름을 요구해서 안 지워진다.

## Fable

없음. `git diff`/`git status` 기준 `src/feed/enrich.js`, `test/enrich.test.js` 변경 0. 이번 GO는 사건 묶음·제목-링크 정합·Techmeme 꼬리 교정에 한정한다.

## 정본 후보

Root가 쓸 입력은 있다. 새 immutable 후보 SHA·포인터 교체 영수증은 없다. 지금 공개 런치 파일은 여전히 `c1e006868413`이다. 코드 GO 이후 Root가 동일 frozen 입력으로 후보 생성 → 검증 → 옛 파일 보존한 채 포인터만 활성화해야 사용자 화면이 바뀐다.

## 하지 않은 일 / 다음 행동

광역 스위트 재실행, 풀 전수, 후보 빌드, 포인터 쓰기, Fable 발췌 검수 없음. Root 주장 190/190·150/150은 그대로 두고, 이 워커는 실제 5행 분할과 집중 테스트 6/6만 독립 재현했다.

다음 행동 1개: Root가 `/tmp/nh124-input/slot-prepublish/2026-09-05-lunch`로 후보를 만들고, 04번이 인수/DseWiki/METR 세 장·p25 링크 포함인지 확인한 뒤 포인터를 활성화한다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: Cursor 규칙, Orca 워커 프리앰블, Mem0 훅(키 없음·미사용).
  - 직접 읽음: Canonical §11.1, WRC review-gate, 선행 NH124 원인 보고, 워킹트리 7파일 diff, `engine.js` 표시 순서, `communities.json` Techmeme/해커뉴스 kind, `/tmp/nh124-event-repro.json`, `/tmp/nh124-baseline-test.log`, `/tmp/nh124-input` 입력·구 아티팩트 헤더.
  - 미읽음/불가: Fable enrich(파일 변경 없음), 아직 없는 새 런치 후보, 운영 VM 활성 포인터 재조회, PMO 보드 하단.
  - 이번 작업 전용: 이 보고서, `/tmp` 재현(저장소 밖).
- 적용한 규칙: 승인, 13원칙, §11.1, 검수 게이트(제한을 PASS로 접지 않음), 읽기 전용, 유료 0.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — 검수 보고. Root 활성화 후 NH124 레코드 연결.
- 금지선 준수: 산출물 이 보고서 1개. 제품·데이터·포인터 0.
- David 행동 필요 여부: 없음.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. 세 사건을 각각 보여 주고 제목 근거 링크를 살린다. 집계 매체 제거·전역 임계 상향 없음.
- 하지 않은 일: 제품 수정, 광역 스위트, 후보 빌드/활성화, Fable 없는 diff 추정, 커밋/배포.
