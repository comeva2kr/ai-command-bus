// HTML/XML에서 가져온 글자를 사람이 읽는 글자로 되돌린다.
//
// ── 왜 따로 두나 (2026-08-05)
// 같은 일을 하는 함수가 두 파일에 각각 있었고, 한쪽만 완전했다:
//   fetchers.js  stripHtml   — &nbsp; 처리 있음
//   enrich.js    decodeEntities — &nbsp; 처리 **없음**
// 그래서 RSS로 들어온 발췌는 멀쩡한데, enricher가 원문 페이지의
// og:description에서 가져온 발췌만 깨졌다. David 실기기 실측:
//   "'콩국수'라는&nbsp;말이&nbsp;처음&nbsp;등장하는&nbsp;기록은 19세기…"
//
// 사전을 한쪽에만 늘리면 다음 사람이 또 같은 자리를 밟는다. 한 벌만 둔다.

// 이름 있는 엔티티. 숫자 엔티티(&#160; 등)는 아래에서 일괄 처리하므로
// 여기에는 **이름으로만 오는 것**을 둔다. 실제 한국 사이트에서 만난 것만 넣는다 —
// 전체 HTML5 엔티티 표(2,000여 개)를 들고 다닐 이유가 없다.
const NAMED = {
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  lt: "<", gt: ">", quot: '"', apos: "'",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", mdash: "—", ndash: "–", middot: "·",
  laquo: "«", raquo: "»", bull: "•", deg: "°",
  trade: "™", copy: "©", reg: "®", euro: "€",
  times: "×", divide: "÷", plusmn: "±"
};

// &amp;를 **마지막에** 푸는 것이 중요하다. 먼저 풀면 "&amp;lt;"가 "<"가 되어
// 원문에 있던 문자 그대로의 "&lt;" 표기를 태그로 바꿔 버린다.
export function decodeEntities(input) {
  let s = String(input || "");
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (whole, name) => {
    const key = name.toLowerCase();
    if (key === "amp") return whole;              // 마지막에 처리
    return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : whole;
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)));
  s = s.replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)));
  return s.replace(/&amp;/gi, "&");
}

// 깨진 숫자 엔티티에 String.fromCodePoint가 예외를 던지면 발췌 하나 때문에
// 수집 한 건이 통째로 죽는다. 범위를 벗어나면 원문을 그대로 둔다.
function codePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try { return String.fromCodePoint(n); } catch { return ""; }
}

// 태그를 걷어내고 글자만 남긴다.
//
// <description>은 "HTML을 XML로 이스케이프"한 이중 인코딩이라 한 번 푼 뒤에도
// 텍스트 노드의 엔티티가 남는다(실측: 구글뉴스 상세뷰의 "&nbsp;&nbsp;",
// 2026-07-31). 그래서 **풀고 → 태그 제거 → 다시 푼다.**
export function stripHtml(input) {
  const once = decodeEntities(String(input || ""));
  return decodeEntities(once.replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")     // 실제 문자로 들어온 줄바꿈 없는 공백
    .replace(/\s+/g, " ")
    .trim();
}
