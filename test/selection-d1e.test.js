// NOWHOT D1-E thin runner — 최소 offline 반례 테스트(실API 없음).
import test from "node:test";
import assert from "node:assert/strict";
import { versionsForD1e, D1E_SYSTEM, D1E_PROMPT_VERSION, D1E_ATTEMPT_ID, D1E_DIR, D1D_CUMULATIVE } from "../tools/run-selection-d1e.mjs";
import { D1D_ATTEMPT_ID, D1D_DIR, D1D_PROMPT_VERSION } from "../tools/run-selection-d1d.mjs";
import { ledgerSummary } from "../src/feed/selection-classifier-lab.js";

test("D1E: p3 promptVersion + gold/라벨 필드 누출 0 + grounding 규율 명시", () => {
  assert.equal(D1E_PROMPT_VERSION, "nowhot-selection-d1e-p3");
  assert.equal(versionsForD1e().promptVersion, "nowhot-selection-d1e-p3");
  for (const bad of ["goldAccepted", "goldContentType", "humanValid", "inScope", "adjudicator", "labeler", "finalDecisionDigest", "declaredCategory", "contractGold"]) {
    assert.ok(!D1E_SYSTEM.includes(bad), `p3 must not leak ${bad}`);
  }
  // 진단(§22-보론) 겨냥 4건: assert-and-quote(d1a-05), 창작 금지(d1a-09), 과잉단정 금지(d1a-08), deal admission(d1a-04)
  assert.ok(D1E_SYSTEM.includes("ASSERT-AND-QUOTE OR NEITHER"));
  assert.ok(D1E_SYSTEM.includes("CHARACTER-FOR-CHARACTER"));
  assert.ok(D1E_SYSTEM.includes("NEVER location evidence"));
  assert.ok(/deal\/purchase offer is judged by the PRODUCT'S own domain/.test(D1E_SYSTEM));
  // p2에서 통과한 절 유지(회귀 방지): 교차도메인·구조유사·contentType 게이트
  assert.ok(/inseparable cross-domain/.test(D1E_SYSTEM));
  assert.ok(/structurally-similar headline/.test(D1E_SYSTEM));
  assert.ok(/Do not accept the 'news' topic merely because the format is news/.test(D1E_SYSTEM));
});

test("D1E: attempt/dir/promptVersion가 D1-D와 분리", () => {
  assert.equal(D1E_ATTEMPT_ID, "d1e-20260820-01");
  assert.notEqual(D1E_ATTEMPT_ID, D1D_ATTEMPT_ID);
  assert.notEqual(D1E_DIR, D1D_DIR);
  assert.notEqual(D1E_PROMPT_VERSION, D1D_PROMPT_VERSION);
});

test("D1E: recovery = D1-C+D1-D 누적($0.114332), 원본 SHA 지참", () => {
  const s = ledgerSummary([{ seq: 0, type: "recovery", calls: D1D_CUMULATIVE.calls, inputTokens: D1D_CUMULATIVE.inputTokens, outputTokens: D1D_CUMULATIVE.outputTokens }]);
  assert.equal(s.calls, 24); assert.equal(s.inputTokens, 41352); assert.equal(s.outputTokens, 14596); assert.equal(s.costUsd, 0.114332);
  assert.match(D1D_CUMULATIVE.d1dLedgerSha256, /^[0-9a-f]{64}$/);
  assert.match(D1D_CUMULATIVE.d1dPredictionsSha256, /^[0-9a-f]{64}$/);
});
