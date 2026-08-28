// P1-B 사건 계층 — 고정 평가 표본(블루프린트 v4, 2026-08-13 동결) 검수.
//
// 표본 1~5는 9인 검수에서 실측된 대표 결함 사례의 재현 픽스처다. 병합돼야
// 할 것이 병합되는지와 함께, **오병합 유도 픽스처가 하나라도 병합되면
// 실패**한다 — 오병합은 미병합보다 나쁜 실패로 계수한다(v4 성공지표).
import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_LINEAGE_PRUNE_RULES,
  buildEventClusters,
  carryEventLineages,
  composeEventFromMembers,
  decideEventMerge,
  eventLineageRecord,
  eventMaterialChange,
  lineageMatchCandidates,
  pruneEventLineages,
  sharedEventTokens
} from "../src/feed/event-cluster.js";
import { operationalSourceIdentity } from "../src/feed/editorial-source-identity.js";

const article = (over) => ({
  id: over.id,
  title: over.title,
  url: over.url || `https://example.com/${over.id}`,
  publishedAt: over.publishedAt || "2026-08-13T10:00:00+09:00",
  kind: over.kind || "news",
  category: over.category || "news",
  source: over.source || "gnews-news",
  sourceLabel: over.sourceLabel || over.source || "매체",
  ...over
});

const eventOf = (events, articleId) => events.find((event) =>
  event.memberArticleIds.includes(articleId) || event.reactionArticleIds.includes(articleId));

// ---------------------------------------------------------------------------
// 표본 1 — DeepSeek 한/영 이중 게재 (tech 영문 HN + business 한국어 연합뉴스TV)
// ---------------------------------------------------------------------------

const s1hn = article({
  id: "s1-hn", title: "DeepSeek V4 Pro 0813",
  url: "https://news.ycombinator.com/item?id=41000001",
  publishedAt: "2026-08-13T01:10:00+09:00",
  kind: "community", category: "tech", source: "hackernews", sourceLabel: "해커뉴스"
});
const s1yna = article({
  id: "s1-yna", title: "딥시크 V4 프로 정식 출시",
  url: "https://www.yonhapnewstv.co.kr/news/MYH20260813001",
  publishedAt: "2026-08-13T09:30:00+09:00",
  kind: "news", category: "business", source: "gnews-business", sourceLabel: "연합뉴스TV"
});

test("표본 1: 한/영 동일 사건은 영문 표기 고유명사 축으로 한 사건에 결합된다", () => {
  const events = buildEventClusters([s1hn, s1yna]);
  const ev = eventOf(events, "s1-hn");
  assert.ok(ev, "HN 기사가 사건에 속해야 한다");
  assert.equal(ev, eventOf(events, "s1-yna"), "두 기사가 같은 사건이어야 한다");
  // 커뮤니티(HN)와 언론 보도는 별도 축 — HN은 반응 근거로 연결된다(정정 3).
  assert.deepEqual(ev.memberArticleIds, ["s1-yna"]);
  assert.deepEqual(ev.reactionArticleIds, ["s1-hn"]);
  assert.equal(ev.counts.independentReportingGroups, 1);
  assert.equal(ev.counts.communityReactions, 1);
  // 결합 근거는 영문 표기 축(딥시크→deepseek 별칭 + v4)이다.
  assert.ok(sharedEventTokens(s1hn.title, s1yna.title).length >= 2);
});

// ---------------------------------------------------------------------------
// 표본 2 — 8·13 부동산대책 파편 3건 → 한 사건, 근거 전부 보존
// ---------------------------------------------------------------------------

const s2 = [
  article({ id: "s2-hani", title: "8·13 부동산대책 발표…대출 규제 대폭 강화",
    publishedAt: "2026-08-13T10:00:00+09:00", category: "realestate",
    source: "hani-rank", sourceLabel: "한겨레" }),
  article({ id: "s2-chosun", title: "정부 8·13 대책, 다주택자 대출 정조준",
    publishedAt: "2026-08-13T10:20:00+09:00", category: "business",
    source: "chosunbiz", sourceLabel: "조선비즈" }),
  article({ id: "s2-mk", title: "8·13 부동산대책에 시장 술렁…대출 문턱 높아진다",
    publishedAt: "2026-08-13T11:00:00+09:00", category: "realestate",
    source: "mk-realestate", sourceLabel: "매일경제" })
];

test("표본 2: 부동산대책 파편은 한 사건으로 병합되고 타 매체 근거가 하나도 사라지지 않는다", () => {
  const events = buildEventClusters(s2);
  assert.equal(events.length, 1, "파편 3건이 한 사건이어야 한다");
  const ev = events[0];
  assert.deepEqual([...ev.memberArticleIds].sort(), ["s2-chosun", "s2-hani", "s2-mk"]);
  assert.equal(ev.sourceEvidence.length, 3, "근거 보존율: 병합 시 근거 소실 0");
  const labels = new Set(ev.sourceEvidence.map((row) => row.sourceLabel));
  assert.deepEqual([...labels].sort(), ["매일경제", "조선비즈", "한겨레"]);
  assert.equal(ev.counts.independentReportingGroups, 3, "서로 다른 운영그룹 3곳");
  // 병합 이력은 append-only로 남는다.
  assert.ok(ev.mergeHistory.filter((h) => h.action === "merge").length >= 2);
  assert.ok(ev.aliases.length >= 2, "병합된 제목 정규화 키가 별칭으로 남아야 한다");
});

// ---------------------------------------------------------------------------
// 표본 3 — 대통령 동일 발언, 경향신문·조선비즈 2회 게재
// ---------------------------------------------------------------------------

const s3 = [
  article({ id: "s3-khan", title: "이 대통령 \"부동산 투기 반드시 차단\"…추가 대책 시사",
    publishedAt: "2026-08-13T14:00:00+09:00", category: "politics",
    source: "khan", sourceLabel: "경향신문" }),
  article({ id: "s3-chosun", title: "이 대통령 \"부동산 투기 반드시 차단\" 발언…시장 파장",
    publishedAt: "2026-08-13T14:40:00+09:00", category: "business",
    source: "chosunbiz", sourceLabel: "조선비즈" })
];

test("표본 3: 동일 발언 사건은 매체·지면이 달라도 한 사건으로 결합된다", () => {
  const events = buildEventClusters(s3);
  assert.equal(events.length, 1);
  assert.equal(events[0].counts.independentReportingGroups, 2);
});

// ---------------------------------------------------------------------------
// 표본 4 — 니케×페르소나 콜라보, tech/gaming 별건 게재
// ---------------------------------------------------------------------------

const s4 = [
  article({ id: "s4-gaming", title: "니케×페르소나 콜라보 확정…아틀라스 캐릭터 참전",
    publishedAt: "2026-08-13T12:00:00+09:00", category: "gaming",
    source: "gnews-gaming", sourceLabel: "게임메카" }),
  article({ id: "s4-tech", title: "승리의 여신 니케, 페르소나 콜라보 일정 공개",
    publishedAt: "2026-08-13T12:30:00+09:00", category: "tech",
    source: "gnews-tech", sourceLabel: "전자신문" })
];

test("표본 4: 카테고리(tech/gaming)가 달라도 같은 사건은 병합된다", () => {
  const events = buildEventClusters(s4);
  assert.equal(events.length, 1);
});

// ---------------------------------------------------------------------------
// 표본 5 — geeknews→해커뉴스 중계·재유통: 같은 사건, 독립 계수 1
// ---------------------------------------------------------------------------

const s5 = [
  article({ id: "s5-hn", title: "Show HN: An SQLite extension for vector search",
    url: "https://example-blog.dev/sqlite-vec",
    publishedAt: "2026-08-13T07:00:00+09:00",
    kind: "community", category: "tech", source: "hackernews", sourceLabel: "해커뉴스" }),
  article({ id: "s5-gk", title: "SQLite 벡터 검색 확장 공개",
    url: "https://example-blog.dev/sqlite-vec?utm_source=geeknews",
    publishedAt: "2026-08-13T09:00:00+09:00",
    kind: "community", category: "tech", source: "geeknews", sourceLabel: "긱뉴스" })
];

test("표본 5: 중계·재유통은 canonicalUrl 강한 결합으로 같은 사건이 되고 독립 계수는 1이다", () => {
  const events = buildEventClusters(s5);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.counts.communityGroups, 1,
    "geeknews는 hackernews 운영그룹의 중계 — 복수 출처 확인으로 계수하면 안 된다");
  assert.equal(ev.counts.independentReportingGroups, 0, "언론 보도 축은 0(합산 금지)");
  assert.equal(ev.mergeHistory.find((h) => h.action === "merge").reason, "canonical_url_exact");
});

// ---------------------------------------------------------------------------
// 오병합 유도 픽스처 — 하나라도 병합되면 실패 (오병합 0이 절대 조건)
// ---------------------------------------------------------------------------

test("오병합 가드 1: 같은 회사의 다른 사건은 병합하지 않는다 (고유명사 1개 겹침)", () => {
  const a = article({ id: "m1-a", title: "삼성전자, 3분기 폴더블 신제품 라인업 공개",
    publishedAt: "2026-08-13T09:00:00+09:00", source: "gnews-tech", sourceLabel: "전자신문" });
  const b = article({ id: "m1-b", title: "삼성전자 반도체 공장 증설 착수",
    publishedAt: "2026-08-13T10:00:00+09:00", source: "gnews-business", sourceLabel: "매일경제" });
  assert.equal(buildEventClusters([a, b]).length, 2);
  assert.equal(decideEventMerge(a, b).merge, false);
});

test("오병합 가드 2: 같은 숫자만 겹치는 다른 주제는 병합하지 않는다", () => {
  const a = article({ id: "m2-a", title: "코스피 3000 돌파 마감",
    publishedAt: "2026-08-13T15:40:00+09:00", source: "gnews-business", sourceLabel: "한국경제" });
  const b = article({ id: "m2-b", title: "서울 신규 아파트 3000 가구 공급 계획",
    publishedAt: "2026-08-13T16:00:00+09:00", category: "realestate",
    source: "gnews-realestate", sourceLabel: "매일경제" });
  assert.equal(buildEventClusters([a, b]).length, 2);
  assert.equal(decideEventMerge(a, b).merge, false);
});

test("오병합 가드 3: 커뮤니티 유머글은 내용어가 겹쳐도 뉴스와 병합하지 않는다", () => {
  const humor = article({ id: "m3-humor", title: "부동산 대출 광고 레전드 짤 모음",
    publishedAt: "2026-08-13T10:30:00+09:00",
    kind: "community", category: "humor", source: "theqoo", sourceLabel: "더쿠" });
  const events = buildEventClusters([...s2, humor]);
  const humorEvent = eventOf(events, "m3-humor");
  const newsEvent = eventOf(events, "s2-hani");
  assert.notEqual(humorEvent, newsEvent, "유머글은 뉴스 사건에 붙으면 안 된다");
  assert.equal(humorEvent.counts.articles, 1);
  assert.equal(decideEventMerge(s2[0], humor).reason, "guard_category_pack_humor_vs_news");
});

test("오병합 가드 4: 고유명사 1개 겹침은 병합하지 않는다", () => {
  const a = article({ id: "m4-a", title: "테슬라 주가 장중 급등",
    publishedAt: "2026-08-13T08:00:00+09:00", source: "gnews-business", sourceLabel: "한국경제" });
  const b = article({ id: "m4-b", title: "테슬라 로보택시 실물 첫 인도",
    publishedAt: "2026-08-13T08:30:00+09:00", category: "auto",
    source: "gnews-auto", sourceLabel: "오토헤럴드" });
  assert.equal(buildEventClusters([a, b]).length, 2);
  assert.equal(decideEventMerge(a, b).reason, "guard_entity_overlap_min");
});

test("같은 매체가 한 원영상을 여러 각도로 연속 보도해도 한 사건으로 묶는다", () => {
  const rows = [
    article({
      id: "anna-news",
      title: "'박주호♥' 안나, 암 투병 후 넷째 임신 \"의사 확인 받고 신중히 결정\"",
      source: "gnews-sports",
      sourceLabel: "굿모닝경제",
      category: "sports",
      ownershipGroup: "publisher:굿모닝경제",
      publishedAt: "2026-08-28T01:04:56.000Z"
    }),
    article({
      id: "anna-birth",
      title: "안나, '넷째 임신' 3남매 중 나은이가 먼저 알았다…한국 출산 계획",
      source: "tenasia",
      sourceLabel: "텐아시아",
      category: "culture",
      ownershipGroup: "tenasia",
      publishedAt: "2026-08-28T04:10:01.000Z"
    }),
    article({
      id: "anna-health",
      title: "'박주호♥' 안나 유방암 완전관해 상태 3년…넷째 임신은 의사와 상의",
      source: "tenasia",
      sourceLabel: "텐아시아",
      category: "culture",
      ownershipGroup: "tenasia",
      publishedAt: "2026-08-28T04:11:02.000Z"
    }),
    article({
      id: "anna-wig",
      title: "박주호 아내 안나, 아이들에게 암 투병 말 못 했다…가발 쓰기도",
      source: "tenasia",
      sourceLabel: "텐아시아",
      category: "culture",
      ownershipGroup: "tenasia",
      publishedAt: "2026-08-28T04:06:01.000Z"
    })
  ];

  const events = buildEventClusters(rows);
  assert.equal(events.length, 1);
  assert.deepEqual(new Set(events[0].memberArticleIds), new Set(rows.map((row) => row.id)));
});

test("같은 매체의 가까운 보도라도 공통 주제가 하나뿐이면 합치지 않는다", () => {
  const rows = [
    article({ id: "same-publisher-a", title: "삼성전자 폴더블 신제품 공개",
      source: "paper", ownershipGroup: "paper", publishedAt: "2026-08-28T04:00:00.000Z" }),
    article({ id: "same-publisher-b", title: "삼성전자 반도체 공장 증설",
      source: "paper", ownershipGroup: "paper", publishedAt: "2026-08-28T04:05:00.000Z" })
  ];
  assert.equal(buildEventClusters(rows).length, 2);
});

test("같은 매체의 가까운 보도라도 일반어만 같으면 서로 다른 사건으로 둔다", () => {
  const rows = [
    article({ id: "same-publisher-generic-a", title: "기술 독립 변화 1-0",
      source: "paper", ownershipGroup: "paper", publishedAt: "2026-08-28T04:00:00.000Z" }),
    article({ id: "same-publisher-generic-b", title: "기술 독립 변화 1-1",
      source: "paper", ownershipGroup: "paper", publishedAt: "2026-08-28T04:05:00.000Z" })
  ];
  assert.equal(buildEventClusters(rows).length, 2);
});

test("오병합 가드 7: 일반 명사 2개만 겹치는 서로 다른 사건은 병합하지 않는다 (한/한 임계 3)", () => {
  // 이 픽스처가 임계 2에서 병합돼 한/한 임계를 3으로 올렸다(임계 조정 근거).
  const a = article({ id: "m7-a", title: "유럽중앙은행 성장률 전망 수정",
    publishedAt: "2026-08-13T09:00:00+09:00", source: "gnews-business", sourceLabel: "한국경제" });
  const b = article({ id: "m7-b", title: "기후모델 해수면 상승 전망 수정",
    publishedAt: "2026-08-13T10:00:00+09:00", category: "science",
    source: "gnews-science", sourceLabel: "동아사이언스" });
  assert.equal(decideEventMerge(a, b).merge, false);
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("오병합 가드: 기간 상투어와 개발만 겹치는 서로 다른 회사 사건은 병합하지 않는다", () => {
  const a = article({ id: "jeep-cn", title: "지프, 4년 만에 중국 생산 재개 '둥펑 기술로 EV·PHEV 개발' 해외 수출",
    publishedAt: "2026-08-27T09:00:00+09:00", source: "auto", sourceLabel: "자동차 매체" });
  const b = article({ id: "blue-profit", title: "블루산업개발, 원지·골판지 수익성 개선…4년 만에 상반기 흑자",
    publishedAt: "2026-08-27T10:00:00+09:00", source: "business", sourceLabel: "경제 매체" });
  assert.equal(decideEventMerge(a, b).merge, false);
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("오병합 가드 5: 핵심 숫자 충돌(같은 주제 다른 수치)은 병합을 보류한다", () => {
  const a = article({ id: "m5-a", title: "구로 물류센터 화재, 부상 120명",
    publishedAt: "2026-08-13T09:00:00+09:00", source: "gnews-news", sourceLabel: "연합뉴스" });
  const b = article({ id: "m5-b", title: "구로 물류센터 화재 부상 350명 집계",
    publishedAt: "2026-08-13T11:00:00+09:00", source: "gnews-news", sourceLabel: "KBS뉴스" });
  assert.equal(decideEventMerge(a, b).reason, "guard_number_conflict");
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("오병합 가드 6: 발행 24시간 창 밖이면 내용어 결합을 하지 않는다", () => {
  const a = article({ id: "m6-a", title: "이 대통령 \"부동산 투기 반드시 차단\" 추가 대책 시사",
    publishedAt: "2026-08-10T09:00:00+09:00", source: "khan", sourceLabel: "경향신문" });
  const b = article({ ...s3[1], id: "m6-b" });
  assert.equal(decideEventMerge(a, b).reason, "guard_publish_window_24h");
});

// ---------------------------------------------------------------------------
// 안정성 — 같은 입력이면 같은 사건 ID, 판 간 재등장에도 ID 유지
// ---------------------------------------------------------------------------

test("안정성: 같은 입력 2회는 같은 eventId·같은 factsFingerprint를 낸다", () => {
  const input = [...s2, ...s4, s1hn, s1yna];
  const first = buildEventClusters(input);
  const second = buildEventClusters([...input].reverse());
  assert.deepEqual(
    first.map((e) => e.eventId).sort(),
    second.map((e) => e.eventId).sort());
  const byId = new Map(second.map((e) => [e.eventId, e]));
  for (const ev of first) {
    assert.equal(ev.factsFingerprint, byId.get(ev.eventId).factsFingerprint);
    assert.equal(eventMaterialChange(ev, byId.get(ev.eventId)), false,
      "같은 입력이면 실질 변화가 없어야 한다(재등장 금지 정합)");
  }
});

test("안정성: 판 간(아침→런치) 재등장 시 eventId가 유지되고, 새 사실이 붙으면 실질 변화로 감지된다", () => {
  // 아침판: 파편 2건. 런치판: 같은 사건에 파편 1건 추가.
  const morning = buildEventClusters(s2.slice(0, 2));
  const lunch = buildEventClusters(s2);
  assert.equal(morning.length, 1);
  assert.equal(lunch.length, 1);
  assert.equal(morning[0].eventId, lunch[0].eventId,
    "가장 이른 발행 기사가 같으면 판이 바뀌어도 사건 ID가 같아야 한다");
  assert.equal(eventMaterialChange(morning[0], lunch[0]), true,
    "새 파편의 고유명사가 더해지면 실질 변화로 감지돼야 한다");
});

test("안정성: composeEventFromMembers는 digest 투영에서 같은 ID·근거 보존을 보장한다", () => {
  const ev = composeEventFromMembers(s2);
  const direct = buildEventClusters(s2)[0];
  assert.equal(ev.eventId, direct.eventId);
  assert.equal(ev.sourceEvidence.length, 3);
});

test("오병합 가드: 1~2자리 숫자만 겹치는 무관한 한/영 제목은 병합되지 않는다 (검수 P2 회귀)", () => {
  // dedupe.js는 3자리 이상만 num: 태그 — 2자리 숫자 2개 겹침이 가드를
  // 우회해 merge:true가 되던 구멍의 고정.
  const a = { title: "아이폰 17 프로 30만원 인하", url: "https://a.example.com/1",
    source: "mk-news", publishedAt: new Date().toISOString() };
  const b = { title: "Galaxy 17 launch: 30 day trial", url: "https://b.example.com/2",
    source: "hackernews", publishedAt: new Date().toISOString() };
  const d = decideEventMerge(a, b);
  assert.equal(d.merge, false, `무관한 제목이 병합됨: ${d.reason}`);
  // 사유는 겹침 최소 가드나 숫자 전용 가드 어느 쪽이든 미병합이면 계약 충족
  assert.ok(["guard_numbers_only_overlap", "guard_entity_overlap_min"].includes(d.reason), d.reason);
});

test("오병합 가드: 2자리 수치 충돌(부상 17명 vs 부상 90명)도 감지된다 (검수 P2 회귀)", () => {
  const a = { title: "공장 화재 부상 17명 삼성전자 기흥", url: "https://a.example.com/3",
    source: "mk-news", publishedAt: new Date().toISOString() };
  const b = { title: "공장 화재 부상 90명 삼성전자 기흥", url: "https://b.example.com/4",
    source: "hankyung", publishedAt: new Date().toISOString() };
  const d = decideEventMerge(a, b);
  assert.equal(d.merge, false, `수치 충돌인데 병합됨: ${d.reason}`);
});

test("실기사 회귀: 번역된 일본어 보도와 영문 보도는 Anthropic 판결 한 사건으로 묶인다", () => {
  const rows = [
    article({
      id: "anthropic-livedoor",
      title: "연방지법, 국방부에 의한 앤솔로픽의 리스크 지정을 위헌으로 판단",
      originalTitle: "連邦地裁、国防総省によるアンソロピックのリスク指定を違憲と判断",
      source: "livedoor-jp",
      publishedAt: "2026-08-28T03:43:16.000Z"
    }),
    article({
      id: "anthropic-verge",
      title: "Anthropic은 트럼프 행정부, 법원 판결에 의해 불법적으로 블랙리스트에 올랐습니다.",
      originalTitle: "Anthropic was illegally blacklisted by the Trump administration, court rules",
      source: "the-verge",
      publishedAt: "2026-08-28T03:14:06.000Z"
    }),
    article({
      id: "anthropic-bbc",
      title: "트럼프 행정부는 Anthropic에 불법적으로 보복했다고 판사가 판결했습니다.",
      originalTitle: "Trump administration illegally retaliated against Anthropic, judge rules",
      source: "bbc-business",
      publishedAt: "2026-08-28T03:41:59.000Z"
    }),
    article({
      id: "anthropic-techmeme",
      title: "A US judge blocks the Pentagon from blacklisting Anthropic, ruling that its designation as a supply-chain risk was illegal and baseless",
      kind: "community",
      source: "techmeme",
      publishedAt: "2026-08-28T02:10:02.000Z"
    }),
    article({
      id: "anthropic-hn",
      title: "Judge Rules Trump Administration’s Blacklisting of Anthropic Was Illegal",
      kind: "community",
      source: "hackernews",
      publishedAt: "2026-08-28T02:03:38.000Z"
    })
  ];
  const events = buildEventClusters(rows);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].reactionArticleIds.sort(), ["anthropic-hn", "anthropic-techmeme"]);
});

test("실기사 회귀: Nepal-Tibet 홍수의 본류 보도는 묶고 후속 각도·네팔 대사 기사는 별개다", () => {
  const rows = [
    article({
      id: "nepal-guardian",
      title: "Nepal-Tibet 돌발 홍수로 최소 356명 사망 후 거의 1,400명 실종",
      originalTitle: "Nearly 1,400 missing, mostly tourists, after Nepal-Tibet flash flood kills at least 356",
      url: "https://www.theguardian.com/world/2026/aug/27/what-caused-nepal-flash-flood-glacial-collapse-tibet-border",
      source: "guardian-world",
      publishedAt: "2026-08-27T12:41:41.000Z"
    }),
    article({
      id: "nepal-nyt",
      title: "실시간 업데이트: 추가 홍수 위험에 처한 실종자와 좌초된 구조대원 수색",
      originalTitle: "Live Updates: Rescuers Search for Missing and Stranded Under Threat of More Floods",
      url: "https://www.nytimes.com/live/2026/08/27/world/nepal-tibet-flash-floods",
      source: "nyt-world",
      publishedAt: "2026-08-28T04:39:19.000Z"
    }),
    article({
      id: "nepal-etnews",
      title: "폭 600m 빙하 조각이 2km 높이서 떨어져 비 없는 네팔 대홍수 참사",
      url: "https://www.etnews.com/20260828000068",
      source: "etnews",
      publishedAt: "2026-08-28T01:04:33.000Z"
    }),
    article({
      id: "nepal-bbc-cause",
      title: "과학자들은 붕괴된 빙하가 파괴적인 Nepal-Tibet 홍수를 일으켰을 가능성이 있다고 말합니다.",
      originalTitle: "Collapsed glacier likely caused devastating Nepal-Tibet floods, scientists say",
      source: "bbc-world",
      publishedAt: "2026-08-28T03:23:56.000Z"
    }),
    article({
      id: "nepal-livescience",
      title: "전문가들은 네팔의 홍수는 빙하 붕괴로 촉발됐으며 앞으로 더 많은 산사태가 발생할 위험이 있다고 말한다.",
      originalTitle: "Devastating Nepal floods were triggered by glacier collapse, experts say — and there's a risk of more landslides to come",
      source: "livescience",
      publishedAt: "2026-08-27T16:21:42.000Z"
    }),
    article({
      id: "nepal-family",
      title: "네팔 홍수에서 실종된 호주인의 친척들이 사랑하는 사람의 소식을 기다리고 있습니다",
      originalTitle: "Relatives of Australians missing in Nepal floods wait for news of loved ones",
      source: "guardian-world",
      publishedAt: "2026-08-28T03:56:10.000Z"
    }),
    article({
      id: "nepal-bbc-path",
      title: "치명적인 Nepal-Tibet 홍수의 경로 추적",
      originalTitle: "Tracing the deadly path of the Nepal-Tibet flash flood",
      source: "bbc-world",
      publishedAt: "2026-08-27T16:13:39.000Z"
    }),
    article({
      id: "nepal-khan-casualties",
      title: "469명으로 늘어난 네팔 홍수 사망자, 기반 시설 파괴에 접근 어려워",
      source: "khan",
      publishedAt: "2026-08-28T03:34:00.000Z"
    }),
    article({
      id: "nepal-ai-slop",
      title: "Please stop flooding our projects with AI slop to furnish your CV",
      kind: "community",
      source: "hackernews",
      publishedAt: "2026-08-28T03:49:33.000Z"
    }),
    article({
      id: "nepal-live-birdflu",
      title: "Australia news live: Antarctic staff withdraw due to bird flu risk; dolphin dies from H5",
      url: "https://www.theguardian.com/australia-news/live/2026/aug/28/nepal-floods-australians-missing-penny-wong",
      source: "guardian-world",
      publishedAt: "2026-08-28T04:18:29.000Z"
    }),
    article({
      id: "nepal-ambassador",
      title: "공석인 네팔 대사에 박재경 짐바브웨 대사 임명",
      source: "donga",
      publishedAt: "2026-08-28T03:00:00.000Z"
    })
  ];
  const events = buildEventClusters(rows);
  assert.equal(events.length, 6);
  assert.equal(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-nyt"));
  assert.equal(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-etnews"));
  assert.equal(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-bbc-cause"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-livescience"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-family"));
  assert.equal(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-bbc-path"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-khan-casualties"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-ai-slop"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-live-birdflu"));
  assert.notEqual(eventOf(events, "nepal-guardian"), eventOf(events, "nepal-ambassador"));
});

// ---------------------------------------------------------------------------
// C4 — 같은 운영그룹 분야별 피드의 독립 계수 1회 계약 (2026-08-13 David 지시)
// "같은 운영그룹의 분야별 피드는 수집 가능하되 독립 출처 계수에서는 한 번만 센다."
// 근거 실코드: event-cluster.js groupsOf()가 operationalSourceIdentity().ownershipGroup
// 의 고유 집합으로 independentReportingGroups를 계산한다.
// ---------------------------------------------------------------------------

const c4bbcBiz = article({ id: "c4-bbc-biz",
  title: "Tottenham sponsorship deal: Arsenal rivalry boosts revenue 4-1 windfall",
  publishedAt: "2026-08-13T10:00:00+09:00", category: "business",
  source: "bbc-business", sourceLabel: "BBC Business", ownershipGroup: "bbc" });
const c4bbcSport = article({ id: "c4-bbc-sport",
  title: "Tottenham beat Arsenal 4-1 in sponsorship derby",
  publishedAt: "2026-08-13T10:30:00+09:00", category: "sports",
  source: "bbc-sport", sourceLabel: "BBC Sport", ownershipGroup: "bbc" });
const c4ynaSport = article({ id: "c4-yna-sport",
  title: "토트넘 Tottenham, Arsenal 아스널에 4-1 승리",
  publishedAt: "2026-08-13T11:00:00+09:00", category: "sports",
  source: "yna-sports", sourceLabel: "연합뉴스 스포츠", ownershipGroup: "yonhap" });

test("C4: 같은 사건의 bbc-business+bbc-sport 기사는 독립 언론 계수 1로 센다", () => {
  const events = buildEventClusters([c4bbcBiz, c4bbcSport]);
  assert.equal(events.length, 1, "같은 사건이어야 한다");
  assert.equal(events[0].counts.independentReportingGroups, 1,
    "같은 운영그룹(bbc)의 분야별 피드 2건은 독립 계수 1이어야 한다");
});

test("C4 대조: 다른 운영그룹(bbc+yonhap) 2곳이면 독립 계수 2다", () => {
  const events = buildEventClusters([c4bbcSport, c4ynaSport]);
  assert.equal(events.length, 1, "같은 사건이어야 한다");
  assert.equal(events[0].counts.independentReportingGroups, 2);
});

test("C4: 등재 레지스트리 기준으로도 bbc-sport·yna-sports가 운영그룹에 귀속된다", () => {
  // ownershipGroup 명시 없이 소스 id·라벨만으로 communities.json 파생 별칭이 해석돼야 한다.
  assert.equal(operationalSourceIdentity({ source: "bbc-sport", sourceLabel: "BBC Sport" }).ownershipGroup, "bbc");
  assert.equal(operationalSourceIdentity({ source: "yna-sports", sourceLabel: "연합뉴스 스포츠" }).ownershipGroup, "yonhap");
});

// ---------------------------------------------------------------------------
// R1 — 영구 사건 계보(lineage): eventId가 변천해도 판 간 같은 사건으로 잇는다
// (블루프린트 "2026-08-14 P3-A 판정" 결함 4 · 반례 b·c의 계보 단위 고정)
// ---------------------------------------------------------------------------

// 판 N: 늦은 파편 2건. 판 N+1: 더 이른 기사가 지연 합류해 앵커가 바뀐다.
const lnLateA = article({ id: "ln-a", title: "새빛제철 고로 재가동 발표",
  publishedAt: "2026-08-13T10:00:00+09:00", category: "business",
  source: "news-a", sourceLabel: "매체A" });
const lnLateB = article({ id: "ln-b", title: "새빛제철 고로 재가동 발표",
  publishedAt: "2026-08-13T10:05:00+09:00", category: "business",
  source: "news-b", sourceLabel: "매체B", url: "https://b.example.com/ln-b" });
// 이른 기사 — 제목 정규화 키가 달라 앵커 교체 시 eventId가 바뀐다.
// 사건 토큰(새빛제철·고로·재가동)은 부분집합이라 factsFingerprint는 안 변한다
// ("발표"는 일반어라 토큰에서 걷힌다).
const lnEarly = article({ id: "ln-early", title: "새빛제철 고로 재가동",
  publishedAt: "2026-08-13T08:00:00+09:00", category: "business",
  source: "news-c", sourceLabel: "매체C", url: "https://c.example.com/ln-early" });

test("계보: eventId 유지 재등장은 event_id 근거로 승계되고 aliasChain이 늘지 않는다", () => {
  const [morning] = buildEventClusters([lnLateA, lnLateB]);
  const records = [eventLineageRecord(morning)];
  const [lunch] = buildEventClusters([lnLateA, lnLateB]);
  const { assignments } = carryEventLineages(records, [lunch]);
  const assigned = assignments.get(lunch.eventId);
  assert.equal(assigned.inherited, true);
  assert.equal(assigned.basis, "lineage_event_id");
  assert.equal(assigned.lineageId, records[0].lineageId);
  assert.equal(assigned.record.aliasChain.length, 1, "ID 변천이 없으면 별칭 체인 불변");
});

test("계보: 이른 기사 지연 합류로 eventId가 바뀌어도 구성원 겹침으로 같은 계보를 승계한다 (반례 b 구조부)", () => {
  const [eventN] = buildEventClusters([lnLateA, lnLateB]);
  const records = [eventLineageRecord(eventN)];
  const [eventN1] = buildEventClusters([lnEarly, lnLateA, lnLateB]);
  assert.notEqual(eventN1.eventId, eventN.eventId,
    "이른 기사가 앵커가 되면 eventId가 바뀌어야 이 반례가 성립한다");
  assert.equal(eventN1.factsFingerprint, eventN.factsFingerprint,
    "이른 기사 토큰이 부분집합이면 사실 지문은 그대로다");
  const { assignments, records: next } = carryEventLineages(records, [eventN1]);
  const assigned = assignments.get(eventN1.eventId);
  assert.equal(assigned.inherited, true, "eventId가 바뀌어도 같은 사건으로 이어져야 한다");
  assert.equal(assigned.basis, "lineage_member_overlap");
  assert.equal(assigned.lineageId, records[0].lineageId, "lineageId는 영구 불변");
  assert.equal(assigned.previousFingerprint, eventN.factsFingerprint,
    "재등장 게이트 재료: 이전 판 지문이 계보로 전달된다");
  // eventId 변천은 aliasOf 체인으로 append-only 기록된다.
  const record = next.find((row) => row.lineageId === records[0].lineageId);
  assert.deepEqual(record.aliasChain.map((row) => row.eventId),
    [eventN.eventId, eventN1.eventId]);
  assert.equal(record.aliasChain[1].aliasOf, eventN.eventId);
  assert.ok(record.eventIds.includes(eventN.eventId) && record.eventIds.includes(eventN1.eventId));
  // 이전 레코드는 변형되지 않는다(append-only — 새 레코드로 확장).
  assert.deepEqual(records[0].eventIds, [eventN.eventId]);
});

test("계보 오승계 방지 1: 무관한 사건은 구성이 그럴듯해도 계보를 가로채지 못한다 (반례 c)", () => {
  const [eventN] = buildEventClusters([lnLateA, lnLateB]);
  const records = [eventLineageRecord(eventN)];
  // 다른 사건 — 같은 업종·비슷한 어형이지만 구성원·제목 키·지문 전부 다르다.
  const other = buildEventClusters([
    article({ id: "ln-x1", title: "한아름제철 전기로 신설 발표",
      publishedAt: "2026-08-13T11:00:00+09:00", category: "business",
      source: "news-x1", sourceLabel: "매체X" }),
    article({ id: "ln-x2", title: "한아름제철 전기로 신설 발표",
      publishedAt: "2026-08-13T11:10:00+09:00", category: "business",
      source: "news-x2", sourceLabel: "매체Y", url: "https://y.example.com/ln-x2" })
  ]);
  assert.equal(other.length, 1);
  assert.equal(lineageMatchCandidates(records, other[0]).length, 0,
    "겹치는 근거가 없으면 승계 후보 자체가 없어야 한다");
  const { assignments, records: next } = carryEventLineages(records, other);
  const assigned = assignments.get(other[0].eventId);
  assert.equal(assigned.inherited, false, "미승계 — 새 계보를 연다");
  assert.notEqual(assigned.lineageId, records[0].lineageId);
  // 원 계보는 사라지지 않고 다음 판으로 이월된다(한 판 쉬어도 영구).
  assert.ok(next.some((row) => row.lineageId === records[0].lineageId));
});

test("계보 오승계 방지 2: 최상 근거가 동률인 계보 2개면 승계를 포기한다 (오병합>미병합 원칙의 계보 적용)", () => {
  const [eventN1] = buildEventClusters([lnEarly, lnLateA, lnLateB]);
  // 인위 동률: 서로 다른 계보 2개가 같은 구성원 기사 ID를 주장하는 손상 상태.
  const rival = (lineageId) => ({
    lineageId, currentEventId: `EV-${lineageId}`, eventIds: [`EV-${lineageId}`],
    aliasChain: [{ eventId: `EV-${lineageId}`, aliasOf: null, basis: "lineage_origin" }],
    memberArticleIds: ["ln-a"], titleKeys: [], factsFingerprint: "EVF-x", fingerprints: ["EVF-x"]
  });
  const { assignments } = carryEventLineages([rival("LN-r1"), rival("LN-r2")], [eventN1]);
  const assigned = assignments.get(eventN1.eventId);
  assert.equal(assigned.inherited, false, "동률이면 오승계 대신 미승계");
  assert.equal(assigned.basis, "lineage_ambiguous_declined");
});

// ---------------------------------------------------------------------------
// S2-2 — 계보 프루닝(옵션 B, David 승인 2026-08-17): 서빙 이력 계보 영구 보존,
// 미서빙 계보는 마지막 관측에서 72h 경과 시 제거. 위생 전용 — 재등장 의미론
// 무변경(게이트 판정 불관여).
// ---------------------------------------------------------------------------

const HOUR = 3600000;
const T0 = Date.parse("2026-08-14T07:00:00+09:00");
const unservedRecordAt = (observedAt) => ({
  ...eventLineageRecord(buildEventClusters([lnLateA, lnLateB])[0]),
  lastObservedAt: observedAt
});

test("프루닝 계약값: 미서빙 TTL 72h, 서빙 계보 영구 보존", () => {
  assert.equal(EVENT_LINEAGE_PRUNE_RULES.unservedTtlHours, 72);
  assert.equal(EVENT_LINEAGE_PRUNE_RULES.policy,
    "옵션 B — 서빙 이력 계보 영구 보존, 미서빙 계보 72h 만료");
});

test("프루닝 경계: 미서빙 계보는 72h 직전 보존, 72h 정각·직후 제거", () => {
  const record = unservedRecordAt(T0);
  assert.equal(record.lastServedFactsFingerprint, null, "미서빙 픽스처여야 한다");
  assert.equal(pruneEventLineages([record], { nowMs: T0 + 72 * HOUR - 1 }).length, 1,
    "72h 직전(경과 71:59:59.999)은 보존");
  assert.equal(pruneEventLineages([record], { nowMs: T0 + 72 * HOUR }).length, 0,
    "72h 정각 경과는 제거");
  assert.equal(pruneEventLineages([record], { nowMs: T0 + 72 * HOUR + 1 }).length, 0,
    "72h 직후는 제거");
});

test("프루닝: 서빙 이력 계보는 아무리 오래돼도 보존된다(재등장 게이트 재료)", () => {
  const served = { ...unservedRecordAt(T0), lastServedFactsFingerprint: "EVF-served" };
  const out = pruneEventLineages([served], { nowMs: T0 + 1000 * 24 * HOUR });
  assert.equal(out.length, 1, "1000일이 지나도 서빙 계보는 만료 없음");
  assert.equal(out[0].lastServedFactsFingerprint, "EVF-served");
});

test("프루닝: 관측 시각 없는 구 형식 레코드는 만료를 증명할 수 없어 보존한다", () => {
  const legacy = eventLineageRecord(buildEventClusters([lnLateA, lnLateB])[0]);
  assert.equal(legacy.lastObservedAt, undefined, "구 형식 픽스처여야 한다");
  assert.equal(pruneEventLineages([legacy], { nowMs: T0 + 1000 * 24 * HOUR }).length, 1);
});

test("프루닝: nowMs 없이 부르면 던진다(시계 직접 접근 금지 — 순수·결정적)", () => {
  assert.throws(() => pruneEventLineages([], {}), /nowMs 필요/);
});

test("관측 시각: 이번 판에 관측(승계·신규)된 레코드에 nowMs가 찍힌다", () => {
  const [eventN] = buildEventClusters([lnLateA, lnLateB]);
  const records = [eventLineageRecord(eventN)];
  const [eventN1] = buildEventClusters([lnEarly, lnLateA, lnLateB]);
  const { records: next } = carryEventLineages(records, [eventN1], { nowMs: T0 });
  const extended = next.find((row) => row.lineageId === records[0].lineageId);
  assert.equal(extended.lastObservedAt, T0, "승계 확장 레코드에 관측 시각 갱신");
  const fresh = carryEventLineages([], [eventN], { nowMs: T0 }).records[0];
  assert.equal(fresh.lastObservedAt, T0, "신규 계보에도 관측 시각");
  // 이전 레코드는 변형되지 않는다(append-only).
  assert.equal(records[0].lastObservedAt, undefined);
});

test("관측 시각: 이월(미관측)은 갱신하지 않는다 — 갱신하면 72h 시계가 판마다 리셋된다", () => {
  const record = unservedRecordAt(T0);
  const [unrelated] = buildEventClusters([
    article({ id: "pr-x1", title: "한아름제철 전기로 신설 발표",
      publishedAt: "2026-08-14T10:00:00+09:00", category: "business",
      source: "news-x1", sourceLabel: "매체X" })
  ]);
  const { records: next } = carryEventLineages([record], [unrelated], { nowMs: T0 + 12 * HOUR });
  const carried = next.find((row) => row.lineageId === record.lineageId);
  assert.equal(carried.lastObservedAt, T0, "이월은 관측이 아니다 — 시각 유지");
});

test("관측 시각: 시각 없는 구 형식 이월 레코드는 처음 만나는 판 시각으로 초기화된다(마이그레이션)", () => {
  const legacy = eventLineageRecord(buildEventClusters([lnLateA, lnLateB])[0]);
  const [unrelated] = buildEventClusters([
    article({ id: "pr-x2", title: "한아름제철 전기로 신설 발표",
      publishedAt: "2026-08-14T10:00:00+09:00", category: "business",
      source: "news-x2", sourceLabel: "매체Y" })
  ]);
  const { records: next } = carryEventLineages([legacy], [unrelated], { nowMs: T0 });
  const carried = next.find((row) => row.lineageId === legacy.lineageId);
  assert.equal(carried.lastObservedAt, T0, "이 시점부터 72h 시계가 돈다");
  assert.equal(legacy.lastObservedAt, undefined, "원본 레코드 무변형(append-only)");
});

test("관측 시각: nowMs를 안 주면 필드를 만들지 않는다(구 호출 하위 호환)", () => {
  const [eventN] = buildEventClusters([lnLateA, lnLateB]);
  const { records } = carryEventLineages([], [eventN]);
  assert.equal(records[0].lastObservedAt, undefined);
});

// ---------------------------------------------------------------------------
// G1 (2026-08-14 동결) — 영문 일반어 오병합 6건: 신선·저장 풀 전수 실측의
// 실물 제목 재현 픽스처. 한글 일반어만 걷고 영문 일반어(announces·new·can·
// says·hear·million·year 등)를 안 걷어서 동일문자 임계 3이 무관 기사를
// 병합했다. 수리는 EVENT_GENERIC_TOKENS 영문 구획(사전 한 곳) — 아래 6건은
// 전부 "미병합"으로 동결한다.
// ---------------------------------------------------------------------------

test("G1-1: 무관한 앨범 발표 기사들은 announces/new/album/hear로 병합되지 않는다 (실측 EV-83c3f0dcdddf6157)", () => {
  const rows = [
    ["g1a-oston", "OSTON Announces Debut Album Isn’t That Sweet?: Hear Four Songs"],
    ["g1a-claud", "Claud Announces New Album Me And The Music: Hear “She Doesn’t Love Me”"],
    ["g1a-egerton", "Descendents’ Stephen Egerton Announces Debut Solo Album I Think You’re Overthinking This: Hear “Stripped Screw”"],
    ["g1a-pollard", "Robert Pollard’s Band Rip Van Winkle Changes Name To The U.S. Rip Van Winkle, Announces New Self-Titled Album"],
    ["g1a-dummy", "Dummy Announce New Album do you love the color of the sky?: Hear “Full Spectrum Dominance”"],
    ["g1a-godflesh", "Godflesh Announce New Album Decay: Hear “Living/Ending”"]
  ].map(([id, title], i) => article({ id, title, category: "culture",
    publishedAt: `2026-08-13T0${i}:00:00+09:00`, source: "stereogum", sourceLabel: "Stereogum" }));
  assert.equal(buildEventClusters(rows).length, 6, "서로 다른 앨범 발표 6건은 6개 사건이어야 한다");
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    assert.equal(decideEventMerge(rows[i], rows[j]).merge, false, `${rows[i].id}·${rows[j].id} 미병합`);
  }
});

test("G1-2: 무관한 과학 기사들은 scientists/brain/can으로 병합되지 않는다 (실측 EV-606ccd6127cef311)", () => {
  const rows = [
    ["g1b-mit", "MIT neuroscientists discover the brain can reason without words"],
    ["g1b-dogs", "Dogs can tell fear from sadness — and scientists saw it in their brains"],
    ["g1b-adult", "The adult brain can repair itself better than scientists thought"]
  ].map(([id, title], i) => article({ id, title, category: "science",
    publishedAt: `2026-08-13T0${i}:00:00+09:00`, source: "sciencedaily", sourceLabel: "ScienceDaily" }));
  assert.equal(buildEventClusters(rows).length, 3);
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    assert.equal(decideEventMerge(rows[i], rows[j]).merge, false, `${rows[i].id}·${rows[j].id} 미병합`);
  }
});

test("G1-3: 무관한 AI 기사들은 fire/ai/says로 병합되지 않는다 (실측 EV-9fcaf3253767a5a0)", () => {
  const twitch = article({ id: "g1c-twitch", category: "gaming", source: "pcgamer", sourceLabel: "PC Gamer",
    publishedAt: "2026-08-13T01:00:00+09:00",
    title: "Twitch under fire for new gen AI training system that harvests streamer data for Amazon, says it's opt-out" });
  const saber = article({ id: "g1c-saber", category: "gaming", source: "pcgamer", sourceLabel: "PC Gamer",
    publishedAt: "2026-08-13T02:00:00+09:00",
    title: "Saber CEO scorns writer who says she was fired in favor of AI with confusing, combative statement" });
  assert.equal(decideEventMerge(twitch, saber).merge, false);
  assert.equal(buildEventClusters([twitch, saber]).length, 2);
  // 대조(정당 병합 유지): 같은 트위치 사건의 타 매체 보도는 계속 병합된다.
  const bbc = article({ id: "g1c-bbc", category: "business", source: "bbc-business", sourceLabel: "BBC",
    publishedAt: "2026-08-13T03:00:00+09:00",
    title: "Twitch users outraged as Amazon uses their content to train AI in opt-out feature" });
  assert.equal(decideEventMerge(twitch, bbc).merge, true, "트위치 실사건 병합은 유지돼야 한다");
});

test("G1-4: 무관한 구인 공고는 hiring/new/york로 병합되지 않는다 (실측 EV-8626d45bf101265f)", () => {
  const a = article({ id: "g1d-walker", category: "fashion", source: "fashionista", sourceLabel: "Fashionista",
    publishedAt: "2026-08-13T01:00:00+09:00",
    title: "WALKER DRAWAS Is Hiring A Press Account Director — Beauty, Wellness & Lifestyle In New York, NY" });
  const b = article({ id: "g1d-lulla", category: "fashion", source: "fashionista", sourceLabel: "Fashionista",
    publishedAt: "2026-08-13T02:00:00+09:00",
    title: "Lulla Collection & Bindya Accessories Is Hiring An Assistant Sales & Logistics Coordinator In New York, NY" });
  assert.equal(decideEventMerge(a, b).merge, false);
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("G1-5: 무관한 화석 기사들은 million/year/fossil로 병합되지 않는다 (실측 EV-a26325700b4c7ab5)", () => {
  const a = article({ id: "g1e-grass", category: "science", source: "physorg", sourceLabel: "Phys.org",
    publishedAt: "2026-08-13T01:00:00+09:00",
    title: "African grasslands expanded 5 million year earlier than previously thought, molecular fossils suggest" });
  const b = article({ id: "g1e-mammal", category: "science", source: "physorg", sourceLabel: "Phys.org",
    publishedAt: "2026-08-13T02:00:00+09:00",
    title: "A 236-million-year-old fossil challenges the story of mammalian live birth" });
  assert.equal(decideEventMerge(a, b).merge, false);
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("G1-6: 브랜드 접미어 jo/malone/london만 겹치는 무관 기사는 병합되지 않는다 (실측 EV-148276d6fe6422c7)", () => {
  const a = article({ id: "g1f-fortnite", category: "fashion", source: "hypebae", sourceLabel: "Hypebae",
    publishedAt: "2026-08-13T01:00:00+09:00",
    title: "Jo Malone London Steps Into the Fortnite Universe" });
  const b = article({ id: "g1f-combo", category: "fashion", source: "hypebae", sourceLabel: "Hypebae",
    publishedAt: "2026-08-13T02:00:00+09:00",
    title: "India Amarteifio on the Jo Malone London Combo She Can't Stop Wearing This Summer" });
  assert.equal(decideEventMerge(a, b).merge, false);
  assert.equal(buildEventClusters([a, b]).length, 2);
});

test("같은 발행사의 같은 시각·같은 이미지는 언어판 제목이 달라도 한 사건이다", () => {
  const image = "https://biz.chosun.com/resizer/v2/same-science-image.jpg";
  const ko = article({ id: "same-edition-ko", category: "science", source: "chosunbiz",
    title: "국내 연구진, 차세대 양자 센서 개발", image,
    publishedAt: "2026-08-28T01:30:00.000Z", url: "https://biz.chosun.com/science/a" });
  const ja = article({ id: "same-edition-ja", category: "science", source: "chosunbiz",
    title: "韓国研究チーム、次世代量子センサーを開発", image,
    publishedAt: "2026-08-28T01:30:00.000Z", url: "https://biz.chosun.com/jp/science/a" });

  const events = buildEventClusters([ko, ja]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].memberArticleIds.sort(), ["same-edition-ja", "same-edition-ko"]);
});

test("PGA와 LPGA의 서로 다른 경기는 공통 단어가 많아도 병합하지 않는다", () => {
  const bbc = article({ id: "golf-bbc", category: "sports", source: "bbc-sport",
    title: "플릿우드가 경쟁 중인 가운데 Lee가 투어 챔피언십 선두",
    publishedAt: "2026-08-28T07:56:37+09:00" });
  const pga = article({ id: "golf-pga", category: "sports", source: "gnews-sports",
    title: "김주형, PGA 투어 챔피언십 첫날 공동 15위…이민우 단독 선두",
    publishedAt: "2026-08-28T08:58:10+09:00" });
  const lpga = article({ id: "golf-lpga", category: "sports", source: "mt",
    title: "단독 선두 김세영, LPGA 투어 FM 챔피언십 첫날 최고의 출발",
    publishedAt: "2026-08-28T13:28:48+09:00" });

  const events = buildEventClusters([bbc, pga, lpga]);
  assert.equal(eventOf(events, "golf-bbc"), eventOf(events, "golf-pga"));
  assert.notEqual(eventOf(events, "golf-pga"), eventOf(events, "golf-lpga"));
});

test("Anthropic 법원 사건의 한글 음차와 영문 표기는 한 사건으로 결합된다", () => {
  const korean = article({ id: "anthropic-ko", category: "politics", source: "livedoor-world",
    title: "연방지법, 앤솔로픽 블랙리스트는 위헌이라고 판결",
    publishedAt: "2026-08-28T11:30:00+09:00" });
  const english = article({ id: "anthropic-en", category: "tech", source: "marketwatch-top",
    title: "Judge says Trump administration blacklist of Anthropic was illegal",
    publishedAt: "2026-08-28T12:16:00+09:00" });

  assert.equal(buildEventClusters([korean, english]).length, 1);
});

test("번역된 외국 기사는 화면 제목이 달라도 보존된 원제목으로 사건을 결합한다", () => {
  const verge = article({ id: "translated-verge", category: "tech", source: "the-verge",
    title: "Anthropic은 Trump 행정부, 법원 규칙에 의해 불법적으로 블랙리스트에 올랐습니다.",
    originalTitle: "Anthropic was illegally blacklisted by the Trump administration, court rules",
    publishedAt: "2026-08-28T03:14:06Z" });
  const bbc = article({ id: "translated-bbc", category: "business", source: "bbc-business",
    title: "트럼프 행정부는 Anthropic에 대해 불법적으로 보복했습니다. 판사 판결",
    originalTitle: "Trump administration illegally retaliated against Anthropic, judge rules",
    publishedAt: "2026-08-28T03:41:59Z" });

  const events = buildEventClusters([verge, bbc]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].memberArticleIds.sort(), ["translated-bbc", "translated-verge"]);
});

test("영문 원제목의 일반어 세 개만 겹치는 무관 기사는 병합하지 않는다", () => {
  const pairs = [
    [
      "Rooms Showroom Is Seeking A Fall 2026 PR Intern In New York, NY",
      "Hyperallergic Fall 2026 New York Art Guide"
    ],
    [
      "CrowdStrike Stock Jumps After Record Breaking Earnings Wall Street Cheers",
      "Marvell Stock Falls As Wall Street Questions The Story"
    ],
    [
      "A Korean Designer Just Built The Lucky Charm Generator",
      "Moscow Apartment With Korean Hanok Design Just Landed"
    ],
    [
      "Arkane Game That Valve Shut Down Is Finally Playable",
      "GTA 6 Game Breakdown Shows It All Slowing Down"
    ]
  ];
  for (const [index, [left, right]] of pairs.entries()) {
    const a = article({ id: `generic-left-${index}`, title: "번역 제목 A", originalTitle: left,
      category: index === 3 ? "gaming" : "art", publishedAt: "2026-08-28T01:00:00Z" });
    const b = article({ id: `generic-right-${index}`, title: "번역 제목 B", originalTitle: right,
      category: index === 3 ? "gaming" : "art", publishedAt: "2026-08-28T02:00:00Z" });
    assert.equal(decideEventMerge(a, b).merge, false, `${left} / ${right}`);
    assert.equal(buildEventClusters([a, b]).length, 2);
  }
});

test("네팔 홍수의 한글·영문 보도는 한 사건으로 결합된다", () => {
  const korean = article({ id: "nepal-ko", category: "news",
    title: "네팔 홍수로 실종자 수색 이어져", publishedAt: "2026-08-28T01:00:00Z" });
  const english = article({ id: "nepal-en", category: "news",
    title: "Nepal floods leave rescuers searching for missing people", publishedAt: "2026-08-28T02:00:00Z" });

  assert.equal(buildEventClusters([korean, english]).length, 1);
});

test("법률 일반어만 겹치는 서로 다른 한글·영문 사건은 결합하지 않는다", () => {
  const korean = article({ id: "court-ko", category: "politics",
    title: "지방법원 판사, 불법 체류 위헌 논란",
    publishedAt: "2026-08-28T01:00:00Z" });
  const english = article({ id: "court-en", category: "news",
    title: "Judge rules campus protest was illegal",
    publishedAt: "2026-08-28T02:00:00Z" });

  assert.equal(buildEventClusters([korean, english]).length, 2);
});

test("같은 커뮤니티의 재사용 이미지·동일 시각 글은 서로 다른 사건으로 남는다", () => {
  const dinner = article({ id: "community-dinner", kind: "community", source: "theqoo",
    category: "life", title: "오늘 저녁 뭐먹지", image: "https://img.example/board.png",
    publishedAt: "2026-08-28T01:00:00Z" });
  const puppy = article({ id: "community-puppy", kind: "community", source: "theqoo",
    category: "life", title: "강아지 자랑합니다", image: "https://img.example/board.png",
    publishedAt: "2026-08-28T01:00:00Z" });

  assert.equal(buildEventClusters([dinner, puppy]).length, 2);
});

test("같은 발행일만 겹치는 날짜형 연재물은 서로 다른 사건으로 남는다", () => {
  const letter = article({ id: "slow-letter", source: "slownews", category: "news",
    title: "느린 편지: 2026년 8월 28일.", originalTitle: "Slow Letter: August 28, 2026.",
    publishedAt: "2026-08-28T00:30:00Z" });
  const apod = article({ id: "nasa-apod", source: "nasa", category: "science",
    title: "APOD: 2026년 8월 28일 - 하늘이 파라날 위로 변합니다",
    originalTitle: "APOD: 2026 August 28 - The Sky Turns Above Paranal",
    publishedAt: "2026-08-28T04:05:00Z" });

  assert.equal(buildEventClusters([letter, apod]).length, 2);
});

test("GTA라는 작품명과 일반 영문 조각만 겹치는 서로 다른 사건은 병합하지 않는다", () => {
  const rugpull = article({ id: "gta-rugpull", source: "pcgamer", category: "gaming",
    title: "번역 제목 A",
    originalTitle: "Cyberleek may have just cashed out on their GTA 6 leak, earning over $200,000 in the most predictable crypto rugpull ever performed",
    publishedAt: "2026-08-28T01:00:00Z" });
  const hotwire = article({ id: "gta-hotwire", source: "engadget", category: "gaming",
    title: "번역 제목 B",
    originalTitle: "You won't be able to hotwire every vehicle in GTA 6",
    publishedAt: "2026-08-28T02:00:00Z" });

  assert.equal(decideEventMerge(rugpull, hotwire).merge, false);
  assert.equal(buildEventClusters([rugpull, hotwire]).length, 2);
});

test("같은 인터뷰의 안나 넷째 임신 기사는 숫자 단위가 달라도 한 사건이다", () => {
  const health = article({ id: "anna-health", source: "tenasia", category: "culture",
    title: "'박주호♥' 안나 \"유방암 완전관해 상태 3년\"…넷째 임신은 \"의사, 괜찮다고\"",
    publishedAt: "2026-08-28T04:11:02Z" });
  const family = article({ id: "anna-family", source: "tenasia", category: "culture",
    title: "안나, '넷째 임신' 3남매 중 나은이가 먼저 알았다…\"한국 출산 계획\"",
    publishedAt: "2026-08-28T04:10:01Z" });

  assert.equal(decideEventMerge(health, family).merge, true);
  assert.equal(buildEventClusters([health, family]).length, 1);
});

test("Google 뉴스 제목의 발행사 꼬리만 같은 서로 다른 기사는 병합하지 않는다", () => {
  const deposits = article({
    id: "kita-deposits", source: "gnews-biz", category: "business",
    url: "https://news.google.com/rss/articles/deposits?oc=5",
    title: "7월 달러예금 1천억달러 넘어…전체 외화예금도 역대 최대 - 한국무역협회-KITA.NET",
    publishedAt: "2026-08-28T03:14:52Z"
  });
  const cyber = article({
    id: "kita-cyber", source: "gnews-biz", category: "business",
    url: "https://news.google.com/rss/articles/cyber?oc=5",
    title: "AI가 해커 무기로…오픈AI·MS 등 수개월 내 공격 광범위 - 한국무역협회-KITA.NET",
    publishedAt: "2026-08-28T04:00:00Z"
  });

  assert.equal(decideEventMerge(deposits, cyber).merge, false);
  assert.equal(buildEventClusters([deposits, cyber]).length, 2);
});

test("같은 재난의 수치 갱신은 합치되 관련 후속 기사를 한 사건으로 삼키지 않는다", () => {
  const initial = article({ id: "nepal-search-a", source: "travel", category: "news",
    title: "네팔 홍수 실종자 수색 작업 계속", publishedAt: "2026-08-28T01:00:00Z" });
  const update = article({ id: "nepal-search-b", source: "yna", category: "news",
    title: "네팔 대홍수 실종자 수색 구조 작업 확대", publishedAt: "2026-08-28T02:00:00Z" });
  const side = article({ id: "nepal-theft", source: "hankyung", category: "news",
    title: "네팔 대홍수 희생자 시신서 금귀걸이 훔쳐 두 남성 체포", publishedAt: "2026-08-28T03:00:00Z" });
  const oldToll = article({ id: "nepal-toll-old", source: "travel", category: "news",
    title: "네팔 홍수에 826명 실종 165명 사망", publishedAt: "2026-08-28T04:00:00Z" });
  const newToll = article({ id: "nepal-toll-new", source: "yna", category: "news",
    title: "네팔 대홍수 사망자 543명 실종자 1535명", publishedAt: "2026-08-28T05:00:00Z" });

  assert.equal(decideEventMerge(oldToll, newToll).merge, true, "수치가 갱신된 같은 재난 보도");
  const events = buildEventClusters([initial, update, side]);
  assert.equal(eventOf(events, "nepal-search-a"), eventOf(events, "nepal-search-b"));
  assert.notEqual(eventOf(events, "nepal-search-a"), eventOf(events, "nepal-theft"));
});
