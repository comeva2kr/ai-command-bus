// Content topic classification: keyword + board-slug based, NOT AI.
//
// Every normalized item gets a `topics: []` array (e.g. ["politics"]) via a
// classifier that runs once, in content.js's normalizeItem. Two independent,
// data-driven signals feed it — either one is enough to tag a topic:
//
//  1. Board-slug (`BOARD_TOPIC_RULES`): a handful of sources are *aggregators*
//     whose own listing mixes every board on the site (etoland's site-wide
//     HIT ranking, ppomppu's HOT ranking) — communities.json's per-source
//     `category`/`adult` can't capture that, but the *item's own url* still
//     carries which board it came from, so the slug is read straight out of
//     the url. Verified against a live fetch (2026-07-24): etoland's
//     /hit/list links read https://etoland.co.kr/hit/{board}/view/... and
//     ppomppu's hot.php links read zboard.php?id={board}&no=....
//  2. Keyword (`POLITICS_KEYWORDS` / `RELIGION_KEYWORDS` / `ADULT_KEYWORDS`):
//     a plain title substring match, source-agnostic. Kept as data so the
//     vocabulary is easy to extend without touching the matching logic.
//
// `adult` gets special treatment: it is not a new gate. classifyTopics() only
// *tags* an item; content.js ORs an "adult" tag into the item's existing
// `adult` field so the one 19금 gate the app already has (age-verify + toggle,
// engine.js) keeps being the single source of truth — no parallel adult gate.

// The three toggleable topics the client shows, in a fixed order. `adult`'s
// visibility is still fully governed by the existing 19금 gate (verify-age +
// /api/adult) — it's listed here only so the UI/API can describe it alongside
// politics/religion in one catalog.
export const TOPIC_CATALOG = [
  { id: "politics", label: "정치", defaultVisible: false },
  { id: "religion", label: "종교", defaultVisible: false },
  { id: "adult", label: "성인", defaultVisible: false }
];

// Topics a user can flip on/off directly via POST /api/topics (mutedTopics-style
// per-user state in store.js). "adult" is deliberately excluded — it stays on
// the existing verify-age + /api/adult path so there's exactly one adult gate.
export const FILTERABLE_TOPICS = ["politics", "religion"];

// ---- board-slug rules ----------------------------------------------------
// `source` matches the community's registry id (communities.json); `pattern`
// tests the item's own (already-resolved) url. Only aggregator-style sources
// need an entry here — everything else is covered by the keyword rules below.
export const BOARD_TOPIC_RULES = [
  // 이토랜드 HIT 랭킹(/hit/list)은 전체 게시판이 섞인 사이트 통합 인기글이라,
  // 아이템 개별 url의 보드 세그먼트로만 원 게시판을 구분할 수 있다.
  { source: "etoland", pattern: /\/hit\/sisabbs\d*\//i, topic: "politics" }, // 시사 게시판
  { source: "etoland", pattern: /\/hit\/anony\d*\//i, topic: "adult" }, // 익명 게시판(성인 소지 콘텐츠 다수)
  // 뽐뿌 HOT게시글(hot.php)도 전 게시판 통합 랭킹 — zboard.php?id={board}로 원 게시판 확인.
  { source: "ppomppu", pattern: /[?&]id=issue\b/i, topic: "politics" }, // 정치자유게시판
  { source: "ppomppu", pattern: /[?&]id=pol_left\b/i, topic: "politics" }, // 진보공감게시판
  { source: "ppomppu", pattern: /[?&]id=pol_right\b/i, topic: "politics" }, // 보수공감게시판
  { source: "ppomppu", pattern: /[?&]id=news_pol_eco\b/i, topic: "politics" } // 뽐뿌뉴스: 정치
];

// ---- keyword rules (title-based, source-agnostic) ------------------------
export const POLITICS_KEYWORDS = [
  "이재명", "윤석열", "국민의힘", "민주당", "한동훈", "정청래", "조국", "오세훈", "이낙연",
  "안철수", "홍준표", "유승민", "이준석", "나경원",
  "대통령실", "국회의원", "국회", "총선", "대선", "탄핵", "특검", "여야", "여당", "야당",
  "정당", "공천", "청와대", "국무총리", "국정감사", "국정원", "정치권", "개헌", "원내대표"
];

export const RELIGION_KEYWORDS = [
  "신천지", "목사", "교회", "불교", "기독교", "천주교", "이슬람", "무슬림", "포교",
  "스님", "법당", "사찰", "성당", "신부님", "개신교", "하나님", "부처님", "코란",
  "성경", "전도사", "목회자", "승려", "불자"
];

// Markers of adult-flagged content in a title (not the content itself). Used
// only to *upgrade* item.adult for items whose source registry entry doesn't
// already flag them adult (e.g. an adult-board post surfaced through a
// mixed-board aggregator listing). "ㅇㅎ)" is the de-facto convention Korean
// community boards use to prefix titillating post titles — confirmed present
// in a 2026-07-24 live fetch of etoland's HIT ranking (FEED_LIVE=1 check).
export const ADULT_KEYWORDS = [
  "19금", "19禁", "19세이상", "성인인증", "성인", "노출주의", "후방주의",
  "야동", "AV배우", "선정적", "음란물", "ㅇㅎ)", "ㅇㅎ]"
];

function titleHasAny(title, keywords) {
  if (!title) return false;
  return keywords.some((k) => title.includes(k));
}

function boardTopicsFor(sourceId, url) {
  if (!url || !sourceId) return [];
  return BOARD_TOPIC_RULES.filter((r) => r.source === sourceId && r.pattern.test(url)).map((r) => r.topic);
}

// Classify a title/url/source into a deduplicated topics[] array. Called from
// content.js's normalizeItem so every item — rss/list/api/seed/me — is tagged
// the same way, exactly once, at the point it enters the system.
export function classifyTopics({ title, url, sourceId } = {}) {
  const topics = new Set();

  for (const t of boardTopicsFor(sourceId, url)) topics.add(t);
  if (titleHasAny(title, POLITICS_KEYWORDS)) topics.add("politics");
  if (titleHasAny(title, RELIGION_KEYWORDS)) topics.add("religion");
  if (titleHasAny(title, ADULT_KEYWORDS)) topics.add("adult");

  return [...topics];
}
