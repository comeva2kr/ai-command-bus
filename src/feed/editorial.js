// Editorial notes: a short, one-line "왜 이게 여기 있는지" comment attached to
// each organic feed card.
//
// Two reasons this exists (docs/monetization.md has the full writeup):
//   1. Curation value — the note is a quick "이 피드, 보는 눈이 있다" signal
//      for the user, distinct from the algorithmic "추천 이유" (.why) chips.
//   2. AdSense eligibility — Google's ad-review rejects sites that just
//      republish other sites' content with no added value. A per-item
//      editorial rationale is exactly the "original commentary" that
//      satisfies that bar; see docs/monetization.md's new 편집POV section.
//
// HARD RULE: never fabricate or round up a number that isn't actually in the
// item's own data. Every digit this module prints must trace back to a real
// measured field (score, commentCount, sourceRank, publishedAt-derived age,
// or a multiplier genuinely computed from context stats) — inventing a
// number here is the same class of violation as this project's ban on fake
// social-proof counters on ad cards (see monetize.js's adMetaHtml). When the
// data is too thin to say anything honest, this returns "" — an empty note
// is strictly better than a plausible-sounding made-up one.

import { sourceLabel as lookupSourceLabel } from "./taxonomy.js";
import { loadRegistry } from "./registry.js";

// ---- tunable gates (heuristic, not measured signals themselves) -----------
// These only decide WHICH template fires; every number that ends up in the
// rendered text still comes straight from the item/context, never from here.
const SURGE_MAX_AGE_MIN = 24 * 60; // "급상승형" freshness window (24h)
const SURGE_SCORE_FLOOR = 300; // score/commentCount magnitude that reads as genuinely viral
const SURGE_COMMENT_FLOOR = 300;
const OUTLIER_MULTIPLE_MIN = 3; // "압도적 반응형" — item vs its source's own typical score
const OUTLIER_MIN_SAMPLE = 2; // need at least this many other same-source items to trust the average
const DEBATE_COMMENT_FLOOR = 30; // "댓글 폭발형"
const DEBATE_RATIO_MIN = 3; // commentCount must be at least this many times the score
const FRESH_MAX_AGE_MIN = 30; // "신선형" — just-published window
// "여러 매체 동시보도형"이 발동할 관련기사 수. 1~2건은 단신 묶임 수준이라
// "여러 곳"이라 부르기 어렵다.
const COVERAGE_MANY = 3;

// Comma-group a plain integer, or collapse into Korean "만" units above
// 10,000 — e.g. 1300 -> "1,300", 90000 -> "9만", 132000 -> "13.2만". Only
// ever applied to a real number already present on the item; this rounds
// for readability, it never invents digits.
function formatCount(n) {
  const v = Math.max(0, Math.round(n));
  if (v >= 10000) {
    const man = v / 10000;
    const rounded = Math.round(man * 10) / 10;
    const manStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${manStr}만`;
  }
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Age in minutes since publishedAt, or null if there's no usable date —
// callers must treat null as "can't say anything about freshness", never as
// 0 (that would fabricate a "just now").
function ageMinutes(publishedAt, nowMs) {
  if (publishedAt == null) return null;
  const t = typeof publishedAt === "number" ? publishedAt : Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 60000);
}

function formatAgeShort(mins) {
  if (mins < 1) return "방금"; // "0분 전"은 어색 — 1분 미만은 그냥 방금
  if (mins < 60) return `${Math.round(mins)}분`;
  return `${Math.round(mins / 60)}시간`;
}

// 한글 소스명 우선 — taxonomy.js는 일부 소스만 커버하므로 communities.json의
// label(긱뉴스·아웃스탠딩·딴지일보 등)을 함께 본다. 셋 다 없을 때만 원 id로
// 폴백(영문 id가 편집 코멘트에 그대로 노출되면 기계적으로 읽힘 — David 2026-07-27).
let _registryLabels = null;
function registryLabel(sourceId) {
  if (_registryLabels === null) {
    _registryLabels = new Map();
    try {
      for (const c of loadRegistry()) {
        // labelKo("해커뉴스") 우선, 없으면 label("Hacker News")
        if (c && c.id && (c.labelKo || c.label)) _registryLabels.set(c.id, c.labelKo || c.label);
      }
    } catch {
      /* 레지스트리를 못 읽어도 라벨만 못 붙일 뿐, 코멘트 생성은 계속된다 */
    }
  }
  return _registryLabels.get(sourceId) || null;
}
function labelFor(item) {
  // taxonomy.sourceLabel()은 모르는 소스에 id를 그대로 돌려주므로(빈 값이 아님)
  // 그 결과가 id와 같으면 "못 찾은 것"으로 보고 레지스트리를 본다 — 안 그러면
  // 편집 코멘트에 "hackernews", "inven_hot" 같은 원 id가 노출된다.
  const taxo = lookupSourceLabel(item.source);
  const taxoUsable = taxo && taxo !== item.source ? taxo : null;
  return item.sourceLabel || taxoUsable || registryLabel(item.source) || item.source || "이 소스";
}

// Build the one-line editorial note. `context` is optional, engine.js-supplied
// extra data (currently: `now` — ms clock; `sourceStats` — { mean, median,
// count } of `score` across this item's own source's current pool, for the
// outlier template). Missing context just disables the templates that need
// it; every other template still works off the item alone.
export function buildEditorialNote(item, context = {}) {
  if (!item) return "";
  // Affiliate/ad cards get their own separate reason/disclosure UI — never
  // an editorial note (defense-in-depth; in practice ad/slot items are built
  // by monetize.js and never routed through this function at all, see
  // engine.js's _decorate).
  if (item.kind === "affiliate" || item.kind === "ad") return "";

  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const score = Number.isFinite(item.score) ? item.score : 0;
  const commentCount = Number.isFinite(item.commentCount) ? item.commentCount : 0;
  const mins = ageMinutes(item.publishedAt, now);
  const label = labelFor(item);

  // 1. 급상승형 — fresh AND a genuinely large, real number.
  if (mins != null && mins <= SURGE_MAX_AGE_MIN && (score >= SURGE_SCORE_FLOOR || commentCount >= SURGE_COMMENT_FLOOR)) {
    const bits = [];
    if (score >= SURGE_SCORE_FLOOR) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount >= SURGE_COMMENT_FLOOR) bits.push(`댓글 ${formatCount(commentCount)}`);
    const timeText = mins <= 60 ? `${Math.round(mins)}분 만에` : `${formatAgeShort(mins)} 만에`;
    return `${label}에서 ${timeText} ${bits.join("·")}`;
  }

  // 2. 압도적 반응형 — this item's score vs the mean score of other items
  // from the same source right now (context.sourceStats, computed by
  // engine.js over the full collected pool). The stated multiple is always
  // `score / stats.mean`, rounded for display — never a hardcoded ratio.
  const stats = context.sourceStats;
  if (stats && Number.isFinite(stats.mean) && stats.mean > 0 && stats.count >= OUTLIER_MIN_SAMPLE && score > 0) {
    const multiple = score / stats.mean;
    if (multiple >= OUTLIER_MULTIPLE_MIN) {
      const rounded = Math.round(multiple * 10) / 10;
      const mStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${label}, 평소보다 반응 ${mStr}배 — 추천 ${formatCount(score)}`;
    }
  }

  // 3. 게시판 1위형 — sourceRank is 0-based; 0 means "this source's own #1
  // right now (see content.js's normalizeItem / ingest.js's rankBySource).
  //
  // 단, 홈 피드는 라운드로빈이라 "각 소스의 1위"가 대거 올라온다 — 조건 없이
  // 쓰면 카드 대부분이 똑같이 "○○ 베스트 1위"가 돼 편집 코멘트가 기계적으로
  // 읽힌다(David 2026-07-27 실측: 20건 중 13건 동일 문구). 그래서 **실제 반응
  // 수치가 함께 있을 때만** 쓰고, 수치를 같이 노출해 문구를 서로 다르게 만든다.
  // 지표가 없는 RSS 소스(1위여도 추천/댓글이 0)는 이 템플릿을 건너뛰고 아래
  // 신선형/번역형으로 흐르거나, 아무것도 없으면 빈 문자열이 된다(억지 금지).
  if (Number.isFinite(item.sourceRank) && item.sourceRank === 0 && (score > 0 || commentCount > 0)) {
    const bits = [];
    if (score > 0) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount > 0) bits.push(`댓글 ${formatCount(commentCount)}`);
    return `${label} 지금 1위 — ${bits.join("·")}`;
  }

  // 4. 댓글 폭발형 — comment volume clearly outpacing the score, regardless
  // of age (an old-but-still-arguing thread is still a real signal).
  if (commentCount >= DEBATE_COMMENT_FLOOR && commentCount >= score * DEBATE_RATIO_MIN) {
    return `댓글 ${formatCount(commentCount)}개 — 논쟁 중`;
  }

  // 5. 신선형 — just published, with some (even modest) real early traction.
  if (mins != null && mins <= FRESH_MAX_AGE_MIN && (score > 0 || commentCount > 0)) {
    const bits = [];
    if (score > 0) bits.push(`추천 ${formatCount(score)}`);
    if (commentCount > 0) bits.push(`댓글 ${formatCount(commentCount)}`);
    return `${Math.round(mins)}분 전 올라와 벌써 ${bits.join("·")}`;
  }

  // 6. 번역/해외형 — item.translated is only ever set true by translate.js
  // once a real machine translation actually ran (see TranslatingSource).
  // 발췌가 있을 때만 쓴다 (David 2026-08-06 제보).
  //
  // "한글로 옮겨왔어요"라고 써 놓고 본문이 없는 화면이 나왔다. 옮겨온 것이
  // 제목뿐인데 문장은 본문까지 옮겼다고 읽힌다 — 이 파일의 대원칙(실측되지
  // 않은 것을 말하지 않는다)에 그대로 어긋난다.
  //
  // 발췌가 없는 경우는 두 가지고 **둘 다 이 문장을 못 쓴다**:
  //   · 해커뉴스·Tildes처럼 원래 발췌가 없는 링크 애그리게이터 (정상)
  //   · 번역기가 요약을 못 옮겨 translate.js가 발췌를 버린 경우
  // 어느 쪽이든 아래 규칙(교차보도·순위 등)으로 넘어가고, 걸리는 게 없으면
  // 노트를 안 붙인다. 빈 노트가 거짓 노트보다 낫다.
  if (item.translated === true && item.summary && String(item.summary).trim()) {
    return score > 0 ? `${label} ${formatCount(score)}점, 한글로 옮겨왔어요` : `${label}, 한글로 옮겨왔어요`;
  }

  // 7. 관련 보도 묶음형 — 뉴스에는 추천/댓글이 아예 없어 위 템플릿이 전부
  // 비껴간다. 대신 구글뉴스가 같은 사건으로 묶어 준 관련 기사 수(item.coverage,
  // fetchers.js의 relatedCoverage)가 있고, 이건 우리가 지어낸 게 아니라 피드가
  // 실제로 실어 보낸 값이다.
  //
  // 다만 구글은 이 목록을 최대 5건까지만 준다(실측: 사실상 0 아니면 5). 따라서
  // "5개 매체가 보도"라고 쓰면 상한에 걸린 값을 정확한 수치인 양 말하는 셈이라
  // 이 파일의 대원칙(실측되지 않은 숫자 금지)에 어긋난다. 그래서 개수를 밝히지
  // 않고 "관련 보도 묶음"이라고만 말한다. 이 값만으로 지금핫 풀에서 복수
  // 피드를 직접 확인했다고 승격하지 않는다.
  if (Number.isFinite(item.coverage) && item.coverage >= COVERAGE_MANY) {
    return item.sourceRank === 0
      ? `${label} 지금 1위 — 관련 보도 묶음에 잡힌 뉴스`
      : `관련 보도 묶음에 잡힌 뉴스`;
  }

  // 8. 갓 올라온 게시판 상위글 — 추천/댓글 지표를 아예 제공하지 않는 RSS 소스는
  // 위 템플릿이 전부 비껴간다. 그래도 "그 게시판 상단에 방금 올라왔다"는 것은
  // 실측(sourceRank + publishedAt)이므로 수치를 지어내지 않고 그대로 쓴다.
  if (Number.isFinite(item.sourceRank) && item.sourceRank <= 2 && mins != null && mins <= FRESH_MAX_AGE_MIN) {
    const age = formatAgeShort(mins);
    return age === "방금" ? `${label}에 방금 올라온 상단 글` : `${label}에 ${age} 전 올라온 상단 글`;
  }

  // Data too thin to say anything honest — no filler sentence.
  return "";
}

// Shared category boilerplate, retained for canonical history and exact reader exclusion.
export function editorialValue(issue) {
  const categoryIds = issue.categoryIds || [];
  const ids = new Set(categoryIds || []);
  const text = [issue.headline, ...(issue.refs || []).map((ref) => ref.title)].join(" ");
  const market = /(금리|채권|환율|달러|원화|코스피|코스닥|증시|주가|주식|지수|S&P|나스닥|실적|영업이익|매출|배당|목표치)/i;
  const international = /(전쟁|공습|미사일|호르무즈|정유시설|무역|관세|제재|공급망|북한군|북중|미군기지|우크라|이란|외교|안보)/;
  const policy = /(대통령|정부|국회|법안|법률|시행령|정책|규제|세금|교육감|지지율|행정)/;
  const weather = /(폭염|태풍|호우|폭설|날씨|기온|열대야|너울|지진|산불|홍수|강진|붕괴|대피|사망)/;
  const health = /(건강|의료|치료|치매|알츠하이머|퇴행성|백신|항체|신약|임상|질환|병원|영양|임신|모체|바이오|감염)/;
  const sportsSafety = /(구장|경기장|관중|낙하|추락|붕괴|사고|부상|안전|대피|사망)/;
  const sportsIntegrity = /(심판|협회|성접대|승부조작|도핑|비리|수사|조사|징계|의혹|논란)/;

  if (ids.size > 1) {
    return {
      lens: "복합 이슈",
      text: "여러 관심 분야에 걸친 사안이라 현재 확인된 사실과 후속 변화를 함께 볼 가치가 있다."
    };
  }

  // 분야가 판단 가치의 주어다. 제목 속 우연한 단어 하나가 다른 분야의
  // 상투문을 가져가면 개인화 설명 자체가 틀어진다.
  if (ids.has("sports")) {
    if (sportsSafety.test(text)) {
      return { lens: "안전·운영", text: "경기장과 관중 안전에 연결되는 사안이라 사고 원인·시설 조치·후속 운영 변화를 확인할 가치가 있다." };
    }
    if (sportsIntegrity.test(text)) {
      return { lens: "운영·신뢰", text: "심판·협회 운영과 경기 신뢰에 연결되는 사안이라 조사 결과와 공식 후속 조치를 확인할 가치가 있다." };
    }
    return { lens: "경기·선수", text: "경기 일정·선수 상태·순위 흐름을 따라가는 데 필요한 맥락이라 결과와 후속 변화를 함께 볼 가치가 있다." };
  }
  if (ids.has("gaming")) {
    return { lens: "출시·플레이", text: "출시·업데이트와 실제 이용자 반응을 구분해 게임 선택과 흐름을 판단하는 데 참고할 가치가 있다." };
  }
  if (ids.has("realestate")) {
    return { lens: "주거·자산", text: "주거비·공급·대출과 보유 판단에 연결되는 흐름이라 적용 대상과 시행 범위를 이어서 볼 가치가 있다." };
  }
  if (ids.has("business")) {
    if (international.test(text)) return { lens: "거시·공급망", text: "원자재·물류·기업 비용과 시장 변동성에 연결될 수 있어 후속 지표와 공식 발표를 함께 볼 가치가 있다." };
    if (market.test(text)) return { lens: "시장·실적", text: "시장 가격과 기업·자산 판단에 연결되는 흐름이라 후속 수치와 원자료를 확인할 가치가 있다." };
    return { lens: "기업·경제", text: "기업 활동과 경기 흐름을 판단하는 현재 맥락이라 실제 수치와 후속 발표를 함께 볼 가치가 있다." };
  }
  if (ids.has("politics")) {
    if (international.test(text)) return { lens: "외교·안보", text: "외교·안보 결정과 국제 관계의 변화를 판단하는 데 필요한 맥락이라 당사국 발표와 후속 조치를 볼 가치가 있다." };
    if (/(선거|투표|경선|당권|정당|후보|민주당|국민의힘)/.test(text)) return { lens: "선거·권력구도", text: "정당 선택과 권력구도의 변화를 보여주는 흐름이라 실제 투표 결과와 후속 입장을 확인할 가치가 있다." };
    return { lens: "정책·의사결정", text: "정책 결정의 방향과 실제 시행 범위를 구분해 시민·시장에 미칠 후속 변화를 볼 가치가 있다." };
  }
  if (ids.has("science")) {
    return { lens: "연구·근거", text: "새 연구가 기존 설명을 얼마나 바꾸는지 판단하려면 원 연구와 검증 범위를 함께 볼 가치가 있다." };
  }
  if (ids.has("tech")) {
    return { lens: "기술·제품", text: "기술 채택과 제품·산업 경쟁의 변화를 따라가는 데 필요한 맥락이라 실제 적용 범위와 후속 발표를 볼 가치가 있다." };
  }
  if (ids.has("auto")) {
    return { lens: "구매·이동", text: "차량 선택·운행 경험과 모빌리티 시장 변화에 연결되는 흐름이라 제원과 실제 이용 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("life")) {
    if (health.test(text)) return { lens: "건강·근거", text: "건강과 생활 판단에 연결되는 정보라 적용 대상·근거 수준·실제 효용을 구분해 볼 가치가 있다." };
    if (weather.test(text)) return { lens: "생활·안전", text: "이동·야외활동·안전 계획에 연결되는 변화라 지역과 시간대별 후속 정보를 확인할 가치가 있다." };
    return { lens: "생활·활용", text: "일상 선택과 실제 활용에 연결되는 흐름이라 조건과 이용 경험을 함께 볼 가치가 있다." };
  }
  if (ids.has("fashion")) {
    return { lens: "제품·스타일", text: "제품과 스타일이 어디서 주목받는지 보여주는 흐름이라 출시 맥락과 실제 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("art")) {
    return { lens: "작품·디자인", text: "작품·전시·디자인의 현재 흐름을 이해하는 데 필요한 맥락이라 창작 배경과 공개 반응을 함께 볼 가치가 있다." };
  }
  if (ids.has("culture")) {
    return { lens: "대중문화", text: "대중문화에서 무엇이 반응을 얻고 확산되는지 보여주는 흐름이라 공식 정보와 대중 반응을 구분해 볼 가치가 있다." };
  }
  if (ids.has("humor")) {
    return { lens: "공유·유행", text: "지금 어떤 소재가 빠르게 공유되고 있는지 보여주는 흐름이라 반응의 규모와 맥락을 함께 볼 가치가 있다." };
  }

  // 종합 뉴스만 교차 분야 신호를 제목에서 해석한다.
  if (weather.test(text)) return { lens: "재난·안전", text: "안전과 이동·생활 계획에 직접 연결되는 사안이라 피해 범위와 공식 후속 정보를 확인할 가치가 있다." };
  if (international.test(text)) return { lens: "국제정세", text: "외교·안보와 공급망 변화에 연결되는 사안이라 당사국 발표와 후속 영향을 함께 볼 가치가 있다." };
  if (market.test(text)) return { lens: "경제 흐름", text: "시장과 기업 판단에 연결될 수 있는 사안이라 실제 수치와 후속 보도를 확인할 가치가 있다." };
  if (policy.test(text)) return { lens: "정책·사회", text: "정책·사회 변화의 방향과 실제 시행 범위를 구분해 후속 보도를 확인할 가치가 있다." };
  if (health.test(text)) return { lens: "건강·사회", text: "건강과 공공 판단에 연결되는 정보라 대상과 근거 범위를 확인할 가치가 있다." };
  return { lens: "공공 맥락", text: "사회 흐름에서 무엇이 달라졌는지 파악하는 데 필요한 사건이라 후속 사실과 영향을 함께 볼 가치가 있다." };
}
