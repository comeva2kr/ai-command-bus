import test from "node:test";
import assert from "node:assert/strict";
import { googleFreeTranslator } from "../src/feed/translator.js";
import { TranslatingSource, memoizedTranslator } from "../src/feed/translate.js";

// 2026-08-06 진단: 화면에 "KO 제목을 기계번역했어요" / "KO 원문"이 떴다.
//
// originalLang이 **번역기가 판별한 언어가 아니라 레지스트리에 적힌 소스 선언**을
// 그대로 되돌려주고 있었다(조선비즈는 lang:"ko"). 조선비즈는 한국 매체지만
// 일본어판 기사를 섞어 보낸다(실측 100건 중 5건) — 그 기사의 원문 언어가
// "일본어"가 아니라 "KO"로 표시됐다. index.html의 langKo 맵에 "ko" 키가 없어
// toUpperCase 폴백으로 떨어진 것이다.
//
// 더 답답한 것: Google 응답의 data[2]에 실제 감지 언어가 **이미 도착해 있었고**
// translator.js 주석이 그것을 문서화까지 해 놓고 값을 버렸다.

function fakeFetch(detected, translated) {
  return async () => ({
    ok: true,
    json: async () => [[[translated, "src", null, null, 1]], null, detected]
  });
}

test("번역기가 감지한 원문 언어를 opts로 돌려준다", async () => {
  const t = googleFreeTranslator({ fetchImpl: fakeFetch("ja", "대한축구협회") });
  const opts = { from: "auto", to: "ko" };
  const out = await t("大韓サッカー協会", opts);
  assert.equal(out, "대한축구협회");
  assert.equal(opts.detectedLang, "ja");
});

test("반환 계약은 그대로 문자열이다 — 호출부를 깨지 않는다", async () => {
  // engine.js의 _translateFilledSummaries도 이 함수를 쓴다. 객체를 반환하게
  // 바꿨다면 거기서 조용히 깨졌을 것이다.
  const t = googleFreeTranslator({ fetchImpl: fakeFetch("en", "번역됨") });
  const out = await t("original", { from: "auto", to: "ko" });
  assert.equal(typeof out, "string");
});

test("감지 언어가 없거나 이상하면 opts를 건드리지 않는다", async () => {
  const weird = async () => ({ ok: true, json: async () => [[["번역", "s", null, null, 1]], null, null] });
  const t = googleFreeTranslator({ fetchImpl: weird });
  const opts = { from: "auto", to: "ko" };
  await t("x", opts);
  assert.equal(opts.detectedLang, undefined);
});

test("무료 번역이 영문 고유명사를 일반 단어로 오역하지 않는다", async () => {
  const fetchImpl = async (url) => {
    const source = new URL(url).searchParams.get("q");
    const translated = source
      .replace("Judge says ", "판사는 ")
      .replace("Trump", "트럼프")
      .replace(" administration’s blacklist of ", " 행정부의 블랙리스트인 ")
      .replace("Anthropic", "인류학")
      .replace(" was illegal", "이 불법이었다고 판결했다")
      .replace("Fleetwood", "플릿우드")
      .replace(" in contention as ", "가 경쟁 중인 가운데 ")
      .replace("Lee", "이승엽")
      .replace(" leads Tour Championship", "가 투어 챔피언십 선두다");
    return { ok: true, json: async () => [[[translated, source, null, null, 1]], null, "en"] };
  };
  const translate = googleFreeTranslator({ fetchImpl });

  const legal = await translate("Judge says Trump administration’s blacklist of Anthropic was illegal");
  assert.match(legal, /Anthropic/);
  assert.doesNotMatch(legal, /인류학|인류애/);

  const golf = await translate("Fleetwood in contention as Lee leads Tour Championship");
  assert.match(golf, /Lee/);
  assert.doesNotMatch(golf, /이승엽/);
});

test("Title Case 제목의 일반 단어는 고유명사 보호 때문에 영어로 남지 않는다", async () => {
  const fetchImpl = async (url) => {
    const source = new URL(url).searchParams.get("q");
    const translated = source
      .replace("Judge", "판사는")
      .replace("Rules", "판결했다")
      .replace("Trump", "트럼프")
      .replace("Administration's", "행정부의")
      .replace("Blacklisting", "블랙리스트가")
      .replace(" of ", " ")
      .replace("Was", "은")
      .replace("Illegal", "불법이었다");
    return { ok: true, json: async () => [[[translated, source, null, null, 1]], null, "en"] };
  };
  const translated = await googleFreeTranslator({ fetchImpl })(
    "Judge Rules Trump Administration's Blacklisting of Anthropic Was Illegal"
  );

  assert.match(translated, /판사는|판결했다|행정부|블랙리스트|불법/);
  assert.match(translated, /Anthropic/);
  assert.doesNotMatch(translated, /\b(?:Rules|Administration|Blacklisting|Was|Illegal)\b/);
});

test("보존한 영문 약어를 복원할 때 한국어 조사를 발음에 맞춘다", async () => {
  const fetchImpl = async (url) => {
    const source = new URL(url).searchParams.get("q");
    const translated = source
      .replace(/NOWHOTNAME0TOKEN/g, "NOWHOTNAME0TOKEN은")
      .replace(/NOWHOTNAME1TOKEN/g, "NOWHOTNAME1TOKEN이")
      .replace(/NOWHOTNAME2TOKEN/g, "NOWHOTNAME2TOKEN을");
    return { ok: true, json: async () => [[[translated, source, null, null, 1]], null, "en"] };
  };
  const translated = await googleFreeTranslator({ fetchImpl })("AI UK OpenAI");
  assert.equal(translated, "AI는 UK가 OpenAI를");
});

test("무료 번역 뒤 영문 고유명사와 약어에 붙은 한국어 조사를 다듬는다", async () => {
  const fetchImpl = async (url) => {
    const source = new URL(url).searchParams.get("q");
    const translated = source
      .replace(/NOWHOTNAME0TOKEN/g, "NOWHOTNAME0TOKEN은")
      .replace(/NOWHOTNAME1TOKEN/g, "NOWHOTNAME1TOKEN이");
    return { ok: true, json: async () => [[[translated, source, null, null, 1]], null, "en"] };
  };
  const translated = await googleFreeTranslator({ fetchImpl })("McCarthy QBs");
  assert.equal(translated, "McCarthy는 QBs가");
});

test("캐시가 적중해도 감지 언어를 잃지 않는다", async () => {
  // 안 그러면 같은 글이 사이클마다 다른 언어로 표시된다 —
  // 화면이 왔다갔다하는 것은 틀린 것보다 알아채기 어렵다.
  let calls = 0;
  const one = async (text, opts) => { calls++; opts.detectedLang = "ja"; return "번역됨"; };
  const memo = memoizedTranslator(one);
  const a = { from: "auto", to: "ko" };
  await memo("同じ文", a);
  const b = { from: "auto", to: "ko" };
  await memo("同じ文", b);
  assert.equal(calls, 1, "캐시가 적중해야 한다");
  assert.equal(b.detectedLang, "ja", "캐시 적중 시에도 언어가 따라와야 한다");
});

test("originalLang이 소스 선언이 아니라 실제 감지 언어가 된다", async () => {
  // 조선비즈(lang:"ko")가 일본어 기사를 섞어 보내는 실제 상황.
  const src = { async fetch() {
    return [{ id: "a", title: "大韓サッカー協会が外国人審判に", url: "https://x/1",
              source: "chosunbiz", lang: "ko", topics: [] }];
  } };
  const translate = async (text, opts) => { opts.detectedLang = "ja"; return "대한축구협회가 외국인 심판에"; };
  const out = await new TranslatingSource(src, translate, "ko").fetch();
  assert.equal(out[0].translated, true);
  assert.equal(out[0].originalLang, "ja", `소스 선언(ko)이 아니라 감지 언어여야 한다: ${out[0].originalLang}`);
});

test("감지에 실패하면 예전처럼 소스 선언값으로 떨어진다", async () => {
  const src = { async fetch() {
    return [{ id: "b", title: "Some English Headline Here", url: "https://x/2",
              source: "slashdot", lang: "en", topics: [] }];
  } };
  const translate = async () => "어떤 영어 제목";   // detectedLang을 안 적는다
  const out = await new TranslatingSource(src, translate, "ko").fetch();
  assert.equal(out[0].originalLang, "en");
});
