import test from "node:test";
import assert from "node:assert/strict";
import { FeedEngine } from "../src/feed/engine.js";

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
