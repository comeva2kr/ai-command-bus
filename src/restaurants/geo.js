// Geospatial helpers: distance, travel-time, and named-landmark resolution.
//
// Everything is dependency-free so the platform runs with plain Node.

const EARTH_RADIUS_KM = 6371;

// Rough average urban travel speeds (km/h) used to translate a "N minutes"
// travel budget into a search radius, and to estimate per-restaurant travel
// time. These are deliberate, conservative city-traffic numbers.
// Blended effective speeds (km/h) after the detour factor. `car` is a mix of
// dense-urban crawl and arterial/expressway running so a single knob covers
// both a short "차로 10분" city hop and a longer "차로 30분" regional trip.
// A production deployment would swap these for a routing/ETA API.
export const TRAVEL_SPEEDS_KMH = {
  walk: 4.5,
  bike: 14,
  car: 40,
  transit: 22
};

// A small set of well-known Seoul landmarks so "near X" searches work without
// an external geocoder. Extend freely.
export const LANDMARKS = {
  강남역: { lat: 37.4979, lng: 127.0276 },
  홍대입구역: { lat: 37.5571, lng: 126.9245 },
  성수역: { lat: 37.5446, lng: 127.0559 },
  이태원: { lat: 37.5345, lng: 126.9946 },
  여의도: { lat: 37.5216, lng: 126.9243 },
  잠실역: { lat: 37.5133, lng: 127.1001 },
  판교역: { lat: 37.3949, lng: 127.1112 },
  서울역: { lat: 37.5547, lng: 126.9707 },
  광화문: { lat: 37.5759, lng: 126.9769 },
  건대입구역: { lat: 37.5405, lng: 127.0703 },
  // 충청권 — 광역 이동시간("차로 30분") 검색용
  세종: { lat: 36.4801, lng: 127.289 },
  세종시청: { lat: 36.4801, lng: 127.289 },
  대전: { lat: 36.332, lng: 127.4342 },
  대전역: { lat: 36.332, lng: 127.4342 },
  청주: { lat: 36.6424, lng: 127.489 },
  청주시청: { lat: 36.6424, lng: 127.489 }
};

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two {lat,lng} points, in kilometers.
export function haversineKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Estimated travel time (minutes) to cover a straight-line distance. A detour
// factor accounts for the fact that real roads are longer than crow-flies.
export function travelMinutes(distanceKm, mode = "car", detourFactor = 1.3) {
  const speed = TRAVEL_SPEEDS_KMH[mode] ?? TRAVEL_SPEEDS_KMH.car;
  return (distanceKm * detourFactor) / speed * 60;
}

// Translate a "I can spend N minutes traveling by <mode>" budget into an
// equivalent search radius in kilometers.
export function travelBudgetToRadiusKm(minutes, mode = "car", detourFactor = 1.3) {
  const speed = TRAVEL_SPEEDS_KMH[mode] ?? TRAVEL_SPEEDS_KMH.car;
  return (speed * (minutes / 60)) / detourFactor;
}

// Resolve a location spec into a concrete {lat,lng} origin.
// Accepts either explicit coordinates or a `near` landmark name.
export function resolveOrigin(location) {
  if (!location) return null;
  if (typeof location.lat === "number" && typeof location.lng === "number") {
    return { lat: location.lat, lng: location.lng };
  }
  if (location.near) {
    const key = String(location.near).replace(/\s+/g, "");
    const hit =
      LANDMARKS[key] ||
      LANDMARKS[Object.keys(LANDMARKS).find((k) => k.startsWith(key)) ?? ""];
    if (hit) return { ...hit };
  }
  return null;
}
