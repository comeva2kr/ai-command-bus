// 브리핑 해설 생성 — Claude API.
//
// ── 왜 도입했나 (2026-08-04)
// 카카오 애드핏 매체 심사 보류 사유 ①: "자체 콘텐츠가 아닌 외부 콘텐츠, 외부
// 링크가 많은 비중을 차지하고 있는 매체는 광고게재가 허용되지 않습니다."
//
// 벤치마킹(오늘의베스트 todaybeststory.com) 실측: 외부 링크 비중은 그쪽도
// 우리와 비슷했다(홈 기준 외부 55 / 내부 16). 차이는 **자체 생성 텍스트의
// 절대량**이었다. 그쪽 "AI 브리핑"은 골격이 우리와 같은데(모닝·런치·이브닝,
// 분석 게시글 수, 커뮤니티 수, 한 줄 요약) 이슈마다 3~4문장 해설과 종합 분석
// 문단이 붙어 한 편의 텍스트가 우리보다 5~10배 많다.
//
// 우리 digest.js는 측정값을 문장으로 옮기는 데까지는 이미 한다. 비어 있는 건
// "해석하는 문장"뿐이라, 그 부분만 LLM에 맡긴다.
//
// ── 토큰 효율 (David: "가장 적은 토큰으로 가장 좋은 효율")
// 1. 하루 3회만 호출하고 결과를 디스크에 저장한다. 페이지를 볼 때마다 부르지
//    않는다 — 조회수가 늘어도 비용은 그대로다.
// 2. 입력은 이슈당 제목 3개와 측정값뿐. 본문·URL·발췌는 안 보낸다.
// 3. effort는 low. 레퍼런스상 Opus 5는 low/medium이 이례적으로 강하고,
//    effort가 비용의 주 레버다. 해설 문장 쓰기는 난도가 낮은 축이다.
// 4. **프롬프트 캐싱은 쓰지 않는다.** 호출이 몇 시간 간격이라 5분 TTL 안에
//    재사용이 안 된다. 캐시 쓰기(1.25배)만 내고 읽기가 0이면 순손해다.
// 5. 구조화 출력으로 JSON을 강제해 재시도·파싱 실패를 없앤다.
//
// ── 환각 차단
// 숫자는 **코드가 박는다.** 모델에는 해석 문장만 시키고, 생성된 문장에 입력에
// 없던 숫자가 섞이면 그 이슈는 통째로 버리고 규칙 기반 문장으로 되돌린다.
// "실측 안 된 숫자 절대 금지"가 이 저장소의 오래된 원칙이고, 생성 모델을
// 들인다고 그게 느슨해질 이유는 없다.
const API_URL = "https://api.anthropic.com/v1/messages";
// 기본값 Sonnet 5. 판단 근거(2026-08-04, David "객관적으로"):
//
// - 토큰 수는 두 모델이 같다. Sonnet 5는 Opus 4.7/4.8과 같은 토크나이저를
//   쓰고 Opus 5도 같은 계열이라, 같은 글이면 토큰이 같다. 순수 단가 차이다.
// - 단가: Opus 5 $5/$25, Sonnet 5 $3/$15 (2026-08-31까지 도입가 $2/$10)
// - 이 작업(하루 3회, 입력 ~1.5k·출력 ~2k)이면 월 $5.2 대 $2.1.
//   **차이가 월 3~4천원이라 비용은 판단 근거가 못 된다.**
// - 근거가 되는 건 확장이다. 카테고리 브리핑 10종에 붙이면 하루 30회가 되고
//   월 $52 대 $21로 벌어진다. 그 확장은 /briefing/<카테고리>가 이미 있어
//   자연스러운 다음 수순이다.
// - 작업 성격: 2~4문장, 숫자 금지, 정치 중립. 제약이 강하고 짧다.
//   뒤에 검증기가 있어 실패해도 규칙 기반으로 안전하게 떨어진다.
//
// 아직 안 해 본 것: 한국어 문장 품질의 실제 비교. 키가 들어오면 같은
// 브리핑으로 두 모델을 돌려 보고, 품질이 모자라면 env 한 줄로 옮긴다.
// 요청 형식은 두 모델이 동일해서 바꿀 코드가 없다.
const MODEL = process.env.LLM_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

// 출력 스키마 — 이슈별 해설 + 종합 분석. 모델이 형식을 어길 여지를 없앤다.
const SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          paragraph: { type: "string" }
        },
        required: ["n", "paragraph"],
        additionalProperties: false
      }
    },
    summary: { type: "string" }
  },
  required: ["issues", "summary"],
  additionalProperties: false
};

const SYSTEM = `당신은 한국 커뮤니티·뉴스 큐레이션 서비스 "지금핫"의 편집자입니다.
주어진 화제 목록을 읽고, 각 이슈가 무엇이고 어떤 반응이 오갔는지 해설합니다.

규칙:
- 주어진 제목과 출처에 없는 사실을 만들지 마십시오. 배경지식으로 채우지 마십시오.
- **숫자를 쓰지 마십시오.** 추천 수, 댓글 수, 건수, 날짜, 비율 등 어떤 숫자도
  문장에 넣지 마십시오. 수치는 시스템이 따로 붙입니다.
- 이슈당 2~4문장. 무슨 일인지, 어느 커뮤니티에서 어떻게 받아들여졌는지,
  그게 무엇을 보여주는지 순으로 씁니다.
- 제목을 그대로 옮겨 적지 말고 요약해서 서술하십시오.
- 추천 수·댓글 수·조회 수 같은 **반응 수치는 언급하지 마십시오.** 글의 내용과
  어떤 반응이 오갔는지를 쓰되, 그 크기를 수로 말하지 마십시오. 수치는 시스템이
  따로 붙입니다.
- 담백한 신문 해설체. 감탄사, 이모지, 과장된 수식어를 쓰지 마십시오.
- 정치적 사안은 어느 편도 들지 말고 양쪽 반응을 그대로 기술하십시오.
- summary는 그날 전체의 성격을 3~4문장으로 해석합니다. 여기도 숫자 금지.`;

// 입력 만들기 — 이슈당 제목 3개와 출처만. 본문·URL·발췌는 보내지 않는다.
//
// ── 헤드라인을 보내지 않는 이유 (2026-08-04 라이브 실측)
// 처음엔 우리가 만든 이슈 헤드라인을 그대로 넘겼는데, 그게
// "해커뉴스 · 추천 388건" 같은 **수치 문구**다. 모델에게 "이 이슈의 주제는
// 추천 388건"이라고 알려준 셈이라, 모델은 당연히 그 수치를 설명했고
// 검증기가 전부 막았다 — 6개 중 3개만 통과했다.
// 모델 잘못이 아니라 입력 설계 문제였다. 이제 **글 제목**을 주제로 넘기고
// 수치는 아예 보내지 않는다. 수치는 코드가 따로 붙인다.
export function buildPrompt(brief) {
  const lines = (brief.issues || []).map((is, n) => {
    const refs = (is.refs || []).slice(0, 3);
    const titles = refs.map((r) => `  - ${r.title} (${r.sourceLabel})`);
    // 성격(논쟁/호응/다발 보도)만 힌트로 준다 — 그 자체는 수치가 아니다.
    return `[${n + 1}] 성격: ${is.tone}\n${titles.join("\n")}`;
  });
  return `다음은 지금 한국 커뮤니티와 뉴스에서 화제인 사안들입니다.\n각 사안은 글 제목으로 주어집니다. 제목이 말하는 **내용**을 해설하십시오.\n\n${lines.join("\n\n")}`;
}

// 생성 문장 검증. 걸리면 그 이슈는 버리고 규칙 기반 문장을 쓴다.
//
// ── 판정 기준 (2026-08-04 실측 후 정밀화)
// 처음엔 숫자를 통째로 막았는데, 실제로 돌려 보니 양쪽으로 틀렸다.
//   너무 적게 막음: "열 가지", "스물" 같은 한글 고유수사를 안 걸렀다.
//   너무 많이 막음: 제목에 있던 "성과 10가지"를 옮겨 쓴 것까지 버렸다.
//                   그건 지어낸 게 아니라 출처에 있는 사실이다.
// 실측에서 6개 중 5개만 통과한 게 후자 때문이었다.
//
// 막아야 할 것은 **지어낸 수치**지 내용을 설명하는 수가 아니다. 그래서
// 기준을 "입력에 없던 수를 썼는가"로 바꿨다 — 출처 제목에 있던 숫자는
// 통과하고, 모델이 만들어 낸 숫자만 걸린다. 판정이 기계적이라 사람 판단이
// 끼어들 여지도 없다.
//
// 여기에 반응 수치는 한 겹 더 막는다. "추천 300", "댓글 수백 건"처럼
// 우리가 재서 붙이는 값을 모델이 문장 안에 또 쓰면, 설령 입력에 있던
// 수라도 우리 수치와 어긋날 위험이 있다 — 그 자리는 코드가 채운다.
const NUM_WORD = "[0-9〇一二三四五六七八九十百千万億일이삼사오육칠팔구십백천만억하나둘셋넷다섯여섯일곱여덟아홉열스물서른마흔쉰수몇여러]";
const METRIC = new RegExp(`(추천|댓글|조회|반응|좋아요)\\s*(수|가|은|는|이)?\\s*${NUM_WORD}|${NUM_WORD}[여만천]?\\s*(건|개|명|회)\\s*(의)?\\s*(추천|댓글|조회|반응)`);

const digits = (t) => new Set((String(t).match(/[0-9]+/g) || []));

export function validParagraph(text, { min = 40, max = 700, source = "" } = {}) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < min || t.length > max) return false;
  if (/<[^>]+>/.test(t)) return false;              // 태그 누출

  // ① 입력에 없던 숫자 = 지어낸 수
  const allowed = digits(source);
  for (const n of digits(t)) if (!allowed.has(n)) return false;

  // ② 반응 수치는 입력에 있어도 문장에 쓰지 않는다 — 그 자리는 코드가 채운다
  if (METRIC.test(t)) return false;

  return true;
}

// 구조화 출력 호출의 공통 한 벌. 브리핑 해설과 개인판 편집·검증이 같은
// HTTP·거절·토큰 기록 경계를 공유해 공급자 호출 코드를 중복하지 않는다.
export async function callStructuredMessage({
  apiKey,
  model = MODEL,
  system,
  prompt,
  schema,
  maxTokens = 4000,
  fetchImpl = fetch,
  onUsage = null,
  purpose = "구조화 LLM",
  timeoutMs = 120000
} = {}) {
  if (!apiKey) throw new Error("missing api key");
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    output_config: /-4-5$|haiku/.test(model)
      ? { format: { type: "json_schema", schema } }
      : { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }]
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    let type = "";
    let providerMessage = "";
    try {
      const body = await res.json();
      if (/^[a-z_]+$/.test(body?.error?.type || "")) type = ` ${body.error.type}`;
      if (typeof body?.error?.message === "string") providerMessage = body.error.message.trim().slice(0, 500);
    } catch {}
    const error = new Error(`api ${res.status}${type}`);
    error.providerMessage = providerMessage;
    error.requestId = res.headers?.get?.("request-id") || "";
    throw error;
  }
  const response = await res.json();
  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error("truncated");
  const text = (response.content || []).find((block) => block.type === "text");
  if (!text) throw new Error("no text block");
  const usage = response.usage || {};
  if (onUsage) {
    try {
      onUsage({
        model,
        purpose,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens
      });
    } catch {}
  }
  return { parsed: JSON.parse(text.text), usage, model };
}

// 하루 3회(모닝·런치·이브닝)만 부르고 저장한다. 같은 슬롯을 다시 요청하면
// 저장분을 그대로 준다 — 페이지 조회수가 늘어도 API 호출은 늘지 않는다.
export function makeWriter({
  apiKey,
  model = MODEL,
  fetchImpl = fetch,
  store = null,          // { get(key), set(key, value) } — 없으면 메모리
  log = () => {},
  // 호출 실비 기록 훅 (costs.js). 토큰 수를 아는 유일한 자리가 여기다 —
  // 여기서 안 붙이면 "이번 달 API로 얼마 썼나"를 영영 알 수 없다.
  onUsage = null,
  timeoutMs = 120000
} = {}) {
  const mem = new Map();
  const cache = store || { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };

  async function call(brief) {
    return callStructuredMessage({
      apiKey,
      model,
      system: SYSTEM,
      prompt: buildPrompt(brief),
      schema: SCHEMA,
      maxTokens: 4000,
      fetchImpl,
      onUsage,
      purpose: "브리핑 해설",
      timeoutMs
    });
  }

  // brief를 받아 해설이 채워진 사본을 돌려준다.
  // 키가 없거나 호출이 실패하면 **원본을 그대로** 돌려준다 — 브리핑 페이지가
  // 비는 일은 없어야 한다. LLM은 덧칠이지 골격이 아니다.
  return async function enrich(brief, cacheKey) {
    if (!apiKey || !brief || !(brief.issues || []).length) return brief;

    const hit = cache.get(cacheKey);
    if (hit) return hit;

    const promptText = buildPrompt(brief);
    let out;
    try {
      out = await call(brief);
    } catch (e) {
      log(`[llm] ${e.message}`);
      return brief;
    }

    const byN = new Map((out.parsed.issues || []).map((x) => [x.n, x.paragraph]));
    let written = 0;
    const issues = brief.issues.map((is, n) => {
      const p = byN.get(n + 1);
      if (!validParagraph(p, { source: promptText })) return is;
      written++;
      // 측정값 문장(is.paragraph)은 해설 뒤에 그대로 남긴다. 해석은 모델이,
      // 수치는 우리가 — 독자는 둘 다 본다.
      return { ...is, essay: p.trim() };
    });
    const summary = validParagraph(out.parsed.summary, { min: 40, max: 900, source: promptText })
      ? out.parsed.summary.trim() : null;

    const result = { ...brief, issues, essay: summary, llm: { written, model } };
    log(`[llm] ${written}/${brief.issues.length}개 해설 · 입력 ${out.usage.input_tokens || "?"} 출력 ${out.usage.output_tokens || "?"} 토큰`);
    cache.set(cacheKey, result);
    return result;
  };
}
