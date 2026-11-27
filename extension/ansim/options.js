import { ALLERGENS, CONCERNS } from "./core/index.js";

const $ = (id) => document.getElementById(id);
const DEFAULTS = { profile: { name: "", age: 6, allergies: [], concerns: [] }, backend: "" };

function toggle(container, items, selected) {
  for (const it of items) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = it.id;
    input.checked = selected.includes(it.id);
    label.append(input, it.label);
    container.append(label);
  }
}

const { profile, backend } = await chrome.storage.local.get(DEFAULTS);
for (let a = 0; a <= 14; a++) {
  const o = document.createElement("option");
  o.value = String(a);
  o.textContent = a === 0 ? "돌 전 (12개월 미만)" : `${a}세`;
  $("age").append(o);
}
$("age").value = String(profile.age);
toggle($("allergies"), ALLERGENS, profile.allergies);
toggle($("concerns"), CONCERNS, profile.concerns);
$("backend").value = backend;

$("save").onclick = async () => {
  const checked = (id) => [...$(id).querySelectorAll("input:checked")].map((i) => i.value);
  const url = $("backend").value.trim();
  await chrome.storage.local.set({
    profile: { name: "", age: Number($("age").value), allergies: checked("allergies"), concerns: checked("concerns") },
    backend: /^https?:\/\//.test(url) ? url : ""
  });
  $("saved").textContent = "저장했어요. 열려 있는 상품 페이지에 바로 반영됩니다.";
};
