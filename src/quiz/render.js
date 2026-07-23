// Server-rendered HTML for the quiz pages. Three surfaces:
//   /q                → index of published quizzes
//   /q/<slug>         → the quiz itself (one question per screen, client JS)
//   /q/<slug>/r/<id>  → a *result* page with its own OG tags — this is the
//                       viral loop: people share their result, the preview
//                       shows "나는 ○○!", and the CTA sends the next person
//                       back into the quiz.
//
// Ad slots are placeholder <div>s (.ad-slot) between screens; swap in the ad
// network snippet at deploy time. 한 문항당 한 화면 구조라 페이지 체류 중
// 노출 기회가 많다.

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0e0f13;color:#e8eaf0;font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;line-height:1.6}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:16px 0 8px}
.desc{color:#9aa3b2}
.card{background:#171922;border:1px solid #262a38;border-radius:14px;padding:20px;margin:16px 0}
button.opt{display:block;width:100%;text-align:left;background:#1d2230;color:#e8eaf0;border:1px solid #2c3350;border-radius:10px;padding:14px 16px;margin:8px 0;font-size:1rem;cursor:pointer}
button.opt:hover{border-color:#4f8cff}
.progress{height:6px;background:#262a38;border-radius:3px;overflow:hidden;margin:12px 0}
.progress i{display:block;height:100%;background:#4f8cff;transition:width .2s}
.big{background:#4f8cff;color:#fff;border:0;border-radius:10px;padding:14px 24px;font-size:1.05rem;cursor:pointer;text-decoration:none;display:inline-block}
.share{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.share button,.share a{background:#1d2230;border:1px solid #2c3350;color:#e8eaf0;border-radius:10px;padding:10px 14px;font-size:.95rem;cursor:pointer;text-decoration:none}
.ad-slot{min-height:90px;border:1px dashed #2c3350;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#4a5164;font-size:.8rem;margin:16px 0}
.hidden{display:none}
a{color:#4f8cff}
`;

function head(title, desc, url, origin) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="핫이슈 테스트">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(origin)}/icon.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<style>${STYLE}</style></head><body><div class="wrap">`;
}

const FOOT = `</div></body></html>`;

const AD = `<div class="ad-slot">AD — 광고 코드 삽입 위치</div>`;

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
    FOOT
  );
}

export function renderQuizPage(record, origin) {
  const { slug, quiz } = record;
  const url = `${origin}/q/${esc(slug)}`;
  // 클라이언트 스크립트가 쓸 데이터. </script> 이탈 방지 이스케이프.
  const payload = JSON.stringify({ slug, questions: quiz.questions, results: quiz.results }).replace(/</g, "\\u003c");
  return (
    head(quiz.title, quiz.description, url, origin) +
    `<div id="intro">
<h1>${esc(quiz.title)}</h1>
<p class="desc">${esc(quiz.description)}</p>
${AD}
<div class="card"><button class="big" onclick="start()">테스트 시작하기 →</button></div>
</div>
<div id="quiz" class="hidden">
<div class="progress"><i id="bar" style="width:0%"></i></div>
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
  const tally={};QUIZ.results.forEach(r=>tally[r.id]=0);
  QUIZ.questions.forEach((q,qi)=>q.answers[picks[qi]].scores.forEach(s=>tally[s.result]+=s.points));
  let best=QUIZ.results[0];
  QUIZ.results.forEach(r=>{if(tally[r.id]>tally[best.id])best=r;});
  location.href='/q/'+QUIZ.slug+'/r/'+encodeURIComponent(best.id);
}
</script>` +
    FOOT
  );
}

export function renderResultPage(record, result, origin) {
  const { slug, quiz } = record;
  const url = `${origin}/q/${esc(slug)}/r/${esc(result.id)}`;
  const ogTitle = `나는 "${result.title}"! — ${quiz.title}`;
  return (
    head(ogTitle, result.shareText, url, origin) +
    `<h1>${esc(result.title)}</h1>
<div class="card"><p>${esc(result.description)}</p></div>
${AD}
<div class="card">
<p class="desc">${esc(result.shareText)}</p>
<div class="share">
<button onclick="shareLink()">🔗 링크 복사</button>
<a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(result.shareText)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">X에 공유</a>
<button onclick="webShare()">📱 공유하기</button>
</div>
</div>
<p><a class="big" href="/q/${esc(slug)}">나도 테스트 해보기 →</a></p>
<p style="margin-top:12px"><a href="/q">다른 테스트 보기</a></p>
${AD}
<script>
const URL_=${JSON.stringify(url)},TEXT=${JSON.stringify(result.shareText).replace(/</g, "\\u003c")};
function shareLink(){navigator.clipboard.writeText(URL_).then(()=>alert('링크를 복사했어요!'));}
function webShare(){if(navigator.share)navigator.share({title:document.title,text:TEXT,url:URL_});else shareLink();}
</script>` +
    FOOT
  );
}
