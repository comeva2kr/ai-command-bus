// 페르소나 시뮬레이터 — 실제 사용자 그룹처럼 앱을 써 보고 문제를 찾는다.
//
// 왜 (David 2026-07-29): "독립적 실 사용자그룹별로 뽑아서 실제 시뮬레이터 돌려서
// 사용시킨 뒤에 문제점 찾도록 하자. 사람처럼."
//
// 지금까지의 검증은 전부 단발성이었다 — 피드 한 번 받아서 분포를 보는 식.
// 그러면 "세 번째 페이지부터 같은 게 돈다", "두 번째 세션에 새 글이 없다",
// "이 페르소나는 클릭할 게 하나도 없다" 같은 **연속 사용에서만 드러나는 문제**를
// 절대 못 잡는다. 그래서 여러 페르소나가 여러 세션에 걸쳐 스크롤하고, 누르고,
// 좋아요/싫어요를 남기는 과정을 실제 엔진에 그대로 태운다.
//
// 중요: 여기서 만드는 것은 **행동**이지 콘텐츠가 아니다. 아이템은 전부 실제
// 엔진이 실제 소스에서 모아 온 것이고(FEED_LIVE=1), 시뮬레이터는 "이 사람이면
// 이걸 누를까"만 판정한다. 가짜 글을 지어내 지표를 만드는 것이 아니다.
//
// 실행:
//   FEED_LIVE=1 node tools/simulate.mjs            # 라이브 소스로
//   node tools/simulate.mjs --fixture              # 고정 픽스처로(오프라인/CI)
//   node tools/simulate.mjs --json > traces.json   # 트레이스 원본 출력

import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { JsonSource } from "../src/feed/content.js";
import { loadRegistry, buildSources } from "../src/feed/registry.js";
import { makeFetcher } from "../src/feed/fetchers.js";

const args = new Set(process.argv.slice(2));
const USE_FIXTURE = args.has("--fixture") || !process.env.FEED_LIVE;
const AS_JSON = args.has("--json");

// ---------------------------------------------------------------------------
// 페르소나 — 서로 다른 실사용자 그룹.
//
// `cats`   설문에서 고를 관심 카테고리
// `loves`  이 사람이 실제로 반응하는 주제 신호(제목/태그/카테고리에 걸리면 +)
// `hates`  보면 짜증나는 것(스킵/싫어요)
// `patience` 한 세션에 볼 페이지 수 (짧게 보는 사람 vs 오래 스크롤하는 사람)
// `sessions` 며칠에 걸쳐 몇 번 들어오는지
// ---------------------------------------------------------------------------
const PERSONAS = [
  {
    id: "it-worker", label: "30대 IT 직장인",
    desc: "출퇴근 지하철에서 2~3분씩. 개발/기기/AI 소식만 보면 반응. 연예·스포츠는 스크롤로 넘김.",
    cats: ["tech"], loves: ["tech", "gaming"], hates: ["culture", "sports"],
    patience: 2, sessions: 3
  },
  {
    id: "car-invest", label: "40대 자동차·재테크",
    desc: "차 바꿀 시기라 시승기/유지비, 그리고 주식·부동산. 게임/연예엔 관심 없음.",
    cats: ["auto", "business"], loves: ["auto", "business"], hates: ["gaming", "culture"],
    patience: 3, sessions: 3
  },
  {
    id: "culture-fan", label: "20대 연예·일상",
    desc: "드라마/아이돌/짤. 정치·경제 기사는 바로 넘김. 스크롤을 길게 함.",
    cats: ["culture", "life"], loves: ["culture", "life", "humor"], hates: ["business", "news"],
    patience: 4, sessions: 3
  },
  {
    id: "news-heavy", label: "50대 뉴스 헤비유저",
    desc: "시사/사회. 아침에 한 번 길게. 커뮤니티 잡담은 관심 없음.",
    cats: ["news"], loves: ["news"], hates: ["gaming", "humor"],
    patience: 4, sessions: 2
  },
  {
    id: "gamer", label: "20대 게이머",
    desc: "게임/유머만. 밤에 길게 스크롤.",
    cats: ["gaming", "humor"], loves: ["gaming", "humor"], hates: ["business", "news"],
    patience: 4, sessions: 3
  },
  {
    id: "drifter", label: "설문 안 한 뜨내기",
    desc: "링크 타고 처음 들어옴. 설문 안 하고 1페이지만 훑고 나감. 첫인상이 전부.",
    cats: null, loves: [], hates: [],
    patience: 1, sessions: 1
  }
];

// ---------------------------------------------------------------------------
// 행동 모델 — "이 사람이 이 카드를 보고 어떻게 할까"
//
// 실제 사람은 카드에서 제목·소스·반응수·썸네일만 보고 0.5초 안에 판단한다.
// 그래서 판정도 그 정보만 쓴다(본문은 안 본다 — 어차피 아웃링크다).
// ---------------------------------------------------------------------------
function judge(item, persona, rnd) {
  const cat = item.category || "";
  const text = `${item.title || ""} ${(item.tags || []).join(" ")}`;
  const loved = persona.loves.includes(cat);
  const hated = persona.hates.includes(cat);

  // 기본 관심도
  let p = 0.06;                       // 아무 관심 없는 글도 가끔은 눌린다
  if (loved) p += 0.42;
  if (hated) p -= 0.05;

  // 화제성은 누구에게나 조금씩 먹힌다(반응수가 크면 궁금해짐)
  const eng = (item.score || 0) + (item.commentCount || 0) * 2;
  if (eng >= 1000) p += 0.12;
  else if (eng >= 200) p += 0.06;

  // 썸네일이 있으면 눈이 간다
  if (item.image) p += 0.04;

  // 제목이 낚시성이 아니라 구체적일수록(숫자·따옴표) 클릭률이 오른다
  if (/[0-9]/.test(text) || /["'"]/.test(text)) p += 0.03;

  p = Math.max(0, Math.min(0.95, p));
  const clicked = rnd() < p;

  // 누른 뒤 평가: 취향에 맞으면 좋아요, 싫은 카테고리면 싫어요
  let rating = 0;
  if (clicked) {
    if (loved && rnd() < 0.45) rating = 1;
    else if (hated && rnd() < 0.5) rating = -1;
  } else if (hated && rnd() < 0.12) {
    rating = -1; // 누르지 않고도 짜증나서 싫어요를 누르는 경우
  }
  return { clicked, rating, wanted: loved };
}

// 결정적 난수 — 같은 입력이면 같은 결과라야 비교가 가능하다(Math.random 금지)
function makeRnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 오프라인 픽스처 — 라이브 없이도 돌려볼 수 있게. 실제 소스 구성을 흉내낸다
// (소스 수, 카테고리 분포, 반응수 스케일, 발행 간격).
// ---------------------------------------------------------------------------
function fixtureSources() {
  const now = Date.now();
  const SPEC = [
    ["clien", "community", "tech", 40, 6], ["geeknews", "community", "tech", 30, 4],
    ["hackernews", "community", "tech", 60, 8], ["44bits", "community", "tech", 20, 3],
    ["bobae", "community", "auto", 40, 6], ["ppomppu", "community", "business", 40, 6],
    ["theqoo", "community", "culture", 50, 8], ["instiz2", "community", "culture", 30, 5],
    ["ruliweb", "community", "gaming", 50, 8], ["inven_hot", "community", "gaming", 40, 6],
    ["todayhumor", "community", "humor", 40, 6], ["etoland", "community", "humor", 30, 5],
    ["yna", "news", "news", 20, 20], ["hani-rank", "news", "news", 17, 17],
    ["khan", "news", "news", 20, 20], ["mk-news", "news", "business", 20, 20],
    ["etnews", "news", "tech", 20, 20], ["gnews", "news", "news", 20, 20],
    ["gnews-kr", "news", "news", 20, 20], ["gnews-world", "news", "news", 20, 20],
    ["gnews-biz", "news", "business", 20, 20], ["gnews-ent", "news", "culture", 20, 20],
    ["gnews-sports", "news", "sports", 20, 20], ["gnews-tech", "news", "tech", 20, 20]
  ];
  return SPEC.map(([id, kind, cat, n, perDay]) =>
    new JsonSource(id, async () =>
      Array.from({ length: n }, (_, i) => ({
        id: `${id}_${i}`,
        title: `${cat} 글 ${i} (${id})`,
        url: `https://example.test/${id}/${i}`,
        category: cat,
        tags: [],
        score: kind === "news" ? 0 : Math.max(0, 600 - i * 18),
        commentCount: kind === "news" ? 0 : Math.max(0, 250 - i * 9),
        // 발행 간격을 소스별 발행량으로 결정 — 연합뉴스처럼 많이 쏟는 곳은 촘촘하게
        publishedAt: new Date(now - (i * 24 / perDay) * 3600 * 1000).toISOString(),
        sourceRank: i
      })), kind)
  );
}

async function buildEngineSources() {
  if (USE_FIXTURE) return { sources: fixtureSources(), mode: "fixture" };
  const reg = loadRegistry();
  const sources = buildSources(reg, { seed: false, fetcher: (e) => makeFetcher(e)() });
  return { sources, mode: "live" };
}

// ---------------------------------------------------------------------------
// 한 페르소나의 전체 사용 이력을 돌린다.
// ---------------------------------------------------------------------------
async function runPersona(persona, sources, seed) {
  const rnd = makeRnd(seed);
  const store = new FeedStore();
  const engine = new FeedEngine(store, sources);
  const user = store.createUser();
  if (persona.cats) store.saveSurvey(user.id, { categories: persona.cats, depth: "mixed", tone: "balanced" });

  const trace = [];
  let cursor = 0;
  for (let s = 0; s < persona.sessions; s++) {
    const session = { session: s + 1, pages: [] };
    for (let pg = 0; pg < persona.patience; pg++) {
      const res = await engine.getFeed(user.id, { cursor, limit: 10 });
      cursor = res.nextCursor;
      const items = res.items.filter((i) => i.kind !== "ad" && i.kind !== "affiliate");
      const page = { page: pg + 1, shown: [] };
      for (const it of items) {
        const j = judge(it, persona, rnd);
        page.shown.push({
          id: it.id, source: it.source, sourceLabel: it.sourceLabel || it.source,
          category: it.category, kind: it.kind, title: it.title,
          score: it.score || 0, comments: it.commentCount || 0,
          publishedAt: it.publishedAt || null, note: it.editorialNote || "",
          ...j
        });
        if (j.clicked) await engine.signal(user.id, it.id, { type: "open", dwellMs: 8000 }).catch(() => {});
        if (j.rating) await engine.rate(user.id, it.id, j.rating).catch(() => {});
      }
      session.pages.push(page);
      if (res.exhausted) break;
    }
    trace.push(session);
  }
  return { persona, trace };
}

// ---------------------------------------------------------------------------
// 지표 — 연속 사용에서만 드러나는 것들 위주.
// ---------------------------------------------------------------------------
function metrics(run) {
  const all = run.trace.flatMap((s) => s.pages.flatMap((p) => p.shown));
  const n = all.length || 1;
  const clicks = all.filter((x) => x.clicked).length;
  const wanted = all.filter((x) => x.wanted).length;

  const bySource = new Map();
  for (const x of all) bySource.set(x.source, (bySource.get(x.source) || 0) + 1);
  const top3 = [...bySource.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);

  // 연속 같은 소스 (사람이 "또 여기야?"라고 느끼는 지점)
  let runs = 0;
  for (let i = 1; i < all.length; i++) if (all[i].source === all[i - 1].source) runs++;

  // 제목 중복 — 같은 사건이 여러 매체로 반복되는가
  const norm = (t) => String(t || "").replace(/[^0-9a-z가-힣]/gi, "").slice(0, 18);
  const seenTitle = new Map();
  let dup = 0;
  for (const x of all) {
    const k = norm(x.title);
    if (!k) continue;
    if (seenTitle.has(k)) dup++;
    else seenTitle.set(k, 1);
  }

  // 세션별 빈손(클릭 0) — 이탈로 이어지는 신호
  const emptySessions = run.trace.filter(
    (s) => !s.pages.some((p) => p.shown.some((x) => x.clicked))
  ).length;

  // 첫 화면 적중 — 뜨내기에게는 이게 전부
  const firstPage = run.trace[0]?.pages[0]?.shown || [];
  const firstWanted = firstPage.filter((x) => x.wanted).length;

  const ages = all.filter((x) => x.publishedAt)
    .map((x) => (Date.now() - Date.parse(x.publishedAt)) / 3.6e6).sort((a, b) => a - b);

  return {
    persona: run.persona.id, label: run.persona.label,
    shown: all.length,
    clickRate: clicks / n,
    wantedRate: wanted / n,
    top3SourceShare: top3 / n,
    sourceCount: bySource.size,
    consecutiveSameSource: runs,
    duplicateTitles: dup,
    emptySessions,
    firstPageWanted: `${firstWanted}/${firstPage.length}`,
    medianAgeH: ages.length ? Math.round(ages[Math.floor(ages.length / 2)] * 10) / 10 : null,
    noDateShare: all.filter((x) => !x.publishedAt).length / n
  };
}

// ---------------------------------------------------------------------------
const { sources, mode } = await buildEngineSources();
const runs = [];
for (let i = 0; i < PERSONAS.length; i++) {
  runs.push(await runPersona(PERSONAS[i], sources, 1000 + i * 7919));
}
const rows = runs.map(metrics);

if (AS_JSON) {
  console.log(JSON.stringify({ mode, runs, rows }, null, 2));
} else {
  console.log(`\n모드: ${mode}   페르소나 ${PERSONAS.length}명\n`);
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  console.log(
    "페르소나".padEnd(18) + "노출  클릭률  취향적중  상위3소스  소스수  연속중복  제목중복  빈손세션  첫화면적중  중앙나이"
  );
  for (const r of rows) {
    console.log(
      r.label.padEnd(16) +
      String(r.shown).padStart(5) +
      pct(r.clickRate).padStart(7) +
      pct(r.wantedRate).padStart(9) +
      pct(r.top3SourceShare).padStart(10) +
      String(r.sourceCount).padStart(7) +
      String(r.consecutiveSameSource).padStart(9) +
      String(r.duplicateTitles).padStart(9) +
      String(r.emptySessions).padStart(9) +
      String(r.firstPageWanted).padStart(11) +
      String(r.medianAgeH ?? "-").padStart(9) + "h"
    );
  }
  console.log("\n지표 뜻:");
  console.log("  취향적중  = 이 사람이 관심 있다고 한 카테고리의 글 비율");
  console.log("  상위3소스 = 상위 3개 소스가 차지한 비율 (높으면 '또 여기야?')");
  console.log("  연속중복  = 바로 앞 카드와 같은 소스인 횟수");
  console.log("  빈손세션  = 한 번도 누를 게 없었던 세션 수 (이탈 신호)");
  console.log("  첫화면적중= 첫 페이지 10장 중 관심 카테고리 (뜨내기에겐 이게 전부)");
}
