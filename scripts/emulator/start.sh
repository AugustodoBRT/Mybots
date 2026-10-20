#!/bin/bash
# Boots the test emulator and waits until Android is ready. --window shows it on screen.
source "$(dirname "$0")/env.sh"
window=(-no-window); [ "${1:-}" = --window ] && window=()
nohup "$ANDROID_HOME/emulator/emulator" -avd mybots "${window[@]}" -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot-save -memory 3072 > "$STATE/emulator.log" 2>&1 &
timeout 300 "$ADB" wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 2; done' && echo "Emulador pronto."
"$ADB" shell svc power stayon true
