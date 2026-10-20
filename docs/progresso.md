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
