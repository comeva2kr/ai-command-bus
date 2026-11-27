// 식품안전나라(식약처) Open API — 바코드 → 품목보고번호 → 원재료.
//
//   C005 바코드연계제품정보:  BAR_CD → PRDLST_REPORT_NO, PRDLST_NM, BSSH_NM, PRDLST_DCNM
//   C002 품목제조보고(원재료): PRDLST_REPORT_NO → RAWMTRL_NM
//
// URL 형식: http://openapi.foodsafetykorea.go.kr/api/{키}/{서비스ID}/json/{시작}/{끝}/{변수}={값}
// 키는 식품안전나라에서 무료 발급(MFDS_API_KEY). 한 키로 모든 서비스를 부른다.
//
// ⚠ 이 저장소의 개발 환경에서는 *.go.kr에 접속할 수 없어 실응답으로 검증하지
// 못했다. 필드명은 공개 문서 기준이며, 키를 넣고 처음 돌릴 때 FIELDS를 실응답과
// 대조해야 한다(docs/ansim-scan.md 검증 목록). 필드명이 다르면 여기만 고친다.
//
// 영양정보는 이 두 서비스에 없다. 식품영양성분 DB(공공데이터포털) 연동 전까지는
// 원재료만으로 평가하고 화면에 "영양정보 없음"을 표시한다.

import { inferCategory } from "./core/categories.js";

const BASE = "http://openapi.foodsafetykorea.go.kr/api";

export const FIELDS = {
  barcode: { service: "C005", param: "BAR_CD", reportNo: "PRDLST_REPORT_NO", name: "PRDLST_NM", maker: "BSSH_NM", foodType: "PRDLST_DCNM" },
  rawMaterial: { service: "C002", param: "PRDLST_REPORT_NO", ingredients: "RAWMTRL_NM" }
};

async function getRows(url, service, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res.ok) return [];
    const body = await res.json();
    // 정상: { C005: { total_count, row: [...], RESULT: { CODE: "INFO-000" } } }
    // 결과 없음: RESULT.CODE "INFO-200"
    return Array.isArray(body?.[service]?.row) ? body[service].row : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProductByBarcode(barcode, { apiKey = process.env.MFDS_API_KEY, fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const code = String(barcode || "").replace(/\D/g, "");
  if (!apiKey || !code) return null;
  const b = FIELDS.barcode;
  const rows = await getRows(`${BASE}/${encodeURIComponent(apiKey)}/${b.service}/json/1/5/${b.param}=${code}`, b.service, fetchImpl, timeoutMs);
  const row = rows[0];
  if (!row) return null;
  const reportNo = String(row[b.reportNo] || "").trim();
  let ingredientsText = "";
  if (reportNo) {
    const r = FIELDS.rawMaterial;
    const raw = await getRows(`${BASE}/${encodeURIComponent(apiKey)}/${r.service}/json/1/5/${r.param}=${encodeURIComponent(reportNo)}`, r.service, fetchImpl, timeoutMs);
    ingredientsText = String(raw[0]?.[r.ingredients] || "").trim();
  }
  const name = String(row[b.name] || "").trim();
  const foodType = String(row[b.foodType] || "").trim();
  return {
    id: `mfds-${reportNo || code}`,
    barcode: code,
    name,
    brand: String(row[b.maker] || "").trim(),
    foodType,
    category: inferCategory({ foodType, name }),
    reportNo,
    ingredientsText,
    source: "mfds"
  };
}
