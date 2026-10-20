#!/bin/bash
# Usage: ask.sh <botId> "message" — sends a chat message to a bot in the emulator and prints its reply.
cd "$(dirname "$0")"
bot=$1; request=$(node -e 'console.log(require("crypto").randomUUID())')
node rpc.mjs chat.send "$(node -e 'console.log(JSON.stringify({botId:process.argv[1],requestId:process.argv[2],text:process.argv[3]}))' "$bot" "$request" "$2")" >/dev/null || exit 1
for i in $(seq 1 60); do
  state=$(node rpc.mjs tasks.list | node -pe "(JSON.parse(require('fs').readFileSync(0)).find(t=>t.id==='$request')||{}).state")
  [ "$state" = done ] || [ "$state" = failed ] && break; sleep 4
done
echo "[$state]"; node rpc.mjs chat.history "{\"botId\":\"$bot\"}" | node -e 'const m=JSON.parse(require("fs").readFileSync(0)).at(-1);console.log(m.text||m.error)'
