// 카테고리 분류 엔진 — "우리가 끌어오는 리소스가 어떤 카테고리에 속하는지
// 정확하게 판별해서 인덱싱하는 시스템, 아주 칼같은" (David 2026-07-29).
//
// 왜 필요한가: 개인화는 글의 카테고리가 정확해야 성립한다. 지금까지는 소스의
// 등록 카테고리를 글에 그대로 물려줬는데(클리앙=tech), 실제 커뮤니티에는 온갖
// 주제가 섞여 있다 — 클리앙 베스트에 자동차 글이 오면 그것도 tech로 배달됐다.
// 페르소나 시뮬레이션에서 취향 적중률이 18~31%로 무너진 원인의 한 축이다.
//
// ── 설계 (제약: npm 불가·아이템당 LLM 호출 불가·결정적·월 $5 VM) ──
//
// 1. 학습 데이터 = 구글뉴스 섹션 피드 (약지도, 비용 0).
//    구글이 이미 섹션 분류를 끝낸 한국어 제목이 15분마다 367건씩 흐른다
//    (실측 2026-07-29: 경제 54·스포츠 35·연예 70·과학 62·기술 70·종합 76).
//    사람 라벨링 없이 수일 만에 카테고리당 수천 건이 쌓인다.
//    커뮤니티 약지도(보배=auto, 인벤=gaming)는 **보조**로만 쓴다 — 소스가
//    1~2개뿐인 카테고리는 그 소스 특유의 말투에 과적합되기 때문에 가중치를
//    낮게 두고, 평가는 반드시 소스 홀드아웃으로 한다.
//
// 2. 자질 = 음절 바이그램. 형태소 분석기 없이 한국어를 다루는 검증된 차선책.
//    "반도체" -> [반도, 도체]. 조사·어미가 만드는 잡음 바이그램은 양쪽 클래스에
//    고르게 나타나 NB에서 자연히 중화된다.
//
// 3. 모델 = 다항 나이브 베이즈 + 라플라스 평활 + **균등 사전확률**.
//    사전확률을 학습 데이터 비율로 두면 라벨이 많은 카테고리(tech)로 쏠린다 —
//    우리가 원하는 건 "이 제목이 어느 쪽 어휘에 가까운가"이지 "어느 카테고리가
//    흔한가"가 아니다. 학습은 단순 카운팅이라 수만 건도 밀리초 단위, 추론도
//    제목당 마이크로초 단위 — 15분마다 900건 재분류에 전혀 부담이 없다.
//
// 4. 기권(abstain). 1위-2위 로그확률 차이가 문턱 미만이거나 아는 바이그램이
//    너무 적으면 분류하지 않는다. 확신 없는 오분류는 개인화를 오염시키므로
//    "모름"이 오답보다 낫다. 기권하면 소스의 등록 카테고리가 그대로 남는다.
//
// 5. 정치(politics)는 통계 모델이 아니라 **어휘 사전**으로 따로 판별한다.
//    politics 라벨 공급이 0이라(구글뉴스 KR에 정치 섹션 없음) NB로는 학습할 수
//    없고, 정당·기관·직위 고유명사는 사전 매칭이 더 정확하고 설명 가능하다.
//    실측된 실패("국힘 조경태 '윤리위는 장동혁 아바타'"가 미분류)를 이 사전이
//    직접 잡는다 — topics.js의 분류를 이 사전이 대체·보강한다.

// ---------------------------------------------------------------------------
// 전처리
// ---------------------------------------------------------------------------

// 구글뉴스 제목 꼬리 " - 매체명" 제거. 안 떼면 매체명이 카테고리 신호로 잘못
// 학습된다(연예 기사를 많이 내는 매체명이 culture 자질이 되는 식).
const OUTLET_TAIL = /\s+-\s+[^-]{1,30}$/;
// 말머리 [속보]·[단독]·(종합) 등 — 카테고리와 무관한 편집 표기
const LEAD_TAG = /^\s*[[({【〈<][^\])}】〉>]{0,12}[\])}】〉>]\s*/;

export function normalizeTitle(title) {
  return String(title || "")
    .replace(OUTLET_TAIL, "")
    .replace(LEAD_TAG, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 음절 바이그램 + 영단어는 통짜 토큰. "sk하이닉스 실적" ->
// [sk, sk하, 하이, 이닉, 닉스, 스실(경계 없음: 공백에서 끊음), 실적...]
export function features(title) {
  const norm = normalizeTitle(title);
  const out = [];
  for (const word of norm.split(" ")) {
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) {
      out.push(word); // 영숫자 단어는 그대로 (ai, gpt, sk)
      continue;
    }
    if (word.length === 1) {
      out.push(word);
      continue;
    }
    for (let i = 0; i < word.length - 1; i++) out.push(word.slice(i, i + 2));
    // 트라이그램 추가 — 라이브 홀드아웃 A/B(2026-07-29, 코퍼스 222건)에서
    // 바이그램 단독 75% -> 트라이그램 추가 81%로 정밀도가 올랐다. 오분류는
    // 개인화를 오염시키므로 커버리지보다 정밀도를 우선한다.
    if (word.length >= 3 && /^[가-힣]+$/.test(word)) {
      for (let i = 0; i < word.length - 2; i++) out.push(word.slice(i, i + 3));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 나이브 베이즈 (다항, 라플라스 평활, 균등 사전확률)
// ---------------------------------------------------------------------------

export class TitleClassifier {
  constructor() {
    this.counts = new Map(); // category -> Map<feature, count>
    this.totals = new Map(); // category -> total feature count
    this.vocab = new Set();
    this.trained = 0;
  }

  // weight: 커뮤니티 약지도 라벨은 0.3처럼 낮게 — 소스 1~2개짜리 카테고리가
  // 그 소스 말투에 과적합되는 것을 완화한다(구글뉴스 라벨은 1.0).
  learn(title, category, weight = 1) {
    if (!category) return;
    const feats = features(title);
    if (feats.length < 2) return;
    if (!this.counts.has(category)) {
      this.counts.set(category, new Map());
      this.totals.set(category, 0);
    }
    const m = this.counts.get(category);
    for (const f of feats) {
      m.set(f, (m.get(f) || 0) + weight);
      this.vocab.add(f);
    }
    this.totals.set(category, this.totals.get(category) + feats.length * weight);
    this.trained += 1;
  }

  // { category, margin, known } 반환. margin = 1위-2위 로그확률 차이(자질당 평균),
  // known = 어휘에 있는 자질 비율. 호출부가 이걸로 기권을 판단한다.
  predict(title) {
    const cats = [...this.counts.keys()];
    if (cats.length < 2) return { category: null, margin: 0, known: 0 };
    const feats = features(title);
    if (!feats.length) return { category: null, margin: 0, known: 0 };

    const V = this.vocab.size || 1;
    let knownCount = 0;
    for (const f of feats) if (this.vocab.has(f)) knownCount++;

    const scores = cats.map((c) => {
      const m = this.counts.get(c);
      const total = this.totals.get(c) || 1;
      let logp = 0; // 균등 사전확률 — 위 설계 3 참고
      for (const f of feats) {
        logp += Math.log(((m.get(f) || 0) + 1) / (total + V));
      }
      return { c, logp };
    });
    scores.sort((a, b) => b.logp - a.logp);
    const margin = (scores[0].logp - scores[1].logp) / feats.length;
    return { category: scores[0].c, margin, known: knownCount / feats.length };
  }

  // 직렬화 — 서버 재시작에도 코퍼스 누적을 잃지 않게 store 쪽에서 저장한다.
  toJSON() {
    return {
      trained: this.trained,
      totals: [...this.totals],
      counts: [...this.counts].map(([c, m]) => [c, [...m]])
    };
  }

  static fromJSON(data) {
    const cl = new TitleClassifier();
    if (!data) return cl;
    cl.trained = data.trained || 0;
    for (const [c, t] of data.totals || []) cl.totals.set(c, t);
    for (const [c, entries] of data.counts || []) {
      const m = new Map(entries);
      cl.counts.set(c, m);
      for (const f of m.keys()) cl.vocab.add(f);
    }
    return cl;
  }
}

// 기권 문턱 — margin이 이보다 작거나 아는 자질이 문턱 미만이면 분류 보류.
// 기본값은 감이 아니라 라이브 홀드아웃 스윕(2026-07-29, tools/eval-classifier.mjs)
// 결과다: 초기값 0.35/0.5는 기권률 98%로 사실상 분류기를 꺼 둔 것과 같았고,
// 0.08/0.2가 정확도 81%·커버리지 최대의 운영점이었다. 코퍼스가 쌓일수록
// (15분마다 라벨 367건 유입) 같은 문턱에서 정확도·커버리지가 함께 오른다.
export const MARGIN_MIN = Number(process.env.CLASSIFY_MARGIN_MIN ?? 0.08);
export const KNOWN_MIN = Number(process.env.CLASSIFY_KNOWN_MIN ?? 0.2);

export function classifyTitle(classifier, title) {
  const { category, margin, known } = classifier.predict(title);
  if (!category) return null;
  if (margin < MARGIN_MIN || known < KNOWN_MIN) return null; // 기권
  return category;
}

// 정치 판별은 이 파일이 하지 않는다 — topics.js의 POLITICS_KEYWORDS(어휘 사전,
// 2026-07-29 보강)가 단일 원본이고 normalizeItem에서 이미 매 아이템에 돈다.
// politics는 라벨 공급이 0이라(구글뉴스 KR에 정치 섹션 없음) 통계 분류가
// 성립하지 않으며, 고유명사 사전이 더 정확하고 설명 가능하다.

// ---------------------------------------------------------------------------
// 학습 라벨 소스 — 어떤 소스의 글을 어떤 라벨·가중치로 학습에 쓰는가.
// ---------------------------------------------------------------------------
//
// weight 1.0 = 구글뉴스 섹션(구글의 편집 분류, 신뢰 높음. 실측 367건/15분).
// weight 0.3 = 성격이 고정된 커뮤니티/전문지(약지도). 소스가 1~2개뿐인
//   카테고리는 그 소스 특유의 말투에 과적합되므로 낮게 싣는다.
// 여기 없는 소스(클리앙·뽐뿌·이토랜드 등 혼합 게시판)는 학습에 쓰지 않고
// **분류 대상**이 된다 — 혼합 소스를 학습에 넣으면 라벨 자체가 오염된다.
export const TRAIN_LABELS = new Map([
  // 구글뉴스 섹션 — 편집 분류 그대로
  ["gnews-biz", { category: "business", weight: 1.0 }],
  ["gnews-sports", { category: "sports", weight: 1.0 }],
  ["gnews-ent", { category: "culture", weight: 1.0 }],
  // gnews-science는 실제로 "구글뉴스 건강" 섹션(2차 검수 실측 — science 오분류
  // 65%의 근원). 건강 어휘는 life(라이프/취미)로 학습한다.
  ["gnews-science", { category: "life", weight: 1.0 }],
  ["gnews-tech", { category: "tech", weight: 1.0 }],
  // 단일 성격 커뮤니티·전문지 — 약지도
  // bobae는 여기서 뺐다(2026-07-31 David 실측 지적): 보배드림 "베스트"는 전
  // 게시판 통합이라 15건 중 자동차 글이 1건뿐이었다 — 이 제목들로 auto를
  // 학습시키는 것은 오염이고, 학습 소스로 묶여 재분류까지 금지되는 이중
  // 손해였다. 자동차 판별은 아래 AUTO_KEYWORDS(설명 가능한 사전)가 맡는다.
  ["ruliweb", { category: "gaming", weight: 0.3 }],
  ["inven_hot", { category: "gaming", weight: 0.3 }],
  ["theqoo", { category: "culture", weight: 0.3 }],
  // etoland는 학습 라벨에서 뺐다 (2026-08-02 라이브 실측 27건). bobae를 뺀 것과
  // 같은 이유이고 근거도 같은 종류다: 이토랜드 HIT는 전 게시판 통합 랭킹이라
  // 연예("배우 김고은", "트와이스 사나")·상품광고("하루특가) 소연골 콘드로이친")
  // 제목이 humor 라벨로 학습돼 왔다 — 오염이고, 학습 소스로 묶이는 바람에
  // NB 재분류까지 금지되는 이중 손해였다. 이제 재분류 대상이다.
  ["todayhumor", { category: "humor", weight: 0.3 }],
  ["geeknews", { category: "tech", weight: 0.3 }],
  ["hackernews", { category: "tech", weight: 0.3 }],
  ["etnews", { category: "tech", weight: 0.3 }],
  ["mk-news", { category: "business", weight: 0.3 }]
]);

// 덮어쓰기가 허용되는 예측 카테고리 — **주제 어휘로 학습된 것만**.
//
// 라이브 실측(2026-07-29, 풀 879건): humor·gaming 예측은 주제가 아니라
// 커뮤니티 말투("~네요", "~는데요")에 반응했다 — 정치 넋두리 글이 humor로,
// "내란" 글이 gaming으로 갔다. humor(이토랜드·오유)와 gaming(루리웹·인벤)
// 코퍼스는 구어체 그 자체라서다. 이 두 클래스는 모델에 **남겨 둔다** —
// 구어체 자질을 흡수해 business 등으로 새는 것을 막는 완충재 역할 — 하지만
// 예측이 거기로 떨어지면 덮어쓰지 않고 기권으로 취급한다.
export const OVERRIDE_CATEGORIES = new Set(["business", "sports", "culture", "science", "tech", "auto", "life"]);

// 분류 결과로 소스 카테고리를 덮어쓸 대상 — 혼합 게시판만. 학습 소스와
// gnews 종합 섹션(news가 맞는 라벨)은 건드리지 않는다.
export function isReclassifiable(sourceId) {
  if (!sourceId) return false;
  if (RECLASSIFY_DESPITE_TRAINING.has(sourceId)) return true;
  if (TRAIN_LABELS.has(sourceId)) return false;
  if (String(sourceId).startsWith("gnews")) return false; // 종합 섹션은 news가 정답
  return true;
}

// ---------------------------------------------------------------------------
// 키워드 확정 분류 (David 2026-07-31: "제목 단어에서 카테고리를 유추하는
// 알고리즘 개선" — 실측: 자동차 브리핑이 보배 비자동차 글로 채워지고, 경제
// 뉴스에 씨라이언7 시승기가 섞였다)
// ---------------------------------------------------------------------------
//
// NB 분류기는 auto의 학습원이 없다(구글뉴스에 자동차 섹션이 없고, bobae는
// 오염이라 뺐다). 그래서 자동차는 **고유명사·전용용어 사전**으로 확정한다 —
// topics.js의 정치 사전과 같은 원칙: 설명 가능하고, 오탐이 확인되면 단어를
// 빼는 게 정답인 구조. 일반어("사고","주차","음주운전")는 사회뉴스·일상글에
// 걸리므로 넣지 않는다.
export const AUTO_KEYWORDS = [
  // 제조사·브랜드
  "현대차", "기아차", "제네시스", "테슬라", "벤츠", "BMW", "아우디", "폭스바겐",
  "볼보", "포르쉐", "렉서스", "토요타", "도요타", "혼다", "쉐보레", "르노코리아",
  "쌍용차", "KGM", "페라리", "람보르기니", "BYD",
  // 모델 (국내 판매 상위·화제 차종)
  "아반떼", "쏘나타", "그랜저", "팰리세이드", "싼타페", "투싼", "쏘렌토",
  "스포티지", "카니발", "셀토스", "캐스퍼", "아이오닉", "EV3", "EV6", "EV9",
  "모델3", "모델Y", "씨라이언",
  // 전용 용어
  "시승", "신차", "전기차", "하이브리드", "내연기관", "SUV", "세단", "쿠페",
  "해치백", "연비", "주행거리", "자율주행", "급발진", "오토바이", "이륜차",
  "중고차", "신차 출고", "차량 출고", "차박", "차량용", "블랙박스", "블박"
];

// 자동차 브랜드가 나와도 금융·기업 문맥이면 경제 기사다 ("현대차 주가 급등",
// "테슬라 실적 발표") — 이 가드에 걸리면 키워드 확정을 포기하고 원 분류 유지.
export const AUTO_FINANCE_GUARD = ["주가", "실적", "영업이익", "매출", "수출", "노조", "파업", "채용", "공장", "투자",
  // 2026-08-02 검수 A15: 부고·사고 기사가 브랜드명만으로 auto로 갔다
  "별세", "타계", "빈소", "화재", "기소", "구속"];

// 카테고리별 문맥 가드 (검수 A3) — AUTO_FINANCE_GUARD와 대칭.
// 회사명이 곧 카테고리는 아니다: "넥슨 주가 급등"은 게임이 아니라 경제다.
// 가드에 걸리면 그 카테고리를 후보에서 **탈락**시킬 뿐, 다른 카테고리로
// 라우팅하지는 않는다 — 우리가 아는 것은 "게임이 아니다"까지이고, 경제라고
// 단정할 근거는 없기 때문(확신 없는 라우팅이 바로 이 검수가 지적한 병이다).
export const CATEGORY_GUARDS = new Map([
  ["gaming", ["주가", "실적", "영업이익", "매출", "노조", "파업", "별세", "사옥",
              "상장", "공모", "채용", "소송", "인수", "합병", "지분"]],
  ["tech", ["주가", "실적", "영업이익", "매출", "상장", "공모", "별세", "지분"]],
  ["culture", ["주가", "실적", "상장", "별세", "지분"]]
]);

export function keywordCategory(title, opts = {}) {
  const t = String(title || "");
  if (!t) return null;
  const tl = t.toLowerCase(); // A5: 소문자 영문 브랜드(bmw·chatgpt·github) 미탐 해소
  // 자동차가 먼저 — 브랜드·모델이 다른 사전과 겹치지 않고 금융 가드가 붙는다
  if (AUTO_KEYWORDS.some((k) => tl.includes(k.toLowerCase()))) {
    if (AUTO_FINANCE_GUARD.some((k) => t.includes(k))) return null;
    return "auto";
  }
  if (opts.autoOnly) return null;
  // 문맥 가드에 걸린 카테고리는 후보에서 탈락, 나머지 중 히트 최다를 채택.
  // **동점이면 기권**한다(A4) — 예전엔 선언 순서로 임의 승자를 뽑아 "확신에 찬
  // 오답"을 냈고, 그 오답이 취향 벡터·쿼터·브리핑까지 검증 없이 번졌다.
  const scored = [];
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    const guard = CATEGORY_GUARDS.get(cat);
    if (guard && guard.some((k) => t.includes(k))) continue;
    let hits = 0;
    for (const w of words) if (tl.includes(w.toLowerCase())) hits++;
    if (hits) scored.push([cat, hits]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b[1] - a[1]);
  if (scored.length > 1 && scored[0][1] === scored[1][1]) return null;
  return scored[0][0];
}

// 게시판 URL로 카테고리가 확정되는 규칙 — 통합 베스트에 섞여 들어와도
// 아이템 url에 원 게시판이 남는 소스들 (topics.js BOARD_TOPIC_RULES와 같은
// 원리, 대상이 topic이 아니라 category일 뿐). 적대적 검수 실측(2026-07-31):
// 뽐뿌 자동차게시판(zboard id=car) 글이 business로 배달되고 있었다.
export const BOARD_CATEGORY_RULES = [
  { source: "ppomppu", pattern: /[?&]id=car\b/i, category: "auto" }
];

// ---------------------------------------------------------------------------
// 카테고리 어휘 사전 (David 2026-08-02: "커뮤니티 종합게시판은 제목만 봐도
// 사람이 유추 가능하니 그렇게 정확히 분류하라")
// ---------------------------------------------------------------------------
//
// 원칙은 정치 사전(topics.js)과 같다: **고유명사·전용어만** 넣는다. 일반어를
// 넣으면 다른 카테고리를 잡아먹는다. 오탐이 나오면 매칭 로직을 꼬는 게 아니라
// 그 단어를 빼는 게 정답이다 — 사전은 끝까지 설명 가능해야 한다.
// 적용 대상은 **혼합 게시판(커뮤니티)**과 종합 뉴스뿐이다. 섹션이 이미 정해진
// 뉴스(경제지·연예지 등)는 등록 카테고리를 그대로 쓴다.
export const CATEGORY_KEYWORDS = [
  ["gaming", [
    "롤드컵", "리그오브레전드", "리그 오브 레전드", "LoL", "롤체", "옵치", "발로란트", "오버워치", "배그", "배틀그라운드",
    "메이플", "던파", "던전앤파이터", "로스트아크", "디아블로", "스타크래프트",
    "피파온라인", "넥슨", "엔씨소프트", "넷마블", "크래프톤", "스팀 세일", "스팀 신작", "닌텐도",
    "플스", "플레이스테이션", "엑스박스", "e스포츠", "이스포츠", "패치노트",
    "젠지", "T1", "한화생명e", "디플러스", "케스파", "가챠", "인게임", "너프", "버프"
  ]],
  ["sports", [
    "손흥민", "이강인", "김민재", "황희찬", "류현진", "김하성", "이정후", "오타니",
    "프리미어리그", "챔피언스리그", "월드컵", "국가대표", "A매치", "K리그",
    "프로야구", "KBO", "MLB", "메이저리그", "NBA", "KBL", "V리그", "올림픽",
    "아시안게임", "결승골", "선발승", "홈런", "타율", "방어율", "감독 선임",
    "이적설", "완봉", "무실점", "PBA", "골프 우승", "KLPGA", "LPGA"
  ]],
  ["culture", [
    "아이돌", "걸그룹", "보이그룹", "컴백", "신곡", "음원차트", "빌보드",
    "뮤직뱅크", "엠카운트다운", "연예인", "드라마", "예능", "넷플릭스",
    "디즈니플러스", "티빙", "웨이브", "영화 개봉", "박스오피스", "관객수",
    "OST", "콘서트", "팬미팅", "소속사", "열애설", "결별설", "복귀작", "출연 확정",
    "BTS", "블랙핑크", "뉴진스", "아이브", "세븐틴", "에스파", "르세라핌",
    // 2026-08-02 라이브 실측(이토랜드 HIT): 아래 그룹 글이 전부 humor로 배달됐다.
    "트와이스", "비비지", "프로미스나인", "아이들", "스테이씨", "있지", "레드벨벳",
    // "배우"는 A6에서 "연극 배우 이사"를 이유로 뺐지만, 진짜 원인은 같은 제목의
    // "이사"였고 그건 이미 제거됐다. 뒤 공백을 붙이면 "배우자"·"배우고"·"배우기"를
    // 피하면서 "배우 김고은"은 잡는다(오탐 6종 실측 확인).
    "배우 "
  ]],
  ["business", [
    "코스피", "코스닥", "나스닥", "다우지수", "환율", "원달러", "기준금리",
    "한국은행", "금통위", "물가상승률", "소비자물가", "부동산", "아파트값",
    "전세", "청약", "재건축", "분양", "주가", "상한가", "하한가", "공모주",
    "실적발표", "영업이익", "매출액", "적자전환", "흑자전환", "인수합병",
    "상장폐지", "배당금", "연금저축", "ISA", "대출금리", "예금금리", "세금 신고"
  ]],
  ["tech", [
    "인공지능", "AI 모델", "챗GPT", "ChatGPT", "GPT-", "클로드", "제미나이",
    "오픈AI", "엔비디아", "반도체", "HBM", "파운드리", "갤럭시", "아이폰",
    "애플워치", "안드로이드", "iOS ", "윈도우 업데이트", "리눅스", "오픈소스",
    "깃허브", "GitHub", "클라우드", "AWS", "데이터센터", "해킹", "랜섬웨어",
    "개인정보 유출", "스마트폰", "노트북 신제품", "그래픽카드", "RTX"
  ]],
  ["life", [
    "레시피", "집밥", "다이어트 식단", "홈트", "캠핑", "등산", "낚시", "반려견",
    "반려묘", "강아지", "고양이", "육아", "인테리어", "포장이사", "청소 꿀팁",
    "여행 코스", "숙소 추천", "맛집", "카페 추천", "건강검진", "영양제",
    "탈모", "피부과", "치과", "다이소", "쿠팡 주문", "장보기"
  ]],
  ["science", [
    "우주선", "NASA", "스페이스X", "누리호", "인공위성", "블랙홀",
    "외계행성", "제임스웹", "천체", "유전자", "백신 개발", "임상시험",
    "노벨상", "논문 발표", "연구진", "화석", "고생물", "기후변화", "탄소중립"
  ]]
];

// 제목 사전 + 게시판 URL 규칙을 합친 확정 분류. 게시판 규칙이 우선한다 —
// 원 게시판은 글쓴이가 직접 고른 분류라 제목 추정보다 강한 신호다.
export function definiteCategory({ title, url, sourceId, autoOnly } = {}) {
  if (url && sourceId) {
    const rule = BOARD_CATEGORY_RULES.find((r) => r.source === sourceId && r.pattern.test(url));
    if (rule) return rule.category;
  }
  return keywordCategory(title, { autoOnly });
}

// 혼합 베스트 게시판의 폴백: 주제 사이트지만 "베스트"가 전 게시판 통합이라
// 키워드도 분류기도 못 잡은 글은 사이트 주제가 아니라 게시판의 실측 지배
// 성격으로 돌린다. 보배 베스트 실측(2026-07-31, 15건): 자동차 1건, 나머지는
// 유머·일상·시사(시사는 politics 토글이 별도로 잡는다) — 지배 성격은 humor.
export const MIXED_BEST_FALLBACK = new Map([
  ["bobae", { registryCategory: "auto", fallback: "humor" }],
  // 뽐뿌 핫게시글도 전 게시판 통합 — 2차 검수 실측: business 태그 10건 중
  // 8건이 비경제("아파트 복도 에어컨" 등). 잡담 지배 성격은 humor.
  ["ppomppu", { registryCategory: "business", fallback: "humor" }]
]);

// 학습 소스지만 재분류도 허용하는 예외 — 해커뉴스는 tech 위주라 학습 가치는
// 있지만 종합 글(스포츠 성명·환경·생활)도 섞인다. 2차 검수 실측: UEFA 축구
// 성명이 tech 1위. 학습(약지도 0.3)은 유지하되 NB가 확신하면 덮어쓴다.
export const RECLASSIFY_DESPITE_TRAINING = new Set(["hackernews"]);
