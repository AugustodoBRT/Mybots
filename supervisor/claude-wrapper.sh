# Claude Code has no Termux package: use a native `claude` if present, else one installed in proot-distro.
if bash -lc 'command -v claude' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; claude "$@"' mybots "$PWD" "$@"; fi
prefix=${PREFIX:-/data/data/com.termux/files/usr}
state="$prefix/var/lib/proot-distro"
# proot-distro 5 keeps containers/<name>/rootfs; older releases used installed-rootfs/<name>.
for rootfs in "$state"/containers/*/rootfs "$state"/installed-rootfs/*; do
  bin="$rootfs/root/.local/bin/claude"
  [ -L "$bin" ] || [ -f "$bin" ] || continue
  name=${rootfs%/rootfs}; name=${name##*/}
  # An extra account (lib/accounts.mjs): proot-distro starts clean, so its login folder is shared and its variable goes in by `env`.
  if [ -n "${MYBOTS_ACCOUNT_DIR:-}" ] && [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    exec proot-distro login "$name" --bind "$MYBOTS_ACCOUNT_DIR:$MYBOTS_ACCOUNT_DIR" -- env "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR" /root/.local/bin/claude "$@"
  fi
  exec proot-distro login "$name" -- /root/.local/bin/claude "$@"
done
printf 'Claude Code não encontrado. Veja docs/claude-termux.md.\n' >&2
exit 127
