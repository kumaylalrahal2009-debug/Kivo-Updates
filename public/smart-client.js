(()=>{
  const $=s=>document.querySelector(s);
  let scheduled=false;

  function polishInputs(){
    const ask=$('#askInput');
    if(ask){
      if(ask.getAttribute('spellcheck')!=='true') ask.setAttribute('spellcheck','true');
      if(ask.getAttribute('autocomplete')!=='off') ask.setAttribute('autocomplete','off');
      if(ask.placeholder!=='Ask naturally — typos are fine…') ask.placeholder='Ask naturally — typos are fine…';
    }
    const capture=$('#captureText');
    if(capture){
      if(capture.getAttribute('spellcheck')!=='true') capture.setAttribute('spellcheck','true');
      const p='Try: Netflix 9.99 every 11th, remind me a day before';
      if(capture.placeholder!==p) capture.placeholder=p;
    }
  }

  function addSmartBadge(){
    const ask=$('#askView .hero-block');
    if(ask&&!$('#kivoSmartBadge')){
      const b=document.createElement('div');
      b.id='kivoSmartBadge';
      b.className='smart-badge';
      b.innerHTML='<span>✦</span> Context-aware';
      ask.appendChild(b);
    }
  }

  function improveChat(){
    const chat=$('#chat');
    if(!chat||chat.dataset.smartObserver==='1') return;
    chat.dataset.smartObserver='1';
    const mark=()=>chat.querySelectorAll('.bubble.kivo:not(.smart-reply)').forEach(b=>b.classList.add('smart-reply'));
    mark();
    const observer=new MutationObserver(mark);
    observer.observe(chat,{childList:true,subtree:true});
  }

  function quickPrompts(){
    const row=$('#askView .chip-row');
    if(!row)return;
    const labels=['What should I handle first?','Anything urgent?','What am I paying for?'];
    [...row.querySelectorAll('button')].forEach((b,i)=>{
      if(labels[i]&&b.textContent!==labels[i]) b.textContent=labels[i];
    });
  }

  function refresh(){
    scheduled=false;
    polishInputs();
    addSmartBadge();
    improveChat();
    quickPrompts();
  }

  function scheduleRefresh(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(refresh);
  }

  function bootSmart(){
    refresh();
    const observer=new MutationObserver(scheduleRefresh);
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootSmart,{once:true});
  else bootSmart();
})();
