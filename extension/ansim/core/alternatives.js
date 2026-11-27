// 대체품 — "이거 말고 이거".
//
// 규칙:
//   - 같은 분류 안에서만 찾는다 (소시지 → 소시지)
//   - 이 아이에게 차단(알레르기)인 제품은 절대 추천하지 않는다
//   - 원래 제품보다 점수가 높아야 한다. 원래 제품이 차단이면 차단만 아니면 된다
//   - "왜 더 나은지"를 같이 보여준다 — 점수 숫자만 보여주면 믿을 이유가 없다
//   - 광고·제휴 여부는 순위에 끼어들지 않는다 (정렬 키는 점수뿐)

import { analyzeProduct } from "./score.js";
import { buyLinks } from "./malls.js";

const sameProduct = (a, b) =>
  (a.id && a.id === b.id) || (a.barcode && a.barcode === b.barcode) || (a.name && a.name === b.name);

// 원래 제품에 있던 문제 중 대체품에선 사라지거나 줄어든 것
const NUTRIENT = { sugar: ["sugarG", "g"], sodium: ["sodiumMg", "mg"], trans: ["transFatG", "g"] };

export function improvements(base, alt) {
  const out = [];
  const altByKey = new Map(alt.reasons.map((r) => [r.key, r]));
  for (const r of base.reasons) {
    const short = r.title.split(" —")[0];           // "당류 32g — 하루 …" → "당류 32g"
    const nutrient = NUTRIENT[r.key];
    if (nutrient) {
      const altValue = alt.nutrition?.[nutrient[0]];
      if (altValue != null && altValue < r.value) out.push(`${short} → ${altValue}${nutrient[1]}`);
      else if (!altByKey.has(r.key)) out.push(`${short.replace(/\s*[\d.]+\s*(mg|g)$/, "")} 기준 이내`);
    } else if (!altByKey.has(r.key)) {
      out.push(r.key === "hfln" ? "고열량·저영양 기준 아님" : `${r.title.replace(/ 함유$/, "")} 없음`);
    }
  }
  return out.slice(0, 4);
}

export function rankAlternatives(target, candidates, profile, { limit = 4, mall = null, base = null } = {}) {
  const baseAnalysis = base || analyzeProduct(target, profile);
  const category = target.category || baseAnalysis.category;
  if (!category) return [];
  const floor = baseAnalysis.verdict.code === "block" ? -1 : baseAnalysis.score ?? -1;
  const better = candidates
    .filter((c) => !sameProduct(c, target))
    .map((c) => ({ product: c, analysis: analyzeProduct(c, profile) }))
    .filter(({ analysis }) => analysis.category === category)
    .filter(({ analysis }) => analysis.verdict.code !== "block" && analysis.score != null && analysis.score > floor)
    .sort((a, b) => b.analysis.score - a.analysis.score);
  // '추천' 등급이 있으면 그것만. 없을 때만 '그나마 나은 것'을 보여주고 tier로 구분한다.
  const good = better.filter(({ analysis }) => analysis.verdict.code === "good");
  const tier = good.length ? "good" : "better";
  return (good.length ? good : better)
    .slice(0, limit)
    .map(({ product, analysis }) => ({
      tier,
      product,
      analysis,
      improvements: improvements(baseAnalysis, analysis),
      links: buyLinks(product, mall)
    }));
}
