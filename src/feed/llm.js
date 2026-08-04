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
const MODEL = "claude-opus-5";
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
- 담백한 신문 해설체. 감탄사, 이모지, 과장된 수식어를 쓰지 마십시오.
- 정치적 사안은 어느 편도 들지 말고 양쪽 반응을 그대로 기술하십시오.
- summary는 그날 전체의 성격을 3~4문장으로 해석합니다. 여기도 숫자 금지.`;

// 입력 만들기 — 이슈당 제목 3개와 출처만. 본문·URL·발췌는 보내지 않는다.
export function buildPrompt(brief) {
  const lines = (brief.issues || []).map((is, n) => {
    const titles = (is.refs || []).slice(0, 3).map((r) => `  - ${r.title} (${r.sourceLabel})`);
    return `[${n + 1}] ${is.headline}\n  성격: ${is.tone}\n${titles.join("\n")}`;
  });
  return `다음은 지금 한국 커뮤니티와 뉴스에서 화제인 사안들입니다.\n\n${lines.join("\n\n")}`;
}

// 생성 문장 검증. 하나라도 걸리면 그 이슈는 버리고 규칙 기반 문장을 쓴다.
//
// 숫자를 통째로 막는 이유: 모델이 "댓글 300여 개"처럼 그럴듯한 수를 지어내면
// 사람 눈에는 사실처럼 보이는데 우리는 그 수를 잰 적이 없다. 잰 수치는 코드가
// 붙이므로 생성 문장에는 숫자가 있을 이유가 없다.
export function validParagraph(text, { min = 40, max = 700 } = {}) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < min || t.length > max) return false;
  if (/[0-9]/.test(t)) return false;          // 아라비아 숫자
  // 한자·한글 수사도 막는다. "십여 건", "수백 개"처럼 세어 본 적 없는 양을
  // 문장으로 쓰면 아라비아 숫자와 똑같이 지어낸 수치다.
  if (/[〇一二三四五六七八九十百千万億일이삼사오육칠팔구십백천만억수여러몇]\s*[여명]?\s*(개|건|명|곳|위|배|퍼센트|%)/.test(t)) return false;
  if (/<[^>]+>/.test(t)) return false;         // 태그 누출
  return true;
}

// 하루 3회(모닝·런치·이브닝)만 부르고 저장한다. 같은 슬롯을 다시 요청하면
// 저장분을 그대로 준다 — 페이지 조회수가 늘어도 API 호출은 늘지 않는다.
export function makeWriter({
  apiKey,
  model = MODEL,
  fetchImpl = fetch,
  store = null,          // { get(key), set(key, value) } — 없으면 메모리
  log = () => {},
  timeoutMs = 120000
} = {}) {
  const mem = new Map();
  const cache = store || { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };

  async function call(brief) {
    const body = {
      model,
      max_tokens: 4000,          // 사고 + 본문 합산 상한. 본문은 1.5k 안팎이라 여유.
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA }
      },
      messages: [{ role: "user", content: buildPrompt(brief) }]
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
      // 본문을 읽어 흘려보낸다 — 안 읽으면 연결이 남아 서버가 죽는다(2026-08-02 사례).
      try { await res.text(); } catch {}
      throw new Error(`api ${res.status}`);
    }
    const j = await res.json();

    // 안전 분류기가 요청을 거절하면 HTTP 200에 stop_reason=refusal로 온다.
    // content를 먼저 읽으면 빈 배열에서 터진다.
    if (j.stop_reason === "refusal") throw new Error("refusal");
    if (j.stop_reason === "max_tokens") throw new Error("truncated");

    const text = (j.content || []).find((b) => b.type === "text");
    if (!text) throw new Error("no text block");
    return { parsed: JSON.parse(text.text), usage: j.usage || {} };
  }

  // brief를 받아 해설이 채워진 사본을 돌려준다.
  // 키가 없거나 호출이 실패하면 **원본을 그대로** 돌려준다 — 브리핑 페이지가
  // 비는 일은 없어야 한다. LLM은 덧칠이지 골격이 아니다.
  return async function enrich(brief, cacheKey) {
    if (!apiKey || !brief || !(brief.issues || []).length) return brief;

    const hit = cache.get(cacheKey);
    if (hit) return hit;

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
      if (!validParagraph(p)) return is;
      written++;
      // 측정값 문장(is.paragraph)은 해설 뒤에 그대로 남긴다. 해석은 모델이,
      // 수치는 우리가 — 독자는 둘 다 본다.
      return { ...is, essay: p.trim() };
    });
    const summary = validParagraph(out.parsed.summary, { min: 40, max: 900 })
      ? out.parsed.summary.trim() : null;

    const result = { ...brief, issues, essay: summary, llm: { written, model } };
    log(`[llm] ${written}/${brief.issues.length}개 해설 · 입력 ${out.usage.input_tokens || "?"} 출력 ${out.usage.output_tokens || "?"} 토큰`);
    cache.set(cacheKey, result);
    return result;
  };
}
