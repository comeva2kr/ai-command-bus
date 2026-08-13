import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = fs.readFileSync(path.join(ROOT, "src/feed/public/today.html"), "utf8");
const live = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");

test("오늘·실시간: 두 화면이 같은 순서와 활성 표시를 유지한다", () => {
  assert.match(today, /data-view-switch data-active="today"/);
  assert.match(live, /data-view-switch data-active="live"/);
  for (const html of [today, live]) {
    assert.match(html, /data-view="today"[^>]*>오늘<\/a>[\s\S]*data-view="live"[^>]*>실시간<\/a>/);
    assert.match(html, /class="view-indicator"/);
    assert.match(html, /flex:0 0 248px/);
    assert.match(html, /flex-basis:112px/);
    assert.match(html, /지금핫[\s\S]{0,180}NowHot[\s\S]{0,180}맞춰가는 중/);
    assert.match(html, /\.brand-en\{display:none\}/,
      "모바일에서는 영문만 숨기고 지금핫·대표문구는 유지한다");
  }
});

test("오늘·실시간: 표시선이 먼저 움직인 뒤 이동하며 모션 축소 설정을 존중한다", () => {
  for (const html of [today, live]) {
    assert.match(html, /nav\.dataset\.target=target/);
    assert.match(html, /setTimeout\(\(\)=>location\.assign\(link\.href\),reduced\?0:210\)/);
    assert.match(html, /prefers-reduced-motion:reduce/);
  }
});

test("오늘판 폴백 고지: 제공된 실제 날짜·슬롯·최신판 아님이 화면 문구에 있다 (S3a, 2026-08-13)", () => {
  // API의 fallback·servedDate 존재만으로 완료 처리하지 않는다 — 사용자
  // 화면 문구가 serving 영수증(servedDate·servedSlotId) 기준으로
  // "N월 N일 X판을 보여드리고 있습니다"를 말해야 한다 (David 확정 지시).
  assert.match(today, /serving\?\.servedSlotId/,
    "슬롯은 폴백 판 자체가 아니라 serving 영수증의 servedSlotId를 쓴다");
  assert.match(today, /serving\?\.servedDate/,
    "날짜는 generatedAt이 아니라 serving 영수증의 servedDate를 쓴다");
  assert.match(today, /판을 보여드리고 있습니다 · 최신 /,
    "제공 중인 판과 '최신판 아님'을 한 문장으로 명시한다");
});
