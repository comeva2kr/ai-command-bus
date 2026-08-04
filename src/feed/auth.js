// Social login (OAuth 2.0), implemented directly against each provider's own
// endpoints on Node's built-in fetch/crypto — no `passport`/`oauth` dependency,
// keeping the project's zero-dependency posture.
//
// Three providers (google/kakao/naver) are described as *data*, not three
// copies of the same flow — authorize/token/userinfo URLs, scope, and a
// `normalize()` that maps each provider's own userinfo shape to a common
// { providerUserId, nickname, avatar }. server.js drives the actual HTTP
// request/response (redirects, cookies); this module only does the parts that
// don't need node:http (config, URL building, token/userinfo exchange, state
// CSRF tokens, cookie (de)serialization).
//
// A provider is only "enabled" when BOTH its client id and secret env vars
// are set (see providerConfig). Nothing in this module or server.js assumes a
// provider is configured — with zero env vars set, enabledProviders() returns
// [], every /api/auth/:provider/* route 404s, and the rest of the app (100%
// anonymous, localStorage-based) is completely untouched. See
// docs/legal.md's "개인정보 최소수집": only the provider's own user id +
// nickname + avatar are ever read — never email, even when the provider's
// userinfo response happens to include one.

import crypto from "node:crypto";

// ---- provider registry ----

export const PROVIDERS = {
  google: {
    id: "google",
    label: "구글",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    // { sub, name, picture, ... } — https://openid.net/specs/openid-connect-core-1_0.html#UserInfo
    normalize(data) {
      return {
        providerUserId: String(data.sub),
        nickname: data.name || null,
        avatar: data.picture || null
      };
    }
  },
  kakao: {
    id: "kakao",
    label: "카카오",
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userinfoUrl: "https://kapi.kakao.com/v2/user/me",
    scope: "profile_nickname profile_image",
    clientIdEnv: "KAKAO_CLIENT_ID",
    clientSecretEnv: "KAKAO_CLIENT_SECRET",
    // { id, kakao_account: { profile: { nickname, profile_image_url } } }
    normalize(data) {
      const profile = data.kakao_account && data.kakao_account.profile;
      return {
        providerUserId: String(data.id),
        nickname: (profile && profile.nickname) || null,
        avatar: (profile && profile.profile_image_url) || null
      };
    }
  },
  naver: {
    id: "naver",
    label: "네이버",
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    userinfoUrl: "https://openapi.naver.com/v1/nid/me",
    scope: "",
    clientIdEnv: "NAVER_CLIENT_ID",
    clientSecretEnv: "NAVER_CLIENT_SECRET",
    // { response: { id, nickname, profile_image } }
    normalize(data) {
      const r = data.response || {};
      return {
        providerUserId: String(r.id),
        nickname: r.nickname || null,
        avatar: r.profile_image || null
      };
    }
  }
};

// A provider is enabled only when both its client id + secret env vars are
// set — the env-var gate the whole feature hangs off of (README §A).
export function providerConfig(provider, env = process.env) {
  const p = PROVIDERS[provider];
  if (!p) return null;
  const clientId = env[p.clientIdEnv];
  const clientSecret = env[p.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { ...p, clientId, clientSecret };
}

// Provider ids that have real credentials configured, for /api/config's
// `auth.providers` — the client only ever renders buttons for these.
export function enabledProviders(env = process.env) {
  return Object.keys(PROVIDERS).filter((id) => providerConfig(id, env) !== null);
}

// ---- authorize URL ----

export function buildAuthorizeUrl(cfg, { state, redirectUri }) {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  if (cfg.scope) u.searchParams.set("scope", cfg.scope);
  return u.toString();
}

// ---- code -> token -> userinfo ----

export async function exchangeCodeForToken(cfg, { code, redirectUri }, { fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri,
    code
  });
  const res = await fetchImpl(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (!res.ok) throw new Error(`${cfg.id}: token exchange failed (${res.status})`);
  const data = await res.json();
  if (!data || !data.access_token) throw new Error(`${cfg.id}: token exchange returned no access_token`);
  return data;
}

export async function fetchUserInfo(cfg, accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(cfg.userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`${cfg.id}: userinfo fetch failed (${res.status})`);
  const data = await res.json();
  return cfg.normalize(data);
}

// One call doing exchange + userinfo + normalize, for server.js's callback
// handler. `fetchImpl` is injectable so tests can mock all three providers'
// responses without any network access.
export async function completeOAuth(provider, cfg, { code, redirectUri }, opts = {}) {
  const token = await exchangeCodeForToken(cfg, { code, redirectUri }, opts);
  return fetchUserInfo(cfg, token.access_token, opts);
}

// ---- CSRF state tokens ----
//
// A short-lived, single-use, server-side-only mapping from a random state
// value to { provider, anonymousUserId }. The provider only ever echoes the
// state back — it never sees or needs to know the anonymous userId, so this
// is also how the anonymous-user-to-inherit-into rides along the redirect
// round trip without exposing it to the provider or a query param an
// attacker could forge (a forged/replayed state simply won't be `consume()`-
// able — see the "state 위조 거부" test in test/auth.test.js).
const STATE_TTL_MS = 10 * 60 * 1000;

export class AuthStateStore {
  constructor() {
    this._states = new Map(); // state -> { provider, anonymousUserId, expiresAt }
  }

  issue(provider, anonymousUserId, nowMs = Date.now()) {
    this._prune(nowMs);
    const state = crypto.randomBytes(24).toString("hex");
    this._states.set(state, { provider, anonymousUserId: anonymousUserId || null, expiresAt: nowMs + STATE_TTL_MS });
    return state;
  }

  // One-time use: a valid state is consumed (deleted) the moment it's read,
  // so a replayed callback URL can never succeed twice.
  consume(state, nowMs = Date.now()) {
    if (!state) return null;
    const entry = this._states.get(state);
    if (!entry) return null;
    this._states.delete(state);
    if (nowMs > entry.expiresAt) return null;
    return entry;
  }

  _prune(nowMs) {
    for (const [state, entry] of this._states) {
      if (nowMs > entry.expiresAt) this._states.delete(state);
    }
  }
}

// ---- session cookie (de)serialization ----

export const SESSION_COOKIE = "feed_session";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days, matches store.createSession's default TTL

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// `secure`: only set the Secure attribute when the request actually arrived
// over https (server.js checks x-forwarded-proto) — a real browser silently
// refuses to store a Secure cookie set over plain http, which would break
// local dev (`node src/feed/server.js` over http://localhost) entirely.
// Production (https://nowhot.kr) always gets Secure.
export function serializeSessionCookie(token, { secure = true } = {}) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

// ── 기기 식별 쿠키 (client_id) ─────────────────────────────────────────────
//
// ── 레퍼런스: Google Analytics 4 (David 고정법칙 "혼자 만들지 말고 벤치마킹")
// GA4는 익명 방문자를 `_ga` **1st-party 쿠키**(2년, 방문마다 max-age 갱신)로
// 식별하고, 로그인하면 user_id를 얹어 기기를 가로질러 합친다("blended
// identity": user_id → 시그널 → client_id). **localStorage를 쓰지 않는다.**
//
// ── 왜 우리에게 이게 필요한가 (2026-08-04 실측)
// 우리는 신원을 localStorage(`feed_uid`) 하나에만 의존했다. 그 결과:
//   8/2 방문자 116 · 그날 새로 만들어진 ID 112 → 재방문 4명
//   8/3 방문자 135 · 그날 새로 만들어진 ID 133 → 재방문 2명
// David 제보로 이게 사실이 아님이 드러났다 — 매일 오는 사람이 실제로 있다.
// 원인은 카카오톡·네이버 앱 내장 브라우저다. 이 웹뷰들은 localStorage를 자주
// 비우고, 그러면 부팅 때 `feed_uid`가 null이라 **매번 새 사용자**가 발급된다.
// 로그인 쿠키(feed_session)는 살아 있었는데도 신원 복구에 쓰이지 않았다.
//
// 쿠키는 웹뷰가 저장소를 비워도 살아남는 경우가 많고, HttpOnly라 페이지
// 스크립트가 실수로 지울 수도 없다. GA4가 쿠키를 고른 이유가 그것이다.
export const DEVICE_COOKIE = "nh_cid";
const DEVICE_MAX_AGE_SEC = 2 * 365 * 24 * 60 * 60; // GA4와 같은 2년

// 방문마다 다시 내보내 max-age를 갱신한다(GA4 동작). 그래야 꾸준히 오는
// 사람의 ID가 사실상 만료되지 않는다.
export function serializeDeviceCookie(userId, { secure = true } = {}) {
  const attrs = [
    `${DEVICE_COOKIE}=${encodeURIComponent(userId)}`,
    "Path=/",
    `Max-Age=${DEVICE_MAX_AGE_SEC}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

// 신원 확정 — GA4의 blended identity와 같은 우선순위.
//
//   1) 로그인 세션   가장 강하다. 기기가 몇 개든 한 사람으로 합쳐진다.
//   2) 기기 쿠키     localStorage보다 오래 살아남는다.
//   3) localStorage  기존 사용자를 잃지 않기 위한 하위호환. 이 값이 쿠키로
//                    승격되므로, 배포 직후 한 번만 쓰이고 그 뒤로는 2)가 맡는다.
//   4) 신규 발급
//
// 반환의 `source`는 관리자 화면에서 "이 방문자를 무엇으로 알아봤나"를 보여주기
// 위한 것이다 — 쿠키 복구가 실제로 작동하는지 수치로 확인할 수 있어야 한다.
export function resolveIdentity({ cookies = {}, bodyUserId = null, store }) {
  const sessionUserId = cookies[SESSION_COOKIE] ? store.sessionUser(cookies[SESSION_COOKIE]) : null;
  if (sessionUserId && store.getUser(sessionUserId)) {
    return { userId: sessionUserId, source: "login", loggedIn: true };
  }
  const cid = cookies[DEVICE_COOKIE];
  if (cid && store.getUser(cid)) return { userId: cid, source: "cookie", loggedIn: false };
  if (bodyUserId && store.getUser(bodyUserId)) return { userId: bodyUserId, source: "storage", loggedIn: false };
  // 클라이언트가 들고 온 ID가 서버에 없을 때도 **그 ID로** 만들어 준다.
  // 서버 데이터가 유실돼도 브라우저에 남은 ID로 같은 사람이 이어지던 기존
  // 동작이고, 이걸 끊으면 그 사람의 취향·스크랩이 통째로 남남이 된다.
  // 다만 아무 문자열이나 사용자 키가 되면 저장소가 오염되므로 형태를 검증한다.
  if (bodyUserId && /^[A-Za-z0-9_-]{1,64}$/.test(bodyUserId)) {
    return { userId: bodyUserId, source: "new", loggedIn: false };
  }
  return { userId: null, source: "new", loggedIn: false };
}
