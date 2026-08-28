import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { loadAdversarialAuthority } from "../src/feed/selection-classifier-lab.js";
import {
  D1K_CATEGORY_AUTHORITY_CONTRACT,
  loadD1kCategoryAuthority
} from "../tools/selection-d1k-authority.mjs";
import { rescoreD1kCategoryRows } from "../tools/rescore-selection-d1k.mjs";

const read = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const BASE_RAW = read("selection-d1g-adversarial-authority-002.json");
const OVERLAY_RAW = read("selection-d1k-category-authority-003.json");
const POLICY_RAW = fs.readFileSync(new URL("../src/feed/category-admission-policy.json", import.meta.url), "utf8");
const CORPUS = JSON.parse(read("selection-d1-corpus.json"));

function load() {
  return loadD1kCategoryAuthority({
    baseRaw: BASE_RAW,
    overlayRaw: OVERLAY_RAW,
    policyRaw: POLICY_RAW,
    corpusRows: CORPUS.rows
  });
}

test("D1K authority-003 changes only the approved gaming-PC category boundary", () => {
  const { document, authority, changedItemIds } = load();
  assert.equal(document.contract, D1K_CATEGORY_AUTHORITY_CONTRACT);
  assert.deepEqual(changedItemIds, ["d1a-03-community-as-news"]);

  const oldDoc = JSON.parse(BASE_RAW);
  const oldById = new Map(oldDoc.decisiveItems.map((row) => [row.blindItemId, row]));
  for (const row of document.decisiveItems) {
    const old = oldById.get(row.blindItemId);
    if (row.blindItemId === "d1a-03-community-as-news") {
      assert.deepEqual(row.expected.acceptedCategories, ["tech", "gaming"]);
      assert.deepEqual(row.expected.secondaryCategories, []);
      assert.deepEqual(old.expected.acceptedCategories, ["tech"]);
      assert.deepEqual(old.expected.secondaryCategories, ["gaming"]);
      continue;
    }
    assert.deepEqual(row, old);
  }

  assert.deepEqual([...authority.byId.keys()].sort(), [...oldById.keys()].sort());
  assert.throws(
    () => loadAdversarialAuthority(document, { corpusRows: CORPUS.rows }),
    /wrong contract id/
  );
});

test("D1K authority overlay fails closed on base, policy, or prior-value drift", () => {
  const cases = [
    ["base SHA", (doc) => { doc.baseAuthoritySha256 = "0".repeat(64); }],
    ["policy SHA", (doc) => { doc.policy.sha256 = "0".repeat(64); }],
    ["prior categories", (doc) => { doc.changes[0].from.acceptedCategories = ["gaming"]; }],
    ["extra change", (doc) => { doc.changes.push(structuredClone(doc.changes[0])); }]
  ];
  for (const [name, mutate] of cases) {
    const overlay = JSON.parse(OVERLAY_RAW);
    mutate(overlay);
    assert.throws(() => loadD1kCategoryAuthority({
      baseRaw: BASE_RAW,
      overlayRaw: JSON.stringify(overlay),
      policyRaw: POLICY_RAW,
      corpusRows: CORPUS.rows
    }), /D1K_AUTHORITY_CORRUPT/, name);
  }
});

test("D1K offline category rescore moves only the approved item: 6/10 to 7/10", () => {
  const { authority: nextAuthority } = load();
  const oldAuthority = loadAdversarialAuthority(JSON.parse(BASE_RAW), { corpusRows: CORPUS.rows });
  const rows = [...nextAuthority.byId.values()].map((entry) => ({
    itemId: entry.blindItemId,
    contentType: entry.expected.contentType,
    acceptedCategories: [...entry.expected.acceptedCategories]
  }));
  const add = (id, category) => rows.find((row) => row.itemId === id).acceptedCategories.push(category);
  add("d1a-05-source-prior-conflict", "tech");
  add("d1a-06-genuine-cross-domain", "tech");
  add("d1a-09-domestic-media-overseas-event", "politics");

  const before = rescoreD1kCategoryRows({ authority: oldAuthority, rows });
  const after = rescoreD1kCategoryRows({ authority: nextAuthority, rows });
  assert.deepEqual({ exact: before.exact, unexpected: before.unexpectedAdmission }, { exact: 6, unexpected: 4 });
  assert.deepEqual({ exact: after.exact, unexpected: after.unexpectedAdmission }, { exact: 7, unexpected: 3 });
  assert.deepEqual(after.failures.map((row) => row.itemId), [
    "d1a-05-source-prior-conflict",
    "d1a-06-genuine-cross-domain",
    "d1a-09-domestic-media-overseas-event"
  ]);
});
