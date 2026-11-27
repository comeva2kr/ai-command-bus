// 제품 분류 — 대체품을 "같은 종류" 안에서만 찾기 위해 필요하다.
// 소시지를 찍었는데 대체품으로 보리차를 보여주면 쓸모가 없다.
//
// snack: 식약처 고열량·저영양 기준(간식용)을 적용하는 분류인지
// processedMeat: 가공육 감점을 적용하는 분류인지

export const CATEGORIES = [
  { id: "processed-meat", label: "햄·소시지·베이컨", processedMeat: true, snack: false,
    pattern: /소시지|소세지|(?<!치즈|버거)햄(?!버거)|베이컨|비엔나|프랑크|후랑크|살라미|육가공|식육가공|어육소시지|어육가공|미트볼|너겟|떡갈비/ },
  { id: "drink", label: "음료", snack: true,
    pattern: /음료|주스|쥬스|에이드|탄산|사이다|콜라|스포츠|이온|과채|보리차|차음료|워터/ },
  { id: "dairy", label: "우유·요구르트", snack: true,
    pattern: /가공유|발효유|요구르트|요거트|우유|치즈/ },
  { id: "ice-cream", label: "아이스크림", snack: true,
    pattern: /아이스크림|빙과|빙수|샤베트|셔벗|아이스바/ },
  { id: "snack", label: "과자·스낵", snack: true,
    pattern: /과자|스낵|칩|쿠키|비스킷|비스켓|크래커|팝콘|뻥튀기/ },
  { id: "candy", label: "사탕·젤리·초콜릿", snack: true,
    pattern: /캔디|사탕|젤리|구미|초콜릿|초코|캐러멜|껌|마시멜로/ },
  { id: "bakery", label: "빵", snack: true,
    pattern: /빵|케이크|머핀|도넛|베이커리|와플/ },
  { id: "cereal", label: "시리얼", snack: false,
    pattern: /시리얼|그래놀라|콘플레이크/ },
  { id: "sauce", label: "소스·드레싱", snack: false,
    pattern: /소스|드레싱|케첩|케찹|마요네즈/ },
  { id: "noodle", label: "면·즉석식품", snack: false,
    pattern: /라면|면류|국수|즉석|컵밥|레토르트/ }
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryById = (id) => BY_ID.get(id) || null;

// 식품유형(가장 믿을 만함) → 제품명 순으로 본다.
export function inferCategory({ foodType = "", name = "" } = {}) {
  for (const text of [foodType, name]) {
    const t = String(text || "").replace(/\s+/g, "");
    if (!t) continue;
    const hit = CATEGORIES.find((c) => c.pattern.test(t));
    if (hit) return hit.id;
  }
  return null;
}
