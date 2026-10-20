#!/usr/bin/env bash
# Instala o APK pelo adb (USB ou depuração por Wi-Fi). Instalações pelo adb não passam
# pelo bloqueio do Play Protect para apps baixados do navegador/gerenciador de arquivos.
# Uso: scripts/install-adb.sh [apk]
#      scripts/install-adb.sh pair IP:PORTA CÓDIGO   (Wi-Fi, uma vez)
#      scripts/install-adb.sh connect IP:PORTA       (Wi-Fi, a cada sessão)
set -euo pipefail
project=$(cd "$(dirname "$0")/.." && pwd)
adb="$project/.build-tools/android-sdk/platform-tools/adb"
case "${1:-}" in
  pair) exec "$adb" pair "$2" "$3" ;;
  connect) exec "$adb" connect "$2" ;;
esac
apk=${1:-$(ls -v "$project"/dist/apk/mybots-v*.apk | tail -n 1)}
if ! "$adb" get-state >/dev/null 2>&1; then
  echo 'Nenhum celular conectado. Ative a depuração USB (ou por Wi-Fi) e autorize este computador.' >&2
  "$adb" devices -l >&2
  exit 1
fi
echo "Instalando $(basename "$apk") por cima da versão atual (dados preservados)…"
"$adb" install -r "$apk"
