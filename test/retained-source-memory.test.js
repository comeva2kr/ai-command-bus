import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const mode of ["pool", "url-cache"]) {
  test(`short retained ${mode} values release the large source document`, () => {
    const child = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=192", "--input-type=module", "-", mode], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 20_000,
      input: `
        import { parseRss } from './src/feed/fetchers.js';
        import { normalizeItem } from './src/feed/content.js';
        import { canonicalizeUrl } from './src/feed/canonical-url.js';
        const mode = process.argv[2];
        global.gc();
        const before = process.memoryUsage().heapUsed;
        const kept = [];
        for (let n = 0; n < 36; n++) {
            const xml = '<rss><channel><item><title>실제 피드 제목 ' + n + ' 테스트 입니다</title><description>공개된 설명으로 사람들에게 제공하는 요약문입니다</description><link>https://example.com/news/' + n + '</link></item><padding>' + 'x'.repeat(1024 * 1024) + '</padding></channel></rss>';
            const raw = parseRss(xml, 'https://example.com/feed')[0];
            kept.push(mode === 'url-cache' ? canonicalizeUrl(raw.url) : normalizeItem({ ...raw, via: 'rss', source: 'khan' }, { id: 'khan', kind: 'news' }));
        }
        global.gc();
        console.log(JSON.stringify({ retained: process.memoryUsage().heapUsed - before, kept }));
      `
    });
    assert.equal(child.status, 0, child.stderr);
    const { retained, kept } = JSON.parse(child.stdout);
    assert.equal(kept.length, 36);
    if (mode === "pool") {
      assert.equal(kept[35].title, "실제 피드 제목 35 테스트 입니다");
      assert.equal(kept[35].url, "https://example.com/news/35");
    } else assert.equal(kept[35], "https://example.com/news/35");
    assert.ok(retained < 8 * 1024 * 1024, `${mode} retained ${retained} bytes for short public values`);
  });
}
