const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_PORT = Number(process.env.PORT || 8488);
const CORE_PORT = Number(process.env.KIVO_CORE_PORT || (PUBLIC_PORT + 1));
const DATA = path.resolve(process.env.KIVO_DATA_DIR || path.join(ROOT, 'data'));
const DB_PATH = path.join(DATA, 'kivo.db');
const CORE_SERVER = path.join(ROOT, 'server.js');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || '';
const STRIPE_PRICE_PRO_YEARLY = process.env.STRIPE_PRICE_PRO_YEARLY || '';
const PUBLIC_URL = (process.env.KIVO_PUBLIC_URL || `http://localhost:${PUBLIC_PORT}`).replace(/\/$/, '');
const PRO_MONTHLY_AUD = Number(process.env.KIVO_PRO_MONTHLY_AUD || 7.99);
const PRO_YEARLY_AUD = Number(process.env.KIVO_PRO_YEARLY_AUD || 59.99);

fs.mkdirSync(DATA, {recursive:true});
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS memberships(
  user_id INTEGER PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  billing_interval TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  stripe_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  amount_aud REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_events_date ON billing_events(created_at);
`);

const now = () => new Date().toISOString();
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function cookies(req){const out={};for(const p of (req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return out;}
function session(req){const tok=cookies(req).kivo_session;if(!tok)return null;try{return db.prepare(`SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(tok),now())||null;}catch{return null;}}
function adminSession(req){const tok=cookies(req).kivo_admin;if(!tok)return null;try{return db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(tok),now())||null;}catch{return null;}}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);}
function readBody(req,max=2*1024*1024){return new Promise((resolve,reject)=>{const chunks=[];let n=0;req.on('data',c=>{n+=c.length;if(n>max){reject(new Error('too_large'));req.destroy();return;}chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
function ensureMembership(uid){let m=db.prepare('SELECT * FROM memberships WHERE user_id=?').get(uid);if(!m){db.prepare("INSERT INTO memberships(user_id,plan,status,created_at,updated_at) VALUES(?,'free','active',?,?)").run(uid,now(),now());m=db.prepare('SELECT * FROM memberships WHERE user_id=?').get(uid);}return m;}
function isPro(m){return m&&m.plan==='pro'&&['active','trialing'].includes(m.status);}
function monthStart(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).toISOString();}
function todayStart(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString();}
function usage(uid){let captures=0,asks=0;try{captures=db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND event_type='capture' AND created_at>=?").get(uid,monthStart()).n;asks=db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND event_type='ask' AND created_at>=?").get(uid,todayStart()).n;}catch{}return {captures_month:captures,asks_today:asks};}
function billingConfig(){return {connected:!!(STRIPE_SECRET_KEY&&STRIPE_PRICE_PRO_MONTHLY),monthly_price:PRO_MONTHLY_AUD,yearly_price:PRO_YEARLY_AUD,yearly_available:!!STRIPE_PRICE_PRO_YEARLY};}
async function stripeRequest(endpoint,params){if(!STRIPE_SECRET_KEY)throw new Error('Stripe is not configured yet.');const body=new URLSearchParams();for(const [k,v] of Object.entries(params||{})){if(v!==undefined&&v!==null)body.append(k,String(v));}const r=await fetch(`https://api.stripe.com${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||'Stripe request failed.');return data;}
function stripeSignatureValid(raw,header){if(!STRIPE_WEBHOOK_SECRET||!header)return false;const parts=Object.fromEntries(header.split(',').map(p=>p.split('=',2)));const t=parts.t,v1=parts.v1;if(!t||!v1)return false;const expected=crypto.createHmac('sha256',STRIPE_WEBHOOK_SECRET).update(`${t}.${raw.toString('utf8')}`).digest('hex');return safeEqual(expected,v1);}
function userByStripeCustomer(customer){return customer?db.prepare('SELECT user_id FROM memberships WHERE stripe_customer_id=?').get(customer):null;}
function recordBillingEvent(eventId,type,userId,amountAud=0){try{db.prepare('INSERT INTO billing_events(user_id,stripe_event_id,event_type,amount_aud,created_at) VALUES(?,?,?,?,?)').run(userId||null,eventId,type,Number(amountAud||0),now());}catch{}}
function updateMembership(uid,patch){ensureMembership(uid);const allowed=['plan','status','billing_interval','stripe_customer_id','stripe_subscription_id','current_period_end'];const sets=[],vals=[];for(const k of allowed){if(Object.prototype.hasOwnProperty.call(patch,k)){sets.push(`${k}=?`);vals.push(patch[k]);}}sets.push('updated_at=?');vals.push(now(),uid);db.prepare(`UPDATE memberships SET ${sets.join(',')} WHERE user_id=?`).run(...vals);}
function revenueStats(){const totalUsers=db.prepare('SELECT COUNT(*) n FROM users').get().n;const proUsers=db.prepare("SELECT COUNT(*) n FROM memberships WHERE plan='pro' AND status IN ('active','trialing')").get().n;const freeUsers=Math.max(0,totalUsers-proUsers);const totalRevenue=db.prepare('SELECT COALESCE(SUM(amount_aud),0) n FROM billing_events').get().n;const revenue30=db.prepare('SELECT COALESCE(SUM(amount_aud),0) n FROM billing_events WHERE created_at>=?').get(new Date(Date.now()-30*86400000).toISOString()).n;const monthly=db.prepare("SELECT COUNT(*) n FROM memberships WHERE plan='pro' AND status IN ('active','trialing') AND billing_interval='month'").get().n;const yearly=db.prepare("SELECT COUNT(*) n FROM memberships WHERE plan='pro' AND status IN ('active','trialing') AND billing_interval='year'").get().n;const mrr=monthly*PRO_MONTHLY_AUD+yearly*(PRO_YEARLY_AUD/12);const conversion=totalUsers?Math.round((proUsers/totalUsers)*1000)/10:0;const recent=db.prepare('SELECT event_type,amount_aud,created_at,user_id FROM billing_events ORDER BY id DESC LIMIT 20').all();return {totalUsers,proUsers,freeUsers,totalRevenue:Number(totalRevenue),revenue30:Number(revenue30),mrr:Number(mrr.toFixed(2)),conversion,recent,stripeConnected:billingConfig().connected};}

async function handlePremium(req,res,url){
  if(url.pathname==='/premium.js'&&req.method==='GET'){const p=path.join(ROOT,'public','premium.js');res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(p).pipe(res);}
  if(url.pathname==='/premium.css'&&req.method==='GET'){const p=path.join(ROOT,'public','premium.css');res.writeHead(200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(p).pipe(res);}
  if(url.pathname==='/api/billing/webhook'&&req.method==='POST'){
    const raw=await readBody(req);if(!stripeSignatureValid(raw,req.headers['stripe-signature']))return send(res,400,{error:'Invalid Stripe signature.'});
    let event;try{event=JSON.parse(raw.toString('utf8'));}catch{return send(res,400,{error:'Invalid webhook JSON.'});}
    const o=event.data?.object||{};let uid=null;
    if(event.type==='checkout.session.completed'){
      uid=Number(o.client_reference_id||o.metadata?.user_id||0)||null;
      if(uid)updateMembership(uid,{plan:'pro',status:'active',billing_interval:o.metadata?.billing_interval||'month',stripe_customer_id:o.customer||null,stripe_subscription_id:o.subscription||null});
    }else if(event.type.startsWith('customer.subscription.')){
      const row=userByStripeCustomer(o.customer);uid=row?.user_id||null;if(uid)updateMembership(uid,{plan:event.type==='customer.subscription.deleted'?'free':'pro',status:event.type==='customer.subscription.deleted'?'canceled':(o.status||'active'),stripe_subscription_id:o.id||null,current_period_end:o.current_period_end?new Date(o.current_period_end*1000).toISOString():null});
    }else if(event.type==='invoice.paid'){
      const row=userByStripeCustomer(o.customer);uid=row?.user_id||null;recordBillingEvent(event.id,event.type,uid,Number(o.amount_paid||0)/100);
    }else if(event.type==='invoice.payment_failed'){
      const row=userByStripeCustomer(o.customer);uid=row?.user_id||null;if(uid)updateMembership(uid,{status:'past_due'});
    }
    if(event.type!=='invoice.paid')recordBillingEvent(event.id,event.type,uid,0);
    return send(res,200,{received:true});
  }

  if(!url.pathname.startsWith('/api/billing/')&&!url.pathname.startsWith('/api/admin/billing-'))return false;
  if(url.pathname.startsWith('/api/admin/')){
    const a=adminSession(req);if(!a)return send(res,401,{error:'Admin login required.'});
    if(url.pathname==='/api/admin/billing-stats'&&req.method==='GET')return send(res,200,revenueStats());
    return send(res,404,{error:'Not found.'});
  }

  const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});
  const m=ensureMembership(s.user_id);const u=usage(s.user_id);
  if(url.pathname==='/api/billing/status'&&req.method==='GET')return send(res,200,{membership:m,isPro:isPro(m),usage:u,limits:{captures_month:30,asks_day:15},billing:billingConfig()});
  if(url.pathname==='/api/billing/checkout'&&req.method==='POST'){
    const raw=await readBody(req);let b={};try{b=JSON.parse(raw.toString('utf8')||'{}');}catch{}
    if(!safeEqual(req.headers['x-csrf-token']||b._csrf,s.csrf))return send(res,403,{error:'Security token expired.'});
    const interval=b.interval==='year'?'year':'month';const price=interval==='year'?STRIPE_PRICE_PRO_YEARLY:STRIPE_PRICE_PRO_MONTHLY;if(!price)return send(res,503,{error:'That billing option is not connected to Stripe yet.'});
    const current=ensureMembership(s.user_id);const params={'mode':'subscription','line_items[0][price]':price,'line_items[0][quantity]':1,'success_url':`${PUBLIC_URL}/app?billing=success`,'cancel_url':`${PUBLIC_URL}/app?billing=cancelled`,'client_reference_id':s.user_id,'metadata[user_id]':s.user_id,'metadata[billing_interval]':interval};
    if(current.stripe_customer_id)params.customer=current.stripe_customer_id;else params.customer_email=s.email;
    const checkout=await stripeRequest('/v1/checkout/sessions',params);return send(res,200,{url:checkout.url});
  }
  if(url.pathname==='/api/billing/portal'&&req.method==='POST'){
    const raw=await readBody(req);let b={};try{b=JSON.parse(raw.toString('utf8')||'{}');}catch{}
    if(!safeEqual(req.headers['x-csrf-token']||b._csrf,s.csrf))return send(res,403,{error:'Security token expired.'});
    const current=ensureMembership(s.user_id);if(!current.stripe_customer_id)return send(res,400,{error:'No billing account is connected to this Kivo account yet.'});
    const portal=await stripeRequest('/v1/billing_portal/sessions',{customer:current.stripe_customer_id,return_url:`${PUBLIC_URL}/app`});return send(res,200,{url:portal.url});
  }
  return send(res,404,{error:'Not found.'});
}

const coreEnv={...process.env,PORT:String(CORE_PORT),KIVO_DATA_DIR:DATA,KIVO_UPLOAD_DIR:path.resolve(process.env.KIVO_UPLOAD_DIR||path.join(ROOT,'uploads'))};
const core=spawn(process.execPath,['--no-warnings',CORE_SERVER],{cwd:ROOT,env:coreEnv,stdio:['ignore','inherit','inherit']});
core.on('exit',code=>{console.log(`Kivo core exited (${code??0}); closing bootstrap.`);process.exit(code??0);});

function proxy(req,res){const options={hostname:'127.0.0.1',port:CORE_PORT,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${CORE_PORT}`}};const p=http.request(options,r=>{const headers={...r.headers};headers['cache-control']='no-store';res.writeHead(r.statusCode||500,headers);r.pipe(res);});p.on('error',()=>send(res,503,{error:'Kivo is starting. Try again in a moment.'}));req.pipe(p);}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);const handled=await handlePremium(req,res,url);if(handled!==false)return;proxy(req,res);}catch(err){console.error('Kivo bootstrap:',err);if(!res.headersSent)send(res,500,{error:'Something went wrong.'});}});
server.listen(PUBLIC_PORT,()=>console.log(`\nKivo Experience Layer: http://localhost:${PUBLIC_PORT}\nCore server: http://localhost:${CORE_PORT}\nBilling: ${billingConfig().connected?'Stripe connected':'setup required'}\n`));
