// Zero-dependency HTTP server for the real restaurant app.
// Serves the frontend + a live place-search API backed by a real connector
// (Kakao Local). No sample/dummy data is served — if no data source is
// configured, /api/places returns 503 and the UI shows a setup state.
//
// Run: KAKAO_REST_KEY=xxxx node src/restaurants/server.js

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dataSourceStatus, findPlaces } from "./places.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // Tells the frontend whether a real data source is wired up.
    if (url.pathname === "/api/config") {
      return sendJson(res, 200, { data: dataSourceStatus() });
    }

    // Live place search. query + optional lat/lng/radius for location search.
    if (url.pathname === "/api/places") {
      const q = url.searchParams;
      try {
        const result = await findPlaces({
          query: q.get("query") || "맛집",
          lat: q.get("lat") ? Number(q.get("lat")) : undefined,
          lng: q.get("lng") ? Number(q.get("lng")) : undefined,
          radiusM: q.get("radius") ? Number(q.get("radius")) : 1500,
          cafe: q.get("cafe") === "1"
        });
        return sendJson(res, 200, result);
      } catch (err) {
        if (String(err.message).includes("NO_SOURCE")) {
          return sendJson(res, 503, { error: "no_data_source", message: "실데이터 소스(KAKAO_REST_KEY)가 설정되지 않았습니다." });
        }
        return sendJson(res, 502, { error: "upstream", message: String(err.message) });
      }
    }

    return serveStatic(res, url.pathname);
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const port = Number(process.env.PORT) || 4173;
  createServer().listen(port, () => {
    const s = dataSourceStatus();
    console.log(`찐맛집 running at http://localhost:${port}`);
    console.log(s.ready ? `데이터 소스: ${s.source} (실연동)` : "⚠ 데이터 소스 미설정 — KAKAO_REST_KEY 환경변수를 설정하세요.");
  });
}
