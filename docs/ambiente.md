# Ambiente — etapa 0A

Registro em 19/10/2026. A validação no POCO será feita pelo proprietário.

- Desenvolvimento: Codex CLI **0.162.1**. Conferidos `codex --version`, `codex exec --help` e `codex exec resume --help` antes de alterar os argumentos.
- APK anterior encontrado: `com.mybots.app`, versionCode **6**, versionName **0.1.0**, ARM64. Cópia preservada em `dist/apk/mybots-v6.apk`.
- Nova entrega: mesmo pacote e keystore de debug existente, versionCode **7**, versionName **0.1.1**. A keystore própria de release pertence à etapa 0B.
- Dados anteriores de `.data/bots.json` e `mybots-local.json` são preservados. Sessões do PC não são importadas para o Termux, nem o contrário: os arquivos de sessão pertencem a cada instalação do Codex.
- O histórico de testes do usuário registra Android 16 / SDK 36, HyperOS OS3.0.303.0.WOLMIXM e Termux F-Droid 0.118.3. Esses dados ainda precisam ser reconfirmados na etapa 0B.
- O aparelho já apresentou ausência de `/data/data/com.termux/files/usr/bin/node`; a ponte desta etapa usa Bash e utilitários do Termux, sem depender de Node no celular. O comando `codex` continua sendo localizado pelo shell de login.
- Antes de gerar uma resposta, o executor no Termux consulta versão e ajuda de `exec` e `exec resume`. O resultado fica em `~/.mybots/environment.txt`; opções essenciais incompatíveis produzem erro visível em vez de gerar uma conversa com argumentos presumidos.
- A versão real do Codex, Node, SQLite e `app-server` no celular permanece pendente de coleta/validação na etapa 0B. Nenhuma biblioteca SQLite foi escolhida nesta entrega.

Referência consultada: [modo não interativo do Codex](https://learn.chatgpt.com/docs/non-interactive-mode), eventos `thread.started`, `turn.completed` e retomada por ID. A compatibilidade efetiva depende da CLI instalada no aparelho.

## Compilação persistente

SDK, NDK, ferramentas de linha de comando, JDK e caches do Gradle ficam em `.build-tools/`, ignorada pelo Git. O comando `scripts/build-apk.sh` reaproveita esse ambiente. Não apagar essa pasta nas próximas entregas. Dependências adicionais só serão baixadas se o projeto ou as versões exigirem; a pasta `/tmp` fica apenas com logs transitórios.

## Etapa 0B — v8

O usuário confirmou funcionamento aparente da conversa na v7 e autorizou a próxima etapa. Nova versão: `versionCode 8`, `versionName 0.1.2`, mesmo pacote e assinatura anterior. A chave própria de release foi preparada e ainda não substitui a chave da instalação existente; ver [assinatura.md](assinatura.md).

A v8 acrescenta **Backup e diagnóstico → Ver diagnóstico do aparelho**. Essa tela consulta o ambiente real do Termux e mostra também dados nativos do Android/HyperOS e da instalação do Termux. O relatório do shell fica em `~/.mybots/diagnostico.txt`; as informações podem ser copiadas pelo app. Node/SQLite ausentes são registrados como ausentes, sem instalar bibliotecas automaticamente. O catálogo de modelos continua usando app-server e a tela informa se respondeu na conexão atual.

Ainda não recebemos o relatório coletado pela v8; as versões atuais do aparelho não foram inventadas ou inferidas da versão do PC.

## Etapa 1 — supervisor v9

No PC: Node v26.11.1 com SQLite nativo (consulta retornou 3.53.4). Foi usado `node:sqlite`, sem `better-sqlite3` e sem addon compilado. Biblioteca WebSocket pura JS: `ws`, versão 8.22.0 registrada no lockfile do supervisor.

A receita oficial de `nodejs-lts` consultada em 19/10/2026 informa Node 24.18.0 e dependência `libsqlite`, com `--shared-sqlite`. Isso informa a preparação, não comprova qual versão está instalada no POCO. O bootstrap consulta o runtime real, prepara `nodejs-lts` se necessário, confere `node:sqlite` e executa os testes embarcados antes de migrar.

A versão/ajuda reais do Codex ficam em `~/.mybots/ambiente-supervisor.txt`. O resultado dos testes fica em `~/.mybots/testes-supervisor.txt`. O relatório coletado no POCO continua pendente; nenhuma versão do PC foi atribuída ao celular.
