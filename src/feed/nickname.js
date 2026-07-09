// Witty auto-generated nicknames ("오늘의 닉네임").
//
// Users are anonymous; each gets a sensible random Korean nickname
// (adjective + animal + number) instead of exposing any account identity.
// Generation is DETERMINISTIC from a seed string (the user id), so the same
// user keeps a stable nickname without storing extra state and tests stay
// reproducible — no Math.random.

const ADJ = [
  "느긋한", "배고픈", "잠많은", "무심한", "츤데레", "소심한", "대범한", "엉뚱한",
  "진지한", "심야의", "낮잠자는", "커피중독", "현타온", "돌아온", "떠오르는", "은근한",
  "수줍은", "까칠한", "해맑은", "방구석", "전설의", "야심한", "심드렁한", "부지런한"
];
const NOUN = [
  "너구리", "감자", "고양이", "코알라", "부엉이", "수달", "햄스터", "판다", "두더지",
  "참새", "고슴도치", "문어", "알파카", "라쿤", "펭귄", "다람쥐", "웜뱃", "해달",
  "비버", "도마뱀", "고래", "오리", "여우"
];

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Deterministic nickname from a seed (e.g. userId). Vary `salt` to reroll.
export function nicknameFor(seed, salt = 0) {
  const h = hash(String(seed) + ":" + salt);
  const adj = ADJ[h % ADJ.length];
  const noun = NOUN[Math.floor(h / ADJ.length) % NOUN.length];
  const num = (h % 89) + 10; // 10–98
  return `${adj} ${noun} ${num}`;
}

export { ADJ, NOUN };
