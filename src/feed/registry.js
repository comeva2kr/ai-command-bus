// Community resource registry.
//
// Loads the data-driven community DB (communities.json) and turns entries into
// runnable sources. This is the "리소스화/DB화" layer: adding a community means
// adding a row to the JSON, not writing code. Domestic + overseas + adult
// communities all live here with the metadata the feed needs (country, lang,
// category, adult flag, adapter type).
//
// Fetching is pluggable. `seed` entries read the bundled offline dataset.
// Non-seed entries (rss / reddit / json) need a `fetcher(entry)` injected at
// runtime; without one they stay registered but yield nothing, so the app runs
// fully offline while remaining ready to wire live ingestion.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JsonSource, SeedSource, normalizeItem } from "./content.js";
import { SEED_ITEMS } from "./seed-data.js";
import { TranslatingSource } from "./translate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "communities.json");

export function loadRegistry(file = DB_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const communities = Array.isArray(raw.communities) ? raw.communities : [];
  return communities;
}

// Query helpers over the registry.
export function query(registry, filter = {}) {
  return registry.filter((c) => {
    if (filter.enabled != null && Boolean(c.enabled) !== filter.enabled) return false;
    if (filter.country && c.country !== filter.country) return false;
    if (filter.lang && c.lang !== filter.lang) return false;
    if (filter.adult != null && Boolean(c.adult) !== filter.adult) return false;
    if (filter.category && c.category !== filter.category) return false;
    return true;
  });
}

// Build Source instances for every enabled community.
//
// opts.fetcher(entry) -> Promise<rawItems[]>  : live ingestion for non-seed adapters
// opts.seedItems                              : override the offline dataset (tests)
// opts.seed                                   : false disables seed adapters AND the
//                                               offline fallback — the dev dataset must
//                                               never reach a production feed
// opts.translate: { targetLang, translateFn } : wrap non-target-lang sources so
//                                               overseas boards arrive translated
export function buildSources(registry, opts = {}) {
  const includeSeed = opts.seed !== false;
  const seedItems = opts.seedItems || SEED_ITEMS;
  const targetLang = opts.translate ? opts.translate.targetLang || "ko" : null;
  const translateFn = opts.translate ? opts.translate.translateFn : null;

  const sources = [];
  for (const entry of query(registry, { enabled: true })) {
    let source;
    if (entry.adapter && entry.adapter.type === "seed") {
      if (!includeSeed) continue;
      // stamp registry metadata (lang/adult/category) onto seed items for this source
      const items = seedItems
        .filter((it) => it.source === entry.id)
        .map((it) => ({ lang: entry.lang, ...it, adult: it.adult || entry.adult === true }));
      source = new JsonSource(entry.id, async () => items, entry.kind);
    } else if (opts.fetcher) {
      // live adapter — delegate to the injected fetcher, tag with registry meta.
      // Stamp provenance so aggregated items are recognizable downstream (and
      // get the ≤200-char excerpt cap): rss feeds -> "rss", json/reddit -> "api".
      const via = entry.adapter && entry.adapter.type === "rss" ? "rss" : "api";
      source = new JsonSource(
        entry.id,
        async () => {
          const rows = await opts.fetcher(entry);
          // entry.httpsOk (default true) tells normalizeItem whether this
          // source's own domain is known to serve https — gates the
          // http://->https:// URL upgrade (see content.js) so a source we
          // haven't verified never gets its links silently rewritten.
          const httpsOk = entry.httpsOk !== false;
          return (Array.isArray(rows) ? rows : []).map((r) => ({
            lang: entry.lang,
            category: entry.category,
            adult: entry.adult === true,
            via,
            httpsOk,
            ...r,
            source: entry.id
          }));
        },
        entry.kind
      );
    } else {
      continue; // registered but no way to fetch offline — skip cleanly
    }

    // translate overseas sources into the target language when a translator is wired
    if (targetLang && entry.lang && entry.lang !== targetLang) {
      source = new TranslatingSource(source, translateFn, targetLang);
    }
    sources.push(source);
  }

  // guarantee at least the offline seed content if nothing else resolved
  if (!sources.length && includeSeed) sources.push(new SeedSource(seedItems));
  return sources;
}

// Summary for the UI / transparency ("소스 관리" view): what's in the DB.
export function summarize(registry) {
  const by = (key) => {
    const m = {};
    for (const c of registry) m[c[key]] = (m[c[key]] || 0) + 1;
    return m;
  };
  return {
    total: registry.length,
    enabled: registry.filter((c) => c.enabled).length,
    adult: registry.filter((c) => c.adult).length,
    byCountry: by("country"),
    byLang: by("lang")
  };
}

export { normalizeItem };
