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
  "논란", "화제", "네티즌", "누리꾼", "프로"
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
