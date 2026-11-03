# Plano: PC e celular funcionando sozinhos, com sincronização

Objetivo: o app do computador funciona com o celular desligado, e o celular com o PC desligado. Quando os dois estão ligados, veem a mesma coisa. Sem conta na nuvem (decisão de 01/11/2026; um relé opcional pode vir depois).

## Situação hoje
- O celular é o centro: bots, conversas, memória, rotinas, permissões e senhas ficam no SQLite do Termux (`~/.mybots/mybots.db`). O PC (`pc/`) era só um executor pareado até a v113 (hoje também tem o supervisor próprio, Fase 1) (`supervisor/link.mjs`, `nodes.mjs`): responde pelos bots "Computador" e "Onde estiver". A janela do PC mostra o estado vindo do celular.
- Sem o celular, a janela do PC não tem dados e os bots do PC não têm de onde ler conversa, memória, rotinas nem permissões.

## Desenho
**Dois supervisores completos** (o mesmo código de `supervisor/`), cada um com o seu banco. Cada um funciona sozinho. Quando se veem (mesma rede ou Tailscale, pelo pareamento por QR já existente), sincronizam.

- **Dono de cada bot** (`home`: celular, PC ou onde estiver): só o dono executa o bot e roda as rotinas dele, para não duplicar. "Onde estiver" roda no aparelho ligado; se os dois estão ligados, no que estiver online há mais tempo ou no que a pessoa escolher.
- **O que sincroniza e como**
  - Mensagens, tarefas e sessões: ID único (UUID), só se acrescenta; juntar é a união dos dois lados.
  - Bots, perfis, grants, rotinas, memória, pessoa, salas: o mais recente vence, por registro (`updatedAt` + id do aparelho como desempate). Apagar é uma marca (`deletedAt`) que também sincroniza.
  - Sessões das IAs são **por aparelho** (já são: `session.lane.*`); não sincronizam.
  - Arquivos/anexos: sincronizam por hash, sob demanda (só quando alguém abre).
  - Senhas e cofre, cartões, tokens e chaves: **não sincronizam por padrão**; opção explícita, cifrada de ponta a ponta com o segredo do pareamento (decidir na Fase 3).
- **Canal**: o mesmo do pareamento (TLS na porta 3230, descoberta UDP 3234, Tailscale fora de casa). Um registro de mudanças (`changes`) por aparelho, com contador crescente; cada lado pede "o que mudou desde o contador X do outro".

## Fases (ordem de 03/11/2026, para o beta)
**Fase 1 — PC sozinho. Feita na v114.** O nó do PC sobe um supervisor completo próprio (processo filho, banco em `~/.mybots-pc/supervisor/`), pareado com o próprio nó por loopback: os turnos usam o mesmo executor (sandbox, desktop, navegador). A janela escolhe de onde vêm os dados: celular (como antes) ou este computador (Ajustes → Celular). Quem nunca pareou um celular já começa no computador. Bots criados no PC vivem só nele até a sincronização. Detalhes em [computador.md](computador.md).
**Fase 2 — relé na VPS. Feita na v115.** `relay/server.mjs` na VM da Oracle (São Paulo, `136.248.104.150:3240`): PC e celular ligam *para* ela, nada se abre em casa. O relé só encaminha bytes: o TLS com certificado fixado e a prova HMAC da conexão direta passam por dentro do túnel, então ele não vê conteúdo nem consegue se passar pelo PC; não guarda nada em disco. Ordem: rede local/Tailscale primeiro; o relé entra em paralelo se a direta falhar ou demorar mais de 1,5 s; conectado pelo relé, o celular testa a direta a cada 45 s e volta a ela sozinho. Detalhes em [computador.md](computador.md).
**Fase 3 — registro de mudanças. Feita na v116.** O banco (versão 13) ganhou `changes` e `sync_state`: cada escrita em bots, mensagens (de bots e de salas), memória, permissões, salas, rotinas, pendências e nas configurações da pessoa deixa uma linha (tabela, chave, contador local que só cresce, relógio de Lamport, aparelho de origem, horário, marca de apagado), uma por registro. Quem registra são gatilhos do SQLite, então nenhum caminho de código esquece. O conteúdo é lido na hora do pedido (`changesSince`), com paginação. Ficam só no aparelho: tarefas, sessões das IAs, aprovações, atividade, notificações, batimentos, conectores, uso, passos do navegador, negociações, habilidades e dados de pareamento. Os dados que já existem entram no registro na atualização, com o próprio horário de cada um (os sem horário valem como "nunca editados"). `withoutLogging` deixa a Fase 4 aplicar mudanças vindas do outro aparelho sem que elas voltem. O supervisor responde `sync.status` e `sync.changes`.
**Fase 4 — sincronização. Feita na v117.** O nó do PC (`pc/sync.mjs`) enxerga os dois supervisores (o do celular, pelo link, e o próprio do computador, pelo pareamento local) e os mantém em dia: puxa do celular para o computador e do computador para o celular, ao conectar, a cada evento relevante (mensagem, bot, fim de tarefa; no máximo uma rodada por segundo), a cada minuto e no botão "Sincronizar agora". Cada lado responde `sync.changes` (o que mudou depois de um contador, sem devolver o que o próprio pedinte mandou) e `sync.apply`. O cursor de leitura é guardado por par de aparelhos (`sync-state.json`), então um aparelho reinstalado é lido de novo desde o começo sem duplicar nada.
- **Regra**: vale a versão mais recente (horário, depois contador de Lamport, depois id do aparelho); apagar também sincroniza. Edição dos dois lados ao mesmo tempo, com conteúdo diferente, vira um aviso em Atividade nos dois aparelhos ("Conflito em bot «X»…"), e a mais recente fica. Mensagens e anexos só se acrescentam.
- **O que não sincroniza**: permissões (decididas por aparelho), senhas, cofre, cartões, tokens e chaves, sessões das IAs, tarefas, aprovações, notificações, uso. O nível de acesso de um bot nunca sobe por sincronização (um bot que chega fica no máximo em Médio guardado; o produto já normaliza o nível ao ler).
- **Rotinas** são compartilhadas e rodam em um aparelho só: o celular enquanto está ligado, o computador enquanto o celular está fora de alcance (voltam ao celular quando ele reaparece). Sem aparelho pareado, tudo roda onde está. As agendas das rotinas que chegam são calculadas no aparelho que as recebeu.
- **Arquivos** acompanham as linhas, em partes de 3 MB, até 20 MB; maiores ficam no aparelho que os criou (a linha do anexo aparece nos dois).
- **Tela**: Ajustes → Computador (celular) e Ajustes → Celular (janela do PC) mostram o estado (em dia, copiando n de N, aguardando, erro), conflitos dos últimos 30 dias e, na janela, "Sincronizar agora". Depois da primeira sincronização, a janela do PC passa a ler o MyBots do próprio computador por padrão (a escolha continua em Ajustes).
**Fase 5 — migração, posse e fechamento do beta.** Quem hoje usa só o celular: o PC se pareia e puxa tudo (primeira sincronização completa). Bots com `home` mudam de dono sem perder histórico. Rotinas: só rodam no dono. Tela de estado da conexão e aviso de versão beta.

Cada fase termina com versão, `npm test` (incluindo testes de sincronização com dois supervisores falsos, conflitos e apagar), APK, Release, push e PC.

## Riscos e perguntas em aberto
- Duas edições do mesmo bot offline: o mais recente vence e a outra fica registrada em Atividade (não se perde silenciosamente).
- Relógios diferentes: usar um relógio lógico (Lamport) junto do horário, não só o horário.
- Tamanho: mensagens com milhares de itens; sincronizar por lotes e com contador, nunca tudo de novo.
- Senhas: sincronizar ou não (Fase 3).
- O app antigo do celular (v105) não sabe sincronizar: a primeira versão com sync precisa convivir com ele (o link atual não some até a Fase 4).
