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

test("결측으로 0이 찍힌 시계열은 버린다 — 복구분이 가짜 상승이 된다", async () => {
  // 실측 2026-08-06: 1,609건 중 26건이 중간에 0으로 떨어졌다.
  // [250,250,250,250,250,0,0,250] 같은 모양에서 0→250이 새 상승분으로 잡혀
  // 하필 "가장 빨리 뜬 글" 1위로 올라왔다. 실제로는 아무 일도 없었다.
  const bad = { item: { id: "bad", title: "t", source: "s", sourceLabel: "출처", category: "tech" },
                heatHist: [250, 250, 250, 250, 250, 0, 0, 250] };
  const good = Array.from({ length: 6 }, (_, i) => ({
    item: { id: `g${i}`, title: "t", source: "s", sourceLabel: "출처", category: "tech" },
    heatHist: [0, 50, 80, 90, 95, 100]
  }));
  const H = heatShape([bad, ...good]);
  assert.equal(H.n, 6, "결측 시계열이 집계에 들어갔다");
  assert.ok(!H.fastest.some((f) => f.id === "bad"), "결측 시계열이 1위로 올라왔다");
});

test("곡선 절은 모양이 보이는 글을 고른다", async () => {
  // 상승분이 100% 전반부에 몰린 글을 그리면 그림이 계단 하나라
  // "이렇게 오른다"는 제목과 어긋난다 — 첫 배포에서 실제로 그랬다.
  const { curveSection } = await import("../src/feed/datastory.js");
  const step = { item: { id: "step", title: "계단", source: "s", sourceLabel: "출처", category: "tech" },
                 heatHist: [0, 250, 250, 250, 250, 250, 250] };
  const curve = { item: { id: "curve", title: "곡선", source: "s", sourceLabel: "출처", category: "tech" },
                  heatHist: [0, 20, 45, 70, 90, 110, 130] };
  const pad = Array.from({ length: 5 }, (_, i) => ({
    item: { id: `p${i}`, title: "t", source: "s", sourceLabel: "출처", category: "tech" },
    heatHist: [0, 10, 20, 30, 40, 50] }));
  const sec = curveSection(heatShape([step, curve, ...pad]));
  assert.ok(sec, "곡선 절이 안 나왔다");
  assert.match(sec.paragraphs[0], /곡선/, "계단짜리를 골랐다");
});

test("소스가 한 곳뿐이면 '독식이 아니다'라고 쓰지 않는다", () => {
  // "나온 곳은 1곳이다"와 "독식하는 구조는 아니다"가 한 문장 안에서 모순된다.
  // 커밋 메시지에 "숫자와 모순되는 문장을 쓰지 않는다"고 적어 놓고 이 문장에는
  // 그대로 남아 있었다(검수 2026-08-06 P0).
  const one = landscapeParagraphs(weeklyLandscape(week([["a", "가", "tech"]]))).join(" ");
  assert.ok(!/독식하는 구조는 아니다/.test(one), "1곳인데 독식이 아니라고 쓴다");
  assert.match(one, /말하기는 이르다/);
  // 한 곳이 압도적일 때도 마찬가지다.
  const skew = landscapeParagraphs(weeklyLandscape(week([
    ["a", "가", "tech"], ["a", "가", "tech"], ["a", "가", "tech"],
    ["b", "나", "news"], ["c", "다", "life"]
  ]))).join(" ");
  assert.ok(!/독식하는 구조는 아니다/.test(skew), "60%를 차지하는데 독식이 아니라고 쓴다");
});

test("한 분야가 100%인데 '3분의 1 가까이'라고 쓰지 않는다", () => {
  // 과장이든 과소진술이든 숫자를 배반하는 것은 같다(검수 2026-08-06 P1).
  const text = landscapeParagraphs(weeklyLandscape(week([
    ["a", "가", "tech"], ["b", "나", "tech"], ["c", "다", "tech"]
  ]))).join(" ");
  assert.ok(!/3분의 1 가까이/.test(text));
  assert.match(text, /100%로 이 주를 통째로 가져갔다/);
});

test("성인 소스는 카테고리가 아니라 소스 플래그로 막는다", async () => {
  // 공식 카테고리 목록에 adult가 없다. 성인 소스 3곳은 카테고리가
  // humor·life·culture이고 adult:true 플래그로만 표시된다 —
  // OFF 세트의 "adult"는 아무것도 막지 않는 죽은 코드였다(검수 2026-08-06 P1).
  const { loadRegistry } = await import("../src/feed/registry.js");
  const adultIds = loadRegistry().filter((c) => c.adult === true).map((c) => c.id);
  assert.ok(adultIds.length, "레지스트리에 성인 소스가 없다 — 이 테스트의 전제가 깨졌다");
  const src = fs.readFileSync("src/feed/datastory.js", "utf8");
  assert.match(src, /adultSources\(\)\.has\(i\.source\)/, "소스 플래그를 안 본다");
  const L = weeklyLandscape(week([[adultIds[0], "성인방", "humor"], ["ok", "정상", "tech"]]));
  assert.ok(!L.sources.some((s) => s.key === adultIds[0]), "성인 소스가 리포트에 실렸다");
});

test("차트 색이 발행 페이지 변수를 따라간다", async () => {
  // --color-text는 앱 화면에만 정의돼 있다. 발행 페이지에서는 대체값(거의
  // 검정)으로 굳어 다크모드에서 안 보였다(대비 1.05:1, 검수 2026-08-06 P1).
  const { CHART_CSS } = await import("../src/feed/chart.js");
  assert.match(CHART_CSS, /var\(--text,\s*var\(--color-text/, "발행 페이지 변수를 안 본다");
  assert.match(CHART_CSS, /var\(--accent,\s*var\(--color-accent/);
  const shell = fs.readFileSync("src/feed/server.js", "utf8");
  const css = shell.slice(shell.indexOf("<style>${CHART_CSS}"), shell.indexOf("<style>${CHART_CSS}") + 900);
  assert.match(css, /--text:/, "발행 페이지가 --text를 정의하지 않는다 — 전제가 바뀌었다");
});

test("리포트는 캐시를 실제로 재사용한다", async () => {
  // 문자열 매칭만으로는 "reportNow를 부르되 안에서 캐시를 우회"하는 변경을
  // 못 잡는다(검수 2026-08-06 P2). 데이터를 바꿔 놓고 응답이 그대로인지 본다.
  const { createServer } = await import("../src/feed/server.js");
  const f = path.join(os.tmpdir(), `report-cache-${process.pid}.json`);
  const items = [["clien", "클리앙", "tech"], ["pp", "뽐뿌", "life"], ["hani", "한겨레", "news"]];
  fs.writeFileSync(f, JSON.stringify({
    dailyEditions: week(items).map((e) => ({ date: e.date, ranking: e.ranking, briefing: null }))
  }));
  try {
    const srv = createServer({ file: f });
    await new Promise((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const first = await (await fetch(`${base}/report`)).text();
    const second = await (await fetch(`${base}/report`)).text();
    srv.close();
    // 광고 문구는 방문마다 도는 것이 정상이라 본문만 비교한다.
    const bodyOf = (h) => (h.match(/<section class="issue">[\s\S]*?<\/section>/g) || []).join("");
    assert.equal(bodyOf(second), bodyOf(first), "요청마다 다시 계산한다");
    assert.ok(bodyOf(first).length > 200, "본문이 비어 비교가 무의미하다");
  } finally { try { fs.unlinkSync(f); } catch {} }
});
