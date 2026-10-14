// 영양정보 파서 + 나이별 기준.
//
// 한국 영양성분 표시는 이렇게 생겼다:
//   총 내용량 70g 350kcal | 나트륨 280mg 14% | 탄수화물 46g | 당류 20g 20% |
//   지방 17g | 트랜스지방 0g | 포화지방 6g 40% | 콜레스테롤 5mg | 단백질 4g 7%
// 기준은 "총 내용량당", "100g당", "1회 섭취참고량(30g)당" 중 하나다.
//
// ── 나이별 기준 (2020 한국인 영양소 섭취기준, 보건복지부·한국영양학회)
//   kcal: 에너지 필요추정량(남녀 평균에 가깝게 반올림)
//   sodiumMg: 나트륨 만성질환위험감소섭취량
//   첨가당 상한: 총 에너지의 10% (같은 기준의 권고) → kcal × 0.1 ÷ 4
// ※ 표의 숫자는 배포 전 원문 대조가 필요하다(docs/ansim-scan.md 검증 목록).
//
// 이 모듈은 브라우저와 서버가 같이 쓴다 — node 전용 import 금지.

export const AGE_BANDS = [
  { maxAge: 2, label: "1~2세", kcal: 900, sodiumMg: 1200 },
  { maxAge: 5, label: "3~5세", kcal: 1400, sodiumMg: 1600 },
  { maxAge: 8, label: "6~8세", kcal: 1600, sodiumMg: 1900 },
  { maxAge: 11, label: "9~11세", kcal: 1900, sodiumMg: 2300 },
  { maxAge: 14, label: "12~14세", kcal: 2250, sodiumMg: 2300 },
  { maxAge: Infinity, label: "15세 이상", kcal: 2300, sodiumMg: 2300 }
];

export function ageBand(age) {
  const a = Number.isFinite(age) ? age : 6;
  const band = AGE_BANDS.find((b) => a <= b.maxAge) || AGE_BANDS.at(-1);
  return { ...band, sugarLimitG: Math.round((band.kcal * 0.1) / 4) };
}

const num = (s) => Number(String(s).replace(/,/g, ""));

function grab(text, re, unitScale = { mg: 1, g: 1000 }) {
  const m = text.match(re);
  if (!m) return null;
  const value = num(m[1]);
  if (!Number.isFinite(value)) return null;
  if (!m[2]) return value;
  return value * (unitScale[m[2].toLowerCase()] ?? 1);
}

// 텍스트 → { basis, basisAmount, kcal, sodiumMg, sugarG, satFatG, transFatG, proteinG }
// basis: "total" | "per100" | "serving" | null
export function parseNutrition(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  if (!t.trim()) return null;
  const out = {
    basis: null,
    basisAmount: null,
    kcal: grab(t, /([\d.,]+)\s*(?:kcal|㎉|킬로칼로리)/i, {}),
    sodiumMg: grab(t, /나트륨\s*:?\s*([\d.,]+)\s*(mg|g)/i),
    sugarG: grab(t, /당류\s*:?\s*([\d.,]+)\s*(g|mg)/i, { g: 1, mg: 0.001 }),
    satFatG: grab(t, /포화\s*지방\s*:?\s*([\d.,]+)\s*(g|mg)/i, { g: 1, mg: 0.001 }),
    transFatG: grab(t, /트랜스\s*지방\s*:?\s*([\d.,]+)\s*(g|mg)/i, { g: 1, mg: 0.001 }),
    proteinG: grab(t, /단백질\s*:?\s*([\d.,]+)\s*(g|mg)/i, { g: 1, mg: 0.001 })
  };
  let m;
  if ((m = t.match(/1회\s*(?:섭취\s*참고량|제공량|섭취량)\s*\(?\s*([\d.,]+)\s*(g|ml|mL)/i))) {
    out.basis = "serving"; out.basisAmount = num(m[1]);
  } else if ((m = t.match(/100\s*(g|ml|mL)\s*당/i))) {
    out.basis = "per100"; out.basisAmount = 100;
  } else if ((m = t.match(/총\s*내용량\s*:?\s*([\d.,]+)\s*(g|ml|mL)/i))) {
    out.basis = "total"; out.basisAmount = num(m[1]);
  }
  const hasAny = ["kcal", "sodiumMg", "sugarG", "satFatG", "transFatG", "proteinG"].some((k) => out[k] != null);
  return hasAny ? out : null;
}

// 아이가 "한 번에 먹는 양" 기준으로 환산한다.
// - serving/total: 표시값 그대로 (작은 간식 봉지는 아이가 한 번에 다 먹는다고 본다)
// - per100: 1회 섭취량(servingG)을 알면 환산, 모르면 100g을 1회로 본다
export function perEating(n, servingG = null) {
  if (!n) return null;
  if (n.basis === "per100" && Number.isFinite(servingG) && servingG > 0) {
    const f = servingG / 100;
    const scale = (v) => (v == null ? null : Math.round(v * f * 10) / 10);
    return {
      ...n, basis: "serving", basisAmount: servingG,
      kcal: scale(n.kcal), sodiumMg: scale(n.sodiumMg), sugarG: scale(n.sugarG),
      satFatG: scale(n.satFatG), transFatG: scale(n.transFatG), proteinG: scale(n.proteinG)
    };
  }
  return n;
}
