// NOWHOT D1-D thin runner — 최소 offline 반례 테스트(실API 없음).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { versionsForD1d, itemsFromCorpus, D1D_SYSTEM, D1D_PROMPT_VERSION, evaluateCanaryD1d, D1C_RECOVERY, D1D_ATTEMPT_ID } from "../tools/run-selection-d1d.mjs";
import { ledgerSummary } from "../src/feed/selection-classifier-lab.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readFix = (n) => JSON.parse(readFileSync(path.join(HERE, "fixtures", n), "utf8"));
const CORPUS = readFix("selection-d1-corpus.json");
const GOLD = readFix("selection-d1-gold.json");
const GATES = readFix("selection-d1-gates.lock.json");

test("D1D: p2 promptVersion + gold/라벨 필드 누출 0 + 실패패턴 겨냥 명시", () => {
  assert.equal(D1D_PROMPT_VERSION, "nowhot-selection-d1d-p2");
  assert.equal(versionsForD1d().promptVersion, "nowhot-selection-d1d-p2");
  for (const bad of ["goldAccepted", "goldContentType", "humanValid", "inScope", "adjudicator", "labeler", "finalDecisionDigest", "declaredCategory", "contractGold"]) {
    assert.ok(!D1D_SYSTEM.includes(bad), `p2 must not leak ${bad}`);
  }
  assert.ok(D1D_SYSTEM.includes("NEVER infer event location from sourceCountry")); // scopeMismatch 겨냥
  assert.ok(/inseparable cross-domain/.test(D1D_SYSTEM)); // expectedAdmissionMiss 겨냥
  assert.ok(/indirect\/second-order effect is 'reject'/.test(D1D_SYSTEM) || /indirect.*reject/.test(D1D_SYSTEM)); // selectedCategoryLeak 겨냥
});

test("D1D: itemsFromCorpus 96 (real 78 / adversarial 10 / mutation 8)", () => {
  const items = itemsFromCorpus(CORPUS);
  assert.equal(items.length, 96);
  assert.equal(items.filter((i) => i.origin === "real_local_snapshot").length, 78);
  assert.equal(items.filter((i) => i.origin === "adversarial_contract_fixture").length, 10);
  assert.equal(items.filter((i) => i.origin === "mutation_fixture").length, 8);
});

test("D1D: evaluateCanaryD1d — 12건 미만 classified면 canary fail(HOLD)", () => {
  const canaryItems = itemsFromCorpus(CORPUS).filter((i) => i.origin === "adversarial_contract_fixture" || i.blindItemId === "d1m-01a" || i.blindItemId === "d1m-01b");
  assert.equal(canaryItems.length, 12);
  const preds = canaryItems.map((it) => ({ itemId: it.blindItemId, status: "error" }));
  const g = evaluateCanaryD1d({ corpus: CORPUS, gold: GOLD, canaryItems, canaryPreds: preds, versions: versionsForD1d(), gates: GATES });
  assert.equal(g.pass, false);
});

test("D1D: recovery = D1-C 누적, attemptId 고정", () => {
  const s = ledgerSummary([{ seq: 0, type: "recovery", calls: D1C_RECOVERY.calls, inputTokens: D1C_RECOVERY.inputTokens, outputTokens: D1C_RECOVERY.outputTokens }]);
  assert.equal(s.calls, 12); assert.equal(s.inputTokens, 20022); assert.equal(s.outputTokens, 7527); assert.equal(s.costUsd, 0.057657);
  assert.equal(D1D_ATTEMPT_ID, "d1d-20260819-01");
});
