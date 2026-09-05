// 브리핑·중복제거·공유카드 — 2026-08-02 적대적 검수 확정분 회귀 방지.
import test from "node:test";
import assert from "node:assert/strict";

import { eventKey, normalizeForDedupe, isSameEvent, MIN_KEY_LEN,
  sharedTitleConceptCount, sharedTitleWordCount } from "../src/feed/dedupe.js";
import { hasProfanity, maskProfanity } from "../src/feed/profanity.js";
import { loadRegistry } from "../src/feed/registry.js";
import { SeedSource } from "../src/feed/content.js";

// refs가 이제 사건(병합 포함) 구성원 전체를 투영한다(David #6, 2026-08-17) —
// 근접 중복 변주는 더 이상 "그중 하나만 refs에 남는다"가 아니라 "한 이슈의
// refs 안에 전부 근거로 모인다". 아래 헬퍼는 원래 이 테스트들이 지키려던
// 계약(변주가 이슈 자리를 여러 개 차지하면 안 된다 — 오병합 방지와는 반대 방향의
// "중복 노출" 방지)을 refs 전량 투영과 함께 검증한다.
function issuesContainingAnyId(issues, ids) {
  const idSet = new Set(ids);
  return issues.filter((issue) => issue.refs.some((ref) => idSet.has(ref.id)));
}

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

test("dedupe: 근접 중복 — 완전일치는 아니어도 내용어가 크게 겹치는 변주를 잡는다", () => {
  // 실측(2026-08-09): "채상병 순직 책임 임성근" 계열 헤드라인 4건이 어순·
  // 수식어만 달라 eventKey(완전일치)로는 하나도 안 묶였다. digest.js가
  // 브리핑 이슈를 뽑을 때 이 함수로 그 변주를 잡는다.
  const variants = [
    "채상병 순직 책임 놓고 임성근 전 사단장 구속영장 재청구",
    "'채상병 순직' 책임자 임성근, 구속영장 다시 청구",
    "임성근 전 사단장 구속영장 재청구...채상병 순직 책임 물어",
    "[속보] 채상병 순직 책임 임성근 구속 위기, 검찰 영장 재청구"
  ];
  for (let i = 0; i < variants.length; i++) {
    assert.equal(eventKey(variants[0]) === eventKey(variants[i]), i === 0,
      "이 변주들은 완전일치로는 안 잡혀야 한다(그래서 근접 중복 함수가 필요하다)");
  }
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      assert.ok(sharedTitleWordCount(variants[i], variants[j]) >= 3,
        `변주끼리는 내용어가 겹쳐야 한다: "${variants[i]}" / "${variants[j]}"`);
    }
  }
  // 무관한 제목과는 겹치지 않는다 — 실측 픽스처 기준 최대 1단어였다
  for (const other of ["삼성전자 3분기 실적 발표, 영업이익 급증", "손흥민 시즌 첫 골, 토트넘 승리 이끌어"]) {
    assert.ok(sharedTitleWordCount(variants[0], other) <= 1, `무관한 제목과 과하게 겹친다: ${other}`);
  }

  assert.ok(sharedTitleConceptCount(
    "트럼프 대통령, 이란에 ‘배상’ 요구",
    '트럼프 "이란, 과거 폭탄테러·시위대 살해 배상하라"'
  ) >= 3, "조사·활용형이 달라도 같은 배상 사건을 잡아야 한다");
  assert.ok(sharedTitleConceptCount(
    "‘축구협회 성접대 의혹’ 아직 수사 착수 안한 경찰",
    '韓 심판 성접대 논란, 일본축구협회가 조사 착수'
  ) >= 3, "발행사 표현이 달라도 같은 심판 성접대 사건을 잡아야 한다");
  assert.ok(sharedTitleConceptCount(
    "news 독립 사건 1-1",
    "news 독립 사건 1-2"
  ) < 3, "일반어만 같은 별개 사건은 중복으로 접으면 안 된다");
  assert.ok(sharedTitleConceptCount(
    "Grand Theft Auto 5 averages more copies sold per year than most megahits manage in their entire lifetime",
    "Square Enix financial report gives me hope for FF14, suggesting the MMO is finally not having to carry the company"
  ) < 3, "영문 불용어만 겹친 무관한 게임 기사를 합치면 안 된다");
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

test("Today 후보 단계는 국내외 비율을 예약하지 않고 중요도 순서를 유지한다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/engine.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async briefing("), src.indexOf("async briefing(") + 14000);
  assert.doesNotMatch(fn, /domesticShareBands\s*:/,
    "국내외 비율은 관측값이며 후보 자리를 예약하는 입력으로 사용하면 안 된다");
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
  const items = [{ id: "a", title: "주택 공급 일정 발표 관련 소식", sourceLabel: "한국방송뉴스",
    score: 0, commentCount: 0, coverage: 5, tags: [] }];
  const para = issueParagraph(items, issueShape(items));
  assert.doesNotMatch(para, /1곳이 함께 다뤘다/, "자기모순 문장이 나오면 안 된다");
  // 2026-08-06 계약 정정: 예전엔 여기서 "5개 매체"를 **쓰라고** 요구했다.
  // 그 요구 자체가 틀렸다. coverage는 구글뉴스 관련기사 목록의 길이인데 그
  // 목록에는 상한이 있다(fetchers.js COVERAGE_MAX = 5, 실측: 사실상 0 아니면 5).
  // 상한에 걸린 값을 "5개 매체"라는 정확한 수치인 양 말하면 거짓이다 —
  // editorial.js는 이미 같은 이유로 숫자를 버렸는데 digest.js만 규칙 밖에 있었고,
  // 이 테스트가 그 위반을 **고정하고** 있었다. 라이브 실측(2026-08-06): 홈에
  // 나간 이슈 6건이 전부 "5개 매체가 다룬"이었고 그중에는 우리 피드에 한 곳
  // 에서만 들어온 것도 있었다.
  assert.doesNotMatch(para, /\d+개 매체/, "상한에 걸린 값을 정확한 수치처럼 쓰면 안 된다");
  assert.doesNotMatch(para, /여러 매체|복수 피드|교차 관측|기사들이 함께/, "관련기사 묶음을 직접 복수 확인처럼 말하면 안 된다");
  assert.match(para, /관련 보도 묶음 신호/, "관련기사 묶음 신호 자체는 전해야 한다");
  // 우리가 실제로 센 것(우리 피드에 들어온 출처)은 이름과 직접 확인 건수로 밝힌다.
  assert.match(para, /직접 확인한 원문은 한국방송뉴스 기사 한 건/, "우리 피드에서 직접 확인한 범위를 밝혀야 한다");
});

test("브리핑: 같은 사건 중복과 한 매체 독식을 막는다", async () => {
  const src = (await import("node:fs")).readFileSync(
    new URL("../src/feed/engine.js", import.meta.url), "utf8");
  // 2026-08-04: 시그니처가 briefing({ slotId })로 바뀌었다 — 슬롯마다 창과
  // 해외 가중이 달라진다. 고정 글자 수로 자르면 구현이 자랄 때 정상 코드가
  // 검사 창 밖으로 밀리므로 다음 메서드 경계까지 읽는다.
  const at = src.indexOf("async briefing(");
  assert.ok(at > 0, "briefing 함수를 찾을 수 없다");
  const end = src.indexOf("\n  async todayEdition(", at);
  assert.ok(end > at, "briefing 함수 끝을 찾을 수 없다");
  const fn = src.slice(at, end);
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
  assert.ok(!extractTags("we lost access").includes("OST"), "영문 사전어를 단어 안에서 오탐하면 안 된다");
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

test("sitemap.xml은 자체 편집 페이지만 담고 실시간·유틸리티 지면은 제외한다", async () => {
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
    for (const must of ["/", "/report"]) {
      assert.ok(xml.includes(`<loc>${origin}${must}</loc>`), `sitemap에 ${must}가 없다`);
    }
    for (const excluded of ["/briefing", "/rss.xml", "/live", "/ranking/daily", "/trends", "/communities", "/keywords"]) {
      assert.ok(!xml.includes(`<loc>${origin}${excluded}</loc>`), `유틸리티 지면 ${excluded}가 sitemap에 들어갔다`);
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

test("오늘판 플래그가 꺼지면 옛 홈을 부활시키지 않고 /live로 이동한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const server = createServer({ dev: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = await fetch(`${base}/`, { redirect: "manual" });
    assert.equal(root.status, 307);
    assert.equal(root.headers.get("location"), "/live");

    const live = await (await fetch(`${base}/live`)).text();
    assert.match(live, /<link rel="canonical" href="https:\/\/nowhot\.kr\/live">/);
    assert.match(live, /<meta name="robots" content="noindex,follow">/);
    assert.match(live, /id="feedSkel"/, "기존 실시간 앱 셸이 /live에 있어야 한다");

    const redirect = await fetch(`${base}/index.html`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/live");
  } finally {
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  }
});

test("AdFit 설정이 옛 브리핑을 복원하지 않고 실시간 쿠팡은 유지한다", async (t) => {
  const { createServer } = await import("../src/feed/server.js");
  const prev = {
    a: process.env.ADSENSE_CLIENT,
    f: process.env.ADFIT_UNIT_MOBILE,
    e: process.env.ADFIT_ENABLED,
    p: process.env.AD_PREVIEW,
    c: process.env.COUPANG_PARTNER_ID
  };
  try {
    // (1) AdFit 심사 모드: 검색·심사용 편집 홈에만 정확히 한 단위.
    process.env.ADSENSE_CLIENT = "ca-pub-TEST";
    process.env.ADFIT_UNIT_MOBILE = "DAN-TEST";
    process.env.ADFIT_ENABLED = "1";
    process.env.AD_PREVIEW = "1";
    process.env.COUPANG_PARTNER_ID = "AF-test";
    const titles = [
      "반도체 공장 투자 확대 계획 발표", "인공지능 검색 서비스 새 기능 공개",
      "스마트폰 운영체제 보안 업데이트 배포", "클라우드 데이터센터 전력 효율 개선",
      "로봇 배송 실증 사업 지역 확대", "양자컴퓨팅 오류 정정 기술 개발",
      "전기차 배터리 충전 속도 향상", "위성 통신망 상용 서비스 개시",
      "게임 엔진 그래픽 렌더링 기술 공개", "오픈소스 데이터베이스 새 버전 출시",
      "의료 영상 진단 소프트웨어 승인", "반도체 장비 수출 실적 증가"
    ];
    const reviewSource = new SeedSource(titles.map((title, i) => ({
      id: `review-${i}`, title, url: `https://example.com/review-${i}`,
      kind: "news", category: "tech", publishedAt: new Date().toISOString(), sourceRank: i
    })));
    let server = createServer({ dev: true, sources: [reviewSource] });
    t.after(() => { server.closeAllConnections?.(); server.close(); });
    await new Promise((r) => server.listen(0, r));
    let port = server.address().port;
    let html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*kakaocdn/i);
    const retired = await fetch(`http://127.0.0.1:${port}/briefing`);
    assert.equal(retired.status, 410);
    assert.doesNotMatch(await retired.text(), /kakao_ad_area|link\.coupang\.com/);

    const live = await (await fetch(`http://127.0.0.1:${port}/live`)).text();
    assert.match(live, /<meta name="robots" content="noindex,follow">/);
    assert.doesNotMatch(live, /<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i,
      "자동 갱신되는 실시간 피드는 광고 네트워크 SDK를 로드하지 않는다");
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    assert.equal(cfg.adfit.mobileUnit, null, "실시간 클라이언트로 AdFit 단위를 내려보내면 안 된다");
    assert.equal(cfg.adfit.reviewMode, true);
    assert.equal(cfg.monetization.enabled, true, "애드핏 심사 설정이 기존 쿠팡 수익화를 끄지 않는다");
    assert.ok(cfg.coupang.items.length > 0, "설정된 제휴 링크를 실시간 클라이언트에 전달한다");
    const session = await (await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    })).json();
    await fetch(`http://127.0.0.1:${port}/api/survey`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, answers: { categories: ["tech"] } })
    });
    const feed = await (await fetch(`http://127.0.0.1:${port}/api/feed?userId=${session.userId}&limit=30`)).json();
    assert.equal(feed.items.some((item) => item.via === "ad"), true,
      "실시간 API의 쿠팡 슬롯도 심사용 편집 지면과 독립적으로 동작한다");
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));

    // (2) 설정이 없으면 편집 홈도 완전 무광고.
    delete process.env.ADSENSE_CLIENT;
    delete process.env.ADFIT_UNIT_MOBILE;
    delete process.env.ADFIT_ENABLED;
    delete process.env.AD_PREVIEW;
    delete process.env.COUPANG_PARTNER_ID;
    server = createServer({ dev: true });
    await new Promise((r) => server.listen(0, r));
    port = server.address().port;
    html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.doesNotMatch(html, /class="adsbygoogle"|<script[^>]+src=["'][^"']*googlesyndication/i);
    assert.doesNotMatch(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""), /class="kakao_ad_area"/);
    // CSS 규칙(.ad-slot{})은 항상 있어도 무해하다 — 실제 지면 div만 없으면 된다
    assert.ok(!html.includes('<div class="ad-slot">'), '광고 설정이 없으면 지면이 없어야 한다');
    server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  } finally {
    if (prev.a) process.env.ADSENSE_CLIENT = prev.a; else delete process.env.ADSENSE_CLIENT;
    if (prev.f) process.env.ADFIT_UNIT_MOBILE = prev.f; else delete process.env.ADFIT_UNIT_MOBILE;
    if (prev.e) process.env.ADFIT_ENABLED = prev.e; else delete process.env.ADFIT_ENABLED;
    if (prev.p) process.env.AD_PREVIEW = prev.p; else delete process.env.AD_PREVIEW;
    if (prev.c) process.env.COUPANG_PARTNER_ID = prev.c; else delete process.env.COUPANG_PARTNER_ID;
  }
});

test("오늘판 정적 홈은 색인을 유지하고 쿠팡 지면을 연결한다", async () => {
  const { createServer } = await import("../src/feed/server.js");
  const prev = { a: process.env.ADSENSE_CLIENT, f: process.env.ADFIT_UNIT_MOBILE, e: process.env.ADFIT_ENABLED };
  const readPages = async () => {
    const server = createServer({ dev: true, localEditorial: true });
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      return {
        root: await (await fetch(`${base}/`)).text(),
        live: await (await fetch(`${base}/live`)).text()
      };
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  };
  try {
    process.env.ADSENSE_CLIENT = "ca-pub-TEST";
    delete process.env.ADFIT_UNIT_MOBILE;
    delete process.env.ADFIT_ENABLED;
    let { root, live } = await readPages();
    assert.match(root, /<link rel="canonical" href="https:\/\/nowhot\.kr\/">/);
    assert.doesNotMatch(root, /noindex/);
    assert.match(root, /google-adsense-account/);
    assert.doesNotMatch(root, /<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i);
    assert.match(root, /state\.coupang=config\.coupang/);
    assert.match(root, /todayAdHtml\(issue,index,"today-feed",seenAds,/);
    assert.doesNotMatch(live, /<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i);

    process.env.ADFIT_UNIT_MOBILE = "DAN-TEST";
    process.env.ADFIT_ENABLED = "1";
    ({ root, live } = await readPages());
    assert.doesNotMatch(root, /kakao_ad_area|pagead2\.googlesyndication\.com|class="adsbygoogle"/);
    assert.match(root, /aria-label="쿠팡 제휴 광고"/);
    assert.match(root, /class="ad-disclosure">\$\{esc\(cp\.disclosure\)\}/);
    assert.doesNotMatch(live, /<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i);
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
  assert.match(src, /function serveStatic\(res, urlPath, seedHtml = "", pageExtras = null\)/,
    "serveStatic이 seed와 자체 콘텐츠 seed를 받아야 한다");
  assert.doesNotMatch(src, /ownSeedHtml|await engine\.briefing\(\)/,
    "실시간 초기 화면이 옛 브리핑을 만들면 안 된다");
  assert.match(src, /seedHtml && ext === "\.html" && rel === "index\.html"/);
  assert.match(src, /rankingTop\(20\)/, "홈 seed는 화제 랭킹에서 뽑는다");
  // 2026-08-04: 제목만 심던 것을 출처·실측 반응·발췌까지로 넓혔다. 제목 12줄로는
  // 크롤러가 읽는 본문이 936자에 그쳤고 "남의 제목 모음"과 구분되지 않았다.
  assert.match(src, /seed-sum/, "발췌가 있어야 알맹이가 생긴다");
  assert.match(src, /추천 \$\{Number\(i\.score\)/, "우리가 잰 반응 수치를 함께 심는다");
  // 서비스 구성이 첫 화면에서 드러나야 한다 — /communities·/keywords는
  // 만들어 놓고도 홈에서 갈 링크가 0개였다.
  assert.match(src, /seed-nav/, "자체 페이지로 가는 내비게이션");
  for (const href of ["/", "/ranking/daily", "/communities", "/keywords", "/trends"]) {
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



test("편성: mainFeed:false 소스는 브리핑·랭킹에서도 빠진다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/feed/engine.js", import.meta.url), "utf8");
  // 실측 2026-08-04: David가 "인벤은 메인에서 좀 빼자"고 해서 mainFeed:false로
  // 껐는데도 브리핑 1위와 3위가 인벤 메이플스토리였다. 설정이 통합 피드에만
  // 걸려 있었기 때문이다 — 우리 이름으로 "오늘의 대표"라고 붙이는 자리야말로
  // 이 설정이 가장 필요하다.
  assert.match(src, /_offMainSet\(\)/, "공용 게터로 한 곳에서 판단해야 한다");
  const sharedStart = src.indexOf("async _sharedBriefingContext(");
  const sharedEnd = src.indexOf("async canonicalEventSources(", sharedStart);
  const shared = src.slice(sharedStart, sharedEnd);
  assert.match(shared, /!offMain\.has\(item\.source\)/,
    "브리핑 공용 입력에서 한 번 제외해 모든 카테고리에 같은 기준을 적용한다");
  const rank = src.slice(src.indexOf("async rankingTop("), src.indexOf("async rankingTop(") + 2500);
  assert.match(rank, /_offMainSet\(\)\.has\(i\.source\)/, "랭킹에서 제외");
});

test("편성: 게임은 유머판·매니악 커뮤니티가 아닌 국내외 일반 뉴스 공급원을 갖는다", () => {
  const byId = new Map(loadRegistry().map((source) => [source.id, source]));
  const gamemeca = byId.get("gamemeca");
  const pcgamer = byId.get("pcgamer");

  for (const source of [gamemeca, pcgamer]) {
    assert.ok(source, "일반 게임 뉴스 소스가 레지스트리에 있어야 한다");
    assert.equal(source.enabled, true);
    assert.equal(source.kind, "news");
    assert.equal(source.category, "gaming");
    assert.notEqual(source.mainFeed, false, "개인 오늘판 공급원에서 빠지면 안 된다");
    assert.equal(source.adapter.type, "rss");
    assert.match(source.adapter.url, /^https:\/\//);
  }
  assert.equal(byId.get("inven_hot").mainFeed, false,
    "매니악한 인게임 커뮤니티를 일반 뉴스 대신 메인에 되돌리면 안 된다");
  assert.equal(byId.get("ruliweb").mixed, true,
    "루리웹 유머판을 게임 전문 뉴스로 다시 오인하면 안 된다");
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

test("브리핑 이슈: 같은 검색 급상승어는 한 판에서 한 사건만 대표한다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const interest = { term: "어린이", traffic: 1000, strength: 1, how: "term" };
  const items = [
    { id: "a", title: "외할머니에게 맞았다 경찰서 찾아간 11살", source: "one", sourceLabel: "한겨레", category: "news", interest },
    { id: "b", title: "안전벨트 안 맨 아이 고집에", source: "two", sourceLabel: "매일경제", category: "business", interest },
    { id: "c", title: "반도체 신규 공정 투자 확대", source: "three", sourceLabel: "전자신문", category: "tech", score: 120 }
  ];
  const { issues } = buildDigest(items, { maxIssues: 3, selectedCategories: ["news", "business", "tech"], minIssuesPerCategory: 1 });
  assert.equal(issues.filter((issue) => /“어린이” 검색/.test(issue.headline)).length, 1);
  assert.ok(issues.some((issue) => /반도체 신규 공정 투자 확대/.test(issue.headline)), "중복 자리는 다음 품질 후보로 채워야 한다");
});

// ---------------------------------------------------------------------------
// v2 2차 재랭킹 제거(David 승인, 2026-08-17 — "골라놓은 순서 그대로").
// buildDigest의 externalRank 옵션: 없으면(v1) 기존 weight 정렬 그대로,
// 있으면(v2) 반응량과 무관하게 그 순위를 정본으로 고정한다.
// ---------------------------------------------------------------------------

test("동결 — v1 바이트 무변경: externalRank 없으면 기존 반응량 weight 정렬 그대로", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    { id: "hot", title: "국내 커뮤니티 반응 폭발 이슈", source: "src-a", sourceLabel: "매체A", category: "news", score: 900 },
    { id: "quiet", title: "해외 경제 조용한 단신 이슈", source: "src-b", sourceLabel: "매체B", category: "business", score: 0 }
  ];
  const { issues } = buildDigest(items, { maxIssues: 2 });
  assert.equal(issues[0].refs[0].id, "hot", "externalRank 없으면 반응량이 큰 쪽이 그대로 앞선다(무변경)");
});

test("동결 — v2: externalRank가 있으면 shadow S 순위를 그대로 따른다(반응량 재랭킹 없음)", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    { id: "hot", title: "국내 커뮤니티 반응 폭발 이슈", source: "src-a", sourceLabel: "매체A", category: "news", score: 900 },
    { id: "quiet", title: "해외 경제 조용한 단신 이슈", source: "src-b", sourceLabel: "매체B", category: "business", score: 0 }
  ];
  // shadow S 내림차순으로는 quiet가 먼저(랭크 0), hot이 다음(랭크 1) — 반응량과 반대.
  const externalRank = new Map([["quiet", 0], ["hot", 1]]);
  const { issues } = buildDigest(items, { maxIssues: 2, externalRank });
  assert.equal(issues[0].refs[0].id, "quiet",
    "externalRank가 있으면 반응량이 커도 순위가 밀린다 — 재계산 금지");
});

test("v2: externalRank 매핑이 없는 클러스터는 매핑된 클러스터 뒤로 밀린다(부분 공급 안전망)", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    { id: "ranked-low", title: "shadow가 낮은 순위로 고른 이슈", source: "src-a", sourceLabel: "매체A", category: "news", score: 0 },
    { id: "unranked", title: "shadow 밖에서 섞여 들어온 이슈", source: "src-b", sourceLabel: "매체B", category: "business", score: 900 }
  ];
  const externalRank = new Map([["ranked-low", 0]]); // unranked는 매핑 없음
  const { issues } = buildDigest(items, { maxIssues: 2, externalRank });
  assert.equal(issues[0].refs[0].id, "ranked-low", "매핑된 클러스터가 반응량과 무관하게 앞선다");
  assert.equal(issues[1].refs[0].id, "unranked");
});

test("개인판 최소 깊이: 앞 분야가 소스 상한을 써도 후보가 있는 뒤 분야를 굶기지 않는다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const categories = ["news", "tech", "fashion"];
  const items = categories.flatMap((category, categoryIndex) => [0, 1].map((index) => ({
    id: `${category}-${index}`,
    title: `${category} 독립 사건 ${categoryIndex + 1}-${index + 1}`,
    source: "shared-outlet",
    sourceLabel: "공통매체",
    category,
    score: 100 - categoryIndex * 10 - index,
    tags: []
  })));
  const { issues } = buildDigest(items, {
    maxIssues: 6,
    maxPerSource: 3,
    selectedCategories: categories,
    minIssuesPerCategory: 2
  });
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const issue of issues) {
    for (const category of issue.categoryIds) if (category in counts) counts[category] += 1;
  }

  assert.deepEqual(counts, { news: 2, tech: 2, fashion: 2 });
});

test("개인판 출처 균형: 지면을 채우려고 상한을 풀어도 한 매체부터 몰아 넣지 않는다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const subjects = [
    "붉은사막 콘솔시연", "고스트리콘 할인순위", "드래곤퀘스트 리메이크", "오버워치 배틀패스", "팰월드 정식출시",
    "스타폭스 스위치판", "메이플 여름축제", "발로란트 국제대회", "산나비 전시회", "던그리드 후속작",
    "배틀필드 환불논쟁", "퀘이크콘 개발진", "엘든링 신규직업", "헤일로 캠페인", "폴아웃 제작소식",
    "사이버펑크 보드게임", "어쌔신크리드 확장", "로블록스 팝업", "포켓몬 기념행사", "마인크래프트 보안",
    "젠레스 상시가챠", "리그오브레전드 결승", "닌텐도 판매기록", "플레이스테이션 디스크", "스팀덱 휴대기기",
    "인디게임 음악협업", "게임소통학교 종료", "크래프톤 블루존", "SOOP 채팅번역", "아서왕 전략신작"
  ];
  const gamingItems = ["게임메카", "PC 게이머", "게임 커뮤니티"].flatMap((sourceLabel, sourceIndex) =>
    Array.from({ length: 10 }, (_, index) => ({
      id: `${sourceIndex}-${index}`,
      title: `${sourceLabel} ${subjects[sourceIndex * 10 + index]}`,
      source: `source-${sourceIndex}`,
      sourceLabel,
      category: "gaming",
      score: sourceIndex === 0 ? 1000 - index : 100 - sourceIndex * 10 - index,
      tags: []
    }))
  );
  const newsSubjects = [
    "철도 노선 확장 일정", "항만 물류 협약 체결", "산불 진화 상황 발표", "대학 입시 전형 개편",
    "의료보험 수가 조정", "농산물 작황 전망", "재생에너지 입찰 결과", "공공임대 공급 계획",
    "항공 노선 증편", "문화재 복원 사업", "관광객 통계 발표", "신약 임상 승인",
    "교육과정 개편", "해양보호구역 지정"
  ];
  const newsItems = newsSubjects.map((title, index) => ({
    id: `news-${index}`,
    title,
    source: `source-${1 + (index % 2)}`,
    sourceLabel: index % 2 ? "게임 커뮤니티" : "PC 게이머",
    category: "news",
    score: 200 - index,
    tags: []
  }));
  const { issues } = buildDigest([...newsItems, ...gamingItems], {
    maxIssues: 28,
    maxPerSource: 3,
    selectedCategories: ["news", "gaming"],
    minIssuesPerCategory: 14,
    additiveCategoryUnion: true
  });
  const counts = new Map();
  for (const issue of issues.filter((issue) => issue.categoryIds.includes("gaming"))) {
    const source = issue.refs[0].sourceLabel;
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  const spread = [...counts.values()];

  assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), 14);
  assert.equal(counts.size, 3);
  assert.ok(Math.max(...spread) - Math.min(...spread) <= 1, JSON.stringify(Object.fromEntries(counts)));
});

test("출처 상한은 섹션 표시명이 아니라 운영 발행사 그룹으로 센다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    { id: "same-a", title: "반도체 투자 계획 첫 번째 보도", source: "publisher-tech", sourceLabel: "경제신문 기술",
      ownershipGroup: "publisher-group", ownershipBasis: "registry_explicit", category: "tech", score: 300, tags: [] },
    { id: "same-b", title: "클라우드 사업 확대 두 번째 보도", source: "publisher-business", sourceLabel: "경제신문 비즈니스",
      ownershipGroup: "publisher-group", ownershipBasis: "registry_explicit", category: "tech", score: 200, tags: [] },
    { id: "other", title: "인공지능 규제안 별도 보도", source: "other-publisher", sourceLabel: "다른신문",
      ownershipGroup: "other-group", ownershipBasis: "registry_explicit", category: "tech", score: 100, tags: [] }
  ];

  const { issues } = buildDigest(items, { maxIssues: 2, maxPerSource: 1 });

  assert.deepEqual(issues.map((issue) => issue.refs[0].id), ["same-a", "other"]);
});

test("분야별 국내외 범위는 중요도 순서를 바꾸거나 잡기사를 강제하지 않는다", async () => {
  const { buildDigest, CATEGORY_DOMESTIC_SHARE_BANDS } = await import("../src/feed/digest.js");
  const domesticSources = ["yna", "khan", "donga", "mk-news", "etnews", "hankyung", "chosunbiz"];
  const foreignSources = [
    "bbc-world", "guardian-world", "nyt-world", "bbc-technology", "techcrunch",
    "the-verge", "cnbc-economy", "bbc-business", "marketwatch-top"
  ];
  assert.deepEqual(Object.keys(CATEGORY_DOMESTIC_SHARE_BANDS).sort(),
    ["business", "news", "politics", "tech"],
    "합의하지 않은 분야에 임의 지역 관측 범위를 만들지 않는다");
  const subjects = [
    "반도체 투자 계획", "주택 공급 일정", "기준금리 결정", "산불 진화 현황",
    "우주망원경 관측", "전기차 배터리 공장", "축구대표팀 명단", "영화제 수상작",
    "교육과정 개편", "항만 물류 협약", "의료보험 수가", "인공지능 규제",
    "재생에너지 입찰", "관세 협상 결과", "신약 임상 승인", "철도 노선 확장",
    "데이터센터 건설", "농산물 작황 전망", "국방예산 심의", "해양보호구역 지정",
    "노동시간 개편", "문화재 복원", "게임산업 수출", "항공노선 증편",
    "기후정상회의", "공공임대 공급", "소상공인 대출", "대학입시 전형",
    "로봇산업 표준", "통신망 투자", "물가상승률 발표", "외환시장 안정",
    "선거제도 논의", "원전 정비 일정", "사이버보안 훈련", "관광객 통계"
  ];

  const rows = (category, region, count, offset = 0) => Array.from({ length: count }, (_, index) => ({
    id: `${category}-${region}-${index}`,
    title: subjects[offset + index],
    source: region === "kr"
      ? domesticSources[index % domesticSources.length]
      : foreignSources[index % foreignSources.length],
    sourceLabel: `${region === "kr" ? "국내" : "해외"}매체 ${index + 1}`,
    category,
    score: 10,
    tags: []
  }));
  const select = (category, items) => buildDigest(items, {
    maxIssues: 14,
    maxPerSource: 14,
    selectedCategories: [category],
    minIssuesPerCategory: 14,
    additiveCategoryUnion: true,
    externalRank: new Map(items.map((item, index) => [item.id, index]))
  }).issues;

  const importantForeign = rows("business", "global", 14, 0);
  const lowerDomestic = rows("business", "kr", 14, 14);
  assert.deepEqual(select("business", [...importantForeign, ...lowerDomestic])
    .map((issue) => issue.refs[0].id), importantForeign.map((item) => item.id),
  "해외 사건이 실제 중요도 상위면 국내 비율을 맞추려고 밀어내지 않는다");

  const highForeign = rows("business", "global", 1, 0);
  const domestic = rows("business", "kr", 14, 1);
  const fillerForeign = rows("business", "global-filler", 5, 15).map((item, index) => ({
    ...item,
    id: `business-global-filler-${index}`,
    source: foreignSources[index % foreignSources.length]
  }));
  const selected = select("business", [...highForeign, ...domestic, ...fillerForeign]);
  assert.equal(selected.length, 14);
  assert.ok(selected.some((issue) => issue.refs[0].id === highForeign[0].id),
    "중요도 1위 해외 사건은 비율과 무관하게 유지한다");
  assert.equal(selected.some((issue) => issue.refs[0].id.startsWith("business-global-filler-")), false,
    "해외 건수를 채우기 위한 낮은 순위 필러를 강제하지 않는다");
});

function nh108Rows(category, region, count, weight = 100) {
  const sources = region === "kr"
    ? ["yna", "khan", "donga", "mk-news"]
    : ["bbc-world", "guardian-world", "nyt-world", "bbc-business"];
  return Array.from({ length: count }, (_, index) => ({
    id: `nh108-${category}-${region}-${index}`,
    title: `${category} 독립 사건 ${region === "kr" ? 1 : 2}-${index + 1}`,
    originalTitle: region === "kr" ? undefined : `Fed interest rates decision ${index + 1}`,
    source: sources[index % sources.length],
    sourceLabel: sources[index % sources.length],
    sourceRank: Math.floor(index / sources.length),
    category,
    score: 0,
    briefingAuthorityBonus: weight,
    tags: []
  }));
}

function nh108Options(category, limit = 14) {
  return { maxIssues: limit, minIssuesPerCategory: limit, maxPerSource: 3,
    selectedCategories: [category], additiveCategoryUnion: true };
}

test("NH108: comparable candidates change the published 14 in both directions, not the 22-seat reserve ratio", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const { categoryEditionsFromUnion } = await import("../tools/build-slot-canonical-edition.mjs");
  for (const [category, minimum, maximum] of [
    ["news", 7, 9], ["business", 7, 8], ["tech", 7, 9], ["politics", 12, 12]
  ]) {
    for (const majority of ["kr", "foreign"]) {
      const rows = [...nh108Rows(category, majority, 24),
        ...nh108Rows(category, majority === "kr" ? "foreign" : "kr", 14, 90)];
      const direct = buildDigest(rows, nh108Options(category)).issues;
      const reserve = buildDigest(rows, nh108Options(category, 22)).issues;
      const union = { issues: reserve.map((issue, rank) => ({ ...issue,
        selectedByCategories: [category], _categoryLaneRanks: { [category]: rank } })) };
      const published = categoryEditionsFromUnion(union)[category].issues;
      assert.equal(reserve.length, 22);
      assert.equal(published.length, 14);
      assert.deepEqual(published.map((issue) => issue.refs[0].id), direct.map((issue) => issue.refs[0].id));
      const domestic = published.filter((issue) => !issue.overseasOnly).length;
      assert.ok(domestic >= minimum && domestic <= maximum, `${category}/${majority}: ${domestic}/14`);
      assert.ok(published.some((issue) => issue.refs[0].id.includes(majority === "kr" ? "-foreign-" : "-kr-")),
        "must admit a comparable candidate outside the original top 22, not only shuffle that set");
    }
  }
});

test("NH108: one inclusive 10% weight gap, with actual zero and negative engagement", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  for (const [majorityWeight, minorityWeight, score, expectedForeign] of [
    [100, 90, 0, true], [100, 89.99, 0, false],
    [0, 0, 0, true], [0, 0, -100, true], [1, 0, 0, false]
  ]) {
    const rows = [...nh108Rows("news", "kr", 14, majorityWeight),
      ...nh108Rows("news", "foreign", 14, minorityWeight)].map((row) => ({ ...row, score }));
    const { issues } = buildDigest(rows, { ...nh108Options("news"), maxPerSource: 14 });
    assert.equal(issues.some((issue) => issue.overseasOnly), expectedForeign,
      JSON.stringify({ majorityWeight, minorityWeight, score }));
  }
});

test("NH108: far stronger domestic or foreign leaders win and weak opposite-region fillers stay out", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  for (const majority of ["kr", "foreign"]) {
    const leaders = nh108Rows("business", majority, 14, 100);
    leaders[0].briefingAuthorityBonus = 1000;
    const rows = [...leaders, ...nh108Rows("business", majority === "kr" ? "foreign" : "kr", 14, 20)];
    const { issues } = buildDigest(rows, { ...nh108Options("business"), maxPerSource: 14 });
    assert.deepEqual(issues.map((issue) => issue.refs[0].id), leaders.map((row) => row.id));
  }
});

test("NH108: foreign advancement requires an existing cross-reporting or Korean-impact signal", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const domestic = nh108Rows("news", "kr", 14, 200);
  const plain = { ...nh108Rows("news", "foreign", 1, 180)[0], originalTitle: "",
    source: "hackernews", sourceLabel: "Hacker News" };
  for (const [name, foreign, expected] of [
    ["none", [plain], false],
    ["global_major", [{ ...plain, source: "bbc-world" }], false],
    ["Korean impact", [{ ...plain, originalTitle: "Fed interest rates decision" }], true],
    ["cross-reporting", [
      { ...plain, briefingAuthorityBonus: 20, url: "https://example.test/nh108-cross" },
      { ...plain, id: "nh108-cross-second", source: "pcgamer", sourceLabel: "PC Gamer",
        briefingAuthorityBonus: 20, url: "https://example.test/nh108-cross" }
    ], true]
  ]) {
    const { issues } = buildDigest([...domestic, ...foreign], { ...nh108Options("news"), maxPerSource: 14 });
    assert.equal(issues.some((issue) => issue.overseasOnly), expected, name);
  }
  const strongest = { ...plain, briefingAuthorityBonus: 1000 };
  assert.equal(buildDigest([...domestic, strongest], nh108Options("news")).issues[0].refs[0].id, strongest.id,
    "the advancement signal is not an exclusion gate on naturally important foreign coverage");
});

test("NH108: external ranks, carryover priority and unspecified categories are not ratio knobs", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const rows = [...nh108Rows("news", "kr", 14), ...nh108Rows("news", "foreign", 14, 90)];
  const ids = rows.slice(0, 14).map((row) => row.id);
  const options = { ...nh108Options("news"), maxPerSource: 14 };
  for (const externalRank of [new Map(rows.map((row, index) => [row.id, index])),
    new Map(rows.slice(0, 14).map((row, index) => [row.id, index]))]) {
    assert.deepEqual(buildDigest(rows, { ...options, externalRank }).issues.map((issue) => issue.refs[0].id), ids);
  }
  const carryover = rows.map((row) => row.id.includes("-foreign-") ? { ...row, editorialCarryover: { reason: "test" } } : row);
  assert.deepEqual(buildDigest(carryover, options).issues.map((issue) => issue.refs[0].id), ids);
  const unspecified = rows.map((row) => ({ ...row, category: "fashion" }));
  assert.deepEqual(buildDigest(unspecified, { ...options, selectedCategories: ["fashion"] }).issues.map((issue) => issue.refs[0].id), ids);
});

test("NH108: guide admissions retain source caps, source order, category eligibility and trend dedupe", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const rows = [...nh108Rows("news", "kr", 20), ...nh108Rows("news", "foreign", 14, 90)];
  const foreign = rows.filter((row) => row.id.includes("-foreign-"));
  for (const row of foreign.slice(0, 3)) row.interest = { term: "공통검색", traffic: 0, how: "term" };
  rows.push({ ...foreign[0], id: "nh108-invalid", title: "ㅋㅋㅋ", originalTitle: "", interest: null },
    { ...foreign[0], id: "nh108-wrong-category", title: "별도 독립 사건 3-1", originalTitle: "", category: "fashion", interest: null });
  const { issues, quality } = buildDigest(rows, nh108Options("news"));
  assert.equal(issues.length, 14);
  assert.ok(quality.machineHold > 0);
  assert.ok(issues.every((issue) => issue.categoryIds.includes("news")));
  assert.ok(!issues.some((issue) => issue.refs.some((ref) => ["nh108-invalid", "nh108-wrong-category"].includes(ref.id))));
  assert.ok(issuesContainingAnyId(issues, foreign.slice(0, 3).map((row) => row.id)).length <= 1);
  const bySource = new Map();
  for (const issue of issues) {
    const ref = issue.refs[0];
    const ranks = bySource.get(ref.ownershipGroup) || [];
    ranks.push(rows.find((row) => row.id === ref.id).sourceRank);
    bySource.set(ref.ownershipGroup, ranks);
  }
  for (const ranks of bySource.values()) {
    assert.ok(ranks.length <= 3);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  }
});

test("NH108: no applicable preference preserves the original reserve order and final 14", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const rows = [...nh108Rows("news", "kr", 24), ...nh108Rows("news", "foreign", 14, 90)];
  for (const [items, extra] of [
    [rows, { externalRank: new Map(rows.map((row, index) => [row.id, index])) }],
    [rows.map((row) => row.id.includes("-foreign-") ? { ...row, briefingAuthorityBonus: 20 } : row), {}],
    [rows.map((row) => ({ ...row, source: "yna" })), {}]
  ]) {
    const options = { ...nh108Options("news", 22), ...extra };
    const original = buildDigest(items, { ...options, selectedCategories: ["news", "empty-lane"] }).issues;
    assert.deepEqual(buildDigest(items, options).issues.map((issue) => issue.refs[0].id),
      original.map((issue) => issue.refs[0].id));
  }
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
  assert.match(chipIssue.headline, /검색과 함께 뜬/, `헤드라인이 이유를 안 밝힌다: ${chipIssue.headline}`);
  assert.match(chipIssue.headline, /SK하이닉스 반도체 증설/, `헤드라인에서 사건 주제가 빠졌다: ${chipIssue.headline}`);
});

test("개인판 중요 분야: 보도 근거가 커뮤니티 단일 반응보다 먼저 온다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    {
      id: "community",
      title: "비트코인 조만간 폭발각",
      source: "slrclub",
      sourceLabel: "SLR클럽",
      kind: "community",
      category: "business",
      score: 100,
      commentCount: 0,
      tags: [],
      editorialCandidate: { sourceRole: "community_signal" }
    },
    {
      id: "reported",
      title: "금융당국 가상자산 공시 기준 발표",
      source: "news",
      sourceLabel: "경제신문",
      kind: "news",
      category: "business",
      score: 0,
      commentCount: 0,
      tags: [],
      editorialCandidate: { sourceRole: "reported_secondary" }
    }
  ];

  const { issues } = buildDigest(items, { maxIssues: 2, selectedCategories: ["business"] });
  assert.deepEqual(issues.map((issue) => issue.refs[0].id), ["reported", "community"]);
  assert.equal(issues[1].metrics.communityOnly, true);
  assert.equal(issues[0].metrics.verifiedSourceCount, 1);
});

test("과학 개인판: 보도 근거를 커뮤니티 화제보다 먼저 편집한다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    {
      id: "science-community",
      title: "세탁기처럼 생긴 우주선 이야기",
      source: "community",
      sourceLabel: "커뮤니티",
      kind: "community",
      category: "science",
      score: 100,
      commentCount: 0,
      tags: [],
      editorialCandidate: { sourceRole: "community_signal" }
    },
    {
      id: "science-reported-a",
      title: "은 나노 촉매 반응 효율 연구 발표",
      source: "science-daily",
      sourceLabel: "ScienceDaily",
      kind: "news",
      category: "science",
      score: 0,
      commentCount: 0,
      tags: [],
      editorialCandidate: { sourceRole: "reported_secondary" }
    },
    {
      id: "science-reported-b",
      title: "초기 생명체 화석 분석 결과 공개",
      source: "physorg",
      sourceLabel: "Phys.org",
      kind: "news",
      category: "science",
      score: 0,
      commentCount: 0,
      tags: [],
      editorialCandidate: { sourceRole: "reported_secondary" }
    }
  ];

  const { issues } = buildDigest(items, { maxIssues: 3, selectedCategories: ["science"] });
  assert.deepEqual(issues.map((issue) => issue.refs[0].id), [
    "science-reported-a",
    "science-reported-b",
    "science-community"
  ]);
  assert.equal(issues[0].metrics.verifiedSourceCount, 1);
  assert.equal(issues[2].metrics.communityOnly, true);
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
  assert.equal(leadPhrase("“100억 벌어도 세금은 몇억밖에”…이 대통령, 부동산 세제 손본다"), "100억 벌어도 세금은 몇억밖에 이 대통령, 부동산 세제 손본다");
  assert.equal(leadPhrase("李·與 서울 지지율 뚝…40%선 무너져"), "李·與 서울 지지율 뚝");
  assert.equal(
    leadPhrase("전월세난·임차인 불안 우려에…정부, 실거주 의무 유예 확대 방침"),
    "전월세난·임차인 불안 우려에 정부, 실거주 의무 유예 확대 방침"
  );
  assert.equal(leadPhrase("기아 PV7 위장막 실물.."), "기아 PV7 위장막 실물");
  assert.equal(
    leadPhrase('"세제개편안 불확실해"…8월 전국 아파트 입주전망 하락'),
    "8월 전국 아파트 입주전망 하락"
  );
  assert.equal(
    leadPhrase('"세제개편안 불확실해"…전문가 의견 엇갈려'),
    "세제개편안 불확실해",
    "사건 구절이 없는 뒷말로 임의 교체하면 안 된다"
  );
  assert.equal(
    leadPhrase("반도체가 다 했다...관세청 ‘8월 초순 수출 역대 최대’"),
    "관세청 8월 초순 수출 역대 최대"
  );
  assert.equal(
    leadPhrase('"85초 만에 화염에 휩싸여"…中 창정 7A호 발사 실패'),
    "中 창정 7A호 발사 실패"
  );
  assert.equal(
    leadPhrase("You’ll Only Find This Scrumptious New Balance Dad Shoe in Japan"),
    "Youll Only Find This Scrumptious New Balance Dad Shoe in Japan"
  );
  assert.equal(
    leadPhrase("Magnitude 7.4 quake rocks western Colombia, killing at least 111 people"),
    "Magnitude 7.4 quake rocks western Colombia, killing at least 111 people",
    "72자 안의 영문 제목을 64자에서 잘라 문장을 망가뜨리면 안 된다"
  );
  assert.equal(
    leadPhrase("The Whitaker Group’s PUMA Era Starts With an Echo (& New-Old Sneaker)"),
    "The Whitaker Groups PUMA Era Starts With an Echo (& New-Old Sneaker)"
  );
  assert.equal(
    leadPhrase('"공격 지역 다 뛸 수 있는데..." 시메오네, 이강인 활용법 고민 시작 "좌 우 2선 가능"'),
    "공격 지역 다 뛸 수 있는데 시메오네, 이강인 활용법 고민 시작 좌 우 2선 가능"
  );
  assert.equal(
    leadPhrase('"나 반포 살지롱, 버스하우스 01"…2030 분노, \'폐버스 풍자 밈\' 확산'),
    "2030 분노, 폐버스 풍자 밈 확산"
  );
  assert.equal(
    leadPhrase('[현장] "해 뜬 줄 알았다"…밤새 불길 뒤덮인 평택 물류센터 화재 현장'),
    "밤새 불길 뒤덮인 평택 물류센터 화재 현장"
  );
  assert.equal(
    leadPhrase("죽어서 건지느니 살려서 보낸다…고수온에 양식장 치어 긴급방류"),
    "고수온에 양식장 치어 긴급방류"
  );
  assert.equal(
    leadPhrase('"국민의힘 의원 맞나"…윤상현 "득표 조작은 비약" 발언에 선관위 국조서 국힘끼리 언쟁'),
    "윤상현 득표 조작은 비약 발언에 선관위 국조서 국힘끼리 언쟁"
  );
  assert.equal(
    leadPhrase("'네가 사는 그 집'…부동산 세제의 새로운 방향"),
    "부동산 세제의 새로운 방향"
  );
  assert.equal(
    leadPhrase("55세에 이 3가지 없었더니…치매 없이 13년 더 살았다"),
    "치매 없이 13년 더 살았다"
  );
  assert.equal(
    leadPhrase("[헬스&라이프] 혈압·혈당·금연…노년 치매 13년 늦추는 세가지 핵심 키"),
    "노년 치매 13년 늦추는 세가지 핵심 키"
  );
  assert.equal(
    leadPhrase("논란 일자 결국 멈춘 SH…재개발임대 입주자 모집 연기"),
    "재개발임대 입주자 모집 연기"
  );
  assert.equal(
    leadPhrase("전세계 7월 극한폭염 이유 있었네...7월 해수면 온도 역대 최고"),
    "7월 해수면 온도 역대 최고"
  );
  assert.equal(
    leadPhrase('"상승률 32.5%"…\'삼전·닉스\' 레버리지 자금 빠지자 코스닥 급반등'),
    "삼전·닉스 레버리지 자금 빠지자 코스닥 급반등"
  );
  assert.equal(
    leadPhrase("순풍에 돛 단 반도체 덕…2분기 수출 2천755억달러로 역대 최대"),
    "2분기 수출 2천755억달러로 역대 최대"
  );
  assert.equal(
    leadPhrase("요즘 인디 게임들 핫하네…협동 파티 게임 빅 워크, 출시 6일 만에 100만 장 돌파"),
    "협동 파티 게임 빅 워크, 출시 6일 만에 100만 장 돌파"
  );
  assert.equal(
    leadPhrase("사후 치료 넘어 조기 개입…치매 치료 공식 바뀐다"),
    "치매 치료 공식 바뀐다"
  );
  assert.equal(
    leadPhrase("계속 웃기면 드라마예요…짝퉁 샀다는 김건희 왜 나만 수사하냐"),
    "짝퉁 샀다는 김건희 왜 나만 수사하냐"
  );
  assert.equal(
    issueSubject([
      { title: "\"55세에 '이 3가지' 없었더니\"…치매 없이 13년 더 살았다" },
      { title: "“55세에 ‘이 3가지’ 없었더니”…치매 없이 13년 더 살았다" },
      { title: "55세에 이 3가지 없었더니…치매 없이 13년 더 살았다" }
    ]),
    "치매 없이 13년 더 살았다",
    "중계 피드 공통어가 클릭 유도 앞구절을 사건명으로 굳히면 안 된다"
  );
  assert.equal(
    leadPhrase("긴 휴식 끝 전력대결···KIA, 가을야구 위한 스퍼트 낼까"),
    "KIA, 가을야구 위한 스퍼트 낼까"
  );
  assert.equal(
    leadPhrase("새벽 5시부터 ‘대출런’…5년 만에 부활한 대출총량제 공포"),
    "5년 만에 부활한 대출총량제 공포"
  );
  assert.equal(
    leadPhrase("폭탄 터진 듯 건물 와르르…지진 덮친 콜롬비아 '아비규환'(종합)"),
    "지진 덮친 콜롬비아 아비규환"
  );
  assert.equal(
    leadPhrase("시력이 얼마나 좋아질 지 감도 안 오네…지상 초정밀 촬영 신개념 인공위성 내년에 뜬다"),
    "지상 초정밀 촬영 신개념 인공위성 내년에 뜬다"
  );
  assert.equal(
    leadPhrase("“죽을 때까지 매년 3억”…추신수, 상상초월 메이저리그 연금"),
    "추신수, 상상초월 메이저리그 연금"
  );
  assert.equal(
    issueSubject([{ title: "삼성 갤럭시 S23 FE의 엑시노스 버전은 다른 갤럭시 S23 시리즈와 마찬가지로 안드로이드 17 업데이트를 더 이상 받지 못하게 됩니다." }]),
    ""
  );
  assert.equal(leadPhrase(""), "");
  assert.equal(leadPhrase(null), "");
  // 여러 편이 있으면 공통어가 우선이다 — 한 매체의 표현보다 낫다
  assert.equal(issueSubject([{ title: "주택 공급 대책" }, { title: "주택 공급 보고" }]), "주택 공급");
  assert.equal(issueSubject([
    { title: "[뉴욕증시] 유가 급등에 숨 고르며 CPI 경계…약세 마감" },
    { title: "[뉴욕증시] 유가 급등에 숨 고르며 CPI 경계…약세 마감" }
  ]), "유가 급등에 숨 고르며 CPI 경계", "같은 제목을 공통어 두 개로 다시 부수면 안 된다");

  // 단독 이슈들끼리도 헤드라인이 겹치지 않는다
  const mk = (id, title) => ({ id, title, sourceLabel: id, source: id, score: 0,
    commentCount: 0, coverage: 5, category: "business", tags: [id] });
  const { issues } = buildDigest([
    mk("a", "정부 주택 공급 대책 발표"), mk("b", "반도체 수출 최대치 경신")
  ], { maxIssues: 2 });
  const heads = issues.map((i) => i.headline);
  assert.equal(new Set(heads).size, 2, `헤드라인이 겹친다: ${heads.join(" | ")}`);
});

test("오늘판 판단가치: 제목 단어보다 사용자가 고른 분야가 설명의 주어다", async () => {
  const { editorialValue } = await import("../src/feed/engine.js");
  const value = (category, title) => editorialValue({
    categoryIds: [category],
    headline: title,
    refs: [{ title }]
  });

  assert.equal(value("sports", "폭염이 만든 KBO 선발 매치업").lens, "경기·선수");
  assert.equal(value("sports", "축구협회 심판 성접대 의혹 조사 착수").lens, "운영·신뢰");
  assert.equal(value("sports", "K리그 구장 낙하 사고").lens, "안전·운영");
  assert.equal(value("business", "JP모간 S&P500 목표치 8000 상향, AI 기대").lens, "시장·실적");
  assert.equal(value("politics", "젤렌스키 러시아 북한군 추가 배치 준비").lens, "외교·안보");
  assert.equal(value("life", "임신부 백신이 만드는 모체 항체").lens, "건강·근거");
  assert.equal(value("life", "레켐비 치료, 림프 부스팅이 함께 필요한 이유").lens, "건강·근거");
  assert.equal(value("news", "콜롬비아 강진으로 건물 붕괴").lens, "재난·안전");
  assert.equal(value("news", "한일 미군기지, 북중 공격에 취약").lens, "국제정세");
});

test("오늘판 판단가치: 복수 분야 사건은 한 분야에 치우치지 않는 고정 설명을 쓴다", async () => {
  const { editorialValue } = await import("../src/feed/engine.js");
  const issue = {
    categoryIds: ["culture", "realestate"],
    headline: "가수 소유 건물 매입과 활동 계획 공개",
    refs: [{ title: "가수 소유 건물 매입과 활동 계획 공개" }]
  };

  assert.deepEqual(editorialValue(issue), {
    lens: "복합 이슈",
    text: "여러 관심 분야에 걸친 사안이라 현재 확인된 사실과 후속 변화를 함께 볼 가치가 있다."
  });
});

test("오늘판 분야 게이트: 잘못 라벨된 금융·관광·사내행사는 대표 후보에서 제외한다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, category, title, coverage = 5) => ({
    id,
    category,
    title,
    source: id,
    sourceLabel: id,
    coverage,
    score: 0,
    commentCount: 0,
    tags: [id]
  });
  const badIds = new Set([
    "travel-gacha", "science-etf", "tech-market", "corporate-event", "fashion-movie", "tech-game",
    "tech-fortnite", "culture-history", "humor-massacre", "realestate-incident", "tech-culture-event"
  ]);
  const { issues, quality } = buildDigest([
    mk("travel-gacha", "gaming", "강원관광재단 감탄로드 여행가챠 서울서 팝업스토어"),
    mk("science-etf", "science", "KB운용 미국우주위성통신 ETF 출시 스페이스X 등 투자"),
    mk("tech-market", "tech", "뉴욕증시 유가 5%대 급등 3대 지수 하락 반도체주 약세"),
    mk("corporate-event", "business", "대우건설 임직원 초청 행사 진행"),
    mk("fashion-movie", "fashion", "악마는 프라다를 입는다 명장면.JPG"),
    mk("tech-game", "tech", "Pokémon Pokopia 가이드 Totodile 위치와 Outfit 잠금 해제"),
    mk("tech-fortnite", "tech", "포트나이트 챕터 7 에픽게임즈 향후 계획"),
    mk("culture-history", "culture", "이완용은 명함도 못 내밀 최악의 친일 매국노"),
    mk("humor-massacre", "humor", "조선인 8천여 명 대학살한 일본"),
    { ...mk("realestate-incident", "realestate", "[속보]‘제주항공 여객기 참사’ 경찰 특수단, 한국공항공사·국토부 압수수색"), registryCategory: "news" },
    mk("tech-culture-event", "tech", "뮤즈엠, 글로벌 아티스트 IP 전시 사업 본격화…엔하이픈 전시 서울 개최"),
    mk("real-game", "gaming", "메이플 신규 직업 업데이트와 밸런스 패치 공개"),
    mk("real-science", "science", "연구진 은 나노촉매 내부 반응 스위치 발견"),
    mk("real-tech", "tech", "안드로이드 17 업데이트 지원 기기 공개"),
    mk("real-business", "business", "코스피 상승과 원달러 환율 하락"),
    mk("real-realestate", "realestate", "서울 아파트 분양과 청약 일정 발표"),
    mk("real-news", "news", "평택 위험물 창고 화재 진화 완료")
  ], {
    maxIssues: 10,
    selectedCategories: ["gaming", "science", "tech", "business", "realestate", "news"],
    minIssuesPerCategory: 1
  });
  const selectedIds = new Set(issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  for (const id of badIds) assert.ok(!selectedIds.has(id), `${id}가 분야 대표로 남았다`);
  for (const id of ["real-game", "real-science", "real-tech", "real-business", "real-realestate", "real-news"]) {
    assert.ok(selectedIds.has(id), `${id} 정상 후보가 사라졌다`);
  }
  assert.ok((quality.failuresByRule.categoryFitSupported || 0) >= badIds.size);
});

test("브리핑 이슈: 근접 중복 헤드라인은 최대 1건만 뽑고 빈 자리는 다음 이슈로 채운다", async () => {
  // 실측(2026-08-09): /api/briefing 이슈 6건 중 4건이 "채상병 순직 책임
  // 임성근" 변주였다. clusterIssues는 완전일치 제목·원문 URL만 묶는데(문단에 서로
  // 다른 사실이 섞이면 안 되므로 그대로 둔다), 인명은 태그 사전에 없어서
  // 어순만 다른 4건이 각각 다른 클러스터가 됐고 전부 이슈 자리를 차지했다.
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, extra) => ({
    id, title, sourceLabel: id, source: id, score: 0, commentCount: 0,
    coverage: 3, category: "politics", tags: [], ...extra
  });
  const items = [
    mk("a", "채상병 순직 책임 놓고 임성근 전 사단장 구속영장 재청구", { coverage: 5 }),
    mk("b", "'채상병 순직' 책임자 임성근, 구속영장 다시 청구", { coverage: 4 }),
    mk("c", "임성근 전 사단장 구속영장 재청구...채상병 순직 책임 물어"),
    mk("d", "[속보] 채상병 순직 책임 임성근 구속 위기, 검찰 영장 재청구"),
    mk("e", "삼성전자 3분기 실적 발표, 영업이익 급증", { category: "business", coverage: 2 }),
    mk("f", "서울 아파트값 상승세 지속...정부 대책 검토", { category: "business", coverage: 2 })
  ];
  const { issues, quality } = buildDigest(items, {
    maxIssues: 6,
    selectedCategories: ["politics", "business"]
  });
  const chaeIssues = issuesContainingAnyId(issues, ["a", "b", "c", "d"]);
  assert.equal(chaeIssues.length, 1,
    `변주 4건은 이슈 자리 하나만 차지해야 한다: ${chaeIssues.map((i) => i.refs.map((r) => r.id)).join("|")}`);
  // 빈 자리는 지워지는 게 아니라 다음 순위의 서로 다른 사건이 채운다
  const ids = new Set(issues.flatMap((i) => i.refs.map((r) => r.id)));
  assert.ok(ids.has("e") && ids.has("f"), "빈 자리는 다음 순위 이슈로 채워져야 한다");
  // 이 픽스처는 서로 다른 사건이 3건뿐이다(채상병 그룹 1 + e + f) — 재료가
  // 그만큼밖에 없으면 이슈도 그만큼만 나와야 한다(억지로 6건을 채우지 않는다)
  assert.equal(issues.length, 3, "서로 다른 사건 수만큼만 이슈가 나와야 한다");
  const politics = quality.categoryFunnel.find((row) => row.categoryId === "politics");
  assert.deepEqual(
    [politics.inputItemCount, politics.clusterCount, politics.machinePassClusterCount,
      politics.qualifiedClusterCount, politics.draftSelectedCount],
    [4, 4, 4, 1, 1],
    "수집 아이템과 근접중복 제거 뒤 유효 이슈를 같은 수로 표시하면 안 된다"
  );
  for (const row of quality.categoryFunnel) {
    assert.ok(row.inputItemCount >= row.clusterCount);
    assert.ok(row.clusterCount >= row.machinePassClusterCount);
    assert.ok(row.machinePassClusterCount >= row.qualifiedClusterCount);
    assert.ok(row.qualifiedClusterCount >= row.draftSelectedCount);
  }

  const observed = [
    mk("trump-a", "트럼프 대통령, 이란에 배상 요구"),
    mk("trump-b", "트럼프 이란, 과거 폭탄테러·시위대 살해 배상하라"),
    mk("visa", "트럼프 취임 후 비자 17만5000건 취소"),
    mk("referee-a", "축구협회 성접대 의혹 아직 수사 착수 안한 경찰", { category: "sports" }),
    mk("referee-b", "한국 심판 성접대 논란, 일본축구협회가 조사 착수", { category: "sports" }),
    mk("baseball", "KT 힐리어드 KBO 7월 월간 MVP 선정", { category: "sports" }),
    mk("pc-a", "Grand Theft Auto averages more copies sold per year than most megahits manage in their entire lifetime", { category: "gaming" }),
    mk("pc-b", "Square Enix financial report gives me hope for FF14, suggesting the MMO is finally not having to carry the company", { category: "gaming" }),
    mk("mojtaba-a", "이란 은둔 지도자 모즈타바 권력강화 박차, 군 지휘부 강경파 등용", { category: "news" }),
    mk("mojtaba-b", "위독설 모즈타바 대통령 7시간 면담, 강경 일색 군 인사 단행", { category: "news" }),
    mk("long-name-a", "오픈스트리트맵 지도 데이터 업데이트", { category: "tech" }),
    mk("long-name-b", "오픈스트리트맵 재단 운영 정책 발표", { category: "tech" })
  ];
  const observedDigest = buildDigest(observed, {
    maxIssues: observed.length,
    selectedCategories: ["politics", "sports", "gaming"]
  });
  const observedIds = new Set(observedDigest.issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.equal(issuesContainingAnyId(observedDigest.issues, ["trump-a", "trump-b"]).length, 1);
  assert.ok(observedIds.has("visa"), "같은 인물이 등장해도 다른 비자 사건은 남겨야 한다");
  assert.equal(issuesContainingAnyId(observedDigest.issues, ["referee-a", "referee-b"]).length, 1);
  assert.ok(observedIds.has("baseball"));
  assert.ok(observedIds.has("pc-a") && observedIds.has("pc-b"), "영문 불용어가 겹친 두 게임 기사는 모두 남아야 한다");
  assert.equal(issuesContainingAnyId(observedDigest.issues, ["mojtaba-a", "mojtaba-b"]).length, 1,
    "같은 긴 인물명과 같은 흐름어가 겹친 보도는 한 판에서 하나만 대표해야 한다");
  assert.ok(observedIds.has("long-name-a") && observedIds.has("long-name-b"),
    "긴 이름 하나만 같은 별개 사건까지 합치면 안 된다");

  const samePublisherTopic = buildDigest([
    mk("chip-a", "김정관 호남 반도체 클러스터 2029년까지 팹 1차 완공 목표", {
      category: "tech", source: "gnews-tech", sourceLabel: "hani.co.kr"
    }),
    mk("chip-b", "이 대통령 호남 반도체 전격전 광주 군공항 기능 이전", {
      category: "tech", source: "gnews-tech", sourceLabel: "hani.co.kr"
    }),
    mk("windows", "메모리 덜 쓰는 윈도우 세팅 공개", {
      category: "tech", source: "pc", sourceLabel: "아이러브PC방"
    })
  ], { maxIssues: 3, selectedCategories: ["tech"] });
  const topicIds = new Set(samePublisherTopic.issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.equal(issuesContainingAnyId(samePublisherTopic.issues, ["chip-a", "chip-b"]).length, 1,
    "같은 매체의 같은 분야 후속 각도가 한 판의 여러 자리를 차지하면 안 된다");
  assert.ok(topicIds.has("windows"), "주제 중복을 접은 자리는 다른 기술 이슈가 채워야 한다");

  const actualEventVariants = buildDigest([
    mk("visa-news", "미국, 비자 규정 위반·범죄 등으로 외국인 비자 17만5천 건 이상 취소", {
      category: "news", coverage: 5
    }),
    mk("visa-politics", "美국무부 원정 출산, 트럼프 위협 등 외국인 17만5000명 비자 취소", {
      category: "politics", coverage: 5
    }),
    mk("quake-a", "또다시 불의 고리, 콜롬비아 강진 깊은 진원에도 대참사 공포", {
      category: "news", coverage: 5
    }),
    mk("quake-b", "콜롬비아 지진으로 최소 132명 사망, 수년래 최대 규모", {
      category: "news", coverage: 5
    }),
    mk("other-quake", "일본 홋카이도 지진으로 철도 운행 중단", {
      category: "news", coverage: 5
    }),
    mk("other-trump", "트럼프 행정부 수입품 관세 인상안 발표", {
      category: "politics", coverage: 5
    })
  ], { maxIssues: 6, selectedCategories: ["news", "politics"] });
  const actualIds = new Set(actualEventVariants.issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.equal(issuesContainingAnyId(actualEventVariants.issues, ["visa-news", "visa-politics"]).length, 1,
    "같은 17만5000건 비자 취소가 news와 politics 자리를 각각 차지하면 안 된다");
  assert.equal(issuesContainingAnyId(actualEventVariants.issues, ["quake-a", "quake-b"]).length, 1,
    "콜롬비아 강진과 지진 표기 변주는 한 사건이어야 한다");
  assert.ok(actualIds.has("other-quake"), "다른 나라의 별개 지진은 남아야 한다");
  assert.ok(actualIds.has("other-trump"), "같은 인물의 별개 정책은 남아야 한다");
});

test("오병합 가드: 같은 분야의 일반어가 겹쳐도 정식 사건 판정이 거부한 기사는 합치지 않는다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    {
      id: "valuation",
      kind: "news",
      source: "marketwatch-top",
      sourceLabel: "MarketWatch",
      category: "business",
      admittedCategories: ["business"],
      title: "Anthropic의 가치는 2조 달러입니까? 회사가 새로운 토큰화된 시장에서 거래하는 방법은 다음과 같습니다.",
      originalTitle: "Is Anthropic worth $2 trillion? Here’s how the company is trading in a new tokenized market.",
      publishedAt: "2026-08-28T10:29:00.000Z",
      url: "https://www.marketwatch.com/story/anthropic-tokenized-market",
      score: 0,
      commentCount: 0,
      coverage: 0,
      tags: []
    },
    {
      id: "insider-trading",
      kind: "community",
      source: "techmeme",
      sourceLabel: "Techmeme",
      category: "business",
      admittedCategories: ["business"],
      title: "출처: 연방 당국은 새로운 사건의 일환으로 US 군인과 KPMG 직원을 예측 시장의 내부자 거래 혐의로 기소할 준비를 하고 있습니다.",
      originalTitle: "Sources: federal authorities prepare to charge a US serviceman and a KPMG employee with insider trading on prediction markets, as part of a new batch of cases",
      publishedAt: "2026-08-28T02:55:01.000Z",
      url: "https://www.techmeme.com/260827/p62#a260827p62",
      score: 0,
      commentCount: 0,
      coverage: 0,
      tags: []
    }
  ];

  const { issues } = buildDigest(items, { maxIssues: 2, selectedCategories: ["business"] });
  assert.equal(issues.length, 2, "별개 사건 두 건이 한 이슈로 합쳐지면 안 된다");
  assert.deepEqual(
    issues.map((issue) => issue.refs.map((ref) => ref.id)).sort(),
    [["insider-trading"], ["valuation"]],
    "각 사건은 자기 출처만 보존해야 한다"
  );
});

test("후속 보도 계보: 같은 재난이라도 원인·구조·피해처럼 사실 초점이 다른 묶음은 다시 합치지 않는다", async () => {
  const { nearIssueGroups } = await import("../src/feed/digest.js");
  const mk = (id, title) => ({
    id, title, category: "news", sourceLabel: id, source: id,
    score: 0, commentCount: 0, coverage: 5, tags: []
  });
  const scored = [
    { members: [mk("cause-a", "네팔 홍수 빙하호 붕괴가 원인으로 지목"), mk("cause-b", "네팔 홍수 원인 빙하호 붕괴") ] },
    { members: [mk("rescue-a", "네팔 홍수 생존자 구조와 가족 수색 이어져"), mk("rescue-b", "네팔 홍수 생존자 수색 계속") ] },
    { members: [mk("damage-a", "네팔 홍수 사망자 늘어 피해 집계"), mk("damage-b", "네팔 홍수 피해 사망자 추가 확인") ] }
  ];
  const canonicalEvents = scored.map((cluster, index) => ({
    eventId: `nepal-flood-${index}`,
    memberArticleIds: cluster.members.map((item) => item.id)
  }));

  const groups = nearIssueGroups(scored, canonicalEvents);
  assert.equal(groups.length, 3,
    "사건 클러스터가 나눈 후속 각도를 홍수라는 공통어만으로 다시 합치면 안 된다");
});

test("커뮤니티 전재와 정식 결혼 보도는 숫자 표현이 달라도 24시간 안이면 한 자리로 접는다", async () => {
  const { nearIssueGroups } = await import("../src/feed/digest.js");
  const mk = (id, title, kind) => ({
    id, title, kind, category: "culture", admittedCategories: ["culture"],
    source: id, sourceLabel: id, score: 0, commentCount: 0, coverage: 0, tags: []
  });
  const community = mk("wedding-community",
    "[단독] 지예은♥바타, 부부 된다… 12월 12일 결혼", "community");
  const reporting = mk("wedding-report",
    "지예은♥바타, 공개 열애 5개월 만에 결혼 발표…인생 함께 하기로 약속", "news");
  const canonicalEvents = [
    {
      eventId: "wedding-community-event",
      memberArticleIds: [community.id],
      firstSeenAt: "2026-09-01T22:53:00.000Z",
      sourceEvidence: [{ articleId: community.id, title: community.title,
        operatorGroup: "instiz", publishedAt: null, evidenceRole: "community_post" }]
    },
    {
      eventId: "wedding-report-event",
      memberArticleIds: [reporting.id],
      firstSeenAt: "2026-09-02T00:10:00.000Z",
      sourceEvidence: [{ articleId: reporting.id, title: reporting.title,
        operatorGroup: "ytn", publishedAt: "2026-09-02T00:10:00.000Z", evidenceRole: "reporting" }]
    }
  ];

  assert.equal(nearIssueGroups([
    { members: [community] }, { members: [reporting] }
  ], canonicalEvents).length, 1);
});

test("정식 사건이 갈라져도 명백한 화면 중복은 한 자리만 쓰고 다음 사건으로 채운다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, source, score, seconds) => ({
    id, title, source, sourceLabel: source,
    kind: "news", category: "sports", admittedCategories: ["sports"],
    url: `https://${source}.example.com/${id}`,
    score, commentCount: 0, coverage: 0, tags: [],
    publishedAt: new Date(Date.parse("2026-09-01T03:00:00Z") + seconds * 1000).toISOString()
  });
  const items = [
    mk("messi-a", "메시 아르헨티나 대표팀 은퇴 공식 발표", "sports-a", 500, 0),
    mk("messi-b", "메시 아르헨티나 대표팀 은퇴 확정", "sports-b", 400, 60),
    mk("moreno-a", "축구대표팀 임시 감독에 모레노 선임", "yna-sports", 300, 120),
    mk("moreno-b", "젊은 사령탑 모레노 한국축구 구할까", "yna-sports", 200, 150),
    mk("lee", "이강인 아틀레티코 데뷔전 도움 기록", "sports-c", 100, 180)
  ];
  const canonicalEvents = items.map((item) => ({
    eventId: `event-${item.id}`,
    memberArticleIds: [item.id]
  }));

  const { issues } = buildDigest(items, {
    maxIssues: 3,
    maxPerSource: 3,
    selectedCategories: ["sports"],
    minIssuesPerCategory: 3,
    additiveCategoryUnion: true,
    canonicalEvents
  });
  const ids = issues.map((issue) => issue.refs[0]?.id);

  assert.deepEqual(ids, ["messi-a", "moreno-a", "lee"]);
  assert.deepEqual(issues.flatMap((issue) => issue.refs.map((ref) => ref.id)),
    ["messi-a", "moreno-a", "lee"],
    "서로 다른 정식 사건의 근거를 한 카드에 합치지 않고 화면 자리만 중복 제거해야 한다");
});

test("최종 출처 제목에서 드러나는 보도 중복과 보도에 붙은 커뮤니티 반응도 한 자리만 쓴다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, source, kind = "news") => ({
    id, title, source, sourceLabel: source, kind,
    category: "sports", admittedCategories: ["sports"],
    url: `https://${source}.example.com/${id}`,
    score: 0, commentCount: 0, coverage: 0, tags: []
  });
  const rows = [
    mk("moreno-main", "축구대표팀 새 감독 발표", "yna-sports"),
    mk("moreno-follow", "대표팀 사령탑 인선 후속", "yna-sports"),
    mk("go-report", "프로야구 선수 거취 보도", "yna-sports"),
    mk("go-community", "야구 팬 반응", "theqoo", "community"),
    mk("next", "이강인 아틀레티코 데뷔전 도움 기록", "sports-next")
  ];
  const canonicalEvents = [
    {
      eventId: "moreno-a", memberArticleIds: ["moreno-main"],
      sourceEvidence: [{ articleId: "moreno-main", title: "축구대표팀 임시 감독에 모레노 선임",
        operatorGroup: "yonhap", publishedAt: "2026-09-01T03:18:16Z", evidenceRole: "reporting" }]
    },
    {
      eventId: "moreno-b", memberArticleIds: ["moreno-follow"],
      sourceEvidence: [{ articleId: "moreno-follow", title: "48세 젊은 사령탑 모레노 한국축구 구할까",
        operatorGroup: "yonhap", publishedAt: "2026-09-01T03:18:42Z", evidenceRole: "reporting" }]
    },
    {
      eventId: "go-report", memberArticleIds: ["go-report"],
      sourceEvidence: [{ articleId: "go-report", title: "고우석 LG 복귀 유력",
        operatorGroup: "yonhap", publishedAt: "2026-09-01T03:20:00Z", evidenceRole: "reporting" }]
    },
    {
      eventId: "go-community", memberArticleIds: ["go-community"],
      sourceEvidence: [{ articleId: "go-community", title: "고우석 한국 복귀",
        operatorGroup: "theqoo", publishedAt: null, evidenceRole: "community_post" }]
    },
    {
      eventId: "next", memberArticleIds: ["next"],
      sourceEvidence: [{ articleId: "next", title: rows[4].title,
        operatorGroup: "sports-next", publishedAt: "2026-09-01T03:30:00Z", evidenceRole: "reporting" }]
    }
  ];

  const { issues } = buildDigest(rows, {
    maxIssues: 3,
    maxPerSource: 3,
    selectedCategories: ["sports"],
    minIssuesPerCategory: 3,
    additiveCategoryUnion: true,
    canonicalEvents
  });

  assert.deepEqual(issues.map((issue) => issue.refs[0]?.id), ["moreno-main", "go-report", "next"]);
  assert.deepEqual(issues.flatMap((issue) => issue.refs.map((ref) => ref.id)),
    ["moreno-main", "go-report", "next"],
    "화면 중복을 없애되 서로 다른 정식 사건의 근거를 합치면 안 된다");
});

test("측정 중요도가 같으면 해외 필러보다 국내 사건을 먼저 둔다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const items = [
    { id: "foreign-filler", title: "해외 지역 행사 일정 공개", source: "foreign",
      sourceLabel: "해외매체", lang: "en", kind: "news", category: "news",
      admittedCategories: ["news"], url: "https://foreign.example.com/filler",
      score: 0, commentCount: 0, coverage: 0, tags: [] },
    { id: "domestic", title: "전국 호우 피해와 열차 운행 조정", source: "domestic",
      sourceLabel: "국내매체", lang: "ko", kind: "news", category: "news",
      admittedCategories: ["news"], url: "https://domestic.example.com/rain",
      score: 0, commentCount: 0, coverage: 0, tags: [] }
  ];

  const { issues } = buildDigest(items, { maxIssues: 1, selectedCategories: ["news"] });
  assert.equal(issues[0].refs[0].id, "domestic");
});

test("편집 단계는 정식 사건 엔진이 나눈 네팔 홍수 본류와 원인 해설을 다시 합치지 않는다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, originalTitle, publishedAt) => ({
    id, title, originalTitle, publishedAt,
    kind: "news", category: "news", admittedCategories: ["news"],
    source: id, sourceLabel: id, url: `https://example.com/${id}`,
    score: 0, commentCount: 0, coverage: 5, tags: []
  });
  const mainIds = ["toll-old", "toll-latest"];
  const causeIds = ["cause-report", "ebs-retrospective"];
  const rows = [
    mk("toll-old", "네팔 홍수에 826명 실종·165명 사망", null, "2026-08-28T04:00:00Z"),
    mk("toll-latest", "네팔·중국 대홍수 사망자 543명 실종자 1535명",
      "Nepal-Tibet flash flood death toll rises to 543 as rescue operations resume", "2026-08-28T10:49:12Z"),
    mk("cause-report", "전문가들은 네팔 홍수는 빙하 붕괴로 촉발됐다고 설명",
      "Devastating Nepal floods were triggered by glacier collapse, experts say", "2026-08-28T07:00:00Z"),
    mk("ebs-retrospective", "12년 전 이미 네팔 빙하 홍수 내다본 EBS", null, "2026-08-28T11:00:00Z")
  ];
  const canonicalEvents = [
    { eventId: "nepal-flood-toll", memberArticleIds: mainIds },
    { eventId: "nepal-flood-cause", memberArticleIds: causeIds }
  ];
  const { issues } = buildDigest(rows, {
    maxIssues: 4,
    selectedCategories: ["news"],
    canonicalEvents
  });

  assert.equal(issuesContainingAnyId(issues, mainIds).length, 1);
  assert.equal(issuesContainingAnyId(issues, causeIds).length, 1);
  assert.equal(issues.some((issue) => {
    const ids = new Set(issue.refs.map((ref) => ref.id));
    return mainIds.some((id) => ids.has(id)) && causeIds.some((id) => ids.has(id));
  }), false, "정식 사건 엔진이 나눈 두 사건의 출처가 한 카드에 섞이면 안 된다");
});

// ---------------------------------------------------------------------------
// 오병합 가드(David 승인, 2026-08-17) — nearIssueGroups의 서로 다른 분야
// 병합 휴리스틱은 숫자 하나만 우연히 같아도 통계 서술어("기록적", "증가" 등)
// 까지 겹치면 sharedConcepts가 문턱(3)을 넘어 병합됐다(오병합 사례: 사망자
// 수치와 피해신고 건수가 우연히 같은 값). event-cluster.js의
// guard_numbers_only_overlap 원리(숫자 겹침만으로 병합 금지)를 적용해,
// 숫자·통계 서술어를 뺀 실제 주제어가 최소 1개는 겹쳐야만 병합한다.
// ---------------------------------------------------------------------------

test("오병합 가드 동결: 서로 다른 분야에서 통계 수치만 우연히 같으면 병합하지 않는다 (에볼라/호우 재현)", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, extra) => ({
    id, title, sourceLabel: id, source: id, score: 0, commentCount: 0,
    coverage: 3, tags: [], ...extra
  });
  const items = [
    // 재현 픽스처(실제 오병합 관측 패턴을 구성 재현): "2300"이라는 숫자값이
    // 우연히 같고, 남은 겹침이 사건을 특정하지 못하는 통계 서술어뿐이다.
    mk("ebola", "에볼라 확산에 사망자 2300명 기록적 증가", { category: "news" }),
    mk("flood", "호우 피해신고 2300건 기록적 증가", { category: "society" }),
    // 대조군: 같은 판에 정말 여러 매체가 다룬 별개 사건도 하나씩 있어야
    // "우연히 둘 다 컷됐다"가 아니라 "병합만 안 됐다"임을 보증한다.
    mk("other-a", "반도체 수출 역대 최대 실적 경신", { category: "business", coverage: 2 }),
    mk("other-b", "야구 국가대표 평가전 승리", { category: "sports", coverage: 2 })
  ];
  const { issues } = buildDigest(items, {
    maxIssues: 4, selectedCategories: ["news", "society", "business", "sports"]
  });
  const ids = new Set(issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.ok(ids.has("ebola"), "에볼라 사건은 독립 이슈로 남아야 한다");
  assert.ok(ids.has("flood"), "호우 사건은 독립 이슈로 남아야 한다");
  assert.equal(issuesContainingAnyId(issues, ["ebola", "flood"]).length, 2,
    "숫자만 우연히 같은 두 사건이 한 이슈로 합쳐지면 안 된다");
});

test("오병합 가드 동결: 정당 병합(같은 사건 다매체 — 숫자+실제 주제어 함께 겹침)은 그대로 유지한다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, extra) => ({
    id, title, sourceLabel: id, source: id, score: 0, commentCount: 0,
    coverage: 5, tags: [], ...extra
  });
  const items = [
    mk("visa-news", "미국, 비자 규정 위반·범죄 등으로 외국인 비자 17만5천 건 이상 취소",
      { category: "news" }),
    mk("visa-politics", "美국무부 원정 출산, 트럼프 위협 등 외국인 17만5000명 비자 취소",
      { category: "politics" })
  ];
  const { issues } = buildDigest(items, { maxIssues: 2, selectedCategories: ["news", "politics"] });
  assert.equal(issuesContainingAnyId(issues, ["visa-news", "visa-politics"]).length, 1,
    "숫자와 함께 '비자·외국인·취소' 같은 실제 주제어가 겹치는 정당 병합은 계속 되어야 한다");
});

test("브리핑 이슈: 같은 판의 커뮤니티 말바꿈과 같은 발표의 후속 각도를 한 자리로 접는다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const mk = (id, title, extra = {}) => ({
    id,
    title,
    source: extra.source || "ppomppu",
    sourceLabel: extra.sourceLabel || "뽐뿌",
    kind: extra.kind || "community",
    category: extra.category || "auto",
    score: extra.score || 0,
    commentCount: extra.commentCount || 0,
    coverage: extra.coverage || 0,
    tags: []
  });
  const community = buildDigest([
    mk("car-a", "아반떼 승차감 좋다는 후기", { commentCount: 129 }),
    mk("car-b", "아반떼 승차감 별로라는 반론", { commentCount: 183 }),
    mk("car-c", "전기차 겨울철 주행거리 비교", { source: "other", sourceLabel: "자동차 매체", kind: "news" })
  ], { maxIssues: 3, selectedCategories: ["auto"] });
  const communityIds = new Set(community.issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.equal(issuesContainingAnyId(community.issues, ["car-a", "car-b"]).length, 1);
  assert.ok(communityIds.has("car-c"), "중복을 접은 자리는 다른 자동차 이슈가 채워야 한다");

  const housing = buildDigest([
    mk("house-a", "오세훈, 8만7천가구 순증 제시…재개발·재건축 효과 강조", {
      source: "hani", sourceLabel: "한겨레", kind: "news", category: "politics", coverage: 5
    }),
    mk("house-b", "오세훈 용산 1,695세대 순증...정비사업, 유일한 공급 해법", {
      source: "yna", sourceLabel: "연합뉴스TV", kind: "news", category: "politics", coverage: 5
    }),
    mk("policy", "국회 연금개혁 특별위원회 협상 재개", {
      source: "news", sourceLabel: "뉴스", kind: "news", category: "politics", coverage: 5
    })
  ], { maxIssues: 3, selectedCategories: ["politics"] });
  const housingIds = new Set(housing.issues.flatMap((issue) => issue.refs.map((ref) => ref.id)));
  assert.equal(issuesContainingAnyId(housing.issues, ["house-a", "house-b"]).length, 1);
  assert.ok(housingIds.has("policy"));
});

test("브리핑 사건 결합: 넓은 태그나 우연한 공통어로 서로 다른 글을 한 문단에 섞지 않는다", async () => {
  const { clusterIssues } = await import("../src/feed/digest.js");
  const rows = [
    {
      id: "hn",
      title: "New Zealand lost its music media, and what we're building to replace it",
      url: "https://propelmusic.co.nz/articles/the-sound-went-quiet-nz-music-media",
      tags: ["lost", "media"]
    },
    {
      id: "ti",
      title: "What we lost when we quit using crappy old web forums",
      url: "https://tedium.co/2026/07/01/online-web-forums-retrospective/",
      tags: ["lost", "media"]
    },
    {
      id: "hb1",
      title: "Suicoke Updates Its Footwear Collection",
      url: "https://hypebeast.com/2026/8/suicoke-footwear",
      tags: ["fashion", "sneakers"]
    },
    {
      id: "hb2",
      title: "A Rare Ferrari Heads to Auction",
      url: "https://hypebeast.com/2026/8/ferrari-auction",
      tags: ["fashion", "sneakers"]
    }
  ];
  assert.deepEqual(clusterIssues(rows).map((cluster) => cluster.map((item) => item.id)), [
    ["hn"], ["ti"], ["hb1"], ["hb2"]
  ]);
});

test("브리핑 사건 결합: 같은 정규 제목 또는 같은 원문 URL은 계속 한 사건으로 묶는다", async () => {
  const { clusterIssues } = await import("../src/feed/digest.js");
  const rows = [
    { id: "title-a", title: "[속보] 정부 주택 공급 대책 발표", url: "https://a.example/1" },
    { id: "title-b", title: "정부 주택 공급 대책 발표 - 연합뉴스", url: "https://b.example/2" },
    { id: "url-a", title: "첫 번째 소개 제목", url: "https://source.example/story?id=7&utm_source=rss" },
    { id: "url-b", title: "완전히 다른 소개 제목", url: "https://source.example/story?utm_medium=feed&id=7" }
  ];
  assert.deepEqual(clusterIssues(rows).map((cluster) => cluster.map((item) => item.id)), [
    ["title-a", "title-b"], ["url-a", "url-b"]
  ]);
});

test("이미 복수 출처로 묶인 사건에도 같은 핵심어·금액의 커뮤니티 관측을 합친다", async () => {
  const { buildDigest } = await import("../src/feed/digest.js");
  const rows = [
    { id: "nayeon-community", title: "[단독] 트와이스 나연, 청담동 건물 95억원에 샀다",
      kind: "community", category: "culture", admittedCategories: ["culture", "realestate"],
      source: "theqoo", sourceLabel: "더쿠", publishedAt: "2026-08-28T10:58:00+09:00",
      score: 40424, commentCount: 372, coverage: 5, tags: [] },
    { id: "nayeon-mk", title: "트와이스 나연, 청담동 95억 건물주 됐다",
      kind: "news", category: "realestate", admittedCategories: ["realestate"],
      source: "mk-realestate", sourceLabel: "매경 부동산", publishedAt: "2026-08-28T11:22:06+09:00",
      score: 0, commentCount: 0, coverage: 5, tags: [] },
    { id: "nayeon-hk", title: "39억 아파트 사들이더니 30세 나연, 95억 건물주 됐다",
      kind: "news", category: "realestate", admittedCategories: ["realestate"],
      source: "hankyung", sourceLabel: "한국경제", publishedAt: "2026-08-28T11:38:02+09:00",
      score: 0, commentCount: 0, coverage: 5, tags: [] }
  ];
  const { issues } = buildDigest(rows, {
    maxIssues: 3,
    selectedCategories: ["culture", "realestate"]
  });
  const hits = issuesContainingAnyId(issues, rows.map((row) => row.id));
  assert.equal(hits.length, 1, "같은 나연 건물 매입 사건이 카드 두 장을 차지하면 안 된다");
  assert.deepEqual(hits[0].refs.map((ref) => ref.id).sort(), rows.map((row) => row.id).sort());
});

test("브리핑 이슈: 잘라 온 구절에 부호 흔적이 남지 않는다", async () => {
  // 실측(2026-08-05 라이브): 5개 매체가 다룬 “이 대통령 “북한과 대결, 정무적
  // 열린 따옴표가 닫히지 않아 문장이 깨져 보였다. "Bending Spoons," 처럼
  // 꼬리 쉼표도 남았다. 우리 문장 안에 인용부호로 넣는 말이므로 짝이 맞아야 한다.
  const { leadPhrase, tidyPhrase } = await import("../src/feed/digest.js");
  const p = leadPhrase("이 대통령 “북한과 대결, 정무적 판단이었다”");
  assert.ok(!/[“”]/.test(p), `짝 안 맞는 따옴표가 남았다: ${p}`);
  assert.ok(!/,\s*$/.test(leadPhrase("Bending Spoons, 인수 발표")), "꼬리 쉼표가 남았다");
  // 짝이 맞으면 그대로 둔다 — 멀쩡한 인용을 지우면 뜻이 바뀐다
  assert.equal(tidyPhrase("그는 “맞다”고 했다"), "그는 “맞다”고 했다");
  assert.equal(tidyPhrase("코스피, 장 초반 매수 사이드카 발동"), "코스피, 장 초반 매수 사이드카 발동");
  assert.equal(tidyPhrase("끝에 붙은 이음표 —"), "끝에 붙은 이음표");
});

test("브리핑 이슈: 말머리로 시작하는 제목도 이름을 얻는다", async () => {
  // 실측: 라이브 이슈 6개 중 2개가 "[속보]"처럼 괄호로 시작해 첫 조각이 비었고,
  // 그래서 이름을 못 얻고 "5개 매체가 동시에 다룬 사안"으로 남았다.
  const { leadPhrase } = await import("../src/feed/digest.js");
  assert.equal(leadPhrase("[속보] 코스피 장중 사이드카 발동"), "코스피 장중 사이드카 발동");
  assert.equal(leadPhrase("…시작하는 제목"), "시작하는 제목");
  assert.equal(leadPhrase("[포토] "), "", "말머리뿐이면 이름이 없다 — 지어내지 않는다");
});

test("브리핑 문단이 셀 수 없는 것을 세지 않는다 (2026-08-06 라이브 실측)", async () => {
  const { issueParagraph, issueShape, distinctOutlets } = await import("../src/feed/digest.js");
  // 라이브에서 나온 문장: "우리 피드에는 donga.com·동아일보 등 2곳에서 들어왔다."
  // 같은 신문사인데 한쪽은 도메인, 한쪽은 한글 사명이라 한 곳을 2곳으로 셌다.
  // 024 이전에는 수를 아예 쓰지 않는 것으로 막았다. 현재는 감사된 발행사 별칭만
  // 운영그룹으로 접고, 법적 독립성은 주장하지 않으며 대표 표시명 하나만 보여 준다.
  const items = [
    { id: "a", title: "여야, 부동산 세제 개편안 논의 착수", sourceLabel: "donga.com", coverage: 5, score: 0, commentCount: 0, tags: [] },
    { id: "b", title: "여야, 부동산 세제 개편안 논의 착수", sourceLabel: "동아일보", coverage: 5, score: 0, commentCount: 0, tags: [] },
    { id: "c", title: "부동산 세제 개편 두고 여야 공방", sourceLabel: "한겨레", coverage: 5, score: 0, commentCount: 0, tags: [] }
  ];
  const para = issueParagraph(items, issueShape(items));
  assert.doesNotMatch(para, /\d+곳/, "합칠 수 없는 매체 이름을 세고 있다");
  assert.doesNotMatch(para, /\d+개 매체/, "상한에 걸린 값을 수치처럼 쓰고 있다");
  assert.match(para, /동아일보·한겨레/, "운영그룹마다 읽기 좋은 대표 이름을 밝혀야 한다");
  assert.doesNotMatch(para, /donga/, "같은 발행사의 로마자 별칭을 별도 출처처럼 반복하면 안 된다");
  assert.ok(!distinctOutlets(items).some((o) => /\.(com|co\.kr|kr|net|org)$/i.test(o)),
    "도메인 꼬리가 그대로 노출된다");
});

test("브리핑 문단이 대표 글을 두 번 소개하지 않는다", async () => {
  const { issueParagraph, issueShape } = await import("../src/feed/digest.js");
  // 라이브: "…「與서울의원들, 오늘 부동산 세제 개편안 논의」 소식을… /
  //          같은 흐름에서 「與서울의원들, 오늘 부동산 세제 개편안 논의」도 상위에 올랐다."
  // 같은 사건을 여러 매체가 같은 제목으로 쓰면 이렇게 겹친다.
  const same = "與서울의원들, 오늘 부동산 세제 개편안 논의";
  const items = [
    { id: "a", title: same, sourceLabel: "동아일보", coverage: 5, score: 0, commentCount: 0, tags: [] },
    { id: "b", title: same, sourceLabel: "한겨레", coverage: 5, score: 0, commentCount: 0, tags: [] }
  ];
  const para = issueParagraph(items, issueShape(items));
  const hits = para.split(same).length - 1;
  assert.equal(hits, 1, `대표 글 제목이 ${hits}번 나온다`);
  assert.doesNotMatch(para, /같은 흐름에서\s*도/, "빈 목록으로 문장이 남았다");
});

test("브리핑 문단은 제목 끝글자와 무관하게 자연스러운 조사를 쓴다", async () => {
  const { issueParagraph } = await import("../src/feed/digest.js");
  const base = { id: "particle", sourceLabel: "게임메카", coverage: 0, tags: [] };
  const debate = issueParagraph([{ ...base, title: "신작 상시가챠", score: 0, commentCount: 120 }], "debate");
  const applause = issueParagraph([{ ...base, title: "시장 급등", score: 120, commentCount: 0 }], "applause");
  const single = issueParagraph([{ ...base, title: "업데이트 공개", score: 0, commentCount: 0 }], "single");

  assert.doesNotMatch(debate, /”을 두고/);
  assert.doesNotMatch(applause, /”이\s+게임메카에서/);
  assert.doesNotMatch(single, /”이 올라/);
  assert.match(debate, /게시물에 댓글 120건/);
  assert.match(applause, /게시물이 추천 120건/);
  assert.match(single, /제목이 올라 있다/);
});
