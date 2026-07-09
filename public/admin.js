// Admin console controller. Loads /api/admin (every venue scored + corpus
// collusion signals) and renders a moderation dashboard. Dependency-free.

const A = { data: null, verdict: "all", q: "" };
const $ = (id) => document.getElementById(id);

const VCLASS = { "찐맛집": "gem", "검증됨": "ok" };
const badgeClass = (v, verdict) => (verdict === "찐맛집" ? "b-gem" : v ? "b-ok" : "b-bad");
const rowClass = (v, verdict) => (verdict === "찐맛집" ? "gem" : v ? "ok" : "bad");
const FLABEL = { behavior: "행동데이터", diversity: "작성자다양", local: "로컬·재방문", classBreadth: "소스교차", sustain: "지속성", realism: "평점현실성", texture: "후기구체성" };

async function load() {
  A.data = await (await fetch("/api/admin")).json();
  renderTiles();
  renderDist();
  renderRings();
  renderVerdictFilter();
  renderTable();
}

function renderTiles() {
  const s = A.data.summary;
  const gem = s.verdictCounts["찐맛집"] || 0;
  $("tiles").innerHTML = [
    tile("전체 업소", s.total, ""),
    tile("검증 통과", s.verified, "good"),
    tile("가짜 판별", s.rejected, "bad"),
    tile("찐맛집", gem, "gem"),
    tile("탐지된 담합 링", A.data.rings.length, "bad")
  ].join("");
}
const tile = (k, v, cls) => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

function renderDist() {
  const counts = A.data.summary.verdictCounts;
  const max = Math.max(1, ...Object.values(counts));
  const order = ["찐맛집", "검증됨", "보통", "미검증", "광고의심", "어뷰징의심", "바이럴거품", "담합의심", "조직적버스트", "싱글톤공격", "복붙리뷰", "AI리뷰의심", "평점급등의심", "정보부족"];
  const rows = order.filter((k) => counts[k]).map((k) => {
    const n = counts[k];
    const good = k === "찐맛집" || k === "검증됨";
    const color = good ? "var(--accent2)" : k === "보통" ? "var(--muted)" : "var(--bad)";
    return `<div class="dist-row"><span>${k}</span><div class="bar"><i style="--w:${(n / max) * 100}%;background:${color}"></i></div><b>${n}</b></div>`;
  }).join("");
  $("dist").innerHTML = rows;
}

function renderRings() {
  const rings = A.data.rings;
  if (!rings.length) { $("rings").innerHTML = `<div class="muted">탐지된 담합 링이 없습니다.</div>`; return; }
  // dedupe author-pairs into a readable list
  $("rings").innerHTML = rings.map((r) =>
    `<div class="ring"><div class="who">👥 ${r.authors.join(" ↔ ")}</div>
      <div class="ven">함께 리뷰한 업소: ${r.venues.map(nameOf).join(", ")}</div></div>`
  ).join("");
}
function nameOf(id) { return (A.data.venues.find((v) => v.id === id)?.name) || id; }

function renderVerdictFilter() {
  const counts = A.data.summary.verdictCounts;
  const chips = [["all", `전체 ${A.data.summary.total}`], ["verified", `검증 ${A.data.summary.verified}`], ["rejected", `가짜 ${A.data.summary.rejected}`]];
  $("vfilter").innerHTML = chips.map(([v, label]) =>
    `<button class="vchip ${A.verdict === v ? "on" : ""}" data-v="${v}">${label}</button>`
  ).join("");
  $("vfilter").querySelectorAll(".vchip").forEach((c) => {
    c.onclick = () => { A.verdict = c.dataset.v; renderVerdictFilter(); renderTable(); };
  });
}

function renderTable() {
  let venues = A.data.venues;
  if (A.verdict === "verified") venues = venues.filter((v) => v.verified);
  else if (A.verdict === "rejected") venues = venues.filter((v) => !v.verified);
  if (A.q) venues = venues.filter((v) => v.name.toLowerCase().includes(A.q.toLowerCase()));

  if (!venues.length) { $("table").innerHTML = `<div class="muted">해당 조건의 업소가 없습니다.</div>`; return; }
  $("table").innerHTML = venues.map(row).join("");
  $("table").querySelectorAll(".tsum").forEach((el) => {
    el.onclick = () => el.parentElement.classList.toggle("open");
  });
}

function row(v) {
  const flags = (v.flags || []).map((f) => `<span class="fchip">${f}</span>`).join("");
  const bars = Object.entries(v.breakdown || {})
    .map(([k, val]) => `<div class="fbar"><span>${FLABEL[k] || k}</span><i style="--w:${val}%"></i><b>${val}</b></div>`).join("");
  const reasons = (v.reasons || []).map((x) => `<li>${x}</li>`).join("");
  const s = v.signals || {};
  const kv = [
    ["소스 클래스", (s.sourceClasses || []).join("·")],
    ["작성자 수 / HHI", `${s.uniqueAuthors} / ${s.authorHHI}`],
    ["광고 제외", `${s.paidFiltered}건 (비율 ${s.paidRatio})`],
    ["숏폼 비중", s.shortFormShare],
    ["행동 점수", s.behaviorScore],
    ["리뷰링 비중", s.ringShare],
    ["네트워크 사기확률", s.networkFraud],
    ["평점 분포", s.ratingShape],
    ["복붙/AI 비율", `${s.duplicationRatio ?? "-"} / ${s.aiRatio ?? "-"}`],
    ["시계열 스파이크", s.spikeShare]
  ].map(([k, val]) => `<div class="k">${k}</div><div>${val ?? "-"}</div>`).join("");

  return `<div class="trow ${rowClass(v.verified, v.verdict)}">
    <div class="tsum">
      <div class="tname">${v.name}<div class="sub">${v.style} · ${v.address} · <span class="expand">자세히 ▾</span></div></div>
      <div class="tright">
        <span class="vbadge ${badgeClass(v.verified, v.verdict)}">${v.verdict}</span>
        <span class="tscore">${v.authenticityScore}</span>
      </div>
    </div>
    ${flags ? `<div class="tflags">${flags}</div>` : ""}
    <div class="tdetail">
      <div class="grid2">
        <div><div class="muted" style="margin-bottom:8px">진위 요소 점수</div><div class="fbars">${bars}</div></div>
        <div><div class="muted" style="margin-bottom:8px">판별 신호</div><div class="kv">${kv}</div></div>
      </div>
      <div class="muted" style="margin:12px 0 4px">판별 근거</div>
      <ul class="reasons">${reasons || "<li>-</li>"}</ul>
    </div>
  </div>`;
}

$("q").oninput = (e) => { A.q = e.target.value; renderTable(); };
$("refresh").onclick = load;
load();
