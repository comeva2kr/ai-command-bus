// 관심사 지수 — 지금 사람들이 실제로 검색하는 것 (David 2026-08-05)
//
// "트렌드 지수가 높은 관심사와 연관된 소식 중 가장 인용도 높고 반응 높은
//  중요한 소식들 위주로."
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInterests, trafficValue, usefulTerm, mentions, matchInterest, sharesKeyword, WEIGHTY,
  makeInterestsCache
} from "../src/feed/interest.js";

// 2026-08-05 구글 트렌드 KR 실제 응답 모양
const RSS = `<?xml version="1.0"?><rss><channel><title>Daily Search Trends</title>
<item><title>재건축</title><ht:approx_traffic>500+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>성남시, 분당 재건축·백현마이스 대비 '미래 교통망' 짠다</ht:news_item_title></ht:news_item>
  <ht:news_item><ht:news_item_title>성남시, 재건축·백현마이스 교통 계획 수립 용역 착수</ht:news_item_title></ht:news_item></item>
<item><title>최은경</title><ht:approx_traffic>1,000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>방송인 최은경 근황 공개</ht:news_item_title></ht:news_item></item>
<item><title>ลำดับของ ฟุตบอลทีมชาติฟิลิปปินส์</title><ht:approx_traffic>500+</ht:approx_traffic></item>
<item><title>qqqm</title><ht:approx_traffic>100+</ht:approx_traffic></item>
</channel></rss>`;

test("관심사: 급상승 검색어와 검색량을 그대로 읽는다", () => {
  const list = parseInterests(RSS);
  assert.equal(list.length, 3, "다른 나라 검색어는 걸러야 한다");
  assert.deepEqual(list.map((x) => x.term), ["재건축", "최은경", "qqqm"]);
  assert.equal(list[0].traffic, 500);
  assert.equal(list[1].traffic, 1000, "1,000+ 의 쉼표를 못 읽으면 1이 된다");
  assert.equal(list[0].news.length, 2, "연관 기사는 왜 떴는지 알려 주는 단서다");
  // 채널 제목("Daily Search Trends")이 검색어로 새면 안 된다
  assert.ok(!list.some((x) => /Daily Search/.test(x.term)));
});

test("관심사: 종목 코드·기업명 같은 영문은 남긴다", () => {
  // David가 말한 "주식·반도체"가 이런 형태로 올라온다
  assert.equal(usefulTerm("qqqm"), true);
  assert.equal(usefulTerm("SK하이닉스"), true);
  assert.equal(usefulTerm("ลำดับของ ฟุตบอล"), false, "다른 나라 글자는 우리 글과 이어질 일이 없다");
  assert.equal(usefulTerm("가"), false);
});

test("관심사: 검색량 표기를 숫자로", () => {
  assert.equal(trafficValue("1,000+"), 1000);
  assert.equal(trafficValue("200+"), 200);
  assert.equal(trafficValue(""), 0);
  assert.equal(trafficValue(null), 0);
});

test("관심사: 한국어는 조사를 넘어 잡고, 영어는 단어 경계를 지킨다", () => {
  assert.equal(mentions("재건축이 다시 움직인다", "재건축"), true, "조사가 붙어도 같은 말이다");
  assert.equal(mentions("Nvidia said today", "ai"), false, "said 안의 ai에 걸리면 안 된다");
  assert.equal(mentions("AI 반도체 수요", "ai"), true);
  assert.equal(mentions("방법을 찾는다", "법"), false, "두 글자 미만 한글은 아무 데나 걸린다");
});

test("관심사: 검색어에 직접 걸리면 가장 강한 신호다", () => {
  const list = parseInterests(RSS);
  const m = matchInterest({ title: "분당 재건축 속도 낸다", summary: "" }, list);
  assert.equal(m.term, "재건축");
  assert.equal(m.how, "term");
  assert.equal(m.strength, 1);
});

test("관심사: 제목에 검색어가 없어도 같은 사건이면 이어 붙인다", () => {
  const list = parseInterests(RSS);
  // 구글이 "이 검색어는 이 기사들 때문에 떴다"고 알려 준 것이라 지어낸 연결이 아니다
  const m = matchInterest({ title: "성남시 백현마이스 교통 계획 발표", summary: "" }, list);
  assert.ok(m, "연관 기사와 같은 사건인데 못 이었다");
  assert.equal(m.how, "news");
  assert.ok(m.strength < 1, "간접 연결은 직접 언급보다 약해야 한다");
});

test("관심사: 흔한 낱말 하나로 엮이지 않는다", () => {
  // 하나만 겹치면 "서울"처럼 흔한 말로도 전부 이어져 버린다
  assert.equal(sharesKeyword("서울 날씨 맑음", "서울시 재건축 계획 발표"), false);
  assert.equal(sharesKeyword("성남시 재건축 교통", "성남시 재건축 용역 착수"), true);
});

test("관심사: 걸릴 게 없으면 아무 일도 일어나지 않는다", () => {
  assert.equal(matchInterest({ title: "오늘 점심 뭐 먹지" }, parseInterests(RSS)), null);
  assert.equal(matchInterest(null, []), null);
  assert.equal(matchInterest({ title: "x" }, null), null);
});

test("관심사: 가져오기 실패해도 브리핑을 막지 않는다", async () => {
  // 한 축이 빠질 뿐 반응·인용도 두 축은 그대로 돌아야 한다
  const cache = makeInterestsCache({ fetchImpl: async () => { throw new Error("network down"); } });
  assert.deepEqual(await cache(), []);
});

test("관심사: 무게 있는 분야는 실제 카테고리 id와 맞는다", () => {
  // taxonomy.js가 쓰는 id가 아니면 가중이 통째로 무효가 된다
  assert.ok(WEIGHTY.has("business") && WEIGHTY.has("politics") && WEIGHTY.has("news") && WEIGHTY.has("tech"));
  assert.ok(!WEIGHTY.has("humor") && !WEIGHTY.has("gaming"));
});
