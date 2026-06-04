import fs from "node:fs";

export const APPROVAL_REQUIRED_RISKS = new Set(["high", "critical"]);
export const APPROVAL_REQUIRED_ACTIONS = [
  "publish",
  "delete",
  "pay",
  "buy",
  "purchase",
  "refund",
  "send customer",
  "account change"
];

export function routeTask(task) {
  const title = String(task.title || "").toLowerCase();
  const explicitApproval = task.requiresHumanApproval === true;
  const riskyByLevel = APPROVAL_REQUIRED_RISKS.has(String(task.risk || "").toLowerCase());
  const riskyByAction = APPROVAL_REQUIRED_ACTIONS.some((action) => title.includes(action));

  if (explicitApproval || riskyByLevel || riskyByAction) {
    return {
      ...task,
      nextQueue: "decision_queue",
      reason: "human_approval_required"
    };
  }

  if (task.status !== "ready") {
    return {
      ...task,
      nextQueue: "backlog",
      reason: "not_ready"
    };
  }

  return {
    ...task,
    nextQueue: `${task.target || "general"}_dispatch`,
    reason: "ready_for_dispatch"
  };
}

export function routeTasks(tasks) {
  return tasks.map(routeTask);
}

if (process.argv[1] && process.argv[1].endsWith("router.js")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node src/router.js <task_queue.json>");
    process.exit(1);
  }

  const tasks = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(JSON.stringify(routeTasks(tasks), null, 2));
}
