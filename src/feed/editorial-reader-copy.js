import { createHash } from "node:crypto";
import { verifyEditorialLineage } from "./editorial-lineage.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const EDITORIAL_READER_COPY_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-READER-COPY-CONTRACT-001",
  version: 11,
  fingerprintVersion: 3,
  mode: "response_only_press_style_projection",
  visibleFields: ["headline", "summary", "whyImportant", "whyNow", "change", "watchNext", "confidenceLabel"],
  hiddenFields: ["whyForYou"],
  reviewPacketRule: "독자에게 보이는 일곱 필드와 그 기계 판정을 검수 패킷에 함께 동결한다.",
  canonicalContentMutated: false,
  llmCalls: 0
});

export const EDITORIAL_EVENT_FRAME_CONTRACT = deepFreeze({
  stableId: "NOWHOT-EDITORIAL-EVENT-FRAME-CONTRACT-001",
  version: 1,
  primaryFields: ["subject", "headline", "whatHappened", "paragraph"],
  excludedInputs: ["refs", "related_observation"],
  rule: "주 사건 정본 문장만 프레임 선택에 사용하고 관련기사 제목은 중요성·관전 문장을 바꾸지 못한다."
});

export const READER_COPY_FIELDS = Object.freeze([
  "headline",
  "summary",
  "whyImportant",
  "whyNow",
  "change",
  "watchNext",
  "confidenceLabel"
]);
export const READER_COPY_REQUIRED_FIELDS = Object.freeze(
  READER_COPY_FIELDS.filter((field) => field !== "watchNext")
);

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const sha256 = (value) => createHash("sha256").update(String(value || "")).digest("hex");
const INTERNAL_READER_JARGON = /(?:지금핫\s*수집|수집\s*풀|관련\s*보도\s*묶음\s*신호|기계\s*게이트|첫\s*저장\s*판|이전\s*판|포함했(?:다|습니다))/i;

const EDITORIAL_EVENT_FRAMES = deepFreeze([
  {
    id: "hormuz_shipping",
    match: /호르무즈|기뢰\s*(?:제거|해제)/i,
    whyImportant: "호르무즈 해협의 통항 상황은 국제유가와 운임, 기업 물류비에 직접 연결됩니다. 협상과 실제 선박 운항을 함께 봐야 합니다.",
    watchNext: "당사국 공식 발표와 해협 통항 상황, 국제유가·운임 움직임이 다음 확인 대상입니다."
  },
  {
    id: "earthquake",
    match: /강진|지진|여진/i,
    whyImportant: "인명 피해와 구조·복구 상황이 핵심입니다. 피해 규모와 추가 여진, 현지 당국의 대응을 확인해야 합니다.",
    watchNext: "현지 당국의 사상자·구조 집계와 추가 여진·2차 피해 여부를 확인해야 합니다."
  },
  {
    id: "severe_weather",
    match: /폭염|열대야|한낮\s*\d{2}도|태풍|호우|폭우|한파/i,
    whyImportant: "기상 변화는 건강 피해와 전력 수요, 교통·야외 일정에 직접 영향을 줍니다. 지역별 예보와 경보 수준을 확인해야 합니다.",
    watchNext: "기상청 특보와 지역별 최고기온·강수 예보가 다음 확인 대상입니다."
  },
  {
    id: "election_integrity",
    match: /(?:투표|개표).{0,30}(?:오차|오류|누락|재검표)|(?:오차|오류).{0,20}(?:투표|개표)/i,
    whyImportant: "투표자 수와 집계 오차는 선거 절차의 신뢰와 결과 확정에 영향을 줍니다. 정정 범위와 원인을 확인해야 합니다.",
    watchNext: "선거관리 당국의 정정 집계와 오류 원인, 결과 확정 여부를 확인해야 합니다."
  },
  {
    id: "rental_housing",
    match: /전월세|임차인|임대차|전세난|월세난/i,
    whyImportant: "전월세 공급과 제도 변화는 임차인의 주거비와 계약 선택에 바로 영향을 줍니다. 적용 지역과 시행 시점을 확인해야 합니다.",
    watchNext: "정부의 세부 대책과 지역별 전월세 매물·가격 변화가 다음 확인 대상입니다."
  },
  {
    id: "property_tax",
    match: /종부세|보유세|재산세|비거주\s*1주택/i,
    whyImportant: "보유세 기준 변화는 주택 보유 비용과 매물 결정에 영향을 줍니다. 과세 대상과 적용 시점을 확인해야 합니다.",
    watchNext: "정부·여당의 확정안과 과세 기준, 시행 시점이 다음 확인 대상입니다."
  },
  {
    id: "visa_immigration",
    match: /비자.{0,20}(?:취소|중단|제한)|입국.{0,20}(?:금지|제한)/i,
    whyImportant: "비자 취소와 입국 제한은 유학·취업·이민 일정과 기업 인력 운영에 영향을 줍니다. 대상과 이의 절차를 확인해야 합니다.",
    watchNext: "취소 대상·사유에 대한 당국 설명과 소송·이의 제기 결과를 확인해야 합니다."
  },
  {
    id: "migration_humanitarian",
    match: /이주민|난민|피란민|실향민/i,
    whyImportant: "이주민 규모는 인도적 지원과 귀환 정책, 수용 지역의 행정 부담에 연결됩니다. 체류 조건과 지원 계획을 확인해야 합니다.",
    watchNext: "관계 당국의 최신 인원 집계와 귀환·정착 지원 계획이 다음 확인 대상입니다."
  },
  {
    id: "arctic_shipping",
    match: /북극항로|시험\s*운행.{0,20}(?:항|항로)|항만.{0,20}선정/i,
    whyImportant: "새 항로와 항만 선정은 물류 시간·비용과 지역 인프라 투자에 영향을 줍니다. 실제 운항 조건과 사업 일정을 확인해야 합니다.",
    watchNext: "정부의 항만 선정 결과와 시험 운항 일정·비용 공개가 다음 확인 대상입니다."
  },
  {
    id: "industrial_investment",
    match: /소[·ㆍ]?부[·ㆍ]?장|산업단지|공장.{0,20}(?:건설|투자|유치)|(?:투자|유치).{0,20}공장/i,
    whyImportant: "대규모 공장·산업 투자는 지역 고용과 공급망, 후속 기업 유치에 영향을 줍니다. 투자 주체와 실제 집행 일정을 확인해야 합니다.",
    watchNext: "기업·지자체의 확정 투자액과 착공·고용 일정이 다음 확인 대상입니다."
  },
  {
    id: "medical_rights",
    match: /의사.{0,20}헌법|의료.{0,20}(?:행정처분|법적|헌법)|환자.{0,20}권리/i,
    whyImportant: "의료인의 법적 책임과 행정 기준은 환자 권리와 의료 현장 운영에 연결됩니다. 판결·처분의 적용 범위를 확인해야 합니다.",
    watchNext: "법원·보건당국의 판단 근거와 의료계의 후속 대응을 확인해야 합니다."
  },
  {
    id: "market_forecast",
    match: /S&P\s*500.{0,30}목표|증시.{0,20}목표치|목표치.{0,20}(?:상향|하향)/i,
    whyImportant: "증권사의 지수 목표치는 투자 심리에 영향을 주지만 전망일 뿐입니다. 근거가 된 실적·금리 가정과 실제 지표를 구분해야 합니다.",
    watchNext: "전망의 실적·금리 가정과 실제 지수·기업 이익 변화가 다음 확인 대상입니다."
  },
  {
    id: "air_defense_request",
    match: /방공.{0,20}(?:지원|요청|무기)|(?:지원|요청).{0,20}(?:방공|무기)/i,
    whyImportant: "방공 무기 지원 요청은 외교 관계와 방산 재고, 해당 지역의 방어 능력에 영향을 줍니다. 정부 답변과 지원 범위를 확인해야 합니다.",
    watchNext: "요청을 받은 정부의 공식 답변과 지원 품목·일정이 다음 확인 대상입니다."
  },
  {
    id: "troop_missile_deployment",
    match: /북한군.{0,30}(?:배치|파병)|병력.{0,20}(?:추가\s*)?배치|탄도미사일.{0,20}(?:지원|제공|인도)/i,
    whyImportant: "병력·미사일의 추가 배치는 전선 위험과 관련국의 제재·군사 대응을 키울 수 있습니다. 규모와 배치 여부를 교차 확인해야 합니다.",
    watchNext: "관계 당국의 추가 배치 확인과 병력·미사일 규모, 대응 조치가 다음 확인 대상입니다."
  },
  {
    id: "military_strike",
    match: /(?:드론|미사일|공습).{0,30}(?:타격|공격)|(?:타격|공격).{0,30}(?:석유화학|정유|군사시설)/i,
    whyImportant: "군사 공격과 기반시설 피해는 안보 긴장과 에너지·물류 공급에 영향을 줄 수 있습니다. 피해 규모와 보복 여부를 확인해야 합니다.",
    watchNext: "피해 규모에 대한 공식 확인과 상대국의 대응, 시설 가동 변화가 다음 확인 대상입니다."
  },
  {
    id: "defense_vulnerability",
    match: /방공망.{0,20}취약|군사기지.{0,20}취약|미군기지.{0,20}취약/i,
    whyImportant: "기지 방공 취약성은 주둔군과 주변 지역의 안전, 방위 투자 우선순위에 연결됩니다. 공식 평가와 보강 계획을 확인해야 합니다.",
    watchNext: "군 당국의 공식 평가와 방공망 보강 예산·배치 계획이 다음 확인 대상입니다."
  },
  {
    id: "iran_compensation",
    match: /이란.{0,30}배상|배상.{0,30}이란/i,
    whyImportant: "국가 간 배상 요구는 미·이란 협상과 제재, 외교적 긴장에 영향을 줄 수 있습니다. 법적 근거와 상대국 반응을 확인해야 합니다.",
    watchNext: "이란 정부의 공식 반응과 양국 협상·제재 변화가 다음 확인 대상입니다."
  },
  {
    id: "party_leadership",
    match: /당권|당대표|전당대회|당내.{0,20}(?:갈등|논란)|정청래|김민석.{0,20}경제정책/i,
    whyImportant: "정당 지도부와 내부 노선 갈등은 향후 입법·정책 우선순위에 영향을 줍니다. 공식 공약과 지도부 결정을 확인해야 합니다.",
    watchNext: "후보·지도부의 공식 입장과 당내 표결·경선 일정이 다음 확인 대상입니다."
  },
  {
    id: "public_official_ethics",
    match: /무단\s*증축|공직자.{0,20}(?:논란|의혹)|춘추관장.{0,20}논란/i,
    whyImportant: "공직자의 법규 위반 논란은 인사 책임과 행정 조치의 일관성에 연결됩니다. 사실관계와 처분 여부를 확인해야 합니다.",
    watchNext: "관계 기관의 현장 확인과 시정 명령·인사 조치 여부가 다음 확인 대상입니다."
  },
  {
    id: "sports_result",
    match: /챔피언십|아시안게임|KBO|공동\s*\d+위|(?:우승|승리|패배|선발).{0,20}(?:경기|대회|매치)/i,
    whyImportant: "경기 결과와 선수 성적은 순위와 다음 대회 출전 구도에 영향을 줍니다. 공식 기록과 후속 일정을 확인해야 합니다.",
    watchNext: "공식 순위와 다음 경기·대회 일정, 출전 명단이 다음 확인 대상입니다."
  },
  {
    id: "biomedical_research",
    match: /신약|항체|생명체\s*설계|임상\s*시험|백신/i,
    whyImportant: "생명과학 연구는 신약 개발과 치료 선택에 영향을 줄 수 있지만 검증 단계가 중요합니다. 원 연구와 임상 범위를 확인해야 합니다.",
    watchNext: "원 연구의 검증 수준과 임상시험 단계·대상 공개가 다음 확인 대상입니다."
  }
]);

function primaryEvidenceRows(issue) {
  return (issue && issue.sourceEvidence || [])
    .filter((row) => row && row.evidenceRole !== "related_observation");
}

function primaryRefs(issue) {
  const relatedTitles = new Set((issue && issue.sourceEvidence || [])
    .filter((row) => row && row.evidenceRole === "related_observation")
    .map((row) => clean(row.title))
    .filter(Boolean));
  return (issue && issue.refs || [])
    .filter((row) => row && !relatedTitles.has(clean(row.title)));
}

function issueEventText(issue) {
  return clean(EDITORIAL_EVENT_FRAME_CONTRACT.primaryFields
    .map((field) => issue && issue[field])
    .join(" "));
}

function editorialEventFrameMatch(issue) {
  const text = issueEventText(issue);
  const frame = EDITORIAL_EVENT_FRAMES.find((candidate) => candidate.match.test(text)) || null;
  if (!frame) return null;
  return {
    frame,
    textHash: sha256(text),
    evidenceIds: primaryEvidenceRows(issue).map((row) => row.evidenceId).filter(Boolean)
  };
}

const editorialEventFrame = (issue) => editorialEventFrameMatch(issue)?.frame || null;

function stripLeadTags(value) {
  let text = clean(value);
  for (let index = 0; index < 3; index += 1) {
    const stripped = text.replace(/^\s*[[【(<][^\]】)>]{0,16}[\]】)>]\s*/, "");
    if (stripped === text) break;
    text = stripped;
  }
  return clean(text);
}

function stripOuterQuotes(value) {
  let text = clean(value);
  for (let index = 0; index < 2; index += 1) {
    const stripped = text.replace(/^[“”'"‘’]+|[“”'"‘’]+$/g, "").trim();
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

function hasFinalConsonant(value) {
  const text = clean(value).replace(/[^가-힣a-zA-Z0-9]/g, "");
  if (!text) return false;
  const last = text[text.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(last)) return "013678".includes(last);
  return false;
}

const withSubjectParticle = (value) => `${clean(value)}${hasFinalConsonant(value) ? "이" : "가"}`;

function sourceNames(issue) {
  return unique([
    ...primaryEvidenceRows(issue).map((row) => row.sourceLabel),
    ...primaryRefs(issue).map((row) => row.sourceLabel),
    ...((issue && issue.evidence && issue.evidence.sources) || []).map((row) => row && (row.label || row.source))
  ]).slice(0, 3);
}

function verifiedEditSupport(issue, field) {
  const edit = issue && issue.editorialEdit;
  const evidence = issue && issue.sourceEvidence || [];
  const known = new Set(evidence.map((row) => row && row.evidenceId).filter(Boolean));
  const support = edit && edit.support && edit.support[field];
  return Boolean(
    edit && edit.state === "verified_edit" &&
    edit.evidenceHash && edit.evidenceHash === issue.evidenceHash &&
    Array.isArray(support) && support.length > 0 &&
    support.every((evidenceId) => known.has(evidenceId)) &&
    verifyEditorialLineage(issue).pass
  );
}

function policyLineageSupport(issue) {
  const lineage = issue && issue.claimLineage;
  const claim = lineage && lineage.claims && lineage.claims.whyImportant;
  return Boolean(
    verifyEditorialLineage(issue).pass &&
    claim && claim.basis === "editorial_policy" &&
    clean(claim.policyRule) &&
    Array.isArray(claim.evidenceIds) && claim.evidenceIds.length > 0
  );
}

function leadTitle(issue) {
  return stripOuterQuotes(stripLeadTags(
    primaryRefs(issue)[0] && primaryRefs(issue)[0].title ||
    primaryEvidenceRows(issue)[0] && primaryEvidenceRows(issue)[0].title ||
    issue && issue.subject || issue && issue.headline
  ));
}

function readerEventLabel(issue) {
  const label = stripOuterQuotes(stripLeadTags(issue && issue.subject || leadTitle(issue)));
  if (label.length <= 56) return label;
  return `${label.slice(0, 55).trim()}…`;
}

function withEventContext(issue, sentence) {
  const text = clean(sentence);
  const label = readerEventLabel(issue);
  if (!label || text.includes(label)) return text;
  return `“${label}” 관련해 ${text}`;
}

function readerHeadline(issue) {
  if (verifiedEditSupport(issue, "headline")) return clean(issue.headline);
  const subject = stripLeadTags(issue && issue.subject);
  const title = leadTitle(issue);
  if (subject.length >= 6 && (/[가-힣]/.test(subject) || !title)) return subject;
  if (title) return title;
  return clean(issue && issue.headline)
    .replace(/^관련 보도 흐름에 잡힌\s*/, "")
    .replace(/\s*·\s*(?:관련 보도 묶음 포착|복수 수집 경로 확인)\s*$/, "")
    .replace(/^[“"]|[”"]$/g, "");
}

function readerSummary(issue) {
  if (verifiedEditSupport(issue, "whatHappened")) return clean(issue.paragraph);
  if (issue && issue.shape !== "coverage") return clean(issue.paragraph || issue.whatHappened);
  const title = leadTitle(issue);
  const names = sourceNames(issue);
  const mode = clean(issue && issue.evidence && issue.evidence.mode || issue && issue.metrics && issue.metrics.evidenceMode);
  if (mode === "multiple_feed_observed" && names.length) {
    return `${names.join("·")}에서 “${title}” 관련 보도를 확인했습니다.`;
  }
  if (names.length) {
    return `${withSubjectParticle(names[0])} “${title}”${hasFinalConsonant(title) ? "이라고" : "라고"} 보도했습니다.`;
  }
  return `“${title}” 관련 보도가 나왔습니다.`;
}

function readerWhyImportant(issue) {
  const categoryIds = new Set(issue && issue.categoryIds || []);
  const original = clean(issue && issue.whyImportant);
  const contextualPolicyText = () => {
    const formal = original
      .replace(/가치가 있다\.?$/, "가치가 있습니다.")
      .replace(/필요가 있다\.?$/, "필요가 있습니다.")
      .replace(/해야 한다\.?$/, "해야 합니다.");
    const subject = stripOuterQuotes(stripLeadTags(issue && issue.subject));
    if (!/볼 가치가 있다\.?$/.test(original) || !/[가-힣]/.test(subject) || subject.length > 56 || formal.includes(subject)) {
      return formal;
    }
    return `“${subject}”${hasFinalConsonant(subject) ? "과" : "와"} 관련해 ${formal}`;
  };
  const verifiedEdit = verifiedEditSupport(issue, "whyImportant");
  if (verifiedEdit && original.length >= 20 && !INTERNAL_READER_JARGON.test(original)) {
    return original
      .replace(/가치가 있다\.?$/, "가치가 있습니다.")
      .replace(/필요가 있다\.?$/, "필요가 있습니다.")
      .replace(/해야 한다\.?$/, "해야 합니다.");
  }
  const eventFrame = editorialEventFrame(issue);
  if (eventFrame) return withEventContext(issue, eventFrame.whyImportant);
  if (policyLineageSupport(issue) && original.length >= 20 && !INTERNAL_READER_JARGON.test(original)) {
    return withEventContext(issue, contextualPolicyText());
  }
  const text = issueEventText(issue);
  const communityOnly = issue && issue.metrics && issue.metrics.communityOnly === true;
  const weighty = ["news", "politics", "business", "realestate"].some((id) => categoryIds.has(id));
  if (communityOnly && weighty) {
    return withEventContext(issue,
      "확인된 사실이 아니라 온라인 반응입니다. 여론의 방향만 참고해야 합니다.");
  }
  if (categoryIds.has("business")) {
    if (/(호르무즈|전쟁|공습|미사일|정유시설|관세|제재|공급망|이란|우크라)/.test(text)) {
      return withEventContext(issue,
        "유가와 물류비, 기업 비용, 증시 변동성에 영향을 줄 수 있습니다. 협상 결과와 후속 지표를 함께 봐야 합니다.");
    }
    if (/(금리|채권|환율|코스피|코스닥|증시|주가|실적|매출|배당)/.test(text)) {
      return withEventContext(issue,
        "증시와 자산 가격, 기업 실적에 영향을 줄 수 있습니다. 발표 수치와 원자료를 확인해야 합니다.");
    }
    return withEventContext(issue,
      "기업 활동과 경기 흐름에 영향을 줄 수 있습니다. 실제 수치와 후속 발표를 함께 봐야 합니다.");
  }
  let categoryContext = "사회 흐름에서 달라진 점이 있는 사안입니다. 후속 사실과 영향을 확인해야 합니다.";
  if (categoryIds.has("realestate")) categoryContext = "집값과 대출, 공급 계획에 영향을 줄 수 있습니다. 적용 대상과 시행 시점을 확인해야 합니다.";
  else if (categoryIds.has("politics")) categoryContext = "정책 결정과 외교 관계의 변화를 보여주는 사안입니다. 당사자 발표와 후속 조치를 확인해야 합니다.";
  else if (categoryIds.has("tech")) categoryContext = "제품과 산업 경쟁, 기술 도입 속도에 영향을 줄 수 있습니다. 실제 적용 범위와 후속 발표를 봐야 합니다.";
  else if (categoryIds.has("science")) categoryContext = "기존 설명을 바꿀 수 있는 연구인지가 핵심입니다. 원 연구와 검증 범위를 함께 확인해야 합니다.";
  else if (categoryIds.has("auto")) categoryContext = "차량 선택과 운행, 자동차 시장 변화에 연결되는 내용입니다. 제원과 실제 이용 반응을 함께 봐야 합니다.";
  else if (categoryIds.has("sports")) categoryContext = "경기 결과와 선수, 리그 운영에 영향을 줄 수 있습니다. 공식 발표와 후속 일정을 확인해야 합니다.";
  else if (categoryIds.has("life")) categoryContext = "건강과 이동, 일상 선택에 영향을 줄 수 있습니다. 적용 대상과 실제 조건을 확인해야 합니다.";
  else if (categoryIds.has("fashion")) categoryContext = "제품과 스타일이 어디서 주목받는지 보여주는 흐름입니다. 출시 배경과 실제 반응을 함께 봐야 합니다.";
  else if (categoryIds.has("art")) categoryContext = "작품과 전시, 디자인 흐름을 이해하는 데 필요한 소식입니다. 공개 배경과 후속 반응을 함께 봐야 합니다.";
  else if (categoryIds.has("culture")) categoryContext = "대중문화에서 무엇이 주목받고 퍼지는지 보여주는 소식입니다. 공식 정보와 대중 반응을 나눠 봐야 합니다.";
  else if (categoryIds.has("gaming")) categoryContext = "출시와 업데이트, 이용자 반응에 영향을 줄 수 있습니다. 실제 변경 내용과 평가를 함께 봐야 합니다.";
  else if (categoryIds.has("humor")) categoryContext = "지금 빠르게 퍼지는 소재와 반응을 보여줍니다. 맥락과 확산 규모를 함께 볼 필요가 있습니다.";
  return withEventContext(issue, categoryContext);
}

function readerWhyNow(issue) {
  const metrics = issue && issue.metrics || {};
  const mode = clean(issue && issue.evidence && issue.evidence.mode || metrics.evidenceMode);
  const names = sourceNames(issue);
  const reactions = [];
  if (Number(metrics.score) > 0) reactions.push(`추천 ${Math.round(metrics.score).toLocaleString("ko-KR")}건`);
  if (Number(metrics.comments) > 0) reactions.push(`댓글 ${Math.round(metrics.comments).toLocaleString("ko-KR")}건`);
  if (reactions.length) {
    const where = names.length ? `${names[0]}에서 ` : "";
    return withEventContext(issue, `${where}${reactions.join("과 ")}의 반응이 확인됐습니다.`);
  }
  if (mode === "multiple_feed_observed") {
    const count = Math.max(2, Number(metrics.independentGroupCount || issue && issue.evidence && issue.evidence.independentGroupCount || names.length));
    return withEventContext(issue, names.length
      ? `${names.slice(0, 2).join("·")} 등 ${count}개 출처에서 관련 보도가 확인됐습니다.`
      : `${count}개 출처에서 관련 보도가 확인됐습니다.`);
  }
  if (mode === "related_coverage_signal" && names.length) {
    return withEventContext(issue, `${names[0]}의 보도가 새로 확인됐습니다.`);
  }
  if (names.length) {
    return withEventContext(issue, issue && issue.metrics && issue.metrics.communityOnly === true
      ? `${names[0]}에 새 게시물이 올라왔습니다.`
      : `${withSubjectParticle(names[0])} 새 보도를 냈습니다.`);
  }
  return withEventContext(issue, "새 보도가 확인됐습니다.");
}

function readerWatchNext(issue) {
  const eventFrame = editorialEventFrame(issue);
  if (eventFrame) return withEventContext(issue, eventFrame.watchNext);
  const text = issueEventText(issue);
  if (/(호르무즈|전쟁|공습|미사일|정유시설|관세|제재|공급망|이란|우크라)/.test(text)) {
    return withEventContext(issue,
      "당사국 공식 발표와 국제유가·증시 움직임이 다음 확인 대상입니다.");
  }
  if (/(금리|채권|환율|코스피|코스닥|증시|주가|실적|매출|배당)/.test(text)) {
    return withEventContext(issue, "후속 수치와 공식 발표가 다음 확인 대상입니다.");
  }
  const metrics = issue && issue.metrics || {};
  if (Number(metrics.score) >= 50 || Number(metrics.comments) >= 30) {
    const names = sourceNames(issue);
    return withEventContext(issue, names.length
      ? `${names[0]}에서 반응이 계속 커지는지, 새 맥락이 붙는지 볼 필요가 있습니다.`
      : "반응이 계속 커지는지, 새 맥락이 붙는지 볼 필요가 있습니다.");
  }
  return "";
}

function readerConfidenceLabel(issue) {
  const code = clean(
    issue && issue.confidence && issue.confidence.code ||
    issue && issue.evidence && issue.evidence.mode ||
    issue && issue.metrics && issue.metrics.evidenceMode
  );
  if (code === "multiple_feed_observed") return "여러 출처 보도";
  if (code === "related_coverage_signal") return "단일 기사 확인";
  if (code === "community_signal") return "온라인 반응";
  if (["single_feed_observed", "single_source_measured", "single_source_observed"].includes(code)) return "단일 출처";
  return clean(issue && issue.confidence && issue.confidence.label) || "근거 확인 중";
}

function readerChange(issue) {
  const raw = clean(issue && issue.changedSincePrevious);
  if (!raw) return "";
  return raw
    .replace(/이전\s*판에\s*없던\s*새\s*사건이다\.?/g, "이번 브리핑에서 새로 전하는 소식입니다.")
    .replace(/이\s*카테고리로\s*저장된\s*첫\s*브리핑입니다\.?/g, "이 분야에서 이번에 처음 전하는 소식입니다.")
    .replace(/첫\s*저장\s*판/g, "첫 브리핑")
    .replace(/이전\s*판/g, "앞선 브리핑");
}

const CHANGE_STATES = new Set(["baseline", "new", "material_update", "reaction_update", "unchanged"]);
const MATERIAL_CHANGE_REASONS = new Set([
  "evidence_mode_changed",
  "observed_feed_count_changed",
  "new_observed_source",
  "related_coverage_increased"
]);

function signed(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

function expectedChangeText(issue) {
  const state = clean(issue && issue.changeState);
  const evidence = issue && issue.changeEvidence || {};
  const reasons = Array.isArray(evidence.reasons) ? evidence.reasons : [];
  const deltas = evidence.deltas || {};
  if (state === "baseline") return "이 카테고리로 저장된 첫 브리핑입니다.";
  if (state === "new") return "지난 브리핑에서는 다루지 않은 소식입니다.";
  if (state === "unchanged") return "지난 브리핑에서 다룬 내용과 같습니다. 새로 확인된 사실은 없습니다.";
  if (state === "reaction_update") {
    const reaction = [];
    if (Number(deltas.score)) reaction.push(`추천 ${signed(deltas.score)}`);
    if (Number(deltas.comments)) reaction.push(`댓글 ${signed(deltas.comments)}`);
    return reaction.length
      ? `지난 브리핑과 같은 내용입니다. ${reaction.join(" · ")}의 반응만 달라졌고 새 사실은 확인되지 않았습니다.`
      : null;
  }
  if (state !== "material_update") return null;
  const bits = [];
  const newSources = unique(evidence.newSources);
  if (newSources.length) bits.push(`${newSources.join("·")} 보도가 새로 확인됐습니다.`);
  else if (reasons.includes("observed_feed_count_changed")) {
    const currentCount = Number(issue && issue.metrics && issue.metrics.sourceCount) || 0;
    bits.push(`직접 확인한 보도가 ${currentCount - (Number(deltas.sourceCount) || 0)}건에서 ${currentCount}건으로 늘었습니다.`);
  } else if (reasons.includes("evidence_mode_changed")) {
    bits.push("확인 근거가 더 보강됐습니다.");
  }
  if (reasons.includes("related_coverage_increased")) bits.push("같은 주제를 다룬 보도도 더 늘었습니다.");
  const reaction = [];
  if (Number(deltas.score)) reaction.push(`추천 ${signed(deltas.score)}`);
  if (Number(deltas.comments)) reaction.push(`댓글 ${signed(deltas.comments)}`);
  if (reaction.length) bits.push(`${reaction.join(" · ")}의 반응 변화도 확인됐습니다.`);
  return bits.length ? ["지난 브리핑에서 다룬 사안입니다.", ...bits].join(" ") : null;
}

function assessChangeEvidence(issue) {
  const state = clean(issue && issue.changeState);
  const evidence = issue && issue.changeEvidence;
  const reasons = evidence && Array.isArray(evidence.reasons) ? evidence.reasons : [];
  const deltas = evidence && evidence.deltas || {};
  const expected = expectedChangeText(issue);
  const stateReason = state === "baseline" ? reasons.includes("no_previous_snapshot")
    : state === "new" ? reasons.includes("not_in_previous_edition")
      : state === "material_update" ? reasons.some((reason) => MATERIAL_CHANGE_REASONS.has(reason))
        : state === "reaction_update" ? reasons.includes("reaction_only") && Boolean(Number(deltas.score) || Number(deltas.comments))
          : state === "unchanged" ? reasons.includes("no_observed_change")
            : false;
  const pass = Boolean(
    CHANGE_STATES.has(state) && evidence && reasons.length && stateReason && expected &&
    clean(issue && issue.changedSincePrevious) === expected
  );
  return { pass, state, reasons, expected };
}

function readerBasis(issue) {
  const evidenceIds = primaryEvidenceRows(issue).map((row) => row.evidenceId).filter(Boolean);
  const measuredEvidenceIds = (issue && issue.sourceEvidence || []).map((row) => row && row.evidenceId).filter(Boolean);
  const eventFrameMatch = editorialEventFrameMatch(issue);
  const eventFrame = eventFrameMatch && eventFrameMatch.frame;
  const lineageClaim = issue && issue.claimLineage && issue.claimLineage.claims && issue.claimLineage.claims.whyImportant;
  const whyImportantBasis = verifiedEditSupport(issue, "whyImportant") ? "verified_edit"
    : eventFrame ? `event_frame:${eventFrame.id}`
      : policyLineageSupport(issue) ? `editorial_policy:${clean(lineageClaim.policyRule)}`
        : "category_policy";
  return {
    headline: { kind: verifiedEditSupport(issue, "headline") ? "verified_edit" : "subject_source_titles", evidenceIds },
    summary: { kind: verifiedEditSupport(issue, "whatHappened") ? "verified_edit" : "source_titles", evidenceIds },
    whyImportant: {
      kind: whyImportantBasis,
      evidenceIds,
      ...(eventFrameMatch ? {
        frameContractId: EDITORIAL_EVENT_FRAME_CONTRACT.stableId,
        frameContractVersion: EDITORIAL_EVENT_FRAME_CONTRACT.version,
        matchedTextHash: eventFrameMatch.textHash
      } : {})
    },
    whyNow: { kind: "measured_signal", evidenceIds: measuredEvidenceIds },
    change: { kind: "edition_change", state: clean(issue && issue.changeState), evidence: issue && issue.changeEvidence || null },
    watchNext: {
      kind: eventFrame ? `event_frame:${eventFrame.id}` : "editorial_watch",
      evidenceIds,
      ...(eventFrameMatch ? {
        frameContractId: EDITORIAL_EVENT_FRAME_CONTRACT.stableId,
        frameContractVersion: EDITORIAL_EVENT_FRAME_CONTRACT.version,
        matchedTextHash: eventFrameMatch.textHash
      } : {})
    },
    confidenceLabel: { kind: "evidence_mode", mode: clean(issue && issue.evidence && issue.evidence.mode || issue && issue.metrics && issue.metrics.evidenceMode) }
  };
}

function normalizedReader(copy) {
  return Object.fromEntries(READER_COPY_FIELDS.map((field) => [field, clean(copy && copy[field])]));
}

export function buildReaderLineage(issue, copy = readerIssueCopy(issue)) {
  const reader = normalizedReader(copy);
  const payload = {
    contractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
    contractVersion: EDITORIAL_READER_COPY_CONTRACT.version,
    fingerprintVersion: EDITORIAL_READER_COPY_CONTRACT.fingerprintVersion,
    canonical: {
      evidenceHash: issue && issue.evidenceHash || null,
      contentHash: issue && issue.claimLineage && issue.claimLineage.contentHash || null
    },
    basis: readerBasis(issue),
    reader
  };
  return { ...payload, contentHash: sha256(JSON.stringify(payload)) };
}

export function readerIssueCopy(issue) {
  const headline = readerHeadline(issue);
  return {
    headline: headline.length > MAX_READER_LENGTH.headline
      ? `${headline.slice(0, MAX_READER_LENGTH.headline - 1).trim()}…`
      : headline,
    summary: readerSummary(issue),
    whyImportant: readerWhyImportant(issue),
    whyNow: readerWhyNow(issue),
    change: readerChange(issue),
    watchNext: readerWatchNext(issue),
    confidenceLabel: readerConfidenceLabel(issue)
  };
}

const MIN_READER_LENGTH = Object.freeze({
  headline: 4,
  summary: 12,
  whyImportant: 16,
  whyNow: 10,
  change: 10,
  watchNext: 0,
  confidenceLabel: 2
});
const MAX_READER_LENGTH = Object.freeze({
  headline: 90,
  summary: 240,
  whyImportant: 240,
  whyNow: 180,
  change: 220,
  watchNext: 220,
  confidenceLabel: 40
});

function readerAnchorTokens(issue, copy) {
  const base = clean(issue && issue.subject || copy && copy.headline || issue && issue.headline);
  return unique(base
    .replace(/[^가-힣a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2))
    .sort((a, b) => b.length - a.length);
}

function includesAnchor(value, tokens) {
  const normalized = clean(value).toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

export function assessReaderIssueCopy(issue, copy = readerIssueCopy(issue)) {
  const reader = normalizedReader(copy);
  const expected = normalizedReader(readerIssueCopy(issue));
  const fieldBindings = Object.fromEntries(READER_COPY_FIELDS.map((field) => [field, reader[field] === expected[field]]));
  const canonicalLineage = verifyEditorialLineage(issue);
  const changeEvidence = assessChangeEvidence(issue);
  const readerLineage = buildReaderLineage(issue, reader);
  const anchors = readerAnchorTokens(issue, reader);
  const eventFrame = editorialEventFrame(issue);
  const joined = READER_COPY_FIELDS.map((field) => reader[field]).join(" ");
  const sourceAnchors = sourceNames(issue);
  const whyNowGrounded = includesAnchor(reader.whyNow, anchors) ||
    sourceAnchors.some((name) => reader.whyNow.includes(name)) ||
    /(?:추천|댓글)\s*[\d,.]+건|\d+개\s*출처/.test(reader.whyNow);
  const englishWords = (reader.headline.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const checks = {
    requiredFieldsPresent: READER_COPY_REQUIRED_FIELDS.every((field) => reader[field].length >= MIN_READER_LENGTH[field]),
    readableLengths: READER_COPY_FIELDS.every((field) => reader[field].length <= MAX_READER_LENGTH[field]),
    changeEvidencePresent: clean(issue && issue.changedSincePrevious).length > 0,
    canonicalLineageValid: canonicalLineage.pass,
    whyImportantGrounded: canonicalLineage.pass && readerBasis(issue).whyImportant.kind !== "category_policy",
    changeEvidenceGrounded: changeEvidence.pass,
    deterministicProjectionMatch: Object.values(fieldBindings).every(Boolean),
    koreanAudienceReadable: /[가-힣]/.test(reader.headline) || englishWords <= 3,
    internalLanguageAbsent: !INTERNAL_READER_JARGON.test(joined),
    summaryEventSpecific: includesAnchor(reader.summary, anchors),
    whyNowGrounded,
    watchNextConcrete: !reader.watchNext ||
      (eventFrame && reader.watchNext === clean(eventFrame.watchNext)) ||
      includesAnchor(reader.watchNext, anchors) ||
      sourceAnchors.some((name) => reader.watchNext.includes(name)) ||
      /(?:공식 발표|후속 수치|국제유가|증시|반응)/.test(reader.watchNext)
  };
  const failures = [
    ...Object.entries(checks).filter(([, pass]) => !pass).map(([id]) => id),
    ...Object.entries(fieldBindings).filter(([, pass]) => !pass).map(([field]) => `readerFieldMismatch:${field}`)
  ];
  return {
    state: failures.length ? "reader_copy_hold" : "reader_copy_pass",
    pass: failures.length === 0,
    checks,
    failures,
    anchorCount: anchors.length,
    fieldBindings,
    readerFingerprint: readerLineage.contentHash,
    expectedReaderFingerprint: buildReaderLineage(issue, expected).contentHash,
    canonicalLineageState: canonicalLineage.state,
    changeEvidenceState: changeEvidence.pass ? "change_evidence_pass" : "change_evidence_hold"
  };
}

export function assessReaderCopyDiversity(copies) {
  const rows = Array.isArray(copies) ? copies : [];
  const fields = ["whyImportant", "whyNow", "watchNext"];
  const allowedExactRepeat = rows.length === 1 ? 1 : Math.max(2, Math.ceil(rows.length * 0.15));
  const fieldStats = Object.fromEntries(fields.map((field) => {
    const counts = new Map();
    for (const row of rows) {
      const value = clean(row && row[field]).toLowerCase();
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    const maxExactRepeat = Math.max(0, ...counts.values());
    return [field, {
      distinctCount: counts.size,
      maxExactRepeat,
      maxExactRepeatShare: rows.length ? Number((maxExactRepeat / rows.length).toFixed(3)) : 0,
      allowedExactRepeat,
      pass: maxExactRepeat <= allowedExactRepeat
    }];
  }));
  const pass = rows.length > 0 && Object.values(fieldStats).every((row) => row.pass);
  return {
    state: pass ? "reader_copy_diversity_pass" : "reader_copy_diversity_hold",
    pass,
    issueCount: rows.length,
    fields: fieldStats
  };
}

export function projectEditorialReaderCopy(edition) {
  const issues = Array.isArray(edition && edition.issues) ? edition.issues : [];
  return {
    ...edition,
    issues: issues.map((issue) => {
      const reader = readerIssueCopy(issue);
      return { ...issue, reader, readerLineage: buildReaderLineage(issue, reader) };
    }),
    readerPresentation: {
      stableId: "NOWHOT-EDITORIAL-READER-COPY-PROJECTION-001",
      contractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
      state: "reader_copy_projection_pass",
      responseOnly: true,
      issueCount: issues.length,
      canonicalContentMutated: false,
      hiddenWhyForYou: true,
      fingerprintVersion: EDITORIAL_READER_COPY_CONTRACT.fingerprintVersion,
      llmCalls: 0
    }
  };
}
