// 우리만 가진 데이터로 쓰는 글 (블루프린트 P0-A ④).
//
// ── 왜 이 파일이 있나
// 애드핏 4차 반려: "자체 콘텐츠가 아닌 외부 콘텐츠, 외부 링크가 많은 비중을
// 차지하고 있는 매체는 광고게재가 허용되지 않습니다." ③①⑤로 화면의 자체 비중을
// 올렸지만, 그 셋은 전부 **남의 글을 재료로 쓴다**. 여기서 만드는 글은 재료부터
// 우리 것이다 — 남의 글이 하나도 없어도 성립한다.
//
// 재료는 우리가 매일 만들고 있다. 일별 에디션(브리핑+랭킹 스냅샷), 열기 눈금
// 시계열, 소스별 진입 기록. **어느 원문에도 없는 값**이고, 여러 커뮤니티를
// 동시에 오래 봐야만 생기는 값이다. 그래서 이 글은 복제가 아니라 생산이다.
//
// ── 설계 원칙 (digest.js·editorial.js와 같은 선)
// 1. **LLM을 부르지 않는다.** 같은 입력에 같은 글이 나와야 검증할 수 있다.
// 2. **없는 숫자를 만들지 않는다.** 모든 자릿수는 실측에서 유도된다. 표본이
//    모자라면 그 문단을 통째로 뺀다 — 그럴듯한 문장보다 빈자리가 낫다.
// 3. **표본 수를 숨기지 않는다.** "게임이 가장 오래 간다(5건)"에서 (5건)을
//    빼면 같은 문장이 거짓말이 된다.
// 4. **남의 문장을 쓰지 않는다.** 제목은 인용부호 안에서 출처와 함께만 쓴다.
//
// ── 그림도 우리가 그린다
// 차트는 우리 데이터로 우리가 그린 SVG다(chart.js). 저작권이 100% 우리 것이라
// 공유 카드에도 그대로 쓸 수 있다.

import { sourceLabel as lookupSourceLabel } from "./taxonomy.js";
import { loadRegistry } from "./registry.js";

// 카테고리 한글 이름 — 화면 여러 곳에서 쓰는 것과 같은 말을 쓴다.
const CAT_KO = {
  news: "뉴스", tech: "IT·기술", humor: "유머", culture: "문화",
  business: "경제", life: "생활", sports: "스포츠", gaming: "게임",
  auto: "자동차", politics: "정치", science: "과학", food: "음식"
};
export const catKo = (k) => CAT_KO[k] || k;

// 이 글에 올리지 않는 것.
//
// 정치는 카테고리로 걸린다. **성인은 카테고리로 안 걸린다** — 검수(2026-08-06)가
// 잡은 것: 공식 카테고리 목록(taxonomy.js)에 adult도 religion도 없고, 성인 소스
// 3곳은 카테고리가 humor·life·culture이며 `adult: true`라는 별도 플래그로만
// 표시된다. OFF 세트에 "adult"를 넣어 둔 것은 **아무것도 막지 않는 죽은 코드**였다.
//
// 지금 안 새는 이유는 이 필터가 아니라 그 3곳이 enabled:false라 수집 자체가
// 안 되기 때문이다. 그건 언제든 바뀔 수 있는 설정이고, 바뀌는 순간 애드핏
// 심사자가 보는 페이지에 성인 커뮤니티 이름이 실린다. 소스 플래그로 직접 건다.
const OFF_CAT = new Set(["politics", "religion"]);
let adultSourceCache = null;
function adultSources() {
  if (!adultSourceCache) {
    adultSourceCache = new Set(loadRegistry().filter((c) => c.adult === true).map((c) => c.id));
  }
  return adultSourceCache;
}
const excluded = (i) =>
  !i || OFF_CAT.has(i.category) || i.adult === true ||
  (Array.isArray(i.topics) && i.topics.some((t) => OFF_CAT.has(t))) ||
  adultSources().has(i.source);

// ---------------------------------------------------------------------------
// 1) 주간 커뮤니티 지형 — 일별 랭킹 스냅샷에서
// ---------------------------------------------------------------------------
//
// 우리는 매일 그날의 화제 랭킹을 저장한다. 며칠치를 겹쳐 보면 "이번 주에 어느
// 커뮤니티가 화제를 만들었나"가 나온다. 하루만 봐서는 절대 안 보이는 값이다.

export function weeklyLandscape(editions, { days = 7 } = {}) {
  const list = (editions || [])
    .filter((e) => e && e.date && e.ranking && Array.isArray(e.ranking.items))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-days);
  if (!list.length) return null;

  const itemsOf = (e) => e.ranking.items.filter((i) => !excluded(i));
  const bySource = new Map();
  const byCategory = new Map();
  let total = 0;
  for (const e of list) {
    for (const i of itemsOf(e)) {
      total += 1;
      const key = i.source || "unknown";
      const cur = bySource.get(key) || { key, label: i.sourceLabel || lookupSourceLabel(key) || key, count: 0, days: new Set() };
      cur.count += 1;
      cur.days.add(e.date);
      bySource.set(key, cur);
      byCategory.set(i.category, (byCategory.get(i.category) || 0) + 1);
    }
  }
  if (!total) return null;

  // 앞뒤 절반을 갈라 증감을 본다. 홀수 날이면 가운데 하루는 어느 쪽에도 넣지
  // 않는다 — 같은 하루를 양쪽에 세면 증감이 부풀려진다.
  const half = Math.floor(list.length / 2);
  const countIn = (sub) => {
    const m = new Map();
    for (const e of sub) for (const i of itemsOf(e)) m.set(i.source, (m.get(i.source) || 0) + 1);
    return m;
  };
  const early = countIn(list.slice(0, half));
  const late = countIn(list.slice(list.length - half));
  const movers = [];
  if (half >= 2) {
    for (const key of new Set([...early.keys(), ...late.keys()])) {
      const delta = (late.get(key) || 0) - (early.get(key) || 0);
      if (!delta) continue;
      const s = bySource.get(key);
      movers.push({ key, label: (s && s.label) || key, delta, early: early.get(key) || 0, late: late.get(key) || 0 });
    }
    movers.sort((a, b) => b.delta - a.delta);
  }

  const sources = [...bySource.values()]
    .map((s) => ({ key: s.key, label: s.label, count: s.count, days: s.days.size }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  const categories = [...byCategory.entries()]
    .map(([key, count]) => ({ key, label: catKo(key), count, share: count / total }))
    .sort((a, b) => b.count - a.count);

  return {
    from: list[0].date,
    to: list[list.length - 1].date,
    dayCount: list.length,
    total,
    sources,
    categories,
    movers,
    // 증감을 말할 수 있는가 — 앞뒤 절반이 각각 이틀 이상이어야 한다.
    // 하루 대 하루 비교는 그날의 우연을 추세로 둔갑시킨다.
    comparable: half >= 2
  };
}

// ---------------------------------------------------------------------------
// 2) 열기 곡선 — 화제가 언제 몰리는가
// ---------------------------------------------------------------------------
//
// 열기 눈금(heatHist)은 수집 사이클마다 우리가 재 온 시계열이다. 증가분이
// 앞쪽에 몰렸으면 터지고 식은 글, 뒤로 갈수록 붙었으면 천천히 오래 간 글이다.
//
// **눈금이지 조회수가 아니다.** 문장에서도 그렇게 쓴다 — "몇 명이 봤다"고 쓰면
// 그건 우리가 재지 않은 값이다.

export function heatShape(rows, { minSteps = 5, minTotal = 30, minPerCat = 5 } = {}) {
  const scored = [];
  for (const row of rows || []) {
    const h = row && row.heatHist;
    const item = (row && row.item) || null;
    if (!item || !Array.isArray(h) || h.length < minSteps) continue;
    if (excluded(item)) continue;
    // 중간에 떨어지는 시계열은 **버린다.**
    //
    // 열기 눈금은 그 글의 공개 반응 수치에서 나온다. 상대 서버가 잠깐 응답을
    // 못 주면 그 회차만 0으로 찍히는데(실측 2026-08-06: 1,609건 중 26건이
    // 0으로 떨어졌고 예시가 [250,250,250,250,250,0,0,…]), 그 뒤 값이 돌아오면
    // **0→250이 새 상승분으로 잡힌다.** 실제로는 아무 일도 없었는데 큰 상승이
    // 생기고, 그게 하필 "가장 빨리 뜬 글" 1위로 올라온다(실제로 그랬다).
    //
    // 고쳐 쓰는 대신 버린다. 98%가 단조 증가라 2%를 빼도 표본이 충분하고,
    // 결측을 메우면 그 순간부터 "우리가 만든 값"이 섞인다.
    let sane = true;
    for (let k = 1; k < h.length; k++) if ((h[k] || 0) < (h[k - 1] || 0)) { sane = false; break; }
    if (!sane) continue;
    const steps = [];
    for (let k = 1; k < h.length; k++) steps.push(Math.max(0, (h[k] || 0) - (h[k - 1] || 0)));
    const sum = steps.reduce((a, b) => a + b, 0);
    if (sum < minTotal) continue;
    const half = Math.ceil(steps.length / 2);
    const front = steps.slice(0, half).reduce((a, b) => a + b, 0);
    scored.push({
      id: item.id,
      title: item.title,
      source: item.source,
      sourceLabel: item.sourceLabel || lookupSourceLabel(item.source) || item.source,
      category: item.category,
      frontPct: Math.round((front / sum) * 100),
      steps: steps.length,
      // 시계열 자체를 들고 간다 — 그림으로 그려야 "모양"이 보인다.
      series: h.slice(),
      rise: sum
    });
  }
  if (!scored.length) return null;

  const byCat = new Map();
  for (const s of scored) {
    const cur = byCat.get(s.category) || [];
    cur.push(s.frontPct);
    byCat.set(s.category, cur);
  }
  const categories = [...byCat.entries()]
    // 표본이 적으면 평균이 한두 건에 끌려간다. 아예 빼는 편이 정직하다.
    .filter(([, v]) => v.length >= minPerCat)
    .map(([key, v]) => ({
      key, label: catKo(key), n: v.length,
      frontPct: Math.round(v.reduce((a, b) => a + b, 0) / v.length)
    }))
    .sort((a, b) => b.frontPct - a.frontPct);

  const sorted = [...scored].sort((a, b) => b.frontPct - a.frontPct);
  return {
    n: scored.length,
    categories,
    all: scored,
    fastest: sorted.slice(0, 3),
    slowest: sorted.slice(-3).reverse()
  };
}

// ---------------------------------------------------------------------------
// 3) 글로 만든다
// ---------------------------------------------------------------------------
//
// 데이터의 모양이 다르면 문장도 달라야 한다(digest.js 원칙 3). 여기서도
// 표본이 얇으면 문단이 통째로 빠지므로, 날마다 같은 글이 나오지 않는다.

const pct = (x) => `${Math.round(x * 100)}%`;
const num = (n) => Number(n).toLocaleString("ko-KR");

// 조사 — 받침에 따라 갈린다. 자동 생성 글에서 "유머은"이 나오면 그 한 글자가
// 글 전체를 기계가 쓴 것으로 만든다. 애드핏 심사자가 보는 화면이라 더 그렇다.
//
// 한글 음절은 (코드 - 0xAC00) % 28 이 0이 아니면 받침이 있다. 숫자로 끝나면
// 읽는 소리로 판단한다(1·3·6·7·8·0은 받침 있음 — 일·삼·육·칠·팔·영).
// %는 "퍼센트"로 읽히므로 받침이 없다.
function hasBatchim(word) {
  const w = String(word || "").trim();
  if (!w) return false;
  const last = w[w.length - 1];
  if (last === "%") return false;
  if (/[0-9]/.test(last)) return "1368".includes(last) || last === "0";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return false;   // 영문·기호는 받침 없는 쪽으로 — 틀려도 어색함이 덜하다
}
const josa = (word, withB, withoutB) => `${word}${hasBatchim(word) ? withB : withoutB}`;

export function landscapeParagraphs(L) {
  if (!L) return [];
  const out = [];
  const top = L.sources[0];
  const top3 = L.sources.slice(0, 3);

  // 결론 문장은 **실제 분포를 보고** 고른다. 예전엔 무조건 "독식하는 구조는
  // 아니다"를 붙였다 — 소스가 1곳이어도 그렇게 썼다(검수 2026-08-06 P0).
  // "나온 곳은 1곳이다"와 "독식하는 구조는 아니다"가 한 문장 안에서 모순된다.
  const topShare = top ? top.count / L.total : 0;
  const verdict = L.sources.length <= 2
    ? `표본이 나온 곳이 그만큼 적어, 분포를 말하기는 이르다.`
    : topShare >= 0.4
      ? `한 곳이 ${pct(topShare)}를 차지해, 사실상 몇 곳이 화제를 만드는 주다.`
      : topShare >= 0.25
        ? `가장 많은 곳이 ${pct(topShare)}로, 쏠림이 어느 정도 보인다.`
        : `특정 커뮤니티가 화제를 독식하는 구조는 아니다.`;
  out.push(
    `${L.from}부터 ${L.to}까지 ${L.dayCount}일 동안 지금핫 화제 랭킹에 오른 글은 ` +
    `모두 ${num(L.total)}건이고, 나온 곳은 ${num(L.sources.length)}곳이다. ` +
    `한 곳이 평균 ${(L.total / L.sources.length).toFixed(1)}건을 올린 셈이다. ${verdict}`
  );

  if (top && top3.length >= 3) {
    const share3 = top3.reduce((a, s) => a + s.count, 0) / L.total;
    // **숫자와 모순되는 문장을 쓰지 않는다.** 상위 세 곳이 75%인데
    // "넓게 흩어져 있다"고 쓰면 그 한 줄이 글 전체를 못 믿게 만든다.
    const tail = share3 > 0.5
      ? `${pct(share3)}로 절반이 넘는다 — 화제가 이 몇 곳에서 나온 주다.`
      : share3 >= 0.5
        ? `${pct(share3)}로 정확히 절반이다.`
        : share3 >= 0.3
          ? `${pct(share3)}로, 3분의 1은 넘지만 절반에는 못 미친다.`
        : `${pct(share3)}에 그친다. 나머지는 넓게 흩어져 있다.`;
    out.push(
      `가장 많이 오른 곳은 ${top.label}(${num(top.count)}건, ${L.dayCount}일 중 ${top.days}일)이다. ` +
      `그다음은 ${top3.slice(1).map((s) => `${s.label} ${num(s.count)}건`).join(", ")}. ` +
      `상위 세 곳을 합치면 전체의 ${tail}`
    );
  }

  const c0 = L.categories[0];
  if (c0) {
    const named = L.categories.slice(0, 4).map((c) => `${c.label} ${pct(c.share)}`).join(" · ");
    // 100%를 "3분의 1 가까이"라고 쓰던 자리다(검수 2026-08-06 P1).
    // 과장이든 과소진술이든 숫자를 배반하는 것은 같다.
    const cv = c0.share >= 0.8
      ? `${c0.label} 하나가 ${pct(c0.share)}로 이 주를 통째로 가져갔다.`
      : c0.share >= 0.5
        ? `${c0.label} 하나가 ${pct(c0.share)}로 절반을 넘는다.`
        : c0.share >= 0.3
          ? `${c0.label} 하나가 ${pct(c0.share)}로 3분의 1을 넘는다.`
          : `한 분야가 지배하지 않고 고르게 퍼진 주다.`;
    out.push(`분야는 ${named}로 갈렸다. ${cv}`);
  }

  if (L.comparable && L.movers.length) {
    const up = L.movers.filter((m) => m.delta > 0).slice(0, 3);
    const down = L.movers.filter((m) => m.delta < 0).slice(-3).reverse();
    const bits = [];
    if (up.length) bits.push(`늘어난 곳은 ${up.map((m) => `${m.label} +${m.delta}`).join(", ")}`);
    if (down.length) bits.push(`줄어든 곳은 ${down.map((m) => `${m.label} ${m.delta}`).join(", ")}`);
    if (bits.length) {
      out.push(
        `기간을 앞뒤로 갈라 보면 ${bits.join("이고, ")}이다. ` +
        `며칠 단위 변화라 계절적 흐름이라기보다 그 주에 무슨 일이 있었는지를 보여 준다.`
      );
    }
  }
  return out;
}

export function heatParagraphs(H) {
  if (!H || !H.categories.length) return [];
  const out = [];
  const hot = H.categories[0];
  const slow = H.categories[H.categories.length - 1];

  out.push(
    `화제가 언제 몰리는지는 분야마다 다르다. 지금핫은 수집할 때마다 글의 열기 눈금을 ` +
    `다시 재는데, 그 증가분이 앞쪽에 몰렸으면 터지고 식은 글이고 뒤로 갈수록 붙었으면 ` +
    `천천히 오래 간 글이다. 눈금이 ${H.n}건에서 충분히 쌓였다.`
  );

  // 두 끝의 차이가 없으면 대비시키지 않는다. 같은 값을 "가장"과 "반대편"으로
  // 부르는 문장은 데이터가 아니라 틀에서 나온 것이고, 읽는 사람이 먼저 안다.
  const GAP_MIN = 10;   // %p
  if (hot && slow && hot.key !== slow.key && hot.frontPct - slow.frontPct >= GAP_MIN) {
    out.push(
      `가장 앞쪽에 몰리는 분야는 ${josa(hot.label, "이", "가")} ${hot.frontPct}%로(${hot.n}건), ` +
      `반대편은 ${josa(slow.label, "이", "가")} ${slow.frontPct}%다(${slow.n}건). ` +
      `${josa(hot.label, "은", "는")} 뜨자마자 반응이 몰리고 금방 잦아드는 반면, ` +
      `${josa(slow.label, "은", "는")} 하루가 지나서도 붙는다는 뜻이다.`
    );
  } else if (H.categories.length >= 2) {
    out.push(
      `이번 기간에는 분야 사이의 차이가 크지 않았다 — ` +
      `${H.categories.map((c) => `${c.label} ${c.frontPct}%(${c.n}건)`).join(", ")}로, ` +
      `어느 분야가 특별히 빨리 식는다고 말하기는 이르다.`
    );
  }
  return out;
}

// 3) 한 글의 열기가 어떻게 올랐나 (레퍼런스: hnrankings.info)
//
// 그림 하나와 규칙으로 만든 캡션 한둘. 해석을 지어내지 않는다 —
// "왜" 그랬는지는 우리가 잰 값이 아니다.
export function curveSection(H) {
  if (!H || !H.all || !H.all.length) return null;
  // **모양이 보이는 글**을 고른다. 상승분이 100% 전반부에 몰린 글을 그리면
  // 그림이 사실상 계단 하나라, "이렇게 오른다"는 제목과 그림이 어긋난다
  // (배포 후 실측 2026-08-06: 처음엔 그런 글이 뽑혔다).
  // 서로 다른 눈금값이 많을수록 변화를 여러 번 잡은 것이다.
  const shapeOf = (s) => new Set(s.series || []).size;
  const pick = [...H.all]
    .filter((s) => Array.isArray(s.series) && s.series.length >= 5 && shapeOf(s) >= 4)
    .sort((a, b) => shapeOf(b) - shapeOf(a) || b.rise - a.rise)[0];
  if (!pick) return null;
  const first = pick.series[0];
  const last = pick.series[pick.series.length - 1];
  if (!(last > first)) return null;
  return {
    id: "curve",
    heading: "한 글의 열기는 이렇게 오른다",
    paragraphs: [
      `아래는 ${pick.sourceLabel}의 “${pick.title}”가 우리 수집 사이클마다 어떤 열기 눈금을 ` +
      `기록했는지 그린 것이다. ${pick.steps + 1}번 재는 동안 ${first}에서 ${last}까지 올랐고, ` +
      `상승분의 ${pick.frontPct}%가 전반부에 나왔다.`,
      `이 곡선은 원문 어디에도 없다. 우리가 그 글을 계속 지켜보며 잰 값이라 그렇다.`
    ],
    chart: { type: "line", title: "수집 회차별 열기 눈금", series: pick.series }
  };
}

// 한 편을 통째로 만든다. 재료가 모자라면 publishable=false — 알맹이 없는 글을
// 발행하는 것은 자체 콘텐츠가 아니라 오히려 감점이다(브리핑과 같은 규칙).
export function buildReport({ editions = [], rows = [], days = 7 } = {}) {
  const landscape = weeklyLandscape(editions, { days });
  const heat = heatShape(rows);
  const sections = [];

  const lp = landscapeParagraphs(landscape);
  if (lp.length) {
    sections.push({
      id: "landscape",
      heading: "이번 주 커뮤니티 지형",
      paragraphs: lp,
      chart: landscape
        ? { type: "bars", title: "커뮤니티별 화제 랭킹 진입 수",
            rows: landscape.sources.slice(0, 10).map((s) => ({ label: s.label, value: s.count })) }
        : null
    });
  }
  const hp = heatParagraphs(heat);
  if (hp.length) {
    sections.push({
      id: "heat",
      heading: "어느 분야가 빨리 식는가",
      paragraphs: hp,
      chart: heat
        ? { type: "bars", title: "분야별 전반부 집중도 (%)", unit: "%",
            rows: heat.categories.map((c) => ({ label: `${c.label} (${c.n}건)`, value: c.frontPct })) }
        : null
    });
  }

  const cs = curveSection(heat);
  if (cs) sections.push(cs);

  // 두 절 다 없으면 글이 아니다.
  const publishable = sections.length >= 1 && !!landscape;
  return {
    publishable,
    from: landscape ? landscape.from : null,
    to: landscape ? landscape.to : null,
    dayCount: landscape ? landscape.dayCount : 0,
    title: landscape
      ? `지금핫 데이터 리포트 · ${landscape.from} ~ ${landscape.to}`
      : "지금핫 데이터 리포트",
    lead: landscape
      ? `커뮤니티·뉴스 ${num(landscape.sources.length)}곳에서 ${landscape.dayCount}일 동안 모은 ` +
        `화제 랭킹 ${num(landscape.total)}건을 지금핫이 직접 집계했습니다. ` +
        `남의 글을 옮기지 않고, 우리가 잰 수치만으로 씁니다.`
      : "",
    sections,
    landscape,
    heat
  };
}
