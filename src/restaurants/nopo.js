// 노포(오래된 집) 판별 — 전화번호 자릿수 휴리스틱.
//
// 착안: 한국 유선전화 가입자번호는 6자리 → 7자리 → (서울)8자리로 늘어왔다.
// 그래서 "지역번호를 뺀 가입자번호"가 짧을수록 오래 전에 개통한 번호 = 오래된 가게.
// 전화선 개통일은 조작이 불가능해서, 광고로 못 만드는 강한 '진짜 오래됨' 신호다.
//
//   • 6자리       → 아주 오래된 집(찐노포). 전국 공통, 가장 강한 신호.
//   • 서울(02) 7자리 → 오래된 집. (서울은 6→7→8로 늘어 7도 옛날 번호)
//   • 비수도권 7자리   → 현재 표준이라 노포로 단정하지 않음(오탐 방지).
//
// 어디까지나 휴리스틱이다(번호를 바꾼 노포도 있음). 확정이 아니라 '가능성' 신호로 쓴다.

const AREA3 = new Set([
  "031", "032", "033", "041", "042", "043", "044",
  "051", "052", "053", "054", "055",
  "061", "062", "063", "064"
]);

// tier: "ancient" | "old" | "modern" | "mobile" | "unknown"
export function classifyByPhone(phone) {
  const none = { tier: "unknown", subscriberDigits: null, label: null };
  if (!phone) return none;
  const d = String(phone).replace(/\D/g, "");
  if (!d) return none;

  if (/^01[016789]/.test(d)) return { tier: "mobile", subscriberDigits: null, label: null }; // 휴대폰
  if (/^070/.test(d) || /^050/.test(d)) return none; // 인터넷전화·가상(안심)번호 → 판단 불가
  if (/^1[568]\d\d$/.test(d.slice(0, 4)) && d.length === 8) return none; // 15xx/16xx/18xx 대표번호

  let area = null;
  let seoul = false;
  if (d.startsWith("02")) { area = 2; seoul = true; }
  else if (AREA3.has(d.slice(0, 3))) area = 3;
  else return none;

  const sub = d.length - area; // 지역번호 제외 가입자번호 자릿수
  if (sub === 6) return { tier: "ancient", subscriberDigits: 6, label: "노포" };
  if (sub === 7 && seoul) return { tier: "old", subscriberDigits: 7, label: "오래된 집" };
  return { tier: sub >= 7 ? "modern" : "unknown", subscriberDigits: sub, label: null };
}

// 노포 필터에 걸리는지(아주 오래됨 또는 오래됨).
export const isOldEstablishment = (tier) => tier === "ancient" || tier === "old";

// ─────────────────────────────────────────────────────────────────────────
// 다중 신호 노포 점수 (전국 공통 — 서울/지방 편향 없음).
// 신호를 합쳐 0~100 점수와 등급을 낸다. 가장 정확한 신호는 공공 인허가 개업일
// (foundingYear)이며, 있으면 그것이 지배한다. 없으면 아래 휴리스틱으로 추정한다.
//
//   1) 전화번호 자릿수      (개통일 = 조작 불가) — 전국
//   2) 상호 텍스트 패턴      (원조/전통/N대/옛식 상호 옥·관·반점 등) — 전국
//   3) 전통시장 소재         (주소에 '시장') — 전국
//   4) 노포 다발 업종        (국밥/곰탕/냉면/백반 등) — 전국
//   5) (공공 인허가 개업일)  — 붙으면 정확한 연도로 판정, 나머지 무력화

const NAME_STRONG = [
  /원조/, /元祖/, /노포/, /할매/, /할머[니]/, /할배/, /전통/,
  /\b(18|19)\d\d\b/, /\d{1,3}\s*년\s*전통/, /[1-9]\s*대(?:째)?/, /삼대|이대|사대|오대/
];
// 옛식 상호 접미사(을지면옥·하동관·안동장·태화루·영생반점 …)
const NAME_SUFFIX = /(옥|관|회관|반점|루|장|성|각)$/;
const OLD_MENU = /(국밥|곰탕|설렁탕|해장국|우거지|냉면|밀면|막국수|백반|한정식|손칼국수|칼국수|손만두|만두|순대|족발|추어탕|보리밥|국수|중화요리|짜장|짬뽕)/;

function ageFromFoundingYear(foundingYear, nowYear) {
  if (!foundingYear || !nowYear) return null;
  const age = nowYear - foundingYear;
  return age >= 0 && age < 200 ? age : null;
}

// place: { name, category, address, phone, foundingYear? }
// nowYear: pass the current year (caller supplies it — module stays pure/testable).
export function scoreNopo(place = {}, nowYear = null) {
  const reasons = [];
  const name = String(place.name || "");
  const cat = String(place.category || "");
  const addr = String(place.address || "");

  // 5) 공식 개업일이 있으면 그것이 지배.
  const age = ageFromFoundingYear(place.foundingYear, nowYear);
  if (age != null) {
    let score = age >= 40 ? 100 : age >= 30 ? 88 : age >= 20 ? 68 : age >= 10 ? 40 : 15;
    reasons.unshift(`공식 개업 ${age}년차`);
    const tier = score >= 65 ? "strong" : score >= 40 ? "moderate" : null;
    return { score, tier, label: tier === "strong" ? "노포" : tier === "moderate" ? "오래된 집" : null, reasons, ageYears: age };
  }

  let score = 0;
  const phone = classifyByPhone(place.phone);
  if (phone.tier === "ancient") { score += 60; reasons.push("전화번호 6자리(아주 오래된 개통)"); }
  else if (phone.tier === "old") { score += 34; reasons.push("서울 7자리 번호(오래된 개통)"); }

  if (NAME_STRONG.some((re) => re.test(name))) { score += 22; reasons.push("상호에 ‘원조/전통/N대’ 등 표기"); }
  if (NAME_SUFFIX.test(name.replace(/\s+/g, ""))) { score += 12; reasons.push("옛식 상호(‘옥/관/반점’ 등)"); }
  if (/시장/.test(addr)) { score += 15; reasons.push("전통시장 안"); }
  if (OLD_MENU.test(cat) || OLD_MENU.test(name)) { score += 10; reasons.push("노포 다발 업종(국밥/냉면 등)"); }

  score = Math.min(100, score);
  const tier = score >= 55 ? "strong" : score >= 32 ? "moderate" : null;
  return { score, tier, label: tier === "strong" ? "노포" : tier === "moderate" ? "오래된 집" : null, reasons, ageYears: null };
}

export default { classifyByPhone, isOldEstablishment, scoreNopo };
