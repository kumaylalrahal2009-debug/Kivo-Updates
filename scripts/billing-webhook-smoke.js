const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=21300+Math.floor(Math.random()*500);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-billing-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const webhookSecret=`whsec_ci_${crypto.randomBytes(18).toString('hex')}`;
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
const email=`billing-${Date.now()}@example.test`,password='Kivo-Billing-CI-2026!';
let output='';

const log=x=>console.log(`✓ ${x}`);
const fail=(x,b='')=>{throw new Error(`${x}${b?`\n${b}`:''}`)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function req(url,opt={}){const r=await fetch(base+url,opt),text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function expect(url,opt,status){const x=await req(url,opt);if(x.r.status!==status)fail(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}`,JSON.stringify(x.body));return x}
async function ready(){const start=Date.now();while(Date.now()-start<25000){try{if((await req('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}fail('Kivo did not boot',output.slice(-5000))}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}
function stripeSignature(raw){const t=Math.floor(Date.now()/1000);const v1=crypto.createHmac('sha256',webhookSecret).update(`${t}.${raw}`).digest('hex');return`t=${t},v1=${v1}`}
async function webhook(event){const raw=JSON.stringify(event);return expect('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':stripeSignature(raw)},body:raw},200)}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'smart-experience-v2.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:webhookSecret,KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

(async()=>{
  try{
    await ready();log('Kivo booted for billing lifecycle test');
    const reg=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Billing Test User',email,password})},201);
    const cookie=cookieOf(reg.r),uid=Number(reg.body.user?.id);if(!cookie||!uid)fail('test user registration missing cookie/id');
    log('billing test user registered');

    const unsigned=await req('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(unsigned.r.status!==400)fail('unsigned Stripe webhook was not rejected');
    log('unsigned webhook is rejected');

    await webhook({id:'evt_checkout_ci',type:'checkout.session.completed',data:{object:{client_reference_id:String(uid),customer:'cus_kivo_ci',subscription:'sub_kivo_ci',metadata:{user_id:String(uid),billing_interval:'month'}}}});
    let status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(!status.body.isPro||status.body.membership?.plan!=='pro'||status.body.membership?.stripe_customer_id!=='cus_kivo_ci')fail('checkout completion did not activate Pro membership',JSON.stringify(status.body));
    log('signed checkout completion activates Kivo Pro');

    await webhook({id:'evt_invoice_paid_ci',type:'invoice.paid',data:{object:{customer:'cus_kivo_ci',amount_paid:799}}});
    const admin=await expect('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@kivo.local',password:ownerPassword})},200);
    const adminCookie=cookieOf(admin.r);if(!adminCookie)fail('owner admin session missing');
    let stats=await expect('/api/admin/billing-stats',{headers:{Cookie:adminCookie}},200);
    if(Math.abs(Number(stats.body.totalRevenue)-7.99)>.001)fail('paid invoice did not record A$7.99 revenue',JSON.stringify(stats.body));
    if(Number(stats.body.proUsers)<1)fail('Pro member count did not update',JSON.stringify(stats.body));
    log('paid invoice records real billing-event revenue in admin analytics');

    // Replaying the same Stripe event must not double-count revenue.
    await webhook({id:'evt_invoice_paid_ci',type:'invoice.paid',data:{object:{customer:'cus_kivo_ci',amount_paid:799}}});
    stats=await expect('/api/admin/billing-stats',{headers:{Cookie:adminCookie}},200);
    if(Math.abs(Number(stats.body.totalRevenue)-7.99)>.001)fail('duplicate Stripe event was double-counted',JSON.stringify(stats.body));
    log('duplicate Stripe webhook is idempotent for revenue');

    await webhook({id:'evt_failed_ci',type:'invoice.payment_failed',data:{object:{customer:'cus_kivo_ci'}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(status.body.membership?.status!=='past_due')fail('failed payment did not mark membership past_due',JSON.stringify(status.body));
    log('failed invoice marks membership past due');

    await webhook({id:'evt_sub_active_ci',type:'customer.subscription.updated',data:{object:{id:'sub_kivo_ci',customer:'cus_kivo_ci',status:'active',current_period_end:Math.floor(Date.now()/1000)+2592000}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(!status.body.isPro||status.body.membership?.status!=='active')fail('subscription recovery did not restore active Pro',JSON.stringify(status.body));
    log('subscription recovery restores active Pro status');

    await webhook({id:'evt_sub_deleted_ci',type:'customer.subscription.deleted',data:{object:{id:'sub_kivo_ci',customer:'cus_kivo_ci',status:'canceled'}}});
    status=await expect('/api/billing/status',{headers:{Cookie:cookie}},200);
    if(status.body.membership?.plan!=='free'||status.body.isPro)fail('subscription deletion did not return account to Free',JSON.stringify(status.body));
    log('subscription cancellation returns account to Kivo Free');

    console.log('\nKivo billing lifecycle smoke test passed.');
  }catch(err){
    console.error(`\nKIVO BILLING TEST FAILED: ${err.stack||err.message}`);
    console.error('\nLast Kivo output:\n'+output.slice(-7000));
    process.exitCode=1;
  }finally{stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}
})();
