// 쇼핑몰 — "지금 보고 있는 몰 안에서 바로 사기".
//
// 대체품 링크는 사용자가 지금 쓰는 몰을 맨 앞에 둔다. 쿠팡에서 보고 있는데
// 대체품을 누르면 네이버로 튀는 건 구매 흐름을 끊는다.
//
// 링크 종류:
//   direct: 그 몰의 실제 상품 상세 URL을 알고 있을 때 (product.offers[mall])
//   search: 모르면 그 몰의 검색 결과로 보낸다 — 상품을 지어내지 않는다
//
// 제휴(쿠팡파트너스 등) 링크로 바꾸려면 product.offers에 제휴 URL을 넣고
// affiliate: true를 표시한다. 화면은 그때 공정위 추천·보증 심사지침에 따른
// "수수료를 받을 수 있음" 문구를 반드시 보여준다. 점수는 제휴 여부와 무관하다.

const enc = encodeURIComponent;

export const MALLS = [
  { id: "coupang", label: "쿠팡", hosts: /(^|\.)coupang\.com$/, search: (q) => `https://www.coupang.com/np/search?q=${enc(q)}` },
  { id: "naver", label: "네이버쇼핑", hosts: /(^|\.)(smartstore|brand|shopping|search\.shopping)\.naver\.com$/, search: (q) => `https://search.shopping.naver.com/search/all?query=${enc(q)}` },
  { id: "kurly", label: "컬리", hosts: /(^|\.)kurly\.com$/, search: (q) => `https://www.kurly.com/search?sword=${enc(q)}` },
  { id: "ssg", label: "SSG", hosts: /(^|\.)ssg\.com$/, search: (q) => `https://www.ssg.com/search.ssg?query=${enc(q)}` },
  { id: "11st", label: "11번가", hosts: /(^|\.)11st\.co\.kr$/, search: (q) => `https://search.11st.co.kr/Search.tmall?kwd=${enc(q)}` }
];

const BY_ID = new Map(MALLS.map((m) => [m.id, m]));
export const MALL_IDS = MALLS.map((m) => m.id);
export const mallById = (id) => BY_ID.get(id) || null;

export function detectMall(hostname = "") {
  const h = String(hostname).toLowerCase();
  return MALLS.find((m) => m.hosts.test(h))?.id || null;
}

// preferred 몰을 맨 앞에. 상세 URL이 있으면 direct, 없으면 검색.
export function buyLinks(product, preferred = null, { limit = 3 } = {}) {
  const query = [product.brand, product.name].filter(Boolean).join(" ");
  const order = [preferred, ...MALL_IDS].filter((id, i, a) => id && BY_ID.has(id) && a.indexOf(id) === i);
  return order.slice(0, limit).map((id) => {
    const mall = BY_ID.get(id);
    const offer = product.offers?.[id];
    return offer?.url
      ? { mall: id, label: mall.label, url: offer.url, kind: "direct", affiliate: Boolean(offer.affiliate) }
      : { mall: id, label: mall.label, url: mall.search(query), kind: "search", affiliate: false };
  });
}
