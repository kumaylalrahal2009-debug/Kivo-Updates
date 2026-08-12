const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

const sourceFile=path.join(__dirname,'server.js');
let code=fs.readFileSync(sourceFile,'utf8');

// The original prototype had starter admin constants. The official Kivo launcher
// never executes those values: this adapter replaces them in memory with private
// per-process values supplied by the secure bootstrap layer.
code=code.replace(/const ADMIN_EMAIL\s*=\s*'[^']*';/,"const ADMIN_EMAIL = process.env.KIVO_CORE_ADMIN_EMAIL || 'owner@kivo.local';");
code=code.replace(/const ADMIN_PASSWORD\s*=\s*'[^']*';/,"const ADMIN_PASSWORD = process.env.KIVO_CORE_ADMIN_PASSWORD || ''; ");

// server.js starts itself only when it is the entrypoint. Here it is compiled by
// an adapter, so make its normal start block active for this isolated process.
code=code.replace(/if\(require\.main===module\)/,'if(true)');

const runtime=new Module(sourceFile,module);
runtime.filename=sourceFile;
runtime.paths=Module._nodeModulePaths(path.dirname(sourceFile));
runtime._compile(code,sourceFile);
