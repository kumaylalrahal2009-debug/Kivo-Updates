(()=>{
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function toastSafe(msg,type=''){try{if(typeof toast==='function')return toast(msg,type)}catch{};console.log('[Kivo]',msg)}
  function injectStyles(){
    if($('#accountControlsStyles'))return;const s=document.createElement('style');s.id='accountControlsStyles';s.textContent=`
      .account-controls-card{margin:14px 0;padding:15px;border-radius:19px;border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.035)}.account-controls-head>span{display:block;font-size:9px;font-weight:900;letter-spacing:.14em;color:#8795aa}.account-controls-head strong{display:block;margin-top:4px;font-size:16px;letter-spacing:-.025em}.account-controls-head p{margin:5px 0 11px;font-size:10.5px;line-height:1.45;color:#7d8aa0}
      .account-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.account-action-grid button,.account-panel button{min-height:36px;padding:8px 10px;border-radius:11px;border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.045);color:#d2d9e8;font-size:10.5px}.account-action-grid button:hover,.account-panel button:hover{background:rgba(255,255,255,.075)}.account-action-grid button.danger-soft{color:#ffb4b9;border-color:rgba(255,91,105,.15);background:rgba(255,75,90,.05)}
      .account-panel{margin-top:8px;padding:11px;border-radius:13px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.055)}.account-panel.hidden{display:none}.account-panel label{display:block;margin:0 0 8px;font-size:9px;color:#8996aa}.account-panel input{width:100%;box-sizing:border-box;margin-top:5px;padding:10px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:rgba(4,9,18,.45);color:#eef2fb;outline:0}.account-panel input:focus{border-color:rgba(112,128,255,.45);box-shadow:0 0 0 3px rgba(112,128,255,.08)}.account-panel-actions{display:flex;gap:7px;justify-content:flex-end}.account-panel .danger-confirm{background:rgba(255,71,88,.1);border-color:rgba(255,71,88,.18);color:#ffc2c7}.account-panel p{margin:0 0 9px;color:#8491a5;font-size:9.5px;line-height:1.45}.account-panel .warning-copy{color:#e6a8ae}
      @media(max-width:420px){.account-action-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  function build(){
    const logout=$('#logoutBtn');if(!logout||$('#accountControlsCard'))return;
    injectStyles();const card=document.createElement('section');card.id='accountControlsCard';card.className='account-controls-card';
    card.innerHTML=`
      <div class="account-controls-head"><span>ACCOUNT & PRIVACY</span><strong>Your account, under your control</strong><p>Update your profile, change your password, download your Kivo data or permanently delete the account.</p></div>
      <div class="account-action-grid"><button id="accountProfileBtn" type="button">Edit name</button><button id="accountPasswordBtn" type="button">Change password</button><button id="accountExportBtn" type="button">Download my data</button><button id="accountDeleteBtn" type="button" class="danger-soft">Delete account</button></div>
      <div id="accountProfilePanel" class="account-panel hidden"><label>Display name<input id="accountNameInput" maxlength="80" autocomplete="name"></label><div class="account-panel-actions"><button id="saveAccountName" type="button">Save name</button></div></div>
      <div id="accountPasswordPanel" class="account-panel hidden"><label>Current password<input id="accountCurrentPassword" type="password" autocomplete="current-password"></label><label>New password<input id="accountNewPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password"></label><div class="account-panel-actions"><button id="saveAccountPassword" type="button">Change password</button></div></div>
      <div id="accountDeletePanel" class="account-panel hidden"><p class="warning-copy"><strong>Permanent means permanent.</strong> This removes the account and its Kivo records from this installation.</p><label>Password<input id="deleteAccountPassword" type="password" autocomplete="current-password"></label><label>Type DELETE<input id="deleteAccountConfirm" autocomplete="off" placeholder="DELETE"></label><div class="account-panel-actions"><button id="confirmDeleteAccount" type="button" class="danger-confirm">Permanently delete</button></div></div>`;
    logout.parentNode.insertBefore(card,logout);
    wire();
  }

  function showOnly(id){for(const x of ['#accountProfilePanel','#accountPasswordPanel','#accountDeletePanel'])$(x)?.classList.toggle('hidden',x!==id);}
  function wire(){
    $('#accountProfileBtn').onclick=()=>{showOnly('#accountProfilePanel');let name='';try{name=user?.name||''}catch{};$('#accountNameInput').value=name;$('#accountNameInput').focus()};
    $('#accountPasswordBtn').onclick=()=>{showOnly('#accountPasswordPanel');$('#accountCurrentPassword').focus()};
    $('#accountDeleteBtn').onclick=()=>{showOnly('#accountDeletePanel');$('#deleteAccountPassword').focus()};
    $('#accountExportBtn').onclick=exportAccount;
    $('#saveAccountName').onclick=saveName;
    $('#saveAccountPassword').onclick=changePassword;
    $('#confirmDeleteAccount').onclick=deleteAccount;
  }

  async function saveName(){
    const btn=$('#saveAccountName'),name=$('#accountNameInput').value.trim();if(!name)return toastSafe('Enter a name first.','error');
    const old=btn.textContent;btn.disabled=true;btn.textContent='Saving…';
    try{
      const d=await api('/api/account/profile',{method:'PATCH',body:JSON.stringify({name})});
      try{user={...user,...d.user}}catch{}
      $('#profileName')&&( $('#profileName').textContent=d.user.name );
      $('#profileAvatar')&&( $('#profileAvatar').textContent=(d.user.name||'K')[0].toUpperCase() );
      $('#settingsBtn')&&( $('#settingsBtn').textContent=(d.user.name||'K')[0].toUpperCase() );
      toastSafe('Name updated.','good');showOnly('');
    }catch(err){toastSafe(err.message,'error')}finally{btn.disabled=false;btn.textContent=old}
  }

  async function changePassword(){
    const btn=$('#saveAccountPassword'),current=$('#accountCurrentPassword').value,next=$('#accountNewPassword').value;
    if(next.length<8)return toastSafe('New password needs at least 8 characters.','error');
    const old=btn.textContent;btn.disabled=true;btn.textContent='Changing…';
    try{const d=await api('/api/account/password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})});$('#accountCurrentPassword').value='';$('#accountNewPassword').value='';showOnly('');toastSafe(d.message||'Password changed.','good')}
    catch(err){toastSafe(err.message,'error')}finally{btn.disabled=false;btn.textContent=old}
  }

  async function exportAccount(){
    const btn=$('#accountExportBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='Preparing…';
    try{
      const r=await fetch('/api/account/export',{credentials:'same-origin'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not export account.');
      const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kivo-account-export-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);toastSafe('Full Kivo account export created.','good');
    }catch(err){toastSafe(err.message,'error')}finally{btn.disabled=false;btn.textContent=old}
  }

  async function deleteAccount(){
    const btn=$('#confirmDeleteAccount'),password=$('#deleteAccountPassword').value,confirm=$('#deleteAccountConfirm').value;
    if(confirm.trim().toUpperCase()!=='DELETE')return toastSafe('Type DELETE to confirm.','error');
    if(!password)return toastSafe('Enter your password to confirm.','error');
    if(!window.confirm('Permanently delete this Kivo account? This cannot be undone.'))return;
    const old=btn.textContent;btn.disabled=true;btn.textContent='Deleting…';
    try{await api('/api/account',{method:'DELETE',body:JSON.stringify({password,confirm})});try{sessionStorage.clear()}catch{};location.href='/?account=deleted'}
    catch(err){toastSafe(err.message,'error');btn.disabled=false;btn.textContent=old}
  }

  function init(){build();const settings=()=>setTimeout(build,30);$('#settingsBtn')?.addEventListener('click',settings);$('#desktopSettings')?.addEventListener('click',settings)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
