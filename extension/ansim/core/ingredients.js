// 원재료명 파서.
//
// 한국 식품 표시의 원재료명은 이렇게 생겼다:
//   돼지고기(국산) 72%, 정제수, 복합조미식품[정제소금, L-글루탐산나트륨(향미증진제)],
//   아질산나트륨(발색제) / 대두, 밀, 돼지고기 함유
//   이 제품은 메밀, 땅콩을 사용한 제품과 같은 제조시설에서 제조하고 있습니다.
//
// 해야 할 일:
//   1. 최상위 쉼표로 나눈다 — 괄호 안 쉼표로 나누면 복합원재료가 쪼개진다
//   2. 괄호 안(하위 원재료)도 재귀로 읽는다 — 첨가물은 대개 괄호 안에 숨어 있다
//   3. "같은 제조시설" 문장은 원재료에서 **빼서** 따로 둔다 — 안 빼면 그 안의
//      알레르기 물질이 '함유'로 잡힌다. 그건 '혼입 가능'이지 함유가 아니다.
//
// 이 모듈은 브라우저와 서버가 같이 쓴다 — node 전용 import 금지.

const OPEN = "([{「【〔";
const CLOSE = ")]}」】〕";

// "이 제품은 …와 같은 제조시설에서 제조" — '이 제품은'으로 시작점을 잡는다.
// 시작점 없이 [^.]*로 잡으면 마침표 없는 표시에서 원재료 줄 전체를 삼킨다.
const FACILITY = /이\s*제품은[^.\n]*?(같은|동일한)\s*(제조\s*)?(시설|공장|라인)[^.\n]*\.?/g;
// '이 제품은'이 없는 변형: "…땅콩을 사용한 제품과 같은 시설에서 제조". 마지막 구분자 뒤부터만.
const FACILITY_LOOSE = /[^,/.\n]*(을|를)\s*사용한\s*제품과\s*(같은|동일한)[^.\n]*\.?/g;

export function normalizeText(text) {
  return String(text || "")
    .replace(/[（]/g, "(").replace(/[）]/g, ")")
    .replace(/[，、]/g, ",")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// 최상위(괄호 밖) 구분자로 자른다. 구분자: 쉼표, 슬래시, 줄바꿈.
function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "/" || ch === "\n" || ch === ";")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// "복합조미식품[정제소금, MSG(향미증진제)] 3%" → { name, inner, percent }
function splitItem(item) {
  let name = "";
  let inner = [];
  let depth = 0;
  let buf = "";
  for (const ch of item) {
    if (OPEN.includes(ch)) {
      if (depth === 0) { name += buf; buf = ""; }
      else buf += ch;
      depth++;
      continue;
    }
    if (CLOSE.includes(ch)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) { inner.push(buf); buf = ""; }
      else buf += ch;
      continue;
    }
    buf += ch;
  }
  if (depth > 0) inner.push(buf);   // 닫히지 않은 괄호 — 안쪽으로 취급
  else name += buf;
  const pct = name.match(/([\d.]+)\s*%/);
  name = name.replace(/([\d.]+)\s*%/g, "").replace(/\s*함유\s*$/, "").trim();
  return { name, inner, percent: pct ? Number(pct[1]) : null };
}

function parseList(text, depth) {
  return splitTop(text).map((raw) => {
    const { name, inner, percent } = splitItem(raw);
    const children = inner.flatMap((t) => parseList(t, depth + 1));
    return { name, percent, depth, children };
  }).filter((n) => n.name || n.children.length);
}

function flatten(nodes, out = []) {
  for (const n of nodes) {
    if (n.name) out.push(n.name);
    flatten(n.children, out);
  }
  return out;
}

// 원산지("국산", "외국산:실꼬리돔")와 용도명("발색제", "보존료")은 원재료 개수에 넣지 않는다.
const ORIGIN = /^(국|국내|수입|외국|미국|중국|호주|캐나다|브라질|칠레|독일|뉴질랜드|베트남|태국|인도네시아|말레이시아|스페인|이탈리아|프랑스|덴마크|네덜란드|이스라엘|필리핀|아르헨티나|러시아|일본|인도|페루|멕시코|헝가리|폴란드|영국|아일랜드|벨기에|오스트리아|튀르키예|터키|미얀마|스리랑카)산/;
const FUNCTION_CLASS = /^(향미증진제|발색제|보존료|감미료|산도조절제|유화제|증점제|안정제|착색료|산화방지제|표백제|팽창제|향료|천연향료|피막제|이형제|젤형성제|응고제|영양강화제|습윤제|소포제|살균제|껌기초제)$/;

export const isIngredientToken = (t) => {
  const s = String(t).replace(/\s+/g, "");
  return Boolean(s) && !ORIGIN.test(s) && !FUNCTION_CLASS.test(s);
};

export function parseIngredients(text) {
  let body = normalizeText(text);
  const facility = [];
  const take = (m) => { facility.push(m.trim()); return " "; };
  body = body.replace(FACILITY, take).replace(FACILITY_LOOSE, take);
  // "대두, 밀 함유" 꼬리말은 본문 토큰으로 남겨도 무해(알레르기 감지에 오히려 도움)
  const tree = parseList(body, 0);
  const tokens = flatten(tree);
  // "같은 제조시설" 문장에서 물질 이름만 뽑는다: "…메밀, 땅콩을 사용한 제품과…"
  const mayContainTokens = facility.flatMap((s) => {
    const head = s.split(/(을|를)\s*사용/)[0].replace(/이\s*제품은/, "");
    return splitTop(head).map((t) => t.replace(/\s+/g, ""));
  });
  return {
    tree,
    tokens,
    top: tree.map((n) => n.name),
    count: new Set(tokens.filter(isIngredientToken)).size,
    facilityNotes: facility,
    mayContainTokens
  };
}
