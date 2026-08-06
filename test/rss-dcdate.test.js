import test from "node:test";
import assert from "node:assert/strict";
import { parseRss } from "../src/feed/fetchers.js";

// 2026-08-06 실측. parseRss가 날짜를 <pubDate>(RSS 2.0) / <updated>(Atom)로만
// 읽어서, **Dublin Core의 <dc:date>만 쓰는 피드는 날짜가 통째로 null**이었다:
//   · Slashdot(RDF/RSS 1.0) — pubDate 0건, dc:date 16건 → 16/16 null
//   · 경향신문(khan)        — pubDate 0건, dc:date 50건 → 50/50 null
//
// 경향신문 50건은 전부 2시간 이내의 기사인데, 날짜가 없다는 이유로 신선도
// 중립(0.5)에 고정돼 있었다 — 가장 신선한 축인데 그 대우를 못 받았다.
// 포맷 문제가 아니었다(Date.parse는 두 형식 모두 파싱한다). 태그를 안 본 것이다.
//
// 소스 설명에는 이것이 "소스 스펙 한계"로 적혀 있었다. 같은 날 Slashdot 발췌도
// 똑같이 "한계"로 기록돼 있다가 실은 피드 선택 실수였음이 드러났다.
// **"한계"라고 적힌 것을 한 번은 의심해야 한다.**

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item>
    <title>FDA Approves First mRNA Flu Shot</title>
    <link>https://example.org/a</link>
    <description>The FDA has approved the first mRNA flu vaccine.</description>
    <dc:date>2026-08-06T11:00:00+00:00</dc:date>
  </item>
</rdf:RDF>`;

const RSS2_BOTH = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel><item>
   <title>둘 다 있는 경우</title>
   <link>https://example.org/b</link>
   <pubDate>Wed, 06 Aug 2026 09:00:00 +0900</pubDate>
   <dc:date>2020-01-01T00:00:00+09:00</dc:date>
 </item></channel></rss>`;

const RSS2_DC_ONLY = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel><item>
   <title>경향신문형 — dc:date만</title>
   <link>https://example.org/c</link>
   <dc:date>2026-08-06T13:28:00+09:00</dc:date>
 </item></channel></rss>`;

test("RDF(RSS 1.0)의 dc:date를 날짜로 읽는다 — Slashdot이 이 형식이다", () => {
  const items = parseRss(RDF);
  assert.equal(items.length, 1);
  assert.ok(items[0].publishedAt, "dc:date를 읽지 못하면 신선도가 중립으로 고정된다");
  assert.equal(new Date(items[0].publishedAt).toISOString(), "2026-08-06T11:00:00.000Z");
});

test("dc:date만 있는 RSS 2.0도 읽는다 — 경향신문이 이 형식이다", () => {
  const items = parseRss(RSS2_DC_ONLY);
  assert.equal(items.length, 1);
  assert.ok(items[0].publishedAt);
});

test("pubDate가 있으면 그쪽을 쓴다 — 기존 동작을 바꾸지 않는다", () => {
  // 폴백이 표준 태그를 이기면, 두 값이 다른 피드에서 조용히 날짜가 바뀐다.
  // 여기서는 dc:date가 2020년이라 잘못 고르면 6년 차이로 드러난다.
  const items = parseRss(RSS2_BOTH);
  assert.equal(items.length, 1);
  const y = new Date(items[0].publishedAt).getUTCFullYear();
  assert.equal(y, 2026, `pubDate(2026)를 써야 하는데 dc:date(2020)를 골랐다`);
});

test("날짜 태그가 아예 없으면 예전처럼 null이다 — 없는 날짜를 지어내지 않는다", () => {
  const none = `<rss version="2.0"><channel><item>
    <title>날짜 없음</title><link>https://example.org/d</link>
  </item></channel></rss>`;
  const items = parseRss(none);
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, null);
});
