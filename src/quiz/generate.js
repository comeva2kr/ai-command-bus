// AI quiz generation: weekly hot topics → shareable 유형테스트 (personality
// quiz). Calls the Anthropic Messages API over raw HTTP with an injected
// fetchImpl (this repo is deliberately zero-dependency — see server.js), and
// falls back to a deterministic template quiz when no API key is configured so
// the whole pipeline stays runnable/testable offline.
//
// Quiz format is AXIS-BASED (docs/quiz-design.md): every quiz defines 2~4
// psychological axes with two poles each; questions are tagged to one axis
// and scored as a spectrum (0~100% per axis); the result type is the
// combination of dominant poles (2 axes → 4 types, 3 axes → 8 types). This is
// the 16personalities-style structure — chosen over simple type-sum argmax
// because per-axis percentages are explainable, personal, and absorb
// borderline results ("52:48 균형형") instead of feeling arbitrary.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-opus-4-8";

// Structured-outputs schema for the generated quiz (validated further by
// validateQuiz — the API schema can't express cross-references like
// "results must cover every pole combination").
export const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "axes", "questions", "results"],
  properties: {
    title: { type: "string", description: "테스트 제목 (호기심을 자극하는 한국어)" },
    description: { type: "string", description: "한 줄 소개 (공유 미리보기에 쓰임)" },
    axes: {
      type: "array",
      description: "심리 축 2~4개. 문항/유형은 전부 이 축에서 파생된다.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "left", "right"],
        properties: {
          id: { type: "string", description: "축 식별자 (영문 소문자)" },
          name: { type: "string", description: "축 이름 (예: 에너지 방향)" },
          left: {
            type: "object",
            additionalProperties: false,
            required: ["code", "label"],
            properties: {
              code: { type: "string", description: "극 코드 대문자 1글자, 전체 축에서 유일" },
              label: { type: "string", description: "극 이름 (예: 발산형)" }
            }
          },
          right: {
            type: "object",
            additionalProperties: false,
            required: ["code", "label"],
            properties: {
              code: { type: "string" },
              label: { type: "string" }
            }
          }
        }
      }
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["q", "axis", "answers"],
        properties: {
          q: { type: "string", description: "상황 제시형 문항" },
          axis: { type: "string", description: "이 문항이 측정하는 축 id (문항당 정확히 1축)" },
          answers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "pole"],
              properties: {
                text: { type: "string", description: "한 줄 이내, '정답' 냄새 금지" },
                pole: { type: "string", enum: ["left", "right"], description: "이 답이 미는 극" },
                weight: { type: "integer", description: "1(기본) 또는 2(강한 신호)" }
              }
            }
          }
        }
      }
    },
    results: {
      type: "array",
      description: "극 코드 조합당 1개 (축 2개면 4개, 3개면 8개)",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "title", "description", "strengths", "weaknesses", "advice", "bestMatch", "worstMatch", "shareText"],
        properties: {
          code: { type: "string", description: "극 코드 조합, 축 순서대로 (예: EPA)" },
          title: { type: "string", description: "정체성 언어로 된 유형 이름" },
          description: { type: "string" },
          strengths: { type: "array", items: { type: "string" }, description: "강점 3~5개" },
          weaknesses: { type: "array", items: { type: "string" }, description: "성장 포인트 1~2개 (솔직하게)" },
          advice: { type: "array", items: { type: "string" }, description: "실행 가능한 조언 1~3개" },
          bestMatch: { type: "string", description: "잘 맞는 유형 code" },
          worstMatch: { type: "string", description: "환장의 케미 유형 code" },
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
    "이 토픽들의 분위기와 밈을 소재로, SNS에서 공유가 잘 되면서도 '대충 만든 티'가 나지 않는 한국어 유형테스트를 하나 설계하라.",
    "",
    "## 설계 순서 (톱다운 — 반드시 이 순서로)",
    "1. 먼저 이 소재에 맞는 심리 축 3개를 정의한다 (축마다 양극에 코드 1글자 + 매력적인 극 이름).",
    "2. 문항과 유형은 전부 그 축에서 파생시킨다. 유형 수 = 2^축수 (3축이면 8유형, 코드는 축 순서대로 조합).",
    "",
    "## 문항 규칙",
    "- 총 9~12문항, 축당 3~4문항 (홀수 권장 — 동점 방지), 문항당 답변 3~4개.",
    "- 직접 자기보고('당신은 외향적입니까?') 금지. 토픽 상황에 던져넣는 상황 제시형으로:",
    "  좋은 예: \"금요일 밤 단톡방에 '지금 나올 사람?'이 뜬다. 나는 → ① 이미 신발 신는 중 ② 누가 나오는지부터 확인 ③ 읽고 침대에 더 파고든다\"",
    "- '정답' 냄새 금지: 모든 선택지가 각자 매력 있거나 각자 웃겨야 한다. 사회적으로 바람직한 답이 하나뿐인 문항은 실패작.",
    "- 문항당 정확히 1축만 측정. 한 문항의 답변들에 left/right가 골고루 섞여야 한다.",
    "- 같은 축의 문항들은 미는 방향을 섞어라 (전부 1번 답이 같은 극이면 안 됨 — 역채점 균형).",
    "- 강한 신호인 답변에만 weight 2, 나머지는 1.",
    "- 첫 1~2문항은 가장 쉽고 웃긴 훅으로.",
    "",
    "## 유형(결과) 규칙",
    "- 유형 이름은 점수 언어가 아니라 정체성 언어로, 대화에서 짧게 부를 수 있는 별칭이 되게 (예: '계획으로 세상을 지키는 큐레이터형' — 어휘가 밈이 되면 테스트로 재유입된다).",
    "- 결과 서술에는 구체적인 상황·행동 묘사를 넣어라 (두루뭉술한 칭찬만 있는 결과는 캡처할 이유가 없다).",
    "- 서술은 강점 4개 + 성장 포인트 1~2개 (칭찬만 하면 가짜처럼 느껴진다 — 80:20).",
    "- 서술에는 보편적이지만 개인적으로 들리는 문장과, 축 성향에서 직접 도출된 구체 문장을 섞어라.",
    "- 유형마다 bestMatch(잘 맞는 케미)와 worstMatch(환장의 케미)를 다른 유형 code로 지정.",
    "- advice는 '이런 날엔 이렇게' 식의 실행 가능한 조언 2~3개.",
    "- shareText는 '나는 ○○! 너는 어떤 유형?' 처럼 클릭을 부르는 문장.",
    "",
    "## 금지",
    "- 특정 인물 비방, 정치/종교/성인 소재. 상표는 일반 명사로 우회.",
    "- 격식체·상담봇 말투('물론입니다', '~하십시오', '여러분') — 전부 캐주얼한 구어체로.",
    ...(Array.isArray(opts.feedback) && opts.feedback.length
      ? [
          "",
          "## 이전 생성 시도가 게이트에서 반려됐다 — 아래 사유를 전부 해결하라",
          ...opts.feedback.map((f) => `- ${f}`)
        ]
      : [])
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
  // 구조 검증은 여기서 던지지 않는다 — 루프게이트(QG1)가 잡아서 반려 사유를
  // 다음 생성 시도의 피드백으로 되돌린다 (src/quiz/gates.js, weekly.js).
  return quiz;
}

// Deterministic offline fallback: a real axis-based quiz built from the topic
// titles, so the pipeline demos end-to-end without network or a key.
// 2 axes × 5 questions = 10문항 → 4유형.
export function templateQuiz(topics, opts = {}) {
  const weekLabel = opts.weekLabel || "이번 주";
  const axes = [
    {
      id: "reaction",
      name: "반응 속도",
      left: { code: "F", label: "직진 반응형" },
      right: { code: "T", label: "곱씹는 관찰형" }
    },
    {
      id: "sharing",
      name: "확산 본능",
      left: { code: "S", label: "확성기형" },
      right: { code: "K", label: "수집가형" }
    }
  ];
  // 문항마다 고유한 답변 세트 (QG3 복붙-티 게이트: 같은 선택지 재사용 금지).
  // 세트마다 좌/우 가중치 합을 3:3으로 맞춰 축 균형(QG4)도 지킨다.
  const reactionAnswers = [
    [
      { text: "일단 클릭. 생각은 그 다음에", pole: "left", weight: 2 },
      { text: "제목만 보고 대충 감 잡는다", pole: "left", weight: 1 },
      { text: "댓글 반응부터 확인한다", pole: "right", weight: 1 },
      { text: "정리글 뜰 때까지 기다린다", pole: "right", weight: 2 }
    ],
    [
      { text: "출처부터 따져본다", pole: "right", weight: 2 },
      { text: "비슷한 사례를 검색해본다", pole: "right", weight: 1 },
      { text: "우선 반응하고 나중에 정정한다", pole: "left", weight: 1 },
      { text: "첫인상이 곧 결론이다", pole: "left", weight: 2 }
    ],
    [
      { text: "보자마자 소름이 쫙 온다", pole: "left", weight: 2 },
      { text: "감은 오는데 확신은 반반", pole: "left", weight: 1 },
      { text: "하루 묵혀두고 다시 본다", pole: "right", weight: 2 },
      { text: "남들 반응을 먼저 살핀다", pole: "right", weight: 1 }
    ],
    [
      { text: "3초 만에 내 의견이 생긴다", pole: "left", weight: 2 },
      { text: "일단 웃고 시작한다", pole: "left", weight: 1 },
      { text: "사실인지부터 의심한다", pole: "right", weight: 2 },
      { text: "전후 맥락을 찾아본다", pole: "right", weight: 1 }
    ],
    [
      { text: "심장이 먼저 뛴다", pole: "left", weight: 2 },
      { text: "입이 먼저 나간다", pole: "left", weight: 1 },
      { text: "머리로 한 바퀴 굴려본다", pole: "right", weight: 1 },
      { text: "결론은 일주일 뒤에 낸다", pole: "right", weight: 2 }
    ]
  ];
  const sharingAnswers = [
    [
      { text: "단톡방 3곳에 동시 전파", pole: "left", weight: 2 },
      { text: "제일 좋아할 친구 한 명에게만", pole: "left", weight: 1 },
      { text: "북마크에 고이 모셔둔다", pole: "right", weight: 1 },
      { text: "나만 알고 싶어서 안 알린다", pole: "right", weight: 2 }
    ],
    [
      { text: "짤로 만들어서 뿌린다", pole: "left", weight: 2 },
      { text: "스토리에 슬쩍 올린다", pole: "left", weight: 1 },
      { text: "얘기가 나오면 그때 꺼낸다", pole: "right", weight: 1 },
      { text: "모아뒀다가 몰아서 본다", pole: "right", weight: 2 }
    ],
    [
      { text: "만나는 사람마다 얘기한다", pole: "left", weight: 2 },
      { text: "오늘의 대화 주제로 쓴다", pole: "left", weight: 1 },
      { text: "폴더 정리해서 보관한다", pole: "right", weight: 2 },
      { text: "언젠가 써먹으려고 메모한다", pole: "right", weight: 1 }
    ],
    [
      { text: "피드에 바로 공유 버튼", pole: "left", weight: 2 },
      { text: "댓글창에서 한마디 얹는다", pole: "left", weight: 1 },
      { text: "눈으로만 저장한다", pole: "right", weight: 1 },
      { text: "캡처해서 보관함 직행", pole: "right", weight: 2 }
    ],
    [
      { text: "이건 알려야 해, 사명감이 든다", pole: "left", weight: 2 },
      { text: "궁금해할 사람 얼굴이 떠오른다", pole: "left", weight: 1 },
      { text: "내 취향 아카이브에 추가", pole: "right", weight: 2 },
      { text: "조용히 좋아요만 누른다", pole: "right", weight: 1 }
    ]
  ];
  const questions = topics.slice(0, 5).flatMap((t, i) => [
    {
      q: `"${t.title}" — 이 얘기가 눈에 들어온 순간, 나는?`,
      axis: "reaction",
      answers: reactionAnswers[i % reactionAnswers.length]
    },
    {
      q: `"${t.title}" — 이걸 알게 된 다음 내 행동은?`,
      axis: "sharing",
      answers: sharingAnswers[i % sharingAnswers.length]
    }
  ]);
  const results = [
    {
      code: "FS",
      title: "속보 그 자체, 인간 알림봇",
      description: "화제가 되기 전에 이미 반응하고, 반응한 순간 주변에 다 퍼뜨리는 타입. 당신 주변 사람들은 뉴스 앱이 필요 없다.",
      strengths: ["트렌드 감지 속도가 압도적", "모임에서 화제를 주도한다", "정보 공유에 진심이라 인망이 쌓인다", "결정이 빠르다"],
      weaknesses: ["가끔 사실 확인 전에 전파해서 정정 공지를 하게 된다"],
      advice: ["뿌리기 전에 10초만 출처를 확인해보자", "당신의 속도는 무기다 — 정확도만 붙이면 무적"],
      bestMatch: "TK",
      worstMatch: "TS",
      shareText: "나는 '인간 알림봇'! 너는 이슈 앞에서 어떤 유형?"
    },
    {
      code: "FK",
      title: "조용한 얼리어답터",
      description: "누구보다 빨리 알지만 굳이 떠들지 않는 타입. 어느 날 대화 중에 '아 그거? 옛날에 봤는데'가 자연스럽게 나온다.",
      strengths: ["정보 감도가 높다", "허세 없이 아는 게 많다", "본인만의 아카이브가 탄탄하다", "유행에 휩쓸리지 않는다"],
      weaknesses: ["좋은 정보를 혼자만 알고 있어 주변이 아쉬워한다"],
      advice: ["모아둔 것 중 하나만 일주일에 한 번 공유해보자 — 반응이 꽤 짜릿하다"],
      bestMatch: "TS",
      worstMatch: "FS",
      shareText: "나는 '조용한 얼리어답터'! 너는 이슈 앞에서 어떤 유형?"
    },
    {
      code: "TS",
      title: "팩트로 무장한 전파자",
      description: "곱씹고 검증한 다음에야 움직이지만, 일단 확신이 서면 누구보다 널리 알리는 타입. 당신의 공유에는 신뢰가 붙는다.",
      strengths: ["공유하는 정보의 정확도가 높다", "설명을 잘해서 듣는 사람이 편하다", "논쟁에서 근거로 이긴다", "주변의 팩트체커 역할"],
      weaknesses: ["검증하는 사이에 화제가 식어버릴 때가 있다"],
      advice: ["가끔은 '아직 확실치 않은데 재밌다'로 먼저 던져도 괜찮다", "당신의 신중함이 곧 브랜드다"],
      bestMatch: "FK",
      worstMatch: "FS",
      shareText: "나는 '팩트로 무장한 전파자'! 너는 이슈 앞에서 어떤 유형?"
    },
    {
      code: "TK",
      title: "느긋한 큐레이터",
      description: "유행의 속도에 휘둘리지 않고, 시간이 지나도 남을 것만 골라 담는 타입. 당신의 북마크 폴더는 박물관급이다.",
      strengths: ["안목이 좋다 — 남는 콘텐츠를 알아본다", "차분해서 낚시성 이슈에 안 낚인다", "몰아보기의 달인", "장기 기억력이 좋다"],
      weaknesses: ["실시간 드립 타이밍은 자주 놓친다"],
      advice: ["아카이브를 가끔 열어 '그때 그 이슈' 회고를 해보자 — 은근 인기 콘텐츠다"],
      bestMatch: "FS",
      worstMatch: "FK",
      shareText: "나는 '느긋한 큐레이터'! 너는 이슈 앞에서 어떤 유형?"
    }
  ];
  const quiz = {
    title: `${weekLabel} 핫이슈 반응 유형테스트`,
    description: `${weekLabel} 가장 뜨거웠던 이슈들 앞에서 당신의 반응 축 2개를 측정합니다. 당신은 4가지 유형 중 어디?`,
    axes,
    questions,
    results
  };
  validateQuiz(quiz);
  return quiz;
}

// All pole-code combinations in axis order ("EP", "EA", ... ).
export function allTypeCodes(axes) {
  let codes = [""];
  for (const axis of axes) {
    codes = codes.flatMap((c) => [c + axis.left.code, c + axis.right.code]);
  }
  return codes;
}

// Structural validation shared by both generation paths. Enforces the design
// spec from docs/quiz-design.md — anything the structured-outputs schema
// can't express (cross-references, balance rules, counts).
export function validateQuiz(quiz) {
  if (!quiz || typeof quiz !== "object") throw new Error("퀴즈가 비어 있어요.");
  if (!quiz.title || !quiz.description) throw new Error("퀴즈 제목/설명이 없어요.");

  // 축: 2~4개, id/극코드 유일
  if (!Array.isArray(quiz.axes) || quiz.axes.length < 2 || quiz.axes.length > 4) {
    throw new Error("심리 축은 2~4개여야 해요.");
  }
  const axisIds = new Set();
  const poleCodes = new Set();
  for (const axis of quiz.axes) {
    if (!axis.id || !axis.name) throw new Error("축 id/이름이 비었어요.");
    if (axisIds.has(axis.id)) throw new Error(`축 id가 중복돼요: ${axis.id}`);
    axisIds.add(axis.id);
    for (const pole of [axis.left, axis.right]) {
      if (!pole || !pole.code || !pole.label) throw new Error(`축 ${axis.id}의 극 정보가 비었어요.`);
      if (poleCodes.has(pole.code)) throw new Error(`극 코드가 중복돼요: ${pole.code}`);
      poleCodes.add(pole.code);
    }
  }

  // 문항: 총 8~15개, 축당 3개 이상, 문항당 1축, 양극이 답변에 모두 존재
  if (!Array.isArray(quiz.questions) || quiz.questions.length < 8 || quiz.questions.length > 15) {
    throw new Error("문항은 8~15개여야 해요 (완주율 스펙).");
  }
  const perAxis = {};
  for (const q of quiz.questions) {
    if (!q.q || !axisIds.has(q.axis)) throw new Error(`문항의 축 태그가 잘못됐어요: ${q.axis}`);
    perAxis[q.axis] = (perAxis[q.axis] || 0) + 1;
    if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4) {
      throw new Error("답변은 문항당 2~4개여야 해요.");
    }
    const poles = new Set();
    for (const a of q.answers) {
      if (!a.text || (a.pole !== "left" && a.pole !== "right")) throw new Error("답변의 극 방향이 잘못됐어요.");
      const w = a.weight == null ? 1 : a.weight;
      if (w !== 1 && w !== 2) throw new Error("답변 weight는 1 또는 2여야 해요.");
      poles.add(a.pole);
    }
    if (poles.size < 2) throw new Error(`문항 "${q.q.slice(0, 20)}…"의 답변이 한쪽 극만 밀어요.`);
  }
  for (const id of axisIds) {
    if ((perAxis[id] || 0) < 3) throw new Error(`축 ${id}의 문항이 3개 미만이에요 (판정 안정성).`);
  }

  // 유형: 극 조합을 정확히 커버, 80:20 서술, 궁합 상호 참조
  const codes = allTypeCodes(quiz.axes);
  if (!Array.isArray(quiz.results)) throw new Error("결과 유형이 없어요.");
  const resultCodes = new Set(quiz.results.map((r) => r.code));
  if (resultCodes.size !== quiz.results.length) throw new Error("유형 code가 중복돼요.");
  for (const c of codes) {
    if (!resultCodes.has(c)) throw new Error(`유형 조합 ${c}의 결과가 없어요.`);
  }
  if (quiz.results.length !== codes.length) throw new Error("유형 수가 극 조합 수와 달라요.");
  for (const r of quiz.results) {
    if (!r.title || !r.description || !r.shareText) throw new Error(`유형 ${r.code}의 서술이 비었어요.`);
    if (!Array.isArray(r.strengths) || r.strengths.length < 3 || r.strengths.length > 5) {
      throw new Error(`유형 ${r.code}의 강점은 3~5개여야 해요.`);
    }
    if (!Array.isArray(r.weaknesses) || r.weaknesses.length < 1 || r.weaknesses.length > 2) {
      throw new Error(`유형 ${r.code}의 성장 포인트는 1~2개여야 해요 (80:20).`);
    }
    if (!Array.isArray(r.advice) || r.advice.length < 1 || r.advice.length > 3) {
      throw new Error(`유형 ${r.code}의 조언은 1~3개여야 해요.`);
    }
    if (!resultCodes.has(r.bestMatch) || r.bestMatch === r.code) throw new Error(`유형 ${r.code}의 bestMatch가 잘못됐어요.`);
    if (!resultCodes.has(r.worstMatch) || r.worstMatch === r.code) throw new Error(`유형 ${r.code}의 worstMatch가 잘못됐어요.`);
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
