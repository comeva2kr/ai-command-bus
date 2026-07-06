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

## API

| Method + path            | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `GET  /api/config`       | survey definition + categories + sources       |
| `POST /api/session`      | create/resume a user, returns `userId`         |
| `POST /api/history`      | warm-start from `{ entries: [...] }`           |
| `POST /api/survey`       | save `{ answers }` and seed preferences        |
| `GET  /api/feed`         | next unseen batch (`userId`, `cursor`, `limit`)|
| `GET  /api/item`         | one item + its comment thread                  |
| `POST /api/rate`         | `{ itemId, signal }` — signal ∈ {-1, 0, 1}     |
| `POST /api/comment`      | `{ itemId, body }`                             |

## Run it

```bash
npm run feed                          # in-memory, http://localhost:4000
PORT=4000 FEED_DB=./feed-data.json npm run feed   # persist users to a JSON file
```

Open the URL, take the survey (or warm-start with history), then scroll, rate,
and comment. State persists per browser via a `userId` in `localStorage`.

## Files

- `src/feed/taxonomy.js` — categories, tags, source catalog
- `src/feed/survey.js` — onboarding survey + preference-vector builder
- `src/feed/history.js` — browsing-history taste inference (warm start)
- `src/feed/content.js` — content model, normalization, source adapters
- `src/feed/seed-data.js` — offline seed dataset
- `src/feed/recommender.js` — scoring, online learning, specialization level
- `src/feed/store.js` — users, ratings, comments, JSON persistence
- `src/feed/engine.js` — collection + ranking + cursor batches
- `src/feed/server.js` — zero-dependency HTTP API + static client
- `src/feed/public/index.html` — the mobile-first single-page client
