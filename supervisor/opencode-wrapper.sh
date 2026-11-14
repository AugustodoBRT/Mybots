# Runs the `opencode` installed in this device's PATH (on the phone, the one MyBots installed inside its Linux: Ajustes → IAs e contas).
if bash -lc 'command -v opencode' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; opencode "$@"' mybots "$PWD" "$@"; fi
printf 'opencode não encontrado. Instale em Ajustes → IAs e contas.\n' >&2
exit 127
