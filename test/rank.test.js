// 추천 골격 v2 (rank.js) — selectDiverse의 보증을 고정한다.
// 설계: docs/redesign-rank.md. 각 테스트는 설계 검수가 지적한 실패 위험을 겨냥한다.
import test from "node:test";
import assert from "node:assert/strict";

import { rankParams, categorySets, globalScore, selectDiverse } from "../src/feed/rank.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const P = rankParams();

test("Hot engine: 반응 없는 외부 딜을 인기글 사이에 강제로 넣지 않는다", async () => {
  const now = Date.parse("2026-09-05T01:00:00Z");
  const store = new FeedStore({ clock: () => new Date(now).toISOString() });
  const engine = new FeedEngine(store);
  const user = store.createUser("hot-quality");
  store.saveSurvey(user.id, { categories: ["tech"], communities: [], avoid: [] });
  engine._cache = Array.from({ length: 30 }, (_, i) => ({
    id: `hot-${i}`, source: `public-${i % 10}`, kind: "community", category: "tech",
    title: `검증용 기술 화제 소식 ${i}`, url: `https://public.test/post/${i}`,
    tags: [], score: 1000 - i, commentCount: 100, publishedAt: new Date(now - 3600000).toISOString()
  }));
  const cold = { id: "cold-deal", source: "cold-shop", kind: "community", category: "life",
    title: "반응 없는 지난 할인 행사", url: "https://public.test/deal", score: 0, commentCount: 0,
    tags: [], sourceRank: 100, isDeal: true, publishedAt: new Date(now - 40 * 3600000).toISOString() };
  engine._cache.unshift(cold);
  const feed = await engine.getFeed(user.id, { markSeen: false, limit: 10 });
  assert.equal(feed.items.length, 10);
  assert.ok(!feed.items.some(item => item.id === cold.id));
  const deals = await engine.getFeed(user.id, { markSeen: false, sort: "deals" });
  assert.ok(deals.items.some(item => item.id === cold.id), "핫딜에서 직접 찾는 기능은 유지");
  store.markSeen(user.id, engine._cache.map(item => item.id));
  cold.hotScorePrev = 100;
  const recycled = await engine.getFeed(user.id, { markSeen: false, limit: 10 });
  const next = await engine.getFeed(user.id, { markSeen: false, cursor: 10, limit: 10 });
  assert.ok(recycled.items.every(item => item.category === "tech"));
  assert.ok(!next.items.some(item => recycled.items.some(first => first.id === item.id)));
});

function mk(id, source, category, hot, taste = 0, collab = 0) {
  return { item: { id, source, category, title: id }, hot, taste, collab };
}

test("Hot engine: 커뮤 반응 수가 있어도 뉴스 출처의 편집 순위를 보존한다", async () => {
  const now = Date.parse("2026-09-05T01:00:00Z");
  const store = new FeedStore({ clock: () => new Date(now).toISOString() });
  const user = store.createUser({});
  const engine = new FeedEngine(store);
  engine._cache = Array.from({ length: 8 }, (_, i) => ({
    id: `news-${i}`, source: "news-board", kind: "news", category: "tech",
    title: `편집 순위 검증 기사 ${i}`, url: `https://example.org/news/${i}`,
    sourceRank: 7 - i, score: 0, commentCount: 0, tags: [],
    publishedAt: new Date(now - 3600000).toISOString()
  }));
  engine._cache.push({ ...engine._cache[0], id: "community", source: "public-board",
    kind: "community", url: "https://example.org/community", score: 100 });
  const page = await engine.getFeed(user.id, { limit: 9, markSeen: false });
  assert.equal(page.items.find(item => item.kind === "news").id, "news-7");
});

test("categorySets: 설문 선택(+1)은 picked, 명시 회피(-1.5)는 hated, 애매한 값은 중립", () => {
  const { picked, hated } = categorySets({ categories: { tech: 1.0, business: -1.5, life: 0.2 } });
  assert.ok(picked.has("tech"));
  assert.ok(hated.has("business"));
  assert.ok(!picked.has("life") && !hated.has("life"));
});

test("globalScore: 덧셈 결합 — hot 0인 조용한 글에도 taste 지렛대가 살아있다", () => {
  // 곱셈이었다면 hot=0에서 taste가 무력화된다(설계 Q1의 기각 사유).
  const quiet = globalScore(0, 0.9, 0, P);
  const loudMismatch = globalScore(0.3, -0.9, 0, P);
  assert.ok(quiet > 0, "hot 0이어도 취향만으로 양수 점수");
  assert.ok(quiet > loudMismatch, "취향 완벽 + 조용함 > 화제 + 취향 정반대");
});

test("selectDiverse: 취향이 다르면 같은 후보에서 다른 페이지가 나온다 (골격 결함 1 해소)", () => {
  // 같은 후보 풀, 정반대 취향 두 명
  const cands = () => [
    ...Array.from({ length: 8 }, (_, i) => mk(`g${i}`, `gsrc${i % 3}`, "gaming", 0.5 - i * 0.05)),
    ...Array.from({ length: 8 }, (_, i) => mk(`b${i}`, `bsrc${i % 3}`, "business", 0.5 - i * 0.05))
  ];
  const gamer = selectDiverse(
    cands().map((c) => ({ ...c, taste: c.item.category === "gaming" ? 0.8 : -0.5 })),
    { limit: 10, firstPage: true, picked: new Set(["gaming"]), hated: new Set() }, P);
  const biz = selectDiverse(
    cands().map((c) => ({ ...c, taste: c.item.category === "business" ? 0.8 : -0.5 })),
    { limit: 10, firstPage: true, picked: new Set(["business"]), hated: new Set() }, P);

  const gShare = gamer.picks.filter((i) => i.category === "gaming").length;
  const bShare = biz.picks.filter((i) => i.category === "business").length;
  assert.ok(gShare >= 6, `게이머 1페이지에 게임 ${gShare}/10 — 최소 6 보장(검수 권고)`);
  assert.ok(bShare >= 6, `경제팬 1페이지에 경제 ${bShare}/10`);
  assert.notDeepEqual(gamer.picks.map((i) => i.id), biz.picks.map((i) => i.id), "두 사람의 첫 페이지가 달라야");
});

test("selectDiverse: 1페이지에서 hated 카테고리는 0개, 배제 수가 보고된다", () => {
  const cands = [
    ...Array.from({ length: 6 }, (_, i) => mk(`t${i}`, `s${i}`, "tech", 0.9 - i * 0.1)), // hated인데 점수 최상위
    ...Array.from({ length: 8 }, (_, i) => mk(`l${i}`, `s${i + 6}`, "life", 0.3 - i * 0.02))
  ];
  const r = selectDiverse(cands, {
    limit: 10, firstPage: true, picked: new Set(["life"]), hated: new Set(["tech"])
  }, P);
  assert.equal(r.picks.filter((i) => i.category === "tech").length, 0, "싫다고 한 카테고리가 1페이지에 나오면 안 됨");
  assert.equal(r.bannedHatedCount, 6, "배제 수는 exhausted 오판 방지용으로 보고");
  // 2026-07-31 변경: 2페이지 이후에도 하드 배제 — 적대적 검수 실측(회피
  // 카테고리가 matchScore 음수인데도 노출)에 따라 "싫다"는 전 페이지 존중.
  const r2 = selectDiverse(cands, { limit: 10, firstPage: false, picked: new Set(["life"]), hated: new Set(["tech"]) }, P);
  assert.equal(r2.picks.filter((i) => i.category === "tech").length, 0, "회피 카테고리는 모든 페이지에서 배제");
});

test("selectDiverse: 2페이지 이후에도 취향 쿼터가 유지된다 (감쇠 40%)", () => {
  const cands = [
    ...Array.from({ length: 12 }, (_, i) => mk(`g${i}`, `gs${i % 4}`, "gaming", 0.2 - i * 0.01, 0.6)),
    ...Array.from({ length: 12 }, (_, i) => mk(`n${i}`, `ns${i % 4}`, "news", 0.8 - i * 0.01, 0))
  ];
  // 뉴스가 hot에서 압도해도, 게임 취향 유저의 2페이지에 게임 글이 최소 쿼터만큼은 실려야
  const r = selectDiverse(cands, { limit: 10, firstPage: false, picked: new Set(["gaming"]), hated: new Set() }, P);
  const g = r.picks.filter((i) => i.category === "gaming").length;
  assert.ok(g >= Math.ceil(P.laterPickedShare * 10), `2페이지 게임 ${g}/10 — 최소 ${Math.ceil(P.laterPickedShare * 10)} 보장`);
});

test("selectDiverse: 소스별 페이지 상한 — 한 소스가 페이지를 도배하지 못한다", () => {
  // 단일 소스가 압도적 점수로 20개를 들이밀어도
  const cands = [
    ...Array.from({ length: 20 }, (_, i) => mk(`a${i}`, "loud", "tech", 0.9 - i * 0.01)),
    ...Array.from({ length: 10 }, (_, i) => mk(`q${i}`, `quiet${i}`, "tech", 0.2 - i * 0.01))
  ];
  const r = selectDiverse(cands, { limit: 10, picked: new Set(), hated: new Set() }, P);
  const loudCount = r.picks.filter((i) => i.source === "loud").length;
  const cap = Math.max(1, Math.ceil(P.pageSourceShare * 10));
  assert.ok(loudCount <= cap, `loud ${loudCount}개 > 상한 ${cap}`);
});

test("selectDiverse: 같은 소스가 연속으로 나오지 않는다 (minGap)", () => {
  const cands = [
    ...Array.from({ length: 5 }, (_, i) => mk(`a${i}`, "A", "tech", 0.9 - i * 0.01)),
    ...Array.from({ length: 5 }, (_, i) => mk(`b${i}`, "B", "tech", 0.5 - i * 0.01))
  ];
  const r = selectDiverse(cands, { limit: 8, minGap: 1, picked: new Set(), hated: new Set() },
    // cap을 크게 풀어 연속 금지만 검증
    rankParams({ pageSourceShare: 1 }));
  for (let i = 1; i < r.picks.length; i++) {
    assert.notEqual(r.picks[i].source, r.picks[i - 1].source, `연속 소스: ${i - 1}, ${i}`);
  }
});

test("selectDiverse: 노출 이력이 쌓인 소스는 밀리고, 안 보여준 소스가 올라온다", () => {
  const cands = [
    mk("a1", "seen-a-lot", "tech", 0.5),
    mk("b1", "never-seen", "tech", 0.45) // 점수는 약간 낮지만
  ];
  const r = selectDiverse(cands, {
    limit: 1, exposure: new Map([["seen-a-lot", 30]]), picked: new Set(), hated: new Set()
  }, P);
  assert.equal(r.picks[0].source, "never-seen", "로그 페널티가 소폭 점수차를 뒤집어야 (기아 방지)");
});

test("selectDiverse: 극단적 점수 격차는 페널티로 못 뒤집는다 (화제성 존중)", () => {
  const cands = [
    mk("viral", "seen-a-lot", "tech", 1.5), // 진짜 바이럴
    mk("dead", "never-seen", "tech", 0.01)
  ];
  const r = selectDiverse(cands, {
    limit: 1, exposure: new Map([["seen-a-lot", 10]]), picked: new Set(), hated: new Set()
  }, P);
  assert.equal(r.picks[0].id, "viral", "다양성 페널티가 화제성 자체를 삼키면 안 됨");
});

test("selectDiverse: 오래 본 출처의 새 인기글을 무반응 글보다 뒤로 보내지 않는다", () => {
  const cands = [
    mk("loud", "seen-a-lot", "tech", 1.5),
    mk("quiet", "never-seen", "tech", 0.01)
  ];
  const r = selectDiverse(cands, {
    limit: 1,
    exposure: new Map([["seen-a-lot", 10000], ["never-seen", 0]]),
    picked: new Set(),
    hated: new Set()
  }, P);
  assert.equal(r.picks[0].id, "loud");
});

test("selectDiverse: 커뮤만을 골라도 한 출처의 페이지 상한은 늘어나지 않는다", () => {
  const cands = Array.from({length: 30}, (_, i) => ({
    ...mk(`community-${i}`, i < 10 ? "loud" : `other-${i}`, "tech", i < 10 ? 1 : 0.4),
    item: { id: `community-${i}`, source: i < 10 ? "loud" : `other-${i}`, category: "tech", kind: "community" }
  }));
  const r = selectDiverse(cands, { limit: 10, mixBalance: -1 }, P);
  assert.equal(r.picks.filter(i => i.source === "loud").length, 2);
});

test("selectDiverse: 직접 등록한 상품도 핫 한 페이지를 채우지 않는다", () => {
  const cands = Array.from({length: 20}, (_, i) => ({
    ...mk(`offer-${i}`, `source-${i}`, "tech", i < 8 ? 2 : 0.5),
    item: { id: `offer-${i}`, source: `source-${i}`, category: "tech", via: i < 8 ? "ourdeal" : "api" }
  }));
  const page = selectDiverse(cands, { limit: 10 }, P).picks;
  assert.equal(page.length, 10);
  assert.equal(page.filter(item => item.via === "ourdeal").length, 1);
});

test("selectDiverse: 공급 부족 시 쿼터를 클램프하고 shortfall을 정직하게 보고", () => {
  // picked 카테고리 글이 2개뿐 — 6개 목표를 채울 수 없다
  const cands = [
    mk("p1", "s1", "auto", 0.5, 0.8), mk("p2", "s2", "auto", 0.4, 0.8),
    ...Array.from({ length: 10 }, (_, i) => mk(`o${i}`, `s${i + 3}`, "life", 0.3 - i * 0.01))
  ];
  const r = selectDiverse(cands, { limit: 10, firstPage: true, picked: new Set(["auto"]), hated: new Set() }, P);
  assert.equal(r.picks.filter((i) => i.category === "auto").length, 2, "있는 만큼은 전부 싣는다");
  assert.equal(r.shortfall, true, "부족을 숨기지 않는다 — 클라이언트 안내용");
  assert.equal(r.picks.length, 10, "부족해도 페이지는 다른 글로 채운다");
});

test("selectDiverse: 관심 밖 글을 할당량 때문에 강제로 채우지 않는다", () => {
  const cands = [
    ...Array.from({ length: 15 }, (_, i) => mk(`p${i}`, `ps${i % 5}`, "gaming", 0.6 - i * 0.02, 0.9)),
    ...Array.from({ length: 5 }, (_, i) => mk(`o${i}`, `os${i}`, "science", 0.2 - i * 0.02, 0))
  ];
  const r = selectDiverse(cands, { limit: 10, firstPage: true, picked: new Set(["gaming"]), hated: new Set() }, P);
  const other = r.picks.filter((i) => i.category === "science").length;
  assert.ok(other <= Math.ceil(P.otherShare * 10), `관심 밖 글 ${other}개 — 탐색 상한`);
});

test("selectDiverse: 취향 여러 개 고른 유저의 쿼터를 한 카테고리가 독식하지 못한다 (실사용 회귀 재현)", () => {
  // 실사용 회귀(2026-08-01): auto 뉴스가 신선한 hot 상위를 점유 + 소스는 제각각
  // → 소스 상한 무력 → "취향 다 선택했는데 자동차만 나온다"
  const cands = [
    ...Array.from({ length: 12 }, (_, i) => mk(`a${i}`, `autosrc${i}`, "auto", 0.9 - i * 0.01, 0.7)),
    ...Array.from({ length: 8 }, (_, i) => mk(`t${i}`, `techsrc${i}`, "tech", 0.4 - i * 0.01, 0.7)),
    ...Array.from({ length: 8 }, (_, i) => mk(`g${i}`, `gamesrc${i}`, "gaming", 0.35 - i * 0.01, 0.7))
  ];
  const r = selectDiverse(cands, {
    limit: 10, firstPage: true,
    picked: new Set(["auto", "tech", "gaming"]), hated: new Set()
  }, P);
  const byCat = {};
  for (const i of r.picks) byCat[i.category] = (byCat[i.category] || 0) + 1;
  const catCap = Math.ceil(P.pageCatShare * 10);
  assert.ok((byCat.auto || 0) <= catCap, `auto ${byCat.auto}개 > 상한 ${catCap}`);
  assert.ok((byCat.tech || 0) >= 1 && (byCat.gaming || 0) >= 1,
    `고른 다른 카테고리도 나와야 — 실제 ${JSON.stringify(byCat)}`);
});

test("selectDiverse: 단일 취향은 공급이 충분하면 60% 상한에 묶이지 않는다", () => {
  const cands = [
    ...Array.from({ length: 12 }, (_, i) => mk(`a${i}`, `as${i}`, "auto", 0.6 - i * 0.01, 0.8)),
    ...Array.from({ length: 8 }, (_, i) => mk(`o${i}`, `os${i}`, "life", 0.3 - i * 0.01, 0))
  ];
  const r = selectDiverse(cands, { limit: 10, firstPage: true, picked: new Set(["auto"]), hated: new Set() }, P);
  const autoN = r.picks.filter((i) => i.category === "auto").length;
  assert.ok(autoN > Math.ceil(P.firstPickedShare * 10), "관심 글을 60%만 남기려고 밀어내지 않는다");
});

test("selectDiverse: 안 고른 카테고리는 화제성이 아무리 높아도 페이지 30%를 못 넘는다 (실사용 회귀의 본체)", () => {
  // 유저는 tech·gaming만 골랐고 auto는 안 골랐다. 신선한 auto 뉴스(소스 제각각)
  // 가 hot 최상위를 점유한 상황 — 2026-08-01 실사용 보고 재현.
  const cands = [
    ...Array.from({ length: 15 }, (_, i) => mk(`a${i}`, `newssrc${i}`, "auto", 1.0 - i * 0.01, 0)),
    ...Array.from({ length: 8 }, (_, i) => mk(`t${i}`, `ts${i}`, "tech", 0.35 - i * 0.01, 0.7)),
    ...Array.from({ length: 8 }, (_, i) => mk(`g${i}`, `gs${i}`, "gaming", 0.3 - i * 0.01, 0.7))
  ];
  const r = selectDiverse(cands, {
    limit: 10, firstPage: true, picked: new Set(["tech", "gaming"]), hated: new Set()
  }, P);
  const autoN = r.picks.filter((i) => i.category === "auto").length;
  const pickedN = r.picks.filter((i) => ["tech", "gaming"].includes(i.category)).length;
  const neutralCap = Math.ceil(P.pageNeutralCatShare * 10);
  assert.ok(autoN <= neutralCap, `안 고른 auto가 ${autoN}개 — 중립 상한 ${neutralCap} 초과`);
  assert.ok(pickedN >= Math.ceil(P.firstPickedShare * 10), `고른 카테고리 ${pickedN}개 — 쿼터 보장`);
});

test("selectDiverse: 안 고른 카테고리들의 합계는 탐색 창(2/10)을 넘지 못한다 — 취향 세팅 유저는 8/10 보장", () => {
  // 중립 카테고리 셋(auto·life·science)이 각각 hot 상위를 들이밀어도
  const cands = [
    ...Array.from({ length: 6 }, (_, i) => mk(`a${i}`, `as${i}`, "auto", 0.95 - i * 0.01, 0)),
    ...Array.from({ length: 6 }, (_, i) => mk(`l${i}`, `ls${i}`, "life", 0.9 - i * 0.01, 0)),
    ...Array.from({ length: 6 }, (_, i) => mk(`s${i}`, `ss${i}`, "science", 0.85 - i * 0.01, 0)),
    ...Array.from({ length: 8 }, (_, i) => mk(`t${i}`, `ts${i}`, "tech", 0.3 - i * 0.01, 0.7)),
    ...Array.from({ length: 8 }, (_, i) => mk(`g${i}`, `gs${i}`, "gaming", 0.28 - i * 0.01, 0.7))
  ];
  const r = selectDiverse(cands, {
    limit: 10, firstPage: true, picked: new Set(["tech", "gaming"]), hated: new Set()
  }, P);
  const neutral = r.picks.filter((i) => !["tech", "gaming"].includes(i.category)).length;
  assert.ok(neutral <= Math.ceil(P.otherShare * 10), `중립 합계 ${neutral} — 탐색 창 ${Math.ceil(P.otherShare * 10)} 초과 금지`);
  assert.equal(r.picks.length, 10, "페이지는 가득 채운다");
});
