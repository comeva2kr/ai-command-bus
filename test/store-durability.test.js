// 저장 내구성 — 전수검사 P0 (2026-08-05)
//
// 두 줄이 겹쳐 "손상 한 번 = 영구 소실"을 만들고 있었다:
//   ① 대상 파일에 곧바로 쓴다 → 쓰는 도중 죽으면 반쯤 쓰인 파일이 남는다
//   ② 읽기 실패를 조용히 삼키고 빈 상태로 시작한다 → 다음 저장이 원본을 덮어쓴다
// 정전이나 나쁜 타이밍의 재시작 한 번에 가입자·댓글·취향이 사라지고,
// 아무 로그도 없어 사라진 줄도 몰랐다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedStore as Store } from "../src/feed/store.js";

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-store-")), name);
}

test("저장: 중간 상태가 파일에 남지 않는다", () => {
  const file = tmpFile("db.json");
  const store = new Store({ file });
  store.createUser("u1");
  assert.ok(fs.existsSync(file), "저장이 안 됐다");
  // 임시 파일을 남기지 않는다 — 남으면 디스크가 서서히 찬다
  assert.ok(!fs.existsSync(`${file}.tmp`), "임시 파일이 치워지지 않았다");
  // 쓰인 것은 항상 온전한 JSON이다
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("저장: 손상된 파일을 만나면 멈춘다 — 빈 상태로 덮어쓰지 않는다", () => {
  const file = tmpFile("db.json");
  const first = new Store({ file });
  const user = first.createUser("keeper");
  first.addComment(user.id, "item1", "이 댓글이 사라지면 안 된다");
  const before = fs.readFileSync(file, "utf8");
  assert.ok(before.includes("이 댓글이 사라지면 안 된다"));

  // 쓰는 도중 죽은 것처럼 파일을 자른다
  fs.writeFileSync(file, before.slice(0, Math.floor(before.length / 2)));

  // 예전에는 여기서 빈 상태로 조용히 시작했고, 다음 저장이 원본을 지웠다.
  assert.throws(() => new Store({ file }), /저장 파일을 읽지 못했습니다/);

  // 손상본은 지우지 않고 옆에 치워 둔다 — 사람이 열면 상당 부분을 건진다
  const dir = path.dirname(file);
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith("db.json.corrupt-"));
  assert.equal(kept.length, 1, "손상본을 보존하지 않았다");
  assert.ok(fs.readFileSync(path.join(dir, kept[0]), "utf8").includes("keeper"));
});

test("저장: 파일이 아예 없으면 빈 상태로 시작한다 (첫 실행)", () => {
  const file = tmpFile("fresh.json");
  assert.doesNotThrow(() => new Store({ file }));
  const store = new Store({ file });
  assert.equal(store.getUser("없는사람"), null);
});

test("저장: 재시작해도 그대로 남는다", () => {
  const file = tmpFile("db.json");
  const a = new Store({ file });
  const u = a.createUser("survivor");
  a.addComment(u.id, "item9", "재시작 뒤에도 있어야 한다");

  const b = new Store({ file });
  const back = b.getUser(u.id);
  assert.ok(back, "사용자가 사라졌다");
  assert.equal((back.comments || []).length, 1);
  assert.equal(back.comments[0].body, "재시작 뒤에도 있어야 한다");
});
