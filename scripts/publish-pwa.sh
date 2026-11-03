#!/usr/bin/env bash
# Publishes the iPhone's web app on the relay's VM (served by Caddy at https://mybots-rele.duckdns.org/).
# Usage: scripts/publish-pwa.sh            (builds, uploads and swaps the folder in one step)
set -euo pipefail
project=$(cd "$(dirname "$0")/.." && pwd)
key=${MYBOTS_VM_KEY:-$HOME/.ssh/oracle_vm.key}; host=${MYBOTS_VM:-ubuntu@136.248.104.150}
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
node "$project/scripts/build-pwa.mjs" "$out/site" > /dev/null
ssh_vm() { ssh -i "$key" -o BatchMode=yes "$host" "$@"; }
tar czf - -C "$out/site" . | ssh_vm 'set -e; sudo mkdir -p /var/www; rm -rf ~/mybots-site-new && mkdir ~/mybots-site-new && tar xzf - -C ~/mybots-site-new && sudo rm -rf /var/www/mybots-old && { [ -d /var/www/mybots ] && sudo mv /var/www/mybots /var/www/mybots-old || true; } && sudo mv ~/mybots-site-new /var/www/mybots && sudo chmod -R a+rX /var/www/mybots && sudo rm -rf /var/www/mybots-old'
curl -fsS -o /dev/null -w "web app: HTTP %{http_code}\n" https://mybots-rele.duckdns.org/
