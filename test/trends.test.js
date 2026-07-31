// X 트렌드 (trends.js) — 파서와 캐시 계약을 고정한다. 트윗 본문은 어디에도 없다.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTrends, makeTrendsCache } from "../src/feed/trends.js";

// 실측 마크업 형태(2026-08-01, trends24.in/korea — 속성 따옴표 없는 class)
const SAMPLE = `
<li><span class=trend-name><a href="https://twitter.com/search?q=%EC%98%A4%ED%95%98" class=trend-link>오하욘사</a><span class=tweet-count data-count="12345">12K</span></span></li>
<li><span class=trend-name><a href="https://twitter.com/search?q=%ED%95%98%EC%9D%B4" class=trend-link>하이닉스 상한가</a></span></li>
<li><span class=trend-name><a href="https://twitter.com/search?q=%EC%98%A4%ED%95%98" class=trend-link>오하욘사</a></span></li>`;

test("parseTrends: 이름·검색링크·카운트 파싱 + 중복(시간대 반복) 제거", () => {
  const t = parseTrends(SAMPLE);
  assert.equal(t.length, 2, "중복 '오하욘사'는 최초 1회만");
  assert.equal(t[0].name, "오하욘사");
  assert.ok(t[0].searchUrl.startsWith("https://twitter.com/search?q="));
  assert.equal(t[0].count, "12K");
  assert.equal(t[1].count, null, "카운트 없는 항목은 null");
});

test("makeTrendsCache: TTL 캐시 + 실패 시 기존 캐시 유지", async () => {
  let calls = 0;
  let fail = false;
  const fetchImpl = async () => {
    calls++;
    if (fail) throw new Error("down");
    return { ok: true, text: async () => SAMPLE };
  };
  let now = 0;
  const cache = makeTrendsCache({ ttlMs: 1000, fetchImpl, clock: () => now });
  const a = await cache.get();
  assert.equal(a.trends.length, 2);
  assert.equal(calls, 1);
  await cache.get();
  assert.equal(calls, 1, "TTL 내 재호출은 fetch 없음");
  now = 2000; fail = true;
  const b = await cache.get();
  assert.equal(calls, 2, "TTL 지나면 재시도");
  assert.equal(b.trends.length, 2, "실패해도 이전 캐시를 돌려준다 — 빈 화면 방지");
});
