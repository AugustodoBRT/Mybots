#!/bin/bash
# Usage: termux-run.sh < script.sh — runs inside the Termux app session (has network), waits and prints the output.
source "$(dirname "$0")/env.sh"
"$ADB" shell "run-as com.termux sh -c 'cat > $TERMUX/home/.claude-run.sh; rm -f $TERMUX/home/.claude-run.done'"
"$ADB" shell input keyevent 224
"$ADB" shell monkey -p com.termux -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 2
"$ADB" shell input text "'bash ~/.claude-run.sh > ~/.claude-run.log 2>&1; touch ~/.claude-run.done'"
"$ADB" shell input keyevent 66
for i in $(seq 1 ${WAIT:-100}); do "$ADB" shell run-as com.termux ls $TERMUX/home/.claude-run.done >/dev/null 2>&1 && break; sleep 3; done
"$ADB" shell run-as com.termux cat $TERMUX/home/.claude-run.log
