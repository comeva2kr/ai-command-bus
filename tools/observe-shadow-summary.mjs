// G2 — 관찰 산출물 열람(읽기 전용, 매일 보고용).
// 관찰 디렉토리의 summary-*.json과 runlog.jsonl을 표로 출력한다. 쓰기 없음.
//
// 사용: node tools/observe-shadow-summary.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OBS_DIR } from "./observe-shadow-slot.mjs";

const dir = OBS_DIR;
if (!fs.existsSync(dir)) {
  console.log(`관찰 디렉토리 없음: ${dir} — 아직 실행된 슬롯이 없다.`);
  process.exit(0);
}

const summaries = fs.readdirSync(dir)
  .filter((n) => /^summary-\d{4}-\d{2}-\d{2}-[a-z]+\.json$/.test(n))
  .sort()
  .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));

if (!summaries.length) {
  console.log("완료된 슬롯 요약 없음.");
} else {
  const comboKeys = [...new Set(summaries.flatMap((s) => Object.keys(s.combos)))];
  const header = ["날짜", "슬롯", "수집", ...comboKeys.flatMap((k) => [`${k} 선별`, `${k} 부분판`, `${k} 재등장차단`, `${k} 품질차단`, `${k} B등급`])];
  const rows = summaries.map((s) => [
    s.date, s.slotId, String(s.collected.articles),
    ...comboKeys.flatMap((k) => {
      const c = s.combos[k];
      return c
        ? [String(c.selected), c.partialEditionCategories.length ? c.partialEditionCategories.join("/") : "-",
           String(c.reappearBlocked), String(c.qualityExcluded), String(c.bGradeSelected)]
        : ["-", "-", "-", "-", "-"];
    })
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

// runlog — 실행/스킵/실패 이력(놓친 슬롯이 보이게).
const runlog = path.join(dir, "runlog.jsonl");
if (fs.existsSync(runlog)) {
  console.log("\n[runlog]");
  for (const l of fs.readFileSync(runlog, "utf8").trim().split("\n")) {
    if (!l) continue;
    const r = JSON.parse(l);
    console.log(`${r.at}  ${r.event.padEnd(4)}  ${r.date || ""} ${r.slotId || ""}  ${r.reason || r.error || (r.articles != null ? `articles=${r.articles}` : "")}`);
  }
}
