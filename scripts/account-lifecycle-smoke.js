const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=19600+Math.floor(Math.random()*700);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-account-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const email=`privacy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@example.test`;
const oldPassword='Kivo-Privacy-Test-2026!';
const newPassword='Kivo-New-Privacy-Test-2026!';
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
let output='';

const ok=x=>console.log(`✓ ${x}`);
const fail=(x,body='')=>{throw new Error(`${x}${body?`\n${body}`:''}`)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function req(url,opt={}){const r=await fetch(base+url,opt),text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function expect(url,opt,status){const x=await req(url,opt);if(x.r.status!==status)fail(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}`,JSON.stringify(x.body));return x}
async function ready(){const start=Date.now();while(Date.now()-start<25000){try{if((await req('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}fail('Kivo did not boot',output.slice(-5000))}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'smart-experience-v2.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

(async()=>{
  try{
    await ready();ok('Smart v2 booted for account lifecycle test');

    const reg=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Privacy Test User',email,password:oldPassword})},201);
    let cookie=cookieOf(reg.r),csrf=reg.body.csrf;if(!cookie||!csrf)fail('registration did not return cookie/csrf');
    ok('throwaway privacy-test account registered');

    await expect('/api/capture',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({text:'Example subscription 12.50 every month on the 20th'})},201);
    await expect('/api/ask',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({q:'what am i paying for?'})},200);
    ok('account has representative item + assistant history');

    const exported=await expect('/api/account/export',{headers:{Cookie:cookie}},200);
    if(exported.body.profile?.email!==email)fail('export profile missing correct email',JSON.stringify(exported.body));
    if(!Array.isArray(exported.body.items)||!exported.body.items.length)fail('export did not include items');
    if(!Array.isArray(exported.body.assistant_history)||exported.body.assistant_history.length<2)fail('export did not include assistant history');
    const serialized=JSON.stringify(exported.body);
    if(/password_hash|password_salt/i.test(serialized))fail('export leaked password material');
    ok('full account export includes user data without password material');

    const profile=await expect('/api/account/profile',{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({name:'Updated Privacy User'})},200);
    if(profile.body.user?.name!=='Updated Privacy User')fail('profile rename failed',JSON.stringify(profile.body));
    const me=await expect('/api/me',{headers:{Cookie:cookie}},200);if(me.body.user?.name!=='Updated Privacy User')fail('renamed profile did not persist');
    ok('profile name update persists');

    const changed=await expect('/api/account/password',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({current_password:oldPassword,new_password:newPassword})},200);
    if(!changed.body.ok)fail('password-change endpoint did not confirm success');
    ok('password changed through authenticated account controls');

    await expect('/api/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'},200);
    const oldLogin=await req('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:oldPassword})});
    if(oldLogin.r.status!==401)fail('old password still authenticates after password change',JSON.stringify(oldLogin.body));
    ok('old password is rejected after password change');

    const newLogin=await expect('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:newPassword})},200);
    cookie=cookieOf(newLogin.r);csrf=newLogin.body.csrf;if(!cookie||!csrf)fail('new password login did not establish session');
    ok('new password authenticates successfully');

    const badDelete=await req('/api/account',{method:'DELETE',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password:newPassword,confirm:'not delete'})});
    if(badDelete.r.status!==400)fail('account deletion did not require explicit DELETE confirmation');
    ok('destructive deletion requires explicit confirmation');

    const deleted=await expect('/api/account',{method:'DELETE',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({password:newPassword,confirm:'DELETE'})},200);
    if(!deleted.body.ok)fail('account deletion did not confirm success');
    ok('account permanently deleted');

    const deadSession=await expect('/api/me',{headers:{Cookie:cookie}},200);
    if(deadSession.body.loggedIn!==false)fail('deleted account session is still authenticated',JSON.stringify(deadSession.body));
    const deletedLogin=await req('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:newPassword})});
    if(deletedLogin.r.status!==401)fail('deleted account can still log in',JSON.stringify(deletedLogin.body));
    ok('deleted account and old session are no longer usable');

    console.log('\nKivo account lifecycle smoke test passed.');
  }catch(err){
    console.error(`\nKIVO ACCOUNT LIFECYCLE TEST FAILED: ${err.stack||err.message}`);
    console.error('\nLast Kivo output:\n'+output.slice(-7000));
    process.exitCode=1;
  }finally{
    stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
  }
})();
