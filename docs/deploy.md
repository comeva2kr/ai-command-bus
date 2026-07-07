# Deploying the personalized feed

The server is zero-dependency Node (`src/feed/server.js`) and listens on
`process.env.PORT`, so it runs anywhere that can run Node 22 or a container.

## Environment variables

| Var | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `4000` |
| `FEED_DB` | JSON file to persist users/posts (set to a mounted volume path) | in-memory |
| `FEED_LIVE` | `1` to enable live ingestion of enabled non-seed communities | off |
| `FEED_REFRESH_MS` | periodic re-collection interval in ms (e.g. `900000` = 15 min) | off |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push signing keys (see below) | push disabled |
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
2. Generate VAPID keys and set them to enable real Web Push (see
   [personalized-feed.md](personalized-feed.md)).
3. HTTPS is mandatory for install-to-home-screen and notifications.
