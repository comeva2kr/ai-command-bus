// 찐맛집 user app. Naver Map = place source (deep-link out); our layer = verified
// curation, shown in human language. Filter reworked to CatchTable-grade after
// adversarial user review: one instant-apply filter sheet (no dual rule),
// multi-select categories, situation presets, applied-chip summary, live count,
// and smart zero-result relaxation.

const state = {
  meta: null, mode: "verified", gemOnly: false, sort: "trust",
  cats: new Set(), location: null, situation: null,
  sel: { cuisines: new Set(), tags: new Set(), features: new Set(), menuAttrs: new Set(), priceBands: new Set() },
  prefer: [], preferFeatures: [], last: null
};
const $ = (id) => document.getElementById(id);

const CAT = { "고깃집": ["🥩", "#fce8e6"], "이자카야": ["🏮", "#e8f0ff"], "횟집": ["🐟", "#e2f6f4"], "한식당": ["🍚", "#fff3e0"], "카페": ["☕", "#efe9e2"], "양식": ["🍝", "#fdeede"], "중식": ["🥟", "#fde6e6"], "분식": ["🍢", "#ffeaf0"] };
const catOf = (s) => CAT[s] || ["🍽️", "#eef1f4"];
const FEATURE_LABEL = { kidsCafe: "🧸 키즈카페(놀이방)", kidFriendly: "👶 아이 데려가기 좋음", partition: "🚪 파티션·룸", privateRoom: "🛋️ 룸 있음", parking: "🅿️ 주차", reservable: "📞 예약 가능", soloFriendly: "🍽️ 혼밥 좋음", petFriendly: "🐶 반려동물", lateNight: "🌙 심야영업", vegetarianOptions: "🥗 채식 옵션" };
const BAND = { 1: "₩ 1만↓", 2: "₩₩ 1~2만", 3: "₩₩₩ 2~4만", 4: "₩₩₩₩ 4만+" };
const SITUATIONS = [
  { key: "kids", emo: "🍼", lb: "아이랑", require: ["kidFriendly"], prefFeat: ["kidsCafe", "parking"] },
  { key: "party", emo: "👥", lb: "회식", tags: ["회식"], prefFeat: ["partition", "privateRoom", "parking"] },
  { key: "date", emo: "💕", lb: "데이트", tags: ["데이트"], pref: ["분위기좋은", "조용한", "고급스러운"] },
  { key: "solo", emo: "🍚", lb: "혼밥", require: ["soloFriendly"] },
  { key: "view", emo: "🌆", lb: "뷰맛집", tags: ["뷰맛집"] }
];
const VERDICT_MSG = { "광고의심": "광고·협찬 리뷰가 너무 많아요", "어뷰징의심": "소수 계정이 몰아준 정황이 있어요", "바이럴거품": "숏폼에서만 반짝, 실제 방문 확인이 안 돼요", "담합의심": "여러 가게와 짜고 리뷰한 정황이 있어요", "조직적버스트": "짧은 기간 별점을 몰아준 정황이 있어요", "싱글톤공격": "일회성 계정이 별점을 몰아줬어요", "복붙리뷰": "복사·붙여넣기 리뷰가 많아요", "AI리뷰의심": "AI로 작성한 듯한 리뷰가 많아요", "평점급등의심": "최근 갑자기 별점이 치솟았어요", "보통": "검증 신호가 뚜렷하지 않아요", "미검증": "검증 신호가 부족해요", "정보부족": "리뷰가 아직 부족해요" };

function trustLines(r) {
  const s = r.signals || {}, out = [];
  if (s.repeatRatio >= 0.35) out.push(["🔁", `재방문·단골 손님이 많아요 (${Math.round(s.repeatRatio * 100)}%)`]);
  if (s.spanDays >= 365) out.push(["🕰️", "1년 넘게 꾸준히 사랑받는 곳이에요"]);
  if (s.localRatio >= 0.4) out.push(["📍", `동네 사람들 리뷰가 많아요 (${Math.round(s.localRatio * 100)}%)`]);
  if (s.paidFiltered > 0) out.push(["🧹", `협찬·광고 리뷰 ${s.paidFiltered}건을 걸러냈어요`]);
  if ((s.sourceClasses || []).length >= 3) out.push(["🗺️", `${s.sourceClasses.length}개 채널에서 교차 확인됐어요`]);
  if (s.behaviorScore >= 0.7) out.push(["🔥", "실제로 자주 찾는 인기 맛집이에요"]);
  if (s.ratingShape === "정상(J커브)") out.push(["✍️", "별점 몰아주기 없는 솔직한 후기예요"]);
  return out;
}
function cardReason(r) { const L = trustLines(r); if (!L.length) return null; const h = [...r.id].reduce((a, c) => a + c.charCodeAt(0), 0); return L[h % L.length]; }
const naverUrl = (r) => "https://map.naver.com/p/search/" + encodeURIComponent(`${r.district || ""} ${r.name}`.trim());

const openSheet = (id) => { $("scrim").hidden = false; const s = $(id); s.setAttribute("aria-hidden", "false"); requestAnimationFrame(() => s.classList.add("open")); };
const closeSheets = () => { document.querySelectorAll(".sheet.open").forEach((s) => { s.classList.remove("open"); s.setAttribute("aria-hidden", "true"); }); $("scrim").hidden = true; };

function pillGroup(id, items, set, isNum) {
  const el = $(id); el.innerHTML = "";
  items.forEach((it) => {
    const val = isNum ? +it[0] : it, label = isNum ? it[1] : it;
    const b = document.createElement("button"); b.type = "button"; b.className = "pill" + (set.has(val) ? " on" : ""); b.textContent = label;
    b.onclick = () => { set.has(val) ? set.delete(val) : set.add(val); b.classList.toggle("on"); clearSituation(); run(); };
    el.appendChild(b);
  });
}
function syncPills() {
  const m = state.meta;
  pillGroup("cuisines", m.cuisines, state.sel.cuisines);
  pillGroup("priceBands", Object.entries(BAND), state.sel.priceBands, true);
  pillGroup("features", m.features.filter((f) => FEATURE_LABEL[f]).map((f) => f), state.sel.features);
  // features labels
  [...$("features").children].forEach((b, i) => { const key = m.features.filter((f) => FEATURE_LABEL[f])[i]; b.textContent = FEATURE_LABEL[key]; });
  pillGroup("tags", m.tags, state.sel.tags);
  pillGroup("menuAttrs", m.menuAttrs, state.sel.menuAttrs);
}

async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  const m = state.meta;
  // situations
  $("situations").innerHTML = "";
  SITUATIONS.forEach((s) => { const b = document.createElement("button"); b.type = "button"; b.className = "sit"; b.innerHTML = `<span class="emo">${s.emo}</span><span class="lb">${s.lb}</span>`; b.onclick = () => pickSituation(s, b); $("situations").appendChild(b); });
  // categories (multi-select place style)
  const cats = ["전체", ...m.styles];
  $("cats").innerHTML = "";
  cats.forEach((c) => { const b = document.createElement("button"); b.type = "button"; b.className = "cat" + (c === "전체" ? " on" : ""); b.dataset.cat = c; b.textContent = c === "전체" ? "전체" : `${catOf(c)[0]} ${c}`; b.onclick = () => toggleCat(c); $("cats").appendChild(b); });

  $("near").innerHTML = m.landmarks.map((l) => `<option>${l}</option>`).join("");
  $("menu").insertAdjacentHTML("beforeend", m.menus.map((x) => `<option>${x}</option>`).join(""));
  syncPills();

  $("locChip").onclick = () => openSheet("sheetLoc");
  $("infoBtn").onclick = () => openSheet("sheetInfo");
  $("closeInfo").onclick = closeSheets;
  $("openFilter").onclick = () => openSheet("sheetFilter");
  $("closeFilter").onclick = $("applyFilter").onclick = closeSheets;
  $("scrim").onclick = closeSheets;
  document.querySelectorAll(".grip").forEach((g) => (g.onclick = closeSheets));
  $("minutes").oninput = (e) => ($("minsOut").textContent = e.target.value);
  $("menu").onchange = () => { clearSituation(); run(); };
  $("gemOnly").onchange = (e) => { state.gemOnly = e.target.checked; run(); };
  $("resetFilter").onclick = () => { clearFilters(); clearSituation(); run(); };
  $("applyLoc").onclick = () => { closeSheets(); syncLoc(); run(); };
  $("useGeo").onclick = useGeo;
  $("verifiedSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; $("verifiedSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); run(); }));
  $("sortSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.sort = b.dataset.sort; $("sortSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); run(); }));

  syncLoc(); run();
}

function toggleCat(c) {
  if (c === "전체") state.cats.clear();
  else { state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c); }
  $("cats").querySelectorAll(".cat").forEach((b) => { const cc = b.dataset.cat; b.classList.toggle("on", cc === "전체" ? state.cats.size === 0 : state.cats.has(cc)); });
  clearSituation(); run();
}
function clearFilters() {
  state.gemOnly = false; $("gemOnly").checked = false;
  Object.values(state.sel).forEach((s) => s.clear()); state.prefer = []; state.preferFeatures = []; $("menu").value = "";
  syncPills();
}
function clearSituation() { if (state.situation) { state.situation = null; $("situations").querySelectorAll(".sit").forEach((b) => b.classList.remove("on")); } }
function pickSituation(s, btn) {
  const was = state.situation === s.key;
  clearFilters();
  $("situations").querySelectorAll(".sit").forEach((b) => b.classList.remove("on"));
  if (was) { state.situation = null; run(); return; }
  state.situation = s.key; btn.classList.add("on");
  (s.require || []).forEach((f) => state.sel.features.add(f));
  (s.tags || []).forEach((t) => state.sel.tags.add(t));
  state.preferFeatures = s.prefFeat || []; state.prefer = s.pref || [];
  syncPills(); run();
}

function syncLoc() {
  if (!$("useLocation").checked) { state.location = null; $("locName").textContent = "전국"; return; }
  if (state.location && state.location.lat != null) $("locName").textContent = "현재위치";
  else { state.location = { near: $("near").value }; $("locName").textContent = $("near").value; }
}
function useGeo() {
  if (!navigator.geolocation) return alert("이 기기에서 위치를 쓸 수 없어요.");
  $("useGeo").textContent = "위치 확인 중…";
  navigator.geolocation.getCurrentPosition((p) => { state.location = { lat: p.coords.latitude, lng: p.coords.longitude }; $("useGeo").textContent = "📍 현재 위치 사용됨 ✓"; $("useLocation").checked = true; }, () => { $("useGeo").textContent = "📍 내 현재 위치 사용"; alert("위치 권한이 필요해요."); });
}

function buildQuery(extra = {}) {
  const pb = [...state.sel.priceBands];
  const q = {
    styles: [...state.cats], cuisines: [...state.sel.cuisines], tagsAny: [...state.sel.tags],
    menuAttrs: [...state.sel.menuAttrs], require: Object.fromEntries([...state.sel.features].map((f) => [f, true])),
    prefer: state.prefer, preferFeatures: Object.fromEntries((state.preferFeatures || []).map((f) => [f, true])),
    priceMin: pb.length ? Math.min(...pb) : 1, priceMax: pb.length ? Math.max(...pb) : 4,
    includeUnverified: state.mode === "all"
  };
  if ($("menu").value) q.menu = $("menu").value;
  if ($("useLocation").checked) { q.location = state.location && state.location.lat != null ? state.location : { near: $("near").value }; q.travel = { mode: $("mode").value, minutes: +$("minutes").value }; }
  return { ...q, ...extra };
}
async function apiSearch(q) { return (await (await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).json()); }
function postProcess(data) {
  let rows = data.results.slice();
  if (state.gemOnly) rows = rows.filter((r) => r.verdict === "찐맛집");
  if (state.sort === "rating") rows.sort((a, b) => b.rating - a.rating);
  else if (state.sort === "distance") rows.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  return rows;
}

async function run() {
  const data = await apiSearch(buildQuery());
  const rows = postProcess(data);
  state.last = { meta: data.meta, rows };
  renderApplied(); renderCount(data.meta, rows.length);
  $("applyFilter").textContent = `결과 ${rows.length}곳 보기`;
  if (!rows.length) return renderEmpty();
  $("list").innerHTML = rows.map(cardHtml).join("");
  [...$("list").children].forEach((el, i) => (el.onclick = () => openDetail(rows[i])));
}
function renderCount(meta, n) {
  const where = meta.origin ? `${$("locName").textContent} 근처` : "전국";
  $("count").textContent = `${where} ${state.gemOnly ? "🔥 찐맛집" : meta.verifiedOnly ? "검증 맛집" : "전체"} ${n}곳`;
}

function activeFilters() {
  const a = [];
  state.sel.cuisines.forEach((c) => a.push({ label: c, rm: () => state.sel.cuisines.delete(c) }));
  state.sel.priceBands.forEach((p) => a.push({ label: BAND[p], rm: () => state.sel.priceBands.delete(p) }));
  state.sel.features.forEach((f) => a.push({ label: (FEATURE_LABEL[f] || f).replace(/^\S+\s/, ""), rm: () => state.sel.features.delete(f) }));
  state.sel.tags.forEach((t) => a.push({ label: t, rm: () => state.sel.tags.delete(t) }));
  state.sel.menuAttrs.forEach((t) => a.push({ label: t, rm: () => state.sel.menuAttrs.delete(t) }));
  if ($("menu").value) a.push({ label: $("menu").value, rm: () => ($("menu").value = "") });
  if (state.gemOnly) a.push({ label: "🔥 찐맛집만", rm: () => { state.gemOnly = false; $("gemOnly").checked = false; } });
  return a;
}
function renderApplied() {
  const a = activeFilters(), el = $("applied");
  if (!a.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = a.map((f, i) => `<button class="achip" data-i="${i}">${f.label} <span class="x">×</span></button>`).join("") + `<button class="achip reset" id="resetAll">전체 해제</button>`;
  a.forEach((f, i) => (el.querySelector(`[data-i="${i}"]`).onclick = () => { f.rm(); clearSituation(); syncPills(); run(); }));
  $("resetAll").onclick = () => { clearFilters(); clearSituation(); run(); };
}

// Build "remove one facet" candidates WITHOUT mutating state (each carries an
// apply() that performs the real removal only when the user taps it).
function relaxCandidates() {
  const base = buildQuery(), c = [];
  [...state.sel.cuisines].forEach((x) => c.push({ label: x, q: { ...base, cuisines: base.cuisines.filter((v) => v !== x) }, apply: () => state.sel.cuisines.delete(x) }));
  [...state.sel.tags].forEach((x) => c.push({ label: x, q: { ...base, tagsAny: base.tagsAny.filter((v) => v !== x) }, apply: () => state.sel.tags.delete(x) }));
  [...state.sel.features].forEach((f) => { const req = { ...base.require }; delete req[f]; c.push({ label: (FEATURE_LABEL[f] || f).replace(/^\S+\s/, ""), q: { ...base, require: req }, apply: () => state.sel.features.delete(f) }); });
  [...state.sel.menuAttrs].forEach((x) => c.push({ label: x, q: { ...base, menuAttrs: base.menuAttrs.filter((v) => v !== x) }, apply: () => state.sel.menuAttrs.delete(x) }));
  if (state.sel.priceBands.size) c.push({ label: "가격대 넓히기", q: { ...base, priceMin: 1, priceMax: 4 }, apply: () => state.sel.priceBands.clear() });
  if ($("menu").value) c.push({ label: $("menu").value, q: { ...base, menu: undefined }, apply: () => ($("menu").value = "") });
  if (state.cats.size) c.push({ label: "장소 종류", q: { ...base, styles: [] }, apply: () => { state.cats.clear(); refreshCats(); } });
  if ($("useLocation").checked && +$("minutes").value < 60) c.push({ label: "이동 범위 넓히기", q: { ...base, travel: { mode: $("mode").value, minutes: Math.min(60, +$("minutes").value + 15) } }, apply: () => { $("minutes").value = Math.min(60, +$("minutes").value + 15); $("minsOut").textContent = $("minutes").value; syncLoc(); } });
  if (state.gemOnly) c.push({ label: "🔥 찐맛집만 해제", q: base, gem: false, apply: () => { state.gemOnly = false; $("gemOnly").checked = false; } });
  return c;
}
async function countFor(c) {
  const data = await apiSearch(c.q);
  const gem = c.gem === false ? false : state.gemOnly;
  return (gem ? data.results.filter((r) => r.verdict === "찐맛집") : data.results).length;
}
async function renderEmpty() {
  const cands = relaxCandidates(), scored = [];
  for (const c of cands) { const n = await countFor(c); if (n > 0) scored.push({ ...c, n }); }
  scored.sort((a, b) => b.n - a.n);
  const top = scored.slice(0, 4);
  const relax = top.length
    ? `<div class="relax">${top.map((s, i) => `<button data-i="${i}">${s.label} 빼면 <b>${s.n}곳</b></button>`).join("")}</div>`
    : `<div class="relax"><button id="relaxReset">필터 초기화</button></div>`;
  $("list").innerHTML = `<div class="empty">조건에 맞는 ${state.gemOnly ? "찐맛집" : state.mode === "verified" ? "검증된 " : ""}맛집이 없어요.<br>${top.length ? "아래 조건을 하나만 풀어볼까요?" : "필터를 초기화해 보세요."}</div>${relax}`;
  top.forEach((s, i) => ($("list").querySelector(`.relax [data-i="${i}"]`).onclick = () => { s.apply(); clearSituation(); syncPills(); run(); }));
  if (!top.length) $("relaxReset").onclick = () => { clearFilters(); clearSituation(); run(); };
  renderApplied();
}
function refreshCats() { $("cats").querySelectorAll(".cat").forEach((b) => { const cc = b.dataset.cat; b.classList.toggle("on", cc === "전체" ? state.cats.size === 0 : state.cats.has(cc)); }); }

function cardHtml(r) {
  const [emo, bg] = catOf(r.style);
  const badge = r.verdict === "찐맛집" ? `<span class="badge b-gem">🔥 찐맛집</span>` : r.verified ? `<span class="badge b-ok">✓ 검증</span>` : `<span class="badge b-bad">주의</span>`;
  const dist = r.distanceKm != null ? `${r.distanceKm}km · ` : "";
  let reason;
  if (r.verified) { const t = cardReason(r); reason = t ? `<div class="creason">${t[0]} ${t[1]}</div>` : ""; }
  else reason = `<div class="creason warn">⚠️ ${VERDICT_MSG[r.verdict] || "검증되지 않은 곳이에요"}</div>`;
  return `<button class="card" type="button"><div class="thumb" style="background:${bg}">${emo}</div><div class="cbody"><div class="crow"><span class="cname">${r.name}</span>${badge}</div><div class="csub">${r.style} · ${dist}⭐ ${r.rating} · ${"₩".repeat(r.priceBand)}</div>${reason}</div><span class="chev">›</span></button>`;
}
function openDetail(r) {
  const [emo, bg] = catOf(r.style);
  const dist = r.distanceKm != null ? ` · ${r.distanceKm}km(${r.travelMinutes}분)` : "";
  const badge = r.verdict === "찐맛집" ? `<span class="badge b-gem">🔥 찐맛집</span>` : r.verified ? `<span class="badge b-ok">✓ 검증됨</span>` : `<span class="badge b-bad">${r.verdict}</span>`;
  const lines = r.verified ? trustLines(r) : [["⚠️", VERDICT_MSG[r.verdict] || "검증 신호가 부족해요"], ...(r.reasons || []).filter((x) => x.startsWith("⚠")).map((x) => ["", x.replace(/^⚠\s*/, "")])];
  const trust = `<ul class="trust ${r.verified ? "" : "warn"}">${lines.map(([ic, t]) => `<li><span class="ic">${ic}</span><span>${t}</span></li>`).join("")}</ul>`;
  const menus = (r.menus || []).map((m) => `<span class="tagpill">${m.name}${m.attrs?.length ? " " + m.attrs.join("·") : ""}</span>`).join("");
  const feats = Object.entries(r.features || {}).filter(([, v]) => v).map(([k]) => (FEATURE_LABEL[k] || k));
  const facts = [...(r.tags || []), ...feats].map((t) => `<span>${t}</span>`).join("");
  $("detailBody").innerHTML = `<div class="dt-head"><div class="thumb" style="background:${bg}">${emo}</div><div><div class="crow"><span class="dt-name">${r.name}</span>${badge}</div><div class="dt-sub">${r.style} · ⭐ ${r.rating} · ${"₩".repeat(r.priceBand)}${dist}</div></div></div>
    <div class="sec"><h3>${r.verified ? "왜 믿을 만한가요" : "왜 조심해야 하나요"}</h3>${trust}</div>
    ${menus ? `<div class="sec"><h3>대표 메뉴</h3><div class="menus">${menus}</div></div>` : ""}
    ${facts ? `<div class="sec"><h3>이런 곳이에요</h3><div class="facts">${facts}</div></div>` : ""}
    <div class="sec"><div class="dt-sub">📍 ${r.address}</div><div class="dt-sub" style="margin-top:6px">영업시간·전화·길찾기는 네이버지도에서 확인하세요.</div></div>`;
  $("detailActions").innerHTML = `<a class="btn btn-primary" href="${naverUrl(r)}" target="_blank" rel="noopener">네이버지도 열기</a><button class="btn btn-line" type="button" id="closeDetail">닫기</button>`;
  $("closeDetail").onclick = closeSheets;
  openSheet("sheetDetail");
}

init();
