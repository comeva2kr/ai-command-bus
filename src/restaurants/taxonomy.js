// Controlled vocabulary + synonym normalization so that messy, real-world
// search terms ("뒷고기", "숙성 회", "키즈 카페") map onto stable filter keys.

// Feature flags a place can advertise. These are the "hard" lifestyle
// conditions a user typically stacks (아이 동반 가능? 파티션 있음? 주차 됨?).
export const FEATURE_KEYS = [
  "kidsCafe", // 매장 내/연계 키즈카페
  "kidFriendly", // 아이 데려가기 좋음(놀이방/유아의자/좌식 등)
  "partition", // 테이블 간 파티션
  "privateRoom", // 룸/개별 공간
  "parking", // 주차 가능
  "petFriendly", // 반려동물 동반
  "reservable", // 예약 가능
  "lateNight", // 심야 영업
  "soloFriendly", // 혼밥 좋음
  "vegetarianOptions" // 채식 옵션
];

// Free-form descriptive tags (분위기 + 음식 특성). Users can require, exclude,
// or prefer any of these.
export const TAG_SYNONYMS = {
  뒷고기: ["뒷고기", "특수부위", "가브리살", "항정살"],
  숙성회: ["숙성회", "숙성 회", "선어회", "숙성사시미"],
  가성비: ["가성비", "가성비좋은", "저렴한", "가격착한"],
  분위기좋은: ["분위기좋은", "분위기 좋은", "감성", "인테리어좋은"],
  고급스러운: ["고급스러운", "고급진", "프리미엄", "파인다이닝느낌"],
  조용한: ["조용한", "차분한", "한적한"],
  뷰맛집: ["뷰맛집", "전망좋은", "오션뷰", "시티뷰"],
  노포: ["노포", "오래된", "전통있는"],
  데이트: ["데이트", "데이트하기좋은", "기념일"],
  회식: ["회식", "단체", "모임"]
};

// Place styles (장소 스타일) and cuisines (음식 종류) with synonyms.
export const STYLE_SYNONYMS = {
  고깃집: ["고깃집", "고기집", "구이", "바베큐", "bbq"],
  이자카야: ["이자카야", "선술집", "izakaya", "일본식술집"],
  횟집: ["횟집", "회집", "스시야", "오마카세"],
  한식당: ["한식당", "백반", "한정식"],
  카페: ["카페", "브런치", "디저트"],
  양식: ["양식", "이탈리안", "파스타", "스테이크하우스"],
  중식: ["중식", "중국집", "마라"],
  분식: ["분식", "포장마차"]
};

export const CUISINE_SYNONYMS = {
  돼지고기: ["돼지고기", "삼겹살", "뒷고기", "돈까스", "포크"],
  소고기: ["소고기", "한우", "소갈비", "우대갈비"],
  회: ["회", "사시미", "숙성회", "물회"],
  초밥: ["초밥", "스시", "오마카세"],
  곱창: ["곱창", "막창", "대창"],
  치킨: ["치킨", "닭", "닭갈비"],
  국물요리: ["국물요리", "탕", "찌개", "전골"],
  면요리: ["면요리", "라멘", "우동", "파스타", "국수"]
};

// Menu-level search. Dishes are open-ended, so this is a loose synonym map for
// common signature dishes plus an *attribute* vocabulary (활/숙성/자연산 ...)
// so a user can ask for "살아있는(활) 고등어회", not just "고등어회".
export const MENU_SYNONYMS = {
  고등어회: ["고등어회", "고등어사시미", "활고등어회", "간고등어회"],
  전어회: ["전어회", "전어무침"],
  방어회: ["방어회", "대방어"],
  광어회: ["광어회", "광어사시미"],
  물회: ["물회", "회국수"],
  뒷고기: ["뒷고기", "특수부위구이"],
  숙성회: ["숙성회", "숙성사시미", "선어회"],
  삼겹살: ["삼겹살", "생삼겹", "오겹살"],
  갈비: ["갈비", "생갈비", "우대갈비"],
  라멘: ["라멘", "돈코츠라멘", "라면"],
  파스타: ["파스타", "스파게티", "알리오올리오"]
};

// Menu attributes — qualities users care about ("살아있는" = live/활).
export const MENU_ATTR_SYNONYMS = {
  활: ["활", "살아있는", "살아 있는", "활어", "live", "자연산활"],
  숙성: ["숙성", "저온숙성", "선어"],
  자연산: ["자연산", "자연산only", "wild"],
  특대: ["특대", "대방어급", "점보"],
  국내산: ["국내산", "국산", "로컬"]
};

const MENU_INDEX = buildReverseIndexLater(MENU_SYNONYMS);
const MENU_ATTR_INDEX = buildReverseIndexLater(MENU_ATTR_SYNONYMS);

function buildReverseIndexLater(dict) {
  const index = new Map();
  for (const [canonical, synonyms] of Object.entries(dict)) {
    index.set(canonical.toLowerCase().replace(/\s+/g, ""), canonical);
    for (const syn of synonyms) index.set(syn.toLowerCase().replace(/\s+/g, ""), canonical);
  }
  return index;
}

export const normalizeMenu = (t) => normalizeWith(MENU_INDEX, t);
export const normalizeMenuAttr = (t) => normalizeWith(MENU_ATTR_INDEX, t);

function buildReverseIndex(dict) {
  const index = new Map();
  for (const [canonical, synonyms] of Object.entries(dict)) {
    index.set(canonical.toLowerCase(), canonical);
    for (const syn of synonyms) index.set(syn.toLowerCase(), canonical);
  }
  return index;
}

const TAG_INDEX = buildReverseIndex(TAG_SYNONYMS);
const STYLE_INDEX = buildReverseIndex(STYLE_SYNONYMS);
const CUISINE_INDEX = buildReverseIndex(CUISINE_SYNONYMS);

function normalizeWith(index, term) {
  if (!term) return null;
  const key = String(term).trim().toLowerCase().replace(/\s+/g, "");
  if (index.has(key)) return index.get(key);
  // Fall back to a loose contains-match so partial input still resolves.
  for (const [syn, canonical] of index.entries()) {
    if (key.includes(syn) || syn.includes(key)) return canonical;
  }
  return null;
}

export const normalizeTag = (t) => normalizeWith(TAG_INDEX, t);
export const normalizeStyle = (t) => normalizeWith(STYLE_INDEX, t);
export const normalizeCuisine = (t) => normalizeWith(CUISINE_INDEX, t);

export function normalizeList(list, normalizer) {
  if (!list) return [];
  return [...new Set((Array.isArray(list) ? list : [list]).map(normalizer).filter(Boolean))];
}
