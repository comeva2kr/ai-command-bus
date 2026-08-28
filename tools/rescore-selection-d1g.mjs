// NOWHOT D1-G — 재현 가능한 offline rescore. 실API 0. 같은 명령으로 report를 결정적으로 재생성한다.
//   node tools/rescore-selection-d1g.mjs
// 규칙(D1-G FINAL CLOSURE §6 + Codex P1-2):
//   - 채점 정본은 authority-002(decisive 10). 점수·게이트 판정은 공용 evaluator(evaluateCanaryD1d →
//     evaluatePredictions/evaluateGates 경로)를 재사용한다 — 별도 채점 공식 금지.
//   - 대체 반례(d1g-11/12)의 sealed prediction이 없으면 점수를 만들지 않고
//     INCOMPLETE_NEW_FIXTURE_PREDICTIONS로 HOLD한다. 부분 분모(8건) 점수·모델 순위 주장 금지.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadAdversarialAuthority, buildCanonicalAuthority, ledgerSummary } from "../src/feed/selection-classifier-lab.js";
import { d1gCanaryItems } from "./run-selection-d1c.mjs";
import { getCandidate } from "./selection-candidate-registry.mjs";
import { evaluateCanaryD1d } from "./run-selection-d1d.mjs";

const fileSha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const round6v = (n) => Math.round(n * 1e6) / 1e6;

// P1(재검수): attempt 디렉터리 검증 로더 — manifest 지문 체인을 fail-closed 대조한다.
// 실패는 전부 throw(RESCORE_ATTEMPT_CORRUPT). 임의 합성 predictions.json은 이 경로를 통과할 수 없다.
export function loadAttemptDir(dirAbs) {
  const fail = (m) => { throw new Error(`RESCORE_ATTEMPT_CORRUPT: ${m} (${dirAbs})`); };
  const mp = path.join(dirAbs, "attempt-manifest.json");
  if (!fs.existsSync(mp)) fail("attempt-manifest.json 없음 — predictions.json 단독 지정은 허용하지 않는다");
  let man; try { man = JSON.parse(fs.readFileSync(mp, "utf8")); } catch { fail("manifest JSON 파싱 실패"); }
  if (man.contract !== "NOWHOT-SELECTION-D1G-ATTEMPT-MANIFEST-002") fail("manifest contract id 불일치(002 필요)");
  for (const f of ["attemptId", "candidateId", "requestedModel", "promptVersion", "promptSha256", "pricing", "corpusSha256", "goldSha256", "gatesSha256", "authoritySha256", "predictionsSha256", "receiptSha256", "ledgerSha256"]) {
    if (man[f] == null || man[f] === "") fail(`manifest 필드 누락: ${f}`);
  }
  // 4차 P1-1·P1-3: 후보 레지스트리와 정확 대조 — requestedModel·프롬프트 전체 SHA-256·promptVersion·pricing.
  let cand; try { cand = getCandidate(man.candidateId); } catch (e) { fail(String(e.message)); }
  if (man.requestedModel !== cand.requestedModel) fail(`requestedModel ${man.requestedModel} != 레지스트리 ${cand.requestedModel}`);
  if (man.promptVersion !== cand.promptVersion) fail("promptVersion != 레지스트리");
  if (man.promptSha256 !== cand.promptSha256) fail("promptSha256(전체) != 레지스트리");
  if (JSON.stringify(man.pricing) !== JSON.stringify(cand.pricing)) fail("pricing != 레지스트리");
  if (man.candidateRecordSha256 != null && man.candidateRecordSha256 !== cand.candidateRecordSha256) fail("candidateRecordSha256 != 레지스트리");
  if (man.candidateRegistryContract != null && man.candidateRegistryContract !== cand.registryContract) fail("candidateRegistryContract != 레지스트리");
  if (man.candidateTask != null && man.candidateTask !== (cand.task || "combined_selection")) fail("candidateTask != 레지스트리");
  // 4차 P1-2: 실제 응답 모델은 정확히 1개, requestedModel 또는 고정 alias와 일치해야 한다.
  if (!Array.isArray(man.resolvedModels) || man.resolvedModels.length !== 1) fail(`resolvedModels는 정확히 1개여야 한다(got ${JSON.stringify(man.resolvedModels)})`);
  const rm = man.resolvedModels[0];
  if (rm !== cand.requestedModel && !cand.resolvedAliases.includes(rm)) fail(`실제 모델 '${rm}'이 요청 모델/alias와 불일치`);
  if (man.retries !== 0) fail(`retries must be 0, got ${man.retries}`);
  // 정본 지문: 현재 fixture 파일과 정확 일치해야 한다(다른 정본으로 만든 attempt 거부).
  const FIXP = (n) => path.join(ROOT, "test", "fixtures", n);
  if (fileSha(FIXP("selection-d1-corpus.json")) !== man.corpusSha256) fail("corpus SHA 불일치");
  if (fileSha(FIXP("selection-d1-gold.json")) !== man.goldSha256) fail("gold SHA 불일치");
  if (fileSha(FIXP("selection-d1-gates.lock.json")) !== man.gatesSha256) fail("gates SHA 불일치");
  if (fileSha(FIXP("selection-d1g-adversarial-authority-002.json")) !== man.authoritySha256) fail("authority SHA 불일치");
  // attempt 산출물 지문: predictions/receipt/ledger 바이트가 manifest와 정확 일치.
  const pp = path.join(dirAbs, "canary-predictions.json");
  const rp = path.join(dirAbs, "run-receipt.json");
  const lp = path.join(dirAbs, "usage-ledger.jsonl");
  for (const [f, sha, lbl] of [[pp, man.predictionsSha256, "predictions"], [rp, man.receiptSha256, "receipt"], [lp, man.ledgerSha256, "ledger"]]) {
    if (!fs.existsSync(f)) fail(`${lbl} 파일 없음`);
    if (fileSha(f) !== sha) fail(`${lbl} SHA 불일치(변조/불완전)`);
  }
  // 정산 완료 ledger: strict summary — 미정산 0, calls·비용 manifest와 일치.
  const records = fs.readFileSync(lp, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const s = ledgerSummary(records, man.pricing);
  if (s.unsettledReserves !== 0) fail(`unsettledReserves ${s.unsettledReserves} != 0`);
  if (s.calls !== man.calls) fail(`ledger calls ${s.calls} != manifest ${man.calls}`);
  if (round6v(s.costUsd) !== round6v(man.costUsd)) fail(`ledger cost ${s.costUsd} != manifest ${man.costUsd}`);
  // 4차: ledger call ID가 전부 이 attempt 소속인지(다른 attempt 원장 재사용/짜깁기 차단).
  for (const r of records) {
    if (typeof r.callId === "string" && !r.callId.startsWith(`${man.attemptId}:`)) fail(`ledger callId '${r.callId}'가 attempt '${man.attemptId}' 소속이 아님`);
  }
  const receipt = JSON.parse(fs.readFileSync(rp, "utf8"));
  if (receipt.attemptId !== man.attemptId) fail("receipt attemptId 불일치");
  if (receipt.model !== man.requestedModel) fail("receipt model != manifest requestedModel");
  const preds = JSON.parse(fs.readFileSync(pp, "utf8"));
  if (!preds || !preds.versions || !Array.isArray(preds.results)) fail("predictions 형식 오류");
  if (preds.versions.modelVersion !== man.requestedModel) fail(`predictions model ${preds.versions.modelVersion} != ${man.requestedModel}`);
  if (preds.versions.promptVersion !== man.promptVersion) fail("predictions promptVersion != manifest");
  // 4차 P1-3: 실행 출처를 보존해 반환 — 사용자 별칭은 표시용일 뿐이다.
  return { versions: preds.versions, results: preds.results,
    provenance: { attemptId: man.attemptId, candidateId: man.candidateId, requestedModel: man.requestedModel,
      resolvedModel: rm, promptSha256: man.promptSha256, candidateRecordSha256: cand.candidateRecordSha256,
      candidateTask: cand.task || "combined_selection",
      executionState: cand.execution.state, evidenceUse: cand.evidenceUse, independentEvidence: cand.independentEvidence,
      aliasIsDisplayOnly: true } };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (n) => path.join(ROOT, "test", "fixtures", n);
const OUT = path.join(ROOT, ".nowhot-local", "selection-d1g", "rescore-authority-002.json");

const DEFAULT_RUNS = {
  "p1(haiku)": ".nowhot-local/selection-d1c/canary-predictions.json",
  "p2(haiku)": ".nowhot-local/selection-d1d/canary-predictions.json",
  "p3(haiku)": ".nowhot-local/selection-d1e/canary-predictions.json",
  "p3(sonnet-5)": ".nowhot-local/selection-d1f/canary-predictions.json"
};

// predsByRun 주입은 테스트 전용(offline 반례) — 기본은 sealed 예측 파일을 읽는다.
export function rescoreD1g({ predsByRun } = {}) {
  const corpus = JSON.parse(fs.readFileSync(FIX("selection-d1-corpus.json"), "utf8"));
  const gold = JSON.parse(fs.readFileSync(FIX("selection-d1-gold.json"), "utf8"));
  const gates = JSON.parse(fs.readFileSync(FIX("selection-d1-gates.lock.json"), "utf8"));
  const doc = JSON.parse(fs.readFileSync(FIX("selection-d1g-adversarial-authority-002.json"), "utf8"));
  const authority = loadAdversarialAuthority(doc, { corpusRows: corpus.rows }); // SHA·ID·evidenceHash·스키마 fail-closed
  const canaryItems = d1gCanaryItems(corpus); // decisive 10 + mutation 2 — canary와 동일 입력 단일화
  const decisiveIds = [...authority.byId.keys()].sort();
  const canaryRows = corpus.rows.filter((r) => canaryItems.some((it) => it.blindItemId === r.blindItemId));
  const canon = buildCanonicalAuthority(canaryRows, { adversarialAuthority: authority });

  // P1(재검수): 새 attempt는 predictions.json이 아니라 **검증 가능한 attempt 디렉터리(manifest)**로만 받는다 —
  //   node tools/rescore-selection-d1g.mjs --attempt <이름>=<attempt 디렉터리> [--attempt ...]
  // manifest에서 모델·프롬프트·정본 SHA·prediction SHA·receipt·정산완료 ledger·retry 0을 fail-closed 대조한다.
  // sealed 기본 실행 파일 부재(깨끗한 checkout)는 crash가 아니라 '전건 missing'으로 취급한다.
  const runsInput = predsByRun || (() => {
    const out = {};
    for (const [name, p] of Object.entries(DEFAULT_RUNS)) {
      const abs = path.join(ROOT, p);
      out[name] = fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : { versions: null, results: [] };
    }
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] !== "--attempt") continue;
      const spec = argv[i + 1] || "";
      const eq = spec.indexOf("=");
      if (eq <= 0) throw new Error(`rescore: --attempt는 <이름>=<attempt 디렉터리> 형식이어야 한다: '${spec}'`);
      const name = spec.slice(0, eq), p = spec.slice(eq + 1);
      const dirAbs = path.isAbsolute(p) ? p : path.join(ROOT, p);
      out[name] = loadAttemptDir(dirAbs); // fail-closed manifest 검증
      i += 1;
    }
    return out;
  })();

  // per-run 완결성: decisive 10 전건 예측이 있는 실행만 점수화한다. 부재 실행은
  // INCOMPLETE로 표기만 하고 점수·순위를 만들지 않는다(부분 8건 점수 금지 유지).
  const availability = {}, incompleteRuns = {}, completeNames = [];
  for (const [name, preds] of Object.entries(runsInput)) {
    const have = new Set(preds.results.filter((r) => r.status === "classified" || r.status === "cache_hit").map((r) => r.itemId));
    availability[name] = Object.fromEntries(decisiveIds.map((id) => [id, have.has(id) ? "sealed_prediction" : "missing"]));
    if (decisiveIds.some((id) => !have.has(id))) incompleteRuns[name] = availability[name];
    else completeNames.push(name);
  }

  if (completeNames.length === 0) {
    return finish({ contract: "NOWHOT-SELECTION-D1G-RESCORE-002", status: "INCOMPLETE_NEW_FIXTURE_PREDICTIONS", holds: true,
      reason: "decisive 10 전건 예측을 가진 실행이 없다(대체 반례 d1g-11·d1g-12 미예측) — 부분 분모(8)로 점수·모델 순위를 산출하지 않는다.",
      authority: doc.contract, denominator: 10, availability,
      nextStep: "다음 모델 호출 여부는 Codex 재검수 전 결정하지 않는다. 호출이 승인되면 --attempt <이름>=<경로>로 새 immutable attempt를 지정해 재실행한다." }, predsByRun);
  }

  // 완결 실행 점수화 — 공용 게이트(evaluateCanaryD1d) + per-item 실패 상세(canonical projection과 동일 기준).
  const acceptOf = (c) => c.admissionCategories.filter((a) => a.decision === "accept").map((a) => a.category).sort();
  const runs = {};
  for (const name of completeNames) {
    const preds = runsInput[name];
    const canaryIdSet = new Set(canaryItems.map((it) => it.blindItemId));
    const predSub = canaryItems.map((it) => {
      const p = preds.results.find((r) => r.itemId === it.blindItemId);
      return p || { itemId: it.blindItemId, status: "error" };
    });
    const gate = evaluateCanaryD1d({ corpus, gold, canaryItems, canaryPreds: predSub, versions: preds.versions, gates });
    const perItem = decisiveIds.map((id) => {
      const rec = canon.get(id);
      const proj = rec.contractProjection;
      const p = predSub.find((x) => x.itemId === id);
      if (!p || (p.status !== "classified" && p.status !== "cache_hit")) {
        const why = `status:${p ? p.status : "missing"}`;
        return { itemId: id, categoryAdmissionMatch: false, scopeMatch: false, match: false,
          categoryWhy: why, scopeWhy: why, why };
      }
      const c = p.classification;
      const okCT = c.contentType === proj.contentType, okS = c.scopeClass === proj.scope;
      const okA = JSON.stringify(acceptOf(c)) === JSON.stringify([...proj.accepted].sort());
      const categoryAdmissionMatch = okCT && okA;
      const match = categoryAdmissionMatch && okS;
      const categoryWhy = categoryAdmissionMatch ? null
        : [!okCT && `ct:${c.contentType}≠${proj.contentType}`, !okA && `acc:[${acceptOf(c)}]≠[${proj.accepted}]`].filter(Boolean).join(" ");
      const scopeWhy = okS ? null : `scope:${c.scopeClass}≠${proj.scope}`;
      return { itemId: id, categoryAdmissionMatch, scopeMatch: okS, match, categoryWhy, scopeWhy,
        why: match ? null : [categoryWhy, scopeWhy].filter(Boolean).join(" ") };
    });
    const categoryFailures = perItem.filter((x) => !x.categoryAdmissionMatch).map((x) => ({ itemId: x.itemId, why: x.categoryWhy }));
    const scopeFailures = perItem.filter((x) => !x.scopeMatch).map((x) => ({ itemId: x.itemId, why: x.scopeWhy }));
    const candidateState = gate.categoryCandidatePass
      ? (gate.scopePass ? "FULL_CONTRACT_PASS" : "CATEGORY_PASS_SCOPE_HOLD")
      : "CATEGORY_HOLD";
    runs[name] = { provenance: preds.provenance || null, // null=sealed 레거시(무 manifest — 점수화 불가 케이스뿐)
      candidateState,
      gate: { pass: gate.pass, categoryCandidatePass: gate.categoryCandidatePass,
        categoryAdmissionPass: gate.categoryAdmissionPass, scopePass: gate.scopePass,
        reason: gate.reason, adversarialDetail: gate.adversarialDetail, mutationLabelChanged: gate.mutationLabelChanged },
      categoryAdmission: { exact: `${perItem.filter((x) => x.categoryAdmissionMatch).length}/10`,
        pass: gate.categoryAdmissionPass, failures: categoryFailures },
      scope: { exact: `${perItem.filter((x) => x.scopeMatch).length}/10`, pass: gate.scopePass, failures: scopeFailures },
      wholeRow: `${perItem.filter((x) => x.match).length}/10`, failures: perItem.filter((x) => !x.match), canaryIdCount: canaryIdSet.size };
  }
  return finish({ contract: "NOWHOT-SELECTION-D1G-RESCORE-002", status: "COMPLETE", holds: false,
    authority: doc.contract, denominator: 10, availability, runs,
    scoringNote: "categoryAdmission and scope are independent axes; wholeRow is retained only as a backward-compatible diagnostic.",
    incompleteRuns: Object.keys(incompleteRuns).length ? incompleteRuns : undefined,
    incompleteNote: Object.keys(incompleteRuns).length ? "INCOMPLETE 실행은 점수·순위 산출에서 제외됨(부분 8건 점수 금지)" : undefined }, predsByRun);
}

function finish(report, injected) {
  const json = JSON.stringify(report, null, 1) + "\n";
  // 주입 실행(테스트)은 sealed report를 덮지 않는다 — 기본 실행만 결정적 재생성.
  if (!injected && (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8") !== json)) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json, { mode: 0o600 });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rescoreD1g();
  process.stdout.write(`${r.status}${r.holds ? " (HOLD)" : ""} | denominator ${r.denominator} | report ${path.relative(ROOT, OUT)}\n`);
  if (r.holds) process.exitCode = 3;
}
