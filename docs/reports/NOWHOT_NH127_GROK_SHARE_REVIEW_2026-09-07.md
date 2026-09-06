# NOWHOT NH127 Grok share / deep-link review (2026-09-07)

- 작업자: Cursor Grok 4.6 (Orca worker `task_5a881a4665b9` / dispatch `ctx_802b5595f168`). 읽기 전용.
- David 입력 분류: **확정 지시**(원인·재현·최소 수정안 보고). 구현은 Root. 공개 JS/HTML 후속은 Fable.
- 사용자 원본 URL: **미도착**. 아래 운영 재현은 같은 클래스의 공개 정치 글이며, 제보 링크로 주장하지 않는다.

## 판정

두 증상은 **다른 경로**다. 오버레이는 성인 차단이 아니라 **정치/종교 기본 숨김**이다. 미리보기 이미지는 `/p`가 원문 핫링크를 `og:image`로 내보내는 계약이다.

운영 `https://nowhot.kr`에서 클래스 재현 PASS. 로컬 dirty tree의 `explicitOpen`은 아직 배포되지 않았고 OG/`robots`는 손대지 않았다.

## 1. 오버레이 — 지금핫 자체 `TOPIC_FILTERED`

스크린샷 문구 `콘텐츠 설정으로 이 글의 표시가 제한되어 있어요` + 빨간 `콘텐츠 설정` 버튼은 `index.html`에서 **`e.code==="TOPIC_FILTERED"`일 때만** 그린다.

```3950:3958:src/feed/public/index.html
      const message=e.code==="TOPIC_FILTERED"?"콘텐츠 설정으로 이 글의 표시가 제한되어 있어요"
        :e.code==="SOURCE_DISABLED"?"이 출처는 현재 이용이 제한되어 있어요"
        ...
      body.innerHTML=`...${e.code==="TOPIC_FILTERED"?'<button class="readmore" id="detailSettings">콘텐츠 설정</button>':...
      if(settings)settings.onclick=()=>{addEventListener("popstate",openDrawer,{once:true});history.back()};
```

운영 `/api/item` 재현 (2026-09-07, 익명 세션, 제보 URL 아님):

| 세션 | `showTopics` | 글 | 결과 |
|---|---|---|---|
| 신규 익명 | `[]` (기본) | `it_1lulpm0` `[오늘의 국회일정]`, `topics:["politics"]` | **403 `{"error":"TOPIC_FILTERED","code":"TOPIC_FILTERED"}`** |
| 같은 글, 정치 켬 | `["politics"]` | 동일 | 200, 제목/topics 정상 |
| 신규 익명 피드 | `[]` | 정치 글은 목록에 없음 | 피드 관문은 동작 |

공유 탭은 `/p?id=` → `location.replace('/live#post-…')` → `boot()` → `openFromHash()` → `API.item`. 푸시는 `/live#post-…`로 바로 들어가 **같은 `/api/item`**을 탄다. 카톡/X 인앱은 쿠키·`localStorage`가 비어 신규 유저가 되고 `showTopics=[]`이다.

### 성인·믹스와 구분

| 원인 후보 | 이 오버레이를 만드는가 | 근거 |
|---|---|---|
| 정치/종교 기본 숨김 | **예** | `FILTERABLE_TOPICS = ["politics","religion"]`. `topicsBlocked`만 `TOPIC_FILTERED`를 낸다. |
| 사용자가 정치를 끈 상태 | 예 (의도된 관문) | `getItem`이 상세에도 같은 관문을 건다. 피드에 없던 공유/푸시 글이 여기서 막힌다. |
| 신규 인앱 세션의 **기본값** | 예 (메시지와 불일치) | 한 번도 설정을 안 켠 사람에게 “콘텐츠 설정으로 제한”이라고 한다. |
| 성인 게이트 | **아니오** | `adult`는 필터 키에 없다. 분류 사전/토글은 2026-08에 제거. 성인 소스 3곳은 `enabled:false`. 이 문구/버튼이 나오지 않는다. |
| 커뮤/뉴스 믹스 | **아니오** | `mixBalance`는 `getFeed`/`digest`만. `getItem`은 보지 않는다. |
| 관리자 소스 차단 | 아니오 | 문구가 `이 출처는 현재 이용이 제한되어 있어요`, 설정 버튼 없음. |
| 글 없음 | 아니오 | 404 `ITEM_UNAVAILABLE` / `이 글을 찾을 수 없어요`. 오버레이가 뜬 이상 글은 존재한다. |

`getItem` 주석의 “19금”은 죽은 말다. `_decorate`는 성인을 막지 않는다.

분류 오탐이면 비정치 글에도 같은 오버레이가 뜬다. 제보가 “이것만”이면 **그 한 건이 `politics`/`religion` 태그를 가졌을 가능성**이 크다. 원본 URL 없이 오탐 여부는 미확정.

별칭: `_findItem`이 `canonicalAliases`를 따라가고, 승자가 나중에 정치로 붙으면 옛 id도 403이다 (`test/article-permalink.test.js` 221–238행이 이 계약을 고정). 푸시 당시엔 통과했던 글이 클릭 때 막힐 수 있다.

`foreign-share.test.js`는 해외 지분 하한이지 `/p`/OG/상세 관문이 아니다.

## 2. 공유 미리보기 — `/p` OG는 열리고, 그림은 원문 핫링크

`shareData`는 토픽 관문을 **안** 건다. 위 정치 글의 `/p`는 200이며 제목·`og:image`가 나간다. 사람이 막히는 것과 크롤러 미리보기는 분리돼 있다.

운영 `/p` 실측:

- 정치 글: `og:image` = `https://r.yna.co.kr/global/home/v01/img/yonhapnews_logo_1200x800_kr01.jpg` (연합 **로고**). `og:image:width/height`는 실제와 무관하게 1200×630.
- 이미지 없는 글: `https://nowhot.kr/og.png?v=20260904-brand`, `twitter:card=summary`.
- 사이트 로고를 글 사진처럼 싣는 예: 이토랜드 `eto_og.png`.
- 없는 id: 404 HTML, OG 메타 없음 (`이동 중…`만).
- 1당 `og.png` 200 PNG. `originOf`는 운영에서 `https://nowhot.kr` (robots sitemap으로 확인).

복사 프로토콜(Fable): `location.origin + "/p?id=" + encodeURIComponent(item.id)` — 운영 앱에서는 `https://nowhot.kr/p?id=…`. 제목+개행+URL. HTTP 복사는 이 경로의 기본이 아니다.

`sharePage` (`server.js` 229–256행): `data.image`가 `https?://`이면 **그걸** `og:image`/`twitter:image`로 쓰고, 없을 때만 1당 `og.png`. 크롤러가 원문 CDN을 못 가져오면 폴백하지 않고 빈 카드가 된다. `legal.md`는 핫링크만 허용하고 프록시/재호스팅을 금지한다. 과제 경계와 같다.

`robots.txt`에 `Disallow: /p?`가 있다 (2026-08-03 색인 제외). Google은 보통 쿼리를 경로에 안 넣지만, Twitterbot 등은 robots를 존중한다. curl은 robots를 무시하므로 HTML이 보인 것과 카톡/X가 `/p`를 긁는지는 **별개**다. 일반 회귀라면 이 줄이 용의자이고, “이것만”이면 그 글의 핫링크/로고가 더 맞다.

## 3. 푸시

운영/HEAD 푸시 URL은 `/live#post-<id>`이지 `/p`가 아니다. `digest`는 이미 `topicsBlocked`(+WIP면 mix/adult/alertsOnly)를 건다. **같은 브라우저 프로필**이면 오버레이가 안 나와야 한다. 안드로이드가 구독 브라우저가 아닌 인앱/다른 프로필로 열면 신규 `showTopics=[]`가 되어 공유 탭과 같은 403이 난다.

로컬 WIP (`push.js`/`digest` alertsOnly, 오늘판 푸시)는 알림 선별을 좁힌다. `/p` OG와 `robots`는 안 바꾼다.

## 최소 수정 (구현하지 않음)

**A. 오버레이 — Root.** 피드·다이제스트·믹스·성인 소스 `enabled:false`는 유지. **id로 연 상세만** 정치/종교 403을 거두지 않는다.

이미 dirty tree에 있다:

- `engine.js` `getItem(..., { explicitOpen })`: `explicitOpen`이면 `FILTERABLE_TOPICS`를 켠 것으로 보고 `topicsBlocked`를 통과.
- `server.js` `/api/item`이 `explicitOpen: true`.

배포 전 필요한 것:

1. 테스트: 기본 유저 피드에서 정치 글 0건, 같은 id `/api/item`은 200. `SOURCE_DISABLED`는 계속 403. 별칭도 승자 topics를 따른다.
2. `explicitOpen`을 모든 `/api/item`에 거는 것이 의도면(공유·푸시·목록 클릭이 모두 id 선택) 그 의도를 테스트에 적는다. 정치를 **명시적으로 끈** 기존 유저의 공유 탭까지 열 것인지는 제품 한 줄. 최소안은 “id 상세는 읽히고, 목록은 기존 숨김”.
3. 성인 선호/글로벌 믹스를 끄지 말 것. 이 플래그는 `FILTERABLE_TOPICS`만 건드린다.

Fable 후속(선택): `detailSettings`의 `history.back()`은 `/p` `replace` 뒤에 카톡을 나간다. 해시 진입이면 드로어만 연다.

**B. OG 이미지 — Root, 프록시 없이.**

1. `/p` `og:image`/`twitter:image` 1순위는 항상 `https://nowhot.kr/og.png?v=…` (홈·오늘판과 동일 절대 URL). 원문 사진은 앱 상세에만. “원래 미리보기 그림이 있었다”와 맞다.
2. 또는 `isJunkImage`에 발행사 로고(`eto_og.png`, `yonhapnews_logo_…`)를 넣어 핫링크를 버리고 1당 PNG로 떨어지게 한다. 크롤러용 원문 프록시는 만들지 않는다.
3. 소셜 봇이 `/p?` robots에 막히면 `User-agent: Twitterbot` / `kakaotalk-scrap` / `facebookexternalhit`에 `Allow: /p`를 두고, 일반 `*`의 색인 제외는 유지. `/p` head에 `noindex`를 넣는 편이 `Disallow: /p?`보다 의도가 분명하다.

**하지 말 것:** 정치/종교 기본 숨김 제거, 성인 소스 재활성, 막힌 원문 이미지 프록시, 제보 URL 조작, 고객 메시지·푸시 발송·배포.

## 재현 (원본 URL 없이 클래스만)

1. 익명 `POST /api/session` → `showTopics: []`.
2. 다른 세션에서 정치 켜고 피드에서 `topics:["politics"]` id를 고른다.
3. 익명 세션 `GET /api/item?userId=<anon>&itemId=<id>` → 403 `TOPIC_FILTERED`.
4. `GET /p?id=<id>` (Twitterbot UA) → 200, OG 있음, `location.replace('/live#post-…')`.
5. 제보 URL이 오면 3–4를 그 id로만 반복하고, `topics`가 비어 있으면 이 오버레이 원인은 기각한다.

## 소유

| 고침 | Owner |
|---|---|
| `getItem` / `/api/item` / `shareData` / `sharePage` / `robots.txt` / push URL | Root |
| `renderDetail` 오버레이, 복사 링크, hash boot, SW `notificationclick` | Fable |
| 이 문서 | Grok (본 워커) |

## WRC 보고

작업 시작 전 확인한 MD:
- 자동 주입: 없음(Orca 워커 프리앰블·Mem0 setup 문구만).
- 직접 읽음: `START_HERE.md`; Canonical §0 13원칙·§11.1; `04_WRC_AI_CONTEXT_WIKI_RULES.md` 머리; `05_RULE_ENFORCEMENT_PROTOCOL.md` 머리; `PMO_LIVE_BOARD.md` 머리; `REPORT_READ_INDEX.md` 머리; NowHot `README.md`; `docs/NOWHOT_DEVELOPMENT_STATUS.md` 머리; `docs/00_NOWHOT_PRODUCT_CHARTER.md` 머리; `docs/legal.md` 이미지 조항; `docs/personalized-feed.md` `/p` 절.
- 미읽음/불가: 제보 원본 URL(미도착). 개인 브라우저·실기기 카톡 미사용.
- 이번 작업 전용: 스크린샷; `server.js` `sharePage`/`/p`/`robots.txt`/`/api/item`; `engine.js` `topicsBlocked`/`shareData`/`getItem`/`digest`; `topics.js`; `index.html` overlay/hash/copy; `push.js`/`sw.js`; `test/article-permalink.test.js`·`briefing-quality.test.js`·`foreign-share.test.js`·`browser-navigation.test.js`; 운영 `/robots.txt`·`/og.png`·`/p`·`/api/item` 클래스 재현.

적용한 규칙: Canonical 13 + §11.1 최소 충분; 읽기 전용 + 보고서만 기록; 외부 메시지/배포/푸시 0; 성인·믹스 선호 비활성 금지; 원문 이미지 프록시 금지.

First Principles 게이트: PASS.

개발현황 반영: 해당 없음(검수 전용. 채택·DEVCHG는 Root).

금지선 준수: 제품 수정 0, commit/push/deploy 0, 고객 메시지 0, 알림 발송 0, 개인 Chrome 0. 운영에 익명 `POST /api/session`·피드/상세 GET만 사용(푸시 없음).

이익 우선·과잉방어: GO. 피드 숨김은 유지하고 id 상세와 1당 OG만 고치는 편이, 설정 전체를 끄거나 이미지를 프록시하는 것보다 덜 제한적이다.

David 행동 필요 여부: 제보 URL 1개(있으면 오탐 vs 진성 정치 확정). Telegram: 없음.

하지 않은 일: 코드 수정, WIP `explicitOpen` 채택/테스트, 카톡 스크래퍼 robots 준수 실측, 원문 CDN 전수, 구현/배포.
