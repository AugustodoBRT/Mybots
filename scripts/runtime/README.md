# Linux embutido do MyBots

É o que permite o celular rodar o MyBots sem computador. O APK leva um Alpine mínimo com Node e o PRoot; o mesmo supervisor e os mesmos CLIs das IAs rodam dentro dele. O código nativo está em `EmbeddedRuntime.kt`.

| Arquivo | O que faz |
|---|---|
| `build-proot.sh <abi>` | Compila PRoot e talloc com o NDK e grava em `jniLibs/<abi>/`. Os binários ficam versionados. |
| `build-rootfs.sh <abi>` | Monta o Alpine (precisa de Docker) em `.build-tools/runtime/rootfs-<abi>.tgz`. |
| `stage.sh <abi>` | Copia o Alpine da arquitetura para os assets do APK. `build-apk.sh` e `emulator/install.sh` já chamam. |
| `build-sources.sh` | Monta `mybots-fontes-gpl.tar.gz`, publicado junto de cada APK. |
| `sources.lock`, `rootfs.lock` | Versões e SHA-256 do que é baixado. |
| `patches/` | Correções do PRoot para o Android. |

## Como roda no aparelho

- `files/runtime/rootfs` é substituído quando o APK traz outro Alpine. `files/runtime/home` é o `/root` de dentro (dados do supervisor, IAs e logins) e nunca é substituído.
- O Android só deixa executar arquivos de `nativeLibraryDir`, por isso `libproot.so` e `expo.useLegacyPackaging=true`.
- Os scripts `mybots-pair.sh` e `mybots-restart.sh` (assets do app) iniciam o supervisor; `EmbeddedRuntime` os executa. `MYBOTS_EMBEDDED=1` marca o modo.
- O PRoot informa o código de saída do último processo a terminar; por isso o `timeout` dos comandos é feito pelo timer em Kotlin.

## Emulador

O emulador é x86_64 e o celular é ARM64. A política seccomp do Android no x86_64 bloqueia chamadas antigas (`fork`, `mkdir`, `dup2`…) que o musl usa; o patch `proot-0005` as refaz com as equivalentes novas. Esse patch não muda nada no ARM64, então passar no emulador não prova o ARM64: o teste final precisa de um celular real.

Com pouca memória, não rode `npm test` ou builds junto com o emulador: o Linux mata o emulador por falta de memória.

## Licenças

Todo APK publicado com este ambiente leva junto as fontes do que é GPL/LGPL: `build-sources.sh` monta o pacote e `publish-release.sh` não publica sem ele. Ver `THIRD_PARTY_NOTICES.md`.
