#!/bin/bash
# Traz da VM (scripts/windows-vm.sh) o que o vigia (windows-watch.ps1) anotou e resume: janelas de console VISÍVEIS e os processos novos
# que não são do próprio MyBots/Chromium, com quem os abriu. Uso: windows-watch-resumo.sh [pasta-de-saida]
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:-.build-tools/vm}; mkdir -p "$out"
scripts/windows-vm.sh pegar 'C:\watch\janelas.csv' "$out/janelas.csv" >/dev/null
scripts/windows-vm.sh pegar 'C:\watch\processos.csv' "$out/processos.csv" >/dev/null
echo "== Janelas de console visíveis ($(($(wc -l < "$out/janelas.csv") - 1))):"
tail -n +2 "$out/janelas.csv" | cut -c1-300
echo
echo "== Processos novos ($(($(wc -l < "$out/processos.csv") - 1)) no total), sem MyBots.exe e Chromium:"
tail -n +2 "$out/processos.csv" | awk -F';' '$4 !~ /^(MyBots|msedgewebview2|conhost)\.exe$/' | cut -c1-260
