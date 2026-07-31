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
  for (const mixed of ["clien", "ppomppu"]) {
    assert.ok(!TRAIN_LABELS.has(mixed), `${mixed}는 온갖 주제가 섞여 라벨로 쓰면 오염된다`);
  }
  // etoland는 humor 약지도로 등재되어 있으나 가중치가 낮아야 한다
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
    new JsonSource("clien", async () => [
      // 키워드 사전에 안 걸리는 제목이어야 한다 — 키워드 확정(auto 사전)은
      // 코퍼스 크기와 무관하게 도는 것이 2026-07-31 설계의 의도다.
      { id: "c1", title: "요즘 점심 뭐 드세요 다들", url: "https://c/1", category: "tech",
        publishedAt: new Date(now - 3600e3).toISOString(), sourceRank: 0 }
    ], "community")
  ]);
  await engine.refresh();
  const c1 = (await engine._items()).find((i) => i.id === "c1");
  assert.equal(c1.category, "tech", "데이터 부족 상태에서 NB가 성급히 재분류하면 안 됨");
  assert.equal(c1.registryCategory, undefined);
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
    "한국 여자들 몸매가 부럽다는 외국인...누나...",
    "검은 비키니의 여자"
  ];
  const pass = [
    "주식으로 털리고 푸념글 올라오는거 정말 꼴뵈기 싫으네", // "꼴" 단독 오탐 금지
    "김나희, 남주혁 닮은 예비 남편과 웨딩 화보",
    "신형 그랜저 시승기"
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
