// 제목에서 내용 태그를 뽑는다.
//
// 왜 필요한가 (David 2026-08-02): "좋아요 싫어요가 해당 카테고리에 대한 의견이
// 라기보다는 내용에 대한 의견으로 투영될 수 있게."
//
// 그런데 라이브 실측(2026-08-02, 30건)에서 **아이템의 tags가 전부 비어 있었다.**
// 어댑터가 tags를 주는 소스가 하나도 없다. 내용 수준의 특징이 아예 없으니
// 좋아요는 카테고리·소스 가중치로밖에 갈 곳이 없었고, 그래서 자동차 글 하나에
// 좋아요를 누르면 그게 곧 "자동차 카테고리 선언"이 됐다.
//
// ── 설계 (제약: 형태소 분석기 없음, npm 없음, 아이템당 LLM 호출 없음)
// 사전 매칭 + 영숫자 토큰만 쓴다. 조사·어미를 임의로 떼는 휴리스틱은 넣지
// 않는다 — "블랙베리가"에서 "가"를 떼는 규칙은 "생각가"·"소나가" 같은 오작동을
// 만들고, 그렇게 생긴 쓰레기 태그는 취향 벡터에 그대로 쌓인다. 사전은 이미
// classify.js가 유지하고 있으므로 태그와 분류가 같은 어휘를 공유하게 된다
// (한쪽을 고치면 다른 쪽도 같이 좋아진다).
//
// 커버리지가 100%일 필요는 없다. 태그가 하나라도 붙은 글에서는 좋아요가 내용
// 쪽으로 흐르고, 안 붙은 글에서는 예전처럼 소스·카테고리로 흐를 뿐이다.
import { AUTO_KEYWORDS, CATEGORY_KEYWORDS } from "./classify.js";
import { POLITICS_KEYWORDS } from "./topics.js";

// 긴 표현을 먼저 본다 — "전기차 충전"이 있으면 "전기차"로 중복 태그하지 않는다.
const DICT = [...new Set([
  ...AUTO_KEYWORDS,
  ...CATEGORY_KEYWORDS.flatMap(([, words]) => words),
  ...POLITICS_KEYWORDS
])]
  .map((w) => String(w).trim())
  .filter((w) => w.length >= 2)
  .sort((a, b) => b.length - a.length);

// 영숫자 토큰에서 걸러낼 것 — 흔한 기능어와 단위. 고유명사만 남기는 게 목적이다.
// 2026-08-04 검수 실측: /keywords 상위가 open · source · code · more · what ·
// its · own · week 로 채워져 있었다. "화제 키워드"라는 이름의 페이지 절반이
// 영어 기능어면 그 페이지를 한 번 본 사용자는 다시 오지 않는다. 목록이 짧아
// 못 걸렀던 것이라, 실제로 올라온 것들을 넣어 넓혔다.
const LATIN_STOP = new Set([
  // 관사·대명사·전치사·접속사
  "the", "and", "for", "with", "you", "your", "その", "from", "this", "that",
  "these", "those", "they", "them", "their", "its", "our", "own", "out", "off",
  "into", "onto", "over", "under", "about", "after", "before", "between",
  "but", "nor", "yet", "than", "then", "when", "what", "where", "which", "while",
  "who", "whom", "whose", "why", "how", "here", "there", "any", "some", "each",
  "more", "most", "less", "least", "much", "many", "very", "just", "only",
  "also", "still", "even", "ever", "never", "always", "again", "once",
  // be동사·조동사·흔한 동사
  "are", "was", "were", "been", "being", "has", "had", "have", "having",
  "does", "did", "done", "can", "could", "will", "would", "should", "may",
  "might", "must", "get", "got", "make", "made", "making", "use", "used",
  "using", "like", "want", "need", "know", "think", "take", "give", "come",
  "look", "find", "work", "works", "say", "says", "said", "let", "put", "try",
  // 흔한 명사·형용사 — 그 자체로는 화제를 특정하지 못한다
  "new", "old", "good", "best", "bad", "big", "small", "long", "short",
  "next", "last", "first", "top", "day", "days", "week", "weeks", "month",
  "year", "years", "time", "times", "way", "ways", "thing", "things",
  "people", "one", "two", "not", "all", "his", "her", "him", "she", "hers",
  // 개발·기술 문맥에서 너무 흔해 신호가 없는 것들
  "open", "source", "code", "app", "apps", "web", "site", "data", "file",
  "files", "post", "posts", "show", "ask", "help", "guide", "part",
  // 단위·확장자·프로토콜
  "kg", "cm", "mm", "km", "ml", "gb", "mb", "kb", "hz", "vs", "etc", "jpg",
  "png", "gif", "mp4", "amp", "http", "https", "www", "com", "net", "org"
]);

// 두 글자여도 내용 신호가 분명한 것들 — 이 목록에 없는 두 글자는 버린다.
const SHORT_ALLOW = new Set([
  "ai", "ui", "ux", "vr", "ar", "ev", "tv", "pc", "os", "ip",
  "5g", "6g", "ps", "xr", "gm", "bj", "mz"
]);

export const MAX_TAGS = 8;

function dictionaryIndex(text, word) {
  const needle = word.toLowerCase();
  let idx = text.indexOf(needle);
  while (idx >= 0) {
    if (!/^[a-z0-9]+$/.test(needle)) return idx;
    const before = idx > 0 ? text[idx - 1] : "";
    const after = text[idx + needle.length] || "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return idx;
    idx = text.indexOf(needle, idx + 1);
  }
  return -1;
}

export function extractTags(title) {
  const t = String(title || "");
  if (!t) return [];
  const lower = t.toLowerCase();
  const out = [];
  const claimed = []; // [start, end) — 이미 태그로 잡힌 구간

  const overlaps = (s, e) => claimed.some(([cs, ce]) => s < ce && e > cs);

  for (const w of DICT) {
    const idx = dictionaryIndex(lower, w);
    if (idx < 0) continue;
    const end = idx + w.length;
    if (overlaps(idx, end)) continue; // 더 긴 표현에 이미 포함됨
    claimed.push([idx, end]);
    out.push(w.trim());
    if (out.length >= MAX_TAGS) return out;
  }

  // 영숫자 고유명사 (erp, chatgpt, nvidia, rtx …). 한글 사전이 못 잡는
  // 제품·기술 이름이 여기서 잡힌다.
  //
  // 두 글자는 화이트리스트로만 받는다. 라이브 실측(2026-08-02)에서
  // "'LJ와 이혼' 이선정" 제목이 태그 ["lj"]를 만들었다 — 사람 이니셜·약칭이
  // 그대로 취향 벡터에 쌓이면 아무 의미 없는 특징이 영구히 남는다. 그렇다고
  // 두 글자를 통째로 버리면 "ai"·"ev" 같은 진짜 신호를 잃는다.
  for (const m of lower.match(/[a-z][a-z0-9]{1,15}/g) || []) {
    if (LATIN_STOP.has(m)) continue;
    if (m.length === 2 && !SHORT_ALLOW.has(m)) continue;
    if (out.some((x) => x.toLowerCase() === m)) continue;
    out.push(m);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
