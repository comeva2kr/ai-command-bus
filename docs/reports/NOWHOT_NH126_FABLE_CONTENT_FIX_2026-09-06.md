# NOWHOT NH126 Fable 원문 발췌·독자 제목 오염 원인 인수인계 (2026-09-06)

- 작업자: Claude Fable 5.1 (Orca 워커 `task_0446b2afa4f3` / dispatch `ctx_52d76939a553`). Root 범위 변경(01:5x UTC)으로 **읽기 전용 인수인계**로 종료. `src/feed/enrich.js`, `src/feed/editorial-reader-copy.js`, `test/enrich.test.js`, `test/editorial-reader-copy.test.js` **수정 0**. 커밋·배포·스냅샷·락파일·유료 호출 0. 구현은 Root가 인수.
- David 입력 분류: 승인(NH126 승인된 콘텐츠 품질 수리) → Root 확정 지시(범위 동결·인수).
- 대조 표본: 실제 공개 모닝판 `/tmp/nh126-before-today.json`(`SCE-d2a4d3ced4c0488a`, 56건) ↔ 이전 런치판 `/tmp/nh124-public-today.json`(`SCE-52a3395bf1acdcb2`). 원문 22페이지를 서버와 같은 UA로 1회씩 받아 HEAD `cfc25a2`의 `fetchPublicArticle`에 그대로 넣어 현재 추출 결과를 재현했다.
- Corridor analyzePlan(코드 작성 전 호출) 결과: 기존 SSRF 보호(사설 IP 거부·DNS 고정·700KB/5s 상한) 유지, 텍스트 정리·요소 제거 정규식은 상한 있는 수량자·머리/꼬리 창 제한으로 ReDoS 방지 — 아래 규칙 후보는 모두 그 조건으로 설계했다.

## 1. 재현 자료 (세션 scratchpad, 재부팅 전까지 유효)

`/private/tmp/claude-501/-Users-hyundonghwang-Documents-NowHot-Local-Dev/f74eeb60-2e52-4fb4-9dba-5c5f34d37aea/scratchpad/`

- `dump.mjs` → `nh126-dump.txt`, `nh124-dump.txt`: 두 공개판 56건의 reader.headline·원 제목·출처 링크·textKo 머리/꼬리 표.
- `fetch-pages.mjs` → `pages/<key>.html` + `.meta.json`(22페이지: bbc_dsewiki·bbc_argentina·bbc_flock·letem·tc_video·yanko·khan_nepal·khan_fire·mt_gas·daum_ant·einfomax·donga_chuncheon·donga_mokpo·donga_uiwang·wikitree·coolenjoy·nate·mbc·gamegpu·hani·yna_graphics·engadget_sue).
- `repro.mjs [key…]`: 저장 HTML을 `fetchPublicArticle`(fetchImpl 목)로 돌려 현재 추출 머리 420자·꼬리 300자 출력. `ctx.mjs`: 마커 주변 HTML 컨텍스트.

## 2. 발췌(기사 요약 칸) 오염 — 확인된 원인과 최소 수정 후보

원문 추출 경로: `jsonLd articleBody` → `id|itemprop=articleBody` → Elle `atc_body_cont` → `<article>` → `<main>` → 문단 폴백. `publicText`는 `figure`·`data-block=metadata|links|topicList|promoList`를 **게으른 정규식 한 번**으로 지워서 같은 태그가 중첩되면 첫 닫는 태그에서 멈춘다(BBC·Letem 잔존의 직접 원인). `publicText`는 `<header>`를 지우지 않는다(문단 폴백만 지움).

| # | 매체(표본) | 실측 원인(HTML) | 구조 수정 후보(다음 수집부터) | 저장된 textKo에 필요한 텍스트 규칙 |
|---|---|---|---|---|
| 1 | BBC(NH124 #05·#07·#52) | `<article>` 안 `data-block="headline"`(`<header><h1>`)·`byline`·`metadata`(`<time>`)·`links`·`topicList`. byline/headline은 제외 목록에 없고, 나머지는 중첩 div 때문에 일부만 삭제 | 깊이 세는 요소 제거(`elementInnerHtml` 방식)로 교체 + `headline|byline` 추가 | 번역문 머리: `제목. Zoe Kleinman Technology 및 AI 편집자 2026년 9월 4일`, `… 특파원 Chris Graham 및 Peter Hoskins 비즈니스 기자 2026년 9월 4일, 03:01 BST 업데이트 07:52 BST`, `By Ellie House Reporting, 텍사스 휴스턴에서 1시간 전` → 머리 500자 안 `[라틴 이름 2~4어] … (편집자|기자|특파원|Reporting…에서) (YYYY년 M월 D일[, HH:MM BST 업데이트 HH:MM BST]|N시간 전)`까지 절단 |
| 2 | Letem(NH124 #46) | `<div class="infoline">`: 카테고리 링크·`<address>` 저자·`<time>`·`<div class="stats" data-nosnippet>`; 꼬리 “당신은 관심을 가질 수 있습니다…”는 `<figure class="caretbox recommended">` 안에 `<article>`·`<figure>` 중첩 → figure 제거 실패 | 깊이 세는 figure 제거 + `address`·`[data-nosnippet]`·class `infoline` 제외 | 없음(현재 판에 없음, 캐시 24h) |
| 3 | 테크크런치 배너(NH123 #9 잔여) | `<div style="display: none;" class="wp-block-techcrunch-promo-countdown-banner">` 안 `<p>` 2개를 문단 폴백이 읽음 | `display:none`·`hidden` 요소 제외(publicText·paragraphText 모두) | 없음 |
| 4 | 얀코디자인(#40) | `<header class="entry-header">`에 h1 + `<div class="entry-meta">By Sarang Sheth <time>09/05/2026</time>` | `publicText`에서 `<header>` 제거(문단 폴백과 동일 기준) | 머리 `작성자[:]? Sarang Sheth 2026년 9월 5일 ` 절단(엔가젯 `작성자: … 오전 10:05 EST`도 같은 형식) |
| 5 | 위키트리(#34) | h1·`<div class="byline">송태섭 기자 <span class="byline_email">`·`<p class="date_time">작성일 <time>`·`<i class="material-icons">link</i>` 전부 `<header>` 안 | 같은 `<header>` 제거 | 머리 `^link … 이름 기자 email 작성일 YYYY-MM-DD HH:MM ` 절단 |
| 6 | 쿨엔조이/그누보드(#22) | `<article id="bo_v">`: `<header>` 제목, `<section id="bo_v_info">` 작성자 정보, 본문은 `<div id="bo_v_con">`, 뒤에 공유·댓글 | `articleBodyText`에 `id="bo_v_con"` 본문 컨테이너 추가 | 머리 `작성자 정보 … 쪽지보내기 … 본문 ` 절단(저장 textKo에 마커 있음 확인) |
| 7 | MBC(#17)·경향(#06·#25) | articleBody 안 `<p class="caption">`(MBC `자료사진`, 경향 사진 설명+`AP연합뉴스`), 경향 `<div class="editor-subtitle">` 부제 | class 토큰 `caption` 요소 제외 | MBC `^자료사진 ` 절단만 안전. 경향 “설명문. AP연합뉴스 본문…”은 안전한 텍스트 규칙 없음(캐시 만료로 해소) |
| 8 | 연합인포맥스(#05) | figure는 제외되지만 `<center><font>[출처: 연합뉴스 자료 사진]</font></center>`·`<center><font>매물이 사라진 부동산</font></center>`이 `<p>`에 남음 | — | 대괄호 규칙 `자료사진`→`자료\s*사진`, 발신지 `=(연합뉴스|연합인포맥스)`, 발신지 앞 60자 이내·문장부호 없는 조각 삭제 |
| 9 | 동아일보(#41·#45·#48) | 본문은 `<section class="news_view">`(페이지에 1개, `(목포=뉴스1) </section>`로 끝남), articleBody 표기 없음. 꼬리는 `#is_trend_m section.trend_list_wrap`(`<header class="sec_head"><h2>트렌드뉴스</h2>` + 탭 “많이 본/댓글 순” + `<ul class="news_list type_num"><li><span>1</span>…`) | donga.com 한정 `section.news_view` 본문 컨테이너(Elle `atc_body_cont` 선례). 헤딩 텍스트 전체 삭제는 채택하지 않음(커뮤니티 글 h태그 본문 위험) | 꼬리 `\s트렌드뉴스 많이 본 댓글 순 1\s`부터 절단(저장 textKo 3건 모두 마커 확인). 주의: `<header>` 제거를 넣으면 새 수집분에서는 이 마커가 사라지므로 텍스트 규칙은 저장분 전용 |
| 10 | 머니투데이(#13) | 본문 `<p>` 뒤 같은 컨테이너의 `<div class="mobile_hot"><h2>독자들의 <em>PICK!</em></h2><ul><li><h3>…` | — | `chromeTail`에 `독자들의 PICK!` 추가(저장 textKo 마커 확인) |
| 11 | 다음(#28) | 글자크기 레이어 `<div class="set_view fs_type1"><p>이 글자크기로 변경됩니다.</p><p>(예시) 가장 빠른 뉴스가 … 전달하고 있습니다.</p>`; 본문은 `div.article_view[data-translation-body]` | — | 정확한 두 문장 삭제(저장 textKo 마커 확인) |
| 12 | 네이트(#30) | 본문 `<p>` 안 `<span class="enlarge"><span class="hide">이미지 크게 보기</span>` | — | 머리 `^이미지 크게 보기\s+` 삭제 |
| 13 | GameGPU(#26) | 끝 `<p class="gt-block"><!--noindex--><a>출처</a><!--/noindex--></p>` | `<!--noindex-->…<!--/noindex-->` 블록 제거. **HTML 주석 전체 삭제는 금지**: 기존 YTN `-->` 3개 규칙·`photo big-->` 규칙이 주석 잔재에 의존, YTN 표본 없음 | 꼬리 `\s출처$` 삭제 |
| 14 | 한겨레(#29) | 마지막 `<p class="text">박미향 기자 <a href="mailto:">mh@hani.co.kr</a>` | — | 꼬리 `이름 (기자|특파원|논설위원…) 이메일$` 서명 삭제(기존 규칙은 `@yna.co.kr` 단독 토큰만) |
| 15 | 연합 그래픽(#36) | `<p>minfo@yna.co.kr</p><p>X(트위터) @yonhap_graphics 인스타그램 @yonhapgraphics</p>` 뒤 `제보는 카카오톡`(기존 마커) | — | `chromeTail`에 `X\(트위터\) @yonhap_graphics` 추가 → 남은 yna 이메일은 기존 꼬리 규칙이 제거 |

보존 반례(테스트에 넣을 것): `문의는 press@example.com`, `[출처: 기획재정부 자료] 정부는…`(자료사진 아님), `삼성전자 Galaxy Unpacked 행사는 2026년 9월 4일 열린다.`(역할어 없음), `OpenAI가 조사를 시작했다. BBC 기자 John Smith는 2026년 9월 4일 보도에서…`(이름이 역할어 뒤), `(목포=뉴스1)` 발신지, 핫딜 상품·쿠폰 문장, 기존 NH124 반례 전부. 적대 입력(16KB 반복 날짜·이름·대괄호) 시간 측정 필요.

정상 42건 대조: 위 15개 표본 외 발췌는 이번 판에서 오염 관찰 없음. #01 클리앙 “후략 김승원은…”은 게시자 의견(원문 그대로), 보존.

## 3. 독자 제목 꼬리 (`editorial-reader-copy.js`)

세 건 모두 `readerLineage.basis.headline.kind = subject_source_titles`(preparedHeadline 없음). 같은 꼬리가 `leadTitle`/`readerEventLabel`을 거쳐 `summary`·`whyNow`·`whyImportant`의 인용 제목에도 그대로 들어간다(#10 확인) → `stripOuterQuotes(stripLeadTags(…))` 4곳(leadTitle·readerEventLabel·readerHeadline subject·readerWhyImportant subject)에 함께 적용해야 한다.

- #10 `… 관세청장 보고 공유 - 머니투데이`: eventSources[0] `sourceId gnews-biz, sourceLabel 머니투데이`(Google 뉴스 RSS의 “ - 매체” 접미). 규칙: 꼬리 ` - <라벨>`이 eventSources/refs/sourceEvidence의 sourceLabel과 같을 때만 삭제.
- #22 `… 136% 상승 > 뉴스/신제품`: `gnews-tech` 중계, 쿨엔조이 `<title>` 브레드크럼(`제목 > 게시판 | 사이트`). 규칙: `gnews-*` 행 제목이 같은 ` > 세그먼트(≤12자)` 꼬리를 가질 때만 삭제.
- #28 `… 수급 방패 [박진우의 개미수다]`(NH123 `[투자 360]` 동류): 규칙: `stripLeadTags`와 대칭으로 20자 이내 `[…]`/`【…】` 꼬리 삭제(남는 길이 ≥6).
- Techmeme 저자 꼬리·`Sources:`는 NH124 규칙이 유지되며 이번 판에서 재발 0(#54 Techmeme 87자 완전). 문장형 기계번역 제목(#03·#06·#16·#26·#38·#40)은 규칙으로 안전하게 고칠 근거가 없어 대상 외.
- 관례: NH124는 투영 변경 때 `EDITORIAL_READER_COPY_CONTRACT.version` 12→13. 14로 올리면 `editorial-quality.js` packetId 소금(`reader:${version}`)이 바뀜. `test/product-blueprint.test.js`의 `BRP-07rqta4`/`BRP-1etcf4c` 고정값이 정적 픽스처인지 라이브 계산인지 **미확인** — 버전을 올리면 그 테스트를 함께 돌려야 한다.

## 4. 호출자 검토 — 재동결 반영 여부 (Root 질문)

- `cleanArticleTextChrome` 호출자 4곳: `article-summary.js:243`(출처 링크 요약), `:359`·`:362`(발췌 생성: 영문 정리 → 번역 → 재정리, `publicExcerpt` 900자), `slot-canonical-edition.js:195`(**정본 동결 시 저장된 `articleSummary.textKo` 재정리**, `looksLikePageChrome`면 NO_PUBLIC_BODY), `engine.js:2554`(실시간 `_cleanItemSummary`). 따라서 **텍스트 규칙은 기존 준비 상세로 모닝을 재동결할 때 저장 textKo에 바로 적용**되고, HTML 구조 규칙은 `fetchPublicArticle`이 다시 도는 다음 수집부터만 적용된다(`READY_CACHE_MS` 24h, `article-summary.js:23·44·294`).
- 재동결 시 텍스트 규칙으로 고쳐지는 저장 발췌: #05·#13·#17·#22·#26·#28·#29·#30·#34·#36·#40·#41·#45·#48(14건, 마커 실측). HTML 구조로만 고쳐지는 것: #06·#25 경향 사진 설명(다음 수집), BBC·Letem·테크크런치·그누보드·동아 컨테이너(다음 수집).
- `readerIssueCopy` 호출자: `slot-canonical-edition.js:187`(동결 시 reader·readerLineage 저장), `server.js:792·1016·1522`의 `projectEditorialReaderCopy`(응답·스냅샷에서 재계산), `editorial-quality.js`, `editorial-review-desk.js`. 저장 artifact의 `contentSha256`(`slot-canonical-edition.js:128·242`)은 저장 payload(reader 포함) 기준이고 응답은 `projectEditorialReaderCopy(canonical)`로 다시 계산하므로 제목 규칙은 재동결분과 응답 양쪽에 적용된다. 공개 API 대조는 Root 검증 범위.

## 5. 남은 한계

- 기계번역 제목·본문 문체는 규칙 대상 외(원제 보존, 유료 호출 0 유지). 경향 사진 설명 저장분·BBC/Letem/테크크런치는 다음 수집에서만 정리. `<header>` 제거·`display:none` 제외는 전역 규칙이므로 기존 79개 enrich 테스트와 정리 함수 사용 7개 스위트로 회귀 확인 필요. 헤딩(h1~h6) 텍스트 전체 삭제는 채택하지 않았다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`, 프로젝트 메모리 `MEMORY.md`.
  - 직접 읽음: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(전문), `04_WRC_AI_CONTEXT_WIKI_RULES.md`(전문), `05_RULE_ENFORCEMENT_PROTOCOL.md`(전문), `PMO_LIVE_BOARD.md`(상단 60줄 + NowHot 검색 0건), `REPORT_READ_INDEX.md`(상단 40줄 + NowHot 검색 0건), `docs/NOWHOT_DEVELOPMENT_STATUS.md`(NH115~NH124), NH123 Fable 검수·NH124 본보고·NH124 Fable 발췌 보고.
  - 미읽음/불가: PMO 보드·색인 하단 과거 이력(무관), NH126 Root/Grok 신규 보고 4건(범위 동결 후 미열람).
  - 이번 작업 전용 파일: `/tmp/nh126-before-today.json`, `/tmp/nh124-public-today.json`, `src/feed/enrich.js`·`editorial-reader-copy.js`(읽기), 호출자 `article-summary.js`·`slot-canonical-edition.js`·`engine.js`·`server.js`(읽기), `test/enrich.test.js`·`test/editorial-reader-copy.test.js`(읽기), 원문 22페이지, Root 메일박스 2건.
- 적용한 규칙: 입력 분류(승인→Root 확정 지시·범위 동결), 13 First Principles, Canonical §11.1(요청 범위 밖 수정 0·기존 정리 함수 재사용 전제), 이익 우선(출처·번역·커뮤니티 축소 권고 0), 코드 작성 전 Corridor analyzePlan 실행, 역할 경계(구현은 Root 인수).
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — 읽기 전용 인수인계. Root가 구현 시 NH126 레코드에 연결.
- 금지선 준수: 제품·테스트·스냅샷·락파일·engine·분류·운영 파일 수정 0, 커밋·push·배포·유료 호출·개인 브라우저 0. 파일 생성은 이 보고서 1개(+세션 scratchpad). 원문 22페이지는 공개 UA로 1회씩 읽기만.
- David 행동 필요 여부: 없음.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO — 삭제 후보는 바이라인·사진 표기·위젯·목록 크롬만이며 기사 문장·상품 문장·자체 고지 보존 반례를 명시. 덜 제한적 대안: 헤딩 전체 삭제·HTML 주석 전체 삭제는 채택하지 않음.
- 하지 않은 일: 코드/테스트 수정, 테스트 실행, 후보 판 생성, 캐시 무효화, 전체 번역 재작성, 분류 수리, 계약 버전 고정값 검증, 메모리 쓰기.
