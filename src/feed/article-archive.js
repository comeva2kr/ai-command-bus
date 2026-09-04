import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Public feed excerpts only. Never persist personalized decoration or raw bodies.
const FIELDS = [
  "id", "source", "sourceLabel", "kind", "via", "url", "canonicalUrl", "image",
  "title", "summary", "originalTitle", "originalSummary", "lang", "originalLang",
  "translated", "summaryTranslated", "needsTranslation", "category", "tags", "topics", "publishedAt",
  "firstSeenAt", "score", "commentCount", "viewCount", "coverage", "relatedCoverage",
  "feedGroup", "ownershipGroup", "isDeal", "price", "priceCheckedAt", "adult"
];
const identifiers = (item) => [item.id, ...(item.canonicalAliases || []).map((a) => a.id)]
  .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 512);

export class ArticleArchive {
  constructor(directory = null) {
    this.directory = directory;
    this.cache = new Map();
  }

  _file(id) {
    return path.join(this.directory, createHash("sha256").update(id).digest("hex") + ".json");
  }

  get(id) {
    let item = this._read(id);
    const visited = new Set([id]);
    // A previous canonical winner can itself become an alias after reselection.
    while (item && item.id !== id) {
      id = item.id;
      if (visited.has(id)) return null;
      visited.add(id);
      const canonical = this._read(id);
      if (!canonical) break;
      item = canonical;
    }
    return item ? structuredClone(item) : null;
  }

  _read(id) {
    if (typeof id !== "string" || !id || id.length > 512) return null;
    let item = this.cache.get(id);
    if (!item && this.directory) {
      try { item = JSON.parse(fs.readFileSync(this._file(id), "utf8")); }
      catch (err) {
        if (err.code !== "ENOENT") console.error("[article-archive] read failed:", err.message);
        return null;
      }
      if (!item || !identifiers(item).includes(id)) return null;
      this._cache(id, item);
    }
    return item || null;
  }

  _cache(id, item) {
    this.cache.delete(id);
    this.cache.set(id, item);
    // Disk keeps old links; only the in-process read cache is bounded.
    if (this.directory && this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
  }

  remember(item) {
    if (!item || !identifiers(item).length || !/^https?:\/\//i.test(item.url || "")) return;
    if (["me", "submit", "ourdeal"].includes(item.via) || ["me", "nowhot-deal"].includes(item.source)
      || ["ad", "affiliate"].includes(item.kind)) return;
    const snapshot = {};
    for (const key of FIELDS) if (item[key] != null) snapshot[key] = structuredClone(item[key]);
    snapshot.title = String(snapshot.title || "").slice(0, 300);
    snapshot.summary = String(snapshot.summary || "").slice(0, 1000);
    if (snapshot.originalTitle) snapshot.originalTitle = String(snapshot.originalTitle).slice(0, 300);
    if (snapshot.originalSummary) snapshot.originalSummary = String(snapshot.originalSummary).slice(0, 1000);
    const prior = this.get(snapshot.id);
    snapshot.canonicalAliases = [...new Set([
      ...identifiers(item).slice(1), ...(prior ? identifiers(prior).slice(1) : [])
    ])].filter((id) => id !== snapshot.id).map((id) => ({ id }));
    const clearedSummary = snapshot.translated && snapshot.summaryTranslated === false;
    if (clearedSummary) snapshot.summary = "";
    for (const key of ["summary", "image", "originalTitle", "originalSummary"]) {
      if (key === "summary" && clearedSummary) continue;
      if (!snapshot[key] && prior?.[key]) snapshot[key] = prior[key];
    }
    const body = JSON.stringify(snapshot);
    if (prior && JSON.stringify(prior) === body) return;
    for (const id of identifiers(snapshot)) {
      if (this.directory) {
        fs.mkdirSync(this.directory, { recursive: true });
        const file = this._file(id);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body, { mode: 0o600 });
        fs.renameSync(tmp, file);
      }
      this._cache(id, snapshot);
    }
  }
}
