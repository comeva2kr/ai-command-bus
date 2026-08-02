// 수집 경로가 프로세스를 죽이지 않는지 — 2026-08-02 로컬 FEED_LIVE 기동에서
// 서버가 실제로 사망한 경로의 회귀 방지.
//
// 증상: `DOMException [TimeoutError]: The operation was aborted due to timeout`
// 하나로 프로세스 전체가 내려갔다. 스택에 앱 프레임이 하나도 없어서(중단 타이머
// 프레임뿐) 어느 코드가 범인인지 로그만 봐서는 알 수 없었다.
//
// 원인: AbortSignal.timeout()을 붙인 fetch에서 `!res.ok`로 조기 반환할 때
// 본문 스트림을 소비도 취소도 하지 않았다. 8초 뒤 타임아웃이 그 스트림을
// 중단시키면서 아무도 잡지 않는 거부가 생기고, Node 22는 그 순간 죽는다.
// 403이 나오는 소스마다 8초 뒤 1건씩 발생한다 — 우리 소스 목록에는 403이 흔하다.
import test from "node:test";
import assert from "node:assert/strict";

import { discardBody } from "../src/feed/fetchers.js";
import { fetchXTrends } from "../src/feed/trends.js";
import { fetchOgMeta } from "../src/feed/enrich.js";

// 헤더는 도착했지만 본문은 소비되지 않은 응답. cancel()이 불렸는지 기록한다.
function responseWithDanglingBody(status = 403) {
  const state = { cancelled: false };
  return {
    state,
    res: {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      body: { cancel: async () => { state.cancelled = true; } },
      text: async () => { throw new Error("본문을 읽으면 안 되는 경로다"); },
      arrayBuffer: async () => { throw new Error("본문을 읽으면 안 되는 경로다"); }
    }
  };
}

test("discardBody: 소비되지 않은 본문을 취소한다 (타임아웃 중단 거부 차단)", async () => {
  const { res, state } = responseWithDanglingBody();
  discardBody(res);
  await new Promise((r) => setImmediate(r));
  assert.equal(state.cancelled, true, "본문을 취소하지 않으면 8초 뒤 프로세스가 죽는다");
});

test("discardBody: 본문이 없거나 이미 소비됐어도 던지지 않는다", () => {
  // 방어 코드가 스스로 새 예외를 만들면 고치려던 병을 그대로 재현하는 셈이다
  for (const bad of [null, undefined, {}, { body: null }, { body: {} },
                     { body: { cancel: () => { throw new Error("already used"); } } }]) {
    assert.doesNotThrow(() => discardBody(bad));
  }
});

test("trends: 403이면 본문을 취소하고 null (우회하지 않는다)", async () => {
  const { res, state } = responseWithDanglingBody(403);
  const out = await fetchXTrends({ fetchImpl: async () => res });
  assert.equal(out, null, "403은 우회 없이 포기 — David 확정 방침");
  await new Promise((r) => setImmediate(r));
  assert.equal(state.cancelled, true, "403 응답 본문이 방치되면 그게 크래시 원인이다");
});

test("enrich: 403이면 본문을 취소하고 빈 메타", async () => {
  const { res, state } = responseWithDanglingBody(403);
  const out = await fetchOgMeta("https://example.com/x", { fetchImpl: async () => res });
  assert.ok(out && !out.image, "403에서 이미지를 만들어내면 안 된다");
  await new Promise((r) => setImmediate(r));
  assert.equal(state.cancelled, true);
});

test("서버 진입점에 unhandledRejection·uncaughtException 방어망이 있다", async () => {
  // 떠 있는 것이 이 서비스의 일이다. 수집기 하나의 실수로 프로세스가 내려가면
  // 컨테이너가 재시작하는 동안 모든 요청이 실패한다 — 실사용자 제보였던
  // "가끔 불러오기 실패"와 증상이 같다. 삼키지 않고 크게 로그로 남긴다.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "server.js"), "utf8");
  const entry = src.slice(src.indexOf('process.argv[1].endsWith("server.js")'));
  for (const ev of ["unhandledRejection", "uncaughtException"]) {
    assert.match(entry, new RegExp(`process\\.on\\("${ev}"`), `${ev} 핸들러가 있어야 한다`);
  }
  assert.match(entry, /console\.error/, "조용히 삼키면 원인을 영영 못 찾는다");
});
