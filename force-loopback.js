const http=require('node:http');

// The legacy core predates the layered Kivo architecture and calls server.listen(port)
// without a host. Preloading this file makes that process listen only on this machine,
// so its internal compatibility endpoints can never be exposed directly to the LAN.
const originalListen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  if(typeof args[0]==='number'&&typeof args[1]!=='string')args.splice(1,0,'127.0.0.1');
  return originalListen.apply(this,args);
};
