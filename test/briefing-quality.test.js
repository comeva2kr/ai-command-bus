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
  const fn = src.slice(src.indexOf("async briefing()"), src.indexOf("async briefing()") + 4000);
  assert.match(fn, /eventKey\(i\.title\)/, "이벤트 키로 중복을 걸러야 한다");
  assert.match(fn, /perOutlet/, "한 매체가 섹션을 독식하지 않아야 한다");
  assert.match(fn, /hasProfanity/, "대표 글 선정에서 비속어를 피해야 한다");
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
  assert.match(fn, /icon-512\.png/, "폴백은 PNG (SVG를 미리보기로 안 쓰는 크롤러가 있다)");
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
