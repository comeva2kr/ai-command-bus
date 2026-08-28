// NOWHOT D1-B — blind gold-label workflow. Local files only; no model/network calls.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  D1_IDENTITIES,
  blindPacketHashOf,
  buildBlindPacket,
  buildCanonicalAuthority,
  loadAdversarialAuthority,
  goldDecisionDigestOf,
  releaseGoldState,
  validateGoldContract
} from "../src/feed/selection-classifier-lab.js";
import { CONTENT_TYPES } from "../src/feed/selection-contract.js";
import { CATEGORIES } from "../src/feed/taxonomy.js";

export const D1B_REVIEW_PACKET = "NOWHOT-SELECTION-D1B-BLIND-PACKET-001";
export const D1B_REVIEW_RESPONSE = "NOWHOT-SELECTION-D1B-REVIEW-001";
export const D1B_ADJUDICATION_ASSIGNMENT = "NOWHOT-D1B-ADJUDICATION-001";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = path.join(ROOT, ".nowhot-local", "selection-d1b");
const CORPUS_PATH = path.join(ROOT, "test", "fixtures", "selection-d1-corpus.json");
const GOLD_PATH = path.join(ROOT, "test", "fixtures", "selection-d1-gold.json");
const DECISION_KEYS = [
  "itemId", "blindPacketHash", "contentType", "acceptedCategories",
  "rejectedCategories", "descriptiveSecondaryCategories", "humanValid", "inScope"
];
const REVIEWER_FORBIDDEN = new Set([
  D1_IDENTITIES.productionModelIdentity,
  D1_IDENTITIES.corpusGeneratorIdentity,
  "contract_construction"
].map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US")));
const CATEGORY_ID_LIST = CATEGORIES.map((row) => row.id);
const CATEGORY_IDS = new Set(CATEGORY_ID_LIST);

const clone = (value) => structuredClone(value);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
const stableArray = (value) => [...value].map(String).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identityKey = (value) => value.normalize("NFKC").toLocaleLowerCase("en-US");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  assert(isPlainObject(value), `${label}: object required`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(same(actual, wanted), `${label}: keys must be exactly ${wanted.join(",")}`);
}

function normalizeCategoryArray(value, label) {
  assert(Array.isArray(value), `${label}: array required`);
  assert(value.every((id) => isNonEmptyString(id) && CATEGORY_IDS.has(id)), `${label}: unknown or empty category`);
  assert(new Set(value).size === value.length, `${label}: duplicate category`);
  return stableArray(value);
}

function decisionProjection(decision) {
  const accepted = new Set(decision.acceptedCategories);
  return {
    goldContentType: decision.contentType,
    goldAcceptedCategories: stableArray(decision.acceptedCategories),
    goldRejectedCategories: stableArray(CATEGORY_ID_LIST.filter((id) => !accepted.has(id))),
    descriptiveSecondaryCategories: stableArray(decision.descriptiveSecondaryCategories),
    humanValid: decision.humanValid,
    inScope: decision.inScope
  };
}

function party(identity, blindPacketHash, decisionDigest) {
  return { identity, blindPacketHash, decisionDigest };
}

function unresolvedGoldRow(base, labelerA, labelerB) {
  return {
    ...base,
    state: "disputed",
    goldContentType: null,
    goldAcceptedCategories: [],
    goldRejectedCategories: [],
    descriptiveSecondaryCategories: [],
    humanValid: null,
    inScope: null,
    labelerA,
    labelerB,
    adjudicator: null,
    finalDecisionDigest: null,
    decidedAt: null
  };
}

function resolvedGoldRow(base, state, decision, labelerA, labelerB, adjudicator = null) {
  const fields = decisionProjection(decision);
  const digest = goldDecisionDigestOf(fields);
  return {
    ...base,
    state,
    ...fields,
    labelerA,
    labelerB,
    adjudicator,
    finalDecisionDigest: digest,
    decidedAt: null
  };
}

export function buildBlindReviewPacket(corpus, { assignmentId, corpusSha256 } = {}) {
  assert(isPlainObject(corpus) && Array.isArray(corpus.rows), "corpus: rows required");
  assert(isNonEmptyString(assignmentId), "assignmentId required");
  assert(isNonEmptyString(corpusSha256), "corpusSha256 required");
  const rows = corpus.rows.filter((row) => row.origin === "real_local_snapshot");
  const items = rows.map((row) => ({
    ...buildBlindPacket(row),
    blindPacketHash: blindPacketHashOf(row)
  })).sort((a, b) => a.itemId.localeCompare(b.itemId));
  return {
    contract: D1B_REVIEW_PACKET,
    phase: "D1-B",
    assignmentId,
    corpusContract: corpus.contract,
    corpusSha256,
    count: items.length,
    contentTypes: [...CONTENT_TYPES],
    taxonomy: CATEGORIES.map(({ id, label, labelEn }) => ({ id, label, labelEn })),
    rubric: [
      "Judge only the blind title, excerpt, content-kind hint, country and language in this packet.",
      "acceptedCategories means the item may actually appear when that category alone is selected.",
      "descriptiveSecondaryCategories is descriptive only and never admits the item.",
      "Gold rejectedCategories is derived deterministically as taxonomy minus acceptedCategories; reviewer rejectedCategories is retained only as non-authoritative audit input.",
      "Use deal for a concrete purchase offer; community for a user/community post; news for reporting; other otherwise.",
      "Set humanValid and inScope true when the supplied text is sufficient for this evaluation. Do not use source or declared-category guesses."
    ],
    responseShape: {
      contract: D1B_REVIEW_RESPONSE,
      assignmentId,
      corpusSha256,
      reviewerIdentity: "FILL_WITH_UNIQUE_REVIEWER_ID",
      decisions: DECISION_KEYS
    },
    items
  };
}

export function validateBlindReview(packet, review) {
  assert(isPlainObject(packet) && packet.contract === D1B_REVIEW_PACKET, "packet: wrong contract");
  assert(isPlainObject(review) && review.contract === D1B_REVIEW_RESPONSE, "review: wrong contract");
  assertExactKeys(review, ["contract", "assignmentId", "corpusSha256", "reviewerIdentity", "decisions"], "review");
  assert(review.assignmentId === packet.assignmentId, "review: assignment mismatch");
  assert(review.corpusSha256 === packet.corpusSha256, "review: corpus SHA mismatch");
  assert(isNonEmptyString(review.reviewerIdentity), "review: trimmed reviewerIdentity required");
  assert(!REVIEWER_FORBIDDEN.has(identityKey(review.reviewerIdentity)), "review: reviewer identity is not independent");
  assert(Array.isArray(review.decisions), "review: decisions array required");

  const expected = new Map(packet.items.map((item) => [item.itemId, item]));
  assert(expected.size === packet.items.length, "packet: duplicate itemId");
  assert(review.decisions.length === expected.size, "review: every packet item must have exactly one decision");
  const seen = new Set();
  const decisions = [];

  for (const raw of review.decisions) {
    assertExactKeys(raw, DECISION_KEYS, "review decision");
    assert(isNonEmptyString(raw.itemId) && expected.has(raw.itemId), "review decision: unknown itemId");
    assert(!seen.has(raw.itemId), `review decision: duplicate itemId '${raw.itemId}'`);
    seen.add(raw.itemId);
    const item = expected.get(raw.itemId);
    assert(raw.blindPacketHash === item.blindPacketHash, `review decision: blindPacketHash mismatch '${raw.itemId}'`);
    assert(CONTENT_TYPES.includes(raw.contentType), `review decision: invalid contentType '${raw.itemId}'`);
    assert(typeof raw.humanValid === "boolean" && typeof raw.inScope === "boolean", `review decision: booleans required '${raw.itemId}'`);
    const acceptedCategories = normalizeCategoryArray(raw.acceptedCategories, "acceptedCategories");
    const rejectedCategories = normalizeCategoryArray(raw.rejectedCategories, "rejectedCategories");
    const descriptiveSecondaryCategories = normalizeCategoryArray(raw.descriptiveSecondaryCategories, "descriptiveSecondaryCategories");
    const accepted = new Set(acceptedCategories);
    assert(!rejectedCategories.some((id) => accepted.has(id)), `review decision: accepted/rejected overlap '${raw.itemId}'`);
    assert(!descriptiveSecondaryCategories.some((id) => accepted.has(id)), `review decision: accepted/secondary overlap '${raw.itemId}'`);
    if (raw.contentType === "other" || !raw.humanValid || !raw.inScope) {
      assert(acceptedCategories.length === 0, `review decision: excluded item cannot admit a category '${raw.itemId}'`);
    } else {
      assert(acceptedCategories.length > 0, `review decision: valid in-scope item needs an accepted category '${raw.itemId}'`);
    }
    const normalized = {
      itemId: raw.itemId,
      blindPacketHash: raw.blindPacketHash,
      contentType: raw.contentType,
      acceptedCategories,
      rejectedCategories,
      descriptiveSecondaryCategories,
      humanValid: raw.humanValid,
      inScope: raw.inScope
    };
    normalized.decisionDigest = goldDecisionDigestOf(decisionProjection(normalized));
    decisions.push(normalized);
  }

  decisions.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return { reviewerIdentity: review.reviewerIdentity, decisions };
}

function adjudicationPacketFrom(packet, disagreements) {
  const byId = new Map(packet.items.map((item) => [item.itemId, item]));
  return {
    ...packet,
    assignmentId: D1B_ADJUDICATION_ASSIGNMENT,
    count: disagreements.length,
    responseShape: {
      ...packet.responseShape,
      assignmentId: D1B_ADJUDICATION_ASSIGNMENT,
      reviewerIdentity: "FILL_WITH_UNIQUE_ADJUDICATOR_ID"
    },
    items: disagreements.map((row) => ({
      ...byId.get(row.itemId),
      proposalA: row.decisionA,
      proposalB: row.decisionB
    }))
  };
}

function goldCounts(labels) {
  const counts = { pending: 0, agreed: 0, disputed: 0, adjudicated: 0, contract_fixture_only: 0 };
  for (const label of labels) if (label.state in counts) counts[label.state] += 1;
  return counts;
}

export function reconcileBlindReviews({ corpus, gold, packetA, reviewA, packetB, reviewB, adjudication = null } = {}) {
  assert(isPlainObject(gold) && Array.isArray(gold.labels), "gold: labels required");
  assert(packetA.corpusSha256 === packetB.corpusSha256, "packets: corpus SHA mismatch");
  assert(packetA.assignmentId !== packetB.assignmentId, "packets: A and B assignments must differ");
  const expectedA = buildBlindReviewPacket(corpus, { assignmentId: packetA.assignmentId, corpusSha256: packetA.corpusSha256 });
  const expectedB = buildBlindReviewPacket(corpus, { assignmentId: packetB.assignmentId, corpusSha256: packetB.corpusSha256 });
  assert(same(packetA, expectedA) && same(packetB, expectedB), "packets: content diverges from frozen corpus");
  assert(same(packetA.items, packetB.items), "packets: A and B blind items differ");
  const A = validateBlindReview(packetA, reviewA);
  const B = validateBlindReview(packetB, reviewB);
  assert(identityKey(A.reviewerIdentity) !== identityKey(B.reviewerIdentity), "reviews: A and B identities must differ");
  const byA = new Map(A.decisions.map((row) => [row.itemId, row]));
  const byB = new Map(B.decisions.map((row) => [row.itemId, row]));
  const disagreements = [];
  for (const item of packetA.items) {
    const a = byA.get(item.itemId), b = byB.get(item.itemId);
    if (a.decisionDigest !== b.decisionDigest) disagreements.push({ itemId: item.itemId, decisionA: a, decisionB: b });
  }
  const adjudicationPacket = adjudicationPacketFrom(packetA, disagreements);
  let J = null;
  if (adjudication !== null) {
    J = validateBlindReview(adjudicationPacket, adjudication);
    assert(identityKey(J.reviewerIdentity) !== identityKey(A.reviewerIdentity)
      && identityKey(J.reviewerIdentity) !== identityKey(B.reviewerIdentity),
      "adjudication: identity must differ from A and B");
  }
  const byJ = new Map((J && J.decisions || []).map((row) => [row.itemId, row]));
  const goldById = new Map(gold.labels.map((row) => [row.itemId, row]));
  const labels = gold.labels.map((base) => {
    if (base.origin !== "real_local_snapshot") return clone(base);
    const a = byA.get(base.itemId), b = byB.get(base.itemId);
    assert(a && b, `reviews: missing real item '${base.itemId}'`);
    const pa = party(A.reviewerIdentity, a.blindPacketHash, a.decisionDigest);
    const pb = party(B.reviewerIdentity, b.blindPacketHash, b.decisionDigest);
    if (a.decisionDigest === b.decisionDigest) return resolvedGoldRow(base, "agreed", a, pa, pb);
    const j = byJ.get(base.itemId);
    if (!j) return unresolvedGoldRow(base, pa, pb);
    const pj = party(J.reviewerIdentity, j.blindPacketHash, j.decisionDigest);
    return resolvedGoldRow(base, "adjudicated", j, pa, pb, pj);
  });
  assert(goldById.size === labels.length, "gold: duplicate itemId");

  const authority = loadAdversarialAuthority(JSON.parse(fs.readFileSync(path.join(path.dirname(CORPUS_PATH), "selection-d1g-adversarial-authority-002.json"), "utf8")), { corpusRows: corpus.rows });
  const canonical = buildCanonicalAuthority(corpus.rows, { adversarialAuthority: authority });
  const expectedRealItemIds = corpus.rows.filter((row) => row.origin === "real_local_snapshot").map((row) => row.blindItemId);
  const contractCheck = validateGoldContract(labels, { identities: D1_IDENTITIES, canonical });
  const releaseState = releaseGoldState(labels, { identities: D1_IDENTITIES, canonical, expectedRealItemIds });
  const outputGold = {
    ...gold,
    phase: "D1-B",
    note: "Independent blind A/B labels; disagreements require a distinct adjudicator. Generated locally without model or network calls.",
    normalization: "goldRejectedCategories = full taxonomy minus goldAcceptedCategories",
    counts: goldCounts(labels),
    releaseGoldState: releaseState,
    labels
  };
  return {
    outputGold,
    contractCheck,
    releaseState,
    counts: {
      items: packetA.items.length,
      agreements: packetA.items.length - disagreements.length,
      disagreements: disagreements.length,
      adjudicated: byJ.size
    },
    disagreements,
    adjudicationPacket
  };
}

function readJsonWithRaw(file) {
  const raw = fs.readFileSync(file, "utf8");
  return { raw, value: JSON.parse(raw) };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function prepare(outDir) {
  const corpusFile = readJsonWithRaw(CORPUS_PATH);
  const corpusSha256 = sha256(corpusFile.raw);
  const packetA = buildBlindReviewPacket(corpusFile.value, { assignmentId: "NOWHOT-D1B-LABEL-A-001", corpusSha256 });
  const packetB = buildBlindReviewPacket(corpusFile.value, { assignmentId: "NOWHOT-D1B-LABEL-B-001", corpusSha256 });
  writeJsonAtomic(path.join(outDir, "labeler-a.input.json"), packetA);
  writeJsonAtomic(path.join(outDir, "labeler-b.input.json"), packetB);
  process.stdout.write(`prepared ${packetA.count} blind items in ${path.relative(ROOT, outDir)}\n`);
}

function reconcile(outDir, adjudicationPath) {
  const corpusFile = readJsonWithRaw(CORPUS_PATH);
  const gold = readJsonWithRaw(GOLD_PATH).value;
  const packetA = readJsonWithRaw(path.join(outDir, "labeler-a.input.json")).value;
  const packetB = readJsonWithRaw(path.join(outDir, "labeler-b.input.json")).value;
  const currentCorpusSha = sha256(corpusFile.raw);
  assert(packetA.corpusSha256 === currentCorpusSha && packetB.corpusSha256 === currentCorpusSha,
    "packets: corpus SHA differs from current frozen corpus");
  const reviewA = readJsonWithRaw(path.join(outDir, "labeler-a.response.json")).value;
  const reviewB = readJsonWithRaw(path.join(outDir, "labeler-b.response.json")).value;
  const adjudication = adjudicationPath ? readJsonWithRaw(adjudicationPath).value : null;
  const result = reconcileBlindReviews({ corpus: corpusFile.value, gold, packetA, reviewA, packetB, reviewB, adjudication });
  writeJsonAtomic(path.join(outDir, "comparison.json"), {
    contract: "NOWHOT-SELECTION-D1B-COMPARISON-001",
    phase: "D1-B",
    counts: result.counts,
    releaseState: result.releaseState,
    rejectedGoldRows: result.contractCheck.rejectedItemIds,
    disagreements: result.disagreements
  });
  writeJsonAtomic(path.join(outDir, "adjudicator.input.json"), result.adjudicationPacket);
  writeJsonAtomic(path.join(outDir, adjudication ? "final-gold.candidate.json" : "provisional-gold.json"), result.outputGold);
  process.stdout.write(`agreements=${result.counts.agreements} disagreements=${result.counts.disagreements} adjudicated=${result.counts.adjudicated} release=${result.releaseState}\n`);
  if (result.contractCheck.rejectedItemIds.length > 0) process.exitCode = 1;
}

function usage() {
  process.stderr.write("usage: node tools/selection-d1b-gold.mjs --prepare [out-dir] | --reconcile [out-dir] [adjudicator-response]\n");
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, outArg, adjudicationArg] = process.argv.slice(2);
  const outDir = outArg ? path.resolve(outArg) : DEFAULT_DIR;
  if (mode === "--prepare") prepare(outDir);
  else if (mode === "--reconcile") reconcile(outDir, adjudicationArg ? path.resolve(adjudicationArg) : null);
  else usage();
}
