// Declarative pack manifest loader (pack.manifest.json) — the single source
// of truth for gate grades, retry budget, excluded topics, gate thresholds,
// and artifact conventions. Mirrors the WRC Workflow Gate pack schema so the
// Driver Seat harness can read this pack declaratively; code must load domain
// values from here, never hardcode them. docs/quiz-loopgate.md is a derived
// view of this file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST = deepFreeze(
  JSON.parse(fs.readFileSync(path.join(here, "pack.manifest.json"), "utf8"))
);
export const CONTRACT = MANIFEST.pack_contract;

// Gate grade → decision tier. HARD 실패는 BLOCK, HOLD 실패는 HOLD, GUIDE만
// 실패면 통과하되 사유는 봉투에 남는다 (advisory).
export function decideFromGrades(failedGrades) {
  if (failedGrades.includes("HARD")) return "BLOCK";
  if (failedGrades.includes("HOLD")) return "HOLD";
  return "PASS";
}
