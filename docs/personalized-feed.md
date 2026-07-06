# Personalized Community Feed (내 취향 피드)

A taste-driven reader that pulls "best" posts and news from across many
communities and shows you only the ones that fit *you* — instead of a plain
aggregator's community-by-community, page-by-page list.

It solves the pain points of existing aggregators:

- **Community-by-community tabs → one personalized stream.** You don't hop
  between boards; the feed blends every source and ranks by your taste.
- **Clunky pagination → smooth infinite scroll.** No page numbers, no reload
  jank. New items stream in as you scroll.
- **Losing your place → exact back-restore.** Open a post, press back, and you
  return to the *exact* pixel you left from (`history.scrollRestoration` is set
  to manual and the feed DOM is kept mounted under a detail overlay).

## How taste is learned

```text
warm-start (browsing history)  ┐
onboarding survey              ┼─→ preference vector ─→ ranking ─→ feed
like / dislike feedback  ──────┘        ▲                              │
                                        └──────── online learning ◀────┘
```

1. **Warm start from browsing history (optional).** Paste the community
   domains / post titles you usually visit. `history.js` maps hosts → sources
   and title keywords → categories/tags to infer an initial taste vector.
   Only hosts and titles are used; nothing is fetched or stored.
2. **Onboarding survey.** A few multi-select questions (interests, favorite
   communities, tone, depth, topics to avoid) seed the preference vector. The
   survey folds the warm-start signal in at a reduced weight so explicit
   answers lead.
3. **Feedback loop.** Every 👍 / 👎 nudges the category, tag, and source weights
   (`applyFeedback`, a small-step online update with gentle decay). The feed
   sharpens as you use it.
4. **Specialization level.** `specializationLevel()` estimates how well we know
   you (0–1) from feature coverage, weight contrast, and feedback volume. It
   drives the phase shown in the header: `탐색 중` → `학습 중` → `맞춤 완성`.

## Scoring

`scoreItem()` combines, per item:

- category weight + averaged tag weight + source weight (the learned taste)
- a longform-vs-quick style match against the item's length
- a log-scaled popularity prior (so "클리앙/뽐뿌 인기글" still surface)
- a deterministic novelty jitter (varies the feed without `Math.random`)
- a strong penalty for already-seen items

The engine only ever hands out *unseen* items, so the infinite scroll never
repeats within a session.

## Sources

Content comes from pluggable **sources** — any object with
`{ id, kind, async fetch() }`. Bundled:

- `SeedSource` — offline seed dataset (`seed-data.js`), always available, spans
  news + community across categories including 자동차, 유머, IT, 스포츠, etc.
- `JsonSource(id, loader)` — wrap any async loader (an internal community DB, a
  proxied API) that returns raw items.

Add an RSS or community adapter by conforming to the same shape and routing raw
items through `normalizeItem()`.

## Community registry (resource DB)

Sources are defined as data in [`src/feed/communities.json`](../src/feed/communities.json),
not code — adding a community is a new row. Each entry carries `country`,
`lang`, `category`, `size`, `adult`, and an `adapter` (`seed` | `rss` | `reddit`
| `json`). `registry.js` loads it and `buildSources()` turns enabled entries
into runnable sources:

- `seed` entries read the bundled offline dataset (runs with no network).
- non-`seed` entries need a `fetcher(entry)` injected at runtime; without one
  they stay registered but yield nothing, so the app is always runnable while
  ready to wire live ingestion.

### Live ingestion

`fetchers.js` provides real adapters — RSS/Atom (`parseRss`, dependency-free),
Hacker News (Algolia front page), and Reddit-style JSON — plus a `makeFetcher`
dispatcher keyed on the entry's `adapter.type`. Turn it on with `FEED_LIVE=1`:
enabled non-seed communities are then fetched live (and translated if a
translator is wired). The network layer is injectable (`fetchImpl`) so it's
tested offline with fixtures and runs wherever the host network policy allows
the target domains. Behind a re-terminating proxy, set `NODE_EXTRA_CA_CERTS`
to the CA bundle so `fetch` trusts it.

> Note: some managed environments restrict outbound HTTP to an allowlist; there,
> keep `FEED_LIVE` off and the app runs on the seed dataset.

The DB already registers domestic communities (large and small), overseas
boards (Reddit, Hacker News, 5ch, …), and adult boards.

## Overseas translation

`TranslatingSource` wraps any source and localizes items whose `lang` differs
from the reader's target. The translator is **injected** (provider-agnostic,
dependency-free). Without one, foreign items are passed through and flagged
`needsTranslation` so the UI labels them (`원문`) instead of silently showing a
foreign-language post; with one, items are translated and flagged `번역` with
the original title preserved. `memoizedTranslator()` caches so re-collection
never re-translates the same string.

## Periodic DB update

`engine.startAutoRefresh(intervalMs)` re-collects every source on an interval
and swaps the pool atomically. Because item ids are **content-stable**
(`stableId` in `content.js`), ratings and comments keep pointing at the right
posts across refreshes. Enable on the server with `FEED_REFRESH_MS`.

## Posting + 내 공간 (my space)

Users can post (`POST /api/post`) — a post becomes a first-class feed item
(`source: "me"`) via `StorePostsSource`, so the space behaves like a community
built for you. `GET /api/me` returns everything you've created or reacted to
(posts, comments, like/dislike tallies) for integrated management.

## Community governance (space rules + levels)

As a space grows it earns its own norms. `rules.js` centralizes them:

- **Post/comment validation** — length bounds, a space-wide banned-word filter,
  tag limits. Enforced in the store on `createPost` / `addComment`; the server
  returns the specific rule errors (400).
- **Rate limiting** — max posts/comments per time window (429 when exceeded).
- **Category norms** — advisory posting guidance per category (e.g. 시승기엔
  실사용 정보), surfaced in the composer, not blocking.
- **Participation levels** — a score from posts, comments, and likes *received*
  promotes members through 새싹 → 이웃 → 단골 → 터줏대감, each unlocking perks
  (createTags → flag → moderate). Shown in 내 공간; `GET /api/rules` exposes the
  rulebook.

This is the "이용자가 늘수록 그 안에서만 통용되는 규격/룰" layer, kept data-first
so a space can tune its own rulebook.

## 19금 (adult) gate

Adult items are filtered out server-side unless the user is **both**
age-verified (`POST /api/verify-age`) **and** has the toggle on
(`POST /api/adult`). The gate is enforced in the engine for both the feed and
single-item fetch, so an unverified client can never pull an adult item.

## API

| Method + path            | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `GET  /api/config`       | survey definition + categories + sources       |
| `GET  /api/communities`  | community registry DB + summary                |
| `POST /api/session`      | create/resume a user, returns `userId`         |
| `POST /api/history`      | warm-start from `{ entries: [...] }`           |
| `POST /api/survey`       | save `{ answers }` and seed preferences        |
| `GET  /api/feed`         | next unseen batch (`userId`, `cursor`, `limit`)|
| `GET  /api/item`         | one item + its comment thread                  |
| `POST /api/rate`         | `{ itemId, signal }` — signal ∈ {-1, 0, 1}     |
| `POST /api/comment`      | `{ itemId, body }`                             |
| `POST /api/post`         | create a user post `{ title, summary, category }` |
| `GET  /api/me`           | my space: posts, comments, ratings, saved, level |
| `GET  /api/rules`        | the space's rulebook (limits, norms, banned words) |
| `POST /api/save`         | scrap/un-scrap an item `{ itemId, on }`        |
| `POST /api/mute`         | mute/unmute a source `{ source, on }`          |
| `POST /api/verify-age`   | age verification (mock; wire PASS/본인확인)     |
| `POST /api/adult`        | toggle the 19금 view `{ on }` (requires verify) |

## Run it

```bash
npm run feed                          # in-memory, http://localhost:4000
PORT=4000 FEED_DB=./feed-data.json npm run feed   # persist users to a JSON file
FEED_REFRESH_MS=900000 npm run feed               # re-collect the DB every 15 min
```

Open the URL, take the survey (or warm-start with history), then scroll, rate,
and comment. State persists per browser via a `userId` in `localStorage`.

## Files

- `src/feed/taxonomy.js` — categories, tags, source catalog
- `src/feed/survey.js` — onboarding survey + preference-vector builder
- `src/feed/history.js` — browsing-history taste inference (warm start)
- `src/feed/content.js` — content model, normalization, source adapters
- `src/feed/seed-data.js` — offline seed dataset
- `src/feed/communities.json` — community resource DB (国内+해외+성인)
- `src/feed/registry.js` — DB loader + source builder + queries
- `src/feed/fetchers.js` — live RSS/HN/Reddit adapters + dispatcher
- `src/feed/translate.js` — overseas translation source wrapper
- `src/feed/rules.js` — space governance: post/comment rules, rate limits, levels
- `src/feed/recommender.js` — scoring, online learning, specialization level
- `src/feed/store.js` — users, posts, ratings, comments, JSON persistence
- `src/feed/engine.js` — collection + ranking + cursor batches + auto-refresh
- `src/feed/server.js` — zero-dependency HTTP API + static client
- `src/feed/public/index.html` — the mobile-first single-page client
