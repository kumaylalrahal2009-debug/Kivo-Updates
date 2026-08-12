const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

function createAccountService({dataDir,uploadsDir,secureCookies=false,beforeDelete=null}){
  const dbPath=path.join(dataDir,'kivo.db');
  const db=new DatabaseSync(dbPath);
  try{db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;')}catch{}
  const now=()=>new Date().toISOString();
  const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
  const pbkdf=(password,salt)=>crypto.pbkdf2Sync(password,salt,120000,32,'sha256').toString('hex');
  const safeEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)};
  const cookies=req=>{const out={};for(const p of String(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return out};
  const tableExists=name=>{try{return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)}catch{return false}};
  const allIf=(name,sql,args=[])=>{try{return tableExists(name)?db.prepare(sql).all(...args):[]}catch{return[]}};
  const oneIf=(name,sql,args=[])=>{try{return tableExists(name)?db.prepare(sql).get(...args)||null:null}catch{return null}};
  const session=req=>{
    if(!tableExists('sessions')||!tableExists('users'))return null;
    const raw=cookies(req).kivo_session;if(!raw)return null;
    try{return db.prepare(`SELECT s.*,u.name,u.email,u.created_at AS user_created_at,u.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(raw),now())||null}catch{return null}
  };
  const csrfValid=(req,body,s)=>safeEqual(req.headers['x-csrf-token']||body?._csrf,s?.csrf);
  const clearCookie=()=>{let c='kivo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';if(secureCookies)c+='; Secure';return c};
  const response=(status,body,headers={})=>({status,body,headers});

  function exportAccount(s){
    const profile=oneIf('users','SELECT id,name,email,created_at,last_seen_at FROM users WHERE id=?',[s.user_id]);
    if(!profile)return response(404,{error:'Account not found.'});
    const items=allIf('items','SELECT * FROM items WHERE user_id=? ORDER BY created_at,id',[s.user_id]);
    const history=allIf('assistant_messages','SELECT role,content,created_at FROM assistant_messages WHERE user_id=? ORDER BY id',[s.user_id]);
    const membership=oneIf('memberships','SELECT plan,status,billing_interval,current_period_end,created_at,updated_at FROM memberships WHERE user_id=?',[s.user_id]);
    const billing=allIf('billing_events','SELECT event_type,amount_aud,created_at FROM billing_events WHERE user_id=? ORDER BY id',[s.user_id]);
    const activity=allIf('analytics_events','SELECT event_type,metadata,created_at FROM analytics_events WHERE user_id=? ORDER BY id',[s.user_id]);
    return response(200,{product:'Kivo',export_version:1,exported_at:now(),profile,items,assistant_history:history,membership,billing_history:billing,activity});
  }

  function updateProfile(req,body,s){
    if(!csrfValid(req,body,s))return response(403,{error:'Security token expired. Refresh Kivo and try again.'});
    const name=String(body.name||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
    if(name.length<1||name.length>80)return response(400,{error:'Name must be between 1 and 80 characters.'});
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name,s.user_id);
    const user=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(s.user_id);
    return response(200,{ok:true,user});
  }

  function changePassword(req,body,s){
    if(!csrfValid(req,body,s))return response(403,{error:'Security token expired. Refresh Kivo and try again.'});
    const current=String(body.current_password||''),next=String(body.new_password||'');
    if(next.length<8||next.length>128)return response(400,{error:'New password must be between 8 and 128 characters.'});
    const user=db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(s.user_id);if(!user)return response(404,{error:'Account not found.'});
    if(!safeEqual(pbkdf(current,user.password_salt),user.password_hash))return response(401,{error:'Current password is incorrect.'});
    if(safeEqual(current,next))return response(400,{error:'Choose a new password that is different from your current password.'});
    const salt=crypto.randomBytes(18).toString('base64url'),passwordHash=pbkdf(next,salt),currentToken=hash(cookies(req).kivo_session||'');
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(passwordHash,salt,s.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(s.user_id,currentToken);
      db.exec('COMMIT');
    }catch(err){try{db.exec('ROLLBACK')}catch{};throw err}
    return response(200,{ok:true,message:'Password changed. Other signed-in sessions were closed.'});
  }

  async function deleteAccount(req,body,s){
    if(!csrfValid(req,body,s))return response(403,{error:'Security token expired. Refresh Kivo and try again.'});
    if(String(body.confirm||'').trim().toUpperCase()!=='DELETE')return response(400,{error:'Type DELETE to confirm permanent account deletion.'});
    const password=String(body.password||''),user=db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(s.user_id);if(!user)return response(404,{error:'Account not found.'});
    if(!safeEqual(pbkdf(password,user.password_salt),user.password_hash))return response(401,{error:'Password is incorrect.'});

    const membership=oneIf('memberships','SELECT plan,status,billing_interval,stripe_customer_id,stripe_subscription_id,current_period_end FROM memberships WHERE user_id=?',[s.user_id]);
    const billedSubscription=membership?.stripe_subscription_id&&membership.plan==='pro'&&!['canceled','cancelled','inactive','ended'].includes(String(membership.status||'').toLowerCase());
    if(billedSubscription){
      if(typeof beforeDelete!=='function')return response(409,{error:'Cancel your active Kivo Pro subscription before deleting this account.'});
      try{await beforeDelete({userId:s.user_id,membership});}
      catch(err){return response(Number(err?.statusCode)||502,{error:err?.message||'Kivo could not confirm billing cancellation. Your account was not deleted.'});}
    }

    db.exec('BEGIN IMMEDIATE');
    try{
      if(tableExists('assistant_messages'))db.prepare('DELETE FROM assistant_messages WHERE user_id=?').run(s.user_id);
      if(tableExists('billing_events'))db.prepare('DELETE FROM billing_events WHERE user_id=?').run(s.user_id);
      if(tableExists('memberships'))db.prepare('DELETE FROM memberships WHERE user_id=?').run(s.user_id);
      if(tableExists('analytics_events'))db.prepare('DELETE FROM analytics_events WHERE user_id=?').run(s.user_id);
      if(tableExists('item_due_history'))db.prepare('DELETE FROM item_due_history WHERE user_id=?').run(s.user_id);
      if(tableExists('items'))db.prepare('DELETE FROM items WHERE user_id=?').run(s.user_id);
      if(tableExists('sessions'))db.prepare('DELETE FROM sessions WHERE user_id=?').run(s.user_id);
      db.prepare('DELETE FROM users WHERE id=?').run(s.user_id);
      db.exec('COMMIT');
    }catch(err){try{db.exec('ROLLBACK')}catch{};throw err}
    try{
      const root=path.resolve(uploadsDir),userDir=path.resolve(root,String(s.user_id));
      if(userDir!==root&&userDir.startsWith(root+path.sep))fs.rmSync(userDir,{recursive:true,force:true});
    }catch(err){console.warn('Kivo account upload cleanup:',err.message)}
    return response(200,{ok:true,message:'Kivo account deleted.'},{'Set-Cookie':clearCookie()});
  }

  async function handle(req,url,bodyBuffer=null){
    const pathname=url.pathname,method=req.method||'GET';
    if(!pathname.startsWith('/api/account'))return null;
    let s;try{s=session(req)}catch{return response(503,{error:'Kivo account service is still starting.'})}
    if(!s)return response(401,{error:'Please log in.'});
    let body={};if(bodyBuffer&&bodyBuffer.length){try{body=JSON.parse(bodyBuffer.toString('utf8'))}catch{return response(400,{error:'Invalid request.'})}}
    try{
      if(method==='GET'&&pathname==='/api/account/export')return exportAccount(s);
      if(method==='PATCH'&&pathname==='/api/account/profile')return updateProfile(req,body,s);
      if(method==='POST'&&pathname==='/api/account/password')return changePassword(req,body,s);
      if(method==='DELETE'&&pathname==='/api/account')return await deleteAccount(req,body,s);
      return response(404,{error:'Account action not found.'});
    }catch(err){console.error('Kivo account service:',err);return response(500,{error:'Kivo could not complete that account action.'})}
  }

  return{
    handle,
    sessionFor:req=>session(req),
    csrfValid:(req,body,s)=>csrfValid(req,body,s),
    close:()=>{try{db.close()}catch{}}
  };
}

module.exports={createAccountService};
