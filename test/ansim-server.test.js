// 안심스캔 서버 — 바코드 조회, 분석, 라벨 사진 경로, CORS, 입력 제한.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/ansim/server.js";
import { createCatalog } from "../src/ansim/catalog.js";
import { fetchProductByBarcode } from "../src/ansim/mfds.js";
import { parseDataUrl, readLabel } from "../src/ansim/label-reader.js";

async function withServer(opts, fn) {
  const server = createServer({ fetchProduct: async () => null, ...opts });
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://localhost:${server.address().port}`); }
  finally { server.close(); }
}
const post = (base, path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("예시 바코드 → 판정 + 같은 몰 대체품", async () => {
  await withServer({}, async (base) => {
    const res = await post(base, "/api/ansim/analyze", { barcode: "2009000000018", profile: { age: 6 }, mall: "naver" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = await res.json();
    assert.equal(body.product.name, "꼬마 비엔나 소시지");
    assert.equal(body.product.sample, true);
    assert.equal(body.analysis.verdict.code, "caution");
    assert.ok(body.alternatives.length >= 2);
    assert.equal(body.alternatives[0].links[0].mall, "naver");
  });
});

test("모르는 바코드는 404 — 앱은 라벨 사진으로 안내한다", async () => {
  await withServer({}, async (base) => {
    assert.equal((await post(base, "/api/ansim/analyze", { barcode: "8801234567890" })).status, 404);
    assert.equal((await fetch(`${base}/api/ansim/product/8801234567890`)).status, 404);
  });
});

test("카탈로그에 없으면 식약처 조회 결과를 쓰고 기억한다", async () => {
  let calls = 0;
  const catalog = createCatalog([]);
  const fetchProduct = async (code) => {
    calls++;
    return { barcode: code, name: "테스트 햄", foodType: "햄", category: "processed-meat", ingredientsText: "돼지고기, 아질산나트륨", source: "mfds" };
  };
  await withServer({ catalog, fetchProduct }, async (base) => {
    const a = await (await fetch(`${base}/api/ansim/product/8801111111111`)).json();
    assert.equal(a.product.name, "테스트 햄");
    await fetch(`${base}/api/ansim/product/8801111111111`);
    assert.equal(calls, 1);
  });
});

test("붙여넣은 원재료와 쇼핑몰 고시표 모두 분석한다", async () => {
  await withServer({}, async (base) => {
    const pasted = await (await post(base, "/api/ansim/analyze", {
      product: { name: "젤리", ingredientsText: "물엿, 설탕, 적색제40호, 황색제4호", nutritionText: "총 내용량 50g 160kcal 당류 25g 단백질 1g" },
      profile: { age: 5, concerns: ["attention"] }
    })).json();
    assert.equal(pasted.product.category, "candy");
    assert.equal(pasted.analysis.verdict.code, "avoid");
    assert.ok(pasted.alternatives.every((a) => a.analysis.category === "candy"));

    const notice = await (await post(base, "/api/ansim/analyze", {
      notice: { title: "보리차 - 쿠팡!", rows: [["식품의 유형", "침출차"], ["원재료명 및 함량", "정제수, 볶은보리"]] },
      profile: { age: 6 }, mall: "coupang"
    })).json();
    assert.equal(notice.analysis.verdict.code, "good");
  });
});

test("라벨 사진: 키가 없으면 501, 있으면 전사 결과를 판정한다", async () => {
  await withServer({ labelEnabled: false }, async (base) => {
    assert.equal((await post(base, "/api/ansim/label", { image: "data:image/png;base64,AAAA" })).status, 501);
  });
  const readLabel = async () => ({ found: true, name: "소시지", foodType: "소시지", ingredientsText: "돼지고기, 아질산나트륨, 정제소금", allergenText: "돼지고기 함유", nutritionText: "" });
  await withServer({ labelEnabled: true, readLabel }, async (base) => {
    const body = await (await post(base, "/api/ansim/label", { image: "data:image/png;base64,AAAA", profile: { age: 6, allergies: ["pork"] } })).json();
    assert.equal(body.extracted.name, "소시지");
    assert.equal(body.analysis.verdict.code, "block");
  });
  const unreadable = async () => ({ found: false, name: "", foodType: "", ingredientsText: "", allergenText: "", nutritionText: "" });
  await withServer({ labelEnabled: true, readLabel: unreadable }, async (base) => {
    assert.equal((await post(base, "/api/ansim/label", { image: "data:image/png;base64,AAAA" })).status, 422);
  });
});

test("입력 제한: 깨진 JSON 400, 큰 본문 413", async () => {
  await withServer({}, async (base) => {
    const bad = await fetch(`${base}/api/ansim/analyze`, { method: "POST", body: "{nope" });
    assert.equal(bad.status, 400);
    const huge = await post(base, "/api/ansim/analyze", { product: { ingredientsText: "x".repeat(300 * 1024) } });
    assert.equal(huge.status, 413);
  });
});

test("PWA와 코어 모듈을 서빙한다", async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /안심스캔/);
    const core = await fetch(`${base}/core/index.js`);
    assert.equal(core.status, 200);
    assert.match(core.headers.get("content-type"), /javascript/);
    assert.equal((await fetch(`${base}/core/..%2Fserver.js`)).status, 404);
  });
});

test("식약처 어댑터: 바코드 → 품목보고번호 → 원재료", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes("/C005/")) return { ok: true, json: async () => ({ C005: { row: [{ BAR_CD: "8801", PRDLST_REPORT_NO: "1999", PRDLST_NM: "꼬마햄", BSSH_NM: "가상식품", PRDLST_DCNM: "햄" }] } }) };
    return { ok: true, json: async () => ({ C002: { row: [{ PRDLST_REPORT_NO: "1999", RAWMTRL_NM: "돼지고기,정제소금,아질산나트륨" }] } }) };
  };
  const p = await fetchProductByBarcode("8801", { apiKey: "k", fetchImpl });
  assert.equal(p.name, "꼬마햄");
  assert.equal(p.category, "processed-meat");
  assert.equal(p.ingredientsText, "돼지고기,정제소금,아질산나트륨");
  assert.match(seen[0], /\/k\/C005\/json\/1\/5\/BAR_CD=8801$/);
  assert.match(seen[1], /\/C002\/json\/1\/5\/PRDLST_REPORT_NO=1999$/);
  assert.equal(await fetchProductByBarcode("8801", { apiKey: "" }), null);
});

test("라벨 리더: 이미지 검증과 요청 형식", async () => {
  assert.equal(parseDataUrl("data:text/html;base64,AAAA"), null);
  assert.equal(parseDataUrl("data:image/jpg;base64,AAAA").mediaType, "image/jpeg");
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ found: true, name: "", foodType: "", ingredientsText: "정제수", allergenText: "", nutritionText: "" }) }] }) };
  };
  const out = await readLabel({ dataUrl: "data:image/png;base64,AAAA", apiKey: "k", fetchImpl });
  assert.equal(out.ingredientsText, "정제수");
  assert.equal(sent.messages[0].content[0].type, "image");
  assert.equal(sent.messages[0].content[0].source.media_type, "image/png");
  assert.equal(sent.output_config.format.type, "json_schema");
  const refused = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
  await assert.rejects(readLabel({ dataUrl: "data:image/png;base64,AAAA", apiKey: "k", fetchImpl: refused }), /refused/);
});

test("한 번 읽은 상품은 표가 접혀 있어도(상품명·URL만) 점수가 나온다", async () => {
  await withServer({}, async (base) => {
    const rows = [["식품의 유형", "소시지"], ["원재료명 및 함량", "돼지고기 90%, 정제소금, 아질산나트륨(발색제)"]];
    // 1) PC 웹에서 고시표가 보이는 페이지
    const first = await (await post(base, "/api/ansim/analyze", {
      notice: { title: "꼬마햄 300g", url: "https://www.coupang.com/vp/products/555?itemId=1", rows }, mall: "coupang", profile: { age: 6 }
    })).json();
    assert.ok(first.analysis.score != null);
    // 2) 같은 상품을 모바일 웹에서, 표 없이 — 상품번호로 찾는다
    const byId = await (await post(base, "/api/ansim/analyze", {
      notice: { title: "다른 제목", url: "https://m.coupang.com/vm/products/555", rows: [] }, mall: "coupang", profile: { age: 6 }
    })).json();
    assert.equal(byId.analysis.score, first.analysis.score);
    assert.ok(byId.analysis.notes.some((n) => n.includes("전에 읽어 둔 원재료")));
    // 3) 안드로이드 쇼핑앱 화면처럼 URL 없이 상품명만 — 제목으로 찾는다
    const byTitle = await (await post(base, "/api/ansim/analyze", {
      notice: { title: "꼬마햄 300g", url: "", rows: [] }, mall: "coupang", profile: { age: 6 }
    })).json();
    assert.equal(byTitle.analysis.score, first.analysis.score);
    // 4) 처음 보는 상품은 지어내지 않는다
    const unknown = await (await post(base, "/api/ansim/analyze", {
      notice: { title: "처음 보는 상품", url: "", rows: [] }, mall: "coupang", profile: { age: 6 }
    })).json();
    assert.equal(unknown.analysis.score, null);
  });
});
