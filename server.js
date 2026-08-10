const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// Emergency bridge loader. The full Kivo core is bundled in server-core.js.
require('./server-core.js');
