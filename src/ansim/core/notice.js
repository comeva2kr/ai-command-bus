// 온라인 상품 페이지 → 제품 정보.
//
// 국내 쇼핑몰의 가공식품 상세 페이지에는 「전자상거래 상품정보제공 고시」에
// 따른 표(필수 표기정보)가 있고, 여기에 원재료명·영양성분·알레르기가 **텍스트로**
// 들어 있다. 상세 이미지 OCR보다 훨씬 싸고 정확해서 확장 프로그램은 이 표를
// 먼저 읽는다. 표가 없거나 이미지뿐이면 라벨 사진 분석으로 넘긴다.
//
// 입력 rows: [[항목명, 값], ...] — 몰마다 마크업이 달라도 결국 키-값 쌍이다.

import { inferCategory } from "./categories.js";

const KEYS = [
  ["ingredientsText", /원재료/],
  ["nutritionText", /영양\s*(성분|정보)/],
  ["allergenText", /알레르기|알러지/],
  ["foodType", /식품\s*의?\s*유형|제품\s*유형/],
  ["name", /^(제품명|품명|상품명)$/],
  ["size", /내용량|중량|용량/]
];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// "원재료명 : 돼지고기, 정제수" 같은 줄글에서도 키-값을 뽑는다.
export function rowsFromText(text) {
  const rows = [];
  for (const line of String(text || "").split(/\n+/)) {
    const m = line.match(/^\s*([^:：\t]{2,20}?)\s*[:：\t]\s*(.+)$/);
    if (m) rows.push([m[1], m[2]]);
  }
  return rows;
}

// 쇼핑몰 탭 제목 꼬리 제거: "꼬마 소시지 - 쿠팡!" → "꼬마 소시지"
export function cleanTitle(title = "") {
  return clean(String(title).split(/\s[-|:]\s|\s?\|\s?/)[0]).slice(0, 120);
}

export function noticeToProduct({ title = "", rows = [], url = "" } = {}) {
  const out = { name: "", foodType: "", ingredientsText: "", nutritionText: "", allergenText: "", size: "" };
  for (const [k, v] of rows) {
    const key = clean(k);
    const value = clean(v);
    if (!key || !value) continue;
    const hit = KEYS.find(([, re]) => re.test(key));
    if (!hit) continue;
    const field = hit[0];
    // 같은 항목이 여러 번 나오면(묶음 상품) 이어 붙인다 — 알레르기를 놓치지 않게
    out[field] = out[field] && out[field] !== value ? `${out[field]}, ${value}` : value;
  }
  // "상세페이지 참조" 같은 값은 정보가 아니다
  for (const f of ["ingredientsText", "nutritionText", "allergenText"]) {
    if (/상세\s*(페이지|설명|이미지)?\s*(참조|참고)|별도\s*표기|해당\s*없음/.test(out[f]) && out[f].length < 30) out[f] = "";
  }
  const name = out.name || cleanTitle(title);
  return {
    name,
    foodType: out.foodType,
    category: inferCategory({ foodType: out.foodType, name }),
    ingredientsText: out.ingredientsText,
    nutritionText: out.nutritionText,
    allergenText: out.allergenText,
    url,
    source: "notice"
  };
}

// ── 몰 상품 식별 키
// 한 번 원재료를 읽은 상품은 기억해 두고, 다음엔 상품명·URL만으로 바로 점수를 낸다.
// 모바일 쇼핑몰 앱은 '필수 표기정보'가 접혀 있어 매번 펼치게 할 수 없기 때문이다.
//   1순위: URL 속 몰 상품번호 (쿠팡 /vp/products/123 등) — 정확
//   2순위: 정규화한 상품명 — 앱(URL을 모름)에서도 찾을 수 있게
const PRODUCT_ID = [
  /\/v[pm]\/products\/(\d+)/,          // 쿠팡 PC·모바일웹
  /\/products\/(\d+)/,                  // 네이버 스마트스토어·브랜드스토어, 11번가
  /\/goods\/(\d+)/,                     // 컬리
  /[?&]itemId=(\d+)/                     // SSG
];

export function normalizeTitle(title = "") {
  return String(title).toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")     // [무료배송] (1+1) 같은 꼬리표
    .replace(/[^0-9a-z가-힣]+/g, "")
    .slice(0, 80);
}

export function listingKeys({ url = "", title = "", mall = null } = {}) {
  const keys = [];
  if (mall && url) {
    const id = PRODUCT_ID.map((re) => String(url).match(re)?.[1]).find(Boolean);
    if (id) keys.push(`${mall}:id:${id}`);
  }
  const t = normalizeTitle(title);
  if (t.length >= 4) keys.push(`title:${t}`);   // 몰과 무관 — 같은 상품명은 어느 몰에서든 같은 원재료
  return keys;
}
