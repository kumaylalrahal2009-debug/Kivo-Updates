const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const ROOT=__dirname;
const PUBLIC_PORT=Number(process.env.PORT||8488);
const APP_PORT=Number(process.env.KIVO_GATEWAY_INNER_PORT||(PUBLIC_PORT+8));
const MAX_BODY_BYTES=Math.max(1024*1024,Number(process.env.KIVO_MAX_REQUEST_BYTES||8*1024*1024));
const LOOPBACK_PRELOAD='./force-loopback.js';
const buckets=new Map();

function clientIp(req){
  if(String(process.env.KIVO_TRUST_PROXY||'false').toLowerCase()==='true'){
    const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
    if(forwarded)return forwarded;
  }
  return req.socket.remoteAddress||'unknown';
}
function isSecure(req){
  if(req.socket.encrypted)return true;
  if(String(process.env.KIVO_TRUST_PROXY||'false').toLowerCase()==='true')return String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase()==='https';
  return false;
}
function securityHeaders(req){
  const h={
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
    'Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Resource-Policy':'same-origin',
    'X-Permitted-Cross-Domain-Policies':'none',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  };
  if(isSecure(req))h['Strict-Transport-Security']='max-age=31536000; includeSubDomains';
  return h;
}
function json(res,status,obj,extra={}){
  if(res.headersSent)return;
  res.writeHead(status,{...securityHeaders({socket:{encrypted:false},headers:{}}),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});
  res.end(JSON.stringify(obj));
}
function policy(method,pathname){
  if(method==='POST'&&pathname==='/api/admin/login')return{name:'owner-login',limit:8,windowMs:10*60*1000};
  if(method==='POST'&&(pathname==='/api/login'||pathname==='/api/register'))return{name:'auth',limit:12,windowMs:10*60*1000};
  if(method==='POST'&&pathname==='/api/account/password')return{name:'password',limit:8,windowMs:10*60*1000};
  if(method==='DELETE'&&pathname==='/api/account')return{name:'account-delete',limit:8,windowMs:10*60*1000};
  if(method==='POST'&&(pathname==='/api/ask'||pathname==='/api/capture'))return{name:'smart-actions',limit:90,windowMs:60*1000};
  if(method==='POST'&&(pathname==='/api/billing/checkout'||pathname==='/api/billing/portal'))return{name:'billing-actions',limit:30,windowMs:60*1000};
  if(pathname.startsWith('/api/')&&method!=='GET'&&method!=='HEAD')return{name:'api-write',limit:180,windowMs:60*1000};
  return null;
}
function consume(key,p){
  const t=Date.now();let b=buckets.get(key);
  if(!b||t>=b.resetAt){b={count:0,resetAt:t+p.windowMs};buckets.set(key,b)}
  b.count++;
  return{allowed:b.count<=p.limit,remaining:Math.max(0,p.limit-b.count),resetAt:b.resetAt};
}
function rateLimit(req,res,url){
  const p=policy(req.method||'GET',url.pathname);if(!p)return false;
  const state=consume(`${p.name}:${clientIp(req)}`,p);
  const seconds=Math.max(1,Math.ceil((state.resetAt-Date.now())/1000));
  res.setHeader('RateLimit-Limit',String(p.limit));
  res.setHeader('RateLimit-Remaining',String(state.remaining));
  res.setHeader('RateLimit-Reset',String(seconds));
  if(state.allowed)return false;
  res.setHeader('Retry-After',String(seconds));
  json(res,429,{error:'Too many requests. Wait a little and try again.'});
  return true;
}
function webhookTimestampFresh(req,url){
  if(req.method!=='POST'||url.pathname!=='/api/billing/webhook')return true;
  const header=String(req.headers['stripe-signature']||'');
  const match=header.match(/(?:^|,)t=(\d+)(?:,|$)/);if(!match)return true;
  const stamp=Number(match[1]);if(!Number.isFinite(stamp))return false;
  return Math.abs(Math.floor(Date.now()/1000)-stamp)<=300;
}
function copyResponseHeaders(req,headers){
  const out={...headers,...securityHeaders(req)};
  delete out['server'];delete out['x-powered-by'];
  return out;
}
function forwardedHeaders(req){
  const headers={...req.headers,host:`127.0.0.1:${APP_PORT}`};
  delete headers['connection'];delete headers['proxy-connection'];
  headers['x-forwarded-for']=clientIp(req);headers['x-forwarded-proto']=isSecure(req)?'https':'http';
  return headers;
}
function proxyBuffered(req,res,body){
  const headers={...forwardedHeaders(req),'content-length':String(body.length)};
  delete headers['transfer-encoding'];
  const p=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:req.method,headers},inner=>{
    res.writeHead(inner.statusCode||500,copyResponseHeaders(req,inner.headers));inner.pipe(res);
  });
  p.on('error',()=>json(res,503,{error:'Kivo is starting. Try again in a moment.'}));
  p.end(body);
}
function proxyStreaming(req,res){
  const p=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:req.method,headers:forwardedHeaders(req)},inner=>{
    res.writeHead(inner.statusCode||500,copyResponseHeaders(req,inner.headers));inner.pipe(res);
  });
  p.on('error',()=>json(res,503,{error:'Kivo is starting. Try again in a moment.'}));
  req.pipe(p);
}
function proxyAppBundle(req,res){
  const p=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:'GET',headers:forwardedHeaders(req)},inner=>{
    const chunks=[];inner.on('data',c=>chunks.push(c));inner.on('end',()=>{
      let body=Buffer.concat(chunks);
      if((inner.statusCode||500)===200){
        try{
          const additions=['money-intelligence.js','account-controls.js'].map(name=>fs.readFileSync(path.join(ROOT,'public',name),'utf8')).join('\n\n');
          body=Buffer.from(body.toString('utf8')+'\n\n'+additions,'utf8');
        }catch(err){return json(res,500,{error:`Kivo app extension is missing: ${err.message}`})}
      }
      const headers=copyResponseHeaders(req,inner.headers);delete headers['content-encoding'];delete headers['transfer-encoding'];headers['content-type']='application/javascript; charset=utf-8';headers['cache-control']='no-store, max-age=0';headers['content-length']=String(body.length);
      res.writeHead(inner.statusCode||500,headers);res.end(body);
    });
  });
  p.on('error',()=>json(res,503,{error:'Kivo is starting. Try again in a moment.'}));p.end();
}
async function readBody(req){
  const declared=Number(req.headers['content-length']||0);if(declared>MAX_BODY_BYTES)throw Object.assign(new Error('too_large'),{code:'too_large'});
  const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>MAX_BODY_BYTES)throw Object.assign(new Error('too_large'),{code:'too_large'});chunks.push(chunk)}return Buffer.concat(chunks);
}

const childNodeOptions=[process.env.NODE_OPTIONS||'',`--require=${LOOPBACK_PRELOAD}`].filter(Boolean).join(' ').trim();
const child=spawn(process.execPath,['--no-warnings','smart-experience-v2.js'],{
  cwd:ROOT,
  env:{...process.env,PORT:String(APP_PORT),KIVO_SMART_INNER_PORT:String(APP_PORT+4),NODE_OPTIONS:childNodeOptions},
  stdio:['ignore','inherit','inherit']
});
child.on('exit',code=>{console.log(`Kivo secured app exited (${code??0}).`);process.exit(code??0)});

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(rateLimit(req,res,url))return;
    if(!webhookTimestampFresh(req,url))return json(res,400,{error:'Stripe webhook timestamp is too old or too far in the future.'});
    if(req.method==='GET'&&url.pathname==='/app.js')return proxyAppBundle(req,res);
    const method=req.method||'GET';
    if(['POST','PUT','PATCH','DELETE'].includes(method)){
      const body=await readBody(req);return proxyBuffered(req,res,body);
    }
    return proxyStreaming(req,res);
  }catch(err){
    if(err?.code==='too_large')return json(res,413,{error:`Request is too large. Maximum size is ${Math.floor(MAX_BODY_BYTES/1024/1024)} MB.`});
    console.error('Kivo security gateway:',err);return json(res,500,{error:'Kivo could not complete that request.'});
  }
});
server.requestTimeout=30000;
server.headersTimeout=15000;
server.keepAliveTimeout=5000;
server.listen(PUBLIC_PORT,()=>console.log(`\nKivo Security Gateway: http://localhost:${PUBLIC_PORT}\nProtected Smart v2: 127.0.0.1:${APP_PORT}\nRate limits, hardened headers, request limits and webhook replay protection enabled.\n`));

function shutdown(){try{server.close()}catch{};try{child.kill()}catch{};setTimeout(()=>process.exit(0),500).unref()}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
setInterval(()=>{const t=Date.now();for(const[k,b]of buckets)if(t>b.resetAt+60000)buckets.delete(k)},60000).unref();
