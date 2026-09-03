# NH94 Grok final independent adversarial review

- Date: 2026-09-01 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6, Orca dispatched worker `task_c234991f98d0`
- Scope: dirty worktree after NH94 implementation. Read-only except this report.
- Method: read packet/router/snapshot/slot code; independently recount `.nowhot-local/nh94-verification-20260901`; read active pointer; run focused tests (no product writes).
- Focused tests run: `test/selection-d2d.test.js`, `test/category-routing.test.js`, `test/slot-canonical-edition.test.js`, `test/local-editorial-edition.test.js` → **82/82 pass**.

## Verdict

**GO.** P0: 0. P1: 4.

The root fix is in the bytes: already-computed `article.category` is sealed as packet `deterministic_tier_policy` under eligible unanimous votes; general aggregate news / deals / unknown cast no vote and do not veto; the request router only projects snapshot entries and keeps the adult gate; the canonical gate accepts `current_model | prior_exact_hash | deterministic_tier_policy | empty withheld`; model-derived prior is reusable and deterministic is not; frozen replay matches the corrected 2,199 / 1,923 / 275 / 0 arithmetic; candidate `SCE-5ef1ac07d78811ca` is locally complete; **active pointer is unchanged**.

This is code/test/product-candidate GO. It is **not** live activation GO. `activatedFile` is null. Evening pointer remains `SCE-e35dc2831e2ac6f1`. Do not commit, push, deploy, or `--activate` on this review.

Do not flatten the live-HOLD constraint into a live GO.

---

## P0

None.

---

## P1

1. **Docs lag the implementation.** Blueprint NH94 still ends at “계획 잠금·RED 반례 테스트 착수” while the dirty tree already contains the vote builder, projection-only router, canonical allowlist, passing RED tests, and a built candidate. `docs/NOWHOT_DEVELOPMENT_STATUS.md` has no NH94 change row. Code truth is ahead of docs truth.

2. **Receipt dual-count.** Target-level `routingBasis.deterministic_tier_policy` is **1923**. Article-level `counts.classifiedArticles` / `admittedArticles` are **1924** because the single two-article evidence group (`it_1w33re` + `it_c5evhv`, both humor) is one target and two routing rows. Receipt `routingBasisCounts` uses 1923. Do not treat 1924 as a second classifier.

3. **Snapshot validation still names dead bases.** `ROUTING_BASES` includes `specialist_registry_default` and `legacy_classifier_fallback`. `validateCategoryRoutingSnapshot` would accept them; `assertSemanticPublicationRouting` rejects them; the builder no longer emits them; the router would project them unchanged if an old file were loaded. Slot path is fail-closed. Live default remains v1.

4. **Deal no-vote is keyed on `feedGroup === "deal"`**, not `isDeal`. Current five deal sources have both flags, and the frozen 99 deal withholds match. A future `isDeal` source without `feedGroup: "deal"` would vote as community.

---

## Claim vs independently recounted evidence

| Claim | Independent count | Layer |
|---|---|---|
| Pool / routing article IDs | **2199** unique; packet `sourceArticleIds` flattened **2199**; IDs exact-match routing `itemId` | code + artifact |
| Packet targets | **2198** | artifact |
| Deterministic targets | **1923** | artifact |
| Withheld targets | **275** = **99 deals** + **176 aggregate `category=news`** + 0 unknown + 0 other | artifact + registry |
| Eligible-vote conflicts | **0** | artifact |
| Multi-article evidence groups | **1** (`몽골에서 한국인 대우`, bobae, both humor, no veto) | artifact |
| Category target counts | art75 auto86 business255 culture98 fashion71 gaming85 humor384 life**103** news59 politics45 realestate77 science72 sports92 tech421 (sum 1923) | artifact |
| Earlier 2022/176 | Wrong because 99 deal no-votes were counted as life; 202−99=103 | docs (corrected in Blueprint body) |
| Candidate | `SCE-5ef1ac07d78811ca`, SHA `5ef1ac07…4a049`, 195 unique issues, 14 lanes ×14, 1 multi-lane issue, details `source_unavailable 49` / `excerpt_only 146`, pending 0, `llmUsage []`, `summaryBuildMode=free_only`, `activatedFile=null`, `requestPathWork=pointer_read_and_filter_only` | artifact |
| Predictions | 2198 rows, all `failed` → 0 `current_model` | artifact |
| Active evening pointer | `SCE-e35dc2831e2ac6f1` / SHA `e35dc283…da6cf`, `updatedAt` 2026-08-31T06:32:54.255Z, **not in this dirty diff** | live/local pointer |

Pool SHA `5dc64750…7298f8` is shared by packet `sourceSnapshot.sha256` and the candidate receipt. Packet SHA `87d0c891…006fde` is shared by candidate `builderPacketSha256` and embedded routing `source.packetSha256`.

---

## Path attack (required semantics)

### Packet votes — `tools/prepare-selection-shadow.mjs`

`deterministicRoutingVote` reads **post-engine `article.category`**, not registry topic.

- Community + `meta.kind=community` → vote `article.category` (humor leftover is allowed; bobae registry `auto` does not inherit — locked in `test/selection-d2d.test.js`).
- Specialist news with known registry category → vote `article.category`.
- Aggregate with registry category ≠ `news` → vote `article.category`.
- `feedGroup=deal`, aggregate `news`, unknown/non-eligible → `null`.
- Unanimous eligible `Set` size 1 → `deterministicRouting`; size 0 or >1 → omitted (withheld). General sibling adds no vote.

Frozen withheld composition is exactly deals + general aggregate news. That is the product rule, not a leak.

### Precedence and prior reuse — `tools/build-category-routing-snapshot.mjs`

Direct build: classified/cache_hit → `current_model`; else packet deterministic; else empty withheld. CLI `--allow-legacy-fallback` is **gone**.

Recovery: `current_model` → reusable prior only if prior basis ∈ `{current_model, prior_exact_hash}` → else **current packet** deterministic. Test locks: prior `deterministic_tier_policy` is not reused; `allowLegacyFallback: true` in a leftover options object is ignored and recoveryPolicy is `current_model_then_exact_prior_then_current_packet_deterministic`.

Explicit model withhold (empty categories, basis `current_model`) does **not** fall through to deterministic. Router then drops empty categories. Correct.

### Router — `src/feed/category-routing.js`

`project()`: adult/unsafe drop; missing entry or empty categories drop; else copy snapshot `categories[0]` and `routingBasis` (optional `_stale` suffix). No URL tokens, publisher labels, declared_section, item.category stale fallback, or post-snapshot revive. Last-good stale still **projects sealed snapshot entries**, not engine labels. Tests lock URL/publisher/missing-entry/post-snapshot as no-rewrite / drop.

### Canonical gate — `tools/build-slot-canonical-edition.mjs`

`assertSemanticPublicationRouting` allowlist is exactly `current_model`, `prior_exact_hash`, `deterministic_tier_policy`, and empty `withheld`. `undefined` / `specialist_registry_default` / `legacy_classifier_fallback` (including empty-legacy) throw. Identity `assertSamePoolInputs` and 13-lane `assertSemanticLaneCoverage` remain. Candidate met 14/14 with min 13.

### RSS

`parseRss` still does not read `<category>` / Atom category / `dc:subject`. No new mapping system.

---

## Code / test / product / live

| Layer | Truth |
|---|---|
| **Code** | Root fix present on the four owners. No second request-time classifier. |
| **Test** | 82/82 on the named files. Non-negotiable vote / no-veto / projection / allowlist / prior-reuse tests are green. |
| **Product candidate** | `SCE-5ef1ac07d78811ca` is a complete unpaid evening plate in the verification dir. 195 unique issues, 14×14, details prepared, LLM usage empty. |
| **Live / active** | Pointer evening is still NH92 `SCE-e35dc2831e2ac6f1`. Candidate `activatedFile` is null. Live GET default remains v1 (`NOWHOT_CATEGORY_ROUTING` default). **Unchanged, as required.** |

---

## Required next action

Keep the pointer. Do not `--activate`. Optional follow-up (not blockers): record NH94 in Blueprint/status as implemented-unactivated; count admitted articles vs targets separately; drop dead `ROUTING_BASES` names; key deal no-vote on `isDeal`.

## Limits

Did not re-run the slot builder (would write artifacts). Did not run the full suite. Did not call models or change the pointer. Fashion 14/14 foreign and science 12 foreign are observation receipts under the no-quota rule, not publication defects.
