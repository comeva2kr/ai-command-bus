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
const release = {
  id: "2026-09-04-major",
  title: "오늘판과 실시간을 새롭게 정리했어요",
  items: ["오늘판은 미리 준비된 브리핑을 바로 보여줘요."]
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

async function fixture(t, path = "/live", realWorker = false, guideState = "seen") {
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
  const controls = { itemStatus: 200, itemCode: "", delayItem: 0, todayStatus: 200, todayEdition: edition, todayQueries: [] };
  await context.addInitScript(({ realWorker, guideState, releaseId }) => {
    if (!localStorage.getItem("__fixture_seeded")) {
      localStorage.clear();
      if (guideState !== "new") localStorage.setItem("feed_uid", "reader");
      if (guideState !== "new") localStorage.setItem("feed_onboarded_v1", "1");
      if (guideState === "seen") localStorage.setItem("feed_seen_release", releaseId);
      if (guideState === "returning") localStorage.setItem("feed_seen_release", "older-release");
      localStorage.setItem("__fixture_seeded", "1");
    }
    window.__localNotifications = 0;
    window.__workerMessage = null;
    if (realWorker === "legacy") {
      const listen = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker);
      navigator.serviceWorker.addEventListener = (name, ...args) => { if (name !== "message") listen(name, ...args); };
    }
    if (!realWorker) Object.defineProperty(navigator, "serviceWorker", { value: {
      register: async () => ({}),
      ready: Promise.resolve({ showNotification: () => { window.__localNotifications++; },
        pushManager: { getSubscription: async () => ({ toJSON: () => ({ endpoint: "test" }) }) } }),
      addEventListener: (name, fn) => { if (name === "message") window.__workerMessage = fn; }
    } });
    Object.defineProperty(window, "Notification", { value: { permission: "granted", requestPermission: async () => "granted" } });
  }, { realWorker, guideState, releaseId: release.id });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.hostname === "publisher.test") return route.fulfill({ contentType: "text/html", body: "<h1>Publisher</h1>" });
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      if (url.pathname === "/api/config") body = { categories: [category], topics: [], ads: {}, release };
      if (url.pathname === "/api/session") body = { userId: "reader", surveyed: true, showTopics: [], briefingCategories: ["business"] };
      if (url.pathname === "/api/communities") body = { communities: [{ id: "test", label: "Test", enabled: true, adult: false, liveCount: 18 }] };
      if (url.pathname === "/api/feed") body = { items, nextCursor: 18, exhausted: true };
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
  await page.goto(base + path);
  return { page, requests, controls, context, base };
}

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

test("browser: a returning visitor sees a release once across Today and Live", options, async (t) => {
  const { page, base } = await fixture(t, "/?date=2026-09-03&slot=lunch", false, "returning");
  await page.waitForSelector('#nhGuide[data-kind="release"]');
  assert.match(await page.locator("#nhGuide").innerText(), /오늘판과 실시간/);
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
