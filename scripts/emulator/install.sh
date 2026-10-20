#!/bin/bash
# Builds the x86_64 APK for the emulator only and installs it over the current one.
set -e
source "$(dirname "$0")/env.sh"
node "$ROOT/scripts/package-connectors.mjs" >/dev/null; node "$ROOT/scripts/package-supervisor.mjs"
(cd "$ROOT/mobile/android" && ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --offline --console=plain > "$STATE/build-x86.log" 2>&1) || { tail -30 "$STATE/build-x86.log"; exit 1; }
"$ADB" install -r "$ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk"
"$ADB" shell pm grant com.mybots.app com.termux.permission.RUN_COMMAND || true
"$ADB" shell cmd notification allow_listener com.mybots.app/expo.modules.termuxbridge.MyBotsNotificationListener || true
"$ADB" shell am start -n com.mybots.app/.MainActivity >/dev/null
echo "Instalado. Rode wait-supervisor.sh."
