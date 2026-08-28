import { test } from "node:test";
import assert from "node:assert/strict";
import { attachEditorialLineage } from "../src/feed/editorial-lineage.js";
import { buildEditorialLlmPacket, makeEvidenceEditorialPipeline } from "../src/feed/editorial-llm.js";

function evidenceIssue() {
  return attachEditorialLineage({
    subject: "기준금리 동결 시장 반응",
    categoryIds: ["business"],
    headline: "관련 보도 흐름에 잡힌 “기준금리 동결 시장 반응”",
    paragraph: "“기준금리 동결 이후 시장 반응”은 관련 기사들이 함께 묶여 노출된 소식이다.",
    whatHappened: "“기준금리 동결 이후 시장 반응”은 관련 기사들이 함께 묶여 노출된 소식이다.",
    whyImportant: "시장 판단에 연결되는 흐름이라 후속 자료를 확인할 가치가 있다.",
    whyHot: "관련 보도 묶음 신호가 확인됐다.",
    whyForYou: "경제·비즈니스를 선택한 오늘판이라 포함했다.",
    watchNext: "다른 피드에서도 같은 사실이 확인되는지 후속 보도를 대조한다.",
    impactLens: "시장·실적",
    metrics: { score: 0, comments: 0, coverage: 5, sourceCount: 1, evidenceMode: "related_coverage_signal" },
    evidence: { mode: "related_coverage_signal", observedFeedCount: 1, relatedCoverageSignal: true },
    sourceEvidence: [{
      evidenceId: "NHE-source-a",
      title: "기준금리 동결 이후 시장 반응",
      sourceId: "source-a",
      sourceLabel: "출처 A",
      sourceRole: "reported_secondary",
      ownershipGroup: "owner-a",
      ownershipBasis: "registry_explicit",
      syndicationGroup: null,
      canonicalUrl: "https://example.com/a",
      publishedAt: "2026-08-11T00:00:00.000Z",
      observedAt: "2026-08-11T00:05:00.000Z",
      evidenceRole: "lead"
    }]
  }, { selectedCategories: ["business"] });
}

const edition = () => ({
  editionId: "2026-08-11-morning-business",
  publishable: true,
  editorialMode: "deterministic_evidence_editor",
  llmCalls: 0,
  issues: [evidenceIssue()]
});

function responses({ supported = true } = {}) {
  let calls = 0;
  const invoke = async () => {
    calls += 1;
    if (calls === 1) return {
      parsed: { issues: [{
        n: 1,
        evidenceHash: evidenceIssue().evidenceHash,
        headline: "기준금리 동결 시장 반응, 후속 자료 확인 필요",
        whatHappened: "기준금리 동결 뒤 시장 반응을 다룬 보도가 수집 목록에서 관측됐다. 현재 확인된 제목 범위의 흐름을 정리한 것이다.",
        whyImportant: "시장 판단에 연결되는 사안이어서 후속 자료와 보도 변화를 함께 확인할 가치가 있다.",
        headlineEvidenceIds: ["NHE-source-a"],
        whatHappenedEvidenceIds: ["NHE-source-a"],
        whyImportantEvidenceIds: ["NHE-source-a"]
      }] },
      usage: { input_tokens: 100, output_tokens: 80 }
    };
    return {
      parsed: { issues: [{
        n: 1,
        headlineSupported: supported,
        whatHappenedSupported: supported,
        whyImportantSupported: supported,
        reason: supported ? "입력 제목 범위에서 지원됨" : "근거 부족"
      }] },
      usage: { input_tokens: 70, output_tokens: 20 }
    };
  };
  return { invoke, count: () => calls };
}

test("LLM은 판본당 편집·검증 두 번만 호출하고 검증된 문장만 적용한다", async () => {
  const fake = responses();
  const cache = new Map();
  const pipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: "test",
    invoke: fake.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    clock: () => Date.parse("2026-08-11T01:00:00.000Z")
  });
  const first = await pipeline(edition());
  assert.equal(fake.count(), 2);
  assert.equal(first.editorialMode, "evidence_llm_verified");
  assert.equal(first.issues[0].editorialEdit.state, "verified_edit");
  assert.equal(first.editorialLlm.edited, 1);
  assert.equal(first.editorialLlm.inputTokens, 170);
  assert.equal(first.editorialLlm.model, "claude-sonnet-5");
  assert.equal(first.issues[0].whyHot, "관련 보도 묶음 신호가 확인됐다.", "측정 문장은 모델이 덮으면 안 된다");

  const second = await pipeline(edition());
  assert.equal(fake.count(), 2, "같은 evidenceHash를 다시 호출했다");
  assert.equal(second.editorialLlm.state, "cache_only");
  assert.equal(second.issues[0].headline, first.issues[0].headline);
});

test("같은 사건의 동시 판 생성은 편집을 한 번만 만들고 같은 정본을 공유한다", async () => {
  const cache = new Map();
  let calls = 0;
  let editorCalls = 0;
  const pipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: "test",
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) },
    invoke: async ({ purpose } = {}) => {
      calls += 1;
      if (purpose === "개인 오늘판 근거 편집") {
        const variant = ++editorCalls;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { parsed: { issues: [{
          n: 1,
          evidenceHash: evidenceIssue().evidenceHash,
          headline: `기준금리 동결 시장 반응, 후속 자료 확인 필요 ${variant}`,
          whatHappened: "기준금리 동결 뒤 시장 반응을 다룬 보도가 수집 목록에서 관측됐다. 현재 확인된 제목 범위의 흐름을 정리한 것이다.",
          whyImportant: "시장 판단에 연결되는 사안이어서 후속 자료와 보도 변화를 함께 확인할 가치가 있다.",
          headlineEvidenceIds: ["NHE-source-a"],
          whatHappenedEvidenceIds: ["NHE-source-a"],
          whyImportantEvidenceIds: ["NHE-source-a"]
        }] } };
      }
      return { parsed: { issues: [{
        n: 1,
        headlineSupported: true,
        whatHappenedSupported: true,
        whyImportantSupported: true,
        reason: "입력 제목 범위에서 지원됨"
      }] } };
    }
  });
  const otherEdition = { ...edition(), editionId: "2026-08-11-morning-business-tech" };

  const [left, right] = await Promise.all([pipeline(edition()), pipeline(otherEdition)]);

  assert.equal(calls, 2, "같은 사건을 카테고리 조합마다 다시 편집했다");
  assert.equal(left.issues[0].headline, right.issues[0].headline);
  assert.equal(right.editorialLlm.state, "cache_only");
});

test("검증자가 하나라도 거부하면 결정론적 문장을 유지하고 캐시하지 않는다", async () => {
  const fake = responses({ supported: false });
  const cache = new Map();
  const base = edition();
  const pipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: "test",
    invoke: fake.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });
  const out = await pipeline(base);
  assert.equal(out.issues[0].headline, base.issues[0].headline);
  assert.equal(out.editorialLlm.state, "verification_hold");
  assert.equal(out.editorialLlm.rejected, 1);
  assert.equal(cache.size, 0);
});

test("검증자 영수증이 빠진 편집 캐시는 재사용하지 않고 다시 검증한다", async () => {
  const cache = new Map();
  const firstFake = responses();
  const firstPipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: "test",
    invoke: firstFake.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });
  await firstPipeline(edition());
  const cacheKey = [...cache.keys()][0];
  const cached = cache.get(cacheKey);
  cache.set(cacheKey, { ...cached, verifier: null });

  const secondFake = responses();
  const secondPipeline = makeEvidenceEditorialPipeline({
    enabled: true,
    apiKey: "test",
    invoke: secondFake.invoke,
    cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) }
  });
  const out = await secondPipeline(edition());
  assert.equal(secondFake.count(), 2);
  assert.equal(out.editorialLlm.state, "verified_edits_applied");
  assert.equal(out.issues[0].editorialEdit.state, "verified_edit");
});

test("플래그나 키가 없으면 호출 없이 현재 판을 그대로 제공한다", async () => {
  for (const options of [{ enabled: false, apiKey: "test" }, { enabled: true, apiKey: null }]) {
    let calls = 0;
    const base = edition();
    const out = await makeEvidenceEditorialPipeline({
      ...options,
      invoke: async () => { calls += 1; throw new Error("호출되면 안 됨"); }
    })(base);
    assert.equal(calls, 0);
    assert.equal(out.issues[0].paragraph, base.issues[0].paragraph);
    assert.equal(out.editorialLlm.calls, 0);
    assert.equal(out.editorialLlm.model, null);
    assert.equal(out.editorialLlm.configuredModel, "claude-sonnet-5");
  }
});

test("모델 입력은 근거 ID·제목만 보내고 URL·원문 전문·사용자 ID를 싣지 않는다", () => {
  const packet = JSON.stringify(buildEditorialLlmPacket([{ issue: evidenceIssue() }]));
  assert.match(packet, /NHE-source-a/);
  assert.match(packet, /기준금리 동결 이후 시장 반응/);
  assert.doesNotMatch(packet, /https:\/\//);
  assert.doesNotMatch(packet, /userId|canonicalUrl/);
});
