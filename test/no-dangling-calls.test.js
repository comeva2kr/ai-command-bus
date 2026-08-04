// 초기화 시퀀스에서 정의 없는 함수를 호출하면 그 지점에서 전부 멈춘다.
//
// 2026-08-04 실사고: 연령 게이트를 걷어내면서 renderAdultBtn/setupAdultToggle
// 정의를 지웠는데 초기화 줄의 호출은 안 지웠다. 그 한 줄에서 터지면서 뒤의
// setupDrawer()가 실행되지 않아 ☰ 메뉴·글쓰기·내 공간·슬라이더가 전부 죽었다.
// 화면은 멀쩡해 보이는데 아무것도 안 눌린다 — 사용자에겐 콘솔이 안 보인다.
//
// 범위를 초기화 시퀀스로 좁힌 이유: 스크립트 전체를 정적 분석하면 API 메서드
// (API.session() 등)와 객체 리터럴 메서드까지 걸려 오탐이 쏟아진다. 반면 실제
// 사고는 항상 "부팅 경로에서 죽은 호출"이고, 거기만 보면 오탐 없이 잡힌다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");

function definedNames() {
  const d = new Set();
  for (const m of HTML.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) d.add(m[1]);
  for (const m of HTML.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/g)) d.add(m[1]);
  return d;
}

// 부팅 경로: `setupX(); setupY(); ...` 형태로 인자 없이 줄줄이 호출하는 줄들.
// 이게 init()의 실제 모양이고, 죽은 호출이 섞이면 뒤가 통째로 안 돈다.
function bootCalls() {
  const out = new Map();   // name -> line
  const lines = HTML.split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    // 한 줄에 인자 없는 호출이 둘 이상 = 부팅 시퀀스로 본다
    const calls = [...code.matchAll(/(^|[^.\w$])([a-z][\w$]*)\(\)\s*;/g)].map((m) => m[2]);
    if (calls.length >= 2) for (const c of calls) if (!out.has(c)) out.set(c, i + 1);
  });
  return out;
}

test("부팅 시퀀스의 모든 호출에 정의가 있다", () => {
  const defined = definedNames();
  const calls = bootCalls();
  assert.ok(calls.size >= 5, `부팅 시퀀스를 못 찾았다 (${calls.size}개)`);

  const missing = [...calls.entries()].filter(([n]) => !defined.has(n));
  assert.deepEqual(missing, [],
    `정의 없이 호출됨 — 초기화가 여기서 멈춘다: ${missing.map(([n, l]) => `${n}() (${l}행)`).join(", ")}`);
});

test("메뉴·드로어 배선이 부팅 경로에 남아 있다", () => {
  // 위 테스트는 "죽은 호출"을 잡지만, 배선 자체가 통째로 사라진 경우는 못 잡는다.
  // ☰ 메뉴는 나머지 기능 전부로 가는 유일한 입구라 따로 못 박는다.
  assert.match(HTML, /setupDrawer\(\)\s*;/, "setupDrawer 호출이 사라졌다");
  assert.match(HTML, /getElementById\("menuBtn"\)\.onclick\s*=/, "메뉴 버튼 핸들러가 사라졌다");
});
