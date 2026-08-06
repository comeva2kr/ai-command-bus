// 우리가 직접 올리는 딜 (애드핏 P0-A ①, David 2026-08-06).
//
// 애드핏 4차 반려: "자체 콘텐츠가 아닌 외부 콘텐츠, 외부 링크가 많은 비중을
// 차지하고 있는 매체는 광고 게재가 허용되지 않습니다."
//
// 커뮤니티에서 긁어 온 딜은 아웃링크다. 우리가 고르고 우리가 쓴 상품 소개는
// 자체 콘텐츠이고 링크도 제휴 링크다 — 정책의 모든 조항을 통과한다.
import { test } from "node:test";
import assert from "node:assert/strict";

const ADMIN = { "content-type": "application/json", "x-admin-token": "t" };

async function withServer(fn) {
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "t";
  const { createServer } = await import("../src/feed/server.js");
  const srv = createServer({});
  await new Promise((r) => srv.listen(0, r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); }
  finally { srv.close(); if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev; }
}

const good = {
  url: "https://link.coupang.com/a/abc123", title: "쿠팡 테스트 상품 세트",
  price: "39,900원", note: "골라본 이유 한 줄", category: "life", dest: "fresh"
};

test("남의 링크는 등록되지 않는다 — 제휴 링크만", async () => {
  await withServer(async (B) => {
    const r = await fetch(`${B}/api/admin/our-deal`, {
      method: "POST", headers: ADMIN,
      body: JSON.stringify({ ...good, url: "https://example.com/x" })
    });
    assert.equal(r.status, 400, "아무 링크나 우리 딜로 올라간다");
  });
});

test("가격 없이는 등록되지 않는다 — 지어낼 수 없는 값이다", async () => {
  // 쿠팡 짧은 링크는 Akamai 봇 차단 + JS 리다이렉트라 서버가 상품 정보를 뽑을
  // 수 없다(2026-08-06 실측). 상품 페이지를 긁는 것은 우리 원칙에 어긋난다.
  // 그래서 입력받고, 없으면 거절한다 — 실측 안 된 숫자는 쓰지 않는다.
  await withServer(async (B) => {
    const { price, ...noPrice } = good;
    void price;
    const r = await fetch(`${B}/api/admin/our-deal`, {
      method: "POST", headers: ADMIN, body: JSON.stringify(noPrice)
    });
    assert.equal(r.status, 400);
  });
});

test("입력 오류는 400이지 500이 아니다", async () => {
  // 500으로 던지면 화면이 "서버 고장"으로 읽는다.
  await withServer(async (B) => {
    for (const body of [{}, { url: "https://link.coupang.com/a/x" }, { ...good, title: "짧음" }]) {
      const r = await fetch(`${B}/api/admin/our-deal`, {
        method: "POST", headers: ADMIN, body: JSON.stringify(body)
      });
      assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status}`);
    }
  });
});

test("관리자 인증 없이는 등록할 수 없다", async () => {
  await withServer(async (B) => {
    const r = await fetch(`${B}/api/admin/our-deal`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(good)
    });
    assert.equal(r.status, 401);
  });
});

test("등록한 딜이 피드에 자체 콘텐츠로 나오고, 대가성 문구가 붙는다", async () => {
  await withServer(async (B) => {
    const c = await fetch(`${B}/api/admin/our-deal`, {
      method: "POST", headers: ADMIN, body: JSON.stringify(good)
    });
    assert.equal(c.status, 200);

    const s = await (await fetch(`${B}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    })).json();
    const f = await (await fetch(`${B}/api/feed?userId=${s.userId}&limit=30`)).json();
    const mine = (f.items || []).find((x) => x.via === "ourdeal");
    assert.ok(mine, "등록한 딜이 피드에 안 나온다");
    assert.equal(mine.title, good.title);
    assert.equal(mine.isDeal, true, "딜로 판정되지 않는다 — 딜 규칙(간격·상한)을 안 탄다");
    // 쿠팡 파트너스 대가성 문구는 우리가 수수료를 받는 링크에 **반드시** 붙는다.
    assert.ok(mine.disclosure && mine.disclosure.includes("쿠팡 파트너스"),
      "대가성 문구가 없다 — 파트너스 의무 위반이다");
    assert.equal(mine.affiliate, true);
  });
});

test("커뮤니티에서 온 딜에는 대가성 문구를 붙이지 않는다", async () => {
  // 남의 글을 소개하는 것이라 우리가 수수료를 받는 링크가 아니다.
  // 둘을 섞으면 거짓 고지가 된다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const { FeedStore } = await import("../src/feed/store.js");
  const items = [{
    id: "x1", title: "[네이버] 한돈 등뼈 (13,960원/무료)", url: "https://www.ppomppu.co.kr/x",
    source: "ppomppu-deal", tags: [], topics: [], summary: "", category: "life", lang: "ko"
  }];
  const store = new FeedStore();
  const engine = new FeedEngine(store, [{ id: "ppomppu-deal", kind: "community", async fetch() { return items; } }]);
  const pool = await engine._items();
  const one = pool.find((i) => i.id === "x1");
  assert.ok(one, "수집 딜이 풀에 없다");
  assert.equal(one.isDeal, true);
  assert.ok(!one.disclosure, "커뮤니티 딜에 대가성 문구가 붙었다 — 거짓 고지다");
  assert.ok(!one.affiliate, "커뮤니티 딜이 제휴로 표시됐다");
});

test("등록한 딜을 내릴 수 있다", async () => {
  await withServer(async (B) => {
    const c = await (await fetch(`${B}/api/admin/our-deal`, {
      method: "POST", headers: ADMIN, body: JSON.stringify(good)
    })).json();
    const del = await (await fetch(`${B}/api/admin/our-deal-delete`, {
      method: "POST", headers: ADMIN, body: JSON.stringify({ id: c.deal.id })
    })).json();
    assert.equal(del.ok, true);
    const list = await (await fetch(`${B}/api/admin/our-deals`, { headers: ADMIN })).json();
    assert.equal(list.deals.length, 0);
  });
});
