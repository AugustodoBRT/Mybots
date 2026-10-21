# MyBots: plano de desenvolvimento das próximas etapas

Escrito em 20/10/2026, depois da v22 (0.9.1). Serve para abrir uma conversa nova e pedir: **"leia docs/PLANO-DESENVOLVIMENTO.md e faça a etapa A"** (ou a próxima pendente). Cada etapa termina com APK entregue e registro em `docs/progresso.md`.

## 1. Onde o projeto está

App Android (React Native/Expo SDK 57, pasta `mobile/`) + **supervisor** Node/SQLite que roda no **Termux** do celular (pasta `supervisor/`) e usa o **Codex** (`pkg install codex`) ou o **Claude Code** (dentro do proot-distro Debian) já logados. O app fala com o supervisor por WebSocket autenticado em `127.0.0.1`; o supervisor expõe as ferramentas aos modelos por MCP (`supervisor/mcp/`).

Funcionando e aceito pelo usuário no POCO F7 (HyperOS, Android 16): conversa com fila de mensagens, ditado por voz em barra, anexos (texto/imagem), níveis de acesso (Pouco/Médio/Total, `bot.access`), leitura de notificações do celular, apps das contas (Gmail etc. via conectores oficiais do Claude/ChatGPT), notificações dos bots como MyBots (toque abre a conversa), rotinas por horário/notificação (`supervisor/routines.mjs`), MCP próprio em "Avançado".

Histórico detalhado: `docs/progresso.md`. Plano de produto original: `docs/PLANO-MYBOTS-AGENTES.md`. Segurança: `docs/seguranca.md`.

## 2. Como trabalhar neste projeto (regras que já custaram caro)

- **Idioma**: tudo para o usuário em português do Brasil, com acentos.
- **PC em toda entrega**: depois de publicar cada Release, executar sempre `scripts/build-desktop.sh` e conferir o serviço `mybots-pc`. A pessoa informou em 21/10/2026 que sempre atualizará o celular; não esperar outra confirmação nem deixar a atualização do PC pendente. Testes anteriores à Release continuam usando nó isolado.
- **Testes**: `npm test` (105 testes hoje) antes de qualquer APK. Alguns testes usam o **Claude Code real** e o **Codex real** com API simulada; mantenha-os passando.
- **Testar no emulador antes de entregar** (o usuário pediu): ver `scripts/emulator/README.md`. Fluxo: `scripts/emulator/start.sh --window` → `install.sh` → `wait-supervisor.sh` → `node rpc.mjs ...` / `ask.sh <botId> "..."` / `screen.sh`. Ao testar com o Codex real, use o modelo **gpt-6-luna** (pedido do usuário). Pedir só dados mínimos das contas reais (ex.: contagem de e-mails, não conteúdo).
- **Entrega**: subir `versionCode`/`versionName` em `mobile/android/app/build.gradle` e `mobile/app.json`, `scripts/build-apk.sh --offline` (ARM64), copiar para `dist/apk/mybots-vNN.apk` + `.sha256`, conferir certificado `fac61745…033b9c` com `apksigner`, commit e push em `AugustodoBRT/Mybots` (público; **sem coautoria de IA nos commits**) e `scripts/publish-release.sh NN "novidades"`: o app se atualiza sozinho pela Release. O link local (`scripts/serve-apk.mjs`) fica como alternativa. Nunca publicar build x86_64 como Release normal (só para teste, apagando depois).
- **Pacote do supervisor**: lista explícita de arquivos em `scripts/package-supervisor.mjs` (novo módulo = adicionar lá); testes embarcados listados também em `mobile/modules/termux-bridge/android/src/main/assets/mybots-pair.sh`. Acima de 60 KB vai em partes (`pairPart`).
- **Banco**: migrações em `supervisor/database.mjs` (versão atual 5). Nova tabela = nova versão, nunca alterar uma migração já entregue.
- **Armadilhas conhecidas**:
  - Codex novo esconde ferramentas MCP atrás da busca de ferramentas, que roda no `code_mode_host`: **não desligar `code_mode_host`** (há teste).
  - Acionar o Termux sempre com `startForegroundService` (com `startService` o Android recusa em segundo plano).
  - Comando RUN_COMMAND sem `RUN_COMMAND_STDIN` deixa a entrada aberta: script não pode ler stdin nesse caso.
  - Mudança de permissão/nível reinicia a sessão do modelo (senão ele repete "não tenho acesso").
  - Conexões longas (long-poll) precisam ser encerradas no `close()` do supervisor, senão a trava não é liberada e a versão nova não sobe.
  - Strings Kotlin com `$`: escrever `${'$'}` em scripts embutidos.
  - Emulador: build x86_64 só para ele; DNS do Termux precisa de `10.0.2.3`; `adb run-as` não tem rede.

## 3. Etapas, em ordem

### Etapa A: trabalho com a tela apagada (concluída na v23, aceita no POCO)

**Problema**: rotinas e o supervisor dependem do Termux acordado; o HyperOS pode dormir/matar processos. O bot "agir sozinho" não é confiável.

**Fazer**:
1. Serviço nativo em primeiro plano do MyBots ("MyBots ativo", notificação fixa discreta, canal de baixa importância) que: mantém o leitor de notificações e a entrega de avisos vivos; verifica o supervisor (`/health`) a cada minuto e o reinicia pelo `pair` se caiu; segura um wake lock curto só enquanto uma rotina roda.
2. Agendamento de rotinas também pelo Android (`AlarmManager.setExactAndAllowWhileIdle` ou WorkManager) para acordar o serviço no horário; o supervisor continua sendo quem decide e executa.
3. Termux: `termux-wake-lock` já é chamado no pair; conferir que o serviço do Termux fica em primeiro plano.
4. Ajustes → "Funcionar com a tela apagada": estado (bateria sem restrições? início automático? último heartbeat), botões que abrem as telas certas do HyperOS/Android.
5. Painel na Atividade: interrupções detectadas (heartbeat atrasado já existe em `heartbeats`) e retomadas.

**Aceite**: no emulador, com a tela apagada e `adb shell dumpsys deviceidle force-idle`, uma rotina de 15 min roda e notifica; o supervisor morto é reiniciado sozinho. No POCO: rotina diária roda com a tela apagada.

### Etapa B: navegador de cada bot (ver ele mexendo) — concluída na v24, aceita no POCO (v26)

**Decisão já tomada com o usuário**: navegador dentro do app (WebView), não Chromium no Termux.

**Fazer**:
1. Módulo nativo `BotBrowser`: uma WebView por bot com **perfil isolado** (androidx.webkit `Profile`/`WebViewCompat` multi-profile; se o aparelho não suportar, um diretório de dados por bot), cookies persistentes por bot.
2. Ferramentas MCP novas: `browser.open(url)`, `browser.read()` (texto + lista de elementos clicáveis com ids), `browser.click(id)`, `browser.type(id, text)`, `browser.screenshot()`, `browser.wait(texto/seletor)`. Comandos vão do supervisor ao app pela conexão do app (como `bot.notify`) ou pelo serviço da etapa A.
3. Na conversa: painel "Navegador do bot" que mostra a página ao vivo; botão **Assumir** (a pessoa toca/digita: login, CAPTCHA, código) e **Devolver ao bot**. O bot pede ajuda com um cartão "Preciso que você entre em …".
4. Política: navegar e ler seguem o nível de acesso; enviar formulários/compras pedem aprovação no Médio. Senhas nunca vão ao modelo (a pessoa digita no Assumir). Conteúdo da página é dado externo, nunca instrução.
5. Limitação a comunicar: login do Google não funciona em WebView (usar os conectores da conta).

**Aceite**: no emulador, o bot abre um site, lê, preenche um formulário de teste; a pessoa assume para um login fictício e devolve; perfis de dois bots não compartilham cookies.

### Etapa C: bot da faculdade (SIGAA) de ponta a ponta — concluída (v25/v26), aceita no POCO com o SIGAA do CEFET-MG

Objetivo original do produto (ver `docs/PLANO-MYBOTS-AGENTES.md`, seção do caso da faculdade). Nada específico de SIGAA no código: o bot deve concluir sozinho o que fazer.

**Fazer**: modelo de bot "Faculdade" (instruções + nível Médio); ao ouvir "acompanhe minhas atividades do SIGAA", ele cria as rotinas (notificação do Gmail com "SIGAA" + checagem diária), lê os avisos (conector da conta ou e-mail), entra no SIGAA pelo navegador da etapa B quando precisar de detalhes (a pessoa faz o login uma vez), registra cada atividade como pendência com prazo e avisa um dia antes. Evitar duplicar atividades (chave: disciplina + título + prazo).

**Aceite**: com e-mails/notificações simulados no emulador, as pendências aparecem certas, sem duplicar, e o aviso de véspera chega como MyBots.

### Etapa D: arquivos de ida e volta (ampliada com o usuário em 20/10/2026) — concluída na v27 (emulador); falta o SIGAA real no POCO

Pedido: "vai no SIGAA, abre a atividade, baixa o arquivo, resolve e me manda aqui" (ou só me manda o arquivo). Um APK só no fim da etapa inteira.

1. **Ler arquivos**: PDF (texto; páginas como imagem quando escaneado, pelo `PdfRenderer` do Android), Word (.docx), planilhas (.xlsx/.csv) e PowerPoint (.pptx), com limites de páginas/caracteres. Vale para anexos da pessoa e downloads do bot.
2. **Baixar pelo navegador do bot**: anexos de páginas (ex.: SIGAA) com o login daquele navegador; guardados no espaço do bot (limite de tamanho; tipos executáveis bloqueados).
3. **Bot manda arquivos**: ferramenta para criar e enviar PDF, Word, planilha ou texto a partir do que ele escrever, e para repassar um arquivo baixado. Na conversa: cartão com Abrir, Compartilhar e Salvar em Downloads.
4. **Respostas estruturadas**: tabelas e gráficos (barras, linhas, pizza) na conversa e nos arquivos gerados.

Fora por enquanto: entregar arquivos em sites (upload no SIGAA), que pediria aprovação.

### Etapa E: identidade visual — concluída na v28 (emulador); aceite visual no POCO pendente

Logo, ícone do app (todas as densidades + ícone adaptativo + ícone de notificação monocromático) e avatares dos bots. O usuário sugeriu gerar no **Gemini pelo Chrome** (ele está logado). Validar contraste no tema escuro do app.

### Pacote de 20/10/2026 (v29) — concluído no emulador; aceite no POCO pendente

Compartilhar com o bot (Direct Share), atualização dentro do app pelas Releases do GitHub, `browser_upload` (entregar arquivos em sites, sempre com aprovação), uso por bot com tokens e limites da assinatura, widget com rostos animados. Detalhes em `docs/progresso.md` (v29). Ideias que ficaram para depois: responder pela notificação e botão "Concluir" no aviso de prazo; prazos no Google Agenda.

**Etapa G concluída na v35 (sem coordenador, a pedido do usuário).** Próximas possíveis: bot coordenador (só se o usuário criar um), economia de tokens (ferramentas só permitidas por bot; resumo de conversas longas), responder pela notificação, prazos no Google Agenda, etapa F (vozes).

### Etapa F: vozes por bot e "ligação"

Cada bot com uma voz (síntese do Android `TextToSpeech` como base gratuita; opção de serviço externo tipo ElevenLabs com chave no cofre). Modo ligação: ditado contínuo (já existe o reconhecimento em barra) → resposta falada, com interrupção ao falar. Assinaturas de app (Google AI Pro, ChatGPT, Claude) não dão API de voz utilizável aqui.

### Etapa G: salas com vários bots

Conversa em grupo com @menção, um bot coordenador que delega e acompanha, limites contra ciclos e sem compartilhar a memória inteira entre bots (referência de produto: OpenMausBot, Apache 2.0).

## 4. Pendências menores conhecidas

- Rotinas: aceite no POCO ainda não feito (criar pelo chat, aprovar, "Executar agora").
- Claude dentro do proot: confirmar que os conectores da claude.ai aparecem em Ajustes no celular.
- Reconhecimento de voz: emulador não permite falar; validar sempre no celular.
- Assinatura de release própria (`docs/assinatura.md`) ainda não ativada; manter o certificado atual até decidir a migração com backup testado.
