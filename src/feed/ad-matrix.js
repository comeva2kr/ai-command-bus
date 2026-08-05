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
  const raw = cell[rotate % cell.length];
  // 옛 행렬은 훅 문자열만 담았다. 새로 만들기 전까지 그대로 읽힌다.
  const v = typeof raw === "string" ? { hook: raw } : raw;
  if (!v || !v.hook) return { hook: base[0], brand: base[1], variant: "base" };
  // 브랜드 줄(도착지 이름)은 **행렬이 아니라 ad-copy.js에서 온다.**
  // 모델이 도착지 이름을 바꿔 쓰면 문구≠도착지가 되므로 그 자리는 안 맡긴다.
  return {
    hook: v.hook,
    // 줄이 없으면(옛 행렬) 도착지 이름을 그대로 쓴다 — 빈 줄보다 낫다.
    line: v.line || base[1],
    cta: v.cta || "보러 가기",
    brand: base[1],
    variant: `${dest}_${ctx}_${rotate % cell.length}`
  };
}

// ── 배치 생성 ────────────────────────────────────────────────────────────
const SYSTEM = `당신은 한국 커뮤니티 앱의 카피라이터입니다.
커뮤니티·뉴스 글 사이에 끼는 제휴 카드의 문구를 씁니다. 카드는 게시글과
**똑같은 모양**이므로, 광고 문구가 아니라 **짧은 게시글처럼** 읽혀야 합니다.

칸마다 셋을 씁니다:
- hook  제목. 12~24자. 1인칭 상황이나 혼잣말.
- line  제목 아래 한 줄. 18~40자. 공감이나 납득이 가는 이유.
- cta   맨 아래 한마디. 5~10자.

David가 준 본보기(어조를 이대로):
- 해외직구 → hook "오늘도 외화유출했다"
             line "그래도 영양제나 IT 액세서리는 아직 직구 말고는 답이 없더라"
             cta  "직구관 열기"
- 도서     → hook "요즘 뭘 읽나 궁금해서"
             line "고민하던 게 남의 책 목차에서 풀릴 때가 있다"
             cta  "베스트 보기"

**지어내면 안 되는 것 (하나라도 어기면 그 칸은 버려집니다)**
- **특정 상품명·브랜드명·책 제목을 쓰지 마십시오.** 우리는 그 도착지에 지금
  무엇이 있는지 모릅니다. 없는 상품을 말하면 그 자체로 허위표시입니다.
- **가격·할인율·순위·수치를 쓰지 마십시오.** 숫자를 넣지 마십시오.
- **특정 상품을 써 봤다고 하지 마십시오.** "이거 진짜 괜찮더라"는 안 됩니다.
  대신 **분야 전체에 대한 일반적인 말**은 됩니다 — "영양제는 직구가 싸다"처럼
  누구나 아는 사실은 괜찮고, "이 영양제 먹어 봤다"는 안 됩니다.
- "최저가", "지금만", "역대급" 같은 과장을 쓰지 마십시오.
- **도착지가 여는 곳만 말하십시오.** 다른 상품군을 암시하지 마십시오.

읽던 글의 맥락에 맞는 어조를 쓰되, 그 글 내용을 아는 척하지 마십시오.
각 칸마다 서로 다른 각도로 3개씩 쓰십시오.`;

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
          // 예전엔 훅 문자열 하나였다. 카드가 게시글 모양이 되면서 그 아래
          // **공감 한 줄**이 필요해졌다 — 제목만 있고 본문이 없으면 게시글로
          // 안 읽힌다(David 2026-08-05).
          hooks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                hook: { type: "string" },
                line: { type: "string" },
                cta: { type: "string" }
              },
              required: ["hook", "line", "cta"],
              additionalProperties: false
            }
          }
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

// 특정 상품을 써 봤다는 주장. 우리는 그 도착지에 지금 무엇이 있는지 모른다 —
// "이거 진짜 괜찮더라"는 없는 상품에 대한 후기가 되어 그 자체로 허위표시다.
// 분야 전체에 대한 일반론("영양제는 직구가 싸다")은 막지 않는다.
// David 2026-08-05가 원한 어조는 **상황·정서**이지 상품 후기가 아니다.
const CLAIMED_USE = /이거\s*(진짜|정말|완전)|써\s*보니|먹어\s*보니|입어\s*보니|읽어\s*보니|받아\s*보니|후기|내돈내산|재구매/;
// 한 조각(제목·줄·CTA 각각)이 쓸 만한가.
function validText(t, { min, max }) {
  if (typeof t !== "string") return false;
  const s = t.trim();
  if (s.length < min || s.length > max) return false;
  if (/[0-9]/.test(s)) return false;          // 가격·할인율·기간·순위
  if (/[%％]/.test(s)) return false;
  if (BANNED.test(s)) return false;
  if (CLAIMED_USE.test(s)) return false;      // 없는 상품에 대한 후기 금지
  if (/<[^>]+>/.test(s)) return false;
  return true;
}

// 예전엔 훅 문자열 하나였다. 지금은 {hook, line, cta} 셋이고, **셋 다** 통과해야
// 그 칸을 쓴다 — 하나만 이상해도 카드 전체가 이상해 보인다.
// 문자열도 그대로 받는다: 옛 행렬이 아직 파일에 남아 있다.
export function validHook(h) {
  if (typeof h === "string") return validText(h, { min: 6, max: 30 });
  if (!h || typeof h !== "object") return false;
  return validText(h.hook, { min: 6, max: 30 })
    && validText(h.line, { min: 10, max: 46 })
    && validText(h.cta, { min: 3, max: 12 });
}

export function buildMatrixPrompt(dests, { trends = [], winners = [] } = {}) {
  const rows = dests.map((d) => {
    const [, brand] = AD_COPY[d] || AD_COPY._;
    return `- dest="${d}" → 도착지: ${brand}`;
  });
  return `도착지 목록:\n${rows.join("\n")}\n\n맥락 목록:\n${
    CONTEXTS.map((c) => `- context="${c.id}" → ${c.hint}`).join("\n")
  }${
    // 지금 사람들이 실제로 검색하는 말 — David: "당연히 서치베이스여야지.
    // 사람들 관심사나 토픽에서 끌어온 근거로 만드는 거지."
    // **어조와 계절감의 힌트로만** 쓴다. 검색어를 문구에 그대로 박으면
    // 그 검색어가 그 도착지에 있다는 말이 되어 버린다 — 우리는 모른다.
    trends.length
      ? `\n\n지금 한국에서 검색이 몰리는 말(어조·계절감 참고용, 문구에 그대로 넣지 말 것):\n${
          trends.slice(0, 12).map((t) => `- ${t}`).join("\n")}`
      : ""
  }${
    // 지난주에 실제로 눌린 문구 — 감이 아니라 성적으로 배운다.
    // 베껴 쓰라는 게 아니라 **왜 눌렸는지**를 보고 그 결을 이어 가라는 것이다.
    winners.length
      ? `\n\n지난주에 실제로 잘 눌린 문구(결을 참고하되 그대로 베끼지 말 것):\n${
          winners.map((w) => `- [${w.dest}] "${w.hook}" / "${w.line}"`).join("\n")}`
      : ""
  }\n\n모든 (도착지 × 맥락) 조합에 대해 hooks 3개씩 만들어 주십시오.`;
}

// 실제 배치 호출. 실패하면 null을 돌려주고 기존 행렬을 그대로 둔다 —
// 광고가 사라지는 것보다 지난주 문구를 계속 쓰는 편이 낫다.
export async function generateMatrix({
  apiKey, model = process.env.LLM_MODEL || "claude-sonnet-5",
  dests, trends = [], winners = [], fetchImpl = fetch, log = () => {}
}) {
  if (!apiKey) return null;
  const body = {
    // 칸마다 {hook, line, cta} 셋을 쓰면서 출력이 3배가 됐다 — 8000에서
    // 잘렸다(2026-08-05 실측: stop_reason=max_tokens). 도착지를 나눠 부르므로
    // 한 번에 필요한 양은 줄었지만, 여유를 크게 둔다. 잘리면 그 배치가 통째로
    // 버려지고 지난주 문구가 남는다 — 조용히 옛것을 쓰는 것이 제일 나쁘다.
    model, max_tokens: 16000, system: SYSTEM,
    output_config: /-4-5$|haiku/.test(model)
      ? { format: { type: "json_schema", schema: SCHEMA } }
      : { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: buildMatrixPrompt(dests, { trends, winners }) }]
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
    const good = (cell.hooks || []).filter(validHook).map((h) =>
      typeof h === "string"
        ? { hook: h.trim() }
        : { hook: h.hook.trim(), line: h.line.trim(), cta: h.cta.trim() });
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
