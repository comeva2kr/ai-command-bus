// AI quiz generation: a single personality theme → shareable 유형테스트.
// Calls the Anthropic Messages API over raw HTTP with an injected fetchImpl
// (this repo is deliberately zero-dependency — see server.js), and falls back
// to a deterministic template quiz when no API key is configured so the whole
// pipeline stays runnable/testable offline.
//
// David 확정 방향(2026-07-26): "테스트 하나 = 성향 하나." 핫토픽 잡탕(여러
// 화제를 섞은 문항)은 폐기 — 테마(성향 하나)가 주인이고, 결과 형태는 테마
// 따라 유연하다:
//   - combo_types: 기존 축-조합형(docs/quiz-design.md) — 심리 축 2~4개,
//     각 문항은 축 하나를 스펙트럼으로 재고, 결과는 극 조합 전체(2~4축 →
//     4~16유형)의 16personalities류 구조.
//   - level_bands: 주 지표(레벨) 축 1개 + 선택적 스타일 축 1개. 레벨 %를
//     밴드(구간)로 판정해 "꼰대력 37% — 은근 있음" 식으로 보여준다. 스타일
//     축이 있으면 밴드×스타일 조합이 결과 유형이 된다.
// 어느 형태를 쓸지는 buildPrompt [0단계]에서 테마의 suggested_format을
// 참고하되 생성자가 재량으로 정한다 — 코드가 강제하지 않는다.

import { CONTRACT } from "./manifest.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-opus-4-8";

// 용어 친숙도 3등급 — 선언 원본은 매니페스트 (pack_contract.familiarity_tiers).
// David 실사용 피드백(2026-07-25): "이걸 40대 직장인이 알까?"가 기준.
const FAMILIARITY_TIERS = CONTRACT.familiarity_tiers.tiers;

// Structured-outputs schema for the generated quiz (validated further by
// validateQuiz — the API schema can't express cross-references like "results
// must cover every band/style combination" or "format determines axis count").
export const QUIZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["theme", "title", "description", "weeklyBrief", "axes", "questions", "results"],
  properties: {
    // 테마 — David 확정(2026-07-26): 테마(성향 하나)가 이 퀴즈의 주인이다.
    theme: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name_ko", "format"],
      properties: {
        id: { type: "string", description: "테마 id (매니페스트 pack_contract.theme.pool 중 하나, kebab-case)" },
        name_ko: { type: "string", description: "테마 이름 (예: 꼰대력)" },
        format: { type: "string", enum: ["combo_types", "level_bands"], description: "결과 형태 — 유형 조합형 또는 레벨형" },
        hook_ko: { type: "string", description: "이 테스트가 답하는 궁금증 한 줄 (선택, 랜딩에 크게 노출)" }
      }
    },
    title: { type: "string", description: "테스트 제목 (호기심을 자극하는 한국어)" },
    description: { type: "string", description: "한 줄 소개 (공유 미리보기에 쓰임)" },
    // 사전설명(브리핑) — David 확정(2026-07-26): "이 테스트가 재는 것"을
    // 테마 하나 기준으로 1~3개 설명한다(과거엔 주간 소재 사전설명이었다).
    weeklyBrief: {
      type: "array",
      description: "'이 테스트가 재는 것' 설명 1~3개 — 처음 듣는 친구에게 말해주듯 한 줄 설명.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "intro", "tier"],
        properties: {
          topic: { type: "string", description: "설명 대상(테마 자체 또는 테마 안의 핵심 용어)" },
          intro: { type: "string", description: "처음 듣는 친구에게 말해주듯 한 줄 설명 (커뮤니티 은어 없이, 15~90자)" },
          tier: { type: "string", enum: FAMILIARITY_TIERS, description: "이 용어의 친숙도 등급 — '이걸 40대 직장인이 알까?'가 기준" }
        }
      }
    },
    axes: {
      type: "array",
      description: "combo_types: 심리 축 2~4개. level_bands: 주 지표(레벨) 축 1개(+선택 스타일 축 1개, 최대 2개).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "intro", "left", "right"],
        properties: {
          id: { type: "string", description: "축 식별자 (영문 소문자)" },
          name: { type: "string", description: "축 이름 (예: 에너지 방향)" },
          intro: { type: "string", description: "이 축이 뭘 확인하는지 처음 온 사람에게 말해주는 친절 한 줄 (15~70자)" },
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
    // level_bands 전용 — 주 지표(axes[0]) % 구간별 밴드 3~5개. combo_types
    // 테마는 이 필드를 아예 쓰지 않는다(생략).
    bands: {
      type: "array",
      description: "레벨형(level_bands) 전용 — 주 지표 % 구간별 밴드 3~5개, 0~100 연속 커버·겹침 금지.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "min", "max", "label_ko"],
        properties: {
          code: { type: "string", description: "밴드 코드 (예: L1)" },
          min: { type: "integer", description: "레벨 % 하한(포함)" },
          max: { type: "integer", description: "레벨 % 상한(포함)" },
          label_ko: { type: "string", description: "밴드 이름 (예: 무해한 새싹)" }
        }
      }
    },
    questions: {
      type: "array",
      description: "combo_types 12~16개, level_bands 9~12개 (축당 3개 이상).",
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
      description: "combo_types: 극 코드 조합당 1개(축 2개면 4개, 3개면 8개). level_bands: 밴드×스타일 극 조합당 1개.",
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
          "shareText",
          "weeklyPick"
        ],
        properties: {
          code: { type: "string", description: "combo_types: 극 코드 조합(축 순서대로). level_bands: 밴드code(+스타일극code)." },
          title: { type: "string", description: "정체성 언어로 된 유형 이름" },
          description: { type: "string" },
          strengths: { type: "array", items: { type: "string" }, description: "강점 3~5개" },
          weaknesses: { type: "array", items: { type: "string" }, description: "성장 포인트 1~2개 (솔직하게)" },
          advice: { type: "array", items: { type: "string" }, description: "실행 가능한 조언 1~3개" },
          bestMatch: { type: "string", description: "잘 맞는 유형 code (level_bands는 인접/반대 밴드 케미 권장)" },
          worstMatch: { type: "string", description: "상극 케미 유형 code" },
          bestMatchReason: { type: "string", description: "왜 잘 맞는지 한 줄 상황극 (40자 이내)" },
          worstMatchReason: { type: "string", description: "왜 부딪히는지 한 줄 상황극 (40자 이내)" },
          shareText: { type: "string", description: "결과 공유용 한 줄 (SNS에 뿌려질 문구, level_bands는 수치 자랑 허용)" },
          weeklyPick: { type: "string", description: "이 성향이 제일 티 나는 순간(60자 이내)" }
        }
      }
    }
  }
};

// 2차 적대 검수(전문가 5그룹+이용자 20명) 결론: "형식 게이트는 작동하지만
// 의미 층위가 샌다 + 생성이 한 방 출력이라 전문가가 만든 티가 안 난다".
// 룰 나열식 프롬프트를 실제 제작자의 작업 절차(0.테마 선정+해부 → 1.컨셉 →
// 2.문항 초고 → 3.결과 초고 → 4.셀프 검수 → 5.제출)로 재편한다 — 각 단계를
// 실제로 거치게 강제해서 소재-행동 짜깁기, 템플릿 오프닝, 극 조언 수렴 같은
// (코드 게이트가 못 잡는) 의미 정합 실패를 생성 시점에 스스로 잡게 한다.
//
// David 확정(2026-07-26): "테스트 하나 = 성향 하나"가 주인. buildPrompt는
// 이제 화제 소재 목록이 아니라 ① 유행 테스트 신호(참고용) ② 테마 풀(history
// 제외)을 받아 [0단계]에서 생성자가 테마 1개를 직접 고르게 한다.
// opts.forcedTheme(테마 풀 항목 객체)가 있으면 --theme로 이미 정해진 것 —
// 선정 절차를 생략하고 그 테마로 바로 해부에 들어간다.
export function buildPrompt(opts = {}) {
  const weekLabel = opts.weekLabel || "이번 주";
  const trendSignals = Array.isArray(opts.trendSignals) ? opts.trendSignals : [];
  const themePool = Array.isArray(opts.themePool) ? opts.themePool : CONTRACT.theme.pool;
  const forcedTheme = opts.forcedTheme || null;
  const criteria = CONTRACT.theme.selection_criteria_ko || [];
  const formats = CONTRACT.formats || {};

  const trendSection = trendSignals.length
    ? [
        "## 참고 — 요즘 도는 테스트류 신호 (유행 테스트 신호, 참고용일 뿐 소재 자체 아님)",
        "아래는 최근 커뮤니티 제목에서 감지된 '테스트/유형/성향/~력'류 화제다 — 어떤 성향 테마가 지금 유행하는지 감을 잡는 참고 자료로만 써라. 이 목록의 제목 자체를 문항이나 결과에 인용하지 마라.",
        ...trendSignals.map((t, i) => `${i + 1}. ${t.title} (출처: ${t.source})`),
        ""
      ]
    : [];

  const poolSection = forcedTheme
    ? [
        `## 테마 — 이미 정해졌다: "${forcedTheme.name_ko}" (${forcedTheme.id})`,
        `힌트: ${forcedTheme.hook_ko || ""}`,
        `근거: ${forcedTheme.proven_ko || ""}`,
        `추천 형태: ${forcedTheme.suggested_format} (${formats[forcedTheme.suggested_format] || ""}) — 참고만, 재량으로 바꿔도 된다.`,
        "테마 선정 절차는 생략하고 [0단계]는 바로 이 테마의 해부부터 시작하라."
      ]
    : [
        "## 테마 후보 풀 (최근 no_repeat_weeks 내 사용한 테마는 제외됨)",
        ...themePool.map((t) => `- ${t.id}: "${t.name_ko}" — ${t.hook_ko || ""} (근거: ${t.proven_ko || ""}, 추천 형태: ${t.suggested_format})`)
      ];

  return [
    `${weekLabel} 유형테스트를 만든다. "테스트 하나 = 성향 하나"가 원칙이다 — 여러 화제를 섞은 잡탕 문항은 실패작이다.`,
    "",
    ...trendSection,
    ...poolSection,
    "",
    "너는 국내 히트 유형테스트를 수년간 만들어온 제작자다. 아래 순서로 **작업**하라 — 각 단계를 실제로 거치고, 최종 출력은 완성본 JSON 하나만.",
    "",
    "## [0단계 — 테마 선정 + 해부]",
    ...(forcedTheme
      ? []
      : [
          "위 후보 풀에서 아래 선정 기준(quiz_fit_criteria)으로 테마 1개를 정확히 고른다 — '나도 모르는 내 성향·재능·특성'을 알려주는가가 핵심이다.",
          ...criteria.map((c) => `- ${c}`)
        ]),
    "테마를 정했으면 아래를 순서대로 정리한다 (생략하고 바로 문항/유형으로 넘어가지 마라):",
    "① 이 성향이 실제로 드러나는 일상 장면 목록을 최대한 뽑아라 (그 성향이라서 나오는 구체적 행동만).",
    "② 이 테마를 하나도 모르는 친구에게 말해주듯 한 줄 설명을 써라(이게 weeklyBrief가 된다) — 커뮤니티 은어 없이, '이 테스트가 뭘 재는지'가 문장 안에 다 들어가게. weeklyBrief는 1~3개.",
    "③ **형태를 결정하라** — 이 테마는 레벨형(level_bands, 주 지표 %+밴드)이 어울리는가, 유형 조합형(combo_types, 극 조합)이 어울리는가? 후보 풀의 suggested_format을 참고하되 최종 판단은 네 재량이다.",
    "④ 형태를 정했으면 그 성향의 하위 측면(레벨형이면 스타일 축 후보, 조합형이면 축 후보)을 도출하라.",
    "- 테마와 그 안의 핵심 용어를 [국민상식/대중화제/커뮤내수] 3등급으로 분류하라 — '이걸 40대 직장인이 알까?'가 기준. **커뮤내수 등급 용어는: 브리핑에서 반드시 설명하고, 문항 첫 등장 시 문장 안에서 풀어쓰고, 제목에는 쓰지 마라.** (weeklyBrief 각 항목의 tier 필드로 남긴다.)",
    "",
    "## [1단계 — 컨셉 (형태별 축 설계)]",
    "**combo_types를 골랐다면**:",
    "- 심리 축 2~4개를 정의한다(축마다 양극에 코드 1글자 + 매력적인 극 이름). 문항과 유형은 전부 그 축에서 파생시킨다 — 축 2~4개 → 유형 4~16개, 문항 12~16개(축당 3개+).",
    "- 축 이름·극 이름은 이 테마에서 자연스럽게 나와야지, 아무 테마에나 쓸 수 있는 범용어면 약하다.",
    "**level_bands를 골랐다면**:",
    "- 주 지표 축 1개(왼쪽 극이 '성향이 강한 쪽'이 되도록 코드/이름을 정하라 — 채점 시 leftPercent가 곧 레벨 %가 된다) + 선택적 스타일 축 1개(성향의 결이 갈리는 보조 축).",
    "- **`bands` 최상위 필드**: 레벨 % 구간별 밴드 3~5개를 선언한다 — `min`은 0부터, `max`는 100까지, 서로 겹치지 않고 빈틈없이 연속되어야 한다(예: 0~33 / 34~66 / 67~100). 각 밴드에 매력적인 label_ko를 붙여라(예: '무해한 새싹', '인증된 꼰대').",
    "- 문항 9~12개(레벨 축에 최소 3개+, 스타일 축이 있으면 그쪽도 3개+).",
    "- 결과 code = 밴드 code + (스타일 축이 있으면 그 극 code) — 밴드×스타일 조합 전체를 커버해야 한다.",
    "- 축마다 intro를 써라 — 이 축이 뭘 확인하는지 처음 온 사람에게 말해주는 친절 한 줄이다(15~70자).",
    "- 제목에 테마 이름(name_ko)을 그대로 넣어라 (예: '너의 꼰대력은 몇 %일까?'). 아무 테마에나 쓸 수 있는 범용 제목 금지, 테마는 1개만.",
    "",
    "## [2단계 — 문항 초고]",
    "- combo_types는 총 12~16문항(축당 3~4문항, 홀수 권장 — 동점 방지), level_bands는 총 9~12문항. 선택지는 문항당 정확히 4개.",
    "- **문항 상황은 이 성향이 실제로 드러나는 공유된 일상 경험이어야 한다** — 사전지식 없이 누구나 '아 이거 나잖아' 하고 답할 수 있는 장면.",
    "- 직접 자기보고('당신은 외향적입니까?') 금지. 상황 제시형으로:",
    "  좋은 예: \"금요일 밤 단톡방에 '지금 나올 사람?'이 뜬다. 나는 → ① 이미 신발 신는 중 ② 누가 나오는지부터 확인 ③ 읽고 침대에 더 파고든다\"",
    "- '정답' 냄새 금지: 모든 선택지가 각자 매력 있거나 각자 웃겨야 한다. 사회적으로 바람직한 답이 하나뿐인 문항은 실패작.",
    "- 문항당 정확히 1축만 측정. 한 문항의 답변들에 left/right가 골고루 섞여야 한다.",
    "- 같은 상황을 두 문항에 쓰지 마라 — 문항마다 서로 다른 장면으로.",
    "- 같은 축 문항들의 선택지가 같은 문장 골격의 재탕이면 안 된다(예: '끝까지 찾아본다' 3연속 금지).",
    "- 같은 축의 문항들은 미는 방향을 섞어라 (전부 1번 답이 같은 극이면 안 됨 — 역채점 균형).",
    "- 강한 신호인 답변에만 weight 2, 나머지는 1.",
    "- 첫 1~2문항은 가장 쉽고 웃긴 훅으로.",
    "",
    "## [3단계 — 결과 초고]",
    "- **전보체 금지**: 조사·주어를 잘라낸 압축문 대신 완결 문장. 드립은 유지하되 문장은 친절하게.",
    "- 유형/밴드 이름은 점수 언어가 아니라 정체성 언어로, 대화에서 짧게 부를 수 있는 별칭이 되게 (예: '계획으로 세상을 지키는 큐레이터형', 레벨형은 '무해한 새싹').",
    "- 각 결과 서술 첫 문장은 이 성향이 드러나는 구체적 생활 장면으로 시작하라.",
    "- 서술은 220자 이내 — 길수록 AI 티다.",
    "- 서술은 강점 4개 + 성장 포인트 1~2개 (칭찬만 하면 가짜처럼 느껴진다 — 80:20).",
    "- 서술에는 보편적이지만 개인적으로 들리는 문장과, 축 성향에서 직접 도출된 구체 문장을 섞어라.",
    "- 강점·조언을 인사평가/자기계발 톤으로 쓰지 마라 ('습관 들이기', '역량', '성장' 금지) — 친구를 놀리듯 팩폭 톤으로.",
    "- ① 오프닝 문형을 최소 3종 이상 섞어라 — 전부 같은 골격으로 끝나면 그 자체로 템플릿 티다.",
    "- ② 각 극의 약점은 그 극 고유의 것이어야 한다 — 반대 극이 되라는 조언으로 수렴시키지 마라.",
    "- ③ 한 유형 안에서 강점과 약점이 서로 모순되면 안 된다.",
    "- ④ '꽝' 유형을 만들지 마라 — 모든 유형의 강점에 자랑할 맛 나는 우월감형 문구를 최소 1개는 넣어라.",
    "- ⑤ bestMatchReason/worstMatchReason 필드: 왜 잘 맞는지 / 왜 부딪히는지를 한 줄 상황극으로(각 40자 이내) 채워라. **level_bands는 인접 밴드를 bestMatch, 반대쪽 밴드를 worstMatch로 삼는 걸 권장한다(케미가 레벨 거리와 연결되게).**",
    "- ⑥ shareText는 60자 이내, '나는'으로 자기 유형을 선언하되 나머지는 유형마다 완전히 다른 드립으로 써라. 물음표로 끝나는 반문형은 절반 이하로 — 감탄·선언·도발형을 섞어라. **level_bands는 '나는 꼰대력 12%' 식의 수치 자랑도 허용된다.**",
    "- 유형마다 bestMatch(잘 맞는 케미)와 worstMatch(상극 케미)를 다른 유형 code로 지정.",
    "- advice는 '이런 날엔 이렇게' 식의 실행 가능한 조언 2~3개.",
    "- ⑦ weeklyPick 필드: 이 성향이 제일 티 나는 순간을 60자 이내로 채워라 (예: '후배가 다른 방식으로 일할 때 젤 먼저 티 나는 성향이다').",
    "",
    "## [4단계 — 전문가 셀프 검수]",
    "완성본을 제출하기 전에 아래 체크리스트를 하나씩 확인하라. 걸리면 그 자리에서 고치고 다시 검수하라 (걸린 채로 넘어가지 마라):",
    "① 선택지를 소리 내어 읽었을 때 비문·뜻 충돌이 없나",
    "② 결과문에 등장하는 행동이 0단계에서 정리한 행동 목록에 실제로 있나",
    "③ 오프닝 골격이 서로 겹치지 않나",
    "④ shareText 종결이 다양한가 (물음표 일색은 아닌가)",
    "⑤ 한 유형 안에서 강점·약점이 자기모순은 아닌가",
    "⑥ 극마다 다른 조언인데, 전부 반대 극이 되라는 말로 수렴하지 않는가",
    "⑦ 자랑할 맛 없는 '꽝' 유형은 없는가",
    "⑧ 이 테마를 하나도 모르는 친구에게 소리 내어 읽어줬을 때, 브리핑→제목→문항→결과 순서로 전부 이해되는가. 막히는 문장은 그 자리에서 풀어써라.",
    "⑨ 커뮤내수 등급 용어가 설명 없이 노출된 곳이 한 군데라도 있나.",
    "⑩ **전 문항·결과가 테마 하나만 재는가** — 다른 성향이 섞여 들어오지 않았는가(테스트 하나 = 성향 하나 원칙 위반 여부).",
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
export async function generateQuizWithClaude(opts = {}) {
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
      messages: [{ role: "user", content: buildPrompt(opts) }]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`퀴즈 생성 API 오류 (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("모델이 이 테마의 퀴즈 생성을 거절했어요. 테마를 바꿔보세요.");
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

// Deterministic offline fallback: a real level_bands quiz built from the
// pool's first level_bands theme (꼰대력), so the pipeline demos end-to-end
// without network or a key. 주 축 1(레벨) + 스타일 축 1, 밴드 3, 결과 6.
export function templateQuiz(opts = {}) {
  const theme = CONTRACT.theme.pool.find((t) => t.suggested_format === "level_bands") || CONTRACT.theme.pool[0];

  const axes = [
    {
      id: "level",
      name: theme.name_ko,
      intro: "친구·후배에게 '나 때는' 소리가 얼마나 자주 나오는지를 본다.",
      left: { code: "K", label: "라떼 발동" },
      right: { code: "N", label: "쿨내 진동" }
    },
    {
      id: "style",
      name: "잔소리 스타일",
      intro: "하고 싶은 말이 생겼을 때 돌려 말하는지 바로 던지는지를 본다.",
      left: { code: "D", label: "직설파" },
      right: { code: "E", label: "돌려말파" }
    }
  ];

  const bands = [
    { code: "L1", min: 0, max: 33, label_ko: "무해한 새싹" },
    { code: "L2", min: 34, max: 66, label_ko: "은근 있음" },
    { code: "L3", min: 67, max: 100, label_ko: "인증된 꼰대" }
  ];

  // 레벨 축(K/N) 문항 6개 — 첫 답변 극을 문항마다 섞어 역채점 균형(QG1)을
  // 지킨다. 각 세트 좌우 가중치 합 3:3으로 축 균형(QG4)도 지킨다.
  const levelQuestions = [
    {
      q: "후배가 나와 다른 방식으로 일을 처리하는 걸 보면 나는?",
      axis: "level",
      answers: [
        { text: "나 때는 이렇게 안 했다고 한마디 한다", pole: "left", weight: 2 },
        { text: "물어보면 그때 알려준다", pole: "left", weight: 1 },
        { text: "결과만 좋으면 신경 안 쓴다", pole: "right", weight: 1 },
        { text: "오히려 배울 점을 찾는다", pole: "right", weight: 2 }
      ]
    },
    {
      q: "단톡방에 처음 보는 신조어가 올라오면 나는?",
      axis: "level",
      answers: [
        { text: "찾아보고 자연스럽게 써먹는다", pole: "right", weight: 2 },
        { text: "모르면 그냥 넘어간다", pole: "right", weight: 1 },
        { text: "무슨 뜻인지 꼭 물어서 확인한다", pole: "left", weight: 1 },
        { text: "요즘 애들은 이런다고 한마디 얹는다", pole: "left", weight: 2 }
      ]
    },
    {
      q: "회식 자리에서 나는?",
      axis: "level",
      answers: [
        { text: "다들 한 잔씩 받아야 한다고 생각한다", pole: "left", weight: 2 },
        { text: "건배사는 순서대로 해야 맛이라 본다", pole: "left", weight: 1 },
        { text: "각자 알아서 마시게 둔다", pole: "right", weight: 1 },
        { text: "먼저 일어나도 뭐라 안 한다", pole: "right", weight: 2 }
      ]
    },
    {
      q: "옷차림이 예전과 확 달라진 후배를 보면 나는?",
      axis: "level",
      answers: [
        { text: "요즘 스타일이네 하고 넘어간다", pole: "right", weight: 1 },
        { text: "오히려 어디서 샀는지 물어본다", pole: "right", weight: 2 },
        { text: "그렇게 입고 다니냐고 한마디 한다", pole: "left", weight: 2 },
        { text: "속으로만 생각하고 넘긴다", pole: "left", weight: 1 }
      ]
    },
    {
      q: "메신저 답장이 한참 늦게 오면 나는?",
      axis: "level",
      answers: [
        { text: "예의가 없다고 느낀다", pole: "left", weight: 2 },
        { text: "왜 늦었는지 궁금해진다", pole: "left", weight: 1 },
        { text: "바빴나 보다 하고 넘긴다", pole: "right", weight: 1 },
        { text: "나도 늦게 답하는 편이라 신경 안 쓴다", pole: "right", weight: 2 }
      ]
    },
    {
      q: "새로 나온 프로그램·앱을 꼭 써야 할 때 나는?",
      axis: "level",
      answers: [
        { text: "귀찮아도 일단 써본다", pole: "right", weight: 1 },
        { text: "오히려 먼저 나서서 배운다", pole: "right", weight: 2 },
        { text: "예전 방식이 더 편하다고 버틴다", pole: "left", weight: 2 },
        { text: "일단 배워는 보되 투덜댄다", pole: "left", weight: 1 }
      ]
    }
  ];

  // 스타일 축(D/E) 문항 3개.
  const styleQuestions = [
    {
      q: "잔소리하고 싶은 상황이 생기면 나는?",
      axis: "style",
      answers: [
        { text: "바로 이야기해서 확실히 짚는다", pole: "left", weight: 2 },
        { text: "여러 번 생각한 뒤 직접 말한다", pole: "left", weight: 1 },
        { text: "다른 사람 통해 슬쩍 흘린다", pole: "right", weight: 1 },
        { text: "그냥 눈치껏 알아채길 바란다", pole: "right", weight: 2 }
      ]
    },
    {
      q: "후배 실수를 지적할 일이 생기면 나는?",
      axis: "style",
      answers: [
        { text: "티 안 나게 돌려서 알려준다", pole: "right", weight: 2 },
        { text: "다음에 지나가듯 언급한다", pole: "right", weight: 1 },
        { text: "따로 불러서 직접 말한다", pole: "left", weight: 1 },
        { text: "그 자리에서 바로 짚어준다", pole: "left", weight: 2 }
      ]
    },
    {
      q: "의견이 다를 때 나는?",
      axis: "style",
      answers: [
        { text: "생각을 그대로 말한다", pole: "left", weight: 2 },
        { text: "요점만 정리해서 말한다", pole: "left", weight: 1 },
        { text: "분위기 봐가며 살짝 얹는다", pole: "right", weight: 1 },
        { text: "굳이 말 안 하고 넘어간다", pole: "right", weight: 2 }
      ]
    }
  ];

  const questions = [...levelQuestions, ...styleQuestions];

  const results = [
    {
      code: "L1D",
      title: "무해한 새싹 · 직설파",
      description:
        "잔소리할 상황이 와도 일단 넘기는 편이고, 어쩌다 한마디 하게 되면 돌리지 않고 바로 말해버린다. 꼰대력은 낮은데 스타일은 시원시원한 타입이다.",
      strengths: ["웬만하면 참견 안 한다", "할 말 있으면 숨기지 않고 바로 한다", "뒤끝이 없다", "눈치 보느라 스트레스 안 받는다"],
      weaknesses: ["가끔 훅 들어오는 말에 상대가 놀랄 수 있다"],
      advice: ["중요한 말일수록 타이밍만 살짝 신경 써보자"],
      bestMatch: "L2D",
      worstMatch: "L3E",
      bestMatchReason: "둘 다 직설파라 대화가 빠르고 시원하다",
      worstMatchReason: "L3E는 돌려 말하는데 훈수까지 많아 답답하다",
      shareText: "나는 무해한 새싹! 참견은 없고 할 말은 바로 한다 — 너 이거 인정하지",
      weeklyPick: "후배가 다른 방식으로 일할 때 젤 먼저 티 나는 성향이다"
    },
    {
      code: "L1E",
      title: "무해한 새싹 · 돌려말파",
      description:
        "훈수 본능 자체가 약한 편인데, 어쩌다 한마디 할 일이 생기면 돌려서 슬쩍 흘린다. 꼰대력 낮음 + 돌려말 스타일 조합이다.",
      strengths: ["분위기를 안 깨고 넘어간다", "상대가 상처 안 받게 배려한다", "눈치가 빠르다", "오래 봐도 편한 사람이다"],
      weaknesses: ["돌려 말해서 상대가 못 알아들을 때가 있다"],
      advice: ["진짜 중요한 건 한 번은 직접 말해보자"],
      bestMatch: "L2E",
      worstMatch: "L3D",
      bestMatchReason: "둘 다 돌려 말해서 부딪힐 일이 없다",
      worstMatchReason: "L3D는 훈수도 많고 직설적이라 부담스럽다",
      shareText: "나는 돌려 말하는 무해한 새싹이다 — 너도 이 스타일이지",
      weeklyPick: "신조어 못 알아들어도 티 안 내고 슬쩍 찾아보는 타입이다"
    },
    {
      code: "L2D",
      title: "은근 있음 · 직설파",
      description:
        "평소엔 안 그런 척하다가도 후배 옷차림이나 말투에 한마디씩 얹는 편이다. 참을 땐 참지만 터지면 바로 직설로 나간다.",
      strengths: ["할 말은 결국 하고야 만다", "선 넘는 건 확실히 짚는다", "솔직해서 뒤에서 말 안 나온다", "할 때 하고 안 할 때 안 한다"],
      weaknesses: ["타이밍을 못 맞출 때가 있다", "가끔 훈수가 길어진다"],
      advice: ["한마디로 끝낼 것도 세 마디로 늘리지 말자", "꼭 필요한 순간만 골라 말해보자"],
      bestMatch: "L1D",
      worstMatch: "L3E",
      bestMatchReason: "L1D는 가볍게 받아주니 대화가 편하다",
      worstMatchReason: "L3E는 돌려 말하면서 은근히 세게 나온다",
      shareText: "나는 은근 있음, 평소엔 조용하다 훅 들어간다! 인정?",
      weeklyPick: "회식 자리에서 술잔 순서 챙길 때 제일 티 나는 성향이다"
    },
    {
      code: "L2E",
      title: "은근 있음 · 돌려말파",
      description:
        "훈수하고 싶은 마음은 있는데 티 안 나게 돌려서 흘리는 타입이다. 나중에 보면 은근 다 챙기고 있었던 사람이다.",
      strengths: ["기분 안 상하게 알려준다", "눈치껏 상황을 조율한다", "돌려 말해도 결국 전달은 된다", "분위기 메이커에 가깝다"],
      weaknesses: ["의도를 못 알아채는 사람에겐 안 먹힌다", "가끔 너무 돌려서 핵심이 흐려진다"],
      advice: ["결정적인 한마디는 직접 해보자", "돌려 말한 다음엔 확인 한 번 하자"],
      bestMatch: "L1E",
      worstMatch: "L3D",
      bestMatchReason: "둘 다 돌려 말해서 편하게 흘러간다",
      worstMatchReason: "L3D는 직설로 세게 들어와 부담스럽다",
      shareText: "나는 은근 있음 돌려말파, 다 챙기지만 티는 안 낸다 — 너는?",
      weeklyPick: "메신저 답장 늦으면 은근 서운해도 티 안 내는 타입이다"
    },
    {
      code: "L3D",
      title: "인증된 꼰대 · 직설파",
      description:
        "나 때는 소리가 자동으로 나오고, 할 말은 절대 참지 않는다. 후배 옷차림부터 메신저 답장 속도까지 다 한마디씩 보태는 완전체다.",
      strengths: ["할 말은 반드시 전달된다", "경험에서 나온 조언이 은근 도움될 때도 있다", "솔직함 하나는 확실하다", "뒤에서 다른 말 안 한다"],
      weaknesses: ["듣는 사람이 부담스러워한다", "안 물어봐도 훈수를 시작한다"],
      advice: ["물어보기 전엔 참는 연습을 해보자", "조언은 짧게, 한 번만 하자"],
      bestMatch: "L2D",
      worstMatch: "L1E",
      bestMatchReason: "L2D는 훈수를 어느 정도 받아준다",
      worstMatchReason: "L1E는 훈수 자체를 안 좋아해서 부딪힌다",
      shareText: "나는 인증된 꼰대, 할 말은 절대 못 참는다 — 인정 못 해?",
      weeklyPick: "새 앱 쓰라고 할 때 예전 방식 고집하는 게 제일 티 난다"
    },
    {
      code: "L3E",
      title: "인증된 꼰대 · 돌려말파",
      description:
        "훈수는 다 하는데 방식만 돌려서 한다 — 지나가듯 던지는 말에 사실 다 담겨 있다. 꼰대력은 최고치인데 스타일만 은근한 타입이다.",
      strengths: ["기분 안 상하게 훈수를 전달한다", "분위기는 안 깬다", "경험담이 은근 쓸모 있을 때가 있다", "눈치는 빠르다"],
      weaknesses: ["결국 훈수라는 건 다 티 난다", "돌려 말해서 더 길게 늘어진다"],
      advice: ["하고 싶은 말은 짧게 줄여보자", "진짜 필요할 때만 꺼내자"],
      bestMatch: "L2E",
      worstMatch: "L1D",
      bestMatchReason: "L2E는 돌려 말하는 결을 이해해준다",
      worstMatchReason: "L1D는 직설이라 돌려 말하면 답답해한다",
      shareText: "나는 인증된 꼰대인데 돌려서 말한다 — 너만 몰랐지",
      weeklyPick: "회식에서 다들 마셔야 한다고 은근 압박 주는 게 티 난다"
    }
  ];

  const weeklyBrief = [
    {
      topic: "꼰대력이란",
      intro: "나이와 상관없이 잔소리·훈수 본능이 얼마나 강한지 재는 성향 축이야 — 20대도 꼰대력 높게 나올 수 있어.",
      tier: "대중화제"
    }
  ];

  const quiz = {
    theme: { id: theme.id, name_ko: theme.name_ko, format: "level_bands", hook_ko: theme.hook_ko },
    title: `너의 ${theme.name_ko}은 몇 %일까?`,
    description: "잔소리 앞에서 참는 편인지 못 참는 편인지, 스타일까지 솔직하게 재보는 자가진단.",
    weeklyBrief,
    axes,
    bands,
    questions,
    results
  };
  validateQuiz(quiz);
  return quiz;
}

// All pole-code combinations in axis order ("EP", "EA", ... ) — combo_types.
export function allTypeCodes(axes) {
  let codes = [""];
  for (const axis of axes) {
    codes = codes.flatMap((c) => [c + axis.left.code, c + axis.right.code]);
  }
  return codes;
}

// All band × style-pole code combinations — level_bands. styleAxis may be
// null/undefined (no style axis → codes are just the band codes).
export function allLevelCodes(bands, styleAxis) {
  const bandCodes = (bands || []).map((b) => b.code);
  if (!styleAxis) return bandCodes;
  const poles = [styleAxis.left.code, styleAxis.right.code];
  return bandCodes.flatMap((bc) => poles.map((pc) => bc + pc));
}

// Structural validation shared by both generation paths. Enforces the design
// spec — anything the structured-outputs schema can't express (cross-
// references, balance rules, counts, format-dependent shape).
export function validateQuiz(quiz) {
  if (!quiz || typeof quiz !== "object") throw new Error("퀴즈가 비어 있어요.");
  if (!quiz.title || !quiz.description) throw new Error("퀴즈 제목/설명이 없어요.");

  // 테마 — David 확정(2026-07-26): 테마가 이 퀴즈의 주인이다.
  if (!quiz.theme || typeof quiz.theme !== "object") throw new Error("테마(theme)가 없어요.");
  if (!quiz.theme.id || !quiz.theme.name_ko) throw new Error("테마 id/name_ko가 없어요.");
  const format = quiz.theme.format;
  if (format !== "combo_types" && format !== "level_bands") {
    throw new Error(`테마 format이 잘못됐어요 (combo_types 또는 level_bands여야 해요): ${format}`);
  }

  // 사전설명(브리핑) — "이 테스트가 재는 것"을 하나도 모르는 사람도 시작
  // 전에 이해하게. 존재·intro 15~90자·비어있지 않음·친숙도 등급(tier)이
  // 매니페스트 선언 목록 안에 있는지 검증. 개수(1~3) 검사는 gates.js
  // theme_coherence가 담당한다(형식이 아니라 바이럴 조건이라서).
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

  // 축: 개수는 format에 따라 다르다. id/극코드 유일, intro(이 축이 뭘
  // 확인하는지 설명) 필수 — 형식과 무관하게 공통.
  if (!Array.isArray(quiz.axes)) throw new Error("심리 축이 없어요.");
  if (format === "combo_types") {
    if (quiz.axes.length < 2 || quiz.axes.length > 4) throw new Error("심리 축은 2~4개여야 해요.");
  } else {
    if (quiz.axes.length < 1 || quiz.axes.length > 2) throw new Error("레벨형은 축이 1~2개(주 지표+선택 스타일)여야 해요.");
  }
  const axisIds = new Set();
  const poleCodes = new Set();
  for (const axis of quiz.axes) {
    if (!axis.id || !axis.name) throw new Error("축 id/이름이 비었어요.");
    if (axisIds.has(axis.id)) throw new Error(`축 id가 중복돼요: ${axis.id}`);
    axisIds.add(axis.id);
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

  // level_bands 전용: bands 최상위 필드 — 3~5개, 0~100 연속 커버·겹침 금지.
  let styleAxis = null;
  if (format === "level_bands") {
    if (!Array.isArray(quiz.bands) || quiz.bands.length < 3 || quiz.bands.length > 5) {
      throw new Error("레벨형은 밴드(bands)가 3~5개여야 해요.");
    }
    const sorted = [...quiz.bands].sort((a, b) => a.min - b.min);
    const bandCodes = new Set();
    for (const b of sorted) {
      if (!b.code || !String(b.code).trim()) throw new Error("밴드 code가 비었어요.");
      if (bandCodes.has(b.code)) throw new Error(`밴드 code가 중복돼요: ${b.code}`);
      bandCodes.add(b.code);
      if (!b.label_ko || !String(b.label_ko).trim()) throw new Error(`밴드 ${b.code}의 label_ko가 비었어요.`);
      if (typeof b.min !== "number" || typeof b.max !== "number" || b.min > b.max) {
        throw new Error(`밴드 ${b.code}의 min/max가 잘못됐어요.`);
      }
    }
    if (sorted[0].min !== 0) throw new Error("밴드가 0%부터 시작해야 해요(연속 커버).");
    if (sorted[sorted.length - 1].max !== 100) throw new Error("밴드가 100%까지 커버해야 해요(연속 커버).");
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].min !== sorted[i - 1].max + 1) {
        throw new Error(`밴드 ${sorted[i - 1].code}·${sorted[i].code} 사이가 겹치거나 비어 있어요(연속 커버, 겹침 금지).`);
      }
    }
    if (quiz.axes.length === 2) styleAxis = quiz.axes[1];
  }

  // 문항: format별 총 개수 범위, 축당 3개 이상, 문항당 1축, 양극이 답변에
  // 모두 존재.
  const qs = Array.isArray(quiz.questions) ? quiz.questions : null;
  const [qMin, qMax] = format === "combo_types" ? [12, 16] : [9, 12];
  if (!qs || qs.length < qMin || qs.length > qMax) {
    throw new Error(`문항은 ${qMin}~${qMax}개여야 해요 (${format === "combo_types" ? "유형 조합형" : "레벨형"} 스펙).`);
  }
  const perAxis = {};
  for (const q of qs) {
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

  // 유형: format에 맞는 코드 조합을 정확히 커버, 80:20 서술, 궁합 상호 참조
  const codes = format === "combo_types" ? allTypeCodes(quiz.axes) : allLevelCodes(quiz.bands, styleAxis);
  if (!Array.isArray(quiz.results)) throw new Error("결과 유형이 없어요.");
  const resultCodes = new Set(quiz.results.map((r) => r.code));
  if (resultCodes.size !== quiz.results.length) throw new Error("유형 code가 중복돼요.");
  for (const c of codes) {
    if (!resultCodes.has(c)) throw new Error(`유형 조합 ${c}의 결과가 없어요.`);
  }
  if (quiz.results.length !== codes.length) throw new Error("유형 수가 코드 조합 수와 달라요.");
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
    if (!r.bestMatchReason || !String(r.bestMatchReason).trim()) throw new Error(`유형 ${r.code}의 bestMatchReason이 비었어요.`);
    if (!r.worstMatchReason || !String(r.worstMatchReason).trim()) throw new Error(`유형 ${r.code}의 worstMatchReason이 비었어요.`);
    if (String(r.bestMatchReason).length > 40) throw new Error(`유형 ${r.code}의 bestMatchReason이 40자를 넘어요.`);
    if (String(r.worstMatchReason).length > 40) throw new Error(`유형 ${r.code}의 worstMatchReason이 40자를 넘어요.`);
    if (!r.weeklyPick || !String(r.weeklyPick).trim()) throw new Error(`유형 ${r.code}의 weeklyPick이 비었어요.`);
    if (String(r.weeklyPick).length > 60) throw new Error(`유형 ${r.code}의 weeklyPick이 60자를 넘어요.`);
  }
  return true;
}

// Dispatch: live generation when a key is available, template otherwise.
export async function generateQuiz(opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { quiz: await generateQuizWithClaude({ ...opts, apiKey }), via: "claude" };
  }
  return { quiz: templateQuiz(opts), via: "template" };
}

// URL slug: week label + a short stable hash of the title, so slugs are
// unique per week without needing to transliterate Korean titles.
export function quizSlug(quiz, weekLabel) {
  let h = 0;
  for (const ch of String(quiz.title)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `${weekLabel}-${h.toString(36)}`;
}
