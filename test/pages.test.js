// 자체 콘텐츠 페이지 — 지어낸 수치가 없어야 하고, 알맹이 없는 페이지를 만들면 안 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { communityRanking, sourceBest, keywordIndex, keywordPage } from "../src/feed/pages.js";

const ITEMS = [
  { source: "clien", sourceLabel: "클리앙", kind: "community", category: "tech", title: "갤럭시 폴드 후기", score: 100, commentCount: 50 },
  { source: "clien", sourceLabel: "클리앙", kind: "community", category: "tech", title: "갤럭시 신제품 발표", score: 60, commentCount: 20 },
  { source: "theqoo", sourceLabel: "더쿠", kind: "community", category: "culture", title: "갤럭시 광고 모델", score: 10, commentCount: 300 },
  { source: "bobae", sourceLabel: "보배드림", kind: "community", category: "auto", title: "타이어 교체 후기", score: 5, commentCount: 5 }
];

test("순위는 우리가 잰 반응량으로 매긴다", () => {
  // 방문자수 같은 외부 추정치는 쓰지 않는다 — 잰 적이 없는 수다.
  const r = communityRanking(ITEMS);
  assert.equal(r[0].source, "theqoo", "반응량 310이 1위여야 한다");
  assert.equal(r[0].reactions, 310);
  assert.equal(r[1].source, "clien");
  assert.equal(r[1].reactions, 230);
  for (const e of r) assert.ok(!("visits" in e), "방문자수 같은 미측정 값이 들어갔다");
});

test("동점이면 글 수가 많은 쪽이 앞", () => {
  const r = communityRanking([
    { source: "a", sourceLabel: "A", score: 50, commentCount: 50 },
    { source: "b", sourceLabel: "B", score: 40, commentCount: 30 },
    { source: "b", sourceLabel: "B", score: 20, commentCount: 10 }
  ]);
  assert.equal(r[0].source, "b", "같은 100이면 2건인 b가 앞");
});

test("평균 댓글은 정수로 — 없는 정밀도를 만들지 않는다", () => {
  const r = communityRanking(ITEMS);
  for (const e of r) assert.equal(e.avgComments, Math.round(e.avgComments));
});

test("커뮤니티가 오늘 무엇을 다뤘는지 함께 낸다", () => {
  const r = communityRanking(ITEMS);
  assert.equal(r.find((x) => x.source === "clien").topCategory, "tech");
});

test("그룹별 베스트는 반응순, 없는 소스는 null", () => {
  const b = sourceBest(ITEMS, "clien");
  assert.equal(b.label, "클리앙");
  assert.equal(b.total, 2);
  assert.equal(b.items[0].title, "갤럭시 폴드 후기");
  assert.equal(sourceBest(ITEMS, "없는소스"), null);
});

test("키워드는 두 곳 이상에서 나온 것만", () => {
  // 한 커뮤니티에서만 나온 단어는 그 글의 고유명사일 뿐 화제 키워드가 아니다.
  // 알맹이 없는 페이지를 수백 개 만들면 자체 콘텐츠가 아니라 감점이다.
  const idx = keywordIndex(ITEMS, { minSources: 2, minItems: 3 });
  const tags = idx.map((x) => x.tag);
  assert.ok(tags.includes("갤럭시"), `갤럭시가 빠졌다: ${tags.join(",")}`);
  assert.ok(!tags.includes("타이어"), "한 소스에서만 나온 단어가 들어갔다");
});

test("키워드 페이지는 소스·분야 분포를 함께 낸다", () => {
  const p = keywordPage(ITEMS, "갤럭시");
  assert.equal(p.total, 3);
  assert.equal(p.items[0].commentCount, 300, "반응순 정렬이 아니다");
  assert.ok(p.sources.length >= 2);
  assert.ok(p.categories.length >= 2);
  assert.equal(keywordPage(ITEMS, "없는태그"), null);
});

test("빈 입력에서 죽지 않는다", () => {
  assert.deepEqual(communityRanking([]), []);
  assert.deepEqual(keywordIndex([]), []);
  assert.equal(sourceBest([], "x"), null);
  assert.equal(keywordPage([], "x"), null);
});

test("수집 금지 소스는 발행 페이지에 안 실린다", async () => {
  // 커뮤니티 순위는 소스 이름을 대놓고 광고하는 페이지다.
  // enabled:false 소스(디시 등)가 여기 뜨면 안 된다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const disabled = loadRegistry().filter((c) => c.enabled === false).map((c) => c.id);
  assert.ok(disabled.length, "비활성 소스가 하나도 없어 검증이 무의미하다");
  const engine = new FeedEngine({});
  const pool = await engine.pool();
  assert.ok(pool.length, "풀이 비어 검증이 무의미하다");
  for (const it of pool) {
    assert.ok(!disabled.includes(it.source), `금지 소스가 풀에 있다: ${it.source}`);
  }
});
