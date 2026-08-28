import { HUMAN_REVIEW_FIELDS } from "./editorial-quality.js";
import { readerIssueCopy } from "./editorial-reader-copy.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_REVIEW_DESK_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-REVIEW-DESK-001",
  version: 1,
  route: "/admin/editorial-desk",
  api: "/api/admin/editorial-desk",
  mode: "single_issue_reader_surface_review",
  reviewerSeats: ["reviewer-a", "reviewer-b"],
  autoSave: true,
  comparisonRule: "두 검수자가 전 행을 완료하기 전에는 상대 답과 일치율을 공개하지 않는다.",
  hiddenFields: ["machineGate", "human", "whyForYou", "otherReviewerAnnotations"],
  canonicalMutation: false
});

export const EDITORIAL_REVIEW_FIELD_SCHEMA = deepFreeze([
  {
    id: "include",
    label: "게재 가치",
    question: "지금 이 브리핑에 실을 가치가 있는가?"
  },
  {
    id: "clusterCorrect",
    label: "사건 묶음",
    question: "하나의 사건으로 올바르게 묶였는가?"
  },
  {
    id: "headlineFaithful",
    label: "제목과 문장",
    question: "제목과 요약이 근거에 맞고 자연스러운가?"
  },
  {
    id: "evidenceSufficient",
    label: "근거",
    question: "표시된 설명을 뒷받침할 근거가 충분한가?"
  },
  {
    id: "categoryFit",
    label: "분야",
    question: "선택한 분야에서 볼 만한 내용인가?"
  }
]);

const cleanAnnotation = (annotation, blindId) => {
  const output = { blindId };
  for (const field of HUMAN_REVIEW_FIELDS) {
    output[field] = annotation && typeof annotation[field] === "boolean"
      ? annotation[field]
      : null;
  }
  output.notes = String(annotation && annotation.notes || "").slice(0, 500);
  return output;
};

const annotationComplete = (annotation) => HUMAN_REVIEW_FIELDS
  .every((field) => typeof annotation[field] === "boolean");

function readerProjection(row) {
  if (row && row.reader) return {
    headline: String(row.reader.headline || ""),
    summary: String(row.reader.summary || ""),
    whyImportant: String(row.reader.whyImportant || ""),
    whyNow: String(row.reader.whyNow || ""),
    change: String(row.reader.change || ""),
    watchNext: String(row.reader.watchNext || ""),
    confidenceLabel: String(row.reader.confidenceLabel || "")
  };
  return readerIssueCopy({
    ...row,
    shape: "coverage",
    changedSincePrevious: row && row.changedSincePrevious || null
  });
}

export function buildEditorialReviewDesk({
  packet,
  reviewerId,
  review = null,
  humanReview = null
} = {}) {
  const annotations = new Map((review && review.annotations || [])
    .map((annotation) => [annotation.blindId, annotation]));
  const rows = (packet && packet.rows || []).map((row, index) => {
    const annotation = cleanAnnotation(annotations.get(row.blindId), row.blindId);
    return {
      blindId: row.blindId,
      position: index + 1,
      categoryIds: Array.isArray(row.categoryIds) ? row.categoryIds : [],
      reader: readerProjection(row),
      canonical: {
        subject: row.subject || null,
        headline: row.headline || null,
        paragraph: row.paragraph || null,
        whyImportant: row.whyImportant || null,
        whyHot: row.whyHot || null,
        changedSincePrevious: row.changedSincePrevious || null
      },
      evidence: row.evidence ? {
        mode: row.evidence.mode || null,
        observedFeedCount: Number(row.evidence.observedFeedCount || 0),
        independentGroupCount: Number(row.evidence.independentGroupCount || 0)
      } : null,
      evidenceHash: row.evidenceHash || null,
      sourceEvidence: (row.sourceEvidence || []).map((source) => ({
        evidenceId: source.evidenceId || null,
        title: source.title || null,
        sourceLabel: source.sourceLabel || null,
        sourceRole: source.sourceRole || null,
        evidenceRole: source.evidenceRole || null,
        canonicalUrl: source.canonicalUrl || null
      })),
      annotation,
      complete: annotationComplete(annotation),
      held: HUMAN_REVIEW_FIELDS.some((field) => annotation[field] === false)
    };
  });
  const completed = rows.filter((row) => row.complete).length;
  const held = rows.filter((row) => row.held).length;

  return {
    stableId: EDITORIAL_REVIEW_DESK_CONTRACT.stableId,
    contract: EDITORIAL_REVIEW_DESK_CONTRACT,
    packet: {
      packetId: packet && packet.packetId || null,
      editionId: packet && packet.editionId || null,
      sourceDate: packet && packet.sourceDate || null,
      sourceSlotId: packet && packet.sourceSlotId || null,
      frozenAt: packet && packet.frozenAt || null,
      issueCount: rows.length
    },
    reviewerId,
    reviewFields: EDITORIAL_REVIEW_FIELD_SCHEMA,
    savedAt: review && review.savedAt || null,
    progress: {
      completed,
      remaining: rows.length - completed,
      held,
      total: rows.length,
      percent: rows.length ? Math.round(completed / rows.length * 1000) / 10 : 0
    },
    humanReview: humanReview || null,
    rows
  };
}
