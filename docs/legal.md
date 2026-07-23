# Aggregation compliance model (Korea)

This feed is an **out-link aggregator**, not a scraper-republisher. The design
keeps it inside the legal safe zone established by Korean case law.

## What the law says (why this model)

- **Plain hyperlinks are not infringement.** The Supreme Court has held that
  setting a link is not "transmission" and so does not infringe the public
  transmission right (e.g. 2009다4343 line of cases). Linking out to the
  original post is safe.
- **Framing / embedded links are risky.** If a click shows the content in-place
  instead of taking the user to the source, that can be infringement. So we
  **always navigate to the original** — no framing, no in-app full-body view.
- **Copying a full body / a substantial DB is risky even if not "copyright".**
  In 야놀자 v. 여기어때, the crawler was acquitted on copyright and business-
  obstruction charges but **lost the civil case under the Unfair Competition
  Prevention Act** (성과도용) for systematically copying a competitor's DB. So we
  do **not** bulk-crawl and re-host another site's database.

## The rules we follow

1. **Store/show only**: title + a short excerpt (≤200 chars) + source name +
   **required out-link**. Never the full article body. (`ingest.js` enforces the
   excerpt cap; the content model requires `url` for aggregated items.)
2. **Out-link, never frame**: opening an aggregated item leaves to the original
   (`item.url`). The detail view for aggregated items links out.
3. **Intake priority**:
   - **Official RSS / open APIs** first — syndicated title/summary/link (implied
     license). Reddit and Hacker News have public APIs; many outlets have RSS.
   - **robots.txt- and ToS-permitted** fetches only, done politely (rate-limited,
     identifying User-Agent). No login/paywall bypass.
   - **No bulk DB copying** of sites that don't permit it.
4. **User submissions** (`via: "submit"`): for communities without a feed, users
   submit a link; we read only the page's own Open Graph tags for a title +
   excerpt and keep the out-link. This avoids crawling entirely and fits the
   participation model.
5. **"화제성" from public signals only**: rank by each community's own hot-board
   ordering plus publicly shown recommends/comments/score — no body scraping
   needed to know what's hot (`ingest.hotness`).
6. **Attribution**: every item shows its source; the link goes to that source.
7. **News**: use licensed news APIs (e.g. Naver Search, NewsAPI) rather than
   scraping outlets.

## Provenance field

Every item carries `via`: `seed` (offline dev data only), `rss`, `api`,
`submit`, or `me` (a user's own post). Only `me` posts store a full body; all
aggregated provenances are out-links with capped excerpts.

## Not legal advice

This documents the design's compliance intent. Before launch, have a Korean IP/IT
lawyer review the specific sources, their ToS/robots.txt, and the excerpt policy.
