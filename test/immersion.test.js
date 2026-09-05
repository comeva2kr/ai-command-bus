// 몰입 모드 = 1콘텐츠 1화면 (David 2026-08-02) 회귀 방지.
//
// 이 파일은 소스 형태를 검사한다 — 테스트 환경에 DOM 엔진이 없어서 레이아웃을
// 실제로 계산할 수 없기 때문이다. 그래서 "동작한다"는 보증은 여기서 나오지
// 않는다. 실제 검증은 로컬 실측으로 했다(FEED_LIVE 서버 + 375x812 뷰포트,
// 실사진 포함 카드 20장):
//   카드 높이 686px = 피드 높이 686px (모든 카드 동일)
//   scrollHeight > clientHeight 인 카드 0장  → 잘리는 내용 없음
//   필수 요소 누락 카드 0장                   → 일반 모드 요소가 전부 들어옴
//   사진 345~421px                            → 화면의 절반 이상
// 여기서 고정하는 것은 그때 깨졌던 **특정 조건들**이다. 값이 바뀌면 실측을
// 다시 하고 이 파일을 갱신할 것 — 통과했다고 화면이 맞다는 뜻은 아니다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html"), "utf8");

test("몰입: 카드 높이가 피드의 실측 높이(--imm-h)를 쓴다", () => {
  // 예전 버그: `100vh - var(--header-h)`로 계산했는데 피드 위에는 헤더 말고도
  // 브리핑 스트립·정렬바가 더 쌓인다. 그만큼 카드가 화면보다 커져서 스냅이
  // 한 칸에 안 맞고 매번 조금씩 밀렸다.
  assert.match(html, /body\.immersion #feed\{height:var\(--imm-h/,
    "피드 높이는 실측값 기준이어야 한다");
  assert.match(html, /body\.immersion #feed \.card\{height:var\(--imm-h/,
    "카드 높이도 같은 실측값이어야 한다 (피드와 어긋나면 스냅이 깨진다)");
  assert.doesNotMatch(html, /body\.immersion[^{]*\.card\s*\{[^}]*min-height:\s*calc\(100vh/,
    "구버전의 min-height:calc(100vh…)가 남아 있으면 카드가 다시 화면보다 커진다");
});

test("몰입: --imm-h를 재는 함수가 있고 리사이즈·회전에 다시 잰다", () => {
  assert.match(html, /function setImmersionHeight\(\)/);
  assert.match(html, /getBoundingClientRect\(\)\.top/, "피드의 실제 상단 좌표로 재야 한다");
  assert.match(html, /addEventListener\("resize", onImmersionResize\)/,
    "모바일 주소창이 접히면 높이가 변한다");
  assert.match(html, /addEventListener\("orientationchange", onImmersionResize\)/);
});

test("몰입: 정확히 한 콘텐츠씩 넘어간다 (scroll-snap-stop)", () => {
  assert.match(html, /scroll-snap-type:y mandatory/);
  assert.match(html, /scroll-snap-align:start;scroll-snap-stop:always/,
    "stop:always가 없으면 세게 튕길 때 두세 칸이 한 번에 지나간다");
});

test("몰입: 종료된 브리핑 스트립이 공간을 차지하지 않는다", () => {
  assert.doesNotMatch(html, /id="briefStrip"|id="ownBlock"/);
});

test("몰입: 사진이 남는 공간을 갖고, 글이 길면 사진이 줄어든다", () => {
  // 이 배분 방향이어야 "사진 중심"과 "내용 전부 보이기"가 동시에 성립한다.
  // 사진에 고정 높이를 주면 둘 중 하나는 반드시 화면 밖으로 나간다.
  assert.match(html, /body\.immersion #feed \.card \.card-thumb\{order:1;flex:1 1 0;min-height:0/,
    "사진은 flex:1 1 0 + min-height:0 이어야 스스로 줄어든다");
  assert.match(html, /body\.immersion #feed \.card \.card-main\{[^}]*flex:none/,
    "본문은 자기 자연 높이를 지켜야 잘리지 않는다");
});

test("몰입: 화면 높이에 따라 제목·발췌 줄 수가 달라진다 (능동적 크기조절)", () => {
  // 글이 무한정 자라면 사진이 0이 되므로 클램프로 상한을 준다.
  // 화면이 길수록 더 보여준다 — JS 측정 없이 CSS만으로 돌아 비용이 없다.
  for (const h of [700, 800, 900]) {
    assert.ok(html.includes(`@media (min-height:${h}px)`),
      `min-height:${h}px 구간의 클램프가 있어야 한다`);
  }
  assert.match(html, /body\.immersion #feed \.card h3\{[^}]*-webkit-line-clamp:3/);
});

test("몰입: 마크업을 갈라놓지 않는다 (일반 모드와 같은 카드 HTML)", () => {
  // .card-row에 display:contents를 걸어 자식이 카드의 직계 flex 아이템이 되게 한다.
  // 모드별로 다른 템플릿을 쓰면 카드 이벤트 핸들러가 두 벌이 되고, 한쪽만
  // 고치는 사고가 반드시 난다.
  assert.match(html, /body\.immersion #feed \.card \.card-row\{display:contents\}/);
});

test("몰입 레이아웃 정의가 한 곳에만 있다", () => {
  // 예전엔 두 블록에 흩어져 CSS 순서로 서로를 덮어썼고, 어느 값이 실제로 먹는지
  // 추적이 불가능했다.
  const defs = html.match(/body\.immersion #feed \.card\{height:/g) || [];
  assert.equal(defs.length, 1, "카드 높이 정의는 한 번만 나와야 한다");
});
