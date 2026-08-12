const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=22900+Math.floor(Math.random()*500);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-concurrency-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
const webhookSecret=`whsec_concurrency_${crypto.randomBytes(12).toString('hex')}`;
let output='';

const log=s=>console.log(`✓ ${s}`);
const fail=(s,b='')=>{throw new Error(`${s}${b?`\n${b}`:''}`)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function request(url,opt={}){const r=await fetch(base+url,opt);const text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body,text}}
async function expect(url,opt,status){const x=await request(url,opt);if(x.r.status!==status)fail(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}`,JSON.stringify(x.body));return x}
async function ready(){const start=Date.now();while(Date.now()-start<30000){try{if((await request('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,250))}fail('secured Kivo did not boot',output.slice(-8000))}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}
function stripeSig(raw){const t=Math.floor(Date.now()/1000);const v1=crypto.createHmac('sha256',webhookSecret).update(`${t}.${raw}`).digest('hex');return`t=${t},v1=${v1}`}
async function webhook(event){const raw=JSON.stringify(event);return expect('/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':stripeSig(raw)},body:raw},200)}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:webhookSecret,KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d.toString();process.stdout.write(d)});child.stderr.on('data',d=>{output+=d.toString();process.stderr.write(d)});

(async()=>{try{
  await ready();log('secured Kivo booted for concurrency pressure test');

  const users=[];
  for(let i=0;i<4;i++){
    const email=`load-${i}-${Date.now()}@example.test`,password=`Kivo-Load-${i}-Password-2026!`;
    const reg=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Load User ${i}`,email,password})},201);
    users.push({id:Number(reg.body.user?.id),email,password,cookie:cookieOf(reg.r),csrf:reg.body.csrf,index:i});
  }
  if(users.some(u=>!u.id||!u.cookie||!u.csrf))fail('one or more load users did not receive complete session state');
  log('four independent users registered');

  const operations=[];
  for(const u of users){
    for(let j=0;j<6;j++){
      operations.push(expect('/api/capture',{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json','X-CSRF-Token':u.csrf},body:JSON.stringify({text:`User ${u.index} subscription ${10+u.index+j}.99 every month on the ${10+j}th`})},201));
    }
    for(let j=0;j<3;j++){
      operations.push(expect('/api/account/profile',{method:'PATCH',headers:{Cookie:u.cookie,'Content-Type':'application/json','X-CSRF-Token':u.csrf},body:JSON.stringify({name:`Load User ${u.index} revision ${j}`})},200));
    }
    for(let j=0;j<2;j++){
      operations.push(expect('/api/ask',{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json','X-CSRF-Token':u.csrf},body:JSON.stringify({q:j?'anything urgent?':'what am i paying for?'})},200));
    }
    operations.push(webhook({id:`evt_load_${u.id}`,type:'checkout.session.completed',data:{object:{client_reference_id:String(u.id),customer:`cus_load_${u.id}`,subscription:`sub_load_${u.id}`,metadata:{user_id:String(u.id),billing_interval:'month'}}}}));
  }
  const settled=await Promise.allSettled(operations);
  const rejected=settled.filter(x=>x.status==='rejected');
  if(rejected.length)fail(`${rejected.length} concurrent operations failed`,rejected.map(x=>x.reason?.stack||x.reason?.message||String(x.reason)).join('\n---\n'));
  log(`${operations.length} cross-service writes/reads completed concurrently without HTTP failure`);

  const allItemIds=[];
  for(const u of users){
    const list=await expect('/api/items',{headers:{Cookie:u.cookie}},200);
    if(list.body.items?.length!==6)fail(`user ${u.index} expected 6 items after concurrent writes`,JSON.stringify(list.body));
    if(list.body.items.some(x=>!String(x.notes||'').includes(`User ${u.index}`)))fail(`user ${u.index} received another user's item`,JSON.stringify(list.body));
    allItemIds.push(...list.body.items.slice(0,2).map(x=>({id:x.id,u})));
    const billing=await expect('/api/billing/status',{headers:{Cookie:u.cookie}},200);
    if(!billing.body.isPro)fail(`user ${u.index} lost concurrent billing activation`,JSON.stringify(billing.body));
    const ask=await expect('/api/ask',{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json','X-CSRF-Token':u.csrf},body:JSON.stringify({q:'what am i paying for?'})},200);
    if(!/6 upcoming charges/i.test(String(ask.body.answer||'')))fail(`Ask Kivo saw inconsistent item count for user ${u.index}`,JSON.stringify(ask.body));
  }
  log('all users retain exactly six isolated charges, Pro state and consistent Ask Kivo snapshots');

  const statusOps=allItemIds.map(({id,u})=>expect(`/api/items/${id}/status`,{method:'POST',headers:{Cookie:u.cookie,'Content-Type':'application/json','X-CSRF-Token':u.csrf},body:JSON.stringify({status:'cancelled'})},200));
  const statusSettled=await Promise.allSettled(statusOps);const statusRejected=statusSettled.filter(x=>x.status==='rejected');
  if(statusRejected.length)fail(`${statusRejected.length} concurrent status writes failed`,statusRejected.map(x=>x.reason?.message||String(x.reason)).join('\n'));
  log('concurrent item status mutations completed without lock failures');

  for(const u of users){
    const list=await expect('/api/items',{headers:{Cookie:u.cookie}},200);
    const cancelled=list.body.items.filter(x=>x.status==='cancelled').length;
    if(cancelled!==2)fail(`user ${u.index} expected exactly two cancelled records`,JSON.stringify(list.body));
  }
  log('post-write database state is complete and internally consistent');

  if(/SQLITE_BUSY|database is locked/i.test(output))fail('SQLite lock warning appeared in service output',output.slice(-9000));
  console.log('\nKivo multi-service concurrency smoke test passed.');
}catch(err){
  console.error(`\nKIVO CONCURRENCY TEST FAILED: ${err.stack||err.message}`);
  console.error('\nLast Kivo output:\n'+output.slice(-10000));process.exitCode=1;
}finally{stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}})();
