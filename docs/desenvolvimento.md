# Desenvolvimento do MyBots

Notas para quem quer mexer no código. Para **usar** o app, veja o [README](../README.md), [celular.md](celular.md) e [computador.md](computador.md).

## Mapa do repositório

| Pasta | O que tem |
|---|---|
| `mobile/` | O app (React Native + Expo SDK 57): telas, janela do computador (a mesma interface exportada como web), módulos nativos Android em `mobile/modules` (navegador dos bots, Linux embutido, API do aparelho) e o web app do iPhone (`mobile/pwa`) |
| `supervisor/` | O supervisor (Node + SQLite): fila de tarefas, rotinas, pendências, memória, permissões, ferramentas dos bots por MCP, sincronização e relé. É o mesmo código no celular (dentro do Linux embutido ou no Termux) e no computador |
| `pc/` | O nó do computador: executa as IAs, o navegador (Chrome) dos bots, o controle de tela e o pareamento |
| `desktop/` | A janela do computador (Electron) |
| `packaging/` | Empacotamento dos instaladores (electron-builder) |
| `relay/` | O relé que liga celular e computador fora de casa (só encaminha bytes cifrados) |
| `lib/` | Código compartilhado (executores do Codex e do Claude, preços) |
| `scripts/` | Build, publicação e ferramentas de teste |
| `scripts/runtime/` | O Linux embutido do APK (Alpine + Node + PRoot): [README próprio](../scripts/runtime/README.md) |
| `tests/` | Testes automatizados |

## Preparar e testar

Requisitos: Node.js 22.13 ou mais novo.

```bash
npm ci --prefix supervisor      # dependências do supervisor
npm install --prefix pc         # dependências do nó do computador
npm install --prefix mobile     # dependências do app
npm test                        # testes (usam IAs simuladas, não gastam a sua assinatura)
```

`node scripts/check-models.mjs` consulta o catálogo de modelos da conta do Codex sem gerar resposta. `npm start` sobe apenas o protótipo web antigo (`server.mjs`, em `127.0.0.1:3210`).

## Gerar o APK (Android, ARM64)

```bash
scripts/build-apk.sh --offline
```

O script usa o SDK Android (plataforma 36), o JDK 17 e os caches do Gradle guardados em `.build-tools/` (fora do Git; não apague). Ele também prepara o Linux embutido (`scripts/runtime/stage.sh arm64-v8a`); para montar o Alpine do zero é preciso Docker (`scripts/runtime/build-rootfs.sh`). O APK sai em `dist/apk/mybots-vNNN.apk`. O pacote é `com.mybots.app` e o número da versão (versionCode) sobe a cada entrega; atualizar por cima mantém os dados, e a assinatura precisa ser a mesma da versão instalada.

## Publicar

- **Android**: `scripts/publish-release.sh NNN "notas em Markdown"` publica `dist/apk/mybots-vNNN.apk`, o `.sha256` e as fontes GPL/LGPL (`mybots-fontes-gpl.tar.gz`, obrigatórias) como a Release mais recente; o app se atualiza a partir dela.
- **Computador**: `scripts/publish-desktop.sh` gera os instaladores do Linux na Release rolante `pc-latest`; Windows e macOS saem pela CI (`.github/workflows/desktop.yml`).
- **iPhone**: `scripts/publish-pwa.sh` publica o web app na VM do relé.

## Testar num emulador

Veja [scripts/emulator/README.md](../scripts/emulator/README.md). O emulador é x86_64 e o celular é ARM64: o que passar no emulador ainda precisa ser conferido num celular real, principalmente o Linux embutido.

## Outros documentos

| Documento | Conteúdo |
|---|---|
| [supervisor.md](supervisor.md) | Protocolo, recuperação e dados do supervisor (escrito na etapa 1) |
| [seguranca.md](seguranca.md) | Modelo de segurança e permissões, por recurso |
| [computador.md](computador.md) | MyBots no computador: pareamento, relé, sincronização, navegador, controle de tela |
| [celular.md](celular.md) | MyBots no celular: modos de uso, permissões e bateria |
| [progresso.md](progresso.md) | Histórico de cada versão e o que foi validado |
| `PLANO-*.md` | Planos de etapas já feitas ou em andamento (registro histórico) |
