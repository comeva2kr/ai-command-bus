// Assemble a self-contained single-page artifact from the real app files
// (index.html + styles.css + app.js) by inlining the whole authenticity engine
// and shimming fetch('/api/*') to run the engine client-side. Single source of
// truth: the served app and the artifact are the same code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src", "restaurants");
const PUB = path.join(__dirname, "..", "public");
const OUT = path.join(PUB, "site.html");

const MODULES = [
  "geo.js", "taxonomy.js", "textintegrity.js", "timeseries.js",
  "authenticity.js", "corpus.js", "beliefprop.js", "ingest.js",
  "filter.js", "query.js", "data/seed.js"
];

// Wrap each engine module in an IIFE exposing only its exports (private helpers
// like clamp01/mean/stdev then don't collide across modules).
function wrapModule(file) {
  let code = fs.readFileSync(path.join(SRC, file), "utf8");
  const names = new Set();
  for (const m of code.matchAll(/export\s+function\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  code = code
    .replace(/^\s*import\b[\s\S]*?;/gm, "")
    .split("\n")
    .filter((l) => !/^\s*export\s*\{/.test(l))
    .filter((l) => !/^\s*export\s+default\s/.test(l))
    .join("\n")
    .replace(/export\s+function\s+/g, "function ")
    .replace(/export\s+const\s+/g, "const ");
  const list = [...names].join(", ");
  return `/* ${file} */\nconst { ${list} } = (() => {\n${code}\nreturn { ${list} };\n})();\n`;
}
const engine = MODULES.map(wrapModule).join("\n");

const css = fs.readFileSync(path.join(PUB, "styles.css"), "utf8");
const appjs = fs.readFileSync(path.join(PUB, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
const bodyInner = indexHtml
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script\s+src="\/app\.js"><\/script>/, "");

const shim = `
const PRESETS = {
  "kids-pork": { label: "프랜차이즈 아닌 뒷고기 고깃집 + 키즈카페", query: { styles: ["고깃집"], cuisines: ["돼지고기"], excludeFranchise: true, require: { kidsCafe: true }, prefer: ["뒷고기"] } },
  "izakaya-aged": { label: "이자카야 · 숙성회 · 파티션", query: { styles: ["이자카야"], tagsAll: ["숙성회"], excludeTags: ["가성비"], prefer: ["고급스러운"], preferFeatures: { partition: true }, priceMin: 2 } },
  "sejong-mackerel": { label: "세종 · 차로 30분 · 활고등어회", query: { location: { near: "세종" }, travel: { mode: "car", minutes: 30 }, menu: "고등어회", menuAttrs: ["활"] } }
};
const META = { landmarks: Object.keys(LANDMARKS), styles: Object.keys(STYLE_SYNONYMS), cuisines: Object.keys(CUISINE_SYNONYMS), tags: Object.keys(TAG_SYNONYMS), menus: Object.keys(MENU_SYNONYMS), menuAttrs: Object.keys(MENU_ATTR_SYNONYMS), features: FEATURE_KEYS };
META.presets = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label]));
const _resp = (d) => ({ ok: true, json: async () => d });
const _orig = window.fetch ? window.fetch.bind(window) : null;
window.fetch = async (url, opts = {}) => {
  const s = String(url), p = s.split("?")[0], qs = new URLSearchParams(s.split("?")[1] || "");
  if (p === "/api/meta") return _resp(META);
  if (p === "/api/search") return _resp(search(SEED_RESTAURANTS, JSON.parse(opts.body || "{}")));
  if (p === "/api/preset") { const q = { ...PRESETS[qs.get("name")].query }; if (qs.get("all") === "1") q.includeUnverified = true; return _resp({ query: q, ...search(SEED_RESTAURANTS, q) }); }
  if (_orig) return _orig(url, opts); throw new Error("no route " + p);
};
`;

const html = `<title>찐맛집 · 검증된 맛집만</title>
<style>
${css}
</style>
${bodyInner}
<script>
${engine}
${shim}
${appjs}
</script>
`;

fs.writeFileSync(OUT, html);
console.log("wrote", OUT, `(${(html.length / 1024).toFixed(0)} KB)`);
