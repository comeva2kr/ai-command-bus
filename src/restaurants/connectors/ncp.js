// NAVER Cloud Platform (NCP) Maps connector — real driving time + geocoding.
// NCP does NOT provide place search or 개업일; it complements our stack:
//   • Directions      → real "차로 N분" (traffic-aware), replacing our estimate
//   • Reverse Geocode  → coords → 시/도·시군구 (region for the 개업일 lookup)
//   • Geocode          → address → coords
// Auth: NCP_KEY_ID / NCP_KEY (console.ncloud.com application). Never hardcode.

const BASE = "https://maps.apigw.ntruss.com";

export function ncpConfigured() {
  return Boolean(process.env.NCP_KEY_ID && process.env.NCP_KEY);
}
function headers() {
  return { "x-ncp-apigw-api-key-id": process.env.NCP_KEY_ID, "x-ncp-apigw-api-key": process.env.NCP_KEY };
}
function requireKeys() {
  if (!ncpConfigured()) throw new Error("NCP_KEY_ID/NCP_KEY 미설정 — 네이버 클라우드 Maps 키가 필요합니다.");
}

// Parse a Directions response into { durationMin, distanceKm }. Pure (testable).
export function parseDriving(json, option = "trafast") {
  const s = json?.route?.[option]?.[0]?.summary;
  if (!s) return null;
  return { durationMin: Math.round(s.duration / 60000), distanceKm: Number((s.distance / 1000).toFixed(1)) };
}

// Real driving time between two WGS84 points. option: trafast|tracomfort|traoptimal.
export async function drivingTime({ startLng, startLat, goalLng, goalLat, option = "trafast" }) {
  requireKeys();
  const u = new URL(`${BASE}/map-direction/v1/driving`);
  u.searchParams.set("start", `${startLng},${startLat}`);
  u.searchParams.set("goal", `${goalLng},${goalLat}`);
  u.searchParams.set("option", option);
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) throw new Error(`NCP directions ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return parseDriving(await res.json(), option);
}

// coords → region (시/도, 시군구, 법정동코드). Useful to scope the 개업일 query.
export function parseReverseGeocode(json) {
  const r = json?.results?.[0];
  if (!r) return null;
  const region = r.region || {};
  const sido = region.area1?.name || "";
  const sigungu = region.area2?.name || "";
  const dong = region.area3?.name || "";
  return { sido, sigungu, dong, legalCode: r.code?.id || null };
}
export async function reverseGeocode({ lng, lat }) {
  requireKeys();
  const u = new URL(`${BASE}/map-reversegeocode/v2/gc`);
  u.searchParams.set("coords", `${lng},${lat}`);
  u.searchParams.set("output", "json");
  u.searchParams.set("orders", "admcode,legalcode,addr,roadaddr");
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) throw new Error(`NCP reversegeocode ${res.status}`);
  return parseReverseGeocode(await res.json());
}

// address → coords (first match).
export async function geocode(query) {
  requireKeys();
  const u = new URL(`${BASE}/map-geocode/v2/geocode`);
  u.searchParams.set("query", query);
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) throw new Error(`NCP geocode ${res.status}`);
  const j = await res.json();
  const a = j?.addresses?.[0];
  return a ? { lng: Number(a.x), lat: Number(a.y), roadAddress: a.roadAddress, jibunAddress: a.jibunAddress } : null;
}

export default { ncpConfigured, drivingTime, parseDriving, reverseGeocode, parseReverseGeocode, geocode };
