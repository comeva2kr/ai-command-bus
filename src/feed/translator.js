import { discardBody } from "./fetchers.js";
// Free machine translation for overseas feed items.
//
// Plugs into translate.js's TranslatingSource as the injected `translateFn`.
// Uses Google's unofficial, no-key "gtx" web endpoint — the same one
// translate.google.com's own page uses — so this stays zero-dependency (no
// npm package, node's built-in `fetch`). There is no SLA on this endpoint: it
// can rate-limit, change shape, or go dark without notice. Every failure mode
// (network error, timeout, non-200, unexpected JSON shape) must therefore
// fall back to the original text rather than throw — TranslatingSource
// already treats a *thrown* translator as "flag needsTranslation, keep
// original", but resolving to the original text here is strictly better: the
// item still reads fine, just untranslated, with no extra flag plumbing.
//
// Only ever called with the title and the (already ≤200-char, see content.js)
// excerpt — never full article bodies — so per-call payloads are small and
// call volume is low.
//
// Rate protection: this module makes no attempt at its own concurrency pool.
// TranslatingSource.fetch() already awaits one item at a time in a plain
// `for` loop (see translate.js), so calls into this translator are already
// serialized per source; wrapping the result in memoizedTranslator (below,
// re-exported from translate.js at the call site) additionally skips repeat
// calls for identical strings across refresh cycles. That's enough protection
// for a free endpoint without adding a bespoke queue.

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_UA = "ai-command-bus-feed/0.1 (+https://github.com/comeva2kr/ai-command-bus)";

// Google's `dt=t` response is a nested JSON array, not an object:
//   [[["번역된 문장","original sentence",null,null,1], ...], null, "en", ...]
// data[0] is the list of translated chunks (long input gets split into
// several); each chunk's [0] is the translated text for that chunk. Join
// them back into one string.
// data[2]는 Google이 **실제로 판별한 원문 언어**다(위 예시의 "en").
// 그동안 이 값을 받아 놓고 버렸다. 그 대가로 화면에 "KO 제목을 기계번역했어요"
// 같은 문구가 떴다 — originalLang이 실제 언어가 아니라 레지스트리에 적힌
// 소스 선언(조선비즈면 "ko")을 그대로 되돌려주고 있었기 때문이다.
// 조선비즈는 한국 매체지만 일본어판 기사를 섞어 보낸다(실측 100건 중 5건).
function extractDetectedLang(data) {
  const l = Array.isArray(data) ? data[2] : null;
  return typeof l === "string" && l.length <= 8 ? l : null;
}

function extractTranslation(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  let out = "";
  for (const chunk of data[0]) {
    if (Array.isArray(chunk) && typeof chunk[0] === "string") out += chunk[0];
  }
  return out || null;
}

// Build a translateFn matching what translate.js/TranslatingSource expects:
//   async (text, { from, to }) => translatedText
//
// fetchImpl / timeoutMs are injectable for tests (no real network needed).
export function googleFreeTranslator({ fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async (text, opts = {}) => {
    if (!text) return text;
    const sl = opts.from || "auto";
    const tl = opts.to || "ko";
    const url =
      `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": DEFAULT_UA, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) { discardBody(res); return text; } // free endpoint hiccup (rate limit, 5xx, ...) -> original text
      const data = await res.json();
      const translated = extractTranslation(data);
      // 감지 언어는 **opts에 적어 돌려준다.** 반환값을 객체로 바꾸면
      // translate.js와 engine.js의 호출부가 전부 깨진다 — 계약은 그대로 두고
      // 부가 정보만 옆으로 흘린다.
      const detected = extractDetectedLang(data);
      if (detected && opts && typeof opts === "object") opts.detectedLang = detected;
      return translated || text; // empty/unexpected shape -> original text, never throw
    } catch {
      return text; // network error, timeout (AbortError), bad JSON -> original text
    }
  };
}
