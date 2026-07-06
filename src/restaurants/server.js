// Zero-dependency HTTP server exposing the restaurant discovery API plus a
// static frontend. Run: `node src/restaurants/server.js` then open the printed
// URL.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { search } from "./query.js";
import { SEED_RESTAURANTS } from "./data/seed.js";
import { LANDMARKS } from "./geo.js";
import {
  STYLE_SYNONYMS,
  CUISINE_SYNONYMS,
  TAG_SYNONYMS,
  MENU_SYNONYMS,
  MENU_ATTR_SYNONYMS,
  FEATURE_KEYS
} from "./taxonomy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

// Ready-made queries matching the user's worked examples.
export const PRESETS = {
  "kids-pork": {
    label: "프랜차이즈 아닌 뒷고기 고깃집 + 키즈카페",
    query: {
      styles: ["고깃집"],
      cuisines: ["돼지고기"],
      excludeFranchise: true,
      require: { kidsCafe: true },
      prefer: ["뒷고기"]
    }
  },
  "izakaya-aged": {
    label: "이자카야 · 숙성회 · 싼 분위기 아님 · 파티션",
    query: {
      styles: ["이자카야"],
      tagsAll: ["숙성회"],
      excludeTags: ["가성비"],
      prefer: ["고급스러운", "분위기좋은"],
      preferFeatures: { partition: true },
      priceMin: 2
    }
  },
  "sejong-mackerel": {
    label: "세종 인근 · 차로 30분 · 활(살아있는)고등어회",
    query: {
      location: { near: "세종" },
      travel: { mode: "car", minutes: 30 },
      menu: "고등어회",
      menuAttrs: ["활"]
    }
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

export function createServer(dataset = SEED_RESTAURANTS) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/meta") {
      return sendJson(res, 200, {
        landmarks: Object.keys(LANDMARKS),
        styles: Object.keys(STYLE_SYNONYMS),
        cuisines: Object.keys(CUISINE_SYNONYMS),
        tags: Object.keys(TAG_SYNONYMS),
        menus: Object.keys(MENU_SYNONYMS),
        menuAttrs: Object.keys(MENU_ATTR_SYNONYMS),
        features: FEATURE_KEYS,
        presets: Object.fromEntries(
          Object.entries(PRESETS).map(([k, v]) => [k, v.label])
        )
      });
    }

    if (url.pathname === "/api/search" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const query = raw ? JSON.parse(raw) : {};
        return sendJson(res, 200, search(dataset, query));
      } catch (err) {
        return sendJson(res, 400, { error: String(err.message || err) });
      }
    }

    if (url.pathname === "/api/preset") {
      const name = url.searchParams.get("name");
      const preset = PRESETS[name];
      if (!preset) return sendJson(res, 404, { error: "unknown preset", available: Object.keys(PRESETS) });
      return sendJson(res, 200, { query: preset.query, ...search(dataset, preset.query) });
    }

    return serveStatic(res, url.pathname);
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const port = Number(process.env.PORT) || 4173;
  createServer().listen(port, () => {
    console.log(`맛집 통합 커뮤니티 running at http://localhost:${port}`);
    console.log(`Presets: ${Object.keys(PRESETS).join(", ")}`);
  });
}
