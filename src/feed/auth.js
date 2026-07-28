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
