// 자체 콘텐츠 에디션 (#18): 화제 랭킹 + 일별 스냅샷 + 브리핑/랭킹 라우트.
// David의 지적("납득할만한 화제성만 고르는 게 빡세지 않나 — 리소스가 다양한데")
// 에 대한 4중 장치를 고정한다: 소스 내 이례성 정규화 / 교차보도 가산 /
// 절대 반응 하한 / 소스당 2개 상한. 그리고 랭킹 페이지는 근거 수치를 노출한다.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { JsonSource } from "../src/feed/content.js";

const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

function communitySources() {
  // big: 절대 숫자가 큰 게시판 (전부 고만고만하게 큼 = 이례성 낮음)
  const big = new JsonSource("bigboard", async () =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `big${i}`, title: `큰 게시판 평범글 ${i}`, url: `https://big.example.com/${i}`,
      publishedAt: hoursAgoIso(1 + i), score: 500 + i, commentCount: 50, category: "humor"
    })), "community");
  // quiet: 평소 조용한데 한 건이 터진 게시판 (이례성 극대)
  const quiet = new JsonSource("quietboard", async () => [
    { id: "quiet-viral", title: "조용한 게시판에서 터진 글", url: "https://q.example.com/v",
      publishedAt: hoursAgoIso(2), score: 400, commentCount: 120, category: "tech" },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `q${i}`, title: `조용한 글 ${i}`, url: `https://q.example.com/${i}`,
      publishedAt: hoursAgoIso(3 + i), score: 3, commentCount: 0, category: "tech"
    }))
  ], "community");
  // tiny: 소스 내 1위지만 절대 반응이 미미 — 전국 랭킹에 나오면 안 됨
  const tiny = new JsonSource("tinyboard", async () => [
    { id: "tiny-top", title: "반응 미미한 소스 1위", url: "https://t.example.com/1",
      publishedAt: hoursAgoIso(1), score: 2, commentCount: 1, category: "life" },
    { id: "tiny-2", title: "반응 없는 글", url: "https://t.example.com/2",
      publishedAt: hoursAgoIso(2), score: 0, commentCount: 0, category: "life" }
  ], "community");
  return [big, quiet, tiny];
}

test("rankingTop: 소스당 2개 상한 + 절대 반응 하한 + 조용한 보드의 폭발글 생존", async () => {
  const store = new FeedStore();
  const engine = new FeedEngine(store, communitySources());
  const r = await engine.rankingTop(20);

  const bySrc = new Map();
  for (const i of r.items) bySrc.set(i.source, (bySrc.get(i.source) || 0) + 1);
  for (const [src, n] of bySrc) assert.ok(n <= 2, `${src}가 ${n}개 — 소스당 2개 상한 위반`);

  assert.ok(!r.items.some((i) => i.id === "tiny-top"), "절대 반응 미미한 글은 소스 1위여도 제외");
  assert.ok(r.items.some((i) => i.id === "quiet-viral"), "조용한 보드의 폭발글은 살아있어야");
  // 근거 수치가 항목에 실려 있어야 페이지가 노출할 수 있다
  for (const i of r.items) {
    assert.ok("score" in i && "commentCount" in i && "coverage" in i, "근거 필드 누락");
  }
});

test("rankingTop: 성인·정치 태그 글은 랭킹에서 제외", async () => {
  const src = new JsonSource("mix", async () => [
    { id: "ok1", title: "무난한 화제글", url: "https://m.example.com/1",
      publishedAt: hoursAgoIso(1), score: 300, commentCount: 80, category: "tech" },
    { id: "ad1", title: "성인 콘텐츠", url: "https://m.example.com/2",
      publishedAt: hoursAgoIso(1), score: 900, commentCount: 200, category: "humor", adult: true },
    { id: "pol1", title: "국회 탄핵 표결", url: "https://m.example.com/3",
      publishedAt: hoursAgoIso(1), score: 900, commentCount: 300, category: "news" }
  ], "community");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [src]);
  const r = await engine.rankingTop(20);
  assert.ok(!r.items.some((i) => i.id === "ad1"), "성인 글 제외");
  assert.ok(!r.items.some((i) => i.id === "pol1"), "정치 키워드 글 제외");
});

test("store: 일별 에디션 저장·조회·날짜목록 + 재시작 왕복", async () => {
  const tmp = `${process.env.TMPDIR || "/tmp"}/edition-test-${process.pid}.json`;
  const store = new FeedStore({ file: tmp });
  store.saveDailyEdition("2026-07-30", { briefing: { itemCount: 5, sourceCount: 2, sections: [] }, ranking: { items: [{ id: "a", hot: 0.5, source: "s" }] } });
  store.saveDailyEdition("2026-07-31", { briefing: { itemCount: 9, sourceCount: 3, sections: [] }, ranking: { items: [] } });
  assert.deepEqual(store.listEditionDates(), ["2026-07-30", "2026-07-31"]);
  assert.equal(store.getDailyEdition("2026-07-30").briefing.itemCount, 5);

  const reloaded = new FeedStore({ file: tmp });
  assert.deepEqual(reloaded.listEditionDates(), ["2026-07-30", "2026-07-31"], "재시작 후 아카이브 유지");
  assert.equal(reloaded.getDailyEdition("2026-07-31").briefing.itemCount, 9);
});

test("refresh가 오늘(KST) 에디션 스냅샷을 남긴다", async () => {
  const store = new FeedStore();
  const engine = new FeedEngine(store, communitySources());
  await engine.refresh();
  const dates = store.listEditionDates();
  assert.equal(dates.length, 1, "오늘 날짜 하나");
  const ed = store.getDailyEdition(dates[0]);
  assert.ok(ed.briefing && ed.ranking, "브리핑+랭킹 둘 다 저장");
  assert.ok(ed.ranking.items.length > 0, "랭킹 항목이 실제로 있음");
});

// ---- 서버 라우트 ----------------------------------------------------------

function fetchPath(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

test("서버: /api/briefing, /briefing/<cat>, /ranking/* 라우트가 자체 콘텐츠를 서빙", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ sources: communitySources() });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const api = await fetchPath(port, "/api/briefing");
    assert.equal(api.status, 200);
    assert.ok(JSON.parse(api.body).sections.length >= 1, "브리핑 섹션 존재");

    const daily = await fetchPath(port, "/ranking/daily");
    assert.equal(daily.status, 200);
    assert.ok(daily.body.includes("화제 랭킹"), "랭킹 페이지 렌더");
    assert.ok(/추천 |댓글 /.test(daily.body), "근거 수치 노출");
    assert.ok(daily.body.includes("페퍼클럽"), "운영주체 표기");

    const cat = await fetchPath(port, "/briefing/tech");
    assert.equal(cat.status, 200);
    assert.ok(cat.body.includes("브리핑"), "카테고리 브리핑 렌더");

    const missing = await fetchPath(port, "/briefing/2020-01-01");
    assert.equal(missing.status, 404, "없는 아카이브는 정직하게 404");

    // 주간: 아직 하루치뿐 — 집계 중 표기가 있어야 한다 (날조 금지의 표시면)
    const weekly = await fetchPath(port, "/ranking/weekly");
    assert.equal(weekly.status, 200);
    assert.ok(weekly.body.includes("집계"), "데이터 부족 사실을 밝힌다");
  } finally {
    server.close();
  }
});

test("firstSeenAt 영속화: 재시작(새 엔진)해도 '처음 본 시각'이 리셋되지 않는다 (P1-a)", async () => {
  const tmp = `${process.env.TMPDIR || "/tmp"}/firstseen-test-${process.pid}.json`;
  const src = () => new JsonSource("nodate", async () => [
    // 발행일 없는 글 — firstSeenAt이 유일한 나이 근거인 부류 (뒷북 리셋의 진원지)
    { id: "old1", title: "발행일 없는 아카이브 글", url: "https://n.example.com/1", score: 10, category: "tech" }
  ], "community");
  const store1 = new FeedStore({ file: tmp });
  const engine1 = new FeedEngine(store1, [src()]);
  await engine1.refresh();
  const seen1 = (await engine1._items()).find((i) => i.id === "old1").firstSeenAt;
  assert.ok(Number.isFinite(seen1), "최초 수집 시각 기록");

  // 서버 재시작 시뮬레이션: 같은 DB 파일, 새 스토어+새 엔진
  const store2 = new FeedStore({ file: tmp });
  const engine2 = new FeedEngine(store2, [src()]);
  await engine2.refresh();
  const seen2 = (await engine2._items()).find((i) => i.id === "old1").firstSeenAt;
  assert.equal(seen2, seen1, "재시작 후에도 처음 본 시각이 유지돼야 — 리셋되면 뒷북 글이 신규로 둔갑");
});

test("URL dedup: 쿼리가 정체인 게시판 글은 합쳐지지 않고, 추적 파라미터 차이만 있으면 합쳐진다", async () => {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const src = new JsonSource("qboard", async () => [
    { id: "q1", title: "게시판 글 1", url: "https://q.example.com/zboard.php?id=free&no=1",
      publishedAt: hoursAgo(1), score: 10, category: "humor" },
    { id: "q2", title: "게시판 글 2", url: "https://q.example.com/zboard.php?id=free&no=2",
      publishedAt: hoursAgo(1), score: 10, category: "humor" },
    { id: "d1", title: "같은 기사 A", url: "https://n.example.com/article/1?utm_source=rss",
      publishedAt: hoursAgo(1), score: 5, category: "news" },
    { id: "d2", title: "같은 기사 B", url: "https://n.example.com/article/1",
      publishedAt: hoursAgo(1), score: 90, commentCount: 10, category: "news" }
  ], "community");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [src]);
  const items = await engine._items();
  const ids = new Set(items.map((i) => i.id));
  assert.ok(ids.has("q1") && ids.has("q2"), "쿼리 다른 게시판 글 2건은 둘 다 생존");
  assert.ok(!ids.has("d1") && ids.has("d2"), "utm만 다른 동일 기사는 반응 큰 쪽만 생존");
});
