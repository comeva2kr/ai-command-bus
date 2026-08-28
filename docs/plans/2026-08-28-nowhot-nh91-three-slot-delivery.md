# NH91 Three-slot Delivery Plan

## Product outcome

Preserve the accepted NH90.2 edition exactly, then prepare morning, lunch, and evening before readers arrive.
Category clicks only filter immutable files; opening a story never starts collection, translation, summarization,
or model work.

## Acceptance oracle

- Baseline commit: `34f26ce` (`NH90.2 로컬 오늘판 정본과 사전처리 체크포인트`).
- Keep 14 categories at target 14, minimum 13, and exact deduplicated unions.
- Keep title, sources, image, summary, and time fixed for the same event across every category selection.
- Keep direct-publisher preference, adult tag/gate, prepared detail states, zero request-path network/LLM/write,
  exact date+slot reads, and pointer rollback on failure.
- Do not push, deploy, or alter the live service without a separate David approval.

## Minimal implementation sequence

1. Reuse `build-slot-canonical-edition.mjs` and `activateSlotCanonicalEdition`; add one manifest runner that invokes
   the existing builder once per explicit slot. Each slot is independently staged, validated, and atomically activated.
2. Make each run idempotent by exact date+slot+input identity. A failed candidate writes a failure receipt but cannot
   change the active pointer or any prior edition file.
3. Add observation-only receipt fields for lane count, unique operator count, top operator share, domestic/foreign/mixed
   count, multi-source count, foreign-major floor, and prepared-detail status. Receipts diagnose; they do not filter.
4. Keep the existing domestic soft bands and source rotation. Tune only if a fresh complete slot violates the product
   bands while enough admitted supply exists; never fill with an unrelated article.
5. Keep the existing prepublish summary pipeline. Paid LLM work remains bounded to ambiguous classification,
   unusable free translation, multi-source synthesis, or important editorial copy and requires an explicit priced run.
6. Reuse the native date input already in Today. Store the earliest source publication time in the artifact and show it
   compactly in the list; detail keeps Korean time and may add publisher-local time only when trustworthy timezone data exists.
7. Defer list thumbnails: the dense accepted layout is faster and clearer without them; revisit only after measured
   reader benefit and image coverage justify the space.

## Verification and review

- RED first: three explicit jobs, idempotent rerun, middle-slot failure preserving all prior pointer bytes, receipt metrics,
  first-publication stability, and GET filter-only regression.
- GREEN: focused tests, full `npm test`, `git diff --check`, desktop and 390x844 browser checks.
- Claude independently reviews editorial/source truth; Cursor Grok 4.6 independently reviews data flow, idempotency, cost,
  and rollback. Codex changes only reproducible shared-root P0/P1 findings.

## Truth boundary

This plan authorizes local reversible work only. Local tests or reviewers do not prove scheduling, staging, deployment,
or live delivery. Those remain separate approval-gated actions.

## Local checkpoint receipt

- Lunch `SCE-2c3e84eb5ebea59e` and evening `SCE-f6548112c651284a` are active locally; the missing morning slot returns an honest Korean 409.
- Evening has 14 items in all 14 lanes. All 91 category pairs are exact deduplicated unions with zero event-content drift.
- Details are precomputed (`excerpt_only` 134, `source_unavailable` 58, pending/error 0); request-path LLM and detail fetches are zero.
- `npm test` passed 1,799/1,799. Claude Opus 5 and Cursor Grok 4.6 high both reported P0 0/P1 0 on current bytes and runtime.
- Scheduling all three slots on time, staging, push, deploy, and live delivery remain unproven and outside this checkpoint.
