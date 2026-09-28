import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeItem } from "../src/feed/content.js";
import { makeEnricher } from "../src/feed/enrich.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const source = { id: "hani-rank", kind: "news" };
const url = "https://www.hani.co.kr/arti/opinion/column/1276487.html";
const raw = { title: "340만원 내고 한국 일하러 왔더니", url,
  publishedAt: "2026-09-11T08:23:21+09:00", image: "https://www.hani.co.kr/photo.jpg", summary: "원문 공개 발췌입니다." };
const original = "2026-09-06T09:14:00.000Z";
const html = `<meta name="h:published_time" content="2026-09-10T16:04:00+09:00">
<meta content="2026-09-06T18:14:00+09:00" name="article:published_time">`;

test("랭킹 갱신 날짜와 제목이 바뀌어도 같은 기사이며 최초 발행 날짜를 쓴다", async () => {
  const first = normalizeItem(raw, source);
  const second = normalizeItem({ ...raw, title: raw.title + " 수정", publishedAt: "2026-09-11T08:35:28+09:00" }, source);
  assert.equal(first.publishedAt, null, "랭킹 생성 시각을 발행 시각으로 쓰면 안 된다");
  assert.equal(first.id, second.id);
  const enricher = makeEnricher({ fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
    initialCache: { [url]: { image: raw.image, desc: raw.summary, expiresAt: Date.now() + 3600000 } } });
  await enricher.enrich([first]);
  assert.equal(first.publishedAt, original);
  assert.equal(first.publishedAtSource, "publisher");
  await enricher.enrich([second]);
  assert.equal(second.publishedAt, original, "날짜도 메타 캐시에서 재사용해야 한다");
  assert.equal(normalizeItem(raw, { id: "other-rss", kind: "news" }).publishedAt, raw.publishedAt);
});

test("원문 날짜 확인 실패를 신규 기사로 내보내지 않으며 다음 수집에 확인 값을 보존한다", async () => {
  let available = false;
  const engine = new FeedEngine(new FeedStore(), [{ ...source, fetch: async () => [normalizeItem(raw, source)] }]);
  engine._enricher = makeEnricher({ negativeTtlMs: 0, fetchImpl: async () => new Response(available ? html : '<meta property="og:image" content="https://www.hani.co.kr/photo.jpg">', { headers: { "content-type": "text/html" } }) });
  await engine.refresh();
  assert.equal(engine._cache.length, 0, "확인 실패를 firstSeen 최신 기사로 바꾸면 안 된다");
  available = true;
  await engine.refresh();
  assert.equal(engine._cache[0]?.publishedAt, original);
  engine._enricher = null;
  await engine.refresh();
  assert.equal(engine._cache[0]?.publishedAt, original, "메타 요청이 없어도 다음 수집에서 보존한다");
});

test("재시작은 잘못된 랭킹 날짜를 목록에 복구하지 않으며 이전 링크를 보존한다", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nh164-time-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "store.json");
  const bad = { ...raw, id: "legacy-id", source: source.id, kind: "news" };
  fs.writeFileSync(path.join(dir, "store-pool.json"), JSON.stringify({ savedAt: Date.now(), rows: [
    { item: bad, firstSeenAt: Date.now(), lastSeenAt: Date.now() },
    { item: { ...bad, id: "other", source: "other-rss" }, firstSeenAt: Date.now(), lastSeenAt: Date.now() }
  ] }));
  const engine = new FeedEngine(new FeedStore({ file }), []);
  engine._loadPool();
  assert.equal(engine._cache.some(it => it.id === "legacy-id"), false);
  assert.equal(engine._cache.some(it => it.id === "other"), true);
  const old = await engine.getItem("qa", "legacy-id", { explicitOpen: true });
  assert.ok(old, "기존 공유 링크는 살아 있어야 한다");
  assert.equal(old.publishedAt, null, "기존 링크에도 잘못된 날짜를 표시하지 않는다");
  const verified = normalizeItem({ ...raw, publishedAt: original, publishedAtSource: "publisher" }, source);
  engine.rememberPublishedItem(verified);
  const restarted = new FeedEngine(new FeedStore({ file }), []);
  const saved = await restarted.getItem("qa", verified.id, { explicitOpen: true });
  assert.equal(saved?.publishedAt, original, "확인한 날짜의 근거도 공유 보관함에 영속해야 한다");
});
