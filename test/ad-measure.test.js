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

test("우리가 그리는 자리 이름만 집계한다", async () => {
  // 인증이 없으니 임의의 slot 문자열 3,000개를 0.8초에 밀어 넣을 수 있었다
  // (적대적 검수 2026-08-06 P1, 재현됨). 그러면 관리자 화면의 자리별 성과가
  // 통째로 거짓이 되고 — 우리는 그 표로 광고 배치를 정한다 —
  // adSlotStats에 키가 무한히 늘어 저장 파일이 부푼다.
  const { srv, base } = await listen();
  try {
    await post(base, { type: "impression", slot: "brief_mid" });
    await post(base, { type: "impression", slot: "a".repeat(40) });
    await post(base, { type: "impression", slot: "'; DROP TABLE" });
    const r = await (await fetch(`${base}/api/admin/ads`, { headers: { "x-admin-token": process.env.ADMIN_TOKEN || "" } })).json().catch(() => null);
    void r;
  } finally { srv.close(); }
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /const KNOWN_AD_SLOT = \/\^\(/, "자리 이름 허용목록이 없다");
  assert.match(src, /KNOWN_AD_SLOT\.test\(raw\) \? raw : "unknown"/, "목록 밖 값을 그대로 집계한다");
  // 지우지 않고 한 칸으로 몰아 둔다 — 이상한 값이 들어온다는 사실은 보여야 한다.
  assert.ok(!/KNOWN_AD_SLOT\.test\(raw\) \? raw : null/.test(src));
});

test("허용목록이 실제로 쓰는 자리를 전부 덮는다", () => {
  // 새 자리를 만들고 목록에 안 더하면 그 성과가 "unknown"으로 뭉친다.
  const src = readFileSync("src/feed/server.js", "utf8");
  const re = /const KNOWN_AD_SLOT = (\/\^\(.*?\)\$\/)/s.exec(src);
  assert.ok(re, "허용목록을 못 찾았다");
  const allow = new RegExp(re[1].slice(1, -1));
  const used = new Set();
  for (const m of src.matchAll(/AD\((?:[^)]*?),\s*"([a-z_]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/`brief_s\$\{[^}]+\}`/g)) used.add("brief_s3");
  const app = readFileSync("src/feed/public/index.html", "utf8");
  if (/`feed\$\{i \+ 1\}`/.test(app)) used.add("feed7");
  if (/"feed-passback"/.test(app)) used.add("feed-passback");
  const missing = [...used].filter((s) => !allow.test(s));
  assert.deepEqual(missing, [], `허용목록에 빠진 자리: ${missing.join(", ")}`);
});

test("분당 상한이 걸린다 — 디스크를 안 건드리는 카운터로", () => {
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /adSignalAllowed\(req\)/, "상한이 없다");
  assert.match(src, /AD_SIGNAL_PER_MIN/);
  // 맵이 무한히 자라면 그 자체가 사고다.
  assert.match(src, /adSignalHits\.size > 5000.*adSignalHits\.clear\(\)/s);
});
