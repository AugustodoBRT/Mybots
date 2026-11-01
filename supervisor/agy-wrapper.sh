# Antigravity (agy) has no Termux package: use a native `agy` if present, else the one installed in a proot-distro container.
if bash -lc 'command -v agy' >/dev/null 2>&1; then exec bash -lc 'cd -- "$1"; shift; agy "$@"' mybots "$PWD" "$@"; fi
prefix=${PREFIX:-/data/data/com.termux/files/usr}
state="$prefix/var/lib/proot-distro"
home=${MYBOTS_HOME:-$HOME/.mybots}
# proot-distro starts a clean login: the run's token and address go in by `env`, and MyBots' own folder is shared so the
# container can start the tools bridge (node, inside the container) from the same path.
carry=(); for name in MYBOTS_RUN_TOKEN MYBOTS_RUN_ENDPOINT; do [ -n "${!name:-}" ] && carry+=("$name=${!name}"); done
# proot-distro 5 keeps containers/<name>/rootfs; older releases used installed-rootfs/<name>.
for rootfs in "$state"/containers/*/rootfs "$state"/installed-rootfs/*; do
  bin="$rootfs/root/.local/bin/agy"
  [ -L "$bin" ] || [ -f "$bin" ] || continue
  name=${rootfs%/rootfs}; name=${name##*/}
  exec proot-distro login "$name" --bind "$home:$home" -- env "${carry[@]}" /root/.local/bin/agy "$@"
done
printf 'Antigravity (agy) não encontrado. Veja docs/agy-opencode-termux.md.\n' >&2
exit 127
