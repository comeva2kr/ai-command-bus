# NH106 제품·편집 근인 감사 — 현재 워크트리·활성 로컬판 (read-only)

- Date: 2026-09-02 (Asia/Seoul) · Reviewer: Claude Fable 5.1 Ultra Code, task_74dc188c3e4c
- 대상: dirty worktree 전체 bytes(HEAD `e79856c` + 미커밋 40파일 +2,763/−416), 활성 포인터
  `.nowhot-local/slot-editions/active.json` → `SCE-55d43713440229e2`
  (`edition-2026-09-02-lunch-55d437134402.json`, 195 사건·14 lane×14), 로컬 4100 실응답,
  Blueprint `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md`(NH93~NH105), NH94/NH95 선행 검수.
- 금지선: 파일 수정 0(본 보고서 신규 1건), 유료/외부 API 0, 서버·포인터·커밋·배포 조작 0.
  로컬 서버에는 읽기 GET만 보냈다.

---

## 1. 사용자향 제품 계약 (Blueprint에서 추론)

1. 하루 세 판(모닝 07 / 런치 12 / 이브닝 19, KST)으로 분야당 품질 통과 상위 최대 14건
   (활성 최소 13건)의 사건 브리핑을 제공한다. 부족하면 잡기사로 채우지 않고 직전 완성판을
   유지한다 (Blueprint:122-129, 1718-1719).
2. 복수 분야 선택은 정확한 가산 합집합이고 동일 사건은 1회만 남는다. 제목·출처·사진·
   발행시각·상세는 선택 분야와 무관한 고정 카드 정체성이다 (Blueprint:1900-1901).
3. 각 사건은 `무슨 일/왜 중요/왜 뜨나/왜 내게/달라진 점/관전` 해설 문법을 실측 근거로
   채운다. `changedSincePrevious`는 필수 필드다 (Blueprint:131-166).
4. 해외 기사는 지역 쿼터 없이 한국 독자 파급 기준 중요도 순위로만 선다 (NH93, :1714-1735).
5. 상세는 발행 전에 사전 종결되고, 요청 경로는 포인터 읽기+분야 필터만 수행하며 LLM 0회다
   (NH99/NH104).
6. 분류·의미 판정·한국어 편집은 LLM 계층이 담당하고 검증 단계가 대조한다 (Blueprint:168-178).
   — **이 6번이 현재 실행 경로에 없다는 것이 아래 대부분 결함의 뿌리다.**

## 2. 이미 지켜지고 있는 것 — 회귀 금지 (실측 확인)

| 불변식 | 증거 |
|---|---|
| 14 lane × 14건, 활성 최소 13 (4겹 강제) | receipt laneCounts 전부 14; `src/feed/slot-canonical-edition.js:9-15,96-102,160-165`, `tools/build-slot-canonical-edition.mjs:122-132` |
| 정확 가산 합집합·중복 0·카드 정체성 고정 | 실서버 news(14)+business(14)=28, dup 0, 필드 diff 0; `slot-canonical-edition.js:263-265`, `engine.js:389-435`(결정론적 병합) |
| 상세 사전 종결 (pending/error 0) | 195 = excerpt_only 141 + source_unavailable 54; POST /api/today/summary → 410 (`server.js:3213-3218`) |
| 요청 경로 LLM 0·filter_only | `server.js:3178-3195` 전 경로 동기·순수; 응답 `llmCalls:0`, `requestWork:"filter_only"` |
| 해외 주요매체 실제 노출 | 오늘 news 4(가디언·BBC)/business 3(CNBC·마켓워치)/tech 7 — 단, §3-B7 참조(하한 게이트는 삭제됨) |
| 활성화 파일 쓰기 원자성·읽기측 SHA 검증 | tmp+rename(`slot-canonical-edition.js:351-355`), 포인터↔아티팩트 SHA 대조(`:413-415`) |
| 성인/저품질 기계 게이트, 카테고리 토글 경합 처리 | `category-routing.js:80-81`; `public/today.html:676-702`(abort+직렬화+롤백) |

## 3. 현재 구체 결함 — 출시 차단(B) 우선순위

### B1. 독자 문장 계층이 통째로 템플릿·기계번역·발췌다 (제품 정면)
- **요약 = 요약이 아니라 크롤링 발췌.** `excerptSummary()`는 본문 앞 900자를 자르기만 한다
  (`article-summary.js:330-373,319-328`). 내비 잡음이 그대로 들어간다 — 실측: 디자인붐
  "일일 및 주간 스토리를 매일 확인하세요. 주간 샘플 보기 KENGO KUMA…", 하입비스트
  "패션 20시간 전 조회수 1,300개 0 댓글 댓글 저장 …".
- **whyImportant = 레인당 상수 1문장.** `editorialValue()`가 categoryIds로만 분기
  (`engine.js:908-1010`) → 게임 14건 전부 동일 문장, 전체 195건이 템플릿 25종.
  whyHot 104/195가 "현재 수집 목록의 상위 후보로 들어왔다"(무근거 필러, 해설 문법 #3 위반),
  whyForYou는 14종 동어반복("X를 선택한 오늘판이라 포함했다").
- **제목 4~5회 반복.** `withEventContext()`(`editorial-reader-copy.js:294-299`)가
  whyImportant/whyNow/watchNext 앞에 `“제목” 관련해`를 일괄 접두 — 실측 유머 lane 카드에서
  같은 게시물 제목이 카드 안에 4회.
- **change 195/195 공란 = 계약 위반.** `changedSincePrevious`는 `applyEditionChanges`
  (`edition-change.js:401`)가 server.js HTTP 경로에서만 쓰는데 슬롯 빌더는 HTTP를 거치지
  않는다(`tools/build-editions.mjs:286-306` directBuild). Blueprint:143 필수 필드가
  구조적으로 항상 빈다. watchNext도 159/195 공란.
- **자체 품질 게이트가 이 경로를 안 본다.** `assessReaderIssueCopy`(change 증거 검사)·
  `assessReaderCopyDiversity`(동일 문장 반복 상한)·`validateTodayEdition`의 reader 검사가
  전부 존재하지만 슬롯 정본 빌더에서 호출되지 않거나(editorial-quality.js:279,306 전용)
  reader 부착 전에 실행돼 no-op이다(`build-slot-canonical-edition.mjs:407` vs
  `slot-canonical-edition.js:185`). **자기 계약이 거부할 문장이 발행되고 있다.**

### B2. 기계번역 제목 — 어색을 넘어 오염
- 무료 Google 웹 엔드포인트 직역(`translator.js:148-176`), 실패 시 원문 무성 반환.
  실측: "Ice Island는 Joe Island와 함께 Run-In에서 살아남습니다"(NASA), "아디다스의 …
  드레스 슈즈가 야생으로 변했습니다", "Rockstar이", "John Ternus는 Apple CEO가라는 첫 번째
  메모에서…"(비문), "공명: 전염병 이야기 유산 리뷰"(게임명 직역).
- **제목 오염 실측 1건:** art lane 1위 카드 제목이
  "Kengo Kuma, 2027년 Andrée Putman - I'm Not Afraid(공식 뮤직 비디오)" — 같은 카드
  sourceEvidence에 올바른 제목("… 평생공로상 수상")이 공존하는데 오염본이 정본으로 선택됨
  (edition-…55d437134402.json, EV 대상 designboom 기사). NH103 "정본 제목 단일 소유"
  수리 이후에도 남은 반례.
- **폴리시는 구조적으로 무력.** `headlineNeedsPolish`는 모양 신호(연속 영단어·조사 접착 등)만
  탐지해 195건 중 3건만 걸렸고, 무료 모드는 같은 번역기로 재번역하므로 `changed`가 0이 될
  수밖에 없다(`build-slot-canonical-edition.mjs:147-186`; 영수증 attempted 3/changed 0).
  NH103의 사람 검수 오버레이는 선택 입력이라 이번 판 적용 0건(`preparedHeadline` 0/195).

### B3. 분류 의미 오배치 — 의미 판정자가 발행 경로에 없다
- 오늘 판 routingBasis = **current_model 0 / deterministic_tier_policy 2017 / withheld 273**.
  의미 계약의 실소유(`category-admission-policy.json`의 coreTest + admissionGate,
  `selection-contract.js:156`)는 current_model 경로에서만 실행되는데 그 경로가 0건이다.
  실행된 것은 소스 등록값+한국어 키워드 사전 중재뿐(`prepare-selection-shadow.mjs:34-68`).
- 실측 오배치: sports lane에 "메디포스트, 前 삼성바이오 부사장 영입"(코메디닷컴,
  categoryIds [life,sports])·"시지바이오 샤-컵 후원"(의학신문); life lane 14건 중 9건이
  의료 전문지 기사·1건은 성형외과 장비 도입 보도자료; culture에 산업 조간브리핑(헬로디디);
  business 1위가 더쿠 게시물. categoryFit 게이트 규칙은 fashion/humor/tech에만 존재
  (editorialQuality.failuresByRule)—sports/life/culture는 무방비.
- **동일 실사건 2회 노출:** 지예은·바타 결혼이 culture(텐아시아, EV-5a79bf2e…)와
  humor(인스티즈, EV-5f63c005…) 별개 클러스터로 각각 발행 — "동일 사건 1회" 계약의 실측 위반.
  군집 병합이 표현 차이(♥·[단독])를 못 넘었고, 병합 규칙에 카테고리·연예 이벤트 의미가 없다
  (`event-cluster.js:257-293`).
- 커뮤니티 비혼합 소스는 제목을 아예 읽지 않고 게시판 기본값으로 투표한다
  (`prepare-selection-shadow.mjs:38-40`); 영문 제목은 의미 경로 자체가 없다
  (`classify.js:749-753` RECLASSIFY_DESPITE_TRAINING 공집합, 사전 ~95% 한국어).

### B4. 상세 54건 영구 unavailable + 좌석 배정이 상세 가능성을 안 본다
- 사유: NO_SUBSTANTIAL_PUBLIC_BODY 24 / PUBLIC_BODY_TOO_SHORT 13 / NO_PUBLIC_BODY 10 /
  IDENTITY_MISMATCH 3 / ACCESS_DENIED 3 / TIMEOUT 1. 발생원은 커뮤니티(더쿠7·보배4·이토4·
  인스3·뽐뿌3 — 짧은 글/이미지라 구조적)와 유료벽·수집거부(PC게이머7·조선비즈4·조선3·마켓워치2).
- `retryAfter`(+30분)는 빌드 캐시 검사용일 뿐 소비자가 없어 발행 후 재시도 0
  (`article-summary.js:315,46-49,285-295`) — 판 수명 내내 "상세 없음" 고정.
- 선별 점수에 "상세 제공 가능성" 항이 없어, 상세가 원천 불가능한 카드가 lane 절반을 차지
  (humor 12/14, realestate 7/14, gaming 7/14 unavailable).
- 사유 보고도 부정확: sources[0]의 사유만 대표로 기록(`article-summary.js:965-971`).

### B5. 발행 경계·원장 회계 (자동 발행 첫날의 구멍)
- **translate.js:187 잠복 결함 미수정.** 오늘 12:50 HOLD의 원인(`opts` 기본값 부재,
  같은 함수 :190·:195엔 가드 존재)은 그대로이고 호출부 1곳만 고쳐졌다(미커밋). exported
  API라 다음 단일 인자 호출에서 재발한다.
- **활성판 영수증이 영구 candidate_ready.** prepublish 경로는 포인터만 쓰고 디스크
  receipt를 재기록하지 않는다(`run-slot-canonical-prepublish.mjs:215-218` 메모리 전용;
  테스트도 반환값만 검사). HOLD 영수증도 성공 후 미정리 — 원장만 보면 오늘 lunch는
  "실패+후보"로 읽힌다.
- **정본 모드에 last-good 폴백이 없다.** 슬롯 판 부재 시 409
  (`slot-canonical-edition.js:399-406`); server.js:1163-1210의 검증판 폴백은 정본 모드에서
  통째로 꺼진다(`server.js:3196`). 실측: 포인터에 morning 0건·8/29~31 0건 — 오늘 07~12시
  접속자는 "마지막 검증 판본 제공"(Blueprint:208) 대신 미준비 안내를 받았다.
- **해외 주요매체 하한이 강제→관측으로 강등.** `assertForeignMajorLaneCoverage`
  (floors news3/business3/tech2) 삭제(git diff `build-slot-canonical-edition.mjs:443-445`).
  오늘은 우연히 충족, 내일 0이어도 안 막는다. 대체 장치인 `authorityPoints` 재작성은
  이분법(신호 없으면 0점)이라 같은 방향으로 작용.
- **미커밋 워크트리가 유일본.** NH94~NH105 전부(+2,763줄/40파일)가 커밋 0 상태로 로컬
  워크트리에만 존재 — 유실 시 현재 제품 동작 복원 불가.

### T. 감내 가능 한계 (차단 아님, 기록)
- T1. humor lane의 mixed 잔류 — 바인딩 오너 의미론으로 확정(NH95 최종). 단 정치 게시물
  ("김민석 대표 새벽 목욕탕", "이대통령 X…")이 유머로 노출되는 체감 품질은 남는다.
- T2. fashion/art 100% 해외·전문 블로그 — 국내 공급원 부재의 정직한 반영.
  gaming 소스 2그룹(게임메카+PC게이머)·politics 6그룹은 소스 폭 확충 과제.
- T3. **origin 관측 오염**: TechCrunch+Verge 기사와 Google News 릴레이(코나미/olympics.com)가
  `overseasOnly:false`로 집계 — 국내/해외 관측 영수증(NH104 truth의 7/7 등)의 신뢰가
  깎인다. 쿼터가 없으므로 편성엔 영향 없어 T로 분류하되, 관측을 판단 근거로 쓰기 전 수리 필요.
- T4. 빌드 비결정성 P2(NH99), 포인터 RMW 무락 TOCTOU, 아티팩트 캐시 무제한 누적,
  UI 카드 키가 배열 인덱스, firstPublishedAt 결측 9/195.

## 4. 공통 근인 — 반복되는 "국소 수리→형제 파손"의 구조

| # | 근인 | 최소 소유 경계 (구현 제안 아님, 위치만) |
|---|---|---|
| R1 | **의미 판정 계층이 발행 경로에 미접속.** 분류(coreTest)·요약·제목 편집·왜중요 전부 LLM 소유로 설계됐으나 current_model 0·llmUsage []로 전 구간 결정론 대체물이 발행됨. B1·B2·B3의 뿌리 | 발행 전 빌더의 모델 실행 게이트 1곳: `run-slot-canonical-prepublish.mjs`(allowPaid)와 `build-category-routing-snapshot.mjs`(current_model 채움) |
| R2 | **반례 1건당 사전 패치 1개 트레드밀.** classify.js 키워드 가드·event-cluster generic 토큰(미커밋 "ai" 추가 진행 중)·categoryFit 레인별 수기 규칙 — 일반화 없는 국소 수리가 형제 반례를 계속 낳음 | `src/feed/classify.js`(`definiteCategory`→`keywordCategory`)와 `src/feed/event-cluster.js`(EVENT_GENERIC_TOKENS·tokenMatch) |
| R3 | **품질 계약과 강제 지점의 경로 불일치.** reader 필수필드·반복 상한·category-event-view(퍼레인 근거, runtimeWired:false)가 전부 존재하나 슬롯 정본 경로가 안 지나감 | `tools/build-slot-canonical-edition.mjs`의 활성 전 검증 묶음(게이트 재배선 지점) |
| R4 | **정체성 다중 소유.** 제목 소유자 5곳(subject/preparedHeadline/originalTitle/eventTitle/presentationLead), 카테고리 표현 4곳(category/admittedCategories/selectedByCategories/categoryIds), change 소유자는 아예 다른 경로(HTTP) — Kengo Kuma 이중 제목·change 공란이 증상 | 헤드라인: `digest.js` `issueSubject/issueHeadline`+`engine.js:243`; 변경: `edition-change.js` 호출 위치 |
| R5 | **발행 원장·폴백 회계 미완.** 영수증 상태 미전이·HOLD 미정리·last-good 부재·하한 게이트 강등 — 자동 발행을 켠 순간부터 관측이 진실과 어긋남 | `tools/run-slot-canonical-prepublish.mjs`(활성화·영수증·HOLD 정리)와 `slot-canonical-edition.js` 리더 폴백 분기 |

## 5. 불일치·미확인 (정직 공시)

- NH104 3자 검수는 P0 0·P1 0으로 닫았으나, 나는 **B1(독자 문장)·B5(원장/폴백)를 출시 차단**으로
  본다. NH104의 GO는 "구조 계약(합집합·정체성·LLM 0)" 관점이고 본 감사는 "독자 체감 품질+운영
  회계" 관점이라 범위가 다르다 — 모순이 아니라 관점 차이임을 명시한다.
- Kengo Kuma 오염 제목의 최초 발생 지점(피드 원문 오염 vs 번역/제목 캐시 충돌)은 현재 바이트만
  으로 확정하지 못했다. 두 제목이 같은 카드 sourceEvidence에 공존한다는 사실까지만 실측.
- morning 판 부재가 코드 결함인지 운영 공백(해당 시각 서버 미기동)인지 미확정 — 현 서버 PID는
  16:08 기동, 12:46~52 빌드는 이전 프로세스. 다만 "부재 시 409"는 어느 쪽이든 코드 사실이다.
- Google News 릴레이 origin 판정 로직 자체는 코드 추적하지 않았다(산출물 관측만).
- 이브닝 18:40 선행 생성·19:00 전환은 아직 시각 미도래로 관측 불가(NH104와 동일 상태).

## 6. WRC 보고 필드

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: `WRC_MANUS_HANDOFF/START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(§0~3),
    `PMO_LIVE_BOARD.md`(헤드), `REPORT_READ_INDEX.md`(헤드), Blueprint 계약부+NH93~NH105,
    NH94/NH95 선행 검수 3건, `NOWHOT_DEVELOPMENT_STATUS.md`(말미)
  - 미읽음/불가: `04_WRC_AI_CONTEXT_WIKI_RULES.md`·`05_RULE_ENFORCEMENT_PROTOCOL.md` 전문
    (read-only 감사라 위험 낮음, 요약 규칙은 자동 주입분으로 적용)
  - 이번 작업 전용 파일: 활성판 JSON·receipt·HOLD·active.json, src/feed 핵심 12파일(서브에이전트
    3기 정밀 추적), 로컬 4100 GET 4회
- 적용한 규칙: 13 First Principles 게이트, 수정·개발 범위 법칙(read-only·보고서 1건·서브에이전트
  활용), 이익 우선·default-GO
- First Principles 게이트: PASS
- 개발현황 반영: 해당 없음 (read-only 감사, 변경 레코드 미생성)
- 금지선 준수: 코드·테스트·데이터·포인터·런타임 무수정, 유료 호출 0, 커밋·배포 0
- David 행동 필요 여부: ① B 항목의 수리 라운드 착수 여부와 순서 결정(특히 R1 — 발행 전 모델
  실행을 켤지, 켠다면 비용 경계) ② NH94~NH105 미커밋 워크트리의 커밋/백업 승인
- Telegram 알림 필요 여부: 코디네이터 판단 위임
- 이익 우선·과잉방어 점검: GO — 차단 판정은 실측 결함에만 부여, 기능 축소·쿼터 재도입 제안 없음
- 하지 않은 일: 구현·수정 제안 상세화(소유 경계 명명까지만), 유료 재분류, 신선 풀 수집, 활성/재빌드,
  이브닝 슬롯 실측, WRC 게이트 문서 2건 전문 정독
