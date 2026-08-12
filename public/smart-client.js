(()=>{
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  let asking=false;
  let inboxFilter='all';
  let chatObserver=null;
  let cardsObserver=null;
  let lastUiErrorAt=0;
  let serverHistoryLoaded=false;

  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function safeToast(message,type=''){
    try{if(typeof toast==='function')return toast(message,type)}catch{}
    console[type==='error'?'error':'log']('[Kivo]',message);
  }

  function polishInputs(){
    const ask=$('#askInput');
    if(ask){
      ask.spellcheck=true;
      ask.autocomplete='off';
      ask.autocapitalize='sentences';
      ask.setAttribute('enterkeyhint','send');
      ask.placeholder='Ask naturally — typos are fine…';
      ask.setAttribute('aria-label','Ask Kivo');
    }
    const capture=$('#captureText');
    if(capture){
      capture.spellcheck=true;
      capture.autocapitalize='sentences';
      capture.placeholder='Try: Netflix 9.99 every 11th, remind me a day before';
      capture.setAttribute('aria-label','Tell Kivo what to remember');
    }
  }

  function addSmartBadge(){
    const hero=$('#askView .hero-block');
    if(hero&&!$('#kivoSmartBadge')){
      const badge=document.createElement('div');
      badge.id='kivoSmartBadge';
      badge.className='smart-badge';
      badge.innerHTML='<span aria-hidden="true">✦</span><span>Context-aware</span><small>Typos are fine</small>';
      hero.appendChild(badge);
    }
  }

  function quickPrompts(labels=['What should I handle first?','Anything urgent?','What am I paying for?']){
    const row=$('#askView .chip-row');
    if(!row)return;
    [...row.querySelectorAll('button')].forEach((b,i)=>{
      if(labels[i]&&b.textContent!==labels[i])b.textContent=labels[i];
      b.type='button';
    });
  }

  function installAccessibility(){
    const labels={notifyBtn:'Notifications',settingsBtn:'Open settings',askSend:'Send message',fab:'Add to Kivo',closeDialog:'Close',closeSettings:'Close settings'};
    for(const [id,label] of Object.entries(labels)){const el=$('#'+id);if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',label)}
    $('#toastLayer')?.setAttribute('aria-live','polite');
    $('#toastLayer')?.setAttribute('aria-atomic','true');
    $('#chat')?.setAttribute('aria-live','polite');
    $('#chat')?.setAttribute('aria-label','Conversation with Kivo');
    $$('.bottom-nav button,.desktop-rail nav button[data-view]').forEach(b=>b.setAttribute('aria-label',b.textContent.trim()));
    $$('dialog').forEach(d=>{d.setAttribute('aria-modal','true');d.addEventListener('click',e=>{if(e.target===d)d.close()})});
  }

  function installConnectivity(){
    if($('#kivoConnectivity'))return;
    const pill=document.createElement('div');
    pill.id='kivoConnectivity';
    pill.className='connectivity-pill hidden';
    pill.setAttribute('role','status');
    document.body.appendChild(pill);
    const sync=()=>{
      const online=navigator.onLine;
      pill.classList.toggle('hidden',online);
      pill.classList.toggle('offline',!online);
      pill.textContent=online?'Back online':'Offline — Kivo will reconnect automatically';
      if(online){pill.classList.remove('offline');pill.classList.add('reconnected');setTimeout(()=>pill.classList.add('hidden'),1800)}
    };
    addEventListener('offline',sync);addEventListener('online',sync);sync();
  }

  function installErrorBoundary(){
    const notify=message=>{
      const now=Date.now();if(now-lastUiErrorAt<4000)return;lastUiErrorAt=now;
      safeToast(message||'Kivo hit a display problem. Your information is still safe.','error');
    };
    addEventListener('unhandledrejection',e=>{console.error('Kivo unhandled promise rejection',e.reason);notify('Something did not finish properly. Try that action again.')});
    addEventListener('error',e=>{console.error('Kivo UI error',e.error||e.message);notify('Kivo hit a display problem. Refresh if anything looks wrong.')});
  }

  function setBusy(button,busy,label='Working…'){
    if(!button)return;
    if(busy){if(!button.dataset.originalText)button.dataset.originalText=button.textContent;button.disabled=true;button.classList.add('is-busy');button.textContent=label}
    else{button.disabled=false;button.classList.remove('is-busy');if(button.dataset.originalText){button.textContent=button.dataset.originalText;delete button.dataset.originalText}}
  }

  // Visual loading feedback only. It deliberately does NOT disable the button before
  // app.js gets the click, so it can never block the actual capture handler.
  function installCaptureState(){
    const btn=$('#captureBtn');if(!btn||btn.dataset.smartBusy==='1')return;btn.dataset.smartBusy='1';
    btn.addEventListener('click',e=>{
      if(!navigator.onLine){e.preventDefault();e.stopImmediatePropagation();safeToast('You’re offline. Reconnect before asking Kivo to understand something.','error');return}
      const old=btn.textContent;btn.classList.add('is-busy');btn.textContent='Understanding…';btn.setAttribute('aria-busy','true');
      const restore=()=>{btn.classList.remove('is-busy');btn.removeAttribute('aria-busy');if(btn.textContent==='Understanding…')btn.textContent=old};
      const watch=setInterval(()=>{if($('#toastLayer .toast')){clearInterval(watch);restore()}},350);
      setTimeout(()=>{clearInterval(watch);restore()},12000);
    },true);
  }

  function chatStorageKey(){
    let id='guest';try{id=user?.email||user?.id||'guest'}catch{}
    return `kivo.chat.${id}`;
  }
  function saveChat(){
    const chat=$('#chat');if(!chat)return;
    const data=[...chat.querySelectorAll('.bubble.user,.bubble.kivo:not(.thinking-bubble)')].slice(-20).map(b=>({role:b.classList.contains('user')?'user':'kivo',text:b.dataset.plainText||b.textContent.trim()}));
    try{sessionStorage.setItem(chatStorageKey(),JSON.stringify(data))}catch{}
  }
  function restoreLocalChat(){
    const chat=$('#chat');if(!chat)return false;
    let data=[];try{data=JSON.parse(sessionStorage.getItem(chatStorageKey())||'[]')}catch{}
    if(!data.length)return false;
    chat.innerHTML=data.map(m=>`<div class="bubble ${m.role==='user'?'user':'kivo smart-reply'}">${escapeHtml(m.text)}</div>`).join('');
    chat.scrollTop=chat.scrollHeight;return true;
  }
  async function restoreServerChat(force=false){
    const chat=$('#chat');if(!chat||serverHistoryLoaded&&!force)return;
    let logged=false;try{logged=!!user}catch{}
    if(!logged||$('#app')?.classList.contains('hidden'))return;
    if(!force&&restoreLocalChat()){serverHistoryLoaded=true;return}
    try{
      const d=await api('/api/assistant/history');
      const messages=(d.messages||[]).filter(m=>m.role==='user'||m.role==='assistant').slice(-20);
      if(messages.length){
        chat.innerHTML=messages.map(m=>`<div class="bubble ${m.role==='user'?'user':'kivo smart-reply'}">${escapeHtml(m.content)}</div>`).join('');
        chat.scrollTop=chat.scrollHeight;saveChat();
      }
      serverHistoryLoaded=true;
    }catch{}
  }

  function injectChatControls(){
    const hero=$('#askView .hero-block');if(!hero||$('#askConversationControls'))return;
    const controls=document.createElement('div');controls.id='askConversationControls';controls.className='ask-conversation-controls';
    controls.innerHTML='<button id="clearAskHistory" type="button" aria-label="Start a new Ask Kivo conversation">↻ New chat</button>';
    hero.appendChild(controls);
    $('#clearAskHistory').onclick=clearConversation;
  }
  async function clearConversation(){
    if(asking)return;
    try{await api('/api/assistant/history',{method:'DELETE',body:JSON.stringify({})})}catch{}
    try{sessionStorage.removeItem(chatStorageKey())}catch{}
    serverHistoryLoaded=true;
    const chat=$('#chat');if(chat)chat.innerHTML='<div class="bubble kivo smart-reply">Fresh conversation. Ask me what needs attention, what’s coming up, or about something you saved.</div>';
    quickPrompts();safeToast('Ask Kivo conversation cleared.','good');$('#askInput')?.focus();
  }

  function thinkingBubble(){
    const chat=$('#chat');if(!chat)return null;
    let b=$('#kivoThinking');if(b)return b;
    b=document.createElement('div');b.id='kivoThinking';b.className='bubble kivo thinking-bubble';b.innerHTML='<span class="thinking-dots"><i></i><i></i><i></i></span><span class="thinking-label">Kivo is thinking</span>';
    chat.appendChild(b);chat.scrollTop=chat.scrollHeight;return b;
  }
  function removeThinking(){$('#kivoThinking')?.remove()}

  function installChatObserver(){
    const chat=$('#chat');if(!chat||chatObserver)return;
    chatObserver=new MutationObserver(mutations=>{
      let userAdded=false,replyAdded=false;
      for(const m of mutations)for(const n of m.addedNodes){
        if(!(n instanceof HTMLElement))continue;
        if(n.matches?.('.bubble.user'))userAdded=true;
        if(n.matches?.('.bubble.kivo:not(.thinking-bubble)')){replyAdded=true;n.classList.add('smart-reply')}
      }
      if(userAdded&&!replyAdded&&!$('#kivoThinking'))thinkingBubble();
      if(replyAdded){removeThinking();saveChat()}
    });
    chatObserver.observe(chat,{childList:true});
  }

  function installSmarterAsk(){
    if(typeof ask!=='function'||ask.__kivoSmartWrapped)return;
    const smartAsk=async q=>{
      q=String(q||'').trim();if(!q||asking)return;
      if(!navigator.onLine){safeToast('You’re offline. Ask Kivo needs a connection right now.','error');return}
      asking=true;
      const chat=$('#chat'),input=$('#askInput'),send=$('#askSend');
      if(chat?.children.length===1&&chat.firstElementChild?.textContent.includes('Ask “'))chat.innerHTML='';
      chat?.insertAdjacentHTML('beforeend',`<div class="bubble user">${escapeHtml(q)}</div>`);
      if(input)input.value='';setBusy(send,true,'…');thinkingBubble();chat&&(chat.scrollTop=chat.scrollHeight);
      try{
        const d=await api('/api/ask',{method:'POST',body:JSON.stringify({q})});
        removeThinking();
        const corrected=String(d.corrected_query||'').trim();
        const correction=corrected&&corrected.toLowerCase()!==q.toLowerCase()?`<div class="understood-as">Understood as: ${escapeHtml(corrected)}</div>`:'';
        chat?.insertAdjacentHTML('beforeend',`<div class="bubble kivo smart-reply" data-plain-text="${escapeHtml(d.answer)}">${escapeHtml(d.answer)}${correction}</div>`);
        if(/pay|charge|subscription|money/i.test(q))quickPrompts(['What hits next?','Anything avoidable?','What’s due this week?']);
        else if(/urgent|first|priority|need/i.test(q))quickPrompts(['What about after that?','What’s due tomorrow?','Give me an overview']);
        else quickPrompts(['What should I handle first?','Anything urgent?','What am I paying for?']);
      }catch(err){
        removeThinking();chat?.insertAdjacentHTML('beforeend',`<div class="bubble kivo smart-reply error-reply">${escapeHtml(err.message||'I couldn’t finish that. Try again.')}</div>`);
      }finally{
        asking=false;setBusy(send,false);chat&&(chat.scrollTop=chat.scrollHeight);saveChat();input?.focus();
      }
    };
    smartAsk.__kivoSmartWrapped=true;
    try{ask=smartAsk}catch{window.ask=smartAsk}
  }

  function bestOpenItem(){
    try{
      const open=(items||[]).filter(x=>x.status==='open');if(!open.length)return null;
      const today=new Date();today.setHours(12,0,0,0);
      const score=x=>{if(!x.due_date)return 99999;const d=new Date(`${x.due_date}T12:00:00`),days=Math.round((d-today)/86400000);return days<0?days-1000:days};
      return open.slice().sort((a,b)=>score(a)-score(b))[0];
    }catch{return null}
  }

  function injectFocusCard(){
    const home=$('#homeView'),hero=home?.querySelector('.hero-block');if(!home||!hero)return;
    let card=$('#kivoFocusCard');if(!card){card=document.createElement('section');card.id='kivoFocusCard';card.className='focus-card';hero.insertAdjacentElement('afterend',card)}
    const item=bestOpenItem();
    if(!item){card.className='focus-card clear';card.innerHTML='<div class="focus-icon">✓</div><div><span>FOCUS</span><strong>You’re clear.</strong><p>Nothing needs immediate attention right now.</p></div>';return}
    const amount=item.amount!=null?` · ${typeof moneyFmt==='function'?moneyFmt(item.amount):`A$${Number(item.amount).toFixed(2)}`}`:'';
    let when='No deadline set';
    if(item.due_date){try{const d=new Date(`${item.due_date}T12:00:00`),t=new Date();t.setHours(12,0,0,0);const days=Math.round((d-t)/86400000);when=days<0?`${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`:days===0?'Due today':days===1?'Due tomorrow':`Due in ${days} days`}catch{}}
    card.className=`focus-card ${item.category||'task'}`;
    card.innerHTML=`<div class="focus-icon">${item.category==='money'?'$':'!'}</div><div class="focus-copy"><span>NEXT UP</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(when)}${amount}</p></div><button type="button" class="focus-open">Open</button>`;
    card.querySelector('.focus-open').onclick=()=>{try{go(item.category==='money'?'money':'inbox')}catch{}};
  }

  function injectFirstRun(){
    const home=$('#homeView');if(!home)return;
    let guide=$('#firstRunGuide');let count=1;try{count=(items||[]).length}catch{}
    if(count>0){guide?.remove();return}if(guide)return;
    guide=document.createElement('section');guide.id='firstRunGuide';guide.className='first-run-guide';
    guide.innerHTML=`<div class="first-run-head"><span>START HERE</span><strong>Give Kivo one real thing.</strong><p>No setup maze. Add something you already need to remember and Kivo will organise it.</p></div><div class="first-run-examples"><button data-example="Netflix 9.99 every month on the 11th remind me 1 day before">Subscription</button><button data-example="Dentist appointment next Thursday at 4:15pm remind me the day before">Appointment</button><button data-example="Return headphones by Friday">Deadline</button></div>`;
    const target=home.querySelector('.summary-grid');target?.insertAdjacentElement('beforebegin',guide);
    guide.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{try{go('inbox')}catch{};setTimeout(()=>{const t=$('#captureText');if(t){t.value=b.dataset.example;t.focus()}},50)});
  }

  function installInboxFilters(){
    const all=$('#allList');if(!all||$('#inboxFilterBar'))return;
    const bar=document.createElement('div');bar.id='inboxFilterBar';bar.className='inbox-filter-bar';
    bar.innerHTML=`<div class="inbox-search-wrap"><span>⌕</span><input id="inboxSearch" type="search" placeholder="Search everything in Kivo" aria-label="Search Kivo inbox"></div><div class="inbox-filter-chips"><button class="active" data-filter="all">All</button><button data-filter="open">Open</button><button data-filter="money">Money</button><button data-filter="deadline">Deadlines</button></div><span id="inboxFilterCount" class="filter-count"></span>`;
    all.parentElement?.insertBefore(bar,all);
    $('#inboxSearch')?.addEventListener('input',applyInboxFilter);
    bar.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{inboxFilter=b.dataset.filter;bar.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));applyInboxFilter()});
  }
  function applyInboxFilter(){
    const list=$('#allList');if(!list)return;
    const q=($('#inboxSearch')?.value||'').trim().toLowerCase();let shown=0,total=0;
    [...list.querySelectorAll('.item-card')].forEach(card=>{
      total++;const text=card.textContent.toLowerCase();
      const typeOk=inboxFilter==='all'||(inboxFilter==='money'&&card.classList.contains('money'))||(inboxFilter==='deadline'&&card.classList.contains('deadline'))||(inboxFilter==='open'&&!/\b(done|cancelled)\b/i.test(text));
      const searchOk=!q||text.includes(q),show=typeOk&&searchOk;card.classList.toggle('filtered-out',!show);if(show)shown++;
    });
    const c=$('#inboxFilterCount');if(c)c.textContent=total?`${shown} of ${total}`:'';
  }

  function exportKivoData(){
    let profile=null,allItems=[];try{profile=user||null;allItems=items||[]}catch{}
    const payload={product:'Kivo',exported_at:new Date().toISOString(),profile:profile?{name:profile.name||null,email:profile.email||null}:null,items:allItems};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`kivo-export-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);safeToast('Kivo export created.','good');
  }

  function installCommandPalette(){
    if($('#kivoCommandPalette'))return;
    const wrap=document.createElement('div');wrap.id='kivoCommandPalette';wrap.className='command-palette hidden';
    wrap.innerHTML=`<div class="command-backdrop"></div><div class="command-panel" role="dialog" aria-modal="true" aria-label="Kivo command menu"><div class="command-search"><span>⌕</span><input id="commandInput" placeholder="Go somewhere or find something…" autocomplete="off"><kbd>Esc</kbd></div><div id="commandResults" class="command-results"></div><div class="command-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span></div></div>`;
    document.body.appendChild(wrap);
    const input=$('#commandInput');
    const close=()=>{wrap.classList.add('hidden');input.value=''};
    const open=()=>{if($('#app')?.classList.contains('hidden'))return;wrap.classList.remove('hidden');renderCommands('');setTimeout(()=>input.focus(),0)};
    const actions=()=>[
      {label:'Home',hint:'Dashboard',icon:'⌂',run:()=>go('home')},{label:'Inbox',hint:'Everything you saved',icon:'⌁',run:()=>go('inbox')},{label:'Money',hint:'Charges and renewals',icon:'$',run:()=>go('money')},{label:'Ask Kivo',hint:'Search your life admin',icon:'✦',run:()=>go('ask')},{label:'Add something',hint:'Create a new item',icon:'+',run:()=>$('#itemDialog')?.showModal()},{label:'New Ask conversation',hint:'Clear Ask Kivo history',icon:'↻',run:clearConversation},{label:'Export my Kivo',hint:'Download your saved items as JSON',icon:'⇩',run:exportKivoData},{label:'Settings',hint:'Account, plan and updates',icon:'⚙',run:()=>$('#settingsDialog')?.showModal()}];
    const renderCommands=query=>{
      const q=query.trim().toLowerCase();let rows=actions();
      try{for(const x of (items||[]).slice(0,30))rows.push({label:x.title,hint:[x.category,x.due_date].filter(Boolean).join(' · '),icon:x.category==='money'?'$':'•',run:()=>{go(x.category==='money'?'money':'inbox');setTimeout(()=>{const s=$('#inboxSearch');if(s){s.value=x.title;applyInboxFilter()}},50)}})}catch{}
      rows=rows.filter(x=>!q||`${x.label} ${x.hint}`.toLowerCase().includes(q)).slice(0,12);
      $('#commandResults').innerHTML=rows.length?rows.map((x,i)=>`<button class="command-row ${i===0?'selected':''}" data-index="${i}"><span class="command-icon">${x.icon}</span><span><strong>${escapeHtml(x.label)}</strong><small>${escapeHtml(x.hint)}</small></span></button>`).join(''):'<div class="command-empty">Nothing matches that.</div>';
      [...$('#commandResults').querySelectorAll('.command-row')].forEach((b,i)=>b.onclick=()=>{rows[i]?.run();close()});
    };
    input.addEventListener('input',()=>renderCommands(input.value));
    input.addEventListener('keydown',e=>{
      const buttons=[...$('#commandResults').querySelectorAll('.command-row')];if(!buttons.length)return;let i=Math.max(0,buttons.findIndex(b=>b.classList.contains('selected')));
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[i].classList.remove('selected');i=(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i].classList.add('selected');buttons[i].scrollIntoView({block:'nearest'})}
      if(e.key==='Enter'){e.preventDefault();buttons[i].click()}
    });
    wrap.querySelector('.command-backdrop').onclick=close;
    addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();wrap.classList.contains('hidden')?open():close()}
      if(e.key==='Escape'&&!wrap.classList.contains('hidden'))close();
      if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();open()}
    });
  }

  function installSettingsExtras(){
    const dialog=$('#settingsDialog');if(!dialog||$('#kivoSettingsExtras'))return;
    const logout=$('#logoutBtn');if(!logout)return;
    const section=document.createElement('section');section.id='kivoSettingsExtras';section.className='settings-extras';
    section.innerHTML=`<div><strong>Quick controls</strong><p>Press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere in Kivo to jump, search or add something.</p></div><div class="settings-mini-grid"><span><b>Enter</b><small>Send Ask Kivo</small></span><span><b>Esc</b><small>Close dialogs</small></span><span><b>/</b><small>Open search</small></span></div><div class="settings-action-row"><button id="exportKivoBtn" type="button">Export my Kivo</button><button id="clearAskSettingsBtn" type="button">New Ask chat</button></div>`;
    logout.parentNode.insertBefore(section,logout);$('#exportKivoBtn').onclick=exportKivoData;$('#clearAskSettingsBtn').onclick=clearConversation;
  }

  function installNavState(){
    const sync=()=>$$('.bottom-nav button,.desktop-rail nav button[data-view]').forEach(b=>{if(b.classList.contains('active'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    $$('.bottom-nav button,.desktop-rail nav button[data-view]').forEach(b=>b.addEventListener('click',()=>{requestAnimationFrame(sync);if(b.dataset.view==='ask')setTimeout(()=>restoreServerChat(),80)}));sync();
  }

  function refreshDynamic(){injectFocusCard();injectFirstRun();applyInboxFilter()}

  function observeCards(){
    if(cardsObserver)return;const task=$('#taskList'),all=$('#allList');if(!task&&!all)return;
    let queued=false;const run=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refreshDynamic()})};
    cardsObserver=new MutationObserver(run);task&&cardsObserver.observe(task,{childList:true});all&&cardsObserver.observe(all,{childList:true});
  }

  function init(){
    polishInputs();addSmartBadge();injectChatControls();quickPrompts();installAccessibility();installConnectivity();installErrorBoundary();installCaptureState();installChatObserver();installSmarterAsk();installInboxFilters();installCommandPalette();installSettingsExtras();installNavState();observeCards();refreshDynamic();
    setTimeout(()=>restoreServerChat(),700);
    addEventListener('pageshow',()=>{polishInputs();refreshDynamic();restoreServerChat()});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshDynamic();restoreServerChat()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
