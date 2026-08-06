// 소스가 선언한 고정 태그가 실제로 아이템에 붙는가 (검수 2026-08-06 P1).
//
// 부동산·증권 소스 6곳에 defaultTags를 붙이고 "설문의 세부 관심사와 이어진다"고
// 커밋에 적었는데, 그 필드를 읽는 코드가 저장소에 하나도 없었다(grep 0건).
// 하루 최대 325건이 들어오는데 사용자가 고른 세부 관심사에 아무 기여도 못 했다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, JsonSource } from "../src/feed/content.js";
import { loadRegistry } from "../src/feed/registry.js";

test("소스의 defaultTags가 아이템 태그에 붙는다", () => {
  const src = new JsonSource("mk-realestate", async () => [], "news", ["realestate"]);
  const it = normalizeItem({ id: "a", title: "강남 아파트 전세가 상승",
    url: "https://x.com/a", publishedAt: new Date().toISOString() }, src);
  assert.ok(it.tags.includes("realestate"), `태그에 안 붙었다: ${JSON.stringify(it.tags)}`);
});

test("제목에서 뽑은 태그를 지우지 않는다", () => {
  const src = new JsonSource("s", async () => [], "news", ["realestate"]);
  const it = normalizeItem({ id: "a", title: "강남 아파트 전세가 상승",
    url: "https://x.com/a", publishedAt: new Date().toISOString() }, src);
  assert.ok(it.tags.length >= 2, `제목 태그가 사라졌다: ${JSON.stringify(it.tags)}`);
});

test("레지스트리가 선언한 태그가 설문의 세부 관심사 목록에 있는 말이어야 한다", async () => {
  // 없는 태그를 붙이면 아무 취향과도 안 이어진다 — 붙였다는 착각만 남는다.
  const { TAGS } = await import("../src/feed/taxonomy.js");
  const known = new Set(TAGS);
  for (const c of loadRegistry()) {
    for (const t of c.defaultTags || []) {
      assert.ok(known.has(t), `${c.id}의 defaultTags "${t}"가 taxonomy에 없다`);
    }
  }
});

test("한 매체의 여러 섹션 피드는 한 몫으로 묶인다", () => {
  // feedGroup이 없으면 매경 하나가 일반+부동산+증권 3개 키를 가져
  // 다양성 상한을 3배로 우회한다(검수 2026-08-06 P1).
  const reg = loadRegistry();
  const groups = { mk: ["mk-news", "mk-realestate", "mk-stock"],
                   hankyung: ["hankyung", "hankyung-realestate", "hankyung-stock"],
                   chosunbiz: ["chosunbiz", "chosunbiz-realestate", "chosunbiz-stock"] };
  for (const [g, ids] of Object.entries(groups)) {
    for (const id of ids) {
      const c = reg.find((x) => x.id === id);
      if (!c) continue;
      assert.equal(c.feedGroup, g, `${id}의 feedGroup이 ${c.feedGroup}`);
    }
  }
});
