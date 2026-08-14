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

  // 자기 기여 제외 예측 (R6, 2026-08-14 David HOLD 결함 6) — leave-one-out.
  //
  // 이 제목이 category 라벨로 학습 코퍼스에 들어가 있다면, learn()이 더한 것과
  // 정확히 같은 양(자질별 weight×출현수, 총량 feats.length×weight)을 뺀 상태로
  // 예측한다. 비파괴 — counts·totals·vocab은 건드리지 않는다.
  //
  // 왜: aggregate 재분류 관문이 "gnews-biz 제목을 business로 학습한 직후 같은
  // 제목을 분류"하면 자기 라벨을 암기해 관문이 0건이 된다(신선 풀 1,968건 실측
  // 0/112 — 관문 무효). 자기 기여만 빼면 나머지 코퍼스는 그대로라 specialist
  // 교정·커뮤글 재분류 경로에 파급이 없다(대안이었던 '전문 섹션 학습 제외'는
  // 같은 풀에서 관문 밖 12건의 카테고리를 흔들어 기각 — 실측 2026-08-14).
  //
  // known도 같은 원칙으로 센다: 자기 기여를 빼고 코퍼스에 남는 자질만 '아는
  // 자질'이다 — 자기 문서에서만 온 자질로 known을 부풀리면 기권 관문이 뚫린다.
  predictExcluding(title, category, weight = 1) {
    const feats = features(title);
    // learn()은 자질 2개 미만이면 학습하지 않았다 — 뺄 기여가 없다. 학습된 적
    // 없는 카테고리도 마찬가지다(뺄 대상이 코퍼스에 없다).
    if (feats.length < 2 || !this.counts.has(category)) return this.predict(title);
    const cats = [...this.counts.keys()];
    if (cats.length < 2) return { category: null, margin: 0, known: 0 };

    const removedPerFeat = new Map();
    for (const f of feats) removedPerFeat.set(f, (removedPerFeat.get(f) || 0) + weight);

    const V = this.vocab.size || 1;
    let knownCount = 0;
    for (const f of feats) {
      if (!this.vocab.has(f)) continue;
      let remaining = 0;
      for (const c of cats) {
        const m = this.counts.get(c);
        let v = m.get(f) || 0;
        // 이 제목이 실제로 학습되지 않았을 수 있어(learnedIds 정리 후 재기동 등)
        // 0 밑으로 빼지 않는다 — 과제거보다 잔존 암기가 덜 위험하다.
        if (c === category) v = Math.max(0, v - removedPerFeat.get(f));
        remaining += v;
      }
      if (remaining > 0) knownCount++;
    }

    const scores = cats.map((c) => {
      const m = this.counts.get(c);
      let total = this.totals.get(c) || 1;
      if (c === category) total = Math.max(1, total - feats.length * weight);
      let logp = 0; // 균등 사전확률 — predict()와 동일
      for (const f of feats) {
        let v = m.get(f) || 0;
        if (c === category) v = Math.max(0, v - removedPerFeat.get(f));
        logp += Math.log((v + 1) / (total + V));
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
  // ruliweb RSS는 전체 게임판이 아니라 board 300143 유머 게시판 베스트다.
  // 게임 고유어가 있는 글만 gaming으로 보내고 나머지는 mixed 폴백에 맡긴다.
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
// 2026-08-07: 신설 셋도 넣는다. 학습 모델이 언젠가 이 라벨을 배우면 예측이
// 여기로 떨어질 수 있어야 한다. (지금은 코퍼스에 없어 예측되지 않는다.)
export const OVERRIDE_CATEGORIES = new Set(["business", "sports", "culture", "science", "tech", "auto", "life",
  "realestate", "fashion", "art"]);

// 분류기가 **학습한 적 없는** 카테고리 — 2026-08-07 신설 셋.
//
// 소스가 이 분야를 선언했다면 그 선언을 지킨다. 실측(2026-08-07 라이브):
//   hypebeast          registry fashion    → 분류기가 culture로 덮어씀
//   hankyung-realestate registry realestate → 분류기가 **auto**로 덮어씀
// 새 카테고리를 만들었는데 라이브 풀에 0건이었던 이유가 이것이다.
//
// 모델 코퍼스에 realestate·fashion·art 라벨이 없으니 예측이 거기로 나올 수
// 없고, 그래서 **가장 가까운 옛 라벨로 반드시 틀린다.** 하입비스트를 연예로,
// 부동산 기사를 자동차로 보내는 추측보다 "이 소스는 패션이다"라는 선언이 낫다
// — 상세 광고 매칭에서 이미 쓴 원칙과 같다(소스가 밝힌 분야를 먼저 본다).
//
// 학습 코퍼스에 이 라벨들이 들어오면 이 집합에서 빼면 된다.
export const UNTRAINED_CATEGORIES = new Set(["realestate", "fashion", "art"]);

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
  // 2026-08-02 검수 A15: 부고 기사가 브랜드명만으로 auto로 갔다
  "별세", "타계",
  // 대학·기관의 교육 운영은 자율주행이 등장해도 자동차 제품·시장 기사가 아니다.
  "비교과", "교육과정", "인력양성"];
// "화재"·"기소"·"구속"은 여기서 뺐다(2026-08-05). 사건 보도는 이제 INCIDENT_GUARD가
// 더 정확하게 잡고, "화재"를 금융 가드에 두면 **자동차 주제인 글까지 떨어졌다** —
// "전기차 화재 원인 분석"은 자동차 이슈다. 가드는 좁을수록 좋다.

// ── 사건·사고 가드 (David 2026-08-05, 자동차 브리핑 실측)
//
// 자동차 브리핑 1~4위가 이랬다:
//   1. 어제자 진주 택시 전복사고 ㄷㄷ gif
//   2. 본인은 억울하다고 한문철에 제보한 교통사고 블랙박스 영상
//   3. 어머니 벤츠로 음주운전… 10대 가로수 충돌 사망
//   4. 오늘자 진주 택시 전복사고 블랙박스
// 6~10위가 되어서야 진짜 자동차 글이 나왔다(아반떼 가격표, 자율주행 센서 비교,
// 테슬라 수입차 1위).
//
// David: "그냥 자동차가 글에 등장만 할 뿐이지 자동차 주제의 글은 아니지.
//         매장 가서 봤는데 죽이더라, 타봤는데 좋더라, 이거 고장 많이 나니
//         조심해라 같은 자동차 **자체가 주제**인 글이 올라와야 맞는데.
//         이것뿐만 아니라 다른 주제도 마찬가지야."
//
// 그래서 한 주제에만 붙이지 않고 **모든 주제 카테고리에 공통으로** 건다.
// 특정 사건을 전하는 글은 그 사건이 주제이지, 거기 등장하는 사물이 주제가
// 아니다 — 자동차 사고는 시사이고, 게임회사 화재도 시사다.
//
// 넣지 않은 말들: "화재"·"불"·"논란"·"피해". 그 주제 자체의 이슈일 수 있다
// (전기차 화재 원인 분석은 자동차 글이고, 리콜 논란도 자동차 글이다).
// 오탐 하나가 진짜 주제 글을 밀어낸다 — 확실한 것만 넣는다.
export const INCIDENT_GUARD = [
  // 인명 피해 — 사건 보도의 가장 분명한 표지
  "사망", "숨져", "숨진", "숨졌", "참변", "빈소", "발인",
  // 사고 유형
  "전복사고", "추돌", "뺑소니", "음주운전", "역주행", "무면허",
  "졸음운전", "교통사고", "인명사고", "낙상", "감전",
  // 수사·재판
  "구속", "체포", "검거", "송치", "입건", "피의자", "용의자", "징역", "실형",
  // 사건 영상·제보 형식
  "블랙박스 영상", "cctv", "한문철", "제보한",
  // 시점 지시 — 커뮤니티 사건 게시물의 관용 표기
  "어제자 ", "오늘자 "
];

// "대참사"는 일상적인 실패담에도 흔해서 단어 하나만으로 사건 처리할 수 없다.
// 대신 실제 재난 대상이나 수사 후속어가 함께 있을 때만 사건 보도로 본다.
const INCIDENT_CONTEXT = [
  /(여객기|항공|열차|선박|압사|산재|붕괴).{0,12}참사/i,
  /참사.{0,18}(수사|특수단|희생자|유가족|사망|추모|압수수색)/i
];

// 이 제목이 "사건 보도"인가. 그렇다면 거기 등장하는 사물(자동차·게임·기업)이
// 아니라 **사건**이 주제다.
export function looksLikeIncident(title) {
  const t = String(title || "").toLowerCase();
  return INCIDENT_GUARD.some((k) => t.includes(k.toLowerCase()))
    || INCIDENT_CONTEXT.some((pattern) => pattern.test(t));
}

// 카테고리별 문맥 가드 (검수 A3) — AUTO_FINANCE_GUARD와 대칭.
// 회사명이 곧 카테고리는 아니다: "넥슨 주가 급등"은 게임이 아니라 경제다.
// 가드에 걸리면 그 카테고리를 후보에서 **탈락**시킬 뿐, 다른 카테고리로
// 라우팅하지는 않는다 — 우리가 아는 것은 "게임이 아니다"까지이고, 경제라고
// 단정할 근거는 없기 때문(확신 없는 라우팅이 바로 이 검수가 지적한 병이다).
export const CATEGORY_GUARDS = new Map([
  ["gaming", ["주가", "실적", "영업이익", "매출", "노조", "파업", "별세", "사옥",
              "상장", "공모", "채용", "소송", "인수", "합병", "지분", "여행가챠"]],
  ["tech", ["주가", "실적", "영업이익", "매출", "상장", "공모", "별세", "지분",
             "뉴욕증시", "유가", "3대 지수", "코스피", "코스닥", "나스닥", "다우지수", "환율",
             "Pokémon", "Pokemon", "포켓몬", "Pokopia", "포트나이트", "에픽게임즈", "팰월드", "Palworld"]],
  ["science", ["ETF", "펀드", "자산운용", "증권", "주가", "실적", "영업이익", "매출", "상장", "공모", "지분"]],
  ["business", ["임직원 초청 행사", "꿈나무 초대행사", "사내 봉사활동", "기부금 전달"]],
  ["culture", ["주가", "실적", "상장", "별세", "지분", "이완용", "친일 매국노"]],
  // "코디네이터"는 고정 표본 7 실측(2026-08-13 P2-A): dev.to 공지 번역 제목
  // "…DEV 커뮤니티 프로그램 코디네이터인 Jem입니다"에서 사전의 "코디"가
  // 낱말 내부로 매칭돼 tech 선언이 fashion으로 뒤집혔고 패션 1위에 올랐다.
  // 직업명 "코디네이터"가 있는 제목은 fashion 후보에서 뺀다.
  ["fashion", ["악마는 프라다를 입는다", "코디네이터"]],
  ["humor", ["대학살", "학살", "사망", "숨져", "참사", "화재", "살해", "실종",
             "강제 낙태", "강제불임", "한센인", "전쟁범죄", "고문 피해", "친일파", "친일 후손", "매국노"]]
]);

const TECH_SUBJECT = /(인공지능|\bai\b|챗gpt|chatgpt|gpt-|클로드|제미나이|오픈ai|반도체|hbm|파운드리|소프트웨어|앱\b|ios\b|안드로이드|클라우드|데이터센터|해킹|랜섬웨어|스마트폰|노트북|그래픽카드|디지털|가상현실|증강현실|\bvr\b|\bar\b)/i;
const CULTURE_EVENT_SUBJECT = /(?:아티스트|아이돌|가수|보이그룹|걸그룹|엔하이픈).{0,40}(?:전시|콘서트|팬미팅)|(?:전시|콘서트|팬미팅).{0,40}(?:아티스트|아이돌|가수|보이그룹|걸그룹|엔하이픈)/i;
const GAMING_SUBJECT = /(게임|게이머|오버워치|overwatch|옵치|팰월드|palworld|포켓몬|pok[eé]mon|pokopia|포트나이트|fortnite|스팀\s*머신|플레이스테이션|xbox|엑스박스|\bcbt\b)/i;
const CULTURE_SUBJECT = /(영화|드라마|예능|배우|감독|아이돌|가수|음악|음원|앨범|신곡|공연|콘서트|팬미팅|전시|작품|소설|웹툰|넷플릭스|박스오피스)/i;
const CULTURE_PRODUCTION_CONTEXT = /(영화|예능|배우|감독|아이돌|가수|음악|음원|앨범|신곡|공연|콘서트|팬미팅|전시|작품|소설|웹툰|넷플릭스|박스오피스|드라마.{0,12}(?:방영|공개|제작|출연|시청률)|(?:방영|공개|제작|출연|시청률).{0,12}드라마)/i;
const CULTURE_PERFORMER = /(아이돌|가수|배우\s|보이그룹|걸그룹|bts|블랙핑크|뉴진스|아이브|세븐틴|에스파|르세라핌|트와이스|비비지|프로미스나인|피프티피프티|아이들|스테이씨|있지|레드벨벳|스트레이\s*키즈)/i;
const FASHION_SUBJECT = /(패션|의상|룩북|스타일|화보|컬렉션|브랜드|가방|앰배서더|착용|런웨이|코디)/i;
const CELEBRITY_DONATION = /(기부|후원|성금)/i;
const BUSINESS_DONATION_CONTEXT = /(기업|회사|법인|재단|사회공헌|esg|임직원|매출|협약)/i;
const GEOPOLITICAL_ACTOR = /(우크라이나|러시아|이스라엘|이란|북한|중국|미국|일본|유럽|나토|정부|대통령)/i;
const GEOPOLITICAL_CONFLICT = /(전쟁|침공|공격|제재|외교|국경|미사일|핵무기|저주|망하라고|혐오)/i;
const REALESTATE_SUBJECT = /(부동산|주택|아파트|집값|전셋값|월세|전세(?!계)|매매가|분양|청약|재건축|재개발|입주|공시가격|종부세|취득세|주택담보대출|임대차|전세사기|갭투자|미분양|택지|그린벨트|역세권|오피스텔|상가\s*임대)/i;
const CLIMATE_OR_DISASTER_SUBJECT = /(폭염|한파|태풍|폭우|홍수|해수면\s*온도|기후|지진|강진|화산|산불|earthquake|\bquake\b|wildfire|flood)/i;
const SCIENCE_REPORTING_CONTEXT = /(연구|연구진|논문|학술|분석|관측|실험|데이터|과학자|기후변화|study|research|researcher|scientist|journal|experiment|analysis|data)/i;
const DISASTER_OR_OBITUARY_REPORT = /(사망|숨져|숨진|별세|타계|국가비상사태|killing|killed|\bdies\b|\bdeath\b|earthquake|\bquake\b)/i;
const POLITICAL_PROCESS_CONTEXT = /(대통령|정부|국회|민주당|국민의힘|정당|선거|특검|수사|김건희|박지원|이재명|한동훈|정청래|나경원|윤상현)/i;
const AUTO_PRODUCT_CONTEXT = /(자동차|차량|현대차|기아|제네시스|테슬라|벤츠|bmw|아우디|폭스바겐|볼보|포르쉐|렉서스|토요타|도요타|혼다|쉐보레|르노|kgm|byd|아반떼|쏘나타|그랜저|팰리세이드|싼타페|투싼|쏘렌토|스포티지|카니발|셀토스|캐스퍼|아이오닉|ev[369]|모델[3y]|씨라이언|전기차|하이브리드|내연기관|suv|세단|쿠페|해치백|시승|연비|주행거리|자율주행|급발진|리콜|배터리|브레이크)/i;

// 제목의 낱말 하나가 분야를 훔치지 못하게 하는 공통 가드. 분류 단계뿐 아니라
// 자체 편집 기계 게이트에서도 같은 함수를 써서, 디스크에 이미 잘못 저장된
// 과거 분류가 다음 판 대표 이슈로 되살아나는 경로까지 막는다.
export function categoryGuardReason(category, title, item = null) {
  const raw = String(title || "");
  const text = String(title || "").toLowerCase();
  if (category === "tech" && GAMING_SUBJECT.test(raw) && !TECH_SUBJECT.test(raw)) {
    return "gaming-without-tech-subject";
  }
  if (category === "tech" && CULTURE_EVENT_SUBJECT.test(raw) && !TECH_SUBJECT.test(raw)) {
    return "culture-event-without-tech-subject";
  }
  if (category === "culture" && GEOPOLITICAL_ACTOR.test(raw)
      && GEOPOLITICAL_CONFLICT.test(raw) && !CULTURE_SUBJECT.test(raw)) {
    return "geopolitical-conflict-without-culture-subject";
  }
  if (category === "culture" && POLITICAL_PROCESS_CONTEXT.test(raw)
      && !CULTURE_PRODUCTION_CONTEXT.test(raw)) {
    return "political-process-without-culture-subject";
  }
  if (category === "business" && CULTURE_PERFORMER.test(raw)
      && CELEBRITY_DONATION.test(raw) && !BUSINESS_DONATION_CONTEXT.test(raw)) {
    return "celebrity-donation-without-business-subject";
  }
  if (category === "business" && CULTURE_PERFORMER.test(raw) && /(별세|타계)/.test(raw)) {
    return "performer-obituary-without-business-subject";
  }
  if (category === "fashion" && CULTURE_PERFORMER.test(raw) && !FASHION_SUBJECT.test(raw)) {
    return "performer-name-collision-without-fashion-subject";
  }
  if (category === "fashion" && /(치약|세척|청소|얼룩|세탁)/.test(raw) && /(?:운동화|신발)/.test(raw)
      && !FASHION_SUBJECT.test(raw)) {
    return "household-care-without-fashion-subject";
  }
  if (category === "realestate" && looksLikeIncident(raw) && !REALESTATE_SUBJECT.test(raw)) {
    return "incident-without-realestate-subject";
  }
  if (category === "auto" && looksLikeIncident(raw) && !AUTO_PRODUCT_CONTEXT.test(raw)) {
    return "incident-without-auto-subject";
  }
  if (category === "realestate" && CLIMATE_OR_DISASTER_SUBJECT.test(raw) && !REALESTATE_SUBJECT.test(raw)) {
    return "climate-without-realestate-subject";
  }
  if (category === "science" && DISASTER_OR_OBITUARY_REPORT.test(raw)
      && !SCIENCE_REPORTING_CONTEXT.test(raw)) {
    return "incident-without-science-subject";
  }
  if (item && item.registryCategory === "news" && category !== "news" && category !== "politics"
      && looksLikeIncident(raw) && category !== "realestate") {
    return "incident-from-general-news";
  }
  const guard = CATEGORY_GUARDS.get(category) || [];
  const matched = guard.find((keyword) => text.includes(String(keyword).toLowerCase()));
  return matched ? String(matched) : null;
}

// category-policy.js(P2-A 관문)가 같은 경계 규칙으로 사전 히트를 세도록 export.
export function includesCategoryKeyword(lowerTitle, keyword) {
  const lowerKeyword = String(keyword || "").toLowerCase();
  if (!lowerKeyword) return false;
  // 짧은 영문 약어는 영단어 내부 부분문자열로 세지 않는다. 예: disappeared의
  // "isa"를 금융상품 ISA로 읽으면 생활 글이 경제판으로 이동한다. 한글과 붙는
  // 표기(ISA계좌)는 경계로 인정하되 영숫자 내부만 차단한다.
  if (/^[a-z0-9]+$/.test(lowerKeyword)) {
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(lowerTitle);
  }
  return lowerTitle.includes(lowerKeyword);
}

export function keywordCategory(title, opts = {}) {
  const t = String(title || "");
  if (!t) return null;
  const tl = t.toLowerCase(); // A5: 소문자 영문 브랜드(bmw·chatgpt·github) 미탐 해소
  // "정신차려라" 안의 "신차"를 자동차로 읽지 않는다. 표현 부분만 걷으므로
  // "정신 차리고 신차를 샀다"처럼 별도 자동차 낱말이 있으면 그대로 잡힌다.
  const autoTitle = tl.replace(/정신\s*차(?:려라|려야|려|리고|리자|리세요|립니다|리다)/g, "");
  // 자동차가 먼저 — 브랜드·모델이 다른 사전과 겹치지 않고 금융 가드가 붙는다
  // 사건 보도면 주제 확정을 포기한다 — 자동차가 등장할 뿐 주제가 아니다.
  // 모든 주제 카테고리에 공통으로 걸리므로 여기 한 번만 검사한다.
  if (looksLikeIncident(t)) return null;
  if (AUTO_KEYWORDS.some((k) => includesCategoryKeyword(autoTitle, k))) {
    if (AUTO_FINANCE_GUARD.some((k) => t.includes(k))) return null;
    return "auto";
  }
  if (opts.autoOnly) return null;
  // 문맥 가드에 걸린 카테고리는 후보에서 탈락, 나머지 중 히트 최다를 채택.
  // **동점이면 기권**한다(A4) — 예전엔 선언 순서로 임의 승자를 뽑아 "확신에 찬
  // 오답"을 냈고, 그 오답이 취향 벡터·쿼터·브리핑까지 검증 없이 번졌다.
  const scored = [];
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (categoryGuardReason(cat, t)) continue;
    let hits = 0;
    for (const w of words) if (includesCategoryKeyword(tl, w)) hits++;
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
  { source: "ppomppu", pattern: /[?&]id=car\b/i, category: "auto" },
  { source: "chosunbiz", pattern: /\/sports\/baseball\//i, category: "sports" }
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
  // 2026-08-06 신설 세 카테고리. 앞에 둔 이유가 있다 — 이 사전은 적중 수가
  // 가장 많은 카테고리를 고르고 **동점이면 분류를 포기**한다(아래 classify).
  // 그래서 순서 자체는 결과를 바꾸지 않지만, 새 항목이 기존 항목에 묻히지
  // 않게 눈에 띄는 자리에 둔다.
  //
  // 고유명사만 넣는다. "디자인"·"전시" 같은 일반어를 넣으면 IT 기사와
  // 연예 기사가 통째로 끌려온다 — politics 사전에서 "여당" 단독을 뺀 것과 같은 이유다.
  ["realestate", [
    "부동산", "아파트값", "집값", "전셋값", "월세", "전세", "매매가", "분양", "청약",
    "재건축", "재개발", "입주", "공시가격", "종부세", "종합부동산세", "취득세",
    "LTV", "DSR", "주택담보대출", "임대차", "전세사기", "갭투자", "미분양",
    "국토교통부", "국토부", "택지", "그린벨트", "역세권", "오피스텔", "상가 임대"
  ]],
  ["fashion", [
    "스니커즈", "운동화", "나이키", "아디다스", "뉴발란스", "조던", "컨버스", "아식스",
    "패션위크", "컬렉션", "런웨이", "룩북", "코디", "스타일링", "구찌", "프라다",
    "루이비통", "샤넬", "에르메스", "발렌시아가", "디올", "버버리", "유니클로",
    // 쇼핑 플랫폼 이름 하나만으로 상품 카테고리를 확정하지 않는다. 실측에서
    // "[무신사] 생리대 18x6팩"이 패션 대표 이슈가 됐다. 상품 자체를 말하는
    // 전용어가 함께 있을 때만 패션으로 보낸다.
    "스트릿웨어", "명품 가방", "신상 출시", "협업 컬렉션", "드로우 응모"
  ]],
  ["art", [
    "전시회", "미술관", "갤러리", "비엔날레", "아트페어", "설치미술", "조각전",
    "개인전", "회고전", "작품전", "큐레이터", "도슨트", "국립현대미술관", "리움",
    "건축상", "건축가", "프리츠커", "공간 디자인", "산업디자인", "제품 디자인",
    "그래픽 디자인", "타이포그래피", "일러스트레이터", "아트워크", "레드닷", "IF디자인"
  ]],
  ["gaming", [
    "롤드컵", "리그오브레전드", "리그 오브 레전드", "LoL", "롤체", "옵치", "발로란트", "오버워치", "배그", "배틀그라운드",
    "메이플", "던파", "던전앤파이터", "로스트아크", "디아블로", "스타크래프트",
    "피파온라인", "넥슨", "엔씨소프트", "넷마블", "크래프톤", "스팀 세일", "스팀 신작", "닌텐도",
    "Pokémon", "Pokemon", "포켓몬", "Pokopia", "포트나이트", "에픽게임즈",
    "플스", "플레이스테이션", "엑스박스", "인디 게임", "e스포츠", "이스포츠", "패치노트",
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
    "트와이스", "비비지", "프로미스나인", "피프티피프티", "아이들", "스테이씨", "있지", "레드벨벳",
    // "배우"는 A6에서 "연극 배우 이사"를 이유로 뺐지만, 진짜 원인은 같은 제목의
    // "이사"였고 그건 이미 제거됐다. 뒤 공백을 붙이면 "배우자"·"배우고"·"배우기"를
    // 피하면서 "배우 김고은"은 잡는다(오탐 6종 실측 확인).
    "배우 "
  ]],
  // 2026-08-06: 부동산 낱말 6개(부동산·아파트값·전세·청약·재건축·분양)를 여기서 뺐다.
  // realestate가 독립 카테고리가 되면서 두 사전이 같은 단어를 갖게 됐고,
  // classify는 **동점이면 분류를 포기한다** — 그래서 "서울 아파트값 3주 연속 상승"이
  // business:2 vs realestate:2로 맞서 null이 됐다. 실측으로 잡은 회귀다.
  // 부동산 기사는 이제 realestate로 간다. 증시·환율 등은 그대로 business다.
  ["business", [
    "코스피", "코스닥", "나스닥", "다우지수", "뉴욕증시", "증시", "유가", "3대 지수",
    "환율", "원달러", "기준금리",
    "한국은행", "금통위", "물가상승률", "소비자물가", "주가", "상한가", "하한가", "공모주",
    "실적발표", "영업이익", "매출액", "적자전환", "흑자전환", "인수합병",
    "상장폐지", "배당금", "연금저축", "ISA", "ETF", "펀드", "자산운용",
    "대출금리", "예금금리", "세금 신고"
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
    "탈모", "피부과", "치과", "다이소", "쿠팡 주문", "장보기", "치약 활용법"
  ]],
  ["science", [
    "우주선", "NASA", "스페이스X", "누리호", "인공위성", "블랙홀",
    "외계행성", "제임스웹", "천체", "우주 쓰레기", "달 표면", "유전자", "백신 개발", "자폐 연관성", "임상시험",
    "노벨상", "논문 발표", "연구진", "화석", "고생물", "기후변화", "탄소중립",
    "C3S", "해양 표면 온도"
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
  ["ppomppu", { registryCategory: "business", fallback: "humor" }],
  ["ruliweb", { registryCategory: "gaming", fallback: "humor" }]
]);

// 종합게시판이 등록 카테고리를 아이템에 물려주지 못하게 하는 중립 버킷.
//
// David 2026-08-02: "보배드림에서 올라온다고 다 자동차가 아니고 클리앙이라고
// 다 IT가 아니야. 카테고리가 아예 정해진 뉴스 제외하고 종합게시판 성격은
// 무조건 다 섞여있기때문에 잘 카테고라이즈 해야해."
//
// 실측(2026-08-02, 라이브 300건)이 그대로 확인해 준다:
//   다모앙  등록값 life    71% 유지 — 그 안에 "대통령 형소법개정 시나리오",
//                                   "거부권 쓰는 순간 난리" (정치),
//                                   "ERP 개발", "블랙베리" (IT)
//   인스티즈 등록값 culture 100% 유지 — "'알몸 살해' 정재환 흉기 3개" (사건사고)
//   이토랜드 등록값 humor    65% 유지
// 반면 인벤 핫은 두 차례 표본 모두 전부 진짜 게임글이었다 — 전문 커뮤니티는
// 등록값 유지가 정답이다. 그래서 "폴백 맵에 있느냐"가 아니라 **전문이냐
// 종합이냐**로 갈라야 하고, 그건 소스의 성질이므로 레지스트리에 명시한다
// (communities.json의 mixed: true, 근거는 mixedNote에 적혀 있다).
//
// 왜 humor(유머/일상)인가: 새 카테고리를 만들면 설문·쿼터·브리핑·칩까지 전부
// 번진다. 종합게시판의 미분류 글은 실제로 잡담이 지배적이고, 기존 라벨 중
// "유머/일상"이 가장 가깝다. 무엇보다 **틀린 전문 라벨을 확신 있게 붙이는 것보다
// 낫다** — 잘못된 카테고리는 취향 벡터·쿼터·브리핑까지 검증 없이 번진다.
export const MIXED_NEUTRAL_CATEGORY = "humor";

// 학습 소스 재분류 예외는 현재 없다. 해커뉴스를 예외로 열어 뒀더니 영문 생활
// 글("I made tinnitus my friend...")이 business로 이동해 경제 개인판에 실렸다.
// 영문 카테고리 정답 코퍼스가 없는 현재 NB 확신도는 근거가 아니므로, 별도
// 영문 평가셋이 생기기 전에는 등록된 tech 분류를 보존한다.
export const RECLASSIFY_DESPITE_TRAINING = new Set();
