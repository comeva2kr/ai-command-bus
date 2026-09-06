window.NowHotPush = (() => {
  const supported = () => "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || "")
    || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
  const installed = () => navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches;
  const help = () => isIOS() && !installed()
    ? "아이폰·아이패드 알림은 홈 화면 앱에서 받을 수 있어요.\n1. Safari에서 공유 → 홈 화면에 추가\n2. ‘웹 앱으로 열기’가 보이면 켜기\n3. 홈 화면의 지금핫 아이콘으로 열고 알림 받기 → 허용"
    : "";
  const connectionError = () => new Error("알림 연결에 실패했어요. 다시 시도해 주세요.");

  async function sync(userId, create) {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription && create) {
      const response = await fetch("/api/push/vapid-key");
      if (!response.ok) throw connectionError();
      const { key } = await response.json();
      if (!key) throw connectionError();
      const padded = key + "=".repeat((4 - key.length % 4) % 4);
      const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, character => character.charCodeAt(0))
      });
    }
    if (!subscription?.endpoint) return false;
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, subscription: subscription.toJSON() })
    });
    if (!response.ok) throw connectionError();
    return true;
  }

  async function restore(userId) {
    if (!userId || !supported() || Notification.permission !== "granted") return false;
    try { return await sync(userId, false); }
    catch { return false; }
  }

  async function enable(userId) {
    if (!supported()) throw new Error(help() || (isIOS()
      ? "아이폰·아이패드 알림은 iOS·iPadOS 16.4 이상에서 지원돼요. 홈 화면의 지금핫 앱으로 열어 주세요."
      : "이 브라우저는 푸시 알림을 지원하지 않아요."));
    if (!userId) throw connectionError();
    let permission = Notification.permission;
    if (permission === "default") {
      try { permission = await Notification.requestPermission(); }
      catch { throw connectionError(); }
    }
    if (permission !== "granted") throw new Error(isIOS()
      ? "아이폰 설정 → 알림 → 지금핫에서 알림을 허용해 주세요."
      : "브라우저 설정에서 지금핫 알림을 허용해 주세요.");
    try {
      if (await sync(userId, true)) return true;
    } catch { /* Keep browser and network details out of the UI. */ }
    throw connectionError();
  }

  return { restore, enable, help };
})();
