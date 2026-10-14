// 안심스캔 코어 — 서버, PWA, 브라우저 확장이 같은 판단을 내리도록 한 벌만 둔다.
// 확장 프로그램은 tools/build-ansim-extension.mjs가 이 디렉터리를 복사해 쓴다.
export { ALLERGENS, ALLERGEN_IDS, allergenLabel, detectAllergens } from "./allergens.js";
export { ADDITIVES, SOURCES, detectAdditives } from "./additives.js";
export { CATEGORIES, categoryById, inferCategory } from "./categories.js";
export { parseIngredients } from "./ingredients.js";
export { AGE_BANDS, ageBand, parseNutrition, perEating } from "./nutrition.js";
export { CONCERNS, THRESHOLDS, VERDICTS, analyzeProduct, normalizeProfile } from "./score.js";
export { improvements, rankAlternatives } from "./alternatives.js";
export { MALLS, MALL_IDS, buyLinks, detectMall, mallById } from "./malls.js";
export { cleanTitle, listingKeys, normalizeTitle, noticeToProduct, rowsFromText } from "./notice.js";
