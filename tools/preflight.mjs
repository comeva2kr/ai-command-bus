// 배포 전 고정 점검.
//
// ── 왜 (David 2026-08-06 "몇 개 고치면 원래 있던 게 꼬이는 게 반복된다")
// 그날 하루에만 내가 낸 회귀가 넷이었다. 원인은 하나다 — **바꾼 것만 재고
// 그 옆을 안 쟀다.** 딜 간격은 세 번 실측하면서 "그래서 스크롤이 되나"는
// 한 번도 보지 않았다.
//
// 그래서 매번 도는 항목으로 고정한다. 아래 셋은 전부 그날 실제로 깨진 것이다:
//   1. 무한스크롤    — capDeals가 페이지를 짧게 만들어 "다 봤음"으로 뒤집혔다
//   2. 광고 카드     — 애드핏 빈 지면이 쿠팡 자리를 먹어 수익이 0이 됐다
//   3. 애드핏 지면   — 없애면 "설치 후 심사 진행" 반려 사유로 되돌아간다
// 여기에 애드핏 4차 반려 대응으로 넷째를 더한다:
//   4. 자체 콘텐츠   — 홈 첫 화면에서 우리가 쓴 글이 차지하는 비중
//
// 사용: node tools/preflight.mjs [base]   (기본 https://nowhot.kr)
const BASE = process.argv[2] || "https://nowhot.kr";
const fails = [];
const ok = (name, cond, detail) => {
  console.log(`${cond ? "  OK  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) fails.push(name);
};

async function json(path, init) {
  const r = await fetch(BASE + path, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}

console.log(`배포 전 점검 — ${BASE}\n`);

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
  ok("광고 슬롯이 나온다", ads.length > 0, `${ads.length}건`);
  if (ads.length) {
    const broken = ads.filter((a) => !a.url || !a.image || !a.hook);
    ok("광고 카드가 온전함", broken.length === 0, `깨진 카드 ${broken.length}건`);
    const flat = ads.filter((a) => !a.productName || a.productName === a.hook);
    ok("광고 문구가 단조롭지 않음", flat.length === 0, `본문 없는 카드 ${flat.length}건`);
  }
}

// ── 3. 화면에 **빈 광고 칸**이 생기지 않는가
//
// 이 점검의 예전 판은 코드에 애드핏 지면이 "있는지"만 봤다. 그래서 8/8 통과인데
// David 화면에는 "제휴 광고 / AD"와 고지문만 남은 169px 빈 칸이 있었다
// (2026-08-06). 코드가 있는지가 아니라 **그 칸이 채워지는지**를 물어야 한다.
//
// 애드핏은 승인 전까지 지면을 만들되 아무것도 채우지 않고, 크로스오리진이라
// 비었는지 화면에서 알 수도 없다. 그러니 **승인 전에는 지면 자체를 내주지 않는 것**만이
// 확실하다. 승인되면 이 검사의 기대값을 뒤집는다.
const html = await (await fetch(BASE + "/")).text();
const cfg = await json("/api/config");
const adfitUnit = cfg.body && cfg.body.adfit && cfg.body.adfit.mobileUnit;
ok("승인 전 애드핏 빈 지면을 안 그림", !adfitUnit,
  adfitUnit ? "config가 광고단위를 내주고 있다 — 화면에 빈 칸이 생긴다" : "지면 미노출");
ok("애드핏이 수익 슬롯을 안 먹음", /const useAdfit = false;/.test(html));
ok("애드핏 배선은 보존됨(승인 시 되살릴 수 있음)",
  /ensureAdfitPlacement/.test(html) && /kakao_ad_area/.test(html));

// ── 3-B. 광고 카드가 **한 곳에서만** 그려지는가 (2026-08-06)
//
// 이 항목이 없어서 David가 같은 것을 네 번 지적했다. 광고를 그리는 함수가 둘이라
// 어느 경로로 왔느냐에 따라 카드가 다르게 생겼고, 한쪽을 고치면 다른 쪽이 남았다.
// 코드 수준에서 갈라짐을 막는다 — 화면을 안 열어도 잡힌다.
const idx = await (await fetch(BASE + "/")).text();
const adFn = idx.slice(idx.indexOf("function appendAdCard(item){"), idx.indexOf("// 슬롯 노출 로깅"));
ok("광고 렌더러가 하나다", /coupangCardHtml\(link,/.test(adFn) && !/adProductNameHtml|ad-disclosure-pop/.test(adFn),
  "서버 경로가 자기만의 마크업으로 되돌아갔다");
const css = idx.replace(/\/\*[\s\S]*?\*\//g, "");
ok("고지문 정의가 한 곳", (css.match(/\.ad-disclosure\{/g) || []).length === 1);
ok("광고 썸네일이 자리와 무관", (css.match(/#feed[^{;]*\.ad-native \.ad-thumb\{/g) || []).length === 0
  && /\.card \.ad-native \.ad-thumb\{[^}]*width:88px/.test(css));

// ── 4. 자체 콘텐츠 — 애드핏 4차 반려 대응
ok("홈에 자체 콘텐츠 블록 있음", /id="ownBlock"/.test(html));
const brief = await json("/api/briefing");
const issues = ((brief.body && brief.body.issues) || []).filter((i) => i && i.headline && i.paragraph);
ok("우리가 쓴 브리핑 문단이 있음", issues.length >= 3, `${issues.length}건`);

console.log(`\n${fails.length ? `실패 ${fails.length}건: ${fails.join(", ")}` : "전부 통과"}`);
process.exit(fails.length ? 1 : 0);
