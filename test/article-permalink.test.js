import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArticleArchive } from "../src/feed/article-archive.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";

const article = (id, extra = {}) => ({
  id, title: `Article ${id}`, summary: "The public introduction remains available.",
  url: `https://example.org/${encodeURIComponent(id)}`, image: "https://example.org/photo.jpg",
  source: "publisher", sourceLabel: "Publisher", via: "rss", kind: "news", category: "tech",
  tags: ["technology"], topics: [], score: 100, commentCount: 10,
  publishedAt: "2026-09-03T00:00:00.000Z", ...extra
});

function fixture(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-permalink-"));
  const file = path.join(dir, "feed.json");
  let at = "2026-09-03T01:00:00.000Z";
  const store = new FeedStore({ file, clock: () => at });
  const user = store.createUser("reader");
  const engine = new FeedEngine(store, [{ id: "publisher", async fetch() { return rows; } }]);
  t.after(() => { store.flushPending(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, user, engine, file, advance() { at = "2026-09-07T01:00:00.000Z"; rows.length = 0; } };
}

test("a displayed article survives pool eviction and a cold restart without collecting again", async (t) => {
  const f = fixture(t, [article("kept")]);
  const feed = await f.engine.getFeed(f.user.id, { sort: "latest", limit: 10 });
  assert.equal(feed.items[0].id, "kept");
  f.advance();
  await f.engine.refresh();
  assert.equal(f.engine._pool.has("kept"), false);
  assert.equal((await f.engine.getFeed(f.user.id)).items.length, 0, "archive must not re-enter selection");
  const reopened = new FeedStore({ file: f.file });
  let fetches = 0;
  const cold = new FeedEngine(reopened, [{ id: "publisher", async fetch() { fetches++; throw new Error("offline"); } }]);
  const detail = await cold.getItem(f.user.id, "kept");
  assert.equal(detail?.title, "Article kept");
  assert.equal(detail?.summary, "The public introduction remains available.");
  assert.equal(detail?.image, "https://example.org/photo.jpg");
  assert.equal(fetches, 0, "an existing link must not wait for a fresh collection");
  assert.equal((await cold.shareData("kept"))?.title, "Article kept");
  assert.equal((await cold.resolveItems(f.user.id, ["kept"]))[0]?.id, "kept");
  assert.equal((await cold.signal(f.user.id, "kept", { type: "open" })).ok, true);
  reopened.flushPending();
});

test("a shared article and its original alias survive expiry with no prior reader cache", async (t) => {
  const f = fixture(t, []);
  const item = article("canonical", { canonicalAliases: [{ id: "old-id" }] });
  f.engine._cache = [item];
  assert.equal((await f.engine.shareData("old-id"))?.title, "Article canonical");
  f.engine._cache = [];
  const cold = new FeedEngine(new FeedStore({ file: f.file }), [{ id: "publisher", async fetch() { return []; } }]);
  assert.equal((await cold.getItem(f.user.id, "old-id"))?.title, "Article canonical");
});

test("archived content still respects topic and administrative restrictions", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = [article("restricted", { topics: ["politics"] })];
  f.store.setTopicFilter(f.user.id, "politics", true);
  assert.ok(await f.engine.getItem(f.user.id, "restricted"));
  f.engine._cache = [];
  f.store.setTopicFilter(f.user.id, "politics", false);
  assert.equal(await f.engine.getItem(f.user.id, "restricted"), null);
  f.store.setTopicFilter(f.user.id, "politics", true);
  assert.ok(await f.engine.getItem(f.user.id, "restricted"));
  f.store.setSourceDisabled("publisher", true);
  assert.equal(await f.engine.getItem(f.user.id, "restricted"), null);
  assert.equal(await f.engine.shareData("restricted"), null);
});

test("deleted native posts are not resurrected from an article snapshot", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = [article("native", { source: "me", via: "me", userId: f.user.id })];
  assert.ok(await f.engine.getItem(f.user.id, "native"));
  f.engine._cache = [];
  assert.equal(await f.engine.getItem(f.user.id, "native"), null);
});

test("opened articles and already notified aliases are excluded before digest ranking", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = [article("a"), article("b", { canonicalAliases: [{ id: "old-b" }] })];
  f.store.recordSignal(f.user.id, "a", "open", 0);
  const digest = await f.engine.digest(f.user.id, { minScore: -100, excludeIds: ["old-b"] });
  assert.equal(digest.count, 0);
  assert.deepEqual(digest.top, []);
});

test("old pool links migrate independently of feed freshness and survive the HTTP detail/share routes", async (t) => {
  const f = fixture(t, []);
  fs.writeFileSync(f.engine._poolFile, JSON.stringify({ savedAt: 1, rows: [
    { item: article("old-public"), lastSeenAt: 1 },
    { item: article("old-politics", { topics: ["politics"] }), lastSeenAt: 1 }
  ] }));
  const { createServer } = await import("../src/feed/server.js");
  let fetches = 0;
  let runtimeEngine;
  const server = createServer({ file: f.file, onEngineReady:engine=>{runtimeEngine=engine;}, sources: [{ id: "publisher", async fetch() { fetches++; return []; } }] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const detail = await fetch(`${origin}/api/item?userId=${f.user.id}&itemId=old-public`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).summary, article("old-public").summary);
  const share = await fetch(`${origin}/p?id=old-public`);
  assert.equal(share.status, 200);
  const shareHtml = await share.text();
  assert.match(shareHtml, /Article old-public/);
  const images = [...shareHtml.matchAll(/<meta property="og:image" content="([^"]+)">/g)].map(match=>match[1]);
  assert.deepEqual(images, [article("old-public").image, `${origin}/og.png?v=20260904-brand`]);
  assert.match(shareHtml, /name="robots" content="noindex,follow,max-image-preview:large"/);
  assert.match(shareHtml, /name="twitter:card" content="summary_large_image"/);
  assert.equal(share.headers.get("cache-control"), "no-cache");
  const robots = await (await fetch(`${origin}/robots.txt`)).text();
  assert.doesNotMatch(robots, /Disallow: \/p\?/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/admin/);
  assert.equal(fetches, 0, "the old link does not require collection");
  const restricted = await fetch(`${origin}/api/item?userId=${f.user.id}&itemId=old-politics`);
  assert.equal(restricted.status, 200, "directly selected article opens without changing feed preferences");
  assert.equal((await restricted.json()).id, "old-politics");
  assert.deepEqual(runtimeEngine.store.getUser(f.user.id).showTopics, []);
  assert.equal(await runtimeEngine.getItem(f.user.id,"old-politics"),null,"implicit lists retain topic preference");
  runtimeEngine.store.setSourceDisabled("publisher",true);
  const disabled=await fetch(`${origin}/api/item?userId=${f.user.id}&itemId=old-politics`);
  assert.equal(disabled.status,403);
  assert.equal((await disabled.json()).code,"SOURCE_DISABLED");
  const missing = await fetch(`${origin}/api/item?userId=${f.user.id}&itemId=never-collected`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "ITEM_UNAVAILABLE");
});

test("public snapshots use hashed paths and never retain personal decoration or raw bodies", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = [article("../outside", { userId: "private", rawBody: "private body", saved: true,
    canonicalAliases: [{ id: "alias", userId: "private", summary: "not an alias field" }] })];
  assert.ok(await f.engine.getItem(f.user.id, "../outside"));
  const directory = `${f.file}.articles`;
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 2);
  for (const file of files) {
    assert.match(file, /^[a-f0-9]{64}\.json$/);
    const snapshot = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    assert.equal(snapshot.userId, undefined);
    assert.equal(snapshot.rawBody, undefined);
    assert.equal(snapshot.saved, undefined);
    assert.deepEqual(snapshot.canonicalAliases, [{ id: "alias" }]);
  }
});

test("omitted and stale aliases keep the latest canonical restrictions without rolling it back", async (t) => {
  const f = fixture(t, []);
  const old = article("canonical", { canonicalAliases: [{ id: "old-id" }] });
  f.engine._cache = [old];
  await f.engine.shareData("canonical");
  const aliasFile = f.engine._articleArchive._file("old-id");
  const staleAlias = fs.readFileSync(aliasFile, "utf8");
  f.store.setTopicFilter(f.user.id, "politics", true);
  f.engine._cache = [article("canonical", { title: "Updated political article", topics: ["politics"] })];
  await f.engine.getItem(f.user.id, "canonical");
  f.engine._cache = [];
  f.store.setTopicFilter(f.user.id, "politics", false);
  const blocked = { status: 403, code: "TOPIC_FILTERED" };
  await assert.rejects(f.engine.getItem(f.user.id, "canonical", { explain: true }), blocked);
  await assert.rejects(f.engine.getItem(f.user.id, "old-id", { explain: true }), blocked);
  assert.deepEqual(f.engine._articleArchive.get("canonical").canonicalAliases, [{ id: "old-id" }]);

  // A pre-upgrade alias file can still contain the old public snapshot.
  fs.writeFileSync(aliasFile, staleAlias);
  const reopened = new FeedStore({ file: f.file });
  t.after(() => reopened.flushPending());
  const cold = new FeedEngine(reopened, []);
  await assert.rejects(cold.getItem(f.user.id, "old-id", { explain: true }), blocked);
  reopened.setTopicFilter(f.user.id, "politics", true);
  const detail = await cold.getItem(f.user.id, "old-id");
  assert.equal(detail.id, "canonical");
  assert.equal(detail.title, "Updated political article");
  assert.deepEqual(detail.topics, ["politics"]);
  assert.equal(new ArticleArchive(`${f.file}.articles`).get("canonical").title, "Updated political article");
});

test("a recent archived home anchor cannot re-enter selection after leaving the current pool", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = Array.from({ length: 30 }, (_, n) => article(`home-${n}`, {
    source: `community-${n % 3}`, kind: "community", via: "community",
    category: ["tech", "sports", "entertainment"][n % 3], score: 200 - n * 5
  }));
  const first = await f.engine.getFeed(f.user.id, { limit: 10 });
  assert.ok(first.items.length);
  const id = first.items[0].id;
  assert.ok(f.store.getUser(f.user.id).homeAnchors.ids.includes(id));
  assert.ok(f.engine._articleArchive.get(id));
  f.engine._cache = f.engine._cache.filter((item) => item.id !== id);
  f.engine._pool.delete(id);
  const next = await f.engine.getFeed(f.user.id, { limit: 10 });
  assert.equal(next.items.some((item) => item.id === id), false);
  assert.equal((await f.engine.getItem(f.user.id, id)).id, id, "detail remains available separately");
});

test("published link capture preserves the full current article, not the ranking projection or entire pool", async (t) => {
  const f = fixture(t, []);
  f.engine._cache = [article("published", {
    topics: ["politics"], canonicalAliases: [{ id: "published-alias" }], originalTitle: "Original published title"
  }), article("not-published")];
  assert.equal(typeof f.engine.rememberPublishedItem, "function");
  f.engine.rememberPublishedItem({ id: "published-alias", title: "Projected title", source: "publisher", url: "https://example.org/published" });
  const saved = f.engine._articleArchive.get("published");
  assert.equal(saved.title, "Article published");
  assert.equal(saved.summary, "The public introduction remains available.");
  assert.equal(saved.originalTitle, "Original published title");
  assert.deepEqual(saved.topics, ["politics"]);
  assert.deepEqual(saved.canonicalAliases, [{ id: "published-alias" }]);
  assert.equal(f.engine._articleArchive.get("not-published"), null);
  f.engine._cache = [];
  await assert.rejects(f.engine.getItem(f.user.id, "published-alias", { explain: true }), { status: 403, code: "TOPIC_FILTERED" });
  f.store.setTopicFilter(f.user.id, "politics", true);
  assert.equal((await f.engine.getItem(f.user.id, "published-alias")).title, "Article published");
});

test("an intentionally cleared untranslated summary stays cleared in detail and after restart", async (t) => {
  const f = fixture(t, []);
  const item = article("translated", { translated: true, summaryTranslated: false });
  f.engine._articleArchive.remember({ ...item, summaryTranslated: true });
  f.engine._cache = [item];
  assert.equal((await f.engine.getItem(f.user.id, item.id)).summary, "");
  const snapshot = f.engine._articleArchive.get(item.id);
  assert.equal(snapshot.summary, "", "a prior nonempty excerpt must not undo intentional removal");
  assert.equal(snapshot.summaryTranslated, false);
  const cold = new FeedEngine(new FeedStore({ file: f.file }), []);
  assert.equal((await cold.getItem(f.user.id, item.id)).summary, "");
  assert.equal((await cold.shareData(item.id)).summary, "");
});

test("older aliases follow a reselected canonical winner across cache and restart", async (t) => {
  const f = fixture(t, []);
  f.engine._articleArchive.remember(article("old-winner", { canonicalAliases: [{ id: "older-alias" }] }));
  f.engine._articleArchive.remember(article("new-winner", {
    title: "Reselected political article", topics: ["politics"], canonicalAliases: [{ id: "old-winner" }]
  }));
  const cold = new ArticleArchive(`${f.file}.articles`);
  for (const archive of [f.engine._articleArchive, cold]) {
    for (const id of ["older-alias", "old-winner", "new-winner"]) {
      const saved = archive.get(id);
      assert.equal(saved.id, "new-winner");
      assert.equal(saved.title, "Reselected political article");
      assert.deepEqual(saved.topics, ["politics"]);
    }
  }
  f.engine._cache = [];
  f.engine._articleArchive = cold;
  await assert.rejects(f.engine.getItem(f.user.id, "older-alias", { explain: true }), { status: 403, code: "TOPIC_FILTERED" });
  f.store.setTopicFilter(f.user.id, "politics", true);
  assert.equal((await f.engine.getItem(f.user.id, "older-alias")).id, "new-winner");
  assert.equal(cold.get("new-winner").title, "Reselected political article");
  f.engine._pool.set("old-winner", {
    item: article("old-winner", { canonicalAliases: [{ id: "older-alias" }] }),
    lastSeenAt: Date.parse("2026-09-03T01:00:00.000Z")
  });
  f.engine._cache = [article("new-winner", { title: "Fresh current winner without aliases" })];
  const fresh = await f.engine.getItem(f.user.id, "older-alias");
  assert.equal(fresh.id, "new-winner");
  assert.equal(fresh.title, "Fresh current winner without aliases");
});

test("canonical pointer cycles terminate without returning a stale snapshot", (t) => {
  const archive = new ArticleArchive();
  archive.cache.set("a", article("b", { canonicalAliases: [{ id: "a" }] }));
  archive.cache.set("b", article("a", { canonicalAliases: [{ id: "b" }] }));
  const read = archive._read.bind(archive);
  let reads = 0;
  t.mock.method(archive, "_read", (id) => {
    assert.ok(++reads <= 3, "a two-node cycle must not keep reading");
    return read(id);
  });
  assert.equal(archive.get("a"), null);
});
