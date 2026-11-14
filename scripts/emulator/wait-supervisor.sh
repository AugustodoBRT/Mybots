#!/bin/bash
# Waits for the supervisor of the installed APK inside the app's own Linux, then forwards its port to 43219 and copies its token for rpc.mjs.
source "$(dirname "$0")/env.sh"
release=$(cut -c1-12 "$ROOT/mobile/modules/mybots-native/android/src/main/assets/mybots-supervisor.sha256")
read_file() { "$ADB" shell "run-as $APP cat $APPHOME/.mybots/$1" 2>/dev/null; }
for i in $(seq 1 30); do
  read_file endpoint.json | grep -q "$release" && break
  sleep 8
done
endpoint=$(read_file endpoint.json) || exit 1
echo "$endpoint" | grep -q "$release" || { echo "Supervisor desta versão não subiu. Veja o app (Ver logs) e runtime-shell.sh <<< 'tail ~/.mybots/supervisor.log'."; exit 1; }
port=$(echo "$endpoint" | node -pe 'JSON.parse(require("fs").readFileSync(0)).port')
"$ADB" forward tcp:43219 tcp:$port >/dev/null
read_file token > "$STATE/token"; chmod 600 "$STATE/token"
echo "Supervisor ativo (porta $port, acessível em 127.0.0.1:43219)."
