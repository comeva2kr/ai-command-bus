// AI quiz generation: weekly hot topics → shareable 유형테스트 (personality
// quiz). Calls the Anthropic Messages API over raw HTTP with an injected
// fetchImpl (this repo is deliberately zero-dependency — see server.js), and
// falls back to a deterministic template quiz when no API key is configured so
// the whole pipeline stays runnable/testable offline.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-opus-4-8";

// Structured-outputs schema for the generated quiz. Dynamic keys aren't
// allowed under structured outputs (additionalProperties must be false), so
// per-answer scoring is an array of {result, points} pairs instead of a map.
export const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "questions", "results"],
  properties: {
    title: { type: "string", description: "테스트 제목 (호기심을 자극하는 한국어)" },
    description: { type: "string", description: "한 줄 소개 (공유 미리보기에 쓰임)" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["q", "answers"],
        properties: {
          q: { type: "string" },
          answers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "scores"],
              properties: {
                text: { type: "string" },
                scores: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["result", "points"],
                    properties: {
                      result: { type: "string", description: "results[].id 중 하나" },
                      points: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "shareText"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          shareText: { type: "string", description: "결과 공유용 한 줄 (SNS에 뿌려질 문구)" }
        }
      }
    }
  }
};

export function buildPrompt(topics, opts = {}) {
  const weekLabel = opts.weekLabel || "이번 주";
  const list = topics.map((t, i) => `${i + 1}. ${t.title} (출처: ${t.source})`).join("\n");
  return [
    `${weekLabel} 한국 커뮤니티에서 화제가 된 토픽들이다:`,
    "",
    list,
    "",
    "이 토픽들의 분위기와 밈을 녹여서, SNS에서 공유가 잘 되는 한국어 유형테스트를 하나 만들어라.",
    "",
    "규칙:",
    "- 질문 7~9개, 각 질문에 답변 3~4개.",
    "- 결과 유형 4~6개. 각 유형은 자랑하고 싶어지는(공유하고 싶어지는) 긍정적/재미있는 캐릭터로.",
    "- 각 답변의 scores는 반드시 results의 id만 참조.",
    "- 특정 인물 비방, 정치/종교/성인 소재 금지. 상표는 일반 명사로 우회.",
    "- shareText는 '나는 ○○! 너는 어떤 유형?' 처럼 클릭을 부르는 문장으로."
  ].join("\n");
}

// Live generation via the Messages API. fetchImpl is injected (tests pass a
// fake; production passes global fetch). Throws user-facing Korean errors.
export async function generateQuizWithClaude(topics, opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY가 없어요. 템플릿 생성으로 폴백하세요.");
  const fetchImpl = opts.fetchImpl || fetch;

  const res = await fetchImpl(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: opts.model || process.env.QUIZ_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: QUIZ_SCHEMA } },
      messages: [{ role: "user", content: buildPrompt(topics, opts) }]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`퀴즈 생성 API 오류 (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("모델이 이 소재의 퀴즈 생성을 거절했어요. 토픽을 바꿔보세요.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let quiz;
  try {
    quiz = JSON.parse(text);
  } catch {
    throw new Error("퀴즈 응답이 올바른 JSON이 아니에요.");
  }
  validateQuiz(quiz);
  return quiz;
}

// Deterministic offline fallback: a real (if formulaic) quiz built from the
// topic titles, so the pipeline demos end-to-end without network or a key.
export function templateQuiz(topics, opts = {}) {
  const weekLabel = opts.weekLabel || "이번 주";
  const results = [
    { id: "trend", title: "실시간 트렌드 서퍼", description: "화제가 되기 전에 이미 알고 있는 타입. 친구들의 뉴스 알림 그 자체.", shareText: "나는 실시간 트렌드 서퍼! 너는 어떤 유형?" },
    { id: "deep", title: "정독파 분석러", description: "제목만 보고 안 넘어간다. 댓글까지 다 읽고 나만의 결론을 내는 타입.", shareText: "나는 정독파 분석러! 너는 어떤 유형?" },
    { id: "meme", title: "밈 제조기", description: "무엇을 보든 웃음 포인트를 찾아내는 타입. 단톡방 지분 1위.", shareText: "나는 밈 제조기! 너는 어떤 유형?" },
    { id: "chill", title: "느긋한 관망러", description: "유행은 일주일 뒤에 몰아서 본다. 그래도 결국 다 아는 신기한 타입.", shareText: "나는 느긋한 관망러! 너는 어떤 유형?" }
  ];
  const answerSets = [
    [
      { text: "바로 검색해서 전말을 파악한다", scores: [{ result: "deep", points: 2 }] },
      { text: "단톡방에 제일 먼저 공유한다", scores: [{ result: "trend", points: 2 }] },
      { text: "짤부터 만든다", scores: [{ result: "meme", points: 2 }] },
      { text: "나중에 정리글로 본다", scores: [{ result: "chill", points: 2 }] }
    ],
    [
      { text: "이미 알고 있었다", scores: [{ result: "trend", points: 2 }] },
      { text: "댓글 반응까지 챙겨본다", scores: [{ result: "deep", points: 2 }] },
      { text: "드립 칠 각부터 잰다", scores: [{ result: "meme", points: 2 }] },
      { text: "흠… 그렇구나 하고 넘긴다", scores: [{ result: "chill", points: 2 }] }
    ]
  ];
  const questions = topics.slice(0, 8).map((t, i) => ({
    q: `"${t.title}" — 이 소식을 접했을 때 나는?`,
    answers: answerSets[i % answerSets.length]
  }));
  const quiz = {
    title: `${weekLabel} 핫이슈 반응 유형테스트`,
    description: `${weekLabel} 가장 뜨거웠던 이슈들, 당신은 어떻게 반응하는 타입일까?`,
    questions,
    results
  };
  validateQuiz(quiz);
  return quiz;
}

// Structural validation shared by both generation paths (the API's schema
// enforcement can't check cross-references like scores→results.id).
export function validateQuiz(quiz) {
  if (!quiz || typeof quiz !== "object") throw new Error("퀴즈가 비어 있어요.");
  if (!quiz.title || !quiz.description) throw new Error("퀴즈 제목/설명이 없어요.");
  if (!Array.isArray(quiz.results) || quiz.results.length < 2) throw new Error("결과 유형이 2개 이상이어야 해요.");
  const ids = new Set(quiz.results.map((r) => r.id));
  if (ids.size !== quiz.results.length) throw new Error("결과 유형 id가 중복돼요.");
  for (const r of quiz.results) {
    if (!r.id || !r.title || !r.description || !r.shareText) throw new Error("결과 유형 필드가 비었어요.");
  }
  if (!Array.isArray(quiz.questions) || quiz.questions.length < 2) throw new Error("질문이 2개 이상이어야 해요.");
  for (const q of quiz.questions) {
    if (!q.q || !Array.isArray(q.answers) || q.answers.length < 2) throw new Error("질문/답변 구조가 잘못됐어요.");
    for (const a of q.answers) {
      if (!a.text || !Array.isArray(a.scores) || a.scores.length === 0) throw new Error("답변에 점수가 없어요.");
      for (const s of a.scores) {
        if (!ids.has(s.result)) throw new Error(`답변 점수가 없는 결과 유형을 참조해요: ${s.result}`);
        if (!Number.isFinite(s.points)) throw new Error("점수는 숫자여야 해요.");
      }
    }
  }
  return true;
}

// Dispatch: live generation when a key is available, template otherwise.
export async function generateQuiz(topics, opts = {}) {
  if (!Array.isArray(topics) || topics.length === 0) throw new Error("토픽이 없어요.");
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { quiz: await generateQuizWithClaude(topics, { ...opts, apiKey }), via: "claude" };
  }
  return { quiz: templateQuiz(topics, opts), via: "template" };
}

// URL slug: week label + a short stable hash of the title, so slugs are
// unique per week without needing to transliterate Korean titles.
export function quizSlug(quiz, weekLabel) {
  let h = 0;
  for (const ch of String(quiz.title)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `${weekLabel}-${h.toString(36)}`;
}
