import test from "node:test";
import assert from "node:assert/strict";
import { routeTask, routeTasks } from "../src/router.js";

test("routes ready low-risk task to target dispatch queue", () => {
  const routed = routeTask({
    id: "TASK-001",
    title: "Summarize issues",
    status: "ready",
    risk: "low",
    target: "research"
  });

  assert.equal(routed.nextQueue, "research_dispatch");
  assert.equal(routed.reason, "ready_for_dispatch");
});

test("routes high-risk tasks to decision queue", () => {
  const routed = routeTask({
    id: "TASK-002",
    title: "Draft announcement",
    status: "ready",
    risk: "high",
    target: "editorial"
  });

  assert.equal(routed.nextQueue, "decision_queue");
  assert.equal(routed.reason, "human_approval_required");
});

test("routes unsafe action language to decision queue", () => {
  const routed = routeTask({
    id: "TASK-003",
    title: "Publish release announcement",
    status: "ready",
    risk: "medium",
    target: "editorial"
  });

  assert.equal(routed.nextQueue, "decision_queue");
});

test("routes non-ready tasks to backlog", () => {
  const routed = routeTask({
    id: "TASK-004",
    title: "Review pull request",
    status: "blocked",
    risk: "low",
    target: "codex"
  });

  assert.equal(routed.nextQueue, "backlog");
  assert.equal(routed.reason, "not_ready");
});

test("routes a task list", () => {
  const routed = routeTasks([
    { id: "TASK-001", title: "Summarize", status: "ready", risk: "low", target: "research" },
    { id: "TASK-002", title: "Delete records", status: "ready", risk: "medium", target: "ops" }
  ]);

  assert.equal(routed.length, 2);
  assert.equal(routed[0].nextQueue, "research_dispatch");
  assert.equal(routed[1].nextQueue, "decision_queue");
});
