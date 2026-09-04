# NH113 Grok independent review — Today slot continuity

Status: READ-ONLY. No product deploy, paid API, or model change. Local HEAD at review start included packaging commit `05e93d6`. During this review Root also landed a pointer continuity patch in `src/feed/slot-canonical-edition.js` plus tests; those bytes were re-read and the focused file was executed (`test/slot-canonical-edition.test.js` 31/31 pass). This is not a production GO.

## Verdict for Root

**GO on the serving idea, with required counterexamples still missing.** Ship labeled 24h pointer continuity for a *missing* exact key. Do not treat Docker `COPY tools` as the Today 409 fix. Do not widen into category/content rebuild, paid summaries, or silent date/slot rewrite.

Public stuck-on-lunch is three stacked faults, not one:

1. **Publish root:** runtime image used to omit `tools/`, so `runLocalCanonicalPrepublish` could not import `tools/run-slot-canonical-prepublish.mjs`. Compose already sets `NOWHOT_SLOT_CANONICAL_EDITION=1`. Evening/morning never activate; lunch pointer stays. `05e93d6` copies `tools/` plus `test/fixtures/selection-d1-candidates.json` and smoke-imports the publisher. Necessary to *create* later slots. Not sufficient for GET during the build lag, a HOLD build, or a stale pool window (`resolveSlotCanonicalBuildTarget` rejects `savedAt` outside the slot window). Child builder already strips `ANTHROPIC_API_KEY` unless `--allow-paid`; keep `allowPaid: false`.
2. **Serve root:** `makeSlotCanonicalEditionReader` used exact `date:slot` only and hardcoded `fallback: false`. Missing evening/morning → `SLOT_CANONICAL_EDITION_UNAVAILABLE` → `/api/today` HTTP 409. `projectSlotCanonicalEdition` already had honesty fields (`fallback`, `requestedDate/Slot`, `servedDate/Slot`, `state: fallback_slot_pointer`). The WIP reader now walks older pointer keys within `EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs` (24h), skips future keys, skips escaped/mismatched candidates, and projects the approved artifact with `fallback: true`.
3. **Chrome root:** `today.html` `renderError` special-cases only `EDITORIAL_EDITION_NOT_SERVEABLE`. `SLOT_CANONICAL_EDITION_UNAVAILABLE` / `EDITORIAL_SLOT_NOT_DUE` replace `#issues` and leave `dateLine`, `editionTitle`, and slot `active` from the last successful `render()`. Init restores `todayHistory` lunch and **skips** `loadEdition`. After a lunch 200, `state.slot` is pinned and refresh keeps requesting lunch even when evening is due.

Packaging without continuity → 409 until a new slot activates. Continuity without packaging → lunch can be labeled for 24h, then 409 anyway (`2026-09-04 12:00` → `2026-09-05 19:00` is 31h). Both are required. Continuity must not mutate the lunch artifact or mix lanes across editions.

## Callers (complete)

| Caller | Path | Notes |
| --- | --- | --- |
| `createServer` GET `/api/today` | `src/feed/server.js` | Only production reader. Resolves `localEditionTarget`, then `reader.read`. 409 on `EDITORIAL_SLOT_NOT_DUE`, `EDITORIAL_EDITION_NOT_SERVEABLE`, `SLOT_CANONICAL_EDITION_UNAVAILABLE`. `SLOT_CANONICAL_EDITION_INVALID` is **not** mapped → 500. |
| Tests | `test/slot-canonical-edition.test.js` | Direct reader plus a few GET dispatches. |
| Builder/activate | `tools/build-slot-canonical-edition.mjs`, `tools/run-slot-canonical-prepublish.mjs` | Write path. GET must stay `filter_only`. |
| Legacy editorial fallback | `buildServeableTodayEdition` / `verifiedEditorialFallback` | Dead for public Today while slot-canonical is on. Do not revive inventory generation on this GET. |

`/` with `NOWHOT_LOCAL_EDITORIAL=1` already serves `today.html` (not an empty briefing body). Crawler 409 is `/api/today`, not the shell.

## Minimal safe continuity (keep this shape)

When the exact pointer key is **absent**:

1. Consider pointer rows whose key parses as `YYYY-MM-DD` + `morning|lunch|evening`.
2. Candidate `asOf` (key time, which must equal artifact civil date+slot) `<` requested `asOf` and `requestedAt - at <= 24h`.
3. `load` must keep: path sandbox, `assertSlotCanonicalEdition`, `artifactId`/`contentSha256` match, **and** `pointerKey(artifact.editionDate, artifact.slot.id) === pointer key`.
4. Invalid older rows are skipped; do not abort the walk.
5. Serve the newest valid artifact through existing `projectSlotCanonicalEdition` with `fallback: true`, `requestedDate/Slot` from the request, `servedDate/Slot` from the artifact. `llmCalls` stays 0. Pointer bytes and artifact files stay untouched.
6. If none remain, keep Korean `SLOT_CANONICAL_EDITION_UNAVAILABLE` 409.

When the exact key **exists**: load only that row. Corrupt exact → fail closed (`SLOT_CANONICAL_EDITION_INVALID`). Do not substitute lunch and call it evening.

Future not-due stays in `localEditionTarget` / `EDITORIAL_SLOT_NOT_DUE` before the reader. Do not move due checks into the reader.

## Required counterexamples (Root still owes tests)

Current new tests cover missing evening/next morning → labeled lunch, 24h cap, future planted `08-28:lunch`, escaped `../outside.json`, aliased evening→lunch identity, corrupt lunch hash → older morning, empty pointer 409. They do **not** lock the incident GET path or the fail-closed exact row.

| Case | Required behavior | Why |
| --- | --- | --- |
| **Explicit historical exact hit** | `?date=2026-09-04&slot=lunch` while evening is due → lunch, `fallback: false`, no rewrite to a newer missing slot | Preserve the approved edition. Continuity is for *missing* keys only. |
| **Explicit historical missing** | `?date=2026-09-04&slot=evening` with only lunch present → 200 lunch, `fallback: true`, `requestedSlotId=evening`, `servedSlotId=lunch`, same issue ids as lunch filter | This *is* the public evening click. Labels must be honest. NH90 silent substitute stays forbidden; labeled pointer continuity is the repair. |
| **Latest implicit due** | GET `/api/today` with no `date`/`slot` at `2026-09-05T07:10+09:00`, pointer only `2026-09-04:lunch` → 200 fallback lunch, not 409 | Crawler/ad 409 and fresh visit. Add a `createServer` + `clock` dispatch; reader-only tests do not prove this. |
| **Future slot** | Same lunch pointer, `2026-09-05T15:00+09:00`, `?slot=evening` → 409 `EDITORIAL_SLOT_NOT_DUE`, no lunch body labeled as evening | Server already does this. Keep it. Reader must not be reachable for not-due. |
| **Corrupt exact pointer** | Exact `2026-09-04:evening` row present with bad hash / escaped file / slot mismatch → `SLOT_CANONICAL_EDITION_INVALID` (or mapped 409), **not** lunch | WIP `load(exact)` is uncaught. Good fail-closed. Missing test. Also map INVALID on GET so Today does not 500. |
| **Corrupt older candidate** | Already sketched in the new test; also assert `servedDate === artifact.editionDate` and `fallback === true`, not only `servedSlotId` | Planted `08-28:lunch` pointing at 08-27 lunch bytes must never report servedDate 08-28. |
| **Date-label honesty** | `today.html` already prints served date/slot and “최신 {requested}판은 검수 중” when `serving.fallback` | GET 200 with `fallback: true` fixes chrome. Remaining 409 still leaves stale lunch title/tabs. |
| **Category/content freeze** | Fallback uses one artifact’s `displayOrder` ∩ requested categories. `news+tech` union ids must equal that lunch projection, not a mix of lunch+morning | WIP projector already does this; add an assertion on the 08-28 morning query. |
| **Client pin / snapshot** | After lunch snapshot restore, still fetch current due (omit pinned `slot`, or compare to `resolveEditorialTarget`) | Otherwise returning users never ask for evening and stay on exact lunch 200 with `fallback: false`. This is a second stuck path after server continuity. |
| **24h expiry** | `2026-09-05T19:10+09:00` vs lunch `2026-09-04T12:00+09:00` → 409 | 31h. Do not extend the window to hide a dead publisher. |

P2, do not block: fallback currently also runs when an exact key exists but `file` is falsy. Safer: fallback only when the exact key is **absent**. Empty planted evening should 409, not masquerade as continuity.

## What not to do

- Do not generate a new evening/morning inside GET. `requestWork` stays `filter_only`.
- Do not turn on `NOWHOT_ARTICLE_SUMMARY` or pass `allowPaid: true` to close 409.
- Do not copy the whole `test/` tree into Docker; the fixture exception in `05e93d6` is the right bound.
- Do not “fix” 409 by serving lunch as if it were the requested slot (`fallback: false`).
- Do not change lane membership, union semantics, or approved lunch bytes to make a missing slot look complete.

## Client note (same incident, optional same PR)

`render()` already keys tabs on `requestedSlotId` and copy on `serving.fallback`. Once implicit/evening GET returns 200 fallback, the stale-tab symptom on that click path closes. Still fix: (1) `renderError` for UNAVAILABLE/NOT_DUE should at least set `dateLine`/`editionTitle` from `error.body` so a true 409 is not a lunch costume; (2) init must not treat a lunch history snapshot as a substitute for current due.

## Evidence bounds

Read: owner takeover `docs/reports/NOWHOT_OWNER_TAKEOVER_2026-09-05.md`; `slot-canonical-edition.js` reader/projector; `/api/today` and `localEditionTarget`; `today.html` `render`/`renderError`/`init`/`loadEdition`; Dockerfile/`docker-compose.yml`/`05e93d6`; prepublish `allowPaid` env strip; NH90.1 exact-key rule. Did not inspect the live VM pointer, `nowhot.kr` responses, or paywalled APIs. Docker import smoke ≠ evening activation proof.

truth: NH113_GROK_REVIEW·DOCKER_TOOLS_NECESSARY_NOT_SUFFICIENT·READER_EXACT_MISS_24H_LABELED_GO·EXACT_CORRUPT_FAIL_CLOSED·GET_CLOCK_TEST_MISSING·CLIENT_SNAPSHOT_PIN_REMAINS·NO_PAID_NO_DEPLOY·FILTER_ONLY
