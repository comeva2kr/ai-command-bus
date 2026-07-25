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
//
// 8팀 적대 검수 반영: 실존인물 사생활(열애·결별 등)·재난공포 소재는 기존
// politics/religion/adult 분류기로는 안 걸리지만 광고 지면 정책 리스크가
// 동일하게 있다 — 매니페스트 topic_safety 키워드로 제목을 직접 매칭해
// 제외한다 (pack_contract.checks.topic_safety).

import { classifyTopics } from "../feed/topics.js";
import { hotness } from "../feed/ingest.js";
import { CONTRACT } from "./manifest.js";

// QG0 제외 토픽 — 선언 원본은 매니페스트 (pack_contract.excluded_topics).
export const EXCLUDED_TOPICS = new Set(CONTRACT.excluded_topics);

// QG0 소재 세이프티 키워드 — 선언 원본은 매니페스트 (pack_contract.checks.topic_safety).
const TOPIC_SAFETY = CONTRACT.checks.topic_safety || {};
const UNSAFE_TITLE_KEYWORDS = [
  ...(TOPIC_SAFETY.celebrity_private_life || []),
  ...(TOPIC_SAFETY.fear_disaster || [])
];

// 한국어 대중 퀴즈 소재 조건: 제목에 한글이 최소 N자 있어야 한다 — 출처
// 다양화 캡이 hackernews 같은 영문 소스를 끌어올릴 때, 영문 제목이 그대로
// 문항·결과에 인용되는 것을 막는다 (선언 원본: checks.topics.hangul_chars_min).
const HANGUL_CHARS_MIN = CONTRACT.checks.topics.hangul_chars_min || 0;

function hangulCount(s) {
  const m = String(s || "").match(/[가-힣]/g);
  return m ? m.length : 0;
}

function isBrandSafe(item) {
  const topics = classifyTopics({
    title: item.title,
    url: item.url,
    sourceId: item.sourceId || item.source
  });
  if (topics.some((t) => EXCLUDED_TOPICS.has(t)) || item.adult === true) return false;
  const title = String(item.title || "");
  if (UNSAFE_TITLE_KEYWORDS.some((kw) => title.includes(kw))) return false;
  if (hangulCount(title) < HANGUL_CHARS_MIN) return false;
  return true;
}

// Pick the week's top quiz-worthy topics: brand-safe, deduplicated by title,
// ranked by engagement hotness. Returns [{title, url, source, score}].
//
// 2차 적대 검수(v3): theqoo 같은 단일 출처 편중을 막기 위해 출처(source)당
// 최대 max_per_source개로 캡을 건다 — 단, 캡 때문에 요청 개수(count)를 못
// 채우면 실패 대신 캡을 넘겨서라도 채운다(개수 보장이 편중 방지보다 우선).
export function pickWeeklyTopics(items, opts = {}) {
  const count = opts.count || CONTRACT.checks.topics.count;
  const maxPerSource = opts.maxPerSource || CONTRACT.checks.topics.max_per_source;
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

  if (!maxPerSource) return candidates.slice(0, count);

  const selected = [];
  const overflow = [];
  const perSourceCount = {};
  for (const c of candidates) {
    if (selected.length >= count) break;
    const n = perSourceCount[c.source] || 0;
    if (n >= maxPerSource) {
      overflow.push(c); // 캡 초과분 — 개수가 모자랄 때만 채움용으로 재사용
      continue;
    }
    selected.push(c);
    perSourceCount[c.source] = n + 1;
  }
  for (const c of overflow) {
    if (selected.length >= count) break;
    selected.push(c); // 후보 부족 시에만 캡 초과 허용 (실패 대신 채움)
  }
  return selected;
}
