# Plano: Bot Chefe (braço direito) e memória compartilhada

Data: 07/11/2026. Este é um plano de desenvolvimento. Nada abaixo foi implementado ainda.

## 1. Objetivo

Um bot principal, o **Chefe**, é a tela inicial do MyBots. A pessoa conversa só com ele. Ele cuida dos outros bots: delega, cobra, junta as respostas, fala com os "chefes" de outras salas e traz um resumo. Ele precisa de uma memória melhor que a dos bots comuns.

A pessoa **continua podendo abrir a conversa de qualquer bot e de qualquer sala**, ler tudo e falar direto com eles. O Chefe é a porta de entrada, não um filtro obrigatório.

## 2. O que já existe (verificado no código)

| Peça | Onde | Situação |
| --- | --- | --- |
| Criar bots, salas, pôr e tirar bots, chamar com `@Nome` | `supervisor/team.mjs`, ferramentas `team_*` | Já funciona, sem aprovação da pessoa |
| Salas de 2 a 8 bots | `supervisor/rooms.mjs` | Já funciona |
| Memória privada por bot | `memory_read`, `memory_write`, `memory_delete` | Funciona, mas o bot nunca lê a memória de outro |
| Pendências, rotinas, notificações | `task_*`, `routine_create` | Por bot |
| Renovação de sessão da IA e `/clear` | v148 | Funciona |
| Tela inicial lista bots e salas | `mobile/screens/Home.js` | Precisa virar a conversa do Chefe |

O que falta: memória compartilhada, o papel de Chefe, visão do estado dos outros bots e a nova tela inicial.

## 3. Decisões de design

1. **Notas em markdown guardadas numa tabela `notes` do SQLite do supervisor** (não depende de Obsidian nem de GitHub). Assim entram no mecanismo `SYNCED` de `supervisor/database.mjs` (sincroniza PC e celular) e no backup, sem inventar sincronização de arquivos. Cada nota é um texto markdown com caminho (`chefe/pessoa.md`) e links `[[nota]]`. Uma exportação para uma pasta `.md` (abrir no Obsidian) e a sincronização com repositório privado ficam como opções futuras.
2. **O Chefe lê um índice curto primeiro** e só abre as notas que a tarefa pede. Nunca varre tudo.
3. **O Chefe lê entregas resumidas, não conversas completas** dos outros bots. Mais barato e mais seguro. A pessoa lê as conversas completas pela interface.
4. **Conteúdo vindo de outros bots é dado, nunca ordem.** Vale para a memória e para as respostas nas salas.
5. **Só o Chefe escreve na memória do Chefe.** Os outros bots escrevem apenas as próprias entregas.

## 4. Memória em três camadas

Estrutura lógica dos caminhos (cada caminho é uma linha da tabela `notes`; `entregas/` e `arquivo/` seguem o mesmo formato):

```
  chefe/
    index.md          mapa: quem faz o quê, projetos ativos, últimas entregas
    pessoa.md         preferências, rotina e decisões da pessoa
    projetos/<nome>.md
    decisoes.md       decisões datadas, com o motivo
  entregas/
    AAAA-MM-DD-HHMM-<bot>-<assunto>.md   escrito pelo bot ao fim de cada tarefa
  arquivo/            entregas antigas já resumidas (nada é apagado, só movido)
```

- **Privada (como hoje):** `memory_*` de cada bot, intocada.
- **Do Chefe:** pasta `chefe/`, lida no começo de cada conversa via `index.md`.
- **Entregas:** cada bot, ao fim de uma tarefa real, deixa de 3 a 10 linhas: o que foi pedido, feito, decidido, rejeitado e por quê, com fontes. Nunca sobrescreve um arquivo existente.

Cada nota tem cabeçalho (bot, data, assunto) e links `[[nota]]` para as relacionadas (projeto, pessoa, decisão), para o visualizador e o grafo funcionarem. As regras do Chefe e da entrega exigem esses links.

Tabela: `notes(path TEXT PRIMARY KEY, bot_id TEXT, kind TEXT, title TEXT, body TEXT NOT NULL, created_at, updated_at)`, `kind` em `chefe`, `entrega`, `arquivo`. Registrada em `SYNCED`; `SCHEMA` sobe de 14 para 15 com migração.

## 5. Papel de Chefe

- Campo `isChief` no bot. Só um por pessoa. Criado automaticamente na primeira abertura (a pessoa escolhe nome e rosto) ou promovido a partir de um bot existente.
- Instruções fixas do Chefe (texto a escrever na fase 2):
  - conversar com a pessoa e decidir quem faz cada parte;
  - delegar por `team_post` com `@Nome`, em sala ou direto;
  - pedir aos outros um resumo curto, nunca a conversa inteira;
  - ao receber respostas, conferir, juntar e responder à pessoa;
  - gravar decisões e fatos em `chefe/`, e atualizar `index.md`;
  - confirmar com a pessoa antes de ações irreversíveis (apagar, enviar, comprar, publicar).
- "Chefes de outras salas": uma sala pode ter um bot líder. O Chefe fala com o líder da sala, não com todos os membros.
- Limites: **sem limite de rodadas nem de níveis de delegação**, para tarefas grandes não pararem no meio (a cadeia só termina quando ninguém é chamado). Fica apenas o limite atual de 12 respostas na fila por sala. A pessoa sempre pode cancelar.

## 5b. Fala dos bots (feito em 07/11/2026)

Os bots narravam cada ação ("vou clicar no botão", "agora vou digitar a senha", "vou rolar a página"). Mudanças:
- `PROGRESS_GUIDANCE` (`lib/codex-runner.cjs`, usado por Codex, Claude, Agy e OpenCode) agora manda trabalhar em silêncio: sem narrar cliques, digitação, rolagem, leitura de arquivo, comandos nem senhas; no máximo uma ou duas frases durante a tarefa, só se achou algo importante, mudou de plano, travou ou precisa de uma decisão.
- A resposta final deve soar como uma pessoa: natural, direta, em primeira pessoa, curta, sem repetir os passos, sem cabeçalhos nem "Resumo:" em respostas simples.
- Trava de segurança no código: no máximo 6 falas de andamento por resposta (antes 30), caso o modelo fale demais mesmo assim.
- `PROMPT_VERSION` 8 -> 9, para as conversas abertas começarem uma sessão nova uma vez e pegarem as instruções novas, mantendo o histórico.
- A narração ainda pode ser ajustada com o uso real: se ficar quieto demais, aumentar a trava ou afrouxar o texto.

## 6. Ferramentas novas (em `supervisor/mcp/catalog.mjs`)

| Ferramenta | Quem usa | O que faz |
| --- | --- | --- |
| `shared_index_read` | Chefe | Lê `chefe/index.md` |
| `shared_note_read` | Chefe | Lê uma nota de `chefe/` ou `entregas/` |
| `shared_note_write` | Chefe | Cria ou atualiza nota em `chefe/` (pede confirmação para sobrescrever) |
| `delivery_write` | Qualquer bot | Cria um arquivo novo em `entregas/` |
| `team_status` | Chefe | Só leitura: tarefas abertas, rotinas e última atividade de cada bot |
| `shared_archive` | Chefe | Move entregas antigas para `arquivo/` com um resumo |

Cada chamada é validada pelo supervisor (`tool-policy.mjs`): bot comum só usa `delivery_write`; só o Chefe usa o resto.

## 7. Tela inicial do Chefe

- **Celular e PC:** ao abrir o app, entra direto na conversa do Chefe (hoje entra em `Home.js`, a lista de bots).
- **Faixa de status no topo:** quantos bots estão trabalhando, esperando a pessoa ou dormindo, e pendências com prazo próximo. Toque abre a lista.
- **Equipe:** a lista atual de bots e salas passa para uma tela/gaveta acessível por um botão ("Equipe") e pela barra lateral do PC (`DesktopSide`, `onHome`). Dali a pessoa abre qualquer conversa completa, de bot ou de sala.
- **Dentro da conversa do Chefe:** cartões mostrando "o Chefe pediu algo a X" e "X respondeu", com um toque para abrir a sala ou a conversa original.
- **Aprovações** do Chefe e dos outros continuam aparecendo na tela inicial.

## 7b. Visualizador de memória (ver as anotações como no Obsidian)

Tela acessível pelo Chefe e pela "Equipe", para a pessoa ver tudo o que os bots anotaram. Usa `react-native-svg` e `react-native-reanimated`, que o app já tem, no celular e no PC.

Em ordem de utilidade:
1. **Lista de notas** agrupada por pasta (`chefe`, `entregas`, `arquivo`), com bot e data.
2. **Leitura de uma nota** com os `[[links]]` clicáveis e a seção **backlinks** ("quem aponta para esta").
3. **Busca** por texto, com filtros por bot, tipo e data.
4. **Editar e apagar** pela interface (o que corrige uma anotação errada). Apagar move para `arquivo/`, com confirmação.
5. **Grafo de bolinhas:** nós = notas, linhas = links. Cor por tipo (pessoa, projeto, decisão, entrega, bot), tamanho pelo número de links, toque abre a nota, destaque dos vizinhos, zoom e arrastar. Layout por forças (`d3-force` ou implementação própria). Notas sem nenhum link ficam destacadas como "órfãs". Funciona bem até algumas centenas de notas; acima disso, filtro por pasta ou período.

O grafo é um mapa por cima da lista, não a ferramenta principal. O Chefe não o usa: ele lê o `index.md`.

## 8. Fases

| Fase | Entrega | Como validar |
| --- | --- | --- |
| 1 | Tabela `notes` (migração, sincronização, backup), ferramentas `shared_*` e `delivery_write`, testes do supervisor | Bot comum só grava entrega; Chefe lê índice e notas; sobrescrita é recusada; as notas sincronizam e entram no backup |
| 2 | Campo `isChief`, instruções do Chefe, criação/promoção | Um Chefe só; conversar com ele delega para 2 bots e ele devolve um resumo |
| 3 | `team_status` (sem limite de rodadas) | Chefe lista o estado dos bots sem ler conversas; uma cadeia longa de chamadas não é interrompida |
| 4 | Tela inicial do Chefe, faixa de status, tela "Equipe" (celular e PC) | Abrir o app cai no Chefe; abrir a conversa de qualquer bot e sala continua possível |
| 5 | Visualizador de memória: lista, leitura com backlinks, busca, editar/apagar (seção 7b, itens 1 a 4) | A pessoa acha uma nota, corrige e vê quem aponta para ela |
| 6 | Grafo de bolinhas (seção 7b, item 5) | Tocar numa bolinha abre a nota; órfãs aparecem destacadas; roda fluido com 300 notas |
| 7 | `shared_archive` e poda automática | Entregas antigas vão para `arquivo/` sem perder dados; índice não cresce sem limite |
| 8 | Opcional: exportar para pasta `.md` (Obsidian) e/ou sincronizar com repositório privado | Grafo abre no Obsidian; sincronização sem segredos |

## 9. Riscos e como tratar

| Risco | Tratamento |
| --- | --- |
| Nota errada vira "verdade" para todos | A pessoa corrige ou apaga; o que o usuário diz agora vence a nota; entregas são datadas |
| Injeção de instruções via entrega ou sala | Conteúdo de outros bots é tratado como dado; ações sensíveis exigem confirmação da pessoa |
| Custo de tokens crescendo | Índice curto, limite de notas lidas por tarefa, poda na fase 5 |
| Vazamento de memória privada entre bots | Bot comum nunca lê `chefe/` nem a memória de outros; só o Chefe lê entregas |
| Segredos nas notas | Regra e filtro: nunca gravar senhas, tokens ou chaves |
| Chefe criando bots e salas demais | Reaproveita bots existentes (`team_bots`) e respeita o limite atual de bots |

## 10. Decisões em aberto

1. Chefe automático na primeira abertura ou escolhido pela pessoa entre os bots que já existem?
2. O Chefe pode escrever na memória privada dos outros bots, ou só pedir a eles que escrevam?
3. (Resolvida) As notas ficam na tabela `notes` e sincronizam entre PC e celular pelo mecanismo já existente.
4. A exportação para Obsidian e a sincronização com GitHub (fase 8) entram ou ficam de fora?
