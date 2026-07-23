# Deploying the personalized feed

The server is zero-dependency Node (`src/feed/server.js`) and listens on
`process.env.PORT`, so it runs anywhere that can run Node 22 or a container.

## Environment variables

| Var | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `4000` |
| `FEED_DB` | JSON file to persist users/posts (set to a mounted volume path) | in-memory |
| `FEED_LIVE` | `1` to enable live ingestion of enabled non-seed communities | off |
| `FEED_DEV` | `1` to enable the bundled dev seed dataset (never use in production) | off |
| `FEED_REFRESH_MS` | periodic re-collection interval in ms (e.g. `900000` = 15 min) | off |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push signing keys (see below) | push disabled |
| `VAPID_SUBJECT` | contact URI (`mailto:`/`https:`) sent in the VAPID JWT | `mailto:admin@example.com` |
| `PUSH_DIGEST_MS` | interval in ms to auto-send the 관심글 digest push to subscribers (e.g. `3600000` = hourly); needs VAPID configured | off |
| `ADMIN_TOKEN` | token gating the admin console at `/admin` and `/api/admin/*` | `admin-dev` (insecure) |
| `NODE_EXTRA_CA_CERTS` | CA bundle path if egress goes through a TLS-terminating proxy | — |

Health check endpoint: `GET /api/health` → `{ "ok": true }`.

## Docker

```bash
docker build -t feed .
docker run -p 4000:4000 \
  -e FEED_DB=/data/feed.json -v $PWD/data:/data \
  -e FEED_LIVE=1 -e FEED_REFRESH_MS=900000 \
  feed
```

## Platforms

- **Render / Railway / Fly.io** — point at the repo; they detect the
  `Dockerfile`. Set the env vars above; add a persistent disk mounted where
  `FEED_DB` points if you want durable users. Health check path `/api/health`.
- **A plain VPS** — `node src/feed/server.js` behind nginx/Caddy for TLS. HTTPS
  is required for the PWA service worker and Web Push to work.

## After deploying

1. Turn on live ingestion once the host's network policy allows the target
   domains: set `FEED_LIVE=1` and give the enabled non-seed communities real
   feed URLs in `src/feed/communities.json`.
2. Generate VAPID keys and set them to enable real Web Push:
   ```bash
   npm run push:keys
   # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT to set
   ```
   Once set, `GET /api/push/vapid-key` starts returning the public key and the
   client's "🔔 알림 받기" button creates a real push subscription instead of a
   local-only one. Set `PUSH_DIGEST_MS` to have the server proactively push the
   관심글 digest on an interval (or trigger it once via
   `POST /api/admin/push-digest`, `ADMIN_TOKEN`-gated). See
   [personalized-feed.md](personalized-feed.md) for the full re-engagement flow.
3. HTTPS is mandatory for install-to-home-screen and notifications.
