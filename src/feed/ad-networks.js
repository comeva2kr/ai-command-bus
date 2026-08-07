// 광고 연결 현황 — 관리자 광고 탭의 데이터 원천.
//
// ── 왜 (David 2026-08-05)
// "관리자 페이지에 광고 메뉴 신설해서 나랑 연결되어 있는 광고와 붙일 수 있는
//  광고들 리스트로 만들어서 관리할 수 있으면 좋겠네. 연동해서 수입까지 나오면 더 좋고."
//
// ── 이 파일이 지키는 것: 지어내지 않는다
// 광고 화면은 돈을 판단하는 자리라 거짓 숫자 하나가 제일 비싸다. 그래서
//   · 연결 여부는 **환경변수가 실제로 있는지**로만 말한다
//   · 노출·클릭은 **우리가 실제로 센 값**만 쓴다
//   · 정산 금액은 **연동된 곳이 하나도 없으므로 비워 둔다.** 추정치를 넣지 않는다
// 승인 상태처럼 우리가 알 수 없는 것은 "우리 쪽 설정" 여부만 말하고
// 심사 결과는 각 콘솔에서 보도록 링크를 준다.
//
// ── 시크릿은 값을 내보내지 않는다
// David 원칙: 자격증명은 화면으로 옮기지 않는다. 여기서는 **있다/없다**만
// 판정하고 값 자체는 응답에 담지 않는다.

// 지금 코드에 배선이 들어가 있는 곳. 새 네트워크를 붙이면 여기에 한 줄 는다.
export const WIRED_NETWORKS = [
  {
    id: "adsense",
    label: "구글 애드센스",
    kind: "display",
    envKeys: ["ADSENSE_CLIENT"],
    placements: ["발행 페이지(브리핑·랭킹·커뮤니티·키워드)", "홈 <head> 로더"],
    console: "https://adsense.google.com/",
    revenueApi: "가능 — AdSense Management API(OAuth 필요)",
    note: "소유권 확인은 코드 스니펫과 ads.txt 두 가지로 이미 통과. 남은 것은 콘텐츠 정책 심사다."
  },
  {
    id: "adfit",
    label: "카카오 애드핏",
    kind: "display",
    envKeys: ["ADFIT_UNIT_MOBILE"],
    // 승인 전에는 지면을 그리지 않는다 — 보류 상태의 애드핏은 onfail도 부르지
    // 않으면서 아무것도 안 보여줘서 빈 칸만 남는다(2026-08-04 실측).
    enabledKey: "ADFIT_ENABLED",
    placements: ["앱 피드(첫 광고 6번째 카드 뒤)", "발행 페이지"],
    console: "https://adfit.kakao.com/",
    revenueApi: "없음 — 정산액은 콘솔에서 보고 손으로 입력한다",
    note: "매체 심사 2차 보류(2026-08-04). 사유 둘 다 처리 후 재심사 대기."
  },
  {
    id: "coupang",
    label: "쿠팡 파트너스",
    kind: "affiliate",
    envKeys: ["COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY"],
    optionalKeys: ["COUPANG_SUB_ID"],
    placements: ["앱 피드 제휴 카드", "상세 화면", "발행 페이지 배너"],
    console: "https://partners.coupang.com/",
    revenueApi: "가능 — 실적 조회 API(별도 승인 필요)",
    note: "키가 없으면 수동 배너 목록으로 돌아간다. 대가성 문구는 모든 지면에 붙는다."
  }
];

// 아직 안 붙였지만 붙일 수 있는 곳. **요율은 적지 않는다** — 수시로 바뀌고,
// 틀린 숫자를 근거로 결정하면 그게 더 비싸다. 무엇이 필요한지만 적는다.
export const CANDIDATE_NETWORKS = [
  {
    id: "gam",
    label: "구글 애드매니저 (GAM)",
    kind: "exchange",
    fit: "1순위",
    why: "레퍼런스 넷이 **전부** 이걸 쓴다(2026-08-05 실측). 여러 네트워크를 한 자리에서 경쟁시켜 매 노출마다 가장 비싸게 사는 곳을 고른다. 애드센스 하나만 붙이면 그 경매가 없어 단가가 낮게 고정된다.",
    needs: "무료. 다만 **애드센스 승인이 먼저**다 — 애드센스를 GAM 안에 넣어 다른 수요와 경쟁시키는 구조라서.",
    revenueApi: "가능 — Ad Manager API",
    checkedAt: "2026-08-05"
  },
  {
    id: "adop",
    label: "애드옵 (ADOP)",
    kind: "mediation",
    fit: "트래픽 성장 후",
    why: "이토랜드가 쓰는 방식. 해외 수요(PubMatic·Rubicon·AppNexus 등)를 대신 물려 주고 수익을 나눈다. 혼자 200곳과 계약할 수 없으니 이게 현실적인 길이다.",
    needs: "**입점 조건이 공개돼 있지 않다**(2026-08-05 확인). 웹 퍼블리셔 문의는 contact@adop.cc. 대행사는 보통 최소 트래픽 기준이 있어, 하루 30~130명인 지금은 거절 가능성이 크다.",
    revenueApi: "확인 필요 — 문의 시 함께 물어볼 것",
    checkedAt: "2026-08-05"
  },
  {
    id: "linkprice",
    label: "링크프라이스",
    kind: "affiliate",
    fit: "딜 섹션과 함께",
    why: "쿠팡이 약한 여행·금융·교육·해외직구 광고주가 있다. **노출이 아니라 구매로 버는 쪽**이라 트래픽이 적어도 성립한다 — 지금 조건에서 유일하게 말이 되는 경로다.",
    needs: "**가입 조건이 공개돼 있지 않다**(2026-08-05 확인, 회사 소개 페이지에 명시 없음). 제휴마케팅 신청 페이지에서 직접 문의해야 하고, 광고주마다 개별 승인이 필요한 구조로 알려져 있다 — 이 부분도 문의로 확인할 것.",
    revenueApi: "확인 필요",
    checkedAt: "2026-08-05"
  },
  {
    id: "criteo",
    label: "크리테오 등 리타게팅",
    kind: "display",
    fit: "트래픽 조건 미달",
    why: "월 방문이 일정 규모를 넘어야 심사를 받는다.",
    needs: "트래픽 성장 후 재검토",
    revenueApi: "가능",
    checkedAt: "2026-08-05"
  },
  {
    id: "naver-ad",
    label: "네이버 애드포스트",
    kind: "display",
    fit: "해당 없음",
    why: "네이버 블로그·카페 등 네이버 서비스 안에서만 쓴다. 외부 사이트는 대상이 아니다.",
    needs: "—",
    revenueApi: "—",
    checkedAt: "2026-08-05"
  },
  {
    id: "direct",
    label: "직접 판매(배너 직거래)",
    kind: "direct",
    fit: "트래픽 성장 후",
    why: "중개 수수료가 없어 단가가 가장 높다. 광고주를 우리가 구해야 한다.",
    needs: "매체 소개서 + 실측 트래픽 자료. 발행 페이지 측정을 붙이면서 그 자료가 만들어지기 시작했다.",
    revenueApi: "직접 정산",
    checkedAt: "2026-08-05"
  }
];

// ── 레퍼런스 실측 (2026-08-05, 각 사이트의 공개 ads.txt)
//
// David: "우리 레퍼런스로 잡은 서비스 업체들은 광고 어떻게 붙여서 돈 벌지."
// 기억으로 답하면 틀리므로 그들이 공개한 ads.txt를 직접 세었다. ads.txt는
// "이 회사들이 우리 지면을 팔 권한이 있다"를 매체가 스스로 공표하는 파일이라,
// 누구와 계약했는지가 그대로 적혀 있다.
//
// 결론: 그들은 광고를 **붙이는** 게 아니라 **경매에 부친다.** 한 자리에
// 수십~수백 개 네트워크를 물려 놓고 매 노출마다 가장 비싼 곳을 고른다.
// 우리는 구글 하나뿐이라 그 경매가 아예 없다.
export const REFERENCE_ADSTXT = [
  { site: "보배드림", partners: 963, companies: null, note: "GAM + 애널리틱스" },
  { site: "이토랜드", partners: 913, companies: 214, note: "GAM + 애드옵 + 쿠팡 파트너스", top: "PubMatic 78 · Rubicon 51 · Google 46 · AppNexus 45" },
  { site: "뽐뿌", partners: 210, companies: 66, note: "GAM + 애드센스", top: "Rubicon 20 · PubMatic 20 · AppNexus 13" },
  { site: "클리앙", partners: 54, companies: 26, note: "GAM", top: "Google 8 · OpenX 5 · AppNexus 5" },
  { site: "지금핫(우리)", partners: 1, companies: 1, note: "애드센스만", top: "Google 1" }
];

// 환경에서 연결 상태를 읽는다. **값은 담지 않는다** — 있다/없다만.
export function readWiredStatus(env = process.env) {
  return WIRED_NETWORKS.map((n) => {
    const missing = n.envKeys.filter((k) => !env[k]);
    const connected = missing.length === 0;
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      connected,
      missingKeys: missing,                       // 이름만. 값은 절대 담지 않는다
      optionalSet: (n.optionalKeys || []).filter((k) => Boolean(env[k])),
      // 승인 게이트가 따로 있는 곳(애드핏)은 그 플래그까지 봐야 실제 노출 여부를 안다
      serving: connected && (!n.enabledKey || env[n.enabledKey] === "1"),
      gateKey: n.enabledKey || null,
      placements: n.placements,
      console: n.console,
      revenueApi: n.revenueApi,
      note: n.note
    };
  });
}

// 실측 노출·클릭을 네트워크별로 가른다.
//
// 슬롯 이름이 세 갈래로 흩어져 있다(2026-08-05 전수검사 지적):
//   "feed6" 같은 자리 이름 · "cb_xxxx" 같은 상품 id · "detail"·"feed-passback"
// 지금 당장 통합하지는 않되, **어느 쪽이 애드핏이고 어느 쪽이 쿠팡인지**는
// 가를 수 있다 — 애드핏은 우리가 이벤트를 보내지 않는다(SDK가 자체 집계).
// 그래서 여기 잡히는 것은 전부 쿠팡 제휴 카드다. 그 사실을 숨기지 않고 밝힌다.
// 쿠팡 제휴 카드의 itemId는 monetize.js가 "cb_" 접두로 만든다.
// 그 외(우리 딜·카테고리 링크·애드핏 지면 등)는 쿠팡이 아니다.
const COUPANG_ITEM = /^cb_/;

export function splitMeasured(adEvents = [], sinceMs = 0) {
  // 예전엔 **모든 이벤트를 무조건 coupang 버킷에 넣었다.**
  // 주석은 "현재 우리가 세는 것은 쿠팡 카드뿐이다"라고 단언했는데,
  // 실측(2026-08-07 라이브)에서 itemId가 "feed16"인 클릭이 섞여 있었다 —
  // 전제가 깨졌는데 분류 코드는 그대로였다. unknown 버킷은 만들어 놓고
  // 한 번도 쓰지 않는 죽은 코드였다.
  //
  // 이 값이 쿠팡 콘솔 숫자와 비교되므로(David 2026-08-07: "쿠팡은 한 달
  // 13회인데 우리는 오늘만 15회") 쿠팡이 아닌 것을 쿠팡으로 세면 안 된다.
  const out = { coupang: { impressions: 0, clicks: 0 }, unknown: { impressions: 0, clicks: 0 } };
  for (const e of adEvents) {
    if (!e || !e.type) continue;
    const at = e.at ? Date.parse(e.at) : 0;
    if (sinceMs && !(at >= sinceMs)) continue;
    const bucket = COUPANG_ITEM.test(String(e.itemId || "")) ? out.coupang : out.unknown;
    if (e.type === "impression") bucket.impressions += 1;
    else if (e.type === "click") bucket.clicks += 1;
  }
  return out;
}

// 우리 숫자와 쿠팡 콘솔 숫자는 **원래 다르다.** 화면에서 그 이유를 밝히지
// 않으면 둘 중 하나가 틀린 것으로 읽힌다(David가 실제로 그렇게 읽었다).
// 지어낸 보정을 하지 않고 차이의 근거만 말한다.
export const MEASURE_CAVEATS = [
  "우리는 카드를 **누른 순간** 세고, 쿠팡은 쿠팡 페이지에 **도달한 것**을 셉니다. 누르고 바로 뒤로 가면 우리만 셉니다.",
  "쿠팡 콘솔은 집계가 하루 정도 늦습니다. 오늘 수치는 아직 반영 전입니다.",
  "개발·테스트 중 누른 것도 우리 숫자에는 들어갑니다.",
  "애드핏·애드센스는 각 SDK가 자체 집계하므로 이 숫자에 잡히지 않습니다."
];

export function ctr(impressions, clicks) {
  if (!impressions) return null;            // 0으로 나누지 않는다. 0%가 아니라 "모름"이다
  return Math.round((clicks / impressions) * 10000) / 100;
}

// ── 문구별 성과 (2026-08-05)
//
// David: "일주일에 한 번씩 업데이트 하면서 카테고리당 몇 개 만들어서
//         돌려쓸 수 있게 하는 거 어때? 더 좋은 의견 있어?"
//
// 좋다. 다만 **어떤 훅이 실제로 눌렸는지 모르면** 매주 새로 만들어도 나아지는지
// 알 수 없다 — 감으로 다시 만드는 것과 같다. 그래서 문구 id(dest_ctx_n)별로
// 노출·클릭을 세고, 다음 생성 때 잘 된 것을 본보기로 넘긴다.
//
// ── 클릭률만으로 1등을 뽑지 않는 이유
// 어그로가 세면 클릭은 늘지만 쿠팡은 **구매**로 정산된다. 헛클릭은 수익이 0인데
// 신뢰만 깎는다. 표본이 적을 때 클릭률 1등은 대개 우연이기도 하다.
// 그래서 **베이지안 축소**를 쓴다: 노출이 적으면 전체 평균 쪽으로 끌어당기고,
// 표본이 쌓일수록 자기 값에 가까워진다. 랭킹에서 쓰는 것과 같은 원리다.
const SHRINK_PRIOR = 30;   // 노출 30건까지는 전체 평균 쪽으로 끌어당긴다

export function variantPerformance(adEvents = [], { sinceMs = 0, prior = SHRINK_PRIOR } = {}) {
  const by = new Map();
  let totI = 0, totC = 0;
  for (const e of adEvents) {
    if (!e || !e.variant) continue;                 // 문구 id가 없는 옛 이벤트는 건너뛴다
    if (!/^[a-z]+_[a-z]+_\d+$/.test(e.variant)) continue;  // A/B 딱지("A")는 문구가 아니다
    const at = e.at ? Date.parse(e.at) : 0;
    if (sinceMs && !(at >= sinceMs)) continue;
    const r = by.get(e.variant) || { variant: e.variant, impressions: 0, clicks: 0 };
    if (e.type === "impression") { r.impressions += 1; totI += 1; }
    else if (e.type === "click") { r.clicks += 1; totC += 1; }
    by.set(e.variant, r);
  }
  const base = totI ? totC / totI : 0;
  return [...by.values()]
    .map((r) => ({
      ...r,
      raw: r.impressions ? r.clicks / r.impressions : null,
      // 축소된 값 — 이 값으로 순위를 매긴다
      score: (r.clicks + base * prior) / (r.impressions + prior)
    }))
    .sort((a, b) => b.score - a.score);
}

// 다음 생성에 넘길 본보기. 노출이 최소한 쌓인 것만 고른다 —
// 노출 3건짜리 100% 클릭률을 "잘 된 문구"라고 넘기면 다음 주가 더 나빠진다.
export function winningVariants(adEvents = [], matrix = null, { minImpressions = 20, top = 8 } = {}) {
  const perf = variantPerformance(adEvents).filter((v) => v.impressions >= minImpressions);
  if (!perf.length || !matrix || !matrix.variants) return [];
  const out = [];
  for (const v of perf.slice(0, top)) {
    const [dest, ctx, idx] = v.variant.split("_");
    const cell = matrix.variants[dest] && matrix.variants[dest][ctx];
    const item = Array.isArray(cell) ? cell[Number(idx)] : null;
    if (!item || !item.hook) continue;
    out.push({ dest, hook: item.hook, line: item.line || "", ctr: Math.round(v.score * 10000) / 100 });
  }
  return out;
}
