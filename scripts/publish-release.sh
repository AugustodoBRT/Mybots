#!/usr/bin/env bash
# Publishes dist/apk/mybots-vNN.apk (+ .sha256) as the newest GitHub release; the app updates itself from it.
# Usage: scripts/publish-release.sh NN "notas em Markdown"
set -euo pipefail
project=$(cd "$(dirname "$0")/.." && pwd)
version=${1:?Informe o número da versão (versionCode).}; notes=${2:?Informe as novidades.}
apk="$project/dist/apk/mybots-v$version.apk"
[ -f "$apk" ] && [ -f "$apk.sha256" ] || { echo "Faltam $apk e $apk.sha256." >&2; exit 1; }
[ "$(cut -d' ' -f1 "$apk.sha256")" = "$(sha256sum "$apk" | cut -d' ' -f1)" ] || { echo "O .sha256 não confere com o APK." >&2; exit 1; }
name=$(sed -n 's/.*versionName "\(.*\)".*/\1/p' "$project/mobile/android/app/build.gradle")
gh release create "v$version" "$apk" "$apk.sha256" -R AugustodoBRT/Mybots --title "MyBots $name" --notes "$notes" --latest
