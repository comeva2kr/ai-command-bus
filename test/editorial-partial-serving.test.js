// S3b A안 — 분야별 부분 서빙 (David 확정 지시 2026-08-13) 계약 고정.
// 하나 이상의 분야가 충족되면 200과 실제 콘텐츠, 전 분야 미달일 때만 409,
// requested/served/withheld 3필드와 제외 사유·확인 시각·공급 수량 동봉,
// 검수 지문은 실제 제공 콘텐츠 기준(축소 조합의 1급 판), 몰래 섞기 금지,
// 문구는 미래를 보장하지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/feed/server.js";
import { JsonSource } from "../src/feed/content.js";

function unevenSources(baseMs = Date.now()) {
  const rich = (id, category) => new JsonSource(id, async () =>
    Array.from({ length: 15 }, (_, i) => ({
      id: `${id}-${i}`,
      title: `사건 ${id}-${i}: ${category} 관측 ${i}`,
      url: `https://${id}.example.com/${i}`,
      category,
      score: 300 - i,
      commentCount: 25,
      coverage: i % 3 ? 1 : 3,
      publishedAt: new Date(baseMs - i * 60000).toISOString()
    })), "community");
  const starved = (id, category, n) => new JsonSource(id, async () =>
    Array.from({ length: n }, (_, i) => ({
      id: `${id}-${i}`,
      title: `빈약 ${id}-${i}: ${category} 소식`,
      url: `https://${id}.example.com/${i}`,
      category,
      score: 40 - i,
      commentCount: 3,
      publishedAt: new Date(baseMs - i * 60000).toISOString()
    })), "community");
  return [rich("part-tech", "tech"), rich("part-humor", "humor"), starved("part-sci", "science", 2)];
}

test("부분 서빙: 충족 분야는 200으로 제공하고 미달 분야는 사유와 함께 명시 제외한다", async () => {
  const server = createServer({ sources: unevenSources(), localEditorial: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/today?categories=science,tech`);
    assert.equal(res.status, 200, "충족 분야(tech)가 있으므로 통째 409가 아니라 200이어야 한다");
    const body = await res.json();
    assert.equal(body.partial, true);
    assert.deepEqual((body.requestedCategories || []).slice().sort(), ["science", "tech"]);
    assert.deepEqual(body.servedCategories, ["tech"]);
    assert.equal(body.withheldCategories.length, 1);
    const withheld = body.withheldCategories[0];
    assert.equal(withheld.id, "science");
    assert.match(withheld.reason, /과학 분야는 이번 판에/, "사유는 사람 문장으로");
    assert.doesNotMatch(withheld.reason, /다음 판|곧|예정/, "미래를 보장하는 문구 금지");
    assert.ok(withheld.checkedAt, "확인 시각 동봉");
    assert.ok(withheld.supply && withheld.supply.candidateCount != null, "공급 수량 동봉");
    // 제공 콘텐츠는 충족 분야만 — 미달 분야 이슈가 몰래 섞이면 안 된다
    const cats = new Set();
    for (const issue of body.issues || []) for (const c of issue.categories || [issue.category]) cats.add(c);
    assert.ok(!cats.has("science"), "제외한 분야의 이슈가 섞여 나왔다");
    assert.ok(body.issues.length > 0, "충족 분야의 실제 콘텐츠가 있어야 한다");
    // 검수 지문은 실제 제공 응답 기준
    assert.match(body.serving.responsePacketId || "", /^BRP-/);
    assert.equal(body.serving.fallback, false, "부분 서빙은 낡은 판 폴백이 아니라 현재 검증판이다");
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
