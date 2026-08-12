const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=22100+Math.floor(Math.random()*600);
const base=`http://127.0.0.1:${PORT}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-parser-ci-'));
const dataDir=path.join(temp,'data'),uploadsDir=path.join(temp,'uploads');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(uploadsDir,{recursive:true});
const ownerPassword=`Owner-${crypto.randomBytes(18).toString('base64url')}`;
const email=`parser-${Date.now()}@example.test`,password='Kivo-Parser-CI-2026!';
let output='';

const pass=x=>console.log(`✓ ${x}`);
const fail=(name,got,want)=>{throw new Error(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)};
const eq=(name,got,want)=>{if(got!==want)fail(name,got,want);pass(name)};
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
async function request(url,opt={}){const r=await fetch(base+url,opt),text=await r.text();let body=text;try{body=JSON.parse(text)}catch{}return{r,body}}
async function expect(url,opt,status){const x=await request(url,opt);if(x.r.status!==status)throw new Error(`${opt.method||'GET'} ${url}: expected ${status}, got ${x.r.status}\n${JSON.stringify(x.body)}`);return x}
async function ready(){const start=Date.now();while(Date.now()-start<30000){try{if((await request('/api/admin/me')).r.status===200)return}catch{}await new Promise(r=>setTimeout(r,300))}throw new Error(`secured Kivo did not boot\n${output.slice(-7000)}`)}
function stopTree(child){try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});else child.kill('SIGTERM')}catch{}}

const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'secure-gateway.js')],{
  cwd:ROOT,
  env:{...process.env,PORT:String(PORT),KIVO_LOCAL_DESKTOP:'false',KIVO_DATA_DIR:dataDir,KIVO_UPLOAD_DIR:uploadsDir,KIVO_ADMIN_EMAIL:'owner@kivo.local',KIVO_ADMIN_PASSWORD:ownerPassword,KIVO_TRUST_PROXY:'false',SECURE_COOKIES:'false',OPENAI_API_KEY:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',KIVO_UPDATE_REPO:'kumaylalrahal2009-debug/Kivo-Updates'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>{output+=d;process.stdout.write(d)});child.stderr.on('data',d=>{output+=d;process.stderr.write(d)});

(async()=>{try{
  await ready();pass('secured Kivo booted for capture parser regression suite');
  const reg=await expect('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Parser Test User',email,password})},201);
  const cookie=cookieOf(reg.r),csrf=reg.body.csrf;if(!cookie||!csrf)throw new Error('parser test registration did not return session state');

  async function capture(text){
    const x=await expect('/api/capture',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({text})},201);
    return x.body.item;
  }

  let p=await capture('gym membership 20 every month');
  eq('bare whole-number subscription amount',p.amount,20);
  eq('bare whole-number subscription category',p.category,'money');
  eq('bare whole-number subscription recurrence',p.recurrence,'monthly');

  p=await capture('Spotify A$12 every month');
  eq('explicit currency amount',p.amount,12);
  eq('explicit currency category',p.category,'money');

  p=await capture('gym membership remind me 2 days before');
  eq('reminder days are not mistaken for money',p.amount,null);
  eq('reminder days still parse',p.reminder_days,2);

  p=await capture('gym membership at 4pm');
  eq('clock hour is not mistaken for money',p.amount,null);
  eq('clock hour still parses as time',p.due_time,'16:00');

  p=await capture('phone bill due in 3 days');
  eq('relative day count is not mistaken for bill amount',p.amount,null);

  p=await capture('gym membership every 2 weeks 25');
  eq('recurrence interval is not mistaken for money',p.amount,25);
  eq('two-week recurrence interval',Number(p.recurrence_interval),2);
  eq('two-week recurrence unit',p.recurrence,'weekly');

  p=await capture('dentist appointment at 4:15pm');
  eq('appointment time is not money',p.amount,null);
  eq('appointment classification',p.category,'event');
  eq('appointment time parsing',p.due_time,'16:15');

  p=await capture('return headphones by Friday');
  eq('deadline without money stays non-money',p.amount,null);
  eq('deadline classification',p.category,'deadline');

  p=await capture('Netflix 9.99 every 11th remind me 1 day before');
  eq('decimal subscription remains money',p.amount,9.99);
  eq('monthly day remains 11',p.recurrence_day,11);
  eq('reminder remains one day',p.reminder_days,1);

  p=await capture('rent 450 per week');
  eq('weekly whole-number cost',p.amount,450);
  eq('weekly recurring cost category',p.category,'money');
  eq('weekly recurrence',p.recurrence,'weekly');

  p=await capture('insurance annual 1200 renews September 2');
  eq('annual whole-number cost',p.amount,1200);
  eq('annual recurrence',p.recurrence,'yearly');

  console.log('\nKivo secured capture parser regression suite passed.');
}catch(err){
  console.error(`\nKIVO CAPTURE PARSER TEST FAILED: ${err.stack||err.message}`);
  console.error('\nLast Kivo output:\n'+output.slice(-9000));
  process.exitCode=1;
}finally{stopTree(child);try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}})();
