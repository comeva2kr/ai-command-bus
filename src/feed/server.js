// Zero-dependency HTTP server for the personalized feed.
//
// Serves the REST API and the static single-page client. Built on node:http so
// the project keeps its no-dependency footprint. Run with:
//   node src/feed/server.js            # in-memory, ephemeral
//   FEED_DB=./feed-data.json node src/feed/server.js   # persisted

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FeedStore } from "./store.js";
import { FeedEngine } from "./engine.js";
import { SeedSource, StorePostsSource } from "./content.js";
import { SURVEY, validateAnswers } from "./survey.js";
import { CATEGORIES, SOURCE_CATALOG } from "./taxonomy.js";
import { loadRegistry, buildSources, summarize } from "./registry.js";
import { makeFetcher } from "./fetchers.js";
import { DEFAULT_RULES } from "./rules.js";
import { normalizeSubmission } from "./ingest.js";
import { topPreferences } from "./recommender.js";
import { categoryLabel, sourceLabel } from "./taxonomy.js";
import { sendDigestPushes } from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// A tiny HTML page carrying Open Graph tags so a shared link renders a rich
// preview in KakaoTalk / social, then bounces a human to the in-app view.
function sharePage(data, origin, id) {
  if (!data) {
    return `<!doctype html><meta charset="utf-8"><title>내 취향 피드</title><meta http-equiv="refresh" content="0; url=/"><p>이동 중…</p>`;
  }
  const url = `${origin}/p?id=${encodeURIComponent(id)}`;
  const title = escapeHtml(data.title);
  const desc = escapeHtml((data.summary || "").slice(0, 160) || `${data.source} · ${data.category}`);
  const appUrl = `/#post-${encodeURIComponent(id)}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="내 취향 피드">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(origin)}/icon.svg">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta http-equiv="refresh" content="0; url=${appUrl}">
</head><body style="background:#0e0f13;color:#e8eaf0;font-family:sans-serif;padding:40px;text-align:center">
<p>${title}</p><p><a style="color:#4f8cff" href="${appUrl}">앱에서 열기 →</a></p>
</body></html>`;
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  // prevent path traversal outside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

export function createServer(opts = {}) {
  const store = new FeedStore({ file: opts.file || process.env.FEED_DB || null });

  // Build sources from the community registry DB (国内+해외+성인), plus the
  // store-backed source that surfaces users' own posts. Overseas sources are
  // wrapped for translation when a translator is wired via opts.translate.
  let registry = [];
  let sources;
  // FEED_DEV=1 enables the bundled dev seed dataset. Off by default: the
  // hardcoded sample content must never appear in a real feed (원칙: 실데이터만).
  const dev = opts.dev != null ? Boolean(opts.dev) : Boolean(process.env.FEED_DEV);
  // FEED_LIVE turns on real ingestion for enabled non-seed communities.
  const live = opts.fetcher || (process.env.FEED_LIVE ? makeFetcher : null);
  try {
    registry = loadRegistry();
    sources = buildSources(registry, { translate: opts.translate, seed: dev, fetcher: live ? (e) => live(e)() : undefined });
  } catch (err) {
    sources = dev ? [new SeedSource()] : [];
  }
  if (!dev && !live) {
    console.warn(
      "[feed] FEED_LIVE off & FEED_DEV off — feed will only contain user posts. " +
        "Set FEED_LIVE=1 for real ingestion, or FEED_DEV=1 for the dev seed dataset."
    );
  }
  sources.push(new StorePostsSource(store));
  const engine = new FeedEngine(store, opts.sources || sources);

  // 정기 DB 갱신: refresh the collected pool on an interval when configured.
  const refreshMs = Number(opts.refreshMs || process.env.FEED_REFRESH_MS || 0);
  if (refreshMs > 0) engine.startAutoRefresh(refreshMs);

  // Admin auth. Set ADMIN_TOKEN in production; a dev default is used otherwise.
  const ADMIN_TOKEN = opts.adminToken || process.env.ADMIN_TOKEN || "admin-dev";
  if (ADMIN_TOKEN === "admin-dev") {
    console.warn("[admin] ADMIN_TOKEN not set — using insecure dev token 'admin-dev'");
  }
  const isAdmin = (req, url) =>
    (req.headers["x-admin-token"] || url.searchParams.get("token")) === ADMIN_TOKEN;

  // Web Push (VAPID / RFC 8292). opts.vapid lets tests inject a keypair without
  // env vars; production sets VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (generate a
  // pair with `npm run push:keys`). Missing keys just disable server-sent push
  // — the in-app digest banner (GET /api/digest) still works without them.
  const vapid = opts.vapid || (
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? {
          publicKey: process.env.VAPID_PUBLIC_KEY,
          privateKey: process.env.VAPID_PRIVATE_KEY,
          subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com"
        }
      : null
  );
  if (!vapid) {
    console.warn(
      "[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — Web Push disabled " +
        "(in-app digest banner still works). Run `npm run push:keys` to generate a pair."
    );
  }

  // 관심글 다이제스트 푸시: PUSH_DIGEST_MS(ms)가 설정되어 있으면 주기적으로 모든
  // 구독자를 훑어 안 본 관심글이 있는 사람에게만 보낸다. VAPID가 없으면 보낼 수
  // 없으니 그냥 꺼둔다.
  const pushDigestMs = Number(opts.pushDigestMs || process.env.PUSH_DIGEST_MS || 0);
  if (pushDigestMs > 0 && vapid) {
    const pushTimer = setInterval(() => {
      sendDigestPushes(store, engine, vapid, { sendImpl: opts.pushSendImpl }).catch(() => {});
    }, pushDigestMs);
    if (pushTimer.unref) pushTimer.unref();
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    try {
      // --- API ---
      if (p === "/api/health") return send(res, 200, { ok: true });

      if (p === "/api/config" && req.method === "GET") {
        return send(res, 200, { survey: SURVEY, categories: CATEGORIES, sources: SOURCE_CATALOG });
      }

      if (p === "/api/communities" && req.method === "GET") {
        return send(res, 200, { summary: summarize(registry), communities: registry });
      }

      if (p === "/api/rules" && req.method === "GET") {
        return send(res, 200, { rules: DEFAULT_RULES });
      }

      if (p === "/api/post" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          const post = store.createPost(body.userId, body);
          engine.invalidate(); // make the new post visible in the feed
          return send(res, 200, post);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      if (p === "/api/submit" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          // fetch the page's own OG tags for title/excerpt where the network
          // allows; otherwise fall back to the submitter-provided title.
          const item = await normalizeSubmission(body, {
            fetchImpl: process.env.FEED_LIVE ? fetch : null
          });
          const rec = store.addSubmission(body.userId, item);
          engine.invalidate();
          return send(res, 200, rec);
        } catch (err) {
          return send(res, 400, { error: String(err.message) });
        }
      }

      if (p === "/api/me" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const space = store.mySpace(userId);
        // resolve scrapped item ids into displayable items
        space.saved = await engine.resolveItems(userId, space.savedIds);
        // taste dashboard: top learned preferences, labelled for display
        const prefs = store.getUser(userId).preferences;
        const t = topPreferences(prefs);
        space.taste = {
          categories: t.categories.map((c) => ({ ...c, label: categoryLabel(c.id) })),
          tags: t.tags.map((x) => ({ ...x, label: "#" + x.id })),
          sources: t.sources.map((s) => ({ ...s, label: sourceLabel(s.id) })),
          disliked: t.disliked.map((d) => ({ ...d, label: categoryLabel(d.id) }))
        };
        return send(res, 200, space);
      }

      if (p === "/api/save" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const saved = store.toggleSave(body.userId, body.itemId, body.on);
        return send(res, 200, { ok: true, saved });
      }

      if (p === "/api/mute" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const muted = store.setMute(body.userId, body.source, body.on === true);
        return send(res, 200, { ok: true, mutedSources: muted });
      }

      if (p === "/api/session" && req.method === "POST") {
        const body = await readBody(req);
        const user = store.createUser(body.userId);
        return send(res, 200, {
          userId: user.id,
          nickname: user.nickname,
          surveyed: user.surveyed,
          feedbackCount: user.feedbackCount,
          ageVerified: user.ageVerified === true,
          showAdult: user.showAdult === true
        });
      }

      if (p === "/api/verify-age" && req.method === "POST") {
        // Mock 성인인증. A real deployment integrates PASS/휴대폰 본인확인 here and
        // only calls verifyAge on a confirmed adult result.
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        if (body.confirmAdult !== true) return send(res, 400, { error: "adult confirmation required" });
        store.verifyAge(body.userId);
        return send(res, 200, { ok: true, ageVerified: true });
      }

      if (p === "/api/adult" && req.method === "POST") {
        const body = await readBody(req);
        const user = store.getUser(body.userId);
        if (!user) return send(res, 400, { error: "unknown user" });
        if (body.on === true && user.ageVerified !== true) {
          return send(res, 403, { error: "age verification required", ageVerified: false });
        }
        const on = store.setShowAdult(body.userId, body.on === true);
        return send(res, 200, { ok: true, showAdult: on });
      }

      if (p === "/api/survey" && req.method === "POST") {
        const body = await readBody(req);
        const { ok, errors } = validateAnswers(body.answers);
        if (!ok) return send(res, 400, { error: "invalid survey", details: errors });
        store.createUser(body.userId);
        store.saveSurvey(body.userId, body.answers);
        return send(res, 200, { ok: true });
      }

      if (p === "/api/history" && req.method === "POST") {
        const body = await readBody(req);
        store.createUser(body.userId);
        if (!Array.isArray(body.entries)) return send(res, 400, { error: "entries must be an array" });
        const result = store.applyHistory(body.userId, body.entries.slice(0, 500));
        return send(res, 200, { ok: true, hits: result.hits, entriesSeen: result.entriesSeen });
      }

      if (p === "/api/feed" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId || !store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const cursor = Number(url.searchParams.get("cursor") || 0);
        const limit = Math.min(30, Number(url.searchParams.get("limit") || 10));
        const feed = await engine.getFeed(userId, { cursor, limit });
        return send(res, 200, feed);
      }

      if (p === "/api/digest" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!store.getUser(userId)) return send(res, 400, { error: "unknown user" });
        const limit = Math.min(10, Number(url.searchParams.get("limit") || 5));
        return send(res, 200, await engine.digest(userId, { limit }));
      }

      if (p === "/api/push/subscribe" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const enabled = store.savePushSubscription(body.userId, body.subscription || null);
        return send(res, 200, { ok: true, notifyEnabled: enabled });
      }

      // The client's pushManager.subscribe() needs this as applicationServerKey
      // (base64url → Uint8Array). null means the server has no VAPID keypair —
      // the client degrades to local-only notifications.
      if (p === "/api/push/vapid-key" && req.method === "GET") {
        return send(res, 200, { key: vapid ? vapid.publicKey : null });
      }

      if (p === "/api/item" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        const itemId = url.searchParams.get("itemId");
        const item = await engine.getItem(userId, itemId);
        if (!item) return send(res, 404, { error: "not found" });
        return send(res, 200, item);
      }

      if (p === "/api/signal" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const result = await engine.signal(body.userId, body.itemId, {
          type: body.type,
          dwellMs: Number(body.dwellMs || 0)
        });
        return send(res, 200, result);
      }

      if (p === "/api/rate" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        const result = await engine.rate(body.userId, body.itemId, body.signal);
        return send(res, 200, result);
      }

      if (p === "/api/comment" && req.method === "POST") {
        const body = await readBody(req);
        if (!store.getUser(body.userId)) return send(res, 400, { error: "unknown user" });
        try {
          const comment = store.addComment(body.userId, body.itemId, body.body);
          return send(res, 200, comment);
        } catch (err) {
          const status = err.rule && err.rule.rateLimited ? 429 : 400;
          return send(res, status, { error: String(err.message), rule: err.rule || null });
        }
      }

      // --- admin API (token-guarded) ---
      if (p.startsWith("/api/admin/")) {
        if (!isAdmin(req, url)) return send(res, 401, { error: "admin auth required" });

        if (p === "/api/admin/stats" && req.method === "GET") {
          return send(res, 200, { stats: store.adminStats(), communities: summarize(registry) });
        }
        if (p === "/api/admin/users" && req.method === "GET") {
          return send(res, 200, { users: store.adminUsers() });
        }
        if (p === "/api/admin/posts" && req.method === "GET") {
          return send(res, 200, { posts: store.allPosts().slice().reverse() });
        }
        if (p === "/api/admin/comments" && req.method === "GET") {
          const all = [];
          for (const u of store.users.values()) for (const c of u.comments || []) all.push(c);
          all.sort((a, b) => (a.at < b.at ? 1 : -1));
          return send(res, 200, { comments: all });
        }
        if (p === "/api/admin/communities" && req.method === "GET") {
          const disabled = store.disabledSources();
          return send(res, 200, {
            communities: registry.map((c) => ({ ...c, disabled: disabled.has(c.id) }))
          });
        }
        if (p === "/api/admin/delete-post" && req.method === "POST") {
          const body = await readBody(req);
          const ok = store.deletePost(body.id);
          engine.invalidate();
          return send(res, 200, { ok });
        }
        if (p === "/api/admin/delete-comment" && req.method === "POST") {
          const body = await readBody(req);
          return send(res, 200, { ok: store.deleteComment(body.id) });
        }
        // Source health check: actually fetch every enabled live adapter once
        // and report per-source status. This is how candidate feed URLs get
        // VERIFIED at runtime instead of being trusted blindly (no hardcoded
        // assumptions — where the network is closed, this shows exactly that).
        if (p === "/api/admin/check-sources" && req.method === "POST") {
          const targets = registry.filter((c) => c.enabled && c.adapter && c.adapter.type !== "seed");
          const results = [];
          for (const entry of targets) {
            const t0 = Date.now();
            try {
              const rows = await makeFetcher(entry)();
              results.push({ id: entry.id, label: entry.label, ok: true, items: rows.length, ms: Date.now() - t0 });
            } catch (err) {
              results.push({ id: entry.id, label: entry.label, ok: false, error: String(err && err.message ? err.message : err).slice(0, 140), ms: Date.now() - t0 });
            }
          }
          return send(res, 200, { checkedAt: new Date().toISOString(), results });
        }

        if (p === "/api/admin/community" && req.method === "POST") {
          const body = await readBody(req);
          const list = store.setSourceDisabled(body.id, body.disabled === true);
          return send(res, 200, { ok: true, disabledSources: list });
        }
        if (p === "/api/admin/banned-word" && req.method === "POST") {
          const body = await readBody(req);
          const words = body.action === "remove" ? store.removeBannedWord(body.word) : store.addBannedWord(body.word);
          return send(res, 200, { ok: true, bannedWords: words });
        }
        // Manual trigger for the digest push job (normally run on PUSH_DIGEST_MS).
        // Sends right away and reports how many subscribers got a push.
        if (p === "/api/admin/push-digest" && req.method === "POST") {
          const result = await sendDigestPushes(store, engine, vapid, { sendImpl: opts.pushSendImpl });
          return send(res, 200, result);
        }
        return send(res, 404, { error: "not found" });
      }

      // --- admin page ---
      if (p === "/admin" && req.method === "GET") return serveStatic(res, "/admin.html");

      // --- shareable link with OG tags (crawlers read this; humans bounce to app) ---
      if (p === "/p" && req.method === "GET") {
        const id = url.searchParams.get("id");
        const data = id ? await engine.shareData(id) : null;
        const proto = req.headers["x-forwarded-proto"] || "http";
        const origin = `${proto}://${req.headers.host}`;
        res.writeHead(data ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
        res.end(sharePage(data, origin, id));
        return;
      }

      // --- static client ---
      if (req.method === "GET") return serveStatic(res, p);

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: String(err && err.message ? err.message : err) });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const port = Number(process.env.PORT || 4000);
  const server = createServer();
  server.listen(port, () => {
    console.log(`personalized feed running at http://localhost:${port}`);
    if (process.env.FEED_DB) console.log(`persisting to ${process.env.FEED_DB}`);
  });
}
