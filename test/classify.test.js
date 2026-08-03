// 카테고리 분류 엔진 (David 2026-07-29 "칼같은 인덱싱") — classify.js + topics.js 보강.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TitleClassifier,
  classifyTitle,
  normalizeTitle,
  features,
  TRAIN_LABELS,
  isReclassifiable
} from "../src/feed/classify.js";
import { classifyTopics } from "../src/feed/topics.js";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { JsonSource } from "../src/feed/content.js";

// ---------------------------------------------------------------------------
// 정치 사전 — 실측에서 실패했던 제목을 그대로 고정한다.
// ---------------------------------------------------------------------------

test("정치 사전: 실측 실패 사례가 이제 politics로 잡힌다", () => {
  // 2026-07-29 라이브 실측에서 전부 미분류였던 제목들
  const fails = [
    "국힘 조경태 \"윤리위는 '장동혁 아바타'‥무도한 표적 징계\"", // "국힘" 약칭 미등재가 원인
    "9인 못 채운 '장동혁 윤리위'…5인 현원에 3인 참석 '징계 논란'",
    "특검, '내란 가담' 김현태 징역 18년 구형"
  ];
  for (const t of fails) {
    assert.ok(
      classifyTopics({ title: t, url: "https://x/1", sourceId: "gnews" }).includes("politics"),
      `politics로 분류되어야: ${t}`
    );
  }
});

test("정치 사전: 비정치 제목을 오탐하지 않는다", () => {
  const clean = [
    "신형 그랜저 2주 타본 솔직 시승기 (장단점 정리)",
    "새 폰 배터리 이틀 가는 거 실화냐...충격받고 옴",
    "어제 드라마 결말 실화냐...작가님 왜 그러셨어요",
    "SK하이닉스, 영업이익률 76% 사상 최고"
  ];
  for (const t of clean) {
    assert.ok(
      !classifyTopics({ title: t, url: "https://x/1", sourceId: "clien" }).includes("politics"),
      `politics로 오탐: ${t}`
    );
  }
});

// ---------------------------------------------------------------------------
// 전처리 — 매체명 꼬리가 카테고리 신호로 새면 안 된다.
// ---------------------------------------------------------------------------

test("normalizeTitle: 구글뉴스 ' - 매체명' 꼬리와 말머리를 제거한다", () => {
  assert.equal(normalizeTitle("코스피 6000 붕괴 - 한겨레"), "코스피 6000 붕괴");
  assert.equal(normalizeTitle("[속보] 구마모토 강진 - 동아일보"), "구마모토 강진");
  // 꼬리가 없으면 그대로
  assert.equal(normalizeTitle("치킨집에 함부로 클레임 걸면"), "치킨집에 함부로 클레임 걸면");
});

test("features: 음절 바이그램 + 영숫자 통짜 토큰", () => {
  const f = features("SK하이닉스 실적");
  assert.ok(f.includes("sk"), "영숫자 단어는 통짜");
  assert.ok(f.includes("하이") && f.includes("이닉") && f.includes("닉스"), "한글은 바이그램");
  assert.ok(f.includes("실적"));
});

// ---------------------------------------------------------------------------
// 나이브 베이즈 — 학습·예측·기권.
// ---------------------------------------------------------------------------

function trainedClassifier() {
  const cl = new TitleClassifier();
  const CORPUS = {
    business: [
      "코스피 급락에 서킷브레이커 발동", "금리 인하 기대에 채권 강세",
      "SK하이닉스 영업이익 사상 최대", "환율 1400원 돌파 수출주 비상",
      "부동산 전세 시장 매물 급증", "삼성전자 배당 확대 발표",
      "증시 반등 코스닥 상승 마감", "은행 대출 금리 인상 예고"
    ],
    sports: [
      "손흥민 결승골 토트넘 승리", "야구 한국시리즈 5차전 역전승",
      "김연아 은퇴 후 첫 아이스쇼", "월드컵 예선 한국 무승부",
      "프로농구 챔피언결정전 7차전", "올림픽 금메달 양궁 대표팀",
      "축구 국가대표 명단 발표", "마라톤 세계신기록 경신"
    ],
    culture: [
      "드라마 결말 시청률 대박", "아이돌 컴백 무대 화제",
      "영화 개봉 첫날 박스오피스 1위", "배우 열애설 소속사 인정",
      "넷플릭스 신작 공개 호평", "가수 콘서트 전석 매진",
      "예능 새 시즌 출연진 확정", "뮤지컬 초연 기립박수"
    ]
  };
  for (const [cat, titles] of Object.entries(CORPUS)) {
    for (const t of titles) cl.learn(t, cat);
  }
  return cl;
}

test("NB: 학습한 어휘 방향의 새 제목을 맞게 분류한다", () => {
  const cl = trainedClassifier();
  assert.equal(cl.predict("코스피 상승 마감 증시 안도").category, "business");
  assert.equal(cl.predict("손흥민 해트트릭 축구 대표팀 환호").category, "sports");
  assert.equal(cl.predict("아이돌 신곡 뮤직비디오 공개").category, "culture");
});

test("NB: 균등 사전확률 — 라벨 수가 많은 카테고리로 쏠리지 않는다", () => {
  const cl = trainedClassifier();
  // business에만 라벨을 3배 부어도
  for (let i = 0; i < 2; i++) {
    for (const t of ["증시 급등 코스피", "금리 동결 발표", "수출 호조 무역수지"]) cl.learn(t, "business");
  }
  // 스포츠 어휘 제목은 여전히 sports여야 한다
  assert.equal(cl.predict("야구 결승전 홈런 승부").category, "sports");
});

test("NB: 모르는 어휘 투성이 제목엔 기권한다 (classifyTitle이 null)", () => {
  const cl = trainedClassifier();
  // 학습 어휘와 전혀 겹치지 않는 제목
  const out = classifyTitle(cl, "뜨개질 도안 공유합니다 목도리 겨울준비");
  assert.equal(out, null, "확신 없으면 분류하지 말아야 — 오답이 개인화를 오염시킨다");
});

test("NB: 직렬화 왕복 후에도 같은 예측을 낸다 (결정성)", () => {
  const cl = trainedClassifier();
  const back = TitleClassifier.fromJSON(JSON.parse(JSON.stringify(cl.toJSON())));
  const t = "코스피 상승 마감 증시 안도";
  assert.equal(back.predict(t).category, cl.predict(t).category);
});

// ---------------------------------------------------------------------------
// 학습/재분류 대상 구분 — 라벨 오염 방지 규칙.
// ---------------------------------------------------------------------------

test("TRAIN_LABELS: 혼합 게시판(클리앙·뽐뿌·이토랜드)은 학습 소스가 아니다", () => {
  // etoland는 2026-08-02 실측(HIT 27건에 연예·상품광고 다수)으로 학습에서 뺐다
  for (const mixed of ["clien", "ppomppu", "etoland"]) {
    assert.ok(!TRAIN_LABELS.has(mixed), `${mixed}는 온갖 주제가 섞여 라벨로 쓰면 오염된다`);
  }
  // 남은 약지도 소스는 가중치가 낮아야 한다
  for (const [src, { weight }] of TRAIN_LABELS) {
    if (src.startsWith("gnews")) assert.equal(weight, 1.0, `${src}: 구글 편집 분류는 1.0`);
    else assert.ok(weight <= 0.5, `${src}: 약지도는 0.5 이하여야 (소스 과적합 방지)`);
  }
});

test("isReclassifiable: 학습 소스와 gnews 종합 섹션은 재분류하지 않는다", () => {
  assert.ok(isReclassifiable("clien"), "혼합 게시판은 재분류 대상");
  assert.ok(isReclassifiable("ppomppu"));
  assert.ok(!isReclassifiable("gnews-biz"), "학습 소스는 라벨이 정답");
  assert.ok(!isReclassifiable("gnews"), "종합 섹션은 news가 정답");
  assert.ok(!isReclassifiable("gnews-kr"));
  assert.ok(!isReclassifiable("ruliweb"), "약지도 학습 소스는 자기 라벨 유지");
  // bobae는 2026-07-31 설계 변경으로 재분류 **대상**이다 — 베스트가 전 게시판
  // 통합(실측 15건 중 자동차 1건)이라 학습 소스에서 빼고 혼합 게시판 취급.
  assert.ok(isReclassifiable("bobae"), "보배 베스트는 혼합 게시판");
});

// ---------------------------------------------------------------------------
// 엔진 통합 — 혼합 게시판 글이 실제로 재분류되고, 원값이 보존되는가.
// ---------------------------------------------------------------------------

test("engine.refresh: 혼합 소스의 자동차 글이 tech에서 auto로 재분류된다", async () => {
  const now = Date.now();
  const at = (h) => new Date(now - h * 3600 * 1000).toISOString();

  // 학습용: gnews 섹션 흉내(주제 어휘가 뚜렷한 제목 다수)
  const mkTrain = (id, cat, titles) =>
    new JsonSource(id, async () => titles.map((t, i) => ({
      id: `${id}_${i}`, title: t, url: `https://t/${id}/${i}`, category: cat,
      publishedAt: at(i + 1), sourceRank: i
    })), "news");

  const bizTitles = Array.from({ length: 40 }, (_, i) =>
    ["코스피 급락 서킷브레이커", "금리 인하 채권 강세", "영업이익 사상 최대 실적",
     "환율 급등 수출 비상", "전세 매물 급증 부동산", "배당 확대 주주 환원"][i % 6] + ` ${i}`);
  const sportsTitles = Array.from({ length: 40 }, (_, i) =>
    ["결승골 극장 승리", "한국시리즈 역전승 야구", "월드컵 예선 무승부",
     "챔피언결정전 7차전 농구", "금메달 양궁 대표팀", "국가대표 명단 발표 축구"][i % 6] + ` ${i}`);
  // gnews-* 픽스처는 kind=news라 수집 캡 20건에 잘린다(content.js) — 학습
  // 총량을 최소 코퍼스(100) 위로 올리는 몫은 캡이 100인 bobae가 담당한다.
  const autoTitles = Array.from({ length: 80 }, (_, i) =>
    ["신차 시승기 연비 측정", "전기차 충전 인프라 확충", "중고차 시세 하락",
     "엔진오일 교체 주기", "자율주행 옵션 비교", "타이어 마모 점검"][i % 6] + ` ${i}`);

  // 혼합 게시판(clien, 등록 카테고리 tech): 자동차 글이 섞여 들어온다
  const mixed = new JsonSource("clien", async () => [
    { id: "c_auto", title: "신형 전기차 시승기 충전 연비 실측", url: "https://c/1",
      category: "tech", publishedAt: at(1), sourceRank: 0 },
    { id: "c_tech", title: "새 프레임워크 벤치마크 코드 공개", url: "https://c/2",
      category: "tech", publishedAt: at(2), sourceRank: 1 }
  ], "community");

  const store = new FeedStore();
  const engine = new FeedEngine(store, [
    mkTrain("gnews-biz", "business", bizTitles),
    mkTrain("gnews-sports", "sports", sportsTitles),
    // auto 학습은 약지도 소스(bobae) 경로로
    new JsonSource("bobae", async () => autoTitles.map((t, i) => ({
      id: `bo_${i}`, title: t, url: `https://b/${i}`, category: "auto",
      publishedAt: at(i + 1), sourceRank: i
    })), "community"),
    mixed
  ]);
  await engine.refresh();
  const items = await engine._items();
  const cAuto = items.find((i) => i.id === "c_auto");

  assert.equal(cAuto.category, "auto", "자동차 어휘 글은 auto로 재분류되어야");
  assert.equal(cAuto.registryCategory, "tech", "원래 등록 카테고리는 보존되어야");

  // 학습 소스 자신은 절대 재분류되지 않는다
  const trainItem = items.find((i) => i.source === "gnews-biz");
  assert.equal(trainItem.category, "business");
  assert.equal(trainItem.registryCategory, undefined);
});

test("engine.refresh: 코퍼스가 부족하면(100건 미만) 아무것도 재분류하지 않는다", async () => {
  const now = Date.now();
  const store = new FeedStore();
  const engine = new FeedEngine(store, [
    new JsonSource("gnews-biz", async () => [
      { id: "g1", title: "코스피 급락", url: "https://g/1", category: "business",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "news"),
    // 전문 커뮤니티(레지스트리 mixed 아님)여야 이 테스트가 성립한다 —
    // 종합게시판이면 아래 "종합게시판 중립화"가 먼저 걸려 등록값이 안 남는다.
    new JsonSource("82cook", async () => [
      // 키워드 사전에 안 걸리는 제목이어야 한다 — 키워드 확정(auto 사전)은
      // 코퍼스 크기와 무관하게 도는 것이 2026-07-31 설계의 의도다.
      { id: "c1", title: "요즘 점심 뭐 드세요 다들", url: "https://c/1", category: "life",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "community")
  ]);
  await engine.refresh();
  const c1 = (await engine._items()).find((i) => i.id === "c1");
  assert.equal(c1.category, "life", "데이터 부족 상태에서 NB가 성급히 재분류하면 안 됨");
  assert.equal(c1.registryCategory, undefined);
});

test("종합게시판은 등록 카테고리를 아이템에 물려주지 않는다 (전문 커뮤니티는 유지)", async () => {
  // David 2026-08-02: "보배드림에서 올라온다고 다 자동차가 아니고 클리앙이라고
  // 다 IT가 아니야. 종합게시판 성격은 무조건 다 섞여있다."
  // 라이브 실측(300건)에서 다모앙 정치글이 life, 인스티즈 살인사건 기사가
  // culture로 나가고 있었다. 반면 인벤은 두 표본 모두 전부 진짜 게임글이었다.
  const now = Date.now();
  const store = new FeedStore();
  const engine = new FeedEngine(store, [
    new JsonSource("clien", async () => [
      { id: "m1", title: "요즘 점심 뭐 드세요 다들", url: "https://c/1", category: "tech",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "community"),
    new JsonSource("damoang", async () => [
      // 라이브에서 실제로 life로 나가고 있던 제목 (사람이 보면 IT 잡담이다)
      { id: "m2", title: "개인적으로 본적은 없지만 이 블랙베리 정말 예뻐보였어요", url: "https://d/1", category: "life",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "community"),
    new JsonSource("inven_hot", async () => [
      { id: "s1", title: "형님들 속보속보 이번 패치 어떰", url: "https://i/1", category: "gaming",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "community")
  ]);
  await engine.refresh();
  const items = await engine._items();
  const get = (id) => items.find((i) => i.id === id);

  assert.equal(get("m1").category, "humor", "클리앙 잡담글이 tech로 나가면 안 된다");
  assert.equal(get("m1").registryCategory, "tech", "원래 등록값은 추적용으로 남긴다");
  assert.equal(get("m2").category, "humor", "다모앙 자유게시판 글이 life로 나가면 안 된다");
  // 전문 커뮤니티는 등록값이 곧 정답이다 — 여기까지 중립화하면 정확한 분류를
  // 망가뜨린다(적대적 검수 A8 처방을 실측으로 기각한 근거).
  assert.equal(get("s1").category, "gaming", "인벤은 게임 전문 — 등록값 유지");
  assert.equal(get("s1").registryCategory, undefined);
});

// ---------------------------------------------------------------------------
// 출처 이중 표기 해소 (적대적 검수 2026-07-29) — 구글뉴스 제목 꼬리의 매체명을
// 제목에서 떼어 sourceLabel로 승격한다.
// ---------------------------------------------------------------------------

test("registry: gnews 제목 꼬리 ' - 매체명'이 sourceLabel로 승격되고 제목에서 사라진다", async () => {
  const { buildSources } = await import("../src/feed/registry.js");
  const entry = {
    id: "gnews-biz", label: "구글뉴스 경제", country: "KR", lang: "ko", kind: "news",
    category: "business", enabled: true, httpsOk: true,
    adapter: { type: "rss", url: "https://x/rss" }
  };
  const [src] = buildSources([entry], {
    seed: false,
    fetcher: async () => [
      { title: "코스피 6000 붕괴…서킷브레이커 발동 - 에너지경제신문", url: "https://n/1", publishedAt: new Date().toISOString() },
      { title: "매체명 꼬리가 없는 제목", url: "https://n/2", publishedAt: new Date().toISOString() }
    ]
  });
  const items = await src.fetch();
  assert.equal(items[0].title, "코스피 6000 붕괴…서킷브레이커 발동", "제목에서 매체명 꼬리 제거");
  assert.equal(items[0].sourceLabel, "에너지경제신문", "매체명이 출처 라벨로 승격");
  assert.equal(items[1].title, "매체명 꼬리가 없는 제목", "꼬리 없으면 그대로");
  assert.equal(items[1].sourceLabel, null, "없는 매체명을 지어내지 않는다");
});

test("재분류 안전장치: 정치 태그 글과 말투 기반 카테고리(humor/gaming)로는 덮어쓰지 않는다", async () => {
  const { OVERRIDE_CATEGORIES } = await import("../src/feed/classify.js");
  // humor·gaming은 커뮤니티 말투로 학습돼 주제 판별이 아니다(라이브 실측:
  // 정치 넋두리→humor, "내란"→gaming 오분류). 덮어쓰기 허용 목록에서 제외.
  assert.ok(!OVERRIDE_CATEGORIES.has("humor"));
  assert.ok(!OVERRIDE_CATEGORIES.has("gaming"));
  assert.ok(!OVERRIDE_CATEGORIES.has("news"), "news는 잔여 클래스라 덮어쓰기 무의미");
  for (const c of ["business", "sports", "culture", "science", "tech", "auto"]) {
    assert.ok(OVERRIDE_CATEGORIES.has(c), `${c}: 주제 어휘 학습 카테고리는 허용`);
  }
});

// ---------------------------------------------------------------------------
// 뉴스 성향 슬라이더 (David 2026-07-31 "좌/중/우 같은 비율로, 슬라이드로")
// ---------------------------------------------------------------------------

test("lean: 슬라이더 0(기본)이면 어떤 소스도 가중치가 변하지 않는다", async () => {
  const { leanMultiplier } = await import("../src/feed/engine.js");
  for (const src of ["hani-rank", "donga", "yna", "clien", "gnews"]) {
    assert.equal(leanMultiplier(src, 0), 1, `${src}: 균형 상태에서는 성향이 개입하면 안 됨`);
  }
});

test("lean: 슬라이더 극단에서도 반대편이 완전히 사라지지 않는다 (하한 0.2)", async () => {
  const { leanMultiplier } = await import("../src/feed/engine.js");
  // 보수쪽 끝(+1): 한겨레(-2) -> 1 + 1*(-1) = 0 -> 하한 0.2로 클램프
  assert.equal(leanMultiplier("hani-rank", 1), 0.2, "진보 매체가 0이 되면 필터버블 + 매체 역산 노출");
  assert.equal(leanMultiplier("donga", 1), 1.8, "보수 매체는 상한 1.8");
  // 진보쪽 끝(-1): 대칭
  assert.equal(leanMultiplier("donga", -1), 0.2);
  assert.equal(leanMultiplier("hani-rank", -1), 1.8);
});

test("lean: 분류 안 함 매체(전문지·커뮤니티·구글뉴스)는 슬라이더의 영향을 받지 않는다", async () => {
  const { leanMultiplier } = await import("../src/feed/engine.js");
  for (const src of ["etnews", "ddanzi", "slownews", "newspeppermint", "clien", "gnews", "gnews-biz"]) {
    assert.equal(leanMultiplier(src, 1), 1, `${src}: lean 없는 소스는 성향축 밖`);
    assert.equal(leanMultiplier(src, -1), 1);
  }
});

test("lean: 레지스트리 성향값 무결성 — 값 범위, 근거 주석, 좌우 공급 존재", async () => {
  const { loadRegistry } = await import("../src/feed/registry.js");
  const leaned = loadRegistry().filter((c) => Number.isFinite(c.lean));
  assert.ok(leaned.length >= 4, "성향 라벨 소스가 있어야");
  for (const c of leaned) {
    assert.ok(c.lean >= -2 && c.lean <= 2, `${c.id}: lean 범위 초과`);
    assert.ok(c.leanNote && c.leanNote.length > 10, `${c.id}: 성향 라벨엔 근거 주석 필수`);
    assert.equal(c.kind, "news", `${c.id}: 성향 라벨은 뉴스 매체에만`);
  }
  const enabled = leaned.filter((c) => c.enabled);
  assert.ok(enabled.some((c) => c.lean < 0), "진보측 공급 없음 — '같은 비율' 불가");
  assert.ok(enabled.some((c) => c.lean > 0), "보수측 공급 없음 — '같은 비율' 불가");
});

test("store: setLeanBalance는 [-1,1]로 클램프하고 세션 응답에 실린다", async () => {
  const store = new FeedStore();
  const u = store.createUser();
  assert.equal(store.setLeanBalance(u.id, 0.5), 0.5);
  assert.equal(store.setLeanBalance(u.id, 7), 1, "상한 클램프");
  assert.equal(store.setLeanBalance(u.id, -7), -1, "하한 클램프");
  assert.equal(store.setLeanBalance(u.id, "junk"), 0, "쓰레기 값은 0");
});

// ---------------------------------------------------------------------------
// 애드핏 2차 보류 대응 (2026-08-01): 성적 자극 콘텐츠 + 아웃링크 위주
// ---------------------------------------------------------------------------

test("성인 사전: 실측된 은꼴성 제목은 숨기고, 일상어·웨딩화보는 오탐하지 않는다", () => {
  const hide = [
    "권수진(nothing_betttter) 비키니",
    "수련수련 오프솔더 세라복 가슴골",
    "몸매 자랑하는 그녀 인증샷",
    "검은 비키니의 여자"
  ];
  const pass = [
    "주식으로 털리고 푸념글 올라오는거 정말 꼴뵈기 싫으네", // "꼴" 단독 오탐 금지
    "김나희, 남주혁 닮은 예비 남편과 웨딩 화보",
    "신형 그랜저 시승기",
    // 2026-08-02 검수 A1로 계약이 바뀐 자리. 예전엔 "몸매" 단독을 사전에 넣어
    // "한국 여자들 몸매가 부럽다는 외국인" 같은 경계선 글까지 잡았지만, 같은
    // 규칙이 아래 정상 글도 19금 게이트(기본 숨김) 뒤에 가뒀다. 게이트는 숨기는
    // 방향이라 오탐 비용이 미탐 비용보다 크다 — 경계선 한 건을 놓치는 쪽을 택하고
    // 은어·복합어("몸매 자랑", "몸매 노출")로 좁혔다.
    "몸매 관리 앱 추천 좀",
    "겨울 니트 착샷 후기"
  ];
  for (const t of hide) assert.ok(classifyTopics({ title: t }).includes("adult"), `숨겨야: ${t}`);
  for (const t of pass) assert.ok(!classifyTopics({ title: t }).includes("adult"), `오탐: ${t}`);
});

test("카드 기본 동작: 내부 상세 우선, 원문은 ↗ 지름길 (아웃링크 위주 판정 해소)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const html = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html"), "utf8");
  const handler = html.slice(html.indexOf("// Card body tap"), html.indexOf('card.addEventListener("keydown"'));
  assert.ok(!/if\(item\.via !== "me" && item\.url\)\{ openOriginal\(item\); return; \}\n    openDetail/.test(handler),
    "카드 본문 탭이 곧장 아웃링크면 안 됨");
  assert.match(handler, /newtab-hint.*openOriginal/s, "↗ 지름길로는 원문 새탭 유지 (헤비유저 이동권)");
  assert.match(handler, /openDetail\(item\.id\);\n  \}\);/, "기본 동작은 내부 상세");
  // 상세 안 원문 버튼은 계속 존재해야 한다
  assert.match(html, /원문에서 계속 읽기/);
});

// ---- 키워드 확정 분류 + 보배 혼합 베스트 (David 2026-07-31 실측 지적) ----
import { keywordCategory, MIXED_BEST_FALLBACK } from "../src/feed/classify.js";
import { FeedStore as _EdStore } from "../src/feed/store.js";
import { FeedEngine as _EdEngine } from "../src/feed/engine.js";
import { JsonSource as _EdJson } from "../src/feed/content.js";

test("keywordCategory: 자동차 사전 — 시승·모델·전기차는 auto, 금융 문맥은 가드", () => {
  assert.equal(keywordCategory("생애 첫 전기차 출고 신고합니다!"), "auto");
  assert.equal(keywordCategory("BYD 씨라이언7 타보니 이게 되네"), "auto");
  assert.equal(keywordCategory("그랜저 페이스리프트 시승 후기"), "auto");
  assert.equal(keywordCategory("현대차 주가 사상 최고치 경신"), null, "브랜드+주가 = 경제 기사");
  assert.equal(keywordCategory("테슬라 실적 발표에 시장 술렁"), null);
  assert.equal(keywordCategory("서운하다며 가족 단톡방을 나간 올케"), null, "일상글은 무반응");
});

test("보배 베스트: 자동차 키워드 글만 auto, 나머지는 혼합 폴백(humor) — 실측 재현", async () => {
  // 실측(2026-07-31): 보배 베스트 15건 중 자동차 1건 — 그 구성을 재현한다
  const bobae = new _EdJson("bobae", async () => [
    { id: "car1", title: "생애 첫 전기차 출고 신고합니다!", url: "https://b.example.com/1",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), score: 100, category: "auto" },
    { id: "talk1", title: "서운하다며 가족 단톡방을 나간 올케", url: "https://b.example.com/2",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), score: 300, category: "auto" },
    { id: "talk2", title: "홍명보 청문회를 본 일본인들 반응", url: "https://b.example.com/3",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), score: 200, category: "auto" }
  ], "community");
  const store = new _EdStore();
  const engine = new _EdEngine(store, [bobae]);
  await engine.refresh();
  const items = await engine._items();
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.equal(byId.get("car1").category, "auto", "진짜 자동차 글은 auto 유지");
  assert.notEqual(byId.get("talk1").category, "auto", "일상글이 auto로 남으면 안 됨");
  assert.notEqual(byId.get("talk2").category, "auto", "청문회 반응글이 auto로 남으면 안 됨");
  assert.equal(byId.get("talk1").registryCategory, "auto", "원 분류는 보존(디버깅용)");
});

test("경제 뉴스의 시승기: 키워드 확정이 소스 불문 auto로 옮긴다", async () => {
  const mk = new _EdJson("mk-news", async () => [
    { id: "drive1", title: "BYD 씨라이언7 시승해보니…가격이 깡패", url: "https://mk.example.com/1",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), score: 0, category: "business" },
    { id: "biz1", title: "코스피 사상 최고치 경신", url: "https://mk.example.com/2",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), score: 0, category: "business" }
  ], "news");
  const store = new _EdStore();
  const engine = new _EdEngine(store, [mk]);
  await engine.refresh();
  const items = await engine._items();
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.equal(byId.get("drive1").category, "auto", "시승기는 경제지에 실려도 auto");
  assert.equal(byId.get("biz1").category, "business", "일반 경제 기사는 그대로");
});

// ---- 분류 정책 (David 2026-08-02) ----------------------------------------

test("keywordCategory: 커뮤니티 제목을 사람이 유추하는 대로 분류한다", () => {
  const cases = [
    ["손흥민 결승골...팀 5연승", "sports"],
    ["메이플 신규 직업 성능 실화냐", "gaming"],
    ["코스피 3000 회복...외국인 순매수", "business"],
    ["뉴진스 컴백 티저 공개", "culture"],
    ["챗GPT 신모델 발표", "tech"],
    ["우리집 강아지 산책 후기", "life"],
    ["제임스웹 외계행성 수증기 포착", "science"],
    ["그랜저 시승 후기", "auto"]
  ];
  for (const [title, cat] of cases) assert.equal(keywordCategory(title), cat, title);
  // 어느 사전에도 없는 잡담은 미분류 — "모름"이 오답보다 낫다
  assert.equal(keywordCategory("회사 단톡방에서 오타 하나로 벌어진 대참사"), null);
});

test("섹션이 정해진 뉴스 소스는 등록 카테고리를 그대로 쓴다 (재분류 금지)", async () => {
  const { FeedStore } = await import("../src/feed/store.js");
  const { FeedEngine } = await import("../src/feed/engine.js");
  const { JsonSource } = await import("../src/feed/content.js");
  // chosunbiz는 레지스트리상 business. 제목에 게임 어휘가 있어도 유지돼야 한다.
  const src = new JsonSource("chosunbiz", async () => [
    { id: "n1", title: "넥슨 신작 흥행에 주가 급등", url: "https://biz.example.com/1",
      publishedAt: new Date(Date.now() - 3600e3).toISOString(), category: "business" }
  ], "news");
  const store = new FeedStore();
  const engine = new FeedEngine(store, [src]);
  await engine.refresh();
  const item = (await engine._items()).find((i) => i.id === "n1");
  assert.equal(item.category, "business", "섹션 뉴스는 제목 분류로 흔들리지 않는다");
});

// ---------------------------------------------------------------------------
// 대기업 출신 5인 적대적 검수 (2026-08-02) — 확정 결함을 실패 테스트로 먼저
// 박고 고친다. 이 프로젝트는 "고친 뒤 테스트 추가"를 반복해 신규 실패 유형을
// 못 잡는 상태에 도달했다(검수 A11). 순서를 뒤집는 것 자체가 처방이다.
// ---------------------------------------------------------------------------

test("A1: 정상 글이 19금·정치 게이트 뒤로 부당 은폐되면 안 된다", () => {
  // 무경계 includes가 만든 오탐 — 게이트가 기본 숨김이라 '조용한 검열'이 된다
  const notAdult = [
    "입욕제 추천 좀 해주세요", "오늘 산 니트 착샷", "성인용 킥보드 추천",
    "글래머러스한 인테리어 조명", "요즘 몸매 관리 어떻게들 하세요"
  ];
  for (const t of notAdult) {
    const topics = classifyTopics({ title: t, url: "https://x/1", sourceId: "clien" });
    assert.ok(!topics.includes("adult"), `19금 오탐: ${t}`);
  }
  const notPolitics = ["급여당일지급 알바 구합니다", "심야당직 근무 후기"];
  for (const t of notPolitics) {
    const topics = classifyTopics({ title: t, url: "https://x/1", sourceId: "clien" });
    assert.ok(!topics.includes("politics"), `정치 오탐: ${t}`);
  }
  // 진짜 성인/정치는 계속 잡혀야 한다 (완화가 게이트를 무력화하면 안 됨)
  assert.ok(classifyTopics({ title: "ㅇㅎ) 비키니 화보", url: "https://x/2", sourceId: "etoland" }).includes("adult"));
  assert.ok(classifyTopics({ title: "국회 법사위 특검법 처리", url: "https://x/3", sourceId: "gnews" }).includes("politics"));
});

test("A9: 국제 정치가 정치 토글을 우회하면 안 된다", () => {
  for (const t of ["트럼프 관세 압박 재개", "시진핑 방한 조율", "푸틴 회담 제안", "김정은 담화 발표"]) {
    assert.ok(classifyTopics({ title: t, url: "https://x/1", sourceId: "gnews" }).includes("politics"), t);
  }
});

test("A2/A6: 일반어 지뢰어가 카테고리를 훔치면 안 된다", () => {
  const cases = [
    ["가전 출고 지연 사태", "auto"], ["나사 풀린 의자 고치기", "science"],
    ["스팀다리미 추천", "gaming"], ["우리 배우자가 한 말", "culture"],
    ["사외이사 선임 공시", "life"]
  ];
  for (const [title, wrong] of cases) {
    assert.notEqual(keywordCategory(title), wrong, `지뢰어 오탐: ${title} -> ${wrong}`);
  }
});

test("A3: 회사명 + 금융 문맥이면 확신에 찬 오답 대신 기권한다", () => {
  // 가드가 없으면 gaming/tech/culture로 확정되어 취향벡터·브리핑까지 오염된다
  for (const t of ["넥슨 주가 급등", "엔씨소프트 영업이익 발표", "크래프톤 상장 첫날", "넷마블 노조 파업"]) {
    assert.notEqual(keywordCategory(t), "gaming", `금융 문맥인데 gaming 확정: ${t}`);
  }
  assert.notEqual(keywordCategory("엔비디아 실적 서프라이즈"), "tech");
});

test("A4: 히트 수 동점이면 확정하지 않고 기권한다", () => {
  // 게임 1 + 스포츠 1 — 선언 순서로 gaming을 고르던 편향
  const t = "넥슨, 프로야구 구단 스폰서 계약";
  assert.equal(keywordCategory(t), null, "동점은 기권해야 — 선언순 임의 승자 금지");
});

test("A5: 소문자 영문 브랜드도 잡는다", () => {
  assert.equal(keywordCategory("bmw 신형 공개"), "auto");
  assert.equal(keywordCategory("chatgpt 신모델 발표"), "tech");
  assert.equal(keywordCategory("github 대규모 장애"), "tech");
});

// ---------------------------------------------------------------------------
// 2026-08-02 라이브 실측 (이토랜드 HIT 27건 + 인벤 14건, nowhot.kr /api/feed)
// ---------------------------------------------------------------------------

test("은꼴 태그 [약후]는 19금 게이트 뒤로 — 애드핏 '성적 자극' 보류 사유 직결", () => {
  const hide = [
    "[IVE] 장원영 무대위 퇴장신[약후]",
    "속바지를 팬티급으로 입는 대만 치어리더 보타구니.mp4",
    "약후방 주의 짤 모음"
  ];
  // "약후" 단독을 넣으면 아래가 전부 은폐된다 — 표기형("[약후]"·"약후방")만 쓴다
  const pass = ["치약 후기 남깁니다", "계약 후 취소 가능한가요", "약후불제 거래 후기"];
  for (const t of hide) assert.ok(classifyTopics({ title: t }).includes("adult"), `숨겨야: ${t}`);
  for (const t of pass) assert.ok(!classifyTopics({ title: t }).includes("adult"), `오탐: ${t}`);
});

test("혼합 게시판의 연예 글은 culture로 — 등록값 humor를 물려받지 않는다", () => {
  // 실측: 이토랜드 HIT에서 아래 글이 전부 humor로 배달됐다
  for (const [title, want] of [
    ["배우 김고은", "culture"],
    ["눈 올리는 비비지 신비 ㄷㄷ.gif", "culture"],
    ["쪼그려 앉아서 물 마시는 트와이스 사나", "culture"]
  ]) assert.equal(keywordCategory(title), want, title);
  // "배우 "의 뒤 공백이 지키는 경계 — 없으면 아래가 전부 culture로 샌다
  for (const t of ["내 배우자와 여행 계획", "요리 배우고 싶은데 학원 추천", "영어 배우기 좋은 앱"])
    assert.equal(keywordCategory(t), null, `오탐: ${t}`);
});

test("전문 커뮤니티(인벤)의 등록 카테고리는 유지 — 혼합 폴백을 씌우면 안 된다", async () => {
  const { isReclassifiable } = await import("../src/feed/classify.js");
  // 검수단 A8 처방("미등재 소스에도 혼합 폴백")을 실측으로 기각한 자리.
  // 인벤 HIT 14건은 전부 진짜 게임 글이었다 — 폴백을 씌웠다면 정확한 분류
  // 14건을 humor로 망가뜨렸을 것이다. 반면 이토랜드는 전 게시판 통합이라
  // 학습 라벨에서 빼고 재분류 대상으로 돌렸다.
  assert.equal(isReclassifiable("inven_hot"), false, "인벤은 게임 전문 — 등록값 유지");
  assert.equal(isReclassifiable("etoland"), true, "이토랜드는 전 게시판 통합 — 재분류 허용");
  // 인벤 실측 제목: 키워드 사전이 못 잡아도 등록값 gaming이 정답이다
  for (const t of ["2탱 아무리해도 별로임", "검은사원 시던보상이 쏠쏠하네"])
    assert.equal(keywordCategory(t), null, `사전이 억지로 분류하면 안 됨: ${t}`);
});
