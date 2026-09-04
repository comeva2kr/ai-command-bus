// 공유 미리보기 이미지(1200×630) 생성 — 의존성 없이.
//
// ── 왜 (2026-08-04 실측)
// og:image가 전 페이지 `icon-512.png`였다. 512 정사각 앱 아이콘이라 카카오톡·
// 트위터 공유 카드에서 작은 정사각형으로 뜬다. 한국에서 링크가 퍼지는 가장 큰
// 경로가 카톡인데, 미리보기가 앱 아이콘이면 클릭할 이유가 없다.
// 구글 Discover도 큰 이미지를 요구한다(1200px 이상).
//
// ── 왜 글자를 안 그리나
// 한글을 폰트 없이 픽셀로 그리는 건 이 프로젝트의 제약(외부 의존성 최소)에서
// 할 수 있는 일이 아니다. 대신 **제목은 미리보기 카드의 텍스트 줄이 담당**하고
// (og:title은 페이지마다 이미 다르다), 이미지는 브랜드 면으로 둔다.
// 앱 아이콘보다는 확실히 낫고, 지어낸 정보가 들어가지 않는다.
//
// 실행: node tools/make-og-image.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const W = 1200, H = 630;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "og.png");

// 앱 아이콘과 같은 색. 공유 카드에서도 같은 브랜드로 보여야 한다.
const BG = [0x11, 0x13, 0x19];      // #111319
const INK = [0xe8, 0xea, 0xf0];     // #e8eaf0
const SIGNAL = [0xff, 0x4b, 0x3e];  // #ff4b3e
const GRID = [0x35, 0x39, 0x45];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
// make-icons.mjs의 인코더는 정사각 전용(size 하나만 받는다)이라 여기서
// 너비·높이를 따로 받는 형태로 다시 썼다.
function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const px = Buffer.alloc(W * H * 4);
const put = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const na = Math.max(0, Math.min(1, a / 255)), ia = 1 - na;
  px[i] = px[i] * ia + r * na;
  px[i + 1] = px[i + 1] * ia + g * na;
  px[i + 2] = px[i + 2] * ia + b * na;
  px[i + 3] = 255;
};

// 바탕 — 가운데가 아주 살짝 밝은 비네트. 평평한 단색은 잘린 이미지처럼 보인다.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const v = Math.max(0, 1 - Math.hypot(dx, dy) * 0.72);
    put(x, y, [BG[0] + v * 16, BG[1] + v * 14, BG[2] + v * 13]);
  }
}

const distToSegment = (px, py, [x1, y1], [x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

function stroke(points, width, color) {
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const left = Math.floor(Math.min(a[0], b[0]) - half - 1);
    const right = Math.ceil(Math.max(a[0], b[0]) + half + 1);
    const top = Math.floor(Math.min(a[1], b[1]) - half - 1);
    const bottom = Math.ceil(Math.max(a[1], b[1]) + half + 1);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const alpha = Math.max(0, Math.min(1, half + 0.75 - distToSegment(x + 0.5, y + 0.5, a, b)));
        if (alpha) put(x, y, color, alpha * 255);
      }
    }
  }
}

function disc(cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
    for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
      const alpha = Math.max(0, Math.min(1, radius + 0.75 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (alpha) put(x, y, color, alpha * 255);
    }
  }
}

// 카카오 카드에서 작아져도 형태가 읽히도록 앱 아이콘의 상승선을 넓게 확대한다.
const SCALE = 1.55;
const map = ([x, y]) => [W / 2 + (x - 256) * SCALE, H / 2 + (y - 256) * SCALE];
const lineA = [[88, 368], [176, 330], [244, 346]].map(map);
const lineB = [[244, 346], [344, 150], [424, 214]].map(map);
const dot = map([344, 150]);

for (const y of [138, 315, 492]) {
  for (let x = 170; x <= W - 170; x++) put(x, y, GRID, 34);
}
stroke(lineA, 42 * SCALE, INK);
stroke(lineB, 42 * SCALE, SIGNAL);
disc(dot[0], dot[1], 30 * SCALE, SIGNAL);
disc(dot[0], dot[1], 13 * SCALE, BG);

fs.writeFileSync(OUT, encodePNG(px, W, H));
console.log(`og.png  ${W}x${H}  ${fs.statSync(OUT).size} bytes`);
