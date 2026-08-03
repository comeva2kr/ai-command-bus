// 쿠팡 파트너스 배너 — Open API 승인 전에도 도는 제휴 수익 경로 (2026-08-03).
//
// API 키는 "최종 승인"(판매 15만원 + 사업자 인증) 회원만 나온다. 즉 매출이
// 먼저 나야 열린다. 카테고리 배너는 승인 없이 지금 쓸 수 있고, 어떤 상품을
// 보여줄지는 쿠팡이 정하므로 품절·시즌·가격을 우리가 관리하지 않아도 된다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadBanners, pickBanner, loadProducts } from "../src/feed/manual-products.js";

function tmpFile(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cb-")), "products.json");
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

test("배너: 쿠팡 도메인이 아닌 링크·이미지는 버린다", () => {
  // 임의 URL이 들어오면 우리 페이지에서 남의 리소스를 띄우는 셈이고,
  // 파트너스 링크가 아니면 광고는 뜨는데 수수료가 안 붙는 최악이 된다.
  const f = tmpFile({ banners: [
    { category: "tech", size: "320x100", href: "https://evil.example/x", img: "https://ads-partners.coupang.com/banners/1?w=320" },
    { category: "tech", size: "320x100", href: "https://link.coupang.com/a/OK", img: "https://evil.example/img.png" },
    { category: "tech", size: "320x100", href: "https://link.coupang.com/a/GOOD", img: "https://ads-partners.coupang.com/banners/2?w=320" }
  ] });
  const out = loadBanners({ file: f });
  assert.equal(out.length, 1, "쿠팡 도메인 쌍이 맞는 것만 남아야 한다");
  assert.match(out[0].href, /link\.coupang\.com/);
});

test("배너: 정치·종교·성인 카테고리에는 붙이지 않는다", () => {
  const f = tmpFile({ banners: ["politics", "religion", "adult", "tech"].map((c) => ({
    category: c, size: "320x100",
    href: `https://link.coupang.com/a/${c}`,
    img: `https://ads-partners.coupang.com/banners/1?c=${c}`
  })) });
  const out = loadBanners({ file: f });
  assert.deepEqual(out.map((b) => b.category), ["tech"]);
});

test("배너: alt로 쓸 label이 비면 최소한 광고임은 밝힌다", () => {
  // 쿠팡 배너 원본 HTML은 alt=""다. 네이버 가이드는 alt로 내용을 설명하라고 한다.
  const f = tmpFile({ banners: [{ category: "tech", size: "320x100",
    href: "https://link.coupang.com/a/A", img: "https://ads-partners.coupang.com/banners/1" }] });
  assert.equal(loadBanners({ file: f })[0].label, "쿠팡 파트너스 광고");
});

test("배너: 문맥이 맞는 카테고리를 먼저 고르고, 없으면 폴백한다", () => {
  const f = tmpFile({ banners: [
    { category: "tech", size: "320x100", href: "https://link.coupang.com/a/T", img: "https://ads-partners.coupang.com/banners/1", label: "가전" },
    { category: "auto", size: "320x100", href: "https://link.coupang.com/a/A", img: "https://ads-partners.coupang.com/banners/2", label: "자동차" }
  ] });
  assert.equal(pickBanner({ category: "auto", size: "320x100", file: f }).label, "자동차");
  // 매칭이 없으면 비우지 않고 폴백한다 — 지면이 0인 것보다 낫다
  assert.ok(pickBanner({ category: "news", size: "320x100", file: f }), "폴백이 나와야 한다");
});

test("배너: 같은 자리에 같은 배너를 반복하지 않는다 (회전)", () => {
  const f = tmpFile({ banners: ["A", "B", "C"].map((n) => ({
    category: "life", size: "320x100",
    href: `https://link.coupang.com/a/${n}`, img: `https://ads-partners.coupang.com/banners/${n}`, label: n
  })) });
  const seen = new Set();
  const got = [];
  for (let i = 0; i < 3; i++) {
    const b = pickBanner({ category: "life", size: "320x100", seen, file: f });
    got.push(b.label);
    seen.add(b.id);
  }
  assert.equal(new Set(got).size, 3, `3종이 모두 나와야 하는데: ${got.join(",")}`);
});

test("배너: 요청한 사이즈만 돌려준다", () => {
  const f = tmpFile({ banners: [
    { category: "tech", size: "320x100", href: "https://link.coupang.com/a/S", img: "https://ads-partners.coupang.com/banners/1" }
  ] });
  assert.ok(pickBanner({ size: "320x100", file: f }));
  assert.equal(pickBanner({ size: "300x250", file: f }), null, "없는 사이즈에 억지로 다른 걸 주면 레이아웃이 깨진다");
});

test("실제 등록된 배너가 규격을 지킨다", () => {
  const all = loadBanners();
  assert.ok(all.length > 0, "배너가 등록되어 있어야 한다");
  for (const b of all) {
    assert.match(b.href, /^https:\/\/link\.coupang\.com\//, `${b.label}: 파트너스 링크가 아니다`);
    assert.match(b.img, /^https:\/\/ads-partners\.coupang\.com\//, `${b.label}: 배너 이미지가 아니다`);
    assert.match(b.size, /^\d+x\d+$/, `${b.label}: 사이즈 형식`);
    assert.ok(b.label && b.label.length > 2, `${b.label}: alt로 쓸 설명이 필요하다`);
  }
  // 같은 크리에이티브(배너 id)가 중복 등록되면 회전이 헛돈다
  const ids = all.map((b) => b.img.match(/banners\/(\d+)/)?.[1] + "|" + b.size);
  assert.equal(new Set(ids).size, ids.length, "같은 배너가 중복 등록됐다");
});

test("서버 렌더: 배너에 AD 표기·대가성 문구·sponsored 링크가 함께 나간다", async () => {
  // 대가성 문구는 법적 의무이고, 쿠팡도 "활동 준수 사항을 지키지 않으면 수익금
  // 지급이 중단될 수 있습니다"라고 명시한다. 하나라도 빠지면 안 된다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  try {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/briefing`)).text();
    assert.match(html, /class="ad-slot ad-coupang"/, "배너 지면이 있어야 한다");
    assert.match(html, /AD · 쿠팡 파트너스/, "광고 표기");
    assert.match(html, /쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/,
      "대가성 문구가 빠지면 수익금 지급이 중단될 수 있다");
    assert.match(html, /rel="nofollow sponsored noopener"/, "제휴 링크는 sponsored로 표시한다");
    assert.doesNotMatch(html, /<img[^>]*ads-partners[^>]*alt=""/, "배너 alt가 비면 안 된다");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
