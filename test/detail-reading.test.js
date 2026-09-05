// 상세 화면을 읽을 것이 있는 쪽으로 (애드핏 P0-A ⑤, David 2026-08-06).
//
// 애드핏 4차 반려: "아웃링크만으로 구성되었거나 그 비중이 높은 콘텐츠만
// 게재되어 있는 경우" 제한. 상세 화면은 발췌 몇 줄 + "원문에서 계속 읽기"라
// 정확히 그 모양이었다 — 우리가 쓴 것이 하나도 없었다.
//
// **본문은 퍼오지 않는다.** 우리만 아는 것을 붙여 읽을 값어치를 만든다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";

const mk = (id, title, source, extra = {}) => ({
  id, title, url: `https://example.com/${id}`, source,
  publishedAt: new Date().toISOString(),
  tags: [], topics: [], summary: "발췌", category: "news", lang: "ko",
  score: 0, commentCount: 0, ...extra
});

async function engineWith(items) {
  const store = new FeedStore();
  const engine = new FeedEngine(store, [{ id: "s", kind: "community", async fetch() { return items; } }]);
  const user = store.createUser();
  return { engine, userId: user.id };
}

test("같은 사건을 다룬 다른 소스를 상세에 함께 준다", async () => {
  // 여러 곳을 동시에 봐야만 알 수 있는 것이다 — 원문 한 곳만 봐서는 알 수 없고,
  // 그게 이 페이지를 읽을 이유다.
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const { engine, userId } = await engineWith([
    mk("a", same, "hani", { score: 10 }),
    mk("b", same, "donga", { commentCount: 20 }),
    mk("c", "전혀 다른 사건입니다 오늘 날씨", "khan")
  ]);
  const one = await engine.getItem(userId, "a");
  assert.ok(Array.isArray(one.related), "related가 없다");
  // 같은 사건은 수집 때 하나로 접히므로 풀에는 "b"가 없다. 접힌 기록으로
  // 살아남아야 한다 — 접을 때 버렸다면 여기서 걸린다.
  assert.ok(one.related.some((r) => r.source === "donga"), "같은 사건 글을 못 찾았다");
  assert.ok(one.related.every((r) => r.title === same), "다른 사건이 섞였다");
  assert.ok(!one.related.some((r) => r.source === "hani"), "자기 자신이 들어갔다");
});

test("같은 소스가 목록을 독식하지 않는다", async () => {
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const { engine, userId } = await engineWith([
    mk("a", same, "hani"),
    mk("b1", same, "donga"), mk("b2", same, "donga"), mk("c1", same, "khan")
  ]);
  const one = await engine.getItem(userId, "a");
  const sources = one.related.map((r) => r.source);
  assert.equal(new Set(sources).size, sources.length, "한 소스가 여러 칸을 먹었다");
});

test("브리핑과 같은 사건 판정을 쓴다 — 두 벌로 두지 않는다", async () => {
  // 판정이 두 벌이면 언젠가 어긋난다. 브리핑의 중복 제거와 같은 eventKey다.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/engine.js", "utf8");
  assert.match(src, /import \{ eventKey \} from "\.\/dedupe\.js"/, "eventKey를 재사용하지 않는다");
  assert.match(src, /_relatedItems\(item, pool,[\s\S]{0,2500}eventKey\(item\.title\)/);
});

test("상세 화면이 우리가 만든 것을 그린다 — 재료가 없으면 줄을 뺀다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  const fn = html.slice(html.indexOf("function ourReadingHtml(item){"),
                        html.indexOf("async function renderDetail(itemId){"));
  assert.match(fn, /item\.editorialNote/, "편집 코멘트를 안 쓴다");
  assert.match(fn, /item\.related/, "같은 사건 목록을 안 쓴다");
  // 없는 것을 만들지 않는다 — 재료가 없으면 통째로 뺀다.
  assert.match(fn, /if\(!parts\.length\) return "";/, "빈 껍데기가 남는다");
  // 상세 본문에 실제로 꽂혀야 한다.
  assert.match(html, /\$\{ourReadingHtml\(item\)\}/, "상세에 안 붙었다");
  // 제목·출처는 이스케이프한다(남의 글 제목이 들어온다).
  assert.match(fn, /escapeHtml\(r\.title\)/);
  assert.match(fn, /escapeHtml\(r\.sourceLabel\)/);
});

test("접힌 중복은 버리지 않고 기록으로 남는다", async () => {
  // 여기서 버리면 어디서도 복원할 수 없다 — 접힌 글은 풀에 남지 않는다.
  const { collect } = await import("../src/feed/content.js");
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const src = (id, source) => ({
    id, kind: "news",
    async fetch() { return [mk(id, same, source, { sourceLabel: source })]; }
  });
  const { items } = await collect([src("s1", "hani"), src("s2", "donga")]);
  assert.equal(items.length, 1, "같은 사건이 접히지 않았다");
  assert.ok((items[0].related || []).some((r) => r.source === "donga"), "접힌 기록이 사라졌다");
});

test("관련글도 정치·종교 관문을 지난다 — 앞에서 막은 것이 뒤로 새지 않게", async () => {
  // 상세의 관련글은 그 글들로 가는 **새 진입점**이다. 피드·랭킹·브리핑이
  // 거는 관문을 여기만 안 걸면 앞에서 막은 것이 뒤로 샌다(검수 2026-08-06 P1).
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const { engine, userId } = await engineWith([
    mk("a", same, "hani"),
    mk("b", same, "donga", { topics: ["politics"] })
  ]);
  const one = await engine.getItem(userId, "a");
  assert.equal(one.related.length, 0, "정치 토픽이 관련글로 샜다");
});

test("관리자가 끈 소스는 관련글에도 안 나온다", async () => {
  const same = "국회 예산안 처리 무산, 여야 대치 계속";
  const store = new FeedStore();
  const items = [mk("a", same, "hani"), mk("b", same, "donga")];
  const engine = new FeedEngine(store, [{ id: "s", kind: "community", async fetch() { return items; } }]);
  const user = store.createUser();
  store.disabledSources = () => new Set(["donga"]);
  const one = await engine.getItem(user.id, "a");
  assert.equal(one.related.length, 0, "차단한 소스가 관련글로 샜다");
});

test("오래 저장된 Google 뉴스 자리표시자 이미지는 상세 응답에서도 제거한다", async () => {
  const { engine, userId } = await engineWith([
    mk("a", "18호 태풍 사우델 결국 중국으로", "kbs-news", {
      image: "https://lh3.googleusercontent.com/J6_placeholder=s0-w300"
    })
  ]);

  const one = await engine.getItem(userId, "a");
  assert.equal(one.image, null);
});

test("오늘판 상세는 출처 운영그룹으로 직접 URL을 우선하고 중계만 있으면 원문이라고 부르지 않는다", () => {
  const html = readFileSync("src/feed/public/today.html", "utf8");
  const links = html.slice(html.indexOf("function issueSourceLinks(issue){"), html.indexOf("function renderCategories(edition){"));
  const detail = html.slice(html.indexOf("function openIssueDetail(index,returnFocus=null){"), html.indexOf("$(\"detailClose\").onclick"));
  assert.match(links, /row\.sourceGroup\|\|row\.ownershipGroup/, "서버의 출처 정본 그룹을 사용하지 않는다");
  assert.match(links, /directGroups/, "직접 URL이 있어도 같은 언론사 중계를 남긴다");
  assert.match(detail, /Google 뉴스 중계 링크/, "중계 링크만 남은 상태를 사용자에게 구분하지 않는다");
  assert.match(detail, /const sourceInventory=/, "준비된 요약은 출처 종류를 다시 원문으로 뭉갠다");
  assert.match(detail, /readyText[\s\S]{0,120}\$\{sourceInventory\}/, "준비된 요약에서 원문·중계 구분을 버린다");
  const list = html.slice(html.indexOf("function renderIssues(edition){"), html.indexOf("function closeIssueDetail"));
  assert.doesNotMatch(list, /directSources\.map\([^\n]+target="_blank"/,
    "오늘판 목록의 원문은 같은 창에서 열려야 Back으로 보던 목록에 돌아온다");
  assert.doesNotMatch(detail, /copy\.watchNext\|\|issue\.watchNext/, "상세에 편집되지 않은 내부 후속 문구를 다시 노출한다");
});

test("오늘판 상세는 준비된 요약의 출처 정본에 과거 Google 중계를 다시 합치지 않는다", () => {
  const html = readFileSync("src/feed/public/today.html", "utf8");
  const sourceLinksFn = html.slice(html.indexOf("function issueSourceLinks(issue){"), html.indexOf("function renderCategories(edition){"));
  const issueSourceLinks = new Function("externalHref", "directSourceUrl", "publisherKey", `${sourceLinksFn}; return issueSourceLinks;`)(
    (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } },
    (value) => { try { const url = new URL(value); return url.hostname === "news.google.com" ? null : url.href; } catch { return null; } },
    (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s._-]+/g, "")
  );
  const links = issueSourceLinks({
    articleSummary: {
      status: "ready",
      sourceLinks: [{ sourceLabel: "KBS", sourceGroup: "kbs", url: "https://news.kbs.co.kr/news/view.do?ncd=1" }]
    },
    eventSources: [{ sourceLabel: "KBS 뉴스", url: "https://news.google.com/rss/articles/kbs-wrapper" }]
  });

  assert.deepEqual(links.map((row) => row.url), ["https://news.kbs.co.kr/news/view.do?ncd=1"]);
});

test("오늘판은 정확한 날짜 판본을 고르고 상세에 원문 피드 표기시각을 표시한다", () => {
  const html = readFileSync("src/feed/public/today.html", "utf8");
  const links = html.slice(html.indexOf("function issueSourceLinks(issue){"), html.indexOf("function renderCategories(edition){"));
  const list = html.slice(html.indexOf("function renderIssues(edition){"), html.indexOf("function closeIssueDetail"));
  const detail = html.slice(html.indexOf("function openIssueDetail(index,returnFocus=null){"), html.indexOf("$(\"detailClose\").onclick"));

  assert.match(html, /<input[^>]+id="editionDate"[^>]+type="date"/, "날짜 선택기가 없다");
  assert.match(html, /\$\("editionDate"\)\.onchange=/, "날짜 변경이 판본 조회에 연결되지 않았다");
  assert.match(html, /loadEdition\(false,event\.currentTarget\.value\)/, "선택 날짜를 API에 전달하지 않는다");
  assert.match(html, /new URLSearchParams\(location\.search\)/, "직접 연 오늘판 URL의 날짜와 슬롯을 읽지 않는다");
  assert.match(html, /state\.slot=initialSlot/, "직접 연 오늘판 URL의 슬롯을 초기 요청에 쓰지 않는다");
  assert.match(html, /state\.editionDate=initialDate/, "직접 연 오늘판 URL의 날짜를 초기 요청에 쓰지 않는다");
  assert.match(links, /publishedAt:row\.publishedAt\|\|sourceEvent\?\.publishedAt\|\|null/, "출처 발행시각을 상세까지 보존하지 않는다");
  assert.match(list, /issue\.firstPublishedAt/, "목록에 고정된 최초 발행시각을 쓰지 않는다");
  assert.match(list, /<time[^>]+datetime=/, "목록의 최초 발행시각이 time 요소가 아니다");
  assert.match(html, /function formatListKst[\s\S]{0,220}year:"numeric"/, "목록 발행시각에 연도가 없어 과거 기사를 오늘 기사처럼 보이게 한다");
  assert.match(html, /function formatKst[\s\S]{0,220}year:"numeric"/, "상세 발행시각에 연도가 없어 목록과 같은 사건의 날짜가 다르게 보인다");
  assert.match(detail, /firstPublishedAt/, "최초 발행시각을 계산하지 않는다");
  assert.match(detail, /issue\.firstPublishedAt/, "상세가 사건에 고정된 최초 발행시각을 우선하지 않는다");
  assert.match(detail, /원문 표기 시각/, "검증된 최초 발행처럼 과장하지 않고 원문 피드 표기시각을 표시하지 않는다");
  assert.doesNotMatch(detail, /<b>최초 발행<\/b>/, "피드 시각을 최초 발행으로 오인하게 만든다");
  assert.doesNotMatch(detail, /공개 원문 본문을 그대로 발췌했습니다/, "원문 전체를 복제한 것처럼 오해되는 문구가 남았다");
});

function renderTodayDetail(issue, navigator = { userAgent: "Chrome Desktop" }) {
  const html = readFileSync("src/feed/public/today.html", "utf8");
  const script = html.slice(html.indexOf("const state="), html.indexOf('document.addEventListener("keydown"'));
  const elements = new Map();
  const location = { href: "https://nowhot.test/", origin: "https://nowhot.test", pathname: "/", search: "" };
  const history = { state: null, replaceState(value) { this.state = value; }, pushState(value) { this.state = value; } };
  const saved = new Map();
  const sessionStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const window = { scrollY: 0 };
  new Function("window", "history", "location", "sessionStorage",
    readFileSync("src/feed/public/navigation-history.js", "utf8"))(window, history, location, sessionStorage);
  const document = { body: { style: {} }, activeElement: null, getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: "", textContent: "", attributes: {}, classList: Object.assign(new Set(), { contains(value) { return this.has(value); } }),
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelectorAll() { return []; },
      querySelector() { return document.getElementById("detailPanel"); },
      focus() { document.activeElement = this; }
    });
    return elements.get(id);
  } };
  const links = new Function("document", "navigator", "fetch", "issue", "NowHotHistory", "window", "addEventListener", `${script}
    state.edition={editionId:"SCE-test",issues:[{evidenceHash:"issue-test",...issue}],availableCategories:[]};
    renderIssues(state.edition);
    openIssueDetail(0);
    return issueSourceLinks(issue);
  `)(document, navigator, () => assert.fail("상세에서 새 fetch를 호출했다"), issue, window.NowHotHistory, window, () => {});
  assert.equal(document.activeElement, elements.get("detailClose"));
  return { html: elements.get("detailContent").innerHTML, list: elements.get("issues").innerHTML, links };
}

test("NH108 Today 번역은 모바일 네이버 앱과 PC 정본 링크 한 개이며 준비된 내용은 불변이다", () => {
  const source = { evidenceId: "article:1", sourceGroup: "publisher", sourceLabel: "외신", url: "https://publisher.example/article?q=한글&part=2#text" };
  const issue = {
    headline: "검수된 한국어 제목", reader: { headline: "독자용 한국어 제목" },
    articleSummary: { status: "ready", textKo: "이미 준비된 한국어 요약입니다.", sourceEvidenceId: source.evidenceId,
      sourceLinks: [source], image: "https://publisher.example/photo.jpg", summarySourceCount: 1 },
    eventSources: [{ ...source, originalTitle: "Original foreign headline", originalLang: "ko" }]
  };
  const before = JSON.stringify(issue);
  const plain = renderTodayDetail({ ...issue, eventSources: [] });
  const desktop = renderTodayDetail(issue);
  const mobile = renderTodayDetail(issue, { userAgent: "iPhone" });
  for (const result of [desktop, mobile]) {
    assert.equal((result.html.match(/id="detailTranslate"/g) || []).length, 1);
    assert.match(result.html, /aria-describedby="detailTranslationHint"/);
    assert.match(result.html, /id="detailTranslationHint"/);
    assert.match(result.html, /Original foreign headline/);
    assert.equal(result.html.match(/<h2[^>]*>.*?<\/h2>/)[0], plain.html.match(/<h2[^>]*>.*?<\/h2>/)[0]);
    assert.equal(result.html.match(/<img[^>]*>/)[0], plain.html.match(/<img[^>]*>/)[0]);
    assert.match(result.html, /<p>이미 준비된 한국어 요약입니다\.<\/p>/);
    assert.equal(result.list, plain.list);
    assert.deepEqual(result.links, plain.links);
  }
  assert.match(desktop.html, /id="detailTranslate"[^>]*href="https:\/\/publisher.example\/article\?q=%ED%95%9C%EA%B8%80&amp;part=2#text"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(desktop.html, /id="detailTranslate"[^>]*target=/);
  assert.match(desktop.html, /브라우저의 번역 기능/);
  assert.ok(mobile.html.includes(`naversearchapp://inappbrowser?url=${encodeURIComponent(new URL(source.url).href)}&amp;target=new&amp;version=6`));
  assert.match(mobile.html, /앱이 열리지 않으면 아래 원문 링크/);
  assert.doesNotMatch(desktop.html, /naversearchapp:|translate\.goog|transToggle/);
  assert.equal(JSON.stringify(issue), before);
});

test("NH108 원문 제목은 정확한 기사에만 연결하고 실제 글자와 명시된 원어로 판별한다", () => {
  const source = { evidenceId: "article:1", sourceGroup: "same-publisher", sourceLabel: "Reuters", url: "https://publisher.example/one" };
  const cases = [
    [{ ...source, originalTitle: "English title", originalLang: "ko" }, true],
    [{ ...source, originalTitle: "日本語の見出し" }, true],
    [{ ...source, originalTitle: "AI 관련 한국어 제목", originalLang: "en" }, false],
    [{ ...source, originalTitle: "123 !?" }, false],
    [{ ...source, originalLang: "en" }, true],
    [{ ...source, originalLang: "unknown" }, false],
    [{ ...source }, false],
    [{ ...source, evidenceId: "different-id", originalTitle: "Exact URL title" }, true],
    [{ ...source, url: "https://publisher.example/before-redirect", originalTitle: "Same evidence title" }, true],
    [{ ...source, evidenceId: "other", url: "https://publisher.example/other", originalTitle: "Wrong article" }, false],
    [{ ...source, evidenceRole: "related_observation", originalTitle: "Related article" }, false]
  ];
  for (const [event, expected] of cases) {
    const issue = { headline: "한국어 제목", articleSummary: { status: "ready", sourceLinks: [source] }, eventSources: [event] };
    assert.equal(renderTodayDetail(issue).html.includes('id="detailTranslate"'), expected, JSON.stringify(event));
  }
  const ambiguous = { headline: "한국어 제목", articleSummary: { status: "ready", sourceLinks: [source] },
    eventSources: [{ ...source, originalTitle: "First" }, { ...source, originalTitle: "Second" }] };
  assert.doesNotMatch(renderTodayDetail(ambiguous).html, /id="detailTranslate"/);
});

test("NH108 준비된 출처의 기준 외신을 번역하며 과거 중계와 다른 출처를 합치지 않는다", () => {
  const first = { evidenceId: "first", sourceGroup: "first", sourceLabel: "첫 외신", url: "https://first.example/article", originalTitle: "First title" };
  const anchor = { evidenceId: "anchor", sourceGroup: "anchor", sourceLabel: "기준 외신", url: "https://anchor.example/article", originalTitle: "Anchor title" };
  const issue = { headline: "한국어 제목", articleSummary: { status: "source_unavailable", unavailableReasonCode: "AUTH_REQUIRED",
    sourceEvidenceId: "anchor", sourceLinks: [first, anchor] },
    eventSources: [{ sourceGroup: "first", sourceLabel: "옛 중계", url: "https://news.google.com/rss/articles/old", originalTitle: "Old title" }] };
  const result = renderTodayDetail(issue);
  assert.match(result.html, /id="detailTranslate"[^>]*href="https:\/\/anchor.example\/article"/);
  assert.deepEqual(result.links.map(({ url }) => url), [first.url, anchor.url]);
  assert.doesNotMatch(result.html, /news\.google\.com|Old title/);
  issue.articleSummary.sourceEvidenceId = "absent";
  assert.match(renderTodayDetail(issue).html, /id="detailTranslate"[^>]*href="https:\/\/first.example\/article"/);
  issue.articleSummary.sourceLinks = [];
  assert.doesNotMatch(renderTodayDetail(issue).html, /id="detailTranslate"|news\.google\.com/);
});

test("NH108 번역 링크는 위험 주소를 배제하고 원문 제목과 매체명을 이스케이프한다", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "invalid", "https://user:pass@publisher.example/article",
    "https://news.google.com/rss/articles/relay", "https://sub.news.google.com/rss/articles/relay"]) {
    const source = { evidenceId: "x", sourceGroup: "x", url, originalTitle: "English title" };
    const issue = { headline: "한국어 제목", articleSummary: { status: "ready", sourceLinks: [source] } };
    assert.doesNotMatch(renderTodayDetail(issue, { userAgent: "Android" }).html, /id="detailTranslate"/, url);
  }
  const source = { evidenceId: "x", sourceGroup: "x", url: "https://publisher.example/article", sourceLabel: '<img src=x onerror="alert(1)">',
    originalTitle: 'Foreign <script>alert("title")</script>' };
  const result = renderTodayDetail({ headline: "한국어 제목", articleSummary: { status: "ready", sourceLinks: [source] } });
  assert.match(result.html, /id="detailTranslate"/);
  assert.match(result.html, /Foreign &lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/);
  assert.match(result.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(result.html, /<script>|<img src=x/);
});

test("NH108 저장된 실패 사유를 보존하고 알 수 없는 사유를 추정하지 않는다", () => {
  const messages = {
    NO_SUBSTANTIAL_PUBLIC_BODY: "이 판에 표시할 충분한 한국어 요약·발췌를 확보하지 못했습니다.",
    ARTICLE_SUMMARY_RATE_LIMIT: "요약 요청이 제한되어 요약을 확보하지 못했습니다.",
    ARTICLE_SUMMARY_DISABLED: "기사 장문 요약 기능이 현재 꺼져 있습니다.",
    PUBLISHER_URL_UNAVAILABLE: "Google 뉴스 중계 주소만 확인되어 실제 언론사 본문을 읽지 못했습니다.",
    AUTH_REQUIRED: "원문 접근에 인증이 필요합니다.",
    NEW_UNKNOWN_REASON: "요약을 표시하지 못했습니다. 구체적인 사유는 확인되지 않았습니다.",
    toString: "요약을 표시하지 못했습니다. 구체적인 사유는 확인되지 않았습니다."
  };
  for (const [code, message] of Object.entries(messages)) {
    const result = renderTodayDetail({ headline: "한국어 제목", articleSummary: { status: "source_unavailable", unavailableReasonCode: code } });
    assert.ok(result.html.includes(message), code);
  }
  assert.match(renderTodayDetail({ headline: "한국어 제목", articleSummary: { status: "disabled", unavailableReasonCode: "ARTICLE_SUMMARY_DISABLED" } }).html, /기사 장문 요약 기능이 현재 꺼져 있습니다\./);
  assert.match(renderTodayDetail({ headline: "한국어 제목" }).html, /이 판의 기사 요약이 아직 준비되지 않았습니다\./);
});

test("NH108 피드 발췌는 공개 본문과 구분하고 저장된 짧은 발췌만 표시한다", () => {
  const excerpt = "출판사가 피드에 제공한 공개 발췌를 그대로 보존하는 확인용 한국어 문장입니다.";
  const source = { evidenceId: "x", sourceGroup: "x", sourceLabel: "매체", url: "https://publisher.example/article", summary: excerpt };
  const issue = { headline: "한국어 제목", articleSummary: { status: "excerpt_only", sourceLinks: [source],
    textKo: excerpt, sourceLabel: "매체", excerptBasis: "publisher_feed_excerpt" } };
  const ready = renderTodayDetail(issue);
  assert.match(ready.html, /피드에서 제공한 공개 발췌/);
  assert.ok(ready.html.includes(`<p>${excerpt}</p>`));
  assert.doesNotMatch(ready.html, /공개 원문에서 확인 가능한 핵심 구간/);
  const fallback = renderTodayDetail({ ...issue, articleSummary: { ...issue.articleSummary, status: "source_unavailable", unavailableReasonCode: "AUTH_REQUIRED" } });
  assert.ok(fallback.html.includes(`<p>${excerpt}</p>`));
  assert.match(fallback.html, /원문 접근에 인증이 필요합니다\./);
});

test("NH108 정본 출처만 있는 접근 차단 기사도 준비된 사진을 기존 우선순위와 필터로 표시한다", () => {
  const source = { evidenceId: "photo", sourceGroup: "publisher", url: "https://publisher.example/article", image: "https://publisher.example/feed.jpg" };
  const issue = { headline: "한국어 제목", articleSummary: { status: "source_unavailable", unavailableReasonCode: "ACCESS_DENIED", sourceLinks: [source] } };
  const photo = () => renderTodayDetail(issue).html.match(/<img class="detail-image" src="([^"]+)"/)?.[1];
  assert.equal(photo(), source.image);
  issue.eventSources = [{ ...source, image: "https://publisher.example/event.jpg" }];
  assert.equal(photo(), source.image);
  issue.articleSummary.image = "https://publisher.example/summary.jpg";
  assert.equal(photo(), issue.articleSummary.image);
  issue.articleSummary.image = null;
  source.image = "https://lh3.googleusercontent.com/placeholder=s0-w300";
  assert.equal(photo(), issue.eventSources[0].image);
  issue.eventSources = [];
  assert.equal(photo(), undefined);
});

test("홈 seed가 비면 3분이 아니라 곧 다시 시도한다", async () => {
  // buildHomeSeed는 안에서 다 삼키고 항상 객체를 돌려준다. 빈 것을 성공으로
  // 보면 "빈 화면을 3분 확정"하는 꼴이 된다 — 빈 화면을 없애려고 만든 기능이
  // 정확히 반대로 동작한다(검수 2026-08-06 P1).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /HOME_SEED_RETRY_MS/, "빈 결과용 재시도 간격이 없다");
  assert.match(src, /cached && cached\.seed[\s\S]{0,120}HOME_SEED_RETRY_MS/,
    "빈 결과와 실제 콘텐츠를 구분하지 않는다");
});

test("온보딩 취향 워밍업은 즉시 저장한다", async () => {
  // 잦은 기록이 아니라 1회성이고, 서버가 이미 성공 응답을 보낸 뒤라
  // 유실되면 사용자는 알 방법도 다시 시도할 방법도 없다(검수 2026-08-06 P2).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/store.js", "utf8");
  const fn = src.slice(src.indexOf("  applyHistory("), src.indexOf("  savePushSubscription("));
  assert.ok(fn.includes("this._persist();"), "applyHistory가 지연 저장으로 돌아갔다");
  assert.ok(!fn.includes("_persistSoon"), "applyHistory가 지연 저장이다");
});
