// 안심스캔 확장 — 코어 복사본이 원본과 같은지, 매니페스트가 필요한 파일을 가리키는지.
// 실패하면: node tools/build-ansim-extension.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/ansim/core");
const ext = path.join(root, "extension/ansim");

test("확장의 core/와 예시 카탈로그가 원본과 같다", () => {
  const files = fs.readdirSync(src).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(fs.readdirSync(path.join(ext, "core")).sort(), files);
  for (const f of files) {
    assert.equal(fs.readFileSync(path.join(ext, "core", f), "utf8"), fs.readFileSync(path.join(src, f), "utf8"), `core/${f} 복사본이 낡았습니다`);
  }
  assert.equal(
    fs.readFileSync(path.join(ext, "data/sample-catalog.json"), "utf8"),
    fs.readFileSync(path.join(root, "src/ansim/data/sample-catalog.json"), "utf8")
  );
});

test("코어는 브라우저에서 돌아야 한다 — node 전용 import 금지", () => {
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".js"))) {
    const code = fs.readFileSync(path.join(src, f), "utf8");
    assert.doesNotMatch(code, /from\s+["']node:|require\(/, `${f}가 node 전용 모듈을 씁니다`);
  }
});

test("매니페스트: MV3, 콘텐츠 스크립트·웹 리소스가 실제 파일을 가리킨다", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));
  assert.equal(m.manifest_version, 3);
  for (const js of m.content_scripts.flatMap((c) => c.js)) assert.ok(fs.existsSync(path.join(ext, js)), js);
  assert.ok(fs.existsSync(path.join(ext, m.options_page)));
  assert.ok(m.web_accessible_resources[0].resources.includes("core/*.js"));
  // 아이 건강 정보는 기기 밖으로 동기화하지 않는다
  assert.doesNotMatch(fs.readFileSync(path.join(ext, "content.js"), "utf8"), /storage\.sync/);
});
