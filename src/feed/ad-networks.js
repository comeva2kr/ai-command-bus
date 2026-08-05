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
    id: "linkprice",
    label: "링크프라이스",
    kind: "affiliate",
    fit: "보완재",
    why: "쿠팡이 약한 여행·금융·교육·해외직구 광고주가 있다. 겹치지 않는다.",
    needs: "가입 후 **광고주마다 개별 승인**. 손이 꽤 간다.",
    revenueApi: "제휴사 리포트 제공(가입 후 확인 필요)"
  },
  {
    id: "aceplanet",
    label: "애드픽 / 에이스카운터 계열",
    kind: "affiliate",
    fit: "보류",
    why: "앱 설치·이벤트형 캠페인 중심이라 우리 지면과 결이 다르다.",
    needs: "가입·캠페인 선택",
    revenueApi: "확인 필요"
  },
  {
    id: "criteo",
    label: "크리테오 등 리타게팅 네트워크",
    kind: "display",
    fit: "트래픽 조건 미달",
    why: "월 방문이 일정 규모를 넘어야 심사를 받는다. 지금 하루 30~130명으로는 이르다.",
    needs: "트래픽 성장 후 재검토",
    revenueApi: "가능"
  },
  {
    id: "naver-ad",
    label: "네이버 애드포스트",
    kind: "display",
    fit: "해당 없음",
    why: "네이버 블로그·카페 등 네이버 서비스 안에서만 쓴다. 외부 사이트는 대상이 아니다.",
    needs: "—",
    revenueApi: "—"
  },
  {
    id: "direct",
    label: "직접 판매(배너 직거래)",
    kind: "direct",
    fit: "트래픽 성장 후",
    why: "중개 수수료가 없어 단가가 가장 높다. 다만 광고주를 우리가 구해야 한다.",
    needs: "매체 소개서 + 실측 트래픽 자료. 지금 그 자료가 만들어지기 시작했다.",
    revenueApi: "직접 정산"
  }
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
export function splitMeasured(adEvents = [], sinceMs = 0) {
  const out = { coupang: { impressions: 0, clicks: 0 }, unknown: { impressions: 0, clicks: 0 } };
  for (const e of adEvents) {
    if (!e || !e.type) continue;
    const at = e.at ? Date.parse(e.at) : 0;
    if (sinceMs && !(at >= sinceMs)) continue;
    const bucket = out.coupang;             // 현재 우리가 세는 것은 쿠팡 카드뿐이다
    if (e.type === "impression") bucket.impressions += 1;
    else if (e.type === "click") bucket.clicks += 1;
  }
  return out;
}

export function ctr(impressions, clicks) {
  if (!impressions) return null;            // 0으로 나누지 않는다. 0%가 아니라 "모름"이다
  return Math.round((clicks / impressions) * 10000) / 100;
}
