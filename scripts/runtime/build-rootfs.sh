#!/usr/bin/env bash
# The small Linux (Alpine) the APK carries: where MyBots' Node, its supervisor and the AIs' command-line tools run on the phone.
# Usage: build-rootfs.sh arm64-v8a|x86_64. Result: .build-tools/runtime/rootfs-<abi>.tgz. Needs Docker; apk installs for a foreign
# architecture without running anything from the packages (--no-scripts), so the arm64 tree builds on an x86_64 computer.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
abi=$1; version=3.24.4
case "$abi" in arm64-v8a) arch=aarch64 ;; x86_64) arch=x86_64 ;; *) echo "ABI inválida: $abi" >&2; exit 2 ;; esac
out="$root/.build-tools/runtime"; mkdir -p "$out/dl"
mini="alpine-minirootfs-$version-$arch.tar.gz"
base="https://dl-cdn.alpinelinux.org/alpine/v${version%.*}"
[ -f "$out/dl/$mini" ] || curl -fsSL --proto '=https' -o "$out/dl/$mini" "$base/releases/$arch/$mini"
sum=$(awk -v f="$mini" '$1==f{print $2}' "$here/rootfs.lock")
[ -n "$sum" ] || { echo "$mini sem soma em rootfs.lock: $(sha256sum "$out/dl/$mini")" >&2; exit 1; }
echo "$sum  $out/dl/$mini" | sha256sum -c --quiet -
docker run --rm -e ARCH="$arch" -e MINI="$mini" -e BASE="$base" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e ABI="$abi" -v "$out:/work" alpine:${version%.*} sh -euc '
  mkdir /out && tar -xzf "/work/dl/$MINI" -C /out
  apk --root /out --arch "$ARCH" --no-scripts --no-cache --keys-dir /out/etc/apk/keys -X "$BASE/main" -X "$BASE/community" add bash curl ca-certificates ca-certificates-bundle nodejs libstdc++ libgcc tzdata util-linux-misc
  # Android forbids hard links inside an app: each one becomes its own copy.
  find /out -xdev -type f -links +1 | while read -r f; do cp -p "$f" "$f.copy" && mv -f "$f.copy" "$f"; done
  rm -rf /out/var/cache/apk/* /out/usr/share/man /out/usr/include/node
  mkdir -p /out/root /out/tmp /out/etc/profile.d; chmod 1777 /out/tmp
  echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' > /out/etc/profile.d/mybots.sh
  ln -sf /proc/self/fd /out/dev/fd; ln -sf /proc/self/fd/0 /out/dev/stdin; ln -sf /proc/self/fd/1 /out/dev/stdout; ln -sf /proc/self/fd/2 /out/dev/stderr
  tar --numeric-owner -czf "/work/rootfs-$ABI.tgz" -C /out .
  chown "$HOST_UID:$HOST_GID" "/work/rootfs-$ABI.tgz"
'
ls -la "$out/rootfs-$abi.tgz"
