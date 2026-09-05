# NOWHOT NH124 Fable 발췌 오염 수리 (2026-09-05)

- 작업자: Claude Fable 5.1 (Orca 워커 `task_57f6f6179fe6` / dispatch `ctx_b3d5c38e9cbc`). Root가 사건 결속·독자 제목·출처 링크를 맡고, 이 보고는 **발췌(기사 요약 칸) 오염 경로**만 다룬다.
- David 입력 분류: 승인(NH123에서 발견한 결함 수리 진행). 대상·범위는 Root 명령으로 고정: `src/feed/enrich.js`와 그 기존 테스트 `test/enrich.test.js`, 이 보고서.
- 변경 파일: `src/feed/enrich.js`(+50줄), `test/enrich.test.js`(+130줄, 신규 테스트 6개). 커밋·배포·판본 강제 생성 없음. 다른 파일은 손대지 않았다(작업 트리에 함께 보이는 `engine.js`·`event-cluster.js` 등 변경은 Root 작업분).

## 결론

독자가 보는 "기사 요약" 칸에 원문 대신 들어가던 세 가지 — **연합뉴스 사진 설명·크레딧·기자 이메일**, **엔가젯·테크크런치 페이지 머리(카테고리·바이라인·구글 위젯·사이트 메뉴)**, **실시간 이토랜드 핫딜의 게시자 제휴 고지문** — 을 기존 정리 함수 한 벌 안에서 걷어내도록 고쳤다. 새 필터 모듈·의존성은 없다. 정상 기사 속 이메일 문장, 상품·쿠폰 내용, 지금핫 자체 광고 고지는 그대로 남는다. 모든 발췌가 사실이라거나 모든 오염이 사라졌다고 주장하지 않는다 — 남은 한계는 §6에 적었다.

## 1. 재현 (실측)

근거 파일: `/tmp/nh123-today.json`(런치판 `SCE-c1e006868413a496`, 발췌 42건), 이전 Fable 세션이 받아 둔 실시간 상위 20건(`live.json`), 그리고 원문 페이지 13개를 서버와 같은 UA로 다시 받아 `fetchPublicArticle`에 그대로 넣어 추출 경로를 확인했다(세션 scratchpad `pages/`, `repro.mjs`, `paths.mjs`, `snapshot-clean.mjs`).

| 사례 | 화면에 보이던 것 | 확인된 원인 |
|---|---|---|
| 오늘판 #3·#23·#35 (연합뉴스) | `(수원=연합뉴스) 홍기원 기자 = 16일 … 구호를 외치고 있다. 2026.7.16 xanadu@yna.co.kr` 뒤에야 본문 시작 | 연합 페이지의 첫 `<article>`은 `<header>` 안 "세 줄 요약"(155자)이라 본문 최소 길이에 못 미쳐 **문단 폴백**으로 떨어진다. 폴백은 페이지 전체 `<p>`를 모으는데, `<figure><figcaption><p class="txt-desc">` 사진 설명과 핸들바 `<script>` 템플릿 안 가입 유도 `<p>`까지 그대로 읽었다. `publicText`의 figure 제거는 이 경로를 지나지 않는다. |
| 오늘판 #16·#20·#29·#31 (연합뉴스) | `[촬영 조승한]`, `[네팔 교민 문광진씨 제공. 재판매 및 DB 금지]`, `[이태호 제작] 사진합성·일러스트`, `[연합뉴스 자료사진]`이 첫머리·문단 사이에 잔존 | 같은 폴백 경로의 figcaption 크레딧 `<p>`. |
| 오늘판 #29 (연합뉴스) | 발췌 끝이 `…고 말했다. jaya@yna.co.kr` | 기사 끝 기자 이메일 `<p>`. 짧은 기사는 900자 안에 다 들어가 화면까지 남는다. |
| 오늘판 #27·#30 (엔가젯) | `Big Tech Microsoft … 작성자: Devindra Hardawar 2026년 9월 4일 … Google에 Engadget 추가: 기본 소스 Google Discover` 뒤에 본문 | `<article class="news-post">` 머리에 카테고리·제목·부제·바이라인·사진 크레딧·"Add Engadget on Google: Preferred Source Google Discover" 위젯이 있고, 번역 전 영문 단계에서 걸러지지 않았다. |
| 오늘판 #9 (테크크런치 영상) | 사이트 메뉴 약 560자 + `플레이어 로드 중…` | `<article>`·`<main>`이 없어 문단 폴백 → `<header>` 메가메뉴 `<p>` 전부 + jwplayer 자리표시 "Loading the player…". |
| 실시간 1위 (이토랜드 핫딜) | `✱ 이 포스팅은 토스쇼핑 쉐어링크 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.` | 게시글의 `og:description` 원문 그대로. 실시간 요약은 `makeEnricher.applyMeta`가 `og:description`을 그대로 `item.summary`에 넣으며 정리 함수를 거치지 않았다. |
| 실시간 5위 (이토랜드 핫딜) | `이토랜드는 유머, 연예, 정보, 이슈를 빠르게 공유하는 커뮤니티입니다. 자유게시판, … 참여하세요.` | 같은 경로. 2문장짜리 사이트 소개문이라 기존 `looksLikePageChrome`의 1문장 소개문 판정에 걸리지 않는다(§6). |

정리 함수 호출자는 세 곳뿐임을 확인했다: `article-summary.js`(발췌 생성 `excerptSummary`, 출처 링크 `sourceLinks`), `slot-canonical-edition.js`(정본 고정 시 `textKo` 재정리), 그리고 `enrich.js` 내부 `publicText`. 실시간 경로(`engine.js` 수집 → enricher → `_decorate`)는 정리 함수를 전혀 지나지 않았다.

## 2. 수정 내용 (`src/feed/enrich.js`만)

1. **문단 폴백이 비본문 컨테이너를 읽지 않게** — `paragraphText`가 `<p>`를 모으기 전에 `figure·header·nav·footer·aside·script·style·noscript·template·svg` 블록을 걷어낸다(`PARAGRAPH_SKIP_BLOCKS`). `publicText`가 이미 컨테이너째 제외하던 것과 같은 기준이며, `form`은 옛 게시판이 본문 전체를 감싸는 경우가 있어 일부러 남겼다.
2. **정리 함수 `cleanArticleTextChrome` 규칙 추가** (기존 규칙 순서 안에 삽입, 모두 길이 상한이 있는 정규식):
   - 연합뉴스 대괄호 사진 크레딧은 **실측 형식 네 가지만** 제거: `[… 자료사진]`, `[촬영 이름]`(촬영 뒤 공백 필수), `[… 제작] 사진합성·일러스트`(접미 필수), `[… 제공. 재판매 및 DB 금지]`. Root 최종 채택 조건(Grok 반례 `[제작비 논란]`·`[촬영본 유출]` 삭제)에 따라 `제공`·`촬영`·`제작` 단독 일치는 쓰지 않는다.
   - 연합뉴스 사진 설명: 머리 1,400자 안에서 "`2026.9.4` [+ `abc@yna.co.kr`]" 다음에 발신지 표기 `(장소=연합뉴스)`가 **이어질 때만** 그 앞을 사진 설명으로 보고 자른다. 본문 속 날짜·이메일은 이 조건을 만족하지 않는다.
   - 엔가젯 머리: 700자 안의 `Add Engadget on Google: Preferred Source Google Discover`까지 자른다(번역 전 영문 단계). 이미 번역돼 정본·캐시에 고정된 `Google에 Engadget 추가: 기본 소스 Google Discover`도 같은 자리에서 자른다(Root 요청, 정본 고정 단계 재정리 경로).
   - 테크크런치 영상: 700자 안의 `Loading the player…` / 번역문 `플레이어 로드 중…`까지 자른다(메뉴가 앞에 있으면 함께 사라진다).
   - 게시자 제휴 고지문: `(이|본) (포스팅|게시물|글)은 … 활동의 일환으로, 이에 따른 일정액의 수수료를 (제공|지급)받(을 수 있)습니다` 문장만 제거. 앞뒤 상품·가격·쿠폰 문장은 그대로다.
   - 기사 끝의 **연합뉴스 기자 이메일(`@yna.co.kr`) 한 토큰만** 제거(기존 꼬리 UI 제거 다음 단계). Grok 반례 `문의는 press@example.com`처럼 다른 주소나 문장 안의 이메일은 건드리지 않는다.
3. **실시간 `og:description`도 같은 정리를 거치게** — `makeEnricher.applyMeta`가 `meta.desc`를 `cleanArticleTextChrome`에 통과시키고, 비거나 제목과 같거나 깨진 글자가 있거나 `looksLikePageChrome`이면 발췌로 쓰지 않는다. `article-summary.js sourceLinks`가 이미 쓰는 판정과 같다. 캐시 형식·네트워크 동작은 그대로다.

## 3. 실제 교정 예 (같은 입력, 수정 전 → 후)

스냅샷 `textKo`를 정리 함수에 다시 넣은 결과(정본 고정 단계 `slot-canonical-edition.js:195`와 같은 호출):

- #35 `(수원=연합뉴스) 홍기원 기자 = 16일 경기도 수원시 … 구호를 외치고 있다. 2026.7.16 xanadu@yna.co.kr (서울=연합뉴스) 임성호 김민지 기자 = 삼성전자의 …`
  → `(서울=연합뉴스) 임성호 김민지 기자 = 삼성전자의 가전 등 완제품을 담당하는 디바이스경험(DX) 부문 …`
- #3 `(서울=연합뉴스) 윤동진 기자 = 조현 외교부 장관이 26일 … 주재하고 있다. 2026.8.26 mon@yna.co.kr (서울=연합뉴스) 김지헌 기자 = …` → `(서울=연합뉴스) 김지헌 기자 = 조현 외교부 장관이 대홍수가 발생한 네팔을 방문한다고 …`
- #20 `[네팔 교민 문광진씨 제공. 재판매 및 DB 금지] (랄릿푸르[네팔]=연합뉴스) 손현규 특파원 = …` → `(랄릿푸르[네팔]=연합뉴스) 손현규 특파원 = …`; 문단 사이의 같은 크레딧도 사라짐.
- #29 `[이태호 제작] 사진합성·일러스트 (익산=연합뉴스) 정경재 기자 = … 조사하고 있다"고 말했다. jaya@yna.co.kr` → `(익산=연합뉴스) 정경재 기자 = … 조사하고 있다"고 말했다.`
- #31 `[연합뉴스 자료사진] (서울=연합뉴스) 임성호 기자 = …` → `(서울=연합뉴스) 임성호 기자 = …`; #16 `[촬영 조승한] …`, #23 `(부산=연합뉴스) 강선배 기자 = … 2026.9.4 sbkang@yna.co.kr …`도 같은 방식으로 정리.
- #27 `Big Tech Microsoft Microsoft는 … 작성자: Devindra Hardawar 2026년 9월 4일 오전 10:05 EST dennizn/Shutterstock Google에 Engadget 추가: 기본 소스 Google Discover Windows 11을 …` → `Windows 11을 덜 짜증나게 만들려는 추세에 따라 Microsoft는 오늘 … Project Zenith를 발표했습니다. …`
- #30 `뉴스 EVs 및 교통 Tesla는 … 작성자: Mariella Moon … Google에 Engadget 추가: 기본 소스 Google Discover Tesla는 차량을 …` → `Tesla는 차량을 공개한 지 거의 2년 만에 Cybercab 로봇택시를 공식 출시했습니다. …`
- #9 `2026년 중단: OpenAI, Anthropic, Replit 등이 … 문의하기 플레이어 로드 중… 이제 Apple의 …`(메뉴 약 520자) → `이제 Apple의 공식적으로 Ternus 시대가 되었습니다. Tim Cook는 이번 주에 CEO에서 물러나 …`
- 실시간 1위 og:description → `금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8 금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8` (고지문만 제거, 게시글 내용은 유지).

원문 HTML을 다시 넣은 결과(`fetchPublicArticle` → 발췌 생성 단계 정리까지):

- 연합뉴스 6페이지 모두 본문 발신지 `(서울=연합뉴스) … 기자 = `부터 시작하고 마지막 본문 문장에서 끝난다(사진 설명·크레딧·이메일·가입 유도 0).
- 엔가젯 2페이지: `Continuing the trend of trying to make Windows 11 suck less, …` / `Tesla has officially launched the Cybercab robotaxi, …`부터 시작.
- 테크크런치 영상: 메뉴 약 560자와 플레이어 안내가 사라지고, 상단 이벤트 배너 두 문장(약 130자)만 남는다(§6).

스냅샷 발췌 42건 전수: 변경 10건은 연합뉴스 사진 표기 7건(#3·#16·#20·#23·#29·#31·#35)과 번역된 엔가젯·테크크런치 머리 3건(#27·#30·#9)뿐이고, 나머지 32건은 한 글자도 바뀌지 않았다.

## 4. 테스트

- `node --test --test-timeout=180000 test/enrich.test.js` → **79/79 통과**(기존 73 + 신규 6).
  - 신규: 연합뉴스 사진 설명·크레딧·이메일(실측 원문), 본문 속 날짜·이메일·대괄호 보존, 엔가젯·테크크런치 영문 머리 + 번역문 경계(실측 번역문), 게시자 제휴 고지 vs 상품·쿠폰 보존, 문단 폴백 컨테이너 제외(연합 구조 픽스처), enricher og:description 정리·사이트 소개 제외.
- 정리 함수를 가져다 쓰는 7개 스위트 `article-summary`·`briefing-quality`·`editorial-serving`·`slot-canonical-edition`·`slot-detail-reuse`·`slot-canonical-prepublish`·`store-durability` → **254/254 통과**.
- 전체 `npm test`(번역문 경계 추가 전, Root 작업분이 섞인 작업 트리에서 1회): 1,951건 중 통과 1,909·실패 13·취소 1. 실패 13 중 1건은 내 새 픽스처(연합 세 줄 요약이 `<header>` 안이라는 실측을 반영해 수정, 현재 79/79)이고, 나머지 12건(`ad-variety`·`admin`·`affiliate-card`·`lead-safety`·`monetize`(timeout)·`review-20260729`·`selection-contract` baseline lock·`sw-version`·`unified-view-switch`)은 깨끗한 HEAD 워크트리에서 **내 변경 유무와 무관하게 똑같이 실패**했고(12 fail + 1 cancelled 동일) `enrich.js`를 가져오지 않는다. Root 지시로 광역 재실행은 여기서 중단했다.
- 적대 입력 시간: 16,000자 대괄호·날짜·이메일·괄호 반복 입력 모두 2ms 이내(정규식 상한 확인).

## 5. 보존 확인 (지우면 안 되는 것)

- 정상 기사 속 이메일: `신고는 report@example.go.kr으로 접수한다고 밝혔다`, 끝에 오는 `행사 참가 신청과 문의는 press@example.com` 모두 유지(테스트). 연합 기자 `@yna.co.kr` 끝 토큰만 제거.
- 제목 라벨 대괄호: `[제작비 논란]`, `[촬영본 유출]`, `[속보]`, `[기금 전용]` 유지(테스트, Grok 반례 포함).
- 상품·쿠폰 내용: 핫딜 게시글의 상품명·가격·쿠폰 문장 유지(테스트). 게시자 링크도 지우지 않았다(요청 범위 밖).
- 지금핫 자체 광고 고지: `ad-copy.js AD_DISCLOSURE`·`monetize.js DISCLOSURE_TEXT`는 광고 슬롯 응답(`server.js:3137`, `monetize.js:493`)에 상수로만 실리고 정리 함수·enricher를 지나지 않는다. 화면의 지금핫 고지는 영향 없다.
- 기존 동작: 73개 기존 테스트와 관련 7개 스위트가 그대로 통과. 문단 폴백에서 `form`은 계속 읽는다.

## 6. 남은 한계 (수리하지 않음)

1. **BBC 바이라인(#4)** `By Zoe Kleinman Technology & AI editor 4 September 2026`: `<header>` 밖 별도 div라 이번 컨테이너 규칙에 안 걸린다. 발행사별 문구 규칙은 넣지 않았다.
2. **Letem světem Applem(#44)** 카테고리·저자·`17시간 전 0` 인포라인: 같은 이유로 잔존.
3. **테크크런치 이벤트 배너** 두 문장: `display:none` div 안 `<p>`라 의미 태그 기준으로 걸러지지 않는다.
4. **이미 번역돼 캐시된 요약**: 발췌 캐시(`READY_CACHE_MS` 24시간) 안의 번역문은 정본 고정 단계 재정리로만 고쳐진다. 엔가젯 위젯·테크크런치 플레이어 경계와 연합뉴스 표기는 번역문 규칙이 있어 바로 적용되지만, 그 밖의 번역된 크롬(BBC 바이라인 등)은 소급되지 않는다. 기계번역 문구가 달라지면 번역문 경계는 빗나갈 수 있고, 그 경우 영문 단계 규칙이 다음 수집분부터 막는다.
5. **실시간 기존 풀**: 이미 `item.summary`가 채워진 글은 수집 때마다 이전 값을 물려받고(`engine.js:1646`) `feed-pool.json`으로 재시작을 넘긴다. 이번 수정은 **새로 보강되는 글부터** 적용된다. 지금 화면의 오염 요약까지 즉시 고치려면 §7의 Root 권고가 필요하다.
6. **이토랜드 2문장 사이트 소개문(실시간 5위)**: `looksLikePageChrome`의 소개문 판정이 1문장 전체 일치만 본다. 제안(Root 판단): 해당 정규식 끝의 `$` 앞에 `(?:\s*[^.!?…]{0,120}(?:참여하세요|확인하세요|만나보세요)[.!?…]*)?`를 허용하면 이 사례가 걸리고 기존 테스트에는 영향이 없다. 요청 범위 밖이라 적용하지 않았다.
7. 고지문 변형: `이 포스팅은` 같은 주어 없이 `쿠팡 파트너스 활동의 일환으로 …`만 있는 문장은 남는다(문장 앞부분을 잘못 먹지 않으려는 의도적 한계).
8. 실측에 없던 크레딧 형식 `[삼성전자 제공]`, `[AP=연합뉴스]`와 연합 외 매체의 끝 기자 이메일(`@newsis.com` 등)은 지우지 않는다. Root 채택 조건대로 실측 형식으로 범위를 좁힌 결과이며, 다음 판에서 실측되면 같은 자리에 형식을 추가하면 된다.

## 7. Root 통합 권고 (engine.js는 손대지 않음)

실시간 화면이 지금 들고 있는 요약까지 고치려면 출력 직전 한 곳에서 같은 정리를 거치면 된다.

- 위치: `src/feed/engine.js` `_decorate()` — `const publicItem = { ...item };` 다음, `publicItem.image = safeImage(publicItem.image);` 옆(현재 2506행 부근).
- 내용: `publicItem.summary = typeof publicItem.summary === "string" ? cleanArticleTextChrome(publicItem.summary) : ""; if (looksLikePageChrome(publicItem.summary)) publicItem.summary = "";`
- import: `engine.js:25`의 `import { isJunkImage } from "./enrich.js";`에 `cleanArticleTextChrome, looksLikePageChrome` 추가.
- 효과: 복원된 풀·이월된 요약·SSR 카드가 모두 같은 규칙을 지난다. `rankingTop`(2790행)의 `i.summary.slice(0, 200)`은 `_decorate`를 지나지 않으므로 같은 줄을 원하면 별도 적용. 제휴 슬롯(`kind=affiliate`)은 `_decorate`를 지나지 않아 지금핫 고지에는 영향이 없다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`, 프로젝트 메모리 `MEMORY.md`.
  - 직접 읽음: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(전문, 13원칙·§11.1 포함), `04_WRC_AI_CONTEXT_WIKI_RULES.md`(전문), `05_RULE_ENFORCEMENT_PROTOCOL.md`(전문), `PMO_LIVE_BOARD.md`(상단 80줄 + NowHot 검색 0건), `REPORT_READ_INDEX.md`(상단 60줄 + NowHot 검색 0건), NH123 Root 보고 `NOWHOT_NH123_POSTRELEASE_VALIDATION_2026-09-05.md`, NH123 Fable 보고 `NOWHOT_NH123_FABLE_CONTENT_REVIEW_2026-09-05.md`.
  - 미읽음/불가: PMO 보드·색인 하단 과거 이력(무관), 개발현황 정본(Root가 통합 시 갱신), David 실기기.
  - 이번 작업 전용 파일: `src/feed/enrich.js`, `test/enrich.test.js`, 호출자 `article-summary.js`·`slot-canonical-edition.js`·`engine.js`(읽기), `/tmp/nh123-today.json`, 이전 세션 `live.json`, 원문 13페이지, `communities.json`(이토랜드 어댑터), `ad-copy.js`·`monetize.js`(자체 고지 경로 확인).
- 적용한 규칙: 입력 분류(승인→확정 지시, Root 최종 채택 조건 2건 반영), 13 First Principles, Canonical §11.1 최소 충분 변경(내 파일 2개만, 기존 함수 재사용, 새 필터·의존성 0), 이익 우선(기능·출처·커뮤니티 축소 0, 면책문구 추가 0), 역할 경계(engine.js는 권고만), 코드 생성 전 Corridor analyzePlan 실행(권고: 입력 상한·정규식 상한 유지 → 적대 입력 시간 측정으로 확인).
- First Principles 게이트: PASS.
- 개발현황 반영: Root 통합 시 NH123 레코드 `NOWHOT-POSTRELEASE-VALIDATION-001` 후속으로 연결 요청. 이 세션은 개발현황 정본을 수정하지 않았다.
- 금지선 준수: 커밋·배포·판본 강제 생성·광고 클릭·계정 제출·유료 호출·개인 브라우저·`.serena`·`.superpowers` 접촉 0. 원문 페이지 13건은 서버와 같은 공개 UA로 1회씩 읽기만 했다.
- David 행동 필요 여부: 없음. §6-6 정규식 확장과 §7 실시간 출력 정리는 Root 통합 판단.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO — 삭제 대상은 사진 표기·페이지 크롬·타사 고지문뿐이고, 상품·쿠폰·정상 기사·자체 고지는 보존. 덜 제한적인 대안(og:description 무조건 대체, 이메일 문장 전부 삭제)은 채택하지 않았다.
- 하지 않은 일: engine.js·event-cluster·독자 제목·출처 링크 수정, 발행 강제 재생성, 캐시 무효화, 실시간 기존 풀 정리, BBC·Letem·테크크런치 배너 규칙, 사이트 소개문 판정 확장, 커밋.
