// David 적대적 검수 2026-07-29 — 발견된 결함이 되살아나지 못하게 고정한다.
//
// 검수 원문(PMO Codex 경유):
//   2. 화제성·인기성 알고리즘 로직 검증 — 의도한 대로 작동하는지
//   3. 특정 플랫폼 콘텐츠만 과다 노출되는 편향 원인 조사
//   4. 오래된(수백 일 전) 뉴스가 노출되는 원인 조사
//   5. 취향(토픽) 설정이 실제 추천 결과에 반영 안 되는 문제 — 매칭 로직 재구현
//
// 아래 테스트는 전부 "고치기 전에는 실패했던" 성질만 검증한다.

import test from "node:test";
import assert from "node:assert/strict";

import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { JsonSource } from "../src/feed/content.js";
import { sourceHotScores, roundRobinInterleave } from "../src/feed/ingest.js";
import { tasteScore, scoreItem } from "../src/feed/recommender.js";

const hoursAgoIso = (h, now = Date.now()) => new Date(now - h * 3600 * 1000).toISOString();

// ---------------------------------------------------------------------------
// 항목 2 — hotScore 스케일. 취향 보정이 덧셈으로 얹히므로, 점수 간격이 그
// 보정치와 비교 가능한 규모여야 한다.
// ---------------------------------------------------------------------------

test("검수2: hotScore가 지수적으로 폭발하지 않는다 (덧셈 취향 보정이 의미를 갖는 스케일)", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  const mk = (rank, score, comments, ageH) => ({
    kind: "community", source: "x", title: `t${rank}`, score, commentCount: comments,
    sourceRank: rank, coverage: 0, publishedAt: hoursAgoIso(ageH, now)
  });
  // 전형적인 커뮤니티 베스트보드 분포 (1위가 압도적으로 반응이 많은 경우)
  const pool = [mk(0, 1200, 900, 2), mk(1, 600, 300, 5), mk(2, 300, 150, 9), mk(3, 120, 60, 14),
                mk(4, 60, 30, 20), mk(5, 30, 10, 28), mk(6, 12, 5, 40), mk(7, 4, 2, 60)];
  const scores = sourceHotScores(pool, now).map((s) => s.hotScore);

  // 고치기 전 실측: 8055.7 / 2.55 / 0.60 / ... — 1위가 2위의 3157배.
  // Math.exp(robust-z)라 z에 상한이 없어 점수가 지수적으로 벌어졌다.
  const ratio = scores[0] / scores[1];
  assert.ok(ratio < 50, `1위/2위 비율이 ${ratio.toFixed(1)}배 — 덧셈 취향 보정이 무의미해지는 스케일`);
  assert.ok(scores[0] < 100, `hotScore 절대값이 ${scores[0].toFixed(1)} — 유계여야 한다`);
  // 순증가는 그대로 유지 (같은 소스 안의 정렬 순서가 바뀌면 안 된다)
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] > scores[i], `순서가 깨짐: ${i - 1}위(${scores[i - 1]}) <= ${i}위(${scores[i]})`);
  }
});

// ---------------------------------------------------------------------------
// 항목 5 — 취향이 "순서"만이 아니라 "구성 비율"을 움직여야 한다.
// ---------------------------------------------------------------------------

function twoCategoryEngine() {
  const now = Date.now();
  const mk = (i, cat, src) => ({
    id: `${src}_${i}`, title: `${cat} ${i}`, url: `https://x/${src}/${i}`,
    category: cat, tags: [], score: 400 - i * 25, commentCount: 150 - i * 10,
    publishedAt: hoursAgoIso(i + 1, now), sourceRank: i
  });
  const sources = [];
  for (const [cat, pre] of [["gaming", "g"], ["business", "b"]]) {
    for (let s = 0; s < 4; s++) {
      const id = `${pre}${s}`;
      sources.push(new JsonSource(id, async () => Array.from({ length: 8 }, (_, i) => mk(i, cat, id)), "community"));
    }
  }
  return sources;
}

async function feedShare(sources, pickCategory, target, limit = 24) {
  const store = new FeedStore();
  const engine = new FeedEngine(store, sources);
  const u = store.createUser();
  store.saveSurvey(u.id, { categories: [pickCategory], depth: "mixed", tone: "balanced" });
  const res = await engine.getFeed(u.id, { limit });
  const items = res.items.filter((i) => i.kind !== "ad" && i.kind !== "affiliate");
  assert.ok(items.length > 0, "피드가 비어 있으면 이 테스트는 의미가 없다");
  return items.filter((i) => i.category === target).length / items.length;
}

test("검수5: 고른 카테고리가 실제로 더 많이 나온다 (구성 비율이 바뀐다)", async () => {
  const sources = twoCategoryEngine();
  const gamingFanGaming = await feedShare(sources, "gaming", "gaming");
  const bizFanGaming = await feedShare(sources, "business", "gaming");

  // 고치기 전 실측: 둘 다 정확히 0.50 — 라운드로빈이 모든 소스에 같은 횟수를
  // 배정하고 취향은 라운드 안의 순서만 정했기 때문이다.
  assert.ok(
    gamingFanGaming > bizFanGaming + 0.15,
    `취향이 구성에 반영 안 됨: 게임팬 게임비율 ${(gamingFanGaming * 100).toFixed(0)}% vs 경제팬 게임비율 ${(bizFanGaming * 100).toFixed(0)}%`
  );
  assert.ok(gamingFanGaming > 0.55, `고른 카테고리가 과반을 넘어야: ${(gamingFanGaming * 100).toFixed(0)}%`);
});

test("검수5+3: 취향이 강해도 안 고른 카테고리가 사라지지는 않는다 (다양성 하한)", async () => {
  const sources = twoCategoryEngine();
  const gamingFanBiz = await feedShare(sources, "gaming", "business");
  assert.ok(gamingFanBiz >= 0.2, `안 고른 카테고리가 ${(gamingFanBiz * 100).toFixed(0)}%까지 밀림 — 편식 피드`);
  assert.ok(gamingFanBiz <= 0.45, `취향 반영이 너무 약함: ${(gamingFanBiz * 100).toFixed(0)}%`);
});

test("검수5: 취향 벡터가 없으면(익명) 예전처럼 균등 배분", () => {
  const topK = new Map([
    ["a", [{ item: { id: "a1", source: "a", category: "tech", tags: [] }, rank: 0, hotScore: 1 }]],
    ["b", [{ item: { id: "b1", source: "b", category: "life", tags: [] }, rank: 0, hotScore: 1 }]]
  ]);
  const out = roundRobinInterleave(topK, {});
  assert.equal(out.length, 2, "가중치 없이도 모든 소스가 배치되어야");
});

// ---------------------------------------------------------------------------
// 항목 3 — 취향 가중치가 "인기도"를 대신 재면 편중이 되살아난다.
// ---------------------------------------------------------------------------

test("검수3: 취향 점수는 인기도·신선도에 오염되지 않는다", () => {
  const vec = { categories: { tech: 1 }, tags: {}, sources: {}, prefs: {} };
  const base = { category: "tech", tags: [], length: 200, source: "s", id: "i" };
  const loud = { ...base, id: "loud", score: 5000, commentCount: 3000, publishedAt: hoursAgoIso(1) };
  const quiet = { ...base, id: "quiet", score: 0, commentCount: 0, publishedAt: hoursAgoIso(30) };

  // 같은 카테고리·같은 태그 => 취향상 완전히 동일해야 한다.
  assert.equal(
    tasteScore(loud, vec), tasteScore(quiet, vec),
    "추천수/댓글수/신선도가 취향 점수를 바꾸면 '시끄러운 소스 = 취향에 맞는 소스'가 되어 편중이 재발한다"
  );
  // 반면 scoreItem(전체 추천 점수)은 인기도를 반영하는 게 맞다 — 역할 분리 확인
  assert.ok(
    scoreItem(loud, vec, { now: Date.now() }) > scoreItem(quiet, vec, { now: Date.now() }),
    "scoreItem은 여전히 인기도를 반영해야 한다"
  );
});

// ---------------------------------------------------------------------------
// 항목 4 — 절대 신선도 하한.
// ---------------------------------------------------------------------------

test("검수4: 수백 일 전 글은 그 소스의 최상위여도 피드에 나오지 않는다", async () => {
  const now = Date.now();
  // stale 소스는 오래된 글만 갖고 있다 — 라운드로빈이 소스마다 자리를 보장하므로
  // 고치기 전에는 점수가 0에 수렴해도 결국 한 자리를 차지했다.
  const stale = new JsonSource("stale", async () => [
    { title: "438일 전 글", url: "https://old/1", category: "news", score: 10,
      publishedAt: new Date(now - 438 * 86400000).toISOString() }
  ], "news");
  const fresh = new JsonSource("fresh", async () => (
    Array.from({ length: 6 }, (_, i) => ({
      title: `오늘 글 ${i}`, url: `https://new/${i}`, category: "news", score: 100 - i,
      publishedAt: hoursAgoIso(i + 1, now)
    }))
  ), "news");

  const store = new FeedStore();
  const engine = new FeedEngine(store, [stale, fresh]);
  const u = store.createUser();
  const res = await engine.getFeed(u.id, { limit: 20 });
  const sources = res.items.filter((i) => i.kind !== "ad" && i.kind !== "affiliate").map((i) => i.source);

  assert.ok(!sources.includes("stale"), "438일 전 글이 여전히 노출됨");
  assert.ok(sources.includes("fresh"), "정상 소스는 나와야 한다 (필터가 과도하지 않은지)");
});

test("검수4: 발행일이 없는 글은 오래됐다고 단정해 버리지 않는다", async () => {
  // 일부 리스트 어댑터는 날짜를 아예 주지 않는다(실측: 라이브 30건 중 7건).
  // 날짜 없음을 '오래됨'으로 처리하면 멀쩡한 글이 대량으로 사라진다.
  const noDate = new JsonSource("nodate", async () => [
    { title: "날짜 없는 글", url: "https://nd/1", category: "news", score: 50 }
  ], "community");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [noDate]);
  const u = store.createUser();
  const res = await engine.getFeed(u.id, { limit: 10 });
  const sources = res.items.filter((i) => i.kind !== "ad" && i.kind !== "affiliate").map((i) => i.source);
  assert.ok(sources.includes("nodate"), "발행일 없는 글이 신선도 하한에 잘못 걸렸다");
});

// ---------------------------------------------------------------------------
// 항목 1 — 하드코딩·목업 전수 점검을 코드로 고정한다.
// 점검 결과 자체는 통과였지만(프로덕션 실측: 시드 0건·샘플광고 0건, via는
// rss/api뿐), 그 안전이 **env 설정에만 의존**하고 있었다. 규칙은 테스트로
// 고정한다(05_RULE_ENFORCEMENT_PROTOCOL "가능하면 코드·테스트로 고정").
// ---------------------------------------------------------------------------

test("검수1: David가 제외 확정한 소스는 켤 수 없고 fetch URL도 가질 수 없다", async () => {
  // handoff.md 절대원칙 2-③ (David 2026-07-23): 에펨코리아·아카라이브·
  // 디시인사이드·일베는 "차단 여부와 무관하게 시도 자체 금지".
  // 레지스트리에는 근거 주석이 달린 묘비로 남겨 두는 편이 낫다(모르고 다시
  // 추가하는 것을 막아준다) — 대신 켜지지 않는다는 것을 여기서 강제한다.
  const { loadRegistry } = await import("../src/feed/registry.js");
  const BANNED = ["fmkorea", "arca", "dcinside", "ilbe"];
  for (const c of loadRegistry()) {
    if (!BANNED.some((b) => c.id.toLowerCase().includes(b))) continue;
    assert.equal(c.enabled, false, `${c.id}: David 제외 확정 소스가 활성화됨`);
    const url = (c.adapter && c.adapter.url) || "";
    assert.equal(url, "", `${c.id}: 제외 확정 소스에 fetch URL이 들어감 — ${url}`);
  }
});

test("검수1: 브라우징 기록 매핑의 소스 id는 전부 레지스트리에 실재해야 한다 (오타 방지)", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const known = new Set(loadRegistry().map((c) => c.id));
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "history.js"),
    "utf8"
  );
  const block = src.slice(src.indexOf("const HOST_MAP"), src.indexOf("];", src.indexOf("const HOST_MAP")));
  const referenced = [...new Set([...block.matchAll(/source:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
  assert.ok(referenced.length > 0, "HOST_MAP 파싱 실패 — 테스트가 무의미해짐");
  const unknown = referenced.filter((id) => !known.has(id));
  assert.deepEqual(unknown, [], `레지스트리에 없는 소스를 가리키는 매핑: ${unknown.join(", ")}`);
});

test("검수1: 브라우징 워밍업은 비활성 소스에 취향 가중치를 싣지 않는다 (카테고리는 유지)", async () => {
  // vec.sources는 상위 3개만 남기고 잘린다(prune(vec.sources, ..., 3)).
  // 비활성 소스가 그 3자리를 먹으면 살아있는 소스를 밀어낸다 — 실측 2026-07-29:
  // getcha·encar·humoruniv·dcinside·instiz·mlbpark·82cook 7개가 그 상태였다.
  const { inferFromHistory } = await import("../src/feed/history.js");
  const { loadRegistry } = await import("../src/feed/registry.js");
  const enabled = new Set(loadRegistry().filter((c) => c.enabled).map((c) => c.id));

  // mlbpark(비활성, 스포츠) + 82cook(비활성, 라이프)만 본 유저
  const { vector } = inferFromHistory([
    { host: "mlbpark.donga.com", title: "", count: 5 },
    { host: "www.82cook.com", title: "", count: 5 }
  ]);
  const weighted = Object.keys(vector.sources);
  const deadWeighted = weighted.filter((id) => !enabled.has(id));
  assert.deepEqual(deadWeighted, [], `비활성 소스에 가중치가 실렸다: ${deadWeighted.join(", ")}`);

  // 카테고리 신호는 살아 있어야 한다 — 소스를 못 긁는 것과 그 사람의 관심사는 별개다
  assert.ok(vector.categories.sports > 0, "mlbpark 방문에서 스포츠 관심 신호가 사라졌다");
  assert.ok(vector.categories.life > 0, "82cook 방문에서 라이프 관심 신호가 사라졌다");

  // 활성 소스는 정상적으로 가중치를 받아야 한다 (필터가 과도하지 않은지)
  const live = inferFromHistory([{ host: "www.clien.net", title: "", count: 5 }]);
  assert.ok(live.vector.sources.clien > 0, "활성 소스까지 걸러졌다");
});

test("검수1: 기본(프로덕션) 설정에서는 시드·샘플 데이터가 절대 실리지 않는다", async () => {
  const { buildSources, loadRegistry } = await import("../src/feed/registry.js");
  // FEED_DEV 없이 = 프로덕션. seed 옵션을 명시하지 않으면 서버가 넘기는 값과
  // 같은 경로를 타야 한다(server.js: seed: Boolean(process.env.FEED_DEV)).
  const sources = buildSources(loadRegistry(), { seed: false });
  const seedish = sources.filter((s) => s.id === "seed" || s.kind === "seed");
  assert.deepEqual(seedish.map((s) => s.id), [], "프로덕션 소스 목록에 시드가 섞였다");
});

// ---------------------------------------------------------------------------
// 항목 6·7 — UX. 프론트는 단일 index.html이라 다른 UI 테스트와 같은 방식으로
// 정적 검증한다(test/monetize.test.js의 index.html 검증과 동일 패턴).
// ---------------------------------------------------------------------------

async function indexHtml() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  return fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html"),
    "utf8"
  );
}

test("검수6: 취향 선택 화면에 로그인 유도가 있고, 이미 로그인했거나 provider가 없으면 안 뜬다", async () => {
  const html = await indexHtml();
  assert.match(html, /id="surveyAuthNudge"/, "취향 화면에 로그인 유도 블록이 있어야");
  assert.match(html, /로그인하면 이 취향이 계속 따라와요/);
  // 취향이 기기에만 저장된다는 사실(=로그인해야 하는 이유)을 밝혀야 한다
  assert.match(html, /이 브라우저에만 저장/);

  const fn = html.slice(html.indexOf("function renderSurveyAuthNudge"), html.indexOf("function showSurvey"));
  assert.ok(fn.includes("loggedIn"), "이미 로그인한 유저에겐 안 띄워야");
  assert.ok(fn.includes("providers.length"), "활성 provider가 없으면 안 띄워야 (누를 수 없는 안내 금지)");
  assert.ok(fn.includes("hidden"), "숨김 처리가 있어야");
  // 로그인은 여전히 선택 — 건너뛸 수 있어야 한다
  assert.match(html, /id="surveyAuthSkip"/, "로그인 없이 계속할 수단이 있어야");
});

test("검수7: 최초 진입 온보딩이 있고, 한 번 보면 다시 안 뜨며, 벽이 되지 않는다", async () => {
  const html = await indexHtml();
  const fn = html.slice(html.indexOf("function maybeShowOnboarding"), html.indexOf("// Soft, dismissible invitation"));
  assert.ok(fn.length > 100, "온보딩 함수를 찾지 못했다");

  // 한 번만 — 다시 뜨면 짜증이다
  assert.ok(fn.includes("ONBOARD_KEY"), "본 적 있는지 기록해야");
  assert.ok(/localStorage\.setItem\(ONBOARD_KEY/.test(fn), "닫을 때 기록해야");

  // 벽이 되면 안 된다 (설문 벽을 걷어낸 결정을 되돌리지 않는다)
  assert.ok(fn.includes("Escape"), "ESC로 닫을 수 있어야");
  assert.ok(fn.includes("e.target === back"), "바깥을 눌러도 닫혀야");

  // 저장소가 막힌 브라우저(사파리 프라이빗 등)에서 매번 뜨면 안 된다
  assert.ok(/catch\s*\{\s*done = true/.test(fn), "localStorage 접근 실패 시 조용히 생략해야");

  // 실제로 쓸모 있는 세 가지를 알려주는지 — 아웃링크/학습/소스필터
  assert.match(html, /카드를 누르면 원문으로/);
  assert.match(html, /취향이 맞춰져요/);
  assert.match(html, /메뉴에서 커뮤니티를 골라요/);
});

test("검수7: 이미 취향을 맞춘 유저에겐 온보딩을 다시 띄우지 않는다", async () => {
  const html = await indexHtml();
  assert.match(
    html, /if\(!s\.surveyed\) maybeShowOnboarding\(\);/,
    "설문을 마친 계정(다른 기기 로그인 등)에는 사용법 설명이 다시 뜨면 안 된다"
  );
});
