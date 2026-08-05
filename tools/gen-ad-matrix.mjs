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
import { fetchInterests } from "../src/feed/interest.js";

const dests = [...new Set(loadBanners().map((b) => b.dest).filter(Boolean))];
if (!dests.length) { console.error("도착지가 없다 — products.json 확인"); process.exit(1); }

// 지금 사람들이 실제로 검색하는 말을 함께 넘긴다 — David 2026-08-05:
// "당연히 서치베이스여야지. 사람들 관심사나 토픽에서 끌어온 근거로 만드는 거지."
// 어조·계절감의 힌트로만 쓴다(문구에 검색어를 그대로 박으면 그 도착지에 그게
// 있다는 말이 되는데 우리는 모른다 — 프롬프트에 그렇게 못 박아 뒀다).
// 실패해도 생성은 진행한다. 근거 한 축이 빠질 뿐이다.
let trends = [];
try { trends = (await fetchInterests()).map((t) => t.term); }
catch { console.log("[admatrix] 트렌드 없이 진행"); }
if (trends.length) console.log("[admatrix] 트렌드", trends.length, "개 반영");

const m = await generateMatrix({
  apiKey: process.env.ANTHROPIC_API_KEY,
  dests,
  trends,
  log: (s) => console.log(s)
});
if (!m) { console.error("생성 실패 — 기존 행렬을 그대로 둔다"); process.exit(1); }
console.log("저장:", saveMatrix(m));
