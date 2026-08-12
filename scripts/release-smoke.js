const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const exists=rel=>fs.existsSync(path.join(root,rel));
const fail=msg=>{console.error(`KIVO RELEASE CHECK FAILED: ${msg}`);process.exitCode=1};
const ok=msg=>console.log(`✓ ${msg}`);

const required=[
  'server.js','bootstrap.js','experience.js','smart-experience.js',
  'public/index.html','public/app.js','public/styles.css','public/premium.js','public/premium.css','public/smart-client.js','public/smart-ui.css',
  'start-kivo.bat','apply-update.ps1','.gitignore'
];
for(const file of required){exists(file)?ok(`found ${file}`):fail(`missing ${file}`)}

if(exists('start-kivo.bat')){
  const start=read('start-kivo.bat');
  /smart-experience\.js/i.test(start)?ok('launcher uses Smart Experience'):fail('start-kivo.bat does not launch smart-experience.js');
  /KIVO_UPDATE_REPO/i.test(start)?ok('launcher configures update repository'):fail('launcher does not configure update repository');
}

if(exists('smart-experience.js')){
  const smart=read('smart-experience.js');
  /smart-client\.js/.test(smart)?ok('Smart Experience appends smart-client.js'):fail('smart-client.js is not wired into Smart Experience');
  /smart-ui\.css/.test(smart)?ok('Smart Experience appends smart-ui.css'):fail('smart-ui.css is not wired into Smart Experience');
  /corrected_query/.test(smart)?ok('assistant returns corrected query context'):fail('assistant correction metadata missing');
}

if(exists('apply-update.ps1')){
  const updater=read('apply-update.ps1');
  for(const protectedName of ['data','uploads','updates','backups','business-config.bat']){
    updater.toLowerCase().includes(protectedName.toLowerCase())?ok(`updater references protected ${protectedName}`):fail(`updater does not protect/reference ${protectedName}`);
  }
}

if(exists('public/index.html')){
  const html=read('public/index.html');
  for(const id of ['app','homeView','inboxView','moneyView','askView','chat','askInput','captureText','settingsDialog','adminDashboard']){
    html.includes(`id="${id}"`)?ok(`UI anchor #${id} exists`):fail(`required UI anchor #${id} missing`);
  }
}

if(exists('public/smart-client.js')){
  const client=read('public/smart-client.js');
  /Ctrl/.test(client)&&/command/i.test(client)?ok('command/search experience present'):fail('command/search experience missing');
  /offline/i.test(client)?ok('offline handling present'):fail('offline handling missing');
  /unhandledrejection/i.test(client)?ok('client error boundary present'):fail('client error boundary missing');
}

const secretScanFiles=['server.js','bootstrap.js','experience.js','smart-experience.js','public/app.js','public/premium.js','public/smart-client.js'];
for(const file of secretScanFiles){
  if(!exists(file))continue;
  const text=read(file);
  if(/sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}/.test(text))fail(`possible real secret embedded in ${file}`);
}
ok('no obvious real payment secrets embedded in application code');

for(const privatePath of ['data/kivo.db','.env','business-config.bat']){
  if(exists(privatePath))fail(`private runtime file should not be committed: ${privatePath}`);
}
ok('private runtime files are absent from release source');

for(const rel of ['public/app.js','public/styles.css','public/smart-client.js','public/smart-ui.css']){
  if(exists(rel)&&fs.statSync(path.join(root,rel)).size<100)fail(`${rel} is unexpectedly tiny`);
}

if(process.exitCode)process.exit(process.exitCode);
console.log('\nKivo release smoke checks passed.');
