const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.KIVO_DATA_DIR || path.join(ROOT, 'data'));
const UPLOADS = path.resolve(process.env.KIVO_UPLOAD_DIR || path.join(ROOT, 'uploads'));
const PORT = Number(process.env.PORT || 8288);
const ADMIN_EMAIL = 'owner@kivo.local';
const ADMIN_PASSWORD = 'KivoAdmin2026';
const SECURE_COOKIES = String(process.env.SECURE_COOKIES || 'false').toLowerCase() === 'true';
const UPDATE_REPO = process.env.KIVO_UPDATE_REPO || 'kumaylalrahal2009-debug/Kivo-Updates';
const LOCAL_DESKTOP = String(process.env.KIVO_LOCAL_DESKTOP || 'false').toLowerCase() === 'true';
const VERSION_FILE = path.join(ROOT, 'version.json');
const UPDATE_DIR = path.join(ROOT, 'updates');
fs.mkdirSync(UPDATE_DIR, {recursive:true});

fs.mkdirSync(DATA, {recursive:true});
fs.mkdirSync(UPLOADS, {recursive:true});

const db = new DatabaseSync(path.join(DATA, 'kivo.db'));
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  due_date TEXT,
  amount REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  avoidable INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_due ON items(user_id,due_date);
CREATE TABLE IF NOT EXISTS item_due_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  previous_due_date TEXT,
  new_due_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_due_history ON item_due_history(item_id,user_id,id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON analytics_events(event_type, created_at);
`);

function ensureUserColumn(name, declaration){
  const cols=db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
  if(!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${declaration}`);
}
ensureUserColumn('last_seen_at', 'TEXT');

function ensureColumn(name, declaration){
  const cols = db.prepare('PRAGMA table_info(items)').all().map(x => x.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${declaration}`);
}
ensureColumn('due_time', 'TEXT');
ensureColumn('recurrence', 'TEXT');
ensureColumn('recurrence_interval', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('recurrence_day', 'INTEGER');
ensureColumn('recurrence_weekday', 'INTEGER');
ensureColumn('reminder_days', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('parser_confidence', 'REAL NOT NULL DEFAULT 0');
ensureColumn('parsed_at', 'TEXT');

const mime = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'
};
const monthMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const weekdayMap = {sun:0,sunday:0,mon:1,monday:1,tue:2,tues:2,tuesday:2,wed:3,wednesday:3,thu:4,thur:4,thurs:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};

function now(){ return new Date().toISOString(); }
function random(n=32){ return crypto.randomBytes(n).toString('base64url'); }
function hash(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
function pbkdf(password,salt){ return crypto.pbkdf2Sync(password,salt,120000,32,'sha256').toString('hex'); }
function localISO(d = new Date()){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function localDate(iso){
  const [y,m,d] = String(iso).split('-').map(Number);
  return new Date(y, (m||1)-1, d||1, 12, 0, 0, 0);
}
function daysBetween(fromISO,toISO){
  const ms = localDate(toISO) - localDate(fromISO);
  return Math.round(ms / 86400000);
}
function daysInMonth(year, month0){ return new Date(year, month0+1, 0).getDate(); }
function ordinal(n){
  const mod100=n%100; if(mod100>=11&&mod100<=13)return `${n}th`;
  return `${n}${n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'}`;
}
function parseCookies(req){
  const out={}; for(const part of (req.headers.cookie||'').split(';')){ const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1)); } return out;
}
function securityHeaders(){ return {
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}; }
function json(res,status,obj,extra={}){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...securityHeaders(),...extra}); res.end(JSON.stringify(obj)); }
function setSessionCookie(res,token){
  let c=`kivo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*30}`;
  if(SECURE_COOKIES) c += '; Secure';
  res.setHeader('Set-Cookie',c);
}
function clearSessionCookie(res){ let c='kivo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'; if(SECURE_COOKIES)c+='; Secure'; res.setHeader('Set-Cookie',c); }
function sessionFor(req){
  const tok=parseCookies(req).kivo_session; if(!tok)return null;
  return db.prepare(`SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(tok),now()) || null;
}
function trackEvent(userId,eventType,metadata={}){
  try{db.prepare('INSERT INTO analytics_events(user_id,event_type,metadata,created_at) VALUES(?,?,?,?)').run(userId||null,eventType,JSON.stringify(metadata||{}),now());}catch{}
}
function touchUser(userId){ try{db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(now(),userId);}catch{} }
function requireAuth(req,res){ const s=sessionFor(req); if(!s){json(res,401,{error:'Please log in.'}); return null;} touchUser(s.user_id); return s; }
function adminSessionFor(req){
  const tok=parseCookies(req).kivo_admin; if(!tok)return null;
  return db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(tok),now()) || null;
}
function setAdminCookie(res,token){
  let c=`kivo_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*12}`;
  if(SECURE_COOKIES)c+='; Secure'; res.setHeader('Set-Cookie',c);
}
function clearAdminCookie(res){ let c='kivo_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'; if(SECURE_COOKIES)c+='; Secure'; res.setHeader('Set-Cookie',c); }
function requireAdmin(req,res){ const a=adminSessionFor(req); if(!a){json(res,401,{error:'Admin login required.'});return null;} return a; }
function requireAdminCsrf(req,res,a,body){
  const token=req.headers['x-admin-csrf'] || body?._csrf; const x=Buffer.from(String(token||'')), y=Buffer.from(String(a.csrf||''));
  if(!token || x.length!==y.length || !crypto.timingSafeEqual(x,y)){json(res,403,{error:'Admin security token expired.'});return false;} return true;
}
function isoDaysAgo(days){ return new Date(Date.now()-days*86400000).toISOString(); }
function adminStats(){
  const today=localISO(); const startToday=`${today}T00:00:00.000Z`; const day7=isoDaysAgo(7), day30=isoDaysAgo(30);
  const totalUsers=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const todayUsers=db.prepare('SELECT COUNT(*) n FROM users WHERE created_at>=?').get(startToday).n;
  const weekUsers=db.prepare('SELECT COUNT(*) n FROM users WHERE created_at>=?').get(day7).n;
  const monthUsers=db.prepare('SELECT COUNT(*) n FROM users WHERE created_at>=?').get(day30).n;
  const activeToday=db.prepare('SELECT COUNT(*) n FROM users WHERE last_seen_at>=?').get(isoDaysAgo(1)).n;
  const active7=db.prepare('SELECT COUNT(*) n FROM users WHERE last_seen_at>=?').get(day7).n;
  const totalItems=db.prepare('SELECT COUNT(*) n FROM items').get().n;
  const openItems=db.prepare("SELECT COUNT(*) n FROM items WHERE status='open'").get().n;
  const completed=db.prepare("SELECT COUNT(*) n FROM items WHERE status='done'").get().n;
  const cancelled=db.prepare("SELECT COUNT(*) n FROM items WHERE status='cancelled'").get().n;
  const moneyItems=db.prepare("SELECT COUNT(*) n FROM items WHERE category='money'").get().n;
  const recurring=db.prepare('SELECT COUNT(*) n FROM items WHERE recurrence IS NOT NULL').get().n;
  const reminderConfigured=db.prepare('SELECT COUNT(*) n FROM items WHERE reminder_days>0 AND due_date IS NOT NULL').get().n;
  const captures=db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE event_type='capture'").get().n;
  const asks=db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE event_type='ask'").get().n;
  const signups=db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) count FROM users WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY day`).all(day30);
  const recentUsers=db.prepare(`SELECT id,name,email,created_at,last_seen_at,(SELECT COUNT(*) FROM items i WHERE i.user_id=users.id) item_count FROM users ORDER BY created_at DESC LIMIT 20`).all();
  const completionRate=totalItems?Math.round(((completed+cancelled)/totalItems)*1000)/10:0;
  return {totalUsers,todayUsers,weekUsers,monthUsers,activeToday,active7,totalItems,openItems,completed,cancelled,moneyItems,recurring,reminderConfigured,captures,asks,completionRate,signups,recentUsers};
}
function requireCsrf(req,res,s,body){
  const token=req.headers['x-csrf-token'] || body?._csrf;
  const a=Buffer.from(String(token||'')), b=Buffer.from(String(s.csrf||''));
  if(!token || a.length!==b.length || !crypto.timingSafeEqual(a,b)){json(res,403,{error:'Security token expired. Refresh and try again.'});return false;}
  return true;
}
function readBody(req,max=7*1024*1024){ return new Promise((resolve,reject)=>{ let chunks=[],size=0; req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('too_large'));req.destroy();return;}chunks.push(c)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);}); }
async function readJson(req){ const b=await readBody(req); if(!b.length)return {}; try{return JSON.parse(b.toString('utf8'))}catch{throw new Error('bad_json')} }

function nextMonthly(day, base = new Date()){
  let y=base.getFullYear(), m=base.getMonth();
  const candidate = (yy,mm) => new Date(yy,mm,Math.min(day,daysInMonth(yy,mm)),12);
  let d=candidate(y,m);
  const today = new Date(base.getFullYear(),base.getMonth(),base.getDate(),12);
  if(d < today){ m += 1; if(m>11){m=0;y+=1;} d=candidate(y,m); }
  return localISO(d);
}
function nextWeekday(weekday, base = new Date()){
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate(),12);
  let delta=(weekday-d.getDay()+7)%7;
  d.setDate(d.getDate()+delta);
  return localISO(d);
}
function nextYearly(month0, day, base = new Date()){
  let y=base.getFullYear();
  let d=new Date(y,month0,Math.min(day,daysInMonth(y,month0)),12);
  const today=new Date(base.getFullYear(),base.getMonth(),base.getDate(),12);
  if(d<today){ y++; d=new Date(y,month0,Math.min(day,daysInMonth(y,month0)),12); }
  return localISO(d);
}
function addRecurrence(iso, recurrence, interval=1, recurrenceDay=null, recurrenceWeekday=null){
  const d=localDate(iso);
  if(recurrence==='daily') d.setDate(d.getDate()+Math.max(1,interval));
  else if(recurrence==='weekly') d.setDate(d.getDate()+7*Math.max(1,interval));
  else if(recurrence==='fortnightly') d.setDate(d.getDate()+14*Math.max(1,interval));
  else if(recurrence==='monthly'){
    const day=recurrenceDay || d.getDate();
    const targetMonth=d.getMonth()+Math.max(1,interval);
    const y=d.getFullYear()+Math.floor(targetMonth/12), m=((targetMonth%12)+12)%12;
    d.setFullYear(y,m,Math.min(day,daysInMonth(y,m)));
  } else if(recurrence==='yearly') d.setFullYear(d.getFullYear()+Math.max(1,interval));
  if(recurrence==='weekly' && recurrenceWeekday!=null){
    while(d.getDay()!==recurrenceWeekday) d.setDate(d.getDate()+1);
  }
  return localISO(d);
}

function subtractRecurrence(iso, recurrence, interval=1, recurrenceDay=null, recurrenceWeekday=null){
  const d=localDate(iso);
  const n=Math.max(1,Number(interval)||1);
  if(recurrence==='daily') d.setDate(d.getDate()-n);
  else if(recurrence==='weekly') d.setDate(d.getDate()-7*n);
  else if(recurrence==='fortnightly') d.setDate(d.getDate()-14*n);
  else if(recurrence==='monthly'){
    const day=recurrenceDay || d.getDate();
    const targetMonth=d.getMonth()-n;
    const y=d.getFullYear()+Math.floor(targetMonth/12), m=((targetMonth%12)+12)%12;
    d.setFullYear(y,m,Math.min(day,daysInMonth(y,m)));
  } else if(recurrence==='yearly') d.setFullYear(d.getFullYear()-n);
  if(recurrence==='weekly' && recurrenceWeekday!=null){
    while(d.getDay()!==recurrenceWeekday) d.setDate(d.getDate()-1);
  }
  return localISO(d);
}

function parseTime(text){
  const t=String(text||'').toLowerCase();
  let m=t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  if(m){ let h=Number(m[1]),min=Number(m[2]||0); if(m[3]==='pm'&&h!==12)h+=12;if(m[3]==='am'&&h===12)h=0;return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }
  m=t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m?`${String(Number(m[1])).padStart(2,'0')}:${m[2]}`:null;
}
function parseExplicitDate(text){
  const t=String(text||'').toLowerCase();
  const today=new Date();
  if(/\bday after tomorrow\b/.test(t)){const d=new Date(today);d.setDate(d.getDate()+2);return localISO(d)}
  if(/\btomorrow\b/.test(t)){const d=new Date(today);d.setDate(d.getDate()+1);return localISO(d)}
  if(/\btoday\b/.test(t))return localISO(today);
  const nextDay=t.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(nextDay){let target=weekdayMap[nextDay[1]],d=new Date(today);let delta=(target-d.getDay()+7)%7;if(delta===0)delta=7;d.setDate(d.getDate()+delta);return localISO(d);}
  let m=t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if(m){let y=m[3]?Number(m[3]):today.getFullYear();if(y<100)y+=2000;let d=new Date(y,Number(m[2])-1,Number(m[1]),12);if(!m[3]&&d<new Date(today.getFullYear(),today.getMonth(),today.getDate(),12))d.setFullYear(y+1);if(!isNaN(d))return localISO(d)}
  m=t.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if(m){const mo=monthMap[m[1].slice(0,3)],day=Number(m[2]),year=Number(m[3]||today.getFullYear());let d=new Date(year,mo,day,12);if(!m[3]&&d<new Date(today.getFullYear(),today.getMonth(),today.getDate(),12))d.setFullYear(year+1);if(!isNaN(d))return localISO(d)}
  m=t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/);
  if(m){const mo=monthMap[m[2].slice(0,3)],day=Number(m[1]),year=Number(m[3]||today.getFullYear());let d=new Date(year,mo,day,12);if(!m[3]&&d<new Date(today.getFullYear(),today.getMonth(),today.getDate(),12))d.setFullYear(year+1);if(!isNaN(d))return localISO(d)}
  return null;
}
function parseRecurrence(text){
  const t=String(text||'').toLowerCase();
  let recurrence=null, interval=1, day=null, weekday=null;
  if(/\b(daily|every day|each day)\b/.test(t)) recurrence='daily';
  else if(/\b(fortnightly|every fortnight|every two weeks|every 2 weeks|biweekly)\b/.test(t)) recurrence='fortnightly';
  else if(/\b(weekly|every week|each week)\b/.test(t)) recurrence='weekly';
  else if(/\b(monthly|every month|each month|per month|a month)\b/.test(t)) recurrence='monthly';
  else if(/\b(yearly|annually|annual|every year|each year|per year)\b/.test(t)) recurrence='yearly';
  const dayMatch=t.match(/\b(?:every|on|each)?\s*(?:the\s*)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(?:the\s+)?month)?/);
  if(dayMatch && Number(dayMatch[1])>=1 && Number(dayMatch[1])<=31 && (/month|monthly/.test(t) || /every\s+(?:the\s*)?\d{1,2}(?:st|nd|rd|th)/.test(t))){ recurrence=recurrence||'monthly'; day=Number(dayMatch[1]); }
  const weekdayMatch=t.match(/\b(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(weekdayMatch){recurrence='weekly';weekday=weekdayMap[weekdayMatch[1]];}
  const everyN=t.match(/\bevery\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/);
  if(everyN){interval=Math.max(1,Number(everyN[1]));const unit=everyN[2];recurrence=unit.startsWith('day')?'daily':unit.startsWith('week')?'weekly':unit.startsWith('month')?'monthly':'yearly';}
  return {recurrence,recurrence_interval:interval,recurrence_day:day,recurrence_weekday:weekday};
}
function parseReminderDays(text, category, recurrence){
  const t=String(text||'').toLowerCase();
  if(/\b(remind|alert|notify)\b/.test(t)){
    if(/\b(same day|on the day|that day)\b/.test(t))return 0;
    let m=t.match(/\b(\d+)\s+days?\s+before\b/); if(m)return Math.min(30,Number(m[1]));
    m=t.match(/\b(\d+)\s+weeks?\s+before\b/); if(m)return Math.min(30,Number(m[1])*7);
    if(/\bday before\b/.test(t))return 1;
    if(/\bweek before\b/.test(t))return 7;
  }
  if(category==='money' || category==='deadline' || category==='event' || recurrence) return 1;
  return 0;
}
function moneyContext(text){
  return /\b(subscription|trial|monthly|weekly|fortnightly|fortnight|yearly|annually|annual|renewal|renew|charge|charged|payment|bill|fee|cost|pay|netflix|spotify|disney|prime|icloud|gym|membership|phone|internet|insurance|rent|kayo|binge|stan|youtube|apple|google|microsoft|adobe|canva|dropbox|hulu|paramount|crunchyroll)\b/.test(String(text||'').toLowerCase());
}
function parseAmount(text){
  const t=String(text||'').toLowerCase();
  let m=t.match(/(?:a\$|\$|aud\s*)(\d{1,6}(?:\.\d{1,2})?)/i);
  if(m)return Number(m[1]);
  m=t.match(/\b(\d{1,6}(?:\.\d{1,2})?)\s*(?:aud|dollars?|bucks?)\b/i);
  if(m)return Number(m[1]);
  if(!moneyContext(t))return null;
  const decimal=[...t.matchAll(/\b(\d{1,6}\.\d{1,2})\b/g)].map(x=>Number(x[1]));
  if(decimal.length)return decimal[0];
  const months='jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const candidates=[...t.matchAll(/\b(\d{1,4})\b/g)].map(x=>({n:Number(x[1]),index:x.index||0,len:x[1].length})).filter(x=>{
    const before=t.slice(Math.max(0,x.index-14),x.index), after=t.slice(x.index+x.len,x.index+x.len+18);
    if(/^(st|nd|rd|th)\b/.test(after))return false;
    if(new RegExp(`(?:${months})\s*$`).test(before))return false;
    if(/^\s*[:\/-]\s*\d/.test(after) || /\d\s*[:\/-]\s*$/.test(before))return false;
    if(x.n>=1900&&x.n<=2100)return false;
    return x.n>0 && x.n<10000;
  });
  if(!candidates.length)return null;
  const freqCandidate=candidates.find(x=>/\b(monthly|weekly|fortnightly|yearly|annually|annual|per\s+(?:month|week|year)|every)\b/.test(t.slice(x.index+x.len,x.index+x.len+24)));
  if(freqCandidate)return freqCandidate.n;
  if(candidates.length===1)return candidates[0].n;
  return candidates[0].n;
}
function cleanTitle(text, category, fileName='', amount=null){
  if(fileName && category==='document') return fileName;
  let s=String(text||'').replace(/\s+/g,' ').trim();
  if(!s)return category==='money'?'Upcoming payment':category==='event'?'Appointment or booking':category==='deadline'?'Deadline':'Something to remember';
  s=s.replace(/(?:a\$|\$|aud\s*)\d+(?:\.\d{1,2})?/ig,' ')
     .replace(/\b\d+(?:\.\d{1,2})?\s*(?:aud|dollars?|bucks?)\b/ig,' ')
     .replace(/\b\d+\.\d{1,2}\b/g,' ')
     .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/ig,' ')
     .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+\d{4})?\b/ig,' ')
     .replace(/\b(?:today|tomorrow|tonight|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/ig,' ')
     .replace(/\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/ig,' ')
     .replace(/\b(?:monthly|weekly|fortnightly|biweekly|yearly|annually|annual|daily)\b/ig,' ')
     .replace(/\b(?:every|each)\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?|fortnight)\b/ig,' ')
     .replace(/\b(?:every|each)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig,' ')
     .replace(/\b(?:every|on|each)?\s*(?:the\s*)?\d{1,2}(?:st|nd|rd|th)(?:\s+of\s+(?:the\s+)?month)?\b/ig,' ')
     .replace(/\b(?:remind|alert|notify)\s+me\b.*$/ig,' ')
     .replace(/\b(?:subscription|renewal|payment|bill|charged|charge|costs?|is|my|the|a|an|of|on|at|per|for|month|by)\b/ig,' ')
     .replace(/\s+/g,' ').trim();
  if(amount!=null){
    const amountText=String(amount).replace('.', '\\.');
    s=s.replace(new RegExp(`\\b${amountText}\\b`,'g'),' ').replace(/\s+/g,' ').trim();
  }
  if(category==='event'){
    const m=String(text).match(/\b(dentist|doctor|meeting|appointment|booking|reservation|physio|haircut)\b/i);
    if(m)s=m[1];
  }
  if(!s || s.length>42){
    return category==='money'?'Upcoming payment':category==='event'?'Appointment or booking':category==='deadline'?'Deadline detected':'Something to remember';
  }
  return s.split(' ').slice(0,5).map(w=>w? w[0].toUpperCase()+w.slice(1):w).join(' ');
}
function understand(text,fileName=''){
  const raw=String(text||''); const lower=raw.toLowerCase();
  const recurrenceInfo=parseRecurrence(raw);
  let category='task', avoidable=0, confidence=.5;
  const amount=parseAmount(raw);
  const strongMoney=/subscription|free trial|\btrial\b|renew|charged|charge|bill|payment|membership|monthly|fortnightly|annual|yearly/.test(lower) || amount!=null;
  if(strongMoney && (moneyContext(raw) || amount!=null)){ category='money'; confidence=.92; avoidable=/\btrial\b|optional|cancel/.test(lower)?1:0; }
  else if(/appointment|booking|dentist|doctor|meeting|reservation|physio|haircut/.test(lower)){category='event';confidence=.9;}
  else if(/return|deadline|\bdue\b|expires|expiry|warranty/.test(lower)){category='deadline';confidence=.9;}
  else if(/receipt|document|statement|invoice|pdf/.test(lower)||fileName){category='document';confidence=.82;}
  const explicit=parseExplicitDate(raw);
  let due=explicit;
  if(!due && recurrenceInfo.recurrence==='monthly' && recurrenceInfo.recurrence_day) due=nextMonthly(recurrenceInfo.recurrence_day);
  if(!due && recurrenceInfo.recurrence==='weekly' && recurrenceInfo.recurrence_weekday!=null) due=nextWeekday(recurrenceInfo.recurrence_weekday);
  if(!due && recurrenceInfo.recurrence==='yearly'){
    const md=lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})/);
    if(md)due=nextYearly(monthMap[md[1].slice(0,3)],Number(md[2]));
  }
  const reminderDays=parseReminderDays(raw,category,recurrenceInfo.recurrence);
  const title=cleanTitle(raw,category,fileName,amount);
  return {
    title, category, due_date:due, due_time:parseTime(raw), amount,
    notes:raw.replace(/\s+/g,' ').trim().slice(0,800), avoidable,
    recurrence:recurrenceInfo.recurrence, recurrence_interval:recurrenceInfo.recurrence_interval,
    recurrence_day:recurrenceInfo.recurrence_day, recurrence_weekday:recurrenceInfo.recurrence_weekday,
    reminder_days:reminderDays, parser_confidence:confidence
  };
}

function saveItem(uid,item){
  const id=crypto.randomUUID();
  db.prepare(`INSERT INTO items(id,user_id,title,category,due_date,due_time,amount,notes,status,avoidable,file_name,file_path,recurrence,recurrence_interval,recurrence_day,recurrence_weekday,reminder_days,parser_confidence,parsed_at,created_at)
    VALUES(?,?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,uid,item.title,item.category,item.due_date||null,item.due_time||null,item.amount??null,item.notes||'',item.avoidable?1:0,item.file_name||null,item.file_path||null,item.recurrence||null,item.recurrence_interval||1,item.recurrence_day??null,item.recurrence_weekday??null,item.reminder_days??0,item.parser_confidence??0,now(),now());
  return id;
}
function advanceRecurringItem(item){
  if(!item.recurrence || !item.due_date)return false;
  let next=item.due_date;
  const today=localISO();
  let guard=0;
  while(next<today && guard<60){next=addRecurrence(next,item.recurrence,item.recurrence_interval||1,item.recurrence_day,item.recurrence_weekday);guard++;}
  if(next!==item.due_date){db.prepare('UPDATE items SET due_date=?, status=\'open\' WHERE id=?').run(next,item.id);return true;}
  return false;
}
function refreshRecurringItems(uid){
  const rows=db.prepare("SELECT * FROM items WHERE user_id=? AND status='open' AND recurrence IS NOT NULL AND due_date IS NOT NULL").all(uid);
  for(const x of rows)advanceRecurringItem(x);
}
function getItems(uid){
  refreshRecurringItems(uid);
  return db.prepare(`SELECT items.*,
    (SELECT COUNT(*) FROM item_due_history h WHERE h.item_id=items.id AND h.user_id=items.user_id) AS undo_count
    FROM items WHERE user_id=?
    ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END,
    CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at DESC`).all(uid);
}
function reprocessLegacyItems(){
  const rows=db.prepare(`SELECT * FROM items WHERE (title='Something to remember' OR parser_confidence=0) AND notes IS NOT NULL AND LENGTH(TRIM(notes))>0`).all();
  const stmt=db.prepare(`UPDATE items SET title=?,category=?,due_date=COALESCE(?,due_date),due_time=COALESCE(?,due_time),amount=COALESCE(?,amount),avoidable=?,recurrence=COALESCE(?,recurrence),recurrence_interval=?,recurrence_day=COALESCE(?,recurrence_day),recurrence_weekday=COALESCE(?,recurrence_weekday),reminder_days=?,parser_confidence=?,parsed_at=? WHERE id=?`);
  for(const row of rows){
    const p=understand(row.notes,row.file_name||'');
    if(p.parser_confidence>.7 && (p.category!==row.category || p.amount!=null || p.recurrence || p.due_date)){
      stmt.run(p.title,p.category,p.due_date,p.due_time,p.amount,p.avoidable,p.recurrence,p.recurrence_interval||1,p.recurrence_day,p.recurrence_weekday,p.reminder_days,p.parser_confidence,now(),row.id);
    }
  }
}
reprocessLegacyItems();

function reminderRows(uid){
  const today=localISO();
  return getItems(uid).filter(x=>x.status==='open'&&x.due_date).map(x=>{
    const days=daysBetween(today,x.due_date);
    let urgency=null;
    if(days<0)urgency='overdue'; else if(days===0)urgency='today'; else if(days===1)urgency='tomorrow'; else if(days<=Number(x.reminder_days||0))urgency='soon';
    return {...x,days_until:days,urgency};
  }).filter(x=>x.urgency).sort((a,b)=>a.days_until-b.days_until);
}


function localVersion(){
  try{
    const v=JSON.parse(fs.readFileSync(VERSION_FILE,'utf8'));
    return String(v.version||'0.0.0').replace(/^v/,'');
  }catch{return '0.0.0'}
}
function versionParts(v){
  return String(v||'0.0.0').replace(/^v/,'').split('.').map(x=>Number(String(x).match(/\d+/)?.[0]||0));
}
function compareVersions(a,b){
  const A=versionParts(a),B=versionParts(b);
  for(let i=0;i<Math.max(A.length,B.length,3);i++){
    const x=A[i]||0,y=B[i]||0;
    if(x>y)return 1;if(x<y)return -1;
  }
  return 0;
}
async function latestGithubRelease(){
  const response=await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,{
    headers:{
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2026-03-10',
      'User-Agent':'Kivo-Updater'
    }
  });
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`GitHub update check failed (${response.status}).`);
  return await response.json();
}
function releaseInfo(release){
  if(!release)return {available:false,reason:'no_release',currentVersion:localVersion()};
  const currentVersion=localVersion();
  const latestVersion=String(release.tag_name||'0.0.0').replace(/^v/,'');
  const asset=(release.assets||[]).find(a=>String(a.name||'').toLowerCase()==='kivo-update.zip');
  return {
    available:!!asset && compareVersions(latestVersion,currentVersion)>0,
    currentVersion,
    latestVersion,
    tag:release.tag_name||latestVersion,
    name:release.name||release.tag_name||latestVersion,
    notes:release.body||'',
    publishedAt:release.published_at||null,
    assetUrl:asset?.browser_download_url||null,
    assetSize:asset?.size||null
  };
}
async function downloadFile(url,destination){
  const response=await fetch(url,{
    redirect:'follow',
    headers:{'Accept':'application/octet-stream','User-Agent':'Kivo-Updater'}
  });
  if(!response.ok)throw new Error(`Update download failed (${response.status}).`);
  const buf=Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination,buf);
  return buf.length;
}

async function api(req,res,url){
  if(req.method==='POST' && url.pathname==='/api/admin/login'){
    const b=await readJson(req); const email=String(b.email||'').trim().toLowerCase(), pw=String(b.password||'');
    if(email!==ADMIN_EMAIL || pw!==ADMIN_PASSWORD)return json(res,401,{error:'Admin email or password is incorrect.'});
    const token=random(32), csrf=random(24); db.prepare('INSERT INTO admin_sessions(token_hash,csrf,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),csrf,new Date(Date.now()+12*3600000).toISOString(),now()); setAdminCookie(res,token); return json(res,200,{ok:true,csrf,email:ADMIN_EMAIL});
  }
  if(req.method==='GET' && url.pathname==='/api/admin/me'){ const a=adminSessionFor(req); return json(res,200,a?{loggedIn:true,csrf:a.csrf,email:ADMIN_EMAIL}:{loggedIn:false}); }
  if(req.method==='POST' && url.pathname==='/api/admin/logout'){ const a=requireAdmin(req,res); if(!a)return; const b=await readJson(req); if(!requireAdminCsrf(req,res,a,b))return; const tok=parseCookies(req).kivo_admin; db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(tok)); clearAdminCookie(res); return json(res,200,{ok:true}); }
  if(req.method==='GET' && url.pathname==='/api/admin/stats'){ const a=requireAdmin(req,res); if(!a)return; return json(res,200,adminStats()); }
  if(req.method==='POST' && url.pathname==='/api/register'){
    const b=await readJson(req); const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');
    if(name.length<1||!email.includes('@')||pw.length<8)return json(res,400,{error:'Use your name, a valid email, and a password of at least 8 characters.'});
    const salt=random(18),ph=pbkdf(pw,salt); try{db.prepare(`INSERT INTO users(name,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)`).run(name,email,ph,salt,now());}catch(e){return json(res,409,{error:'That email is already registered.'});}
    const u=db.prepare('SELECT id,name,email FROM users WHERE email=?').get(email); const token=random(32),csrf=random(24); db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').run(hash(token),u.id,csrf,new Date(Date.now()+30*864e5).toISOString(),now()); setSessionCookie(res,token); touchUser(u.id); trackEvent(u.id,'signup'); return json(res,201,{user:u,csrf});
  }
  if(req.method==='POST' && url.pathname==='/api/login'){
    const b=await readJson(req); const email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||''); const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!u || pbkdf(pw,u.password_salt)!==u.password_hash)return json(res,401,{error:'Email or password is incorrect.'});
    const token=random(32),csrf=random(24); db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').run(hash(token),u.id,csrf,new Date(Date.now()+30*864e5).toISOString(),now()); setSessionCookie(res,token); touchUser(u.id); trackEvent(u.id,'login'); return json(res,200,{user:{id:u.id,name:u.name,email:u.email},csrf});
  }
  
  if(req.method==='GET' && url.pathname==='/api/update/check'){
    const sess=requireAuth(req,res);if(!sess)return;
    try{
      const release=await latestGithubRelease();
      return json(res,200,releaseInfo(release));
    }catch(err){
      return json(res,502,{error:err.message,currentVersion:localVersion()});
    }
  }
  if(req.method==='POST' && url.pathname==='/api/update/install'){
    const sess=requireAuth(req,res);if(!sess)return;
    const b=await readJson(req);if(!requireCsrf(req,res,sess,b))return;
    if(!LOCAL_DESKTOP)return json(res,403,{error:'Self-updates are only enabled in the local desktop build.'});
    try{
      const release=await latestGithubRelease();
      const info=releaseInfo(release);
      if(!info.available)return json(res,400,{error:'There is no newer Kivo release available.'});
      const zipPath=path.join(UPDATE_DIR,'Kivo-update.zip');
      await downloadFile(info.assetUrl,zipPath);
      const script=path.join(ROOT,'apply-update.ps1');
      if(!fs.existsSync(script))return json(res,500,{error:'The updater script is missing.'});
      const child=spawn('powershell.exe',[
        '-NoProfile','-ExecutionPolicy','Bypass','-File',script,
        '-Zip',zipPath,
        '-AppDir',ROOT,
        '-ServerPid',String(process.pid)
      ],{detached:true,stdio:'ignore',windowsHide:true});
      child.unref();
      json(res,200,{ok:true,version:info.latestVersion,message:'Kivo is restarting to install the update.'});
      setTimeout(()=>process.exit(0),900);
      return;
    }catch(err){
      return json(res,500,{error:err.message});
    }
  }
  
  if(req.method==='GET' && url.pathname==='/api/me'){ const s=sessionFor(req); return json(res,200,s?{loggedIn:true,user:{id:s.user_id,name:s.name,email:s.email},csrf:s.csrf}:{loggedIn:false}); }
  if(req.method==='POST' && url.pathname==='/api/logout'){ const s=requireAuth(req,res); if(!s)return; const b=await readJson(req); if(!requireCsrf(req,res,s,b))return; const tok=parseCookies(req).kivo_session; db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(tok)); clearSessionCookie(res); return json(res,200,{ok:true}); }
  if(req.method==='GET' && url.pathname==='/api/items'){ const s=requireAuth(req,res); if(!s)return; return json(res,200,{items:getItems(s.user_id)}); }
  if(req.method==='GET' && url.pathname==='/api/reminders'){ const s=requireAuth(req,res); if(!s)return; return json(res,200,{reminders:reminderRows(s.user_id),today:localISO()}); }
  if(req.method==='POST' && url.pathname==='/api/items'){
    const s=requireAuth(req,res); if(!s)return; const b=await readJson(req); if(!requireCsrf(req,res,s,b))return;
    if(!String(b.title||'').trim())return json(res,400,{error:'A title is required.'});
    const recurrence=['daily','weekly','fortnightly','monthly','yearly'].includes(b.recurrence)?b.recurrence:null;
    const due=b.due_date||null;
    const item={title:String(b.title).trim(),category:['task','deadline','event','money','document'].includes(b.category)?b.category:'task',due_date:due,due_time:b.due_time||null,amount:b.amount===''||b.amount==null?null:Number(b.amount),notes:String(b.notes||'').slice(0,800),avoidable:!!b.avoidable,recurrence,recurrence_interval:1,recurrence_day:recurrence==='monthly'&&due?localDate(due).getDate():null,recurrence_weekday:recurrence==='weekly'&&due?localDate(due).getDay():null,reminder_days:Number.isFinite(Number(b.reminder_days))?Math.max(0,Math.min(30,Number(b.reminder_days))):((b.category==='money'||b.category==='deadline'||b.category==='event')?1:0),parser_confidence:1};
    const id=saveItem(s.user_id,item); trackEvent(s.user_id,'item_created',{category:item.category}); return json(res,201,{id});
  }
  if(req.method==='POST' && url.pathname==='/api/capture'){
    const s=requireAuth(req,res); if(!s)return; const b=await readJson(req); if(!requireCsrf(req,res,s,b))return;
    const text=String(b.text||'').trim(); const file=b.file||null; if(!text&&!file)return json(res,400,{error:'Paste some text or choose a file.'}); let fileName='',filePath='';
    if(file){
      fileName=String(file.name||'file').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120); const data=String(file.data||''); const match=data.match(/^data:([^;]+);base64,(.+)$/);
      if(match){const buf=Buffer.from(match[2],'base64'); if(buf.length>5*1024*1024)return json(res,413,{error:'Files must be 5 MB or smaller.'}); const userDir=path.join(UPLOADS,String(s.user_id));fs.mkdirSync(userDir,{recursive:true}); const disk=`${crypto.randomUUID()}_${fileName}`;filePath=path.join(userDir,disk);fs.writeFileSync(filePath,buf);}
    }
    let combined=text; if(file?.text)combined += '\n'+String(file.text).slice(0,20000);
    const item=understand(combined,fileName); item.file_name=fileName||null; item.file_path=filePath||null; const id=saveItem(s.user_id,item); trackEvent(s.user_id,'capture',{category:item.category,recurrence:item.recurrence||null}); return json(res,201,{id,item});
  }
  const statusMatch=url.pathname.match(/^\/api\/items\/([^/]+)\/status$/);
  if(req.method==='POST'&&statusMatch){
    const s=requireAuth(req,res);if(!s)return;const b=await readJson(req);if(!requireCsrf(req,res,s,b))return;const status=['open','done','cancelled'].includes(b.status)?b.status:'done';
    const item=db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(statusMatch[1],s.user_id); if(!item)return json(res,404,{error:'Item not found.'});
    if(status==='done' && item.recurrence && item.due_date){
      const next=addRecurrence(item.due_date,item.recurrence,item.recurrence_interval||1,item.recurrence_day,item.recurrence_weekday);
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('INSERT INTO item_due_history(item_id,user_id,previous_due_date,new_due_date,created_at) VALUES(?,?,?,?,?)').run(item.id,s.user_id,item.due_date,next,now());
        db.prepare("UPDATE items SET due_date=?, status='open' WHERE id=? AND user_id=?").run(next,item.id,s.user_id);
        db.exec('COMMIT');
      }catch(err){db.exec('ROLLBACK');throw err;}
      trackEvent(s.user_id,'recurring_paid',{item_id:item.id,previous_due_date:item.due_date,next_due_date:next});
      return json(res,200,{ok:true,next_due_date:next,previous_due_date:item.due_date,recurring:true});
    }
    db.prepare('UPDATE items SET status=? WHERE id=? AND user_id=?').run(status,statusMatch[1],s.user_id);trackEvent(s.user_id,'item_status',{status});return json(res,200,{ok:true});
  }
  const undoMatch=url.pathname.match(/^\/api\/items\/([^/]+)\/undo-payment$/);
  if(req.method==='POST'&&undoMatch){
    const sess=requireAuth(req,res);if(!sess)return;const b=await readJson(req);if(!requireCsrf(req,res,sess,b))return;
    const item=db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(undoMatch[1],sess.user_id);
    if(!item)return json(res,404,{error:'Item not found.'});
    const h=db.prepare('SELECT * FROM item_due_history WHERE item_id=? AND user_id=? ORDER BY id DESC LIMIT 1').get(item.id,sess.user_id);
    let restored=null;
    if(h){
      restored=h.previous_due_date;
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare("UPDATE items SET due_date=?, status='open' WHERE id=? AND user_id=?").run(restored,item.id,sess.user_id);
        db.prepare('DELETE FROM item_due_history WHERE id=?').run(h.id);
        db.exec('COMMIT');
      }catch(err){db.exec('ROLLBACK');throw err;}
    }else if(item.recurrence && item.due_date){
      restored=subtractRecurrence(item.due_date,item.recurrence,item.recurrence_interval||1,item.recurrence_day,item.recurrence_weekday);
      db.prepare("UPDATE items SET due_date=?, status='open' WHERE id=? AND user_id=?").run(restored,item.id,sess.user_id);
    }else{
      return json(res,400,{error:'This item has no earlier recurring cycle to restore.'});
    }
    trackEvent(sess.user_id,'recurring_payment_undo',{item_id:item.id,restored_due_date:restored});
    return json(res,200,{ok:true,due_date:restored});
  }
  const deleteMatch=url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if(req.method==='DELETE'&&deleteMatch){
    const sess=requireAuth(req,res);if(!sess)return;const b=await readJson(req);if(!requireCsrf(req,res,sess,b))return;
    const item=db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(deleteMatch[1],sess.user_id);
    if(!item)return json(res,404,{error:'Item not found.'});
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('DELETE FROM item_due_history WHERE item_id=? AND user_id=?').run(item.id,sess.user_id);
      db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(item.id,sess.user_id);
      db.exec('COMMIT');
    }catch(err){db.exec('ROLLBACK');throw err;}
    trackEvent(sess.user_id,'item_deleted',{category:item.category,recurrence:item.recurrence||null});
    return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/reprocess'){
    const s=requireAuth(req,res);if(!s)return;const b=await readJson(req);if(!requireCsrf(req,res,s,b))return;
    const rows=db.prepare("SELECT * FROM items WHERE user_id=? AND notes IS NOT NULL AND LENGTH(TRIM(notes))>0").all(s.user_id); let changed=0;
    for(const row of rows){const p=understand(row.notes,row.file_name||'');if(p.parser_confidence>.7){db.prepare(`UPDATE items SET title=?,category=?,due_date=COALESCE(?,due_date),due_time=COALESCE(?,due_time),amount=COALESCE(?,amount),avoidable=?,recurrence=COALESCE(?,recurrence),recurrence_interval=?,recurrence_day=COALESCE(?,recurrence_day),recurrence_weekday=COALESCE(?,recurrence_weekday),reminder_days=?,parser_confidence=?,parsed_at=? WHERE id=? AND user_id=?`).run(p.title,p.category,p.due_date,p.due_time,p.amount,p.avoidable,p.recurrence,p.recurrence_interval||1,p.recurrence_day,p.recurrence_weekday,p.reminder_days,p.parser_confidence,now(),row.id,s.user_id);changed++;}}
    return json(res,200,{ok:true,changed});
  }
  if(req.method==='POST'&&url.pathname==='/api/ask'){
    const s=requireAuth(req,res);if(!s)return;const b=await readJson(req);if(!requireCsrf(req,res,s,b))return;const q=String(b.q||'').toLowerCase();const all=getItems(s.user_id),open=all.filter(x=>x.status==='open');let answer='';
    if(/tomorrow|next payment|next charge|renew/.test(q)){
      const tomorrow=localISO(new Date(Date.now()+86400000));const arr=open.filter(x=>x.due_date===tomorrow);answer=arr.length?`Tomorrow you have ${arr.map(x=>`${x.title}${x.amount!=null?` for A$${Number(x.amount).toFixed(2)}`:''}`).join('; ')}.`:'I do not have anything saved as due tomorrow.';
    } else if(/pay|money|subscription|spend|charge/.test(q)){
      const arr=open.filter(x=>x.amount!=null),total=arr.reduce((a,x)=>a+Number(x.amount||0),0);answer=arr.length?`You have ${arr.length} upcoming charge${arr.length===1?'':'s'} totalling A$${total.toFixed(2)}. ${arr.slice(0,5).map(x=>`${x.title} (A$${Number(x.amount).toFixed(2)}${x.due_date?`, ${x.due_date}`:''}${x.recurrence?`, ${x.recurrence}`:''})`).join('; ')}.`:`I don't have any upcoming charges saved.`;
    } else if(/deadline|due|expire|return/.test(q)){
      const arr=open.filter(x=>x.category==='deadline');answer=arr.length?`You have ${arr.length} deadline item${arr.length===1?'':'s'}: ${arr.slice(0,5).map(x=>`${x.title} — ${x.due_date||'date not set'}`).join('; ')}.`:'No open deadlines are saved.';
    } else if(/today|week|need|\bdo\b/.test(q)){
      const reminders=reminderRows(s.user_id);answer=reminders.length?`The most important right now: ${reminders.slice(0,5).map(x=>`${x.title} — ${x.urgency}${x.amount!=null?` (A$${Number(x.amount).toFixed(2)})`:''}`).join('; ')}.`:(open.length?`You have ${open.length} open item${open.length===1?'':'s'}: ${open.slice(0,6).map(x=>x.title).join(', ')}.`:`You're clear right now.`);
    } else {
      const words=q.match(/[a-z0-9]+/g)?.filter(w=>w.length>2)||[];const matches=all.filter(x=>words.some(w=>(x.title+' '+(x.notes||'')).toLowerCase().includes(w)));answer=matches.length?'I found: '+matches.slice(0,5).map(x=>`${x.title}${x.due_date?' — '+x.due_date:''}${x.amount!=null?' — A$'+Number(x.amount).toFixed(2):''}`).join('; ')+'.':`I couldn't find a matching saved item.`;
    }
    trackEvent(s.user_id,'ask'); return json(res,200,{answer});
  }
  return json(res,404,{error:'Not found'});
}

function serveStatic(req,res,url){
  let rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,''); if(rel.startsWith('api/'))return false;
  const p=path.normalize(path.join(PUBLIC,rel)); if(!p.startsWith(PUBLIC))return false;
  if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){ const index=path.join(PUBLIC,'index.html'); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...securityHeaders()});res.end(fs.readFileSync(index));return true;}
  const ext=path.extname(p); res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate',...securityHeaders()});fs.createReadStream(p).pipe(res);return true;
}

const server=http.createServer(async(req,res)=>{ try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/'))return await api(req,res,url); if(!serveStatic(req,res,url))json(res,404,{error:'Not found'});}catch(e){console.error(e); if(!res.headersSent)json(res,e.message==='too_large'?413:500,{error:e.message==='bad_json'?'Invalid request.':'Something went wrong.'});else res.end();}});

if(require.main===module){server.listen(PORT,()=>console.log(`\nKivo Web is running at http://localhost:${PORT}\nAdmin dashboard: http://localhost:${PORT}/admin\nSmart reminders + analytics enabled.\n`));}
module.exports={understand,parseAmount,parseRecurrence,parseExplicitDate,nextMonthly,addRecurrence,localISO,daysBetween};
