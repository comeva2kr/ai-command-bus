import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// 앱 전체가 단일 HTML에 들어 있어서, 편집 실수로 객체 리터럴 중간을 자르면
// 앱이 통째로 죽는다. 실제로 2026-08-04에 API 객체 한가운데에 코드를 끼워 넣어
// 뒤쪽 메서드가 전부 사라진 적이 있다 — 테스트가 없으면 배포 후에야 안다.
// (메뉴 버튼이 두 번 재발한 것과 같은 계열의 사고다.)
for (const file of [
  "src/feed/public/index.html",
  "src/feed/public/admin.html",
  "src/feed/public/editorial-desk.html",
  "src/feed/public/today.html"
]) {
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
  // 인접성이 아니라 **조건**을 본다. 예전엔 두 줄이 붙어 있는지를 검사해서,
  // 사이에 variant 기록 한 줄이 들어간 것만으로 빨간불이 났다(2026-08-05).
  // 지켜야 할 것은 "애드핏이 아닐 때 이 슬롯의 노출이 기록된다"는 사실이다.
  const clientBlock = (html.match(/if\(!useAdfit\)\{[\s\S]{0,900}?\n    \}/) || [])[0] || "";
  assert.match(clientBlock, /observeAdImpression\(slot/, "클라이언트 쿠팡 카드 추적 누락");
  // 폴백 카드는 이제 애드핏 지면을 갈아치우지 않고 **새 카드(alt)**로 붙는다 —
  // 애드핏 심사는 지면이 설치돼 있어야 진행된다(2026-08-05 보류 사유).
  assert.match(html, /observeAdImpression\(alt, "feed-passback"\)/, "폴백 카드 추적 누락");
});

test("광고: 애드핏 심사 모드는 한 함수에서 판정하고 실시간 피드 단위를 비운다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  // 실측 2026-08-04: 심사 보류 상태의 애드핏은 onfail을 부르지 않으면서
  // 아무것도 안 보여준다. 크로스오리진이라 채워졌는지 알 수 없어 패스백으로도
  // 못 잡는다 — 유일하게 확실한 건 "승인 전에는 그리지 않는 것"이다.
  assert.match(src, /ADFIT_ENABLED === "1"/, "승인 플래그 게이트 누락");
  assert.match(src, /const adfitReviewMode = \(\) =>/,
    "심사 모드 판정을 한 곳에서 공유해야 한다");
  const gates = src.match(/ADFIT_ENABLED === "1"/g) || [];
  assert.equal(gates.length, 1, `심사 플래그 판정이 ${gates.length}곳으로 갈라졌다`);
  assert.match(src, /const adfit = \{ mobileUnit: null, reviewMode \}/,
    "자동 갱신되는 실시간 피드로 광고단위를 내려보내면 안 된다");
});

test("광고: 배너 이미지는 지연 로딩하지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  // 실측 2026-08-04: loading="lazy"를 건 광고 배너가 화면 안에 들어와도 요청이
  // 발생하지 않는 환경이 있었다(브라우저 재현: top 323, 뷰포트 812, complete=false.
  // eager로 바꾸자 즉시 320x100 로드). 안 보이면 수익이 0이라 여기만 예외로 둔다.
  for (const [file, re] of [
    ["src/feed/public/index.html", /class="go-img"[^>]*loading="eager"/],
    ["src/feed/server.js", /alt="\$\{escapeHtml\(brand\)\}" loading="eager"/]
  ]) {
    assert.match(readFileSync(file, "utf8"), re, `${file}: 광고 배너가 lazy로 되돌아갔다`);
  }
  // 본문 썸네일은 수십 장이라 lazy를 유지해야 한다 — 전부 eager로 바꾸면 안 된다.
  assert.match(readFileSync("src/feed/public/index.html", "utf8"),
    /card-thumb[^>]*>.*loading="lazy"/s, "본문 썸네일까지 eager로 바꾸면 안 된다");
});

test("번역 링크: 되는 척하는 버튼을 남겨 두지 않았다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // David 2026-08-05 실기기: 다크 모드에서 버튼이 배경에 묻혀 안 보였고,
  // 어렵게 찾아 눌렀더니 **번역 서비스 지역 제한 오류**가 떴다.
  // 안 되는 기능은 고쳐 살리기 전까지 화면에서 빼는 게 낫다(영문 처리는 후순위).
  assert.doesNotMatch(html, /translatedReadUrl/, "죽은 번역 링크가 아직 남아 있다");
  assert.doesNotMatch(html, /한글로 번역해서 보기/, "죽은 번역 버튼 문구가 남아 있다");
  assert.doesNotMatch(html, /translate\.google\.com/, "지역 제한에 걸리는 주소가 남아 있다");
  // 원문으로 가는 길은 막지 않았다 — 읽을 방법 자체가 사라지면 안 된다
  assert.match(html, /class="readmore"/, "원문 링크까지 사라졌다");
});

// ── 유입 경로 (2026-08-04, David "사람 유입량을 늘리는 가장 좋은 방법") ──────
test("발견 경로: 구글 Discover·카톡 공유 자격을 갖췄다", async () => {
  const { readFileSync, statSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const today = readFileSync("src/feed/public/today.html", "utf8");
  const server = readFileSync("src/feed/server.js", "utf8");

  // max-image-preview:large가 없으면 **구글 Discover 진입 자체가 안 된다.**
  // 뉴스성 사이트가 구글에서 받는 트래픽의 상당 부분이 그 경로다.
  for (const [name, src] of [["index.html", html], ["server.js", server]]) {
    assert.match(src, /max-image-preview:large/, `${name}: Discover 자격 미달`);
  }
  // 자체 콘텐츠 페이지가 정작 Discover가 가장 필요한 쪽인데, 처음엔 공유
  // 페이지에만 들어가 브리핑·랭킹이 빠져 있었다(배포 후 실측으로 발견).
  const shell = server.slice(server.indexOf("const editionShell ="), server.indexOf("const editionShell =") + 1200);
  assert.match(shell, /max-image-preview:large/, "editionShell(브리핑·랭킹)에 누락");
  assert.match(shell, /noindex,follow/, "얇은 페이지는 색인만 막는다");
  // og:image가 512 정사각 앱 아이콘이면 카톡 미리보기가 작은 정사각형으로 뜬다.
  // 한국에서 링크가 퍼지는 가장 큰 경로가 카톡이다.
  for (const [name, src] of [["index.html", html], ["today.html", today], ["server.js", server]]) {
    assert.match(src, /og\.png\?v=20260904-brand/, `${name}: 카카오 공유 이미지 캐시 버전 누락`);
  }
  assert.match(html, /og:image:width" content="1200"/);
  assert.ok(!/og:image[^>]*icon-512/.test(html), "앱 아이콘을 공유 이미지로 쓰면 안 된다");
  assert.match(html, /twitter:card" content="summary_large_image"/);
  // 이미지가 실제로 1200x630인지 — 규격이 안 맞으면 크롭되거나 작은 카드가 된다
  const png = readFileSync("src/feed/public/og.png");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(statSync("src/feed/public/og.png").size < 300_000, "공유 이미지가 너무 무거우면 미리보기가 안 뜬다");
});

test("색인: 실시간·집계 유틸리티는 열어 두되 noindex이고 sitemap에서 제외한다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /noindex,follow/, "색인만 막고 링크는 따라가게 둔다");
  const sitemap = src.slice(src.indexOf('if (p === "/sitemap.xml"'), src.indexOf('if (p === "/api/today"'));
  for (const path of ["/live", "/ranking/daily", "/trends", "/communities", "/keywords", "/keyword/", "/community/"]) {
    assert.ok(!sitemap.includes(`loc: "${path}"`) && !sitemap.includes(`loc: \`${path}`),
      `${path}가 sitemap 생성부에 남았다`);
  }
  assert.match(src, /inner, "\/communities", ownContentNav\("\/communities"\), "", true/);
  assert.match(src, /inner, "\/keywords", ownContentNav\("\/keywords"\), "", true/);
  assert.match(src, /inner, `\/community\/\$\{encodeURIComponent\(seg\)\}`, ownContentNav\(\), "", true/);
  assert.match(src, /inner, `\/keyword\/\$\{encodeURIComponent\(tag\)\}`, ownContentNav\(\), "", true/);
});

test("문장: 조사를 괄호로 얼버무리지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const { hasFinalConsonant, particle } = await import("../src/feed/server.js");
  const src = readFileSync("src/feed/server.js", "utf8");
  // "'xbox'이(가) 언급된"이 화면에 그대로 나갔다 — 기계가 만든 문장이라는
  // 표시가 노출된다는 검수 지적. 주석의 설명 문구는 남아 있어도 된다.
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/이\(가\)|을\(를\)|은\(는\)|와\(과\)/.test(code), "괄호 조사가 화면 문자열에 남아 있다");

  // 한글은 받침으로 갈린다
  assert.equal(hasFinalConsonant("삼성전자"), false);
  assert.equal(hasFinalConsonant("폭염"), true);
  // 영문·숫자는 한국인이 읽는 소리를 따른다
  assert.equal(hasFinalConsonant("xbox"), true, "엑스박스");
  assert.equal(hasFinalConsonant("ai"), false, "에이아이");
  assert.equal(hasFinalConsonant("llm"), true, "엘엘엠");
  // 빈 입력에 예외를 던지면 페이지가 통째로 죽는다
  assert.equal(hasFinalConsonant(""), false);
  assert.equal(hasFinalConsonant(null), false);
  assert.equal(particle("폭염", "이", "가"), "이");
  assert.equal(particle("엔비디아", "이", "가"), "가");
});

test("사이트맵: lastmod가 있어야 구글이 바뀐 걸 안다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  // 실측 2026-08-04: 61개 URL 전부 lastmod가 없었다. 3일 전 제출한 사이트맵이
  // 그 뒤 바뀐 걸 구글에 알릴 방법이 없던 상태다. changefreq·priority는
  // 구글이 사실상 무시한다고 공식적으로 밝혔고, 실제 신호는 lastmod 하나다.
  assert.match(src, /u\.mod \? `<lastmod>\$\{u\.mod\}<\/lastmod>` : ""/);
  // 지어내지 않는다 — 목록형은 마지막 수집 시각, 아카이브는 저장 시각,
  // 정책 문서는 파일 수정 시각이 진짜 값이다.
  assert.match(src, /const liveMod = isoOf\(engine\.lastRefreshedAt \|\| Date\.now\(\)\)/);
  assert.match(src, /fileMod\("terms\.html"\)/);
  assert.doesNotMatch(src, /urls\.push\(\{ loc: `\/briefing/, "종료 아카이브는 사이트맵에서 제외한다");
});

test("설명문: 없는 소스를 검색 스니펫에 광고하지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const server = readFileSync("src/feed/server.js", "utf8");
  // 실측 2026-08-04: 더쿠·루리웹은 수집이 멈춘 지 오래인데(0건, stalled)
  // 검색 설명문에서는 계속 "데려온다"고 말하고 있었다. 사실과 다른 서술이고,
  // 스니펫과 실제 화면이 다르면 사용자 만족도 신호를 직접 깎는다.
  const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
  for (const dead of ["더쿠", "루리웹"]) {
    assert.ok(!desc.includes(dead), `설명문에 죽은 소스: ${dead}`);
    assert.ok(!/더쿠·클리앙/.test(server), "서버 렌더 설명문에도 남아 있다");
  }
  // 네이버 웹마스터 권고 — 80자 이내
  assert.ok(desc.length <= 80, `설명문 ${desc.length}자 (80자 이내 권고)`);
  const og = html.match(/<meta property="og:description" content="([^"]*)"/)[1];
  assert.ok(og.length <= 80, `og:description ${og.length}자`);
});
