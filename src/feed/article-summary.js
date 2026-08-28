import { createHash } from "node:crypto";
import { fetchPublicArticle } from "./enrich.js";
import { callStructuredMessage } from "./llm.js";
import { isGoogleNewsRedirect } from "./canonical-url.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";

export const ARTICLE_SUMMARY_CONTRACT = Object.freeze({
  stableId: "NOWHOT-ARTICLE-SUMMARY-001",
  version: 37,
  promptVersion: 20,
  maxSourcesPerIssue: 3,
  targetSummaryChars: [600, 900],
  acceptedSummaryChars: [160, 1000],
  sourceRelativeSummaryChars: { minRatio: 0.3, maxRatio: 0.9 },
  sentenceEvidence: "code_owned_source_passage_ids",
  semanticVerification: "independent_llm",
  requiredVerifierPasses: "one_independent_pass_quote_recheck_on_malformed_evidence",
  storage: "verified_korean_summary_only",
  rawArticleStorage: false
});

const READY_CACHE_MS = 24 * 60 * 60 * 1000;

export function isPreparedArticleSummary(summary, issue = null) {
  const issueContentId = issue ? articleContentId(issue) : null;
  const ready = summary && summary.status === "ready" && substantialKoreanSummary(summary.textKo);
  const excerpt = summary && summary.status === "excerpt_only" && substantialKoreanSummary(summary.textKo);
  const unavailable = summary && summary.status === "source_unavailable" &&
    clean(summary.unavailableReasonCode).length > 0 && Number.isFinite(Date.parse(summary.retryAfter || ""));
  return Boolean((ready || excerpt || unavailable) &&
    summary.contractId === ARTICLE_SUMMARY_CONTRACT.stableId &&
    summary.contractVersion === ARTICLE_SUMMARY_CONTRACT.version &&
    summary.promptVersion === ARTICLE_SUMMARY_CONTRACT.promptVersion &&
    Number.isFinite(Date.parse(summary.generatedAt || "")) &&
    (!issue || summary.articleContentId === issueContentId ||
      Array.isArray(summary.articleContentAliases) && summary.articleContentAliases.includes(issueContentId)));
}

export function isCurrentArticleSummary(summary, issue = null, nowMs = Date.now()) {
  if (!isPreparedArticleSummary(summary, issue)) return false;
  if (summary.status === "ready" || summary.status === "excerpt_only") {
    const generatedAt = Date.parse(summary.generatedAt || "");
    return Number.isFinite(generatedAt) && nowMs - generatedAt >= 0 && nowMs - generatedAt < READY_CACHE_MS;
  }
  const generatedAt = Date.parse(summary.generatedAt || "");
  return summary.status === "source_unavailable" && Number.isFinite(generatedAt) && generatedAt <= nowMs &&
    Number.isFinite(Date.parse(summary.retryAfter || "")) && Date.parse(summary.retryAfter) > nowMs &&
    (!issue || Array.isArray(summary.sourceFingerprints) &&
      summary.sourceFingerprints.includes(sourceFingerprint(allSourceRows(issue))));
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          evidenceHash: { type: "string" },
          textKo: { type: "string" },
          sourceEvidenceIds: { type: "array", items: { type: "string" } }
        },
        required: ["n", "evidenceHash", "textKo", "sourceEvidenceIds"],
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
          supported: { type: "boolean" },
          complete: { type: "boolean" },
          coherent: { type: "boolean" },
          unsupportedFragments: { type: "array", items: { type: "string" } },
          sentenceChecks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                n: { type: "integer" },
                supported: { type: "boolean" },
                meaningStrengthPreserved: { type: "boolean" },
                evidenceQuotes: { type: "array", items: { type: "string" } },
                evidencePassageIds: { type: "array", items: { type: "string" } },
                unsupportedFragment: { type: "string" }
              },
              required: ["n", "supported", "meaningStrengthPreserved", "evidencePassageIds", "unsupportedFragment"],
              additionalProperties: false
            }
          },
          reason: { type: "string" }
        },
        required: ["n", "supported", "complete", "coherent", "unsupportedFragments", "sentenceChecks", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["issues"],
  additionalProperties: false
};

const SUMMARY_SYSTEM = `당신은 지금핫의 한국어 기사 요약 편집자입니다.
각 사건의 anchor가 서술 기준 기사이고 supporting은 같은 사건의 보강 자료입니다.
anchor의 흐름을 따라 기사 본문을 읽지 않아도 핵심 사실·배경·진행 상황을 이해할 수 있게 요약하십시오.
각 행의 summaryChars 범위 안에서 쓰십시오. 원문이 충분히 길면 600~900자를 목표로 하고, 짧은 원문은 근거량에 맞춰 더 짧고 완결되게 쓰십시오.
supporting은 anchor를 확인하거나 anchor에 없는 확인된 사실을 보강할 때만 사용하십시오.
출처끼리 사실이 다르면 하나로 섞지 말고 무엇이 다른지 분명히 쓰십시오.
입력에 없는 사실·평가·전망·인과관계를 만들지 말고, 제목이나 매체명을 반복하는 소개문으로 분량을 채우지 마십시오.
사실이어도 원문에 직접 없는 정정·비교·수치·시점·인과관계는 덧붙이지 마십시오. 원문이 직접 밝힌 관계는 그대로 요약할 수 있습니다.
원문의 범위·강도·확실성·한정 표현을 줄이거나 강화하지 마십시오.
각 요약 문장은 원문의 연속된 구절로 직접 뒷받침되게 쓰고, 서로 무관한 사실은 문장을 나누십시오.
직접 인용을 제외하고 원문 문장을 통째로 반복하지 마십시오. 고유명사·수치·사실은 보존하되 어순과 표현을 자연스럽게 다시 구성하십시오.
모든 문장은 자연스러운 한국어 기사 요약체로 쓰고 실제 사용한 evidenceId만 반환하십시오.`;

const VERIFY_SYSTEM = `당신은 기사 요약 편집자와 분리된 근거 검증자입니다.
제공된 draftSentences를 빠짐없이 같은 번호로 반환하고 모든 문장을 anchor와 supporting 본문만으로 대조하십시오.
특히 고유명사, 숫자, 비교 표현, 인과관계가 원문에 직접 없으면 근거 밖 주장입니다.
원문의 범위·강도·확실성·한정이 draft에서 그대로 보존됐는지 문장마다 meaningStrengthPreserved로 별도 판정하십시오.
각 sentenceChecks의 evidencePassageIds에는 그 문장 전체를 직접 뒷받침하는 evidencePassages의 id만 반환하십시오. 존재하지 않는 id를 만들거나 떨어진 구절을 임의로 잇지 마십시오.
시간·인과·비교를 추론하지 마십시오. 예를 들어 '올해 신청 가능'은 '올해 신설'을 뜻하지 않습니다.
핵심 사실이 맞더라도 원문에 없는 'A가 아닌 B' 같은 보정 설명은 근거 밖 주장입니다.
근거 밖 주장이 하나라도 있으면 해당 문장과 전체 supported를 false로 판정하고 문제 구절을 그대로 복사하십시오.
중요한 핵심을 부당하게 빠뜨리지 않았는지, anchor 중심으로 두서없이 출처 문장을 이어 붙이지 않았는지도 각각 판정하십시오.
외부 지식이 필요하거나 출처 간 충돌을 사실 하나로 합쳤으면 supported 또는 coherent를 false로 판정하십시오.`;

const REPAIR_SYSTEM = `당신은 지금핫 기사 요약 교정 편집자입니다.
검증자가 특정한 원문 밖 구절만 제거하거나 원문 근거 안에서 다시 쓰고, 나머지 확인된 사실과 자연스러운 기사 요약 흐름은 유지하십시오.
rewriteReason이 source_copy이면 원문을 길게 그대로 옮긴 표현만 자연스러운 한국어로 재서술하고 사실·맥락·세부 내용은 빠뜨리지 마십시오.
직접 인용을 제외하고 원문 문장을 통째로 반복하지 마십시오. 원문과 같은 문장 구조가 남지 않도록 어순과 표현을 다시 구성하십시오.
rewriteReason이 draft_contract이면 지정된 길이·근거 ID·출력 형식을 바로잡고, verification_rejected이면 검증자의 완결성·일관성·근거 지적을 반영해 전체 흐름을 한 번 정리하십시오.
rewriteReason이 evidence_audit이면 sentenceChecks에서 근거가 어긋난 문장만 원문 안의 표현으로 바로잡으십시오.
사실이어도 원문에 직접 없는 설명을 새로 넣지 말고, 정정·비교·수치·시점·인과관계는 원문에 직접 있을 때만 쓰십시오.
각 행의 summaryChars 범위에 맞는 완전한 한국어 요약과 실제 사용한 evidenceId를 다시 반환하십시오.`;

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).filter(Boolean))];
const FAILURE_CACHE_MS = 30 * 60 * 1000;
const PROVIDER_LOCK_KEY = "article-summary-provider";

function substantialKoreanSummary(value) {
  const text = clean(value);
  const hangul = (text.match(/[가-힣]/g) || []).length;
  const letters = (text.match(/[\p{L}]/gu) || []).length;
  return text.length >= ARTICLE_SUMMARY_CONTRACT.acceptedSummaryChars[0] &&
    hangul >= 40 && letters > 0 && hangul / letters >= 0.3;
}

function canonicalSourceRows(rows) {
  const seenUrls = new Set();
  const seenGroups = new Set();
  return (rows || []).filter((row) => row && /^https?:\/\//i.test(row.canonicalUrl || ""))
    .sort(sourceRowOrder)
    .filter((row) => {
      const url = row.canonicalUrl;
      const group = clean(row.sourceGroup) || clean(operationalSourceIdentity(row).ownershipGroup);
      const groupKey = group && group !== "gnews" && group !== "unknown" ? `group:${group}` : `url:${url}`;
      if (seenUrls.has(url) || seenGroups.has(groupKey)) return false;
      seenUrls.add(url);
      seenGroups.add(groupKey);
      return true;
    });
}

function allSourceRows(issue) {
  const relatedUrls = new Set((issue && issue.sourceEvidence || [])
    .filter((row) => row && row.evidenceRole === "related_observation")
    .map((row) => row.canonicalUrl)
    .filter(Boolean));
  const eventSources = issue && issue.eventSources || [];
  if (eventSources.length) {
    return canonicalSourceRows(eventSources.map((row) => ({
      ...row,
      evidenceId: row.evidenceId || row.id || null,
      canonicalUrl: row.canonicalUrl || row.url || null
    })).filter((row) => row && row.evidenceRole !== "related_observation" &&
        !relatedUrls.has(row.canonicalUrl)));
  }
  const issueEvidence = issue && issue.sourceEvidence || [];
  const evidence = issueEvidence
    .filter((row) => row && row.evidenceRole !== "related_observation");
  const byUrl = new Map(evidence.map((row) => [row.canonicalUrl, row]));
  return canonicalSourceRows([...evidence, ...(issue && issue.refs || []).map((row) => ({
    ...row,
    evidenceId: row.evidenceId || byUrl.get(row.canonicalUrl)?.evidenceId || row.id
    })).filter((row) => !relatedUrls.has(row && row.canonicalUrl))]
  );
}

function sourceRowOrder(a, b) {
  const withheld = Number(a?.canLead === false) - Number(b?.canLead === false);
  if (withheld) return withheld;
  const wrapper = Number(isGoogleNewsRedirect(a?.canonicalUrl)) - Number(isGoogleNewsRedirect(b?.canonicalUrl));
  if (wrapper) return wrapper;
  const left = Date.parse(a?.publishedAt || "");
  const right = Date.parse(b?.publishedAt || "");
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
  return String(a?.evidenceId || a?.canonicalUrl || "").localeCompare(String(b?.evidenceId || b?.canonicalUrl || ""));
}

export function articleContentId(issue) {
  // The event is the content. Sources may be added, resolved away from a relay,
  // or reordered without turning the same story into a different detail page.
  const sourceSetId = String(issue?.eventSourceSetId || "");
  const eventIdentity = clean(
    issue?.clusterId || issue?.event?.eventId ||
    (sourceSetId.includes(":") ? sourceSetId.split(":")[0] : "")
  );
  if (eventIdentity) {
    return `NHC-${createHash("sha256").update(`event:${eventIdentity}`).digest("hex").slice(0, 24)}`;
  }
  const rows = allSourceRows(issue);
  const directRows = rows.filter((row) => !isGoogleNewsRedirect(row.canonicalUrl));
  const identities = (directRows.length ? directRows : rows)
    .slice(0, ARTICLE_SUMMARY_CONTRACT.maxSourcesPerIssue)
    .map((row) => row.canonicalUrl)
    .sort((left, right) => String(left || "").localeCompare(String(right || "")));
  const fallback = clean(issue && issue.refs && issue.refs[0] && issue.refs[0].id || issue && issue.subject);
  return `NHC-${createHash("sha256").update(JSON.stringify(identities.length ? identities : [fallback])).digest("hex").slice(0, 24)}`;
}

function sourceLinks(rows) {
  const canonical = canonicalSourceRows(rows);
  const direct = canonical.filter((row) => !isGoogleNewsRedirect(row.canonicalUrl));
  return (direct.length ? direct : canonical).map((row) => ({
    evidenceId: row.evidenceId || null,
    sourceLabel: clean(row.sourceLabel) || "원문",
    sourceGroup: clean(row.sourceGroup) || clean(operationalSourceIdentity(row).ownershipGroup),
    url: row.canonicalUrl
  }));
}

function resolvedSourceRows(allSources, fetchedSources) {
  const resolved = new Map((fetchedSources || []).map(({ source, result }) => [
    source.evidenceId || source.canonicalUrl,
    result && result.finalUrl
  ]));
  return canonicalSourceRows((allSources || []).map((source) => {
    const finalUrl = resolved.get(source.evidenceId || source.canonicalUrl);
    return /^https?:\/\//i.test(finalUrl || "") && !isGoogleNewsRedirect(finalUrl)
      ? { ...source, canonicalUrl: finalUrl }
      : source;
  }));
}

function sourceFingerprint(rows) {
  const urls = canonicalSourceRows(rows).map((row) => row.canonicalUrl).sort();
  return `NHSF-${createHash("sha256").update(JSON.stringify(urls)).digest("hex").slice(0, 24)}`;
}

function cacheKey(issue, model, verifierModel, fallbackModel = null) {
  return [
    "article-summary", articleContentId(issue),
    ARTICLE_SUMMARY_CONTRACT.stableId, `v${ARTICLE_SUMMARY_CONTRACT.version}`,
    `p${ARTICLE_SUMMARY_CONTRACT.promptVersion}`, model, verifierModel, fallbackModel || "no-fallback"
  ].join("|");
}

function verifiedCache(hit, model, verifierModel, fallbackModel, nowMs) {
  const savedAt = Date.parse(hit && hit.savedAt || "");
  return Boolean(hit && hit.verified === true && hit.articleSummary &&
    hit.contractId === ARTICLE_SUMMARY_CONTRACT.stableId &&
    hit.contractVersion === ARTICLE_SUMMARY_CONTRACT.version &&
    hit.promptVersion === ARTICLE_SUMMARY_CONTRACT.promptVersion &&
    hit.model === model && hit.verifierModel === verifierModel &&
    (hit.fallbackModel || null) === (fallbackModel || null) &&
    Number.isFinite(savedAt) && nowMs - savedAt >= 0 && nowMs - savedAt < READY_CACHE_MS);
}

function unavailableCache(hit, model, verifierModel, fallbackModel, nowMs, currentSourceFingerprint) {
  const savedAt = Date.parse(hit && hit.savedAt || "");
  return Boolean(hit && hit.articleSummary && hit.articleSummary.status === "source_unavailable" &&
    hit.contractId === ARTICLE_SUMMARY_CONTRACT.stableId &&
    hit.contractVersion === ARTICLE_SUMMARY_CONTRACT.version &&
    hit.promptVersion === ARTICLE_SUMMARY_CONTRACT.promptVersion &&
    hit.model === model && hit.verifierModel === verifierModel &&
    (hit.fallbackModel || null) === (fallbackModel || null) &&
    Array.isArray(hit.sourceFingerprints) && hit.sourceFingerprints.includes(currentSourceFingerprint) &&
    Number.isFinite(savedAt) && nowMs - savedAt < FAILURE_CACHE_MS);
}

function unavailable(issue, basis, reasonCode, sources, image = null, nowMs = Date.now()) {
  const generatedAt = new Date(nowMs).toISOString();
  return {
    status: "source_unavailable",
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(issue),
    eventSourceSetId: issue && issue.eventSourceSetId || null,
    textKo: null,
    sourceEvidenceId: basis && basis.evidenceId || null,
    sourceLabel: basis && basis.sourceLabel || null,
    sourceCount: sources.length,
    summarySourceCount: 0,
    sourceLinks: sourceLinks(sources),
    image,
    unavailableReasonCode: reasonCode || "NO_PUBLIC_BODY",
    generatedAt,
    retryAfter: new Date(nowMs + FAILURE_CACHE_MS).toISOString()
  };
}

function publicExcerpt(text) {
  const source = clean(text);
  const max = ARTICLE_SUMMARY_CONTRACT.targetSummaryChars[1];
  if (source.length <= max) return source;
  const clipped = source.slice(0, max);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("다. "), clipped.lastIndexOf("요. "));
  return sentenceEnd >= ARTICLE_SUMMARY_CONTRACT.targetSummaryChars[0]
    ? clipped.slice(0, sentenceEnd + 1).trim()
    : clipped.trim();
}

async function excerptSummary(row, { translateText, nowMs }) {
  let anchor = row.sources.find((source) => source.result.state === "available");
  let excerptBasis = "public_anchor_body";
  if (!anchor) {
    const source = row.resolvedSources.find((candidate) => clean(
      candidate.summary || candidate.excerpt || candidate.description
    ));
    if (!source) return null;
    anchor = {
      source,
      result: {
        text: source.summary || source.excerpt || source.description,
        image: source.image || null
      }
    };
    excerptBasis = "publisher_feed_excerpt";
  }
  let textKo = publicExcerpt(anchor.result.text);
  if (!substantialKoreanSummary(textKo) && typeof translateText === "function") {
    const translated = await translateText(textKo, { from: "auto", to: "ko" });
    if (substantialKoreanSummary(translated)) textKo = publicExcerpt(translated);
  }
  if (!substantialKoreanSummary(textKo)) return null;
  return {
    status: "excerpt_only",
    contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
    contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
    promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
    articleContentId: articleContentId(row.resolvedIssue),
    articleContentAliases: row.articleContentAliases,
    eventSourceSetId: row.issue.eventSourceSetId || null,
    textKo,
    sourceEvidenceId: anchor.source.evidenceId,
    sourceLabel: anchor.source.sourceLabel,
    sourceCount: row.resolvedSources.length,
    summarySourceCount: 1,
    sourceLinks: sourceLinks(row.resolvedSources),
    image: anchor.result.image || null,
    generationModel: null,
    unavailableReasonCode: null,
    generatedAt: new Date(nowMs).toISOString(),
    excerptBasis
  };
}

function packetRow(row, n) {
  const available = row.sources.filter((source) => source.result.state === "available");
  const anchor = available[0];
  const sourceChars = clean(anchor.result.text).length;
  const totalSourceChars = available.reduce((sum, source) => sum + clean(source.result.text).length, 0);
  const maxChars = Math.min(ARTICLE_SUMMARY_CONTRACT.acceptedSummaryChars[1],
    Math.max(ARTICLE_SUMMARY_CONTRACT.acceptedSummaryChars[0],
    Math.floor(totalSourceChars * ARTICLE_SUMMARY_CONTRACT.sourceRelativeSummaryChars.maxRatio)));
  const minChars = Math.min(maxChars, Math.max(ARTICLE_SUMMARY_CONTRACT.acceptedSummaryChars[0], Math.min(600,
    Math.floor(sourceChars * ARTICLE_SUMMARY_CONTRACT.sourceRelativeSummaryChars.minRatio))));
  return {
    n,
    evidenceHash: row.issue.evidenceHash,
    subject: anchor.source.title || row.issue.subject || row.issue.headline,
    summaryChars: { min: minChars, max: maxChars },
    anchor: {
      evidenceId: anchor.source.evidenceId,
      sourceLabel: anchor.source.sourceLabel,
      title: anchor.source.title,
      text: clean(anchor.result.text).slice(0, 16000)
    },
    supporting: available.slice(1, 3).map(({ source, result }) => ({
      evidenceId: source.evidenceId,
      sourceLabel: source.sourceLabel,
      title: source.title,
      text: clean(result.text).slice(0, 5000)
    }))
  };
}

function copiesSourceText(text, packet) {
  const summary = clean(text);
  const sources = [packet.anchor, ...packet.supporting].map((row) => clean(row.text));
  const exactSize = 120;
  for (let start = 0; start + exactSize <= summary.length; start += 1) {
    if (sources.some((source) => source.includes(summary.slice(start, start + exactSize)))) return true;
  }
  const windowSize = 40;
  let windows = 0;
  let copied = 0;
  for (let start = 0; start + windowSize <= summary.length; start += 20) {
    windows += 1;
    if (sources.some((source) => source.includes(summary.slice(start, start + windowSize)))) copied += 1;
  }
  return windows > 0 && copied / windows >= 0.5;
}

function summarySentences(text) {
  return clean(text).split(/(?<=[.!?。！？])\s+(?=[가-힣A-Za-z0-9"'“‘(\[「『《〈【])/u).map(clean).filter(Boolean);
}

function sourcePassages(packet) {
  return [packet.anchor, ...packet.supporting].flatMap((source) => {
    const sentences = clean(source.text)
      .split(/(?<=[.!?。！？])\s+(?=[가-힣A-Za-z0-9"'“‘(\[「『《〈【])/u)
      .map(clean).filter(Boolean);
    const chunks = sentences.flatMap((sentence) => {
      const parts = [];
      let rest = sentence;
      while (rest.length > 700) {
        const window = rest.slice(0, 700);
        const space = window.lastIndexOf(" ");
        const width = space >= 350 ? space : 700;
        parts.push(clean(rest.slice(0, width)));
        rest = clean(rest.slice(width));
      }
      if (rest) parts.push(rest);
      return parts;
    });
    return chunks.map((text, index) => ({
      id: `${source.evidenceId}:${index + 1}`,
      evidenceId: source.evidenceId,
      text
    }));
  });
}

function passageEvidence(check, packet, { adjacent = false } = {}) {
  if (!Object.prototype.hasOwnProperty.call(check || {}, "evidencePassageIds")) return null;
  const ids = check.evidencePassageIds;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return [];
  const rows = sourcePassages(packet);
  const passages = new Map(rows.map((row) => [row.id, row]));
  if (!ids.every((id) => passages.has(id))) return [];
  if (!adjacent) return ids.map((id) => passages.get(id).text);
  const selected = new Set(ids);
  for (const id of ids) {
    const index = rows.findIndex((row) => row.id === id);
    for (const offset of [-1, 1]) {
      const neighbor = rows[index + offset];
      if (neighbor && neighbor.evidenceId === rows[index].evidenceId) selected.add(neighbor.id);
    }
  }
  return rows.filter((row) => selected.has(row.id)).map((row) => row.text);
}

function semanticEvidence(check, packet, { adjacent = false } = {}) {
  const passages = passageEvidence(check, packet, { adjacent });
  return passages === null
    ? Array.isArray(check && check.evidenceQuotes) ? check.evidenceQuotes.map(clean).filter(Boolean) : []
    : passages;
}

const normalizeGrounding = (value) => clean(value)
  .replace(/[“”„]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[‐‑‒–—]/g, "-");

const groundingTokens = (value) => normalizeGrounding(value).toLocaleLowerCase("en-US")
  .match(/[\p{L}\p{N}]+/gu) || [];

function sourceSupportsQuote(quote, sources) {
  const part = groundingTokens(quote);
  if (!part.length || part.join(" ").length < 8) return false;
  return sources.some((source) => {
    const tokens = groundingTokens(source);
    for (let start = 0; start + part.length <= tokens.length; start += 1) {
      if (part.every((token, offset) => token === tokens[start + offset])) return true;
    }
    return false;
  });
}

function numericMentions(value) {
  const text = normalizeGrounding(value);
  const pattern = /\d+(?:[.,]\d+)*(?:\s*(?:천만|백만|십만|천|만|억|조|thousands?|millions?|billions?|trillions?|%|퍼센트))?/giu;
  const factors = {
    천: 1e3, 만: 1e4, 십만: 1e5, 백만: 1e6, 천만: 1e7, 억: 1e8, 조: 1e12,
    thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6,
    billion: 1e9, billions: 1e9, trillion: 1e12, trillions: 1e12
  };
  const rows = [...text.matchAll(pattern)].map((match) => ({
    raw: match[0],
    unit: (match[0].match(/(천만|백만|십만|천|만|억|조|thousands?|millions?|billions?|trillions?|%|퍼센트)$/iu) || [])[1] || "",
    index: match.index,
    length: match[0].length
  }));
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];
    const separator = text.slice(current.index + current.length, next.index);
    if (!current.unit && next.unit && /^\s*[~-]\s*$/u.test(separator)) current.unit = next.unit;
  }
  return rows.map((match) => {
    const unit = match.unit;
    const number = Number(match.raw.replace(/,/g, "").replace(/\s*(?:천만|백만|십만|천|만|억|조|thousands?|millions?|billions?|trillions?|%|퍼센트)$/iu, ""));
    const factor = factors[unit.toLocaleLowerCase("en-US")] || 1;
    return Number.isFinite(number) ? {
      value: `${unit === "%" || unit === "퍼센트" ? "percent:" : "number:"}${number * factor}`,
      index: match.index,
      length: match.length
    } : null;
  }).filter(Boolean);
}

function numericClaimsSupported(sentence, sources) {
  const claimed = numericMentions(sentence);
  if (!claimed.length) return true;
  // verifier가 고른 같은 근거 구간에 수치가 실제로 있는지만 기계적으로 잠근다.
  // 숫자 주변 어순·조사까지 다시 맞추면 자연스러운 한국어 재서술이 대량 오탐되고,
  // 수치가 어떤 대상에 붙는지는 독립 검증기의 meaningStrengthPreserved가 판정한다.
  return claimed.every((claim) => sources.some((source) =>
    numericMentions(source).some((row) => row.value === claim.value)));
}

const CROSS_LANGUAGE_RELATIONS = [
  {
    kind: "causal",
    ko: /(?:때문에|로 인해|에 따라|따라서|결과로|영향으로)/,
    koEvidence: /(?:때문에|로 인해|에 따라|따라서|결과로|영향으로|반영(?:해|하여|해서)|바탕으로|토대로)/,
    en: /\b(?:because|due to|owing to|as a result|resulted in|led\b.*\bto)\b/i
  },
  { kind: "contrast", ko: /(?:반면|그러나|하지만|반대로)/, en: /\b(?:while|whereas|although|but|however|in contrast)\b/i },
  { kind: "correction", ko: /(?:아니라|아니고|아닌|아니라고)/, en: /\b(?:not|no longer|isn't|wasn't|rather than|instead of)\b/i },
  {
    kind: "state_change",
    ko: /(?:신설|폐지|도입|출범|착수|개시|시작|중단|종료|완료|확정|재개)(?:했|됐|되었|하였|합니다|했습니다|되었습니다|한다|된다|하기로|하기 시작)/,
    en: /\b(?:created|established|abolished|introduced|launched|began|started|halted|suspended|ended|completed|finalized|resumed)\b/i
  },
  {
    kind: "comparison_higher",
    ko: /(?:보다.{0,30}(?:더\s*)?(?:많|높|크|빠르|앞서|늘|증가|상승)|상회|웃돌|초과)/,
    en: /\b(?:higher|more|greater|larger|faster|ahead|above|exceed(?:ed|s|ing)?|surpass(?:ed|es|ing)?)\b/i
  },
  {
    kind: "comparison_lower",
    ko: /(?:보다.{0,30}(?:더\s*)?(?:적|낮|작|느리|뒤처|줄|감소|하락)|하회|밑돌)/,
    en: /\b(?:lower|less|fewer|smaller|slower|behind|below|lag(?:ged|s|ging)?)\b/i
  }
];

function crossLanguageRelationSupported(quote, sentence) {
  const required = CROSS_LANGUAGE_RELATIONS.filter(({ ko }) => ko.test(sentence));
  return required.length > 0 && required.every(({ en }) => en.test(quote));
}

function quoteSupportsSentence(quote, sentence) {
  const normalizedQuote = normalizeGrounding(quote);
  if (!normalizedQuote || !clean(sentence)) return false;
  const quoteHasKorean = /[가-힣]/.test(normalizedQuote);
  const sentenceHasKorean = /[가-힣]/.test(sentence);
  if (quoteHasKorean !== sentenceHasKorean) {
    return sentenceHasKorean && crossLanguageRelationSupported(normalizedQuote, sentence);
  }
  const quoteTokens = groundingTokens(normalizedQuote).filter((token) => token.length >= 2);
  const sentenceTokens = groundingTokens(sentence).filter((token) => token.length >= 2);
  const overlaps = sentenceTokens.filter((token) => quoteTokens.some((candidate) =>
    token === candidate || token.length >= 4 && candidate.includes(token) ||
    candidate.length >= 4 && token.includes(candidate) ||
    quoteHasKorean && token.length >= 2 && candidate.length >= 2 &&
      (token.startsWith(candidate) || candidate.startsWith(token))
  ));
  return new Set(overlaps).size >= Math.min(2, sentenceTokens.length);
}

function sentenceAuditFailure(text, packet, verifier) {
  const sentences = summarySentences(text);
  const checks = verifier && verifier.sentenceChecks;
  if (!sentences.length || !Array.isArray(checks) || checks.length !== sentences.length) return "sentence_shape";
  const sources = [packet.anchor, ...packet.supporting].map((row) => clean(row.text));
  const seen = new Set();
  for (const [index, check] of checks.entries()) {
    const quotes = Array.isArray(check && check.evidenceQuotes) ? check.evidenceQuotes.map(clean).filter(Boolean) : [];
    const passages = passageEvidence(check, packet);
    if (!check || check.n !== index + 1 || seen.has(check.n)) return `sentence_contract:${index + 1}`;
    seen.add(check.n);
    if (check.supported !== true || check.meaningStrengthPreserved !== true || clean(check.unsupportedFragment) !== "") {
      return `sentence_rejected:${index + 1}`;
    }
    if (passages !== null && !passages.length) return `passage_not_found:${index + 1}`;
    if (passages === null && !quotes.length) return `quote_missing:${index + 1}`;
    const groundedQuotes = passages === null
      ? quotes.filter((quote) => sourceSupportsQuote(quote, sources))
      : passages;
    if (!groundedQuotes.length) return `quote_not_in_source:${index + 1}`;
    const numericEvidence = passages === null
      ? groundedQuotes
      : passageEvidence(check, packet, { adjacent: true });
    if (!numericClaimsSupported(sentences[index], numericEvidence)) return `numeric_mismatch:${index + 1}`;
  }
  return null;
}

function sentenceAuditPass(text, packet, verifier) {
  return sentenceAuditFailure(text, packet, verifier) === null;
}

function sentenceNeedsSemanticConsensus(text, packet, verifier) {
  const sentences = summarySentences(text);
  return (verifier && verifier.sentenceChecks || []).some((check, index) => {
    const quotes = semanticEvidence(check, packet, { adjacent: true });
    return quotes.length > 0 && !quotes.some((quote) => quoteSupportsSentence(quote, sentences[index] || ""));
  });
}

function consensusSemanticsSupported(text, packet, verifier) {
  const sentences = summarySentences(text);
  return (verifier && verifier.sentenceChecks || []).every((check, index) => {
    const sentence = sentences[index] || "";
    const quotes = semanticEvidence(check, packet, { adjacent: true });
    const candidates = quotes.length > 1 ? [...quotes, quotes.join(" ")] : quotes;
    return candidates.some((quote) => {
      const languageMismatch = /[가-힣]/.test(quote) !== /[가-힣]/.test(sentence);
      if (!languageMismatch) return quoteSupportsSentence(quote, sentence);
      const hasCompoundRelation = CROSS_LANGUAGE_RELATIONS.some(({ ko }) => ko.test(sentence));
      return !hasCompoundRelation || crossLanguageRelationSupported(quote, sentence);
    });
  });
}

function draftGatePass(row, packet, draft) {
  const known = new Set([packet.anchor.evidenceId, ...packet.supporting.map((source) => source.evidenceId)]);
  const ids = unique(draft && draft.sourceEvidenceIds);
  const text = clean(draft && draft.textKo);
  return Boolean(draft &&
    draft.evidenceHash === row.issue.evidenceHash &&
    substantialKoreanSummary(text) &&
    text.length >= packet.summaryChars.min &&
    text.length <= packet.summaryChars.max &&
    !/<[^>]+>/.test(text) && !copiesSourceText(text, packet) &&
    ids.length > 0 && ids.includes(packet.anchor.evidenceId) && ids.every((id) => known.has(id)));
}

function verifierGatePass(verifier) {
  return Boolean(verifier && verifier.supported && verifier.complete && verifier.coherent &&
    Array.isArray(verifier.unsupportedFragments) && verifier.unsupportedFragments.length === 0 &&
    Array.isArray(verifier.sentenceChecks));
}

function checkedDraft(row, packet, draft, verifier) {
  return draftGatePass(row, packet, draft) && verifierGatePass(verifier) &&
    sentenceAuditPass(draft.textKo, packet, verifier);
}

function promptFor(packet) {
  return JSON.stringify({ instructions: "모든 행을 같은 n으로 반환하십시오.", issues: packet });
}

function verifierPromptFor(packet, drafts) {
  return JSON.stringify({
    instructions: "각 행의 모든 draftSentences를 빠짐없이 번호대로 대조하고 근거 evidencePassageIds만 고르십시오.",
    issues: packet.map((row, index) => {
      return {
        ...row,
        anchor: {
          evidenceId: row.anchor.evidenceId,
          sourceLabel: row.anchor.sourceLabel,
          title: row.anchor.title
        },
        supporting: row.supporting.map((source) => ({
          evidenceId: source.evidenceId,
          sourceLabel: source.sourceLabel,
          title: source.title
        })),
        evidencePassages: sourcePassages(row),
        draft: drafts[index],
        draftSentences: summarySentences(drafts[index] && drafts[index].textKo)
          .map((text, sentenceIndex) => ({ n: sentenceIndex + 1, text }))
      };
    })
  });
}

function repairPromptFor(packet, drafts, verifications) {
  return JSON.stringify({
    instructions: "검증자가 특정한 원문 밖 구절을 제거한 완전한 요약을 같은 n으로 반환하십시오.",
    issues: packet.map((row, index) => ({
      ...row,
      draft: drafts[index],
      rewriteReason: copiesSourceText(drafts[index] && drafts[index].textKo, row)
        ? "source_copy" : !verifierGatePass(verifications[index])
          ? "verification_rejected" : sentenceAuditPass(drafts[index] && drafts[index].textKo, row, verifications[index])
            ? "draft_contract" : "evidence_audit",
      verifierResult: verifications[index] ? {
        supported: verifications[index].supported,
        complete: verifications[index].complete,
        coherent: verifications[index].coherent,
        reason: verifications[index].reason
      } : null,
      unsupportedFragments: verifications[index] && verifications[index].unsupportedFragments || [],
      sentenceChecks: verifications[index] && verifications[index].sentenceChecks || []
    }))
  });
}

function repairableDraft(row, draft, verification, packet) {
  return Boolean(draft && verification && (
    !draftGatePass(row, packet, draft) || !verifierGatePass(verification) ||
    !sentenceAuditPass(draft.textKo, packet, verification)
  ));
}

function relationNeedsIndependentVerification(text, packet, verifier) {
  const sentences = summarySentences(text);
  return (verifier && verifier.sentenceChecks || []).some((check, index) => {
    const sentence = sentences[index] || "";
    const relations = CROSS_LANGUAGE_RELATIONS.filter(({ ko }) => ko.test(sentence));
    if (!relations.length) return false;
    const quotes = semanticEvidence(check, packet, { adjacent: true });
    if (!quotes.length) return true;
    const strict = relations.filter(({ kind }) => kind !== "contrast");
    if (!strict.length) return false;
    const sameLanguageQuotes = quotes.filter((quote) =>
      /[가-힣]/.test(quote) === /[가-힣]/.test(sentence));
    return !sameLanguageQuotes.length
      ? quotes.length !== 1 || !strict.every(({ en }) => en.test(quotes[0]))
      : !strict.every(({ ko, koEvidence = ko }) => sameLanguageQuotes.some((quote) =>
      koEvidence.test(quote) && quoteSupportsSentence(quote, sentence)));
  });
}

function independentVerificationMode(row, packet, draft, verifier) {
  if (!draftGatePass(row, packet, draft) || !verifierGatePass(verifier)) return null;
  if (!sentenceAuditPass(draft.textKo, packet, verifier)) return "quote_recheck";
  if (sentenceNeedsSemanticConsensus(draft.textKo, packet, verifier)) return "semantic_consensus";
  return relationNeedsIndependentVerification(draft.textKo, packet, verifier) ? "relation_consensus" : null;
}

function acceptedVerification(row, packet, draft, verifier, consensusMode = null, consensus = null) {
  const primaryPass = checkedDraft(row, packet, draft, verifier);
  const consensusPass = consensusMode && checkedDraft(row, packet, draft, consensus);
  const consensusSemanticallyGrounded = Boolean(consensusPass) &&
    consensusSemanticsSupported(draft && draft.textKo, packet, consensus);
  if (consensusMode === "relation_consensus") {
    return primaryPass && consensusSemanticallyGrounded &&
      !relationNeedsIndependentVerification(draft && draft.textKo, packet, consensus);
  }
  return consensusMode === "quote_recheck"
    ? consensusSemanticallyGrounded
    : primaryPass && (!consensusMode || (consensusMode === "semantic_consensus"
      ? consensusSemanticallyGrounded
      : consensusPass));
}

function acceptedPrimaryVerification(row, packet, draft, verifier) {
  return checkedDraft(row, packet, draft, verifier);
}

async function mapLimit(rows, limit, work) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await work(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return output;
}

function validIssueMap(parsed, expectedRows) {
  const rows = parsed && parsed.issues;
  const expected = new Set(expectedRows.map((row) => row.n));
  const mapped = new Map();
  const invalid = new Set();
  if (!Array.isArray(rows)) return mapped;
  for (const row of rows) {
    if (!row || !expected.has(row.n) || invalid.has(row.n)) continue;
    if (mapped.has(row.n)) {
      mapped.delete(row.n);
      invalid.add(row.n);
      continue;
    }
    mapped.set(row.n, row);
  }
  return mapped;
}

export function makeArticleSummaryPipeline({
  enabled = false,
  apiKey = null,
  model = "claude-sonnet-5",
  verifierModel = "claude-sonnet-5",
  fallbackModel = null,
  allowRecovery = true,
  completeBeforePublish = false,
  translateText = null,
  batchSize = 8,
  fetchConcurrency = 4,
  fetchArticle = fetchPublicArticle,
  fetchImpl = fetch,
  invoke = callStructuredMessage,
  cache = null,
  onUsage = null,
  log = () => {},
  clock = () => Date.now()
} = {}) {
  const effectiveFallbackModel = clean(fallbackModel) || null;
  const memory = new Map();
  const summaries = cache || { get: (key) => memory.get(key), set: (key, value) => memory.set(key, value) };
  const providerHoldKey = [PROVIDER_LOCK_KEY, model, verifierModel, effectiveFallbackModel || "no-fallback"].join("|");
  let providerHoldReason = null;
  let providerHoldUntilMs = 0;
  const providerIsHeld = () => {
    const shared = summaries.get(providerHoldKey);
    if (Number(shared?.untilMs) > clock()) {
      providerHoldReason = shared.reason || "provider unavailable";
      providerHoldUntilMs = Number(shared.untilMs);
    }
    if (!providerHoldReason) return false;
    if (clock() < providerHoldUntilMs) return true;
    providerHoldReason = null;
    providerHoldUntilMs = 0;
    return false;
  };
  const isProviderFailureMessage = (message) =>
    /^api (?:400|401|403|429|5\d\d)(?:\s|$)/i.test(message) ||
    /usage limit/i.test(message) || /^(?:truncated|no text block)$/i.test(message);
  const noteProviderFailure = (error) => {
    const message = String(error && error.message || "");
    const transportCode = String(error?.code || error?.cause?.code || "").toUpperCase();
    const transportFailure = error?.name === "AbortError" ||
      ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED",
        "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(transportCode) ||
      /^(?:fetch failed|network error|socket hang up)$/i.test(message);
    if (isProviderFailureMessage(message) || transportFailure) {
      providerHoldReason = message || "provider unavailable";
      providerHoldUntilMs = clock() + FAILURE_CACHE_MS;
      summaries.set(providerHoldKey, {
        state: "provider_hold",
        reason: providerHoldReason,
        untilMs: providerHoldUntilMs
      });
    }
    return message;
  };

  async function attachArticleSummaries(edition) {
    const issues = Array.isArray(edition && edition.issues) ? edition.issues : [];
    if (!edition || !edition.publishable || !issues.length || (!completeBeforePublish && (!enabled || !apiKey))) {
      return edition;
    }
    const modelEnabled = Boolean(enabled && apiKey);

    const output = issues.slice();
    const misses = [];
    let cacheHits = 0;
    for (const [index, issue] of issues.entries()) {
      if (isCurrentArticleSummary(issue.articleSummary, issue, clock())) continue;
      const key = cacheKey(issue, model, verifierModel, effectiveFallbackModel);
      const allSources = allSourceRows(issue);
      const currentSourceFingerprint = sourceFingerprint(allSources);
      const hit = summaries.get(key);
      if (verifiedCache(hit, model, verifierModel, effectiveFallbackModel, clock()) ||
        unavailableCache(hit, model, verifierModel, effectiveFallbackModel, clock(), currentSourceFingerprint)) {
        output[index] = { ...issue, articleSummary: hit.articleSummary };
        cacheHits += 1;
      } else {
        misses.push({
          issue, index, key, allSources, currentSourceFingerprint,
          sourceRows: allSources.slice(0, ARTICLE_SUMMARY_CONTRACT.maxSourcesPerIssue)
        });
      }
    }

    let fetched = 0;
    const fetchedRows = await mapLimit(misses, Math.max(1, Number(fetchConcurrency) || 4), async (row) => {
      const sources = await Promise.all(row.sourceRows.map(async (source) => {
        fetched += 1;
        try {
          return {
            source,
            result: await fetchArticle(source.canonicalUrl, {
              fetchImpl,
              expectedTitle: source.originalTitle || source.title || row.issue.subject || row.issue.headline
            })
          };
        } catch {
          return { source, result: { state: "unavailable", reasonCode: "NETWORK_ERROR", image: null } };
        }
      }));
      const resolvedSources = resolvedSourceRows(row.allSources, sources);
      const resolvedIssue = { ...row.issue, eventSources: resolvedSources };
      return {
        ...row,
        sources,
        resolvedSources,
        resolvedIssue,
        resolvedKey: cacheKey(resolvedIssue, model, verifierModel, effectiveFallbackModel),
        articleContentAliases: unique([articleContentId(row.issue), articleContentId(resolvedIssue)])
      };
    });

    const ready = [];
    let unavailableCount = 0;
    const saveCache = (row, entry) => {
      summaries.set(row.key, entry);
      if (row.resolvedKey && row.resolvedKey !== row.key) summaries.set(row.resolvedKey, entry);
    };
    const saveUnavailable = (row, articleSummary) => {
      const sourceFingerprints = unique([
        row.currentSourceFingerprint,
        sourceFingerprint(row.resolvedSources)
      ]);
      const preparedSummary = { ...articleSummary, sourceFingerprints };
      saveCache(row, {
        contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
        contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
        promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
        model,
        verifierModel,
        fallbackModel: effectiveFallbackModel,
        sourceFingerprints,
        draft: null,
        verifier: null,
        articleSummary: preparedSummary,
        savedAt: new Date(clock()).toISOString()
      });
      return preparedSummary;
    };
    const holdUnavailable = saveUnavailable;
    for (const row of fetchedRows) {
      const resolvedHit = row.resolvedKey && summaries.get(row.resolvedKey);
      if (verifiedCache(resolvedHit, model, verifierModel, effectiveFallbackModel, clock()) ||
        unavailableCache(resolvedHit, model, verifierModel, effectiveFallbackModel, clock(), sourceFingerprint(row.resolvedSources))) {
        const articleSummary = {
          ...resolvedHit.articleSummary,
          articleContentAliases: unique([
            ...(resolvedHit.articleSummary.articleContentAliases || []),
            ...row.articleContentAliases
          ])
        };
        saveCache(row, { ...resolvedHit, articleSummary });
        output[row.index] = { ...row.issue, articleSummary };
        cacheHits += 1;
        continue;
      }
      const anchor = row.sources.find((source) => source.result.state === "available");
      if (!anchor) {
        if (completeBeforePublish && row.resolvedSources.some((source) => clean(
          source.summary || source.excerpt || source.description
        ))) continue;
        const basis = row.sourceRows[0] || null;
        const reason = row.sources[0] && row.sources[0].result.reasonCode || "NO_PUBLIC_BODY";
        const image = row.sources.find((source) => source.result.image)?.result.image || null;
        output[row.index] = {
          ...row.issue,
          articleSummary: saveUnavailable(row, {
            ...unavailable(row.resolvedIssue, basis, reason, row.resolvedSources, image, clock()),
            articleContentAliases: row.articleContentAliases
          })
        };
        unavailableCount += 1;
      } else {
        ready.push(row);
      }
    }

    let calls = 0;
    let generated = 0;
    let rejected = 0;
    let fallbackGenerated = 0;
    const callModel = async (options) => {
      calls += 1;
      return invoke(options);
    };
    const regenerateWithFallback = async (row, packetRow) => {
      if (!effectiveFallbackModel || providerIsHeld()) return null;
      try {
        const regenerated = await callModel({
          apiKey, model: effectiveFallbackModel, system: SUMMARY_SYSTEM,
          prompt: promptFor([packetRow]), schema: SUMMARY_SCHEMA,
          maxTokens: 4000, fetchImpl, onUsage,
          purpose: "오늘판 기사 장문 요약 상위 모델 1회 재생성"
        });
        const draft = validIssueMap(regenerated.parsed, [packetRow]).get(packetRow.n) || null;
        if (!draft) return { draft: null, accepted: false, transient: false };
        const checked = await callModel({
          apiKey, model: effectiveFallbackModel, system: VERIFY_SYSTEM,
          prompt: verifierPromptFor([packetRow], [draft]), schema: VERIFY_SCHEMA,
          maxTokens: 8000, fetchImpl, onUsage,
          purpose: "오늘판 기사 장문 요약 상위 모델 근거 검증"
        });
        const verifier = validIssueMap(checked.parsed, [packetRow]).get(packetRow.n) || null;
        const consensusMode = independentVerificationMode(row, packetRow, draft, verifier);
        let consensus = null;
        if (consensusMode) {
          const rechecked = await callModel({
            apiKey, model: effectiveFallbackModel, system: VERIFY_SYSTEM,
            prompt: verifierPromptFor([packetRow], [draft]), schema: VERIFY_SCHEMA,
            maxTokens: 8000, fetchImpl, onUsage,
            purpose: "오늘판 기사 장문 요약 상위 모델 독립 재검증"
          });
          consensus = validIssueMap(rechecked.parsed, [packetRow]).get(packetRow.n) || null;
        }
        return {
          draft,
          verifier,
          accepted: acceptedVerification(row, packetRow, draft, verifier, consensusMode, consensus),
          transient: false
        };
      } catch (error) {
        const message = noteProviderFailure(error);
        log(`[article-summary] fallback failed (${message || error && error.name || "unknown"})`);
        return {
          draft: null,
          accepted: false,
          transient: /^api (?:429|5\d\d)(?:\s|$)/i.test(message) || /^(?:truncated|no text block)$/.test(message)
        };
      }
    };
    const effectiveBatchSize = Math.max(1, Number(batchSize) || 1);
    for (let start = 0; start < ready.length; start += effectiveBatchSize) {
      const batch = ready.slice(start, start + effectiveBatchSize);
      if (!modelEnabled) {
        rejected += batch.length;
        continue;
      }
      if (providerIsHeld()) {
        rejected += batch.length;
        continue;
      }
      const packet = batch.map((row, index) => packetRow(row, index + 1));
      let editor;
      let verifier;
      try {
        editor = await callModel({
          apiKey, model, system: SUMMARY_SYSTEM, prompt: promptFor(packet), schema: SUMMARY_SCHEMA,
          maxTokens: Math.min(10000, 2500 + batch.length * 1500), fetchImpl, onUsage,
          purpose: "오늘판 기사 장문 요약"
        });
        const byN = validIssueMap(editor.parsed, packet);
        if (byN.size !== packet.length) log("[article-summary] invalid_model_issue_set");
        const drafts = packet.map((row) => byN.get(row.n) || null);
        verifier = await callModel({
          apiKey, model: verifierModel, system: VERIFY_SYSTEM,
          prompt: verifierPromptFor(packet, drafts), schema: VERIFY_SCHEMA,
          maxTokens: Math.min(8000, 4600 + batch.length * 3400), fetchImpl, onUsage,
          purpose: "오늘판 기사 장문 요약 검증"
        });
        const verifierByN = validIssueMap(verifier.parsed, packet);
        if (verifierByN.size !== packet.length) log("[article-summary] invalid_model_issue_set");
        const repairOffsets = allowRecovery ? batch.map((row, index) => index)
          .filter((index) => repairableDraft(
            batch[index], drafts[index], verifierByN.get(packet[index].n), packet[index]
          )) : [];
        if (repairOffsets.length) {
          const repairPacket = repairOffsets.map((index) => packet[index]);
          const repairDrafts = repairOffsets.map((index) => drafts[index]);
          const repairVerifications = repairOffsets.map((index) => verifierByN.get(packet[index].n));
          try {
            const repaired = await callModel({
              apiKey, model, system: REPAIR_SYSTEM,
              prompt: repairPromptFor(repairPacket, repairDrafts, repairVerifications), schema: SUMMARY_SCHEMA,
              maxTokens: Math.min(10000, 2500 + repairOffsets.length * 1500), fetchImpl, onUsage,
              purpose: "오늘판 기사 장문 요약 1회 교정"
            });
            const repairedByN = validIssueMap(repaired.parsed, repairPacket);
            const repairedDrafts = repairPacket.map((row) => repairedByN.get(row.n) || null);
            const reverified = await callModel({
              apiKey, model: verifierModel, system: VERIFY_SYSTEM,
              prompt: verifierPromptFor(repairPacket, repairedDrafts), schema: VERIFY_SCHEMA,
              maxTokens: Math.min(8000, 4600 + repairOffsets.length * 3400), fetchImpl, onUsage,
              purpose: "오늘판 기사 장문 요약 재검증"
            });
            const reverifiedByN = validIssueMap(reverified.parsed, repairPacket);
            for (const [repairIndex, offset] of repairOffsets.entries()) {
              const repairedDraft = repairedDrafts[repairIndex];
              const repairedVerification = reverifiedByN.get(packet[offset].n);
              if (!repairedDraft || !repairedVerification) continue;
              drafts[offset] = repairedDraft;
              verifierByN.set(packet[offset].n, repairedVerification);
            }
          } catch (error) {
            noteProviderFailure(error);
            log("[article-summary] repair failed");
          }
        }
        const consensusByN = new Map();
        const consensusModes = new Map(batch.map((row, index) => [
          index,
          independentVerificationMode(row, packet[index], drafts[index], verifierByN.get(packet[index].n))
        ]).filter(([, mode]) => mode));
        const consensusOffsets = [...consensusModes.keys()];
        if (allowRecovery && consensusOffsets.length && !providerIsHeld()) {
          try {
            const consensusPacket = consensusOffsets.map((index) => packet[index]);
            const consensusDrafts = consensusOffsets.map((index) => drafts[index]);
            const consensus = await callModel({
              apiKey, model: verifierModel, system: VERIFY_SYSTEM,
              prompt: verifierPromptFor(consensusPacket, consensusDrafts), schema: VERIFY_SCHEMA,
              maxTokens: Math.min(8000, 4600 + consensusOffsets.length * 3400), fetchImpl, onUsage,
              purpose: "오늘판 기사 장문 요약 독립 재검증"
            });
            for (const row of validIssueMap(consensus.parsed, consensusPacket).values()) consensusByN.set(row.n, row);
          } catch (error) {
            noteProviderFailure(error);
            log("[article-summary] independent verification failed");
          }
        }
        const savedAt = new Date(clock()).toISOString();
        for (const [offset, row] of batch.entries()) {
          let draft = drafts[offset];
          const verification = verifierByN.get(offset + 1) || null;
          const consensusMode = consensusModes.get(offset) || null;
          let generationModel = model;
          let fallbackResult = null;
          const anchor = row.sources.find((source) => source.result.state === "available");
          let accepted = allowRecovery
            ? acceptedVerification(
              row, packet[offset], draft, verification, consensusMode, consensusByN.get(offset + 1)
            )
            : acceptedPrimaryVerification(row, packet[offset], draft, verification);
          if (allowRecovery && !accepted && effectiveFallbackModel && !providerIsHeld()) {
            fallbackResult = await regenerateWithFallback(row, packet[offset]);
            if (fallbackResult && fallbackResult.draft) draft = fallbackResult.draft;
            if (fallbackResult && fallbackResult.accepted) {
              accepted = true;
              generationModel = effectiveFallbackModel;
              fallbackGenerated += 1;
            }
          }
          if (!accepted && providerIsHeld()) {
            rejected += 1;
            continue;
          }
          const failureReason = draft ? "SUMMARY_VERIFICATION_HOLD" : "SUMMARY_GENERATION_ERROR";
          if (!accepted) {
            log(`[article-summary] hold ${articleContentId(row.resolvedIssue)} ` +
              `${draft ? sentenceAuditFailure(
                draft.textKo, packet[offset], fallbackResult && fallbackResult.verifier || verification
              ) || "post_consensus" : "missing_draft"}`);
            const articleSummary = {
              ...unavailable(row.resolvedIssue, anchor && anchor.source, failureReason, row.resolvedSources,
                anchor && anchor.result.image || null, clock()),
              articleContentAliases: row.articleContentAliases
            };
            output[row.index] = {
              ...row.issue,
              articleSummary: fallbackResult && fallbackResult.transient
                ? articleSummary
                : holdUnavailable(row, articleSummary)
            };
            rejected += 1;
            continue;
          }
          const articleSummary = {
            status: "ready",
            contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
            contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
            promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
            articleContentId: articleContentId(row.resolvedIssue),
            articleContentAliases: row.articleContentAliases,
            eventSourceSetId: row.issue.eventSourceSetId || null,
            textKo: clean(draft.textKo),
            sourceEvidenceId: anchor.source.evidenceId,
            sourceLabel: anchor.source.sourceLabel,
            sourceCount: row.resolvedSources.length,
            summarySourceCount: 1 + packet[offset].supporting.length,
            sourceLinks: sourceLinks(row.resolvedSources),
            image: anchor.result.image || null,
            generationModel,
            unavailableReasonCode: null,
            generatedAt: savedAt
          };
          saveCache(row, {
            contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
            contractVersion: ARTICLE_SUMMARY_CONTRACT.version,
            promptVersion: ARTICLE_SUMMARY_CONTRACT.promptVersion,
            model,
            verifierModel,
            fallbackModel: effectiveFallbackModel,
            verified: true,
            articleSummary,
            savedAt
          });
          output[row.index] = { ...row.issue, articleSummary };
          generated += 1;
        }
      } catch (error) {
        const message = noteProviderFailure(error);
        const reason = /^(?:api \d+(?: [a-z_]+)?|refusal|truncated|no text block)$/.test(message)
          ? message
          : message === "invalid model issue set" ? "invalid_model_issue_set"
          : error && error.name || "unknown";
        log(`[article-summary] batch failed (${reason})`);
        if (providerIsHeld()) {
          rejected += batch.length;
          continue;
        }
        for (const row of batch) {
          const anchor = row.sources.find((source) => source.result.state === "available");
          const articleSummary = {
            ...unavailable(
              row.resolvedIssue, anchor && anchor.source, "SUMMARY_GENERATION_ERROR", row.resolvedSources,
              anchor && anchor.result.image || null, clock()
            ),
            articleContentAliases: row.articleContentAliases
          };
          output[row.index] = {
            ...row.issue,
            articleSummary: holdUnavailable(row, articleSummary)
          };
          rejected += 1;
        }
      }
    }

    let excerpted = 0;
    if (completeBeforePublish) {
      for (const row of fetchedRows) {
        if (isPreparedArticleSummary(output[row.index]?.articleSummary, row.issue)) continue;
        const articleSummary = await excerptSummary(row, { translateText, nowMs: clock() });
        if (articleSummary) {
          output[row.index] = { ...row.issue, articleSummary };
          excerpted += 1;
          continue;
        }
        const anchor = row.sources.find((source) => source.result.state === "available");
        const image = row.sources.find((source) => source.result.image)?.result.image || null;
        output[row.index] = {
          ...row.issue,
          articleSummary: saveUnavailable(row, {
            ...unavailable(
              row.resolvedIssue, anchor?.source || row.sourceRows[0] || null,
              "NO_SUBSTANTIAL_PUBLIC_BODY", row.resolvedSources, image, clock()
            ),
            articleContentAliases: row.articleContentAliases
          })
        };
        unavailableCount += 1;
      }
    }

    return {
      ...edition,
      issues: output,
      llmCalls: Number(edition.llmCalls || 0) + calls,
      articleSummaryReceipt: {
        contractId: ARTICLE_SUMMARY_CONTRACT.stableId,
        state: rejected || unavailableCount ? "partial" : "complete",
        issueCount: issues.length,
        fetched,
        cacheHits,
        generated,
        excerpted,
        fallbackGenerated,
        unavailable: unavailableCount,
        rejected,
        calls,
        model: calls || cacheHits ? model : null,
        verifierModel: calls || cacheHits ? verifierModel : null,
        fallbackModel: fallbackGenerated ? effectiveFallbackModel : null,
        rawArticleStored: false
      }
    };
  }

  const locks = new Map();
  return function serializedArticleSummaries(edition) {
    // ponytail: one provider lock is enough for inventory traffic; split per model only if measured throughput needs it.
    const keys = unique([PROVIDER_LOCK_KEY, ...(edition?.issues || []).map(articleContentId)]).sort();
    const predecessors = unique(keys.map((key) => locks.get(key)).filter(Boolean));
    const run = Promise.allSettled(predecessors).then(() => attachArticleSummaries(edition));
    const released = run.then(() => undefined, () => undefined);
    for (const key of keys) locks.set(key, released);
    released.finally(() => {
      for (const key of keys) if (locks.get(key) === released) locks.delete(key);
    });
    return run;
  };
}
