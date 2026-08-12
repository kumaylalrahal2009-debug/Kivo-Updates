(()=>{
  const $=s=>document.querySelector(s);
  let observer=null;
  let queued=false;

  function injectStyles(){
    if($('#moneyIntelligenceStyles'))return;
    const style=document.createElement('style');style.id='moneyIntelligenceStyles';style.textContent=`
      .money-intelligence{margin:12px 0 16px;padding:14px;border-radius:20px;border:1px solid rgba(100,211,168,.14);background:linear-gradient(145deg,rgba(63,190,145,.07),rgba(255,255,255,.03))}
      .money-intelligence-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}.money-intelligence-head span{display:block;font-size:9px;font-weight:850;letter-spacing:.13em;color:#75d5ad}.money-intelligence-head strong{display:block;margin-top:3px;font-size:15px;letter-spacing:-.025em}.money-intelligence-head button{padding:7px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#aab5c8;font-size:9.5px}
      .money-intelligence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.money-intelligence-grid article{padding:10px;border-radius:13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}.money-intelligence-grid span,.money-intelligence-grid strong,.money-intelligence-grid small{display:block}.money-intelligence-grid span{font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#77859b}.money-intelligence-grid strong{margin-top:4px;font-size:15px;letter-spacing:-.025em;font-variant-numeric:tabular-nums}.money-intelligence-grid small{margin-top:2px;font-size:9px;color:#718097;line-height:1.35}
      .money-insight{display:flex;align-items:flex-start;gap:9px;margin-top:9px;padding:10px;border-radius:13px;background:rgba(105,125,255,.055);border:1px solid rgba(117,134,255,.08)}.money-insight-icon{width:27px;height:27px;flex:0 0 27px;display:grid;place-items:center;border-radius:9px;background:rgba(112,128,255,.1);color:#aab5ff;font-weight:800}.money-insight strong{display:block;font-size:10.5px}.money-insight p{margin:2px 0 0;font-size:9.5px;color:#8190a6;line-height:1.4}
      .money-timeline{margin-top:10px;display:grid;gap:6px}.money-timeline-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.025)}.money-timeline-row strong,.money-timeline-row span{display:block}.money-timeline-row strong{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.money-timeline-row span{margin-top:2px;font-size:8.5px;color:#718097}.money-timeline-row b{font-size:10.5px;font-variant-numeric:tabular-nums}.money-timeline-empty{padding:8px;color:#738096;font-size:9.5px}
      @media(max-width:420px){.money-intelligence-grid{grid-template-columns:1fr 1fr}.money-intelligence{padding:12px}.money-intelligence-grid strong{font-size:14px}}
    `;document.head.appendChild(style);
  }

  function getItems(){try{return Array.isArray(items)?items:[]}catch{return[]}}
  function amount(n){try{return typeof moneyFmt==='function'?moneyFmt(Number(n||0)):new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0))}catch{return`A$${Number(n||0).toFixed(2)}`}}
  function daysUntil(iso){if(!iso)return 99999;const[y,m,d]=String(iso).split('-').map(Number),now=new Date(),a=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),b=new Date(y,m-1,d,12);return Math.round((b-a)/86400000)}
  function friendlyDate(iso){if(!iso)return'No date';const n=daysUntil(iso);if(n<0)return`${Math.abs(n)}d overdue`;if(n===0)return'Today';if(n===1)return'Tomorrow';if(n<7)return`In ${n} days`;const[y,m,d]=String(iso).split('-').map(Number);return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short'}).format(new Date(y,m-1,d,12))}
  function monthlyEquivalent(x){const a=Number(x.amount||0);if(x.recurrence==='daily')return a*365/12;if(x.recurrence==='weekly')return a*52/12;if(x.recurrence==='fortnightly')return a*26/12;if(x.recurrence==='yearly')return a/12;if(x.recurrence==='monthly')return a;return 0}

  function ensurePanel(){
    const view=$('#moneyView');if(!view)return null;let panel=$('#moneyIntelligence');if(panel)return panel;
    panel=document.createElement('section');panel.id='moneyIntelligence';panel.className='money-intelligence';
    const hero=view.querySelector('.money-hero');hero?.insertAdjacentElement('afterend',panel);return panel;
  }

  function render(){
    queued=false;injectStyles();const panel=ensurePanel();if(!panel)return;
    const open=getItems().filter(x=>x.status==='open'&&x.amount!=null);
    const dated=open.filter(x=>x.due_date).sort((a,b)=>daysUntil(a.due_date)-daysUntil(b.due_date));
    const recurring=open.filter(x=>x.recurrence);
    const next30=dated.filter(x=>{const n=daysUntil(x.due_date);return n>=0&&n<=30});
    const next30Total=next30.reduce((s,x)=>s+Number(x.amount||0),0);
    const monthly=recurring.reduce((s,x)=>s+monthlyEquivalent(x),0);
    const avoidable=open.filter(x=>x.avoidable);
    const avoidableMonthly=avoidable.filter(x=>x.recurrence).reduce((s,x)=>s+monthlyEquivalent(x),0);
    const next=dated.find(x=>daysUntil(x.due_date)>=0)||dated[0]||open[0]||null;

    let insightTitle='Your money picture is quiet.';
    let insightCopy=open.length?'Kivo has charges saved, but none needs immediate attention.':'Add recurring charges and Kivo will build this picture automatically.';
    if(next){const n=daysUntil(next.due_date);if(n<=3){insightTitle=`${next.title} is the next charge.`;insightCopy=`${amount(next.amount)} · ${friendlyDate(next.due_date)}${next.recurrence?` · ${next.recurrence}`:''}.`;}}
    if(avoidableMonthly>0){insightTitle=`${amount(avoidableMonthly)}/month is marked avoidable.`;insightCopy='Those are the first recurring charges I’d review if you want to cut spending.';}

    panel.innerHTML=`
      <div class="money-intelligence-head"><div><span>MONEY INTELLIGENCE</span><strong>What your saved charges mean</strong></div><button id="askMoneyInsight" type="button">Ask Kivo</button></div>
      <div class="money-intelligence-grid">
        <article><span>Next 30 days</span><strong>${amount(next30Total)}</strong><small>${next30.length} dated charge${next30.length===1?'':'s'}</small></article>
        <article><span>Recurring baseline</span><strong>${amount(monthly)}/mo</strong><small>monthly equivalent</small></article>
        <article><span>Next charge</span><strong>${next?amount(next.amount):'—'}</strong><small>${next?`${next.title} · ${friendlyDate(next.due_date)}`:'Nothing dated'}</small></article>
        <article><span>Avoidable recurring</span><strong>${amount(avoidableMonthly)}/mo</strong><small>${avoidable.length} charge${avoidable.length===1?'':'s'} marked optional</small></article>
      </div>
      <div class="money-insight"><div class="money-insight-icon">✦</div><div><strong>${escapeText(insightTitle)}</strong><p>${escapeText(insightCopy)}</p></div></div>
      <div class="money-timeline">${next30.slice(0,4).map(x=>`<div class="money-timeline-row"><div><strong>${escapeText(x.title)}</strong><span>${friendlyDate(x.due_date)}${x.recurrence?` · ${escapeText(x.recurrence)}`:''}</span></div><b>${amount(x.amount)}</b></div>`).join('')||'<div class="money-timeline-empty">No dated charges in the next 30 days.</div>'}</div>`;
    $('#askMoneyInsight')?.addEventListener('click',()=>{try{go('ask');setTimeout(()=>{const input=$('#askInput');if(input){input.value=avoidableMonthly>0?'what can i cut from my subscriptions?':'what should i know about my upcoming charges?';input.focus()}},60)}catch{}});
  }

  function escapeText(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(render)}
  function init(){
    render();const list=$('#moneyList'),all=$('#allList');observer=new MutationObserver(schedule);if(list)observer.observe(list,{childList:true});if(all)observer.observe(all,{childList:true});
    document.querySelectorAll('[data-view="money"]').forEach(b=>b.addEventListener('click',()=>setTimeout(render,40)));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
