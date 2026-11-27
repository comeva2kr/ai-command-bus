// 안심스캔 확장에 코어 엔진과 예시 카탈로그를 복사한다.
// 크롬 확장은 자기 디렉터리 밖 파일을 못 읽어서 복사본이 필요하다.
// test/ansim-extension.test.js가 복사본이 원본과 같은지 확인한다 —
// 코어를 고쳤으면 이 스크립트를 다시 돌릴 것: node tools/build-ansim-extension.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcCore = path.join(root, "src/ansim/core");
const ext = path.join(root, "extension/ansim");

fs.rmSync(path.join(ext, "core"), { recursive: true, force: true });
fs.mkdirSync(path.join(ext, "core"), { recursive: true });
fs.mkdirSync(path.join(ext, "data"), { recursive: true });
for (const f of fs.readdirSync(srcCore).filter((f) => f.endsWith(".js"))) {
  fs.copyFileSync(path.join(srcCore, f), path.join(ext, "core", f));
}
fs.copyFileSync(path.join(root, "src/ansim/data/sample-catalog.json"), path.join(ext, "data/sample-catalog.json"));
console.log("extension/ansim 갱신 완료");
