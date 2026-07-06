// Service worker for the personalized feed PWA.
//
// Goals: make the app installable, launch instantly, and survive flaky/offline
// networks — the retention half of "web-first PWA". Strategy:
//   - app shell (/, icons, manifest) is precached and served cache-first
//   - navigations are network-first, falling back to the cached shell offline
//   - /api/* is always network (never cache dynamic personalized data)

const CACHE = "feed-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Focus an existing tab (or open one) when a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

// Real Web Push would arrive here; a VAPID-signed server sends the payload.
self.addEventListener("push", (event) => {
  let data = { title: "내 취향 피드", body: "관심글이 올라왔어요" };
  try { if (event.data) data = event.data.json(); } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: "/icon.svg", badge: "/icon.svg", tag: "feed-digest" })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // never cache the personalized API — always go to the network
  if (url.pathname.startsWith("/api/")) return;

  // navigations: network-first so content is fresh, cached shell as offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((r) => r || caches.match(request)))
    );
    return;
  }

  // static assets: cache-first, then network (and populate the cache)
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return resp;
        })
    )
  );
});
