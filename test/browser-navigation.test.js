import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch {}
let browser;
before(async () => { if (chromium) browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }); });
after(async () => { await browser?.close(); });
const options = { skip: !chromium, timeout: 30000 };
const origin = "https://nowhot.test";
const category = { id: "business", label: "경제" };
const { latestRelease } = await import("../src/feed/release-notes.js");
const release = {
  id: "2026-09-04-major",
  title: "오늘판과 실시간을 새롭게 정리했어요",
  items: ["오늘판은 미리 준비된 브리핑을 바로 보여줘요."]
};
const affiliateInventory = {
  disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받습니다.",
  items: ["a", "b", "c"].map(id => ({ category: "business", dest: id,
    href: `https://link.coupang.com/a/fixture-${id}`, img: "https://banner.test/unavailable.png",
    hook: `쿠팡 상품 ${id}`, brand: `쿠팡 쇼핑 ${id}` }))
};
const items = Array.from({ length: 18 }, (_, i) => ({
  id: `post-${i}`, title: `Public article ${i}`, summary: `Public feed excerpt for article ${i}.`,
  url: `https://publisher.test/article-${i}`, source: "test", kind: "news", category: "business",
  categoryLabel: "경제", publishedAt: "2026-09-03T00:00:00Z", score: 1, comments: 0
}));
const edition = {
  editionId: "SCE-test-lunch", editionDate: "2026-09-03", generatedAt: "2026-09-03T03:00:00Z",
  slot: { id: "lunch", label: "런치" }, requestedCategories: ["business"], availableCategories: [category],
  selection: { categories: [category], categoryIssueLimit: 14, mode: "saved" },
  sourceCount: 1, overseasShare: 0, llmCalls: 0,
  issues: items.map((item, i) => ({
    evidenceHash: `issue-${i}`, headline: item.title, reader: { headline: item.title, whyImportant: "Known public facts" },
    categoryIds: ["business"], selectedByCategories: ["business"],
    articleSummary: { status: "ready", textKo: "검증된 기존 기사 요약입니다. ".repeat(18), sourceCount: 1,
      sourceLinks: [{ url: item.url, sourceLabel: "Test", sourceGroup: "test" }] }
  }))
};

async function fixture(t, path = "/live", realWorker = false, guideState = "seen", cold = false, iosTab = false) {
  let base = origin;
  if (realWorker) {
    const server = createServer((req, res) => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const name = pathname === "/live" ? "index.html" : pathname === "/" ? "today.html" : pathname.slice(1);
      try {
        if (!/^[\w.-]+$/.test(name)) throw new Error("invalid path");
        res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".html") ? "text/html" : "image/png");
        res.end(readFileSync(new URL(`../src/feed/public/${name}`, import.meta.url)));
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => { server.closeAllConnections(); server.close(); });
  }
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  context.setDefaultTimeout(4000);
  t.after(() => context.close());
  const requests = [];
  const controls = { itemStatus: 200, itemCode: "", delayItem: 0, todayStatus: 200, todayEdition: edition, todayQueries: [], mixBalance: 0, sourceKind: "news", feedHandler: null, coupang: null };
  await context.addInitScript(({ realWorker, guideState, releaseId, iosTab }) => {
    if (!localStorage.getItem("__fixture_seeded")) {
      localStorage.clear();
      if (guideState !== "new") localStorage.setItem("feed_uid", "reader");
      if (guideState !== "new") localStorage.setItem("feed_onboarded_v1", "1");
      if (guideState === "seen") localStorage.setItem("feed_seen_release", releaseId);
      if (guideState === "returning") localStorage.setItem("feed_seen_release", "older-release");
      localStorage.setItem("__fixture_seeded", "1");
    }
    window.__localNotifications = 0;
    window.__permissionRequests = 0;
    window.__workerMessage = null;
    if (realWorker === "legacy") {
      const listen = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker);
      navigator.serviceWorker.addEventListener = (name, ...args) => { if (name !== "message") listen(name, ...args); };
    }
    if (!realWorker) Object.defineProperty(navigator, "serviceWorker", { value: {
      register: async () => ({}),
      ready: Promise.resolve({ showNotification: () => { window.__localNotifications++; },
        pushManager: { getSubscription: async () => ({ endpoint: "test", toJSON: () => ({ endpoint: "test" }) }) } }),
      addEventListener: (name, fn) => { if (name === "message") window.__workerMessage = fn; }
    } });
    if (iosTab) {
      delete window.Notification;
      Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
      Object.defineProperty(navigator, "standalone", { value: false });
    } else Object.defineProperty(window, "Notification", { value: { permission: "granted", requestPermission: async () => {window.__permissionRequests++;return "granted"} } });
  }, { realWorker, guideState, releaseId: release.id, iosTab });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.hostname === "publisher.test") return route.fulfill({ contentType: "text/html", body: "<h1>Publisher</h1>" });
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      if (url.pathname === "/api/config") body = { categories: [category], topics: [], ads: {}, release,
        coupang: controls.coupang, monetization: { enabled: Boolean(controls.coupang) } };
      if (url.pathname === "/api/session") body = { userId: "reader", surveyed: true, showTopics: [], briefingCategories: ["business"], mixBalance: controls.mixBalance };
      if (url.pathname === "/api/communities") body = { communities: [{ id: "test", label: "Test", kind: controls.sourceKind, enabled: true, adult: false, liveCount: 18 }] };
      if (url.pathname === "/api/feed") body = controls.feedHandler ? await controls.feedHandler(url) : { items, nextCursor: 18, exhausted: true };
      if (url.pathname === "/api/mix") {
        controls.mixBalance = route.request().postDataJSON().balance;
        body = { ok: true, balance: controls.mixBalance };
      }
      if (url.pathname === "/api/digest") body = { count: 1, top: [items[0]] };
      if (url.pathname === "/api/today") {
        controls.todayQueries.push(url.search);
        return route.fulfill({ status: controls.todayStatus, json: controls.todayStatus === 200
          ? controls.todayEdition : { error: "요청한 판이 없습니다", code: "SLOT_CANONICAL_EDITION_UNAVAILABLE" } });
      }
      if (url.pathname === "/api/item") {
        if (controls.delayItem) await new Promise((resolve) => setTimeout(resolve, controls.delayItem));
        body = controls.itemStatus === 200 ? items.find((item) => item.id === url.searchParams.get("itemId"))
          : { error: "request failed", code: controls.itemCode };
        return route.fulfill({ status: controls.itemStatus, json: body || {} });
      }
      return route.fulfill({ json: body });
    }
    const name = url.pathname === "/live" ? "index.html" : url.pathname === "/" ? "today.html" : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(name)) return route.abort();
    try {
      const body = readFileSync(new URL(`../src/feed/public/${name}`, import.meta.url));
      return route.fulfill({ body, contentType: name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" : "image/svg+xml" });
    } catch { return route.fulfill({ status: 404, body: "missing" }); }
  });
  const page = await context.newPage();
  if(cold)await (await context.newCDPSession(page)).send("Page.navigate",{url:base+path});
  else await page.goto(base + path);
  return { page, requests, controls, context, base };
}

test("browser: Today service menu remains reachable on narrow screens", options, async (t) => {
  const { page, base } = await fixture(t, "/");
  await page.waitForSelector(".issue");
  for (const width of [320,393,1100]) {
    await page.setViewportSize({width,height:852});
    await page.locator(".service-menu summary").click();
    const link=page.locator('.service-menu a[href="/feedback"]');
    assert.equal(await link.isVisible(),true);
    const bounds=await page.locator(".topbar-inner").evaluate(el=>({width:document.documentElement.clientWidth,right:el.querySelector(".service-menu").getBoundingClientRect().right,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
    assert.ok(bounds.right<=bounds.width);assert.equal(bounds.overflow,0);
    await page.locator(".service-menu summary").click();
  }
  await page.locator(".service-menu summary").click();
  await page.locator('.service-menu a[href="/feedback"]').click();
  assert.equal(page.url(),base+"/feedback");
});

test("browser: restored Live list uses the current Coupang inventory", options, async (t) => {
  const { page, controls } = await fixture(t);
  await page.waitForSelector("#feed .card");
  assert.equal(await page.locator("#feed .ad-card").count(), 0);
  controls.coupang = {
    disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받습니다.",
    items: [{ category: "business", dest: "shop", href: "https://link.coupang.com/a/fixture",
      hook: "필요한 상품을 확인해 보세요", brand: "쿠팡 쇼핑" }]
  };
  await page.reload();
  await page.waitForSelector("#feed .ad-card a.card-go", { state: "visible" });
  assert.equal(await page.locator("#feed .card:not(.ad-card)").count(), items.length);
  assert.match(await page.locator("#feed .ad-card").first().innerText(), /쿠팡 파트너스[\s\S]*수수료/);
  assert.match(await page.locator("#feed .ad-card a.card-go").first().getAttribute("href"), /^https:\/\/link\.coupang\.com\//);
});

test("browser: Live immersion retains affiliate content when its image fails", options, async (t) => {
  const { page, controls } = await fixture(t);
  await page.waitForSelector("#feed .card");
  controls.coupang = affiliateInventory;
  await page.evaluate(() => localStorage.setItem("feed_immersion", "1"));
  await page.reload();
  await page.waitForSelector("body.immersion #feed .card");
  // The blocker cleanup runs on the next frame and again after 600 ms.
  await page.waitForTimeout(800);
  assert.ok(await page.locator("#feed .ad-card .go-cta").count() > 0);
  assert.equal(await page.locator("#feed .ad-card .go-thumb").count(), 0);
  assert.match(await page.locator("#feed .ad-card").first().innerText(), /쿠팡 파트너스[\s\S]*수수료/);
  // An explicit content blocker remains respected even in immersion mode.
  await page.addStyleTag({ content: ".ad-card .card-go { display:none!important }" });
  await page.getByRole("tab", { name: "최신", exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#feed .ad-card").count(), 0);
});

test("browser: Today affiliates preserve issue order, detail and restored inventory", options, async (t) => {
  const { page, controls } = await fixture(t, "/");
  await page.waitForSelector("#issues .issue");
  assert.equal(await page.locator("#issues .ad-coupang").count(), 0);
  controls.coupang = affiliateInventory;
  await page.reload();
  await page.waitForSelector("#issues .ad-coupang a", { state: "visible" });
  assert.equal(await page.locator("#issues .ad-coupang h2 .issue-title-button").count(), 2,
    "광고도 기사와 같은 제목 구조를 사용한다");
  assert.equal(await page.locator("#issues .ad-coupang img,#issues .ad-coupang .ad-go").count(), 0,
    "기사 목록에 없는 썸네일과 별도 구매 버튼 행을 두지 않는다");
  assert.equal(await page.locator("#issues .ad-coupang .change-row .ad-disclosure").count(), 2,
    "제휴 고지도 기사 하단 행의 서식으로 제공한다");
  for (const width of [320, 393, 1100]) {
    await page.setViewportSize({ width, height: 852 });
    const style = await page.locator("#issues .ad-coupang").first().evaluate(ad => {
      const issue = ad.previousElementSibling;
      const row = el => { const s = getComputedStyle(el); return [s.gridTemplateColumns, s.gap, s.padding, s.borderBottom]; };
      const title = el => { const s = getComputedStyle(el); return [s.fontSize, s.lineHeight, s.fontWeight]; };
      return { ad: row(ad), issue: row(issue), adTitle: title(ad.querySelector("h2")),
        issueTitle: title(issue.querySelector("h2")), right: ad.getBoundingClientRect().right,
        overflow: ad.scrollWidth > ad.clientWidth, mark: ad.querySelector(".ad-mark").textContent };
    });
    assert.deepEqual(style.ad, style.issue, `${width}: 광고와 오늘판 행 서식`);
    assert.deepEqual(style.adTitle, style.issueTitle, `${width}: 광고와 기사 제목 서식`);
    assert.equal(style.overflow, false);
    assert.ok(style.right <= width);
    assert.equal(style.mark, "AD");
    await page.locator("#issues .ad-coupang").first().screenshot({ path: `/tmp/nh122-today-ad-${width}.png` });
  }
  await page.setViewportSize({ width: 1100, height: 760 });
  const numbers = await page.locator("#issues .issue-number").allTextContents();
  assert.deepEqual(numbers, items.map((_, i) => String(i + 1).padStart(2, "0")));
  assert.equal(await page.locator("#issues .ad-coupang").count(), 2);
  assert.equal(await page.locator("#issues .ad-coupang").first().evaluate(el => el.previousElementSibling.dataset.issueIndex), "2");
  const links = await page.locator("#issues .ad-coupang a").evaluateAll(nodes => nodes.map(a => a.href));
  assert.equal(new Set(links).size, 2);
  assert.ok(links.every(href => href.startsWith("https://link.coupang.com/")));
  await page.locator("[data-open-issue='0']").click();
  await page.waitForSelector("#detailContent .ad-coupang a", { state: "visible" });
  assert.match(await page.locator("#detailContent .ad-coupang").innerText(), /쿠팡 파트너스[\s\S]*수수료/);
  assert.equal(await page.locator("#detailContent .ad-coupang h2 .issue-title-button").isVisible(), true);
  assert.equal(await page.locator("#detailContent .ad-coupang h2").evaluate(el => getComputedStyle(el).fontSize),
    await page.locator("#issues .ad-coupang h2").first().evaluate(el => getComputedStyle(el).fontSize),
    "상세 광고도 목록의 기사 제목 서식을 유지한다");
  await page.getByRole("button", { name: "기사 요약 닫기" }).click();
  await page.reload();
  await page.waitForSelector("#issues .ad-coupang");
  assert.equal(await page.locator("#issues .issue").count(), items.length);
  assert.equal(await page.locator("#issues .ad-coupang").count(), 2);
});

test("browser: Today ads honor excluded neighbors and partner URL boundaries", options, async (t) => {
  const { page, controls } = await fixture(t, "/");
  await page.waitForSelector("#issues .issue");
  controls.coupang = { ...affiliateInventory, items: [...affiliateInventory.items,
    { ...affiliateInventory.items[0], href: "https://link.coupang.com.evil.test/a", hook: "INVALID AFFILIATE" }] };
  controls.todayEdition = structuredClone(edition);
  controls.todayEdition.issues[2].categoryIds = ["politics"];
  controls.todayEdition.issues[13].adUnsafe = true;
  await page.reload();
  await page.waitForSelector("#issues .issue");
  assert.equal(await page.locator("#issues .ad-coupang").count(), 0);
  assert.equal(await page.locator("#issues .issue").count(), items.length);
  await page.locator("[data-open-issue='2']").click();
  assert.equal(await page.locator("#detailContent .ad-coupang").count(), 0);
  await page.getByRole("button", { name: "기사 요약 닫기" }).click();
  await page.locator("[data-open-issue='0']").click();
  assert.match(await page.locator("#detailContent .ad-coupang a").getAttribute("href"), /^https:\/\/link\.coupang\.com\//);
  assert.doesNotMatch(await page.locator("#detailContent").innerText(), /INVALID AFFILIATE/);
});

test("browser: cold Live detail owns a list entry; Back/Forward/reload preserve intent", options, async (t) => {
  const { page } = await fixture(t, "/live#post-post-0");
  await page.waitForSelector("#detail.open");
  await page.reload();
  await page.waitForSelector("#detail.open");
  await page.click("#backBtn");
  await page.waitForFunction(() => !location.hash && !document.querySelector("#detail.open"));
  await page.goForward();
  await page.waitForSelector("#detail.open");
  assert.match(await page.locator("#detailTitle").innerText(), /Public article 0/);
});

test("browser: Live reload replaces a snapshot when the registered source kind changes", options, async (t) => {
  const { page, controls } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-0"]');
  controls.sourceKind = "community";
  controls.feedHandler = async () => ({ items: items.map(item => ({ ...item, kind: "community" })), nextCursor: 18, exhausted: true });
  await page.reload();
  await page.waitForSelector('#feed [data-id="post-0"]');
  assert.equal(await page.locator("#feed .badge.news").count(), 0);
  assert.equal(await page.locator("#feed .badge.community").count(), 18);
});

test("browser: Live only requests the next page when approaching the list bottom", options, async (t) => {
  const { page, controls, requests } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-0"]');
  controls.feedHandler = url => Number(url.searchParams.get("cursor")) === 0
    ? { items, nextCursor: 18, exhausted: false }
    : { items: [{ ...items[0], id: "next-visible" }], nextCursor: 19, exhausted: true };
  const before = requests.filter(path => path === "/api/feed").length;
  await page.click('#sortBar [data-sort="latest"]');
  await page.waitForSelector('#feed [data-id="post-17"]');
  await page.waitForTimeout(150);
  assert.equal(requests.filter(path => path === "/api/feed").length, before + 1,
    "offscreen speculative pages must not be consumed as seen");
  await page.locator("#sentinel").scrollIntoViewIfNeeded();
  await page.waitForSelector('#feed [data-id="next-visible"]');
  assert.equal(requests.filter(path => path === "/api/feed").length, before + 2);
});

test("browser: immersion loads more only near the nested feed bottom", options, async (t) => {
  const { page, controls, requests } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-17"]');
  controls.feedHandler = url => {
    const cursor = Number(url.searchParams.get("cursor"));
    return { items: items.map(item => ({ ...item, id: `${cursor}-${item.id}` })),
      nextCursor: cursor + 18, exhausted: cursor >= 36 };
  };
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.locator("#immBtn").click();
  await page.getByRole("button", { name: "메뉴 닫기" }).click();
  const before = requests.filter(path => path === "/api/feed").length;
  await page.click('#sortBar [data-sort="latest"]');
  await page.waitForSelector('#feed [data-id="0-post-17"]');
  await page.waitForTimeout(300);
  assert.equal(requests.filter(path => path === "/api/feed").length, before + 1,
    "entering immersion must not consume offscreen pages");
  await page.locator('#feed [data-id="0-post-17"]').scrollIntoViewIfNeeded();
  await page.waitForSelector('#feed [data-id="18-post-0"]');
  await page.waitForTimeout(200);
  assert.equal(requests.filter(path => path === "/api/feed").length, before + 2);
});

for (const delayed of ["loadMore", "pagination"]) {
  test(`browser: Live mix ignores delayed ${delayed} news after community-only selection`, options, async (t) => {
    const { page, controls } = await fixture(t);
    await page.waitForSelector('#feed [data-id="post-0"]');
    const community = items.map(item => ({ ...item, id: `community-${item.id}`, kind: "community" }));
    const staleNews = { ...items[0], id: "stale-news" };
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const pending = new Promise(resolve => { started = resolve; });
    t.after(() => release());
    controls.feedHandler = async url => {
      const cursor = Number(url.searchParams.get("cursor"));
      if (controls.mixBalance === -1) return cursor === 0
        ? { items: community, nextCursor: 18, exhausted: delayed === "loadMore" }
        : { items: [{ ...community[0], id: "community-next" }], nextCursor: 19, exhausted: true };
      if (delayed === "pagination" && cursor === 0) return { items, nextCursor: 18, exhausted: false };
      started();
      await held;
      return { items: [staleNews], nextCursor: 19, exhausted: true };
    };
    await page.click('#sortBar [data-sort="latest"]');
    if (delayed === "pagination") {
      await page.waitForSelector('#feed [data-id="post-17"]');
      await page.locator("#sentinel").scrollIntoViewIfNeeded();
    }
    await pending;
    await page.click("#menuBtn");
    const mixSaved = page.waitForResponse(res => new URL(res.url()).pathname === "/api/mix");
    await page.locator("#mixSlider").press("Home");
    await mixSaved;
    assert.equal(controls.mixBalance, -1);
    await page.waitForSelector('#feed [data-id="community-post-0"]');
    assert.equal(await page.locator("#feed .badge.news").count(), 0);
    await page.waitForSelector("#netbar");
    const staleResponse = page.waitForResponse(res => new URL(res.url()).pathname === "/api/feed");
    release();
    await (await staleResponse).finished();
    await page.waitForSelector("#netbar", { state: "detached" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (delayed === "pagination") {
      await page.click("#drawerClose");
      await page.locator("#sentinel").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelectorAll("#feed .card").length === 19);
    }
    assert.equal(await page.locator('#feed [data-id="stale-news"]').count(), 0, "a superseded feed response must not enter the new list");
    assert.equal(await page.locator("#feed .badge.news").count(), 0);
    assert.equal(await page.locator("#feed .badge.community").count(), delayed === "pagination" ? 19 : 18);
  });
}

test("browser: Live mix reload discards a mixed snapshot when the saved setting becomes community-only", options, async (t) => {
  const { page, controls, requests } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-0"]');
  assert.equal(await page.locator("#feed .badge.news").count(), 18);
  const feedCalls = requests.filter(path => path === "/api/feed").length;
  controls.mixBalance = -1;
  controls.feedHandler = () => ({
    items: items.map(item => ({ ...item, id: `community-${item.id}`, kind: "community" })),
    nextCursor: 18, exhausted: true
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById("mixMid").textContent === "커뮤만");
  await page.waitForSelector("#feed .card");
  assert.equal(await page.locator("#feed .badge.news").count(), 0, "the current saved mix must invalidate an old mixed snapshot");
  assert.equal(await page.locator("#feed .badge.community").count(), 18);
  assert.equal(requests.filter(path => path === "/api/feed").length, feedCalls + 1);
});

test("browser: same-tab original returns to detail then exact Live list/filter/sort/scroll", options, async (t) => {
  const { page } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-5"]');
  await page.click('#sortBar [data-sort="latest"]');
  await page.click("#menuBtn");
  await page.locator("#chips button").filter({ hasText: "경제" }).click();
  await page.locator('#feed [data-id="post-5"]').scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await page.locator('#feed [data-id="post-5"] h3').click();
  await page.waitForSelector("#detail.open");
  await page.locator('#detailBody a.readmore[href^="https://publisher.test/"]').click();
  await page.waitForURL("https://publisher.test/article-5", { timeout: 2500 });
  await page.goBack();
  await page.waitForSelector("#detail.open");
  assert.match(await page.locator("#detailTitle").innerText(), /Public article 5/);
  await page.click("#backBtn");
  await page.waitForFunction(() => !document.querySelector("#detail.open"));
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 4);
  assert.equal(await page.locator("#sortBar .active").getAttribute("data-sort"), "latest");
  assert.equal(await page.locator("#chips .active").innerText(), "경제");
  await page.goForward();
  await page.waitForSelector("#detail.open");
  await page.click("#detailTitle");
  await page.waitForURL("https://publisher.test/article-5");
  await page.goBack();
  await page.waitForSelector("#detail.open");
});

test("browser: Live list source shortcut returns to the same filter/sort/scroll", options, async (t) => {
  const { page } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-5"]');
  await page.click('#sortBar [data-sort="latest"]');
  await page.click("#menuBtn");
  await page.locator("#chips button").filter({ hasText: "경제" }).click();
  await page.locator('#feed [data-id="post-5"]').scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await page.locator('#feed [data-id="post-5"] .card-out a').click();
  await page.waitForURL("https://publisher.test/article-5", { timeout: 2500 });
  await page.goBack();
  await page.waitForSelector('#feed [data-id="post-5"]');
  await page.waitForFunction((expected) => Math.abs(scrollY - expected) < 4, scroll);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 4);
  assert.equal(await page.locator("#sortBar .active").getAttribute("data-sort"), "latest");
  assert.equal(await page.locator("#chips .active").innerText(), "경제");
  assert.equal(await page.locator("#detail.open").count(), 0);
});

test("browser: Today list reload and refresh fetch the current due edition instead of pinning lunch", options, async (t) => {
  const { page, controls } = await fixture(t, "/");
  await page.waitForSelector("#issues article");
  controls.todayEdition = { ...edition, editionId: "SCE-new-morning", editionDate: "2026-09-04", slot: { id: "morning", label: "모닝" } };
  await page.reload();
  await page.waitForFunction(() => document.getElementById("editionTitle").textContent === "모닝 오늘판");
  assert.equal(controls.todayQueries.length, 2);
  assert.ok(!new URLSearchParams(controls.todayQueries.at(-1)).has("slot"));
  await page.click("#refresh");
  await page.waitForFunction(() => document.getElementById("refresh").getAttribute("aria-busy") === "false");
  assert.ok(!new URLSearchParams(controls.todayQueries.at(-1)).has("date"));
  assert.ok(!new URLSearchParams(controls.todayQueries.at(-1)).has("slot"));
});

test("browser: Today errors clear stale edition chrome and explicit selection survives reload", options, async (t) => {
  const { page, controls } = await fixture(t, "/");
  await page.waitForSelector("#issues article");
  controls.todayStatus = 409;
  await page.click('#slots [data-slot="morning"]');
  await page.waitForSelector("#issues .error");
  assert.equal(await page.locator("#editionTitle").innerText(), "오늘판을 불러오지 못했습니다");
  assert.equal(await page.locator('#slots [data-slot="morning"]').getAttribute("aria-selected"), "true");
  assert.ok(!(await page.locator("#metrics").innerText()).includes("현재판 검증"));
  controls.todayStatus = 200;
  await page.click("#issues .retry");
  await page.waitForSelector("#issues article");
  const calls = controls.todayQueries.length;
  await page.reload();
  await page.waitForSelector("#issues article");
  assert.equal(controls.todayQueries.length, calls);
});

test("browser: Today keeps exact edition and issue through original/Back/Forward/reload without refetch", options, async (t) => {
  const { page, requests } = await fixture(t, "/?date=2026-09-03&slot=lunch");
  await page.waitForSelector('[data-open-issue="5"]');
  await page.locator('[data-open-issue="5"]').scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await page.click('[data-open-issue="5"]');
  assert.match(page.url(), /#issue-/);
  const count = requests.filter((path) => path === "/api/today").length;
  await page.locator('#detailContent a[href="https://publisher.test/article-5"]').click();
  await page.waitForURL("https://publisher.test/article-5", { timeout: 2500 });
  await page.goBack();
  await page.waitForSelector("#issueDetail.open");
  assert.match(await page.locator("#detailTitle").innerText(), /Public article 5/);
  await page.reload();
  await page.waitForSelector("#issueDetail.open");
  await page.click("#detailClose");
  await page.waitForFunction(() => !document.querySelector("#issueDetail.open"));
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 4);
  await page.goForward();
  await page.waitForSelector("#issueDetail.open");
  assert.equal(requests.filter((path) => path === "/api/today").length, count);
});

test("browser: Today list source shortcut returns to the same edition and scroll", options, async (t) => {
  const { page } = await fixture(t, "/?date=2026-09-03&slot=lunch");
  await page.waitForSelector('[data-open-issue="5"]');
  await page.locator('[data-open-issue="5"]').scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await page.locator("article").nth(5).locator(".source-links a").first().click();
  await page.waitForURL("https://publisher.test/article-5", { timeout: 2500 });
  await page.goBack();
  await page.waitForSelector('[data-open-issue="5"]');
  assert.equal(new URL(page.url()).search, "?date=2026-09-03&slot=lunch");
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) < 4);
  assert.equal(await page.locator("#issueDetail.open").count(), 0);
});

test("browser: temporary item failure may use a public card but restricted/missing may not", options, async (t) => {
  const { page, controls } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-0"]');
  controls.itemStatus = 503;
  await page.locator('#feed [data-id="post-0"] h3').click();
  await page.waitForSelector("#detail.open #detailTitle");
  assert.match(await page.locator("#detailBody").innerText(), /Public feed excerpt/);
  await page.click("#backBtn");
  await page.waitForFunction(() => !document.querySelector("#detail.open"));
  controls.itemStatus = 403; controls.itemCode = "TOPIC_FILTERED";
  await page.locator('#feed [data-id="post-0"] h3').click();
  await page.waitForSelector("#detail.open");
  assert.match(await page.locator("#detailBody").innerText(), /제한/);
  assert.equal(await page.getByRole("button", { name: "콘텐츠 설정" }).count(), 1);
  assert.equal(await page.locator('#detailBody a[href^="https://publisher.test/"]').count(), 0);
  await page.click("#backBtn");
  await page.waitForFunction(() => !document.querySelector("#detail.open"));
  controls.itemStatus = 404; controls.itemCode = "ITEM_UNAVAILABLE";
  await page.locator('#feed [data-id="post-0"] h3').click();
  await page.waitForSelector("#detail.open");
  assert.match(await page.locator("#detailBody").innerText(), /찾을 수 없/);
});

test("browser: digest boot is banner-only and exact worker messages change an existing detail", options, async (t) => {
  const { page } = await fixture(t, "/live#post-post-0");
  await page.waitForSelector("#detail.open");
  await page.waitForSelector("#digestBar:not(.hidden)", { state: "attached" });
  assert.equal(await page.evaluate(() => window.__localNotifications), 0);
  await page.evaluate(() => window.__workerMessage({ data: { type: "NOWHOT_NAVIGATE", url: "https://nowhot.test/live#post-post-1" } }));
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 1");
  await page.evaluate(() => window.__workerMessage({ data: { type: "NOWHOT_NAVIGATE", url: "javascript:alert(1)" } }));
  assert.equal(page.url(), origin + "/live#post-post-1");
  await page.goBack();
  await page.waitForFunction(() => !location.hash && !document.querySelector("#detail.open"));
  await page.goForward();
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 1");
  await page.evaluate(() => { location.hash = "#post-post-2"; });
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 2");
  await page.goBack();
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 1");
});

test("browser: Back during a slow item request never reopens the closed detail", options, async (t) => {
  const { page, controls } = await fixture(t);
  await page.waitForSelector('#feed [data-id="post-0"]');
  controls.delayItem = 400;
  const response = page.waitForResponse((res) => res.url().includes("/api/item"));
  await page.locator('#feed [data-id="post-0"] h3').click();
  await page.goBack();
  await response;
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#detail.open").count(), 0);
  assert.equal(new URL(page.url()).hash, "");
});

test("browser: real service-worker notification replaces a detail; Back returns to the list", options, async (t) => {
  for (const mode of [true, "legacy"]) {
  const { page, context, base } = await fixture(t, "/live#post-post-0", mode);
  await page.waitForSelector("#detail.open #detailTitle");
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(url => new Promise((resolve, reject) => {
    const event = new Event("notificationclick");
    Object.assign(event, { notification: { close() {}, data: { url } },
      waitUntil: promise => promise.then(resolve, error => error.name === "InvalidAccessError" ? resolve() : reject(error)) });
    self.dispatchEvent(event);
  }), base + "/live#post-post-1");
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 1");
  if (mode === "legacy") assert.ok(new URL(page.url()).searchParams.get("nh-notification"));
  await page.goBack();
  await page.waitForFunction(() => !location.hash && !document.querySelector("#detail.open"));
  await page.goForward();
  await page.waitForFunction(() => document.getElementById("detailTitle")?.textContent === "Public article 1");
  }
});

test("browser: a new visitor gets one shared Today/Live tutorial and Back keeps the Today list", options, async (t) => {
  const { page } = await fixture(t, "/?date=2026-09-03&slot=lunch", false, "new");
  await page.waitForSelector('#nhGuide[data-kind="tutorial"]');
  assert.match(await page.locator("#nhGuide").innerText(), /오늘판/);
  assert.match(await page.locator("#nhGuide").innerText(), /실시간/);
  assert.ok(await page.locator("article").count());
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById("nhGuide"));
  assert.equal(new URL(page.url()).pathname, "/");
  assert.ok(await page.locator("article").count());
  assert.deepEqual(await page.evaluate(() => ({
    onboarded: localStorage.getItem("feed_onboarded_v1"),
    release: localStorage.getItem("feed_seen_release")
  })), { onboarded: "1", release: "2026-09-04-major" });
  await page.reload();
  await page.waitForSelector("article");
  assert.equal(await page.locator("#nhGuide").count(), 0);
});

test("browser: cached old guide and history cannot replace current versioned scripts", options, async (t) => {
  const { page, base } = await fixture(t, "/live", true);
  await page.waitForSelector("#feed .card");
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    const cache=await caches.open("nh-test-old-guide");
    await cache.put("/notice-guide.js",new Response("window.__staleGuideLoaded=true",{headers:{"content-type":"text/javascript"}}));
    await cache.put("/navigation-history.js",new Response("window.__staleHistoryLoaded=true;window.NowHotHistory={}",{headers:{"content-type":"text/javascript"}}));
  });
  for (const path of ["/", "/live"]) {
    await page.goto(base+path);
    await page.waitForFunction(()=>Boolean(window.NowHotNoticeGuide));
    assert.equal(await page.evaluate(()=>Boolean(window.__staleGuideLoaded)),false);
    assert.equal(await page.evaluate(()=>Boolean(window.__staleHistoryLoaded)),false);
    assert.equal(await page.evaluate(()=>typeof window.NowHotHistory.create),"function");
  }
});

test("browser: the full release opens at its title on mobile", options, async (t) => {
  const { page } = await fixture(t, "/");
  await page.waitForSelector(".issue");
  await page.setViewportSize({width:393,height:852});
  await page.evaluate(release=>NowHotNoticeGuide.show({release}),latestRelease());
  const bounds=await page.locator(".nh-guide").evaluate(el=>({scroll:el.scrollTop,top:el.getBoundingClientRect().top,title:el.querySelector("h2").getBoundingClientRect().top}));
  assert.equal(bounds.scroll,0);assert.ok(bounds.title>=bounds.top);
  await page.screenshot({path:"/tmp/nh121-new-popup-mobile.png"});
  await page.keyboard.press("Escape");
  await page.waitForFunction(()=>!document.getElementById("nhGuide"));
});

test("browser: a returning visitor sees a release once across Today and Live", options, async (t) => {
  const { page, base } = await fixture(t, "/?date=2026-09-03&slot=lunch", false, "returning");
  await page.waitForSelector('#nhGuide[data-kind="release"]');
  assert.match(await page.locator("#nhGuide").innerText(), /오늘판과 실시간/);
  assert.equal(await page.locator('#nhGuide a[href="/about#updates"]').count(), 1);
  await page.click("[data-nh-guide-close]");
  await page.waitForFunction(() => !document.getElementById("nhGuide"));
  assert.equal(await page.evaluate(() => localStorage.getItem("feed_seen_release")), release.id);
  await page.goto(base + "/live");
  await page.waitForSelector('#feed [data-id="post-0"]');
  assert.equal(await page.locator("#nhGuide").count(), 0);
});

test("browser: detail navigation above the tutorial unwinds detail, tutorial, then the Live list", options, async (t) => {
  const { page } = await fixture(t, "/live", false, "new");
  await page.waitForSelector('#nhGuide[data-kind="tutorial"]');
  await page.waitForSelector('#feed [data-id="post-0"]');
  await page.evaluate(() => window.__workerMessage({ data: { type: "NOWHOT_NAVIGATE", url: "https://nowhot.test/live#post-post-1" } }));
  await page.waitForSelector("#detail.open");
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector("#detail.open"));
  assert.equal(await page.locator("#nhGuide").count(), 1);
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById("nhGuide"));
  assert.equal(new URL(page.url()).hash, "");
  assert.ok(await page.locator('#feed [data-id="post-0"]').count());
});

test("browser: a first deep link skips the guide but the next list visit still gets the tutorial", options, async (t) => {
  const { page, base } = await fixture(t, "/live#post-post-1", false, "new");
  await page.waitForSelector("#detail.open");
  assert.equal(await page.locator("#nhGuide").count(), 0);
  await page.goto(base + "/live");
  await page.waitForSelector('#nhGuide[data-kind="tutorial"]');
  assert.equal(await page.locator('#nhGuide[data-kind="release"]').count(), 0);
});

test("NH127 browser: Today and Live restore granted subscriptions and expose the connection button", options, async t => {
  for (const path of ["/", "/live"]) {
    const {page,requests}=await fixture(t,path);
    await page.waitForFunction(()=>document.getElementById("menuNotifications")?.textContent==="알림 연결됨");
    assert.equal(requests.filter(path=>path==="/api/push/subscribe").length,1);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
    if(path==="/")await page.locator(".service-menu summary").click();
    else await page.locator("#menuBtn").click();
    await page.locator("#menuNotifications").click();
    await page.waitForTimeout(100);
    assert.equal(requests.filter(path=>path==="/api/push/subscribe").length,2);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
  }
});

test("NH128 browser: Today and Live include app installation metadata and readable iPhone push guidance", options, async t => {
  for (const path of ["/", "/live"]) {
    const {page,requests}=await fixture(t,path,false,"seen",false,true);
    await page.setViewportSize({width:393,height:568});
    await page.waitForFunction(()=>document.getElementById("notificationHelp")?.textContent.includes("홈 화면"));
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute("href"),"/manifest.webmanifest");
    assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute("content"),"yes");
    assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"),"/apple-touch-icon.png");
    if(path==="/")await page.locator(".service-menu summary").click();
    else await page.locator("#menuBtn").click();
    await page.locator("#menuNotifications").click();
    assert.equal(await page.locator("#notificationHelp").isVisible(),true);
    assert.match(await page.locator("#notificationHelp").innerText(),/Safari에서 공유 → 홈 화면에 추가/);
    assert.equal(await page.locator("#menuNotifications").innerText(),"알림 받기");
    assert.equal(requests.filter(path=>path==="/api/push/subscribe").length,0);
    assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
    if(path==="/")for(const viewport of [{width:393,height:568},{width:844,height:390}]){
      await page.setViewportSize(viewport);
      const last=page.locator('.service-menu a[href="/privacy"]');
      await last.scrollIntoViewIfNeeded();
      const rect=await last.boundingBox();
      assert.ok(rect.y>=0&&rect.y+rect.height<=viewport.height,"last menu link stays reachable");
    }
  }
});

test("NH127 browser: each delivered push shows a PNG OS notification with its own tag", options, async t => {
  const {page,context,base}=await fixture(t,"/live",true);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  const notifications=await context.serviceWorkers()[0].evaluate(async base=>{
    const shown=[];
    self.registration.showNotification=async(title,options)=>{shown.push({title,...options})};
    for(const payload of [
      {title:"모닝",url:"/?date=2026-09-03&slot=morning",tag:"today:2026-09-03:morning"},
      {title:"런치",url:"/?date=2026-09-03&slot=lunch",tag:"today:2026-09-03:lunch"},
      {title:"급상승",url:"https://outside.test/untrusted",tag:"live:post-0"}
    ])await new Promise((resolve,reject)=>{
      const event=new Event("push");
      Object.assign(event,{data:{json:()=>payload},waitUntil:promise=>promise.then(resolve,reject)});
      self.dispatchEvent(event);
    });
    return shown;
  },base);
  assert.equal(notifications.length,3);
  assert.equal(new Set(notifications.map(row=>row.tag)).size,3);
  for(const row of notifications){assert.equal(row.icon,"/icon-192.png");assert.equal(row.badge,"/icon-192.png")}
  assert.equal(notifications[0].data.url,base+"/?date=2026-09-03&slot=morning");
  assert.equal(notifications[2].data.url,base+"/live");
});

test("NH127 browser back input: actual cold Live helper keeps the list without scripted activation", options, async t => {
  const {page,context,base}=await fixture(t,"/live#post-post-0",false,"seen",true);
  const cdp=await context.newCDPSession(page);
  for(let i=0;i<100;i++){
    const ready=await cdp.send("Runtime.evaluate",{expression:"Boolean(document.querySelector('#detail.open #detailTitle')?.textContent)",returnByValue:true});
    if(ready.result.value)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const probe=await cdp.send("Runtime.evaluate",{expression:"JSON.stringify({active:navigator.userActivation.hasBeenActive,view:history.state.view})",returnByValue:true});
  assert.deepEqual(JSON.parse(probe.result.value),{active:false,view:"detail"});
  const history=await cdp.send("Page.getNavigationHistory");
  assert.equal(history.entries[history.currentIndex-1].url,base+"/live");
  await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"back",x:20,y:20,clickCount:1});
  await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"back",x:20,y:20,clickCount:1});
  await page.waitForFunction(()=>!location.hash&&!document.querySelector("#detail.open"));
  assert.equal(page.url(),base+"/live");
});

test("NH127 browser: a sparse Today category shows actual coverage while its stories remain readable", options, async t=>{
  const {page,controls}=await fixture(t,"/");
  await page.waitForSelector(".issue");
  controls.todayEdition={...edition,partial:true,issues:edition.issues.slice(0,7),categoryFulfillment:{selectedCount:1,metCount:0,goalSatisfied:false,rows:[{categoryId:"business",label:"경제",issueCount:7,target:14,state:"underfilled"}]}};
  await page.locator("#refresh").click();
  await page.waitForFunction(()=>document.querySelectorAll(".issue").length===7);
  assert.match(await page.locator("#categoryStatus").innerText(),/0\/1.*보강 중/);
  assert.match(await page.locator("#selection").innerText(),/7\/14 보강 중/);
  await page.locator('[data-open-issue="0"]').click();
  await page.waitForSelector("#issueDetail.open");
});

test("NH129 browser: copy and push status messages remain readable in both themes", options, async t => {
  for (const theme of ["light", "dark"]) for (const path of ["/live#post-post-1", "/"]) {
    const {page}=await fixture(t,path);
    await page.setViewportSize({width:393,height:852});
    await page.evaluate(theme=>{
      document.documentElement.dataset.theme=theme;
      Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{}},configurable:true});
    },theme);
    const check=async text=>{
      await page.locator("#toast").filter({hasText:text}).waitFor({state:"visible"});
      await page.waitForFunction(()=>{
        const node=document.getElementById("toast");
        return !node.classList.contains("hidden")&&Number(getComputedStyle(node).opacity)>=0.99;
      });
      assert.match(await page.locator("#toast").innerText(),text);
      const colors=await page.locator("#toast").evaluate(node=>{
        const style=getComputedStyle(node);
        const luminance=color=>{
          const channels=color.match(/[\d.]+/g).slice(0,3).map(value=>{
            const v=Number(value)/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
          });
          return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
        };
        const foreground=luminance(style.color),background=luminance(style.backgroundColor);
        return {foreground:style.color,background:style.backgroundColor,contrast:(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05)};
      });
      assert.ok(colors.contrast>=4.5,`${path} ${theme}: ${JSON.stringify(colors)}`);
      assert.equal(await page.locator("#toast").getAttribute("role"),"status");
    };
    if(path.startsWith("/live")){
      await page.waitForSelector("#detail.open #detailTitle");
      await page.locator("#shareBtn").click();
      await check(/링크가 클립보드에 복사/);
      await page.locator("#backBtn").click();
      await page.locator("#menuBtn").click();
      await page.locator("#menuNotifications").click();
      await check(/오늘판과 주요 소식 알림을 켰어요/);
      await page.evaluate(()=>{
        Object.defineProperty(navigator,"userAgent",{value:"iPhone",configurable:true});
        Object.defineProperty(navigator,"standalone",{value:false,configurable:true});
        delete window.PushManager;
      });
      await page.locator("#menuNotifications").click();
      await check(/홈 화면의 지금핫 아이콘/);
      const bounds=await page.locator("#toast").boundingBox();
      assert.ok(bounds.x>=16&&bounds.x+bounds.width<=377,"long guidance stays within the phone viewport");
    }else{
      await page.locator('[data-category="business"][aria-pressed="true"]').click();
      await check(/관심 분야를 하나 이상/);
    }
  }
});
