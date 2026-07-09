// 찐맛집 user app — light minimal. Naver Map is the place source (we deep-link
// out); our value is the verification/curation layer shown in human language.

const state = { meta: null, mode: "verified", cat: "전체", location: null,
  sel: { cuisines: new Set(), menuAttrs: new Set(), features: new Set() }, last: null, lastRun: null };
const $ = (id) => document.getElementById(id);

/* category visuals (Naver has the real photos; we use clean category tiles) */
const CAT = {
  "고깃집": ["🥩", "#fce8e6"], "이자카야": ["🏮", "#e8f0ff"], "횟집": ["🐟", "#e2f6f4"],
  "한식당": ["🍚", "#fff3e0"], "카페": ["☕", "#efe9e2"], "양식": ["🍝", "#fdeede"],
  "중식": ["🥟", "#fde6e6"], "분식": ["🍢", "#ffeaf0"]
};
const catOf = (style) => CAT[style] || ["🍽️", "#eef1f4"];

const FEATURE_LABEL = {
  kidsCafe: "키즈카페 있는 곳", kidFriendly: "아이 데려가기 좋은 곳", partition: "파티션·룸 있는 곳",
  privateRoom: "룸 있는 곳", parking: "주차 되는 곳", soloFriendly: "혼밥하기 좋은 곳", reservable: "예약 되는 곳"
};
const VERDICT_MSG = {
  "광고의심": "광고·협찬 리뷰가 너무 많아요", "어뷰징의심": "소수 계정이 몰아준 정황이 있어요",
  "바이럴거품": "숏폼에서만 반짝, 실제 방문 확인이 안 돼요", "담합의심": "여러 가게와 짜고 리뷰한 정황이 있어요",
  "조직적버스트": "짧은 기간 별점을 몰아준 정황이 있어요", "싱글톤공격": "일회성 계정이 별점을 몰아줬어요",
  "복붙리뷰": "복사·붙여넣기 리뷰가 많아요", "AI리뷰의심": "AI로 작성한 듯한 리뷰가 많아요",
  "평점급등의심": "최근 갑자기 별점이 치솟았어요", "보통": "검증 신호가 뚜렷하지 않아요",
  "미검증": "검증 신호가 부족해요", "정보부족": "리뷰가 아직 부족해요"
};

/* human-language trust signals from structured signals (no internal metric bars) */
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
// Pick one true line for the card, varied across venues by a stable id hash.
function cardReason(r) {
  const L = trustLines(r);
  if (!L.length) return null;
  const h = [...r.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return L[h % L.length];
}
const naverUrl = (r) => "https://map.naver.com/p/search/" + encodeURIComponent(`${r.district || ""} ${r.name}`.trim());

/* ---- sheets ---- */
const openSheet = (id) => { $("scrim").hidden = false; const s = $(id); s.setAttribute("aria-hidden", "false"); requestAnimationFrame(() => s.classList.add("open")); };
const closeSheets = () => { document.querySelectorAll(".sheet.open").forEach((s) => { s.classList.remove("open"); s.setAttribute("aria-hidden", "true"); }); $("scrim").hidden = true; };

function pills(id, items, set) {
  const el = $(id); el.innerHTML = "";
  items.forEach((it) => { const b = document.createElement("button"); b.type = "button"; b.className = "pill" + (set.has(it) ? " on" : ""); b.textContent = it;
    b.onclick = () => { set.has(it) ? (set.delete(it), b.classList.remove("on")) : (set.add(it), b.classList.add("on")); dot(); }; el.appendChild(b); });
}
function dot() {
  let n = state.sel.cuisines.size + state.sel.menuAttrs.size + state.sel.features.size;
  if ($("menu").value) n++; if ($("excludeFranchise").checked) n++; if ($("excludeCheap").checked) n++;
  if (+$("priceMin").value > 1 || +$("priceMax").value < 4) n++;
  const d = $("filterDot"); d.hidden = n === 0; d.textContent = n;
}

async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  const m = state.meta;
  // categories = 전체 + styles
  const cats = ["전체", ...m.styles];
  $("cats").innerHTML = "";
  cats.forEach((c) => { const b = document.createElement("button"); b.type = "button"; b.className = "cat" + (c === "전체" ? " on" : ""); b.textContent = c === "전체" ? "전체" : `${catOf(c)[0]} ${c}`;
    b.onclick = () => { state.cat = c; document.querySelectorAll(".cat").forEach((x) => x.classList.toggle("on", x === b)); run(); }; $("cats").appendChild(b); });

  $("near").innerHTML = m.landmarks.map((l) => `<option>${l}</option>`).join("");
  $("menu").insertAdjacentHTML("beforeend", m.menus.map((x) => `<option>${x}</option>`).join(""));
  pills("cuisines", m.cuisines, state.sel.cuisines);
  pills("menuAttrs", m.menuAttrs, state.sel.menuAttrs);
  // feature switches
  const fs = $("featureSwitches"); fs.innerHTML = "";
  Object.entries(FEATURE_LABEL).filter(([k]) => m.features.includes(k)).forEach(([k, label]) => {
    const row = document.createElement("label"); row.className = "switch-row";
    row.innerHTML = `${label}<span class="switch"><input type="checkbox" data-f="${k}" /><span class="track"></span></span>`;
    row.querySelector("input").onchange = (e) => { e.target.checked ? state.sel.features.add(k) : state.sel.features.delete(k); dot(); };
    fs.appendChild(row);
  });

  $("locChip").onclick = () => openSheet("sheetLoc");
  $("openFilter").onclick = $("openFilter2").onclick = () => openSheet("sheetFilter");
  $("scrim").onclick = closeSheets;
  document.querySelectorAll(".grip").forEach((g) => (g.onclick = closeSheets));
  $("minutes").oninput = (e) => ($("minsOut").textContent = e.target.value);
  const ps = () => { let lo = +$("priceMin").value, hi = +$("priceMax").value; if (lo > hi)[lo, hi] = [hi, lo]; $("priceOut").textContent = `${"₩".repeat(lo)} ~ ${"₩".repeat(hi)}`; dot(); };
  $("priceMin").oninput = ps; $("priceMax").oninput = ps; $("menu").onchange = dot; $("excludeFranchise").onchange = dot; $("excludeCheap").onchange = dot;
  $("applyFilter").onclick = () => { closeSheets(); run(); };
  $("resetFilter").onclick = reset;
  $("applyLoc").onclick = () => { closeSheets(); syncLoc(); run(); };
  $("useGeo").onclick = useGeo;
  $("verifiedSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; $("verifiedSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); run(); }));

  syncLoc(); run();
}

function reset() {
  state.sel.cuisines.clear(); state.sel.menuAttrs.clear(); state.sel.features.clear();
  pills("cuisines", state.meta.cuisines, state.sel.cuisines); pills("menuAttrs", state.meta.menuAttrs, state.sel.menuAttrs);
  $("featureSwitches").querySelectorAll("input").forEach((i) => (i.checked = false));
  $("menu").value = ""; $("excludeFranchise").checked = false; $("excludeCheap").checked = false;
  $("priceMin").value = 1; $("priceMax").value = 4; $("priceOut").textContent = "₩ ~ ₩₩₩₩"; dot();
}
function syncLoc() {
  if (!$("useLocation").checked) { state.location = null; $("locName").textContent = "전국"; return; }
  if (state.location && state.location.lat != null) $("locName").textContent = "현재위치";
  else { state.location = { near: $("near").value }; $("locName").textContent = $("near").value; }
}
function useGeo() {
  if (!navigator.geolocation) return alert("이 기기에서 위치를 쓸 수 없어요.");
  $("useGeo").textContent = "위치 확인 중…";
  navigator.geolocation.getCurrentPosition((p) => { state.location = { lat: p.coords.latitude, lng: p.coords.longitude }; $("useGeo").textContent = "📍 현재 위치 사용됨 ✓"; $("useLocation").checked = true; },
    () => { $("useGeo").textContent = "📍 내 현재 위치 사용"; alert("위치 권한이 필요해요."); });
}

function buildQuery() {
  const q = {
    styles: state.cat === "전체" ? [] : [state.cat],
    cuisines: [...state.sel.cuisines], menuAttrs: [...state.sel.menuAttrs],
    require: Object.fromEntries([...state.sel.features].map((f) => [f, true])),
    excludeTags: $("excludeCheap").checked ? ["가성비"] : [],
    excludeFranchise: $("excludeFranchise").checked,
    priceMin: Math.min(+$("priceMin").value, +$("priceMax").value), priceMax: Math.max(+$("priceMin").value, +$("priceMax").value),
    includeUnverified: state.mode === "all"
  };
  if ($("menu").value) q.menu = $("menu").value;
  if ($("useLocation").checked) { q.location = state.location && state.location.lat != null ? state.location : { near: $("near").value }; q.travel = { mode: $("mode").value, minutes: +$("minutes").value }; }
  return q;
}
async function run() {
  const data = await (await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildQuery()) })).json();
  render(data);
}

function render(data) {
  state.last = data; const meta = data.meta || {};
  const where = meta.origin ? `${$("locName").textContent} 근처` : "전국";
  $("count").textContent = `${where} ${meta.verifiedOnly ? "검증 맛집" : "전체"} ${meta.total}곳`;
  const list = $("list");
  if (!data.results.length) { list.innerHTML = `<div class="empty">조건에 맞는 ${meta.verifiedOnly ? "검증된 " : ""}맛집이 없어요.<br>카테고리를 ‘전체’로 바꾸거나 이동 범위를 넓혀보세요.</div>`; return; }
  list.innerHTML = data.results.map((r, i) => cardHtml(r, i)).join("");
  [...list.children].forEach((el, i) => (el.onclick = () => openDetail(data.results[i])));
}
function cardHtml(r) {
  const [emo, bg] = catOf(r.style);
  const badge = r.verdict === "찐맛집" ? `<span class="badge b-gem">🔥 찐맛집</span>` : r.verified ? `<span class="badge b-ok">✓ 검증</span>` : `<span class="badge b-bad">주의</span>`;
  const dist = r.distanceKm != null ? `${r.distanceKm}km · ` : "";
  let reason;
  if (r.verified) { const t = cardReason(r); reason = t ? `<div class="creason">${t[0]} ${t[1]}</div>` : ""; }
  else reason = `<div class="creason warn">⚠️ ${VERDICT_MSG[r.verdict] || "검증되지 않은 곳이에요"}</div>`;
  return `<button class="card" type="button">
    <div class="thumb" style="background:${bg}">${emo}</div>
    <div class="cbody">
      <div class="crow"><span class="cname">${r.name}</span>${badge}</div>
      <div class="csub">${r.style} · ${dist}⭐ ${r.rating} · ${"₩".repeat(r.priceBand)}</div>
      ${reason}
    </div>
    <span class="chev">›</span>
  </button>`;
}

function openDetail(r) {
  const [emo, bg] = catOf(r.style);
  const dist = r.distanceKm != null ? ` · ${r.distanceKm}km(${r.travelMinutes}분)` : "";
  const badge = r.verdict === "찐맛집" ? `<span class="badge b-gem">🔥 찐맛집</span>` : r.verified ? `<span class="badge b-ok">✓ 검증됨</span>` : `<span class="badge b-bad">${r.verdict}</span>`;
  const lines = r.verified ? trustLines(r) : [["⚠️", VERDICT_MSG[r.verdict] || "검증 신호가 부족해요"], ...(r.reasons || []).filter((x) => x.startsWith("⚠")).map((x) => ["", x.replace(/^⚠\s*/, "")])];
  const trust = `<ul class="trust ${r.verified ? "" : "warn"}">${lines.map(([ic, t]) => `<li><span class="ic">${ic}</span><span>${t}</span></li>`).join("")}</ul>`;
  const menus = (r.menus || []).map((m) => `<span class="tagpill">${m.name}${m.attrs?.length ? " " + m.attrs.join("·") : ""}</span>`).join("");
  const feats = Object.entries(r.features || {}).filter(([, v]) => v).map(([k]) => FEATURE_LABEL[k] || k);
  const facts = [...(r.tags || []), ...feats].map((t) => `<span>${t}</span>`).join("");
  $("detailBody").innerHTML = `
    <div class="dt-head"><div class="thumb" style="background:${bg}">${emo}</div>
      <div><div class="crow"><span class="dt-name">${r.name}</span>${badge}</div>
      <div class="dt-sub">${r.style} · ⭐ ${r.rating} · ${"₩".repeat(r.priceBand)}${dist}</div></div></div>
    <div class="sec"><h3>${r.verified ? "왜 믿을 만한가요" : "왜 조심해야 하나요"}</h3>${trust}</div>
    ${menus ? `<div class="sec"><h3>대표 메뉴</h3><div class="menus">${menus}</div></div>` : ""}
    ${facts ? `<div class="sec"><h3>이런 곳이에요</h3><div class="facts">${facts}</div></div>` : ""}
    <div class="sec"><div class="dt-sub">📍 ${r.address}</div></div>`;
  $("detailActions").innerHTML = `<a class="btn btn-primary" href="${naverUrl(r)}" target="_blank" rel="noopener">네이버지도 열기</a><button class="btn btn-line" type="button" id="closeDetail">닫기</button>`;
  $("closeDetail").onclick = closeSheets;
  openSheet("sheetDetail");
}

init();
