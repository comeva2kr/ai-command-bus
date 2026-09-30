// NH167 라이브 직전 적대 검수(2026-09-30) 편집 결함 F1~F3의 실제 반례 회귀.
//
// F1 같은 발표가 수 표기(1천60만대·1060만대·1000만 고지)만 달라 세 사건·세 카드가 됐다.
// F2 경제지 섹션 등록만으로 정치 고발·통일 여론조사·대학 연구가 경제 레인에 들어갔다.
// F3 외신 영상 접두어("Watch:"→"시청:")가 독자 제목에 남았다.
// 픽스처는 실제 수집 행 그대로다(비신뢰 입력). 근사 동치·분야 강제 이동·외신 일괄 제외는 만들지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildEventClusters, decideEventMerge, eventEntityTokens, parseExactNumber } from "../src/feed/event-cluster.js";
import { categoryGuardReason, definiteCategory } from "../src/feed/classify.js";
import { createCategoryRouter } from "../src/feed/category-routing.js";
import { readerIssueCopy } from "../src/feed/editorial-reader-copy.js";
import { loadRegistry } from "../src/feed/registry.js";
import {
  assembleCategoryLanes, crossSlotMaterialChange, headlineNeedsPolish, polishIssueHeadlines, sameEditionEvent
} from "../tools/build-slot-canonical-edition.mjs";
import { buildSelectionShadowPacket } from "../tools/prepare-selection-shadow.mjs";
import { getCandidate } from "../tools/selection-candidate-registry.mjs";

const NH167 = JSON.parse(fs.readFileSync(new URL("./fixtures/nh167-same-event-and-routing-2026-09-30.json", import.meta.url), "utf8"));
const rows = Object.fromEntries(NH167.tucsonSameEvent.map((row) => [row.source, row]));
const [infomax, yonhap] = NH167.tucsonSameEvent.filter((row) => row.source === "gnews-biz");
const hybrid = NH167.tucsonDifferentProduct[0];
const sha = "a".repeat(64);
const numbers = (title) => eventEntityTokens(title).filter((token) => /^num:|^\d/.test(token));
const at = (hours) => `2026-09-30T${String(hours).padStart(2, "0")}:00:00+09:00`;

// ── F1 · 정확한 수 표기 ─────────────────────────────────────────────────────
test("F1 수 표기: 같은 수의 다른 한국어 표기는 같은 토큰이고 숫자 뒤 '만'은 단위이며, 다른 수는 그대로 다르다", () => {
  assert.deepEqual(numbers("투싼 누적 판매 1천60만대 돌파"), ["num:10600000대"]);
  assert.deepEqual(numbers("투싼 누적 판매 1060만대 돌파"), ["num:10600000대"]);
  assert.deepEqual(numbers("투싼 누적 판매 1,060만대 돌파"), ["num:10600000대"]);
  assert.deepEqual(numbers("현대차 투싼, 22년 만에 1000만 고지 넘었다"), ["22년", "num:10000000"]);
  assert.deepEqual(numbers("피해액 3억5천만원 추정"), ["num:350000000원"]);
  assert.deepEqual(numbers("매출 1.5억 달성"), ["num:150000000"]);
  assert.deepEqual(numbers("Earbuds cost $99.00 now"), ["99"]);
  assert.deepEqual(numbers("공장 화재 부상 17명"), ["17명"], "기존 표기는 그대로다");
  // 근사 동치 없음: 1000만≠1060만, 1.060만≠1060만, 1060≠1060만, 1.0000001≠1.0000002.
  assert.notDeepEqual(numbers("누적 1000만대"), numbers("누적 1060만대"));
  assert.equal(parseExactNumber("1.060만").canonical, "10600");
  assert.equal(parseExactNumber("1060만").canonical, "10600000");
  assert.equal(parseExactNumber("1060").canonical, "1060");
  assert.equal(parseExactNumber("1.0000001달러").canonical, "1.0000001");
  assert.equal(parseExactNumber("1.0000002달러").canonical, "1.0000002");
  assert.notEqual(parseExactNumber("1.0000001달러").canonical, parseExactNumber("1.0000002달러").canonical);
  assert.equal(parseExactNumber("99.00").canonical, "99");
  assert.equal(parseExactNumber("1061만6102대").canonical, "10616102");
  assert.equal(parseExactNumber("1061만6102대").unit, "대");
  assert.equal(parseExactNumber("3.14").canonical, "3.14");
  assert.equal(parseExactNumber("천만대"), null, "숫자로 시작하지 않는 표기는 읽지 않는다");
});

test("F1 사건 판정: 투싼 누적 판매 발표는 표기가 달라도 한 사건이고, 다른 제품·실제 증가·요약 어디의 숫자는 다리가 되지 않는다", () => {
  assert.equal(decideEventMerge(infomax, rows.chosunbiz).merge, true, "1천60만대 vs 1060만대");
  assert.equal(decideEventMerge(infomax, rows.khan).merge, true);
  assert.equal(decideEventMerge(yonhap, rows.khan).merge, true);
  const news = (id, title, summary, hours = 10) => ({ id, title, summary, kind: "news", source: id, url: `https://example.com/${id}`, publishedAt: at(hours) });
  // 이정표(1000만) vs 정확한 양(1060만대)은 이정표 기사의 자기 요약이 그 정확한 양을 달성으로 말할 때만 같은 발표다.
  const own = decideEventMerge(
    news("m1", "현대차 투싼 국산 SUV 최초 1000만대 돌파", "현대자동차 투싼이 국산 SUV 최초로 글로벌 누적 판매 1060만대를 돌파했다."),
    news("p1", "현대차 투싼 누적판매 1060만대 돌파…국산 SUV 첫 천만대 클럽", "", 11));
  assert.equal(own.merge, true, JSON.stringify(own));
  assert.match(own.reason, /summary_number:10000000대~10600000대:own_summary/);
  // 실제 동아(1000만 고지)·오토헤럴드(1000만 대) vs 경향(1060만대): 동아 자기 요약 1061만6102대는 1060만대와 정확히 같지
  // 않아 (a)로는 못 잇지만, 경향 자기 요약 "누적 1000만대 고지를 밟은 것은 이번이 처음이다"가 이번 발표의 첫 달성을 말한다(b).
  const donga = decideEventMerge(rows.donga, rows.khan);
  assert.equal(donga.merge, true, JSON.stringify(donga));
  assert.match(donga.reason, /summary_number:10000000~10600000대:first_achievement/);
  assert.equal(decideEventMerge(rows.autoherald, rows.khan).merge, true);
  const bare = (row) => ({ ...row, summary: "" });
  assert.equal(decideEventMerge(bare(rows.donga), bare(rows.khan)).reason, "guard_number_conflict", "요약이 없으면 보수적으로 남는다");
  // 역방향 역사는 다리가 아니다: 뒤의 정확한 제목(1100만대) 요약이 옛 이정표를 언급해도("기존 1000만을 넘어") 변화의 역사다.
  assert.equal(decideEventMerge(
    news("m2", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("p2", "현대차 투싼 누적판매 1100만대 돌파…국산 SUV", "투싼이 기존 1000만대를 넘어 1100만대에 이르렀다.", 11)).reason, "guard_number_conflict");
  // 첫 달성 표지 없이 스치는 이정표("1000만대를 넘어")나 전망("1000만대 판매 목표")은 근거가 아니다.
  assert.equal(decideEventMerge(
    news("m3", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("p3", "현대차 투싼 누적판매 1060만대 돌파…국산 SUV", "국산 SUV가 누적 1000만대를 넘어섰다.", 11)).reason, "guard_number_conflict");
  assert.equal(decideEventMerge(
    news("m4", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("p4", "현대차 투싼 누적판매 1060만대 돌파…국산 SUV", "국산 SUV 최초 1000만대 판매 목표를 세운 것은 처음이다.", 11)).reason, "guard_number_conflict");
  // 창 규칙: 수 앞의 "시장에서"는 장소라 허용, 수 뒤의 "에서"·"을 넘어"는 변화의 역사라 거부, (고지|클럽) 표지가 없으면 거부.
  assert.equal(decideEventMerge(
    news("w1", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("w2", "현대차 투싼 누적판매 1060만대 돌파…국산 SUV", "국산 SUV가 글로벌 시장에서 누적 1000만대 고지를 밟은 것은 이번이 처음이다.", 11)).merge, true);
  assert.equal(decideEventMerge(
    news("w3", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("w4", "현대차 투싼 누적판매 1100만대 돌파…국산 SUV", "투싼 누적 판매가 1000만대에서 1100만대로 늘어난 것은 처음이다.", 11)).reason, "guard_number_conflict");
  assert.equal(decideEventMerge(
    news("w5", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("w6", "현대차 투싼 누적판매 1100만대 돌파…국산 SUV", "투싼 누적 판매 1000만대를 넘어 처음으로 1100만대 클럽에 들었다.", 11)).reason, "guard_number_conflict");
  assert.equal(decideEventMerge(
    news("w7", "현대차 투싼 국산 SUV 최초 1000만대 돌파", ""),
    news("w8", "현대차 투싼 누적판매 1060만대 돌파…국산 SUV", "국산 SUV 누적 판매 1000만대는 이번이 처음이다.", 11)).reason, "guard_number_conflict");
  // 다른 차종은 같은 발표가 아니다(Root 반례: 투싼 1000만 고지 vs 싼타페 1060만대, 같은 시각·같은 첫 달성 요약).
  const tucson = news("t1", "현대차 투싼, 국산 SUV 글로벌 누적 1000만 고지", "현대차 투싼 누적 판매 1000만대 도달");
  const santafe = news("t2", "현대차 싼타페, 국산 SUV 글로벌 누적 1060만대 돌파", "현대차 싼타페가 글로벌 시장에서 누적 1000만대 고지를 밟은 것은 이번이 처음이다.");
  assert.equal(decideEventMerge(tucson, santafe).reason, "guard_number_conflict");
  // 판매가 아닌 수치(폭탄 1000발)는 이정표 예외를 얻지 못한다.
  assert.equal(decideEventMerge(
    news("b1", "이스라엘군 가자 공습 폭탄 1000발 투하", ""),
    news("b2", "이스라엘군 가자 공습 폭탄 1060발 투하", "이스라엘군이 가자 공습에 폭탄 1000발을 처음으로 넘겼다.", 11)).reason, "guard_number_conflict");
  // 사상자는 판매 이정표가 아니다(100명 vs 101명).
  assert.equal(decideEventMerge(
    news("c1", "구로 물류센터 화재 사망 100명", "구로 물류센터 화재 사망자가 101명을 넘어섰다."),
    news("c2", "구로 물류센터 화재 사망 101명", "", 11)).reason, "guard_number_conflict");
  // 실제 증가는 다리가 아니다: 사망 12명→18명(요약이 이전 12명을 언급), 1060만대→1100만대(요약이 옛 1060만대를 언급).
  const dead12 = news("d12", "구로 물류센터 화재 사망 12명", "구로 물류센터 화재로 12명이 숨졌다.");
  const dead18 = news("d18", "구로 물류센터 화재 사망 18명", "구로 물류센터 화재 사망자가 앞서 12명에서 18명으로 늘었다.", 11);
  assert.equal(decideEventMerge(dead12, dead18).reason, "guard_number_conflict");
  const sales1060 = news("s1060", "현대차 투싼 누적판매 1060만대 돌파", "투싼이 출시 22년 만에 글로벌 누적 판매 1060만대를 넘어섰다.");
  const sales1100 = news("s1100", "현대차 투싼 누적판매 1100만대 돌파", "투싼 누적 판매가 지난달 1060만대에서 이달 1100만대로 늘었다.", 11);
  assert.equal(decideEventMerge(sales1060, sales1100).reason, "guard_number_conflict");
  // 이정표 기사 자기 요약이라도 달성 문맥 없이 스치는 숫자는 근거가 아니다.
  const milestone = news("m", "현대차 투싼 국산 SUV 최초 1000만대 돌파", "투싼 1060만대 판매 목표는 내년이다.");
  const precise = news("p", "현대차 투싼 국산 SUV 누적 판매 1060만대 기록", "", 11);
  assert.equal(decideEventMerge(milestone, precise).reason, "guard_number_conflict");
  // 단위가 다른 같은 숫자(부상 120명 vs 요약 "120일")도 근거가 아니다.
  const hurt120 = news("h120", "구로 물류센터 화재, 부상 120명", "");
  const hurt350 = news("h350", "구로 물류센터 화재 부상 350명 집계", "화재 120일 전 점검에서 지적된 문제가 반복됐다.", 11);
  assert.equal(decideEventMerge(hurt120, hurt350).reason, "guard_number_conflict");
  // 같은 차종의 다른 소식(하이브리드 생산 이전·5억 달러)은 별개다.
  assert.equal(decideEventMerge(infomax, hybrid).merge, false);
  assert.equal(decideEventMerge(rows.khan, hybrid).merge, false);
  // 여섯 기사는 2+2+2 세 묶음이 아니라 3+3 두 묶음이 된다(연합 계열은 동아와 실체 겹침 1개뿐이라 전원 일치
  // 규칙상 남는다 — 그 잔여는 아래 레인 조립의 같은 사건 재확인이 맡는다). 다른 제품은 합쳐지지 않는다.
  const clusters = buildEventClusters([...NH167.tucsonSameEvent, hybrid]);
  const sizes = clusters.map((event) => event.memberArticleIds.length).sort((x, y) => y - x);
  assert.deepEqual(sizes, [3, 3, 1], JSON.stringify(clusters.map((event) => event.memberArticleIds)));
  assert.ok(clusters.some((event) => event.memberArticleIds.length === 1 && event.memberArticleIds[0] === hybrid.id));
});

test("F1 시황 주체: 코스피 시황과 개별 종목 기사는 상승·투자·기대만 겹쳐도 한 사건이 아니고, 코스피 시황끼리는 그대로 묶인다", () => {
  const byId = Object.fromEntries(NH167.stockIndexPair.map((row) => [row.id, row]));
  // 실제 9/30 점심 business 15번째 카드(9d668eec…): 코스피 시황 + 유진테크 종목 기사.
  assert.equal(decideEventMerge(byId.it_110rij7, byId.it_zz0ahp).reason, "guard_stock_index_subject");
  // 실제 business 13번째 카드(714556ca…): 코스피 6900선 회복 두 매체는 그대로 한 사건이다.
  assert.equal(decideEventMerge(byId.it_f7kwku, byId.it_6ji8w0).merge, true);
  assert.equal(buildEventClusters([byId.it_110rij7, byId.it_zz0ahp]).length, 2);
  // 같은 URL·같은 정규화 제목의 강한 결합은 그대로다.
  const same = { ...byId.it_zz0ahp, id: "dup", url: byId.it_110rij7.url, title: byId.it_110rij7.title };
  assert.equal(decideEventMerge(byId.it_110rij7, same).mode, "strong");
});

// ── F1 · 슬롯 사이 수치 변화 판정(공통 helper) ────────────────────────────────
test("F1 슬롯 간 수치: $99와 $99.00, 1천60만대와 1060만대는 새 수치가 아니고 진짜 가격·비율·인원 변화는 남는다", () => {
  const lead = (title) => ({ eventSources: [{ title, originalTitle: title, publishedAt: "2026-09-30T03:00:00Z", kind: "news" }], metrics: { communityOnly: false } });
  const unchanged = { material: false, basis: "no_demonstrated_fact_change" };
  assert.deepEqual(crossSlotMaterialChange(lead("Earbuds cost $99"), lead("Earbuds cost $99.00")), unchanged);
  assert.deepEqual(crossSlotMaterialChange(lead("Earbuds cost $99"), lead("이어폰 가격 99달러")), unchanged);
  assert.deepEqual(crossSlotMaterialChange(lead("이어폰 가격 99달러"), lead("이어폰 가격 129달러")), { material: true, basis: "changed_headline_number", numbers: ["129달러"] });
  assert.deepEqual(crossSlotMaterialChange(lead("'22살' 투싼, 글로벌 누적 판매 1천60만대 돌파"), lead("현대차 투싼 누적판매 1060만대 돌파…국산 SUV 첫 ‘천만대 클럽’ 진입")), unchanged);
  assert.deepEqual(crossSlotMaterialChange(lead("투싼 누적 판매 1,060만대 돌파"), lead("투싼 누적 판매 1천60만대 돌파")), unchanged);
  assert.deepEqual(crossSlotMaterialChange(lead("'22살' 투싼, 글로벌 누적 판매 1천60만대 돌파"), lead("현대차, 투싼 글로벌 누적 판매 1060만대 돌파… 해외 판매가 91%")),
    { material: true, basis: "changed_headline_number", numbers: ["91%"] }, "해외 판매 비중 91%는 앞 제목이 말하지 않은 새 수치다");
  assert.deepEqual(crossSlotMaterialChange(lead("투싼 누적판매 1060만대 돌파"), lead("투싼 누적판매 1100만대 돌파")), { material: true, basis: "changed_headline_number", numbers: ["1100만대"] });
  assert.deepEqual(crossSlotMaterialChange(lead("군산 조선소 8700억 수주"), lead("군산 조선소 8,700억원 수주 확정")), unchanged);
  assert.deepEqual(crossSlotMaterialChange(lead("사망 3명"), lead("사망 5명")), { material: true, basis: "changed_headline_number", numbers: ["5명"] });
});

// ── F1 · 레인 안 같은 사건 재확인 ─────────────────────────────────────────────
const fixtureIssue = (id, selectedByCategories) => ({
  clusterId: `cluster-${id}`, evidenceHash: `evidence-${id}`, headline: `기사 ${id}`, subject: `기사 ${id}`,
  paragraph: `기사 ${id}`, whyImportant: `기사 ${id}`, whyHot: `기사 ${id}`, watchNext: `기사 ${id}`,
  selectedByCategories, categoryIds: selectedByCategories,
  refs: [{ id, title: `기사 ${id}`, sourceLabel: `매체 ${id}`, canonicalUrl: `https://publisher.example/${id}` }],
  sourceEvidence: [{ evidenceId: id, sourceLabel: `매체 ${id}`, canonicalUrl: `https://publisher.example/${id}` }],
  eventSources: [{ evidenceId: id, sourceLabel: `매체 ${id}`, canonicalUrl: `https://publisher.example/${id}`, title: `기사 ${id}`, publishedAt: at(10) }],
  articleSummary: { status: "ready", textKo: "요약 ".repeat(20), sourceLinks: [], generatedAt: "2026-09-30T02:50:00.000Z" }
});
const source = (row) => ({ evidenceId: row.id, sourceId: row.source, sourceLabel: row.sourceLabel || row.source, sourceGroup: row.source,
  title: row.title, originalTitle: row.originalTitle, summary: row.summary, publishedAt: row.publishedAt, canonicalUrl: row.url, evidenceRole: "lead", canLead: true });
const story = (id, categories, members, rankByCategory) => ({ ...fixtureIssue(id, categories),
  subject: members[0].title, headline: members[0].title, eventSources: members.map(source),
  metrics: { sourceCount: members.length, independentGroupCount: members.length, score: 0, comments: 0, coverage: 1,
    evidenceMode: "multiple_feed_observed", sourceRoles: { reported_secondary: members.length }, communityOnly: false },
  evidence: { mode: "multiple_feed_observed", independentGroupCount: members.length },
  event: { counts: { independentReportingGroups: members.length },
    sourceEvidence: members.map((row, index) => ({ articleId: row.id, operatorGroup: `${row.source}-${index}`, evidenceRole: "reporting" })) },
  _categoryLaneRanks: rankByCategory });

test("F1 레인 조립: 실제 세 제목은 1·16·17번째 어디에서도 한 장이고, 다른 제품·다른 레인의 자리·실제 판매 증가는 남는다", () => {
  const target = { editionDate: "2026-09-30", slotId: "lunch" };
  const filler = (index) => ({ ...fixtureIssue(`auto-f${index}`, ["auto"]), _categoryLaneRanks: { auto: index } });
  // 카드는 공통 사건 묶음이 실제로 만드는 구성이다(위 3+3): 연합 계열, 동아·오토헤럴드·경향 계열. 컷오프에 기대지 않는다.
  const first = story("tucson-yonhap", ["auto"], [infomax, yonhap, rows.chosunbiz], { auto: 0 });
  const donga = story("tucson-donga", ["auto", "business"], [rows.donga, rows.autoherald, rows.khan], { auto: 13, business: 0 });
  const khanAgain = story("tucson-khan", ["auto"], [rows.khan, { ...rows.khan, id: "khan-2", source: "yna" }], { auto: 16 });
  const other = story("tucson-hybrid", ["auto"], [hybrid, { ...hybrid, id: "hybrid-2", source: "yna" }], { auto: 14 });
  // 이정표 카드가 자기 요약으로 1060만대 달성을 말하면 같은 발표다(합의된 한 방향 근거).
  const milestoneOwn = { ...rows.autoherald, id: "auto-own", summary: "현대자동차 투싼이 국산 SUV 최초로 글로벌 누적 판매 1060만대를 돌파했다." };
  const milestoneCard = story("tucson-milestone", ["auto"], [milestoneOwn, { ...milestoneOwn, id: "auto-own-2", source: "yna" }], { auto: 15 });
  const unionEdition = { editionDate: target.editionDate, slot: { id: target.slotId },
    issues: [first, ...Array.from({ length: 12 }, (_, index) => filler(index + 1)), donga, other, milestoneCard, khanAgain] };
  const { editions, extras } = assembleCategoryLanes(unionEdition, target);
  const auto = editions.auto.issues.map((row) => row.evidenceHash);
  assert.equal(auto[0], "evidence-tucson-yonhap");
  assert.ok(!auto.includes("evidence-tucson-donga"), "같은 발표(동아·오토헤럴드·경향)는 기본 14자리 안(14번째)에서도 두 번째 장이 되지 않는다");
  assert.ok(!auto.includes("evidence-tucson-khan"), "같은 수치(1060만대)의 재등장 카드는 추가 자리에서도 되풀이되지 않는다");
  assert.ok(!auto.includes("evidence-tucson-milestone"), "자기 요약이 1060만대 달성을 말하는 이정표 카드도 한 장으로 접힌다");
  assert.ok(auto.includes("evidence-tucson-hybrid"), "다른 제품 소식(하이브리드 생산 이전)은 비워진 자리를 받는다");
  assert.equal(auto.length, 14);
  assert.deepEqual(editions.business.issues.map((row) => row.evidenceHash), ["evidence-tucson-donga"], "진짜 복수 분야 합집합의 다른 레인 자리는 그대로다");
  const same = extras.rejected.filter((row) => row.reason === "same_event_in_lane");
  assert.deepEqual(same.map((row) => [row.category, row.evidenceHash, row.sameAs]).sort(),
    [["auto", "evidence-tucson-donga", "evidence-tucson-yonhap"], ["auto", "evidence-tucson-khan", "evidence-tucson-yonhap"],
      ["auto", "evidence-tucson-milestone", "evidence-tucson-yonhap"]]);
  assert.ok(same.every((row) => /event_merge:/.test(row.basis)), JSON.stringify(same));
  // 순서를 바꿔도(동아 계열이 1번째, 연합 계열이 16번째, 경향 재등장이 17번째) 한 장이다 — 컷오프 무관.
  const swapped = assembleCategoryLanes({ ...unionEdition, issues: [
    { ...donga, _categoryLaneRanks: { auto: 0, business: 0 } }, ...Array.from({ length: 14 }, (_, index) => filler(index + 1)),
    { ...first, _categoryLaneRanks: { auto: 15 } }, { ...khanAgain, _categoryLaneRanks: { auto: 16 } }, { ...other, _categoryLaneRanks: { auto: 17 } }] }, target);
  assert.deepEqual(swapped.editions.auto.issues.filter((row) => /tucson/.test(row.evidenceHash)).map((row) => row.evidenceHash),
    ["evidence-tucson-donga", "evidence-tucson-hybrid"]);
  // 같은 해(22년)를 공유해도 판매 증가(1060만대→1100만대)는 새 사실이라 두 장이 남는다.
  const later = { ...rows.khan, id: "khan-later", title: "현대차 투싼, 출시 22년 만에 누적판매 1100만대 돌파", summary: "투싼 누적 판매가 지난달 1060만대에서 1100만대로 늘었다.", publishedAt: at(11) };
  const laterCard = story("tucson-later", ["auto"], [later, { ...later, id: "khan-later-2", source: "yna" }], { auto: 17 });
  assert.equal(decideEventMerge(rows.khan, later).merge, true, "사건 판정은 같은 해 22년으로 여전히 병합한다(기존 계약)");
  assert.deepEqual(sameEditionEvent(first, laterCard), { same: false, basis: "distinct:lead_quantity_conflict" });
  const withLater = assembleCategoryLanes({ ...unionEdition, issues: [...unionEdition.issues, laterCard] }, target);
  assert.ok(withLater.editions.auto.issues.some((row) => row.evidenceHash === "evidence-tucson-later"));
});

// ── F2 · 공통 분류 가드와 요청 경로·패킷 경로 ─────────────────────────────────
test("F2 분류 가드: 정치 고발·통일 여론조사·대학 연구 성과는 경제 주제가 없으면 경제 승인에서 빠지고, 진짜 경제 기사는 남는다", () => {
  const expected = {
    it_1l5wuno: "public-opinion-without-business-subject",
    it_9qi18i: "political-complaint-without-business-subject",
    it_hgw7ds: "political-complaint-without-business-subject",
    it_1gxon4u: "political-complaint-without-business-subject",
    it_1d56bvp: "research-without-business-subject",
    it_rd69h: "research-without-business-subject",
    // 같은 통일의식조사를 결과 낱말로만 쓴 다른 매체 제목(9/28 저녁 재생에서 추가 자리로 다시 들어왔던 사례).
    it_zmcydq: "public-opinion-without-business-subject",
    // 9/30 점심 business 16번째(軍 北지뢰 부상, 매경)·9/28 저녁 business 14번째(올해를 빛낸 게임, 구글뉴스 경제).
    it_1j8pqrv: "military-incident-without-business-subject",
    it_1ehncnw: "gaming-without-business-subject",
    it_1hsftgf: "public-opinion-without-business-subject"
  };
  for (const row of NH167.economyMisroutes) assert.equal(categoryGuardReason("business", row.title), expected[row.id], row.title);
  for (const title of [
    "정부, 반도체 세액공제 확대…기업 투자 유인",
    "국민 10명 중 7명 “물가 부담 커졌다”…한국은행 조사",
    "KAIST 연구진, 국내 기업과 배터리 상용화 협약",
    "삼성전자 회장, 배임 혐의 기소…주가 급락",
    "북한 리스크에도 외국인 투자자 신뢰 유지…시장 불신은 제한적",
    "한화에어로스페이스, 폴란드 K9 자주포 2조원 수출 계약",
    "軍, K2 전차 100대 추가 도입…1조원 계약",
    "넥슨, 3분기 매출 1조 돌파…게임 신작 흥행",
    "크래프톤 주가 급등…배틀그라운드 신작 기대",
    "대통령 “추경 예산 신속 집행” 지시",
    "코스피 3000 돌파"
  ]) assert.equal(categoryGuardReason("business", title), null, title);
  assert.equal(categoryGuardReason("politics", NH167.economyMisroutes[1].title), null);
  assert.equal(categoryGuardReason("science", NH167.economyMisroutes[4].title), null);
  // 세 사례 모두 제목 사전으로 확정되는 다른 분야가 없다 — 옮기지 않고 보류한다(추측 분류 없음).
  for (const row of NH167.economyMisroutes) assert.equal(definiteCategory({ title: row.title, url: row.url, sourceId: row.source }), null, row.title);
});

test("F2 요청 경로: 경제지 등록 기사의 비경제 승인은 빠지고 정치 레인·진짜 경제 기사는 보존된다", () => {
  const byId = Object.fromEntries(NH167.economyMisroutes.map((row) => [row.id, row]));
  const entries = [
    ["it_1l5wuno", ["business"]], ["it_9qi18i", ["business"]], ["it_1gxon4u", ["business", "politics"]],
    ["it_1d56bvp", ["business"]], ["kospi", ["business"]], ["chip-tax", ["business", "politics"]],
    ["it_1j8pqrv", ["business", "politics"]], ["it_1ehncnw", ["business"]], ["k9", ["business"]]
  ].map(([itemId, categories], index) => ({
    itemId, evidenceHash: String(index).repeat(64).slice(0, 64), categories, routingBasis: "deterministic_tier_policy"
  }));
  const router = createCategoryRouter({
    contract: "NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001", snapshotId: "nh167-business-guard",
    generatedAt: "2026-09-28T09:00:00.000Z", source: { packetSha256: sha, predictionsSha256: sha }, entries
  }, [], { now: () => Date.parse("2026-09-28T09:10:00.000Z") });
  const projected = router.project([
    { id: "it_1l5wuno", title: byId.it_1l5wuno.title, source: "chosunbiz", kind: "news" },
    { id: "it_9qi18i", title: byId.it_9qi18i.title, source: "heraldbiz", kind: "news" },
    { id: "it_1gxon4u", title: byId.it_1gxon4u.title, source: "donga", kind: "news" },
    { id: "it_1d56bvp", title: byId.it_1d56bvp.title, source: "mk-news", kind: "news" },
    { id: "kospi", title: "코스피 3000 돌파…외국인 순매수", source: "chosunbiz", kind: "news" },
    { id: "chip-tax", title: "정부, 반도체 세액공제 확대…기업 투자 유인", source: "heraldbiz", kind: "news" },
    { id: "it_1j8pqrv", title: byId.it_1j8pqrv.title, source: "mk-news", kind: "news" },
    { id: "it_1ehncnw", title: byId.it_1ehncnw.title, source: "gnews-biz", kind: "news" },
    { id: "k9", title: "한화에어로스페이스, 폴란드 K9 자주포 2조원 수출 계약", source: "heraldbiz", kind: "news" }
  ]);
  assert.deepEqual(Object.fromEntries(projected.map((row) => [row.routingOriginalId, row.admittedCategories])),
    { it_1gxon4u: ["politics"], kospi: ["business"], "chip-tax": ["business", "politics"], it_1j8pqrv: ["politics"], k9: ["business"] });
  assert.equal(projected.find((row) => row.routingOriginalId === "it_1gxon4u").category, "politics");
});

test("F2 패킷 경로: 경제지 등록 기사의 결정적 투표도 같은 가드를 지나 보류되고, 제목으로 확정되는 다른 분야가 있으면 그 분야로 간다", () => {
  const registry = loadRegistry();
  const pool = { savedAt: Date.parse("2026-09-30T02:25:50.189Z"), rows: [
    ...NH167.economyMisroutes.filter((row) => ["it_1l5wuno", "it_9qi18i", "it_1d56bvp"].includes(row.id)),
    { ...NH167.economyMisroutes[1], id: "kospi", title: "코스피 3000 돌파…외국인 순매수" },
    { ...NH167.economyMisroutes[1], id: "lab-space", title: "KAIST 연구진, 누리호 탑재 인공위성 자세제어 기술 개발" }
  ].map((row) => ({ item: { ...row, lang: "ko", kind: "news", category: "business", registryCategory: "business", tags: [] } })) };
  const packet = buildSelectionShadowPacket(pool, { candidate: getCandidate("p14-policy-shadow-haiku-full-nh91-20260828-evening"), registry, sourceSnapshotSha256: sha });
  const routing = Object.fromEntries(packet.targets.map((target) => [target.itemId, target.deterministicRouting?.categories ?? "withheld"]));
  assert.deepEqual(routing, { it_1l5wuno: "withheld", it_9qi18i: "withheld", it_1d56bvp: "withheld", kospi: ["business"], "lab-space": ["science"] });
});

// ── F3 · 영상 접두어 ────────────────────────────────────────────────────────
test("F3 독자 제목: 영상 접두어는 걷어내되 외신 제목 자체·시청률·검수 제목은 그대로 둔다", () => {
  const title = NH167.videoPrefixTitle[0].title;
  const issue = {
    subject: title, headline: `“${title}” · 복수 수집 경로 확인`, categoryIds: ["news"],
    metrics: { score: 0, comments: 0, coverage: 1, sourceCount: 1, evidenceMode: "single_feed_observed" },
    evidence: { mode: "single_feed_observed", sources: [{ label: "BBC" }] },
    eventSources: [{ evidenceId: "e-1", title, originalTitle: NH167.videoPrefixTitle[0].originalTitle, sourceId: "bbc-world", sourceLabel: "BBC" }],
    refs: [{ title, sourceLabel: "BBC" }],
    sourceEvidence: [{ evidenceId: "e-1", title, sourceLabel: "BBC", evidenceRole: "lead" }]
  };
  assert.equal(readerIssueCopy(issue).headline, "Madonna와 Taylor Swift가 MTV VMAs에서 큰 승리를 거두었습니다.");
  const englishTitle = NH167.videoPrefixTitle[0].originalTitle;
  const english = { ...issue, subject: englishTitle, refs: [{ title: englishTitle, sourceLabel: "BBC" }],
    sourceEvidence: [{ evidenceId: "e-1", title: englishTitle, sourceLabel: "BBC", evidenceRole: "lead" }],
    eventSources: [{ evidenceId: "e-1", title: englishTitle, originalTitle: englishTitle, sourceId: "bbc-world", sourceLabel: "BBC" }] };
  assert.equal(readerIssueCopy(english).headline, "Madonna and Taylor Swift win big at the MTV VMAs");
  assert.equal(readerIssueCopy({ ...issue, subject: "[영상] 마돈나, 23년 만의 VMA 무대" }).headline, "마돈나, 23년 만의 VMA 무대");
  assert.equal(readerIssueCopy({ ...issue, subject: "시청률 30% 넘긴 드라마, 마지막 회 앞두고 화제" }).headline, "시청률 30% 넘긴 드라마, 마지막 회 앞두고 화제");
  assert.equal(readerIssueCopy({ ...issue, preparedHeadline: "마돈나·테일러 스위프트, MTV VMA에서 주요 상 휩쓸어" }).headline, "마돈나·테일러 스위프트, MTV VMA에서 주요 상 휩쓸어");
  // 준비 제목(번역·검수)에 남은 영상 접두어도 같은 정리를 거친다.
  assert.equal(readerIssueCopy({ ...issue, preparedHeadline: "시청: 마돈나·테일러 스위프트, MTV VMA에서 주요 상 휩쓸어" }).headline, "마돈나·테일러 스위프트, MTV VMA에서 주요 상 휩쓸어");
});

test("F3 제목 마감: 영상 접두어는 번역 입력에서 걷어내고 원문 제목 기록·검수 대조는 그대로 둔다", async () => {
  const row = NH167.videoPrefixTitle[0];
  const broken = { subject: row.title, eventSources: [{ title: row.title, originalTitle: row.originalTitle, sourceId: row.source }] };
  assert.equal(headlineNeedsPolish(broken), true);
  const seen = [];
  const polished = await polishIssueHeadlines({ issues: [broken] }, {
    translateTitle: async (text) => { seen.push(text); return "마돈나·테일러 스위프트, MTV VMA에서 주요 상 휩쓸어"; }
  });
  assert.deepEqual(seen, ["Madonna and Taylor Swift win big at the MTV VMAs"]);
  assert.equal(polished.changed, 1);
  assert.equal(polished.edition.issues[0].eventSources[0].originalTitle, row.originalTitle);
});
