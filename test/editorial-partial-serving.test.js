// 선택 분야를 조용히 빼는 부분판은 금지한다. 새 조합은 선택한 모든 단독 lane이
// 충족될 때만 제공하고, 그렇지 않으면 검증된 이전 조합 또는 409를 반환한다.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/feed/server.js";
import { JsonSource } from "../src/feed/content.js";

const PARTIAL_SUBJECTS = [
  "기준금리 결정 회의 결과", "원달러 환율 변동 대응 방안", "반도체 수출 전망 공식 발표",
  "국제유가 공급 계획 조정", "전기요금 연료비 조정안", "중소기업 정책금융 확대",
  "항만 물동량 월간 통계", "온라인 유통 매출 동향", "고용보험 가입자 통계",
  "기업 설비투자 계획 공개", "조선업 수주 잔고 분기 집계", "배터리 원재료 장기 공급 계약",
  "항공화물 운임 지수 발표", "농산물 도매가격 안정 대책", "벤처투자 신규 결성액 통계",
  "통신사 망 투자 로드맵 공개", "철강 생산설비 정비 일정", "바이오 의약품 수출 허가 획득",
  "관광객 카드 사용액 월간 분석", "가계대출 관리 방안 확정", "공공조달 납품단가 조정",
  "해운사 친환경 선박 발주", "식품 원재료 구매 계약 체결", "클라우드 데이터센터 증설",
  "보험사 지급여력비율 공시", "면세점 임대료 산정 기준 변경", "산업단지 공장 투자 착공 일정",
  "보유세 과세 기준 개편 발표", "S&P 500 목표치 상향 발표", "무역수지 흑자 폭 확대"
];

function unevenSources(baseMs = Date.now()) {
  const rows = (id, category, subjects, score) => subjects.map((subject, i) =>
    new JsonSource(`${id}-${i}`, async () => [{
      id: `${id}-${i}`,
      title: `${subject}: ${category} 분야 공식 자료 ${i + 1}`,
      url: `https://${id}-${i}.example.com/article`,
      category,
      score: score - i,
      commentCount: 25,
      coverage: 3,
      publishedAt: new Date(baseMs - i * 60000).toISOString()
    }], "news"));
  return [
    ...rows("part-tech", "tech", PARTIAL_SUBJECTS, 300),
    ...rows("part-humor", "humor", PARTIAL_SUBJECTS, 280),
    ...rows("part-sci", "science", PARTIAL_SUBJECTS.slice(0, 2), 40)
  ];
}

test("현재 서빙: 한 분야라도 미달이면 선택 분야를 뺀 부분판을 제공하지 않는다", async () => {
  const server = createServer({ sources: unevenSources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/today?categories=science,tech`);
    assert.equal(res.status, 409, "과학을 빼고 기술만 제공하면 선택 계약을 어긴다");
    const body = await res.json();
    assert.equal(body.code, "EDITORIAL_EDITION_NOT_SERVEABLE");
    assert.equal(body.partial, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("부분 서빙: 선택한 모든 분야가 미달이면 그대로 409다", async () => {
  const server = createServer({ sources: unevenSources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/today?categories=science`);
    // science 단독 = met 분야 0 → 부분 서빙 불가, 검증된 이전판도 없으므로 409
    assert.equal(res.status, 409, `전 분야 미달은 409여야 한다 (실제 ${res.status})`);
    const body = await res.json();
    assert.equal(body.code, "EDITORIAL_EDITION_NOT_SERVEABLE");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
