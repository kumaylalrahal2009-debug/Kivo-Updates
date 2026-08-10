(()=>{
  const $=s=>document.querySelector(s);
  function polishInputs(){
    const ask=$('#askInput');if(ask){ask.setAttribute('spellcheck','true');ask.setAttribute('autocomplete','off');ask.placeholder='Ask naturally — typos are fine…';}
    const capture=$('#captureText');if(capture){capture.setAttribute('spellcheck','true');capture.placeholder='Try: Netflix 9.99 every 11th, remind me a day before';}
  }
  function addSmartBadge(){
    const ask=$('#askView .hero-block');if(ask&&!$('#kivoSmartBadge')){const b=document.createElement('div');b.id='kivoSmartBadge';b.className='smart-badge';b.innerHTML='<span>✦</span> Context-aware';ask.appendChild(b);}
  }
  function improveChat(){
    const chat=$('#chat');if(!chat)return;
    const observer=new MutationObserver(()=>{chat.querySelectorAll('.bubble.kivo').forEach(b=>{b.classList.add('smart-reply');});});observer.observe(chat,{childList:true,subtree:true});
  }
  function quickPrompts(){
    const row=$('#askView .chip-row');if(!row)return;const labels=['What should I handle first?','Anything urgent?','What am I paying for?'];[...row.querySelectorAll('button')].forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});
  }
  function bootSmart(){polishInputs();addSmartBadge();improveChat();quickPrompts();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootSmart);else setTimeout(bootSmart,0);
  const observer=new MutationObserver(()=>{polishInputs();addSmartBadge();quickPrompts();});observer.observe(document.documentElement,{childList:true,subtree:true});
})();
