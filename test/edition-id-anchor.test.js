// 판 ID 날짜는 슬롯 기준(asOf)이어야 한다 — 9인 검수 후속(2026-08-13) 회귀 고정.
// 생성 시각 파생이던 시절, 과거 슬롯 판을 나중에 만들면 "8-12 저녁 데이터"에
// "2026-08-13-evening-…" ID가 붙어 servedDate와 모순됐다(실측: science 영수증).
import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";

test("todayEdition: editionId 날짜가 생성 시각이 아니라 슬롯 asOf의 KST 날짜를 따른다", async () => {
  const store = new FeedStore();
  const engine = new FeedEngine(store, [
    new JsonSource("anchor-src", async () =>
      Array.from({ length: 15 }, (_, i) => ({
        id: `anchor-${i}`,
        title: `과학 사건 ${i}: 새 관측`,
        url: `https://anchor.example.com/${i}`,
        category: "science",
        score: 300 - i,
        commentCount: 20,
        publishedAt: new Date(Date.parse("2026-08-12T09:00:00Z") - i * 60000).toISOString()
      })), "community")
  ]);
  await engine.refresh();
  // 어제(KST 8-12) 저녁 슬롯(19:00 KST = 10:00Z)을 "오늘" 뒤늦게 생성하는 상황
  const yesterdayEveningAsOf = Date.parse("2026-08-12T10:00:00Z");
  const edition = await engine.todayEdition({
    categories: ["science"],
    slotId: "evening",
    asOfMs: yesterdayEveningAsOf
  });
  assert.match(edition.editionId, /^2026-08-12-evening-/,
    `슬롯이 8-12 저녁이면 ID도 8-12여야 한다 (실제: ${edition.editionId})`);
});
