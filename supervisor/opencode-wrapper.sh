# opencode has no official Termux package: use a native `opencode` if present, else the one installed in a proot-distro container.
if bash -lc 'command -v opencode' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; opencode "$@"' mybots "$PWD" "$@"; fi
prefix=${PREFIX:-/data/data/com.termux/files/usr}
state="$prefix/var/lib/proot-distro"
# proot-distro starts a clean login: the turn's configuration (it carries the run's token) goes in by `env`.
carry=(); for name in OPENCODE_CONFIG_CONTENT; do [ -n "${!name:-}" ] && carry+=("$name=${!name}"); done
# proot-distro 5 keeps containers/<name>/rootfs; older releases used installed-rootfs/<name>.
for rootfs in "$state"/containers/*/rootfs "$state"/installed-rootfs/*; do
  for path in /root/.opencode/bin/opencode /root/.local/bin/opencode /usr/local/bin/opencode /usr/bin/opencode; do
    [ -L "$rootfs$path" ] || [ -f "$rootfs$path" ] || continue
    name=${rootfs%/rootfs}; name=${name##*/}
    exec proot-distro login "$name" -- env "${carry[@]}" "$path" "$@"
  done
done
printf 'opencode não encontrado. Veja docs/agy-opencode-termux.md.\n' >&2
exit 127
