// 찐맛집 — real-data frontend. Restaurants come from a live place API (Kakao
// Local) via our server; tapping a card opens the matching place on Naver Map.
// No fabricated data: if no data source is configured, we show a setup state.

const state = { coords: null, cat: "", ready: false, nopoOnly: false, lastPlaces: [], lastWhere: "" };
const $ = (id) => document.getElementById(id);
const isNopo = (p) => Boolean(p.nopo && p.nopo.tier);

// category label -> Kakao keyword (or __cafe flag)
const CATS = [
  ["전체", ""], ["고깃집", "고깃집"], ["한식", "한식"], ["일식", "일식"],
  ["횟집", "횟집"], ["중식", "중식"], ["양식", "양식"], ["분식", "분식"],
  ["치킨", "치킨"], ["카페", "__cafe"]
];
const CAT_EMO = { "고깃집": "🥩", "한식": "🍚", "일식": "🍣", "횟집": "🐟", "중식": "🥟", "양식": "🍝", "분식": "🍢", "치킨": "🍗", "카페": "☕" };

async function init() {
  const cfg = await (await fetch("/api/config")).json();
  state.ready = cfg.data?.ready;

  $("cats").innerHTML = "";
  CATS.forEach(([label, term]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cat" + (term === state.cat ? " on" : "");
    b.textContent = label === "전체" ? "전체" : `${CAT_EMO[label] || ""} ${label}`;
    b.onclick = () => { state.cat = term; document.querySelectorAll(".cat").forEach((x) => x.classList.toggle("on", x === b)); run(); };
    $("cats").appendChild(b);
  });

  $("searchBtn").onclick = () => { state.coords = null; run(); };
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") { state.coords = null; run(); } });
  $("geoBtn").onclick = useGeo;
  $("nopoToggle").onclick = () => { state.nopoOnly = !state.nopoOnly; $("nopoToggle").classList.toggle("on", state.nopoOnly); renderList(); };

  if (!state.ready) return renderSetup();
  $("count").textContent = "지역을 검색하거나 ‘내 주변’을 눌러보세요.";
}

function useGeo() {
  if (!navigator.geolocation) return alert("이 기기에서 위치를 쓸 수 없어요.");
  $("geoBtn").textContent = "위치 확인 중…";
  navigator.geolocation.getCurrentPosition(
    (p) => { state.coords = { lat: p.coords.latitude, lng: p.coords.longitude }; $("geoBtn").textContent = "📍 내 주변"; run(); },
    () => { $("geoBtn").textContent = "📍 내 주변"; alert("위치 권한이 필요해요."); }
  );
}

function buildUrl() {
  const area = $("q").value.trim();
  const cafe = state.cat === "__cafe";
  const catTerm = cafe ? "" : state.cat;
  const u = new URLSearchParams();
  if (state.coords) {
    u.set("lat", state.coords.lat); u.set("lng", state.coords.lng); u.set("radius", "2000");
    u.set("query", [catTerm, "맛집"].filter(Boolean).join(" ") || "맛집");
  } else {
    const query = [area, catTerm, "맛집"].filter(Boolean).join(" ");
    if (!query.trim()) return null;
    u.set("query", query);
  }
  if (cafe) u.set("cafe", "1");
  return "/api/places?" + u.toString();
}

async function run() {
  if (!state.ready) return renderSetup();
  const url = buildUrl();
  if (!url) { $("count").textContent = "검색어를 입력하거나 ‘내 주변’을 눌러보세요."; $("list").innerHTML = ""; return; }
  $("count").textContent = "불러오는 중…";
  let res, data;
  try { res = await fetch(url); data = await res.json(); } catch { $("count").textContent = "네트워크 오류"; return; }
  if (!res.ok) {
    if (data.error === "no_data_source") return renderSetup();
    $("list").innerHTML = `<div class="empty">데이터를 불러오지 못했어요.<br><span class="mono">${data.message || ""}</span></div>`;
    $("count").textContent = "오류";
    return;
  }
  state.lastPlaces = data.places;
  state.lastWhere = state.coords ? "내 주변" : $("q").value.trim() || "검색";
  renderList();
}

function renderList() {
  const all = state.lastPlaces || [];
  const places = state.nopoOnly ? all.filter(isNopo) : all;
  const nopoCount = all.filter(isNopo).length;
  if (!all.length) { $("count").textContent = "결과 없음"; $("list").innerHTML = `<div class="empty">결과가 없어요. 다른 지역·키워드로 검색해 보세요.</div>`; return; }
  $("count").textContent = state.nopoOnly
    ? `${state.lastWhere} · 오래된 집(노포) ${places.length}곳`
    : `${state.lastWhere} · 실제 식당 ${all.length}곳 (카카오)${nopoCount ? ` · 🏛️ 노포 ${nopoCount}` : ""}`;
  if (!places.length) {
    $("list").innerHTML = `<div class="empty">이 근처엔 전화번호로 판별되는 오래된 집이 없어요.<br>범위를 넓히거나 필터를 꺼보세요.</div>`;
    return;
  }
  const note = state.nopoOnly
    ? `<div class="notice">🏛️ <b>여러 신호를 합쳐</b> 오래된 집을 추정해요 — 전화번호 자릿수(6자리=아주 오래됨), 상호(원조·전통·N대), 전통시장 소재, 노포 다발 업종. 전국 공통이에요. (공식 개업일 연동 시 정확한 연도로 판정)</div>`
    : `<div class="notice">ℹ️ <b>카카오 실데이터</b>로 실제 식당·위치·네이버 링크를 보여줍니다. ‘검증’ 배지는 실리뷰 데이터 연동 후 제공돼요.</div>`;
  $("list").innerHTML = note + places.map(card).join("");
}

function card(p) {
  const cat = (p.category || "").split(">").pop().trim();
  const emo = CAT_EMO[cat] || "🍽️";
  const dist = p.distanceM != null ? (p.distanceM < 1000 ? `${p.distanceM}m` : `${(p.distanceM / 1000).toFixed(1)}km`) : "";
  const sub = [cat, dist, p.phone].filter(Boolean).join(" · ");
  const nopo = p.nopo?.label
    ? `<span class="badge ${p.nopo.tier === "strong" ? "b-nopo" : "b-old"}">${p.nopo.tier === "strong" ? "🏛️" : "🕰️"} ${p.nopo.label}</span>`
    : "";
  const nopoWhy = p.nopo?.label && p.nopo.reasons?.length
    ? `<div class="creason">🏛️ ${p.nopo.reasons.slice(0, 2).join(" · ")}</div>` : "";
  return `<a class="card" href="${p.naverUrl}" target="_blank" rel="noopener">
    <div class="thumb" style="background:#f2f4f6">${emo}</div>
    <div class="cbody">
      <div class="crow"><span class="cname">${p.name}</span>${nopo}</div>
      <div class="csub">${sub}</div>
      <div class="addr">${p.address || ""}</div>
      ${nopoWhy}
    </div>
    <span class="chev">›</span>
  </a>`;
}

function renderSetup() {
  $("count").textContent = "데이터 소스 미설정";
  $("list").innerHTML = `<div class="setup">
    <div class="setup-ic">🔌</div>
    <h2>실데이터 소스를 연결하세요</h2>
    <p>이 앱은 <b>실제 식당 데이터</b>만 씁니다. 카카오 로컬 API 키를 설정하면 실제 식당·위치검색·네이버 링크가 바로 동작합니다.</p>
    <ol>
      <li><b>카카오 REST 키</b> 발급 — developers.kakao.com → 앱 → REST API 키</li>
      <li>서버 실행 시 환경변수로 주입:<br><code>KAKAO_REST_KEY=발급받은키 npm run eats</code></li>
      <li>네트워크가 <code>dapi.kakao.com</code> 접근을 허용해야 합니다.</li>
    </ol>
    <p class="muted-note">키가 설정되면 이 화면 대신 실제 식당이 나옵니다.</p>
  </div>`;
}

init();
