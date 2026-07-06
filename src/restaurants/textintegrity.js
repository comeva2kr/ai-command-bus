// Text-integrity signals: near-duplicate/templated reviews and AI-generated
// text. These activate only when reviews carry actual `text`; otherwise they
// return nulls and have no effect (backward compatible).
//
//   • Near-duplicate detection — copy-paste "template" reviews across accounts
//     are a classic spam tell. We shingle each review into word 3-grams and
//     cluster by Jaccard similarity (a lightweight MinHash-free approximation).
//   • AI-generated detection — LLM-written reviews are fluent but generic and
//     detail-poor. Real detectors use perplexity/burstiness; here we consume an
//     upstream detector's per-review `ai` probability when present, and fall
//     back to a transparent heuristic (generic superlatives, no concrete detail,
//     uniform "fluent" length). See Ott et al. (ACL'11) for why text alone is
//     weak — this is a corroborating signal, not a sole judge.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text, k = 3) {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length < k) return new Set(words);
  const out = new Set();
  for (let i = 0; i <= words.length - k; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Generic-superlative / detail-poor heuristic for AI or template text (0..1).
const GENERIC_TOKENS = [
  "정말", "너무", "최고", "강추", "분위기", "맛있", "완벽", "인생", "친절", "만족",
  "amazing", "perfect", "delicious", "great", "wonderful", "highly recommend"
];
function aiHeuristic(text) {
  const norm = normalize(text);
  const words = norm.split(" ").filter(Boolean);
  if (words.length === 0) return 0.5;
  const generic = GENERIC_TOKENS.filter((t) => norm.includes(t)).length;
  const hasNumbers = /\d/.test(text); // concrete detail (price, count, time)
  const genericDensity = clamp01(generic / 4);
  // Fluent-but-generic: many superlatives, no concrete numbers, mid length.
  let score = 0.25 + genericDensity * 0.5 - (hasNumbers ? 0.25 : 0);
  if (words.length >= 25 && words.length <= 80) score += 0.15; // uniform "essay" length
  return clamp01(score);
}

// Compute duplication + AI ratios over a set of reviews (pass organic reviews).
export function textIntegrity(reviews) {
  const withText = reviews.filter((r) => r.text);
  if (withText.length < 2) return { hasText: false, duplicationRatio: 0, aiRatio: 0 };

  // Near-duplicate clustering via pairwise Jaccard (small N).
  const sh = withText.map((r) => shingles(r.text));
  const dup = new Array(withText.length).fill(false);
  for (let i = 0; i < withText.length; i++) {
    for (let j = i + 1; j < withText.length; j++) {
      if (jaccard(sh[i], sh[j]) >= 0.8) { dup[i] = true; dup[j] = true; }
    }
  }
  const duplicationRatio = dup.filter(Boolean).length / withText.length;

  const aiScores = withText.map((r) =>
    typeof r.ai === "number" ? clamp01(r.ai) : aiHeuristic(r.text)
  );
  const aiRatio = aiScores.filter((s) => s >= 0.6).length / withText.length;

  return {
    hasText: true,
    duplicationRatio: Number(duplicationRatio.toFixed(2)),
    aiRatio: Number(aiRatio.toFixed(2))
  };
}

export default textIntegrity;
