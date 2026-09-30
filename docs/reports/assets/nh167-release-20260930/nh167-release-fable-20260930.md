# NH167 candidate release review (adversarial, read-only) — 2026-09-30

Reviewer: Claude Fable 5.1 (Orca worker task_5b98f6d00f27). Target: worktree `nowhot-nh167-freshness-v4`, base HEAD cf13d28b7dcd370e1eda88988cd5b5cf587425e0 + all tracked/untracked product changes. No product/doc/test files edited. No commit/push/deploy/paid calls/live writes.

## Verdict: CONDITIONAL — not ready as-is. One real editorial defect (same-event repeat inside one lane, regression vs live) plus one release prerequisite (paired pointer rollback).

## F1 — Same-event story repeated 3x inside one lane via the new extras path (release-blocker: YES)

- Severity: high (reader-visible; contradicts the NH167 promise "반복 없이"; regression vs live).
- Where: `tools/build-slot-canonical-edition.mjs:134-142` (`assembleCategoryLanes` extras loop) — an extra is admitted on `extraLaneRejection()` only (news roles, 2 reporting groups, slot window). Nothing checks whether the extra is the same event as an issue already in the lane.
- Evidence (real replay `/tmp/nh167-fable-20260930-final-replay/artifact-2026-09-30-lunch-f11ad1898284.json`, auto lane):
  - auto[0]  `31a1eef1ace57ae68d9a654eb20d15dc54a413381832c43dcfd04d07f63f1b8a` — "'22살' 투싼, 글로벌 누적 판매 1천60만대 돌파" (gnews-biz, 01:44Z)
  - auto[15] `080924f2cd846081319ae18c26743a32e88458e9b5de1a0ae11daefab24de4d7` — "세계에서 통한 한국산 SUV의 발자취…현대차 투싼, 22년 만에 1000만 고지 넘었다" (donga, 01:21Z) — EXTRA
  - auto[16] `d3f44221fad3021a4213040df2301436bf5afffa2d3e5debeab3718789cf39f5` — "현대차 투싼 누적판매 1060만대 돌파…국산 SUV 첫 '천만대 클럽' 진입" (khan, 01:09Z) — EXTRA
- Regression vs live: live base artifact `SCE-9da8530b0dd50c50` (v1, 14-cap) auto lane holds exactly ONE Tucson story (position 0). Candidate ships three.
- Actual cause (two layers):
  1. In-edition event clustering does not merge them: `decideEventMerge` returns `guard_number_conflict` for pairs 0–16 and 15–16 (numeral forms "1천60만대" / "1060만대" / "1000만" are treated as conflicting numbers) and `guard_entity_overlap_min` for 0–15 (only "투싼" shared). This is pre-existing behavior.
  2. NEW: positions 15..20 are filled with no same-event guard against the lane. Under the live 14-cap these two unmerged duplicates were simply cut; the extras path now exposes them. `validateSlotCanonicalEdition` (src/feed/slot-canonical-edition.js:170-175) also only checks `extraLaneRejection` per extra, so the artifact validates.
- Repro: `node <scratch>/tucson.mjs` (pairwise `decideEventMerge` on the three lead titles; prints the decisions above). Or open the lunch replay artifact and list `lanes.auto` positions 0/15/16.
- Expected: at most one story per event in a lane (extras must not re-introduce an event already in the lane). Actual: three.
- Minimal repair (owner: Fable/Codex editorial path):
  - In `assembleCategoryLanes`, before `lane.push(issue)`, reject the extra with reason `same_event_in_lane` when it matches any issue already in the lane by a conservative same-event check: `sharedEventTokens(lead titles) >= 3`, or shared subject entity + headline quantity equal after Korean numeral normalization (`1천60만` ≡ `1060만`), or `decideEventMerge().merge`. Record it in `extras.rejected`.
  - Note: a token-only rule catches auto[16] (shares 투싼+누적+돌파 with auto[0]) but NOT auto[15] (shares only 투싼 with auto[0]); the numeral normalization (or a `1000만`≈`1060만` milestone tolerance) is needed to catch auto[15]. Fixing normalization inside `event-cluster.js` instead would also merge them in-edition but touches the selection baseline lock; decide scope explicitly.
  - Add a regression fixture from these three real issues asserting the auto lane keeps exactly one.
- Acceptance: re-run the 2026-09-30 lunch replay → auto lane contains exactly one Tucson story; `laneExtras.rejected` shows `same_event_in_lane`; other lane counts unchanged; focused suites (slot-canonical-edition, slot-canonical-prepublish) green; a ≥3-shared-token scan across all lanes of both replay artifacts finds no pair (today it finds only the two Tucson pairs above).

## F2 — Extras surface category misroutes that the 14-cap used to hide (medium, non-blocker)

- Where: same extras loop; qualification has no category-fit criterion; routing carries no confidence (`routingBasis: deterministic_tier_policy`).
- Evidence (evening replay `artifact-2026-09-28-evening-8513db1b0c5f.json`): business[14] "북한 불신 역대 최고… 국민 3명 중 1명 '통일 없이 지금이 낫다'", business[16]+politics[15] "'대통령이 국민 속여' 유시민, 명예훼손 혐의 고발돼" (categoryIds ['business','politics']); lunch business[15] "GIST·MIT, 앉아서 오르막 걷는 감각 구현…VR 보행". None were in the live business lanes.
- Expected: economy lane shows economy news. Actual: politics/society/science items in positions 15+.
- Minimal repair: routing-side (subject guards for business), or admit extras only when the lane is the issue's first `categoryIds` entry AND the guard set passes; not a blocker because baseline-14 routing quality is unchanged vs live.

## F3 — Unpolished machine translation shipped as an extra (low-medium, non-blocker)

- Evidence: evening news[15] "시청: Madonna와 Taylor Swift가 MTV VMAs에서 큰 승리를 거두었습니다." (bbc-world video item; originalTitle "Watch: Madonna and Taylor Swift win big at the MTV VMAs"). The five live artifacts contain zero "시청:/보기:"-prefixed headlines.
- Cause: the scheduled path runs `allowPaid:false` (src/feed/server.js:1547) → `apiKey=null` → no headline polish (`tools/build-slot-canonical-edition.mjs:800`), so pool-translated titles ship verbatim; the 14-cap previously cut this item.
- Minimal repair: in `extraLaneRejection` (or the extras loop) reject `raw_translation_headline` when the lead `originalTitle` is non-Korean and no polished `preparedHeadline` exists; or strip the "Watch:/시청:" video prefix class. Acceptance: no extra whose headline starts with `^\S+:\s` from a non-Korean originalTitle.

## F4 — Post-activation review files are not re-applied by the scheduler (low, limitation, non-blocker)

- `runDueSlotPrepublish` (tools/run-slot-canonical-prepublish.mjs:379-390) returns `already_active` before `discoverHeadlineReview`/`headlineReviewReflected` run; those only run inside `runPrepublishManifest`. A review written after a slot activates (the realistic case, since evidenceHashes are only known after a build) is applied only by a manual manifest run. Claim "정시 발행에서 자동으로 읽는다" holds for reviews present before the build. Document, or move the reflected-check into the due path.

## Rollback (release prerequisite, not a code defect) — answer to Root's cross-challenge

- Expected schema transition: contract v1→v2 (lanes up to 20, prepared up to 280). Empirically verified: HEAD's `validateSlotCanonicalEdition` rejects both final v2 artifacts ("contract mismatch", "<lane> exceeds 14 issues") and accepts the real v1 artifacts; the candidate code validates all five live v1 artifacts (legacyVersions).
- Concrete behavior if only code is rolled back while `active.json` points at a v2 artifact: (a) old reader `load()` for the exact key throws un-caught (src/feed/slot-canonical-edition.js:547 equivalent) → today edition responds 500 for that slot until the next slot builds; (b) old `runDueSlotPrepublish` throws at its `readActiveArtifact` for the same target slot → scheduler HOLD each tick until the next slot; (c) shared URLs of v2 editions → 500 under old code (not the friendly 404); (d) old v1 shared URLs are NOT lost: activation copies prior `publishedEditions` entries (src/feed/slot-canonical-edition.js:487-494).
- Prerequisite: snapshot `active.json` (and the last v1 artifact files) before deploy; rollback = code rollback + restore that pointer (or delete the v2 `editions`/`publishedEditions` entries). One line outside my scope: feed-data `journeyWindow` is dropped by the old serializer on rollback (measurement data, not user-facing).

## Verified OK (with evidence)

- Manifest `docs/reports/assets/nh167-20260930/complete-code-manifest.json`: 33/33 sha256 match the working tree; no changed product file missing from it.
- Focused suites (slot-canonical-edition, slot-canonical-prepublish, edition-change, category-routing, editorial-reader-copy, detail-reading, analytics-window): 178 tests, 177 pass, 0 fail, 1 skip (browser test; Root reports 72/72 browser pass).
- Cross-slot dedupe: both replays received every earlier same-day artifact (evening: morning+lunch; lunch: morning). Withheld 5 (evening) + 6 (lunch) are all genuine repeats on inspection; kept-as-material 2 (BTS 3관왕; 10월 50개 단지 3만8032가구 nationwide vs 수도권 2만4600가구) are genuine new facts. Concept matches judged distinct 98/59.
- Freshness: news leads dated before the edition date: 0/181 (evening), 0/172 (lunch). All 28 admitted extras have leads inside the slot window and pass `extraLaneRejection` independently.
- Corrections persistence: nvidia (evening) and bose (lunch) entries reflected in `preparedHeadline`, `reader.headline`, and `articleSummary.textKo`; `applyHeadlineReview` runs after `reusePreparedArticleDetails`, so a pre-correction cache cannot override it; `slotAlreadyActive` refuses an active artifact that does not reflect a job's review.
- Shipped path: Dockerfile copies `examples/headline-reviews`; `.dockerignore` does not exclude it; `DEFAULT_HEADLINE_REVIEW_DIR` resolves to `/app/examples/headline-reviews` in the image. Untracked files must be committed before an image build from git.
- `/api/admin/analytics/window` sits under the `isAdmin` 401 guard (src/feed/server.js:3703-3704). Analytics correctness itself is Grok's scope; not re-reviewed here.
- 8/14/20 contract: `targetPerCategory 8`, `laneCapacity 14`, `extraLaneCapacity 20`, `maxPreparedIssues 280`; validator enforces per-extra qualification and the 280 union cap; legacy v1 artifacts keep 14/196.

## Not verified by me

Docker build/production parity (Root did), real-device push, full 2131 suite (Root did; not re-run per instruction), analytics numbers (Grok).

## Model/effort evidence

Runtime self-identification: model id `claude-fable-5-1` (Claude Fable 5.1). Effort level is not observable from inside the session; the dispatch requested "high". No provider ACK is claimed.

## Files created

`/tmp/nh167-release-fable-20260930.md` (this report); temporary repro scripts only in the session scratchpad (`lane-audit.mjs`, `auto-lane.mjs`, `tucson.mjs`, `old-sce.mjs`).
