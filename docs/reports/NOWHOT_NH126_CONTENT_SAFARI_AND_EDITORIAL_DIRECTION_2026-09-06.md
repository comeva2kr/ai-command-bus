# NH126 콘텐츠 품질·Safari 검증과 자체 기사 운영안

- 안정 ID: `NOWHOT-CONTENT-QUALITY-FINISH-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260906-213`
- 입력 분류: 1·2번 진행 승인, 3번 전 그록 수집→클로드 기사 작성 방식은 의견·질문.
- 상태: Root 분류·발췌·제목 수정, Fable 원문 조사 인수인계, Grok 분류/기사 운영안 검토와 보조 독립 코드 검토 완료. 아래 후보까지 로컬 검증 완료이며 운영 반영은 최종 영수증으로 구분한다.

## 확인과 수리

- `classify.js`의 기존 조선비즈 스포츠 규칙이 `/sports/baseball/`만 인식했다. 농구·배드민턴 제목은 확정 어휘가 부족해 종합 피드의 `business`가 Today 패킷에 남았다. 기존 규칙을 발행사 호스트가 일치하는 `/sports/`로 확장했다. 제목 추정보다 확정 섹션 URL을 우선하는 기존 Live/패킷 공통 흐름을 그대로 사용한다.
- 실패 재현 2/2 → 관련 `classify`, `category-policy`, `selection-d2d`, `category-routing` 122/122 PASS. 다른 호스트·sportswear·경제 URL의 query 속 sports는 스포츠로 보내지 않는다. `/tmp/nh126-category-before.log`, `/tmp/nh126-category-tests.log`.
- 실제 모닝 원본 동결 풀 3,225건을 같은 SHA로 재사용했다. 패킷/라우팅 재생성에서 바뀐 것은 조선비즈 축구2·스포츠 일반1의 `business → sports` 3건뿐이다. 기존 모델 판정과 나머지 분류는 유지했다. `/tmp/nh126-routing-proof.json`.
- selection 계약 32/33. 기존 `sourceRegistry` 지문 불일치(`7290afd0fadf495c → 52bb45ceca678cb1`)만 남는다. 이번에 변경한 `legacyClassifier` 잠금만 `8e58faba7225d0dc`로 갱신했다. `/tmp/nh126-selection-contract-tests.log`.
- [Grok 분류 독립 검토](NOWHOT_NH126_GROK_CATEGORY_REVIEW_2026-09-06.md) GO. Live·Today 공통 호출, 호스트/경로 반례, 변경 3/3,225건과 2/2 재실행을 대조했다. 모델의 GO와 운영 반영은 별도다.
- [Safari 계열 보완 검증](NOWHOT_NH126_SAFARI_QA_2026-09-06.md): 10:32 KST 시스템 WKWebView에서 Today56·쿠팡6, Today/Live 위아래 스크롤 상단59px 고정, 광고/기사 제목 정렬·글꼴 일치, 가로 넘침0·JS 오류0. Root도 광고/Live 스크린샷을 직접 열람했다. 실제 iPhone은 연결 확인이 안 되어 터치·주소창·안전영역은 미검증이다.

## 발췌·제목 구현과 교정판

- Root가 `enrich.js`의 기존 균형 태그 탐색을 재사용해 BBC 중첩 byline/metadata·TechCrunch 배너·Letem infoline/중첩 figure·사진 caption·Yanko/Wikitree 특정 header·Nate 확대 버튼·MT 추천 목록을 실제 HTML 영역에서 제외했다. `publicText`와 문단 수집 전 공통 경로에 적용했다. Gnuboard `bo_v_con`을 기존 명시 본문 탐색에 추가하고 `div-widget`을 `div`로 잘못 세는 경계를 고쳤다.
- 저장 발췌는 검증된 Gnuboard/Wikitree 머리, 연합인포맥스 사진 출처·발신지 경계, Daum 글꼴 예시 두 문장, Donga 트렌드 목록·MT PICK·연합 그래픽 SNS·한겨레 기자 서명만 정리한다. 독립 반례에서 일반 `자료사진`·작성자/날짜 문장 절단 위험을 확인해 해당 전역 텍스트 규칙은 제외했다. HTML 구조 수리는 새 원문 추출부터 적용되며, 기존 경향 사진 설명·Yanko/BBC 등의 모든 저장분까지 즉시 깨끗해졌다는 주장은 하지 않는다.
- `editorial-reader-copy.js`의 제목 공통 경로에서 실제 출처 라벨과 일치하는 매체 접미 및 확인된 Google 뉴스의 ` > 뉴스/신제품` 꼬리만 제외했다. 기사 의미일 수 있는 `[확정]`·칼럼명, 일반 비교 기호, 준비/검증된 편집 제목은 유지했다. 준비 제목에 해당 접미가 남은 후보는0건. reader 계약14, 기존 product-blueprint 고정값 검사 PASS.
- 분류122/122, enrich·reader·blueprint114/114, article-summary·정본·prepublish148/148, 공지 Chrome3/3 PASS. 실패 재현2건(추출), 추가 실패2건(저장 문구/제목), 보존 반례와 독립 NH126 4/4 실행을 확인했다. 기존 sourceRegistry 계약 실패1건은 위에 분리했다.
- 최종 교정 후보 `SCE-3d774e304b232d54` / SHA `3d774e304b232d549baa7fdf9bd8680500f86addc405bc5b83e8c33c707d1689`. 원래193건·표시순서·분야별 목록·eventSources 전부 보존, 기본 선택56, 자동차13/나머지13개 분야14로 원판과 동일. 발췌150·원문 이용불가43도 보존했다. 기사10건의 발췌와3건의 제목 변경(중복 포함 영향12건), LLM0.
- 재선정 CLI 시험은 기존 판의 순서/선정이 달라져 채택하지 않았다. 기존 `buildSlotCanonicalEdition`에 원래 union/lane을 넣어 독자 문장과 발췌만 다시 동결했다. 분류 변경3건은 선정193건의 출처에 없음을 검사한 뒤 새 routing/packet SHA를 연결했다. `/tmp/nh126-refreeze.mjs`, `/tmp/nh126-refreeze-receipt.json`, `/tmp/nh126-candidate-proof.json`, `/tmp/nh126-preserved-candidate/`.
- QA 임시 검사도 실제 계약에 맞췄다. 원문 이용불가 상태에 본문을 강제하거나, 원시 event 대표 ID가 최종 출처 ID와 같다고 가정한 검사는 올바른 서비스 계약이 아니어서 제거했다. 정본 검증 함수와 원판의 실제 선정·출처 불변을 검증한다. 미채택 임시 후보는 운영에 반영하지 않았다.

## 자체 기사 방향에 대한 책임자 판단

방향은 채택할 가치가 있다. 자체 콘텐츠의 가치는 모델 이름이나 문장 재작성 여부보다 원문에 더한 조사·비교·해설에서 나온다. 제안은 아직 구현 지시로 바꾸지 않았다.

| 단계 | 기존 기반과 필요한 보완 |
| --- | --- |
| 수집 | 기존 RSS/공개 원문 수집을 유지하고, 그록은 중요한 사건의 공식 발표·원자료·새 변경점을 보충한다. 별도 그록봇의 현 가동을 확인한 것은 아니다. |
| 기사 작성 | `article-summary.js`에 본문 기반 작성/검증이 이미 있다. `editorial-llm.js`의 기존 제목 제한 편집만 켜서는 독립적인 해설 기사가 되지 않는다. 정시 발행의 현재 `allowPaid:false`와 실제 모닝 LLM0을 구분한다. |
| 읽을 가치 | 무엇이 일어났나, 이전과 무엇이 달라졌나, 독자에게 왜 중요한가를 원자료·수치·관련 근거와 함께 설명한다. 수집량이나 단어 바꾸기를 가치로 세지 않는다. |
| 발행/갱신 | 기존 사건 ID·정본 발행을 재사용한다. 같은 사건의 후속 변화는 이어서 갱신하고 원문 발행·사건 발생·자체 발행/수정 시각을 구분한다. AI 편집임을 밝히며 취재하지 않은 인터뷰나 실재 기자를 만들지 않는다. |
| 첫 확인 | 핵심 사건 3~5건으로 기사 실물, 근거 일치, 중복, 처리시간, 호출비용을 먼저 비교한다. 방문 때마다 생성하거나 전체 수집 풀을 매번 LLM에 보내는 구조는 권고하지 않는다. |

Google의 [생성형 AI 콘텐츠 안내](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content?hl=ko)는 정확성·품질·독자 가치를 강조한다. 광고용 [복제 콘텐츠 정책](https://support.google.com/publisherpolicies/answer/11190248?hl=en)은 추가 가치 없는 재작성·자동 생성, 검토나 선별 없는 콘텐츠를 부적합 예로 든다. 따라서 그록→클로드라는 조합 자체가 자체 콘텐츠 또는 광고 승인을 증명하지 않는다. 한국어 광고 도움말은 조회 오류로 영문 공식 원문을 확인했다. AdSense/AdFit 신청·계정 변경은 수행하지 않았다.

[Grok 독립 검토](NOWHOT_NH126_GROK_EDITORIAL_PROPOSAL_2026-09-06.md)의 기존 파이프라인 재사용·소량 실물 검증 권고를 채택한다. “그록 수집기 부재”나 현재 프롬프트의 요약 제한을 새 운영안 자체의 HOLD 근거로 삼는 결론은 채택하지 않는다. 원문·공식 자료의 근거를 추가 확보한 뒤 비교·해설하는 자체 편집은 별도로 평가할 수 있고, 독점 취재 여부와 독자에게 추가하는 가치를 같은 기준으로 보지 않는다. 다만 현재 구현 지시는 1·2번에 한정되어 새 기사 운영을 가동하지 않았다.

## WRC 보고

- Orca 협업: run `run_583b988e6229`, Root 구현/통합·Fable5.1 max 원문 조사·Cursor Grok4.6 xhigh 독립 검토. Grok 제안 `task_558f30fbac2f` 완료 후 동일 터미널을 분류 검토 `task_1206ce4ea870`로 즉시 재사용했다. 최종 dispatch `ctx_6d52bc27b7ef` 완료 뒤 release·ACK 완료. 앞선 프롬프트 수락 실패 두 건도 release했으며 검토 성공으로 세지 않았다. Fable은 도구 종료 후 응답 지연이 반복되어 같은 세션을 재개했고 11:07:52 KST에 읽기 전용 인수인계로 범위를 바꿨다. 11:09:58 ACK, 11:12:32 조사 보고 완료 후 dispatch `ctx_52d76939a553` release·delivery `delivery_58b0167d69e4` ACK 완료. [Fable 인수인계](NOWHOT_NH126_FABLE_CONTENT_FIX_2026-09-06.md)의 구현 제안을 Root가 좁혀 적용했다. 보조 Codex `nh126_extraction_review`가 정상 문장/속성 반례와 최종 GO를 독립 회수했다.

- 작업 시작 전 확인한 MD: 자동 주입 사용자 AGENTS·메모리 요약·Ponytail Full; 직접 읽음 START_HERE, CANONICAL 13원칙·§11.1, WIKI_RULES, ENFORCEMENT, PMO_LIVE_BOARD, REPORT_READ_INDEX 관련 범위, README, 개발현황, NH123/NH124 Root·Fable 보고, wrc-start/orca-cli/orchestration SKILL 및 현재1.4.197 가이드; 미읽음/불가 실제 iPhone·무관한 보드 과거 하단; 이번 전용 파일은 위 소스·검사·모닝 원본·NH126 보조 보고.
- 적용한 규칙: 승인한 수리/검증과 의견 검토 구분, 13원칙 전체·§11.1·Ponytail 최소 공통 수정, 코드 전 Corridor, 원본 보존, 실제 Orca Fable/Grok 검토, 개인 브라우저 격리.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드로 최종 코드·운영 영수증과 대조해 연결한다.
- 금지선 준수: 개인 브라우저·광고 클릭·계정 제출·새 유료 호출·시계 변경·원본 덮어쓰기0.
- David 행동 필요 여부: 실기기 확인에는 iPhone 연결 또는 실기기 결과가 필요하다. 반복 질문하지 않았다.
- Telegram 알림 필요 여부: 없음, 이 대화에서 보고.
- 이익 우선·과잉방어 점검: GO. 기존 수집·분류·본문 검증·발행 구조를 재사용한다. 불확실한 전체 번역 품질과 광고 승인은 단정하지 않는다.
- 하지 않은 일: 자체 기사 새 파이프라인 구현/가동·광고 심사 신청·실제 iPhone PASS 주장·메모리 쓰기.
