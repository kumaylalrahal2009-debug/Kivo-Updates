const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

const ROOT=__dirname;
const PORT=Number(process.env.PORT||8488);
const INNER_PORT=Number(process.env.KIVO_SMART_INNER_PORT||(PORT+4));
const INNER_BILLING=INNER_PORT+1;
const INNER_CORE=INNER_PORT+2;
const DATA=path.resolve(process.env.KIVO_DATA_DIR||path.join(ROOT,'data'));
const UPLOADS=path.resolve(process.env.KIVO_UPLOAD_DIR||path.join(ROOT,'uploads'));
const DB_PATH=path.join(DATA,'kivo.db');
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const AI_MODEL=process.env.KIVO_AI_MODEL||'gpt-5-mini';
const CLOUD_TIMEOUT_MS=Math.max(2500,Number(process.env.KIVO_AI_TIMEOUT_MS||8500));
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true});
const db=new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_user ON assistant_messages(user_id,id);
`);

const now=()=>new Date().toISOString();
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function cookies(req){const o={};for(const p of(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return o}
function session(req){const tok=cookies(req).kivo_session;if(!tok)return null;try{return db.prepare(`SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(tok),now())||null}catch{return null}}
function adminSession(req){const tok=cookies(req).kivo_admin;if(!tok)return null;try{return db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(tok),now())||null}catch{return null}}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
async function readJson(req,max=7*1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw new Error('Request too large.');chunks.push(c)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Error('Invalid request.')}}

const corrections=new Map(Object.entries({
  tmr:'tomorrow',tmrw:'tomorrow',tmrrow:'tomorrow',tomorow:'tomorrow',tommorow:'tomorrow',tommorrow:'tomorrow',
  tdy:'today',todsy:'today',yday:'yesterday',
  sub:'subscription',subs:'subscriptions',subcription:'subscription',subscribtion:'subscription',subsription:'subscription',suscription:'subscription',
  netflx:'netflix',netflic:'netflix',netfix:'netflix',spoitfy:'spotify',spotfy:'spotify',spotfiy:'spotify',
  membeship:'membership',memberhsip:'membership',membship:'membership',memeber:'member',
  remid:'remind',remimd:'remind',remeber:'remember',rember:'remember',remebering:'remembering',
  payemnt:'payment',paymnt:'payment',payed:'paid',paied:'paid',reciept:'receipt',recipt:'receipt',
  deadine:'deadline',dealine:'deadline',dedline:'deadline',apointment:'appointment',appoitment:'appointment',appointmnt:'appointment',
  whats:'what is',wht:'what',wat:'what',wats:'what is',whta:'what',hte:'the',teh:'the',jsut:'just',becuase:'because',
  cos:'because',cuz:'because',rn:'right now',asap:'as soon as possible',pls:'please',plz:'please',
  needtodo:'need to do',upcomming:'upcoming',upcomingg:'upcoming',monht:'month',mth:'month',mnth:'month',yr:'year',wk:'week',
  cancled:'cancelled',canceled:'cancelled',cancelled:'cancelled',expiringg:'expiring',renewel:'renewal',renwal:'renewal'
}));
function smartCorrect(input){
  let s=String(input||'').replace(/[\u2018\u2019]/g,"'").replace(/\s+/g,' ').trim();if(!s)return s;
  s=s.replace(/\b([A-Za-z][A-Za-z']*)\b/g,w=>{const rep=corrections.get(w.toLowerCase());if(!rep)return w;return w[0]===w[0].toUpperCase()?rep.charAt(0).toUpperCase()+rep.slice(1):rep});
  return s.replace(/\s+([,.!?])/g,'$1').replace(/([!?])\1{2,}/g,'$1$1').trim();
}
function lev(a,b){a=String(a);b=String(b);const dp=Array(b.length+1).fill(0).map((_,i)=>i);for(let i=1;i<=a.length;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=b.length;j++){const old=dp[j];dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return dp[b.length]}
function words(s){return String(s||'').toLowerCase().match(/[a-z0-9]+/g)||[]}
function fuzzyScore(haystack,query){const H=words(haystack),Q=words(query).filter(x=>x.length>2);if(!Q.length)return 0;let score=0;for(const q of Q){let best=0;for(const h of H){if(h===q)best=Math.max(best,4);else if(h.includes(q)||q.includes(h))best=Math.max(best,3);else if(q.length>=5&&h.length>=5&&lev(q,h)<=1)best=Math.max(best,2.5);else if(q.length>=5&&h.length>=5&&lev(q,h)<=2)best=Math.max(best,1.5)}score+=best}return score/Q.length}
function isoToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function localDate(iso){if(!iso)return null;const [y,m,d]=String(iso).split('-').map(Number);if(!y||!m||!d)return null;return new Date(y,m-1,d,12)}
function daysFromToday(iso){const target=localDate(iso);if(!target)return 9999;const a=new Date();const start=new Date(a.getFullYear(),a.getMonth(),a.getDate(),12);return Math.round((target-start)/86400000)}
function friendlyDate(iso){if(!iso)return'';const n=daysFromToday(iso);if(n===0)return'today';if(n===1)return'tomorrow';if(n===-1)return'yesterday';if(n>1&&n<7)return`in ${n} days`;if(n<0)return`${Math.abs(n)} day${Math.abs(n)===1?'':'s'} overdue`;const d=localDate(iso);return d?new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short'}).format(d):iso}
function money(n){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0))}
function getItems(uid){try{return db.prepare(`SELECT * FROM items WHERE user_id=? ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END,CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,due_date,created_at DESC`).all(uid)}catch{return[]}}
function snapshot(uid){
  const all=getItems(uid),open=all.filter(x=>x.status==='open'),active=open.slice().sort((a,b)=>daysFromToday(a.due_date)-daysFromToday(b.due_date));
  const charges=active.filter(x=>x.amount!=null),recurring=charges.filter(x=>x.recurrence),overdue=active.filter(x=>daysFromToday(x.due_date)<0),today=active.filter(x=>daysFromToday(x.due_date)===0),tomorrow=active.filter(x=>daysFromToday(x.due_date)===1),week=active.filter(x=>{const n=daysFromToday(x.due_date);return n>=0&&n<=7}),month=active.filter(x=>{const n=daysFromToday(x.due_date);return n>=0&&n<=30}),done=all.filter(x=>x.status==='done'),cancelled=all.filter(x=>x.status==='cancelled'),avoidable=charges.filter(x=>x.avoidable);
  return{all,open,active,charges,recurring,overdue,today,tomorrow,week,month,done,cancelled,avoidable};
}
function itemPhrase(x,{amount=true,recurrence=true}={}){const bits=[x.title];if(amount&&x.amount!=null)bits.push(money(x.amount));if(x.due_date)bits.push(friendlyDate(x.due_date));if(recurrence&&x.recurrence)bits.push(x.recurrence);return bits.join(' · ')}
function naturalJoin(arr){if(!arr.length)return'';if(arr.length===1)return arr[0];if(arr.length===2)return`${arr[0]} and ${arr[1]}`;return`${arr.slice(0,-1).join(', ')}, and ${arr[arr.length-1]}`}
function remember(uid,role,text){try{db.prepare('INSERT INTO assistant_messages(user_id,role,content,created_at) VALUES(?,?,?,?)').run(uid,role,String(text).slice(0,2400),now());db.prepare(`DELETE FROM assistant_messages WHERE user_id=? AND id NOT IN (SELECT id FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 30)`).run(uid,uid)}catch{}}
function history(uid,limit=12){try{return db.prepare('SELECT role,content,created_at FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT ?').all(uid,limit).reverse()}catch{return[]}}
function findItem(s,q){return s.all.map(x=>({x,score:fuzzyScore(`${x.title} ${x.notes||''}`,q)})).filter(r=>r.score>=1.4).sort((a,b)=>b.score-a.score)[0]?.x||null}
function lastReferencedItem(uid,s){const h=history(uid,8).slice().reverse();for(const m of h){for(const x of s.all){if(String(m.content||'').toLowerCase().includes(String(x.title||'').toLowerCase()))return x}}return null}
function referencedItem(uid,s,q){const direct=findItem(s,q);if(direct)return direct;if(/\b(it|that|this|one|that one|this one)\b/i.test(q)||/^(when|how much|what about|and|after that)/i.test(q))return lastReferencedItem(uid,s);return null}
function nextPriority(s,excludeId=null){return [...s.overdue,...s.today,...s.tomorrow,...s.week,...s.active].find(x=>String(x.id)!==String(excludeId||''))||null}
function monthlyEquivalent(items){return items.reduce((sum,x)=>{const a=Number(x.amount||0);if(x.recurrence==='yearly')return sum+a/12;if(x.recurrence==='weekly')return sum+a*52/12;if(x.recurrence==='fortnightly')return sum+a*26/12;if(x.recurrence==='daily')return sum+a*365/12;return sum+a},0)}

function localAssistant(uid,question){
  const q=smartCorrect(question),low=q.toLowerCase(),s=snapshot(uid),name=(db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name||'').split(' ')[0],ref=referencedItem(uid,s,q);
  if(/^(hi|hey|hello|yo|sup|good morning|good afternoon|good evening)[!?. ]*$/.test(low)){const next=nextPriority(s);return next?`Hey${name?` ${name}`:''}. You’re looking pretty organised. The next thing I’d keep on your radar is ${itemPhrase(next)}.`:`Hey${name?` ${name}`:''}. You’re clear right now — nothing urgent is waiting on you.`}
  if(/thank|thx|\bty\b/.test(low))return`Anytime. I’ll keep the important stuff surfaced so you don’t have to hold it all in your head.`;
  if(/^(help|what can you do|how do i use)/.test(low))return`Ask me naturally. I can tell you what needs attention, what’s due next, what you’re paying for, what looks avoidable, or when a saved thing is happening. You don’t need exact wording.`;

  if(/after that|what.*next after|and then/.test(low)){const n=nextPriority(s,ref?.id);return n?`After ${ref?ref.title:'that'}, the next thing I’d look at is ${itemPhrase(n)}.`:`After that, nothing else looks urgent.`}
  if(ref&&/\bwhen\b|what date|what day/.test(low))return ref.due_date?`${ref.title} is ${friendlyDate(ref.due_date)}${ref.due_time?` at ${ref.due_time}`:''}.`:`I have ${ref.title} saved, but there isn’t a date attached to it yet.`;
  if(ref&&/(how much|price|cost|amount)/.test(low))return ref.amount!=null?`${ref.title} is ${money(ref.amount)}${ref.recurrence?` ${ref.recurrence}`:''}.`:`I have ${ref.title} saved, but there isn’t an amount attached to it.`;
  if(ref&&/(is it|is that).*(urgent|due|late)|what about/.test(low)){const n=daysFromToday(ref.due_date);if(!ref.due_date)return`${ref.title} is saved, but it has no deadline, so I wouldn’t treat it as urgent from the information I have.`;return n<0?`${ref.title} is overdue by ${Math.abs(n)} day${Math.abs(n)===1?'':'s'}, so yes — I’d handle that first.`:n===0?`${ref.title} is due today, so I’d keep it at the top.`:n===1?`${ref.title} is tomorrow. It isn’t overdue, but it’s close enough to prepare for now.`:`${ref.title} is ${friendlyDate(ref.due_date)}. It doesn’t look urgent yet.`}

  if(/(what|anything).*(urgent|priority|important)|what.*first|where.*start|right now/.test(low)){
    if(s.overdue.length)return`Start with ${itemPhrase(s.overdue[0])}. It’s overdue.${s.today[0]?` After that, ${itemPhrase(s.today[0])}.`:''}`;
    if(s.today.length)return`I’d handle ${itemPhrase(s.today[0])} first because it’s due today.${s.tomorrow[0]?` Then ${itemPhrase(s.tomorrow[0])}.`:''}`;
    if(s.tomorrow.length)return`Nothing is urgent today. The next thing worth preparing for is ${itemPhrase(s.tomorrow[0])}.`;
    return s.active[0]?`Nothing looks urgent. Your next dated item is ${itemPhrase(s.active[0])}.`:`Nothing needs immediate attention right now.`;
  }
  if(/what.*(need|should).*(do|handle)|what.*do.*today|to.?do|my day|plan my|give me.*plan/.test(low)){
    if(!s.open.length)return`You’re clear — there’s nothing open that needs action right now.`;
    const p=[...s.overdue,...s.today,...s.tomorrow,...s.week].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,3);
    if(!p.length)return`You have ${s.open.length} open item${s.open.length===1?'':'s'}, but none has a near deadline. I wouldn’t rush anything right now.`;
    let out=`Your best next move is ${itemPhrase(p[0])}.`;if(p[1])out+=` After that, ${itemPhrase(p[1],{amount:false})}.`;if(p[2])out+=` Then ${itemPhrase(p[2],{amount:false})}.`;return out;
  }
  if(/overdue|late items?|missed/.test(low))return s.overdue.length?`You have ${s.overdue.length} overdue item${s.overdue.length===1?'':'s'}: ${naturalJoin(s.overdue.slice(0,4).map(x=>itemPhrase(x)))}.`:`Nothing is overdue.`;
  if(/tomorrow/.test(low))return s.tomorrow.length?(s.tomorrow.length===1?`Tomorrow, the main thing is ${itemPhrase(s.tomorrow[0])}.`:`Tomorrow you’ve got ${naturalJoin(s.tomorrow.slice(0,5).map(x=>itemPhrase(x)))}.`):`Nothing is currently saved for tomorrow.`;
  if(/this week|next 7|week ahead/.test(low))return s.week.length?`This week, I’d keep an eye on ${naturalJoin(s.week.slice(0,5).map(x=>itemPhrase(x)))}.`:`Your next seven days look clear.`;
  if(/next 30|this month|month ahead/.test(low)&&/(due|coming|what|show|have)/.test(low))return s.month.length?`Over the next 30 days you have ${s.month.length} dated item${s.month.length===1?'':'s'}: ${naturalJoin(s.month.slice(0,5).map(x=>itemPhrase(x)))}.`:`The next 30 days look clear from what you’ve saved.`;

  if(/(what|how much).*(pay|paying|spend|subscription|charge|bill)|subscriptions?|upcoming charges?/.test(low)){
    if(!s.charges.length)return`You don’t have any open charges saved right now.`;
    const total=s.charges.reduce((a,x)=>a+Number(x.amount||0),0),next=s.charges.filter(x=>x.due_date).sort((a,b)=>daysFromToday(a.due_date)-daysFromToday(b.due_date))[0];
    let out=`You’ve got ${s.charges.length} upcoming charge${s.charges.length===1?'':'s'} totalling ${money(total)}.`;
    if(s.recurring.length)out+=` Your recurring monthly equivalent is about ${money(monthlyEquivalent(s.recurring))}.`;
    if(next)out+=` The next one to hit is ${itemPhrase(next)}.`;return out;
  }
  if(/monthly spend|per month|every month|monthly total/.test(low)){const t=monthlyEquivalent(s.recurring);return s.recurring.length?`Your saved recurring charges work out to about ${money(t)} per month across ${s.recurring.length} recurring item${s.recurring.length===1?'':'s'}.`:`You don’t have any recurring charges saved yet.`}
  if(/avoidable|can i cancel|what.*cancel|optional charges?|waste/.test(low))return s.avoidable.length?`The charges you’ve marked as avoidable are ${naturalJoin(s.avoidable.slice(0,5).map(x=>itemPhrase(x)))}. I’d review those first if you’re trying to cut spending.`:`You haven’t marked any upcoming charge as avoidable.`;
  if(/cancelled|canceled/.test(low)&&/(what|show|which|my)/.test(low))return s.cancelled.length?`You’ve marked ${naturalJoin(s.cancelled.slice(0,6).map(x=>x.title))} as cancelled.`:`You don’t have anything marked cancelled.`;
  if(/what.*(paid|done|completed)|completed items?|done items?/.test(low))return s.done.length?`Recently completed: ${naturalJoin(s.done.slice(0,6).map(x=>x.title))}.`:`You don’t have anything marked done yet.`;
  if(/deadline|due|expire|return/.test(low)){const arr=s.active.filter(x=>x.category==='deadline'||x.due_date);return arr.length?`The dated thing I’d pay attention to first is ${itemPhrase(arr[0],{amount:false})}.${arr[1]?` After that, ${itemPhrase(arr[1],{amount:false})}.`:''}`:`You don’t have any active dated deadlines saved.`}
  if(/summari[sz]e|overview|everything going on|what.*going on/.test(low)){const bits=[];if(s.overdue.length)bits.push(`${s.overdue.length} overdue`);if(s.today.length)bits.push(`${s.today.length} due today`);if(s.tomorrow.length)bits.push(`${s.tomorrow.length} tomorrow`);if(s.charges.length)bits.push(`${s.charges.length} upcoming charge${s.charges.length===1?'':'s'}`);if(!bits.length)return`You’re in good shape. Nothing urgent is showing from what you’ve saved.`;const next=nextPriority(s);return`Right now: ${naturalJoin(bits)}.${next?` The first thing I’d focus on is ${itemPhrase(next)}.`:''}`}

  if(ref){let out=`I found ${itemPhrase(ref)}.`;if(ref.status==='cancelled')out+=` It’s marked cancelled.`;else if(ref.status==='done')out+=` It’s marked done.`;else if(ref.due_date&&daysFromToday(ref.due_date)<=1)out+=` It’s close enough that I’d keep it near the top of your list.`;return out}
  const fallback=nextPriority(s);return fallback?`I’m not completely sure what you meant, but the thing that actually matters next is ${itemPhrase(fallback)}. You can also ask using the name of the thing you mean.`:`I’m not completely sure what you meant. Ask me what’s urgent, what’s next, what you’re paying for, or the name of something you saved.`;
}

function buildAIContext(uid,question){const s=snapshot(uid);return JSON.stringify({today:isoToday(),question:smartCorrect(question),items:s.all.slice(0,50).map(x=>({title:x.title,category:x.category,status:x.status,due_date:x.due_date,due_time:x.due_time,days_until:daysFromToday(x.due_date),amount:x.amount,recurrence:x.recurrence,avoidable:!!x.avoidable,notes:String(x.notes||'').slice(0,240)})),recent_conversation:history(uid,12)})}
async function cloudAssistant(uid,question){
  if(!OPENAI_API_KEY)return null;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),CLOUD_TIMEOUT_MS);
  const instructions=`You are Kivo, a highly capable personal life-admin assistant. Answer like a sharp human assistant, not a database. Use only supplied Kivo data for claims about the user's life. Understand casual wording, typos, pronouns and follow-up questions using recent_conversation. Never invent dates, prices, payments, subscriptions or tasks. Prioritise overdue, today, tomorrow, then near-term items. For money, calculate only from supplied amounts. Tell the user the useful next move when relevant. Do not repeat every field. Avoid robotic phrases like "I found a matching saved item". Keep most answers to 1-4 concise sentences; use at most 3 bullets only when it genuinely scans better.`;
  try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,store:false,instructions,input:buildAIContext(uid,question),max_output_tokens:500})});if(!r.ok)throw new Error(`AI service returned ${r.status}`);const data=await r.json();return(data.output_text||((data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n'))).trim()||null}finally{clearTimeout(timer)}
}
function trackAsk(uid,mode){try{db.prepare('INSERT INTO analytics_events(user_id,event_type,metadata,created_at) VALUES(?,?,?,?)').run(uid,'ask',JSON.stringify({mode}),now())}catch{}}
function asksToday(uid){try{const d=new Date(),start=new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString();return db.prepare(`SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND event_type='ask' AND created_at>=?`).get(uid,start).n}catch{return 0}}
function isPro(uid){try{const m=db.prepare('SELECT plan,status FROM memberships WHERE user_id=?').get(uid);return m?.plan==='pro'&&['active','trialing'].includes(m.status)}catch{return false}}

function requestInner(req,res,body=null){const headers={...req.headers,host:`127.0.0.1:${INNER_PORT}`};if(body!==null){headers['content-length']=Buffer.byteLength(body);headers['content-type']='application/json'}const p=http.request({hostname:'127.0.0.1',port:INNER_PORT,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode||500,{...r.headers,'cache-control':'no-store'});r.pipe(res)});p.on('error',()=>send(res,503,{error:'Kivo is starting. Try again in a moment.'}));if(body!==null)p.end(body);else req.pipe(p)}
function appendAsset(req,res,file,type){const p=http.request({hostname:'127.0.0.1',port:INNER_PORT,path:req.url,method:'GET',headers:{...req.headers,host:`127.0.0.1:${INNER_PORT}`}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{let base=Buffer.concat(chunks).toString('utf8');try{base+='\n\n'+fs.readFileSync(path.join(ROOT,'public',file),'utf8')}catch{}res.writeHead(r.statusCode||200,{'Content-Type':type,'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'});res.end(base)})});p.on('error',()=>send(res,503,{error:'Kivo is starting.'}));p.end()}

const childEnv={...process.env,PORT:String(INNER_PORT),KIVO_BILLING_PORT:String(INNER_BILLING),KIVO_CORE_PORT:String(INNER_CORE),KIVO_DATA_DIR:DATA,KIVO_UPLOAD_DIR:UPLOADS};
const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'experience.js')],{cwd:ROOT,env:childEnv,stdio:['ignore','inherit','inherit']});
child.on('exit',code=>{console.log(`Kivo inner experience exited (${code??0}).`);process.exit(code??0)});

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/app.js')return appendAsset(req,res,'smart-client.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&url.pathname==='/styles.css')return appendAsset(req,res,'smart-ui.css','text/css; charset=utf-8');
  if(req.method==='GET'&&url.pathname==='/api/assistant/history'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});return send(res,200,{messages:history(s.user_id,20),mode:OPENAI_API_KEY?'cloud+local':'local'});
  }
  if(req.method==='DELETE'&&url.pathname==='/api/assistant/history'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});const body=await readJson(req);if(!safeEqual(req.headers['x-csrf-token']||body._csrf,s.csrf))return send(res,403,{error:'Security token expired.'});try{db.prepare('DELETE FROM assistant_messages WHERE user_id=?').run(s.user_id)}catch{}return send(res,200,{ok:true});
  }
  if(req.method==='GET'&&url.pathname==='/api/smart/status'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});const x=snapshot(s.user_id);return send(res,200,{ok:true,mode:OPENAI_API_KEY?'cloud+local':'local',model:OPENAI_API_KEY?AI_MODEL:null,items:x.all.length,open:x.open.length,overdue:x.overdue.length,version:'smart-v2'});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/smart-health'){
    if(!adminSession(req))return send(res,401,{error:'Admin login required.'});let version=null;try{version=JSON.parse(fs.readFileSync(path.join(ROOT,'version.json'),'utf8')).version}catch{};return send(res,200,{ok:true,smartLayer:'v2',aiConnected:!!OPENAI_API_KEY,aiModel:OPENAI_API_KEY?AI_MODEL:null,cloudTimeoutMs:CLOUD_TIMEOUT_MS,database:existsDb(),version,assistantMessages:countTable('assistant_messages'),analyticsEvents:countTable('analytics_events')});
  }
  if(req.method==='POST'&&url.pathname==='/api/ask'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});const body=await readJson(req);if(!safeEqual(req.headers['x-csrf-token']||body._csrf,s.csrf))return send(res,403,{error:'Security token expired. Refresh Kivo and try again.'});if(!isPro(s.user_id)&&asksToday(s.user_id)>=15)return send(res,402,{error:'You’ve used today’s 15 free Ask Kivo messages. Kivo Pro removes the daily limit.'});
    const original=String(body.q||'').trim();if(!original)return send(res,400,{error:'Ask me something first.'});const corrected=smartCorrect(original);remember(s.user_id,'user',corrected);let answer=null,mode='local';try{answer=await cloudAssistant(s.user_id,corrected);if(answer)mode='cloud'}catch(err){console.warn('Kivo AI fallback:',err.name==='AbortError'?'cloud timeout':err.message)}if(!answer)answer=localAssistant(s.user_id,corrected);remember(s.user_id,'assistant',answer);trackAsk(s.user_id,mode);return send(res,200,{answer,corrected_query:corrected,mode});
  }
  if(req.method==='POST'&&url.pathname==='/api/capture'){
    const body=await readJson(req);if(typeof body.text==='string')body.text=smartCorrect(body.text);return requestInner(req,res,JSON.stringify(body));
  }
  requestInner(req,res);
}catch(err){console.error('Kivo Smart v2:',err);if(!res.headersSent)send(res,500,{error:err.message||'Something went wrong.'})}});
function existsDb(){try{return fs.existsSync(DB_PATH)&&fs.statSync(DB_PATH).size>0}catch{return false}}
function countTable(name){try{return db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n}catch{return 0}}
server.listen(PORT,()=>console.log(`\nKivo Smart Experience v2: http://localhost:${PORT}\nAI: ${OPENAI_API_KEY?`connected (${AI_MODEL})`:'smart local mode'}\nContext, follow-ups, autocorrect and local fallback enabled.\n`));
