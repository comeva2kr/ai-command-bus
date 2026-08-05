// 관리자 대시보드 라우트 테스트 — 토큰 게이트 + 실측 응답 형태 검증.
// (server.js의 /api/admin/* 블록과 public/admin.html 대시보드 확장에 대응)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "../src/feed/server.js";
import { loadRegistry } from "../src/feed/registry.js";

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

const authed = (base, p, opts = {}) =>
  fetch(`${base}${p}`, { ...opts, headers: { "content-type": "application/json", "x-admin-token": TOKEN, ...(opts.headers || {}) } });

test("admin: 모든 /api/admin/* 라우트는 토큰 없이 401 (신규 source-health 포함)", async () => {
  await withServer(async (base) => {
    const gets = [
      "/api/admin/traffic",
      "/api/admin/stats",
      "/api/admin/users",
      "/api/admin/posts",
      "/api/admin/comments",
      "/api/admin/communities",
      "/api/admin/source-health"
    ];
    for (const p of gets) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 401, `${p} must be token-gated`);
    }
    const posts = [
      "/api/admin/delete-post",
      "/api/admin/delete-comment",
      "/api/admin/community",
      "/api/admin/banned-word",
      "/api/admin/check-sources",
      "/api/admin/push-digest"
    ];
    for (const p of posts) {
      const res = await fetch(`${base}${p}`, { method: "POST", body: "{}" });
      assert.equal(res.status, 401, `${p} must be token-gated`);
    }
    // 틀린 토큰도 401
    const bad = await fetch(`${base}/api/admin/source-health`, { headers: { "x-admin-token": "wrong" } });
    assert.equal(bad.status, 401, "wrong token must be rejected");
    // 존재하지 않는 admin 하위 경로도 게이트 뒤에서만 404
    const unknown = await authed(base, "/api/admin/no-such-route");
    assert.equal(unknown.status, 404);
  });
});

test("admin: source-health는 레지스트리 전 소스에 대해 실측 liveCount·상태를 준다", async () => {
  await withServer(async (base) => {
    const res = await authed(base, "/api/admin/source-health");
    assert.equal(res.status, 200);
    const { sources } = await res.json();
    assert.ok(Array.isArray(sources), "sources is an array");

    const registry = loadRegistry();
    assert.equal(sources.length, registry.length, "one row per registry source");
    const byId = new Map(sources.map((s) => [s.id, s]));
    for (const c of registry) {
      const s = byId.get(c.id);
      assert.ok(s, `registry source ${c.id} present`);
      assert.equal(typeof s.label, "string");
      assert.equal(typeof s.enabled, "boolean");
      assert.equal(typeof s.disabled, "boolean");
      assert.equal(typeof s.seed, "boolean");
      assert.ok(Number.isFinite(s.liveCount) && s.liveCount >= 0, "liveCount is a real non-negative number");
    }
    // FEED_LIVE/FEED_DEV 없이 띄운 서버의 수집 풀은 비어 있다 — 실측이므로 전부 0건.
    // (가짜 수치를 만들어내지 않는다는 원칙 그 자체를 검증)
    for (const s of sources) assert.equal(s.liveCount, 0, `${s.id}: empty pool must report 0, not invented numbers`);
  });
});

test("admin: source-health의 disabled는 커뮤니티 전역 토글을 즉시 반영한다", async () => {
  await withServer(async (base) => {
    const registry = loadRegistry();
    const target = registry.find((c) => c.enabled === true);
    assert.ok(target, "fixture assumption: at least one enabled source");

    let res = await authed(base, "/api/admin/community", {
      method: "POST",
      body: JSON.stringify({ id: target.id, disabled: true })
    });
    assert.equal(res.status, 200);

    res = await authed(base, "/api/admin/source-health");
    const { sources } = await res.json();
    const row = sources.find((s) => s.id === target.id);
    assert.equal(row.disabled, true, "toggled source shows disabled=true");
  });
});

test("admin: traffic은 실측 일별 pv/feed/visitors를 준다 (없으면 빈 배열, 가짜 없음)", async () => {
  await withServer(async (base) => {
    // 트래픽이 하나도 없을 때: 빈 배열 (지어낸 날짜/수치 금지)
    let res = await authed(base, "/api/admin/traffic");
    assert.equal(res.status, 200);
    let { days } = await res.json();
    assert.deepEqual(days, [], "no traffic recorded -> empty, never fabricated");

    // 첫 화면 로드(pv) + 유저 생성 후 피드 요청(feed, 고유 방문자)
    await fetch(`${base}/`);
    await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "admin-test-user" })
    });
    await fetch(`${base}/api/feed?userId=admin-test-user`);

    res = await authed(base, "/api/admin/traffic?days=14");
    ({ days } = await res.json());
    assert.equal(days.length, 1, "one KST day bucket");
    const d = days[0];
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(d.pv, 1, "one page load counted");
    assert.equal(d.feed, 1, "one feed request counted");
    assert.equal(d.visitors, 1, "one unique visitor counted");
  });
});

test("admin: stats 응답에 대시보드 수익 패널이 쓰는 ads 실측 지표가 포함된다", async () => {
  await withServer(async (base) => {
    const res = await authed(base, "/api/admin/stats");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.stats && typeof body.stats.users === "number");
    assert.ok(body.ads, "ads block present");
    assert.equal(body.ads.impressions, 0, "no events -> measured 0");
    assert.equal(body.ads.clicks, 0);
    assert.equal(body.ads.ctr, 0);

    // 실제 광고 이벤트를 넣으면 그대로 집계되어야 한다
    await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "ad-user" })
    });
    for (const type of ["impression", "impression", "click"]) {
      const r = await fetch(`${base}/api/ad-signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "ad-user", itemId: "slot-1", type })
      });
      assert.equal(r.status, 200);
    }
    const after = await (await authed(base, "/api/admin/stats")).json();
    assert.equal(after.ads.impressions, 2);
    assert.equal(after.ads.clicks, 1);
    assert.equal(after.ads.ctr, 0.5);
  });
});

test("admin: 쿼리스트링 ?token= 으로도 게이트를 통과한다 (기존 동작 보존)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/admin/traffic?token=${TOKEN}`);
    assert.equal(res.status, 200);
  });
});

test("admin.html: 대시보드에 트래픽·수익·소스 헬스 패널이 있고 기존 조정 기능이 보존된다", () => {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "admin.html");
  const html = fs.readFileSync(p, "utf8");
  // 신규 패널
  assert.match(html, /트래픽 \(최근 14일/);
  assert.match(html, /api\/admin\/traffic/);
  assert.match(html, /api\/admin\/source-health/);
  assert.match(html, /소스 헬스/);
  assert.match(html, /수익/);
  assert.match(html, /데이터 없음/, "no-data states must say 데이터 없음, never fake charts");
  // 기존 조정 기능 보존 (갈아엎기 금지 검증)
  for (const kept of [
    "/api/admin/delete-post",
    "/api/admin/delete-comment",
    "/api/admin/banned-word",
    "/api/admin/community",
    "/api/admin/check-sources",
    'localStorage.getItem("admin_token")'
  ]) {
    assert.ok(html.includes(kept), `existing admin capability preserved: ${kept}`);
  }
});

test("광고 탭: 지어내지 않는다 — 없는 것은 없다고 말한다", async () => {
  // David 2026-08-05: "관리자에 광고 메뉴 신설해서 연결된 광고와 붙일 수 있는
  // 광고를 리스트로." 광고 화면은 돈을 판단하는 자리라 거짓 숫자 하나가 제일 비싸다.
  const { readWiredStatus, splitMeasured, ctr, CANDIDATE_NETWORKS } = await import("../src/feed/ad-networks.js");

  // 연결 여부는 환경변수가 실제로 있는지로만 판정한다
  const off = readWiredStatus({});
  assert.ok(off.every((n) => n.connected === false), "키가 없는데 연결됐다고 한다");
  assert.ok(off.every((n) => n.missingKeys.length > 0));

  const on = readWiredStatus({ ADSENSE_CLIENT: "ca-pub-1", ADFIT_UNIT_MOBILE: "DAN-x" });
  const adsense = on.find((n) => n.id === "adsense");
  const adfit = on.find((n) => n.id === "adfit");
  assert.equal(adsense.connected, true);
  // 애드핏은 승인 플래그가 따로 있다 — 키가 있어도 노출은 아니다
  assert.equal(adfit.connected, true);
  assert.equal(adfit.serving, false, "승인 플래그 없이 노출 중이라고 하면 안 된다");
  assert.equal(readWiredStatus({ ADFIT_UNIT_MOBILE: "DAN-x", ADFIT_ENABLED: "1" })
    .find((n) => n.id === "adfit").serving, true);

  // **시크릿 값은 응답에 담지 않는다** — 이름만
  const withSecrets = readWiredStatus({ COUPANG_ACCESS_KEY: "AK-비밀", COUPANG_SECRET_KEY: "SK-비밀" });
  assert.ok(!JSON.stringify(withSecrets).includes("AK-비밀"), "액세스 키가 화면으로 새어 나간다");
  assert.ok(!JSON.stringify(withSecrets).includes("SK-비밀"), "시크릿이 화면으로 새어 나간다");

  // 노출 0이면 클릭률은 0%가 아니라 "모름"이다
  assert.equal(ctr(0, 0), null, "노출 0을 0%로 쓰면 '성과 없음'으로 오독된다");
  assert.equal(ctr(100, 3), 3);

  const now = Date.now();
  const events = [
    { type: "impression", at: new Date(now - 1000).toISOString() },
    { type: "click", at: new Date(now - 2000).toISOString() },
    { type: "impression", at: new Date(now - 40 * 24 * 3600e3).toISOString() }  // 창 밖
  ];
  const day = splitMeasured(events, now - 24 * 3600e3);
  assert.equal(day.coupang.impressions, 1);
  assert.equal(day.coupang.clicks, 1);

  // 후보 목록은 요율을 적지 않는다 — 수시로 바뀌고 틀린 숫자가 더 비싸다
  const text = JSON.stringify(CANDIDATE_NETWORKS);
  assert.ok(!/\d+\s*%|\d+원/.test(text), `후보 목록에 요율·금액이 들어 있다: ${text.slice(0, 200)}`);
  assert.ok(CANDIDATE_NETWORKS.some((c) => c.id === "linkprice"), "링크프라이스가 목록에 없다");
});

test("광고 탭: 관리자 API가 실제로 응답한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "t-ads";
  const server = createServer({ sources: [{ id: "s", kind: "news", async fetch() { return []; } }] });
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${server.address().port}`;
    const res = await fetch(`${base}/api/admin/ads`, { headers: { "x-admin-token": "t-ads" } });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.ok(Array.isArray(j.wired) && j.wired.length >= 3);
    assert.ok(Array.isArray(j.candidates) && j.candidates.length >= 1);
    // 정산이 연동되지 않았다는 사실을 명시한다 — 0원으로 채우지 않는다
    assert.equal(j.revenue.connected, false);
    assert.ok(j.measured.scope.includes("콘솔"), "무엇까지 센 것인지 밝히지 않는다");
    // 토큰 없이는 못 본다
    assert.equal((await fetch(`${base}/api/admin/ads`)).status, 401);
  } finally { server.close(); process.env.ADMIN_TOKEN = prev; }
});
