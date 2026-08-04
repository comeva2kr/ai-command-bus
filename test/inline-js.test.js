import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// 앱 전체가 단일 HTML에 들어 있어서, 편집 실수로 객체 리터럴 중간을 자르면
// 앱이 통째로 죽는다. 실제로 2026-08-04에 API 객체 한가운데에 코드를 끼워 넣어
// 뒤쪽 메서드가 전부 사라진 적이 있다 — 테스트가 없으면 배포 후에야 안다.
// (메뉴 버튼이 두 번 재발한 것과 같은 계열의 사고다.)
for (const file of ["src/feed/public/index.html", "src/feed/public/admin.html"]) {
  test(`인라인 자바스크립트 문법: ${file}`, () => {
    const out = execFileSync(process.execPath, ["tools/check-inline-js.cjs", file], { encoding: "utf8" });
    assert.match(out, /문법 OK/, out);
  });
}

// ── 광고 폴백 배선 (2026-08-04) ─────────────────────────────────────────────
//
// 애드핏이 심사 보류라 안 채워지는데 169px 빈 칸이 자리를 먹고 있었다
// (David 실기기 제보). 워터폴 패스백은 코드가 아니라 **배선**이라 단위
// 테스트로 잡기 어려우므로, 배선이 빠지지 않았는지를 계약으로 못 박는다.
// 오늘 메뉴 버튼이 두 번 재발한 것과 같은 계열의 사고 방지다.
test("광고: 애드핏 미충족 시 쿠팡으로 넘기는 배선이 살아 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 카카오 애드핏 공식 신호 — 이 속성이 없으면 콜백이 영영 안 불린다.
  assert.match(html, /data-ad-onfail="onAdfitNoAd"/, "애드핏 NO-AD 콜백 속성 누락");
  assert.match(html, /window\.onAdfitNoAd\s*=/, "콜백이 전역에 없으면 SDK가 못 찾는다(모듈 스코프)");
  assert.match(html, /typeof window !== "undefined"/, "전역 대입은 가드 안에 있어야 테스트 하네스가 깨지지 않는다");
  assert.match(html, /function adfitFallback\(/, "폴백 구현 누락");
  // SDK가 아예 못 뜨는 경우(차단 확장·네트워크)에도 빈 칸이 남으면 안 된다.
  assert.match(html, /sc\.onerror\s*=\s*\(\)\s*=>\s*adfitFallback/, "SDK 로드 실패 폴백 누락");
  assert.match(html, /ins\.querySelector\("iframe"\)\)\s*adfitFallback/, "타임아웃 안전망 누락");
});

test("광고: 서버·클라이언트 두 주입 경로가 광고를 연달아 붙이지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 실측 2026-08-04: 6·7번 자리에 광고 두 장이 연속으로 나갔다. 서버
  // (_monetize)와 클라이언트(maybeInsertAdfit)가 서로를 모르는 게 원인이었다.
  assert.match(html, /prevEl\.classList\.contains\("ad-card"\)/, "앞 카드가 광고인지 확인 누락");
  assert.match(html, /nextEl\.classList\.contains\("ad-card"\)/, "뒤 카드가 광고인지 확인 누락");
});

test("광고: 클라이언트가 끼운 카드도 노출이 기록된다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 이 경로는 측정 사각지대였다 — 서버가 보낸 카드만 추적되고 있었다.
  assert.match(html, /function observeAdImpression\(/);
  assert.match(html, /if\(!useAdfit\) observeAdImpression\(slot/, "클라이언트 쿠팡 카드 추적 누락");
  assert.match(html, /observeAdImpression\(slot, "feed-passback"\)/, "폴백 카드 추적 누락");
});
