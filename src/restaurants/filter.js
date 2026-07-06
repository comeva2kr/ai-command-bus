// Multi-condition lifestyle filtering engine.
//
// A query stacks any number of independent conditions ("고깃집 AND 뒷고기 AND
// 프랜차이즈 아님 AND 키즈카페 있음"). Hard conditions exclude; soft
// preferences only boost ranking.

import {
  normalizeList,
  normalizeStyle,
  normalizeCuisine,
  normalizeTag,
  normalizeMenu,
  normalizeMenuAttr
} from "./taxonomy.js";

// Normalize a raw incoming query into canonical, deduped filter fields.
export function normalizeQuery(query = {}) {
  return {
    styles: normalizeList(query.styles ?? query.style, normalizeStyle),
    cuisines: normalizeList(query.cuisines ?? query.cuisine, normalizeCuisine),
    tagsAll: normalizeList(query.tagsAll, normalizeTag),
    tagsAny: normalizeList(query.tagsAny, normalizeTag),
    excludeTags: normalizeList(query.excludeTags, normalizeTag),
    prefer: normalizeList(query.prefer, normalizeTag),
    // Menu-level search: match a signature dish, optionally with attributes
    // like 활(살아있는)/숙성/자연산.
    menus: normalizeList(query.menu ?? query.menus, normalizeMenu),
    menuAttrs: normalizeList(query.menuAttrs ?? query.menuAttr, normalizeMenuAttr),
    // Hard feature requirements, e.g. { kidsCafe: true, partition: true }.
    require: query.require ?? {},
    // Soft feature preferences, boost only.
    preferFeatures: query.preferFeatures ?? {},
    excludeFranchise: query.excludeFranchise === true,
    priceMin: query.priceMin ?? 1,
    priceMax: query.priceMax ?? 4,
    minRating: query.minRating ?? 0,
    minVerification: query.minVerification ?? 0
  };
}

// Return { pass, reasons } for a single restaurant against hard conditions.
export function evaluateHard(restaurant, q) {
  const reasons = [];
  const style = restaurant.style;
  const cuisines = restaurant.cuisines || [];
  const tags = restaurant.tags || [];
  const features = restaurant.features || {};

  if (q.styles.length && !q.styles.includes(style)) {
    reasons.push(`style!=${q.styles.join("/")}`);
  }
  if (q.cuisines.length && !q.cuisines.some((c) => cuisines.includes(c))) {
    reasons.push(`cuisine!∋${q.cuisines.join("/")}`);
  }
  if (q.menus.length) {
    const menus = restaurant.menus || [];
    const match = menus.some((m) => {
      const name = normalizeMenu(m.name) ?? m.name;
      if (!q.menus.includes(name)) return false;
      const attrs = normalizeList(m.attrs, normalizeMenuAttr);
      return q.menuAttrs.every((a) => attrs.includes(a));
    });
    if (!match) {
      reasons.push(
        `no menu: ${q.menus.join("/")}${q.menuAttrs.length ? `(${q.menuAttrs.join(",")})` : ""}`
      );
    }
  }
  if (q.tagsAll.length && !q.tagsAll.every((t) => tags.includes(t))) {
    reasons.push(`missing tag(all): ${q.tagsAll.filter((t) => !tags.includes(t)).join(",")}`);
  }
  if (q.tagsAny.length && !q.tagsAny.some((t) => tags.includes(t))) {
    reasons.push(`missing tag(any): ${q.tagsAny.join("/")}`);
  }
  if (q.excludeTags.some((t) => tags.includes(t))) {
    reasons.push(`has excluded tag: ${q.excludeTags.filter((t) => tags.includes(t)).join(",")}`);
  }
  for (const [feat, want] of Object.entries(q.require)) {
    if (want && !features[feat]) reasons.push(`no feature: ${feat}`);
  }
  if (q.excludeFranchise && restaurant.franchise) reasons.push("franchise");
  if (restaurant.priceBand < q.priceMin || restaurant.priceBand > q.priceMax) {
    reasons.push(`price out of [${q.priceMin},${q.priceMax}]`);
  }
  if ((restaurant.rating ?? 0) < q.minRating) reasons.push("below minRating");
  if ((restaurant.verificationScore ?? 0) < q.minVerification) {
    reasons.push("below minVerification");
  }

  return { pass: reasons.length === 0, reasons };
}

// Soft preference score: rewards matching optional tags/features. 0..1-ish.
export function preferenceScore(restaurant, q) {
  const tags = restaurant.tags || [];
  const features = restaurant.features || {};
  let hits = 0;
  let possible = 0;

  for (const t of q.prefer) {
    possible += 1;
    if (tags.includes(t)) hits += 1;
  }
  for (const [feat, want] of Object.entries(q.preferFeatures)) {
    if (!want) continue;
    possible += 1;
    if (features[feat]) hits += 1;
  }
  return possible ? hits / possible : 0;
}

// Filter a list against a normalized query. Returns items that pass all hard
// conditions, each annotated with a preference score.
export function applyFilters(restaurants, rawQuery = {}) {
  const q = normalizeQuery(rawQuery);
  const passed = [];
  for (const r of restaurants) {
    const { pass } = evaluateHard(r, q);
    if (pass) passed.push({ ...r, preferenceScore: preferenceScore(r, q) });
  }
  return passed;
}
