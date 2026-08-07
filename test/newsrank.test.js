import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRss, relatedCoverage } from "../src/feed/fetchers.js";
import { sourceHotScores } from "../src/feed/ingest.js";
import { buildEditorialNote } from "../src/feed/editorial.js";
import { loadRegistry } from "../src/feed/registry.js";
import { sourceLabel } from "../src/feed/taxonomy.js";

// 이 파일이 지키는 것 (David 2026-07-28: "뉴스는 어떤 기준으로 핫한 걸
// 아는 거야? 순위상승도 댓글도 없는 글이 많이 올라온다"):
//
// 뉴스에는 추천수·댓글수가 없어서 ingest.js는 "소스가 실어 준 순서"를
// 백분위로 바꿔 점수를 매긴다. 그 전제가 깨져 있었다 — 뉴스 소스 8개 중
// 7개가 구글뉴스 **키워드 검색** 피드였고, 검색 결과 순서에는 화제성이
// 전혀 담겨 있지 않아 "검색 1번째"가 "핫 1위"가 되고 있었다.
// 아래 테스트들은 (a) 소스가 다시 검색 피드로 돌아가지 못하게 막고,
// (b) 구글이 주는 실측 화제성 신호(관련기사 수)가 점수에 반영되는지 검증한다.

// 실제 구글뉴스 관련기사 목록은 각 <li>가 **news.google.com 링크**를 단다.
// 2026-08-07까지 이 픽스처는 https://x/1 같은 가짜 주소를 썼는데, 그 상태로도
// 통과했다 — 코드가 피드를 가리지 않고 아무 <li>나 셌기 때문이다.
// 실물 형태로 바꾼다. 픽스처가 실물과 다르면 그 차이만큼 못 잡는다.
const GNEWS_DESC = `&lt;ol&gt;&lt;li&gt;&lt;a href="https://news.google.com/articles/1"&gt;기사1&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="https://news.google.com/articles/2"&gt;기사2&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="https://news.google.com/articles/3"&gt;기사3&lt;/a&gt;&lt;/li&gt;&lt;/ol&gt;`;

test("relatedCoverage: 구글뉴스 description의 관련기사 <li> 개수를 센다", () => {
  assert.equal(relatedCoverage(GNEWS_DESC), 3);
  assert.equal(relatedCoverage("관련기사 없는 평범한 요약문"), 0);
  assert.equal(relatedCoverage(""), 0);
  assert.equal(relatedCoverage(null), 0);
  // 피드 주소로도 판정한다 — 구글뉴스 피드면 링크 형태와 무관하게 센다.
  assert.equal(relatedCoverage("<ol><li>a</li><li>b</li></ol>", "https://news.google.com/rss/topics/x"), 2);
});

// 2026-08-07 적대적 검수가 잡은 것. 이 함수의 주석은 처음부터 "구글뉴스 RSS는"
// 이라고 말하는데, 코드는 **모든 rss 소스의 description에 무조건** 돌고 있었다.
// 그래서 본문 요약에 HTML 목록을 싣는 피드는 그 <li>가 통째로 "다른 매체도 이
// 사건을 다뤘다"는 신호로 둔갑했다.
//
// 실측(test/fixtures/geeknews.xml): 50건 중 **43건이 coverage>0**, 9건은 >=3.
// 긱뉴스는 한 사이트의 글 목록이지 교차보도가 아니다.
//
// 이건 0보다 나쁘다. coverage는 뉴스에 사실상 유일한 화제성 신호라
// 랭킹·편집 코멘트·"같은 사건, 다른 곳에서는"이 전부 이 값을 읽는다.
// **없는 신호를 만들어 랭킹에 올리는 것은 신호가 없는 것보다 해롭다.**
test("relatedCoverage: 구글뉴스가 아닌 피드의 <li>는 교차보도가 아니다", () => {
  const blogList = "<p>정리</p><ul><li>첫째</li><li>둘째</li><li>셋째</li></ul>";
  assert.equal(relatedCoverage(blogList), 0, "평범한 본문 목록을 교차보도로 세면 안 된다");
  assert.equal(relatedCoverage(blogList, "https://news.hada.io/rss/news"), 0);
  assert.equal(relatedCoverage("&lt;li&gt;a&lt;/li&gt;&lt;li&gt;b&lt;/li&gt;", "https://example.org/feed"), 0);
});

test("relatedCoverage: 긱뉴스 실물 피드에서 가짜 신호가 사라졌다", async () => {
  // 회귀를 실물로 못 박는다 — 정규식만 보면 다음에 또 넓어질 수 있다.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const dir = path.dirname(url.fileURLToPath(import.meta.url));
  const xml = fs.readFileSync(path.join(dir, "fixtures", "geeknews.xml"), "utf8");
  const items = parseRss(xml, "https://news.hada.io/rss/news");
  assert.ok(items.length >= 40, `파싱 ${items.length}건`);
  const fake = items.filter((i) => (i.coverage || 0) > 0);
  assert.equal(fake.length, 0, `가짜 coverage ${fake.length}건 — 예전엔 43건이었다`);
});

test("parseRss: 관련기사 수를 coverage로 실어 보낸다 (다른 필드를 망가뜨리지 않고)", () => {
  const xml = `<rss><channel>
    <item><title>여러 매체가 쓴 사건 - 한겨레</title><link>https://n/1</link>
      <pubDate>Tue, 28 Jul 2026 09:00:00 GMT</pubDate>
      <description>${GNEWS_DESC}</description></item>
    <item><title>단독 기사 - 어딘가일보</title><link>https://n/2</link>
      <pubDate>Tue, 28 Jul 2026 09:00:00 GMT</pubDate>
      <description>관련기사 없음</description></item>
  </channel></rss>`;
  // 구글뉴스 피드임을 알려 준다 — coverage는 이제 그 피드에서만 센다.
  const items = parseRss(xml, "https://news.google.com/rss/topics/x");
  assert.equal(items.length, 2);
  assert.equal(items[0].coverage, 3);
  assert.equal(items[1].coverage, 0);
  assert.equal(items[0].title, "여러 매체가 쓴 사건 - 한겨레");
  assert.equal(items[0].url, "https://n/1");
});

test("sourceHotScores: 반응 지표가 없는 뉴스 그룹에서 coverage가 같은 순위대의 단독 기사를 이긴다", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const at = new Date(now - 3600 * 1000).toISOString(); // 나이를 똑같이 고정 — 감쇠 영향 제거
  const mk = (rank, coverage) => ({
    kind: "news", source: "gnews", title: `t${rank}`, score: 0, commentCount: 0,
    sourceRank: rank, coverage, publishedAt: at
  });
  // 순위는 solo가 더 높지만(3위 vs 4위) 여러 매체가 다루는 쪽이 이겨야 한다.
  const solo = mk(3, 0);
  const many = mk(4, 5);
  const filler = [mk(0, 0), mk(1, 0), mk(2, 0), mk(5, 0), mk(6, 0), mk(7, 0)];
  const scored = sourceHotScores([solo, many, ...filler], now);
  const scoreOf = (item) => scored.find((s) => s.item === item).hotScore;
  assert.ok(
    scoreOf(many) > scoreOf(solo),
    `coverage 5(순위 4위)가 coverage 0(순위 3위)을 이겨야 함: ${scoreOf(many)} vs ${scoreOf(solo)}`
  );

  // 단, 순위를 통째로 뒤집을 만큼 세면 안 된다 — 1위 단독 기사는 여전히
  // 한참 아래 순위의 다중보도 기사보다 위여야 한다.
  const top = mk(0, 0);
  const lateMany = mk(7, 5);
  const scored2 = sourceHotScores([top, lateMany, ...filler.slice(0, 4)], now);
  const s2 = (item) => scored2.find((s) => s.item === item).hotScore;
  assert.ok(s2(top) > s2(lateMany), "coverage 보너스가 순위 축을 뒤집으면 안 됨");
});

test("sourceHotScores: coverage가 전혀 없어도(전부 0) 예전처럼 순위대로 매겨진다", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const at = new Date(now - 3600 * 1000).toISOString();
  const items = [0, 1, 2, 3].map((r) => ({
    kind: "news", source: "rss-only", title: `t${r}`, score: 0, commentCount: 0,
    sourceRank: r, coverage: 0, publishedAt: at
  }));
  const scored = sourceHotScores(items, now);
  for (let i = 1; i < scored.length; i++) {
    assert.ok(scored[i - 1].hotScore > scored[i].hotScore, "순위가 높을수록 점수가 높아야");
  }
});

test("editorial: 다중보도 뉴스는 문구가 붙되 관련기사 '개수'는 절대 말하지 않는다", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const item = {
    kind: "news", source: "gnews", sourceLabel: "구글뉴스 주요뉴스",
    score: 0, commentCount: 0, coverage: 5, sourceRank: 4,
    publishedAt: new Date(now - 5 * 3600 * 1000).toISOString()
  };
  const note = buildEditorialNote(item, { now });
  assert.match(note, /여러 매체가 함께 다루는 뉴스/);
  // 핵심: 구글이 관련기사를 5건까지만 주므로 그 값은 상한에 걸린 값이다.
  // 그걸 "5개 매체"라고 쓰면 실측되지 않은 수치를 단정하는 셈이라 금지.
  assert.equal(note.match(/\d/), null, `다중보도 문구엔 숫자가 없어야: "${note}"`);

  // 관련기사가 적으면(단신 묶임 수준) 이 문구는 안 붙는다
  const few = buildEditorialNote({ ...item, coverage: 1 }, { now });
  assert.ok(!few.includes("여러 매체"), "coverage 1엔 다중보도 문구가 붙으면 안 됨");
});

// 회귀 방지 — 원래 결함을 그대로 잡아내는 테스트.
// 구글뉴스 **검색** 피드(rss/search?q=…)는 편집 랭킹이 아니라 최신순 검색
// 결과다(실측 2026-07-28: q=IT 100건 전부 관련기사 0건). 여기에 sourceRank
// 백분위를 씌우면 "검색 1번째"가 "핫 1위"가 된다. 섹션 피드(rss/topics/…)만
// 쓴다 — 그쪽은 상위 10건 평균 관련기사 5.0 / 하위 10건 0.0으로 순서와
// 화제성이 실제로 붙어 있음을 확인했다.
test("registry: 활성화된 구글뉴스 소스는 검색 피드가 아니라 편집 섹션 피드여야 한다", () => {
  const gnews = loadRegistry().filter(
    (c) => c.enabled && c.adapter && typeof c.adapter.url === "string" && c.adapter.url.includes("news.google.com")
  );
  assert.ok(gnews.length > 0, "활성 구글뉴스 소스가 하나는 있어야 이 테스트가 의미 있다");
  for (const c of gnews) {
    assert.ok(
      !c.adapter.url.includes("/rss/search"),
      `${c.id}: 구글뉴스 검색 피드는 화제성 랭킹이 없어 쓰면 안 된다 — ${c.adapter.url}`
    );
    assert.ok(
      c.adapter.url.includes("/rss/topics/"),
      `${c.id}: 편집 섹션 피드(/rss/topics/)여야 한다 — ${c.adapter.url}`
    );
  }
});

test("registry: 모든 소스의 category가 taxonomy에 실재하는 id여야 한다", async () => {
  // biz/ent/game 처럼 없는 id를 쓰면 normalizeItem이 조용히 "news"로 되돌려
  // 카테고리 필터가 먹지 않는다 — 실제로 gnews-biz/ent/game이 그 상태였다.
  const { isKnownCategory } = await import("../src/feed/taxonomy.js");
  for (const c of loadRegistry()) {
    if (!c.category) continue;
    assert.ok(isKnownCategory(c.category), `${c.id}: 알 수 없는 category "${c.category}"`);
  }
});

// --- 댓글 발견성 (David 2026-07-28: "컨텐츠별로 댓글 쓸 수 있는 기능") -------
// 기능 자체는 이미 있었다(store.addComment / POST /api/comment / 상세뷰 댓글창).
// 문제는 카드에서 안 보였다는 것: 예전엔 원문 댓글 수와 우리 댓글 수 중 큰 값
// 하나만(Math.max) 찍어서, 원문 댓글 500개짜리 글에 우리 댓글이 3개 달려도
// 화면엔 "💬 500" 그대로였다. 둘은 다른 것이므로 분리해서 보여준다.
function indexHtml() {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "feed", "public", "index.html");
  return fs.readFileSync(p, "utf8");
}

test("public/index.html: 원문 댓글수와 지금핫 댓글수를 하나로 합쳐 보여주지 않는다", () => {
  const html = indexHtml();
  assert.ok(
    !/Math\.max\(\s*item\.commentCount\s*\|\|\s*0\s*,\s*item\.comments/.test(html),
    "원문 댓글수와 우리 댓글수를 Math.max로 합치면 우리 댓글이 묻힌다"
  );
  assert.match(html, /function sourceCommentCount\(item\)\s*\{\s*return item\.commentCount\|\|0;\s*\}/);
  assert.match(html, /function ourCommentCount\(item\)\s*\{\s*return item\.comments\|\|0;\s*\}/);
});

test("public/index.html: 지금핫 댓글 배지(💭)는 0일 때 아예 렌더되지 않는다", () => {
  const html = indexHtml();
  const fn = html.slice(html.indexOf("function commentMetaHtml"), html.indexOf("function isAdItem"));
  assert.ok(fn.includes("💭"), "우리 댓글 배지가 있어야");
  assert.ok(fn.includes("💬"), "원문 댓글 배지가 있어야");
  // 0개일 때 빈 배지("💭 0")를 노출하면 "댓글 없음"을 강조하는 꼴이 된다
  assert.match(fn, /ours>0\s*\?/, "우리 댓글이 0보다 클 때만 배지를 만들어야");
  assert.ok(fn.includes(': ""'), "0이면 빈 문자열이어야");
  assert.match(html, /\.card-meta \.our-comments \{[^}]*var\(--accent\)/, "우리 댓글 배지는 색으로 구분되어야");
});

test("public/index.html: 우리 댓글 배지도 상세뷰(댓글창)를 여는 버튼이어야 한다", () => {
  const html = indexHtml();
  const fn = html.slice(html.indexOf("function commentMetaHtml"), html.indexOf("function isAdItem"));
  assert.match(fn, /class="open-detail our-comments"/, "💭 배지에도 open-detail이 붙어야 클릭으로 댓글창이 열린다");
});

// 라벨 드리프트 방지 — 소스 라벨이 communities.json(원본)과 taxonomy.js의
// SOURCE_CATALOG(사본) 두 곳에 있어서, 한쪽만 고치면 화면에 옛 이름이 남는다.
// 실제로 gnews-science를 '건강' 섹션으로 바꿨는데 화면엔 "구글뉴스 과학"이
// 그대로 떴다(2026-07-28). editorial.js의 labelFor가 taxonomy를 먼저 보기 때문.
test("taxonomy SOURCE_CATALOG의 라벨은 communities.json의 라벨과 일치해야 한다", async () => {
  const { SOURCE_CATALOG } = await import("../src/feed/taxonomy.js");
  const registry = new Map(loadRegistry().map((c) => [c.id, c]));
  const mismatched = [];
  for (const s of SOURCE_CATALOG) {
    const c = registry.get(s.id);
    if (!c) continue; // taxonomy에만 있는 과거 소스는 자유
    const canonical = c.labelKo || c.label;
    if (canonical && canonical !== s.label) mismatched.push(`${s.id}: taxonomy="${s.label}" vs registry="${canonical}"`);
  }
  assert.deepEqual(mismatched, [], "라벨이 어긋난 소스가 있다");
});

// 라벨 해석은 2단계다 — communities.json(registry)이 1순위, taxonomy가 2순위,
// 둘 다 없으면 영문 id가 그대로 화면에 뜬다(index.html의 srcLabel, editorial.js의
// labelFor 모두 같은 순서). taxonomy에만 없는 건 정상이므로, 검사해야 할 것은
// "두 곳 다 없어서 결국 id가 노출되는 소스가 있는가"다.
test("활성 소스는 어느 경로로든 한글/고유 라벨로 해석돼야 한다 (영문 id 노출 방지)", () => {
  const unresolved = loadRegistry()
    .filter((c) => c.enabled)
    .filter((c) => !(c.labelKo || c.label) && sourceLabel(c.id) === c.id)
    .map((c) => c.id);
  assert.deepEqual(unresolved, [], "registry에도 taxonomy에도 라벨이 없어 id가 노출될 소스");
});

// 커뮤/뉴스 구분 — 카드 배지와 (뉴스 전용인) coverage 신호가 모두 이 값에 달려
// 있다. 개별 아이템은 kind를 거의 안 들고 오므로 소스 등록 정보에서 내려와야
// 하는데, 예전엔 raw.kind만 봐서 커뮤니티 소스 17곳이 전부 "뉴스"로 찍혔다.
test("normalizeItem: 아이템에 kind가 없으면 소스의 kind를 물려받는다", async () => {
  const { normalizeItem } = await import("../src/feed/content.js");
  const commSource = { id: "clien", kind: "community" };
  const newsSource = { id: "gnews", kind: "news" };
  assert.equal(normalizeItem({ title: "t", url: "https://a/1" }, commSource).kind, "community");
  assert.equal(normalizeItem({ title: "t", url: "https://a/2" }, newsSource).kind, "news");
  // 아이템이 직접 들고 온 kind가 우선
  assert.equal(normalizeItem({ title: "t", url: "https://a/3", kind: "community" }, newsSource).kind, "community");
  // 소스 정보가 아예 없으면 기존대로 news
  assert.equal(normalizeItem({ title: "t", url: "https://a/4" }, null).kind, "news");
});

test("registry: kind=community로 등록된 소스의 글은 community로 수집돼야 한다", async () => {
  const { buildSources } = await import("../src/feed/registry.js");
  const registry = loadRegistry();
  const commIds = new Set(registry.filter((c) => c.enabled && c.kind === "community").map((c) => c.id));
  assert.ok(commIds.size > 0, "커뮤니티 소스가 하나는 있어야");
  const sources = buildSources(registry);
  for (const s of sources) {
    if (commIds.has(s.id)) assert.equal(s.kind, "community", `${s.id}: 소스 객체의 kind가 community여야`);
  }
});

// 2026-08-07 적대적 검수: "rss 소스는 반응 지표가 없다"는 일괄 판정이 틀렸다.
// 딴지일보 RSS는 Slash 모듈의 <slash:comments>로 댓글 수를 실어 보내는데
// parseRss가 그 태그를 읽지 않아 신호를 버리고 있었다.
// 실측: 15건 중 14건에 값이 있다(3·4·4·4·1·3·8·3·2·5·1·3·10·2).
//
// 뉴스에는 반응이 없다고 전제해 왔고 그 전제 위에 랭킹을 세웠다.
// 그런데 예외가 있었고, 그 예외를 우리 손으로 버리고 있었다.
test("parseRss: Slash 모듈의 댓글 수(<slash:comments>)를 읽는다", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const xml = fs.readFileSync(path.join(dir, "fixtures", "ddanzi_news.xml"), "utf8");
  const items = parseRss(xml, "https://www.ddanzi.com/rss");
  const withC = items.filter((i) => (i.commentCount || 0) > 0);
  assert.ok(withC.length >= 12, `댓글이 붙은 글 ${withC.length}건 (>=12 기대, 예전엔 0건)`);
  // 값이 실제 피드와 일치하는지 — 아무 숫자나 주워 온 것이 아니어야 한다
  assert.ok(withC.every((i) => Number.isInteger(i.commentCount) && i.commentCount > 0));
});

test("parseRss: slash:comments가 없는 피드는 commentCount를 만들지 않는다", () => {
  // 0을 채워 넣으면 "댓글 0개"와 "댓글 정보 없음"이 구별되지 않는다.
  const xml = `<rss><channel><item>
    <title>댓글 태그 없는 글</title><link>https://example.org/1</link>
    <pubDate>Tue, 28 Jul 2026 09:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const items = parseRss(xml, "https://example.org/rss");
  assert.equal(items.length, 1);
  assert.equal(items[0].commentCount, undefined);
});
