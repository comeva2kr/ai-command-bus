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
const LATIN_STOP = new Set([
  "the", "and", "for", "with", "you", "your", "その", "from", "this", "that",
  "new", "how", "why", "not", "are", "was", "has", "his", "her", "who", "all",
  "kg", "cm", "mm", "km", "ml", "gb", "mb", "kb", "hz", "vs", "etc", "jpg",
  "png", "gif", "mp4", "amp", "http", "https", "www", "com", "net", "org"
]);

export const MAX_TAGS = 8;

export function extractTags(title) {
  const t = String(title || "");
  if (!t) return [];
  const lower = t.toLowerCase();
  const out = [];
  const claimed = []; // [start, end) — 이미 태그로 잡힌 구간

  const overlaps = (s, e) => claimed.some(([cs, ce]) => s < ce && e > cs);

  for (const w of DICT) {
    const idx = lower.indexOf(w.toLowerCase());
    if (idx < 0) continue;
    const end = idx + w.length;
    if (overlaps(idx, end)) continue; // 더 긴 표현에 이미 포함됨
    claimed.push([idx, end]);
    out.push(w.trim());
    if (out.length >= MAX_TAGS) return out;
  }

  // 영숫자 고유명사 (ai, erp, chatgpt, rtx, m5 …). 한글 사전이 못 잡는
  // 제품·기술 이름이 여기서 잡힌다.
  for (const m of lower.match(/[a-z][a-z0-9]{1,15}/g) || []) {
    if (LATIN_STOP.has(m)) continue;
    if (out.some((x) => x.toLowerCase() === m)) continue;
    out.push(m);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
