import { operationalSourceIdentity } from "./editorial-source-identity.js";
import { categoryGuardReason } from "./classify.js";
import {
  EDITORIAL_READER_COPY_CONTRACT,
  assessReaderCopyDiversity,
  assessReaderIssueCopy,
  buildReaderLineage,
  readerIssueCopy
} from "./editorial-reader-copy.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_QUALITY_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-QUALITY-CONTRACT-001",
  version: 13,
  runtimeSample: "dynamic_current_edition",
  machineGate: [
    "headline_subject_complete",
    "source_evidence_present",
    "cross_source_wording_supported",
    "paragraph_has_editorial_context",
    "korean_audience_readable",
    "category_fit_supported",
    "sensitive_allegation_has_reported_source",
    "community_violent_exhortation_absent",
    "reader_copy_required_and_event_specific",
    "reader_copy_packet_diversity"
  ],
  humanRubric: [
    "include",
    "clusterCorrect",
    "headlineFaithful",
    "evidenceSufficient",
    "categoryFit",
    "notes"
  ],
  evaluationBoundary: {
    runtime: "현재 판의 동적 이슈 전체를 검수한다.",
    e1: "두 검수자가 같은 자료를 비교하는 별도 층화 평가 코퍼스이며 크기를 미리 고정하지 않는다.",
    e1State: "not_frozen",
    e1TargetSize: null,
    e1SizeRule: "파일럿의 분야·근거 유형 분포와 검수자 불일치율을 관측한 뒤 목표 정밀도와 검수 예산으로 정한다.",
    e1Strata: ["categoryId", "evidenceMode", "sourceRole", "changeState"],
    e1FreezeRule: "표본 ID·층·판정 기준·알고리즘 버전을 manifest로 함께 동결한 뒤에만 버전 비교에 사용한다."
  }
});

export const BLIND_REVIEW_PACKET_ID = "NOWHOT-BLIND-REVIEW-PACKET-001";
export const HUMAN_REVIEW_QUEUE_CONTRACT = deepFreeze({
  stableId: "NOWHOT-HUMAN-REVIEW-QUEUE-001",
  version: 1,
  activation: "explicit_after_first_packet",
  retention: "활성·검수 기록 패킷은 보존하고, 답변 없는 대기 패킷은 최신 30개까지 보관한다.",
  packetRule: "활성 패킷의 행과 근거는 다음 슬롯이 도래해도 바꾸지 않는다.",
  independenceRule: "두 검수자가 전 행을 끝내기 전에는 답과 일치율을 서로에게 공개하지 않는다.",
  adjudicationRule: "두 원장 완료 뒤 불일치 필드만 별도 조정 원장에 기록한다."
});
export const HUMAN_REVIEW_FIELDS = Object.freeze([
  "include",
  "clusterCorrect",
  "headlineFaithful",
  "evidenceSufficient",
  "categoryFit"
]);

// 조사나 연결어에서 잘린 사건명은 길이가 충분해도 제목으로 완결되지 않는다.
// 실제 07시 판의 "뉴욕증시 급등에", "전월세난·임차인 불안 우려에"가
// 기계 게이트를 통과한 뒤에야 이 빈틈이 드러났다.
const DANGLING_END = /(?:^|\s|[가-힣a-zA-Z0-9])(?:의|은|는|을|를|에|에는|에서|에게|대한|관한|위한|통한|따라|때문에|두고|놓고|관련해|통해|맞서|향해|는데|더|또|다시|계속|여전히|받지|및\s*기타|기타)$/;
const GENERIC_SUBJECT = /^(?:사안|소식|이슈|뉴스|오늘|화제|주요 소식)$/;
const ISOLATED_HANJA_INITIALS = /^(?:[一-龥]\s+[一-龥](?:\s|,)|[靑與野尹李鄭金](?:\s|,))/;
const LOW_CONTEXT_SUBJECTS = [
  /^(?:\[[^\]]{1,40}\]|(?:연합뉴스\s+)?(?:이\s*시각\s+)?헤드라인)(?:\s*[-:]\s*\d{1,2}:?\d{0,2})?$/i,
  /^(?:찾았(?:습니다|어요)|구했(?:습니다|어요)|해결(?:했)?(?:습니다|됐습니다)?)[.!\s]*(?:감사(?:합니다|해요))?[.!\s]*$/,
  /(?:추천\s*(?:좀|부탁)|부탁(?:드려요|해요|합니다)|알려\s*주세요)[.!?\s]*$/,
  /^(?:상승률|하락률|증가율|감소율|수익률|점유율|성장률)\s*[-+]?\d+(?:\.\d+)?%$/,
  /^(?:계속\s*)?(?:웃기|황당|어이없).{0,16}(?:드라마|코미디)(?:예요|다)?$/,
  /^(?:아이|애들|사람들|요즘\s+사람들).{0,24}(?:아나요|모르나요|안다고요|모른다고).*/,
  /(?:어떻게|뭐|무엇).{0,32}(?:대응함|하나요|해야\s*하|추천|부탁)[?!.\s]*$/,
  /^(?:어느|한)\s+(?:아파트|학교|회사|가게|동네|지역).{0,24}(?:공지|안내|상황)$/,
  /^사진\s+원본\s+공개되자.{0,24}(?:누가\s+)?편집했나.{0,12}(?:소동|논란)?$/,
  /^(?:눈치\s*보는\s*것?\s*같은).{1,30}(?:현재\s*)?상황$/,
  /^(?:여|야)\s+[가-힣].*/,
  /먹고\s+살아야\s+할\s+판$/,
  /%에서\s+멈추(?:넴|네|네요|었음|었다)?$/,
  /앙딱정/i,
  /^[가-힣a-zA-Z0-9-]+\s+(?:튜닝|세팅|개조)$/,
  /^(?:휴대폰|전화|통신|인터넷)(?:이|가)?\s*먹통(?:이네|이다|됐(?:다|네))?$/
];
const SENSITIVE_LINEAGE_ALLEGATION = /(친일\s*(?:후손|파)|매국노)/i;
const COMMUNITY_VIOLENT_EXHORTATION = /(?:때려|쳐|패서)?\s*죽(?:여야|여라|이자|여버리)/i;

const sourceLabel = (row) => String(row && (row.sourceLabel || row.source) || "")
  .trim()
  .replace(/\.(com|co\.kr|kr|net|org)$/i, "");
const labelQuality = (label, source) => (/[가-힣]/.test(label) ? 2 : 0) + (label !== source ? 1 : 0);

export function observedFeedSources(items) {
  const seen = new Map();
  for (const item of items || []) {
    const rows = [item, ...(Array.isArray(item && item.related) ? item.related : [])];
    for (const row of rows) {
      if (!row) continue;
      const identity = operationalSourceIdentity(row);
      const key = `${identity.sourceId}|${identity.ownershipGroup}`;
      const label = sourceLabel(row) || identity.label || identity.sourceId;
      const current = seen.get(key);
      if (current) {
        if (labelQuality(label, identity.sourceId) > labelQuality(current.label, current.source)) {
          current.label = label;
        }
        continue;
      }
      seen.set(key, {
        source: identity.sourceId,
        label,
        ownershipGroup: identity.ownershipGroup,
        ownershipBasis: identity.ownershipBasis
      });
    }
  }
  return [...seen.values()];
}

export function coverageEvidence(items) {
  const sources = observedFeedSources(items);
  const grouped = new Map();
  for (const source of sources) {
    const current = grouped.get(source.ownershipGroup);
    if (!current) {
      grouped.set(source.ownershipGroup, {
        ownershipGroup: source.ownershipGroup,
        label: source.label,
        sources: [source.source]
      });
      continue;
    }
    current.sources.push(source.source);
    if (labelQuality(source.label, source.source) > labelQuality(current.label, current.sources[0])) {
      current.label = source.label;
    }
  }
  const groups = [...grouped.values()];
  const ownershipGroups = groups.map((group) => group.ownershipGroup);
  const independentGroupCount = ownershipGroups.length;
  const coverage = Math.max(...(items || []).map((item) => Number(item && item.coverage) || 0), 0);
  const relatedCoverageSignal = coverage >= 3 && independentGroupCount < 2;
  const mode = independentGroupCount >= 2
    ? "multiple_feed_observed"
    : relatedCoverageSignal
      ? "related_coverage_signal"
      : "single_feed_observed";
  return {
    mode,
    observedFeedCount: sources.length,
    independentGroupCount,
    ownershipGroups,
    groups,
    independenceBasis: "operational_group_not_legal_independence",
    relatedCoverageSignal,
    coverage,
    sources
  };
}

export function subjectQuality(subject) {
  const text = String(subject || "").replace(/\s+/g, " ").trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  const checks = {
    present: text.length >= 4,
    specific: !GENERIC_SUBJECT.test(text),
    completeEnding: !DANGLING_END.test(text),
    namedContext: !ISOLATED_HANJA_INITIALS.test(text),
    meaningfulContext: !LOW_CONTEXT_SUBJECTS.some((pattern) => pattern.test(text))
      && !(/심각하네$/.test(text) && tokens.length <= 3),
    readableLength: text.length <= 72,
    enoughLanguage: tokens.length >= 2 || text.replace(/[^가-힣a-zA-Z0-9]/g, "").length >= 6
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    failures: Object.entries(checks).filter(([, pass]) => !pass).map(([id]) => id)
  };
}

export function assessEditorialDraft({
  headline,
  paragraph,
  subject,
  evidence,
  sourceLabels = [],
  categoryItems = [],
  requireKoreanAudience = false
} = {}) {
  const subjectGate = subjectQuality(subject);
  const text = `${String(headline || "")} ${String(paragraph || "")}`;
  const claimsCrossSource = /(여러\s*매체|복수\s*(?:출처|피드)|교차\s*(?:관측|확인)|서로\s*다른\s*운영그룹|함께\s*다루)/.test(text);
  const crossSupported = !claimsCrossSource || evidence && evidence.mode === "multiple_feed_observed";
  const categoryFailures = [...new Set((categoryItems || []).flatMap((item) => {
    const categories = Array.isArray(item?.admittedCategories) && item.admittedCategories.length
      ? item.admittedCategories : [item?.category || "news"];
    return categories.map((category) => {
      const reason = categoryGuardReason(category, item?.title, item);
      return reason ? `category:${category}:${reason}` : null;
    });
  }).filter(Boolean))];
  const sensitiveClaim = SENSITIVE_LINEAGE_ALLEGATION.test(
    `${String(headline || "")} ${String(paragraph || "")} ${String(subject || "")}`
  );
  const hasReportedSource = (categoryItems || []).some((item) => item && item.kind === "news");
  const hasCommunityViolentExhortation = (categoryItems || []).some((item) =>
    item && item.kind === "community" && COMMUNITY_VIOLENT_EXHORTATION.test(String(item.title || ""))
  );
  const audienceHeadline = String(
    categoryItems && categoryItems[0] && categoryItems[0].title || subject || headline || ""
  );
  const englishHeadlineWords = (audienceHeadline.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const checks = {
    headlineSubjectComplete: subjectGate.pass && String(headline || "").includes(String(subject || "")),
    sourceEvidencePresent: (sourceLabels || []).some(Boolean),
    crossSourceWordingSupported: crossSupported,
    paragraphHasEditorialContext: String(paragraph || "").trim().length >= 24,
    koreanAudienceReadable: !requireKoreanAudience || /[가-힣]/.test(audienceHeadline) || englishHeadlineWords <= 3,
    categoryFitSupported: categoryFailures.length === 0,
    sensitiveAllegationSupported: !sensitiveClaim || hasReportedSource,
    communityViolentExhortationAbsent: !hasCommunityViolentExhortation
  };
  return {
    state: Object.values(checks).every(Boolean) ? "machine_gate_pass" : "machine_gate_hold",
    pass: Object.values(checks).every(Boolean),
    checks,
    failures: [
      ...subjectGate.failures.map((id) => `subject:${id}`),
      ...Object.entries(checks).filter(([, pass]) => !pass).map(([id]) => id),
      ...categoryFailures
    ].filter((value, index, list) => list.indexOf(value) === index)
  };
}

function stableHash(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function buildBlindReviewPacket(edition, { observedAt = null } = {}) {
  const rows = (edition && Array.isArray(edition.issues) ? edition.issues : []).map((issue) => {
    const refKey = (issue.refs || []).map((ref) => ref.id || ref.title).join("|");
    const blindId = `BR-${stableHash(`${edition.editionId || "edition"}|${refKey}|${issue.headline}`)}`;
    const generatedReader = issue.reader || readerIssueCopy(issue);
    const reader = {
      headline: generatedReader.headline || null,
      summary: generatedReader.summary || null,
      whyImportant: generatedReader.whyImportant || null,
      whyNow: generatedReader.whyNow || null,
      change: generatedReader.change || null,
      watchNext: generatedReader.watchNext || null,
      confidenceLabel: generatedReader.confidenceLabel || null
    };
    const readerLineage = buildReaderLineage(issue, reader);
    return {
      blindId,
      categoryIds: issue.categoryIds || [],
      subject: issue.subject || null,
      headline: issue.headline,
      paragraph: issue.paragraph,
      whyImportant: issue.whyImportant || null,
      whyHot: issue.whyHot || null,
      changedSincePrevious: issue.changedSincePrevious || null,
      reader,
      readerLineage,
      readerGate: assessReaderIssueCopy(issue, reader),
      evidence: issue.evidence || null,
      evidenceHash: issue.evidenceHash || null,
      sourceEvidence: (issue.sourceEvidence || []).map((row) => ({
        evidenceId: row.evidenceId,
        title: row.title,
        sourceLabel: row.sourceLabel,
        sourceRole: row.sourceRole,
        ownershipGroup: row.ownershipGroup,
        ownershipBasis: row.ownershipBasis,
        evidenceRole: row.evidenceRole,
        canonicalUrl: row.canonicalUrl
      })),
      refs: (issue.refs || []).map((ref) => ({
        title: ref.title,
        sourceLabel: ref.sourceLabel,
        score: ref.score || 0,
        commentCount: ref.commentCount || 0,
        coverage: ref.coverage || 0
      })),
      machineGate: issue.editorialGate || null,
      human: Object.fromEntries(EDITORIAL_QUALITY_CONTRACT.humanRubric.map((field) => [field, null]))
    };
  }).sort((a, b) => stableHash(a.blindId).localeCompare(stableHash(b.blindId)));

  const canonicalMachinePass = rows.filter((row) => row.machineGate && row.machineGate.pass).length;
  const readerIssuePass = rows.filter((row) => row.readerGate && row.readerGate.pass).length;
  const readerDiversity = assessReaderCopyDiversity(rows.map((row) => row.reader));
  const compositeIssuePass = rows.filter((row) =>
    row.machineGate && row.machineGate.pass && row.readerGate && row.readerGate.pass
  ).length;
  const machinePass = readerDiversity.pass ? compositeIssuePass : 0;
  const state = !rows.length || canonicalMachinePass !== rows.length
    ? "machine_gate_hold"
    : readerIssuePass !== rows.length || !readerDiversity.pass
      ? "reader_copy_hold"
      : "human_annotation_ready";
  // 독자 문장이 같아도 계약이나 판정 규칙이 달라지면 같은 검수 대상이 아니다.
  // 문안과 기계 판정을 함께 지문에 넣어 이전 판정을 새 규칙의 결과로 오인하지 않는다.
  const readerFingerprint = rows.map((row) => JSON.stringify({
    reader: row.reader,
    readerLineage: row.readerLineage,
    readerGate: row.readerGate
  })).join("|");
  return {
    stableId: BLIND_REVIEW_PACKET_ID,
    packetVersion: 5,
    contractId: EDITORIAL_QUALITY_CONTRACT.stableId,
    readerContractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
    readerContractVersion: EDITORIAL_READER_COPY_CONTRACT.version,
    packetId: `BRP-${stableHash(`v5|quality:${EDITORIAL_QUALITY_CONTRACT.version}|reader:${EDITORIAL_READER_COPY_CONTRACT.version}|${edition && edition.editionId}|${rows.map((row) => row.blindId).join("|")}|${readerFingerprint}`)}`,
    editionId: edition && edition.editionId || null,
    observedAt: observedAt || edition && edition.generatedAt || null,
    state,
    sampleMode: "dynamic_current_edition",
    metrics: {
      issueCount: rows.length,
      canonicalMachinePass,
      readerIssuePass,
      readerPacketPass: readerDiversity.pass,
      machinePass,
      machineHold: rows.length - machinePass,
      humanCompleted: 0
    },
    readerDiversity,
    evaluationBoundary: EDITORIAL_QUALITY_CONTRACT.evaluationBoundary,
    rows
  };
}

export function summarizeHumanReview(packet, ledger, reviewers = ["reviewer-a", "reviewer-b"]) {
  const rows = packet && packet.rows || [];
  const annotationsByReviewer = Object.fromEntries(reviewers.map((reviewerId) => {
    const review = ledger && ledger.reviewers && ledger.reviewers[reviewerId];
    return [reviewerId, new Map((review && review.annotations || []).map((row) => [row.blindId, row]))];
  }));
  const completedByReviewer = Object.fromEntries(reviewers.map((reviewerId) => {
    const review = ledger && ledger.reviewers && ledger.reviewers[reviewerId];
    const annotations = review && Array.isArray(review.annotations) ? review.annotations : [];
    const completed = annotations.filter((annotation) => HUMAN_REVIEW_FIELDS.every((field) => typeof annotation[field] === "boolean")).length;
    return [reviewerId, { completed, savedAt: review && review.savedAt || null }];
  }));
  const completedRows = [];
  const disagreements = [];
  const adjudicationRows = [];
  const resolutionMap = new Map((ledger && ledger.adjudication && ledger.adjudication.resolutions || [])
    .map((row) => [`${row.blindId}|${row.field}`, row]));
  let agreedFields = 0;
  let comparedFields = 0;
  let unanimousPassRows = 0;
  let unanimousNegativeRows = 0;
  let finalPassRows = 0;
  let finalNegativeRows = 0;
  let resolvedFields = 0;
  let unresolvedFields = 0;

  for (const row of rows) {
    const annotations = reviewers.map((reviewerId) => annotationsByReviewer[reviewerId].get(row.blindId));
    if (!annotations.every((annotation) => annotation && HUMAN_REVIEW_FIELDS.every((field) => typeof annotation[field] === "boolean"))) continue;
    completedRows.push(row.blindId);
    const differingFields = [];
    let rowFinalPass = true;
    for (const field of HUMAN_REVIEW_FIELDS) {
      comparedFields += 1;
      if (annotations.every((annotation) => annotation[field] === annotations[0][field])) {
        agreedFields += 1;
        if (annotations[0][field] !== true) rowFinalPass = false;
        continue;
      }
      differingFields.push(field);
      const resolution = resolutionMap.get(`${row.blindId}|${field}`);
      const resolved = Boolean(resolution && typeof resolution.value === "boolean");
      if (resolved) {
        resolvedFields += 1;
        if (resolution.value !== true) rowFinalPass = false;
      } else {
        unresolvedFields += 1;
        rowFinalPass = false;
      }
      adjudicationRows.push({
        blindId: row.blindId,
        field,
        reviewerValues: Object.fromEntries(reviewers.map((reviewerId, index) => [reviewerId, annotations[index][field]])),
        value: resolved ? resolution.value : null,
        notes: resolved ? String(resolution.notes || "") : ""
      });
    }
    if (differingFields.length) disagreements.push({ blindId: row.blindId, fields: differingFields });
    const allTrue = HUMAN_REVIEW_FIELDS.every((field) => annotations.every((annotation) => annotation[field] === true));
    const anyUnanimousFalse = HUMAN_REVIEW_FIELDS.some((field) => annotations.every((annotation) => annotation[field] === false));
    if (allTrue) unanimousPassRows += 1;
    if (anyUnanimousFalse) unanimousNegativeRows += 1;
    if (rowFinalPass) finalPassRows += 1;
    else finalNegativeRows += 1;
  }

  const doubleReviewed = completedRows.length;
  const allComplete = rows.length > 0 && doubleReviewed === rows.length;
  const comparisonsVisible = allComplete;
  const visibleDisagreements = comparisonsVisible ? disagreements : [];
  const visibleAdjudicationRows = comparisonsVisible ? adjudicationRows : [];
  const visibleResolvedFields = comparisonsVisible ? resolvedFields : 0;
  const visibleUnresolvedFields = comparisonsVisible ? unresolvedFields : 0;
  const machineState = packet && (packet.machineState || packet.state);
  const machineReady = !machineState || machineState === "human_annotation_ready";
  const humanPass = allComplete && visibleUnresolvedFields === 0 && finalPassRows === rows.length;
  const qualityPass = machineReady && humanPass;
  const strictConsensusPass = qualityPass && disagreements.length === 0;
  const state = allComplete
    ? visibleUnresolvedFields
      ? "human_adjudication_required"
      : humanPass
        ? disagreements.length ? "human_adjudicated_pass" : "human_quality_pass"
        : "human_quality_hold"
    : Object.values(completedByReviewer).some((value) => value.completed)
      ? "human_annotation_in_progress"
      : "human_annotation_ready";
  const overallState = machineReady ? state : machineState;

  return {
    reviewers,
    requiredFields: HUMAN_REVIEW_FIELDS,
    completedByReviewer,
    doubleReviewed,
    requiredRows: rows.length,
    machineState: machineState || null,
    machineReady,
    state,
    overallState,
    comparisonReady: comparisonsVisible,
    agreement: {
      agreedFields: comparisonsVisible ? agreedFields : 0,
      comparedFields: comparisonsVisible ? comparedFields : 0,
      rate: comparisonsVisible && comparedFields ? Math.round(agreedFields / comparedFields * 1000) / 10 : null,
      unanimousPassRows: comparisonsVisible ? unanimousPassRows : 0,
      unanimousNegativeRows: comparisonsVisible ? unanimousNegativeRows : 0,
      finalPassRows: comparisonsVisible ? finalPassRows : 0,
      finalNegativeRows: comparisonsVisible ? finalNegativeRows : 0,
      disagreementRows: visibleDisagreements.length
    },
    disagreements: visibleDisagreements,
    adjudication: {
      requiredFields: visibleAdjudicationRows.length,
      resolvedFields: visibleResolvedFields,
      unresolvedFields: visibleUnresolvedFields,
      savedAt: comparisonsVisible && ledger && ledger.adjudication && ledger.adjudication.savedAt || null,
      rows: visibleAdjudicationRows
    },
    qualityPass,
    humanPass,
    strictConsensusPass,
    identityProof: false
  };
}

// 자동 패킷 승계와 수동 전환은 "완료 행"만 보면 안 된다. 검수자가 메모나
// 일부 체크를 저장한 순간부터 그 패킷은 사람이 본 기록이며 그대로 보존한다.
export function hasHumanReviewWork(ledger) {
  if (!ledger) return false;
  const reviewerWork = Object.values(ledger.reviewers || {}).some((review) =>
    Boolean(review && (review.savedAt || Array.isArray(review.annotations)))
  );
  const adjudication = ledger.adjudication;
  const adjudicationWork = Boolean(adjudication && (
    adjudication.savedAt ||
    adjudication.updatedAt ||
    Array.isArray(adjudication.resolutions)
  ));
  return reviewerWork || adjudicationWork;
}
