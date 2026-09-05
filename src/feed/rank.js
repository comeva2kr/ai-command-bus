import { diversityKey } from "./ingest.js";
import { eventKey, canonicalContentUrl } from "./dedupe.js";
import { DEAL_MAX_SHARE } from "./deals.js";
// 핫은 공통 후보의 화제성·취향 점수로 선발한다. 명시한 관심 분야는 엔진에서
// 먼저 좁히고, 여기서는 출처·카테고리의 과도한 반복과 싫어하는 분야를 막는다.
// 새로고침 앵커도 같은 상한 안에서만 우선한다.

// ---------------------------------------------------------------------------
// 튜너블 — opts > env > 기본값 (ingest.js hotParams와 같은 관례)
// ---------------------------------------------------------------------------
function envNum(name, dflt) {
  const v = process.env[name];
  return v != null && v !== "" ? Number(v) : dflt;
}

export function rankParams(opts = {}) {
  return {
    // taste 결합 가중치. 익명 경로의 HOT_TASTE_W(0.15, "재정렬만")와 달리
    // 구성 자체를 움직이는 크기다 — hot의 감쇠 항이 실전 대부분 0.3 미만이라
    // 0.4·tanh(taste/2)면 설문 1회 선택(카테고리 +1.0)으로 +0.18의 전역 이점.
    tasteW: opts.tasteW ?? envNum("RANK_TASTE_W", 0.4),
    collabW: opts.collabW ?? envNum("RANK_COLLAB_W", 0.2),
    // 노출 이력은 가까운 점수의 순서만 보정한다. 누적 이용량이 새 인기글을
    // 영구히 묻지 않도록 실제 감점은 아래에서 0.15로 제한한다.
    exposureW: opts.exposureW ?? envNum("RANK_EXPOSURE_W", 0.55),
    // 같은 페이지 안에서 이미 뽑힌 **카테고리**의 반복 페널티 (2026-08-01,
    // 실사용자 회귀: 취향을 여러 개 고른 유저의 쿼터를 화제성 상위 카테고리
    // 하나(자동차 뉴스 급증)가 통째로 먹었다 — 소스 상한은 소스가 제각각이라
    // 무력했다. 카테고리 반복이 쌓일수록 다른 고른 카테고리가 역전한다.)
    pageCatRepeatW: opts.pageCatRepeatW ?? envNum("RANK_PAGE_CAT_REPEAT_W", 0.25),
    // 카테고리 페이지 상한 백스톱: 어떤 카테고리도 페이지의 이 비율을 넘지
    // 못한다. 단일 취향 유저의 쿼터(0.6)와 같은 값이라 그 경험은 불변.
    pageCatShare: opts.pageCatShare ?? envNum("RANK_PAGE_CAT_SHARE", 0.6),
    // **안 고른(중립) 카테고리**의 페이지 상한 — 실사용 회귀(2026-08-01)의
    // 본체: 자동차를 고르지도 않은 유저의 자유 슬롯·탐색 창을 신선한 자동차
    // 뉴스 급증이 통째로 먹었다. 탐색(발견)은 남기되 도배는 못 하게 30%.
    pageNeutralCatShare: opts.pageNeutralCatShare ?? envNum("RANK_PAGE_NEUTRAL_CAT_SHARE", 0.3),
    // 페이지당 소스 상한 비율: cap = max(1, ceil(limit * share))
    pageSourceShare: opts.pageSourceShare ?? envNum("RANK_PAGE_SOURCE_SHARE", 0.2),
    // 1페이지: 고른 카테고리 최소 비율 (적대적 검수 권고 6/10)
    firstPickedShare: opts.firstPickedShare ?? envNum("RANK_FIRST_PICKED_SHARE", 0.6),
    // 2페이지 이후의 고른 카테고리 최소 비율 — 쿼터가 1페이지에만 걸리면
    // 뒤 페이지에서 취향 글이 급감한다(2026-07-31 적대적 검수 실측: 게임 취향
    // 유저의 2·3페이지 게임 글 0개, 연예 취향 50건 중 6건). 탐색 창(otherShare)
    // 은 유지하므로 필터버블로는 가지 않는다.
    // 0.4 -> 0.5 (David 2026-08-01 승인: 2차 검수 "순도 42~50%" 지적 수용,
    // 탐색 창 otherShare 0.2는 유지하므로 필터버블 하한은 지켜진다)
    laterPickedShare: opts.laterPickedShare ?? envNum("RANK_LATER_PICKED_SHARE", 0.6),
    // 관심 밖 글은 점수 경쟁으로만 들어오며, 있더라도 이 비율을 넘기지 않는다.
    otherShare: opts.otherShare ?? envNum("RANK_OTHER_SHARE", 0.2),
    // vec.categories 문턱: 설문 선택은 +1.0, 명시적 회피는 큰 음수로 내려간다
    pickMin: opts.pickMin ?? envNum("RANK_PICK_MIN", 0.5),
    hateMax: opts.hateMax ?? envNum("RANK_HATE_MAX", -1.0)
  };
}

// 취향 벡터에서 "고른 카테고리"와 "싫어하는 카테고리"를 뽑는다.
export function categorySets(vec, params = rankParams()) {
  const picked = new Set();
  const hated = new Set();
  if (vec && vec.categories) {
    for (const [cat, w] of Object.entries(vec.categories)) {
      if (w >= params.pickMin) picked.add(cat);
      else if (w <= params.hateMax) hated.add(cat);
    }
  }
  return { picked, hated };
}

// 전역 아이템 점수. hot은 sourceHotScores의 로지스틱 유계값(대략 0~1대),
// taste는 recommender.tasteScore(순수 취향)를 tanh로 (-1,1) 압축한 값,
// collab은 협업 부스트(0~).
export function globalScore(hot, taste, collab, params) {
  return (hot ?? 0) + params.tasteW * taste + params.collabW * Math.min(1, collab || 0);
}

// ---------------------------------------------------------------------------
// selectDiverse — greedy 선발 + 자격 검사 + 쿼터 룩어헤드
// ---------------------------------------------------------------------------
//
// cands: [{ item, hot, taste, collab }] — 이미 seen/tooOld/mute/topic 필터를
//   통과한 후보 전체. 이 함수는 I/O가 없다(테스트 용이).
// opts: { limit, minGap, exposure(Map|obj), firstPage, picked, hated }
//
// 반환: { picks: [item...], shortfall, bannedHatedCount }
//   shortfall: 1페이지 picked 쿼터가 공급 부족으로 목표에 못 미쳤는가
//   bannedHatedCount: 1페이지에서 hated 하드 배제로 제외된 후보 수
//   (engine이 exhausted 계산에 쓴다 — 배제 때문에 모자란 것은 소진이 아니다)
export function selectDiverse(cands, opts = {}, params = rankParams()) {
  const limit = opts.limit ?? 10;
  const minGap = opts.minGap ?? 1;
  const firstPage = Boolean(opts.firstPage);
  const picked = opts.picked instanceof Set ? opts.picked : new Set();
  const hated = opts.hated instanceof Set ? opts.hated : new Set();
  const exposure = opts.exposure || null;
  const anchors = new Map((opts.anchors || []).map((id, index, ids) => [id, ids.length - index]));
  // 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 슬라이더 (-1 커뮤 ~ 0 균형 ~ +1 뉴스).
  const mixBalance = Number.isFinite(opts.mixBalance) ? opts.mixBalance : 0;
  const exposureOf = (src) => {
    if (!exposure) return 0;
    const v = typeof exposure.get === "function" ? exposure.get(src) : exposure[src];
    return Number.isFinite(v) ? v : 0;
  };

  const isPicked = (c) => picked.has(c.item.category) && !hated.has(c.item.category);
  const isHated = (c) => hated.has(c.item.category);
  const isOther = (c) => !picked.has(c.item.category) && !hated.has(c.item.category);

  // 전역 점수 부여
  for (const c of cands) c.global = globalScore(c.hot, c.taste, c.collab, params);

  // hated 하드 배제 — 전 페이지 (2026-07-31 변경). 원래 2페이지부터는 감점만
  // 했지만, 적대적 검수 실측에서 명시적으로 회피한 카테고리가 matchScore
  // -0.76인데도 노출됐다 — "싫다"고 답한 사용자에게 그 글을 보여줘서 얻는
  // 탐색 이득이 없다. (설계 문서 Q3의 기아 우려는 '소스' 차원이었고, 이건
  // 사용자가 직접 고른 '카테고리 회피'다 — 설문을 바꾸면 즉시 풀린다.)
  // 배제 수는 기록해 exhausted 오판을 막는다.
  let pool = cands;
  let bannedHatedCount = 0;
  if (hated.size) {
    bannedHatedCount = cands.filter(isHated).length;
    pool = cands.filter((c) => !isHated(c));
  }

  // 재시작한 풀에도 같은 글의 여러 수집 ID가 남을 수 있다. 공급량을 세기
  // 전에 같은 URL 또는 같은 출처의 동일 제목을 한 번만 남긴다.
  const urls = new Set(), titles = new Set();
  pool = [...pool].sort((a, b) => b.global - a.global).filter((c) => {
    const url = canonicalContentUrl(c.item.canonicalUrl || c.item.url);
    const title = eventKey(c.item.title);
    const key = title && `${c.item.source}:${title}`;
    if ((url && urls.has(url)) || (key && titles.has(key))) return false;
    if (url) urls.add(url);
    if (key) titles.add(key);
    return true;
  });

  // 쿼터는 공급량으로 클램프 — 없는 걸 있는 척하지 않는다(정직한 부족 처리).
  const cap = Math.max(1, Math.ceil(params.pageSourceShare * limit));
  // 종류별 소스 상한 — 비율 슬라이더가 실제로 먹는 지점.
  //
  // 처음엔 hot에 승수만 곱했는데 첫 페이지 구성이 전혀 안 바뀌었다(실측:
  // 슬라이더 양 끝에서 뉴스 비중 0.60으로 동일). 이 선택기는 **소스 상한이
  // 구성을 먼저 고정**하기 때문이다 — 점수를 아무리 올려도 소스당 cap을 넘겨
  // 담지 못하니 뉴스:커뮤 비율은 소스 개수 비율에 묶여 있었다. 그래서 슬라이더는
  // 점수가 아니라 **쿼터**를 움직여야 한다.
  //
  // 아래 완화 사다리가 이미 있어서 한쪽 공급이 얇아도 페이지가 비지 않는다:
  // 자격 후보가 없으면 cap이 풀리고 양쪽이 다시 흐른다.
  const capFor = (c) => {
    const k = c.item && c.item.kind;
    if (!mixBalance || Math.abs(mixBalance) === 1 || (k !== "news" && k !== "community")) return cap;
    const dir = k === "news" ? 1 : -1;
    return Math.max(1, Math.round(cap * (1 + dir * mixBalance * 0.8)));
  };
  const pickedSupply = pool.filter(isPicked).length;
  const pickedShare = firstPage ? params.firstPickedShare : params.laterPickedShare;
  const pickedTarget = picked.size ? Math.ceil(pickedShare * limit) : 0;
  const minPicked = Math.min(pickedTarget, pickedSupply);


  const remaining = [...pool].sort((a, b) => b.global - a.global);
  const out = [];
  const pagePicks = new Map(); // src -> 이번 페이지 선발 수
  const pageCats = new Map(); // category -> 이번 페이지 선발 수
  const catCap = Math.max(1, Math.ceil(params.pageCatShare * limit));
  const neutralCatCap = Math.max(1, Math.ceil(params.pageNeutralCatShare * limit));
  // 고른 카테고리는 쿼터만큼(0.6), 안 고른 카테고리는 탐색 허용치(0.3)까지만.
  const catCapFor = (c) => (isPicked(c) ? (picked.size === 1 ? limit : catCap) : neutralCatCap);
  // 중립 **합계** 상한 = 탐색 창 크기(otherShare)와 동일 (David 2026-08-01
  // "안 고른 카테고리는 안 나와야 하는 거 아냐"에 대한 절충): 취향을 세팅한
  // 유저의 페이지는 고른 것 8 + 탐색 2로 고정된다. 카테고리별 상한만으로는
  // 중립 여러 개가 2~3개씩 쌓여 합계가 절반까지 갔다. 완전 0은 두지 않는다
  // — 취향 학습(피드백 후보)과 새 관심사 발견 통로가 죽는다.
  const neutralTotalCap = picked.size ? Math.ceil(params.otherShare * limit) : Infinity;
  let pickedCount = 0;
  let otherCount = 0;

  while (out.length < limit && remaining.length) {
    const slotsLeft = limit - out.length;
    const needP = Math.max(0, minPicked - pickedCount);
    const recentSrcs = out.slice(-minGap).map((c) => diversityKey(c.item));

    // 쿼터 룩어헤드: 남은 슬롯이 미충족 쿼터 합과 같아지면 그 클래스만 자격.
    const quotaOk = (c) => {
      if (needP < slotsLeft) return true;
      // 슬롯이 쿼터에 딱 맞게 남음 — 쿼터를 채우는 후보만
      return needP > 0 && isPicked(c);
    };

    const eligible = (relaxCap, relaxCat, relaxGap) =>
      remaining.filter(
        (c) =>
          (c.item.via !== "ourdeal" || !out.some(chosen => chosen.item.via === "ourdeal")) &&
          (!c.item.isDeal || out.filter(chosen => chosen.item.isDeal).length < Math.max(1, Math.floor(limit * DEAL_MAX_SHARE))) &&
          (relaxCap || (pagePicks.get(diversityKey(c.item)) || 0) < capFor(c)) &&
          (relaxCat || (pageCats.get(c.item.category) || 0) < catCapFor(c)) &&
          (relaxCat || !isOther(c) || otherCount < neutralTotalCap) &&
          (relaxGap || !recentSrcs.includes(diversityKey(c.item))) &&
          quotaOk(c)
      );

    // 완화 순서: 정상 → 카테고리cap → 소스cap → gap. 카테고리 상한이 가장
    // 새 제약이라 먼저 푼다 — 소스 상한을 먼저 풀면 단일 카테고리 풀에서
    // 한 소스 도배가 부활한다(테스트 실측). 쿼터와 hated 배제는 끝까지 유지.
    let feasible = eligible(false, false, false);
    if (!feasible.length) feasible = eligible(false, true, false);
    if (!feasible.length) feasible = eligible(true, true, false);
    if (!feasible.length) feasible = eligible(true, true, true);
    if (!feasible.length) break; // 쿼터 자체를 채울 공급이 없음 (이미 클램프됐으므로 도달 드묾)

    // 소프트 페널티를 얹은 조정 점수로 최종 선택
    let best = null;
    let bestAdj = -Infinity;
    for (const c of feasible) {
      const adj =
        (anchors.get(c.item.id) || 0) * 1000000 + c.global -
        Math.min(0.15, params.exposureW * Math.log(1 + exposureOf(diversityKey(c.item)))) -
        params.pageCatRepeatW * (pageCats.get(c.item.category) || 0);
      if (adj > bestAdj) { bestAdj = adj; best = c; }
    }

    out.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    pagePicks.set(diversityKey(best.item), (pagePicks.get(diversityKey(best.item)) || 0) + 1);
    pageCats.set(best.item.category, (pageCats.get(best.item.category) || 0) + 1);
    if (isPicked(best)) pickedCount++;
    else if (isOther(best)) otherCount++;
  }

  return {
    picks: out.map((c) => c.item),
    shortfall: picked.size > 0 && minPicked < pickedTarget,
    bannedHatedCount
  };
}
