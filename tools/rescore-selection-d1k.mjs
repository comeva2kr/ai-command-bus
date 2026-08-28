// D1-K category-only offline rescore. It validates the historical attempt against
// authority-002 first, then applies the reviewed authority-003 category projection.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { d1gCanaryItems, evaluateCanaryShared } from "./run-selection-d1c.mjs";
import { loadAttemptDir } from "./rescore-selection-d1g.mjs";
import { loadD1kCategoryAuthority } from "./selection-d1k-authority.mjs";
import { getCandidateExecutionHold } from "./selection-candidate-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (name) => path.join(ROOT, "test", "fixtures", name);
const DEFAULT_ATTEMPT = path.join(ROOT, ".nowhot-local", "selection-attempts", "d1j-20260821-01");
const DEFAULT_REPORT = path.join(ROOT, ".nowhot-local", "selection-d1k", "rescore-authority-003.json");

const sortedUnique = (values) => Array.isArray(values)
  && values.every((value) => typeof value === "string")
  && new Set(values).size === values.length;

export function rescoreD1kCategoryRows({ authority, rows }) {
  if (!authority?.byId || !(authority.byId instanceof Map)) throw new Error("D1K_RESCORE_CORRUPT: authority required");
  if (!Array.isArray(rows)) throw new Error("D1K_RESCORE_CORRUPT: rows required");
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row.itemId !== "string" || byId.has(row.itemId)
      || typeof row.contentType !== "string" || !sortedUnique(row.acceptedCategories)) {
      throw new Error("D1K_RESCORE_CORRUPT: prediction projection invalid or duplicate");
    }
    byId.set(row.itemId, row);
  }
  const expectedIds = [...authority.byId.keys()];
  if (byId.size !== expectedIds.length || expectedIds.some((id) => !byId.has(id))) {
    throw new Error("D1K_RESCORE_CORRUPT: decisive coverage mismatch");
  }

  let exact = 0;
  let unexpectedAdmission = 0;
  let expectedAdmissionMiss = 0;
  let contentTypeMismatch = 0;
  const failures = [];
  for (const id of expectedIds) {
    const expected = authority.byId.get(id).expected;
    const actual = byId.get(id);
    const expectedSet = new Set(expected.acceptedCategories);
    const actualSet = new Set(actual.acceptedCategories);
    const unexpected = [...actualSet].filter((category) => !expectedSet.has(category)).sort();
    const missed = [...expectedSet].filter((category) => !actualSet.has(category)).sort();
    const contentTypeMatch = actual.contentType === expected.contentType;
    unexpectedAdmission += unexpected.length;
    expectedAdmissionMiss += missed.length;
    if (!contentTypeMatch) contentTypeMismatch += 1;
    if (contentTypeMatch && unexpected.length === 0 && missed.length === 0) exact += 1;
    else failures.push({ itemId: id, unexpected, missed, contentTypeMatch });
  }
  return {
    denominator: expectedIds.length,
    exact,
    unexpectedAdmission,
    expectedAdmissionMiss,
    contentTypeMismatch,
    failures
  };
}

export function rescoreD1kAttempt({ attemptDir = DEFAULT_ATTEMPT, writeReport = false } = {}) {
  const corpus = JSON.parse(fs.readFileSync(FIX("selection-d1-corpus.json"), "utf8"));
  const gold = JSON.parse(fs.readFileSync(FIX("selection-d1-gold.json"), "utf8"));
  const gates = JSON.parse(fs.readFileSync(FIX("selection-d1-gates.lock.json"), "utf8"));
  const loaded = loadD1kCategoryAuthority({
    baseRaw: fs.readFileSync(FIX("selection-d1g-adversarial-authority-002.json"), "utf8"),
    overlayRaw: fs.readFileSync(FIX("selection-d1k-category-authority-003.json"), "utf8"),
    policyRaw: fs.readFileSync(path.join(ROOT, "src", "feed", "category-admission-policy.json"), "utf8"),
    corpusRows: corpus.rows
  });
  const attempt = loadAttemptDir(attemptDir);
  const executionHold = getCandidateExecutionHold(attempt.provenance.candidateId);
  const canaryItems = d1gCanaryItems(corpus);
  const canaryIds = new Set(canaryItems.map((row) => row.blindItemId));
  const canaryPreds = attempt.results.filter((row) => canaryIds.has(row.itemId));
  const gate = evaluateCanaryShared({
    corpus,
    gold,
    canaryItems,
    canaryPreds,
    versions: attempt.versions,
    gates,
    adversarialAuthority: loaded.authority
  });
  const decisiveIds = new Set(loaded.authority.byId.keys());
  const rows = canaryPreds.filter((row) => decisiveIds.has(row.itemId)).map((row) => ({
    itemId: row.itemId,
    contentType: row.classification?.contentType,
    acceptedCategories: (row.classification?.admissionCategories || [])
      .filter((entry) => entry.decision === "accept")
      .map((entry) => entry.category)
  }));
  const category = rescoreD1kCategoryRows({ authority: loaded.authority, rows });
  const detail = gate.adversarialDetail;
  if (!detail || detail.evaluatedValid !== category.denominator
    || detail.unexpectedAdmission !== category.unexpectedAdmission
    || detail.expectedAdmissionMiss !== category.expectedAdmissionMiss
    || detail.contentTypeMismatch !== category.contentTypeMismatch) {
    throw new Error("D1K_RESCORE_CORRUPT: shared evaluator disagreement");
  }

  const report = {
    contract: "NOWHOT-SELECTION-D1K-CATEGORY-RESCORE-001",
    status: gate.categoryAdmissionPass ? "D1K_CATEGORY_PASS" : "D1K_CATEGORY_HOLD",
    sourceAttempt: attempt.provenance,
    sourceAttemptApproval: executionHold
      ? { state: executionHold.state, attemptId: executionHold.attemptId }
      : { state: attempt.provenance.executionState, attemptId: attempt.provenance.attemptId },
    provenanceAuthority: "NOWHOT-SELECTION-D1G-ADVERSARIAL-AUTHORITY-002",
    scoringAuthority: loaded.document.contract,
    changedItemIds: loaded.changedItemIds,
    category: {
      exact: `${category.exact}/${category.denominator}`,
      unexpectedAdmission: category.unexpectedAdmission,
      expectedAdmissionMiss: category.expectedAdmissionMiss,
      contentTypeMismatch: category.contentTypeMismatch,
      failures: category.failures
    },
    sharedGate: {
      categoryAdmissionPass: gate.categoryAdmissionPass,
      mutationLabelChanged: gate.mutationLabelChanged,
      scopeDiagnosticOnlyExcludedFromD1kDecision: true,
      adversarialDetail: detail
    },
    paidCalls: 0,
    productPromotionAllowed: false
  };
  if (writeReport) {
    fs.mkdirSync(path.dirname(DEFAULT_REPORT), { recursive: true });
    fs.writeFileSync(DEFAULT_REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = rescoreD1kAttempt({ writeReport: true });
  process.stdout.write(`${report.status} | category ${report.category.exact} | unexpected ${report.category.unexpectedAdmission} | paid calls 0\n`);
}
