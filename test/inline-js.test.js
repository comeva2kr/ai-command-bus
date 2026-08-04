import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// 앱 전체가 단일 HTML에 들어 있어서, 편집 실수로 객체 리터럴 중간을 자르면
// 앱이 통째로 죽는다. 실제로 2026-08-04에 API 객체 한가운데에 코드를 끼워 넣어
// 뒤쪽 메서드가 전부 사라진 적이 있다 — 테스트가 없으면 배포 후에야 안다.
// (메뉴 버튼이 두 번 재발한 것과 같은 계열의 사고다.)
for (const file of ["src/feed/public/index.html", "src/feed/public/admin.html"]) {
  test(`인라인 자바스크립트 문법: ${file}`, () => {
    const out = execFileSync(process.execPath, ["tools/check-inline-js.cjs", file], { encoding: "utf8" });
    assert.match(out, /문법 OK/, out);
  });
}
