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

// 클라이언트가 켜고 끌 수 있는 토픽. 2026-08-04부터 `adult`는 여기 없다.
//
// 애드핏 매체 심사 보류의 참고 이미지(i.imgur.com/tz7vGUc.png)에서 심사자가
// 지목한 것이 게시글이 아니라 우리 메뉴의 "성인 콘텐츠(19금) 보기" 토글
// 한 줄이었다. 같은 캡처의 피드는 미용실·닭다리살·메이플이었고, 실측으로도
// 그 시점 라이브 160건 중 성인 태그는 0건이었다.
// 목록에서 빼면 API 응답과 UI 어디에도 "성인"이라는 항목이 나타나지 않는다.
export const TOPIC_CATALOG = [
  { id: "politics", label: "정치", defaultVisible: false },
  { id: "religion", label: "종교", defaultVisible: false }
];

// Topics a user can flip on/off directly via POST /api/topics (mutedTopics-style
// per-user state in store.js).
export const FILTERABLE_TOPICS = ["politics", "religion"];

// 콘텐츠 필터가 다루는 키 전체. politics·religion은 **기본 숨김**이라
// showTopics에 있으면 보이지만, 핫딜은 **기본 보임**이라 방향이 반대다.
// 그래서 "deal"이 아니라 "nodeal"로 담는다 — showTopics에 nodeal이 있으면 숨긴다.
// (David 2026-08-06: "메뉴에 핫딜 모아보기 없애고, 콘텐츠 필터에 핫딜을 넣어
//  숨기기·보기". 밖 화면에 핫딜 탭이 이미 있어 모아보기 버튼은 중복이었다.)
export const NO_DEAL_TOPIC = "nodeal";
export const FILTER_KEYS = [...FILTERABLE_TOPICS, NO_DEAL_TOPIC];

// ---- board-slug rules ----------------------------------------------------
// `source` matches the community's registry id (communities.json); `pattern`
// tests the item's own (already-resolved) url. Only aggregator-style sources
// need an entry here — everything else is covered by the keyword rules below.
export const BOARD_TOPIC_RULES = [
  // 이토랜드 HIT 랭킹(/hit/list)은 전체 게시판이 섞인 사이트 통합 인기글이라,
  // 아이템 개별 url의 보드 세그먼트로만 원 게시판을 구분할 수 있다.
  { source: "etoland", pattern: /\/hit\/sisabbs\d*\//i, topic: "politics" }, // 시사 게시판
  // 뽐뿌 HOT게시글(hot.php)도 전 게시판 통합 랭킹 — zboard.php?id={board}로 원 게시판 확인.
  { source: "ppomppu", pattern: /[?&]id=issue\b/i, topic: "politics" }, // 정치자유게시판
  { source: "ppomppu", pattern: /[?&]id=pol_left\b/i, topic: "politics" }, // 진보공감게시판
  { source: "ppomppu", pattern: /[?&]id=pol_right\b/i, topic: "politics" }, // 보수공감게시판
  { source: "ppomppu", pattern: /[?&]id=news_pol_eco\b/i, topic: "politics" } // 뽐뿌뉴스: 정치
];

// ---- keyword rules (title-based, source-agnostic) ------------------------
// 2026-07-29 보강: 실측에서 "국힘 조경태 '윤리위는 장동혁 아바타'"가 미분류였다
// — 정식 명칭("국민의힘")만 있고 뉴스가 실제로 쓰는 약칭("국힘")이 없어서다.
// 원칙: 정치 행위자·기관·절차의 **고유명사만** 넣는다. "논란"·"비판" 같은
// 일반어를 넣으면 연예 기사까지 정치로 잡힌다. 오탐이 확인되면 단어를 빼는 게
// 정답이지 매칭 로직을 꼬는 게 아니다 — 사전은 설명 가능해야 한다.
export const POLITICS_KEYWORDS = [
  // 인물 (당대표급 이상)
  "이재명", "윤석열", "한동훈", "정청래", "조국", "오세훈", "이낙연",
  "안철수", "홍준표", "유승민", "이준석", "나경원", "장동혁",
  // 정당 (약칭 포함)
  "국민의힘", "국힘", "민주당", "개혁신당", "조국혁신당", "정의당", "진보당",
  // 2026-08-02 적대적 검수 A1: "여당"·"야당"·"정당" 단독은 무경계 매칭에서
  // "급여당일지급"·"심야당직"·"부정당" 같은 일상어를 정치로 은폐시켰다.
  // 정치 토글은 기본 숨김이라 오탐이 곧 조용한 검열이 된다 — 복합어로 한정.
  // "여야" 단독은 아래 POLITICS_KEYWORD_PATTERNS로 옮겼다(고정 표본 6).
  "여당 대표", "야당 대표", "여야정", "집권여당",
  // A9: 국제 정치 고유명사가 통째로 비어 있어 "정치 끄기"를 우회했다
  "트럼프", "시진핑", "푸틴", "김정은", "젤렌스키", "바이든",
  "백악관", "크렘린", "노동당 대회", "북미회담", "한미정상", "한일정상",
  // 기관·직위·절차
  "대통령실", "청와대", "국회의원", "국회", "법사위", "국정감사", "국감",
  "당대표", "원내대표", "비대위", "공천", "탄핵", "특검", "공수처",
  "헌법재판소", "헌재", "선관위", "국무총리", "인사청문회", "국정원",
  // 선거·정치 일반
  "총선", "대선", "재보궐", "개헌", "계엄", "정치권"
];

export const RELIGION_KEYWORDS = [
  "신천지", "목사", "교회", "불교", "기독교", "천주교", "이슬람", "무슬림", "포교",
  "스님", "법당", "사찰", "성당", "신부님", "개신교", "하나님", "부처님", "코란",
  "성경", "전도사", "목회자", "승려", "불자"
];

// ── 성인 분류는 없앴다 (David 2026-08-05: "성인 필터로 글 걸러내지마")
//
// 여기에는 은어 사전이 있었다. 애드핏 보류 사유가 "성적 자극 콘텐츠"라
// 몇 차례에 걸쳐 어휘를 늘려 왔는데, 그때마다 오탐도 같이 늘었다 —
// "입욕제", "니트 착샷", "성인용 킥보드", "노출 콘크리트", "몸매 관리"가
// 게이트 뒤에 갇혔던 것이 실측으로 확인됐다.
//
// 그리고 애드핏이 실제로 지목한 것은 게시글이 아니라 **메뉴의 "성인
// 콘텐츠(19금) 보기" 토글 한 줄**이었다(참고 이미지). 같은 캡처의 피드는
// 미용실·닭다리살·메이플이었고, 그 시점 라이브 160건 중 성인 태그는 0건이었다.
// 즉 사전을 아무리 키워도 지적된 문제는 해결되지 않는 구조였다.
//
// 그래서 사전과 분류, 그리고 그것에 딸린 게이트를 통째로 걷어냈다.
// 우리 소스는 커뮤니티 **베스트 게시판**이라 애초에 성인물이 올라오는 자리가
// 아니고, 성인 소스 3곳(dc_adult·adult_life·reddit_nsfw)은 레지스트리에서
// enabled:false라 수집 자체를 하지 않는다 — 그건 필터가 아니라 소스 선택이다.


// 경계가 필요한 정치 어휘 (고정 표본 6 실측, 2026-08-13 P2-A): 더쿠
// "40대가 되면 줄여야 하는 음식들"이 "줄여야" 안의 부분문자열 "여야"로 정치
// 태그가 붙어 politics 칸에 실렸다. "여야"는 용언 활용 어미(-여야: 줄여야·
// 보여야·해야…)와 충돌하는 항목이라 단순 부분문자열로 둘 수 없고, 그렇다고
// 빼면 진짜 정치 제목("여야, 세제 개편 공방")을 놓친다. 앞 글자가 한글이
// 아닐 때(문장 시작·공백·괄호 뒤)만 인정한다 — classify.js가 영문 약어에
// 쓰는 경계 원칙과 같다.
export const POLITICS_KEYWORD_PATTERNS = [
  /(?:^|[^가-힣])여야/
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
export function classifyTopics({ title, url, sourceId, category } = {}) {
  const topics = new Set();

  for (const t of boardTopicsFor(sourceId, url)) topics.add(t);
  if (category === "politics") topics.add("politics");
  if (titleHasAny(title, POLITICS_KEYWORDS)
    || (title && POLITICS_KEYWORD_PATTERNS.some((p) => p.test(title)))) topics.add("politics");
  if (titleHasAny(title, RELIGION_KEYWORDS)) topics.add("religion");

  return [...topics];
}
