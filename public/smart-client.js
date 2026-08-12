(()=>{
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  let asking=false;
  let serverHistoryLoaded=false;
  let startupUpdateChecked=false;
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  function safeToast(message,type=''){try{if(typeof toast==='function')return toast(message,type)}catch{}console[type==='error'?'error':'log']('[Kivo]',message)}
  function loggedIn(){try{return !!user&&!$('#app')?.classList.contains('hidden')}catch{return false}}
  function csrf(){try{return String(user?.csrf||window.csrf||'')}catch{return''}}
  async function startupUpdateCheck(){
    if(startupUpdateChecked||!loggedIn()||!navigator.onLine)return;
    startupUpdateChecked=true;
    try{
      const r=await fetch('/api/update/check',{cache:'no-store',headers:{Accept:'application/json'}});
      if(r.status===401){startupUpdateChecked=false;return}
      const info=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(info.error||'Update check failed.');
      if(!info.available)return;
      const latest=info.latestVersion||'new version';
      safeToast(`Kivo ${latest} is available. Updating now…`,'good');
      const token=csrf();
      if(!token){startupUpdateChecked=false;return}
      const install=await fetch('/api/update/install',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({_csrf:token})});
      const result=await install.json().catch(()=>({}));
      if(!install.ok)throw new Error(result.error||'Automatic update could not start.');
      document.body?.classList.add('kivo-updating');
      safeToast(`Installing Kivo ${result.version||latest}. It will restart automatically.`,'good');
    }catch(err){console.warn('Kivo startup update:',err);safeToast(`Update check: ${err.message||'could not reach GitHub'}`,'error')}
  }
  function scheduleUpdateCheck(){setTimeout(startupUpdateCheck,900)}
  function polishInputs(){const ask=$('#askInput');if(ask){ask.spellcheck=true;ask.autocomplete='off';ask.autocapitalize='sentences';ask.placeholder='Ask naturally — typos are fine…'}const capture=$('#captureText');if(capture){capture.spellcheck=true;capture.autocapitalize='sentences'}}
  function addSmartBadge(){const hero=$('#askView .hero-block');if(hero&&!$('#kivoSmartBadge')){const b=document.createElement('div');b.id='kivoSmartBadge';b.className='smart-badge';b.innerHTML='<span>✦</span><span>Context-aware</span><small>Typos are fine</small>';hero.appendChild(b)}}
  function quickPrompts(labels=['What should I handle first?','Anything urgent?','What am I paying for?']){const row=$('#askView .chip-row');if(!row)return;[...row.querySelectorAll('button')].forEach((b,i)=>{if(labels[i])b.textContent=labels[i];b.type='button'})}
  function setBusy(button,busy,label='Working…'){if(!button)return;if(busy){button.dataset.originalText=button.textContent;button.disabled=true;button.textContent=label}else{button.disabled=false;if(button.dataset.originalText)button.textContent=button.dataset.originalText}}
  function thinkingBubble(){const chat=$('#chat');if(!chat)return;let b=$('#kivoThinking');if(b)return;b=document.createElement('div');b.id='kivoThinking';b.className='bubble kivo thinking-bubble';b.innerHTML='<span class="thinking-dots"><i></i><i></i><i></i></span><span>Kivo is thinking</span>';chat.appendChild(b);chat.scrollTop=chat.scrollHeight}
  function removeThinking(){$('#kivoThinking')?.remove()}
  function installSmarterAsk(){if(typeof ask!=='function'||ask.__kivoSmartWrapped)return;const smartAsk=async q=>{q=String(q||'').trim();if(!q||asking)return;if(!navigator.onLine)return safeToast('You’re offline.','error');asking=true;const chat=$('#chat'),input=$('#askInput'),send=$('#askSend');chat?.insertAdjacentHTML('beforeend',`<div class="bubble user">${escapeHtml(q)}</div>`);if(input)input.value='';setBusy(send,true,'…');thinkingBubble();try{const d=await api('/api/ask',{method:'POST',body:JSON.stringify({q})});removeThinking();chat?.insertAdjacentHTML('beforeend',`<div class="bubble kivo smart-reply">${escapeHtml(d.answer)}</div>`);if(/pay|charge|subscription|money/i.test(q))quickPrompts(['What hits next?','Anything avoidable?','What’s due this week?']);else if(/urgent|first|priority|need/i.test(q))quickPrompts(['What about after that?','What’s due tomorrow?','Give me an overview'])}catch(err){removeThinking();chat?.insertAdjacentHTML('beforeend',`<div class="bubble kivo error-reply">${escapeHtml(err.message||'Try again.')}</div>`)}finally{asking=false;setBusy(send,false);chat&&(chat.scrollTop=chat.scrollHeight);input?.focus()}};smartAsk.__kivoSmartWrapped=true;try{ask=smartAsk}catch{window.ask=smartAsk}}
  async function restoreServerChat(){if(serverHistoryLoaded||!loggedIn())return;try{const d=await api('/api/assistant/history');const messages=(d.messages||[]).slice(-20);const chat=$('#chat');if(chat&&messages.length){chat.innerHTML=messages.map(m=>`<div class="bubble ${m.role==='user'?'user':'kivo smart-reply'}">${escapeHtml(m.content)}</div>`).join('');chat.scrollTop=chat.scrollHeight}serverHistoryLoaded=true}catch{}}
  function injectChatControls(){const hero=$('#askView .hero-block');if(!hero||$('#askConversationControls'))return;const c=document.createElement('div');c.id='askConversationControls';c.className='ask-conversation-controls';c.innerHTML='<button id="clearAskHistory" type="button">↻ New chat</button>';hero.appendChild(c);$('#clearAskHistory').onclick=async()=>{try{await api('/api/assistant/history',{method:'DELETE',body:'{}'});$('#chat').innerHTML='<div class="bubble kivo">Fresh conversation.</div>';serverHistoryLoaded=true}catch{}}}
  function installConnectivity(){if($('#kivoConnectivity'))return;const p=document.createElement('div');p.id='kivoConnectivity';p.className='connectivity-pill hidden';document.body.appendChild(p);const sync=()=>{p.classList.toggle('hidden',navigator.onLine);p.textContent=navigator.onLine?'Back online':'Offline — Kivo will reconnect automatically';if(navigator.onLine){startupUpdateChecked=false;scheduleUpdateCheck()}};addEventListener('online',sync);addEventListener('offline',sync);sync()}
  function init(){polishInputs();addSmartBadge();injectChatControls();quickPrompts();installConnectivity();installSmarterAsk();setTimeout(restoreServerChat,700);scheduleUpdateCheck();addEventListener('pageshow',()=>{startupUpdateChecked=false;scheduleUpdateCheck()});document.addEventListener('visibilitychange',()=>{if(!document.hidden){restoreServerChat();startupUpdateChecked=false;scheduleUpdateCheck()}})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();