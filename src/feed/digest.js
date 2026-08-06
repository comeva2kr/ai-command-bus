import { WEIGHTY } from "./interest.js";
// 브리핑 본문 생성 — 항목 나열이 아니라 "오늘 무슨 일이 있었는지 읽는 글".
//
// ── 왜 바꿨나 (2026-08-03)
// 카카오 애드핏 매체심사 보류 사유가 "자체 콘텐츠가 아닌 외부 콘텐츠·외부 링크가
// 많은 비중"이었다. 그 답으로 만든 것이 브리핑인데, 실물은 카테고리마다 똑같은
// 템플릿 한 줄("○○ 분야에서 가장 뜨거운 글은 …입니다") + 원문 발췌였다.
// 라이브 실측에서는 발췌 자리에 원문 URL과 영어 원문이 그대로 실리고 있었다:
//   "https://xcancel.com/karpathy/status/2083749667410727319"
//   "Qwen Studio offers comprehensive functionality spanning chatbot, …"
// 외부 콘텐츠 비중을 우리 손으로 증명하고 있던 셈이다.
//
// 구글 프로그램 정책은 "논평·큐레이션·기타 부가가치를 더하면 복제 콘텐츠가
// 아니다"라고 명시한다. 그 부가가치를 실제로 만드는 것이 이 파일의 일이다.
//
// ── 설계 원칙
// 1. **원문 문장을 한 줄도 쓰지 않는다.** 우리가 쓰는 문장의 재료는 오직 우리가
//    측정한 값이다 — 몇 개 매체가 함께 다뤘는지, 추천/댓글이 몇인지, 어느
//    커뮤니티에서 나왔는지, 몇 시간 만에 올라왔는지. 이건 원문 어디에도 없는
//    지금핫 고유 정보다. 제목은 인용부호 안에 넣어 출처를 밝히고 쓴다.
// 2. **없는 사실을 만들지 않는다.** 실측이 0인 지표는 문장에서 아예 뺀다.
//    "추천 0·댓글 86을 모으며 화제의 중심"은 자기모순이다(2026-07-31 검수 지적).
// 3. **한 템플릿을 반복하지 않는다.** 데이터의 모양이 다르면 문장도 달라야 한다 —
//    교차보도형·논쟁형·호응형·단독형으로 갈린다. 같은 문장이 열 번 반복되는 것이
//    애초에 "자체 콘텐츠로 안 보인다"는 판정을 받은 이유다.
// 4. LLM을 부르지 않는다. 아이템당 API 호출은 이 프로젝트의 제약을 벗어나고,
//    무엇보다 측정값에서 결정적으로 유도된 문장이라야 매번 같은 입력에 같은
//    글이 나온다(재현 가능·검증 가능).
import { extractTags } from "./tags.js";
import { eventKey } from "./dedupe.js";

// ---------------------------------------------------------------------------
// 이슈 묶기 — 같은 사건을 다룬 글들을 한 덩어리로
// ---------------------------------------------------------------------------

// 두 글이 같은 이슈인가. 판단 재료는 (a) 정규화 제목 완전일치, (b) 내용 태그 겹침.
// 부분 유사도(자카드 임계값)는 쓰지 않는다 — 임계값이 감이 되기 쉽고, 잘못
// 묶이면 서로 다른 사건이 한 문단에 뒤섞여 사실이 아닌 글이 된다.
// 태그는 사전 기반이라 "메모리·D램" 같은 고유명사가 겹칠 때만 묶인다.
function sharedTagCount(a, b) {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  let n = 0;
  for (const t of b) if (set.has(t)) n++;
  return n;
}

export function clusterIssues(items, { minShared = 2 } = {}) {
  const enriched = items.map((i) => ({
    item: i,
    tags: (i.tags && i.tags.length ? i.tags : extractTags(i.title)) || [],
    key: eventKey(i.title)
  }));
  const clusters = [];
  for (const e of enriched) {
    let placed = null;
    for (const c of clusters) {
      const same = c.members.some(
        (m) => (m.key && m.key === e.key) || sharedTagCount(m.tags, e.tags) >= minShared
      );
      if (same) { placed = c; break; }
    }
    if (placed) placed.members.push(e);
    else clusters.push({ members: [e] });
  }
  return clusters.map((c) => c.members.map((m) => m.item));
}

// ---------------------------------------------------------------------------
// 측정값 → 문장
// ---------------------------------------------------------------------------

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, "")}만`;
  return String(v);
};

// 이 묶음의 성격을 데이터 모양으로 판정한다. 문장 형태가 여기서 갈린다.
export function issueShape(items) {
  const outlets = new Set(items.map((i) => i.sourceLabel || i.source)).size;
  const coverage = Math.max(...items.map((i) => i.coverage || 0), 0);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  if (coverage >= 3 || outlets >= 3) return "coverage";   // 여러 매체가 동시에
  // 매체가 하나뿐이어도 지금 사람들이 몰려 찾아보는 사안이면 그게 이유다.
  if (items.some((i) => i.interest && i.interest.how === "term")) return "interest";
  if (comments >= 100 && comments > score) return "debate"; // 댓글이 추천을 앞선다
  if (score >= 100) return "applause";                     // 추천이 크다
  return "single";
}

// 이슈 제목 — 원문 제목을 그대로 쓰지 않는다. 대표 글 제목은 본문 안에서
// 인용부호로 밝히고, 헤드라인은 우리가 관측한 것을 요약한 한 줄로 만든다.
// (Techmeme이 아웃링크 집합을 자체 저작물로 만드는 방식과 같은 원리다.)
// 이 이슈를 무엇이라 부를 것인가. 묶인 글들의 제목에서 **가장 여러 편이
// 함께 쓴 낱말**을 고른다. 우리가 요약해서 지어낸 말이 아니라, 매체들이
// 그 사건을 부를 때 실제로 쓴 말이라 사실에서 벗어날 여지가 없다.
// 한 편에만 나오는 낱말은 그 매체의 표현일 뿐이므로 쓰지 않는다.
export function issueSubject(items, { max = 2 } = {}) {
  const count = new Map();
  for (const i of items) {
    const seen = new Set();
    for (const w of String(i.title || "").split(/[^가-힣a-zA-Z0-9]+/)) {
      if (w.length < 2) continue;
      if (seen.has(w)) continue;      // 한 제목 안의 반복은 한 번만 센다
      seen.add(w);
      count.set(w, (count.get(w) || 0) + 1);
    }
  }
  const shared = [...count.entries()]
    .filter(([, n]) => n >= 2)        // 최소 두 편이 함께 쓴 말
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
  if (shared.length) return shared.join(" ");

  // 우리 풀에 그 사건 글이 하나뿐일 때 — 흔한 경우다. 교차보도 5건은 구글이
  // "관련 기사가 5개 있다"고 알려 준 숫자이지, 우리가 5편을 갖고 있다는 뜻이
  // 아니다. 그래서 공통어를 뽑을 대상이 없다.
  //
  // 이때는 그 매체가 쓴 제목에서 앞 구절을 따온다. 요약해서 지어내는 것보다
  // 낫다 — 우리가 만들어 낸 표현이면 사실에서 벗어날 수 있지만, 따온 말은
  // 그 매체가 실제로 쓴 말이다. 헤드라인 전체가 아니라 우리 문장 안에
  // 인용부호로 들어가므로 제목 나열과는 다르다.
  return leadPhrase(items[0] && items[0].title);
}

// 제목의 앞 구절. 부제·인용이 시작되는 지점(…, —, [ ) 앞에서 자르고,
// 너무 길면 낱말 경계에서 끊는다. 억지로 자른 티가 나면 안 된다.
export function leadPhrase(title, { max = 20 } = {}) {
  let t = String(title || "").trim();
  if (!t) return "";
  // 말머리를 먼저 떼어 낸다 — "[속보]", "【단독】", "(종합)". 사건 이름이 아니라
  // 편집 표시다. 안 떼면 이름이 통째로 "속보"가 된다.
  // 실측: 라이브 이슈 6개 중 2개가 이 때문에 이름을 못 얻고
  // "5개 매체가 동시에 다룬 사안"으로 남았다.
  for (let n = 0; n < 3; n++) {
    const stripped = t.replace(/^\s*[[【(<][^\]】)>]{0,12}[\]】)>]\s*/, "");
    if (stripped === t) break;
    t = stripped;
  }
  // 그다음 부제가 시작되는 지점에서 자른다.
  t = t.split(/[…·|]|—|\.\.\.|\s-\s/).map((x) => x.trim()).find(Boolean) || "";
  t = t.replace(/^["“'‘\s]+/, "").replace(/["”'’\s]+$/, "");
  if (t.length > max) {
    const cut = t.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    t = (sp >= 8 ? cut.slice(0, sp) : cut).trim();
  }
  return tidyPhrase(t);
}

// 잘라 온 구절을 우리 문장 안에 인용부호로 넣는다. 그래서 **짝이 안 맞는
// 따옴표가 남으면 안 된다** — 실측에서 이렇게 나왔다:
//   5개 매체가 다룬 “이 대통령 “북한과 대결, 정무적
// 열린 따옴표가 닫히지 않아 문장이 깨져 보인다. 꼬리 쉼표도 마찬가지다
// ("Bending Spoons,"). 잘라 낸 자리에 남은 부호는 말이 아니라 흔적이다.
export function tidyPhrase(text) {
  let t = String(text || "");
  const OPEN = /[“‘"']/g, CLOSE = /[”’"']/g;
  // 짝이 맞지 않으면 안쪽 따옴표를 통째로 없앤다. 어느 쪽이 짝인지 추측하는
  // 것보다 낫다 — 추측이 틀리면 뜻이 바뀐다.
  const opens = (t.match(/[“‘]/g) || []).length, closes = (t.match(/[”’]/g) || []).length;
  if (opens !== closes) t = t.replace(/[“”‘’]/g, "");
  const q = (t.match(/["']/g) || []).length;
  if (q % 2 === 1) t = t.replace(/["']/g, "");
  void OPEN; void CLOSE;
  // 잘린 자리에 남은 이음 부호
  return t.replace(/[\s,·、:;\-–—]+$/, "").trim();
}

export function issueHeadline(items, shape) {
  const lead = items[0];
  const label = lead.sourceLabel || lead.source;
  const outlets = new Set(items.map((i) => i.sourceLabel || i.source)).size;
  const coverage = Math.max(...items.map((i) => i.coverage || 0), 0);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  // 헤드라인에 그 이슈를 구별하는 **측정값**을 넣는다. 넣지 않으면 같은 소스에서
  // 나온 별개 이슈가 "해커뉴스에서 크게 호응받은 글"로 똑같이 반복된다(실측).
  switch (shape) {
    case "coverage": {
      // 개수만 쓰면 **여섯 이슈가 전부 "5개 매체가 동시에 다룬 사안"**이 된다
      // (2026-08-05 라이브 실측). 구분이 안 되면 헤드라인이 아니다.
      // 무엇에 관한 것인지 함께 말한다 — 우리가 지어낸 말이 아니라 매체들이
      // 그 사건을 부를 때 실제로 함께 쓴 낱말이다.
      // **개수를 쓰지 않는다.** coverage는 구글뉴스 관련기사 목록의 길이인데
      // 그 목록에는 상한이 있다(fetchers.js COVERAGE_MAX = 5, 실측: 사실상 0 아니면 5).
      // 상한에 걸린 값을 "5개 매체"라는 정확한 수치인 양 말하면 거짓이 된다 —
      // editorial.js는 이미 같은 이유로 숫자를 버리고 "여러 곳"만 쓰기로 정해 뒀는데,
      // digest.js만 그 규칙 밖에 있었다.
      //
      // 실측(2026-08-06 라이브): 홈에 나간 이슈 6건이 **전부** "5개 매체가 다룬"이었고,
      // 그중에는 우리 피드에 단 한 곳(KBS뉴스)에서만 들어온 것도 있었다.
      // 하필 그 문장이 애드핏 재심사용 자체 콘텐츠의 맨 앞자리였다.
      void coverage;
      const subject = issueSubject(items);
      return subject ? `여러 매체가 다룬 “${subject}”` : `여러 매체가 동시에 다룬 사안`;
    }
    case "interest": {
      const m = items.find((i) => i.interest && i.interest.how === "term").interest;
      return m.traffic > 0 ? `지금 검색이 몰리는 “${m.term}”` : `지금 검색이 몰리는 “${m.term}”`;
    }
    case "debate":
      return `${label} · 댓글 ${fmt(comments)}건의 논쟁`;
    case "applause":
      return `${label} · 추천 ${fmt(score)}건`;
    default:
      return comments > 0 ? `${label} · 댓글 ${fmt(comments)}건`
                          : `${label} 상위 글`;
  }
}

// 매체 이름 목록. **개수를 세지 않는다.**
//
// 라이브 실측(2026-08-06): "우리 피드에는 donga.com·동아일보 등 2곳에서 들어왔다."
// 같은 신문사인데 한 소스는 도메인, 다른 소스는 한글 사명으로 라벨이 붙어 있어서
// 한 곳을 2곳으로 세고 있었다. 캡값 숫자를 걷어내면서 "우리가 센 것만 쓴다"고
// 해 놓고 정작 그 센 값이 부정확했던 것이다.
//
// 로마자(donga.com)와 한글(동아일보)은 **문자열로는 합칠 수 없다.** 억지로
// 합치려다 서로 다른 매체를 하나로 묶으면 더 나쁜 거짓말이 된다. 그래서
// 합치지 않고 **수를 안 쓴다** — 이름만 밝히면 세는 문제 자체가 사라진다.
// 표시에서 도메인 꼬리는 떼어 읽기 좋게만 다듬는다(같은 곳을 가리키는 값이다).
export function distinctOutlets(items) {
  const seen = new Set();
  const out = [];
  for (const i of items) {
    const raw = String(i.sourceLabel || i.source || "").trim();
    if (!raw) continue;
    const pretty = raw.replace(/\.(com|co\.kr|kr|net|org)$/i, "");
    if (seen.has(pretty)) continue;
    seen.add(pretty);
    out.push(pretty);
  }
  return out;
}

// 이슈 본문 — 전부 측정값으로만 쓴다. 0인 지표는 문장에서 뺀다.
export function issueParagraph(items, shape) {
  const lead = items[0];
  const title = String(lead.title || "").trim();
  const outlets = distinctOutlets(items);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const score = items.reduce((s, i) => s + (i.score || 0), 0);
  const parts = [];

  if (shape === "coverage") {
    // 여기서도 개수를 쓰지 않는다(위 issueHeadline의 이유와 같다).
    // **우리가 실제로 센 것만 말한다** — 우리 피드에 들어온 출처 이름이 그것이다.
    // 교차보도는 "여러 곳이 함께 다루고 있다"는 사실만 전하고 수를 붙이지 않는다.
    const named = outlets.slice(0, 3).join("·");
    parts.push(`“${title}” 소식을 여러 매체가 함께 다루고 있다. 우리 피드에는 ${named}에서 들어왔다.`);
    // 대표 글과 **같은 제목**은 빼고 소개한다. 라이브 실측(2026-08-06):
    // "같은 흐름에서 「與서울의원들, 오늘 부동산 세제 개편안 논의」도 상위에
    // 올랐다" — 바로 윗줄에서 소개한 그 글이었다. 같은 사건을 여러 매체가
    // 같은 제목으로 쓰면 이렇게 겹친다.
    const seenTitle = new Set([title]);
    const others = items.slice(1)
      .map((i) => String(i.title || "").trim())
      .filter((t) => t && !seenTitle.has(t) && (seenTitle.add(t), true))
      .slice(0, 2)
      .map((t) => `“${t}”`)
      .join(", ");
    if (others) parts.push(`같은 흐름에서 ${others}도 상위에 올랐다.`);
  } else if (shape === "debate") {
    parts.push(`“${title}”을 두고 댓글 ${fmt(comments)}건이 달리며 논쟁이 이어졌다.`);
    if (score > 0) parts.push(`추천은 ${fmt(score)}건으로 댓글 수에 못 미친다 — 합의보다 이견이 큰 주제다.`);
    else parts.push(`추천보다 댓글이 앞서는 전형적인 논쟁형 흐름이다.`);
  } else if (shape === "applause") {
    parts.push(`“${title}”이 ${outlets[0]}에서 추천 ${fmt(score)}건을 모았다.`);
    if (comments > 0) parts.push(`댓글은 ${fmt(comments)}건이다.`);
  } else {
    parts.push(`${outlets[0]} 상위에 “${title}”이 올라 있다.`);
    if (comments > 0) parts.push(`댓글 ${fmt(comments)}건이 달렸다.`);
    else if (score > 0) parts.push(`추천 ${fmt(score)}건을 받았다.`);
  }
  if (items.length > 2 && shape !== "coverage") {
    parts.push(`같은 주제로 ${items.length}건이 함께 올라왔다.`);
  }
  return parts.join(" ");
}

// 감정/성격 태그 — 라벨도 측정값에서 나온다(감정 분석이 아니다).
export function issueTone(shape) {
  return { coverage: "다발 보도", debate: "논쟁", applause: "호응", single: "단독" }[shape] || "단독";
}

// ---------------------------------------------------------------------------
// 브리핑 한 편
// ---------------------------------------------------------------------------

// slot: 하루 편성. 수집이 멈춘 시간대에 빈 글이 발행되지 않도록 호출부가
// MIN_ISSUES로 막는다(server/engine).
// ── 하루 3편, 시간대마다 성격이 다르다 (David 2026-08-04)
//
// "15분마다 갱신될 필요는 없지 않니? 사람들 활동시간 기준으로 아침 점심
//  저녁에만 한번씩 브리핑 해도 될 것 같은데 내용 충실하게 해서.
//  아침 브리핑이면 지난 밤 있던 얘기들 위주에 해외 핫토픽을 한글로 정리해서
//  올리는 게 많을 거고 점심 저녁은 국내 비중이 많을 수 있고."
//
// 그래서 슬롯마다 두 가지가 달라진다:
//   windowHours — 어느 구간의 글을 볼 것인가
//   overseasBias — 해외 소스를 얼마나 앞에 둘 것인가 (1이면 가중 없음)
//
// 아침은 한국이 자는 동안 쌓인 해외 이야기가 주된 새 정보다. 국내 커뮤니티는
// 밤사이 조용하고, 반대로 해커뉴스·Techmeme은 그 시간이 한창이다.
// 점심·저녁은 국내가 활발하므로 가중을 두지 않는다 — 자연스러운 반응량으로
// 겨루게 둔다.
export const SLOTS = [
  {
    id: "morning", label: "모닝", fromHour: 5, toHour: 11,
    publishHour: 7,
    windowHours: 12,      // 전날 저녁부터 오늘 아침까지 — 자는 동안 있었던 일
    overseasBias: 1.6,
    lead: "밤사이 해외에서 오간 이야기부터"
  },
  {
    id: "lunch", label: "런치", fromHour: 11, toHour: 17,
    publishHour: 12,
    windowHours: 6,
    overseasBias: 1,
    lead: "오전에 가장 많이 오간 이야기"
  },
  {
    id: "evening", label: "이브닝", fromHour: 17, toHour: 5,
    publishHour: 19,
    windowHours: 7,
    overseasBias: 1,
    lead: "오늘 하루 가장 크게 번진 이야기"
  }
];

export const slotById = (id) => SLOTS.find((s) => s.id === id) || SLOTS[0];

// 해외 소스인가 — 언어로 판별한다. kind는 community/news로 갈릴 뿐 국적을
// 말해 주지 않고(해커뉴스가 community다), 소스 목록을 하드코딩하면 소스를
// 추가할 때마다 여기도 고쳐야 한다.
export const isOverseas = (item) =>
  Boolean(item && ((item.originalLang && item.originalLang !== "ko") ||
    (item.lang && item.lang !== "ko") || item.translated));

export const MIN_ISSUES = 3; // 이보다 적으면 발행하지 않는다 — 빈 글은 자체 콘텐츠가 아니다

export function slotForHour(kstHour) {
  if (kstHour >= 5 && kstHour < 11) return SLOTS[0];
  if (kstHour >= 11 && kstHour < 17) return SLOTS[1];
  return SLOTS[2];
}

// items: 이미 필터링된(성인·정치·광고 제외) 화제성 순 배열.
// 반환: { issues:[{headline, paragraph, tone, refs:[{id,title,sourceLabel,...}]}], summary }
export function buildDigest(items, { maxIssues = 6, perIssueRefs = 4, maxPerSource = 2 } = {}) {
  const clusters = clusterIssues(items);

  // ── 이슈 정렬: 반응 총량이 아니라 **중요도** 순 (David 2026-08-05)
  //
  // 예전엔 `반응 총량 + 교차보도×60`이었다. 원점수를 그대로 더하니 반응 하나가
  // 나머지를 전부 눌렀다 — 실측(2026-08-05 라이브 모닝 브리핑)에서 대표 이슈가
  //   1. 해커뉴스 · 추천 907건   2. 해커뉴스 · 댓글 357건
  //   3. 보배드림 · 추천 342건   4. 보배드림 · 추천 311건
  // 이렇게 나왔다. David가 지적한 "사적·매니악함"이 바로 이 정렬의 결과다.
  //
  // ── 반응은 로그로 누른다
  // 소스마다 추천의 의미가 다르다(더쿠 16만 vs 인벤 수백). 원점수를 더하면
  // 스케일 큰 소스가 통째로 가져간다. log10으로 누르면 907과 3421의 차이가
  // 2.96 대 3.53으로 줄어 **"많이 받았다"는 사실만 남고 스케일은 사라진다.**
  //
  // ── 중요도는 세 가지로 잰다 (전부 실측값 기준)
  //   교차보도  ×80 — 여러 매체가 같은 날 동시에 다뤘다는 것은 그 사건이
  //                   중요하다는 가장 단단한 신호다. 우리가 매긴 값이 아니다.
  //   검색 급상승 ≤250 — 지금 사람들이 실제로 찾아보고 있는가(구글 검색량).
  //   무게 있는 분야 105 — 경제·정책·사회·정치. David가 이름 붙인 축이다.
  // 250과 105는 기존 점수 분포의 상위 10%·25%에서 그대로 가져왔다.
  //
  // 결과: 5개 매체가 다룬 사안(400)이 추천 907건짜리 글(178)보다 앞선다.
  // 커뮤니티 글을 빼는 게 아니다 — 중요한 사건 **다음에** 놓는다.
  const REACTION_K = 60;
  const COVERAGE_K = 80;
  const INTEREST_MAX = 250;
  const WEIGHTY_BONUS = 105;
  const scored = clusters.map((members) => {
    const eng = members.reduce((s, i) => s + (i.score || 0) + (i.commentCount || 0) * 2, 0);
    const cov = Math.max(...members.map((i) => i.coverage || 0), 0);
    const best = members.reduce((m, i) => {
      const t = i.interest ? (i.interest.traffic || 0) * (i.interest.strength || 1) : 0;
      return t > m ? t : m;
    }, 0);
    const weighty = members.some((i) => WEIGHTY.has(i.category)) ? WEIGHTY_BONUS : 0;
    return {
      members,
      weight: Math.log10(1 + Math.max(0, eng)) * REACTION_K
        + cov * COVERAGE_K
        + INTEREST_MAX * Math.min(1, best / 1000)
        + weighty
    };
  }).sort((a, b) => b.weight - a.weight);

  // 한 소스가 브리핑을 독식하지 않게 상한을 둔다.
  //
  // 실측(2026-08-03): 상한 없이 뽑으니 이슈 1~4위가 전부 더쿠였다. 소스마다
  // score의 의미와 스케일이 달라서(더쿠는 추천 16만, 인벤은 수백) 반응량으로만
  // 정렬하면 스케일이 큰 소스가 통째로 가져간다. 그러면 "오늘의 브리핑"이
  // 아니라 "더쿠 모음"으로 읽힌다 — 자체 콘텐츠로 보이려면 오늘 전체를
  // 훑었다는 것이 드러나야 한다.
  //
  // 근본 해결은 소스 간 점수 정규화이고 그건 별건이다. 여기서는 브리핑이
  // 목적을 잃지 않도록 편성 단계에서 막는다.
  const perSource = new Map();
  const balanced = [];
  for (const c of scored) {
    const src = c.members[0].sourceLabel || c.members[0].source || "?";
    if ((perSource.get(src) || 0) >= maxPerSource) continue;
    perSource.set(src, (perSource.get(src) || 0) + 1);
    balanced.push(c);
    if (balanced.length >= maxIssues) break;
  }
  // 공급이 얇아 상한 때문에 못 채우면 상한을 풀어 채운다(빈 브리핑보다 낫다)
  if (balanced.length < Math.min(maxIssues, scored.length)) {
    for (const c of scored) {
      if (balanced.includes(c)) continue;
      balanced.push(c);
      if (balanced.length >= maxIssues) break;
    }
  }

  const issues = balanced.map(({ members }) => {
    const shape = issueShape(members);
    return {
      headline: issueHeadline(members, shape),
      paragraph: issueParagraph(members, shape),
      tone: issueTone(shape),
      shape,
      // 참조 글은 **제목과 우리 지표만** 넘긴다. summary(원문 발췌)는 넘기지 않는다 —
      // 브리핑에 외부 본문이 실리는 것이 애드핏 지적의 직접적 근거였다.
      refs: members.slice(0, perIssueRefs).map((i) => ({
        id: i.id, title: i.title, sourceLabel: i.sourceLabel || i.source,
        score: i.score || 0, commentCount: i.commentCount || 0, coverage: i.coverage || 0
      }))
    };
  });

  return { issues, summary: buildSummary(issues, items) };
}

// 종합 문단 — 이슈들의 성격 분포를 한 문장으로. 여기서도 새 사실을 만들지 않는다.
export function buildSummary(issues, items) {
  if (!issues.length) return "";
  const byTone = {};
  for (const i of issues) byTone[i.tone] = (byTone[i.tone] || 0) + 1;
  const outlets = new Set(items.map((i) => i.sourceLabel || i.source)).size;
  const bits = [];
  bits.push(`커뮤니티·매체 ${outlets}곳에서 모은 ${items.length}건을 ${issues.length}개 이슈로 정리했다.`);
  const cov = byTone["다발 보도"] || 0;
  const deb = byTone["논쟁"] || 0;
  if (cov && deb) bits.push(`여러 매체가 동시에 다룬 사안이 ${cov}건, 댓글이 길게 이어진 논쟁이 ${deb}건이다.`);
  else if (cov) bits.push(`이 중 ${cov}건은 여러 매체가 동시에 다뤘다.`);
  else if (deb) bits.push(`이 중 ${deb}건은 추천보다 댓글이 앞서는 논쟁형이다.`);
  return bits.join(" ");
}
