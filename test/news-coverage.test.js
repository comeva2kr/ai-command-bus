// 뉴스 화제성 신호를 우리가 만든다 (David 2026-08-06).
//
// "랭킹이 없어도 조회수, 좋아요 추천수, 인용, 퍼나르기 등으로 기준을 못 잡나?"
//
// 실측: 언론사 RSS의 item 태그에 수치가 아예 없고(매경 부동산: no·title·link·
// category·author·pubDate·description·media:content), 라이브 뉴스 18건 중
// 교차보도 값이 있는 것이 1건이었다 — 뉴스가 아무 화제성 신호 없이 최신순으로
// 흐르고 있었다는 뜻이다. 판정(②단계)이 뉴스에서는 작동하지 않고 있었다.
//
// 우리는 89개 소스를 동시에 본다. 몇 곳이 같은 사건을 다뤘는지는 우리가 셀 수 있다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collect } from "../src/feed/content.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const SAME = "국회 예산안 처리 무산 여야 대치 계속";
// kind를 명시한다 — 실서비스에서는 JsonSource가 normalizeItem을 거치며
// 소스의 kind를 아이템에 찍어 주지만, 이 테스트는 raw를 그대로 돌려주므로
// 직접 넣어야 실제와 같은 조건이 된다.
const art = (id, source, sourceLabel, title = SAME, kind = "news") => ({
  id, title, url: `https://example.com/${id}`, source, sourceLabel, kind,
  publishedAt: new Date().toISOString(), category: "news"
});

test("같은 사건을 다룬 매체 수를 우리가 센다", async () => {
  const src = (id, label) => ({ id, kind: "news", async fetch() { return [art(`${id}1`, id, label)]; } });
  const { items } = await collect([src("hani", "한겨레"), src("donga", "동아"), src("khan", "경향"), src("yna", "연합")]);
  assert.equal(items.length, 1, "같은 사건이 안 접혔다");
  assert.equal(items[0].coverage, 4, `4곳이 다뤘는데 coverage=${items[0].coverage}`);
});

test("한 곳만 다룬 것은 교차보도가 아니다", async () => {
  const one = { id: "s", kind: "news", async fetch() { return [art("a", "hani", "한겨레")]; } };
  const { items } = await collect([one]);
  assert.ok(!(items[0].coverage > 0), "혼자 다룬 글에 교차보도가 붙었다");
});

test("수집 사이클이 갈려도 풀 전체에서 다시 센다", async () => {
  // collect의 중복 제거는 한 사이클 안에서만 접는다. 매체마다 기사 올리는 시각이
  // 달라 다른 사이클에 들어오면 안 묶인다 — 접는 자리에서만 세면 라이브에서
  // 값이 안 오른다(실제로 배포 후 그대로였다). 풀은 48시간 누적이므로
  // 여기서 다시 세야 "몇 곳이 다뤘나"가 나온다.
  const store = new FeedStore();
  let round = 0;
  const src = {
    id: "s", kind: "news",
    async fetch() {
      round += 1;
      // 사이클마다 다른 매체가 같은 사건을 올린다 — 서로 접히지 않는다.
      return [art(`r${round}`, `src${round}`, `매체${round}`)];
    }
  };
  const engine = new FeedEngine(store, [src]);
  await engine.refresh();
  await engine.refresh();
  await engine.refresh();
  const items = await engine._items();
  const same = items.filter((i) => i.title === SAME);
  assert.ok(same.length >= 2, "사이클이 갈렸는데 풀에 하나만 남았다 — 전제가 깨졌다");
  assert.ok(same.every((i) => i.coverage >= same.length),
    `풀 전체 집계가 안 걸렸다: ${same.map((i) => i.coverage).join(",")}`);
});

test("교차보도 집계는 수집 사이클 안에서만 돈다 — 요청을 막지 않는다", () => {
  // 확정 규칙: 무거운 계산은 요청 밖에서. 풀 수천 건을 훑는 일이라
  // 요청 경로에 들어가면 홈 TTFB 4초 사고의 재판이 된다.
  const src = readFileSync("src/feed/engine.js", "utf8");
  const block = src.slice(src.indexOf("교차보도를 **풀 전체에서** 다시 센다"),
                          src.indexOf("동일 기사 URL 중복 제거"));
  assert.match(block, /const bySource = new Map\(\)/, "집계 블록을 못 찾았다");
  // refresh() 안에 있어야 한다 — getFeed/getItem 쪽이면 요청마다 돈다.
  const refreshStart = src.indexOf("async refresh(");
  const blockAt = src.indexOf("교차보도를 **풀 전체에서** 다시 센다");
  assert.ok(blockAt > refreshStart, "집계가 refresh 밖에 있다");
});

test("같은 매체가 두 번 접혀도 한 번만 센다", async () => {
  // 검수(2026-08-06 P1) 재현: 실제 2곳인데 coverage=3이 나왔다.
  const src = (id, label, n) => ({
    id, kind: "news",
    async fetch() { return Array.from({ length: n }, (_, i) => art(`${id}${i}`, id, label)); }
  });
  const { items } = await collect([src("mk", "매경", 1), src("hk", "한경", 3)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].coverage, 2, `실제 2곳인데 coverage=${items[0].coverage}`);
});

test("커뮤니티가 기사 제목을 따 와도 매체로 세지 않는다", async () => {
  // "몇 곳의 매체가 다뤘나"가 이 신호의 뜻이다. 커뮤니티 반향은 별개 신호다.
  const news = { id: "mk", kind: "news", async fetch() { return [art("n1", "mk", "매경")]; } };
  const comm = { id: "clien", kind: "community",
    async fetch() { return [art("c1", "clien", "클리앙", SAME, "community")]; } };
  const { items } = await collect([news, comm]);
  assert.equal(items.length, 1);
  assert.ok(!(items[0].coverage > 0), `커뮤니티가 매체로 세졌다: ${items[0].coverage}`);
});
