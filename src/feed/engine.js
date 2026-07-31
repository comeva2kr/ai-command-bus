// Feed engine: glue between sources, the store, and the recommender.
//
// Produces the endless personalized stream. Ranking excludes items the user has
// already been shown, so scrolling never repeats — the piece that makes the
// stream feel smooth instead of the page-by-page shuffling of a plain
// aggregator. The client keeps the rendered DOM and restores scroll on back
// navigation; the server just keeps handing out the next best unseen batch.

import { collect, SeedSource, resolveCap } from "./content.js";
import { loadRegistry } from "./registry.js";
import { TitleClassifier, classifyTitle, TRAIN_LABELS, isReclassifiable, OVERRIDE_CATEGORIES, definiteCategory, MIXED_BEST_FALLBACK } from "./classify.js";
import { rankParams, categorySets, selectDiverse } from "./rank.js";
import {
  rankItems,
  diversify,
  applyFeedback,
  applyImplicit,
  explain,
  specializationLevel,
  feedPhase,
  scoreItem,
  tasteScore
} from "./recommender.js";
import { collaborativeBoosts } from "./collab.js";
import { categoryLabel, sourceLabel } from "./taxonomy.js";
import { hotGate, rankBySource, topPerSource, roundRobinInterleave, sourceHotScores, hotParams, latestInterleave } from "./ingest.js";
import { FILTERABLE_TOPICS } from "./topics.js";
import { buildEditorialNote } from "./editorial.js";
import {
  injectSlots,
  adParams,
  adaptiveEvery,
  pickAffiliateCandidates,
  assignVariant,
  applyVariant,
  applyNarrowSourceDensity
} from "./monetize.js";

// How long a collected item stays in the rolling pool before it's eligible for
// eviction (David 2026-07-24: refresh should *accumulate*, not replace — a
// community board's items outlive any single 15-minute poll interval).
// Override with FEED_RETENTION_MS. "me"/"seed" pseudo-sources are exempt —
// a user's own posts and the offline dev dataset never age out this way.
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;

// 절대 신선도 상한 (David 검수 항목 4 → 2026-07-29 2차 강화).
//
// 1차(14일)는 사실상 아무것도 자르지 못했다. 라이브 풀 실측 결과 발행일이 있는
// 글의 최대 나이가 5.0일(중앙 8.9시간, 상위90% 42.4시간)이라 14일 선은 그냥
// 장식이었다 — David 지적: "지금 핫한 걸 올리는데 왜 14일? 훨씬 타이트해야".
//
// 그리고 더 큰 구멍이 있었다: 발행일이 **아예 없는** 글이 53건(inven_hot·tildes·
// ppomppu·bobae·slashdot·etoland·44bits 7개 소스)이라, 이들은 상한을 어떻게
// 정하든 통과했다. 소스 하나가 통째로 신선도 규칙 밖에 있으면 그 규칙은 없는
// 것과 같다.
//
// 그래서 나이를 두 단계로 구한다:
//   1) publishedAt이 있으면 그걸 쓴다.
//   2) 없으면 firstSeenAt(우리가 이 글을 처음 수집한 시각, engine.refresh가
//      아이템에 찍어 준다)을 쓴다. "언제 쓰인 글인지"는 몰라도 "우리가 언제
//      처음 봤는지"는 항상 안다 — 날짜를 안 주는 게시판에서 이건 합리적인
//      나이 대용이고, 무엇보다 **모든 글에 나이가 생겨** 예외가 사라진다.
//
// 상한은 콘텐츠 종류마다 다르다 (David 제안 2026-07-29: "24시간은 뉴스에만
// 해당해도 되지 않을까"). 실측이 이를 뒷받침한다:
//
//   뉴스(구글뉴스 섹션): 중앙 3~10시간, 최대 22.6시간
//     -> 24시간으로 잘라도 한 건도 안 잃는다. 속보성 매체는 그게 맞다.
//   커뮤니티 베스트보드: clien 중앙 42시간
//     -> 베스트50이 며칠에 걸쳐 쌓이는 구조라 24시간이면 통째로 사라진다.
//
// 단, kind만으로는 부족하다. slownews(47h)·outstanding(46h)·ddanzi(38h)는
// 레지스트리상 kind=news지만 속보가 아니라 논평/칼럼 매체라 주기가 느리다.
// 종류로만 자르면 이 셋이 죽으므로 communities.json의 소스별 `maxAgeH`가
// 종류 기본값을 덮어쓴다.
const MAX_AGE_H_NEWS = Number(process.env.FEED_MAX_ITEM_AGE_H_NEWS ?? 24);
const MAX_AGE_H_DEFAULT = Number(process.env.FEED_MAX_ITEM_AGE_H ?? 48);

// 소스별 예외(communities.json의 maxAgeH). 레지스트리를 못 읽으면 빈 맵 —
// 종류 기본값만 쓰고 조용히 계속한다.
let _sourceMaxAge;
function sourceMaxAgeH(sourceId) {
  if (_sourceMaxAge === undefined) {
    try {
      _sourceMaxAge = new Map(
        loadRegistry().filter((c) => Number.isFinite(c.maxAgeH)).map((c) => [c.id, c.maxAgeH])
      );
    } catch {
      _sourceMaxAge = new Map();
    }
  }
  return _sourceMaxAge.get(sourceId);
}

function maxAgeFor(item) {
  const override = sourceMaxAgeH(item.source);
  if (Number.isFinite(override)) return override;
  return item.kind === "news" ? MAX_AGE_H_NEWS : MAX_AGE_H_DEFAULT;
}

// ── 뉴스 성향 슬라이더 (David 2026-07-31: "좌/중/우 같은 비율로, 슬라이드로") ──
//
// 소스별 성향값(lean, communities.json: -2 진보 ~ +2 보수, 근거는 각 leanNote의
// 1차 자료 URL)과 유저 슬라이더(leanBalance, -1 진보쪽 ~ 0 균형 ~ +1 보수쪽)를
// 곱해 라운드로빈 배정 가중치를 만든다.
//
//   승수 = clamp(1 + balance·(lean/2), 0.2, 1.8)
//
// 성질:
//  - balance=0(기본)이면 모든 소스 승수 1 — 성향이 배정에 전혀 개입하지 않고,
//    "같은 비율"은 lean 절대값이 대칭인 소스 구성(-2·-1 vs +1·+2)이 만든다.
//  - 하한 0.2: 슬라이더를 끝까지 밀어도 반대편이 완전히 사라지지 않는다(약 80:20).
//    조사 리스크 3("끝단에서 매체 역산")의 완화이자 필터버블 방지.
//  - lean이 없는 소스(전문지·풍자지·구글뉴스·커뮤니티)는 항상 1 — "분류 안 함"은
//    중립 판정이 아니라 성향축 밖이라는 뜻이므로 슬라이더의 영향을 받지 않는다.
let _sourceLean;
function sourceLeanOf(sourceId) {
  if (_sourceLean === undefined) {
    try {
      _sourceLean = new Map(
        loadRegistry().filter((c) => Number.isFinite(c.lean)).map((c) => [c.id, c.lean])
      );
    } catch {
      _sourceLean = new Map();
    }
  }
  return _sourceLean.get(sourceId);
}

export function leanMultiplier(sourceId, balance) {
  const lean = sourceLeanOf(sourceId);
  if (!Number.isFinite(lean) || !Number.isFinite(balance) || balance === 0) return 1;
  return Math.max(0.2, Math.min(1.8, 1 + balance * (lean / 2)));
}

// 이 글의 나이(시간). 발행일이 없으면 우리가 처음 본 시각으로 대체하고,
// 그마저 없으면 null(판단 불가).
export function itemAgeHours(item, nowMs) {
  const p = item.publishedAt;
  if (p != null) {
    const t = typeof p === "number" ? p : Date.parse(p);
    if (Number.isFinite(t)) return (nowMs - t) / 3.6e6;
  }
  const f = item.firstSeenAt;
  if (Number.isFinite(f)) return (nowMs - f) / 3.6e6;
  return null;
}

function tooOld(item, nowMs) {
  const cap = maxAgeFor(item);
  if (!(cap > 0)) return false; // 0/음수 = 상한 해제
  const age = itemAgeHours(item, nowMs);
  if (age == null) return false; // 발행일도 수집시각도 없음 — 판단 불가
  return age > cap;
}

// 정치/종교처럼 기본 숨김인 토픽을 아이템이 갖고 있는데 유저가 아직 켜지 않았다면
// true. "adult"는 FILTERABLE_TOPICS에 없으므로 여기서 절대 걸리지 않는다 — 그 쪽은
// allowAdult가 이미 기존 19금 게이트로 전담한다(중복 게이트 방지).
function topicsBlocked(item, showTopicsSet) {
  const topics = item.topics || [];
  return topics.some((t) => FILTERABLE_TOPICS.includes(t) && !showTopicsSet.has(t));
}

// Per-source `score` stats (mean/median/count) across the FULL collected
// pool (not just this page) — feeds editorial.js's "압도적 반응형" template
// ("이 소스 평소보다 반응 N배"), so that comparison is against the source's
// actual current range rather than a made-up baseline. Computed once per
// getFeed() call and shared across every item being decorated that call.
// Note: each source's own array includes the item being compared against it
// (there's no cheap way to exclude "self" once this is reduced to
// mean/median), which slightly understates an outlier's true multiple for
// small pools — a conservative bias, never an inflated one.
function sourceScoreStats(items) {
  const bySource = new Map();
  for (const it of items) {
    const src = it.source || "unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(Number.isFinite(it.score) ? it.score : 0);
  }
  const stats = new Map();
  for (const [src, scores] of bySource) {
    const sorted = scores.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
    const mid = n >> 1;
    const median = n ? (n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0;
    stats.set(src, { mean, median, count: n });
  }
  return stats;
}

// 소스별 취향 배정 가중치 (David 검수 항목 5, 2026-07-29).
//
// 문제: 홈 피드는 소스별 라운드로빈이라 **모든 소스가 같은 횟수**를 배정받았다.
// 취향은 각 라운드 안의 순서만 정할 수 있었고 구성 비율은 못 바꿨다. 실측으로
// 게임 취향 유저와 경제 취향 유저 둘 다 정확히 게임 50% / 경제 50%를 받았다 —
// 취향을 골라도 안 고른 쪽이 절반 오는 것이 David가 본 "취향 미반영"이다.
//
// 방식: 각 소스의 현재 후보들에 대한 평균 취향 점수를 구해 [-1,1]로 눌러 담고,
// 가중치 = 1 + W*적합도 로 만들어 roundRobinInterleave에 넘긴다. 가중치는
// [MIN,MAX]로 클램프해 **어떤 소스도 0이 되지 않게** 한다 — handoff.md의
// "소스별 볼륨 균형 유지" 지시와 "다양성 > 개인화" 결정을 지키면서, 취향이
// 구성에 실제로 반영되게 하는 지점이다.
//
// 취향 벡터가 없으면(설문 전 익명 유저) 전부 1을 돌려줘 예전 동작 그대로다.
const TASTE_QUOTA_W = Number(process.env.HOT_TASTE_QUOTA_W ?? 1.0);
const TASTE_QUOTA_MIN = Number(process.env.HOT_TASTE_QUOTA_MIN ?? 0.5);
const TASTE_QUOTA_MAX = Number(process.env.HOT_TASTE_QUOTA_MAX ?? 2.0);

export function sourceTasteWeights(topKBySource, preferences) {
  const weights = new Map();
  if (!preferences) return weights; // 취향 없음 -> 균등 (weightOf 기본 1)

  const raw = new Map();
  for (const [src, list] of topKBySource) {
    if (!list || !list.length) continue;
    let sum = 0;
    // 순수 취향만 — scoreItem을 쓰면 그 안의 인기도/신선도 항 때문에
    // "시끄러운 소스 = 취향에 맞는 소스"가 되어 편중이 되살아난다.
    for (const e of list) sum += tasteScore(e.item, preferences);
    raw.set(src, sum / list.length);
  }
  if (raw.size < 2) return weights; // 비교 대상이 없으면 가중치 의미 없음

  // 소스 간 상대 비교로 정규화 — scoreItem의 절대 스케일에 의존하지 않는다.
  const vals = Array.from(raw.values());
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);
  if (!(spread > 0)) return weights; // 전부 동점 — 취향이 소스를 가르지 못함

  for (const [src, v] of raw) {
    const affinity = Math.max(-1, Math.min(1, ((v - mean) / spread) * 2)); // [-1,1]
    const w = 1 + TASTE_QUOTA_W * affinity;
    weights.set(src, Math.max(TASTE_QUOTA_MIN, Math.min(TASTE_QUOTA_MAX, w)));
  }
  return weights;
}

// Turn a structured reason into a short human label for the "추천 이유" chip.
function reasonLabel(r) {
  switch (r.kind) {
    case "category": return categoryLabel(r.key);
    case "tag": return "#" + r.key;
    case "source": return sourceLabel(r.key) + " 즐겨찾기";
    case "popular": return "인기글";
    case "fresh": return "최신";
    case "explore": return "새로운 탐색";
    default: return r.key;
  }
}

export class FeedEngine {
  constructor(store, sources) {
    this.store = store;
    this.sources = sources && sources.length ? sources : [new SeedSource()];
    this._cache = null; // collected items cache — the capped, ranked-over view of the pool
    this._pool = new Map(); // id -> { item, firstSeenAt } — the rolling accumulation pool
    this._clock = store && store.clock ? store.clock : null; // injectable time for tests
    // 카테고리 분류기 (David 2026-07-29 "칼같은 인덱싱"). 프로세스 수명 동안
    // 구글뉴스 섹션 라벨을 계속 흡수한다 — 15분마다 새 제목 수백 건이 공짜
    // 학습 데이터로 들어오므로(classify.js 참고) 서버가 오래 떠 있을수록
    // 정확해진다. 재시작 시 코퍼스가 초기화되지만 첫 refresh에서 곧바로
    // 수백 건을 다시 배우므로 공백은 15분 안에 메워진다.
    this._classifier = new TitleClassifier();
    // 쿠팡 실연동 productFeed (server.js가 주입, 없으면 null -> 기존 동작 그대로)
    this._productFeed = null;
    // 썸네일 보강기 (enrich.js, server.js가 주입 — David 2026-07-31 "사진
    // 어지간하면 썸네일 다 끌어오게"). 피드에 image가 없는 아이템의 원문
    // og:image URL만 핫링크로 채운다. 테스트/미주입 시 null = 기존 동작.
    this._enricher = null;
    this._learnedIds = new Set(); // 같은 제목을 중복 학습하지 않기 위한 장부
  }

  async _items() {
    if (!this._cache) await this.refresh();
    return this._cache;
  }

  // Per-source item counts in the current collected pool (David 2026-07-24
  // adversarial review #5 — "죽은 소스 칩 자동 숨김"). A source can be
  // `enabled` in the registry yet consistently return 0 items in production
  // (e.g. todayhumor's overseas-IP block) — rather than hand-maintaining an
  // enabled/disabled flag for every such case, the source-chip bar hides
  // itself once there's nothing behind it. See server.js's GET
  // /api/communities and public/index.html's chip-filtering.
  async sourceCounts() {
    const items = await this._items();
    const counts = {};
    for (const item of items) {
      const src = item.source || "unknown";
      counts[src] = (counts[src] || 0) + 1;
    }
    return counts;
  }

  // Force a re-collection on next read (e.g. after wiring a live source).
  // Only clears the *capped view* — the accumulation pool itself is untouched,
  // so this still merges rather than starting the 48h window over.
  invalidate() {
    this._cache = null;
  }

  // Re-collect from all sources and merge into the rolling pool by stableId
  // (a re-collected post keeps its id, so it just updates in place) rather
  // than replacing the pool wholesale — a community board's items live far
  // longer than one poll interval. Pool entries older than FEED_RETENTION_MS
  // (since first seen, not their claimed publish date — many list-adapter
  // items don't reliably carry one) are evicted, then each source is capped
  // again post-accumulation, newest-first, so the pool can't grow unbounded
  // over many refresh cycles even though a single collect() already capped
  // each individual fetch batch.
  async refresh() {
    const { items: freshItems, errors } = await collect(this.sources);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    // firstSeenAt 우선순위: 메모리 풀 > 영속 기록(재시작 생존) > 지금.
    // 재시작마다 리셋되면 오래된 아카이브 글이 "방금 처음 봄"이 되어 신선도
    // 상한을 재통과한다(적대적 검수 P1-a 실측: 2021년 글이 최신 피드에).
    const newlySeen = [];
    for (const item of freshItems) {
      const prior = this._pool.get(item.id);
      const persisted = this.store && this.store.firstSeenOf ? this.store.firstSeenOf(item.id) : undefined;
      const firstSeenAt = prior ? prior.firstSeenAt : (Number.isFinite(persisted) ? persisted : now);
      if (!prior && !Number.isFinite(persisted)) newlySeen.push([item.id, now]);
      // lastSeenAt: 이번 수집에 "아직 보드 목록에 걸려 있음"의 표시.
      this._pool.set(item.id, { item, firstSeenAt, lastSeenAt: now });
    }
    if (newlySeen.length && this.store && this.store.recordFirstSeen) {
      try { this.store.recordFirstSeen(newlySeen, now); } catch {}
    }

    // 풀 퇴장 기준은 "처음 본 지 오래됨"이 아니라 "보드 목록에서 내려간 지
    // 오래됨"이다 (David 2026-07-31 "보배는 베스트글의 최신글 동기화 하면 돼").
    // firstSeenAt 기준이던 시절엔 재시작 리셋 덕에 티가 안 났지만, firstSeenAt
    // 영속화(P1-a) 이후로는 보드에 아직 걸려 있는 장수 베스트글이 48h 만에
    // 풀에서 증발한다 — 보드가 걸어둔 글은 보드가 내릴 때까지 우리 풀에도
    // 있어야 게시판 보기가 실제 게시판과 동기화된다.
    const retentionMs = Number(process.env.FEED_RETENTION_MS || DEFAULT_RETENTION_MS);
    for (const [id, entry] of this._pool) {
      const src = entry.item.source;
      if (src === "seed" || src === "me") continue; // never age out a user's own posts or the dev dataset
      if (now - (entry.lastSeenAt ?? entry.firstSeenAt) > retentionMs) this._pool.delete(id);
    }

    const kindBySource = new Map(this.sources.map((s) => [s.id, s.kind]));
    const bySource = new Map();
    for (const entry of this._pool.values()) {
      const src = entry.item.source || "unknown";
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(entry);
    }
    const capped = [];
    for (const [src, entries] of bySource) {
      if (src === "seed" || src === "me") {
        capped.push(...entries.map((e) => e.item));
        continue;
      }
      // newest-first: prefer the item's own publish date, fall back to when
      // we first saw it (covers list-adapter items with no reliable date)
      entries.sort((a, b) => {
        const at = (a.item.publishedAt && Date.parse(a.item.publishedAt)) || a.firstSeenAt;
        const bt = (b.item.publishedAt && Date.parse(b.item.publishedAt)) || b.firstSeenAt;
        return bt - at;
      });
      const cap = resolveCap(kindBySource.get(src), {});
      // firstSeenAt을 아이템에 실어 준다 — 발행일을 아예 주지 않는 소스(실측:
      // inven_hot·tildes·ppomppu·bobae·slashdot·etoland·44bits)도 나이를 갖게
      // 되어 신선도 상한의 예외가 사라진다(engine.js itemAgeHours 참고).
      capped.push(
        ...(cap > 0 ? entries.slice(0, cap) : entries).map((e) => {
          e.item.firstSeenAt = e.firstSeenAt;
          return e.item;
        })
      );
    }

    // ---- 카테고리 분류 (David 2026-07-29 "칼같은 인덱싱") ------------------
    // 1) 학습: 라벨이 신뢰되는 소스(classify.js TRAIN_LABELS)의 새 제목만.
    for (const item of capped) {
      const label = TRAIN_LABELS.get(item.source);
      if (!label || this._learnedIds.has(item.id)) continue;
      this._classifier.learn(item.title, label.category, label.weight);
      this._learnedIds.add(item.id);
    }
    // 장부가 무한히 크지 않게 — 분류기 카운트는 이미 흡수됐으므로 id만 비운다.
    if (this._learnedIds.size > 20000) this._learnedIds.clear();

    // 2) 분류 3단 파이프라인 (2026-07-31 David: "제목 단어로 카테고리를
    //    유추하는 알고리즘 개선" — 실측: 보배 베스트 15건 중 자동차 1건인데
    //    전부 auto, 경제 뉴스에 씨라이언7 시승기):
    //    ① 키워드 확정(사전) — 소스 불문. 시승기가 경제지에 실려도 auto로.
    //    ② NB 재분류 — 혼합 게시판만, 기권 시 등록 카테고리 유지(기존 그대로).
    //    ③ 혼합 베스트 폴백 — 주제 사이트의 통합 베스트(보배)에서 키워드도
    //       NB도 못 잡은 글은 사이트 주제(auto)가 아니라 게시판의 실측 지배
    //       성격(humor)으로 되돌린다.
    //    정치 태그 글은 전 단계 제외 — 논쟁 문체가 humor/gaming 말투와 겹쳐
    //    오분류의 최대 진원지였다(라이브 실측 2026-07-29).
    for (const item of capped) {
      if (item.source === "seed" || item.source === "me") continue;
      if ((item.topics || []).includes("politics")) continue;
      const kw = definiteCategory({ title: item.title, url: item.url, sourceId: item.source });
      if (kw) {
        if (kw !== item.category) {
          if (item.registryCategory === undefined) item.registryCategory = item.category;
          item.category = kw;
        }
        continue;
      }
      if (isReclassifiable(item.source) && this._classifier.trained >= 100) {
        const predicted = classifyTitle(this._classifier, item.title);
        if (predicted && predicted !== item.category && OVERRIDE_CATEGORIES.has(predicted)) {
          item.registryCategory = item.category;
          item.category = predicted;
          continue;
        }
      }
      const mixed = MIXED_BEST_FALLBACK.get(item.source);
      if (mixed && item.category === mixed.registryCategory) {
        item.registryCategory = item.category;
        item.category = mixed.fallback;
      }
    }

    // ---- 썸네일·발췌 보강 (og:image/og:description, enrich.js) -------------
    // 주입된 경우에만 동작(서버 전용), 실패·403은 enrich.js가 조용히 부정캐시로
    // 삼킨다. 최신 글부터 처리한다 — 사이클당 상한(maxPerCycle)이 있으므로,
    // 배열 순서(소스별 그룹)대로 돌면 정작 화면에 뜨는 새 글이 뒷순번에 밀린다
    // (라이브 실측 2026-07-31: 첫 페이지 발췌 3/10). 신선도는 핫·최신 양쪽
    // 랭킹의 공통 지배 변수라 "먼저 노출될 글"의 가장 싼 근사다.
    if (this._enricher) {
      const byFreshness = [...capped].sort((a, b) => itemAgeHours(a, now) - itemAgeHours(b, now));
      try { await this._enricher.enrich(byFreshness); } catch {}
    }

    this._cache = capped;
    this._errors = errors;
    this.lastRefreshedAt = now;

    // ---- 일별 에디션 스냅샷 (브리핑+화제랭킹, 자체 콘텐츠 아카이브) --------
    // 사이클마다 그날(KST) 키로 덮어쓴다 — 하루의 마지막 기록이 최종판.
    // /briefing/<날짜> 아카이브와 /ranking 주간·월간 집계의 원천 데이터다.
    if (this.store && this.store.saveDailyEdition) {
      try {
        const dateKey = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
        this.store.saveDailyEdition(dateKey, {
          briefing: await this.briefing(),
          ranking: await this.rankingTop(30)
        });
      } catch {
        // 스냅샷 실패가 수집 자체를 죽여선 안 된다 — 다음 사이클에 재시도된다
      }
    }
    // memory visibility: the pool can only grow across a 48h window, not forever —
    // this is the number to watch if that ever needs revisiting.
    console.log(`[feed] pool: ${this._pool.size} accumulated (${Math.round(retentionMs / 3.6e6)}h retention) -> ${capped.length} after per-source cap`);
    return { count: capped.length, errors, poolSize: this._pool.size };
  }

  // Periodically update the DB from its sources ("정기적으로 찾으면서 db 업데이트").
  // Returns a stop function; the interval is unref'd so it never blocks exit.
  startAutoRefresh(intervalMs = 15 * 60 * 1000) {
    this.stopAutoRefresh();
    this._timer = setInterval(() => {
      this.refresh().catch(() => {});
    }, intervalMs);
    if (this._timer.unref) this._timer.unref();
    return () => this.stopAutoRefresh();
  }

  stopAutoRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // Return the next batch for a user. `cursor` is an opaque number = how many
  // items already consumed this session; used only as a deterministic seed so
  // repeated identical requests are stable.
  //
  // `source`: when set, scopes the feed to a single community/news source —
  // the "소스별 보기" chip bar. This is a jagei-style board view, not a taste
  // feed, so it skips personalized ranking (and the mute filter, since picking
  // the chip is the opposite of muting it) in favor of latest+공개화제성 order.
  async getFeed(userId, { limit = 10, cursor = 0, markSeen = true, source = null, sort = "hot" } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);
    // editorial.js context: per-source score stats over the whole collected
    // pool (see sourceScoreStats above), so the "outlier vs this source's
    // usual range" note template has something real to compare against.
    const editorialSourceStats = sourceScoreStats(items);

    // 19금 게이트: 성인인증 + 토글이 모두 켜져 있을 때만 성인 콘텐츠를 후보에 포함.
    // 서버에서 강제하므로 인증되지 않은 사용자에게는 어떤 경우에도 노출되지 않는다.
    const allowAdult = user.ageVerified === true && user.showAdult === true;
    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
    const showTopics = new Set(user.showTopics || []);
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();

    let unseen;
    let collabBoosts = new Map();
    if (source) {
      // "submit" is a pseudo-source: every user-submitted out-link, grouped by
      // provenance (via) rather than by the item's own out-link domain (which
      // varies per submission, so there's no single registry source id to
      // filter on).
      const matchesSource = (i) => (source === "submit" ? i.via === "submit" : i.source === source);
      // 게시판 보기는 tooOld를 적용하지 않는다 (David 2026-07-31: "보배는
      // 베스트글의 최신글 동기화 하면 돼" — 실측: 보배 베스트는 며칠 누적
      // 리스트라 48h 상한이 대부분을 잘라 8개만 남았다). 여기의 신선도
      // 권위는 게시판 자신이다: 보드가 목록에서 내리면 풀 퇴장(lastSeenAt
      // retention)으로 함께 사라진다. 홈 피드의 상한은 그대로.
      const pool = items.filter(
        (i) =>
          matchesSource(i) &&
          (allowAdult || !i.adult) &&
          !disabled.has(i.source) &&
          !topicsBlocked(i, showTopics)
      );
      // Same hot-curation pipeline as the home feed (2026-07-24 hot-curation
      // v1) — HN-gravity time decay + robust-z/percentile normalization +
      // Bayesian shrinkage — applied to the whole filtered pool as one flat
      // group (this view is already scoped to a single source/provenance, so
      // there's nothing to group further; "submit"'s pool spans many out-link
      // domains but was already scored uniformly before this change too).
      // This is what stops a stale-but-still-#1-ranked RSS item from sitting
      // atop a board's own view forever, same as the home feed below.
      const ranked = sourceHotScores(pool, now)
        .map((s) => ({ item: s.item, score: s.hotScore }))
        .sort((a, b) => b.score - a.score);
      // 게시판 보기는 "그 게시판의 현재 베스트 전체"다 — 홈 피드처럼 seen을
      // 숨기면 홈에서 스크롤한 만큼 게시판이 비어 보인다(David 실측 2026-07-31:
      // 보배 8개·클리앙 14개만 노출). 게시판을 다시 들어가면 같은 베스트가
      // 다시 보이는 게 게시판의 문법이므로 seen 필터 없이 오프셋 페이지네이션
      // (아래 fresh 계산에서 cursor 슬라이스)으로 전체를 훑게 한다.
      unseen = ranked;
    } else {
      // Unseen is filtered in up front (not after ranking, as the old
      // hotGate/rankItems path did) so the round-robin/min-gap diversity
      // guarantees below hold on *every* page of the infinite scroll, not
      // just a fresh user's first load.
      const pool = items.filter(
        (i) =>
          (allowAdult || !i.adult) &&
          !muted.has(i.source) &&
          !disabled.has(i.source) &&
          !topicsBlocked(i, showTopics) &&
          !seen.has(i.id) &&
          !tooOld(i, now)
      );
      // "게시판별 핫 + 다양성 라운드로빈" (David 2026-07-24 redesign). Every
      // active source is already a community's own best/hot board (see
      // ingest.js's rankBySource header comment for why even a 0-engagement
      // RSS source still has a meaningful hot rank — its own collection
      // order). This: (1) ranks each source's items hot-first, (2) keeps only
      // each source's top HOT_PER_SOURCE hottest, (3) interleaves round-robin
      // across sources so the stream alternates boards instead of one board's
      // list dominating. Personalization only breaks ties *within* a round —
      // diversity wins over taste here by design ("다양성 > 개인화").
      collabBoosts = collaborativeBoosts(this.store, userId);
      // hotScore (2026-07-24 hot-curation v1, ingest.js's rankBySource/
      // sourceHotScores) is now each source's internal sort key — HN-gravity
      // time decay + per-source robust-z/percentile normalization + Bayesian
      // small-sample shrinkage, so a stale-but-still-rank-0 RSS item can no
      // longer win its source's top-K cut just because nothing displaced it.
      const rankedBySource = pool.length ? rankBySource(pool, now) : new Map();
      const seed = cursor + 1;

      if (sort === "latest") {
        // ── 최신순: 시간버킷 × 소스 인터리브 (#12, ingest.js latestInterleave) ──
        // 취향·노출 이력·lean 슬라이더 전부 미개입 — "지금 무엇이 올라오고
        // 있나"의 중립 뷰. seen 필터는 pool에서 이미 적용됐고, 페이지네이션은
        // 핫 탭과 동일하게 markSeen이 다음 페이지를 만든다.
        const entries = pool.map((i) => ({ item: i, ageH: itemAgeHours(i, now) }));
        const orderedLatest = latestInterleave(entries);
        this._lastSelectMeta = null;
        const latestFresh = orderedLatest.slice(0, limit).map((item) => ({ item, score: 0 }));
        const latestBatch = latestFresh.map((r) =>
          this._decorate(r.item, r.score, user, { now, sourceStats: editorialSourceStats.get(r.item.source) })
        );
        if (markSeen && latestBatch.length) {
          this.store.markSeen(userId, latestBatch.map((b) => b.id));
          if (this.store.recordSourceExposure) {
            this.store.recordSourceExposure(userId, latestBatch.map((b) => b.source));
          }
        }
        const latestMonetizeAllowed = !allowAdult && !showTopics.has("politics") && !showTopics.has("religion");
        const latestDisplay = latestMonetizeAllowed
          ? this._monetize(userId, user, latestBatch, cursor, false).items
          : latestBatch;
        return {
          items: latestDisplay,
          nextCursor: cursor + latestBatch.length,
          exhausted: latestBatch.length < limit,
          pageMeta: null,
          phase: feedPhase(specializationLevel(user.preferences, user.feedbackCount)),
          level: specializationLevel(user.preferences, user.feedbackCount),
          feedbackCount: user.feedbackCount
        };
      }

      const minGap = Number(process.env.HOT_MIN_GAP ?? 1);
      const exposure = this.store.sourceExposureFor ? this.store.sourceExposureFor(userId) : {};
      const balance = Number.isFinite(user.leanBalance) ? user.leanBalance : 0;

      // "개인화 유저"의 판별: user.preferences는 createUser가 빈 벡터를 만들어
      // **항상 truthy**다 — 진짜 기준은 취향 신호가 실제로 존재하는가이다
      // (설문 완료, 피드백 이력, 브라우징 워밍업 중 하나).
      const personalized = Boolean(user.surveyed || (user.feedbackCount || 0) > 0 || user.warmStarted);
      if (personalized) {
        // ── 골격 v2: 아이템 경쟁 + 다양성 제약 (rank.js, docs/redesign-rank.md) ──
        //
        // 예전 라운드로빈은 조직 원리가 "소스 순번"이라 취향이 구성에 개입할
        // 수 없었다(페르소나 실측: 정반대 취향 6명의 첫 페이지가 동일). 이제
        // 글 하나하나가 (화제성 + 취향)으로 전역 경쟁하고, 다양성(소스 상한·
        // 연속 금지·노출 이력)은 제약조건으로 내려간다.
        //
        // topPerSource 컷 없이 풀 전체가 후보다 — 소스 내 7위 이하도 취향에
        // 맞으면 도달 가능(예전 구조의 영구 불가시 결함 해소).
        const entries = [];
        for (const list of rankedBySource.values()) for (const e of list) entries.push(e);
        const params = rankParams();
        const { picked, hated } = categorySets(user.preferences, params);
        const cands = entries.map((e) => ({
          item: e.item,
          // 성향 슬라이더는 hot에 승수로 — 라운드로빈 가중치의 v2 대응물.
          hot: (e.hotScore ?? 0) * leanMultiplier(e.item.source, balance),
          taste: Math.tanh(tasteScore(e.item, user.preferences) / 2),
          collab: collabBoosts.get(e.item.id) || 0
        }));
        const sel = selectDiverse(cands, {
          limit, minGap, exposure, firstPage: cursor === 0, picked, hated
        }, params);
        this._lastSelectMeta = { shortfall: sel.shortfall, bannedHatedCount: sel.bannedHatedCount };
        unseen = sel.picks.map((item) => ({
          item,
          score: scoreItem(item, user.preferences, { now, seed, collabBoosts, explore: 0 })
        }));
      } else {
        // ── 익명: 기존 라운드로빈 그대로 (회귀 0 보증) ──
        const topK = topPerSource(rankedBySource);
        const scoreFn = (item, rank, hasSignal, hotScoreVal) => hotScoreVal ?? 0;
        const weights = new Map();
        if (balance !== 0) {
          for (const src of topK.keys()) {
            const m = leanMultiplier(src, balance);
            if (m !== 1) weights.set(src, m);
          }
        }
        const interleaved = roundRobinInterleave(topK, { minGap, scoreFn, exposure, weights });
        this._lastSelectMeta = null;
        unseen = interleaved.map((item) => ({ item, score: 0 }));
      }
    }
    // diversify so a page isn't dominated by one source/category (a no-op
    // when every candidate already shares the same `source`). For the home
    // feed (no `source`), skip it: the round-robin interleave above already
    // produced a hard-guaranteed diverse order, and re-running the softer MMR
    // pass here would only undo that structure for no benefit.
    // 소스 보기: seen 필터가 없으므로 cursor를 진짜 오프셋으로 쓴다.
    // 홈: seen 기반 페이지네이션 그대로(항상 앞에서 limit개).
    const fresh = source
      ? diversify(unseen).slice(cursor, cursor + limit)
      : unseen.slice(0, limit);

    const level = specializationLevel(user.preferences, user.feedbackCount);
    const phase = feedPhase(level);

    const batch = fresh.map((r) => {
      const d = this._decorate(r.item, r.score, user, {
        now,
        sourceStats: editorialSourceStats.get(r.item.source)
      });
      // surface collaborative picks so "사람들이 좋아한" recommendations are visible
      if ((collabBoosts.get(r.item.id) || 0) > 0.2) {
        d.collabPick = true;
        d.reasons = ["비슷한 취향 픽", ...d.reasons].slice(0, 3);
      }
      return d;
    });

    if (markSeen && batch.length) {
      this.store.markSeen(userId, batch.map((b) => b.id));
      // feed the round-robin fairness ledger (see the `exposure` block above)
      // regardless of view — a source shown via source= should count too, so
      // the home feed doesn't re-show it excessively right after.
      if (this.store.recordSourceExposure) {
        this.store.recordSourceExposure(userId, batch.map((b) => b.source));
      }
    }

    // ---- monetization: affiliate/ad slot insertion (docs/monetization.md) ----
    // Applied AFTER seen/exposure bookkeeping above so slot items never touch
    // the organic dedup/fairness ledgers — they're generated fresh per
    // request (monetize.js), not drawn from the collected pool, and must
    // never count as "an item this user has been shown" for personalization.
    // `nextCursor` below stays based on `batch.length` (organic count only)
    // so pagination is unaffected by however many slots got inserted.
    //
    // 19금/정치/종교 필터가 켜진 뷰에는 절대 노출하지 않는다 — 신뢰 훼손 방지
    // + 광고 네트워크 계정정지 리스크 (docs/monetization.md Non-Goals).
    const monetizeAllowed = !allowAdult && !showTopics.has("politics") && !showTopics.has("religion");
    const displayItems = monetizeAllowed
      ? this._monetize(userId, user, batch, cursor, Boolean(source)).items
      : batch;

    const selMeta = this._lastSelectMeta || null;
    return {
      items: displayItems,
      nextCursor: cursor + batch.length,
      // 1페이지 hated 하드 배제 때문에 모자란 것은 "풀 소진"이 아니다 —
      // 거짓 exhausted가 무한스크롤을 죽이는 것을 막는다(설계 Q3).
      exhausted: batch.length < limit && !(selMeta && selMeta.bannedHatedCount > 0),
      // 선택 카테고리 공급 부족을 클라이언트가 알 수 있게 (정직한 부족 안내)
      pageMeta: selMeta ? { shortfall: selMeta.shortfall } : null,
      phase,
      level,
      feedbackCount: user.feedbackCount
    };
  }

  // Insert affiliate/ad slots into an already-decorated organic batch. Thin
  // glue: monetize.js owns the placement rules + candidate shaping — this
  // wires in this request's user preference vector, this user's ad
  // click-through history (for adaptive density), their recently-shown ad ids
  // (rotation), their A/B variant, and the session-total slot cap.
  // Returns { items, slots } (slots kept for callers that want placement
  // metadata; getFeed above only uses .items).
  //
  // `narrowSource`: true when this call is for a source=-scoped view (a single
  // community/board), not the home feed — 라운드1 검수 #8: a niche view feels
  // ad-denser at the same cadence, so applyNarrowSourceDensity thins it out.
  _monetize(userId, user, batch, cursor, narrowSource = false) {
    const partnerId = process.env.COUPANG_PARTNER_ID || null;
    const preview = Boolean(process.env.AD_PREVIEW);
    if (!partnerId && !preview) return { items: batch, slots: [] }; // 절대원칙1: dummy content 금지

    const variant = assignVariant(userId);
    let params = applyVariant(adParams(), variant);
    params = applyNarrowSourceDensity(params, narrowSource);

    // 세션(24h 롤링) 총량 캡 — 라운드1 검수 #7. AD_MAX_PER_PAGE는 "이 요청
    // 1건"의 상한일 뿐이라, 이게 없으면 스크롤을 계속하는 세션은 노출이
    // 무제한으로 누적된다.
    //
    // 2026-07-25 라운드2 검수 #4 (중대, "AD_MAX_PER_SESSION=0 = 무제한 버그"):
    // 기존엔 `maxPerSession>0`일 때만 이 블록이 실행됐다 — 0이면 조건이
    // 거짓이라 블록 전체가 스킵되고 세션 캡이 사실상 무제한이 됐다. AD_EVERY
    // 등 다른 튜너블에서 0/이하는 "완전 비활성"인 것과 비대칭이었다. 이제
    // 0은 명시적으로 "광고 0개"(즉시 차단)로, 음수는 명시적으로 "무제한"
    // (캡 미적용)으로 처리한다 — docs/monetization.md에도 반영.
    if (params.maxPerSession === 0) return { items: batch, slots: [] };
    if (params.maxPerSession > 0) {
      const already = this.store.adSlotsServedCount ? this.store.adSlotsServedCount(userId) : 0;
      if (already >= params.maxPerSession) return { items: batch, slots: [] };
      params.maxPerPage = Math.min(params.maxPerPage, params.maxPerSession - already);
    }
    // params.maxPerSession < 0 → "무제한": 캡 로직을 적용하지 않고 통과.

    const responsiveness = this.store.adResponsiveness ? this.store.adResponsiveness(userId) : null;
    const every = adaptiveEvery(params.every, responsiveness);
    // 라운드1 검수 #1: seed는 더 이상 cursor에서 유도하지 않는다(짝수 스텝
    // 커서가 seed 패리티를 고정시켜 같은 상품만 반복되던 원인) — 호출마다
    // 항상 전진하는 store 카운터를 쓴다. excludeIds로 최근 노출 상품도
    // 로테이션에서 건너뛴다.
    const seed = this.store.nextAdSeed ? this.store.nextAdSeed(userId) : cursor + 1;
    const excludeIds = this.store.adSeenIdsFor ? this.store.adSeenIdsFor(userId) : undefined;
    const candidates = pickAffiliateCandidates(user.preferences, { partnerId, preview, seed, excludeIds, productFeed: this._productFeed }).map(
      (c) => ({ ...c, variant })
    );
    const result = injectSlots(batch, candidates, { ...params, every, startIndex: cursor });
    if (result.slots.length && this.store.recordAdSlotsServed) {
      this.store.recordAdSlotsServed(userId, result.slots.length);
    }
    return result;
  }

  // `editorialContext` (optional) is engine.js's { now, sourceStats } for
  // editorial.js's buildEditorialNote — see getFeed's editorialSourceStats.
  // Callers that don't pass it (resolveItems/getItem/digest below) still get
  // a note from whichever templates only need the item's own fields; only
  // the source-outlier template is unavailable without it.
  _decorate(item, score, user, editorialContext = null) {
    const rating = user.ratings[item.id];
    const saved = Array.isArray(user.saved) && user.saved.includes(item.id);
    const reasons = user.preferences ? explain(item, user.preferences).map(reasonLabel) : [];
    const now = (editorialContext && editorialContext.now) || (this._clock ? new Date(this._clock()).getTime() : Date.now());
    return {
      ...item,
      adult: item.adult === true,
      categoryLabel: categoryLabel(item.category),
      matchScore: Math.round(score * 100) / 100,
      reasons,
      myRating: rating ? rating.signal : 0,
      saved,
      comments: this.store.commentsFor(item.id).length,
      // 편집 코멘트 한 줄 — docs/monetization.md's AdSense "added value"
      // rationale + curation-taste signal. Never populated for affiliate/ad
      // cards (they never reach _decorate at all — see _monetize below,
      // which builds slot items separately and splices them into the
      // already-decorated organic batch).
      editorialNote: buildEditorialNote(item, {
        now,
        sourceStats: editorialContext && editorialContext.sourceStats
      })
    };
  }

  // Resolve a list of item ids to decorated items (for the 스크랩 list).
  async resolveItems(userId, ids) {
    const items = await this._items();
    const byId = new Map(items.map((i) => [i.id, i]));
    const user = this.store.getUser(userId) || { ratings: {}, saved: [] };
    return ids.map((id) => byId.get(id)).filter(Boolean).map((it) => this._decorate(it, 0, user));
  }

  // Record a like/dislike and learn from it. Returns updated confidence.
  async rate(userId, itemId, signal) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error(`unknown item: ${itemId}`);

    applyFeedback(user.preferences, item, signal);
    this.store.recordRating(userId, itemId, signal >= 0 ? 1 : -1);

    const level = specializationLevel(user.preferences, user.feedbackCount);
    return { level, phase: feedPhase(level), feedbackCount: user.feedbackCount };
  }

  // Public share metadata for an item (for OG tags on a shared link). Adult
  // items get no public share page.
  async shareData(itemId) {
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item || item.adult) return null;
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      category: categoryLabel(item.category),
      source: sourceLabel(item.source)
    };
  }

  // Record an implicit engagement signal (dwell / skip / complete / open) and
  // learn from it. The lightweight, high-volume feedback behind TikTok-style
  // personalization.
  async signal(userId, itemId, event) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) return { ok: false };
    const { step } = applyImplicit(user.preferences, item, event || {});
    this.store.recordSignal(userId, itemId, event && event.type, step);
    return { ok: true, type: event && event.type, step };
  }

  // A non-consuming preview of the best unseen items — the payload behind a
  // "관심글 N개가 올라왔어요" re-engagement notification. Does NOT mark items seen,
  // so opening the app afterwards still shows them in the feed.
  async digest(userId, { limit = 5, minScore = 1.0 } = {}) {
    const user = this.store.requireUser(userId);
    const items = await this._items();
    const seen = new Set(user.seen);
    const allowAdult = user.ageVerified === true && user.showAdult === true;
    const muted = new Set(user.mutedSources || []);
    const disabled = this.store.disabledSources ? this.store.disabledSources() : new Set();
    const showTopics = new Set(user.showTopics || []);
    const pool = items.filter(
      (i) =>
        (allowAdult || !i.adult) &&
        !muted.has(i.source) &&
        !disabled.has(i.source) &&
        !topicsBlocked(i, showTopics) &&
        !seen.has(i.id)
    );
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    // Same hot-only gate as the main feed (see getFeed) — the digest previews
    // "what you'd see if you opened the app now," so it must draw from the
    // same hot-gated pool, not a superset of it.
    const gated = pool.length ? hotGate(pool, now) : [];
    const hotPool = gated.length ? gated.filter((r) => r.hot).map((r) => r.item) : pool;
    const rankPool = hotPool.length ? hotPool : pool;
    const ranked = rankItems(rankPool, user.preferences, { seed: 1, now, explore: 0 })
      .filter((r) => r.score >= minScore);
    return {
      count: ranked.length,
      top: ranked.slice(0, limit).map((r) => this._decorate(r.item, r.score, user))
    };
  }

  // "오늘의 브리핑" 원자료 (애드핏 보류 대응 2026-08-01: "자체 콘텐츠 보충").
  //
  // 아웃링크 카드 나열이 아니라 **우리가 계산한 실측 데이터로 우리가 쓰는**
  // 일일 편집 페이지의 재료다. 모든 수치는 수집된 공개 신호(추천·댓글·다중보도)
  // 그대로이며, 문장 템플릿은 server.js의 briefingPage가 조립한다.
  // 정치·성인 글은 제외한다(브리핑은 로그인/설정 없이 보는 공개 페이지).
  _labelFor(item) {
    if (item.sourceLabel) return item.sourceLabel;
    const t = sourceLabel(item.source);
    if (t && t !== item.source) return t;
    if (this._registryLabels === undefined) {
      try {
        this._registryLabels = new Map(loadRegistry().map((c) => [c.id, c.labelKo || c.label]));
      } catch { this._registryLabels = new Map(); }
    }
    return this._registryLabels.get(item.source) || item.source;
  }

  // ---- 화제 랭킹 (자체 콘텐츠, David 2026-07-31 "주간 일간 월간 탑 20") ----
  //
  // "납득할만한 화제성만 고르는 게 빡세지 않냐"(David)에 대한 답이 이 4중
  // 장치다 — 리소스가 다양해 절대 숫자 비교는 무의미하다는 지적이 맞고,
  // 그래서 절대 숫자로 겨루지 않는다:
  //   1) 소스 내 이례성: sourceHotScores(백분위·로버스트-z·시간감쇠) 재사용 —
  //      큰 게시판의 평범한 글이 절대 추천수로 도배하는 구조를 차단
  //   2) 교차 신호: 여러 매체가 함께 다룬 뉴스(coverage)는 가산
  //   3) 절대 반응 하한: 소스 안에서 1위여도 절대 반응이 미미하면 전국
  //      랭킹에는 싣지 않는다 — 이례성만으로 올리는 것도 납득이 안 되므로
  //   4) 소스당 최대 2개 (다양성 상한)
  // 그리고 항목마다 근거 수치(추천·댓글·보도량)를 실어 페이지가 그대로
  // 노출한다 — 납득은 알고리즘이 아니라 근거 공개가 만든다.
  async rankingTop(limit = 30) {
    const items = await this._items();
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    const pool = items.filter(
      (i) =>
        !i.adult &&
        !(i.topics || []).includes("politics") &&
        i.kind !== "ad" && i.kind !== "affiliate" &&
        i.source !== "seed" && i.source !== "me" &&
        !tooOld(i, now)
    );
    const engagement = (i) => (i.score || 0) + (i.commentCount || 0) * 2;
    const minEng = Number(process.env.RANKING_MIN_ENGAGEMENT ?? 30);
    const scored = sourceHotScores(pool, now)
      .filter((s) => engagement(s.item) >= minEng || (s.item.coverage || 0) >= 3)
      .sort((a, b) =>
        (b.hotScore + Math.min(b.item.coverage || 0, 5) * 0.05) -
        (a.hotScore + Math.min(a.item.coverage || 0, 5) * 0.05));
    const perSrc = new Map();
    const out = [];
    for (const s of scored) {
      if (out.length >= limit) break;
      const src = s.item.source;
      const used = perSrc.get(src) || 0;
      if (used >= 2) continue;
      perSrc.set(src, used + 1);
      const i = s.item;
      out.push({
        id: i.id, title: i.title, url: i.url || null,
        source: i.source, sourceLabel: this._labelFor(i),
        category: i.category || "news", categoryLabel: categoryLabel(i.category || "news"),
        score: i.score || 0, commentCount: i.commentCount || 0,
        coverage: i.coverage || 0, image: i.image || null,
        hot: Math.round(s.hotScore * 1000) / 1000
      });
    }
    return { generatedAt: new Date(now).toISOString(), items: out };
  }

  async briefing() {
    const items = await this._items();
    const now = this._clock ? new Date(this._clock()).getTime() : Date.now();
    const pool = items.filter(
      (i) =>
        !i.adult &&
        !(i.topics || []).includes("politics") &&
        i.kind !== "ad" && i.kind !== "affiliate" &&
        i.source !== "seed" && i.source !== "me" &&
        !tooOld(i, now)
    );
    const engagement = (i) => (i.score || 0) + (i.commentCount || 0) * 2;

    const byCat = new Map();
    for (const i of pool) {
      const c = i.category || "news";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(i);
    }
    const sections = [];
    for (const [cat, list] of byCat) {
      // 화제성 순: 반응 실측 우선, 무신호 뉴스는 다중보도(coverage) 우선
      list.sort((a, b) => (engagement(b) + (b.coverage || 0) * 50) - (engagement(a) + (a.coverage || 0) * 50));
      const top = list.slice(0, 3);
      if (top.length < 2) continue; // 항목이 너무 적은 카테고리는 싣지 않는다
      sections.push({
        category: cat,
        label: categoryLabel(cat),
        items: top.map((i) => ({
          id: i.id, title: i.title,
          sourceLabel: this._labelFor(i),
          score: i.score || 0, commentCount: i.commentCount || 0,
          coverage: i.coverage || 0, publishedAt: i.publishedAt || null
        }))
      });
    }
    // 섹션 정렬: 항목 화제성 합 순
    sections.sort((a, b) =>
      b.items.reduce((s, i) => s + i.score + i.commentCount * 2, 0) -
      a.items.reduce((s, i) => s + i.score + i.commentCount * 2, 0)
    );
    // 오늘 가장 뜨거운 논쟁(댓글 폭발) 한 건
    const debate = pool.filter((i) => (i.commentCount || 0) >= 30)
      .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))[0] || null;
    return {
      generatedAt: new Date(now).toISOString(),
      itemCount: pool.length,
      sourceCount: new Set(pool.map((i) => i.source)).size,
      sections: sections.slice(0, 8),
      debate: debate && {
        id: debate.id, title: debate.title, commentCount: debate.commentCount,
        sourceLabel: this._labelFor(debate)
      }
    };
  }

  // A single item with its full comment thread, for the detail view.
  async getItem(userId, itemId) {
    const items = await this._items();
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    const user = this.store.getUser(userId);
    // never surface a 19금 item to a user who isn't verified + opted in
    if (item.adult && !(user && user.ageVerified === true && user.showAdult === true)) return null;
    const decorated = this._decorate(item, 0, user || { ratings: {} });
    return { ...decorated, thread: this.store.commentsFor(itemId) };
  }
}
