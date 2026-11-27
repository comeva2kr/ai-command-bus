// 알레르기 유발물질 — 식약처 「식품 등의 표시기준」 표시 대상.
//
// 점수와 별개로 **아이 프로필에 등록된 알레르기는 무조건 "섭취 금지"**다.
// 아무리 깨끗한 제품이어도 우유 알레르기 아이에게 우유가 든 제품은 0점과 같다.
//
// ── 매칭 원칙: 놓치는 것보다 과하게 잡는 쪽이 낫다
// 알레르기는 한 번 놓치면 응급실이다. 애매하면 잡고, 화면에서 "원재료 확인"을
// 권한다. 다만 명백한 오탐은 막는다:
//   - "메밀"의 "밀", "밀크"의 "밀"은 밀(소맥)이 아니다
//   - "땅콩버터", "코코아버터"의 "버터"는 우유가 아니다
//   - "땅콩", "완두콩", "강낭콩", "병아리콩"의 "콩"은 대두가 아니다
//   - "굴비"의 "굴"은 조개류가 아니다
//
// 이 모듈은 브라우저(PWA·확장)와 서버가 같이 쓴다 — node 전용 import 금지.

export const ALLERGENS = [
  { id: "egg", label: "알류(달걀)", pattern: /달걀|계란|난백|난황|전란|난류|알류|메추리알|마요네즈/ },
  { id: "milk", label: "우유", pattern: /우유|유청|유당|분유|카제인|카세인|(?<!땅콩|코코아|카카오|시어|쉐어)버터|치즈|(?<!식물성)크림|연유|요구르트|요거트|발효유|유단백|원유|락토스|락토오스/ },
  { id: "buckwheat", label: "메밀", pattern: /메밀/ },
  { id: "peanut", label: "땅콩", pattern: /땅콩|피넛|낙화생/ },
  { id: "soy", label: "대두", pattern: /대두|(?<![땅녹팥두낭리])콩(?!나물)|두유|두부|간장|된장|춘장|청국장/ },
  { id: "wheat", label: "밀", pattern: /(?<![메아])밀(?!크|감|납|폐)|소맥|글루텐/ },
  { id: "mackerel", label: "고등어", pattern: /고등어/ },
  { id: "crab", label: "게", pattern: /^게|꽃게|대게|홍게|털게|게살|게장|크랩/ },
  { id: "shrimp", label: "새우", pattern: /새우|쉬림프|크릴/ },
  { id: "pork", label: "돼지고기", pattern: /돼지|돈육|돈지|돈골|라드|베이컨|포크/ },
  { id: "peach", label: "복숭아", pattern: /복숭아|피치/ },
  { id: "tomato", label: "토마토", pattern: /토마토|케첩|케찹/ },
  { id: "sulfite", label: "아황산류", pattern: /아황산|이산화황/ },
  { id: "walnut", label: "호두", pattern: /호두|호도|월넛/ },
  { id: "chicken", label: "닭고기", pattern: /닭|계육|치킨/ },
  { id: "beef", label: "쇠고기", pattern: /쇠고기|소고기|우육|우지|비프|사골|한우/ },
  { id: "squid", label: "오징어", pattern: /오징어/ },
  { id: "shellfish", label: "조개류(굴·전복·홍합 포함)", pattern: /조개|조갯|굴(?!비)|전복|홍합|바지락|가리비|재첩|키조개/ },
  { id: "pinenut", label: "잣", pattern: /잣/ }
];

export const ALLERGEN_IDS = ALLERGENS.map((a) => a.id);

const BY_ID = new Map(ALLERGENS.map((a) => [a.id, a]));
export const allergenLabel = (id) => BY_ID.get(id)?.label || id;

// 토큰 목록(원재료명 하나하나)에서 알레르기 유발물질을 찾는다.
// 토큰 단위로 보는 이유: "^게" 같은 짧은 패턴을 문장 전체에 돌리면
// "…에게" 같은 조사에 걸린다.
export function detectAllergens(tokens) {
  const found = new Set();
  for (const raw of tokens) {
    const t = String(raw).replace(/\s+/g, "");
    if (!t) continue;
    for (const a of ALLERGENS) if (a.pattern.test(t)) found.add(a.id);
  }
  return ALLERGEN_IDS.filter((id) => found.has(id));
}
