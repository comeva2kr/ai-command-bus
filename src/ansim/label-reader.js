// 라벨 사진 → 원재료·영양정보 텍스트 (Claude 비전).
//
// 오프라인 매장에서 바코드가 DB에 없거나(수입품·소규모 제조사), 브라우저가
// 실시간 바코드 인식을 못 할 때(iOS Safari) 쓰는 길이다. 포장 뒷면을 찍으면
// 원재료명·영양정보·알레르기 표시를 **그대로 옮겨 적게** 하고, 판정은 하지
// 않게 한다. 판정은 core/score.js가 한다 — 모델이 점수를 매기면 같은 제품이
// 매번 다른 점수를 받고, 근거를 추적할 수 없다.
//
// 환각 차단: 모델에게 "보이는 글자만" 옮기라고 하고, 화면은 읽어 온 원문을
// 사용자에게 보여줘 확인받는다. 안 보이면 빈 문자열.
//
// 호출 형식은 src/feed/llm.js와 같은 무의존성 fetch 방식을 따른다.

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = process.env.ANSIM_LLM_MODEL || "claude-opus-5-5";
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    foodType: { type: "string" },
    ingredientsText: { type: "string" },
    allergenText: { type: "string" },
    nutritionText: { type: "string" }
  },
  required: ["found", "name", "foodType", "ingredientsText", "allergenText", "nutritionText"],
  additionalProperties: false
};

const SYSTEM = `당신은 한국 식품 포장 라벨을 글자 그대로 옮겨 적는 전사기입니다.

규칙:
- 사진에 **보이는 글자만** 옮기십시오. 추측하거나 보충하지 마십시오. 안 보이거나 잘린 부분은 비워 두십시오.
- ingredientsText: "원재료명" 또는 "원재료명 및 함량" 항목 전체. 괄호·쉼표·%를 원문 그대로.
- allergenText: "~ 함유" 알레르기 표시와 "같은 제조시설" 문장.
- nutritionText: 영양정보 표를 한 줄 텍스트로 (예: "총 내용량 70g 350kcal 나트륨 280mg 당류 20g 포화지방 6g 트랜스지방 0g 단백질 4g"). 기준(총 내용량당/100g당/1회 섭취참고량당)을 꼭 포함하십시오.
- name, foodType: 제품명과 식품의 유형이 보이면 적고, 없으면 빈 문자열.
- 식품 라벨이 아니거나 읽을 수 있는 글자가 없으면 found=false.
- 제품이 좋은지 나쁜지 판단하지 마십시오. 옮겨 적기만 합니다.`;

export function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const mediaType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) return null;
  const data = m[2].replace(/\s+/g, "");
  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) return { tooLarge: true };
  return { mediaType, data };
}

export async function readLabel({ dataUrl, apiKey = process.env.ANTHROPIC_API_KEY, model = MODEL, fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  if (!apiKey) {
    const e = new Error("label reader not configured");
    e.code = "NO_KEY";
    throw e;
  }
  const image = parseDataUrl(dataUrl);
  if (!image || image.tooLarge) {
    const e = new Error(image?.tooLarge ? "image too large" : "invalid image");
    e.code = "BAD_IMAGE";
    throw e;
  }
  const body = {
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    // 안전 분류기가 거절하면 서버가 대체 모델로 자동 재시도한다
    fallbacks: "default",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: "이 식품 라벨의 원재료명, 알레르기 표시, 영양정보를 옮겨 적어 주세요." }
      ]
    }]
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
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const e = new Error(`api ${res.status}`);
    e.code = "API";
    throw e;
  }
  const msg = await res.json();
  if (msg.stop_reason === "refusal") {
    const e = new Error("refused");
    e.code = "REFUSED";
    throw e;
  }
  const text = (msg.content || []).find((b) => b.type === "text")?.text || "";
  let out;
  try { out = JSON.parse(text); } catch {
    const e = new Error("unparseable output");
    e.code = "API";
    throw e;
  }
  return {
    found: Boolean(out.found),
    name: String(out.name || "").slice(0, 120),
    foodType: String(out.foodType || "").slice(0, 60),
    ingredientsText: String(out.ingredientsText || "").slice(0, 4000),
    allergenText: String(out.allergenText || "").slice(0, 1000),
    nutritionText: String(out.nutritionText || "").slice(0, 1000)
  };
}
