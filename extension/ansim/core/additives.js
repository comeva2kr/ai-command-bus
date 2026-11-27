// 첨가물·원재료 근거 사전.
//
// ── 이 서비스의 차별점: "무섭게"가 아니라 "근거대로"
// 해외 스캐너 앱들은 MSG·씨앗기름처럼 과학적 합의가 없는 성분까지 빨간불을
// 켠다. 부모 불안을 키워 설치 수는 늘겠지만, 우리는 그렇게 하지 않는다:
//   1. 모든 감점 항목에 근거 등급과 출처를 단다.
//   2. 근거가 약한 성분은 감점 없이 "참고"로만 보여준다.
//   3. 공포 마케팅에 자주 나오지만 안전성 평가가 끝난 성분은 "오해" 카드로
//      명시한다 — 이것도 부모에게 필요한 정보다.
// 실제 브랜드 제품에 "비추천"을 붙이는 서비스라 근거 없는 감점은 법적
// 리스크(명예훼손·업무방해)이기도 하다.
//
// ── 근거 등급
//   A: 국제기구·규제기관의 분류, 금지, 섭취 기준이 있음
//   B: 규제기관이 경고 표시를 요구하거나 일부 국가가 제한함, 또는 신뢰할 만한 연구가 일관됨
//   C: 연구가 제한적이거나 결과가 엇갈림. 감점은 작게 함
//   info: 감점 없음. 오해를 바로잡거나 참고용
//
// ── concerns(가중치 태그)
//   attention: 주의력/과잉행동 관련 근거가 있는 항목 (프로필에서 '주의력' 선택 시 ×1.5)
//   weight: 소아비만 관련 (프로필에서 '체중' 또는 '성조숙증' 선택 시 ×1.5)
//
// 이 모듈은 브라우저와 서버가 같이 쓴다 — node 전용 import 금지.

const SRC = {
  iarcMeat: {
    title: "WHO/IARC — 적색육·가공육 발암성 Q&A (가공육 1군)",
    url: "https://www.who.int/news-room/questions-and-answers/item/cancer-carcinogenicity-of-the-consumption-of-red-meat-and-processed-meat"
  },
  euColors: {
    title: "EU 규정 (EC) No 1333/2008 부속서 V — 6종 색소 '어린이 활동·주의력' 경고 문구 의무",
    url: "https://eur-lex.europa.eu/eli/reg/2008/1333/oj"
  },
  southampton: {
    title: "McCann et al., Lancet 2007 — 합성색소·안식향산나트륨과 어린이 과잉행동",
    url: "https://doi.org/10.1016/S0140-6736(07)61306-3"
  },
  fdaRed3: {
    title: "미국 FDA — 적색3호(Erythrosine) 식품 사용 허가 취소 (2025)",
    url: "https://www.fda.gov/food/food-additives-petitions/fdc-red-no-3"
  },
  aspartame: {
    title: "WHO — 아스파탐 위해성 평가 결과 (IARC 2B, JECFA ADI 유지, 2023)",
    url: "https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released"
  },
  whoNss: {
    title: "WHO — 비당류 감미료 사용 지침 (2023, 체중조절 목적 사용 비권장)",
    url: "https://www.who.int/publications/i/item/9789240073616"
  },
  efsaTio2: {
    title: "EFSA — 이산화티타늄(E171) 식품첨가물로 더 이상 안전하다고 볼 수 없음 (2021)",
    url: "https://www.efsa.europa.eu/en/news/titanium-dioxide-e171-no-longer-considered-safe-when-used-food-additive"
  },
  whoTrans: {
    title: "WHO REPLACE — 산업적 트랜스지방 퇴출",
    url: "https://www.who.int/teams/nutrition-and-food-safety/replace-trans-fat"
  },
  mfdsCaffeine: {
    title: "식약처 — 카페인 일일 최대 섭취 권고량 (어린이·청소년 체중 1kg당 2.5mg 이하)",
    url: "https://www.mfds.go.kr"
  },
  jecfaMsg: {
    title: "JECFA — L-글루탐산나트륨 ADI '정하지 않음(not specified)' 평가",
    url: "https://apps.who.int/food-additives-contaminants-jecfa-database/"
  },
  cdcHoney: {
    title: "CDC — 영아 보툴리누스증 (12개월 미만 꿀 금지)",
    url: "https://www.cdc.gov/botulism/"
  }
};

export const SOURCES = SRC;

const SIX_COLORS_NOTE =
  "EU는 이 색소가 든 식품에 '어린이의 활동과 주의력에 나쁜 영향을 줄 수 있음' 경고 문구를 의무화했습니다.";

export const ADDITIVES = [
  {
    id: "nitrite", label: "아질산나트륨(발색제)", group: "발색제",
    pattern: /아질산/, penalty: 12, evidence: "A", source: SRC.iarcMeat,
    note: "햄·소시지의 분홍색을 내고 보존하는 성분. 가공육은 IARC 1군 발암요인(대장암)으로 분류되어 있어 아이는 먹는 빈도를 줄이는 게 좋습니다."
  },
  {
    id: "nitrate", label: "질산염(발색제)", group: "발색제",
    pattern: /^질산(나트륨|칼륨)/, penalty: 10, evidence: "A", source: SRC.iarcMeat,
    note: "가공육에서 아질산으로 바뀌어 같은 역할을 합니다."
  },
  {
    id: "celery-nitrite", label: "셀러리 분말(천연 아질산 공급원)", group: "발색제",
    pattern: /셀러리(분말|파우더|추출|농축)/, penalty: 6, evidence: "B", source: SRC.iarcMeat,
    onlyProcessedMeat: true,
    note: "'무첨가' 가공육이 셀러리 분말을 쓰면 그 안의 질산염이 아질산으로 바뀌어 발색제와 같은 작용을 합니다. 무첨가 표시만 믿지 마세요."
  },
  {
    id: "tartrazine", label: "황색4호(타르트라진)", group: "합성착색료", concerns: ["attention"],
    pattern: /황색(제)?4호|타르트라진/, penalty: 10, evidence: "B", source: SRC.euColors, note: SIX_COLORS_NOTE
  },
  {
    id: "sunset-yellow", label: "황색5호(선셋옐로우)", group: "합성착색료", concerns: ["attention"],
    pattern: /황색(제)?5호|선셋옐로/, penalty: 10, evidence: "B", source: SRC.euColors, note: SIX_COLORS_NOTE
  },
  {
    id: "allura-red", label: "적색40호(알루라레드)", group: "합성착색료", concerns: ["attention"],
    pattern: /적색(제)?40호|알루라/, penalty: 10, evidence: "B", source: SRC.euColors, note: SIX_COLORS_NOTE
  },
  {
    id: "ponceau", label: "적색102호(뉴콕신·폰소4R)", group: "합성착색료", concerns: ["attention"],
    pattern: /적색(제)?102호|뉴콕신|폰소/, penalty: 10, evidence: "B", source: SRC.euColors, note: SIX_COLORS_NOTE
  },
  {
    id: "quinoline-carmoisine", label: "퀴놀린옐로·카르모이신", group: "합성착색료", concerns: ["attention"],
    pattern: /퀴놀린|카르모이신|아조루빈/, penalty: 10, evidence: "B", source: SRC.euColors, note: SIX_COLORS_NOTE
  },
  {
    id: "erythrosine", label: "적색3호(에리스로신)", group: "합성착색료", concerns: ["attention"],
    pattern: /적색(제)?3호|에리스로신/, penalty: 14, evidence: "A", source: SRC.fdaRed3,
    note: "미국 FDA가 2025년 식품 사용 허가를 취소한 색소입니다(2027년부터 적용)."
  },
  {
    id: "other-tar-color", label: "기타 타르색소", group: "합성착색료",
    pattern: /(적색|청색|녹색)(제)?\d+호|타르색소/, penalty: 4, evidence: "C", source: SRC.southampton,
    note: "합성 타르색소입니다. 위의 6종만큼 근거가 쌓이진 않았지만 아이 식품에서는 굳이 필요 없는 성분입니다."
  },
  {
    id: "benzoate", label: "안식향산나트륨(보존료)", group: "보존료", concerns: ["attention"],
    pattern: /안식향산/, penalty: 5, evidence: "C", source: SRC.southampton,
    note: "사우샘프턴 연구에서 색소와 함께 시험된 보존료입니다. 비타민C와 함께 있으면 벤젠이 미량 생길 수 있어 음료에서 관리 대상입니다."
  },
  {
    id: "sorbate", label: "소르빈산칼륨(보존료)", group: "보존료",
    pattern: /소르빈산/, penalty: 1, evidence: "C", source: null,
    note: "가장 흔한 보존료 중 하나로 위험 근거는 약합니다. 가공 정도를 보여주는 신호로만 작게 반영합니다."
  },
  {
    id: "aspartame", label: "아스파탐(감미료)", group: "감미료",
    pattern: /아스파탐/, penalty: 6, evidence: "C", source: SRC.aspartame,
    note: "IARC가 2B군(발암 가능성 있음, 근거 제한적)으로 분류했고 JECFA는 섭취 허용량을 유지했습니다. 아이 식품에선 피할 이유가 더 많습니다."
  },
  {
    id: "nss", label: "비당류 감미료", group: "감미료",
    pattern: /수크랄로스|아세설팜|아세셀팜|사카린|스테비올|스테비아|네오탐|수크랄로오스/, penalty: 4, evidence: "C", source: SRC.whoNss,
    note: "WHO는 체중 조절 목적의 비당류 감미료 사용을 권하지 않습니다. 단맛에 익숙해지는 습관이 남습니다."
  },
  {
    id: "caffeine", label: "카페인", group: "카페인",
    pattern: /카페인|커피(?!향)|과라나|녹차추출|마테/, penalty: 14, evidence: "A", source: SRC.mfdsCaffeine,
    note: "식약처는 어린이 카페인 섭취를 체중 1kg당 하루 2.5mg 이하로 권고합니다. 20kg 아이면 하루 50mg — 콜라 한 캔 수준입니다."
  },
  {
    id: "tio2", label: "이산화티타늄(착색료)", group: "착색료",
    pattern: /이산화티타늄|산화티타늄/, penalty: 8, evidence: "B", source: SRC.efsaTio2,
    note: "EU는 유전독성 우려를 배제할 수 없다며 2022년부터 식품 사용을 금지했습니다."
  },
  {
    id: "partially-hydrogenated", label: "부분경화유(트랜스지방)", group: "유지",
    pattern: /부분경화/, penalty: 12, evidence: "A", source: SRC.whoTrans,
    note: "산업적 트랜스지방의 주된 원천입니다. WHO가 퇴출을 권고합니다."
  },
  {
    id: "hydrogenated", label: "경화유", group: "유지",
    pattern: /(?<!부분)경화(유|유지|대두유|팜)/, penalty: 3, evidence: "C", source: SRC.whoTrans,
    note: "완전경화유는 트랜스지방이 거의 없지만 표시만으로 구분이 어려울 수 있습니다. 영양정보의 트랜스지방 수치를 같이 보세요."
  },
  {
    id: "synthetic-antioxidant", label: "BHA·BHT·TBHQ(산화방지제)", group: "산화방지제",
    pattern: /부틸히드록시|히드로퀴논|BHA|BHT|TBHQ/i, penalty: 4, evidence: "C", source: null,
    note: "BHA는 IARC 2B군입니다. 허용량 이내에서 쓰이지만 아이 식품에선 없는 편이 낫습니다."
  },
  {
    id: "phosphate", label: "인산염", group: "산도조절제·유화제",
    pattern: /(폴리|피로|메타|제일|제이|제삼)인산(나트륨|칼륨|칼슘)/, penalty: 2, evidence: "C", source: null,
    note: "가공육·가공치즈에 흔합니다. 인 섭취가 많아지는 신호로 작게 반영합니다."
  },
  {
    id: "caramel-color", label: "카라멜색소", group: "착색료",
    pattern: /카라멜색소|캐러멜색소/, penalty: 2, evidence: "C", source: null,
    note: "일부 제법(Ⅲ·Ⅳ종)에서 4-MEI가 생길 수 있습니다. 위험 근거는 약합니다."
  },
  {
    id: "carrageenan", label: "카라기난", group: "증점제",
    pattern: /카라기난/, penalty: 1, evidence: "C", source: null,
    note: "해조류 유래 증점제입니다. 장 염증 관련 연구가 있지만 사람 근거는 제한적입니다."
  },
  {
    id: "synthetic-flavor", label: "합성향료", group: "향료",
    pattern: /합성향료/, penalty: 1, evidence: "C", source: null,
    note: "향료 자체의 위험 근거는 약합니다. 맛을 원재료가 아니라 향으로 낸다는 신호로만 반영합니다."
  },
  // ── 감점 없음: 오해를 바로잡는 카드
  {
    id: "msg", label: "L-글루탐산나트륨(MSG)", group: "향미증진제",
    pattern: /글루탐산나트륨|MSG/i, penalty: 0, evidence: "info", source: SRC.jecfaMsg, myth: true,
    note: "MSG는 JECFA와 식약처 모두 안전하다고 평가했습니다. 공포 마케팅에 자주 나오지만 감점하지 않습니다. 짠맛은 나트륨 수치로 따로 평가합니다."
  }
];

// 첨가당 — 영양정보가 없을 때만 원재료 순서로 추정한다.
export const SUGAR_PATTERN = /^(설탕|백설탕|황설탕|흑설탕|정백당|액상과당|고과당|과당|포도당|물엿|올리고당|프락토올리고당|이소말토올리고당|옥수수시럽|콘시럽|당시럽|조청|맥아당|덱스트로스|기타과당|요리당|캐러멜시럽)/;

export const HONEY_PATTERN = /꿀|벌꿀|허니/;

// 구체적으로 이름이 있는 색소는 '기타 타르색소'로 또 세지 않는다.
const SPECIFIC_COLORS = ADDITIVES.filter((a) => a.group === "합성착색료" && a.id !== "other-tar-color");

export function detectAdditives(tokens, { processedMeat = false } = {}) {
  const hits = new Map();
  for (const raw of tokens) {
    const t = String(raw).replace(/\s+/g, "");
    if (!t) continue;
    for (const a of ADDITIVES) {
      if (hits.has(a.id)) continue;
      if (a.onlyProcessedMeat && !processedMeat) continue;
      if (a.id === "other-tar-color" && SPECIFIC_COLORS.some((c) => c.pattern.test(t))) continue;
      if (a.pattern.test(t)) hits.set(a.id, { ...a, matched: t });
    }
  }
  // 부분경화유가 잡혔으면 일반 경화유는 중복
  if (hits.has("partially-hydrogenated")) hits.delete("hydrogenated");
  return [...hits.values()];
}
