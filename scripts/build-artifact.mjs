// Assemble a fully self-contained single-page artifact: inline the whole
// authenticity engine + seed data + a client-side UI (user view + admin view),
// so the "site" runs entirely in the browser with no server.
//
// Each engine module is wrapped in its own IIFE (exposing only its exports) so
// private helpers with shared names (clamp01/mean/stdev) don't collide.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src", "restaurants");
const PUB = path.join(__dirname, "..", "public");
const OUT = path.join(__dirname, "..", "public", "site.html");

// Dependency order.
const MODULES = [
  "geo.js", "taxonomy.js", "textintegrity.js", "timeseries.js",
  "authenticity.js", "corpus.js", "beliefprop.js", "ingest.js",
  "filter.js", "query.js", "data/seed.js"
];

function wrapModule(file) {
  let code = fs.readFileSync(path.join(SRC, file), "utf8");
  const names = new Set();
  for (const m of code.matchAll(/export\s+function\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  code = code
    .replace(/^\s*import\b[\s\S]*?;/gm, "") // strip import statements (incl. multi-line)
    .split("\n")
    .filter((l) => !/^\s*export\s*\{/.test(l)) // drop re-export lines
    .filter((l) => !/^\s*export\s+default\s/.test(l))
    .join("\n")
    .replace(/export\s+function\s+/g, "function ")
    .replace(/export\s+const\s+/g, "const ");
  const list = [...names].join(", ");
  return `/* ${file} */\nconst { ${list} } = (() => {\n${code}\nreturn { ${list} };\n})();\n`;
}

const engine = MODULES.map(wrapModule).join("\n");

const css = fs.readFileSync(path.join(PUB, "styles.css"), "utf8");
// admin.css minus its :root/*/body (user styles already define those)
let adminCss = fs.readFileSync(path.join(PUB, "admin.css"), "utf8")
  .replace(/:root\s*\{[^}]*\}/, "")
  .replace(/\*\s*\{[^}]*\}/, "")
  .replace(/body\s*\{[^}]*\}/, "");

const shell = fs.readFileSync(path.join(__dirname, "artifact-shell.html"), "utf8");

const html = shell
  .replace("/*__CSS__*/", css + "\n" + adminCss)
  .replace("/*__ENGINE__*/", engine);

fs.writeFileSync(OUT, html);
console.log("wrote", OUT, `(${(html.length / 1024).toFixed(0)} KB)`);
