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

// 브랜드 색 — index.html의 --color-accent(#e02b0f)와 어두운 배경에서 가져왔다.
const BG = [19, 18, 17];        // #131211
const ACCENT = [224, 43, 15];   // #e02b0f
const WARM = [255, 106, 82];    // #ff6a52

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

// 불꽃 — 원을 겹치면 얼룩으로 보인다. 높이에 따라 폭이 변하는 실루엣을
// 직접 계산해 그린다. 아래가 넓고 위로 갈수록 좁아지며 끝이 한쪽으로 휜다.
//   t: 0(바닥) → 1(꼭대기)
//   halfWidth(t) = 넓이 곡선, lean(t) = 휘어짐
function flame(cx, baseY, height, width, color, glow) {
  const halfW = (t) => Math.sin(Math.PI * Math.pow(t, 0.62)) * width * (1 - t * 0.12);
  const lean = (t) => Math.pow(t, 2.1) * height * 0.13;   // 끝이 오른쪽으로
  for (let s = 0; s <= height; s++) {
    const t = s / height;
    const y = baseY - s;
    const hw = halfW(t);
    const cxAt = cx + lean(t);
    for (let x = Math.floor(cxAt - hw); x <= Math.ceil(cxAt + hw); x++) {
      const d = Math.abs(x - cxAt) / (hw || 1);
      const edge = Math.min(1, (1 - d) * hw / 1.6);     // 가장자리 부드럽게
      if (edge <= 0) continue;
      // 아래쪽이 진하고 위로 갈수록 옅어진다 — 불꽃의 자연스러운 명암.
      const a = glow * (1 - t * 0.28) * edge;
      put(x, y, color, a);
    }
  }
}

const CX = W / 2, BASE = H / 2 + 168;
flame(CX, BASE, 336, 132, ACCENT, 236);          // 바깥 불꽃
flame(CX + 6, BASE - 26, 250, 84, WARM, 240);    // 안쪽 불꽃
flame(CX + 10, BASE - 58, 150, 42, [255, 226, 210], 235); // 심지

fs.writeFileSync(OUT, encodePNG(px, W, H));
console.log(`og.png  ${W}x${H}  ${fs.statSync(OUT).size} bytes`);
