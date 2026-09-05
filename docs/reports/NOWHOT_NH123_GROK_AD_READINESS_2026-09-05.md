# NH123 Grok advertising readiness — 2026-09-05

Status: READ-ONLY bounded review. No product/test edits, fixtures, dependency installs, paid calls, ad clicks, personal browser, account, submission, commit, or deploy.
David input class: **승인** (verification and preparation only; not an advertising-account submission).
Local HEAD: `b98ae04` (docs). Product parent: `f95164b`. Untracked: `.serena/`, `.superpowers/` only.
Public evidence window: 2026-09-05 ~16:50 KST. Method: no-JS GET (`curl`/urllib). Googlebot UA compared on `/` only. Hash URLs are not sent to the server.

Prior HOLD (do not treat as current proof): `docs/reports/NOWHOT_OWNER_TAKEOVER_2026-09-05.md` → Sept 4 audit `/tmp/claude-501/-Users-hyundonghwang-Documents-NowHot-Local-Dev/9e4f130a-5c50-4015-8ce8-bbaf383c3431/scratchpad/NOWHOT_RESUBMIT_AUDIT_20260904.md`. Legacy `/briefing` and `/rss.xml` are retired (NH121). Today and Coupang are the user-approved surfaces.

Out of scope: Root scheduled publishing/mobile, Fable content sample (own-value / event-lineage), broad repo audit, ranking engine, account consoles.

Coordinator calibration (`msg_df12abfe4b22`): JS-shell empty HTML is a **crawler access/value risk**, not an official automatic rejection. Separate **pre-submission readiness** from **ad-network/account judgment** (unknown; login forbidden). Root public lunch 56 / Coupang 5 and slot-canonical verified are current serving fact; 19:05 evening observation is Root’s.

First Principles 게이트: PASS.

---

## Verdicts (separate; do not merge)

These are **pre-submission readiness** verdicts. They are **not** Google/Kakao account decisions and **not** automatic official-policy rejects.

| Provider | Readiness | Why not “ready to submit from this review” | What is not claimed |
| --- | --- | --- | --- |
| **Google AdSense** | **HOLD** | (1) No-JS `/` is 240 chars — crawler/reviewer **first-paint value risk**. (2) Publisher Policies inventory-value / replicated-content apply **if** an AdSense **unit** is placed on that shell or a scrape-first overlay. (3) Account/Policy center unknown. | Not a live Google ad-serving violation: `/` has **no AdSense unit** (meta + `ads.txt` only). JS users already get 56 issues (Root 56/ads5). Empty shell ≠ automatic 탈락. |
| **Kakao AdFit** | **HOLD** | (1) Registered 매체 URL unknown. If `/`, FAQ: review waits on an installed unit **ad call** (`/` has none). (2) `/report` already has unit `DAN-ay04FFmKGxgYuWeQ` + own metrics. (3) Today scrape overlay is a 5.2 **risk if** AdFit is later put on that overlay. | Not an automatic site-wide 반려. Live does not load Kakao SDK. No published article/word floor. |

Do **not** flatten into one PASS. This HOLD is readiness, not proof the networks would reject. Account submission is out of this worker’s scope.

---

## Official pages used (2 per provider; no invented thresholds)

Fetched 2026-09-05. No other policy pages are used as primary sources.

### Google AdSense

1. [AdSense Program policies](https://support.google.com/adsense/answer/48182) — page states last updated **August 4, 2026**. Publishers must also follow Google Publisher Policies. Ads may not be placed on **non-content-based pages** or on pages published specifically to show ads.
2. [Google Publisher Policies](https://support.google.com/adsense/answer/10502938)

Applicable principles actually written there (no article-count or word-count floor):

- **Inventory value — screens without publisher-content:** “We do not allow **Google-served ads** on screens: without publisher-content or with low-value content, that are under construction…” This binds **screens that host Google ads**, not a JS-off homepage with no unit.
- **Replicated content:** “We do not allow **Google-served ads** on screens: with embedded or copied content from others without additional commentary, curation, or otherwise adding value…” Also IP/copyright. Applies when Google ads sit on that screen. Today detail currently hosts **Coupang**, not AdSense.
- **More ads than publisher-content:** ads/paid promo must not outnumber publisher-content on the screen.
- **Privacy disclosures:** a privacy policy must disclose third-party cookies/beacons/IP used because of Google ad serving. A link to “How Google uses data…” is described as **an option**, not the only method.
- Program policies also forbid encouraging clicks, indistinguishable ads, and ads on non-content pages.

**Not found in these two pages:** a minimum number of articles, a minimum body-word count, or “3 articles / 200 characters.” Those numbers in the Sept 4 audit are **not** cited here as Google rules.

### Kakao AdFit

1. [AdFit 서비스 운영정책](https://adfit.kakao.com/web/html/use_kakao.html) (current, not `/old/…`)
2. [AdFit FAQ — 매체 등록·심사](https://kakaobusiness.gitbook.io/main/partner/adfit/faq)

Applicable principles actually written there:

- **4.1 / FAQ:** 매체 + 광고단위 등록 후 최신 SDK/스크립트 설치, **광고 요청이 확인된 뒤** 심사. FAQ 보류 예: 광고단위 미생성, **매체에 광고단위가 정상 설치되지 않은 경우**. FAQ also states AdFit is for **사전 승인·초대 매체** and 제휴 문의 — account-process unknown without logging in; not treated as a content defect.
- **4.2:** 심사는 소유관계, **콘텐츠의 질적·양적 품질**, 트래픽의 질적·양적 품질. **No integer threshold is published.**
- **5.2 저작권:** 권리자 허락 없이 복제; **정식 퍼블리싱 계약 없이 API로 가져온 정보들로만 구성**; 아웃링크만/비중 높음; **언론이나 타 사이트 게시글로 전체 또는 일부 구성되어 자체 콘텐츠가 없는 경우**.
- **5.2 기타:** 내용이 **지나치게 부족**하여 유의미한 소비가 없는 경우 (qualitative). 한 페이지 AdFit **4개 초과** 금지. 타 광고 네트워크 스크립트 **동시 여러 개** 금지 (순차는 제외).
- **5.3:** 콘텐츠를 가리는 광고, 광고 없이는 이동 불가, 오인 제목 아래 광고 금지. 광고 화면은 뒤로가기/메뉴로 빠져나갈 수 있어야 함.
- **5.4:** 개인정보처리방침 미수립·미준수; 일정 기간 콘텐츠 업데이트 없음 (no day count in the text used).

**Not found:** “기사 N건”, “본문 N자” as an approval floor.

---

## What changed since the Sept 4 HOLD

| Sept 4 blocker | 2026-09-05 public evidence | Status |
| --- | --- | --- |
| B2 default `/api/today` **409** | `GET https://nowhot.kr/api/today` **200**, `serving.state=slot_canonical_verified`, `fallback=false`, `servedDate=2026-09-05`, `servedSlotId=lunch`, 56 issues. Morning `?slot=morning` also 200/verified. Evening `?slot=evening` **409** body `이브닝판은 아직 발행 시각 전입니다` (16:50 KST, before 19:00 — not a missing canonical). | **Closed** for the default crawler-hour path. Explicit future-slot 409 is honest. |
| B2 no-JS `/` empty | `GET https://nowhot.kr/` 200, **240 visible characters**, copy “오늘판 준비 중” / skeleton. **No `<noscript>`**. Googlebot UA: **same 240 characters** (no cloaking). JS path (Root): lunch 56 / Coupang 5. | **Open as crawler first-paint value/access risk.** Not an official auto-reject while no Google/AdFit unit is on that HTML. |
| B1 scrape-as-summary | Served 56: `excerpt_only` **42**, `source_unavailable` **14**, `ready` **0**. `public_anchor_body` **40**, `publisher_feed_excerpt` **2**. `llmCalls=0`, `generated:0`. `textKo` 27,784 vs own editorial 14,885 (**1.87 : 1**). 14 excerpts contain publisher chrome (e.g. `기자 =`). Overlay still paints `excerpt_only` as 기사 요약. Own-value / 사건 결속: **Fable** (chrome-in-excerpt WARN already in Fable’s report). | **Open as placement risk** if display ads are added to that overlay. Not this worker’s content-sample verdict. |
| B3 no about/privacy/terms | `/` crawler HTML hrefs: `/`, `/live`, `/about`, `/about#updates`, `/feedback`, `/terms`, `/privacy`. | **Closed on `/`**. `/report` (the AdFit host) still has **no** those links. `/contact` **404**; contact is `mailto:comeva2kr@gmail.com` on about/privacy/terms. |
| Legacy briefing/RSS as ad host | `GET /briefing` **410** `noindex`, no ad tags, CTA to `/`. `/rss.xml` **410**. Sitemap locs: `/`, `/report`, `/about`, `/terms`, `/privacy` only. | **Retired as requested** |

---

## Public default HTML (JS disabled / crawler)

- URL: `https://nowhot.kr/`
- Status 200. Title: 지금핫 오늘판. Canonical/description present. `meta name="google-adsense-account" content="ca-pub-9799388228968567"`.
- Visible text 240 chars. Issue list is CSS skeleton, not titles. Detail overlay default: “기사 요약을 불러오는 중입니다.”
- Ad tags in the **document**: `kakao_ad_area` **0**, no `pagead2`/`ba.min.js` script `src`, Coupang `link.coupang.com` **0**. The string `adsbygoogle` appears **once** as unused CSS `.adsbygoogle{min-height:100px}` — not an `<ins class="adsbygoogle">`.
- Coupang on Today is **JS-only** (`/api/config` → 18 items). A reviewer with JS off never sees Today affiliates or article bodies.

Article **detail path** is a client hash, not a server document:

`https://nowhot.kr/#issue-{editionId}/{evidenceHash}`

A crawler GET of that URL is still `/`. Three hashes below were therefore **not** additional HTML documents.

---

## Serving availability

| Request | HTTP | Result |
| --- | --- | --- |
| `https://nowhot.kr/api/today` | 200 | lunch 2026-09-05, 56 issues, `filter_only`, LLM 0 |
| `https://nowhot.kr/api/today?slot=morning` | 200 | morning verified, 56 |
| `https://nowhot.kr/api/today?slot=evening` | 409 | not yet the evening window |
| `https://nowhot.kr/api/config` | 200 | `adfit.reviewMode=true`, `adfit.mobileUnit=null`, `monetization.enabled=true`, Coupang items **18** |

`/api/` is `Disallow` in robots. Reviewers who only fetch HTML never see the 56-issue JSON unless they run JS.

---

## Three representative article details (max 3)

Edition `SCE-c1e006868413a496`. List cards (JS) already have own `headline` / `paragraph` / `whyImportant`. The overlay **replaces** that with `articleSummary.textKo` when status is `excerpt_only`.

### 1. Scrape overlay (business, `public_anchor_body`)

- Path: `https://nowhot.kr/#issue-SCE-c1e006868413a496/bbc9ed7fa9dbd38f6300072c4b3652cd9e8618e88909e7fa1168f2dad2e97b08`
- `articleSummary.status=excerpt_only`, `excerptBasis=public_anchor_body`, `sourceLabel=연합인포맥스`
- `textKo` 896 chars including byline `김지연 기자 =` (publisher chrome). Own editorial fields 251 chars.
- Source: `https://news.einfomax.co.kr/news/articleView.html?idxno=4433585`
- After the scrape block, `todayAdHtml` injects a Coupang aside on the same overlay.

### 2. Unavailable body (humor, community)

- Path: `https://nowhot.kr/#issue-SCE-c1e006868413a496/c24015e7c0149b09a2202236c0b13defaf06e200d1898b925f9e67a90aa4ad4a`
- `status=source_unavailable`, `unavailableReasonCode=PUBLIC_BODY_TOO_SHORT`, `textKo` empty. Own editorial 217 chars (reaction counts + title). Source 보배드림.
- Overlay shows the unavailable reason, not a long scrape. This path is **not** B1. It is still JS-only.

### 3. Publisher-feed excerpt (business+sports)

- Path: `https://nowhot.kr/#issue-SCE-c1e006868413a496/7f6938d9a12570f336eb65c6ab57c5c8103539a1eb8fd575e3944bd2d86e3319`
- `excerpt_only` + `publisher_feed_excerpt`, `textKo` 200 chars (feed `summary`), own editorial 262 chars. Source 조선비즈.
- Still copied publisher text in the “기사 요약” slot, labeled as feed excerpt. Official Google/AdFit pages do not bless “200 characters” as a safe harbor; they ask whether the **screen** is own commentary vs copy.

Full `textKo` is not reproduced here.

---

## Ad placement and empty surfaces

| Surface | Crawler ads | Publisher-content in HTML | Notes |
| --- | --- | --- | --- |
| `https://nowhot.kr/` | No AdFit/AdSense **unit**. AdSense **meta** only. | Construction shell | Putting a Google/AdFit **unit** here **before** SSR would create the official empty-screen rule. Coupang appears only after JS. |
| `https://nowhot.kr/live` | `useAdfit=false`. Four `kakao_ad_area` strings are **templates** (`data-ad-unit="${unit}"`) behind that flag. No `ba.min.js` `<script src>`. `noindex,follow`. AdSense meta present. | Seeded feed titles exist without JS (~3308 visible chars) | External headlines + Live Coupang (JS). Not an AdFit host while `mobileUnit` is null. |
| `https://nowhot.kr/report` | **1** `kakao_ad_area` `data-ad-unit=DAN-ay04FFmKGxgYuWeQ` + `https://t1.kakaocdn.net/kas/static/ba.min.js`. No AdSense unit. | Own 7-day metrics, ~1062 visible chars, no outbound article links | Current **only** AdFit network host. No `/about` `/privacy` in hrefs. |
| `https://nowhot.kr/briefing` | none | 410 ended page, 87 chars, `noindex` | Not an ad host. |
| `https://nowhot.kr/ranking/daily` | none | noindex ranking list ~1479 chars | Linked from `/report`; not an ad page in this fetch. |
| `https://nowhot.kr/contact` | — | **404** | |

`ads.txt`: `https://nowhot.kr/ads.txt` → `google.com, pub-9799388228968567, DIRECT, f08c47fec0942fa0`. `app-ads.txt` 404 (web, not app).

---

## About / contact / privacy

| Need | Public URL | Crawler |
| --- | --- | --- |
| About | `https://nowhot.kr/about` 200, 3414 chars, no ad units | Operator 페퍼클럽, contact `mailto:comeva2kr@gmail.com` |
| Privacy | `https://nowhot.kr/privacy` 200, 3123 chars | Cookie/AdSense/AdFit/Coupang disclosure; Google ads policy `https://policies.google.com/technologies/ads?hl=ko`, [광고 설정](https://adssettings.google.com), [Google 개인정보처리방침](https://policies.google.com/privacy?hl=ko), [카카오 개인정보처리방침](https://www.kakao.com/policy/privacy). Optional Publisher Policies partner-sites link not required by the “option” sentence. |
| Terms | `https://nowhot.kr/terms` 200 | same mailto |
| Contact path | no `/contact` | mailto on about/privacy/terms is the public contact |

`/feedback` 200, 166 chars, no ads — not a policy page.

---

## Remaining blockers and unknowns (exact)

Separate **readiness** (this table) from **account/reviewer judgment** (unknown).

### AdSense remaining (readiness)

1. **Crawler first-paint `/` is thin** (240 chars). Risk: a no-JS reviewer or a crawler that does not run Today JS sees construction copy. Not a current Google-ad-on-empty-screen violation (no unit).
2. **Do not add an AdSense unit to `/` or to the scrape-first overlay** until those screens have own publisher-content in HTML. That is the written inventory-value / replicated-content trigger.
3. **Unknown:** AdSense Policy center / application status.
4. **Unknown:** whether Google’s reviewer runs JS. First paint stays the shell.

Not remaining: default 409; `/` missing about/privacy/terms; ads.txt; cloaking; a published article quota. Own-value/lineage sample: Fable, not this HOLD.

### AdFit remaining (readiness)

1. **Unknown 매체 URL.** If `/`: FAQ install/ad-call gate (no unit on `/`). If `/report`: unit+SDK already present on original metrics.
2. **Do not add AdFit to Today overlays** while `excerpt_only` is the summary slot (5.2 copy risk). Current AdFit host is `/report`, not the overlay.
3. **`/report` lacks about/privacy hrefs.** Policy page exists site-wide. Link-from-ad-page is **not** a numbered rule in the two official pages — optional hygiene.
4. **Unknown:** account / 제휴·초대 vs prior application.
5. **Unknown:** 4.2 qualitative volume as a reviewer applies it. Do not invent a count.

Not remaining: briefing as AdFit host; Live Kakao SDK load; Coupang 0.

---

## Smallest implementation that keeps user-approved Today / Live

Root owns product change. Fable owns chrome/lineage copy. Do **not** restore briefing/RSS. Do **not** turn off Coupang. Do **not** add units to the current no-JS shell (that would create the empty-screen rule).

Minimum, in order:

1. **Placement freeze:** keep AdSense/AdFit **off** `/` and off Today detail until crawler `/` has own copy **or** the overlay stops using scrape as the summary. Meta/`ads.txt` and `/report` AdFit unit may stay.
2. **Optional crawler-value (not a policy auto-fix):** seed `today.html` with the already-served lunch titles + `paragraph`/`whyImportant` + 원문 (`<noscript>` or SSR), then hydrate. Reuse slot-canonical JSON. This shrinks first-paint risk for no-JS reviewers. It is not required to “satisfy a word count.”
3. **Overlay (Fable may share the filter):** stop using `excerpt_only` `textKo` as 기사 요약; keep 브리핑 포인트 + 원문. No 200-character cap. Chrome/email/nav stripping is Fable’s WARN, not an ad-network number.
4. **Keep** Today/Live Coupang and Live `mobileUnit=null`. Leave AdFit on `/report` unless Root registers a different 매체 URL.
5. **Optional:** `/report` footer → `/about` `/privacy`.

Do not: invent 3-article quotas; LLM-fill `generated:0` for ads; click ads; submit accounts from this review.

---

## WRC

- 작업 시작 전 확인한 MD:
  - 자동 주입: 이 Dispatch TASK, WRC start-gate 목록
  - 직접 읽음: `START_HERE.md`; Canonical §0 13원칙 전문 + §11.1; `04_WRC_AI_CONTEXT_WIKI_RULES.md` 목적·SoT; `05_RULE_ENFORCEMENT_PROTOCOL.md` First Principles/최소변경/전용브라우저/이익우선; `PMO_LIVE_BOARD.md` 전용창 격리; `REPORT_READ_INDEX.md` 색인 머리; `docs/reports/NOWHOT_OWNER_TAKEOVER_2026-09-05.md`; Sept 4 audit 원문; `docs/NOWHOT_DEVELOPMENT_STATUS.md` NH122 기준; `docs/NOWHOT_ADFIT_RESCUE_001.md` NH118 오늘판 쿠팡 주석; `today.html` 셸·`readyText`; `server.js` `/` → `today.html` (no seed); about/privacy/terms; Fable NH123 머리 판정(chrome WARN; 사건혼합은 Fable)
  - 미읽음/불가: AdSense/AdFit 콘솔, 개인 브라우저, 운영 VM env, 실제 iPhone, Fable 사건혼합 전수, 19:05 이브닝 실측
  - 이번 작업 전용 파일: 이 보고
- 적용한 규칙: 13 First Principles 불가분; §11.1 최소충분; 공식 1차 페이지만 인용; 크롤러 위험을 자동탈락으로 단정하지 않음 (`msg_df12abfe4b22`); Today/Live 보존; curl only
- First Principles 게이트: PASS
- 개발현황 반영: 해당 없음 — 검수 보고만. Root가 수리 범위를 정한 뒤 갱신
- 금지선 준수: 제품·테스트 0, 커밋 0, 배포 0, 유료 호출 0, 광고 클릭 0, 계정/제출 0
- David 행동 필요 여부: 없음. 계정 제출은 이 보고의 범위가 아님
- Telegram 알림 필요 여부: 없음
- 이익 우선·과잉방어 점검: **GO** keep Coupang and do not invent floors. **WARN** crawler first-paint and scrape-as-summary if display units are added there. Do not strip 원문. Account outcome unknown.
- 하지 않은 일: 제품 수정, 테스트, 배포, 광고 클릭, 계정 로그인, Orca 브라우저, briefing 복구, Fable 카피 작성, 광역 랭킹 감사
