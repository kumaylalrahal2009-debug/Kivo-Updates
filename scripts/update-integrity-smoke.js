const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {createUpdateEngine}=require('../lib/update-engine');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kivo-integrity-'));
  const file=path.join(temp,'Kivo-update.zip');
  const payload=Buffer.from('Kivo integrity smoke test payload '.repeat(80));
  fs.writeFileSync(file,payload);
  fs.writeFileSync(path.join(temp,'version.json'),JSON.stringify({version:'1.0.0'}));
  const digest=crypto.createHash('sha256').update(payload).digest('hex');
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end(`${digest}  Kivo-update.zip\n`)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const engine=createUpdateEngine({root:temp,repo:'example/example',localDesktop:false});
  try{
    let missingRejected=false;
    try{await engine.verifyChecksum(file,null)}catch(err){missingRejected=/required SHA-256 checksum/i.test(err.message)}
    if(!missingRejected)throw new Error('Checksum-less Kivo update was not rejected.');
    console.log('✓ checksum-less Kivo update rejected');

    const good=await engine.verifyChecksum(file,`http://127.0.0.1:${port}/checksum.txt`);
    if(!good.verified||good.digest!==digest)throw new Error('Valid update checksum was not accepted.');
    console.log('✓ valid Kivo update checksum accepted');

    fs.appendFileSync(file,'tampered');
    let tamperedRejected=false;
    try{await engine.verifyChecksum(file,`http://127.0.0.1:${port}/checksum.txt`)}catch(err){tamperedRejected=/SHA-256 verification/i.test(err.message)}
    if(!tamperedRejected)throw new Error('Tampered Kivo update was not rejected.');
    console.log('✓ tampered Kivo update rejected');
    console.log('\nKivo update integrity smoke test passed.');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(err=>{console.error(`KIVO UPDATE INTEGRITY TEST FAILED: ${err.stack||err.message}`);process.exit(1)});
