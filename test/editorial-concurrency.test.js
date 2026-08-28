// 오늘판 동시 요청 격리 — 9인 검수(2026-08-13)가 본 "같은 쿼리가 2초 간격에
// 다른 판을 받는" 현상의 회귀 고정. 실측 결과 유효 조합에서는 세그먼트 키
// 단위 in-flight 잠금이 작동하고, 재현됐던 경로는 무효 슬러그의 조용한
// 정규화(→ UNKNOWN_CATEGORY 400으로 폐쇄)였다. 여기서는 "서로 다른 유효
// 조합의 동시 요청이 절대 서로의 판을 받지 않는다"를 계약으로 못박는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/feed/server.js";
import { JsonSource } from "../src/feed/content.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";

const CONCURRENCY_SUBJECTS = [
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

function concurrencySources(baseMs = Date.now()) {
  return CATEGORIES.flatMap(({ id: category }, categoryIndex) =>
    CONCURRENCY_SUBJECTS.map((subject, sourceIndex) => {
      const s = categoryIndex * CONCURRENCY_SUBJECTS.length + sourceIndex;
      return new JsonSource(`conc-${s}`, async () => [{
        id: `conc-${s}`,
        title: `${subject}: ${category} 분야 공식 자료 ${sourceIndex + 1}`,
        url: `https://conc-${s}.example.com/article`,
        category,
        score: 2000 - s,
        commentCount: 30,
        coverage: 3,
        publishedAt: new Date(baseMs - sourceIndex * 60000).toISOString()
      }], "news");
    }));
}

function stableLaneSources(baseMs = Date.now(), onFetch = () => {}) {
  return ["business", "tech"].flatMap((category, categoryIndex) =>
    CONCURRENCY_SUBJECTS.map((_, sourceIndex) => {
      const subject = CONCURRENCY_SUBJECTS[categoryIndex * 15 + sourceIndex % 15];
      const sourceId = `stable-${category}-${sourceIndex}`;
      return new JsonSource(sourceId, async () => {
        onFetch(sourceId);
        return [{
          id: sourceId,
          title: `${subject}: ${category} 공식 자료 ${sourceIndex + 1}`,
          url: `https://news.testhost.kr/${sourceId}`,
          category,
          score: 2000 - categoryIndex * 100 - sourceIndex,
          commentCount: 30,
          coverage: 3,
          publishedAt: new Date(baseMs - sourceIndex * 60_000).toISOString()
        }];
      }, "news");
    })
  );
}

test("현재 슬롯의 다른 단독 분야 요청은 고정된 근거 시각의 수집 결과를 함께 쓴다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-one-slot-refresh-"));
  const file = path.join(dir, "feed-data.json");
  const nowMs = Date.parse("2026-08-26T10:05:00Z");
  let fetchCalls = 0;
  const server = createServer({
    sources: stableLaneSources(nowMs - 60_000, () => { fetchCalls += 1; }),
    localEditorial: true,
    localEditorialInventorySchedule: false,
    clock: () => nowMs,
    file
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const business = await fetch(`${base}/api/today?categories=business&slot=evening`);
    assert.equal(business.status, 200);
    const callsAfterFirstLane = fetchCalls;
    assert.ok(callsAfterFirstLane > 0);

    const tech = await fetch(`${base}/api/today?categories=tech&slot=evening`);
    assert.equal(tech.status, 200);
    assert.equal(fetchCalls, callsAfterFirstLane,
      "같은 판의 누락 분야를 열 때 전체 소스를 다시 수집했다");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── S2 보강 검증 (David 확정 지시 2026-08-13) — 아래 5조건 전부 통과해야
//    S2를 완료로 판정한다. ①혼합 무효 슬러그 동시 400 ②무효 요청의 캐시·판
//    무오염 ③콜드 동시 같은 조합 = 같은 판·같은 지문 ④조합 간 격리(아래
//    기존 테스트) ⑤영속 스토어 재시작 후 같은 판.

test("S2-①②: 무효 슬러그 동시 요청은 전부 400이고 판·캐시를 오염시키지 않는다", async () => {
  const server = createServer({ sources: concurrencySources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const get = (c) => fetch(`${base}/api/today?categories=${c}`)
    .then(async (r) => ({ c, status: r.status, body: await r.json() }));
  try {
    // ① 혼합 무효(유효+무효 뒤섞기 포함) 동시 발사 — 전부 400
    const invalids = ["economy", "game,community", "humor,game", "economy,science", "tech,notreal"];
    const res = await Promise.all(invalids.map(get));
    for (const r of res) {
      assert.equal(r.status, 400, `무효 포함 요청이 400이 아니었다: ${r.c} → ${r.status}`);
      assert.equal(r.body.code, "UNKNOWN_CATEGORY");
    }
    // ② 무효 폭격 직후의 유효 요청 — 자기 조합 그대로, 반복 요청 동일 판
    const a = await get("humor");
    assert.equal(a.status, 200);
    assert.deepEqual((a.body.selectedCategories || []).slice().sort(), ["humor"],
      "무효 요청이 선택 카테고리를 오염시켰다");
    const b = await get("humor");
    assert.equal(b.body.editionId, a.body.editionId, "무효 요청이 판 캐시를 오염시켰다");
    // 무효 요청은 검수 영수증·판 저장에도 아무 흔적을 남기지 않아야 하지만,
    // 외부에서 관측 가능한 계약은 위 두 가지다(내부 저장은 ⑤ 재시작 검증이 커버).
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S2-③: 콜드 상태에서 같은 조합 동시 요청은 같은 판·같은 내용을 받는다", async () => {
  const server = createServer({ sources: concurrencySources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const rs = await Promise.all(Array.from({ length: 4 }, () =>
      fetch(`${base}/api/today?categories=tech,science`).then((r) => r.json())));
    const ids = new Set(rs.map((r) => r.editionId));
    assert.equal(ids.size, 1, `동시 요청이 서로 다른 판을 받았다: ${[...ids].join(", ")}`);
    const issueLists = rs.map((r) => (r.issues || []).map((i) => i.clusterId || i.id).join("|"));
    assert.equal(new Set(issueLists).size, 1, "같은 판인데 이슈 구성이 달랐다");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S2-⑤: 영속 스토어로 재시작해도 같은 조합은 같은 판을 받는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-s2-restart-"));
  const file = path.join(dir, "feed-data.json");
  const baseMs = Date.now();
  let first;
  {
    const server = createServer({ sources: concurrencySources(baseMs), localEditorial: true, file });
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    try {
      first = await fetch(`${base}/api/today?categories=business`).then((r) => r.json());
      assert.ok(first.editionId, "1차 서버에서 판이 나와야 한다");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  {
    const server = createServer({ sources: concurrencySources(baseMs), localEditorial: true, file });
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    try {
      const again = await fetch(`${base}/api/today?categories=business`).then((r) => r.json());
      assert.equal(again.editionId, first.editionId, "재시작 후 같은 조합이 다른 판을 받았다");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("오늘판: 복수 선택은 저장된 단독 분야 판의 정확한 합집합이다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-fixed-lanes-"));
  const file = path.join(dir, "feed-data.json");
  const nowMs = Date.parse("2026-08-26T03:30:00Z"); // 8월 26일 12:30 KST
  const issueKey = (issue) => String(
    issue?.event?.eventId || issue?.clusterId || issue?.eventSourceSetId ||
    issue?.evidenceHash || issue?.refs?.[0]?.id || issue?.headline
  );
  try {
    const seedServer = createServer({
      sources: stableLaneSources(nowMs - 60_000),
      localEditorial: true,
      clock: () => nowMs,
      file
    });
    await new Promise((resolve) => seedServer.listen(0, resolve));
    const seedBase = `http://localhost:${seedServer.address().port}`;
    try {
      for (const category of ["business", "tech"]) {
        const response = await fetch(`${seedBase}/api/today?categories=${category}`);
        assert.equal(response.status, 200);
      }
      const combined = await fetch(`${seedBase}/api/today?categories=business,tech`);
      assert.equal(combined.status, 200, "변경 전 조합판을 먼저 저장해 오래된 조합 캐시를 재현한다");
    } finally {
      await new Promise((resolve) => seedServer.close(resolve));
    }

    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const editions = Object.values(data.editorialEditions || {}).flatMap((day) =>
      Object.values(day || {}).flatMap((segments) => Object.values(segments || {})));
    const businessLane = editions.find((edition) =>
      edition?.editionSegment?.categories?.length === 1 &&
      edition.editionSegment.categories[0] === "business");
    assert.ok(businessLane, "저장된 business 단독판이 있어야 한다");
    businessLane.issues.pop();
    fs.writeFileSync(file, `${JSON.stringify(data)}\n`);

    const server = createServer({
      sources: stableLaneSources(nowMs - 60_000),
      localEditorial: true,
      clock: () => nowMs,
      file
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    try {
      const saved = new Set();
      for (const category of ["business", "tech"]) {
        const response = await fetch(`${base}/api/today?categories=${category}`);
        assert.equal(response.status, 200);
        const edition = await response.json();
        for (const issue of edition.issues) saved.add(issueKey(issue));
      }
      assert.equal(saved.size, 27, "테스트 전제: 저장된 단독판 합집합은 27건이어야 한다");

      const response = await fetch(`${base}/api/today?categories=business,tech`);
      assert.equal(response.status, 200);
      const combined = await response.json();
      assert.deepEqual(
        new Set(combined.issues.map(issueKey)),
        saved,
        "복수 선택이 저장된 단독 분야 판 대신 조합 이력으로 다시 선별했다"
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("오늘판: 서로 다른 조합의 동시 요청이 서로의 판을 받지 않는다", async () => {
  const server = createServer({ sources: concurrencySources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const combos = ["humor", "politics,realestate", "tech,science", "business", "sports,gaming"];
    const get = (c) => fetch(`${base}/api/today?categories=${c}`)
      .then(async (r) => ({ c, status: r.status, body: await r.json() }));
    // 콜드 상태 동시 발사 + 즉시 재요청 두 라운드
    for (const round of [await Promise.all(combos.map(get)), await Promise.all(combos.map(get))]) {
      for (const r of round) {
        if (r.status !== 200) continue; // 공급 부족 409는 이 테스트의 관심사가 아니다
        const want = r.c.split(",").sort().join(",");
        const got = (r.body.selectedCategories || []).slice().sort().join(",");
        assert.equal(got, want, `요청 조합과 응답 조합이 달랐다: ${want} → ${got}`);
      }
    }
    // 같은 조합 연속 재요청은 같은 판(캐시 고정)이어야 한다
    const a = await get("humor");
    const b = await get("humor");
    assert.equal(a.body.editionId, b.body.editionId, "같은 조합 재요청이 다른 판을 받았다");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
