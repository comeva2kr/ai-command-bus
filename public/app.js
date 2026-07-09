// User-facing controller (mobile-first). Builds filter UI from /api/meta, runs
// searches, renders result cards, and drives bottom sheets. No dependencies.

const state = {
  meta: null,
  mode: "verified", // verified | all
  location: null, // { near } | { lat, lng }
  sel: {
    styles: new Set(), cuisines: new Set(), menuAttrs: new Set(),
    tagsAll: new Set(), excludeTags: new Set(), features: new Set()
  },
  lastData: null
};

const $ = (id) => document.getElementById(id);

/* ---------- bottom sheets ---------- */
function openSheet(id) {
  $("backdrop").hidden = false;
  const s = $(id);
  s.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => s.classList.add("open"));
}
function closeSheets() {
  document.querySelectorAll(".sheet.open").forEach((s) => {
    s.classList.remove("open");
    s.setAttribute("aria-hidden", "true");
  });
  $("backdrop").hidden = true;
}

/* ---------- chips ---------- */
function chipGroup(containerId, items, set, onChange) {
  const el = $(containerId);
  el.innerHTML = "";
  for (const item of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (set.has(item) ? " on" : "");
    chip.textContent = item;
    chip.onclick = () => {
      if (set.has(item)) { set.delete(item); chip.classList.remove("on"); }
      else { set.add(item); chip.classList.add("on"); }
      onChange && onChange();
    };
    el.appendChild(chip);
  }
}

function filterCount() {
  const s = state.sel;
  let n = s.styles.size + s.cuisines.size + s.menuAttrs.size + s.tagsAll.size +
    s.excludeTags.size + s.features.size;
  if ($("menu").value) n++;
  if ($("excludeFranchise").checked) n++;
  if (+$("priceMin").value > 1 || +$("priceMax").value < 4) n++;
  const badge = $("filterBadge");
  badge.hidden = n === 0;
  badge.textContent = n;
}

/* ---------- init ---------- */
async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  const m = state.meta;

  $("near").innerHTML = m.landmarks.map((l) => `<option value="${l}">${l}</option>`).join("");
  $("menu").insertAdjacentHTML("beforeend", m.menus.map((x) => `<option>${x}</option>`).join(""));

  chipGroup("styles", m.styles, state.sel.styles, filterCount);
  chipGroup("cuisines", m.cuisines, state.sel.cuisines, filterCount);
  chipGroup("menuAttrs", m.menuAttrs, state.sel.menuAttrs, filterCount);
  chipGroup("tagsAll", m.tags, state.sel.tagsAll, filterCount);
  chipGroup("excludeTags", m.tags, state.sel.excludeTags, filterCount);
  chipGroup("features", m.features, state.sel.features, filterCount);

  const pbox = $("presets");
  pbox.innerHTML = "";
  for (const [key, label] of Object.entries(m.presets)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = label;
    b.onclick = () => runPreset(key);
    pbox.appendChild(b);
  }

  // events
  $("openFilter").onclick = () => openSheet("sheetFilter");
  $("locChip").onclick = () => openSheet("sheetLoc");
  $("toggleMap").onclick = () => { drawMap(); openSheet("sheetMap"); };
  $("backdrop").onclick = closeSheets;
  document.querySelectorAll(".sheet-grip").forEach((g) => (g.onclick = closeSheets));

  $("minutes").oninput = (e) => ($("minsOut").textContent = e.target.value);
  const priceSync = () => {
    let lo = +$("priceMin").value, hi = +$("priceMax").value;
    if (lo > hi) [lo, hi] = [hi, lo];
    $("priceOut").textContent = `${"₩".repeat(lo)} ~ ${"₩".repeat(hi)}`;
    filterCount();
  };
  $("priceMin").oninput = priceSync;
  $("priceMax").oninput = priceSync;
  $("menu").onchange = filterCount;
  $("excludeFranchise").onchange = filterCount;

  $("applyFilter").onclick = () => { closeSheets(); runManual(); };
  $("resetFilter").onclick = resetFilters;
  $("applyLoc").onclick = () => { closeSheets(); syncLocLabel(); runManual(); };
  $("useGeo").onclick = useGeolocation;

  $("verifiedSeg").querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      state.mode = btn.dataset.mode;
      $("verifiedSeg").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("on", b === btn));
      rerun();
    };
  });

  syncLocLabel();
  runPreset("kids-pork");
}

function resetFilters() {
  for (const k of Object.keys(state.sel)) state.sel[k].clear();
  const m = state.meta;
  chipGroup("styles", m.styles, state.sel.styles, filterCount);
  chipGroup("cuisines", m.cuisines, state.sel.cuisines, filterCount);
  chipGroup("menuAttrs", m.menuAttrs, state.sel.menuAttrs, filterCount);
  chipGroup("tagsAll", m.tags, state.sel.tagsAll, filterCount);
  chipGroup("excludeTags", m.tags, state.sel.excludeTags, filterCount);
  chipGroup("features", m.features, state.sel.features, filterCount);
  $("menu").value = ""; $("excludeFranchise").checked = false;
  $("priceMin").value = 1; $("priceMax").value = 4;
  $("priceOut").textContent = "₩ ~ ₩₩₩₩";
  filterCount();
}

/* ---------- location ---------- */
function syncLocLabel() {
  if (!$("useLocation").checked) { state.location = null; $("locLabel").textContent = "위치 필터 끔"; return; }
  if (state.location && state.location.lat != null) {
    $("locLabel").textContent = `현재위치 · ${$("mode").value === "car" ? "차" : $("mode").value} ${$("minutes").value}분`;
  } else {
    state.location = { near: $("near").value };
    $("locLabel").textContent = `${$("near").value} · ${modeLabel()} ${$("minutes").value}분`;
  }
}
function modeLabel() {
  return { car: "차", transit: "대중교통", bike: "자전거", walk: "도보" }[$("mode").value] || "차";
}
function useGeolocation() {
  if (!navigator.geolocation) { alert("이 기기에서 위치를 사용할 수 없어요."); return; }
  $("useGeo").textContent = "위치 확인 중…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("useGeo").textContent = "📍 현재 위치 사용됨 ✓";
      $("useLocation").checked = true;
    },
    () => { $("useGeo").textContent = "📍 내 현재 위치 사용"; alert("위치 권한이 필요해요."); }
  );
}

/* ---------- query build + run ---------- */
function buildQuery() {
  const s = state.sel;
  const q = {
    styles: [...s.styles], cuisines: [...s.cuisines], menuAttrs: [...s.menuAttrs],
    tagsAll: [...s.tagsAll], excludeTags: [...s.excludeTags],
    require: Object.fromEntries([...s.features].map((f) => [f, true])),
    excludeFranchise: $("excludeFranchise").checked,
    priceMin: Math.min(+$("priceMin").value, +$("priceMax").value),
    priceMax: Math.max(+$("priceMin").value, +$("priceMax").value),
    includeUnverified: state.mode === "all"
  };
  if ($("menu").value) q.menu = $("menu").value;
  if ($("useLocation").checked) {
    q.location = state.location && state.location.lat != null ? state.location : { near: $("near").value };
    q.travel = { mode: $("mode").value, minutes: +$("minutes").value };
  }
  return q;
}

let lastRun = null;
async function runManual() {
  lastRun = { type: "manual" };
  const data = await post("/api/search", buildQuery());
  render(data);
}
async function runPreset(name) {
  lastRun = { type: "preset", name };
  const extra = state.mode === "all" ? "&all=1" : "";
  const data = await (await fetch(`/api/preset?name=${encodeURIComponent(name)}${extra}`)).json();
  render(data);
}
function rerun() {
  if (lastRun?.type === "preset") runPreset(lastRun.name);
  else runManual();
}
async function post(url, body) {
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
}

/* ---------- render ---------- */
const VCLASS = { "찐맛집": "v-gem", "검증됨": "v-ok" };
const FLABEL = { behavior: "행동데이터", diversity: "작성자다양", local: "로컬·재방문", classBreadth: "소스교차", sustain: "지속성", realism: "평점현실성", texture: "후기구체성" };

function render(data) {
  state.lastData = data;
  const meta = data.meta || {};
  const parts = [`${meta.total}곳`];
  if (meta.origin) parts.push(`반경 ${meta.radiusKm}km`);
  parts.push(meta.verifiedOnly ? "광고·가짜 제외" : "전체 표시");
  $("count").textContent = parts.join(" · ");
  drawMap();

  const list = $("list");
  if (!data.results.length) {
    list.innerHTML = `<div class="empty">조건에 맞는 ${meta.verifiedOnly ? "검증된 " : ""}맛집이 없어요.<br>필터를 완화하거나 반경을 늘려보세요.</div>`;
    return;
  }
  list.innerHTML = data.results.map(card).join("");
}

function card(r) {
  const verified = r.verified;
  const vcls = VCLASS[r.verdict] || "v-bad";
  const metrics = [];
  if (r.distanceKm != null) metrics.push(`<span class="metric dist">${r.distanceKm}km · ${r.travelMinutes}분</span>`);
  metrics.push(`<span class="metric score">진위 ${r.authenticityScore}</span>`);
  metrics.push(`<span class="metric">${"₩".repeat(r.priceBand)}</span>`);
  metrics.push(`<span class="metric">⭐ ${r.rating}</span>`);
  if (r.franchise) metrics.push(`<span class="metric">프랜차이즈</span>`);

  const menus = (r.menus || []).map((m) => m.attrs?.length ? `${m.name}(${m.attrs.join(",")})` : m.name);
  const feats = Object.entries(r.features || {}).filter(([, v]) => v).map(([k]) => k);
  const bars = Object.entries(r.breakdown || {})
    .map(([k, v]) => `<div class="fbar"><span>${FLABEL[k] || k}</span><i style="--w:${v}%"></i><b>${v}</b></div>`).join("");
  const reasons = (r.reasons || []).map((x) => `<li>${x}</li>`).join("");

  return `<article class="rc${verified ? "" : " bad"}">
    <div class="rc-top">
      <div><h3>${r.name}</h3><div class="addr">${r.style} · ${r.address}</div></div>
      <span class="verdict ${vcls}">${r.verdict === "찐맛집" ? "🔥 " : verified ? "✔ " : "⚠ "}${r.verdict}</span>
    </div>
    <div class="metrics">${metrics.join("")}</div>
    <div class="taglist">🍴 <b>${menus.join(" · ") || "-"}</b></div>
    <div class="taglist">🏷️ ${(r.tags || []).join(" · ") || "-"}</div>
    <div class="taglist">🧩 ${feats.join(" · ") || "-"}</div>
    <details class="why"><summary>판별 근거 보기</summary>
      <div class="fbars">${bars}</div>
      <ul class="reasons">${reasons}</ul>
    </details>
  </article>`;
}

/* ---------- canvas map ---------- */
function drawMap() {
  const data = state.lastData;
  const cv = $("map");
  if (!cv || !data) return;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const origin = data.meta?.origin;
  const pts = (data.results || []).filter((r) => r.lat && r.lng);
  const all = origin ? [origin, ...pts] : pts;
  $("mapMeta").textContent = origin
    ? `기준(초록) 반경 ${data.meta.radiusKm}km 내 ${pts.length}곳`
    : `${pts.length}곳 (위치 필터 없음)`;
  if (!all.length) return;

  const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 0.15;
  const dLat = (maxLat - minLat) || 0.01, dLng = (maxLng - minLng) || 0.01;
  minLat -= dLat * pad; maxLat += dLat * pad; minLng -= dLng * pad; maxLng += dLng * pad;
  const X = (lng) => ((lng - minLng) / (maxLng - minLng)) * (cv.width - 40) + 20;
  const Y = (lat) => cv.height - (((lat - minLat) / (maxLat - minLat)) * (cv.height - 40) + 20);

  if (origin) {
    ctx.fillStyle = "#4dd0a7";
    ctx.beginPath(); ctx.arc(X(origin.lng), Y(origin.lat), 9, 0, 7); ctx.fill();
  }
  pts.forEach((p, i) => {
    ctx.fillStyle = p.verdict === "찐맛집" ? "#ffb057" : "#ff7a59";
    ctx.beginPath(); ctx.arc(X(p.lng), Y(p.lat), 7, 0, 7); ctx.fill();
    ctx.fillStyle = "#eef1f5"; ctx.font = "12px sans-serif";
    ctx.fillText(String(i + 1), X(p.lng) - 3, Y(p.lat) - 11);
  });
}

init();
