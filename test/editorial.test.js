import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorialNote } from "../src/feed/editorial.js";

const fixedNow = Date.parse("2026-07-28T12:00:00.000Z");

function hoursAgo(h, from = fixedNow) {
  return new Date(from - h * 3600 * 1000).toISOString();
}
function minutesAgo(m, from = fixedNow) {
  return new Date(from - m * 60 * 1000).toISOString();
}

// Extract every "number-looking" token from a rendered note — plain integers
// (with optional comma grouping) and the "9만"-style Korean 만-unit shorthand
// — and resolve each back to the raw number it represents. Used to prove
// buildEditorialNote never prints a digit that isn't traceable to a real
// input value (the hard "never fabricate a number" rule from the spec).
function extractNumbers(text) {
  const matches = text.match(/\d[\d,]*\.?\d*\s*만?/g) || [];
  return matches.map((tok) => {
    const hasMan = tok.includes("만");
    const numPart = tok.replace(/만/g, "").replace(/,/g, "").trim();
    const val = parseFloat(numPart);
    return hasMan ? val * 10000 : val;
  });
}

// Assert every number found in `text` is within rounding tolerance of one of
// the real values the test fed into the item/context. formatCount rounds to
// 1 decimal place once over 10,000 ("만" units) and comma-groups below that
// (no rounding), so tolerance only needs to cover the 만-rounding case.
function assertNumbersTraceToInputs(text, allowedValues) {
  const found = extractNumbers(text);
  assert.ok(found.length > 0, `expected at least one number in "${text}"`);
  for (const n of found) {
    const ok = allowedValues.some((v) => Math.abs(v - n) <= Math.max(1, v * 0.05));
    assert.ok(ok, `number ${n} parsed from "${text}" does not trace back to any real input value [${allowedValues.join(", ")}]`);
  }
}

test("editorial: 급상승형 fires for fresh + very high score/comments, and every printed number traces to real fields", () => {
  const item = {
    kind: "community",
    source: "hackernews",
    sourceLabel: "해커뉴스",
    score: 890,
    commentCount: 1300,
    publishedAt: hoursAgo(3)
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.notEqual(note, "");
  assert.match(note, /해커뉴스/);
  assert.match(note, /3시간/);
  assert.match(note, /890/);
  assert.match(note, /1,300/);
  assertNumbersTraceToInputs(note, [890, 1300, 3]);
});

test("editorial: 급상승형 rounds a large score into '만' units without inventing a different number", () => {
  const item = {
    kind: "community",
    source: "theqoo",
    sourceLabel: "더쿠",
    score: 90000,
    commentCount: 0,
    publishedAt: hoursAgo(3)
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.match(note, /더쿠/);
  assert.match(note, /9만/);
  assertNumbersTraceToInputs(note, [90000, 3]);
});

test("editorial: 압도적 반응형 states a multiplier only when actually computed from context.sourceStats — not a hardcoded string", () => {
  const item = {
    kind: "community",
    source: "bobae",
    sourceLabel: "보배드림",
    score: 250,
    commentCount: 0,
    // old enough to stay out of 급상승형's 24h window even though score is
    // high, so this test isolates the outlier template specifically
    publishedAt: hoursAgo(72)
  };
  const sourceStats = { mean: 50, median: 45, count: 6 };
  const expectedMultiple = Math.round((item.score / sourceStats.mean) * 10) / 10;
  assert.equal(expectedMultiple, 5); // sanity check on the fixture itself

  const note = buildEditorialNote(item, { now: fixedNow, sourceStats });
  assert.notEqual(note, "");
  assert.match(note, /보배드림/);
  assert.match(note, new RegExp(`${expectedMultiple}배`));
  assertNumbersTraceToInputs(note, [item.score, expectedMultiple]);

  // change the mean -> the stated multiple must change with it (proves it's
  // computed per-call, not a fixed template string)
  const note2 = buildEditorialNote(item, { now: fixedNow, sourceStats: { mean: 25, median: 20, count: 4 } });
  assert.match(note2, /10배/);
});

test("editorial: 압도적 반응형 does not fire without enough same-source samples or a positive mean", () => {
  const item = { kind: "community", source: "bobae", sourceLabel: "보배드림", score: 250, publishedAt: hoursAgo(72) };
  assert.equal(buildEditorialNote(item, { now: fixedNow, sourceStats: { mean: 50, median: 50, count: 1 } }), "");
  assert.equal(buildEditorialNote(item, { now: fixedNow, sourceStats: { mean: 0, median: 0, count: 5 } }), "");
  assert.equal(buildEditorialNote(item, { now: fixedNow }), ""); // no stats at all, and nothing else qualifies
});

// 게시판 1위형 — 홈 피드가 라운드로빈이라 "각 소스 1위"가 대거 올라오므로,
// 조건 없이 쓰면 카드 대부분이 같은 문구가 된다(David 2026-07-27 실측: 20건 중
// 13건 동일). 그래서 **실측 반응 수치가 있을 때만** 발동하고 그 수치를 문구에
// 실어 서로 달라지게 한다. 지표 없는 RSS 1위는 이 템플릿을 건너뛴다.
test("editorial: 게시판 1위형 fires only when rank #1 AND real engagement exists, and prints those numbers", () => {
  const item = {
    kind: "community",
    source: "ruliweb",
    sourceLabel: "루리웹",
    score: 10,
    commentCount: 5,
    sourceRank: 0,
    publishedAt: hoursAgo(72)
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.equal(note, "루리웹 지금 1위 — 추천 10·댓글 5");

  const notFirst = buildEditorialNote({ ...item, sourceRank: 1 }, { now: fixedNow });
  assert.ok(!notFirst.includes("지금 1위"), "rank 1(2위)엔 1위 문구가 안 붙어야");

  // 지표가 0인 1위(RSS 소스)는 이 템플릿을 안 쓴다 — 없는 반응을 있다고 하지 않음
  const noSignal = buildEditorialNote(
    { ...item, score: 0, commentCount: 0 },
    { now: fixedNow }
  );
  assert.ok(!noSignal.includes("지금 1위"), "지표 0이면 1위 문구 없음");
});

test("editorial: 댓글 폭발형 fires when comments heavily outweigh score, regardless of age", () => {
  const item = {
    kind: "community",
    source: "instiz",
    sourceLabel: "인스티즈",
    score: 5,
    commentCount: 200,
    publishedAt: hoursAgo(200)
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.equal(note, "댓글 200개 — 논쟁 중");
  assertNumbersTraceToInputs(note, [200]);
});

test("editorial: 신선형 fires for a just-published item with modest (below-surge-floor) early traction", () => {
  const item = {
    kind: "news",
    source: "gnews",
    sourceLabel: "구글뉴스",
    score: 200, // below the 급상승형 floor (300), so this isolates 신선형
    commentCount: 0,
    publishedAt: minutesAgo(10)
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.match(note, /10분 전/);
  assert.match(note, /200/);
  assertNumbersTraceToInputs(note, [200, 10]);
});

test("editorial: 번역/해외형 fires for translated overseas items, stating only a real score", () => {
  const item = {
    kind: "community",
    source: "hackernews",
    sourceLabel: "해커뉴스",
    score: 850,
    commentCount: 5,
    translated: true,
    publishedAt: hoursAgo(72) // old enough to avoid 급상승형
  };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.match(note, /해커뉴스/);
  assert.match(note, /850/);
  assert.match(note, /한글로 옮겨왔어요/);
  assertNumbersTraceToInputs(note, [850]);
});

test("editorial: 번역/해외형 with no score still says something honest, with no number at all", () => {
  const item = { kind: "community", source: "tildes", sourceLabel: "틸데스", score: 0, commentCount: 0, translated: true };
  const note = buildEditorialNote(item, { now: fixedNow });
  assert.equal(note, "틸데스, 한글로 옮겨왔어요");
  assert.equal(extractNumbers(note).length, 0);
});

test("editorial: all-zero/missing data returns '' — no forced filler sentence", () => {
  const item = { kind: "community", source: "unknown", score: 0, commentCount: 0, publishedAt: null, sourceRank: null };
  assert.equal(buildEditorialNote(item, { now: fixedNow }), "");
  assert.equal(buildEditorialNote(item), ""); // also with no context at all
  assert.equal(buildEditorialNote(null), "");
});

test("editorial: affiliate/ad items never get a note, even if their fields would otherwise qualify", () => {
  const item = {
    kind: "affiliate",
    source: "coupang",
    sourceLabel: "쿠팡파트너스",
    score: 90000,
    commentCount: 1300,
    sourceRank: 0,
    publishedAt: minutesAgo(5)
  };
  assert.equal(buildEditorialNote(item, { now: fixedNow, sourceStats: { mean: 10, median: 10, count: 5 } }), "");
  assert.equal(buildEditorialNote({ ...item, kind: "ad" }, { now: fixedNow }), "");
});

test("editorial: priority order — a fresh, hugely-outlying, rank-1 item still reads as 급상승형 (priority 1), not the lower-priority templates", () => {
  const item = {
    kind: "community",
    source: "clien",
    sourceLabel: "클리앙",
    score: 5000,
    commentCount: 0,
    sourceRank: 0, // would also qualify for 게시판 1위형 (priority 3)
    publishedAt: hoursAgo(1) // fresh
  };
  const note = buildEditorialNote(item, { now: fixedNow, sourceStats: { mean: 10, median: 10, count: 5 } }); // would also qualify for 압도적 반응형 (priority 2)
  assert.match(note, /클리앙에서/);
  assert.match(note, /만에/);
  assert.match(note, /5,000/); // formatCount(5000) -> "5,000"
});
