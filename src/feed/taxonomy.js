// Category and tag taxonomy for the personalized feed.
//
// Categories are broad content buckets. Tags are finer-grained interest
// signals that the recommender learns weights for. Every content item is
// expected to declare exactly one category and any number of tags.

export const CATEGORIES = [
  { id: "news", label: "뉴스/시사", labelEn: "News" },
  { id: "tech", label: "기술/IT", labelEn: "Technology" },
  { id: "auto", label: "자동차", labelEn: "Automotive" },
  { id: "science", label: "과학", labelEn: "Science" },
  { id: "business", label: "경제/비즈니스", labelEn: "Business" },
  { id: "gaming", label: "게임", labelEn: "Gaming" },
  { id: "sports", label: "스포츠", labelEn: "Sports" },
  { id: "culture", label: "문화/연예", labelEn: "Culture" },
  { id: "life", label: "라이프/취미", labelEn: "Lifestyle" },
  { id: "humor", label: "유머/일상", labelEn: "Humor" },
  { id: "politics", label: "정치", labelEn: "Politics" }
];

// 태그의 한국어 이름 (David 2026-08-06).
//
// "사용성이 아주 매끄러울 수 있게 모든 화제나 정보에 대한 모든 유형별 태그들을
//  뽑아서 정리하자."
//
// 그동안 화면에는 **영문 id가 그대로** 나왔다 — server.js가 `label: "#" + x.id`로
// 만들었기 때문이다. 취향 대시보드에 "#sneakers", "#realestate", "#pc-gaming"이
// 찍혔다. 한국어 서비스에서 관심사를 영어로 보여 주는 것은 그 자체로 새는 곳이다.
//
// TAGS 배열(문자열)은 **건드리지 않는다.** isKnownTag·설문·추천기가 전부 이
// 배열을 문자열로 다루고 있어, 구조를 바꾸면 그 전부를 함께 고쳐야 한다.
// 라벨은 옆에 맵으로 둔다 — 새 개념을 만들지 않고 덧붙이는 쪽이 안전하다.
//
// 일본식 한자 표기는 쓰지 않는다(프로젝트 규칙). 사람들이 실제로 쓰는 말로 적는다.
export const TAG_LABELS = {
  ai: "AI",
  startup: "스타트업",
  programming: "개발",
  hardware: "하드웨어",
  mobile: "모바일",
  security: "보안",
  cars: "자동차",
  testdrive: "시승기",
  ev: "전기차",
  motorcycle: "오토바이",
  space: "우주",
  biology: "생명과학",
  physics: "물리",
  climate: "기후",
  markets: "증시",
  crypto: "코인",
  realestate: "부동산",
  career: "커리어",
  fashion: "패션",
  sneakers: "스니커즈",
  interior: "인테리어",
  art: "예술",
  design: "디자인",
  health: "건강",
  "pc-gaming": "PC게임",
  console: "콘솔게임",
  esports: "e스포츠",
  football: "축구",
  baseball: "야구",
  basketball: "농구",
  movies: "영화",
  music: "음악",
  kdrama: "드라마",
  celebrity: "연예인",
  food: "음식",
  travel: "여행",
  fitness: "운동",
  pets: "반려동물",
  parenting: "육아",
  meme: "밈",
  story: "사연",
  advice: "조언",
  policy: "정책",
  election: "선거",
  world: "국제"
};

// 학습된 태그는 사전에 없다 — 추천기가 제목에서 뽑은 것(실측 예: "nike",
// "아이돌", "awich")이라 미리 이름을 지어 둘 수 없다. 그런 태그는 **id를 그대로
// 쓴다.** 없는 이름을 지어내는 것보다 낫고, 어차피 그 태그의 id 자체가 사람이
// 쓴 말에서 나온 것이라 대체로 읽힌다.
export function tagLabel(id) {
  if (!id) return "";
  return TAG_LABELS[id] || String(id);
}

// A curated tag vocabulary. The recommender can also learn tags it has never
// seen before, but seeding a vocabulary keeps the survey and cold-start
// behaviour predictable.
export const TAGS = [
  "ai",
  "startup",
  "programming",
  "hardware",
  "mobile",
  "security",
  "cars",
  "testdrive",
  "ev",
  "motorcycle",
  "space",
  "biology",
  "physics",
  "climate",
  "markets",
  "crypto",
  "realestate",
  "career",
  // 2026-08-06 추가 (David: "패션, 부동산(국내), it 등 더 다양한 카테고리로
  // 리소스를 확장"). 소스를 넣어도 이 목록에 말이 없으면 그 취향을 고를 수
  // 없어서, 아무리 좋은 소스를 붙여도 취향과 이어지지 않는다.
  "fashion",
  "sneakers",
  "interior",
  "art",
  "design",
  "health",
  "pc-gaming",
  "console",
  "esports",
  "football",
  "baseball",
  "basketball",
  "movies",
  "music",
  "kdrama",
  "celebrity",
  "food",
  "travel",
  "fitness",
  "pets",
  "parenting",
  "meme",
  "story",
  "advice",
  "policy",
  "election",
  "world"
];

// Communities / outlets the feed can pull from. `label` is what the survey and
// UI show; `kind` hints whether it's a community board or a news outlet.
export const SOURCE_CATALOG = [
  { id: "bobae", label: "보배드림", kind: "community" },
  { id: "getcha", label: "겟차", kind: "community" },
  { id: "encar", label: "엔카", kind: "community" },
  { id: "clien", label: "클리앙", kind: "community" },
  { id: "ppomppu", label: "뽐뿌", kind: "community" },
  { id: "ruliweb", label: "루리웹", kind: "community" },
  { id: "inven", label: "인벤", kind: "community" },
  { id: "humoruniv", label: "웃긴대학", kind: "community" },
  { id: "dcinside", label: "디시인사이드", kind: "community" },
  { id: "instiz", label: "인스티즈", kind: "community" },
  { id: "theqoo", label: "더쿠", kind: "community" },
  { id: "mlbpark", label: "엠엘비파크", kind: "community" },
  { id: "82cook", label: "82쿡", kind: "community" },
  { id: "techwire", label: "테크와이어", kind: "news" },
  { id: "autopost", label: "오토포스트", kind: "news" },
  { id: "sciencedaily", label: "사이언스데일리", kind: "news" },
  { id: "marketpost", label: "마켓포스트", kind: "news" },
  { id: "sportsline", label: "스포츠라인", kind: "news" },
  { id: "entnews", label: "엔터뉴스", kind: "news" },
  { id: "gamespot", label: "게임스팟", kind: "news" },
  { id: "newswire", label: "뉴스와이어", kind: "news" },
  // 구글뉴스 — 2026-07-28에 키워드 검색 피드(rss/search?q=…)에서 편집 섹션
  // 피드(rss/topics/…)로 교체하면서 각 소스가 실제로 담아 오는 내용이 바뀌었다
  // (예: gnews-science는 이제 '건강' 섹션). 라벨은 communities.json이 원본이고
  // 여기는 그 사본이라, 둘이 어긋나면 화면에 옛 이름이 남는다 — newsrank.test.js가
  // 두 목록의 라벨 일치를 검사한다.
  { id: "gnews", label: "구글뉴스 주요뉴스", kind: "news" },
  { id: "gnews-kr", label: "구글뉴스 대한민국", kind: "news" },
  { id: "gnews-world", label: "구글뉴스 세계", kind: "news" },
  { id: "gnews-biz", label: "구글뉴스 경제", kind: "news" },
  { id: "gnews-tech", label: "구글뉴스 과학·기술", kind: "news" },
  { id: "gnews-ent", label: "구글뉴스 연예", kind: "news" },
  { id: "gnews-sports", label: "구글뉴스 스포츠", kind: "news" },
  { id: "gnews-science", label: "구글뉴스 건강", kind: "news" },
  // 폐기된 소스들(구글 KR에 대응 섹션이 없어 비활성). 이미 수집돼 있던 글이
  // 보존 기간 동안 남아 있으므로 라벨은 그대로 둔다 — 지우면 그 카드들이
  // 영문 id를 그대로 노출한다.
  { id: "gnews-auto", label: "구글뉴스 자동차", kind: "news" },
  { id: "gnews-game", label: "구글뉴스 게임", kind: "news" }
];

export function sourceLabel(id) {
  const found = SOURCE_CATALOG.find((s) => s.id === id);
  return found ? found.label : id;
}

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const TAG_IDS = new Set(TAGS);

export function isKnownCategory(id) {
  return CATEGORY_IDS.has(id);
}

export function isKnownTag(id) {
  return TAG_IDS.has(id);
}

export function categoryLabel(id) {
  const found = CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
}
