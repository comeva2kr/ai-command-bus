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
