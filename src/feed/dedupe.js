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

// 콘텐츠 URL의 정규 식별자. 추적 파라미터만 걷고 글의 정체가 될 수 있는
// 쿼리는 보존한다. 게시판 URL은 `id`·`no` 같은 쿼리가 글 자체이므로 pathname만
// 남기면 게시판 전체가 한 건으로 합쳐진다.
export function canonicalContentUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    const params = [...url.searchParams]
      .filter(([key]) => !/^(utm_|fbclid|gclid|igshid|ref$)/i.test(key))
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const query = params.length
      ? "?" + params.map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join("&")
      : "";
    return url.origin + url.pathname + query;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 근접 중복(브리핑 이슈 간) — 어순·수식어가 달라 완전일치는 아니지만 같은 사건.
//
// 실측(2026-08-09): "채상병 순직 책임" 계열 헤드라인 4건이 각자 다른 말로
// 쓰여 eventKey도 다르고, digest.js가 클러스터를 나눌 때 보는 태그(사전
// 기반이라 인명이 없다)도 안 겹쳐서 브리핑 이슈 6건 중 4건을 차지했다.
// isSameEvent의 완전일치는 이런 변주를 못 잡는다. 그렇다고 새 유사도 계산을
// 만들지 않는다 — 같은 전처리(말머리·매체명 꼬리·개정 표기 제거)를 그대로
// 쓰고, 비교만 낱말 단위로 한다.
const WORD_RE = /[0-9a-z가-힣]{2,}/g;
const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "he", "her", "him", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "me", "more", "most", "my", "no", "not", "of", "on", "once",
  "or", "our", "she", "so", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "to", "too", "up", "us", "was", "we", "were",
  "what", "when", "where", "which", "who", "why", "will", "with", "you", "your"
]);
const GENERIC_NEWS_WORDS = new Set([
  "관련", "기사", "뉴스", "보도", "소식", "오늘", "현재", "이번", "대한", "통해",
  "예정", "공개", "공식", "자료", "진행", "시작", "주장", "사건", "출처", "관측",
  // 분류 라벨은 같은 사건의 근거가 아니다. 테스트 픽스처뿐 아니라 번역되지
  // 않은 영문 제목에 카테고리명이 반복돼도 중복 점수를 부풀리지 않게 한다.
  "art", "auto", "business", "culture", "fashion", "gaming", "humor", "life",
  "news", "politics", "realestate", "science", "sports", "tech"
]);

export function titleWords(title) {
  let t = String(title || "");
  if (!t) return [];
  for (let n = 0; n < 3 && LEAD_TAG.test(t); n++) t = t.replace(LEAD_TAG, "");
  t = t.replace(OUTLET_TAIL, "").replace(REVISION_TAIL, "");
  return [...new Set(t.toLowerCase().match(WORD_RE) || [])];
}

// 두 제목이 공유하는 내용어 수 — digest.js clusterIssues의 sharedTagCount와
// 같은 셈법을 제목 낱말에 적용한 것뿐이다.
export function sharedTitleWordCount(a, b) {
  const wa = titleWords(a);
  if (!wa.length) return 0;
  const wb = new Set(titleWords(b));
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n;
}

// 최종 지면의 제목 변주는 조사·활용형 때문에 같은 사건이어도 공통 낱말이 1개로
// 보일 수 있다. 반대로 영문 장문은 the/for/with 같은 불용어만 4개 이상 겹쳐
// 무관한 게임 기사까지 중복으로 사라졌다. 문단을 합치는 키에는 쓰지 않고,
// 최종 대표 이슈를 하나만 남기는 보수적 근접중복 단계에서만 사용한다.
export function titleConcepts(title) {
  const concepts = titleWords(title).map((word) => {
    if (GENERIC_NEWS_WORDS.has(word)) return null;
    if (/^[a-z]+$/.test(word)) return ENGLISH_STOP_WORDS.has(word) ? null : word;
    const compactNumber = /^\d/.test(word)
      ? word.replace(/(?:명|건|원)?(?:에|에서|까지|부터|으로)?$/u, "")
      : word;
    const koreanUnit = compactNumber.match(/^(\d+)만(?:(\d+)(천)?)?$/u);
    if (koreanUnit) {
      const tail = Number(koreanUnit[2] || 0) * (koreanUnit[3] ? 1000 : 1);
      return `num:${Number(koreanUnit[1]) * 10000 + tail}`;
    }
    const largeKoreanUnit = compactNumber.match(/^(\d+(?:\.\d+)?)(억|조)$/u);
    if (largeKoreanUnit) {
      return `num:${Number(largeKoreanUnit[1]) * (largeKoreanUnit[2] === "조" ? 1e12 : 1e8)}`;
    }
    if (/^\d{3,}$/.test(compactNumber)) return `num:${Number(compactNumber)}`;
    if (!/^[가-힣]+$/.test(word)) return word;
    let normalized = word;
    if (normalized.length >= 3) {
      normalized = normalized
        .replace(/(?:으로|에서|에게|까지|부터|처럼|보다|마다|이나|에|가|이|은|는|을|를|의|와|과|도|만)$/u, "")
        .replace(/(?:하라|해야)$/u, "");
    }
    if (normalized.length < 2) normalized = word;
    if (normalized === "강진" || normalized === "대지진") normalized = "지진";
    return GENERIC_NEWS_WORDS.has(normalized) ? null : normalized;
  }).filter(Boolean);
  return [...new Set(concepts)];
}

function sameTitleConcept(a, b) {
  if (a === b) return true;
  const korean = /^[가-힣]+$/.test(a) && /^[가-힣]+$/.test(b);
  const minLength = Math.min(a.length, b.length);
  if (minLength < (korean ? 2 : 3)) return false;
  return a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a);
}

export function sharedTitleConcepts(a, b) {
  const left = titleConcepts(a);
  const right = titleConcepts(b);
  const used = new Set();
  const shared = [];
  for (const concept of left) {
    const match = right.findIndex((candidate, index) =>
      !used.has(index) && sameTitleConcept(concept, candidate));
    if (match < 0) continue;
    used.add(match);
    shared.push(concept.length <= right[match].length ? concept : right[match]);
  }
  return shared;
}

export const sharedTitleConceptCount = (a, b) => sharedTitleConcepts(a, b).length;
