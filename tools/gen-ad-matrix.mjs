#!/usr/bin/env node
// 광고 문구 행렬 재생성. 주 1회 정도 돌리면 된다 (1회 약 $0.06).
//
//   ANTHROPIC_API_KEY=... node tools/gen-ad-matrix.mjs
//   (맥에서는) ANTHROPIC_API_KEY="$(security find-generic-password -a "$USER" -s nowhot-anthropic-api -w)" node tools/gen-ad-matrix.mjs
//
// 생성이 실패하면 기존 파일을 건드리지 않는다 — 광고가 사라지는 것보다
// 지난주 문구를 계속 쓰는 편이 낫다.
import { generateMatrix, saveMatrix, loadMatrix } from "../src/feed/ad-matrix.js";
import { loadBanners } from "../src/feed/manual-products.js";
import { fetchInterests } from "../src/feed/interest.js";
import { winningVariants } from "../src/feed/ad-networks.js";
import fs from "node:fs";

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

// 지난주에 실제로 눌린 문구를 본보기로 넘긴다. 이게 없으면 매주 감으로 새로
// 만드는 것과 같다 — 나아지는지 알 수 없다(David 2026-08-05 제안에 더한 것).
// 노출이 최소한 쌓인 것만 고른다. 노출 3건짜리 100%를 "잘 된 문구"라고 넘기면
// 다음 주가 더 나빠진다 — 베이지안 축소로 그걸 막는다(ad-networks.js).
let winners = [];
try {
  const db = JSON.parse(fs.readFileSync(process.env.FEED_DB, "utf8"));
  winners = winningVariants(db.adEvents || [], loadMatrix());
} catch { /* 성적이 없으면 없는 대로 만든다 */ }
if (winners.length) {
  console.log("[admatrix] 지난주 잘 된 문구", winners.length, "개 반영");
  winners.forEach((w) => console.log(`   ${w.ctr}%  [${w.dest}] ${w.hook}`));
} else {
  console.log("[admatrix] 아직 성적이 없다 — 트렌드만으로 만든다");
}

// 도착지를 나눠 부른다. 한 번에 18곳 × 맥락 5개 × 변형 3개 × 필드 3개를
// 요구하면 출력이 잘린다(2026-08-05 실측). 나누면 한 배치가 실패해도 나머지는
// 살아남는다 — 전부 아니면 전무보다 낫다.
const CHUNK = 6;
// **기존 행렬 위에 덮어쓴다.** 처음엔 새 것만 저장했는데, 실패한 배치의
// 도착지가 파일에서 통째로 사라졌다(2026-08-05 실측: 12/18 성공 → 6곳 유실).
// 한 배치가 실패했다고 멀쩡하던 문구까지 잃을 이유가 없다.
const merged = { variants: { ...(loadMatrix().variants || {}) } };
let okCount = 0;
for (let i = 0; i < dests.length; i += CHUNK) {
  const part = dests.slice(i, i + CHUNK);
  console.log(`[admatrix] ${i / CHUNK + 1}차 — ${part.join(", ")}`);
  const m = await generateMatrix({
    apiKey: process.env.ANTHROPIC_API_KEY,
    dests: part,
    trends,
    winners,
    log: (s) => console.log(s)
  });
  if (!m || !m.variants) { console.error(`  실패 — 이 배치는 건너뛴다`); continue; }
  Object.assign(merged.variants, m.variants);
  okCount += Object.keys(m.variants).length;
}
if (!okCount) { console.error("전부 실패 — 기존 행렬을 그대로 둔다"); process.exit(1); }
console.log(`[admatrix] 도착지 ${okCount}/${dests.length}곳 생성`);
console.log("저장:", saveMatrix(merged));
