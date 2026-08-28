# NH90 Grok product/systems audit (read-only)

- Date: 2026-08-27 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6, independent of the earlier plan review
- Artifact: `.nowhot-local/slot-editions/edition-2026-08-27-evening-a5f8a18e3dc9.json`
  (`SCE-a5f8a18e3dc99bbf`, pointer `2026-08-27:evening`)
- Compared: NH89 lunch `SCE-f9e8287a73921a1a`; NH90/NH90.1 blueprint; plan; SDD ledger
- Code read only. No edits, paid APIs, rebuilds, commits, deploys, or live-server writes.

## Verdict

**Local plumbing: GO. Local product candidate: HOLD. Live: HOLD.**

Coordinator quotas are real: 14×14, unions 28/56/196, 0 request-path LLM, 0 pending, exact date+slot 409, API/modal latency claims are not contradicted by this artifact. Those checks do not inspect reader-visible copy, semantic admission, clustering, or public-body text. On the frozen evening plate, **P0: 3. P1: 5.** Prior Claude/Grok reviews attacked the *plan*; this audit attacks the *activated file*. Ledger R1–R5 are still open while this evening pointer is live locally.

Plumbing GO does not become product GO.

## Path (as coded, not as NH90.1 wrote)

```
pool file
  → TranslatingSource wrap (tools/build-editions.mjs)
  → createServer({ editorialPreselectedPool: true })
  → engine.todayEdition({ sharedCanonical: true, allowCarryover: false })
       14× engine.briefing()  [NH90.1 forbids briefing(); still the owner]
       _sharedBriefingContext:
         router.project() drops empty-category rows
         buildEventClusters(full admissible pool)
         briefing() then lane-filters → digest.clusterIssues → nearIssueGroups
         → buildDigest addBalanced / ignoreSourceCap fill to 14
         → issueHeadline / issueSubject(max=2) / enrichDigestIssue templates
  → article-summary excerpt_only|source_unavailable (LLM off)
  → buildSlotCanonicalEdition freeze (no reader projection)
  → pointer GET /api/today  [server.js ~3142: read+filter only]
  → today.html uses issue.reader || issue.headline
```

NH90.1 required: unwrap → title-localize → strip adult → one full-pool cluster → semantic multi-label admit → lane-local allocate → freeze → GET filter. The builder skipped HTTP `/api/today` (`directBuild: true`) but still owns volume via `briefing()` + `buildDigest`.

Routing on this plate (`receipt-2026-08-27-evening-a5f8a18e3dc9.json`):

| basis | snapshot (2208) | selected leads (196) |
|---|---|---|
| current_model | 2 | 0 |
| specialist_registry_default | 869 | 103 |
| legacy_classifier_fallback | 1337 | 93 |
| withheld | 0 | 0 |

Recovery policy: `current_model_then_exact_prior_then_specialist_then_legacy_classifier`. NH90.1 §7 forbids silent v1 fallback.

---

## P0

### P0-1 · Pointer GET never projects reader copy → 196/196 machinery headlines

**Observed.** Frozen `issueTable` has `reader: 0`. UI (`src/feed/public/today.html` `renderIssues` / `openIssueDetail`) uses `copy.headline||issue.headline`. Every card matches a digest template:

- `관련 보도 묶음 포착` 46
- `복수 수집 경로 확인` 28
- `{source} 상위의 “…"` 105
- `추천 N건을 모은` 14 / `댓글 N건이 붙은` 3

Examples frozen as served: `“8월 28일(음력 7월 16일) 오늘의 운세” · 관련 보도 묶음 포착`; `CNBC 경제 상위의 “연준이 선호하는…”`; `“180억 달러” · 복수 수집 경로 확인`.

**Root.** `src/feed/server.js` pointer branch (~3151) `return send(res, 200, slotCanonicalEditionReader.read(...))`. Non-pointer `buildServeableTodayEdition` (~844) runs `projectEditorialReaderCopy`. `projectSlotCanonicalEdition` clones frozen issues and does not attach `reader`. Applying the existing projector to this artifact locally yields **0** remaining jargon headlines (`projHeadHits: 0`).

**Why tests missed it.** `test/slot-canonical-edition.test.js` fixtures already embed `reader.headline`. The pointer test asserts `requestWork=filter_only`, not jargon-free GET headlines. `test/editorial-reader-copy.test.js` and `test/local-editorial-edition.test.js` only cover the non-pointer path. `test/briefing-quality.test.js` still requires `관련 보도 묶음 신호` in canonical paragraphs.

**Minimum shared fix.** One wrap on the pointer success path: `send(res, 200, projectEditorialReaderCopy(slotCanonicalEditionReader.read(...)))`. Do not freeze new headline templates. Do not add a second copy module.

**Verify.** GET `categories=news` and `categories=tech`: 0 headlines matching `관련 보도 묶음 포착|복수 수집 경로 확인|상위의 “`. Same 14 evidenceHashes as the frozen lane. `readerPresentation.responseOnly=true`. Repeat for lunch pointer. Fixture in `test/slot-canonical-edition.test.js` must *omit* `reader` and fail until the wrap exists.

### P0-2 · Legacy classifier + specialist registry admit without a semantic gate

**Observed on this plate (selected leads, not pool trivia).**

| Lane | Card | Routing | Why it is a miss |
|---|---|---|---|
| tech #14 | 오늘의 운세 (경남도민일보 via `gnews-ent`) | `legacy_classifier_fallback` cats=`[tech]` | Registry category of `gnews-ent` is **culture**. Excerpt is 띠별 운세. Google News URL is still the lead (`news.google.com/rss/articles/...`). |
| business #3 | MarketWatch “친구의 변호사가 동의 없이 부상 사건을 해결” | `specialist_registry_default` | `marketwatch-top` `declared_section` → business. Personal-injury advice column, not a market event. |
| humor #2 | 더쿠 “충격적인 네팔 홍수 전 후 사진” | `legacy_classifier_fallback` humor | Disaster photo as humor; image `pbs.twimg.com/...`; news already has two Nepal-flood cards. |
| humor #11/#13/#14 | 이토랜드 오리불고기 / 컬쳐랜드상품권 / 삼겹살 | `legacy_classifier_fallback` humor | `contentType` deal/hotdeal filling humor to 14. |
| realestate #13 | 오늘의유머 “30년뒤 전세계 인류 멸종” | `legacy_classifier_fallback` realestate | Community lead in a news-priority lane. Image is `search_S.png` chrome. |

NH90.1 constraint 1 (no filler) and community-lead rule (news/politics/business/realestate/science = news first) are violated on the frozen plate. 0/196 selected leads are `current_model`. Lunch NH89 had 194 model / 1180 withheld; evening “recovered” by admitting everything.

**Root.** `tools/build-category-routing-snapshot.mjs` `allowLegacyFallback` (~137–145) writes `legacyCategory` as admission. Specialist news with `sourceTier=specialist` gets `[meta.category]` with no title `coreTest`. `createCategoryRouter.project` returns `[]` only when categories empty; this snapshot has withheld=0 so the router never withholds. `digest.js` `addBalanced(..., { ignoreSourceCap: true })` then fills the 14th seat with whatever the lane still has (deals, 운세, memes).

**Why tests missed it.** `test/category-routing.test.js` “API 장애 복구를 명시한 경우에만…” treats legacy fallback as GREEN. `validateSlotCanonicalEdition` checks counts, union, and prepared *status*, not title∈lane. No fixture `운세` ↛ tech, no fixture deal ↛ humor, no fixture community ↛ realestate. 1728 tests never open the evening `issueTable`.

**Minimum shared fix (one admission owner, no new classifier).**

1. Candidate fails if snapshot `source.allowLegacyFallback === true` or any selected lead `routingBasis === "legacy_classifier_fallback"`. Keep the previous complete pointer.
2. `specialist_registry_default` may *propose* a lane; reject the lead when existing `classify.js` guards fire (`운세|띠별|타로`, incident/legal-advice-not-market, deal price/mall format). Rejected rows can stay evidence, not lead.
3. Community lead forbidden in news/politics/business/realestate/science (already in the blueprint; enforce in `buildDigest` / `todayEdition` before freeze).
4. `contentType=deal` cannot occupy humor/news/politics/business/realestate.

Do not turn paid model classification into the gate (account is usage-limited). Do not admit the whole pool as a substitute.

**Verify.** Rebuild-from-this-pool is out of scope here; lock RED fixtures: (a) `gnews-ent` + title 오늘의 운세 → not in `lanes.tech`; (b) MarketWatch injury advice → not in `lanes.business`; (c) etoland hotdeal → not in `lanes.humor`; (d) todayhumor 멸종 → not in `lanes.realestate`. Activation receipt `legacy_classifier_fallback` on selected leads = 0. If the pool then cannot hit 13 in a lane, **fail the candidate** (constraint order already locked).

### P0-3 · Public-body extractor treats site chrome / board indexes as the article

**Observed.** `excerpt_only` 139, max 900 chars (contract clip). Three humor deal cards share the **same** body:

> `🔥오늘의 HIT 30 종합 유머 연예 생활 시사 이슈 1 결국 나락간 김준일 최후.jpg … 7 섹스 비디오 유출 예방법 꿀팁 …`

That is etoland’s HIT index, not 오리불고기 / 상품권 / 삼겹살. Adult-adjacent list text is now a humor detail. Hankyoreh 6/6 excerpts start with `본문 국제|미래&과학` crumbs + `Your browser does not support the audio element` + `구글 선호 매체 등록`. Ars: `실내 장식품 저장` (nav). BBC video card includes player chrome `닫기`. Fortune card excerpt is the actual 띠별 운세 (correct body, wrong lane — P0-2).

**Root.** `src/feed/enrich.js` `articleText` / `publicText` strips `<nav>|<footer>` tags then falls back to `<main>` / all `<p>`. Korean and community CMS put crumbs and board lists in those nodes. `src/feed/article-summary.js` `publicExcerpt` clips to 900 with **no line filter**. `isPreparedArticleSummary` accepts any Hangul of length ≥160.

**Why tests missed it.** Article-summary tests check status, length bounds, and quote continuity for `ready`. No fixture HTML of a board index or Hankyoreh crumb rail. Slot validator only requires `textKo` non-empty for `excerpt_only`.

**Minimum shared fix.** In `publicText`/`publicExcerpt` (one place): drop lines matching crumb/board/legal (`본문 `, `구글 선호 매체`, `오늘의 HIT`, `audio element`, `All rights reserved`, `이용약관`). If remaining text < `ARTICLE_TEXT_MIN`, return `source_unavailable` `PUBLIC_BODY_TOO_SHORT` rather than clip chrome. Reject identical `textKo` on two different evidenceHashes in one edition.

**Verify.** Evening humor etoland cards must not share a body; none may contain `오늘의 HIT 30` or `섹스 비디오`. A Hankyoreh fixture must not start with `본문 `. Duplicate-excerpt check in `validateSlotCanonicalEdition`.

---

## P1 (block local product GO / live; not plumbing)

### P1-1 · Why-important / watch-next are category templates

Canonical `whyImportant`: one lens sentence per lane (culture 18 identical, science 15, auto/fashion/gaming/realestate/tech 14). Canonical `watchNext` is four strings covering all 196 (`새 근거가 추가되는지…` 88, related-coverage 46, 추천·댓글 34, 교차관측 28).

**Root.** `src/feed/engine.js` `editorialValue` / `enrichDigestIssue` (~801–889). Reader-copy (`editorial-reader-copy.js` `readerWhyImportant`) prefixes the subject onto the same template (`withEventContext`); diversity then looks unique (`projWhyTop` all n=1) while remaining generic. Event-frame regexes only hit a handful of stories (지진/호르무즈/…).

**Tests missed.** Diversity test allows 15% exact repeats and is not run on pointer GET. Lineage `editorial_policy` makes generic copy “supported.”

**Fix.** For coverage/single-feed cards, prefer `readerSummary` (source + title) and omit `whyImportant` when it still matches `/볼 가치가 있습니다/` with no event-specific noun beyond the subject already in the headline. Do not write 196 unique LLM blurbs.

**Verify.** Any 14-card lane: unique `whyImportant` after stripping the quoted subject ≤ 3; `watchNext` exact-repeat ≤ 2.

### P1-2 · Same Nepal flood occupies two news seats (plus humor)

News #2 `EV-70acd4b9fcbd1922` BBC video “네팔-티베트 국경을 덮친 돌발 홍수” (4 members, bbc+khan). News #5 `EV-e786d7742ccea64c` BBC article “치명적인 네팔-티베트 홍수에 대해 우리가 알고 있는 것” (bbc+guardian). Humor #2 theqoo photos (community/news merge is intentionally forbidden).

**Root.** `digest.clusterIssues` exact `eventKey`/URL only; `event-cluster.js` 2-stage merge requires ≥2 distinctive tokens and 24h window, and **does not merge community with news**. `issueSubject({ max: 2 })` then labels them `네팔 티베트` vs `티베트 네팔`. Two BBC URLs of the same flood survive as two events.

**Tests missed.** Event-cluster tests lock *non*-merge of community vs news and number-only overlap. No fixture “BBC video + BBC explainer of the same flood → one event.” Slot tests do not scan selected news titles for duplicate entities.

**Fix.** After `buildEventClusters`, merge same-publisher same-day items whose distinctive tokens ∩ ≥ 2 (`네팔`,`티베트`,`홍수`) before lane allocation. Do not merge the theqoo photo into the news card (keep as community reaction evidence on the news event, not a humor lead).

**Verify.** Evening news lane contains ≤1 card whose title/excerpt tokens include both 네팔 and 홍수. Humor does not lead with that photo.

### P1-3 · Related-coverage jargon and Google wrappers on single-source cards

46 cards are `related_coverage_signal` with `observedFeedCount=1` and headline `관련 보도 묶음 포착`. Fortune lead URL is still a Google wrapper. `eventSources` lists `gnews-ent` only; ownership group `publisher:경남도민일보` is not the displayed link.

**Root.** `digest.js` `issueHeadline` coverage branch; Google unwrap is not a freeze gate for the lead URL. NH90.1: wrapper cannot lead when a direct member exists — here the direct URL was never stored on `eventSources`.

**Fix.** After P0-1, headlines are titles. Separately: if `operationalSourceIdentity` has a resolved publisher URL, `sourceLinks[0]` must be that URL (`editorial-source-identity` already used elsewhere). Fail freeze when selected `canonicalUrl` host is `news.google.com`.

**Verify.** 0 selected `eventSources[].canonicalUrl` host `news.google.com`. 0 served headlines with `관련 보도 묶음`.

### P1-4 · Operator cap is lifted to hit 14; gaming/fashion details are mostly dead

Gaming: gamemeca 5 + pcgamer 5; 12/14 `source_unavailable` (`NO_PUBLIC_BODY` 10, `PUBLIC_BODY_TOO_SHORT` 2). Fashion: hypebeast 4 + highsnobiety 4 + sneakernews 3 + fashionista 3; 10/14 unavailable (`TIMEOUT` 4, `ACCESS_DENIED` 6). Science: four operators × 3. `ignoreSourceCap: true` (`digest.js` ~935) is the fill.

NH90.1: operator shortfall is a receipt, not a filler. Unavailable is an honest terminal state — **not P0** — but a 14-card gaming lane with 2 readable bodies is not a product lane.

**Fix.** Stop the ignoreSourceCap loop for a lane once unique operators are exhausted *or* remaining candidates are deal/community-in-weighty-lane. If depth < 13 after that, fail the candidate. Do not call paid summarizers to paper over `NO_PUBLIC_BODY`.

**Verify.** Gaming selected: no ownershipGroup count > 2 until every eligible distinct group has 1. If that yields < 13, receipt `operator_shortfall` and candidate reject. Fashion same.

### P1-5 · Prepublish still is 14× briefing(); three-slot archive incomplete

`tools/build-slot-canonical-edition.mjs` `buildSlotCanonicalEditionCandidate` still calls `engine.todayEdition` → 14× `briefing()`. Pointer has lunch+evening only (`active.json` keys `2026-08-27:lunch|evening`). Native date input exists (`today.html` `#editionDate`); missing morning correctly 409s. `firstPublishedAt` is **not** stored on the issue; UI derives KST from `refs[].publishedAt` (acceptable for display, not the NH90 stored pair).

**Fix.** Do not rewrite a new allocator in this round. Gate: a candidate built via `briefing()` is allowed for plumbing, not for product GO, until lane allocation is a function that cannot call `ignoreSourceCap` or `legacy_classifier_fallback`. Morning file is a delivery P1, not a reason to keep the evening pointer if P0s remain.

**Verify.** `grep -n "this.briefing("` on the prepublish path is 0, *or* product GO is explicitly deferred. Pointer lists three keys for the civil date before claiming R3 done.

---

## What is not a P0 (do not reopen)

- 14×14, exact unions, no category-driven title/source/image mutation: holds on this file.
- Request-path LLM 0 / `filter_only`: holds. Pointer GET skips work *and* skips reader copy (P0-1).
- `excerpt_only` + `source_unavailable` as honest terminals: contract-ok. 57/196 is a concentration P1, not a lie.
- Exact date+slot no silent fallback: `makeSlotCanonicalEditionReader` throws `SLOT_CANONICAL_EDITION_UNAVAILABLE`. Native calendar exists.
- Foreign-major floors on this receipt: news 6/3, business 6/3, tech 7/2 (non-vacuous, unlike NH89 lunch `eligible:0`).
- Domestic mix vs NH89 lunch: news 9/14 vs 1/14, tech 7/14 vs 0/14 — improved, not a geo regression. Fashion/art 0 KR is registry supply.
- Paid Anthropic unavailable: do not make `ready` 600–900 a GO gate.
- `전체 필수`: deferred in NH90.1; absent here. Good.
- Plan-review P0s (joint allocator, midnight editionDate, unranked geo bands): this builder used lane-local `briefing()` + civil `editionDate` + bands-as-tilt. Those plan P0s are not reproduced as written. New P0s are copy, admission, and extraction.

## GO / HOLD

| Surface | Verdict | Why |
|---|---|---|
| Unit/integration tests (1728, diff check) | **GO** | They do not see P0-1/2/3. |
| Local plumbing of slot pointer | **GO** | Filter-only GET, unions, 409, no pending. |
| Local product candidate (`SCE-a5f8a18e3dc99bbf`) | **HOLD** | P0-1 served headlines; P0-2 운세/법률상담/딜/멸종; P0-3 identical HIT-board excerpts. |
| Live / staging / commit | **HOLD** | Separate approval. No morning slot. Anthropic still down. Ledger R1–R5 open. |

Do not activate a successor pointer until P0-1 is on the GET path (no rebuild needed) and P0-2/P0-3 have RED fixtures plus a candidate that does not contain the four named leads or the shared etoland body.

## Verification matrix (minimum)

| ID | RED now | GREEN |
|---|---|---|
| P0-1 | Pointer GET tech/news headlines match digest templates | `projectEditorialReaderCopy` on pointer; 0 jargon; test fixture without pre-baked `reader` |
| P0-2a | `lanes.tech` contains 오늘의 운세 (`81156c8e4a9b`) | That evidenceHash absent from all 14 lanes or withheld |
| P0-2b | `lanes.business` contains MarketWatch injury advice (`f4c075bad033`) | Absent from business |
| P0-2c | `lanes.humor` contains etoland deals + Nepal flood photo | Deals not in humor; flood photo not humor lead |
| P0-2d | `lanes.realestate` contains todayhumor 멸종 | No community lead in realestate |
| P0-2e | Receipt `legacy_classifier_fallback` on selected leads > 0 | 0 |
| P0-3 | Three humor cards share `오늘의 HIT 30` text | Unique bodies; chrome lines stripped; duplicate textKo fails validate |
| P1-2 | Two news eventIds both 네팔+홍수 | ≤1 news card |
| P1-3 | Selected Google host as lead | 0 `news.google.com` leads |
| P1-4 | Gaming one operator ≥5 | Cap 2 until unique pass done, else fail candidate |

## Prior reviews (do not treat as this verdict)

- Grok plan review: `docs/reports/NOWHOT_NH90_INDEPENDENT_ADVERSARIAL_REVIEW_2026-08-27.md` (HOLD on the *spec*).
- Claude Fable plan review: `/tmp/claude-501/.../NH90_READONLY_REVIEW_FABLE_2026-08-27.md` (P1s on asOf/window/allocator inputs).
- NH90.1 folded those into the blueprint. Implementation reused `briefing()` + legacy recovery, which reopened reader copy, admission, and extraction instead of the old asOf P0s.
