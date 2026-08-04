// 캐시 헤더 — 없으면 "배포했는데 사용자에겐 안 닿는" 침묵 실패가 난다.
//
// 2026-08-04 실사고: 메뉴 버튼 회귀를 고쳐 배포하고 서버에서 정상 동작까지
// 확인했는데도 David 폰에서는 여전히 안 눌렸다. 서버는 멀쩡했고 폰이 옛
// 번들을 쓰고 있었다. 원인은 Cache-Control·ETag가 **아예 없어서** 브라우저가
// 자체 판단으로 캐시한 것이었다. 특히 /sw.js가 HTTP 캐시에서 나오면 브라우저가
// 새 서비스워커의 존재를 모르고, 옛 워커가 계속 옛 화면을 서빙한다.
//
// 배포 검증(HTTP 200·렌더 확인)으로는 절대 못 잡는 클래스라 테스트로 못 박는다.
import { test } from "node:test";
import assert from "node:assert/strict";

async function withServer(fn) {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); }
  finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

test("서비스워커와 HTML은 매번 재검증한다", async () => {
  await withServer(async (base) => {
    for (const p of ["/sw.js", "/", "/manifest.webmanifest"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get("cache-control"), "no-cache",
        `${p}에 no-cache가 없다 — 브라우저가 옛 버전을 붙들 수 있다`);
      assert.ok(r.headers.get("etag"), `${p}에 ETag가 없다 — 재검증할 근거가 없다`);
      await r.text();
    }
  });
});

test("안 바뀐 파일은 304로 응답한다", async () => {
  // no-cache는 "캐시하지 마라"가 아니라 "매번 물어봐라"다. 안 바뀌었으면
  // 304로 본문을 안 보내야 트래픽이 늘지 않는다.
  await withServer(async (base) => {
    const first = await fetch(base + "/sw.js");
    const etag = first.headers.get("etag");
    await first.text();
    const second = await fetch(base + "/sw.js", { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304, "재요청이 304가 아니다");
  });
});

test("ETag는 주입 후 최종 바이트 기준이다", async () => {
  // 파일 mtime으로 ETag를 만들면 시드 주입·애드센스 태그가 바뀌어도 같은
  // ETag가 나가서 304로 옛 화면이 남는다. 실제 응답 본문이 기준이어야 한다.
  await withServer(async (base) => {
    const r = await fetch(base + "/");
    const body = await r.text();
    const etag = r.headers.get("etag");
    const { createHash } = await import("node:crypto");
    const expect = '"' + createHash("sha1").update(Buffer.from(body)).digest("base64").slice(0, 22) + '"';
    assert.equal(etag, expect, "ETag가 응답 본문과 무관하게 계산됐다");
  });
});

test("아이콘·이미지는 오래 캐시한다", async () => {
  // 매번 재검증하면 느려진다. 자주 안 바뀌는 것은 길게 잡는다.
  await withServer(async (base) => {
    const r = await fetch(base + "/icon.svg");
    assert.match(r.headers.get("cache-control") || "", /max-age=\d{5,}/);
    await r.text();
  });
});
