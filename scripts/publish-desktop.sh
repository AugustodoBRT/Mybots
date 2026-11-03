#!/usr/bin/env bash
# Builds the Linux installers (AppImage and .deb) on this computer and publishes them in the rolling release "pc-latest",
# the feed the installed apps read for updates. Needs pc/ui (scripts/build-desktop.sh exports it).
# Usage: scripts/publish-desktop.sh [--no-publish]
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$root/pc/ui/index.html" ] || (cd "$root/mobile" && rm -rf ../pc/ui && npx expo export --platform web --output-dir ../pc/ui)
node "$root/scripts/stage-desktop.mjs"
[ -d "$root/packaging/node_modules" ] || (cd "$root/packaging" && npm ci --no-audit --no-fund)
rm -rf "$root/dist/desktop"
(cd "$root/packaging" && npx electron-builder --linux AppImage deb --publish never --config electron-builder.yml)
cd "$root/dist/desktop"
for f in MyBots-*; do [ -f "$f" ] && sha256sum "$f" > "$f.sha256"; done
[ "${1:-}" = "--no-publish" ] && { ls -la; exit 0; }
gh release delete pc-latest --cleanup-tag --yes -R AugustodoBRT/Mybots 2>/dev/null || true
gh release create pc-latest MyBots-* latest*.yml -R AugustodoBRT/Mybots --prerelease --latest=false \
  --title "MyBots no computador (versão mais nova)" \
  --notes "Instaladores do MyBots para computador. Linux: AppImage (chmod +x) ou .deb. Windows e macOS: betas sem assinatura, em preparação."
