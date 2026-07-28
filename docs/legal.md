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

## Images: hotlink only, never stored or re-hosted

Thumbnail images work under the exact same principle as the rest of this
aggregator (David 2026-07-26): we reference the **source's own** representative
image URL and let the *original server* serve it — we never download, cache,
or re-host the image bytes ourselves. This is the same model as a KakaoTalk or
Twitter link preview: only the source itself the pixels leave.

1. **Only a site's own intended representative image** — RSS's
   `<media:thumbnail>`/`<media:content>`/image-typed `<enclosure>`, the first
   `<img>` a feed's own description/content already embeds, a list page's own
   rendered thumbnail `<img>` next to a title, or a submitted link's own
   `og:image`/`twitter:image`. Never a scraped/derived image, never a full
   article's inline gallery, never anything beyond the one representative
   image the source itself surfaces for link-preview purposes.
2. **Hotlink only, no storage** — the client's `<img src>` points straight at
   the source's own URL (`referrerpolicy="no-referrer"` to avoid leaking our
   domain and to sidestep referrer-based hotlink blocks; `loading="lazy"` so an
   off-screen image is never even requested). Our server never fetches,
   proxies, caches, or stores the image bytes at any point.
3. **URL-only normalization, not a copy** — a relative or protocol-relative
   image URL is resolved to an absolute one, and `http://` is upgraded to
   `https://` only for sources with a verified `httpsOk`. Still just a URL
   string; nothing is downloaded to do this.
4. **Graceful, silent fallback** — a dead/blocked hotlink hides its own
   thumbnail slot (`onerror` removal) and the card falls back to the existing
   text-only layout. No broken-image icon, no retry, no extra request.
5. **Conservative extraction, not "images"** — most list-page communities
   (theqoo/bobae/ppomppu/todayhumor/etoland/inven 등) only ever render a
   file-type or "HOT" badge icon next to a title, not a real per-post
   thumbnail; those sources intentionally carry no image extraction rule
   rather than misrepresenting a badge icon as the post's image. "No image" is
   the honest default — see `docs/handoff.md`'s 코드 지도 for which sources do.

## Social login: minimal personal data collection

`src/feed/auth.js` implements Google/Kakao/Naver OAuth 2.0 directly (no
third-party auth SDK). Per provider, we read exactly three fields out of the
userinfo response and discard everything else:

- the provider's own user id (`sub` / `id` / `response.id`) — the only
  identifier ever used to recognize a returning login,
- a display nickname,
- a profile image URL (never downloaded — same hotlink-only principle as
  article thumbnails above; the client's `<img>` points at the provider's own
  CDN URL).

**Email is never read or stored**, even though every provider's userinfo
response includes one — `normalize()` in `auth.js` simply never accesses that
field, so it never reaches `store.js`, the persisted JSON file, or any log
line. No other profile data (phone number, birthday, gender, provider access
tokens, etc.) is persisted; the OAuth access token is used once at login to
fetch userinfo and then discarded — it is not stored.

Linking a social account to an existing anonymous user (see `store.js`'s
`linkSocialAccount`) never touches that user's preferences, ratings, saved
posts, or comments — only `user.social` (provider + provider user id, for
future login matching) and `user.socialProfile` (nickname/avatar, display-only
in "내 공간") are added.

## Provenance field

Every item carries `via`: `seed` (offline dev data only), `rss`, `api`,
`submit`, or `me` (a user's own post). Only `me` posts store a full body; all
aggregated provenances are out-links with capped excerpts.

## Not legal advice

This documents the design's compliance intent. Before launch, have a Korean IP/IT
lawyer review the specific sources, their ToS/robots.txt, and the excerpt policy.
