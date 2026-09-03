import assert from "node:assert/strict";
import test from "node:test";
import { makeFetcher, parseRss } from "../src/feed/fetchers.js";
import { buildSources, loadRegistry } from "../src/feed/registry.js";

const xml = `<rss><channel>${["FASHION", "BEAUTY", "STAR", "FASHION"].map((section, i) =>
  `<item><title>공개 편집 기사 ${i}</title><cate_depth1>${section}</cate_depth1><link>https://www.elle.co.kr/article/${i}</link><description>&lt;![CDATA[발행자가 제공한 짧은 소개문입니다.]]&gt;</description><enclosure url="https://www.elle.co.kr/image-${i}.jpg" type="image/jpeg"/></item>`).join("")}</channel></rss>`;

test("국내 패션 피드는 발행자가 FASHION으로 분류한 기사만 기존 수집 경로로 제공한다", async () => {
  const source = loadRegistry().find((row) => row.id === "elle-korea-fashion");
  assert.ok(source?.enabled);
  assert.equal(source.country, "KR");
  assert.equal(source.categoryRouting, "declared_section");
  const fetcher = (entry) => makeFetcher(entry, async (url) => {
    assert.equal(url, "https://www.elle.co.kr/rss");
    return new Response(xml);
  })();
  const sources = buildSources([source], { seed: false, fetcher });
  const rows = await sources[0].fetch();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.title), ["공개 편집 기사 0", "공개 편집 기사 3"]);
  assert.ok(rows.every((row) => row.summary === "발행자가 제공한 짧은 소개문입니다." && row.image));
  assert.equal(parseRss(xml).length, 4, "기존 피드는 새 필터의 영향을 받지 않는다");
  assert.throws(() => parseRss(xml, "https://example.com/rss", { tag: ".*", equals: "FASHION" }), /filter tag/i);
});
