// 사건 계층(event) — 블루프린트 v4 "사건 생명주기 계약"의 P1-B 구현.
//
// 기사(article)와 사건(event)을 분리한다. 근접 기사는 삭제하지 않고 사건의
// 근거로 병합한다. 사건 ID는 판(아침→런치→이브닝) 사이에서 안정적으로
// 유지되고, 병합·별칭은 append-only 이력으로 남는다.
//
// 순수 함수만 있다 — 네트워크·저장소·시계 접근 없음. 같은 입력이면 판 간·
// 재시작 간 항상 같은 사건 ID가 나온다(결정성).
//
// ── 병합 판정 2단 (v4 P1 설계안)
// 1단 강한 결합(자동):
//   - canonicalUrl 완전일치(둘 다 non-null일 때만 — 구글뉴스 신식 리다이렉트는
//     P1-A 실측대로 null이라 이 축은 직접 RSS 소스 간에만 작동한다)
//   - 기존 eventKey(정규화 제목) 완전일치 — dedupe.js 재사용, 재발명 금지
// 2단 내용어 결합(점수):
//   - 고유명사성 토큰(titleConcepts에서 일반어를 추가로 걷은 것) 겹침 ≥ 2
//   - 발행 24시간 창 필수
//   - 한/영 결합은 영문 표기 고유명사·숫자 축으로만
//
// ── 오탐 방지 가드 (병합 금지 — 전부 테스트로 고정, 오병합은 미병합보다
//    나쁜 실패다 · v4 성공지표)
//   - 핵심 숫자 충돌(양쪽 다 숫자가 있는데 하나도 안 겹침) → 병합 보류
//   - community 유머글 vs 뉴스 기사 → 내용어가 겹쳐도 병합 금지
//   - 커뮤니티 글끼리는 내용어 결합을 하지 않는다(강한 결합만) — 같은 화제의
//     서로 다른 반응글이 한 건으로 사라지는 사고(뽐뿌 18건→2건 계열)를 막는다
//   - 고유명사 겹침 1개 이하 → 병합 금지
//   - 겹침이 숫자뿐 → 병합 금지(같은 숫자 다른 주제)
//   - 미결정 → 미병합. 별도 재평가 큐는 없다 — 다음 판 생성 시 자연 재평가.
//
// 커뮤니티 반응은 v4 정정 3대로 별도 축이다: 같은 사건을 다룬 커뮤 글은
// news event에 evidenceRole "community_reaction"으로 연결하되 독립 언론
// 계수에 합산하지 않는다.
import { createHash } from "node:crypto";
import { eventKey, normalizeForDedupe, titleConcepts } from "./dedupe.js";
import { canonicalizeUrl } from "./canonical-url.js";
import { operationalSourceIdentity } from "./editorial-source-identity.js";

const sha = (value) => createHash("sha256").update(String(value || "")).digest("hex");

// 판정 최종값 — 고정 표본(test/event-cluster-samples.test.js)으로 증명된
// 값만 쓴다. 표본 밖에서 자의로 넓히지 않는다(David).
export const EVENT_MERGE_RULES = Object.freeze({
  stableId: "NOWHOT-EVENT-CLUSTER-CONTRACT-001",
  version: 1,
  // 한/한 결합 임계 3: 처음 설계값은 2였으나, 오병합 유도 픽스처
  // ("성장률 전망 수정" vs "해수면 상승 전망 수정" — 일반 명사 2개 겹침)가
  // 병합돼 임계를 올렸다(오병합이면 임계를 올린다 — v4 절대 조건).
  // 한글은 형태소·사전 없이 고유명사와 일반 명사를 구조적으로 구별할 수
  // 없어서 겹침 하한으로만 방어한다.
  minSharedEntityTokensSameScript: 3,
  // 한/영 결합은 영문 표기 고유명사·숫자 축으로만 계산되고(deepseek·v4처럼
  // 식별력이 강한 토큰만 남는다) 고정 표본 1로 증명된 2를 쓴다.
  minSharedEntityTokensCrossLanguage: 2,
  publishWindowHours: 24,         // 내용어 결합의 발행 창
  misMergeIsWorse: "오병합은 미병합보다 나쁜 실패로 계수한다(v4 성공지표)"
});

// titleConcepts가 이미 걷는 일반어(GENERIC_NEWS_WORDS)에 더해, 사건을
// 구별하지 못하는 직함·상투어를 사건 토큰에서 뺀다. 여기 넣으면 병합이
// 줄어드는 방향(보수)이다 — 넓히는 방향이 아니라서 오병합 위험이 없다.
const EVENT_GENERIC_TOKENS = new Set([
  "대통령", "정부", "국회", "의원", "장관", "총리", "여야", "당국",
  "발표", "발언", "출시", "정식", "공식", "확정", "예고", "전망",
  "논란", "화제", "네티즌", "누리꾼", "프로",
  // ── 영문 일반어 (G1, 2026-08-14 신선·저장 풀 전수 실측 오병합 6건 근거)
  // 한글 일반어만 걷고 영문 일반어를 안 걷어서, 동일문자 임계 3이 무관 기사를
  // 병합했다. dedupe.js ENGLISH_STOP_WORDS는 digest 소비 경로(titleConcepts)라
  // 건드리지 않고, 사건 계층 전용인 이 사전 한 곳에만 더한다(보수 방향 —
  // 병합이 줄기만 하고 늘지 않는다). 각 어휘의 근거 사건 ID를 병기한다.
  //
  // 보도 상투어 announce/say 활용형 — EV-83c3f0dcdddf6157(무관 앨범 발표
  // 6건 병합, "announces/new/album/hear"), EV-9fcaf3253767a5a0("fire/ai/says").
  "announce", "announces", "announced", "say", "says", "said",
  // 기능어 — "new": EV-83c3f0dcdddf6157·EV-8626d45bf101265f("hiring/new/york"),
  // "can"(조동사): EV-606ccd6127cef311("scientists/brain/can").
  "new", "can",
  // 매체 상투어 — "hear"(스테레오검 "Hear ..." 정형구): EV-83c3f0dcdddf6157,
  // "hiring"(구인 공고 정형구): EV-8626d45bf101265f.
  "hear", "hiring",
  // 수량 일반어 — "million/year": EV-a26325700b4c7ab5("million/year/fossil",
  // 무관 화석 기사 2건). years는 같은 낱말의 복수형.
  "million", "year", "years",
  // 지명 상투어 — "london": EV-148276d6fe6422c7(브랜드 접미어 "Jo Malone
  // London"이 3토큰을 채워 무관 기사 병합). 전/후 전수 대조에서 정당 병합
  // 손실 0 확인 후 유지.
  "london"
]);

// 한/영 동일 표기 별칭 — 고정 표본으로 증명된 항목만 넣는다(표본 1: 딥시크).
// 일반 음차 변환은 만들지 않는다 — 규칙 발명은 오병합 지름길이다.
const CROSS_LANGUAGE_ENTITY_ALIASES = new Map([
  ["딥시크", "deepseek"]
]);

const hasKoreanScript = (text) => /[가-힣]/.test(String(text || ""));
const isLatinOrNumberToken = (token) => token.startsWith("num:") || /^[a-z0-9]/.test(token) && !/[가-힣]/.test(token);

// 사건 토큰 — dedupe.js titleConcepts(조사·불용어·일반어 처리) 재사용 후
// 직함·상투어를 추가로 걷고 한/영 별칭을 접는다.
export function eventEntityTokens(title) {
  const out = [];
  for (const concept of titleConcepts(title)) {
    if (EVENT_GENERIC_TOKENS.has(concept)) continue;
    out.push(CROSS_LANGUAGE_ENTITY_ALIASES.get(concept) || concept);
  }
  return [...new Set(out)];
}

// 숫자 토큰 판정 — dedupe.js는 3자리 이상만 num: 접두를 붙이므로 "17" 같은
// 1~2자리 순수 숫자 토큰도 여기서는 숫자로 취급한다. 안 그러면 2자리 숫자
// 2개만 겹치는 무관한 한/영 제목이 숫자 가드를 전부 우회해 병합될 수 있다
// (diff 검수 P2, DEVCHG-081).
// "17명"·"30만원"·"3분기"처럼 숫자+한글 단위 토큰이 한국어 수치의 기본형이라
// "숫자로 시작"을 숫자 판정으로 쓴다(순수 숫자만 보면 수치 충돌 가드가
// 통째로 빠진다 — 실측: "부상 17명" vs "부상 90명"이 병합됐다).
const isNumericToken = (t) => t.startsWith("num:") || /^\d/.test(t);
const numberTokens = (title) => eventEntityTokens(title).filter(isNumericToken);

// dedupe.js sameTitleConcept과 같은 셈법: 완전일치 또는 조사·합성어 수준의
// 접두/접미 포함(한글 2자·영문 3자 이상).
function tokenMatch(a, b) {
  if (a === b) return true;
  const korean = /^[가-힣]+$/.test(a) && /^[가-힣]+$/.test(b);
  if (Math.min(a.length, b.length) < (korean ? 2 : 3)) return false;
  return a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a);
}

// 두 제목이 공유하는 사건 토큰. 언어가 다르면(한↔영) 영문 표기·숫자 축만 쓴다.
export function sharedEventTokens(titleA, titleB) {
  const crossLanguage = hasKoreanScript(titleA) !== hasKoreanScript(titleB);
  const keep = (tokens) => crossLanguage ? tokens.filter(isLatinOrNumberToken) : tokens;
  const left = keep(eventEntityTokens(titleA));
  const right = keep(eventEntityTokens(titleB));
  const used = new Set();
  const shared = [];
  for (const token of left) {
    const hit = right.findIndex((candidate, index) => !used.has(index) && tokenMatch(token, candidate));
    if (hit < 0) continue;
    used.add(hit);
    shared.push(token.length <= right[hit].length ? token : right[hit]);
  }
  return shared;
}

const isCommunity = (article) => article && article.kind === "community";
const isHumorCommunity = (article) => isCommunity(article) && (article.category || "") === "humor";
const parseTime = (value) => {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
};

// 병합 판정 — 단일 진실. 반환: { merge, mode, reason }.
export function decideEventMerge(a, b) {
  // 1단 — 강한 결합. canonicalUrl 완전일치는 같은 문서 그 자체이므로
  // 카테고리 팩 가드보다 먼저 본다(중계·재유통이 여기서 잡힌다 — 표본 5).
  const ua = canonicalizeUrl(a && a.url);
  const ub = canonicalizeUrl(b && b.url);
  if (ua && ub && ua === ub) return { merge: true, mode: "strong", reason: "canonical_url_exact" };

  // 카테고리 팩 비호환: community 유머글과 뉴스는 제목이 어떻게 겹쳐도
  // 병합하지 않는다(가드 C).
  const humorVsNews = (isHumorCommunity(a) && !isCommunity(b)) || (isHumorCommunity(b) && !isCommunity(a));
  if (humorVsNews) return { merge: false, reason: "guard_category_pack_humor_vs_news" };

  const ka = eventKey(a && a.title);
  const kb = eventKey(b && b.title);
  if (ka && ka === kb) return { merge: true, mode: "strong", reason: "event_key_exact" };

  // 2단 — 내용어 결합. 커뮤니티 글끼리는 하지 않는다(강한 결합만).
  if (isCommunity(a) && isCommunity(b)) return { merge: false, reason: "guard_community_pair_strong_only" };

  const ta = parseTime(a && a.publishedAt);
  const tb = parseTime(b && b.publishedAt);
  if (ta === null || tb === null || Math.abs(ta - tb) > EVENT_MERGE_RULES.publishWindowHours * 3600 * 1000) {
    return { merge: false, reason: "guard_publish_window_24h" };
  }

  const crossLanguage = hasKoreanScript(a && a.title) !== hasKoreanScript(b && b.title);
  const minShared = crossLanguage
    ? EVENT_MERGE_RULES.minSharedEntityTokensCrossLanguage
    : EVENT_MERGE_RULES.minSharedEntityTokensSameScript;
  const shared = sharedEventTokens(a && a.title, b && b.title);
  if (shared.length < minShared) {
    return { merge: false, reason: "guard_entity_overlap_min" };
  }
  if (shared.every(isNumericToken)) {
    return { merge: false, reason: "guard_numbers_only_overlap" };
  }
  const normNum = (t) => t.replace(/^num:/, "");
  const numsA = numberTokens(a && a.title).map(normNum);
  const numsB = numberTokens(b && b.title).map(normNum);
  if (numsA.length && numsB.length && !numsA.some((n) => numsB.includes(n))) {
    return { merge: false, reason: "guard_number_conflict" };
  }
  return { merge: true, mode: "content", crossLanguage, reason: `entity_overlap:${shared.join("+")}` };
}

// ---------------------------------------------------------------------------
// 사건 조립
// ---------------------------------------------------------------------------

const articleOrder = (a, b) => {
  const ta = parseTime(a.publishedAt);
  const tb = parseTime(b.publishedAt);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return String(a.id || a.title || "").localeCompare(String(b.id || b.title || ""));
};

const seedOf = (article) => eventKey(article && article.title)
  || normalizeForDedupe(article && article.title)
  || canonicalizeUrl(article && article.url)
  || String(article && (article.id || article.title) || "unknown");

// 사건 ID 안정 규칙: 최초 구성 기사 중 가장 이른 발행 기사의 정규화 키에서
// 파생(결정적). 판 간·재시작 간 같은 입력이면 같은 ID.
export const eventIdFor = (anchorArticle) => `EV-${sha(seedOf(anchorArticle)).slice(0, 16)}`;

function finalizeEvent(bucket) {
  const articles = [...bucket.articles].sort(articleOrder);
  const anchor = articles[0];
  const eventId = eventIdFor(anchor);
  const hasReporting = articles.some((article) => !isCommunity(article));
  const roleOf = (article) => !isCommunity(article) ? "reporting"
    : hasReporting ? "community_reaction" : "community_post";

  // 커뮤 반응은 별도 축(v4 정정 3) — 사실 지문·구성원 계수에서 뺀다.
  const members = articles.filter((article) => roleOf(article) !== "community_reaction");
  const reactions = articles.filter((article) => roleOf(article) === "community_reaction");

  const anchorKey = normalizeForDedupe(anchor && anchor.title);
  const aliases = [];
  const history = [];
  let firstSeenAt = anchor && anchor.publishedAt || null;
  let lastMaterialChangeAt = anchor && anchor.publishedAt || null;
  const factTokens = new Set(members.length && members[0] === anchor ? eventEntityTokens(anchor.title) : []);
  for (const article of articles.slice(1)) {
    const via = bucket.decisionByArticle.get(article) || { mode: "content", reason: "composed" };
    history.push({
      at: article.publishedAt || null,
      action: "merge",
      from: article.id || null,
      to: eventId,
      reason: via.reason,
      mode: via.mode || "content",
      evidenceRole: roleOf(article)
    });
    const key = normalizeForDedupe(article.title);
    if (key && key !== anchorKey && !aliases.includes(key)) {
      aliases.push(key);
      history.push({ at: article.publishedAt || null, action: "alias", from: key, to: eventId, reason: "merged_title_key" });
    }
    if (roleOf(article) !== "community_reaction") {
      let changed = false;
      for (const token of eventEntityTokens(article.title)) {
        if (!factTokens.has(token)) { factTokens.add(token); changed = true; }
      }
      if (changed) lastMaterialChangeAt = article.publishedAt || lastMaterialChangeAt;
    }
  }

  const groupsOf = (rows) => [...new Set(rows.map((row) => operationalSourceIdentity(row).ownershipGroup))];
  const reportingRows = members.filter((article) => !isCommunity(article));
  const communityRows = articles.filter(isCommunity);
  // 실질 변화 감지용 지문: 구성원 제목의 고유명사·숫자 집합을 정렬해 해시.
  const factsFingerprint = `EVF-${sha(JSON.stringify([...factTokens].sort())).slice(0, 16)}`;

  return {
    eventId,
    memberArticleIds: members.map((article) => article.id || null),
    reactionArticleIds: reactions.map((article) => article.id || null),
    representativeId: (reportingRows[0] || anchor) && ((reportingRows[0] || anchor).id || null),
    aliases,
    mergeHistory: history,
    firstSeenAt,
    lastMaterialChangeAt,
    factsFingerprint,
    counts: {
      articles: articles.length,
      // 교차 확인 계수 = operatorGroup 고유 수(중계는 1회). 커뮤는 별도 축.
      independentReportingGroups: groupsOf(reportingRows).length,
      communityGroups: groupsOf(communityRows).length,
      communityReactions: reactions.length
    },
    sourceEvidence: articles.map((article) => ({
      articleId: article.id || null,
      title: article.title || "",
      sourceId: article.source || null,
      sourceLabel: article.sourceLabel || article.source || null,
      operatorGroup: operationalSourceIdentity(article).ownershipGroup,
      canonicalUrl: canonicalizeUrl(article.url),
      publishedAt: article.publishedAt || null,
      evidenceRole: roleOf(article)
    }))
  };
}

// 기사 배열 → 사건 배열. 결정적: 발행시각·id 순으로 정렬 후 그리디 결합.
export function buildEventClusters(articles) {
  const sorted = [...(articles || [])].filter(Boolean).sort(articleOrder);
  const buckets = [];
  for (const article of sorted) {
    let joined = null;
    let decision = null;
    for (const bucket of buckets) {
      for (const member of bucket.articles) {
        const d = decideEventMerge(member, article);
        if (d.merge) { joined = bucket; decision = d; break; }
      }
      if (joined) break;
    }
    if (!joined) {
      buckets.push({ articles: [article], decisionByArticle: new Map() });
      continue;
    }
    joined.articles.push(article);
    joined.decisionByArticle.set(article, decision);
  }
  return buckets.map(finalizeEvent);
}

// 이미 같은 사건으로 확정된 구성원 집합 → 사건 레코드 하나 (digest 투영용).
// 여기서는 소속을 다시 판정하지 않는다 — 판정은 위 2단이 단일 진실이고,
// digest의 근접 병합 휴리스틱이 추가로 확정한 구성도 근거 보존 대상이다.
export function composeEventFromMembers(members) {
  const rows = [...(members || [])].filter(Boolean).sort(articleOrder);
  const decisionByArticle = new Map();
  for (const article of rows.slice(1)) {
    let via = null;
    for (const earlier of rows) {
      if (earlier === article) break;
      const d = decideEventMerge(earlier, article);
      if (d.merge) { via = d; break; }
    }
    decisionByArticle.set(article, via || { mode: "editorial", reason: "editorial_near_duplicate_merge" });
  }
  return finalizeEvent({ articles: rows, decisionByArticle });
}

// 실질 변화(새 사실·수치)가 있었는가 — 재등장 허용 판단 재료.
export const eventMaterialChange = (previousEvent, nextEvent) =>
  Boolean(previousEvent && nextEvent
    && previousEvent.factsFingerprint !== nextEvent.factsFingerprint);

// ---------------------------------------------------------------------------
// 영구 사건 계보(lineage) — R1 (블루프린트 "2026-08-14 P3-A 판정" 결함 4)
// ---------------------------------------------------------------------------
//
// 문제: eventId는 "가장 이른 구성 기사의 정규화 키"에서 파생된다. 판 N에서
// 선택된 사건에 판 N+1에서 더 이른 기사가 지연 합류하면 앵커가 바뀌어
// eventId가 달라지고, eventId 기준 재등장 게이트가 같은 사건을 신규로
// 오판한다(호르무즈형 반례). eventId 파생 규칙 자체는 digest가 소비 중이라
// 바꾸지 않는다 — 대신 판 사이를 잇는 **영구 계보(lineage) 계층**을 위에 얹는다.
//
// 설계 (기존 export 무변경 — 아래는 전부 추가 export):
//  - lineageId: 사건이 처음 관측된 판의 eventId에서 파생. 이후 eventId가
//    몇 번 변천해도 lineageId는 불변(영구 지문).
//  - 계보 레코드는 사건의 전 구성원 기사 ID·정규화 제목 키 집합·
//    factsFingerprint 이력을 append-only로 축적한다. eventId 변천은
//    aliasChain(aliasOf 체인)으로 append-only 기록한다.
//  - 승계 매칭은 강한 근거 순서: eventId 일치 > 구성원 기사 ID 겹침 >
//    정규화 제목 키 겹침 > factsFingerprint 완전일치.
//  - **오승계 방지(오병합>미병합 원칙의 계보 적용)**: 최상 근거가 서로 다른
//    계보 2개에서 동률이면 승계하지 않고 새 계보를 연다(미승계가 오승계보다
//    낫다). 판정은 결정적이다.
export const EVENT_LINEAGE_RULES = Object.freeze({
  stableId: "NOWHOT-EVENT-LINEAGE-CONTRACT-001",
  version: 1,
  matchBases: Object.freeze([
    "lineage_event_id",          // rank 3 — 같은 eventId를 이미 계보가 안다
    "lineage_member_overlap",    // rank 2 — 구성원 기사 ID 교집합 ≥ 1
    "lineage_title_key_overlap", // rank 1 — 정규화 제목 키 교집합 ≥ 1
    "lineage_facts_fingerprint"  // rank 0 — 사실 지문 완전일치
  ]),
  ambiguity: "동률 후보 2개 이상이면 미승계(새 계보) — 오승계는 미승계보다 나쁜 실패",
  appendOnly: "eventIds·aliasChain·memberArticleIds·titleKeys·fingerprints는 append-only"
});

// 사건의 정규화 제목 키 집합 — 앵커·별칭 포함(구성원 보도 기사만, 커뮤 반응 제외).
const lineageTitleKeysOf = (event) => {
  const keys = new Set();
  for (const row of (event && event.sourceEvidence) || []) {
    if (row.evidenceRole === "community_reaction") continue;
    const key = normalizeForDedupe(row.title);
    if (key) keys.add(key);
  }
  for (const alias of (event && event.aliases) || []) keys.add(alias);
  return [...keys].sort();
};

const uniqSorted = (values) => [...new Set(values.filter(Boolean))].sort();

// 새 계보 레코드 — 사건이 계보 없이 처음 관측될 때.
export function eventLineageRecord(event) {
  const eventId = event && event.eventId || "EV-unknown";
  return {
    lineageId: `LN-${String(eventId).replace(/^EV-/, "")}`,
    currentEventId: eventId,
    eventIds: [eventId],
    // eventId 변천의 append-only 기록. aliasOf: 직전 currentEventId.
    aliasChain: [{ eventId, aliasOf: null, basis: "lineage_origin" }],
    memberArticleIds: uniqSorted((event && event.memberArticleIds) || []),
    titleKeys: lineageTitleKeysOf(event),
    factsFingerprint: event && event.factsFingerprint || null,
    fingerprints: event && event.factsFingerprint ? [event.factsFingerprint] : [],
    // 직전 "서빙(선택)" 시점의 지문 — 재등장 게이트는 이 값만 본다.
    // 관찰만 되고 서빙된 적 없는 사건(미선택·게이트 탈락)은 null 유지라
    // 다음 판에서 차단되지 않는다(검수 P1: 전 사건 지문을 게이트에 쓰면
    // 직전 판에 서빙된 적 없는 사건까지 전부 차단 — 450/450 실측).
    lastServedFactsFingerprint: null
  };
}

// 서빙(선택) 표시 — 이번 판에 실제 선택된 사건의 레코드에만 현재 지문을
// 찍는다. 비변형(새 배열·새 객체 반환). 블루프린트 공통 원칙 5의 "직전 판
// 동일 사건"에서 판 = 서빙판이라는 계약의 구현부다.
export function markLineageServed(records, servedEventIds) {
  const served = servedEventIds instanceof Set ? servedEventIds : new Set(servedEventIds || []);
  return (records || []).map((record) => {
    if (!record || !served.has(record.currentEventId)) return record;
    return { ...record, lastServedFactsFingerprint: record.factsFingerprint || null };
  });
}

// 이전 판 계보 레코드 목록 대 사건 하나의 매칭 후보 산출(순수·결정적).
// 반환: { record, basis, rank, score } 배열 — rank·score 내림차순 정렬.
export function lineageMatchCandidates(previousRecords, event) {
  const members = new Set((event && event.memberArticleIds) || []);
  const titleKeys = new Set(lineageTitleKeysOf(event));
  const candidates = [];
  for (const record of previousRecords || []) {
    if (!record) continue;
    const memberOverlap = (record.memberArticleIds || [])
      .filter((id) => members.has(id)).length;
    const titleOverlap = (record.titleKeys || [])
      .filter((key) => titleKeys.has(key)).length;
    let basis = null; let rank = -1; let score = 0;
    if ((record.eventIds || []).includes(event && event.eventId)) {
      basis = "lineage_event_id"; rank = 3; score = 1;
    } else if (memberOverlap >= 1) {
      basis = "lineage_member_overlap"; rank = 2; score = memberOverlap;
    } else if (titleOverlap >= 1) {
      basis = "lineage_title_key_overlap"; rank = 1; score = titleOverlap;
    } else if (record.factsFingerprint && event
      && record.factsFingerprint === event.factsFingerprint) {
      basis = "lineage_facts_fingerprint"; rank = 0; score = 1;
    }
    if (basis) candidates.push({ record, basis, rank, score });
  }
  return candidates.sort((a, b) => b.rank - a.rank || b.score - a.score
    || String(a.record.lineageId).localeCompare(String(b.record.lineageId)));
}

// 관측 시각 필드(additive) — S2-2 프루닝 재료. nowMs가 없으면(구 호출)
// 이전 값을 보존하고, 둘 다 없으면 필드를 만들지 않는다(기존 산출물과
// 바이트 동일 — append-only 원칙).
const observedAtField = (nowMs, previous) => {
  if (Number.isFinite(nowMs)) return { lastObservedAt: nowMs };
  if (previous && Number.isFinite(previous.lastObservedAt)) {
    return { lastObservedAt: previous.lastObservedAt };
  }
  return {};
};

// 승계 후 레코드 — append-only 확장(이전 레코드는 절대 변형하지 않는다).
function extendLineageRecord(previous, event, basis, nowMs = null) {
  const eventId = event.eventId;
  const changedId = previous.currentEventId !== eventId;
  return {
    lineageId: previous.lineageId,
    currentEventId: eventId,
    eventIds: uniqSorted([...previous.eventIds, eventId]),
    aliasChain: changedId
      ? [...previous.aliasChain, { eventId, aliasOf: previous.currentEventId, basis }]
      : [...previous.aliasChain],
    memberArticleIds: uniqSorted([...previous.memberArticleIds, ...(event.memberArticleIds || [])]),
    titleKeys: uniqSorted([...previous.titleKeys, ...lineageTitleKeysOf(event)]),
    factsFingerprint: event.factsFingerprint || previous.factsFingerprint,
    fingerprints: event.factsFingerprint && !previous.fingerprints.includes(event.factsFingerprint)
      ? [...previous.fingerprints, event.factsFingerprint]
      : [...previous.fingerprints],
    // 서빙 지문은 승계 시 그대로 이어진다 — markLineageServed만 갱신한다.
    lastServedFactsFingerprint: previous.lastServedFactsFingerprint ?? null,
    // 이번 판에 실제 관측(승계 확장)됐으므로 관측 시각을 갱신한다.
    ...observedAtField(nowMs, previous)
  };
}

// 판 N 계보 레코드들 + 판 N+1 사건들 → 승계 배정과 다음 판 계보 레코드.
//
// 반환:
//   assignments: Map(eventId → { lineageId, inherited, basis,
//     previousFingerprint,  // 승계됐다면 이전 판 마지막 지문(재등장 게이트 재료)
//     record })             // 이 사건의 다음 판 계보 레코드
//   records: 다음 판에 넘길 전체 계보 레코드(승계 확장분 + 신규 + 이번 판에
//     안 나타난 이전 계보 그대로 — 사건이 한 판 쉬었다 재등장해도 이어진다)
//
// 결정성: 후보를 (rank, score, eventId, lineageId)로 전역 정렬해 그리디 배정.
// 한 계보는 한 사건에만 승계된다(가장 강한 근거의 사건이 가져간다).
// 오승계 방지: 어떤 사건의 최상 후보가 서로 다른 계보 2개에서 동률이면 그
// 사건은 승계 포기(새 계보) — 대조 픽스처로 고정한다.
//
// nowMs(선택, S2-2 additive): 이 판의 시각. 주면 이번 판에 관측된(승계·신규)
// 레코드에 lastObservedAt을 찍는다 — 프루닝(pruneEventLineages)의 재료.
// 시계 직접 접근 없음(순수·결정적 유지). 안 주면 기존 산출물과 동일.
export function carryEventLineages(previousRecords, events, { nowMs = null } = {}) {
  const prev = (previousRecords || []).filter(Boolean);
  const sortedEvents = [...(events || [])].filter(Boolean)
    .sort((a, b) => String(a.eventId).localeCompare(String(b.eventId)));

  // 사건별 후보 목록(정렬 완료) 준비.
  const candidatesByEvent = new Map(sortedEvents.map((event) =>
    [event.eventId, lineageMatchCandidates(prev, event)]));

  // 전역 그리디: 강한 근거부터 배정. 계보·사건 모두 1회만 소비.
  const flat = [];
  for (const event of sortedEvents) {
    for (const candidate of candidatesByEvent.get(event.eventId)) {
      flat.push({ event, ...candidate });
    }
  }
  flat.sort((a, b) => b.rank - a.rank || b.score - a.score
    || String(a.event.eventId).localeCompare(String(b.event.eventId))
    || String(a.record.lineageId).localeCompare(String(b.record.lineageId)));

  const usedLineages = new Set();
  const decidedEvents = new Map(); // eventId → { record: prevRecord, basis } | { declined }
  for (const row of flat) {
    if (decidedEvents.has(row.event.eventId)) continue;
    if (usedLineages.has(row.record.lineageId)) continue;
    // 동률 검사: 같은 사건에 같은 (rank, score)의 미소비 계보가 또 있으면 포기.
    const rivals = candidatesByEvent.get(row.event.eventId).filter((candidate) =>
      candidate.record.lineageId !== row.record.lineageId
      && !usedLineages.has(candidate.record.lineageId)
      && candidate.rank === row.rank && candidate.score === row.score);
    if (rivals.length) {
      decidedEvents.set(row.event.eventId, { declined: true, basis: "lineage_ambiguous_declined" });
      continue;
    }
    decidedEvents.set(row.event.eventId, { record: row.record, basis: row.basis });
    usedLineages.add(row.record.lineageId);
  }

  const assignments = new Map();
  const records = [];
  for (const event of sortedEvents) {
    const decided = decidedEvents.get(event.eventId);
    if (decided && decided.record) {
      const next = extendLineageRecord(decided.record, event, decided.basis, nowMs);
      assignments.set(event.eventId, {
        lineageId: next.lineageId,
        inherited: true,
        basis: decided.basis,
        previousFingerprint: decided.record.factsFingerprint || null,
        // 재등장 게이트 재료 — 직전 서빙 시점 지문(서빙된 적 없으면 null).
        previousServedFingerprint: decided.record.lastServedFactsFingerprint || null,
        record: next
      });
      records.push(next);
    } else {
      const fresh = { ...eventLineageRecord(event), ...observedAtField(nowMs, null) };
      assignments.set(event.eventId, {
        lineageId: fresh.lineageId,
        inherited: false,
        basis: decided && decided.basis || "lineage_new",
        previousFingerprint: null,
        previousServedFingerprint: null,
        record: fresh
      });
      records.push(fresh);
    }
  }
  // 이번 판에 안 나타난 이전 계보는 그대로 이월(한 판 쉬어도 유지).
  // 관측 시각 갱신 없음 — 이월은 관측이 아니다(안 그러면 미서빙 계보의 72h
  // 만료 시계가 판마다 리셋돼 프루닝이 영원히 작동하지 않는다).
  // 예외 하나: 관측 시각이 아예 없는 구 형식 레코드는 처음 만나는 판의
  // 시각으로 초기화한다(마이그레이션 — 이 시점부터 72h 시계가 돈다. 없으면
  // 구 레코드 8천여 건이 영구 보존돼 프루닝 도입 의미가 없다).
  for (const record of prev) {
    if (usedLineages.has(record.lineageId)) continue;
    records.push(Number.isFinite(nowMs) && !Number.isFinite(record.lastObservedAt)
      ? { ...record, lastObservedAt: nowMs }
      : record);
  }
  return { assignments, records };
}

// ---------------------------------------------------------------------------
// S2-2 — 계보 프루닝(옵션 B, David 승인 2026-08-17)
// ---------------------------------------------------------------------------
//
// 배경(S0 분석 확정): 재등장 차단 574건 전수 감사 과잉 0 — 프루닝은 정확성이
// 아니라 **위생**(레코드 무한 누적 방지) 사유다. 재등장 의미론("실질 변화까지
// 차단")은 현 구현 그대로다 — 이 함수는 게이트 판정에 관여하지 않는다.
//
// 규칙(옵션 B):
//  - 서빙 이력 있는 계보(lastServedFactsFingerprint 有) = 보존, 만료 없음.
//    재등장 게이트가 보는 것이 정확히 이 지문이라, 지우면 차단이 풀린다.
//  - 미서빙 계보 = 마지막 관측(lastObservedAt)에서 72시간 경과 시 제거.
//    미서빙 계보는 게이트 재료가 아니므로(previousServedFingerprint=null)
//    제거해도 차단·통과 판정이 바뀌지 않는다 — 위생 전용.
//  - lastObservedAt이 없는 레코드(구 형식)는 만료를 증명할 수 없어 보존.
//    carryEventLineages(nowMs)가 처음 만나는 판에 시각을 초기화하므로
//    한 판 뒤부터는 정상적으로 시계가 돈다.
// 순수·결정적: nowMs 인자 필수 — 시계 직접 접근 금지.
export const EVENT_LINEAGE_PRUNE_RULES = Object.freeze({
  stableId: "NOWHOT-EVENT-LINEAGE-PRUNE-CONTRACT-001",
  version: 1,
  policy: "옵션 B — 서빙 이력 계보 영구 보존, 미서빙 계보 72h 만료",
  unservedTtlHours: 72,
  boundary: "경과 시간 ≥ 72h면 제거(72h 미만은 보존)",
  servingSemantics: "재등장 의미론 무변경 — 프루닝은 위생 전용, 게이트 판정 불관여"
});

export function pruneEventLineages(records, { nowMs } = {}) {
  if (!Number.isFinite(nowMs)) {
    throw new Error("pruneEventLineages: nowMs 필요(숫자) — 시계 직접 접근 금지");
  }
  const ttlMs = EVENT_LINEAGE_PRUNE_RULES.unservedTtlHours * 3600000;
  return (records || []).filter((record) => {
    if (!record) return false;
    if (record.lastServedFactsFingerprint) return true;      // 서빙 이력 = 영구 보존
    if (!Number.isFinite(record.lastObservedAt)) return true; // 구 형식 — 만료 증명 불가
    return nowMs - record.lastObservedAt < ttlMs;             // 72h 경과 시 제거
  });
}
