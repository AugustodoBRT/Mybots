#!/bin/bash
# Usage: screen.sh out.png — screenshot of the emulator.
source "$(dirname "$0")/env.sh"
"$ADB" exec-out screencap -p > "${1:-$STATE/screen.png}"
