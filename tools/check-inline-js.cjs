#!/usr/bin/env node
// index.html의 인라인 자바스크립트를 실제로 파싱해 문법을 검사한다.
//
// 왜 필요한가 (2026-08-04): 이 파일은 단일 HTML에 앱 전체가 들어 있어서
// 편집 실수로 객체 리터럴 중간을 자르면 앱이 통째로 죽는다. 실제로 오늘
// API 객체 중간에 코드를 끼워 넣어 뒤쪽 메서드가 전부 사라진 적이 있다.
// 배포 전에 여기서 걸러야 한다.
//
// 주의: type="application/ld+json"은 JS가 아니고, type="module"은 모듈
// 파서로 읽어야 한다 — 둘을 구분하지 않으면 정상 파일도 오류로 잡힌다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const file = process.argv[2] || "src/feed/public/index.html";
const html = fs.readFileSync(file, "utf8");
const opens = [...html.matchAll(/<script([^>]*)>/g)];
let checked = 0, bad = 0;

for (const o of opens) {
  const attrs = o[1] || "";
  if (/\bsrc=/.test(attrs)) continue;                    // 외부 파일
  const type = (attrs.match(/type\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  if (type && !/^(module|text\/javascript|application\/javascript)$/.test(type)) continue; // JSON-LD 등
  const start = o.index + o[0].length;
  const end = html.indexOf("</script>", start);
  if (end < 0) continue;
  const body = html.slice(start, end);
  const tmp = path.join(os.tmpdir(), `inline-${checked}-${process.pid}.${type === "module" ? "mjs" : "cjs"}`);
  fs.writeFileSync(tmp, body);
  checked++;
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    bad++;
    const msg = (e.stderr || Buffer.from("")).toString().split("\n").slice(0, 6).join("\n");
    console.error(`✗ ${file} 인라인 스크립트 #${checked} (type="${type || "classic"}")\n${msg}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}
console.log(bad ? `문법 실패 ${bad}/${checked}` : `문법 OK (${checked}개 인라인 스크립트)`);
process.exit(bad ? 1 : 0);
