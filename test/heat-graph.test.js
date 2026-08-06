// 화제도 그래프 (David 제보 2026-08-06: "되는 것처럼 보이는 게 없어 모조리 로딩중으로만 보여").
//
// 실측(라이브 30건): heatHist는 30건 전부 있는데 heat는 5건뿐이었다.
// 원인은 증가분(미분)만 그렸기 때문이다 — 이미 반응이 쌓인 글은 더 이상 안 오르므로
// 증가분이 전부 0이 되고, 막대 높이가 0이라 빈 줄로 보인다. **정작 그 글이 화제인 글인데도.**
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

async function heatOf(hist) {
  const store = new FeedStore();
  const item = {
    id: "a", title: "화제도 시험용 제목입니다", url: "https://example.com/a",
    source: "clien", sourceLabel: "클리앙", kind: "community", category: "tech",
    publishedAt: new Date().toISOString(), score: 10, commentCount: 5,
    tags: [], topics: [], lang: "ko"
  };
  const engine = new FeedEngine(store, [{ id: "clien", kind: "community", async fetch() { return [item]; } }]);
  await engine.refresh();
  // 시계열을 직접 심는다 — 수집을 여러 번 돌리지 않고 원하는 모양을 만든다.
  for (const row of engine.poolRows()) { row.heatHist = hist; row.item.heatHist = hist; }
  const user = store.createUser();
  const feed = await engine.getFeed(user.id, { limit: 5, markSeen: false });
  return (feed.items || []).find((i) => i.id === "a");
}

test("반응이 멈춘 글도 그래프가 그려진다", async () => {
  // 증가분이 전부 0인 경우 — 예전엔 빈 줄이었다.
  const it = await heatOf([250, 250, 250, 250, 250]);
  assert.ok(Array.isArray(it.heat) && it.heat.length >= 2, `heat가 없다: ${JSON.stringify(it.heat)}`);
  assert.ok(it.heat.every((v) => v > 0), `막대 높이가 0이다: ${JSON.stringify(it.heat)}`);
});

test("두 점만 있어도 그린다 — 4점을 기다리지 않는다", async () => {
  // 예전엔 4눈금 미만이면 heat가 null이고 "계산 중" 점선만 영원히 남았다.
  const it = await heatOf([100, 180]);
  assert.ok(Array.isArray(it.heat) && it.heat.length === 2, `2점을 안 그린다: ${JSON.stringify(it.heat)}`);
  assert.equal(it.heatPending, false, "아직도 계산 중이라고 한다");
});

test("오르는 글은 오르는 모양으로 그려진다", async () => {
  const it = await heatOf([10, 50, 120, 300]);
  assert.ok(it.heat[0] < it.heat[it.heat.length - 1], `모양이 안 나온다: ${JSON.stringify(it.heat)}`);
  assert.equal(it.heat[it.heat.length - 1], 1, "최대값이 1로 정규화되지 않았다");
});

test("한 점뿐이면 계산 중이라고 말한다", async () => {
  const it = await heatOf([42]);
  assert.equal(it.heatPending, true, "한 점인데 계산 중이 아니라고 한다");
});

test("화면도 서버와 같은 기준(2점)을 쓴다", () => {
  // 서버는 2점부터 주는데 화면이 3점을 요구하면 그 사이가 통째로 빈다.
  const html = fs.readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function heatRuleHtml(item){"),
                        html.indexOf("function heatRuleHtml(item){") + 900);
  assert.match(fn, /h\.length < 2/, "화면이 서버와 다른 기준을 쓴다");
});
