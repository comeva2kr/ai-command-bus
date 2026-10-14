// 안심스캔 PWA — 카메라(바코드·라벨 사진) → 서버 분석 → 판정·대체품.
// 점수 엔진은 서버와 같은 /core 모듈을 쓴다(여기선 폼 선택지만 가져온다).
import { ALLERGENS, CONCERNS, MALLS } from "/core/index.js";

const $ = (id) => document.getElementById(id);
const PROFILE_KEY = "ansim.profile.v1";

// ── 저장소 (사생활 모드·차단 환경에서도 앱은 돌아가야 한다)
// 안드로이드 앱 안(WebView)에서 열리면 프로필을 네이티브 쪽에 저장한다 — 쇼핑몰 앱 위
// 플로팅 탭이 같은 아이 정보를 쓰도록. window.AnsimNative는 그 앱이 주입하는 브리지다.
const native = window.AnsimNative;
function loadProfile() {
  try {
    if (native) return JSON.parse(native.getProfile() || "null");
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
  } catch { return null; }
}
function saveProfile(p) {
  try {
    if (native) native.setProfile(JSON.stringify(p));
    else localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}
let profile = loadProfile() || { name: "", age: 6, allergies: [], concerns: [], mall: "coupang" };

function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), ms);
}

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
};

// ── 아이 정보
const ageLabel = (a) => (a < 1 ? "돌 전" : `${a}세`);
function profileSummary() {
  const parts = [profile.name || "우리 아이", ageLabel(profile.age)];
  if (profile.allergies.length) parts.push(`알레르기 ${profile.allergies.length}`);
  return parts.join(" · ");
}
function renderProfileChip() { $("profileChip").textContent = profileSummary(); }

function buildProfileForm() {
  const age = $("pAge");
  for (let a = 0; a <= 14; a++) age.append(el("option", { value: String(a), text: a === 0 ? "돌 전 (12개월 미만)" : `${a}세` }));
  for (const al of ALLERGENS) {
    $("pAllergies").append(el("label", {}, el("input", { type: "checkbox", value: al.id }), al.label));
  }
  for (const c of CONCERNS) {
    $("pConcerns").append(el("label", {}, el("input", { type: "checkbox", value: c.id }), c.label));
  }
  for (const m of MALLS) $("pMall").append(el("option", { value: m.id, text: m.label }));
}
function openProfile() {
  $("pName").value = profile.name || "";
  $("pAge").value = String(profile.age);
  for (const i of $("pAllergies").querySelectorAll("input")) i.checked = profile.allergies.includes(i.value);
  for (const i of $("pConcerns").querySelectorAll("input")) i.checked = profile.concerns.includes(i.value);
  $("pMall").value = profile.mall || "coupang";
  $("sheet").classList.remove("hidden");
}
$("profileChip").onclick = openProfile;
$("sheetClose").onclick = () => $("sheet").classList.add("hidden");
$("profileForm").onsubmit = (e) => {
  e.preventDefault();
  const checked = (id) => [...$(id).querySelectorAll("input:checked")].map((i) => i.value);
  profile = {
    name: $("pName").value.trim(),
    age: Number($("pAge").value),
    allergies: checked("pAllergies"),
    concerns: checked("pConcerns"),
    mall: $("pMall").value
  };
  saveProfile(profile);
  renderProfileChip();
  $("sheet").classList.add("hidden");
  if (lastRequest) run(lastRequest);   // 프로필이 바뀌면 같은 제품을 다시 판정
};

// ── API
let lastRequest = null;
async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function run(req) {
  lastRequest = req;
  const { endpoint, ...payload } = req;
  const { status, data } = await api(endpoint, { ...payload, profile, mall: profile.mall });
  if (status === 404) { toast("이 바코드는 아직 정보가 없어요. 포장 뒷면 원재료 부분을 사진으로 찍어 주세요.", 4500); return; }
  if (status === 501) { toast("라벨 사진 분석이 이 서버에서 꺼져 있어요. 원재료명을 붙여넣어 주세요."); return; }
  if (status === 422) { toast("사진에서 원재료를 읽지 못했어요. 원재료명 부분이 잘 보이게 다시 찍어 주세요."); return; }
  if (status !== 200) { toast("분석하지 못했어요. 잠시 후 다시 시도해 주세요."); return; }
  $("toast").classList.add("hidden");
  renderResult(data);
}

// ── 결과
function renderResult({ product, analysis, alternatives, extracted }) {
  stopScan();
  $("scanView").classList.add("hidden");
  $("resultView").classList.remove("hidden");
  window.scrollTo(0, 0);

  const tone = `tone-${analysis.verdict.tone}`;
  // 알레르기 차단이면 큰 점수를 숨긴다 — "먹이지 마세요" 아래 빨간 90점은 헷갈린다
  const blocked = analysis.verdict.code === "block";
  const v = $("verdict");
  v.replaceChildren(
    el("div", { class: `word ${tone}`, text: analysis.verdict.label }),
    el("div", { class: "label", text: "안심점수" }),
    el("div", { class: `score ${tone}` }, analysis.score == null || blocked ? "–" : String(analysis.score), el("small", { text: "/100" })),
    blocked && analysis.score != null ? el("div", { class: "small", text: `아이에게 맞지 않는 성분 포함 · 일반 점수 ${analysis.score}` }) : null,
    el("div", { class: "pname", text: product.name || "이름 없는 제품" }),
    el("div", { class: "small", text: `${profileSummary()} 기준 · 신뢰도 ${{ high: "높음", medium: "보통(영양정보 없음)", low: "낮음" }[analysis.confidence]}` }),
    product.sample ? el("div", { class: "sample-tag", text: "가상의 예시 제품" }) : null
  );

  const list = $("reasons");
  list.replaceChildren();
  const shown = analysis.reasons.slice(0, 4);
  const renderReason = (r, withDetail) => el("li", { class: r.block ? "block" : "" },
    el("div", { class: "t" }, r.title,
      r.evidence && r.evidence !== "info" ? el("span", { class: `badge ${r.evidence}`, text: `근거 ${r.evidence}` }) : null,
      r.penalty ? el("span", { class: "pen", text: `−${r.penalty}` }) : null),
    withDetail ? el("div", { class: "d" }, r.detail,
      r.source ? el("span", {}, " · ", el("a", { href: r.source.url, target: "_blank", rel: "noopener", text: "출처" })) : null) : null
  );
  if (!analysis.reasons.length) list.append(el("li", {}, el("div", { class: "t tone-green", text: "걸리는 항목이 없어요" })));
  for (const r of shown) list.append(renderReason(r, false));

  $("highlights").replaceChildren(...analysis.highlights.map((h) => el("span", { text: h })));

  const more = $("more");
  more.classList.add("hidden");
  $("moreBtn").textContent = "근거 자세히 보기";
  $("moreBtn").onclick = () => {
    const open = more.classList.toggle("hidden") === false;
    $("moreBtn").textContent = open ? "접기" : "근거 자세히 보기";
    list.replaceChildren(...(open ? analysis.reasons : shown).map((r) => renderReason(r, open)));
    if (!analysis.reasons.length) list.append(el("li", {}, el("div", { class: "t tone-green", text: "걸리는 항목이 없어요" })));
  };
  $("notes").replaceChildren(...analysis.notes.map((n) => el("li", { text: n })));
  if (extracted) {
    $("extractedBox").classList.remove("hidden");
    $("extracted").textContent = [extracted.ingredientsText, extracted.allergenText, extracted.nutritionText].filter(Boolean).join("\n\n");
  } else $("extractedBox").classList.add("hidden");

  // 대체품
  const alts = $("alts");
  alts.replaceChildren();
  const better = alternatives?.length && alternatives[0].tier === "good";
  $("altTitle").replaceChildren(
    alternatives?.length ? el("b", { text: `${alternatives.length}개` }) : "",
    alternatives?.length ? (better ? " 더 안전한 선택" : " 그나마 나은 선택") : "대체품"
  );
  if (!alternatives?.length) {
    alts.append(el("div", { class: "empty", text: analysis.verdict.code === "good" ? "이미 좋은 선택이에요." : "같은 종류에서 더 나은 제품을 아직 찾지 못했어요." }));
  }
  for (const a of alternatives || []) {
    alts.append(el("div", { class: "alt" },
      el("div", { class: "n", text: a.product.name }),
      el("div", { class: "s" }, String(a.analysis.score), el("small", { text: "/100" })),
      el("ul", {}, ...a.improvements.map((i) => el("li", { text: i }))),
      el("div", { class: "buy" }, ...a.links.slice(0, 2).map((l, i) =>
        el("a", { href: l.url, target: "_blank", rel: "noopener", class: i === 0 ? "first" : "", text: `${l.label}에서 ${l.kind === "direct" ? "보기" : "찾기"}` })))
    ));
  }
}
$("againBtn").onclick = () => {
  $("resultView").classList.add("hidden");
  $("scanView").classList.remove("hidden");
};

// ── 카메라 바코드 스캔 (BarcodeDetector — Android Chrome 등. iOS Safari는 미지원)
let stream = null;
let scanning = false;
async function startScan() {
  if (!("BarcodeDetector" in window)) {
    toast("이 브라우저는 실시간 바코드 인식을 지원하지 않아요. '라벨 사진 찍기'나 번호 입력을 이용해 주세요.", 5000);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch {
    toast("카메라를 열 수 없어요. 브라우저 카메라 권한을 확인해 주세요.");
    return;
  }
  const video = $("video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  video.classList.remove("hidden");
  $("frame").classList.remove("hidden");
  $("hint").classList.add("hidden");
  $("scanBtn").textContent = "스캔 중지";
  const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  scanning = true;
  const tick = async () => {
    if (!scanning) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const code = codes[0].rawValue;
        stopScan();
        if (navigator.vibrate) navigator.vibrate(60);
        run({ endpoint: "/api/ansim/analyze", barcode: code });
        return;
      }
    } catch {}
    setTimeout(tick, 250);
  };
  tick();
}
function stopScan() {
  scanning = false;
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  $("video").classList.add("hidden");
  $("frame").classList.add("hidden");
  $("hint").classList.remove("hidden");
  $("scanBtn").textContent = "바코드 스캔";
}
$("scanBtn").onclick = () => (scanning ? stopScan() : startScan());

// ── 라벨 사진 → 긴 변 1600px JPEG로 줄여 보낸다 (전송량·비용 절약)
$("photoBtn").onclick = () => $("photoInput").click();
$("photoInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  toast("라벨을 읽는 중…", 20000);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.85);
    await run({ endpoint: "/api/ansim/label", image });
  } catch {
    toast("사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요.");
  }
};

// ── 직접 입력
$("barcodeForm").onsubmit = (e) => {
  e.preventDefault();
  const code = $("barcodeInput").value.replace(/\D/g, "");
  if (code.length < 8) { toast("바코드 숫자 8~13자리를 입력해 주세요."); return; }
  run({ endpoint: "/api/ansim/analyze", barcode: code });
};
$("pasteForm").onsubmit = (e) => {
  e.preventDefault();
  const ingredientsText = $("pasteIngredients").value.trim();
  if (!ingredientsText) { toast("원재료명을 붙여넣어 주세요."); return; }
  run({ endpoint: "/api/ansim/analyze", product: { name: $("pasteName").value.trim(), ingredientsText, nutritionText: $("pasteNutrition").value.trim() } });
};

// ── 시작
buildProfileForm();
renderProfileChip();
if (!loadProfile()) openProfile();
api("/api/ansim/samples").then(({ data }) => {
  for (const p of data.products || []) {
    $("samples").append(el("button", { type: "button", text: p.name, "data-barcode": p.barcode }));
  }
  $("samples").onclick = (e) => {
    const b = e.target.closest("button[data-barcode]");
    if (b) run({ endpoint: "/api/ansim/analyze", barcode: b.dataset.barcode });
  };
});
api("/api/ansim/config").then(({ data }) => {
  if (!data.labelReader) $("photoBtn").title = "서버에 ANTHROPIC_API_KEY가 없으면 꺼져 있어요";
});
