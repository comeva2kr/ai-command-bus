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
      const [title, summary] = await Promise.all([
        this._translate(item.title, { from: lang, to: this._target }),
        item.summary ? this._translate(item.summary, { from: lang, to: this._target }) : Promise.resolve(item.summary)
      ]);
      return {
        ...item,
        title: title || item.title,
        summary: summary || item.summary,
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
