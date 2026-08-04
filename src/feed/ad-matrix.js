// 광고 문구 행렬 — 미리 만들어 두고 런타임엔 고르기만 한다.
//
// ── 왜 실시간 생성이 아닌가 (2026-08-04, David "능동형 맞춤형 광고")
// 노출마다 LLM을 부르면 1건당 약 $0.002다. 일 활성 1,000명이 각 3회만 봐도
// 월 $180, 1만 명이면 월 $1,800이다. 쿠팡 수수료는 거래액의 3%라 월 $180을
// 메우려면 우리 링크로 월 600만원어치가 팔려야 한다 — 지금 트래픽에서 역마진이다.
// 지연도 문제다. 피드 광고는 스크롤 중 즉시 그려져야 하는데 LLM은 1~3초라
// 빈 칸이 뜨거나 레이아웃이 밀린다(오늘 아침에 고친 바로 그 증상).
//
// 그래서 **도착지 × 맥락** 행렬을 배치로 한 번 만들어 파일에 저장하고,
// 런타임은 규칙으로 고르기만 한다. 생성은 주 1회 약 $0.15, 노출당 비용 0,
// 지연 0. 실시간 대비 비용 300분의 1인데 사용자가 보는 결과는 같다 —
// 읽는 사람에게 중요한 건 "내 관심사에 맞는 문장"이지 그게 방금 생성됐는지가
// 아니다.
//
// ── 불변식: 문구는 자기 도착지에 대해서만 쓴다
// 2026-08-03에 "가전·디지털"이라 써놓고 로켓직구로 보낸 사고가 있었다.
// 원인은 문구를 도착지가 아니라 카테고리 묶음에서 뽑은 것이었다. 행렬도
// 같은 함정에 빠질 수 있으므로, 변형은 항상 **하나의 dest에 매여** 생성한다.
// 맥락은 어조와 초점을 바꿀 뿐 도착지를 바꾸지 않는다.
//
// ── 측정
// 변형마다 subId가 달라 쿠팡 대시보드에서 어느 문구가 실제로 팔리는지 갈린다.
// 다음 배치 때 이긴 문구를 남기고 진 문구를 갈아치우는 게 최적화의 실체다 —
// 매번 새로 쓰는 것보다 팔린 걸 아는 쪽이 낫다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AD_COPY } from "./ad-copy.js";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "ad-matrix.json");

// 맥락 — 사용자가 지금 무엇을 읽고 있는지. 도착지를 바꾸지 않고 어조만 바꾼다.
// 카테고리를 그대로 쓰지 않고 묶은 이유: 변형 수가 곧 생성 비용이고, 어조가
// 실제로 갈리는 지점은 이 정도 해상도면 충분하다.
export const CONTEXTS = [
  { id: "tech", hint: "IT·기기 글을 읽던 사람" },
  { id: "life", hint: "생활·살림 글을 읽던 사람" },
  { id: "fun", hint: "유머·잡담 글을 읽던 사람" },
  { id: "news", hint: "뉴스·시사 글을 읽던 사람" },
  { id: "hobby", hint: "취미·스포츠 글을 읽던 사람" }
];

// 피드 카테고리 → 맥락. 없는 건 news로 떨어진다(뉴스가 우리 피드에서 제일 크다).
const CTX_OF = {
  tech: "tech", gaming: "tech",
  life: "life", auto: "life",
  humor: "fun", culture: "fun",
  news: "news", business: "news",
  sports: "hobby"
};
export const contextOf = (cat) => CTX_OF[cat] || "news";

export function loadMatrix({ file = FILE } = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// 변형 고르기. 행렬이 없거나 해당 칸이 비면 **ad-copy.js의 기본 문구**로
// 떨어진다 — 배치가 실패해도 광고가 사라지지 않는다.
export function pickVariant(dest, category, { matrix = loadMatrix(), rotate = 0 } = {}) {
  const base = AD_COPY[dest] || AD_COPY._;
  const ctx = contextOf(category);
  const cell = matrix && matrix.variants && matrix.variants[dest] && matrix.variants[dest][ctx];
  if (!Array.isArray(cell) || !cell.length) {
    return { hook: base[0], brand: base[1], variant: "base" };
  }
  const v = cell[rotate % cell.length];
  if (!v || !v.hook) return { hook: base[0], brand: base[1], variant: "base" };
  // 브랜드 줄(도착지 이름)은 **행렬이 아니라 ad-copy.js에서 온다.**
  // 모델이 도착지 이름을 바꿔 쓰면 문구≠도착지가 되므로 그 자리는 안 맡긴다.
  return { hook: v.hook, brand: base[1], variant: `${dest}_${ctx}_${rotate % cell.length}` };
}

// ── 배치 생성 ────────────────────────────────────────────────────────────
const SYSTEM = `당신은 한국 쇼핑 서비스의 광고 카피라이터입니다.
커뮤니티·뉴스 큐레이션 앱의 피드 사이에 끼는 한 줄 문구를 씁니다.

규칙:
- **도착지가 여는 곳만 말하십시오.** 다른 상품군을 암시하지 마십시오.
- **가격·할인율·재고·기간을 쓰지 마십시오.** 숫자를 넣지 마십시오.
  우리는 그 값을 확인할 수 없고, 쓰는 순간 허위표시가 됩니다.
- "최저가", "지금만", "역대급" 같은 과장을 쓰지 마십시오.
- 12~22자. 명령형("사세요")이 아니라 상황을 짚는 말투로.
  좋은 예: "차 관리 미루고 있던 것들" / "장 볼 것 있으면 오늘"
- 읽던 글의 맥락에 맞는 어조를 쓰되, 그 글 내용을 아는 척하지 마십시오.
- 각 칸마다 서로 다른 각도로 3개씩 쓰십시오.`;

const SCHEMA = {
  type: "object",
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dest: { type: "string" },
          context: { type: "string" },
          hooks: { type: "array", items: { type: "string" } }
        },
        required: ["dest", "context", "hooks"],
        additionalProperties: false
      }
    }
  },
  required: ["cells"],
  additionalProperties: false
};

// 문구 검증 — 브리핑 해설과 같은 원칙이다. 확인할 수 없는 것은 쓰지 않는다.
const BANNED = /최저가|최저 가|역대급|지금만|오늘만|마감임박|한정|초특가|공짜|무료 증정|폭탄|떨이/;
export function validHook(h) {
  if (typeof h !== "string") return false;
  const t = h.trim();
  if (t.length < 6 || t.length > 30) return false;
  if (/[0-9]/.test(t)) return false;          // 가격·할인율·기간
  if (/[%％]/.test(t)) return false;
  if (BANNED.test(t)) return false;
  if (/<[^>]+>/.test(t)) return false;
  return true;
}

export function buildMatrixPrompt(dests) {
  const rows = dests.map((d) => {
    const [, brand] = AD_COPY[d] || AD_COPY._;
    return `- dest="${d}" → 도착지: ${brand}`;
  });
  return `도착지 목록:\n${rows.join("\n")}\n\n맥락 목록:\n${
    CONTEXTS.map((c) => `- context="${c.id}" → ${c.hint}`).join("\n")
  }\n\n모든 (도착지 × 맥락) 조합에 대해 hooks 3개씩 만들어 주십시오.`;
}

// 실제 배치 호출. 실패하면 null을 돌려주고 기존 행렬을 그대로 둔다 —
// 광고가 사라지는 것보다 지난주 문구를 계속 쓰는 편이 낫다.
export async function generateMatrix({
  apiKey, model = process.env.LLM_MODEL || "claude-sonnet-5",
  dests, fetchImpl = fetch, log = () => {}
}) {
  if (!apiKey) return null;
  const body = {
    model, max_tokens: 8000, system: SYSTEM,
    output_config: /-4-5$|haiku/.test(model)
      ? { format: { type: "json_schema", schema: SCHEMA } }
      : { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: buildMatrixPrompt(dests) }]
  };
  let j;
  try {
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body)
    });
    if (!r.ok) { try { await r.text(); } catch {} throw new Error(`api ${r.status}`); }
    j = await r.json();
    if (j.stop_reason === "refusal") throw new Error("refusal");
    if (j.stop_reason === "max_tokens") throw new Error("truncated");
  } catch (e) { log(`[admatrix] ${e.message}`); return null; }

  const text = (j.content || []).find((b) => b.type === "text");
  if (!text) { log("[admatrix] no text"); return null; }

  let parsed;
  try { parsed = JSON.parse(text.text); } catch { log("[admatrix] parse fail"); return null; }

  const variants = {};
  let kept = 0, dropped = 0;
  for (const cell of parsed.cells || []) {
    if (!dests.includes(cell.dest)) { dropped++; continue; }
    if (!CONTEXTS.some((c) => c.id === cell.context)) { dropped++; continue; }
    const good = (cell.hooks || []).filter(validHook).map((h) => ({ hook: h.trim() }));
    dropped += (cell.hooks || []).length - good.length;
    if (!good.length) continue;
    variants[cell.dest] = variants[cell.dest] || {};
    variants[cell.dest][cell.context] = good;
    kept += good.length;
  }
  log(`[admatrix] 문구 ${kept}개 채택 · ${dropped}개 탈락 · 입력 ${j.usage?.input_tokens} 출력 ${j.usage?.output_tokens} 토큰`);
  if (!kept) return null;
  return { generatedAt: new Date().toISOString(), model, variants };
}

export function saveMatrix(matrix, { file = FILE } = {}) {
  fs.writeFileSync(file, JSON.stringify(matrix, null, 2) + "\n");
  return file;
}
