const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=21300+Math.floor(Math.random()*500);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-billing-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const webhookSecret=`whsec_ci_${crypto.randomBytes(18).toString('hex')}`;
const stripeSecret='sk_test_kivo_local_ci';
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
const email=`billing-${Date.now()}@example.test`,password='Kivo-Billing-CI-2026!';
let output='';

const log=x=>console.log(`✓ ${x}`);
const fail=(x,b='')=>{throw new Error(`${x}${b?`\n${b}`:''}`)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function req(url,opt={}){const r=await fetch(base+url,opt),text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function expect(url,opt,status){const x=await req(url,opt);if(x.r.status!==status)fail(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}`,JSON.stringify(x.body));return x}
async function ready(){const start=Date.now();while(Date.now()-start<30000){try{if((await req('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}fail('secured Kivo did not boot',output.slice(-7000))}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}
function stripeSignature(raw,t=Math.floor(Date.now()/1000)){const v1=crypto.createHmac('sha256',webhookSecret).update(`${t}.${raw}`).digest('hex');return`t=${t},v1=${v1}`}
async function webhook(event){const raw=JSON.stringify(event);return expect('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':stripeSignature(raw)},body:raw},200)}
async function register(name,email,password){const x=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})},201);return{id:Number(x.body.user?.id),cookie:cookieOf(x.r),csrf:x.body.csrf,email,password}}

(async()=>{
  const stripeDeletes=[];
  const stripeServer=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    if(request.method==='DELETE'&&url.pathname.startsWith('/v1/subscriptions/')){
      const id=decodeURIComponent(url.pathname.split('/').pop());
      stripeDeletes.push({id,authorization:String(request.headers.authorization||'')});
      if(id==='sub_fail_delete_ci'){
        response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'simulated Stripe failure'}}));return;
      }
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({id,status:'canceled'}));return;
    }
    response.writeHead(404,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'not found'}}));
  });
  await new Promise(resolve=>stripeServer.listen(0,'127.0.0.1',resolve));
  const stripePort=stripeServer.address().port;

  const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
    cwd:ROOT,
    env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:stripeSecret,STRIPE_WEBHOOK_SECRET:webhookSecret,KIVO_STRIPE_API_BASE:`http://127.0.0.1:${stripePort}/v1`,STRIPE_PRICE_PRO_MONTHLY:'',STRIPE_PRICE_PRO_YEARLY:'',KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
    stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

  try{
    await ready();log('secured Kivo gateway booted for billing lifecycle test');
    const main=await register('Billing Test User',email,password);if(!main.cookie||!main.id||!main.csrf)fail('test user registration missing session state');
    const {cookie,csrf, id:uid}=main;log('billing test user registered');

    const unsigned=await req('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(unsigned.r.status!==400)fail('unsigned Stripe webhook was not rejected',JSON.stringify(unsigned.body));
    log('unsigned webhook is rejected by Stripe signature validation');

    const staleEvent={id:'evt_stale_ci',type:'checkout.session.completed',data:{object:{client_reference_id:String(uid),customer:'cus_stale',subscription:'sub_stale',metadata:{user_id:String(uid),billing_interval:'month'}}}};
    const staleRaw=JSON.stringify(staleEvent),staleTs=Math.floor(Date.now()/1000)-3600;
    const stale=await req('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':stripeSignature(staleRaw,staleTs)},body:staleRaw});
    if(stale.r.status!==400||!/timestamp/i.test(String(stale.body?.error||stale.body)))fail('correctly signed stale webhook was not rejected at gateway',JSON.stringify(stale.body));
    let initial=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);if(initial.body.isPro)fail('stale checkout event changed membership state');
    log('correctly signed stale webhook replay is rejected without changing membership');

    await webhook({id:'evt_checkout_ci',type:'checkout.session.completed',data:{object:{client_reference_id:String(uid),customer:'cus_kivo_ci',subscription:'sub_kivo_ci',metadata:{user_id:String(uid),billing_interval:'month'}}}});
    let status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(!status.body.isPro||status.body.membership?.plan!=='pro'||status.body.membership?.stripe_customer_id!=='cus_kivo_ci')fail('checkout completion did not activate Pro membership',JSON.stringify(status.body));
    log('fresh signed checkout completion activates Kivo Pro');

    await webhook({id:'evt_invoice_paid_ci',type:'invoice.paid',data:{object:{customer:'cus_kivo_ci',amount_paid:799}}});
    const admin=await expect('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@kivo.local',password:ownerPassword})},200);
    const adminCookie=cookieOf(admin.r);if(!adminCookie)fail('owner admin session missing');
    let stats=await expect('/api/admin/billing-stats',{headers:{Cookie:adminCookie}},200);
    if(Math.abs(Number(stats.body.totalRevenue)-7.99)>.001)fail('paid invoice did not record A$7.99 revenue',JSON.stringify(stats.body));
    if(Number(stats.body.proUsers)<1)fail('Pro member count did not update',JSON.stringify(stats.body));
    log('paid invoice records billing-event revenue in admin analytics');

    await webhook({id:'evt_invoice_paid_ci',type:'invoice.paid',data:{object:{customer:'cus_kivo_ci',amount_paid:799}}});
    stats=await expect('/api/admin/billing-stats',{headers:{Cookie:adminCookie}},200);
    if(Math.abs(Number(stats.body.totalRevenue)-7.99)>.001)fail('duplicate Stripe event was double-counted',JSON.stringify(stats.body));
    log('duplicate Stripe webhook event ID is idempotent for revenue');

    await webhook({id:'evt_failed_ci',type:'invoice.payment_failed',data:{object:{customer:'cus_kivo_ci'}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(status.body.membership?.status!=='past_due'||status.body.isPro)fail('failed payment did not mark membership past_due/non-Pro',JSON.stringify(status.body));
    log('failed invoice marks membership past due');

    await webhook({id:'evt_sub_active_ci',type:'customer.subscription.updated',data:{object:{id:'sub_kivo_ci',customer:'cus_kivo_ci',status:'active',current_period_end:Math.floor(Date.now()/1000)+2592000}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(!status.body.isPro||status.body.membership?.status!=='active')fail('subscription recovery did not restore active Pro',JSON.stringify(status.body));
    log('subscription recovery restores active Pro status');

    await webhook({id:'evt_sub_deleted_ci',type:'customer.subscription.deleted',data:{object:{id:'sub_kivo_ci',customer:'cus_kivo_ci',status:'canceled'}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(status.body.membership?.plan!=='free'||status.body.isPro)fail('subscription deletion did not return account to Free',JSON.stringify(status.body));
    log('subscription cancellation returns account to Kivo Free');

    const deletePassword='Kivo-Delete-Billing-CI-2026!';
    const deleting=await register('Paid Delete User',`paid-delete-${Date.now()}@example.test`,deletePassword);
    await webhook({id:'evt_delete_checkout_ci',type:'checkout.session.completed',data:{object:{client_reference_id:String(deleting.id),customer:'cus_delete_ci',subscription:'sub_delete_ci',metadata:{user_id:String(deleting.id),billing_interval:'month'}}}});
    const deleteStatus=await expect('/api/billing/status',{headers:{Cookie:deleting.cookie}},200);if(!deleteStatus.body.isPro)fail('paid deletion fixture did not become Pro',JSON.stringify(deleteStatus.body));
    const deleted=await expect('/api/account',{method:'DELETE',headers:{Cookie:deleting.cookie,'Content-Type':'application/json','X-CSRF-Token':deleting.csrf},body:JSON.stringify({password:deletePassword,confirm:'DELETE'})},200);
    if(!deleted.body.ok)fail('paid account deletion did not complete after Stripe cancellation',JSON.stringify(deleted.body));
    const stripeDelete=stripeDeletes.find(x=>x.id==='sub_delete_ci');if(!stripeDelete)fail('Kivo never called Stripe to cancel the active subscription before deletion');
    if(stripeDelete.authorization!==`Bearer ${stripeSecret}`)fail('Stripe cancellation did not use the configured private API credential');
    const deletedLogin=await req('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:deleting.email,password:deletePassword})});if(deletedLogin.r.status!==401)fail('paid deleted account can still log in');
    log('paid account deletion cancels Stripe first, then permanently deletes local account');

    const failPassword='Kivo-Failed-Delete-CI-2026!';
    const failing=await register('Failed Delete User',`failed-delete-${Date.now()}@example.test`,failPassword);
    await webhook({id:'evt_fail_delete_checkout_ci',type:'checkout.session.completed',data:{object:{client_reference_id:String(failing.id),customer:'cus_fail_delete_ci',subscription:'sub_fail_delete_ci',metadata:{user_id:String(failing.id),billing_interval:'month'}}}});
    const failedDelete=await req('/api/account',{method:'DELETE',headers:{Cookie:failing.cookie,'Content-Type':'application/json','X-CSRF-Token':failing.csrf},body:JSON.stringify({password:failPassword,confirm:'DELETE'})});
    if(failedDelete.r.status!==502)fail(`Stripe cancellation failure should block deletion with 502, got ${failedDelete.r.status}`,JSON.stringify(failedDelete.body));
    const stillThere=await expect('/api/me',{headers:{Cookie:failing.cookie}},200);if(!stillThere.body.loggedIn)fail('account was deleted even though Stripe cancellation failed',JSON.stringify(stillThere.body));
    const stillPro=await expect('/api/billing/status',{headers:{Cookie:failing.cookie}},200);if(!stillPro.body.isPro)fail('billing state was altered despite failed cancellation',JSON.stringify(stillPro.body));
    log('Stripe cancellation failure preserves the account and billing state');

    await webhook({id:'evt_fail_delete_cancelled_ci',type:'customer.subscription.deleted',data:{object:{id:'sub_fail_delete_ci',customer:'cus_fail_delete_ci',status:'canceled'}}});
    await expect('/api/account',{method:'DELETE',headers:{Cookie:failing.cookie,'Content-Type':'application/json','X-CSRF-Token':failing.csrf},body:JSON.stringify({password:failPassword,confirm:'DELETE'})},200);
    log('once billing is confirmed cancelled, account deletion succeeds normally');

    console.log('\nKivo billing lifecycle + paid-account deletion smoke test passed.');
  }catch(err){
    console.error(`\nKIVO BILLING TEST FAILED: ${err.stack||err.message}`);
    console.error('\nLast Kivo output:\n'+output.slice(-10000));process.exitCode=1;
  }finally{
    stopTree(child);
    await new Promise(resolve=>stripeServer.close(resolve));
    try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
  }
})().catch(err=>{console.error(`KIVO BILLING TEST SETUP FAILED: ${err.stack||err.message}`);process.exit(1)});
