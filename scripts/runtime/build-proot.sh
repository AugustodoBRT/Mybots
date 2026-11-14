#!/usr/bin/env bash
# Builds PRoot (GPL-2.0-or-later) with talloc (LGPL-3.0-or-later) for Android and puts it in the native module's jniLibs. Android only
# lets an app execute files from its nativeLibraryDir, so the programs travel as lib*.so. Usage: build-proot.sh arm64-v8a|x86_64 ...
# Sources are pinned by sources.lock; patches/ are PRoot's fixes for Android's seccomp policy (from the Mika project, same license as PRoot).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
ndk=$(find "$root/.build-tools/android-sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
api=29
work="$root/.build-tools/runtime/proot"; mkdir -p "$work/dl"
for abi in "$@"; do
  case "$abi" in arm64-v8a) target=aarch64-linux-android ;; x86_64) target=x86_64-linux-android ;; *) echo "ABI inválida: $abi" >&2; exit 2 ;; esac
  cc="$bin/$target$api-clang"; strip="$bin/llvm-strip"; ar="$bin/llvm-ar"
  out="$root/mobile/modules/mybots-native/android/src/main/jniLibs/$abi"
  b="$work/$abi"; rm -rf "$b"; mkdir -p "$b/src" "$b/obj/loader" "$out"
  while read -r name version url sum; do
    case "$name" in ''|'#'*) continue ;; esac
    a="$work/dl/$name-$version.tar.gz"
    [ -f "$a" ] || curl -fsSL --proto '=https' -o "$a" "$url"
    echo "$sum  $a" | sha256sum -c --quiet -
    mkdir -p "$b/src/$name"; tar -xzf "$a" -C "$b/src/$name" --strip-components=1
    for p in "$here/patches/$name"-*.patch; do [ -f "$p" ] && patch -d "$b/src/$name" -p1 --forward --quiet < "$p"; done
  done < "$here/sources.lock"
  t="$b/src/talloc"; p="$b/src/proot/src"; o="$b/obj"
  [ -f "$here/uthash.h" ] && mkdir -p "$b/src/proot/lib/uthash/include" && cp "$here/uthash.h" "$b/src/proot/lib/uthash/include/"
  repro=(-ffile-prefix-map="$b"=. -Wno-unused-command-line-argument)
  common=(-O2 -fPIE "${repro[@]}"); link=(-pie -Wl,-z,max-page-size=16384 -Wl,-z,noexecstack -Wl,--build-id=none)
  IFS=. read -r major minor rel <<< "$(awk '$1=="talloc"{print $2}' "$here/sources.lock")"
  { cat <<H
#define TALLOC_BUILD_VERSION_MAJOR $major
#define TALLOC_BUILD_VERSION_MINOR $minor
#define TALLOC_BUILD_VERSION_RELEASE $rel
H
    for d in STDINT_H INTTYPES_H STDBOOL_H BOOL MALLOC_H UNISTD_H STRING_H STRINGS_H SYS_TYPES_H SYS_AUXV_H DLFCN_H USLEEP GETAUXVAL LINUX_TYPES_H INTPTR_T UINTPTR_T PTRDIFF_T VA_COPY C99_VSNPRINTF SNPRINTF VSNPRINTF ASPRINTF VASPRINTF DPRINTF VDPRINTF STRDUP STRNDUP STRNLEN STRLCPY STRLCAT MEMMOVE MEMMEM STRERROR ERRNO_DECL DECL_EWOULDBLOCK VOLATILE CONSTRUCTOR_ATTRIBUTE DESTRUCTOR_ATTRIBUTE __ATTRIBUTE__ VISIBILITY_ATTR FUNCTION_ATTRIBUTE_FORMAT WARN_UNUSED_RESULT; do echo "#define HAVE_$d 1"; done
    echo '#define _PUBLIC_ __attribute__((visibility("default")))'; echo '#define _PRIVATE_ __attribute__((visibility("hidden")))'; } > "$o/config.h"
  "$cc" "${common[@]}" -w -D_GNU_SOURCE -D__STDC_WANT_LIB_EXT1__=1 -I"$o" -I"$t" -I"$t/lib/replace" -c "$t/talloc.c" -o "$o/talloc.o"
  "$ar" rcsD "$o/libtalloc.a" "$o/talloc.o"
  version=$(awk '$1=="proot"{print $2}' "$here/sources.lock")
  printf '#ifndef BUILD_H\n#define BUILD_H\n#undef VERSION\n#define VERSION "%s"\n#define HAVE_PROCESS_VM\n#define HAVE_SECCOMP_FILTER\n#endif\n' "$version" > "$o/build.h"
  cpp=(-D_FILE_OFFSET_BITS=64 -D_GNU_SOURCE -I"$o" -I"$p" -I"$p/../lib/uthash/include" -I"$t")
  addr=$("$cc" -E -dM -DNO_LIBC_HEADER "$p/arch.h" | awk '$2=="LOADER_ADDRESS"{print $3}')
  flags=(-O2 -fPIC -ffreestanding -Wno-inline-asm "${repro[@]}")
  "$cc" "${cpp[@]}" "${flags[@]}" -c "$p/loader/loader.c" -o "$o/loader/loader.o"
  "$cc" "${cpp[@]}" "${flags[@]}" -c "$p/loader/assembly.S" -o "$o/loader/assembly.o"
  "$cc" -static -nostdlib -Wl,--build-id=none,-Ttext="$addr",-z,noexecstack,-z,max-page-size=16384 -o "$o/loader/loader" "$o/loader/loader.o" "$o/loader/assembly.o"
  "$strip" -o "$out/libproot_loader.so" "$o/loader/loader"
  # The upstream build embeds the loader and writes it to a temporary folder at run time, which Android refuses to execute: PROOT_LOADER is used instead.
  printf '\t.section .rodata\n\t.global _binary_loader_elf_start\n\t.global _binary_loader_elf_end\n_binary_loader_elf_start:\n_binary_loader_elf_end:\n\t.section .note.GNU-stack,"",%%progbits\n' > "$o/loader/wrapped.S"
  objects=()
  for s in cli/cli.c cli/proot.c cli/note.c execve/enter.c execve/exit.c execve/shebang.c execve/elf.c execve/ldso.c execve/auxv.c execve/aoxp.c path/binding.c path/glue.c path/canon.c path/path.c path/proc.c path/temp.c syscall/seccomp.c syscall/syscall.c syscall/chain.c syscall/enter.c syscall/exit.c syscall/sysnum.c syscall/socket.c syscall/heap.c syscall/rlimit.c tracee/tracee.c tracee/mem.c tracee/reg.c tracee/event.c ptrace/ptrace.c ptrace/user.c ptrace/wait.c extension/extension.c extension/kompat/kompat.c extension/fake_id0/fake_id0.c extension/link2symlink/link2symlink.c extension/portmap/portmap.c extension/portmap/map.c; do
    obj="$o/${s%.c}.o"; mkdir -p "$(dirname "$obj")"; "$cc" "${cpp[@]}" "${common[@]}" -w -c "$p/$s" -o "$obj"; objects+=("$obj")
  done
  "$cc" -I"$o" "${common[@]}" -c "$o/loader/wrapped.S" -o "$o/loader/wrapped.o"; objects+=("$o/loader/wrapped.o")
  "$cc" "${link[@]}" -o "$o/proot" "${objects[@]}" "$o/libtalloc.a"
  "$strip" -o "$out/libproot.so" "$o/proot"
  chmod 755 "$out"/libproot*.so; ls -la "$out"
done
