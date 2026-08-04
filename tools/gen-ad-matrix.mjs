#!/usr/bin/env node
// 광고 문구 행렬 재생성. 주 1회 정도 돌리면 된다 (1회 약 $0.06).
//
//   ANTHROPIC_API_KEY=... node tools/gen-ad-matrix.mjs
//   (맥에서는) ANTHROPIC_API_KEY="$(security find-generic-password -a "$USER" -s nowhot-anthropic-api -w)" node tools/gen-ad-matrix.mjs
//
// 생성이 실패하면 기존 파일을 건드리지 않는다 — 광고가 사라지는 것보다
// 지난주 문구를 계속 쓰는 편이 낫다.
import { generateMatrix, saveMatrix } from "../src/feed/ad-matrix.js";
import { loadBanners } from "../src/feed/manual-products.js";

const dests = [...new Set(loadBanners().map((b) => b.dest).filter(Boolean))];
if (!dests.length) { console.error("도착지가 없다 — products.json 확인"); process.exit(1); }

const m = await generateMatrix({
  apiKey: process.env.ANTHROPIC_API_KEY,
  dests,
  log: (s) => console.log(s)
});
if (!m) { console.error("생성 실패 — 기존 행렬을 그대로 둔다"); process.exit(1); }
console.log("저장:", saveMatrix(m));
