/* App-owned entries keep browser history separate from unrelated documents. */
window.NowHotHistory = (() => {
  function webUrl(value, internal = false) {
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      if (internal && (url.origin !== location.origin || !["/", "/live", "/index.html", "/today.html", "/p"].includes(url.pathname))) return null;
      return url.href;
    } catch { return null; }
  }

  function create(page) {
    const memory = new Map();
    let lastEntry = null;
    const current = () => {
      if (history.state?.nhPage !== page || history.state?.nhVersion !== 1) return null;
      lastEntry = history.state;
      return lastEntry;
    };
    const listUrl = () => location.pathname + location.search;
    function snapshot(entry = current()) {
      if (!entry?.key) return null;
      try { return JSON.parse(sessionStorage.getItem(entry.key)) || memory.get(entry.key) || null; }
      catch { return memory.get(entry.key) || null; }
    }
    function save(value, detailScroll) {
      const entry = current();
      if (!entry) return;
      if (value) {
        memory.set(entry.key, value);
        try { sessionStorage.setItem(entry.key, JSON.stringify(value)); } catch {}
      }
      if (entry.view === "detail" && Number.isFinite(detailScroll)) {
        history.replaceState({ ...entry, detailScroll }, "", location.href);
      }
    }
    function ensure(value) {
      if (!current()) {
        history.replaceState({ nhPage: page, nhVersion: 1, view: "list",
          key: `nh-navigation:${page}:${window.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2)}` }, "", listUrl());
        save(value);
      }
      return current();
    }
    function open(detail, value, url, fromUrl = false) {
      const href = webUrl(url, true);
      if (!href) return null;
      // Native fragment navigation may create a null-state entry in this document.
      if (!current() && fromUrl && lastEntry) history.replaceState(lastEntry, "", href);
      const owned = current();
      const entry = ensure(value);
      if (entry.view === "list") save(value);
      if (entry.view === "detail" && JSON.stringify(entry.detail) === JSON.stringify(detail)) return entry;
      const next = { ...entry, view: "detail", detail, detailScroll: 0 };
      if (entry.view === "detail" || (owned && fromUrl && location.href === href)) history.replaceState(next, "", href);
      else history.pushState(next, "", href);
      return next;
    }
    return { current, snapshot, save, ensure, open };
  }
  return { create, webUrl };
})();
