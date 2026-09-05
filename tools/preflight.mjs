// 배포 전 고정 점검.
//
// ── 왜 (David 2026-08-06 "몇 개 고치면 원래 있던 게 꼬이는 게 반복된다")
// 그날 하루에만 내가 낸 회귀가 넷이었다. 원인은 하나다 — **바꾼 것만 재고
// 그 옆을 안 쟀다.** 딜 간격은 세 번 실측하면서 "그래서 스크롤이 되나"는
// 한 번도 보지 않았다.
//
// 그래서 매번 도는 항목으로 고정한다. 아래 셋은 전부 그날 실제로 깨진 것이다:
//   1. 무한스크롤    — capDeals가 페이지를 짧게 만들어 "다 봤음"으로 뒤집혔다
//   2. 광고 모드     — 편집 홈 AdFit과 실시간 쿠팡이 각 지면에서 동작함
//   3. 지면 분리     — /는 자체 편집 홈, /live는 기존 개인화 앱
//   4. 자체 콘텐츠   — 홈 첫 화면에서 우리가 쓴 글이 차지하는 비중
//
// 사용: node tools/preflight.mjs [base]   (기본 https://nowhot.kr)
const BASE = process.argv[2] || "https://nowhot.kr";
const fails = [];
const ok = (name, cond, detail) => {
  console.log(`${cond ? "  OK  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) fails.push(name);
};

// 모든 요청에 내부 점검 표식을 단다 — 서버가 이 헤더를 보고 방문자 집계에서
// 뺀다. 2026-08-09 실측: 배포마다 도는 이 점검이 방문자 1~2명으로 잡혀,
// 배포 80회였던 8/6엔 "방문자 266명" 중 94명이 이 점검이었다.
const CHECK_HEADERS = { "x-nowhot-check": "1" };
async function json(path, init) {
  const r = await fetch(BASE + path, { ...init, headers: { ...CHECK_HEADERS, ...(init && init.headers) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

console.log(`배포 전 점검 — ${BASE}\n`);

const cfg = await json("/api/config");
const reviewMode = Boolean(cfg.body && cfg.body.adfit && cfg.body.adfit.reviewMode);
const liveMonetization = Boolean(cfg.body && cfg.body.monetization && cfg.body.monetization.enabled);
const localEditorial = Boolean(cfg.body && cfg.body.localEditorial);

// ── 1. 피드가 10페이지 이어지는가 (각 페이지가 꽉 차는가)
const s = await json("/api/session", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}"
});
if (!s.body || !s.body.userId) {
  ok("세션 생성", false, `HTTP ${s.status}`);
} else {
  const uid = s.body.userId;
  let cursor = 0, pages = 0, short = 0, earlyExhaust = null;
  for (let p = 0; p < 10; p++) {
    const r = await json(`/api/feed?userId=${uid}&limit=12&cursor=${cursor}`);
    const items = (r.body && r.body.items) || [];
    if (!items.length) break;
    const organic = items.filter((x) => x.via !== "ad");
    pages++;
    if (organic.length < 12) short++;
    cursor = r.body.nextCursor;
    if (r.body.exhausted) { earlyExhaust = p + 1; break; }
  }
  ok("피드 10페이지 연속", pages === 10 && !earlyExhaust,
    `${pages}페이지${earlyExhaust ? `, ${earlyExhaust}페이지에서 소진` : ""}`);
  ok("페이지가 꽉 참", short === 0, `짧은 페이지 ${short}개`);

  // ── 2. 광고 카드가 3단(문구·본문·CTA)과 링크·이미지를 갖췄는가
  //
  // **새 세션으로 본다.** 위 10페이지를 돈 세션은 광고 세션 캡
  // (AD_MAX_PER_SESSION, 기본 6)을 이미 다 써서 광고가 안 나온다 —
  // 첫 실행에서 이 검사가 거짓 실패를 냈다. 점검이 스스로 만든 상태 때문에
  // 실패하면 그 점검은 못 믿는다.
  const s2 = await json("/api/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  });
  const uid2 = (s2.body && s2.body.userId) || uid;
  const f = await json(`/api/feed?userId=${uid2}&limit=30`);
  const ads = ((f.body && f.body.items) || []).filter((x) => x.via === "ad");
  if (liveMonetization) {
    ok("광고 슬롯이 나온다", ads.length > 0, `${ads.length}건`);
  } else {
    ok("수익화 미설정 피드가 무광고", ads.length === 0, `${ads.length}건`);
  }
  if (ads.length) {
    const broken = ads.filter((a) => !a.url || !a.image || !a.hook);
    ok("광고 카드가 온전함", broken.length === 0, `깨진 카드 ${broken.length}건`);
    const flat = ads.filter((a) => !a.productName || a.productName === a.hook);
    ok("광고 문구가 단조롭지 않음", flat.length === 0, `본문 없는 카드 ${flat.length}건`);
  }
}

// ── 3. 심사 지면과 실시간 피드가 실제 응답에서 분리됐는가
const html = await (await fetch(BASE + "/", { headers: CHECK_HEADERS })).text();
const liveHtml = await (await fetch(BASE + "/live", { headers: CHECK_HEADERS })).text();
const adfitUnit = cfg.body && cfg.body.adfit && cfg.body.adfit.mobileUnit;
ok("/live config에 AdFit 단위 없음", !adfitUnit,
  adfitUnit ? "자동 갱신 피드가 광고단위를 받았다" : "단위 미전달");
ok("/live는 noindex", /<meta name="robots" content="noindex,follow">/.test(liveHtml));
const liveNetworkTag = /<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i.test(liveHtml);
ok("/live가 광고 네트워크 SDK를 직접 로드하지 않음", !liveNetworkTag);

if (localEditorial) {
  ok("오늘판 쿠팡 지면·재고 연결", /todayAdHtml\(issue,index,"today-feed",seenAds,/.test(html)
    && /state\.coupang=config\.coupang/.test(html));
  ok("오늘판에 빈 심사 광고·네트워크 SDK 없음", !/kakao_ad_area|class="adsbygoogle"/.test(html)
    && !/<script[^>]+src=["'][^"']*(?:kakaocdn|googlesyndication)[^"']*["']/i.test(html));
  if (reviewMode) {
    const briefingHtml = await (await fetch(BASE + "/briefing", { headers: CHECK_HEADERS })).text();
    ok("기존 브리핑 심사 지면 AdFit 한 단위 유지", (briefingHtml.match(/class="kakao_ad_area"/g) || []).length === 1
      && /t1\.kakaocdn\.net\/kas\/static\/ba\.min\.js/.test(briefingHtml));
  }
} else if (reviewMode) {
  const units = (html.match(/class="kakao_ad_area"/g) || []).length;
  ok("심사 홈에 AdFit 한 단위", units === 1, `${units}개`);
  ok("심사 홈은 AdFit SDK만 로드", /t1\.kakaocdn\.net\/kas\/static\/ba\.min\.js/.test(html)
    && !/pagead2\.googlesyndication\.com|link\.coupang\.com/.test(html));
} else {
  ok("AdFit 심사 모드 꺼짐", !reviewMode);
}
if (liveMonetization) {
  const inventory = cfg.body?.coupang?.items || [];
  ok("실시간 쿠팡 재고·링크·이미지 제공", inventory.length > 0 &&
    inventory.every(item => /^https:\/\/link\.coupang\.com\//.test(item.href) && item.img && item.hook),
    `${inventory.length}종`);
}

// ── 3-B. 광고 카드가 **한 곳에서만** 그려지는가 (2026-08-06)
//
// 이 항목이 없어서 David가 같은 것을 네 번 지적했다. 광고를 그리는 함수가 둘이라
// 어느 경로로 왔느냐에 따라 카드가 다르게 생겼고, 한쪽을 고치면 다른 쪽이 남았다.
// 코드 수준에서 갈라짐을 막는다 — 화면을 안 열어도 잡힌다.
const idx = liveHtml;
const adFn = idx.slice(idx.indexOf("function appendAdCard(item){"), idx.indexOf("// 슬롯 노출 로깅"));
ok("광고 렌더러가 하나다", /coupangCardHtml\(link,/.test(adFn) && !/adProductNameHtml|ad-disclosure-pop/.test(adFn),
  "서버 경로가 자기만의 마크업으로 되돌아갔다");
const css = idx.replace(/\/\*[\s\S]*?\*\//g, "");
// 크기·모양이 흩어지지 않았는가. 배치 규칙(몰입 모드의 order·padding)은 크기를
// 정하지 않으므로 세지 않는다 — 통째로 세면 규칙 하나 추가할 때마다 거짓 실패다.
ok("고지문 크기 정의가 한 곳", (css.match(/\.ad-disclosure\{[^}]*font-size/g) || []).length === 1);
ok("광고 썸네일이 자리와 무관", (css.match(/#feed[^{;]*\.card-go \.go-thumb\{/g) || []).length === 0
  && /\.card \.card-go \.go-thumb\{[^}]*width:88px/.test(css));

// ── 4. 자체 콘텐츠 — 애드핏 4차 반려 대응
// 로컬 고도화 플래그에서는 정적 셸과 실제 API 편집 결과를 함께 본다. 운영 플래그가
// 꺼진 서버는 기존 SSR 편집 홈 계약을 그대로 확인한다.
const legacyEditorialHome = /<h1>지금핫<\/h1>/.test(html) && /어떻게 고르나/.test(html);
const localEditorialHome = /<title>지금핫 오늘판<\/title>/.test(html)
  && /id="issues"/.test(html) && /id="categories"/.test(html) && /href="\/live"/.test(html);
ok("루트가 자체 편집 홈", localEditorial ? localEditorialHome : legacyEditorialHome,
  localEditorial ? "로컬 개인 오늘판" : "기존 SSR 편집 홈");
const rootBody = html.slice(html.indexOf("<body"));
ok("편집 홈 본문에 외부 링크 목록 없음", !/<a[^>]+href="https?:\/\//i.test(rootBody));
const brief = await json("/api/briefing");
const issues = ((brief.body && brief.body.issues) || []).filter((i) => i && i.headline && i.paragraph);
ok("우리가 쓴 브리핑 문단이 있음", issues.length >= 3, `${issues.length}건`);
if (localEditorial) {
  const today = await json("/api/today?categories=news,business,tech,humor");
  const ownIssues = ((today.body && today.body.issues) || []).filter((issue) =>
    issue && issue.whyImportant && issue.whyHot && issue.whyForYou && issue.confidence);
  const receipt = today.body && today.body.candidateContract;
  const editorialQuality = today.body && today.body.editorialQuality;
  ok("로컬 오늘판 자체 편집 필드", ownIssues.length >= 3, `${ownIssues.length}건`);
  const candidateMetrics = receipt && receipt.metrics;
  const selectedCount = today.body && today.body.selection && today.body.selection.categories
    ? today.body.selection.categories.length : 0;
  const expectedSampleMode = selectedCount > 1
    ? "independent_category_lists"
    : "dynamic_current_edition";
  ok("로컬 오늘판 동적 후보 계약", Boolean(candidateMetrics
    && candidateMetrics.candidateCount >= ownIssues.length
    && candidateMetrics.uniqueSourceCount >= 2
    && candidateMetrics.selectedCategoryCoveragePct === 100),
  candidateMetrics
    ? `후보 ${candidateMetrics.candidateCount}건 · 출처 ${candidateMetrics.uniqueSourceCount}곳 · 선택 ${selectedCount}개`
    : "영수증 없음");
  const gateFailures = ownIssues.filter((issue) => !issue.editorialGate || !issue.editorialGate.pass);
  // 변화 검사 전에는 반복 대체용 여분을 생성하므로 selectedAfterGate가 최종 발행 수보다
  // 클 수 있다. 후보 탈락이 0이어야 하는 것도 품질 조건이 아니다. 최종 이슈가 모두
  // 통과했고 초안 수가 최종 수를 충분히 덮는지만 확인한다.
  ok("현재 판 발행 이슈 편집 게이트", Boolean(editorialQuality
    && editorialQuality.sampleMode === expectedSampleMode
    && editorialQuality.selectedAfterGate >= ownIssues.length
    && gateFailures.length === 0),
  editorialQuality
    ? `검사 ${editorialQuality.evaluatedClusters}개 · 초안 ${editorialQuality.selectedAfterGate}개 · 최종 ${ownIssues.length}개 · 기계 탈락 ${editorialQuality.machineHold}개`
    : "영수증 없음");
  const falseCrossClaims = ownIssues.filter((issue) => issue.confidence.code === "multiple_feed_observed"
    && (!issue.evidence || issue.evidence.mode !== "multiple_feed_observed"
      || Number(issue.evidence.observedFeedCount) < 2));
  ok("직접 복수 피드 표현 근거 일치", falseCrossClaims.length === 0,
    `오표기 ${falseCrossClaims.length}건`);
}

// ── 5. 살아있는 서비스인가 — 2026-08-07 장애 2건 대응
//
// 둘 다 테스트 910건을 통과한 채 배포됐다: 저장 직렬화가 이벤트 루프를 먹어
// TTFB 2.5초(사실상 접속 불가), 클라이언트 무한 재로드로 스피너만 도는 화면.
// 테스트가 못 보는 층은 배포 직후 실측으로 잡는다.
{
  const t0 = Date.now();
  await fetch(BASE + "/?preflight=1", { headers: CHECK_HEADERS }).then((r) => r.text());
  const ms = Date.now() - t0;
  ok("홈 응답 1.5초 이내", ms < 1500, `${ms}ms — 넘으면 이벤트 루프가 막혀 있을 가능성`);
}
{
  // 피드가 실제로 글을 내놓는가. 빈 피드는 "정상 응답"이면서 죽은 서비스다.
  //
  // 2026-08-08 정정 — 이 점검은 만들어진 뒤 한 번도 통과한 적이 없었다:
  // (1) user_1 고정 id는 새 스토어(스테이징)에 없어 400 "unknown user",
  // (2) json()은 {status, body}를 주는데 f.items를 읽어 운영에서도 항상 0건.
  // 1번 점검과 같은 방식으로 세션을 만들어 그 사용자로 잰다.
  const fs = await json("/api/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  }).catch(() => null);
  const fuid = fs && fs.body && fs.body.userId;
  const f = fuid ? await json(`/api/feed?userId=${fuid}&cursor=0&limit=10`).catch(() => null) : null;
  const n = f && f.body && Array.isArray(f.body.items) ? f.body.items.length : 0;
  ok("피드가 글을 내놓음", n >= 3, `${n}건`);
}

console.log(`\n${fails.length ? `실패 ${fails.length}건: ${fails.join(", ")}` : "전부 통과"}`);
process.exit(fails.length ? 1 : 0);
