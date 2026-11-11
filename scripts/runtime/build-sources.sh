#!/usr/bin/env bash
# The corresponding sources of what the APK carries under GPL/LGPL: PRoot and talloc as built here, and the Alpine packages'
# recipes and upstream archives. Published next to each APK. Result: .build-tools/runtime/mybots-fontes-gpl.tar.gz. Needs Docker.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd); out="$root/.build-tools/runtime"; work="$out/sources"
branch=3.24-stable; docker run --rm -v "$out:/work" alpine:3.24 rm -rf /work/sources; mkdir -p "$work/proot-talloc" "$work/alpine"
# PRoot and talloc, exactly as build-proot.sh uses them, with the patches and the scripts that build them.
grep -v '^#' "$here/sources.lock" | while read -r name version url sum; do
  file="$work/proot-talloc/$name-$version.tar.gz"; curl -fsSL --proto '=https' -o "$file" "$url"; echo "$sum  $file" | sha256sum -c --quiet -
done
cp -r "$here/patches" "$here/build-proot.sh" "$here/build-rootfs.sh" "$here/sources.lock" "$here/rootfs.lock" "$here/README.md" "$here/THIRD_PARTY_NOTICES.md" "$work/proot-talloc/"
docker run --rm -e BRANCH="$branch" -e HOST="$(id -u):$(id -g)" -v "$out:/work" alpine:3.24 sh -euc '
  apk add --no-cache curl tar >/dev/null
  mkdir /o; tar -xzf /work/rootfs-arm64-v8a.tgz -C /o
  awk "/^P:/{p=substr(\$0,3)} /^V:/{v=substr(\$0,3)} /^L:/{l=substr(\$0,3)} /^o:/{o=substr(\$0,3)} /^\$/{print p\"|\"v\"|\"o\"|\"l}" /o/lib/apk/db/installed > /work/sources/alpine/pacotes.txt
  grep -E "GPL" /work/sources/alpine/pacotes.txt | cut -d"|" -f3 | sort -u > /tmp/origins
  for origin in $(cat /tmp/origins); do
    target=/work/sources/alpine/$origin; mkdir -p "$target"; found=""
    for repo in main community; do
      if curl -fsSL "https://gitlab.alpinelinux.org/alpine/aports/-/archive/$BRANCH/aports-$BRANCH.tar.gz?path=$repo/$origin" -o /tmp/r.tgz && tar -xzf /tmp/r.tgz -C "$target" --strip-components=3 2>/dev/null && [ -f "$target/APKBUILD" ]; then found=$repo; break; fi
    done
    [ -n "$found" ] || { echo "SEM RECEITA: $origin" >&2; exit 1; }
    ( set +u; cd "$target"; srcdir=/tmp/s; builddir=/tmp/s; CBUILD=aarch64-alpine-linux-musl; CHOST=$CBUILD; CTARGET=$CBUILD; CARCH=aarch64; CTARGET_ARCH=aarch64; CBUILD_ARCH=aarch64; . ./APKBUILD
      for item in $source; do case "$item" in *://*)
        file=${item%%::*}; url=${item##*::}; [ "$file" != "$item" ] || file=${url##*/}
        curl -fsSL -o "$file" "https://distfiles.alpinelinux.org/distfiles/v3.24/$file" || curl -fsSL -o "$file" "$url" || { echo "SEM FONTE: $origin $file" >&2; exit 1; }
      ;; esac; done
      echo "$origin: pkgver=$pkgver-r$pkgrel" )
  done
  chown -R "$HOST" /work/sources
'
tar --numeric-owner --owner=0 --group=0 -czf "$out/mybots-fontes-gpl.tar.gz" -C "$work" .
ls -la "$out/mybots-fontes-gpl.tar.gz"
