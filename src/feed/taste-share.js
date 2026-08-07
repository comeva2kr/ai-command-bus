// 고른 취향이 피드의 주인이 되게 한다.
//
// ── 왜 이 파일이 있나 (David 2026-08-06)
// <em>"취향 설정한다고 했는데도 너무 애매하게 섞여서 피딩이 돼. 사용자 입장에서
// 볼 때 아직 알고리즘이 많이 부족해."</em>
//
// 라이브 실측(2026-08-06, 취향만 다른 계정 넷 × 60건):
//   취향 없음        humor 25% · business 23% · tech 20%
//   IT만             tech 60%
//   유머만           humor 60%
//   **스포츠만       humor 45% · sports 32%**   ← 고른 것보다 유머가 더 많다
//
// ── 원인
// scoreItem이 개인화 점수(categoryW × 1.0)와 인기 점수(popularityPrior × 0.5)를
// **그냥 더한다.** 두 값의 스케일이 다르면 큰 쪽이 이긴다 — 유머 커뮤니티 글은
// 추천 수가 커서 스포츠 선택을 눌러 버린다. LinkedIn 엔지니어링이 "후보 소스마다
// 점수 스케일이 다르므로 캘리브레이션이 필수"라고 말하는 바로 그 실패다.
//
// ── 레퍼런스 (혼자 발명하지 않는다)
// · X(Twitter) the-algorithm — For You 타임라인은 In-Network 50% / Out-of-Network
//   50%를 **평균 비율로 명시**한다. 점수 경쟁에 맡기지 않고 지분을 정해 둔다.
// · X의 AuthorDiversityFloor(0.25) — 감쇠시키되 **0으로 죽이지 않고 바닥을 둔다.**
// · TikTok — 관심 카테고리를 안 고른 사용자에게는 인기 피드로 시작하고, 고른
//   사용자에게도 무관한 것을 의도적으로 섞는다. 지분은 100%가 아니다.
// · Netflix/Spotify는 섹션을 나눠 이 문제를 회피한다 — 우리 피드 UX와 안 맞아
//   채택하지 않았다(한 줄로 흐르는 피드가 이 앱의 형태다).
//
// ── 우리 방향으로 발전시킨 점
// 우리에겐 이미 같은 골격이 있다 — 딜 지분 보장(deals.js ensureDealShare).
// 새 개념을 만들지 않고 그 골격을 취향에 쓴다. 그리고 **지우지 않고 끌어올린다**:
// 취향 밖 글을 버리면 발견이 사라지고, 그건 TikTok이 일부러 피하는 것이다.

// 고른 취향이 가져갈 최소 지분. 100%로 두지 않는 이유는 위의 TikTok 원칙 —
// 고르지 않은 것도 만나야 취향이 넓어지고, 그게 매일 올 이유가 된다.
export const TASTE_MIN_SHARE = 0.6;

// 한 카테고리가 통째로 도배되는 것도 막는다. X의 floor와 같은 발상 —
// 지분은 주되 전부를 주지는 않는다.
export const TASTE_MAX_SHARE = 0.85;

// 사용자가 **명시적으로 고른** 카테고리. 행동으로 학습된 취향(가중치)이 아니라
// 설문에서 직접 고른 것만 본다 — 지분 보장은 강한 개입이라 명시적 의사에만 건다.
export function chosenCategories(user) {
  const answers = (user && user.surveyAnswers) || null;
  const cats = answers && Array.isArray(answers.categories) ? answers.categories : [];
  return new Set(cats.filter(Boolean));
}

// list에서 고른 카테고리 비율이 minShare에 못 미치면 pool에서 끌어와 채운다.
//
// **재료가 없으면 있는 만큼만 채운다.** 없는 것을 만들지 않는다 — 스포츠 글이
// 풀에 2%뿐이면 아무리 지분을 정해도 그만큼은 안 나온다. 그 경우 이 함수는
// 조용히 덜 채우고, 부족하다는 사실은 호출부가 화면에 말할 수 있게 돌려준다.
export function ensureTasteShare(list, pool, { cats, minShare = TASTE_MIN_SHARE } = {}) {
  const wanted = cats instanceof Set ? cats : new Set(cats || []);
  if (!wanted.size || !Array.isArray(list) || !list.length) {
    return { items: list || [], added: 0, short: false };
  }
  const hit = (i) => i && wanted.has(i.category);
  const have = list.filter(hit).length;
  const need = Math.ceil(list.length * minShare) - have;
  if (need <= 0) return { items: list, added: 0, short: false };

  const inList = new Set(list.map((i) => i.id));
  const extra = [];
  for (const it of pool || []) {
    if (extra.length >= need) break;
    if (!hit(it) || inList.has(it.id)) continue;
    extra.push(it);
    inList.add(it.id);
  }

  if (!extra.length) return { items: list, added: 0, short: true };

  // 끌어온 것을 **앞쪽에 고르게 섞는다.** 뒤에 몰아 붙이면 첫 화면은 그대로라
  // 사용자가 느끼는 것이 안 바뀐다 — 고친 이유가 첫 화면이었다.
  // 취향 밖 글을 버리지는 않는다(길이 보존). 뒤로 밀릴 뿐이다.
  const rest = list.slice();
  const out = [];
  const step = Math.max(1, Math.round(list.length / (extra.length + 1)));
  let ei = 0;
  for (let k = 0; out.length < list.length + extra.length; k++) {
    if (ei < extra.length && k > 0 && k % step === 0) { out.push(extra[ei++]); continue; }
    if (rest.length) out.push(rest.shift());
    else if (ei < extra.length) out.push(extra[ei++]);
    else break;
  }
  return { items: out.slice(0, list.length), added: extra.length, short: extra.length < need };
}

// ── 해외 글 첫 화면 하한 (5.7 B단계, 2026-08-08)
//
// 해외 RSS는 추천·댓글 수치가 없어 hotScore의 속도 보너스(ingest.js vel)를
// 태생적으로 못 받는다 — 설계 워크플로 실측: 풀 지분 ~5%인데 홈 첫 20칸에서
// 19번째 1건. David 2026-08-07: "지금 리스트에 해외게 진짜 잘 안보이네."
// 점수를 lane별로 재정규화하는 안은 적대적 검수가 기각했다(측정된 반응이
// 무측정 순위를 이긴다는 확정 결정을 되돌린다). 위 헤더의 X
// AuthorDiversityFloor와 같은 발상으로 **하한만** 둔다 — 바닥은 있되,
// 그 위는 점수 경쟁 그대로.
export const FOREIGN_MIN_SHARE = 0.1; // 첫 화면에서 해외 글 최소 지분 (10칸에 1건)
export const FOREIGN_WINDOW = 20;     // 하한을 계산하는 최대 창

// 해외 글 판정 — engine.js 번역 안내가 쓰는 기준 그대로(번역됐거나, 번역
// 대상이거나, 원문 언어가 한국어가 아닌 글).
export function isForeignItem(i) {
  return Boolean(i && (i.translated === true || i.needsTranslation === true ||
    (i.originalLang && i.originalLang !== "ko")));
}

// list 앞쪽(사용자가 실제로 보는 첫 화면 = 페이지 크기)에 해외 글이 최소
// 지분에 못 미치면 채운다. 검수 라운드2가 잡은 두 결함을 반영한 형태다:
// (1) 창은 페이지 크기에 맞춘다 — 고정 20칸 창은 페이지 10칸 클라이언트에서
//     삽입 글이 다음 페이지로 밀렸고, 개인화 경로(selectDiverse가 이미 limit로
//     자른 목록)에서는 "목록이 창보다 짧으면 무시" 조건 탓에 아예 발화하지
//     않았다.
// (2) 밀어내지 않고 **스왑/교체**한다 — splice 삽입은 창 끝에 있던 기존 해외
//     글을 창 밖으로 밀어내 하한을 자기 손으로 깼다(off-by-one 실측).
//
// 후보는 두 층: ① 목록 뒤쪽의 해외 글(이미 순위 경쟁을 거침 — 자리를 맞바꿔
// 끌어올린다) ② pool(관문 통과 목록)의 해외 글 — 그 자리 글과 교체하고,
// 밀려난 글은 이번 응답에서 빠질 뿐 seen에 안 찍혀 다음 페이지에 다시 온다
// (ensureTasteShare의 slice-드롭과 같은 관례). 어느 쪽이든 길이가 보존된다.
// 재료가 없으면 있는 만큼만 — 없는 것을 만들지 않는다.
export function ensureForeignShare(
  list, pool,
  { is = isForeignItem, idOf, avoid, window = FOREIGN_WINDOW, minShare = FOREIGN_MIN_SHARE } = {}
) {
  if (!Array.isArray(list) || !list.length) return { items: list || [], moved: 0 };
  const win = Math.min(window, list.length);
  // 창이 아주 짧으면(풀 소진 근처) 하한을 접는다 — 3칸에 1건을 강제하면
  // 지분(10%)의 세 배가 되어 버린다. rank.js 완화 사다리와 같은 발상.
  if (win < 5) return { items: list, moved: 0 };
  const minCount = Math.max(1, Math.floor(win * minShare));
  const out = list.slice();
  const foreignAt = new Set();
  for (let i = 0; i < win; i++) if (is(out[i])) foreignAt.add(i);
  let need = minCount - foreignAt.size;
  if (need <= 0) return { items: list, moved: 0 };

  const id = idOf || ((x) => x && x.id);
  const inList = new Set(out.map(id));
  const donors = [];
  for (let i = win; i < out.length && donors.length < need; i++) {
    if (is(out[i])) donors.push({ tail: i });
  }
  for (const p of pool || []) {
    if (donors.length >= need) break;
    if (is(p) && !inList.has(id(p))) donors.push({ ext: p });
  }
  if (!donors.length) return { items: list, moved: 0 };

  // 자리: 창 안의 비해외 칸을 고르게 — 1위 칸은 점수 경쟁 결과를 존중해 두고,
  // 해외 글 옆자리는 되도록 피한다(라운드로빈이 만든 소스 간격 존중).
  // avoid로 표시된 칸(딜 지분 등 다른 보장이 잡은 자리)도 건드리지 않는다 —
  // 두 지분 보장이 같은 균등 분산 공식을 쓰므로 회피 없이는 정확히 같은
  // 칸을 노려 서로를 밀어낸다(검수 라운드3 실측).
  const taken = new Set();
  const pick = (want) => {
    let best = -1, bestD = Infinity, bestAdj = true;
    for (let s = 1; s < win; s++) {
      if (taken.has(s) || foreignAt.has(s)) continue;
      if (avoid && avoid(out[s])) continue;
      const adj = foreignAt.has(s - 1) || foreignAt.has(s + 1);
      const d = Math.abs(s - want);
      if ((adj === false && bestAdj === true) || (adj === bestAdj && d < bestD)) {
        best = s; bestD = d; bestAdj = adj;
      }
    }
    return best;
  };
  const step = Math.max(2, Math.floor(win / (donors.length + 1)));
  let moved = 0;
  donors.forEach((d, k) => {
    const slot = pick(Math.min(win - 1, step * (k + 1)));
    if (slot < 0) return;
    taken.add(slot);
    foreignAt.add(slot);
    if (d.tail != null) {
      const t = out[slot]; out[slot] = out[d.tail]; out[d.tail] = t;
    } else {
      out[slot] = d.ext;
    }
    moved += 1;
  });
  return { items: out, moved };
}

// 한 카테고리가 상한을 넘으면 뒤로 민다. 지우지 않는다 — 길이가 줄면
// 무한 스크롤이 끊긴다(2026-08-06 딜 상한에서 실제로 겪은 회귀).
export function capOneCategory(list, { maxShare = TASTE_MAX_SHARE } = {}) {
  if (!Array.isArray(list) || list.length < 5) return list;
  const limit = Math.floor(list.length * maxShare);
  const seen = new Map();
  const front = [];
  const back = [];
  for (const it of list) {
    const c = (it && it.category) || "?";
    const n = (seen.get(c) || 0) + 1;
    seen.set(c, n);
    if (n > limit) back.push(it);
    else front.push(it);
  }
  return front.concat(back);
}
