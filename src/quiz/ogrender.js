// PNG rasterization for OG share cards — optional dependency.
//
// The repo is intentionally zero-dependency by default (see server.js), so
// @resvg/resvg-js is declared as an *optionalDependency*: when it's present
// we rasterize the SVG from ogcard.js into a real PNG; when it's absent (or
// fails to load for any reason — missing native binary, unsupported
// platform, etc.) renderOgCardPng resolves to null so callers can fall back
// to a static image instead of crashing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");

// Memoized across calls — module load only needs to try the dynamic import
// once (success or failure) rather than repay the cost per request.
let cachedModulePromise = null;

function loadResvg() {
  if (!cachedModulePromise) {
    cachedModulePromise = import("@resvg/resvg-js").catch(() => null);
  }
  return cachedModulePromise;
}

function listFontFiles() {
  try {
    return fs
      .readdirSync(FONT_DIR)
      .filter((f) => f.endsWith(".otf") || f.endsWith(".ttf"))
      .map((f) => path.join(FONT_DIR, f));
  } catch {
    return [];
  }
}

// renderOgCardPng(svg) → Promise<Buffer|null>
// Buffer is a PNG (starts with the \x89PNG magic bytes) at 1200px width;
// null means the optional renderer isn't installed — caller should fall back.
export async function renderOgCardPng(svg) {
  const mod = await loadResvg();
  if (!mod || !mod.Resvg) return null;

  const { Resvg } = mod;
  const fontFiles = listFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: fontFiles.length
      ? { fontFiles, loadSystemFonts: false, defaultFontFamily: "Pretendard" }
      : { loadSystemFonts: true }
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

// Test-only: force the next renderOgCardPng call to retry the dynamic import
// (used to simulate the "dependency not installed" path deterministically).
export function _resetRendererCacheForTest() {
  cachedModulePromise = null;
}
