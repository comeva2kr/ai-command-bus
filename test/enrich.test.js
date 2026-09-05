// 썸네일 보강(enrich.js) — og:image/twitter:image 추출, 조용한 실패, 캐시(TTL+부정캐시).
import test from "node:test";
import assert from "node:assert/strict";

import { cleanArticleTextChrome, extractOgImage, extractOgDesc, fetchOgImage, fetchOgMeta, fetchPublicArticle, isJunkImage, makeEnricher } from "../src/feed/enrich.js";

// ---- extractOgImage --------------------------------------------------------

test("extractOgImage: og:image 기본 매치", () => {
  const html = `<html><head><meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>`;
  assert.equal(extractOgImage(html, "https://example.com/post/1"), "https://cdn.example.com/a.jpg");
});

test("extractOgImage: 속성 순서가 뒤바뀐 경우(content가 property보다 앞)도 매치", () => {
  const html = `<meta content="https://cdn.example.com/b.jpg" property="og:image">`;
  assert.equal(extractOgImage(html, "https://example.com/"), "https://cdn.example.com/b.jpg");
});

test("extractOgImage: og:image 없으면 og:image:secure_url로 폴백", () => {
  const html = `<meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">`;
  assert.equal(extractOgImage(html, "https://example.com/"), "https://cdn.example.com/secure.jpg");
});

test("extractOgImage: og 계열 전부 없으면 twitter:image로 폴백", () => {
  const html = `<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">`;
  assert.equal(extractOgImage(html, "https://example.com/"), "https://cdn.example.com/tw.jpg");
});

test("extractOgImage: twitter:image도 없으면 twitter:image:src로 폴백", () => {
  const html = `<meta name="twitter:image:src" content="https://cdn.example.com/tw-src.jpg">`;
  assert.equal(extractOgImage(html, "https://example.com/"), "https://cdn.example.com/tw-src.jpg");
});

test("extractOgImage: 우선순위 — og:image가 twitter:image보다 먼저 채택된다", () => {
  const html = `
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
  `;
  assert.equal(extractOgImage(html, "https://example.com/"), "https://cdn.example.com/og.jpg");
});

test("extractOgImage: 상대 URL은 baseUrl 기준으로 절대화", () => {
  const html = `<meta property="og:image" content="/img/thumb.jpg">`;
  assert.equal(
    extractOgImage(html, "https://example.com/news/123"),
    "https://example.com/img/thumb.jpg"
  );
});

test("extractOgImage: HTML 엔티티(&amp;) 디코드", () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/img.jpg?a=1&amp;b=2">`;
  assert.equal(
    extractOgImage(html, "https://example.com/"),
    "https://cdn.example.com/img.jpg?a=1&b=2"
  );
});

test("extractOgImage: http(s)가 아닌 URL(data:)은 null", () => {
  const html = `<meta property="og:image" content="data:image/png;base64,AAAA">`;
  assert.equal(extractOgImage(html, "https://example.com/"), null);
});

test("extractOgImage: 매치되는 메타 태그가 없으면 null", () => {
  const html = `<html><head><title>제목만 있음</title></head></html>`;
  assert.equal(extractOgImage(html, "https://example.com/"), null);
});

test("extractOgImage: html이 비어있으면 null", () => {
  assert.equal(extractOgImage("", "https://example.com/"), null);
  assert.equal(extractOgImage(null, "https://example.com/"), null);
});

test("Google 뉴스 중계 플레이스홀더는 기사 대표 이미지로 쓰지 않는다", () => {
  assert.equal(isJunkImage(new URL("https://lh3.googleusercontent.com/J6_placeholder=s0-w300")), true);
  assert.equal(isJunkImage(new URL("https://image.bobaedream.co.kr/mobile/iphone/common/headTitle.png")), true);
  assert.equal(isJunkImage(new URL("https://www.ytn.co.kr/img/comm/ytn_sns_default.jpg")), true);
  assert.equal(isJunkImage(new URL("https://static.hankyung.com/img/logo/logo-news-sns.png")), true);
  assert.equal(isJunkImage(new URL("https://theqoo.net/modules/board/skins/sketchbook5_ajax/img/kakao_theqoo.png")), true);
  assert.equal(isJunkImage(new URL("https://www.todayhumor.co.kr/board/images/search_S.png")), true);
  assert.equal(isJunkImage(new URL("https://static.hankyung.com/img/common/spinner/spinner.svg")), true);
  assert.equal(isJunkImage(new URL("https://cdn.example.com/news/photo.jpg")), false);
});

// ---- fetchOgImage -----------------------------------------------------------

function mockRes({ ok = true, status = 200, contentType = "text/html; charset=utf-8", body = "", url } = {}) {
  return {
    ok,
    status,
    url,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body
  };
}

test("fetchOgImage: html 200 성공 시 og:image URL을 반환", async () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/hit.jpg">`;
  const fetchImpl = async (url) => mockRes({ body: html, url });
  const result = await fetchOgImage("https://example.com/post/1", { fetchImpl });
  assert.equal(result, "https://cdn.example.com/hit.jpg");
});

test("fetchOgImage: content-type이 image/png면 null (og 파싱 안 함)", async () => {
  const fetchImpl = async () => mockRes({ contentType: "image/png", body: "" });
  const result = await fetchOgImage("https://example.com/photo.png", { fetchImpl });
  assert.equal(result, null);
});

test("fetchOgImage: 403이면 조용히 null", async () => {
  const fetchImpl = async () => mockRes({ ok: false, status: 403 });
  const result = await fetchOgImage("https://example.com/blocked", { fetchImpl });
  assert.equal(result, null);
});

test("fetchOgImage: 404면 조용히 null", async () => {
  const fetchImpl = async () => mockRes({ ok: false, status: 404 });
  const result = await fetchOgImage("https://example.com/missing", { fetchImpl });
  assert.equal(result, null);
});

test("fetchOgImage: fetchImpl이 throw(네트워크 오류/타임아웃)해도 조용히 null", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await fetchOgImage("https://example.com/down", { fetchImpl });
  assert.equal(result, null);
});

test("fetchOgImage: 리다이렉트 최종 URL(res.url)을 baseUrl로 사용해 상대 og:image를 절대화", async () => {
  const html = `<meta property="og:image" content="/img/final.jpg">`;
  const fetchImpl = async () => mockRes({ body: html, url: "https://publisher.example.com/article/9" });
  const result = await fetchOgImage("https://redirect.example.com/articles/xyz", { fetchImpl });
  assert.equal(result, "https://publisher.example.com/img/final.jpg");
});

// ---- makeEnricher -------------------------------------------------------

function makeFetchImplWithLog(imageByUrl) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const image = imageByUrl.get(url);
    if (image === undefined) return mockRes({ ok: false, status: 404 });
    const html = `<meta property="og:image" content="${image}">`;
    return mockRes({ body: html, url });
  };
  return { fetchImpl, calls };
}

test("makeEnricher: image와 summary가 모두 있는 아이템은 시도하지 않는다", async () => {
  const { fetchImpl, calls } = makeFetchImplWithLog(
    new Map([["https://a.example.com/1", "https://cdn.example.com/1.jpg"]])
  );
  const enricher = makeEnricher({ fetchImpl });
  const items = [
    { url: "https://a.example.com/1", image: null, summary: "" },
    { url: "https://a.example.com/2", image: "https://already.example.com/x.jpg", summary: "이미 발췌가 있는 글" }
  ];
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 1);
  assert.equal(filled, 1);
  assert.deepEqual(calls, ["https://a.example.com/1"]);
  assert.equal(items[0].image, "https://cdn.example.com/1.jpg");
  assert.equal(items[1].image, "https://already.example.com/x.jpg"); // 그대로 유지
});

test("makeEnricher: url이 http(s)가 아니면 시도 대상에서 제외", async () => {
  const { fetchImpl, calls } = makeFetchImplWithLog(new Map());
  const enricher = makeEnricher({ fetchImpl });
  const items = [{ url: "ftp://a.example.com/1", image: null }, { url: "not-a-url", image: "" }];
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 0);
  assert.equal(filled, 0);
  assert.deepEqual(calls, []);
});

test("makeEnricher: maxPerCycle 상한을 넘지 않는다", async () => {
  const imageByUrl = new Map();
  const items = [];
  for (let i = 0; i < 30; i++) {
    const url = `https://a.example.com/${i}`;
    imageByUrl.set(url, `https://cdn.example.com/${i}.jpg`);
    items.push({ url, image: null });
  }
  const { fetchImpl, calls } = makeFetchImplWithLog(imageByUrl);
  const enricher = makeEnricher({ fetchImpl, maxPerCycle: 20, concurrency: 5 });
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 20);
  assert.equal(filled, 20);
  assert.equal(calls.length, 20);
  const stillMissing = items.filter((it) => !it.image);
  assert.equal(stillMissing.length, 10); // maxPerCycle 넘긴 나머지는 이번 사이클엔 안 채워짐
});

test("makeEnricher: 부정 캐시 — 실패한 URL은 TTL 안에서 두 번째 enrich에서 fetch 재호출 안 됨", async () => {
  const { fetchImpl, calls } = makeFetchImplWithLog(new Map()); // 항상 404 -> null
  let now = 1_000_000;
  const enricher = makeEnricher({ fetchImpl, negativeTtlMs: 3600 * 1000, clock: () => now });
  const items1 = [{ url: "https://a.example.com/fail", image: null }];
  const r1 = await enricher.enrich(items1);
  assert.equal(r1.attempted, 1);
  assert.equal(r1.filled, 0);
  assert.equal(calls.length, 1);

  const items2 = [{ url: "https://a.example.com/fail", image: null }];
  now += 10_000; // TTL(1시간) 안쪽
  const r2 = await enricher.enrich(items2);
  // 2026-08-01 의미 변경: attempted는 이제 **네트워크 시도 수**다(캐시 히트는
  // 사이클 상한과 무관하게 전량 적용되므로 여기 포함되지 않는다). 이 테스트의
  // 본질인 "재요청 없음"은 calls.length로 그대로 고정된다.
  assert.equal(r2.attempted, 0, "캐시 히트는 네트워크 시도가 아니다");
  assert.equal(r2.filled, 0);
  assert.equal(calls.length, 1, "부정 캐시 TTL 안에서는 fetch가 다시 불리면 안 됨");
});

test("makeEnricher: 성공 캐시도 TTL 안에서는 fetch 없이 즉시 적용된다", async () => {
  const { fetchImpl, calls } = makeFetchImplWithLog(
    new Map([["https://a.example.com/ok", "https://cdn.example.com/ok.jpg"]])
  );
  let now = 1_000_000;
  const enricher = makeEnricher({ fetchImpl, ttlMs: 6 * 3600 * 1000, clock: () => now });

  const r1 = await enricher.enrich([{ url: "https://a.example.com/ok", image: null }]);
  assert.equal(r1.filled, 1);
  assert.equal(calls.length, 1);

  now += 60_000;
  const items2 = [{ url: "https://a.example.com/ok", image: null }];
  const r2 = await enricher.enrich(items2);
  assert.equal(r2.filled, 1);
  assert.equal(items2[0].image, "https://cdn.example.com/ok.jpg");
  assert.equal(calls.length, 1, "캐시 히트는 fetch를 다시 호출하지 않아야 함");
});

test("makeEnricher: TTL 만료 후에는 재시도한다(clock 주입)", async () => {
  const { fetchImpl, calls } = makeFetchImplWithLog(new Map()); // 계속 404 -> null (부정 캐시 대상)
  let now = 1_000_000;
  const negativeTtlMs = 1000;
  const enricher = makeEnricher({ fetchImpl, negativeTtlMs, clock: () => now });

  await enricher.enrich([{ url: "https://a.example.com/retry", image: null }]);
  assert.equal(calls.length, 1);

  now += negativeTtlMs + 1; // 부정 캐시 만료
  await enricher.enrich([{ url: "https://a.example.com/retry", image: null }]);
  assert.equal(calls.length, 2, "TTL 만료 후에는 다시 fetch를 시도해야 함");
});

test("makeEnricher: cacheSize()는 캐시에 쌓인 URL 수를 반환한다", async () => {
  const { fetchImpl } = makeFetchImplWithLog(
    new Map([["https://a.example.com/1", "https://cdn.example.com/1.jpg"]])
  );
  const enricher = makeEnricher({ fetchImpl });
  assert.equal(enricher.cacheSize(), 0);
  await enricher.enrich([
    { url: "https://a.example.com/1", image: null },
    { url: "https://a.example.com/2", image: null } // 404 -> 부정 캐시로도 카운트
  ]);
  assert.equal(enricher.cacheSize(), 2);
});

test("makeEnricher: attempted/filled은 성공·실패를 정확히 센다", async () => {
  const { fetchImpl } = makeFetchImplWithLog(
    new Map([
      ["https://a.example.com/ok1", "https://cdn.example.com/ok1.jpg"],
      ["https://a.example.com/ok2", "https://cdn.example.com/ok2.jpg"]
    ])
  );
  const enricher = makeEnricher({ fetchImpl });
  const items = [
    { url: "https://a.example.com/ok1", image: null },
    { url: "https://a.example.com/ok2", image: null },
    { url: "https://a.example.com/fail1", image: null },
    { url: "https://a.example.com/fail2", image: null }
  ];
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 4);
  assert.equal(filled, 2);
});

// ---- 발췌(og:description) 확장 — David 2026-07-31 "상세창에 무조건 발췌" ----

test("extractOgDesc: og:description 기본 매치 + 공백 정리", () => {
  const html = `<meta property="og:description" content="서초구가  몽마르뜨공원과\n우면생태놀이터를 새단장한다고 밝혔다.">`;
  assert.equal(extractOgDesc(html), "서초구가 몽마르뜨공원과 우면생태놀이터를 새단장한다고 밝혔다.");
});

test("extractOgDesc: og가 없으면 meta description 폴백, 200자 컷", () => {
  const long = "가".repeat(300);
  const html = `<meta name="description" content="${long}">`;
  const out = extractOgDesc(html);
  assert.ok(out.length <= 200, `발췌 상한 200자 초과: ${out.length}`);
  assert.ok(out.endsWith("…"));
});

test("extractOgDesc: 사이트명 수준 초단문은 발췌가 아니다 — null", () => {
  assert.equal(extractOgDesc(`<meta property="og:description" content="네이트 뉴스">`), null);
  assert.equal(extractOgDesc(`<div>메타 없음</div>`), null);
});

test("fetchOgMeta: 한 번의 fetch로 image와 desc를 함께 뽑는다", async () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/x.jpg">
    <meta property="og:description" content="충분히 긴 진짜 기사 요약문이 여기에 들어있다.">`;
  const fetchImpl = async (url) => mockRes({ body: html, url });
  const meta = await fetchOgMeta("https://a.example.com/1", { fetchImpl });
  assert.equal(meta.image, "https://cdn.example.com/x.jpg");
  assert.equal(meta.desc, "충분히 긴 진짜 기사 요약문이 여기에 들어있다.");
});

test("makeEnricher: summary가 빈 아이템에 desc를 채운다 (이미지 있어도 후보)", async () => {
  const html = `<meta property="og:description" content="커뮤니티 글의 원문 페이지가 공개한 요약 메타데이터.">`;
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return mockRes({ body: html, url }); };
  const enricher = makeEnricher({ fetchImpl });
  const items = [{ url: "https://c.example.com/1", image: "https://cdn.example.com/has.jpg", summary: "" }];
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 1);
  assert.equal(filled, 1);
  assert.equal(items[0].summary, "커뮤니티 글의 원문 페이지가 공개한 요약 메타데이터.");
  assert.equal(items[0].image, "https://cdn.example.com/has.jpg", "기존 이미지는 유지");
});

test("makeEnricher: desc가 제목의 단순 복제면 발췌로 쓰지 않는다", async () => {
  const title = "제목과 완전히 동일한 설명문이 내려오는 페이지";
  const html = `<meta property="og:description" content="${title}">`;
  const fetchImpl = async (url) => mockRes({ body: html, url });
  const enricher = makeEnricher({ fetchImpl });
  const items = [{ url: "https://d.example.com/1", image: null, summary: "", title }];
  const { filled } = await enricher.enrich(items);
  assert.equal(filled, 0);
  assert.equal(items[0].summary, "");
});

// ---- 이미지 수집률 확장 (David 2026-08-01 "모든 글에서 첫 사진·영상 썸네일") ----

test("extractOgImage: og/twitter가 없으면 유튜브 임베드 썸네일로 폴백", () => {
  const html = `<div><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"></iframe></div>`;
  assert.equal(extractOgImage(html, "https://c.example.com/1"),
    "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

test("extractOgImage: 메타도 영상도 없으면 본문 첫 사진, 로고·작은 이미지는 건너뛴다", () => {
  const html = `<img src="/img/logo.png" width="120" height="40">
    <img src="/skin/icon_new.gif">
    <img src="/data/editor/photo1.jpg" width="800" height="600">`;
  assert.equal(extractOgImage(html, "https://b.example.com/post/1"),
    "https://b.example.com/data/editor/photo1.jpg");
});

test("extractOgImage: og:image가 있으면 폴백보다 우선", () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/og.jpg">
    <img src="/data/photo.jpg" width="800">`;
  assert.equal(extractOgImage(html, "https://b.example.com/"), "https://cdn.example.com/og.jpg");
});

test("extractOgImage: data: URL과 1x1 추적픽셀은 대표 이미지가 아니다", () => {
  const html = `<img src="data:image/png;base64,AAA"><img src="/t/1x1.gif">`;
  assert.equal(extractOgImage(html, "https://b.example.com/"), null);
});

test("makeEnricher: 캐시 히트는 사이클 상한과 무관하게 전량 적용된다 (커버리지 정체 버그)", async () => {
  // 실측 버그(2026-08-01): 캐시 히트가 maxPerCycle에 포함돼, 사이클마다 같은
  // 120건만 갱신되고 나머지는 계속 이미지가 비어 있었다.
  const imageByUrl = new Map();
  const items = [];
  for (let i = 0; i < 10; i++) {
    const url = `https://c.example.com/${i}`;
    imageByUrl.set(url, `https://cdn.example.com/${i}.jpg`);
    items.push({ url, image: null, summary: "" });
  }
  const { fetchImpl, calls } = makeFetchImplWithLog(imageByUrl);
  const enricher = makeEnricher({ fetchImpl, maxPerCycle: 3 });

  await enricher.enrich(items);                      // 3건만 네트워크
  assert.equal(calls.length, 3);
  const filledFirst = items.filter((i) => i.image).length;
  assert.equal(filledFirst, 3);

  // 다음 사이클: 아이템 객체가 새로 만들어져도(수집 교체 상황) 캐시로 즉시 복구
  const fresh = items.map((i) => ({ url: i.url, image: null, summary: "" }));
  const r2 = await enricher.enrich(fresh);
  assert.equal(r2.attempted, 3, "네트워크는 여전히 상한만큼만");
  assert.equal(fresh.filter((i) => i.image).length, 6, "캐시 3 + 신규 3 = 6건 채워져야");
});

test("makeEnricher: 캐시가 재시작을 넘어 복구된다 (배포마다 이미지가 날아가던 버그)", async () => {
  const imageByUrl = new Map([["https://p.example.com/1", "https://cdn.example.com/p1.jpg"]]);
  const { fetchImpl, calls } = makeFetchImplWithLog(imageByUrl);
  let saved = null;
  const e1 = makeEnricher({ fetchImpl, onPersist: (entries) => { saved = entries; } });
  const items1 = [{ url: "https://p.example.com/1", image: null, summary: "" }];
  await e1.enrich(items1);
  assert.equal(items1[0].image, "https://cdn.example.com/p1.jpg");
  assert.equal(calls.length, 1);
  assert.ok(saved && saved["https://p.example.com/1"], "캐시가 저장 훅으로 전달돼야");

  // 재시작: 새 enricher가 저장된 캐시를 안고 시작 — 네트워크 없이 즉시 복구
  const e2 = makeEnricher({ fetchImpl, initialCache: saved });
  const items2 = [{ url: "https://p.example.com/1", image: null, summary: "" }];
  await e2.enrich(items2);
  assert.equal(items2[0].image, "https://cdn.example.com/p1.jpg", "재시작 후에도 이미지 복구");
  assert.equal(calls.length, 1, "재시작 복구는 네트워크를 쓰지 않는다");
});

// ---- transient public article ------------------------------------------------

function streamRes({ ok = true, status = 200, contentType = "text/html; charset=utf-8", body = "", url, location = null } = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok,
    status,
    url,
    headers: { get: (k) => k.toLowerCase() === "content-type" ? contentType : k.toLowerCase() === "location" ? location : null },
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    text: async () => { throw new Error("article fetch must not call response.text()"); }
  };
}

test("fetchPublicArticle: JSON-LD articleBody를 우선하고 OG 이미지와 최종 URL만 반환", async () => {
  const articleBody = "가".repeat(260) + " JSON-LD 본문 끝";
  const html = `<meta property="og:image" content="/cover.jpg"><script type="application/ld+json">{"@type":"NewsArticle","articleBody":"${articleBody}"}</script><article>다른 본문</article>`;
  const result = await fetchPublicArticle("https://source.example.com/start", {
    fetchImpl: async () => streamRes({ body: html, url: "https://publisher.example.com/final" })
  });
  assert.deepEqual(result, {
    state: "available",
    text: articleBody,
    image: "https://publisher.example.com/cover.jpg",
    finalUrl: "https://publisher.example.com/final"
  });
});

test("fetchPublicArticle: 표준 articleBody 요소의 중첩 태그를 포함한 본문을 읽는다", async () => {
  const intro = "도널드 트럼프 미국 대통령이 한미연합훈련 관련 게시물을 다시 올렸습니다. ";
  const detail = "게시물의 표현과 후속 반응을 설명하는 공개 기사 본문입니다. ".repeat(12);
  const html = `<div class="page"><div id="articleBody" itemprop="articleBody"><div class="photo">사진 설명</div><br>${intro}<br><div><p>${detail}</p></div></div><aside>관련 기사</aside></div>`;
  const result = await fetchPublicArticle("https://publisher.example.com/news/1", {
    fetchImpl: async () => streamRes({ body: html })
  });
  assert.equal(result.state, "available");
  assert.match(result.text, /도널드 트럼프/);
  assert.match(result.text, /후속 반응/);
  assert.ok(!result.text.includes("관련 기사"));
});

test("fetchPublicArticle: article 우선, 없으면 문단 폴백이며 장식 태그는 본문에 남기지 않는다", async () => {
  const articleText = "기사 문단 ".repeat(60);
  const fallbackText = "문단 폴백 ".repeat(60);
  const article = await fetchPublicArticle("https://example.com/article", {
    fetchImpl: async () => streamRes({ body: `<article><nav>메뉴</nav><p>${articleText}</p><script>비밀</script></article><main><p>${fallbackText}</p></main>` })
  });
  assert.equal(article.state, "available");
  assert.equal(article.text, articleText.trim());
  assert.ok(!article.text.includes("메뉴") && !article.text.includes("비밀"));

  const fallback = await fetchPublicArticle("https://example.com/fallback", {
    fetchImpl: async () => streamRes({ body: `<header>머리말</header><p>${fallbackText}</p><footer>꼬리말</footer>` })
  });
  assert.equal(fallback.state, "available");
  assert.equal(fallback.text, fallbackText.trim());
});

test("fetchPublicArticle: 기사 안의 이미지 크레딧·메타데이터·관련기사 블록은 본문에서 제외한다", async () => {
  const body = "정부 발표와 현장 반응을 함께 설명하는 실제 공개 기사 본문입니다. ".repeat(14);
  const html = `<article>
    <h1>기사 제목</h1>
    <figure><img src="/cover.jpg"><figcaption>Image source, Getty Images</figcaption></figure>
    <div data-block="metadata"><span>Published</span><time>2026년 8월 26일</time><span>Mark Savage Music 특파원 작성</span></div>
    <p>${body}</p>
    <div data-block="links"><ul><li><p>관련 기사 제목</p><span>10시간 전 공개됨</span></li></ul></div>
    <p>기사의 마지막 본문 문장입니다.</p>
  </article>`;
  const result = await fetchPublicArticle("https://publisher.example.com/news/clean", {
    fetchImpl: async () => streamRes({ body: html })
  });
  assert.equal(result.state, "available");
  assert.match(result.text, /실제 공개 기사 본문/);
  assert.match(result.text, /마지막 본문 문장/);
  for (const noise of ["Getty Images", "특파원 작성", "관련 기사 제목", "10시간 전 공개됨"]) {
    assert.ok(!result.text.includes(noise), noise);
  }
});

test("fetchPublicArticle: 공개 본문이 짧으면 사진과 최종 URL을 보존하고 장문 요약 불가를 구분한다", async () => {
  const result = await fetchPublicArticle("https://community.example.com/post", {
    fetchImpl: async () => streamRes({
      body: `<meta property="og:image" content="/deal.jpg"><p>가격과 배송 조건만 적힌 짧은 게시글입니다.</p>`,
      url: "https://community.example.com/post"
    })
  });
  assert.deepEqual(result, {
    state: "unavailable",
    reasonCode: "PUBLIC_BODY_TOO_SHORT",
    httpStatus: 200,
    image: "https://community.example.com/deal.jpg",
    finalUrl: "https://community.example.com/post"
  });
});

test("fetchPublicArticle: 짧은 article 뒤 사이트 푸터를 붙여 장문 본문으로 오인하지 않는다", async () => {
  const article = "공개 게시글의 실제 내용은 짧습니다. ".repeat(5);
  const footer = "이용약관 개인정보처리방침 문의 신고 저작권 안내 ".repeat(20);
  const result = await fetchPublicArticle("https://community.example.com/post", {
    fetchImpl: async () => streamRes({
      body: `<article itemprop="articleBody"><p>${article}</p></article><footer><p>${footer}</p></footer>`,
      url: "https://community.example.com/post"
    })
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "PUBLIC_BODY_TOO_SHORT");
});

test("fetchPublicArticle: main 안의 게시판 메뉴·로그인·사업자 정보를 본문으로 오인하지 않는다", async () => {
  const chrome = `게시판 > 베스트글 목록 이전페이지 맨위로
    댓글 작성을 위해 로그인하세요. 회원가입 고객센터
    이용약관 개인정보처리방침 사업자등록번호: 123-45-67890
    통신판매업신고번호: 2026-서울-0001 Copyright © Example`;
  const result = await fetchPublicArticle("https://community.example.com/post", {
    fetchImpl: async () => streamRes({
      body: `<meta property="og:image" content="/post.jpg"><main><p>${chrome.repeat(4)}</p></main>`,
      url: "https://community.example.com/post"
    })
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "NO_PUBLIC_BODY");
  assert.equal(result.image, "https://community.example.com/post.jpg");
});

test("fetchPublicArticle: 오늘의 HIT 목록을 개별 게시글 본문으로 오인하지 않는다", async () => {
  const hitList = `🔥오늘의 HIT 30 종합 유머 연예 생활 시사 이슈
    1 산후우울증의 위험성 (140) 2 현대차 신형 아반떼 직진불가 이슈 (96)
    3 네팔 홍수 시뮬레이션 (28) 4 항암치료를 권하지 않는 이유.jpg (41) `.repeat(8);
  const result = await fetchPublicArticle("https://community.example.com/post", {
    fetchImpl: async () => streamRes({
      body: `<meta property="og:image" content="/post.jpg"><main><p>${hitList}</p></main>`,
      url: "https://community.example.com/post"
    })
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "NO_PUBLIC_BODY");
});

test("cleanArticleTextChrome: 한겨레·KBS·YTN 본문 앞 UI만 제거하고 기사 내용은 유지한다", () => {
  assert.equal(
    cleanArticleTextChrome("본문 경제 기사 제목 기자 수정 2026-08-27 펼침 0:00 Your browser does not support the audio element. 구글 선호 매체 등록 광고 실제 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 기사 첫 문장입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("기사 본문 영역 '; rptHeader += ' 뉴스 기사 제목 입력 2026.08.27 읽어주기 기능은 크롬기반의 브라우저에서만 사용하실 수 있습니다. AI 요약 정부 발표의 핵심 내용입니다. 후속 내용입니다."),
    "정부 발표의 핵심 내용입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("TV 기사 제목 기자 2026-08-26 --> 가 --> 가 가 --> 가 가 가 가 가 --> 실제 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 기사 첫 문장입니다. 후속 내용입니다."
  );
});

test("cleanArticleTextChrome: 동아·뉴데일리·다음·서울·연합계열 UI를 걷고 첫 기사 문장부터 남긴다", () => {
  assert.equal(
    cleanArticleTextChrome("기사 제목 동아일보 입력 2026-08-27 15:02 구글검색 선호 추가 코멘트 개 공유하기 URL 복사 글자크기 설정 가 가 가 프린트 구독 실제 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 기사 첫 문장입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("이미지 크게보기 ▲ ⓒ새마을금고중앙회 photo big--> 실제 금융 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 금융 기사 첫 문장입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("선수 기사 기자 2026. 8. 27. 13:55 요약보기 자동요약 기사 제목과 주요 문장을 기반으로 자동요약한 결과입니다. 전체 맥락을 이해하기 위해서는 본문 보기를 권장합니다. 실제 경기 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 경기 기사 첫 문장입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("생활 기사 기사 소리로 듣기 다시듣기 글씨 크기 조절 공유하기 URL 복사 댓글 0 김민지 기자 수정 2026-08-27 15:21 입력 2026-08-27 15:21 구글에서 서울신문 먼저 보기 실제 생활 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 생활 기사 첫 문장입니다. 후속 내용입니다."
  );
  assert.equal(
    cleanArticleTextChrome("사회 사회일반 기사 제목 연합뉴스 입력 2026.08.27 13:31 수정 2026.08.27 13:43 구글 검색 선호 매체 추가 실제 사회 기사 첫 문장입니다. 후속 내용입니다."),
    "실제 사회 기사 첫 문장입니다. 후속 내용입니다."
  );
});

test("cleanArticleTextChrome: 짧은 기사 뒤 음성·공유·제보·저작권 UI도 자르고 본문만 남긴다", () => {
  const article = "실제 기사 첫 문장입니다. ".repeat(8).trim();
  for (const tail of [
    "닫기 음성으로 듣기 음성재생 설정 번역 설정 글씨크기 조절하기",
    "제보는 카카오톡 okjebo <저작권자(c) 연합뉴스, 무단 전재-재배포 금지>",
    "연합뉴스TV 기사문의 및 제보 : 카톡/라인 jebo23 ⓒ연합뉴스TV",
    "<저작권자 © 스타뉴스, 무단전재 및 재배포 금지>",
    "이야기를 실시간으로 팔로우하세요. 하위 섹션 아시아 게시됨 1일 전 공유 패널 닫기"
  ]) {
    assert.equal(cleanArticleTextChrome(`${article} ${tail}`), article);
  }
  assert.equal(
    cleanArticleTextChrome(`기사 제목 이미지 확대 닫기 이미지 확대 보기 ${article}`),
    article
  );
});

test("cleanArticleTextChrome: 가입 유도·CMS 안내만 지우고 로그인 관련 기사 문장은 보존한다", () => {
  const article = "정부는 공공 서비스 로그인 절차와 회원 보호 기준을 개편한다고 밝혔습니다. 후속 시행 일정은 다음 달 공개됩니다.";
  const chrome = "전체 페이지를 읽으시려면 회원가입 및 로그인을 해주세요! 기사 제목 내용을 입력해주세요. 삭제하시겠습니까? 등록이 완료되었습니다.";
  const quoted = "담당자는 화면에 '삭제하시겠습니까?'와 '등록이 완료되었습니다.'라는 문구가 차례로 표시됐다고 설명했습니다.";

  assert.equal(cleanArticleTextChrome(`${chrome} ${article}`), article);
  assert.equal(cleanArticleTextChrome(article), article);
  assert.equal(cleanArticleTextChrome(quoted), quoted);
});

test("cleanArticleTextChrome: 연합뉴스·하입비스트·하이스노바이어티 UI만 걷고 기사 본문은 보존한다", () => {
  const article = "정부는 새 정책의 적용 범위와 시행 일정을 공개했습니다. 후속 수치는 다음 달 발표될 예정입니다.";

  assert.equal(cleanArticleTextChrome(
    `연합뉴스만의 특별한 뉴스 서비스를 경험해보세요! 송고 2026-09-04 10:23 송고 2026년09월04일 10시23분 기사 제목과 부제 구글 검색에서 연합뉴스 기사를 우선적으로 보여줍니다. ${article}`
  ), article);
  assert.equal(cleanArticleTextChrome(
    `1/8 Alpha Industries 2/8 Alpha Industries 8/8 Alpha Industries 패션 6시간 전 113 조회수 0 댓글 댓글 저장 요약 ${article}`
  ), article);
  assert.equal(cleanArticleTextChrome(
    `13 중 1 질 샌더 13 중 2 질 샌더 13 of 13 Jil Sander 패션 15시간 전 551 조회수 0 댓글 댓글 저장 ${article}`
  ), article);
  assert.equal(cleanArticleTextChrome(
    `계속해서 소식을 받고 싶으십니까? 지금 Highsnobiety 앱을 다운로드하세요. shop Satisfy ${article} Air Jordan 쇼핑하기 AJ11 ${article}`
  ), `${article} AJ11 ${article}`);
  assert.equal(cleanArticleTextChrome(
    `${article} Air Jordan 쇼핑하기 AJ11's 최초 협업 제품입니다.`
  ), `${article} AJ11's 최초 협업 제품입니다.`);

  const quoted = "취재진은 앱 다운로드 증가와 온라인 쇼핑 산업의 변화를 함께 분석했습니다.";
  assert.equal(cleanArticleTextChrome(quoted), quoted);

  for (const ordinary of [
    "Coupang 쇼핑몰 매출이 늘었습니다.",
    "Naver 쇼핑 라이브 거래액이 증가했습니다.",
    "Amazon 쇼핑객이 늘었습니다.",
    "SSG 쇼핑센터가 문을 열었습니다.",
    "You can shop Nike Air Max online now.",
    "Amazon 쇼핑하기 기능이 새로 열렸습니다.",
    "앞 문장입니다. shop Nike 매장이 문을 열었습니다."
  ]) {
    assert.equal(cleanArticleTextChrome(ordinary), ordinary);
  }
});

// ---- NH124: 발췌 오염 (NH123 실측 원문 그대로) ------------------------------

test("cleanArticleTextChrome: 연합뉴스 사진 설명·크레딧·기자 이메일을 걷고 본문 발신지부터 남긴다", () => {
  const body35 = "(서울=연합뉴스) 임성호 김민지 기자 = 삼성전자의 가전 등 완제품을 담당하는 디바이스경험(DX) 부문 직원 중심으로 구성된 삼성전자 노동조합 동행(이하 동행노조)이 이재용 삼성전자 회장 자택 앞에서 보상 격차 해소를 촉구하는 집회를 열기로 했다. 5일 업계에 따르면, 동행노조는 오는 18일 발대식을 시작으로 집회 및 1인 시위를 이어갈 계획이다.";
  // NH123 오늘판 #35: 사진 설명이 자기 발신지·날짜·기자 이메일까지 달고 본문 앞에 붙었다.
  assert.equal(
    cleanArticleTextChrome(`(수원=연합뉴스) 홍기원 기자 = 16일 경기도 수원시 영통구 삼성전자 수원사업장 앞에서 삼성전자노동조합 동행(동행노조) 조합원들이 성과급 격차 등에 반발하며 구호를 외치고 있다. 2026.7.16 xanadu@yna.co.kr ${body35}`),
    body35
  );
  // #3: 설명이 여러 문장이고 날짜 표기가 8월인 경우도 마지막 "날짜 이메일" 뒤 발신지부터다.
  const body3 = "(서울=연합뉴스) 김지헌 기자 = 조현 외교부 장관이 대홍수가 발생한 네팔을 방문한다고 외교부가 5일 밝혔다. 외교부는 조 장관이 이날부터 7일까지 네팔을 방문, 시시르 커날 네팔 외교장관과 한-네팔 외교장관 회담을 갖는다고 밝혔다.";
  assert.equal(
    cleanArticleTextChrome(`(서울=연합뉴스) 윤동진 기자 = 조현 외교부 장관이 26일 외교부에서 네팔 홍수 우리 국민 실종 관련 재외국민보호대책본부 회의를 주재하고 있다. 2026.8.26 mon@yna.co.kr ${body3}`),
    body3
  );
  // #20·#31·#29·#16: 대괄호 사진 크레딧은 본문 앞·문단 사이 어디에 있어도 지운다.
  const body20a = "(랄릿푸르[네팔]=연합뉴스) 손현규 특파원 = \"9천명 가까이 사망한 2015년 네팔 강진 때와는 구호 상황이 다릅니다.\" 2000년 네팔에 정착한 교민 문광진(55)씨는 2년 뒤부터 현지에서 구호 활동을 시작했다.";
  const body20b = "그때 기억이 문씨를 서두르라고 재촉했다. 지난달 26일 대홍수가 발생한 다음 날부터 지금까지 집중적으로 구호 활동을 했다.";
  assert.equal(
    cleanArticleTextChrome(`[네팔 교민 문광진씨 제공. 재판매 및 DB 금지] ${body20a} [네팔 교민 문광진씨 제공. 재판매 및 DB 금지] ${body20b}`),
    `${body20a} ${body20b}`
  );
  const body31 = "(서울=연합뉴스) 임성호 기자 = 전국 주유소 기름값이 지난주 대비 소폭 내리며 16주 연속 하락세를 이어갔다. 5일 한국석유공사 유가정보시스템 오피넷에 따르면 전국 주유소 휘발유 평균 판매가는 전주 대비 L당 1.1원 내린 1천860.2원이었다.";
  assert.equal(cleanArticleTextChrome(`[연합뉴스 자료사진] ${body31}`), body31);
  assert.equal(cleanArticleTextChrome(`[촬영 조승한] ${body31}`), body31);
  // #29: "[제작] 사진합성·일러스트" 크레딧과, 짧은 기사라 발췌 끝까지 남던 기자 이메일.
  const body29 = "(익산=연합뉴스) 정경재 기자 = 새벽에 자전거 탄 노인을 차로 치어 숨지게 하고 달아난 외국인 유학생이 경찰 조사를 받고 있다. 경찰 관계자는 \"정확한 사고 경위를 조사하고 있다\"고 말했다.";
  assert.equal(
    cleanArticleTextChrome(`[이태호 제작] 사진합성·일러스트 ${body29} jaya@yna.co.kr 제보는 카카오톡 okjebo <저작권자(c) 연합뉴스, 무단 전재-재배포 금지>`),
    body29
  );
});

test("cleanArticleTextChrome: 본문 속 날짜·이메일·대괄호 문장은 기사 내용으로 보존한다", () => {
  // 발신지가 뒤따르지 않는 날짜, 문장 안의 이메일, 크레딧이 아닌 대괄호는 건드리지 않는다.
  for (const article of [
    "(서울=연합뉴스) 김민지 기자 = 정부는 2026.9.5 발표에서 신고는 report@example.go.kr으로 접수한다고 밝혔다. 접수 기한은 2026.9.30까지다.",
    "[속보] 정부가 추가경정예산안을 발표했다. 재원은 [기금 전용]과 국채 발행으로 마련한다.",
    // Grok 반례: 크레딧이 아닌 제목 라벨과, 끝에 오는 연합 외 이메일은 기사 내용이다.
    "[제작비 논란] 드라마 제작진이 예산 집행 내역을 공개했다. [촬영본 유출] 사건은 경찰이 수사 중이다.",
    "행사 참가 신청과 문의는 press@example.com",
    "취재진의 문의 이메일 press@example.com에 회사는 답하지 않았다. 후속 조치는 다음 주 공개된다.",
    "쿠팡 파트너스 수수료 체계가 바뀐다는 소식에 판매자들이 대응에 나섰다. 카드 수수료 인하도 함께 논의된다."
  ]) {
    assert.equal(cleanArticleTextChrome(article), article);
  }
  // 끝의 이메일 한 토큰만 지우고, 그 앞 문장은 그대로다.
  assert.equal(
    cleanArticleTextChrome("경찰은 정확한 사고 경위를 조사하고 있다고 말했다. jaya@yna.co.kr"),
    "경찰은 정확한 사고 경위를 조사하고 있다고 말했다."
  );
});

test("cleanArticleTextChrome: 엔가젯 머리 크롬과 테크크런치 메뉴·플레이어 안내를 걷고 영문 본문부터 남긴다", () => {
  // NH123 #27·#30: 카테고리·제목·부제·바이라인·사진 크레딧·구글 위젯이 번역 전 본문 앞에 있었다.
  const engadget = "Continuing the trend of trying to make Windows 11 suck less, Microsoft today announced Project Zenith, a new \"ready-to-code distraction free Windows experience\" for powerful developer hardware with 64GB of RAM.";
  assert.equal(
    cleanArticleTextChrome(`Big Tech Microsoft Microsoft announces Project Zenith, a clutter-free Windows experience meant to entice developers But you'll need a powerful system with 64GB of RAM to use it. By Devindra Hardawar Sept. 4, 2026 10:05 am EST dennizn/Shutterstock Add Engadget on Google: Preferred Source Google Discover ${engadget}`),
    engadget
  );
  // #9: 영상 페이지는 사이트 메뉴 뒤 "Loading the player…" 다음이 설명 본문이다.
  const techcrunch = "It’s officially the Ternus era at Apple. Tim Cook stepped down as CEO this week, handing the company to former hardware chief John Ternus, whose first memo promised a “huge launch next week”.";
  assert.equal(
    cleanArticleTextChrome(`Latest AI Amazon Apps Biotech & Health Climate Cloud Computing Commerce Crypto Enterprise EVs Fintech Fundraising Gadgets Gaming Google Government & Policy Hardware Instagram Layoffs Media & Entertainment Meta Microsoft Privacy Robotics Security Social Space Startups TikTok Transportation Venture Staff Events Startup Battlefield StrictlyVC Newsletters Podcasts Videos Partner Content TechCrunch Brand Studio Contact Us Loading the player… ${techcrunch}`),
    techcrunch
  );
  // 이미 번역돼 정본·캐시에 고정된 발췌(NH123 #27·#30·#9 실측 번역문)도 같은 경계에서 자른다.
  const engadgetKo = "Windows 11을 덜 짜증나게 만들려는 추세에 따라 Microsoft는 오늘 64GB의 RAM 및 다양한 용량을 갖춘 강력한 개발자 하드웨어를 위한 새로운 Project Zenith를 발표했습니다.";
  assert.equal(
    cleanArticleTextChrome(`Big Tech Microsoft Microsoft는 개발자의 관심을 끌기 위한 깔끔한 Windows 환경인 Project Zenith를 발표했습니다. 그러나 이를 사용하려면 64GB의 RAM이 포함된 강력한 시스템이 필요합니다. 작성자: Devindra Hardawar 2026년 9월 4일 오전 10:05 EST dennizn/Shutterstock Google에 Engadget 추가: 기본 소스 Google Discover ${engadgetKo}`),
    engadgetKo
  );
  const techcrunchKo = "이제 Apple의 공식적으로 Ternus 시대가 되었습니다. Tim Cook는 이번 주에 CEO에서 물러나 회사를 전 하드웨어 책임자인 John Ternus에게 넘겼습니다.";
  assert.equal(
    cleanArticleTextChrome(`2026년 중단: OpenAI, Anthropic, Replit 등이 6개 산업 단계를 차지합니다. 지금 티켓 25% 할인 인기 수요로 돌아옴: Disrupt에서 최대 $300 할인 최신 AI Amazon Apps 생명 공학 및 건강 기후 클라우드 컴퓨팅 상거래 암호화 기업 EVs 핀테크 기금 모금 가제트 게임 Google 정부 및 정책 하드웨어 Instagram 해고 미디어 및 엔터테인먼트 메타 Microsoft 개인 정보 보호 로봇 공학 보안 소셜 공간 스타트업 TikTok 교통 벤처 직원 이벤트 스타트업 Battlefield StrictlyVC 뉴스레터 팟캐스트 동영상 파트너 콘텐츠 TechCrunch Brand Studio 문의하기 플레이어 로드 중… ${techcrunchKo}`),
    techcrunchKo
  );
  // 위젯 문구가 본문 속에 인용된 평범한 영문은 700자 머리 밖이면 건드리지 않는다.
  const plain = "Google Discover traffic fell for several publishers this quarter, according to the report. Analysts expect the trend to continue.";
  assert.equal(cleanArticleTextChrome(plain), plain);
});

test("cleanArticleTextChrome: 게시자 제휴 고지문만 지우고 상품·가격·쿠폰 내용은 남긴다", () => {
  // NH123 실시간 1위 이토랜드 핫딜 og:description 원문 그대로.
  assert.equal(
    cleanArticleTextChrome("금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8 ✱ 이 포스팅은 토스쇼핑 쉐어링크 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다. 금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8"),
    "금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8 금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8"
  );
  const deal = "LG 27인치 QHD 모니터 249,000원, 카드 할인 쿠폰 적용 시 219,000원 무료배송. 오늘 자정까지 진행되는 특가입니다.";
  assert.equal(
    cleanArticleTextChrome(`${deal} 본 게시물은 쿠팡 파트너스 활동의 일환으로 이에 따른 일정액의 수수료를 제공받을 수 있습니다.`),
    deal
  );
  assert.equal(cleanArticleTextChrome("이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."), "");
});

test("fetchPublicArticle: 문단 폴백은 figure 사진 설명·header 메뉴·script 템플릿 문단을 본문으로 읽지 않는다", async () => {
  // 연합뉴스 구조(2026-09-05 실측): 첫 <article>은 <header> 안의 세 줄 요약이라 짧아 문단 폴백으로 떨어지고,
  // 본문 <p> 사이에 <figure><figcaption><p> 사진 설명이 끼며, 가입 유도 문구는 핸들바 <script> 템플릿 안 <p>,
  // 기자 이메일은 마지막 <p>다.
  const sentence = "삼성전자 노동조합 동행이 이재용 회장 자택 앞에서 보상 격차 해소를 촉구하는 집회를 열기로 했다고 업계가 5일 밝혔다. ";
  const body = `(서울=연합뉴스) 임성호 김민지 기자 = ${sentence.repeat(6).trim()}`;
  const html = `<header><p class="menu-link">Latest</p><p class="menu-link">Contact Us</p>
      <article class="story-summary"><p>노조가 집회를 연다는 세 줄 요약입니다.</p></article></header>
    <script id="loginBefore01_Template" type="text/x-handlebars-template"><div><p class="txt01">연합뉴스만의 특별한 뉴스 서비스를 경험해보세요!</p></div></script>
    <article id="articleWrap">
      <figure class="image-zone01"><img src="/photo.jpg"><figcaption><strong>사진 제목</strong><p class="txt-desc">(수원=연합뉴스) 홍기원 기자 = 16일 수원사업장 앞에서 조합원들이 구호를 외치고 있다. 2026.7.16 xanadu@yna.co.kr</p></figcaption></figure>
      <p>${body}</p>
      <figure><figcaption><p class="txt-desc">[연합뉴스 자료사진]</p></figcaption></figure>
      <p>재계에서는 무리한 요구라는 비판이 나온다.</p>
      <p>sh@yna.co.kr<br/></p>
      <p class="txt-copyright">제보는 카카오톡 okjebo</p>
    </article>
    <footer><p>다양한 채널에서 연합뉴스를 만나보세요!</p></footer>`;
  const result = await fetchPublicArticle("https://www.yna.co.kr/view/AKR20260903152600003", {
    fetchImpl: async () => streamRes({ body: html })
  });
  assert.equal(result.state, "available");
  const text = cleanArticleTextChrome(result.text);
  assert.ok(text.startsWith("(서울=연합뉴스) 임성호 김민지 기자 = 삼성전자 노동조합"), text.slice(0, 80));
  assert.ok(text.endsWith("재계에서는 무리한 요구라는 비판이 나온다."), text.slice(-80));
  for (const noise of ["홍기원", "xanadu@yna.co.kr", "자료사진", "Contact Us", "특별한 뉴스 서비스", "세 줄 요약", "sh@yna.co.kr", "다양한 채널"]) {
    assert.ok(!text.includes(noise), noise);
  }
});

test("makeEnricher: og:description의 게시자 제휴 고지는 지우고 사이트 소개 크롬은 발췌로 쓰지 않는다", async () => {
  const pages = new Map([
    ["https://etoland.example/hit/hotdeal/view/1", `<meta property="og:description" content="금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8 ✱ 이 포스팅은 토스쇼핑 쉐어링크 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.">`],
    ["https://etoland.example/hit/hotdeal/view/2", `<meta property="og:description" content="이토랜드는 유머, 연예, 정보, 이슈를 빠르게 공유하는 커뮤니티입니다.">`],
    ["https://etoland.example/hit/freebbs/view/3", `<meta property="og:description" content="정말 계속 떨어지네요. 환율이 1350원 아래로 내려온 건 올해 처음입니다.">`]
  ]);
  const fetchImpl = async (url) => mockRes({ body: pages.get(url), url });
  const enricher = makeEnricher({ fetchImpl });
  const items = [...pages.keys()].map((url) => ({ url, image: "https://cdn.example.com/x.jpg", summary: "", title: "핫딜" }));
  const { attempted, filled } = await enricher.enrich(items);
  assert.equal(attempted, 3);
  assert.equal(filled, 2);
  assert.equal(items[0].summary, "금강만두 육개장, 630g, 5개 https://toss.im/_m/PnW9x5l8");
  assert.equal(items[1].summary, "", "사이트 소개문은 그 글의 발췌가 아니다");
  assert.equal(items[2].summary, "정말 계속 떨어지네요. 환율이 1350원 아래로 내려온 건 올해 처음입니다.");
});

test("fetchPublicArticle: 본문 전용 컨테이너가 있으면 주변 추천·상품 목록을 섞지 않는다", async () => {
  const article = "아침저녁으로 선선해지면서 긴팔 파자마와 포근한 홈웨어를 찾는 사람이 늘고 있습니다. 편안한 착용감과 소재를 확인해야 합니다. ".repeat(3).trim();
  const result = await fetchPublicArticle("https://publisher.example/article/42", {
    fetchImpl: async () => streamRes({
      body: `<meta property="og:title" content="가을 홈웨어 고르는 법"><main>
        <h1>가을 홈웨어 고르는 법</h1>
        <div class="atc_body"><div class="atc_body_cont">
          <div class="atc_mask_login"><p>전체 페이지를 읽으시려면 회원가입 및 로그인을 해주세요!</p></div>
          <div><p>${article}</p><div class="shopping_wrap2">상품 자세히 보기</div>
          <div class="ab_related_article"><h2>전혀 다른 추천 기사 제목</h2></div></div>
        </div></div>
        <div class="tag_atc_list"><p>본문 밖 추천 기사입니다.</p></div>
      </main>`,
      url: "https://publisher.example/article/42"
    }),
    expectedTitle: "가을 홈웨어 고르는 법"
  });

  assert.equal(result.state, "available");
  assert.equal(result.text, article);
});

test("fetchPublicArticle: Google 뉴스 중계 주소를 실제 언론사 원문으로 풀어 본문과 사진을 읽는다", async () => {
  const googleUrl = "https://news.google.com/rss/articles/opaque-article-id?oc=5";
  const publisherUrl = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const articleBody = "태풍 관련 공개 기사 본문 ".repeat(40);
  const rpcBody = `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", publisherUrl, 1]), null, null, null, "generic"]
  ])}`;
  const calls = [];
  const result = await fetchPublicArticle(googleUrl, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url) === googleUrl) {
        return streamRes({
          body: '<c-wiz><div data-n-a-id="opaque-article-id" data-n-a-ts="1787687855" data-n-a-sg="signed-token"></div></c-wiz>',
          url: googleUrl
        });
      }
      if (String(url).includes("/_/DotsSplashUi/data/batchexecute")) {
        return mockRes({ body: rpcBody, url: String(url) });
      }
      return streamRes({
        body: `<meta property="og:image" content="/photo.jpg"><article>${articleBody}</article>`,
        url: publisherUrl
      });
    }
  });
  assert.equal(result.state, "available");
  assert.equal(result.finalUrl, publisherUrl);
  assert.equal(result.image, "https://news.kbs.co.kr/photo.jpg");
  assert.equal(result.text, articleBody.trim());
  assert.deepEqual(calls.map((row) => row.method), ["GET", "POST", "GET"]);
});

test("fetchPublicArticle: Google 뉴스의 동일 기사 로케일 302를 한 번 따라가 중계를 해제한다", async () => {
  const googleUrl = "https://news.google.com/rss/articles/opaque-locale-redirect?oc=5";
  const publisherUrl = "https://news.kbs.co.kr/news/view.do?ncd=8644224";
  const articleBody = "태풍 관련 공개 기사 본문 ".repeat(40);
  const rpcBody = `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", publisherUrl, 1]), null, null, null, "generic"]
  ])}`;
  let wrapperCalls = 0;
  const result = await fetchPublicArticle(googleUrl, {
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "news.google.com" && parsed.pathname.includes("/rss/articles/")) {
        wrapperCalls += 1;
        if (!parsed.searchParams.has("hl")) {
          return streamRes({ ok: false, status: 302, url: googleUrl, location: `${googleUrl}&hl=en-US&gl=US&ceid=US:en` });
        }
        assert.equal(parsed.searchParams.get("hl"), "en-US");
        assert.equal(parsed.searchParams.get("gl"), "US");
        assert.equal(parsed.searchParams.get("ceid"), "US:en");
        return streamRes({
          body: '<div data-n-a-id="opaque-locale-redirect" data-n-a-ts="1787687855" data-n-a-sg="signed-token"></div>',
          url: parsed.href
        });
      }
      if (String(url).includes("/_/DotsSplashUi/data/batchexecute")) return mockRes({ body: rpcBody, url: String(url) });
      return streamRes({
        body: `<title>태풍 관련 공개 기사</title><article>${articleBody}</article>`,
        url: publisherUrl
      });
    }
  });
  assert.equal(result.state, "available");
  assert.equal(result.finalUrl, publisherUrl);
  assert.equal(wrapperCalls, 2);
});

test("fetchPublicArticle: Google 중계가 다른 기사 페이지를 돌려주면 본문을 섞지 않는다", async () => {
  const googleUrl = "https://news.google.com/rss/articles/opaque-wrong-publisher-page?oc=5";
  const publisherUrl = "https://publisher.example.com/news/wrong";
  const rpcBody = `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", publisherUrl, 1]), null, null, null, "generic"]
  ])}`;
  const result = await fetchPublicArticle(googleUrl, {
    expectedTitle: "정부가 반도체 산업 지원책을 발표했다",
    fetchImpl: async (url) => {
      if (String(url) === googleUrl) {
        return streamRes({
          body: '<div data-n-a-id="opaque-wrong-publisher-page" data-n-a-ts="1787687855" data-n-a-sg="signed-token"></div>',
          url: googleUrl
        });
      }
      if (String(url).includes("/_/DotsSplashUi/data/batchexecute")) return mockRes({ body: rpcBody, url: String(url) });
      return streamRes({
        body: `<title>유럽 축구 결승전 경기 결과</title><article>${"전혀 다른 스포츠 기사 본문 ".repeat(40)}</article>`,
        url: publisherUrl
      });
    }
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "ARTICLE_IDENTITY_MISMATCH");
  assert.equal(result.finalUrl, null);
  assert.equal(result.image, null);
});

test("fetchPublicArticle: 직접 링크가 다른 기사로 이동하면 짧은 제목이어도 근거로 쓰지 않는다", async () => {
  const requestedUrl = "https://publisher.example.com/news/rate";
  const wrongUrl = "https://publisher.example.com/news/sports";
  let calls = 0;
  const result = await fetchPublicArticle(requestedUrl, {
    expectedTitle: "정책 금리 동결",
    resolveHost: null,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return streamRes({
        status: 302,
        ok: false,
        location: wrongUrl,
        url: requestedUrl,
        body: ""
      });
      return streamRes({
        body: `<title>오늘 뉴스</title><article>${"전혀 다른 스포츠 기사 본문 ".repeat(40)}</article>`,
        url: wrongUrl
      });
    }
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "ARTICLE_IDENTITY_MISMATCH");
  assert.equal(result.finalUrl, null);
});

test("fetchPublicArticle: 직접 링크의 접근차단 HTML을 기사 본문으로 오인하지 않는다", async () => {
  const result = await fetchPublicArticle("https://publisher.example.com/news/blocked", {
    expectedTitle: "정부가 반도체 산업 지원책을 발표했다",
    fetchImpl: async () => streamRes({
      body: `<title>Access Denied Portal</title><main>${"Your request was blocked by the security policy. ".repeat(40)}</main>`,
      url: "https://publisher.example.com/news/blocked"
    })
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "ARTICLE_IDENTITY_MISMATCH");
});

test("fetchPublicArticle: Google 중계 해제 응답이 깨지면 원문 미확인으로 정확히 구분한다", async () => {
  const googleUrl = "https://news.google.com/rss/articles/opaque-malformed-rpc?oc=5";
  const result = await fetchPublicArticle(googleUrl, {
    fetchImpl: async (url) => String(url) === googleUrl
      ? streamRes({
          body: '<div data-n-a-id="opaque-malformed-rpc" data-n-a-ts="1787687855" data-n-a-sg="signed-token"></div>',
          url: googleUrl
        })
      : mockRes({ body: ")]}'\n\nnot-json", url: String(url) })
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "PUBLISHER_URL_UNAVAILABLE");
});

test("fetchPublicArticle: 중계 해제 뒤 언론사 본문이 짧으면 중계 실패로 오인하지 않는다", async () => {
  const googleUrl = "https://news.google.com/rss/articles/opaque-short-publisher-page?oc=5";
  const publisherUrl = "https://publisher.example.com/news/short";
  const rpcBody = `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", publisherUrl, 1]), null, null, null, "generic"]
  ])}`;
  const result = await fetchPublicArticle(googleUrl, {
    fetchImpl: async (url) => {
      if (String(url) === googleUrl) {
        return streamRes({
          body: '<div data-n-a-id="opaque-short-publisher-page" data-n-a-ts="1787687855" data-n-a-sg="signed-token"></div>',
          url: googleUrl
        });
      }
      if (String(url).includes("/_/DotsSplashUi/data/batchexecute")) return mockRes({ body: rpcBody, url: String(url) });
      return streamRes({ body: "<article>짧은 기사입니다.</article>", url: publisherUrl });
    }
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reasonCode, "PUBLIC_BODY_TOO_SHORT");
  assert.equal(result.finalUrl, publisherUrl);
});

test("fetchOgMeta: Google 뉴스 중계 이미지를 대표 사진으로 가져오지 않는다", async () => {
  let calls = 0;
  const result = await fetchOgMeta("https://news.google.com/rss/articles/example", {
    fetchImpl: async () => { calls += 1; return mockRes({ body: "<meta property=\"og:image\" content=\"google-logo.png\">" }); }
  });
  assert.deepEqual(result, { image: null, desc: null });
  assert.equal(calls, 0);
});

test("fetchPublicArticle: 접근 실패 코드를 명시적으로 보존한다", async () => {
  const cases = [[401, "AUTH_REQUIRED"], [403, "ACCESS_DENIED"], [429, "RATE_LIMITED"], [404, "NOT_FOUND"], [410, "NOT_FOUND"], [500, "HTTP_ERROR"]];
  for (const [status, reasonCode] of cases) {
    const result = await fetchPublicArticle("https://example.com/status", { fetchImpl: async () => streamRes({ ok: false, status }) });
    assert.deepEqual(result, { state: "unavailable", reasonCode, httpStatus: status, image: null, finalUrl: null });
  }
});

test("fetchPublicArticle: timeout과 network 오류를 구분한다", async () => {
  const timeout = await fetchPublicArticle("https://example.com/slow", {
    timeoutMs: 1,
    fetchImpl: (_, { signal }) => new Promise((_, reject) => {
      const wait = setTimeout(() => reject(new Error("timeout signal was not delivered")), 50);
      signal.addEventListener("abort", () => { clearTimeout(wait); reject(signal.reason); }, { once: true });
    })
  });
  assert.equal(timeout.reasonCode, "TIMEOUT");

  const network = await fetchPublicArticle("https://example.com/offline", { fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.equal(network.reasonCode, "NETWORK_ERROR");
});

test("fetchPublicArticle: capped stream 취소가 거부돼도 요청 결과와 프로세스를 깨뜨리지 않는다", async () => {
  const result = await fetchPublicArticle("https://example.com/cancel-reject", {
    resolveHost: null,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://example.com/cancel-reject",
      headers: { get: () => "text/html; charset=utf-8" },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new TextEncoder().encode(`<article>${"공개 기사 본문 ".repeat(60)}</article>`) };
            },
            async cancel() { throw new Error("cancel rejected"); }
          };
        }
      }
    })
  });
  assert.equal(result.state, "available");
});

test("fetchPublicArticle: capped stream 취소가 끝나지 않아도 기사 준비를 기다리게 하지 않는다", async () => {
  const pending = fetchPublicArticle("https://example.com/cancel-pending", {
    resolveHost: null,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://example.com/cancel-pending",
      headers: { get: () => "text/html; charset=utf-8" },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new TextEncoder().encode(`<article>${"공개 기사 본문 ".repeat(60)}</article>`) };
            },
            cancel() { return new Promise(() => {}); }
          };
        }
      }
    })
  });
  const result = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve({ state: "cancel_timeout" }), 50))
  ]);
  assert.equal(result.state, "available");
});

test("fetchPublicArticle: DNS 조회도 전체 timeout 안에서 끝나며 지연되면 TIMEOUT이다", async () => {
  let fetchCalls = 0;
  const result = await fetchPublicArticle("https://slow-dns.example.com/article", {
    timeoutMs: 5,
    resolveHost: async () => new Promise((resolve) => setTimeout(() => resolve([
      { address: "93.184.216.34", family: 4 }
    ]), 80)),
    fetchImpl: async () => {
      fetchCalls += 1;
      return streamRes({ body: `<article>${"공개 기사 본문 ".repeat(60)}</article>` });
    }
  });
  assert.equal(result.reasonCode, "TIMEOUT");
  assert.equal(fetchCalls, 0);
});

test("fetchPublicArticle: 깨진 redirect Location은 reject 대신 HTTP_ERROR로 닫는다", async () => {
  const result = await fetchPublicArticle("https://example.com/bad-location", {
    resolveHost: null,
    fetchImpl: async () => streamRes({ ok: false, status: 302, location: "http://[invalid" })
  });
  assert.equal(result.reasonCode, "HTTP_ERROR");
  assert.equal(result.httpStatus, 302);
});

test("fetchPublicArticle: Google 뉴스 해제 단계 timeout을 원문 미확인으로 뭉개지 않는다", async () => {
  const result = await fetchPublicArticle("https://news.google.com/rss/articles/timeout-google-news", {
    timeoutMs: 5,
    resolveHost: null,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  assert.equal(result.reasonCode, "TIMEOUT");
});

test("fetchPublicArticle: 비 HTML은 읽지 않고 NON_HTML로 반환한다", async () => {
  const result = await fetchPublicArticle("https://example.com/report.pdf", {
    fetchImpl: async () => streamRes({ contentType: "application/pdf" })
  });
  assert.deepEqual(result, { state: "unavailable", reasonCode: "NON_HTML", httpStatus: 200, image: null, finalUrl: null });
});

test("fetchOgMeta: 비 HTML 응답 본문은 읽지 않고 즉시 닫는다", async () => {
  let canceled = 0;
  const result = await fetchOgMeta("https://example.com/report.pdf", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://example.com/report.pdf",
      headers: { get: () => "application/pdf" },
      body: { cancel() { canceled += 1; return Promise.resolve(); } }
    })
  });
  assert.deepEqual(result, { image: null, desc: null });
  assert.equal(canceled, 1);
});

test("fetchPublicArticle: 요청은 한 번이고 인증·쿠키 헤더 없이 capped stream만 읽는다", async () => {
  const rawMarker = "RAW_HTML_MUST_NOT_ESCAPE";
  const body = `<main><p>${"a".repeat(300)}</p></main>${"z".repeat(800 * 1024)}${rawMarker}`;
  const calls = [];
  const result = await fetchPublicArticle("https://example.com/public", {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return streamRes({ body, url: "https://example.com/public/final" }); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(calls[0].options.headers.cookie, undefined);
  assert.equal(calls[0].options.redirect, "manual", "리다이렉트 목적지도 공인 주소인지 다시 검사한다");
  assert.equal(result.state, "available");
  assert.ok(result.text.length <= 16000);
  assert.ok(!JSON.stringify(result).includes(rawMarker));
  assert.deepEqual(Object.keys(result).sort(), ["finalUrl", "image", "state", "text"]);
});

test("fetchPublicArticle: 내부 주소·credentials URL과 내부 주소 리다이렉트를 요청 전에 차단한다", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return streamRes(); };
  for (const url of [
    "http://127.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[fec0::1]/private",
    "https://user:pass@example.com/private"
  ]) {
    const result = await fetchPublicArticle(url, { fetchImpl });
    assert.equal(result.reasonCode, "UNSAFE_URL");
  }
  assert.equal(calls, 0);

  const redirected = await fetchPublicArticle("https://public.example.com/start", {
    fetchImpl: async () => {
      calls += 1;
      return streamRes({ ok: false, status: 302, location: "http://10.0.0.7/private" });
    }
  });
  assert.equal(redirected.reasonCode, "UNSAFE_URL");
  assert.equal(calls, 1, "공개 시작 URL 한 번 뒤 내부 리다이렉트는 요청하지 않아야 한다");
});

test("fetchPublicArticle: 공개 호스트가 사설 IP로 해석되면 요청 전에 차단한다", async () => {
  let calls = 0;
  const result = await fetchPublicArticle("https://rebind.example.com/article", {
    resolveHost: async () => [{ address: "10.20.30.40", family: 4 }],
    fetchImpl: async () => { calls += 1; return streamRes(); }
  });
  assert.equal(result.reasonCode, "UNSAFE_URL");
  assert.equal(calls, 0);
});

test("fetchPublicArticle: 검증한 공개 DNS 주소를 실제 연결 lookup에 고정한다", async () => {
  let connectedAddress = null;
  const result = await fetchPublicArticle("https://rebind.example.com/article", {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (_url, options) => {
      options.lookup("rebind.example.com", {}, (_error, address, family) => {
        connectedAddress = { address, family };
      });
      return streamRes({ body: `<article>${"공개 기사 본문 ".repeat(60)}</article>` });
    }
  });
  assert.equal(result.state, "available");
  assert.deepEqual(connectedAddress, { address: "93.184.216.34", family: 4 });
});
