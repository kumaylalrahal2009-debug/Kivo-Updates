const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const crypto=require('node:crypto');

const ROOT=path.resolve(__dirname,'..');
const PORT=18000+Math.floor(Math.random()*1200);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-ci-'));
const dataDir=path.join(temp,'data');
const uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const ownerPassword=`CI-${crypto.randomBytes(18).toString('base64url')}`;
const ownerEmail='owner@kivo.local';
const email=`ci-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const password='Kivo-CI-Test-Password-2026!';
let output='';

function log(msg){console.log(`✓ ${msg}`)}
function fail(msg,extra=''){throw new Error(`${msg}${extra?`\n${extra}`:''}`)}
function cookieFrom(response){const raw=response.headers.get('set-cookie')||'';return raw.split(';')[0]||''}
async function request(url,opt={}){
  const r=await fetch(base+url,opt);let body=null;const text=await r.text();try{body=JSON.parse(text)}catch{body=text}return{r,body,text};
}
async function expect(url,opt,status){const result=await request(url,opt);if(result.r.status!==status)fail(`${opt.method||'GET'} ${url} expected ${status}, got ${result.r.status}`,JSON.stringify(result.body));return result}
async function waitUntilReady(timeout=30000){
  const start=Date.now();let last='';
  while(Date.now()-start<timeout){
    try{const {r}=await request('/api/admin/me');if(r.status===200)return}catch(err){last=err.message}
    await new Promise(r=>setTimeout(r,350));
  }
  fail('Kivo did not become ready in time',`${last}\n${output.slice(-7000)}`);
}
function stopTree(child){
  if(!child||child.exitCode!==null)return;
  try{
    if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});
    else child.kill('SIGTERM');
  }catch{}
}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:ownerEmail,KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d.toString();process.stdout.write(d)});child.stderr.on('data',d=>{output+=d.toString();process.stderr.write(d)});

(async()=>{
  try{
    await waitUntilReady();log('full secured Smart v2 stack boots on a clean database');

    const home=await expect('/',{},200);
    if(!String(home.body).includes('Kivo'))fail('public Kivo page did not render');
    if(String(home.body).includes('KivoAdmin2026'))fail('legacy starter admin password leaked into public HTML');
    if(home.r.headers.get('x-frame-options')!=='DENY')fail('public gateway security headers are missing');
    log('public UI renders through security gateway without legacy credential leakage');

    const bundle=await expect('/app.js?e2e=1',{},200);
    if(!bundle.text.includes('MONEY INTELLIGENCE')||!bundle.text.includes('ACCOUNT & PRIVACY'))fail('live app bundle is missing Kivo extension modules');
    log('browser receives Smart UI, Money Intelligence and Account Controls in the live app bundle');

    const wrongAdmin=await request('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:ownerEmail,password:'wrong-password'})});
    if(wrongAdmin.r.status!==401)fail('wrong owner password was not rejected',JSON.stringify(wrongAdmin.body));
    log('owner admin rejects incorrect credentials');

    const register=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Kivo CI User',email,password})},201);
    const userCookie=cookieFrom(register.r),csrf=register.body.csrf;
    if(!userCookie||!csrf)fail('registration did not return session cookie and CSRF token');
    log('new user can register and receives secure session state');

    const me=await expect('/api/me',{headers:{Cookie:userCookie}},200);
    if(!me.body.loggedIn||me.body.user?.email!==email)fail('registered session is not authenticated',JSON.stringify(me.body));
    log('user session persists across authenticated requests');

    const capture=await expect('/api/capture',{method:'POST',headers:{Cookie:userCookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({text:'Netflx 9.99 every month on the 11th remind me 1 day before'})},201);
    if(capture.body.item?.category!=='money')fail('smart capture did not classify subscription as money',JSON.stringify(capture.body));
    if(Math.abs(Number(capture.body.item?.amount)-9.99)>.001)fail('smart capture amount parsing failed',JSON.stringify(capture.body));
    if(capture.body.item?.recurrence!=='monthly')fail('smart capture recurrence parsing failed',JSON.stringify(capture.body));
    log('smart capture autocorrects/parses a messy recurring subscription');

    const items=await expect('/api/items',{headers:{Cookie:userCookie}},200);
    if(!Array.isArray(items.body.items)||!items.body.items.some(x=>Number(x.amount)===9.99))fail('captured item was not saved',JSON.stringify(items.body));
    log('captured item is persisted and readable');

    const ask1=await expect('/api/ask',{method:'POST',headers:{Cookie:userCookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({q:'wat am i payng for'})},200);
    if(!/9\.99|netflix/i.test(String(ask1.body.answer||'')))fail('Ask Kivo did not ground money answer in saved subscription',JSON.stringify(ask1.body));
    log('Ask Kivo answers a sloppy natural-language money question');

    const ask2=await expect('/api/ask',{method:'POST',headers:{Cookie:userCookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({q:'when is it?'})},200);
    if(!/netflix|today|tomorrow|day|in \d|mon|tue|wed|thu|fri|sat|sun/i.test(String(ask2.body.answer||'')))fail('Ask Kivo follow-up lost conversational context',JSON.stringify(ask2.body));
    log('Ask Kivo understands a pronoun-based follow-up using conversation memory');

    const history=await expect('/api/assistant/history',{headers:{Cookie:userCookie}},200);
    if(!Array.isArray(history.body.messages)||history.body.messages.length<4)fail('assistant conversation history was not persisted',JSON.stringify(history.body));
    log('Ask Kivo conversation is stored server-side');

    const smartStatus=await expect('/api/smart/status',{headers:{Cookie:userCookie}},200);
    if(smartStatus.body.version!=='smart-v2'||smartStatus.body.mode!=='local')fail('Smart v2 status is incorrect',JSON.stringify(smartStatus.body));
    log('Smart v2 health/status endpoint is live');

    const exportData=await expect('/api/account/export',{headers:{Cookie:userCookie}},200);
    if(exportData.body.profile?.email!==email||!exportData.body.items?.length)fail('account export is not wired into the secured product',JSON.stringify(exportData.body));
    log('account privacy service is live through the public gateway');

    const adminLogin=await expect('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:ownerEmail,password:ownerPassword})},200);
    const adminCookie=cookieFrom(adminLogin.r);
    if(!adminCookie)fail('owner login did not return admin session cookie');
    log('private owner credentials authenticate successfully');

    const security=await expect('/api/admin/security-status',{headers:{Cookie:adminCookie}},200);
    if(!security.body.ownerPasswordConfigured||security.body.coreLoopback!==true)fail('admin security status does not report hardened configuration',JSON.stringify(security.body));
    log('admin security gate reports private owner password + loopback core');

    const health=await expect('/api/admin/smart-health',{headers:{Cookie:adminCookie}},200);
    if(health.body.smartLayer!=='v2'||health.body.database!==true)fail('admin Smart health endpoint failed',JSON.stringify(health.body));
    log('owner dashboard can inspect real product health');

    const sw=await expect('/sw.js',{},200);if(!String(sw.body).includes("pathname.startsWith('/api/')"))fail('service worker safety rule missing');
    const manifest=await expect('/manifest.json',{},200);if(!String(manifest.body?.start_url||'').includes('/app'))fail('PWA manifest does not open Kivo app');
    log('PWA assets are served with private-API cache protection');

    const clear=await expect('/api/assistant/history',{method:'DELETE',headers:{Cookie:userCookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'},200);
    if(!clear.body.ok)fail('conversation clear endpoint failed');
    log('user can clear Ask Kivo conversation history');

    console.log('\nKivo secured end-to-end product smoke test passed.');
  }catch(err){
    console.error(`\nKIVO INTEGRATION TEST FAILED: ${err.stack||err.message}`);
    console.error('\nLast Kivo process output:\n'+output.slice(-9000));
    process.exitCode=1;
  }finally{
    stopTree(child);
    try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
  }
})();
