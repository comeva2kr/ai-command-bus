// 초기화 시퀀스에서 정의 없는 함수를 호출하면 그 지점에서 전부 멈춘다.
//
// 2026-08-04 실사고: 연령 게이트를 걷어내면서 renderAdultBtn/setupAdultToggle
// 정의를 지웠는데 초기화 줄의 호출은 안 지웠다. 그 한 줄에서 터지면서 뒤의
// setupDrawer()가 실행되지 않아 ☰ 메뉴·글쓰기·내 공간·슬라이더가 전부 죽었다.
// 화면은 멀쩡해 보이는데 아무것도 안 눌린다 — 사용자에겐 콘솔이 안 보인다.
//
// 2026-08-05 재발: 같은 커밋이 toggleTopic도 지웠는데 정치·종교 버튼은 계속
// 부르고 있었다. 이번엔 **부팅이 아니라 버튼을 눌러야** 실행되는 자리라 위
// 검사에 안 걸렸다. David가 실기기에서 "정치글 보기가 안 눌린다"고 할 때까지
// 하루 넘게 살아 있었다.
//
// 그래서 범위를 스크립트 전체로 넓혔다. 예전에 좁혔던 이유(API.session() 같은
// 객체 메서드와 한국어 주석의 "낱말(" 이 오탐으로 쏟아진다)는 실재했으므로,
// 넓히면서 그 둘을 함께 처리한다: 주석을 먼저 걷어내고, 객체 리터럴 메서드
// 축약형과 함수 매개변수를 정의로 인정한다. 실측으로 오탐 57건 → 0건이 됐다.
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

// ── 스크립트 전체: 정의 없는 함수 호출 ─────────────────────────────────────
function inlineScript() {
  return [...HTML.matchAll(/<script(?![^>]*\b(?:src|type="application\/ld\+json")[^>]*)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).join("\n")
    // 주석을 먼저 걷어낸다 — 한국어 주석의 "낱말(" 이 전부 오탐이 된다
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// 브라우저가 주는 것들. 여기 없는 전역을 새로 쓰면 테스트가 알려 준다 —
// 목록을 늘리는 것 자체가 "이건 우리가 정의한 게 아니다"라는 기록이 된다.
const BROWSER_GLOBALS = new Set(`if for while switch catch return typeof function await new
fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame alert confirm prompt
parseInt parseFloat isNaN encodeURIComponent decodeURIComponent addEventListener removeEventListener
Number String Boolean Array Object Date Math JSON Map Set Promise RegExp Error btoa atob
structuredClone queueMicrotask IntersectionObserver MutationObserver URLSearchParams URL Intl
console matchMedia getComputedStyle CustomEvent Event AbortController Image do else try import void
of not var resolve reject`.split(/\s+/).filter(Boolean));

function allDefinedNames(src) {
  const d = new Set();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) d.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) d.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
    m[1].split(",").forEach((x) => d.add(x.split(":").pop().trim()));
  // 객체 리터럴 메서드 축약형: `name(a, b) {` / `async name() {`
  for (const m of src.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) d.add(m[1]);
  // 함수·화살표 매개변수
  for (const m of src.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*|\()([^)]{0,160})\)\s*(?:=>|\{)/g))
    m[1].split(",").forEach((x) => {
      const n = x.trim().split(/[=:\s.]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(n)) d.add(n);
    });
  return d;
}

test("스크립트 전체: 정의 없는 함수를 부르는 곳이 없다", () => {
  // 2026-08-05 실사고: toggleTopic 정의를 지웠는데 정치·종교 버튼은 계속 부르고
  // 있었다. 문법은 맞으니 문법 검사기는 통과하고, 부팅 경로가 아니니 위 검사도
  // 통과했다. 화면은 멀쩡한데 버튼만 안 눌린다 — 사용자에겐 콘솔이 안 보인다.
  const src = inlineScript();
  const defined = allDefinedNames(src);
  const missing = [];
  src.split("\n").forEach((line, i) => {
    // 앞에 . 이나 - 가 붙은 것은 제외한다 (obj.foo(), CSS의 color-mix())
    for (const m of line.matchAll(/(^|[^-.\w$"'`])([a-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (defined.has(name) || BROWSER_GLOBALS.has(name)) continue;
      if (missing.some((x) => x.name === name)) continue;
      missing.push({ name, line: i + 1 });
    }
  });
  assert.deepEqual(missing, [],
    `정의 없이 호출되는 함수: ${missing.map((x) => `${x.name}(줄 ${x.line})`).join(", ")}`);
});
