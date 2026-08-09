// 사람 판정 — 한 벌 (Phase 1, 2026-08-09)
//
// ── 왜
// server.js 곳곳에 "이게 내부 점검인가"(x-nowhot-check) 관문이 따로따로
// 있었고, "사람인가"는 store.trafficStats의 평생 흔적 소급 계산 하나뿐이었다
// (관문 두 벌 — 하나는 요청 시점 필터, 하나는 사후 집계라 언젠가 어긋난다).
// 여기서 "이 요청을 누가 보냈는가"를 한 곳으로만 모은다. "사람이 맞는가"는
// 이 분류만으로 확정하지 않는다 — qualifying 신호(store.markHumanDay 참고)와
// 함께 써야 한다.
//
// classify(req) -> "internal" | "bot" | "observed"
//   internal : 우리 배포 preflight·운영 점검. x-nowhot-check 헤더로 자기
//              정체를 스스로 밝힌 요청(server.js의 기존 관행 그대로 흡수).
//   bot      : 알려진 검색엔진·SNS 링크 프리뷰·SEO 진단 툴·AI 학습 크롤러·
//              헤드리스 브라우저·스크립트형 HTTP 클라이언트 UA.
//   observed : 그 외 전부. "사람일 수 있다"는 뜻이지 "사람이다"는 아니다 —
//              스크롤만으로 자동 발화하는 신호(skip 등)도 이 분류를 그대로
//              통과하므로, 실제 사람 확정은 qualifying 신호 쪽 책임이다.
//
// 원시 User-Agent 문자열은 어디에도 저장하지 않는다. 이 모듈이 밖으로
// 내보내는 것은 분류 결과(internal/bot/observed)뿐이다.
//
// 봇 목록은 상수라 신종 UA(특히 무신호로 페이지만 렌더하는 크롤러, 흔히
// 평범한 Chrome UA를 쓴다)를 원리적으로 못 잡는다 — 그건 이 목록이 아니라
// "전체−사람" 격차를 관리자에 나란히 보여주는 쪽(다음 단계)의 몫이다. 목록은
// 배포 후 실관측으로 계속 보강한다.
const BOT_UA_PATTERNS = [
  // 검색엔진
  /Googlebot/i, /bingbot/i, /Yeti/i, /Daumoa/i, /YandexBot/i, /Baiduspider/i,
  /naverbot/i, /Yahoo! ?Slurp/i, /DuckDuckBot/i, /SeznamBot/i, /Applebot/i,
  // SNS·메신저 링크 프리뷰
  /kakaotalk-scrap/i, /facebookexternalhit/i, /Twitterbot/i, /Slackbot/i,
  /LinkedInBot/i, /Discordbot/i, /TelegramBot/i, /WhatsApp/i,
  // SEO·크롤링 진단 툴
  /AhrefsBot/i, /SemrushBot/i, /MJ12bot/i, /DotBot/i, /PetalBot/i,
  // AI 학습·응답 크롤러
  /Bytespider/i, /GPTBot/i, /ClaudeBot/i, /CCBot/i, /Amazonbot/i,
  /PerplexityBot/i, /anthropic-ai/i,
  // 헤드리스 브라우저·자동화
  /HeadlessChrome/i, /Lighthouse/i, /PhantomJS/i, /Playwright/i,
  /Puppeteer/i, /Selenium/i,
  // 스크립트형 HTTP 클라이언트 — 실제 사람의 브라우저는 이 UA를 쓰지 않는다
  /python-requests/i, /curl\//i, /Wget/i, /node-fetch/i, /axios\//i,
  /Go-http-client/i, /okhttp/i, /libwww-perl/i, /Java\//i
];

// 테스트·재사용을 위해 분류 판정과 UA 매치를 분리해 둔다.
export function isBotUserAgent(ua) {
  if (typeof ua !== "string" || !ua) return false;
  return BOT_UA_PATTERNS.some((re) => re.test(ua));
}

export function classify(req) {
  const headers = (req && req.headers) || {};
  if (headers["x-nowhot-check"]) return "internal";
  if (isBotUserAgent(headers["user-agent"])) return "bot";
  return "observed";
}

// qualifying 신호 — "클릭 게이트가 확실한 것"만 사람 증거로 친다.
// open(상세를 실제로 열었다)·rate(평가 버튼)·save(저장 버튼)·comment(댓글
// 작성)·survey(설문 제출)는 전부 명시적 클릭/제출이 있어야만 온다.
//
// 제외한 것:
//  - skip: 카드가 화면에 잠깐 스쳐도 자동 발화(스크롤만으로 크롤러도 만든다).
//  - dwell/complete: 몰입 모드의 IntersectionObserver가 스크롤만으로도 자동
//    발화한다. 상세 오버레이 경로와 타입 문자열이 같아 서버에서 "클릭해서
//    연 상세의 dwell"과 구분할 수 없다(적대적 검수 2026-08-09 라운드2).
//  - view/exit/depth(/api/track): 무인증 경로라 위조가 자유롭다.
//  - feed 호출·ad impression: 스크롤·자동 로드만으로 발생.
export const QUALIFYING_SIGNAL_TYPES = Object.freeze(["open", "rate", "save", "comment", "survey"]);
