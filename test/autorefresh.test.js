import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 2026-08-07 라이브에서 잡은 사고.
//
// 증상: 풀 저장 시각이 **97분째 그대로**였고, 컨테이너 로그에 수집 줄이 한 줄도
// 없었다(기동 로그 3줄이 전부). 새 소스 설정을 고쳐 배포해도 반영되지 않았다.
//
// 원인: startAutoRefresh가 setInterval만 걸었다. 재시작할 때마다 주기
// (운영 FEED_REFRESH_MS=900000 = 15분)를 **처음부터 다시** 기다린다.
// 배포 간격이 그보다 짧으면 수집이 **한 번도 돌지 않는다.** 그날 배포를
// 12번 넘게 했다.
//
// staging.mjs 주석에 "수집이 끝나기 전에 재배포로 컨테이너가 재시작되기를
// 반복했다"고 적어 뒀는데, 실제 구조는 그보다 나빴다 —
// **끝나기 전에 끊긴 게 아니라 시작조차 안 했다.**

test("startAutoRefresh: 기동 직후 한 번 바로 수집한다", async () => {
  let calls = 0;
  const src = { async fetch() { calls++; return []; } };
  const engine = new FeedEngine(null, [src]);
  // 주기를 아주 길게 준다 — 즉시 1회가 없으면 이 테스트 동안 절대 안 돈다.
  engine.startAutoRefresh(60 * 60 * 1000);
  await new Promise((r) => setTimeout(r, 200));
  engine.stopAutoRefresh();
  assert.ok(calls >= 1, `기동 직후 수집이 돌지 않았다 (호출 ${calls}회)`);
});

test("startAutoRefresh: 첫 수집이 실패해도 타이머가 살아 있다", async () => {
  // 실패를 삼키는 동작은 예전과 같다 — 한 번 실패해도 다음 주기가 온다.
  let calls = 0;
  const src = { async fetch() { calls++; throw new Error("네트워크 실패"); } };
  const engine = new FeedEngine(null, [src]);
  const stop = engine.startAutoRefresh(60 * 60 * 1000);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(calls >= 1);
  assert.ok(engine._timer, "첫 수집 실패로 주기 타이머가 사라지면 안 된다");
  stop();
  assert.equal(engine._timer, null);
});

test("stopAutoRefresh 뒤에는 더 돌지 않는다", async () => {
  let calls = 0;
  const src = { async fetch() { calls++; return []; } };
  const engine = new FeedEngine(null, [src]);
  engine.startAutoRefresh(50);
  await new Promise((r) => setTimeout(r, 120));
  engine.stopAutoRefresh();
  const after = calls;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(calls, after, "멈춘 뒤에도 수집이 돌았다");
});

test("본문 보강이 영구 대기해도 수집분을 저장하고 다음 사이클을 실행한다", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-refresh-deadline-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  let signal;
  let checkpointCount = null;
  const engine = new FeedEngine(null, [{ id: "test-news", kind: "news", fetch: async () => {
    calls += 1;
    return [{ id: `new-${calls}`, source: "test-news", kind: "news", category: "science",
      title: "새로운 우주 관측 결과를 발표한 연구팀", url: `https://example.com/${calls}`,
      publishedAt: new Date().toISOString() }];
  } }]);
  engine._poolFile = path.join(dir, "pool.json");
  engine._enrichmentTimeoutMs = 15;
  engine._enricher = { enrich: (_, options) => {
    checkpointCount = fs.existsSync(engine._poolFile) ? JSON.parse(fs.readFileSync(engine._poolFile)).rows.length : -1;
    signal = options?.signal;
    return new Promise(() => {});
  } };
  let timer;
  const first = await Promise.race([engine.refresh(), new Promise(resolve => {
    timer = setTimeout(() => resolve("STALLED"), 300);
  })]);
  clearTimeout(timer);
  assert.notEqual(first, "STALLED", "멈춘 보강 작업이 refresh 잠금을 영구 유지하면 안 된다");
  assert.equal(signal.aborted, true);
  assert.equal(checkpointCount, 1, "본문 보강을 시작하기 전에 수집분이 저장돼야 한다");
  assert.equal(engine._refreshing, null);
  assert.equal(JSON.parse(fs.readFileSync(engine._poolFile)).rows.length, 1);
  engine._enricher = null;
  await engine.refresh();
  assert.equal(calls, 2);
  assert.equal(JSON.parse(fs.readFileSync(engine._poolFile)).rows.length, 2);
});

test("발췌 번역이 멈춰도 다음 수집을 허용하고 늦은 결과로 기사를 바꾸지 않는다", async () => {
  const item = { id: "translation-pending", source: "test-news", kind: "news", category: "science",
    title: "새로운 우주 연구 결과를 공개한 과학자", url: "https://example.com/translation",
    publishedAt: new Date().toISOString(), summary: "Astronomers publish a new discovery", originalLang: "en" };
  const engine = new FeedEngine(null, [{ id: "test-news", kind: "news", fetch: async () => [item] }]);
  engine._enricher = { enrich: async () => {} };
  engine._summaryTranslationTimeoutMs = 15;
  let finish;
  engine._translateText = () => new Promise(resolve => { finish = resolve; });
  let timer;
  const result = await Promise.race([engine.refresh(), new Promise(resolve => {
    timer = setTimeout(() => resolve("STALLED"), 300);
  })]);
  clearTimeout(timer);
  assert.notEqual(result, "STALLED");
  assert.equal(engine._refreshing, null);
  assert.equal(item.summary, "", "실패한 발췌 번역은 기존 원문 fallback처럼 비워야 한다");
  finish("늦게 도착한 한국어 번역");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(item.summary, "", "마감 뒤 번역이 저장된 기사를 덮으면 안 된다");
});
