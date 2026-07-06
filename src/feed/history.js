// Warm-start taste inference from browsing history.
//
// Cold start is the weakest moment of any recommender. Before (or alongside)
// the survey, the user can hand over a lightweight browsing footprint — just
// visited domains and page titles, never full URLs or contents — and we infer
// an initial preference vector from it. This runs on the same signals the
// survey seeds (category / tag / source weights) so the two merge cleanly.
//
// Privacy posture: only host + title strings are needed. Nothing here fetches
// anything or stores raw history; callers pass in already-extracted entries.

import { emptyPreferenceVector } from "./survey.js";
import { isKnownCategory, isKnownTag } from "./taxonomy.js";

// Known community / outlet hosts → the source id + its home category. Matching
// is substring-based so "m.bobae.co.kr" and "www.bobae.co.kr/board" both hit.
const HOST_MAP = [
  { match: "bobae", source: "bobae", category: "auto" },
  { match: "getcha", source: "getcha", category: "auto" },
  { match: "encar", source: "encar", category: "auto" },
  { match: "clien", source: "clien", category: "tech" },
  { match: "ppomppu", source: "ppomppu", category: "business" },
  { match: "ruliweb", source: "ruliweb", category: "gaming" },
  { match: "inven", source: "inven", category: "gaming" },
  { match: "humoruniv", source: "humoruniv", category: "humor" },
  { match: "web.humoruniv", source: "humoruniv", category: "humor" },
  { match: "dcinside", source: "dcinside", category: "humor" },
  { match: "instiz", source: "instiz", category: "culture" },
  { match: "theqoo", source: "theqoo", category: "culture" },
  { match: "mlbpark", source: "mlbpark", category: "sports" },
  { match: "82cook", source: "82cook", category: "life" }
];

// Title keyword → { category?, tag? } signals. Korean + a few English terms.
const KEYWORD_MAP = [
  { words: ["시승", "신차", "자동차", "차량", "국산차", "수입차"], category: "auto", tag: "cars" },
  { words: ["시승기", "리뷰"], category: "auto", tag: "testdrive" },
  { words: ["전기차", "ev", "테슬라", "충전"], category: "auto", tag: "ev" },
  { words: ["중고차"], category: "auto", tag: "cars" },
  { words: ["바이크", "오토바이"], category: "auto", tag: "motorcycle" },
  { words: ["아이폰", "갤럭시", "폰", "스마트폰"], category: "tech", tag: "mobile" },
  { words: ["노트북", "cpu", "gpu", "그래픽카드", "조립"], category: "tech", tag: "hardware" },
  { words: ["ai", "인공지능", "gpt", "llm"], category: "tech", tag: "ai" },
  { words: ["개발", "코딩", "프로그래밍", "개발자"], category: "tech", tag: "programming" },
  { words: ["주식", "코스피", "증시"], category: "business", tag: "markets" },
  { words: ["코인", "비트코인", "암호화폐"], category: "business", tag: "crypto" },
  { words: ["부동산", "전세", "아파트"], category: "business", tag: "realestate" },
  { words: ["게임", "스팀", "플스", "롤", "lol"], category: "gaming", tag: "pc-gaming" },
  { words: ["e스포츠", "롤드컵", "결승"], category: "gaming", tag: "esports" },
  { words: ["축구", "손흥민", "epl"], category: "sports", tag: "football" },
  { words: ["야구", "kbo", "mlb"], category: "sports", tag: "baseball" },
  { words: ["농구", "nba"], category: "sports", tag: "basketball" },
  { words: ["드라마", "결말"], category: "culture", tag: "kdrama" },
  { words: ["영화", "개봉", "박스오피스"], category: "culture", tag: "movies" },
  { words: ["아이돌", "컴백", "직캠", "음방"], category: "culture", tag: "music" },
  { words: ["레시피", "요리", "맛집"], category: "life", tag: "food" },
  { words: ["여행", "여행기"], category: "life", tag: "travel" },
  { words: ["다이어트", "운동", "헬스"], category: "life", tag: "fitness" },
  { words: ["강아지", "고양이", "반려"], category: "life", tag: "pets" },
  { words: ["유머", "짤", "ㅋㅋ", "레전드", "썰"], category: "humor", tag: "meme" }
];

// Normalize a raw history entry into { host, title, weight }.
function normalizeEntry(entry) {
  if (typeof entry === "string") {
    // could be a bare url or a title; try to parse a host out of it
    const host = extractHost(entry);
    return { host, title: host ? "" : entry, weight: 1 };
  }
  const host = entry.host || extractHost(entry.url || "");
  return {
    host: host ? host.toLowerCase() : "",
    title: String(entry.title || "").toLowerCase(),
    weight: Number.isFinite(entry.count) ? Math.min(entry.count, 20) : 1
  };
}

function extractHost(str) {
  const s = String(str || "");
  const m = s.match(/^[a-z]+:\/\/([^/]+)/i) || s.match(/^([\w.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : "";
}

// Build a preference vector from browsing history entries.
// entries: Array<string | { url?, host?, title?, count? }>
export function inferFromHistory(entries) {
  const vec = emptyPreferenceVector();
  const hits = { sources: 0, keywords: 0 };
  if (!Array.isArray(entries)) return { vector: vec, hits, entriesSeen: 0 };

  for (const raw of entries) {
    const e = normalizeEntry(raw);
    const w = e.weight;

    // host → source + home category
    if (e.host) {
      for (const h of HOST_MAP) {
        if (e.host.includes(h.match)) {
          vec.sources[h.source] = (vec.sources[h.source] || 0) + 0.6 * w;
          vec.categories[h.category] = (vec.categories[h.category] || 0) + 0.4 * w;
          hits.sources += 1;
          break;
        }
      }
    }

    // title keywords → category + tag
    if (e.title) {
      for (const k of KEYWORD_MAP) {
        if (k.words.some((word) => e.title.includes(word))) {
          if (k.category) vec.categories[k.category] = (vec.categories[k.category] || 0) + 0.35 * w;
          if (k.tag) vec.tags[k.tag] = (vec.tags[k.tag] || 0) + 0.5 * w;
          hits.keywords += 1;
        }
      }
    }
  }

  // keep only sane, known features and cap magnitudes so a warm start never
  // fully overrides what the user later tells us explicitly
  prune(vec.categories, isKnownCategory, 3);
  prune(vec.tags, isKnownTag, 3);
  prune(vec.sources, () => true, 3);

  return { vector: vec, hits, entriesSeen: entries.length };
}

function prune(map, isValid, cap) {
  for (const key of Object.keys(map)) {
    if (!isValid(key)) {
      delete map[key];
      continue;
    }
    map[key] = Math.round(Math.min(map[key], cap) * 100) / 100;
  }
}

// Merge a warm-start vector into an existing one (survey may run after). Later
// explicit survey/feedback signals dominate because they use larger steps.
export function mergeVectors(base, add, scale = 1) {
  for (const field of ["categories", "tags", "sources"]) {
    for (const [k, v] of Object.entries(add[field] || {})) {
      base[field][k] = (base[field][k] || 0) + v * scale;
    }
  }
  if (add.prefs && typeof add.prefs.longform === "number") {
    base.prefs.longform = (base.prefs.longform || 0) + add.prefs.longform * scale;
  }
  return base;
}
