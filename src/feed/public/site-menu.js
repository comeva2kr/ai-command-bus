window.NowHotMenu = (() => {
  const markup = `  <div class="drawer-back" id="drawerBack"></div>
  <aside class="drawer" id="drawer" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" inert>
    <div class="drawer-head">
      <div class="drawer-title" id="drawerTitle">메뉴</div>
      <button class="drawer-close" id="drawerClose" aria-label="메뉴 닫기">✕</button>
    </div>
    <div class="drawer-body">
      <div id="authDrawerSec"></div>
      <a class="drawer-link" id="drawerSetupBtn" href="/live#setup">✨ 나한테 맞게 설정하기</a>
      <button class="drawer-link" id="menuInstall" type="button">바탕화면에 app 추가</button>
      <div class="meter">
        <div class="meter-label"><span>취향 정확도</span><span id="levelPct">0%</span></div>
        <div class="meter-bar"><div class="meter-fill" id="levelFill"></div></div>
      </div>

      <p class="drawer-hint">아래는 실시간 보기 설정입니다. 오늘판 관심 분야는 오늘 화면 상단에서 고를 수 있어요.</p>
      <div class="drawer-row">
        <span>🎬 몰입 모드 (한 글씩 넘겨보기)</span>
        <button id="immBtn" class="icon-btn" title="몰입 모드">🎬</button>
      </div>

      <div class="drawer-sec">
        <h4>실시간 카테고리</h4>
        <div class="chips" id="chips"></div>
      </div>

      <div class="drawer-sec">
        <h4>실시간 소스 · 링크 제출</h4>
        <div class="src-chips" id="srcChips"></div>
      </div>

      <div class="drawer-sec">
        <h4>콘텐츠 필터</h4>
        <div id="drawerFilters"></div><p class="drawer-hint">콘텐츠 필터는 실시간과 개별 글 알림에 적용돼요. 커뮤·뉴스 조절은 실시간에 적용되고, ‘커뮤만’이나 ‘뉴스만’을 고르면 알림 종류도 제한돼요.</p>
      </div>

      <!-- 커뮤니티(오락성) ↔ 뉴스(소식성) 비율 (David 2026-08-02).
           성향 슬라이더와 같은 방식이지만 축이 다르다: 이건 "뭘 볼까",
           아래 것은 "뉴스 안에서 어느 쪽". 양 끝은 커뮤만/뉴스만,
           중간값은 선호 강도이며 실제 노출 비율을 약속하지 않는다. -->
      <div class="drawer-sec" id="mixSec">
        <h4>커뮤 · 뉴스 조절</h4>
        <input type="range" id="mixSlider" min="-100" max="100" step="25" value="0"
               style="width:100%;accent-color:var(--accent)" aria-label="커뮤니티와 뉴스 비율">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:2px">
          <span>커뮤 더</span><span id="mixMid">고르게</span><span>뉴스 더</span>
        </div>
      </div>

      <!-- 뉴스 성향 슬라이더 . 매체별 라벨은 노출하지 않고
           혼합 비율만 조절한다. 기본값 0 = 고르게. 끝까지 밀어도 반대편이
           완전히 사라지지 않는다(하한 20% — 필터버블 방지, engine.leanMultiplier). -->
      <div class="drawer-sec" id="leanSec">
        <h4>뉴스 균형</h4>
        <input type="range" id="leanSlider" min="-100" max="100" step="25" value="0"
               style="width:100%;accent-color:var(--accent)" aria-label="뉴스 성향 균형">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:2px">
          <span>진보 성향 더</span><span id="leanMid">고르게</span><span>보수 성향 더</span>
        </div>
      </div>

      <!-- 우리가 직접 만드는 페이지들. 예전엔 브리핑·랭킹 둘만 있어서
           커뮤니티 순위·키워드는 만들어 놓고도 들어갈 길이 없었다
           (2026-08-04 실측: 홈에서 /communities·/keywords 링크 0개).
           인라인 style은 전부 클래스로 뺐다 — 값이 코드에 박히면 테마가
           바뀔 때 여기만 안 따라온다. -->
      <nav class="drawer-sec drawer-nav" aria-label="지금핫이 만드는 페이지">
        <a class="drawer-link" href="/ranking/daily">화제 랭킹 TOP 20</a>
        <a class="drawer-link" href="/communities">커뮤니티 순위</a>
        <a class="drawer-link" href="/keywords">화제 키워드</a>
        <a class="drawer-link" href="/trends">실시간 트렌드</a>
        <a class="drawer-link" href="/report">데이터 리포트</a>
      </nav>
      <div class="drawer-sec" style="opacity:.55;font-size:11px">
        화면 빌드 <span id="buildTag">-</span>
      </div>
      <nav class="drawer-sec drawer-meta" aria-label="서비스 정보">
        <button class="drawer-link sub" id="menuNotifications" type="button">알림 받기</button>
        <p id="notificationHelp" role="status"></p>
        <a class="drawer-link sub" href="/about">서비스 소개</a>
        <a class="drawer-link sub" href="/about#updates">업데이트 기록</a>
        <a class="drawer-link sub" href="/feedback">개선 요청</a>
        <a class="drawer-link sub" href="/terms">이용약관</a>
        <a class="drawer-link sub" href="/privacy">개인정보처리방침</a>
        <p class="drawer-copy">ⓒ 페퍼클럽 · 지금핫 NowHot</p>
      </nav>
    </div>
  </aside>`;
  const $ = id => document.getElementById(id);
  document.querySelector('[data-site-menu]').outerHTML = markup;
  const drawer=$('drawer'), back=$('drawerBack'), button=$('menuBtn');
  let opened=false, pendingBack=false, afterClose=null, locked=[], previousOverflow='', returnFocus=null;
  function hide(restoreFocus=true) {
    opened=false; drawer.classList.remove('open'); back.classList.remove('open');
    drawer.inert=true; drawer.setAttribute('aria-hidden','true'); button.setAttribute('aria-expanded','false');
    document.body.style.overflow=previousOverflow;
    for(const [node,value] of locked)node.inert=value;locked=[];
    if(restoreFocus && returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function open() {
    if(opened||pendingBack)return;
    if($('nhGuide')){window.NowHotNoticeGuide.close(open);return;}
    $('onbBack')?.remove();
    returnFocus=document.activeElement;previousOverflow=document.body.style.overflow;
    locked=[...document.body.children].filter(node=>node!==drawer&&node!==back&&node.id!=='toast'&&!['SCRIPT','STYLE'].includes(node.tagName)).map(node=>[node,node.inert]);
    for(const [node] of locked)node.inert=true;
    document.body.style.overflow='hidden';drawer.inert=false;
    drawer.classList.add('open');back.classList.add('open');drawer.setAttribute('aria-hidden','false');button.setAttribute('aria-expanded','true');
    opened=true; history.pushState({...history.state,nhMenu:true},'',location.href);$('drawerClose').focus();
  }
  function close(restoreFocus=false, next=null) {
    if(!opened){if(next)next();return;}
    hide(restoreFocus);
    if(history.state?.nhMenu){pendingBack=true;afterClose=next;history.back();}
    else if(next)next();
  }
  function navigate(url){close(false,()=>location.assign(url));}
  addEventListener('popstate',event=>{
    if(opened||pendingBack){event.stopImmediatePropagation();if(opened)hide();pendingBack=false;const next=afterClose;afterClose=null;if(next)next();}
    else if(history.state?.nhMenu){history.replaceState({...history.state,nhMenu:false},'',location.href);}
  },true);
  button.onclick=open;$('drawerClose').onclick=()=>close(true);back.onclick=()=>close(true);
  document.addEventListener('keydown',event=>{
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);}
    if(event.key==='Tab'){
      const nodes=[...drawer.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length);
      const first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  },true);
  drawer.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();navigate(link.href);
  });
  let installPrompt=null, installRequested=false;
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
  addEventListener('appinstalled',()=>{installPrompt=null;installRequested=true;});
  const appRunning=()=>navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
  function installHelp(){
    const ua=navigator.userAgent||'';
    const ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
    const android=/Android/i.test(ua);
    const inApp=/KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\/|; wv\)/i.test(ua);
    let label,steps;
    if(appRunning())return {title:'지금핫 앱으로 이용 중이에요',lead:'이미 홈 화면 앱으로 열려 있어요. 추가할 필요 없이 그대로 이용하세요.',steps:[],tip:'알림을 받으려면 메뉴의 ‘알림 받기’를 눌러 허용해 주세요.'};
    if(installRequested)return {title:'홈 화면에서 지금핫을 확인해 주세요',lead:'브라우저에서 앱 추가 요청을 받았어요. 아이콘이 나타나기까지 잠시 걸릴 수 있어요.',steps:['홈 화면이나 앱 목록에서 지금핫 아이콘을 찾아 열어 주세요.'],tip:'아이콘이 이미 있다면 다시 추가하지 않고 그 아이콘을 이용하면 돼요.'};
    if(inApp){
      label='앱 안에서 열린 브라우저';steps=[
        '앱의 메뉴에서 ‘다른 브라우저로 열기’가 있으면 눌러 주세요.',
        ios?'Safari 또는 Chrome에서 지금핫을 열어 주세요.':android?'Chrome 또는 삼성 인터넷에서 지금핫을 열어 주세요.':'Chrome 또는 Edge에서 지금핫을 열어 주세요.',
        '브라우저로 열기 메뉴가 없다면 아래 주소를 복사해 브라우저 주소창에 붙여넣으세요. 그곳에서 메뉴의 ‘바탕화면에 app 추가’를 다시 눌러 주세요.'
      ];
    }else if(ios){
      label='아이폰 · 아이패드';steps=[
        '브라우저의 공유 버튼(위로 향한 화살표)을 누르세요. Safari에서는 ‘더 보기(…) → 공유’에 있을 수도 있어요.',
        '‘홈 화면에 추가’를 선택하세요. Safari에서 안 보이면 공유 목록 아래 ‘동작 편집’에서 추가하세요.',
        '‘웹 앱으로 열기’가 보이면 켠 뒤 ‘추가’를 누르세요. 홈 화면의 지금핫 아이콘으로 열면 됩니다.'
      ];
    }else if(/SamsungBrowser/i.test(ua)){
      label='삼성 인터넷';steps=[
        '브라우저 메뉴(☰)를 누르세요.',
        '‘현재 페이지 추가’ 또는 ‘페이지 추가’에서 ‘홈 화면’을 선택하세요. 주소창에 앱 설치(＋) 아이콘이 보이면 눌러도 돼요.',
        '이름을 확인하고 ‘추가’ 또는 ‘설치’를 누른 뒤, 홈 화면이나 앱 목록의 지금핫 아이콘을 확인하세요.'
      ];
    }else if(android&&/Firefox/i.test(ua)){
      label='안드로이드 Firefox';steps=['브라우저 메뉴(⋮)를 누르세요.','‘설치’ 또는 ‘홈 화면에 추가’를 선택하세요.','추가 확인을 누른 뒤 홈 화면의 지금핫 아이콘을 확인하세요.'];
    }else if(android){
      label='안드로이드 브라우저';steps=[
        '브라우저 메뉴(⋮)에서 ‘설치’ 또는 ‘홈 화면에 추가’를 찾으세요.',
        'Chrome에서는 ‘설치 및 바로가기 만들기 → 설치’에 있어요. 버전에 따라 ‘홈 화면에 추가’로 표시돼요.',
        '확인창에서 추가한 뒤 홈 화면이나 앱 목록의 지금핫 아이콘을 확인하세요.'
      ];
    }else if(/Edg\//.test(ua)){
      label='컴퓨터 Edge';steps=['브라우저 메뉴(…)에서 ‘도구 더 보기 → 앱’을 선택하세요. 버전에 따라 ‘앱’이 메뉴에 바로 보일 수 있어요.','‘이 사이트를 앱으로 설치’를 선택하고 설치를 확인하세요.','앱이 열리면 표시되는 바탕 화면 바로가기 또는 작업 표시줄 고정 옵션을 선택할 수 있어요.'];
    }else if(/Chrome|Chromium/.test(ua)){
      label='컴퓨터 Chrome';steps=['주소창 오른쪽에 설치 아이콘이 보이면 누르세요.','또는 메뉴(⋮) → ‘전송, 저장 및 공유’ → ‘페이지를 앱으로 설치’를 선택하세요.','설치를 확인한 뒤 앱 목록에서 지금핫을 열거나 바탕 화면에 바로가기를 두세요.'];
    }else if(/Macintosh/.test(ua)&&/Safari/.test(ua)){
      label='Mac Safari';steps=['macOS Sonoma 14 이상에서 Safari로 지금핫을 여세요.','상단 ‘파일’ 메뉴 또는 공유 버튼에서 ‘Dock에 추가’를 누르세요.','이름을 확인하고 추가하면 Dock에서 지금핫을 앱처럼 열 수 있어요.'];
    }else{
      label='현재 브라우저';steps=['브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 찾아보세요.','해당 메뉴가 없다면 Chrome·Edge 또는 Safari에서 아래 주소를 여세요.','그 브라우저에서 지금핫 메뉴의 ‘바탕화면에 app 추가’를 다시 누르면 방법을 안내해 드려요.'];
    }
    return {title:'바탕화면에 app 추가',lead:label+'에서 아래 순서로 추가해 주세요.',steps,
      tip:'메뉴 이름은 버전에 따라 다를 수 있어요. 항목이 안 보이면 '+(ios?'Safari 또는 Chrome':android?'Chrome 또는 삼성 인터넷':'Chrome·Edge 또는 Mac의 Safari')+'에서 열어 주세요. 아이콘 추가 후 알림은 ‘알림 받기’에서 별도로 허용해 주세요.',copyUrl:true};
  }
  $('menuInstall').onclick=async()=>{
    const prompt=installPrompt;
    if(prompt&&!appRunning()){
      installPrompt=null;$('menuInstall').disabled=true;
      try{
        // Keep prompt() in this click task: a history.back callback loses activation.
        const result=await prompt.prompt();
        if(result?.outcome==='accepted')close(true);
        return;
      }catch{ /* A consumed or unavailable browser prompt falls back to instructions. */ }
      finally{$('menuInstall').disabled=false;}
    }
    close(true,()=>window.NowHotNoticeGuide.show({install:installHelp()}));
  };
  function categories(values,active,onPick){
    const el=$('chips');el.replaceChildren();
    for(const c of [{id:null,label:'전체'},...values]){
      const b=document.createElement('button');b.className='chip'+(active===c.id?' active':'');b.textContent=c.label;b.setAttribute('aria-pressed',String(active===c.id));
      b.onclick=()=>onPick(c.id,el,b);el.append(b);
    }
  }
  function sources(values,active,onPick,onSubmit){
    const el=$('srcChips');el.replaceChildren();
    const add=document.createElement('button');add.id='submitLinkBtn';add.className='src-chip';add.textContent='＋ 링크제출';add.onclick=onSubmit;el.append(add);
    for(const c of [{id:null,label:'전체'},{id:'submit',label:'📮 제출'},...values]){
      const b=document.createElement('button');b.className='src-chip'+(active===c.id?' active':'');b.textContent=c.labelKo||c.label;b.setAttribute('aria-pressed',String(active===c.id));b.onclick=()=>onPick(c.id,el,b);el.append(b);
    }
  }
  function filters(topics,includeDeals=false){
    return [['politics','🗳️','정치'],['religion','⛪','종교'],['nodeal','🔥','핫딜']].filter(([id])=>includeDeals||id!=='nodeal').map(([id,icon,label])=>{
      const on=id==='nodeal'?!topics.includes(id):topics.includes(id);
      return `<div class="muted-row"><span>${icon} ${label} 글</span><b>${on?'보는 중':'숨김'}</b><button class="chip${on?' active':''}" ${id==='nodeal'?'data-deal-toggle':`data-topic-toggle="${id}"`} aria-pressed="${on}">${on?'숨기기':'보기'}</button></div>`;
    }).join('')+'<p class="drawer-hint">정치·종교 글은 기본으로 숨겨요. 특정 매체는 글 상세의 “그만보기”로 숨길 수 있어요.</p>';
  }
  function slider(id,value,label,onSave,onError){
    const el=$(id+'Slider'),mid=$(id+'Mid');let saved=value,timer;
    const paint=v=>{el.value=String(Math.round(v*100));mid.textContent=label(Math.round(v*100));};paint(saved);
    const save=async()=>{clearTimeout(timer);const v=Number(el.value)/100;if(el.disabled||v===saved)return;el.disabled=true;try{await onSave(v);saved=v;}catch(error){onError(error);}finally{paint(saved);el.disabled=false;}};
    el.oninput=()=>{mid.textContent=label(Number(el.value));clearTimeout(timer);timer=setTimeout(save,700);};
    el.onchange=save;
  }
  const mixLabel=v=>v===-100?'커뮤만':v===100?'뉴스만':v===0?'고르게':v<0?'커뮤 선호 '+Math.abs(v):'뉴스 선호 '+v;
  const leanLabel=v=>v===0?'고르게':v<0?'진보쪽 '+Math.abs(v)+'%':'보수쪽 '+v+'%';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const authProviders={google:{label:'Google로 계속하기',bg:'#ffffff',fg:'#1f1f1f',border:'#dadce0'},kakao:{label:'카카오로 계속하기',bg:'#fee500',fg:'#191919',border:'#fee500'},naver:{label:'네이버로 계속하기',bg:'#03C75A',fg:'#ffffff',border:'#03C75A'}};
  function auth(container,{profile,providers,userId,onLogout,onSettings,wireLogin,returnTo=location.pathname+location.search+location.hash}){
    if(!container)return;
    const settings=onSettings?'<button class="drawer-link" id="drawerSpaceBtn" data-auth-settings>설정</button>':'';
    if(profile?.loggedIn){
      const social=profile.social||{},avatar=typeof social.avatar==='string'&&social.avatar.trim()?window.NowHotHistory?.webUrl(social.avatar,false):null;
      const provider=authProviders[social.provider]?.label.replace('로 계속하기','');
      container.innerHTML=`<div class="auth-profile">${avatar?`<img class="auth-avatar" src="${esc(avatar)}" referrerpolicy="no-referrer" alt="">`:'<div class="auth-avatar auth-avatar-ph">👤</div>'}<div class="auth-info"><div class="auth-nick">${esc(profile.nickname||'게스트')}</div><div class="auth-provider-label">${provider?esc(provider)+'로 로그인됨':'로그인됨'}</div></div><div class="auth-actions">${settings}<button class="drawer-link" data-auth-logout>로그아웃</button></div></div>`;
      container.querySelector('[data-auth-logout]').onclick=onLogout;
      if(onSettings)container.querySelector('[data-auth-settings]').onclick=onSettings;return;
    }
    container.innerHTML=providers?.some(id=>authProviders[id])?'<div class="auth-hint">로그인하면 다른 기기에서도 내 취향을 이어가요. 로그인 없이도 이용할 수 있어요.</div><div class="auth-btns">'+providers.map(id=>{const m=authProviders[id];return m?`<a class="auth-btn" data-provider="${id}" href="/api/auth/${id}/login?userId=${encodeURIComponent(userId||'')}&amp;returnTo=${encodeURIComponent(returnTo)}" style="background:${m.bg};color:${m.fg};border-color:${m.border}">${m.label}</a>`:'';}).join('')+'</div>':'';
    if(onSettings){container.insertAdjacentHTML('beforeend',settings);container.querySelector('[data-auth-settings]').onclick=onSettings;}
    if(wireLogin)wireLogin(container);
  }
  function level(info){const percent=Math.round((info.level||0)*100);$('levelPct').textContent=percent+'%';$('levelFill').style.width=percent+'%';}
  return {open,close,navigate,categories,sources,filters,slider,mixLabel,leanLabel,auth,authProviders,level};
})();

// Both entry pages expose the existing discovery pages before the feed loads.
(() => {
  const host=document.querySelector('[data-home-highlights]');if(!host)return;
  host.outerHTML=`<nav id="homeHighlights" aria-label="지금 화제 한눈에">
    <a class="highlight-box" href="/communities" data-highlight="communities"><h2>커뮤니티 순위</h2><span class="highlight-source">커뮤·뉴스 수집 글 반응량</span><ol class="highlight-list"><li>반응이 큰 커뮤니티 보기</li></ol><span class="highlight-more">전체 보기 →</span></a>
    <a class="highlight-box" href="/trends" data-highlight="trends"><h2>실시간 트렌드</h2><span class="highlight-source">X · 한국 / Trends24</span><ol class="highlight-list"><li>X에서 화제인 말 보기</li></ol><span class="highlight-more">전체 보기 →</span></a>
    <a class="highlight-box" href="/keywords" data-highlight="keywords"><h2>화제 키워드</h2><span class="highlight-source">여러 출처에서 함께 언급</span><ol class="highlight-list"><li>함께 뜨는 키워드 보기</li></ol><span class="highlight-more">전체 보기 →</span></a>
  </nav>`;
  const box=key=>document.querySelector(`[data-highlight="${key}"]`);
  function paint(key,items){
    const list=box(key).querySelector('ol');list.replaceChildren();
    const names=Array.isArray(items)?items.slice(0,3).map(item=>item?.name).filter(name=>typeof name==='string'&&name.trim()):[];
    for(const [index,name] of (names.length?names:['집계 준비 중']).entries()){
      const li=document.createElement('li');li.textContent=names.length?`${index+1}. ${name}`:name;li.title=name;list.append(li);
    }
  }
  async function read(path){const response=await fetch(path,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('unavailable');return response.json();}
  read('/api/discovery').then(data=>{paint('communities',data.communities);paint('keywords',data.keywords);}).catch(()=>{
    for(const key of ['communities','keywords'])box(key).querySelector('ol').textContent='요약을 불러오지 못했어요';
  });
  read('/api/trends').then(data=>{
    const at=Date.parse(data.fetchedAt),age=Date.now()-at;
    if(!Number.isFinite(at)||age<0||age>60*60*1000){box('trends').querySelector('ol').textContent='최근 트렌드를 확인 중이에요';return;}
    paint('trends',data.trends);
    box('trends').querySelector('.highlight-more').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(at)+' 수집 · 더보기 →';
  }).catch(()=>{box('trends').querySelector('ol').textContent='트렌드를 불러오지 못했어요';});
})();
