// 한 번 온 사람을 알아본다 (David 2026-08-06: "한번 쓴 사람은 무조건 잡아둘 수 있어야 해").
//
// 실측: 세션 287건 중 새 신원이 162건(57%)이고 쿠키로 알아본 것은 51건(18%).
// 원인은 구조였다 — 기기 쿠키(nh_cid)는 **계정**을 담아서 계정이 만들어지는
// 시점(/api/session)에만 심긴다. 검색으로 발행 페이지에 도착해 읽고 나간 사람은
// 아무 표식도 못 받고, 다음에 와도 처음 보는 사람이 된다.
// 취향을 아무리 잘 파악해도 다음 방문에 못 알아보면 전부 날아간다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FeedStore } from "../src/feed/store.js";

const listen = async () => {
  const { createServer } = await import("../src/feed/server.js");
  const srv = createServer({});
  await new Promise((r) => srv.listen(0, r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
};
const vidOf = (res) => {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  return (sc.join(";").match(/nh_vid=([a-f0-9]+)/) || [])[1] || null;
};

test("발행 페이지에서도 표식이 심긴다", async () => {
  // 처음엔 정적 파일 서빙 직전에 호출을 뒀는데, /briefing 같은 발행 페이지는
  // 그보다 위에서 응답하고 끝나 표식이 안 심겼다. 라우트 분기보다 앞이어야 한다.
  const { srv, base } = await listen();
  try {
    for (const path of ["/", "/briefing", "/report"]) {
      assert.ok(vidOf(await fetch(`${base}${path}`)), `${path}에서 표식이 안 심겼다`);
    }
  } finally { srv.close(); }
});

test("API 응답에는 심지 않는다 — 사람이 보는 화면만", async () => {
  const { srv, base } = await listen();
  try {
    assert.equal(vidOf(await fetch(`${base}/api/health`)), null);
  } finally { srv.close(); }
});

test("표식만 들고 다시 오면 같은 사람이다", async () => {
  // localStorage가 날아가도(브라우저 정리·사파리 ITP) 이어져야 한다.
  const { srv, base } = await listen();
  try {
    const vid = vidOf(await fetch(`${base}/briefing`));
    const mk = () => fetch(`${base}/api/session`, {
      method: "POST", headers: { "content-type": "application/json", cookie: `nh_vid=${vid}` }, body: "{}"
    }).then((r) => r.json());
    const first = await mk();
    const again = await mk();
    assert.equal(again.userId, first.userId, "같은 표식인데 다른 사람이 됐다");
    assert.equal(again.identitySource, "visitor", `신원 출처가 ${again.identitySource}`);
  } finally { srv.close(); }
});

test("계정 쿠키를 심을 때 표식 쿠키를 덮어쓰지 않는다", async () => {
  // setHeader는 배열을 갈아 끼운다 — 방금 심은 표식이 통째로 날아갈 뻔했다.
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /const prevSet = res\.getHeader\("set-cookie"\)/,
    "기존 set-cookie를 안 이어붙인다");
  assert.ok(!/^\s*res\.setHeader\("set-cookie", setCookies\);$/m.test(src),
    "여전히 통째로 덮어쓴다");
});

test("표식만으로는 계정이 늘지 않는다", () => {
  // 발행 페이지 방문자마다 계정을 만들면 빈 계정이 방문자 수만큼 쌓인다.
  const store = new FeedStore();
  store.linkVisitor("vid_abc", "user_nope");
  assert.equal(store.visitorUser("vid_abc"), null, "없는 계정을 묶었다");
  assert.equal(store.users.size, 0, "표식이 계정을 만들었다");
});

test("표식 연결은 요청을 막지 않는다", () => {
  // 방문마다 일어나는 기록이다. 요청마다 스토어 전체를 동기로 쓰면
  // 홈 TTFB 4초 사고의 재판이 된다.
  const src = readFileSync("src/feed/store.js", "utf8");
  const fn = src.slice(src.indexOf("  linkVisitor("), src.indexOf("  visitorUser("));
  assert.match(fn, /_persistSoon\(\)/, "즉시 저장이다");
});

test("2년짜리 쿠키를 무고지로 심지 않는다", () => {
  const privacy = readFileSync("src/feed/public/privacy.html", "utf8");
  assert.match(privacy, /nh_vid/, "개인정보처리방침에 고지가 없다");
  assert.match(privacy, /방문자 표식 쿠키[\s\S]{0,200}2년/, "보유기간 고지가 없다");
});
