// 딜 글 판별과 상품군 매칭.
//
// ── 왜 (David 2026-08-05)
// "뽐뿌 같은 구매글 관련도 일정 비율로 노출시켜야 바로 아래나 상세 페이지에
//  관련 광고를 달지 않겠어? 내용글과 직접 연관 있는 카테고리나 상품으로."
// "이거 중요한 거 같은데"
//
// 맞다. 문구를 아무리 잘 써도 유머 글 읽던 사람에게 붙이는 광고다. 딜 글 옆에
// 그 상품군 광고를 붙이면 문맥이 완전히 달라진다 — 이미 살 마음으로 읽던 사람이다.
// 벤치마킹에서 매출 1위였던 Slickdeals이 정확히 이 구조다.
//
// ── 실측으로 드러난 것 (2026-08-05)
// 우리가 긁던 뽐뿌 주소는 hot.php — **전 게시판 통합 인기글**이라 핫딜이
// 거의 없었다. 피드 120건 중 뽐뿌 6건이 전부 여행·정치·잡담이었다.
// 진짜 핫딜은 zboard.php?id=ppomppu(국내)와 ppomppu4(해외)에 있다:
//   [지마켓] 반스 남녀공용 로퍼 어센틱 (26,180원/무배)
//   [네이버] 포크밸리 한돈 감자탕용 등뼈 냉동 1kg 4개 (13,960원/무료)
// David가 말한 "구매글"이 사실상 안 들어오고 있었다.

// 딜 제목의 모양: [쇼핑몰]상품명 (가격/배송)
// 가격은 **출처에 적힌 것을 그대로만** 옮긴다. 우리가 확인할 수 없는
// 할인율·재고·기간을 쓰는 순간 허위표시다(products.json의 원칙과 같다).
export function parseDealTitle(title) {
  const t = String(title || "").trim();
  if (!t) return null;
  const mall = (t.match(/^\[([^\]]{1,20})\]/) || [])[1] || null;
  const priceRaw = (t.match(/\(([^()]*?[\d,]+\s*원[^()]*)\)\s*$/) || [])[1] || null;
  const name = t.replace(/^\[[^\]]{1,20}\]\s*/, "").replace(/\s*\([^()]*[\d,]+\s*원[^()]*\)\s*$/, "").trim();
  return { mall, name: name || t, price: priceRaw ? priceRaw.trim() : null };
}

// 딜 글인가. 쇼핑몰 말머리나 가격 표기가 있으면 딜이다 —
// 둘 다 그 게시판이 스스로 붙인 형식이라 우리가 추측하는 게 아니다.
export function isDeal(item) {
  if (!item) return false;
  if (item.isDeal === true) return true;
  if (/(?:^|\/)hotdeal(?:\/|$|[?#])/i.test(String(item.url || item.canonicalUrl || ""))) return true;
  const t = String(item.title || "");
  // 값이 적혀 있으면 딜이다. 원화만 보면 해외 딜이 통째로 빠지므로(실측
  // 2026-08-05: 해외 게시판 21건 중 5건만 잡혔다) 달러·유로·엔도 같이 본다.
  //
  // **말머리만으로는 판정하지 않는다.** 한때 /^\[..\]/ 도 증거로 썼는데,
  // 뉴스 제목의 "[EV 트렌드]"·"[단독]"이 전부 딜로 잡혔다(실측 2026-08-05:
  // 피드의 딜 16건 중 3건이 오토헤럴드·이투데이·더쿠 기사였다). 그러면 보장
  // 비율의 분자가 가짜로 차서 진짜 딜이 오히려 덜 들어온다.
  // 말머리뿐인 진짜 딜은 게시판 자체가 딜 게시판이라 item.isDeal로 들어온다.
  return /\([^()]*[\d,]+\s*원[^()]*\)/.test(t)
    || /[\d,]{3,}\s*원(\s|$|\/|\))/.test(t)
    || /[$€£¥]\s?[\d,]+(\.\d+)?/.test(t);
}

// ── 상품군 → 쿠팡 도착지
//
// 딜 제목에는 상품명이 그대로 있다. 그 낱말로 도착지를 고르면, 글 분류(life·tech)로
// 고르는 것보다 훨씬 정확하다 — "감자탕용 등뼈" 옆에 "쿠팡 신선식품"이 붙는다.
//
// 사전은 좁게 유지한다. 애매하면 매칭하지 않고 기본 문맥 규칙으로 내려간다 —
// 엉뚱한 도착지를 붙이면 문구와 도착지가 어긋나 허위표시가 된다(2026-08-03 사고).
const PRODUCT_DEST = [
  ["fresh",    /정육|한돈|한우|삼겹|등뼈|닭|계란|메추리알|김치|쌀|과일|사과|감귤|딸기|수박|채소|양파|마늘|생수|우유|요거트|밀키트|반찬|해산물|오징어|새우|연어|김\b|라면|즉석밥|간편식|아이스크림|음료|커피믹스|비빔면|짜장|짬뽕|과자|스낵|젤리|초콜릿|사탕|캔디|햄\b|참치|통조림|소스|양념|식용유|설탕|밀가루|견과|아몬드|육포|만두|피자|치킨|떡볶이|장어|낙지|문어|전복|전어|고등어|갈치|삼치|조기|명태|꽁치|멸치|굴비|가리비|홍합|명란|젓갈|브라우니|두유|베지밀|월드콘|죠스바|스크류바|설레임|아이스바/],
  ["dgt",      /노트북|태블릿|모니터|키보드|마우스|ssd|hdd|usb|충전기|보조배터리|이어폰|헤드폰|스피커|공기청정기|에어컨|선풍기|청소기|건조기|세탁기|냉장고|tv\b|프로젝터|블랙박스|스마트폰|갤럭시|아이폰|애플|샤오미|음식물처리기|정수기|전자레인지|전자렌지|인덕션|밥솥|커피머신|가습기|제습기|드라이어|면도기|스마트워치|공유기|카메라|렌즈\b|프린터|가전/i],
  ["kitchen",  /후라이팬|프라이팬|냄비|압력솥|에어프라이어|전기포트|텀블러|보온병|도마|칼세트|식기|그릇|수저|주방/],
  ["home",     /침대|매트리스|이불|베개|소파|의자|책상|수납|선반|커튼|조명|러그|인테리어|가구/],
  // 번역된 해외 기사는 브랜드명이 영문 그대로 남는다(실측: "Nike는 … 젤리 신발로").
  // 한글 표기만 넣어 두면 그 글을 통째로 놓친다.
  ["fashion",  /신발|스니커|nike|adidas|new balance|jordan|puma|reebok|asics|converse|vans|gucci|prada|balenciaga|sneaker|hoodie|denim|로퍼|운동화|스니커즈|구두|샌들|슬리퍼|스케쳐스|나이키|아디다스|뉴발란스|크록스|티셔츠|맨투맨|후드|자켓|재킷|코트|패딩|바지|청바지|드로즈|트렁크|팬티|양말|속옷|잠옷|파자마|원피스|가방|백팩|지갑|벨트|선글라스|시계|모자/i],
  ["baby",     /기저귀|분유|물티슈|아기|유아|신생아|젖병|유모차|카시트/],
  ["pet",      /사료|간식스틱|캣타워|고양이|강아지|반려|펫\b/],
  ["book",     /도서|책\b|전집|문제집|참고서|만화책|소설/],
  ["toy",      /레고|장난감|피규어|보드게임|퍼즐|프라모델|닌텐도|스위치|플레이스테이션|ps5|엑스박스|xbox|스팀\b|게임\s*타이틀|amiibo|아미보|건프라/i],
  ["camp",     /텐트|타프|캠핑|코펠|버너|랜턴|침낭|아이스박스/],
  ["outdoor",  /등산|트레킹|바람막이|아웃도어|배낭/],
  ["golf",     /골프|드라이버 헤드|아이언 세트|퍼터/],
  ["carparts", /타이어|엔진오일|와이퍼|워셔액|차량용|카매트|틴팅|블랙박스 거치/],
  ["oversea",  /직구|amazon|아마존|알리|해외배송|관부가세/i]
];

// 아무 글에서나 상품군을 뽑는다 (David 2026-08-06: "비단 쿠팡 광고가 아니라도
// 말야. 다른 광고라도 연관 있는 애가 붙어야지. 이런 알고리즘은 기본적으로
// 장착해야지").
//
// 딜 글에만 걸어 뒀던 사전을 제목·요약 전체에 건다. "LG 전자레인지" 기사 옆에는
// 가전, "전어 1kg" 글 옆에는 신선식품이 붙는다. 못 고르면 null이고, 그때만
// 기존 문맥 규칙(글 분류)으로 내려간다.
//
// 상품명이 아니라 사건을 다룬 글에도 걸릴 수 있다("전자레인지 화재"). 그래도
// 붙는 것은 **카테고리 배너**라 특정 상품을 주장하지 않으므로 거짓말이 되지
// 않는다 — 상품 단위 카드였다면 이렇게 넓게 걸면 안 된다.
// 태그 → 상품 도착지.
//
// David 제보(2026-08-06): "아직 광고가 상세페이지에서 글 내용과 상관없는 게
// 붙어. 적어도 뭐 스니커즈 글이면 패션이 나오고 구분하기 쉬운 건 잘 연결해야지."
//
// 실측이 정확히 그랬다. 스니커뉴스 글
// "Nike는 인기 있는 Tech Runner를 젤리 신발로 전환했습니다"에 **신선식품**
// 광고가 붙었다 — 번역된 제목에서 "젤리"를 잡아 식품으로 보낸 것이다.
// `나이키`는 한글만 사전에 있어 영문 `Nike`를 못 잡았고 `신발`도 사전에 없었다.
//
// **그런데 그 소스는 이미 `sneakers` 태그를 선언하고 있었다.** 제목에서
// 더듬어 맞히는 것보다 소스가 스스로 밝힌 분야가 훨씬 정확하다.
// 태그를 먼저 보고, 없을 때만 제목을 본다.
const TAG_DEST = new Map([
  ["sneakers", "fashion"], ["fashion", "fashion"],
  ["parenting", "baby"],
  ["interior", "home"], ["design", "home"],
  ["pets", "pet"],
  ["programming", "dgt"], ["hardware", "dgt"], ["mobile", "dgt"], ["ai", "dgt"],
  ["cars", "carparts"], ["ev", "carparts"], ["testdrive", "carparts"],
  ["food", "fresh"],
  ["travel", "oversea"],
  ["pc-gaming", "dgt"], ["console", "toy"]
]);

// 아이템의 태그에서 도착지를 고른다. 못 고르면 null — 억지로 붙이지 않는다.
export function destForTags(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const d = TAG_DEST.get(String(t || "").toLowerCase());
    if (d) return d;
  }
  return null;
}

export function destForText(text) {
  const hay = String(text || "").toLowerCase();
  if (hay.length < 2) return null;
  for (const [dest, re] of PRODUCT_DEST) if (re.test(hay)) return dest;
  return null;
}

// 딜 제목에서 도착지를 고른다. 못 고르면 null — 억지로 붙이지 않는다.
export function destForDeal(title) {
  const parsed = parseDealTitle(title);
  const hay = `${parsed ? parsed.name : ""} ${title || ""}`.toLowerCase();
  for (const [dest, re] of PRODUCT_DEST) if (re.test(hay)) return dest;
  // 상품군을 못 골랐어도 외화로 값이 적혀 있으면 해외 구매다 — 제목에 적힌
  // 증거지 우리 추측이 아니다. "로켓직구"로 보내면 문맥이 맞는다.
  if (/[$€£¥]\s?[\d,]+(\.\d+)?/.test(String(title || ""))) return "oversea";
  return null;
}

// 피드에서 딜이 차지할 최소 비율.
//
// 왜 보장하나: 딜 글은 반응 수치가 낮은 편이다(뽐뿌 핫딜은 댓글 한 자릿수가
// 흔하다). 화제성 순위에만 맡기면 유머·뉴스에 밀려 거의 안 나온다 —
// 실측(2026-08-05): 피드 120건 중 딜 0건이었다.
// 그런데 딜은 **광고가 붙을 자리를 만드는 글**이라 우리에겐 값이 다르다.
//
// 20%는 넘기지 않는다. 그 이상이면 "지금 화제인 글 모음"이 아니라 광고판이 된다.
export const DEAL_SHARE_DEFAULT = 0.12;

// 목록에 딜을 최소 비율만큼 끼워 넣는다. 순서는 유지하되, 모자라면 뒤에서
// 끌어와 균등한 간격으로 꽂는다 — 앞에 몰아넣으면 첫 화면이 광고판이 된다.
// `is`로 판정 기준을 바꿔 끼울 수 있다. 피드는 **등록부가 딜 게시판이라고 한
// 글만** 세도록 이 자리를 갈아 끼운다 — 제목의 가격 표기만 보면 "출고가
// 159만원" 같은 기사가 딜로 세어져(실측 2026-08-05: 블로터 기사 1건) 분자가
// 가짜로 차고, 그만큼 진짜 딜이 덜 들어온다.
// 메인 피드에서 딜이 차지할 **상한**과 최소 간격.
//
// David 실기기(2026-08-06): "스크롤 한 번 내리면 2개가 연달아 나오고 두 번 더
// 내리면 또 4개가 나오고. 나오는 빈도가 너무 잦고 많아. 메인 페이지에선 가끔
// 한번씩 가~장 핫한 것만 나오는 게 좋을 것 같아."
//
// 보장(floor)만 두고 상한을 안 뒀던 것이 잘못이었다. 딜 소스를 5곳으로 늘리자
// 각 소스가 라운드로빈에서 제 몫을 챙기며 유기적으로도 많이 올라왔고, 거기에
// 보장분까지 얹히니 뭉쳐 보였다. 이제 **넘치면 덜어낸다** — 덜어낸 딜은
// 사라지는 게 아니라 다음 페이지·소스 칩에 그대로 남는다(읽음 처리도 안 한다).
export const DEAL_MAX_SHARE = 0.08;   // 12칸 한 페이지에 1건 정도
export const DEAL_MIN_GAP = 6;        // 딜과 딜 사이 최소 칸수

// 반응이 가장 큰 딜만 남긴다. 무엇이 "가장 핫한가"는 그 게시판이 이미 매긴
// 값(댓글·추천·조회)으로만 판단한다 — 우리가 지어내는 값은 없다.
function dealHeat(item) {
  const c = Number(item.commentCount || item.comments || 0);
  const s = Number(item.score || 0);
  const v = Number(item.viewCount || item.views || 0);
  // 조회수는 게시판마다 자릿수가 달라 그대로 더하면 한 소스가 다 이긴다.
  // 로그로 눌러서 순위 보조로만 쓴다.
  return c * 3 + s * 2 + Math.log10(1 + Math.max(0, v));
}

// 딜 전용 화면의 순서 — "관심도 최신도 적절한 순" (David 2026-08-06).
//
// 딜은 유통기한이 있다. 어제 1위였던 특가는 오늘 품절이거나 끝났다 — 반응만
// 보면 죽은 딜이 계속 위에 남는다. 반대로 최신만 보면 아무도 안 본 글이
// 첫 화면을 채운다. 그래서 **둘을 곱한다**: 반응을 로그로 눌러 한 건이
// 판을 뒤집지 못하게 하고, 나이는 12시간 반감기로 깎는다.
//
// 반감기 12시간은 딜의 수명에 맞춘 값이다. 뉴스(HN 중력)보다 짧게 잡았다 —
// 특가는 하루를 넘기면 대개 끝나 있다.
export const DEAL_HALFLIFE_H = 12;
export function dealRank(item, nowMs = Date.now()) {
  const heat = Math.log10(1 + Math.max(0, dealHeat(item)));
  const at = Date.parse(item.publishedAt || item.firstSeenAt || "") || nowMs;
  const ageH = Math.max(0, (nowMs - at) / 3600000);
  const fresh = Math.pow(0.5, ageH / DEAL_HALFLIFE_H);
  // 반응이 0인 딜도 갓 올라왔으면 볼 값어치가 있다 — 바닥을 깔아 준다.
  return (0.35 + heat) * fresh;
}

// 넘치는 딜을 덜어내고, 남긴 것끼리 최소 간격을 지키게 한다.
export function capDeals(items, { maxShare = DEAL_MAX_SHARE, minGap = DEAL_MIN_GAP, is = isDeal } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  const dealIdx = list.map((it, i) => (is(it) ? i : -1)).filter((i) => i >= 0);
  if (dealIdx.length <= 1) return list;

  // 몇 건까지 남길지. 한 건은 항상 남긴다 — 딜이 통째로 사라지면 David가 처음
  // 요청한 "일정 비율로 노출"이 무너진다.
  const keepCount = Math.max(1, Math.floor(list.length * maxShare));

  // **우리가 직접 올린 딜은 경쟁에서 빼고 먼저 남긴다.**
  //
  // capDeals는 반응이 큰 딜부터 남기는데, 우리 딜은 우리가 고른 것이라 추천·
  // 댓글이 0에서 시작한다 — 뽐뿌 핫딜(댓글 수십)과 같은 잣대로 재면 **영원히
  // 꼴찌**다. 실측(2026-08-06 라이브): 등록한 딜이 피드 106칸에 한 번도 안 나왔다.
  // 화제성으로 경쟁시킬 대상이 아니다. 애드핏 대응의 핵심 산출물이고,
  // 수수료가 나오는 유일한 자리이기도 하다.
  const isOurs = (it) => it && it.via === "ourdeal";
  const oursIdx = dealIdx.filter((i) => isOurs(list[i]));
  const rivalIdx = dealIdx.filter((i) => !isOurs(list[i]));
  const ranked = [...rivalIdx].sort((a, b) => dealHeat(list[b]) - dealHeat(list[a]));

  const keep = new Set(oursIdx);
  let lastKept = -Infinity;
  for (const i of ranked) {
    if (keep.size - oursIdx.length >= keepCount) break;
    // 이미 남긴 딜과 너무 붙어 있으면 이 건은 넘긴다. 뭉쳐 보이는 원인이
    // 개수가 아니라 **간격**이었다(연달아 2~4개).
    let tooClose = false;
    for (const k of keep) if (Math.abs(k - i) < minGap) { tooClose = true; break; }
    if (tooClose) continue;
    keep.add(i);
    lastKept = i;
  }
  void lastKept;

  // **지우지 않고 뒤로 민다.**
  //
  // 처음엔 넘치는 딜을 목록에서 걷어냈다. 그랬더니 한 페이지가 limit보다
  // 짧아졌고, 호출부는 그것을 "풀 소진"으로 읽어 무한스크롤을 멈췄다 —
  // 실기기(David 2026-08-06): "밑으로 내리니까 '새 화제글을 모으는 중'이라고
  // 뜨고 더 글이 안 떠 한참 동안." 후보 목록이 짧을 때는 뒤에서 채울 것도
  // 없어서, 지우는 방식으로는 "페이지를 채운다"와 "딜을 줄인다"를 동시에
  // 만족시킬 수 없다.
  //
  // 뒤로 밀면 길이가 그대로라 페이지는 늘 꽉 차고, 앞쪽(사용자가 실제로 보는
  // 자리)에는 가장 반응 큰 딜만 간격을 두고 남는다. 밀린 딜도 사라지지 않고
  // 뒤 페이지나 핫딜 모아보기에서 그대로 보인다.
  const front = list.filter((it, i) => !is(it) || keep.has(i));
  const back = list.filter((it, i) => is(it) && !keep.has(i));
  return front.concat(back);
}

export function ensureDealShare(items, deals, { share = DEAL_SHARE_DEFAULT, is = isDeal } = {}) {
  const list = Array.isArray(items) ? [...items] : [];
  const pool = (Array.isArray(deals) ? deals : []).filter((d) => !list.some((i) => i.id === d.id));
  if (!pool.length || !list.length) return list;
  const want = Math.floor(list.length * share);
  const have = list.filter(is).length;
  const need = Math.max(0, want - have);
  if (!need) return list;
  const step = Math.max(2, Math.floor(list.length / (need + 1)));
  for (let k = 0; k < need && k < pool.length; k++) {
    const at = Math.min(list.length, (k + 1) * step + k);
    list.splice(at, 0, pool[k]);
  }
  return list;
}
