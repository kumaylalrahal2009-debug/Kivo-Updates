const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=20500+Math.floor(Math.random()*1200);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-security-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const ownerPassword=`Owner-${crypto.randomBytes(20).toString('base64url')}`;
let output='';

function log(s){console.log(`✓ ${s}`)}
function fail(s,extra=''){throw new Error(`${s}${extra?`\n${extra}`:''}`)}
async function request(url,opt={}){const r=await fetch(base+url,opt);const text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function waitReady(){const start=Date.now();while(Date.now()-start<30000){try{const x=await request('/api/admin/me');if(x.r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}fail('security gateway never became ready',output.slice(-7000))}
function stopTree(child){if(!child||child.exitCode!==null)return;try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_LOCAL_DESKTOP:'false',KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_MAX_REQUEST_BYTES:String(1024*1024),KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'whsec_security_ci',STRIPE_PRICE_PRO_MONTHLY:'',STRIPE_PRICE_PRO_YEARLY:''},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

(async()=>{try{
  await waitReady();log('security gateway boots the complete Kivo stack');

  const home=await request('/');if(home.r.status!==200)fail('public app did not load through gateway');
  if(home.r.headers.get('x-frame-options')!=='DENY')fail('X-Frame-Options is not DENY');
  if(!String(home.r.headers.get('content-security-policy')||'').includes("frame-ancestors 'none'"))fail('CSP frame protection is missing');
  if(!String(home.r.headers.get('permissions-policy')||'').includes('camera=()'))fail('Permissions-Policy is missing');
  if(home.r.headers.get('x-content-type-options')!=='nosniff')fail('nosniff header is missing');
  log('public responses receive hardened browser security headers');

  const stale=Math.floor(Date.now()/1000)-3600;
  const oldWebhook=await request('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${stale},v1=deadbeef`},body:'{}'});
  if(oldWebhook.r.status!==400||!/timestamp/i.test(String(oldWebhook.body?.error||oldWebhook.body)))fail('stale Stripe webhook timestamp was not rejected',JSON.stringify(oldWebhook.body));
  log('stale Stripe webhook replay is rejected before business logic');

  const huge='x'.repeat(1024*1024+2048);
  const tooLarge=await request('/api/account/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:huge})});
  if(tooLarge.r.status!==413)fail(`oversized request expected 413, got ${tooLarge.r.status}`,JSON.stringify(tooLarge.body).slice(0,500));
  log('oversized mutating requests are rejected at the public boundary');

  let last=null;
  for(let i=0;i<9;i++){
    last=await request('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`203.0.113.${i+1}`},body:JSON.stringify({email:'owner@kivo.local',password:'definitely-wrong'})});
  }
  if(last.r.status!==429)fail(`admin brute-force burst expected 429, got ${last.r.status}`,JSON.stringify(last.body));
  if(!last.r.headers.get('retry-after'))fail('rate-limited response has no Retry-After header');
  log('owner login brute force is rate-limited and spoofed X-Forwarded-For is ignored by default');

  const register=await request('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Security Test',email:`security-${Date.now()}@example.test`,password:'Security-CI-Password-2026!'})});
  if(register.r.status!==201)fail(`normal registration failed after attack traffic (${register.r.status})`,JSON.stringify(register.body));
  const cookie=(register.r.headers.get('set-cookie')||'').split(';')[0];
  const me=await request('/api/me',{headers:{Cookie:cookie}});if(me.r.status!==200||!me.body?.loggedIn)fail('normal authenticated traffic failed after rate-limit tests',JSON.stringify(me.body));
  log('normal user traffic remains functional after security controls trigger');

  console.log('\nKivo security gateway smoke test passed.');
}catch(err){console.error(`\nKIVO SECURITY TEST FAILED: ${err.stack||err.message}`);console.error('\nLast process output:\n'+output.slice(-9000));process.exitCode=1}finally{stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}})();
