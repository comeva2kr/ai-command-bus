// 읽던 자리 복원 — 판정 규칙 (David 2026-08-05 2차 리포트 4번, "심각")
//
// 화면 코드라 브라우저 없이는 안 도는 부분이 많지만, **어려운 건 판정 규칙**이다:
// 스스로 새로고침한 것과 브라우저가 탭을 버린 것을 갈라야 하고, 잘못 갈리면
// David의 기존 규칙("새로고침 = 홈")이 깨진다. 그래서 규칙 함수만 index.html에서
// 그대로 떼어내 실행한다 — 복붙하면 원본이 바뀌어도 테스트가 통과해 버린다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
const from = html.indexOf("const READ_KEY");
const to = html.indexOf("async function resumeOrLoad");
assert.ok(from > 0 && to > from, "index.html에서 복원 규칙 블록을 못 찾았다 — 테스트가 원본을 놓쳤다");
const BLOCK = html.slice(from, to);

function load({ record, state, hash = "", now = 1_000_000 }) {
  const store = new Map();
  if (record !== undefined) store.set("feed_reading", JSON.stringify(record));
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k)
  };
  const fn = new Function(
    "sessionStorage", "state", "location", "window", "Date",
    `${BLOCK}; return { resumable, saveReading, readSaved, clearReading };`
  );
  return fn(sessionStorage, state, { hash }, { scrollY: 900 }, { now: () => now });
}

const BASE_STATE = { sortMode: "hot", activeSource: null, pagesLoaded: 3 };
const FRESH = { y: 900, pages: 3, sort: "hot", source: "", hidden: true, at: 1_000_000 - 60_000 };

test("복원: 숨겨진 뒤 죽었으면 읽던 자리로 되돌린다", () => {
  const api = load({ record: FRESH, state: BASE_STATE });
  assert.ok(api.resumable(), "앱 전환 후 탭 폐기는 사고다 — 복원해야 한다");
});

test("복원: 보고 있는 상태에서 죽었으면 홈으로 (David 새로고침 규칙)", () => {
  // 당겨서 새로고침은 화면을 보면서 하는 행동이다. 여기서 자리를 되돌리면
  // "새로고침 = 홈 다시 보기"(2026-08-01)가 깨진다.
  const api = load({ record: { ...FRESH, hidden: false }, state: BASE_STATE });
  assert.equal(api.resumable(), null);
});

test("복원: 30분 지난 기록은 쓰지 않는다", () => {
  const api = load({ record: { ...FRESH, at: 1_000_000 - 31 * 60_000 }, state: BASE_STATE });
  assert.equal(api.resumable(), null, "그 사이 새 화제글이 올라온다 — 옛 자리로 되돌릴 이유가 없다");
});

test("복원: 정렬·소스가 바뀌었으면 다른 목록이다", () => {
  assert.equal(load({ record: FRESH, state: { ...BASE_STATE, sortMode: "latest" } }).resumable(), null);
  assert.equal(load({ record: FRESH, state: { ...BASE_STATE, activeSource: "ppomppu" } }).resumable(), null);
});

test("복원: 첫 화면 언저리면 되돌릴 것이 없다", () => {
  assert.equal(load({ record: { ...FRESH, y: 120 }, state: BASE_STATE }).resumable(), null);
});

test("복원: 딥링크로 들어왔으면 상세를 여는 것이 먼저다", () => {
  const api = load({ record: FRESH, state: BASE_STATE, hash: "#post-abc" });
  assert.equal(api.resumable(), null);
});

test("복원: 기록이 없거나 깨졌어도 죽지 않는다", () => {
  assert.equal(load({ state: BASE_STATE }).resumable(), null);
  const api = load({ record: FRESH, state: BASE_STATE });
  api.clearReading();
  assert.equal(api.resumable(), null);
});

test("복원: 저장은 화면을 보고 있었는지를 함께 남긴다", () => {
  const api = load({ state: BASE_STATE });
  api.saveReading(true);
  const r = api.readSaved();
  // 이 한 칸이 새로고침과 사고를 가른다
  assert.equal(r.hidden, true);
  assert.equal(r.y, 900);
  assert.equal(r.pages, 3);
});

test("복원: 배선이 실제로 걸려 있다", () => {
  // 규칙이 맞아도 부르는 곳이 없으면 아무 일도 안 일어난다.
  assert.match(html, /updateMeter\(s\); resumeOrLoad\(\);/, "boot가 아직 loadMore를 직접 부른다");
  assert.match(html, /state\.pagesLoaded\+\+/, "페이지 수를 안 세면 복원할 분량을 모른다");
  assert.match(html, /clearReading\(\);\s*\/\/ 스스로 새로고침/, "명시적 새로고침이 기록을 안 버린다");
});
