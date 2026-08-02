// 지금핫 앱 아이콘 PNG 생성기 (zero-dependency).
//
// 왜 필요한가: 2026-08-02 적대적 검수 실측에서 라스터 아이콘 14개 경로가 전부
// 404였다. 서빙되는 아이콘은 SVG 2개뿐인데 head에는 `apple-mobile-web-app-capable`
// 같은 iOS 설치 지원 태그가 있다 — 아이폰 홈화면에 추가하면 아이콘 자리가 빈다.
// manifest·apple-touch-icon·공유 카드 폴백 모두 PNG를 요구한다.
//
// 왜 직접 그리는가: 이 저장소는 npm 의존성을 쓰지 않는다(node: 내장만). SVG
// 래스터라이저를 붙일 수 없으므로, icon.svg와 **같은 도형을 픽셀로 다시 그린다**.
// 좌표·색은 icon.svg에서 그대로 옮겨왔다 — 한쪽을 고치면 다른 쪽도 고쳐야 한다.
// 안티에일리어싱은 4x 슈퍼샘플링으로 낸다.
//
// 실행: node tools/make-icons.mjs
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public");

// ── icon.svg에서 옮겨온 도형 정의 (viewBox 512) ────────────────────────────
const BG = [0x11, 0x13, 0x19];      // #111319
const INK = [0xe8, 0xea, 0xf0];     // #e8eaf0
const SIGNAL = [0xff, 0x4b, 0x3e];  // #ff4b3e
const RADIUS = 116;
const STROKE = 42;
const LINE_A = [[88, 368], [176, 330], [244, 346]];
const LINE_B = [[244, 346], [344, 150], [424, 214]];
const DOT = { x: 344, y: 150, outer: 30, inner: 13 };

// 점과 선분 사이 거리 — 둥근 캡/조인은 "선분까지의 거리 <= 반지름"으로 자연히 나온다
function distToSegment(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function nearPolyline(px, py, pts, halfWidth) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(px, py, pts[i], pts[i + 1]) <= halfWidth) return true;
  }
  return false;
}

// 라운드 사각형 내부인가 (viewBox 좌표)
function insideRoundRect(x, y, size, r) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = x < r ? r : x > size - r ? size - r : x;
  const cy = y < r ? r : y > size - r ? size - r : y;
  if (cx === x || cy === y) return true;
  return Math.hypot(x - cx, y - cy) <= r;
}

// viewBox 좌표 한 점의 색 (없으면 null = 투명)
function sampleAt(x, y) {
  if (!insideRoundRect(x, y, 512, RADIUS)) return null;
  const half = STROKE / 2;
  const dDot = Math.hypot(x - DOT.x, y - DOT.y);
  if (dDot <= DOT.inner) return BG;              // 점 가운데 구멍
  if (dDot <= DOT.outer) return SIGNAL;
  if (nearPolyline(x, y, LINE_B, half)) return SIGNAL;
  if (nearPolyline(x, y, LINE_A, half)) return INK;
  return BG;
}

// 4x 슈퍼샘플링 — 알파와 색을 함께 평균낸다
function renderRGBA(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  const scale = 512 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sampleAt((px + (sx + 0.5) / SS) * scale, (py + (sy + 0.5) / SS) * scale);
          if (c) { r += c[0]; g += c[1]; b += c[2]; hits++; }
        }
      }
      const o = (py * size + px) * 4;
      const total = SS * SS;
      if (hits) {
        buf[o] = Math.round(r / hits);
        buf[o + 1] = Math.round(g / hits);
        buf[o + 2] = Math.round(b / hits);
        buf[o + 3] = Math.round((hits / total) * 255);
      }
    }
  }
  return buf;
}

// 마스커블 아이콘: 안전영역(중앙 80%) 밖이 잘려도 마크가 살아남게 배경을 꽉 채우고
// 마크를 축소해 넣는다. 라운드 없이 정사각 — OS가 자기 모양으로 마스킹한다.
function renderMaskableRGBA(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  const scale = 512 / size;
  const shrink = 0.72;              // 마크를 72%로 줄여 안전영역 안에 둔다
  const off = (512 * (1 - shrink)) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const vx = (px + (sx + 0.5) / SS) * scale;
          const vy = (py + (sy + 0.5) / SS) * scale;
          const mx = (vx - off) / shrink;
          const my = (vy - off) / shrink;
          let c = BG;
          if (mx >= 0 && my >= 0 && mx <= 512 && my <= 512) {
            const half = STROKE / 2;
            const dDot = Math.hypot(mx - DOT.x, my - DOT.y);
            if (dDot <= DOT.inner) c = BG;
            else if (dDot <= DOT.outer) c = SIGNAL;
            else if (nearPolyline(mx, my, LINE_B, half)) c = SIGNAL;
            else if (nearPolyline(mx, my, LINE_A, half)) c = INK;
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (py * size + px) * 4;
      const total = SS * SS;
      buf[o] = Math.round(r / total);
      buf[o + 1] = Math.round(g / total);
      buf[o + 2] = Math.round(b / total);
      buf[o + 3] = 255;
    }
  }
  return buf;
}

// ── 최소 PNG 인코더 (RGBA8, 필터 0) ────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true }
];

for (const t of targets) {
  const rgba = t.maskable ? renderMaskableRGBA(t.size) : renderRGBA(t.size);
  const png = encodePNG(rgba, t.size);
  fs.writeFileSync(path.join(OUT_DIR, t.file), png);
  console.log(`${t.file}  ${t.size}x${t.size}  ${png.length} bytes`);
}
