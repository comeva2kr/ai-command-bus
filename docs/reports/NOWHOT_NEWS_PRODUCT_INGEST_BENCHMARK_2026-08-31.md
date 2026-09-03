# NowHot vs major news products: ingest, categorize, group, rank

- Date: 2026-08-31 (Asia/Seoul)
- Reviewer: Cursor Grok 4.6, Orca dispatched worker `task_57c7a44edc40`
- Scope: official primary documentation for Google News, Apple News, Microsoft/Bing, plus RSS/Atom/Schema.org/IPTC; audit of `/Users/hyundonghwang/Documents/NowHot-Local-Dev` ingest/classify/group/rank/summary
- Constraint honored: read-only. No product edits, tests, API/model/Keychain calls, commits, deploys, or pointer changes. Official docs were fetched; live news APIs and model keys were not.

## Blunt recommendation

**Yes.** Use publisher/section metadata first, deterministic normalization second, and LLM only for ambiguous multi-category leftovers that the first two layers abstain on. **Summaries must stay default-off**; if they run, they are a selective evidence-backed rewrite of already-public excerpts, not a second classifier and not a second model used as a product gate. **Do not replace collection adapters with a commercial news API.** Bing’s news API is retired; NewsAPI forbids a competing news database; Apple News is a publish-in pipeline; Google does not sell an ingest API. Keep RSS + specialist section feeds + community list adapters. Parse the category fields you already download and currently throw away.

The inverted stack on the edition path — LLM snapshot preferred, then 1,300+ “legacy classifier” fallbacks counted as admitted supply — is the opposite of how the documented major products work. Extra validation does not fix that. It hides it.

## Verdict

| Question | Answer |
|---|---|
| Publisher/section first? | **Do it.** NowHot already says this for `specialist` sources and then undermines it for Google News sections, mixed boards, and v2 routing. |
| Deterministic normalization second? | **Do it.** URL section tokens, RSS/Atom `<category>`, `dc:subject`, specialist registry, and a small synonym map. This is what RSS 2.0, Atom, Schema.org `articleSection`, and Apple News sections exist for. |
| LLM only for ambiguous multi-category cases? | **Do it.** Production `classify.js` is Naive Bayes + dictionaries, not per-item LLM — that part is already closer to right than D1/D2. Do not promote the unpaid LLM snapshot into the publish path. |
| Summaries default no-LLM, selective evidence-backed? | **Already coded that way (`NOWHOT_ARTICLE_SUMMARY` default off).** Keep it. Do not add a second verifier model as a ship gate. |
| Commercial news API instead of adapters? | **No.** Wrong product, wrong ToS, dead Bing endpoint, missing KR community boards, missing publisher section truth. |
| Excessive LLM classification? | **Yes, on the edition/routing path and in the D1–NH91 labs.** Not in the live `TitleClassifier`. |
| Excessive validation? | **Yes.** The ledger/hash/Wilson/verifier pile exists because classification was treated as an LLM problem. Drop the LLM-as-classifier; keep fail-closed gates only where they protect a reader-visible claim. |

Do not activate a new pointer on LLM-classified coverage. Do not buy NewsAPI/Bing/Grounding-with-Bing as ingest. Do not turn article summaries on for live.

---

## 1. What the documented major products actually do

None of Google, Apple, or Microsoft publish a complete ranking formula. They do publish the **control surface**: who assigns category, how stories are grouped, and which signals they will admit in public docs. That surface is metadata-first, not LLM-first.

### 1.1 Google News / Google Search News

**Ingest.** As of late March 2025, Google News **no longer uses RSS feeds or web locations submitted in Publisher Center**. Publication pages are generated automatically from crawled site content. Eligibility is “content that adheres to our content policies,” not a feed the publisher uploaded.

- https://support.google.com/news/publisher-center/answer/15898024?hl=en

Publishers who still want to **tell Google about new articles** use a news sitemap (loc, publication name, language, publication date, title). That sitemap has **no category field**. Category is not a publisher-submitted ranking lever in this protocol.

- https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap

Optional `NewsArticle` structured data is for headline, dates, authors, images. Google’s own Article docs list those properties and **do not list `articleSection` as a Google-supported NewsArticle field**. Schema.org still defines `articleSection` (“Sports, Lifestyle, etc.”) and Google’s index sees it on 1M–10M domains — it is publisher section metadata on the open web, not a Google News API.

- https://developers.google.com/search/docs/appearance/structured-data/article
- https://schema.org/articleSection

**Categorize / group.** Algorithms pick subjects for Headlines / Top stories / Full Coverage / Search by **language and region**. Full Coverage is the public name for story clustering: related articles, perspectives, context. Personalization is a **separate surface** (For You, Following, Picks for you), not the clustering engine.

- https://support.google.com/googlenews/answer/9005749?hl=en
- https://support.google.com/news/publisher-center/answer/10598160?hl=en

The remaining publisher-curated exception is **News Showcase**: publishers choose stories and images inside a Showcase panel. That is paid/partner curation, not LLM classification of crawled titles.

**Rank.** Official ranking factors, in Google’s words: relevance, prominence, authoritativeness, freshness, usability, location, language. They will not give more. AdSense does not buy rank.

- https://support.google.com/news/publisher-center/answer/9606702?hl=en

**Implication for NowHot.** Google’s own product stopped treating publisher-submitted RSS as the publication-page ingest. NowHot still treats `news.google.com/rss/topics/…` as both **supply** and **training labels** for Naive Bayes. That RSS is a **consumer view of Google’s already-clustered topic pages**, not publisher section metadata, and not a license to re-rank Google’s cluster as if it were first-party. Using it as ground truth for a title classifier is circular: Google clustered it, you train on the cluster, then you reclassify the same titles and call the result “ours.”

### 1.2 Apple News

**Ingest.** Publishers **push** Apple News Format documents through News Publisher / the Apple News API. This is a CMS-to-Apple pipeline, not an API that a third-party briefing app may poll for Korean community posts.

- https://developer.apple.com/apple-news/
- https://support.apple.com/guide/news-publisher/use-your-cms-with-news-publisher-apd88c8447e6/icloud

**Categorize / group.** The publisher creates **sections** (topic or type; default section plus up to 25; 6–8 recommended). Articles are assigned to sections by section ID in the create-article metadata (`links.sections`). Omit sections → default section. Empty array → standalone: still eligible for topics, search, and For You, but not the channel feed. **The publisher names the section. Apple does not ask a model to guess Sports vs Entertainment from the headline.**

- https://support.apple.com/guide/news-publisher/about-channels-and-sections-apde3db8dc29/icloud
- https://developer.apple.com/documentation/applenewsapi/post-channels-_channelid_-articles

**Metadata.** Official Metadata object: excerpt, thumbnailURL, dates, authors, canonicalURL, keywords/campaignData for ad targeting, related links. Channel feeds sort by **publication date**.

- https://developer.apple.com/documentation/applenewsformat/metadata

**Implication for NowHot.** Apple’s documented system is exactly “publisher/section metadata first.” NowHot’s `specialist` tier (`category-policy.js`: declared category is a strong default; reclassify only on clear semantic conflict) is the Apple-shaped rule. The edition router that prefers `current_model` LLM rows over that default is the anti-Apple rule.

### 1.3 Microsoft / Bing

**Documented news API (historical, now dead as a product).** Bing News Search v7 exposed:

- `/news` — headlines or **category** news (`category=sports`, market-specific taxonomy including Business, Politics, ScienceAndTechnology, Health, …)
- `/news/search` — query; empty `q` returns top stories
- `/news/trendingtopics` — social-trending topics
- Per-article `category` when Bing could determine it; **`clusteredArticles`** for related coverage; `provider` for publisher name; `headline` boolean on category requests

- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/overview
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/how-to/category-news
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/response-objects
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/query-parameters

**ToS that killed it as a briefing ingest.** Official overview: the API “may only be used as a result of a direct user query or search, or as a result of an action … that logically can be interpreted as a user’s search request.” Polling `/news?category=Business` every 15 minutes to fill a three-slot briefing is **not** that.

**Retirement.** Bing Search APIs retired **11 August 2025**. Replacement is **Grounding with Bing Search** inside Azure AI Agents: the model may call Bing; **developers and end users do not get the raw search payload**; Microsoft says it is **not recommended to summarize an entire web page**; citations and the Bing query URL must be displayed as Microsoft specifies.

- https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/bing-grounding

**Implication for NowHot.** There is no current Microsoft news ingest API you can legally use as a drop-in for `fetchers.js`. Grounding-with-Bing is an LLM citation tool, not a category-and-cluster feed. Buying it would **increase** LLM use, which is the failure mode under review.

### 1.4 Open standards the majors consume (and NowHot ignores)

These are not “a Google blog.” They are the category fields sitting in the bytes NowHot already fetches.

| Standard | What it is | Official URL |
|---|---|---|
| RSS 2.0 `<category>` | Item may have many categories; optional `domain` names the taxonomy; value may be slash-hierarchic. “Processors may establish conventions.” | https://www.rssboard.org/rss-specification |
| Atom `<category>` | `term` required; `scheme` / `label` optional. | https://www.rfc-editor.org/rfc/rfc4287#section-4.2.2 |
| Dublin Core `dc:subject` / `dc:date` | NowHot already learned `dc:date` the hard way (Khan, Slashdot). `dc:subject` is still unread. | RSS spec namespace extension rule, same page |
| Schema.org `articleSection` | Newspaper/magazine section name(s). | https://schema.org/articleSection |
| IPTC Media Topics | 1,200+ term news subject taxonomy, 13 languages, the industry code list. | https://iptc.org/standards/media-topics/ |

`src/feed/fetchers.js` `parseRss` reads title, link, description/content:encoded (images only), pubDate/updated/`dc:date`, slash:comments, media thumbnails, and Google-News related-`<li>` coverage. **It does not read `<category>`, Atom category, or `dc:subject`.** That is the cheapest publisher-metadata win in the repo, and it is unimplemented.

---

## 2. What NowHot actually does

### 2.1 Collection adapters (keep these)

Registry: `src/feed/communities.json` + `src/feed/registry.js` + `src/feed/fetchers.js` `makeFetcher`.

| Adapter `type` | Enabled (of 107) | Job |
|---|---|---|
| `rss` | 87 | RSS/Atom string parse. News wires, specialist section feeds, Google News topic RSS. |
| `list` | 17 | HTML list-page scrape of Korean community best/hot boards (regex per source). No RSS. |
| `json` | 2 | Hacker News Algolia / dev.to-style JSON. |
| `store` | 1 | Local store. |
| `seed` | 0 enabled | Dev-only. |
| `reddit` | 0 enabled | Present in registry, not live. |

Enabled mix: 77 `news`, 30 `community`. Tiers: 51 `specialist`, 27 `aggregate`, 29 `community`.

This is a **legal out-link aggregator** (`src/feed/ingest.js`, `docs/legal.md`): title, ≤200-char excerpt, source, URL. No body store on the ingest path. Community heat is real engagement (score/comments/views). News heat is mostly **source order** plus Google News related-article count (capped at 5, Google-News-feeds only after an adversarial false-coverage bug).

Google News topic RSS still in the live registry (examples): `gnews`, `gnews-world`, `gnews-kr`, `gnews-tech`, `gnews-biz`, `gnews-sports`, `gnews-ent`, plus `gnews-science` which is labeled **구글뉴스 건강** and mapped to `life` after a 65% science mis-tag incident. That is publisher-topic metadata being used as a **feed selector**, which is fine, then **re-learned as Naive Bayes labels**, which is not fine.

### 2.2 Categorize — two stacks, one of them wrong

**Stack A — production ingest classifier (closer to right).**

`src/feed/classify.js`: syllable n-gram Naive Bayes trained on Google News section titles + weak community labels; politics via dictionary; abstain on low margin/known. Cost: microseconds, no model.

`src/feed/category-policy.js` + `engine._classifyItems`:

- `specialist`: declared source category is a **strong default**. Reclassify only on NB margin/known **and** ≥2 target-dictionary hits **and** context guard. This is the Apple rule.
- `aggregate` (gnews-biz, gnews-ent, …): declared section is a **weak prior**. NB above operating threshold may reclassify **without** the two-hit dictionary bar. This is where NowHot argues with Google’s own topic page.
- `community` / mixed boards: title model + keyword overrides, because the board is not a section.

**Stack B — edition category routing v2 (inverted).**

`src/feed/category-routing.js` + snapshot builder. Preferred basis is `current_model` (LLM lab snapshot). Then specialist registry, then URL-path token (`world`→news, `movie`→culture), then unique publisher label on gnews items, then stale/post-snapshot declared category.

NH90 product audit on a frozen evening plate: snapshot 2,208 rows with **`current_model` 2, `specialist_registry_default` 869, `legacy_classifier_fallback` 1,337**. Selected leads 196: model 0, specialist 103, legacy 93. NH91 counter-review: intended ~2,198 LLM classifications stopped after **4 API calls**; recovery admitted 2,199 using 242 model rows + 1,957 source/legacy fallbacks; strict model-only left news at 8.

That is not “LLM for ambiguous cases.” That is “LLM as the named source of truth, with a fallback pump so the 14-per-lane floor still fills.” Official Google/Apple/Bing systems do not work this way.

URL-section recovery (`LEGACY_SECTION_CATEGORIES`) is the one piece of Stack B that matches the recommendation — **deterministic publisher-path metadata** — but it only runs as a patch on `legacy_classifier_fallback`, not as the first classifier.

### 2.3 Group

`src/feed/event-cluster.js`: deterministic. Canonical URL match, normalized title key, then entity-token overlap inside a 24h window, with conservative anti-merge guards (number clash, humor vs news, community-community content merge banned). This is the same *kind* of thing as Bing `clusteredArticles` and Google Full Coverage, implemented as rules because NowHot cannot crawl the web at Google scale. **Keep it. Do not LLM-merge events.** Official products also do not describe LLM event merge in public docs; they describe clustering as algorithmic.

### 2.4 Rank

Not LLM. `ingest.js` hot/freshness/source-rank, Google coverage as a news-only co-report signal, `rank.js` personalized taste + diversity caps, `digest.js` / `selection-axes.js` / `edition-candidates.js` for the three-slot briefing. Google’s published factors (freshness, prominence-via-coverage, language/region) are the same *family*. NowHot’s distinctive signal is **community engagement**, which no news API will give you.

### 2.5 Summaries and editorial LLM

| Path | Default | What it is |
|---|---|---|
| Article summary `NOWHOT_ARTICLE_SUMMARY` | **off** (`=== "1"` to enable) | Fetch public body in memory, Sonnet 600–900자, independent verifier model, evidence hashes, no raw-body persist. `excerpt_only` fallback exists. |
| Editorial LLM `NOWHOT_LOCAL_EDITORIAL_LLM` | **off** | Shared-edition batch, 2 calls, editor+verifier, deterministic fallback for whyHot/whyForYou. |
| Briefing `llm.js` | on when key present | 2–4 sentence commentary; numbers are code-injected; hallucinated digits discarded. |

The product already encoded “summaries default off.” NH81 status in `docs/NOWHOT_DEVELOPMENT_STATUS.md`: real-model quality HOLD, Docker/staging default OFF. That is the correct commercial posture. A second LLM used as a verifier **gate** is validation theater: if the quote-span check is real, it does not need a model; if it is not real, the second model does not make it real.

---

## 3. Challenge: excessive LLM classification

Documented majors:

- Google: crawl + rank/cluster algorithms; optional structured data; **publisher Showcase** as the curated exception.
- Apple: **publisher-assigned sections**.
- Bing (while it existed): **API-side category + clusteredArticles**, consumed as search results, not as a title-LLM.

NowHot D1 lab (`selection-classifier-lab.js`): `runtimeWired: false`, gold pending, Wilson one-sided precision target **0.98**, abstain ≤20%, 14 admission rows per item. That precision target is a research fantasy for open-web Korean titles. NH91 then tried to run it on ~2,200 items, aborted after 4 paid calls, and **published the fallback as classified supply**.

The honest read of the labs: **the model is not the classifier.** The classifier is still source section + NB + URL tokens. The LLM snapshot is a expensive, incomplete overlay whose empty cells get filled by the thing you were supposed to replace.

**Do not spend more validation on this overlay.** Spend the same energy on:

1. Parse RSS/Atom category / `dc:subject`.
2. Treat specialist section feeds and URL `/sports/` `/economy/` tokens as first-class.
3. Keep NB/dictionaries for mixed community boards and true conflicts.
4. LLM **only** when those layers abstain **and** the item is otherwise high-rank enough to be worth a call, with **abstain as a valid publish decision** (withhold from a lane rather than invent a category).

That is the coordinator’s hierarchy. It matches Apple’s public model, RSS’s public model, and Bing’s (dead) response schema. It contradicts only NowHot’s v2 routing preference order.

---

## 4. Challenge: excessive validation

Useful fail-closed checks (keep):

- Out-link-only ingest, SSRF host block, excerpt cap (`ingest.js`).
- Event merge guards (`event-cluster.js`).
- Specialist correction audit field `categoryCorrection`.
- “Numbers come from code” in briefing copy (`llm.js`).
- Article-summary: no raw body on disk; DNS pin; default off.

Theater (cut or stop treating as ship gates):

- Independent LLM verifier as a **required** pass for summaries and editorial fields. A deterministic quote/evidence-id check is the actual guarantee; a second model is correlated error.
- D1 Wilson 0.98 + gold-pending + usage ledger + Keychain-preflight-before-you-can-even-fail, while production ranking still uses NB.
- Counting `legacy_classifier_fallback` rows inside `classifiedArticles`.
- Snapshot SHA / prompt SHA / contract version churn that does not change reader-visible category.
- 14-per-lane floor that **fills from any admitted row** (`digest.js` ignoreSourceCap). That is not validation; it is an incentive to accept junk so the gate turns green.

Google’s ranking doc says they “can’t provide much feedback regarding ranking.” They still ship. NowHot’s failure mode is the opposite: infinite proof about a classifier that is not allowed to abstain.

---

## 5. Commercial news API vs current adapters

| Option | Ingest? | Category truth? | Cluster? | KR community? | Legal fit for NowHot |
|---|---|---|---|---|---|
| Keep adapters | Yes, already | If you parse it | Homegrown rules | Yes, that is the product | Matches `docs/legal.md` out-link model |
| Bing News Search v7 | Retired 2025-08-11 | Bing `category` + market list | `clusteredArticles` | No | Search-query ToS; endpoint gone |
| Grounding with Bing | **No raw articles** | Hidden inside the LLM | No | No | Agent citations, not a feed |
| NewsAPI.org | Headlines/everything | **Source-level** `business/entertainment/general/health/science/sports/technology` | No | `country=kr` exists; not 더쿠/뽐뿌 | ToS: **“attempt to build a competing news database”** is forbidden; do not republish copyrighted material; developer plan is not production |
| Apple News API | You **send** articles to Apple | Publisher sections | Apple topics/For You | No | Wrong direction |
| Google | No third-party ingest API | Algorithms + optional markup | Full Coverage | No | You are not Googlebot |

NewsAPI sources docs: https://newsapi.org/docs/endpoints/sources
NewsAPI terms (competing database, copyrighted republication): https://newsapi.org/terms

A commercial API can be a **narrow English/global prior** later (freshness, cluster IDs) if counsel clears ToS. It cannot replace 17 Korean list adapters or specialist KR RSS. It cannot be category ground truth over a Hankyung real-estate section feed. It will not fix science/art/fashion scarcity.

**Keep the adapters.** Add category-field parsing. Treat Google News topic RSS as **one aggregate heat source**, not as a label oracle. Prefer first-party publisher RSS (이미 specialist 51곳) for lane identity.

---

## 6. Direct answers to the coordinator’s thesis

**Should NowHot use publisher/section metadata first, deterministic normalization second, LLM only for ambiguous multi-category cases?**

**Yes.** Implement that order on the **publish path**, not as a comment in `category-policy.js` while v2 routing prefers `current_model`.

Suggested contract (not implemented in this task):

1. **Publisher/section:** specialist registry category; RSS/Atom category / `dc:subject` mapped through a frozen synonym table; unique URL path token; Google topic RSS **keeps its topic id as a prior, not as NB training gold**.
2. **Deterministic:** dictionaries (`definiteCategory`), mixed-board neutralization, existing NB **only** for community/mixed and for specialist conflict (already gated).
3. **LLM:** only if (1)+(2) abstain **and** the item is a high-rank candidate **and** the output is allowed to be withhold. Never use LLM output to satisfy a 14-item floor.

**Should summaries default to no LLM with selective evidence-backed use?**

**Yes, and they already do.** Leave `NOWHOT_ARTICLE_SUMMARY` off in Docker/staging/live. If a future GO turns it on: public excerpt or quote-span first; one model; fail to `excerpt_only`; no second-model ship gate; no raw body persistence (already true).

---

## 7. What this review did not do

- Did not edit product code, tests, snapshots, or pointers.
- Did not call Anthropic, NewsAPI, Bing, or Keychain.
- Did not fetch live Google News RSS bodies (would be a product-path network call).
- Did not re-litigate NH91 pointer GO/NO-GO beyond using those audits as evidence of the inverted classifier.

Implementation, if David accepts the recommendation, is a later dispatch: parse RSS category, invert routing preference, stop counting legacy as classified, keep adapters, keep summaries off.

---

## Official URLs (primary)

Google

- https://support.google.com/news/publisher-center/answer/15898024?hl=en
- https://support.google.com/news/publisher-center/answer/9606702?hl=en
- https://support.google.com/googlenews/answer/9005749?hl=en
- https://support.google.com/news/publisher-center/answer/10598160?hl=en
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap
- https://developers.google.com/search/docs/appearance/structured-data/article
- https://schema.org/articleSection

Apple

- https://developer.apple.com/apple-news/
- https://support.apple.com/guide/news-publisher/about-channels-and-sections-apde3db8dc29/icloud
- https://support.apple.com/guide/news-publisher/use-your-cms-with-news-publisher-apd88c8447e6/icloud
- https://developer.apple.com/documentation/applenewsformat/metadata
- https://developer.apple.com/documentation/applenewsapi/post-channels-_channelid_-articles

Microsoft

- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/overview
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/how-to/category-news
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/response-objects
- https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/query-parameters
- https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/bing-grounding

Standards / commercial

- https://www.rssboard.org/rss-specification
- https://www.rfc-editor.org/rfc/rfc4287#section-4.2.2
- https://iptc.org/standards/media-topics/
- https://newsapi.org/docs/endpoints
- https://newsapi.org/docs/endpoints/sources
- https://newsapi.org/terms
