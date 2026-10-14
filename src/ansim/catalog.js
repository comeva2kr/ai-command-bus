// 제품 카탈로그 — 바코드로 찾고, 대체품 후보를 내준다.
//
// 지금은 가상의 예시 데이터(sample-catalog.json)만 있다. 실서비스에서는
//   1) 식약처 데이터로 바코드 → 원재료를 채우고 (mfds.js)
//   2) 사용자가 스캔·라벨 촬영으로 확인한 제품이 쌓이고
//   3) 운영자가 분류별 '추천 후보'를 검수해 넣는다
// 이 모듈의 인터페이스(byBarcode, candidates, remember)는 그대로 두고 저장소만
// 바꾸면 된다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE_CATALOG_PATH = path.join(here, "data", "sample-catalog.json");

export function loadSampleProducts(file = SAMPLE_CATALOG_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8")).products;
}

export function createCatalog(products = loadSampleProducts()) {
  const byCode = new Map();
  const list = [];
  const remember = (p) => {
    if (!p) return p;
    const existing = p.barcode && byCode.get(p.barcode);
    if (existing) Object.assign(existing, p);
    else {
      list.push(p);
      if (p.barcode) byCode.set(p.barcode, p);
    }
    return existing || p;
  };
  for (const p of products) remember(p);
  return {
    byBarcode: (code) => byCode.get(String(code || "").trim()) || null,
    // 대체품 후보 — 분류가 같고 원재료를 아는 제품만 (모르는 제품은 점수를 매길 수 없다)
    candidates: (category) => list.filter((p) => p.ingredientsText && (!category || p.category === category)),
    all: () => list.slice(),
    remember
  };
}
