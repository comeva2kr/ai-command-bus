import test from "node:test";
import assert from "node:assert/strict";
import { expectsSignal, sampleSources, classify, evaluate, summarize } from "../src/feed/health.js";

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const H = (n) => n * 3600e3;

test("expectsSignal: 반응 수치 정규식이 있는 소스만 신호를 기대한다", () => {
  assert.equal(expectsSignal({ adapter: { type: "list", list: { scoreRegex: "x" } } }), true);
  assert.equal(expectsSignal({ adapter: { type: "list", list: { commentRegex: "x" } } }), true);
  // 뉴스 RSS는 추천·댓글을 원래 주지 않는다 — 0이어도 고장이 아니다.
  // 이걸 구분하지 않으면 경보가 매일 울려서 아무도 안 본다.
  assert.equal(expectsSignal({ adapter: { type: "rss", url: "https://x/rss" } }), false);
  assert.equal(expectsSignal({ adapter: { type: "list", list: { titleRegex: "x" } } }), false);
});

test("sampleSources: 건수와 '신호가 붙은 건수'를 따로 센다", () => {
  const registry = [
    { id: "a", label: "A", kind: "community", adapter: { type: "list", list: { scoreRegex: "s" } } },
    { id: "b", label: "B", kind: "news", adapter: { type: "rss", url: "u" } },
    { id: "off", label: "OFF", enabled: false, adapter: { type: "rss", url: "u" } }
  ];
  const items = [
    { source: "a", score: 10, commentCount: 0 },
    { source: "a", score: 0, commentCount: 3 },
    { source: "a", score: 0, commentCount: 0 },
    { source: "b", score: 0, commentCount: 0 }
  ];
  const s = sampleSources(items, registry);
  assert.equal(s.length, 2, "비활성 소스는 판정 대상이 아니다");
  const a = s.find((x) => x.id === "a");
  assert.deepEqual([a.items, a.withSignal, a.expectsSignal], [3, 2, true]);
  const b = s.find((x) => x.id === "b");
  assert.deepEqual([b.items, b.withSignal, b.expectsSignal], [1, 0, false]);
});

test("classify: 0건은 유예 후에만 down — 하루 안쪽은 stalled", () => {
  const s = { id: "a", items: 0, withSignal: 0, expectsSignal: true };
  assert.equal(classify(s, { lastItemsAt: NOW - H(3) }, NOW).status, "stalled");
  assert.equal(classify(s, { lastItemsAt: NOW - H(30) }, NOW).status, "down");
});

test("classify: 성공 기록이 없으면 '몇 시간째'를 지어내지 않는다", () => {
  const v = classify({ id: "a", items: 0, withSignal: 0, expectsSignal: true }, null, NOW);
  assert.equal(v.status, "stalled");
  assert.equal(v.since, null);
  assert.equal(v.downFor, null, "실측 안 된 기간을 숫자로 만들지 않는다");
});

test("classify: 건수는 있는데 신호가 사라진 것이 파서 고장의 신호다", () => {
  // 2026-08-04 실측에서 나온 바로 그 모양: 이토랜드 38건 수집 · 반응 전부 0.
  // 건수만 보는 헬스체크는 이걸 '정상'으로 보고했다.
  const s = { id: "etoland", items: 38, withSignal: 0, expectsSignal: true };
  const v = classify(s, { lastItemsAt: NOW, lastSignalAt: NOW - H(30) }, NOW);
  assert.equal(v.status, "signal-lost");
  assert.match(v.reason, /마크업/);
});

test("classify: 반응 수치를 원래 안 주는 소스는 고장이 아니다", () => {
  const v = classify({ id: "yna", items: 13, withSignal: 0, expectsSignal: false }, { lastItemsAt: NOW }, NOW);
  assert.equal(v.status, "no-signal");
});

test("classify: 정규식은 있는데 한 번도 매칭된 적이 없으면 즉시 고장이다", () => {
  // 유예를 주면 영원히 stalled에 머문다 — 애초에 안 맞는 정규식이므로
  // 기다린다고 나아지지 않는다.
  const v = classify({ id: "x", items: 20, withSignal: 0, expectsSignal: true }, { lastItemsAt: NOW, lastSignalAt: null }, NOW);
  assert.equal(v.status, "signal-lost");
  assert.equal(v.since, null);
});

test("evaluate: 기록을 갱신하고 나쁜 것부터 정렬한다", () => {
  const samples = [
    { id: "ok1", label: "정상", items: 10, withSignal: 8, expectsSignal: true },
    { id: "dead", label: "죽음", items: 0, withSignal: 0, expectsSignal: true },
    { id: "broken", label: "고장", items: 30, withSignal: 0, expectsSignal: true }
  ];
  const priors = {
    ok1: { lastItemsAt: NOW - H(1), lastSignalAt: NOW - H(1) },
    dead: { lastItemsAt: NOW - H(40), lastSignalAt: NOW - H(40) },
    broken: { lastItemsAt: NOW - H(1), lastSignalAt: NOW - H(40) }
  };
  const { report, next } = evaluate(samples, priors, NOW);
  assert.deepEqual(report.map((r) => r.status), ["down", "signal-lost", "ok"]);
  // 성공한 소스만 시각이 갱신된다 — 실패한 소스의 '마지막 성공'은 과거로 남는다.
  assert.equal(next.ok1.lastSignalAt, NOW);
  assert.equal(next.dead.lastItemsAt, NOW - H(40));
  assert.equal(next.broken.lastItemsAt, NOW);
  assert.equal(next.broken.lastSignalAt, NOW - H(40), "신호가 0이면 마지막 신호 시각은 그대로 둔다");
  assert.deepEqual(summarize(report), { total: 3, down: 1, signalLost: 1, stalled: 0, noSignal: 0, ok: 1 });
});

test("evaluate: 회복하면 기록이 다시 앞으로 간다", () => {
  const priors = { s: { lastItemsAt: NOW - H(40), lastSignalAt: NOW - H(40) } };
  const { report, next } = evaluate([{ id: "s", label: "S", items: 20, withSignal: 15, expectsSignal: true }], priors, NOW);
  assert.equal(report[0].status, "ok");
  assert.equal(next.s.lastSignalAt, NOW);
});
