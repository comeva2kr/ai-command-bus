# NH118 Grok review — immersion eager paging (bounded)

Status: READ-ONLY. No product edits, network probes, or WRC research.
Reviewed: uncommitted root patch in `src/feed/public/index.html` (`nearFeedEnd`, `loadMore` finally, `setupInfiniteScroll`) and `test/browser-navigation.test.js` (new nested-bottom case).

## Verdict

**GO.** Smallest root fix matches the live failure: viewport IO on `#sentinel` (sibling after `#feed`, ~top 939) cannot mean “end of list” while `body.immersion #feed` is a fixed-height nested scroller. Root can reproduce, then rerun browser tests.

## Why this stops 220→470 without scroll

- Normal path unchanged: sentinel `top < innerHeight + 1400` is the same predicate `loadMore` already used.
- Immersion path uses remaining nested distance (`scrollHeight - scrollTop - clientHeight < 1400`). Ten full-height cards at `scrollTop=0` leave ~9×`--imm-h` (≥320px) ≫ 1400, so the finally-chain and first IO callback cannot keep fetching.
- `#feed` scroll listener is required: sentinel stays intersecting, so IO will not re-fire when the user actually reaches the nested bottom.

## Test

`browser: immersion loads more only near the nested feed bottom` locks the sort-while-immersed chain (the live cascade) and one nested last-card fetch. Existing `approaching the list bottom` case still drives normal mode via `#sentinel`. Residual (non-blocking): the new test samples `before` after toggling immersion, not a cold `feed_immersion=1` boot; same `nearFeedEnd` gates that boot path.
