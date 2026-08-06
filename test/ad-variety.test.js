// 한 페이지에 같은 광고가 두 번 나오지 않게, 문구는 골고루 돌게
// (David 제보 2026-08-06: "브리핑에 광고 두 개가 같은 게 나왔어").
//
// 원인은 pickBanner가 seen을 받게 돼 있는데 호출부가 한 번도 넘기지
// 않은 것이었다. 재고가 적으면 pick % length가 겹쳐 같은 상품이 나온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/feed/server.js", "utf8");

test("배너 렌더러가 seen을 pickBanner에 넘긴다", () => {
  const fn = src.slice(src.indexOf("const coupangBannerHtml = ("),
                       src.indexOf("const adSlotHtml = "));
  assert.match(fn, /pickBanner\(\{[^}]*seen/, "seen을 안 넘긴다 — 같은 광고가 두 번 나온다");
  assert.match(fn, /if \(seen\) seen\.add\(b\.id\)/, "고른 것을 seen에 안 넣는다");
});

test("여러 광고가 나가는 페이지는 전부 한 묶음(adPage)으로 그린다", () => {
  // 라우트 안에서 coupangBannerHtml을 직접 부르면 그 자리만 묶음 밖으로
  // 빠져나가 중복이 되살아난다. 직접 호출은 정의부와 adPage 안에만 있어야 한다.
  const body = src.slice(src.indexOf("const adSlotHtml = "));
  const direct = (body.match(/coupangBannerHtml\(/g) || []).length;
  assert.equal(direct, 0,
    `라우트가 coupangBannerHtml을 직접 부른다(${direct}곳) — adPage()를 거쳐야 한다`);
  assert.ok((src.match(/const AD = adPage\(\)/g) || []).length >= 8,
    "광고가 둘 이상 나가는 페이지 일부가 묶이지 않았다");
});

test("문구 회전값이 자리 번호에만 매이지 않는다", () => {
  // pick은 자리마다 고정이라 같은 자리엔 늘 같은 문장이 나왔다.
  // 270개를 만들어 두고 몇 개만 돌려쓴 셈이다.
  const fn = src.slice(src.indexOf("const coupangBannerHtml = ("),
                       src.indexOf("const adSlotHtml = "));
  assert.match(fn, /rotate: pick \+ adTurn/, "회전값이 자리 번호로 고정돼 있다");
  assert.match(src, /adTurn = \(adTurn \+ 1\) % 997/, "방문 순번이 돌지 않는다");
});

test("브리핑의 첫 광고와 끝 광고도 근처 글에 맞춘다", () => {
  // 예전엔 category·dest를 둘 다 null로 넘겨, 가장 눈에 띄는 자리만 문맥과 무관했다.
  assert.match(src, /AD\(cat0, null, 3, "brief_mid", dest0\)/, "첫 광고가 문맥과 무관하다");
  assert.match(src, /AD\(catL, null, 7, "page_bot", destL\)/, "끝 광고가 문맥과 무관하다");
  assert.match(src, /const dest0 = cat0 && sec0\.items\[0\] \? destForText\(sec0\.items\[0\]\.title\)/);
});

test("랭킹 중간 광고는 바로 위 글을 받아 맞춘다", () => {
  const fn = src.slice(src.indexOf("const rankingRows = ("),
                       src.indexOf("const mergeRankings = "));
  assert.match(fn, /const above = slice\[slice\.length - 1\]/, "위 글을 안 본다");
  assert.match(fn, /typeof mid === "function" \? mid\(above\) : mid/, "함수 형태를 안 받는다");
});

test("정치·뉴스에는 상품 매칭을 붙이지 않는다 — 회전을 넣어도 그대로", () => {
  // AD_MATCH_OFF_CATS 가드가 새 코드에도 살아 있어야 한다.
  assert.match(src, /AD_MATCH_OFF_CATS\.has\(sec0\.category\)/);
  assert.match(src, /AD_MATCH_OFF_CATS\.has\(above\.category\)/);
});

test("같은 문맥이 연달아 와도 같은 광고를 두 번 주지 않는다", async () => {
  // 재고가 도착지당 1종(실측 18종/18도착지)이라, 예전 티어 안 폴백은
  // 첫 티어에서 바로 "이미 나온 그것"을 다시 돌려줬다 — seen을 넘겨도 소용없었다.
  const { pickBanner } = await import("../src/feed/manual-products.js");
  const seen = new Set();
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const b = pickBanner({ category: "tech", dest: "dgt", pick: i, seen });
    if (!b) break;
    seen.add(b.id);
    picked.push(b.id);
  }
  assert.ok(picked.length >= 5, "여섯 칸을 채우지 못했다");
  assert.equal(new Set(picked).size, picked.length, "같은 광고가 두 번 나왔다");
});

test("재고를 다 쓰면 다시 돌아온다 — 광고가 사라지지는 않는다", async () => {
  // 중복을 막느라 빈 칸을 만들면 그게 더 나쁘다.
  const { pickBanner, loadBanners } = await import("../src/feed/manual-products.js");
  const seen = new Set(loadBanners().map((b) => b.id));
  const b = pickBanner({ category: "tech", pick: 0, seen });
  assert.ok(b, "전부 나온 뒤에 광고가 사라졌다");
});
