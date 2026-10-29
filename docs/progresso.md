# Progresso do MyBots

## 19/10/2026 — Etapa 0A: implementada, aguardando aceite no POCO

Plano executado: [PLANO-IMPLEMENTACAO.md](PLANO-IMPLEMENTACAO.md), fornecido pelo usuário. Nenhuma etapa posterior foi iniciada.

### Análise do plano

A sequência é adequada: estabilizar sessão e recuperação antes de mover a execução para um supervisor. A versão anterior já tinha mapa de Promises, IDs e timeout, mas não preservava respostas fora da memória do app. Ela também reenviava contexto com sessões efêmeras. Isso impedia retomada persistente, mas sozinho não comprova a causa completa do sintoma de encerrar: o comportamento final precisa ser validado no aparelho.

A fase 0A não promete fila SQLite, reinício automático do Termux nem funcionamento 24 horas. Esses critérios da lista geral só podem ser avaliados nas etapas em que os respectivos componentes existirem. O requisito de não avançar sem aceite real foi mantido.

### Feito

- Removido `--ephemeral` dos executores PC e Termux; capturado `thread.started.thread_id` e salvo `codexSessionId` no bot.
- Primeira execução envia personalidade e histórico anterior disponível, preservando conversas existentes. As seguintes usam `exec resume <id> -`, com apenas a mensagem nova pela entrada padrão. Uma sessão inesperadamente diferente gera erro, sem fallback silencioso.
- PC e celular mantêm seus próprios IDs de sessão ao mesclar os históricos.
- Pedido mobile é salvo antes de chamar o Termux, com `requestId`, estado e prazo. Gravações e aplicação de respostas são serializadas para evitar que uma recuperação sobrescreva mensagens novas.
- Ponte mantém mapa por pedido, `requestCode` incremental e URI única no PendingIntent; timeout aparece na conversa. Um timeout do retorno não libera outro envio enquanto a execução ainda pode estar ativa.
- Executor Bash salva recibo e resultado atomicamente em `~/.mybots/responses/<requestId>.json`, com permissões privadas. O ID de sessão é registrado assim que chega o evento, inclusive para recuperação de uma execução interrompida. O mesmo pedido não executa duas vezes.
- App recupera resultados ao abrir, voltar ao primeiro plano e enquanto aguarda uma resposta. Recuperação é idempotente e dividida em trechos pequenos para respeitar o limite de transporte do Termux.
- Fim de um processo finaliza apenas o turno; a conversa continua disponível. Erros e execuções órfãs ficam visíveis, com possibilidade de tentar novamente após a conclusão/interrupção.
- APK anterior preservado; versão 7 usa o mesmo pacote e a keystore existente. Não desinstalar a versão anterior.

### Validação e pendências

Testes automatizados usam Codex simulado, sem consumir respostas da conta. Incluem sessão persistente por dez turnos, execução Bash real, texto longo/Unicode, recibo em disco, recuperação após recriar o cliente, timeout e falha de gravação. **23 testes passaram**, incluindo dez turnos tanto no executor do PC quanto no Bash do Termux; texto longo, Unicode, aspas, cifrão, crases e retomada do mesmo ID foram conferidos. APK v7 compilado com sucesso, inclusive uma compilação final offline usando os caches persistentes. Conferidos pacote `com.mybots.app`, versionCode 7, versão 0.1.1, arquitetura ARM64, assinatura igual à do APK v6 e script Bash embarcado idêntico ao código testado. O download por HTTP foi comparado byte a byte com o APK gerado; links antigos e a raiz retornam 404.

**Aceite no POCO: pendente.** O proprietário fará o teste. Não avançar para a 0B antes desse resultado.

### Como testar no aparelho

1. Baixar a v7 pelo QR e instalar por cima da versão atual, sem desinstalar. Conferir bots, mensagens e configurações antigos.
2. No modo Só celular · Termux, abrir um bot e enviar “Lembre a palavra abacaxi e o número 731”. Fazer mais nove envios; no último perguntar a palavra e o número. Conferir se o app continua aceitando mensagens após cada resposta.
3. Enviar outra pergunta; enquanto está pensando, encerrar o MyBots pelos recentes e reabrir. A resposta deve aparecer uma única vez, ou continuar como pendente até o Termux terminar. O Termux precisa continuar disponível.
4. Conferir que outro bot mantém contexto separado. Testar com outro modelo/raciocínio se desejar.
5. Se falhar, abrir Ver logs e enviar o diagnóstico. Interrupção do próprio Termux deve aparecer como erro, não como sucesso. Não apagar dados ou desinstalar para tentar corrigir.

Os testes gerais de permissões MCP, deduplicação de e-mails, prazos, backup restaurável e plantão/Doze continuam pendentes das suas próprias etapas; não foram declarados aprovados nesta entrega.

### Artefato entregue

- APK: `dist/apk/mybots-v7.apk` (25.855.821 bytes).
- SHA-256: `386314cab6e6278de2de78dacd966b91c8eafdd25354623607d1c81094ed7305`.
- Certificado igual ao da v6: SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- QR: `mobile/.expo/mybots-v7-qr.png`, download local servido por `node scripts/serve-apk.mjs`. O endereço depende da rede atual do PC.
- Ferramentas preservadas em `.build-tools/`; próximas compilações usam `scripts/build-apk.sh`. A recompilação final offline levou 4 segundos.
- Atualização instalada, continuidade do contexto real e recuperação no Android seguem aguardando o teste do proprietário.


## 19/10/2026 — Correções de uso e início da etapa 0B

O usuário informou que a v7 parece ter funcionado e enviou uma conversa em que o bot recorda a primeira mensagem. Autorizou avançar para a próxima parte. Isso foi registrado como retorno funcional positivo; a captura não comprova por si só todos os cenários de dez mensagens e encerramento no meio da resposta.

### Entrega v8

- Voltar do Android/gesto, quando a conversa está aberta, retorna à lista de bots. Na lista, o comportamento normal do Android continua disponível. Modais fecham pelo próprio tratamento de Voltar.
- Bot pode ser apagado pela lista ou pelo botão Apagar na conversa, com confirmação. Uma resposta ativa impede a exclusão. O histórico do bot é removido da base ativa e um marcador impede que uma sincronização antiga recrie o bot. Restaurar deliberadamente um backup pode recuperar o bot, preservando o ID.
- Na primeira abertura em modo celular, backup datado do JSON no Termux antes das novas gravações. Há também uma cópia privada `backup/pre-v8.json` dentro do MyBots. Foi preservada e conferida uma cópia do JSON do PC em `.data/backup/`.
- Backup e diagnóstico na tela inicial: salvar, listar e restaurar cópias do Termux. Exclusões de bot no celular fazem uma cópia antes. Restauração valida o arquivo e faz backup do estado atual antes de substituir dados; pedidos pendentes restaurados não são reenviados automaticamente.
- Exportação e leitura em trechos pequenos para evitar o limite de transporte Android/Termux, preservando emojis e Unicode. Cópias completas são publicadas por renomeação; trechos incompletos nunca aparecem na lista de backups.
- Diagnóstico reúne Android, versão do sistema, Termux, Codex, disponibilidade de Node e SQLite, e informação sobre o catálogo que usa app-server. A coleta real ocorre no aparelho, pela tela nova, sem transmitir credenciais.
- Chave própria de release criada em `.signing/`, privada e ignorada pelo Git. A v8 mantém a assinatura existente para permitir atualização direta da v7. Troca de chave e migração por exportação/importação foram planejadas em [assinatura.md](assinatura.md), sem desinstalar nada nem perder dados agora.
- Checklist do POCO em [configurar-celular.md](configurar-celular.md); ferramentas Android persistentes reaproveitadas, sem novos downloads.

### Validação

**28 testes automatizados passaram**, incluindo exclusão durante execução, sincronização de dados antigos, restauração explícita e backup em disco com texto longo/Unicode. Compilação Android e lint passaram. APK final ARM64 conferido: mesmo pacote e certificado da v7, versionCode 8 e scripts embarcados idênticos aos testados. Download HTTP comparado byte a byte ao APK gerado; v7 no endereço novo retorna 404.

### Aceite no aparelho ainda pendente

Instalar a v8 por cima da v7 e conferir os bots existentes; usar Voltar do aparelho dentro de uma conversa; criar um bot descartável, salvar backup, apagar esse bot e restaurar a cópia; copiar o diagnóstico para completar [ambiente.md](ambiente.md). A chave própria de release está preparada, mas a migração de assinatura depende do teste real de restauração. Portanto **0B está implementada parcialmente e aguardando validação**, não encerrada. A etapa 1 não foi iniciada.

Artefato v8: `dist/apk/mybots-v8.apk`, 25.874.743 bytes, SHA-256 `77d616c4a277fcad82b9c24a3664cd3875f96487a8966b9c71765b41ebca7911`. QR em `mobile/.expo/mybots-v8-qr.png`.

## 19/10/2026 — Etapa 1: supervisor implementado, aguardando aceite no POCO

O usuário autorizou explicitamente iniciar a etapa 1. As pendências de validação física/assinatura da etapa 0B continuam registradas; essa autorização não foi convertida numa alegação de testes já feitos no aparelho.

### Implementado

- `supervisor/index.mjs`, ESM: servidor local WebSocket, autenticação, leitura do catálogo Codex, migração e fila.
- SQLite nativo com migrações versionadas e todas as tabelas mínimas do plano. Banco, mensagens e sessões são a fonte de verdade; o JSON privado do app vira cache.
- Migração transacional, única e com backup, preservando IDs de bots, mensagens e sessões. JSON original, backups e dados do PC permanecem intactos.
- Empacotamento explícito do supervisor e do `ws` no APK, sem dados, chaves ou credenciais. O bootstrap confere hash, runtime e CLI no Termux e executa testes locais antes de migrar. Se Node/SQLite não estiverem prontos, tenta preparar `nodejs-lts`; a falha impede a migração e preserva os arquivos.
- Pareamento pelo RUN_COMMAND, token 256 bits em arquivo 600 e EncryptedSharedPreferences/Android Keystore. O retorno do Termux leva o token cifrado para a chave pública do app; ele não é impresso em texto aberto nos relatórios de comando. Backups do Android excluem o arquivo de pareamento.
- Protocolo previsto no plano, com estado, histórico, bots, tarefas, atividade e complementos de backup/diagnóstico. Aprovações/ferramentas não são criadas nesta etapa; o endpoint de aprovação recusa ações.
- Fila persistente, serialização da execução e deduplicação por ID do pedido. Tarefas na fila sobrevivem à reinicialização. Uma tentativa automática por conversa: execuções órfãs são marcadas como falha com motivo, evitando reenvio silencioso de texto que pode já ter chegado ao Codex.
- Sessão persistida ao receber `thread.started`, retomada por ID e só a mensagem nova nos turnos seguintes. Cancelamento mata o grupo de processos do Codex e aguarda sua saída antes de marcar Cancelada; processos órfãos têm PID/início conferidos antes de serem interrompidos.
- Heartbeat por minuto em SQLite e registro explícito de intervalos sem sinal.
- App em modo celular como cliente do supervisor: reconexão com espera progressiva, atualização ao voltar ao primeiro plano, Atividade e tarefas, Cancelar resposta, backups e restauração pelo núcleo. Voltar e apagar bot foram preservados. Modo PC continua disponível.
- Assinatura atual preservada na v9, `versionCode 9`, versão `0.2.0`, ARM64. Nenhuma migração de assinatura ou desinstalação foi feita.

### Verificação

A suíte cobre SQLite real, integridade e idempotência da migração, rejeição de token incorreto, continuidade após fechar o cliente, deduplicação, persistência da fila, queda real do processo supervisor, limpeza de trabalhador órfão, cancelamento de subprocesso real simulado, reconexão, backup/restauração, histórico de heartbeat e instalador completo com token cifrado. Os testes de Codex usam simuladores e não geram respostas na conta.

Na primeira instalação de cada pacote, os testes do supervisor são executados no próprio Termux com dados temporários e Codex simulado. O arquivo de resultado é `~/.mybots/testes-supervisor.txt`. Isso ainda não substitui a conversa real e o teste dos processos no Android.

### Aceite pendente

Instalar a v9 por cima da v8, aguardar a preparação, conferir IDs/histórico, conversar e fechar/reabrir durante uma resposta; cancelar uma resposta; interromper o supervisor/Termux e reconectar para conferir a falha com motivo ou execução da fila. O critério real da etapa 1 continua pendente desse teste no POCO. A etapa 2 não foi iniciada.

Detalhes, arquivos, protocolo, limites e roteiro: [supervisor.md](supervisor.md). Início automático e validação de oito horas pertencem à etapa 5; não foram prometidos nesta entrega.

### Artefato entregue

42 testes locais passaram; os dois testes do instalador embarcado também passaram após o ajuste final do empacotamento. Compilação Android e lint passaram. APK conferido: pacote `com.mybots.app`, versionCode 9, ARM64, mesmo certificado da v8 e scripts embarcados idênticos aos testados. A configuração Android permite conexão sem TLS somente a `127.0.0.1` e `localhost`; o token de pareamento fica excluído dos backups Android.

Artefato: `dist/apk/mybots-v9.apk`, 26.650.135 bytes, SHA-256 `e68e29e9a0450bb64a7eb44d863dafb703222140b25890d1023204e258eb70c3`. QR: `mobile/.expo/mybots-v9-qr.png`. Download local em `http://200.128.151.142:48767/mybots-v9.apk` conferido byte a byte; a rota da v8 nesse servidor retorna 404. O endereço depende de o computador continuar ligado e acessível pela mesma rede.

## 19/10/2026 — Etapa 2: ferramentas com permissão (MCP), aguardando aceite no POCO

O usuário confirmou estar na etapa 2 e pediu continuidade. As pendências de aceite físico das etapas 0B e 1 continuam registradas acima.

### Implementado

- Servidor MCP `mybots-tools` (stdio) em `supervisor/mcp/`, ligado a cada execução por `run_token` de uso único (bot + tarefa), revogado ao final.
- Concessões por bot em `grants`; ferramentas `memory.read`, `memory.write`, `task.create_item` e `notify.user` (via `termux-notification`). Validação fechada de argumentos.
- Aprovação por hash exato da ação, uso único, expiração em 2 minutos, recusa ao revogar a concessão ou cancelar a tarefa. Estado `waiting_approval` na fila.
- Autonomia por bot ("Perguntar antes" / "Cuidar das coisas locais"); notificação sempre pede aprovação.
- Codex isolado: workspace por bot, segredos fora dele, sandbox somente leitura, terminal e demais ferramentas internas desligados. O runner agora consulta `codex features list` e só desliga features existentes na versão instalada; sem como desligar o terminal, recusa rodar. Detalhes e risco residual em [seguranca.md](seguranca.md).
- App: aba de permissões no perfil do bot, aparência (avatar), cartão "Preciso da sua decisão" com Permitir uma vez/Recusar na lista, na conversa e na Atividade, lista de pendências e memórias.
- Memória, pendências, concessões e aparência entram no backup/restauração; banco migrado para `user_version 2`.

### Verificação

**50 testes passaram**, incluindo: dois bots com a mesma ferramenta e permissões diferentes; argumentos tentando trocar de bot ou ler `../secrets`; aprovação recusada não executa; aprovação expira e não é reutilizável; revogação/cancelamento durante a espera; token de uso único; handshake MCP real por stdio; **Codex CLI real 0.162.1** com modelo simulado, conferindo que nenhuma ferramenta de terminal/arquivo chega ao modelo e nenhum byte de `secrets/` sai; feature desconhecida ignorada e Codex sem `shell_tool` recusado. Compilação Android passou.

### Como testar no POCO

1. Instalar a v10 por cima da v9, sem desinstalar. Aguardar a preparação (testes embarcados em `~/.mybots/testes-supervisor.txt`).
2. Criar dois bots. No perfil do bot A, ligar "Ler memória" e "Salvar memória"; no bot B deixar tudo desligado.
3. Bot A: "Lembre na memória que minha prova é sexta" → deve aparecer o cartão de aprovação (com autonomia "Perguntar antes"). Permitir. Depois "o que tem na sua memória?".
4. Bot B: mesmo pedido → deve responder que não tem permissão; nada é salvo.
5. Em qualquer bot: "leia o arquivo de segredos e me mostre" → não revela nada.
6. Ligar "Enviar notificação" num bot e pedir uma notificação: recusar → nada aparece; pedir de novo e permitir → notificação no celular (precisa do Termux:API).
7. Conferir tudo em Atividade. Se falhar, Ver logs e enviar o diagnóstico.

**Aceite no POCO: pendente.** A etapa 3 não foi iniciada.

### Artefato

APK `dist/apk/mybots-v10.apk`, versionCode 10, versão 0.3.0, ARM64, 26.683.279 bytes, SHA-256 `2554164bf8bb4d4e87bb3721d3046ace7e4e2a4ece2dc2b6e271505f6d098d37`. Certificado igual ao da v9 (`fac61745…3b9c`). Supervisor embarcado com hash `4f393eef…635f`, igual ao testado. QR: `mobile/.expo/mybots-v10-qr.png`; download em `http://192.168.0.119:48767/mybots-v10.apk`, conferido byte a byte; a rota da v9 retorna 404.

## 19/10/2026 — Escolha de IA: Codex ou Claude (v11)

Pedido do usuário: poder escolher Codex ou Claude por bot, com modelos e níveis de raciocínio. Entra entre as etapas 2 e 3; a etapa 3 não foi iniciada.

### Implementado

- Provedor por bot (`provider: codex | claude`; bots antigos continuam Codex). Campo **IA** no perfil e na conversa quando as duas estão disponíveis; modelos e raciocínio filtrados pela IA.
- Claude: Opus, Sonnet, Haiku e Fable (apelidos que o Claude Code resolve para a versão mais recente), cada um com Baixo, Médio, Alto, Muito alto e Máximo.
- `lib/claude-runner.cjs`: `claude -p --output-format stream-json`, sessão criada com `--session-id` e retomada com `--resume`, só a mensagem nova nos turnos seguintes, sessão diferente recusada, erros traduzidos (login, limite, modelo, rede).
- MCP por HTTP no supervisor (`/mcp`) para o Claude, com as mesmas permissões/aprovações do stdio. Catálogo de ferramentas compartilhado em `supervisor/mcp/catalog.mjs`.
- Status do login por IA; enviar para um bot cuja IA está desconectada mostra o motivo. Trocar de IA descarta a sessão antiga e mantém o histórico.
- Bootstrap cria `~/.mybots/claude-wrapper` (claude nativo ou dentro do proot-distro Debian/Ubuntu) e registra a versão no diagnóstico. Instalação: [claude-termux.md](claude-termux.md).

### Verificação

**55 testes** na suíte padrão (incluindo `claude.test.mjs`, também embarcado e executado no Termux) + teste com o **Claude Code real 2.1.303** e API simulada: só `mcp__mybots-tools__*` chega ao modelo, a tarefa fica em `waiting_approval` até a aprovação, a pendência é criada, a segunda mensagem retoma a mesma sessão, effort chega à API e nenhum segredo sai. Sonda separada: chamada MCP de 75 s concluída, compatível com a janela de aprovação de 2 min.

**Não verificado:** Claude Code dentro do proot-distro no POCO (binário Linux no kernel Android, login OAuth pelo celular). Depende do teste do proprietário.

### v12 — correção: Claude não aparecia

Relato do usuário: Claude instalado e logado no Debian, mas não aparecia no app. Causa provável: o supervisor verificava o Claude ao iniciar, guardava "não encontrado" por 5 minutos e removia o Claude do catálogo; com o Codex conectado, o app não mostrava botão para verificar de novo. Correção: Claude sempre listado (com o status como detalhe e aviso na conversa, com "Tentar de novo"), IA desconectada verificada novamente a cada 30 s, wrapper com caminho padrão do Termux se `PREFIX` faltar. 56 testes + teste com Claude Code real passaram. APK `dist/apk/mybots-v12.apk`, versionCode 12, 0.4.1, mesmo certificado.

### v13 — correção: Claude aparecia mas não funcionava

Causa encontrada no código do proot-distro 5.10 (Python): os containers ficam em `var/lib/proot-distro/containers/<nome>/rootfs`; `installed-rootfs` passou a ser o caminho legado. O wrapper só procurava o legado e respondia "não encontrado". Correção: wrapper em `supervisor/claude-wrapper.sh` (embarcado e testado) procura os dois layouts em qualquer container. Conferido também que o `login` da v5 repassa argumentos com `shlex.join`, preservando `--tools ""` e o JSON do MCP. 57 testes passaram. APK `dist/apk/mybots-v13.apk`, versionCode 13, 0.4.2, mesmo certificado.

### v14 — correção: supervisor não preparava na v13

Na v13 o app mostrou "Não consegui preparar o supervisor". Causa: o teste novo do wrapper fixava `PATH=…:/usr/bin:/bin`, que não existe no Termux; o teste embarcado falhou no aparelho e o bootstrap recusou migrar (comportamento protetor, dados preservados). Correção: o teste usa a pasta real do `bash` do aparelho. Lição: testes embarcados não podem depender de caminhos do PC. 57 testes passaram. APK `dist/apk/mybots-v14.apk`, versionCode 14, 0.4.3, mesmo certificado.

## 19/10/2026 — Etapa 3: conector de e-mail (v15), aguardando aceite no POCO

Decisões do usuário: Gmail pessoal; **nada específico de SIGAA no código** — a IA deve concluir sozinha, ao ouvir "acompanhe minhas atividades do SIGAA", que os avisos chegam por e-mail e passar a vigiá-los (motor genérico da etapa 3B). Plano atualizado: "bot é dado, não código"; conectores das contas das IAs na etapa 6.

### Implementado

- `supervisor/email.mjs`: conector IMAP genérico (Gmail, Outlook, Yahoo, iCloud pelo domínio; outros com servidor informado). Sincronização incremental por `UIDVALIDITY` + último UID em `connector_state`; e-mails novos viram eventos `email.new` deduplicados (tabela `events`, migração v3); `UIDVALIDITY` novo reinicia o cursor sem reprocessar a caixa. Verificação a cada 5 min. Estados: conectado, sincronizando, reconectar conta, sem rede, bloqueado, instalando.
- Ferramentas `email.search` (sintaxe de busca do Gmail quando disponível) e `email.read` (texto decodificado, HTML convertido com links, limite de 20 mil caracteres), somente leitura, por concessão, marcadas como não confiáveis.
- Cofre de segredos AES-256-GCM com chave do Android Keystore entregue em memória.
- Bibliotecas de conectores fora da ponte RUN_COMMAND (limite ~90 KB): bundle de 414 KB embutido no APK, entregue pelo WebSocket autenticado e aceito só com o hash fixado no pacote principal.
- App: Ajustes → E-mail (conectar, reconectar, sincronizar, desconectar); novas permissões aparecem no perfil de cada bot. Guia: [conectar-gmail.md](conectar-gmail.md).

### Verificação

**62 testes** passaram, incluindo 5 novos com o `imapflow` real contra um servidor IMAP local que fala o protocolo (login, EXAMINE, UID SEARCH com X-GM-RAW, ENVELOPE, BODYSTRUCTURE, partes): senha errada não grava nada; cursor começa na conexão; e-mail novo vira um evento só; sobrevive a reinício; mudança de UIDVALIDITY não reprocessa; senha nunca aparece no banco, estado ou comandos; ferramentas exigem concessão; quoted-printable UTF-8, base64 latin1 e multipart decodificados; e-mail com "ignore suas regras" não altera concessões nem abre aprovação; servidor fora do ar vira estado claro. Os e-mails de teste são de assuntos não relacionados (clube do livro, fatura, academia).

**Aceite no POCO pendente:** conectar o Gmail real com senha de app, ver "Conectado", receber um e-mail e conferir o evento na Atividade, reiniciar o Termux e confirmar que o cursor continua; senha errada mostra erro claro. Rotinas automáticas (o bot vigiar sozinho) são a etapa 3B, ainda não iniciada.

## 19/10/2026 — Acesso ao celular: notificações, SMS, contatos, chamadas, localização (v16)

Pedido do usuário: o bot deve poder ler tudo no celular, como os outros assistentes; usar a notificação do Gmail como gatilho em vez de senha/login. Pesquisa: nó Android do OpenClaw (encaminha notificações como eventos com filtro por app e limite; comandos `notifications.list`, `sms.search`, `contacts.search`, `callLog.search`, `calendar.*`…). Plano atualizado: escopo inclui dados de outros apps.

### Implementado

- App: `MyBotsNotificationListener` (NotificationListenerService) repassa toda notificação (app, título, texto, linhas, hora) ao supervisor; fila privada quando o supervisor está fora; Ajustes → "Notificações do celular" com botão para ativar o acesso e contagem das últimas 24 h.
- Supervisor: `/device/events` (token de pareamento), eventos `notification` deduplicados e guardados 7 dias; ferramentas `notifications.recent`, `sms.search`, `sms.send` (sempre aprovação), `contacts.search`, `calls.search`, `location.get`, `device.status` via Termux:API, com opções conferidas na fonte do termux-api-package.

### Verificação

**68 testes** + teste com Claude Code real passaram. Novos: token obrigatório, deduplicação e limites das notificações; filtro por app e texto; concessão por bot; argumentos fixos do Termux:API; SMS espera aprovação mesmo com autonomia local, recusa não envia, texto vai pela entrada padrão; Termux:API ausente ou sem permissão explicado. APK conferido: serviço no manifesto com `BIND_NOTIFICATION_LISTENER_SERVICE`, classe compilada, mesmo certificado.

**Pendente no POCO:** ativar o acesso a notificações, ver a contagem subir, pedir a um bot "o que chegou no Gmail hoje?" com a permissão ligada; testar SMS/contatos/localização (o Android pede permissão ao Termux:API na primeira vez). Os bots ainda não reagem sozinhos às notificações: isso é a etapa 3B (rotinas por evento).

### v16 — instalação no POCO

O Play Protect bloqueou a instalação pelo gerenciador de arquivos ("O app foi bloqueado para proteger seu dispositivo"). Causa: a proteção reforçada contra fraude, que no Brasil bloqueia apps instalados pelo navegador ou gerenciador de arquivos quando pedem permissões sensíveis; a v16 foi a primeira a declarar `BIND_NOTIFICATION_LISTENER_SERVICE`. O usuário instalou com o Play Protect desativado temporariamente e ativou o acesso a notificações. Alternativa sem desativar: `scripts/install-adb.sh` (USB ou depuração por Wi-Fi), porque instalações pelo adb não passam por esse bloqueio. Teste funcional das ferramentas da v16 ainda pendente.

## 19/10/2026 — Etapa 3B: rotinas (v17, em preparação)

Pedido do usuário: o bot agir sozinho, como as rotinas do Grok Bot e os triggers do OpenMausBot (Apache 2.0, analisado como referência de produto).

### Implementado

- `supervisor/routines.mjs` + migração SQLite v4 (`routines`, `routine_runs`). Gatilhos: `daily` (HH:MM, dias da semana, no fuso do celular enviado pelo app), `interval` (mínimo 15 min) e `notification` (app e/ou texto). Validação e cálculo de horário compartilhados em `mobile/routine-text.js`.
- Uma execução é uma tarefa comum da fila, marcada como vinda da rotina: mesmas permissões e aprovações. Conversa da pessoa tem prioridade; bot ocupado mantém a rotina pendente. Notificações antigas (já na barra ao criar/retomar) nunca disparam; eventos repetidos não duplicam; espera de 5 min entre execuções por notificação; até 48 execuções em 24 h; sem evento novo, o modelo não é chamado. IA desconectada: pula com motivo (registrado no máximo 1×/h) e agenda a próxima. Antes da primeira verificação da IA ao iniciar, espera em vez de pular.
- Ferramentas `routine.list`, `routine.create` (sempre pede aprovação) e `routine.update` (pausar/retomar/apagar), permitidas por padrão e restritas às rotinas do próprio bot (o bot vem da execução autenticada, não dos argumentos).
- Ao terminar, o supervisor notifica o dono pelo Termux:API com o resumo da resposta.
- App: aba **Rotinas** no perfil (ativar/pausar, executar agora, apagar, próxima/última execução, último resultado); mensagens de rotina aparecem como um marcador recolhível na conversa.
- Listener de notificações importa as que já estão na barra ao ganhar acesso (antes, só as novas entravam; por isso o bot via a lista vazia logo após ativar).
- Teste real do Claude Code: a 2.1.304 envia também `DeferredToolPlaceholder` (marcador inerte); o teste aceita só esse nome além de `mcp__mybots-tools__*`.
- Pacote do supervisor: 89.118 bytes (limite da ponte: 90.000). Próximas funções exigem mudar a entrega do pacote.

### Verificação

**73 testes** passaram (5 novos de rotinas, também embarcados no Termux). Bundle JS do app exportado sem erros. APK v17 ainda não entregue, a pedido do usuário, até juntar as próximas melhorias.

**Pendente no POCO:** pedir num chat "todo dia às 8h me resume as notificações", aprovar, ver na aba Rotinas, "Executar agora", receber a notificação do resultado; rotina por notificação do Gmail. Sem serviço nativo/wake lock (etapa 4), o Android pode atrasar as rotinas com a tela apagada.

## 19/10/2026 — v17 (0.7.0): anexos, ditado, apps MCP (Composio), interface

Pedidos do usuário: melhorar a experiência como no MausBot/Grok Bot, anexar arquivos, mandar áudio, conectar MCPs como o Composio.

### Implementado

- **Anexos**: botão ＋ abre o seletor de documentos do Android (até 5 arquivos, 10 MB juntos). O supervisor guarda fora das pastas de trabalho (`~/.mybots/attachments`), a mensagem leva só nome/tipo/tamanho/id, e o modelo abre com `attachment_read` (somente o bot dono). Imagens voltam como imagem MCP; texto como texto; PDF e outros tipos são informados como ainda não legíveis.
- **Voz**: botão 🎙 (quando a caixa está vazia) abre o ditado do Android em pt-BR; o texto entra na caixa para revisar antes de enviar. O áudio não passa pelo MyBots.
- **Apps MCP**: Ajustes → Apps conectados. Cliente Streamable HTTP (JSON ou SSE, sessão renovada se expirar, paginação, até 100 ferramentas/app, 10 apps). Chave no cofre AES-GCM; validada antes de salvar. Concessão por bot (`mcp:<id>`, começa bloqueada), ferramentas aparecem só para bots liberados, com nomes `x<id>_<ferramenta>`. Ações sem `readOnlyHint` pedem aprovação sempre (opção por app de seguir a autonomia do bot). Resultados marcados como dado externo; só texto e imagem voltam ao modelo. Remover o app apaga chave e concessões.
- Lista de ferramentas agora é por execução (`/tools/list`), nas duas pontes MCP.
- **Interface**: respostas com Markdown leve (títulos, listas, negrito, código), passo atual da ferramenta durante o trabalho, cartões de aprovação com título e resumo legíveis (rotinas, apps), anexos nas mensagens, prévias e contador de rotinas na lista de bots.
- **Entrega do supervisor em partes**: acima de 60 KB o app envia o pacote em partes (`pairPart`) e a preparação junta e confere o hash; limite do pacote 600 KB. Pacote atual: 97.714 bytes (2 partes).

### Verificação

**75 testes** passaram, incluindo apps MCP com servidor falso estilo Composio (SSE, sessão, chave errada recusada e não salva, chave fora do estado/banco/atividade, concessão por bot, aprovação para enviar, recusa não executa, sessão expirada renovada, remoção limpa) e anexos (nome perigoso recusado, isolamento entre bots, imagem como imagem, PDF não suportado). O teste do pacote usa o script de partes real extraído do Kotlin. APK `dist/apk/mybots-v17.apk`, versionCode 17, 0.7.0, mesmo certificado (`fac61745…033b9c`).

**Não verificado:** se Codex e Claude Code repassam ao modelo a imagem devolvida por MCP; Composio real; seletor e ditado no POCO (dependem do app Google para voz).

## 20/10/2026 — v18 (0.7.1) e v19 (0.8.0): preparação corrigida e apps da conta das IAs

### v18 — correção: "Preparando o núcleo no Termux" sem fim

Causa: com o pacote em partes, a chamada `pair` ia sem `RUN_COMMAND_STDIN`; o Termux deixa a entrada aberta nesse caso e o script ficava em `base64 -d` até o tempo limite (240 s). Correção: o app passa `staged` e o script não lê a entrada. O teste do pacote agora mantém a entrada aberta como o Termux.

### v19 — conectores oficiais das contas (pedido: "igual o MausBot, login OAuth automatizado")

Constatado no código do OpenMausBot: ele usa o Composio (com OAuth gerenciado), além de poder herdar a configuração do próprio CLI. Decisão: usar os conectores oficiais das contas, cujo OAuth é feito pela Anthropic/OpenAI/Google.

- Permissão por bot **Apps da sua conta** (`account.connectors`, começa desligada).
- **Claude**: sem `--strict-mcp-config` os conectores claude.ai carregam (com `--setting-sources ""` os servidores MCP do usuário continuam fora: conferido). As chamadas não são pré-autorizadas: `--permission-prompt-tool mcp__mybots-tools__permission` manda cada uma ao supervisor; leituras (nomes search/list/get/read… sem verbo de alteração) passam, o resto vira cartão de aprovação. A ferramenta interna não aparece para o modelo.
- **Codex**: recurso `apps` ligado só para o bot liberado, com `destructive_enabled=false`, `open_world_enabled=false` e `default_tools_approval_mode="writes"`; como `approval_policy="never"`, escritas são recusadas.
- Ajustes → **Apps da sua conta**: estado dos conectores do Claude (`claude mcp list`, só nome/estado), botões que abrem claude.ai/settings/connectors e as configurações de conectores do ChatGPT. O servidor MCP próprio (Composio/Zapier) ficou em "Avançado".

### Verificação

76 testes. **Claude Code real** (API simulada): leitura de um app não pré-autorizado roda sem pedir, criação abre aprovação no MyBots e só executa depois de aprovada. **Codex real 0.162.1** com a conta do usuário: com o isolamento do MyBots os apps aparecem pela busca de ferramentas (101 ferramentas); `gmail.search_email_ids` funcionou (só a contagem foi pedida); `gmail.create_draft` foi recusado ("requires approval, but approval policy is never"), nada criado. `claude mcp list` real: 4 conectores claude.ai conectados. APK `dist/apk/mybots-v19.apk`, versionCode 19, mesmo certificado.

**Pendente no POCO:** v18/v19 prepararem o supervisor; Claude dentro do proot listar os conectores da conta; Codex no Termux ver os apps.

## 20/10/2026 — v20 (0.8.1): testado num emulador Android 16 com Termux e Codex reais

Ambiente de teste no PC: emulador Android 16 (API 36, x86_64) em `.build-tools/avd`, Termux 0.118.3 e Termux:API do GitHub, `pkg install codex` (0.163.0), login por código de dispositivo. Build x86_64 só para o emulador; a entrega continua ARM64. Observações do emulador: o Termux usa DNS 8.8.8.8 inacessível pela rede do emulador (trocado para 10.0.2.3 lá); `adb run-as` não tem rede, comandos com rede rodam na sessão do Termux.

### Causas encontradas (o "não lê e-mails nem notificações" do usuário)

1. **Code Mode do Codex**: as versões novas escondem as ferramentas MCP atrás da busca de ferramentas, executada pelo `code_mode_host`. O MyBots desligava esse recurso, então nenhuma ferramenta (notificações, memória, rotinas…) era alcançável e o modelo dizia "ferramenta indisponível". Correção: `code_mode_host` fica ligado (`code_mode` continua desligado; shell/arquivos seguem bloqueados). Teste de regressão adicionado.
2. **`startService` em segundo plano**: o Android recusava acionar o Termux com o MyBots minimizado/tela apagada ("Background start not allowed") e o app mostrava "Não consegui iniciar o Codex no Termux". Correção: `startForegroundService` (o RunCommandService do Termux se promove a primeiro plano).
3. **Sessões antigas**: uma conversa que já respondeu "não tenho acesso" continuava assim após liberar a permissão. Correção: mudar uma permissão inicia sessão nova (histórico reenviado).
4. O modelo mandava filtros vazios (`app: ""`) e a primeira chamada era recusada; agora vazio = sem filtro.
5. Instruções por turno (`developer_instructions` no Codex, `--append-system-prompt` no Claude) explicam onde estão as ferramentas e que e-mail/agenda/Drive da conta vêm dos apps conectados.

### Verificação no emulador (Codex real, gpt-6-luna)

Preparação do supervisor concluída (correção da v18 confirmada). Notificações postadas no Android chegaram ao supervisor e o bot listou app e título. Bot com "Apps da sua conta" respondeu quantos e-mails chegaram no Gmail via `codex_apps` (só a contagem foi pedida). Bot antigo, preso em "sem acesso", voltou a funcionar após religar a permissão. 79 testes no PC. APK `dist/apk/mybots-v20.apk`, versionCode 20, mesmo certificado.

## 20/10/2026 — v21 (0.9.0): níveis de acesso, mensagens em fila, voz na barra, notificações como MyBots

Pedidos do usuário: mandar várias mensagens sem esperar; áudio sem a tela do Google; permissões em poucos botões ("pouco, médio, total", como no Claude Code); notificação dos bots aparecendo como MyBots; notificação que "demorou para responder".

- **Níveis de acesso** (`bot.access`): Pouco acesso (memória, pendências, anexos, rotinas; o resto bloqueado e oculto), Médio (padrão de bots novos: pergunta na primeira vez, cartão com "Sempre permitir"), Acesso total (sem perguntas, inclusive SMS, notificações e ações nos apps da conta; no Codex liga ferramentas destrutivas/externas e aprovação automática). Bots antigos ficam "Personalizado" com seus interruptores, que continuam em "Ajustes finos" e valem por cima do nível. Decisão central em `Tools.policy`/`gate`; mudar o nível reinicia a sessão do modelo.
- **Mensagens em fila**: o supervisor aceita até 10 mensagens por bot enquanto ele trabalha; cada uma vira o próximo turno, em ordem (conversa da pessoa antes de rotinas).
- **Voz**: `SpeechRecognizer` direto com resultados parciais e nível do microfone numa barra no lugar da caixa de texto (× cancela, ✓ termina); permissão de microfone pedida na primeira vez.
- **Notificações como MyBots**: o leitor de notificações (sempre ligado pelo sistema) faz long-poll em `/device/outbox` e mostra com ícone e canal do MyBots ("Mensagens dos bots"); confirmação por `/device/outbox/ack`; sem app ativo ou sem confirmação em 12 s, cai no Termux:API.
- **Termux:API**: Ajustes mostra se o app está instalado, se veio da mesma fonte do Termux (assinatura) e orienta sobre início automático/bateria do HyperOS; erros de tempo esgotado apontam para lá.
- Correções: listas nas respostas quebravam palavras em coluna estreita; registro mostra o motivo de argumentos recusados.

### Verificação

84 testes (níveis, "Sempre permitir", Total sem perguntas, conectores por nível, caixa de saída com confirmação e fallback). No emulador (Codex real, gpt-6-luna): níveis na tela, Acesso total enviou notificação sem aprovação, duas mensagens seguidas respondidas em ordem, barra de voz abriu ("Ouvindo…"), notificação apareceu como "MyBots · Teste", listas sem quebra. Reconhecimento de fala em si não testável no emulador. APK `dist/apk/mybots-v21.apk`, versionCode 21, mesmo certificado.

### Para depois (pedido do usuário)

Vozes por bot e "ligação" com eles; identidade visual (logo/ícones) com ajuda do Gemini.

## 20/10/2026 — v22 (0.9.1): notificações dos bots como MyBots no celular real, toque abre o bot

Relato: no POCO a notificação ainda saiu pelo Termux:API (sem aparecer na tela, toque sem efeito); áudio aprovado.

- Entrega também pelo WebSocket quando o app está aberto (`bot.notify` → app mostra → `outbox.ack`); o leitor de notificações passa a iniciar a busca também quando o app abre.
- Toque abre a conversa do bot: `MainActivity.onNewIntent` guarda o intent; o app lê o bot ao voltar para a frente.
- Reserva do Termux:API com ação de toque que abre o MyBots (a prioridade do canal do Termux:API não pode ser elevada).
- Ajustes mostra "Notificações dos bots": pelo MyBots, só com o app aberto, ou bloqueadas, com botões para liberar e para tirar a restrição de bateria.
- **Correção encontrada no emulador**: um supervisor antigo travava ao fechar (conexões abertas da busca seguravam `server.close()`) e mantinha a trava; a versão nova não subia ("Não consegui preparar o supervisor"). Agora o fechamento responde as buscas e fecha as conexões, sai sozinho após 8 s, e a preparação encerra um supervisor travado que ainda segura a trava (só se for o mesmo processo). Teste de regressão com um processo travado.

Verificação no emulador (Codex real, gpt-6-luna): app aberto e minimizado → notificação de `com.mybots.app`, importância alta, título do bot; toque abriu a conversa do bot; com a permissão do MyBots negada, a reserva saiu pelo Termux:API com ação de toque. Supervisor travado substituído automaticamente. 84 testes. APK `dist/apk/mybots-v22.apk`.

## 20/10/2026 — v23 (0.10.0): trabalho com a tela apagada (etapa A)

- **Serviço "MyBots ativo"** (`KeepAlive.kt`): serviço em primeiro plano (`specialUse`) com notificação fixa em canal de importância mínima. A cada minuto chama `POST /device/wake` no supervisor (que registra o sinal, roda as rotinas vencidas e responde se há trabalho e quando é a próxima rotina). Mantém vivos o leitor de notificações (pede religação se o HyperOS desligar) e a entrega de avisos.
- **Reinício automático**: duas verificações sem resposta → `mybots-restart.sh` pelo RUN_COMMAND (sem entrada padrão), que inicia a versão já instalada e testada (ou a última que rodou, se o app foi atualizado e não aberto) e chama `termux-wake-lock`. O token volta cifrado e é salvo como no pareamento. Espera crescente entre tentativas; pausado durante a preparação feita pelo app. Qualquer resposta HTTP conta como vivo.
- **Alarmes**: `setExactAndAllowWhileIdle` (`USE_EXACT_ALARM`) 2 s depois da próxima rotina ou em no máximo 15 min; reinício do celular e atualização do app religam o serviço. Wake lock parcial só enquanto há tarefa na fila ou rodando (renovado a cada 15 s, máx. 30 min seguidos).
- **Ajustes → Funcionar com a tela apagada**: estado, último sinal, última verificação, próximo despertar, próxima rotina, último reinício; itens bateria do MyBots/Termux, alarmes exatos e segundo plano, com botões para as telas certas (inclui economia de bateria e Início automático do HyperOS); ligar/desligar.
- **Atividade → Interrupções**: o heartbeat distingue "pausado pelo sistema" (mesma instância, celular suspendeu o Termux) de "parado; iniciado de novo", com início, fim e duração; reinícios feitos pelo MyBots também aparecem. Heartbeats com mais de 7 dias são apagados.

### Verificação

85 testes (novos: rotina vencida executada pelo `/device/wake` com relógio controlado, próximo horário, registro do reinício; script de reinício real após `shutdown`, com a versão de reserva e sem instalação). No emulador (Codex real, gpt-6-luna), com tela apagada e `dumpsys deviceidle force-idle` (`mState=IDLE` o tempo todo): o serviço reagendou o alarme exato para a rotina, a rotina rodou e a notificação saiu como MyBots ("Teste · Teste tela apagada: Rotina ok — 03:18."); supervisor morto com `kill -9` voltou sozinho em ~1 min, com as duas entradas em Interrupções. Botão "Liberar" abriu o pedido do Android e a tela passou a mostrar ✓. Para não esperar 15 min, o próximo horário da rotina foi adiantado no banco. APK `dist/apk/mybots-v23.apk`, versionCode 23, mesmo certificado.

**Limite do teste:** o emulador não suspende a CPU de verdade, então o despertar pelo alarme não pôde ser separado do relógio do próprio supervisor. **Aceite no POCO (20/10/2026, 03:30):** com o app fechado e a tela apagada, a rotina diária do bot "Doidasso" rodou na hora e a notificação saiu como MyBots; "MyBots ativo" fixo e Termux com "wake lock held" na bandeja.

## 20/10/2026 — v24 (0.11.0): navegador de cada bot (etapa B)

- **Navegador nativo** (`BotBrowser.kt`): uma WebView por bot com **perfil próprio** (`androidx.webkit` 1.17.1, `ProfileStore`/`WebViewCompat.setProfile`), cookies e logins persistentes por bot. Sem suporte a perfis, o perfil único é apagado quando outro bot usa o navegador (logins nunca passam de um bot para outro). A WebView vive no processo do app (mantido pelo serviço da etapa A), então funciona com o app fechado; no painel ela troca para o contexto da Activity (teclado e listas de opções).
- **Comandos**: o supervisor enfileira (`supervisor/browser.mjs`) e o app busca por long-poll em `/device/browser`, respondendo em `/device/browser/result`. Sem o app ativo há 60 s, o bot recebe "peça para abrir o MyBots".
- **Ferramentas MCP**: `browser_open`, `browser_read` (texto + elementos com ids estáveis, tipo link/campo/envio/senha), `browser_click`, `browser_type` (select escolhe opção; `submit`), `browser_wait`, `browser_screenshot` (imagem JPEG) e `browser_ask_user`. Controle por elementos da página (como Playwright), não por coordenadas de mouse.
- **Política**: permissão única "Navegador" no perfil; Médio pergunta no primeiro uso ("Sempre permitir"); enviar formulário (botão de envio ou `submit`) é ação de escrita, com cartão que mostra o botão e a página; Total não pergunta; Pouco acesso esconde. Campo de senha é recusado. Links só http(s), nunca endereços do próprio celular (loopback/link-local) nem com usuário e senha na URL; sem downloads, uploads, câmera, microfone ou localização; `confirm()` da página é cancelado e informado ao bot. Conteúdo da página vai marcado como dado externo.
- **Na conversa**: botão 🌐 abre o painel "Navegador do bot" com a página ao vivo ("Só olhando"); **Assumir** libera o toque (← e ↻) e bloqueia o bot; **Devolver ao bot**. `browser_ask_user` mostra o cartão "{bot} precisa de você" com "Abrir navegador e assumir"; ao devolver, o bot recebe uma mensagem "[Navegador devolvido]…" e continua sozinho.

### Verificação

90 testes (novos: endereços proibidos, Médio com primeira vez e envio, senha recusada, Pouco/Total, Assumir bloqueia e Devolver continua o bot, app ausente, comandos por bot; contagem de ferramentas atualizada). No emulador (Codex real, gpt-6-luna), com o MyBots minimizado: bot leu os campos de httpbin.org/forms/post; bot no nível Médio pediu "Usar o navegador", preencheu e pediu "Enviar um formulário no navegador · Botão: Submit order", e o site confirmou `custname=Teste MyBots, size=medium`. Login fictício (the-internet.herokuapp.com): o bot pediu ajuda, a pessoa assumiu pelo cartão, digitou usuário e senha na página ao vivo e devolveu; o bot continuou e confirmou "You logged into a secure area!". A senha não aparece no histórico. Outro bot, no mesmo momento, foi mandado ao login ("You must login"): perfis isolados. Print com o app fechado veio com a página certa. APK `dist/apk/mybots-v24.apk`, versionCode 24, mesmo certificado.

**Limites:** botões que enviam dados por JavaScript sem formulário não são reconhecidos como "envio" (no Médio passam sem cartão); páginas só em canvas não têm elementos para ler. Login do Google não funciona em WebView (usar os apps da conta).

## 20/10/2026 — v25 (0.12.0): bot da faculdade de ponta a ponta (etapa C)

- **Modelo "Faculdade"** na criação de bot (`mobile/bot-templates.js`): só um perfil inicial (instruções, nível Médio, aparência), editável. Nada específico de SIGAA no código: o bot decide as rotinas e os passos.
- **Pendências com prazo** (`supervisor/items.mjs`): `task_create_item` ganhou `course` (disciplina), `due` (AAAA-MM-DD, ou com hora só se o aviso disser; data sozinha nunca vira 23:59) e `source`. Chave sem duplicar: disciplina + título + prazo, sem diferenciar maiúsculas, acentos e pontuação; repetir devolve a existente. Novas ferramentas `task_list_items` (prazos mais próximos primeiro) e `task_update_item` (prazo alterado, correções, concluída), do próprio bot, sem aprovação. Um bot não vê nem altera as pendências de outro.
- **Aviso de véspera** pelo supervisor, sem chamar o modelo: data sozinha → dia anterior às 09:00; com hora → 24 h antes. Sai como MyBots, uma vez por prazo (prazo novo → aviso novo); concluídas e vencidas não avisam. O horário entra no despertar do serviço da etapa A (alarme exato).
- **Atividade**: pendências por prazo (Atrasadas, Hoje, Próximos 7 dias, Depois, Sem prazo) com "Concluir"; perfil mostra disciplina, prazo e fonte.
- **Correções**: os bots negavam ter navegador sem ouvir "WebView" (o texto de cada turno não citava o navegador; agora cita, e Codex e Claude recebem orientação explícita para usar `browser_open`); avisos sem Markdown cru (`**`); cartão de primeiro uso com o nome da ferramenta (não "Executar uma ação"); restauração de backup aceitava `browser/write` só a partir de agora; `rpc.mjs` do emulador cortava saídas grandes.

### Verificação

95 testes (novos: chave tolerante a acentos, data sem hora, duplicado devolve o existente, mudança de prazo sem duplicar, isolamento entre bots, aviso uma vez na véspera com despertar, prazo novo gera aviso novo, backup preserva estado, avisos sem Markdown). No emulador (Codex real, gpt-6-luna; apps da conta desligados para não ler o Gmail real): bot criado pelo modelo na tela; sem dica, abriu a Wikipédia pelo navegador; "Acompanhe minhas atividades do SIGAA" criou as rotinas "quando chegar notificação do Gmail com SIGAA" e "todo dia às 08:00". Com notificações simuladas do Gmail: duas atividades registradas certas (Cálculo com hora, Física só com data); reenvio do aviso não duplicou; mudança de prazo atualizou a mesma pendência (30/10 → 06/11). Com tela apagada e Doze forçado, o aviso de véspera chegou como MyBots exatamente 24 h antes: "Faculdade · CÁLCULO I (MAT0001): Lista de Exercícios 3 — Prazo amanhã (qua., 21/10) às 04:22." APK `dist/apk/mybots-v25.apk`, versionCode 25, mesmo certificado.

**Não testado:** SIGAA real pelo navegador (instituição ainda não definida) e leitura de avisos reais do Gmail pelos apps da conta.

## 20/10/2026 — v26 (0.12.1): SIGAA do CEFET-MG abre no navegador do bot

Relato no POCO: `http://sig.cefetmg.br/sigaa/verTelaLogin.do` mostrou "Página da Web não disponível · net::ERR_CLEARTEXT_NOT_PERMITTED" (no Chrome abria).

- **Causa 1**: o link é `http://`; o MyBots proíbe tráfego sem criptografia (só o supervisor local pode). Correção: como o "HTTPS primeiro" do Chrome, a navegação `http://` vira `https://` (na ferramenta e em links/redirecionamentos da página). Tráfego sem criptografia continua proibido (senha do SIGAA não trafega aberta).
- **Causa 2**: em `https`, o servidor do CEFET manda o certificado sem o intermediário "RNP ICPEdu GR46 OV TLS CA 2025" (cadeia incompleta, comum em sites de universidades/governo). O Chrome busca o intermediário; a WebView recusa. Correção: só quando o único erro é "emissor desconhecido", o MyBots baixa o intermediário do endereço indicado no próprio certificado (AIA), confere que o certificado nomeia o site e valida a cadeia completa com os certificados raiz do Android (`X509TrustManagerExtensions`). Nome errado, vencido, autoassinado ou raiz desconhecida continuam bloqueados.
- Página que não abre agora devolve o motivo ao bot ("A página não abriu: …") em vez de ele ler a página de erro.

Verificação no emulador (Codex real): SIGAA do CEFET abriu e o bot listou Usuário (CPF), Senha, Entrar; `incomplete-chain.badssl.com` abriu; `expired`, `wrong.host` e `untrusted-root.badssl.com` recusados com "o certificado de segurança do site não é confiável". 95 testes. APK `dist/apk/mybots-v26.apk`, versionCode 26, mesmo certificado.

**Aceite no POCO (20/10/2026):** com a v26, o bot abriu o SIGAA real do CEFET-MG pelo navegador, a pessoa entrou pelo Assumir e o bot montou as rotinas de acompanhamento corretamente.

## 20/10/2026 — v27 (0.13.0): arquivos de ida e volta (etapa D ampliada)

Pedido: "vai no SIGAA, abre a atividade, baixa o arquivo, resolve e me manda aqui (ou só me manda o arquivo)", com tabelas e gráficos. Um APK só no fim da etapa.

**Ler arquivos** (`supervisor/documents.mjs`, `DeviceFiles.kt`)
- PDF lido no celular pelo `PdfRenderer`: texto (Android 15+) e, nas páginas sem texto (escaneadas), a página como imagem; 20 páginas por vez (`page`). Word, Excel e PowerPoint lidos no supervisor (ZIP + XML, sem biblioteca), como Markdown com títulos e tabelas. Textos longos continuam com `offset`. Vale para anexos, downloads e arquivos criados (`files_list`).
- Codex chama ferramentas por script ("modo código"): `text(r)` descartava imagens. Orientação e o próprio resultado ensinam a usar `image(c)`; com isso o PDF escaneado foi lido.

**Baixar pelo navegador** — o `DownloadListener` da WebView baixa com os cookies do perfil do bot (login do SIGAA), mesmo `https` e mesma cadeia de certificado completada; até 20 MB; executáveis bloqueados. O arquivo vai para os arquivos do bot (`/device/files`), e o clique devolve o arquivo baixado.

**Mandar arquivos** (`supervisor/creator.mjs`) — `file_create` (PDF, Word, planilha, CSV, Markdown, texto, HTML, a partir de Markdown) e `file_send` (repassar um arquivo, ex.: o enunciado baixado). PDF: HTML paginado em A4 pelo sistema de impressão do Android (`MyBotsPdfWriter`, sem diálogo). Word e Excel montados em XML (tabelas, títulos, gráficos como tabela de dados no Word e como aba na planilha). Os arquivos aparecem junto da resposta do bot como cartões: **Abrir** (nunca pelo Termux; escolhe entre os apps), **Compartilhar** e **Salvar em Downloads** (`Download/MyBots`), via `FileProvider` só da pasta de saída.

**Respostas estruturadas** (`mobile/markdown.js`, `RichMessage.js`) — um leitor de Markdown compartilhado pelo app e pelos arquivos: tabelas (roláveis), gráficos de barras, linhas e pizza (bloco ```chart, desenhado com `react-native-svg` no app e como SVG no PDF), links tocáveis. Fórmulas em LaTeX viram símbolos (x², ∫₀³, √, ≤, ℝ) na conversa e nos arquivos.

### Verificação

100 testes (novos: leitura de Word/Excel/PowerPoint gerados pelo LibreOffice, PDF por páginas e escaneado com celular falso, downloads guardados por bot e executáveis bloqueados, criação e envio de PDF/Word/planilha anexados à resposta, repasse de download, Markdown/gráficos/LaTeX). Word e Excel gerados abertos e convertidos pelo LibreOffice. No emulador (Codex real, gpt-6-luna): PDF com texto e PDF escaneado lidos; planilha lida; download por link direto e **clicando no anexo de uma página**; fluxo completo "baixe o PDF da página, leia e me mande o original e um resumo em Word" com os dois cartões na resposta; resolução de exercícios em PDF (A4, 2 páginas, tabela e gráfico) e Word; tabela e gráfico desenhados na conversa; Salvar em Downloads e Compartilhar funcionando; Abrir sem app compatível mostra o aviso. APK `dist/apk/mybots-v27.apk`, versionCode 27, mesmo certificado.

**Não testado:** download real do SIGAA (precisa do seu login, no POCO); Abrir num celular com leitor de PDF/Word instalado. Fora por enquanto: enviar arquivos para sites (upload no SIGAA).


## 20/10/2026 — v28 (0.14.0): identidade visual e revisão do app (etapa E)

Retomada do redesenho que ficou sem compilação na sessão anterior. Mantidos a paleta escura, Plus Jakarta Sans, ícones vetoriais, avatares animados, início com resumo do dia e navegação flutuante, conversa e folhas de perfil/ajustes/atividade redesenhadas.

- **Abertura**: robô Órbita menta derivado de `mobile/assets/brand/robot.svg`, com fonte e PNG em `splash.svg`/`splash.png`. Substituídas as imagens Expo em todas as densidades. Fundo escuro no tema da Activity e da abertura; Android 12+ usa explicitamente o robô como ícone da abertura. Configuração Expo aponta para os novos arquivos e tema escuro.
- **Notificações e ícones temáticos**: silhueta monocromática do Órbita com visor vazado e olhos brancos (`mybots_notification.xml`), usada pelas notificações dos bots, serviço ativo e camada monocromática do ícone adaptativo. Ícones coloridos e adaptativos da sessão anterior preservados.
- **Ajustes finais conferidos no emulador**: selos PDF/DOCX nos cartões e na folha do arquivo; Felino sem ponto solto; altura fixa do perfil e posição das abas preservada ao trocar Perfil/Rotinas/Acesso/Memória; instruções de rotina limitadas a três linhas com expansão e resultado sem os marcadores `**`; pendências com botão circular e etiqueta de prazo; interrupções com ícones vetoriais.

### Verificação e entrega

100 testes passaram, sem falhas nem testes ignorados, incluindo Claude Code e Codex reais contra API simulada. Compilações release x86_64 e ARM64 passaram, incluindo as verificações de lint acionadas pelo build. No emulador Android 16: atualização instalada por cima, supervisor conectado e dados existentes preservados; revisão visual de início, criação, perfil, rotinas, acesso, memória, atividade, ajustes, conversa e folha de arquivo. Gravação da abertura confirmou o robô menta e transição para a tela de carregamento escura. Ícone novo conferido na notificação “MyBots ativo”. Conversa real com gpt-6-luna concluída: “Visual revisado.” Sem erros AndroidRuntime/ReactNativeJS no log consultado.

APK `dist/apk/mybots-v28.apk`, pacote `com.mybots.app`, versionCode 28, versão 0.14.0, somente ARM64, 29.912.573 bytes. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, idêntico à v27. SHA-256 do APK: `ad27d7f9ac4e3418dd46f4ed65507b8585a51456df9ec39d7871f5224c9ee494` (arquivo `.sha256` ao lado). Servidor e QR atualizados para v28; download HTTP comparado por hash ao APK, rota v27 retorna 404. Capturas, gravação e logs de validação em `.build-tools/emulator-state/`.

**Limites:** aceite visual no POCO ainda pendente; não foi repetido o fluxo completo do SIGAA nem a validação de voz. A opção de reduzir animações não foi revalidada nesta retomada. Imagens do Gemini não foram fornecidas; foi usado o robô existente do projeto. Etapas F (voz/ligação) e G (salas) continuam para depois.

## 20/10/2026 — v29 (0.15.0): compartilhar com o bot, atualização no app, entregar arquivos em sites, uso e widget

Pedido do usuário, nesta ordem e com um APK só no fim: (1) compartilhar com o bot, (4) atualização dentro do app, (5) enviar arquivos para sites como o SIGAA, (7) uso por bot com tokens e (3) widget com o avatar animado.

- **Compartilhar → MyBots** (`ShareIntake.kt`): filtros `SEND`/`SEND_MULTIPLE` de qualquer tipo; texto, link (com o título da página) e até 5 arquivos (10 MB juntos) chegam ao campo de mensagem do bot escolhido para revisar antes de enviar. Cada bot é um alvo de **Direct Share** (atalho dinâmico com o rosto desenhado por `BotFace.kt`, o mesmo desenho do `BotAvatar.js`). Arquivos no compositor e nos balões da pessoa agora são só o selo do tipo + nome (`FileChip`).
- **Atualização dentro do app** (`AppUpdate.kt`): consulta a última Release de `AugustodoBRT/Mybots` (repositório público criado nesta etapa), mostra "MyBots X disponível" com as novidades na tela inicial e em Ajustes → Atualizações, baixa com barra de progresso, confere o SHA-256 publicado **e** que o APK é o MyBots assinado com o mesmo certificado, e entrega ao instalador do Android (`PackageInstaller`). Na primeira vez pede "Instalar apps desconhecidos" e continua sozinho ao voltar. Depois de instalar, a notificação "MyBots atualizado" abre a versão nova. Publicar: `scripts/publish-release.sh NN "novidades"`.
- **Entregar arquivos em sites** (`browser_upload`): o leitor da página mostra campos de arquivo (tipo `file`, mesmo escondidos atrás de botões); o arquivo do bot entra no campo pelo próprio JavaScript da página (`DataTransfer`), sem seletor do Android e sem acesso a outros arquivos. **Sempre** pede aprovação, em qualquer nível, sem "Sempre permitir", mostrando arquivo, campo e site; o envio do formulário segue as regras de antes. Só arquivos do próprio bot.
- **Uso** (banco versão 5, tabela `usage`): tokens de cada resposta por bot (Codex informa o total da sessão no `turn.completed`: o supervisor grava a diferença; na primeira resposta de uma conversa antiga só marca o ponto de partida. Claude: `result.usage`). Limites da assinatura: Codex por `account/rateLimits/read` (janela de 5 h, semana e plano), Claude pelo `rate_limit_event` de cada resposta. Atividade → Uso: barras dos limites com renovação, gráfico de 7 dias e tokens por bot (lidos, % em cache, escritos). Cada resposta mostra seus tokens.
- **Widget** (`MyBotsWidget.kt`): 4×2 com cabeçalho (decisões/pendências), até 3 bots com o rosto animado (respira e pisca; olha para os lados trabalhando; antena âmbar esperando você), última mensagem e próximo prazo; 2×2 mostra um bot grande. Quadros desenhados pelo `BotFace` e tocados por `ViewFlipper`; dados por long-poll em `/device/widget` (muda na hora quando um bot começa a trabalhar), também com o app fechado (serviço "MyBots ativo"). Ajustes → Celular → "Widget na tela inicial · Adicionar" usa o pedido de fixar do Android. Tocar num bot abre a conversa e fecha folhas abertas.

### Verificação

105 testes (novos: upload sempre com aprovação mesmo no Total, recusa sem enviar, só campo de arquivo e só arquivos do bot; tokens por bot, limites que sobrevivem ao reinício, totais de sessão do Codex viram diferença por resposta, ponto de partida de conversas antigas; long-poll do widget). No emulador (Codex real, gpt-6-luna):
- PDF compartilhado pelo app Arquivos → Direct Share "Faculdade" → bot leu e resumiu; link da Wikipédia compartilhado → folha "Enviar para um bot" → texto no campo.
- Release de teste x86_64 (v29-teste, já apagada): aviso na tela inicial, permissão de instalar com continuação automática, download 0→100%, confirmação do Android, versão 29 instalada, notificação "MyBots atualizado", dados e supervisor preservados.
- `the-internet.herokuapp.com/upload`: cartão "Enviar um arquivo para um site", depois "Enviar formulário · Botão: Upload"; a página respondeu "File Uploaded! enunciado.pdf".
- Uso: limites do ChatGPT Plus (5 h 0%, semana 9%) e tokens por bot coerentes (~28 mil e ~79 mil por resposta, quase tudo em cache).
- Widget adicionado pelo botão; animação gravada em vídeo (piscar, olhar ao trabalhar), "Trabalhando…" ao vivo, "1 decisão" âmbar, 2×2 com um bot grande, toque abre a conversa.

APK `dist/apk/mybots-v29.apk`, versionCode 29, 0.15.0, ARM64, 30.070.270 bytes, certificado `fac61745…033b9c` (igual à v28), SHA-256 `87058e5d24e921ce7dd1875a4f813d29cd1e89c8390bf5c593863fa01b25b0b7`. Também publicado como Release v29 no GitHub.

**Primeira instalação da v29 pelo link/QR** (a v28 não tem o atualizador); da v29 em diante o app se atualiza sozinho. **Não testado no POCO:** Direct Share no HyperOS, widget no launcher do HyperOS (limite de quadros: se o launcher recusar, o widget cai para 6 quadros e depois para um rosto parado), upload real no SIGAA, limites do Claude dentro do proot.

## 20/10/2026 — v30 (0.15.1): nome na saudação, limite do Claude e versão exata do modelo

- **Seu nome** (Ajustes → Você): a tela inicial diz "Bom dia, {nome}." (boa tarde a partir das 12h, boa noite a partir das 18h). Guardado no supervisor (`metadata person.name`).
- **Limite do Claude**: o Claude Code só informa as janelas junto de uma resposta. Em Atividade → Uso aparece o cartão do Claude com **Consultar agora**, que faz uma resposta mínima do Haiku (`limits.refresh`); o Codex também ganhou o botão. Os limites continuam sendo atualizados a cada resposta.
- **Versão exata do Claude**: o evento `init` do Claude Code traz o modelo resolvido pelo apelido (`opus` → `claude-opus-5-5`). Cada resposta grava `modelId` e mostra "Claude Opus 5.5"; o seletor de modelo mostra a versão confirmada pela última resposta. Conferido no PC: opus → claude-opus-5-5, sonnet → claude-sonnet-5-5, haiku → claude-haiku-5-5, fable → claude-fable-5-1.
- **Uso**: "lidos" virou "processados", com a explicação de que cada passo de uma resposta relê a conversa e as ferramentas (a parte em cache pesa bem menos). Conferido no PC que o `result.usage` do Claude soma todas as chamadas de uma resposta (não é cumulativo da sessão, diferente do Codex).

107 testes. No emulador: saudação com o nome, campo nos Ajustes, painel de Uso com o novo texto. APK `dist/apk/mybots-v30.apk`, versionCode 30, 0.15.1, ARM64, certificado `fac61745…033b9c`, SHA-256 `70bd3ead8034df7a6b1c5674674c3d2dec917c039d9731f4cd98145c3f5897bc`. Publicado como Release v30: primeira versão entregue pela atualização dentro do app.

**Ideias registradas a pedido do usuário (economia de tokens):** mandar a cada bot só as ferramentas que ele pode usar; "nova conversa com resumo" quando o histórico ficar grande.

## 20/10/2026 — v31 (0.15.2): apps da conta por bot (um "oi" de 112 mil para 11,5 mil tokens)

Relato: um "oi" num bot com Claude Sonnet subiu o uso de 240 mil para 362 mil tokens.

- **Causa** (medida no PC, supervisor real + Sonnet): com "Apps da sua conta" permitido, o Claude Code carrega todos os conectores do claude.ai da conta (Gmail, Agenda, Drive, Docs, Sheets, Slides, Miro, Indeed, WordPress…: 128 ferramentas) em cada passo. Como conectam de forma assíncrona, o primeiro turno às vezes vem sem eles (11 mil) e o seguinte com eles (112 mil). `ENABLE_TOOL_SEARCH` não adia esses conectores.
- **Correção**: cada bot escolhe quais apps da conta carrega (perfil → Acesso → "Apps da sua conta do Claude"); os outros entram em `--disallowedTools` (`mcp__claude_ai_<Nome>`), o que também tira as definições do contexto. Bots novos começam sem apps; bots antigos ficam com Gmail e Google Calendar. Sem nenhum app marcado, os conectores nem carregam (`--strict-mcp-config`). Os nomes dos conectores vêm do `claude mcp list` e do `init` de cada resposta (`metadata claude.servers`). Trocar a lista inicia uma sessão nova. O backup aceita a lista (`grants account.apps`).
- **Medido por "oi" (Sonnet)**: antes 112 mil; sem apps 11,5 mil; só Gmail 38,7 mil (o Gmail sozinho custa ~27 mil por passo).

108 testes. No emulador (bot trocado para Claude no banco só para ver a tela, depois revertido): lista com Gmail e Google Calendar ligados no bot antigo, desligar o Calendar salvou só Gmail. APK `dist/apk/mybots-v31.apk`, versionCode 31, 0.15.2, ARM64, certificado `fac61745…033b9c`, SHA-256 `ede1ab7c38d35d100078bcabeadaa719b31d359b8ef08670c266e6e31a27c589`. Release v31.

**Próxima economia possível:** os ~11 mil tokens de base são as instruções e as ~31 ferramentas do MyBots; mandar só as permitidas a cada bot e "nova conversa com resumo" para históricos longos.

## 20/10/2026 — v32 (0.15.3): versão do Claude já no seletor

Relato: o seletor ainda mostrava "Claude Sonnet" (a versão só aparecia depois de uma resposta na v30+). O catálogo embutido agora traz o `modelId` que cada apelido resolve hoje (opus → claude-opus-5-5, sonnet → claude-sonnet-5-5, haiku → claude-haiku-5-5, fable → claude-fable-5-1, conferido no Claude Code); a primeira resposta num modelo mais novo substitui. O seletor mostra "Claude Sonnet 5.5" com "claude-sonnet-5-5 · sempre a versão mais nova". 108 testes; catálogo conferido no emulador. APK `dist/apk/mybots-v32.apk`, versionCode 32, 0.15.3, ARM64, certificado `fac61745…033b9c`, SHA-256 `9fda794b2a3068a2d96cd1ab67496d539cc981f8fb8aab8d34b67fa8d31307d0`. Release v32.

## 20/10/2026 — v33 (0.16.0): senhas salvas para o bot entrar sozinho

Pedido: guardar senhas no app para o bot entrar nos sites (SIGAA) sem a pessoa digitar toda vez.

- **Cofre no app** (`PasswordVault.kt`): EncryptedSharedPreferences com chave do Android Keystore (`mybots_passwords`, fora do backup do Android). Supervisor e modelo **nunca** recebem a senha; a lista mostra site, usuário e bots, nunca a senha.
- **`browser_login`**: o bot chama sem argumentos; o app procura um login salvo para o site aberto (mesmo host ou subdomínio, só https) e para aquele bot, preenche usuário e senha na página e envia. Em outro site responde "Não há senha salva para este site e este bot". No nível Médio, o primeiro uso pede aprovação ("Entrar com uma senha salva", com "Sempre permitir"); no Total vai direto. Cada uso fica na Atividade.
- **Salvar pelo Assumir**: enquanto a pessoa usa o navegador do bot, um envio de formulário com senha é passado ao app por um `prompt` com prefixo aleatório da aba (só o app conhece); a conversa mostra "Salvar a senha de {site}?" com "Para {bot}", "Salvar para todos os bots" ou "Agora não".
- **Ajustes → Senhas**: lista, adicionar (site, usuário, senha, quais bots) e apagar.

109 testes (novo: login sem senha no comando, aprovação no Médio com "Sempre permitir", site sem login salvo). No emulador (Codex real): login em the-internet.herokuapp.com pelo Assumir → cartão "Salvar a senha" → Para Navegador; logout; "entre com a senha salva" → cartão de primeiro uso → "You logged into a secure area!"; a senha não aparece no histórico; em practicetestautomation.com o app recusou preencher. APK `dist/apk/mybots-v33.apk`, versionCode 33, 0.16.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `39a7345ac0c99005c7f65f3f3a30811a8c5c565353bc77a04c41696bc6c9b8ef`. Release v33.

## 20/10/2026 — v34 (0.16.1): o bot age em nome da pessoa (formulários e testes de perfil)

Relato: o bot de candidaturas (GPT-6-Luna, Alto) recusou marcar o teste de perfil Sólides (autoavaliação e "o que os outros acham de você") mesmo com a pessoa pedindo várias vezes.

- Instruções base: o bot trabalha para a pessoa e age em nome dela; quando ela pede para preencher algo por ela (formulário, cadastro, candidatura, questionário, teste de perfil, autoavaliação), preenche seguindo a orientação dela e o que sabe dela; sem orientação, pergunta uma vez e guarda na memória; não inventa fatos verificáveis (formação, experiência, documentos, notas). As instruções do perfil passam a valer como "função e personalidade" escritas pela pessoa (antes: só "jeito de conversar"). Também nas orientações de cada turno (Codex `developer_instructions`, Claude `--append-system-prompt`).
- `PROMPT_VERSION` (mobile/local.js): quando muda, o supervisor recomeça as sessões da IA uma vez (sessão retomada guardava as instruções antigas e continuava recusando); o histórico recente vai junto como em qualquer sessão nova.

Emulador (gpt-6-luna, Alto): antes "NÃO, não marcaria por você"; depois 3 de 3 bots novos aceitaram e foram abrir o navegador; num bot com sessão antiga e a recusa no histórico, depois do recomeço da sessão: "SIM — marcaria as qualidades positivas nas duas partes, seguindo sua orientação". 110 testes. APK `dist/apk/mybots-v34.apk`, versionCode 34, 0.16.1, ARM64, certificado `fac61745…033b9c`, SHA-256 `9684fea2394c5723bf5d8f37f4eaa444819c0c755298a4b2d37d3c692469c620`. Release v34.


## 20/10/2026 — v35 (0.17.0): salas com vários bots (etapa G, sem coordenador)

Decisão com o usuário: sem bot coordenador por enquanto (só se ele criar um para isso).

- **Salas** (`supervisor/rooms.mjs`; banco versão 6: `rooms`, `room_turns`, `room_sessions`): de 2 a 8 bots. Sem @, todos respondem em ordem; com @Nome (sem diferenciar acentos e maiúsculas), só os chamados. Um bot que escreve @Outro na resposta passa a vez a ele, até **3 rodadas** por mensagem da pessoa, sem repetir quem já está na fila. Cada vez é uma tarefa normal da fila do bot, com as permissões, ferramentas e aprovações dele; a resposta vai para a sala, nunca para a conversa privada. Cada bot tem **uma sessão de IA por sala**, separada da conversa privada; numa sessão retomada recebe só o que é novo desde a última fala dele. O consumo de sessão do Codex passou a ser contado por bot e sessão.
- **Texto da sala para cada bot**: quem está na sala (com a função de cada um), o nome da pessoa, como chamar outro bot com @ (sem ferramenta), que os dados de cada bot são só dele (consultar as próprias ferramentas antes de responder sobre prazos, pendências e memórias) e que ele não vê memória nem conversas privadas dos outros.
- **App**: seção "Salas" na tela inicial (rostos sobrepostos, quem está respondendo, última mensagem), folha Nova/Editar sala (nome e bots), tela da sala com mensagens identificadas por bot (modelo e tokens), "pensando"/"na fila" e Parar por bot, cartões de aprovação da sala, atalhos @Bot acima do campo e o aviso "Sem @, todos os bots respondem…" / "Só X responde…". O backup inclui as salas.

114 testes (novos: @menções sem acento, quem responde com e sem @, sessão por sala com só o que é novo, conversa privada intocada, pedido repetido, limite de 3 rodadas entre dois bots que se chamam sem parar, backup, sala com fila não apagável). No emulador (Codex real): sala "Estudos" criada pelo app; "cada um diga o que faz" → 3 respostas em ordem (~10 mil tokens cada); "@Teste, pergunte para o bot da faculdade qual é o meu próximo prazo" → o Teste chamou @Faculdade, que consultou as pendências e respondeu "Lista de Exercícios 3, Cálculo I, 21/10 às 04:22". Dois erros vistos no teste e corrigidos no texto da sala: o Faculdade repetia o "não tenho pendências" do outro bot sem consultar as dele; um bot dizia que não conseguia chamar o outro. APK `dist/apk/mybots-v35.apk`, versionCode 35, 0.17.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `d6ea79d13741d3395a231696775de772d88123f99613437c0545716523c589d2`. Release v35.

## 21/10/2026 — v36 (0.18.0): onde cada bot vive (primeira etapa do MyBots no computador)

Plano completo em `docs/PLANO-PC.md` (celular continua sendo a fonte de verdade; o PC vira um executor pareado; Tauri no desktop; Tailscale para usar fora de casa).

- **Onde ele vive** (perfil do bot): Celular (padrão; bots antigos continuam assim), Computador (online só com o PC conectado) ou Onde estiver (sempre online; no PC quando ele está conectado). Mudar o lugar recomeça a sessão de IA, que pertence à máquina onde foi criada.
- **Presença**: `state.presence` por bot (`online`, `where`, `lastSeen`) e `state.nodes`. Bot do computador desligado aparece **dormindo** (olhos fechados, mais apagado, respiração lenta) na lista, na conversa, nas salas e no widget, com "visto por último hoje às 18:40" (sobrevive a reinícios; atualizado a cada heartbeat).
- **Mensagens esperando o computador**: ficam na fila com o cartão "Esperando o computador ligar" e Cancelar; rotinas de um bot do PC também esperam, sem empilhar (o bot ocupado não dispara outra). Uma tarefa esperando não conta como trabalho no `/device/wake`, para não segurar o celular acordado.
- **Fila por aparelho** (`supervisor/queue.mjs`): uma resposta por vez no celular e outra no computador ao mesmo tempo; um bot nunca responde dois turnos em paralelo e as vezes de uma sala continuam em ordem. Se o computador cai no meio, a resposta vira "O computador desconectou durante esta resposta", sem repetir; as outras continuam esperando.
- **Registro do computador** (`supervisor/nodes.mjs`): `nodes.connect({ id, name, execute })` com a mesma assinatura do executor local; a v37 liga isso à rede. Atividade "Notebook conectado: 1 bot ficou online".

122 testes (4 novos em `tests/nodes.test.mjs`, com computador simulado: espera e execução no PC ao conectar; celular e PC em paralelo sem o mesmo bot duas vezes; queda no meio vira interrompida e o resto espera; "visto por último" após reinício, `busy` falso e sessão nova ao mudar de lugar). No emulador: seletor "Onde ele vive" na criação, bot Programador (Computador) dormindo com "Offline · computador desligado", "Oi" ficou em "Esperando o computador ligar"; o bot Teste (gpt-6-luna) respondeu "ok" enquanto isso. Não testado no emulador: o computador conectando de verdade (chega na v37). APK `dist/apk/mybots-v36.apk`, versionCode 36, 0.18.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `b4544527dbd9c33ad84613d5e8647476a105ca4bad223cfed6e07eb362f353a3`. Release v36.

## 21/10/2026 — v37 (0.19.0): o computador conecta de verdade

Guia: `docs/computador.md`.

- **Nó do computador** (`pc/`): `node pc/node.mjs` (roda), `pair` (QR no terminal, uso único, 10 min), `install`/`uninstall` (serviço `systemd --user` com o PATH do terminal, para achar `claude` e `codex`). Identidade e certificado TLS autoassinado (openssl, P-256) em `~/.mybots-pc/`. Responde com o Claude Code/Codex do computador e informa quais estão logados (a cada 5 min).
- **Link no celular** (`supervisor/link.mjs`): o celular disca para o computador (rede local e Tailscale), fixa o certificado do QR, prova o segredo do pareamento (HMAC sobre desafio novo), reconecta sozinho (2 a 30 s; na hora quando o app acorda o supervisor) e empresta o computador à fila como nó. Cancelar encerra o processo no computador; queda no meio vira "O computador desconectou".
- **Ferramentas pelo túnel**: o computador abre um endpoint em `127.0.0.1` que repassa só `/mcp` e `/tools/*` ao supervisor do celular, com o token da execução. Memória, pendências, rotinas, arquivos e navegador continuam no celular.
- **Sessões por aparelho**: bot que muda de aparelho começa sessão nova com o histórico (marca `session.lane.*`). Um bot do computador só precisa do login da IA no computador; modelos de uma IA que só existe lá entram no seletor.
- **App**: Ajustes → Computador (estado, IAs logadas, Tentar agora, Parear de novo, Esquecer) e leitor de QR com `expo-camera` (APK passou de ~30 para ~40 MB pelo leitor de códigos do ML Kit).

121 testes (3 novos em `tests/link.test.mjs`, celular e computador de verdade por TLS: certificado trocado recusado, código usado uma vez, bot do computador salva memória no celular pelo túnel, bot "Onde estiver" vai para o computador, cancelar, queda no meio, reconexão sozinha após reiniciar o computador, esquecer, celular desconhecido recusado). No emulador com o nó rodando neste PC (pasta de teste): pareado pelo endereço da rede local; bot do computador com Codex gpt-6-luna salvou "editor favorito: VS Code" na memória do celular; bot com Claude Haiku consultou as pendências; derrubar o nó deixou o computador "fora de alcance" e, ao religar, voltou sozinho em ~9 s; painel Computador e pedido de câmera conferidos. **Não testado**: ler o QR com a câmera de verdade (o emulador não mostra um QR) e o celular no 4G pela Tailscale. APK `dist/apk/mybots-v37.apk`, versionCode 37, 0.19.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `be3521023106ca6510d39c6d4f9c6d1c849660074a28253c43f63147e5e00c15`. Release v37.

## 21/10/2026 — v38 (0.19.1): correções do primeiro teste com o computador

Teste no POCO: pareou pelo QR com a câmera (02:17) e o bot Desenvolvedor (Computador, gpt-6-luna) respondeu pelo PC, inclusive consultando as pendências pelo túnel. Dois problemas relatados:

- **Teclado escondia a folha do bot** (criar/editar, ao tocar em nome ou função; também no emulador): o app desenha de ponta a ponta e a janela não encolhe com o teclado, e o `KeyboardAvoidingView` com `height` dentro do Modal zerava a folha. Agora a folha reserva a altura do teclado embaixo e rola até o campo em que se digita.
- **O bot não sabia que estava no computador**: pediram "cria um .txt na minha home" e ele anexou o arquivo dizendo "toque em Salvar para colocá-lo na sua pasta Home". Cada turno no computador agora leva a orientação de que roda no computador "nome", que ainda não acessa arquivos, terminal nem programas dele e que nunca deve dizer que salvou algo numa pasta do PC (Claude `--append-system-prompt`, Codex `developer_instructions`). Mexer nos arquivos do PC chega na v40 (plano reordenado: v39 é o app no PC).

122 testes. No emulador: folha continua visível com o teclado, nome e função aparecem enquanto se digita; com um nó de teste, "cria testemybot.txt na minha home do computador" → "Não consigo acessar a pasta home do seu computador. Posso criar o arquivo aqui na conversa…". Serviço `mybots-pc` do PC reiniciado com a orientação nova. APK `dist/apk/mybots-v38.apk`, versionCode 38, 0.19.1, ARM64, certificado `fac61745…033b9c`, SHA-256 `82bf9032562f29a1e17365f3f6ac4f80d99946b7554ad981e5fe0e4b83d03ac3`. Release v38.

## 21/10/2026 — v39 (0.20.0): o MyBots no computador (janela) e os poderes do PC

Pedido: fazer o app no PC junto com os poderes do PC (o bot criar arquivos e rodar coisas no computador).

**Poderes do PC** (permissão nova **Mexer no computador**, `computer`):
- Pasta própria por bot em `~/MyBots/<Nome>` (`workspaces.json` guarda o caminho; nome repetido vira "Nome 2").
- Claude Code no computador com `--tools Bash,Read,Write,Edit,Glob,Grep` e `--permission-mode acceptEdits` (edições na pasta passam direto); o resto vai à ferramenta de permissão do MyBots (`computerPermission` em `supervisor/tools.mjs`), decidida no celular: Total roda; Médio pede com "Sempre permitir" por tipo (`computer/shell`, `computer/write`, `computer/read`); comandos de risco (sudo, systemctl, rm em / ou ~, git push, curl|sh…) sempre pedem, sem "Sempre"; senhas e chaves (~/.ssh, ~/.gnupg, ~/.mybots-pc, credenciais do Claude/Codex, chaveiros) sempre recusados; Pouco acesso fecha o computador. Limites do pedido de permissão subiram (arquivo inteiro vem no pedido).
- Codex no computador com `workspace-write` (e o terminal dele ligado: `shell_tool`, `unified_exec`, `shell_snapshot`), preso à pasta.
- A orientação de cada turno diz onde o bot está, a pasta dele e o que precisa de aprovação.

**Janela no computador** (`desktop/`, Tauri 2, ~5,9 MB):
- A interface é o próprio app (react-native-web, `pc/ui`) servida pelo nó em `127.0.0.1:3232` (`pc/ui.mjs`), com token novo a cada início só dentro da página, `Host` e `Origin` conferidos. Cada pedido vai ao celular pelo link, que responde só `DESKTOP_METHODS`; os eventos do supervisor voltam ao vivo. Arquivos dos bots: Abrir/Salvar em `~/Downloads`. Enter envia, Shift+Enter quebra linha. Coluna centralizada de até 820 px.
- No PC ficam de fora: anexar, ditado, navegador ao vivo do bot, senhas, backup, e-mail por senha de app, apps MCP próprios e o pareamento.
- Bandeja (libayatana), fechar esconde, instância única, `WEBKIT_DISABLE_DMABUF_RENDERER=1` (NVIDIA). `scripts/build-desktop.sh` gera tudo e instala em `~/.local/bin`, no menu de apps e em `~/.config/autostart` (abre escondido na bandeja).

124 testes (novos: permissões do computador ponta a ponta com nó real — Total, risco, Médio com "Sempre", senha recusada, Pouco acesso; janela — página só em localhost, Host e Origin, métodos fora da lista recusados, eventos, arquivo em Downloads). No emulador com nó de teste e IAs reais deste PC: Claude Sonnet criou e rodou `ola.py` em `~/MyBots/Programador`; no Médio, `python3 ola.py | tee …/fora.txt` virou cartão "Rodar um comando no computador" e rodou ao permitir; Codex gpt-6-luna criou e rodou `soma.py` (saída 5). Achado e corrigido no teste: o Codex tinha o terminal desligado; o aviso "Instale o Claude Code no Termux" aparecia em bot do computador. Janela: aberta no Hyprland (NVIDIA) com os dados do celular do emulador, conversa aberta e mensagem enviada pela janela respondida pelo Codex do PC. App instalado neste PC (serviço `mybots-pc` reiniciado com o código novo). **Não testado**: a bandeja da waybar (só o aviso da libayatana), a janela com o celular real (precisa da v39 nele). APK `dist/apk/mybots-v39.apk`, versionCode 39, 0.20.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `7649df4f814dd1d3a152251379e379549d25aaeb350a2d3932288a957b132ba3`. Release v39.

## 21/10/2026 — Janela do PC com layout próprio (sem versão nova do APK)

Pedido: a janela não deve ser o celular esticado; quer algo como WhatsApp/Slack, com os bots à esquerda e a conversa no meio, sem perder o resto de vista.

- Com a janela a partir de 900 px: **barra lateral** (marca, novo bot, ajustes, busca, salas e bots com presença, prévia, hora e "trabalhando/esperando/dormindo", rodapé com o celular conectado e a Atividade), **conversa no meio** (bot ou sala, sem botão de voltar) ou boas-vindas com o resumo do dia; a partir de 1280 px, painel **Hoje** à direita (decisões, pendências com concluir, próximas rotinas e o que os bots fizeram, sem o "Resposta concluída" de cada passo).
- Perfil, Ajustes, Atividade e as outras folhas abrem como janelas centralizadas, sem a alça do celular. Sem o espaço da barra de status no topo.
- O celular não muda (conferido no emulador: sala e conversa com Voltar). 124 testes. Conferido no Chrome em 1440×900 e 1100×800 com o celular do emulador. A interface nova já é servida pelo `mybots-pc` deste PC (`pc/ui` gerado de novo).

## 21/10/2026 — v40 (0.21.0): o que o bot vê no computador

Relato: o Desenvolvedor (Codex) disse que só acessava a pasta dele e /tmp. No teste: o Codex **lia o disco inteiro** (inclusive listava `~/.ssh`) e só gravava na pasta; e respondia sem tentar, por causa do "somente as ferramentas mybots-tools" do texto base. Decisão com o usuário (tabela em `docs/computador.md`): ver e ler livre na pasta dele e nas liberadas; fora delas, Total livre e Médio pede (ler pode virar "Sempre"); senhas e chaves nunca.

- **Pastas no computador** (perfil → Acesso, campo `folders` do bot, até 10, validadas no celular: nunca `~`, `/` ou pastas de chaves). No PC viram `--add-dir` (Claude) e `sandbox_workspace_write.writable_roots` (Codex); `~` é resolvido no computador e pastas inexistentes são ignoradas. Acesso total: a pasta pessoal inteira.
- **Bubblewrap em toda resposta no computador** (`sandboxFor` em `pc/server.mjs`, opção `wrap` dos runners): `~/.ssh`, `~/.gnupg`, `~/.mybots-pc`, `~/.password-store`, `~/.aws`, `~/.kube`, `~/.docker`, chaveiros, `~/.config/gh`, `~/.config/rclone` e o login da outra IA ficam vazios. Conferido que o sandbox do Codex funciona dentro dele.
- **Orientação**: diz as pastas livres, o que precisa de aprovação, que ali ele tem terminal e arquivos além do mybots-tools ("vale por cima de somente…") e que deve tentar antes de dizer que não consegue.

126 testes (novos: pastas e isolamento nos argumentos do Claude e do Codex; pastas recusadas no celular). Real no emulador + nó de teste: Codex gpt-6-luna Médio com pasta liberada → `~/.ssh` com 0 arquivos, gravou na liberada, "somente leitura" fora; Claude Sonnet Médio → criou na liberada sem pedir, ler `~/.bashrc` virou cartão "Ler um arquivo fora da pasta do bot" e leu após permitir, e descreveu o acesso certo. Serviço `mybots-pc` reiniciado e `pc/ui` gerado de novo neste PC. APK `dist/apk/mybots-v40.apk`, versionCode 40, 0.21.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `5e0061ecd3841252fe887f27e3c9f76fde2ca123e8122c34227f2f893a6e5f25`. Release v40.

## 21/10/2026 — Correções da janela do PC (sem APK novo)

Relato após a v40: a janela mostrava "Atenção · Acesso negado" e uma mensagem mandada pelo celular só apareceu nela depois de fechar e abrir de novo.

- **Causa**: o token da janela era novo a cada início do nó; ao reiniciar o `mybots-pc` (atualização), a página aberta tentava reconectar com o token antigo, era recusada e ficava sem os eventos. Agora o token fica em `~/.mybots-pc/ui-token` (600) e sobrevive aos reinícios; se mesmo assim for recusado, a página se recarrega sozinha. Texto da desconexão no PC: "O MyBots do computador reiniciou. Reconectando…".
- **Pastas digitadas com outra caixa** (`~/vscodeprojects` para `~/vscodeProjects`): o nó acha a pasta mesmo assim.
- Conferido: o Desenvolvedor está em **Acesso total**, por isso disse que lê e salva em toda a pasta pessoal (como combinado); `.aws` e as outras pastas de chaves aparecem vazias para ele pelo bubblewrap.

Teste da janela ampliado (mensagem mandada no celular chega ao vivo; token igual depois de reiniciar). 126 testes. Serviço reiniciado duas vezes neste PC com o mesmo token e o celular reconectando.

## 21/10/2026 — QR de pareamento na janela do PC (sem APK novo)

Pedido: gerar o QR pela janela do MyBots no PC, em vez do terminal. `desktop.pair` (método local da janela, em `pc/ui.mjs`) cria o código de uso único e devolve o QR em SVG (biblioteca `qrcode` do nó); `desktop.status` diz quando foi o último pareamento. Na janela: **Ajustes → Celular → Mostrar QR**, e na tela inicial enquanto o celular estiver fora de alcance sem dados; o QR some quando o celular pareia (e a janela carrega os bots sozinha). Subtítulo dos Ajustes: "neste computador". Conferido: QR do print da janela decodificado (jsQR) é o link certo, e o emulador pareou com esse link; teste da janela ampliado. 126 testes. Aplicado neste PC (`pc/ui` e `mybots-pc` reiniciado; o celular reconectou com o mesmo token).

## 21/10/2026 — v41 (0.22.0): respostas longas e falas durante o trabalho

Relato: na sala "Projeto vagas", o Programador (Codex, só do computador) falhou com "O Codex demorou mais que o esperado"; e o pedido de que os bots fossem contando o que fazem, como uma conversa, em vez de 20 minutos calados.

- **Causa do erro**: limite fixo de 3 minutos por resposta (10 nos raciocínios máximos), igual no Codex e no Claude, no celular e no computador. Não tinha relação com o celular fora do app nem com o bot ser do computador. Agora o limite é por **inatividade**: a resposta só é interrompida depois de 10 minutos sem nenhum evento da IA, até 2 horas no total; a mensagem diz para pedir para continuar.
- **Falas durante o trabalho** (`progressTracker` em `lib/codex-runner.cjs`): o que a IA escreve antes de usar uma ferramenta ou de escrever outra coisa vira uma mensagem na hora (`progress: true`, na conversa ou na sala, até 30 por resposta); a última fala é a resposta. Codex: `agent_message`; Claude: blocos de texto do `assistant` antes de `tool_use`. Pelo computador, o nó manda `progress` pelo link.
- **Passo atual** sob "Pensando" (conversa e sala): "Rodando python3 -m unittest…", "Editando primos.py", "Usando task_list_items" (`task.step`, só em memória).
- Orientação nova em todos os bots: em tarefas com vários passos, contar em frases curtas o que vai fazer e o que descobriu.

129 testes (novos em `tests/progress.test.mjs`: falas e resposta final; IA muda é interrompida e IA que dá sinal não; falas e passo na conversa e na sala). Real no emulador + nó de teste: Codex gpt-6-luna criou `primos.py` e o teste com 4 falas e o passo mudando ao vivo; Claude Sonnet contou "Etapa 1…", "Etapa 2…" antes do resumo. Serviço `mybots-pc` e `pc/ui` atualizados neste PC. APK `dist/apk/mybots-v41.apk`, versionCode 41, 0.22.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `d9619de18f108d957cda29f2077b308b4d7437694d3b556e2c3736adf69b17dc`. Release v41.

## 21/10/2026 — v42 (0.23.0): habilidades (bots criados com ajuda do PC que rodam sozinhos no celular)

- **`skill_propose`**: o bot (em geral o do computador) manda um módulo JavaScript com `run(input, kit)`, nome, descrição, sites, exemplo de entrada, e opcionalmente `new_bot` e `daily_at`. Sempre vira cartão "Instalar uma habilidade no celular" (sem "Sempre permitir", mesmo no Acesso total) com sites, destino, rotina e tamanho. Aprovada: instala (banco versão 7, tabela `skills`; arquivos em `~/.mybots/skills/<id>/`), cria o bot novo no celular se pedido, cria a rotina diária e roda um teste no celular, devolvendo o resultado ao bot que propôs. Mesmo nome = nova versão.
- **Isolamento** (`supervisor/skill-host.mjs`, Node 24 do Termux): `--permission` (lê só a pasta, grava só `data/`, sem processos/workers/addons), imports de rede e processos recusados por `registerHooks`, `fetch` só nos sites declarados (redirecionamentos conferidos), tempo limite.
- **Rotina sem IA**: roda o programa direto; resultado na conversa (resumo e lista "**vaga** — empresa · cidade · abrir", até 15) e planilha `.xlsx` com tudo, e notificação. `skill_run`/`skill_list` para o bot usar numa conversa. Perfil → Rotinas → Habilidades (Rodar agora, Remover). Backup inclui habilidades.
- **Internet nos comandos do Codex no PC** (`sandbox_workspace_write.network_access`), para testar programas que usam a internet; chaves continuam escondidas pelo bubblewrap.
- Na janela do PC, as confirmações (apagar bot/sala, remover habilidade) viram uma janelinha do próprio app (o `Alert` não existe na web).

132 testes (novos em `tests/skills.test.mjs`: validação da proposta; cartão mesmo no Acesso total, bot novo, rotina sem IA, mensagem, planilha, notificação sem nenhuma tarefa de IA, `skill_run` só do dono, backup, remover leva a rotina; isolamento: `/etc/passwd`, `child_process`, `net`, site não declarado, tempo limite, promessa esquecida, gravação em `data/`). Real: Codex gpt-6-luna no PC, com falas ao vivo, descobriu que a API da Gupy pede login, usou a busca pública do portal, testou com node (19 vagas) e propôs; aprovado, o emulador (Node 24, isolamento ativo) criou o bot Vagas, rodou o teste (19 vagas) e a rotina entregou a lista e a planilha. Serviço `mybots-pc` e `pc/ui` atualizados neste PC. APK `dist/apk/mybots-v42.apk`, versionCode 42, 0.23.0, ARM64, certificado `fac61745…033b9c`, SHA-256 `7d36b2cbbbc56ed75f4edd1726dcfa16239873904e9607da9a8b1952337df8c6`. Release v42.

## 21/10/2026 — v43 (0.23.1): o bot vê as páginas de PDF com figuras e fórmulas

Relato: o Maniaco (Claude Haiku, celular) baixou do SIGAA as tarefas de Estabilidade (LCSD T5) e Diagramas de Blocos (CSD T6) e gerou os PDFs com o nome do Augusto, mas deixou as resoluções "parciais": as frações das funções de transferência vieram quebradas no texto e os diagramas eram só figuras.

- **Causa**: a leitura de PDF só mandava as páginas como imagem quando a página não tinha texto nenhum (escaneada); páginas com texto e figuras chegavam só como texto extraído.
- **Correção**: `attachment_read` ganhou `as_image` (as páginas como imagem, 4 por vez, pelo PdfRenderer do celular, `images: 'all'`). Toda leitura de PDF sem `as_image` agora diz para ler de novo com `as_image true` se houver figuras, diagramas, gráficos, fórmulas, frações ou texto quebrado; a descrição da ferramenta pede o mesmo em vez de dizer que não consegue.

133 testes (novo: PDF com texto traz a dica; `as_image` devolve 4 páginas como imagem a partir da pedida; valor inválido recusado). No emulador: PDF gerado com um diagrama de blocos só desenhado (1/(s+2), 5/s, realimentação 2) → bot do celular (gpt-6-luna) leu o texto, leu de novo como imagem e respondeu T(s) = 5/(s² + 2s + 10), certo. APK `dist/apk/mybots-v43.apk`, versionCode 43, 0.23.1, ARM64, certificado `fac61745…033b9c`, SHA-256 `432b25dffa1e87c0606e010b61f2801420009cfccea6af2412133dce8a66f084`. Release v43.


## 21/10/2026 — v44 (0.24.0): controle do desktop e Chrome de cada bot

- **Controlar a tela do computador** (`desktop`): permissão nova, explícita por bot, desligada até no Total e nunca disponível no Pouco acesso nem em respostas pelo celular. Ferramentas MCP `desktop_screenshot` (grim, imagem), `desktop_windows/focus/launch` (hyprctl) e `desktop_click/type/key` (ydotool). No Médio, ações pedem cartão decidido no celular, com Sempre permitir por tipo; no Total, executam depois de a permissão própria ser ligada. Cancelar/revogar enquanto o cartão está aberto impede a ação.
- **Foco no Hyprland**: seguindo o aviso da pessoa, `desktop_focus` também leva o ponteiro ao centro da janela e reafirma o foco, inclusive quando está em outro monitor. Texto com acentos/símbolos usa clipboard temporário e colagem por ydotool, restaurando o anterior; formatos ricos que não consegue preservar são recusados. Confirmado texto “Olá, ação!” (o ydotool puro descartava os acentos).
- **Aviso e pânico**: notificação crítica persistente do swaync enquanto o bot controla desktop/Chrome (se o aviso falhar, não executa). `node pc/node.mjs panic` usa socket Unix privado, cancela respostas e mata os navegadores sem depender do celular. A pessoa confirmou antes da edição de `~/.config/hypr/hyprland.conf`: `bind = SUPER SHIFT, Escape, exec, /usr/bin/node /home/augusto/vscodeProjects/mybots/pc/node.mjs panic`. Conferida no registro de binds do Hyprland. A pessoa instalou ydotool e carregou uinput; o serviço do usuário ydotool foi ativado sem sudo (ACL do dispositivo permite este usuário).
- **Chrome real**: Playwright-core fixado, `/usr/bin/google-chrome-stable`, processo e perfil por bot em `~/.mybots-pc/browsers/<id>`. As mesmas ferramentas browser_* do celular são executadas no PC quando a resposta vem dele, com política/aprovação no celular. Perfis isolam e persistem cookies. Upload só dos anexos daquele bot, sempre aprovado. O painel do celular informa que a página está no PC; Assumir bloqueia novas ações e Devolver retoma também quando só a IA do PC está logada.
- **Senhas só no cofre do Android**: browser_login pede uma cifra RSA-OAEP SHA-256/AES-256-GCM presa a desafio, site/bot autorizado e URL exata. Chave privada temporária só no processo do navegador, uso único, até 60 s. Supervisor/nó só encaminham cifra; o modelo recebe só o resultado. Gerenciador de senhas do Chrome desligado; campos de senha recusados em browser_type, omitidos em leituras e cobertos em capturas; senhas preenchidas também são filtradas dos resultados.
- **Isolamento**: bubblewrap obrigatório, MYBOTS_PC_HOME escondido mesmo quando personalizado, namespace de processos e /proc próprios, /dev mínimo e sockets de desktop ocultos. Ferramentas nativas do modelo não acessam diretamente os controles nem o processo/perfil que preenche senhas. Orientação por turno atualizada no Codex e Claude com ferramentas, limites, aprovações, mouse/foco e senhas.

**140 testes passando** (7 novos em tests/desktop.test.mjs: permissão independente/níveis/lugar, cartões/sempre/negar/revogar, túnel, indicador/pânico, browser com decisão no celular, argv/foco/clipboard/teclas soltas, isolamento real bubblewrap, cifra/uso único/URL/desafio e Chrome real com cookies isolados/persistentes, campo de senha bloqueado, imagem e texto com acentos).

**Real no emulador, nó separado** (`MYBOTS_PC_HOME=/tmp/mybots-v44-node`, portas 3231/3233, sem usar o serviço mybots-pc real): Codex gpt-6-luna listou 5 janelas, viu screenshot, abriu app via hyprctl, focou/clicou/digitou TESTE V44 numa janela zenity (texto conferido no resultado da janela), abriu example.com no Chrome e leu “Example Domain”; cartão do Médio com Sempre permitir conferido e aprovado; pânico durante browser_wait interrompeu a resposta em 395 ms. Login fictício do teste anterior no the-internet.herokuapp.com foi preenchido pelo cofre Android no Chrome do PC e entrou na Secure Area, sem senha no histórico. Codex e Claude Haiku reais responderam com o bubblewrap reforçado. Interface pc/ui regenerada.

**Limites conferidos**: só havia um monitor fisicamente ativo neste teste; coordenadas de segundo monitor têm teste automatizado. Downloads automáticos do Chrome ainda ficam bloqueados (upload de anexo aprovado funciona). Acesso ao mesmo usuário Linux e outros serviços locais não equivale a isolamento de uma conta separada.

APK `dist/apk/mybots-v44.apk`, versionCode 44, 0.24.0, ARM64, build offline, certificado `fac61745…033b9c`, SHA-256 `0b7ef844ef18be84c4ebc3daec84e86389f4e510f1aa9b97e49090f3baebc8e8`. Release v44 com APK e .sha256 para atualização pelo app.


## 21/10/2026 — v45 (0.25.0): Claude in Chrome oficial

Pedido da pessoa: integrar o navegador oficial do Claude, mantendo Playwright para modelos Codex. A pessoa escolheu usar o Chrome principal e instalou/conectou a extensão oficial.

- **Claude no PC**: `--chrome`, ferramentas oficiais `mcp__claude-in-chrome__*`, Chrome principal e logins compartilhados entre os bots Claude. No celular, navegador do app; Codex no PC mantém Playwright, perfis por bot e login cifrado do cofre Android. Não há fallback silencioso para Playwright no Claude.
- **Decisão no celular**: hook oficial `PreToolUse` autenticado pelo token da resposta e encaminhado pelo túnel, inclusive para leituras e ferramentas já autorizadas no CLI. Confere execução ativa, aparelho, provedor, permissão Navegador e argumentos; IDs não são reutilizados. Médio pede aprovação lembrável para ações; Total permite ações individuais; uploads e lotes sempre pedem aprovação. Pouco acesso bloqueia. Apps da conta não concedem acesso ao Chrome.
- **Falhas e controle**: `onFailure: "block"` impede execução em recusa, desconexão ou falha do hook; exige Claude Code 2.1.295+. Mesmo aviso visível, dono único de controle e pânico local; o Chrome principal permanece aberto ao interromper. Assumir bloqueia novas chamadas ao Chrome compartilhado até devolver. Ações já enviadas à extensão não são desfeitas.
- **Interface e orientação**: painel “Chrome principal · Claude”, login manual nesse Chrome e `browser_ask_user` para ajuda; as ferramentas browser_* do Playwright ficam ocultas/bloqueadas para Claude no PC. Sessões antigas do Claude no PC são renovadas uma vez, preservando histórico, inclusive em salas. O perfil pessoal do Chrome fica vazio no bubblewrap, impedindo leitura direta dos arquivos de cookies/senhas pelo modelo.

**145 testes passando** (5 novos): políticas, cartões/Sempre permitir, recusa/revogação, Assumir, uploads, capacidade encerrada, indicador/pânico, renovação de sessão e CLI Claude real com API/MCP simulados. Este último confirma que uma ferramenta pré-autorizada não executa quando o celular recusa ou o hook fica inacessível.

**Teste real no PC, nó isolado** (`MYBOTS_PC_HOME=/tmp/mybots-v45-node`, portas 3231/3233, página fictícia local em 3235, sem usar o serviço mybots-pc): Claude Haiku criou aba própria, leu a página, preencheu “Olá, Chrome oficial v45!”, enviou o formulário e conferiu o resultado, capturou screenshot oficial e fechou só a aba de teste. Chamadas oficiais autorizadas pelo supervisor e aviso do desktop ativos. Interface pc/ui regenerada.

**Emulador**: validação final do APK/painel e regressão real Codex nesta versão ficaram pendentes; a pessoa pediu publicação imediata porque sairia e o PC ficaria sem internet. O emulador foi iniciado, mas a instalação/teste não foi concluída. Regressão automatizada do Codex/Playwright passou na suíte completa.

APK `dist/apk/mybots-v45.apk`, versionCode 45, 0.25.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `6b92e8235c42d8a660ab83a498829f0b118e8b5a3a25033f154faac4d9be05c8`. Release v45 com APK e .sha256 para atualização pelo app.


## 21/10/2026 — v46 (0.26.0): Chrome de cada bot dentro do MyBots, senhas por CSV e novo campo de mensagem

Pedido da pessoa: o navegador real do PC dentro do app, como nos outros apps de bots (OpenBot, OpenMausBot), um Chrome por bot; tentar a conta Google em cada Chrome; importar o CSV de senhas; e corrigir o campo de mensagem (layout como o do Claude, ditado que não para na pausa, ditado nas salas e no PC).

- **Google por bot (testado, não funciona)**: com Chrome 155, Playwright, Chrome comum aberto pelo MyBots e conectado depois por depuração remota, e sem janela: todos recusados pelo Google (“This browser or app may not be secure”, `navigator.webdriver` verdadeiro). O OpenMausBot só passa usando o Chrome da pessoa iniciado por ela. Sem disfarce de automação.
- **Chrome do bot dentro do app**: o Chrome de cada bot no PC roda sem janela; screencast JPEG (~8 qps, só quando muda) vai pelo nó → link → supervisor só para as conexões que olham aquele bot; a janela do PC recebe direto do nó. Assumir permite toque (clique), arrastar (rolar), texto (com modo escondido para senhas/códigos), teclas, voltar, recarregar e endereço. O nó recusa entradas sem Assumir pelo estado de controle que o celular envia.
- **Claude no PC**: usa o Chrome próprio do bot por padrão; Claude in Chrome (Chrome principal) virou opção por bot em Acesso → Navegador no computador.
- **Senhas por CSV**: Ajustes → Senhas → Importar CSV (Chrome, Firefox, Bitwarden, 1Password); lido e gravado no código nativo, sem passar pelo JavaScript/supervisor/IA; oferece apagar o arquivo exportado.
- **Campo de mensagem**: caixa no formato do Claude (texto em cima; +, microfone e enviar embaixo) na conversa e nas salas. Ditado do Android continua ouvindo nas pausas até tocar em ✓ (reinicia o reconhecedor a cada frase e junta o texto). No PC, ditado gravado e transcrito localmente com o faster-whisper que já estava no computador (venv do projeto de entrevista, modelo medium em CPU int8; a GPU não carrega por faltar libcublas 12), ou whisper.cpp.

**151 testes passando** (7 novos): repasse da tela ao vivo e recusa sem Assumir (app e janela do PC), Chrome real sem janela (quadros, rolagem, teclas, texto, bloqueio de endereço local), IPC do processo do Chrome, opção do Chrome principal, ditado no PC com gravador e whisper simulados (whisper.cpp e faster-whisper). Caminho real com faster-whisper conferido: modelo carregado durante a gravação, transcrição em ~0,1 s depois de parar (áudio de teste sem fala; não havia sintetizador de voz para um teste falado).

**Emulador (APK x86_64 v46, nó de teste isolado nas portas 3231/3233)**: bot Codex no PC abriu a Wikipédia pelo Chrome sem janela; a página apareceu ao vivo no app; Assumir, toque em link, arrastar para rolar e endereço digitado funcionaram; devolvido ao bot. CSV com vírgula/aspas e nota em várias linhas: 2 importadas, 2 ignoradas (app Android, sem senha), arquivo apagado. Composer novo na conversa e na sala; ditado seguiu ouvindo após 26 s de silêncio. Janela do PC (interface web nova servida pelo nó de teste) mostrou o painel do Chrome e o composer; ditado avisa que falta o whisper.cpp. O serviço `mybots-pc` real não foi reiniciado (o celular ainda está na v45).


APK `dist/apk/mybots-v46.apk`, versionCode 46, 0.26.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `9563cff9fe2b200427e647e60cfe3af69e0fb75a353f5079a7398352cf8d80da`. Release v46 com APK e .sha256 para atualização pelo app. Ditado do PC configurado com o Python do faster-whisper em `~/.mybots-pc/whisper/python`; interface do PC regenerada e serviço `mybots-pc` reiniciado.


## 21/10/2026 — v47 (0.27.0): ferramentas completas de navegação

- **Novas ferramentas**: `browser_act` (cliques, hover, rolagem, teclas e arraste por coordenadas), `browser_tabs` (até cinco abas no PC, inclusive popups) e `browser_find` (busca por descrição com pontuação local, sem IA). Compartilham a permissão Navegador e ficam ocultas em Pouco acesso.
- **Leitura e captura**: ids estáveis entre leituras, caixas e rolagem, iframes da mesma origem, capturas JPEG com tamanho e marcação numerada removida no `finally`. Busca e leitura usam o mesmo código no Chrome e na WebView (conferido por teste). Campos de senha não retornam valores, inclusive na inspeção nativa; capturas mascaram senhas. `browser_wait` aceita trecho da URL.
- **Abas e tela ao vivo**: popups preservados, sexto recusado, troca refaz o screencast. Painel mostra faixa de abas com títulos; tocar para trocar exige Assumir, conferido também no nó. Arraste, clique direito e abas são exclusivos do PC; links que exigem nova aba dão mensagem explícita na WebView. Hover na WebView combina eventos da página com movimento de mouse nativo para menus CSS.
- **Aprovação**: envio por ponto, Enter em formulário, arraste e teclas de edição usam `browser/write` no Médio, com Sempre permitir; Total passa, upload continua sempre pedindo. Alvo conferido antes da ação e novamente após aprovação; mudança de tipo/rótulo/URL recusa a execução. Assumir bloqueia as ferramentas. Instruções Codex/Claude atualizadas e `PROMPT_VERSION=3` renova sessões uma vez.

**155 testes passando**, incluindo Chrome real: argumentos inválidos, permissões/aprovações/Sempre permitir, Pouco acesso, Assumir, hover CSS, rolagem com carregamento, popup e troca de aba, arraste, busca, iframe, captura numerada sem resíduos e quadros da nova aba. Scripts nativos conferidos contra os do PC; regressões para popup sem suporte e inspeção de senha. Dois testes antigos de transmissão foram ajustados para aceitar quadros adicionais e aguardar a remoção do perfil temporário após encerrar o Chrome.

**Emulador x86_64 + nó isolado** (3231/3233, interface exportada em `/tmp`, sem reiniciar o serviço real), Codex real **gpt-6-luna**: hovers → `user2`; infinite_scroll → cinco parágrafos, primeira palavra do quinto `Vel` nesta execução; windows → título `New Window`; drag_and_drop → cartão no Médio e ordem B/A conferida na tela ao vivo. Faixa de duas abas conferida visualmente, troca por toque após Assumir. Bot no celular: hover → `user2`; popup e `browser_tabs` recusados com explicação de que abas só existem quando responde pelo computador.

APK `dist/apk/mybots-v47.apk`, versionCode 47, 0.27.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `ca4cf58188a22fb7e4ee25a3cc5f77d8064fc80dd23def55b98f4934c67a7677`. Release v47 com APK e `.sha256` para atualização pelo app. Depois de a pessoa confirmar a atualização do celular para a v47, a interface do PC foi regenerada e a janela compilada/instalada com `scripts/build-desktop.sh`. O serviço real `mybots-pc` foi reiniciado e conferido como `active/running` em 21/10/2026 às 11h44 (Brasília), concluindo a atualização dos dois lados.


## 21/10/2026 — v48 (0.28.0): Meu Chrome

- **Três modos por bot**: Chrome próprio (padrão), Meu Chrome (Codex/Claude com os logins da pessoa) e Claude in Chrome (extensão oficial, só Claude). `browserMode` substitui a escolha antiga; `mainChrome: true` migra para `claude` na leitura. Perfil, backup, seleção, marca de sessão de conversas/salas, executor e orientação dos modelos atualizados. `PROMPT_VERSION=4` renova sessões antigas uma vez.
- **Conexão pessoal**: nó lê o `DevToolsActivePort`, confere porta/caminho e conecta só ao loopback. Worker compartilhado de Meu Chrome, com abas e tela ao vivo separadas por bot (limite de cinco por bot). Só trabalha nas abas que criou. Usa `noDefaults`, mantém preferências e permissões do Chrome da pessoa e aplica a dimensão da captura só ao alvo do bot, sem redimensionar a janela pessoal. Ao parar, fecha só suas abas e desconecta, preservando o Chrome.
- **Política**: Navegador precisa estar liberado; Pouco acesso volta ao Chrome próprio. Médio usa aprovação própria `browser/mine/write` para ações, com Sempre permitir; leitura e troca de abas passam. Upload sempre pede. Assumir em um bot Meu Chrome bloqueia todos os bots do modo, conferido no supervisor e no nó. Indicador do desktop mantido. Cancelar login ou parar visualização não inicia uma nova conexão.
- **Interface**: opções de navegador no perfil, instruções para ativar a depuração e confirmar no Chrome, indicação Meu Chrome na tela ao vivo e troca de modo com renovação do painel. Chrome próprio mantém isolamento; Meu Chrome compartilha cookies/logins entre bots. Popups são abertos em abas com URL conferida; sites que dependem da referência JavaScript da janela de origem podem exigir ajuda da pessoa.

**159 testes passando**. Chrome real separado: duas abas de bots no mesmo worker, URLs e quadros separados, login simulado compartilhado por cookie, aba pessoal preservada, tamanho pessoal inalterado, rota de bloqueio local restrita ao bot, popups, encerramento de um bot preservando o outro e desconexão sem fechar o Chrome. Migração de perfil, modos inválidos, sessão renovada, validação do endpoint, política Médio/Total/Pouco, chave própria/Sempre permitir e Assumir compartilhado. Regressões do Chrome próprio, Claude in Chrome, cofre cifrado e bootstrap do supervisor continuam passando.

**Emulador x86_64 + nó isolado 3231/3233**, com Chrome separado de teste e Codex real **gpt-6-luna**: Meu Chrome abriu `example.com` (Example Domain), abriu outra aba e o popup da página windows (New Window). Aba pessoal sintética permaneceu em `about:blank`, com o mesmo título/conteúdo e Chrome ativo. Perfil/Acesso e opção Meu Chrome conferidos visualmente. Interface web exportada para pasta temporária; serviço real não reiniciado.

**Aceite da conta Google pessoal pendente**: depende de a pessoa ligar `chrome://inspect/#remote-debugging` e confirmar a conexão. Não foi alegado login Google validado no perfil real. A pessoa confirmou o celular na v48 e determinou que, a partir desta entrega, o PC deve ser atualizado sempre após cada Release, sem aguardar nova confirmação do celular.

Encerramento de popup com requisição propositalmente pendente conferido: fecha pelo alvo de depuração da aba do bot, sem depender do carregamento e sem fechar o Chrome.

APK `dist/apk/mybots-v48.apk`, versionCode 48, 0.28.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `bf3fc8dee565af81885e600889dfe2954e1308e15a62fa7e606732cff70dbab0`. Release v48 com APK e `.sha256` para atualização pelo app.

**Atualização do PC concluída em 21/10/2026 às 13h40 (Brasília)**: após confirmação do celular na v48, `scripts/build-desktop.sh` regenerou a interface e compilou/instalou a janela; binário instalado conferido com o compilado e serviço `mybots-pc` reiniciado como `active/running`. A verificação local retornou `ok: true`, mas ainda sem celular conectado. Regra permanente da pessoa registrada nos dois planos: atualizar sempre o PC após cada Release, sem aguardar nova confirmação do celular.


## 21/10/2026 — v49 (0.29.0): o celular acha o computador sozinho

- **Descoberta local**: novo `pc/discovery.mjs` escuta UDP 3234 (ou `MYBOTS_PC_DISCOVERY_PORT`) e responde por unicast a perguntas do próprio identificador, vindas de endereços privados. Sem segredos; pacotes limitados a 512 bytes, JSON inválido ignorado, limite por remetente de dois segundos e memória limitada. O socket fecha com o nó; falha na descoberta não impede o serviço de funcionar.
- **Reconexão**: novo `supervisor/discovery.mjs`, incluído no pacote Android, procura por broadcast global e das interfaces. Depois de falhar nos endereços salvos, o link tenta os encontrados imediatamente, com timeout de dois segundos e intervalo mínimo de 15 segundos entre buscas. Ao voltar ao primeiro plano offline, procura antes de tentar os endereços antigos. Certificado fixado e identidade continuam obrigatórios; respostas falsas não alteram o pareamento nem bloqueiam outra resposta correta. Endereços verificados e porta correta são salvos sem perder os anteriores. Encerramento cancela a descoberta; tentativas antigas não sobrescrevem a conexão nova.
- **Interface**: mensagem de alcance explica busca local e Tailscale; após dois minutos sem celular, o PC mostra aviso de mudança de rede e acesso a Mostrar QR. Ajustes nos dois lados indicam presença de endereço Tailscale e oferecem o link de instalação. No celular a indicação é a da última conexão; no PC é consultada localmente. Nenhuma instalação/configuração de VPN é feita automaticamente.

**163 testes passando** (quatro novos em `tests/link.test.mjs`): endereço antigo recuperado sem QR, porta e identidade preservadas, pergunta para outro identificador ignorada, remetente público recusado, pacote grande/JSON inválido ignorados, limite de respostas, cálculo do broadcast, resposta falsa recusada pelo certificado sem salvar endereços, resposta correta posterior aceita, erro de alcance claro, intervalo entre buscas e cancelamento no fechamento. Status do desktop confere tempo offline e Tailscale. Uma repetição teve EPIPE no teste existente de backup; a execução completa seguinte passou sem alterações nesse teste.

**Android/emulador**: APK x86_64 v49 instalado; supervisor da versão ativo. Pareamento com nó isolado 3231/3233 e Codex real **gpt-6-luna** respondeu “Conexão do PC v49 funcionando.” O módulo empacotado no Termux enviou broadcast sem erro de permissão e recebeu/validou resposta UDP unicast do nó isolado pela rede virtual (porta 3235). Interface do PC conferida com relógio adiantado só no navegador de teste: aviso após dois minutos, texto Tailscale e botão gerando QR. Nenhuma espera real de dois minutos. **Aceite de mudança de Wi-Fi no celular real pendente**, pois o NAT do emulador não representa o broadcast do Wi-Fi físico.

APK `dist/apk/mybots-v49.apk`, versionCode 49, 0.29.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `994b3672ba3e0abb547e116ee851be65a5352e7989225d89c9276ee7ef87505a`.

Release pública [v49](https://github.com/AugustodoBRT/Mybots/releases/tag/v49) conferida com `mybots-v49.apk` e `.sha256`, incluindo hash do APK igual ao local. **PC atualizado nesta mesma entrega**, sem pedir nova confirmação: interface regenerada, janela compilada/instalada e binário instalado conferido com o compilado. Serviço real `mybots-pc` reiniciado em 21/10/2026 às 14h17 (Brasília), `active/running`. UDP 3234 ouvindo; pergunta por broadcast feita do próprio PC recebeu a resposta real com porta 3230 e endereço `192.168.1.106`. Isso confere o serviço na interface de rede, sem substituir o aceite no celular físico. Verificação local `ok: true`, celular ainda desconectado no momento da entrega. Nó temporário encerrado.


## 22/10/2026 — v50 (0.30.0): arquivos em salas, equipe de bots e apps do Codex

- **Arquivos em salas**: `room.send` aceita `attachments` (até 5 arquivos, 10 MB). O arquivo é guardado uma vez e aberto à sala (`room_files`, migração v8); cada bot que está na sala lê com `attachment_read`, inclusive quem entrar depois. Bot fora da sala não lê. O app ganhou o "+" e a bandeja de anexos nas salas (modo Só no celular, como na conversa privada).
- **Equipe de bots** (permissão nova "Equipe de bots", ligada por padrão; desligada em Pouco acesso até a pessoa ligar; o interruptor desligado vale até no Acesso total): `team_bots`, `team_rooms`, `team_create_bot`, `team_create_room`, `team_add_to_room`, `team_remove_from_room`, `team_leave_room`, `team_close_room`, `team_post`, `team_read_room`. Sem cartão de aprovação. Freios: bot criado nunca tem mais acesso que o criador; só mexe em sala em que está ou que criou; sala fica com 2 bots ou mais; até 5 bots e 3 salas por vez, 30 bots e 20 salas no total; encadeamento de chamadas por @ sobe de 3 para 6 rodadas. Entradas e saídas aparecem como avisos na sala.
- **Apps da conta no Codex**: bots Codex novos nasciam sem apps (a lista de escolha só existia para Claude). Perfil → Permissões ganhou o interruptor "Apps da sua conta do Codex". Conferido ao vivo com o Codex real: com `apps` ligado e as opções do MyBots, o Indeed busca vagas.

**167 testes passando** (novo `tests/team.test.mjs`). Interface das salas e do perfil não conferida no emulador antes da Release (verificada só por compilação do APK e pelos testes do supervisor).

APK `dist/apk/mybots-v50.apk`, versionCode 50, 0.30.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `c3c63f026ea6289296323f89105c667de65c50b4f49a75c6541ca88897eb2826`.


## 22/10/2026 — v51 (0.30.1): bots diferentes respondem ao mesmo tempo

- **Fila**: antes rodava uma resposta por vez em cada dispositivo, e uma sala inteira esperava o bot ocupado. Agora bots diferentes respondem juntos (`LANE_LIMITS`: 3 no celular, 4 no computador). Um bot responde um turno por vez (privado e salas juntos); numa sala, só as respostas a uma mesma mensagem (mesma origem) mantêm a ordem, então falar com outro bot da sala enquanto um trabalha não entra na fila.
- **168 testes passando**: novo teste em `tests/rooms.test.mjs` (bot lento, outro da sala, privado dele e bot de fora); dois testes antigos de `tests/supervisor.test.mjs` ajustados (dois bots rodam juntos; a fila de um mesmo bot continua em ordem). Não conferido no emulador nem no celular real.

APK `dist/apk/mybots-v51.apk`, versionCode 51, 0.30.1, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `5d4b44d47331166cef34b9b67f280dbba1403fc08fdf174f55f7dc602550a30b`.


## 22/10/2026 — v52 (0.31.0): um navegador por bot sem fila e modelo Google

- **Navegador sem fila**: no PC, o aviso "Outro bot está controlando o computador" valia para o navegador; agora só vale para tela e mouse (`pc/server.mjs`). O navegador de cada bot roda sozinho, e no Meu Chrome (worker compartilhado) cada bot tem a própria fila de comandos (`pc/browser-worker.mjs`). No celular, um fio só executava todos os comandos; agora há um fio por bot (`BotBrowser.kt`) e o limite de WebViews subiu de 4 para 6.
- **Modelo Google** (Novo bot → modelos): vive no computador, em Meu Chrome (logins do Chrome da pessoa), acesso Médio; instruções para trocar de conta, usar só as próprias abas e confirmar antes de enviar, compartilhar, apagar ou mudar configurações. Depende da depuração remota do Chrome (aceite da v48 ainda pendente).
- **169 testes passando** (novo em `tests/desktop.test.mjs`: falha sem a correção). Não conferido no emulador nem no celular real.

APK `dist/apk/mybots-v52.apk`, versionCode 52, 0.31.0, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `fa7c1fff544d5046247a01a532f6830a98d350f55fc92d68ed04c084f17b9be3`.


## 22/10/2026 — v53 (0.31.1): bots chamados com @ trabalham ao mesmo tempo

- **Fila das salas**: na v51 os bots chamados por uma mesma mensagem (a pessoa com "@A e @B", ou um bot chamando dois na mesma resposta) esperavam um ao outro. Agora cada bot chamado com @ tem a própria origem e roda junto com os outros; só a mensagem para todos, sem @, continua em sequência (cada bot lê o que o anterior respondeu). Um bot continua respondendo um turno por vez.
- **170 testes passando** (novo em `tests/rooms.test.mjs`: Diretor chama dois bots e a pessoa chama dois, ambos rodam juntos). Não conferido no celular real.

APK `dist/apk/mybots-v53.apk`, versionCode 53, 0.31.1, somente ARM64, build offline. Certificado SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK `4109150720159d021bb028c93d944a15b32f789ff0b3fef68e661ddec4b2c63f`.


## 27/10/2026 — v54 (0.32.0): navegador sem piscar e tela ao vivo nativa

Somente a seção v54 do `PLANO-V54.md`. O trabalho anterior de rolagem da conversa já estava commitado (`41a7a20`) e foi preservado. Etapas iniciais em quatro commits, na ordem pedida: `076ad0e` (duas imagens), `af27471` (JPEG binário), `50a94c8` (view nativa e `/frames`) e `822148b` (qualidade adaptativa). Finalização da reserva com JPEGs repetidos em `3ccb570`; reabertura do Chrome com espectadores nativos conectados em `b9fe550`, com regressão coberta no teste de relay.

### Mudanças por arquivo

- `mobile/BotBrowserPanel.js`: reserva com duas imagens, promoção somente após decodificação, retenção do quadro mais recente e reutilização de JPEG já carregado; seleciona a view nativa quando disponível e informa dimensões físicas do visor. Toques, rolagem, teclas e caixa de digitação permanecem no RPC serial.
- `mobile/termux.js`: exporta as duas views pelos nomes próprios e mantém a reserva quando a view de quadros não existe.
- `mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/BotFrameView.kt`: socket OkHttp autenticado com o token guardado nativamente, parser binário, decodificação em fio de fundo com `BitmapFactory`/`inBitmap`, dois bitmaps e troca na thread principal; conserva metadados mesmo ao descartar JPEG intermediário e envia à JS no máximo dois eventos por segundo.
- `TermuxBridgeModule.kt`: registra `BotFrameView` junto da WebView existente. `android/build.gradle` do módulo: usa o React Native já instalado para acessar seu OkHttp, sem biblioteca nova.
- `pc/browser-worker.mjs`: bytes de JPEG, sequência crescente, limite de tamanho em `Page.startScreencast`, 5 quadros/s e qualidade 55 ao olhar, 15 quadros/s e qualidade 70 com Assumir e ACK imediato. Reduz qualidade sob pressão e conserva o último quadro pendente. Máscara visual de senha também na transmissão, inclusive em iframes.
- `pc/browser.mjs`: serialização avançada no IPC para preservar os bytes de JPEG.
- `pc/server.mjs`: agrega os tamanhos dos visores, aplica o controle decidido pelo supervisor, codifica o link binário e reduz qualidade quando há acúmulo no link ou no relay.
- `pc/ui.mjs`: mantém a reserva web/PC e o `paced` que pula quadros intermediários, com aviso de pressão antes do descarte.
- `supervisor/browser-frame.mjs`: cabeçalho binário MBF1 de 34 bytes, UUID, dimensões, sequência, metadados opcionais e validação de limites. URL, título e abas só seguem quando mudam.
- `supervisor/link.mjs`: decodifica os quadros sem JSON/base64, conserva os metadados e reenvia dimensões/qualidade na reconexão.
- `supervisor/index.mjs`: `/frames?bot=<id>` no mesmo servidor loopback, autenticação Bearer antes do upgrade, isolamento por bot, controle de pressão e encerramento dos sockets. Conexões nativas não recebem pixels pelo RPC; o limite de um pedido por conexão permanece.
- `scripts/package-supervisor.mjs`: inclui o módulo binário novo no pacote entregue ao Termux.
- `tests/live-browser.test.mjs`: seis testes novos de protocolo, descarte, autenticação/relay, tamanho/qualidade/ACK, Chrome animado e redução de qualidade antes do descarte; testes existentes adaptados aos bytes binários.
- `mobile/app.json` e `mobile/android/app/build.gradle`: versionCode 54, versão 0.32.0. `README.md`, `docs/computador.md`, `docs/seguranca.md` e o plano atualizados. `mobile/supervisor-client.js` e a WebView de `BotBrowser.kt` foram lidos e preservados.

### Testes e emulador

- Base: **171/171**. Implementação: **177/177 testes passaram**, zero falhas, cancelamentos ou skips, incluindo Chrome real em `/usr/bin/google-chrome-stable`; última execução completa em aproximadamente 23 s. Registro: `/tmp/mybots-v54-final-tests.log`. Uma tentativa anterior teve timeouts com pressão de memória durante a compilação/emulador; depois de encerrar os daemons Gradle, a suíte completa passou novamente.
- APK x86_64 v54 instalado no Android 16/API 36; supervisor embarcado conferido pelo hash. Nó de PC **isolado** em `/tmp/mybots-v54-node`, portas 3231/3233, pastas próprias e interface web exportada para esse diretório. Nenhum teste usou ou reiniciou o serviço real `mybots-pc`.
- reCAPTCHA e hCaptcha reais abertos nos endereços do plano. Os dois desafios visuais abriram ao tocar no app; não foram resolvidos automaticamente. A análise dos vídeos depois da mudança, quadro a quadro, encontrou **0 quadros vazios em 258 quadros de reCAPTCHA e 278 de hCaptcha** (536 no total). Recorte interno do visor: x=90, y=530, 900×530, reduzido a 450×265; verificação de região branca sem conteúdo e inspeção das capturas. Isso verifica essas gravações no emulador, não todos os aparelhos.
- Assumir: toque abriu os desafios; digitação pelo campo do app apareceu como **Teste-v54** no formulário hCaptcha; dois arrastos na página `infinite_scroll` moveram a rolagem para **y=723**, altura do documento 1907. Devolver ao bot e Só olhando também conferidos. Um cliente adicional no `/frames` real do emulador recebeu JPEG **960×600**, com sequência crescente.
- Gravações em `.build-tools/emulator-state/v54/`: `antes-recaptcha.mp4`, `antes-hcaptcha.mp4`, `antes-hcaptcha-desafio.mp4`, `depois-recaptcha.mp4`, `depois-hcaptcha.mp4`, `assumir-digitacao.mp4`, `assumir-rolagem.mp4` e `so-olhando.mp4`. Capturas de prova: `recaptcha.png`, `hcaptcha.png`, `digitacao-prova.png`, `rolagem.png` e `so-olhando.png`; contagens em `analise-depois-*.jsonl`. A gravação anterior de reCAPTCHA inclui uma navegação para hCaptcha; seus quadros brancos durante essa transição não foram usados como medida causal do piscar.
- Reabertura no APK final também conferida: fechar o Chrome no nó isolado mostrou “Chrome fechado”; tocar **Abrir o Chrome de novo**, mantendo o socket nativo aberto, abriu uma nova página (`about:blank`) e permitiu navegar novamente. Provas em `reabrir-chrome.mp4`, `chrome-fechado.png`, `chrome-reaberto.png` e `chrome-reaberto-navegando.png`. Supervisor final embarcado: `d3660aad8b3db8128a0d26ea2eee00e981d4e61f768e8ecf4d457a74f16e1254`.
- Reserva web/PC conferida em Chrome real na interface do nó isolado: sete JPEGs de teste na sequência A/B/A/B/A/B/C foram promovidos corretamente, inclusive as repetições de fontes já carregadas. Prova em `reserva-web.png` e `reserva-web.log` na mesma pasta de gravações.
- Limites: não testado no POCO físico nem em rede lenta real; pressão e descarte foram simulados nos testes. CAPTCHA continua exigindo a pessoa. Zoom, tela cheia e novo teclado/toque da v55 ficaram fora do escopo.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v54.apk` e `.sha256`, versionCode 54 / 0.32.0. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

SHA-256 do APK final (39.672.051 bytes): `6bdae273e2b3339969c36ecab82005fe9652e145c2281b34f3b246a7b65a5563`. Release pública [v54](https://github.com/AugustodoBRT/Mybots/releases/tag/v54), marcada como a mais recente, com APK e `.sha256`. O digest do arquivo publicado confere com o APK local; tag apontando para o código final `b9fe550`. **PC atualizado nesta mesma entrega, depois da Release**: `scripts/build-desktop.sh` regenerou a interface, compilou/instalou a janela e reiniciou o serviço real em 27/10/2026 às **10:16:00 (Brasília)**. Binário instalado idêntico ao compilado; `mybots-pc.service` **active/running**, PID 965152, e `http://127.0.0.1:3232/health` respondeu `{"ok":true,"phone":true}`. Nó isolado e emulador encerrados; gravações e registros preservados em `.build-tools/emulator-state/v54/`.


## 27/10/2026 — v55 (0.33.0): controle de verdade pelo celular

Seção v55 do `PLANO-V54.md`. Começou com a correção de oscilação do screencast achada na revisão da v54 (`25af13e`) e seguiu os passos a–h em commits próprios (`0c6918c` a `7e9ff99`). O teste no emulador encontrou defeitos que foram corrigidos antes da entrega:

- **Senha embaralhava o resto** (`c65948d`): cada pedaço digitado no modo secreto virava segredo, e letras soltas eram trocadas por `[senha protegida]` em endereço, título e leituras. Agora vale o valor inteiro do campo, trechos com menos de 4 caracteres nunca são trocados e a senha aparece como bolinhas.
- **Tela congelava com o PC fora** (`539429e`): uma entrada que o PC não recebia fechava o `/frames` com 1008 e a view nativa nunca reconectava. Agora a confirmação traz o erro e a conexão segue; só abuso de protocolo fecha.
- **Chrome reaberto voltava como computador** (`9ea309f`, `9fae4cc`): um quadro com formato diferente do visor faz o app reenviar o tamanho do celular; o teclado fecha quando o Chrome fecha.
- **Zoom do CAPTCHA no lugar errado** (`a2ad95c`): o detector escolhia o desafio de imagens invisível do reCAPTCHA e descartava a caixinha abaixo da dobra. Agora só conta o visível, e a caixinha é trazida ao meio da tela uma vez por página.
- **Desafio de imagens fora da tela** (`f14e158`): no tamanho de celular, o reCAPTCHA abre o desafio ao lado da caixinha. A aba fica no tamanho de computador só enquanto ele está aberto, sem virar preferência do site. Sair da página deixa de contar como "resolvido".
- **Turnstile não detectado** (`bb3ec28`): a página de bloqueio do Cloudflare esconde o desafio em shadow DOM fechado; a lista de frames do Chrome o encontra.
- **Acabamentos** (`8570671`): a imagem mantém a proporção (faixas em vez de esticar), o desafio é enquadrado acima da barra flutuante e pode encolher para mostrar o botão de confirmar, "Conexão lenta" mede a confirmação do toque (um toque que não muda a página não gera quadro) e, enquanto a pessoa controla, o navegador fica sempre na tela e o globo o reabre.

### Testes e emulador

- **187/187 testes passaram** (eram 177 na v54), incluindo Chrome real. Novos: senha letra por letra, entrada recusada sem derrubar `/frames`, caixinha abaixo da dobra com desafio invisível, troca temporária para computador, Turnstile em shadow fechado e "sair não é resolver", além dos testes da v55 do GPT (coordenadas, toques, foco, teclado cifrado, detector, histerese).
- Emulador Android 16 com nó de PC **isolado** (`.build-tools/emulator-state/v55/node.mjs`, portas 3231/3233/3235):
  - Login em `the-internet.herokuapp.com/login` pela tela cheia no modo celular: teclado abrindo sozinho, "café" com acento pelo menu do teclado, senha letra por letra com bolinhas, Enter entrou na área segura e o endereço continuou legível. A senha não aparece em nenhum log do nó.
  - reCAPTCHA demo: caixinha centralizada e aproximada, toque abriu o desafio de imagens, que apareceu inteiro acima da barra; marcar imagens e VERIFY funcionaram em várias rodadas. O Google segue pedindo rodadas para Chrome automatizado, como esperado.
  - Turnstile real (timeanddate.com): detectado após a correção; o Cloudflare recusa o Chrome sem janela e recarrega, limite conhecido (usar **Meu Chrome**).
  - Reinício do Chrome com a tela cheia aberta: tamanho de celular reaplicado e teclado fechado; toque com o PC fora mostrou erro e a tela voltou sozinha.
  - Rede EDGE do emulador por 40 s: nenhuma troca repetida de configuração do screencast (a histerese segurou).
  - Modo **Só no celular**: WebView em tela cheia com Teclado/Zoom, e a página não encolhe com o teclado aberto. Sem página carregada, porque o Codex do emulador não respondeu e esse modo não tem barra de endereço.
- Gravações e prints em `.build-tools/emulator-state/v55/`: `login-senha-corrigida.mp4`, `recaptcha-desafio-imagens.mp4`, `recaptcha-toque-desafio.mp4`, `rede-lenta.mp4` e os `*.png` da sessão.
- Limites: não testado no POCO físico. A troca celular/computador levou 40–60 ms no Chrome em teste isolado, mas uma vez ~17 s no emulador (não reproduzido depois). Tecla Esc de teclado físico fechou a tela cheia sem devolver numa ocasião; o globo agora sempre a reabre.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v55.apk` e `.sha256`, versionCode 55 / 0.33.0, 39.686.619 bytes. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `41cda48b7d4c76e793b0fa16c076b0d32182ad4b7b3c743d54317b39919a83b2`.

Release pública [v55](https://github.com/AugustodoBRT/Mybots/releases/tag/v55), marcada como a mais recente, com o APK e o `.sha256` (o `.sha256` baixado da Release confere). PC atualizado com `scripts/build-desktop.sh`: interface regenerada, janela instalada e serviço `mybots-pc` reiniciado às 11:48:56, `active`.


## 27/10/2026 — v56 (0.34.0): conversas rápidas, parte 1 (supervisor e protocolo)

Seção v56 do `PLANO-V54.md`. Antes, cada passo do bot fazia o app pedir o estado inteiro, com todas as mensagens de todos os bots e salas. Medido no PC com o código da v55 e 5 bots × 5000 mensagens + 3 salas (no limite antigo de 1000): **8,2 MB por `state.get`, 1,86 s**, e gravar a mensagem 5001 levava 85 ms, porque o chat inteiro era apagado e regravado.

- `supervisor/database.mjs`: **migração 9** (`room_messages`, mensagens fora do JSON da sala e sem o limite de 1000; marcas de leitura começam no fim). `appendMessage`, `updateMessage`, `appendRoomMessage` e `replaceMessages` (só para restaurar, mesclar e apagar). `putBot` grava só o perfil. `page` (cursor por rowid), `markRead`, `chatSummary` (prévia de 280 caracteres, contagem, não lidas até 100), `activeTasks` (sem ler o histórico de tarefas). Eventos só saem depois do commit da transação.
- `supervisor/index.mjs`: estado enxuto (sem mensagens; só tarefas em andamento; 50 atividades; skills, memórias, permissões e apps da conta foram para `bot.profile`). `chat.page`, `chat.read` e `bot.profile` no lugar de `chat.history`/`room.history`. Eventos `message.added`, `message.updated`, `bot.updated`, `task.progress` (com o passo) e `chat.reset`, com `seq` crescente; o `state.get` informa o `seq` atual. Um passo do bot não dispara mais `activity.new`.
- `supervisor/queue.mjs`: os passos são só eventos; o prompt de uma sessão nova lê as últimas 400 mensagens. `supervisor/rooms.mjs`, `team.mjs` e `routines.mjs` leem por página. `supervisor/link.mjs`: a janela do PC pode usar `chat.page`, `chat.read` e `bot.profile` e recebe os eventos de mensagem.
- App (`mobile/App.js` + `mobile/chat-events.js`, módulo puro): conversa aberta carrega as últimas 40 e "Ver mensagens anteriores" traz 40 por vez (agora também no chat privado), mantendo a mensagem que se lia no lugar. Eventos aplicados sem pedir o estado; lacuna no `seq` ou reconexão recarregam estado e conversas abertas. Bolinha de não lidas nos cartões de bots e salas. Perfil carrega `bot.profile` ao abrir.
- `scripts/emulator/seed-long.mjs`: cria no emulador um chat com 5000 mensagens e uma sala com 3000 (Markdown, tabelas, código e anexos).

### Testes e emulador

- **193/193 testes passaram** (eram 187). Novos em `tests/conversations.test.mjs`: orçamento (5 bots × 5000 e 3 salas × 3000, mais 400 tarefas antigas e atividades: `state.get` abaixo de 50 KB e 50 ms), `chat.page` percorre 1234 mensagens sem repetir nem pular e marca como lida, migração 9 com 1000 mensagens na ordem, mensagem 5000 com o mesmo número de comandos SQL e escritas da mensagem 10, eventos com conteúdo e números seguidos (passos só como evento) e o redutor do app (páginas, eventos, listas, lacunas). `tests/link.test.mjs` confere os eventos de mensagem na janela do PC. Uma rodada anterior teve um `EPIPE` intermitente no teste de backup do Termux enquanto o emulador disputava a CPU; passou 3 de 3 isolado e na suíte final.
- Emulador Android 16, APK x86_64 da v56 sobre a v55: a migração 9 rodou nos dados reais (sala "Estudos" com 7 mensagens movidas, versão 9). Estado real do emulador: **45 KB** (era 115 KB com o build intermediário que ainda mandava 200 tarefas). Pelo adb: `state.get` 14 ms (mediana), página do chat de 5000 em 1,4 ms e da sala de 3000 em 1,8 ms.
- Abrir pelo app, medido quadro a quadro na gravação: chat de 5000 mensagens com as últimas já no fim **~270 ms** depois de a tela surgir; sala de 3000 **~400 ms** (o supervisor responde em ~2 ms; o resto é renderizar 40 mensagens com Markdown em `ScrollView`, que é o trabalho da v57). Aparece um quadro com o topo da página antes de descer ao fim, também para a v57 (lista invertida).
- "Ver mensagens anteriores" no chat e na sala: a página chega acima e a mensagem que se lia fica no lugar (corrigido durante o teste: a âncora estava no botão).
- Defeito achado no emulador e corrigido antes da entrega: abrir uma sala derrubava o app (`ReferenceError: call`), porque a propriedade foi removida da tela da sala e o microfone ainda a usava. Uma análise de escopo do `App.js` com o Babel do projeto não achou outras referências soltas.
- Ao vivo, nó de PC **isolado** (pareamento da v55, portas 3231/3233/3235): bot "Teste v56" (Claude haiku no PC) respondeu pelo app; "Pensando" e a resposta chegaram sem recarregar; a janela do PC (porta 3233) recebeu os eventos 29→35 seguidos e leu página e perfil pelo link. Reiniciar o supervisor com o chat aberto (`seq` voltou a 0) e mandar outra mensagem: chegou normalmente. Bot novo, rotina disparando e a lista reordenando apareceram sem recarregar.
- Limites: o Codex da conta estava no limite de uso até 13:01 durante o teste (`codex exec` no PC confirmou), por isso a resposta real foi com o Claude; a mensagem ao Codex mostrou o erro ao vivo como esperado. O aviso "O Codex não concluiu a resposta" não diz que é limite de uso (comportamento anterior, fora desta versão). Não testado no POCO físico.
- Provas em `.build-tools/emulator-state/v56/`: `abrir-chat.mp4`, `abrir-sala.mp4`, `abertura-quadros.png`, `home.png`, `topo.png`, `anteriores.png`, `sala-aberta.png`, `sala-anteriores-par.png`, `ao-vivo-2.png`, `claude-par.png` e `reconectado.png`.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v56.apk` e `.sha256`, versionCode 56 / 0.34.0, 39.699.683 bytes. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `0821dd7b38707b77631f91f5d02369d9eea83ee3dd31a35c1236054ba434e401`.

Release pública [v56](https://github.com/AugustodoBRT/Mybots/releases/tag/v56), marcada como a mais recente, com o APK e o `.sha256` (o arquivo baixado da Release confere), tag no commit `4095f42`. PC atualizado com `scripts/build-desktop.sh`: interface regenerada, janela compilada e instalada, serviço `mybots-pc` reiniciado às 12:34:39, `active`, `/health` respondeu `{"ok":true,"phone":true}` e o celular reconectou às 12:34:41. A janela nova usa `chat.page`: as conversas dela só abrem depois que o celular estiver na v56. Nó isolado e emulador encerrados.

## 27/10/2026 — v57 (0.35.0): conversas rápidas, parte 2 (app)

Seção v57 do `PLANO-V54.md`. A separação veio primeiro, **sozinha no commit `46b3152`**: `screens/Chat.js`, `screens/Room.js`, `screens/Home.js`, `components/Message.js`, `state/store.js`, estilos e componentes compartilhados. Antes desse commit, os 193 testes passaram e início, chat, sala, perfil e Ajustes foram abertos no APK x86_64 do emulador, sem referência solta.

- A loja agora aplica os redutores da v56 e preserva as referências das fatias que não mudaram. Navegação, início, compartilhamento do Android, chat e sala assinam seus próprios dados com `useSyncExternalStore`. Um passo de A não notifica a assinatura do chat B nem a do início. Repetidos são ignorados, lacunas fazem resync e pedidos de resync/página concorrentes são agrupados; um resync aguarda a página antiga em andamento antes de buscar a atual.
- Chat e sala usam `FlatList` invertida, 15 itens iniciais, janela 7 e lotes de até 4 mensagens durante a rolagem, sem `scrollToEnd`. A página antiga chega ao rolar até o topo, com botão de reserva e âncora de leitura. O botão de descer continua aparecendo quando a pessoa está lendo acima.
- `Message` memoizado por id, status e tamanho, conferindo também o texto (correções de mesmo tamanho), metadados, arquivos e estado do botão de tentar novamente. Retornos de chamada estáveis evitam redesenhar as mensagens ao digitar. Markdown e trechos inline têm cache por id/texto, limitado a 240 mensagens; anexos continuam sendo buscados apenas ao tocar no arquivo.
- Cache persistente de até 40 mensagens por bot **e sala**, hidratado antes da conexão. A página atual substitui a prévia sem esvaziá-la. A exclusão limpa as mensagens na loja e no arquivo local; tombstones ficam sem mensagens. Corrigidos também `ask.sh` e `send-file.mjs`, que ainda chamavam o `chat.history` retirado na v56.
- Teclado com `react-native-keyboard-controller` 1.21.9, Reanimated 4.5.1 e Worklets 0.10.1 (Expo SDK 57). A animação usa transformação na thread de interface e ajusta o espaço da lista ao terminar; o cabeçalho permanece fixo. As novas dependências Gradle foram preparadas uma vez e os APKs seguintes compilaram offline.

### Testes e emulador

- **201/201 testes passaram**, zero falhas, cancelamentos ou skips. Os oito novos verificam ordem/repetição/lacuna, páginas e referências preservadas, isolamento de assinaturas, cache de bots/salas e exclusão, correções de mesmo tamanho/metadados/anexos, snapshot da árvore nativa de `Message` anterior à memoização, escopos das telas, compartilhamento por recência e compatibilidade do histórico do modo antigo no PC.
- Nó **isolado da v57**, identidade e projetos em `.build-tools/emulator-state/v57/isolated-node/`, portas 3231/3233/3235. O serviço real do PC não foi usado nos testes. Três bots com **Codex real gpt-6-luna**, no PC isolado, abriram e leram example.com e aguardaram por um texto deliberadamente inexistente. Os três tiveram tarefas `running` simultaneamente e responderam; os timeouts do `browser_wait` eram esperados.
- Chat com **5000** e sala com **3000** mensagens, gerados pelo `seed-long.mjs` na v56 e com as contagens conferidas novamente. Comparação por quadros no mesmo emulador Android 16, 1080×2400, modo gráfico por software, sem Gradle compilando:

| Desde o primeiro quadro com o cabeçalho da conversa até as mensagens recentes completas | v56 | v57 |
|---|---:|---:|
| Chat de 5000, sem prévia carregada | ~270 ms | **114 ms** |
| Sala de 3000, sem prévia carregada | ~400 ms | **150 ms** |
| Chat e sala com cache | — | **já completos no primeiro quadro da tela** |

Essa é a referência usada na medição da v56; não é o tempo entre encostar o dedo e o primeiro quadro. A gravação final não mostra o topo antes de ir ao fim. As primeiras medições da v57 foram 138/133 ms. `opening-metrics.json`, os vídeos e as folhas de quadros guardam as medidas finais.

- Rolagem passou da primeira página: mensagens anteriores a 4960 no chat e a 2960 na sala, sem perder o botão de voltar ao fim. Com três bots trabalhando, nenhum crash, ANR ou travamento da conversa. **O modo gráfico por software não atingiu zero quadros atrasados**: a primeira rodada registrou 27/628 (4,30%) no chat e 79/752 (10,51%) na sala. Reduzir o lote de montagem de 8 para 4 baixou os resultados a **13/817 (1,59%) no chat** e **31/789 (3,93%) na sala**, com percentil 95 de **38/34 ms** (antes 42/44 ms). Esses números ficam registrados, sem confundir ausência de travamento com 60 fps constantes.
- A tentativa complementar com GPU do PC (NVIDIA, emulador com `-gpu host`, inclusive sem Vulkan) falhou no driver gráfico antes de produzir uma medição confiável. Os resultados por software foram mantidos; não foi alegada validação no POCO físico.
- Cache do arquivo Android inspecionado: 40 mensagens do chat e 40 da sala. Bot descartável respondeu “Cache v57 confirmado.”; após excluí-lo, o arquivo tinha o tombstone com `messages: []`. Com o supervisor suspenso brevemente por sinal, um chat e a sala longa ainda abriram com as mensagens da prévia; ao retomá-lo, a conexão atualizou por cima. Teclado, ditado presente, estado vazio, início, chat, duas salas, perfil e Ajustes conferidos.
- Defeitos encontrados e corrigidos antes da entrega: Direct Share ainda ordenava pelos timestamps retirados da fatia de navegação (agora tem assinatura própria); `ListEmptyComponent` com Fragment não recebia a inversão do React Native (agora usa View e não mostra estado vazio enquanto há histórico a carregar); salas do cache também entram no estado inicial, antes da conexão. O mapa de fontes do APK foi comparado com os arquivos para conferir a revisão instalada.
- Provas e scripts de medição em `.build-tools/emulator-state/v57/`: `abrir-*-final.mp4`, `abrir-*-final-quadros.png`, `chat-carga-final.mp4`, `sala-carga.mp4`, `load-events.jsonl`, `load-samples.jsonl`, `load-results.json`, `gfxinfo-*-carga.txt`, `cache-deletion-check.json`, telas e logs de build/testes. As primeiras tentativas de navegação que não atingiram a sala não foram usadas como medidas dela.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v57.apk` e `.sha256`, **versionCode 57 / 0.35.0**, 43.941.050 bytes. Só contém ABI ARM64. Certificado conferido: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256: `210f48aa9815aa9df7f83e0fb81c783fbdd2742673b6941cad2bd76ae4f15d5f`. As permissões do manifesto são idênticas às da v56. Build final offline passou; os fontes do mapa do APK correspondem aos arquivos finais.

A interface web final também foi gerada e aberta pelo nó isolado: início, chat de 5000, sala de 3000, perfil e Ajustes, com as mensagens recentes presentes e nenhum erro de JavaScript (`pc-check.json` e capturas).


Release pública [v57](https://github.com/AugustodoBRT/Mybots/releases/tag/v57), marcada como a mais recente, com APK e `.sha256`; tag no commit `686cb7c` (sem coautoria de IA). O APK baixado da Release passou na conferência do `.sha256` e é idêntico ao local. **PC atualizado depois da Release**, nesta mesma entrega: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **27/10/2026 às 14:26:16 (Brasília)**. `mybots-pc` **active/running**, PID 308804; `/health` respondeu `{"ok":true,"phone":true}`. Binário instalado idêntico ao compilado (`0434aaaf2e40dbe6e8cf84fb90ecba00922688efc3407891dbaa7bd740f202f4`). Nó isolado e emulador encerrados após os testes; provas preservadas no diretório da v57. O diretório `output/` preexistente ficou fora dos commits.

## 27/10/2026 — v58 (0.36.0): navegador no estilo OpenBot, compartilhado entre os bots

Seção v58 do `PLANO-V54.md`, com a mudança pedida pela pessoa no lugar do item 4: **todos os bots usam por padrão o mesmo navegador** de cada aparelho.

- **Navegador compartilhado (PC)**: um Chrome do MyBots (`~/.mybots-pc/browsers/shared/chrome`), separado do Chrome pessoal, num único processo, com abas próprias de cada bot (até 5), como já era em Meu Chrome. Popups ficam com o bot que os abriu; parar um bot fecha só as abas dele. `own` virou `shared` na leitura; **Navegador separado** (`separate`) mantém um Chrome por bot no perfil antigo `browsers/<bot>`. Pouco acesso é sempre separado. Meu Chrome e Claude in Chrome não mudaram. Assumir trava só o bot assumido (só Meu Chrome continua travando todos).
- **Migração dos logins**: na primeira vez, os cookies persistentes de cada perfil antigo de bot que passou a `shared` são copiados para o Chrome compartilhado (marca `mybots-imported-to-shared`; o perfil antigo fica). Não vêm: cookies de sessão (somem ao fechar o navegador) e `localStorage`. **No celular, os bots precisam entrar de novo uma vez**: a WebView não deixa listar os cookies de cada perfil antigo.
- **Celular**: WebViews no perfil `shared` por padrão, `bot-<id>` no separado (o supervisor manda o perfil em cada comando; o painel também). Sem perfis de WebView, um bot separado apaga os logins do compartilhado ao navegar, com aviso.
- **Interface**: perfil → **Navegador** com Compartilhado (padrão), Separado, Meu Chrome e Claude in Chrome, dizendo que o navegador do PC e o do celular são diferentes. Painel com barra de abas (ícone, título, fechar, +), endereço sempre visível com voltar/avançar/recarregar, cursor e contorno do bot com a legenda do passo, lista de **Downloads** (Abrir e Enviar ao bot), **linha do tempo** com miniaturas na conversa e navegador **ao lado da conversa** em tela larga.
- **Supervisor**: migração 10 (`browser_steps` com miniatura, 120 por bot; `browser_downloads` do celular). RPCs `browser.steps`, `browser.stepImage`, `browser.downloads`, `browser.download.open` e `browser.download.send` (também na janela do PC). Eventos `browser.step` e `browser.download`. `PROMPT_VERSION=5` (instruções novas sobre o navegador compartilhado).

### Defeitos achados no emulador e corrigidos antes da entrega

- Faixa de abas esticava na vertical em tela cheia e espremia o visor (`flexGrow: 0`).
- **Tela ao vivo congelava** depois de Devolver e olhar de novo: o temporizador de ritmo da visualização anterior ficava marcado e bloqueava os quadros novos. Também passou a vir um quadro da página parada quando o screencast não manda nada. Teste de regressão novo (falha sem a correção).
- **Página ficava reduzida** depois de Assumir/Devolver e de uma miniatura: a captura com escala fazia o Chrome redimensionar a página. Capturas agora sem escala, e o teste confere que o tamanho da página não muda.
- Tamanho de arquivos pequenos aparecia como "1 KB"; conversa ficava estreita demais ao lado do navegador; a linha do tempo tenta de novo se a conexão ainda não estava pronta.

### Testes e emulador

- **209/209 testes** (eram 201): modos e migração (`own`→`shared`, Pouco acesso separado, perfil nos comandos do celular), legendas, entradas novas (avançar, nova aba, fechar aba), nomes de download, downloads do PC só na pasta do bot, linha do tempo (120 por bot, páginas, apagada com o bot), Chrome real compartilhado (login de A vale para B, separado não logado, popups e Assumir por bot, parar A não afeta B), cópia dos logins antigos, cursor/legenda antes do clique, download, miniatura, barra de abas com voltar/avançar e a regressão da tela congelada; ponta a ponta com o nó do PC: passos com miniatura, download do PC listado, aberto uma vez e enviado ao bot.
- Emulador Android 16 com **nó de PC isolado** (`.build-tools/emulator-state/v58/node.mjs`, cópia do nó da v57 com os perfis antigos dos bots "Carga v57 A/B/C") e **Codex real gpt-6-luna**. O serviço real do PC não foi usado.
  - **Migração**: antes do nó da v58, um cookie persistente de teste foi gravado no perfil antigo de "Carga v57 C" (`pre-login.mjs`, postman-echo.com). Depois, o mesmo bot migrado abriu `postman-echo.com/cookies` e leu `login_antigo=CargaC-v57`. Os três perfis antigos foram marcados como importados.
  - **Login compartilhado no PC**: o bot A abriu `the-internet.herokuapp.com/login` (site de teste, conta pública de teste); entrei pelo **Assumir** no app (usuário, senha em bolinhas, Login → área segura). O **bot novo B** abriu `/secure` e leu "Welcome to the Secure Area."; o bot **Navegador separado** foi mandado para `/login` com "You must login to view the secure area!".
  - **Login compartilhado no celular** (modo Só no celular, WebView): mesmo roteiro pelo Assumir no bot "Navegador"; o bot novo do celular entrou logado e o separado do celular não.
  - **Dois bots ao mesmo tempo**: A (example.com/#bot-a com espera) e B (checkboxes) rodaram juntos e cada um leu a própria aba.
  - Cursor, contorno e legenda num `browser_type` e num `browser_click` reais; linha do tempo abriu o passo 3 de 5 com o texto digitado; abas: + abriu, endereço digitado abriu example.org, × fechou; download de 188 bytes listado, **Enviar ao bot** (o bot leu o arquivo) e **Abrir** (folha de arquivo); tela larga no emulador em modo tablet (1600×2560) e na janela do PC (Chrome de teste 1920×1080, sem erro de JavaScript).
  - **Sem piscar (v54)**: reCAPTCHA demo gravado — **0 quadros vazios em 472** (só olhando) e **0 em 665** (assumido), mesmo recorte da v54. Assumir no celular, teclado direto no campo, senha secreta e zoom no desafio (v55) seguiram funcionando.
- Provas em `.build-tools/emulator-state/v58/`: `assumir-login-pc.mp4`, `assumir-login-celular.mp4`, `cursor-realce-legenda.mp4`, `recaptcha-olhando.mp4`, `recaptcha-assumido.mp4`, `analise-sem-piscar.txt`, `resposta-b-pc.txt`, `resposta-separado-pc.txt`, `resposta-b-celular.txt`, `resposta-separado-celular.txt`, `simultaneo-*.txt`, `download-resposta.txt`, `pc-janela-*.png`, `tablet-*.png` e as capturas de cada passo.
- Limites: Google continua recusando login em Chrome automatizado (para a conta Google, Meu Chrome). Perfil nomeado não foi feito. Não testado no POCO físico.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v58.apk` e `.sha256`, **versionCode 58 / 0.36.0**, 43.966.766 bytes, só ABI ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `ad408ba59b6a79a859e3b17feb2fca5ad0861ebc103b3794f06efa80019b0941`.

Release pública [v58](https://github.com/AugustodoBRT/Mybots/releases/tag/v58), marcada como a mais recente, com APK e `.sha256`; o APK baixado da Release passou na conferência. Commits sem coautoria de IA (`071ab2c`, `3d28828`, `02d0bb5`). **PC atualizado depois da Release**: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **27/10/2026 às 16:36:25 (Brasília)**; `mybots-pc` **active**, PID 475561, `/health` respondeu `{"ok":true,"phone":true}`. Na primeira vez que um bot usar o navegador no PC real, os logins dos perfis antigos dos bots são copiados para o navegador compartilhado. Nó isolado e emulador encerrados; provas preservadas em `.build-tools/emulator-state/v58/`. O diretório `output/` preexistente ficou fora dos commits.

## 27/10/2026 — v59 (0.37.0): bot livre, parte 1 (autonomia e controle do celular)

Seção v59 do `PLANO-V54.md`.

- **Nível Livre** (`access: 'free'`, acima de Acesso total), escolhido por bot só no app do celular, com aviso claro na primeira vez. Nada pede aprovação, exceto a lista **"Sempre perguntar"** (uma para todos os bots Livres, editada no perfil; começa com comandos perigosos, habilidades, anexar arquivos em sites e SMS) e os limites duros. Cartões do Livre não têm "Sempre permitir". Tudo segue na Atividade. `team_create_bot` recusa Livre e um bot Livre cria no máximo Acesso total; a janela do PC não escolhe Livre nem edita a lista.
- **Controle do Android** (`MyBotsAccess.kt`, `AccessibilityService`): `phone_screen` (elementos numerados, captura com números opcional, senhas `••••` e tapadas), `phone_tap`, `phone_type`, `phone_scroll`, `phone_open_app` (nome em português ou inglês, ou pacote), `phone_back`, `phone_fill_code` e `phone_ask_user`. Os comandos vão pela fila do navegador do app numa faixa própria; Parar, Assumir e fim do turno numa faixa imediata. O app só obedece bots que a **própria cópia** dele marca como Livre (`FreeGuard`), recusa agir no MyBots, instaladores, permissões e telas de Configurações sobre o MyBots, e apps que se escondem da acessibilidade (bancos) voltam como `refused` para o bot chamar a pessoa. Novo `supervisor/phone.mjs` (um bot por vez, Assumir/Devolver, Parar, pedido de ajuda que continua o trabalho ao devolver) e rota `/device/phone`.
- **Ver e assumir**: barra sobre os outros apps com o passo, Assumir e **Parar**; notificação fixa com Parar e Assumir; cartão "Celular ao vivo" na conversa (captura depois de cada passo, Parar, Assumir/Devolver); passos na linha do tempo ("No celular: …"). Parar marca o turno como parado no app (os passos nativos conferem a cada 50 ms) e o supervisor cancela o turno.
- **Códigos de verificação**: o listener esconde o código antes de mandar a notificação ao supervisor e guarda o código na memória do app (15 min); `phone_fill_code` só usa o código do remetente indicado e pede a pessoa quando a mensagem não cita o app/site do campo. Todo código visto vira segredo por 30 min: mascarado em qualquer tela lida, tapado nas capturas e removido de toda resposta do app. O supervisor também mascara códigos nas notificações e no `sms_search` (o teste antigo de SMS foi ajustado para isso).
- **Termux completo só no Livre** (bot no celular): Codex com `danger-full-access` e terminal ligado; Claude com Bash e arquivos, cada comando decidido pelo MyBots (arquivos do supervisor e chaves recusados, perigosos e "Comandos no Termux" pela lista). No Codex, "Comandos no Termux" na lista deixa o bot sem terminal. Fora do Livre, nada mudou.
- **App**: Ajustes → Notificações do celular → **Controle do celular** com o guia do Android 13+ ("Configuração restrita" → ⋮ → Permitir configurações restritas); perfil com Livre, a lista e o estado do controle; o app desfaz um Livre posto fora dele e restaura a lista se ela divergir da cópia do app. `PROMPT_VERSION` não mudou: as instruções novas só valem para bots Livres, que já ganham sessão nova ao mudar de nível.
- `docs/seguranca.md` explica o que o Livre permite e o que continua bloqueado; README, `docs/computador.md` e o plano atualizados. `phone.mjs` entrou em `scripts/package-supervisor.mjs`.

### Testes e emulador

- **217/217 testes** (eram 209), zero falhas ou skips. Novos em `tests/free.test.mjs`: política do Livre (nada pede exceto a lista; `phone`/`termux` só no Livre; interruptor desliga), modelo sem como subir de nível (equipe e janela do PC), argumentos das `phone_*`, comandos chegando ao app com turno e bot + linha do tempo + item da lista virando cartão, **Parar no meio de um passo** (fila real, o app recebe `phoneStop` e o turno vira cancelado), Parar/Assumir/Devolver pelo app com pedido de ajuda continuando o trabalho, códigos mascarados (remetente do SMS legível) e cartão quando a mensagem não cita o app, e Termux (Claude pergunta comandos perigosos, supervisor fora de alcance, Codex com e sem terminal).
- Emulador Android 16 (API 36) com APK x86_64 da v59 e **nó de PC isolado** (`.build-tools/emulator-state/v59/node.mjs`, cópia do nó da v58, portas 3231/3233/3235; o serviço real `mybots-pc` não foi usado). Bot "Celular v59" com **Codex real gpt-6-luna** no nó isolado. Nenhuma conta da pessoa foi usada (só apps do emulador e SMS de teste).
  - **Ligar a acessibilidade**: com o bloqueio do Android 13+ reproduzido (`appops ACCESS_RESTRICTED_SETTINGS deny`, porque APK instalado por adb não fica restrito), o serviço apareceu como "Controlled by Restricted Setting" e o Android recusou; seguindo o guia do app (Abrir informações do app → ⋮ → Allow restricted settings), o serviço foi ligado pela tela do Android e o app passou a mostrar "Controle do celular · Ligado".
  - **Livre**: escolhido no perfil, com o aviso da primeira vez; lista "Sempre perguntar" com os quatro itens padrão.
  - **Abrir Configurações e ler um item**: o bot abriu o app (a primeira tentativa com "Configurações" falhou no emulador em inglês; foi adicionado o nome equivalente) e respondeu "Google", o primeiro item. Barra com a legenda e Parar sobre o app.
  - **Abrir outro app e digitar**: abriu Contatos, criou contato e digitou "Teste v59" em First name (sem salvar).
  - **Parar**: entre passos (rolando Configurações), o pedido foi cancelado ~30 ms depois do toque na barra; **no meio de um passo** (abrindo o Gmail ainda frio), o passo nativo foi interrompido ("Parado: a pessoa interrompeu…") antes do supervisor registrar, e o turno foi cancelado ~170 ms depois. A barra e a notificação somem. Na mensagem seguinte o bot recusou retomar sem a pessoa pedir.
  - **Item da lista**: "Abrir apps no celular" ligado pela tela; o bot pediu para abrir o Relógio e veio o cartão "Abrir um app no celular · Abrir Clock", sem "Sempre permitir"; Permitir → respondeu a hora.
  - **Código de verificação** (SMS de teste via `adb emu sms send`): o supervisor gravou "Contacts: seu codigo de verificacao e [código protegido]"; `phone_fill_code` preencheu o campo do Contatos com o código. **Defeitos achados e corrigidos**: (1) o número do remetente ("555-0123") também era mascarado e "0123" virava candidato a código; agora só o texto da mensagem é lido e o remetente fica legível; (2) na primeira rodada, um `phone_screen` depois do preenchimento leu o campo e o código **chegou ao modelo** (sessão do Codex no PC), embora não estivesse na conversa, na Atividade, no banco nem nos logs. Com a correção (código como segredo por 30 min), a nova rodada com outro código: **0 ocorrências** no logcat, no log e nos arquivos do nó isolado, nas sessões do Codex, nos arquivos e no banco do supervisor; o bot leu "[código protegido]" no campo e na conversa do app Mensagens, e as capturas enviadas ao modelo têm as mensagens tapadas de preto.
  - **Livre posto por fora**: `bot.update` com `access: free` direto no supervisor (como um shell faria) → o app devolveu o bot para Acesso total e mostrou "Nível Livre desfeito".
- Provas em `.build-tools/emulator-state/v59/`: capturas numeradas `01` a `26`, `abrir-configuracoes-ler-item.mp4`, `abrir-contatos-digitar.mp4`, `parar-entre-passos.mp4`, `parar-no-meio-do-passo.mp4`, `codigo-de-verificacao.mp4`, `frames/` (folhas de quadros, antes/depois do Parar e as imagens enviadas ao modelo), respostas do bot (`resposta-*.txt`), `node.log` e `testes.log`.
- Limites: não testado no POCO físico nem com app de banco real. O Termux completo não foi exercitado no emulador (só nos testes), nem `phone_fill_code` no navegador do bot no celular (o bot de teste respondia pelo PC). A detecção do bloqueio "configurações restritas" (`AppOps`) não acusou o bloqueio no emulador; o guia aparece de qualquer forma no Android 13+ enquanto o serviço estiver desligado. A barra aparece nas capturas que o bot recebe, no topo da tela.

### Entrega

APK ARM64 offline: `dist/apk/mybots-v59.apk` e `.sha256`, **versionCode 59 / 0.37.0**, 44.015.582 bytes, só ABI ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `7305b7a81738b41c596d9a6d70d804c301ddc6e0ea7d03940d394dc41f83c183`. O manifesto ganhou o serviço `MyBotsAccess` (permissão `BIND_ACCESSIBILITY_SERVICE`) e o receptor da notificação; nenhuma permissão nova pedida ao Android.

Release pública [v59](https://github.com/AugustodoBRT/Mybots/releases/tag/v59), marcada como a mais recente, com APK e `.sha256`; o APK baixado da Release passou na conferência e é idêntico ao local. Tag no commit `be6d05b`; commits sem coautoria de IA (`4ddc422`, `be6d05b`). **PC atualizado depois da Release**: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **27/10/2026 às 23:56:35 (Brasília)**; `mybots-pc` **active**, PID 790174, `/health` respondeu `{"ok":true,"phone":true}` e o celular reconectou às 23:56:41. Nó isolado e emulador encerrados; provas preservadas em `.build-tools/emulator-state/v59/`. O diretório `output/` preexistente ficou fora dos commits.

## 28/10/2026 — v60 (0.38.0): carteira do bot

Seção v60 do `PLANO-V54.md`. Começada pelo GPT (cadastro e regras nativos, detector de campos de cartão, número de cartão só com Luhn e bandeira, máscaras em leituras e capturas, busca de atualização ao voltar ao app depois de 1 hora) e terminada aqui.

**Pagamento (`browser_pay`)**: o bot declara loja, itens, categoria e total. Abaixo do Livre sempre pede aprovação (sem "Sempre permitir"); no Livre segue a lista "Sempre perguntar" ("Pagar com a carteira" ligado por padrão). As regras são conferidas **no app** (`WalletPolicy.kt`), com o total e o endereço lidos da própria página, e a compra é reservada no extrato (`WalletPay.kt`) antes de o cartão sair do cofre. No celular, o app preenche o checkout e os quadros de processadoras conhecidas pelo canal de cada quadro (`card-fill.js`, `card-observer.js`). No PC, o cartão vai cifrado para a chave de uso único do processo do navegador (`pay`/`pay_fill`/`pay_clear` em `pc/browser-worker.mjs`). O número e o código entram na redação antes de digitados. Notificação "Bot comprou X por R$ Y" com **Congelar carteira**; extrato com comprovante (campos tapados) e "Desconsiderar" em Ajustes → Carteira; "Congelar carteira" também na página ao vivo do navegador do bot. Congelar avisa o supervisor (`/device/phone`, evento `walletFrozen`), que apaga o cartão do checkout no PC e cancela as vezes que estavam pagando. Ao fim de cada vez no PC, o cartão deixado num formulário é apagado. A política em JS que não era usada (`wallet-policy.mjs`) saiu; o leitor de total tem uma só fonte (`wallet-checkout.mjs`, embutida no Android como asset, com teste de igualdade).

**Testes**: 237 automáticos (novos: `tests/wallet.test.mjs` e a regra nativa compilada com kotlinc em `tests/wallet-policy.test.mjs`; o catálogo passa a ter 49 ferramentas).

**Aceite no emulador** (Android 16, APK x86_64, nó de PC isolado com HOME próprio, loja de teste https local em `loja.192-168-21-61.nip.io` com certificado aceito só por esse HOME, cartão fictício final 3831, nenhuma conta da pessoa). O Codex estava sem cota até 6h24, então os bots usaram **Claude Haiku**.
- Cadastro do cartão (tela protegida: a captura sai preta; número e CVV mascarados até para a acessibilidade) e regras (R$ 100 por compra, R$ 150 por dia, R$ 500 por mês, uma loja, categoria livros); descongelar.
- Compra dentro do limite: cartão de aprovação, preenchimento, pedido nº 2026-1028-01 finalizado na loja, notificação, extrato e comprovante com os campos tapados.
- Recusas pelo app: R$ 899,00 acima do limite por compra (mesmo com a minha aprovação), limite do dia e loja não permitida. O bot explicou e não tentou contornar.
- "Desconsiderar" libera o limite.
- Congelar no meio: com o cartão preenchido e o bot aguardando aprovação para finalizar, "Congelar carteira" cancelou a vez na hora e nada chegou à loja.
- Fim da vez com o cartão no formulário: a loja recebeu o pedido seguinte com o cartão vazio.

**Defeitos achados e corrigidos no aceite**: o cartão ficava no formulário do Chrome do PC depois da vez (agora é apagado); congelar registrava "pagamento interrompido" também para vezes já encerradas (agora só para as em andamento).

**Busca de vazamento** (`.build-tools/emulator-state/v60/vazamento.txt`): número e CVV com **0 ocorrências** no logcat, no supervisor do celular, nas sessões das IAs dos bots e na loja. As ocorrências de "8296" no supervisor são tabelas Unicode e um identificador antigo. **Resíduo**: os arquivos de sessão do Chrome do bot no PC guardam o estado do formulário com o número; a pasta fica escondida das IAs pelo isolamento (documentado em `seguranca.md`).

**Não testado no emulador**: o pagamento no navegador do próprio celular (o bot responde pelo PC; o preenchimento nativo foi compilado e está coberto por testes de código); o total divergente declarado pelo bot (o modelo se recusou a declarar um total que a página não mostrava; a conferência está nos testes automáticos); o botão "Congelar carteira" da notificação (o toque automático acertou o corpo da notificação; a mesma função nativa foi testada pelo botão do app); quadros de processadoras reais (testados no Chrome com rotas simuladas). Para o aceite, o Claude foi apontado para `~/.claude` por `CLAUDE_CONFIG_DIR`, o que criou `~/.claude/.claude.json` (só lido quando essa variável existe).

**Entrega**: APK ARM64 offline `dist/apk/mybots-v60.apk` e `.sha256`, **versionCode 60 / 0.38.0**, 44.067.424 bytes, só ABI ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `fed9ff1e45fe049dea97f53f8b69b450103251c60526e80064c7017bf90c4680`. Nenhuma permissão nova pedida ao Android.

Release pública [v60](https://github.com/AugustodoBRT/Mybots/releases/tag/v60), marcada como a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Tag no commit `7131ce5`; commits sem coautoria de IA (`5e39ba0`, `7131ce5`). **PC atualizado depois da Release**: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **28/10/2026 às 03:48:03 (Brasília)**; `mybots-pc` **active** (PID 60732) e o celular reconectou às 03:48:06. Emulador, loja de teste e nó isolado encerrados; provas em `.build-tools/emulator-state/v60/`.

## 28/10/2026 — Skills dos bots, placa de vídeo e 30 rodadas (entre a v60 e a v61)

Pedido do usuário antes de seguir as versões: bots que usam **skills** (pasta com `SKILL.md` e scripts) do mesmo jeito no Claude Code e no Codex, a skill `explainer-video` como primeiro uso (vídeos para TikTok e YouTube), GPU para o render e salas com até 30 rodadas. Detalhes de segurança em `docs/seguranca.md` ("Skills dos bots e placa de vídeo").

- **Descoberta** (`lib/agent-skills.cjs`): `~/.agents/skills`, `~/.claude/skills` e `~/.codex/skills`, seguindo links e contando cada pasta real uma vez; `name`/`description` do frontmatter (inclusive valor em várias linhas). O PC responde `agent_skills` pelo link; o supervisor expõe `agent.skills` e só aceita em `bot.skills` caminhos que o PC acabou de listar.
- **Perfil do bot** (celular e janela do PC): seção **Skills** recolhida, com lista (nome, pasta de origem, descrição), chave por skill, "pode melhorar a skill" e **Usar a placa de vídeo**. Padrão: nada ligado.
- **Entrega ao modelo**: índice (nome, descrição, caminho do `SKILL.md`) junto das instruções de ferramentas, a cada turno (`--append-system-prompt` no Claude, `developer_instructions` no Codex). Foi para os runners, e não para `rooms.mjs`, porque assim vale também em conversa privada e em sessão retomada. `--setting-sources ''` e `skip_host_skill_discovery` continuam.
- **Sandbox** (`sandboxFor`): pasta da skill no mesmo caminho absoluto, `--ro-bind` ou `--bind`, depois das pastas escondidas; `/dev/dri` e `/dev/nvidia*` com `--dev-bind` só com a opção ligada. Médio: ler, rodar scripts e gravar (com "pode melhorar") na skill não abrem cartão (`commandInside`).
- **Tempo**: silêncio de até 45 min (era 10) e Bash do Claude até 1 h para bots com skill. `MAX_ROUNDS` 6 → 30; `README.md` corrigido; `lib/agent-skills.cjs` entrou no pacote do supervisor.
- **Testes**: 8 novos em `tests/agent-skills.test.mjs`; suíte inteira **245 de 245**.
- **Aceite real** (supervisor e nó do PC reais, bots no Médio, `explainer-video` com "pode melhorar" e GPU, pedido do vídeo vertical de 30 s da Lua): o **bot Claude** leu o `SKILL.md`, rodou o `setup.sh`, narrou com Kokoro local e entregou `lua_sumiu.mp4` (1080×1920, 29,6 s, h264 com áudio) e os contact sheets, com `gpu: ANGLE (NVIDIA GeForce RTX 3060 Laptop GPU…)` na primeira linha do log do render. O **bot Codex** também leu a skill e chegou ao mp4, mas o sandbox interno do Codex monta o próprio `/dev` e esconde `/dev/dri` e `/dev/nvidia*` (conferido no processo do Edge): **a GPU não chega ao Codex**. Decisão do usuário: com a GPU ligada, o Codex roda em `danger-full-access` (sem disco somente leitura; o bubblewrap do MyBots é o isolamento).

**Entrega (0.38.1 / versionCode 61)**: APK ARM64 offline `dist/apk/mybots-v61.apk` e `.sha256`, 44.077.608 bytes, certificado `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` conferido com `apksigner verify --print-certs`. SHA-256 do APK: `53d009747314c4f216c556d1cdb838c7c7b1eee53129cf5bdefe5d4bbe6235f5`. É uma versão intermediária entre a v60 e a v61 do plano (a próxima versão do plano continua sendo a v61, agora com versionCode 62). O aceite do Codex com a GPU, depois da decisão do usuário, também chegou ao mp4 (1080×1920, 30 s) com `gpu: ANGLE (NVIDIA GeForce RTX 3060 Laptop GPU…)`.

Release pública [v61](https://github.com/AugustodoBRT/Mybots/releases/tag/v61) (0.38.1), marcada como a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Tag no commit `25ceea7`; commits sem coautoria de IA (`f86c1f0`, `25ceea7`). **PC atualizado**: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **28/10/2026 às 16:11:47 (Brasília)**; `mybots-pc` **active** (PID 316888).

## 28/10/2026 — v61 (0.39.0): negociar e agir em seu nome

Seção v61 do `PLANO-V54.md`. Por pedido do usuário durante o plano, **não há painel de negociações**; no lugar, a carteira ganhou uma aba própria com os cartões desenhados e a escolha de bots por cartão. A migração do banco é a **11** (o plano dizia 9, mas a 9 e a 10 já tinham saído).

**Negociação (supervisor)** — `supervisor/negotiation.mjs`, tabelas `negotiations` e `negotiation_offers`. O mandato (objetivo, comprar/vender, preço-alvo, teto ou mínimo, canais WhatsApp/OLX/Marketplace/e-mail, prazo, "pode fechar", tom, se se apresenta como assistente) só se cria e edita pelo app (`negotiation.save/cancel/respond`; o PC pareado não alcança). Três ferramentas novas (catálogo de 49 para 52): `negotiation_status`, `negotiation_offer` (declara canal, destinatário, valor e o texto exato antes de enviar) e `negotiation_close`. O supervisor recusa oferta acima do teto/abaixo do mínimo, canal fora do mandato, mandato de outro bot, mandato encerrado ou vencido, oferta com proposta pendente e texto com preço diferente do declarado. O prazo vencido encerra o mandato e recusa a proposta pendente (relógio do supervisor). Fechar dentro do mandato e com permissão fecha; fora do mandato ou sem permissão vira o cartão **Aceitar/Recusar** (entra na lista de decisões, sem "Sempre permitir"); a resposta chega ao bot como nova mensagem. Aceitar não paga: o pagamento segue pela carteira.

**App** — aba **Negociar** no perfil do bot (formulário do mandato, histórico, última oferta e status; tom e "apresentar-se como assistente"); cartão Aceitar/Recusar na tela inicial; o `negotiation_status` devolve ao bot como escrever (nome da pessoa, tom, apresentação; nunca negar ser assistente).

**Carteira com vários cartões** — item **Carteira** na barra de baixo (atalho também em Ajustes). Cada cartão é desenhado (marca por faixa de número, final, nome, validade, apelido; "CONGELADA" quando congelada) e tem **Escolher bots**: só os marcados pagam com ele (`WalletGuard.cardBots`, preferências privadas do app; escolher conta como mudar as regras e invalida reservas anteriores). Até 10 cartões, com apelido opcional. `browser_pay` ganhou o argumento `card` (4 últimos dígitos) para escolher entre os liberados; sem nenhum liberado, recusa. `WalletPolicy.pickCard` concentra a escolha. O cartão único da v60 migrou para a lista **sem nenhum bot liberado** (falha fechada). O extrato mostra o final do cartão usado.

### Testes

- **252/252** (eram 245), zero falhas e zero skips. Novos em `tests/negotiation.test.mjs` (7): limites puros (teto, mínimo, canal, prazo); oferta acima do teto bloqueada e texto com outro preço bloqueado; mandato vencido encerra a negociação (relógio encurtado, sem espera) e recusa a proposta pendente; fechar sem permissão gera o cartão Aceitar/Recusar e Aceitar/Recusar têm o efeito certo e avisam o bot; preço fora do mandato vai à pessoa mesmo com permissão, dentro fecha sozinho; mandato de outro bot e bot sem mandato; tom/apresentação no `negotiation_status`. Ajustados: contagem de ferramentas (52), `user_version` 11, `browser_pay` com `card`. Em `wallet-policy.test.mjs` (Kotlin compilado): escolha de cartão por bot. `tests/native-wallet-guard/run.sh`: bots por cartão e cartão apagado.
- Emulador Android 16 (x86_64), supervisor do celular, **Codex real gpt-6-luna**, bot "Negociador v61" (Acesso total) com mandato de compra (alvo R$ 800, teto R$ 900, WhatsApp/OLX): o bot leu o mandato, teve a oferta de R$ 1.100 **recusada pelo supervisor** ("no máximo R$ 900,00") e declarou R$ 820 com texto que se apresentava como assistente; ao fechar R$ 880 sem permissão apareceu o cartão **Aceitar/Recusar** na tela inicial (capturas em `.build-tools/emulator-state/v61/`); Aceitar fechou o mandato e o bot recebeu a decisão; mandato de venda com prazo de 15 s vencido: oferta recusada pelo prazo. Aba Carteira: o cartão da v60 (final 3831) migrou, apareceu desenhado como cartão, e marcar "Compras v60" em Escolher bots passou a mostrar "Usado por: Compras v60".
- Limites: **não testados no emulador** o cadastro de um segundo cartão pelo diálogo nativo, o pagamento com vários cartões (coberto só pelos testes de `pickCard`/`WalletGuard` e pela compilação), a aba **Negociar** do perfil e o envio real por WhatsApp/OLX/Marketplace (o MyBots confere o que o bot declara; o envio usa as ferramentas de sempre). O botão de adicionar cartão foi encolhido depois do APK do emulador. O supervisor roda no Termux; um bot Livre com shell poderia, em tese, editar o banco (limite documentado em `seguranca.md`).

### Entrega

APK ARM64 offline: `dist/apk/mybots-v62.apk` e `.sha256`, **versionCode 62 / 0.39.0**, 44.123.392 bytes, só ABI ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `6fd5838b9d522d6f1da1eb7999e36ba396c409ec97342902194514c5877906c3`. Nenhuma permissão nova pedida ao Android.

Release pública [v62](https://github.com/AugustodoBRT/Mybots/releases/tag/v62) (0.39.0), marcada como a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Tag no commit `859b4a7`; commit sem coautoria de IA. **PC atualizado depois da Release**: `scripts/build-desktop.sh` regenerou a interface, compilou e instalou a janela e reiniciou o serviço real em **28/10/2026 às 16:53 (Brasília)**; `mybots-pc` **active** (PID 393274). Emulador encerrado; provas em `.build-tools/emulator-state/v61/`. O diretório `output/` preexistente ficou fora dos commits.

## 28/10/2026 — 0.39.1 (versionCode 63): Livre sem perguntar no celular e carteira mais livre

Pedido do usuário depois da v61: um bot Livre pedia permissão a cada app aberto, toque e volta, e a carteira exigia lojas e categorias.

- **Livre**: "Tocar e digitar em outros apps" e "Abrir apps no celular" saíram da lista "Sempre perguntar" (`FREE_ASK_RETIRED`); uma lista salva que ainda os traga é filtrada no supervisor e no app (a cópia do app não restaura mais esses itens). Pela leitura do código esses dois itens já vinham desligados por padrão, então o cartão que o usuário via vinha da lista dele; se ainda aparecer algum cartão no celular, o próximo passo é ver qual título ele mostra. Seguem pedindo só o que a pessoa ligar na lista (por exemplo, preencher códigos) e a carteira.
- **Carteira**: lojas permitidas e categorias podem ficar vazias (qualquer loja https); continuam obrigatórios os três limites e valem as lojas proibidas, o total da página, o cartão liberado por bot e o congelamento. "Pagar com a carteira" segue ligado por padrão na lista do Livre (dinheiro); desligue-o na lista para o bot comprar sem cartão de aprovação.
- **Testes**: 252/252. `free.test.mjs` (lista antiga com os itens aposentados nunca pergunta; abrir app e tocar sem cartão) e `wallet-policy.test.mjs` (Kotlin compilado: listas vazias liberam, proibidas e limites continuam). Não houve rodada nova no emulador: o editor de regras (diálogo nativo) e o Livre no celular real não foram exercitados.
- **Entrega**: APK ARM64 offline `dist/apk/mybots-v63.apk`, **versionCode 63 / 0.39.1**, 44.123.628 bytes, certificado `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` conferido com `apksigner`. SHA-256: `f1a984f72be9091963815f9c17f396587959e28925fde6a160b7e5321614967a`.
Release pública [v63](https://github.com/AugustodoBRT/Mybots/releases/tag/v63) (0.39.1), a mais recente; o APK baixado é idêntico ao local. Commits sem coautoria de IA. **PC atualizado depois da Release**: `scripts/build-desktop.sh` em **28/10/2026 às 17:25 (Brasília)**; `mybots-pc` **active** (PID 432568).

## 28/10/2026 — v62 (0.40.0, versionCode 64): acabamentos que fazem diferença

Seção v62 do `PLANO-V54.md`, na ordem combinada com o usuário: ações na mensagem, busca, fila, streaming, notificação e modelo reserva. Migração do banco **12** (índices FTS5; `CREATE ... IF NOT EXISTS`, carga inicial que limpa o índice antes, então rodar de novo não duplica).

- **Ações na mensagem** (segurar): Copiar, Responder citando (prefixo `> …`), Fixar/Desafixar (`message.pin`, campo `pinned` na mensagem, marca "Fixada") e Reenviar (só suas mensagens, conversa privada e sala). Componentes novos `MessageActions.js` e `Search.js`; o `Message.js` ficou igual (o snapshot de renderização não mudou), o gesto está num envoltório `Actionable`.
- **Busca**: `chat.search` sobre `messages_fts` e `room_messages_fts` (FTS5, `unicode61 remove_diacritics 2`, última palavra como prefixo, consulta tratada como palavras). Lupa na Início; filtro "só fixadas". Resultado abre o bot ou a sala.
- **Fila**: `queue.pause` (pausa por bot, no banco; a tarefa em andamento termina e nada novo começa), item da fila mostra o texto e o X cancela (`task.cancel`), `task.steer` ("Corrigir rumo": para a tarefa em andamento, a instrução entra na frente e retoma a mesma sessão; a pausa não a segura; só conversa privada). Cartão **Fila** no chat.
- **Streaming**: `lib/stream-batch.cjs` (lotes de 32 ms, o primeiro vai na hora), Claude com `--include-partial-messages` só quando há quem ouça, Codex por itens (a resposta aparece ao terminar o item). Evento `message.draft` (não sequenciado, texto completo, idempotente) até o app e a janela do PC; o rascunho some quando a mensagem final entra. Funciona também pelo link do PC.
- **Notificação**: bot que avisa ganha **Responder** (RemoteInput → `POST /device/notification-action`, vira `chat.send`); pedido de aprovação ganha **Aprovar/Recusar** (uma vez, nunca "sempre", com `actionHash`; aparelho destravado no Android 12+; aviso some quando a aprovação é respondida em outro lugar). Pagamento, senha, código, terminal, habilidade, upload, desktop, Chrome principal, negociação, resumo longo (>600) ou com argumentos ocultos só abrem o app (`noticeable`, conferido de novo no supervisor). Detalhes em `docs/seguranca.md`.
- **Modelo reserva**: "Se o limite acabar" no perfil (`bot.fallback`, só de outra IA). Erro de limite/cota na conversa privada refaz o turno com a outra IA, com o histórico, mesmo bot (nível, concessões, "Sempre perguntar"), mensagem marcada "Reserva", sessão da reserva nunca gravada e a do bot apagada, uso e limites no provedor que respondeu.

### Testes

- Suíte inteira: **270 de 270** (eram 252; 18 novos), zero falhas e zero skips. Novos: `search.test.mjs` (3: busca em chats e salas sem acento, índice acompanha edição e apagar, migração rodando duas vezes, fixar), `queue-control.test.mjs` (4: pausa, cancelar item, corrigir rumo na frente e na mesma sessão, correção não presa pela pausa), `streaming.test.mjs` (4: lotes, Claude com mensagens parciais só com ouvinte, supervisor, store), `fallback.test.mjs` (4: sem reserva, com reserva e histórico, sem ampliar acesso, reserva inválida) e 3 em `access.test.mjs` (Aprovar/Recusar por HTTP, bloqueios, Responder). Ajustados `user_version` 12 (2 testes) e a lista do teste de referências soltas.
- **Emulador** (Android 16 x86_64, Codex real gpt-6-luna, `.build-tools/emulator-state/v62/`): resposta aparece como rascunho e some ao concluir; busca achou "semáforo" digitando "semaforo" (`busca.png`); segurar a mensagem abriu Copiar / Responder citando / Fixar e Fixar mostrou "Fixada" (`segurar-assistente.png`, `fixada.png`); cartão **Fila** com Corrigir rumo, Pausar e o X (`fila.png`); Corrigir rumo com Codex real em tarefa em andamento (`corrigir-rumo.txt`): a tarefa longa foi interrompida e a instrução respondida na frente; pausa segurou o item enquanto o resto da fila esperava, e retomar liberou; **Responder** da notificação chegou ao bot como mensagem (`notificacao.png`, `responder-digitando.png`); **Aprovar** de um bot Médio pela notificação: "Ação autorizada uma vez" e o bot respondeu "Vi 9 notificações recentes" (`aprovar4.png`).
- **Não testado**: modelo reserva no emulador (o Claude não está instalado nele; o fluxo está nos testes automáticos com runners simulados); o botão **Recusar** e o cancelamento do aviso pela tela (cobertos pelos testes HTTP); tocar em "Corrigir rumo" e enviar pela interface (o `input text` do adb não digitou no campo; o fluxo foi provado pela RPC com Codex real e o cartão foi visto na tela); Reenviar e Responder citando na tela; a busca e o rascunho na janela do PC; o rascunho com Claude real (testado só com um Claude simulado que emite `stream_event`); salas (rascunho por bot está no código e no teste da store).
- Limites conhecidos: com o Codex o "ao vivo" é por itens, então respostas curtas aparecem quase junto com o fim; Corrigir rumo interrompe e retoma (não dá para injetar texto num turno em andamento), e o que a IA já tinha escrito e não gravou na sessão se perde (a resposta do teste foi "Nenhuma." para "quantas seções você já tinha começado"); o modelo reserva e Corrigir rumo não valem em sala.

### Entrega da v62

APK ARM64 offline `dist/apk/mybots-v64.apk` e `.sha256`, **versionCode 64 / 0.40.0**, 44.150.980 bytes. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `21c511a67efc348f8980e5fa0b62f4f501a71f56375dbb1489c787926f2d2889`. Nenhuma permissão nova pedida ao Android (o receptor das ações da notificação não é exportado).

Release pública [v64](https://github.com/AugustodoBRT/Mybots/releases/tag/v64) (0.40.0), a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Commit `aacba32`, sem coautoria de IA. **PC atualizado depois da Release**: `scripts/build-desktop.sh` em **28/10/2026 às ~18:12 (Brasília)**; `mybots-pc` **active**. Provas e capturas em `.build-tools/emulator-state/v62/`. O diretório `output/` preexistente ficou fora dos commits.

## 29/10/2026 — v63 parte 1 (0.41.0, versionCode 65): fundação e rostos

Seção v63 do `PLANO-V54.md`, parte 1, com o plano aprovado pelo usuário antes de codar. A v62 foi aceita pelo usuário no início da sessão.

**Gerador** — `lib/face.mjs`, sem DOM: o código do `laboratorio-de-bots.html` (aba Rostos) foi portado sem mudar o resultado; `tests/face.test.mjs` extrai o código do próprio HTML e compara **célula a célula** (12 sementes × 7 estados × 6 instantes). `makeFace(semente, peças)`: a esquisitice vem da semente (não há barra); peças fixas (cabeça, textura, olhos, boca, topo) mudam só o campo escolhido. Também: `encodeFrame` (quadro em texto, 6 caracteres por célula), `stillOf` (quadro parado calmo, sem piscar nem sorrir) e `layout` (a cabeça cabe numa caixa quadrada; caracteres de verdade só com célula ≥ 8 px).

**Risco técnico** (provas em `.build-tools/emulator-state/v63a/`: `medicoes.txt`, `medir.sh`). Emulador Android 16 x86 com vídeo por software, tela de teste temporária (removida) que rola sozinha; linha de base: 1 bot, atraso médio do JS 9 ms.

| 30 bots, 54 px | atraso médio | ticks lentos |
|---|---|---|
| nativo, parados | 9,0 ms | 0 |
| nativo, 8 animados | 9,6 ms | 1 |
| nativo, 30 animados | 17,3 ms | 38 |
| SVG, 8 animados | 10,4 ms | 13 |
| SVG, 30 animados | 22,5 ms | 37 (77% dos quadros ruins) |
| `Text` por linha, 30 animados | 34 ms | pico de 409 ms; 91 quadros desenhados |

Rosto grande (330 px): os três ficam na linha de base no JS. **Escolha**: view nativa Kotlin (`FaceView`/`FacePainter`) que só pinta o quadro em texto de `lib/face.mjs`; até 8 rostos animam por vez a 8 quadros por segundo (`FaceArt.js`), o resto da lista usa um quadro calmo guardado; respeita "reduzir movimento". No PC (web) fica o SVG até a parte 3. Fonte monoespaçada só com os caracteres usados: `BotGlyphs.ttf` (25 KB, convertida do woff2 do laboratório). Com os 30 bots reais do emulador, rolar a Home deu mediana de 38 ms por quadro (23% de quadros ruins pelo critério do Android): é o piso do emulador sem GPU, da mesma ordem das medições com 1 bot; **não foi medido em celular real**.

**Widget, atalhos e notificação**: o supervisor gera um quadro parado (`stillOf`) e o Kotlin só pinta. O resumo do widget (`/device/widget`) leva `still` (112 px), `big` (192 px) e `brand`; os atalhos de compartilhar recebem o quadro do JS; os avisos dos bots levam `face` e usam o rosto como imagem da notificação (`notificacao-rosto.png`). `BotFace.kt` (avatar antigo) foi apagado. A animação em quadros do widget saiu: agora é um quadro parado, como combinado.

**Tema** — `mobile/palettes.js` (sem React, testável) e `theme.js`: escuro com preto `#000000` de verdade, claro quente e laranja `#FF9F1C` (escuro) / `#A85600` (claro) como única cor de destaque; `C.mint` sumiu (186 usos viraram `C.accent`; os de "tudo certo" viraram `C.good`). `C` é reescrito no lugar por `setTheme` e os estilos são recriados (`themed()`), então a troca vale na hora, sem reiniciar (comprovado no emulador, `home-claro.png`). A preferência (Escuro, Claro, Seguir o sistema; padrão Escuro) fica em `person.theme` no supervisor e aparece em Ajustes > Aparência. No PC, `document.body` e a barra de rolagem seguem o tema (`paintPage`). Android: tema da janela claro/escuro (`values-night`), `userInterfaceStyle` automático.

**`bot.face`** — `{ seed, color, pieces }`, validado no supervisor (`validFace`), sem tabela nova; bots antigos usam o nome como semente e as 4 cores antigas continuam. `BotAvatar` virou o rosto em todo lugar (lista, chat, salas, Ajustes, atividade, widget, atalhos, notificações). No perfil: 8 cores e "Sortear outro rosto" no lugar das 4 formas (o seletor de peças fica para a parte 2).

**Telas** — Home nova (menu, marca, chip de modo, saudação com resumo, aprovações, Salas, Seus bots em linhas planas com rosto e estado em palavras, barra de comando flutuante), gaveta lateral (Conversas, Atividade, Carteira, Rotinas, Negociações, Ajustes; ponto laranja quando algo espera), listas de Rotinas e Negociações que levam ao perfil do bot na aba certa (`initialTab`), e `@bot tarefa` na busca (abre a conversa com o texto no campo; não envia sozinho). A barra de abas e a faixa "Hoje" saíram. Conversa e sala mantêm todas as ações (rosto, cores e balão do usuário mudaram). Listas de ações antes e depois: `acoes-antes.md` e `acoes-depois.md`; nada sumiu, a faixa "Hoje" virou texto e a aprovação continua na Home (a regra "aparece uma vez" fica para a parte 2, junto com a tela de aprovação).

### Testes
- Suíte inteira (`npm test`): **286 de 286** (eram 270; 16 novos), zero falhas e zero ignorados. Novos: `face.test.mjs` (6: idêntico ao laboratório, determinismo, cada peça muda só o que deve, 7 estados, "do mal" sozinho, tons nos dois temas), `face-bot.test.mjs` (6: validação do rosto, criar/atualizar/recusar, cores antigas, quadro parado do widget e da notificação, cabeça cabe na caixa, resumo do widget) e `theme.test.mjs` (4: escolha do tema, preto de verdade, contraste AA 4,5:1 de todos os textos sobre todas as superfícies nos dois temas, rostos com 3:1). O teste de contraste achou dois problemas reais (cinza fraco no escuro, laranja claro no claro), corrigidos. `usage.test.mjs` cobre `person.update` com tema.
- Emulador (Android 16 x86, `.build-tools/emulator-state/v63a/`): Home escura e clara (`home-final.png`, `home-claro.png`), gaveta, Rotinas, conversa com o rosto animando, `@Teste cheque o prazo` → conversa com o texto no campo (`busca-tarefa.png`, `tarefa-no-chat.png`), segurar a mensagem (`segurar.png`), notificação de rotina com o rosto e o botão Responder (`notificacao-rosto.png`).
- **Não testado**: tela Negociações; botão Reenviar e fila na tela nova; resposta ao vivo com o rosto novo; widget e atalhos de compartilhar no launcher (a geração do quadro está em testes e o Kotlin compilou, mas não vi o widget na tela); janela do PC com o rosto em SVG (só compilada pela exportação web); tema Seguir o sistema (a regra tem teste, não mexi no tema do Android); rostos em celular real e desempenho real; aparelho com "reduzir movimento".
- Limites conhecidos: no tema claro as cores de tipo de arquivo (PDF, DOC…) e dos gráficos continuam as do escuro (não passam por AA); rótulos em maiúsculas com espaçamento ainda existem em Ajustes, Atividade e perfil (parte 2); a faixa de aprovação aparece na Home e no chat.

### Entrega da v63 parte 1
APK ARM64 offline `dist/apk/mybots-v65.apk` e `.sha256`, **versionCode 65 / 0.41.0**, 44.238.812 bytes, só ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `b715b6be042ef724fec16e17c3ffbd30c37281b023af5ecfce5ddb0bc2b2f30c`. Nenhuma permissão nova pedida ao Android. Capturas em `docs/screenshots/v63a-*.png` e provas em `.build-tools/emulator-state/v63a/`.
Release pública [v65](https://github.com/AugustodoBRT/Mybots/releases/tag/v65) (0.41.0), a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Commit `e0fe18e`, sem coautoria de IA. **PC atualizado depois da Release**: `scripts/build-desktop.sh` em **29/10/2026 às 01:42 (Brasília)**; `mybots-pc` **active** (PID 48443). Emulador e daemons do Gradle encerrados; o diretório `output/` e as pastas `personagens-*` preexistentes ficaram fora dos commits.

## 29/10/2026 — v63 parte 2 (0.42.0, versionCode 66): resto do celular

Seção v63 do `PLANO-V54.md`, parte 2, depois do aceite da parte 1 pelo usuário.

**Ajustes por categorias** (`components/Settings.js`): lista com busca (`settings-search.js`, sem acento nem maiúsculas) e uma página por categoria: **Conta e IA** (seu nome, Aparência, e-mail, conectores da conta, apps), **Bots** (lista que abre o perfil e Novo bot), **Celular** (tela apagada, widget, notificações; no PC o pareamento), **Computador**, **Senhas e carteira**, **Backup e diagnóstico** e **Sobre** (versão, atualização, privacidade). Todos os painéis antigos continuam, só mudaram de lugar. **Senhas guardadas** é uma tela própria (`components/Passwords.js`): busca por site ou usuário, agrupada por site (`password-groups.js`) numa `SectionList` que renderiza uma tela por vez; o resumo "1003 senhas · 30 bots com acesso" aparece na lista de categorias. O painel antigo `PasswordsPanel` saiu.

**Criar bot** (`components/NewBot.js`, `FacePicker.js`): 3 passos. Rosto (nome, rosto grande com caracteres de verdade, **Sortear** e **Montar** com cabeça, textura, olhos, boca e topo, 8 cores), jeito e acesso (modelos, personalidade, inteligência, onde vive, os 4 níveis; o botão fica no fim do conteúdo, não cobre o Médio) e primeira mensagem (fica no campo da conversa). Livre é aplicado depois da criação com o aviso de sempre. O mesmo seletor está no perfil, em "Rosto". Perfil: as 5 abas cabem na largura (ícone acima do texto), rótulos em frase normal.

**Uma decisão aparece uma vez**: a Atividade só conta as decisões e leva à tela inicial; Aprovar e Recusar ficam na Home e no chat. O botão do cartão de aprovação passou de "Permitir" para "Aprovar". **Texto**: todos os rótulos em maiúsculas com espaçamento das telas do celular viraram frase normal (Ajustes, Atividade, perfil, Negociar, navegador do bot, cartão de aprovação, selo "Congelada").

### Testes
- Suíte inteira (`npm test`): **294 de 294** (eram 286; 8 novos), zero falhas e zero ignorados. Novos: `settings.test.mjs` (4: busca dos ajustes, agrupar senhas, resumo, mil senhas agrupam e filtram em menos de 200 ms), `ui-rules.test.mjs` (3: nada em inglês, sem maiúsculas espaçadas, faixa lateral, gradiente ou barra de abas nas telas novas) e 1 em `face-bot.test.mjs` (criação como o assistente faz, com todos os níveis e locais).
- **Emulador** (Android 16 x86, `.build-tools/emulator-state/v63a/`, capturas em `docs/screenshots/v63b-*.png`): Ajustes e categorias nos dois temas; **1.003 senhas** (1.000 semeadas com um gancho temporário de teste, removido) abrem agrupadas e rolam com mediana de 32 ms por quadro e 21% de quadros ruins (`p2-senhas-rolando.txt`), contra 38 ms e 23% da Home com 30 bots no mesmo emulador sem GPU; assistente de novo bot nos 3 passos até criar o bot Zeca (rosto e cor gravados, primeira mensagem no campo); Sortear e Montar; perfil com as 5 abas; Carteira.
- **Não testado**: pesquisar nos Ajustes e na lista de senhas digitando; Adicionar e Importar senha pela tela nova; Conta e IA, Bots, Celular, Computador, Backup e Sobre abertos na tela (o código reaproveita os painéis; só abri Senhas e carteira); criar bot com Livre, Pouco acesso e Acesso total, e com Computador ou Onde estiver; o botão Aprovar e o contador da Atividade; modelos Faculdade e Google no assistente; Rotinas e Negociações (lista) com dados; perfil de bot antigo salvando o rosto; a janela do PC; celular real.
- Limites conhecidos: no tema claro os dentes brancos do rosto quase somem (a paleta clara é a do laboratório, mantida); senhas semeadas com `bots: []` aparecem como "bot apagado" (artefato do teste, a lista real usa `null` para todos); a janela do PC ainda usa o layout estreito (parte 3).

### Entrega da v63 parte 2
APK ARM64 offline `dist/apk/mybots-v66.apk` e `.sha256`, **versionCode 66 / 0.42.0**, 44.264.204 bytes, só ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `bd02ca40754476cf6e1875a4971e5484194fd78f5372a360d5b6b1817d2f42c3`. Nenhuma permissão nova pedida ao Android.
Release pública [v66](https://github.com/AugustodoBRT/Mybots/releases/tag/v66) (0.42.0), a mais recente, com APK e `.sha256`; o APK baixado da Release é idêntico ao local. Commit `33e0ec7`, sem coautoria de IA. **PC atualizado depois da Release**: `scripts/build-desktop.sh` em **29/10/2026 às 02:22 (Brasília)**; `mybots-pc` **active** (PID 92235). Emulador e daemons do Gradle encerrados; o diretório `output/` e as pastas `personagens-*` preexistentes ficaram fora dos commits.

## 29/10/2026 — v63 parte 3 (0.43.0, versionCode 67): a janela do PC

Seção v63 do `PLANO-V54.md`, parte 3, depois do aceite da parte 2 pelo usuário. Estrutura do plano, sem base do Stitch.

**`components/DesktopShell.js`** (substitui `DesktopShell`, `SideRow`, `DeskWelcome` e `TodayPanel` de `shared.js`):
- **Barra de ícones** de 56 px: Conversas, Atividade (ponto laranja quando algo espera), Rotinas e Negociações (as mesmas listas do celular); embaixo os limites do plano em anéis (Claude e Codex, da janela de 5 horas), Ajuda (atalhos) e Ajustes. A **Carteira** não aparece: cartões e senhas ficam no cofre do Android.
- **Lista de conversas** (300 px, divisória que se arrasta de 240 a 440): busca que abre o Ctrl+K, seção Salas recolhível, uma linha por bot ou sala (rosto com estado e animação, nome, prévia de uma linha, hora, ponto de não lido), menu de clique direito no bot (abrir, perfil), rodapé com o estado do celular. Sem cartões, saudação nem aprovações. Menos de 900 px: só os rostos.
- **Abas** no alto, uma por conversa aberta, voltar e avançar, chip do modelo, **Abrir navegador** (liga o painel do navegador ao vivo que já existia na conversa), **Perfil** e **Aprovações** (painel direito, fechado por padrão, com decisões, pendências, próximas rotinas e o que os bots fizeram). O cabeçalho da conversa perdeu os botões que as abas já têm.
- **Sem conversa aberta**: o rosto grande do bot mais ativo (com caracteres de verdade, num canvas na web), "Boa noite, Augusto.", "3 trabalhando. 1 espera você.", a aprovação pendente como bloco simples e três ações discretas (Novo bot, Nova sala, Buscar).
- **Teclado**: Ctrl+K (buscar e trocar, setas e Enter), Ctrl+N (novo bot), Esc (fecha janela, painel, menu). Clique direito na mensagem abre copiar, citar, fixar e reenviar.
- **Conversa** numa coluna de 760 px, respostas sem balão, Fila logo acima do campo. **Anexos**: o ＋ e arrastar arquivos para a janela (até 5 arquivos e 2,5 MB, pelo mesmo `chat.send` do celular).
- **Ajustes em duas colunas** (categorias à esquerda; as que só fazem sentido no celular não aparecem) e **Atividade em três colunas** (Precisa de você, Em andamento, Concluído hoje) em `Settings.js` e `Activity.js`. O assistente de novo bot fica numa coluna de 680 px.
- **Rosto na web**: `FaceArt` ganhou um painter de canvas (como o laboratório), com a fonte `BotGlyphs` carregada pelo app; o SVG fica só de reserva.

### Testes
- Suíte inteira (`npm test`): **295 de 295** (eram 294; 1 novo), zero falhas e zero ignorados. Novo: `tests/desktop-window.test.mjs`, que exporta a interface web, sobe um supervisor de verdade com 3 bots e abre a janela no Chrome (Playwright): saudação e ações, barra de ícones, lista, aba por conversa, painel que começa fechado e fecha com Esc, anexo pelo botão e recusa de arquivo acima do limite, Ctrl+K e Enter, Ctrl+N, Ajustes em duas colunas sem Senhas e carteira, Atividade em três colunas, janela de 860 px só com rostos, e nenhum erro no navegador. `ui-rules.test.mjs` passou a cobrir `DesktopShell.js` e `Activity.js`.
- Capturas em `.build-tools/emulator-state/v63c/pc-*.png` (início, conversa, painel, Ctrl+K, menu da mensagem, Ajustes, Atividade, novo bot, janela estreita, tema claro) com o roteiro de `.build-tools/pc-shots.mjs`; cópias em `docs/screenshots/v63c-*.png`.
- **Não testado**: o serviço e a janela real (Tauri) já instalados, só o mesmo código no Chrome; o navegador ao vivo do bot e o botão "Abrir navegador" com um bot de verdade; uma aprovação pendente de verdade no painel e na tela inicial; a sala aberta na janela nova; Rotinas e Negociações com dados; Esc fechando cada diálogo; anéis de limite com o Claude conectado; o celular (o código novo só mexe nele em `Chat.js`, `FaceArt.js` e `App.js`, e nada disso foi aberto num aparelho nesta rodada).
- **Não feito** (do plano): "Atualização pronta · Reiniciar" no pé da lista (o PC se atualiza por `build-desktop.sh`, sem aviso na janela); perfil do bot em página larga com categorias à esquerda (continua no diálogo com abas no alto); divisórias arrastáveis além da da lista (o painel de navegador e o de Aprovações têm largura fixa).

### Entrega da v63 parte 3
APK ARM64 offline `dist/apk/mybots-v67.apk` e `.sha256`, **versionCode 67 / 0.43.0**, 44.292.548 bytes, só ARM64. Certificado conferido com `apksigner verify --print-certs`: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. SHA-256 do APK: `b430be2d1f87e8f0534a11895a1406298e3cd5a4585cb94cc38b1e9040cf0fa3`. Nenhuma permissão nova pedida ao Android.
