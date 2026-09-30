# NH167 live-readiness review — 2026-09-30

**Verdict: not-ready.**

The 9/30 lunch candidate shows one Tucson sales announcement as three auto-lane cards. `1천60만대` and `1060만대` are the same count, and the `1000만` card is the same announcement rounded. Analytics does not add a false zero. Rolling the old validator off a v2 lane is an expected schema boundary, not a second defect.

## Tucson — blocking

Live base `SCE-9da8530b0dd50c50` has one auto-lane Tucson card (rank 1). Candidate `SCE-f11ad1898284fa08` has three, at ranks 1, 16, and 17 (`/tmp/nh167-release-tucson-repeat.json`).

| Rank | Id | Headline |
| --- | --- | --- |
| 1 | `31a1eef1ace57ae68d9a654eb20d15dc54a413381832c43dcfd04d07f63f1b8a` | '22살' 투싼, 글로벌 누적 판매 1천60만대 돌파 |
| 16 | `080924f2cd846081319ae18c26743a32e88458e9b5de1a0ae11daefab24de4d7` | …투싼, 22년 만에 1000만 고지 넘었다 |
| 17 | `d3f44221fad3021a4213040df2301436bf5afffa2d3e5debeab3718789cf39f5` | 투싼 누적판매 1060만대 돌파… |

These are not three facts. Ranks 1 and 17 are 10.60 million written two ways. Rank 16 says 1000만, and that card’s 동아일보 summary states the same total, 1061만6102대. The 22-year mark and the 5th-generation mention are context, not a separate event. The live 14-card lane hid ranks 16 and 17. The extra lane is what makes them visible.

Repro: `/tmp/nh167-release-grok-repro.mjs` (output `/tmp/nh167-release-grok-repro.json`).

- Rank 1 vs 17: `decideEventMerge` → `guard_number_conflict`. `crossSlotMaterialChange` → `changed_headline_number: ["1060만대"]`.
- Rank 1 vs 16: `guard_entity_overlap_min` (shared token is 투싼). The quantity check sees no new number because `1000만 고지` has no unit suffix the quantity pattern accepts.
- Rank 16 vs 17: `guard_number_conflict`, and `1060만대` is treated as a new quantity.

Cause: `numericValue` keeps only the leading digits, so `1천60만대` becomes `"1"` while `1060만대` becomes `"1060"` (`src/feed/event-cluster.js:169`, conflict at `299:301`). `headlineQuantities` then stores those spellings as different tokens (`tools/build-slot-canonical-edition.mjs:504-509`).

Expected: one auto-lane card. Actual: three. Minimal repair: give `1천60만` and `1060만` one numeric value before the conflict guard, and do not keep a round `1000만`/`천만` headline as a second card when that article’s own summary is the 1060만 figure. Do not turn the conflict guard off for unrelated numbers.

Severity: high. Blocking: yes.

## Analytics — no new defect

Focused tests: `node --test test/analytics-window.test.js` → 7 pass, 0 fail, 1 skipped (browser form; Playwright is not loadable here). Root’s browser run is not re-counted as mine.

| Check | Result |
| --- | --- |
| Pre-measure session still open at cutover | Continuing it does not create `measure`. A completed window that starts at `journeyWindow.since` is `complete` with 0 sessions. That session started before measurement. `store.js:773`, `700`. |
| Same browser after 30 minutes idle | Next view is a new measured session. Count in that later window: 1. |
| Window that starts before `since` | `unmeasured`, `metrics: null`. Not 0. `analytics.js:91`. |
| Save, delete `journeyWindow`, load again (old binary rewrite) | `since` moves to the new boot. The old interval is `unmeasured`, not 0. `store.js:44`, `2366`. |
| Identity in the window response | Visitor id absent. |
| Admin auth / capacity gap / D7 overlap / 100k cap | Covered by the 7 passing tests. New route stays behind `server.js:3703`. Track still drops non-`observed` at `server.js:3647`. |

`$99` and `99달러` are not a new quantity. `$99` to `129달러` is. `$99.00` still becomes `99.00달러`, so it can look new. That keeps a possible duplicate; it does not drop a real price change. Blocking: no.

## Rollback — expected schema step

`/tmp/nh167-release-rollback-compatibility.json`: the v1 validator rejects lunch v2 `SCE-f11ad1898284fa08` (`contract mismatch`, lanes over 14) and accepts the real v1 artifact. Current code allows the extra lane only for a non-legacy contract (`slot-canonical-edition.js:169`).

That rejection is the schema boundary. Rollback prerequisite: restore the old image and keep serving the last v1 artifact. Do not point the old process at the v2 file. This is not a product bug.

## Model

Requested `grok-4.7-xhigh`. Coordinator launch receipt: requested/effective `grok-4.7-xhigh`. Separate provider ACK: unconfirmed.

## Not done

No product, test, or docs edits. No commit, push, or deploy. Full suite and Docker/live parity were not re-run here; Root already reported those.
