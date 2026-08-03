// 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 슬라이더 (David 2026-08-02
// "커뮤니티(오락성) 뉴스(소식성)의 비율을 조절하는 좌우 슬라이더, 정치성향
// 슬라이더처럼").
import test from "node:test";
import assert from "node:assert/strict";

import { mixMultiplier, leanMultiplier, FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";

test("mixMultiplier: 균형(0)이면 아무것도 건드리지 않는다", () => {
  for (const kind of ["news", "community", "ad", "affiliate", "me"]) {
    assert.equal(mixMultiplier({ kind }, 0), 1, kind);
  }
});

test("mixMultiplier: 슬라이더 방향대로 가중치가 갈린다", () => {
  // 뉴스 쪽으로 밀면 뉴스가 오르고 커뮤가 내린다
  assert.ok(mixMultiplier({ kind: "news" }, 1) > mixMultiplier({ kind: "community" }, 1));
  // 커뮤 쪽으로 밀면 반대
  assert.ok(mixMultiplier({ kind: "community" }, -1) > mixMultiplier({ kind: "news" }, -1));
  // 대칭이어야 한다 — 한쪽만 세게 먹으면 "균형 조절"이 아니다
  assert.equal(mixMultiplier({ kind: "news" }, 1), mixMultiplier({ kind: "community" }, -1));
});

test("mixMultiplier: 끝까지 밀어도 반대편이 사라지지 않는다 (필터가 아니라 다이얼)", () => {
  // 필터로 만들면 한쪽 공급이 얇은 시간대에 피드가 비어 버린다.
  assert.ok(mixMultiplier({ kind: "community" }, 1) >= 0.2, "완전히 0이 되면 안 된다");
  assert.ok(mixMultiplier({ kind: "news" }, -1) >= 0.2);
  assert.ok(mixMultiplier({ kind: "news" }, 1) <= 1.8, "상한도 있어야 한다");
});

test("mixMultiplier: 광고·제휴·내 글은 이 축의 대상이 아니다", () => {
  // 광고 노출량이 슬라이더로 흔들리면 수익 예측이 무너지고, 내가 쓴 글이
  // 슬라이더 때문에 안 보이면 그건 버그로 읽힌다.
  for (const kind of ["ad", "affiliate", "me", "seed", undefined]) {
    assert.equal(mixMultiplier({ kind }, 1), 1, String(kind));
    assert.equal(mixMultiplier({ kind }, -1), 1, String(kind));
  }
});

test("mixMultiplier와 leanMultiplier는 축이 달라 서로 상쇄하지 않는다", () => {
  // 하나는 "뉴스냐 커뮤냐", 다른 하나는 "뉴스 안에서 어느 쪽".
  // 곱해서 쓰므로 둘 다 0이 아닌 값이어야 함께 작동한다.
  const both = mixMultiplier({ kind: "news" }, 1) * leanMultiplier("hani-rank", 1);
  assert.ok(both > 0, "둘을 곱해도 살아 있어야 한다");
});

test("store: mixBalance는 [-1,1]로 잘리고 기본값은 0", () => {
  const store = new FeedStore();
  const u = store.createUser("mix-u1");
  assert.equal(u.mixBalance ?? 0, 0, "기본은 미개입");
  assert.equal(store.setMixBalance("mix-u1", 5), 1, "상한을 넘으면 잘린다");
  assert.equal(store.setMixBalance("mix-u1", -5), -1);
  assert.equal(store.setMixBalance("mix-u1", "abc"), 0, "비수치는 0으로");
  assert.equal(store.setMixBalance("mix-u1", -0.5), -0.5);
});

test("엔진 통합: 슬라이더를 뉴스 쪽으로 밀면 첫 페이지 뉴스 비중이 오른다", async () => {
  const now = Date.now();
  const at = (h) => new Date(now - h * 3600 * 1000).toISOString();
  const mk = (id, kind, cat, n) =>
    new JsonSource(id, async () => Array.from({ length: n }, (_, i) => ({
      id: `${id}_${i}`, title: `${id} 글 ${i} 제목이 충분히 길어야 한다`,
      url: `https://x/${id}/${i}`, category: cat,
      publishedAt: at(i % 6 + 1), sourceRank: i, score: 100 - i, commentCount: 20
    })), kind);

  async function share(balance) {
    const store = new FeedStore();
    const engine = new FeedEngine(store, [
      mk("gnews-kr", "news", "news", 20),
      mk("mk-news", "news", "business", 20),
      mk("etoland", "community", "humor", 20),
      mk("todayhumor", "community", "humor", 20)
    ]);
    const u = store.createUser(`mix-share-${balance}`);
    store.saveSurvey(u.id, { categories: ["news", "business", "humor"], communities: [], avoid: [] });
    if (balance !== 0) store.setMixBalance(u.id, balance);
    await engine.refresh();
    const feed = await engine.getFeed(u.id, { cursor: 0, limit: 20 });
    const organic = feed.items.filter((i) => i.kind === "news" || i.kind === "community");
    return organic.filter((i) => i.kind === "news").length / Math.max(1, organic.length);
  }

  const [toComm, mid, toNews] = [await share(-1), await share(0), await share(1)];
  assert.ok(toNews > mid, `뉴스 쪽(${toNews.toFixed(2)})이 균형(${mid.toFixed(2)})보다 높아야 한다`);
  assert.ok(toComm < mid, `커뮤 쪽(${toComm.toFixed(2)})이 균형(${mid.toFixed(2)})보다 낮아야 한다`);
  // 끝까지 밀어도 반대편이 남는다 — 다이얼이지 필터가 아니다
  assert.ok(toNews < 1, "뉴스 100%가 되면 안 된다");
  assert.ok(toComm > 0, "커뮤 100%가 되면 안 된다");
});
