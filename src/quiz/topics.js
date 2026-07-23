// Weekly hot-topic selection for the viral quiz pipeline.
//
// Input is the same normalized item shape the feed already produces
// ({title, url, sourceId/source, score, commentCount, publishedAt}), so the
// pipeline can be fed straight from the community fetchers or from a JSON
// dump. Ranking reuses ingest.js's hotness() — public engagement signals
// only, never copied content.
//
// 브랜드 세이프티: 유형테스트는 광고 지면과 SNS 공유가 목적이라, 기존 토픽
// 분류기(politics/religion/adult)에 걸리는 항목은 소재에서 제외한다 — 논란
// 소재로 만든 테스트는 광고 계정 정지 리스크가 있다.

import { classifyTopics } from "../feed/topics.js";
import { hotness } from "../feed/ingest.js";

export const EXCLUDED_TOPICS = new Set(["politics", "religion", "adult"]);

function isBrandSafe(item) {
  const topics = classifyTopics({
    title: item.title,
    url: item.url,
    sourceId: item.sourceId || item.source
  });
  return !topics.some((t) => EXCLUDED_TOPICS.has(t)) && item.adult !== true;
}

// Pick the week's top quiz-worthy topics: brand-safe, deduplicated by title,
// ranked by engagement hotness. Returns [{title, url, source, score}].
export function pickWeeklyTopics(items, opts = {}) {
  const count = opts.count || 5;
  const now = opts.now || Date.now();

  const seen = new Set();
  const candidates = [];
  for (const item of Array.isArray(items) ? items : []) {
    const title = String(item.title || "").trim();
    if (!title || seen.has(title)) continue;
    if (!isBrandSafe(item)) continue;
    seen.add(title);
    candidates.push({
      title,
      url: item.url || null,
      source: item.sourceLabel || item.sourceId || item.source || "unknown",
      score: hotness(item, now)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count);
}
