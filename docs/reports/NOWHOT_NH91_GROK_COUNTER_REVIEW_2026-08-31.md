# NH91/NH93 Cursor Grok 4.6 xhigh counter-review (read-only)

- Date: 2026-08-31 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6 xhigh, dispatched worker
- Scope: uncommitted working tree vs HEAD `e79856c`, plus existing shortlist/slot paths
- Code read only. No product edits, paid APIs, rebuilds, commits, deploys, or pointer writes.
- Facts accepted from coordinator: NH91 intended 2,198 classifications stopped after 4 API calls; recovered routing admitted 2,199 using 242 model rows + 1,957 source/legacy fallbacks; strict model-only leaves news at 8; unpaid replay cut tech foreign filler 11→2 then legacy off-topic filled the gap.

## Verdict

**NO-GO.** P0: 4. P1: 5. P2: 4.

Geo-floor removal in `buildDigest` and the foreign-major assertion drop are real. They do not make a publishable plate. Legacy/source-only rows still count as admitted supply; the 13-floor still fills from that supply; classified coverage is not preflighted; the existing shortlist runner is not on the slot-build path and does not rank missing-category candidates.

Do not activate a new pointer from this tree. Preserve the current local pointer until classified coverage per lane is a fail-closed gate.

## Audit minimum vs this tree

David: no foreign minimum, important world news, 13–14 **valid** items per category, no filler, exact union, immutable event and details.

Audit minimum proposal (this review's acceptance bar):

| Requirement | This tree |
|---|---|
| Legacy/source-only rows cannot count for publication | **Fail.** `--allow-legacy-fallback` still writes `legacy_classifier_fallback` categories. Router then admits them, and may rewrite them via URL section or publisher label. Tests lock the admit path. |
| Preflight classified coverage per category | **Fail.** Slot builder never counts `current_model`/`prior_exact_hash` per lane before `buildTodayEditionInProcess`. |
| Reuse targeted shortlist runner for missing high-ranked candidates before build | **Fail.** Runner exists only on the shadow canary CLI. Slot builder never calls it. Ordering is source round-robin of unclassified general news, not missing-lane rank. |
| HOLD and preserve pointer below 13 **valid** items | **Partial / fail.** `assertSlotCanonicalEdition` already fails lane length < 13, but the 13 may be legacy filler. Activation has no classified-validity check, so a 14-of-filler plate can still move the pointer. |

## Hidden assignment paths (every path that can put a row in a lane without a current/prior model row)

Live on the slot path (`tools/build-slot-canonical-edition.mjs` → `buildTodayEditionInProcess` → `createCategoryRouter.project` → `engine.briefing` → `buildDigest`):

1. **Recovery `allowLegacyFallback`** (`tools/build-category-routing-snapshot.mjs` 135–140). If the flag is true, a target with known `legacyCategory` and kind news/community/deal is admitted as `legacy_classifier_fallback`. CLI still exposes `--allow-legacy-fallback`. Test at `test/category-routing.test.js` 293–305 **requires** politics/humor from empty predictions.

2. **Router URL section rewrite** (`src/feed/category-routing.js` `legacySectionCategory` + `LEGACY_SECTION_CATEGORIES`). For `legacy_classifier_fallback` only, a unique pathname token (`world`, `movie`, `technology`, …) overwrites the snapshot category. Test 966–988 admits `world`→news and `movie`→culture. This is a second classifier, not a withhold.

3. **Router publisher-label rewrite** (same file, `publisherCategories` + `/^gnews(?:-|$)/i`). Unique registry label, excluding generalist `{news,business,politics}`, overwrites the snapshot category. Disabled seed `ilovepcbang` was added to `communities.json` solely to drive this path. Tests 991–1060 lock `legacy_publisher_label_recovery`.

4. **Declared specialist section** (`declaredSection` when `!entry`). Items absent from the snapshot still receive `meta.category` as `declared_specialist_section`. Test around line 330 still expects this basis.

5. **Stale snapshot fallback** (`staleFallback`): `item.admittedCategories` or `item.category`. Basis `snapshot_stale_declared_category`.

6. **Post-snapshot declared category**: items first seen after `generatedAt` with `isKnownCategory(item.category)` become `post_snapshot_declared_category`.

7. **Engine `_classifyItems`** (`src/feed/engine.js` 1290–1417), runs **before** the router: deal→registry category, mixed-best fallback, `definiteCategory` keyword/URL, specialist NB correction, aggregate NB reclassification, `classifyTitle` for reclassifiable sources. Those writes become `item.category` for paths 5–6 and for packet `legacyCategory`.

8. **Engine `_items()` registry overwrite** (1110–1122): non-reclassifiable sources are forced back to `registeredCategory` unless a keyword hit exists.

9. **Candidate geo reserve** (`src/feed/edition-candidates.js` 146–162). For every category in `CATEGORY_DOMESTIC_SHARE_BANDS`, the fixture **reserves** domestic and overseas seats (`ceil(budget/2)` / `floor(budget/2)`) before leftover rank fill. Engine personalized briefing still passes `domesticShareBands: CATEGORY_DOMESTIC_SHARE_BANDS` (engine.js 3301). Tests lock 14 KR + 14 US, 7/7, and 7/6.

10. **Digest category floor fill** (`src/feed/digest.js` 871–883). After geo-quota removal, `fillCategoryGroup(..., () => true, floor, true)` still walks **any** admitted member with `ignoreSourceCap` until `minIssuesPerCategory`. That is the filler pump: if a lane is short, off-topic admitted rows occupy the seats rather than HOLD.

11. **Morning `overseasBias: 1.6`** (`digest.js` 624, applied in `engine.js` 3338–3341). Language/`translated` tilt, not country. Still live on briefing after the claimed geo-quota removal.

Recovery **did** stop writing `specialist_registry_default`. That is the one closed path. `ROUTING_BASES` still names it, and path 4 still assigns the same meaning at project time for missing entries.

`counts.classifiedArticles` is set to `admittedArticles` (snapshot builder 184). Receipts can say “classified” when the row is legacy. `modelClassifiedArticles` counts only `current_model`, so reusable `prior_exact_hash` is undercounted.

## Shortlist ordering

`selectSelectionShadowShortlist` (`tools/prepare-selection-shadow.mjs` 186–253):

- Eligible = withheld (`categories.length === 0`) news/community, enabled, not specialist, not gnews/deal, inside the time window.
- Sort = `selectionShadowRank`: `hotScorePrev` → `score` → comments → views → recency. Not Korean-impact, not missing-lane relevance, not `selection-axes` importance.
- Then **round-robin by source**, not “top missing-category candidates”.
- `missingCategoryIds` is copied to the return object and **never used to filter or rank**.
- `purpose` is hard-coded `ambiguous_source_shortlist_not_quality_proof`.

Locked order in `test/selection-d2d.test.js` 290–292 when missing is `["tech"]`:

`etnews-high`, **`wrong-lane` (business-wire)**, `community`, `bloter`, `etnews-second`.

That is the opposite of a targeted missing-lane shortlist. `tools/build-slot-canonical-edition.mjs` does not import or call this function. The only consumer is `tools/run-selection-shadow-canary.mjs` when `--shortlist` is passed. NH91’s 4-call abort therefore cannot be repaired by this runner on the edition path.

## What the uncommitted diff actually does

Helpful, insufficient:

- `digest.js`: removed the `CATEGORY_DOMESTIC_SHARE_BANDS` **final-lane** fill. `briefing-quality.test.js` now proves high-rank foreign is kept and low-rank foreign filler is not **forced by digest**. That test bypasses the candidate fixture, so it does not prove the engine/slot path.
- `build-slot-canonical-edition.mjs`: `assertForeignMajorLaneCoverage` deleted; coverage is observation-only. Matches “no foreign minimum” at the **assertion** layer only.
- `engine.js` `authorityPoints`: `global_major` bonus now requires `coverage|relatedCoverage > 0` **or** lexicon `findMarketSignalMatches` on news/business/politics/realestate. Explains unpaid replay cutting tech foreign filler 11→2 (tech is **not** in the marketConsequence category list, so unobserved tech majors get 0 bonus). Does not explain, or prevent, the legacy off-topic replacement.
- Recovery: specialist registry default no longer reused. Good. Legacy flag remains.

Harmful relative to the audit bar:

- New router recovery bases `legacy_url_section_recovery` and `legacy_publisher_label_recovery` **keep** legacy rows in print, just under a different label.
- `classify.js` added a belt of title regexes (`GOVERNMENT_LEADERSHIP`, `FINANCIAL_SECTOR_SUBJECT`, `TECH_GAME_FRANCHISE`, `CIVIC_OATH_CONTEXT`, `LABOR_DISPUTE`, `FILM_TV_PRODUCTION`, `/\bapi\b/` listicle, …). `categoryGuardReason` is **not** consulted by digest or slot lead selection; only by NB correction and editorial-draft assessment. This is regex sprawl as a substitute for classified admission, and it does not even sit on the publication filter.
- `promotion.js` added more `LOW_VALUE_PATTERNS` (APOD, media invite, hiring, 운세). Those **do** sit on `promotable()`, so they can drop some junk. They will miss the next title shape. Reject as the quality strategy.
- `deals.js` `/(?:^|\/)hotdeal(?:\/|$|[?#])/` is a narrow URL check used by `promotable` for community deals. Acceptable as a board-path signal, not as classification.
- Candidate-layer geo reserve **expanded** with new tests that require 50/50 KR/US seats. That can inject lower-ranked overseas (or domestic) rows into the 60-cap pool that digest later fills to 14.

Blueprint drift: `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md` NH93 claims “계획 잠금·RED 테스트 작성 시작” while this tree already mutates digest/engine/router. NH90.1 constraint order still lists “뉴스/경제/기술 해외 주요언론 최소선” (item 5), which this same diff deletes at the slot assertion.

## P0

1. **Legacy/source-only rows still publish.** Recovery flag + router URL/publisher rewrite + declared/stale/post-snapshot `item.category` all admit without `current_model`/`prior_exact_hash`. Coordinator fact (2,199 admitted / 242 model) is still the contract this tree implements when the flag is on. After unpaid replay, tech foreign filler 11→2 was replaced by those rows. Files: `tools/build-category-routing-snapshot.mjs`, `src/feed/category-routing.js`, `src/feed/communities.json`, `test/category-routing.test.js`.

2. **No classified-coverage preflight; 13-floor fills with whatever was admitted.** `buildSlotCanonicalEditionCandidate` never measures per-category model/prior coverage. `buildDigest` `fillCategoryGroup(..., true)` and `assertSlotCanonicalEdition` only count seats. A lane of 13 off-topic legacy items activates. Files: `tools/build-slot-canonical-edition.mjs`, `src/feed/digest.js`, `src/feed/slot-canonical-edition.js`.

3. **Shortlist is not on the build path and is ordered wrong for missing lanes.** Source round-robin of unclassified general news; `missingCategoryIds` unused; locked `wrong-lane` inclusion; purpose not quality proof. Files: `tools/prepare-selection-shadow.mjs`, `tools/run-selection-shadow-canary.mjs`, `test/selection-d2d.test.js`, `test/selection-d2e.test.js`. Absent from `tools/build-slot-canonical-edition.mjs`.

4. **Candidate geo reserve still assigns seats by country on the engine path.** Personalized briefing still passes `CATEGORY_DOMESTIC_SHARE_BANDS` into `buildEditionCandidateFixture`, which reserves KR/US depth and can displace higher-ranked items from the 60-cap window. Tests lock the reserve. Files: `src/feed/edition-candidates.js`, `src/feed/engine.js`, `test/local-editorial-edition.test.js`.

## P1

1. **Regex sprawl as admission substitute.** New `classify.js` guards and `promotion.js` patterns treat last-seen off-topic titles. Guards are not on lane selection. Next unseen title still fills. Files: `src/feed/classify.js`, `src/feed/promotion.js`, `test/editorial-quality.test.js`, `test/promotion.test.js`, `test/classify.test.js`.

2. **Korean-impact ranking is a `global_major` bonus gate, not a ranker.** Lexicon match on title (`China`, `Japan`, `rate`, `oil`, FAANG, …) plus coverage. Tech is excluded from `marketConsequence`, so important tech world news without coverage gets 0 authority. False positives (`rate` in unrelated titles) remain possible. Files: `src/feed/selection-axes.js`, `src/feed/engine.js`, `src/feed/shadow-selection.js`.

3. **Morning `overseasBias=1.6` still tilts briefing** using language/`translated`, independent of the removed digest geo fill. Files: `src/feed/digest.js`, `src/feed/engine.js`, `test/briefing-quality.test.js`.

4. **Receipt mislabel.** `classifiedArticles := admittedArticles`. `modelClassifiedArticles` omits `prior_exact_hash`. Publication gates cannot trust `counts.classifiedArticles`. File: `tools/build-category-routing-snapshot.mjs`.

5. **Docs disagree with code.** NH93 “RED 시작” vs already-mutated runtime; NH90.1 still encodes a foreign-major floor this diff removes. Files: `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md`, `docs/NOWHOT_DEVELOPMENT_STATUS.md`.

## P2

1. `ROUTING_BASES` still includes `specialist_registry_default` after recovery stopped emitting it.
2. `LEGACY_SECTION_CATEGORIES` maps `world`→`news`, `movie`→`culture` from URL tokens; brittle and category-inventing.
3. `isDeal` hotdeal URL check is a board-path heuristic (narrower than title regex sprawl; keep only if community-deal promotion remains the owner).
4. Selection baseline lock SHA churn in `test/fixtures/selection-baseline.lock.json` is a side effect, not proof of classified coverage.

## Tests that lock the wrong contract

Must not be treated as product proof:

- `test/category-routing.test.js` — `allowLegacyFallback: true` admits humor/politics from empty predictions; URL/publisher recovery tests require those rows to remain in the projected set.
- `test/local-editorial-edition.test.js` — 14/14, 7/7, 7/6 KR/US candidate reserves.
- `test/selection-d2d.test.js` — shortlist includes `wrong-lane` for missing `tech`.
- `test/briefing-quality.test.js` — digest-only geo test; does not exercise candidate reserve or routing basis.
- `test/slot-canonical-edition.test.js` — foreign-major selected=0 does not fail; still no classified-basis assertion on leads.

Missing RED tests (required before GO):

- Selected lead `categoryRoutingBasis` ∈ {`legacy_classifier_fallback`, `legacy_url_section_recovery`, `legacy_publisher_label_recovery`, `declared_specialist_section`, `post_snapshot_declared_category`, `snapshot_stale_declared_category`, `specialist_registry_default`} ⇒ candidate fail, pointer bytes unchanged.
- Preflight: per category, count of `current_model` ∪ `prior_exact_hash` admitted events. If any category < 13, do not call `buildTodayEditionInProcess`; run targeted shortlist then HOLD.
- Shortlist order = high-rank withheld candidates **for the missing category**, deterministic, no unrelated-lane source padding. `wrong-lane` must not appear when missing is `tech`.
- Floor fill must not promote a lower-rank off-topic admitted row to reach 13; HOLD instead.
- Candidate geo reserve must not be able to place a lower-rank overseas item into the digest pool when higher-rank domestic (or vice versa) was displaced, **or** the reserve must be observation-only and not passed from `engine.briefing`.

## Exact files in the uncommitted tree (touched; not approved)

`src/feed/category-routing.js`, `src/feed/classify.js`, `src/feed/communities.json`, `src/feed/deals.js`, `src/feed/digest.js`, `src/feed/edition-candidates.js`, `src/feed/editorial-quality.js`, `src/feed/engine.js`, `src/feed/promotion.js`, `src/feed/selection-axes.js`, `src/feed/shadow-selection.js`, `tools/build-category-routing-snapshot.mjs`, `tools/build-slot-canonical-edition.mjs`, `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md`, `docs/NOWHOT_DEVELOPMENT_STATUS.md`, `test/briefing-quality.test.js`, `test/category-routing.test.js`, `test/classify.test.js`, `test/deals.test.js`, `test/editorial-quality.test.js`, `test/fixtures/selection-baseline.lock.json`, `test/local-editorial-edition.test.js`, `test/promotion.test.js`, `test/slot-canonical-edition.test.js`.

Related, unchanged, still blocking: `src/feed/slot-canonical-edition.js` (count-only 13), `tools/prepare-selection-shadow.mjs`, `tools/run-selection-shadow-canary.mjs`, `test/selection-d2d.test.js`, `test/selection-d2e.test.js`.

## Required next action (not this worker)

Keep the current pointer. Do not `--activate`. Close P0 in this order, without new title regexes:

1. Publication admit set = `current_model` ∪ `prior_exact_hash` only. Strip or withhold every other basis, including URL/publisher “recovery”.
2. Preflight per-category classified coverage; if < 13, call a **reordered** shortlist (missing-lane rank, not source round-robin) then HOLD if still short.
3. Remove candidate-layer KR/US reserve from the engine/slot path, or prove it cannot change the final 14.
4. Then re-run unpaid replay and show: news not stuck at 8 **because of new model rows**, tech foreign filler not replaced by legacy off-topic, unions exact, event/details immutable.

## Limits of this review

No live plate replay, no `npm test`, no API. Verdict is from the uncommitted diff plus the named call graph. Coordinator’s 2,199/242/8 and 11→2-then-legacy-gap numbers were not re-measured here; the code still permits that outcome.
