// Sample dataset modeling how raw, multi-source restaurant records look before
// verification. Coordinates are approximate. `sources` mixes organic mentions
// with sponsored/ad ones so the verification layer has something to filter.
//
// The set is curated so the three worked-example queries return sensible hits:
//   A) 프랜차이즈 아닌 돼지고기(뒷고기) 고깃집 + 키즈카페
//   B) 이자카야 스타일 + 숙성회 + "싼 분위기 안 남" + 파티션
//   C) 세종 근처 차로 30분(청주·대전 포함) + 활(살아있는)고등어회

export const SEED_RESTAURANTS = [
  // --- A) 뒷고기 고깃집 + 키즈카페 (검증됨, 비프랜차이즈) ---
  {
    id: "R-101",
    name: "성수 뒷고기집 화덕",
    style: "고깃집",
    cuisines: ["돼지고기"],
    menus: [
      { name: "뒷고기", attrs: ["국내산"], signature: true },
      { name: "삼겹살", attrs: [] }
    ],
    lat: 37.5448,
    lng: 127.0557,
    address: "서울 성동구 성수동",
    district: "성동구",
    franchise: false,
    priceBand: 2,
    rating: 4.5,
    tags: ["뒷고기", "가성비", "회식"],
    features: { kidsCafe: true, kidFriendly: true, parking: true, reservable: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 210, sentiment: 0.82 },
      { platform: "youtube", type: "organic", mentions: 3, sentiment: 0.9 },
      { platform: "community", type: "organic", mentions: 12, sentiment: 0.8 },
      { platform: "instagram", type: "sponsored", mentions: 4, markers: ["#광고", "협찬"] }
    ]
  },
  // 프랜차이즈 돼지고기집 (조건 A에서 제외되어야 함)
  {
    id: "R-102",
    name: "무한리필 삼겹 프랜차이즈 성수점",
    style: "고깃집",
    cuisines: ["돼지고기"],
    menus: [{ name: "삼겹살", attrs: [] }],
    lat: 37.5461,
    lng: 127.0512,
    address: "서울 성동구 성수동",
    district: "성동구",
    franchise: true,
    priceBand: 1,
    rating: 3.9,
    tags: ["가성비", "회식"],
    features: { kidsCafe: false, kidFriendly: true, parking: false },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 88, sentiment: 0.6 },
      { platform: "naver_blog", type: "organic", mentions: 20, sentiment: 0.65 }
    ]
  },
  // 광고성 위주 → 검증 실패로 걸러져야 함
  {
    id: "R-103",
    name: "인스타 핫플 협찬 고깃집",
    style: "고깃집",
    cuisines: ["돼지고기"],
    menus: [{ name: "뒷고기", attrs: [] }],
    lat: 37.5439,
    lng: 127.0601,
    address: "서울 성동구 성수동",
    district: "성동구",
    franchise: false,
    priceBand: 3,
    rating: 4.1,
    tags: ["분위기좋은"],
    features: { kidsCafe: true, kidFriendly: true },
    sources: [
      { platform: "instagram", type: "sponsored", mentions: 40, markers: ["#광고", "협찬"] },
      { platform: "naver_blog", type: "sponsored", mentions: 15, markers: ["제공받아", "소정의"] },
      { platform: "youtube", type: "sponsored", mentions: 2, markers: ["유료광고"] }
    ]
  },

  // --- B) 이자카야 + 숙성회 + 고급스러운(싼 분위기 아님) + 파티션 ---
  {
    id: "R-201",
    name: "여의도 숙성 이자카야 소라",
    style: "이자카야",
    cuisines: ["회", "초밥"],
    menus: [
      { name: "숙성회", attrs: ["숙성", "자연산"], signature: true },
      { name: "방어회", attrs: ["숙성"] }
    ],
    lat: 37.5219,
    lng: 126.9255,
    address: "서울 영등포구 여의도동",
    district: "영등포구",
    franchise: false,
    priceBand: 4,
    rating: 4.7,
    tags: ["숙성회", "고급스러운", "분위기좋은", "조용한", "데이트"],
    features: { partition: true, privateRoom: true, reservable: true, parking: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 140, sentiment: 0.86 },
      { platform: "community", type: "organic", mentions: 22, sentiment: 0.83 },
      { platform: "youtube", type: "organic", mentions: 4, sentiment: 0.88 },
      { platform: "naver_blog", type: "sponsored", mentions: 6, markers: ["협찬"] }
    ]
  },
  // 이자카야지만 "싼 분위기" → 조건 B에서 excludeTags로 제외되어야 함
  {
    id: "R-202",
    name: "포차 감성 저렴 이자카야",
    style: "이자카야",
    cuisines: ["회"],
    menus: [{ name: "숙성회", attrs: [] }],
    lat: 37.5202,
    lng: 126.9271,
    address: "서울 영등포구 여의도동",
    district: "영등포구",
    franchise: false,
    priceBand: 1,
    rating: 4.0,
    tags: ["숙성회", "가성비", "회식"],
    features: { partition: false, reservable: false },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 95, sentiment: 0.7 },
      { platform: "community", type: "organic", mentions: 8, sentiment: 0.72 }
    ]
  },

  // --- C) 세종 근처 차로 30분(청주·대전 포함) + 활(살아있는)고등어회 ---
  {
    id: "R-301",
    name: "세종 활어 고등어 전문 물결",
    style: "횟집",
    cuisines: ["회"],
    menus: [
      { name: "고등어회", attrs: ["활", "국내산"], signature: true },
      { name: "물회", attrs: [] }
    ],
    lat: 36.49,
    lng: 127.26,
    address: "세종특별자치시 나성동",
    district: "세종",
    franchise: false,
    priceBand: 3,
    rating: 4.6,
    tags: ["숙성회", "조용한"],
    features: { partition: true, parking: true, reservable: true, kidFriendly: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 76, sentiment: 0.84 },
      { platform: "community", type: "organic", mentions: 14, sentiment: 0.8 },
      { platform: "youtube", type: "organic", mentions: 2, sentiment: 0.85 }
    ]
  },
  {
    id: "R-302",
    name: "대전 유성 활고등어 참바다",
    style: "횟집",
    cuisines: ["회"],
    menus: [
      { name: "고등어회", attrs: ["활"], signature: true },
      { name: "광어회", attrs: ["활"] }
    ],
    lat: 36.354,
    lng: 127.341,
    address: "대전 유성구",
    district: "대전",
    franchise: false,
    priceBand: 3,
    rating: 4.4,
    tags: ["가성비", "회식"],
    features: { parking: true, reservable: true, privateRoom: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 60, sentiment: 0.8 },
      { platform: "naver_blog", type: "organic", mentions: 9, sentiment: 0.78 },
      { platform: "community", type: "organic", mentions: 5, sentiment: 0.79 }
    ]
  },
  {
    id: "R-303",
    name: "청주 숙성 고등어 오션",
    style: "횟집",
    cuisines: ["회"],
    // 활이 아니라 숙성만 → menuAttrs:['활'] 요구 시 제외되어야 함
    menus: [{ name: "고등어회", attrs: ["숙성"], signature: true }],
    lat: 36.64,
    lng: 127.49,
    address: "충북 청주시 흥덕구",
    district: "청주",
    franchise: false,
    priceBand: 2,
    rating: 4.2,
    tags: ["숙성회"],
    features: { parking: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 40, sentiment: 0.77 },
      { platform: "community", type: "organic", mentions: 6, sentiment: 0.75 }
    ]
  },

  // --- 기타 다양성용 데이터 ---
  {
    id: "R-401",
    name: "강남 한우 오마카세 담",
    style: "고깃집",
    cuisines: ["소고기"],
    menus: [{ name: "갈비", attrs: ["숙성"], signature: true }],
    lat: 37.4985,
    lng: 127.0281,
    address: "서울 강남구 역삼동",
    district: "강남구",
    franchise: false,
    priceBand: 4,
    rating: 4.8,
    tags: ["고급스러운", "데이트", "조용한"],
    features: { partition: true, privateRoom: true, reservable: true, parking: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 180, sentiment: 0.9 },
      { platform: "youtube", type: "organic", mentions: 6, sentiment: 0.9 },
      { platform: "community", type: "organic", mentions: 20, sentiment: 0.85 }
    ]
  },
  {
    id: "R-402",
    name: "홍대 라멘 노포 이치",
    style: "이자카야",
    cuisines: ["면요리"],
    menus: [{ name: "라멘", attrs: ["국내산"], signature: true }],
    lat: 37.5568,
    lng: 126.925,
    address: "서울 마포구 서교동",
    district: "마포구",
    franchise: false,
    priceBand: 2,
    rating: 4.3,
    tags: ["노포", "가성비", "혼밥"],
    features: { soloFriendly: true, lateNight: true },
    sources: [
      { platform: "naver_place", type: "organic", mentions: 130, sentiment: 0.8 },
      { platform: "naver_blog", type: "organic", mentions: 25, sentiment: 0.78 }
    ]
  }
];

export default SEED_RESTAURANTS;
