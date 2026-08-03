// Service worker for the personalized feed PWA.
//
// Goals: make the app installable, launch instantly, and survive flaky/offline
// networks — the retention half of "web-first PWA". Strategy:
//   - app shell (/, icons, manifest) is precached and served cache-first
//   - navigations are network-first, falling back to the cached shell offline
//   - /api/* is always network (never cache dynamic personalized data)

const CACHE = "feed-shell-v55"; // v55: 홈 정적 글 목록 주입 — 크롤러가 읽을 콘텐츠
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg",
  "/icon-192.png", "/apple-touch-icon.png"];

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

// Focus an existing tab (or open one, at the notification's deep link) when
// a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Web Push arrives here — a VAPID-signed server (src/feed/push.js,
// sendDigestPushes) sends a JSON payload { title, body, url }. `url` isn't
// shown directly; it rides along as notification.data so notificationclick
// above can open the right in-app deep link (e.g. /#post-<id>).
self.addEventListener("push", (event) => {
  let data = { title: "지금핫", body: "관심글이 올라왔어요", url: "/" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "feed-digest",
      data: { url: data.url || "/" }
    })
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

  // 교차 출처는 서비스워커가 손대지 않는다 — 브라우저 HTTP 캐시에 맡긴다.
  //
  // 2026-08-02 적대적 검수(쿠팡 프론트엔드 성능 페르소나) 실측: 아래 cache-first
  // 분기에 오리진 가드가 없어서 광고 SDK와 광고 요청까지 전부 영구 고정됐다.
  // 캐시 227건 중 nowhot.kr은 4건뿐이고 광고·추적이 117건이었다. adsbygoogle.js는
  // transferSize=0(네트워크 미접속)으로 서빙됐고, 상류가 준 max-age=3600을 Cache
  // API가 무시해 CACHE 상수를 손으로 올릴 때까지 만료되지 않았다.
  //
  // 왜 P0인가 — 수익화 심사 중에 가장 위험한 조합이다:
  //  1. 구글이 애드센스 로더를 갱신해도 사용자에겐 배포 시점 버전이 계속 나간다
  //     (광고 미노출·서빙 실패의 전형적 원인이고, 캐시가 범인이라 디버깅이 어렵다)
  //  2. 무효 트래픽 탐지(adtrafficquality sodar)와 애드핏 배너 **요청 자체**가 캐시돼
  //     지난 광고 응답이 재생되고, URL이 고정인 gen_204 이벤트 비콘은 아예 전송되지
  //     않는다 — 임프레션 집계 오염과 무효 트래픽 판정 리스크
  //  3. 임프레션마다 토큰이 달라 새 엔트리가 상한 없이 쌓인다. 오리진 할당량을
  //     소진하면 브라우저가 버킷을 통째로 축출하는데, 같은 버킷의 localStorage에
  //     feed_uid(계정 식별자)와 취향 상태가 들어 있다.
  //
  // 외부 썸네일 캐시가 필요해지면 여기서 되돌리지 말고 별도 캐시명 + 호스트
  // 화이트리스트 + 건수 상한(LRU)으로 분리할 것. 앱 셸만 담으면 수백 KB로 끝난다.
  if (url.origin !== self.location.origin) return;

  // static assets: cache-first, then network (and populate the cache)
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((resp) => {
          // 실패 응답은 캐시하지 않는다 — 배포 중 한 번 404난 자산이 다음 CACHE
          // 상수 인상 때까지 그 사용자에게 영구 404로 남던 문제(같은 검수 실측).
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return resp;
        })
    )
  );
});
