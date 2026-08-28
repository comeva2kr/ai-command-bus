# NH90 independent adversarial review (architecture / data-flow / product)

- Date: 2026-08-27 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6, read-only, no Claude-output inspection
- Scope: `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md` NH90 vs NH89 vs current NowHot code
- Plan: `docs/plans/2026-08-27-nowhot-nh90-prepublish-root-fix.md`
- Ledger: `.superpowers/sdd/nowhot-nh90-prepublish-root-fix/ledger.md` (R1–R5 still open)
- Code touched by reading only: `engine.js`, `digest.js`, `server.js`, `slot-canonical-edition.js`, `category-routing.js`, `event-cluster.js`, `shadow-selection.js`, `selection-axes.js`, `editorial-fulfillment.js`, `edition-candidates.js`, `editorial-inventory.js`, `tools/build-slot-canonical-edition.mjs`, `tools/build-editions.mjs`, `public/today.html`
- Changes: none. No edits to product code, no paid APIs, no deploy, no commit.

## Verdict

**HOLD. Do not implement NH90 as written.**

NH90’s product intent (one prepublish pipeline, GET = filter) is right. The locked plan and blueprint section do not specify a total order among new balance rules, keep two incompatible allocator shapes, and if coded against current modules will regress NH89 exact-union, foreign-major, and calendar identity.

Reproducible **P0: 5** (P0-1, P0-3, P0-5, P0-7, P0-8). **P1: 14**. **P2: 6**. Shared-root fixes below; do not patch symptoms per lane.

## What is already sound (do not reopen)

- NH89 slot artifact shape: one JSON + pointer, 14 lanes, 13–14 depth, exact dedup union, frozen `title/image/sourceLinks/detail/selectedByCategories`.
- Pointer GET `requestWork=filter_only` when `NOWHOT_SLOT_CANONICAL_EDITION=1`.
- Prepared detail statuses `{ready, excerpt_only, source_unavailable}`; pending/error block activation.
- Whole-edition success or keep previous complete edition (no per-lane carry-forward in the NH89 contract).
- Direct publisher preferred over Google News wrappers; foreign-major **floor after selection** for news/business/tech.
- Plan R4 “no paid calls unless separately bounded” and live-unchanged.

## Attack 1 — data-flow ordering

Blueprint NH90 order: collect → unwrap Google → type (news/community/deal) → cluster **full pool** → semantic multi-label admit → one importance → one allocator → details for selected → three files → GET filter.

Current serving order in `engine.js` `_sharedBriefingContext` / `briefing`:

1. `_itemsAsOf(asOfMs)` drops `firstSeenAt|publishedAt > asOfMs`.
2. `editorialCategoryRouter` **drops withheld** (`categories.length === 0` → `[]`).
3. Slot `inBriefingWindow` (and optional 24h carryover).
4. Category filter for the requested lane.
5. `digest.clusterIssues` (exact title/URL) then near-dup then `event-cluster` merge.
6. `buildDigest` scores and caps by `sourceLabel`.
7. Details are a later pipeline, not part of rank.

NH89 order is different again: unwrap → **translate + readability** → news/community rank → cluster → details for finalists → v2 snapshot for 14 lanes.

Three contracts, three orders. Round 1 RED tests cover asOf truncation and withheld-as-evidence, not unwrap-before-cluster, title-translate-before-allocate, or “do not run digest.clusterIssues on a per-lane subset.”

### P0-1 · Korean-readability gate vs details-after-allocate

**Counterexample.** BBC World item, English title, `editorialAuthority=global_major`, in the lunch pool.

- Current: `buildTodayEditionInProcess` wraps sources in `TranslatingSource` (translate ON unless `FEED_TRANSLATE=0`). Personalized digest sets `requireKoreanAudience: true`. `koreanAudienceReadable` is Hangul-or-≤3-English-words on the **title**.
- NH90 step 8 prepares Korean title/summary **after** allocation, selected events only.

Path A — keep the current gate: the BBC title never ranks, news foreign-major floor `min(3, eligible)` fails, NH89 `FOREIGN_MAJOR_FLOORS_PASS` regresses.

Path B — remove the gate to wait for step 8: the English card consumes one of 14 slots; if fetch/translate/summary fails it ships as `excerpt_only` / `source_unavailable` with an English headline to Korean readers.

**Smallest correction.** Before rank/allocate: unwrap Google, title-only translate, readability gate. After allocate: 600–1200 body summary only for selected. Do not use full article LLM as a ranking prerequisite.

### P1-0 · Withheld-as-evidence lead can be a Google wrapper

Plan R1 RED: withheld articles may support an event but must not be the lead card. Current `createCategoryRouter` never lets withheld into `sourceItems`, so clustering never sees them.

**Counterexample after implementing R1 as written.** KBS direct URL withheld (empty categories). Same story via `gnews-news` admitted as `news`. Full-pool cluster merges them. Lead = best **admitted** member = Google wrapper. Displayed `sourceLinks[0]` becomes Google News. NH89: “직접 원문이 확보된 사건은 Google News 중계가 대표 출처나 대표 사진이 될 수 없다.”

**Smallest correction.** Lead eligibility = admitted ∧ resolved-direct ∧ non-adult. Withheld/direct rows may appear on the frozen source list and in evidence, never as lead. If no eligible lead exists, the event is not a card (evidence-only). Add this as a Round 1 RED next to the withheld-lead test.

### P1-1 · Google unwrap is not a Round 1 RED

`event-cluster.js` documents that Google News redirect canonical URLs are null, so URL-merge only works for direct RSS. NH90 step 2 unwraps before cluster, but plan GREEN is only “cluster the full eligible pool once.”

**Counterexample.** BBC RSS `https://www.bbc.co.uk/news/...` and `news.google.com/rss/articles/...` of the same story. Cluster-before-unwrap → two events, two cards, operator rotation double-counts BBC, foreign-major floor over-counts.

**Smallest correction.** RED: identical publisher URL after unwrap must be one event before type/admit. Owner: `enrich.js` publisher decode + `canonical-url.js`, then one `buildEventClusters` call.

### P1-2 · Two clusterers; NH90 says one

Serving still ranks `digest.clusterIssues` (exact title/URL) on the **lane-filtered** pool, then `mergeGroupsByEventDecision` using `canonicalEvents` from a **post-router** full pool (`engine.js` ~3220–3244, `digest.js` `clusterIssues` / `mergeGroupsByEventDecision`).

**Counterexample.** Yonhap “삼성 실적” and MK “삼성전자 영업이익” fail exact `eventKey` match, survive as two digest issues in business, then event-cluster would have merged them. Switching NH90 to event-cluster-only changes which 14 freeze, so NH89-style exact union still holds **inside** a new artifact but the “reuse current clustering” assumption is false.

**Smallest correction.** One cluster owner: `buildEventClusters` on the unwrapped full eligible pool (adult stripped). Delete per-lane `clusterIssues` from the prepublish path. Lock with a same-pool event-id stability test. Do not call `rank.js` (personalized feed, not editions).

### P1-3 · `asOf=savedAt` still truncated by slot windows

Plan RED: do not cut a later-collected lunch pool with a synthetic noon `asOf`. GREEN: use pool `savedAt`. Current `inBriefingWindow` still applies `slotDef.windowHours` against `now` (`lunch` = 6h, `evening` = 7h, `morning` = 12h, foreign-major 24h).

**Counterexample.** Lunch pool collected 16:40 KST, `savedAt=16:40`. Window 6h keeps items since 10:40. 08:10 Yonhap that is in the file is dropped. Three slots still collide with `_itemsAsOf(publishHour)` if implementers only change `asOf` and reuse `briefing()`.

**Smallest correction.** Isolated slot pool is the membership authority. Do not re-window with `SLOTS.windowHours` on that file. Record `collectedAt=pool.savedAt` separately from `slotAsOf=publishHour`. Keep `inBriefingWindow` only for the legacy non-pointer path.

## Attack 2 — ranking / allocator ownership

NH90: one importance score; one allocator owns 13–14, operator rotation, geo bands, foreign-major reserve, override receipts. Plan R2: reuse `selection-axes` / event clusters / shadow **materials**, not shadow 8–12 volume.

Current owners (all live):

| Owner | What it actually decides |
|---|---|
| `todayEdition` | 14 independent `briefing()` calls, then `mergeCategoryEditions` |
| `digest.buildDigest` | engagement log + coverage + interest + weighty + `maxPerSource` on **sourceLabel** |
| `shadow-selection.js` | pack-specific S, volume 8–12 (max 14 at 95%), not serving |
| `rank.js` | personalized feed `selectDiverse`, not Today |
| `foreignMajorLaneCoverage` | post-hoc floor, not a reserve during pick |
| `allowCarryover: true` | `server.js` `buildLocalTodayEdition` when pointer is off |

That is five rankers and no allocator module.

### P0-3 · A joint allocator breaks NH89 exact union

Exact union means: multi-select cards = dedup of the **independent** 14-lane lists. A single allocator that rotates operators **across** lanes has cross-lane side effects.

**Counterexample.** Yonhap is news #3 and business #14. Global “each operator once, then second seats”: news takes Yonhap first; business #14 becomes a different event. `news+business` union ≠ `news` ∪ `business`. NH89 `EXACT_UNION` fails.

**Smallest correction.** Allocator shape is **lane-local then freeze**:

1. Score each event once (type-aware formula, stored on the event).
2. For each of 14 lanes, pick 13–14 from events admitted to that lane, applying per-lane constraints only.
3. Freeze `lanes[category]` and `selectedByCategories`.
4. Union = concatenation of frozen lanes with first-seen display order.

Forbid global knapsack, global operator caps, and “swap this business card because news already used Yonhap.” Multi-lane membership of one event is allowed; changing another lane’s membership is not.

### P1-12 · Reusing `buildTodayEditionInProcess` reintroduces carry-forward

NH89: no per-category carry-forward; whole edition succeeds or previous complete edition remains. NH90 plan: keep that rollback.

Current builder used by `buildSlotCanonicalEditionCandidate`:

- `createServer({ localEditorial: true })` without pointer mode.
- GET `/api/today` → `buildLocalTodayEdition` → `todayEdition({ allowCarryover: true })`.
- `EDITION_CANDIDATE_CONTRACT.carryoverMaxHours = 24`.

**Counterexample.** Tech lane has 11 in-window events. Carryover pulls 3 overnight HN posts into lunch so the lane hits 14. Lunch is no longer the lunch pool. Pointer activation would freeze that mix.

**Smallest correction.** Prepublish must not call the on-demand GET builder. New function: pool file → unwrap → cluster → admit → score → lane-local allocate → details → validate → atomic pointer. `allowCarryover` hard-false. Short lane → fail candidate, keep previous complete edition.

### P1-4 · “One importance” and “type-aware rank” are not the same function

Blueprint: importance computed once; news vs community vs deal use different signals. Plan R2: “Calculate news/community/deal rank once per event.” Shadow already has pack weights (newsy 0.2/0.5/0.3 vs community 0.6/0.1/0.3) plus an overseas subtable. Deals are **excluded** from shadow (`deal_price_or_mall_format`), not ranked.

If one scalar S is used for all types, community heat dominates news (the 2026-08-05 digest failure mode). If three scalars exist, the allocator must own mixing; the plan does not say how a deal score competes for a humor/life slot, or whether deals appear in the 14-lane artifact at all.

**Smallest correction.** Persist three type scores plus one allocator key `S_lane` derived from the event’s type **for that lane**. News lanes never consult deal scores. Community-lead-allowed lanes may consult community scores but news-priority lanes (`news`, `politics`, `business`, `realestate`, `science`) consult news scores only. Deals stay out of the 14-lane edition unless a later NH defines a deal region. Do not import `rank.js`.

### P1-5 · Source rotation is still `sourceLabel`, not operator

`digest.js` `addBalanced` caps `members[0].sourceLabel`. `mk-news` and `mk-stock` are two labels, one `ownershipGroup=maekyung` (`editorial-source-identity.js`). NH90 “한 번씩 사용한 뒤 두 번째 자리” and “넓은 분야 최소 4 운영주체” will not hold if the new allocator copies `maxPerSource`.

**Smallest correction.** Cap and rotate on `operationalSourceIdentity().ownershipGroup`. Count distinct groups for the min-4 receipt. `sourceLabel` is display only.

## Attack 3 — source and domestic/foreign balance

NH89 hard floor (post-selection): news `min(3, eligible)`, business `min(3)`, tech `min(2)`, among selected events that carry a `global_major` member.

NH90 adds: domestic soft bands news 50–70%, business 50–60%, politics 80–90%, tech 50–70%; foreign-major **reserve**; `importance_override` receipts; “not a rigid delete filter”; “do not fill with unrelated copy.”

Current code already has **three different geo predicates**:

- `isOverseas(item)` — language / `translated` flag (`digest.js`). Morning `overseasBias=1.6` uses this.
- `membersAllOverseas` / `overseasOnly` — registry `country !== "KR"` for **every** member.
- `isAuthoritativeForeignNewsSource` — `kind=news` ∧ `country≠KR` ∧ `editorialAuthority=global_major`, 24h window.

Domestic band unit is unspecified (events vs leads vs operators vs sources).

### P0-5 · Unranked constraints cannot be jointly satisfied

**Counterexample (tech, 14 slots).** Eligible set = 14 foreign specialist items (BBC Technology, TechCrunch, The Verge, Engadget, Ars Technica — the NH89 tech floor pattern) + 2 weak domestic blogs.

- Foreign-major floor: `min(2, eligible majors)` → need ≥2 foreign majors selected (NH89 would take many more).
- Domestic band 50–70%: need 7–10 domestic.
- No-filler: the 2 blogs are not core tech by admission policy.
- Min 13: cannot reach 13 **and** 50% domestic without filler.
- Override: keep the 14 foreign → band fails.

Any implementation that treats band, floor, min-13, and no-filler as equal gates will either never activate (LIVE HOLD forever) or violate NH89 floors / fill junk.

**Smallest correction — publish this total order in NH90 before code:**

1. Admission / no-filler (never invent cards).
2. If any lane < 13 after (1): **fail candidate**, keep previous complete edition.
3. NH89 foreign-major **floor** on selected events (not article-id reserve).
4. Operator rotation: first full unique pass, then second seats; min-4 when `distinctEligibleOperators ≥ 4`, else receipt `operator_shortfall`.
5. Domestic band = **score tilt + audit**, never a fill quota. Miss band → `geo_band_miss` receipt, still publish if (1)–(3) hold.
6. `importance_override` only to **keep** a higher-S foreign event that a tilt would drop, never to insert a low-S domestic filler. Cap overrides at 2 per lane.

Foreign-major mechanism must stay a **post-selection floor** on events, matching `foreignMajorLaneCoverage`. A pre-allocation article reserve can pick a BBC URL that then loses the lead to a domestic blog in the same cluster and disappear from `selected[]`.

### P1-6 · Same event is domestic and foreign depending on the predicate

**Counterexample.** Fed decision: BBC + Yonhap in one cluster.

- `overseasOnly` = false (Yonhap is KR).
- Lead if BBC → language `isOverseas` true after translate (`translated=true`).
- `global_major` member present → counts toward foreign-major floor.
- Domestic band if counted by “any KR member” → domestic.

One card increments both “domestic share” and “foreign-major selected.” Bands become uninterpretable.

**Smallest correction.** Geo unit = **lead card’s registry country**. `KR` = domestic. Foreign-major floor = selected events whose **members** include ≥1 `global_major` (keep NH89). Report both. Do not use `isOverseas` language for bands. Remove morning `overseasBias` from the NH90 path so tilt is not applied twice.

### P1-7 · Specialist prior vs admission `sourceAndFormat`

NH90: specialist feed category is a strong prior; general 종합뉴스 may enter tech/auto/science by meaning.

`category-admission-policy.json`: `sourceAndFormat = never_sufficient_alone` (“A source section, publisher identity… never grants admission by itself”).

`category-routing.js`: `declared_section` specialist news **does** admit from registry category without a model entry.

**Counterexample.** TechCrunch political interview in the Tech section. Specialist prior → tech lane. Core test → politics/news, not tech. NH90 and the admission policy disagree; current router takes the specialist path.

**Smallest correction.** Prior may order the classifier, not skip it. `declared_section` is a fallback only when the snapshot has no row. Semantic admission remains the owner. General news may be multi-admitted when each category independently passes `coreTest`.

## Attack 4 — three-slot / calendar feasibility

NH89 truth already: `AUTOMATED_THREE_SLOT_DELIVERY_NOT_PROVEN`. NH90 R3: real morning/lunch/evening files, atomic pointer, last-complete rollback, then native date input for **stored** dates only.

### P1-13 · Pointer serving disables the slot scheduler

```1296:1298:src/feed/server.js
  const LOCAL_INVENTORY_SCHEDULE_ENABLED = localEditorial && !slotCanonicalEditionEnabled &&
    !process.env.NODE_TEST_CONTEXT && opts.localEditorialInventorySchedule !== false;
```

Enabling NH89/NH90 GET `filter_only` sets `slotCanonicalEditionEnabled` and **turns off** inventory generation. R3 cannot prove three files on the path that R3 also uses to serve them.

**Smallest correction.** Split flags: reader pointer ON must not disable a **separate** prepublish worker. Scheduler writes candidate files; pointer swap is the only activation; GET never generates.

### P0-7 · `editionDate` from collection-end asOf after midnight

`todayEdition` sets `editionDate` from `asOfMs` KST (`engine.js` ~3401–3409). Pointer key is `editionDate:slotId`. Evening `fromHour=17` wraps to 05:00 next calendar day.

**Counterexample.** 27 Aug evening collected at 01:10 KST 28 Aug. Plan GREEN `asOf = pool.savedAt` → `editionDate=2026-08-28`, file `edition-2026-08-28-evening-…`, pointer `2026-08-28:evening`. Date picker for 27 Aug evening misses it; 28 Aug evening shows yesterday’s night news.

**Smallest correction.** Calendar identity = slot civil date + slot id, from `slotAsOfMs(date, slot.publishHour)`. `collectedAt` / `asOf` is a payload field, never the pointer key. Evening of date D remains D even if collection ends after midnight.

### P1-8 · Date UI on current pointer = silent wrong edition

`makeSlotCanonicalEditionReader` if `date:slot` is missing, falls back to the latest earlier `date:slot` and sets `serving.fallback=true`. `today.html` already copies `requestedDate` from that payload.

NH90: “없는 판을 즉석 생성하지 않는다.” It does not say “do not silently show another day.”

**Counterexample.** User picks 26 Aug lunch. Only 27 Aug lunch exists. Reader returns 27 Aug lunch with fallback. Native date input looks like it worked.

**Smallest correction.** Exact key only. Missing → 409 `SLOT_CANONICAL_EDITION_UNAVAILABLE`. Date control lists stored keys from the pointer; do not ship the input in the same round as the first successful 3-slot write. Rollback = keep serving the last **complete** pointer target, labeled as such, not as the requested missing date.

## Attack 5 — regression boundaries

### P0-8 · `전체 필수` 2–4 vs 14-lane exact union

NH90: must-know 2–4 is a separate region and must not double-count toward 13–14. NH89 validator: every `issueTable` id is in ≥1 of 14 lanes; every lane id is in `issueTable`; displayOrder = union.

**Counterexample A.** Extra ids in `issueTable` not in any lane → `unreferenced issue`. **B.** 15th lane → 14-lane contract fail. **C.** Must-know already in `news` but excluded from the 14-count → news lane shows 12+2 overlay, union math and UI counts diverge. **D.** Must-know outside selected categories, injected into the personal 13–14 → NH89 “미선택 분야 노출 0.”

**Smallest correction.** Defer `globalMustKnow` out of NH90. If overlay is required later, `mustKnowIds` ⊆ frozen union and already in some lane; UI region is display-only, no extra cards, no 15th lane.

### P1-9 · 600–1200 summary vs R4 no paid calls vs NH89 GO

NH89 GO candidate: 129 `excerpt_only` + 62 `source_unavailable`, 0 `ready`. NH90 requires 600–1200 character Korean summaries. Plan R4: newest pool build without paid calls unless bounded. Completion text still lists “요약 상태.”

Implementers will either call paid models (forbidden in this dispatch, unbounded in the plan) or never reach GO.

**Smallest correction.** NH90 GO accepts NH89 detail statuses. `ready` 600–1200 is a cost-bounded stretch goal with an explicit cap, not a gate. Excerpt/unavailable remain publishable.

### P1-10 · v2 snapshot freshness omitted from NH90

NH89: expired / mixed v1 drops the **candidate**, no silent fallback. `createCategoryRouter` still has stale v1 category fallback on expiry (`staleFallback`).

**Smallest correction.** Keep NH89: stale or mixed v1 → candidate invalid, pointer unchanged. Add to Round 1.

### P1-11 · Adult rows if clustering the full pool

Router currently drops `adultGateRequired` / `adult` / unsafe leads before clustering. NH90 full-pool cluster runs earlier.

**Counterexample.** Adult gallery post token-overlaps a celebrity news event → appears in `sourceLinks` on a culture card.

**Smallest correction.** Strip adult/unsafe before cluster, or allow as non-displayed evidence never copied into `sourceLinks` / images / titles. Plan already says keep adult gating; name the stage.

### P2 (do not block Round 1, still fix in the contract)

- Blueprint header still says NH89 “구현 진행 중” / `DEVCHG-…-174` while NH90 claims plan lock and implementation started.
- Plan file is thinner than the blueprint: no constraint order, no geo unit, no allocator shape, no editionDate vs collectedAt.
- Morning `overseasBias=1.6` plus new bands is double geo policy.
- `digest` `maxPerSource=3` (personalized) vs “once around then second seat.”
- First-published “source-country time and KST” has no field names; add `firstPublishedAt` + `firstPublishedAtKst` on `issueTable` in R3, not GET.
- Shadow `volume.min=8` must stay unwired; a copy-paste of `SHADOW_PACK_PARAMS.volume` into the allocator reopens 8–12 lanes and breaks NH89 min 13.

## Round 1 tests the plan is missing (smallest RED set)

1. Lunch pool `savedAt` 16:40 must keep 12:30 KR items; `asOf` must not be publishHour 12:00.
2. Unwrap before cluster: gnews URL + direct URL = one event.
3. Title-translate + readability before allocate; body LLM after.
4. Withheld/direct cannot be omitted from sources; Google wrapper cannot be lead if a direct member exists; withheld cannot be lead.
5. Lane-local allocate: mutating news must not change `lanes.business`.
6. Tech 14-foreign + 2-weak-domestic: activate only if min 13 + foreign floor hold; band miss is a receipt, not a filler.
7. Evening collect after midnight: pointer key stays evening of civil date D.
8. Carryover off; stale v2 snapshot fails candidate.
9. Missing date:slot → 409, not fallback.
10. `mustKnow` absent from this artifact.

## What is left

Implementation of NH90 has not started (ledger R1 open). NH89 local candidate `SCE-f9e8287a73921a1a` should stay active until a rebuilt candidate passes the ordered gates above. Do not wire bands, date input, or `전체 필수` in the first patch. First patch: R1 ordering tests + allocator shape + constraint total order in the blueprint, then code.
