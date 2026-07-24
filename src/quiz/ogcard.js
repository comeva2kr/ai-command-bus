// OG share card — pure SVG generator, zero dependencies.
//
// Kakao/Facebook/Twitter link-preview crawlers do not rasterize SVG, so
// og:image needs a PNG. This module only builds the SVG string (the
// deterministic, fully-testable half); src/quiz/ogrender.js turns it into a
// PNG via the optional @resvg/resvg-js dependency.
//
// Two card kinds:
//   result === null → "cover" card for the quiz landing page.
//   result given     → per-type result card (the I-got share screenshot).
//
// Design constraints (see docs/quiz-design.md and the OG-card spec this file
// implements):
//   - Same input → same output. No Date.now()/Math.random() anywhere.
//   - Per-type hue via the golden angle (137.508°) so colors never collide
//     regardless of how many result types a quiz has.
//   - Never fabricate per-user axis percentages on the card — only the
//     type's pole *labels* (evidence we actually have), never invented %s.

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const MARGIN_X = 80;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN_X * 2;
const GOLDEN_ANGLE = 137.508;
const FONT_STACK = "Pretendard, 'Noto Sans KR', sans-serif";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Deterministic hue for a quiz's cover card: sum of the title's code points.
function coverHue(title) {
  let sum = 0;
  for (const ch of String(title || "")) sum += ch.codePointAt(0);
  return sum % 360;
}

// Deterministic per-type hue: golden-angle stepping never repeats regardless
// of the number of result types.
function typeHue(typeIndex) {
  return ((typeIndex * GOLDEN_ANGLE) % 360 + 360) % 360;
}

function wrapMod(h) {
  return ((h % 360) + 360) % 360;
}

// Rough text-width estimate for pill/chip sizing (not real shaping — resvg
// does the actual glyph layout; this only needs to be close enough that
// pills/chips don't overlap).
const CJK_RE = /[ㄱ-힝一-鿿]/;
function textWidth(str, fontSize) {
  let w = 0;
  for (const ch of Array.from(String(str || ""))) {
    w += CJK_RE.test(ch) ? fontSize : fontSize * 0.58;
  }
  return w;
}

// Break a long title into (at most) two lines, preferring a whitespace break
// near the midpoint; otherwise a hard character split. Also returns a font
// size scaled down from the 76px base once the longest line exceeds the
// ~12-character budget the base size was tuned for, floored at 48px.
function fitTitle(title) {
  const chars = Array.from(String(title || ""));
  const BASE = 76;
  const MIN = 48;
  const BUDGET = 12;
  if (chars.length <= BUDGET) return { lines: [chars.join("")], fontSize: BASE };

  const mid = Math.ceil(chars.length / 2);
  let breakAt = -1;
  for (let d = 0; d < chars.length; d++) {
    if (chars[mid + d] === " ") {
      breakAt = mid + d;
      break;
    }
    if (mid - d >= 0 && chars[mid - d] === " ") {
      breakAt = mid - d;
      break;
    }
  }
  if (breakAt === -1) breakAt = mid;
  const line1 = chars.slice(0, breakAt).join("").trim();
  const line2 = chars.slice(breakAt).join("").trim();
  const lines = [line1, line2].filter(Boolean);
  const longest = Math.max(...lines.map((l) => Array.from(l).length));
  const fontSize = longest > BUDGET ? Math.max(MIN, Math.round(BASE * (BUDGET / longest))) : BASE;
  return { lines, fontSize };
}

function pill(x, y, text, { bg, fg, fontSize = 26, padX = 18, padY = 10, opacity = 1 }) {
  const w = textWidth(text, fontSize) + padX * 2;
  const h = fontSize + padY * 2;
  return {
    width: w,
    height: h,
    svg: `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/><text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.35}" text-anchor="middle" font-size="${fontSize}" font-weight="600" fill="${fg}">${esc(text)}</text></g>`
  };
}

// Lay out a row of pills left-to-right, wrapping to new rows if they would
// overflow CONTENT_WIDTH. Returns the combined svg and the total height used.
function chipRow(x0, y0, texts, style) {
  let x = x0;
  let y = y0;
  let rowHeight = 0;
  let out = "";
  const gap = 12;
  const maxX = MARGIN_X + CONTENT_WIDTH;
  for (const text of texts) {
    const p = pill(x, y, text, style);
    if (x !== x0 && x + p.width > maxX) {
      x = x0;
      y += rowHeight + gap;
      rowHeight = 0;
      const p2 = pill(x, y, text, style);
      out += p2.svg;
      x += p2.width + gap;
      rowHeight = Math.max(rowHeight, p2.height);
      continue;
    }
    out += p.svg;
    x += p.width + gap;
    rowHeight = Math.max(rowHeight, p.height);
  }
  return { svg: out, height: y - y0 + rowHeight };
}

function background(hue) {
  const stop1 = `hsl(${hue}, 62%, 22%)`;
  const stop2 = `hsl(${wrapMod(hue + 24)}, 68%, 34%)`;
  return `<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="${stop1}"/>
<stop offset="100%" stop-color="${stop2}"/>
</linearGradient></defs>
<rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>`;
}

function ctaBar(accent, origin) {
  const barY = CARD_HEIGHT - 96;
  const barH = 96;
  const domain = origin ? domainOf(origin) : "";
  const main = "너는 어떤 유형? → 테스트 하러 가기";
  return `<rect x="0" y="${barY}" width="${CARD_WIDTH}" height="${barH}" fill="${accent}" opacity="0.16"/>
<rect x="0" y="${barY}" width="6" height="${barH}" fill="${accent}"/>
<text x="${MARGIN_X}" y="${barY + barH / 2 + (domain ? -6 : 8)}" font-size="30" font-weight="700" fill="#ffffff">${esc(main)}</text>
${domain ? `<text x="${MARGIN_X}" y="${barY + barH / 2 + 26}" font-size="20" fill="#ffffff" opacity="0.7">${esc(domain)}</text>` : ""}`;
}

function domainOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return String(origin || "").replace(/^https?:\/\/+/, "").replace(/\/.*$/, "");
  }
}

/**
 * renderOgCardSvg(quiz, result, opts) → 1200x630 SVG string.
 *
 * @param {object} quiz - the quiz record's `quiz` object (title, axes, results…)
 * @param {object|null} result - one of quiz.results, or null for the cover card
 * @param {object} [opts]
 * @param {number} [opts.sharePercent] - integer 0~100; rarity badge (result cards only)
 * @param {string} [opts.origin] - absolute origin, e.g. "https://example.com"
 */
export function renderOgCardSvg(quiz, result, opts = {}) {
  return result ? renderTypeCard(quiz, result, opts) : renderCoverCard(quiz, opts);
}

function renderTypeCard(quiz, result, opts) {
  const typeIndex = quiz.results.findIndex((r) => r.code === result.code);
  const hue = typeHue(typeIndex < 0 ? 0 : typeIndex);
  const accent = `hsl(${hue}, 85%, 62%)`;

  let y = 0;
  let body = background(hue);

  // 1) quiz title (re-entry hook)
  y = 100;
  body += `<text x="${MARGIN_X}" y="${y}" font-size="28" fill="#ffffff" opacity="0.75">${esc(quiz.title)}</text>`;

  // 2) "나는" label + big type name (I-got capture value)
  y += 60;
  body += `<text x="${MARGIN_X}" y="${y}" font-size="40" font-weight="500" fill="#ffffff" opacity="0.9">나는</text>`;
  const { lines, fontSize } = fitTitle(result.title);
  const lineHeight = fontSize * 1.18;
  y += fontSize * 0.85;
  for (const line of lines) {
    body += `<text x="${MARGIN_X}" y="${y}" font-size="${fontSize}" font-weight="800" fill="#ffffff">${esc(line)}</text>`;
    y += lineHeight;
  }
  y += 8;

  // 3) rarity badge
  if (opts.sharePercent != null) {
    const n = Math.round(opts.sharePercent);
    let text = `응답자 중 ${n}%`;
    if (n <= 15) text += " · 희귀 유형";
    const p = pill(MARGIN_X, y, text, { bg: accent, fg: "#101014", fontSize: 24 });
    body += p.svg;
    y += p.height + 24;
  } else {
    y += 12;
  }

  // 4) axis pole chips — evidence of personalization, never invented % numbers
  const chipTexts = quiz.axes.map((axis, i) => {
    const code = result.code[i];
    const pole = code === axis.left.code ? axis.left : axis.right;
    return pole.label;
  });
  const chips = chipRow(MARGIN_X, y, chipTexts, {
    bg: "rgba(255,255,255,0.14)",
    fg: "#ffffff",
    fontSize: 22
  });
  body += chips.svg;

  body += ctaBar(accent, opts.origin);

  return wrapSvg(body);
}

function renderCoverCard(quiz, opts) {
  const hue = coverHue(quiz.title);
  const accent = `hsl(${hue}, 85%, 62%)`;
  let body = background(hue);

  const { lines, fontSize } = fitTitle(quiz.title);
  const lineHeight = fontSize * 1.18;
  let y = 220 - ((lines.length - 1) * lineHeight) / 2;
  for (const line of lines) {
    body += `<text x="${MARGIN_X}" y="${y}" font-size="${fontSize}" font-weight="800" fill="#ffffff">${esc(line)}</text>`;
    y += lineHeight;
  }
  y += 24;

  const n = Array.isArray(quiz.results) ? quiz.results.length : 0;
  body += `<text x="${MARGIN_X}" y="${y}" font-size="34" font-weight="600" fill="#ffffff" opacity="0.9">${esc(`${n}가지 유형 중 넌 뭐야?`)}</text>`;

  body += ctaBar(accent, opts.origin);

  return wrapSvg(body);
}

function wrapSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<g font-family="${FONT_STACK}">
${body}
</g>
</svg>`;
}
