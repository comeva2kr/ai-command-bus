// NOWHOT D1-F 단일변수(모델만) 실험 — 최소 offline 반례 테스트(실API 없음).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { D1F_MODEL, D1F_PRICING, D1F_ATTEMPT_ID, D1F_DIR, P3_SYSTEM_SHA16, PRIOR_CUMULATIVE, versionsForD1f, D1F_INCREMENTAL_CAP_USD, TOTAL_CAP_USD } from "../tools/run-selection-d1f.mjs";
import { D1E_SYSTEM, D1E_PROMPT_VERSION, D1E_ATTEMPT_ID, D1E_DIR } from "../tools/run-selection-d1e.mjs";
import { MODEL_PRICING } from "../src/feed/costs.js";

test("D1F: 단일변수 고정 — p3 프롬프트 SHA 동일, promptVersion 그대로, 모델만 교체", () => {
  const sha = crypto.createHash("sha256").update(D1E_SYSTEM).digest("hex").slice(0, 16);
  assert.equal(sha, P3_SYSTEM_SHA16);
  assert.equal(P3_SYSTEM_SHA16, "769b2d40863ab55b");
  const v = versionsForD1f();
  assert.equal(v.promptVersion, D1E_PROMPT_VERSION); // p3 그대로
  assert.equal(v.modelVersion, "claude-sonnet-5");   // 유일한 변경
});

test("D1F: 모델·단가는 저장소 정의(costs.js)와 정확 일치", () => {
  assert.equal(D1F_MODEL, "claude-sonnet-5");
  assert.equal(MODEL_PRICING[D1F_MODEL].in, D1F_PRICING.inputPerMTok);
  assert.equal(MODEL_PRICING[D1F_MODEL].out, D1F_PRICING.outputPerMTok);
  assert.deepEqual({ i: D1F_PRICING.inputPerMTok, o: D1F_PRICING.outputPerMTok }, { i: 3.0, o: 15.0 });
});

test("D1F: attempt/dir 분리 + prior 누적·상한 상수 정합", () => {
  assert.equal(D1F_ATTEMPT_ID, "d1f-20260820-01");
  assert.notEqual(D1F_ATTEMPT_ID, D1E_ATTEMPT_ID);
  assert.notEqual(D1F_DIR, D1E_DIR);
  assert.equal(PRIOR_CUMULATIVE.costUsd, 0.173198); // sealed D1-E receipt lifetime
  assert.equal(PRIOR_CUMULATIVE.calls, 36);
  assert.match(PRIOR_CUMULATIVE.d1eLedgerSha256, /^[0-9a-f]{64}$/);
  assert.match(PRIOR_CUMULATIVE.d1eReceiptSha256, /^[0-9a-f]{64}$/);
  assert.equal(D1F_INCREMENTAL_CAP_USD, 0.30);
  assert.equal(TOTAL_CAP_USD, 1.25);
  assert.ok(PRIOR_CUMULATIVE.costUsd + D1F_INCREMENTAL_CAP_USD <= TOTAL_CAP_USD);
});
