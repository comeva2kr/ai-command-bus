// 검색 노출 배관 — RSS · IndexNow · 구조화 데이터 (2026-08-03).
// 목적은 하나다: 우리가 만든 자체 콘텐츠를 검색엔진이 빨리, 정확히 읽게 하는 것.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { makeIndexNow } from "../src/feed/indexnow.js";

async function withServer(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    for (const k of Object.keys(env)) {
      if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

test("RSS: 유효한 피드를 내고 외부 원문 본문을 싣지 않는다", async () => {
  // 네이버는 사이트맵과 별개로 RSS를 받아 새 글을 훨씬 빨리 수집한다.
  // 단 RSS에 외부 원문을 실으면 저작권 문제이자, 애드핏이 지적한 "외부 콘텐츠
  // 비중"을 스스로 키우는 짓이다 — 우리가 쓴 문장과 실측 지표만 싣는다.
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/rss.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /rss\+xml/);
    const xml = await res.text();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<rss version="2\.0">/);
    assert.match(xml, /<\/rss>\s*$/);
    assert.match(xml, /<title>지금핫 NowHot/);
    assert.match(xml, /<language>ko<\/language>/);
  });
});

test("IndexNow: 키가 없으면 아무 일도 하지 않는다", async () => {
  // 설정이 없는 배포에서 외부로 요청이 나가면 안 된다.
  let called = false;
  const inx = makeIndexNow({ key: null, host: "nowhot.kr", fetchImpl: async () => { called = true; } });
  const out = await inx.ping(["/"]);
  assert.equal(called, false);
  assert.ok(out.skipped, "설정 없으면 skip이어야 한다");
});

test("IndexNow: 키 파일은 키가 있을 때만 서빙된다 (소유 증명)", async () => {
  await withServer({ INDEXNOW_KEY: null }, async (base) => {
    assert.equal((await fetch(`${base}/abc.txt`)).status, 404);
  });
  await withServer({ INDEXNOW_KEY: "abc" }, async (base) => {
    const res = await fetch(`${base}/abc.txt`);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), "abc", "파일 내용이 키와 같아야 소유가 증명된다");
  });
});

test("IndexNow: 같은 URL을 과도하게 통보하지 않는다 (스팸 취급 방지)", async () => {
  const sent = [];
  let t = 0;
  const inx = makeIndexNow({
    key: "k", host: "nowhot.kr", clock: () => t,
    fetchImpl: async (_u, opt) => { sent.push(JSON.parse(opt.body).urlList); return { ok: true, status: 200 }; }
  });
  await inx.ping(["/briefing"]);
  await inx.ping(["/briefing"]);          // 곧바로 다시 — 눌려야 한다
  assert.equal(sent.length, 1, "간격 안에 두 번 보내면 안 된다");
  t += 7 * 3600 * 1000;                   // 6시간 지나면 다시 허용
  await inx.ping(["/briefing"]);
  assert.equal(sent.length, 2);
});

test("IndexNow: 통보 실패가 서비스를 죽이지 않는다", async () => {
  const inx = makeIndexNow({
    key: "k", host: "nowhot.kr", log: { error: () => {} },
    fetchImpl: async () => { throw new Error("network down"); }
  });
  const out = await inx.ping(["/only-once-" + Math.random()]);
  assert.ok(out.error, "실패는 값으로 돌려주고 던지지 않는다");
});

test("구조화 데이터: 홈과 자체 콘텐츠 페이지에 JSON-LD가 있고 파싱된다", async () => {
  const home = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
  const m = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "홈에 JSON-LD가 있어야 한다");
  const ld = JSON.parse(m[1]);
  assert.equal(ld["@type"], "WebSite");
  assert.equal(ld.inLanguage, "ko");
  // 사실과 다른 선언은 리치 결과에서 제외된다 — 실제 도메인·운영 주체를 쓴다
  assert.equal(ld.url, "https://nowhot.kr/");
  assert.equal(ld.publisher.name, "페퍼클럽");

  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/briefing`)).text();
    const mm = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(mm, "자체 콘텐츠 페이지에도 JSON-LD가 있어야 한다");
    const j = JSON.parse(mm[1]);
    assert.equal(j["@type"], "CollectionPage");
    assert.ok(j.name && j.description, "제목·설명이 채워져야 한다");
  });
});

test("RSS 위치를 robots와 각 페이지 head가 알린다", async () => {
  await withServer({}, async (base) => {
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.ok(robots.includes("/rss.xml"), "robots가 RSS를 알려야 한다");
    const html = await (await fetch(`${base}/briefing`)).text();
    assert.match(html, /rel="alternate" type="application\/rss\+xml"/);
  });
  const home = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
  assert.match(home, /rel="alternate" type="application\/rss\+xml"/);
});

test("자체 콘텐츠 페이지가 서로 링크된다 (고아 페이지 방지)", async () => {
  // 실측 2026-08-03: sitemap에 카테고리 브리핑 10개가 있는데 **어디서도
  // 링크되지 않는 고아 페이지**였다. 구글은 내부 링크로 발견 가능한지를
  // 중요하게 보고, 링크 없는 페이지는 색인 우선순위가 낮다. 사용자 쪽으로도
  // 검색 유입이 다음 페이지로 넘어갈 통로가 없으면 한 장 보고 나간다.
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/briefing`)).text();
    assert.match(html, /class="own-links"/, "상호 링크 영역이 있어야 한다");
    const cats = [...html.matchAll(/href="\/briefing\/([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(cats.length >= 5, `카테고리 브리핑 링크가 부족: ${cats.length}개`);
    // 자기 자신은 링크하지 않는다
    assert.ok(!html.includes('<li><a href="/briefing">'), "현재 페이지를 자기 자신에게 링크하면 안 된다");
    // 다른 자체 콘텐츠로도 이어져야 한다
    assert.match(html, /href="\/ranking\/daily"/);
    assert.match(html, /href="\/trends"/);
  });
});

test("랭킹 페이지가 구간별 h2 섹션으로 나뉜다", async () => {
  // 구글 가이드: "긴 콘텐츠를 단락과 섹션으로 나누고 사용자가 페이지를
  // 탐색하는 데 도움이 되는 제목을 제공". 실측에서 랭킹은 h1 하나 아래
  // 20개가 통째로 있어 h2가 0개였다(브리핑은 19개).
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  assert.match(src, /RANK_BANDS/, "구간 정의가 있어야 한다");
  assert.match(src, /<section><h2>\$\{escapeHtml\(b\.label\)\}<\/h2>/);
  // 순위 번호가 구간을 넘어가도 이어져야 한다 (6위가 다시 1로 보이면 안 된다)
  assert.match(src, /start="\$\{b\.from\}"/, "ol start로 번호를 이어야 한다");
  assert.match(src, /rankRow\(i, b\.from \+ k\)/);
});

test("카드 썸네일에 설명 alt가 붙는다 (네이버 가이드)", async () => {
  // 네이버 가이드: "이미지에는 alt 속성을 부여해 내용을 설명해야 한다".
  // 빈 alt("")는 '장식 이미지' 선언이라 내용 설명이 아니다.
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
  const thumb = html.slice(html.indexOf("function cardThumbHtml"), html.indexOf("function cardThumbHtml") + 700);
  assert.match(thumb, /alt="\$\{escapeHtml\(item\.title\)\}/, "제목을 alt에 넣어야 한다");
  assert.doesNotMatch(thumb, /alt=""/, "빈 alt로 되돌아가면 안 된다");
});
