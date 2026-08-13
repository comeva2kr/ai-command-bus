#!/usr/bin/env node
// C5 신규 소스 공급 분리 측정 (David 지시, 2026-08-13).
//
// "원시 후보 약 100건/24h"는 원시치다 — 소스별로 4단 지표를 분리 실측한다:
//   ① 원시 24h 후보     실 fetch 결과 중 publishedAt이 최근 24h인 건수
//   ② 고유 사건 수      event-cluster 실코드(buildEventClusters)로 신규 소스 간
//                        + 기존 스냅샷 풀(.nowhot-local/feed-data-pool.json)과
//                        함께 결합한 뒤, 이 소스 기사가 앵커(최초 발행)인 사건 수.
//                        기존 풀 사건이나 타 신규 소스 사건에 흡수된 건은
//                        "흡수" 열로 분리해 계수한다(사건은 1회만 센다).
//   ③ 분류 통과 수      engine._classifyItems의 specialist 경로를 그대로 재현
//                        (definiteCategory 확정 사전 → category-policy.js
//                        specialistCorrection, NB는 풀의 TRAIN_LABELS 소스로 학습)
//                        한 뒤 선언 카테고리가 유지된 ② 앵커 수
//   ④ 신선도 통과 수    현행 편성 신선도 창(engine.js MAX_AGE_H_NEWS=24h,
//                        maxAgeH 오버라이드 없음) 기준으로 ③ 중 잔존 건수
//
// 판정 코드는 전부 src/feed 실코드 import — 재발명 없음. 저장소의 다른 파일은
// 수정하지 않는다.
//
// 사용:
//   node tools/eval-source-supply.mjs [id ...] [id=URL ...]
//   인자 없으면 기본 대상: 등재 6종(cnbc-economy bbc-business fnnews-economy
//   nasa livescience espn) + 미등재 후보 2종(bbc-sport, yonhap-sports — URL 직접
//   지정, category=sports로 가정).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rssFetcher } from "../src/feed/fetchers.js";
import { buildEventClusters } from "../src/feed/event-cluster.js";
import {
  TitleClassifier, TRAIN_LABELS, definiteCategory, UNTRAINED_CATEGORIES
} from "../src/feed/classify.js";
import {
  specialistCorrection, untrainedOverrideAllowed, isTranslatedTitle
} from "../src/feed/category-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// engine.js와 같은 값 — export되지 않아 값을 명시하되 출처를 적는다.
const MAX_AGE_H_NEWS = 24;                 // src/feed/engine.js:123
const MIN_NB_TRAINING_ROWS = 100;          // src/feed/engine.js:76
const SECTIONED_NEWS_TITLE_OVERRIDES = new Set(["auto", "gaming", "science"]); // engine.js:73

const registry = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "src", "feed", "communities.json"), "utf8")).communities;
const byId = new Map(registry.map((c) => [c.id, c]));

// 미등재 후보의 기본 URL. bbc-sport URL은 P2-C 실측 기록의 후보(BBC 공식 스포츠
// 섹션 피드). yonhap-sports는 연합뉴스 공식 스포츠 RSS 경로 — fetch가 실패하면
// 그대로 실패로 보고한다(숫자 발명 금지).
const UNLISTED_DEFAULTS = new Map([
  ["bbc-sport", { url: "https://feeds.bbci.co.uk/sport/rss.xml", category: "sports", operatorGroup: "bbc" }],
  ["yonhap-sports", { url: "https://www.yna.co.kr/rss/sports.xml", category: "sports", operatorGroup: "yonhap" }]
]);

const args = process.argv.slice(2);
const targets = [];
const specs = args.length ? args : [
  "cnbc-economy", "bbc-business", "fnnews-economy", "nasa", "livescience", "espn",
  "bbc-sport", "yonhap-sports"
];
for (const spec of specs) {
  const eq = spec.indexOf("=");
  if (eq > 0) {
    const id = spec.slice(0, eq);
    const url = spec.slice(eq + 1);
    const d = UNLISTED_DEFAULTS.get(id) || {};
    targets.push({ id, url, category: d.category || "news", registered: false });
    continue;
  }
  const entry = byId.get(spec);
  if (entry) {
    targets.push({
      id: entry.id, url: entry.adapter && entry.adapter.url,
      category: entry.category, registered: true, entry
    });
  } else if (UNLISTED_DEFAULTS.has(spec)) {
    const d = UNLISTED_DEFAULTS.get(spec);
    targets.push({ id: spec, url: d.url, category: d.category, registered: false });
  } else {
    console.error(`알 수 없는 소스: ${spec} (id=URL 형식으로 직접 지정 가능)`);
    process.exit(1);
  }
}

// ── 스냅샷 풀 로드 — 사건 결합의 "기존 풀" 축 ─────────────────────────────
const poolFile = process.env.FEED_POOL_FILE
  || path.join(__dirname, "..", ".nowhot-local", "feed-data-pool.json");
const pool = JSON.parse(fs.readFileSync(poolFile, "utf8"));
const now = Date.now();
const targetIds = new Set(targets.map((t) => t.id));
// 내용어 결합의 발행 창이 24h(EVENT_MERGE_RULES.publishWindowHours)이므로
// 풀은 48h 이내 발행분만 결합 상대로 넣는다 — 그 밖은 결합 불가라 계산 낭비.
const poolItems = (pool.rows || []).map((r) => r.item)
  .filter((it) => it && it.title && !targetIds.has(it.source))
  .filter((it) => {
    const t = Date.parse(it.publishedAt || "");
    return Number.isFinite(t) && now - t <= 48 * 3600 * 1000;
  });

// ── NB 학습 — engine과 같은 규칙(TRAIN_LABELS 소스 제목만) ────────────────
const classifier = new TitleClassifier();
for (const it of (pool.rows || []).map((r) => r.item)) {
  if (!it || !it.title) continue;
  const label = TRAIN_LABELS.get(it.source);
  if (label) classifier.learn(it.title, label.category, label.weight);
}

// ── specialist 분류 경로 재현 (engine._classifyItems, engine.js:774-859) ──
// 대상 8종은 전부 kind=news·선언 카테고리 보유(sectioned)·sourceTier=specialist
// (미등재 후보 2종도 같은 성격이므로 같은 경로로 판정한다).
function classifyOutcome(item) {
  if (UNTRAINED_CATEGORIES.has(item.category)) return { category: item.category, via: "untrained-protected" };
  const definite = definiteCategory({ title: item.title, url: item.url, sourceId: item.source });
  const urlDefinite = definiteCategory({ title: "", url: item.url, sourceId: item.source });
  if (definite && (SECTIONED_NEWS_TITLE_OVERRIDES.has(definite) || urlDefinite === definite)) {
    if (untrainedOverrideAllowed({ toCategory: definite, title: item.title, translated: isTranslatedTitle(item) })
      && definite !== item.category) {
      return { category: definite, via: "title-definite" };
    }
    return { category: item.category, via: "declared" };
  }
  if (classifier.trained >= MIN_NB_TRAINING_ROWS) {
    const corrected = specialistCorrection({
      declaredCategory: item.category,
      title: item.title,
      prediction: classifier.predict(item.title)
    });
    if (corrected) return { category: corrected.category, via: `nb-correction(${corrected.correction.hits.join("·")})` };
  }
  return { category: item.category, via: "declared" };
}

// ── 실 fetch ──────────────────────────────────────────────────────────────
const results = [];
const fetched = new Map();
for (const t of targets) {
  if (!t.url) { results.push({ ...t, error: "adapter URL 없음" }); continue; }
  try {
    const rows = await rssFetcher(t.url)();
    fetched.set(t.id, rows.map((r, i) => ({
      ...r,
      id: `${t.id}_${i}`,
      source: t.id,
      kind: "news",
      category: t.category
    })));
  } catch (e) {
    results.push({ ...t, error: String(e && e.message || e) });
  }
}

// ── 4단 계산 ──────────────────────────────────────────────────────────────
const withinH = (it, h) => {
  const ts = Date.parse(it.publishedAt || "");
  return Number.isFinite(ts) && now - ts <= h * 3600 * 1000 && ts <= now + 3600 * 1000;
};
const raw24ById = new Map();
const all24 = [];
for (const t of targets) {
  const rows = fetched.get(t.id);
  if (!rows) continue;
  const r24 = rows.filter((it) => withinH(it, 24));
  raw24ById.set(t.id, { feedTotal: rows.length, raw24: r24 });
  all24.push(...r24);
}

// 결합: 기존 풀(48h) + 신규 소스 24h 전량을 한 번에 클러스터링.
const clusters = buildEventClusters([...poolItems, ...all24]);
const clusterByArticleId = new Map();
for (const ev of clusters) {
  for (const aid of [...ev.memberArticleIds, ...ev.reactionArticleIds]) {
    if (aid) clusterByArticleId.set(aid, ev);
  }
}
const isNewArticleId = (aid) => typeof aid === "string" && targetIds.has(aid.replace(/_\d+$/, ""));
const anchorSourceOf = (ev) => {
  // memberArticleIds는 발행순 정렬 — 첫 구성원이 앵커.
  const first = ev.memberArticleIds[0];
  return typeof first === "string" ? first.replace(/_\d+$/, "") : null;
};

for (const t of targets) {
  const got = raw24ById.get(t.id);
  if (!got) continue; // fetch 실패는 이미 results에 있음
  const { feedTotal, raw24 } = got;
  const myEvents = new Set();
  for (const it of raw24) {
    const ev = clusterByArticleId.get(it.id);
    if (ev) myEvents.add(ev);
  }
  const anchored = [...myEvents].filter((ev) => anchorSourceOf(ev) === t.id);
  const absorbedByPool = [...myEvents].filter((ev) => {
    const a = anchorSourceOf(ev);
    return a && !targetIds.has(a);
  }).length;
  const absorbedByPeer = myEvents.size - anchored.length - absorbedByPool;
  // ③ 분류: 앵커 사건의 대표(이 소스의 최초 기사)로 판정.
  const itemById = new Map(raw24.map((it) => [it.id, it]));
  const anchorItems = anchored.map((ev) => itemById.get(ev.memberArticleIds[0])).filter(Boolean);
  const kept = anchorItems.filter((it) => classifyOutcome(it).category === it.category);
  const reclassified = anchorItems.filter((it) => classifyOutcome(it).category !== it.category)
    .map((it) => ({ title: it.title, to: classifyOutcome(it).category, via: classifyOutcome(it).via }));
  // ④ 신선도: kind=news 창 24h(대상 8종 전부 maxAgeH 오버라이드 없음 확인).
  const fresh = kept.filter((it) => withinH(it, MAX_AGE_H_NEWS));
  results.push({
    ...t, feedTotal, raw24: raw24.length,
    events: anchored.length, absorbedByPool, absorbedByPeer,
    classified: kept.length, reclassified, fresh: fresh.length
  });
}

// ── 출력 ──────────────────────────────────────────────────────────────────
console.log(`# C5 신규 소스 공급 분리 측정 — ${new Date(now).toISOString()}`);
console.log(`풀: ${poolFile} (48h 결합창 내 ${poolItems.length}건, NB 학습 ${classifier.trained}건)`);
console.log(`신선도 창: kind=news ${MAX_AGE_H_NEWS}h (src/feed/engine.js:123 MAX_AGE_H_NEWS, 소스별 maxAgeH 오버라이드 없음)`);
console.log("");
console.log("| 소스 | 피드전체 | ①원시24h | ②고유사건 | 흡수(풀/신규간) | ③분류통과 | ④신선도통과 |");
console.log("|---|---|---|---|---|---|---|");
const sum = { feedTotal: 0, raw24: 0, events: 0, ap: 0, an: 0, classified: 0, fresh: 0 };
for (const r of results) {
  if (r.error) { console.log(`| ${r.id} | fetch 실패: ${r.error} | - | - | - | - | - |`); continue; }
  console.log(`| ${r.id}${r.registered ? "" : " (미등재)"} | ${r.feedTotal} | ${r.raw24} | ${r.events} | ${r.absorbedByPool}/${r.absorbedByPeer} | ${r.classified} | ${r.fresh} |`);
  sum.feedTotal += r.feedTotal; sum.raw24 += r.raw24; sum.events += r.events;
  sum.ap += r.absorbedByPool; sum.an += r.absorbedByPeer;
  sum.classified += r.classified; sum.fresh += r.fresh;
}
console.log(`| **합계** | ${sum.feedTotal} | ${sum.raw24} | ${sum.events} | ${sum.ap}/${sum.an} | ${sum.classified} | ${sum.fresh} |`);
console.log("");
for (const r of results) {
  if (r.reclassified && r.reclassified.length) {
    console.log(`재분류(${r.id}):`);
    for (const x of r.reclassified) console.log(`  - [${x.to}·${x.via}] ${x.title}`);
  }
}
