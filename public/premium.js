/* Kivo Experience Layer: memberships, billing UX and admin revenue */
(()=>{
  let billingState=null;
  let lastMembershipFetch=0;
  let membershipBusy=false;
  const q=s=>document.querySelector(s);
  const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0));

  async function billingApi(path,opt={}){
    const headers={...(opt.headers||{})};
    if(opt.method&&opt.method!=='GET'){
      headers['Content-Type']='application/json';
      try{if(typeof csrf!=='undefined'&&csrf)headers['X-CSRF-Token']=csrf}catch{}
    }
    const r=await fetch(path,{credentials:'same-origin',...opt,headers});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.error||'Billing request failed.');
    return d;
  }

  function buildSettingsCard(){
    const logout=q('#logoutBtn');if(!logout||q('#membershipCard'))return;
    const card=document.createElement('section');
    card.id='membershipCard';card.className='membership-card';
    card.innerHTML=`<div class="membership-head"><div><span class="membership-eyebrow">MEMBERSHIP</span><strong id="membershipPlan">Kivo Free</strong></div><span id="membershipBadge" class="membership-badge free">FREE</span></div><p id="membershipCopy">Core Kivo is free.</p><div id="usageGrid" class="usage-grid"></div><div id="membershipActions" class="membership-actions"></div>`;
    logout.parentNode.insertBefore(card,logout);
  }

  function renderMembership(d){
    billingState=d;buildSettingsCard();
    const pro=!!d.isPro,m=d.membership||{},u=d.usage||{},limits=d.limits||{},cfg=d.billing||{};
    const plan=q('#membershipPlan'),badge=q('#membershipBadge'),copy=q('#membershipCopy'),grid=q('#usageGrid'),actions=q('#membershipActions');if(!plan)return;
    const pastDue=m.status==='past_due';
    plan.textContent=pro?'Kivo Pro':'Kivo Free';
    badge.textContent=pro?(pastDue?'PAST DUE':'PRO'):'FREE';badge.className=`membership-badge ${pro?'pro':'free'}${pastDue?' past-due':''}`;
    copy.textContent=pro?(pastDue?'Your Pro features are still shown here, but your billing account needs attention.':'You have the full Kivo experience with unlimited core AI usage and premium automation.'):'Everything essential is available free. Pro is there for people who use Kivo heavily.';
    grid.innerHTML=pro?`<div><span>Smart captures</span><strong>Unlimited</strong></div><div><span>Ask Kivo</span><strong>Unlimited</strong></div>`:`<div><span>Captures this month</span><strong>${u.captures_month||0}/${limits.captures_month||30}</strong></div><div><span>Ask today</span><strong>${u.asks_today||0}/${limits.asks_day||15}</strong></div>`;
    if(pro){
      actions.innerHTML=`<button id="manageBillingBtn" class="billing-secondary" type="button">Manage billing</button>`;q('#manageBillingBtn').onclick=openPortal;
    }else if(cfg.connected){
      const annual=cfg.yearly_available?`<button class="billing-secondary" type="button" data-billing="year">${money(cfg.yearly_price)}/year <span class="billing-save">best value</span></button>`:'';
      actions.innerHTML=`<button class="billing-primary" type="button" data-billing="month">Upgrade to Pro · ${money(cfg.monthly_price)}/month</button>${annual}`;
      actions.querySelectorAll('[data-billing]').forEach(b=>b.onclick=()=>startCheckout(b.dataset.billing,b));
    }else{
      actions.innerHTML=`<div class="billing-not-connected"><strong>Payments aren’t connected yet</strong><span>Memberships are ready for testing. Connect the business Stripe account before public sales.</span></div>`;
    }
    syncPlanPill();
  }

  async function refreshMembership(force=false,showError=false){
    if(membershipBusy)return billingState;
    if(!force&&Date.now()-lastMembershipFetch<45000)return billingState;
    membershipBusy=true;
    try{const d=await billingApi('/api/billing/status');lastMembershipFetch=Date.now();renderMembership(d);return d}
    catch(err){if(showError&&typeof toast==='function')toast(err.message,'error');return null}
    finally{membershipBusy=false}
  }

  async function startCheckout(interval,button){
    const old=button?.textContent;
    try{if(button){button.disabled=true;button.textContent='Opening secure checkout…'}const d=await billingApi('/api/billing/checkout',{method:'POST',body:JSON.stringify({interval})});if(d.url)location.href=d.url}
    catch(err){if(typeof toast==='function')toast(err.message,'error');else alert(err.message)}
    finally{if(button){button.disabled=false;if(old)button.textContent=old}}
  }
  async function openPortal(){
    const b=q('#manageBillingBtn'),old=b?.textContent;
    try{if(b){b.disabled=true;b.textContent='Opening billing…'}const d=await billingApi('/api/billing/portal',{method:'POST',body:'{}'});if(d.url)location.href=d.url}
    catch(err){if(typeof toast==='function')toast(err.message,'error');else alert(err.message)}
    finally{if(b){b.disabled=false;if(old)b.textContent=old}}
  }

  function upgradePublicPricing(){
    const grid=q('.pricing-grid');if(!grid||grid.dataset.memberships==='1')return;grid.dataset.memberships='1';
    grid.innerHTML=`<article class="price-card"><span>Kivo Free</span><strong>A$0</strong><small>no card required</small><ul class="price-features"><li>30 smart captures each month</li><li>15 Ask Kivo messages each day</li><li>Subscriptions & recurring bills</li><li>Smart reminders</li><li>Kivo Money</li></ul><button class="soft-btn full" type="button" data-open="register">Start free</button></article><article class="price-card pro"><div class="best-value">FOR POWER USERS</div><span>Kivo Pro</span><strong>A$7.99<small>/month</small></strong><small>A$59.99/year when yearly billing is enabled</small><ul class="price-features"><li>Unlimited smart captures</li><li>Unlimited Ask Kivo</li><li>Advanced automation</li><li>Premium reminder tools</li><li>Future integrations & sharing</li></ul><button class="primary-btn full" type="button" data-open="register">Start free first</button></article>`;
    grid.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{try{openAuth(b.dataset.open)}catch{}}));
  }

  function injectAccountPlanPill(){
    const top=q('.topbar-actions');if(!top||q('#accountPlanPill'))return;
    const pill=document.createElement('button');pill.id='accountPlanPill';pill.className='account-plan-pill';pill.type='button';pill.textContent='FREE';pill.title='Membership';pill.setAttribute('aria-label','Open membership settings');pill.onclick=()=>{q('#settingsDialog')?.showModal();refreshMembership(true)};top.prepend(pill);
  }
  function syncPlanPill(){const p=q('#accountPlanPill');if(p&&billingState){p.textContent=billingState.isPro?'PRO':'FREE';p.classList.toggle('pro',!!billingState.isPro)}}

  function injectAdminRevenue(){
    const dash=q('#adminDashboard');if(!dash||q('#adminRevenuePanel'))return;
    const panel=document.createElement('section');panel.id='adminRevenuePanel';panel.className='admin-revenue-wrap';panel.innerHTML=`<div class="admin-revenue-title"><div><span>BUSINESS</span><h2>Revenue & memberships</h2></div><span id="stripeConnection" class="stripe-status">Checking payments…</span></div><div id="revenueMetrics" class="revenue-metrics"></div><div class="revenue-note" id="revenueNote"></div>`;
    const header=dash.querySelector('.admin-header');if(header)header.insertAdjacentElement('afterend',panel);else dash.prepend(panel);
  }
  async function loadAdminRevenue(){
    if(location.pathname.toLowerCase()!=='/admin'||document.hidden)return;
    injectAdminRevenue();
    try{
      const r=await fetch('/api/admin/billing-stats',{credentials:'same-origin'});if(!r.ok)return;const s=await r.json();
      const stripe=q('#stripeConnection');if(!stripe)return;stripe.textContent=s.stripeConnected?'Stripe connected':'Stripe setup required';stripe.className=`stripe-status ${s.stripeConnected?'connected':'setup'}`;
      q('#revenueMetrics').innerHTML=`<article><span>MRR</span><strong>${money(s.mrr)}</strong><small>estimated recurring monthly revenue</small></article><article><span>Total collected</span><strong>${money(s.totalRevenue)}</strong><small>successful payments recorded</small></article><article><span>Last 30 days</span><strong>${money(s.revenue30)}</strong><small>collected payment revenue</small></article><article><span>Pro members</span><strong>${s.proUsers}</strong><small>${s.conversion}% free → Pro</small></article><article><span>Free members</span><strong>${s.freeUsers}</strong><small>registered free accounts</small></article>`;
      q('#revenueNote').innerHTML=s.stripeConnected?'Revenue is based on billing events actually recorded by Kivo, not just plan labels.':'<strong>Payments are still in setup mode.</strong> Connect Stripe privately on the server before taking real customer payments.';
    }catch{}
  }

  function observeApp(){
    upgradePublicPricing();buildSettingsCard();injectAccountPlanPill();injectAdminRevenue();
    q('#settingsBtn')?.addEventListener('click',()=>setTimeout(()=>refreshMembership(true),60));q('#desktopSettings')?.addEventListener('click',()=>setTimeout(()=>refreshMembership(true),60));
    const refreshVisible=()=>{if(document.hidden)return;if(!q('#app')?.classList.contains('hidden'))refreshMembership();if(!q('#adminDashboard')?.classList.contains('hidden'))loadAdminRevenue()};
    document.addEventListener('visibilitychange',refreshVisible);window.addEventListener('focus',refreshVisible);
    setInterval(refreshVisible,60000);setTimeout(()=>{refreshMembership(true);loadAdminRevenue()},900);
    const params=new URLSearchParams(location.search);if(params.get('billing')==='success'&&typeof toast==='function')setTimeout(()=>toast('Payment completed. Kivo Pro will activate as soon as Stripe confirms it.','good'),600);if(params.get('billing')==='cancelled'&&typeof toast==='function')setTimeout(()=>toast('Checkout cancelled — nothing was charged.'),600);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeApp,{once:true});else observeApp();
})();
