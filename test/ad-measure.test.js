// 발행 페이지 광고 계측 (2026-08-06).
//
// 블루프린트 대목적의 첫 문장: "알고리즘보다 측정과 구매 의도가 먼저다."
// 그런데 발행 페이지(브리핑·랭킹·커뮤니티·키워드·트렌드·리포트)에 배너가
// 페이지마다 두 장씩 나가는데 **노출·클릭을 한 줄도 세지 않고 있었다.**
// 쿠팡 콘솔에는 subId로 남지만, 그 subId가 어느 화면의 몇 번째 칸인지는
// 우리만 안다 — 우리가 안 세면 아무도 모른다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FeedStore } from "../src/feed/store.js";

const listen = async () => {
  const { createServer } = await import("../src/feed/server.js");
  const srv = createServer({});
  await new Promise((r) => srv.listen(0, r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
};
const post = (base, body) => fetch(`${base}/api/ad-signal`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});

test("세션 없는 방문자의 노출도 센다", async () => {
  // 발행 페이지 방문자 대부분이 검색으로 오는 익명이다. userId를 요구하면
  // 그 노출이 통째로 안 잡히고, 실제로 안 잡히고 있었다.
  const { srv, base } = await listen();
  try {
    const r = await post(base, { type: "impression", slot: "brief_mid", page: "/briefing" });
    assert.equal(r.status, 200, "익명 노출을 거절한다");
  } finally { srv.close(); }
});

test("있는데 모르는 userId는 여전히 거절한다", async () => {
  // 익명을 허용한다고 아무 값이나 받아주면 안 된다.
  const { srv, base } = await listen();
  try {
    const r = await post(base, { userId: "user_nope", type: "click", slot: "x" });
    assert.equal(r.status, 400);
  } finally { srv.close(); }
});

test("자리별로 따로 센다 — 어느 칸이 돈이 되는지 알아야 한다", () => {
  const store = new FeedStore();
  store.recordAdEvent(null, null, "impression", { slot: "brief_mid" });
  store.recordAdEvent(null, null, "impression", { slot: "brief_mid" });
  store.recordAdEvent(null, null, "click", { slot: "brief_mid" });
  store.recordAdEvent(null, null, "impression", { slot: "report_bot" });
  const rep = store.adSlotReport(7);
  const mid = rep.find((r) => r.slot === "brief_mid");
  assert.deepEqual([mid.impressions, mid.clicks, mid.ctr], [2, 1, 50]);
  assert.ok(rep.find((r) => r.slot === "report_bot"));
});

test("자리별 집계는 최근 이벤트 목록과 별개로 남는다", () => {
  // adEvents는 2,000건 상한이라 그것만으로는 "지난주 어느 자리가 나았나"를
  // 못 본다. 세는 값은 따로 쌓아야 오래 간다.
  const store = new FeedStore();
  for (let i = 0; i < 2100; i++) store.recordAdEvent(null, null, "impression", { slot: "brief_mid" });
  assert.equal(store.adEvents.length, 2000, "이벤트 상한이 바뀌었다");
  assert.equal(store.adSlotReport(7)[0].impressions, 2100, "집계가 상한에 잘렸다");
});

test("광고 노출 기록이 요청을 막지 않는다", () => {
  // 노출은 스크롤마다 들어온다. 요청마다 스토어 전체를 동기로 쓰면
  // 그 자체가 서비스를 느리게 만든다(홈 TTFB 4초 사고와 같은 종류).
  const src = readFileSync("src/feed/store.js", "utf8");
  const fn = src.slice(src.indexOf("  recordAdEvent("), src.indexOf("  adSlotReport("));
  assert.match(fn, /this\._persistSoon\(\);/, "즉시 저장으로 돌아갔다");
  assert.ok(!/this\._persist\(\);/.test(fn));
});

test("발행 페이지가 자리 이름을 화면에 실어 보낸다", () => {
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /aside class="ad-slot ad-coupang" data-slot=/, "자리 이름이 화면에 없다");
  // 세는 곳이 둘로 갈리면 언젠가 숫자가 어긋난다 — 앱과 같은 API를 쓴다.
  const script = src.slice(src.indexOf("const adTrackScript"), src.indexOf("const editionShell"));
  assert.match(script, /\/api\/ad-signal/, "다른 경로로 센다");
  assert.match(script, /IntersectionObserver/, "실제로 보였을 때가 아니라 렌더 시점에 센다");
  assert.match(script, /if\(seen\[slot\]\) return/, "같은 자리를 여러 번 센다");
});
