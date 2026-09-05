# NOWHOT NH124 Grok 발췌 diff 검수 (2026-09-05)

- 작업자: Cursor Grok 4.6 xhigh (Orca 워커 `task_b329a7d93c0a` / dispatch `ctx_6014e1ea36f8`). 읽기 전용. 제품·테스트·정본 미수정. 커밋·배포·유료·브라우저 없음.
- 대상: Fable `src/feed/enrich.js` (+50/−3), `test/enrich.test.js` (+129). Live 우회 확인을 위해 호출부만 읽음(`engine.js` `_cleanItemSummary`/`getFeed`, `fetchers.js` RSS summary, `article-summary.js`, `slot-canonical-edition.js` 빌드·서빙).
- David 입력 분류: **승인**(NH123 오늘 발췌 오염·실시간 제휴 고지 오인 수리). 이 검수는 채택 여부다.

## 판정

**GO** — Fable 정규식·문단 폴백·오늘판 경로. 블로킹 과삭제 없음.

제한(PASS로 접지 않음):

1. **`makeEnricher.applyMeta`만으로는 Live가 닫히지 않는다.** RSS/Atom은 수집 때 `summary`를 이미 넣고, 풀은 빈 리스트 글을 `prior.item.summary`로 채운 뒤 fill을 건너뛴다. 이토랜드 HIT는 리스트에 발췌가 없어 신규 fill은 닫히지만, 이미 더러워진 풀 값은 fill을 영구 우회한다.
2. **워킹트리 `engine.js` `_cleanItemSummary` 4줄이 Live 길목이다.** HEAD는 미번역 영문만 비운다. 현재 미커밋 분기는 `via!=="ourdeal"`이고 `kind`가 `ad`/`affiliate`가 아니면 `cleanArticleTextChrome` + `looksLikePageChrome`을 `_items()`(따라서 `getFeed`)마다 돌린다. 이 4줄 없이 enrich.js만 나가면 실시간 1위 제휴 고지는 남는다. **발췌 패치와 같이 둔다. 새 필터를 또 만들지 않는다.**
3. **서빙 런치 JSON은 읽기 때 다시 안 닦는다.** `cleanArticleTextChrome`은 `buildSlotCanonicalEdition`과 `article-summary` 생성에만 있다. 옛 `c1e006868413` 후보는 코드 GO만으로 안 바뀐다. Root 재빌드·포인터 활성화가 화면이다.

## 질문별 답

### 전역 대괄호·끝 이메일이 기사 본문을 지우는가

대괄호는 전역 `[...]` 삭제가 아니다. `제공|자료사진|촬영|제작|=연합뉴스`가 있는 대괄호만 지운다. 테스트가 남기는 `[속보]`·`[기금 전용]`은 그대로다.

로컬 반례(모듈 직접 호출, 네트워크 없음):

| 입력 | 결과 | 취급 |
|---|---|---|
| `[속보] 정부가…` | 보존 | 의도 |
| `[기금 전용]` | 보존 | 의도 |
| `[제작비 논란] 정부가…` | 라벨만 삭제 | 비블로커. `제작`/`촬영` 부분문자열 |
| `[촬영본 유출] 영상이…` | 라벨만 삭제 | 위와 같음 |
| `문의는 press@example.com` | `문의는` | 비블로커. 끝 토큰은 도메인 무관 |
| `…말했다. jaya@yna.co.kr` | 문장 보존, 메일만 삭제 | 의도 |

본문 중간 이메일은 `\s+email\s*$`라 안 지운다. 테스트의 `press@example.com에` 보존과 일치.

최소 조임(채택 후 여유 있을 때만, 이번 블로커 아님): 대괄호는 `제공.?\s*재판매`·`자료사진`·`촬영\s` 선행·`제작]\s*사진합성`으로. 끝 메일은 `@yna.co.kr`만.

### 사진 캡션 정규식

첫 1400자에서 `YYYY.M.D [optional @yna.co.kr]` 다음에 `(장소=연합뉴스)`가 오는 **마지막** 매치 뒤를 남긴다. 캡션→본문 발신지 실측 픽스처는 테스트 통과.

주석 주장(“본문 속 날짜는 이 조건을 만족하지 않는다”)은 `2026.9.5 발표`처럼 발신지가 바로 안 붙는 경우만 맞다. 반례 `정부는 2026.9.5 (서울=연합뉴스) 발표에서…`는 날짜 앞을 잘라 `(서울=연합뉴스) 발표에서…`만 남긴다. 연합 본문은 보통 첫머리가 `(장소=연합뉴스)`이고 날짜는 `5일`이라 실측 확률은 낮다. 블로커 아님.

캡션이 없고 본문이 `(서울=연합뉴스)`로 시작하면 매치 0, 본문 유지.

### Live가 makeEnricher.fill을 우회하는가

우회한다. fill이 아니다. 길목은 `_cleanItemSummary`다.

```
수집 RSS summary(stripHtml만) ──┐
리스트 빈 summary + prior 이월 ─┼→ applyMeta는 !item.summary일 때만 chrome
이토랜드 신규 og:description ──┘     (이 경로만 Fable applyMeta가 닫음)
        ↓
_items() → _cleanItemSummary → getFeed _decorate가 summary를 그대로 그림
```

- `fetchers.js`: RSS description → `item.summary`. `needsWork`가 이미지를 이유로 fetch해도 summary는 안 덮는다.
- `engine.js` 풀 이월: `if (!item.summary && prior.item.summary) item.summary = prior.item.summary`. 더러운 값이 있으면 영구 fill 스킵.
- 이토랜드 어댑터는 제목·URL·숫자만. 신규 글의 빈 summary는 applyMeta가 닦는다. **이미 채워진 핫딜 고지는 applyMeta가 못 닦는다.**
- HEAD `_cleanItemSummary`는 `summaryTranslated===false`만. 워킹트리 4줄이 RSS·이월·og 잔여를 한 곳에서 닦고, `looksLikePageChrome`으로 이토랜드 사이트 소개문을 빈 칸으로 만든다(NH123 실시간 #5).

`rankingTop`의 중복 발췌 필터는 같은 소개문이 여러 장에 붙을 때만 지운다. 글마다 다른 제휴 고지 문장은 못 지운다. `_cleanItemSummary`가 그 구멍이다.

### 게시자 제휴 고지 vs 우리 쿠팡 고지

제휴 정규식은 `이|본` + `포스팅|게시물|글` + `활동의 일환으로` + `일정액의 수수료를 제공|지급받…습니다`다. 테스트가 남기는 “쿠팡 파트너스 수수료 체계가 바뀐다”는 비매칭.

`ad-copy.js` `AD_DISCLOSURE` 전문은 **이 함수에 넣으면 빈 문자열이 된다**(로컬 확인). 주석 “이 함수를 지나지 않는다”는 HTML 슬롯 상수(`server.js` aside, `index.html` `coupangCardHtml`, `/api/config` disclosure)에는 맞다. 우리 딜은 `_cleanItemSummary`가 `via==="ourdeal"`과 `kind` `ad`/`affiliate`를 건너서 카드 필드 `item.disclosure`를 지하지 않는다. 커뮤니티 핫딜은 ourdeal이 아니므로 게시자 고지만 지워지고 상품·가격·쿠폰은 남는다(이토랜드 픽스처).

### 본문 vs 메뉴

`paragraphText`는 `figure|header|nav|footer|aside|script|style|noscript|template|svg`를 닫는 태그까지 들어낸 뒤 `<p>`를 모은다. `form`은 옛 게시판 본문 통로라 유지. 연합 `<header>` 세 줄 요약·`<figcaption><p>`·핸들바 `<script>`·`<footer>` 채널 안내는 픽스처에서 본문에 안 섞인다. TechCrunch 메가메뉴 문자열은 태그 밖 머리 700자의 `Loading the player…` 컷이 본문 시작을 연다.

## 회귀 커버

집중 테스트 7/7 PASS(`node --test --test-name-pattern=… test/enrich.test.js`). 음/양이 NH123 오염과 맞다.

- 음: 캡션·크레딧·기자 메일·Engadget 위젯·TechCrunch 플레이어·제휴 고지·figure/header/script `<p>`·사이트 소개 og.
- 양: `[속보]`/`[기금 전용]`, 문장 안 메일·날짜, 쿠팡 수수료 **뉴스** 문장, 핫딜 상품 줄, 본문 발신지.

빠진 단건(비블로커): `summary`가 이미 있는 applyMeta 우회, `_cleanItemSummary` ourdeal 보존, `[제작비 논란]`.

## 하지 않은 일 / 다음 행동

광역 스위트, 풀 전수, 후보 빌드, 포인터, 코드 편집 없음. 정규식 반례와 호출부만 확인.

다음 행동 1개: Root가 이 클리너가 들어 있는 워킹트리로 런치 후보를 다시 얼리고 포인터를 활성화한다. `engine.js` `_cleanItemSummary` 4줄을 발췌 패치에서 빼지 않는다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: Cursor 규칙, Orca 워커 프리앰블, Mem0 훅(키 없음·미사용), WRC review-gate.
  - 직접 읽음: Fable enrich.js/test diff, `engine.js` `_cleanItemSummary`/`getFeed`/`풀 이월`, `fetchers.js` RSS summary, `article-summary.js` excerpt, `slot-canonical-edition.js` 빌드 vs reader, `ad-copy.js` `AD_DISCLOSURE`, 선행 NH124 최종 검수 보고.
  - 미읽음/불가: 운영 VM 활성 포인터, 새 런치 후보(Root 병행), 풀 JSON 전수.
  - 이번 작업 전용: 이 보고서. `/tmp`·제품 파일 0.
- 적용한 규칙: 승인, 13원칙, 검수 게이트(제한을 PASS로 접지 않음), 읽기 전용, 유료 0.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — 검수 보고.
- 금지선 준수: 산출물 이 보고서 1개.
- David 행동 필요 여부: 없음.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. 게시자 고지를 우리 광고처럼 안 보이게 하면서 쿠팡 슬롯 고지는 상수·ourdeal 스킵으로 남긴다. 전역 대괄호 삭제·새 Live 필터 추가 없음.
- 하지 않은 일: enrich.js 수정, 테스트 수정, 후보 빌드/활성화, 커밋/배포.

## 추록 — Root mailbox 반영 (msg_6c51f7fe84cd / msg_ddaa8aa42ce8 / msg_3cce404a4c71)

Root 조정: engine `_cleanItemSummary` 공통정리 199/199, `before …, report claims` 배경절 제외·p30 6행 190/190는 전제로 둔다. 이 추록은 남은 두 질문만.

### 1) enrich 실제 과삭제 블로커

**없음.** 후보 `7d306ffcf5ec` issueTable 193건에 `cleanArticleTextChrome`을 그대로 돌렸다. 연합 문체 23건에서 기자명 소실·본문 공백 0. 위젯 컷은 본문 첫 문장(`Windows 11을…`, `Tesla는 차량을…`, `Volkswagen은 이사회…`, `이제 Apple의…`)을 남긴다.

이론 반례(`[제작비 논란]`, 끝 임의 도메인 메일, 본문 `2026.9.5 (서울=연합뉴스)`)는 이 후보에 없다. 이번 채택을 막을 실측 과삭제는 아니다.

### 2) Fable 번역 캐시 경계

**맞다.** 7d306에 남은 한국어 크롬 실측값은 Fable 대안과 같다.

- Engadget 3건: `Google에 Engadget 추가: 기본 소스 Google Discover` (Zenith 198자, Tesla 129자, VW 164자 — 모두 700자 안).
- TechCrunch Ternus: `플레이어 로드 중…` 362자. 컷 뒤 `이제 Apple의 공식적으로 Ternus 시대가…`.
- 정리 후 잔여: Engadget 위젯 0, `플레이어 로드 중` 0, Brand Studio 0.
- 광역 오탐 없음: Phys.org `GIST 기본 소스로 추가` 유지. 테니스/게임 본문의 `플레이어`는 `플레이어 로드 중`이 아니라서 유지.

`에서?`는 `Google에`/`Google에서` 둘 다 잡는다. 영문 `Add Engadget on Google: Preferred Source Google Discover`와 `Loading the player…`도 같은 자리. 더 넓은 메뉴 정규식은 필요 없다.

서빙 reader는 textKo를 다시 안 닦는다. 다음 후보는 이 함수로 다시 얼리면 위 4건이 빠진다.

### 3) before-절 의미 반례 (요청 범위만)

BBC 원제 `… before Hugging Face hack, report claims` → 토큰 `openai, hijacked, german, website`. huggingface/hack이 빠져 p30(캘리포니아 AG)과 안 붙는다. 주절 `OpenAI agents hijacked German website`는 남는다. 범용 before 삭제는 이 표본에 필요 없다. 의미 반례는 “진짜 사건이 before 꼬리에만 있는 제목”인데 이번 6행에 없다. 확장하지 말 것.

