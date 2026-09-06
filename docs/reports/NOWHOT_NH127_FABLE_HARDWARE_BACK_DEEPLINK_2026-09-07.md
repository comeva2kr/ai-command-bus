# NOWHOT NH127 Fable — Android 하드웨어 뒤로가기가 딥링크에서 앱을 나가는 원인·최소 수정 권고 (2026-09-07)

- 작업자: Claude (Orca 워커 `task_5002eb403e2b` / dispatch `ctx_e780f83bfabf`). 코디네이터 긴급 범위 변경으로 **읽기 전용 원인규명·수정 권고 인수인계**로 종료. Root가 공개 파일 전부(`src/feed/public/navigation-history.js`, `index.html`, `today.html`, `sw.js`)와 `test/browser-navigation.test.js` 구현 인수. **내 제품 코드·테스트 수정 0**. 커밋·배포·푸시·유료 호출·실사용 알림 발송 0. 산출물은 이 보고서 1건.
- David 입력 분류: 질문/제보(안드로이드 하드웨어 뒤로가기가 딥링크에서 앱을 나감) → 코디네이터 확정 지시(실험 중단·범위 동결·Root 인수·보고서 작성).
- Corridor analyzePlan(코드 작성 전 호출) 결과: 기존 URL 리다이렉트 allowlist(`origin===location.origin` + pathname 화이트리스트)와 서비스워커/클라이언트 경로 입력 검증을 유지하라는 가드만 반환. 아래 권고는 그 두 가드를 **손대지 않는** 전제로 설계했다.

## 1. 결론 (한 줄)

푸시 알림·공유 딥링크로 **차갑게(사용자 조작 없이)** 열린 문서에서 앱이 "목록+상세" 히스토리 항목을 만드는데, Chromium의 히스토리 조작 개입(history-manipulation intervention) 때문에 사용자 제스처 이전에 만든 "목록" 항목이 **뒤로가기 대상에서 빠져** 하드웨어 뒤로가기가 앱을 나간다. 사용자가 한 번이라도 화면을 **탭**한 뒤 만든 항목은 정상적으로 뒤로가기 대상이 된다.

## 2. 재현 증거 (실측, 헤드리스 Chromium 148 / macOS arm64)

세션 scratchpad의 Playwright 실험으로 측정. 하드웨어 뒤로가기는 CDP `Input.dispatchMouseEvent{button:"back"}`로 재현했다 — 안드로이드 하드웨어 Back과 같은 콘텐츠 계층 `CanGoBack/GoBack` 경로를 타고 같은 개입 규칙을 적용받는다.

| # | 경로 | 조작 전 히스토리 | 하드웨어 뒤로가기 결과 | 판정 |
|---|---|---|---|---|
| T6 | 차가운 `/live#post-ID` (브라우저 개시 내비 → 앱이 즉시 목록+상세 합성) | `[시작 | 상세]` — **목록 항목 없음** | `about:blank`(앱 이탈) | **버그 재현** |
| T7 | 차가운 `/p?id=ID` → `location.replace("/live#post-ID")` → 앱이 즉시 합성 | `[시작 | 상세]` — **목록 항목 없음** | `about:blank`(앱 이탈) | **버그 재현(스크린샷 공유링크 경로)** |
| E4 | 차가운 딥링크 → **실제 탭 1회** → 그 뒤 합성 | `[시작 | 목록 | 상세]` | 목록(정상) → 앞으로가기 상세(정상) | 대조(정상) |
| E5 | 차가운 딥링크 → **터치 스크롤만** | 활성화 안 됨(제스처로 안 침) | 여전히 이탈 | 스크롤은 구제 못 함 |
| E12 | 차가운 딥링크 → 마우스다운 | 활성화됨 | — | 탭/클릭이면 구제됨 |
| E7 | 차가운 딥링크 → 키 입력 | 문자키는 활성화, Escape는 활성화 안 됨 | — | 참고 |
| E10 | 비활성 상태에서 `replaceState(목록 URL)` + 합성 `PopStateEvent` | — | 페이지 기존 popstate 핸들러가 상세를 제자리에서 닫음, 항목 추가 없음 | 폴백 기반 검증됨 |

핵심: T6·T7은 **브라우저가 개시한 차가운 내비게이션**(= 실제 푸시 `openWindow`·카톡 인앱 브라우저의 공유링크 진입)에서만 재현된다. 사용자가 먼저 탭하면(E4/E5-tap/E12) 같은 합성이 정상 항목을 만든다. 터치 스크롤만으로는(E5) 구제되지 않는다.

## 3. 가장 작은 권고 수정 (Root 구현용, 새 의존성 0)

핵심 아이디어: **"목록/상세" 히스토리 분리를 문서의 첫 사용자 활성화까지 미룬다.**

1. `navigation-history.js` `open(detail, value, url, fromUrl=true)`의 차가운 딥링크 분기에서, 지금처럼 즉시 `replaceState(목록)+pushState(상세)`를 하지 말고, 로드된 단일 항목을 상세로 두고 일회성 활성화 리스너(`pointerdown`/`keydown`, capture, once)를 건다. `navigator.userActivation.hasBeenActive`가 참이 되는 순간 `replaceState(목록)+pushState(상세)`를 수행한다(화면 변화·이벤트 없음). — E4/E5-tap/E12로 검증: 제스처 이후 만든 항목은 항상 뒤로가기 대상이 된다.
2. `back()`를 helper에 추가: 활성화 이전이면 `replaceState(목록 URL)` 후 합성 `PopStateEvent`를 디스패치(기존 popstate 핸들러가 상세를 제자리에서 닫음), 활성화 이후면 `history.back()`. — E10으로 폴백 검증.
3. `index.html`의 상세 닫기 호출부(‹ backBtn, 딤 클릭, 스와이프 2곳, brandHome, mute)와 `today.html` `closeIssueDetail()`을 raw `history.back()` 대신 helper `back()`로 라우팅.
4. Chromium 한정 적용: `"userAgentData" in navigator`로 특성 감지해 다른 엔진은 현재 즉시 동작 유지. `test/detail-reading.test.js`가 이 파일을 가짜 `window/history/location/sessionStorage`로 eval하므로 `navigator`·`addEventListener`·`PopStateEvent` 전역은 전부 존재 가드로 감쌀 것.
5. 기존 `webUrl()` allowlist(`^https?:` + username/password 거부 + internal pathname 화이트리스트 `["/","/live","/index.html","/today.html","/p"]`)는 변경 금지(Corridor 가드).

## 4. 서비스워커·구독 배선 (읽기 전용 관찰 — Root가 인수·수정 진행 중)

- 관찰 시점 Root가 이미 `sw.js`를 `feed-shell-v147`로 올리고 프리캐시 셸에 `/push-client.js?v=20260907`을 추가, push 핸들러가 **서버가 준 `tag`를 존중**(없으면 `feed-digest`)하도록 바꿨다. 이는 내가 짚었던 태그 병합 문제(서버 `push.js`가 `live:<id>`·`today:<key>` 등 서로 다른 태그를 보내는데 SW가 태그를 고정하면 안드로이드가 알림을 하나로 합침)의 수정과 일치한다. 포그라운드 `NOWHOT_DIGEST` postMessage 분기는 공용 push-client로 이관되며 제거됐다.
- `notificationclick`는 매칭되는 클라이언트가 없으면 `clients.openWindow(url)`로 **차갑게** 연다 — 공유링크와 동일한 비활성 딥링크 경로다. 따라서 §3의 `navigation-history.js` 수정이 **푸시 클릭 경로의 뒤로가기도** 목록으로 돌아오게 만드는 핵심이다. `navigation-history.js`가 프리캐시되므로 수정이 설치된 클라이언트에 닿으려면 CACHE 이름 상승이 필요하고(v147로 이미 처리됨), Root 수정분도 이 세대에 함께 실려야 한다.
- 구독 배선(`index.html` `enableNotifications` → `pushManager.subscribe(applicationServerKey=VAPID)` → `API.subscribePush` → `/api/push/subscribe`, 서버 `push.js` `sendDigestPushes`/`sendEditionPushes`)은 안드로이드 전달에 일관적이며 **내 담당 파일 범위 안에서 클라이언트 결함은 발견되지 않음**.

## 5. 스크린샷 실체 (Grok 읽기 전용 영역 — 플래그만, 미수정)

첨부 스크린샷(카톡 '현지' 제보)은 **하드웨어 뒤로가기 트랩이 아니라** 다른 두 증상을 담고 있다:
1. 인앱 카드 "콘텐츠 설정으로 이 글의 표시가 제한되어 있어요" — `index.html:3932`, `/api/item`이 `code=TOPIC_FILTERED`를 줄 때 표시. 공유받은 글이 **수신자 기준 토픽 필터**에 걸린 것.
2. 공유링크 미리보기 이미지 미표시 — OG 이미지는 서버 `server.js` `sharePage()`가 방출(`og:image`=기사 이미지 또는 `/og.png` 폴백). 미표시는 통상 크롤러 캐시이거나 기사에 http(s) 이미지가 없는 경우.

둘 다 Grok 읽기 전용 배정 영역(콘텐츠 제한/OG)이라 **변경하지 않음**. 하드웨어 뒤로가기 트랩과는 별개 증상이며, 다만 셋 다 **같은 공유 딥링크 진입 경로**를 공유한다. Grok/Root 판단 필요.

## 6. 물리 기기 한계 (반드시 실기 검증)

- 재현·검증은 헤드리스 Chromium 148(macOS arm64)에서 CDP back 버튼으로만 수행. **실제 삼성 갤럭시 기기, Samsung Internet, 안드로이드 WebView, 카톡 인앱 브라우저**(David 제보·스크린샷의 실제 환경)와 **물리 Back 키·엣지 스와이프 제스처**는 이 환경에서 실행 불가.
- Samsung Internet·WebView는 개입 임계값이 Chrome과 다를 수 있음. §3 수정 배포 후 **David 실기에서 푸시 클릭→하드웨어 Back→목록 복귀, 공유링크→하드웨어 Back→목록 복귀**를 닫기 전 반드시 확인할 것.

## 7. 파일·테스트 요약

- **수정한 제품 파일: 없음.** `navigation-history.js`·`index.html`·`today.html`·`sw.js`·`browser-navigation.test.js` 모두 내 편집 0(Root 인수).
- **작성: 이 보고서 1건**(`docs/reports/NOWHOT_NH127_FABLE_HARDWARE_BACK_DEEPLINK_2026-09-07.md`).
- **기존 테스트 공백**: `test/browser-navigation.test.js`의 "cold Live detail owns a list entry…"(257행)·"real service-worker notification replaces a detail; Back returns to the list"(558행)는 Playwright `page.click`/`goBack`를 써서 **제스처를 부여**하고 스크립트 히스토리 스택으로 판정하므로, 개입을 **재현하지 못한다**(버그가 있어도 현재 통과). 필요한 추가: **제스처 이전** 차가운 딥링크에서 CDP `Input.dispatchMouseEvent{button:"back"}`(하드웨어 동급) → 목록 복귀, 앞으로가기 → 상세. 세션 scratchpad 실험 스크립트에 그 CDP 기법이 있으니 Root가 참고·이식 권고.

---

작업 시작 전 확인한 MD:
- 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`, NowHot 자동 메모리(`MEMORY.md`)
- 직접 읽음: `WRC_MANUS_HANDOFF/START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(0/7/8/9/11/11.1/11A), `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`(최소변경/브라우저격리/시작·보고·개발현황 게이트), `PMO_LIVE_BOARD.md`·`REPORT_READ_INDEX.md`(NowHot 항목 없음 확인), `docs/NOWHOT_DEVELOPMENT_STATUS.md`, `docs/reports/NOWHOT_NH126_FABLE_CONTENT_FIX_*`(보고 형식)
- 미읽음/불가: 실제 삼성 기기·Samsung Internet·카톡 인앱 WebView(환경 접근 불가, §6)
- 이번 작업 전용 파일: `src/feed/public/{navigation-history.js,index.html,today.html,sw.js}`, `test/browser-navigation.test.js`, `src/feed/{server.js,push.js}`, `test/detail-reading.test.js`, 제보 스크린샷 1장

적용한 규칙: Canonical §11.1 최소 충분 변경(제품 코드 미수정, 권고만), 브라우저 격리(Playwright 헤드리스 컨텍스트만, 개인 창·탭 미접근), 외부 행동 경계(커밋·배포·푸시 발송 0)

First Principles 게이트: PASS

개발현황 반영:
- 대상 안정 ID: `NOWHOT-DEEPLINK-BACK-NAV-001`(제안, Root 확정 예정)
- 변경 레코드: 해당 없음 — 내 제품 변경 0(원인규명·권고 인수인계). Root가 구현 시 DEVCHG 발번
- 대조 결과: 차가운 브라우저 개시 딥링크(T6/T7)에서 앱 이탈 재현, 제스처 후(E4/E5-tap/E12) 정상 대조 확인

금지선 준수: 준수(커밋·푸시·배포·실사용 알림·개인 브라우저·계정/콘텐츠 설정 변경 없음)

David 행동 필요 여부: 있음 — Root 수정 배포 후 **실기(삼성)에서 푸시 클릭·공유링크 → 하드웨어 Back → 목록 복귀** 확인(§6)

Telegram 알림 필요 여부: 없음(코디네이터 경유 인수인계)

이익 우선·과잉방어 점검: GO — 근거: 알림·공유 유입의 이탈 트랩 제거는 리텐션 직결, 수정은 기존 helper·SW 재사용에 특성 감지로 한정돼 위험 낮음. 덜 제한적 대안: Chromium 한정 적용으로 타 엔진 무영향.

하지 않은 일: 제품 코드·테스트 편집 안 함(Root 인수), 콘텐츠 제한/OG(§5, Grok 영역) 손대지 않음, 실기·인앱 WebView 검증 못 함(환경 불가), 추가 실험 중단(코디네이터 지시).
