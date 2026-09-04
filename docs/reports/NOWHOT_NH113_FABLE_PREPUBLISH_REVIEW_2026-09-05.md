# NH113 read-only review — scheduled publisher missing from the runtime image

Reviewer: Claude Fable 5.1 (read-only). Date: 2026-09-05 07:4x KST. Worktree HEAD at review end: `6940b8a` (local, not pushed); `origin/main` = `05e93d6`.
No code edits, no deployment, no paid API calls. Scratch simulations only under the session scratchpad.

## 1. Root cause — independently confirmed

- `src/feed/server.js:1523` (`runLocalCanonicalPrepublish`) does `await import("../../tools/run-slot-canonical-prepublish.mjs")`. The scheduler is armed when `NOWHOT_LOCAL_EDITORIAL=1` and `NOWHOT_SLOT_CANONICAL_EDITION=1` (both are compose defaults) and `NOWHOT_SLOT_CANONICAL_PREPUBLISH` is not `"0"` (`server.js:1310-1314`). First tick 30 s after boot, then every 5 min (`LOCAL_INVENTORY_CHECK_MS`).
- The Dockerfile shipped since `89972fd` copied only `package.json` and `src/`; `.dockerignore` dropped `test`, `docs`, `*.md`. Nothing under `tools/` was in the image.
- Because the import is dynamic, the server boots fine and every tick fails inside `canonicalTick`, logged as `[slot-canonical] 정시 후보 생성 HOLD: Cannot find module '/app/tools/run-slot-canonical-prepublish.mjs'`. No new edition is ever built, the pointer stays at the ported `2026-09-04:lunch` (SCE-0b991485de03a38a), later slots hit `SLOT_CANONICAL_EDITION_UNAVAILABLE` → 409 → empty Today shell. This matches audit finding (1).
- Reproduced with three scratch layouts (files copied from the worktree, no Docker available on this Mac):
  - `package.json + src` (current image): `ERR_MODULE_NOT_FOUND`.
  - `+ tools` only (the naive fix): `ENOENT test/fixtures/selection-d1-candidates.json` — `tools/selection-candidate-registry.mjs:177` reads that fixture at module load.
  - `+ tools + test/fixtures/selection-d1-candidates.json`: import OK, exports `runBuilder, runDueSlotPrepublish, runPrepublishManifest, slotAlreadyActive`.

## 2. Every runtime asset/config the scheduled path needs

Transitive import closure of the prepublish script = 88 modules: 80 under `src/feed/` (already shipped) + 8 under `tools/`:
`run-slot-canonical-prepublish.mjs`, `build-slot-canonical-edition.mjs` (also spawned as a child process via `process.execPath`, cwd `/app`), `build-category-routing-snapshot.mjs`, `prepare-selection-shadow.mjs`, `selection-candidate-registry.mjs`, `build-editions.mjs`, `build-v2-edition.mjs`, `observe-shadow-slot.mjs`. Copying the whole `tools/` directory (40 small files) is fine.

Data files read at runtime:

| File | Where read | In old image? |
| --- | --- | --- |
| `test/fixtures/selection-d1-candidates.json` | `tools/selection-candidate-registry.mjs:177`, at import time | no (excluded by `test`) |
| `src/feed/communities.json` | prepublish `COMMUNITIES` + `registry.js` | yes |
| `src/feed/category-admission-policy.json` | prepublish `CATEGORY_POLICY` + `category-admission-policy.js` | yes |
| `src/feed/category-routing.snapshot.json` | server v2 router (parent only) | yes |
| `package.json` (`"type": "module"`) | Node ESM resolution for `.js` | yes |

`docs/*.md` are never read at runtime (`product-blueprint.js` only holds path strings), so keeping `docs` and `*.md` ignored is safe. `.nowhot-local` must not ship (production uses the volume).

Volume/config on the VM (`deploy/docker-compose.yml`): `FEED_DB=/data/feed.json` → pool file `/data/feed-pool.json` (engine default: store path minus `.json` + `-pool.json`; `FEED_POOL_FILE` unset). `NOWHOT_SLOT_CANONICAL_POINTER=/data/slot-editions/active.json` → out dir `/data/slot-editions`, work dirs `/data/slot-prepublish/<date>-<slot>/` and `/data/slot-editions/.work-<pid>/`, outputs `candidate-*/receipt-*/edition-*/prepublish-hold-*.json`. `TZ=Asia/Seoul`. The scheduler always calls with `allowPaid:false`, so `ANTHROPIC_API_KEY` is stripped from the child env and the edition is `free_only`; network egress is only article fetch + Google free translate. `NOWHOT_SLOT_CANONICAL_PREPUBLISH` is not passed through compose, so the scheduler cannot be switched off from `.env` without editing compose.

## 3. Root's fix `05e93d6` (pushed to main 07:21 KST) — packaging verified complete

- `COPY tools ./tools`, `COPY test/fixtures/selection-d1-candidates.json ...`, and `RUN node --input-type=module -e "await import('./tools/run-slot-canonical-prepublish.mjs')"`.
- `.dockerignore` uses the documented nested re-include pattern (`test/*`, `!test/fixtures`, `test/fixtures/*`, `!test/fixtures/selection-d1-candidates.json`) and now excludes `.env`, `.nowhot-local`, `._*`.
- The `RUN` import check makes the image self-verifying: if any asset were missing the build fails instead of shipping. The import has no side effects (main guards compare `import.meta.url` to `argv[1]`; scratch import printed only exports).
- I could not run `docker build` here (Docker not installed on this Mac); `!` re-include semantics are per Docker docs, and the RUN guard covers the residual risk.

## 4. New finding — child builder inherits the production scheduler (WARN, fixed by local `6940b8a`, not yet pushed)

`build-slot-canonical-edition.mjs` → `buildTodayEditionInProcess` → `createServer({...})` in the child process. The child inherits the compose env, so `slotCanonicalEditionEnabled` resolves from `NOWHOT_SLOT_CANONICAL_EDITION=1` and `LOCAL_CANONICAL_SCHEDULE_ENABLED` becomes true inside the builder (`server.js:1310`). Probe (scratchpad `child-env/probe.mjs`, mimicking the exact `createServer` opts):

| Run | Env / opts | Child-side scheduler fired |
| --- | --- | --- |
| A | compose env inherited, opts as shipped in `05e93d6` | YES (`[slot-canonical] 정시 후보 생성 HOLD: ENOENT … feed-pool.json`) |
| B | same + `NOWHOT_SLOT_CANONICAL_PREPUBLISH=0` | no |
| C | Mac env without the flag (how NH112 was built) | no |
| D | opts from `6940b8a` (`slotCanonicalEditionEnabled:false`) | no |

Why it matters in production: the child's engine persists its own pool (`engine.todayEdition` → `_items()` → `refresh()` → `_savePool()`, `engine.js:1140-1146, 1828`) with `savedAt = Date.now()`, so the child's 30 s tick can find a pool, target the same date:slot, overwrite `/data/slot-prepublish/<date>-<slot>/` inputs, and spawn a second builder for the same slot into `/data/slot-editions`; each nested level repeats until the first activation makes the slot `already_active`. Never seen locally because NH112 builds ran without the flag. I reproduced the arming and the first tick only; I did not run a full nested build, so chain depth is analysis, not measurement.

`6940b8a` fixes it minimally (`tools/build-editions.mjs`: `slotCanonicalEditionEnabled: false`) and adds a test. If `05e93d6` has already auto-deployed, check for duplicate builders (see §7) and push `6940b8a` promptly.

## 5. `6940b8a` reader fallback — reviewed, no regression found

- Exact-key path unchanged except a stricter identity check (artifact date:slot must equal the pointer key). All 11 entries of the local pointer (the same pointer ported to production in NH112) pass it: 0 mismatches, `2026-09-04:lunch → SCE-0b991485de03a38a`.
- Fallback: newest verified edition strictly before the requested slot within 24 h (`EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs`), invalid or escaping entries skipped, `serving.state = fallback_slot_pointer`, `serving.fallback = true`, pointer bytes untouched. `today.html:691-698` already renders fallback copy ("…판을 보여드리고 있습니다 · 최신 …판은 검수 중"), so no client change is needed. No import cycle (`editorial-inventory.js`, `editorial-serving.js` do not import `slot-canonical-edition.js`).
- Sep 5 consequence: requests for 09-05 morning (19 h) and lunch (exactly 24 h, passes `<=`) fall back to SCE-0b99; 09-05 evening (31 h) would still 409 unless the scheduler builds by 19:00. Fallback is a bridge, not the fix.
- Caution: `deploy/autodeploy.sh` preflight only asserts `/api/today` 200 with ≥3 own issues, which now passes on fallback even if the scheduler is still broken. Smoke-check the scheduler, not only `/api/today`.
- Tests at `6940b8a` on this Mac: `slot-canonical-edition` + `build-editions` 40/40, `slot-canonical-prepublish` 12/12.

## 6. Scheduler and due-date targeting (unchanged by the fixes)

- Target (`runDueSlotPrepublish`): within 20 min before the next publish → next slot; else latest due slot today (`resolveEditorialTarget`); before 07:00 → yesterday evening. Publish times KST: morning 07:00, lunch 12:00, evening 19:00 (`digest.js` `SLOTS`).
- Gate (`resolveSlotCanonicalBuildTarget`): `pool.savedAt` must be inside [publish − windowHours, slot end]: morning [19:00 D-1, 11:00], lunch [06:00, 17:00], evening [12:00, 05:00 D+1]. The pool is rewritten every 15 min so `savedAt ≈ now`. Dead zones where every tick HOLDs by design: 05:00–06:40, 11:00–11:40, 17:00–18:40 KST (`pool savedAt outside … preparation window` is expected noise there).
- Now (07:4x KST): target `2026-09-05:morning`, not in the pointer → build. `--reuse-edition` = latest active ≤ target = `2026-09-04:lunch` SCE-0b99, so `reusePreparedArticleDetails` carries reviewed headlines/details for identical articles; new articles get free-path details (`excerpt_only` / `source_unavailable`). Activation merges into the pointer (`activateSlotCanonicalEditions` spreads existing entries), so SCE-0b99 remains for `2026-09-04:lunch`. Next pre-builds: 11:40 lunch, 18:40 evening.
- Deploy dynamics: `autodeploy.sh` (cron, if active) rebuilds on any push to main within ~1 min; a rebuild kills in-flight builds, which is safe (pointer only changes atomically at activation; leftover `.work-<pid>` and `slot-prepublish` files are garbage, not corruption).

## 7. Smoke check after deploying `6940b8a` (in order)

1. Image: build already fails if assets are missing (Dockerfile RUN). On the VM:
   ```
   docker compose exec app node --input-type=module -e "await import('/app/tools/run-slot-canonical-prepublish.mjs'); console.log('ok')"
   docker compose exec app ls /app/tools /app/test/fixtures
   ```
2. Scheduler log must be clean of module errors:
   ```
   docker compose logs --since 15m app | grep slot-canonical
   ```
   No `Cannot find module`, no `ENOENT`. A `pool savedAt outside … window` HOLD is acceptable only inside the dead zones above.
3. Volume outputs and single builder:
   ```
   ls -t /var/lib/docker/volumes/deploy_feed-data/_data/slot-editions | head
   docker compose exec app ps | grep build-slot-canonical
   ```
   Expect one `candidate-2026-09-05-morning-*.json`, `receipt-…`, `edition-…`; no `prepublish-hold-*`; at most one builder process. Two candidates with different hashes for the same slot = nested-builder symptom from §4.
4. Reviewed edition preserved:
   ```
   jq '.editions["2026-09-04:lunch"], (.editions|keys)' /var/lib/docker/volumes/deploy_feed-data/_data/slot-editions/active.json
   ```
   Must still show `SCE-0b991485de03a38a` / `0b991485…`, plus the new `2026-09-05:morning` key.
5. HTTP (header keeps it out of traffic counts):
   ```
   curl -s -H 'x-nowhot-check: 1' 'https://nowhot.kr/api/today?categories=news,business,tech' | jq '{state:.serving.state,fallback:.serving.fallback,served:[.serving.servedDate,.serving.servedSlotId],edition:.slotCanonicalEdition.artifactId,issues:(.issues|length)}'
   curl -s -H 'x-nowhot-check: 1' 'https://nowhot.kr/api/today?date=2026-09-04&slot=lunch&categories=news,business,tech' | jq '.slotCanonicalEdition.artifactId'
   ```
   Before the first build: `fallback_slot_pointer`, served 2026-09-04 lunch. After: `slot_canonical_verified`, served 2026-09-05 morning. The second call must keep returning SCE-0b991485de03a38a. `?date=2026-09-05&slot=evening` → 409 `EDITORIAL_SLOT_NOT_DUE` until 19:00 is expected.
6. Watch the first free-path build's `receipt-*.json` `detailStatuses` against NH111 (excerpt_only 155 / source_unavailable 40); the VM's egress has never run this pipeline before.

## 8. Not done / out of scope

- No `docker build` (no Docker here), no VM inspection, no production HTTP calls, no full nested-build reproduction, no edits, no push.
- Did not review the AdFit/AdSense audit items (2) and (3); only the slot 409 path.

## WRC report block

- 작업 시작 전 확인한 MD:
  - 자동 주입: 전역 CLAUDE.md, wrc-rule-gate.md
  - 직접 읽음: `docs/reports/NOWHOT_OWNER_TAKEOVER_2026-09-05.md`, `docs/deploy.md`, `deploy/*`, `Dockerfile`, `.dockerignore`, `render.yaml`, `.github/workflows/test.yml`
  - 미읽음/불가: WRC 공통 6종 start gate (긴급 장애 읽기전용 검수라 과제 전용 맥락만 읽음; 규칙은 인수 기록의 요약으로 적용)
  - 이번 작업 전용 파일: `tools/run-slot-canonical-prepublish.mjs`, `tools/build-slot-canonical-edition.mjs`, `tools/build-editions.mjs`, `tools/selection-candidate-registry.mjs`, `src/feed/server.js`(스케줄러·/api/today), `src/feed/slot-canonical-edition.js`, `src/feed/editorial-inventory.js`, `src/feed/digest.js`, `src/feed/engine.js`, `test/slot-canonical-*.test.js`, `test/build-editions.test.js`, commits `05e93d6`, `6940b8a`
- 적용한 규칙: 전체 경로 추적 후 판단, 기존 검수판 보존, 최소 근인 수정, 유료 호출·배포·코드 수정 없음, 과거 기록과 현재 검증 분리
- First Principles 게이트: PASS
- 금지선 준수: 코드·판본·포인터·VM·계정 변경 없음. 스크래치 시뮬레이션과 로컬 테스트만 실행
- David 행동 필요 여부: 없음 (Root가 `6940b8a` push·배포 판단)
- Telegram 알림 필요 여부: 없음
- 이익 우선·과잉방어 점검: GO. 패키징 수정과 검증판 fallback은 독자 가치를 늘리고 검수판을 유지함
- 하지 않은 일: Docker 빌드, 운영 VM 확인, 중첩 빌드 전량 재현, 광고 감사 (2)(3) 검수
