import { assessEditorialDraft } from "./editorial-quality.js";
import { attachEditorialLineage, verifyEditorialLineage } from "./editorial-lineage.js";
import { callStructuredMessage, validParagraph } from "./llm.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_LLM_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-LLM-RUNTIME-001",
  version: 2,
  promptVersion: 2,
  unit: "shared_edition_batch",
  callsPerBatch: 2,
  cacheKey: "evidenceHash+contractVersion+promptVersion+model+verifierModel",
  generatedFields: ["headline", "whatHappened", "whyImportant"],
  deterministicFields: ["whyHot", "whyForYou", "watchNext", "metrics"],
  fallback: "deterministic_evidence_editor",
  publishRule: "editor와 verifier를 모두 통과한 필드만 적용"
});

export const EDITORIAL_LLM_CANARY_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-LLM-CANARY-001",
  localOnly: true,
  maxIssues: 3,
  maxCalls: 2,
  approvalEnv: "NOWHOT_LLM_CANARY_APPROVED",
  keyEnv: "ANTHROPIC_API_KEY"
});

const EDITOR_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          evidenceHash: { type: "string" },
          headline: { type: "string" },
          whatHappened: { type: "string" },
          whyImportant: { type: "string" },
          headlineEvidenceIds: { type: "array", items: { type: "string" } },
          whatHappenedEvidenceIds: { type: "array", items: { type: "string" } },
          whyImportantEvidenceIds: { type: "array", items: { type: "string" } }
        },
        required: [
          "n", "evidenceHash", "headline", "whatHappened", "whyImportant",
          "headlineEvidenceIds", "whatHappenedEvidenceIds", "whyImportantEvidenceIds"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          headlineSupported: { type: "boolean" },
          whatHappenedSupported: { type: "boolean" },
          whyImportantSupported: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["n", "headlineSupported", "whatHappenedSupported", "whyImportantSupported", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

const EDITOR_SYSTEM = `당신은 지금핫의 근거 제한 편집자입니다.
입력 JSON의 sourceEvidence 제목과 deterministicDraft 안에서만 한국어 편집문을 작성하십시오.
외부 지식, 배경 사실, 원인, 결과, 전망, 인물 속성, 수치를 새로 만들지 마십시오.
headline에는 입력 subject를 글자 그대로 포함하십시오.
whatHappened는 무슨 내용이 관측됐는지 두 문장 이내로 씁니다.
whyImportant는 사실을 추가하지 않고 해당 소식을 읽을 판단 가치만 한 문장으로 씁니다.
각 필드가 실제 사용한 evidenceId만 넣고, 근거가 부족하면 결정론적 초안을 유지하십시오.
추천·댓글·조회·관련 보도 개수는 쓰지 마십시오.`;

const VERIFY_SYSTEM = `당신은 지금핫 편집자와 분리된 엄격한 근거 검증자입니다.
sourceEvidence 제목만 근거로 draft의 세 필드를 각각 판정하십시오.
외부 지식이 있어야 맞는 문장, 제목에 없는 원인·결과·전망·수치·인물 속성은 false입니다.
whyImportant는 새로운 사실을 단정하지 않고 읽을 가치만 설명하면 true일 수 있습니다.
근거 ID가 존재해도 문장을 실제로 뒷받침하지 않으면 false입니다.`;

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).filter(Boolean))];

function editorialCacheKey(issue, model, verifierModel) {
  return [
    issue && issue.evidenceHash,
    EDITORIAL_LLM_CONTRACT.stableId,
    `v${EDITORIAL_LLM_CONTRACT.version}`,
    `p${EDITORIAL_LLM_CONTRACT.promptVersion}`,
    model,
    verifierModel
  ].join("|");
}

function verifiedCacheRecord(hit, model, verifierModel) {
  return Boolean(hit && hit.draft && hit.verifier &&
    hit.contractId === EDITORIAL_LLM_CONTRACT.stableId &&
    hit.contractVersion === EDITORIAL_LLM_CONTRACT.version &&
    hit.promptVersion === EDITORIAL_LLM_CONTRACT.promptVersion &&
    hit.model === model && hit.verifierModel === verifierModel);
}

export function buildEditorialLlmPacket(rows) {
  return (rows || []).map(({ issue }, index) => ({
    n: index + 1,
    evidenceHash: issue.evidenceHash,
    subject: issue.subject,
    categoryIds: issue.categoryIds || [],
    evidenceMode: issue.evidence && issue.evidence.mode || "unknown",
    sourceEvidence: (issue.sourceEvidence || []).map((row) => ({
      evidenceId: row.evidenceId,
      sourceLabel: row.sourceLabel,
      sourceRole: row.sourceRole,
      evidenceRole: row.evidenceRole,
      title: row.title
    })),
    deterministicDraft: {
      headline: issue.headline,
      whatHappened: issue.whatHappened || issue.paragraph,
      whyImportant: issue.whyImportant
    }
  }));
}

const promptFor = (packet) => JSON.stringify({ instructions: "모든 행을 같은 n으로 반환", issues: packet });
const verifierPromptFor = (packet, drafts) => JSON.stringify({
  instructions: "각 필드를 독립 판정하고 모든 행을 같은 n으로 반환",
  issues: packet.map((row, index) => ({
    n: row.n,
    subject: row.subject,
    evidenceMode: row.evidenceMode,
    sourceEvidence: row.sourceEvidence,
    draft: drafts[index]
  }))
});

function supportIds(draft) {
  return unique([
    ...(draft && draft.headlineEvidenceIds || []),
    ...(draft && draft.whatHappenedEvidenceIds || []),
    ...(draft && draft.whyImportantEvidenceIds || [])
  ]);
}

function checkedDraft(issue, draft, verifier, prompt) {
  const known = new Set((issue.sourceEvidence || []).map((row) => row.evidenceId));
  const ids = supportIds(draft);
  const supportByField = [
    draft && draft.headlineEvidenceIds,
    draft && draft.whatHappenedEvidenceIds,
    draft && draft.whyImportantEvidenceIds
  ];
  const sourceLabels = (issue.sourceEvidence || []).map((row) => row.sourceLabel);
  const fieldsSupported = verifier && verifier.headlineSupported &&
    verifier.whatHappenedSupported && verifier.whyImportantSupported;
  const gate = assessEditorialDraft({
    headline: draft && draft.headline,
    paragraph: draft && draft.whatHappened,
    subject: issue.subject,
    evidence: issue.evidence,
    sourceLabels
  });
  const checks = {
    evidenceHash: draft && draft.evidenceHash === issue.evidenceHash,
    supportPresent: supportByField.every((fieldIds) => Array.isArray(fieldIds) && fieldIds.length > 0),
    supportKnown: supportByField.every((fieldIds) =>
      Array.isArray(fieldIds) && fieldIds.every((id) => known.has(id))),
    headline: validParagraph(draft && draft.headline, { min: 10, max: 110, source: prompt }) &&
      clean(draft.headline).includes(clean(issue.subject)),
    whatHappened: validParagraph(draft && draft.whatHappened, { min: 32, max: 420, source: prompt }),
    whyImportant: validParagraph(draft && draft.whyImportant, { min: 24, max: 280, source: prompt }),
    machineGate: gate.pass,
    verifier: Boolean(fieldsSupported)
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    gate,
    failures: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name)
  };
}

function applyDraft(issue, draft, verifier, { model, verifierModel, observedAt }) {
  const selectedCategories = issue.claimLineage && issue.claimLineage.claims &&
    issue.claimLineage.claims.whyForYou && issue.claimLineage.claims.whyForYou.categoryIds || [];
  return attachEditorialLineage({
    ...issue,
    deterministicDraft: issue.deterministicDraft || {
      headline: issue.headline,
      whatHappened: issue.whatHappened || issue.paragraph,
      whyImportant: issue.whyImportant
    },
    headline: clean(draft.headline),
    paragraph: clean(draft.whatHappened),
    whatHappened: clean(draft.whatHappened),
    whyImportant: clean(draft.whyImportant),
    editorialGate: assessEditorialDraft({
      headline: draft.headline,
      paragraph: draft.whatHappened,
      subject: issue.subject,
      evidence: issue.evidence,
      sourceLabels: (issue.sourceEvidence || []).map((row) => row.sourceLabel)
    }),
    editorialEdit: {
      contractId: EDITORIAL_LLM_CONTRACT.stableId,
      state: "verified_edit",
      evidenceHash: issue.evidenceHash,
      model,
      verifierModel,
      observedAt,
      support: {
        headline: draft.headlineEvidenceIds,
        whatHappened: draft.whatHappenedEvidenceIds,
        whyImportant: draft.whyImportantEvidenceIds
      },
      verifierReason: verifier && verifier.reason || "cached_verified_edit"
    }
  }, { selectedCategories });
}

function receipt(state, edition, extra = {}) {
  return {
    contractId: EDITORIAL_LLM_CONTRACT.stableId,
    state,
    enabled: Boolean(extra.enabled),
    editionId: edition && edition.editionId || null,
    issueCount: edition && edition.issues && edition.issues.length || 0,
    eligible: extra.eligible || 0,
    cacheHits: extra.cacheHits || 0,
    requested: extra.requested || 0,
    edited: extra.edited || 0,
    rejected: extra.rejected || 0,
    deferredDeterministic: extra.deferredDeterministic || 0,
    calls: extra.calls || 0,
    inputTokens: extra.inputTokens || 0,
    outputTokens: extra.outputTokens || 0,
    configuredModel: extra.model || null,
    configuredVerifierModel: extra.verifierModel || null,
    model: extra.calls || extra.cacheHits ? extra.model || null : null,
    verifierModel: extra.calls || extra.cacheHits ? extra.verifierModel || null : null,
    error: extra.error || null,
    proves: "근거 해시별 캐시·배치 편집·분리 검증·결정론적 폴백 경로",
    doesNotProve: "실제 모델 품질·사람 검수 PASS·운영 배포"
  };
}

// ─────────────────────────────────────────────────────────────────────────
// P4 canary — 고정 표본 측정 전용 (David 승인: canary 실측만, 상시 ON 아님).
// 이 구간은 위 프로덕션 파이프라인(EDITOR_SCHEMA·EDITOR_SYSTEM·
// makeEvidenceEditorialPipeline)을 건드리지 않는 순수 추가다. 목적은
// 사건 클러스터(대표+구성원 제목·발췌·출처)를 읽고 whatHappened·whyImportant·
// changedSince를 사람 문장으로 쓰게 하고, 비용·환각을 측정하는 것뿐이다.
// tools/editorial-llm-fixed-sample-canary.mjs가 이 구간을 호출한다.
// ─────────────────────────────────────────────────────────────────────────

export const CANARY_FIXED_SAMPLE_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-LLM-FIXED-SAMPLE-CANARY-001",
  purpose: "고정 평가 표본(블루프린트 v4) 한정 비용·지연·미지원 주장률 실측",
  generatedFields: ["whatHappened", "whyImportant", "changedSince"],
  fallback: "없음 — canary는 편집 결과를 운영에 적용하지 않는다(측정 전용)"
});

export const CANARY_FIXED_SAMPLE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sampleNo: { type: "integer" },
          whatHappened: { type: "string" },
          whyImportant: { type: "string" },
          changedSince: { type: "string" },
          whatHappenedEvidenceIds: { type: "array", items: { type: "string" } },
          whyImportantEvidenceIds: { type: "array", items: { type: "string" } }
        },
        required: [
          "sampleNo", "whatHappened", "whyImportant", "changedSince",
          "whatHappenedEvidenceIds", "whyImportantEvidenceIds"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

export const CANARY_FIXED_SAMPLE_SYSTEM = `당신은 지금핫의 근거 제한 편집자입니다. 입력으로 사건 하나당 대표 주제와
구성원 기사(제목·매체·역할, 발췌가 있으면 발췌도)를 받습니다.

규칙:
- 입력에 있는 제목·발췌·출처 밖의 사실, 배경지식, 원인, 결과, 전망, 인물
  속성, 수치, 인용문을 새로 만들지 마십시오.
- whatHappened: 이 사건에서 무슨 일이 있었는지 두 문장 이내 사람 문장으로
  씁니다. 제목을 그대로 옮기지 말고 구성원 기사들을 종합해 서술하십시오.
- whyImportant: 사실을 추가하지 않고 이 소식을 읽을 판단 가치를 한 문장으로
  씁니다(예: 시장·정책·생활에 미치는 영향의 종류).
- changedSince: 이 표본은 판 간 비교 데이터가 없는 단발 스냅샷입니다.
  이전 판 정보가 주어지지 않았다면 반드시 "최초 포착 — 이전 판 비교 자료
  없음"이라고만 쓰고, 이전 상태를 지어내지 마십시오.
- 구성원 기사가 1건뿐이면 "여러 매체가 보도했다", "복수 확인" 같은 근거 없는
  다중 출처 주장을 절대 쓰지 마십시오 — 실제 확인된 매체 수만큼만 말하십시오.
- 각 필드가 실제 사용한 evidenceId만 배열에 넣으십시오.
- 추천·댓글·조회수 등 반응 수치는 언급하지 마십시오.`;

// 프롬프트에 발췌가 있으면 쓰고 없으면 제목·출처만 준다 — 정직한 저하 동작.
export function buildCanaryFixedSampleIssuePacket(sample) {
  return {
    sampleNo: sample.sampleNo,
    subject: sample.subject,
    categoryIds: sample.categoryIds || [],
    members: (sample.members || []).map((row) => ({
      evidenceId: row.evidenceId,
      title: row.title,
      sourceLabel: row.sourceLabel,
      sourceRole: row.sourceRole,
      excerpt: row.excerpt || null
    }))
  };
}

export function buildCanaryFixedSamplePrompt(samples) {
  const issues = (Array.isArray(samples) ? samples : [samples])
    .map(buildCanaryFixedSampleIssuePacket);
  return JSON.stringify({
    instructions: "각 사건을 독립적으로 판단하고 모든 sampleNo를 그대로 반환",
    issues
  });
}

// 환각 게이트 — 생성 문장의 숫자·따옴표 인용·영문 고유명사가 입력 근거(제목+
// 발췌) 안에 있는지 대조한다. 완벽한 한국어 명사구 판별(형태소 분석)은 이
// 저장소에 없으므로, llm.js validParagraph와 같은 원칙(입력에 없던 숫자는
// 지어낸 것)에 두 가지를 더한다: ①큰따옴표로 감싼 인용구는 원문에 있어야
// 하고 ②영문 대문자 시작 토큰(고유명사 근사)은 원문에 있어야 한다. 이 셋
// 밖의 한국어 고유명사 오검출은 이 함수가 잡지 못한다 — 보고서에 정직히
// 명시한다(완벽한 검증이 아니라 실무적 하한선).
const QUOTE_RE = /[“"]([^”"]{2,80})[”"]/g;
// 최소 3자(대문자+2)로 잡아 AI·IT·TV·PC 같은 흔한 2자 약어의 오탐을 줄인다 —
// 그래도 짧은 실제 고유명사(V4 등)는 놓칠 수 있다는 한계는 남는다.
const EN_PROPER_RE = /\b[A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{1,}){0,3}\b/g;
const DIGIT_RE = /[0-9]+/g;

export function detectUnsupportedClaims(text, evidenceCorpus) {
  const t = String(text || "");
  const corpus = String(evidenceCorpus || "");
  const corpusDigits = new Set(corpus.match(DIGIT_RE) || []);
  const unsupportedNumbers = [...new Set(t.match(DIGIT_RE) || [])]
    .filter((n) => !corpusDigits.has(n));

  const unsupportedQuotes = [...t.matchAll(QUOTE_RE)]
    .map((m) => m[1].trim())
    .filter((q) => q && !corpus.includes(q));

  const corpusLower = corpus.toLowerCase();
  const unsupportedProperNouns = [...new Set((t.match(EN_PROPER_RE) || []))]
    .filter((name) => !corpusLower.includes(name.toLowerCase()));

  const claims = unsupportedNumbers.length + unsupportedQuotes.length + unsupportedProperNouns.length;
  return {
    pass: claims === 0,
    unsupportedNumbers,
    unsupportedQuotes,
    unsupportedProperNouns,
    unsupportedClaimCount: claims,
    doesNotProve: "완벽한 한국어 고유명사 판별 — 숫자·인용구·영문 고유명사만 대조하는 실무적 하한선"
  };
}

export function unsupportedClaimRateForDraft(draft, sample) {
  const corpus = (sample.members || []).map((m) => `${m.title} ${m.excerpt || ""}`).join(" ");
  const fields = ["whatHappened", "whyImportant", "changedSince"];
  const perField = {};
  let totalClaims = 0;
  for (const field of fields) {
    const check = detectUnsupportedClaims(draft && draft[field], corpus);
    perField[field] = check;
    totalClaims += check.unsupportedClaimCount;
  }
  return { perField, totalUnsupportedClaims: totalClaims, pass: totalClaims === 0 };
}

// 룰 기반 대비 품질 실측 보조 — 제목 재인용 여부(자카드 유사)·정보량(문자수 차)
export function compareToRuleBasedBaseline(draft, sample) {
  const baseline = sample.ruleBasedBaseline || {};
  const baselineText = String(baseline.headline || baseline.whatHappened || "");
  const draftText = String((draft && draft.whatHappened) || "");
  const titleReused = baselineText && draftText
    ? draftText.includes(baselineText) || baselineText.includes(draftText)
    : null;
  return {
    baselineChars: baselineText.length,
    draftChars: draftText.length,
    infoDelta: draftText.length - baselineText.length,
    titleReusedVerbatim: titleReused,
    baselineNote: baseline.note || null
  };
}

export function makeEvidenceEditorialPipeline({
  enabled = false,
  apiKey = null,
  model = "claude-sonnet-5",
  verifierModel = "claude-haiku-4-5",
  maxIssues = 24,
  fetchImpl = fetch,
  cache = null,
  onUsage = null,
  log = () => {},
  clock = () => Date.now(),
  invoke = callStructuredMessage
} = {}) {
  const memory = new Map();
  const edits = cache || { get: (key) => memory.get(key), set: (key, value) => memory.set(key, value) };
  const inFlight = new Map();
  const limit = Math.max(1, Math.min(24, Math.floor(Number(maxIssues) || 24)));

  async function enrich(edition) {
    const issues = Array.isArray(edition && edition.issues) ? edition.issues : [];
    const eligible = issues.map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => verifyEditorialLineage(issue).pass);
    const base = { enabled, eligible: eligible.length, model, verifierModel };
    if (!enabled || !apiKey || !eligible.length || !edition.publishable) {
      const state = !enabled ? "disabled"
        : !apiKey ? "key_unavailable"
          : !edition.publishable ? "unpublished_fallback"
            : "no_eligible_issues";
      return { ...edition, editorialLlm: receipt(state, edition, base) };
    }

    const output = issues.slice();
    const misses = [];
    let cacheHits = 0;
    for (const row of eligible) {
      const cacheKey = editorialCacheKey(row.issue, model, verifierModel);
      const hit = edits.get(cacheKey);
      if (!verifiedCacheRecord(hit, model, verifierModel)) {
        misses.push(row);
        continue;
      }
      const prompt = promptFor(buildEditorialLlmPacket([row]));
      const checked = checkedDraft(row.issue, hit.draft, hit.verifier, prompt);
      if (!checked.pass) {
        misses.push(row);
        continue;
      }
      output[row.index] = applyDraft(row.issue, hit.draft, hit.verifier, {
        model: hit.model || model,
        verifierModel: hit.verifierModel || verifierModel,
        observedAt: hit.savedAt || new Date(clock()).toISOString()
      });
      cacheHits += 1;
    }

    const requestedRows = misses.slice(0, limit);
    const deferredDeterministic = Math.max(0, misses.length - requestedRows.length);
    if (!requestedRows.length) {
      return {
        ...edition,
        issues: output,
        editorialMode: cacheHits ? "evidence_llm_verified" : edition.editorialMode,
        editorialLlm: receipt("cache_only", edition, { ...base, cacheHits, edited: cacheHits })
      };
    }

    const packet = buildEditorialLlmPacket(requestedRows);
    const editorPrompt = promptFor(packet);
    let editor;
    try {
      editor = await invoke({
        apiKey, model, system: EDITOR_SYSTEM, prompt: editorPrompt, schema: EDITOR_SCHEMA,
        maxTokens: Math.min(10000, 1000 + requestedRows.length * 350), fetchImpl, onUsage,
        purpose: "개인 오늘판 근거 편집"
      });
    } catch (error) {
      log(`[editorial-llm] editor ${error.message}`);
      return {
        ...edition,
        issues: output,
        editorialLlm: receipt("editor_error_fallback", edition, {
          ...base, cacheHits, requested: requestedRows.length, deferredDeterministic, calls: 1, error: error.message
        })
      };
    }
    const draftsByN = new Map((editor.parsed && editor.parsed.issues || []).map((row) => [row.n, row]));
    const drafts = packet.map((row) => draftsByN.get(row.n) || null);
    let verifier;
    try {
      verifier = await invoke({
        apiKey, model: verifierModel, system: VERIFY_SYSTEM,
        prompt: verifierPromptFor(packet, drafts), schema: VERIFY_SCHEMA,
        maxTokens: Math.min(4000, 600 + requestedRows.length * 120), fetchImpl, onUsage,
        purpose: "개인 오늘판 근거 검증"
      });
    } catch (error) {
      log(`[editorial-llm] verifier ${error.message}`);
      return {
        ...edition,
        issues: output,
        editorialLlm: receipt("verifier_error_fallback", edition, {
          ...base, cacheHits, requested: requestedRows.length, deferredDeterministic, calls: 2,
          inputTokens: editor.usage && editor.usage.input_tokens || 0,
          outputTokens: editor.usage && editor.usage.output_tokens || 0,
          error: error.message
        })
      };
    }

    const verifierByN = new Map((verifier.parsed && verifier.parsed.issues || []).map((row) => [row.n, row]));
    let edited = 0;
    let rejected = 0;
    const savedAt = new Date(clock()).toISOString();
    for (const [offset, row] of requestedRows.entries()) {
      const draft = drafts[offset];
      const verification = verifierByN.get(offset + 1) || null;
      const issuePrompt = promptFor([packet[offset]]);
      const checked = checkedDraft(row.issue, draft, verification, issuePrompt);
      if (!checked.pass) {
        rejected += 1;
        continue;
      }
      const edit = {
        contractId: EDITORIAL_LLM_CONTRACT.stableId,
        contractVersion: EDITORIAL_LLM_CONTRACT.version,
        promptVersion: EDITORIAL_LLM_CONTRACT.promptVersion,
        draft,
        verifier: verification,
        model,
        verifierModel,
        savedAt
      };
      edits.set(editorialCacheKey(row.issue, model, verifierModel), edit);
      output[row.index] = applyDraft(row.issue, draft, verification, { model, verifierModel, observedAt: savedAt });
      edited += 1;
    }
    const inputTokens = (editor.usage && editor.usage.input_tokens || 0) +
      (verifier.usage && verifier.usage.input_tokens || 0);
    const outputTokens = (editor.usage && editor.usage.output_tokens || 0) +
      (verifier.usage && verifier.usage.output_tokens || 0);
    const state = edited ? "verified_edits_applied" : "verification_hold";
    return {
      ...edition,
      issues: output,
      editorialMode: edited || cacheHits ? "evidence_llm_verified" : edition.editorialMode,
      llmCalls: Number(edition.llmCalls || 0) + 2,
      editorialLlm: receipt(state, edition, {
        ...base, cacheHits, requested: requestedRows.length, edited: edited + cacheHits,
        rejected, deferredDeterministic, calls: 2, inputTokens, outputTokens
      })
    };
  }

  return async function serializeSameEvidence(edition) {
    const issues = Array.isArray(edition && edition.issues) ? edition.issues : [];
    const keys = unique(issues.filter((issue) => verifyEditorialLineage(issue).pass)
      .map((issue) => editorialCacheKey(issue, model, verifierModel))).sort();
    if (!enabled || !apiKey || !edition?.publishable || !keys.length) return enrich(edition);

    const predecessors = unique(keys.map((key) => inFlight.get(key)));
    let release;
    const done = new Promise((resolve) => { release = resolve; });
    for (const key of keys) inFlight.set(key, done);
    await Promise.allSettled(predecessors);
    try {
      return await enrich(edition);
    } finally {
      release();
      for (const key of keys) if (inFlight.get(key) === done) inFlight.delete(key);
    }
  };
}
