#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Kivo needs Node.js 22 or newer."; exit 1; fi
NODEMAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODEMAJOR" -lt 22 ]; then echo "Kivo needs Node.js 22 or newer."; exit 1; fi
PORT=8177 node --no-warnings server.js &
sleep 2
open -a "Google Chrome" --args --app=http://localhost:8177 --window-size=430,920 || open http://localhost:8177
