// Real place-data connector — Kakao Local API (keyword search with radius).
// No fabricated data: this calls the live API and returns whatever it returns.
// Requires a Kakao REST API key in KAKAO_REST_KEY (never hardcode it).
//
// Docs: https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword
// Returns real restaurants with WGS84 coordinates, so radius/location search and
// deep links are accurate.

import { classifyByPhone } from "../nopo.js";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const FOOD = "FD6"; // Kakao category group: 음식점
const CAFE = "CE7"; // 카페

export function kakaoConfigured() {
  return Boolean(process.env.KAKAO_REST_KEY);
}

// A Naver Map deep link for the same place (users asked for Naver). Built from
// the real place name + road address so it resolves to the actual listing.
function naverLink(name, addr) {
  return "https://map.naver.com/p/search/" + encodeURIComponent(`${name} ${addr || ""}`.trim());
}

function normalize(doc) {
  return {
    id: `kakao:${doc.id}`,
    name: doc.place_name,
    category: doc.category_name, // e.g. "음식점 > 한식 > 육류,고기"
    categoryGroup: doc.category_group_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    address: doc.road_address_name || doc.address_name,
    phone: doc.phone || null,
    // 전화번호 자릿수 기반 '오래된 집(노포)' 신호 (지역번호 제외 가입자번호가 짧을수록 오래됨)
    nopo: classifyByPhone(doc.phone),
    distanceM: doc.distance ? Number(doc.distance) : null,
    kakaoUrl: doc.place_url,
    naverUrl: naverLink(doc.place_name, doc.road_address_name || doc.address_name)
  };
}

// Search real places. Pass {lat,lng,radiusM} for location/radius search
// (sorted by distance), or just {query} for a keyword/area search.
export async function searchPlaces({ query = "맛집", lat, lng, radiusM = 1500, size = 15, page = 1, cafe = false } = {}) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error("KAKAO_REST_KEY 미설정 — 카카오 REST 키가 필요합니다.");

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("category_group_code", cafe ? CAFE : FOOD);
  url.searchParams.set("size", String(Math.min(15, size)));
  url.searchParams.set("page", String(page));
  if (lat != null && lng != null) {
    url.searchParams.set("y", String(lat));
    url.searchParams.set("x", String(lng));
    url.searchParams.set("radius", String(Math.min(20000, Math.round(radiusM))));
    url.searchParams.set("sort", "distance");
  }

  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kakao API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    total: data.meta?.total_count ?? 0,
    isEnd: data.meta?.is_end ?? true,
    places: (data.documents || []).map(normalize)
  };
}

export default { searchPlaces, kakaoConfigured };
