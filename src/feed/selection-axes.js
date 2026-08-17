// P3-A 선별 축 산식 — shadow 선별 계층의 순수 함수 모음.
//
// 블루프린트 v4 "정정 3 — 신호 축"의 코드 정본이다. 여기의 어떤 함수도 현행
// 서빙·편성 경로(digest.js·engine.js·server.js)를 건드리지 않는다 — shadow
// 계층(shadow-selection.js)과 평가 도구(tools/eval-shadow-edition.mjs)만
// 소비한다. 순수 함수만 있다: 네트워크·저장소·시계 접근 없음(now는 인자).
//
// ── 축 정의 (v4 정정 3)
//   heat        화제성. 반응(추천·댓글)의 log10 포화. **커뮤니티 반응은 이 축
//               에만 계수한다** — importance·trust에 합산 금지(정정 3: 커뮤
//               반응과 독립 언론 보도는 서로 다른 축).
//   importance  중요도. 독립 운영그룹 계수(중계 1회 — event-cluster counts
//               재사용) + 무게 있는 분야 + primary/first_party 근거 유무.
//   change      변화. 신선도 계단(팩별 창 대비 경과 시간) × factsFingerprint
//               재등장 게이트(직전 판과 지문이 같으면 0 — 재탕 강화 금지).
//   trust       점수가 아니다 — 팩별 자격 게이트의 **재료**만 산출한다
//               (trustMaterials). 게이트 판정 자체는 shadow-selection.js의
//               팩별 계약이 한다(전 분야 공통 규칙 금지 — 정정 1).
//
// 모든 축은 [0,1] 값과 함께 **근거(입력 신호 값)** 를 반환한다 — 감사 가능성.
//
// ── 숫자의 출처 (실측 없는 숫자 금지)
//   - 반응 셈법 score + 2×commentCount: digest.js:652의 현행 eng 셈법 재사용.
//   - 포화점·계단·구성비의 초기값은 shadow-selection.js의 팩 파라미터 테이블
//     한 곳에만 있다(3일 관찰로 조정될 값 — 여기 하드코딩 금지). 이 파일의
//     함수는 전부 파라미터를 인자로 받는다.

// digest.js:652와 같은 셈법 — 추천 1점, 댓글은 참여 비용이 높아 2점.
export const engagementOf = (article) =>
  Math.max(0, (Number(article && article.score) || 0)
    + (Number(article && article.commentCount) || 0) * 2);

const sumEngagement = (articles) =>
  (articles || []).reduce((sum, article) => sum + engagementOf(article), 0);

// ---------------------------------------------------------------------------
// heat — 반응의 log10 포화
// ---------------------------------------------------------------------------
//
// 소스마다 추천 스케일이 다르다(더쿠 16만 vs 인벤 수백 — digest.js 실측 주석).
// log10으로 누르고 saturationEng에서 1.0로 포화시킨다: "많이 받았다"는 사실만
// 남고 스케일 경쟁은 사라진다. 커뮤니티 반응글(reactionArticles)은 여기에만
// 계수된다.
export function heatAxis({ memberArticles = [], reactionArticles = [] } = {}, { saturationEng } = {}) {
  const sat = Number(saturationEng);
  if (!Number.isFinite(sat) || sat <= 0) throw new Error("heatAxis: saturationEng 파라미터 필요");
  const memberEng = sumEngagement(memberArticles);
  const reactionEng = sumEngagement(reactionArticles);
  const eng = memberEng + reactionEng;
  const value = Math.min(1, Math.log10(1 + eng) / Math.log10(1 + sat));
  return {
    value,
    evidence: { eng, memberEng, reactionEng, saturationEng: sat }
  };
}

// ---------------------------------------------------------------------------
// importance — 독립 운영그룹 계수 · 무게 있는 분야 · primary 근거
// ---------------------------------------------------------------------------
//
// - 독립 운영그룹 계수는 event-cluster의 counts.independentReportingGroups를
//   그대로 쓴다(같은 운영그룹 분야별 피드 1회 계수·중계 1회 — C4 계약).
//   groupSaturation(초기값 5 — digest.js coveragePoints의 min(5,·) 재사용)에서
//   포화한다. 표본 9(coverage 0/5 이진 포화)의 교훈: 이 축의 근거는 관측된
//   운영그룹 목록 그 자체다 — 이진 신호(relatedCoverage)로 부풀리지 않는다.
// - weighty: 구성원 카테고리가 weightyCategories에 속하는가.
// - primary: primary/first_party 근거가 하나라도 있는가(roleOf로 판정).
// - marketSignal(해외 전용, David 채택 옵션 1 2026-08-17): componentWeights에
//   marketSignal 키가 있을 때만 계산한다 — 국내 사건(componentWeights에 그
//   키가 없는 기존 호출)은 이 분기를 타지 않아 셈법이 바이트 그대로다.
//   구성원(보도) 기사 제목이 marketSignalLexicon(한국어 부분 문자열·영어
//   소문자 단어 경계)에 하나라도 걸리면 이진 1이다.
export function importanceAxis({ event, memberArticles = [] } = {}, {
  groupSaturation,
  weightyCategories,
  componentWeights,
  roleOf,
  marketSignalLexicon = null
} = {}) {
  const sat = Number(groupSaturation);
  if (!Number.isFinite(sat) || sat <= 0) throw new Error("importanceAxis: groupSaturation 파라미터 필요");
  if (!componentWeights) throw new Error("importanceAxis: componentWeights 파라미터 필요");
  if (typeof roleOf !== "function") throw new Error("importanceAxis: roleOf 필요");
  const weighty = new Set(weightyCategories || []);
  const groups = Math.max(0, Number(event && event.counts
    && event.counts.independentReportingGroups) || 0);
  const groupsRatio = Math.min(1, groups / sat);
  const weightyHit = memberArticles.some((article) => weighty.has(article && article.category));
  const roles = memberArticles.map((article) => roleOf(article));
  const primaryHit = roles.some((role) => role === "primary" || role === "first_party");
  const w = componentWeights;
  let marketSignalHit = false;
  let marketSignalMatches = [];
  if (w.marketSignal) {
    if (!marketSignalLexicon) throw new Error("importanceAxis: marketSignal 성분 사용 시 marketSignalLexicon 필요");
    const korean = marketSignalLexicon.korean || [];
    const english = marketSignalLexicon.english || [];
    for (const article of memberArticles) {
      const title = String((article && article.title) || "");
      const lower = title.toLowerCase();
      for (const term of korean) {
        if (term && title.includes(term)) marketSignalMatches.push({ articleId: article.id ?? null, term });
      }
      for (const term of english) {
        if (term && new RegExp(`(?:^|[^a-z])${term.toLowerCase()}(?:$|[^a-z])`).test(lower)) {
          marketSignalMatches.push({ articleId: article.id ?? null, term });
        }
      }
    }
    marketSignalHit = marketSignalMatches.length > 0;
  }
  const value = (w.groups || 0) * groupsRatio
    + (w.weighty || 0) * (weightyHit ? 1 : 0)
    + (w.primary || 0) * (primaryHit ? 1 : 0)
    + (w.marketSignal || 0) * (marketSignalHit ? 1 : 0);
  return {
    value,
    evidence: {
      independentReportingGroups: groups,
      groupSaturation: sat,
      groupsRatio,
      weighty: weightyHit,
      weightyCategories: [...weighty],
      primary: primaryHit,
      memberRoles: roles,
      componentWeights: { ...w },
      ...(w.marketSignal ? { marketSignal: marketSignalHit, marketSignalMatches } : {})
    }
  };
}

// ---------------------------------------------------------------------------
// change — 신선도 계단 + factsFingerprint 재등장 게이트
// ---------------------------------------------------------------------------

// 창(windowHours)을 stair.length 등분한 계단값. 창 밖은 0.
// 예: stair [1, 0.75, 0.5, 0.25], 창 12h → 0~3h:1, 3~6h:0.75, 6~9h:0.5,
// 9~12h:0.25, 12h 초과:0.
export function freshnessStairValue(ageHours, windowHours, stair) {
  const window = Number(windowHours);
  const age = Number(ageHours);
  if (!Array.isArray(stair) || !stair.length) throw new Error("freshnessStairValue: stair 파라미터 필요");
  if (!Number.isFinite(window) || window <= 0) throw new Error("freshnessStairValue: windowHours 파라미터 필요");
  if (!Number.isFinite(age) || age < 0) return 0;
  if (age > window) return 0;
  const step = Math.min(stair.length - 1, Math.floor((age / window) * stair.length));
  return Number(stair[step]) || 0;
}

const parseTime = (value) => {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
};

// 경과 기준 시각은 사건의 마지막 실질 변화(lastMaterialChangeAt, 없으면
// firstSeenAt)다 — 파편이 늦게 붙어 새 사실이 더해진 사건은 그 시점부터
// 신선한 것으로 본다(사건 생명주기 계약).
//
// previousFingerprint: 직전 판에 같은 사건이 있었다면 그 factsFingerprint.
//   - 지문이 같으면 실질 변화 없는 재등장 → value 0 (게이트 재료로도 반환).
//   - 지문이 다르면 실질 변화 있음 → 신선도 계단값 그대로(발명 보너스 없음).
export function changeAxis({ event } = {}, { now, windowHours, stair, previousFingerprint = null } = {}) {
  const at = Number(now);
  if (!Number.isFinite(at)) throw new Error("changeAxis: now 필요");
  const basisAt = parseTime(event && (event.lastMaterialChangeAt || event.firstSeenAt));
  const ageHours = basisAt === null ? null : Math.max(0, (at - basisAt) / 3600000);
  const reappearedUnchanged = Boolean(previousFingerprint
    && event && previousFingerprint === event.factsFingerprint);
  const materialChange = Boolean(previousFingerprint
    && event && previousFingerprint !== event.factsFingerprint);
  const freshness = ageHours === null ? 0 : freshnessStairValue(ageHours, windowHours, stair);
  return {
    value: reappearedUnchanged ? 0 : freshness,
    evidence: {
      basisAt: basisAt === null ? null : new Date(basisAt).toISOString(),
      ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
      windowHours: Number(windowHours),
      stair: [...(stair || [])],
      freshness,
      previousFingerprint,
      reappearedUnchanged,
      materialChange
    }
  };
}

// ---------------------------------------------------------------------------
// trust — 점수가 아니라 게이트 재료
// ---------------------------------------------------------------------------
//
// 팩별 자격 게이트(shadow-selection.js)가 소비할 관측값만 모은다. 어떤 팩이
// 어떤 조합을 요구하는지는 여기서 판단하지 않는다(전 분야 공통 규칙 금지).
export function trustMaterials({ event, memberArticles = [], reactionArticles = [] } = {}, { roleOf } = {}) {
  if (typeof roleOf !== "function") throw new Error("trustMaterials: roleOf 필요");
  const roleCounts = {};
  for (const article of memberArticles) {
    const role = roleOf(article) || "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const primaryOrFirstParty = (roleCounts.primary || 0) + (roleCounts.first_party || 0);
  return {
    independentReportingGroups: Math.max(0, Number(event && event.counts
      && event.counts.independentReportingGroups) || 0),
    communityGroups: Math.max(0, Number(event && event.counts
      && event.counts.communityGroups) || 0),
    roleCounts,
    hasPrimaryOrFirstParty: primaryOrFirstParty > 0,
    reportedSecondaryOnly: (roleCounts.reported_secondary || 0) > 0
      && primaryOrFirstParty === 0
      && Math.max(0, Number(event && event.counts
        && event.counts.independentReportingGroups) || 0) < 2,
    communityEng: sumEngagement(memberArticles.filter((article) => article
      && article.kind === "community")) + sumEngagement(reactionArticles)
  };
}
