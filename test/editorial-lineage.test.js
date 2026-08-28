import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITORIAL_LINEAGE_CONTRACT,
  attachEditorialLineage,
  buildSourceEvidence,
  editorialEvidenceHash,
  verifyEditorialLineage
} from "../src/feed/editorial-lineage.js";

const items = [{
  id: "i1",
  title: "기준금리 동결 이후 시장 반응",
  source: "source-a",
  sourceLabel: "출처 A",
  url: "https://example.com/a?utm_source=test&id=7",
  publishedAt: "2026-08-11T00:00:00.000Z",
  editorialCandidate: {
    sourceId: "source-a",
    sourceLabel: "출처 A",
    sourceRole: "reported_secondary",
    ownershipGroup: "owner-a",
    ownershipBasis: "registry_explicit",
    syndicationGroup: null,
    canonicalUrl: "https://example.com/a?id=7",
    observedAt: "2026-08-11T00:05:00.000Z"
  }
}];

function issue() {
  return {
    subject: "기준금리 동결 시장 반응",
    categoryIds: ["business"],
    headline: "관련 보도 흐름에 잡힌 기준금리 동결 시장 반응",
    paragraph: "기준금리 동결 이후 시장 반응을 다룬 보도가 현재 수집 목록에 올라왔다.",
    whatHappened: "기준금리 동결 이후 시장 반응을 다룬 보도가 현재 수집 목록에 올라왔다.",
    whyImportant: "시장 판단에 연결되는 흐름이라 후속 자료를 확인할 가치가 있다.",
    whyHot: "관련 보도 묶음 신호가 확인됐다.",
    whyForYou: "경제·비즈니스를 선택한 오늘판이라 포함했다.",
    watchNext: "공식 자료와 후속 보도가 추가되는지 확인한다.",
    impactLens: "시장·실적",
    metrics: { score: 0, comments: 0, coverage: 5, sourceCount: 1, evidenceMode: "related_coverage_signal" },
    evidence: { mode: "related_coverage_signal", observedFeedCount: 1, relatedCoverageSignal: true },
    sourceEvidence: buildSourceEvidence(items)
  };
}

test("주장 계보는 원문·측정·선택·편집 판단을 분리하고 안정 해시를 만든다", () => {
  const first = attachEditorialLineage(issue(), { selectedCategories: ["business"] });
  const second = attachEditorialLineage(issue(), { selectedCategories: ["business"] });
  assert.equal(first.sourceEvidence[0].canonicalUrl, "https://example.com/a?id=7");
  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal(first.evidenceHash, editorialEvidenceHash(first));
  assert.equal(first.claimLineage.claims.whyHot.basis, "measured_signal");
  assert.equal(first.claimLineage.fingerprintVersion, 5);
  assert.equal(first.claimLineage.claims.whyForYou.basis, "explicit_selection");
  assert.equal(first.claimLineage.claims.whyImportant.basis, "editorial_policy");
  assert.deepEqual(verifyEditorialLineage(first), {
    state: "lineage_pass",
    pass: true,
    evidenceCount: 1,
    claimCount: 7,
    failures: []
  });
});

test("근거 해시나 측정 계보를 사후 변경하면 HOLD다", () => {
  const attached = attachEditorialLineage(issue(), { selectedCategories: ["business"] });
  attached.metrics.coverage = 4;
  const result = verifyEditorialLineage(attached);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("evidence_hash_mismatch"));
  assert.ok(result.failures.includes("measured_lineage_mismatch"));
});

test("독자에게 보이는 주장 문장을 계보 부착 뒤 바꾸면 HOLD다", () => {
  const attached = attachEditorialLineage(issue(), { selectedCategories: ["business"] });
  attached.whyImportant = "근거에 없던 시장 전망을 사후에 덧붙인 문장이다.";
  attached.watchNext = "주가는 반드시 오를 전망이다.";
  const result = verifyEditorialLineage(attached);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("content_hash_mismatch"));
});

test("독자 리드 paragraph만 계보 부착 뒤 바꿔도 HOLD다", () => {
  const attached = attachEditorialLineage(issue(), { selectedCategories: ["business"] });
  attached.paragraph = "근거에 없던 금리 인하 확정과 주가 급등 전망을 덧붙였다.";
  const result = verifyEditorialLineage(attached);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("content_hash_mismatch"));
});

test("주 사건 주장에는 관련기사 관측 근거를 결박하지 않는다", () => {
  assert.equal(EDITORIAL_LINEAGE_CONTRACT.version, 4);
  assert.equal(EDITORIAL_LINEAGE_CONTRACT.fingerprintVersion, 5);
  const sourceEvidence = buildSourceEvidence([{
    ...items[0],
    related: [{
      id: "related-1",
      title: "무관한 신약 임상시험 대상 공개",
      source: "source-b",
      sourceLabel: "출처 B",
      url: "https://example.com/related",
      editorialCandidate: {
        sourceId: "source-b",
        sourceLabel: "출처 B",
        sourceRole: "reported_secondary",
        ownershipGroup: "owner-b",
        canonicalUrl: "https://example.com/related"
      }
    }]
  }]);
  const attached = attachEditorialLineage({ ...issue(), sourceEvidence }, { selectedCategories: ["business"] });
  const leadId = sourceEvidence.find((row) => row.evidenceRole === "lead").evidenceId;
  const relatedId = sourceEvidence.find((row) => row.evidenceRole === "related_observation").evidenceId;

  for (const field of ["headline", "paragraph", "whatHappened", "whyImportant", "watchNext"]) {
    assert.deepEqual(attached.claimLineage.claims[field].evidenceIds, [leadId], `${field}에 관련기사 근거가 섞였다`);
  }
  assert.ok(attached.claimLineage.claims.whyHot.evidenceIds.includes(relatedId), "확산 관측에는 관련기사 신호를 보존한다");

  attached.claimLineage.claims.headline.evidenceIds.push(relatedId);
  assert.ok(verifyEditorialLineage(attached).failures.includes("related_evidence_for_primary_claim:headline"));
});
