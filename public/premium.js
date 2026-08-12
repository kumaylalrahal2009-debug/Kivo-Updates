/* Kivo Experience Layer: memberships, billing UX, smart status, PWA and admin business health */
(()=>{
  let billingState=null;
  let lastMembershipFetch=0;
  let membershipBusy=false;
  let smartStatusBusy=false;
  let lastSmartStatusFetch=0;
  let deferredInstallPrompt=null;
  const q=s=>document.querySelector(s);
  const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0));

  async function jsonFetch(path,opt={}){
    const r=await fetch(path,{credentials:'same-origin',...opt});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.error||'Request failed.');
    return d;
  }

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

  function buildSmartStatusCard(){
    const logout=q('#logoutBtn');if(!logout||q('#smartStatusCard'))return;
    const card=document.createElement('section');card.id='smartStatusCard';card.className='smart-status-card';
    card.innerHTML=`<div class="smart-status-head"><div><span>INTELLIGENCE</span><strong id="smartStatusTitle">Kivo Smart</strong></div><span id="smartStatusBadge" class="smart-status-badge">CHECKING</span></div><p id="smartStatusCopy">Checking the Kivo intelligence layer…</p><div id="smartStatusMetrics" class="smart-status-metrics"></div>`;
    const membership=q('#membershipCard');if(membership)membership.insertAdjacentElement('beforebegin',card);else logout.parentNode.insertBefore(card,logout);
  }

  function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
  function buildInstallCard(){
    const logout=q('#logoutBtn');if(!logout||q('#installKivoCard'))return;
    const card=document.createElement('section');card.id='installKivoCard';card.className='install-kivo-card';
    card.innerHTML=`<div class="install-kivo-copy"><span>APP MODE</span><strong id="installKivoTitle">${isStandalone()?'Kivo is installed':'Install Kivo'}</strong><p id="installKivoCopy">${isStandalone()?'You’re running Kivo in its standalone app window.':'Install Kivo from your browser for a cleaner phone-style app window.'}</p></div><button id="installKivoBtn" type="button" class="billing-secondary">${isStandalone()?'Installed':'Install'}</button>`;
    const smart=q('#smartStatusCard');if(smart)smart.insertAdjacentElement('afterend',card);else logout.parentNode.insertBefore(card,logout);
    q('#installKivoBtn').onclick=installKivo;
    syncInstallCard();
  }
  function syncInstallCard(){
    const btn=q('#installKivoBtn'),title=q('#installKivoTitle'),copy=q('#installKivoCopy');if(!btn)return;
    if(isStandalone()){btn.textContent='Installed';btn.disabled=true;title.textContent='Kivo is installed';copy.textContent='You’re running Kivo in its standalone app window.';return}
    btn.disabled=!deferredInstallPrompt;btn.textContent=deferredInstallPrompt?'Install':'Use browser menu';
    copy.textContent=deferredInstallPrompt?'Install Kivo for a cleaner standalone app window.':'If your browser supports app installation, use its Install app option. Kivo is PWA-ready.';
  }
  async function installKivo(){
    if(isStandalone())return;
    if(!deferredInstallPrompt){if(typeof toast==='function')toast('Use your browser’s “Install app” option if it is available.');return}
    try{deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice}catch{}finally{deferredInstallPrompt=null;syncInstallCard()}
  }
  function installPwaSupport(){
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;buildInstallCard();syncInstallCard()});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;syncInstallCard();if(typeof toast==='function')toast('Kivo installed.','good')});
    window.addEventListener('load',()=>setTimeout(async()=>{if(!('serviceWorker'in navigator))return;try{await navigator.serviceWorker.register('/sw.js',{scope:'/'});console.log('Kivo PWA ready')}catch(err){console.warn('Kivo PWA registration:',err.message)}},1400),{once:true});
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

  async function refreshSmartStatus(force=false){
    buildSmartStatusCard();
    if(smartStatusBusy)return;
    if(!force&&Date.now()-lastSmartStatusFetch<45000)return;
    smartStatusBusy=true;
    try{
      const d=await jsonFetch('/api/smart/status');lastSmartStatusFetch=Date.now();
      const title=q('#smartStatusTitle'),badge=q('#smartStatusBadge'),copy=q('#smartStatusCopy'),metrics=q('#smartStatusMetrics');if(!title)return;
      const cloud=d.mode==='cloud+local';title.textContent=cloud?'Kivo Smart + Cloud AI':'Kivo Smart Local v2';badge.textContent='READY';badge.className='smart-status-badge ready';
      copy.textContent=cloud?'Cloud reasoning is connected with Smart Local v2 standing by as a fallback.':'Smart Local v2 is active. It understands context, follow-ups and common typos without needing a cloud model.';
      metrics.innerHTML=`<span><b>${d.open||0}</b><small>open</small></span><span><b>${d.overdue||0}</b><small>overdue</small></span><span><b>${d.items||0}</b><small>saved</small></span>`;
    }catch{
      const badge=q('#smartStatusBadge'),copy=q('#smartStatusCopy');if(badge){badge.textContent='STARTING';badge.className='smart-status-badge'}if(copy)copy.textContent='Kivo Smart is starting or this build predates the Smart v2 status endpoint.';
    }finally{smartStatusBusy=false}
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
    const pill=document.createElement('button');pill.id='accountPlanPill';pill.className='account-plan-pill';pill.type='button';pill.textContent='FREE';pill.title='Membership';pill.setAttribute('aria-label','Open membership settings');pill.onclick=()=>{q('#settingsDialog')?.showModal();refreshMembership(true);refreshSmartStatus(true)};top.prepend(pill);
  }
  function syncPlanPill(){const p=q('#accountPlanPill');if(p&&billingState){p.textContent=billingState.isPro?'PRO':'FREE';p.classList.toggle('pro',!!billingState.isPro)}}

  function injectAdminRevenue(){
    const dash=q('#adminDashboard');if(!dash||q('#adminRevenuePanel'))return;
    const panel=document.createElement('section');panel.id='adminRevenuePanel';panel.className='admin-revenue-wrap';panel.innerHTML=`<div class="admin-revenue-title"><div><span>BUSINESS</span><h2>Revenue & memberships</h2></div><span id="stripeConnection" class="stripe-status">Checking payments…</span></div><div id="revenueMetrics" class="revenue-metrics"></div><div class="revenue-note" id="revenueNote"></div>`;
    const header=dash.querySelector('.admin-header');if(header)header.insertAdjacentElement('afterend',panel);else dash.prepend(panel);
  }

  function injectAdminHealth(){
    const dash=q('#adminDashboard');if(!dash||q('#adminHealthPanel'))return;
    const panel=document.createElement('section');panel.id='adminHealthPanel';panel.className='admin-health-panel';
    panel.innerHTML=`<div class="admin-health-title"><div><span>PRODUCT HEALTH</span><h2>Kivo systems</h2></div><span id="adminHealthBadge" class="smart-status-badge">CHECKING</span></div><div id="adminHealthGrid" class="admin-health-grid"></div>`;
    const revenue=q('#adminRevenuePanel');if(revenue)revenue.insertAdjacentElement('afterend',panel);else dash.querySelector('.admin-header')?.insertAdjacentElement('afterend',panel);
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

  async function loadAdminHealth(){
    if(location.pathname.toLowerCase()!=='/admin'||document.hidden)return;injectAdminHealth();
    try{
      const d=await jsonFetch('/api/admin/smart-health');const badge=q('#adminHealthBadge'),grid=q('#adminHealthGrid');if(!badge||!grid)return;
      badge.textContent=d.ok?'HEALTHY':'CHECK';badge.className=`smart-status-badge ${d.ok?'ready':''}`;
      grid.innerHTML=`<article><span>Smart engine</span><strong>${d.smartLayer||'—'}</strong><small>context + follow-ups</small></article><article><span>AI mode</span><strong>${d.aiConnected?'Cloud + local':'Local'}</strong><small>${d.aiModel||'Smart Local fallback'}</small></article><article><span>Database</span><strong>${d.database?'Ready':'Check'}</strong><small>local application data</small></article><article><span>Release</span><strong>${d.version?`v${d.version}`:'—'}</strong><small>installed build</small></article><article><span>AI memory</span><strong>${d.assistantMessages||0}</strong><small>recent stored messages</small></article><article><span>Events</span><strong>${d.analyticsEvents||0}</strong><small>analytics records</small></article>`;
    }catch{
      const badge=q('#adminHealthBadge');if(badge){badge.textContent='UNAVAILABLE';badge.className='smart-status-badge'}
    }
  }

  function observeApp(){
    installPwaSupport();upgradePublicPricing();buildSettingsCard();buildSmartStatusCard();buildInstallCard();injectAccountPlanPill();injectAdminRevenue();injectAdminHealth();
    const settingsRefresh=()=>setTimeout(()=>{refreshMembership(true);refreshSmartStatus(true);syncInstallCard()},60);
    q('#settingsBtn')?.addEventListener('click',settingsRefresh);q('#desktopSettings')?.addEventListener('click',settingsRefresh);
    const refreshVisible=()=>{if(document.hidden)return;if(!q('#app')?.classList.contains('hidden')){refreshMembership();refreshSmartStatus()}if(!q('#adminDashboard')?.classList.contains('hidden')){loadAdminRevenue();loadAdminHealth()}};
    document.addEventListener('visibilitychange',refreshVisible);window.addEventListener('focus',refreshVisible);
    setInterval(refreshVisible,60000);setTimeout(()=>{refreshMembership(true);refreshSmartStatus(true);loadAdminRevenue();loadAdminHealth()},900);
    const params=new URLSearchParams(location.search);if(params.get('billing')==='success'&&typeof toast==='function')setTimeout(()=>toast('Payment completed. Kivo Pro will activate as soon as Stripe confirms it.','good'),600);if(params.get('billing')==='cancelled'&&typeof toast==='function')setTimeout(()=>toast('Checkout cancelled — nothing was charged.'),600);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeApp,{once:true});else observeApp();
})();
