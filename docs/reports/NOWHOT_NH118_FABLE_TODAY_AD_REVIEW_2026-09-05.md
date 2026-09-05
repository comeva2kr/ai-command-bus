# NOWHOT NH118 Fable 오늘판 광고 검토 — 오늘판 쿠팡 배치와 실시간 광고 미표시 원인 (2026-09-05)

- 검토자: Claude Fable 5.1 (읽기 전용, Orca 워커 `task_ef925c7a1dba` / dispatch `ctx_2202510afac2`)
- 대상: `/Users/hyundonghwang/Documents/NowHot-Local-Dev`, HEAD `416245b` (branch `codex/adfit-content-rescue-20260810`) + 검토 도중 나타난 root의 **미커밋 NH118 패치**(`today.html`, `server.js`, `index.html`, 테스트 2건, `tools/preflight.mjs`)
- 범위: 소스·정책 문서·잠금(테스트/preflight) 대조, 격리 헤드리스 Chrome 1회 측정, 공개 필터 목록(EasyList) 대조, 읽기 전용 테스트 실행. 제품·테스트 수정 0, 커밋·push·배포 0, 광고 계정·유료 호출 0, David 개인 브라우저 조작 0. 생성 파일은 이 보고서 1건.
- David 입력 분류: **확정 지시** 두 가지 — ① "기존 쿠팡 광고를 오늘판에도" ② "NH117 뒤에도 실시간 광고가 안 보인다"(오류 보고). ①은 기존 내부 규칙(오늘판 AdFit 단독)을 대체하며 재승인 불필요. 수정·배포는 root 소관.

## 1. 결론 3줄

1. **오늘판 쿠팡 배치는 root 미커밋 패치대로 GO.** 화면 쪽(`today.html`)에서 이미 내려오는 `/api/config`의 쿠팡 재고 18종·법정 고지문을 그대로 써서 3번째·13번째… 이슈 뒤와 상세 창에 제휴 카드를 넣는다. 이슈 순번(01, 02…)·기사 본문은 그대로다. 문법·공백·관련 서버 테스트 2/2·소스 형태 테스트 56/56을 이 검토에서 직접 통과 확인했다(브라우저 테스트는 root 실행분에 의존).
2. **실시간이 "아직 안 보이는" 원인은 서버가 아니라 David 쪽 브라우저 두 가지다.** (a) 광고 차단 확장: 기본 목록 EasyList가 쿠팡 배너 이미지 도메인을 막고 `.ad-card` 자체를 통째로 숨긴다 — NH117이 본 `ERR_BLOCKED_BY_CLIENT`와 Grok이 CDP로 본 `.ad-card display:none !important`가 정확히 이것이다. 차단기는 우회하지 않는 것이 기존 결정이라 코드로 고칠 대상이 아니고 **David가 차단기 없는 창에서 확인**해야 한다. (b) 몰입 모드 코드 결함: 몰입 모드에선 광고 링크가 상자 없는 요소가 되어 차단 판정기가 정상 광고를 지웠다. 격리 헤드리스 Chrome으로 재현했고 root 패치가 이를 고친다.
3. **작은 보완 4가지를 배포 전에 권고한다**(모두 몇 줄): 오늘판 광고가 방문자마다 같은 배너(로켓와우)로 고정되는 회전 없음, 정치 이슈 옆 광고 미차단, 고지문 11px(저장소 기준 12~13px), 그리고 `/`에서 AdFit 지면을 뺀 결정에 맞춘 정책 문서·preflight 정합. 마지막 항목은 재심사 관점의 WARN이며 하드 스톱은 아니다.

## 2. 실시간(Live) "NH117 뒤에도 안 보인다" — 원인 분해

| 후보 | 판정 | 근거 |
|---|---|---|
| 서버가 광고를 안 보냄 | **아님** | NH117 운영 영수증: 공개 `/api/config` `monetization.enabled=true`, `coupang.items=18`; 확장 없는 내장 브라우저에서 핫20·광고2. HEAD `416245b`는 NH117 뒤 문서 커밋뿐(`c2757dd` 이후 코드 변경 0). 세션 상한은 기본 무제한(`AD_MAX_PER_SESSION_DEFAULT=-1`, `monetize.js:74`), 첫 광고는 6번째 뒤·페이지당 2개(`:54-57`). |
| **광고 차단기(확장·콘텐츠 차단기)** | **가장 유력 — 코드 대상 아님** | EasyList(2026-09-05 easylist.to에서 직접 받음, 2,135,113바이트)에 `\|\|ads-partners.coupang.com^`(66179행: 배너 이미지 차단 → `ERR_BLOCKED_BY_CLIENT`), 일반 숨김 규칙 `##.ad-card`(6200행), `##.ad-native`(6569행), `##.ad-slot`(6767행)이 있다. Grok NH118 보고의 CDP 관측(`.ad-card`에 `display:none !important`, 몰입 OFF)은 Chrome 내장 기능이 아니라 이 목록을 쓰는 확장(uBlock·AdGuard·AdBlock 등)의 화장 필터다 — Chrome 자체는 사이트 클래스를 숨기지 않는다. 숨겨진 카드는 `dropIfAdBlocked()`(`index.html:2159-2171`)가 껍데기 방지를 위해 지우므로 DOM 개수도 0이 된다. **차단기 회피 금지는 기존 결정**(`index.html:2140-2158, 933-934` 주석)이며 이번에도 유지한다. |
| **몰입 모드 오판(코드 결함)** | **실재 — root 패치로 수정** | `body.immersion #feed .card.ad-card .card-go{display:contents}`(`index.html:852`)가 붙으면 링크 요소는 상자가 없어 `offsetParent===null`, 높이 0이 된다. HEAD 판정식은 이를 "차단됨"으로 보고 카드를 지운다. 격리 헤드리스 Chrome(`--headless=new`, 임시 프로필, 개인 창 미사용) 측정: `{"display":"contents","offsetParentNull":true,"rectHeight":0,"dropIfAdBlocked_hidden":true,"goTextHeight":95.4}`. 발생 시점: 차단 판정기 `97c161c`(08-06 13:55) 뒤 몰입 광고 레이아웃 `96e8f16`(08-06 15:27)이 들어오며 생긴 회귀. 몰입 설정은 `feed_immersion` localStorage로 유지되므로 한 번 켠 사용자는 매번 광고 0. 서버 삽입(`appendAdCard`→`:3678`)·화면 삽입(`:2315`)·패스백 카드 모두 같은 판정기를 타므로 전부 사라진다. |
| 저장 목록 복원 | 아님 | NH117이 `restoreLiveList()`에 `maybeInsertAdfit()`을 추가(`:1535`). 서비스워커는 탐색 요청을 네트워크 우선으로 처리(`sw.js:113-125`)하고 `/live` HTML은 `no-cache`라 새로고침 1회면 새 화면을 받는다. |
| 이미지 하나 차단 | 불충분 | `onerror`는 썸네일만 지우고 글자 카드가 남는 설계(`index.html:1978-1993`). 카드 전체 부재는 설명하지 못한다. |

### David 브라우저 2분 확인 절차 (root가 David에게 전달)

1. `https://nowhot.kr/api/config` 열기 → `coupang.items` 18개, `monetization.enabled` true면 서버는 정상.
2. `/live`에서 개발자도구 Console: `document.querySelectorAll("#feed .ad-card").length`, `document.body.classList.contains("immersion")`. Network에 `coupang`을 걸어 `(blocked:other)` 또는 `ERR_BLOCKED_BY_CLIENT`가 보이면 확장 차단기다. `chrome://extensions`에서 uBlock Origin·AdGuard·AdBlock 류 확인.
3. 확장이 꺼지는 **시크릿 창** 또는 다른 브라우저로 같은 페이지를 다시 본다. iPhone Safari는 설정 › Safari › 확장 프로그램/콘텐츠 차단기 확인 후, 새로고침 버튼을 길게 눌러 "콘텐츠 차단기 없이 재로드".
4. 몰입 모드가 켜져 있었다면 현재 운영판에서는 광고가 지워진다. 이번 패치 배포 뒤 몰입 모드에서 다시 확인.
5. 오늘판도 같은 규칙에 걸린다: EasyList의 `##.ad-slot`·`##.ad-native`가 오늘판 카드 전체(`aside.ad-slot.ad-coupang`)를 숨기므로 차단기 창에서는 오늘판 광고도 보이지 않는다. **차단기 없는 창에서 검수**해야 한다.

## 3. 오늘판 현재 구조 (HEAD `416245b`)

- `/`는 `localEditorial`(운영 `NOWHOT_LOCAL_EDITORIAL=1`, `server.js:623-625`)일 때 정적 `today.html`을 내보내며 `serveStatic()`이 `<!-- NOWHOT_DISPLAY_AD -->`(`today.html:215`, 우측 레일 안) 자리에 `displayAdHtml()`(AdFit 1단위)을, `</head>` 앞에 `adLoadersHtml(true)`(Kakao SDK)를 끼운다(`server.js:4703-4708`, `:400-402`). AdSense 메타·GA는 별도 주입(`:392`).
- 이 AdFit 지면은 **이슈 사이가 아니라 레일**에 있다. 860px 이하에서 레일은 목록 아래로 내려가고(`today.html:150-152`), 620px 이하에서는 페이지 맨 아래 한 칸이 된다. 심사 보류 상태의 AdFit은 실패 콜백 없이 빈 칸을 만든다(`server.js:3600-3610` 주석) — "빈 AdFit 지면"의 정체.
- 오늘판 화면은 이미 부팅 때 `/api/config`를 받는다(`today.html:869-873`). NH117 이후 이 응답에 `coupang = { disclosure, items(18), matrix }`가 포함되지만(`server.js:3643-3656`) HEAD의 오늘판은 그것을 쓰는 렌더러가 없다. `adfit.mobileUnit`은 항상 null(`:3613`).
- 이슈 목록은 `renderIssues()`가 `edition.issues.map((issue,index)=>…)`로 `article.issue`를 그리고 순번은 `index+1`(`today.html:466-501`, 484행). 상세는 `openIssueDetail()`이 `#detailContent`를 통째로 그린다(`:593-598`). 목록은 분야 변경·판 전환·뒤로가기 복원(`render(snapshot.edition)`) 때마다 다시 그려지므로 **렌더 함수 안에 넣으면 모든 경로가 한 곳으로 모인다**(실시간에서 복원 경로가 따로 필요했던 것과 다르다).

## 4. root 미커밋 패치 검토 (작업 트리 기준)

### 4.1 무엇을 하는가

- `today.html`: `state.coupang=config.coupang||null`; `todayAdHtml(issue,index,slot,seen)`이 `link.coupang.com` 링크만 허용, 고지문 없으면 그리지 않음, 이슈 분야와 같은 재고 우선, 같은 목록 안 중복 도착지 제외, 문구 행렬(`matrix`) 맥락 적용, `subId=today-feed-<index>`/`today-detail-<index>`, `rel="nofollow sponsored noopener"`, 이미지 `onerror`로 썸네일만 제거, 하단 법정 고지 전문. 목록은 `index>=2 && (index-2)%10===0`(3·13·23번째 이슈 뒤), 상세는 "기사 요약"과 "브리핑 포인트" 사이 1장.
- `server.js:4703-4708`: `/`에 AdFit 단위·SDK 주입을 중단(`serveStatic(res,"/today.html")`). `today.html`의 `<!-- NOWHOT_DISPLAY_AD -->` 제거.
- `index.html:2160-2171`: `dropIfAdBlocked()`가 링크가 `display:contents`일 때만 `.go-text`로 가시성을 재고, 링크 자체의 `display:none`/`visibility:hidden`은 그대로 차단으로 본다(회피 아님).
- 테스트: `briefing-quality` 오늘판 테스트를 "쿠팡 지면 연결·AdFit/AdSense 없음"으로 뒤집음; `browser-navigation`에 몰입+이미지 실패 유지 / 명시 차단 존중, 오늘판 순번·상세·복원 케이스 2건 추가. `preflight.mjs`는 `localEditorial`이면 오늘판 렌더러 존재와 `kakao_ad_area`·AdSense·네트워크 SDK 부재를 확인.

### 4.2 이 검토에서 직접 확인한 것

- `node --check src/feed/server.js` OK, `tools/check-inline-js.cjs` today/index 모두 "문법 OK", `git diff --check` OK.
- `node --test --test-name-pattern='오늘판 정적 홈|AdFit 심사 모드' test/briefing-quality.test.js` → 2/2 PASS. `inline-js`·`detail-reading`·`ad-variety`·`immersion`·`no-dangling-calls` → 56/56 PASS. (`detail-reading`의 소스 절편 검사는 `todayAdHtml`이 `renderIssues` 앞에 정의돼 절편 밖이라 그대로 통과.)
- 실제 `products.json` 18종으로 `todayAdHtml`을 격리 실행(placeholder 문구):
  - 뉴스 편성 3번째 이슈 뒤 3회 렌더 → 매번 **"쿠팡 로켓와우 멤버십"**; 경제 편성도 동일; 기술 편성만 "로켓 가전·디지털". 같은 렌더의 13번째 뒤는 "로켓 캠핑"(중복 제외는 동작).
  - 정치 분야 이슈 옆에도 카드가 그려짐.
  - 링크 샘플 `https://link.coupang.com/a/…?subId=today-feed-2` (형식 정상).
- 실행하지 않은 것: Playwright `browser-navigation`(이 환경에 playwright 미설치 → root 실행분 의존), 전체 회귀, 공개 preflight, 실기기.

### 4.3 판정과 보완 권고 (모두 root 몫, 각 몇 줄)

| # | 항목 | 판정 | 권고 |
|---|---|---|---|
| 1 | **회전 없음** | 품질 회귀(WARN) | 선택이 `pool[index%len]`·문구 `variants[index%len]`로 이슈 순번에만 매여 뉴스·경제 편성의 첫 광고가 모든 방문자에게 "로켓와우"로 고정된다 — David가 8/3·8/6에 지적한 바로 그 증상("모든 방문자가 같은 배너", "와우 가입하라는 것만"). 호출마다 시작점을 돌린다: 예 `const start=Math.floor(Math.random()*pool.length); const item=pool[(index+start)%pool.length];` 문구도 같은 방식. `seen` 중복 제외와 브라우저 테스트의 "링크 2개 상이" 단언은 그대로 성립. |
| 2 | **정치 이슈 인접** | 규칙 불일치(WARN) | 실시간(`adUnsafe`)·수동 재고(`manual-products.js` BANNED politics/religion/adult)·편집 지면(`AD_MATCH_OFF_CATS`, `server.js:111`)은 정치 옆에 광고를 두지 않는다. 오늘판 14개 분야에 정치가 있으므로 목록·상세에서 `categoryIds`에 `politics`가 있는 이슈(위·아래 둘 다)는 건너뛴다. 예: `const unsafe=(i)=>(i?.categoryIds||[]).includes("politics");` → 삽입 조건에 `!unsafe(issue)&&!unsafe(edition.issues[index+1])`, 상세는 `unsafe(issue)`면 빈 문자열. |
| 3 | **고지 글자 크기** | 기준 미달(경미) | 오늘판 `.ad-disclosure` 11px·`--sub`, `.ad-mark` 10px. 저장소 기준은 편집 지면 13px 본문색(`server.js:2570-2576`, AA 대비 사유), 앱 12px(`monetization.md:197`). 12~13px로 올리고 AD 표기는 편집 지면의 `.ad-tag` 반전 칩처럼 눈에 띄게. 겸사겸사 `.ad-coupang{border-top:0}`(기본 `.ad-slot`의 윗줄과 이슈의 아랫줄이 겹쳐 2px), 원하면 이슈 본문 열에 맞춰 `padding-left:66px`(620px 이하 42px). |
| 4 | **`/`의 AdFit 지면 제거** | 정책 충돌(WARN, 하드 스톱 아님) | 아래 §5. |
| 5 | 상세 광고 위치 | 판단 사항 | "기사 요약"과 "브리핑 포인트" 사이에 끼면 편집 블록이 갈라진다. 실시간 상세처럼 편집 내용 뒤(브리핑 포인트 다음, 출처 앞 또는 맨 아래)가 읽기 흐름에 덜 거슬린다. 노출 우선이면 현 위치도 가능 — David 취향 문제라 강제하지 않는다. |
| 6 | 측정 부재 | 선택(2단계) | 오늘판 카드는 `/api/ad-signal` 노출·클릭 기록이 없고 `KNOWN_AD_SLOT`(`server.js:2266`)에 오늘판 자리가 없다(쿠팡 콘솔 subId만 남음). 편집 지면의 `adTrackScript`(`:2412-2437`) 패턴을 옮기고 정규식에 `today-feed-\d{1,3}\|today-detail-\d{1,3}`를 더하면 관리자 화면에서 자리별 성과가 보인다. 이번 최소 범위 밖으로 둬도 된다. |
| 7 | 신뢰·안전 | 이상 없음 | 재고 출처는 서버 `/api/config`뿐, href 화이트리스트, `esc()`·`externalHref()` 적용, `noopener`, 고지문 필수, 이미지 실패 시 썸네일만 제거. 이슈 `article`이 아니라 `aside`라 순번·클릭 핸들러(`article[data-issue-index]`) 무영향. 만료 이벤트 배너를 `/api/config`가 거르지 않는 점은 실시간과 공통의 잠재 이슈이며 현재 재고에 `expires`가 없어 당장 영향 없음. |

## 5. 오늘판의 빈 AdFit 지면 — 판단

- 사실: AdFit은 심사 보류 상태에서 실패 콜백 없이 빈 iframe을 만들어 **채움 여부를 코드로 알 수 없다**(`server.js:3600-3610`, `index.html:2270-2280` 주석). 그래서 "쿠팡이 있을 때만 AdFit 빈 칸을 피하는" 조건부 로직은 만들 수 없고, 선택지는 지면을 두느냐 빼느냐뿐이다.
- root 패치는 `/`에서 지면과 SDK를 **뺐다**. 장점: 빈 칸·"AD" 스텁이 사라지고 오늘판은 쿠팡만 남아 단순하다. 조정자의 "쿠팡을 쓸 때 빈 AdFit 지면을 피하라"는 방향과 맞는다.
- 충돌: 정책 문서는 여전히 "심사 모드의 `/`에는 AdFit 한 단위만 있고 AdSense·쿠팡이 없다"(`docs/NOWHOT_ADFIT_RESCUE_001.md:13, 27` 승인 조건 4), `docs/monetization.md:393`, `deploy/docker-compose.yml:65-67` 주석("/·/briefing·발행 아카이브·/report … 한 단위")이다. 3차 반려 사유가 "광고를 설치한 이후 심사 진행이 가능합니다"였고 심사자가 가장 먼저 여는 주소는 루트다. 루트에 AdFit이 없고 제휴 카드만 있으면 재심사 때 불리할 **가능성**이 있다 — 저장소에 Kakao 규정 원문이 없어 확률·손실은 산정 불가(WARN). David 지시는 "쿠팡을 오늘판에도"이지 "AdFit을 오늘판에서 빼라"가 아니므로, 이 제거는 root의 추가 판단이다.
- 권고: 배포는 막지 않되 (1) 문서 세 곳을 "오늘판=쿠팡(David 2026-09-05), AdFit 심사 지면은 `/briefing`·발행 아카이브·`/report`"로 고치고, (2) 배포 보고에 "루트 AdFit 지면 제거"를 David에게 한 줄로 알리며, (3) 재심사 제출 직전에 루트 지면을 되살리고 싶으면 `server.js:4705-4708`의 `headHtml/bodyHtml` 인자와 `today.html`의 `<!-- NOWHOT_DISPLAY_AD -->` 한 줄을 복구하면 된다(4줄, 되돌리기 쉬움). 덜 제한적인 대안으로 "레일 맨 아래 AdFit 1단위 유지 + 이슈 사이 쿠팡"도 정책 문서와 충돌 없이 가능했다 — 빈 스텁은 페이지 맨 아래라 해가 작다.

## 6. 잠금(테스트·preflight·문서) 정합

- 뒤집힌 잠금: `test/briefing-quality.test.js` 오늘판 테스트(구 505행) — 루트에 `kakao_ad_area`·AdSense 없음 + `쿠팡 파트너스` 존재로 반전. SSR 편집 홈 테스트(416행, `localEditorial` 아님)는 그대로 AdFit 1단위·쿠팡 없음을 요구하며 운영과 무관하므로 유지가 맞다.
- `tools/preflight.mjs:96-100`: `localEditorial`이면 오늘판 렌더러 존재·AdFit/AdSense/SDK 부재를 검사. 대신 **심사 지면(`/briefing`)의 AdFit 1단위를 검사하는 항목이 어디에도 없다** — 운영은 늘 `localEditorial`이라 기존 "심사 홈에 AdFit 한 단위" 분기가 다시는 돌지 않는다. `reviewMode`일 때 `/briefing`에 `kakao_ad_area` 정확히 1·SDK 로드·`link.coupang.com` 0을 확인하는 항목을 추가하길 권고(값은 root가 실측 뒤 고정).
- "편집 홈 본문에 외부 링크 목록 없음"(`preflight.mjs:141`)은 서버 HTML만 보므로 그대로 통과한다. 화면 렌더 링크까지 보는 검사는 새 브라우저 테스트가 맡는다.
- 문서 갱신 필요: `docs/NOWHOT_ADFIT_RESCUE_001.md:13, 27`, `docs/monetization.md:393-395`, `deploy/docker-compose.yml:65-67`, `docs/NOWHOT_DEVELOPMENT_STATUS.md`(NH117 행의 "오늘판 지면 변경 없음"은 이력으로 두고 NH118 행 신설; 안정 ID 예 `NOWHOT-TODAY-COUPANG-001`, 변경 레코드 `DEVCHG-NOWHOT-20260905-205`는 root 지정), NH118 root 보고서.

## 7. root가 마무리할 항목 (순서)

1. §4.3의 1(회전)·2(정치 인접)·3(고지 크기)을 반영하고 `todayAdHtml` 격리 실행으로 3회 렌더가 서로 다른지 확인.
2. Playwright `test/browser-navigation.test.js` 신규 2건 + 기존 오늘판 케이스, `briefing-quality`·`inline-js`·`detail-reading`·`ad-variety`·`immersion` 재실행, `node --check`·`git diff --check`.
3. §5·§6 문서 세 곳과 preflight `/briefing` 항목, 개발현황 행.
4. 배포 뒤 공개 확인(GET만): `/api/config` `coupang.items=18`; 차단기 없는 브라우저의 `/`에서 03·13번째 뒤 카드, 순번 01…N 불변, 상세 카드·고지·새 창 링크; `/live` 몰입 모드 ON에서 광고 카드 유지; `/briefing` AdFit 1단위. 실제 클릭 없음.
5. David에게: 차단기 확인 절차(§2) 한 번, 루트 AdFit 지면 제거 사실 한 줄.

## 8. WRC 보고 블록

- 작업 시작 전 확인한 MD:
  - 자동 주입: `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`
  - 직접 읽음: `WRC_MANUS_HANDOFF/START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`, `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`(전문), `PMO_LIVE_BOARD.md`·`REPORT_READ_INDEX.md`(머리 + NowHot/NH11x/쿠팡/AdFit grep — 해당 행 없음)
  - 미읽음/불가: 운영 VM 환경변수, 광고 계정 화면, Kakao AdFit 운영정책 원문, List-KR 필터(raw 주소 404로 미확인), David 실제 브라우저·iPhone
  - 이번 작업 전용 파일: `src/feed/server.js`, `src/feed/public/today.html`, `src/feed/public/index.html`, `src/feed/public/sw.js`, `src/feed/engine.js`, `src/feed/monetize.js`, `src/feed/manual-products.js`, `src/feed/products.json`, `src/feed/ad-copy.js`, `src/feed/ad-networks.js`, `tools/preflight.mjs`, `test/briefing-quality.test.js`, `test/browser-navigation.test.js`, `test/inline-js.test.js`, `test/detail-reading.test.js`, `test/ad-variety.test.js`, `test/immersion.test.js`, `test/no-dangling-calls.test.js`, `deploy/docker-compose.yml`, `Dockerfile`, `docs/NOWHOT_ADFIT_RESCUE_001.md`, `docs/monetization.md`, `docs/NOWHOT_DEVELOPMENT_STATUS.md`, `docs/reports/NOWHOT_NH117_*`(3건), `NOWHOT_NH113_TODAY_OUTAGE_RECOVERY_2026-09-05.md`, `NOWHOT_NH118_GROK_LIVE_AD_REVIEW_2026-09-05.md`, git 이력(`c2757dd`, `97c161c`, `96e8f16`), EasyList 원문(2026-09-05)
- 적용한 규칙: 13 First Principles 게이트(입력 분류: 확정 지시 + 오류 보고), Minimal Sufficient Change(기존 재고·고지·렌더 경로 재사용, 새 의존성 0), 이익 우선·기본 허용(GO/WARN/BLOCK 분리 표기), 읽기 전용 경계, 전용 브라우저 격리(임시 프로필 헤드리스만 사용, 개인 창 미접촉), 5-filter(미검증 사실은 "산정 불가/미확인"으로 표기), Corridor analyzePlan 1회 실행(신규 지적 없음)
- First Principles 게이트: PASS
- 개발현황 반영: 해당 없음(읽기 전용 검토). root가 NH118 커밋 시 `NOWHOT-TODAY-COUPANG-001`/`DEVCHG-NOWHOT-20260905-205`(가칭)로 반영 권고.
- 금지선 준수: 제품·테스트·문서 수정 0(이 보고서만 신규), 커밋·push·배포 0, 광고 링크 클릭 0, 유료 API·광고 계정·VM 접근 0, David 개인 브라우저 창 미사용, 차단기 설정 변경·우회 제안 없음
- David 행동 필요 여부: 있음 — §2 절차로 본인 브라우저의 차단 확장 여부 확인(2분). 루트 AdFit 지면 제거는 인지만 필요, 추가 승인 불필요(쿠팡 오늘판 배치는 David 확정 지시).
- Telegram 알림 필요 여부: 없음(root 판단)
- 이익 우선·과잉방어 점검: **GO** — 오늘판 쿠팡 배치·몰입 모드 결함 수정은 실수익 경로 복구. **WARN** — 루트 AdFit 지면 제거는 재심사 관점 불확실성(근거 원문 없음, 손실 산정 불가); 덜 제한적 대안 = 레일 하단 AdFit 1단위 유지 또는 재심사 직전 4줄 복구. **BLOCK 없음.** 차단기 회피(클래스명 변경)는 기존 결정대로 제안하지 않는다.
- 하지 않은 일: 코드·테스트 수정, Playwright·전체 회귀·공개 preflight 실행, 운영 환경변수 확인, Kakao 규정 원문 조회, 실기기 검증, 오늘판 광고 디자인 재설계, 측정 배선 구현, 랭킹·핫 선발 경로 검토
