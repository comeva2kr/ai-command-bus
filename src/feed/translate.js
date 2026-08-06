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

// 한글이 한 자라도 있으면 우리 독자가 읽을 수 있는 글로 본다.
// 숫자·기호만 있는 짧은 제목은 옮길 것이 없으므로 한글로 치지 않는다.
function hasKorean(text) {
  return /[가-힣]/.test(String(text || ""));
}

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
    // ── 판정은 선언이 아니라 **글자**로 한다 (2026-08-05)
    //
    // 예전엔 `lang === target`이면 바로 통과였다. 그런데 조선비즈는 레지스트리에
    // "ko"로 선언돼 있으면서 일본어판 기사를 같은 피드에 섞어 보낸다(실측 100건
    // 중 19건). 선언을 믿으면 그 19건이 일본어 그대로 한국 사용자에게 간다.
    //
    // 그래서 제목에 한글이 있는지를 본다. 있으면 우리 글이므로 번역기를 부르지
    // 않고 그대로 통과한다 — 국내 글이 대부분이라 비용이 늘지 않는다.
    // 없으면 소스가 뭐라고 선언했든 옮긴다. 우리 독자는 한국 사람이다.
    if (hasKorean(item.title)) return item;
    if (lang === this._target && hasKorean(item.summary)) return item;

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
      const summaryTranslated = Boolean(item.summary) && Boolean(summary) && summary !== item.summary;

      // ── 제목과 요약을 따로 판정한다 (2026-08-04 실측으로 뒤집은 규칙)
      //
      // 예전엔 둘 중 하나라도 실패하면 **전체를 원문으로 되돌렸다**. 취지는
      // "절반만 번역된 상태를 보여주지 않는다"였는데, 실제로는 정반대로
      // 작동했다: 영문 소스 57건 중 제목이 번역된 건 12건뿐이었고, 나머지
      // 45건은 **요약이 보일러플레이트라 번역기가 원문을 그대로 돌려준 탓에**
      // 멀쩡히 번역된 제목까지 버려진 것이었다.
      //   예) Tildes 요약 = "23 comments in the discussion of this post on Tildes"
      //
      // 한글 제목 + 영문 발췌가, 영문 제목 + 영문 발췌보다 낫다. 사용자가
      // 목록에서 먼저 읽는 것은 제목이다. 요약은 번역되면 쓰고 아니면 원문을
      // 남긴다 — 어느 쪽이든 배지로 상태를 밝힌다.
      if (!titleTranslated) {
        return { ...item, needsTranslation: true, originalLang: lang };
      }
      // ── 번역 안 된 요약은 **남기지 않고 버린다** (David 2026-08-05 2차 리포트)
      //
      // 어제는 반대로 정했다. "한글 제목 + 영문 발췌가, 영문 제목 + 영문 발췌보다
      // 낫다"고. 논리는 맞았지만 화면을 보니 아니었다 — David가 바로 잡아냈다:
      // "일부 뉴스는 제목 한글 / 요약 영문 섞임. 진짜 한 것만 띄우자."
      //
      // 실측(2026-08-05 라이브 32건): 번역 5건 중 2건이 이 상태였고, 그중 하나는
      // 애초에 요약도 아니었다 — "16 comments in the discussion of this post on
      // Tildes". 영문 한 줄을 남겨서 얻는 정보보다, 한 화면에 두 언어가 섞여
      // 보이는 손해가 크다. 발췌가 없으면 제목만 보여 주면 된다.
      //
      // 영문 처리 자체는 후순위다(David). 제대로 옮길 수 있게 되면 그때 살린다.
      return {
        ...item,
        title,
        summary: summaryTranslated ? summary : "",
        summaryTranslated,
        lang: this._target,
        translated: true,
        originalLang: lang,
        originalTitle: item.title,
        // 원문 발췌도 남긴다. 화면에서 "원문 보기"를 누르면 제목만 바뀌고
        // 본문은 번역문 그대로면 반쪽이다 — 무엇을 어떻게 옮겼는지 대조가 안 된다
        // (David 2026-08-06: "원문보러가기/번역본 보기 두 개를 넣고 실제 활용
        //  가능하게 만들자").
        originalSummary: item.summary || ""
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
