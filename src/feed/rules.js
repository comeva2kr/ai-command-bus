// Community governance: rules that hold *inside this space*.
//
// As a space grows its own norms, standards, and levels make sense. This module
// centralizes them: post/comment validation (length, banned words, tag limits),
// rate limiting, per-category norms, and a participation-driven level system
// that unlocks capabilities as a member contributes more. It's data-first so a
// space can tune its own rulebook without touching the engine.

export const DEFAULT_RULES = {
  post: {
    titleMin: 2,
    titleMax: 120,
    bodyMax: 2000,
    maxTags: 8,
    perWindow: 5, // max posts per window
    windowMs: 10 * 60 * 1000 // 10 minutes
  },
  comment: {
    bodyMin: 1,
    bodyMax: 1000,
    perWindow: 20,
    windowMs: 10 * 60 * 1000
  },
  // 유저 링크 제출 (via: "submit"): looser than posting since it's just a link +
  // optional note, but still capped so one user can't spam the shared pool.
  submit: {
    perWindow: 5,
    windowMs: 10 * 60 * 1000
  },
  // words that are blocked space-wide (kept deliberately small/illustrative)
  bannedWords: ["광고문의", "도박사이트", "불법", "스팸홍보"],
  // per-category posting norms surfaced to the composer (advisory, not blocking)
  categoryNorms: {
    auto: "시승기·후기는 실사용 정보(연비/승차감 등)를 함께 적어주세요.",
    news: "출처 링크를 함께 남겨주세요.",
    humor: "타인을 특정해 비하하는 내용은 삭제될 수 있어요.",
    business: "투자 권유·리딩방 홍보는 금지입니다."
  }
};

// Participation-driven levels. Score blends posts, comments, and likes received.
// Higher levels earn perks — the "이용자가 늘수록 통용되는 규격/룰"이 자라는 축.
export const LEVELS = [
  { level: 0, title: "새싹", min: 0, perks: ["read", "comment", "post"] },
  { level: 1, title: "이웃", min: 10, perks: ["read", "comment", "post", "createTags"] },
  { level: 2, title: "단골", min: 40, perks: ["read", "comment", "post", "createTags", "flag"] },
  { level: 3, title: "터줏대감", min: 120, perks: ["read", "comment", "post", "createTags", "flag", "moderate"] }
];

export function participationScore(counts = {}) {
  const posts = counts.posts || 0;
  const comments = counts.comments || 0;
  const likesReceived = counts.likesReceived || 0;
  return posts * 5 + comments * 2 + likesReceived * 1;
}

export function userLevel(counts = {}) {
  const score = participationScore(counts);
  let current = LEVELS[0];
  for (const l of LEVELS) if (score >= l.min) current = l;
  const next = LEVELS.find((l) => l.min > score) || null;
  return {
    level: current.level,
    title: current.title,
    perks: current.perks,
    score,
    nextAt: next ? next.min : null,
    toNext: next ? next.min - score : 0
  };
}

export function can(counts, perk) {
  return userLevel(counts).perks.includes(perk);
}

function hasBanned(text, banned) {
  const t = String(text || "");
  return banned.find((w) => t.includes(w)) || null;
}

// Validate a post against the rulebook. `ctx.recentPosts` = count in the window
// (for rate limiting), `rules` overrides DEFAULT_RULES.post.
export function validatePost(post, ctx = {}, rules = DEFAULT_RULES) {
  const r = rules.post;
  const errors = [];
  const title = String(post.title || "").trim();
  if (title.length < r.titleMin) errors.push(`제목은 ${r.titleMin}자 이상이어야 해요.`);
  if (title.length > r.titleMax) errors.push(`제목은 ${r.titleMax}자 이하여야 해요.`);
  if (String(post.summary || "").length > r.bodyMax) errors.push(`본문은 ${r.bodyMax}자 이하여야 해요.`);
  if (Array.isArray(post.tags) && post.tags.length > r.maxTags) errors.push(`태그는 최대 ${r.maxTags}개예요.`);

  const banned = hasBanned(title + " " + (post.summary || ""), rules.bannedWords);
  if (banned) errors.push(`금지어가 포함되어 있어요: "${banned}"`);

  let rateLimited = false;
  if ((ctx.recentPosts || 0) >= r.perWindow) {
    rateLimited = true;
    errors.push(`잠시 후에 다시 올려주세요. (${r.windowMs / 60000}분에 ${r.perWindow}개까지)`);
  }
  return { ok: errors.length === 0, errors, rateLimited, norm: rules.categoryNorms[post.category] || null };
}

export function validateComment(body, ctx = {}, rules = DEFAULT_RULES) {
  const r = rules.comment;
  const errors = [];
  const text = String(body || "").trim();
  if (text.length < r.bodyMin) errors.push("댓글 내용을 입력해주세요.");
  if (text.length > r.bodyMax) errors.push(`댓글은 ${r.bodyMax}자 이하여야 해요.`);
  const banned = hasBanned(text, rules.bannedWords);
  if (banned) errors.push(`금지어가 포함되어 있어요: "${banned}"`);
  let rateLimited = false;
  if ((ctx.recentComments || 0) >= r.perWindow) {
    rateLimited = true;
    errors.push("댓글을 너무 빨리 달고 있어요. 잠시 후 다시 시도해주세요.");
  }
  return { ok: errors.length === 0, errors, rateLimited };
}
