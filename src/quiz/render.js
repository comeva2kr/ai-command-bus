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
//   - 강점 4 + 성장 포인트 1~2 (80:20 — 칭찬만 하면 가짜같이 느껴진다)
//   - 궁합 (잘 맞는/환장의 케미 유형, 두 번째 참여자를 부르는 장치)
//   - 스크린샷 완결형 결과 카드 (유형색 + 제목 + 테스트명이 한 화면에)
//   - "재미로 보는" 면책 라벨
//
// Ad slots are placeholder <div>s (.ad-slot) between screens; swap in the ad
// network snippet at deploy time.

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
.fineprint{font-size:.75rem;color:#4a5164;text-align:center;margin-top:24px}
.hidden{display:none}
a{color:#4f8cff}
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
<p class="desc" style="font-size:.85rem;margin-top:8px">${qCount}문항 · 약 ${Math.max(1, Math.round(qCount / 5))}~${Math.max(2, Math.round(qCount / 4))}분 · 정답은 없어요</p>
</div>
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

  const rarity =
    stats && stats.share && stats.share[result.code] != null
      ? `<span class="badge">지금까지 응답자 중 ${stats.share[result.code]}%가 이 유형</span>`
      : "";

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

  return (
    head(ogTitle, result.shareText, url, origin, ogImageUrl) +
    `<div class="card result-card" style="border-color:${color}">
<p class="desc" style="font-size:.85rem">${esc(quiz.title)}</p>
<h1 style="color:${color}">${esc(result.title)}</h1>
${rarity}
<p style="margin-top:10px">${esc(result.description)}</p>
</div>

<div class="card">
<h2>${percents ? "내 성향 스펙트럼" : "이 유형의 성향 축"}</h2>
${axisBars}
${percents ? "" : `<p class="desc" style="font-size:.85rem;margin-top:8px">직접 테스트하면 축마다 내 퍼센트가 나와요.</p>`}
</div>
${AD}
<div class="card">
<h2>강점</h2>
<ul class="plain">${result.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<h2>성장 포인트</h2>
<ul class="plain">${result.weaknesses.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<h2>이 유형을 위한 조언</h2>
<ul class="plain">${result.advice.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
</div>

<div class="card">
<h2>유형 케미</h2>
<div class="match">
<div><p class="tag">잘 맞는 케미</p><p><a href="/q/${esc(slug)}/r/${esc(result.bestMatch)}">${esc(best ? best.title : result.bestMatch)}</a></p></div>
<div><p class="tag">환장의 케미</p><p><a href="/q/${esc(slug)}/r/${esc(result.worstMatch)}">${esc(worst ? worst.title : result.worstMatch)}</a></p></div>
</div>
<p class="desc" style="font-size:.85rem;margin-top:10px">친구 결과랑 비교해보세요 — 케미가 맞는지 바로 나옵니다.</p>
</div>

<div class="card" style="text-align:center">
<p class="desc">${esc(result.shareText)}</p>
<div class="share">
<button onclick="shareLink()">🔗 링크 복사</button>
<a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(result.shareText)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">X에 공유</a>
<button onclick="webShare()">📱 공유하기</button>
<a href="${esc(ogImageUrl)}" download target="_blank" rel="noopener">🖼️ 결과 카드 저장</a>
</div>
</div>
<p style="text-align:center"><a class="big" href="/q/${esc(slug)}">나도 테스트 해보기 →</a></p>
<p style="text-align:center;margin-top:12px"><a href="/q">다른 테스트 보기</a></p>
${AD}
${FINEPRINT}
<script>
const URL_=${JSON.stringify(url)},TEXT=${JSON.stringify(result.shareText).replace(/</g, "\\u003c")};
function shareLink(){navigator.clipboard.writeText(URL_).then(()=>alert('링크를 복사했어요!'));}
function webShare(){if(navigator.share)navigator.share({title:document.title,text:TEXT,url:URL_});else shareLink();}
</script>` +
    FOOT
  );
}
