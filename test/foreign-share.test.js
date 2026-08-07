import test from "node:test";
import assert from "node:assert/strict";
import { ensureForeignShare, isForeignItem, FOREIGN_MIN_SHARE } from "../src/feed/taste-share.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { JsonSource } from "../src/feed/content.js";

// 5.7 B단계 채택안 — 해외 글 페이지 하한 (2026-08-08).
// 해외 RSS는 반응 수치가 없어 hotScore 속도 보너스를 못 받고 첫 화면에서
// 죽는다(설계 워크플로 실측: 첫 20칸 중 19번째 1건). 점수는 그대로 두고
// X AuthorDiversityFloor 방식의 하한만 둔다. 검수 라운드2 반영:
// 창=페이지 크기(고정 20칸은 개인화 경로에서 no-op이었다), 스왑/교체 방식
// (splice 삽입은 창 끝의 기존 해외 글을 밀어내 하한을 스스로 깼다).

const hoursAgoIso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

function mk(n, { foreign = false, prefix = "d" } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    translated: foreign
  }));
}

test("해외 하한: 첫 화면에 해외가 없으면 뒤에서 끌어올린다 (창 20 → 2건)", () => {
  const list = [...mk(30), ...mk(5, { foreign: true, prefix: "f" })];
  const r = ensureForeignShare(list, [], { window: 20 });
  assert.equal(r.moved, 2);
  const head = r.items.slice(0, 20);
  assert.equal(head.filter(isForeignItem).length, 2);
  // 끌어올린 것은 뒤쪽 해외 중 가장 순위 높은 것들
  assert.ok(head.some((i) => i.id === "f0"));
  assert.ok(head.some((i) => i.id === "f1"));
});

test("해외 하한: 목록이 창과 같은 길이(개인화 페이지)여도 풀에서 채운다", () => {
  // 검수 라운드2 P0 재현 — selectDiverse가 이미 limit로 자른 목록엔 꼬리가
  // 없다. 관문 통과 풀(pool)이 후보가 된다.
  const list = mk(10);
  const pool = mk(3, { foreign: true, prefix: "f" });
  const r = ensureForeignShare(list, pool, { window: 10 });
  assert.equal(r.moved, 1, "창 10 → 최소 1건");
  assert.equal(r.items.length, 10, "길이 보존(교체)");
  assert.equal(r.items.filter(isForeignItem).length, 1);
  assert.equal(r.items[0].id, "d0", "1위 칸은 그대로");
});

test("해외 하한: 창 끝의 기존 해외 글을 밀어내지 않는다 (off-by-one 회귀)", () => {
  // 검수 라운드2 P2 재현 — splice 삽입이면 index 19의 해외 글이 창 밖으로
  // 밀려 최종 1건이 됐다. 스왑은 밀림 자체가 없다.
  const list = [...mk(19), mk(1, { foreign: true, prefix: "f19-" })[0], ...mk(10, { prefix: "x" }), ...mk(3, { foreign: true, prefix: "g" })];
  const r = ensureForeignShare(list, [], { window: 20 });
  const head = r.items.slice(0, 20);
  assert.ok(head.filter(isForeignItem).length >= 2, `창 안 해외 ${head.filter(isForeignItem).length}건`);
});

test("해외 하한: 길이가 보존되고 중복이 없다 — 무한스크롤 계약", () => {
  const list = [...mk(40), ...mk(4, { foreign: true, prefix: "f" })];
  const r = ensureForeignShare(list, mk(3, { foreign: true, prefix: "p" }), { window: 20 });
  assert.equal(r.items.length, list.length);
  assert.equal(new Set(r.items.map((i) => i.id)).size, list.length);
});

test("해외 하한: 이미 충분하면 순서를 건드리지 않는다", () => {
  const list = [mk(1)[0], ...mk(3, { foreign: true, prefix: "f" }), ...mk(30, { prefix: "x" })];
  const r = ensureForeignShare(list, [], { window: 20 });
  assert.equal(r.moved, 0);
  assert.deepEqual(r.items.map((i) => i.id), list.map((i) => i.id));
});

test("해외 하한: 재료가 없으면 있는 만큼만 — 없는 것을 만들지 않는다", () => {
  assert.equal(ensureForeignShare(mk(40), [], { window: 20 }).moved, 0);
  assert.equal(ensureForeignShare(mk(40), [], { window: 20 }).items.length, 40);
});

test("해외 하한: 아주 짧은 창(풀 소진 근처)은 개입하지 않는다", () => {
  const list = mk(4);
  const r = ensureForeignShare(list, mk(2, { foreign: true, prefix: "f" }), { window: 4 });
  assert.equal(r.moved, 0, "4칸에 1건 강제는 지분의 세 배 — 접는다");
});

test("해외 하한: 끌어온 글은 기존 해외 글 옆에 붙지 않는다(가능하면)", () => {
  const list = [...mk(5), mk(1, { foreign: true, prefix: "f5-" })[0], ...mk(14, { prefix: "x" }), ...mk(2, { foreign: true, prefix: "g" })];
  const r = ensureForeignShare(list, [], { window: 20 });
  const head = r.items.slice(0, 20);
  const at = head.map((x, i) => (isForeignItem(x) ? i : -1)).filter((i) => i >= 0);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] > 1, `해외 연속 배치: ${at}`);
});

test("해외 하한: avoid로 표시된 칸(딜 지분 등)은 교체하지 않는다", () => {
  // 검수 라운드3 재현 — 딜 지분과 해외 하한이 같은 균등 분산 공식을 써서
  // 회피 없이는 하한이 딜 칸을 정확히 노려 교체했다.
  const list = mk(10);
  list[5] = { id: "deal5", isDeal: true };
  const pool = mk(2, { foreign: true, prefix: "f" });
  const r = ensureForeignShare(list, pool, { window: 10, avoid: (x) => x.isDeal === true });
  assert.equal(r.moved, 1);
  assert.ok(r.items.some((x) => x.id === "deal5"), "딜이 목록에 남는다");
  assert.equal(r.items[5].id, "deal5", "딜 칸이 교체되지 않는다");
});

test("isForeignItem: 번역됨·번역대상·비한국어 원문 모두 해외로 본다", () => {
  assert.ok(isForeignItem({ translated: true }));
  assert.ok(isForeignItem({ needsTranslation: true }));
  assert.ok(isForeignItem({ originalLang: "en" }));
  assert.ok(!isForeignItem({ originalLang: "ko" }));
  assert.ok(!isForeignItem({ title: "국내 글" }));
  assert.ok(!isForeignItem(null));
});

// ── 엔진 통합 — 익명·개인화 두 경로 모두 (검수 라운드2: 개인화가 구멍이었다)

function rig() {
  const domestic = (src, cat) =>
    new JsonSource(src, async () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `${src}-${i}`, title: `${src} 인기글 ${i}`, url: `https://example.org/${src}/${i}`,
        score: 300 - i * 10, commentCount: 40, category: cat, publishedAt: hoursAgoIso(3 + i)
      })), "community");
  const foreign = new JsonSource("archdaily", async () =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `arch-${i}`, title: `해외 기사 ${i}`, url: `https://example.org/arch/${i}`,
      translated: true, originalLang: "en", publishedAt: hoursAgoIso(2 + i)
    })), "news");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [domestic("c1", "humor"), domestic("c2", "tech"), domestic("c3", "sports"), foreign]);
  return { store, engine };
}

test("엔진 통합(익명): 페이지에 해외 글이 하한만큼 나온다", async () => {
  const { store, engine } = rig();
  await engine.refresh();
  const user = store.createUser({});
  const feed = await engine.getFeed(user.id, { limit: 10 });
  const got = feed.items.filter(isForeignItem).length;
  assert.ok(got >= 1, `첫 페이지(10건) 해외 ${got}건 — 하한 1 미달`);
  assert.equal(feed.items.length, 10, "하한 개입이 페이지 길이를 줄이지 않는다");
});

test("엔진 통합: hated 카테고리는 하한 후보에서도 배제된다 — 관문 두 벌 금지", async () => {
  // 검수 라운드3 재현 — selectDiverse가 전 페이지 하드 배제한 카테고리를
  // 해외 하한이 뒷문으로 다시 들이면 안 된다. 해외 소스에 명시 카테고리를
  // 주고 그 카테고리를 hated 문턱 밑까지 학습시킨다.
  const domestic = (src, cat) =>
    new JsonSource(src, async () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `${src}-${i}`, title: `${src} 인기글 ${i}`, url: `https://example.org/${src}/${i}`,
        score: 300 - i * 10, commentCount: 40, category: cat, publishedAt: hoursAgoIso(3 + i)
      })), "community");
  const foreignArt = new JsonSource("archdaily", async () =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `arch-${i}`, title: `해외 기사 ${i}`, url: `https://example.org/arch/${i}`,
      translated: true, originalLang: "en", category: "art", publishedAt: hoursAgoIso(2 + i)
    })), "news");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [domestic("c1", "humor"), domestic("c2", "tech"), domestic("c3", "sports"), foreignArt]);
  await engine.refresh();
  const user = store.createUser({});
  store.saveSurvey(user.id, { categories: ["humor"] });
  store.getUser(user.id).preferences.categories.art = -3; // hated 문턱 밑
  const feed = await engine.getFeed(user.id, { limit: 10 });
  assert.equal(feed.items.filter((i) => i.category === "art").length, 0,
    "hated 카테고리 해외 글이 하한 경로로 새면 안 된다");
});

test("엔진 통합(개인화): selectDiverse가 자른 페이지에도 해외 글이 나온다", async () => {
  // 검수 라운드2 P0 — 하한의 동기였던 David 계정이 정확히 이 코호트였는데
  // 구버전 하한은 여기서 아무것도 안 했다.
  const { store, engine } = rig();
  await engine.refresh();
  const user = store.createUser({});
  store.saveSurvey(user.id, { categories: ["humor"] });
  const feed = await engine.getFeed(user.id, { limit: 10 });
  const got = feed.items.filter(isForeignItem).length;
  assert.ok(got >= 1, `개인화 첫 페이지(10건) 해외 ${got}건 — 하한 1 미달`);
  assert.equal(feed.items.length, 10);
  assert.equal(new Set(feed.items.map((i) => i.id)).size, 10, "중복 없음");
});
