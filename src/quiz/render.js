// Server-rendered HTML for the quiz pages. Three surfaces:
//   /q                → index of published quizzes
//   /q/<slug>         → the quiz itself (one question per screen, client JS)
//   /q/<slug>/r/<code> → a *result* page with its own OG tags — the viral
//                       loop: people share their result, the preview shows
//                       "나는 ○○!", and the CTA sends the next person back
//                       into the quiz.
//
// The result page carries the credibility devices from docs/quiz-design.md:
//   - 축별 퍼센트 바 (개인 응답 기반 — ?p= 쿼리로 전달; 공유 링크에는 없음)
//   - "응답자 중 N%" 희소성 통계 (실응답 누적)
//   - 강점("이건 인정") 4 + 성장 포인트("팩폭 포인트") 1~2 (80:20 — 칭찬만 하면 가짜같이 느껴진다)
//   - 궁합 (잘 맞는/상극 케미 유형, 두 번째 참여자를 부르는 장치) — 헤딩 라벨은
//     pack.manifest.json의 result_labels_ko가 원본, 이 파일은 그걸 로드만 한다.
//   - 스크린샷 완결형 결과 카드 (유형색 + 제목 + 테스트명이 한 화면에)
//   - "재미로 보는" 면책 라벨
//
// Ad slots are placeholder <div>s (.ad-slot) between screens; swap in the ad
// network snippet at deploy time.

import { CONTRACT } from "./manifest.js";

// 결과 페이지 헤딩 라벨 — 선언 원본은 매니페스트 (pack_contract.result_labels_ko).
// 8팀 적대 검수: "환장의 케미"가 밈 오용(뜻이 반대로 읽힘)이라 "상극 케미"로 교체.
const LABELS = CONTRACT.result_labels_ko;

// 복붙 공유 블록 템플릿 — 선언 원본은 매니페스트 (pack_contract.share_block_template_ko).
// David 실사용 피드백(2026-07-25): shareText 한 줄만 복사되면 받는 사람이
// 무슨 테스트/유형인지, 어디를 눌러야 하는지 모른다 — 붙여넣으면 그 자체로
// 완결되는 여러 줄 블록으로 조립한다.
const SHARE_BLOCK_TEMPLATE = CONTRACT.share_block_template_ko;

// 템플릿 줄 배열 + 변수 → 완성된 블록 문자열. {sharePercent}가 없으면(공유
// 유입 등 응답 통계 미제공) 그 줄에서 "— 응답자 중 {sharePercent}%"처럼
// em-dash로 이어진 절 전체를 들어낸다 — 빈 괄호/빈 퍼센트를 남기지 않는다.
export function buildShareBlock(templateLines, vars = {}) {
  const lines = (Array.isArray(templateLines) ? templateLines : [])
    .map((line) => {
      let out = String(line);
      if (vars.sharePercent == null && out.includes("{sharePercent}")) {
        out = out.replace(/\s*—\s*[^{}]*\{sharePercent\}[^{}]*/gu, "").trimEnd();
      }
      // {levelPercent} — David 확정(2026-07-26): 레벨형 결과 전용 자리.
      // combo_types거나 개인 응답 정보가 없으면 그 줄 전체를 들어낸다(빈
      // 절만 지우는 sharePercent와 달리, 이 줄은 통째로 레벨형 전용이라
      // 줄 자체를 생략한다).
      if (vars.levelPercent == null && out.includes("{levelPercent}")) {
        return null;
      }
      for (const [key, val] of Object.entries(vars)) {
        out = out.split(`{${key}}`).join(val == null ? "" : String(val));
      }
      return out;
    })
    .filter((line) => line !== null);
  return lines.join("\n");
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 유형 코드 → 고정 색상 (결과 카드/미리보기 식별용). 코드가 같으면 늘 같은 색.
function typeColor(code) {
  let h = 0;
  for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 60% 55%)`;
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0e0f13;color:#e8eaf0;font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;line-height:1.6}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:16px 0 8px}
h2{font-size:1.05rem;margin:20px 0 8px;color:#c3cadb}
.desc{color:#9aa3b2}
.card{background:#171922;border:1px solid #262a38;border-radius:14px;padding:20px;margin:16px 0}
.result-card{border-width:2px;text-align:center}
.badge{display:inline-block;background:#1d2230;border:1px solid #2c3350;border-radius:999px;padding:4px 12px;font-size:.8rem;color:#9aa3b2;margin:4px 2px}
button.opt{display:block;width:100%;text-align:left;background:#1d2230;color:#e8eaf0;border:1px solid #2c3350;border-radius:10px;padding:14px 16px;margin:8px 0;font-size:1rem;cursor:pointer}
button.opt:hover{border-color:#4f8cff}
.progress{height:6px;background:#262a38;border-radius:3px;overflow:hidden;margin:12px 0}
.progress i{display:block;height:100%;background:#4f8cff;transition:width .2s}
.pcount{font-size:.8rem;color:#6b7280;text-align:right;margin:4px 0 12px}
.big{background:#4f8cff;color:#fff;border:0;border-radius:10px;padding:14px 24px;font-size:1.05rem;cursor:pointer;text-decoration:none;display:inline-block}
.share{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;justify-content:center}
.share button,.share a{background:#1d2230;border:1px solid #2c3350;color:#e8eaf0;border-radius:10px;padding:10px 14px;font-size:.95rem;cursor:pointer;text-decoration:none}
.ad-slot{min-height:90px;border:1px dashed #2c3350;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#4a5164;font-size:.8rem;margin:16px 0}
.axis{margin:14px 0}
.axis .labels{display:flex;justify-content:space-between;font-size:.85rem;color:#9aa3b2}
.axis .labels b{color:#e8eaf0}
.axis .bar{height:10px;background:#262a38;border-radius:5px;overflow:hidden;margin-top:4px}
.axis .bar i{display:block;height:100%}
ul.plain{padding-left:20px}
ul.plain li{margin:6px 0}
.match{display:flex;gap:12px}
.match>div{flex:1;background:#1d2230;border:1px solid #2c3350;border-radius:10px;padding:12px;text-align:center}
.match .tag{font-size:.75rem;color:#9aa3b2}
.match .reason{font-size:.72rem;color:#6b7280;margin-top:4px}
.fineprint{font-size:.75rem;color:#4a5164;text-align:center;margin-top:24px}
.hidden{display:none}
a{color:#4f8cff}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d2230;border:1px solid #2c3350;color:#e8eaf0;padding:10px 16px;border-radius:10px;font-size:.9rem;z-index:999;opacity:0;transition:opacity .2s;pointer-events:none}
`;

// ogImage: absolute URL of a PNG (카카오톡/페이스북/트위터 크롤러는 SVG를
// 렌더하지 못한다 — 기본값은 /icon.svg인데 그건 SVG라 실질적으로 미리보기가
// 깨져 있었다). 지정 없으면 기존처럼 icon.svg로 (인덱스 페이지 등).
function head(title, desc, url, origin, ogImage) {
  const image = ogImage || `${origin}/icon.svg`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="핫이슈 테스트">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
${ogImage ? `<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n` : ""}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<style>${STYLE}</style></head><body><div class="wrap">`;
}

const FOOT = `</div></body></html>`;

const AD = `<div class="ad-slot">AD — 광고 코드 삽입 위치</div>`;

const FINEPRINT = `<p class="fineprint">재미로 보는 심리 경향 테스트입니다 · 전문 심리검사가 아니에요</p>`;

export function renderIndexPage(records, origin) {
  const items = records
    .map(
      (r) => `<div class="card"><a href="/q/${esc(r.slug)}"><strong>${esc(r.quiz.title)}</strong></a>
<p class="desc">${esc(r.quiz.description)}</p></div>`
    )
    .join("\n");
  return (
    head("핫이슈 테스트 모음", "이번 주 화제의 이슈로 만든 유형테스트", `${origin}/q`, origin) +
    `<h1>핫이슈 테스트 🔥</h1><p class="desc">매주 커뮤니티 핫토픽으로 새 테스트가 올라와요.</p>` +
    AD +
    (items || `<p class="desc">아직 공개된 테스트가 없어요.</p>`) +
    FINEPRINT +
    FOOT
  );
}

export function renderQuizPage(record, origin) {
  const { slug, quiz } = record;
  const url = `${origin}/q/${esc(slug)}`;
  const qCount = quiz.questions.length;
  const axisChips = quiz.axes
    .map((a) => `<span class="badge">${esc(a.name)}: ${esc(a.left.label)} ↔ ${esc(a.right.label)}</span>`)
    .join(" ");
  // 소요 시간 — 문항수 기반 올림 처리 단일 값(이전엔 min~max round가 같은
  // 값끼리 겹쳐 "약 2~2분" 같은 티가 나는 버그가 있었다. 분 계산 로직을
  // 범위 대신 올림 한 값으로 고쳤다).
  const estMinutes = Math.max(1, Math.ceil(qCount / 5));
  // 이 테스트가 알아보는 것 — David 확정(2026-07-26): 테마 hook을 크게
  // 보여주고 그 아래 축 intro를 나열한다(테마가 주인). hook_ko/axes intro가
  // 없는 과거 데이터(하위호환)는 있는 부분만 조용히 렌더한다.
  const themeHook = quiz.theme && quiz.theme.hook_ko;
  const axesWithIntro = quiz.axes.filter((a) => a && a.intro);
  const axisIntroSection =
    themeHook || axesWithIntro.length
      ? `<div class="card">
<h2>이 테스트가 알아보는 것</h2>
${themeHook ? `<p style="font-size:1.1rem;font-weight:600;margin-bottom:8px">${esc(themeHook)}</p>` : ""}
<ul class="plain">${axesWithIntro.map((a) => `<li><b>${esc(a.name)}</b> — ${esc(a.intro)}</li>`).join("")}</ul>
</div>`
      : "";
  // 이 테스트가 재는 것 — David 확정(2026-07-26): weeklyBrief의 의미가
  // "이번 주 소재 사전설명"에서 "이 테스트가 재는 것" 설명으로 바뀌었다
  // (테마가 주인이 되면서 주간 소재 종속성이 사라졌다). weeklyBrief 없는
  // 과거 데이터(하위호환)는 카드 자체를 생략한다.
  const brief = Array.isArray(quiz.weeklyBrief) ? quiz.weeklyBrief : [];
  const briefSection = brief.length
    ? `<div class="card">
<h2>이 테스트가 재는 것</h2>
<ul class="plain">${brief.map((b) => `<li><b>${esc(b.topic)}</b> — ${esc(b.intro)}</li>`).join("")}</ul>
</div>`
    : "";
  // 클라이언트 스크립트가 쓸 데이터. </script> 이탈 방지 이스케이프.
  const payload = JSON.stringify({ slug, axes: quiz.axes, questions: quiz.questions }).replace(/</g, "\\u003c");
  return (
    head(quiz.title, quiz.description, url, origin, `${origin}/q/${esc(slug)}/og/cover.png`) +
    `<div id="intro">
<h1>${esc(quiz.title)}</h1>
<p class="desc">${esc(quiz.description)}</p>
<div class="card">
<p class="desc" style="font-size:.85rem">이 테스트는 성향 축 ${quiz.axes.length}개를 각각 스펙트럼으로 측정해 ${quiz.results.length}가지 유형으로 판정합니다.</p>
<p style="margin-top:8px">${axisChips}</p>
<p class="desc" style="font-size:.85rem;margin-top:8px">${qCount}문항 · 약 ${estMinutes}분 · 정답은 없어요</p>
</div>
${axisIntroSection}
${briefSection}
${AD}
<div class="card" style="text-align:center"><button class="big" onclick="start()">테스트 시작하기 →</button></div>
</div>
<div id="quiz" class="hidden">
<div class="progress"><i id="bar" style="width:0%"></i></div>
<p class="pcount"><span id="pos">1</span> / ${qCount}</p>
<div class="card"><p id="qtext"></p><div id="opts"></div></div>
${AD}
</div>
<div id="done" class="hidden">
<div class="card"><p>결과 계산 중…</p></div>
</div>
<script>
const QUIZ=${payload};
let i=0;const picks=[];
function start(){document.getElementById('intro').classList.add('hidden');document.getElementById('quiz').classList.remove('hidden');show();}
function show(){
  const q=QUIZ.questions[i];
  document.getElementById('bar').style.width=Math.round(i/QUIZ.questions.length*100)+'%';
  document.getElementById('pos').textContent=i+1;
  document.getElementById('qtext').textContent='Q'+(i+1)+'. '+q.q;
  const box=document.getElementById('opts');box.innerHTML='';
  q.answers.forEach((a,ai)=>{
    const b=document.createElement('button');b.className='opt';b.textContent=a.text;
    b.onclick=()=>{picks.push(ai);i++;i<QUIZ.questions.length?show():finish();};
    box.appendChild(b);
  });
}
function finish(){
  document.getElementById('quiz').classList.add('hidden');
  document.getElementById('done').classList.remove('hidden');
  // 축별 스펙트럼 채점 — 서버(src/quiz/engine.js)와 동일한 규칙(50:50은 left)
  const pts={};QUIZ.axes.forEach(a=>pts[a.id]={left:0,right:0});
  QUIZ.questions.forEach((q,qi)=>{
    const ans=q.answers[picks[qi]];
    pts[q.axis][ans.pole]+=(ans.weight==null?1:ans.weight);
  });
  let code='';const percents=[];
  QUIZ.axes.forEach(a=>{
    const t=pts[a.id].left+pts[a.id].right;
    const lp=t===0?50:Math.round(pts[a.id].left/t*100);
    percents.push(lp);
    code+=(lp>=50?a.left.code:a.right.code);
  });
  // 통계 집계 (실패해도 결과 표시는 진행)
  fetch('/api/quiz/'+QUIZ.slug+'/response',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})}).catch(()=>{});
  location.href='/q/'+QUIZ.slug+'/r/'+encodeURIComponent(code)+'?p='+percents.join(',');
}
</script>` +
    FOOT
  );
}

// percents: 축 순서대로 left-pole 퍼센트 배열 (본인 응답일 때만; 공유 유입이면
// null → 개인 바 대신 "직접 해보면 내 퍼센트가 나온다"는 CTA 훅이 된다).
// stats: QuizStore.statsFor() 결과 (없으면 희소성 배지 생략).
export function renderResultPage(record, result, origin, opts = {}) {
  const { slug, quiz } = record;
  const { percents = null, stats = null } = opts;
  const url = `${origin}/q/${esc(slug)}/r/${esc(result.code)}`;
  const ogTitle = `나는 "${result.title}"! — ${quiz.title}`;
  const ogImageUrl = `${origin}/q/${esc(slug)}/og/${esc(result.code)}.png`;
  const color = typeColor(result.code);
  const byCode = new Map(quiz.results.map((r) => [r.code, r]));
  const best = byCode.get(result.bestMatch);
  const worst = byCode.get(result.worstMatch);

  const sharePercent = stats && stats.share && stats.share[result.code] != null ? stats.share[result.code] : null;
  const rarity = sharePercent != null ? `<span class="badge">지금까지 응답자 중 ${sharePercent}%가 이 유형</span>` : "";

  // 레벨형 결과 — David 확정(2026-07-26): "꼰대력 37%" 식으로 레벨 %를
  // 크게 보여준다. percents(본인 응답)가 없으면(공유 유입) 개인 수치를
  // 지어내지 않고 밴드 이름만 보여준다.
  const isLevelFormat = quiz.theme && quiz.theme.format === "level_bands";
  const levelPercent = isLevelFormat && percents ? percents[0] : null;
  const bandInfo = isLevelFormat
    ? (Array.isArray(quiz.bands) ? quiz.bands : []).find((b) => result.code.startsWith(b.code))
    : null;
  const levelHeadline = isLevelFormat
    ? `<p style="margin-top:6px;font-size:1rem">${esc(quiz.theme.name_ko)} ${
        levelPercent != null ? `<b style="font-size:1.6rem;color:${color}">${levelPercent}%</b>` : ""
      }${bandInfo ? ` — ${esc(bandInfo.label_ko)}` : ""}</p>`
    : "";

  // 복붙 공유 블록 — 붙여넣으면 그 자체로 완결(무슨 테스트/유형인지 + 링크).
  const shareBlock = buildShareBlock(SHARE_BLOCK_TEMPLATE, {
    title: quiz.title,
    typeTitle: result.title,
    sharePercent,
    levelPercent,
    shareText: result.shareText,
    url
  });
  // X는 글자수 제약 때문에 축약형: "{typeTitle} — {shareText} {url}".
  const tweetText = `${result.title} — ${result.shareText} ${url}`;

  const axisBars = quiz.axes
    .map((a, i) => {
      const lp = percents ? percents[i] : null;
      if (lp == null) {
        // 공유 유입: 이 유형이 어느 극 조합인지는 보여주되 퍼센트는 비워둔다
        const pole = result.code[i] === a.left.code ? a.left : a.right;
        return `<div class="axis"><div class="labels"><span>${esc(a.name)}</span><b>${esc(pole.label)}</b></div></div>`;
      }
      const domLeft = lp >= 50;
      return `<div class="axis">
<div class="labels"><span>${domLeft ? "<b>" : ""}${esc(a.left.label)} ${lp}%${domLeft ? "</b>" : ""}</span><span>${domLeft ? "" : "<b>"}${100 - lp}% ${esc(a.right.label)}${domLeft ? "" : "</b>"}</span></div>
<div class="bar"><i style="width:${lp}%;background:${color}"></i></div>
</div>`;
    })
    .join("\n");

  // 이 성향이 제일 티 나는 순간 — David 확정(2026-07-26): weeklyPick 라벨이
  // "이번 주 네 픽"(주간 소재 추천물)에서 "이 성향이 제일 티 나는 순간"으로
  // 바뀌었다(테마가 주인이 되며 주간 소재 종속성이 사라졌다). 라벨은
  // 매니페스트 result_labels_ko.weekly_pick이 원본. weeklyPick 없는 과거
  // 데이터(하위호환)는 조용히 생략한다.
  const weeklyPick = result.weeklyPick
    ? `<p class="desc" style="font-size:.85rem;margin-top:8px">📌 ${esc(LABELS.weekly_pick)} — ${esc(result.weeklyPick)}</p>`
    : "";

  // 회수 문장(evidenceLine) — David 확정(2026-07-26): "문항은 가리고 결과에서
  // 밝힌다" 원칙의 핵심 장치. 결과 카드 서술 바로 아래 작은 강조 줄로 보여준다.
  // 라벨은 매니페스트 result_labels_ko.evidence_line이 원본. evidenceLine
  // 없는 과거 데이터(하위호환)는 조용히 생략한다.
  const evidenceLine = result.evidenceLine
    ? `<p class="desc" style="font-size:.85rem;margin-top:8px">🔍 ${esc(LABELS.evidence_line)} — ${esc(result.evidenceLine)}</p>`
    : "";

  // 공유 인센티브 슬롯(R7) — 매니페스트 share_incentive.enabled 확인 후에만
  // 표시. 기본값 false면 아무것도 렌더하지 않는다(David 별도 결정 대기).
  const shareIncentive =
    CONTRACT.share_incentive && CONTRACT.share_incentive.enabled
      ? `<p class="desc" style="font-size:.85rem;margin-top:8px">🎁 공유하면 기부에 동참해요</p>`
      : "";

  return (
    head(ogTitle, result.shareText, url, origin, ogImageUrl) +
    `<div class="card result-card" style="border-color:${color}">
<p class="desc" style="font-size:.85rem">${esc(quiz.title)}</p>
<h1 style="color:${color}">${esc(result.title)}</h1>
${levelHeadline}
${rarity}
<p style="margin-top:10px">${esc(result.description)}</p>
${evidenceLine}
${weeklyPick}
</div>

<div class="card">
<h2>${percents ? "내 성향 스펙트럼" : "이 유형의 성향 축"}</h2>
${axisBars}
${percents ? "" : `<p class="desc" style="font-size:.85rem;margin-top:8px">직접 테스트하면 축마다 내 퍼센트가 나와요.</p>`}
</div>
${AD}
<div class="card">
<h2>${esc(LABELS.strengths)}</h2>
<ul class="plain">${result.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<h2>${esc(LABELS.weaknesses)}</h2>
<ul class="plain">${result.weaknesses.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<h2>${esc(LABELS.advice)}</h2>
<ul class="plain">${result.advice.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
</div>

<div class="card">
<h2>유형 케미</h2>
<div class="match">
<div><p class="tag">${esc(LABELS.best_match)}</p><p><a href="/q/${esc(slug)}/r/${esc(result.bestMatch)}">${esc(best ? best.title : result.bestMatch)}</a></p>${result.bestMatchReason ? `<p class="reason">${esc(result.bestMatchReason)}</p>` : ""}</div>
<div><p class="tag">${esc(LABELS.worst_match)}</p><p><a href="/q/${esc(slug)}/r/${esc(result.worstMatch)}">${esc(worst ? worst.title : result.worstMatch)}</a></p>${result.worstMatchReason ? `<p class="reason">${esc(result.worstMatchReason)}</p>` : ""}</div>
</div>
<p class="desc" style="font-size:.85rem;margin-top:10px">친구 결과랑 비교해보세요 — 케미가 맞는지 바로 나옵니다.</p>
</div>

<div class="card" style="text-align:center">
<p class="desc">${esc(result.shareText)}</p>
<div class="share">
<button onclick="shareLink()">📋 결과 복사</button>
<a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}" target="_blank" rel="noopener">X에 공유</a>
<button onclick="kakaoShare()">💬 카카오톡으로 공유</button>
<button onclick="webShare()">📱 공유하기</button>
<a href="${esc(ogImageUrl)}" download target="_blank" rel="noopener">🖼️ 결과 카드 저장</a>
</div>
${shareIncentive}
</div>
<p style="text-align:center"><a class="big" href="/q/${esc(slug)}" onclick="ctaClick()">나도 테스트 해보기 →</a></p>
<p style="text-align:center;margin-top:12px"><a href="/q">다른 테스트 보기</a></p>
${AD}
${FINEPRINT}
<div id="toast"></div>
<script>
const URL_=${JSON.stringify(url)},BLOCK=${JSON.stringify(shareBlock).replace(/</g, "\\u003c")},SLUG_=${JSON.stringify(slug)};
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.style.opacity='1';clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>{el.style.opacity='0';},2200);}
function shareLink(){navigator.clipboard.writeText(BLOCK).then(()=>toast('복사됐어요! 붙여넣으면 카드처럼 보여요'));}
function webShare(){if(navigator.share)navigator.share({title:document.title,text:BLOCK});else shareLink();}
// 카카오톡 공유(R4) — Kakao SDK 앱키 미등록(매니페스트 share_channels.
// kakao_sdk_enabled=false) 상태에서는 시스템 공유 시트(모바일에서 카톡 포함)
// 로 대체하고, 공유 시트가 없는 환경(대부분 데스크톱)은 복붙 블록 복사로
// 폴백한다.
function kakaoShare(){
  if(navigator.share){navigator.share({title:document.title,text:BLOCK,url:URL_}).catch(()=>{});}
  else{navigator.clipboard.writeText(BLOCK).then(()=>toast('복사됐어요 — 카톡에 붙여넣으면 끝'));}
}
// CTA 계측(R6) — 클릭을 막지 않는 fire-and-forget. sendBeacon 우선, 없으면
// keepalive fetch 폴백. 실패해도 이동은 그대로 진행된다.
function ctaClick(){
  try{
    if(navigator.sendBeacon){navigator.sendBeacon('/api/quiz/'+SLUG_+'/cta');}
    else{fetch('/api/quiz/'+SLUG_+'/cta',{method:'POST',keepalive:true}).catch(()=>{});}
  }catch(e){}
}
</script>` +
    FOOT
  );
}
