#!/bin/bash
# Waits for the supervisor of the installed APK, then forwards its port to 43219 and copies its token for rpc.mjs.
source "$(dirname "$0")/env.sh"
release=$(cut -c1-12 "$ROOT/mobile/modules/termux-bridge/android/src/main/assets/mybots-supervisor.sha256")
for i in $(seq 1 30); do
  "$ADB" shell run-as com.termux cat $TERMUX/home/.mybots/endpoint.json 2>/dev/null | grep -q "$release" && break
  sleep 8
done
endpoint=$("$ADB" shell run-as com.termux cat $TERMUX/home/.mybots/endpoint.json) || exit 1
echo "$endpoint" | grep -q "$release" || { echo "Supervisor desta versão não subiu. Veja o app (Ver logs) e ~/.mybots/supervisor.log."; exit 1; }
port=$(echo "$endpoint" | node -pe 'JSON.parse(require("fs").readFileSync(0)).port')
"$ADB" forward tcp:43219 tcp:$port >/dev/null
"$ADB" shell run-as com.termux cat $TERMUX/home/.mybots/token > "$STATE/token"; chmod 600 "$STATE/token"
echo "Supervisor ativo (porta $port, acessível em 127.0.0.1:43219)."
