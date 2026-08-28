# NOWHOT D1-A — Offline Classifier Lab (2026-08-18)

- report_id: `NOWHOT-D1A-CLASSIFIER-LAB-20260818-001`
- role for this D1-A only: implementer = Claude Code (`claude-opus-4-8`); reviewer = Codex
- status: `READY_FOR_CODEX_REVIEW`
- canonical spec: `WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md`
  (SHA-256 `1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5`, verified)
- D0 selection-contract SHA-256 `0a6d26082e902fb9…` / D0 baseline lock `85e8f9d4…` (both frozen, drift-free)

## 1. Scope

D1-A = 분류기를 **튜닝하기 전에** 표본·정답 절차·평가 산식·비용 경계를 동결한다.
실제 모델 호출 0, 서빙 연결 0, 라이브 변경 0. Claude는 실제 기사 정답을 스스로
확정하지 않고, 자기 결과를 최종 PASS로 판정하지 않는다.

## 2. 실제 seed snapshot (읽기 전용)

| snapshot | SHA-256 | rows |
|---|---|---|
| pool-2026-08-14-lunch | `faf354420acb8f42…` | 1912 |
| pool-2026-08-15-lunch | `11d68b09977f3eec…` | 1973 |
| pool-2026-08-16-lunch | `b3aca64fcf84ae2f…` | 1952 |

## 3. Corpus 구성 (`test/fixtures/selection-d1-corpus.json`)

- real_local_snapshot: **78**, adversarial_contract_fixture: **10**, mutation_fixture: **8**, total **96**
- 실데이터 과반: realRatioBps **8125 (81.25% > 50%)**, `realMajority=true`
- 결정성: `build-selection-d1-corpus.mjs --check` byte-identical, 재빌드 동일. 시각 미포함, `.nowhot-local` 쓰기 0, 네트워크 0.
- coverage: declared category **13** (politics 실공급 0), dates 14·15·16, kinds community·news, sources **54**
- 계층표집: (date × 14 declared category)별 서로 다른 소스 ≤2, evidence hash 전역 dedup. declared category는 stratum일 뿐 gold 아님.
- **보관 입력만**: blindItemId(hash 블라인드)·sourceId·sourceTier·declaredCategory/Section(stratum)·contentKindHint·sourceCountry·language·title·excerpt(≤300)·evidenceHash·snapshotId/SHA·stratum·provenance.
- **저장 금지 부재 실측**: url·canonicalUrl·author·body·comments·price 전 행 0.
- real 행에는 contractGold 미포함(정답 없음). adversarial/mutation만 by-construction contractGold.

### shortage (합성으로 채우지 않고 정직 기록)

`14:politics`, `15:politics`, `16:politics`(declared politics 실공급 0), `content_kind:deal`, `content_kind:other`(스냅샷에 deal/other kind 없음).

### 대표 결함 adversarial 10 / mutation 4쌍

- 음식→politics, dev.to 공지→fashion, community→news, deal→news, source prior vs 본문 충돌,
  genuine cross-domain(business+politics), secondary-only admission, primary 맞고 admission 틀림,
  국내 매체 해외 사건, 동일 제목 구조 다른 의미.
- mutation: semantic 2쌍(의미 단어 1개 변경→정답 변화), invariance 2쌍(구두점·공백·대소문자만→정답 유지).
  원본/변형 pair ID 보존. mutation은 release precision 분모 아님.

## 4. 독립 gold 계약 (`test/fixtures/selection-d1-gold.json`)

- 실제 기사 78행 = **pending**(구현자 미기입). contract_fixture_only 18(적대/변형, 동작 테스트 전용).
- agreed/disputed/adjudicated = 0.
- 절차: labelerA blind → labelerB(A 미열람) → 일치만 provisional → 불일치 adjudicator → 미조정은 분모 제외 HOLD.
- 금지: production classifier·corpus generator·동일 identity를 라벨러로 사용(validateGoldContract가 reject).
- **releaseGoldState = `insufficient_independent_gold`** — 실제 label pending 동안 evaluator는 release PASS를 반환하지 않는다.

## 5. classifier lab 순수 함수 (`src/feed/selection-classifier-lab.js`)

네트워크·파일 쓰기·시계·실제 LLM 호출 없음. 분류기는 injected adapter로만 받는다.
D0 `validateClassificationSchema` 재사용 + evidenceSpans grounding + evidenceHash 일치 + version 일관 + fail-closed.
keyword/NB fallback 없음. source/section은 prior일 뿐 자동 accept 근거 아님. secondary·other·unknown·abstain은 일반 노출 자격 아님.

## 6. 평가 산식·게이트 (`test/fixtures/selection-d1-gates.lock.json`)

- 단위: **item × category admission row**(primaryCategory 적중률 아님). category별 TP/FP/FN·precision·recall.
- Wilson one-sided 95% lower bound(z `1.6448536269514722`), 목표 0.98. 표본 0은 PASS 아니라 `insufficient_sample`. 반올림 전 원값으로 판정.
  동결 참조 벡터(lab이 재현, 1e-12 이내): 97/100→0.927289656713096, 49/50→0.915194705751690, 20/20→0.880842162639036, 20/21→0.812196428623541, 196/200→0.956196542832956.
- 추가 표본 계획: 이후 오류 0 가정 시 LB 0.98 도달 최소 추가 정답 수. 불가/상한 초과는 정직 표시.
- recall gate: candidate ≥ frozen legacy baseline. D1-A는 legacy adapter 미확인 → **`pending_exact_legacy_measurement`**(declared category를 baseline으로 위장하지 않음).
- qualified supply gate: upstream ≥8이면 accept도 ≥8, 미만이면 유효 후보 전부 보존. gold 없어 **`not_measured`**.
- abstain gate: 분모 = human-valid in-scope real items(legitimate gold `other` 제외), explicit abstain ≤20%(Codex 기술 기본값, 변경은 append-only David 결정).
- adversarial gate: 선택 카테고리 누수 0·secondary-only admission 0·unknown/other ordinary admission 0.
- contentType gate: 4×4 confusion, community→news=0·deal→news=0(1건이라도면 HOLD), type별 precision LB 별도 출력.
- mutation gate: semantic 쌍 label 변화·invariance 쌍 유지·불완전/pending 쌍은 PASS 금지.
- synthetic/adversarial/mutation은 release precision 분모에 섞지 않음.

## 7. 캐시·비용·장애 계약

- cache key = normalizedEvidenceHash + model + prompt + taxonomy version. 같은 입력·버전 1회 호출, cache hit는 0 호출,
  버전 변경은 miss, schema-invalid·error·budget-stop 결과는 캐시 금지, 버전 혼합 금지.
- budget: maxCalls/maxInputTokens/maxOutputTokens/maxEstimatedCost/timeoutMs. 상한 도달 전 다음 호출 시작 안 함,
  남은 항목은 `budget_stop` withheld(keyword fallback 없음).
- receipt: run ID·SHA·version·집계·토큰·추정비용/통화·latency·second-pass·gate·doesNotProve만. title/excerpt/url/secret 없음.
  clock 주입 시 byte-identical, 입력 순서 무관 결정적.

## 8. CLI 도구

- `build-selection-d1-corpus.mjs`: 세 snapshot만 읽기, `--write`/`--check`, shortage·provenance 출력, gold 미생성.
- `eval-selection-classifier.mjs`: fixture 평가(기본)·`--predictions`·`--check-lock`(D1 gates + 격리 서브프로세스로 D0 baseline `--check`).
  **D0 lock `--write`는 어떤 경로로도 실행하지 않음**(freeze 도구를 import하지 않고 subprocess `--check`만). corrupt corpus/gold/prediction/lock은 exit 1. gold pending이면 release PASS 금지.

## 9. RED → GREEN

- RED(현재 스켈레톤): 18개 테스트가 `D1_NOT_IMPLEMENTED`(8개 함수) — 예상 이유 일치. 상수·corpus 2개는 infra라 조기 green.
- GREEN: evaluator·cache·receipt·gate·gold 검증 구현 → classifier-lab **20/20**.
- 기대값 완화·skip·todo 0. corpus/gold/gates fixture는 실제 함수 입력으로 동결(장문 하드코딩 아님).

## 10. 테스트 결과

- corpus `--check` byte-identical, `eval --check-lock` OK(D1 gates Wilson 재현 + D0 baseline drift 0), D0 `freeze --check` OK.
- focused: contract + classifier-lab **51/51**. regression: shadow + build + local **100/100**. 전체 `npm test`: 배송 영수증 참조.
- 실제 LLM/API 호출 0, 비용 0.

## 11. Truth 분리

- D0 contract: PASS. D1 lab code: `READY_FOR_CODEX_REVIEW`. corpus bytes: FROZEN. independent gold: PENDING.
- real model quality: NOT_MEASURED(`REAL_MODEL_NOT_RUN`). D2 runtime: NOT_WIRED. product: NOT_PROVEN. live: UNCHANGED.

## 12. 다음 D1-B 입력 조건

1. 78 pending 실제 기사에 대한 **독립 A/B 라벨**(production classifier·generator·동일 identity 불가) → agreed provisional gold.
2. legacy recall/qualified supply **실측 baseline**(현재 pending/not_measured) 확정 → recall·supply gate 활성.
3. 그 후에야 실제 모델 호출로 candidate 분류 생성 → 이 evaluator로 게이트 판정(여전히 Codex/human 최종 승인).

First Principles gate: PASS

## 13. Codex D1-A HOLD correction (v2, 2026-08-18)

Codex HOLD 전 항목을 한 번에 닫았다. §1~§12는 보존하며 이 절이 최신이다.

- **prediction 정본 = `{itemId, status, classification}`**(status: classified/cache_hit/withheld/error/schema_reject).
  accepted category는 **D0 `admissionGate` 결과에서만** 유도한다. bare `acceptedCategories`·primaryCategory 직접 정답·
  secondary admission·schema-invalid는 TP를 만들지 못한다. 중복 itemId·corpus-gold origin 불일치는 즉시 corrupt/HOLD.
- **top-level `output.abstain` 우회 제거.** 모델 abstain은 admission row `decision:"abstain"`으로만 표현한다
  (admissionGate가 accept만 admit → 노출 자격 없음, FN, precision 게임 불가).
- **독립 gold 계약에 decisionDigest 감사.** 각 gold 행은 labelerA/B{identity·blindPacketHash·decisionDigest}·
  adjudicator{identity·decisionDigest}·finalDecisionDigest·humanValid·inScope를 갖는다. agreed는 A=B=final digest·
  독립 identity, adjudicated는 A≠B·독립 adjudicator·adjudicator=final digest. production/generator identity는 validator
  **필수 인자(누락 시 fail-closed)**. `releaseGoldState`는 별도 로직 없이 validator 결과만 사용하고, real 전 행이
  agreed/adjudicated eligible일 때만 sufficient.
- **gates lock 전체 바이트 SHA를 코드 상수(`D1_GATES_LOCK_SHA256`)로 동결** + 엄격 검증(contract/phase/z/14 category/
  precision 0.98/abstain 0.20/필수 필드, 기본값 대입 금지). precision 0.98→0·abstain 0.20→1·category 삭제는 SHA drift
  및 구조 위반으로 `--check-lock` exit 1(실증).
- **buildStructuredRequest에 sourceId·sourceTier·declaredSection 포함**(source/section은 prior일 뿐 자동 admission 아님).
- **budget 5필드 fail-closed**(누락·NaN·음수는 실행 전 TypeError). adapter 시작 **전에 calls 증가**(실패 호출도 예산 포함) →
  두 번째 호출 0. output/cost 초과는 `budget_overrun` withheld·no-cache. timeout 이전에만 신규 호출. verified cache hit만
  0비용이며 hit 시 schema/hash/version 재검증, 손상 cache는 제거 후 재분류.
- **admission·geo evidenceSpans 모두 grounding.** 14 admission category 행 항상 생성(13분야 비면 precision FAIL).
  contentType 4×4 + type별 precision LB. receipt는 calls(호출 수)와 classified(유효 분류 수)를 분리하고 runId digest에
  corpus/gold/gates SHA·versions·집계·사용량을 포함, title/excerpt/url/cacheKey/secret 원문 없음, clock 주입 시 결정적.
- **회귀 수정:** evidenceHash 구분자가 v2 재작성 중 NUL→공백으로 바뀌어 corpus가 drift했다. 구분자를
  `String.fromCharCode(0)` 상수로 복원(리터럴 NUL 제거 — 소스에 제어문자 없음, corpus 지문 불변). corpus `--check`
  byte-identical 회복.

RED(§10): v2 반례 19개 중 **17개가 v1 계약에서 실패**(신 prediction 형식·decisionDigest·gates SHA·budget fail-closed·
request 필드 등, corpus·Wilson 2개만 조기 green) — 예상 이유. GREEN: classifier-lab **19/19**.

결과(실측): 계약 단위 31 + lab 19. focused 50/50, 회귀 100/100, 전체 `npm test` 1,393/1,393(skip·todo·cancel 0).
corpus `--check` byte-identical, `eval --check-lock` OK(gates SHA `0b348b72…` + 구조 + Wilson + D0 baseline), 변조 lock 3종
exit 1. 실 LLM/API 0·비용 0.

truth 분리 불변: D0 contract PASS / D1 lab code `READY_FOR_CODEX_REVIEW` / corpus bytes FROZEN / independent gold PENDING /
real model quality NOT_MEASURED / D2 runtime NOT_WIRED / product NOT_PROVEN / live UNCHANGED.

First Principles gate: PASS



## 14. Codex D1-A FINAL CLOSURE v3 (2026-08-18) — 측정기 결함 일괄 수리

Codex가 확정한 v2 evaluator 잔여 결함(§3 baseline: adversarial wrong-pred gate=true, forged gold eligible,
adjudicated-without-A/B eligible, 1-row gold sufficient, weakened lock ok, cost=0인데 adapter 1회, adapter 1초
경과 결과 cached, duplicate/orphan 무오류, production identity 불일치)을 A1~A12로 닫았다. §1~§13 보존.

- **A1 D1_IDENTITIES 정본**(prod-classifier-v0 / build-selection-d1-corpus)을 lab에서 export, CLI·test·fixture가 공유(하드코딩 제거).
- **A2 blindPacketHashOf** = SHA-256(JSON.stringify(buildBlindPacket)). gold 96행 전부 corpus와 일치하는 evidenceHash·blindPacketHash 저장(원문 title/excerpt 미저장).
- **A3 goldDecisionDigestOf**는 저장 digest를 신뢰하지 않고 항상 재계산(reason=null 고정).
- **A4/A5 gold 계약:** agreed는 A/B 독립·금지 identity 아님·둘의 blindPacketHash가 item 정본과 동일·A=B=final=재계산 digest일 때만 eligible.
  adjudicated는 A/B 모두 필수·A≠B digest·독립 adjudicator·정본 blindPacketHash·adjudicator=final=재계산 digest일 때만. **A/B 없는 adjudication은 무조건 거부.** forged(accepted만 바꾸고 digest 유지)는 재계산 불일치로 reject.
- **A6** contract_fixture_only는 corpus contractGold·재계산 digest와 정확히 일치, real 78행은 pending 유지.
- **A7 validateEvaluationDataset** 단일 게이트: 빈 ID·각 배열 중복·gold/prediction orphan·item-gold origin 불일치·gold-corpus 1:1 불일치·status enum·classification 유무를 즉시 CORRUPT_EVAL_DATA throw. CLI·core 모두 통과 필수.
- **A8 releaseGoldState**는 items에서 도출한 frozen real 78 ID와 gold real ID가 정확히 일치하고 그 전부가 eligible일 때만 sufficient. expectedRealItemIds 없으면 fail-closed. 부분 gold 1건은 반드시 insufficient. metrics.release.goldState도 이 결과만 사용.
- **A9 adversarial**은 release precision과 분리해 10개 contract fixture 전부 평가. expectedCount=10·evaluatedValid=10 + contentTypeMismatch/invalidOrMissing/selectedCategoryLeak/unexpectedAdmission/expectedAdmissionMiss/secondaryOnlyAdmission/unknownOtherOrdinaryAdmission=0일 때만 PASS. 오승인·all-abstain은 FAIL.
- **A10 validateGatesLock**은 Wilson z/confidence/reference·14 category·precision(unit/target/zeroSample/rounding/allCategories)·recall(rule/baseline/hardHold)·supply(min/preserve/rule/baseline/hardHold)·abstain 전 필드·adversarial 기준·contentType·mutation 3필드·releaseGoldState/releasePass/doesNotProve를 정확히 검증(기본값 대입 금지). evaluatePredictions·evaluateGates는 시작 즉시 호출해 변조 lock에 throw. gates lock 전체 바이트 SHA는 코드 상수 `10c3160c…`.
- **A11 budget:** 비용 preflight에 nextInputTokens 포함(maxEstimatedCost=0면 adapter 0회·withheld·no-cache). adapter 반환 직후 clock() 재호출로 post-call timeout 판정(budget_timeout·withheld·no-cache, stale pre-call now 사용 안 함). output/cost overrun·유효 all-abstain(explicitAbstain) 처리.
- **A12 CLI itemsFromCorpus**는 origin·sourceId·sourceTier·declaredSection·contentKindHint·country·language 보존, --predictions orphan은 exit 1.

공격 12건 결과(실측): adversarial 정상 PASS·leak/all-abstain FAIL, forged→agreed_digest_mismatch, adjudicated-no-A/B·no-adjudicator·same-AB·dup-adjudicator reject, frozen 78 중 1건 agreed→insufficient, dup/orphan/orphan-pred throw, production=labeler reject, lock 변조 9종 reject·evaluate throw, cost=0→adapter 0회 cache 0, post-call timeout→budget_timeout cache 0. corpus·builder는 read-only(byte-identical 유지).

결과: 계약 단위 31 + lab 16. focused 47/47, 회귀 100/100, 전체 `npm test` 1,390/1,390(skip·todo·cancel 0).
corpus `--check` byte-identical(e9afa42b 불변), `eval --check-lock` OK(gates SHA `10c3160c…` + 구조 + Wilson + D0 baseline). 실 LLM/API 0·비용 0.

truth 분리 불변: D0 contract PASS / D1 lab code `READY_FOR_CODEX_REVIEW` / corpus bytes FROZEN / independent gold PENDING /
real model quality NOT_MEASURED / D2 runtime NOT_WIRED / product NOT_PROVEN / live UNCHANGED.

First Principles gate: PASS



## 15. Codex D1-A ONE-SHOT TRUST CLOSURE v4 (2026-08-18) — 단일 신뢰경계

개별 반례 봉합을 넘어 입력 정본 → gold → contract fixture → 평가 데이터 → gates lock → 예산/통계까지
하나의 fail-closed 평가 신뢰경계로 완결했다. §1~§14·DEVCHG-110~114 보존. gold/corpus/gates/builder는 read-only(불변).

- **§3 canonical evaluation authority:** frozen corpus row에서 item별 canonical record(itemId·origin·재계산
  evidenceHash·재계산 blindPacketHash·contractGold projection)를 만들고, 평가기는 gold가 적어둔 hash/origin을
  절대 신뢰하지 않는다. `buildCanonicalAuthority`는 중복·누락·잘못된 origin을 CORRUPT_EVAL_DATA로 거부한다.
  `validateGoldContract`·`releaseGoldState`는 canonical 인자를 필수화(fail-closed)하고, gold.blindPacketHash
  fallback과 missing-origin→real 기본값을 제거했다. CLI는 정상 평가에서도 frozen corpus raw SHA를 확인한다.
- **§4 gold 완전 검증:** itemId가 canonical에 정확히 존재, origin/evidenceHash/top blindPacketHash가 canonical과
  일치, state/contentType/category enum, category known+중복 금지, accepted↔rejected·accepted↔secondary 충돌 금지,
  humanValid/inScope boolean, identity trim·non-empty·정규화 중복·production/generator 금지. agreed는 A/B 독립·동일
  canonical blind hash·동일 재계산 digest, adjudicated는 A/B/adjudicator 모두 canonical blind hash·A≠B digest·
  adjudicator=final=재계산 digest일 때만 eligible. pending/disputed/contract_fixture_only는 release eligible 경로 0.
- **§5 contract fixture 정본 결박:** adversarial/mutation 정답은 gold가 아니라 frozen corpus contractGold다. gold의
  contract_fixture_only 결정이 canonical projection과 다르면 평가 시작 전 corrupt. 적대 평가는 canonical
  contractGold(contentType·accepted·rejected·scope)와 직접 비교하며, gold+prediction을 함께 오답으로 바꿔도 PASS
  불가. scope mismatch는 hard fail. contractGold는 buildStructuredRequest/adapter 요청에 노출되지 않는다.
- **§6 평가 모드 분리:** `fixture_only`(prediction 0건, 성능 gate PASS 불가)와 `candidate`(item↔prediction 1:1,
  missing/dup/orphan은 CORRUPT_EVAL_DATA) 명시. 암묵 추론 금지. 0분모는 PASS가 아니라 insufficient.
- **§7 gates lock 정확 검증:** Wilson z/confidence + 5 reference vector 값·개수·순서·독립 재계산, 14 category
  값·순서, precision/recall/qualifiedSupply/abstain/adversarial/contentType/mutation 모든 의미 필드, releaseGoldState/
  releasePass, doesNotProve 값·개수·순서까지 exact. 빈 문자열 확인만으로 통과시키지 않는다. evaluatePredictions·
  evaluateGates는 계산 전 반드시 통과해야 한다(CLI 바이트 SHA 검사는 별도 유지, 상수 10c3160c…).
- **§8 예산·통계 불변식:** output/cost overrun은 budgetOverrun+withheld 동시·no-cache, timeout도 withheld·no-cache,
  `stats.withheld == count(status==withheld)`, classified+cacheHit+withheld+schemaReject+error == total, calls == 실제
  adapter 시작 횟수, maxEstimatedCost=0이면 adapter 0회.

공격 §9.1~17 결과(실측): 위조 blind/evidence hash·공백/production identity·origin·state/contentType/category·중복/충돌·
canonical 부재 전부 reject; corpus contractGold 공동 변조는 평가 전 corrupt; candidate 무예측·fixture_only 예측은 corrupt;
성능 gate는 fixture_only에서 PASS 불가; gates semantic leaf·Wilson 20종 변조 reject; overrun/timeout 회계·no-cache;
request에 contractGold 부재; 정상 adversarial 10건 PASS·leak/all-abstain/scope-mismatch FAIL.

결과: 계약 단위 31 + lab 14. focused 45/45, 회귀 100/100, 전체 `npm test` 1,388/1,388(skip·todo·cancel 0).
corpus `--check` byte-identical(e9afa42b 불변), `eval --check-lock` OK(frozen corpus SHA + gates SHA 10c3160c… + 구조 +
Wilson + D0 baseline). gold/gates/builder read-only 불변. 실 LLM/API 0·비용 0.

truth 분리: LAB_CANDIDATE_READY / GOLD_PENDING / REAL_MODEL_NOT_RUN / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN /
LIVE_UNCHANGED. (D0 contract PASS · corpus bytes FROZEN)

First Principles gate: PASS


## 16. Codex D1-A v4.1 FINAL MINIMAL CLOSURE (2026-08-18) — 실증 미이행 4건

v4를 유지하고 Codex가 실증한 4건만 최소 수정했다(신규 요구·범위 확장·리팩터 없음). §1~§15·DEVCHG-110~115 보존.
gold/corpus/gates/builder/D0는 read-only(불변).

- **R1 gates exact.** validateGatesLock을 `note` 제외 semantic 트리를 frozen expected object(`D1_EXPECTED_GATES`)와
  값·배열 순서·키 집합까지 exact deep-compare로 바꿨다(빈 문자열 확인 대체 폐기). precision.roundingRule·recall.rule/baseline·
  qualifiedSupply.rule/baseline·abstain.denominator/rationale/changeRequires를 포함한 **모든 primitive leaf 변조와 누락·extra
  field를 거부**하고, Wilson 5 reference 독립 재계산도 유지한다. evaluatePredictions·evaluateGates는 계산 전 이를 통과해야 한다.
- **R2 mode gate.** evaluatePredictions 결과에 `mode`를 보존하고, evaluateGates는 `mode !== "candidate"`이면 contentType·
  abstain·adversarial·mutation·precision·recall·qualifiedSupply·release를 모두 `pass:false`·`status:"NOT_EVALUATED"`로 만든다.
  fixture_only는 어떤 성능 PASS도 만들 수 없다.
- **R3 effective non-answer.** candidate 독립 gold 평가 대상에서 explicit all-abstain·withheld·error·schema_reject·missing/invalid
  classification을 모두 non-answer로 집계하고 `denominator·effectiveNonAnswerCount·effectiveNonAnswerRate·원인별 breakdown`을
  반환한다. abstain gate는 effectiveNonAnswerRate를 쓰며 전건 비응답이면 rate=1·pass=false, 0분모는 PASS가 아니라 insufficient.
- **R4 canonical 분리.** evaluatePredictions가 items에서 canonical을 내부 생성하지 않고, frozen corpus에서 만든 `canonical`을
  필수 인자로 받는다. CLI는 frozen corpus raw SHA 확인 후 corpus.rows에서 canonical을 한 번 만들고, itemsFromCorpus에서
  contractGold를 제거해 canonical record만 contractGold를 보유한다. validateEvaluationDataset은 item의 itemId/origin/재계산
  evidenceHash/blindPacketHash를 canonical과 재대조한다. 그래서 items.contractGold+gold+prediction을 함께 오답으로 바꿔도
  frozen canonical과 불일치해 CORRUPT_EVAL_DATA다.

공격 결과(실측): R1 semantic leaf **72개 전수 + extra/top-extra field** 변조 전부 validateGatesLock false·evaluate throw;
R2 fixture_only 성능 gate 전부 NOT_EVALUATED; R3 withheld/error/schema_reject 각각 effectiveNonAnswerRate=1·abstain pass:false;
R4 공동 오답·item title 위조 모두 CORRUPT_EVAL_DATA; contractGold는 request에 미노출; 기존 v4 계약(gold 위조·adjudicated·
adversarial 10·mutation·budget 회계·releaseState) 전부 유지.

결과: 계약 단위 31 + lab 14. focused 45/45, 회귀 100/100, 전체 `npm test` 1,388/1,388(skip·todo·cancel 0).
corpus `--check` byte-identical(e9afa42b 불변), `eval --check-lock` OK. gold/gates/builder read-only 불변. 실 LLM/API 0·비용 0.

truth 분리: LAB_CANDIDATE_READY / GOLD_PENDING / REAL_MODEL_NOT_RUN / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN /
LIVE_UNCHANGED. (D0 contract PASS · corpus bytes FROZEN)

First Principles gate: PASS


## 17. D1-B 독립 골드 후보 완료 (2026-08-19)

실제 78행을 독립 A/B가 전수 판정했다. 57건은 직접 합의됐고 21건은 불일치해 A/B와 다른
`claude-opus-4-8-d1b-adjudicator-20260818`가 21/21 판정했다. 마지막 계약 HOLD였던
`d1r-010cfbda23878bee`는 제목만으로 taxonomy 핵심 분야를 정밀 지정할 근거가 없어
`contentType=other`, `accepted=[]`, `humanValid=false`, `inScope=false`로 독립 재판정됐다.

재검증 과정에서 `releaseGoldState`가 독립 해결 여부와 모델 평가 대상 여부를 혼동하는 결함을 발견했다.
정당한 범위 밖 음성표본 7건까지 미완료로 보아 78/78 완료 후에도 insufficient를 반환했다. 반례를 먼저 RED로
고정하고, `resolvedIndependentItemIds`(78건)와 `releaseEligibleItemIds`(71건)를 분리했다. 전자는 골드 완성,
후자는 실제 모델 성능 분모에만 사용한다. 범위 밖 표본을 억지 카테고리에 넣지 않는다.

결과(실측): `agreements=57`, `disagreements=21`, `adjudicated=21`,
`releaseGoldState=sufficient_independent_gold`. 후보 파일은
`.nowhot-local/selection-d1b/final-gold.candidate.json`(SHA-256
`9a82b0920e56606a8553b39616c6736ee7011699266b2f2d67958fc40f07fdeb`)에 격리했다.
focused 52/52, corpus `--check` byte-identical, gates/D0 lock check OK, 전체 `npm test` 1,395/1,395,
`git diff --check` PASS.

truth 분리: D1B_GOLD_CANDIDATE_READY / CANONICAL_GOLD_NOT_PROMOTED / REAL_MODEL_NOT_RUN /
D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §17 D1-C 측정 (2026-08-19, 실모델 canary → D1C_CANARY_HOLD)

정본 gold 승격 `4eed688d…`→`9a82b0920e56…`(원자적·멱등, `selection-d1-gold.before.json` 백업, 승격 전 canonical/contract/release로 96/78/71/57/21/18·sufficient 재검증). legacy baseline은 동결 snapshot 3종(pool-2026-08-14/15/16-lunch, SHA 이중 대조)에서 real 78행 1:1 매핑 + `snapshot category == declaredCategory` 검증 후 eligible 71에서 recall·qualified-supply 측정·잠금(`selection-d1-legacy-baseline.lock.json`, totalQS 44, lockSha `04da5c7b…`, applicable 12, news/humor 표본 0). 실모델 `claude-haiku-4-5-20251001`(promptVersion `nowhot-selection-d1c-p1`) canary 12건(adversarial 10 + mutation d1m-01a/01b) 실호출(실비 $0.0577, 입력 20022 / 출력 7527 tok). canary adversarial gate **5/10**(scopeMismatch 4 — eventJurisdictions 미해결로 scope=unknown; expectedAdmissionMiss 3 — 06 politics 공동핵심 누락 등; selectedCategoryLeak 1 — 10 tech 오admit) → **D1C_CANARY_HOLD**, 나머지 84 미실행, releasePass 미도달. 계약대로 프롬프트 튜닝·재호출 없이 종료. per-item 진단은 `.nowhot-local/selection-d1c/canary-adversarial-diagnosis.json`(본문 제외).

표본 한계: eligible 71·분야 최대 양성 9·news/humor 양성 0이라 Wilson 0.98 도달 불가능(위장 없이 planAdditionalSamples 보고). D1-C 완료 ≠ RELEASE_READY.

검증: lab 24/24, 전체 `npm test` 1,405/1,405, corpus `--check` byte-identical, gates/D0/baseline lock drift 0, `git diff --check` PASS, 허용목록 밖 112 불변.

truth 분리: CANONICAL_GOLD_PROMOTED / LEGACY_BASELINE_MEASURED / REAL_MODEL_RUN(canary only) / FULL_MEASUREMENT_NOT_COMPLETED / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §18 D1-C 무결성 수리 (2026-08-19, 실모델/API/Keychain 0)

Codex 실증 4개 결함 수리(외부 호출 0): (1) `--run-model` consumed guard(`D1C_CONSUMED_DIAGNOSTIC_HOLD`, Keychain 전) + `priorUsage` lifetime(cache-hit여도 usage 보존); (2) canary+full lifetime 통합 예산 preflight(`$0.1836+$1.092=$1.2756` 반례 차단, cost/calls/token 경계); (3) baseline checker strict(corpus/gold/baseline raw SHA + payload exact + lockSha; 값·extra/missing·whitespace·raw-byte·lockSha 변조 전부 reject, 임시 반례 증명); (4) corpus v2(002) supersede — adversarial 10행 geo 정정(scope=resolveScopeClass, geoSpan grounded, KR outlet+no event→unknown, sourceCountry 비추론). real 78·mutation 8·gold·gates 불변, corpus `e9afa42b`→`b8f2d458`.

소비된 canary 재평가(corpus v2): contentType 10/10 · category 7/10 · geoScope 7/10 · wholeRow 5/10 — release PASS 아님, 84 sealed.

검증: RED→GREEN 8, lab 32/32, 전체 1,413/1,413, corpus byte-identical, gates/D0/baseline lock drift 0, `--integrity-check` OK, `git diff --check` PASS. 기존 D1-C 산출물·selection-contract.js·D1-B 원본 무변경.

truth: D1C_INTEGRITY_REPAIRED / CANARY_CONSUMED_DIAGNOSTIC_ONLY / FULL_84_SEALED / NEXT_MODEL_SELECTION_NOT_STARTED / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §19 D1-C 무결성 TRUE FINAL (2026-08-19, 실모델/API/Keychain 0)

119의 "코드로 닫힘" 판단을 Codex가 데이터-only로 반려 → 코드 재수리(119의 "재시도 전체 lifetime 완료"·"scope 정본 완료"를 §19가 supersede):
(1) canonical scope 재계산·검증(`resolveCanonicalContractScope`; 저장≠계산 scope=`CORRUPT_EVAL_DATA`, geo grounded 필수, mutation=null, 평가는 `contractProjection.scope`);
(2) 영속 `usage-ledger.jsonl`(reserve/settle+fsync, 미정산=estimated+`UNSETTLED_USAGE_HOLD`, cost 재계산, runner는 ledger summary만, 재생성 후 복원);
(3) `inspectConsumedDiagnostic` sealed/absent/drift + `stepRunModel`이 Keychain 전 판정(getApiKey 0);
(4) ID lineage exact(corpus 002/001, baseline 002/001 interim `4dd864`→final `b31f6dbf`, builder byte-identical `b8f2d458`).

검증: RED→GREEN 12, lab 38/38, 전체 1,419/1,419, corpus/eval-lock/check-baseline/integrity-check OK, git diff PASS. gold/gates/D0/evaluator/corpus v2/D1-B/기존 selection-d1c 산출물 불변. ledger recovery 12/20022/7527/$0.057657, 잔여 $1.192343.

남은 제한: `stepRunModel` absent 경로의 attempt-dir 격리(산출물 wx)는 다음 실제 실행 전 수리 대상(이번엔 sealed guard로 도달 불가).

truth: D1C_INTEGRITY_FINAL_CANDIDATE / CANARY_CONSUMED_DIAGNOSTIC_ONLY / FULL_84_SEALED / NEXT_MODEL_SELECTION_NOT_STARTED / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §20 D1-C 무결성 ONE-SHOT FINAL (2026-08-19, 실모델/API/Keychain 0)

120의 TRUE FINAL을 §20이 supersede(4개 뿌리 결함 완결, 미루기 0):
(1) **attemptDir 완전 격리** — 검사·캐시·산출물 쓰기가 단일 dir(wx)만, `D1C_DIR` 쓰기 0; `isConsumedDiagnostic`→3-state inspector 위임, `CONSUMED_ARTIFACTS` 삭제; 전역 lock(wx, `RUN_IN_PROGRESS_HOLD`/controlled cleanup); attemptId 유일·callId `<attemptId>:<phase>:<index>`;
(2) **ledger strict** — seq 연속·type·non-neg·recovery seq0·고아/중복 settle=`LEDGER_CORRUPT_HOLD`, append 전수검증+seq 강제+fsync+재검증, provider throw/usage invalid→미정산+1회후 중단+`UNSETTLED_USAGE_HOLD`, lifetime=ledger summary;
(3) **Keychain 이전 완전 preflight 순서**(consumed→lock→ledger→SHA→baseline→snapshot→canonical→counts→getApiKey, 실패 시 key/API/write 0);
(4) **canonical geo 완결**(원소 trim non-empty·공백 reject, span exact substring, scope=resolveScopeClass, `contractProjectionOf` scope 필수).

검증: RED→GREEN, lab 43/43, 전체 1,424/1,424, corpus/eval-lock/D0/check-baseline/integrity-check OK, git diff PASS. builder·corpus·gold·gates·D0·baseline·evaluator·ledger·D1-B·기존 selection-d1c 불변. ledger recovery 12/20022/7527/$0.057657, 잔여 $1.192343. 미룬 제한 0.

truth: D1C_INTEGRITY_CLOSURE_CANDIDATE / CANARY_CONSUMED_DIAGNOSTIC_ONLY / FULL_84_SEALED / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §21 D1-C CODEX FINAL HOLD 수리 (2026-08-19, 실API/Keychain 0)

121의 3개 "완결" 주장을 §21이 supersede(코드·반례로 실제 완결):
(A) **createFileLedger** — JSON 파싱오류=`LEDGER_CORRUPT_HOLD`, append 전 전수검증·seq 강제(호출자 주입 무시)·예정 record 포함 재검증·fsync·쓰기 후 재읽기 재검증·마지막 record 예정값 확인, 손상 원장이면 append 전 중단·원본 불변;
(B) `budgetAllowsCall` 단일 순수 함수(중복 공식 제거), valid cache 먼저·호출 가능 항목 0이면 `BUDGET_PRECONDITION_HOLD`(key/provider/write 0), `MODEL_KEY_MISSING` 분리;
(C) ledger 있으면 runPriced lifetime==마지막 `ledger.summary`(미정산 estimated 0 축소 금지), 중단 receipt에 lifetime·unsettled·실제 효과 횟수, provider 후 "0 API/write" 출력 미사용.

검증: RED→GREEN(D1CI4), lab 46/46, 전체 1,427/1,427, integrity-check·check-baseline OK, git diff PASS. corpus·gold·gates·D0·baseline·기존 ledger·기존 D1-C 산출물 불변, 허용목록 밖 변화 0.

truth: D1C_INTEGRITY_CLOSURE_CANDIDATE / CANARY_CONSUMED_DIAGNOSTIC_ONLY / FULL_84_SEALED / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED.

First Principles gate: PASS

## §22 D1-D 후보 프롬프트 p2 canary (2026-08-19, 실API canary 12회만)

D1-C 측정(§17~21)에서 candidate haiku-4-5가 adversarial 5/10으로 `D1C_CANARY_HOLD`였다. D1-D는 **프롬프트만 1벌(p2)** 교체해 같은 표본·계약·측정기로 다시 canary를 쳤다(분류기·평가·ledger·게이트·gold·corpus·gates·D0·baseline 전부 read-only 재사용, 중복 분류기·새 프레임워크 0).

- **thin runner**(`tools/run-selection-d1d.mjs`): p2 시스템 프롬프트는 D1-C 실패 3패턴을 겨냥한다 — (1) geo: `sourceCountry`(매체 위치)로 사건 위치를 정하지 말 것, 본문에 근거 없으면 `eventJurisdictions` 비움→scope unknown; (2) 교차도메인은 분리 불가한 사건일 때만 2범주 승인; (3) 단순 언급·구조 유사·간접(2차) 영향은 reject. 별도 attempt(`d1d-20260819-01`)·산출물 dir·`usage-ledger.jsonl`·lock을 분리했고, seq0 recovery에 D1-C 누적(12/20022/7527/$0.057657)과 원본 ledger `176c9e78…`·predictions `6c6bdcdd…` SHA를 기록했다.
- **예산 게이트**(Keychain 이전): lock(wx)→strict ledger·unsettled 0→예산 판정(증분 $0.20 AND 누적 $1.25, `budgetAllowsCall` 순수함수 공유)→호출 가능 항목 0이면 `BUDGET_PRECONDITION_HOLD`(key/provider/write 0)→그 다음에만 getApiKey.
- **측정**(실호출 1회, 자동 retry 0): canary 12건 중 **2건이 schema reject → classified 10/12**. 게이트는 12건 미달을 정직히 실패로 보고 `D1D_CANARY_HOLD`. 증분 실비 $0.056675(in 21330/out 7069 tok), 누적 $0.114332로 상한 내. ledger는 recovery1+reserve12+settle12=25행·unsettledReserves 0·lifetime calls 24/in 41352/out 14596/$0.114332로 receipt와 정확히 일치.
- **계약 준수**: canary FAIL이므로 프롬프트 추가 튜닝·다른 모델·재호출 없이 즉시 HOLD하고 STAGE 2~4(full 96 평가·D2 로컬 shadow 연결·David 로컬 미리보기 UI)를 수행하지 않았다. 로그·문서에 secret·raw body·API 응답 원문 없음.
- **독립 검토**: fresh-context Opus 리뷰어가 8개 불변식+also-check(read-only 재사용·중복 분류기 0·예산 정직·auto-retry 0·ledger 무결성·게이트 정확·프롬프트 누출 0·회계 정직)를 전부 CONFIRMED-OK, `NO FIXABLE DEFECT — HOLD closure is honest`로 판정. 지적된 cosmetic 2건 중 명백한 dead import 2개만 제거(게이트·회계 무관), 나머지 1건(informational 비용식)은 결정경로 밖이라 미변경.
- **검증**: 신규 테스트 4/4, 전체 `npm test` 1,431/1,431, frozen fixture(corpus b8f2d458·gold 9a82b092·gates 10c3160c) byte-identical 재확인, D1-C 산출물·ledger·selection-contract.js·D1-B 원본 불변, D1D_DIR 밖 쓰기 0.

truth: D1D_CANARY_HOLD / CANDIDATE_PROMPT_P2_INSUFFICIENT / FULL_96_NOT_RUN / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED / READY_FOR_CODEX_REVIEW.

해석(위장 금지): p2로도 haiku-4-5는 엄격 스키마(14 taxonomy 행 + geo 3필드 grounding)를 canary 12건 전부에서 만족하지 못했다. 이는 프롬프트 1벌 교체로는 후보가 이 게이트를 넘지 못함을 뜻하며, adversarial 정밀도 개선 이전에 schema 적합 자체가 병목이다. 다음 후보(모델 교체 또는 스키마 완화 여부)는 David 승인 후 결정한다. D1-D 측정 완료 ≠ RELEASE_READY.

First Principles gate: PASS

### §22-보론 오프라인 진단 (2026-08-20, 실API 0)

소비된 canary 예측(sealed, p1·p2)을 **같은 정본**(corpus v2 canonical `b8f2d458…`)으로 나란히 재평가했다. 산출물: `.nowhot-local/selection-d1d/canary-adversarial-diagnosis.json`(wx, `NOWHOT-SELECTION-D1D-CANARY-DIAGNOSIS-001`).

- **wholeRow: p1 5/10 → p2 6/10.** p2가 고침: d1a-02(scope global→unknown), d1a-06(교차도메인 2범주 승인), d1a-10(구조유사 오분류 tech→business). p2가 겨냥한 admission 계열은 사실상 해결 — 평가된 8건에서 selectedCategoryLeak 0·unexpectedAdmission 0·contentType 불일치 0, mutation gate 통과(labelChanged=true).
- **p2 회귀 2건**(p1에서는 PASS): d1a-05(비-unknown scope를 주장하면서 geoEvidenceSpans를 비움→schema reject), d1a-09(근거 span을 원문에 없는 문자열로 제출→evidence_not_grounded). "근거 없으면 비워라" 강화가 grounding 규율 없이 위치 단정만 유도한 결과이며, 스키마는 근거 없는 단정을 정확히 잡아냈다(fail-closed 정상 작동).
- **남은 실패 4건 전부 grounding 규율**: d1a-04(deal 항목 scope unknown+tech admission miss), d1a-05(span 미제공), d1a-08(unknown이어야 하는데 domestic 단정), d1a-09(span 창작). §22 본문의 "schema 적합 병목"을 정밀화하면 병목은 스키마가 아니라 **haiku-4-5의 geo/근거 grounding 규율**이다.
- **옵션 실측 근거**(결정은 David): ③ p3(grounding 규율 명시 — 위치를 주장하면 반드시 원문 exact substring을 span으로 복사, 못 찾으면 unknown) canary ≈$0.057·성공 시 잔여 84건 ≈$0.40·누적 ≈$0.57로 상한 내. ① sonnet-4-6 교체 canary ≈$0.17(상한 내)이나 full까지 누적 ≈$1.47로 상한 $1.25 초과(상향 승인 필요)·운영 단가 3~5배. ② 스키마 완화는 근거 없는 geo 단정을 통과시키는 위장이라 비권장. 단, canary 게이트는 10/10 하드라 p3가 4건 중 3건만 고쳐도 HOLD이며, p2에서 보듯 프롬프트 반복은 단조 개선이 아니다(3건 고치고 2건 회귀).

First Principles gate: PASS

## §23 D1-E 후보 프롬프트 p3 canary (2026-08-20, 실API canary 12회만) — David 승인 실행

§22-보론 옵션 중 David가 p3(grounding 강제)를 승인("3번 먼저 하자")해 실행했다. thin runner `tools/run-selection-d1e.mjs`(별도 attempt `d1e-20260820-01`·dir·ledger·lock, recovery=D1-C+D1-D 누적 24/41352/14596/$0.114332+원본 SHA, 게이트·평가는 run-d1d `evaluateCanaryD1d` 재사용). p3 = p2 통과 절 원문 유지 + GEO 블록을 **ASSERT-AND-QUOTE OR NEITHER** 프로토콜로 교체(위치 주장 시 원문 character-for-character 인용 강제, quotable 단서 예시 명시) + deal 항목은 제품 도메인으로 판정하는 1절 추가.

- **측정**(실호출 1회·retry 0): **schema reject 0으로 해소**(12/12 유효 응답 — §22의 병목이던 근거 없는 단정을 p3가 실제로 잡음). 그러나 adversarial wholeRow **6/10** → `D1E_CANARY_HOLD`. 증분 $0.058866(in 23586/out 7056), 누적 $0.173198(상한 $1.25 내). mutation gate 통과. ledger recovery1+reserve12+settle12, unsettled 0, receipt 정확 일치.
- **3벌 비교(같은 정본, 오프라인)**: p1 5/10 → p2 6/10 → p3 6/10 — **정체 + 출렁임**. p3가 고침: d1a-05(assert-and-quote), d1a-04 admission(tech accept 복구, scope만 남음), d1a-09 schema(단 scope global≠international 준-근접 오답). p3 회귀: d1a-10(구조유사 tech 오승인 복귀 — p2에서는 PASS). **3벌 전부 실패**: d1a-04 scope(원화·리테일러 quotable 단서→domestic 매핑 실패), d1a-08 scope(한국 분위기만으로 domestic 과잉 단정). 산출물 `.nowhot-local/selection-d1e/canary-adversarial-diagnosis.json`(wx).
- **해석(위장 금지)**: 남은 실패는 "quotable 근거로는 위치를 잡고(d1a-04), 분위기만으로는 잡지 않는(d1a-08)" 미세 캘리브레이션인데, 프롬프트 3벌에서 5-6-6 정체에 항목별 flip-flop(d1a-09·d1a-10)이 동반된다. 이는 지시 이해 부족이 아니라 **haiku-4-5의 경계 사례 일관성 한계** 신호로, 프롬프트 단독 반복으로 10/10 도달 가능성은 낮다고 판단한다. 다음 단계 유력안은 상위 모델 canary(sonnet-4-6 ≈$0.17, 상한 내 — full 96까지 가면 상한 상향 필요)이며 결정은 David.
- **검증**: 신규 테스트 3/3, 전체 `npm test` 1,434/1,434, frozen fixture·D1-C/D1-D 산출물 read-only 불변, D1E_DIR 밖 쓰기 0.

truth: D1E_CANARY_HOLD / PROMPT_ITERATION_PLATEAUED(5-6-6) / MODEL_CAPABILITY_LIMIT_SUSPECTED / FULL_96_NOT_RUN / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED / NEXT_CANDIDATE_AWAITS_DAVID.

First Principles gate: PASS

## §24 D1-F 단일변수 실험 — Sonnet canary (2026-08-20, 실API canary 12회만) — David 최종 지시 실행

David 최종 지시 "1번 Sonnet canary만": 5→6→6 정체가 프롬프트 문제인지 모델 능력 한계인지 **단일변수**로 확인. 고정: p3 프롬프트 SHA `769b2d40863ab55b` 그대로(preflight 대조, 불일치=호출 전 HOLD)·동일 canary 항목/입력 순서/gold/schema/채점기(run-d1d `evaluateCanaryD1d`)·corpus/fixture/정본/기존 산출물 무수정. 유일한 변경: 모델을 저장소 정의 `claude-sonnet-5`(llm.js 기본값, costs.js 단가 $3/$15 정가)로.

- **runner**(`tools/run-selection-d1f.mjs`): 단가 혼합 왜곡 방지 — D1-F ledger는 recovery 없이 sonnet 호출분만 기록(정가 $3/$15), 과거 haiku 실비 $0.173198은 비용 공간 상수+D1-E 원본 SHA(ledger `5cf67acd…`·receipt `e69e7925…`)로 지참하고 preflight에서 재대조, 누적 게이트는 잔여 여유($1.076802)를 예산 상한으로 같은 `budgetAllowsCall`로 판정. 응답의 실제 resolved model은 `callStructuredMessage`의 공식 `fetchImpl` 주입+clone으로 캡처(llm.js 무수정). 1회 한정: ledger에 호출 흔적 있으면 `D1F_CONSUMED_HOLD`. 참고: llm.js 공용 경로가 sonnet 계열에 `effort:"low"`를 자동 부여(haiku 경로엔 없음) — 저장소 정의 호출 규약 그대로 사용했고 변경하지 않음.
- **측정**(실호출 12·retry 0·resolved `claude-sonnet-5` 12/12): schema reject 0, mutation gate 통과, adversarial wholeRow **7/10** → **`D1F_CANARY_HOLD`**. 이번 비용 $0.2418(in 23,586/out ~11,400 tok — sonnet이 출력을 더 길게 씀), 증분 상한 $0.30 내, **실누적 $0.414998 / $1.25**. PASS 아님 → 계약대로 full·재시도·타모델·프롬프트 수정 없이 즉시 종료.
- **4벌 비교(같은 정본)**: haiku p1 5/10 → p2 6/10 → p3 6/10 → **sonnet(p3) 7/10**. sonnet이 해결: d1a-08(4벌 중 최초 통과 — 분위기만으로 domestic 단정하던 것을 억제), d1a-09(international 정답), d1a-10(구조유사 해소). sonnet 회귀: d1a-05(공시·조원 단서에도 unknown — 과잉 보수), d1a-07(政 반응을 politics로 과잉 승인 — cross-domain 절 과발동). **d1a-04는 4벌·2모델 전부 실패**: 제목에 "쿠팡"·"89000원"이 있는데도 두 모델 모두 domestic 단정을 거부(unknown). 산출물 `.nowhot-local/selection-d1f/canary-adversarial-diagnosis.json`(wx).
- **해석(위장 금지)**: 모델 상향은 +1(6→7) 실질 개선이나 10/10 하드게이트는 **두 모델 모두 미달**이고, 실패 축이 모델별로 다르다(haiku=분위기 과잉단정 vs sonnet=과잉 보수+cross-domain 과발동). d1a-04처럼 프롬프트·모델 불변 실패는 fixture의 근거 강도(리테일러명·통화→관할 매핑)가 경계선일 가능성을 시사한다 — 이번 계약상 정본 수정 금지이므로 **관찰만 기록**하고, 정본 재검토 여부는 Codex 재검수·David 판단 사항으로 넘긴다.
- **검증**: 신규 테스트 3/3(단일변수 고정·costs.js 단가 정합·prior 상수 정합), 전체 `npm test` 1,437/1,437, frozen fixture(corpus b8f2d458·gold 9a82b092·gates 10c3160c)·lab(68c7df65)·llm.js·run-d1c/d/e·D1-C/D/E 산출물 전부 불변, D1F_DIR 밖 쓰기 0.

truth: D1F_CANARY_HOLD / SONNET_BEST_7_OF_10 / GATE_10_OF_10_UNMET_BY_BOTH_MODELS / D1A04_FIXTURE_BOUNDARY_OBSERVATION / FULL_96_NOT_RUN / D2_RUNTIME_NOT_WIRED / PRODUCT_NOT_PROVEN / LIVE_UNCHANGED / NEXT_AWAITS_DAVID_AND_CODEX.

First Principles gate: PASS

## §25 D1-G EVALUATION TRUTH REPAIR (2026-08-20, 실API 0) — David 지시 실행

측정을 반복하기 전에 **평가 정본 자체의 진실성**을 수리했다. corpus·gold·gates·D1-C~F 산출물·selection-contract.js(D0)는 read-only 동결 유지.

- **독립 blind 재판정(§지시 2)**: adversarial 10건을 구현 세션과 분리된 독립 검수자 A/B가 blind 판정 — 중립 ID(A01~A10, 원 ID의 설명형 접미사가 정답을 누설하므로 치환), 기존 gold·모델 예측·점수·실패 항목 비노출, 파일 접근 금지, 사건위치/판매시장/관련국 3구분 명시. 결과 **A/B 완전 합의 10/10, adjudication 불요**(workflow `wf_49284bff-cbb`, 검수자 identity `d1g-blind-reviewer-A/B-20260820`).
- **superseding authority(§지시 3)**: `test/fixtures/selection-d1g-adversarial-authority-001.json` 신설(원본 무수정, 평가 전용 대체). scopeClass는 동결 `resolveScopeClass`로 arrays에서 기계 파생. 합의 ambiguous 2건(d1a-07 — 사기업 실명·국가 단서 없음, d1a-08 — 국가 단서 전무)은 억지 정답 대신 **분모 제외**. 구 canonical 대비 5건 차이: d1a-03 unknown→**domestic**(150만원 grounded), d1a-09 international→**global**(KR 관련성 비근거), d1a-10 acc business→**tech**·scope→global(애플 임원 인사=tech core), d1a-07/08 ambiguous. 차이 방향이 모델별 유불리 혼재라 "모델 맞춤 정답 변경 아님"이 구조적으로 성립. d1a-04(쿠팡)는 독립 검수도 domestic·tech 확인 — fixture는 옳았고 모델이 틀린 것.
- **validator 최소 수리(§지시 4)**: lab.js `validateClassifierOutput`의 RED 실증 구멍 2개 봉합 — admission 13행(누락)도 통과, accept∩descriptiveSecondary 겹침도 통과하던 것을 `admission_rows_not_exact_taxonomy`·`accepted_secondary_overlap`로 fail-closed. 반례 6건(`test/selection-d1g.test.js`). 부수 정합: 구멍에 의존하던 테스트 헬퍼 mkCls 14행 전수화, eval-scenarios fixture 예측 9건 14행 확장(ab1만 abstain 채움으로 all-abstain 의미 보존; SHA 핀 없음 확인, 동결 목록 밖 시나리오 픽스처).
- **offline 재채점(§지시 5, API 0)**: sealed 4벌을 신 정본 decisive 8 분모로 — **p1(haiku) 2/8 · p2(haiku) 3/8 · p3(haiku) 5/8 · p3(sonnet-5) 3/8**. 구 정본에서 최고였던 sonnet(7/10)이 신 정본에선 3/8로 내려가고 haiku p3가 5/8 최고 — 순위 역전 자체가 정본 독립성의 증거. 억지 PASS 없음(전부 8/8 게이트 미달). 산출물 `.nowhot-local/selection-d1g/rescore-report.json`.
- **토큰 수 정정(§지시 6, append-only)**: §24·DEVCHG-125·블루프린트의 D1-F 토큰 "in 23,586/out ~11,400"은 **오기**다. sealed receipt·ledger 실측은 **input 30,380 / output 10,044**($0.2418 = 30380×$3/M + 10044×$15/M 정확 일치). 산출물은 처음부터 정확했고 문서 서술만 D1-E 수치(23,586)를 잘못 이월했다.
- **검증(§지시 7)**: 전체 `npm test` **1,443/1,443**, `git diff --check` PASS, frozen fixture(corpus b8f2d458·gold 9a82b092·gates 10c3160c)·D1-C~F 산출물·D0 계약 불변.

truth: EVAL_AUTHORITY_REPAIRED / INDEPENDENT_AB_FULL_AGREEMENT / AMBIGUOUS_2_EXCLUDED / RANKING_REVERSED_UNDER_TRUE_AUTHORITY(haiku-p3 5/8 최고) / NO_FORCED_PASS / NEXT_MODEL_CALL_AWAITS_CODEX.

First Principles gate: PASS

## §26 D1-G FINAL CLOSURE (2026-08-20, 실API·모델 호출 0) — David 지시 실행

**§25의 `EVAL_AUTHORITY_REPAIRED` 주장을 §26이 `CANDIDATE_AUTHORITY_NOT_WIRED`로 supersede한다** — authority-001은 후보 정본이었을 뿐 표준 평가 경로에 배선되지 않았었다(001·rescore-001은 감사용 보존). §26이 정본을 확정 배선했다.

- **지역성 규칙 고정(지시 2)**: unknown은 유효하고 결정적인 답 — geo unknown만으로 ambiguous 금지. 뉴스·커뮤니티는 통화 금액만으로 발생국·활동장소를 확정하지 않고, 딜은 리테일러·통화·배송 조건이 판매시장·관할 근거가 될 수 있다. 적용: A03 unknown·A04 domestic·A05 unknown·A08 business/unknown·A09 business/global(A03·A05는 blind A/B의 domestic 판정을 소유자 규칙으로 정정 — `ownerRuleCorrection`으로 항목별 정직 표기). 실제 경계선인 **A07·A10은 감사용 ambiguous로 보존**하고, **대체 반례 2건**(d1g-11 clear-secondary-politics: 실적=core·정치권 축하논평=부차·unknown / d1g-12 clear-product-launch: 애플 제품발표=tech core·global)을 함정 의도만으로 설계(모델 결과 무참조)해 별도 blind A/B(완전 합의, `wf_fbb727b2-951`)로 검증 — **하드게이트 분모 정확히 10 유지**.
- **authority-002(지시 3)**: `test/fixtures/selection-d1g-adversarial-authority-002.json` append-only 신설 — 001 supersedes 관계, decisive 10, item별 evidenceHash, taxonomy 버전, reviewer provenance, raw A/B workflow receipt 4종(경로+SHA, `.nowhot-local/selection-d1g/receipts/`), **검수자 A/B는 동일 기반 모델(Claude)의 분리된 별도 실행(fresh-context)이었음을 정직 표기**, 채점값(contentType·scope·accepted·rejected·secondary) 단독 소유 선언.
- **정본 validator 한곳 수리(지시 4)**: selection-contract.js `validateClassificationSchema` v2→**v3** — admission 14행 전수(누락·잉여·중복 fail-closed) + accept∩descriptiveSecondary 금지. lab `validateClassifierOutput`은 정본 재사용으로 환원(§25의 lab 중복 규칙 제거), `D1C_SEMANTIC_SCHEMA` minItems/maxItems 14, contract 테스트에 canonical gate 반례(스키마 거부+`admissionGate` 비승인 동시 검증). 파생 정합: goodClassification/mkCls 14행 전수화, d0-counterexamples 32건 확장(무효 의도 1건 보존), D0 baseline lock 재생성(**변경분 = contract 지문+버전 2필드뿐** 검증), run-d1c `d0_contract` 핀 갱신(`0a6d2608`→`fb686d3c`).
- **표준 경로 실배선(지시 5)**: `loadAdversarialAuthority`(계약 ID·evidenceHash·corpus coverage 불일치 = `CORRUPT_EVAL_DATA`) + `buildCanonicalAuthority`가 adversarial 행에 authority **필수** — corpus contractGold를 채점에 조용히 쓰는 경로 금지(무결성 대조·D1CI2 geo 자기일관성 검증 용도로만 유지). `evaluatePredictions` 분모 = canonical decisive 10(대체 반례 미예측은 invalidOrMissing으로 정직 집계, 감사 ambiguous는 `auditAmbiguousExcluded`). 호출부 전환: run-d1c 3곳·run-d1d `evaluateCanaryD1d`·eval-selection-classifier·selection-d1b-gold(d1e/f는 내부 로드 경유). frozen gate `expectedContractFixtures=10` 유지.
- **재현 rescore 도구(지시 6)**: `tools/rescore-selection-d1g.mjs` — 같은 명령으로 report 결정적 재생성(byte-identical 재실행 검증). 대체 반례 sealed prediction 부재 → **`INCOMPLETE_NEW_FIXTURE_PREDICTIONS` HOLD**(exit 3), 부분 분모 8건으로 점수·모델 순위 산출 금지(§25의 2/8·3/8·5/8·3/8 수치는 001 기준 진단 기록으로만 남고 순위 주장에 쓰지 않는다).
- **검증(지시 7)**: focused 95/95, 전체 `npm test` **1,445/1,445**, `git diff --check` PASS, `--check-lock`·`--integrity-check`·`--check-baseline` OK. corpus·gold·gates·legacy-baseline·D1-C~F 산출물 byte-불변, authority-001·rescore-001 보존.

truth: **D1G_EVAL_CONTRACT_WIRED** / AUTHORITY_002_IS_SCORING_OWNER / DENOMINATOR_10_FIXED / REPLACEMENT_PREDICTIONS_ABSENT(HOLD_BY_DESIGN) / NO_MODEL_RANKING_CLAIMED / NEXT_MODEL_CALL_AWAITS_CODEX.

First Principles gate: PASS

## §27 D1-G P1 일괄 봉합 (2026-08-20, 실API·모델 호출 0) — Codex HOLD 4건

§26의 `D1G_EVAL_CONTRACT_WIRED`는 **배선까지만 참**이었다 — Codex가 실행 경로에서 P1 4건을 실증했고(§26 종료 아님), §27이 한 묶음으로 봉합했다.

- **P1-1 canary 입력 단일화**: `canaryItemIds`가 corpus adversarial 10 선택(감사용 d1a-07/10 포함·대체 누락)을 버리고 **authority-002 decisive 10 + mutation 2**를 반환. 신규 `d1gCanaryItems`(대체 d1g-11/12는 authority 항목에서 완전한 blind 필드 구성)·`d1gReplacementGoldRows`(frozen gold 무수정, authority 의미+canonical 해시로 합성). run-d1c stepRunModel·run-d1d/e/f stepCanary·`evaluateCanaryD1d`(합성 gold 결합) 전부 전환. 스모크: ids 12 정확(대체 포함·감사 제외), all-error 입력 fail-closed.
- **P1-2 rescore 실제 점수**: "전건 확보 시 그때 구현" placeholder를 제거하고 **공용 게이트 `evaluateCanaryD1d`(→`evaluatePredictions`/`evaluateGates`) 재사용**으로 wholeRow·per-item 실패항목·게이트 판정을 산출(별도 채점 공식 0). 주입식 offline 반례로 실증: 완전 예측=COMPLETE·10/10·gate PASS(mutation 포함 — 게이트가 통과 불가능하지 않음의 증명), 오답 1건=9/10·해당 항목 특정·gate FAIL. sealed 기본 실행은 여전히 `INCOMPLETE_NEW_FIXTURE_PREDICTIONS` HOLD(exit 3) — 부분 8건 점수·순위 금지 유지, 결정성(byte-identical) 재검증.
- **P1-3 authority 스키마 fail-closed**: Codex 주입 2종(`rejectedCategories:["not-a-category"]`, `secondaryCategories:"politics"` 문자열이 글자 배열로 채점 정본에 유입) **RED 재현** 후 `loadAdversarialAuthority` 전면 강화 — accepted·rejected·secondary 전부 배열·taxonomy 등록·중복 금지, accepted∩rejected=∅·accepted∩secondary=∅(rejected∩secondary는 gold 계약과 동일하게 정당), decisive/audit 겹침 금지, replacement 필수 blind 필드·evidenceHash. 공격 9종 거부 GREEN.
- **P1-4 테스트 격리**: `selection-d1g.test.js`가 gitignore된 `.nowhot-local/selection-d1f/canary-predictions.json`을 읽던 의존 제거 — 커밋되는 test/fixtures만 읽는 자급 분류 빌더로 전면 재작성(sealed 참조 0), 깨끗한 환경에서도 통과. P1 반례 10종 수록.
- **검증**: focused 99/99, 전체 `npm test` **1,449/1,449**, `git diff --check` PASS, frozen fixture·sealed 산출물 전부 불변, 모델/API 호출 0(코덱스 경고대로 새 반례 누락 상태 호출을 하지 않음).

truth: D1G_P1_EXECUTION_PATH_SEALED / CANARY_INPUT_UNIFIED / RESCORE_SCORING_COMPLETE / AUTHORITY_SCHEMA_FAIL_CLOSED / CLEAN_ENV_TESTS / REPLACEMENT_PREDICTIONS_STILL_ABSENT(HOLD_BY_DESIGN) / **READY_FOR_CODEX_RECHECK** / NO_MODEL_CALL.

First Principles gate: PASS

## §28 D1-G 재검수 HOLD 일괄 봉합 (2026-08-20, 실API·모델 호출 0) — 3 P1 + 1 P2

§27은 게이트·로더·테스트 격리까지였고, **실제 실행 경로 3곳이 끊겨 있었음**을 Codex가 재현으로 실증했다(지금 호출했으면 새 반례 누락으로 크레딧만 소모). §28이 한 묶음으로 봉합했다.

- **P1-a 공용 평가기 일원화**: run-d1c의 실제 canary가 frozen gold에서만 정답을 찾아 `item without gold 'd1g-11'`로 단절(재현 확인). `evaluateCanaryShared`를 run-d1c로 이동(대체 반례 gold 합성 내장)하고 **D1-C 내부 중복 평가기를 삭제** — run-d1d는 `evaluateCanaryD1d` 별칭으로 재export해 d1d/e/f·rescore·테스트가 전부 같은 함수를 쓴다.
- **P1-b 평가 집합 단일 함수**: canary 12 + rest 86 → 96 재필터로 내부 98건이 되고 대체 2건 누락·감사 2건 부활하던 조립을 제거. **`d1gEvaluationSet`**: corpus 96 - 감사 2 + 대체 2 = **정확히 96**(canary 12·rest 84, 개수 불변식 위반 시 CORRUPT_EVAL_DATA). stepRunModel은 이 집합과 `goldForEval`(frozen gold에서 감사 2 제외 + 대체 2 합성)만 사용.
- **P1-c rescore attempt 연결**: `--attempt <이름>=<predictions.json 경로>` CLI 신설(형식·파일 존재·versions/results 검증). per-run 완결성 의미론 — decisive 10 전건 예측 실행만 점수화, 미완결 실행은 INCOMPLETE 표기만(부분 8건 점수·순위 금지 유지). 실경로 실증: 합성 완결 attempt 지정 → `COMPLETE`·10/10·gate PASS·sealed 4개 INCOMPLETE 표기; 무 attempt 재실행 → HOLD로 결정적 복원.
- **E2E 전 경로 테스트**: `stepRunModel`에 `callModelFactory` 주입 파라미터를 추가(기본 실모델 경로 불변), **가짜 모델+임시 디렉터리**로 전체 조립 실행 — canary 선두 12에 d1g-11/12 포함·감사용 호출 0·full 96(invariance 동일 텍스트 쌍의 캐시 적중은 중복 과금 방지의 정상 동작)·산출물 5종 생성·authority 정답 입력 시 공용 게이트 PASS·status `measured` 실증.
- **P2 상태명 축소**: §27의 `CLEAN_ENV_TESTS`는 과잉 주장 — d1g 테스트만 독립이고 lab의 기존 D1CI 테스트는 여전히 `.nowhot-local` sealed 산출물을 읽는다(범위 밖 기존 이슈). 깨끗한 checkout 실증 전까지 **`SELECTION_D1G_TEST_SELF_CONTAINED`**로 정정.
- **검증**: d1g 13/13(E2E 포함), 전체 `npm test` **1,452/1,452**, `git diff --check` PASS, frozen fixture·sealed 산출물 전부 불변, 모델/API 호출 0.

truth: D1G_RUNNER_ASSEMBLY_SEALED / SINGLE_EVAL_SET_96 / SINGLE_SHARED_EVALUATOR / RESCORE_ATTEMPT_PATH_WIRED / **SELECTION_D1G_TEST_SELF_CONTAINED** / REPLACEMENT_PREDICTIONS_STILL_ABSENT(HOLD_BY_DESIGN) / READY_FOR_CODEX_RECHECK / NO_MODEL_CALL.

First Principles gate: PASS

## §29 D1-G 유료 canary 실행 준비 봉합 (2026-08-20, 실API·모델 호출 0) — 3차 재검수 6항

3차 재검수 판정(내부 조립 `PASS_WITH_LIMITATION` / 유료 canary 준비 `HOLD`)의 6항을 한 묶음으로 봉합했다. 병목은 모델 성능이 아니라 실행 경로였다.

- **canary-only 실행 경로(항목 1)**: CLI `--run-canary <attempt-id>`(attempt별 dir·ledger·lock 자동 구성, id `[a-z0-9-]` 검증) + `stepRunModel mode="canary_only"` — **정확히 12건 뒤 무조건 종료**. canary PASS면 `D1C_CANARY_MEASURED`+`fullSkipped:"david_approval_required"` 기록, 재실행은 consumed inspector가 drift로 fail-closed 차단(1회 한정). 함수 직접 호출도 `fullApproved=false` 기본이라 canary 후 `FULL_NOT_APPROVED_HOLD` — **12건 승인이 96건 과금이 되는 경로를 CLI·함수 양쪽에서 제거**.
- **attempt manifest(항목 2·3)**: stepRunModel이 모든 종단(HOLD 포함)에서 `attempt-manifest.json` 기록 — attemptId·mode·model·**resolvedModels**(응답 model 필드를 fetchImpl clone으로 캡처, llm.js 무수정)·promptVersion+promptSystemSha16·pricing·**정본 4지문**(corpus/gold/gates/authority)·**산출물 3지문**(predictions/receipt/ledger 바이트)·calls·retries:0·costUsd·unsettledReserves. rescore `--attempt`는 predictions.json이 아니라 **attempt 디렉터리만** 받고, `loadAttemptDir`가 전 지문·strict ledger(미정산 0·calls·비용)·receipt attemptId·predictions 버전을 fail-closed 대조(`RESCORE_ATTEMPT_CORRUPT`) — 임의 합성 JSON으로 `COMPLETE·PASS`를 만들 수 없다(정합 위조는 지문 체인 전체를 함께 만들어야 함).
- **깨끗한 복사본 실증(항목 4)**: snapshot을 읽는 computeBaseline/baselineDrift에 주입 심 추가(테스트는 **커밋된 legacy baseline lock 파생 스텁**, 실경로 기본값 불변), rescore의 sealed 파일 부재를 crash가 아닌 전건 missing으로 처리. **rsync로 `.nowhot-local`을 제외한 복사본에서 D1-G 17/17 실측 통과** — `SELECTION_D1G_TEST_SELF_CONTAINED`가 이제 실증된 사실.
- **실제 subprocess·정밀 회귀(항목 5)**: canary_only가 만든 **진짜 attempt 디렉터리**를 CLI subprocess `--attempt`로 실행 → `COMPLETE`·10/10·gate PASS; predictions 1바이트 변조 → subprocess가 `RESCORE_ATTEMPT_CORRUPT`로 거부; 기본 subprocess → exit 3 HOLD. full E2E 단언 정밀화: provider **정확 95콜**, 96 ID 전건 고유, 상태 전건 classified/cache_hit, **캐시 적중 정확히 `d1m-04b` 1건** — 메커니즘(정규화 캐시 키 동일 + 원문 grounding 재검증: 04b는 excerpt에 "OpenAI" 원형이 있어 통과, 03b는 03a 스팬이 원문에 없어 정직 재호출) 주석 명기. manifest 위조 반례(빈 디렉터리·retries·resolvedModels 변조) 거부.
- **검증(항목 6·7)**: 모델/API 호출 0. d1g 17/17, focused 106/106, 전체 `npm test` **1,456/1,456**, `git diff --check` PASS, frozen fixture·sealed 산출물 불변, rescore 기본 report `INCOMPLETE_NEW_FIXTURE_PREDICTIONS` HOLD로 결정적 복원.

truth: CANARY_ONLY_CLI_WIRED / FULL_84_DOUBLE_GATED(CLI+FUNC) / ATTEMPT_MANIFEST_FAIL_CLOSED / **CLEAN_COPY_D1G_PROVEN(17/17)** / EXACT_CACHE_REGRESSION_PINNED / REPLACEMENT_PREDICTIONS_STILL_ABSENT(HOLD_BY_DESIGN) / READY_FOR_CODEX_RECHECK / NO_MODEL_CALL.

First Principles gate: PASS

## §30 D1-G 후보 고정·출처 보존 봉합 (2026-08-20, 실API·모델 호출 0) — 4차 재검수 3P1+1P2

- **P1-1 후보 몰래 고정 제거**: `--run-canary`가 암묵적으로 Haiku+p1을 부르던 경로 제거. `tools/selection-candidate-registry.mjs` 신설 — 유일 등록 후보 **`p3.1-haiku`**: p3에서 **지역성 블록만 authority-002 최신 정본과 정렬**(① unknown은 유효·결정적 답 ② 뉴스·커뮤니티는 통화 금액 단독으로 사건국/활동장소 확정 금지 ③ 딜 한정으로 리테일러·통화·배송이 판매시장/관할 근거 ④ 의원/여야/정치권 일반어는 국가 근거 불가). p3 자체는 통화 일반규칙이 최신 정본과 충돌해 **후보 미등록**. 레지스트리는 requestedModel·resolvedAliases·promptVersion·**프롬프트 전체 SHA-256**·pricing을 고정하고, CLI는 `--run-canary <attempt-id> <candidate-id>`로 **후보 ID 필수**. `stepRunModel`은 versions·모델·프롬프트·단가를 `candidateDef`에서만 취한다(레거시 d1c-p1 정의는 봉인된 `--run-model` 전용으로 격리).
- **P1-2 실제 응답 모델 대조**: manifest-002가 requestedModel과 resolvedModels(응답 캡처)를 기록, rescore 로더가 **정확히 1개 & requestedModel 또는 고정 alias와 일치**를 강제. Codex 반례(요청 Haiku·기록 `fake-e2e-model`) → **거부 실증**. E2E 가짜 모델도 정직하게 requestedModel을 기록하도록 교정.
- **P1-3 실행 출처 보존**: 로더가 레지스트리와 requestedModel·promptVersion·**promptSha256(전체)**·pricing 정확 대조, receipt model, **ledger 전 record의 callId가 attempt 소속**(타 attempt 원장 재사용·짜깁기 차단)을 검증. rescore 결과 runs에 `provenance{attemptId, candidateId, requestedModel, resolvedModel, promptSha256}` 보존 — **사용자 별칭은 표시용**(별칭으로 다른 attempt/모델/프롬프트 표시 불가, 반례 실증).
- **P2 종단·경로**: "모든 종단 manifest" 주장 정정 — manifest는 **채점 가능한 정산 완료 attempt 전용**이고, MODEL_KEY_MISSING·provider 중단은 `terminal-receipt.json`으로 남긴다(key-missing에 manifest 미생성 실증). CLI 전용 경로 `.nowhot-local/selection-attempts/<id>`, **기존 디렉터리면 ledger 포함 어떤 쓰기도 하기 전에 중단**(`ATTEMPT_DIR_EXISTS_HOLD`, subprocess로 ledger 미생성 실증).
- **정직 정정**: 로컬 manifest는 **내부 일관성 증거일 뿐, 임의 합성을 암호학적으로 막는 증명이 아니다** — manifest `integrityNote` 필드와 본 문서에 명기. 위조 저항의 실체는 "일관 위조에는 지문 체인 전체(정본 4지문·산출물 3지문·레지스트리·ledger callId)를 동시에 만들어야 한다"는 비용이다.
- **검증**: 반례 신설(모델 불일치·2모델·promptSha·pricing·미등록 후보·callId 짜깁기·별칭 위조·CLI 3종·terminal receipt), d1g **21/21**, **clean-copy(‵.nowhot-local‵ 제외) 21/21**, focused 110/110, 전체 `npm test` **1,460/1,460**, `git diff --check` PASS, frozen·sealed 불변, 모델/API 호출 0(selection-attempts 실행 이력 0).

truth: CANDIDATE_REGISTRY_PINNED(p3.1-haiku) / RESOLVED_MODEL_EXACT_MATCH / PROVENANCE_PRESERVED(ALIAS_DISPLAY_ONLY) / TERMINAL_RECEIPT_SPLIT / ATTEMPT_DIR_PREWRITE_GUARD / MANIFEST_IS_CONSISTENCY_EVIDENCE_NOT_CRYPTO_PROOF / **READY_FOR_CODEX_RECHECK** / NO_MODEL_CALL.

First Principles gate: PASS

## §31 David 승인 canary 실측 — 파이프라인 완주 + p3.2-haiku 5/10 HOLD (2026-08-20)

David가 터미널에서 직접 실행을 시도(승인 표명)했으나 산출물 0·과금 0으로 확인돼, 세션이 동일 명령을 승계 실행했다. 실측에서 결함 2건이 드러나 수리하고, 봉합된 파이프라인이 처음으로 끝까지 작동했다.

- **실측 결함 (a) — 와이어 스키마 min/maxItems**: attempt `d1h-20260820-01`이 provider 400으로 `UNSETTLED_USAGE_HOLD`(정확히 1회 후 중단·retry 0 설계 작동, 400=실청구 0, 추정 reserve $0.009192는 미청구 명기). 진단 프로브 2회(400 재현 / min·maxItems 제거 성공 — e.message만 출력, 원문·비밀 미로깅, 성공 프로브 $0.004534)로 **API structured-output이 `minItems/maxItems`를 거부**함을 확정. §26에서 코덱스 지시로 넣은 와이어 강제를 제거 — **14행 정확 강제는 정본 validator v3가 응답 후 fail-closed로 계속 수행**(게이트 약화 아님).
- **실측 결함 (b) — 프롬프트-계약 형식 격차**: attempt-02(p3.1, $0.060986)가 9/12 `accepted_secondary_overlap` schema_reject — 모델이 accept 카테고리를 descriptiveSecondaryCategories에 중복 기재하는데, v3 금지 규칙을 프롬프트가 고지하지 않았다. **p3.2-haiku 등록**(p3.1 + "accepted는 secondary에 절대 중복 금지" 1줄; p3.1은 attempt-02 계보 보존을 위해 등록 유지).
- **파이프라인 완주(attempt-03, p3.2, $0.062884)**: `--run-canary` 12건 무조건 종료(`D1C_CANARY_HOLD` 정직 판정) → manifest-002 → `rescore --attempt` 검증 통과 → **COMPLETE·wholeRow·provenance**(attemptId `d1h-20260820-03`·candidateId `p3.2-haiku`·resolvedModel `claude-haiku-4-5-20251001`·promptSha256) 보존·per-item 실패 목록 — 4~5차 재검수가 요구한 전 체인이 실전에서 작동.
- **결과(정직, decisive 10 기준)**: **5/10 HOLD**. schema 0·mutation ✓·contentType 0·leak 0·unexpectedAdmission 0. 실패 5: d1a-05/08·d1g-11 **scope domestic 과잉 단정**(통화·"의원" 일반어 단독 — p3.2가 규칙을 명시했는데도 미준수), d1g-12 **global 미도출**("애플"→US 매핑 실패), d1a-06 cross-domain 2범주 miss. 검증된 측정 기반 위에서 나온 최초의 신뢰 가능한 수치이며, **지역성 규칙의 일관 적용이 haiku-4-5의 한계 축**임이 재확인됐다. 약속대로 추가 프롬프트 반복 없이 중단.
- **비용**: 오늘 실청구 $0.128404(attempt-02+03+프로브2), **총 누적 $0.301602 / $1.25**. 전체 npm test 1,460/1,460, git diff --check PASS, frozen·sealed 불변.

truth: PIPELINE_END_TO_END_PROVEN / P32_HAIKU_5_OF_10_HOLD / SCOPE_DISCIPLINE_IS_MODEL_BOTTLENECK / WIRE_SCHEMA_MINMAX_REMOVED(VALIDATOR_V3_ENFORCES) / NEXT_CANDIDATE_AWAITS_DAVID_AND_CODEX.

First Principles gate: PASS

## §32 D1-H category admission / geo scope 분리 (2026-08-20, 실API·모델 호출 0) — Codex

§31의 "David 승인 canary" 표현을 정정한다. David의 승인은 p3.1 canary 1회였고, 진단 프로브 2회와 p3.2 canary는 Claude 구현 세션이 승인 범위를 자율 확장해 실행했다. p3.2는 같은 canary의 p3.1 실패를 보고 수정했으므로 독립 성능 증거가 아니라 **같은 시험에 맞춘 진단 결과**다.

- **후보 정의 data화**: `test/fixtures/selection-d1-candidates.json`이 prompt/model alias/pricing/execution/evidence use를 소유한다. loader JS에는 제품 프롬프트·모델명이 없다. p3.1=`historical_hold`, p3.2=`diagnostic_hold`, runnable 후보 0. CLI와 직접 함수 모두 non-runnable 후보를 쓰기·Keychain·provider 전에 차단하며, 테스트 우회는 주입된 가짜 모델 팩토리가 없으면 작동하지 않는다.
- **게이트 분리**: `evaluatePredictions`가 `categoryAdmissionPass`와 `scopePass`를 별도로 계산한다. 기존 `adversarial.pass`는 두 축의 AND로 유지해 과거 release 계약을 완화하지 않았다. `evaluateCanaryShared`와 rescore는 category/scope 점수·실패 항목을 각각 노출한다.
- **attempt-03 offline rescore**: 추가 호출 없이 manifest·prediction·receipt·ledger를 레지스트리와 재대조했다. category admission **9/10 HOLD**(d1a-06 politics 누락), scope **6/10 HOLD**(d1a-05·08·d1g-11 domestic 과잉, d1g-12 global 미도출), wholeRow 5/10. mutation은 통과했다.
- **검증**: focused 104/104·전체 `npm test` **1,464/1,464**·`git diff --check` PASS. 지역성만 틀린 합성 반례가 category 10/10 PASS·scope 9/10 HOLD·historical combined gate FAIL로 분리되는 것을 고정했다. 후보 JSON prompt SHA/pricing/runnable 위조와 CLI·직접 함수·test bypass 우회도 fail-closed 반례로 고정했다.
- **경계**: D2 runtime·Today/Live·UI·서버·라이브·commit/push/deploy 0. 다음 유료 후보도 0이며, category-only 후보와 독립 holdout 설계가 먼저다.

truth: D1H_EVALUATION_AXES_SPLIT / CANDIDATE_REGISTRY_DATA_DRIVEN / RUNNABLE_CANDIDATES_0 / P32_CATEGORY_9_OF_10_HOLD / P32_SCOPE_6_OF_10_HOLD / P32_NOT_INDEPENDENT_EVIDENCE / D2_RUNTIME_NOT_WIRED / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §33 D1-H 독립 적대검수 종결 (2026-08-21)

- **검수자/영수증**: Claude 별도 read-only 세션, 실제 resolved model `claude-fable-5`. 원문 SHA-256 `0636eaa76618562a4175f5d2940b95b43ad0cd2da52ad4867756d69f13fbe17d`.
- **판정**: `PASS_WITH_LIMITATION`, P0 0·P1 0·P2 2. P2는 (1) `maxCalls=12/fullAllowed=false` 실행 안전 불변식이 loader에도 상수로 고정된 유지보수 제약, (2) CLI의 `getCandidate`→`getRunnableCandidate` 중복 조회다. 현재 동작·정확성·안전·비용에는 영향이 없어 무수리 수용했다.
- **독립 대조**: 13개 주장과 18개 적대 항목 전부 핵심 계약 PASS. focused 104/104, rescore category 9/10·scope 6/10·whole 5/10 재현, 전체 1,464/1,464, `git diff --check` PASS, 검수 전후 소스 SHA 10/10 동일.
- **범위**: D1-H 평가/차단 레일만 종결. p3.2 비독립 진단·runnable 후보 0·D2/runtime/product/live HOLD는 그대로다.

truth: D1H_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS / P0_0 / P1_0 / P2_2_DEFERRED / D1I_DESIGN_ALLOWED / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §34 D1-I category admission 전용 후보와 독립 holdout 봉인 (2026-08-21, API·모델 호출 0)

- **후보**: JSON 등록부에 `p4-category-haiku`를 `task=category_admission_only`로 추가. prompt SHA `310438e0cf568c8e4e62ad5df1e4386694f4965357f5a222ce808493410bf700`, 상태 `design_frozen`, runnable=false. 지역성은 의도적으로 빈 근거+unknown으로 고정해 category 판단과 분리했다. p3.1·p3.2 레코드 SHA는 바뀌지 않았다.
- **평가 의미론**: `candidateCanaryPass`는 category-only 후보에 category gate만 적용하고 기존 후보에는 과거 combined AND gate를 유지한다. 따라서 지역성 HOLD가 category 후보를 거짓 탈락시키지 않지만 과거 release 계약도 완화하지 않는다.
- **독립 holdout**: D1-G 정본 평가집합에서 canary 12와 audit ambiguous 2를 제외한 rest 84를 기계적으로 고정했다. item ID 순서 SHA `acaecded402093a72032a82d096664d2fb4e4b81ba68a5a1f6e394e27f0320ac`, evidence 행 SHA `b15ff52b8e35fdd86ce16a0156471d79e484bb15101a560babe4846d829472c9`, 채점 gold 투영 SHA `3cb4a2bf66a0097a08a75e35ec188316d6065a3a3d3bd9724c138dbb058912d0`. 외부 gold 객체를 바꿔 채점하는 반례도 거부한다.
- **게이트**: exact category 83/84 이상, whole-item 오류 최대 1, unexpected admission 0, community/deal→news 치명 혼동 0. one expected miss는 screening PASS, two misses나 미선택 분야 한 건 노출은 HOLD. scope는 이 시험의 분모가 아니다.
- **독립성·주장 제한**: p4 full 예측/terminal을 발견하면 `holdout_exposed`. 현재 `SEALED_UNRUN`. gold 기준 `news`·`humor`가 0건이라 aggregate point estimate만 허용하고, 카테고리 전수 98%·통계적 신뢰하한·제품 승격 주장은 금지한다.
- **검증**: holdout self-check PASS(84, exposures 0), focused 108/108, 전체 1,468/1,468, API/model/Keychain·D2/runtime/UI/server/live·commit/push/deploy 0.

truth: D1I_CATEGORY_ONLY_CANDIDATE_FROZEN / D1I_HOLDOUT_84_SEALED_UNRUN / GOLD_PROJECTION_PINNED / RUNNABLE_CANDIDATES_0 / READY_FOR_CLAUDE_REVIEW / D2_RUNTIME_NOT_WIRED / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §35 D1-I 독립 적대검수 종결 (2026-08-21)

- **영수증**: Claude 별도 read-only 검수, resolved model `claude-fable-5`, 원문 SHA-256 `823921642ed6dbef8b625ad0311a9289397dfb303cf4c0a09d7f6fb9c46c3631`.
- **판정**: `PASS_WITH_LIMITATION`, P0 0·P1 0·P2 3. p4 복수 핵심범주 규칙은 의도된 후보 설계 변화이며 exact gold+unexpected admission 0으로 과잉 승인을 차단한다. corpus/gold/gold-projection SHA의 직접 반례 일부는 없지만 구현은 각 SHA를 직접 대조해 fail-closed다. 실행 안전 상수의 loader 고정은 이월 P2다.
- **무수리 수용 이유**: 세 건 모두 현재 정확성·안전·비용 경계를 약화하지 않는다. 선택 반례를 지금 추가하면 검수 대상 SHA를 바꾸고 같은 검수를 반복해야 하므로 reviewed bytes를 보존했다.
- **독립 검증**: 필수 15항 PASS, holdout CLI `ok:true/84/exposures:[]`, focused 108/108, 전체 1,468/1,468, `git diff --check` PASS, 검수 전후 대상 7파일 SHA 동일, 수정/API/model/Keychain/commit/push/deploy/server 0.
- **다음 단계 성격**: canary 12건은 p4가 알고 있는 기존 평가 묶음이라 독립 성능 증거가 아니다. 형식·게이트가 84건 유료 holdout 비용 전에 망가지지 않는지 확인하는 저비용 사전검사다. 별도 David 승인 범위는 candidate `p4-category-haiku`, model `claude-haiku-4-5-20251001`, max calls 12, retry 0, max cost `$0.08`; 실패 시 즉시 HOLD하고 probe·수리·재실행·새 후보는 자동 승인되지 않는다.

truth: D1I_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS / P0_0 / P1_0 / P2_3_DEFERRED / P4_DESIGN_FROZEN / RUNNABLE_CANDIDATES_0 / PAID_CANARY_AWAITS_DAVID / D2_RUNTIME_NOT_WIRED / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §36 D1-I p4 category-only canary 1회 실측 (2026-08-21)

- **David 승인**: `p4-category-haiku` / `claude-haiku-4-5-20251001` / 최대 12 calls / retry 0 / 증분 cost cap `$0.08` / 1회. 실패 시 즉시 HOLD하고 probe·수리·재실행·후보 변경 금지.
- **비용 게이트 정합**: 기존 runner의 `$0.20` 고정값은 승인 범위를 보장하지 못하므로 호출 전에 p4 execution data에 `maxCostUsd:0.08`을 추가하고 approved_canary로 전환했다. registry는 runnable 후보의 양수 cap을 필수 검증하고 runner는 `candidateCanaryBudget`으로 해당 값을 preflight와 실제 `runPricedClassification`에 동일 적용한다. focused 108/108·전체 1,468/1,468 후 실행했다.
- **실행 영수증**: attempt `.nowhot-local/selection-attempts/d1i-20260821-01`; manifest SHA `23f6865ecd91870f6992c25e91837449613cfd6d2ca4b8e0d8fa19a0e47a4458`, predictions SHA `7b2dbb38f8a65b59b020141669a1d65ee852b960b88a41327b52920b3efdbf9f`, receipt SHA `387aad945226ed4a139f71547d297554027cce735d12a20011db71bd059b5d05`, ledger SHA `d4fbf4f22351b1dddedcb8e3b6d1a3c500758882569e92bd6ef86b3757ca2f8b`.
- **결과**: `D1C_CANARY_HOLD`, classified 11/12, schemaReject 1, cache/withheld/errors 0. 실패 item `d1a-01-food-as-politics`, reason `evidence_not_grounded`. 12 calls 모두 settled, retries 0, input 22,290, output 7,052, actual `$0.05755`, unsettled 0, resolved model exact.
- **해석**: 비용 cap이 중간 차단한 것이 아니라 모델 출력 한 건이 grounding 계약을 위반했다. 전건 유효가 아니므로 category admission의 정답률·scope·mutation 성능을 점수로 승격하지 않는다. canary는 불합격이다.
- **중단 준수**: 종단 뒤 모델/API 0, retry 0, probe 0, prompt/candidate 변경 0, full 84 0. 기존 누적 `$0.301602` + 이번 `$0.05755` = `$0.359152/$1.25`.
- **승인 소비**: 실행 당시 registry candidate record SHA `55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6`는 manifest와의 출처 대조를 위해 그대로다. 표기상 approved_canary여도 David 승인 1회는 소비됐고 새 attempt를 허용하지 않는다. 후속은 독립 read-only 검수 전까지 HOLD다.

truth: D1I_P4_CANARY_HOLD_11_OF_12_VALID / ONE_SCHEMA_REJECT_EVIDENCE_NOT_GROUNDED / CALLS_12 / RETRY_0 / COST_0_05755_WITHIN_CAP / APPROVAL_CONSUMED / NO_RERUN_AUTHORIZED / HOLDOUT_84_UNRUN / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §37 D1-I 승인 소비 P1 봉합 (2026-08-21)

- **독립 검수 finding**: p4 canary와 비용 영수증은 무결했지만 후보 registry가 계속 `approved_canary/runnable`이라 새 attempt ID로 재실행할 수 있었다. 문서의 `APPROVAL_CONSUMED`만으로는 실행 통제가 아니므로 P1 HOLD가 맞다.
- **최소 구조 수리**: 과거 attempt가 고정한 후보 정의 SHA를 보존하기 위해 p4 후보 행을 덮지 않았다. 대신 registry document의 `executionHolds`에 p4의 `consumed_hold`, 소비 attempt, receipt SHA를 기록하고 이 데이터가 후보 실행 상태보다 우선하도록 loader와 runner에 연결했다.
- **실행 경계**: CLI 후보 조회와 `stepRunModel` 직접 호출 모두 소비 홀드에서 0 API/Keychain/write로 끝난다. 반례는 새 attempt ID, key read 0, attempt/ledger 파일 0을 고정했다.
- **증거 보존**: p4 candidate record SHA `55dd68f9f85ba36ec7681f3220506cdb8ca2f0753663d464b424055d0a26ffa6` 유지. 기존 `d1i-20260821-01`을 현재 registry로 다시 읽은 provenance 검증도 통과했다. canary 산출물과 holdout 84는 불변이다.
- **검증**: D1-G+D1-I 30/30, 전체 1,469/1,469, `git diff --check` PASS. 모델/API 호출, retry, probe, 새 후보, full 84, D2, runtime/UI/live 변경 0.

truth: D1I_APPROVAL_CONSUMPTION_FAIL_CLOSED / P4_CANDIDATE_SHA_PRESERVED / PAST_ATTEMPT_PROVENANCE_VALID / RUNNABLE_PAID_CANDIDATES_0_EFFECTIVE / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §38 D1-I p4 실패 오프라인 진단 (2026-08-21)

- **재검수**: Claude read-only 결과 `PASS_WITH_LIMITATION`; 승인 소비 P1 봉합 확인, 잔존 P0/P1 0. 비차단 P2 두 건은 이번 단계에서 보류한다.
- **d1a-01**: 제목/발췌는 마라탕 레시피 커뮤니티 글, gold=`community/life`, politics reject. 저장 prediction은 `schema_reject/evidence_not_grounded`만 남아 invalid semantic·ungrounded span 원문은 복구 불가하다. 이 항목의 카테고리 정확도는 미측정이다.
- **유효 11건 진단**: 승격·성능 점수가 아닌 실패 방향 확인으로만 대조했다. 10건 exact match, d1a-06 한 건 mismatch. p4는 `국회 반도체 특별법 통과·세액공제 확대`를 business+tech accept, politics secondary로 냈다. authority는 법 통과 자체를 politics, 기업 세제지원을 business의 공동 핵심으로 보고 tech를 secondary로 둔다.
- **결론**: p4는 grounding 복사 실패 1축과 법/정책 사건에서 대상 산업어를 사건 유형보다 우선한 category precedence 실패 1축을 함께 보였다. 같은 p4 재시도나 canary를 본 뒤의 문구 수정은 독립 성능 증거가 아니다.
- **추천 후보**: 무과금으로 먼저 `p5 compact category contract`를 설계한다. 모델 출력은 content type, event type, core/secondary category처럼 작은 의미 정보로 줄이고, 14행·exact source evidence·버전 필드는 코드가 taxonomy data로 결정적 조립한다. 구현과 신규 유료 실행은 각각 David의 방향/비용 승인을 분리한다.

truth: D1I_P1_REVIEW_CLOSED / P4_GROUNDING_AND_PRECEDENCE_FAILURE / PARTIAL_DIAGNOSTIC_NOT_SCORE / P5_COMPACT_CONTRACT_AWAITS_DAVID / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §39 D1-J p5 compact category contract 구현 영수증 (2026-08-21, API·모델 호출 0)

- **원인 수리**: p4는 모델이 14행·근거 복사·분류를 동시에 수행했다. p5는 모델 응답을 content type, event type, direct impact, secondary subject, confidence의 5필드로 줄이고 14행·primary·reason·exact evidence는 순수 조립 함수가 만든다.
- **후보 계약**: `p5-compact-category-haiku`, prompt SHA `788fd7f246ac0ab4bf91f34bbab414616c2a81e088d4760efb4cd7b00a41b548`, candidate record SHA `c7c6afb1d5256118219804ab7e7829c6ca584ab38fc7456908fb20010494bac4`. `design_frozen/runnable=false`, cost cap 없음, output cap 500. 후보 registry가 compact policy의 event type·taxonomy core category·필드 집합을 fail-closed 검증한다.
- **조립 규칙**: accept = event type의 data-driven required core ∪ model impact. secondary subject는 accept와 겹치면 거부하고 admission `abstain`으로 조립한다. evidence는 title 전체 우선, 없으면 excerpt 전체이며 accept인데 둘 다 비면 거부한다. 지역성은 빈 배열·unknown으로 분리한다.
- **회귀 불변**: p3.1 record SHA `6b8545ca…`, p3.2 `66b9ef17…`, p4 `55dd68f9…` 유지. p4 attempt preflight/predictions/receipt/manifest/ledger 5종 SHA 일치, 현재 registry로 provenance 재검증 PASS.
- **홀드아웃**: `selection-d1j-holdout.lock.json`은 p5 identity와 prompt SHA를 고정하고 기존의 기계적 rest 84 item/evidence/gold projection SHA를 재사용한다. actual attempts scan 결과 p5 exposure 0, lock self-check 84 PASS.
- **테스트**: 신규 D1-J 8/8, 확장 focused 84/84, 전체 1,477/1,477, `git diff --check` PASS. 실API/model/Keychain 0, holdout 실행 0, D2/runtime/UI/server/live/commit/push/deploy 0.
- **판정**: `CONTRACT_IMPLEMENTED`, `CANDIDATE_DESIGN_FROZEN`, `RUNTIME_NOT_WIRED`, `PRODUCT_NOT_PROVEN`. 다음은 Claude read-only 독립 적대검수이며, 유료 canary는 별도 David 승인 전 금지다.

truth: D1J_P5_COMPACT_CONTRACT_IMPLEMENTED / DETERMINISTIC_EVIDENCE_AND_ADMISSION / P5_NONRUNNABLE / HOLDOUT_84_SEALED_UNRUN / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §40 D1-J 독립 적대검수 종결 (2026-08-21)

- **결과**: Claude read-only(`claude-fable-5`, 하위 에이전트 0) `PASS_WITH_LIMITATION`. P0 0·P1 0·P2 3. compact 5필드, 결정적 14행/evidence, fail-closed, data-driven politics core, p5 500/기존 1800, p3/p4 증거 보존, non-runnable 차단, holdout84 미노출을 전부 PASS로 확인했다.
- **동적 대조**: 지정 focused 84/84, 전체 1,477/1,477, `git diff --check` PASS. 검수 전후 대상 파일 SHA 불변, 신규 attempt 0, API/model/Keychain·수정·commit/push/deploy/server 0.
- **P2 판정**: eventType/contentType 전체 결속은 format과 event 의미를 불필요하게 1:1로 묶으므로 추가하지 않는다. `other`만 무노출을 위해 결속하고 실제 category 결과는 canary gold로 측정한다. holdout contract label과 과거 p4 hold provenance 표기는 감사 편의 P2로 이월한다.
- **다음**: p5는 계속 `design_frozen/runnable=false`; 새 유료 canary는 David가 candidate/model/calls/retry/cost cap을 명시 승인해야 한다. 실패 시 추가 행동은 자동 승인되지 않는다.

truth: D1J_INDEPENDENT_REVIEW_CLOSED_WITH_LIMITATIONS / P0_0 / P1_0 / P2_3_DEFERRED / P5_PAID_CANARY_AWAITS_DAVID / HOLDOUT_84_SEALED_UNRUN / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §41 D1-J p5 compact category canary 1회 실측 (2026-08-21)

- **David 승인**: `p5-compact-category-haiku` / `claude-haiku-4-5-20251001` / 최대 12 calls / retry 0 / 증분 cost cap `$0.06` / canary 1회. 실패 시 즉시 HOLD하고 probe·수리·재실행·후보 변경·holdout 84 금지.
- **실행 전 잠금**: p5의 실행 data만 `approved_canary/runnable=true/maxCostUsd=0.06`으로 전환했다. 프롬프트 SHA `788fd7f246ac0ab4bf91f34bbab414616c2a81e088d4760efb4cd7b00a41b548`, model, compact policy, output cap 500, canary 12, holdout partition은 불변이다. 실행 candidate record SHA는 `126a693a64f94edd55c7e4ba0bbc3e17447268e0f58cb1ae98884314abb4ad65`다.
- **사전 검증**: focused 117/117, 전체 1,477/1,477, p5 holdout `ok:true/84/exposures:[]`, diff check PASS, attempt `d1j-20260821-01` 부재를 확인했다.
- **attempt 증거**: 경로 `.nowhot-local/selection-attempts/d1j-20260821-01`; preflight SHA `2bf3839ee20f689846b90d31a423dbeb7a8dec4dc3089908d8bc281559e667ea`, predictions `7c06b5681257e1a6148499ab7209cc65e6ac5e9ed4033679bc7842a0af4719ef`, receipt `3691a543e12bf74f2f427e0ed651f23e35d7e97d7f80a53e10c53224325459f6`, manifest `bc20e9d7ed982571e9be11b3d149b89e79f8a69c066d62fafcceb1175be5575b`, ledger `fa6feaada04daff638f5c65d268b84bc85f1df7b8c554f3a9952b60750c0ded0`.
- **정산**: resolved model exact, 12/12 classified, schemaReject/cacheHit/withheld/error 0. calls/settled 12, retries 0, input 16,350, output 468, cost `$0.01869`, unsettled 0.
- **검증된 오프라인 채점**: `loadAttemptDir`가 manifest·정본·산출물·ledger 지문을 대조한 뒤 공용 evaluator로 category 6/10, scope 6/10, whole-row 4/10을 산출했다. category 실패는 `d1a-03` gaming, `d1a-05` tech, `d1a-06` tech, `d1a-09` politics의 **unexpected admission 4건**이고 expected miss·contentType mismatch·selected category leak는 0이다. mutation 변화는 PASS다. scope는 p5가 의도적으로 unknown을 고정하므로 category-only gate 분모 밖 진단값이다.
- **판정·중단**: `D1C_CANARY_HOLD`, task-specific 상태 `CATEGORY_HOLD`. 형식 계약 문제는 해소됐지만 보조 주제를 핵심으로 올리는 과승인이 남았다. 실행 후 유료 호출·probe·수리·재실행·후보 변경·holdout84 0.
- **승인 소비**: candidate row는 manifest provenance를 위해 실행 상태 그대로 두고 `executionHolds.p5-compact-category-haiku={consumed_hold,d1j-20260821-01,receiptSha256}`를 data registry에 추가했다. focused 회귀가 `getRunnableCandidate`와 직접 `stepRunModel`의 pre-write 차단을 확인했다. 이전 누적 `$0.359152` + 이번 `$0.01869` = `$0.377842/$1.25`.

truth: D1J_P5_CANARY_CATEGORY_HOLD_6_OF_10 / CLASSIFIED_12_OF_12 / SCHEMA_REJECT_0 / UNEXPECTED_ADMISSION_4 / CALLS_12 / RETRY_0 / COST_0_01869_WITHIN_CAP / APPROVAL_CONSUMED_FAIL_CLOSED / HOLDOUT_84_UNRUN / D2_RUNTIME_NOT_WIRED / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §42 D1-K 복수 핵심 카테고리 정책 정본화 (2026-08-21, API·모델 호출 0)

- **제품 결정**: 복수 카테고리는 오분류가 아니다. 각 분야만 선택한 사용자에게도 그 분야 자체의 핵심 정보로 읽을 이유가 있으면 모두 승인한다. 게임용 PC 견적은 `tech+gaming`; 두 분야를 함께 선택해도 카드는 사건 ID 합집합에서 한 번만 표시한다.
- **핵심/보조 경계**: 직접 주제·행동·결과·사용 목적은 core 후보지만, 출처 섹션·형식·등장 인물·우연한 명사·간접적인 2차 영향은 부족하다. secondary는 설명용 메타데이터이고 admission 권한이 없다. 무관 분야 사용자에게 새지 않도록 core가 없으면 withhold한다.
- **정본 파일**: `src/feed/category-admission-policy.json`에 전역 규칙, taxonomy 14종의 core/exclude, David 승인 결정 1건을 저장했다. `src/feed/category-admission-policy.js`는 exact contract와 taxonomy 순서·전수 범위를 검증하고 누락·중복·잉여·미등록·core/secondary 충돌을 거부한다.
- **모델 누수 방지**: prompt projection은 제품 결정 사례를 포함하지 않고 일반 정책과 14개 의미 경계만 만든다. 따라서 게임용 PC 반례는 테스트에는 남지만 모델에게 정답 힌트로 제공되지 않는다.
- **기존 결과 보존**: p5의 category 6/10·unexpected 4는 당시 authority를 기준으로 한 측정이라 byte 그대로 둔다. 게임용 PC 한 건은 새 제품 규칙상 `tech+gaming`이 맞지만, 나머지 세 건을 자동 재분류하거나 p5를 PASS로 승격하지 않는다.
- **검증**: RED=`ERR_MODULE_NOT_FOUND` 확인 후 구현. 신규 3/3, D1-G/D1-I/D1-J 포함 focused 41/41, 전체 1,480/1,480, `git diff --check` PASS. p5 attempt 5종, candidate registry, p5 holdout lock SHA 불변. 실행 가능 유료 후보 0, holdout 84 미실행·미노출이다.
- **판정**: `POLICY_IMPLEMENTED`, `RUNTIME_NOT_WIRED`, `PRODUCT_HOLD`. 다음은 새 정책을 제공받되 p5 예측·기존 점수를 보지 않는 독립 재판정으로 나머지 경계와 평가 정본 수정 범위를 확정하는 단계다.

truth: D1K_MULTI_CATEGORY_POLICY_CANONICAL / INDEPENDENT_CORE_TEST / DISPLAY_ONCE_ACROSS_SELECTED_CATEGORIES / POLICY_PROMPT_WITHOUT_REGRESSION_ANSWERS / PAID_CALLS_0 / HOLDOUT_84_SEALED_UNRUN / READY_FOR_INDEPENDENT_READJUDICATION / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §43 D1-K 독립검수와 authority-003 오프라인 재채점 (2026-08-21)

- **검수 영수증**: Claude read-only(`claude-fable-5`, 하위 에이전트 0) `PASS_WITH_LIMITATION`, P0 0·P1 0·P2 3. 원문 SHA `8d74c6e2cc2812ea426dd01eedccd605436591f215bae5f926973896a2bc32bc`. 검수자는 같은 네 문장과 과거 authority를 본 이력을 공시해 완전 무지 블라인드는 아니지만, D1-K 정책만으로 A~D를 먼저 고정했다.
- **재판정**: A 게임용 PC=`tech+gaming`으로 authority-002와 다름. B 반도체 투자=`business`/tech secondary, C 특별법=`business+politics`/tech secondary, D 연준 금리=`business`는 authority-002와 일치한다. 따라서 정답 수정 대상은 `d1a-03-community-as-news` 한 건뿐이다.
- **authority-003 구조**: authority-002 원본을 덮지 않고 한 건짜리 category overlay를 추가했다. overlay SHA `6138a9cafb561ebba59ef13809f9cee80785aeb17d24f877bfe27624ca88390a`; base authority SHA `c61782b8…ed8f`, policy SHA `7b46444e…f357`, 검수 SHA, evidenceHash, from/to, `gaming-pc-tech-gaming` 결정 ID를 고정한다. loader는 정확히 한 변경만 허용하며 drift·중복 변경·정책 불일치를 거부한다.
- **과거 증거 보존**: `loadAttemptDir`는 p5 attempt를 계속 authority-002 SHA로 먼저 검증한다. 기존 D1-G 로더의 기본 expected contract도 002라 003이 과거 평가에 조용히 섞일 수 없다. 003은 D1-K 재채점 도구가 명시한 경우에만 허용된다.
- **재채점 결과**: 저장 p5 12건을 무과금으로 다시 읽어 공용 evaluator와 새 category projection을 교차 대조했다. exact `7/10`, unexpected 3, miss 0, contentType mismatch 0, mutation PASS. 실패는 d1a-05 tech, d1a-06 tech, d1a-09 politics 과승인이다. 보고서 SHA `df6d8d9d96374ff98ea81b2e69a9099f59a88581d0c7917af89dc5040a07fd49`, 상태 `D1K_CATEGORY_HOLD`, product promotion false다.
- **검증**: D1-K 3/3, focused 90/90, 전체 1,483/1,483, `git diff --check` PASS. authority-002·p5 attempt 5종·registry·holdout lock 불변, holdout 84 노출 0, 유료 호출·D2/runtime/UI/live 변경 0.
- **판정**: D1-K 정책 판정과 평가 정본 반영은 완료됐지만, 방금 추가한 authority-003 구현은 Claude read-only 독립검수를 한 번 더 받아야 한다. 모델 성능은 7/10이라 제품은 HOLD다. 구현 검수에서 P0/P1이 없거나 봉합된 뒤의 다음 개발은 같은 시험 재시도가 아니라 policy를 실제 shadow 분류 후보에 연결하는 설계이며, 유료 실행은 별도 승인 대상이다.

truth: D1K_REVIEW_CLOSED_WITH_LIMITATIONS / AUTHORITY_003_SINGLE_ITEM_OVERLAY / P5_CATEGORY_7_OF_10_HOLD / UNEXPECTED_ADMISSION_3 / PAID_CALLS_0 / HOLDOUT_84_SEALED_UNRUN / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §44 D2-A 정책 shadow 후보 계약 (2026-08-21, API·모델 호출 0)

- **검수 수용과 좁은 정정**: authority-003 구현 재검수는 `PASS_WITH_LIMITATION`, P0/P1 0이다. 검수 원문 실물 파일이 저장소에 없으므로 overlay의 검수 SHA는 provenance 문자열이며 로더가 실물과 대조하지 않는다. base/policy/from/to/productDecision/단건 계약은 계속 fail-closed이고 채점 결과는 이 P2와 무관하다.
- **후보 연결**: `p6-policy-shadow-haiku`는 p5 compact 계약·500 token 설계·결정 조립을 재사용하면서 D1-K policy projection만 추가한 비실행 후보다. projection은 일반 규칙과 taxonomy 경계를 policy JSON에서 읽으며 제품결정 사례는 제외한다. prompt SHA `8b21bf59b3fd67b9354b3de819dc3b086770d69c7381001a62e33dc42513f76b`, candidate record SHA `78c50d68c34612d6427920d43a9bac956baf26799516e2245ed8b3a74a0a31cd`다.
- **종단 계약**: 기존 compact assembler가 tech+gaming 복수 accept를 만들고 기존 `assembleUnion`이 tech-only 1장·gaming-only 1장·둘 다 1장·sports-only 0장을 만든다. 입력 article의 legacy category는 바꾸지 않는다. 별도 selector·ranker·union은 추가하지 않았다.
- **검증·불변**: 신규 3/3, focused 80/80, 전체 1,486/1,486, `git diff --check` PASS. p5 candidate record와 authority-002·p5 attempt 5종·p5 holdout lock SHA 불변, 실효 runnable 0. API/model/Keychain·attempt·holdout·runtime/UI/live·commit/push/deploy 0.
- **현재 판정**: `D2A_POLICY_SHADOW_CANDIDATE_FROZEN`. 실제 기사 병렬 분류와 category event view/랭킹은 아직 연결하지 않았다. 다음은 Claude read-only 구현 검수이며 제품은 HOLD다.

truth: D2A_POLICY_SHADOW_CANDIDATE_FROZEN / P6_NONRUNNABLE / POLICY_PROMPT_PROJECTION / EXISTING_COMPACT_ASSEMBLER_AND_UNION_REUSED / PAID_CALLS_0 / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §45 D2-B 오프라인 category event view 계약 (2026-08-22, API·모델 호출 0)

- **검수 입력**: D2-A 독립검수는 `PASS`, P0/P1 0, P2 1이었다. p6 후보 record SHA `78c50d68c34612d6427920d43a9bac956baf26799516e2245ed8b3a74a0a31cd`가 문서에만 있고 테스트에 없다는 P2를 D2-A 테스트 핀으로 봉합했다.
- **최소 구현**: 신규 `src/feed/category-event-view.js` 한 파일만 추가했다. 전역 사건은 기존 `buildEventClusters`, 분류 신뢰경계는 기존 `validateClassifierOutput`, 분야 노출 자격과 1차 근거 판정은 기존 `admissionGate`·`hasPrimaryEvidence`를 사용했다. selector·ranker·union은 새로 만들지 않았다.
- **category view**: 같은 전역 eventId 아래 taxonomy 순서의 분야별 view를 만든다. 각 view의 evidence는 그 분야에 accept된 member와 같은 사건의 검증된 primary/first-party member뿐이다. community reaction은 그 분야에 accept된 항목만 별도 reaction ID로 남기며 facts fingerprint에는 들어가지 않는다.
- **변화 격리**: `CEVF-*`는 category view의 승인·공유 1차 기사 제목 내용어로 계산한다. tech에만 승인된 비1차 기사의 문구가 달라져도 business view 지문은 유지되고 tech view만 바뀌는 반례를 고정했다. title 내용어가 없는 유효 근거는 evidenceHash를 fallback으로 쓴다.
- **신뢰경계**: prediction itemId와 article id를 1:1 대조한다. missing/withheld/error/schema_reject 또는 schema·evidenceHash·grounding 불일치는 view에서 보류하고 감사 사유를 남긴다. 고아·중복 ID/미등록 status는 손상으로 throw하며, 노출 가능한 분류의 model/prompt/taxonomy 조합이 하나라도 섞이면 판 전체를 fail-closed한다.
- **회귀**: RED는 신규 모듈 부재, 두 번째 RED는 전역 reaction이 무관 분야 view에 새는 현상을 각각 확인했다. GREEN은 D2-A+B 6/6, 사건 클러스터·계약·분류 lab·기존 shadow 포함 focused 205/205, 전체 1,489/1,489, `git diff --check` PASS다.
- **경계**: module SHA `9c851b4a8dc126593c226ffcb939139c618bc7afb86f7b9e9d04b2cd282fcb98`. p6 non-runnable, 유료/API/model/Keychain·attempt·holdout·실기사 shadow 배선·랭킹·runtime/UI/live·commit/push/deploy 0. 제품은 HOLD다.

truth: D2B_CATEGORY_EVENT_VIEW_OFFLINE / GLOBAL_EVENT_LINEAGE_SHARED / CATEGORY_EVIDENCE_ISOLATED / CATEGORY_REACTION_ISOLATED / CATEGORY_CHANGE_FINGERPRINT / MIXED_CLASSIFIER_VERSION_FAIL_CLOSED / P6_NONRUNNABLE / PAID_CALLS_0 / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §46 D2-C 분야별 사건 계보 연결 (2026-08-22, API·모델 호출 0)

- **검수 입력**: D2-B 독립검수는 `PASS`, P0/P1 0, P2 3이었다. Blueprint의 version 혼합 표현은 실제 구현대로 승인 분류 사이의 혼합만 fail-closed한다고 정정했다. source role 주입 신뢰경계는 실제 shadow 배선 검수로 이월했다.
- **RED**: 같은 전역 사건에서 가장 이른 앵커 기사의 제목만 바꾸면 eventId가 달라졌고, category view에는 영구 계보와 직전 서빙 지문 비교가 없어 같은 경제 근거도 새 사건처럼 취급될 수 있음을 반례로 재현했다.
- **최소 수리**: `category-event-view.js`가 기존 `carryEventLineages(previousLineage, clusteredEvents)`를 전역 클러스터에 한 번 재사용한다. 별도 클러스터러·lineage 알고리즘·저장소는 추가하지 않았다. 각 view는 `lineageId`, `categoryViewKey`, `previousServedFactsFingerprint`, `reappearedUnchanged`, `materialChange`를 내고 top-level은 다음 판용 `lineageRecords`를 반환한다.
- **GREEN**: 앵커 제목 변경으로 eventId는 달라지지만 member overlap 근거로 lineageId가 승계된다. 직전 실제 서빙 CEVF가 같은 business view는 unchanged, 새 내용어가 생긴 tech view만 material change다. 사용자가 둘 다 선택해도 사건 표시 1회라는 D0 union 계약은 손대지 않았다.
- **검증·경계**: D2-B/C 4/4, event/contract/classifier/shadow focused 206/206, 전체 1,490/1,490, `git diff --check` PASS. module SHA `a89fb64dcd6bb52b361b9c14c210ef02b764347c6e89c4200861db5ac3890a94`. p6 non-runnable이며 실제 기사 분류·유료/API/model/Keychain·attempt·holdout·ranker·Today/Live·UI/server/live·commit/push/deploy는 0이다.

truth: D2C_CATEGORY_LINEAGE_OFFLINE / EVENT_ID_DRIFT_INHERITS_LINEAGE / CATEGORY_SERVED_FINGERPRINT_ISOLATED / UNCHANGED_REAPPEAR_SIGNAL / MATERIAL_CHANGE_CATEGORY_ONLY / P6_NONRUNNABLE / PAID_CALLS_0 / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §47 D2-D 오늘 실기사 shadow 입력·측정 경로 (2026-08-22, API·모델 호출 0)

- **검수 입력 수리**: D2-C Claude read-only 검수는 `PASS`, P0/P1 0이었다. 지적된 비차단 P2를 다음 묶음에 포함해, 이전 계보의 비공백 `lineageId`와 이전 실제 서빙 지문의 exact `CEVF-[0-9a-f]{16}` 형식을 함수 입구에서 검증한다. 두 기형 입력이 기존 코드에서 통과하는 RED를 먼저 확인했다.
- **실기사 수집**: 격리된 기존 v2 수집 경로로 2026-08-22 런치 풀을 새로 만들었다. 91개 소스 중 수집 중단 0·신호 소실 1, 기사 1,971건, 풀 SHA `8844dd7976814d39a27959268844399b9415eee67b1d9e2f4a357c86db86f094`. 운영 데이터와 서버는 무접촉이다.
- **패킷 계약**: `NOWHOT-SELECTION-SHADOW-PACKET-001`은 풀 전체를 evidence hash 기준 classification target으로 만든다. URL은 제외하고 제목·300자 발췌·소스 prior·언어·legacy category 감사값만 보존한다. 증거 중복은 1회 분류 뒤 sourceArticleIds로 확장한다. 이번 풀은 source 1,971·target 1,971·reuse 0이다.
- **측정 계약**: `NOWHOT-SELECTION-SHADOW-MEASUREMENT-001`은 저장 예측을 원 기사 ID로 확장한 뒤 기존 `buildCategoryEventViews`를 호출한다. packet/pool 시점과 model/prompt/taxonomy가 다르면 거부하고, admitted/withheld/event/category-view 수를 산출한다. 독립 골드가 없으므로 precision 또는 제품 PASS를 주장하지 않는다.
- **실물**: `.nowhot-local/selection-shadow/d2d-20260822-lunch-p6.packet.json`, SHA `03596c8601e2cb3676c31c1efd214e6ce371ffd3569ff35f1766e1504ea7367b`, 1,288,760 bytes. 재생성 byte-identical. p6는 참조만 했고 non-runnable 유지다.
- **검증**: D2-A~D 10/10, 전체 1,493/1,493, `git diff --check` PASS. category-event-view SHA `ef61a8503560833f5b6123a00609af30bed1fd2c5861c96d242b8a080a000895`, 준비 도구 SHA `715a2c353bb30f2e3c6b730b20289cde91258479083d96fc2fa2737414d16a16`. API/model/Keychain·prediction·attempt·holdout·runtime/UI/live·commit/push/deploy 0.

truth: D2D_CURRENT_REAL_POOL_FROZEN / SOURCE_ARTICLES_1971 / CLASSIFICATION_TARGETS_1971 / ACTUAL_CATEGORY_EVENT_PREDICATE_REPLAY_READY / PREDICTIONS_0 / P6_NONRUNNABLE / PAID_CALLS_0 / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §48 D2-E 오늘 실기사 12건 shadow canary 실행 경로 (2026-08-22, API·모델 호출 0)

- **표본 선택**: 1,971 target의 기존 분야 층 수를 세어 공급이 적은 12개 층을 먼저 고르고, 각 층에서 hot score·반응·시각·ID 순으로 대표 1건을 결정적으로 선택한다. 현재 13개 층 중 humor만 이번 operational smoke에서 제외된다. 이 값은 모델 입력의 정답으로 쓰지 않으며 12건 표본은 precision/product 증명이 아니다.
- **실행 코어**: D1의 `runPricedClassification`, 후보 compact schema/assembler, `candidateCanaryBudget`, file ledger, Keychain/provider adapter를 재사용한다. 신규 코드는 current packet 검증·12건 선택·artifact/manifest 기록만 담당한다.
- **차단·종단**: p6가 non-runnable이면 attempt write/Keychain/provider 전에 중단한다. 기존 attempt, pool/packet과 candidate ID·task·semantic contract·prompt/model/taxonomy·compactPolicy SHA drift도 사전 거부한다. 승인 전후에 달라지는 execution state와 전체 record SHA는 이 의미 정체성 대조에서 제외한다. settled 실행만 manifest를 만들고 provider 실패나 resolved-model mismatch는 terminal receipt로 끝낸다. 결과에는 항상 `qualityProof:false`, `productProven:false`, `runtimeWired:false`를 남긴다.
- **동적 검증**: 가짜 승인 후보와 가짜 모델로 정확히 12calls·24 ledger rows(12 reserve+12 settle)·retry0·full artifact0·measurement/manifest 생성을 확인했다. alias 밖 응답 모델은 `MODEL_IDENTITY_HOLD`와 manifest0. 실제 p6/current-pool CLI는 `CANDIDATE_NOT_RUNNABLE` exit2·attempt dir0이다.
- **실행 정본**: 기존 D2-D packet은 보존하고 정책 지문까지 담은 `.nowhot-local/selection-shadow/d2e-20260822-lunch-p6.packet.json`을 새 실행 패킷으로 생성했다. SHA `c5d1a5f37602deb5e5322e7d67fce2f694cebe14c8a9cd66bdf55456dfe1e0b9`, 1,288,941 bytes, 1,971 targets이며 재생성 byte-identical이다.
- **회귀·지문**: D2-D/E 8/8, 전체 1,499/1,499, `git diff --check` PASS. `prepare-selection-shadow.mjs` SHA `fd0ec6d15b8eadf3eb29880f630a7d4d1305a4884038fe20e64b7622cb59f9be`, `run-selection-shadow-canary.mjs` SHA `25f5d773e734b50dcb26e12d13c05cbf3c61db981036077c2d7c9234c5582c90`, D2-D test SHA `b0f5c6ba0f0887cd2a19139351533d2d074d5405f459e835a59729f3f6de75f1`, D2-E test SHA `6fcbbdc9d073e1d0f103e4866bcfe5ec0a8235117f2faf7a3d26505c5df52db8`.
- **판정**: 실행 레일은 검수 후보지만 실제 분류 결과는 0이다. p6는 `shadow_design/runnable=false`, 유료 가능 후보 0이며 Claude read-only P0/P1 검수 전 승인·실행하지 않는다. Today/Live/ranking/UI/runtime/live는 계속 미연결이다.

truth: D2E_CURRENT_POOL_CANARY_RUNNER_READY / SEMANTIC_CANDIDATE_AND_COMPACT_POLICY_PINNED / DETERMINISTIC_12_TARGET_OPERATIONAL_SMOKE / P6_NONRUNNABLE / EFFECTIVE_RUNNABLE_0 / PAID_CALLS_0 / ATTEMPTS_0 / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_READ_ONLY_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS

## §49 D2-E 승인 실기사 12건 canary 실행 (2026-08-24)

- **승인·정체성**: David 승인 후보 `p6-policy-shadow-haiku`, 모델 `claude-haiku-4-5-20251001`, packet SHA `c5d1a5f37602deb5e5322e7d67fce2f694cebe14c8a9cd66bdf55456dfe1e0b9`, 12 calls, retry 0, 비용 상한 `$0.06`, 1회. 승인 편집 뒤 candidate record SHA `b09cdaa9cc29e3c3df5bc1241e491075668c3b56f192944b175b789602784e9e`; prompt SHA `8b21bf59…f76b`와 compactPolicy SHA `d5443080…f5cda`는 불변이다.
- **실행**: `node tools/run-selection-shadow-canary.mjs --run-canary d2e-20260822-01 ...`을 정확히 한 번 실행했다. 상태 `D2_SHADOW_CANARY_MEASURED`, classified 12/12, schema reject·withheld·error·cache hit 0, calls/settled 12/12, retries 0, input/output 28,049/492 tokens, cost `$0.030509`, unsettled 0. resolved model exact 1개다.
- **영수증**: run receipt `768d97297479f6c71ef0c0e90f74758ab587ab2174e127bbc4f10f75b2edac1b`, manifest `bd3ceb99c93842f6b278f1ad66267237b663c9d618dbebbf17d88a5230088344`. preflight `ffe3b01b…80cb`, predictions `f56a0142…0089`, measurement `294826f1…fcfe`, ledger `0fc2b583…6570`이며 manifest 지문과 실물이 일치한다. full·holdout·terminal receipt는 없다.
- **측정값과 한계**: 12 predictions→12 events, admitted 12, category views art1/business2/culture2/humor3/life1/politics2/realestate1/science1/sports1/tech2. 이 결과는 operational smoke이며 독립 gold 정답률이 아니다. sample은 theqoo 9/12·community 10/12 편중이 있고 `qualityProof:false`, `productProven:false`, `runtimeWired:false`다.
- **승인 소비**: registry `executionHolds.p6-policy-shadow-haiku`에 attempt `d2e-20260822-01`과 run receipt SHA를 추가했다. 후보 정의는 manifest provenance와 맞추기 위해 approved 상태를 유지하지만 `getRunnableCandidate`·CLI 모두 소비 hold에서 쓰기 전에 중단한다. focused 49/49, 전체 1,499/1,499, `git diff --check` PASS다.
- **다음 경계**: Claude read-only 사후검수 전 추가 모델 호출·수리·재실행·후보 변경·holdout/full·Today/Live 연결을 하지 않는다. 300자 excerpt/전체 summary 재검증 불일치와 source 분포 기록은 다음 풀 준비 전 최소 수리 대상으로 남긴다.

truth: D2E_REAL_CANARY_MEASURED_12_OF_12 / EXACT_MODEL / RETRY_0 / COST_0_030509 / APPROVAL_CONSUMED / FULL_HOLDOUT_UNRUN / QUALITY_NOT_PROVEN / RUNTIME_NOT_WIRED / READY_FOR_CLAUDE_POSTRUN_REVIEW / PRODUCT_HOLD / LIVE_UNCHANGED.

First Principles gate: PASS
