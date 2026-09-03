# NH94 candidate counter-review: specialist + RSS category as trusted routing bases

- Date: 2026-09-01 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6, Orca dispatched worker `task_b25570ad1ab7`
- Scope: current working tree vs Blueprint NH92–NH93.2, ingest benchmark 2026-08-31, NH94 source audit, category-routing / category-policy / classify / parseRss / shadow packet / routing snapshot / canonical edition
- Constraint honored: **read-only**. No product edits, tests, paid calls, activation, commit, deploy, or pointer changes. This file is the review artifact only.
- Candidate under review: reuse source-tier policy and deterministic classification; specialist source/section metadata plus standard RSS/Atom category become trusted routing bases; generalist/aggregate/mixed stays withheld unless exact-prior/model or a future high-ranked LLM shortlist; delete publication-time URL/publisher recovery; keep one identity-bound snapshot, 13–14 per lane before activation, event/source/detail invariant, request-path zero LLM, last-good rollback, no foreign quota.

## Verdict

**TWEAK.** Product remains **HOLD**. P0: 4. P1: 6.

Do not implement the candidate as stated. Do not parse RSS/Atom category into the publication admit set. Do not expand `assertSemanticPublicationRouting` to specialist registry / declared section / RSS. Do not activate, commit, or deploy.

The thesis that mixed/aggregate must withhold, that URL/publisher recovery is a second classifier, and that NH93.2 gates (identity-bound snapshot, 13–14 semantic lanes, request LLM 0, last-good, no foreign quota) must stay is correct. The unsafe part is treating **registry specialty and feed `<category>` as publication truth**. That reopens the NH93.1 source-default hole, collides with homepage RSS already tagged `specialist`, and still cannot fill **humor** to 13 without a paid shortlist this unpaid round.

WRC: this is not GO. Limitations are not flattened into GO.

---

## What the bytes actually do (claim vs evidence)

| Candidate claim | Current bytes |
|---|---|
| Specialist + RSS category are trusted routing bases | **Not implemented.** Publication allowlist is `current_model` ∪ `prior_exact_hash` ∪ empty `withheld` (`tools/build-slot-canonical-edition.mjs` `assertSemanticPublicationRouting`). Recovery no longer emits `specialist_registry_default`. `parseRss` still does not read `<category>`, Atom category, or `dc:subject`. |
| Delete publication-time URL/publisher recovery | **Code still live** in `src/feed/category-routing.js` `project()` (`legacySectionCategory`, `trustedLegacyPublisher`). Slot canonical path already **rejects** `legacy_classifier_fallback` before `project()`, so those rewrites cannot fire on an identity-bound candidate plate. Tests still **lock** the rewrites (`test/category-routing.test.js` URL `world`→news / `movie`→culture; gnews publisher `인벤`→gaming). |
| Mixed/aggregate withheld unless model/prior/shortlist | **Snapshot builder:** yes, unless `--allow-legacy-fallback`. **Router project():** no. Missing entries still get `declared_specialist_section`, stale `item.category`, or `post_snapshot_declared_category`. Engine `_classifyItems` still writes NB/policy categories onto every item **before** the router. Default live mode is **v1** (`NOWHOT_CATEGORY_ROUTING` default), so GET never uses the snapshot at all. |
| One full identity-bound routing snapshot | **Slot path yes** (`assertSamePoolInputs`: pool IDs = packet `sourceArticleIds` = routing `itemId`). Live v2 can still project items that are not in the snapshot. |
| 13–14 per lane before activation | **Count of admitted events**, not “publisher-true” events. `assertSemanticLaneCoverage` uses union issue counts. `buildDigest` `fillCategoryGroup(..., () => true, floor, true)` still walks any admitted member with `ignoreSourceCap`. |
| Event/source/detail invariant under category choice | **Mostly encoded** (`mergeCategoryEditions` / `selectedByCategories` / `eventSourceSetId`). Category choice must not rebuild sources. A specialist admit that splits two members of one event into tech vs business does not mutate sources; it can still **double-list** the same event across lanes. |
| Request-path zero LLM | **True** for category. LLM classify is offline snapshot only. Article summary / editorial LLM remain default off. |
| Last-good rollback | Reload failure keeps previous router. Stale state still **admits** `item.category` / `admittedCategories` (`snapshot_stale_declared_category`). That bypasses withhold. |
| No foreign quota | Digest final-lane geo fill is gone. Engine briefing **no longer passes** `domesticShareBands` (`test/briefing-quality.test.js` asserts the call site). `edition-candidates.js` still implements KR/US reserve **if** bands are passed; `test/local-editorial-edition.test.js` still locks 7/7. Morning `overseasBias: 1.6` still sorts by language/`translated`. |
| This round zero paid / no activation | Unpaid NH93 replay already **HOLD**ed a 2,199-row pool (news 6, auto 2, science 4, gaming 2, sports 0, culture 7, humor 5, politics 9, realestate 1, fashion 0, art 1). Specialist admit does not call a model; it also does not create a humor section feed that does not exist. |

NH93.1 explicit reject (Blueprint): source default, legacy URL, and publisher label **must not** admit a slot row. NH93.2 only closed empty-legacy resurrection via basis-first fail-closed. This candidate is a **partial revert** of NH93.1 unless the allowlist is rewritten on purpose, with new tests, not as “reuse.”

---

## P0 counterexamples

### P0-1. RSS/Atom `<category>` as a publication basis is a new classifier with no parser and known junk

`src/feed/fetchers.js` `parseRss` reads title, link, description/`content:encoded` (images), pubDate/updated/`dc:date`, slash:comments, media thumbnails, Google related-`<li>`. It does **not** read RSS `<category>`, Atom `category/@term`, or `dc:subject`. The ingest benchmark already named this as the cheap metadata win. Cheap to parse is not the same as safe to **admit**.

Counterexamples if those fields were trusted:

1. **Google News topic RSS is aggregate.** Item-level `<category>` on that family is often the **publisher display name**, not a NowHot lane. Admitting it **rebuilds** `legacy_publisher_label_recovery` under a standards-sounding name — the path the candidate says to delete. `gnews-science` is already the documented circular-label failure (health section trained as science, 65% miss, now `life`).
2. **Multiple categories.** RSS 2.0 and Atom allow many. Unique-token logic (already used for URL segments) withholds when `size !== 1`. NYT World items commonly carry place/person keywords **and** a section. Unique-map yield is low; supply does not move; engineering cost does.
3. **WordPress tags.** `Uncategorized`, campaign tags, IPTC numeric codes, Korean section strings (`사회`, `속보`, `포토`) have no frozen synonym table in-repo. A one-off map will become another regex belt.
4. **Conflict with specialist registry.** The Verge homepage RSS tagged `specialist`/`tech` can emit Policy / Entertainment terms. Registry says tech; RSS says culture/politics. Candidate does not say which wins. If registry wins, RSS is theater. If RSS wins, homepage mixed tags overwrite the section story. If conflict withholds, RSS does not help 13-floor.
5. **Duplicate path.** BOARD_CATEGORY_RULES already classifies from URL at ingest (`ppomppu id=car` → auto, `chosunbiz /sports/baseball/` → sports). RSS category would be a third writer beside engine `_classifyItems` and the snapshot.

**Do not add RSS category to `ROUTING_BASES` this round.** Ingest-only parse + fixture dump is a later unpaid experiment, not a publish gate.

### P0-2. “Specialist” in the registry is not “publisher section”

Enabled specialist sources: **51**. `categoryRouting: "declared_section"`: **14**. Several of those 14 are **site-wide or top-story feeds**, not a single desk:

| id | registry category | feed | Why it is not a section truth |
|---|---|---|---|
| `the-verge` | tech | `https://www.theverge.com/rss/index.xml` | Homepage index. Policy, entertainment, scooters, science sit in the same stream. |
| `techcrunch` | tech | `https://techcrunch.com/feed/` | Main feed, not `/category/apps`. Layoffs, venture, crypto, regulation. |
| `engadget` | tech | `https://www.engadget.com/rss.xml` | Site RSS, not a gadgets-only desk. |
| `nasa` | science | `https://www.nasa.gov/feed/` | Site feed: contracts, education, internships, missions. |
| `marketwatch-top` | business | Dow Jones **Top Stories** | Top stories, not Markets Only. Politics/war hit this feed whenever they move markets. Note in registry claims the sample was all markets; that is a sample, not a contract. |
| `hypebeast` (disabled) | fashion | `https://hypebeast.com/feed` | **Already retired** because drinks/culture events entered fashion and stale pool rows kept winning. `hypebeast-fashion` exists because the specialist default on the **homepage** feed failed in production. |
| `bbc-world` / `guardian-world` / `nyt-world` | news | World desks | Olympics, climate features, culture — all become 뉴스/시사 if the desk is the lane. |
| `yna-society` / `khan-society` / `donga-national` | news | Society desks | Courts, weather, labor, crime. Labor/politics bleed is why specialistCorrection exists. |

`category-policy.js` already encodes the Apple-shaped rule: specialist is a **strong default**, reclassify only on NB margin + ≥2 dictionary hits + guard. Blind `specialist_registry_default` **skips** that correction. Reusing policy honestly means: run `specialistCorrection`, then maybe emit `specialist_section_policy` at **snapshot build time**. It does not mean project-time `declared_specialist_section` for missing IDs.

`ilovepcbang` is `enabled:false` seed metadata so gnews publisher-label recovery can move PC방 titles tech→gaming (NH92 R2). Candidate deletes that recovery. Under withhold-aggregate, those gnews rows stay **withheld**, not gaming. That is fail-closed and acceptable. Do not resurrect publisher matching via RSS category or disabled-registry labels.

### P0-3. Supply: specialist admit cannot satisfy 13–14 on all 14 lanes unpaid

Humor enabled sources: `etoland` (mixed community), `todayhumor` (mixed community), `slrclub` (community, not mixed). **Zero specialist humor feeds.** Culture specialist: `tenasia`, `stereogum` only.

NH93 unpaid replay already HOLD: humor 5, culture 7, sports 0, fashion 0, art 1, news 6. Specialist metadata can thicken fashion/art/science/realestate/auto. It cannot manufacture 13 humor events. Whole-plate HOLD remains (`assertSemanticLaneCoverage` fails any lane < 13).

A future “high-ranked LLM shortlist” is **not on the slot path**. `selectSelectionShadowShortlist` is used by the shadow canary CLI, not `buildSlotCanonicalEditionCandidate`. This round has **zero paid calls**, so the shortlist cannot close humor even if it were wired. Expanding admit so the 13-floor turns green is the NH91 failure mode (2,199 admitted / 242 model).

`fillCategoryGroup(..., true)` will still pump **whatever was admitted** until 13. If homepage specialist feeds are admitted, The Verge policy pieces become tech filler. That is a supply **regression**, not a coverage fix.

### P0-4. Duplicate admit paths survive even if URL/publisher recovery is deleted

Hidden assignment paths still live after the candidate’s stated delete:

1. Engine `_classifyItems` (deals, mixed neutralization, `definiteCategory` title+board URL, specialistCorrection, aggregateReclassification, `classifyTitle`) writes `item.category` for every cached item. Packet `legacyCategory` is this value.
2. `--allow-legacy-fallback` still exists in `buildRecoveredCategoryRoutingSnapshot`.
3. Router `declared_section` when `!entry`.
4. Stale fallback: `admittedCategories` or `item.category`.
5. `post_snapshot_declared_category`.
6. Digest floor fill from any admitted member.
7. v1 live path never consults the snapshot.

On the **slot canonical** path, (3) is dead if identity coverage holds (every pool id has an entry). (4)/(5) are gated by snapshot freshness vs pool `savedAt`. The live v2 and recovered-snapshot paths are not. Deleting URL/publisher rewrite without closing (1)(2)(4)(5) leaves a second classifier in `item.category` that stale/post-snapshot will publish.

`assertSemanticPublicationRouting` currently **rejects** `specialist_registry_default`. Implementing the candidate requires **changing that test**. That is the real contract change. Do not treat inverted tests as proof.

---

## P1

1. **Internal contradiction.** “Reuse source-tier policy” admits community NB and aggregate reclass at ingest. “Only specialist + RSS as trusted routing bases” withholds those outputs. Pick one: policy is ingest-only (NH93, keep) or policy outputs become snapshot bases (new, must be named and tested). Do not do both silently.
2. **Shortlist.** Current `selectSelectionShadowShortlist` now **filters** to missing-lane `shortlistCategory` and excludes `wrong-lane` (`test/selection-d2d.test.js`). It still: purpose `ambiguous_source_shortlist_not_quality_proof`; round-robin by source; ranks withheld mixed items using **untrusted** `legacyCategory` / specialist registry; is **not** called from the slot builder. Wiring it this unpaid round would be a no-op (zero calls) or a paid-path sneak.
3. **Receipt lie remains.** `classifiedArticles := admittedArticles`. `modelClassifiedArticles` omits `prior_exact_hash`. If specialist rows are later admitted, receipts will say “classified.”
4. **Geo leftovers.** Morning `overseasBias` 1.6; candidate geo reserve function still in `edition-candidates.js`; tests still lock 7/7 when bands are passed. Not a foreign **quota** on the engine path anymore; still a rank tilt.
5. **v1 vs v2.** Default GET is v1 NB. A routing-snapshot change does not move live cards until v2 + new pointer. Do not report local code TWEAK as product GO.
6. **Blueprint drift risk.** NH93.1 text still forbids source defaults. Any specialist allowlist must amend NH93.1/NH93.2 in the same change or the docs will again disagree with the gate.

---

## Cost

| Move | Dollar cost | Engineering / quality cost |
|---|---|---|
| Parse RSS category, do not admit | $0 | Parser + fixtures + synonym freeze. Fine as a later unpaid lab. |
| Admit RSS category on specialist | $0 | New classifier; Google/WordPress junk; conflict rules; duplicate of publisher-label recovery on gnews. **Regression.** |
| Admit all 51 specialist registry categories | $0 this round | Fills some thin lanes with homepage mixed; humor still 0; 13-floor still HOLD **or** fake-green. **Regression if activated.** |
| Keep mixed withheld; LLM shortlist later, top-N missing-lane only | Bounded later | Matches ingest benchmark. Not this round. |
| Full-pool LLM (NH91) | Already aborted at 4 calls | Forbidden by candidate and by NH93. |
| Delete URL/publisher `project()` rewrite | $0 | Test inversion only. Slot path already fail-closed. **Lowest risk cleanup.** |

No paid-call cost regression this round if the allowlist is not expanded. The cost regression is **reactivation risk**: a specialist-bloated plate that looks 14/14 and gets a pointer.

---

## Smallest safe change (still unpaid, still no activation)

**One slice only:** delete publication-time URL/publisher recovery and invert the tests that lock it. **Do not** expand the publication allowlist. **Do not** parse RSS into routing. **Do not** wire shortlist. **Do not** activate.

### Do now (minimal files)

1. `src/feed/category-routing.js` — remove `LEGACY_SECTION_CATEGORIES`, `legacySectionCategory`, publisher-label rewrite, and the `legacyCategory ? [legacyCategory] : entry.categories` branch. Snapshot categories stay as stored. Optional same-slice: stop emitting `declared_specialist_section` / stale / post-snapshot categories so project() cannot outrun the snapshot (stricter; matches identity-bound claim).
2. `test/category-routing.test.js` — invert “레거시 복구 판정만 명시적 URL 섹션으로 바로잡고” and “Google 뉴스 레거시 판정은 고유 전문매체 정체성만 복구” to **withhold or keep snapshot category**. `movie` must not become culture; `world` must not become news; gnews+인벤 must not become gaming via publisher label.
3. Keep `tools/build-slot-canonical-edition.mjs` `assertSemanticPublicationRouting` **unchanged** (still rejects specialist/legacy/missing basis). Keep `test/slot-canonical-edition.test.js` “발행판은 모델 판정과 동일 근거 재사용만 승인하고 출처·레거시 자동승인을 거부한다”.
4. Keep `--allow-legacy-fallback` off the slot path. Do not add a specialist recovery branch in `tools/build-category-routing-snapshot.mjs`.

### Do not touch this round

- `src/feed/fetchers.js` `parseRss` (no category admit; parse-only is a later lab)
- `src/feed/category-policy.js`, `src/feed/classify.js` (ingest policy stays)
- `src/feed/communities.json` (no new declared_section sprawl)
- `tools/prepare-selection-shadow.mjs` / slot builder shortlist wiring
- Pointer, commit, deploy, paid classify

### Tests that must stay RED if someone “just adds specialist”

- `test/slot-canonical-edition.test.js` — `specialist_registry_default` still throws
- New (only if a later slice proposes specialist admit, **not** this slice): `the-verge` homepage item with empty predictions is `withheld`, not tech; `hypebeast` homepage feed cannot admit fashion; RSS `<category>Entertainment</category>` on a tech specialist does not admit culture; humor-only specialist-empty snapshot fails `assertSemanticLaneCoverage` and does not write a pointer
- `test/category-routing.test.js` declared_section for `!entry` should fail-closed if identity-bound snapshot is the product rule

### Later unpaid experiment (not GO)

If David wants specialist as a named basis after this cleanup: snapshot **build time** only, after `specialistCorrection`, new basis id `specialist_section_policy`, allowlist feeds whose adapter URL is a **section** path (BBC Technology/Business/Sport, `hypebeast-fashion`, `hankyung-realestate`, `ars-technica` gadgets, CNBC Economy, YNA/Khan/Donga politics), **exclude** homepage/top-story (`the-verge`, `techcrunch`, `engadget`, `nasa`, `marketwatch-top`, retired `hypebeast`). Then unpaid replay. Humor/culture still expected HOLD. RSS category remains ingest telemetry until a frozen unique synonym table exists and disagrees-with-registry ⇒ withhold.

---

## GO / TWEAK / HOLD mapped to the candidate’s parts

| Part | Call |
|---|---|
| Withhold generalist/aggregate/mixed unless model/prior | **GO** (already NH93.2) |
| Delete publication-time URL/publisher recovery | **TWEAK** — yes, as cleanup; already dead on slot path |
| Keep identity snapshot, 13–14, invariant, request LLM 0, last-good, no foreign quota, no paid, no activate | **GO** (already locked) |
| Specialist registry / declared_section as trusted publication basis | **HOLD** |
| RSS/Atom category as trusted publication basis | **HOLD** |
| Future high-ranked LLM shortlist | **HOLD this round** (zero paid; not on slot path) |
| Product pointer / live | **HOLD** |

**Overall: TWEAK** the candidate down to NH93.2 + URL/publisher delete. Everything else is HOLD.

---

## Limits of this review

No `npm test`, no live RSS fetch, no unpaid plate replay, no Keychain. Registry counts from `communities.json` (enabled 107; specialist 51; aggregate 27; community 29; declared_section 14). NH91 2,199/242/8 and NH93 unpaid lane shorts were not re-measured; the code still permits those outcomes under the current allowlist, and specialist admit would change the mix without being proven here.
