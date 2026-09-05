# NH122 Grok review — Today ad blank headline/thumbnail (Safari photo)

Status: READ-ONLY independent review. No product edits, dependency installs, ad clicks, personal browser, commit, or deploy by this worker.
Local HEAD at review: `0c1616f` (Root already committed `Use article layout for Today affiliate content`). Compared against parent `b1c1797` / NH121 `todayAdHtml`.
Scope: `today.html` `todayAdHtml` + CSS, `renderIssues` / detail callers, image `onerror`, DOM `h2`/`b`/`span`, installed WebKit vs Chromium-only NH121 claim.
Out of scope: ranking/engine, Live card renderer changes, blocker-list evasion of `.ad-slot`, deploy.

David input class: **확정 지시** (광고를 오늘판 기사와 같은 구조로) + **오류 보고** (Safari 사진: 제목·썸네일 공백, 킥커/본문/CTA는 보임).

## Verdict

**PASS_WITH_LIMITATION.** Root 패치(`h2 > a.issue-title-button` + `editorial-grid` + `change-row` 고지, 목록 썸네일/`a.ad-native`/`.ad-title` 제거)는 사진 증상과 David 서식 지시를 **둘 다** 덮는다. 구현 GO. Safari 제목 공백을 “WebKit이 `<b>` flex를 접는다”로 단정하면 안 된다.

First Principles 게이트: PASS (원인·한계를 접지 않음. `.ad-slot` 삭제나 차단기 우회 CSS를 권고하지 않음).

## Missing-title / missing-thumb — what is confirmed

NH121 마크업(HEAD `b1c1797`):

```html
<a class="ad-native" ...>
  <span class="go-row">
    <b class="ad-title">{hook}</b>
    <span class="go-thumb"><img src="{ads-partners.coupang.com/...}" onerror="this.parentNode.remove()"></span>
  </span>
  <div class="editorial-grid">…쿠팡 파트너스…</div>
  <span class="ad-go">…</span>
</a>
```

| Claim | Evidence | Status |
|---|---|---|
| 빈 훅 데이터 | `adCopy()` 표는 dest마다 hook 문자열이 있다. Root도 공개 재고 18·변형 270에서 빈 제목 0. | **Not the title bug.** |
| 썸네일 공백 | 이미지 URL은 `https://ads-partners.coupang.com/banners/…`. EasyList `\|\|ads-partners.coupang.com^`(NH118 Fable이 2026-09-05 수신). `server.js` 주석이 이미 Safari ITP/차단 목록을 이유로 Live는 이미지에 수익을 안 건다. 격리 WKWebView에서 깨진 `img` + `onerror="this.parentNode.remove()"` → `go-thumb` 삭제, 제목 텍스트는 남음. | **Confirmed** for the blank thumb. |
| `<b.ad-title>` flex/`min-width:0`/`word-break:keep-all`가 WebKit에서 제목을 0높이로 접음 | 같은 HEAD CSS+DOM을 macOS `WKWebView` (UA `AppleWebKit/605.1.15`) 393px에서 측정. 필터 없음: 제목 `titleVisible=true`, 박스 284×28, `font-weight:880`, `display:block`. 파서는 `<a>` 안에 `div.editorial-grid`를 유지 (`aContainsGrid=true`). iOS Simulator 런타임 0. | **Not reproduced.** Do not cite as the cause. |
| EasyList `##.ad-title`이 제목만 숨김 | 2026-09-05 `easylist/easylist_general_hide.txt` 5501행 `##.ad-title` (5181 `##.ad-native`, 5379 `##.ad-slot`). 같은 HEAD 마크업에 `##.ad-title`만 주입한 WKWebView 케이스 J: 킥커 보임, 제목 `display:none` 0×0, `editorial-grid`와 `.ad-go` 보임, 고지 보임. **사용자 사진과 행 단위로 일치.** `##.ad-native`는 본문+CTA까지 숨겨 사진과 불일치. `##.ad-slot`은 카드 전체(킥커 포함)를 숨겨 사진과 불일치. | **Confirmed mechanism** for a Safari/content-blocker window that applies generic `.ad-title` hide but not `.ad-slot`. Not proof of David 기기의 설치 목록. |
| NH121 Chrome 메트릭 일치 | Fable NH121은 Playwright Chromium만. 확장 없는 Chrome은 `##.ad-title`을 안 바른다. 제목이 보이는 것과 모순 없음. | Explains Chrome vs Safari photo split. |

Live는 2026-08-06 아이폰에서 `a.ad-native`가 본문만 걷어 껍데기(쿠팡 파트너스/AD/고지)를 남긴 뒤 레이아웃 클래스만 `card-go`로 바꿨다(`index.html` 주석). NH121 Today는 그 교훈을 무시하고 `a.ad-native` + **새 클래스 `.ad-title`** 을 다시 심었다. 사진 증상은 Live의 “본문 전체 소실”이 아니라 **제목 한 줄만 소실**이라 `##.ad-title` 쪽이 맞다.

차단을 우회하라고 `.ad-slot` / AD / `rel=sponsored` / 고지문을 지우라고 하지 않는다. 그건 명시적 차단기 우회다. 반쪽짜리 광고(AD·킥커·본문·CTA는 있고 제목만 없음)를 만드는 **레이아웃 클래스 `.ad-title`** 을 기사 `h2`와 맞추는 것은 Live가 이미 한 최소 수정과 같은 종류다.

## Root patch challenge (`0c1616f`)

공유 경로: `todayAdHtml` 정의 1곳. 호출 2곳 — `renderIssues` 목록 (`index>=2 && (index-2)%10===0`)과 `openIssueDetail` (`today-detail`). `render()` → `renderIssues`. 필터·회전·`seenAds`·민감 이웃·`link.coupang.com`·`subId`·`esc`·고지 `cp.disclosure` 불변.

| 변경 | Challenge |
|---|---|
| 목록 썸네일 삭제 | **GO.** 확인된 썸네일 근인. 기사 목록에도 썸네일이 없다. |
| `.ad-title` / `a.ad-native` / `.go-row` 삭제, `h2 > a.issue-title-button` | **GO.** 확인된 제목 근인(`##.ad-title`)과 David “기사와 똑같이”. 격리 WebKit에서 패치 후 목록 제목 21px/880(393)·24px/880(1100, 비-first-child 기사와 동일). |
| 고지를 `.change-row .ad-disclosure`로 이동 | **GO.** 전문 유지. `aria-label="쿠팡 제휴 광고"` 유지. briefing-quality는 정적 `쿠팡 파트너스` 리터럴 대신 이 aria + `class="ad-disclosure">${esc(cp.disclosure)}`를 본다 — 고지 경로 자체는 살아 있다. |
| 본문 라벨 `쿠팡 파트너스` → `상품 안내` | **Challenge, not BLOCK.** 제목 공백 수리에 필요 없다. Live 카드 소스 칩은 여전히 “쿠팡 파트너스”. 릴리스 `2026-09-05-today-layout`은 “쿠팡 파트너스 안내는 그대로”라고 쓰는데, 보이는 본문 라벨은 바뀌었다(고지 문장 안의 그 단어만 남음). 최소안은 `<b>쿠팡 파트너스</b>`를 editorial-point에 유지. |
| `.ad-go` CTA 삭제, 클릭 영역을 제목 `<a>`만 | **Limitation.** 기사는 행 전체 클릭. 광고 `aside`에는 그 핸들러가 없다. 본문/고지 탭은 무반응. 전환 영향은 미측정(클릭 금지). 서식 통일 지시 안에서는 허용, 수익 주장 금지. |
| `#detailContent .ad-coupang h2` | **Limitation.** `.detail-content h2`가 나중에 와서 상세 광고 제목이 28px(데스크톱)/23px(≤620). `font-weight`만 880으로 기사 상세(700)와 다르다. 목록 테스트는 `#issues`만 비교해서 이 차이를 안 잡는다. |
| `.ad-slot` 유지 | **Correct. Do not strip.** 전체 EasyList 창에서는 카드가 통째로 숨는 것이 기존 정책(껍데기보다 낫다). 사진 기기는 `.ad-slot`을 안 바른 상태로 보는 것이 맞다. |

Root 보고서가 “Safari 제목/이미지 공백 원인은 미확정”이라고 한 것은 **iPhone 미재현** 한에서는 맞다. 이 검토는 (1) 썸네일 공백과 (2) `##.ad-title`이 사진과 같은 반쪽 화면을 만든다는 점을 **설치된 WebKit + EasyList 원문으로 재현**했다. 그 이상을 “David 폰의 확정 설정”으로 쓰지 말 것.

## What is left

- 실제 iPhone Safari 재현은 이 워커에 시뮬레이터/개인 브라우저가 없어 **unconfirmed on device**.
- Root Chrome 28/28·미리보기(`/tmp/nh122-preview-today-393.png`: 패치 후 제목·상품 안내·고지 보임, 썸네일 없음)는 패치 서식 증거이지 Safari 사진의 재현은 아니다.
- `상품 안내` 라벨을 되돌릴지는 Root/Fable 제품 판단. BLOCK 아님.
- 운영 배포 영수증은 Root 보고서 공란. 이 워커는 deploy 안 함.

## WRC

- 직접 읽음: NH118/NH121 Fable·Grok·Root 보고, Root NH122 보고 `docs/reports/NOWHOT_NH122_TODAY_AD_ARTICLE_LAYOUT_2026-09-05.md`, `today.html`(CSS·`todayAdHtml`·`renderIssues`·detail), `test/browser-navigation.test.js`·`briefing-quality.test.js` 해당 단언, `ad-copy.js`, `server.js` 쿠팡 이미지/ITP 주석, `index.html` `ad-native`→`card-go` 주석, EasyList `easylist_general_hide.txt`(2026-09-05 fetch), wrc-review-gate, orca-cli.
- 미읽음/불가: 실제 iPhone, Playwright WebKit 브라우저 바이너리(미설치·설치 금지), 개인 Safari.
- 이번 산출: 본 보고. 제품 파일 0.
- 금지선: 광고 클릭 0, 차단기 우회 패치 권고 0, 의존성 설치 0.
- 이익 우선: 반쪽 광고를 고치되 `.ad-slot`/고지/AD는 남긴다.
