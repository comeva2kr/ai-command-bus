// High-level search: combine verification, geo (radius / travel-time / near),
// multi-condition filtering, and ranking into one call.

import { ingest } from "./ingest.js";
import { applyFilters } from "./filter.js";
import {
  haversineKm,
  travelMinutes,
  travelBudgetToRadiusKm,
  resolveOrigin
} from "./geo.js";

// Resolve the geo constraint into { origin, radiusKm, mode } (any may be null).
export function resolveGeo(query = {}) {
  const origin = resolveOrigin(query.location);
  if (!origin) return { origin: null, radiusKm: null, mode: null };

  const mode = query.travel?.mode ?? "car";
  let radiusKm = query.radiusKm ?? null;
  if (radiusKm == null && query.travel?.minutes != null) {
    radiusKm = travelBudgetToRadiusKm(query.travel.minutes, mode);
  }
  return { origin, radiusKm, mode };
}

// Rank blends verification, rating, preference matches, and proximity.
function rankScore(r, { hasGeo }) {
  const verification = (r.verificationScore ?? 0) / 100; // 0..1
  const rating = (r.rating ?? 0) / 5; // 0..1
  const preference = r.preferenceScore ?? 0; // 0..1
  // Closer is better; decays to 0 by ~10km. Neutral when no location given.
  const proximity = hasGeo && r.distanceKm != null ? Math.max(0, 1 - r.distanceKm / 10) : 0.5;

  return (
    verification * 0.35 +
    rating * 0.25 +
    preference * 0.2 +
    proximity * 0.2
  );
}

// Main entry point.
//   rawRestaurants: source records (with `sources` mentions)
//   query: { location, radiusKm, travel, styles, cuisines, menu, require, ... }
export function search(rawRestaurants, query = {}, options = {}) {
  // 1) Verify + drop advertising, unless explicitly asked to keep everything.
  const verified = ingest(rawRestaurants, {
    keepUnverified: query.includeUnverified === true,
    ...options.verify
  });

  // 2) Geo gate.
  const { origin, radiusKm, mode } = resolveGeo(query);
  let candidates = verified.map((r) => {
    if (!origin) return { ...r, distanceKm: null, travelMinutes: null };
    const distanceKm = haversineKm(origin, { lat: r.lat, lng: r.lng });
    return {
      ...r,
      distanceKm: Number(distanceKm.toFixed(2)),
      travelMinutes: Math.round(travelMinutes(distanceKm, mode))
    };
  });
  if (origin && radiusKm != null) {
    candidates = candidates.filter((r) => r.distanceKm <= radiusKm);
  }

  // 3) Multi-condition lifestyle/menu filters.
  const filtered = applyFilters(candidates, query);

  // 4) Rank.
  const hasGeo = Boolean(origin);
  const ranked = filtered
    .map((r) => ({ ...r, score: Number(rankScore(r, { hasGeo }).toFixed(4)) }))
    .sort((a, b) => b.score - a.score);

  return {
    meta: {
      total: ranked.length,
      origin,
      radiusKm: radiusKm != null ? Number(radiusKm.toFixed(2)) : null,
      travelMode: origin ? mode : null,
      verifiedOnly: query.includeUnverified !== true
    },
    results: ranked
  };
}
