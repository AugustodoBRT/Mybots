#!/bin/bash
# Usage: termux-shell.sh < script.sh — runs as the Termux user through adb run-as (no network there).
source "$(dirname "$0")/env.sh"
"$ADB" shell "run-as com.termux sh -c 'cat > $TERMUX/usr/tmp/claude-run.sh'"
"$ADB" shell "run-as com.termux $TERMUX/usr/bin/env -i HOME=$TERMUX/home PREFIX=$TERMUX/usr PATH=$TERMUX/usr/bin TMPDIR=$TERMUX/usr/tmp LANG=en_US.UTF-8 LD_PRELOAD=$TERMUX/usr/lib/libtermux-exec-ld-preload.so $TERMUX/usr/bin/bash $TERMUX/usr/tmp/claude-run.sh" < /dev/null
