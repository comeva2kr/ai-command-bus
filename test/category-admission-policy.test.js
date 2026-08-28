import test from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORY_ADMISSION_POLICY,
  parseCategoryAdmissionPolicy,
  renderCategoryAdmissionPrompt
} from "../src/feed/category-admission-policy.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";

const TAXONOMY_IDS = CATEGORIES.map((category) => category.id);

test("D1K: category admission policy covers the taxonomy and allows independently core multi-category items", () => {
  assert.equal(CATEGORY_ADMISSION_POLICY.contract, "NOWHOT-CATEGORY-ADMISSION-POLICY-001");
  assert.equal(CATEGORY_ADMISSION_POLICY.version, 1);
  assert.deepEqual(CATEGORY_ADMISSION_POLICY.categories.map((row) => row.id), TAXONOMY_IDS);
  assert.equal(CATEGORY_ADMISSION_POLICY.selection.multiCategory, "allow_all_independently_core");
  assert.equal(CATEGORY_ADMISSION_POLICY.selection.secondaryUse, "metadata_only_no_admission");
  assert.equal(CATEGORY_ADMISSION_POLICY.selection.display, "display_once_across_selected_categories");

  const gamingPc = CATEGORY_ADMISSION_POLICY.productDecisions.find((row) => row.id === "gaming-pc-tech-gaming");
  assert.deepEqual(gamingPc.coreCategories, ["tech", "gaming"]);
  assert.equal(gamingPc.basis, "david_explicit_2026-08-21");
});

test("D1K: malformed or incomplete admission policy fails closed", () => {
  const missing = structuredClone(CATEGORY_ADMISSION_POLICY);
  missing.categories.pop();
  assert.throws(() => parseCategoryAdmissionPolicy(missing), /taxonomy coverage/);

  const duplicate = structuredClone(CATEGORY_ADMISSION_POLICY);
  duplicate.categories[1].id = duplicate.categories[0].id;
  assert.throws(() => parseCategoryAdmissionPolicy(duplicate), /taxonomy coverage/);

  const badDecision = structuredClone(CATEGORY_ADMISSION_POLICY);
  badDecision.productDecisions[0].coreCategories = ["tech", "not-a-category"];
  assert.throws(() => parseCategoryAdmissionPolicy(badDecision), /product decision/);

  const keywordBranch = structuredClone(CATEGORY_ADMISSION_POLICY);
  keywordBranch.categories[0].keywords = ["breaking"];
  assert.throws(() => parseCategoryAdmissionPolicy(keywordBranch), /category fields/);
});

test("D1K: prompt projection states category boundaries without leaking regression examples", () => {
  const prompt = renderCategoryAdmissionPrompt(CATEGORY_ADMISSION_POLICY);
  for (const id of TAXONOMY_IDS) assert.match(prompt, new RegExp(`^\\- ${id}:`, "m"));
  assert.match(prompt, /Accept every category that independently passes the core-user-value test/);
  assert.match(prompt, /A secondary subject never grants admission/);
  assert.match(prompt, /The same item is displayed once/);
  assert.doesNotMatch(prompt, /gaming-pc-tech-gaming|david_explicit|150만원/);
});
