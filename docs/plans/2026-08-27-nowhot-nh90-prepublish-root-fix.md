# NH90 Prepublish Root Fix Plan

## Product outcome

Publish one immutable morning, lunch, and evening edition whose 14 category lanes are already selected,
localized, summarized, sourced, and illustrated. User requests only filter and display this artifact.

## Non-negotiable regressions

- Keep NH89 exact category union and event-content stability.
- Keep direct publisher preference and zero request-path LLM/write work.
- Keep adult tagging/gating and rollback to the last complete edition.
- Do not deploy, push, or replace the live site in this plan.

## Execution rounds

## Constraint order and ownership

1. Strip adult/unsafe rows, resolve direct publisher URLs, and localize titles before clustering.
2. Use the pool file as membership authority. `editionDate + slotId` is identity; `pool.savedAt` is collection/evidence time.
3. Cluster the full eligible pool once. Withheld rows may support evidence but never become the lead.
4. Semantic admission/no filler is absolute. A lane below 13 fails the whole candidate and keeps the prior complete pointer.
5. Preserve the NH89 foreign-major floor for news/business/tech.
6. Allocate independently per lane: unique operator pass first, then second seats; record shortfalls.
7. Domestic bands are score tilts and audits only. They never insert a lower-quality filler.
8. Freeze the 14 lanes, then derive every multi-category response as their exact deduplicated union.

`globalMustKnow` is deferred. The prepublish path must not call `/api/today`, legacy carryover, or shadow's 8-12 volume owner.

### Round 1: ordering and evidence

- RED: pool collection after slot label must not be truncated by a synthetic earlier `asOf`.
- RED: evening collection after midnight keeps the intended civil date and slot key.
- RED: the isolated pool is not re-windowed with domestic 6-7h versus foreign 24h rules.
- RED: Google wrapper and resolved direct URL cluster as one event.
- RED: title localization/readability happens before allocation, while body summarization happens after selection.
- RED: category-withheld articles can support an event but cannot become its lead card.
- RED: a Google wrapper cannot lead when an admitted direct publisher member exists.
- RED: article type is assigned before clustering and survives category admission.
- RED: stale or mixed-v1 routing fails the candidate; carryover is disabled.
- GREEN: use explicit civil date/slot plus pool `savedAt`, cluster once, and separate evidence from lead eligibility.

### Round 2: ranking and allocation

- Reuse `selection-axes`, event clusters, source identity, and existing shadow score materials.
- Calculate news/community/deal rank once per event and derive a lane-specific key from the event type.
- Allocate 13-14 independently per lane with exact union, operator-group rotation, domestic soft bands, foreign-major floor,
  and explicit importance override receipts.
- Mutating one lane's constraints must not change any other frozen lane.
- Verify all 14 single lanes and representative 2/3/all-category unions.

### Round 3: immutable content and time

- Precompute final-card title, source set, image, first-published times, and summary.
- Build real morning/lunch/evening files keyed by civil date and slot, with atomic pointer activation and last-complete rollback.
- Add native date selection only after all three stored slots exist; an absent exact key returns unavailable and never silently falls back.

### Round 4: product proof

- Build a candidate from the newest local pool without paid calls unless a candidate, call count, and cost ceiling are separately approved.
- Measure category counts, source/operator concentration, domestic/foreign mix, foreign-major coverage,
  summary state, and request work.
- Browser-check desktop and 390x844 mobile: category switching and detail opening are immediate.

### Round 5: independent review

- Claude Fable 5: editorial/category/source adversarial review, read-only.
- Grok 4.6: architecture/data-flow/product adversarial review, read-only.
- Each reviews the other's counterexamples; Codex fixes only reproducible P0/P1 at shared roots.

## Completion gate

Local candidate GO requires product proof, full regression tests, `git diff --check`, and both independent
reviews with no reproducible P0/P1. Live remains unchanged until separate staging and deployment approval.

## Local completion receipt — 2026-08-28

- Active local artifact: `SCE-8c830e97df2425ac`, 2026-08-27 evening, 179 issues.
- 14/14 lanes contain 14 issues. All 91 category pairs equal the deduplicated union of their frozen lanes
  and contain 25-28 issues. Event content drift across all responses is zero.
- Summary terminals: excerpt_only 132, source_unavailable 47, pending/error 0. Request work is filter-only
  and adds no LLM call.
- Desktop and 390x844 browser checks passed; category switching and prepared detail opening were immediate.
- Focused 266/266, full 1,740/1,740, diff check PASS. Claude and Grok independently found P0 0/P1 0.

This closes the local single-slot candidate. Three current slot files, archive automation, staging, and live
delivery remain separate work and were not claimed or executed.
