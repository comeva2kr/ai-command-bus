// Service worker for the personalized feed PWA.
//
// Goals: make the app installable, launch instantly, and survive flaky/offline
// networks — the retention half of "web-first PWA". Strategy:
//   - app shell (/, icons, manifest) is precached and served cache-first
//   - navigations are network-first, falling back to the cached shell offline
//   - /api/* is always network (never cache dynamic personalized data)

const CACHE = "feed-shell-v107"; // v107: 드로어에 데이터 리포트 // v106: 관련글 링크 구분 // v105: 상세에 편집 코멘트 + 같은 사건 다른 소스 // v104: 설정에 핫딜 모아보기 버튼 + 화면 테마를 내 공간으로 // v103: 몰입 모드 광고 카드 레이아웃 복구 // v102: 핫딜 모아보기 탭 + 우리 딜이 경쟁에 안 밀림 // v101: 우리 딜 카드에 확인 시점 표시 // v100: 우리 딜이 광고 카드 경로를 타서 고지문·가격이 화면에 나온다 // v99: 차단기에 본문이 통째로 지워지던 것 복구(사진만 빠지고 글자는 남게) // v98: 광고 차단기가 본문만 지웠을 때 빈 껍데기를 남기지 않는다 // v97: 빌드 태그 없는 옛 화면은 워커 해제 후 한 번에 갱신 // v96: 낡은 화면이 스스로 갱신한다(빌드 대조) // v95: 광고 썸네일 크기를 자리와 무관하게 통일(피드 88 / 상세 76이던 것) // v94: 광고 카드 렌더러를 하나로 통합(서버·화면 두 경로가 다르게 생기던 것) // v93: 첫 화면에 화제글이 보이게 자체 콘텐츠 높이 예산 + 중복 라벨 제거 + 캡값 숫자 제거 // v92: 홈 앞자리에 우리가 쓴 브리핑 본문 펼침(애드핏 P0-A 자체 콘텐츠 비중) // v91: 앱 광고 카드가 LLM 문구(line·cta)를 실제로 쓴다 // v90: 브리핑 알림 호흡 주기 5초 → 3초 // v89: 브리핑 알림은 대표 카드 한 장만 호흡(스트립 전체 맥동 완화) // v88: 새 브리핑 편성 은은한 알림(눌러서 보기 전까지) + 브리핑 본문 사이사이 연관 광고 // v87: 애드핏 지면을 목록 중간 전용 카드로(하단이면 노출 0) // v86: 애드핏 지면을 목록 끝 전용 카드로 분리(쿠팡 슬롯 보존 + 심사 지면 유지) // v85: 애드핏 빈 지면이 쿠팡 자리 먹던 것 수정 + 딜 상한·간격 + 모든 글에 연관 광고 // v84: 핫딜 소스 5곳 + 딜 최소 비율 보장 + 딜 상품군에 맞춘 광고(피드·상세) // v83: 광고 카드를 게시글과 같은 칸으로(색·테두리·CTA) + 문구 3단 // v82: 광고 썸네일을 콘텐츠와 같은 88px로 + 배너 캐시 갱신 // v81: 광고 카드를 콘텐츠 카드 모양으로(정사각 썸네일) // v80: 애드핏 지면 유지(폴백이 지우지 않음) // v79: 광고 클릭 보고 복구 + 광고 인접 안전검사 // v78: 정치·종교 버튼 복구 + 취향 현재값 표시 + 고지문 시인성 // v77: 자리 복원 판별을 체류시간 기준으로 재설계(검수 P0) // v76: 죽은 번역 링크 제거·혼합 언어 정리·브리핑 편성 표시 // v75: 읽던 자리로 돌아오기(강제 재로드 복원) // v74: 브리핑 편성 화면 완성(슬롯 레일·날짜 이동) // v73: IndexNow 배선 + 설명문 정정(죽은 소스 제거·80자) // v72: 유입 경로 개방(Discover·카톡 공유·색인 정리) // v71: 조회수·작성일 수집 + 브리핑 날짜·시간대 이동 // v70: 하루 3편 브리핑 편성(아침·점심·저녁) + 랭킹 순위 번호 // v69: 승격 제외·광고 인접 가드·제목 번역 복구·한글 번역 링크 (2026-08-04) // v68: 광고 지면 정상화·홈 서버렌더·신원 확정·약관/방침 보강 (2026-08-04)
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
