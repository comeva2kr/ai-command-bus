// Editorial notes: a short, one-line "왜 이게 여기 있는지" comment attached to
// each organic feed card.
//
// Two reasons this exists (docs/monetization.md has the full writeup):
//   1. Curation value — the note is a quick "이 피드, 보는 눈이 있다" signal
//      for the user, distinct from the algorithmic "추천 이유" (.why) chips.
//   2. AdSense eligibility — Google's ad-review rejects sites that just
//      republish other sites' content with no added value. A per-item
//      editorial rationale is exactly the "original commentary" that
//      satisfies that bar; see docs/monetization.md's new 편집POV section.
//
// HARD RULE: never fabricate or round up a number that isn't actually in the
// item's own data. Every digit this module prints must trace back to a real
// measured field (score, commentCount, sourceRank, publishedAt-derived age,
// or a multiplier genuinely computed from context stats) — inventing a
// number here is the same class of violation as this project's ban on fake
// social-proof counters on ad cards (see monetize.js's adMetaHtml). When the
// data is too thin to say anything honest, this returns "" — an empty note
// is strictly better than a plausible-sounding made-up one.

import { sourceLabel as lookupSourceLabel } from "./taxonomy.js";
import { loadRegistry } from "./registry.js";

// ---- tunable gates (heuristic, not measured signals themselves) -----------
// These only decide WHICH template fires; every number that ends up in the
// rendered text still comes straight from the item/context, never from here.
const SURGE_MAX_AGE_MIN = 24 * 60; // "급상승형" freshness window (24h)
const SURGE_SCORE_FLOOR = 300; // score/commentCount magnitude that reads as genuinely viral
const SURGE_COMMENT_FLOOR = 300;
const OUTLIER_MULTIPLE_MIN = 3; // "압도적 반응형" — item vs its source's own typical score
const OUTLIER_MIN_SAMPLE = 2; // need at least this many other same-source items to trust the average
const DEBATE_COMMENT_FLOOR = 30; // "댓글 폭발형"
const DEBATE_RATIO_MIN = 3; // commentCount must be at least this many times the score
const FRESH_MAX_AGE_MIN = 30; // "신선형" — just-published window

// Comma-group a plain integer, or collapse into Korean "만" units above
// 10,000 — e.g. 1300 -> "1,300", 90000 -> "9만", 132000 -> "13.2만". Only
// ever applied to a real number already present on the item; this rounds
// for readability, it never invents digits.
function formatCount(n) {
  const v = Math.max(0, Math.round(n));
  if (v >= 10000) {
    const man = v / 10000;
    const rounded = Math.round(man * 10) / 10;
    const manStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${manStr}만`;
  }
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Age in minutes since publishedAt, or null if there's no usable date —
// callers must treat null as "can't say anything about freshness", never as
// 0 (that would fabricate a "just now").
function ageMinutes(publishedAt, nowMs) {
  if (publishedAt == null) return null;
  const t = typeof publishedAt === "number" ? publishedAt : Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 60000);
}

function formatAgeShort(mins) {
  if (mins < 1) return "방금"; // "0분 전"은 어색 — 1분 미만은 그냥 방금
  if (mins < 60) return `${Math.round(mins)}분`;
  return `${Math.round(mins / 60)}시간`;
}

// 한글 소스명 우선 — taxonomy.js는 일부 소스만 커버하므로 communities.json의
// label(긱뉴스·아웃스탠딩·딴지일보 등)을 함께 본다. 셋 다 없을 때만 원 id로
// 폴백(영문 id가 편집 코멘트에 그대로 노출되면 기계적으로 읽힘 — David 2026-07-27).
let _registryLabels = null;
function registryLabel(sourceId) {
  if (_registryLabels === null) {
    _registryLabels = new Map();
    try {
      for (const c of loadRegistry()) {
        // labelKo("해커뉴스") 우선, 없으면 label("Hacker News")
        if (c && c.id && (c.labelKo || c.label)) _registryLabels.set(c.id, c.labelKo || c.label);
      }
    } catch {
      /* 레지스트리를 못 읽어도 라벨만 못 붙일 뿐, 코멘트 생성은 계속된다 */
    }
  }
  return _registryLabels.get(sourceId) || null;
}
function labelFor(item) {
  // taxonomy.sourceLabel()은 모르는 소스에 id를 그대로 돌려주므로(빈 값이 아님)
  // 그 결과가 id와 같으면 "못 찾은 것"으로 보고 레지스트리를 본다 — 안 그러면
  // 편집 코멘트에 "hackernews", "inven_hot" 같은 원 id가 노출된다.
  const taxo = lookupSourceLabel(item.source);
  const taxoUsable = taxo && taxo !== item.source ? taxo : null;
  return item.sourceLabel || taxoUsable || registryLabel(item.source) || item.source || "이 소스";
}

// Build the one-line editorial note. `context` is optional, engine.js-supplied
// extra data (currently: `now` — ms clock; `sourceStats` — { mean, median,
// count } of `score` across this item's own source's current pool, for the
// outlier template). Missing context just disables the templates that need
// it; every other template still works off the item alone.
export function buildEditorialNote(item, context = {}) {
  if (!item) return "";
  // Affiliate/ad cards get their own separate reason/disclosure UI — never
  // an editorial note (defense-in-depth; in practice ad/slot items are built
  // by monetize.js and never routed through this function at all, see
  // engine.js's _decorate).
  if (item.kind === "affiliate" || item.kind === "ad") return "";

  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const score = Number.isFinite(item.score) ? item.score : 0;
  const commentCount = Number.isFinite(item.commentCount) ? item.commentCount : 0;
  const mins = ageMinutes(item.publishedAt, now);
  const label = labelFor(item);

  // 1. 급상승형 — fresh AND a genuinely large, real number.
  if (mins != null && mins <= SURGE_MAX_AGE_MIN && (score >= SURGE_SCORE_FLOOR || commentCount >= SURGE_COMMENT_FLOOR)) {
    const bits = [];
    if (score >= SURGE_SCORE_FLOOR) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount >= SURGE_COMMENT_FLOOR) bits.push(`댓글 ${formatCount(commentCount)}`);
    const timeText = mins <= 60 ? `${Math.round(mins)}분 만에` : `${formatAgeShort(mins)} 만에`;
    return `${label}에서 ${timeText} ${bits.join("·")}`;
  }

  // 2. 압도적 반응형 — this item's score vs the mean score of other items
  // from the same source right now (context.sourceStats, computed by
  // engine.js over the full collected pool). The stated multiple is always
  // `score / stats.mean`, rounded for display — never a hardcoded ratio.
  const stats = context.sourceStats;
  if (stats && Number.isFinite(stats.mean) && stats.mean > 0 && stats.count >= OUTLIER_MIN_SAMPLE && score > 0) {
    const multiple = score / stats.mean;
    if (multiple >= OUTLIER_MULTIPLE_MIN) {
      const rounded = Math.round(multiple * 10) / 10;
      const mStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${label}, 평소보다 반응 ${mStr}배 — 추천 ${formatCount(score)}`;
    }
  }

  // 3. 게시판 1위형 — sourceRank is 0-based; 0 means "this source's own #1
  // right now (see content.js's normalizeItem / ingest.js's rankBySource).
  //
  // 단, 홈 피드는 라운드로빈이라 "각 소스의 1위"가 대거 올라온다 — 조건 없이
  // 쓰면 카드 대부분이 똑같이 "○○ 베스트 1위"가 돼 편집 코멘트가 기계적으로
  // 읽힌다(David 2026-07-27 실측: 20건 중 13건 동일 문구). 그래서 **실제 반응
  // 수치가 함께 있을 때만** 쓰고, 수치를 같이 노출해 문구를 서로 다르게 만든다.
  // 지표가 없는 RSS 소스(1위여도 추천/댓글이 0)는 이 템플릿을 건너뛰고 아래
  // 신선형/번역형으로 흐르거나, 아무것도 없으면 빈 문자열이 된다(억지 금지).
  if (Number.isFinite(item.sourceRank) && item.sourceRank === 0 && (score > 0 || commentCount > 0)) {
    const bits = [];
    if (score > 0) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount > 0) bits.push(`댓글 ${formatCount(commentCount)}`);
    return `${label} 지금 1위 — ${bits.join("·")}`;
  }

  // 4. 댓글 폭발형 — comment volume clearly outpacing the score, regardless
  // of age (an old-but-still-arguing thread is still a real signal).
  if (commentCount >= DEBATE_COMMENT_FLOOR && commentCount >= score * DEBATE_RATIO_MIN) {
    return `댓글 ${formatCount(commentCount)}개 — 논쟁 중`;
  }

  // 5. 신선형 — just published, with some (even modest) real early traction.
  if (mins != null && mins <= FRESH_MAX_AGE_MIN && (score > 0 || commentCount > 0)) {
    const bits = [];
    if (score > 0) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount > 0) bits.push(`댓글 ${formatCount(commentCount)}`);
    return `${Math.round(mins)}분 전 올라와 벌써 ${bits.join("·")}`;
  }

  // 6. 번역/해외형 — item.translated is only ever set true by translate.js
  // once a real machine translation actually ran (see TranslatingSource).
  if (item.translated === true) {
    return score > 0 ? `${label} ${formatCount(score)}점, 한글로 옮겨왔어요` : `${label}, 한글로 옮겨왔어요`;
  }

  // 7. 갓 올라온 게시판 상위글 — 추천/댓글 지표를 아예 제공하지 않는 RSS 소스는
  // 위 템플릿이 전부 비껴간다. 그래도 "그 게시판 상단에 방금 올라왔다"는 것은
  // 실측(sourceRank + publishedAt)이므로 수치를 지어내지 않고 그대로 쓴다.
  if (Number.isFinite(item.sourceRank) && item.sourceRank <= 2 && mins != null && mins <= FRESH_MAX_AGE_MIN) {
    const age = formatAgeShort(mins);
    return age === "방금" ? `${label}에 방금 올라온 상단 글` : `${label}에 ${age} 전 올라온 상단 글`;
  }

  // Data too thin to say anything honest — no filler sentence.
  return "";
}
