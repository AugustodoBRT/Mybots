# Plano: PC e celular funcionando sozinhos, com sincronização

Objetivo: o app do computador funciona com o celular desligado, e o celular com o PC desligado. Quando os dois estão ligados, veem a mesma coisa. Sem conta na nuvem (decisão de 01/11/2026; um relé opcional pode vir depois).

## Situação hoje
- O celular é o centro: bots, conversas, memória, rotinas, permissões e senhas ficam no SQLite do Termux (`~/.mybots/mybots.db`). O PC (`pc/`) é um executor pareado (`supervisor/link.mjs`, `nodes.mjs`): responde pelos bots "Computador" e "Onde estiver". A janela do PC mostra o estado vindo do celular.
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

## Fases
**Fase 1 — PC sozinho.** O processo do PC passa a subir um supervisor completo próprio (banco em `~/.mybots-pc/`), com a janela falando com ele, não com o celular. Bots criados no PC vivem só nele até a sincronização. O link atual continua funcionando como está.
**Fase 2 — registro de mudanças.** Cada escrita relevante (bots, mensagens, memória, rotinas, grants, salas) passa a gravar também numa tabela `changes` (id do aparelho, contador, tabela, chave, `updatedAt`, conteúdo ou marca de apagado). Migração: gerar o registro inicial dos dados atuais.
**Fase 3 — sincronização.** Troca de mudanças pelo canal pareado (ao conectar e ao vivo), resolução por registro, anexos por hash, tela em Ajustes (último sync, aparelhos, conflitos resolvidos) e a decisão sobre senhas.
**Fase 4 — migração e posse.** Quem hoje usa só o celular: o PC se pareia e puxa tudo (primeira sincronização completa). Bots com `home` mudam de dono sem perder histórico. Rotinas: só rodam no dono.

Cada fase termina com versão, `npm test` (incluindo testes de sincronização com dois supervisores falsos, conflitos e apagar), APK, Release, push e PC.

## Riscos e perguntas em aberto
- Duas edições do mesmo bot offline: o mais recente vence e a outra fica registrada em Atividade (não se perde silenciosamente).
- Relógios diferentes: usar um relógio lógico (Lamport) junto do horário, não só o horário.
- Tamanho: mensagens com milhares de itens; sincronizar por lotes e com contador, nunca tudo de novo.
- Senhas: sincronizar ou não (Fase 3).
- O app antigo do celular (v105) não sabe sincronizar: a primeira versão com sync precisa convivir com ele (o link atual não some até a Fase 4).
