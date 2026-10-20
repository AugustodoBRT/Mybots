#!/bin/bash
# Usage: ask-approve.sh <botId> "message" — like ask.sh, approving every card on the way and printing what each one asked.
# "Sempre permitir" is used where the card offers it, except for actions that should keep asking (routines, forms).
cd "$(dirname "$0")"
bot=$1; out=$(mktemp)
./ask.sh "$bot" "$2" > "$out" 2>&1 &
pid=$!
while kill -0 $pid 2>/dev/null; do
  card=$(node rpc.mjs state.get | node -e 'const a=JSON.parse(require("fs").readFileSync(0)).approvals[0]; if(a) console.log(JSON.stringify(a))')
  if [ -n "$card" ]; then
    echo "CARTÃO: $(echo "$card" | node -pe 'const a=JSON.parse(require("fs").readFileSync(0)); a.title+" · "+String(a.summary||"").replace(/\n/g," / ")')"
    node rpc.mjs approval.respond "$(echo "$card" | node -pe 'const a=JSON.parse(require("fs").readFileSync(0)); JSON.stringify({approvalId:a.id,actionHash:a.actionHash,approved:true,always:a.canAlways&&!/rotina|formulário/i.test(a.title)})')" >/dev/null
  fi
  sleep 3
done
cat "$out"; rm -f "$out"
