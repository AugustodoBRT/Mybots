#!/usr/bin/env bash
# Builds and installs the MyBots window on this computer: the interface (the app's own screens, as web) that the
# node in pc/ serves, the Tauri window, its menu entry and its start with the session (waiting in the tray).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root/mobile" && rm -rf ../pc/ui && npx expo export --platform web --output-dir ../pc/ui)
(cd "$root/desktop/src-tauri" && npx --yes @tauri-apps/cli@2 build --no-bundle)
install -Dm755 "$root/desktop/src-tauri/target/release/mybots-desktop" "$HOME/.local/bin/mybots-desktop"
install -Dm644 "$root/desktop/src-tauri/icons/128x128.png" "$HOME/.local/share/icons/hicolor/128x128/apps/mybots.png"
entry() {
  printf '[Desktop Entry]\nType=Application\nName=MyBots\nComment=Seus bots pessoais\nExec=%s\nIcon=mybots\nTerminal=false\nCategories=Utility;\nStartupWMClass=mybots-desktop\n' "$1"
}
mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"
entry "$HOME/.local/bin/mybots-desktop" > "$HOME/.local/share/applications/mybots.desktop"
entry "$HOME/.local/bin/mybots-desktop --hidden" > "$HOME/.config/autostart/mybots.desktop"
# The node serves the new interface and code from now on.
systemctl --user is-enabled --quiet mybots-pc.service 2>/dev/null && systemctl --user restart mybots-pc.service
echo "Pronto: MyBots no menu de apps e na bandeja ao entrar no computador."
