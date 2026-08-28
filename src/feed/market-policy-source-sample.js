const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const SOURCE_META = {
  etoday: { publisher: "이투데이", ownershipGroup: "etoday" },
  "mk-news": { publisher: "매일경제", ownershipGroup: "maekyung" },
  hankyung: { publisher: "한국경제", ownershipGroup: "hankyung" },
  heraldbiz: { publisher: "헤럴드경제", ownershipGroup: "herald" },
  yna: { publisher: "연합뉴스", ownershipGroup: "yonhap" },
  chosunbiz: { publisher: "조선비즈", ownershipGroup: "chosun" },
  mt: { publisher: "머니투데이", ownershipGroup: "moneytoday" }
};

const reports = [
  {
    id: "MP-R01", desk: "macro", sourceId: "etoday",
    title: "고용보험 가입자 증가 폭 29개월 만에 최대",
    url: "https://www.etoday.co.kr/news/view/2612703",
    publishedAt: "2026-08-10T09:13:00.000Z", poolMatchCount: 1,
    selectionReason: "국내 고용과 고용보험 가입 흐름을 보여주는 거시 지표 보도"
  },
  {
    id: "MP-R02", desk: "macro", sourceId: "mk-news",
    title: "대출금리 양극화…대기업·중기 격차 최대",
    url: "https://www.mk.co.kr/news/economy/12123159",
    publishedAt: "2026-08-10T08:56:38.000Z", poolMatchCount: 1,
    selectionReason: "기업 규모별 신용비용 격차를 다룬 거시·금융 보도"
  },
  {
    id: "MP-R03", desk: "macro", sourceId: "hankyung",
    title: "자영업 코너 몰리고, 건설은 침체…트럭 '내수 빙하기'",
    url: "https://www.hankyung.com/article/2026081050611",
    publishedAt: "2026-08-10T10:00:05.000Z", poolMatchCount: 1,
    selectionReason: "내수와 건설 경기의 동행 변화를 다룬 산업·거시 보도"
  },
  {
    id: "MP-R04", desk: "macro", sourceId: "heraldbiz",
    title: "日, 상반기 역대 최대 경상수지 흑자…가계 소비는 ‘꽁꽁’",
    url: "https://biz.heraldcorp.com/article/10836088",
    publishedAt: "2026-08-10T05:04:15.000Z", poolMatchCount: 1,
    selectionReason: "일본 경상수지와 소비 흐름을 연결한 해외 거시 보도"
  },
  {
    id: "MP-R05", desk: "macro", sourceId: "hankyung",
    title: "美 국채금리 20년래 고점…AI투자·주택시장 압박",
    url: "https://www.hankyung.com/article/202608103646i",
    publishedAt: "2026-08-10T03:46:04.000Z", poolMatchCount: 1,
    selectionReason: "미국 장기금리와 실물 투자·주택의 연결 경로를 다룬 보도"
  },
  {
    id: "MP-R06", desk: "policy", sourceId: "yna",
    title: "정부, 피지컬 AI 구매 대폭 확대…로봇 생태계 키운다",
    url: "https://www.yna.co.kr/view/AKR20260810145500003",
    publishedAt: "2026-08-10T10:28:37.000Z", poolMatchCount: 1,
    selectionReason: "정부 수요 정책과 로봇 산업 생태계의 연결을 다룬 정책 보도"
  },
  {
    id: "MP-R07", desk: "policy", sourceId: "yna",
    title: "\"도금강판 반덤핑관세 과도\"…포스코, 일본 정부에 반박의견서",
    url: "https://www.yna.co.kr/view/AKR20260810143000003",
    publishedAt: "2026-08-10T09:58:55.000Z", poolMatchCount: 1,
    selectionReason: "무역구제 정책이 국내 기업에 미치는 영향을 다룬 보도"
  },
  {
    id: "MP-R08", desk: "policy", sourceId: "etoday",
    title: "靑 \"메가특구특별법 연내 제정…충청 246조·영남 107조 투자도 올해 시작\"",
    url: "https://www.etoday.co.kr/news/view/2612932",
    publishedAt: "2026-08-10T09:56:00.000Z", poolMatchCount: 1,
    selectionReason: "지역 투자와 특별법 일정을 함께 제시한 산업 정책 보도"
  },
  {
    id: "MP-R09", desk: "policy", sourceId: "chosunbiz",
    title: "정부, 1兆 규모 서남권 반도체 용수 사업 예타 면제 추진",
    url: "https://biz.chosun.com/policy/policy_sub/2026/08/10/CLQQCZDX4VAKLEY2OOIVR2LE5I/",
    publishedAt: "2026-08-10T09:44:42.000Z", poolMatchCount: 1,
    selectionReason: "반도체 인프라와 재정 절차의 변화를 다룬 정책 보도"
  },
  {
    id: "MP-R10", desk: "policy", sourceId: "chosunbiz",
    title: "한일 정부 ‘조선 담당 과장급 회의’ 7년 만에 부활 추진",
    url: "https://biz.chosun.com/policy/policy_sub/2026/08/10/FU3QXJAXUNE7PENIOXJLCJEQWM/",
    publishedAt: "2026-08-10T07:39:28.000Z", poolMatchCount: 1,
    selectionReason: "조선 산업 협력 채널의 정책 변화를 다룬 보도"
  },
  {
    id: "MP-R11", desk: "company", sourceId: "mt",
    title: "대만 TSMC, 7월 매출 45%↑…사상 최대 또 경신",
    url: "https://www.mt.co.kr/world/2026/08/10/2026081019074393500",
    publishedAt: "2026-08-10T10:26:57.000Z", poolMatchCount: 1,
    selectionReason: "글로벌 반도체 대표 기업의 월간 매출 변화를 다룬 보도"
  },
  {
    id: "MP-R12", desk: "company", sourceId: "mk-news",
    title: "LX세미콘, 차량용 MCU 양산 … 현대차·기아에 공급 시작",
    url: "https://www.mk.co.kr/news/business/12123205",
    publishedAt: "2026-08-10T10:18:27.000Z", poolMatchCount: 1,
    selectionReason: "차량용 반도체 공급망과 고객사 변화를 다룬 기업 보도"
  },
  {
    id: "MP-R13", desk: "company", sourceId: "yna",
    title: "한샘, 2분기 영업이익 5배로 증가…13분기 연속 흑자(종합)",
    url: "https://www.yna.co.kr/view/AKR20260810138551527",
    publishedAt: "2026-08-10T09:20:45.000Z", poolMatchCount: 1,
    selectionReason: "기업 실적과 이익 추세를 함께 제시한 보도"
  },
  {
    id: "MP-R14", desk: "company", sourceId: "mk-news",
    title: "한화, KAI 지분 15.89% 확보…공정위에 기업결합심사 신청 예정",
    url: "https://www.mk.co.kr/news/business/12122975",
    publishedAt: "2026-08-10T07:47:13.000Z", poolMatchCount: 1,
    selectionReason: "지분 취득과 기업결합 절차를 다룬 소유 구조 변화 보도"
  },
  {
    id: "MP-R15", desk: "company", sourceId: "chosunbiz",
    title: "포도봉봉 해태htb 인수전 흥행… 커피 프랜차이즈 대 신생 PE ‘2파전’",
    url: "https://biz.chosun.com/stock/stock_general/2026/08/10/TROK7O5LJRBWJJKLCLR3B2OMK4/",
    publishedAt: "2026-08-10T09:05:20.000Z", poolMatchCount: 2,
    selectionReason: "M&A 경쟁 구도를 다루며 정규화 URL 중복 제거 필요성도 보여주는 보도"
  },
  {
    id: "MP-R16", desk: "market", sourceId: "yna",
    title: "국고채 금리 일제히 상승…3년물 연 3.778%",
    url: "https://www.yna.co.kr/view/AKR20260810124100008",
    publishedAt: "2026-08-10T07:45:51.000Z", poolMatchCount: 1,
    selectionReason: "국내 채권 금리의 당일 변화를 수치로 제시한 시장 보도"
  },
  {
    id: "MP-R17", desk: "market", sourceId: "yna",
    title: "코스피 주춤, 코스닥만 날았다…레버리지 규제 이후 수급 개선",
    url: "https://www.yna.co.kr/view/AKR20260810082800008",
    publishedAt: "2026-08-10T07:36:08.000Z", poolMatchCount: 1,
    selectionReason: "주가지수와 규제 이후 수급 변화를 연결한 시장 보도"
  },
  {
    id: "MP-R18", desk: "market", sourceId: "etoday",
    title: "[채권마감] 사흘째 약세, 최근 강세장 되돌림+일본 긴축 우려",
    url: "https://www.etoday.co.kr/news/view/2612907",
    publishedAt: "2026-08-10T08:07:00.000Z", poolMatchCount: 1,
    selectionReason: "국내 채권 약세와 해외 긴축 우려를 연결한 마감 보도"
  },
  {
    id: "MP-R19", desk: "market", sourceId: "mt",
    title: "美 금리인상 부담 완화에 기술주 강세…닛케이, 2.08%↑ [Asia마감]",
    url: "https://www.mt.co.kr/world/2026/08/10/2026081016205637455",
    publishedAt: "2026-08-10T07:38:11.000Z", poolMatchCount: 1,
    selectionReason: "미국 금리 기대와 아시아 기술주 반응을 연결한 시장 보도"
  },
  {
    id: "MP-R20", desk: "market", sourceId: "yna",
    title: "반도체업체 CXMT, MSCI지수 편입…中본토 시총 1위 굳히기",
    url: "https://www.yna.co.kr/view/AKR20260810139200089",
    publishedAt: "2026-08-10T09:21:33.000Z", poolMatchCount: 1,
    selectionReason: "지수 편입과 중국 반도체 시장 구조 변화를 다룬 보도"
  }
].map((report) => ({
  ...report,
  ...SOURCE_META[report.sourceId],
  sourceRole: "reported_secondary",
  syndicationStatus: "unknown"
}));

const officialChecks = [
  {
    id: "MP-A01", reportId: "MP-R04", trigger: "official_statistic", status: "matched",
    source: "일본 재무성·일본은행 국제수지 속보",
    urls: ["https://www.mof.go.jp/policy/international_policy/reference/balance_of_payments/preliminary/bpch2026.pdf"],
    result: "2026년 상반기 경상수지 17조4292억엔, 전년 동기 대비 22.5% 증가를 확인했다.",
    limit: "금액과 증가율만 확인했다. 역대 최대 여부와 가계 소비 설명은 이 자료만으로 확정하지 않는다."
  },
  {
    id: "MP-A02", reportId: "MP-R08", trigger: "policy_legislation", status: "matched",
    source: "정부 부처 합동 메가특구 보도자료",
    urls: ["https://www.me.go.kr/home/web/newsRead.do?boardId=1857510&boardMasterId=939&menuId=10607"],
    result: "메가특구 특별법을 2026년 안에 제정한다는 정부 계획을 확인했다.",
    limit: "충청 246조원·영남 107조원 투자 착수 주장은 이 자료만으로 확인하지 않았다."
  },
  {
    id: "MP-A03", reportId: "MP-R11", trigger: "company_metric", status: "matched",
    source: "TSMC Investor Relations 월간 매출",
    urls: ["https://investor.tsmc.com/english/monthly-revenue/2026"],
    result: "2026년 7월 매출 4675억8000만 대만달러와 전년 동월 대비 44.7% 증가를 확인했다.",
    limit: "공식 페이지가 표시한 미감사 월간 수치이며 기사 제목의 45%는 반올림 값이다."
  },
  {
    id: "MP-A04", reportId: "MP-R14", trigger: "ownership_change", status: "partial",
    source: "한국거래소 KIND 공시",
    urls: [
      "https://kind.krx.co.kr/external/2026/07/08/000721/20260630002959/61381.htm",
      "https://kind.krx.co.kr/external/2026/07/01/000086/20260701000099/00636.htm"
    ],
    result: "312만1098주·5000억원 취득 결정과 취득 후 4.73%, 별도 대량보유 11.21% 공시를 확인했다.",
    limit: "8월 10일 기준 합산 15.89%와 공정위 기업결합심사 신청 예정은 해당 공시만으로 직접 확인되지 않았다."
  },
  {
    id: "MP-A05", reportId: "MP-R06", trigger: "policy_scope", status: "partial",
    source: "대한민국 정책브리핑·과학기술정보통신부",
    urls: ["https://www.korea.kr/news/policyNewsView.do?newsId=148968284"],
    result: "피지컬 AI를 국가 메가프로젝트로 추진하고 생태계를 지원한다는 정책 방향을 확인했다.",
    limit: "기사 제목의 로봇 구매 대폭 확대라는 구체적 조치는 이 자료에서 확인되지 않았다."
  }
].map((check) => ({ ...check, checkedAt: "2026-08-10T10:58:26.000Z" }));

export const MARKET_POLICY_SOURCE_SAMPLE = deepFreeze({
  stableId: "NOWHOT-MARKET-POLICY-SOURCE-SAMPLE-001",
  state: "complete_with_limits",
  label: "20+5 SAMPLE COMPLETE",
  scope: "first_category_evidence_pack_only",
  scopeNotice: "시장·정책 첫 카테고리 팩의 공급·검증 라우팅 표본이며 지금핫 전체 카테고리 품질, E1 층화 평가 manifest, 운영 준비를 증명하지 않는다.",
  sampledAt: "2026-08-10T10:41:04.955Z",
  checkedAt: "2026-08-10T10:58:26.000Z",
  poolSnapshot: {
    sha256: "269523e7cf8954e32dbbf81015e521f4651ce772035c5efa06ba5c1051d55369",
    rowCount: 5290,
    uniqueUrlCount: 3278,
    duplicateRows: 2012,
    sourceCount: 76
  },
  method: {
    accessMethod: "existing_registry_adapter",
    contentUse: "metadata_and_link_only",
    dedupeRule: "normalized_url",
    ownershipMeaning: "법적 소유권 확정이 아니라 동일 매체 계열을 중복 독립 출처로 세지 않기 위한 보수적 운영 그룹",
    newKeys: 0,
    newCollectors: 0,
    llmCalls: 0
  },
  reports,
  officialChecks,
  metrics: {
    reportCount: reports.length,
    officialCheckCount: officialChecks.length,
    matchedCheckCount: officialChecks.filter((check) => check.status === "matched").length,
    partialCheckCount: officialChecks.filter((check) => check.status === "partial").length,
    deskCounts: Object.fromEntries(["macro", "policy", "company", "market"].map((desk) => [desk, reports.filter((report) => report.desk === desk).length])),
    sourceFamilyCount: new Set(reports.map((report) => report.ownershipGroup)).size,
    selectedDuplicateUrlRows: reports.filter((report) => report.poolMatchCount > 1).length
  },
  findings: [
    "기존 수집 경로만으로 네 데스크별 보도 5건을 구성할 수 있었다.",
    "공식 확인 5건 중 2건은 일부 주장만 확인돼 검증 결과를 부분 일치로 보존해야 했다.",
    "풀 5290행 중 정규화 고유 URL은 3278개여서 URL 중복 제거가 E1 계약의 필수 전처리다.",
    "매체 URL만으로 원취재·전재 여부를 확정할 수 없어 syndicationStatus는 unknown으로 유지했다."
  ],
  decision: "20+5 표본의 공급과 선택적 검증 라우팅은 증명됐다. E1 층화·규모·manifest와 레지스트리 메타데이터 fixture는 아직 HOLD다."
});
