#!/usr/bin/env bash
# Builds and installs the MyBots window on this computer: the interface (the app's own screens, as web) that the
# node in pc/ serves, the Electron window, its menu entry and its start with the session (waiting in the tray).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root/mobile" && rm -rf ../pc/ui && npx expo export --platform web --output-dir ../pc/ui)
# The window is Electron (the system's own, no second copy): the bots' browser is real Chromium tabs inside it.
electron=$(command -v electron || true)
[ -n "$electron" ] || { echo 'Instale o Electron (no Arch: sudo pacman -S electron) e rode de novo.' >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\nexec %s --ozone-platform-hint=auto %s "$@"\n' "$electron" "$root/desktop/electron" > "$HOME/.local/bin/mybots-desktop"
chmod 755 "$HOME/.local/bin/mybots-desktop"
install -Dm644 "$root/desktop/electron/icon.png" "$HOME/.local/share/icons/hicolor/128x128/apps/mybots.png"
entry() {
  printf '[Desktop Entry]\nType=Application\nName=MyBots\nComment=Seus bots pessoais\nExec=%s\nIcon=mybots\nTerminal=false\nCategories=Utility;\nStartupWMClass=mybots-desktop\n' "$1"
}
mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"
entry "$HOME/.local/bin/mybots-desktop" > "$HOME/.local/share/applications/mybots.desktop"
entry "$HOME/.local/bin/mybots-desktop --hidden" > "$HOME/.config/autostart/mybots.desktop"
# The node serves the new interface and code from now on.
systemctl --user is-enabled --quiet mybots-pc.service 2>/dev/null && systemctl --user restart mybots-pc.service
echo "Pronto: MyBots no menu de apps e na bandeja ao entrar no computador."
