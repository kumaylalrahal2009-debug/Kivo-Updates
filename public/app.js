const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let csrf = '', user = null, items = [], reminders = [], authMode = 'register', currentView = 'home';
let reminderPoll = null;
let updatePoll = null;
let latestUpdateInfo = null;
let adminCsrf = '';
globalThis.adminCsrf = adminCsrf;
const moneyFmt = n => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n || 0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const categoryMeta = {
  money:{icon:'$', cls:'money', label:'money'}, deadline:{icon:'!', cls:'deadline', label:'deadline'},
  event:{icon:'◷', cls:'event', label:'event'}, document:{icon:'▤', cls:'document', label:'document'}, task:{icon:'✓', cls:'task', label:'task'}
};

function toast(message, type=''){
  const layer = $('#toastLayer');
  layer.innerHTML = `<div class="toast ${type}">${esc(message)}</div>`;
  setTimeout(() => { layer.innerHTML=''; }, 3500);
}
async function api(path, opt={}){
  const headers={...(opt.headers||{})};
  if(!(opt.body instanceof FormData)) headers['Content-Type']='application/json';
  if(csrf && opt.method && opt.method!=='GET') headers['X-CSRF-Token']=csrf;
  const res=await fetch(path,{credentials:'same-origin',...opt,headers});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||'Something went wrong.');
  return data;
}
function show(id){$$('.screen').forEach(s=>s.classList.add('hidden'));$(id).classList.remove('hidden')}
function openAuth(mode){
  authMode=mode;show('#auth');const reg=mode==='register';
  $('#nameWrap').classList.toggle('hidden',!reg);$('#authEyebrow').textContent=reg?'START FREE':'WELCOME BACK';
  $('#authTitle').textContent=reg?'Create your Kivo.':'Log in.';$('#authSub').textContent=reg?'Start organising the things life throws at you.':'Your life admin is waiting.';
  $('#authSubmit').textContent=reg?'Create account':'Log in';$('#authSwitch').textContent=reg?'Already have Kivo? Log in':'New here? Create an account';
}
function wire(){
  $$('[data-open]').forEach(b=>b.onclick=()=>openAuth(b.dataset.open));$('#seePreviewBtn').onclick=()=>openAuth('register');$('#backLanding').onclick=()=>show('#landing');
  $('#authSwitch').onclick=()=>openAuth(authMode==='register'?'login':'register');$('#authForm').onsubmit=handleAuth;
  $$('.bottom-nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('.desktop-rail nav button[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  $('#fab').onclick=()=>$('#itemDialog').showModal();$('#manualBtn').onclick=()=>$('#itemDialog').showModal();$('#moneyAdd').onclick=()=>{$('#itemCategory').value='money';$('#itemDialog').showModal()};
  $('#closeDialog').onclick=()=>$('#itemDialog').close();$('#itemForm').onsubmit=saveManualItem;
  $('#captureFile').onchange=()=>$('#fileLabel').textContent=$('#captureFile').files[0]?.name||'';$('#captureBtn').onclick=handleCapture;
  $('#askSend').onclick=()=>ask($('#askInput').value);$('#askInput').onkeydown=e=>{if(e.key==='Enter')ask(e.target.value)};$$('.chip-row button').forEach(b=>b.onclick=()=>ask(b.textContent));
  $('#settingsBtn').onclick=()=>{$('#settingsDialog').showModal();checkForUpdates(false)};$('#desktopSettings').onclick=()=>{$('#settingsDialog').showModal();checkForUpdates(false)};$('#closeSettings').onclick=()=>$('#settingsDialog').close();$('#checkUpdateBtn').onclick=()=>checkForUpdates(true);$('#installUpdateBtn').onclick=installUpdate;$('#logoutBtn').onclick=logout;$('#notifyBtn').onclick=enableNotifications;
  $('#adminLoginForm').onsubmit=adminLogin;$('#adminLogout').onclick=adminLogout;$('#refreshAdmin').onclick=loadAdminStats;
  if('serviceWorker' in navigator){window.addEventListener('load',async()=>{try{const regs=await navigator.serviceWorker.getRegistrations();for(const r of regs)await r.unregister();if('caches' in window){for(const k of await caches.keys())await caches.delete(k)}}catch{}})}
}
async function boot(){
  wire();updateGreeting();updateTopDate();
  const path=location.pathname.toLowerCase();
  if(path==='/admin'){show('#admin');await bootAdmin();return}
  if(['/privacy','/terms','/support'].includes(path)){renderInfoPage(path);return}
  if(path==='/app'){try{const me=await api('/api/me');if(me.loggedIn){csrf=me.csrf;user=me.user;await enterApp()}else openAuth('login')}catch{openAuth('login')}return}
  try{const me=await api('/api/me');if(me.loggedIn){csrf=me.csrf;user=me.user}show('#landing')}catch{show('#landing')}
}
async function handleAuth(e){
  e.preventDefault();const payload={email:$('#email').value.trim(),password:$('#password').value};if(authMode==='register')payload.name=$('#name').value.trim();
  try{const d=await api(`/api/${authMode}`,{method:'POST',body:JSON.stringify(payload)});csrf=d.csrf;user=d.user;await enterApp()}catch(err){toast(err.message,'error')}
}
async function enterApp(){
  show('#app');$('#settingsBtn').textContent=(user?.name||'K')[0].toUpperCase();$('#profileAvatar').textContent=(user?.name||'K')[0].toUpperCase();$('#profileName').textContent=user?.name||'';$('#profileEmail').textContent=user?.email||'';
  await loadAll();startUpdateChecks();go(currentView||'home');startReminderPolling();
}
async function loadAll(){await Promise.all([loadItems(false),loadReminders(false)]);render()}
async function loadItems(doRender=true){
  try{const d=await api('/api/items');items=d.items||[];if(doRender)render()}catch(err){if(/log in/i.test(err.message)){show('#landing');return}toast(err.message,'error')}
}
async function loadReminders(doRender=true){
  try{const d=await api('/api/reminders');reminders=d.reminders||[];if(doRender)render();fireBrowserReminders()}catch(err){console.warn('Reminder check failed',err)}
}
function openItems(){return items.filter(x=>x.status==='open')}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dueWeight(x){return x.due_date?new Date(`${x.due_date}T12:00:00`).getTime():Number.MAX_SAFE_INTEGER}
function sortedOpen(){return openItems().slice().sort((a,b)=>dueWeight(a)-dueWeight(b))}
function recurrenceLabel(x){
  if(!x.recurrence)return '';
  if(x.recurrence==='monthly'&&x.recurrence_day)return `every ${ordinal(x.recurrence_day)}`;
  if(x.recurrence==='weekly'&&x.recurrence_weekday!=null)return `every ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][x.recurrence_weekday]}`;
  return x.recurrence;
}
function ordinal(n){const x=Number(n);const m=x%100;if(m>=11&&m<=13)return `${x}th`;return `${x}${x%10===1?'st':x%10===2?'nd':x%10===3?'rd':'th'}`}
function urgencyLabel(r){return r.urgency==='today'?'TODAY':r.urgency==='tomorrow'?'TOMORROW':r.urgency==='overdue'?'OVERDUE':`IN ${r.days_until} DAYS`}
function reminderTitle(r){
  if(r.category==='money'){if(r.urgency==='tomorrow')return `${r.title} renews tomorrow`;if(r.urgency==='today')return `${r.title} renews today`;return `${r.title} is coming up`}
  if(r.urgency==='tomorrow')return `${r.title} is tomorrow`;if(r.urgency==='today')return `${r.title} is due today`;if(r.urgency==='overdue')return `${r.title} is overdue`;return `${r.title} is coming up`;
}
function renderReminderPanel(){
  const panel=$('#reminderPanel');if(!reminders.length){panel.classList.add('hidden');panel.innerHTML='';return}
  const top=reminders[0];const needsPermission=('Notification'in window)&&Notification.permission!=='granted';panel.classList.remove('hidden');panel.innerHTML=`
    <div class="reminder-glow"></div>
    <div class="reminder-icon">${top.category==='money'?'$':'!'}</div>
    <div class="reminder-copy"><span class="reminder-kicker">${urgencyLabel(top)}</span><strong>${esc(reminderTitle(top))}</strong><p>${top.amount!=null?`${moneyFmt(top.amount)}${top.recurrence?' · '+esc(recurrenceLabel(top)):''}`:esc(top.notes||'Kivo reminder')}</p>${needsPermission?'<button id="reminderNotifyBtn" class="reminder-enable">Turn on alerts</button>':''}</div>
    ${reminders.length>1?`<span class="reminder-more">+${reminders.length-1}</span>`:''}`;
  $('#reminderNotifyBtn')?.addEventListener('click',enableNotifications);
}
function render(){
  const open=sortedOpen(),charges=open.filter(x=>x.amount!=null),spend=charges.reduce((a,x)=>a+Number(x.amount||0),0),dead=open.filter(x=>x.category==='deadline').length;
  const saved=items.filter(x=>x.status==='cancelled').reduce((a,x)=>a+Number(x.amount||0),0),avoidable=charges.filter(x=>x.avoidable).length;
  $('#openCount').textContent=open.length;$('#spend').textContent=moneyFmt(spend);$('#deadlineCount').textContent=dead;$('#inboxCount').textContent=`${items.length} saved`;$('#moneyTotal').textContent=moneyFmt(spend);$('#savedTotal').textContent=moneyFmt(saved);$('#avoidableCount').textContent=String(avoidable);
  renderReminderPanel();$('#briefTags').innerHTML=buildBriefTags(open,charges,dead);
  $('#taskList').innerHTML=open.length?open.slice(0,6).map(itemCard).join(''):emptyState("You're clear.",'No open items right now.');
  $('#allList').innerHTML=items.length?items.map(itemCardFull).join(''):emptyState('Nothing yet.','Your Kivo memory starts here.');
  $('#moneyList').innerHTML=charges.length?charges.map(moneyCard).join(''):emptyState('No upcoming charges.','Add one or let Kivo detect it.');
  $$('.status-btn').forEach(b=>b.onclick=()=>setStatus(b.dataset.id,b.dataset.status));
  $$('.undo-btn').forEach(b=>b.onclick=()=>undoPayment(b.dataset.id));
  $$('.delete-btn').forEach(b=>b.onclick=()=>removeItem(b.dataset.id,b.dataset.title));
}
function buildBriefTags(open,charges,dead){
  const tags=[];const tomorrow=reminders.filter(r=>r.urgency==='tomorrow').length,today=reminders.filter(r=>r.urgency==='today').length;
  if(today)tags.push(`<span>${today} due today</span>`);if(tomorrow)tags.push(`<span>${tomorrow} tomorrow</span>`);if(charges.length)tags.push(`<span>${charges.length} charge${charges.length===1?'':'s'}</span>`);if(dead)tags.push(`<span>${dead} deadline${dead===1?'':'s'}</span>`);if(!tags.length)tags.push('<span>Nothing urgent</span>');return tags.join('')
}
function cardMetaLine(x){const bits=[];if(x.due_date)bits.push(formatDate(x.due_date));if(x.due_time)bits.push(formatTime(x.due_time));if(x.recurrence)bits.push(recurrenceLabel(x));return bits.join(' · ')}
function itemCard(x){const m=categoryMeta[x.category]||categoryMeta.task;const rem=reminders.find(r=>r.id===x.id);return `<article class="item-card ${m.cls} ${rem?'is-reminder':''}"><div class="item-icon ${m.cls}">${m.icon}</div><div class="item-copy"><div class="item-topline"><span class="type-chip">${esc(m.label)}</span>${rem?`<span class="duedate-chip urgent">${urgencyLabel(rem)}</span>`:(x.due_date?`<span class="duedate-chip">${esc(formatDate(x.due_date))}</span>`:'')}${x.recurrence?`<span class="repeat-chip">↻ ${esc(recurrenceLabel(x))}</span>`:''}</div><strong>${esc(x.title)}</strong><p>${esc(cardMetaLine(x)||x.notes||defaultNote(x))}</p></div><div class="item-side">${x.amount!=null?`<div class="amount-tag">${moneyFmt(x.amount)}</div>`:''}<button class="status-btn primary-light" data-id="${x.id}" data-status="done">${x.recurrence?'Paid':'Done'}</button></div></article>`}
function moneyCard(x){
  const rem=reminders.find(r=>r.id===x.id);
  const undo=x.recurrence?`<button class="undo-btn neutral-light" data-id="${x.id}">↶ Back 1 cycle</button>`:'';
  const cancel=x.status==='cancelled'?`<button class="status-btn neutral-light" data-id="${x.id}" data-status="open">Reactivate</button>`:`<button class="status-btn warn-light" data-id="${x.id}" data-status="cancelled">Mark cancelled</button>`;
  const remove=`<button class="delete-btn danger-light" data-id="${x.id}" data-title="${esc(x.title)}">Remove</button>`;
  return `<article class="item-card money ${rem?'is-reminder':''}"><div class="item-icon money">$</div><div class="item-copy"><div class="item-topline"><span class="type-chip">money</span>${rem?`<span class="duedate-chip urgent">${urgencyLabel(rem)}</span>`:''}${x.recurrence?`<span class="repeat-chip">↻ ${esc(recurrenceLabel(x))}</span>`:''}${x.avoidable?'<span class="duedate-chip avoid">avoidable</span>':''}</div><strong>${esc(x.title)}</strong><p>${esc(cardMetaLine(x)||'Date not set')}</p></div><div class="item-side"><div class="amount-tag">${moneyFmt(x.amount)}</div><div class="item-actions"><button class="status-btn primary-light" data-id="${x.id}" data-status="done">Paid</button>${undo}${cancel}${remove}</div></div></article>`;
}
function itemCardFull(x){
  const m=categoryMeta[x.category]||categoryMeta.task;
  const undo=x.recurrence?`<button class="undo-btn neutral-light" data-id="${x.id}">↶ Back 1 cycle</button>`:'';
  const state=x.status==='cancelled'?`<button class="status-btn neutral-light" data-id="${x.id}" data-status="open">Reactivate</button>`:`<button class="status-btn warn-light" data-id="${x.id}" data-status="cancelled">Cancel</button>`;
  const remove=`<button class="delete-btn danger-light" data-id="${x.id}" data-title="${esc(x.title)}">Remove</button>`;
  return `<article class="item-card ${m.cls}"><div class="item-icon ${m.cls}">${m.icon}</div><div class="item-copy"><div class="item-topline"><span class="type-chip">${esc(m.label)}</span><span class="state-chip ${esc(x.status)}">${esc(x.status)}</span>${x.recurrence?`<span class="repeat-chip">↻ ${esc(recurrenceLabel(x))}</span>`:''}</div><strong>${esc(x.title)}</strong><p>${esc(cardMetaLine(x)||x.notes||defaultNote(x))}</p></div><div class="item-side">${x.amount!=null?`<div class="amount-tag">${moneyFmt(x.amount)}</div>`:''}<div class="item-actions">${undo}${state}${remove}</div></div></article>`;
}
function go(v){currentView=v;$$('.view').forEach(x=>x.classList.add('hidden'));$(`#${v}View`).classList.remove('hidden');$$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.desktop-rail nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$('.app-main').scrollTo({top:0,behavior:'smooth'})}
async function saveManualItem(e){
  e.preventDefault();try{await api('/api/items',{method:'POST',body:JSON.stringify({title:$('#itemTitle').value.trim(),category:$('#itemCategory').value,due_date:$('#itemDue').value||null,amount:$('#itemAmount').value||null,recurrence:$('#itemRecurrence').value||null,reminder_days:Number($('#itemReminderDays').value||0),avoidable:$('#itemAvoid').checked,notes:$('#itemNotes').value.trim()})});$('#itemForm').reset();$('#itemReminderDays').value='1';$('#itemDialog').close();await loadAll();toast('Added to Kivo.','good')}catch(err){toast(err.message,'error')}
}
async function handleCapture(){
  const text=$('#captureText').value.trim(),file=$('#captureFile').files[0];if(!text&&!file)return toast('Paste some text or choose a file.','error');
  try{let f=null;if(file){if(file.size>5*1024*1024)throw new Error('Files must be 5 MB or smaller.');const data=await readDataURL(file);let fileText='';if(file.type.startsWith('text/')||file.name.toLowerCase().endsWith('.txt'))fileText=await file.text();f={name:file.name,type:file.type,data,text:fileText}}
    const d=await api('/api/capture',{method:'POST',body:JSON.stringify({text,file:f})});$('#captureText').value='';$('#captureFile').value='';$('#fileLabel').textContent='';await loadAll();go('home');
    const extras=[];if(d.item.amount!=null)extras.push(moneyFmt(d.item.amount));if(d.item.due_date)extras.push(formatDate(d.item.due_date));if(d.item.recurrence)extras.push(recurrenceLabel(d.item));toast(`Detected ${d.item.title}${extras.length?' · '+extras.join(' · '):''}`,'good');
  }catch(err){toast(err.message,'error')}
}
function readDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
async function setStatus(id,status){
  const item=items.find(x=>String(x.id)===String(id));
  if(status==='done' && item?.recurrence){
    const current=item.due_date?formatDate(item.due_date):'the current cycle';
    if(!confirm(`Mark ${item.title} as paid for ${current}? Kivo will move it forward one ${item.recurrence} cycle.`))return;
  }
  const related=[...document.querySelectorAll(`[data-id="${id}"]`)];
  related.forEach(b=>{b.disabled=true;b.dataset.oldText=b.textContent;b.textContent='…'});
  try{
    const d=await api(`/api/items/${id}/status`,{method:'POST',body:JSON.stringify({status})});
    await loadAll();
    if(status==='done'&&d.recurring)toast(`Paid recorded — next date is ${formatDate(d.next_due_date)}.`,'good');
    else if(status==='cancelled')toast('Marked cancelled in Kivo. This stops Kivo tracking it; it does not cancel the service with the provider.','good');
    else if(status==='open')toast('Reactivated.','good');
    else toast('Updated.','good');
  }catch(err){
    related.forEach(b=>{b.disabled=false;if(b.dataset.oldText)b.textContent=b.dataset.oldText});
    toast(err.message,'error');
  }
}
async function undoPayment(id){
  try{
    const d=await api(`/api/items/${id}/undo-payment`,{method:'POST',body:JSON.stringify({})});
    await loadAll();
    toast(`Moved back one cycle — now ${formatDate(d.due_date)}.`,'good');
  }catch(err){toast(err.message,'error')}
}
async function removeItem(id,title){
  if(!confirm(`Remove ${title||'this item'} from Kivo completely? This cannot be undone.`))return;
  try{
    await api(`/api/items/${id}`,{method:'DELETE',body:JSON.stringify({})});
    await loadAll();
    toast('Removed from Kivo.','good');
  }catch(err){toast(err.message,'error')}
}
async function ask(q){if(!q.trim())return;const chat=$('#chat');chat.insertAdjacentHTML('beforeend',`<div class="bubble user">${esc(q)}</div>`);$('#askInput').value='';try{const d=await api('/api/ask',{method:'POST',body:JSON.stringify({q})});chat.insertAdjacentHTML('beforeend',`<div class="bubble kivo">${esc(d.answer)}</div>`)}catch(err){chat.insertAdjacentHTML('beforeend',`<div class="bubble kivo">${esc(err.message)}</div>`)}chat.scrollTop=chat.scrollHeight}

function startUpdateChecks(){
  if(updatePoll)clearInterval(updatePoll);
  checkForUpdates(false);
  updatePoll=setInterval(()=>checkForUpdates(false),10*60*1000);
}
async function checkForUpdates(showResult=false){
  const status=$('#updateStatus'),version=$('#updateVersion'),notes=$('#updateNotes'),install=$('#installUpdateBtn');
  if(status)status.textContent='Checking GitHub…';
  try{
    const info=await api('/api/update/check');
    latestUpdateInfo=info;
    if(version)version.textContent=`v${info.currentVersion||'1.0.0'}`;
    if(info.available){
      if(status)status.textContent=`Kivo ${info.latestVersion} is ready.`;
      if(version)version.textContent=`v${info.currentVersion} → v${info.latestVersion}`;
      if(notes){notes.textContent=info.notes||'New Kivo update available.';notes.classList.remove('hidden')}
      if(install)install.classList.remove('hidden');
      if(showResult)toast(`Update ${info.latestVersion} is available.`,'good');
    }else{
      if(status)status.textContent=info.reason==='no_release'?'No GitHub release has been published yet.':'You’re up to date.';
      if(notes)notes.classList.add('hidden');
      if(install)install.classList.add('hidden');
      if(showResult)toast('Kivo is up to date.','good');
    }
  }catch(err){
    if(status)status.textContent='Could not check GitHub right now.';
    if(showResult)toast(err.message,'error');
  }
}
async function installUpdate(){
  if(!latestUpdateInfo?.available)return checkForUpdates(true);
  if(!confirm(`Install Kivo ${latestUpdateInfo.latestVersion} now? Kivo will restart automatically.`))return;
  const btn=$('#installUpdateBtn');
  btn.disabled=true;btn.textContent='Installing…';
  try{
    const result=await api('/api/update/install',{method:'POST',body:JSON.stringify({})});
    toast(result.message||'Installing update…','good');
  }catch(err){
    btn.disabled=false;btn.textContent='Update now';
    toast(err.message,'error');
  }
}

async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'});csrf='';user=null;items=[];reminders=[];if(reminderPoll)clearInterval(reminderPoll);if(updatePoll)clearInterval(updatePoll);$('#settingsDialog').close();show('#landing')}catch(err){toast(err.message,'error')}}
async function enableNotifications(){if(!('Notification'in window))return toast('Notifications are not supported here.','error');const p=await Notification.requestPermission();if(p==='granted'){toast('Notifications enabled. Kivo will alert you while the app is running.','good');fireBrowserReminders(true)}}
function startReminderPolling(){if(reminderPoll)clearInterval(reminderPoll);if(updatePoll)clearInterval(updatePoll);reminderPoll=setInterval(()=>loadReminders(true),60000);loadReminders(true)}
function fireBrowserReminders(force=false){
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  for(const r of reminders){const key=`kivo-reminded:${r.id}:${r.due_date}:${r.urgency}`;if(!force&&localStorage.getItem(key))continue;const body=`${r.amount!=null?moneyFmt(r.amount)+' · ':''}${r.urgency==='tomorrow'?'Due tomorrow':r.urgency==='today'?'Due today':r.urgency==='overdue'?'Overdue':'Coming up'}${r.recurrence?' · '+recurrenceLabel(r):''}`;try{new Notification(reminderTitle(r),{body,icon:'/icon.svg'});localStorage.setItem(key,new Date().toISOString())}catch{}}
}
function updateGreeting(){const h=new Date().getHours();$('#greeting').textContent=h<12?'GOOD MORNING':h<18?'GOOD AFTERNOON':'GOOD EVENING'}
function updateTopDate(){const fmt=new Intl.DateTimeFormat('en-AU',{weekday:'long',month:'short',day:'numeric'});$('#topDate').textContent=fmt.format(new Date())}
function formatDate(iso){try{return new Intl.DateTimeFormat('en-AU',{weekday:'short',month:'short',day:'numeric'}).format(new Date(`${iso}T12:00:00`))}catch{return iso}}
function formatTime(t){if(!t)return'';const [h,m]=t.split(':').map(Number);const d=new Date();d.setHours(h,m,0,0);return new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit'}).format(d)}

function renderInfoPage(path){
  const pages={
    '/privacy':{k:'PRIVACY',t:'Privacy at Kivo',b:`<p>Kivo stores account information and the life-admin items you choose to save so the product can work. Passwords are stored as one-way hashes rather than plain text. Account data is separated by user.</p><h2>Uploads</h2><p>Files uploaded to this local/server build are stored privately on the Kivo server and are not exposed as public static files.</p><h2>Analytics</h2><p>Kivo's owner dashboard uses aggregate product data such as account counts, active-user timestamps and item totals. It is not a public page.</p><p>This beta privacy summary should be replaced with a jurisdiction-appropriate privacy policy before a public commercial launch.</p>`},
    '/terms':{k:'TERMS',t:'Kivo Beta Terms',b:`<p>Kivo is beta software provided for testing and product validation. You remain responsible for checking important financial, appointment and deadline information.</p><h2>No guarantee</h2><p>Automatic parsing and reminders can make mistakes. Kivo should not be the only place you rely on for critical obligations.</p><h2>Acceptable use</h2><p>Do not upload unlawful content or attempt to access another user's account or Kivo's private administration systems.</p><p>Replace these beta terms with reviewed commercial terms before accepting paid customers.</p>`},
    '/support':{k:'SUPPORT',t:'Need help with Kivo?',b:`<p>For this local beta build, support is handled by the owner running the Kivo server.</p><h2>Quick fixes</h2><p>Keep the Kivo server window open, use the current site URL shown by the launcher, and enable browser notifications if you want desktop alerts while Kivo is running.</p><h2>Before public launch</h2><p>Add a real support email, password-reset email flow, status page and customer-support process.</p>`}
  };
  const x=pages[path]||pages['/support'];$('#infoKicker').textContent=x.k;$('#infoTitle').textContent=x.t;$('#infoBody').innerHTML=x.b;show('#infoPage');
}
async function adminApi(path,opt={}){
  const headers={...(opt.headers||{})};if(opt.method&&opt.method!=='GET'){headers['Content-Type']='application/json';if(adminCsrf)headers['X-Admin-CSRF']=adminCsrf}
  const r=await fetch(path,{credentials:'same-origin',...opt,headers});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Admin request failed.');return d;
}
async function bootAdmin(){
  try{const me=await adminApi('/api/admin/me');if(me.loggedIn){adminCsrf=me.csrf;globalThis.adminCsrf=adminCsrf;showAdminDashboard();await loadAdminStats()}else showAdminLogin()}catch{showAdminLogin()}
}
function showAdminLogin(){$('#adminLogin').classList.remove('hidden');$('#adminDashboard').classList.add('hidden');$('#adminLogout').classList.add('hidden')}
function showAdminDashboard(){$('#adminLogin').classList.add('hidden');$('#adminDashboard').classList.remove('hidden');$('#adminLogout').classList.remove('hidden')}
async function adminLogin(e){e.preventDefault();try{const d=await adminApi('/api/admin/login',{method:'POST',body:JSON.stringify({email:$('#adminEmail').value.trim(),password:$('#adminPassword').value})});adminCsrf=d.csrf;globalThis.adminCsrf=adminCsrf;showAdminDashboard();await loadAdminStats()}catch(err){toast(err.message,'error')}}
async function adminLogout(){try{await adminApi('/api/admin/logout',{method:'POST',body:'{}'});adminCsrf='';globalThis.adminCsrf=adminCsrf;showAdminLogin()}catch(err){toast(err.message,'error')}}
async function loadAdminStats(){
  try{const s=await adminApi('/api/admin/stats');renderAdminStats(s);$('#adminUpdated').textContent=`Updated ${new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit'}).format(new Date())}`}catch(err){if(/login/i.test(err.message))showAdminLogin();toast(err.message,'error')}
}
function renderAdminStats(s){
  const metrics=[['Total users',s.totalUsers,'All registered accounts'],['New today',s.todayUsers,'Sign-ups since midnight'],['Active today',s.activeToday,'Seen in the last 24h'],['Active 7 days',s.active7,'Weekly active users'],['Items created',s.totalItems,'Across all users'],['Completion rate',`${s.completionRate}%`,'Done or cancelled']];
  $('#adminMetrics').innerHTML=metrics.map(([a,b,c])=>`<article><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></article>`).join('');
  $('#signupTotal30').textContent=`${s.monthUsers} new users`;
  renderSignupChart(s.signups||[]);
  $('#activityStats').innerHTML=`<div><span>Money items</span><b>${s.moneyItems}</b></div><div><span>Recurring items</span><b>${s.recurring}</b></div><div><span>Reminder-enabled</span><b>${s.reminderConfigured}</b></div><div><span>Captures</span><b>${s.captures}</b></div><div><span>Ask Kivo queries</span><b>${s.asks}</b></div><div><span>Open items</span><b>${s.openItems}</b></div>`;
  $('#recentUsers').innerHTML=(s.recentUsers||[]).map(u=>`<tr><td><b>${esc(u.name)}</b><small>${esc(u.email)}</small></td><td>${adminDate(u.created_at)}</td><td>${u.last_seen_at?adminDate(u.last_seen_at):'—'}</td><td>${u.item_count}</td></tr>`).join('')||'<tr><td colspan="4">No users yet.</td></tr>';
}
function renderSignupChart(rows){
  const map=new Map(rows.map(x=>[x.day,Number(x.count)])), days=[];for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;days.push({key,count:map.get(key)||0,label:d.getDate()})}const max=Math.max(1,...days.map(x=>x.count));
  $('#signupChart').innerHTML=days.map((x,i)=>`<div class="chart-col" title="${x.key}: ${x.count}"><span style="height:${Math.max(x.count?8:2,(x.count/max)*100)}%"></span>${i%5===0?`<small>${x.label}</small>`:'<small></small>'}</div>`).join('');
}
function adminDate(x){try{return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(x))}catch{return x}}

boot();

if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}
