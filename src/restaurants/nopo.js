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

export default { classifyByPhone, isOldEstablishment };
