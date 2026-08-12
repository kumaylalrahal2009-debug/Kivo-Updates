const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

const sourceFile=path.join(__dirname,'server.js');
let code=fs.readFileSync(sourceFile,'utf8');

function replaceRequired(label,pattern,replacement){
  const before=code;code=code.replace(pattern,replacement);
  if(code===before)throw new Error(`Kivo compatibility patch failed: ${label}`);
}

// The original prototype had starter admin constants. The official Kivo launcher
// never executes those values: this adapter replaces them in memory with private
// per-process values supplied by the secure bootstrap layer.
replaceRequired('admin email',/const ADMIN_EMAIL\s*=\s*'[^']*';/,"const ADMIN_EMAIL = process.env.KIVO_CORE_ADMIN_EMAIL || 'owner@kivo.local';");
replaceRequired('admin password',/const ADMIN_PASSWORD\s*=\s*'[^']*';/,"const ADMIN_PASSWORD = process.env.KIVO_CORE_ADMIN_PASSWORD || ''; ");

// Modern parser patch. Use deterministic source boundaries instead of a broad
// regex so legacy formatting changes can never silently leave the old parser live.
const parserStart=code.indexOf('function parseAmount(text){');
const parserEnd=code.indexOf('function cleanTitle',parserStart);
if(parserStart<0||parserEnd<=parserStart)throw new Error('Kivo compatibility patch failed: parseAmount boundaries');
code=code.slice(0,parserStart)+"function parseAmount(text){ return require('./lib/capture-parser').parseAmount(text); }\n"+code.slice(parserEnd);
if(!code.includes("require('./lib/capture-parser').parseAmount"))throw new Error('Kivo compatibility patch failed: guarded parser not installed');

// Kivo is a multi-process SQLite app. WAL + a busy timeout reduce lock contention
// between the core, Smart v2, billing and privacy services.
replaceRequired(
  'SQLite concurrency settings',
  /const db = new DatabaseSync\(path\.join\(DATA, 'kivo\.db'\)\);/,
  "const db = new DatabaseSync(path.join(DATA, 'kivo.db'));\ntry{db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;')}catch{}"
);

// server.js starts itself only when it is the entrypoint. Here it is compiled by
// an adapter, so make its normal start block active for this isolated process.
replaceRequired('core startup',/if\(require\.main===module\)/,'if(true)');

const runtime=new Module(sourceFile,module);
runtime.filename=sourceFile;
runtime.paths=Module._nodeModulePaths(path.dirname(sourceFile));
runtime._compile(code,sourceFile);
