# NH118 Grok review — correction + dirty-tree patch (final)

Status: READ-ONLY. No product/test edits, paid API, deploy, ad clicks, or extension setting changes.
Reviewed: local HEAD `416245b` plus Root’s **uncommitted** NH118 patch (`index.html` `dropIfAdBlocked`, `today.html` affiliates, `server.js` `/` static serve, `test/briefing-quality.test.js`, `test/browser-navigation.test.js`, `tools/preflight.mjs`).
This file **corrects** the earlier NH118 diagnosis in this same path (over-attributed Root Chrome to immersion).

Out of scope: Hot ranking. Root owns fix/deploy.

## Verdict

**GO** on the dirty-tree Live guard change and Today affiliate insertion, with the cause table below. Do not ship a story that “Root Chrome ads0 was immersion.”

| Cause | Proven? | What it does | Does this patch fix Root’s dedicated Chrome? |
| --- | --- | --- | --- |
| **Observed Root Chrome (CDP)** | Yes. `body` class **empty** (몰입 off). `.ad-card` winning style `display:none !important`, **origin=`user-agent`**. `a.card-go` still `display:block` / own style visible. | Chrome (UA `[hidden]` mapping or built-in ad hide) hides the **article**, not the link. Cards can sit in the DOM invisible; `dropIfAdBlocked` may later `remove()` them via `offsetParent===null`. Independent clean IAB has no such UA hide → ads display. | **No, and must not.** Unhiding `.ad-card` or renaming it would be bypass. User-agent hide of the card is respected. |
| **Immersion `display:contents` × old `dropIfAdBlocked`** | Yes as **additional code bug**, not the CDP session. `body.immersion #feed .card.ad-card .card-go{display:contents}` makes the link a no-box node (`offsetParent` null, height 0) while `.go-text` still paints. | Any user with `feed_immersion=1` loses every Live Coupang card ~1 frame / 600ms after insert, even with no blocker. Playwright now locks this. | Fixes that landmine. Irrelevant to the captured Chrome tab (`bodyClass` empty). |
| One blocked Coupang **image** | Insufficient. `onerror` only removes `.go-thumb`. | Text+CTA remain. | N/A. New test: immersion + failed image still keeps `.go-cta` and disclosure. |

First Principles: PASS (no ranking, no class-name evasion on Live, disclosure kept).

## Correction of the prior NH118 Grok note

The first write treated immersion as the likely Root Chrome cause (“persisted `feed_immersion` vs clean IAB”). **That causal claim is withdrawn.** CDP: empty `body` class. The additional bug remains real and is now patched; it was the wrong explanation for **that** Chrome.

“Inserted anchors then ads0” still fits **either** path: `data-ad-after` is set before drop; UA hide of `.ad-card` also yields visible-count 0. Image `ERR_BLOCKED_BY_CLIENT` only proves a request started, not why the card vanished.

## Live guard review (hidden-body still honored, no bypass)

Dirty `dropIfAdBlocked`:

```javascript
const body = card.querySelector("a.card-go");
const content = body && getComputedStyle(body).display === "contents"
  ? body.querySelector(".go-text") : body;
const hidden = !body
  || getComputedStyle(body).display === "none"
  || getComputedStyle(body).visibility === "hidden"
  || !content || content.offsetParent === null
  || content.getBoundingClientRect().height < 8;
if (hidden) card.remove();
```

| Case | Result |
| --- | --- |
| Missing `a.card-go` | Remove. Real missing body. |
| `a.card-go { display:none }` (Playwright “explicit content blocker”) | Remove. `getComputedStyle(body).display === "none"` still runs on the **link**, not only `.go-text`. |
| `visibility:hidden` on the link | Remove. Still checked on `body`. |
| Immersion `display:contents`, `.go-text` paints, image gone | Keep. Probe moves to `.go-text` only when display is `contents`. |
| CDP case: `.ad-card` UA `display:none !important`, link still `block` | Remove via `content.offsetParent === null` / height &lt; 8. **Does not unhide.** No `!important` override, no class rename. |
| `display:contents` but `.go-text` missing or no box | Remove. |

Not a bypass: Live still uses `card-go` / `ad-card`; comments still forbid renaming to evade lists. The `.go-text` branch is gated on **our** immersion unwrap (`display==="contents"`), not on “card is hidden.”

Call sites unchanged: `appendAdCard`, `maybeInsertAdfit`, `adfitFallback`. `detailAdHtml` still does not call the guard (detail is outside `#feed` immersion CSS).

New Playwright (`test/browser-navigation.test.js`):

1. **Immersion + image failure** — `feed_immersion=1`, broken `img`, wait 800ms, `.go-cta` &gt; 0, `.go-thumb` 0, disclosure text; then inject `.ad-card .card-go { display:none!important }` and assert `.ad-card` count 0. Red-then-green lock for both the false-positive and the real hide.
2. Does **not** mock UA hide of `.ad-card` itself; that is the dedicated-Chrome environment, not a product bug to invert.

## Today diff — numbering and trust (quick)

Placement: `index>=2 && (index-2)%10===0` after the `</article>` of that issue. With 18 fixture issues: ads after index 2 and 12 → **2** asides. Numbers stay on `.issue .issue-number` = `padStart(index+1)`. Ads are `aside.ad-coupang`, not `.issue`, so they do **not** steal 01–18. Test asserts `["01"…"18"]`, first ad `previousElementSibling.dataset.issueIndex === "2"`, reload keeps 18 issues + 2 ads. Detail injects `todayAdHtml(issue,index,"today-detail")` without sharing the list `seenAds` Set (repeat dest vs list is allowed).

Trust (GO with one WARN):

- Inventory from `/api/config` (`state.coupang=config.coupang`). Empty/missing disclosure → `""` (no fake cards).
- Href allowlist `^https://link.coupang.com/`; `new URL` + `subId`; `esc()` on copy, href, img, disclosure.
- `rel="nofollow sponsored noopener"`, `AD · 쿠팡 파트너스`, `.ad-disclosure`.
- `externalHref` on images; `onerror` removes thumb only.
- Dest de-dupe in one list render (`seen`).
- `/` no longer injects `adLoadersHtml`/`displayAdHtml` when `localEditorial` (empty Kakao/AdSense slot removed). Tests + preflight inverted for that branch only; non-`localEditorial` + `reviewMode` still requires AdFit=1 on `/`.

**WARN (not BLOCK):** Today uses `a.ad-native`. Live already abandoned that class after iOS blockers hid the body and left the shell (2026-08-06). Playwright has no content-blocker on Today. Do not “fix” Live `.ad-card` the same way; if Today shells appear on real phones, rename **Today layout class only** the way Live went `ad-native` → `card-go`, without touching disclosure/AD.

**Note:** This patch will **not** make Root’s dedicated Chrome show Live `.ad-card` while UA `display:none !important` still wins. Success metric after deploy: clean IAB + immersion Playwright + Today numbering; dedicated Chrome ads0 remains consistent with CDP, not a residual immersion miss.

## Corridor (readonly)

No new Live `innerHTML` sink in the guard (measurement only). Today markup is escaped. No Live class evasion. `card.remove()` still shell cleanup after a hide, not an unhide.

## Remaining for Root

1. Land the dirty tree as one change. Do not document Root Chrome ads0 as fixed.
2. Run the two new `browser-navigation` tests (already red-then-green in Root’s run).
3. Optional later: Today `ad-native` rename if real devices show shells. Not required to GO this patch.
4. Do not reopen ranking. Do not recouple `adfitReviewMode()` to Live Coupang.
