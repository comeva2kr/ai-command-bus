# NH116 Grok review — Live Hot (diff challenge)

Status: READ-ONLY. No tracked product edits, deploy, paid APIs, or user-store writes.
Local HEAD: `59918e0b66c1dbf1b3733c8f1a96d063c72d8baa` plus Root’s uncommitted assembler (this worker did not author it).
Public pool: `/tmp/nowhot-nh116-pool.json` savedAt `2026-09-05T00:44:10.948Z`
SHA-256 `722560254cacb52d554590d2929693a10c8bb9ac1b0b676ba0a8d36bd2e5bed8` (4544 rows).
Follow-up replay (untracked): `/tmp/nowhot-nh116-grok-followup.mjs` → `/tmp/nowhot-nh116-grok-gated.json`.
Do not reuse `/tmp/nowhot-nh116-replay.mjs` (Root overwrote it). Prior HEAD replay remains at `/tmp/nowhot-nh116-replay.json` for history only.

This follow-up reviews the current git diff and Root’s focused tests. It does not demand a third score system.

## Verdict

**PASS_WITH_LIMITATION.** AC11 is closed: `selectDiverse` now hard-caps `via==="ourdeal"` to one pick (the predicate is not on the relax ladder), and `selectDiverse: 직접 등록한 상품도 핫 한 페이지를 채우지 않는다` is green. The earlier HOLD on first-party deals filling Hot does not stand on current bytes.

The documented limitation is unchanged: keep `sourceHotScores`; do not invent a third key or an engagement floor. Corrected AC2′ (cap-feasible Korean heads, max 4) remains 1/4 humor / 0/4 anonymous on the prior grok replay. This closure did not re-replay the pool.

First Principles 게이트: PASS.

## AC2 retraction (prior report was wrong)

The first review required Korean main-feed raw-top10 ∩ Hot page 1 ≥ 6.

This snapshot’s Korean main-feed raw-top10 (kind=community, not foreign, not `inven_hot`) is **8 bobae + 2 instiz**. With cap 2/source the feasible overlap is **2 bobae + 2 instiz = 4**. Asking for ≥ 6 is arithmetically impossible. That row is struck.

Corrected AC2: of the **cap-feasible heads** — here bobae 1494, bobae 1276, instiz 414, instiz 391 — Hot page 1 must contain **≥ 3 of 4**. That is compatible with cap 2/source. Do not green it by counting HN.

Current dirty replay (`/tmp/nowhot-nh116-grok-gated.json`): humor mix=-1 **1/4** (only 1494, at slot 7); anonymous mix=-1 **0/4**. Fail. Treat as score-key limitation, not a reason to restore round-robin.

## What the diff actually landed (evidence)

Dirty tree (Root WIP): `engine.js`, `rank.js`, `index.html`, `test/feed.test.js`, `test/rank.test.js`, `test/foreign-share.test.js`, `test/taste-share.test.js`, `test/browser-navigation.test.js`.

| Requested change | In the diff? | Replay / test |
| --- | --- | --- |
| Explicit chosen-category gate on Hot (NH-P08) | Yes. `passesGates` uses `chosenCategories(user)` when `sort==="hot" && !category` | Humor mix=-1 page 1: **10/10 humor**, 0 news, 0 foreign |
| Unified `selectDiverse`, no anonymous round-robin | Yes. `sourceHotScores(pool)` as one group for every user | Anonymous mix=-1: 7 unique sources, not 10/10 one-per-board |
| Remove forced external-deal and taste-post donors | Yes. Deal pool is `via==="ourdeal"` only; `ensureTasteShare` / `capOneCategory` removed | Engine test “반응 없는 외부 딜을 인기글 사이에 강제로 넣지 않는다” passes |
| Bounded exposure, no hard starvation | Yes. Penalty `min(0.15, exposureW * log(1+exp))`; `maxExposureLead` gone | `selectDiverse` “오래 본 출처의 새 인기글을 무반응 글보다 뒤로 보내지 않는다” passes |
| No speculative prefetch; keep 1400px-ahead loading | Yes. `prefetchNext` / `state.prefetch` removed; IO `rootMargin: 1400px` kept; `loadMore` also chains when sentinel.top < innerHeight+1400 | Browser test uses an **18-item** first page (`nextCursor: 18`), viewport 1100×760 |
| Source cap not doubled at mix ±1 | Yes. `capFor` returns the plain cap when `Math.abs(mixBalance)===1` | `selectDiverse: 커뮤만을 골라도 한 출처의 페이지 상한은 늘어나지 않는다` passes |
| Dedupe before quotas | Yes. `canonicalContentUrl` and `source:eventKey(title)` | Humor page 1: 10 distinct titles |
| Foreign floor inside gated interest pool, score-sorted donors | Yes. Donors from `tasteBase`, sort by `hotScores` | Humor-only: 0 foreign. Humor+art (mix 0): 4 in-interest art RSS. `rig()` now stamps `category: "art"`; that focused test passes on current bytes |

`/tmp/nowhot-nh116-server-tests.log` (7 fail / old names) is **stale**. Current focused run `node --test test/anchor.test.js test/rank.test.js test/mix-slider.test.js`: **38 pass / 1 fail**. Rank ourdeal page-fill is green. The miss is `이전 앵커도 새 핫 페이지의 출처 상한에 포함된다` (order `i0,i3` vs `i0,i1`; source-`same` count assertion is 2).

## Concrete blocker (closed — AC11)

The ourdeal fill hole is closed on current `rank.js` bytes. Historical failure for the record:

```176:184:test/rank.test.js
test("selectDiverse: 직접 등록한 상품도 핫 한 페이지를 채우지 않는다", () => {
  const cands = Array.from({length: 20}, (_, i) => ({
    ...mk(`offer-${i}`, `source-${i}`, "tech", i < 8 ? 2 : 0.5),
    item: { id: `offer-${i}`, source: `source-${i}`, category: "tech", via: i < 8 ? "ourdeal" : "api" }
  }));
  const page = selectDiverse(cands, { limit: 10 }, P).picks;
  assert.equal(page.length, 10);
  assert.equal(page.filter(item => item.via === "ourdeal").length, 1);
});
```

That assertion is now **1 === 1**. Eight `hot=2` ourdeals no longer beat twelve organics at 0.5, because eligibility requires `via !== "ourdeal" || !out already has ourdeal` on every relax step.

The live hole was `selectDiverse` ignoring `via`. That is now a hard eligibility predicate (not relaxed with cap/cat/gap). Category bypass can still admit an off-interest ourdeal into the Hot pool; it can occupy **at most one** page slot. `ensureDealShare` remains a floor of `floor(10 * 0.12) = 1`. Do not restore external-deal donors. Do not retune `hotScore`.

## What is no longer the Hot bug

Prior HEAD replay (anonymous mix=-1): 10 unique sources, HN in humor, clien-jirum raw=0, etoland title twin, prefetch buffer `markSeen` without attaching. Those constructor defects are gone on the dirty path for the humor-only cohort.

Humor mix=-1 page 1 now:

1. etoland / raw 164 — 일일적립
2. bobae / raw 109 — 룸싸롱
3. etoland / raw 136 — 베를린 이민
4. todayhumor / raw 68 — 애기 반찬
5. instiz / raw 248 — 미슐랭 셰프
6. clien / raw 170 — 남의 직업
7. bobae / raw **1494** — 여의도 불꽃축제
8. todayhumor / raw 85
9. instiz / raw 138
10. clien / raw 65

All humor, 0 news, 5 sources, no duplicate title, no forced external deal. NH-P08 holds for a single chosen category.

## Remaining limitation (do not block on a third score)

`sourceHotScores` is still the page key. etoland 164 and bobae 109 still sit above bobae 1494. Anonymous mix=-1 page 1 still has HN/slashdot community slots and **0/4** cap-feasible Korean heads. Humor+art (mix 0) is 6 humor + 4 art, and those four art rows are raw=0 RSS (yankodesign / archdaily / hyperallergic / designboom) because each in-interest source still gets a slot.

That is the same velocity / per-source-z / `firstSeenAt` key as the first review. The instruction for this challenge is to leave it. Optional later: publishedAt age or `RANKING_MIN_ENGAGEMENT` fill, not a new formula in this patch.

`rank.js` header still says anonymous users keep round-robin. The code path does not. Comment drift only.

## 1400px ahead loading (not the HOLD)

Coordinator asked to drop the hidden prefetch buffer and keep 1400px-ahead loading. The diff does that. `/api/feed` still always `markSeen` (server never passes false); attached-but-below-the-fold cards still enter `user.seen`. That is the allowed lookahead, not the old unused shelf.

Residual: production `API.feed` uses `limit=10`. The new browser test first page is **18 items**, so `#sentinel` sits below `innerHeight+1400` on a 760px viewport and cannot fail a short 10-card first paint. `loadMore` also recursively calls itself with the same 1400px test, duplicate of the IntersectionObserver. If a 10-card list is short (no thumbs), page 2 still loads on first paint. Keep the lookahead.

## Independent acceptance criteria

Replay the same pool through current `getFeed` (this file’s follow-up used `/tmp/nowhot-nh116-grok-followup.mjs`). Clock = pool `savedAt`. mix=-1 unless noted.

| ID | Criterion | HEAD replay | Dirty replay |
| --- | --- | --- | --- |
| AC1 | mix=-1 Hot page 1 news = 0 | PASS | PASS |
| AC2 | **Struck:** ≥6 of Korean raw-top10. Impossible under cap 2 (8 bobae + 2 instiz ⇒ max 4) | n/a | n/a |
| AC2′ | Cap-feasible Korean heads ∩ page 1 ≥ 3 of 4 | 1/4 (1494 only) | humor 1/4; anon 0/4 — FAIL, score-key limitation |
| AC3 | No raw=0 on mix=-1 page 1 unless the gated community pool is all raw=0 | FAIL (geeknews) | PASS (humor and anon mix=-1 raw0=0) |
| AC4 | Unique sources on page 1 ≤ 6 (cap 2 on 10 slots) | FAIL (10/10) | humor 5 PASS; anon 7 FAIL |
| AC5 | Humor-only + mix=-1 chosen-category share ≥ 9/10 | FAIL (7/10, HN slot 2) | PASS (10/10) |
| AC6 | No duplicate title/URL on a page | FAIL (etoland twin) | PASS on humor page 1 |
| AC7 | A ≥10× raw gap must not invert solely by source fairness (1494 vs 164) | FAIL | FAIL (164 still above 1494) — score-key limitation |
| AC8 | No hidden prefetch buffer that `markSeen`s unattached page 2 | FAIL | PASS on buffer removal; 1400px attach still marks seen |
| AC9 | `hotScore` stays positive logistic | PASS | PASS (unchanged key) |
| AC11 | `via=ourdeal` ≤ 1 on a 10-slot Hot page when organics exist | not tested | **PASS** (hard predicate in `selectDiverse`; focused rank test green) |

## Non-blocking notes

- Intermediate mix now reaches anonymous users (`mixMultiplier` on the unified path). Not this ticket.
- `inven_hot` stays off-main. Do not “fix” Hot by turning it back on.
- 뽐뿌 `hot.php` still absent from this dump.
- Humor+art + mix=-1 correctly drops art **news** (NH115). Foreign floor then has no in-kind foreign humor (pool foreign-humor count = 0). That is mix ∩ gate, not a floor bug.
- `selectDiverse` still has `otherShare` as a max. After the Hot gate, off-interest rows are not in `cands` except ourdeal. Vestigial for surveyed Hot; the ourdeal bypass is the live exception.
- Single chosen category uses `catCapFor = limit` (no 60% haircut). Matches the rewritten rank test.

## WRC receipts

- 작업 시작 전 확인한 MD: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md` (13 First Principles), `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`, `PMO_LIVE_BOARD.md`, `REPORT_READ_INDEX.md`; `docs/00_NOWHOT_PRODUCT_CHARTER.md`; `docs/NOWHOT_DEVELOPMENT_STATUS.md` NH115; `docs/03_NOWHOT_ADVERSARIAL_REVIEW_PROTOCOL.md`; `wrc-review-gate`.
- 적용한 규칙: WRC 13 First Principles, §11.1 minimal change (report only), claim-vs-evidence, no unstated conditions. Follow-up replay injects the public snapshot into `FeedEngine.getFeed` with `refresh` stubbed and `_poolFile=null`; it does not write the pool or a user file.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음. Reviewer does not own `NOWHOT_DEVELOPMENT_STATUS.md`.
- 금지선 준수: tracked product code 0, deploy 0, paid API 0, user store 0. Only this report is updated.
- David 행동 필요 여부: 없음.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: AC11 HOLD is lifted. Do not restore round-robin, do not add a third score, do not drop 1400px-ahead loading.
- 하지 않은 일: product patches, test edits, pool re-replay, paid calls, treating stale `/tmp/nowhot-nh116-server-tests.log` as current.

## Required next action

None for AC11. Independent reviewers may re-replay the public pool later; this closure is current-byte tests plus `rank.js` / `engine.js` reads only. If Root wants `이전 앵커도 새 핫 페이지의 출처 상한에 포함된다` green, that is minGap vs consecutive same-source anchors — not a new score.

## Final AC11 closure (current bytes)

No pool re-replay. Read `src/feed/rank.js` and `src/feed/engine.js` only, then:

```text
node --test test/anchor.test.js test/rank.test.js test/mix-slider.test.js
→ 39 tests, 38 pass, 1 fail
```

**AC11 PASS.** Eligibility now refuses a second `ourdeal` on every relax step:

```192:200:src/feed/rank.js
    const eligible = (relaxCap, relaxCat, relaxGap) =>
      remaining.filter(
        (c) =>
          (c.item.via !== "ourdeal" || !out.some(chosen => chosen.item.via === "ourdeal")) &&
          (relaxCap || (pagePicks.get(diversityKey(c.item)) || 0) < capFor(c)) &&
          (relaxCat || (pageCats.get(c.item.category) || 0) < catCapFor(c)) &&
          (relaxCat || !isOther(c) || otherCount < neutralTotalCap) &&
          (relaxGap || !recentSrcs.includes(diversityKey(c.item))) &&
          quotaOk(c)
      );
```

`selectDiverse: 직접 등록한 상품도 핫 한 페이지를 채우지 않는다` is green. Mix-slider file is all green (NH115 endpoints unchanged). Rank file is all green.

Anchors are no longer spliced after `selectDiverse`. Engine loads retained ids into `base`, then passes them in:

```2213:2216:src/feed/engine.js
        sel = selectDiverse(remaining, {
          limit, minGap, exposure, firstPage: cursor === 0, picked, hated, mixBalance,
          anchors: anchorEntries.map(entry => entry.item.id)
        }, params);
```

`selectDiverse` boosts those ids (`anchors.get(id) * 1e6`) so they compete under the same source cap. The remaining red test (`이전 앵커도 새 핫 페이지의 출처 상한에 포함된다`) wanted head `["i0","i1"]` and got `["i0","i3"]`. Line 124 (`source==="same"` count === 2) is reached; minGap 1 blocks a second `same` immediately after `i0`, so slot 2 is another source. That is not AC11 and is not a new score.

`sourceHotScores` raw-vs-age (etoland 164 above bobae 1494) stays the documented limitation. No third key. No engagement floor.
