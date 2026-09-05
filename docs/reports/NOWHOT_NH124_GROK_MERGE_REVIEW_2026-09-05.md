# NOWHOT NH124 Grok 사건 오병합·제목/출처 불일치 적대 검수 (2026-09-05)

- 작업자: Cursor Grok 4.6 xhigh (Orca 워커 `task_c7cc8f8b895a` / dispatch `ctx_875cac6dcaf0`). 읽기 전용 진단. 제품·테스트 수정, 광역 스위트, 의존성 설치, 커밋, 배포, 광고 클릭, 계정, 유료 호출, 강제 판 생성, 개인 브라우저 없음.
- 대상: 운영 런치 정본 `SCE-c1e006868413a496` 이슈 04 (`EV-77d1dfd59491f364`), 증거 `/tmp/nh123-today.json`, 클러스터링 정본 `src/feed/event-cluster.js`와 호출부.
- David 입력 분류: **승인**(NH123 사건 오병합·제목/출처 불일치 수정). Root가 구현 owner. 이 보고는 원인과 최소 충분 수선만 확정한다. Root 최종 diff 서명 검수는 후속 dispatch.
- 검수 판정: **DEFECT_CONFIRMED**. 권고 수선은 Canonical §11.1 최소 충분. 현재 서빙 정본 바이트는 클러스터 수선만으로 바뀌지 않는다.

## 결론

이슈 04는 “Hugging Face 키워드가 비슷해서 묶였다”가 아니다. **보도 4건이 HEAD `decideEventMerge`에서 전부 쌍으로 병합**되고, 그 위에서 `buildEventClusters`의 all-members 결합이 한 버킷을 만든다. 세 갈래의 실제 이유는 다음과 같다.

1. **Nvidia 인수 ↔ OpenAI/HF 보안 보도**: 동일문자 임계 3을 `entity_overlap:open+hugging+face`가 채운다. `open`은 PC 게이머 원제 “open weight AI”의 토큰이고, `tokenMatch` 접두 비교가 이를 `openai`와 같은 말로 친다. `Hugging`+`Face`는 회사 이름 하나인데 토큰 2개로 센다.
2. **긱뉴스 인수 반응 ↔ PC 게이머**: 한/영 임계 2의 **정당 병합** `nvidia+hugging`. 한국어 제목의 `Face를`은 한글 전용 조사 정규화를 피해 `face`와 안 겹친다.
3. **METR 조사 ↔ DseWiki/BBC**: `openai+hugging+face`에 `agents`/`incident`/`week`/`german`/`website`가 더해져 같은 사건으로 남는다. 인수와는 별개지만, David/Root/Fable이 요구한 3분할을 막으려면 이 약한 토큰을 사건 정체성에서 빼야 한다.

제목·출처 불일치는 **별도 표시 버그**다. 독자 제목은 최신 Techmeme p25(`it_1l1wxbx`)인데, 운영그룹 1URL 정책이 더 이른 Techmeme p17을 남기고 `eventSourceOrder`(이른 시각 우선)가 PC 게이머를 첫 링크로 둔다. p25 URL은 `eventSources`/`sourceLinks`에 없다.

최소 충분 수선은 새 프레임워크가 아니라 기존 G1 패턴 세 곳이다: 라틴 접두 매칭 금지, `Hugging Face`를 토큰 1개로 접기, `incident`/`week`/`agents`를 `EVENT_GENERIC_TOKENS`에 추가. 표시 쪽은 대표 제목 기사의 URL이 운영그룹 중복 제거에서 사라지지 않게 한다.

## 1. 재현 범위와 방법

- 원 증거: `/tmp/nh123-today.json` 이슈 04, `clusterId`/`eventId` `EV-77d1dfd59491f364`, 판 ID `SCE-c1e006868413a496`.
- 코드 정본: 커밋된 `event-cluster.js`를 `/tmp/nh124-repro/event-cluster-head.js`로 분리 import. 워킹트리 미커밋 패치는 대조군으로만 실행했고 채택하지 않았다.
- p25 영문 원제: 서빙 JSON의 `eventSources`에 p25가 없어 `originalTitle`가 비었다. Fable 원문·frozen `mergeHistory`의 `entity_overlap:open+hugging+face`와 맞추기 위해 원제 `Report: OpenAI knew about the DseWiki German website incident weeks ago but kept it under wraps as it grappled with the Hugging Face fallout (Robert Hart/The Verge)`를 넣어 재실행했다. 원제 없이 한국어 표시제목만 쓰면 한/영 임계 2로 `hugging+face`만으로도 합쳐져, 운영 `mergeHistory`와 어긋난다.
- 광역 테스트 스위트는 돌리지 않았다. 진단 스크립트는 `/tmp/nh124-repro/`에만 두었고 저장소에 넣지 않았다.

구성원 5건(서빙 `event.sourceEvidence`):

| id | 매체 | 역할 | 시각(UTC) | 사건 |
|---|---|---|---|---|
| `it_1rkmmd6` | 긱뉴스 | community_reaction | 00:31 | Nvidia → Hugging Face 인수 |
| `it_5p2s6w` | PC 게이머 | reporting | 09:13 | 동일 인수 |
| `it_1pnw8a3` | Techmeme p17 | reporting | 14:30 | OpenAI가 METR의 HF 조사 범위 제한 |
| `it_rtm6ml` | BBC | reporting | 14:59 | OpenAI 에이전트가 독일 사이트 하이재킹 후 HF 해킹 |
| `it_1l1wxbx` | Techmeme p25 | reporting (리드 제목) | 18:52 | OpenAI가 DseWiki를 알고도 HF 낙진 속에 비밀로 유지 |

`eventId`는 가장 이른 기사(긱뉴스) 정규화 키에서 파생된다. `representativeId`는 보도 중 가장 이른 PC 게이머다. 화면 제목은 그보다 늦은 p25다.

## 2. HEAD 쌍 판정 (원제 포함)

`decideEventMerge` 결과. 임계: 동일문자 3, 한/영 2.

| 쌍 | merge | reason | 해석 |
|---|---|---|---|
| 긱뉴스 × PC 게이머 | true | `nvidia+hugging` | 정당. 한/영 2. |
| 긱뉴스 × METR/BBC/p25 | false | `guard_entity_overlap_min` | 반응은 인수에만 붙어야 한다. |
| PC 게이머 × METR | true | **`open+hugging+face`** | 오병합. `open`≡`openai` 접두. |
| PC 게이머 × BBC | true | **`open+hugging+face`** | 동일. |
| PC 게이머 × p25 | true | **`open+hugging+face`** | 동일. frozen history와 일치. |
| METR × BBC | true | `openai+hugging+face+agents` | 같은 HF 보안 계열. 3분할이면 과병합. |
| METR × p25 | true | `openai+hugging+face+incident+week` | 동일. |
| BBC × p25 | true | `openai+german+website+hugging+face+report` | **정당**. 독일 웹사이트+HF 낙진. |

`sharedEventTokens("open model released", "OpenAI product launched")` HEAD는 `["open"]`. 접두 비교가 회사명과 형용사를 같은 근거로 센다.

`buildEventClusters`는 유니온-파인드 사슬이 아니다. 보도 기사가 버킷에 들어가려면 **현재 구성원 전부와** `merge:true`여야 한다. 이 5건은 보도 4쌍이 모두 true라 all-members를 통과한다. digest 주석의 A~B~C 사슬 사고와는 다른 사례다. 긱뉴스만 `oneReportingMatchIsEnough`로 반응 축에 붙는다.

클러스터 시드 순서는 `preparedClusterOrder`(커뮤 후순위, 토큰 많은 제목 우선). 표시용 `eventId`/앵커는 `articleOrder`(이른 발행). 그래서 토큰이 많은 p25/METR이 먼저 묶여도 ID는 긱뉴스에서 나온다.

`eventTitle()`은 일본어·한자 원제가 아니면 `originalTitle`을 쓴다. 영문 원제가 있는 기사는 번역 제목이 아니라 원제로 병합된다. p25를 한국어 표시제목으로만 보면 한/영으로 바뀌어 원인 설명이 틀린다.

## 3. 제목·출처·요약이 갈라지는 경로

호출 순서(오늘판 생성):

1. `engine.js` `_sharedBriefingContext`: `canonicalEvents = buildEventClusters(sourceItems)` 전체 유효 풀 1회.
2. `digest.js` `buildDigest(..., { canonicalEvents })`: `nearIssueGroups`는 같은 `eventId`를 접고, `canonicalEvents`가 있으면 멤버를 다시 합치지 않는다(`mergedEvidenceOf = []`).
3. `engine.js` `attachCanonicalEventSources`: 풀 인덱스에서 사건 멤버를 다시 펼쳐 `eventSources`를 만든다.
4. `article-summary.js` `allSourceRows`: `eventSources`가 있으면 그것만 쓴다. `canonicalSourceRows`가 URL·**운영그룹** 중복을 접고, `maxSourcesPerIssue: 3`.
5. `editorial-reader-copy.js` `readerHeadline`: `preparedHeadline` 없으면 한국어 `subject`(≥6자)를 그대로 쓴다. `readerIssueCopy`가 **90자**에서 잘라 `(Robe…`가 된다.

이슈 04에서 실제로 갈라진 선택 키:

- 리드 제목: `presentationOrder` = 보도 우선·**최신 시각**. `subject`/`refs[0]` = Techmeme p25 `it_1l1wxbx`.
- 운영그룹 대표: HEAD `preferredPresentationMembers`는 그룹당 먼저 본 행을 유지하고, 동률 타이브레이크가 최신을 이기지 못한다. Techmeme은 더 이른 p17이 남는다.
- `eventSources` 나열: HEAD는 `eventSourceOrder`(**이른 시각**). 첫 링크가 PC 게이머 인수 기사.
- 커뮤 반응(긱뉴스)은 보도가 있으면 `eventSources`에서 빠진다.
- 결과 링크 3개: PC 게이머 · Techmeme p17 · BBC. **p25 없음**. 요약 `excerpt_only` 본문은 BBC(DseWiki)라 제목(DseWiki)과 맞고, 첫 링크(Nvidia 인수)와는 맞지 않는다.

즉 제목/출처 불일치는 번역 버그가 아니라 **같은 사건으로 묶인 뒤, 제목 대표와 링크 대표가 다른 정렬·다른 중복 제거를 쓰기 때문**이다. 사건을 3개로 나누면 이 카드에서는 부수적으로 사라진다. 한 사건에 같은 매체 URL이 2개 남는 정당한 후속 보도에는 표시 수선이 따로 필요하다.

## 4. 최소 충분 수선

기존 계약: 오병합은 미병합보다 나쁘다. `EVENT_GENERIC_TOKENS`에 넣는 것은 병합을 줄이는 방향만 허용한다. 라틴 접두 비교를 한글 조사·합성어에만 제한하는 것도 같은 방향이다.

권고 패치 단위(우선순위):

1. **`tokenMatch` 라틴 접두/접미 금지.** `open`/`openai`, `arm`/`harm`을 다른 말로 둔다. 한글만 조사·합성어 비교. 이 한 줄이 Nvidia 인수와 OpenAI 보도의 `open+hugging+face` 다리를 끊는다.
2. **인접 `hugging face` → `huggingface` 1토큰.** 회사명 하나가 임계 3 중 2칸을 채우지 못하게 한다. 한국어 `Hugging Face를`도 여기서 정규화되면 긱뉴스×PC 게이머는 `nvidia+huggingface`로 유지된다.
3. **약한 영문 토큰을 G1 사전에 추가:** `incident(s)`, `week(s)`, `agent(s)`, `report(s)`, `claims`. 한국어 `사건`은 이미 `GENERIC_NEWS_WORDS`에 있다. 이렇게 해야 METR(조사)과 DseWiki/BBC가 `openai+huggingface` 2토큰으로 남고 동일문자 임계 3에 못 미친다.
4. **표시:** `preferredPresentationMembers`가 같은 운영그룹에서 **presentationLead(제목 기사) URL을 버리지 않게** 하고, 링크 순서를 제목 대표와 맞춘다. Techmeme 전용 정규식·`Sources:`→`소식통:` 치환은 이 결함의 근원이 아니며 최소 수선에 넣지 않는다.

digest `canonicalDisplayDuplicate`는 번역 제목 개념 3개로 사건을 다시 붙일 수 있다. 클러스터가 `guard_entity_overlap_min`이면 표시 중복도 false로 두어야 한다. `originalTitle`을 `decideEventMerge`에 넘기는 것은 클러스터와 같은 제목을 쓰기 위한 동반 수정이다.

하지 말 것: 전역 임계 3→4(DeepSeek·네팔 홍수·안나 임신·Twitch 정당 병합을 깨는 방향), Hugging Face 기사 제외, 새 임베딩 계층, 현재 런치 정본 재생성.

## 5. 정당 병합 대조 (positive)

수선 후에도 유지해야 하는 쌍. HEAD 모듈과 워킹트리 대조 스크립트에서 확인한 사실만 적는다.

| 쌍 | 기대 | HEAD | 1+2+3을 적용한 대조 실행 |
|---|---|---|---|
| PC 게이머 × 긱뉴스 (인수) | 병합 | `nvidia+hugging` | `nvidia+huggingface` (한/영 2) |
| BBC × Techmeme p25 (DseWiki) | 병합 | `openai+german+website+hugging+face+report` | `openai+german+website+huggingface` |
| G1-3 Twitch × BBC | 병합 | `twitch+train+amazon+opt+out` | `twitch+amazon+opt+out` |
| 딥시크 한/영 | 병합 | `deepseek+v4+pro` | 동일 |
| 네팔 홍수 수색 두 보도 | 병합 | `nepal+flood+실종자+수색+작업` | 동일 |
| 안나 넷째 임신 두 보도 | 병합 | `안나+넷째+임신` | 동일 |
| METR × DseWiki | 분리 | 병합 | `openai+huggingface` → min 3 미달 |
| Nvidia × DseWiki/METR/BBC | 분리 | `open+hugging+face` | `huggingface`만 → 미달 |

## 6. 정본 판과 이후 슬롯

- 공개 `/api/today`는 `slotCanonicalEditionReader.read` → `projectSlotCanonicalEdition`이다. 저장된 `issueTable`을 분야 필터만 해서 돌려준다. **`buildEventClusters`를 다시 돌리지 않는다.** 지금 서빙 중인 런치 04번 바이트는 코드 수선만으로 바뀌지 않는다. 다음 슬롯 사전 발행(이브닝·다음날)부터 새 묶음이 들어간다.
- `editionForRequest` / 로컬 인벤토리 경로는 `engine.canonicalEventSources`가 살아 있는 풀로 출처를 다시 투영한다. 운영 오늘판 경로가 아니다.
- 사건 분할 후 `factsFingerprint`는 부모(혼합) 지문과 달라진다. 재등장 게이트는 **지문 완전일치**만 막으므로(`shadow-selection.js`), 갈라진 세 사건은 직전 혼합 지문과 같아져 탈락하지 않는다. 계보는 한 계보가 한 사건만 승계하므로 나머지 둘은 새 `lineageId`를 받는다.
- `articleContentId`는 `eventId` 기반이다. 분할되면 요약 캐시 키가 갈라진다. 정본에 이미 박힌 `excerpt_only`는 그 판이 교체될 때까지 유지된다.
- `EVENT_MERGE_RULES.version`을 올리는 것은 표본 계약 표시일 뿐, 서빙 정본을 무효화하지 않는다.

## 7. 워킹트리 관찰 (서명 아님)

이 세션 중 Root가 미커밋으로 `event-cluster.js`·`engine.js`·`digest.js`·`editorial-reader-copy.js`와 테스트 3파일을 고치고 있었다. 원제 포함 실5건에 그 패치를 얹으면 클러스터 3개(인수 / METR / BBC+p25)가 나온다. 방향은 §4와 같다.

최종 서명 전에 볼 점만 남긴다.

- `readerIssueCopy`의 Techmeme 전용 저자 괄호 제거는, 제목 행이 `eventSources`에 있을 때만 동작한다. 현재 정본 04번은 p25가 `eventSources`에 없어 같은 함수를 다시 돌려도 `(Robe…`가 남는다. 클러스터 분리+리드 URL 보존이 본 수선이다.
- 라틴 접두 전면 금지는 `tesla/teslas` 같은 활용형을 더 이상 같은 말로 보지 않는다. 고정 표본 정당 병합 4건은 유지됐으나, 영어 활용형만으로 묶이던 미표본 쌍은 미병합으로 남을 수 있다. 오병합>미병합 계약과 맞다.
- 링크 순서를 최신 우선으로 바꾸는 것은 04번에는 이득이고, 한 사건의 첫 출처가 “최초 보도”에서 “최신 각도”로 바뀌는 전역 효과다. 제목 기사 URL 보존이 더 작은 표시 수선이다.

이 관찰은 Root 최종 diff 검수를 대체하지 않는다.

## 8. 호출부 (수선 영향)

| 위치 | 역할 |
|---|---|
| `src/feed/event-cluster.js` `decideEventMerge` / `buildEventClusters` | 단일 병합 진실 |
| `src/feed/engine.js` `buildEventSourceIndex` · `attachCanonicalEventSources` · `briefing` | 풀 1회 클러스터 + 카드 출처 투영 |
| `src/feed/digest.js` `nearIssueGroups` · `composeEventFromMembers` | 선별 단계 접기. canonicalEvents 있으면 멤버 재합치기 없음 |
| `src/feed/shadow-selection.js` `prepareShadowPool` | 팩 라우팅 전 전체 풀 클러스터·계보 |
| `src/feed/category-event-view.js` | 분야 뷰 클러스터 |
| `src/feed/article-summary.js` `allSourceRows` | 화면 링크 정본 |
| `src/feed/editorial-reader-copy.js` | 독자 제목 90자 |
| `src/feed/slot-canonical-edition.js` | 동결 서빙. 재클러스터 없음 |
| `tools/eval-shadow-edition.mjs` · `eval-source-supply.mjs` | 평가. 제품 서빙 아님 |

## 증거

- `/tmp/nh123-today.json` 이슈 04 `event.mergeHistory` (운영 런치가 남긴 이유 문자열).
- HEAD 재현: `/tmp/nh124-repro/event-cluster-head.js` + `repro2.mjs`. 원제 포함 시 클러스터 1, 이유 `open+hugging+face` / `openai+hugging+face+…`.
- 1+2+3 대조: 같은 5건 클러스터 3, BBC×p25만 보도 병합, 긱뉴스×PC 게이머 유지.
- 코드: `event-cluster.js` `EVENT_MERGE_RULES`·`tokenMatch`·`buildEventClusters` all-members 루프, `engine.js` `presentationOrder` vs `eventSourceOrder`, `article-summary.js` `canonicalSourceRows` 그룹 접기, `editorial-reader-copy.js` `MAX_READER_LENGTH.headline = 90`.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: Cursor 시스템/사용자 규칙, Mem0 훅(키 없음·사용 안 함), Orca 워커 프리앰블.
  - 직접 읽음: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(13원칙 + §11.1), `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`(상단·최소변경·브라우저 격리), `PMO_LIVE_BOARD.md`(상단), `REPORT_READ_INDEX.md`(상단), NH123 Root 통합 검증, NH123 Fable 콘텐츠 검수, `src/feed/event-cluster.js`, `engine.js` 클러스터/출처 투영, `digest.js` `nearIssueGroups`, `article-summary.js` 링크 조립, `editorial-reader-copy.js` 제목, `slot-canonical-edition.js` 서빙, `server.js` `/api/today` 정본 경로, `shadow-selection.js` 재등장 게이트, `/tmp/nh123-today.json` 이슈 04.
  - 미읽음/불가: PMO 보드·색인 하단 과거 이력, 실제 iPhone, 이브닝 미도래 판, 광고 계정, 개인 브라우저.
  - 이번 작업 전용 파일: 이 보고서, `/tmp/nh124-repro/*` (저장소 밖 재현).
- 적용한 규칙: 입력 분류(승인), 13 First Principles, Canonical §11.1, 오병합>미병합, 읽기 전용, Root 구현 소유, 정본 판 무변경, Corridor/유료/광고/계정 금지.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — 검수 보고만. Root 수선 커밋 시 NH123/NH124 레코드에 연결.
- 금지선 준수: 허용 산출물은 이 보고서 1개. 제품·테스트 미수정. 광역 스위트·설치·커밋·배포·광고·계정·유료·강제 발행·개인 브라우저 0.
- David 행동 필요 여부: 없음. Root가 §4대로 패치한 뒤 최종 diff 검수 dispatch.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. HF 보도를 빼지 않고, 인수·DseWiki·METR을 각각 보여 주는 쪽이 독자 가치와 광고 본문 일치에 이득이다. 전역 임계 상향·출처 제거는 과잉이다.
- 하지 않은 일: 제품/테스트 수정, 광역 테스트, 정본 재발행, Root 미커밋 diff 서명, 메모리 쓰기.

권고 다음 행동 1개: Root는 §4 1~4만 구현하고, §5 표를 고정 표본으로 남긴 뒤 이 워커에 최종 diff 검수를 다시 보낸다.
