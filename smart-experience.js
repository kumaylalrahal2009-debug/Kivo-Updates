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
const DB_PATH=path.join(DATA,'kivo.db');
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const AI_MODEL=process.env.KIVO_AI_MODEL||'gpt-5-mini';
fs.mkdirSync(DATA,{recursive:true});
const db=new DatabaseSync(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS assistant_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);CREATE INDEX IF NOT EXISTS idx_assistant_messages_user ON assistant_messages(user_id,id);`);

const now=()=>new Date().toISOString();
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function cookies(req){const o={};for(const p of(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return o}
function session(req){const tok=cookies(req).kivo_session;if(!tok)return null;try{return db.prepare(`SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(tok),now())||null}catch{return null}}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
async function readJson(req,max=7*1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw new Error('Request too large.');chunks.push(c)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Error('Invalid request.')}}

const corrections=new Map(Object.entries({
  'tmr':'tomorrow','tmrw':'tomorrow','tomorow':'tomorrow','tommorow':'tomorrow','tommorrow':'tomorrow',
  'tdy':'today','todsy':'today','sub':'subscription','subs':'subscriptions','subcription':'subscription','subscribtion':'subscription','subsription':'subscription','suscription':'subscription',
  'netflx':'netflix','netflic':'netflix','spoitfy':'spotify','spotfy':'spotify','membeship':'membership','memberhsip':'membership','membship':'membership',
  'remid':'remind','remimd':'remind','remeber':'remember','rember':'remember','remebering':'remembering','payemnt':'payment','paymnt':'payment','payed':'paid',
  'cancelled':'cancelled','canceled':'cancelled','deadine':'deadline','dealine':'deadline','apointment':'appointment','appoitment':'appointment','reciept':'receipt',
  'whats':'what is','wht':'what','wat':'what','wats':'what is','whta':'what','hte':'the','teh':'the','jsut':'just','becuase':'because','cos':'because','cuz':'because',
  'needtodo':'need to do','upcomming':'upcoming','upcomingg':'upcoming','monht':'month','mth':'month','yr':'year'
}));
function smartCorrect(input){
  let s=String(input||'').replace(/[\u2018\u2019]/g,"'").replace(/\s+/g,' ').trim();
  if(!s)return s;
  s=s.replace(/\b([A-Za-z][A-Za-z']*)\b/g,w=>{
    const low=w.toLowerCase();const replacement=corrections.get(low);if(!replacement)return w;
    if(w[0]===w[0].toUpperCase())return replacement.charAt(0).toUpperCase()+replacement.slice(1);return replacement;
  });
  return s.replace(/\s+([,.!?])/g,'$1').replace(/([!?])\1{2,}/g,'$1$1');
}
function lev(a,b){a=String(a);b=String(b);const dp=Array(b.length+1).fill(0).map((_,i)=>i);for(let i=1;i<=a.length;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=b.length;j++){const old=dp[j];dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return dp[b.length]}
function words(s){return String(s||'').toLowerCase().match(/[a-z0-9]+/g)||[]}
function fuzzyIncludes(haystack,query){const H=words(haystack),Q=words(query).filter(x=>x.length>2);if(!Q.length)return false;return Q.some(q=>H.some(h=>h.includes(q)||q.includes(h)||(q.length>=5&&h.length>=5&&lev(q,h)<=2)))}
function isoToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function daysFromToday(iso){if(!iso)return 9999;const [y,m,d]=iso.split('-').map(Number);const a=new Date();const start=new Date(a.getFullYear(),a.getMonth(),a.getDate(),12);const target=new Date(y,m-1,d,12);return Math.round((target-start)/86400000)}
function friendlyDate(iso){if(!iso)return'';const n=daysFromToday(iso);if(n===0)return'today';if(n===1)return'tomorrow';if(n===-1)return'yesterday';if(n>1&&n<7)return`in ${n} days`;if(n<0)return`${Math.abs(n)} days overdue`;const [y,m,d]=iso.split('-').map(Number);return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short'}).format(new Date(y,m-1,d,12))}
function money(n){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(Number(n||0))}
function getItems(uid){try{return db.prepare(`SELECT * FROM items WHERE user_id=? ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,due_date,created_at DESC`).all(uid)}catch{return[]}}
function relevantSnapshot(uid){
  const all=getItems(uid);const open=all.filter(x=>x.status==='open');const active=open.slice().sort((a,b)=>daysFromToday(a.due_date)-daysFromToday(b.due_date));
  const charges=active.filter(x=>x.amount!=null);const overdue=active.filter(x=>daysFromToday(x.due_date)<0);const today=active.filter(x=>daysFromToday(x.due_date)===0);const tomorrow=active.filter(x=>daysFromToday(x.due_date)===1);const week=active.filter(x=>{const n=daysFromToday(x.due_date);return n>=0&&n<=7});
  return{all,open,active,charges,overdue,today,tomorrow,week};
}
function itemPhrase(x,includeAmount=true){const bits=[x.title];if(includeAmount&&x.amount!=null)bits.push(money(x.amount));if(x.due_date)bits.push(friendlyDate(x.due_date));if(x.recurrence)bits.push(x.recurrence);return bits.join(' · ')}
function naturalJoin(arr){if(!arr.length)return'';if(arr.length===1)return arr[0];if(arr.length===2)return`${arr[0]} and ${arr[1]}`;return`${arr.slice(0,-1).join(', ')}, and ${arr[arr.length-1]}`}
function remember(uid,role,text){try{db.prepare('INSERT INTO assistant_messages(user_id,role,content,created_at) VALUES(?,?,?,?)').run(uid,role,String(text).slice(0,1800),now());db.prepare(`DELETE FROM assistant_messages WHERE user_id=? AND id NOT IN (SELECT id FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 16)`).run(uid,uid)}catch{}}
function history(uid){try{return db.prepare('SELECT role,content FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 8').all(uid).reverse()}catch{return[]}}

function localAssistant(uid,question){
  const q=smartCorrect(question);const low=q.toLowerCase();const s=relevantSnapshot(uid);const name=(db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name||'').split(' ')[0];
  const hello=/^(hi|hey|hello|yo|sup|good morning|good afternoon|good evening)[!?. ]*$/.test(low);
  if(hello){const next=s.active.find(x=>x.due_date);if(next)return`Hey${name?` ${name}`:''}. You’re looking pretty organised. The next thing on your radar is ${itemPhrase(next)}.`;return`Hey${name?` ${name}`:''}. You’re clear right now — nothing urgent is waiting on you.`}
  if(/thank|thx|ty\b/.test(low))return`Anytime. I’ll keep the important stuff surfaced so you don’t have to hold it all in your head.`;
  if(/(what|anything).*(urgent|priority|important)|what.*first|where.*start/.test(low)){
    if(s.overdue.length)return`Start with ${itemPhrase(s.overdue[0])}. It’s overdue, so that’s the one I’d handle first.${s.today[0]?` After that, ${itemPhrase(s.today[0])}.`:''}`;
    if(s.today.length)return`I’d handle ${itemPhrase(s.today[0])} first because it’s due today.${s.tomorrow[0]?` Then you’re looking at ${itemPhrase(s.tomorrow[0])}.`:''}`;
    if(s.tomorrow.length)return`Nothing is urgent today. The next thing worth preparing for is ${itemPhrase(s.tomorrow[0])}.`;
    return s.active[0]?`Nothing looks urgent. Your next dated item is ${itemPhrase(s.active[0])}.`:`Nothing needs immediate attention right now.`;
  }
  if(/what.*(need|should).*(do|handle)|what.*do.*today|to.?do|my day|plan my/.test(low)){
    if(!s.open.length)return`You’re clear — there’s nothing open that needs action right now.`;
    const priorities=[...s.overdue,...s.today,...s.tomorrow,...s.active.filter(x=>{const n=daysFromToday(x.due_date);return n>1&&n<=7})].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,3);
    if(!priorities.length)return`You have ${s.open.length} open item${s.open.length===1?'':'s'}, but none has a near deadline. I wouldn’t rush anything right now.`;
    const first=priorities[0];let out=`Your best next move is ${itemPhrase(first)}.`;if(priorities.length>1)out+=` After that, ${naturalJoin(priorities.slice(1).map(x=>itemPhrase(x,false)))}.`;if(s.overdue.length===0)out+=` Nothing else looks urgent.`;return out;
  }
  if(/(what|how much).*(pay|paying|spend|subscription|charge|bill)|subscriptions?|upcoming charges?/.test(low)){
    const arr=s.charges;if(!arr.length)return`You don’t have any open charges saved right now.`;const total=arr.reduce((a,x)=>a+Number(x.amount||0),0);const recurring=arr.filter(x=>x.recurrence);let out=`You’ve got ${arr.length} upcoming charge${arr.length===1?'':'s'} totalling ${money(total)}.`;if(recurring.length)out+=` The recurring ones are ${naturalJoin(recurring.slice(0,4).map(x=>itemPhrase(x)))}.`;const next=arr.filter(x=>x.due_date).sort((a,b)=>daysFromToday(a.due_date)-daysFromToday(b.due_date))[0];if(next)out+=` The next one to hit is ${itemPhrase(next)}.`;return out;
  }
  if(/tomorrow|tmrw/.test(low)){
    if(!s.tomorrow.length)return`Nothing is currently saved for tomorrow.`;return s.tomorrow.length===1?`Tomorrow, the main thing is ${itemPhrase(s.tomorrow[0])}.`:`Tomorrow you’ve got ${naturalJoin(s.tomorrow.slice(0,4).map(x=>itemPhrase(x)))}.`;
  }
  if(/this week|next 7|week ahead/.test(low)){
    if(!s.week.length)return`Your next seven days look clear.`;return`This week, I’d keep an eye on ${naturalJoin(s.week.slice(0,5).map(x=>itemPhrase(x)))}.`;
  }
  if(/deadline|due|overdue|expire|return/.test(low)){
    const arr=s.active.filter(x=>x.category==='deadline'||daysFromToday(x.due_date)<0);if(!arr.length)return`You don’t have any active deadlines saved.`;const first=arr[0];return`The deadline I’d pay attention to first is ${itemPhrase(first,false)}.${arr.length>1?` You’ve also got ${naturalJoin(arr.slice(1,4).map(x=>itemPhrase(x,false)))}.`:''}`;
  }
  const matches=s.all.filter(x=>fuzzyIncludes(`${x.title} ${x.notes||''}`,q));
  if(matches.length){const x=matches[0];let out=`I found ${itemPhrase(x)}.`;if(x.status==='cancelled')out+=` It’s currently marked cancelled.`;else if(x.status==='done')out+=` It’s marked done.`;else if(x.due_date){const n=daysFromToday(x.due_date);out+=n<0?` It needs attention because it’s overdue.`:n<=1?` That’s close enough that I’d keep it near the top of your list.`:'';}return out;}
  if(s.overdue.length||s.today.length)return`I’m not seeing a saved item that clearly matches that, but the thing that actually needs your attention is ${itemPhrase((s.overdue[0]||s.today[0]))}.`;
  if(s.active[0])return`I’m not fully sure what you mean. Your next saved item is ${itemPhrase(s.active[0])}. If you meant something specific, just say its name naturally.`;
  return`I’m not fully sure what you mean yet. Try asking me what’s next, what you’re paying for, what’s urgent, or about a specific thing you saved.`;
}

function buildAIContext(uid,question){
  const s=relevantSnapshot(uid);const rows=s.all.slice(0,40).map(x=>({title:x.title,category:x.category,status:x.status,due_date:x.due_date,due_in_days:daysFromToday(x.due_date),amount:x.amount,recurrence:x.recurrence,notes:String(x.notes||'').slice(0,220)}));
  return JSON.stringify({today:isoToday(),question:smartCorrect(question),items:rows,recent_conversation:history(uid)});
}
async function cloudAssistant(uid,question){
  if(!OPENAI_API_KEY)return null;
  const instructions=`You are Kivo, a personal life-admin assistant. Be concise, warm, natural and action-first. Use ONLY the supplied Kivo data for factual claims about the user's life. Understand typos and casual wording without correcting the user pedantically. Do not dump database rows. Prioritise overdue/today/tomorrow items and explain the useful next move. For money questions, calculate from supplied amounts only. If data is missing, say so naturally. Never invent dates, payments, subscriptions or tasks. Usually answer in 1-4 short sentences, with at most 3 compact bullets when that is clearly easier to scan.`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,store:false,instructions,input:buildAIContext(uid,question),max_output_tokens:420})});
  if(!r.ok)throw new Error(`AI service returned ${r.status}`);const data=await r.json();
  const text=data.output_text||((data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n')).trim();return text||null;
}

function trackAsk(uid,mode){try{db.prepare(`INSERT INTO analytics_events(user_id,event_type,metadata,created_at) VALUES(?,?,?,?)`).run(uid,'ask',JSON.stringify({mode}),now())}catch{}}
function asksToday(uid){try{const d=new Date();const start=new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString();return db.prepare(`SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND event_type='ask' AND created_at>=?`).get(uid,start).n}catch{return 0}}
function isPro(uid){try{const m=db.prepare('SELECT plan,status FROM memberships WHERE user_id=?').get(uid);return m?.plan==='pro'&&['active','trialing'].includes(m.status)}catch{return false}}

function requestInner(req,res,body=null){const headers={...req.headers,host:`127.0.0.1:${INNER_PORT}`};if(body){headers['content-length']=Buffer.byteLength(body);headers['content-type']='application/json';}const p=http.request({hostname:'127.0.0.1',port:INNER_PORT,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode||500,{...r.headers,'cache-control':'no-store'});r.pipe(res)});p.on('error',()=>send(res,503,{error:'Kivo is starting. Try again in a moment.'}));if(body)p.end(body);else req.pipe(p)}
function appendAsset(req,res,file,type){const p=http.request({hostname:'127.0.0.1',port:INNER_PORT,path:req.url,method:'GET',headers:{...req.headers,host:`127.0.0.1:${INNER_PORT}`}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{let base=Buffer.concat(chunks).toString('utf8');try{base+='\n\n'+fs.readFileSync(path.join(ROOT,'public',file),'utf8')}catch{}res.writeHead(r.statusCode||200,{'Content-Type':type,'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'});res.end(base)})});p.on('error',()=>send(res,503,{error:'Kivo is starting.'}));p.end()}

const childEnv={...process.env,PORT:String(INNER_PORT),KIVO_BILLING_PORT:String(INNER_BILLING),KIVO_CORE_PORT:String(INNER_CORE),KIVO_DATA_DIR:DATA,KIVO_UPLOAD_DIR:process.env.KIVO_UPLOAD_DIR||path.join(ROOT,'uploads')};
const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'experience.js')],{cwd:ROOT,env:childEnv,stdio:['ignore','inherit','inherit']});
child.on('exit',code=>{console.log(`Kivo inner experience exited (${code??0}).`);process.exit(code??0)});

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/app.js')return appendAsset(req,res,'smart-client.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&url.pathname==='/styles.css')return appendAsset(req,res,'smart-ui.css','text/css; charset=utf-8');
  if(req.method==='POST'&&url.pathname==='/api/ask'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});const body=await readJson(req);if(!safeEqual(req.headers['x-csrf-token']||body._csrf,s.csrf))return send(res,403,{error:'Security token expired. Refresh Kivo and try again.'});
    if(!isPro(s.user_id)&&asksToday(s.user_id)>=15)return send(res,402,{error:'You’ve used today’s 15 free Ask Kivo messages. Kivo Pro removes the daily limit.'});
    const original=String(body.q||'').trim();if(!original)return send(res,400,{error:'Ask me something first.'});const corrected=smartCorrect(original);remember(s.user_id,'user',corrected);
    let answer=null,mode='local';try{answer=await cloudAssistant(s.user_id,corrected);if(answer)mode='cloud'}catch(err){console.warn('Kivo AI fallback:',err.message)}
    if(!answer)answer=localAssistant(s.user_id,corrected);remember(s.user_id,'assistant',answer);trackAsk(s.user_id,mode);return send(res,200,{answer,corrected_query:corrected,mode});
  }
  if(req.method==='POST'&&url.pathname==='/api/capture'){
    const body=await readJson(req);if(typeof body.text==='string')body.text=smartCorrect(body.text);return requestInner(req,res,JSON.stringify(body));
  }
  requestInner(req,res);
}catch(err){console.error('Kivo smart layer:',err);if(!res.headersSent)send(res,500,{error:err.message||'Something went wrong.'})}});
server.listen(PORT,()=>console.log(`\nKivo Smart Experience: http://localhost:${PORT}\nAI: ${OPENAI_API_KEY?`connected (${AI_MODEL})`:'smart local mode'}\nAutocorrect + conversational context enabled.\n`));
