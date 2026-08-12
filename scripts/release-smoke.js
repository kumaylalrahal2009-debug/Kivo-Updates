const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const exists=rel=>fs.existsSync(path.join(root,rel));
const fail=msg=>{console.error(`KIVO RELEASE CHECK FAILED: ${msg}`);process.exitCode=1};
const ok=msg=>console.log(`✓ ${msg}`);

const required=[
  'secure-gateway.js','server.js','core-runtime.js','force-loopback.js','bootstrap.js','experience.js','smart-experience-v2.js','lib/update-engine.js','lib/account-service.js',
  'public/index.html','public/app.js','public/styles.css','public/premium.js','public/premium.css','public/smart-client.js','public/smart-ui.css','public/money-intelligence.js','public/account-controls.js','public/manifest.json','public/sw.js',
  'start-kivo.bat','apply-update.ps1','.gitignore'
];
for(const file of required){exists(file)?ok(`found ${file}`):fail(`missing ${file}`)}

if(exists('secure-gateway.js')){
  const gateway=read('secure-gateway.js');
  /smart-experience-v2\.js/.test(gateway)?ok('security gateway launches Smart Experience v2'):fail('gateway does not launch Smart Experience v2');
  /NODE_OPTIONS/.test(gateway)&&/force-loopback\.js/.test(gateway)?ok('gateway forces internal Node services onto loopback'):fail('gateway does not propagate loopback isolation');
  /createAccountService/.test(gateway)&&/api\/account/.test(gateway)?ok('gateway owns explicit account privacy routes'):fail('gateway is not wired to the account privacy service');
  /RateLimit-Limit/.test(gateway)&&/429/.test(gateway)?ok('public gateway has request rate limiting'):fail('public rate limiting is missing');
  /Content-Security-Policy/.test(gateway)&&/X-Frame-Options/.test(gateway)?ok('public gateway sets browser security headers'):fail('browser security headers are missing');
  /billing\/webhook/.test(gateway)&&/300/.test(gateway)?ok('Stripe webhook timestamp freshness check present'):fail('webhook replay freshness check missing');
  /MAX_BODY_BYTES/.test(gateway)&&/413/.test(gateway)?ok('public request-size boundary present'):fail('request-size boundary missing');
  /money-intelligence\.js/.test(gateway)&&/account-controls\.js/.test(gateway)?ok('gateway app bundle includes Money Intelligence and account controls'):fail('live extension modules are not in the public app bundle');
}

if(exists('start-kivo.bat')){
  const start=read('start-kivo.bat');
  /secure-gateway\.js/i.test(start)?ok('Windows launcher uses security gateway'):fail('start-kivo.bat bypasses the security gateway');
  /KIVO_UPDATE_REPO/i.test(start)?ok('launcher configures update repository'):fail('launcher does not configure update repository');
}

if(exists('Dockerfile')){
  const docker=read('Dockerfile');
  /secure-gateway\.js/.test(docker)?ok('Docker launches security gateway'):fail('Docker bypasses the security gateway');
  /USER node/.test(docker)?ok('Docker runs Kivo as non-root node user'):fail('Docker does not drop root privileges');
}

if(exists('bootstrap.js')){
  const boot=read('bootstrap.js');
  /core-runtime\.js/.test(boot)?ok('bootstrap launches secure core runtime'):fail('bootstrap still launches the legacy core directly');
  /force-loopback\.js/.test(boot)?ok('bootstrap preloads loopback isolation'):fail('loopback isolation preload is missing');
  /KIVO_ADMIN_PASSWORD/.test(boot)?ok('owner admin uses private configuration'):fail('private owner admin configuration is missing');
  /KIVO_CORE_ADMIN_PASSWORD/.test(boot)&&/randomBytes/.test(boot)?ok('internal admin credential is randomized per process'):fail('internal admin credential is not randomized');
}

if(exists('core-runtime.js')){
  const runtime=read('core-runtime.js');
  /KIVO_CORE_ADMIN_PASSWORD/.test(runtime)?ok('core runtime injects private internal admin password'):fail('core runtime does not inject private admin credential');
  /ADMIN_PASSWORD/.test(runtime)&&/replace/.test(runtime)?ok('legacy starter admin constant is overridden in memory'):fail('legacy admin constant override missing');
}

if(exists('lib/account-service.js')){
  const account=read('lib/account-service.js');
  /api\/account\/export/.test(account)&&/api\/account\/profile/.test(account)&&/api\/account\/password/.test(account)?ok('account export/profile/password routes are explicit'):fail('account privacy endpoints are incomplete');
  /method==='DELETE'/.test(account)&&/pathname==='\/api\/account'/.test(account)?ok('permanent account deletion endpoint is explicit'):fail('account deletion endpoint missing');
  /pbkdf2Sync/.test(account)&&/current_password/.test(account)?ok('password change re-verifies the current password'):fail('password re-verification is missing');
  /BEGIN IMMEDIATE/.test(account)&&/ROLLBACK/.test(account)?ok('destructive account changes use transactions'):fail('account transaction protection missing');
  /password_hash/.test(account)&&!/SELECT \* FROM users/.test(account)?ok('account export avoids broad user-record selection'):fail('account export may expose unnecessary user fields');
}

if(exists('smart-experience-v2.js')){
  const smart=read('smart-experience-v2.js');
  /smart-client\.js/.test(smart)?ok('Smart Experience v2 appends smart-client.js'):fail('smart-client.js is not wired into Smart Experience v2');
  /smart-ui\.css/.test(smart)?ok('Smart Experience v2 appends smart-ui.css'):fail('smart-ui.css is not wired into Smart Experience v2');
  /corrected_query/.test(smart)?ok('assistant returns corrected query context'):fail('assistant correction metadata missing');
  /assistant\/history/.test(smart)?ok('assistant history API present'):fail('assistant history API missing');
  /admin\/smart-health/.test(smart)?ok('admin smart-health API present'):fail('admin smart-health API missing');
  /AbortController/.test(smart)?ok('cloud AI timeout fallback present'):fail('cloud AI timeout fallback missing');
  /createUpdateEngine/.test(smart)?ok('Smart v2 owns updater engine'):fail('Smart v2 updater engine missing');
}

if(exists('lib/update-engine.js')){
  const engine=read('lib/update-engine.js');
  /releases\/latest/.test(engine)&&/releases\?per_page/.test(engine)?ok('updater has multiple release discovery paths'):fail('updater does not have multiple release discovery paths');
  /Kivo-update\.zip/.test(engine)?ok('updater has release-asset fallback'):fail('update asset fallback missing');
  /sha256|SHA-256|createHash\('sha256'\)/i.test(engine)?ok('updater verifies release integrity'):fail('update SHA-256 verification missing');
  /30000/.test(engine)?ok('update download timeout present'):fail('update download timeout missing');
}

if(exists('apply-update.ps1')){
  const updater=read('apply-update.ps1');
  for(const protectedName of ['data','uploads','updates','backups','business-config.bat']){
    updater.toLowerCase().includes(protectedName.toLowerCase())?ok(`updater references protected ${protectedName}`):fail(`updater does not protect/reference ${protectedName}`);
  }
  /Restore-Rollback/.test(updater)?ok('failed updates have rollback recovery'):fail('update rollback recovery missing');
  /JavaScript validation failed/.test(updater)?ok('update package is syntax-checked before install'):fail('pre-install JS validation missing');
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
  /firstRunGuide/.test(client)?ok('new-user onboarding present'):fail('new-user onboarding missing');
  /inboxFilterBar/.test(client)?ok('inbox search/filter present'):fail('inbox search/filter missing');
  /kivoFocusCard/.test(client)?ok('priority focus card present'):fail('priority focus card missing');
  /assistant\/history/.test(client)?ok('Ask Kivo persistent history controls present'):fail('Ask Kivo history controls missing');
  /exportKivoData/.test(client)?ok('user data export shortcut present'):fail('user export shortcut missing');
}

if(exists('public/sw.js')){
  const sw=read('public/sw.js');
  /pathname\.startsWith\('\/api\/'\)/.test(sw)?ok('PWA never caches private API responses'):fail('service worker may cache private API responses');
  /app\.js/.test(sw)&&/styles\.css/.test(sw)?ok('PWA keeps live app bundles out of cache'):fail('PWA may hide app updates behind cached bundles');
}

const secretScanFiles=['secure-gateway.js','bootstrap.js','core-runtime.js','experience.js','smart-experience-v2.js','lib/update-engine.js','lib/account-service.js','public/app.js','public/premium.js','public/smart-client.js','public/account-controls.js'];
for(const file of secretScanFiles){
  if(!exists(file))continue;
  const text=read(file);
  if(/sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}/.test(text))fail(`possible real secret embedded in ${file}`);
}
ok('no obvious real payment secrets embedded in official application path');

for(const privatePath of ['data/kivo.db','.env','business-config.bat','owner-login.txt']){
  if(exists(privatePath))fail(`private runtime file should not be committed: ${privatePath}`);
}
ok('private runtime files are absent from release source');

for(const rel of ['public/app.js','public/styles.css','public/smart-client.js','public/smart-ui.css','public/money-intelligence.js','public/account-controls.js']){
  if(exists(rel)&&fs.statSync(path.join(root,rel)).size<100)fail(`${rel} is unexpectedly tiny`);
}

if(process.exitCode)process.exit(process.exitCode);
console.log('\nKivo release smoke checks passed.');
