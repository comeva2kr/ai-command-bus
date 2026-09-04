// tools/build-editions.mjs — 신문형 판 2벌(v1 기존 편성·v2 새 선별) 생성기.
//
// 검증 대상:
//  - 오늘판(/api/today) 스키마 자가 검증기(validateTodayEdition)
//  - 수집 풀 → 인프로세스 소스 변환(캡 회피 청크·kind 보존)
//  - v1 생성 경로: 기존 편성 파이프라인을 리슨 없이 디스패치해 200 + 스키마 통과
//  - v2 생성 경로: shadowSelectBriefing 선별 → 같은 편집 계층 → 200 + 스키마 통과
//  - v1/v2 diff 계산
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JsonSource } from "../src/feed/content.js";
import { FeedEngine } from "../src/feed/engine.js";
import { FeedStore } from "../src/feed/store.js";
import { shadowSelectBriefing } from "../src/feed/shadow-selection.js";
import {
  validateTodayEdition,
  groupArticlesAsSources,
  collectShadowArticles,
  editionIssueDiff,
  buildTodayEditionInProcess
} from "../tools/build-editions.mjs";

const NOW_MS = Date.parse("2026-08-11T12:05:00+09:00");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-build-editions-"));
}

// 검증된 제공 가능 픽스처(editorial-serving.test.js와 같은 결)의 원자료.
const V1_SUBJECTS = [
  "호르무즈 해협 통항 협상 재개",
  "산업단지 공장 투자 착공 일정",
  "S&P 500 목표치 상향 발표",
  "보유세 과세 기준 개편 발표",
  "기준금리 전망 수정",
  "원달러 환율 변동 확대",
  "반도체 수출 증가 발표",
  "고용 지표 개선 확인",
  "국제유가 공급 전망 변경",
  "채권시장 수급 대책 발표",
  "소비자물가 상승률 둔화",
  "자동차 생산 투자 확대",
  "온라인 유통 실적 발표",
  "기업 인수합병 심사 착수",
  "무역수지 흑자 폭 확대",
  "전기요금 연료비 조정안 공개",
  "중소기업 정책금융 확대",
  "항만 물동량 월간 통계 발표",
  "고용보험 가입자 통계 공개",
  "기업 설비투자 계획 확정",
  "조선업 수주 잔고 분기 집계",
  "배터리 원재료 장기 공급 계약",
  "항공화물 운임 지수 발표",
  "농산물 도매가격 안정 대책",
  "벤처투자 신규 결성액 통계",
  "통신사 망 투자 로드맵 공개",
  "철강 생산설비 정비 일정",
  "바이오 의약품 수출 허가 획득",
  "가계대출 관리 방안 확정",
  "해운사 친환경 선박 발주"
];

async function normalizedV1Articles() {
  const articles = [];
  for (const [index, subject] of V1_SUBJECTS.entries()) {
    const source = new JsonSource(`editions-src-${index}`, async () => [{
      id: `editions-item-${index}`,
      title: `${subject}: 공식 자료 공개`,
      url: `https://editions-${index}.example.com/article`,
      category: "business",
      sourceLabel: `검증 매체 ${index + 1}`,
      score: 120 - index,
      commentCount: 24 - index,
      coverage: 1,
      publishedAt: "2026-08-11T06:40:00+09:00"
    }], "news");
    articles.push(...await source.fetch());
  }
  return articles;
}

// 새 선별(shadow) 게이트를 지나는 원자료 — 사건당 독립 소유 그룹 2곳(같은 제목).
async function normalizedV2Articles() {
  const articles = [];
  for (const [index, subject] of V1_SUBJECTS.entries()) {
    for (const side of ["a", "b"]) {
      const sourceId = `editions-v2-${index}${side}`;
      const source = new JsonSource(sourceId, async () => [{
        id: `editions-v2-item-${index}${side}`,
        title: `${subject}: 공식 자료 공개`,
        url: `https://${side}.editions-v2-${index}.example.com/article`,
        category: "business",
        sourceLabel: `독립 매체 ${index + 1}${side}`,
        score: 90 - index,
        commentCount: 12,
        coverage: 1,
        publishedAt: "2026-08-11T11:00:00+09:00"
      }], "news");
      const [row] = await source.fetch();
      // 독립 보도 판정 근거 — 등록부 명시 소유 그룹(shadow-selection.test.js와 동일).
      row.ownershipGroup = `editions-grp-${index}${side}`;
      row.ownershipBasis = "registry_explicit";
      articles.push(row);
    }
  }
  return articles;
}

test("groupArticlesAsSources: 소스별 청크(기본 20)로 쪼개고 id·kind를 보존한다", () => {
  const articles = [
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `news-${index}`, source: "big-news", kind: "news", title: `n${index}`
    })),
    { id: "comm-0", source: "board", kind: "community", title: "c0" }
  ];
  const sources = groupArticlesAsSources(articles);
  const newsChunks = sources.filter((source) => source.id === "big-news");
  assert.equal(newsChunks.length, 3, "45건 = 20+20+5 세 청크");
  for (const chunk of newsChunks) assert.equal(chunk.kind, "news");
  const board = sources.find((source) => source.id === "board");
  assert.equal(board.kind, "community");
  return Promise.all(sources.map((source) => source.fetch())).then((lists) => {
    const total = lists.reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 46, "기사 유실 0");
  });
});

test("발행 전 동결 풀은 실시간 피드용 출처당 상한으로 다시 잘리지 않는다", async () => {
  const articles = Array.from({ length: 45 }, (_, index) => ({
    id: `frozen-news-${index}`,
    source: "big-news",
    sourceLabel: "대형 언론",
    kind: "news",
    category: "news",
    title: `발행 준비 기사 ${index}`,
    url: `https://big-news.example.com/${index}`,
    publishedAt: new Date(NOW_MS - index * 60_000).toISOString()
  }));
  const engine = new FeedEngine(
    new FeedStore({ clock: () => new Date(NOW_MS).toISOString() }),
    groupArticlesAsSources(articles)
  );
  engine.editorialPreselectedPool = true;

  await engine.refresh();

  assert.equal((await engine.sourceCounts())["big-news"], 45);
});

test("buildTodayEditionInProcess: 주입한 동결 풀도 발행 전 번역 경로를 지난다", async () => {
  const dir = tmpDir();
  const poolFile = path.join(dir, "translated-pool.json");
  const article = {
    id: "foreign-news-1",
    source: "bbc-world",
    kind: "news",
    lang: "en",
    title: "Global markets react to the policy decision",
    summary: "Investors assessed the official announcement and its likely effects.",
    url: "https://example.com/world/1",
    category: "news",
    publishedAt: "2026-08-11T10:30:00+09:00"
  };
  await buildTodayEditionInProcess({
    sources: groupArticlesAsSources([article]),
    nowMs: NOW_MS,
    storeFile: path.join(dir, "translated-store.json"),
    poolFile,
    query: "/api/today?categories=news&slot=lunch",
    translate: {
      targetLang: "ko",
      translateFn: async (text) => text === article.title
        ? "정책 결정에 반응한 세계 시장"
        : "투자자들은 공식 발표와 예상 영향을 살폈습니다."
    }
  });

  const saved = JSON.parse(fs.readFileSync(poolFile, "utf8"));
  const translated = saved.rows.map((row) => row.item).find((item) => item.id === article.id);
  assert.equal(translated.title, "정책 결정에 반응한 세계 시장");
  assert.equal(translated.translated, true);
  assert.equal(translated.originalTitle, article.title);
});

test("validateTodayEdition: 필수 필드 누락을 잡는다", () => {
  const issue = {
    headline: "제목", paragraph: "요약", whyImportant: "중요", whyHot: "지금",
    watchNext: "다음 확인",
    reader: {
      headline: "제목", summary: "요약", whyImportant: "중요", whyNow: "지금",
      change: "달라진 점", watchNext: "다음 확인", confidenceLabel: "확인"
    },
    categoryIds: ["business"],
    refs: [{ id: "r1", title: "원문", sourceLabel: "매체" }],
    evidence: { sources: [{ label: "매체" }] }
  };
  const edition = {
    editionDate: "2026-08-11",
    generatedAt: "2026-08-11T03:05:00.000Z",
    slot: { id: "lunch", label: "점심" },
    issues: [issue],
    selection: { mode: "preview", categories: [{ id: "business", label: "경제" }] },
    availableCategories: [{ id: "business", label: "경제" }],
    categoryFulfillment: { rows: [], metCount: 1, selectedCount: 1 },
    sourceCount: 4, overseasShare: 0, llmCalls: 0,
    serving: { state: "current_machine_verified" }
  };
  assert.equal(validateTodayEdition(edition).ok, true);

  const noDate = structuredClone(edition);
  delete noDate.editionDate;
  assert.equal(validateTodayEdition(noDate).ok, false);

  const emptyCopy = structuredClone(edition);
  emptyCopy.issues[0].reader.whyImportant = "";
  emptyCopy.issues[0].whyImportant = "";
  const copyCheck = validateTodayEdition(emptyCopy);
  assert.equal(copyCheck.ok, false);
  assert.ok(copyCheck.errors.some((error) => error.includes("whyImportant")));

  const noRefs = structuredClone(edition);
  noRefs.issues[0].refs = [];
  assert.equal(validateTodayEdition(noRefs).ok, false);
});

test("editionIssueDiff: refs 겹침으로 같은 이슈를 세고 나머지를 각자 몫으로 나눈다", () => {
  const issueWith = (ids) => ({ refs: ids.map((id) => ({ id, canonicalUrl: `https://x.example.com/${id}` })) });
  const a = { issues: [issueWith(["1"]), issueWith(["2"]), issueWith(["3"])] };
  const b = { issues: [issueWith(["2"]), issueWith(["9"])] };
  const diff = editionIssueDiff(a, b);
  assert.deepEqual(diff, { v1Issues: 3, v2Issues: 2, shared: 1, v1Only: 2, v2Only: 1 });
});

test("v1 생성 경로: 기존 편성 파이프라인을 리슨 없이 통과해 오늘판 스키마 200을 낸다", async () => {
  const dir = tmpDir();
  const articles = await normalizedV1Articles();
  const run = await buildTodayEditionInProcess({
    sources: groupArticlesAsSources(articles),
    nowMs: NOW_MS,
    storeFile: path.join(dir, "v1-store.json"),
    poolFile: path.join(dir, "v1-pool.json"),
    query: "/api/today?categories=business&slot=lunch"
  });
  assert.equal(run.status, 200, JSON.stringify(run.body && (run.body.error || run.body.code)));
  const check = validateTodayEdition(run.edition);
  assert.deepEqual(check.errors, [], "오늘판 스키마 통과");
  assert.equal(Number(run.edition.llmCalls), 0, "LLM 호출 0");
  assert.ok(run.edition.issues.length >= 1);
  assert.equal(run.edition.slot.id, "lunch");
});

test("판 생성기는 운영 고정판 환경에서도 기존 포인터 대신 주입 기사로 생성한다", async () => {
  const previous = process.env.NOWHOT_SLOT_CANONICAL_EDITION;
  process.env.NOWHOT_SLOT_CANONICAL_EDITION = "1";
  try {
    const dir = tmpDir();
    const run = await buildTodayEditionInProcess({
      sources: groupArticlesAsSources(await normalizedV1Articles()),
      nowMs: NOW_MS,
      storeFile: path.join(dir, "store.json"),
      poolFile: path.join(dir, "pool.json"),
      query: "/api/today?categories=business&slot=lunch"
    });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.ok(run.edition.issues.length > 0);
    assert.equal(run.edition.slotCanonicalEdition, undefined);
  } finally {
    if (previous === undefined) delete process.env.NOWHOT_SLOT_CANONICAL_EDITION;
    else process.env.NOWHOT_SLOT_CANONICAL_EDITION = previous;
  }
});

test("v2 생성 경로: shadow 선별 → 같은 편집 문장 계층 → 오늘판 스키마 200", async () => {
  const dir = tmpDir();
  const articles = await normalizedV2Articles();
  const out = shadowSelectBriefing(articles, {
    requestedCategories: ["business"],
    now: NOW_MS,
    slotId: "lunch",
    previousLineage: []
  });
  const selected = collectShadowArticles(out);
  assert.ok(selected.length >= 2, `shadow 선별이 기사를 골라야 한다 (실제 ${selected.length})`);
  const ids = new Set(selected.map((article) => article.id));
  assert.equal(ids.size, selected.length, "중복 기사 없음");

  const run = await buildTodayEditionInProcess({
    sources: groupArticlesAsSources(selected),
    nowMs: NOW_MS,
    storeFile: path.join(dir, "v2-store.json"),
    poolFile: path.join(dir, "v2-pool.json"),
    query: "/api/today?categories=business&slot=lunch"
  });
  assert.equal(run.status, 200, JSON.stringify(run.body && (run.body.error || run.body.code)));
  const check = validateTodayEdition(run.edition);
  assert.deepEqual(check.errors, [], "오늘판 스키마 통과");
  assert.equal(Number(run.edition.llmCalls), 0, "LLM 호출 0");
  assert.ok(run.edition.issues.length >= 1);
});

test("고정판 직접 생성은 실행 시각으로 동결 풀을 다시 자르지 않는다", async () => {
  const dir = tmpDir();
  const articles = await normalizedV1Articles();
  const run = await buildTodayEditionInProcess({
    sources: groupArticlesAsSources(articles),
    nowMs: NOW_MS + 7 * 24 * 3600 * 1000,
    storeFile: path.join(dir, "direct-store.json"),
    poolFile: path.join(dir, "direct-pool.json"),
    directBuild: true,
    categories: ["business"],
    slotId: "evening",
    editionDate: "2026-08-11",
    editorialPreselectedPool: true
  });
  assert.equal(run.status, 200);
  assert.equal(run.edition.editionDate, "2026-08-11");
  assert.equal(run.edition.slot.id, "evening");
  assert.ok(run.edition.issues.length >= 1);
  assert.equal(run.edition.serving.fallback, false);
});
