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
// 태깅(item.adult) 자체는 남는다 — 켤 방법이 없으니 태그된 글은 그냥 안 나온다.
export const TOPIC_CATALOG = [
  { id: "politics", label: "정치", defaultVisible: false },
  { id: "religion", label: "종교", defaultVisible: false }
];

// Topics a user can flip on/off directly via POST /api/topics (mutedTopics-style
// per-user state in store.js).
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
  "여야", "여당 대표", "야당 대표", "여야정", "집권여당",
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

// Markers of adult-flagged content in a title (not the content itself). Used
// only to *upgrade* item.adult for items whose source registry entry doesn't
// already flag them adult (e.g. an adult-board post surfaced through a
// mixed-board aggregator listing). "ㅇㅎ)" is the de-facto convention Korean
// community boards use to prefix titillating post titles — confirmed present
// in a 2026-07-24 live fetch of etoland's HIT ranking (FEED_LIVE=1 check).
// 2026-08-01 확장: 애드핏 매체심사가 "성적 자극 콘텐츠"로 보류됐다. 라이브 풀
// 실측에서 이토랜드 유머글("○○ 비키니", "가슴골", "은꼴")이 adult 미태그로 기본
// 피드에 노출 중이었다 — 커뮤니티 은꼴성 제목 어휘를 사전에 편입해 기존 19금
// 게이트(기본 숨김) 뒤로 보낸다. 오탐 주의: "꼴" 단독은 넣지 않는다("꼴뵈기
// 싫다" 같은 일상어에 걸린다 — 실측 확인). 웨딩/광고 "화보"도 단독으론 안 넣는다.
export const ADULT_KEYWORDS = [
  "19금", "19禁", "19세이상", "성인인증", "성인방송", "성인용품", "노출주의", "후방주의",
  // 2026-08-02 라이브 실측(이토랜드 HIT 27건): "[약후]"(약한 후방주의)는 커뮤니티
  // 표준 은꼴 태그인데 사전에 없어 그대로 기본 피드에 떴다 — 애드핏 "성적 자극
  // 콘텐츠" 보류 사유에 직결된다. "약후" 단독은 "약후불제"에 걸리므로 표기형만.
  "[약후]", "(약후)", "약후방", "약후 ", "보타구니",
  "야동", "AV배우", "선정적", "음란물", "ㅇㅎ)", "ㅇㅎ]",
  // 커뮤니티 은꼴성 제목 (실측 기반)
  // 2026-08-02 적대적 검수 A1: 아래 단어들이 무경계 매칭으로 정상 글을 19금
  // 게이트(기본 숨김) 뒤에 가뒀다 — "입욕제", "니트 착샷", "성인용 킥보드",
  // "글래머러스한 조명", "몸매 관리". 게이트는 숨기는 쪽이라 오탐 비용이
  // 미탐 비용보다 크다. 단독 일반어를 빼고 은어·복합어만 남긴다.
  "비키니", "가슴골", "은꼴", "꼴릿", "란제리", "야짤",
  "세라복", "오프솔더", "속옷 화보", "섹시 화보", "노출 연기",
  "몸매 노출", "몸매 자랑", "몸매 甲", "글래머 화보", "입욕 인증", "착용샷 후방",
  // 2026-08-03 애드핏 매체심사 보류 사유 "직/간접적인 성적 표현" 대응.
  // 심사원 시점(미인증) 라이브 240건을 넓은 그물로 훑어 실제로 남아 있던 것만
  // 넣는다 — "파격 노출 BJ ... 움짤", 그리고 연예 매체가 관용적으로 쓰는
  // 신체 묘사구. "노출"·"몸매"·"움짤" 단독은 넣지 않는다(각각 "노출 콘크리트",
  // "몸매 관리", 일반 움짤에 걸린다 — 2026-08-02 A1에서 고친 오탐을 되돌리는 셈).
  "파격 노출", "노출 의상", "노출 화보", "노출 드레스", "아찔한 노출",
  "각선미", "볼륨 몸매", "군살 없는 몸매", "몸매 자태",
  // 2026-07-31 적대적 검수(QA 페르소나) 실측: "국산 왕가슴" 제목이 기본
  // 피드에 노출 — 신체 부위 은어 계열 보강. "가슴" 단독은 일상어("가슴이
  // 아프다")에 걸리므로 넣지 않는다.
  "왕가슴", "슴가", "육덕", "뒷태", "노빠꾸 노출"
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
