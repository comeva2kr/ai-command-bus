// 날짜 선택기 기간 조회(/api/admin/traffic-range + store.trafficRange) 테스트.
// live traffic(90일)과 trafficArchive(400일)의 병합, 일/주/월 롤업, 입력 검증,
// admin.html의 날짜 선택기 정적 계약을 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FeedStore } from "../src/feed/store.js";
import { createServer } from "../src/feed/server.js";

const TOKEN = "test-admin-token";

async function withServer(fn) {
  const server = createServer({ adminToken: TOKEN });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}
const authed = (base, p) =>
  fetch(`${base}${p}`, { headers: { "x-admin-token": TOKEN } });

function seededStore() {
  const store = new FeedStore();
  // 아카이브 구간(90일 초과 과거) — feed 필드는 없던 시절이라 null이어야 한다.
  store.trafficArchive = {
    "2026-05-01": { date: "2026-05-01", visitors: 40, humanCount: 5, pv: 90, humanApprox: true },
    "2026-05-02": { date: "2026-05-02", visitors: 30, humanCount: 7, pv: 70, humanApprox: false }
  };
  // live 구간 — humanUids 있는 날 / 없는 날(engaged 소급 폴백) 각각.
  store.traffic = {
    "2026-08-03": { pv: 10, feed: 20, uids: ["u1", "u2"], humanUids: ["u1"] },
    "2026-08-04": { pv: 5, feed: 8, uids: ["u3"] } // humanUids 없음 → engaged 폴백
  };
  return store;
}

test("traffic-range: live+archive 병합, 스파스(기록 없는 날 생략), humanApprox 구분", () => {
  const store = seededStore();
  const rows = store.trafficRange("2026-04-30", "2026-08-05", "day");
  assert.deepEqual(rows.map((r) => r.key), ["2026-05-01", "2026-05-02", "2026-08-03", "2026-08-04"]);
  const may1 = rows[0];
  assert.equal(may1.visitors, 40);
  assert.equal(may1.human, 5);
  assert.equal(may1.pv, 90);
  assert.equal(may1.feed, null, "아카이브에 없던 피드 수는 0이 아니라 null(미계측)");
  assert.equal(may1.humanApprox, true);
  assert.equal(rows[1].humanApprox, false);
  const aug3 = rows[2];
  assert.deepEqual(
    { visitors: aug3.visitors, human: aug3.human, pv: aug3.pv, feed: aug3.feed, humanApprox: aug3.humanApprox },
    { visitors: 2, human: 1, pv: 10, feed: 20, humanApprox: false }
  );
  // humanUids 없는 live 날은 engaged 소급 폴백 + humanApprox 표시.
  // u3는 상호작용 흔적이 없으므로(유저 자체가 없음) engaged 0.
  const aug4 = rows[3];
  assert.equal(aug4.human, 0);
  assert.equal(aug4.humanApprox, true);
});

test("traffic-range: engaged 폴백은 능동신호 있는 유저를 센다", () => {
  const store = seededStore();
  store.createUser("u3");
  store.users.get("u3").sigTypes = { open: 2 };
  const rows = store.trafficRange("2026-08-04", "2026-08-04", "day");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].human, 1, "sigTypes.open 있는 u3는 engaged 폴백에서 사람 1");
  assert.equal(rows[0].humanApprox, true);
});

test("traffic-range: 주 롤업은 ISO 주 시작일(월요일) 키, 합산·humanApprox 전파", () => {
  const store = seededStore();
  const rows = store.trafficRange("2026-08-01", "2026-08-09", "week");
  // 2026-08-03(월)·08-04(화)은 같은 주 → 키 2026-08-03 하나.
  assert.equal(rows.length, 1);
  const w = rows[0];
  assert.equal(w.key, "2026-08-03");
  assert.equal(w.visitors, 3);
  assert.equal(w.human, 1);
  assert.equal(w.pv, 15);
  assert.equal(w.feed, 28);
  assert.equal(w.humanApprox, true, "폴백 날이 하나라도 섞이면 주 전체에 표시");
  assert.equal(w.days, 2, "그 주에 실측이 며칠 있었는지");
});

test("traffic-range: 월 롤업은 YYYY-MM 키, 아카이브 feed null은 합산에서 미계측 유지", () => {
  const store = seededStore();
  const rows = store.trafficRange("2026-05-01", "2026-08-09", "month");
  assert.deepEqual(rows.map((r) => r.key), ["2026-05", "2026-08"]);
  const may = rows[0];
  assert.equal(may.visitors, 70);
  assert.equal(may.human, 12);
  assert.equal(may.feed, null, "전 일자가 미계측이면 월도 null(지어낸 0 금지)");
  const aug = rows[1];
  assert.equal(aug.feed, 28);
});

test("traffic-range: _pruneTraffic는 humanUids 없던 날을 engaged 스냅샷+humanApprox로 접는다", () => {
  const store = new FeedStore();
  store.createUser("eng");
  store.users.get("eng").sigTypes = { open: 1 };
  store.traffic = {};
  // 91개 날짜를 만들어 가장 오래된 1개가 접히게 한다.
  for (let i = 0; i < 91; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    store.traffic[d] = i === 0
      ? { pv: 3, feed: 1, uids: ["eng", "ghost"] } // humanUids 없음
      : { pv: 1, feed: 0, uids: [], humanUids: [] };
  }
  store._pruneTraffic();
  const folded = store.trafficArchive["2026-01-01"];
  assert.ok(folded, "가장 오래된 날이 아카이브로 접혔다");
  assert.equal(folded.humanApprox, true);
  assert.equal(folded.humanCount, 1, "0으로 뭉개지 않고 engaged 스냅샷으로 접는다");
  assert.equal(folded.visitors, 2);
  // humanUids 있는 날이 접히면 humanApprox=false로 남는지도 확인.
  store.traffic["2026-04-02"] = undefined; delete store.traffic["2026-04-02"];
  store.traffic["2026-04-03"] = { pv: 1, feed: 0, uids: ["a"], humanUids: ["a"] };
  store._pruneTraffic();
  const folded2 = store.trafficArchive["2026-01-02"];
  assert.ok(folded2);
  assert.equal(folded2.humanApprox, false);
});

test("traffic-range API: 토큰 게이트 + 입력 검증(400) + 정상 응답 계약(스파스 필드만)", async () => {
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/admin/traffic-range?from=2026-08-01&to=2026-08-02`);
    assert.equal(anon.status, 401);

    const bad = [
      "/api/admin/traffic-range", // from/to 없음
      "/api/admin/traffic-range?from=2026-8-1&to=2026-08-02", // 형식 위반
      "/api/admin/traffic-range?from=2026-08-02&to=2026-08-01", // from > to
      "/api/admin/traffic-range?from=2026-02-30&to=2026-03-01", // 존재하지 않는 날짜
      "/api/admin/traffic-range?from=2025-01-01&to=2026-08-09", // 400일 초과
      "/api/admin/traffic-range?from=2026-08-01&to=2026-08-02&granularity=hour" // 잘못된 granularity
    ];
    for (const p of bad) {
      const res = await authed(base, p);
      assert.equal(res.status, 400, `${p} must be 400`);
    }

    const ok = await authed(base, "/api/admin/traffic-range?from=2026-08-01&to=2026-08-09&granularity=week");
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.granularity, "week");
    assert.ok(Array.isArray(body.rows));
    // 응답은 스파스 필드만 — 행마다 top-N 배열 같은 무거운 값이 실리면 안 된다.
    for (const r of body.rows) {
      for (const k of Object.keys(r)) {
        assert.ok(["key", "visitors", "human", "pv", "feed", "humanApprox", "days"].includes(k), `unexpected field ${k}`);
      }
    }
  });
});

test("analytics API: from/to 지원 — 기존 limit 호출 호환 유지, 잘못된 from/to는 400", async () => {
  await withServer(async (base) => {
    const legacy = await authed(base, "/api/admin/analytics?granularity=day&limit=30");
    assert.equal(legacy.status, 200, "기존 호출 형태는 그대로 동작해야 한다");
    const ranged = await authed(base, "/api/admin/analytics?granularity=month&from=2026-08-01&to=2026-08-09");
    assert.equal(ranged.status, 200);
    const badFrom = await authed(base, "/api/admin/analytics?from=nope&to=2026-08-09");
    assert.equal(badFrom.status, 400);
    const flipped = await authed(base, "/api/admin/analytics?from=2026-08-09&to=2026-08-01");
    assert.equal(flipped.status, 400);
  });
});

test("admin.html: 날짜 선택기·트래픽 표·파이프라인 라벨 정적 계약", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(here, "../src/feed/public/admin.html"), "utf8");
  // 공유 날짜 선택기 — localStorage 저장, 프리셋 6종, 직접 기간, 일/주/월.
  assert.ok(html.includes('RANGE_KEY = "admin_range"'), "선택 상태를 localStorage에 저장");
  for (const label of ["오늘", "어제", "최근 7일", "최근 30일", "이번 달", "지난달"]) {
    assert.ok(html.includes(`"${label}"`), `프리셋 ${label}`);
  }
  assert.ok(html.includes('type="date"'), "직접 기간은 date 입력(iOS 사파리 호환)");
  assert.ok(/setGran\("week"|gbtn\("week"/.test(html), "주 단위 토글");
  // 두 탭이 같은 상태를 쓴다 — traffic-range와 analytics 호출 모두 range 사용.
  assert.ok(html.includes("/api/admin/traffic-range?from=\"+range.from"), "대시보드가 traffic-range 사용");
  assert.ok(html.includes('granularity="+range.gran+"&from="+range.from'), "행동분석이 같은 range 사용");
  // 숫자 표 — 사람 열이 첫 번째 수치 열, 전체에 봇 포함 명시, 자체 스크롤 컨테이너.
  assert.ok(html.includes('<th class="num">사람</th><th class="num">전체 (봇·점검 포함)</th>'), "표 열 순서: 사람 먼저");
  assert.ok(html.includes('class="tblwrap"'), "표는 자기 컨테이너에서 가로 스크롤");
  // 파이프라인 라벨 — 서버측정/클라측정을 합치지 않는다.
  assert.ok(html.includes("서버 측정 (traffic)"), "트래픽 패널 파이프라인 라벨");
  assert.ok(html.includes("클라이언트 측정 (analytics)"), "행동분석 파이프라인 라벨");
  // KPI Δ 규칙 — 오늘은 절대값만, 확정일 비교.
  assert.ok(html.includes("오늘 사람 (집계 중 · Δ 없음)"), "오늘은 Δ 없이 절대값만");
  assert.ok(html.includes("지난주"), "어제 Δ는 지난주 같은 요일과 비교");
  // 소급 변동 명시.
  assert.ok(html.includes("소급 변동"), "engaged/human 소급 변동 가능 명시");
  // 사람 막대 추가.
  assert.ok(html.includes('class="bar hum'), "사람 막대");
});
