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

import { CONTRACT } from "./manifest.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-opus-4-8";

// 용어 친숙도 3등급 — 선언 원본은 매니페스트 (pack_contract.familiarity_tiers).
// David 실사용 피드백(2026-07-25): "이걸 40대 직장인이 알까?"가 기준.
const FAMILIARITY_TIERS = CONTRACT.familiarity_tiers.tiers;

// Structured-outputs schema for the generated quiz (validated further by
// validateQuiz — the API schema can't express cross-references like
// "results must cover every pole combination").
export const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "weeklyBrief", "axes", "questions", "results"],
  properties: {
    title: { type: "string", description: "테스트 제목 (호기심을 자극하는 한국어)" },
    description: { type: "string", description: "한 줄 소개 (공유 미리보기에 쓰임)" },
    // 사전설명(브리핑) — David 실사용 피드백(2026-07-25): 퀴즈가 커뮤니티
    // 내부자 전보체로 나와서 모르는 사람은 못 알아듣는다는 지적 반영. 소재
    // 수만큼, 처음 듣는 친구에게 말해주듯 한 줄로 무슨 일이 있었는지 설명한다.
    weeklyBrief: {
      type: "array",
      description: "이번 주 소재 사전설명 — 소재 수만큼. 처음 듣는 친구에게 말해주듯 한 줄 설명.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "intro", "tier"],
        properties: {
          topic: { type: "string", description: "소재 핵심 키워드" },
          intro: { type: "string", description: "처음 듣는 친구에게 말해주듯 한 줄 설명 (커뮤니티 은어 없이, 무슨 일이 있었는지가 문장 안에 다 들어가게, 15~90자)" },
          tier: { type: "string", enum: FAMILIARITY_TIERS, description: "이 소재/용어의 친숙도 등급 — '이걸 40대 직장인이 알까?'가 기준" }
        }
      }
    },
    axes: {
      type: "array",
      description: "심리 축 2~4개. 문항/유형은 전부 이 축에서 파생된다.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "intro", "left", "right"],
        properties: {
          id: { type: "string", description: "축 식별자 (영문 소문자)" },
          name: { type: "string", description: "축 이름 (예: 에너지 방향)" },
          intro: { type: "string", description: "이 축이 뭘 확인하는지 처음 온 사람에게 말해주는 친절 한 줄 (예: '이슈를 보면 바로 퍼뜨리는 편인지, 혼자 간직하는 편인지를 봐.', 15~70자)" },
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
        required: [
          "code",
          "title",
          "description",
          "strengths",
          "weaknesses",
          "advice",
          "bestMatch",
          "worstMatch",
          "bestMatchReason",
          "worstMatchReason",
          "shareText"
        ],
        properties: {
          code: { type: "string", description: "극 코드 조합, 축 순서대로 (예: EPA)" },
          title: { type: "string", description: "정체성 언어로 된 유형 이름" },
          description: { type: "string" },
          strengths: { type: "array", items: { type: "string" }, description: "강점 3~5개" },
          weaknesses: { type: "array", items: { type: "string" }, description: "성장 포인트 1~2개 (솔직하게)" },
          advice: { type: "array", items: { type: "string" }, description: "실행 가능한 조언 1~3개" },
          bestMatch: { type: "string", description: "잘 맞는 유형 code" },
          worstMatch: { type: "string", description: "상극 케미 유형 code" },
          bestMatchReason: { type: "string", description: "왜 잘 맞는지 한 줄 상황극 (40자 이내)" },
          worstMatchReason: { type: "string", description: "왜 부딪히는지 한 줄 상황극 (40자 이내)" },
          shareText: { type: "string", description: "결과 공유용 한 줄 (SNS에 뿌려질 문구)" }
        }
      }
    }
  }
};

// 2차 적대 검수(전문가 5그룹+이용자 20명) 결론: "형식 게이트는 작동하지만
// 의미 층위가 샌다 + 생성이 한 방 출력이라 전문가가 만든 티가 안 난다".
// 룰 나열식 프롬프트를 실제 제작자의 작업 절차(0.소재 해부 → 1.컨셉 →
// 2.문항 초고 → 3.결과 초고 → 4.셀프 검수 → 5.제출)로 재편한다 — 각 단계를
// 실제로 거치게 강제해서 소재-행동 짜깁기, 템플릿 오프닝, 극 조언 수렴 같은
// (코드 게이트가 못 잡는) 의미 정합 실패를 생성 시점에 스스로 잡게 한다.
export function buildPrompt(topics, opts = {}) {
  const weekLabel = opts.weekLabel || "이번 주";
  const list = topics.map((t, i) => `${i + 1}. ${t.title} (출처: ${t.source})`).join("\n");
  return [
    `${weekLabel} 한국 커뮤니티에서 화제가 된 토픽들이다:`,
    "",
    list,
    "",
    "너는 국내 히트 유형테스트를 수년간 만들어온 제작자다. 아래 순서로 **작업**하라 — 각 단계를 실제로 거치고, 최종 출력은 완성본 JSON 하나만.",
    "",
    "## [0단계 — 소재 해부]",
    "토픽 각각에 대해 아래 세 가지를 먼저 정리한다 (생략하고 바로 문항/유형으로 넘어가지 마라):",
    "① 이 소재가 왜 웃긴가 / 어떤 감정을 건드리나",
    "② 이 소재에서 실제로 일어날 수 있는 행동 목록 (그 소재라서 가능한 구체적 행동만)",
    "③ 이 소재를 모르는 사람도 고를 수 있는 반응은 뭔가",
    "④ 이 소재를 하나도 모르는 친구에게 말해주듯 한 줄 설명을 써라(이게 weeklyBrief가 된다) — 커뮤니티 은어 없이, 무슨 일이 있었는지가 문장 안에 다 들어가게.",
    "**여기서 정리한 행동 목록에 없는 행동을 뒤 단계에서 그 소재에 붙이면 실패다.** (2차 검수 최다 적발 사례: 봉화군 소재 글에 다른 소재의 '재고 확인'을 그대로 갖다 붙인 짜깁기 — 소재별 행동은 서로 섞이면 안 된다.)",
    "- 각 소재와 그 안의 핵심 용어를 [국민상식/대중화제/커뮤내수] 3등급으로 분류하라 — '이걸 40대 직장인이 알까?'가 기준. **커뮤내수 등급 용어는: 브리핑에서 반드시 설명하고, 문항 첫 등장 시 문장 안에서 풀어쓰고, 제목에는 쓰지 마라.** (weeklyBrief 각 항목의 tier 필드로 남긴다.)",
    "",
    "## [1단계 — 컨셉]",
    "- 이 소재에 맞는 심리 축 3개를 정의한다 (축마다 양극에 코드 1글자 + 매력적인 극 이름).",
    "- 축 이름·극 이름은 이번 소재들에서 자연스럽게 나와야지, 아무 주에나 쓸 수 있는 범용어면 약하다.",
    "- 문항과 유형은 전부 그 축에서 파생시킨다. 유형 수 = 2^축수 (3축이면 8유형, 코드는 축 순서대로 조합).",
    "- 축마다 intro를 써라 — 이 축이 뭘 확인하는지 처음 온 사람에게 말해주는 친절 한 줄이다(예: '이슈를 보면 바로 퍼뜨리는 편인지, 혼자 간직하는 편인지를 봐.', 15~70자).",
    "- 제목에 이번 주 토픽의 핵심 단어를 최소 1개 그대로 넣어라 (예: '고소영 단발 뜬 날, 너는 몇 초 만에 퍼뜨림?'). 아무 주에나 쓸 수 있는 범용 제목 금지.",
    "- **제목에는 소재를 1개만** 넣어라 — 밈 여러 개를 이어붙인 압축 제목 금지, 상황 하나를 완결 문장으로.",
    "",
    "## [2단계 — 문항 초고]",
    "- 총 9~12문항, 축당 3~4문항 (홀수 권장 — 동점 방지), 선택지는 문항당 정확히 4개.",
    "- 9문항 중 최소 6개는 토픽에서 직접 파생시켜라 (범용 필러 최소화).",
    "- **문항 첫 문장은 그 소재를 처음 듣는 사람도 상황을 이해할 수 있게 쓴다** — '봉화군 까임 글 보고' 같은 축약 금지, '봉화군이 맥도날드에 협업하자고 했다가 거절당했다는 글을 보고'처럼. 한 번 설명된 소재는 이후 문항에서 짧게 불러도 된다.",
    "- 직접 자기보고('당신은 외향적입니까?') 금지. 토픽 상황에 던져넣는 상황 제시형으로:",
    "  좋은 예: \"금요일 밤 단톡방에 '지금 나올 사람?'이 뜬다. 나는 → ① 이미 신발 신는 중 ② 누가 나오는지부터 확인 ③ 읽고 침대에 더 파고든다\"",
    "- '정답' 냄새 금지: 모든 선택지가 각자 매력 있거나 각자 웃겨야 한다. 사회적으로 바람직한 답이 하나뿐인 문항은 실패작.",
    "- 문항당 정확히 1축만 측정. 한 문항의 답변들에 left/right가 골고루 섞여야 한다.",
    "- 같은 토픽을 두 문항에 쓰지 마라 — 토픽당 문항 1개(같은 토픽 문항 2개 금지).",
    "- 연예인·특정 동네처럼 모를 수 있는 소재 문항엔 '누군지/뭔지 몰라서 그냥 넘긴다' 류 중립 선택지를 1개 넣어라(그 선택지도 pole은 가져야 함). 단 '가물가물' 같은 자기비하 말투는 금지 — '내 알 바 아니라 넘긴다'류 당당한 무관심으로 써라(응답자를 깎아내리는 말투 금지).",
    "- 같은 축 문항들의 선택지가 같은 문장 골격의 재탕이면 안 된다(예: '끝까지 찾아본다' 3연속 금지).",
    "- 같은 축의 문항들은 미는 방향을 섞어라 (전부 1번 답이 같은 극이면 안 됨 — 역채점 균형).",
    "- 강한 신호인 답변에만 weight 2, 나머지는 1.",
    "- 첫 1~2문항은 가장 쉽고 웃긴 훅으로.",
    "",
    "## [3단계 — 결과 초고]",
    "- **전보체 금지**: 조사·주어를 잘라낸 압축문 대신 완결 문장. 드립은 유지하되 문장은 친절하게.",
    "- 유형 이름은 점수 언어가 아니라 정체성 언어로, 대화에서 짧게 부를 수 있는 별칭이 되게 (예: '계획으로 세상을 지키는 큐레이터형' — 어휘가 밈이 되면 테스트로 재유입된다).",
    "- 각 유형 서술 첫 문장은 이번 주 토픽 고유명사를 직접 넣은 생활 장면으로 시작하라 (예: '고소영 단발 짤 뜨자마자 단톡 세 군데에 뿌린 게 너다').",
    "- 서술은 220자 이내 — 길수록 AI 티다.",
    "- 서술은 강점 4개 + 성장 포인트 1~2개 (칭찬만 하면 가짜처럼 느껴진다 — 80:20).",
    "- 서술에는 보편적이지만 개인적으로 들리는 문장과, 축 성향에서 직접 도출된 구체 문장을 섞어라.",
    "- 강점·조언을 인사평가/자기계발 톤으로 쓰지 마라 ('습관 들이기', '역량', '성장' 금지) — 친구를 놀리듯 팩폭 톤으로.",
    "- 같은 축을 공유하는 유형들의 조언이 같은 문장 골격이면 안 된다.",
    "- ① 결과 8종에 이번 주 토픽이 최대한 고르게 퍼지게 — 전체적으로 서로 다른 토픽이 최소 min(토픽 수, 유형 수)개는 등장해야 한다(한두 토픽만 우려먹지 마라).",
    "- ② 오프닝 문형을 최소 3종 이상 섞어라 — 8개가 전부 '~게 너다'로 끝나면 그 자체로 템플릿 티다.",
    "- ③ 각 극의 약점은 그 극 고유의 것이어야 한다 — 반대 극이 되라는 조언으로 수렴시키지 마라(예: 잠수러 4유형 전부에게 '더 나눠라'라고 하면 실패).",
    "- ④ 한 유형 안에서 강점과 약점이 서로 모순되면 안 된다(예: '빠르다'면서 동시에 '뒷북친다' 금지).",
    "- ⑤ '꽝' 유형을 만들지 마라 — 모든 유형의 강점에 자랑할 맛 나는 우월감형 문구를 최소 1개는 넣어라.",
    "- ⑥ bestMatchReason/worstMatchReason 필드: 왜 잘 맞는지 / 왜 부딪히는지를 한 줄 상황극으로(각 40자 이내) 채워라.",
    "- ⑦ shareText는 60자 이내, '나는'으로 자기 유형을 선언하되 나머지는 유형마다 완전히 다른 드립으로 써라. 8개를 나란히 놓았을 때 같은 틀이 보이면 실패다(예: '나는 인간 알림봇 — 네 소식 나한테 먼저 옴. 너는?' / '나는 조용한 얼리어답터, 알고도 조용히 있는 중. 너는?'). 8개 중 물음표로 끝나는 반문형은 절반 이하로 — 감탄·선언·도발형을 섞어라.",
    "- 유형마다 bestMatch(잘 맞는 케미)와 worstMatch(상극 케미)를 다른 유형 code로 지정.",
    "- advice는 '이런 날엔 이렇게' 식의 실행 가능한 조언 2~3개.",
    "",
    "## [4단계 — 전문가 셀프 검수]",
    "완성본을 제출하기 전에 아래 체크리스트를 하나씩 확인하라. 걸리면 그 자리에서 고치고 다시 검수하라 (걸린 채로 넘어가지 마라):",
    "① 36개 선택지를 소리 내어 읽었을 때 비문·뜻 충돌이 없나",
    "② 결과문에 등장하는 행동이 0단계에서 그 소재에 대해 정리한 행동 목록에 실제로 있나 (다른 소재의 행동을 갖다 붙이지 않았나)",
    "③ 오프닝 골격이 서로 겹치지 않나",
    "④ shareText 종결이 다양한가 (물음표 일색은 아닌가)",
    "⑤ 한 유형 안에서 강점·약점이 자기모순은 아닌가",
    "⑥ 극마다 다른 조언인데, 전부 반대 극이 되라는 말로 수렴하지 않는가",
    "⑦ 자랑할 맛 없는 '꽝' 유형은 없는가",
    "⑧ 상표: 토픽 제목에 이미 등장한 상표명은 그대로 써도 된다(공개 화제 인용). 토픽에 없는 상표는 일반 명사로 우회하라.",
    "⑨ 이번 주 커뮤니티를 하나도 안 본 친구에게 소리 내어 읽어줬을 때, 브리핑→제목→문항→결과 순서로 전부 이해되는가. 막히는 문장은 그 자리에서 풀어써라.",
    "⑩ 커뮤내수 등급 용어가 설명 없이 노출된 곳이 한 군데라도 있나.",
    "",
    "## [5단계 — 제출]",
    "완성본 JSON 하나만 출력한다.",
    "",
    "## 금지",
    "- 특정 인물 비방, 정치/종교/성인 소재.",
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
      intro: "이슈를 보면 바로 반응하는 편인지, 곱씹고 나서 움직이는 편인지를 봐.",
      left: { code: "F", label: "직진 반응형" },
      right: { code: "T", label: "곱씹는 관찰형" }
    },
    {
      id: "sharing",
      name: "확산 본능",
      intro: "알게 된 걸 바로 퍼뜨리는 편인지, 혼자 챙겨두는 편인지를 봐.",
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
      { text: "얘기가 나오면 그때 꺼낸다", pole: "right", weight: 1 },
      { text: "스토리에 슬쩍 올린다", pole: "left", weight: 1 },
      { text: "짤로 만들어서 뿌린다", pole: "left", weight: 2 },
      { text: "모아뒀다가 몰아서 본다", pole: "right", weight: 2 }
    ],
    [
      { text: "만나는 사람마다 얘기한다", pole: "left", weight: 2 },
      { text: "오늘의 대화 주제로 쓴다", pole: "left", weight: 1 },
      { text: "폴더 정리해서 보관한다", pole: "right", weight: 2 },
      { text: "언젠가 써먹으려고 메모한다", pole: "right", weight: 1 }
    ],
    [
      { text: "눈으로만 저장한다", pole: "right", weight: 1 },
      { text: "댓글창에서 한마디 얹는다", pole: "left", weight: 1 },
      { text: "피드에 바로 공유 버튼", pole: "left", weight: 2 },
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
  // 토픽 핵심어 — 인덱스별로 순환 참조해서(topics[i % topics.length]) 결과
  // 4종이 서로 다른 토픽을 인용하게 한다. 전부 t0(1순위 토픽)만 우려먹으면
  // QG2의 결과-전체 토픽 커버리지 검사(2차 검수 반영)에 걸린다.
  const topicWord = (i) => topics[i % topics.length].title.replace(/\s+/g, " ").trim().slice(0, 10);
  const w0 = topicWord(0);
  const w1 = topicWord(1);
  const w2 = topicWord(2);
  const w3 = topicWord(3);
  const results = [
    {
      code: "FS",
      title: "속보 그 자체, 인간 알림봇",
      description: `"${w0}" 뜨자마자 단톡방 세 군데에 이미 뿌렸다. 화제가 되기 전에 반응하고, 반응한 순간 다 퍼뜨리는 타입 — 네 주변인들은 뉴스 앱이 필요 없다.`,
      strengths: ["트렌드 감지 속도가 압도적", "모임에서 화제를 주도한다", "정보 공유에 진심이라 인망이 쌓인다", "결정이 빠르다"],
      weaknesses: ["가끔 사실 확인 전에 전파해서 정정 공지를 날리게 된다"],
      advice: ["뿌리기 전에 10초만 출처를 확인해보자", "네 속도는 무기다 — 정확도만 붙이면 무적"],
      bestMatch: "TK",
      worstMatch: "TS",
      bestMatchReason: "TK가 쟁여둔 걸 FS가 바로 터뜨려준다",
      worstMatchReason: "TS가 팩트체크로 급브레이크를 건다",
      shareText: "나는 인간 알림봇, 네 소식 나한테 제일 먼저 온다! 너보다 항상 빠르다"
    },
    {
      code: "FK",
      title: "조용한 얼리어답터",
      description: `"${w1}" 뜬 거 남들보다 먼저 봤는데 굳이 말 안 한다. 어느 날 대화 중에 "아 그거? 옛날에 봤는데"가 자연스럽게 나오는 타입.`,
      strengths: ["정보 감도가 높다", "허세 없이 아는 게 많다", "본인만의 아카이브가 탄탄하다", "유행에 휩쓸리지 않는다"],
      weaknesses: ["좋은 정보를 혼자만 알고 있어 주변이 아쉬워한다"],
      advice: ["모아둔 것 중 하나만 일주일에 한 번 공유해보자 — 반응이 꽤 짜릿하다"],
      bestMatch: "TS",
      worstMatch: "FS",
      bestMatchReason: "FK가 흘린 걸 TS가 바로 검증해준다",
      worstMatchReason: "FS가 다 퍼뜨려서 FK 존재감이 묻힌다",
      shareText: "나는 조용한 얼리어답터, 알고도 조용히 있는 중. 너는?"
    },
    {
      code: "TS",
      title: "팩트로 무장한 전파자",
      description: `"${w2}"가 진짜인지 원문부터 까보고, 확신이 서면 그때 제일 크게 퍼뜨린다. 네 공유엔 신뢰가 붙는다 — 주변의 팩트체커.`,
      strengths: ["공유하는 정보의 정확도가 높다", "설명을 잘해서 듣는 사람이 편하다", "논쟁에서 근거로 이긴다", "주변의 팩트체커 역할"],
      weaknesses: ["검증하는 사이에 화제가 식어버릴 때가 있다"],
      advice: ["가끔은 '아직 확실치 않은데 재밌다'로 먼저 던져도 괜찮다", "네 신중함이 곧 브랜드다"],
      bestMatch: "FK",
      worstMatch: "FS",
      bestMatchReason: "TS가 검증한 걸 FK가 조용히 챙겨간다",
      worstMatchReason: "FS는 먼저 던지고 TS는 뒤늦게 정정한다",
      shareText: "나는 팩트로 무장한 전파자, 출처 없인 너한테 안 낚인다"
    },
    {
      code: "TK",
      title: "느긋한 큐레이터",
      description: `"${w3}" 같은 건 북마크에 고이 모셔두고 일주일 뒤에 본다. 시간이 지나도 남을 것만 골라 담는 타입 — 네 북마크 폴더는 박물관급.`,
      strengths: ["안목이 좋다 — 남는 콘텐츠를 알아본다", "차분해서 낚시성 이슈에 안 낚인다", "몰아보기의 달인", "장기 기억력이 좋다"],
      weaknesses: ["실시간 드립 타이밍은 자주 놓친다"],
      advice: ["아카이브를 가끔 열어 '그때 그 이슈' 회고를 해보자 — 은근 인기 콘텐츠다"],
      bestMatch: "FS",
      worstMatch: "FK",
      bestMatchReason: "TK가 쟁여둔 걸 FS가 나서서 터뜨려준다",
      worstMatchReason: "FK는 이미 알던 걸 TK는 이제야 발견한다",
      shareText: "나는 느긋한 큐레이터 — 유행 지나고 정주행하는 편. 너는?"
    }
  ];
  // 주간 브리핑 — David 실사용 피드백(2026-07-25): 소재 수만큼, 처음 듣는
  // 친구에게 말해주듯 한 줄 설명(커뮤니티 은어 없이, 무슨 일이 있었는지가
  // 문장 안에 다 들어가게). tier는 결정적 템플릿이라 "대중화제"로 고정 —
  // 실제 등급 판정은 Claude 생성 경로가 buildPrompt 0단계에서 매긴다.
  const weeklyBrief = topics.map((t) => ({
    topic: t.title.slice(0, 12),
    intro: `"${t.title.slice(0, 20)}" 얘기가 이번 주 커뮤니티에서 크게 돌았어.`,
    tier: "대중화제"
  }));
  const quiz = {
    title: `"${w0}" 뜬 날 내 반응 유형은?`,
    description: `이번 주 "${w0}" 같은 화제들 앞에서 네 반응 축 2개를 재본다. 4가지 중 넌 어디?`,
    weeklyBrief,
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

  // 주간 브리핑 — David 실사용 피드백(2026-07-25): 소재를 하나도 모르는
  // 사람도 시작 전에 이해하게. 존재·intro 15~90자·비어있지 않음·친숙도
  // 등급(tier)이 매니페스트 선언 목록 안에 있는지 검증 (개수를 몇 개
  // 채웠는지는 토픽 컨텍스트가 필요해 gates.js QG2가 담당).
  if (!Array.isArray(quiz.weeklyBrief) || quiz.weeklyBrief.length === 0) {
    throw new Error("주간 브리핑(weeklyBrief)이 없어요.");
  }
  for (const b of quiz.weeklyBrief) {
    if (!b || !b.topic || !String(b.topic).trim()) throw new Error("weeklyBrief의 topic이 비었어요.");
    const intro = String((b && b.intro) || "").trim();
    if (!intro) throw new Error(`weeklyBrief "${b.topic}"의 intro가 비었어요.`);
    if (intro.length < 15 || intro.length > 90) {
      throw new Error(`weeklyBrief "${b.topic}"의 intro가 ${intro.length}자 — 15~90자여야 해요.`);
    }
    if (!FAMILIARITY_TIERS.includes(b.tier)) {
      throw new Error(`weeklyBrief "${b.topic}"의 tier가 잘못됐어요 (${FAMILIARITY_TIERS.join("/")} 중 하나여야 해요).`);
    }
  }

  // 축: 2~4개, id/극코드 유일, intro(이 축이 뭘 확인하는지 설명) 필수
  if (!Array.isArray(quiz.axes) || quiz.axes.length < 2 || quiz.axes.length > 4) {
    throw new Error("심리 축은 2~4개여야 해요.");
  }
  const axisIds = new Set();
  const poleCodes = new Set();
  for (const axis of quiz.axes) {
    if (!axis.id || !axis.name) throw new Error("축 id/이름이 비었어요.");
    if (axisIds.has(axis.id)) throw new Error(`축 id가 중복돼요: ${axis.id}`);
    axisIds.add(axis.id);
    // David 실사용 피드백(2026-07-25): "이 테스트가 뭘 확인하는지" 처음
    // 온 사람에게 설명하고 시작해야 한다.
    const axisIntro = String(axis.intro || "").trim();
    if (!axisIntro) throw new Error(`축 ${axis.id}의 intro(이 축이 뭘 확인하는지 설명)가 없어요.`);
    if (axisIntro.length < 15 || axisIntro.length > 70) {
      throw new Error(`축 ${axis.id}의 intro가 ${axisIntro.length}자 — 15~70자여야 해요.`);
    }
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
    // 궁합 이유 — 왜 맞는지/왜 부딪히는지 한 줄 상황극 (2차 검수: 케미가 코드
    // 조합만 보여주고 근거가 없어 설득력이 없다는 지적 반영).
    if (!r.bestMatchReason || !String(r.bestMatchReason).trim()) throw new Error(`유형 ${r.code}의 bestMatchReason이 비었어요.`);
    if (!r.worstMatchReason || !String(r.worstMatchReason).trim()) throw new Error(`유형 ${r.code}의 worstMatchReason이 비었어요.`);
    if (String(r.bestMatchReason).length > 40) throw new Error(`유형 ${r.code}의 bestMatchReason이 40자를 넘어요.`);
    if (String(r.worstMatchReason).length > 40) throw new Error(`유형 ${r.code}의 worstMatchReason이 40자를 넘어요.`);
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
