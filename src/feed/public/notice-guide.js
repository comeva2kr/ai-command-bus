/* Shared one-time tutorial and release notice for Today and Live. */
(() => {
  const ONBOARD_KEY = "feed_onboarded_v1";
  const RELEASE_KEY = "feed_seen_release";
  let active = null;

  const style = document.createElement("style");
  style.textContent = `
    .nh-guide-back{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.62)}
    .nh-guide{position:relative;width:min(100%,520px);max-height:min(760px,calc(100dvh - 40px));overflow:auto;background:var(--paper,var(--card,#fff));color:var(--ink,var(--text,#15171c));border:1px solid var(--line,#d9dde4);border-radius:8px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.3)}
    .nh-guide-tag{margin:0 0 6px;color:var(--red,var(--accent,#d83b32));font-size:12px;font-weight:850}
    .nh-guide h2{margin:0 38px 8px 0;font-size:22px;line-height:1.3;letter-spacing:0}
    .nh-guide-lead{margin:0 0 18px;color:var(--sub,var(--muted,#626873));font-size:14px;line-height:1.6}
    .nh-guide-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border:1px solid var(--line,#d9dde4);border-radius:6px;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer}
    .nh-guide-list{margin:0 0 20px;padding-left:20px}.nh-guide-list li{margin:0 0 8px;font-size:14px;line-height:1.6}
    .nh-guide-usage{display:grid;grid-template-columns:1fr 1fr;border-block:1px solid var(--line,#d9dde4);margin:0 0 20px}
    .nh-guide-usage section{padding:14px 14px 14px 0}.nh-guide-usage section+section{padding-left:14px;border-left:1px solid var(--line,#d9dde4)}
    .nh-guide-usage h3{margin:0 0 5px;font-size:15px;letter-spacing:0}.nh-guide-usage p{margin:0;color:var(--sub,var(--muted,#626873));font-size:13px;line-height:1.55}
    .nh-guide-tip{margin:0 0 18px;font-size:13px;line-height:1.55}
    .nh-guide-ok{width:100%;min-height:44px;border:0;border-radius:6px;background:var(--blue,var(--accent,#2457d6));color:#fff;font-weight:800;cursor:pointer}
    @media(max-width:560px){.nh-guide-back{align-items:flex-end;padding:0}.nh-guide{max-height:88dvh;border-radius:8px 8px 0 0;padding:22px 18px calc(18px + env(safe-area-inset-bottom))}.nh-guide-usage{grid-template-columns:1fr}.nh-guide-usage section{padding:12px 0}.nh-guide-usage section+section{padding-left:0;border-left:0;border-top:1px solid var(--line,#d9dde4)}}
  `;
  document.head.appendChild(style);

  const read = (key) => { try { return localStorage.getItem(key); } catch { return undefined; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  function remove() {
    if (!active) return;
    const { root, previousFocus } = active;
    active = null;
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function close() {
    if (!active) return;
    if (history.state?.nhNotice === active.token) history.back();
    else remove();
  }

  addEventListener("popstate", (event) => {
    if (!active || event.state?.nhNotice === active.token) return;
    remove();
    event.stopImmediatePropagation();
  });

  document.addEventListener("keydown", (event) => {
    if (!active) return;
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const controls = [...active.root.querySelectorAll("button")];
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  function addUsage(card) {
    const usage = make("div", "nh-guide-usage");
    for (const [title, text] of [
      ["오늘판", "모닝·런치·이브닝 전에 준비된 브리핑입니다. 날짜, 시간대와 관심 분야를 골라 봅니다."],
      ["실시간", "지금 급상승하는 뉴스와 커뮤니티 글입니다. 정렬, 분야와 출처를 바꿔 빠르게 살펴봅니다."]
    ]) {
      const section = make("section");
      section.append(make("h3", "", title), make("p", "", text));
      usage.append(section);
    }
    card.append(usage);
  }

  function show({ release, isNewVisitor = false, skip = false } = {}) {
    if (skip || active || location.hash || document.querySelector("#detail.open,#issueDetail.open")) return false;
    const onboarded = read(ONBOARD_KEY);
    const seenRelease = read(RELEASE_KEY);
    if (onboarded === undefined || seenRelease === undefined) return false;
    const tutorial = onboarded !== "1" && (isNewVisitor || seenRelease === null);
    const unseenRelease = release?.id && seenRelease !== release.id;
    if (!tutorial && !unseenRelease) return false;

    const kind = tutorial ? "tutorial" : "release";
    if (tutorial) write(ONBOARD_KEY, "1");
    if (release?.id) write(RELEASE_KEY, release.id);

    const root = make("div", "nh-guide-back");
    root.id = "nhGuide";
    root.dataset.kind = kind;
    const card = make("section", "nh-guide");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "nhGuideTitle");
    const iconClose = make("button", "nh-guide-close", "×");
    iconClose.type = "button";
    iconClose.setAttribute("aria-label", "안내 닫기");
    iconClose.dataset.nhGuideClose = "";
    const tag = make("p", "nh-guide-tag", tutorial ? "처음 사용하기" : "대규모 업데이트");
    const title = make("h2", "", tutorial ? "지금핫에 오신 걸 환영해요" : release.title || "지금핫이 새로워졌어요");
    title.id = "nhGuideTitle";
    const lead = make("p", "nh-guide-lead", tutorial
      ? "오늘 꼭 볼 흐름은 정리해서, 지금 뜨는 흐름은 빠르게 보여드립니다."
      : "기존에 잘 되던 기능은 유지하고, 더 빠르고 편하게 읽도록 다듬었습니다.");
    card.append(iconClose, tag, title, lead);

    if (!tutorial && release?.items?.length) {
      const list = make("ul", "nh-guide-list");
      for (const item of release.items.slice(0, 5)) list.append(make("li", "", item));
      card.append(list);
    }
    addUsage(card);
    card.append(make("p", "nh-guide-tip", "제목을 누르면 준비된 한국어 요약, 사진과 출처를 보고 원문으로 이동할 수 있습니다."));
    const ok = make("button", "nh-guide-ok", tutorial ? "지금핫 시작하기" : "확인했어요");
    ok.type = "button";
    ok.dataset.nhGuideClose = "";
    card.append(ok);
    root.append(card);

    const token = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    active = { root, token, previousFocus: document.activeElement };
    root.addEventListener("click", (event) => { if (event.target === root || event.target.closest("[data-nh-guide-close]")) close(); });
    document.body.append(root);
    history.pushState({ ...(history.state || {}), nhNotice: token }, "", location.href);
    ok.focus();
    return true;
  }

  window.NowHotNoticeGuide = { show, close };
})();
