// 자체 콘텐츠 페이지 데이터 — 커뮤니티 순위 / 그룹별 베스트 / 키워드.
//
// ── 왜 (2026-08-04)
// 애드핏 심사 보류 사유: "자체 콘텐츠가 아닌 외부 콘텐츠, 외부 링크가 많은
// 비중을 차지하고 있는 매체는 광고게재가 허용되지 않습니다."
//
// 벤치마킹(오늘의베스트)에서 우리에게 없던 세 가지가 여기 있다:
//   커뮤니티 순위 — 22곳을 방문수·글수로 줄 세운 표
//   그룹별 베스트 — 커뮤니티마다 TOP 10
//   (Hotbest7) 키워드 랜딩 — /stock/삼성전자 같은 검색 유입용 페이지
//
// ── 우리가 다르게 하는 것: 방문자수는 쓰지 않는다
// 오늘의베스트의 순위표는 "방문 289.5M" 같은 외부 트래픽 추정치를 싣는다.
// 우리는 그 수를 잰 적이 없으므로 쓰지 않는다. 대신 **우리가 실제로 측정한
// 값**으로 순위를 매긴다 — 오늘 수집한 베스트글 수, 그 글들의 총 반응량,
// 글당 평균 댓글. 지어낸 수가 없으니 검증도 우리 로그로 끝난다.
// 남이 복사할 수 없는 데이터라는 점에서도 이쪽이 낫다.
import { extractTags } from "./tags.js";

// ── 커뮤니티 순위 ────────────────────────────────────────────────────────
// 정렬 기준은 "총 반응량" — 추천과 댓글의 합. 글 수만 세면 많이 긁어오는
// 소스가 이기고, 평균만 보면 한 건 올린 소스가 이긴다. 둘 다 반영되는 건
// 합계다. 동점이면 글 수가 많은 쪽을 앞에 둔다.
export function communityRanking(items, { minItems = 1 } = {}) {
  const by = new Map();
  for (const it of items) {
    const id = it.source;
    if (!id) continue;
    if (!by.has(id)) {
      by.set(id, {
        source: id, label: it.sourceLabel || id, kind: it.kind || "community",
        posts: 0, score: 0, comments: 0, categories: new Map()
      });
    }
    const e = by.get(id);
    e.posts++;
    e.score += Number(it.score) || 0;
    e.comments += Number(it.commentCount) || 0;
    if (it.category) e.categories.set(it.category, (e.categories.get(it.category) || 0) + 1);
  }
  return [...by.values()]
    .filter((e) => e.posts >= minItems)
    .map((e) => ({
      source: e.source, label: e.label, kind: e.kind,
      posts: e.posts, score: e.score, comments: e.comments,
      reactions: e.score + e.comments,
      // 평균은 반올림해서 정수로. 소수점은 정밀해 보이지만 의미가 없다.
      avgComments: e.posts ? Math.round(e.comments / e.posts) : 0,
      // 그 커뮤니티가 오늘 무엇을 많이 다뤘는지 — 성격을 한눈에 보여준다.
      topCategory: topKey(e.categories)
    }))
    .sort((a, b) => b.reactions - a.reactions || b.posts - a.posts);
}

function topKey(map) {
  let best = null, n = -1;
  for (const [k, v] of map) if (v > n) { best = k; n = v; }
  return best;
}

// ── 그룹별 베스트 ────────────────────────────────────────────────────────
// 커뮤니티마다 TOP N. 페이지 하나에 소스 전부를 싣는 게 아니라 소스별
// 페이지로 쪼갠다 — 색인 대상이 소스 수만큼 늘고, "클리앙 인기글" 같은
// 검색어에 각각 대응된다.
export function sourceBest(items, source, { limit = 15 } = {}) {
  const mine = items.filter((i) => i.source === source);
  if (!mine.length) return null;
  const ranked = mine
    .slice()
    .sort((a, b) => (b.score + b.commentCount) - (a.score + a.commentCount));
  return {
    source,
    label: mine[0].sourceLabel || source,
    kind: mine[0].kind || "community",
    total: mine.length,
    items: ranked.slice(0, limit),
    // 이 소스가 오늘 다룬 분야 분포 — 자체 서술의 재료.
    categories: countBy(mine, (i) => i.category)
  };
}

function countBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
}

// ── 키워드 ──────────────────────────────────────────────────────────────
// tags.js가 이미 제목에서 태그를 뽑는다. 그중 여러 소스에 걸쳐 나온 것만
// 페이지로 만든다.
//
// minSources를 두는 이유: 한 커뮤니티에서만 나온 단어는 그 글의 고유명사일
// 뿐 "화제 키워드"가 아니다. 두 곳 이상에서 나와야 실제로 퍼지는 말이고,
// 그래야 검색 유입도 기대할 수 있다. 알맹이 없는 페이지를 수백 개 만들면
// 자체 콘텐츠를 늘리는 게 아니라 오히려 감점이다.
export function keywordIndex(items, { minSources = 2, minItems = 3, limit = 60 } = {}) {
  const by = new Map();
  for (const it of items) {
    for (const tag of extractTags(it.title || "")) {
      if (!by.has(tag)) by.set(tag, { tag, items: [], sources: new Set() });
      const e = by.get(tag);
      e.items.push(it);
      e.sources.add(it.source);
    }
  }
  return [...by.values()]
    .filter((e) => e.sources.size >= minSources && e.items.length >= minItems)
    .map((e) => ({
      tag: e.tag,
      count: e.items.length,
      sources: e.sources.size,
      reactions: e.items.reduce((s, i) => s + (i.score || 0) + (i.commentCount || 0), 0)
    }))
    .sort((a, b) => b.reactions - a.reactions || b.count - a.count)
    .slice(0, limit);
}

// 키워드 페이지.
//
// 1차는 사전 기반 태그(extractTags)로 찾는다. 못 찾으면 **제목에 그 말이
// 들어간 글**로 내려간다 — 실시간 트렌드에서 오는 말(아이돌 이름, 해시태그,
// 신조어)은 사전에 없기 때문이다.
//
// 이 폴백이 없으면 /trends의 키워드를 우리 페이지로 보낼 수 없고, 그래서
// 예전에는 20개 전부 X(트위터) 검색으로 나갔다 — 애드핏 반려 사유가
// "아웃링크 비중"인데 그 페이지가 아웃링크만 20개였다(2026-08-06 실측).
// 사용자를 트위터로 보내면 우리 광고 노출도 거기서 끝난다.
export function keywordPage(items, tag, { limit = 20 } = {}) {
  let mine = items.filter((i) => extractTags(i.title || "").includes(tag));
  let matchedBy = "tag";
  if (!mine.length) {
    // 한 글자 말로는 찾지 않는다 — 아무 제목에나 걸린다.
    const q = String(tag || "").trim().toLowerCase();
    if (q.length < 2) return null;
    mine = items.filter((i) => String(i.title || "").toLowerCase().includes(q));
    matchedBy = "text";
  }
  if (!mine.length) return null;
  const ranked = mine.slice().sort((a, b) => (b.score + b.commentCount) - (a.score + a.commentCount));
  return {
    tag,
    matchedBy,
    total: mine.length,
    sources: countBy(mine, (i) => i.sourceLabel || i.source),
    categories: countBy(mine, (i) => i.category),
    items: ranked.slice(0, limit)
  };
}
