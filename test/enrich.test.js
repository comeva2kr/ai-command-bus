// 썸네일 보강(enrich.js) — og:image/twitter:image 추출, 조용한 실패, 캐시(TTL+부정캐시).
import test from "node:test";
import assert from "node:assert/strict";

import { extractOgImage, extractOgDesc, fetchOgImage, fetchOgMeta, makeEnricher } from "../src/feed/enrich.js";

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
  const result = await fetchOgImage("https://news.google.com/rss/articles/xyz", { fetchImpl });
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
