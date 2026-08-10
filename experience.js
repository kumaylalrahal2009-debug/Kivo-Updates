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
const UPDATE_DIR=path.join(ROOT,'updates');
const UPDATE_REPO=process.env.KIVO_UPDATE_REPO||'kumaylalrahal2009-debug/Kivo-Updates';
const LOCAL_DESKTOP=String(process.env.KIVO_LOCAL_DESKTOP||'false').toLowerCase()==='true';
const VERSION_FILE=path.join(ROOT,'version.json');
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UPLOADS,{recursive:true});fs.mkdirSync(BACKUPS,{recursive:true});fs.mkdirSync(UPDATE_DIR,{recursive:true});

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
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}

function maybeBackup(){try{const source=path.join(DATA,'kivo.db');if(!fs.existsSync(source))return;const latest=fs.readdirSync(BACKUPS).filter(x=>x.endsWith('.db')).sort().pop();if(latest){const age=Date.now()-fs.statSync(path.join(BACKUPS,latest)).mtimeMs;if(age<24*3600*1000)return;}const stamp=new Date().toISOString().replace(/[:.]/g,'-');fs.copyFileSync(source,path.join(BACKUPS,`kivo-${stamp}.db`));const files=fs.readdirSync(BACKUPS).filter(x=>x.endsWith('.db')).sort();while(files.length>7){fs.unlinkSync(path.join(BACKUPS,files.shift()));}}catch(err){console.warn('Kivo backup:',err.message)}}
maybeBackup();

function localVersion(){try{return String(JSON.parse(fs.readFileSync(VERSION_FILE,'utf8')).version||'0.0.0').replace(/^v/,'')}catch{return'0.0.0'}}
function parts(v){return String(v||'0.0.0').replace(/^v/,'').split('.').map(x=>Number(String(x).match(/\d+/)?.[0]||0))}
function compareVersions(a,b){const A=parts(a),B=parts(b);for(let i=0;i<Math.max(A.length,B.length,3);i++){const x=A[i]||0,y=B[i]||0;if(x>y)return 1;if(x<y)return-1;}return 0}
async function latestRelease(){
  const r=await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,{headers:{'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Kivo-Updater'}});
  if(r.status===404)return null;
  if(!r.ok){const body=await r.text().catch(()=>String(r.status));throw new Error(`GitHub update check failed (${r.status}): ${body.slice(0,180)}`)}
  return r.json();
}
function releaseInfo(release){
  const currentVersion=localVersion();
  if(!release)return{available:false,reason:'no_release',currentVersion,repo:UPDATE_REPO};
  const latestVersion=String(release.tag_name||release.name||'0.0.0').replace(/^v/,'').match(/\d+(?:\.\d+){1,3}/)?.[0]||'0.0.0';
  const assets=Array.isArray(release.assets)?release.assets:[];
  const asset=assets.find(a=>/^kivo[-_ ]?update.*\.zip$/i.test(String(a.name||'')))||assets.find(a=>/\.zip$/i.test(String(a.name||''))&&!/source/i.test(String(a.name||'')));
  return{available:!!asset&&compareVersions(latestVersion,currentVersion)>0,currentVersion,latestVersion,tag:release.tag_name||'',name:release.name||release.tag_name||latestVersion,notes:release.body||'',publishedAt:release.published_at||null,assetUrl:asset?.browser_download_url||null,assetName:asset?.name||null,assetSize:asset?.size||null,repo:UPDATE_REPO,reason:asset?null:'update_asset_missing'};
}
async function download(url,dest){const r=await fetch(url,{redirect:'follow',headers:{'Accept':'application/octet-stream','User-Agent':'Kivo-Updater'}});if(!r.ok)throw new Error(`Update download failed (${r.status}).`);const buf=Buffer.from(await r.arrayBuffer());fs.writeFileSync(dest,buf);return buf.length}

const childEnv={...process.env,PORT:String(BILLING_PORT),KIVO_CORE_PORT:String(CORE_PORT),KIVO_DATA_DIR:DATA,KIVO_UPLOAD_DIR:UPLOADS,KIVO_PUBLIC_URL:process.env.KIVO_PUBLIC_URL||`http://localhost:${PORT}`};
const child=spawn(process.execPath,['--no-warnings',path.join(ROOT,'bootstrap.js')],{cwd:ROOT,env:childEnv,stdio:['ignore','inherit','inherit']});
child.on('exit',code=>{console.log(`Kivo services exited (${code??0}); closing experience layer.`);process.exit(code??0)});

function serveCombined(res,type,files){try{const text=files.map(f=>fs.readFileSync(path.join(ROOT,'public',f),'utf8')).join('\n\n');res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'});res.end(text)}catch(err){send(res,500,{error:err.message})}}
function proxy(req,res){const p=http.request({hostname:'127.0.0.1',port:BILLING_PORT,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${BILLING_PORT}`}},r=>{const headers={...r.headers,'cache-control':'no-store'};res.writeHead(r.statusCode||500,headers);r.pipe(res)});p.on('error',()=>send(res,503,{error:'Kivo is starting. Try again in a moment.'}));req.pipe(p)}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/app.js')return serveCombined(res,'application/javascript; charset=utf-8',['app.js','premium.js']);
  if(req.method==='GET'&&url.pathname==='/styles.css')return serveCombined(res,'text/css; charset=utf-8',['styles.css','premium.css']);

  if(req.method==='GET'&&url.pathname==='/api/update/check'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});
    try{return send(res,200,releaseInfo(await latestRelease()))}catch(err){return send(res,502,{error:err.message,currentVersion:localVersion(),repo:UPDATE_REPO})}
  }
  if(req.method==='POST'&&url.pathname==='/api/update/install'){
    const s=session(req);if(!s)return send(res,401,{error:'Please log in.'});
    const chunks=[];for await(const c of req)chunks.push(c);let body={};try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}
    if(!safeEqual(req.headers['x-csrf-token']||body._csrf,s.csrf))return send(res,403,{error:'Security token expired. Refresh Kivo and try again.'});
    if(!LOCAL_DESKTOP)return send(res,403,{error:'Self-updates are only enabled in the desktop build.'});
    try{
      const info=releaseInfo(await latestRelease());
      if(!info.available)return send(res,400,{error:`No newer release is available. Installed ${info.currentVersion}; latest ${info.latestVersion}.`,details:info});
      const zip=path.join(UPDATE_DIR,'Kivo-update.zip');await download(info.assetUrl,zip);
      const script=path.join(ROOT,'apply-update.ps1');if(!fs.existsSync(script))return send(res,500,{error:'apply-update.ps1 is missing.'});
      const updater=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Zip',zip,'-AppDir',ROOT,'-ServerPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});updater.unref();
      send(res,200,{ok:true,version:info.latestVersion,message:`Installing Kivo ${info.latestVersion}. Kivo will restart automatically.`});setTimeout(()=>process.exit(0),1000);return;
    }catch(err){return send(res,500,{error:err.message})}
  }

  if(req.method==='POST'&&(url.pathname==='/api/capture'||url.pathname==='/api/ask')){
    const s=session(req);if(s){const m=membership(s.user_id);if(!isPro(m)){if(url.pathname==='/api/capture'&&usage(s.user_id,'capture',monthStart())>=30)return send(res,402,{error:'You have used your 30 free smart captures this month. Upgrade to Kivo Pro for unlimited captures.'});if(url.pathname==='/api/ask'&&usage(s.user_id,'ask',todayStart())>=15)return send(res,402,{error:'You have used today’s 15 free Ask Kivo messages. Kivo Pro removes the daily limit.'});}}
  }
  proxy(req,res);
}catch(err){console.error(err);if(!res.headersSent)send(res,500,{error:err.message||'Something went wrong.'})}});
server.listen(PORT,()=>console.log(`\nKivo: http://localhost:${PORT}\nInstalled version: ${localVersion()}\nUpdate repo: ${UPDATE_REPO}\nPersistent data: ${DATA}\nAutomatic backups: ${BACKUPS}\n`));
