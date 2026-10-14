// 안심스캔 확장 — 쇼핑몰 식품 상세 페이지 오른쪽 가장자리에 점수 탭을 띄운다.
//
// 흐름:
//   1. 상품정보제공고시 표(원재료명·영양성분·알레르기)를 읽는다 — 몰마다 마크업은
//      달라도 결국 th/td, dt/dd 키-값 쌍이다. 없으면 본문 텍스트의 "원재료명 : …" 줄.
//   2. 점수는 이 확장 안의 core(서버와 같은 코드)로 계산한다 — 아이 프로필이
//      기기 밖으로 나가지 않는다.
//   3. 서버 주소가 있으면 고시표를 서버에도 보낸다: 서버는 그 상품의 원재료를
//      기억해 두고(다음엔 표를 안 펼쳐도 점수가 나옴) 카탈로그에서 대체품을 고른다.
//      서버가 없으면 내장 예시 카탈로그로 대체품을 고른다.
//   4. 점수는 백그라운드 서비스 워커에도 보내 툴바 배지에 띄운다.
//
// 화면: 오른쪽 가장자리의 작은 탭(점수·판정) → 누르면 오른쪽에서 패널이 열린다.
// 탭은 위아래로 끌어 옮길 수 있고 위치는 기억한다(몰 버튼을 가리지 않게).
// 상세정보는 늦게 그려지는 경우가 많아(탭·스크롤·SPA 이동) DOM 변화를 지켜보며 다시 읽는다.

(async () => {
  if (window.__ansimLoaded) return;
  window.__ansimLoaded = true;
  const core = await import(chrome.runtime.getURL("core/index.js"));
  const DEFAULTS = { profile: { name: "", age: 6, allergies: [], concerns: [] }, backend: "", tabTop: 38 };
  let settings = await chrome.storage.local.get(DEFAULTS);
  const mall = core.detectMall(location.hostname);

  // ── 페이지 읽기
  const text = (n) => (n?.innerText || n?.textContent || "").trim();
  function collectRows() {
    const rows = [];
    for (const tr of document.querySelectorAll("tr")) {
      const cells = tr.querySelectorAll("th, td");
      for (let i = 0; i + 1 < cells.length; i += 2) rows.push([text(cells[i]), text(cells[i + 1])]);
    }
    for (const dt of document.querySelectorAll("dt")) {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === "DD") rows.push([text(dt), text(dd)]);
    }
    return rows;
  }
  function pageTitle() {
    const h = document.querySelector("h1, h2.prod-buy-header__title, [class*='ProductName'], [class*='product_title'], [class*='prod-title']");
    return text(h) || document.title;
  }
  function readNotice() {
    let rows = collectRows();
    if (!rows.some(([k]) => /원재료/.test(k))) {
      const lines = core.rowsFromText(document.body.innerText)
        .filter(([k]) => /원재료|영양|알레르기|알러지|식품\s*의?\s*유형/.test(k));
      rows = [...rows, ...lines];
    }
    // 서버로 보낼 땐 필요한 줄만 — 가격·배송 같은 나머지 표는 보내지 않는다
    rows = rows.filter(([k]) => /원재료|영양|알레르기|알러지|식품\s*의?\s*유형|제품\s*유형|^(제품명|품명|상품명)$/.test(k.trim()));
    return { title: pageTitle(), rows, url: location.href };
  }

  // ── 서버 (선택)
  async function askServer(notice) {
    if (!settings.backend) return null;
    try {
      const res = await fetch(`${settings.backend.replace(/\/$/, "")}/api/ansim/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 판정에 필요한 최소 프로필만(이름 제외)
        body: JSON.stringify({ notice, mall, profile: { ...settings.profile, name: "" } })
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
  let localCatalog = null;
  async function localAlternatives(product, analysis) {
    if (!localCatalog) localCatalog = (await (await fetch(chrome.runtime.getURL("data/sample-catalog.json"))).json()).products;
    return core.rankAlternatives(product, localCatalog, settings.profile, { mall, base: analysis });
  }

  // ── 화면 (Shadow DOM — 쇼핑몰 CSS와 섞이지 않게)
  const host = document.createElement("div");
  host.id = "ansim-scan-root";
  host.style.cssText = "position:fixed;inset:0 0 auto auto;width:0;height:0;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .tab { position: fixed; right: 0; width: 58px; padding: 8px 4px 9px 8px; background: #111416; color: #f2f3f4;
      border-radius: 14px 0 0 14px; box-shadow: -4px 4px 18px rgba(0,0,0,.35); cursor: pointer; text-align: center;
      border: 0; border-left: 4px solid #8a9198; touch-action: none; user-select: none; line-height: 1.15; }
    .tab .k { font-size: 10px; color: #9aa1a8; letter-spacing: .05em; }
    .tab .n { font-size: 21px; font-weight: 900; margin: 2px 0 1px; }
    .tab .v { font-size: 10.5px; font-weight: 700; }
    .tab.green { border-left-color: #34c77b; } .tab.yellow { border-left-color: #f2b632; } .tab.red { border-left-color: #ff5a52; }
    .tab.pulse { animation: pulse 1.2s ease-out 2; }
    @keyframes pulse { 0% { transform: translateX(0); } 30% { transform: translateX(-6px); } 100% { transform: translateX(0); } }
    .panel { position: fixed; top: 0; right: 0; height: 100vh; width: min(380px, 92vw); background: #111416; color: #f2f3f4;
      padding: 16px 16px 28px; overflow-y: auto; font-size: 14px; line-height: 1.5; visibility: hidden;
      transform: translateX(105%); transition: transform .22s ease, visibility 0s linear .22s; }
    .panel.open { transform: translateX(0); visibility: visible; box-shadow: -10px 0 36px rgba(0,0,0,.45); transition: transform .22s ease; }
    .green{color:#34c77b}.yellow{color:#f2b632}.red{color:#ff5a52}.gray{color:#8a9198}
    .top { display: flex; justify-content: space-between; align-items: center; color: #9aa1a8; font-size: 12.5px; }
    .close { background: none; border: 0; color: #9aa1a8; font-size: 22px; cursor: pointer; padding: 0 4px; }
    .word { font-size: 30px; font-weight: 900; margin-top: 6px; }
    .score { font-size: 44px; font-weight: 900; line-height: 1; } .score small { font-size: 16px; color: #6b7279; }
    .muted { color: #9aa1a8; font-size: 12.5px; }
    .reasons { list-style: none; padding: 0; margin: 12px 0 0; }
    .reasons li { padding: 8px 0; border-top: 1px solid #23272a; }
    .reasons li:first-child { border-top: 0; }
    .reasons b.block { color: #ff5a52; }
    .reasons .d { color: #9aa1a8; font-size: 12.5px; margin-top: 2px; }
    .reasons .d a { color: #9aa1a8; }
    .ev { font-size: 10.5px; border: 1px solid #2c3034; border-radius: 5px; padding: 0 5px; margin-left: 4px; color: #9aa1a8; }
    .ev.A { color: #8fd3ff; border-color: #2a4a60; } .ev.B { color: #ffd27a; border-color: #5a4a22; }
    .hl { color: #34c77b; font-size: 12.5px; margin-top: 6px; }
    ul.notes { margin: 8px 0 0; padding-left: 16px; color: #9aa1a8; font-size: 12.5px; }
    h4 { margin: 18px 0 6px; font-size: 15px; } h4 b { color: #34c77b; }
    .alt { background: #1b1e21; border-radius: 12px; padding: 11px; margin-top: 8px; }
    .alt ul { margin: 6px 0; padding-left: 16px; color: #c4c9ce; font-size: 13px; }
    .alt a { display: inline-block; margin: 4px 6px 0 0; background: #2a2e32; color: #f2f3f4; text-decoration: none; font-weight: 700; border-radius: 8px; padding: 6px 10px; font-size: 13px; }
    .alt a.first { background: #34c77b; color: #06210f; }
    .tag { font-size: 10.5px; color: #f2b632; border: 1px solid #5a4a22; border-radius: 5px; padding: 0 5px; margin-left: 4px; }
    .foot { margin-top: 18px; color: #6b7279; font-size: 11.5px; }
  </style>
  <button class="tab" id="tab" aria-label="안심스캔 점수"><div class="k">안심</div><div class="n">…</div><div class="v gray">확인 중</div></button>
  <aside class="panel" id="panel" aria-label="안심스캔 상세"></aside>`;
  const $tab = root.getElementById("tab");
  const $panel = root.getElementById("panel");
  const placeTab = () => { $tab.style.top = `${Math.min(88, Math.max(4, settings.tabTop))}vh`; };
  placeTab();

  // 탭: 누르면 패널, 끌면 위아래 이동 (5px 넘게 움직이면 끌기로 본다)
  let drag = null;
  $tab.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, moved: false }; $tab.setPointerCapture(e.pointerId); });
  $tab.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) { settings.tabTop = (e.clientY / window.innerHeight) * 100 - 4; placeTab(); }
  });
  $tab.addEventListener("pointerup", () => {
    if (drag?.moved) chrome.storage.local.set({ tabTop: settings.tabTop });
    else togglePanel(true);
    drag = null;
  });
  const togglePanel = (open) => $panel.classList.toggle("open", open);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") togglePanel(false); });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 서버가 돌려준 링크라도 http(s)만 — javascript: 같은 스킴은 막는다
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "#");

  function setTab(score, label, tone) {
    $tab.className = `tab ${tone}`;
    $tab.innerHTML = `<div class="k">안심</div><div class="n ${tone}">${esc(score)}</div><div class="v ${tone}">${esc(label)}</div>`;
  }
  function bindClose() { root.getElementById("x").onclick = () => togglePanel(false); }

  function renderWaiting() {
    setTab("?", "원재료", "gray");
    $panel.innerHTML = `<div class="top"><span>안심스캔</span><button class="close" id="x" aria-label="닫기">×</button></div>
      <h4>원재료 정보를 찾는 중이에요</h4>
      <p class="muted">상세정보 탭을 열거나 '필수 표기정보'까지 스크롤하면 바로 점수가 나와요.
      한 번 읽은 상품은 다음부터 표를 안 펼쳐도 점수가 떠요(서버 연결 시).</p>
      <p class="muted">원재료가 상세 이미지에만 있는 상품은 안심스캔 앱의 '라벨 사진 찍기'를 써 주세요.</p>`;
    bindClose();
  }

  function render(product, analysis, alternatives) {
    const tone = analysis.verdict.tone;
    const blocked = analysis.verdict.code === "block";
    const shownScore = blocked || analysis.score == null ? "–" : analysis.score;
    setTab(shownScore, analysis.verdict.label, tone);
    chrome.runtime.sendMessage({ type: "ansim:score", score: shownScore, tone }).catch(() => {});

    const p = settings.profile;
    const reasons = analysis.reasons.map((r) => `<li><b class="${r.block ? "block" : ""}">${esc(r.title)}</b>${r.evidence && r.evidence !== "info" ? `<span class="ev ${r.evidence}">근거 ${r.evidence}</span>` : ""}
      <div class="d">${esc(r.detail)}${r.source ? ` · <a href="${safeUrl(r.source.url)}" target="_blank" rel="noopener">출처</a>` : ""}</div></li>`).join("");
    const alts = alternatives.map((a) => `<div class="alt"><b>${esc(a.product.name)}</b> <span class="green">${esc(a.analysis.score)}점</span>${a.product.sample ? `<span class="tag">가상 예시</span>` : ""}
        <ul>${a.improvements.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        ${a.links.slice(0, 2).map((l, i) => `<a class="${i === 0 ? "first" : ""}" href="${safeUrl(l.url)}" target="_blank" rel="noopener">${esc(l.label)}에서 ${l.kind === "direct" ? "보기" : "찾기"}</a>`).join("")}</div>`).join("");
    $panel.innerHTML = `<div class="top"><span>안심스캔 · ${p.age < 1 ? "돌 전" : `${esc(p.age)}세`}${p.allergies.length ? ` · 알레르기 ${p.allergies.length}` : ""} 기준</span><button class="close" id="x" aria-label="닫기">×</button></div>
      <div class="word ${tone}">${esc(analysis.verdict.label)}</div>
      <div class="score ${tone}">${esc(shownScore)}<small>/100</small></div>
      ${blocked && analysis.score != null ? `<div class="muted">아이에게 맞지 않는 성분 포함 · 일반 점수 ${esc(analysis.score)}</div>` : ""}
      <div class="muted">${esc(product.name)}</div>
      ${reasons ? `<ul class="reasons">${reasons}</ul>` : `<p class="green">걸리는 항목이 없어요</p>`}
      ${analysis.highlights.length ? `<div class="hl">${analysis.highlights.map(esc).join(" · ")}</div>` : ""}
      ${analysis.notes.length ? `<ul class="notes">${analysis.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <h4>${alternatives.length ? `<b>${alternatives.length}개</b> ${alternatives[0].tier === "good" ? "더 안전한 선택" : "그나마 나은 선택"}` : "대체품"}</h4>
      ${alts || `<p class="muted">${analysis.verdict.code === "good" ? "이미 좋은 선택이에요." : "같은 종류의 대체품을 아직 찾지 못했어요."}</p>`}
      <div class="foot">근거 A 규제기관·국제기구 기준 · B 경고 표시 의무·일관된 연구 · C 근거 제한적. 의학적 진단이 아니며 점수와 대체품 순위는 광고·제휴와 무관합니다.</div>`;
    bindClose();
    // 나쁜 판정이면 탭을 살짝 흔들어 알린다(패널을 강제로 열진 않는다 — 쇼핑을 막지 않게)
    if (blocked || analysis.verdict.code === "avoid") { $tab.classList.remove("pulse"); void $tab.offsetWidth; $tab.classList.add("pulse"); }
  }

  // ── 실행 루프
  let lastKey = "";
  let busy = false;
  let again = false;   // 서버 응답을 기다리는 사이 표가 나타나면, 끝난 뒤 한 번 더 읽는다
  async function evaluate() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const notice = readNotice();
      const product = core.noticeToProduct(notice);
      const key = `${location.href}|${product.ingredientsText}|${product.nutritionText}|${JSON.stringify(settings.profile)}|${settings.backend}`;
      if (key === lastKey) return;
      lastKey = key;
      if (product.ingredientsText || product.nutritionText) {
        const analysis = core.analyzeProduct(product, settings.profile);
        render(product, analysis, []);
        const server = await askServer(notice);
        render(product, analysis, server?.alternatives || await localAlternatives(product, analysis));
        return;
      }
      // 표가 아직 안 보임 — 서버가 이 상품을 기억하고 있으면 그걸로
      const server = await askServer(notice);
      if (server && server.analysis?.score != null) render(server.product, server.analysis, server.alternatives || []);
      else renderWaiting();
    } finally {
      busy = false;
      if (again) { again = false; setTimeout(evaluate, 0); }
    }
  }

  document.documentElement.append(host);
  renderWaiting();
  await evaluate();
  // 디바운스가 아니라 스로틀 — 캐러셀처럼 DOM이 계속 바뀌는 페이지에선 디바운스가 영영 안 터진다
  let timer = null;
  new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; evaluate(); }, 1500);
  }).observe(document.body, { childList: true, subtree: true });
  // SPA 이동(네이버·컬리): URL이 바뀌면 이전 상품 화면을 지우고 새로 읽는다
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    lastKey = "";
    togglePanel(false);
    renderWaiting();
    setTimeout(evaluate, 1500);
  }, 1000);
  chrome.storage.onChanged.addListener(async (changes) => {
    settings = await chrome.storage.local.get(DEFAULTS);
    placeTab();
    if (Object.keys(changes).every((k) => k === "tabTop")) return;   // 탭 위치만 바뀐 건 다시 판정할 일이 아님
    lastKey = "";
    evaluate();
  });
})();
