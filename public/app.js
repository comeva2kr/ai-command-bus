// Frontend controller: builds the filter UI from /api/meta, runs searches, and
// renders results + a lightweight canvas map. No external dependencies.

const state = {
  meta: null,
  selected: {
    styles: new Set(),
    cuisines: new Set(),
    menuAttrs: new Set(),
    tagsAll: new Set(),
    excludeTags: new Set(),
    features: new Set()
  }
};

const $ = (id) => document.getElementById(id);

function chipGroup(containerId, items, set) {
  const el = $(containerId);
  el.innerHTML = "";
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item;
    chip.onclick = () => {
      if (set.has(item)) { set.delete(item); chip.classList.remove("on"); }
      else { set.add(item); chip.classList.add("on"); }
    };
    el.appendChild(chip);
  }
}

async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  const m = state.meta;

  $("near").innerHTML = m.landmarks.map((l) => `<option value="${l}">${l}</option>`).join("");
  $("menu").insertAdjacentHTML(
    "beforeend",
    m.menus.map((x) => `<option value="${x}">${x}</option>`).join("")
  );

  chipGroup("styles", m.styles, state.selected.styles);
  chipGroup("cuisines", m.cuisines, state.selected.cuisines);
  chipGroup("menuAttrs", m.menuAttrs, state.selected.menuAttrs);
  chipGroup("tagsAll", m.tags, state.selected.tagsAll);
  chipGroup("excludeTags", m.tags, state.selected.excludeTags);
  chipGroup("features", m.features, state.selected.features);

  const presetBox = $("presets");
  presetBox.innerHTML = "";
  for (const [key, label] of Object.entries(m.presets)) {
    const b = document.createElement("button");
    b.className = "preset";
    b.textContent = label;
    b.onclick = () => runPreset(key);
    presetBox.appendChild(b);
  }

  $("minutes").oninput = (e) => ($("minsOut").textContent = e.target.value);
  const syncPrice = () => {
    let lo = +$("priceMin").value, hi = +$("priceMax").value;
    if (lo > hi) [lo, hi] = [hi, lo];
    $("priceOut").textContent = `${lo} ~ ${hi}`;
  };
  $("priceMin").oninput = syncPrice;
  $("priceMax").oninput = syncPrice;
  $("searchBtn").onclick = runManual;

  runPreset("kids-pork");
}

function buildQuery() {
  const s = state.selected;
  const q = {
    styles: [...s.styles],
    cuisines: [...s.cuisines],
    menuAttrs: [...s.menuAttrs],
    tagsAll: [...s.tagsAll],
    excludeTags: [...s.excludeTags],
    require: Object.fromEntries([...s.features].map((f) => [f, true])),
    excludeFranchise: $("excludeFranchise").checked,
    priceMin: Math.min(+$("priceMin").value, +$("priceMax").value),
    priceMax: Math.max(+$("priceMin").value, +$("priceMax").value)
  };
  if ($("menu").value) q.menu = $("menu").value;
  if ($("useLocation").checked) {
    q.location = { near: $("near").value };
    q.travel = { mode: $("mode").value, minutes: +$("minutes").value };
  }
  return q;
}

async function runManual() {
  const q = buildQuery();
  const data = await (await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(q)
  })).json();
  render(data);
}

async function runPreset(name) {
  const data = await (await fetch("/api/preset?name=" + encodeURIComponent(name))).json();
  render(data);
}

function render(data) {
  const meta = data.meta || {};
  const parts = [`검증 맛집 ${meta.total}곳`];
  if (meta.origin) {
    parts.push(`기준 반경 ${meta.radiusKm}km (${meta.travelMode})`);
  }
  parts.push(meta.verifiedOnly ? "광고/협찬 제외됨" : "미검증 포함");
  $("meta").textContent = parts.join(" · ");

  drawMap(data.results, meta.origin);

  const list = $("list");
  if (!data.results.length) {
    list.innerHTML = `<div class="empty">조건에 맞는 검증된 맛집이 없어요. 필터를 완화해 보세요.</div>`;
    return;
  }
  list.innerHTML = data.results.map(cardHtml).join("");
}

const VERDICT_CLASS = { "찐맛집": "v-gem", "검증됨": "v-ok" };
const FACTOR_LABEL = {
  behavior: "행동데이터", diversity: "작성자다양", local: "로컬·재방문",
  classBreadth: "소스교차", sustain: "지속성", realism: "평점현실성", texture: "후기구체성"
};

function cardHtml(r) {
  const badges = [];
  const vcls = VERDICT_CLASS[r.verdict] || "v-mid";
  badges.push(`<span class="badge verdict ${vcls}">${r.verdict === "찐맛집" ? "🔥 " : "✔ "}${r.verdict} ${r.authenticityScore}</span>`);
  if (r.distanceKm != null) {
    badges.push(`<span class="badge dist">${r.distanceKm}km · ${r.travelMinutes}분</span>`);
  }
  badges.push(`<span class="badge">${"₩".repeat(r.priceBand)}</span>`);
  badges.push(`<span class="badge">⭐ ${r.rating}</span>`);
  if (r.franchise) badges.push(`<span class="badge">프랜차이즈</span>`);

  const feats = Object.entries(r.features || {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const menus = (r.menus || []).map((m) =>
    m.attrs?.length ? `${m.name}(${m.attrs.join(",")})` : m.name
  );

  // Explainable authenticity: factor bars + reasons.
  const bars = Object.entries(r.breakdown || {})
    .map(([k, v]) => `<div class="fbar"><span>${FACTOR_LABEL[k] || k}</span>
      <i style="--w:${v}%"></i><b>${v}</b></div>`)
    .join("");
  const reasons = (r.reasons || [])
    .map((x) => `<li>${x}</li>`)
    .join("");
  const filtered = r.signals?.paidFiltered
    ? `<div class="filtered">🚫 협찬/광고 ${r.signals.paidFiltered}건 제외 · 독립 플랫폼 ${r.signals.platformCount}곳 · 작성자 ${r.signals.uniqueAuthors}명 교차검증</div>`
    : "";

  return `<article class="rc">
    <h3>${r.name}</h3>
    <div class="addr">${r.style} · ${r.address}</div>
    <div class="badges">${badges.join("")}</div>
    <div class="taglist">🍴 ${menus.join(" · ") || "-"}</div>
    <div class="taglist">🏷️ ${(r.tags || []).join(" · ") || "-"}</div>
    <div class="taglist">🧩 ${feats.join(" · ") || "-"}</div>
    <details class="why"><summary>왜 검증됐나? (판별 근거)</summary>
      <div class="fbars">${bars}</div>
      <ul class="reasons">${reasons}</ul>
      ${filtered}
    </details>
  </article>`;
}

function drawMap(results, origin) {
  const cv = $("map");
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const pts = results.filter((r) => r.lat && r.lng);
  const all = origin ? [origin, ...pts] : pts;
  if (!all.length) return;

  const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * 0.15 || 0.01;
  const padLng = (maxLng - minLng) * 0.15 || 0.01;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  const X = (lng) => ((lng - minLng) / (maxLng - minLng)) * (cv.width - 30) + 15;
  const Y = (lat) => cv.height - (((lat - minLat) / (maxLat - minLat)) * (cv.height - 30) + 15);

  if (origin) {
    ctx.fillStyle = "#4dd0a7";
    ctx.beginPath();
    ctx.arc(X(origin.lng), Y(origin.lat), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "12px sans-serif";
    ctx.fillText("기준", X(origin.lng) + 10, Y(origin.lat) + 4);
  }
  pts.forEach((p, i) => {
    ctx.fillStyle = "#ff7a59";
    ctx.beginPath();
    ctx.arc(X(p.lng), Y(p.lat), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8eaed";
    ctx.font = "11px sans-serif";
    ctx.fillText(String(i + 1), X(p.lng) - 3, Y(p.lat) - 9);
  });
}

init();
