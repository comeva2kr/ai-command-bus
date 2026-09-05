# NH121 Grok review — legacy 오늘의 브리핑 retirement

Status: READ-ONLY independent review. No product edits, public POST, or deploy by this worker.
Local HEAD at map time: `a075591` (clean product tree; Root draft not yet on disk).
Scope: end legacy `/briefing` publisher + connected **outgoing** `/rss.xml`. Incoming community/news RSS and canonical Today stay.
Out of scope: ranking/report/engine primitives, stored historical records, collectors, ads on other pages, Today ad format (Fable), broad SEO/ad approval.

David input class: **확정 지시 + 승인** (end legacy briefing and its outgoing RSS; do not migrate RSS onto Today).

## Verdict for Root (map phase)

**GO on the retirement intent.** Simplest full stop is: kill the legacy **writer + request-path generators + UI links**, 410 machine `/api/briefing` and `/rss.xml`, give humans a dated-honest ended page on `/briefing` and `/briefing/*`. Do not delete `engine.briefing`, daily ranking snapshots, or Today.

Dirty-diff review: **done.** Retirement **GO**. Limitation: Today ad restyle is Fable’s, not this GO.

First Principles 게이트: PASS.

## What to retire vs keep

### Retire (legacy publisher surface)

| Surface | Current behavior | Simplest stop |
| --- | --- | --- |
| `briefingTick` + `buildAndStoreBriefing` / `_buildAndStoreBriefing` | `FEED_LIVE`: 5‑min due-slot writer; waits on LLM essay; `store.saveBriefing` | Stop the timer and the request-path call into it. Leaves stored rows. |
| `currentBriefing()` | Reads store, else **builds on GET** | Stop calling it. Request must not mint a new edition. |
| `GET /briefing` | Live HTML edition + slot rail + archive links + ads | Human **ended** HTML (200 or 410 HTML). Canonical `/`. Link Today. `noindex`. |
| `GET /briefing/YYYY-MM-DD` | Historical HTML; falls back to `dailyEditions.briefing` | Same ended page. **Do not 308 to `/` or Today `?date=`** — that mislabels the archive date as today’s edition. |
| `GET /briefing/<category>` | Live `engine.categoryTop` HTML | Ended page. Do not keep generating category briefing URLs. Keep `categoryTop` itself. |
| `GET /api/briefing` | Live `engine.briefing()` JSON for `/live` client | **410 JSON** (same class as `/api/today/summary`). |
| `GET /rss.xml` | `currentBriefing()` issues **plus** `rankingTop` items; items link `/briefing` | **410**. Do not rebuild this feed from Today. Ranking already has HTML `/ranking/*`. |
| IndexNow ping | `["/", "/briefing", "/report"]` every 6h | Drop `/briefing`. Do not keep advertising a dead URL. |
| `robots.txt` | `Sitemap: …/rss.xml` | Drop that line. Keep `sitemap.xml`. |
| `sitemap.xml` | `/briefing` + published `/briefing/{date}` | Drop both. Keep `/`, `/report`, policy pages. |
| `editionShell` RSS `<link rel="alternate">` | Every ranking/trends/communities HTML shell | Remove. Ranking pages stay. |
| `/live` `index.html` | Drawer `/briefing`, `#ownBlock` + `GET /api/briefing`, brief-strip cards → `/briefing` and `/briefing/{cat}` | Remove those links and the fetch. Do not point “오늘의 브리핑” at a dead path. |
| `serveStatic` `/live` seeds | `bs-seed` → `/briefing`; `ownSeed` SSR from `engine.briefing()` | Stop injecting briefing seeds/links. Ranking/trends seeds can stay. |
| `editorialHomeHtml` (flag off `/`) | Primary CTA `/briefing` | Point primary CTA at `/` Today or `/live` only if that home still exists. Production path is Today. |
| `ownContentNav` | Always emits `/briefing` and `/briefing/{cat}` | Drop briefing entries. Keep ranking/trends/communities/keywords/report. |
| `rankingNav` | Extra `<a href="/briefing">브리핑</a>` on ranking/trends/keywords/category pages | Drop that one `<a>`. Keep period tabs. |
| Preflight | Requires `/api/briefing` ≥3 issues; reviewMode still fetches `/briefing` AdFit | Assert 410 / ended page; **do not** keep AdFit-on-dead-briefing as a ship gate. Today ads are Fable. |

### Keep (shared primitives / canonical Today / collectors)

- **Today publisher:** `/` → `today.html` when `NOWHOT_LOCAL_EDITORIAL`; `GET /api/today`; slot-canonical reader; editorial inventory schedule. `today.html` has **no** `/briefing` or `/rss.xml` links. H1 copy “오늘의 브리핑” is Today chrome, not a legacy URL — do not “fix” it in this slice; Fable owns Today ad format only.
- **`FeedEngine.briefing()`** and `_sharedBriefingContext` / `buildPersonalizedEdition`: Today editions call this. Category-routing and local-editorial tests do too.
- **`store.setBriefingCategories`**: Today personalization (`POST /api/today/categories`). Name is legacy; function is Today. Do not delete.
- **`saveDailyEdition({ briefing, ranking })` in `engine.refresh()`:** weekly/monthly ranking reads **`ranking` only** (`mergeRankings`). Leave the snapshot writer. Do not strip `briefing` from the stored object in this slice.
- **`store.saveBriefing` / `getBriefing` / `latestBriefing` / `briefingDates` / `store.briefings`:** keep records. Stop new writes from the live tick if the writer is retired.
- **Incoming RSS:** `communities.json` adapters, `parseRss`, Google News wrappers, collectors. `/rss.xml` is outbound only.
- Ranking `/ranking/*`, `/report`, `/trends`, `/communities`, `/keywords`, Live `/live`, ads on those pages, Today ads.

## Caller graph (every live path)

```
FEED_LIVE briefingTick ──► buildAndStoreBriefing ──► engine.briefing({slotId})
                         └► llmWriter (wait) ──► store.saveBriefing

GET /briefing            ──► currentBriefing() ──► store.getBriefing | buildAndStoreBriefing | dailyEditions.briefing
GET /briefing/{date}     ──► store.getBriefing | getDailyEdition.briefing   [HTML generator]
GET /briefing/{cat}      ──► engine.categoryTop                            [HTML generator]
GET /api/briefing        ──► engine.briefing() + reportStoryLine()         [JSON for /live]
GET /rss.xml             ──► currentBriefing() + engine.rankingTop()       [outbound machine feed]

engine.refresh()         ──► saveDailyEdition({ briefing: briefing(), ranking: rankingTop() })
                         └── ranking weekly/monthly uses .ranking only

Today                    ──► engine.briefing({ categories, personalized, … }) via buildPersonalizedEdition
                         ──► store.setBriefingCategories
                         ──► /api/today  (not /api/briefing)

IndexNow interval        ──► ping /briefing
robots / sitemap         ──► advertise /rss.xml and /briefing[/{date}]
editionShell + index.html──► rel=alternate /rss.xml
ownContentNav/rankingNav ──► generate /briefing and /briefing/{cat} links
/live index.html JS      ──► GET /api/briefing ──► href=/briefing and /briefing/{cat}
```

## Concrete risks (do not flatten)

1. **Shared function name ≠ shared product.** Deleting `engine.briefing` or `setBriefingCategories` breaks Today. Root must retire **routes and UI**, not the digest primitive.
2. **Date URL redirect is the honesty bug.** 308 `/briefing/2026-08-04` → `/` (or Today with another date) labels a historical request as “today.” Ended page with “이 주소의 옛 브리핑은 종료됨 → 오늘판 `/`” and `noindex` is the simple honest option. Stored rows stay unread by the public generator.
3. **`/rss.xml` is not briefing-only.** It also serializes ranking titles with `/live#post-…` links. David authorized ending the connected outgoing RSS, not a Today RSS. Ranking HTML stays. Do not invent a second feed.
4. **Request-path generator:** `currentBriefing()` still **writes** if the slot is due and missing. Turning off UI without turning off this function (and `briefingTick`) keeps LLM spend and new `store.briefings` rows.
5. **`ownContentNav` is a URL factory.** Ranking/trends/communities pages will keep minting `/briefing/tech` etc. until those hrefs are removed. Sitemap-only deletion is not enough.
6. **Preflight will fail closed** until `/api/briefing` ≥3 and reviewMode `/briefing` AdFit checks are rewritten. That is required, not optional, or deploy gates the old product back in.
7. **Tests that assert the live product** (must be rewritten, not deleted as a class): `test/discovery.test.js` (RSS 200, robots rss, briefing JSON-LD CollectionPage, category briefing link count), `test/feed.test.js` (`/briefing` live HTML + `index.html` `href="/briefing"`), `test/edition.test.js` (`/api/briefing` 200, `/briefing/tech`, `/briefing/2020-01-01`), `test/briefing-quality.test.js` (source-scan of `currentBriefing` / `saveBriefing` / slot links — **keep store unit tests**; drop “page must render live edition”), `test/briefing-alert.test.js` (`index.html` blinker), `tools/preflight.mjs`. Source-scan tests of **Today** `engine.briefing` (`category-routing`, `local-editorial-edition`, `shadow-selection`) stay green without route changes.
8. **`product-blueprint` route list** still requires `/briefing` paths. Changing that file is a docs/contract edit, not a collector. Either mark `role_change`/`retired` in-place or expect `test/product-blueprint.test.js` to fail. Do not expand into a blueprint rewrite.
9. **AdFit residual:** reviewMode preflight still treats `/briefing` as the review page. Canonical indexable home is Today. Do not keep a live briefing page “for the ad unit.” Fable owns `today.html` ad format; Root only removes briefing as an ad host.
10. **Non-flag home:** if `NOWHOT_LOCAL_EDITORIAL` is off, `/` is `editorialHomeHtml` whose primary button is `/briefing`. Production compose keeps the flag on; still patch that HTML so a rollback flag does not resurrect the CTA.
11. **Do not touch** `communities.json` `*.rss.xml` URLs, `interest.js` Google Trends RSS, or parser tests. Those are inbound.
12. **Analytics** `viewLabel("/briefing") → "브리핑"` can stay for historical buckets.

## Recommended patch shape (§11.1)

One server-owned stop, no compatibility RSS, no archive microsite:

1. Replace `/briefing` and `/briefing/*` handlers with one ended HTML (or 410 HTML) that does not embed `currentBriefing()`, slot rails, or date-as-live copy.
2. `/api/briefing` and `/rss.xml` → 410.
3. Delete UI/SSR/nav/sitemap/IndexNow/robots generators listed above.
4. Disable `briefingTick` + `currentBriefing` write path.
5. Update preflight + the test files in risk 7.
6. Leave engine/store/Today/ranking/collectors/ads elsewhere.

## Dirty tree at map time

`git status` product files: none. Untracked `.serena/` / `.superpowers/` only. Root draft not present.

## Corridor

Not run. No code generated.

## Gates

- 작업 시작 전 확인한 MD:
  - 자동 주입: WRC Global Codex Start Gate; this task preamble
  - 직접 읽음: START_HERE.md; 00 Canonical §0 First Principles + §11.1; AGENTS.md gate; wrc-review-gate; orca-cli; `src/feed/server.js` briefing/RSS/sitemap/IndexNow/nav/home; `engine.js` `briefing` + `saveDailyEdition`; `store.js` briefing vs editorial vs categories; `index.html` / `today.html`; `tools/preflight.mjs`; tests listed above
  - 미읽음/불가: Root dirty diff (not on disk); live production HTML (no public GET by this worker)
  - 이번 작업 전용 파일: this report
- 적용한 규칙: Canonical 13 (indivisible); §11.1 minimal sufficient change; claim-vs-evidence; no unstated conditions; bound to briefing retirement; no product edits
- First Principles 게이트: PASS
- 개발현황 반영: 해당 없음 (검수 맵; 제품 변경 0). 안정 ID는 Root 구현 레코드가 생기면 그 보고가 갱신
- 금지선 준수: product code 0, public POST 0, deploy 0, Corridor n/a
- David 행동 필요 여부: 없음 (이미 종료 승인). Root implements; Fable Today ads only
- Telegram 알림 필요 여부: 불필요
- 이익 우선·과잉방어 점검: **GO**. Ending a superseded publisher is the simple path. WARN only on date-URL redirect honesty and on deleting `engine.briefing`. BLOCK none.
- 하지 않은 일: product edits; dirty-diff review; live curl of nowhot.kr; test runs (map is source-trace); Corridor

## Root bounded design — challenge (2026-09-05 12:46 KST message)

Root proposal: keep `engine.briefing` / digest / `todayEdition`; retire `currentBriefing` / `withEssay` / 5‑min tick / public routes / RSS / Live SSR+client UI; stop **new** `saveDailyEdition.briefing` generation while preserving prior bytes + ranking; all `/briefing*` → 410 HTML no-ad ended page linking Today; `/api/briefing` + `/rss.xml` → 410 JSON; flag-off `/` → 307 `/live`.

**Agree.** This is the minimal sufficient stop. Do not remove `engine.briefing` or `todayEdition`.

Challenges (must be true in the patch):

1. **`saveDailyEdition` is a full replace.** `store.saveDailyEdition(date, { briefing, ranking })` does `set(date, { briefing, ranking, updatedAt })`. Calling it with only `{ ranking }` **zeros today’s stored `briefing` field**. Preserve bytes by merging `prev.briefing` (or patch ranking only). Do not keep calling `this.briefing()` in refresh — that is still generation.
2. **410 HTML must not be a live generator.** No `currentBriefing()`, no stored headlines, no slot rail, no ads, `noindex`. Date URLs must not title themselves as that day’s live briefing or as Today’s selected date.
3. **307 `/live` when flag off is correct (not 308).** `/live` is `noindex`. Flag-off is a rollback, so 307 must not be cached as 308. Default tests (`createServer({ dev: true })`) hit this path; `discovery` currently expects `/` WebSite JSON-LD from `editorialHomeHtml`.
4. **Kill URL factories, not only routes.** `ownContentNav` and `rankingNav` still emit `/briefing` and `/briefing/{cat}`. `editionShell` + `index.html` still advertise `/rss.xml`.
5. **HEAD equals GET** already in server.js — 410 handlers inherit HEAD. Keep that.
6. **Preflight / discovery / feed / edition / briefing-alert** still assert the live product. Rewrite those contracts or CI resurrects it.

## Final dirty-diff review

Root patch matches the bounded design. Active product callers of legacy UI/RSS are gone except the 410 handlers.

Verified on the dirty tree:

- Writer gone: `briefingTick`, `currentBriefing`, `withEssay`, `makeWriter` import, `saveBriefing(` in server.js
- `engine.refresh` preserves `getDailyEdition(dateKey)?.briefing`, writes ranking only; `todayEdition` still calls `this.briefing()`
- `/briefing*` → 410 HTML, no-ad, noindex, generic ended copy, link `/` (does not stamp archive dates as Today)
- `/api/briefing` and `/rss.xml` → 410 JSON `LEGACY_BRIEFING_RETIRED`
- Live drawer/strip/ownBlock/`/api/briefing` fetch/RSS alternate removed; nav factories point at `/`
- Sitemap/robots/IndexNow no longer advertise `/briefing` or `/rss.xml`
- Flag-off `/` → 307 `/live` (not 308)
- Incoming RSS collectors untouched

Independent tests this worker ran: 56 focused (discovery/edition/alert/visitor/blueprint/inline/trends) PASS; previously red AdFit test PASS after Root stripped inline scripts before `kakao_ad_area`. Root reports 126/126 + Chrome 28/28 — not re-executed here in full.

## Verdict for Root

**PASS_WITH_LIMITATION.** Legacy briefing/RSS retirement is **GO** to ship.

Limitation (do not flatten): `today.html` Coupang row restyle, the matching 320/393/1100 browser style asserts, and release-note bullet 2 are Fable’s today.html ad-format lane. This review is **not** Today ad GO. Coordinator should not cite Grok for those hunks.

Residuals (not blockers): leftover blank in Live `setupBrandHome`; `edition.test.js` still looks for the substring `브리핑` on the 410 page; `/briefingfoo` (no slash) is not 410.

First Principles 게이트: PASS.
