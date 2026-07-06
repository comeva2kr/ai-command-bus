// Sample dataset with REVIEW-LEVEL signals so the 찐맛집 authenticity engine has
// real material to work with. `makeReviews` deterministically expands a compact
// spec into individual reviews (author, timestamp, rating, paid?, local?,
// repeat?, specificity) — no randomness, so scores are reproducible.
//
// The set deliberately includes fakes that PASS the attribute filters but must
// be rejected by the authenticity engine (e.g. an astroturfed 뒷고기+키즈카페
// 고깃집), proving the algorithm — not just tag matching — is what gates results.

// Expand a compact spec into review records.
//   platforms: cycled across reviews
//   count:     number of organic-ish reviews to generate
//   authors:   distinct author pool size (small => concentration/astroturf)
//   spanDays:  oldest review age; dates spread evenly down to ~recent
//   paid:      first N reviews flagged as sponsored
//   localRatio/repeatRatio: fraction marked local / repeat-visit
//   ratings:   rating pattern, cycled
//   specificity: base text-detail level
function makeReviews({
  platforms,
  count,
  authors,
  spanDays,
  paid = 0,
  localRatio = 0.5,
  repeatRatio = 0.4,
  ratings = [5, 4, 5, 4, 5, 3, 5, 4, 5, 5],
  specificity = 0.7,
  ring = null // { ids:[...shared global "ring_*" ids], count:N } → first N reviews
  // are a time-locked lockstep cluster by shared accounts co-reviewing venues
}) {
  const reviews = [];
  const localN = Math.round(count * localRatio);
  const repeatN = Math.round(count * repeatRatio);
  for (let i = 0; i < count; i++) {
    const isRing = ring && i < ring.count;
    const author = isRing ? ring.ids[i % ring.ids.length] : `u${i % authors}`;
    // Ring reviews cluster in a tight recent window so they lockstep across
    // venues; genuine reviews spread evenly across the venue's history.
    const daysAgo = isRing
      ? 6 + ((i % ring.ids.length) * 3)
      : count > 1 ? Math.round((spanDays * (count - 1 - i)) / (count - 1)) : 0;
    reviews.push({
      platform: platforms[i % platforms.length],
      author,
      daysAgo,
      rating: ratings[i % ratings.length],
      paid: i < paid,
      markers: i < paid ? ["협찬", "#광고"] : [],
      local: !isRing && i % count < localN,
      repeat: !isRing && i % count < repeatN,
      specificity: Math.max(0.1, Math.min(1, specificity + (((i % 3) - 1) * 0.05)))
    });
  }
  return reviews;
}

// Namespace genuine (venue-local) author ids by venue so honest reviewers never
// look like the same person across venues; shared "ring_*" ids are left intact
// so the corpus ring detector can catch cross-venue lockstep collusion.
function namespaceAuthors(restaurants) {
  for (const r of restaurants) {
    for (const rev of r.reviews ?? []) {
      if (!String(rev.author).startsWith("ring_")) rev.author = `${r.id}_${rev.author}`;
    }
  }
  return restaurants;
}

const RING = ["ring_s1", "ring_s2", "ring_s3"]; // shared shill accounts

// Realistic multi-source platform mixes spanning several trust classes.
const FOUR = ["naver_map", "naver_blog", "youtube", "community"]; // map+social+community
const WIDE = ["naver_map", "daum_map", "catchtable", "naver_blog", "youtube", "community"];
const SHORTS_ONLY = ["tiktok", "youtube_shorts", "instagram_reels", "instagram"]; // 숏폼+social

export const SEED_RESTAURANTS = namespaceAuthors([
  // === A) 뒷고기 고깃집 + 키즈카페 ===
  // R-101: 진짜 동네 맛집 — 다플랫폼·다작성자·장기간·로컬/재방문·솔직 리뷰 → 찐맛집
  {
    id: "R-101",
    name: "성수 뒷고기집 화덕",
    style: "고깃집",
    cuisines: ["돼지고기"],
    menus: [{ name: "뒷고기", attrs: ["국내산"], signature: true }, { name: "삼겹살", attrs: [] }],
    lat: 37.5448, lng: 127.0557, address: "서울 성동구 성수동", district: "성동구",
    franchise: false, priceBand: 2, rating: 4.5,
    tags: ["뒷고기", "가성비", "회식"],
    features: { kidsCafe: true, kidFriendly: true, parking: true, reservable: true },
    behavior: { revisitRate: 0.42, reservationsPerWeek: 46, avgWaitMin: 25, saves: 1800 },
    reviews: makeReviews({
      platforms: WIDE, count: 26, authors: 26, spanDays: 700, paid: 2,
      localRatio: 0.6, repeatRatio: 0.5, specificity: 0.82,
      ratings: [5, 4, 5, 5, 4, 3, 5, 4, 5, 4]
    })
  },
  // R-102: 프랜차이즈(비교적 검증되나 excludeFranchise로 걸러짐)
  {
    id: "R-102",
    name: "무한리필 삼겹 프랜차이즈 성수점",
    style: "고깃집", cuisines: ["돼지고기"], menus: [{ name: "삼겹살", attrs: [] }],
    lat: 37.5461, lng: 127.0512, address: "서울 성동구 성수동", district: "성동구",
    franchise: true, priceBand: 1, rating: 3.9, tags: ["가성비", "회식"],
    features: { kidsCafe: false, kidFriendly: true },
    reviews: makeReviews({
      platforms: ["naver_place", "naver_blog"], count: 14, authors: 12, spanDays: 320,
      paid: 1, localRatio: 0.4, repeatRatio: 0.25, specificity: 0.6,
      ratings: [4, 4, 3, 4, 5, 4, 3, 4]
    })
  },
  // R-103: 협찬 도배 광고집 → 광고의심(veto)
  {
    id: "R-103",
    name: "인스타 핫플 협찬 고깃집",
    style: "고깃집", cuisines: ["돼지고기"], menus: [{ name: "뒷고기", attrs: [] }],
    lat: 37.5439, lng: 127.0601, address: "서울 성동구 성수동", district: "성동구",
    franchise: false, priceBand: 3, rating: 4.1, tags: ["분위기좋은"],
    features: { kidsCafe: true, kidFriendly: true },
    reviews: makeReviews({
      platforms: ["instagram", "naver_blog", "youtube"], count: 20, authors: 6, spanDays: 45,
      paid: 14, localRatio: 0.1, repeatRatio: 0.05, specificity: 0.3,
      ratings: [5, 5, 5, 5, 5]
    })
  },
  // R-104: 속성 어뷰징 신상 — 속성은 조건 A와 완벽 일치(비프랜차이즈·뒷고기·키즈카페)하나
  // 소수 계정이 2주간 별5 도배 → 어뷰징의심(veto). "속성만 맞는 가짜"를 걸러내는 증거.
  {
    id: "R-104",
    name: "오픈발 신상 뒷고기 고깃집",
    style: "고깃집", cuisines: ["돼지고기"], menus: [{ name: "뒷고기", attrs: [] }],
    lat: 37.5452, lng: 127.0533, address: "서울 성동구 성수동", district: "성동구",
    franchise: false, priceBand: 2, rating: 4.9, tags: ["뒷고기", "분위기좋은"],
    features: { kidsCafe: true, kidFriendly: true, parking: true },
    reviews: makeReviews({
      platforms: ["instagram", "naver_map"], count: 18, authors: 3, spanDays: 16,
      paid: 0, localRatio: 0.05, repeatRatio: 0.0, specificity: 0.35,
      ratings: [5, 5, 5, 5, 5], ring: { ids: RING, count: 18 }
    })
  },
  // R-106: 담합 리뷰 — 겉보기엔 작성자 17명(다양)·다플랫폼으로 깨끗해 보이지만,
  // 같은 셀 3계정(ring_s1/2/3)이 R-104와 여러 업소를 락스텝으로 함께 리뷰.
  // 위장(camouflage)에도 코퍼스 리뷰링 탐지가 잡아냄 (FRAUDAR/CopyCatch 원리).
  {
    id: "R-106",
    name: "담합 리뷰 뒷고기 고깃집",
    style: "고깃집", cuisines: ["돼지고기"], menus: [{ name: "뒷고기", attrs: [] }],
    lat: 37.5446, lng: 127.0571, address: "서울 성동구 성수동", district: "성동구",
    franchise: false, priceBand: 2, rating: 4.5, tags: ["뒷고기", "회식"],
    features: { kidsCafe: true, kidFriendly: true, parking: true },
    behavior: { revisitRate: 0.12, reservationsPerWeek: 8, avgWaitMin: 3, saves: 350 },
    reviews: makeReviews({
      platforms: WIDE, count: 22, authors: 14, spanDays: 200,
      localRatio: 0.5, repeatRatio: 0.35, specificity: 0.6,
      ratings: [5, 4, 5, 4, 5, 3, 5, 4], ring: { ids: RING, count: 8 }
    })
  },
  // R-105: 숏폼 바이럴 거품 — 틱톡/쇼츠/릴스에서 폭발적으로 퍼졌지만 지도·앱·커뮤니티
  // 확증도 없고 재방문/예약 등 실제 행동 데이터도 빈약 → 바이럴거품(veto).
  // "말은 많은데 실제로 가는 사람은 없는" 전형적 가짜를 잡는 케이스.
  {
    id: "R-105",
    name: "쇼츠 바이럴 무지개 파스타",
    style: "양식", cuisines: ["면요리"], menus: [{ name: "파스타", attrs: [] }],
    lat: 37.5262, lng: 126.9276, address: "서울 영등포구 여의도동", district: "영등포구",
    franchise: false, priceBand: 3, rating: 4.6, tags: ["분위기좋은", "데이트"],
    features: { reservable: true },
    behavior: { revisitRate: 0.06, reservationsPerWeek: 4, avgWaitMin: 0, saves: 300 },
    reviews: makeReviews({
      platforms: SHORTS_ONLY, count: 40, authors: 34, spanDays: 60, paid: 3,
      localRatio: 0.1, repeatRatio: 0.05, specificity: 0.4,
      ratings: [5, 5, 4, 5, 5, 5, 4, 5]
    })
  },

  // === B) 이자카야 + 숙성회 ===
  // R-201: 진짜 숙성 이자카야 → 찐맛집
  {
    id: "R-201",
    name: "여의도 숙성 이자카야 소라",
    style: "이자카야", cuisines: ["회", "초밥"],
    menus: [{ name: "숙성회", attrs: ["숙성", "자연산"], signature: true }, { name: "방어회", attrs: ["숙성"] }],
    lat: 37.5219, lng: 126.9255, address: "서울 영등포구 여의도동", district: "영등포구",
    franchise: false, priceBand: 4, rating: 4.7,
    tags: ["숙성회", "고급스러운", "분위기좋은", "조용한", "데이트"],
    features: { partition: true, privateRoom: true, reservable: true, parking: true },
    behavior: { revisitRate: 0.4, reservationsPerWeek: 52, avgWaitMin: 18, saves: 2100 },
    reviews: makeReviews({
      platforms: WIDE, count: 24, authors: 24, spanDays: 620, paid: 2,
      localRatio: 0.5, repeatRatio: 0.45, specificity: 0.85,
      ratings: [5, 5, 4, 5, 4, 5, 3, 5, 5, 4]
    })
  },
  // R-202: 저렴한 포차 감성(가성비 태그) → excludeTags로 제외
  {
    id: "R-202",
    name: "포차 감성 저렴 이자카야",
    style: "이자카야", cuisines: ["회"], menus: [{ name: "숙성회", attrs: [] }],
    lat: 37.5202, lng: 126.9271, address: "서울 영등포구 여의도동", district: "영등포구",
    franchise: false, priceBand: 1, rating: 4.0, tags: ["숙성회", "가성비", "회식"],
    features: { partition: false, reservable: false },
    reviews: makeReviews({
      platforms: ["naver_place", "community"], count: 12, authors: 11, spanDays: 260,
      localRatio: 0.55, repeatRatio: 0.4, specificity: 0.62,
      ratings: [4, 5, 4, 3, 4, 5, 4]
    })
  },

  // === C) 세종 인근 활고등어회 ===
  // R-301: 세종 활고등어 진짜배기 → 찐맛집
  {
    id: "R-301",
    name: "세종 활어 고등어 전문 물결",
    style: "횟집", cuisines: ["회"],
    menus: [{ name: "고등어회", attrs: ["활", "국내산"], signature: true }, { name: "물회", attrs: [] }],
    lat: 36.49, lng: 127.26, address: "세종특별자치시 나성동", district: "세종",
    franchise: false, priceBand: 3, rating: 4.6, tags: ["숙성회", "조용한"],
    features: { partition: true, parking: true, reservable: true, kidFriendly: true },
    behavior: { revisitRate: 0.38, reservationsPerWeek: 30, avgWaitMin: 15, saves: 900 },
    reviews: makeReviews({
      platforms: ["naver_map", "daum_map", "community", "youtube"], count: 16, authors: 16, spanDays: 500,
      paid: 0, localRatio: 0.7, repeatRatio: 0.4, specificity: 0.8,
      ratings: [5, 4, 5, 5, 4, 3, 5, 4]
    })
  },
  // R-302: 대전 유성 활고등어 → 검증됨
  {
    id: "R-302",
    name: "대전 유성 활고등어 참바다",
    style: "횟집", cuisines: ["회"],
    menus: [{ name: "고등어회", attrs: ["활"], signature: true }, { name: "광어회", attrs: ["활"] }],
    lat: 36.354, lng: 127.341, address: "대전 유성구", district: "대전",
    franchise: false, priceBand: 3, rating: 4.4, tags: ["가성비", "회식"],
    features: { parking: true, reservable: true, privateRoom: true },
    behavior: { revisitRate: 0.34, reservationsPerWeek: 22, avgWaitMin: 10, saves: 620 },
    reviews: makeReviews({
      platforms: ["naver_map", "naver_blog", "community", "catchtable"], count: 14, authors: 13, spanDays: 430,
      paid: 1, localRatio: 0.6, repeatRatio: 0.35, specificity: 0.72,
      ratings: [5, 4, 4, 5, 3, 4, 5]
    })
  },
  // R-303: 청주 — 고등어회지만 '활' 아님(숙성) → 메뉴특성 필터로 제외
  {
    id: "R-303",
    name: "청주 숙성 고등어 오션",
    style: "횟집", cuisines: ["회"], menus: [{ name: "고등어회", attrs: ["숙성"], signature: true }],
    lat: 36.64, lng: 127.49, address: "충북 청주시 흥덕구", district: "청주",
    franchise: false, priceBand: 2, rating: 4.2, tags: ["숙성회"],
    features: { parking: true },
    reviews: makeReviews({
      platforms: ["naver_place", "community"], count: 10, authors: 9, spanDays: 300,
      paid: 1, localRatio: 0.5, repeatRatio: 0.3, specificity: 0.65,
      ratings: [4, 5, 4, 3, 4, 5]
    })
  },

  // === 다양성용 ===
  {
    id: "R-401",
    name: "강남 한우 오마카세 담",
    style: "고깃집", cuisines: ["소고기"], menus: [{ name: "갈비", attrs: ["숙성"], signature: true }],
    lat: 37.4985, lng: 127.0281, address: "서울 강남구 역삼동", district: "강남구",
    franchise: false, priceBand: 4, rating: 4.8, tags: ["고급스러운", "데이트", "조용한"],
    features: { partition: true, privateRoom: true, reservable: true, parking: true },
    behavior: { revisitRate: 0.36, reservationsPerWeek: 60, avgWaitMin: 30, saves: 2400 },
    reviews: makeReviews({
      platforms: WIDE, count: 22, authors: 22, spanDays: 600, paid: 2,
      localRatio: 0.4, repeatRatio: 0.5, specificity: 0.86,
      ratings: [5, 5, 4, 5, 5, 4, 3, 5]
    })
  },
  {
    id: "R-402",
    name: "홍대 라멘 노포 이치",
    style: "이자카야", cuisines: ["면요리"], menus: [{ name: "라멘", attrs: ["국내산"], signature: true }],
    lat: 37.5568, lng: 126.925, address: "서울 마포구 서교동", district: "마포구",
    franchise: false, priceBand: 2, rating: 4.3, tags: ["노포", "가성비", "혼밥"],
    features: { soloFriendly: true, lateNight: true },
    behavior: { revisitRate: 0.55, reservationsPerWeek: 12, avgWaitMin: 20, saves: 1400 },
    reviews: makeReviews({
      platforms: ["naver_map", "naver_blog", "community", "diningcode"], count: 26, authors: 24, spanDays: 900,
      localRatio: 0.65, repeatRatio: 0.6, specificity: 0.7,
      ratings: [5, 4, 5, 4, 4, 3, 5, 4]
    })
  }
]);

export default SEED_RESTAURANTS;
