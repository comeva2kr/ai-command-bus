// Onboarding survey.
//
// The survey is the cold-start entry point: the user answers a handful of
// questions and we translate the answers into an initial preference vector
// (category weights + tag weights). From there the recommender takes over and
// refines those weights from like/dislike feedback.

import { CATEGORIES, TAGS } from "./taxonomy.js";
import { loadRegistry } from "./registry.js";

// "즐겨 보는 커뮤니티" 설문 옵션 = 실제 enabled && non-seed 소스만 (David 2026-07-24
// 적대적 검수 #6). 이전엔 taxonomy.js의 정적 SOURCE_CATALOG(디시인사이드·겟차·엔카·
// 테크와이어 등 15개 seed 더미 포함, 대부분 프로덕션에서 라이브 수집이 전혀 안 되는
// 소스)를 그대로 썼음 — 유저가 온보딩에서 고른 소스가 실제로는 죽은 소스일 수 있었다.
// communities.json이 진실의 원천이므로 매 프로세스 시작 시(모듈 로드 시점) 여기서
// 필터링해 옵션을 만든다: enabled=true이고 adapter.type이 "seed"(개발용 더미, FEED_DEV
// 전용)가 아닌 실 소스만.
function liveSourceOptions() {
  return loadRegistry()
    .filter((c) => c.enabled === true && (!c.adapter || c.adapter.type !== "seed"))
    .map((c) => ({ id: c.id, label: c.labelKo || c.label }));
}

// Each question maps user choices to weight deltas. `multi` questions accept an
// array of selected option ids; single questions accept one option id.
export const SURVEY = [
  {
    id: "categories",
    type: "multi",
    prompt: "관심 있는 주제를 모두 골라주세요.",
    // options generated from the category taxonomy so the two never drift apart
    options: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    // selecting a category seeds that category weight
    apply(selected, vec) {
      for (const id of selected) {
        vec.categories[id] = (vec.categories[id] || 0) + 1.0;
      }
    }
  },
  {
    id: "depth",
    type: "single",
    prompt: "어떤 글을 더 보고 싶으세요?",
    options: [
      { id: "deep", label: "깊이 있는 분석/롱폼" },
      { id: "quick", label: "짧고 가벼운 소식" },
      { id: "mixed", label: "둘 다 골고루" }
    ],
    apply(choice, vec) {
      if (choice === "deep") vec.prefs.longform = 1;
      else if (choice === "quick") vec.prefs.longform = -1;
      else vec.prefs.longform = 0;
    }
  },
  {
    id: "tone",
    type: "single",
    prompt: "분위기는 어느 쪽이 좋으세요?",
    options: [
      { id: "serious", label: "진지하고 정보 위주" },
      { id: "fun", label: "유머와 가벼움 위주" },
      { id: "balanced", label: "균형 있게" }
    ],
    apply(choice, vec) {
      if (choice === "fun") {
        vec.categories.humor = (vec.categories.humor || 0) + 0.8;
        vec.tags.meme = (vec.tags.meme || 0) + 0.6;
      } else if (choice === "serious") {
        vec.categories.humor = (vec.categories.humor || 0) - 0.5;
      }
    }
  },
  {
    id: "communities",
    type: "multi",
    prompt: "즐겨 보는 커뮤니티가 있나요? 인기글을 우선 챙겨드려요. (선택)",
    options: liveSourceOptions(),
    apply(selected, vec) {
      for (const id of selected) {
        vec.sources[id] = (vec.sources[id] || 0) + 1.5;
      }
    }
  },
  {
    id: "tags",
    type: "multi",
    prompt: "특별히 좋아하는 세부 관심사가 있다면 골라주세요. (선택)",
    options: TAGS.map((t) => ({ id: t, label: t })),
    apply(selected, vec) {
      for (const id of selected) {
        vec.tags[id] = (vec.tags[id] || 0) + 1.2;
      }
    }
  },
  {
    id: "avoid",
    type: "multi",
    prompt: "반대로 피하고 싶은 주제가 있나요? (선택)",
    options: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    apply(selected, vec) {
      for (const id of selected) {
        vec.categories[id] = (vec.categories[id] || 0) - 1.5;
      }
    }
  }
];

export function emptyPreferenceVector() {
  return {
    categories: {}, // categoryId -> weight
    tags: {}, // tagId -> weight
    sources: {}, // sourceId -> weight (learned later)
    prefs: { longform: 0 } // scalar style preferences
  };
}

// Turn a map of { questionId: answer } into an initial preference vector.
export function buildPreferenceVector(answers) {
  const vec = emptyPreferenceVector();
  for (const question of SURVEY) {
    const answer = answers[question.id];
    if (answer === undefined || answer === null) continue;

    if (question.type === "multi") {
      const selected = Array.isArray(answer) ? answer : [answer];
      question.apply(selected, vec);
    } else {
      question.apply(answer, vec);
    }
  }
  return vec;
}

// Validate answers against the survey definition. Returns { ok, errors }.
export function validateAnswers(answers) {
  const errors = [];
  if (!answers || typeof answers !== "object") {
    return { ok: false, errors: ["answers must be an object"] };
  }
  const byId = new Map(SURVEY.map((q) => [q.id, q]));
  for (const [key, value] of Object.entries(answers)) {
    const question = byId.get(key);
    if (!question) {
      errors.push(`unknown question: ${key}`);
      continue;
    }
    const valid = new Set(question.options.map((o) => o.id));
    const values = question.type === "multi" ? (Array.isArray(value) ? value : [value]) : [value];
    for (const v of values) {
      if (!valid.has(v)) errors.push(`invalid option "${v}" for question "${key}"`);
    }
  }
  // require at least one category of interest to bootstrap the feed
  const cats = answers.categories;
  if (!cats || (Array.isArray(cats) && cats.length === 0)) {
    errors.push("select at least one category of interest");
  }
  return { ok: errors.length === 0, errors };
}
