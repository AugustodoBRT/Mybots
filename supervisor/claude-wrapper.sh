# Runs the `claude` installed in this device's PATH (on the phone, the one MyBots installed inside its Linux: Ajustes → IAs e contas).
if bash -lc 'command -v claude' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; claude "$@"' mybots "$PWD" "$@"; fi
printf 'Claude Code não encontrado. Instale em Ajustes → IAs e contas.\n' >&2
exit 127
