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

test("오늘판은 정확한 날짜 판본을 고르고 상세에 최초 발행시각을 표시한다", () => {
  const html = readFileSync("src/feed/public/today.html", "utf8");
  const links = html.slice(html.indexOf("function issueSourceLinks(issue){"), html.indexOf("function renderCategories(edition){"));
  const detail = html.slice(html.indexOf("function openIssueDetail(index,returnFocus=null){"), html.indexOf("$(\"detailClose\").onclick"));

  assert.match(html, /<input[^>]+id="editionDate"[^>]+type="date"/, "날짜 선택기가 없다");
  assert.match(html, /\$\("editionDate"\)\.onchange=/, "날짜 변경이 판본 조회에 연결되지 않았다");
  assert.match(html, /loadEdition\(false,event\.currentTarget\.value\)/, "선택 날짜를 API에 전달하지 않는다");
  assert.match(links, /publishedAt:row\.publishedAt\|\|sourceEvent\?\.publishedAt\|\|null/, "출처 발행시각을 상세까지 보존하지 않는다");
  assert.match(detail, /firstPublishedAt/, "최초 발행시각을 계산하지 않는다");
  assert.match(detail, /최초 발행/, "최초 발행시각을 사용자에게 표시하지 않는다");
  assert.doesNotMatch(detail, /공개 원문 본문을 그대로 발췌했습니다/, "원문 전체를 복제한 것처럼 오해되는 문구가 남았다");
});

test("홈 seed가 비면 3분이 아니라 곧 다시 시도한다", async () => {
  // buildHomeSeed는 안에서 다 삼키고 항상 객체를 돌려준다. 빈 것을 성공으로
  // 보면 "빈 화면을 3분 확정"하는 꼴이 된다 — 빈 화면을 없애려고 만든 기능이
  // 정확히 반대로 동작한다(검수 2026-08-06 P1).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /HOME_SEED_RETRY_MS/, "빈 결과용 재시도 간격이 없다");
  assert.match(src, /cached && \(cached\.seed \|\| cached\.ownSeed\)[\s\S]{0,120}HOME_SEED_RETRY_MS/,
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
