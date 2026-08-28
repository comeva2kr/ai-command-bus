import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JsonSource } from "../src/feed/content.js";
import { FeedEngine } from "../src/feed/engine.js";
import { editionSegmentKey } from "../src/feed/edition-change.js";
import {
  EDITORIAL_INVENTORY_CONTRACT,
  EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT,
  assertEditorialSnapshotCompatibility,
  buildEditorialInventory,
  collectEditorialSegments,
  dueEditorialSlots,
  editorialSnapshotCompatibilityStatus,
  editorialInventorySegmentKey,
  inventoryEditorialSlots,
  nextEditorialSlot,
  resolveEditorialTarget,
  slotAsOfMs
} from "../src/feed/editorial-inventory.js";
import { FeedStore } from "../src/feed/store.js";

const atKst = (value) => Date.parse(`${value}+09:00`);

test("슬롯 시각 계약: 현재까지 발행된 판만 시간순으로 돌려준다", () => {
  const now = atKst("2026-08-10T13:10:00");
  const due = dueEditorialSlots(now);
  assert.deepEqual(due.map((entry) => entry.slot.id), ["morning", "lunch"]);
  assert.equal(due[0].asOfMs, atKst("2026-08-10T07:00:00"));
  assert.equal(due[1].asOfMs, atKst("2026-08-10T12:00:00"));

  const future = resolveEditorialTarget(now, "evening");
  assert.equal(future.available, false);
  const beforeMorning = resolveEditorialTarget(atKst("2026-08-10T03:00:00"));
  assert.equal(beforeMorning.date, "2026-08-09");
  assert.equal(beforeMorning.slot.id, "evening");
  const recovery = inventoryEditorialSlots(atKst("2026-08-10T03:00:00"));
  assert.deepEqual(recovery.map((entry) => `${entry.date}:${entry.slot.id}`), [
    "2026-08-09:morning",
    "2026-08-09:lunch",
    "2026-08-09:evening"
  ]);
  const nextToday = nextEditorialSlot(atKst("2026-08-10T08:00:00"));
  assert.equal(`${nextToday.date}:${nextToday.slot.id}`, "2026-08-10:lunch");
  const nextDay = nextEditorialSlot(atKst("2026-08-10T20:00:00"));
  assert.equal(`${nextDay.date}:${nextDay.slot.id}`, "2026-08-11:morning");
});

test("재고 판본 계약: v30이 현재 정본 계약 버전을 고정하고 불일치를 fail-closed 한다", () => {
  const status = editorialSnapshotCompatibilityStatus();

  assert.equal(EDITORIAL_INVENTORY_CONTRACT.snapshotVersion, "v30");
  assert.equal(EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.snapshotVersion, "v30");
  assert.equal(status.pass, true);
  assert.deepEqual(status.actual, EDITORIAL_SNAPSHOT_COMPATIBILITY_CONTRACT.requires);
  assert.equal(status.fingerprint, "edition-change:9|fulfillment:8|lineage:4|lineage-fingerprint:5|quality:13");
  assert.throws(
    () => assertEditorialSnapshotCompatibility({ ...status.actual, qualityVersion: 9 }),
    (error) => error && error.code === "EDITORIAL_SNAPSHOT_CONTRACT_MISMATCH"
  );
});

test("as-of 오늘판: 요청 시각이 늦어도 슬롯 뒤 항목을 미래에서 끌어오지 않는다", async () => {
  const observedAt = atKst("2026-08-10T06:30:00");
  const rows = [
    "기준금리 전망", "환율 변동 점검", "반도체 공급 변화",
    "고용 지표 발표", "주택 거래 동향", "기업 실적 발표"
  ].map((title, index) => ({
    id: `before-${index}`,
    title: `${title} ${index + 1}`,
    url: `https://before.example.com/${index}`,
    category: "business",
    score: 200 - index,
    commentCount: 20 - index,
    publishedAt: new Date(atKst(`2026-08-10T06:${String(5 + index).padStart(2, "0")}:00`)).toISOString()
  }));
  rows.push(...[
    "저녁 시장 급등", "장 마감 공시", "야간 환율 변화"
  ].map((title, index) => ({
    id: `future-${index}`,
    title,
    url: `https://future.example.com/${index}`,
    category: "business",
    score: 999 - index,
    commentCount: 99,
    publishedAt: new Date(atKst(`2026-08-10T19:0${index}:00`)).toISOString()
  })));

  const store = new FeedStore({ clock: () => new Date(observedAt).toISOString() });
  const engine = new FeedEngine(store, [new JsonSource("slot-source", async () => rows, "news")]);
  const asOfMs = slotAsOfMs("2026-08-10", "morning");
  const edition = await engine.todayEdition({
    categories: ["business"],
    slotId: "morning",
    asOfMs
  });

  assert.equal(edition.generatedAt, new Date(asOfMs).toISOString());
  assert.ok(edition.itemCount >= 3 && edition.itemCount <= 6);
  assert.ok(edition.sections.flatMap((section) => section.items).every((item) => !item.id.startsWith("future-")));
  assert.ok(edition.publishable);
});

test("late backfill: 현재 소스 상한에 밀린 과거 글을 48시간 풀에서 as-of로 복원한다", async () => {
  const eveningAsOf = atKst("2026-08-10T19:00:00");
  let nowMs = atKst("2026-08-10T18:55:00");
  let rows = [
    "게임 신작 공개", "e스포츠 결승 결과", "콘솔 업데이트 발표",
    "게임 이용자 반응", "개발사 패치 예고", "신규 캐릭터 공개"
  ].map((title, index) => ({
    id: `historical-${index}`,
    title: `${title} ${index + 1}`,
    url: `https://historical-gaming.example.com/${index}`,
    category: "gaming",
    score: 300 - index,
    commentCount: 30 - index,
    publishedAt: new Date(atKst(`2026-08-10T18:${String(40 + index).padStart(2, "0")}:00`)).toISOString()
  }));
  const store = new FeedStore({ clock: () => new Date(nowMs).toISOString() });
  const source = new JsonSource("historical-gaming", async () => rows, "community");
  const engine = new FeedEngine(store, [source]);
  await engine.refresh();

  nowMs = atKst("2026-08-11T04:00:00");
  rows = Array.from({ length: 120 }, (_, index) => ({
    id: `current-${index}`,
    title: `새벽 게임 소식 ${index + 1}`,
    url: `https://current-gaming.example.com/${index}`,
    category: "gaming",
    score: 500 - index,
    commentCount: 50 - index,
    publishedAt: new Date(atKst(`2026-08-11T03:${String(index % 60).padStart(2, "0")}:00`)).toISOString()
  }));
  await engine.refresh();

  assert.equal(engine._cache.length, 100, "현재 노출 풀은 소스 상한 100건이어야 한다");
  assert.ok(engine._cache.every((item) => item.id.startsWith("current-")),
    "회귀 조건상 과거 글은 현재 상한 밖으로 밀려 있어야 한다");
  assert.equal(engine.poolRows().length, 106,
    "새 배치 소스 상한 100건과 과거 6건이 48시간 누적 풀에 함께 남아 있어야 한다");

  const edition = await engine.todayEdition({
    categories: ["gaming"],
    slotId: "evening",
    asOfMs: eveningAsOf,
    includeCandidates: true
  });
  assert.equal(edition.itemCount, 6);
  assert.equal(edition.candidateContract.metrics.categoryCandidateCounts.gaming, 6);
  assert.ok(edition.issues.length >= 3);
  assert.ok(edition.issues.every((issue) => issue.categoryIds.includes("gaming")));
  assert.equal(edition.categoryFulfillment.rows[0].state, "underfilled");
  assert.ok(edition.sections.flatMap((section) => section.items)
    .every((item) => item.id.startsWith("historical-")));
});

test("late backfill: 현재 상한 밖 과거 혼합게시판 글도 현재 분류 규칙으로 복원한다", async () => {
  const eveningAsOf = atKst("2026-08-10T19:00:00");
  let nowMs = atKst("2026-08-10T18:55:00");
  let rows = [{
    id: "historical-bobae-talk",
    title: "서운하다며 가족 단톡방을 나간 올케",
    url: "https://www.bobaedream.co.kr/view?code=best&No=1",
    category: "auto",
    publishedAt: new Date(atKst("2026-08-10T18:50:00")).toISOString()
  }];
  const store = new FeedStore({ clock: () => new Date(nowMs).toISOString() });
  const engine = new FeedEngine(store, [new JsonSource("bobae", async () => rows, "community")]);
  await engine.refresh();

  nowMs = atKst("2026-08-11T04:00:00");
  rows = Array.from({ length: 120 }, (_, index) => ({
    id: `current-bobae-${index}`,
    title: `그랜저 시승 후기 ${index}`,
    url: `https://www.bobaedream.co.kr/view?code=best&No=${index + 2}`,
    category: "auto",
    publishedAt: new Date(atKst("2026-08-11T03:30:00")).toISOString()
  }));
  await engine.refresh();

  assert.ok(engine._cache.every((item) => item.id !== "historical-bobae-talk"));
  const restored = await engine._itemsAsOf(eveningAsOf);
  const historical = restored.find((item) => item.id === "historical-bobae-talk");
  assert.ok(historical, "상한 밖 과거 글이 as-of 풀에서 복원되어야 한다");
  assert.equal(historical.category, "humor", "혼합게시판 원 등록값 auto가 과거판에 되살아나면 안 된다");
  assert.equal(historical.registryCategory, "auto");
});

test("카테고리 조합 재고: 같은 취향은 공유하고 사용자 식별자는 키에 넣지 않는다", () => {
  const store = new FeedStore();
  store.createUser("private-user-a");
  store.createUser("private-user-b");
  store.createUser("private-user-c");
  store.setBriefingCategories("private-user-a", ["tech", "business"]);
  store.setBriefingCategories("private-user-b", ["business", "tech"]);
  store.saveSurvey("private-user-c", { categories: ["humor"] });

  const segments = collectEditorialSegments(
    store,
    ["news", "business"],
    ["news", "business", "tech", "humor"]
  );
  assert.equal(segments.length, 6);
  assert.equal(
    segments.find((segment) => segment.key === "v30:business.tech").audienceCount,
    2
  );
  assert.ok(segments.every((segment) => segment.key.startsWith("v30:")));
  assert.doesNotMatch(JSON.stringify(segments), /private-user/);
});

test("재고 상태: 저장됐어도 발행 최소 조건을 못 채우면 완료와 분리한다", async () => {
  const store = new FeedStore();
  const receipt = await buildEditorialInventory({
    store,
    nowMs: atKst("2026-08-10T08:00:00"),
    defaultCategories: ["news"],
    knownCategoryIds: ["news"],
    buildEdition: async ({ categories, slotId, targetDate, asOfMs }) =>
      store.saveEditorialEdition(targetDate, slotId, editorialInventorySegmentKey(categories), {
        editionId: `${targetDate}-${slotId}`,
        generatedAt: new Date(asOfMs).toISOString(),
        publishable: false
      })
  });
  assert.equal(receipt.storedCount, 1);
  assert.equal(receipt.heldCount, 1);
  assert.equal(receipt.missingCount, 0);
  assert.equal(receipt.state, "inventory_complete_with_holds");
});

test("재고 관측 시각: 정시 판정에 큐 시작이 아니라 실제 완료 시각을 남긴다", async () => {
  const startedAt = atKst("2026-08-10T12:01:00");
  const completedAt = atKst("2026-08-10T12:12:00");
  const store = new FeedStore();
  const receipt = await buildEditorialInventory({
    store,
    nowMs: startedAt,
    clock: () => completedAt,
    defaultCategories: ["news"],
    knownCategoryIds: ["news"],
    buildEdition: async ({ categories, slotId, targetDate, asOfMs }) =>
      store.saveEditorialEdition(targetDate, slotId, editorialInventorySegmentKey(categories), {
        editionId: `${targetDate}-${slotId}`,
        generatedAt: new Date(asOfMs).toISOString(),
        publishable: true
      })
  });

  assert.equal(receipt.startedAt, new Date(startedAt).toISOString());
  assert.equal(receipt.completedAt, new Date(completedAt).toISOString());
  assert.equal(receipt.observedAt, receipt.completedAt);
  assert.equal(receipt.durationMs, 11 * 60 * 1000);
});

test("재고 백필: 저장판의 기사 요약이 만료됐으면 클릭 요청이 아니라 백그라운드 큐가 다시 준비한다", async () => {
  const nowMs = atKst("2026-08-10T08:00:00");
  const store = new FeedStore();
  const segmentKey = editorialInventorySegmentKey(["news"]);
  const saved = store.saveEditorialEdition("2026-08-10", "morning", segmentKey, {
    editionId: "morning-news",
    publishable: true,
    issues: [{ evidenceHash: "needs-summary" }]
  });
  const calls = [];
  const receipt = await buildEditorialInventory({
    store,
    nowMs,
    defaultCategories: ["news"],
    knownCategoryIds: ["news"],
    needsRefresh: (edition) => edition === saved,
    buildEdition: async (input) => {
      calls.push(input);
      return saved;
    }
  });

  assert.equal(receipt.builtCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].generationMode, "inventory_summary_warmup");
});

test("요약 워밍업: 제한 큐는 모든 분야의 현재판을 과거판보다 먼저 준비한다", async () => {
  const nowMs = atKst("2026-08-10T20:00:00");
  const store = new FeedStore();
  for (const category of ["news", "tech"]) {
    for (const slotId of ["morning", "lunch", "evening"]) {
      store.saveEditorialEdition("2026-08-10", slotId, editorialInventorySegmentKey([category]), {
        editionId: `${slotId}-${category}`,
        publishable: true,
        issues: [{ evidenceHash: `${slotId}-${category}-needs-summary` }]
      });
    }
  }

  const calls = [];
  await buildEditorialInventory({
    store,
    nowMs,
    defaultCategories: ["news"],
    knownCategoryIds: ["news", "tech"],
    batchLimit: 2,
    needsRefresh: () => true,
    buildEdition: async (input) => {
      calls.push(input);
      return store.getEditorialEdition(input.targetDate, input.slotId, editorialInventorySegmentKey(input.categories));
    }
  });

  assert.deepEqual(calls.map((call) => `${call.categories.join(".")}:${call.slotId}`), [
    "news:evening",
    "tech:evening"
  ]);
  assert.ok(calls.every((call) => call.generationMode === "inventory_summary_warmup"));
});

test("누락 재고 백필: 핵심 조합 우선·슬롯 계보 보존·v30 재시작 생존", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-inventory-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "feed.json");
  const store = new FeedStore({ file });
  store.createUser("shared-a");
  store.createUser("shared-b");
  store.setBriefingCategories("shared-a", ["business"]);
  store.setBriefingCategories("shared-b", ["business"]);

  const date = "2026-08-10";
  store.saveEditorialEdition(date, "morning", editionSegmentKey(["business"]), {
    editionId: "legacy-unversioned",
    publishable: true
  });

  const calls = [];
  const buildEdition = async ({ categories, slotId, targetDate, asOfMs }) => {
    calls.push({ categories, slotId, targetDate, asOfMs });
    return store.saveEditorialEdition(
      targetDate,
      slotId,
      editorialInventorySegmentKey(categories),
      {
        editionId: `${targetDate}-${slotId}-${categories.join(".")}`,
        generatedAt: new Date(asOfMs).toISOString(),
        publishable: true
      }
    );
  };

  const first = await buildEditorialInventory({
    store,
    buildEdition,
    nowMs: atKst("2026-08-10T20:00:00"),
    defaultCategories: ["news"],
    knownCategoryIds: ["news", "business"],
    batchLimit: 2
  });
  assert.equal(first.expectedCount, 6);
  assert.equal(first.builtCount, 2);
  assert.equal(first.backlogCount, 4);
  assert.deepEqual(calls.map((call) => call.slotId), ["morning", "lunch"],
    "우선 조합의 최신 판에 필요한 선행 슬롯을 시간순으로 만든다");
  assert.ok(calls.every((call) => call.categories.join(".") === "news"),
    "낮은 우선순위 조합의 과거 누락보다 기본 조합의 현재 계보를 먼저 완성한다");
  assert.equal(first.segmentCount, 2, "두 사용자의 같은 business 조합은 한 세그먼트다");

  const second = await buildEditorialInventory({
    store,
    buildEdition,
    nowMs: atKst("2026-08-10T20:00:00"),
    defaultCategories: ["news"],
    knownCategoryIds: ["news", "business"],
    batchLimit: 48
  });
  assert.equal(second.builtCount, 4);
  assert.equal(second.missingCount, 0);
  assert.equal(second.storedCount, 6);
  assert.equal(second.state, "inventory_complete");

  const reloaded = new FeedStore({ file });
  let rebuilt = 0;
  const afterRestart = await buildEditorialInventory({
    store: reloaded,
    buildEdition: async () => { rebuilt += 1; },
    nowMs: atKst("2026-08-10T20:00:00"),
    defaultCategories: ["news"],
    knownCategoryIds: ["news", "business"],
    batchLimit: 48
  });
  assert.equal(rebuilt, 0);
  assert.equal(afterRestart.storedCount, 6);
  assert.equal(afterRestart.missingCount, 0);
  assert.ok(reloaded.getEditorialEdition(date, "morning", "v30:business"));
  assert.equal(reloaded.getEditorialEdition(date, "morning", "business").editionId, "legacy-unversioned");
});

test("판본 버전 경계: v30 이전 슬롯이 없으면 같은 조합의 최신 구버전을 연속성 기준으로 읽는다", () => {
  const store = new FeedStore();
  const date = "2026-08-11";
  const order = ["morning", "lunch", "evening"];
  store.saveEditorialEdition(date, "morning", "v25:business", {
    editionId: "morning-v25",
    editionSegment: { key: "v25:business", baseKey: "business", snapshotVersion: "v25" }
  });

  const fallback = store.priorCompatibleEditorialEditions(
    date,
    "lunch",
    "v30:business",
    "business",
    order,
    3
  );
  assert.deepEqual(fallback.map((edition) => edition.editionId), ["morning-v25"]);

  store.saveEditorialEdition(date, "morning", "v30:business", {
    editionId: "morning-v30",
    editionSegment: { key: "v30:business", baseKey: "business", snapshotVersion: "v30" }
  });
  const exact = store.priorCompatibleEditorialEditions(
    date,
    "lunch",
    "v30:business",
    "business",
    order,
    3
  );
  assert.deepEqual(exact.map((edition) => edition.editionId), ["morning-v30"]);
});
