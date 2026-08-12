const CACHE='kivo-shell-v1';
const SHELL=['/','/manifest.json','/icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;

  // Never cache private/account data.
  if(url.pathname.startsWith('/api/'))return;

  // Never hide a freshly installed Kivo update behind a cached JS/CSS bundle.
  if(url.pathname==='/app.js'||url.pathname==='/styles.css')return;

  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put('/',copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match('/')));
    return;
  }

  if(['/manifest.json','/icon.svg'].includes(url.pathname)){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(req)));
  }
});
