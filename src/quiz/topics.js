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

// 대중성 신호 — David 실사용 피드백(2026-07-25): 퀴즈가 커뮤니티 내부자
// 전보체로 나온다는 지적. 제목을 공백으로 쪼개 2자+ 어절만 토큰으로 본다
// (gates.js의 topicTokens와 같은 규칙, 이 파일은 독립 구현 — topics.js가
// gates.js를 임포트하면 역방향 의존이 생긴다).
function titleTokens(title) {
  const tokens = [];
  for (const raw of String(title || "").split(/\s+/)) {
    const cleaned = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (cleaned.length >= 2) tokens.push(cleaned);
  }
  return tokens;
}

// 후보 하나가 "다른 출처"의 제목과 핵심 토큰 2개 이상을 공유하면, 같은
// 이슈가 여러 커뮤니티에서 동시에 화제라는 뜻 — 대중성 신호로 본다.
// 결정적·O(n²)(후보 수가 작아 문제없음).
function hasCrossSourceSignal(candidate, all) {
  const tokens = new Set(titleTokens(candidate.title));
  if (tokens.size === 0) return false;
  for (const other of all) {
    if (other === candidate || other.source === candidate.source) continue;
    let overlap = 0;
    for (const tok of titleTokens(other.title)) {
      if (tokens.has(tok)) overlap++;
    }
    if (overlap >= 2) return true;
  }
  return false;
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
//
// David 실사용 피드백(2026-07-25): 위 캡은 "한 게시판이 독점"만 막을 뿐,
// "여러 출처에 다 있어도 사실 한 커뮤니티 내부자만 아는 소재"는 못 거른다.
// 그래서 ① 다른 출처 제목과 핵심 토큰이 2개+ 겹치는 후보(= 여러 커뮤니티에서
// 동시에 화제, 대중성 신호)에 hotness 가산점(cross_source_bonus)을 주고,
// ② 그런 신호가 없는(단일 커뮤 내수) 후보는 최종 선정에서
// max_single_source_topics개로 별도 캡을 건다(역시 후보 부족 시에만 완화).
export function pickWeeklyTopics(items, opts = {}) {
  const count = opts.count || CONTRACT.checks.topics.count;
  const maxPerSource = opts.maxPerSource || CONTRACT.checks.topics.max_per_source;
  const crossSourceBonus = opts.crossSourceBonus ?? CONTRACT.checks.topics.cross_source_bonus ?? 0;
  const maxSingleSourceTopics = opts.maxSingleSourceTopics || CONTRACT.checks.topics.max_single_source_topics;
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

  // 대중성 신호 + 가산점 — 랭킹은 항상 이 조정된 점수(score)로 이뤄진다.
  for (const c of candidates) {
    c.crossSourceSignal = hasCrossSourceSignal(c, candidates);
    if (c.crossSourceSignal && crossSourceBonus) c.score += crossSourceBonus;
  }
  candidates.sort((a, b) => b.score - a.score);

  if (!maxPerSource && !maxSingleSourceTopics) {
    return candidates.slice(0, count).map(stripInternal);
  }

  const selected = [];
  const overflow = [];
  const perSourceCount = {};
  let singleSourceCount = 0;
  for (const c of candidates) {
    if (selected.length >= count) break;
    const srcCount = perSourceCount[c.source] || 0;
    const overSourceCap = maxPerSource && srcCount >= maxPerSource;
    const overSingleSourceCap = maxSingleSourceTopics && !c.crossSourceSignal && singleSourceCount >= maxSingleSourceTopics;
    if (overSourceCap || overSingleSourceCap) {
      overflow.push(c); // 캡 초과분 — 개수가 모자랄 때만 채움용으로 재사용
      continue;
    }
    selected.push(c);
    perSourceCount[c.source] = srcCount + 1;
    if (!c.crossSourceSignal) singleSourceCount++;
  }
  for (const c of overflow) {
    if (selected.length >= count) break;
    selected.push(c); // 후보 부족 시에만 캡 초과 허용 (실패 대신 채움)
  }
  return selected.map(stripInternal);
}

function stripInternal(c) {
  const { title, url, source, score } = c;
  return { title, url, source, score };
}
