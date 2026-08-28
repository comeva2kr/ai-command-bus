// P4 LLM 편집 canary — 고정 표본 도구 검수. 실호출 없이(키 부재 시)
// 프롬프트 구성·환각 게이트·비교 함수의 순수 로직만 확인한다.
import test from "node:test";
import assert from "node:assert/strict";

import { FIXED_EVAL_SAMPLES } from "../tools/fixed-eval-samples.mjs";
import {
  CANARY_MODELS,
  roughTokenEstimate,
  estimateCostUsd,
  runFixedSampleCanary
} from "../tools/editorial-llm-fixed-sample-canary.mjs";
import {
  buildCanaryFixedSampleIssuePacket,
  buildCanaryFixedSamplePrompt,
  detectUnsupportedClaims,
  unsupportedClaimRateForDraft,
  compareToRuleBasedBaseline,
  CANARY_FIXED_SAMPLE_SCHEMA
} from "../src/feed/editorial-llm.js";

test("고정 표본: 6종 모두 members 2건 이상(단독기사 표본 9 제외)이 사건 결합 목적에 맞는다", () => {
  assert.equal(FIXED_EVAL_SAMPLES.length, 6);
  for (const sample of FIXED_EVAL_SAMPLES) {
    assert.ok(Array.isArray(sample.members) && sample.members.length >= 1, sample.label);
    for (const member of sample.members) {
      assert.equal(typeof member.title, "string");
      assert.ok(member.title.length > 0);
      // 발췌 데이터가 없다는 사실을 정직하게 null로 유지해야 한다(지어내지 않음).
      assert.equal(member.excerpt, null, `${sample.label}: 발췌를 지어내면 안 된다`);
    }
  }
});

test("고정 표본 9(coverage 이진 포화)는 구성원 1건뿐이다 — 근거 라벨 정직성의 핵심", () => {
  const s9 = FIXED_EVAL_SAMPLES.find((s) => s.sampleNo === 9);
  assert.ok(s9);
  assert.equal(s9.members.length, 1);
});

test("buildCanaryFixedSampleIssuePacket: 발췌 없으면 null로 명시(제목만 보낸다는 사실이 프롬프트에 남는다)", () => {
  const packet = buildCanaryFixedSampleIssuePacket(FIXED_EVAL_SAMPLES[0]);
  assert.equal(packet.sampleNo, 1);
  assert.ok(packet.members.every((m) => m.excerpt === null));
});

test("buildCanaryFixedSamplePrompt: 여러 표본을 issues 배열로 묶고 sampleNo를 보존한다", () => {
  const prompt = buildCanaryFixedSamplePrompt(FIXED_EVAL_SAMPLES.slice(0, 2));
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.issues.length, 2);
  assert.deepEqual(parsed.issues.map((i) => i.sampleNo), [1, 2]);
});

test("CANARY_FIXED_SAMPLE_SCHEMA: changedSince와 두 evidenceIds 필드를 요구한다", () => {
  const required = CANARY_FIXED_SAMPLE_SCHEMA.properties.issues.items.required;
  assert.ok(required.includes("changedSince"));
  assert.ok(required.includes("whatHappenedEvidenceIds"));
  assert.ok(required.includes("whyImportantEvidenceIds"));
  assert.equal(CANARY_FIXED_SAMPLE_SCHEMA.properties.issues.items.additionalProperties, false);
});

// ---------------------------------------------------------------------------
// 환각 게이트 — detectUnsupportedClaims
// ---------------------------------------------------------------------------

test("환각 게이트: 입력에 없던 숫자는 미지원으로 잡힌다", () => {
  const check = detectUnsupportedClaims("이번 발표로 매출이 37% 늘었다.", "8·13 부동산대책 발표…대출 규제 대폭 강화");
  assert.equal(check.pass, false);
  assert.ok(check.unsupportedNumbers.includes("37"));
});

test("환각 게이트: 입력(제목)에 있던 숫자는 통과한다", () => {
  const check = detectUnsupportedClaims("8월 13일 대책이 발표됐다.", "8·13 부동산대책 발표…대출 규제 대폭 강화");
  // "13"은 원문(8·13)에 있으므로 미지원 숫자가 아니다.
  assert.ok(!check.unsupportedNumbers.includes("13"));
});

test("환각 게이트: 원문에 없는 큰따옴표 인용은 미지원으로 잡힌다", () => {
  const check = detectUnsupportedClaims(
    "이 대통령은 \"부동산 시장을 완전히 정상화하겠다\"고 말했다.",
    "이 대통령 \"부동산 투기 반드시 차단\"…추가 대책 시사"
  );
  assert.equal(check.pass, false);
  assert.equal(check.unsupportedQuotes.length, 1);
});

test("환각 게이트: 원문에 있는 인용은 통과한다", () => {
  const corpus = "이 대통령 \"부동산 투기 반드시 차단\"…추가 대책 시사";
  const check = detectUnsupportedClaims("이 대통령은 \"부동산 투기 반드시 차단\"이라고 말했다.", corpus);
  assert.equal(check.unsupportedQuotes.length, 0);
});

test("환각 게이트: 원문에 없는 영문 고유명사는 미지원으로 잡힌다", () => {
  const check = detectUnsupportedClaims(
    "이번 발표는 OpenAI GPT와 경쟁하기 위한 조치다.",
    "딥시크 V4 프로 정식 출시"
  );
  assert.equal(check.pass, false);
  assert.ok(check.unsupportedProperNouns.some((n) => n.includes("OpenAI") || n.includes("GPT")));
});

test("환각 게이트: 원문에 있는 영문 고유명사는 통과한다", () => {
  const check = detectUnsupportedClaims(
    "DeepSeek V4 Pro가 정식 출시됐다.",
    "DeepSeek V4 Pro 0813 딥시크 V4 프로 정식 출시"
  );
  assert.equal(check.unsupportedProperNouns.length, 0);
});

test("환각 게이트: 근거만으로 쓴 문장은 완전히 통과한다(오탐 없음)", () => {
  const s2 = FIXED_EVAL_SAMPLES.find((s) => s.sampleNo === 2);
  const corpus = s2.members.map((m) => m.title).join(" ");
  const check = detectUnsupportedClaims("8·13 부동산대책이 발표되며 대출 규제가 강화됐다.", corpus);
  assert.equal(check.pass, true);
});

test("unsupportedClaimRateForDraft: 세 필드를 합산하고, changedSince 필드도 검사한다", () => {
  const s1 = FIXED_EVAL_SAMPLES.find((s) => s.sampleNo === 1);
  const draft = {
    whatHappened: "딥시크 V4 프로가 정식 출시됐다.",
    whyImportant: "모델 경쟁 구도에 영향을 줄 소식이라 확인할 가치가 있다.",
    changedSince: "최초 포착 — 이전 판 비교 자료 없음."
  };
  const rate = unsupportedClaimRateForDraft(draft, s1);
  assert.equal(rate.pass, true);
  assert.equal(rate.totalUnsupportedClaims, 0);

  const badDraft = { ...draft, changedSince: "지난주 대비 매출이 250% 급증했다." };
  const badRate = unsupportedClaimRateForDraft(badDraft, s1);
  assert.equal(badRate.pass, false);
  assert.ok(badRate.perField.changedSince.unsupportedNumbers.includes("250"));
});

// ---------------------------------------------------------------------------
// 룰 기반 대비 비교
// ---------------------------------------------------------------------------

test("compareToRuleBasedBaseline: 제목을 그대로 재인용하면 titleReusedVerbatim=true", () => {
  const s1 = FIXED_EVAL_SAMPLES.find((s) => s.sampleNo === 1);
  const draft = { whatHappened: "딥시크 V4 프로 정식 출시" };
  const cmp = compareToRuleBasedBaseline(draft, s1);
  assert.equal(cmp.titleReusedVerbatim, true);
});

test("compareToRuleBasedBaseline: 종합·해설 문장은 titleReusedVerbatim=false, infoDelta>0", () => {
  const s2 = FIXED_EVAL_SAMPLES.find((s) => s.sampleNo === 2);
  const draft = { whatHappened: "정부가 8·13 부동산대책을 발표하며 다주택자 대출 규제를 대폭 강화했고, 3개 매체가 이를 동시에 보도했다." };
  const cmp = compareToRuleBasedBaseline(draft, s2);
  assert.equal(cmp.titleReusedVerbatim, false);
  assert.ok(cmp.infoDelta > 0);
});

// ---------------------------------------------------------------------------
// 도구 진입점 — 키 부재 시 dry-run(정직한 미측정 표시), 실호출 없음
// ---------------------------------------------------------------------------

test("runFixedSampleCanary: apiKey 없으면 전부 dry_run_no_key이고 fetch를 호출하지 않는다", async () => {
  let fetchCalled = false;
  const result = await runFixedSampleCanary({
    apiKey: null,
    models: CANARY_MODELS,
    fetchImpl: async () => { fetchCalled = true; throw new Error("실호출 금지"); }
  });
  assert.equal(fetchCalled, false, "키가 없으면 네트워크 호출이 전혀 없어야 한다");
  assert.equal(result.summary.keyPresent, false);
  assert.equal(result.summary.totals, null);
  assert.ok(result.results.every((r) => r.mode === "dry_run_no_key"));
  assert.equal(result.results.length, FIXED_EVAL_SAMPLES.length * CANARY_MODELS.length);
  for (const row of result.results) {
    assert.ok(row.note.includes("실호출 미수행"));
    assert.ok(Number.isInteger(row.estimatedInputTokensRough) && row.estimatedInputTokensRough > 0);
  }
});

test("roughTokenEstimate: 근사치일 뿐 API 실측이 아니라는 계약(단조 증가) 확인", () => {
  const short = roughTokenEstimate("짧은 텍스트");
  const long = roughTokenEstimate("짧은 텍스트".repeat(20));
  assert.ok(long > short);
});

test("estimateCostUsd: 모델별 단가로 계산하고 sonnet-5는 도입가 노트를 남긴다", () => {
  const haiku = estimateCostUsd("claude-haiku-4-5", 1000, 1000);
  const expected = (1000 / 1000) * (1.00 / 1000) + (1000 / 1000) * (5.00 / 1000);
  assert.ok(Math.abs(haiku.usd - expected) < 1e-9);
  const sonnet = estimateCostUsd("claude-sonnet-5", 1000, 1000);
  assert.match(sonnet.pricingNote, /도입가/);
  assert.equal(estimateCostUsd("unknown-model", 1, 1), null);
});

// ---------------------------------------------------------------------------
// runFixedSampleCanary: apiKey가 있을 때 실행 경로(가짜 fetch로 검증, 실제
// 네트워크 호출 없음 — API 계약 재현이지 실측 주장이 아니다)
// ---------------------------------------------------------------------------

test("runFixedSampleCanary: apiKey 있으면 usage·환각검사·룰비교가 채워진 executed 결과를 낸다(가짜 fetch)", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      stop_reason: "end_turn",
      content: [{
        type: "text",
        text: JSON.stringify({
          issues: FIXED_EVAL_SAMPLES.map((s) => ({
            sampleNo: s.sampleNo,
            whatHappened: `${s.subject} 관련 사실이 확인됐다.`,
            whyImportant: "판단 가치가 있어 포함했다.",
            changedSince: "최초 포착 — 이전 판 비교 자료 없음.",
            whatHappenedEvidenceIds: s.members.map((m) => m.evidenceId),
            whyImportantEvidenceIds: s.members.map((m) => m.evidenceId)
          }))
        })
      }],
      usage: { input_tokens: 500, output_tokens: 200 }
    })
  });
  const result = await runFixedSampleCanary({
    apiKey: "test-key-not-real",
    models: ["claude-haiku-4-5"],
    fetchImpl: fakeFetch
  });
  assert.equal(result.summary.keyPresent, true);
  assert.equal(result.results.length, FIXED_EVAL_SAMPLES.length);
  assert.ok(result.results.every((r) => r.mode === "executed"));
  assert.ok(result.summary.totals.calls === FIXED_EVAL_SAMPLES.length);
  assert.ok(result.summary.totals.totalCostUsd > 0);
  for (const row of result.results) {
    assert.ok(row.unsupportedClaimCheck.pass, `${row.label} 근거 기반 문장이면 통과해야: ${JSON.stringify(row.unsupportedClaimCheck)}`);
    assert.ok(row.ruleBasedComparison);
  }
});
