// 재시작 콜드 스타트 방지 — 수집 풀을 디스크에 남긴다.
//
// David 2026-08-06: "관리자 페이지에서 대시보드 로딩시간이 갑자기 엄청 길어졌어."
// 실측(VM 로그): 컨테이너 시작 00:23:33 → 수집 완료 00:25:59, **2분 26초**.
// 풀이 메모리에만 있어서 재시작하면 첫 요청이 84개 소스 수집을 전부 기다렸다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "nh-pool-"));

// 수집이 오래 걸리는 소스를 흉내낸다 — 되살리기가 이걸 기다리지 않아야 한다.
function slowSource(delayMs, id = "slow") {
  return {
    id,
    kind: "community",
    async fetch() {
      await new Promise((r) => setTimeout(r, delayMs));
      return [{ id: `${id}-1`, title: "느리게 온 글", url: "https://example.com/1", source: id }];
    }
  };
}

test("풀을 저장하고, 재시작하면 수집을 기다리지 않고 바로 뜬다", async () => {
  const dir = tmpdir();
  const file = path.join(dir, "store.json");
  const poolFile = path.join(dir, "store-pool.json");

  const store = new FeedStore({ file });
  const engine = new FeedEngine(store, [slowSource(30)]);
  await engine.refresh();
  assert.ok(fs.existsSync(poolFile), "풀 파일이 안 만들어졌다");

  // 새 프로세스가 뜬 상황: 같은 파일, 아주 느린 소스.
  const store2 = new FeedStore({ file });
  const engine2 = new FeedEngine(store2, [slowSource(5000)]);
  const t0 = Date.now();
  const items = await engine2._items();
  const took = Date.now() - t0;
  assert.ok(items.length > 0, "되살린 풀이 비었다");
  assert.ok(took < 1000, `${took}ms 걸렸다 — 수집을 기다리고 있다`);
});

test("너무 오래된 풀은 되살리지 않는다 — 만료된 글로 첫 화면을 채우면 안 된다", async () => {
  const dir = tmpdir();
  const file = path.join(dir, "store.json");
  const poolFile = path.join(dir, "store-pool.json");
  fs.writeFileSync(poolFile, JSON.stringify({
    savedAt: Date.now() - 48 * 3600 * 1000,
    rows: [{ item: { id: "old", title: "이틀 전 글", source: "x" }, firstSeenAt: 0 }]
  }));
  const engine = new FeedEngine(new FeedStore({ file }), [slowSource(10)]);
  assert.equal(engine._loadPool(), false, "이틀 지난 풀을 되살렸다");
});

test("풀 파일이 깨져 있어도 서비스는 뜬다", async () => {
  const dir = tmpdir();
  const file = path.join(dir, "store.json");
  fs.writeFileSync(path.join(dir, "store-pool.json"), "{깨진 JSON");
  const engine = new FeedEngine(new FeedStore({ file }), [slowSource(10)]);
  assert.equal(engine._loadPool(), false);
  const items = await engine._items();   // 되살리기 실패 → 정상 수집으로 내려간다
  assert.ok(Array.isArray(items));
});
