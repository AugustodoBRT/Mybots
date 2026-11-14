#!/bin/bash
# Usage: runtime-shell.sh < script.sh — runs a bash script inside the app's own Linux (the same PRoot the app uses), as the app.
# Needs the emulator build from install.sh (debuggable). The network works as in the app.
source "$(dirname "$0")/env.sh"
lib=$("$ADB" shell pm dump $APP | sed -n 's/^ *legacyNativeLibraryDir=//p' | head -1 | tr -d '\r')/x86_64
script=$(base64 -w0)
"$ADB" shell "run-as $APP sh -c 'base=\$PWD/files/runtime; \
  PROOT_LOADER=$lib/libproot_loader.so PROOT_TMP_DIR=\$base/tmp HOME=/root LANG=C.UTF-8 TMPDIR=/tmp MYBOTS_EMBEDDED=1 \
  PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  $lib/libproot.so --link2symlink -0 -r \$base/rootfs -b /dev/null -b /dev/zero -b /dev/random -b /dev/urandom -b /proc -b /sys \
  -b \$base/home:/root -w /root /bin/bash -c \"echo $script | base64 -d | bash\"'"
