# NOWHOT D0 — Freeze Truth (2026-08-18)

- report_id: `NOWHOT-D0-FREEZE-TRUTH-20260818-001`
- role for this D0 only: implementer = Claude Code (`claude-opus-4-8`); reviewer/approver = Codex
- status: `READY_FOR_CODEX_REVIEW`
- canonical spec: `WRC_MANUS_HANDOFF/system/reports/NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md`
- canonical spec SHA-256: `1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5` (verified match)

## 1. Scope

D0 = freeze truth. Schema, invariants, counterexamples, and failure states are frozen in code and
tests so the future semantic admission engine cannot be built in the wrong direction. **No LLM call,
no ranking change, no UI change, no real serving connection.** Runtime is not wired.

## 2. Baseline (start of D0)

- branch: `codex/adfit-content-rescue-20260810`
- HEAD: `71df328598f9d77ff2e2f05d895be6d8faea638d`
- 32 commits ahead of `origin/main`
- dirty: tracked modified 30, untracked 70 — identical to the spec's expected baseline
- dirty manifest hash (git status --porcelain=v1 | sha256): `b3725edf6a410a4ec6c02c40cb2372982688eff6b7a50553e71d182fd0da49b3`
- no `git reset/clean/stash/checkout`; the dirty tree is preserved as user asset.

## 3. New files

| file | purpose |
|---|---|
| `src/feed/selection-contract.js` | pure functions/constants: admission schema validator, release invariant `exposureViolations`/`admissionInvariantHolds`, `claimOriginGroup` independence, event-location `resolveScopeClass`, evidence precedence, degraded failure states, contentType gate. `runtimeWired: false`. |
| `test/selection-contract.test.js` | 27 unit tests + 28 frozen counterexamples driven from the fixture |
| `test/fixtures/selection-d0-counterexamples.json` | 28 counterexamples (14 required + Codex 3-round re-review 14); API/browser marked `RUNTIME_NOT_WIRED`
| `test/fixtures/selection-baseline.lock.json` | frozen baseline lock (Codex fix #7); `--check` exits 1 on fingerprint/contract-version/spec-SHA drift |
| `tools/freeze-selection-baseline.mjs` | deterministic baseline: HEAD/branch/spec-SHA, taxonomy + legacy classifier + category-policy + shadow-params + event-cluster + source-registry + source-identity fingerprints, globalMustKnow runtime search, known limitations, co-gate registration. Read-only; changes no source/serving data. |
| `docs/reports/NOWHOT_D0_FREEZE_TRUTH_2026-08-18.md` | this report |

## 4. Minimal doc edits

- `docs/01_NOWHOT_SYSTEM_BLUEPRINT.md`: append-only supersede (5 items) — no automatic unselected
  mix; accept-only admission + zero-leak invariant; source country vs event geography; source vs
  claim independence; D0 is contract freeze not runtime.
- `docs/NOWHOT_DEVELOPMENT_STATUS.md`: one line `DEVCHG-NOWHOT-20260818-110`.

## 5. Contract locked (spec map)

- **Release invariant** (§5): `count(exposed items with no accepted admission row matching a
  selected category) == 0` → `exposureViolations` / `admissionInvariantHolds`.
- **Secondary never admits** (§5): `descriptiveSecondaryCategories` is validated but never used by
  `admittedCategories` / `isAdmittedTo`. Only `accept` rows admit.
- **Canonical evidence precedence** (four decisions #1): `precedenceRespected` — a later stage pass
  after an earlier fail is a violation (no resurrection).
- **Multi-category single display** (#2): `selectedByCategories` records all matched accepted
  categories; fixture case 3 fixes display-once/fulfillment-once.
- **Cold/empty cache** (#3): `degradedState` — no low-precision keyword fallback; Today `업데이트 준비 중`,
  Live `업데이트 지연`/preparing; unclassified withheld.
- **Shared primary facts / claim independence** (#4, §6-D): `sharedFactQualifies` requires
  primary/first-party or ≥2 distinct `claimOriginGroup`, separate from legacy `operatorGroup`.
- **Event location** (§5, counterexamples 6-10): `resolveScopeClass` uses event jurisdiction, not
  source nationality; insufficient evidence → `unknown`; `overseasWeightAllowed` blocks weight on
  domestic/unknown.
- **contentType hard gate** (§9 gate 7): `isNewsTrustEligible` (news only),
  `contentTypeConfusionIsCritical` (community→news, deal→news).
- **Co-gates registered before tuning** (§9 gate 4/6): recall / qualified-supply / abstain
  registered in the baseline as `registered_pending_measurement` (values are locked in D1).

## 6. globalMustKnow runtime search result (honest)

`globalMustKnow` appears only as a lane/policy definition in `src/feed/product-blueprint.js`
(2 occurrences) and an admin display string. It is **not** wired as an automatic ordinary-feed
insertion function. `personalizationPolicy.automaticUnselectedMixShare = 0`. The actual runtime
unselected-category injection is `src/feed/taste-share.js` (the `k>0` taste-injection loop that
excludes the first slot) — this is the runtime cause of "관심없는 분야만 뜬다" and is recorded as a
known item; **D0 does not change it** (runtime unchanged).

## 7. Known limitations frozen (not fixed in D0)

1. `overseas-by-source-country`: `allMembersOverseas` judges overseas by source country, not event
   location. The new `resolveScopeClass` is event-based but not wired until D2+.
2. `operator-group-not-claim-independence`: `operationalSourceIdentity` falls back to source-id as
   group, so two outlets reprinting one press release can count as "2 independent." New
   `claimOriginGroup` separates claim origin; legacy `independentReportingGroups` meaning unchanged.

## 8. Tests run and result

Order per spec §8: (1) new targeted, (2) shadow category-union tests, (3) build-editions/local
editorial targeted, (4) `git diff --check`, (5) full `npm test` once. See the terminal receipt in
the delivery message.

## 9. Truth separation

- code truth: `CONTRACT_READY` — pure functions + invariant verifier exist and pass unit tests.
- baseline truth: `LEGACY_BASELINE_FROZEN` — deterministic baseline recorded.
- runtime truth: `RUNTIME_NOT_WIRED` — no ranking/serving/UI connection; API/browser fixtures are
  registered targets, not passing tests. No false PASS.
- product truth: `PRODUCT_NOT_PROVEN`.
- live truth: `LIVE_UNCHANGED` — no commit/push/deploy/server action.

## 10. Not done (out of D0 scope)

D1 classifier, D2 shadow wiring, D3 rankers, D5 UI. No LLM/network. No runtime connection of the
contract. No overwrite of any change not authored here. No commit/push/deploy.



## 11. Codex D0 HOLD 수리 (2026-08-18)

Codex 검수 HOLD의 10개 최소 수리를 반영했다. CONTRACT_READY·LEGACY_BASELINE_FROZEN
주장은 이 수리 이후에만 유지된다.

1. 단일 canonical gate `admissionGate` — 스키마 통과 분류만 admission 가능.
   `admittedCategories`/`isAdmittedTo`/`exposureViolations` 전부 이 게이트 경유.
2. `contentType=other`·`primaryCategory=unknown`·중복/충돌 행은 accept가 있어도
   비승인(gate가 각각 content_type_other/primary_unknown/schema_invalid로 차단).
3. accept 행은 비어 있지 않은 evidenceSpans·reasonCodes 요구(스키마).
4. 지역성(sourceCountry·language·eventJurisdictions·relevanceCountries·scopeClass·
   geoConfidence·geoEvidenceSpans)·근거 기원(operatorGroup·originDocumentId·
   claimOriginGroup) 필수 필드를 스키마 validator에 포함.
5. `precedenceRespected` — 모든 단계·상태 enum 요구, 앞단 fail 뒤 fail 외(pass·
   narrow) 결과 금지.
6. `degradedState` — unclassified는 정상·장애 모두 항상 withheld.
7. `test/fixtures/selection-baseline.lock.json` 고정 저장 + `freeze-selection-baseline.mjs
   --check`가 drift 시 exit 1(지문·taxonomy·계약 버전만 잠금; HEAD·dirty는 잠그지 않음).
8. `assembleUnion`(display-once/fulfillment-once)·`resolveEventEditorial`(unsupported-
   claim withheld)를 순수 함수로 구현하고 반례 3·12가 그 함수를 검증.
9. 기존 테스트 유지 + Codex 반례 15~20 추가(other/unknown 비승인·빈 spans·필수
   누락·fail후 narrow·정상상태 withheld).

수리 후 결과(2차 재검수 반영): 계약 단위 24/24, 전체 npm test는 배송 영수증 참조. 상태는 여전히
RUNTIME_NOT_WIRED·PRODUCT_NOT_PROVEN·LIVE_UNCHANGED.




## 12. Codex 2차 재검수 HOLD 수리 (2026-08-18)

1. [P1] baseline lock이 계약 v2를 실제로 잠근다: semanticContractVersion을 코드에서
   읽어 v2로, `selection-contract.js` 파일 지문을 fingerprints에 포함, 정본의
   **실제 SHA**(actual==expected) 일치를 lock에 담아 내용 변조도 drift로 잡는다.
2. [P1] fulfillment 이중 적립 수리: assembleUnion은 사건당 **최대 1 카테고리
   크레딧**(정본 editorial-fulfillment maxSelectedCategoryCreditsPerIssue:1). 배치·
   크레딧 카테고리는 earliest rank layer→score→안정 taxonomy ID. 분류 행 분리 시
   카테고리 병합, id 없으면 evidenceHash로 중복 표시 방지.
3. [P1] fail-open 봉쇄: 공백 관할/빈 geoEvidenceSpans/scopeClass 불일치 스키마
   reject, primary 근거는 claimOriginGroup 필요, 뉴스 신뢰는 스키마 통과 요구.
반례 21~25 추가. 계약 단위 24/24.



## 13. Codex 3차 재검수 HOLD 수리 (2026-08-18) — assembleUnion 분리

3차 재검수의 핵심: 화면 배치와 fulfillment 배정 혼동 + rank-layer 미적용 + 공백 id 병합.

1. [P1] `assembleUnion`은 **표시(display)만** 담당한다 — 중복 제거·selectedByCategories·
   사건별 rank(byCategory tier·S) 병합·실제 정렬. fulfillment 크레딧을 배정하지 않는다.
2. [P1] fulfillment는 복제하지 않고 `fulfillmentFromDisplay`가 기존
   `editorial-fulfillment.buildEditorialFulfillment`(scarcity-first maximum matching)를
   정확히 한 번 적용한다. 반례 26: A(biz+pol)·B(biz)·분야당 1 → business 1·politics 1
   (부족 분야 우선). 배치 카테고리 크레딧이 아니다.
3. [P1] rank-layer 정렬을 실제 적용 — 입력 순서가 아니라 (tier asc, S desc, taxonomy,
   key)로 display를 정렬한다. byCategory는 shadowSelectBriefing(947)의 사건별 tier·S를
   그대로 받아 새 알고리즘을 만들지 않는다. 반례 27: 늦게 입력된 politics(tier2)보다
   이른 business(tier1)가 앞.
4. [P2] 사건 ID는 공백 제거 후 비면 evidenceHash 폴백, 둘 다 없으면 withheld.
   공백 id가 서로 다른 evidenceHash 사건을 합치지 않는다(반례 28).

계약 파일 지문 변경에 따라 baseline lock 재기록. 계약 단위 27/27, 전체 1,370/1,370.

First Principles gate: PASS



## 14. D0 FINAL CLOSURE 정정 (2026-08-18) — F1·F2·R1·I1 인수 계약 완결

명령 "NOWHOT D0 FINAL CLOSURE"의 4개 인수 계약을 RED→GREEN으로 완결했다. 이전
기록(§11~§13)은 삭제하지 않고 유지하며, 이 절이 최신이다.

- **F1 (전체 결합·scarcity-first):** `assembleUnion`의 `display`를 그대로
  `fulfillmentFromDisplay`에 전달 → A(biz+pol)·B(biz)·분야당 1 → business 1·politics 1.
  사건당 최대 1 크레딧(issueCount 합 == display 길이). 최종 반환 전체(state
  `fulfillment_complete`·goalSatisfied·metCount 2·selectedCount 2·uniqueCreditedIssueCount 2·
  missing/noQualified/underfilled 빈 배열)를 검사한다.
- **F2 (입력 진실성):** `fulfillmentFromDisplay`는 candidateCounts·qualificationRows·
  availableCategories·minimumIssuesPerCategory를 기존 `buildEditorialFulfillment`에 그대로
  전달한다. 선택 분야마다 candidateCounts own-property 또는 availableCategories 공급행이
  필수이고, 누락·음수·NaN·비수치는 fail-closed `TypeError`. 명시적 0은 정상 `no_supply`,
  candidateCount>0 + qualifiedClusterCount=0은 `no_qualified_supply`. 후보 수를 display에서
  추정하지 않는다.
- **R1 (rank metadata 계약):** tier는 1 이상 정수, S는 0..1 유한수. 누락·무효는 taxonomy/0
  폴백 없이 사건 전체 `missing_or_invalid_rank_metadata` withheld(key/id·실패 category 기록).
  사건별 tier=min·S=max, display 정렬 (tier asc, S desc, 안정 taxonomy, key) — 입력 역순·
  셔플에도 동일.
- **I1 (사건 ID namespace):** 유효 id → `id:<x>`, 없거나 공백 → `eh:<hash>`. 두 namespace는
  절대 섞이지 않는다(id=`same`·hash=`same` → 2장). 객체·배열 id는 evidenceHash 폴백, 둘 다
  없으면 withheld. 입력 순서 무관.

RED 확인(현재 코드): F1 candidateCount 0(no_supply), F2 TypeError 미발생, R1 무효행 폴백
표시, I1 namespace 충돌 병합 — 전부 예상 이유. 예상 일치 후 최소 구현으로 GREEN.

기존 반례 3·25·26·28에 유효 byCategory/candidateCounts를 실제 입력으로 추가했다(폴백으로
통과시키지 않음). baseline lock은 계약 파일 지문(`fingerprints.selectionContract`) 하나만
변경되어 `--write` 1회 재기록(다른 지문·semanticContractVersion v2·정본 실제 SHA 불변,
canonicalSpecMatches=true).

결과(실측): 계약 단위 **31건** + 동결 반례 **32건**. contract+editorial-fulfillment 39/39,
shadow+build+local 100/100, 전체 `npm test` **1,374/1,374**(skip·todo·cancel 0). `git diff
--check` 통과. 허용목록 밖 dirty 파일 바이트 불변.

truth 분리 불변: 코드 `CONTRACT_READY` / 기준선 `LEGACY_BASELINE_FROZEN`(v2) / 런타임
`RUNTIME_NOT_WIRED` / 제품 `PRODUCT_NOT_PROVEN` / 라이브 `LIVE_UNCHANGED`. 상태는
`READY_FOR_CODEX_REVIEW` — Codex 재검수 전 `CONTRACT_READY` 최종 확정 금지.

First Principles gate: PASS
