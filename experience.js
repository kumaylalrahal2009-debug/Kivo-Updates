const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

const ROOT=__dirname;
const PORT=Number(process.env.PORT||8488);
const BILLING_PORT=Number(process.env.KIVO_BILLING_PORT||(PORT+2));
const CORE_PORT=Number(process.env.KIVO_CORE_PORT||(PORT+3));
const DATA=path.resolve(process.env.KIVO_DATA_DIR||path.join(ROOT,'data'));
const UPLOADS=path.resolve(process.env.KIVO_UPLOAD_DIR||path.join(ROOT,'uploads'));
const BACKUPS=path.join(ROOT,'backups');
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true});fs.mkdirSync(BACKUPS,{recursive:true});

const db=new DatabaseSync(path.join(DATA,'kivo.db'));
function now(){return new Date().toISOString()}
function hash(s){return crypto.createHash('sha256').update(String(s)).digest('hex')}
function cookies(req){const out={};for(const p of(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return out}
function session(req){const tok=cookies(req).kivo_session;if(!tok)return null;try{return db.prepare(`SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(tok),now())||null}catch{return null}}
function membership(uid){try{return db.prepare("SELECT * FROM memberships WHERE user_id=?").get(uid)||{plan:'free',status:'active'}}catch{return{plan:'free',status:'active'}}}
function isPro(m){return m&&m.plan==='pro'&&['active','trialing'].includes(m.status)}
function monthStart(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).toISOString()}
function todayStart(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString()}
function usage(uid,type,since){try{return db.prepare('SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND event_type=? AND created_at>=?').get(uid,type,since).n}catch{return 0}}
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}

function maybeBackup(){try{const source=path.join(DATA,'kivo.db');if(!fs.existsSync(source))return;const latest=fs.readdirSync(BACKUPS).filter(x=>x.endsWith('.db')).sort().pop();if(latest){const age=Date.now()-fs.statSync(path.join(BACKUPS,latest)).mtimeMs;if(age<24*3600*1000)return;}const stamp=new Date().toISOString().replace(/[:.]/g,'-');fs.copyFileSync(source,path.join(BACKUPS,`kivo-${stamp}.db`));const files=fs.readdirSync(BACKUPS).filter(x=>x.endsWith('.db')).sort();while(files.length>7){fs.unlinkSync(path.join(BACKUPS,files.shift()));}}catch(err){console.warn('Kivo backup:',err.message)}}
maybeBackup();

const childEnv={...process.env,PORT:String(BILLING_PORT),KIVO_CORE_PORT:String(CORE_PORT),KIVO_DATA_DIR:DATA,KIVO_UPLOAD_DIR:UPLOADS};
const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'bootstrap.js')],{cwd:ROOT,env:childEnv,stdio:['ignore','inherit','inherit']});
child.on('exit',code=>{console.log(`Kivo services exited (${code??0}); closing experience layer.`);process.exit(code??0)});

function serveCombined(res,type,files){try{const text=files.map(f=>fs.readFileSync(path.join(ROOT,'public',f),'utf8')).join('\n\n');res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'});res.end(text)}catch(err){send(res,500,{error:err.message})}}
function proxy(req,res){const p=http.request({hostname:'127.0.0.1',port:BILLING_PORT,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${BILLING_PORT}`}},r=>{const headers={...r.headers,'cache-control':'no-store'};res.writeHead(r.statusCode||500,headers);r.pipe(res)});p.on('error',()=>send(res,503,{error:'Kivo is starting. Try again in a moment.'}));req.pipe(p)}

const server=http.createServer((req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/app.js')return serveCombined(res,'application/javascript; charset=utf-8',['app.js','premium.js']);
  if(req.method==='GET'&&url.pathname==='/styles.css')return serveCombined(res,'text/css; charset=utf-8',['styles.css','premium.css']);
  if(req.method==='POST'&&(url.pathname==='/api/capture'||url.pathname==='/api/ask')){
    const s=session(req);if(s){const m=membership(s.user_id);if(!isPro(m)){if(url.pathname==='/api/capture'&&usage(s.user_id,'capture',monthStart())>=30)return send(res,402,{error:'You have used your 30 free smart captures this month. Upgrade to Kivo Pro for unlimited captures.'});if(url.pathname==='/api/ask'&&usage(s.user_id,'ask',todayStart())>=15)return send(res,402,{error:'You have used today’s 15 free Ask Kivo messages. Kivo Pro removes the daily limit.'});}}
  }
  proxy(req,res);
}catch(err){console.error(err);if(!res.headersSent)send(res,500,{error:'Something went wrong.'})}});
server.listen(PORT,()=>console.log(`\nKivo: http://localhost:${PORT}\nPersistent data: ${DATA}\nAutomatic backups: ${BACKUPS}\n`));
