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
