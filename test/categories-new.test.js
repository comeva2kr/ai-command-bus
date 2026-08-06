import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, categoryLabel } from "../src/feed/taxonomy.js";
import { keywordCategory, CATEGORY_KEYWORDS, OVERRIDE_CATEGORIES } from "../src/feed/classify.js";
import { catKo } from "../src/feed/datastory.js";
import { contextOf } from "../src/feed/ad-matrix.js";

// David 2026-08-06: "카테고리에 모든 주제별로 확장시키자. 부동산 패션 예술 등등"
// 그리고 "당연히 브리핑에도, 화재랭킹, 키워드 트랜드 등에도 새로운 카테고리
// 다 신설 및 적용 하고".
//
// 새 카테고리는 taxonomy에 한 줄 넣는 것으로 끝나지 않는다. 카테고리 id를
// 아는 부수 테이블이 여럿이고, 하나라도 빠지면 **그 화면에서만 조용히 빈다**:
//   classify.js   분류 사전 + OVERRIDE_CATEGORIES  → 없으면 글이 그 칸으로 안 감
//   datastory.js  CAT_KO                           → 없으면 데이터 리포트에 영문 id
//   ad-matrix.js  CTX_OF                           → 없으면 광고 맥락이 news로
//   index.html    AD_CTX_OF / AD_CTX               → 화면 쪽 같은 표
// 이 테스트는 다음에 카테고리를 늘릴 때 그 전부를 함께 채우게 만든다.

const NEW = ["realestate", "fashion", "art"];

test("새 카테고리가 taxonomy에 있고 한국어 이름을 갖는다", () => {
  for (const id of NEW) {
    const c = CATEGORIES.find((x) => x.id === id);
    assert.ok(c, `${id}가 CATEGORIES에 없다`);
    assert.ok(/[가-힣]/.test(c.label), `${id} 라벨에 한글이 없다: ${c.label}`);
    assert.equal(categoryLabel(id), c.label);
  }
});

test("모든 카테고리가 데이터 리포트에서 한국어로 나온다 (영문 id 노출 금지)", () => {
  const raw = CATEGORIES.filter((c) => catKo(c.id) === c.id);
  assert.deepEqual(raw.map((c) => c.id), [],
    `datastory.js CAT_KO에 없어 영문 id가 그대로 나온다: ${raw.map((c) => c.id).join(", ")}`);
});

test("새 카테고리에 분류 사전이 있다 — 없으면 글이 그 칸으로 갈 수 없다", () => {
  const known = new Set(CATEGORY_KEYWORDS.map(([c]) => c));
  for (const id of NEW) assert.ok(known.has(id), `${id} 분류 사전 없음`);
});

test("새 카테고리가 OVERRIDE_CATEGORIES에 있다 — 없으면 소스 선언이 이긴다", () => {
  // 이 소스들은 registry에 business·culture로 선언돼 있다(그게 그동안의 유일한
  // 칸이었다). 여기 없으면 내용 분류가 소스 선언을 못 이겨 새 칸이 영원히 빈다.
  for (const id of NEW) assert.ok(OVERRIDE_CATEGORIES.has(id), `${id} override 없음`);
});

test("분류 사전이 실제로 맞춘다", () => {
  const cases = [
    ["realestate", "서울 아파트값 3주 연속 상승…전세도 오름세"],
    ["realestate", "정부, 재건축 규제 완화…청약 제도도 손본다"],
    ["realestate", "전세사기 피해자 구제 대책 발표"],
    ["fashion", "나이키 조던 신상 스니커즈 드로우 응모 시작"],
    ["fashion", "파리 패션위크 런웨이에 오른 한국 디자이너"],
    ["art", "국립현대미술관 회고전 개막…도슨트 예약 폭주"],
    ["art", "비엔날레 개막 아트페어 인파"]
  ];
  for (const [want, title] of cases) {
    assert.equal(keywordCategory(title), want, `"${title}" → ${keywordCategory(title)}`);
  }
});

test("경제 기사가 부동산으로 새지 않는다 — 그리고 그 반대도", () => {
  // 2026-08-06 실측 회귀: business 사전에도 "아파트값·전세·청약·재건축"이 있어
  // realestate와 **동점**이 됐고, classify는 동점이면 분류를 포기한다(null).
  // 그래서 부동산 기사가 어디로도 안 갔다. business에서 그 낱말들을 뺐다.
  const biz = CATEGORY_KEYWORDS.find(([c]) => c === "business")[1];
  for (const w of ["부동산", "아파트값", "전세", "청약", "재건축", "분양"]) {
    assert.ok(!biz.includes(w), `business 사전에 부동산 낱말이 남아 있다: ${w} (동점으로 분류 실패한다)`);
  }
  assert.equal(keywordCategory("삼성전자 주가 3% 상승 코스피 강세"), "business");
  assert.equal(keywordCategory("원달러 환율 급등…수출기업 비상"), "business");
});

test("새 사전이 엉뚱한 글을 끌어오지 않는다 — 오탐은 조용한 오분류다", () => {
  // 일반어("디자인"·"전시")를 넣으면 IT·연예 기사가 통째로 끌려온다.
  // politics 사전에서 "여당" 단독을 뺀 것과 같은 이유로 고유명사만 넣었다.
  const notNew = ["손흥민 결승골로 팀 승리", "아이돌 컴백 무대 화제",
    "새 아이폰 디자인 유출", "게임 신작 패치노트 공개", "삼성전자 주가 3% 상승 코스피 강세"];
  for (const t of notNew) {
    const got = keywordCategory(t);
    assert.ok(!NEW.includes(got), `"${t}"가 ${got}로 잘못 분류됐다`);
  }
});

test("광고 맥락 — 패션·예술은 생활 재고로, 부동산은 붙이지 않는다", () => {
  // 집을 파는 광고를 우리가 붙일 수 없다. 억지 매칭은 무관한 광고가 된다.
  assert.equal(contextOf("fashion"), "life");
  assert.equal(contextOf("art"), "life");
  assert.equal(contextOf("realestate"), "news", "부동산은 기본값(news)으로 떨어져야 한다");
});
