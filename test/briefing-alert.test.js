// NH121: 옛 브리핑 종료. 공용 광고 선택 기능은 유지한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


test("배너를 도착지로 고를 수 있다 — 없으면 조용히 기존 순서로", async () => {
  const { pickBanner } = await import("../src/feed/manual-products.js");
  const want = pickBanner({ dest: "fresh" });
  assert.ok(want, "재고가 있는데 못 골랐다");
  assert.equal(want.dest, "fresh");
  // 없는 도착지를 달라고 해도 광고가 사라지면 안 된다.
  const fallback = pickBanner({ dest: "존재하지않는도착지" });
  assert.ok(fallback, "없는 도착지를 요청했더니 광고가 통째로 사라졌다");
});


test("옛 브리핑·RSS는 수집/발행 없이 GET·HEAD 410을 내고 오늘판은 유지한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const { JsonSource } = await import("../src/feed/content.js");
  let collected = 0;
  const srv = createServer({ localEditorial: true, localEditorialInventorySchedule: false,
    sources: [new JsonSource("clien", async () => { collected++; return []; }, "community")] });
  await new Promise(resolve => srv.listen(0, resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const path of ["/briefing", "/briefing/2026-09-04?slot=lunch", "/briefing/tech", "/briefing/%3Cscript%3E", "/api/briefing", "/rss.xml"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(base + path, { method });
        assert.equal(response.status, 410, path);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-robots-tag"), "noindex");
        const body = await response.text();
        if (method === "HEAD") assert.equal(body, "");
        else if (path.startsWith("/briefing")) {
          assert.match(body, /종료했습니다/);
          assert.match(body, /href="\/"/);
          assert.doesNotMatch(body, /<script|kakao_ad_area|link\.coupang\.com|<article/);
        } else assert.equal(JSON.parse(body).code, "LEGACY_BRIEFING_RETIRED");
      }
    }
    assert.equal(collected, 0, "종료 주소는 수집이나 새 브리핑을 만들지 않는다");
    const today = await fetch(base + "/");
    assert.equal(today.status, 200);
    assert.match(await today.text(), /id="issues"/);
    const live = await (await fetch(base + "/live")).text();
    assert.doesNotMatch(live, /\/api\/briefing|href="\/briefing|id="ownBlock"|id="briefStrip"/);
    const sitemap = await (await fetch(base + "/sitemap.xml")).text();
    assert.doesNotMatch(sitemap, /\/briefing|\/rss\.xml/);
    const source = readFileSync("src/feed/server.js", "utf8");
    assert.doesNotMatch(source, /briefingTick|currentBriefing|withEssay|makeWriter|saveBriefing\(/);
    assert.match(readFileSync("src/feed/engine.js", "utf8"), /await this\.briefing\(/,
      "오늘판이 사용하는 공용 편집 함수는 유지한다");
  } finally {
    srv.closeAllConnections?.();
    await new Promise(resolve => srv.close(resolve));
  }
});
