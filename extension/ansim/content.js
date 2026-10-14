// 안심스캔 확장 — 쇼핑몰 식품 상세 페이지에 아이 기준 점수와 대체품을 띄운다.
//
// 흐름:
//   1. 상품정보제공고시 표(원재료명·영양성분·알레르기)를 읽는다 — 몰마다 마크업은
//      달라도 결국 th/td, dt/dd 키-값 쌍이다. 없으면 본문 텍스트의 "원재료명 : …" 줄.
//   2. 점수는 이 확장 안의 core(서버와 같은 코드)로 계산한다 — 아이 프로필이
//      기기 밖으로 나가지 않는다.
//   3. 대체품: 설정에 서버 주소가 있으면 서버 카탈로그, 없으면 내장 예시 카탈로그.
//      구매 링크는 지금 보고 있는 몰을 맨 앞에 둔다.
//
// 상세정보는 늦게 그려지는 경우가 많아(탭·스크롤·SPA 이동) DOM 변화를 지켜보며
// 다시 읽는다.

(async () => {
  const core = await import(chrome.runtime.getURL("core/index.js"));
  const DEFAULTS = { profile: { name: "", age: 6, allergies: [], concerns: [] }, backend: "" };
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
    const h = document.querySelector("h1, h2.prod-buy-header__title, [class*='ProductName'], [class*='product_title']");
    return text(h) || document.title;
  }
  function readProduct() {
    const rows = collectRows();
    let product = core.noticeToProduct({ title: pageTitle(), rows, url: location.href });
    if (!product.ingredientsText) {
      const lines = core.rowsFromText(document.body.innerText)
        .filter(([k]) => /원재료|영양|알레르기|알러지|식품\s*의?\s*유형/.test(k));
      if (lines.length) product = core.noticeToProduct({ title: pageTitle(), rows: [...rows, ...lines], url: location.href });
    }
    return product;
  }

  // ── 대체품
  let localCatalog = null;
  async function alternativesFor(product, analysis) {
    if (settings.backend) {
      try {
        const res = await fetch(`${settings.backend.replace(/\/$/, "")}/api/ansim/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // 서버에는 제품 정보와 판정에 필요한 최소 프로필만 보낸다(이름 제외)
          body: JSON.stringify({ product, mall, profile: { ...settings.profile, name: "" } })
        });
        if (res.ok) return (await res.json()).alternatives || [];
      } catch {}
    }
    if (!localCatalog) {
      localCatalog = (await (await fetch(chrome.runtime.getURL("data/sample-catalog.json"))).json()).products;
    }
    return core.rankAlternatives(product, localCatalog, settings.profile, { mall, base: analysis });
  }

  // ── 화면 (Shadow DOM — 쇼핑몰 CSS와 섞이지 않게)
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .pill { display:flex; align-items:center; gap:8px; background:#111416; color:#f2f3f4; border-radius:999px; padding:8px 14px;
      box-shadow:0 6px 24px rgba(0,0,0,.35); cursor:pointer; font-size:14px; font-weight:700; border:0; }
    .pill b { font-size:18px; }
    .panel { width:340px; max-height:72vh; overflow:auto; background:#111416; color:#f2f3f4; border-radius:16px;
      box-shadow:0 10px 36px rgba(0,0,0,.45); padding:16px; margin-bottom:8px; font-size:14px; line-height:1.5; }
    .green{color:#34c77b}.yellow{color:#f2b632}.red{color:#ff5a52}.gray{color:#8a9198}
    .word { font-size:28px; font-weight:900; }
    .score { font-size:40px; font-weight:900; line-height:1; } .score small { font-size:15px; color:#6b7279; }
    .muted { color:#9aa1a8; font-size:12.5px; }
    ul { margin:8px 0; padding-left:18px; } li { margin:3px 0; }
    .ev { font-size:10.5px; border:1px solid #2c3034; border-radius:5px; padding:0 5px; margin-left:4px; color:#9aa1a8; }
    h4 { margin:14px 0 6px; font-size:14px; }
    .alt { background:#1b1e21; border-radius:12px; padding:10px; margin-top:8px; }
    .alt a { display:inline-block; margin-top:6px; background:#34c77b; color:#06210f; text-decoration:none; font-weight:700; border-radius:8px; padding:5px 10px; font-size:13px; }
    .tag { font-size:10.5px; color:#f2b632; border:1px solid #5a4a22; border-radius:5px; padding:0 5px; margin-left:4px; }
    .close { float:right; background:none; border:0; color:#9aa1a8; font-size:18px; cursor:pointer; }
  </style><div class="panel" id="panel" hidden></div><button class="pill" id="pill">안심스캔 …</button>`;
  const $panel = root.getElementById("panel");
  const $pill = root.getElementById("pill");
  $pill.onclick = () => { $panel.hidden = !$panel.hidden; };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 서버가 돌려준 링크라도 http(s)만 — javascript: 같은 스킴은 막는다
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "#");

  function renderWaiting() {
    $pill.innerHTML = `안심스캔 <span class="gray">원재료 찾는 중</span>`;
    $panel.innerHTML = `<button class="close" id="x">×</button><b>원재료 정보를 찾는 중이에요</b>
      <p class="muted">상세정보 탭을 열거나 아래 '필수 표기정보'까지 스크롤하면 읽을 수 있어요. 원재료가 상세 이미지에만 있는 상품은 안심스캔 앱의 '라벨 사진 찍기'를 이용해 주세요.</p>`;
    root.getElementById("x").onclick = () => { $panel.hidden = true; };
  }

  function render(product, analysis, alternatives) {
    const tone = analysis.verdict.tone;
    const shownScore = analysis.verdict.code === "block" ? "–" : analysis.score ?? "–";
    $pill.innerHTML = `안심 <b class="${tone}">${shownScore}</b> <span class="${tone}">${esc(analysis.verdict.label)}</span>`;
    const reasons = analysis.reasons.slice(0, 5).map((r) =>
      `<li>${esc(r.title)}${r.evidence && r.evidence !== "info" ? `<span class="ev">근거 ${r.evidence}</span>` : ""}</li>`).join("");
    const alts = alternatives.map((a) => `<div class="alt"><b>${esc(a.product.name)}</b> <span class="green">${a.analysis.score}점</span>
        ${a.product.sample ? `<span class="tag">가상 예시</span>` : ""}
        <ul>${a.improvements.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        <a href="${safeUrl(a.links[0]?.url)}" target="_blank" rel="noopener">${esc(a.links[0]?.label)}에서 ${a.links[0]?.kind === "direct" ? "보기" : "찾기"}</a></div>`).join("");
    const p = settings.profile;
    $panel.innerHTML = `<button class="close" id="x">×</button>
      <div class="word ${tone}">${esc(analysis.verdict.label)}</div>
      <div class="score ${tone}">${shownScore}<small>/100</small></div>
      <div class="muted">${esc(product.name)}</div>
      <div class="muted">${p.age < 1 ? "돌 전" : `${p.age}세`}${p.allergies.length ? ` · 알레르기 ${p.allergies.length}` : ""} 기준</div>
      ${reasons ? `<ul>${reasons}</ul>` : `<p class="green">걸리는 항목이 없어요</p>`}
      ${analysis.highlights.length ? `<div class="green muted">${analysis.highlights.map(esc).join(" · ")}</div>` : ""}
      <h4>${alternatives.length ? (alternatives[0].tier === "good" ? "더 안전한 선택" : "그나마 나은 선택") : "대체품"}</h4>
      ${alts || `<p class="muted">${analysis.verdict.code === "good" ? "이미 좋은 선택이에요." : "같은 종류의 대체품을 아직 찾지 못했어요."}</p>`}
      <p class="muted">근거 A·B·C는 규제기관 기준 → 제한적 연구 순입니다. 의학적 진단이 아니며 점수는 광고·제휴와 무관합니다.</p>`;
    root.getElementById("x").onclick = () => { $panel.hidden = true; };
    if (analysis.verdict.code === "block" || analysis.verdict.code === "avoid") $panel.hidden = false;
  }

  // ── 실행 루프
  let lastKey = "";
  let busy = false;
  async function evaluate() {
    if (busy) return;
    busy = true;
    try {
      const product = readProduct();
      if (!product.ingredientsText && !product.nutritionText) { if (!lastKey) renderWaiting(); return; }
      const key = `${location.href}|${product.ingredientsText}|${product.nutritionText}|${JSON.stringify(settings.profile)}`;
      if (key === lastKey) return;
      lastKey = key;
      const analysis = core.analyzeProduct(product, settings.profile);
      render(product, analysis, []);
      render(product, analysis, await alternativesFor(product, analysis));
    } finally {
      busy = false;
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
  chrome.storage.onChanged.addListener(async () => { settings = await chrome.storage.local.get(DEFAULTS); lastKey = ""; evaluate(); });
})();
