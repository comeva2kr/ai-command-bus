// Social login (src/feed/auth.js + the /api/auth/* wiring in server.js).
//
// Covers: state CSRF rejection, provider env-var gating (and the resulting
// full anonymous regression when no provider is configured), per-provider
// userinfo normalization against mocked fetch responses (no network), the
// anonymous -> logged-in taste succession that's the whole point of this
// feature, and session cookie issue/expiry/logout.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDERS,
  providerConfig,
  enabledProviders,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  completeOAuth,
  AuthStateStore,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE
} from "../src/feed/auth.js";
import { FeedStore } from "../src/feed/store.js";

const fixedClock = () => "2026-07-06T00:00:00.000Z";

// ---- provider config / env-var gating ----

test("providerConfig requires BOTH client id and secret; missing either disables the provider", () => {
  assert.equal(providerConfig("google", {}), null, "no env vars at all");
  assert.equal(providerConfig("google", { GOOGLE_CLIENT_ID: "id" }), null, "secret missing");
  assert.equal(providerConfig("google", { GOOGLE_CLIENT_SECRET: "s" }), null, "id missing");
  const cfg = providerConfig("google", { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" });
  assert.ok(cfg);
  assert.equal(cfg.clientId, "id");
  assert.equal(cfg.clientSecret, "s");
  assert.equal(providerConfig("not-a-real-provider", { X: "1" }), null, "unknown provider id");
});

test("enabledProviders returns [] with zero env vars set, and only the configured subset otherwise", () => {
  assert.deepEqual(enabledProviders({}), []);
  assert.deepEqual(enabledProviders({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" }), ["google"]);
  const all = enabledProviders({
    GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs",
    KAKAO_CLIENT_ID: "k", KAKAO_CLIENT_SECRET: "ks",
    NAVER_CLIENT_ID: "n", NAVER_CLIENT_SECRET: "ns"
  });
  assert.deepEqual(all.sort(), ["google", "kakao", "naver"]);
});

test("buildAuthorizeUrl includes client_id/redirect_uri/response_type=code/state/scope", () => {
  const cfg = providerConfig("google", { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret" });
  const target = new URL(buildAuthorizeUrl(cfg, { state: "abc123", redirectUri: "https://nowhot.kr/api/auth/google/callback" }));
  assert.equal(target.origin + target.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(target.searchParams.get("client_id"), "gid");
  assert.equal(target.searchParams.get("redirect_uri"), "https://nowhot.kr/api/auth/google/callback");
  assert.equal(target.searchParams.get("response_type"), "code");
  assert.equal(target.searchParams.get("state"), "abc123");
  assert.equal(target.searchParams.get("scope"), "openid profile");
});

// ---- CSRF state ----

test("AuthStateStore: a forged/unknown state is rejected", () => {
  const states = new AuthStateStore();
  states.issue("google", "user_1");
  assert.equal(states.consume("never-issued-forged-value"), null);
  assert.equal(states.consume(""), null);
  assert.equal(states.consume(null), null);
});

test("AuthStateStore: state is single-use — a replayed callback is rejected on the second attempt", () => {
  const states = new AuthStateStore();
  const state = states.issue("kakao", "user_9");
  const first = states.consume(state);
  assert.ok(first);
  assert.equal(first.provider, "kakao");
  assert.equal(first.anonymousUserId, "user_9");
  const replay = states.consume(state);
  assert.equal(replay, null, "second consume of the same state must fail");
});

test("AuthStateStore: an expired state is rejected", () => {
  const states = new AuthStateStore();
  const t0 = Date.parse("2026-07-06T00:00:00.000Z");
  const state = states.issue("naver", null, t0);
  // consumed 11 minutes later — past the 10-minute TTL
  const late = t0 + 11 * 60 * 1000;
  assert.equal(states.consume(state, late), null);
});

test("AuthStateStore.issue carries a null anonymousUserId through when none was supplied", () => {
  const states = new AuthStateStore();
  const state = states.issue("google", null);
  const entry = states.consume(state);
  assert.equal(entry.anonymousUserId, null);
});

// ---- cookies ----

test("parseCookies splits a Cookie header into a key->value map", () => {
  assert.deepEqual(parseCookies(`${SESSION_COOKIE}=abc123; feed_topics=%5B%5D`), {
    [SESSION_COOKIE]: "abc123",
    feed_topics: "[]"
  });
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test("serializeSessionCookie/clearSessionCookie carry HttpOnly + SameSite=Lax always, Secure only when requested", () => {
  const httpsCookie = serializeSessionCookie("tok", { secure: true });
  assert.match(httpsCookie, /HttpOnly/);
  assert.match(httpsCookie, /SameSite=Lax/);
  assert.match(httpsCookie, /Secure/);
  assert.match(httpsCookie, /Max-Age=2592000/, "30 days");

  const httpCookie = serializeSessionCookie("tok", { secure: false });
  assert.doesNotMatch(httpCookie, /Secure/, "no Secure over plain http — a real browser would drop the cookie entirely");

  const cleared = clearSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
});

// ---- per-provider userinfo normalization (mocked fetch, no network) ----

function fakeFetchFor(provider) {
  return async (url) => {
    const u = String(url);
    if (u === PROVIDERS[provider].tokenUrl) {
      return { ok: true, async json() { return { access_token: `${provider}-token` }; } };
    }
    if (u === PROVIDERS[provider].userinfoUrl) {
      if (provider === "google") {
        return { ok: true, async json() {
          return { sub: "g-42", name: "홍길동", picture: "https://lh3.googleusercontent.com/a/x", email: "should-never-be-read@example.com" };
        } };
      }
      if (provider === "kakao") {
        return { ok: true, async json() {
          return { id: 998877, kakao_account: { profile: { nickname: "카카오유저", profile_image_url: "https://k.kakaocdn.net/x.jpg" }, email: "leak@example.com" } };
        } };
      }
      if (provider === "naver") {
        return { ok: true, async json() {
          return { response: { id: "nvr-1", nickname: "네이버유저", profile_image: "https://ssl.pstatic.net/x.jpg", email: "leak2@example.com" } };
        } };
      }
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

test("google userinfo normalizes sub/name/picture into {providerUserId, nickname, avatar}, email never read", async () => {
  const cfg = providerConfig("google", { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" });
  const profile = await completeOAuth("google", cfg, { code: "c", redirectUri: "https://x/cb" }, { fetchImpl: fakeFetchFor("google") });
  assert.deepEqual(profile, { providerUserId: "g-42", nickname: "홍길동", avatar: "https://lh3.googleusercontent.com/a/x" });
  assert.ok(!("email" in profile), "normalize() must never surface email");
});

test("kakao userinfo normalizes id/kakao_account.profile.{nickname,profile_image_url}", async () => {
  const cfg = providerConfig("kakao", { KAKAO_CLIENT_ID: "kid", KAKAO_CLIENT_SECRET: "ks" });
  const profile = await completeOAuth("kakao", cfg, { code: "c", redirectUri: "https://x/cb" }, { fetchImpl: fakeFetchFor("kakao") });
  assert.deepEqual(profile, { providerUserId: "998877", nickname: "카카오유저", avatar: "https://k.kakaocdn.net/x.jpg" });
});

test("naver userinfo normalizes response.{id,nickname,profile_image}", async () => {
  const cfg = providerConfig("naver", { NAVER_CLIENT_ID: "nid", NAVER_CLIENT_SECRET: "ns" });
  const profile = await completeOAuth("naver", cfg, { code: "c", redirectUri: "https://x/cb" }, { fetchImpl: fakeFetchFor("naver") });
  assert.deepEqual(profile, { providerUserId: "nvr-1", nickname: "네이버유저", avatar: "https://ssl.pstatic.net/x.jpg" });
});

test("exchangeCodeForToken throws on a non-ok token response or a response with no access_token", async () => {
  const cfg = providerConfig("google", { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" });
  await assert.rejects(
    () => exchangeCodeForToken(cfg, { code: "c", redirectUri: "https://x/cb" }, { fetchImpl: async () => ({ ok: false, status: 400 }) }),
    /token exchange failed/
  );
  await assert.rejects(
    () => exchangeCodeForToken(cfg, { code: "c", redirectUri: "https://x/cb" }, { fetchImpl: async () => ({ ok: true, async json() { return {}; } }) }),
    /no access_token/
  );
});

test("fetchUserInfo throws on a non-ok userinfo response", async () => {
  const cfg = providerConfig("google", { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" });
  await assert.rejects(
    () => fetchUserInfo(cfg, "tok", { fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /userinfo fetch failed/
  );
});

// ---- store: social linking + sessions (unit level) ----

test("store.linkSocialAccount + findUserBySocial round-trip, and never overwrites the public anonymous nickname", () => {
  const store = new FeedStore({ clock: fixedClock });
  const user = store.createUser("u1");
  const anonNickname = user.nickname;
  assert.equal(store.findUserBySocial("google", "g-1"), null);

  store.linkSocialAccount("u1", "google", "g-1", { nickname: "실명유저", avatar: "https://x/a.jpg" });
  const found = store.findUserBySocial("google", "g-1");
  assert.ok(found);
  assert.equal(found.id, "u1");
  assert.equal(found.nickname, anonNickname, "public nickname must stay the anonymous one, never the social display name");
  assert.deepEqual(found.socialProfile, { provider: "google", nickname: "실명유저", avatar: "https://x/a.jpg" });
});

test("store.createSession / sessionUser / destroySession", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.createUser("u1");
  const token = store.createSession("u1");
  assert.equal(store.sessionUser(token), "u1");
  assert.equal(store.sessionUser("bogus-token"), null);
  assert.equal(store.sessionUser(null), null);

  store.destroySession(token);
  assert.equal(store.sessionUser(token), null, "logout invalidates the token immediately");
});

test("store.sessionUser treats an expired session as absent", () => {
  const store = new FeedStore({ clock: fixedClock });
  store.createUser("u1");
  const token = store.createSession("u1", -1); // already expired the instant it's created
  assert.equal(store.sessionUser(token), null);
});

test("store.createSession throws for an unknown userId (no session can anchor a nonexistent user)", () => {
  const store = new FeedStore({ clock: fixedClock });
  assert.throws(() => store.createSession("no-such-user"));
});

// ---- end-to-end via the real HTTP server ----

async function startServer(opts) {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer(opts);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, base: `http://localhost:${server.address().port}` };
}

test("full regression: with zero provider env vars, /api/config lists no auth providers, /api/auth/*/login 404s, and plain anonymous flow (session/survey/feed) is completely unaffected", async () => {
  const { server, base } = await startServer({ authEnv: {} });
  try {
    const cfg = await (await fetch(`${base}/api/config`)).json();
    // providers가 빈 배열이라는 게 이 회귀 테스트의 핵심. kakaoJsKey는 로그인
    // 가능 여부와 무관한 별도 값이라(공개 JS 키) 여기서는 존재만 확인한다.
    assert.deepEqual(cfg.auth.providers, []);
    assert.equal(cfg.auth.kakaoJsKey ?? null, process.env.KAKAO_JS_KEY || null);

    for (const provider of ["google", "kakao", "naver"]) {
      const res = await fetch(`${base}/api/auth/${provider}/login`, { redirect: "manual" });
      assert.equal(res.status, 404, `${provider} login must 404 with no credentials configured`);
    }

    // anonymous flow, unaffected
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.ok(session.userId);
    const surveyRes = await fetch(`${base}/api/survey`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, answers: { categories: ["auto"] } })
    });
    assert.equal(surveyRes.status, 200);
    const feedRes = await fetch(`${base}/api/feed?userId=${session.userId}&cursor=0&limit=5`);
    assert.equal(feedRes.status, 200);

    const authSession = await (await fetch(`${base}/api/auth/session`)).json();
    assert.deepEqual(authSession, { loggedIn: false });
  } finally {
    server.close();
  }
});

test("GET /api/auth/:provider/callback rejects a forged/unknown state with a redirect to /?auth=error (never 500s, never creates a session)", async () => {
  const { server, base } = await startServer({ authEnv: { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" } });
  try {
    const res = await fetch(`${base}/api/auth/google/callback?state=totally-forged&code=whatever`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get("location"), base).search, "?auth=error");
    assert.equal(res.headers.get("set-cookie"), null, "no session cookie on a rejected state");
  } finally {
    server.close();
  }
});

test("GET /api/auth/:provider/login 302s to the provider's own authorize URL with a fresh state, carrying the anonymous userId along", async () => {
  const { server, base } = await startServer({ authEnv: { KAKAO_CLIENT_ID: "kid", KAKAO_CLIENT_SECRET: "ks" } });
  try {
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const res = await fetch(`${base}/api/auth/kakao/login?userId=${session.userId}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin, "https://kauth.kakao.com");
    assert.equal(loc.searchParams.get("client_id"), "kid");
    assert.ok(loc.searchParams.get("state"));
    assert.equal(loc.searchParams.get("redirect_uri"), `${base}/api/auth/kakao/callback`);
  } finally {
    server.close();
  }
});

// The centerpiece: logging in must never reset an existing anonymous user's
// learned taste. This does a real survey -> real preference vector -> full
// login round trip (with fetch mocked so no network is needed) and asserts
// the preference vector, ratings, and userId are all identical afterwards.
test("anonymous -> social login taste succession: preferences/ratings survive, same userId is kept, and the session cookie authenticates GET /api/auth/session", async () => {
  const authFetch = fakeFetchFor("google");
  const { server, base } = await startServer({ authEnv: { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, authFetch });
  try {
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const anonId = session.userId;
    await fetch(`${base}/api/survey`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: anonId, answers: { categories: ["auto"], tags: ["cars"] } })
    });
    const before = await (await fetch(`${base}/api/me?userId=${anonId}`)).json();
    assert.ok(before.taste.categories.some((c) => c.id === "auto"), "fixture assumption: survey produced a learned preference");

    // kick off login with the anonymous id attached, then follow through the callback
    const loginRedirect = await fetch(`${base}/api/auth/google/login?userId=${anonId}`, { redirect: "manual" });
    const state = new URL(loginRedirect.headers.get("location")).searchParams.get("state");
    const cbRes = await fetch(`${base}/api/auth/google/callback?state=${state}&code=abc`, { redirect: "manual" });
    assert.equal(cbRes.status, 302);
    const loc = new URL(cbRes.headers.get("location"), base);
    assert.equal(loc.pathname, "/");
    assert.equal(loc.searchParams.get("auth"), "success");
    assert.equal(loc.searchParams.get("userId"), anonId, "the anonymous user is reused, not replaced by a new one");
    const setCookie = cbRes.headers.get("set-cookie");
    assert.match(setCookie, /feed_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);

    const after = await (await fetch(`${base}/api/me?userId=${anonId}`)).json();
    assert.deepEqual(after.taste.categories, before.taste.categories, "taste survives login intact");

    // cookie now authenticates the session endpoint
    const cookieHeader = setCookie.split(";")[0];
    const authSession = await (await fetch(`${base}/api/auth/session`, { headers: { cookie: cookieHeader } })).json();
    assert.equal(authSession.loggedIn, true);
    assert.equal(authSession.userId, anonId);
    assert.equal(authSession.social.provider, "google");
    assert.equal(authSession.social.nickname, "홍길동");

    // logging out clears the cookie server-side
    const logoutRes = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: cookieHeader } });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get("set-cookie"), /Max-Age=0/);
    const afterLogout = await (await fetch(`${base}/api/auth/session`, { headers: { cookie: cookieHeader } })).json();
    assert.deepEqual(afterLogout, { loggedIn: false });
  } finally {
    server.close();
  }
});

test("a second login with the SAME social account logs back into the SAME user (no duplicate account created), even without the anonymous userId this time", async () => {
  const authFetch = fakeFetchFor("google");
  const { server, base } = await startServer({ authEnv: { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, authFetch });
  try {
    const session = await (await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const anonId = session.userId;

    const login1 = await fetch(`${base}/api/auth/google/login?userId=${anonId}`, { redirect: "manual" });
    const state1 = new URL(login1.headers.get("location")).searchParams.get("state");
    const cb1 = await fetch(`${base}/api/auth/google/callback?state=${state1}&code=abc`, { redirect: "manual" });
    const linkedUserId = new URL(cb1.headers.get("location"), base).searchParams.get("userId");
    assert.equal(linkedUserId, anonId);

    // second login, from a "fresh browser" (no ?userId=, no cookie) — the
    // provider still identifies the same google account, so it must resolve
    // back to the already-linked user rather than minting a new one.
    const login2 = await fetch(`${base}/api/auth/google/login`, { redirect: "manual" });
    const state2 = new URL(login2.headers.get("location")).searchParams.get("state");
    const cb2 = await fetch(`${base}/api/auth/google/callback?state=${state2}&code=xyz`, { redirect: "manual" });
    const secondLoginUserId = new URL(cb2.headers.get("location"), base).searchParams.get("userId");
    assert.equal(secondLoginUserId, anonId, "must resolve to the same account, not a new one");
  } finally {
    server.close();
  }
});

test("callback with a missing/failed token exchange redirects to /?auth=error instead of 500ing", async () => {
  const authFetch = async () => ({ ok: false, status: 400 });
  const { server, base } = await startServer({ authEnv: { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, authFetch });
  try {
    const login = await fetch(`${base}/api/auth/google/login`, { redirect: "manual" });
    const state = new URL(login.headers.get("location")).searchParams.get("state");
    const cb = await fetch(`${base}/api/auth/google/callback?state=${state}&code=abc`, { redirect: "manual" });
    assert.equal(cb.status, 302);
    assert.equal(new URL(cb.headers.get("location"), base).search, "?auth=error");
  } finally {
    server.close();
  }
});

// --- 카카오톡 앱 원탭 로그인 (David 2026-07-28) -------------------------------
// 카카오 JavaScript SDK가 인가 요청을 직접 띄워야 카카오톡 앱으로 전환되므로,
// 서버가 302 Location에 실어 주던 CSRF state를 따로 발급해 주는 경로가 필요하다.
// 핵심 요구: 앱 경로라고 해서 검증이 느슨해지면 안 된다 — state는 여전히
// 1회용이어야 하고, 키 없는 provider엔 발급되지 않아야 한다.

test("GET /api/auth/kakao/state: 앱 로그인용 state를 발급하고, 그 state는 1회만 통한다", async () => {
  const { server, base } = await startServer({
    authEnv: { KAKAO_CLIENT_ID: "kid", KAKAO_CLIENT_SECRET: "ksec" }
  });
  try {
    const res = await fetch(`${base}/api/auth/kakao/state?userId=anon_1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.state === "string" && body.state.length >= 16, "충분히 긴 state여야");
    assert.match(body.redirectUri, /\/api\/auth\/kakao\/callback$/);

    // 1회용 검증 — 소진된 state로 다시 콜백을 치면 토큰 교환 시도조차 없이
    // 곧장 에러로 튕겨야 한다(재사용/재생 공격 방지).
    const cb = `${base}/api/auth/kakao/callback?state=${encodeURIComponent(body.state)}&code=fake`;
    await fetch(cb, { redirect: "manual" });
    const second = await fetch(cb, { redirect: "manual" });
    assert.equal(second.status, 302);
    assert.match(second.headers.get("location"), /auth=error/, "소진된 state는 재사용될 수 없어야");
  } finally {
    server.close();
  }
});

test("GET /api/auth/<provider>/state: 키가 설정되지 않은 provider엔 발급하지 않는다(404)", async () => {
  const { server, base } = await startServer({ authEnv: {} });
  try {
    for (const provider of ["google", "kakao", "naver"]) {
      const res = await fetch(`${base}/api/auth/${provider}/state`);
      assert.equal(res.status, 404, `${provider}: 키 없으면 state도 없어야`);
    }
  } finally {
    server.close();
  }
});

test("/api/config: kakaoJsKey는 설정됐을 때만 노출되고, provider 목록과 독립이다", async () => {
  const prev = process.env.KAKAO_JS_KEY;
  try {
    delete process.env.KAKAO_JS_KEY;
    {
      const { server, base } = await startServer({ authEnv: {} });
      try {
        const cfg = await (await fetch(`${base}/api/config`)).json();
        assert.equal(cfg.auth.kakaoJsKey, null, "키 없으면 null");
      } finally { server.close(); }
    }
    process.env.KAKAO_JS_KEY = "js-public-key";
    {
      const { server, base } = await startServer({ authEnv: {} });
      try {
        const cfg = await (await fetch(`${base}/api/config`)).json();
        // JS 키는 공개 키다 — 시크릿이 아니라서 노출 자체가 정상이고,
        // provider가 하나도 없어도 이 값은 그대로 실려 나간다.
        assert.equal(cfg.auth.kakaoJsKey, "js-public-key");
        assert.deepEqual(cfg.auth.providers, []);
      } finally { server.close(); }
    }
  } finally {
    if (prev === undefined) delete process.env.KAKAO_JS_KEY;
    else process.env.KAKAO_JS_KEY = prev;
  }
});
