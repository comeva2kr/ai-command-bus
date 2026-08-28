import crypto from "node:crypto";

import { loadAdversarialAuthority } from "../src/feed/selection-classifier-lab.js";
import { parseCategoryAdmissionPolicy } from "../src/feed/category-admission-policy.js";

export const D1K_CATEGORY_AUTHORITY_CONTRACT = "NOWHOT-SELECTION-D1K-CATEGORY-AUTHORITY-003";
const BASE_CONTRACT = "NOWHOT-SELECTION-D1G-ADVERSARIAL-AUTHORITY-002";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const exactKeys = (value, keys) => isObject(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (message) => { throw new Error(`D1K_AUTHORITY_CORRUPT: ${message}`); };

function parseJson(raw, label) {
  try { return JSON.parse(raw); } catch { return fail(`${label} JSON invalid`); }
}

export function loadD1kCategoryAuthority({ baseRaw, overlayRaw, policyRaw, corpusRows }) {
  if (![baseRaw, overlayRaw, policyRaw].every((value) => typeof value === "string")) fail("raw inputs required");
  const base = parseJson(baseRaw, "base authority");
  const overlay = parseJson(overlayRaw, "overlay");
  const policyDocument = parseJson(policyRaw, "policy");
  let policy;
  try { policy = parseCategoryAdmissionPolicy(policyDocument); } catch (error) { return fail(`policy invalid: ${error.message}`); }

  try { loadAdversarialAuthority(base, { corpusRows }); } catch (error) { return fail(`base authority invalid: ${error.message}`); }
  if (!exactKeys(overlay, [
    "baseAuthoritySha256", "changes", "contract", "createdAt", "policy",
    "review", "schemaVersion", "supersedesContract"
  ]) || overlay.contract !== D1K_CATEGORY_AUTHORITY_CONTRACT || overlay.schemaVersion !== 1
    || overlay.supersedesContract !== BASE_CONTRACT || !isText(overlay.createdAt)) {
    fail("overlay contract invalid");
  }
  if (!isSha(overlay.baseAuthoritySha256) || overlay.baseAuthoritySha256 !== sha256(baseRaw)) fail("base authority SHA mismatch");
  if (!exactKeys(overlay.policy, ["contract", "sha256", "version"])
    || overlay.policy.contract !== policy.contract || overlay.policy.version !== policy.version
    || !isSha(overlay.policy.sha256) || overlay.policy.sha256 !== sha256(policyRaw)) {
    fail("policy identity mismatch");
  }
  if (!exactKeys(overlay.review, ["model", "phaseABlindness", "receiptSha256", "verdict"])
    || !isText(overlay.review.model) || !isText(overlay.review.phaseABlindness)
    || overlay.review.verdict !== "PASS_WITH_LIMITATION" || !isSha(overlay.review.receiptSha256)) {
    fail("review provenance invalid");
  }
  if (!Array.isArray(overlay.changes) || overlay.changes.length !== 1) fail("exactly one reviewed change required");

  const change = overlay.changes[0];
  if (!exactKeys(change, [
    "basis", "blindItemId", "evidenceHash", "from", "policyDecisionId", "to"
  ]) || !isText(change.blindItemId) || !isText(change.basis) || !isText(change.policyDecisionId)
    || !isSha(change.evidenceHash) || !exactKeys(change.from, ["acceptedCategories", "secondaryCategories"])
    || !exactKeys(change.to, ["acceptedCategories", "secondaryCategories"])) {
    fail("change contract invalid");
  }
  const baseItem = base.decisiveItems.find((row) => row.blindItemId === change.blindItemId);
  if (!baseItem || baseItem.evidenceHash !== change.evidenceHash) fail("changed item identity mismatch");
  if (!same(change.from.acceptedCategories, baseItem.expected.acceptedCategories)
    || !same(change.from.secondaryCategories, baseItem.expected.secondaryCategories || [])) {
    fail("prior authority value mismatch");
  }
  const decision = policy.productDecisions.find((row) => row.id === change.policyDecisionId);
  if (!decision || !same(change.to.acceptedCategories, decision.coreCategories)
    || !same(change.to.secondaryCategories, decision.secondaryCategories)) {
    fail("change does not match bound product decision");
  }

  const document = structuredClone(base);
  document.contract = D1K_CATEGORY_AUTHORITY_CONTRACT;
  document.createdAt = overlay.createdAt;
  document.supersedes = BASE_CONTRACT;
  document.purpose = "D1-K category-admission projection; authority-002 remains the immutable attempt provenance authority.";
  document.categoryPolicy = structuredClone(overlay.policy);
  document.categoryReview = structuredClone(overlay.review);
  const target = document.decisiveItems.find((row) => row.blindItemId === change.blindItemId);
  target.expected.acceptedCategories = [...change.to.acceptedCategories];
  target.expected.secondaryCategories = [...change.to.secondaryCategories];
  target.secondaryCategories = [...change.to.secondaryCategories];

  let authority;
  try {
    authority = loadAdversarialAuthority(document, {
      corpusRows,
      expectedContract: D1K_CATEGORY_AUTHORITY_CONTRACT
    });
  } catch (error) { return fail(`derived authority invalid: ${error.message}`); }
  return { document, authority, changedItemIds: [change.blindItemId], overlay: structuredClone(overlay) };
}
