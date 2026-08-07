import test from "node:test";
import assert from "node:assert/strict";
import { sourceHotScores } from "../src/feed/ingest.js";

// David 2026-08-07:
//   "수집 한번에 리스트가 다 바뀌게 하지말고 안정적으로 보이게"
//   → 그래서 관성을 넣었더니
//   "급등해도 45분에 걸쳐 올라오는건 좀... 그건 지금핫이랑 또 안맞는데"
//
// 처음 넣은 대칭 관성(EMA)은 오르는 것과 내리는 것을 똑같이 늦췄다. 그게 틀렸다.
// 사용자가 느끼는 충격은 **보던 글이 사라지는 것**이지 새 글이 올라오는 게 아니다.
// 새 글이 위로 오는 건 오히려 이 서비스가 하는 일이다.
//
// 그래서 비대칭으로: 상승은 즉시, 하락만 완만.

const now = Date.now();
const mk = (id, score) => ({
  id, title: `글${id}`, source: "s", kind: "community",
  score, commentCount: 0, publishedAt: new Date(now).toISOString()
});

function cycle(items) { sourceHotScores(items, now, { persist: true }); }

test("급등은 즉시 반영된다 — '지금핫'의 이름값", () => {
  const items = [mk("a", 100), mk("b", 10)];
  cycle(items);
  const before = items[1].hotScorePrev;
  items[1].score = 500;
  cycle(items);
  assert.ok(items[1].hotScorePrev > items[0].hotScorePrev,
    `급등한 글이 즉시 1위여야 한다: b=${items[1].hotScorePrev} a=${items[0].hotScorePrev}`);
  assert.ok(items[1].hotScorePrev > before);
});

test("하락은 완만하다 — 보던 글이 갑자기 사라지지 않게", () => {
  const items = [mk("a", 100), mk("b", 500)];
  cycle(items);
  const peak = items[1].hotScorePrev;
  items[1].score = 5;
  cycle(items);
  const after = items[1].hotScorePrev;
  assert.ok(after < peak, "떨어지긴 해야 한다");
  // 관성 없이 새로 계산했다면 훨씬 더 낮았을 값 — 절반은 붙잡고 있어야 한다
  const naked = sourceHotScores([mk("a", 100), mk("b", 5)], now)[1].hotScore;
  assert.ok(after > naked, `하락이 한 번에 반영됐다: ${after} vs 관성없음 ${naked}`);
});

test("첫 등장은 관성 없이 제 점수 그대로", () => {
  const items = [mk("a", 100)];
  cycle(items);
  const fresh = sourceHotScores([mk("a", 100)], now)[0].hotScore;
  assert.equal(items[0].hotScorePrev, fresh);
});

test("persist 없이는 기록하지 않는다 — 요청 경로에서 관성이 중복 적용되면 점수가 굳는다", () => {
  const items = [mk("a", 100)];
  sourceHotScores(items, now);
  assert.equal(items[0].hotScorePrev, undefined);
});
