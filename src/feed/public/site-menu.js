window.NowHotMenu = (() => {
  const markup = `  <div class="drawer-back" id="drawerBack"></div>
  <aside class="drawer" id="drawer" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" inert>
    <div class="drawer-head">
      <div class="drawer-title" id="drawerTitle">메뉴</div>
      <button class="drawer-close" id="drawerClose" aria-label="메뉴 닫기">✕</button>
    </div>
    <div class="drawer-body">
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

      <div class="drawer-sec">
        <button class="drawer-link" id="drawerSpaceBtn">👤 내 공간 · 취향 설정</button>
      </div>

      <!-- 소셜 로그인: 설정된 provider가 있을 때만 채워짐 (renderAuthBlock) -->
      <div class="drawer-sec" id="authDrawerSec"></div>

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
  function filters(topics){
    return [['politics','🗳️','정치'],['religion','⛪','종교'],['nodeal','🔥','핫딜']].map(([id,icon,label])=>{
      const on=id==='nodeal'?!topics.includes(id):topics.includes(id);
      return `<div class="muted-row"><span>${icon} ${label} 글</span><b>${on?'보는 중':'숨김'}</b><button class="chip${on?' active':''}" ${id==='nodeal'?'data-deal-toggle':`data-topic-toggle="${id}"`} aria-pressed="${on}">${on?'숨기기':'보기'}</button></div>`;
    }).join('')+'<p class="drawer-hint">정치·종교 글은 기본으로 숨기고 핫딜은 기본으로 보여줘요. 특정 매체는 글 상세의 “그만보기”로 숨길 수 있어요.</p>';
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
  function auth(container,{profile,providers,userId,onLogout,wireLogin}){
    if(!container)return;
    if(profile?.loggedIn){
      const social=profile.social||{},avatar=typeof social.avatar==='string'&&social.avatar.trim()?window.NowHotHistory?.webUrl(social.avatar,false):null;
      const provider=authProviders[social.provider]?.label.replace('로 계속하기','');
      container.innerHTML=`<div class="auth-profile">${avatar?`<img class="auth-avatar" src="${esc(avatar)}" referrerpolicy="no-referrer" alt="">`:'<div class="auth-avatar auth-avatar-ph">👤</div>'}<div class="auth-info"><div class="auth-nick">${esc(profile.nickname||'게스트')}</div><div class="auth-provider-label">${provider?esc(provider)+'로 로그인됨':'로그인됨'}</div></div><button class="drawer-link" data-auth-logout>로그아웃</button></div>`;
      container.querySelector('[data-auth-logout]').onclick=onLogout;return;
    }
    if(!providers?.length){container.replaceChildren();return;}
    container.innerHTML='<div class="auth-hint">로그인하면 다른 기기에서도 내 취향을 이어가요. 로그인 없이도 이용할 수 있어요.</div><div class="auth-btns">'+providers.map(id=>{const m=authProviders[id];return m?`<a class="auth-btn" data-provider="${id}" href="/api/auth/${id}/login?userId=${encodeURIComponent(userId||'')}" style="background:${m.bg};color:${m.fg};border-color:${m.border}">${m.label}</a>`:'';}).join('')+'</div>';
    if(wireLogin)wireLogin(container);
  }
  function level(info){const percent=Math.round((info.level||0)*100);$('levelPct').textContent=percent+'%';$('levelFill').style.width=percent+'%';}
  return {open,close,navigate,categories,sources,filters,slider,mixLabel,leanLabel,auth,authProviders,level};
})();
