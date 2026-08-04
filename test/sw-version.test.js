import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// 서비스워커가 앱 셸(`/` 포함)을 cache-first로 서빙한다. 그래서 index.html을
// 고쳐도 CACHE 상수를 올리지 않으면 **이미 방문한 사람에게는 영원히 옛 화면**이
// 나간다. 서버·API는 정상인데 "바뀐 게 없어 보인다"가 되는 원인이고,
// 2026-08-04에 실제로 발생했다(광고를 살려 배포했는데 폰에 안 보임).
//
// 이 검사는 "index.html이 sw.js보다 나중에 바뀌었으면 실패"시킨다. 커밋 시각
// 기준이라 사람의 기억에 의존하지 않는다.
test("서비스워커: index.html을 고쳤으면 캐시 버전도 올라가 있어야 한다", () => {
  const sw = readFileSync("src/feed/public/sw.js", "utf8");
  const m = sw.match(/const CACHE = "feed-shell-v(\d+)"/);
  assert.ok(m, "CACHE 상수를 찾을 수 없다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다");

  const lastCommit = (f) => {
    try { return Number(execFileSync("git", ["log", "-1", "--format=%ct", "--", f], { encoding: "utf8" }).trim()); }
    catch { return 0; }
  };
  const idx = lastCommit("src/feed/public/index.html");
  const swAt = lastCommit("src/feed/public/sw.js");
  // 둘 다 커밋 이력이 있을 때만 의미가 있다(얕은 클론·새 저장소 대비).
  if (!idx || !swAt) return;
  assert.ok(swAt >= idx,
    `index.html이 sw.js보다 나중에 커밋됐다 (index ${new Date(idx * 1000).toISOString()} > sw ${new Date(swAt * 1000).toISOString()}).\n` +
    `sw.js의 CACHE 버전(v${m[1]})을 올려야 이미 방문한 사람에게 새 화면이 나간다.`);
});
