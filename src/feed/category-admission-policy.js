import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { CATEGORIES } from "./taxonomy.js";

const POLICY_PATH = fileURLToPath(new URL("./category-admission-policy.json", import.meta.url));
const TAXONOMY_IDS = CATEGORIES.map((category) => category.id);
const TAXONOMY_SET = new Set(TAXONOMY_IDS);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const exactKeys = (value, keys) => isObject(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");

export function parseCategoryAdmissionPolicy(input) {
  if (!exactKeys(input, ["categories", "contract", "productDecisions", "selection", "version"])
    || input.contract !== "NOWHOT-CATEGORY-ADMISSION-POLICY-001" || input.version !== 1) {
    throw new TypeError("category admission policy contract invalid");
  }

  const selectionKeys = [
    "coreTest", "directness", "display", "emptyResult", "multiCategory",
    "promptRules", "secondaryUse", "sourceAndFormat"
  ];
  if (!exactKeys(input.selection, selectionKeys)
    || !isText(input.selection.coreTest) || !isText(input.selection.directness)
    || input.selection.multiCategory !== "allow_all_independently_core"
    || input.selection.secondaryUse !== "metadata_only_no_admission"
    || input.selection.display !== "display_once_across_selected_categories"
    || input.selection.sourceAndFormat !== "never_sufficient_alone"
    || input.selection.emptyResult !== "withhold"
    || !Array.isArray(input.selection.promptRules) || input.selection.promptRules.length === 0
    || input.selection.promptRules.some((rule) => !isText(rule))) {
    throw new TypeError("category admission selection rules invalid");
  }

  if (!Array.isArray(input.categories)
    || input.categories.map((row) => row?.id).join(",") !== TAXONOMY_IDS.join(",")) {
    throw new TypeError("category admission taxonomy coverage invalid");
  }
  for (const row of input.categories) {
    if (!exactKeys(row, ["core", "exclude", "id"])) throw new TypeError("category fields invalid");
    if (!TAXONOMY_SET.has(row.id) || !isText(row.core) || !isText(row.exclude)) {
      throw new TypeError("category admission boundary invalid");
    }
  }

  if (!Array.isArray(input.productDecisions) || input.productDecisions.length === 0) {
    throw new TypeError("category admission product decisions required");
  }
  for (const row of input.productDecisions) {
    if (!exactKeys(row, ["basis", "coreCategories", "id", "secondaryCategories", "summary"])
      || !isText(row.id) || !isText(row.summary) || !isText(row.basis)
      || !Array.isArray(row.coreCategories) || row.coreCategories.length === 0
      || !Array.isArray(row.secondaryCategories)) {
      throw new TypeError("category admission product decision invalid");
    }
    const all = [...row.coreCategories, ...row.secondaryCategories];
    if (all.some((category) => !TAXONOMY_SET.has(category))
      || new Set(row.coreCategories).size !== row.coreCategories.length
      || new Set(row.secondaryCategories).size !== row.secondaryCategories.length
      || row.coreCategories.some((category) => row.secondaryCategories.includes(category))) {
      throw new TypeError("category admission product decision invalid");
    }
  }

  return structuredClone(input);
}

export function renderCategoryAdmissionPrompt(policy) {
  const parsed = parseCategoryAdmissionPolicy(policy);
  return [
    "CATEGORY ADMISSION POLICY:",
    ...parsed.selection.promptRules.map((rule) => `- ${rule}`),
    "",
    "CATEGORY BOUNDARIES:",
    ...parsed.categories.map((row) => `- ${row.id}: CORE ${row.core} EXCLUDE ${row.exclude}`)
  ].join("\n");
}

export const CATEGORY_ADMISSION_POLICY = Object.freeze(parseCategoryAdmissionPolicy(
  JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"))
));
