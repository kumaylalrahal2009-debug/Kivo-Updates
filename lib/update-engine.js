const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

function createUpdateEngine({root,repo,localDesktop=false}){
  const versionFile=path.join(root,'version.json');
  const updateDir=path.join(root,'updates');
  fs.mkdirSync(updateDir,{recursive:true});

  const localVersion=()=>{try{return String(JSON.parse(fs.readFileSync(versionFile,'utf8')).version||'0.0.0').replace(/^v/,'')}catch{return'0.0.0'}};
  const parts=v=>String(v||'0.0.0').replace(/^v/,'').split('.').map(x=>Number(String(x).match(/\d+/)?.[0]||0));
  const compare=(a,b)=>{const A=parts(a),B=parts(b);for(let i=0;i<Math.max(A.length,B.length,3);i++){const x=A[i]||0,y=B[i]||0;if(x>y)return 1;if(x<y)return-1}return 0};
  const releaseVersion=r=>String(r?.tag_name||r?.name||'0.0.0').replace(/^v/,'').match(/\d+(?:\.\d+){1,3}/)?.[0]||'0.0.0';
  const findAsset=r=>{const assets=Array.isArray(r?.assets)?r.assets:[];return assets.find(a=>/^kivo[-_ ]?update.*\.zip$/i.test(String(a.name||'')))||assets.find(a=>/\.zip$/i.test(String(a.name||''))&&!/source/i.test(String(a.name||'')))||null};

  async function githubJson(url,timeout=7000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Kivo-Updater-v2','Cache-Control':'no-cache'}});
      const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}
      if(!r.ok)throw new Error(`GitHub ${r.status}${data?.message?`: ${data.message}`:''}`);
      return data;
    }finally{clearTimeout(timer)}
  }

  async function latestRelease(){
    const stamp=Date.now();const errors=[];
    const endpoints=[
      `https://api.github.com/repos/${repo}/releases/latest?nocache=${stamp}`,
      `https://api.github.com/repos/${repo}/releases?per_page=10&nocache=${stamp}`
    ];
    for(const [index,url] of endpoints.entries()){
      try{
        const data=await githubJson(url);
        const releases=Array.isArray(data)?data:[data];
        const usable=releases.filter(r=>r&&!r.draft&&!r.prerelease).sort((a,b)=>compare(releaseVersion(b),releaseVersion(a)));
        if(usable[0])return{release:usable[0],source:index===0?'latest':'release-list'};
      }catch(err){errors.push(err.message)}
    }
    const e=new Error(errors.length?errors.join(' | '):'No published GitHub release was found.');e.code='github_lookup_failed';throw e;
  }

  function infoFrom(release,source='unknown'){
    const currentVersion=localVersion(),latestVersion=releaseVersion(release),asset=findAsset(release);
    const assetUrl=asset?.browser_download_url||((release?.tag_name)?`https://github.com/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/Kivo-update.zip`:null);
    return{
      available:!!assetUrl&&compare(latestVersion,currentVersion)>0,
      currentVersion,latestVersion,
      tag:release?.tag_name||'',name:release?.name||release?.tag_name||latestVersion,
      notes:release?.body||'',publishedAt:release?.published_at||null,
      assetUrl,assetName:asset?.name||'Kivo-update.zip',assetSize:asset?.size||null,
      repo,source,reason:assetUrl?null:'update_asset_missing'
    };
  }

  async function check(){
    try{const {release,source}=await latestRelease();return infoFrom(release,source)}
    catch(err){return{available:false,currentVersion:localVersion(),latestVersion:null,repo,source:'error',reason:'github_lookup_failed',error:err.message}}
  }

  async function download(url,dest){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const r=await fetch(url,{signal:controller.signal,redirect:'follow',headers:{Accept:'application/octet-stream','User-Agent':'Kivo-Updater-v2','Cache-Control':'no-cache'}});
      if(!r.ok)throw new Error(`Update download failed (${r.status}).`);
      const buf=Buffer.from(await r.arrayBuffer());if(buf.length<1024)throw new Error('Downloaded update package is unexpectedly small.');fs.writeFileSync(dest,buf);return buf.length;
    }finally{clearTimeout(timer)}
  }

  async function install(serverPid){
    if(!localDesktop)throw new Error('Self-updates are only enabled in the desktop build.');
    const info=await check();if(info.error)throw new Error(info.error);if(!info.available)throw new Error(`No newer Kivo release is available. Installed ${info.currentVersion}; latest ${info.latestVersion||'unknown'}.`);
    const zip=path.join(updateDir,'Kivo-update.zip');await download(info.assetUrl,zip);
    const script=path.join(root,'apply-update.ps1');if(!fs.existsSync(script))throw new Error('apply-update.ps1 is missing.');
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Zip',zip,'-AppDir',root,'-ServerPid',String(serverPid)],{detached:true,stdio:'ignore',windowsHide:true});child.unref();
    return{ok:true,version:info.latestVersion,message:`Installing Kivo ${info.latestVersion}. Kivo will restart automatically.`};
  }

  return{check,install,localVersion};
}

module.exports={createUpdateEngine};
