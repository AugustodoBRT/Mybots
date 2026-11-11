#!/usr/bin/env bash
# Puts the embedded Linux for this ABI in the APK's assets, building it the first time. Assets are per build, so one APK carries one processor's Linux.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd); abi=$1
built="$root/.build-tools/runtime/rootfs-$abi.tgz"
[ "$built" -nt "$here/build-rootfs.sh" ] && [ -f "$built" ] || "$here/build-rootfs.sh" "$abi"
assets="$root/mobile/modules/termux-bridge/android/src/main/assets"
cp "$built" "$assets/mybots-runtime.tgz"
sha256sum "$built" | cut -d' ' -f1 > "$assets/mybots-runtime.tgz.sha256"
