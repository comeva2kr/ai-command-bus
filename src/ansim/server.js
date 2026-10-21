// 안심스캔 서버 — PWA 정적 파일 + 분석 API.
//
//   GET  /                       PWA (카메라 바코드 스캔, 라벨 촬영, 결과·대체품)
//   GET  /core/*.js              점수 엔진 (브라우저가 그대로 import)
//   GET  /api/ansim/config       라벨 사진 분석 사용 가능 여부
//   GET  /api/ansim/samples      예시 제품 목록 (데모용)
//   GET  /api/ansim/product/:bc  바코드 → 제품 (예시 카탈로그 → 식약처 API)
//   POST /api/ansim/analyze      { barcode | product | notice, profile, mall } → 판정 + 대체품
//   POST /api/ansim/label        { image(dataURL), profile, mall } → 라벨 전사 + 판정
//
// 개인정보: 아이 프로필(나이·알레르기)은 요청마다 같이 보내고 서버에 저장하지
// 않는다. 건강 관련 정보라 서버가 들고 있을 이유가 없다.
//
// 실행: npm run ansim  (PORT 기본 4100, MFDS_API_KEY·ANTHROPIC_API_KEY는 선택)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProduct, normalizeProfile } from "./core/score.js";
import { rankAlternatives } from "./core/alternatives.js";
import { buyLinks, MALL_IDS } from "./core/malls.js";
import { listingKeys, noticeToProduct } from "./core/notice.js";
import { inferCategory } from "./core/categories.js";
import { createCatalog } from "./catalog.js";
import { fetchProductByBarcode } from "./mfds.js";
import { readLabel as defaultReadLabel } from "./label-reader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const CORE_DIR = path.join(here, "core");
const JSON_LIMIT = 256 * 1024;
const LABEL_LIMIT = 8 * 1024 * 1024;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": isJson ? "application/json; charset=utf-8" : headers["content-type"] || "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        // 바로 끊으면 클라이언트는 413 대신 소켓 오류를 본다. 조금 더 받아 버리면서
        // 413을 먼저 보내고, 그래도 계속 밀어 넣으면 그때 끊는다.
        reject(Object.assign(new Error("too large"), { status: 413 }));
        if (size > limit * 4) req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

// 클라이언트가 보낸 제품은 필요한 필드만, 길이 제한을 걸어 받는다.
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
export function sanitizeProduct(p = {}) {
  const n = p.nutrition && typeof p.nutrition === "object" ? p.nutrition : null;
  const out = {
    name: str(p.name, 120), brand: str(p.brand, 60), foodType: str(p.foodType, 60),
    category: str(p.category, 30), barcode: str(p.barcode, 20).replace(/\D/g, ""), url: str(p.url, 500),
    ingredientsText: str(p.ingredientsText, 4000), nutritionText: str(p.nutritionText, 1000), allergenText: str(p.allergenText, 1000),
    nutrition: n && {
      basis: ["serving", "total", "per100"].includes(n.basis) ? n.basis : null, basisAmount: numOrNull(n.basisAmount),
      kcal: numOrNull(n.kcal), sodiumMg: numOrNull(n.sodiumMg), sugarG: numOrNull(n.sugarG),
      satFatG: numOrNull(n.satFatG), transFatG: numOrNull(n.transFatG), proteinG: numOrNull(n.proteinG)
    }
  };
  if (!out.category) out.category = inferCategory({ foodType: out.foodType, name: out.name }) || "";
  return out;
}

const publicProduct = (p) => p && ({
  id: p.id, barcode: p.barcode, name: p.name, brand: p.brand, category: p.category, foodType: p.foodType,
  ingredientsText: p.ingredientsText, nutritionText: p.nutritionText, allergenText: p.allergenText,
  nutrition: p.nutrition, source: p.source || (p.sample ? "sample" : undefined), sample: Boolean(p.sample)
});

export function createServer({
  catalog = createCatalog(),
  fetchProduct = (code) => fetchProductByBarcode(code),
  readLabel = defaultReadLabel,
  labelEnabled = Boolean(process.env.ANTHROPIC_API_KEY)
} = {}) {
  async function lookup(barcode) {
    const code = String(barcode || "").replace(/\D/g, "");
    if (!code) return null;
    const hit = catalog.byBarcode(code);
    if (hit) return hit;
    const fetched = await fetchProduct(code);
    return fetched ? catalog.remember(fetched) : null;
  }

  function verdictPayload(product, profileIn, mallIn) {
    const profile = normalizeProfile(profileIn);
    const mall = MALL_IDS.includes(mallIn) ? mallIn : null;
    const analysis = analyzeProduct(product, profile);
    const alternatives = analysis.score == null ? [] : rankAlternatives(
      { ...product, category: product.category || analysis.category },
      catalog.candidates(product.category || analysis.category),
      profile,
      { mall, base: analysis }
    ).map((a) => ({ ...a, product: publicProduct(a.product) }));
    if (product.source === "seen") analysis.notes.push("이 화면에서는 원재료 표가 안 보여, 같은 상품 페이지에서 전에 읽어 둔 원재료로 판정했습니다.");
    return { product: publicProduct(product), analysis, alternatives, links: buyLinks(product, mall) };
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const api = p.startsWith("/api/ansim/");
    const cors = api ? { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" } : {};

    if (req.method === "OPTIONS" && api) return send(res, 204, "", cors);

    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, "index.html")), { "content-type": TYPES[".html"], "cache-control": "no-cache" });
    }
    if (req.method === "GET" && /^\/(app\.js|manifest\.webmanifest|icon\.svg)$/.test(p)) {
      const file = path.join(PUBLIC_DIR, p.slice(1));
      return send(res, 200, fs.readFileSync(file), { "content-type": TYPES[path.extname(file)], "cache-control": "no-cache" });
    }
    if (req.method === "GET" && /^\/core\/[a-z-]+\.js$/.test(p)) {
      const file = path.join(CORE_DIR, path.basename(p));
      if (!fs.existsSync(file)) return send(res, 404, { error: "not found" });
      return send(res, 200, fs.readFileSync(file), { "content-type": TYPES[".js"], "cache-control": "no-cache" });
    }

    if (req.method === "GET" && p === "/api/ansim/config") {
      return send(res, 200, { labelReader: labelEnabled }, cors);
    }
    if (req.method === "GET" && p === "/api/ansim/samples") {
      return send(res, 200, { products: catalog.all().filter((x) => x.sample).map((x) => ({ barcode: x.barcode, name: x.name, category: x.category })) }, cors);
    }
    const m = p.match(/^\/api\/ansim\/product\/(\d{6,14})$/);
    if (req.method === "GET" && m) {
      const product = await lookup(m[1]);
      return product ? send(res, 200, { product: publicProduct(product) }, cors) : send(res, 404, { error: "not_found" }, cors);
    }

    if (req.method === "POST" && p === "/api/ansim/analyze") {
      const body = await readBody(req, JSON_LIMIT);
      let product = null;
      const mall = MALL_IDS.includes(body.mall) ? body.mall : null;
      if (body.barcode) product = await lookup(body.barcode);
      else if (body.notice) {
        const title = str(body.notice.title, 300);
        const url = str(body.notice.url, 500);
        product = sanitizeProduct(noticeToProduct({
          title, url,
          rows: Array.isArray(body.notice.rows) ? body.notice.rows.slice(0, 80).map((r) => [str(r?.[0], 60), str(r?.[1], 4000)]) : []
        }));
        // 페이지 제목(h1)과 고시표 '제품명' 둘 다로 기억한다 — 표가 접혀 있을 땐 제목만 보이고,
        // 앱에서는 URL 없이 상품명만 보인다
        const keys = [...new Set([...listingKeys({ url, title, mall }), ...listingKeys({ title: product.name })])];
        // 원재료가 보이면 기억하고, 안 보이면(표가 접혀 있음) 전에 읽어 둔 것을 쓴다
        if (product.ingredientsText) catalog.rememberListing(keys, product);
        else product = catalog.byListing(keys) || product;
      }
      else if (body.product) product = sanitizeProduct(body.product);
      if (!product) return send(res, 404, { error: "not_found" }, cors);
      return send(res, 200, verdictPayload(product, body.profile, body.mall), cors);
    }

    if (req.method === "POST" && p === "/api/ansim/label") {
      if (!labelEnabled) return send(res, 501, { error: "label_reader_not_configured" }, cors);
      const body = await readBody(req, LABEL_LIMIT);
      let extracted;
      try {
        extracted = await readLabel({ dataUrl: body.image });
      } catch (e) {
        const status = e.code === "BAD_IMAGE" ? 400 : e.code === "NO_KEY" ? 501 : 502;
        return send(res, status, { error: e.code === "BAD_IMAGE" ? "bad_image" : "label_reader_failed" }, cors);
      }
      if (!extracted.found || !(extracted.ingredientsText || extracted.nutritionText)) {
        return send(res, 422, { error: "label_not_readable", extracted }, cors);
      }
      const product = sanitizeProduct({ ...extracted, barcode: body.barcode });
      return send(res, 200, { extracted, ...verdictPayload(product, body.profile, body.mall) }, cors);
    }

    return send(res, 404, { error: "not found" }, cors);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "server error" }, { "access-control-allow-origin": "*", ...(e.status === 413 ? { connection: "close" } : {}) });
      else res.end();
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 4100;
  createServer().listen(port, () => {
    console.log(`안심스캔 http://localhost:${port}`);
    if (!process.env.MFDS_API_KEY) console.log("  MFDS_API_KEY 없음 — 예시 카탈로그 바코드만 조회됩니다.");
    if (!process.env.ANTHROPIC_API_KEY) console.log("  ANTHROPIC_API_KEY 없음 — 라벨 사진 분석이 꺼져 있습니다(원재료 직접 입력은 가능).");
  });
}
