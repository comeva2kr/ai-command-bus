// 안드로이드 앱 ↔ 서버 계약. CI는 안드로이드 빌드를 돌리지 않으므로, 앱 단위 테스트가 쓰는
// 서버 응답 픽스처(android/ansim/app/src/test/resources/analyze-response.json)가 지금 서버
// 출력과 같은지 여기서 확인한다. 다르면 앱의 AnalyzeResult.parse가 낡은 모양을 믿고 있다는 뜻 —
// 픽스처를 다시 만들고(아래 요청 그대로) 앱 파서를 확인할 것.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/ansim/server.js";
import { MALL_IDS } from "../src/ansim/core/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "android/ansim/app/src");

const REQUEST = {
  notice: {
    title: "분홍 어육소시지", url: "",
    rows: [
      ["식품의 유형", "어육소시지"],
      ["원재료명 및 함량", "연육(외국산:실꼬리돔) 45%, 소맥분(밀:미국산), 정제수, 돼지고기(국산), 옥수수전분, 설탕, 정제소금, L-글루탐산나트륨(향미증진제), 적색제3호, 아질산나트륨(발색제), 소르빈산칼륨(보존료), 폴리인산나트륨"],
      ["영양성분", "1회 섭취참고량 70g당 150kcal 나트륨 620mg 당류 4g 포화지방 2g 단백질 6g"],
      ["알레르기 유발물질", "밀, 돼지고기, 대두 함유"]
    ]
  },
  profile: { age: 6, allergies: [], concerns: ["attention"] },
  mall: "coupang"
};

// 앱(AnsimApi.kt)이 읽는 필드만 남긴다
const appView = (r) => ({
  product: { name: r.product.name },
  analysis: {
    score: r.analysis.score,
    verdict: r.analysis.verdict,
    reasons: r.analysis.reasons.map(({ title, detail, evidence, block }) => ({ title, detail, evidence, block: Boolean(block) })),
    notes: r.analysis.notes,
    highlights: r.analysis.highlights
  },
  alternatives: r.alternatives.map((a) => ({
    tier: a.tier,
    product: { name: a.product.name, sample: a.product.sample },
    score: a.analysis.score,
    improvements: a.improvements,
    links: a.links.map(({ label, url, kind }) => ({ label, url, kind }))
  }))
});

test("앱 픽스처가 지금 서버 응답과 같은 모양·값이다", async () => {
  const server = createServer({ fetchProduct: async () => null });
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/ansim/analyze`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(REQUEST)
    });
    const live = await res.json();
    const fixture = JSON.parse(fs.readFileSync(path.join(app, "test/resources/analyze-response.json"), "utf8"));
    assert.deepEqual(appView(live), appView(fixture));
  } finally {
    server.close();
  }
});

test("안드로이드 몰 id가 웹 코어의 몰 id와 같다", () => {
  const kt = fs.readFileSync(path.join(app, "main/java/kr/ansim/scan/Malls.kt"), "utf8");
  const ids = [...kt.matchAll(/Mall\("([\w]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, MALL_IDS);
});

test("앱 매니페스트: 접근성 서비스는 바인드 권한으로 보호되고 내보내지 않는다", () => {
  const xml = fs.readFileSync(path.join(app, "main/AndroidManifest.xml"), "utf8");
  const service = xml.match(/<service[\s\S]*?<\/service>/)[0];
  assert.match(service, /android:permission="android\.permission\.BIND_ACCESSIBILITY_SERVICE"/);
  assert.match(service, /android:exported="false"/);
  assert.doesNotMatch(xml, /<uses-permission[^>]*SYSTEM_ALERT_WINDOW/);   // 탭은 접근성 오버레이로 그린다
});
