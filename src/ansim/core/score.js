// 안심스캔 점수 엔진 — 제품 + 아이 프로필 → 점수·판정·이유.
//
// ── 설계 원칙
// 1. 알레르기는 점수가 아니라 차단이다. 등록된 알레르기 성분이 있으면 점수와
//    무관하게 "먹이지 마세요".
// 2. 점수는 100점에서 근거 있는 감점만 뺀다. 모든 감점에 근거 등급·출처가 붙는다.
// 3. 같은 제품도 아이에 따라 다르다. 나이(나트륨·당 기준), 알레르기, 걱정거리
//    (주의력·체중·성조숙증·아토피)가 점수와 설명을 바꾼다.
// 4. 모르는 건 모른다고 말한다. 영양정보가 없으면 "평가 못 함"을 명시하고,
//    질병 예방을 약속하는 문구는 쓰지 않는다(의료 효능 표방 금지).
//
// 이 모듈은 브라우저와 서버가 같이 쓴다 — node 전용 import 금지.

import { ALLERGEN_IDS, allergenLabel, detectAllergens } from "./allergens.js";
import { HONEY_PATTERN, SOURCES, SUGAR_PATTERN, detectAdditives } from "./additives.js";
import { categoryById, inferCategory } from "./categories.js";
import { parseIngredients } from "./ingredients.js";
import { ageBand, parseNutrition, perEating } from "./nutrition.js";

export const CONCERNS = [
  { id: "attention", label: "주의력·과잉행동" },
  { id: "weight", label: "체중 관리" },
  { id: "puberty", label: "성조숙증 걱정" },
  { id: "atopy", label: "아토피" }
];
const CONCERN_IDS = CONCERNS.map((c) => c.id);

export const VERDICTS = {
  block: { code: "block", label: "먹이지 마세요", tone: "red" },
  avoid: { code: "avoid", label: "비추천", tone: "red" },
  caution: { code: "caution", label: "주의", tone: "yellow" },
  good: { code: "good", label: "추천", tone: "green" },
  unknown: { code: "unknown", label: "정보 부족", tone: "gray" }
};

export const THRESHOLDS = { good: 75, caution: 55 };

const NUTRITION_SOURCES = {
  sugar: { title: "WHO 당류 섭취 지침 — 유리당은 총 에너지의 10% 미만 (어린이 포함)", url: "https://www.who.int/publications/i/item/9789241549028" },
  kdri: { title: "2020 한국인 영양소 섭취기준 — 나트륨 만성질환위험감소섭취량 (보건복지부·한국영양학회)", url: "https://www.kns.or.kr" },
  hfln: { title: "식약처 어린이 기호식품 고열량·저영양 판별 기준 (간식용)", url: "https://www.mfds.go.kr" },
  under2: { title: "미국인을 위한 식생활 지침 2020-2025 — 만 2세 미만 첨가당 피하기", url: "https://www.dietaryguidelines.gov" }
};

const MEAT = /돼지|돈육|닭|계육|쇠고기|소고기|우육|칠면조|오리고기|양고기|식육|베이컨/;

export function normalizeProfile(p = {}) {
  const age = Number(p.age);
  return {
    name: typeof p.name === "string" ? p.name.slice(0, 20) : "",
    age: Number.isFinite(age) && age >= 0 && age <= 19 ? age : 6,
    allergies: Array.isArray(p.allergies) ? p.allergies.filter((a) => ALLERGEN_IDS.includes(a)) : [],
    concerns: Array.isArray(p.concerns) ? p.concerns.filter((c) => CONCERN_IDS.includes(c)) : []
  };
}

function multiplier(tags, profile) {
  const c = new Set(profile.concerns);
  const t = new Set(tags || []);
  if (t.has("attention") && c.has("attention")) return 1.5;
  if (t.has("weight") && (c.has("weight") || c.has("puberty"))) return 1.5;
  return 1;
}

const pct = (x) => Math.round(x * 100);

export function analyzeProduct(product = {}, profileIn = {}) {
  const profile = normalizeProfile(profileIn);
  const band = ageBand(profile.age);
  const reasons = [];
  const notes = [];
  const highlights = [];
  const add = (r) => reasons.push({ evidence: "A", source: null, penalty: 0, ...r });

  const ingredientsText = [product.ingredientsText, product.allergenText].filter(Boolean).join(", ");
  const parsed = parseIngredients(ingredientsText);
  const tokens = parsed.tokens;
  const nutrition = perEating(product.nutrition || parseNutrition(product.nutritionText), product.servingG);

  const category = product.category || inferCategory({ foodType: product.foodType, name: product.name });
  const cat = categoryById(category);
  const processedMeat = Boolean(cat?.processedMeat && tokens.some((t) => MEAT.test(t)));

  if (!tokens.length && !nutrition) {
    return {
      score: null, verdict: VERDICTS.unknown, reasons: [], highlights: [],
      notes: ["원재료와 영양정보를 찾지 못했습니다. 포장 뒷면 원재료명 부분을 사진으로 찍어 주세요."],
      allergens: { contains: [], mayContain: [], forChild: [] },
      category, processedMeat: false, confidence: "low", ageBand: band.label, nutrition: null
    };
  }

  // ── 1. 알레르기 (차단)
  const contains = detectAllergens(tokens);
  const mayContain = detectAllergens(parsed.mayContainTokens).filter((id) => !contains.includes(id));
  const forChild = profile.allergies.filter((id) => contains.includes(id));
  for (const id of forChild) {
    add({ key: `allergen:${id}`, kind: "allergen", block: true, title: `${allergenLabel(id)} 함유`,
      detail: "아이 프로필에 등록한 알레르기 성분이 들어 있습니다." });
  }
  for (const id of profile.allergies.filter((a) => mayContain.includes(a))) {
    add({ key: `may:${id}`, kind: "allergen", penalty: 15, title: `${allergenLabel(id)} 혼입 가능`,
      detail: "같은 제조시설에서 이 성분을 씁니다. 알레르기가 심하면 피하세요." });
  }

  // ── 2. 나이 차단: 12개월 미만 꿀
  if (profile.age < 1 && tokens.some((t) => HONEY_PATTERN.test(t))) {
    add({ key: "honey-infant", kind: "age", block: true, title: "12개월 미만 꿀 금지",
      detail: "꿀은 영아 보툴리누스증 위험 때문에 돌 전에는 먹이지 않습니다.", source: SOURCES.cdcHoney });
  }

  // ── 3. 가공육
  if (processedMeat) {
    add({ key: "processed-meat", kind: "category", penalty: 10, title: "가공육",
      detail: "햄·소시지 같은 가공육은 IARC 1군 발암요인(대장암)입니다. 아이 식단에서는 먹는 빈도를 줄이는 게 좋습니다.",
      source: SOURCES.iarcMeat });
  }

  // ── 4. 첨가물
  for (const a of detectAdditives(tokens, { processedMeat })) {
    if (a.myth) {
      notes.push(`${a.label}: ${a.note}`);
      continue;
    }
    const m = multiplier(a.concerns, profile);
    add({ key: a.id, kind: "additive", penalty: Math.round(a.penalty * m), evidence: a.evidence,
      title: a.label, detail: a.note + (m > 1 ? " (선택하신 걱정거리 때문에 더 엄격하게 봅니다.)" : ""),
      source: a.source, group: a.group });
  }

  // ── 5. 영양
  const addedSugarTokens = parsed.top.filter((t) => SUGAR_PATTERN.test(t.replace(/\s+/g, "")));
  if (nutrition) {
    const { sugarG, sodiumMg, proteinG, kcal, satFatG, transFatG } = nutrition;
    const basisNote = nutrition.basis === "per100" ? " (100g 기준 — 실제 먹는 양에 따라 달라집니다)" : "";
    if (sugarG != null) {
      const r = sugarG / band.sugarLimitG;
      const base = r >= 0.75 ? 24 : r >= 0.5 ? 18 : r >= 0.25 ? 10 : r >= 0.125 ? 4 : 0;
      if (base) {
        const m = multiplier(["weight"], profile);
        add({ key: "sugar", kind: "nutrition", penalty: Math.round(base * m), value: sugarG,
          title: `당류 ${sugarG}g — 하루 권장 상한의 ${pct(r)}%`,
          detail: `${band.label} 첨가당 권장 상한 약 ${band.sugarLimitG}g(총 에너지 10%) 기준${basisNote}. 표시 당류에는 우유·과일의 천연당도 포함됩니다.`,
          source: NUTRITION_SOURCES.sugar });
      }
    }
    if (sodiumMg != null) {
      const r = sodiumMg / band.sodiumMg;
      const base = r >= 0.33 ? 16 : r >= 0.2 ? 9 : r >= 0.1 ? 3 : 0;
      if (base) {
        add({ key: "sodium", kind: "nutrition", penalty: base, value: sodiumMg,
          title: `나트륨 ${sodiumMg}mg — 하루 기준의 ${pct(r)}%`,
          detail: `${band.label} 나트륨 하루 기준 ${band.sodiumMg}mg 대비${basisNote}.`,
          source: NUTRITION_SOURCES.kdri });
      }
    }
    if (cat?.snack && proteinG != null && proteinG < 2 &&
        ((kcal ?? 0) > 250 || (satFatG ?? 0) > 4 || (sugarG ?? 0) > 17)) {
      const m = multiplier(["weight"], profile);
      add({ key: "hfln", kind: "nutrition", penalty: Math.round(12 * m),
        title: "고열량·저영양 간식",
        detail: `단백질 2g 미만이면서 열량 250kcal·포화지방 4g·당류 17g 중 하나를 넘습니다. 어린이 식생활안전관리 특별법은 이런 간식의 학교 내 판매와 어린이 시청 시간대 TV 광고를 제한합니다${basisNote}.`,
        source: NUTRITION_SOURCES.hfln });
    }
    if (transFatG != null && transFatG >= 0.2) {
      add({ key: "trans", kind: "nutrition", penalty: 8, value: transFatG,
        title: `트랜스지방 ${transFatG}g`, detail: "트랜스지방은 아이 식단에서 0에 가깝게 유지하는 것이 좋습니다.",
        source: SOURCES.whoTrans });
    }
  } else if (addedSugarTokens.length && parsed.top.slice(0, 3).some((t) => SUGAR_PATTERN.test(t.replace(/\s+/g, "")))) {
    const m = multiplier(["weight"], profile);
    add({ key: "added-sugar-top", kind: "nutrition", penalty: Math.round(8 * m), evidence: "B",
      title: "첨가당이 주요 원재료",
      detail: "원재료는 많이 들어간 순서로 적습니다. 영양정보가 없어 순서로 추정했습니다.",
      source: NUTRITION_SOURCES.sugar });
  }
  if (profile.age < 2 && addedSugarTokens.length) {
    add({ key: "under2-sugar", kind: "age", penalty: 10, title: "만 2세 미만 첨가당",
      detail: `${addedSugarTokens.join(", ")} — 만 2세 전에는 첨가당을 피하도록 권고합니다.`,
      source: NUTRITION_SOURCES.under2 });
  }

  // ── 6. 알려줄 것 (감점 없음)
  if (!nutrition) notes.push("영양정보가 없어 나트륨·당류는 평가하지 못했습니다. 영양정보 표를 찍으면 더 정확해집니다.");
  if (mayContain.length && !profile.allergies.some((a) => mayContain.includes(a))) {
    notes.push(`같은 제조시설 사용: ${mayContain.map(allergenLabel).join(", ")}`);
  }
  const concerns = new Set(profile.concerns);
  if (concerns.has("puberty")) {
    notes.push("성조숙증과 직접 인과가 확인된 식품첨가물은 아직 없습니다. 확립된 위험요인인 소아비만과 관련된 당·열량 항목을 1.5배 엄격하게 봅니다.");
  }
  if (concerns.has("atopy")) {
    notes.push("아토피는 아이마다 악화시키는 음식이 달라 일괄 감점하지 않습니다. 의심되는 식품을 알레르기 목록에 등록하면 그 성분이 든 제품은 바로 걸러집니다.");
  }
  if (concerns.has("attention")) {
    notes.push("합성색소 6종과 안식향산나트륨은 1.5배 엄격하게 봅니다.");
  }

  // ── 7. 좋은 점
  if (!reasons.some((r) => r.kind === "additive")) highlights.push("문제 첨가물 없음");
  if (processedMeat && !reasons.some((r) => r.group === "발색제")) highlights.push("발색제(아질산) 없음");
  if (parsed.count && parsed.count <= 6) highlights.push(`원재료 ${parsed.count}가지로 단순함`);

  // ── 점수·판정
  reasons.sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0) || b.penalty - a.penalty);
  const penalty = reasons.reduce((s, r) => s + (r.penalty || 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const verdict = reasons.some((r) => r.block) ? VERDICTS.block
    : score >= THRESHOLDS.good ? VERDICTS.good
    : score >= THRESHOLDS.caution ? VERDICTS.caution
    : VERDICTS.avoid;

  return {
    score, verdict, reasons, notes, highlights,
    allergens: { contains, mayContain, forChild },
    category, processedMeat,
    confidence: tokens.length && nutrition ? "high" : tokens.length ? "medium" : "low",
    ageBand: band.label,
    nutrition
  };
}
