// 브리핑·중복제거·공유카드 — 2026-08-02 적대적 검수 확정분 회귀 방지.
import test from "node:test";
import assert from "node:assert/strict";

import { eventKey, normalizeForDedupe, isSameEvent, MIN_KEY_LEN } from "../src/feed/dedupe.js";
import { hasProfanity, maskProfanity } from "../src/feed/profanity.js";

// ---------------------------------------------------------------------------
// ② 제목 정규화 중복제거
// ---------------------------------------------------------------------------

test("dedupe: 말머리·매체명 꼬리만 다른 같은 기사를 하나로 본다", () => {
  // 실측: mk-news "[속보] 서울 전역 폭염경보…" 와 yna "서울 전역 폭염경보…"가
  // 첫 화면에 나란히 있었다. 구글뉴스 항목은 url이 불투명한 리다이렉트라
  // URL 기준으로는 원문 매체 기사와 절대 겹치지 않는다.
  assert.ok(isSameEvent(
    "[속보] 서울 전역 폭염경보·열대야주의보…시, 쪽방·고령층 특별관리",
    "서울 전역 폭염경보·열대야주의보…시, 쪽방·고령층 특별관리"));
  assert.ok(isSameEvent(
    "KTX-SRT 통합 효과…운임 10% 내리고 운행 횟수 늘어난다 - 연합뉴스",
    "KTX-SRT 통합 효과…운임 10% 내리고 운행 횟수 늘어난다"));
  assert.ok(isSameEvent("[단독][속보] 삼성전자 3분기 영업이익 발표",
                        "삼성전자 3분기 영업이익 발표"), "말머리가 여러 개 붙어도");
});

test("dedupe: 짧은 제목은 절대 묶지 않는다 (게시판 붕괴 방지)", () => {
  // 2026-08-01에 URL 정규화를 과하게 해서 뽐뿌 18건이 2건으로 붕괴한 적이 있다.
  // 커뮤니티에는 "ㅋㅋㅋ", "이거 실화냐" 같은 제목이 흔하므로 같은 사고가
  // 제목 쪽에서 반복되지 않도록 길이 하한을 둔다.
  for (const t of ["ㅋㅋㅋ", "이거 실화냐", "헐", "오늘 점심"]) {
    assert.equal(eventKey(t), null, `짧은 제목은 키를 만들지 않아야: ${t}`);
  }
  assert.ok(!isSameEvent("ㅋㅋㅋ", "ㅋㅋㅋ"), "글자가 같아도 짧으면 별개 글로 둔다");
  assert.ok(normalizeForDedupe("서울 전역 폭염경보 특별관리").length >= MIN_KEY_LEN);
});

test("dedupe: 다른 사건을 같은 것으로 묶지 않는다", () => {
  assert.ok(!isSameEvent("삼성전자 3분기 영업이익 발표했다고 합니다",
                         "삼성전자 4분기 영업이익 발표했다고 합니다"));
  assert.ok(!isSameEvent("서울 지역 폭염경보 발효되었습니다",
                         "부산 지역 폭염경보 발효되었습니다"));
});

// ---------------------------------------------------------------------------
// ① 브리핑 품질 — 비속어
// ---------------------------------------------------------------------------

test("비속어: 자체 발행 페이지에서 마스킹된다", () => {
  // 실측: /briefing 에 "개좆" 3회, /briefing/gaming 에 2회. 그중 2회는 커뮤니티
  // 원문이 아니라 사이트가 직접 쓴 서술문 안이었다. 심사원이 먼저 여는 페이지다.
  assert.ok(hasProfanity("개좆같은 상황"));
  assert.ok(!maskProfanity("개좆같은 상황").includes("좆"));
  assert.ok(maskProfanity("개좆같은 상황").includes("같은 상황"), "문장 나머지는 살린다");
});

test("비속어: 일상어를 오탐하지 않는다", () => {
  // 사전은 설명 가능해야 한다 — 일반어와 겹치는 단어는 애초에 넣지 않는다.
  for (const t of ["새끼손가락을 다쳤어요", "강아지 새끼 분양합니다",
                   "오늘 날씨 정말 좋다", "지랄맞은 날씨는 아니고"]) {
    assert.equal(hasProfanity(t), false, `오탐: ${t}`);
    assert.equal(maskProfanity(t), t, `건드리면 안 됨: ${t}`);
  }
});

test("브리핑: 외부 원문 발췌를 싣지 않는다 (애드핏 '외부 콘텐츠 비중' 대응)", async () => {
  // 2026-08-02에는 "발췌를 실어야 요약이 된다"고 판단해 summary를 넣었는데,
  // 2026-08-03 실측에서 그 자리에 원문 URL("https://xcancel.com/...")과 영어
  // 원문("Qwen Studio offers comprehensive functionality…")이 그대로 실리고
  // 있었다. 애드핏 보류 사유가 "외부 콘텐츠·외부 링크 비중"인데 그 지적을 우리
  // 손으로 증명하던 셈이라 계약을 뒤집었다.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/engine.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async briefing()"), src.indexOf("async briefing()") + 6000);
  assert.doesNotMatch(fn, /summary: i\.summary/, "브리핑 항목에 원문 발췌를 넘기면 안 된다");
  const server = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  assert.ok(!server.includes("briefingSummary"), "발췌 렌더러가 남아 있으면 안 된다");
});

test("브리핑: 이슈 문단이 본문이 된다 (자체 저작 문장)", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  // 구글 정책의 "논평·큐레이션·기타 부가가치" — 우리가 잰 값으로만 쓴 문장.
  const items = [
    { id: "a", title: "메모리 가격 역대 최고치 경신했다는 소식", sourceLabel: "비즈니스포스트",
      score: 0, commentCount: 0, coverage: 5, tags: ["메모리"] },
    { id: "b", title: "인벤에서 딜 계산 두고 벌어진 긴 논쟁", sourceLabel: "인벤",
      score: 140, commentCount: 300, coverage: 0, tags: [] },
    { id: "c", title: "해커뉴스 상위에 오른 새 오픈소스 도구", sourceLabel: "해커뉴스",
      score: 560, commentCount: 380, coverage: 0, tags: [] }
  ];
  const d = buildDigest(items);
  assert.ok(d.issues.length >= 3, "이슈가 만들어져야 한다");
  assert.ok(d.summary.length > 20, "종합 문단이 있어야 한다");
  // 참조 글에 원문 발췌 필드가 절대 실리면 안 된다
  for (const is of d.issues) {
    for (const r of is.refs) {
      assert.ok(!("summary" in r), "참조에 원문 발췌가 실리면 안 된다");
      assert.ok(!("url" in r), "브리핑은 내부 링크만 쓴다");
    }
    assert.ok(is.paragraph.length > 10, "문단이 비면 안 된다");
  }
  // 헤드라인이 서로 달라야 한다 — 같은 문장 반복이 "자체 콘텐츠로 안 보인다"의 원인
  const heads = d.issues.map((i) => i.headline);
  assert.equal(new Set(heads).size, heads.length, `헤드라인 중복: ${JSON.stringify(heads)}`);
});

test("브리핑: 이슈가 부족하면 발행하지 않는다 (빈 글 방지)", async () => {
  const { buildDigest, MIN_ISSUES } = await import("../src/feed/digest.js");
  // ⑤ 하루 3회 고정 편성이라, 수집이 멈춘 시간대에 알맹이 없는 페이지가
  // 발행될 수 있다. 빈 글은 자체 콘텐츠가 아니라 오히려 감점이다.
  const thin = buildDigest([
    { id: "x", title: "혼자 올라온 글 하나뿐입니다", sourceLabel: "어딘가",
      score: 3, commentCount: 0, coverage: 0, tags: [] }
  ]);
  assert.ok(thin.issues.length < MIN_ISSUES, "1건짜리는 발행 임계 미만이어야 한다");
});

test("브리핑: 수치가 자기모순이면 안 된다", async () => {
  const { issueParagraph, issueShape } = await import("../src/feed/digest.js");
  // 실측 사고: coverage=5인데 우리 풀엔 1건이라 "1곳이 함께 다뤘다"가 나왔다.
  const items = [{ id: "a", title: "여러 매체가 다루는 사안입니다 제목", sourceLabel: "한국방송뉴스",
    score: 0, commentCount: 0, coverage: 5, tags: [] }];
  const para = issueParagraph(items, issueShape(items));
  assert.doesNotMatch(para, /1곳이 함께 다뤘다/, "자기모순 문장이 나오면 안 된다");
  assert.match(para, /5개 매체/, "교차보도 수치를 정직하게 써야 한다");
});

test("브리핑: 같은 사건 중복과 한 매체 독식을 막는다", async () => {
  const src = (await import("node:fs")).readFileSync(
    new URL("../src/feed/engine.js", import.meta.url), "utf8");
  // 2026-08-04: 시그니처가 briefing({ slotId })로 바뀌었다 — 슬롯마다 창과
  // 해외 가중이 달라진다. 문자열로 자를 때 괄호까지 박아 두면 이렇게 깨진다.
  const at = src.indexOf("async briefing(");
  assert.ok(at > 0, "briefing 함수를 찾을 수 없다");
  const fn = src.slice(at, at + 9000);
  assert.match(fn, /eventKey\(i\.title\)/, "이벤트 키로 중복을 걸러야 한다");
  assert.match(fn, /perOutlet/, "한 매체가 섹션을 독식하지 않아야 한다");
  // 2026-08-04: 비속어만 보던 것을 promotable()로 넓혔다. 비속어에 더해
  // "그 커뮤니티 안에서만 통하는 글"(추천 구걸·모집 공고)도 대표 자리에서 뺀다 —
  // 브리핑 대표에 "300추 가능한가요?"가 올라온 실측이 있었다. 삭제가 아니라
  // 승격 제외라 피드에는 그대로 남는다(promotion.js).
  assert.match(fn, /promotable/, "대표 글 선정은 승격 가능 여부로 판단한다");
  // 하루 3편 — 슬롯마다 보는 구간과 해외 비중이 달라야 아침·점심·저녁이
  // 같은 글을 싣지 않는다(David 2026-08-04).
  assert.match(fn, /windowHours/, "슬롯별 시간 창");
  assert.match(fn, /overseasBias/, "아침에는 해외를 앞으로 당긴다");
});

// ---------------------------------------------------------------------------
// ③ 공유 카드 + 아이콘
// ---------------------------------------------------------------------------

test("공유: 글에 사진이 있으면 그 사진이 og:image가 된다", async () => {
  const src = (await import("node:fs")).readFileSync(
    new URL("../src/feed/server.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function sharePage("), src.indexOf("function sharePage(") + 2500);
  // 실측: /p?id= 5개 전부 og:image가 icon.svg 상수였는데, 같은 글의 API에는
  // 실제 사진이 있었다(피드 60건 중 45건 보유).
  assert.match(fn, /data\.image/, "아이템 사진을 써야 한다");
  assert.doesNotMatch(fn, /og:image" content="\$\{escapeHtml\(origin\)\}\/icon\.svg/,
    "로고 상수로 되돌아가면 안 된다");
  assert.match(fn, /summary_large_image/, "사진이 있으면 큰 카드로");
  assert.match(fn, /twitter:image/, "X는 twitter:image가 없으면 이미지 없음으로 확정한다");
  // 2026-08-04: 폴백을 og.png(1200x630)로 올렸다. 512 정사각 아이콘은
  // 카톡·X 미리보기에서 작은 정사각형으로 뜨고, 큰 카드 자격도 못 채운다.
  // PNG여야 하는 이유는 그대로다 — SVG를 미리보기로 안 쓰는 크롤러가 있다.
  assert.match(fn, /og\.png/, "폴백은 1200x630 PNG");
});

test("아이콘: PNG가 실제로 존재하고 PNG 시그니처를 갖는다", async () => {
  const fs = await import("node:fs");
  // 실측: 라스터 아이콘 14개 경로가 전부 404인데 head에는 iOS 설치 지원 태그가
  // 있었다 — 아이폰 홈화면에 추가하면 아이콘 자리가 빈다.
  for (const f of ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon-maskable-512.png"]) {
    const buf = fs.readFileSync(new URL(`../src/feed/public/${f}`, import.meta.url));
    assert.ok(buf.length > 500, `${f}: 너무 작다 (${buf.length}B)`);
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${f}: PNG 시그니처가 아니다`);
  }
  const manifest = JSON.parse(fs.readFileSync(
    new URL("../src/feed/public/manifest.webmanifest", import.meta.url), "utf8"));
  const pngs = manifest.icons.filter((i) => i.type === "image/png");
  assert.ok(pngs.length >= 3, "manifest가 PNG 아이콘을 선언해야 한다");
  assert.equal(manifest.icons[0].type, "image/png", "SVG를 못 읽는 런처를 위해 PNG가 먼저");
});

// ---------------------------------------------------------------------------
// 좋아요/싫어요 = 내용에 대한 의견 (David 2026-08-02)
// ---------------------------------------------------------------------------

test("태그: 제목에서 내용 특징을 뽑는다 (어댑터가 tags를 안 주므로)", async () => {
  const { extractTags } = await import("../src/feed/tags.js");
  // 라이브 실측 2026-08-02: 30건 전부 tags가 비어 있었다. 내용 특징이 0이면
  // 좋아요가 카테고리·소스로밖에 갈 곳이 없다.
  assert.deepEqual(extractTags("신형 그랜저 시승기 연비 실측"), ["그랜저", "시승", "연비"]);
  assert.ok(extractTags("손흥민 결승골 토트넘 승리").includes("손흥민"));
  assert.ok(extractTags("강 건넌 ERP 개발").includes("erp"), "영숫자 고유명사도 잡는다");
  // 사전에 없으면 억지로 만들지 않는다 — 조사·어미를 떼는 휴리스틱은 쓰레기
  // 태그를 만들고 그게 취향 벡터에 그대로 쌓인다.
  assert.deepEqual(extractTags("엄마 요새는 꺄! 를 어떻게 쓰는지 알아?"), []);
  // 두 글자 영문은 화이트리스트만 — 라이브에서 "'LJ와 이혼' 이선정"이 태그
  // ["lj"]를 만들었다. 사람 이니셜이 취향 벡터에 영구히 쌓이면 안 된다.
  assert.deepEqual(extractTags("'LJ와 이혼' 이선정 전남편에 나쁜 감정 없어"), []);
  assert.deepEqual(extractTags("AI 로봇 기반 기술 혁신"), ["ai"], "진짜 신호는 살린다");
});

test("좋아요 한 번은 카테고리 선언이 아니다 — 내용 쪽이 훨씬 크게 움직인다", async () => {
  const { applyFeedback, emptyPreferenceVector } = await import("../src/feed/recommender.js");
  const vec = emptyPreferenceVector();
  const item = { category: "auto", tags: ["그랜저", "시승"], source: "bobae", length: 200 };
  applyFeedback(vec, item, 1);
  // 제보 기전: 자동차 글 하나에 누른 좋아요가 곧 "자동차 좋아함" 선언이 되어
  // 피드가 자동차로 뒤덮였다("갑자기 자동차만 나온다").
  assert.ok(vec.tags["그랜저"] > vec.categories.auto * 2,
    `내용(${vec.tags["그랜저"]})이 카테고리(${vec.categories.auto})보다 확실히 커야 한다`);
  assert.ok(vec.categories.auto > 0, "그래도 약한 카테고리 신호는 남는다");
});

test("같은 카테고리를 반복해서 좋아하면 카테고리 취향이 쌓인다", async () => {
  const { applyFeedback, emptyPreferenceVector } = await import("../src/feed/recommender.js");
  const one = emptyPreferenceVector();
  applyFeedback(one, { category: "auto", tags: ["그랜저"], source: "bobae", length: 200 }, 1);

  const many = emptyPreferenceVector();
  // 서로 다른 자동차 글 여러 건 — 이건 진짜 카테고리 신호다
  for (const t of [["그랜저"], ["전기차"], ["시승"], ["연비"], ["타이어"], ["중고차"]]) {
    applyFeedback(many, { category: "auto", tags: t, source: "bobae", length: 200 }, 1);
  }
  assert.ok(many.categories.auto > one.categories.auto * 3,
    "반복된 일관 근거는 카테고리를 확실히 움직여야 한다");
});

// ---------------------------------------------------------------------------
// 검색 노출 배관 — 2026-08-03 서치콘솔 제출에서 실제로 막혔던 지점
// ---------------------------------------------------------------------------

test("HEAD 요청이 GET과 같은 상태코드를 준다 (sitemap '가져올 수 없음' 원인)", async () => {
  // 실측: 서치콘솔에 sitemap을 제출하니 "가져올 수 없음"이 떴다. XML은 유효하고
  // GET은 200인데 **HEAD가 404**였다 — 모든 라우트가 method==="GET"만 보기
  // 때문이다. 구글은 가져오기 전에 HEAD를 보내는 경우가 있다.
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    for (const path of ["/sitemap.xml", "/robots.txt", "/"]) {
      const head = await fetch(`http://127.0.0.1:${port}${path}`, { method: "HEAD" });
      const get = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(head.status, get.status, `${path}: HEAD와 GET 상태가 달라선 안 된다`);
      assert.equal(head.headers.get("content-type"), get.headers.get("content-type"),
        `${path}: HEAD도 같은 content-type을 줘야 한다`);
      const body = await head.text();
      assert.equal(body, "", `${path}: HEAD 응답에 본문이 있으면 안 된다`);
      await get.text();
    }
  } finally {
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  }
});

test("sitemap.xml이 유효한 XML이고 자체 콘텐츠 페이지를 담는다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /xml/);
    const xml = await res.text();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, /<\/urlset>\s*$/);
    // 자체 콘텐츠가 실려야 의미가 있다 — 이게 애드핏 지적에 대한 답이다
    // 오리진은 요청 호스트에서 만든다(originOf) — 테스트 서버는 127.0.0.1이다.
    // 도메인을 하드코딩하면 스테이징·로컬에서 틀린 sitemap이 나가는 것을 놓친다.
    const origin = `http://127.0.0.1:${port}`;
    for (const must of ["/briefing", "/ranking/daily", "/trends"]) {
      assert.ok(xml.includes(`<loc>${origin}${must}</loc>`), `sitemap에 ${must}가 없다`);
    }
    // 개인화 API는 색인 대상이 아니다
    assert.ok(!xml.includes("/api/"), "API 경로가 sitemap에 들어가면 안 된다");
  } finally {
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  }
});

test("robots.txt가 sitemap을 가리키고 개인화·관리 경로를 막는다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const txt = await (await fetch(`http://127.0.0.1:${port}/robots.txt`)).text();
    assert.ok(txt.includes(`Sitemap: http://127.0.0.1:${port}/sitemap.xml`),
      "robots가 자기 오리진의 sitemap을 가리켜야 한다");
    assert.match(txt, /Disallow: \/api\//);
    assert.match(txt, /Disallow: \/admin/);
    assert.match(txt, /Allow: \//, "자체 콘텐츠는 열려 있어야 한다");
  } finally {
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  }
});

test("자체 콘텐츠 페이지에 광고 지면이 있고, 광고 설정이 없으면 아무것도 안 나온다", async () => {
  // 2026-08-03 실측: /briefing·/ranking·/trends에 광고 코드가 0개였다.
  // sitemap에 올린 URL 대부분이 이 페이지들이고 검색 유입이 실제로 닿는
  // 화면인데 수익 지면이 없어 유입이 통째로 샜다.
  const { createServer } = await import("../src/feed/server.js");
  const prev = { a: process.env.ADSENSE_CLIENT, f: process.env.ADFIT_UNIT_MOBILE, e: process.env.ADFIT_ENABLED };
  try {
    // (1) 광고 설정이 있으면 지면이 붙는다
    process.env.ADSENSE_CLIENT = "ca-pub-TEST";
    process.env.ADFIT_UNIT_MOBILE = "DAN-TEST";
    // 2026-08-04: 애드핏은 승인 플래그가 켜져야만 지면을 차지한다. 심사 보류
    // 상태에서는 onfail도 안 부르면서 아무것도 안 보여줘 빈 칸만 남기 때문이다.
    process.env.ADFIT_ENABLED = "1";
    let server = createServer({ dev: true });
    await new Promise((r) => server.listen(0, r));
    let port = server.address().port;
    let html = await (await fetch(`http://127.0.0.1:${port}/briefing`)).text();
    assert.match(html, /adsbygoogle/, "애드센스 지면이 있어야 한다");
    assert.match(html, /kakao_ad_area/, "애드핏 지면이 있어야 한다");
    // 광고를 콘텐츠로 오인시키면 애드센스 정책 위반이자 신뢰 손실이다
    assert.match(html, /class="ad-mark"/, "AD 표기가 있어야 한다");
    // 본문보다 광고가 앞서면 안 된다 — 읽는 흐름을 끊으면 체류가 죽는다
    assert.ok(html.indexOf("<h1>") < html.indexOf('<div class="ad-slot">'),
      "본문이 광고보다 앞서야 한다");
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));

    // (2) 설정이 없으면 완전 무광고 — 광고 없는 배포에 빈 박스가 생기면 안 된다
    delete process.env.ADSENSE_CLIENT;
    delete process.env.ADFIT_UNIT_MOBILE;
    delete process.env.ADFIT_ENABLED;
    server = createServer({ dev: true });
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
    html = await (await fetch(`http://127.0.0.1:${port}/briefing`)).text();
    assert.doesNotMatch(html, /adsbygoogle/);
    assert.doesNotMatch(html, /kakao_ad_area/);
    // CSS 규칙(.ad-slot{})은 항상 있어도 무해하다 — 실제 지면 div만 없으면 된다
    assert.ok(!html.includes('<div class="ad-slot">'), '광고 설정이 없으면 지면이 없어야 한다');
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  } finally {
    if (prev.a) process.env.ADSENSE_CLIENT = prev.a; else delete process.env.ADSENSE_CLIENT;
    if (prev.f) process.env.ADFIT_UNIT_MOBILE = prev.f; else delete process.env.ADFIT_UNIT_MOBILE;
    if (prev.e) process.env.ADFIT_ENABLED = prev.e; else delete process.env.ADFIT_ENABLED;
  }
});

test("홈에 크롤러가 읽을 정적 글 목록이 심긴다 (네이버는 JS를 실행하지 않는다)", async () => {
  // 실측 2026-08-03: 홈 175KB 중 정적 텍스트가 1,499B(0%)였다. 크롤러가 읽는
  // 것은 "준비 중 / 메뉴 / 화면 테마"뿐이고 글 목록은 전부 JS로 그려진다.
  // 네이버는 자바스크립트를 거의 실행하지 않아 홈이 빈 페이지로 읽혔다.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");

  // 주입은 스켈레톤 자리를 대체한다 — 사용자도 같은 것을 본다(클로킹 아님)
  assert.match(src, /function serveStatic\(res, urlPath, seedHtml = ""\)/,
    "serveStatic이 seed를 받아야 한다");
  assert.match(src, /seedHtml && ext === "\.html" && rel === "index\.html"/);
  assert.match(src, /rankingTop\(20\)/, "홈 seed는 화제 랭킹에서 뽑는다");
  // 2026-08-04: 제목만 심던 것을 출처·실측 반응·발췌까지로 넓혔다. 제목 12줄로는
  // 크롤러가 읽는 본문이 936자에 그쳤고 "남의 제목 모음"과 구분되지 않았다.
  assert.match(src, /seed-sum/, "발췌가 있어야 알맹이가 생긴다");
  assert.match(src, /추천 \$\{Number\(i\.score\)/, "우리가 잰 반응 수치를 함께 심는다");
  // 서비스 구성이 첫 화면에서 드러나야 한다 — /communities·/keywords는
  // 만들어 놓고도 홈에서 갈 링크가 0개였다.
  assert.match(src, /seed-nav/, "자체 페이지로 가는 내비게이션");
  for (const href of ["/briefing", "/ranking/daily", "/communities", "/keywords", "/trends"]) {
    assert.ok(src.includes(`"${href}"`), `홈 내비에 ${href} 누락`);
  }
  // rankingTop은 { generatedAt, items } 를 준다 — 배열로 착각하면 조용히 빈다
  assert.match(src, /\)\s*\|\|\s*\{\}\)\.items\s*\|\|\s*\[\]/,
    "rankingTop의 반환 모양(객체)을 지켜야 한다");
  // 제목은 이스케이프하고 비속어는 마스킹한다 — 검색 결과에 그대로 노출된다
  assert.match(src, /escapeHtml\(maskProfanity\(i\.title\)\)/);

  // 스켈레톤 마커가 실제 index.html과 일치해야 치환이 된다
  const html = fs.readFileSync(new URL("../src/feed/public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('<div id="feedSkel">');
  assert.ok(start >= 0, "index.html에 feedSkel 마커가 있어야 한다");
  assert.ok(html.indexOf("</div>\n    </div>", start) > start,
    "치환 종료 마커가 index.html 구조와 맞아야 한다");
  assert.match(html, /\.seed-list\b/, "주입된 목록의 스타일이 있어야 한다");
});

// ── 2026-08-04 David 실기기 제보 2건 ────────────────────────────────────────
test("브리핑: LLM 해설을 요청 안에서 기다리지 않는다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  // 실측: /briefing 응답이 24초였다. 캐시는 있었지만 미스일 때 API 응답을
  // 요청 안에서 그대로 기다렸다 — 사용자에겐 "아무것도 안 되는" 화면이다.
  // 해설 없는 페이지를 즉시 주고 생성은 뒤에서 돌린다.
  assert.match(src, /const hit = essayCache\.get\(key\);/, "캐시 적중 여부를 밖에서 물어볼 수 있어야 한다");
  assert.match(src, /if \(hit\) return hit;/);
  assert.match(src, /essayPending/, "같은 키로 중복 호출하면 첫 방문자 여러 명이 같은 API를 부른다");
  // await로 기다리면 안 된다 — 이게 무너지면 다시 24초가 된다
  const fn = src.slice(src.indexOf("const withEssay = async"), src.indexOf("const withEssay = async") + 900);
  assert.ok(!/await llmWriter/.test(fn), "해설 생성을 await하면 요청이 다시 막힌다");
});

test("랭킹: 목록이 광고로 쪼개져도 순위 번호가 이어진다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  // 실측(David): "제목 앞 숫자가 계속 1부터 반복됨". <li value>와 <ol start>는
  // 정확했지만 list-style:none + CSS 카운터 조합에서는 그 값들이 무시되고
  // counter-reset이 <ol>마다 1로 되돌린다.
  assert.match(src, /counter-reset:r var\(--rank-start,0\)/, "카운터 시작값을 밖에서 줄 수 있어야 한다");
  assert.match(src, /style="--rank-start:\$\{b\.from - 1\}"/, "각 묶음이 자기 시작 번호에서 이어져야 한다");
});

// ── 하루 3편 편성 (David 2026-08-04) ────────────────────────────────────────
test("편성: 슬롯마다 보는 구간과 해외 비중이 다르다", async () => {
  const { SLOTS, slotById, isOverseas } = await import("../src/feed/digest.js");
  assert.deepEqual(SLOTS.map((s) => s.id), ["morning", "lunch", "evening"]);
  // 발행 시각은 사람들 활동시간 기준 — 아침 7시, 점심 12시, 저녁 7시
  assert.deepEqual(SLOTS.map((s) => s.publishHour), [7, 12, 19]);
  // 아침은 자는 동안 쌓인 것을 봐야 하므로 창이 가장 길고, 해외를 앞으로 당긴다.
  assert.equal(slotById("morning").windowHours, 12);
  assert.ok(slotById("morning").overseasBias > 1, "아침에는 해외 가중");
  assert.equal(slotById("lunch").overseasBias, 1, "점심·저녁은 자연스러운 반응량으로");
  assert.equal(slotById("evening").overseasBias, 1);
  // 창이 다르면 아침·점심·저녁이 같은 글을 싣지 않는다
  assert.ok(slotById("morning").windowHours > slotById("lunch").windowHours);

  // 해외 판별은 언어로 한다 — kind는 국적을 말해 주지 않는다(해커뉴스가 community다)
  assert.equal(isOverseas({ lang: "en" }), true);
  assert.equal(isOverseas({ originalLang: "en", lang: "ko", translated: true }), true);
  assert.equal(isOverseas({ lang: "ko" }), false);
  assert.equal(isOverseas(null), false);
});

test("편성: 요청이 아니라 슬롯 시각에 만들어 저장한다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  // 예전엔 요청마다 다시 만들어서 (1) 캐시 미스 시 24초 대기 (2) 15분마다 내용이
  // 바뀌어 "오늘의 브리핑"이라 부를 편이 없었고 (3) 아카이브에 해설이 0건이었다.
  assert.match(src, /function dueSlot/, "지금 발행됐어야 할 슬롯을 판단해야 한다");
  assert.match(src, /store\.saveBriefing/, "만든 편을 저장해야 아카이브에 남는다");
  assert.match(src, /async function currentBriefing/, "페이지는 저장본을 읽는다");
  // 배경 작업에서는 해설을 기다린다 — 아무도 그 시간을 체감하지 않는다
  const bg = src.slice(src.indexOf("async function buildAndStoreBriefing"), src.indexOf("async function buildAndStoreBriefing") + 900);
  assert.match(bg, /await llmWriter/, "배경 생성에서는 해설을 붙여 저장한다");
  // 정각을 놓쳐도(재기동 등) 다음 점검에서 채운다
  assert.match(src, /if \(store\.getBriefing\(kstDate\(now\), due\.id\)\) return;/, "이미 있으면 다시 만들지 않는다");
});

test("store: 브리핑 저장·조회·최근 편 되찾기", async () => {
  const { FeedStore } = await import("../src/feed/store.js");
  const store = new FeedStore();
  assert.equal(store.getBriefing("2026-08-04", "morning"), null);
  store.saveBriefing("2026-08-04", "morning", { issues: [1, 2, 3], slot: { id: "morning" } });
  store.saveBriefing("2026-08-04", "lunch", { issues: [4], slot: { id: "lunch" } });
  assert.deepEqual(store.getBriefing("2026-08-04", "morning").issues, [1, 2, 3]);
  // 슬롯 경계 직후 아직 안 만들어졌으면 이전 슬롯을 보여준다 — 빈 화면보다 낫다
  const order = ["morning", "lunch", "evening"];
  assert.deepEqual(store.latestBriefing("2026-08-04", order).slot.id, "lunch");
  assert.equal(store.latestBriefing("2026-08-03", order), null);
  assert.deepEqual(store.briefingDates(), ["2026-08-04"]);
});

test("편성: 같은 편을 두 번 만들지 않는다 (타이머와 요청의 경합)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  // 실측(2026-08-04 배포 직후): 같은 편이 두 번 발행됐다. 타이머와 페이지
  // 요청이 동시에 저장 여부를 확인하면 둘 다 "아직 없다"로 통과한다 —
  // 해설 API가 20초쯤 걸려 그 창이 넓다. 토큰도 두 번 쓴다.
  assert.match(src, /briefingInFlight/, "진행 중인 편성을 공유해야 한다");
  assert.match(src, /const running = briefingInFlight\.get\(key\);/);
  assert.match(src, /if \(running\) return running;/, "이미 만들고 있으면 그 약속을 함께 기다린다");
});

test("편성: mainFeed:false 소스는 브리핑·랭킹에서도 빠진다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/engine.js", import.meta.url), "utf8");
  // 실측 2026-08-04: David가 "인벤은 메인에서 좀 빼자"고 해서 mainFeed:false로
  // 껐는데도 브리핑 1위와 3위가 인벤 메이플스토리였다. 설정이 통합 피드에만
  // 걸려 있었기 때문이다 — 우리 이름으로 "오늘의 대표"라고 붙이는 자리야말로
  // 이 설정이 가장 필요하다.
  assert.match(src, /_offMainSet\(\)/, "공용 게터로 한 곳에서 판단해야 한다");
  const brief = src.slice(src.indexOf("async briefing("), src.indexOf("async briefing(") + 2000);
  assert.match(brief, /_offMainSet\(\)\.has\(i\.source\)/, "브리핑에서 제외");
  const rank = src.slice(src.indexOf("async rankingTop("), src.indexOf("async rankingTop(") + 2500);
  assert.match(rank, /_offMainSet\(\)\.has\(i\.source\)/, "랭킹에서 제외");
});

test("편성 화면: 슬롯이 무엇인지 알 수 있고 발행된 편은 눌러 갈 수 있다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/server.js", import.meta.url), "utf8");
  // David 실기기 제보: "눌러서 들어가도 뭔 모닝 런치 이브닝, 만들다 만 형태".
  // 예전엔 슬롯 이름 세 개를 <span>으로 나열만 해서 누를 수도 없고 무엇인지도
  // 알 수 없었다. 발행 시각과 그 편의 성격을 함께 보여준다.
  assert.match(src, /slot-rail/, "편성 레일 누락");
  assert.match(src, /\$\{sl\.publishHour\}시/, "발행 시각을 보여줘야 무엇인지 안다");
  assert.match(src, /escapeHtml\(sl\.lead \|\| ""\)/, "그 편의 성격 설명");
  assert.match(src, /href="\/briefing\/\$\{todayKey\}\?slot=\$\{sl\.id\}"/, "발행된 편은 실제 링크");
  assert.match(src, /published && !isCur/, "지금 보는 편은 자기 자신으로 링크하지 않는다");
  // 홈 브리핑과 아카이브가 같은 모양을 써야 같은 기능인 걸 알아본다
  const rails = src.match(/slot-rail/g) || [];
  assert.ok(rails.length >= 3, `레일이 ${rails.length}곳 — 홈·아카이브·CSS 모두 필요`);
  // "15분마다 갱신"은 이제 사실이 아니다 — 하루 3편이다
  assert.ok(!/브리핑[^<]*15분마다 갱신됩니다/.test(src), "옛 갱신 주기 문구가 남아 있다");
  assert.match(src, /하루 세 번 — 아침 7시·점심 12시·저녁 7시/, "실제 편성 주기를 밝힌다");
});

test("브리핑: 검색 급상승과 이어지는 중요 소식이 대표로 올라온다", async () => {
  // David 2026-08-05: "트렌드 지수가 높은 관심사와 연관된 소식 중 가장 인용도
  // 높고 사람들 반응 높은 중요한 소식들 위주로."
  //
  // 실측(라이브 30건)이 왜 이 축이 필요한지 보여 준다: 기존 점수(반응+인용도)의
  // 중앙값이 0이고 30건 중 19건이 0점이었다 — 뉴스끼리는 서로 구분이 안 돼서
  // 반응이 큰 커뮤니티 글만 대표로 올랐다. 그게 "사적·매니악함"의 뿌리다.
  const { FeedEngine } = await import("../src/feed/engine.js");
  const src = {
    id: "s", kind: "news",
    async fetch() {
      return [
        // 검색 급상승과 무관하지만 커뮤니티 반응이 제법 있는 글
        { id: "chat", title: "오늘 점심 뭐 먹을지 골라주세요", url: "https://x/1",
          source: "clien", category: "humor", score: 180, commentCount: 20 },
        // 검색 급상승 1000+ 과 직접 이어지는 경제 소식 — 반응은 없다(뉴스라서)
        { id: "chip", title: "SK하이닉스 반도체 증설 발표", url: "https://x/2",
          source: "mk", category: "business", score: 0, commentCount: 0 }
      ];
    }
  };
  const engine = new FeedEngine(null, [src]);
  engine._interestsFn = async () => ([{ term: "반도체", traffic: 1000, news: [] }]);

  const b = await engine.briefing();
  const all = b.sections.flatMap((s) => s.items);
  const chip = all.find((i) => i.id === "chip");
  const chat = all.find((i) => i.id === "chat");
  assert.ok(chip && chat, "두 글 다 실려야 한다 — 지우는 게 아니라 순위만 바꾼다");
  assert.ok(chip.weight > chat.weight,
    `검색 급상승과 이어진 경제 소식이 잡담보다 위여야 한다 (반도체 ${chip.weight} vs 잡담 ${chat.weight})`);
  // 왜 올라왔는지 화면이 말할 수 있어야 한다
  assert.equal(chip.interest.term, "반도체");
  assert.equal(chip.interest.how, "term");
  assert.equal(chat.interest, null);

  // 관심사를 못 가져와도 브리핑은 그대로 나온다 — 축 하나가 빠질 뿐
  const engine2 = new FeedEngine(null, [src]);
  engine2._interestsFn = async () => { throw new Error("trends down"); };
  const b2 = await engine2.briefing();
  assert.ok(b2.sections.length > 0, "관심사 없이도 브리핑은 나와야 한다");
});

test("브리핑: 검색 급상승으로 올라온 글은 그 사실을 화면에 밝힌다", async () => {
  // 순위를 바꿔 놓고 말하지 않으면 우리도 왜 그 글이 위에 있는지 설명 못 한다.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  const from = src.indexOf("const evidenceBits = (i) => {");
  const block = src.slice(from, src.indexOf("};", from));
  assert.match(block, /interest/, "근거 배지에 관심사 축이 빠져 있다");
  assert.match(block, /검색 급상승/);
  // 검색량은 구글이 자릿수만 준다 — 정확한 값인 척하면 안 된다
  assert.match(block, /\+`/, "500+ 처럼 대략값 표기를 유지해야 한다");
});

test("브리핑 이슈: 중요한 사건이 반응 큰 잡담보다 앞선다", async () => {
  // 실측(2026-08-05 라이브 모닝 브리핑)에서 대표 이슈가 이랬다:
  //   1. 해커뉴스 · 추천 907건   2. 해커뉴스 · 댓글 357건
  //   3. 보배드림 · 추천 342건   4. 보배드림 · 추천 311건
  // David가 지적한 "사적·매니악함"이 바로 이 정렬의 결과였다.
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    // 추천이 압도적인 커뮤니티 글 — 실제로 그날 1위였던 형태
    { id: "hn", title: "개발자가 겪은 흔한 실수 모음", sourceLabel: "해커뉴스", source: "hn",
      score: 907, commentCount: 0, coverage: 0, category: "tech", tags: [] },
    // 다섯 매체가 동시에 다룬 경제 사안 — 반응 신호는 없다(뉴스라서)
    { id: "eco", title: "정부 주택 공급 대책 발표", sourceLabel: "매일경제", source: "mk",
      score: 0, commentCount: 0, coverage: 5, category: "business", tags: [] },
    // 검색이 몰리는 사안 — 매체는 하나뿐
    { id: "chip", title: "SK하이닉스 반도체 증설", sourceLabel: "전자신문", source: "et",
      score: 0, commentCount: 0, coverage: 0, category: "business", tags: [],
      interest: { term: "반도체", traffic: 1000, strength: 1, how: "term" } }
  ];
  const { issues } = buildDigest(items, { maxIssues: 5 });
  const order = issues.map((i) => i.refs[0].id);
  assert.ok(order.indexOf("eco") < order.indexOf("hn"),
    `5개 매체가 다룬 사안이 추천 907건짜리보다 앞서야 한다 (실제 순서: ${order.join(" > ")})`);
  assert.ok(order.indexOf("chip") < order.indexOf("hn"),
    `검색이 몰리는 사안이 추천 907건짜리보다 앞서야 한다 (실제 순서: ${order.join(" > ")})`);
  // 빼는 게 아니라 순서를 바꾸는 것이다
  assert.ok(order.includes("hn"), "반응 큰 글을 브리핑에서 지우면 안 된다");
  // 검색이 이유인 이슈는 그렇게 말한다
  const chipIssue = issues.find((i) => i.refs[0].id === "chip");
  assert.match(chipIssue.headline, /검색이 몰리는/, `헤드라인이 이유를 안 밝힌다: ${chipIssue.headline}`);
});

test("브리핑 이슈: 헤드라인이 서로 구분된다", async () => {
  // 2026-08-05 라이브: 대표 이슈 여섯 개가 전부 "5개 매체가 동시에 다룬 사안"
  // 이었다. 중요도 순으로 바꾸자 교차보도 이슈가 상위를 채웠는데, 헤드라인이
  // 개수만 말해서 무엇에 관한 것인지 알 수 없었다. 구분이 안 되면 헤드라인이 아니다.
  const { buildDigest, issueSubject } = await import("../src/feed/digest.js");
  const mk = (id, title, tags) => ({
    id, title, sourceLabel: id, source: id, score: 0, commentCount: 0,
    coverage: 5, category: "business", tags
  });
  const items = [
    mk("a1", "정부 주택 공급 대책 발표", ["주택", "공급"]),
    mk("a2", "주택 공급 확대안 국회 보고", ["주택", "공급"]),
    mk("b1", "반도체 수출 최대치 경신", ["반도체", "수출"]),
    mk("b2", "반도체 수출 증가세 이어져", ["반도체", "수출"])
  ];
  const { issues } = buildDigest(items, { maxIssues: 4 });
  const heads = issues.map((i) => i.headline);
  assert.equal(new Set(heads).size, heads.length, `헤드라인이 겹친다: ${heads.join(" | ")}`);
  assert.ok(heads.some((h) => /주택|공급/.test(h)), `무엇에 관한 것인지 안 밝힌다: ${heads.join(" | ")}`);

  // 주제어는 여러 편이 **함께** 쓴 말이어야 한다 — 한 편의 표현을 대표로 쓰면 안 된다
  assert.equal(issueSubject([{ title: "주택 공급 대책" }, { title: "주택 공급 보고" }]), "주택 공급");
  // 한 편뿐이면 공통어를 뽑을 수 없다 — 그 매체가 쓴 제목의 앞 구절을 따온다.
  // (첫 판은 여기서 빈 문자열을 내서 헤드라인이 전부 똑같아졌다.)
  assert.equal(issueSubject([{ title: "혼자 쓰는 낱말" }]), "혼자 쓰는 낱말");
});

test("브리핑 이슈: 우리 풀에 한 편뿐인 사건도 이름을 갖는다", async () => {
  // 교차보도 5건은 구글이 "관련 기사가 5개 있다"고 알려 준 숫자이지, 우리가
  // 5편을 갖고 있다는 뜻이 아니다. 그래서 공통어를 뽑을 대상이 없고, 첫 판에서
  // 헤드라인 여섯 개가 전부 "5개 매체가 동시에 다룬 사안"이 됐다(라이브 실측).
  const { issueSubject, leadPhrase, buildDigest } = await import("../src/feed/digest.js");
  assert.equal(issueSubject([{ title: "정부 주택 공급 대책 발표" }]), "정부 주택 공급 대책 발표");
  // 부제가 붙은 제목은 앞 구절만
  assert.equal(leadPhrase("부동산 여론 심상치 않자…이 대통령 “주택 공급 최대한 빨리”"), "부동산 여론 심상치 않자");
  assert.equal(leadPhrase("“100억 벌어도 세금은 몇억밖에”…이 대통령, 부동산 세제 손본다"), "100억 벌어도 세금은 몇억밖에");
  assert.equal(leadPhrase(""), "");
  assert.equal(leadPhrase(null), "");
  // 여러 편이 있으면 공통어가 우선이다 — 한 매체의 표현보다 낫다
  assert.equal(issueSubject([{ title: "주택 공급 대책" }, { title: "주택 공급 보고" }]), "주택 공급");

  // 단독 이슈들끼리도 헤드라인이 겹치지 않는다
  const mk = (id, title) => ({ id, title, sourceLabel: id, source: id, score: 0,
    commentCount: 0, coverage: 5, category: "business", tags: [id] });
  const { issues } = buildDigest([
    mk("a", "정부 주택 공급 대책 발표"), mk("b", "반도체 수출 최대치 경신")
  ], { maxIssues: 2 });
  const heads = issues.map((i) => i.headline);
  assert.equal(new Set(heads).size, 2, `헤드라인이 겹친다: ${heads.join(" | ")}`);
});
