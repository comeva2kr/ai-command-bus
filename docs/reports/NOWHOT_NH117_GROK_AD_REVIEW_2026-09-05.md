# NH117 Grok review — Coupang disappearance under AdFit review mode

Status: READ-ONLY review. No product/test edits, paid API, deploy, or browser mutation by this worker.
Local HEAD: `da7cb32` (`docs: record NH116 production verification`).
Public symptom (coordinator): `GET /api/config` → `monetization.enabled=false`, `adfit.reviewMode=true`, `coupang=null`.
This worker did not author the dirty tree. During the review Root already landed the common-boundary restore in uncommitted files; those bytes were re-read and the focused tests below were executed against them.

Out of scope: Hot ranking / `rank.js` / NH116 selection. Live `sort=hot` Coupang slots share `_monetize` with latest/deals; restoring that gate is Live Coupang, not ranking work.

## Verdict for Root

**GO on the common-boundary restore already in the dirty tree.** Uncouple `adfitReviewMode()` from Live Coupang. Keep it as the editorial AdFit-only switch.

Do not invent a second client `reviewMode` check. Do not put an AdFit unit on `/api/config`. Do not put Coupang on `/`, `/briefing`, or `/report`. Do not retune Hot ranking.

First Principles 게이트: PASS.

## Why public Coupang is null

Two stacked kill switches, both keyed off the same `adfitReviewMode()` (`ADFIT_ENABLED==="1"` && `ADFIT_UNIT_MOBILE`):

| Layer | HEAD (`da7cb32`, includes NH112 `0b613c1`) | Effect |
| --- | --- | --- |
| `/api/config` since `f2ca3da` (2026-08-13) | `monetization.enabled: !reviewMode && (COUPANG_PARTNER_ID \|\| AD_PREVIEW)`; `coupang = reviewMode ? null : loadBanners()` | Live client has no inventory |
| `_monetize` since `0b613c1` (2026-09-04) | `engine.monetizationDisabled = adfitReviewMode()` then empty `{items: batch, slots: []}` | `/api/feed` (hot/latest/deals) has no `via=ad` |

Editorial surfaces were already independently AdFit-only:

- `adPage()` returns `() => ""` when `reviewMode`
- `displayAdHtml()` / `adLoadersHtml()` serve one Kakao unit + SDK
- `editionShell` injects `displayAdHtml()` only on indexable pages (`noindex` skips it)
- `/` (SSR or `today.html`) gets that AdFit slot; `/live` is `index.html` and never receives `adfit.mobileUnit`

NH112 treated a Live `via=ad` leak as a review-mode defect and inverted the unit test. The rescue contract never required Live Coupang to be zero. It required: editorial AdFit 1, no AdSense/Coupang on that editorial page, no AdFit unit/SDK on `/live`.

## Callers (complete for this bug)

### Server

- `src/feed/server.js` `adfitReviewMode()` — single env gate (`test/inline-js.test.js` still asserts one `ADFIT_ENABLED === "1"`).
- `GET /api/config` — `monetization`, `adfit: { mobileUnit: null, reviewMode }`, `coupang`.
- `engine.monetizationDisabled` setter (HEAD only) → `FeedEngine._monetize`.
- Editorial: `adPage`, `displayAdHtml`, `adLoadersHtml` used by `/`, `/briefing`, `/report`, and `today.html` injection. Ranking/keywords/community/trends already pass `adPage(false)` or `eligible=false`.

### Engine

- `_monetize` is the only affiliate injector for `/api/feed` default, `sort=latest`, and `sort=deals`. Partner id / `AD_PREVIEW` still required after the restore. Dummy content remains forbidden.

### Live client (`src/feed/public/index.html`)

- `maybeInsertAdfit()` — early `if(!unit && !cp) return`. `useAdfit` is hardcoded `false`; remaining slots are Coupang from `state.config.coupang`.
- `detailAdHtml` / `pickCoupangLink` / `pickCoupangByDest` / `adfitFallback` — all no-op when `coupang` is null.
- `ensureAdfitPlacement()` — no-op while `mobileUnit` is null (correct for Live).
- `maybeShowAdNotice()` — gated on `monetization.enabled`, not on `coupang`.
- `appendAdCard` — server `via=ad` still renders from the item; disclosure falls back to `cp.disclosure`. Both config and `_monetize` must move together.
- `restoreLiveList` — client-inserted ads are DOM-only. Without `maybeInsertAdfit()` after restore, back-navigation drops Live Coupang even when config is healthy. Dirty tree adds that one call; it matches `renderBatch`.

## Smallest common-boundary fix (do not widen)

Keep `adfitReviewMode()` for editorial placement only. Restore Live Coupang with three server bytes plus the restore-path client line:

1. Do **not** assign `engine.monetizationDisabled = adfitReviewMode()`.
2. `/api/config` `monetization.enabled = Boolean(COUPANG_PARTNER_ID) || Boolean(AD_PREVIEW)` — drop `!reviewMode &&`.
3. `/api/config` `coupang = loadBanners()…` — drop `reviewMode ? null :`.
4. Keep `adfit.mobileUnit: null` and `reviewMode` as the public flag.
5. Keep `adPage` / `displayAdHtml` / `adLoadersHtml` unchanged.
6. After list restore, call `maybeInsertAdfit()` so history restore uses current inventory.

Dirty tree already has this shape:

- `src/feed/server.js` — comment + the three server uncouplings.
- `src/feed/public/index.html` — `restoreLiveList` → `maybeInsertAdfit()`.
- `test/briefing-quality.test.js` — title and assertions restored to Live Coupang.
- `test/browser-navigation.test.js` — fixture `/api/config` now carries `coupang` / `monetization`; new restore test.
- `tools/preflight.mjs` — Live ads keyed off `liveMonetization`, not `reviewMode`; inventory check when enabled.
- `docs/NOWHOT_ADFIT_RESCUE_001.md`, `docs/monetization.md` — Live Coupang independent of editorial AdFit.

Leave `if (this.monetizationDisabled)` in `engine.js` unwired. Do not reconnect it to review mode. Deleting the latch is optional hygiene, not required for the restore.

## What must stay true after the restore

| Surface | Contract |
| --- | --- |
| `/` (review mode) | Exactly one `.kakao_ad_area`, Kakao SDK, no AdSense, no `link.coupang.com` / 쿠팡 파트너스 in the editorial HTML |
| `/live` HTML | `noindex,follow`; no Kakao/AdSense script tags in the document |
| `/api/config` | `adfit.mobileUnit === null`, `adfit.reviewMode === true` |
| `/api/config` Live Coupang | `monetization.enabled === true` when partner/preview is set; `coupang.items.length > 0` from `loadBanners()` |
| `/api/feed` | `via=ad` present when partner/preview is set (same `_monetize` for hot/latest/deals) |
| `/ranking` SSR | unchanged; still `adPage(false)` / review-mode empty. Do not open this ticket into Hot ranking |

## Runnable regression (this worker executed)

Primary lock — already encodes the desired split:

```text
node --test --test-name-pattern='AdFit 심사 모드' test/briefing-quality.test.js
```

Dirty result: **pass 1 / fail 0**, ~1.0s. The test sets `ADFIT_ENABLED=1`, `ADFIT_UNIT_MOBILE`, `AD_PREVIEW=1`, `COUPANG_PARTNER_ID=AF-test`, then asserts editorial AdFit=1, Live `mobileUnit=null`, `reviewMode=true`, `monetization.enabled=true`, `coupang.items.length>0`, and `/api/feed` `via=ad`.

HEAD (`0b613c1` onward) inverted that test to `enabled=false`, `coupang=null`, `via=ad === false`. That inversion is the lock-in of the disappearance, not the rescue contract.

Companion (pass 2 / fail 0):

```text
node --test --test-name-pattern='애드핏 심사 모드|adfit: env' test/inline-js.test.js test/monetize.test.js
```

These still only lock “one review-mode function” and “Live never receives `mobileUnit`”. They do not lock Coupang. Keep them; they prevent putting AdFit on Live.

Root should run (not executed here; Playwright / public network):

```text
node --test --test-name-pattern='restored Live list uses the current Coupang' test/browser-navigation.test.js
node tools/preflight.mjs https://nowhot.kr
```

Public preflight after deploy must show: editorial AdFit 1, Live no unit/SDK, and — when credentials exist — Live inventory + `via=ad`. It must **not** require `coupang===null`.

## What this worker did not do

- No product or test writes. Dirty files listed above are Root’s.
- No public `/api/config` fetch, no paid Coupang/AdFit/AdSense calls, no deploy, no browser control.
- Local shell had `ADFIT_ENABLED` / `COUPANG_PARTNER_ID` / `AD_PREVIEW` unset; the briefing-quality test injects them.

## Remaining for Root (live verification)

1. Land the dirty common-boundary patch as one change. Do not split `_monetize` by sort.
2. After deploy, measure public `GET /api/config`: expect `reviewMode=true`, `mobileUnit=null`, `enabled=true` if `COUPANG_PARTNER_ID` is on the VM, `coupang.items` non-empty.
3. Measure public `/` AdFit=1 and `/live` still without network loaders.
4. Measure a fresh `/api/feed` session for `via=ad` when credentials exist.
5. Optional: delete or comment the dead `monetizationDisabled` latch so NH112 cannot be re-wired by accident.
