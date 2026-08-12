(()=>{
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  let scheduled=false;
  let lastOnline=navigator.onLine;

  function safeToast(message,type=''){
    try{
      if(typeof toast==='function') return toast(message,type);
      const layer=$('#toastLayer');
      if(layer){layer.innerHTML=`<div class="toast ${type}">${String(message).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}</div>`;setTimeout(()=>layer.innerHTML='',3200);}
    }catch{}
  }

  function polishInputs(){
    const ask=$('#askInput');
    if(ask){
      ask.spellcheck=true;
      ask.autocomplete='off';
      ask.autocapitalize='sentences';
      ask.enterKeyHint='send';
      ask.placeholder='Ask naturally — typos are fine…';
      ask.setAttribute('aria-label','Ask Kivo anything about your saved life admin');
    }
    const capture=$('#captureText');
    if(capture){
      capture.spellcheck=true;
      capture.autocapitalize='sentences';
      capture.placeholder='Try: Netflix $9.99 every 11th, remind me a day before';
      capture.setAttribute('aria-label','Paste or type something for Kivo to understand');
      if(!capture.dataset.autoSize){
        capture.dataset.autoSize='1';
        const resize=()=>{capture.style.height='auto';capture.style.height=Math.min(220,Math.max(110,capture.scrollHeight))+'px'};
        capture.addEventListener('input',resize,{passive:true});
        resize();
      }
    }
  }

  function addSmartBadge(){
    const ask=$('#askView .hero-block');
    if(ask&&!$('#kivoSmartBadge')){
      const b=document.createElement('div');
      b.id='kivoSmartBadge';
      b.className='smart-badge';
      b.innerHTML='<span aria-hidden="true">✦</span><span>Context-aware</span>';
      ask.appendChild(b);
    }
  }

  function improveChat(){
    const chat=$('#chat');
    if(!chat)return;
    chat.setAttribute('role','log');
    chat.setAttribute('aria-live','polite');
    chat.setAttribute('aria-relevant','additions');
    chat.querySelectorAll('.bubble.kivo:not(.smart-reply)').forEach(b=>b.classList.add('smart-reply'));
    if(chat.dataset.smartObserver==='1')return;
    chat.dataset.smartObserver='1';
    const observer=new MutationObserver(records=>{
      let added=false;
      for(const r of records){if(r.addedNodes.length){added=true;break}}
      if(!added)return;
      requestAnimationFrame(()=>chat.querySelectorAll('.bubble.kivo:not(.smart-reply)').forEach(b=>b.classList.add('smart-reply')));
    });
    observer.observe(chat,{childList:true});
  }

  function quickPrompts(){
    const row=$('#askView .chip-row');
    if(!row)return;
    const labels=['What should I handle first?','Anything urgent?','What am I paying for?'];
    [...row.querySelectorAll('button')].slice(0,3).forEach((b,i)=>{
      if(b.textContent!==labels[i])b.textContent=labels[i];
      b.type='button';
    });
  }

  function polishButtons(){
    $$('button').forEach(b=>{
      if(!b.getAttribute('type')&&!b.closest('form'))b.type='button';
      if(!b.getAttribute('aria-label')){
        const t=(b.textContent||'').trim();
        if(t)b.setAttribute('aria-label',t);
      }
    });
    const map=[['#settingsBtn','Open settings'],['#closeSettings','Close settings'],['#closeDialog','Close dialog'],['#fab','Add a new item'],['#askSend','Send message']];
    map.forEach(([s,label])=>$(s)?.setAttribute('aria-label',label));
  }

  function makeDialogsBetter(){
    $$('dialog').forEach(d=>{
      if(d.dataset.polished==='1')return;
      d.dataset.polished='1';
      d.addEventListener('click',e=>{if(e.target===d){try{d.close()}catch{}}});
      d.addEventListener('close',()=>document.activeElement?.blur?.());
    });
  }

  function addConnectionPill(){
    if($('#kivoConnection'))return;
    const pill=document.createElement('div');
    pill.id='kivoConnection';
    pill.className='connection-pill';
    pill.setAttribute('role','status');
    document.body.appendChild(pill);
    updateConnection(false);
  }

  function updateConnection(announce=true){
    const pill=$('#kivoConnection');if(!pill)return;
    const online=navigator.onLine;
    pill.className=`connection-pill ${online?'online':'offline'}`;
    pill.textContent=online?'Online':'Offline';
    if(announce&&online!==lastOnline)safeToast(online?'Back online.':'You’re offline — Kivo will keep the page open, but online features may pause.',online?'good':'error');
    lastOnline=online;
    clearTimeout(updateConnection._t);
    updateConnection._t=setTimeout(()=>pill.classList.add('quiet'),2200);
  }

  function addKeyboardShortcuts(){
    if(document.documentElement.dataset.kivoKeys==='1')return;
    document.documentElement.dataset.kivoKeys='1';
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){
        const open=$$('dialog[open]').pop();if(open){e.preventDefault();try{open.close()}catch{}}
        return;
      }
      const tag=document.activeElement?.tagName;
      const typing=['INPUT','TEXTAREA','SELECT'].includes(tag);
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
        e.preventDefault();
        try{if(typeof go==='function')go('ask')}catch{}
        setTimeout(()=>$('#askInput')?.focus(),60);
      }else if(!typing&&e.key==='/'){
        e.preventDefault();
        try{if(typeof go==='function')go('ask')}catch{}
        setTimeout(()=>$('#askInput')?.focus(),60);
      }
    });
  }

  function addBusyFeedback(){
    const configs=[
      ['#captureBtn','Understanding…'],['#askSend','Thinking…'],['#checkUpdateBtn','Checking…'],['#installUpdateBtn','Updating…'],['#authSubmit','One moment…']
    ];
    configs.forEach(([sel,busyText])=>{
      const b=$(sel);if(!b||b.dataset.busyPolish==='1')return;
      b.dataset.busyPolish='1';
      b.addEventListener('click',()=>{
        if(b.disabled)return;
        const old=b.textContent;
        b.classList.add('is-busy');
        b.setAttribute('aria-busy','true');
        if(old.trim())b.dataset.oldLabel=old;
        if(sel!=='#askSend')b.textContent=busyText;
        setTimeout(()=>{
          b.classList.remove('is-busy');b.removeAttribute('aria-busy');
          if(b.dataset.oldLabel&&b.textContent===busyText)b.textContent=b.dataset.oldLabel;
        },4500);
      });
    });
  }

  function makeCardsKeyboardFriendly(){
    $$('.item-card').forEach(card=>{
      if(card.dataset.a11y==='1')return;
      card.dataset.a11y='1';
      card.setAttribute('role','group');
      const title=card.querySelector('.item-copy strong')?.textContent?.trim();
      if(title)card.setAttribute('aria-label',title);
    });
  }

  function fixTextQuality(){
    const replacements=[
      ['Payments not connected yet','Payments aren’t connected yet'],
      ['Your data is isolated by account on this Kivo server.','Your account data stays separated from other Kivo users on this server.']
    ];
    $$('p,strong,h1,h2,h3,span').forEach(el=>{
      if(el.children.length)return;
      const t=el.textContent?.trim();
      const r=replacements.find(([a])=>t===a);
      if(r)el.textContent=r[1];
    });
  }

  function installGlobalRecovery(){
    if(window.__kivoRecoveryInstalled)return;
    window.__kivoRecoveryInstalled=true;
    window.addEventListener('unhandledrejection',e=>{
      console.error('Kivo async error:',e.reason);
      safeToast('Something didn’t finish properly. Try that again — your page is still safe.','error');
    });
    window.addEventListener('error',e=>console.error('Kivo UI error:',e.error||e.message));
  }

  function refresh(){
    scheduled=false;
    polishInputs();addSmartBadge();improveChat();quickPrompts();polishButtons();makeDialogsBetter();addBusyFeedback();makeCardsKeyboardFriendly();fixTextQuality();
  }

  function scheduleRefresh(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(refresh);
  }

  function bootSmart(){
    document.documentElement.classList.add('kivo-polished');
    installGlobalRecovery();addKeyboardShortcuts();addConnectionPill();refresh();
    window.addEventListener('online',()=>updateConnection(true));
    window.addEventListener('offline',()=>updateConnection(true));
    const root=$('#app')||document.body;
    const observer=new MutationObserver(records=>{
      if(records.some(r=>r.addedNodes.length||r.removedNodes.length))scheduleRefresh();
    });
    observer.observe(root,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootSmart,{once:true});
  else bootSmart();
})();
