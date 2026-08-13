// P1-B 사건 계층 — 고정 평가 표본(블루프린트 v4, 2026-08-13 동결) 검수.
//
// 표본 1~5는 9인 검수에서 실측된 대표 결함 사례의 재현 픽스처다. 병합돼야
// 할 것이 병합되는지와 함께, **오병합 유도 픽스처가 하나라도 병합되면
// 실패**한다 — 오병합은 미병합보다 나쁜 실패로 계수한다(v4 성공지표).
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEventClusters,
  composeEventFromMembers,
  decideEventMerge,
  eventMaterialChange,
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
