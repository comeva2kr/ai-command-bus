// 읽던 자리 복원 — 판정 규칙 (David 2026-08-05 2차 리포트 4번, "심각")
//
// 어려운 건 규칙이다: 스스로 새로고침한 것과 브라우저가 탭을 버린 것을 갈라야
// 하고, 잘못 갈리면 David의 기존 규칙("새로고침 = 홈")이 깨진다.
//
// ── 첫 판은 틀렸다 (적대적 검수가 잡았다)
// "언로드 시점에 화면이 숨겨져 있었는가"로 가르려 했다. 그런데 문서를 떠날 때
// 브라우저는 visibilitychange를 hidden으로 한 번 발화한 뒤 pagehide를 보낸다.
// 그래서 당겨서 새로고침처럼 **빤히 보면서 하는 행동에서도** 기록이 hidden=true가
// 된다 — 신호가 상시 참으로 굳어 아무것도 가르지 못했다.
// 지금은 **떠나 있던 시간**으로 가른다. 브라우저 이벤트 순서에 기대지 않는다.
//
// 규칙 함수는 index.html에서 그대로 떼어내 실행한다 — 복붙하면 원본이 바뀌어도
// 통과해 버린다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
const from = html.indexOf("function resumeDecision(r, ctx){");
const to = html.indexOf("function resumable(){");
assert.ok(from > 0 && to > from, "index.html에서 판정 함수를 못 찾았다 — 테스트가 원본을 놓쳤다");
const DECIDE = new Function(
  "RESUME_MAX_AGE_MS", "RESUME_MAX_PAGES", "RESUME_MIN_Y", "RESUME_MIN_AWAY_MS", "RESUME_RELOAD_AWAY_MS",
  html.slice(from, to) + "; return resumeDecision;"
)(30 * 60 * 1000, 6, 240, 15 * 1000, 2 * 60 * 1000);

const NOW = 1_000_000_000;
const REC = { y: 900, pages: 3, sort: "hot", source: "", at: NOW - 5 * 60_000 };
const CTX = { now: NOW, navKind: "navigate", sortMode: "hot", source: null, hash: "" };
const decide = (rec = REC, ctx = {}) => DECIDE(rec, { ...CTX, ...ctx });

test("복원: 오래 떠나 있었으면 읽던 자리로 되돌린다", () => {
  const d = decide();
  assert.ok(d, "5분 자리를 비웠으면 사고다 — 복원해야 한다");
  assert.equal(d.y, 900);
  assert.equal(d.pages, 3);
  assert.equal(d.clipped, false);
});

test("복원: 곧바로 돌아왔으면 스스로 새로고침한 것이다 (David 새로고침 규칙)", () => {
  // 당겨서 새로고침은 1~3초면 돌아온다. 여기서 자리를 되돌리면
  // "새로고침 = 홈 다시 보기"(2026-08-01)가 깨진다.
  assert.equal(decide({ ...REC, at: NOW - 2_000 }), null);
  assert.equal(decide({ ...REC, at: NOW - 14_999 }), null, "15초 문턱 바로 아래");
  assert.ok(decide({ ...REC, at: NOW - 15_000 }), "문턱을 넘으면 복원");
});

test("복원: 새로고침으로 잡힌 진입은 문턱이 2분이다", () => {
  // 느린 회선에서 당겨서 새로고침이 20초 걸릴 수 있다. 그때도 홈이어야 한다.
  const slowRefresh = { ...REC, at: NOW - 20_000 };
  assert.ok(decide(slowRefresh), "보통 진입이면 20초는 떠나 있던 것으로 본다");
  assert.equal(decide(slowRefresh, { navKind: "reload" }), null, "느린 새로고침을 복원하면 안 된다");
  // 탭 폐기가 reload로 잡히는 브라우저도 있다 — 오래 떠나 있었으면 복원한다
  assert.ok(decide({ ...REC, at: NOW - 5 * 60_000 }, { navKind: "reload" }));
});

test("복원: 30분 지난 기록은 쓰지 않는다", () => {
  assert.equal(decide({ ...REC, at: NOW - 31 * 60_000 }), null,
    "그 사이 새 화제글이 올라온다 — 옛 자리로 되돌릴 이유가 없다");
});

test("복원: 시계가 뒤로 간 기록은 믿지 않는다", () => {
  assert.equal(decide({ ...REC, at: NOW + 60_000 }), null);
});

test("복원: 정렬·소스가 바뀌었으면 다른 목록이다", () => {
  assert.equal(decide(REC, { sortMode: "latest" }), null);
  assert.equal(decide(REC, { source: "ppomppu" }), null);
  assert.ok(decide({ ...REC, source: "ppomppu" }, { source: "ppomppu" }), "같으면 복원");
});

test("복원: 첫 화면 언저리면 되돌릴 것이 없다", () => {
  assert.equal(decide({ ...REC, y: 240 }), null);
  assert.equal(decide({ ...REC, pages: 0 }), null);
});

test("복원: 딥링크로 들어왔으면 상세를 여는 것이 먼저다", () => {
  assert.equal(decide(REC, { hash: "#post-abc" }), null);
});

test("복원: 기록이 없거나 깨졌어도 죽지 않는다", () => {
  assert.equal(decide(null), null);
  assert.equal(DECIDE(undefined, CTX), null);   // 헬퍼 기본값을 우회해 직접 넣는다
});

test("복원: 너무 깊이 읽었으면 근처까지만 되돌리고 그렇다고 말한다", () => {
  const d = decide({ ...REC, pages: 20 });
  assert.equal(d.pages, 6, "60건 넘게 다시 불러오면 복원 대기가 더 답답하다");
  assert.equal(d.clipped, true, "정확한 자리가 아님을 문구가 알려야 한다");
});

test("복원: 배선이 실제로 걸려 있다", () => {
  // 규칙이 맞아도 부르는 곳이 없으면 아무 일도 안 일어난다.
  assert.match(html, /resumeOrLoad\(\)\.then\(\(\)=> setupInfiniteScroll\(\)\)/,
    "무한스크롤을 복원 전에 걸면 필요 없는 페이지까지 받아온다");
  assert.match(html, /state\.pagesLoaded\+\+/, "페이지 수를 안 세면 복원할 분량을 모른다");
  // 명시적 새로고침(둘 다)은 기록을 버려야 한다
  const reload = html.slice(html.indexOf("function reloadFeed(msg){"), html.indexOf("function reloadFeed(msg){") + 1400);
  assert.match(reload, /clearReading\(\)/, "새로고침이 읽던 자리를 안 버린다");
  const silent = html.slice(html.indexOf("function reloadFeedSilently(){"), html.indexOf("function reloadFeedSilently(){") + 400);
  assert.match(silent, /clearReading\(\)/, "취향 조정으로 목록이 바뀌는데 옛 좌표가 남는다");
  // 복원 중 오탭 방지
  assert.match(html, /feed\.style\.pointerEvents = "none"/, "복원 중 카드를 누르면 엉뚱한 글이 열린다");
});
