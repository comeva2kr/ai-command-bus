// NOWHOT D1-A — offline evaluator CLI (v2). provider/API 호출 기능 없음(실모델 미실행).
// 정본: WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//
//  기본 모드: fixture evaluation(계약·게이트 계산, gold pending이면 release PASS 금지).
//  --predictions <file>: {versions, predictions} 파일을 gold에 대해 평가.
//  --check-lock: D1 gates lock 전체 바이트 SHA(코드 상수) + 구조 검증 + Wilson 재현
//               + 격리 서브프로세스로 D0 baseline `--check`. D0 lock --write는 어떤 경우에도 안 함.
//  --json: 사람용 요약 대신 JSON 출력.
//  corrupt corpus/gold/prediction/lock은 exit 1.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  evaluatePredictions, evaluateGates, validateGatesLock, wilsonLowerBound, buildCanonicalAuthority,
  WILSON_Z, D1_GATES_LOCK_SHA256, D1_IDENTITIES, loadAdversarialAuthority
} from "../src/feed/selection-classifier-lab.js";
// freeze-selection-baseline.mjs는 D0 산출물이라 CLI 코드가 import.meta 가드 없이 모듈 로드 시
// 실행된다. import하면 부작용(및 argv에 따른 --write 위험)이 있으므로 격리 서브프로세스 --check만.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (n) => path.join(ROOT, "test", "fixtures", n);
// A1: gold labeler 금지 identity 정본(lab에서 공유, 별도 하드코딩 금지).
const IDENTITIES = D1_IDENTITIES;

function readRaw(p, label) {
  try { return fs.readFileSync(p, "utf8"); }
  catch { throw new Error(`${label} missing: ${p}`); }
}
function readJson(p, label) {
  const raw = readRaw(p, label);
  try { return JSON.parse(raw); }
  catch { throw new Error(`${label} corrupt JSON: ${p}`); }
}

// gates lock: 전체 바이트 SHA가 코드 상수와 일치 + 구조 fail-closed.
function loadGates() {
  const raw = readRaw(FIX("selection-d1-gates.lock.json"), "gates");
  const bytesSha = crypto.createHash("sha256").update(raw).digest("hex");
  let gates;
  try { gates = JSON.parse(raw); }
  catch { throw new Error("gates lock corrupt JSON"); }
  const structural = validateGatesLock(gates);
  return { gates, bytesSha, structural };
}

// §3: frozen corpus raw SHA 정본(정상 평가도 반드시 확인).
// D1-C integrity: corpus v2(002) supersede — adversarial geo 정정. real/mutation/gold/gates 불변.
const FROZEN_CORPUS_SHA256 = "b8f2d45842fa94d5ddd5630fc35660ccd8b13986fd3f1a0291ab6e52def07b8b";

function loadFixtures() {
  const corpusRaw = readRaw(FIX("selection-d1-corpus.json"), "corpus");
  const corpusSha = crypto.createHash("sha256").update(corpusRaw).digest("hex");
  if (corpusSha !== FROZEN_CORPUS_SHA256) throw new Error(`frozen corpus SHA drift: ${corpusSha} != ${FROZEN_CORPUS_SHA256}`);
  let corpus; try { corpus = JSON.parse(corpusRaw); } catch { throw new Error("corpus corrupt JSON"); }
  const gold = readJson(FIX("selection-d1-gold.json"), "gold");
  const { gates, bytesSha, structural } = loadGates();
  if (!Array.isArray(corpus.rows)) throw new Error("corpus corrupt: rows not array");
  if (!Array.isArray(gold.labels)) throw new Error("gold corrupt: labels not array");
  if (bytesSha !== D1_GATES_LOCK_SHA256) throw new Error(`gates lock SHA drift: ${bytesSha} != ${D1_GATES_LOCK_SHA256}`);
  if (!structural.ok) throw new Error(`gates lock invalid: ${structural.errors.join(",")}`);
  return { corpus, gold, gates };
}

// D1 gates lock(바이트 SHA·구조·Wilson) + D0 baseline lock drift 검사.
export function checkLock() {
  const drift = [];
  let gates;
  try {
    const g = loadGates();
    gates = g.gates;
    if (g.bytesSha !== D1_GATES_LOCK_SHA256) drift.push(`gates_lock_sha: ${g.bytesSha} != ${D1_GATES_LOCK_SHA256}`);
    if (!g.structural.ok) drift.push(`gates_lock_structure: ${g.structural.errors.join(",")}`);
  } catch (e) { return { ok: false, drift: [e.message] }; }
  for (const v of (gates.wilson && gates.wilson.reference) || []) {
    const lb = wilsonLowerBound(v.tp, v.n, WILSON_Z);
    if (typeof lb !== "number" || Math.abs(lb - v.lowerBound) > 1e-12) drift.push(`wilson ${v.tp}/${v.n}: locked ${v.lowerBound} vs ${lb}`);
  }
  // D0 baseline — 격리 서브프로세스 `--check`(읽기 전용). --write 아님.
  try { execFileSync("node", [path.join(ROOT, "tools", "freeze-selection-baseline.mjs"), "--check"], { stdio: "ignore" }); }
  catch { drift.push("d0_baseline: freeze-selection-baseline.mjs --check reported drift (exit 1)"); }
  return { ok: drift.length === 0, drift };
}

// §3.A: contractGold는 canonical authority만 보유한다 — items에는 넣지 않는다(request/adapter 노출 방지).
function itemsFromCorpus(corpus) {
  return corpus.rows.map((r) => ({
    itemId: r.blindItemId, origin: r.origin, title: r.title, excerpt: r.excerpt,
    sourceId: r.sourceId, sourceTier: r.sourceTier, declaredSection: r.declaredSection,
    contentKindHint: r.contentKindHint, sourceCountry: r.sourceCountry, language: r.language,
    mutationPairId: r.mutationPairId, mutationRole: r.mutationRole, mutationType: r.mutationType
  }));
}

function run() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");

  if (argv.includes("--check-lock")) {
    const res = checkLock();
    if (res.ok) { process.stdout.write("lock check: OK (D1 gates SHA+구조+Wilson, D0 baseline, no drift)\n"); process.exit(0); }
    process.stderr.write("lock check DRIFT:\n" + res.drift.map((d) => "  " + d).join("\n") + "\n"); process.exit(1);
  }

  const { corpus, gold, gates } = loadFixtures();

  const predIdx = argv.indexOf("--predictions");
  let predictions = [], versions = {};
  if (predIdx >= 0) {
    const pf = argv[predIdx + 1];
    if (!pf) throw new Error("--predictions requires a file path");
    const parsed = readJson(path.resolve(pf), "predictions");
    predictions = Array.isArray(parsed) ? parsed : parsed.predictions;
    versions = (parsed && parsed.versions) || {};
    if (!Array.isArray(predictions)) throw new Error("predictions corrupt: not an array");
  }

  const items = itemsFromCorpus(corpus);
  // §3.A: frozen corpus raw SHA 확인 후 corpus.rows에서 canonical authority를 딱 한 번 만든다(gold 자기신고 불신뢰).
  // D1-G FINAL CLOSURE: adversarial 채점 정본은 authority-002 — 없거나 SHA·ID·evidenceHash가 다르면 CORRUPT_EVAL_DATA.
  const authority = loadAdversarialAuthority(JSON.parse(readRaw(FIX("selection-d1g-adversarial-authority-002.json"), "d1g-authority")), { corpusRows: corpus.rows });
  const canonical = buildCanonicalAuthority(corpus.rows, { adversarialAuthority: authority });
  // §6: 평가 모드 명시(암묵 추론 금지). --predictions면 candidate, 아니면 fixture_only.
  const mode = predIdx >= 0 ? "candidate" : "fixture_only";
  // core도 A7 데이터셋 게이트를 통과해야 평가 — orphan/dup/1:1/mode/canonical 위반은 여기서 throw → exit 1.
  const metrics = evaluatePredictions({ items, gold: gold.labels, predictions, versions, gatesLock: gates, identities: IDENTITIES, mode, canonical });
  const gateResult = evaluateGates(metrics, gates, gold.labels, { identities: IDENTITIES });
  const releaseState = metrics.release.goldState; // §4: canonical real 정합 + 전부 eligible일 때만 sufficient

  const summary = {
    contract: "NOWHOT-SELECTION-D1-EVAL-001", phase: "D1-A",
    releaseGoldState: releaseState,
    releasePass: false, // D1-A: real gold pending / REAL_MODEL_NOT_RUN → 절대 PASS 아님
    goldCounts: gold.counts || null, corpusCounts: corpus.counts || null,
    shortages: (corpus.shortages || []).map((s) => s.stratum),
    evaluableItems: metrics.release.evaluableItems,
    gates: {
      contentType: gateResult.contentType.pass, abstain: gateResult.abstain.pass,
      adversarial: gateResult.adversarial.pass, mutation: gateResult.mutation.pass, precision: gateResult.precision.pass,
      recall: gateResult.recall.status, qualifiedSupply: gateResult.qualifiedSupply.status
    },
    doesNotProve: gates.doesNotProve || []
  };

  if (jsonOut) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
  process.stdout.write("D1-A evaluation (fixture mode)\n");
  process.stdout.write(`  releaseGoldState : ${releaseState}\n`);
  process.stdout.write(`  releasePass      : false (real gold pending / REAL_MODEL_NOT_RUN)\n`);
  process.stdout.write(`  gold counts      : ${JSON.stringify(summary.goldCounts)}\n`);
  process.stdout.write(`  corpus counts    : real=${corpus.counts.real} synthetic=${corpus.counts.adversarial + corpus.counts.mutation} realRatioBps=${corpus.counts.realRatioBps}\n`);
  process.stdout.write(`  shortages        : ${summary.shortages.join(", ")}\n`);
  process.stdout.write(`  evaluableItems   : ${summary.evaluableItems}\n`);
  process.stdout.write(`  recall gate      : ${summary.gates.recall}\n`);
  process.stdout.write(`  supply gate      : ${summary.gates.qualifiedSupply}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { run(); }
  catch (e) { process.stderr.write(`eval error: ${e.message}\n`); process.exit(1); }
}
