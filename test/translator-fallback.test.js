import test from "node:test";
import assert from "node:assert/strict";

import { anthropicTranslator, fallbackTranslator } from "../src/feed/translator.js";
import { TranslatingSource } from "../src/feed/translate.js";

test("해외 주요 언론 번역은 무료 번역 실패 때만 Haiku 폴백을 사용한다", async () => {
  let paidCalls = 0;
  const paid = anthropicTranslator({
    apiKey: "test-key",
    invoke: async ({ prompt }) => {
      paidCalls += 1;
      return { parsed: { translation: prompt === "markets rise" ? "시장이 상승했다" : "" } };
    }
  });
  const translate = fallbackTranslator(async (text) =>
    text === "free works" ? "무료 번역 성공" : text, paid);

  assert.equal(await translate("free works"), "무료 번역 성공");
  assert.equal(paidCalls, 0);
  assert.equal(await translate("markets rise"), "시장이 상승했다");
  assert.equal(paidCalls, 1);
  assert.equal(await translate("invalid output"), "invalid output",
    "한글이 없는 빈 응답은 원문으로 안전하게 돌아가야 한다");
});

test("대형 해외 피드는 수집 상한까지만 번역한다", async () => {
  const calls = [];
  const source = new TranslatingSource({
    id: "foreign-major",
    kind: "news",
    fetch: async () => Array.from({ length: 45 }, (_, index) => ({
      id: `item-${index}`,
      title: `World headline ${index}`,
      summary: "",
      lang: "en"
    }))
  }, async (text) => {
    calls.push(text);
    return `번역 ${text}`;
  }, "ko", 20);

  const rows = await source.fetch();
  assert.equal(rows.length, 20);
  assert.equal(calls.length, 20);
  assert.equal(rows.at(-1).id, "item-19");
});
