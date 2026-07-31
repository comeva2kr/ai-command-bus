// 최신순 필터 (#12) — 시간버킷 × 소스 인터리브의 보증을 고정한다.
//
// 설계 근거 (실측 2026-07-31): 순수 시간순은 두 지점에서 파탄난다 —
//   1. 동일 타임스탬프 벽: 한겨레랭킹은 70건 전부가 피드 생성 시각으로
//      같은 시각이라, 시간순 정렬 시 한 소스가 70연속으로 나온다.
//   2. 무일자: 전체 풀 882건 중 326건은 발행일이 없다.
// 그래서 age = publishedAt ?? firstSeenAt 을 30분 버킷으로 양자화하고,
// 버킷 안에서 소스 라운드로빈 + 소스당 버킷 상한(초과분은 다음 버킷 이월).
import test from "node:test";
import assert from "node:assert/strict";

import { latestInterleave, latestParams } from "../src/feed/ingest.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { JsonSource } from "../src/feed/content.js";

function mk(id, source, ageH) {
  return { item: { id, source, title: id, category: "tech" }, ageH };
}

test("latestInterleave: 최신 버킷이 오래된 버킷보다 먼저 나온다", () => {
  const out = latestInterleave([
    mk("old", "a", 5), mk("new", "b", 0.1), mk("mid", "c", 2)
  ]);
  assert.deepEqual(out.map((i) => i.id), ["new", "mid", "old"]);
});

test("latestInterleave: 동일 타임스탬프 벽(한겨레 70건 사례)이 이월로 해체된다", () => {
  // wall 소스 20건이 전부 age 0 + 다른 소스 3개가 여러 버킷에 흩어져 있음
  const entries = [
    ...Array.from({ length: 20 }, (_, i) => mk(`w${i}`, "wall", 0.05)),
    mk("a1", "srcA", 0.1), mk("a2", "srcA", 0.7), mk("b1", "srcB", 0.8),
    mk("c1", "srcC", 1.2), mk("b2", "srcB", 1.4)
  ];
  const out = latestInterleave(entries);
  assert.equal(out.length, entries.length, "이월은 배치일 뿐 검열이 아니다 — 전량 보존");
  // 연속 같은 소스 최대 길이: 순수 시간순이면 wall이 20연속. 버킷 상한 2 +
  // 이월이면 다른 소스가 계속 끼어들어 연속 벽이 생기지 않아야 한다.
  let maxRun = 1, run = 1;
  for (let i = 1; i < out.length; i++) {
    run = out[i].source === out[i - 1].source ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }
  // 다른 소스 공급이 소진된 꼬리(잔여 이월분 단독 라운드로빈)는 어쩔 수 없이
  // wall만 남는다 — 검증은 "다른 소스가 살아있는 앞부분"에 건다.
  const head = out.slice(0, 10);
  let headMax = 1; run = 1;
  for (let i = 1; i < head.length; i++) {
    run = head[i].source === head[i - 1].source ? run + 1 : 1;
    if (run > headMax) headMax = run;
  }
  assert.ok(headMax <= latestParams().perSourceCap, `앞 10개에서 같은 소스 ${headMax}연속 — 벽이 해체돼야`);
});

test("latestInterleave: 버킷 안에서는 소스가 번갈아 나온다 (버킷당 소스 상한)", () => {
  const entries = [
    mk("a1", "A", 0.1), mk("a2", "A", 0.11), mk("a3", "A", 0.12), mk("a4", "A", 0.13),
    mk("b1", "B", 0.14), mk("b2", "B", 0.15)
  ];
  const out = latestInterleave(entries);
  const firstFour = out.slice(0, 4).map((i) => i.source);
  // 상한 2: A A A A B B 가 아니라 A와 B가 섞여야 한다
  assert.ok(firstFour.includes("B"), `첫 4개에 B가 있어야 — 실제 ${firstFour.join(",")}`);
  assert.equal(out.length, 6);
});

test("latestInterleave: ageH가 없으면(NaN) 최신(0) 취급 — 무일자 글도 참여", () => {
  const out = latestInterleave([
    { item: { id: "nodate", source: "x" }, ageH: NaN },
    mk("dated", "y", 3)
  ]);
  assert.equal(out[0].id, "nodate");
});

test("engine sort=latest: 최신 위주 페이지 + markSeen으로 다음 페이지가 이어진다", async () => {
  const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const mkRaw = (id, h) => ({
    id, title: `글 ${id}`, url: `https://example.com/${id}`,
    publishedAt: hoursAgoIso(h), score: 10, category: "tech"
  });
  // 두 커뮤니티 소스: fast는 최근 1시간에 몰림, slow는 6~10시간 전
  const fast = new JsonSource("fastsrc", async () =>
    Array.from({ length: 8 }, (_, i) => mkRaw(`f${i}`, 0.2 + i * 0.1)), "community");
  const slow = new JsonSource("slowsrc", async () =>
    Array.from({ length: 8 }, (_, i) => mkRaw(`s${i}`, 6 + i * 0.5)), "community");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [fast, slow]);
  const user = store.createUser("lat1");

  const p1 = await engine.getFeed(user.id, { cursor: 0, limit: 6, sort: "latest" });
  assert.equal(p1.items.length, 6);
  // 최신(1시간 내) 글이 페이지 상단을 이끌어야 한다
  assert.ok(p1.items[0].id.startsWith("f"), "첫 아이템은 최신 소스여야");
  const p2 = await engine.getFeed(user.id, { cursor: p1.nextCursor, limit: 6, sort: "latest" });
  const ids1 = new Set(p1.items.map((i) => i.id));
  for (const it of p2.items) assert.ok(!ids1.has(it.id), `2페이지에 1페이지 글 재등장: ${it.id}`);
});

test("engine sort=latest: 개인화 유저에게도 취향 무관 중립 최신 뷰", async () => {
  const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const gamingSrc = new JsonSource("gsrc", async () =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `g${i}`, title: `게임 ${i}`, url: `https://example.com/g${i}`,
      publishedAt: hoursAgoIso(5 + i), score: 500, category: "gaming"
    })), "community");
  const bizSrc = new JsonSource("bsrc", async () =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `b${i}`, title: `경제 ${i}`, url: `https://example.com/b${i}`,
      publishedAt: hoursAgoIso(0.2 + i * 0.1), score: 1, category: "business"
    })), "community");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [gamingSrc, bizSrc]);
  const user = store.createUser("lat2");
  // 게임 취향 설문 완료 — 핫 탭이라면 gaming이 우선됐을 상황
  store.saveSurvey(user.id, { categories: ["gaming"], tags: [], communities: [] });

  const feed = await engine.getFeed(user.id, { cursor: 0, limit: 4, sort: "latest" });
  // 최신순은 취향이 아니라 시간이 지배한다: 최근 글(bsrc)이 앞선다
  assert.ok(feed.items[0].id.startsWith("b"), "취향(gaming)이 아니라 최신(bsrc)이 먼저");
});
