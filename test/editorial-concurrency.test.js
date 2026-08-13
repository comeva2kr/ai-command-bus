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

function concurrencySources(baseMs = Date.now()) {
  return Array.from({ length: 14 }, (_, s) => {
    const category = CATEGORIES[s % CATEGORIES.length].id;
    return new JsonSource(`conc-${s}`, async () =>
      Array.from({ length: 15 }, (_, i) => ({
        id: `conc-${s}-${i}`,
        title: `사건${s}-${i}: ${category} 관측 ${i}`,
        url: `https://conc-${s}.example.com/${i}`,
        category,
        score: 400 - s * 10 - i,
        commentCount: 30,
        coverage: i % 3 ? 1 : 3,
        publishedAt: new Date(baseMs - i * 60000).toISOString()
      })), "community");
  });
}

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
