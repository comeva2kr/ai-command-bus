// Translation layer for overseas communities.
//
// Famous foreign boards (Reddit, Hacker News, 5ch, ...) are worth surfacing to
// a Korean reader, but only if they arrive readable. TranslatingSource wraps any
// source and runs its items' title/summary through a pluggable translator when
// the item's language differs from the reader's target language.
//
// The translator is injected, not hard-wired, so this stays dependency-free and
// provider-agnostic — pass a function backed by whatever service you use. If no
// translator is provided, items are passed through untouched but flagged
// `needsTranslation`, so the UI can label them instead of silently showing a
// foreign-language post as if it were native.

export class TranslatingSource {
  // inner: a Source ({ id, kind, fetch() })
  // translateFn: async (text, { from, to }) => translatedText   (optional)
  // targetLang: e.g. "ko"
  constructor(inner, translateFn, targetLang = "ko") {
    this.id = inner.id;
    this.kind = inner.kind;
    this._inner = inner;
    this._translate = typeof translateFn === "function" ? translateFn : null;
    this._target = targetLang;
  }

  async fetch() {
    const items = await this._inner.fetch();
    const out = [];
    for (const item of items) {
      out.push(await this._localize(item));
    }
    return out;
  }

  async _localize(item) {
    const lang = item.lang || "ko";
    if (lang === this._target) return item;

    if (!this._translate) {
      // no translator wired — keep original, flag for the UI
      return { ...item, needsTranslation: true, originalLang: lang };
    }

    try {
      // "auto"로 감지 (David 2026-07-24 적대적 검수 #9): 소스 전체에 고정으로
      // 못박힌 item.lang(예: communities.json의 devto 항목 전체가 "en")은 그
      // 소스의 *평균* 언어일 뿐, 개별 글의 실제 언어와 다를 수 있다 — dev.to의
      // 일부 포르투갈어 글이 "en"으로 잘못 표시돼 sl=en으로 강제 번역을 시도하면
      // Google이 원문 언어를 오판해 반쪽만 번역되거나 아예 원문 그대로 돌아오는
      // 문제가 있었다. sl을 auto로 넘기면 Google이 실제 텍스트를 보고 언어를
      // 스스로 판별하므로 이 소스-단위 lang 태그의 부정확성과 무관해진다.
      const [title, summary] = await Promise.all([
        this._translate(item.title, { from: "auto", to: this._target }),
        item.summary ? this._translate(item.summary, { from: "auto", to: this._target }) : Promise.resolve(item.summary)
      ]);
      // 원자적 처리: 제목/요약 중 하나라도 번역기가 원문을 그대로 돌려줬다면
      // (엔드포인트 실패, 언어 오판, 그 외 무응답 등 어떤 이유든) 절반만 번역된
      // 상태로 유저에게 보여주지 않는다 — 전체를 원문 그대로 유지하고 "원문"
      // 배지로 표시(needsTranslation)한다. target이 "ko"인 이상 실제로 번역된
      // 텍스트는 한글을 포함하므로, 원문과 완전히 동일하다는 건 곧 번역이 전혀
      // 안 됐다는 신뢰할 수 있는 신호다.
      const titleTranslated = Boolean(title) && title !== item.title;
      const summaryTranslated = !item.summary || (Boolean(summary) && summary !== item.summary);
      if (!titleTranslated || !summaryTranslated) {
        return { ...item, needsTranslation: true, originalLang: lang };
      }
      return {
        ...item,
        title,
        summary,
        lang: this._target,
        translated: true,
        originalLang: lang,
        originalTitle: item.title
      };
    } catch (err) {
      // a failed translation must never drop the item from the feed
      return { ...item, needsTranslation: true, originalLang: lang };
    }
  }
}

// Convenience: build a translateFn from a batch endpoint, with a tiny in-memory
// cache so re-collections don't re-translate identical strings.
export function memoizedTranslator(translateOne) {
  const cache = new Map();
  return async (text, opts) => {
    if (!text) return text;
    const key = `${opts.from}>${opts.to}:${text}`;
    if (cache.has(key)) return cache.get(key);
    const result = await translateOne(text, opts);
    cache.set(key, result);
    return result;
  };
}
