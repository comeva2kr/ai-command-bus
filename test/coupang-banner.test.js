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

test("배너: 크기로 거르지 않는다 — 거르면 광고가 통째로 사라진다", () => {
  // 계약 변경 2026-08-05. 예전엔 요청한 크기만 돌려줬다("없는 사이즈에 억지로
  // 다른 걸 주면 레이아웃이 깨진다"). 그때는 배너를 원본 크기로 그대로 깔았기
  // 때문에 맞는 말이었다.
  //
  // 지금은 76px 정사각 썸네일에 object-fit:cover로 넣으므로 원본 크기가
  // 레이아웃을 깨지 않는다. 반대로 크기 필터가 남아 있으면, 재고를 200x200으로
  // 갈아치운 순간 옛 크기를 넘기는 호출부에서 **재고가 0이 되어 광고가 사라진다**
  // — 실제로 그렇게 깨졌다.
  const f = tmpFile({ banners: [
    { category: "tech", size: "200x200", href: "https://link.coupang.com/a/S", img: "https://ads-partners.coupang.com/banners/1" }
  ] });
  assert.ok(pickBanner({ size: "200x200", file: f }));
  assert.ok(pickBanner({ size: "320x100", file: f }), "옛 크기를 넘겨도 광고는 나와야 한다");
  assert.ok(pickBanner({ file: f }), "크기를 안 넘겨도 나와야 한다");
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
    // 표기 마크업이 바뀌었다(2026-08-03): 예전엔 "AD · 쿠팡 파트너스" 한 줄
    // 회색 텍스트였는데, 그러면 본문과 같은 색이라 표시로서 기능하지 못했다.
    // 이제 AD는 잉크/종이 반전 칩이다. 의도(광고임을 밝힌다)는 그대로 검사한다.
    assert.match(html, /<span class="ad-tag">AD<\/span> 쿠팡 파트너스/, "광고 표기");
    assert.match(html, /쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/,
      "대가성 문구가 빠지면 수익금 지급이 중단될 수 있다");
    assert.match(html, /rel="nofollow sponsored noopener"/, "제휴 링크는 sponsored로 표시한다");
    assert.doesNotMatch(html, /<img[^>]*ads-partners[^>]*alt=""/, "배너 alt가 비면 안 된다");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test("광고 카드가 콘텐츠 카드와 같은 모양이다", async () => {
  // David 실기기 2026-08-05: "쿠팡이야말로 목록에서 사진 정사각형 비슷한 비율로
  // 우측에 넣고 내용 더 혹하게 왼쪽에 제목이랑 정리글처럼 넣어서 게시글처럼
  // 보이게 해야 되는 거 아냐? 지금 사진 너무 큰데."
  //
  // 예전엔 가로 배너(320x100, 3.2:1)를 카드 폭 전체에 깔아서 광고 카드만
  // 혼자 다른 모양이었다 — 스크롤하다 보면 광고 티가 확 났다.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const from = html.indexOf("function coupangCardHtml");
  const block = html.slice(from, from + 1400);

  assert.match(block, /class="ad-row"/, "가로 배치(제목 왼쪽·썸네일 오른쪽)가 아니다");
  assert.match(block, /class="ad-thumb"/, "썸네일 자리가 없다");
  // 클래스 이름이 아니라 **자리**를 본다 — ad-img는 이제 썸네일 안에 있다.
  assert.match(block, /class="ad-thumb"><img class="ad-img"/, "이미지가 썸네일 상자 안에 있지 않다");
  assert.doesNotMatch(html.slice(from, from + 1400), /width="320" height="100"/, "가로 배너 규격이 남아 있다");
  // 콘텐츠 카드 썸네일과 같은 규격(76px 정사각)이어야 나란히 놓았을 때 어긋나지 않는다
  assert.match(html, /\.card \.ad-native \.ad-thumb\{[^}]*width:76px;height:76px/,
    "썸네일이 콘텐츠 카드(76px 정사각)와 다른 규격이다");
  assert.match(html, /\.card \.ad-native \.ad-thumb img\{[^}]*object-fit:cover/,
    "정사각이 아닌 이미지가 들어와도 찌그러지지 않게 잘라야 한다");
});

test("정사각 배너를 먼저 쓴다", async () => {
  // 배너 크기는 URL의 w/h가 아니라 **배너 ID 자체**가 정한다
  // (1013444=320x100, 1014366=200x200). 그래서 크기별로 쿠팡 콘솔에서 따로
  // 뽑아야 하고 그건 David만 할 수 있다 — 내가 ID를 추측하면 링크와 이미지가 어긋난다.
  const { loadBanners, pickBanner } = await import("../src/feed/manual-products.js");
  const square = loadBanners().filter((b) => b.size === "200x200");
  assert.ok(square.length >= 10, `정사각 배너가 모자란다: ${square.length}개`);

  // 정사각 재고가 있는 분야는 정사각이 먼저 나와야 한다
  for (const cat of ["tech", "life", "auto", "sports", "culture"]) {
    const picked = pickBanner({ category: cat });
    assert.ok(picked, `${cat}: 배너가 안 골라진다`);
    assert.equal(picked.size, "200x200", `${cat}: 가로 배너가 먼저 나온다 (${picked.size})`);
  }
});

test("앱 config가 전 재고를 내려보낸다 — 크기로 거르지 않는다", async () => {
  // 2026-08-05 실사고: 재고를 200x200으로 갈아치웠는데 /api/config 쪽에
  // size === "320x100" 필터가 남아 있어서 **앱에서만 광고가 0이 됐다.**
  // 발행 페이지는 pickBanner를 쓰니 멀쩡했고, 그래서 배포 확인에서야 잡혔다.
  // 같은 필터가 두 곳에 있었고 하나만 고친 것이 원인이다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: [{ id: "s", kind: "news", async fetch() { return []; } }] });
  await new Promise((r) => server.listen(0, r));
  try {
    const cfg = await (await fetch(`http://localhost:${server.address().port}/api/config`)).json();
    const items = (cfg.coupang && cfg.coupang.items) || [];
    const { loadBanners } = await import("../src/feed/manual-products.js");
    assert.equal(items.length, loadBanners().length, "앱이 받는 재고가 서버 재고와 다르다");
    assert.ok(items.length >= 10, `재고가 너무 적다: ${items.length}`);
    for (const it of items) {
      assert.ok(it.href && it.img, "링크나 이미지가 빠졌다");
      assert.ok(it.hook && it.brand, "문구가 빠졌다 — 클라이언트가 표를 복사하면 안 된다");
    }
  } finally { server.close(); }
});

test("광고 썸네일이 콘텐츠 썸네일과 같은 크기다", async () => {
  // 브라우저 실측 2026-08-05: 광고 76px vs 콘텐츠 88px로 어긋나 있었다.
  // .card-thumb 기본값이 76px인데 #feed .card .card-thumb 가 88px로 덮는다 —
  // CSS 파일만 읽고 76을 따라 쓰면 광고만 작아진다. 실제로 그렇게 틀렸다.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const num = (re) => {
    const m = html.match(re);
    return m ? Number(m[1]) : null;
  };
  const content = num(/#feed \.card \.card-thumb\{flex:0 0 (\d+)px/);
  const ad = num(/#feed \.card \.ad-native \.ad-thumb\{flex:0 0 (\d+)px/);
  assert.ok(content, "콘텐츠 썸네일 규칙을 못 찾았다");
  assert.ok(ad, "광고 썸네일 규칙을 못 찾았다 — 광고만 다른 크기가 된다");
  assert.equal(ad, content, `광고 ${ad}px vs 콘텐츠 ${content}px — 같아야 한다`);
});
