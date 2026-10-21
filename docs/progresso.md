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
