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
  { id: "newswire", label: "뉴스와이어", kind: "news" }
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
