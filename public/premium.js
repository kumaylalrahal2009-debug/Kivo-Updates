/* Kivo Experience Layer: memberships, billing UX and admin revenue */
(() => {
  let billingState = null;
  let billingRefreshTimer = null;

  const q = s => document.querySelector(s);
  const money = n => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0));
  const safe = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  async function billingApi(path,opt={}){
    const headers={...(opt.headers||{})};
    if(opt.method&&opt.method!=='GET'){
      headers['Content-Type']='application/json';
      try{ if(typeof csrf!=='undefined'&&csrf) headers['X-CSRF-Token']=csrf; }catch{}
    }
    const r=await fetch(path,{credentials:'same-origin',...opt,headers});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.error||'Billing request failed.');
    return d;
  }

  function buildSettingsCard(){
    const logout=q('#logoutBtn');
    if(!logout||q('#membershipCard'))return;
    const card=document.createElement('section');
    card.id='membershipCard';card.className='membership-card';
    card.innerHTML=`
      <div class="membership-head"><div><span class="membership-eyebrow">MEMBERSHIP</span><strong id="membershipPlan">Free</strong></div><span id="membershipBadge" class="membership-badge free">FREE</span></div>
      <p id="membershipCopy">Kivo Free gives you the core life-admin experience.</p>
      <div id="usageGrid" class="usage-grid"></div>
      <div id="membershipActions" class="membership-actions"></div>`;
    logout.parentNode.insertBefore(card,logout);
  }

  function renderMembership(d){
    billingState=d;
    buildSettingsCard();
    const pro=!!d.isPro,m=d.membership||{},u=d.usage||{},limits=d.limits||{},cfg=d.billing||{};
    const plan=q('#membershipPlan'),badge=q('#membershipBadge'),copy=q('#membershipCopy'),grid=q('#usageGrid'),actions=q('#membershipActions');
    if(!plan)return;
    plan.textContent=pro?'Kivo Pro':'Kivo Free';
    badge.textContent=pro?(m.status==='past_due'?'PAST DUE':'PRO'):'FREE';badge.className=`membership-badge ${pro?'pro':'free'}`;
    copy.textContent=pro?'Unlimited capture, higher Ask limits and premium automation are active on this account.':'Use Kivo free, then upgrade only if the automation is worth it to you.';
    grid.innerHTML=pro?`<div><span>Smart captures</span><strong>Unlimited</strong></div><div><span>Ask Kivo</span><strong>Unlimited</strong></div>`:`<div><span>Captures this month</span><strong>${u.captures_month||0}/${limits.captures_month||30}</strong></div><div><span>Ask today</span><strong>${u.asks_today||0}/${limits.asks_day||15}</strong></div>`;
    if(pro){
      actions.innerHTML=`<button id="manageBillingBtn" class="billing-secondary">Manage billing</button>`;
      q('#manageBillingBtn').onclick=openPortal;
    }else if(cfg.connected){
      actions.innerHTML=`<button class="billing-primary" data-billing="month">Go Pro · ${money(cfg.monthly_price)}/mo</button>${cfg.yearly_available?`<button class="billing-secondary" data-billing="year">${money(cfg.yearly_price)}/yr · save more</button>`:''}`;
      actions.querySelectorAll('[data-billing]').forEach(b=>b.onclick=()=>startCheckout(b.dataset.billing));
    }else{
      actions.innerHTML=`<div class="billing-not-connected"><strong>Payments not connected yet</strong><span>The membership system is ready. Connect the business Stripe account to turn on checkout.</span></div>`;
    }
  }

  async function refreshMembership(showError=false){
    try{const d=await billingApi('/api/billing/status');renderMembership(d);return d;}catch(err){if(showError&&typeof toast==='function')toast(err.message,'error');return null;}
  }
  async function startCheckout(interval){
    try{
      const d=await billingApi('/api/billing/checkout',{method:'POST',body:JSON.stringify({interval})});
      if(d.url)location.href=d.url;
    }catch(err){if(typeof toast==='function')toast(err.message,'error');else alert(err.message);}
  }
  async function openPortal(){
    try{const d=await billingApi('/api/billing/portal',{method:'POST',body:'{}'});if(d.url)location.href=d.url;}catch(err){if(typeof toast==='function')toast(err.message,'error');else alert(err.message);}
  }

  function upgradePublicPricing(){
    const grid=q('.pricing-grid');if(!grid||grid.dataset.memberships==='1')return;grid.dataset.memberships='1';
    grid.innerHTML=`
      <article class="price-card"><span>Kivo Free</span><strong>A$0</strong><small>forever</small><ul class="price-features"><li>30 smart captures / month</li><li>15 Ask Kivo questions / day</li><li>Recurring subscriptions</li><li>Smart reminders</li><li>Core Kivo Money</li></ul><button class="soft-btn full" data-open="register">Start free</button></article>
      <article class="price-card pro"><div class="best-value">BEST VALUE</div><span>Kivo Pro</span><strong>A$7.99<small>/month</small></strong><small>or A$59.99/year when yearly billing is enabled</small><ul class="price-features"><li>Unlimited smart captures</li><li>Unlimited Ask Kivo</li><li>Advanced automation</li><li>Priority reminder features</li><li>Future integrations & family tools</li></ul><button class="primary-btn full" data-open="register">Try Kivo first</button></article>`;
    grid.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{try{openAuth(b.dataset.open)}catch{}}));
  }

  function injectAccountPlanPill(){
    const top=q('.topbar-actions');if(!top||q('#accountPlanPill'))return;
    const pill=document.createElement('button');pill.id='accountPlanPill';pill.className='account-plan-pill';pill.textContent='FREE';pill.title='Membership';
    pill.onclick=()=>{q('#settingsDialog')?.showModal();refreshMembership();};top.prepend(pill);
  }
  function syncPlanPill(){const p=q('#accountPlanPill');if(p&&billingState){p.textContent=billingState.isPro?'PRO':'FREE';p.classList.toggle('pro',!!billingState.isPro);}}

  function injectAdminRevenue(){
    const dash=q('#adminDashboard');if(!dash||q('#adminRevenuePanel'))return;
    const panel=document.createElement('section');panel.id='adminRevenuePanel';panel.className='admin-revenue-wrap';
    panel.innerHTML=`<div class="admin-revenue-title"><div><span>BUSINESS</span><h2>Revenue & memberships</h2></div><span id="stripeConnection" class="stripe-status">Checking payments…</span></div><div id="revenueMetrics" class="revenue-metrics"></div><div class="revenue-note" id="revenueNote"></div>`;
    const header=dash.querySelector('.admin-header');if(header)header.insertAdjacentElement('afterend',panel);else dash.prepend(panel);
  }
  async function loadAdminRevenue(){
    if(location.pathname.toLowerCase()!=='/admin')return;
    injectAdminRevenue();
    try{
      const r=await fetch('/api/admin/billing-stats',{credentials:'same-origin'});if(!r.ok)return;const s=await r.json();
      const stripe=q('#stripeConnection');stripe.textContent=s.stripeConnected?'Stripe connected':'Stripe setup required';stripe.className=`stripe-status ${s.stripeConnected?'connected':'setup'}`;
      q('#revenueMetrics').innerHTML=`
        <article><span>MRR</span><strong>${money(s.mrr)}</strong><small>estimated recurring monthly revenue</small></article>
        <article><span>Total collected</span><strong>${money(s.totalRevenue)}</strong><small>successful payments recorded</small></article>
        <article><span>Last 30 days</span><strong>${money(s.revenue30)}</strong><small>payment revenue</small></article>
        <article><span>Pro members</span><strong>${s.proUsers}</strong><small>${s.conversion}% conversion</small></article>
        <article><span>Free members</span><strong>${s.freeUsers}</strong><small>registered free accounts</small></article>`;
      q('#revenueNote').innerHTML=s.stripeConnected?'Revenue comes from successful Stripe invoice webhooks, so the dashboard reflects payments actually recorded by the billing system.':'<strong>Business payments are not connected yet.</strong> Add the Stripe environment keys on the server to activate Checkout, the billing portal and real revenue collection.';
    }catch{}
  }

  function observeApp(){
    upgradePublicPricing();buildSettingsCard();injectAccountPlanPill();injectAdminRevenue();
    const settings=q('#settingsBtn'),desktop=q('#desktopSettings');
    settings?.addEventListener('click',()=>setTimeout(()=>refreshMembership(),50));desktop?.addEventListener('click',()=>setTimeout(()=>refreshMembership(),50));
    const originalRender=window.render;
    setInterval(()=>{if(!q('#app')?.classList.contains('hidden')){refreshMembership().then(syncPlanPill);}if(!q('#adminDashboard')?.classList.contains('hidden'))loadAdminRevenue();},10000);
    setTimeout(()=>{refreshMembership().then(syncPlanPill);loadAdminRevenue();},900);
    const params=new URLSearchParams(location.search);if(params.get('billing')==='success'&&typeof toast==='function')setTimeout(()=>toast('Kivo Pro payment completed. Membership will activate as soon as Stripe confirms it.','good'),600);if(params.get('billing')==='cancelled'&&typeof toast==='function')setTimeout(()=>toast('Checkout cancelled — nothing was charged.'),600);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeApp);else observeApp();
})();
