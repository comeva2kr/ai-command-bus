// 새 브리핑 편성 알림 + 브리핑 본문 사이사이 연관 광고 (David 2026-08-06).
//
// "오늘의 브리핑 하루 세번 업데이트되면, 눌러서 보기전까지 보기좋게 깜빡이게
//  하자. 먼저 보기 유도하게. (그 안에도 연관 광고 사이사이 넣고) 고급스럽게
//  깜빡이자 튀지않고 은은하게."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = () => readFileSync("src/feed/public/index.html", "utf8");
const server = () => readFileSync("src/feed/server.js", "utf8");

test("편성 식별은 날짜+슬롯이다 — generatedAt이 아니다", () => {
  const h = html();
  // generatedAt은 재생성될 때마다 바뀐다. 그걸 쓰면 같은 편성인데도 계속
  // 새것으로 읽혀서, 이미 본 사람에게도 알림이 멈추지 않는다.
  assert.match(h, /function briefEditionId\(b\)/);
  assert.match(h, /\(b\.slot && b\.slot\.id\)/, "슬롯 id를 안 쓴다");
  // 한국 날짜로 잘라야 한다 — 서버가 UTC로 주므로 그냥 자르면 저녁 편성이
  // 다음 날로 넘어가 매일 밤 한 번씩 잘못 표시된다.
  assert.match(h, /9 \* 3600 \* 1000/, "KST 보정이 없다");
});

test("본 편성은 기억하고, 다시 깜빡이지 않는다", () => {
  const h = html();
  assert.match(h, /const BRIEF_SEEN_KEY = "nh_brief_seen"/);
  assert.match(h, /markBriefSeen\(edition\)/, "클릭 시 읽음 기록이 없다");
  assert.match(h, /classList\.remove\("is-new", ?"is-new-quiet"\)/, "누른 뒤에도 표시가 남는다");
  // 읽음 여부로 클래스가 갈린다
  assert.match(h, /const isNew = edition && briefSeen\(\) !== edition/);
});

test("깜빡임이 튀지 않는다 — 호흡, 그리고 움직임 축소 존중", () => {
  const h = html();
  // opacity 0↔1 점멸이 아니라 테두리·글로우가 차오르는 방식이어야 한다.
  assert.match(h, /@keyframes briefBreathe/);
  assert.match(h, /\.brief-card\.is-new\{[^}]*animation:briefBreathe 5s/,
    "주기가 5초가 아니다 — 빠르면 튄다");
  // 글자를 흔들면 읽는 데 방해가 된다.
  assert.ok(!/\.brief-card\.is-new \.bc-title\{[^}]*animation/.test(h),
    "제목에 애니메이션이 걸렸다");
  // 스트립 전체가 한꺼번에 맥동하면 은은한 게 아니라 화면이 깜빡이는 것이다.
  // 호흡하는 카드는 대표 한 장뿐이고, 카테고리 카드는 조용한 표시만 받는다.
  assert.match(h, /is-new-quiet/, "카테고리 카드까지 전부 호흡한다");
  assert.ok(!/\.brief-card\.is-new-quiet\{[^}]*animation/.test(h),
    "조용한 표시에 애니메이션이 걸렸다");
  // 움직임 축소 설정에서는 표식만 남기고 멈춘다 — 알림을 없애지는 않는다.
  const rm = h.match(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,400}?\}\s*\}/g) || [];
  assert.ok(rm.some((b) => b.includes(".brief-card.is-new")), "움직임 축소 대응이 없다");
});

test("브리핑 본문에 광고가 사이사이 들어간다", () => {
  const s = server();
  // 예전엔 가운데 딱 한 장이었다 — 9개 섹션짜리 글에 광고 하나면 대부분 지나친다.
  assert.match(s, /const BRIEF_AD_EVERY = 3/);
  assert.match(s, /\(secIdx \+ 1\) % BRIEF_AD_EVERY === 0/);
  // 마지막 섹션 뒤에는 놓지 않는다 — 글 끝에 광고만 남는 모양은 피한다.
  assert.match(s, /const isLast = secIdx === b\.sections\.length - 1/);
  assert.match(s, /mid && !isLast &&/);
});

test("브리핑 광고도 그 섹션의 상품군을 따라가되, 시사에는 걸지 않는다", () => {
  const s = server();
  assert.match(s, /destForText\(sec\.items\[0\] && sec\.items\[0\]\.title\)/,
    "섹션 대표 글로 상품군을 읽지 않는다");
  assert.match(s, /AD_MATCH_OFF_CATS\.has\(sec\.category\)/,
    "뉴스·시사 섹션에도 문맥 매칭이 걸린다");
  assert.match(s, /const AD_MATCH_OFF_CATS = new Set\(\["news", "politics"\]\)/);
});

test("배너를 도착지로 고를 수 있다 — 없으면 조용히 기존 순서로", async () => {
  const { pickBanner } = await import("../src/feed/manual-products.js");
  const want = pickBanner({ dest: "fresh" });
  assert.ok(want, "재고가 있는데 못 골랐다");
  assert.equal(want.dest, "fresh");
  // 없는 도착지를 달라고 해도 광고가 사라지면 안 된다.
  const fallback = pickBanner({ dest: "존재하지않는도착지" });
  assert.ok(fallback, "없는 도착지를 요청했더니 광고가 통째로 사라졌다");
});
