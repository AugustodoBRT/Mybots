# Claude Code has no Termux package: use a native `claude` if present, else one installed in proot-distro.
if bash -lc 'command -v claude' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; claude "$@"' mybots "$PWD" "$@"; fi
prefix=${PREFIX:-/data/data/com.termux/files/usr}
state="$prefix/var/lib/proot-distro"
# proot-distro 5 keeps containers/<name>/rootfs; older releases used installed-rootfs/<name>.
for rootfs in "$state"/containers/*/rootfs "$state"/installed-rootfs/*; do
  bin="$rootfs/root/.local/bin/claude"
  [ -L "$bin" ] || [ -f "$bin" ] || continue
  name=${rootfs%/rootfs}; name=${name##*/}
  exec proot-distro login "$name" -- /root/.local/bin/claude "$@"
done
printf 'Claude Code não encontrado. Veja docs/claude-termux.md.\n' >&2
exit 127
