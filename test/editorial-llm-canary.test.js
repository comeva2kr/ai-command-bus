import test from "node:test";
import assert from "node:assert/strict";
import {
  EDITORIAL_LLM_CANARY_CONTRACT,
  assertCanaryExecutionAllowed,
  assertLoopbackBase,
  selectDiverseCanaryIssues
} from "../tools/editorial-llm-canary.mjs";

test("editorial LLM canary: local loopback only", () => {
  assert.equal(assertLoopbackBase("http://127.0.0.1:4100").hostname, "127.0.0.1");
  assert.equal(assertLoopbackBase("http://localhost:4100").hostname, "localhost");
  assert.throws(() => assertLoopbackBase("https://nowhot.kr"), /local http loopback/);
});

test("editorial LLM canary: execute requires separate approval and key", () => {
  assert.equal(assertCanaryExecutionAllowed(false, {}), "dry_run");
  assert.throws(() => assertCanaryExecutionAllowed(true, {}), /approval is required/);
  assert.throws(
    () => assertCanaryExecutionAllowed(true, { NOWHOT_LLM_CANARY_APPROVED: "1" }),
    /ANTHROPIC_API_KEY is required/
  );
  assert.equal(assertCanaryExecutionAllowed(true, {
    NOWHOT_LLM_CANARY_APPROVED: "1",
    ANTHROPIC_API_KEY: "test-only"
  }), "execute");
});

test("editorial LLM canary: at most three issues with category diversity", () => {
  const issues = [
    { evidenceHash: "a", categoryIds: ["business"] },
    { evidenceHash: "b", categoryIds: ["business"] },
    { evidenceHash: "c", categoryIds: ["news"] },
    { evidenceHash: "d", categoryIds: ["realestate"] },
    { evidenceHash: "e", categoryIds: ["tech"] }
  ];
  const selected = selectDiverseCanaryIssues(issues, 99);
  assert.equal(selected.length, EDITORIAL_LLM_CANARY_CONTRACT.maxIssues);
  assert.deepEqual(selected.map((row) => row.evidenceHash), ["a", "c", "d"]);
});
