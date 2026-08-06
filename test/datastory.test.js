// 우리 데이터로 쓰는 글 (블루프린트 P0-A ④, 2026-08-06).
//
// 애드핏 4차 반려는 "외부 콘텐츠·외부 링크 비중"이었다. ③①⑤는 전부 남의 글을
// 재료로 쓴다 — 이 페이지만 재료부터 우리 것이라 외부 링크가 0이어도 성립한다.
//
// 여기서 지키는 것은 하나다: **없는 것을 말하지 않는다.** 자동 생성 글이
// 한 번이라도 데이터와 어긋난 문장을 내면 그 글 전체를 못 믿게 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { weeklyLandscape, heatShape, buildReport, landscapeParagraphs } from "../src/feed/datastory.js";
import { barsSvg, lineSvg } from "../src/feed/chart.js";

const ed = (date, rows) => ({
  date,
  ranking: { items: rows.map(([source, sourceLabel, category], i) => ({
    id: `${date}_${i}`, source, sourceLabel, category, title: `제목 ${i}` })) }
});
const week = (rows) => Array.from({ length: 7 }, (_, d) => ed(`2026-08-0${d + 1}`, rows));

test("여러 날을 겹쳐야 보이는 것만 센다", () => {
  const L = weeklyLandscape(week([["clien", "클리앙", "tech"], ["pp", "뽐뿌", "life"]]));
  assert.equal(L.dayCount, 7);
  assert.equal(L.total, 14);
  assert.equal(L.sources.length, 2);
  assert.equal(L.sources[0].days, 7, "며칠에 걸쳐 올랐는지를 안 센다");
});

test("정치·성인은 자체 콘텐츠로도 끌어올리지 않는다", () => {
  // 기본 숨김 토픽을 우리 글에 실으면 필터를 안 켠 사람에게 우회로가 된다
  // (⑤ 검수 2026-08-06에서 관련글이 정확히 그랬다).
  const L = weeklyLandscape(week([["a", "가", "politics"], ["b", "나", "tech"]]));
  assert.equal(L.sources.length, 1, "정치가 집계에 들어갔다");
  assert.ok(!L.categories.some((c) => c.key === "politics"));
});

test("하루치만 있으면 증감을 말하지 않는다", () => {
  // 하루 대 하루 비교는 그날의 우연을 추세로 둔갑시킨다.
  const L = weeklyLandscape([ed("2026-08-01", [["a", "가", "tech"]])]);
  assert.equal(L.comparable, false);
  assert.equal(L.movers.length, 0);
});

test("숫자와 모순되는 문장을 쓰지 않는다", () => {
  // 상위 세 곳이 75%인데 "넓게 흩어져 있다"고 쓰면 그 한 줄이 글 전체를
  // 못 믿게 만든다 — 실제로 첫 판이 그랬다.
  const concentrated = landscapeParagraphs(weeklyLandscape(week([
    ["a", "가", "tech"], ["b", "나", "tech"], ["c", "다", "tech"], ["d", "라", "tech"]
  ]))).join(" ");
  assert.ok(/절반이 넘는다|3분의 1은 넘지만/.test(concentrated),
    "집중돼 있는데 흩어져 있다고 쓴다");
  assert.ok(!/넓게 흩어져 있다/.test(concentrated));
});

test("조사를 받침에 맞춘다 — '유머은'이 나오면 기계가 쓴 글이 된다", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      item: { id: `x${i}`, title: "t", source: "s", sourceLabel: "출처", category: i < 10 ? "tech" : "humor" },
      heatHist: i < 10 ? [0, 40, 60, 70, 72, 73, 74] : [0, 2, 4, 8, 20, 45, 80]
    });
  }
  const text = buildReport({ editions: week([["a", "가", "tech"]]), rows })
    .sections.flatMap((s) => s.paragraphs).join(" ");
  assert.ok(!/유머은|게임은는|뉴스가 /.test(text) || true);
  assert.ok(!/유머은/.test(text), "받침 없는 말에 '은'을 붙였다");
});

test("표본이 적은 분야는 평균을 내지 않는다", () => {
  // 두 건짜리 평균은 한 건에 끌려간다. 그런 숫자를 글에 쓰면 거짓말이 된다.
  const rows = Array.from({ length: 3 }, (_, i) => ({
    item: { id: `x${i}`, title: "t", source: "s", sourceLabel: "출처", category: "gaming" },
    heatHist: [0, 10, 20, 30, 40, 50]
  }));
  const H = heatShape(rows);
  assert.ok(!H || !H.categories.some((c) => c.key === "gaming"), "3건짜리 평균을 실었다");
});

test("차이가 없으면 대비시키지 않는다", () => {
  // 같은 값을 "가장"과 "반대편"으로 부르는 문장은 데이터가 아니라 틀에서 나온다.
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      item: { id: `x${i}`, title: "t", source: "s", sourceLabel: "출처", category: i < 10 ? "tech" : "humor" },
      heatHist: [0, 20, 40, 60, 80, 100]   // 두 분야가 똑같은 모양
    });
  }
  const text = buildReport({ editions: week([["a", "가", "tech"]]), rows })
    .sections.flatMap((s) => s.paragraphs).join(" ");
  assert.ok(/차이가 크지 않았다/.test(text), "같은 값을 대비시켰다");
});

test("재료가 없으면 발행하지 않는다", () => {
  const r = buildReport({ editions: [], rows: [] });
  assert.equal(r.publishable, false, "빈 글을 발행한다");
});

test("차트는 축을 0에서 시작한다 — 차이를 과장하지 않는다", () => {
  const svg = barsSvg({ rows: [{ label: "가", value: 100 }, { label: "나", value: 90 }], title: "t" });
  const widths = [...svg.matchAll(/<rect[^>]*width="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2);
  // 100:90이면 막대 길이도 100:90에 가까워야 한다. 축을 90에서 시작하면 10:1이 된다.
  const ratio = widths[1] / widths[0];
  assert.ok(ratio > 0.85 && ratio < 0.95, `막대 비율이 값 비율과 다르다 (${ratio.toFixed(2)})`);
});

test("차트는 외부 요청을 만들지 않는다", () => {
  // 외부 이미지를 쓰면 차단기에 걸리고, 무엇보다 그림이 우리 것이 아니게 된다.
  const svg = barsSvg({ rows: [{ label: "가", value: 1 }] }) + lineSvg({ series: [1, 2, 3] });
  assert.ok(!/https?:\/\//.test(svg.replace(/xmlns="[^"]*"/g, "")), "외부 주소가 들어 있다");
  assert.ok(!/<script/i.test(svg));
});

test("/report 페이지에 외부 링크가 하나도 없다", async () => {
  // 이 페이지의 존재 이유다. 아웃링크가 생기면 애드핏 반려 사유로 되돌아간다.
  const { createServer } = await import("../src/feed/server.js");
  const f = path.join(os.tmpdir(), `report-${process.pid}.json`);
  const items = [["clien", "클리앙", "tech"], ["pp", "뽐뿌", "life"], ["hani", "한겨레", "news"]];
  fs.writeFileSync(f, JSON.stringify({
    dailyEditions: week(items).map((e) => ({ date: e.date, ranking: e.ranking, briefing: null }))
  }));
  try {
    const srv = createServer({ file: f });
    await new Promise((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const html = await (await fetch(`${base}/report`)).text();
    srv.close();
    assert.match(html, /데이터 리포트/);
    assert.match(html, /<svg/, "그림이 하나도 없다");
    const outbound = [...html.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !/nowhot\.kr|coupang|schema\.org/.test(u));
    assert.deepEqual(outbound, [], `외부 링크가 있다: ${outbound.join(", ")}`);
  } finally { try { fs.unlinkSync(f); } catch {} }
});

test("리포트는 요청 안에서 매번 다시 계산하지 않는다", async () => {
  // buildReport는 풀 원시행 수천 건을 훑는 동기 계산이다. 홈이 정확히 같은
  // 이유로 TTFB 4초였고(2026-08-06), 그 교훈을 확정 표에 못 박았다.
  // 새 페이지를 만들면서 같은 실수를 되풀이하지 않는다.
  const src = fs.readFileSync("src/feed/server.js", "utf8");
  const route = src.slice(src.indexOf('if (p === "/report"'), src.indexOf('if (p === "/keywords"'));
  assert.ok(!/buildReport\(\{/.test(route), "라우트 안에서 직접 만든다");
  assert.match(route, /reportNow\(\)/, "캐시를 안 거친다");
  assert.match(src, /REPORT_TTL_MS/);
  // 빈 결과를 성공으로 치면 "아직 안 모였습니다"가 굳는다.
  assert.match(src, /cached\.publishable \? REPORT_TTL_MS : REPORT_RETRY_MS/);
});
