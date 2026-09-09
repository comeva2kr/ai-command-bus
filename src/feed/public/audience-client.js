/* Shared Today / Live / published-page measurement. No cross-site identifiers. */
(() => {
  if (window.NowHotTrack || location.pathname.startsWith('/admin') || location.pathname.includes('editorial-desk')) return;
  const pageId = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
  let seq = 0, path = location.pathname, viewed = false, activeAt = document.visibilityState === 'visible' ? Date.now() : null;
  let lastInput = Date.now();
  let engaged = false, visibleMs = 0, maxDepth = 0, timer = null, sending = false;
  const queue = [];
  function readParams() {
    const params = {}, sp = new URLSearchParams(location.search);
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_content']) if (sp.get(k)) params[k] = sp.get(k).slice(0,k==='utm_content'?80:40);
    if (!params.utm_source && (sp.has('push') || sp.has('nh-notification') || sp.get('from') === 'push')) { params.utm_source='web_push'; params.utm_medium='notification'; }
    return params;
  }
  let params = readParams();
  function event(type, values={}) {
    queue.push({type, pageId, seq:++seq, path, referrer:document.referrer, params, ...values});
    if(queue.length > 200) queue.shift();
    if(!timer) timer=setTimeout(()=>{timer=null;flush();},1000);
  }
  async function flush(beacon=false) {
    if(!queue.length || sending)return;
    const batch=queue.slice(0,50), body=JSON.stringify({version:2,events:batch});
    sending=true;
    try {
      let res=await fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true});
      if(res.status===409)res=await fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true});
      if(res.ok)queue.splice(0,batch.length);
    } catch {} finally {
      sending=false;
      if(queue.length&&!timer)timer=setTimeout(()=>{timer=null;flush();},5000);
    }
  }
  function checkpoint() {
    if(activeAt===null)return;
    const now=Date.now(), elapsed=Math.max(0,Math.min(now-activeAt,60000));
    activeAt=now; visibleMs+=elapsed;
    event('checkpoint',{dwellMs:elapsed,depth:maxDepth});
    if(visibleMs>=10000&&!engaged) {engaged=true;event('engage');}
  }
  function view(next=location.pathname) {
    const currentParams=readParams();
    if(viewed&&path===next&&JSON.stringify(params)===JSON.stringify(currentParams))return;
    if(viewed)checkpoint();
    params=currentParams;
    path=next;viewed=true;maxDepth=0;event('view');
  }
  const track=window.NowHotTrack={
    view,
    click(item,rank){event('click',{source:item?.source||null,category:item?.category||null,rank});},
    action(name){event('action',{action:name});},
    ad(kind,slot,variant){event(kind==='click'?'ad_click':'ad_impression',{slot,variant});},
    observeAds(root){
      if(!root||!window.IntersectionObserver)return;
      root._nhAdObserver?.disconnect();
      const observer=root._nhAdObserver=new IntersectionObserver(entries=>{
        for(const entry of entries)if(entry.isIntersecting&&entry.intersectionRatio>=0.5){
          const el=entry.target;
          if(!el.dataset.audienceSeen){el.dataset.audienceSeen='1';track.ad('impression',el.dataset.audienceSlot);}
          observer.unobserve(el);
        }
      },{threshold:0.5});
      root.querySelectorAll('[data-audience-slot]').forEach(el=>observer.observe(el));
    },
    depth(){}, // Scroll percentage is measured from the visible document below.
    exit(){checkpoint();flush(true);},
    flush
  };
  function start(){view();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('scroll',()=>{
    const full=document.documentElement.scrollHeight-innerHeight;
    maxDepth=Math.max(maxDepth,Math.min(100,Math.round(full>0?scrollY/full*100:100)));
  },{passive:true});
  addEventListener('pointerdown',e=>{if(e.isTrusted){lastInput=Date.now();if(activeAt===null)activeAt=Date.now();}},{passive:true});
  addEventListener('keydown',e=>{if(e.isTrusted){lastInput=Date.now();if(activeAt===null)activeAt=Date.now();}},{passive:true});
  document.addEventListener('click',e=>{
    if(!e.isTrusted)return;
    const a=e.target.closest('a[href]'); if(!a)return;
    try {
      const url=new URL(a.href,location.href);
      if(/^https?:$/.test(url.protocol)&&url.origin!==location.origin) {
        const ad=a.closest('.ad-slot,.ad-coupang,[data-ad]');
        if(ad?.dataset.audienceSlot)track.ad('click',ad.dataset.audienceSlot);
        else if(!ad)track.action('outbound');
        else if(location.pathname!=='/live'&&location.pathname!=='/index.html')track.action('ad');
        flush(true);
      }
    }catch{}
  },true);
  addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){checkpoint();activeAt=null;flush(true);}
    else {activeAt=Date.now();event('view',{resume:true});}
  });
  addEventListener('pagehide',()=>{checkpoint();activeAt=null;flush(true);});
  addEventListener('pageshow',e=>{if(e.persisted){activeAt=Date.now();event('view',{resume:true});}});
  addEventListener('blur',()=>{checkpoint();activeAt=null;flush();});
  addEventListener('focus',()=>{activeAt=Date.now();lastInput=Date.now();event('view',{resume:true});});
  setInterval(()=>{if(document.visibilityState==='visible'&&document.hasFocus()&&Date.now()-lastInput<30*60000){checkpoint();flush();}else activeAt=null;},30000);
})();
