// 같은 기사가 여러 소스로 들어올 때 하나만 남기기 위한 제목 정규화.
//
// 왜 URL만으로는 안 되는가 (2026-08-02 적대적 검수 실측):
// 중복 제거가 URL 단일키였는데, 구글뉴스 항목의 url은
// `news.google.com/rss/articles/CBMi...` 형태의 불투명한 리다이렉트다. 원문
// 매체가 같은 기사를 자기 도메인으로 올려도 URL이 겹칠 수가 없어서, 한 화면에
// 같은 기사가 두 번 뜨는 일이 구조적으로 막히지 않았다. 실측에서는 구글뉴스
// 전용 문제도 아니었다 — `[속보] ` 접두어만 다른 mk-news/yna 쌍이 첫 화면에
// 나란히 있었다.
//
// 정규화 대상은 "같은 사건인지"를 가리는 데 방해가 되는 것들만:
//   말머리([속보]·[단독]·(종합)), 매체명 꼬리(" - 연합뉴스"), 따옴표·문장부호,
//   공백. 조사·어미는 건드리지 않는다 — 형태소 분석 없이 손대면 서로 다른 글이
//   같은 키로 뭉개진다.
//
// **짧은 제목에는 적용하지 않는다.** 커뮤니티에는 "ㅋㅋㅋ", "이거 실화냐" 같은
// 제목이 흔해서, 짧은 문자열로 묶으면 서로 다른 글이 한 건으로 사라진다.
// 예전에 URL 정규화를 과하게 했다가 뽐뿌 18건이 2건으로 붕괴한 회귀가 있었고
// (2026-08-01), 같은 실수를 제목 쪽에서 반복하지 않으려는 하한이다.
export const MIN_KEY_LEN = 10;

const LEAD_TAG = /^\s*[[({【〈<][^\])}】〉>]{0,12}[\])}】〉>]\s*/;
const OUTLET_TAIL = /\s+[-–—|]\s+[^-–—|]{1,30}$/;
// 통신사 개정 표기 꼬리: "제목(종합)", "제목(종합2보)", "제목(2보)".
// 확정 어휘로만 좁힌다 — 임의 괄호를 걷어내면 "(전문)"과 "(인터뷰)"처럼
// 실제로 다른 기사가 같은 키로 뭉개진다(2026-08-01 뽐뿌 18건→2건 붕괴와
// 같은 계열의 실수다).
const REVISION_TAIL = /[(（]\s*(?:종합|속보|단독|\d*보)\s*\d*\s*보?\s*[)）]\s*$/;

export function normalizeForDedupe(title) {
  let t = String(title || "");
  if (!t) return "";
  // 말머리는 여러 개 붙기도 한다: "[속보][단독] ..."
  for (let n = 0; n < 3 && LEAD_TAG.test(t); n++) t = t.replace(LEAD_TAG, "");
  t = t.replace(OUTLET_TAIL, "");
  t = t.replace(REVISION_TAIL, "");
  return t
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "")
    .trim();
}

// 중복 판정용 키. 너무 짧으면 null — 호출부는 null이면 묶지 않는다.
export function eventKey(title) {
  const n = normalizeForDedupe(title);
  return n.length >= MIN_KEY_LEN ? n : null;
}

// 두 제목이 같은 사건인지. 완전일치만 본다 — 부분 유사도(자카드 등)는 임계값이
// 감이 되기 쉽고, 잘못 묶이면 멀쩡한 글이 조용히 사라진다. 실측에서 확인된
// 중복의 상당수가 말머리·매체명만 다른 완전일치였으므로 여기까지가 비용 대비
// 효과가 확실한 선이다.
export function isSameEvent(a, b) {
  const ka = eventKey(a);
  return ka !== null && ka === eventKey(b);
}
