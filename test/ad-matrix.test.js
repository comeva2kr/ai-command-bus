// 광고 문구 행렬 — 문구≠도착지 사고를 두 번 내지 않는 게 핵심이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVariant, validHook, contextOf, CONTEXTS, generateMatrix, buildMatrixPrompt } from "../src/feed/ad-matrix.js";
import { AD_COPY } from "../src/feed/ad-copy.js";

const MATRIX = { variants: { dgt: { tech: [{ hook: "모니터 하나 더 둘까 싶으면" }, { hook: "책상 위 정리할 때 됐으면" }] } } };

test("브랜드 줄은 행렬이 아니라 도착지 표에서 온다", () => {
  // 2026-08-03에 "가전·디지털"이라 써놓고 로켓직구로 보낸 사고가 있었다.
  // 모델이 도착지 이름을 바꿔 쓰면 같은 사고가 반복되므로 그 자리는 안 맡긴다.
  const v = pickVariant("dgt", "tech", { matrix: MATRIX });
  assert.equal(v.hook, "모니터 하나 더 둘까 싶으면");
  assert.equal(v.brand, AD_COPY.dgt[1], "브랜드 줄이 행렬에서 왔다");
});

test("행렬이 없으면 기본 문구로 떨어진다", () => {
  // 배치가 실패해도 광고가 사라지면 안 된다.
  for (const m of [null, {}, { variants: {} }, { variants: { dgt: {} } }, { variants: { dgt: { tech: [] } } }]) {
    const v = pickVariant("dgt", "tech", { matrix: m });
    assert.deepEqual([v.hook, v.brand], AD_COPY.dgt);
    assert.equal(v.variant, "base");
  }
});

test("변형마다 subId가 갈린다", () => {
  // 어느 문구가 실제로 팔리는지 쿠팡 대시보드에서 갈려야 최적화가 된다.
  const a = pickVariant("dgt", "tech", { matrix: MATRIX, rotate: 0 });
  const b = pickVariant("dgt", "tech", { matrix: MATRIX, rotate: 1 });
  assert.notEqual(a.variant, b.variant);
  assert.notEqual(a.hook, b.hook);
});

test("맥락 매핑은 모든 피드 카테고리를 받는다", () => {
  const ids = CONTEXTS.map((c) => c.id);
  for (const cat of ["tech", "life", "humor", "news", "sports", "auto", "business", "culture", "gaming", null, "없는카테고리"]) {
    assert.ok(ids.includes(contextOf(cat)), `${cat} → ${contextOf(cat)} 가 맥락 목록에 없다`);
  }
});

test("검증기: 가격·할인·과장·숫자를 막는다", () => {
  // 우리는 가격도 재고도 확인할 수 없다. 쓰는 순간 허위표시다.
  for (const bad of ["최저가 노트북 지금", "30% 할인 중인 모니터", "오늘만 이 가격", "역대급 특가 모음",
                     "짧다", "<b>태그</b> 섞인 문구입니다", "이 문구는 서른 자를 훌쩍 넘겨서 카드 한 줄에 도저히 안 들어가는 길이입니다"]) {
    assert.equal(validHook(bad), false, `통과하면 안 되는 문구: ${bad}`);
  }
  for (const good of ["차 관리 미루고 있던 것들", "장 볼 것 있으면 오늘", "모니터 하나 더 둘까 싶으면"]) {
    assert.equal(validHook(good), true, `막히면 안 되는 문구: ${good}`);
  }
});

test("프롬프트에 도착지 이름을 정확히 싣는다", () => {
  const p = buildMatrixPrompt(["dgt", "fresh"]);
  assert.ok(p.includes(AD_COPY.dgt[1]));
  assert.ok(p.includes(AD_COPY.fresh[1]));
  for (const c of CONTEXTS) assert.ok(p.includes(c.id));
});

test("생성 실패는 null — 기존 행렬을 덮어쓰지 않는다", async () => {
  // 광고가 사라지는 것보다 지난주 문구를 계속 쓰는 편이 낫다.
  const cases = [
    async () => ({ ok: false, status: 500, text: async () => "" }),
    async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) }),
    async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "{{{" }] }) }),
    async () => { throw new Error("net"); }
  ];
  for (const f of cases) {
    assert.equal(await generateMatrix({ apiKey: "k", dests: ["dgt"], fetchImpl: f }), null);
  }
  assert.equal(await generateMatrix({ apiKey: null, dests: ["dgt"] }), null, "키 없으면 호출조차 안 한다");
});

test("생성 결과에서 불량 문구만 걸러낸다", async () => {
  const payload = { cells: [{ dest: "dgt", context: "tech", hooks: ["모니터 바꿀 때 됐으면", "30% 할인 중", "최저가 보장"] },
                            { dest: "없는도착지", context: "tech", hooks: ["아무거나"] },
                            { dest: "dgt", context: "없는맥락", hooks: ["아무거나"] }] };
  const m = await generateMatrix({ apiKey: "k", dests: ["dgt"], fetchImpl: async () => ({
    ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }], usage: {} })
  })});
  assert.equal(m.variants.dgt.tech.length, 1, "불량 문구가 남았다");
  assert.equal(m.variants.dgt.tech[0].hook, "모니터 바꿀 때 됐으면");
  assert.equal(m.variants["없는도착지"], undefined, "모르는 도착지가 들어왔다");
  assert.equal(m.variants.dgt["없는맥락"], undefined, "모르는 맥락이 들어왔다");
});

test("광고 문구가 게시글처럼 제목·줄·CTA 셋을 갖는다", async () => {
  // David 2026-08-05: "제목이랑 하단에 내용글 좀 혹하게 LLM으로 만들 수 없어?"
  // 카드가 게시글 모양이 된 이상 제목만 있고 본문이 없으면 게시글로 안 읽힌다.
  const { pickVariant, loadMatrix } = await import("../src/feed/ad-matrix.js");
  const m = loadMatrix();
  const dests = Object.keys(m.variants || {});
  assert.ok(dests.length >= 15, `도착지가 모자란다: ${dests.length}`);
  let withLine = 0;
  for (const d of dests) {
    const v = pickVariant(d, "life");
    assert.ok(v.hook && v.cta, `${d}: 제목이나 CTA가 없다`);
    if (v.line && v.line !== v.brand) withLine++;
  }
  assert.ok(withLine >= dests.length * 0.9, `줄이 있는 도착지가 ${withLine}/${dests.length}뿐이다`);
});

test("광고 문구가 없는 상품을 아는 척하지 않는다", async () => {
  // 우리는 그 도착지에 지금 무엇이 있는지 **모른다** — 상품 API가 없다.
  // "이거 진짜 괜찮더라"는 없는 상품에 대한 후기가 되어 그 자체로 허위표시다.
  // David도 "당연히 서치베이스여야지"라고 했다 — 근거 없는 주장은 그 반대다.
  const { loadMatrix, validHook } = await import("../src/feed/ad-matrix.js");
  const m = loadMatrix();
  for (const [dest, ctxs] of Object.entries(m.variants || {})) {
    for (const [ctx, list] of Object.entries(ctxs)) {
      for (const v of list) {
        assert.ok(validHook(v), `${dest}/${ctx}: 검증을 통과 못 하는 문구가 저장돼 있다 — ${JSON.stringify(v)}`);
        const all = [v.hook, v.line, v.cta].filter(Boolean).join(" ");
        assert.ok(!/[0-9%％]/.test(all), `${dest}/${ctx}: 숫자가 들어 있다 — ${all}`);
        assert.ok(!/써\s*보니|먹어\s*보니|내돈내산|재구매|후기/.test(all),
          `${dest}/${ctx}: 써 봤다는 주장이 들어 있다 — ${all}`);
      }
    }
  }
});

test("앱 광고 카드가 LLM 문구를 실제로 쓴다 — hook만 쓰면 다 똑같아 보인다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 실기기(David 2026-08-06): "제목이랑 문장이 너무 단조로운데?"
  // 카드는 제목·본문·CTA 3단인데 adVariant가 hook 하나만 돌려줘서, 본문에는
  // 도착지 이름이, CTA에는 고정 문구가 나갔다. 서버 렌더 페이지는 이미
  // line을 쓰고 있어 앱만 옛 모양으로 남아 있었다.
  const fn = html.slice(html.indexOf("function adVariant"), html.indexOf("function coupangCardHtml"));
  assert.match(fn, /line: v\.line/, "행렬의 본문(line)을 안 돌려준다");
  assert.match(fn, /cta: v\.cta/, "행렬의 CTA를 안 돌려준다");
  // 도착지는 계속 밝혀야 한다 — 2026-08-03 "문구≠도착지" 사고의 방어선.
  assert.match(html, /class="ad-dest">\$\{escapeHtml\(link\.brand\)\}/, "도착지 라벨이 사라졌다");
  assert.match(html, /\.ad-dest\{display:block/, "도착지 라벨 스타일이 없다");
});

test("행렬이 모든 도착지 × 맥락을 덮는다", async () => {
  const { loadMatrix } = await import("../src/feed/ad-matrix.js");
  const m = loadMatrix();
  const v = m.variants || m;
  const dests = Object.keys(v);
  assert.ok(dests.length >= 18, `도착지 ${dests.length}종 — 재고(18)를 다 못 덮는다`);
  let empty = [];
  for (const d of dests) {
    for (const ctx of ["tech", "life", "fun", "news", "hobby"]) {
      const cell = v[d] && v[d][ctx];
      if (!Array.isArray(cell) || !cell.length) { empty.push(`${d}/${ctx}`); continue; }
      // 빈 칸은 정적 기본 문구로 떨어지고, 그러면 다시 단조로워진다.
      for (const one of cell) {
        assert.ok(one.hook && one.line && one.cta, `${d}/${ctx}에 3단이 안 찬 문구가 있다`);
      }
    }
  }
  assert.equal(empty.length, 0, `빈 칸: ${empty.slice(0, 6).join(", ")}`);
});
