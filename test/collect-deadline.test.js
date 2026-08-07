import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/feed/content.js";

// 2026-08-07 라이브 사고 — 서비스가 새 글을 못 받고 있었다.
//
// 증상: "[feed] 기동 직후 첫 수집 시작" 로그가 찍힌 뒤 **9분이 지나도
// 완료도 실패도 없었다.** 풀 저장 시각은 142분째 그대로였고, 소스 설정을
// 아무리 고쳐 배포해도 반영되지 않았다.
//
// 원인: collect()가 s.fetch()를 **데드라인 없이** await 했다. allSettled
// 방식이라 거절은 잡지만 **매달림은 못 잡는다** — 거절되지 않는 프로미스는
// 영원히 pending이다. 개별 fetcher가 각자 타임아웃을 걸든 말든(거는 것도
// 있고 안 거는 것도 있다), 번역까지 감싸인 소스는 아이템마다 번역기를
// 부르므로 한 소스가 수 분씩 매달릴 수 있다.
//
// 소스 하나의 사정이 나머지 106곳을 볼모로 잡으면 안 된다.

test("소스 하나가 매달려도 나머지로 진행한다", async () => {
  const hang = { id: "hang", kind: "news", async fetch() { return new Promise(() => {}); } };
  const ok = { id: "ok", kind: "news", async fetch() { return [{ title: "살아있는 글", url: "https://example.org/1" }]; } };
  const t0 = Date.now();
  const r = await collect([hang, ok], { sourceTimeoutMs: 300 });
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `데드라인이 안 걸렸다 — ${ms}ms 걸림`);
  assert.equal(r.items.length, 1, "살아 있는 소스의 글은 들어와야 한다");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /timeout/i);
  assert.equal(r.errors[0].source, "hang");
});

test("데드라인 타이머를 unref 하지 않는다 — 안 그러면 안 터진다", async () => {
  // 작성 직후 로컬 검증에서 바로 드러난 것: unref된 타이머는 이벤트 루프를
  // 붙잡지 않아서, 매달린 fetch 말고 할 일이 없으면 **타이머가 터지기 전에
  // 프로세스가 끝난다.** 데드라인이 있으나 마나였다.
  // 이 테스트는 매달린 소스 하나만 두고 실제로 거절이 오는지 본다.
  const hang = { id: "only-hang", kind: "news", async fetch() { return new Promise(() => {}); } };
  const r = await collect([hang], { sourceTimeoutMs: 200 });
  assert.equal(r.items.length, 0);
  assert.equal(r.errors.length, 1, "매달린 소스만 있을 때도 데드라인이 터져야 한다");
});

test("정상 소스는 데드라인의 영향을 받지 않는다", async () => {
  const fast = { id: "fast", kind: "news", async fetch() { return [{ title: "빠른 글", url: "https://example.org/2" }]; } };
  const r = await collect([fast], { sourceTimeoutMs: 5000 });
  assert.equal(r.items.length, 1);
  assert.equal(r.errors.length, 0);
});

test("데드라인 0/음수면 끄고 예전처럼 동작한다", async () => {
  const fast = { id: "fast", kind: "news", async fetch() { return [{ title: "글", url: "https://example.org/3" }]; } };
  const r = await collect([fast], { sourceTimeoutMs: 0 });
  assert.equal(r.items.length, 1);
  assert.equal(r.errors.length, 0);
});
