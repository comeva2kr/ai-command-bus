// P1-A: 출처 신원 계층(sourceTier·operatorGroup·aliasOf) + URL 정규화.
// 고정 평가 표본 5(블루프린트 v4): geeknews→해커뉴스 재유통이 "복수 출처 확인"으로
// 집계되던 결함이 같은 운영그룹 1회로 접히는 것을 증명한다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { operationalSourceIdentity, sameOperationalSourceGroup } from "../src/feed/editorial-source-identity.js";
import {
  canonicalizeUrl,
  decodeGoogleNewsUrl,
  isGoogleNewsRedirect,
  stripTrackingParams
} from "../src/feed/canonical-url.js";
import { normalizeItem } from "../src/feed/content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "src", "feed", "communities.json"), "utf8")
).communities;

// ── 스키마: sourceTier 전 소스 부여·유효값 ──────────────────────────────

test("스키마: 전 소스에 sourceTier가 있고 값이 유효하다", () => {
  const valid = new Set(["specialist", "aggregate", "community"]);
  for (const c of registry) {
    assert.ok(valid.has(c.sourceTier), `${c.id}: sourceTier=${c.sourceTier}`);
  }
});

test("스키마: 대표 소스의 tier가 실제 성격과 맞는다", () => {
  const byId = new Map(registry.map((c) => [c.id, c]));
  // 구글뉴스 토픽 피드는 전부 애그리게이터
  for (const c of registry.filter((c) => /^gnews(?:-|$)/.test(c.id))) {
    assert.equal(c.sourceTier, "aggregate", c.id);
  }
  // 전문 섹션 RSS
  assert.equal(byId.get("hankyung-realestate").sourceTier, "specialist");
  assert.equal(byId.get("mk-stock").sourceTier, "specialist");
  for (const id of ["etnews", "bloter", "mk-news", "hankyung", "chosunbiz", "mt", "heraldbiz", "etoday"]) {
    assert.equal(byId.get(id).sourceTier, "aggregate", `${id}: 혼합 전체 피드는 전문 섹션 기본값을 쓰지 않는다`);
  }
  for (const [id, operatorGroup] of [
    ["yna-society", "yonhap"],
    ["khan-society", "khan"],
    ["donga-national", "donga"]
  ]) {
    assert.equal(byId.get(id).sourceTier, "specialist", id);
    assert.equal(byId.get(id).category, "news", id);
    assert.equal(byId.get(id).categoryRouting, "declared_section", id);
    assert.equal(byId.get(id).operatorGroup, operatorGroup, id);
  }
  for (const [id, operatorGroup] of [
    ["yna-politics", "yonhap"],
    ["khan-politics", "khan"],
    ["donga-politics", "donga"]
  ]) {
    assert.equal(byId.get(id).sourceTier, "specialist", id);
    assert.equal(byId.get(id).category, "politics", id);
    assert.equal(byId.get(id).operatorGroup, operatorGroup, id);
  }
  for (const [id, operatorGroup] of [
    ["bbc-technology", "bbc"],
    ["techcrunch", "techcrunch"],
    ["the-verge", "voxmedia"]
  ]) {
    const source = byId.get(id);
    assert.equal(source.sourceTier, "specialist", id);
    assert.equal(source.category, "tech", id);
    assert.equal(source.categoryRouting, "declared_section", id);
    assert.equal(source.operatorGroup, operatorGroup, id);
    assert.equal(source.editorialAuthority, "global_major", id);
    assert.match(source.adapter.url, /^https:\/\//, id);
    assert.doesNotMatch(source.adapter.url, /news\.google\.com/, id);
  }
  assert.equal(byId.get("autodaily").sourceTier, "aggregate",
    "autodaily: 자동차 외 기사가 섞인 전체 피드는 자동차 확정 소스로 쓰지 않는다");
  assert.equal(byId.get("autodaily").operatorGroup, "autodaily");
  for (const [id, operatorGroup] of [
    ["carguy", "carguy"]
  ]) {
    assert.equal(byId.get(id).sourceTier, "specialist", id);
    assert.equal(byId.get(id).category, "auto", id);
    assert.equal(byId.get(id).operatorGroup, operatorGroup, id);
    assert.match(byId.get(id).adapter.url, /^https:\/\/[^/]+\/rss\/allArticle\.xml$/);
  }
  // 종합지·포털
  assert.equal(byId.get("yna").sourceTier, "aggregate");
  assert.equal(byId.get("techmeme").sourceTier, "aggregate");
  // 커뮤니티
  assert.equal(byId.get("theqoo").sourceTier, "community");
  assert.equal(byId.get("hackernews").sourceTier, "community");
});

test("스키마: aliasOf는 레지스트리 안의 실존 소스만 가리킨다", () => {
  const ids = new Set(registry.map((c) => c.id));
  for (const c of registry) {
    if (c.aliasOf != null) {
      assert.ok(ids.has(c.aliasOf), `${c.id} → aliasOf=${c.aliasOf} 미등록`);
      assert.notEqual(c.aliasOf, c.id);
    }
  }
});

test("스키마: 기존 필수 필드는 무변경(속성 추가만)", () => {
  for (const c of registry) {
    for (const key of ["id", "label", "country", "lang", "kind", "category", "adapter"]) {
      assert.ok(key in c, `${c.id}: ${key} 소실`);
    }
  }
});

// ── 고정 표본 5: geeknews→hackernews 중계가 같은 운영그룹 1회 ───────────

test("표본5: geeknews와 hackernews는 같은 운영그룹으로 접힌다(중계·독립 구분)", () => {
  const geek = operationalSourceIdentity({ source: "geeknews", sourceLabel: "긱뉴스" });
  const hn = operationalSourceIdentity({ source: "hackernews", sourceLabel: "Hacker News" });
  assert.equal(geek.ownershipGroup, "hackernews");
  assert.equal(hn.ownershipGroup, "hackernews");
  assert.ok(sameOperationalSourceGroup(
    { source: "geeknews", sourceLabel: "긱뉴스" },
    { source: "hackernews", sourceLabel: "Hacker News" }
  ));
  // 교차 확인 계수: 두 출처를 그룹으로 접으면 1이 된다 —
  // "복수 출처 확인"으로 집계되던 재유통 결함의 수리 증명.
  const groups = new Set([geek.ownershipGroup, hn.ownershipGroup]);
  assert.equal(groups.size, 1);
});

test("표본5 반례: 무관한 두 커뮤니티는 여전히 다른 그룹이다(오병합 0)", () => {
  assert.ok(!sameOperationalSourceGroup(
    { source: "geeknews", sourceLabel: "긱뉴스" },
    { source: "clien", sourceLabel: "클리앙" }
  ));
});

test("운영그룹 한 벌: json operatorGroup과 기존 별칭 폴백이 같은 답을 낸다", () => {
  const fromJson = operationalSourceIdentity({ source: "mk-stock", sourceLabel: "매경 증권" });
  const fromAlias = operationalSourceIdentity({ source: "gnews", sourceLabel: "매일경제" });
  assert.equal(fromJson.ownershipGroup, "maekyung");
  assert.equal(fromAlias.ownershipGroup, "maekyung");
});

// ── canonical-url 유닛 ─────────────────────────────────────────────────

// 스냅샷(.nowhot-local/feed-data.json 2026-08-13) 실례 — 2024년 이후 신식
// 불투명 포맷("AU_yqL…"): 추가 HTTP 요청 없이는 복원 불가 → null이어야 한다.
const OPAQUE_GNEWS_URL = "https://news.google.com/rss/articles/CBMiWkFVX3lxTE50OW9oakZ4NjVTQlBkVUtLUkdaTWk4d1l5WERvUEJzdTNIbldIdDN4OE1rOTdGT2pXb0NMazFVSXJpdklmYmJwUWtQN21IRlpUd1dQMXRFTEdlUdIBX0FVX3lxTE1fVlpnTW0zblNfSTNWU29XbW1ROUs5MGxDdERVRTIwZGZ6azI1aUFtaUY2VkVkWDA1VWplaGY3Z2htYnQ3ZVZicTZWUm5lWFFlMVVVZ0RqTkhlRklSUkw0?oc=5";

// 구식 포맷 픽스처: 아티클 ID가 protobuf(field 4 string)에 원문 URL을 내장한다.
// CBMi = 바이트 08 13 22 — 실제 구식 인코딩과 동일한 구조로 만든 픽스처.
function legacyGnewsUrl(target) {
  const url = Buffer.from(target, "utf8");
  const bytes = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, url.length]), url]);
  return `https://news.google.com/rss/articles/${bytes.toString("base64url")}?oc=5`;
}

test("canonical-url: 구식 구글뉴스 ID는 오프라인 디코딩된다", () => {
  const target = "https://www.hankyung.com/article/2026081312345";
  const wrapped = legacyGnewsUrl(target);
  assert.ok(isGoogleNewsRedirect(wrapped));
  assert.equal(decodeGoogleNewsUrl(wrapped), target);
  assert.equal(canonicalizeUrl(wrapped), target);
});

test("canonical-url: 신식 불투명 포맷(스냅샷 실례)은 추측 없이 null", () => {
  assert.ok(isGoogleNewsRedirect(OPAQUE_GNEWS_URL));
  assert.equal(decodeGoogleNewsUrl(OPAQUE_GNEWS_URL), null);
  assert.equal(canonicalizeUrl(OPAQUE_GNEWS_URL), null);
});

test("canonical-url: 트래킹 파라미터만 제거하고 내용 파라미터는 보존", () => {
  assert.equal(
    stripTrackingParams("https://example.com/a?utm_source=x&utm_medium=y&id=7&fbclid=abc&gclid=z"),
    "https://example.com/a?id=7"
  );
  // 트래킹이 아닌 파라미터는 건드리지 않는다
  assert.equal(
    stripTrackingParams("https://example.com/a?page=2&ref=nav"),
    "https://example.com/a?page=2&ref=nav"
  );
});

test("canonical-url: m./amp. 호스트와 스킴·호스트 대소문자·말미 슬래시 정규화", () => {
  assert.equal(canonicalizeUrl("HTTPS://M.Example.COM/News/1/"), "https://example.com/News/1");
  assert.equal(canonicalizeUrl("https://amp.example.com/x"), "https://example.com/x");
  assert.equal(canonicalizeUrl("https://example.com/"), "https://example.com/");
});

test("canonical-url: http(s)가 아니거나 깨진 입력은 null", () => {
  assert.equal(canonicalizeUrl(null), null);
  assert.equal(canonicalizeUrl(""), null);
  assert.equal(canonicalizeUrl("ftp://example.com/a"), null);
  assert.equal(canonicalizeUrl("not a url"), null);
});

// ── 수집 경로 연동: normalizeItem이 canonicalUrl을 채운다(원본 url 무변경) ──

test("normalizeItem: canonicalUrl은 해소 성공 시에만, url 원본은 보존", () => {
  const dirty = "https://m.example.com/story/9?utm_source=rss&id=1";
  const ok = normalizeItem({ title: "t", url: dirty, publishedAt: "2026-08-13" }, { id: "yna", kind: "news" });
  assert.equal(ok.url, dirty); // 원본 보존
  assert.equal(ok.canonicalUrl, "https://example.com/story/9?id=1");

  const opaque = normalizeItem({ title: "t2", url: OPAQUE_GNEWS_URL }, { id: "gnews", kind: "news" });
  assert.equal(opaque.url, OPAQUE_GNEWS_URL);
  assert.equal(opaque.canonicalUrl, null); // 해소 실패 — 추측 금지
});
