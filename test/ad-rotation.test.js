// 광고 회전 규칙 — 텍스트 매칭이 아니라 **함수를 실제로 돌려서** 검증한다.
//
// 2026-08-03 David 실기기: "같은 광고가 반복돼서 보이는 경우가 잦다. 와우
// 가입하라는 것만 몇 번 연속으로 나오고 생활용품만 두세 번 나온다."
// 이런 건 마크업에 문자열이 있는지로는 절대 못 잡는다. index.html은 모듈이
// 아니라 import이 안 되므로, 함수 소스를 떼어내 vm에서 실행한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");

// 실제 재고와 같은 모양의 후보 — products.json의 카테고리 분포를 그대로 쓴다.
function realItems() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src/feed/products.json"), "utf8"));
  return (data.banners || [])
    // 2026-08-05: 재고를 200x200 정사각으로 통째로 갈았다. 크기로 거르면
    // 여기가 0이 되어 테스트가 통째로 죽는다 — 재고 전체를 그대로 쓴다.
    .map((b) => ({ category: b.category, dest: b.dest, href: b.href }));
}

// index.html에서 선택 로직만 떼어내 실행 가능한 컨텍스트를 만든다.
function loadPicker(items) {
  const start = HTML.indexOf("const AD_CTX");
  const end = HTML.indexOf("function maybeInsertAdfit");
  assert.ok(start > 0 && end > start, "선택 로직을 찾지 못했다");
  const src = HTML.slice(start, end);
  const ctx = { state: { config: { coupang: { items } } } };
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.pick = pickCoupangLink;", ctx);
  return ctx.pick;
}

test("같은 광고가 연달아 나오지 않는다", () => {
  const pick = loadPicker(realItems());
  const seq = [];
  // business 글이 연달아 나오는 구간 — 멤버십 배너가 하나뿐이라 예전엔
  // 매번 같은 광고가 나왔다. 이게 David가 본 "와우 가입만 몇 번 연속"이다.
  for (let i = 0; i < 8; i++) seq.push(pick("business", "business").dest);
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i], seq[i - 1], `${i}번째에서 같은 광고가 연달아 나왔다: ${seq.join(" → ")}`);
  }
});

test("최근에 나온 광고는 일정 구간 안에 다시 안 나온다", () => {
  const pick = loadPicker(realItems());
  const N = Number(HTML.match(/const AD_NO_REPEAT = (\d+)/)[1]);
  const seq = [];
  for (let i = 0; i < 20; i++) seq.push(pick("life", "life").dest);
  for (let i = 0; i < seq.length; i++) {
    const window = seq.slice(Math.max(0, i - N), i);
    assert.ok(!window.includes(seq[i]),
      `최근 ${N}개 안에서 반복됐다 (${i}): ${seq.join(" → ")}`);
  }
});

test("문맥이 맞는 광고를 먼저 고른다", () => {
  const pick = loadPicker(realItems());
  // auto 재고는 자동차용품·타이어 둘. 처음 두 번은 그 둘이 나와야 한다.
  const a = pick("auto", "auto"), b = pick("auto", "auto");
  assert.equal(a.category, "auto");
  assert.equal(b.category, "auto");
  assert.notEqual(a.dest, b.dest);
});

test("위·아래 카드 카테고리를 모두 문맥으로 본다", () => {
  const pick = loadPicker(realItems());
  // 위가 자동차, 아래가 스포츠면 둘 중 어느 쪽이든 문맥 안에서 나와야 한다.
  // (아래 카드를 무시하면 스포츠 재고가 절대 안 나온다.)
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(pick("auto", "sports").category);
  assert.ok(seen.has("sports"), "아래 카드 카테고리가 무시됐다");
  assert.ok(seen.has("auto"), "위 카드 카테고리가 무시됐다");
});

test("재고가 하나뿐인 분야도 그것만 반복하지 않는다", () => {
  // 경제에는 멤버십 배너 하나뿐이라 예전엔 경제 글 구간에서 그것만 나왔다.
  // 인접 분야(가전·생활)까지 후보로 열어 분산시킨다.
  const pick = loadPicker(realItems());
  const seq = [];
  for (let i = 0; i < 12; i++) seq.push(pick("business", "business").dest);
  const wow = seq.filter((d) => d === "wow").length;
  assert.ok(wow <= 3, `멤버십이 12회 중 ${wow}회 나왔다: ${seq.join(" → ")}`);
  assert.ok(new Set(seq).size >= 4, `종류가 너무 적다: ${[...new Set(seq)].join(",")}`);
});

test("재고가 최근 목록보다 적어도 멈추지 않는다", () => {
  // 안전망 확인 — 후보가 1개뿐이면 반복은 불가피하지만 null을 뱉거나
  // 예외로 죽으면 안 된다(지면이 통째로 사라진다).
  const pick = loadPicker([{ category: "life", dest: "only", href: "https://link.coupang.com/a/x" }]);
  for (let i = 0; i < 5; i++) assert.equal(pick("life", "life").dest, "only");
});

test("후보가 없으면 조용히 null", () => {
  const pick = loadPicker([]);
  assert.equal(pick("life", "life"), null);
});
