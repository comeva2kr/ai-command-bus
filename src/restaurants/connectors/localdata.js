// Official founding-date connector — 행정안전부 지방행정 인허가데이터 (localdata.go.kr).
// The field `apvPermYmd` (인허가일자, YYYYMMDD) is the authoritative, nationwide
// open date for every licensed restaurant — the exact, unfakeable 노포 signal.
// No name search exists: you query by region (localCode) + date, then match a
// place locally by road address + name. Requires LOCALDATA_KEY (never hardcode).
//
// Spec verified via production repos + the official field-mapping table.
// Endpoint:   http://www.localdata.go.kr/platform/rest/TO0/openDataApi
// opnSvcId:   07_24_04_P (일반음식점), 07_24_05_P (휴게음식점)

const ENDPOINT = "http://www.localdata.go.kr/platform/rest/TO0/openDataApi";
export const FOOD = "07_24_04_P";
export const CAFE = "07_24_05_P";

export function localdataConfigured() {
  return Boolean(process.env.LOCALDATA_KEY);
}

// apvPermYmd "YYYYMMDD" -> founding year (number) or null.
export function foundingYearFromApv(ymd) {
  if (!ymd) return null;
  const d = String(ymd).replace(/\D/g, "");
  if (d.length < 4) return null;
  const y = Number(d.slice(0, 4));
  return y >= 1900 && y <= 2100 ? y : null;
}

function normalizeRow(r) {
  return {
    name: r.bplcNm || "",
    roadAddress: r.rdnWhlAddr || "",
    landAddress: r.siteWhlAddr || "",
    uptae: r.uptaeNm || "",
    state: r.trdStateNm || "", // 영업/정상, 폐업 …
    apvPermYmd: r.apvPermYmd || "",
    foundingYear: foundingYearFromApv(r.apvPermYmd)
  };
}

// Query licensed restaurants by region + license-date range (for 노포 backfill)
// or by last-modified range (for deltas). Returns normalized rows.
export async function queryLicenses({
  localCode, bgnYmd, endYmd, lastModTsBgn, lastModTsEnd,
  opnSvcId = FOOD, pageIndex = 1, pageSize = 500
} = {}) {
  const key = process.env.LOCALDATA_KEY;
  if (!key) throw new Error("LOCALDATA_KEY 미설정 — 지방행정 인허가데이터 authKey가 필요합니다.");

  const u = new URL(ENDPOINT);
  u.searchParams.set("authKey", key);
  u.searchParams.set("opnSvcId", opnSvcId);
  if (localCode) u.searchParams.set("localCode", localCode);
  if (bgnYmd) u.searchParams.set("bgnYmd", bgnYmd);
  if (endYmd) u.searchParams.set("endYmd", endYmd);
  if (lastModTsBgn) u.searchParams.set("lastModTsBgn", lastModTsBgn);
  if (lastModTsEnd) u.searchParams.set("lastModTsEnd", lastModTsEnd);
  u.searchParams.set("pageIndex", String(pageIndex));
  u.searchParams.set("pageSize", String(pageSize));
  u.searchParams.set("resultType", "json");

  const res = await fetch(u);
  if (!res.ok) throw new Error(`localdata ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = await res.json();
  const rows = j?.result?.body?.rows?.[0]?.row || [];
  return {
    total: Number(j?.result?.header?.paging?.totalCount ?? rows.length),
    rows: rows.map(normalizeRow)
  };
}

export default { queryLicenses, foundingYearFromApv, localdataConfigured, FOOD, CAFE };
