const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=20500+Math.floor(Math.random()*600);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-isolation-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
let output='';

const log=x=>console.log(`✓ ${x}`);
const fail=(x,b='')=>{throw new Error(`${x}${b?`\n${b}`:''}`)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function req(url,opt={}){const r=await fetch(base+url,opt),text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function expect(url,opt,status){const x=await req(url,opt);if(x.r.status!==status)fail(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}`,JSON.stringify(x.body));return x}
async function ready(){const start=Date.now();while(Date.now()-start<30000){try{if((await req('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}fail('secured Kivo did not boot',output.slice(-7000))}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}
async function register(label){const email=`${label.toLowerCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;const password=`Kivo-${label}-Password-2026!`;const x=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`${label} User`,email,password})},201);return{email,password,cookie:cookieOf(x.r),csrf:x.body.csrf,id:Number(x.body.user?.id)}}
async function capture(user,text){return expect('/api/capture',{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:JSON.stringify({text})},201)}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

(async()=>{
  try{
    await ready();log('secured Kivo gateway booted for isolation test');
    const [alice,bob]=await Promise.all([register('Alice'),register('Bob')]);
    if(!alice.cookie||!bob.cookie||alice.cookie===bob.cookie||!alice.id||!bob.id||alice.id===bob.id)fail('distinct users did not receive distinct identities/sessions');
    log('two users receive distinct authenticated identities and sessions');

    const [aItem,bItem]=await Promise.all([
      capture(alice,'Alice private gym membership A$20 every month on the 5th'),
      capture(bob,'Bob private streaming service A$17 every month on the 9th')
    ]);
    const aliceId=aItem.body.id,bobId=bItem.body.id;if(!aliceId||!bobId||aliceId===bobId)fail('test items were not created with distinct IDs',JSON.stringify({a:aItem.body,b:bItem.body}));
    if(aItem.body.item?.category!=='money'||Number(aItem.body.item?.amount)!==20)fail('Alice isolation fixture was not parsed as A$20 money',JSON.stringify(aItem.body));
    if(bItem.body.item?.category!=='money'||Number(bItem.body.item?.amount)!==17)fail('Bob isolation fixture was not parsed as A$17 money',JSON.stringify(bItem.body));
    log('users can create distinct, explicitly verified money records concurrently');

    const [aList,bList]=await Promise.all([
      expect('/api/items',{headers:{Cookie:alice.cookie}},200),
      expect('/api/items',{headers:{Cookie:bob.cookie}},200)
    ]);
    const aText=JSON.stringify(aList.body).toLowerCase(),bText=JSON.stringify(bList.body).toLowerCase();
    if(!aText.includes('alice private gym')||aText.includes('bob private streaming'))fail('Alice item response crossed user boundary',aText);
    if(!bText.includes('bob private streaming')||bText.includes('alice private gym'))fail('Bob item response crossed user boundary',bText);
    if(!aList.body.items?.some(x=>x.id===aliceId&&Number(x.amount)===20&&x.status==='open'))fail('Alice verified charge is missing from her own item store',JSON.stringify(aList.body));
    if(!bList.body.items?.some(x=>x.id===bobId&&Number(x.amount)===17&&x.status==='open'))fail('Bob verified charge is missing from his own item store',JSON.stringify(bList.body));
    log('item lists are isolated by account and preserve each user’s money data');

    const [aExport,bExport]=await Promise.all([
      expect('/api/account/export',{headers:{Cookie:alice.cookie}},200),
      expect('/api/account/export',{headers:{Cookie:bob.cookie}},200)
    ]);
    if(JSON.stringify(aExport.body).includes(bob.email)||JSON.stringify(aExport.body).toLowerCase().includes('bob private streaming'))fail('Alice export contains Bob data');
    if(JSON.stringify(bExport.body).includes(alice.email)||JSON.stringify(bExport.body).toLowerCase().includes('alice private gym'))fail('Bob export contains Alice data');
    log('full account exports remain isolated');

    const attackStatus=await req(`/api/items/${aliceId}/status`,{method:'POST',headers:{Cookie:bob.cookie,'Content-Type':'application/json','X-CSRF-Token':bob.csrf},body:JSON.stringify({status:'done'})});
    if(![404,403].includes(attackStatus.r.status))fail('Bob was able to mutate Alice item through the real status route',JSON.stringify(attackStatus.body));
    const aliceAfterAttack=await expect('/api/items',{headers:{Cookie:alice.cookie}},200);
    const untouched=aliceAfterAttack.body.items?.find(x=>x.id===aliceId);if(!untouched||untouched.status!=='open'||Number(untouched.amount)!==20)fail('Alice item changed after Bob mutation attack',JSON.stringify(aliceAfterAttack.body));

    const attackDelete=await req(`/api/items/${aliceId}`,{method:'DELETE',headers:{Cookie:bob.cookie,'Content-Type':'application/json','X-CSRF-Token':bob.csrf},body:'{}'});
    if(![404,403].includes(attackDelete.r.status))fail('Bob was able to delete Alice item by ID',JSON.stringify(attackDelete.body));
    const aliceAfterDeleteAttack=await expect('/api/items',{headers:{Cookie:alice.cookie}},200);
    if(!aliceAfterDeleteAttack.body.items?.some(x=>x.id===aliceId))fail('Alice item disappeared after Bob deletion attack');
    log('real cross-account mutation and deletion attempts are rejected');

    const asks=await Promise.all([
      expect('/api/ask',{method:'POST',headers:{Cookie:alice.cookie,'Content-Type':'application/json','X-CSRF-Token':alice.csrf},body:JSON.stringify({q:'what am i paying for?'})},200),
      expect('/api/ask',{method:'POST',headers:{Cookie:bob.cookie,'Content-Type':'application/json','X-CSRF-Token':bob.csrf},body:JSON.stringify({q:'what am i paying for?'})},200)
    ]);
    const aa=String(asks[0].body.answer||'').toLowerCase(),ba=String(asks[1].body.answer||'').toLowerCase();
    if(!aa.includes('20')||aa.includes('streaming')||aa.includes('17'))fail('Ask Kivo failed Alice isolation/consistency check',aa);
    if(!ba.includes('17')||ba.includes('gym')||ba.includes('20'))fail('Ask Kivo failed Bob isolation/consistency check',ba);
    log('Ask Kivo sees each user’s own verified charge and never the other user’s charge');

    await expect('/api/account',{method:'DELETE',headers:{Cookie:alice.cookie,'Content-Type':'application/json','X-CSRF-Token':alice.csrf},body:JSON.stringify({password:alice.password,confirm:'DELETE'})},200);
    const bobStill=await expect('/api/items',{headers:{Cookie:bob.cookie}},200);
    if(!JSON.stringify(bobStill.body).toLowerCase().includes('bob private streaming'))fail('deleting Alice affected Bob data');
    const bobExport=await expect('/api/account/export',{headers:{Cookie:bob.cookie}},200);
    if(String(bobExport.body.profile?.email||'').toLowerCase()!==bob.email.toLowerCase())fail('Bob account export broke after deleting Alice',JSON.stringify(bobExport.body));
    log('deleting one user does not affect another user or export');

    console.log('\nKivo multi-user isolation smoke test passed.');
  }catch(err){
    console.error(`\nKIVO USER ISOLATION TEST FAILED: ${err.stack||err.message}`);
    console.error('\nLast Kivo output:\n'+output.slice(-9000));
    process.exitCode=1;
  }finally{stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}
})();
