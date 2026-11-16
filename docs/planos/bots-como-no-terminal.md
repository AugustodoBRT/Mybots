# Bots como no terminal

Os bots do MyBots são o Claude Code, o Codex, o Antigravity (`agy`) e o OpenCode rodando de verdade por trás. O objetivo deste plano é fazer cada um deles entregar dentro do MyBots a mesma velocidade, inteligência e ferramentas que entregam quando usados direto no terminal ou no app do Claude Code — mantendo as travas de segurança de cada bot.

## Prioridade antes deste plano: estabilidade do celular

Relato de 16/11/2026: usando apenas o supervisor do celular, com o PC desligado, o app cai e reconecta aproximadamente a cada dez segundos, inclusive em primeiro plano. Investigar e corrigir antes das otimizações abaixo. A conexão local deve permanecer utilizável com o app aberto; perda de internet não deve derrubar o socket local nem reiniciar o supervisor desnecessariamente. Para operação em segundo plano, verificar serviço Android, suspensão, retomada e recuperação sem perder/duplicar tarefas.

Diagnóstico em andamento: separar fechamento do WebSocket, encerramento/reinício do processo Linux e status da IA sem conexão. A inspeção do código não confirmou ainda uma causa; teste local no emulador 0.94.20 manteve a mesma instância e conexão por 197 segundos, sem quedas ou reinícios durante a observação, sem reproduzir o ciclo relatado. Falta o texto exato do erro e, se necessário, diagnóstico do aparelho afetado. Este item não está corrigido nem validado no celular real.

## Situação conferida em 16/11/2026 (0.94.20 / v212)

Esta seção e a Parte E são a referência atual de execução. O diagnóstico e os passos originais abaixo preservam a motivação do plano; seus nomes de funções/flags devem ser conferidos na CLI instalada antes de implementar. “Implementado” aqui significa encontrado no código, não aceite de todos os fluxos em todos os sistemas.

### Já implementado

- MCP do agy com `eager` **por nome de ferramenta**, migração da configuração antiga preservando os demais servidores, configuração isolada só com MyBots no Linux com bubblewrap; `OWN_FILES` aceita os schemas MCP; progresso identifica as ferramentas. Turno real `team_status` validado na v212 sem leitura prévia de schema e sem “Skipping invalid MCP server config”.
- Coleta de imagens do agy e do Codex; rascunhos por deltas no agy e no Claude.
- Pesquisa web nativa ligada no Claude (`WebSearch`/`WebFetch`) e Codex (`web_search=live`); recusas de WebFetch a endereços locais no Claude. Ainda falta ajustar as orientações para preferir busca/leitura nativa quando não for necessária interação com uma página.
- Nota Você injetada no contexto inicial dos chats e das salas; `user_decide`/`user_decisions` disponíveis para os bots, respeitando a política do supervisor.
- `browser_read` com padrão de 6000 caracteres e coordenadas arredondadas, inclusive a cópia Android; isso reduz as respostas, mas não prova que todo envelope fique abaixo de 8 KB.
- Quatro skills de documentos embutidas e ativas para bots com terminal no PC, índice sob demanda e ocultação das skills pessoais no sandbox Linux.
- Título já roda com `noTools: true`; porém ainda é uma chamada extra de IA e `await nameSession` permanece antes de `task.done`.

### O que ainda falta no plano original

| Item | Estado e próximo trabalho |
| :--- | :--- |
| **A.1 — Isolamento dos MCPs do agy** | Parcial: configuração isolada no Linux com bubblewrap. Completar uma configuração por turno nos ambientes sem esse isolamento, preservando o arquivo pessoal e turnos concorrentes. |
| **A.4 — Permissões nativas do agy** | Pendente: não há `nativeOff`/bloqueio por ferramenta no runner atual. Provar a recusa de terminal e escrita quando o bot não tem essas permissões, além do isolamento do sistema operacional. |
| **Persistência e tarefas em fundo** | Pendente: o runner ainda usa uma CLI por turno; não existe o pool `agy serve` descrito na entrada 0.94.19 de `docs/progresso.md`. Estudar API suportada, manter sessão/servidor por bot/conta e encerrar corretamente ao parar, trocar conta ou atualizar. Verificar tarefas entre turnos e não só dentro de um turno. |
| **Subagentes nativos** | Pendente no Claude e no Codex: `Task`/`Agent` não estão na lista `--tools` do Claude e `multi_agent` continua em `DISABLED_FEATURES` do Codex. Habilitar com limites/permissões e progresso, incluindo interrupção. Auditar os subagentes já expostos pelo agy/OpenCode. |
| **Perguntas nativas → MyBots** | O MCP `user_decide` funciona, mas não foi encontrada a ponte de `AskUserQuestion` do Claude nem das perguntas equivalentes das outras CLIs para o cartão do app. Implementar e validar retomada/cancelamento. |
| **B.1 / C.1 — Escolher web nativa ou navegador** | Parcial: ferramentas nativas ligadas, mas as instruções ainda mandam usar o navegador de forma ampla. Preferir busca/leitura nativa para conteúdo público; navegador para login, interação ou conteúdo renderizado. |
| **C.2 — Streaming fino do Codex** | Parcial: o caminho `app-server` atualiza o texto em `item/completed`; falta consumir deltas durante a escrita. Validar também o caminho alternativo `exec`. |
| **D.3 — Título fora do caminho crítico** | Parcial: já sem MCP; ainda bloqueia o fim da tarefa e consome outra chamada. Resolver junto da Parte E. |
| **D.4 — Retornos MCP compactos** | Parcial: padrão menor entregue; falta medir bytes do retorno completo e paginar/compactar resultados grandes preservando o conteúdo acessível. |
| **D.6 — Publicar páginas estáticas na VM** | Opcional de produto, pendente: não foram encontradas `page_publish`, `page_unpublish` e `page_list`. Publicar a PWA não implementa essas ferramentas. |
| **Aceite de paridade** | Falta uma bateria comparável CLI × MyBots nas quatro IAs: saudação, retomada, pesquisa, ferramenta MCP, documento, imagem quando suportada, pergunta, subagentes, tarefa longa e Parar; incluir PC/celular e sistemas suportados. |

A entrada 0.94.19 do histórico também cita `nativeOff`, pool `SERVERS`, subagentes e `followup` que não foram localizados na implementação atual. Não considerá-los concluídos só pelo relato; conferir implementação e testes reais antes de fechar os itens. A mudança de `personality`/`js_repl` citada ali também precisa ser reconciliada com a configuração efetivamente enviada ao Codex.

### Próxima ordem de trabalho

1. **Parte E — contexto, ferramentas e tokens**, começando por `ToolSearch`, consultas relevantes e títulos sem chamadas supérfluas.
2. Completar streaming do Codex e preferência de web nativa.
3. Fechar permissões/isolamento do agy e perguntas nativas pelo app.
4. Subagentes e execução persistente/tarefas em fundo, com medição e limites.
5. Aceite comparável das quatro IAs; publicação de páginas fica como extensão opcional.

---

## Diagnóstico original (histórico) de como cada IA rodava no MyBots

### O que cada uma já traz de fábrica vs. o que o MyBots faz hoje

| Capacidade | Claude Code | Codex | Antigravity (`agy`) | OpenCode | Como está hoje no MyBots |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pesquisar na internet** | `WebSearch` | `web_search` | `search_web` | `websearch` / `codesearch` | Desligado no Claude (`--tools ""`) e no Codex (`web_search="disabled"`). Já funciona no `agy` e no OpenCode. |
| **Ler uma página (URL)** | `WebFetch` | junto do `web_search` | `read_url_content` | `webfetch` | Desligado no Claude e no Codex. Já funciona no `agy` e no OpenCode. |
| **Perguntar com opções** | `AskUserQuestion` (só terminal) | `request_user_input` (só terminal) | `ask_question` (só terminal) | `question` (só terminal) | Nenhum funciona em modo `-p` / `exec`; o MyBots já tem `user_decide` no MCP, mas hoje só libera em casos restritos. |
| **Instruções e regras do dono** | `CLAUDE.md` / `.claude/rules` | `AGENTS.md` | `GEMINI.md`, `AGENTS.md` e `.agents/rules/*.md` | `AGENTS.md` | Desligado no Claude (`--setting-sources ""`) e no Codex (`--ignore-rules`). Ativo no `agy`. A nota `Você` (`chefe/voce.md`) existe no MyBots, mas só é lida se o bot lembrar de chamar `profile_read`. |
| **Skills (`SKILL.md`)** | `.claude/skills` | `.codex/skills` / `.agents/skills` | `.agents/skills`, `~/.gemini/config/skills` e `builtin/skills` | `.opencode/skills` / `.agents/skills` | `lib/agent-skills.cjs` já descobre skills e injeta o índice no prompt das 4 IAs; no `agy` as skills nativas também já ficam ativas. |
| **Esperar / tarefas em fundo** | `Bash` (`run_in_background`) + `Monitor` | `exec_command` / `write_stdin` | `manage_task` (`list`, `status`, `send_input`, `kill`) e `schedule` (timer/cron) | `bash` | Funciona dentro de um mesmo turno, mas encerrar o processo `-p` limpa tarefas não-daemon. |
| **Subagentes em paralelo** | `Agent` | `spawn_agent` / `wait_agent` (`collab`) | `invoke_subagent`, `define_subagent`, `manage_subagents`, `send_message` e `/swarm` | `task` | Desligado no Claude e no Codex (`collab` em `DISABLED_FEATURES`). Ativo no `agy`. |
| **Gerar imagem** | não tem nativo | `image_generation` (coletado em `generatedImages`) | `generate_image` (salva em `brain/<id>/`, mas hoje o MyBots não coleta) | não tem nativo | Só o Codex envia as imagens geradas para o chat hoje. |
| **Carregamento das ferramentas MCP do MyBots** | Direto (`--strict-mcp-config`) | Direto (`-c mcp_servers.mybots-tools=...`) | *Lazy* por padrão (`call_mcp_tool` + leitura prévia de `<tool>.json` com `view_file`) | Direto (`OPENCODE_CONFIG_CONTENT`) | **Gargalo grave no `agy`**: gasta turnos extras lendo schemas `.json` e aciona o filtro `SNOOP` por engano. |

---

## Por que o Antigravity (`agy` / Gemini) demora muito mais que Claude e Codex hoje?

A lentidão e as falhas do Gemini dentro do MyBots vêm de **5 problemas concretos na integração atual** (`lib/agy-runner.cjs` e `supervisor/queue.mjs`), comprovados nos logs de execução (`~/.gemini/antigravity-cli/brain/*/transcript.jsonl`):

1. **Boot de servidores MCP globais pesados a cada mensagem (`prepareAgyMcp`)**:
   Enquanto o Claude usa `--strict-mcp-config` e o Codex usa `--ignore-user-config` para subir **apenas** o `mybots-tools`, o `prepareAgyMcp` em `lib/agy-runner.cjs` preserva todos os outros MCPs do `~/.gemini/config/mcp_config.json` do computador (como `21st-magic`, `rea`, `shadcn` via `npx -y` e `blender` via `uvx`). A cada mensagem enviada no MyBots, o `agy -p` sobe todos esses processos externos e injeta mais de 200 ferramentas inúteis no prompt antes de dar o primeiro passo.
2. **Ferramentas do MyBots carregadas como *Lazy* em vez de *Eager***:
   No `agy`, servidores MCP sem `"tools": { "<nome_da_ferramenta>": { "eager": true } }` no `mcp_config.json` entram como *lazy-loaded*. O prompt interno do `agy` obriga o Gemini a primeiro chamar `view_file` em `~/.gemini/antigravity-cli/mcp/mybots-tools/<ferramenta>.json` (gastando **8 a 20 segundos num turno extra de LLM**) antes de chamar `call_mcp_tool`. No Claude e no Codex, os schemas já vão direto na primeira chamada.
3. **O filtro `SNOOP` mata o `agy` quando ele lê os próprios schemas MCP**:
   Em `lib/agy-runner.cjs`, a regex `OWN_FILES` libera `brain|scratch|artifacts|conversations|tmp`, mas **esquece `mcp`**. Quando o `agy` lê 3 arquivos `.json` dentro de `~/.gemini/antigravity-cli/mcp/mybots-tools/` no mesmo turno, a regra `SNOOP` (`++snoop >= 3`) acha que o bot está bisbilhotando arquivos internos e **mata o processo**, jogando fora minutos de trabalho ou forçando nova tentativa.
4. **Saídas grandes de MCP (`browser_read`) viram arquivo `output.txt` e exigem mais um turno**:
   Quando o `browser_read` devolve até 10.000 caracteres mais o envelope JSON (> 8 KB), o `agy` salva o retorno em `.system_generated/steps/<N>/output.txt` e devolve só o link do arquivo. O Gemini precisa gastar **mais 8 a 10 segundos** num passo extra de `view_file(output.txt)` a cada leitura de página.
5. **Geração de título da conversa (`nameSession`) bloqueando o fim do turno com MCP ligado**:
   Em `supervisor/queue.mjs`, na primeira mensagem de uma sessão do Chefe, `await this.nameSession(...)` roda **antes** de emitir `task.done` e sobe mais um processo completo da IA com todos os servidores MCP só para gerar um título de 4 palavras (até 40s de bloqueio).

---

## Plano separado por IA (e parte comum do MyBots)

### Parte A — Antigravity (`agy` / Gemini)
**Arquivos principais**: `lib/agy-runner.cjs`, `supervisor/agy-wrapper.sh`

1. **Isolar o `mcp_config.json` do turno e ativar `"tools": { "<nome_da_ferramenta>": { "eager": true } }`**:
   - Em `prepareAgyMcp` (`lib/agy-runner.cjs`), gravar temporariamente apenas o servidor `mybots-tools` (ou marcar os demais servidores globais com `disabled: true` durante o turno, com contagem de referência para não corromper quando até 3 turnos `agy` rodam em paralelo) e configurar:
     ```json
     "mybots-tools": {
       "command": "...",
       "args": ["..."],
       "disabled": false,
       "tools": { "<nome_da_ferramenta>": { "eager": true } }
     }
     ```
   - Com `"tools": { "<nome_da_ferramenta>": { "eager": true } }`, o `agy` registra as ferramentas do MyBots direto como ferramentas nativas (`mcp_mybots-tools_<nome>`), eliminando o turno extra de `view_file(<tool>.json)` e o boot de `npx`/`uvx` externos.
2. **Corrigir `OWN_FILES`, `AGY_OWN_TOOLS`, `AGY_GUIDANCE` e o progresso das ferramentas**:
   - Incluir `mcp` em `OWN_FILES`: `/(?:antigravity-cli|gemini)\/(?:brain|scratch|artifacts|conversations|tmp|mcp)\b/i` para que o `SNOOP` nunca mate o processo ao ler schemas do MCP.
   - Atualizar `AGY_OWN_TOOLS` substituindo os nomes legados (`command_status|send_command_input`) pelos reais do `agy` atual (`manage_task|schedule|call_mcp_tool|invoke_subagent|manage_subagents|define_subagent|send_message|generate_image|list_resources|read_resource`).
   - No parser de `step_update` (`lib/agy-runner.cjs`), reconhecer:
     - `call_mcp_tool`: extrair `params.ToolName` (e `params.Arguments`) para mostrar `Usando browser_read` em vez de `Usando call_mcp_tool`.
     - `mcp_mybots-tools_<nome>`: limpar o prefixo `mcp_mybots-tools_` no indicador de progresso.
     - `search_web`: mostrar `Pesquisando na internet: "${params.query}"`.
     - `read_url_content`: mostrar `Lendo página: ${params.Url}`.
3. **Coletar imagens geradas pelo `generate_image`**:
   - Assim como `generatedImages` faz no `lib/codex-runner.cjs`, varrer `~/.gemini/antigravity-cli/brain/<sessionId>/` ao fim do turno procurando imagens (`.png`, `.jpg`, `.webp`) criadas a partir de `startedAt` e devolvê-las em `images` para aparecerem direto no chat.
4. **Travar ferramentas de computador quando `tools.computer` estiver desligado**:
   - Hoje `--dangerously-skip-permissions` libera `run_command`, `write_to_file` e `replace_file_content` mesmo em bots sem permissão de computador.
   - Quando `!tools?.computer && !tools?.phoneShell`, bloquear chamadas de `run_command`, `write_to_file` e `replace_file_content` (via configuração de `permissions.deny` em `settings.json` ou hook `PreToolUse` em `.agents/hooks.json` na pasta de trabalho do bot).
5. **Streaming de rascunho (`onDelta`) no `agy`**:
   - Repassar textos parciais do `stream-json` para `onDelta` (quando disponível antes do `result` final) para o usuário ver a resposta nascendo em tempo real.

---

### Parte B — Claude Code
**Arquivos principais**: `lib/claude-runner.cjs`, `pc/server.mjs`

1. **Liberar pesquisa e leitura web nativas (`WebSearch` e `WebFetch`)**:
   - Em `claudeTools` (`lib/claude-runner.cjs`), em vez de retornar `''` quando o bot não tem computador/terminal, incluir sempre `WebSearch,WebFetch`:
     - Bot sem computador/terminal: `--tools "WebSearch,WebFetch"` e `--allowedTools "WebSearch,WebFetch"`.
     - Bot com computador/terminal: `--tools "Bash,Read,Edit,Write,Glob,Grep,WebSearch,WebFetch"`.
   - Em `claudeGuidance`, orientar: para buscar fatos na web ou ler páginas públicas, prefira `WebSearch` e `WebFetch`; use o navegador (`browser_*`) apenas quando precisar clicar, preencher formulários, usar sessão logada ou ver a página renderizada.
   - Em `stepFromTool` (`lib/claude-runner.cjs`), exibir:
     - `WebSearch`: `Pesquisando na internet: "${input.query}"`
     - `WebFetch`: `Lendo página: ${input.url}`
2. **Bloquear acesso a endereços locais no `WebFetch`**:
   - Adicionar hook `PreToolUse` na configuração temporária do Claude (ou regra de permissão `deny` para `WebFetch(http://localhost:*)`, `WebFetch(http://127.*)`, `WebFetch(http://10.*)`, `WebFetch(http://192.168.*)`) impedindo leitura de serviços internos da máquina/VM.
3. **Streaming da resposta em tempo real (`onDelta`)**:
   - Passar `--include-partial-messages` no `claudeArguments` e alimentar `onDelta` em `lib/claude-runner.cjs` conforme os deltas de texto chegam no `stream-json`, igualando a fluidez ao app do Claude Code.

---

### Parte C — Codex
**Arquivos principais**: `lib/codex-runner.cjs`

1. **Liberar pesquisa na internet nativa (`web_search`)**:
   - Em `chatArguments` (`lib/codex-runner.cjs`), trocar `-c web_search="disabled"` por `-c web_search="live"`.
   - No parser de eventos JSONL do Codex (`lib/codex-runner.cjs`), capturar eventos `web_search_call` e mandar para `onProgress` (`Pesquisando na internet: "${query}"`).
   - Em `deviceGuidance`, orientar o modelo a usar `web_search` para buscas rápidas e deixar `browser_*` para interação real em sites.
2. **Streaming da resposta em tempo real (`onDelta`)**:
   - Capturar os eventos de delta de mensagem (`agent_message_delta` / `item.updated`) no JSONL do `codex exec --json` e chamar `onDelta(text)` para exibir o texto conforme é escrito.

---

### Parte D — Melhorias comuns no MyBots (valem para todas as IAs)
**Arquivos principais**: `supervisor/queue.mjs`, `supervisor/prompts.mjs`, `supervisor/tools.mjs`, `supervisor/tool-policy.mjs`, `pc/pdf.mjs`

1. **Injetar automaticamente as instruções do dono (`chefe/voce.md`) em todos os bots**:
   - Em vez de criar outro arquivo/tela do zero ou depender de o bot chamar `profile_read`, ler a nota `Você` (`chefe/voce.md`, que o dono já edita pelo app ou pede para o Chefe atualizar via `profile_write`) e injetá-la automaticamente no cabeçalho do prompt de todos os bots (truncada em até 2.000 caracteres).
2. **Liberar `user_decide` (perguntar com botões de opção) para todos os bots**:
   - Em `supervisor/tool-policy.mjs` e `supervisor/prompts.mjs`, permitir que qualquer bot em conversa direta chame `user_decide` quando precisar tirar uma dúvida rápida com 2 a 4 opções clicáveis, sem ficar restrito ao Chefe.
3. **Tirar `nameSession` do caminho crítico e rodar sem MCP**:
   - Em `supervisor/queue.mjs`, disparar `this.nameSession(...)` em background (sem segurar `task.done` nem manter a tarefa como `running` na UI) e passar `tools: undefined` na chamada do título para não inicializar servidores MCP só para dar nome à conversa.
4. **Deixar `browser_read` enxuto para não estourar o limite inline do `agy` (8 KB)**:
   - Reduzir o padrão de `max_chars` do `browser_read` (ou compactar espaços/ruído antes de devolver no MCP) para que a resposta caiba inline sem cair em arquivo temporário `output.txt`.
5. **Skills padrão embutidas (`pdf`, `docx`, `xlsx`, `powerpoint`) com carregamento sob demanda (progressive disclosure)**:
   - Embutir as 4 skills padrão de documentos (`skills/pdf`, `skills/docx`, `skills/xlsx`, `skills/powerpoint`) diretamente no repositório e no instalador do MyBots (`scripts/stage-desktop.mjs`), para que qualquer PC novo já venha com elas prontas sem depender de pastas externas da máquina.
   - Em `lib/agent-skills.cjs` (`defaultSkills`, `activeSkills`) e `pc/server.mjs`, ligar automaticamente as skills padrão do MyBots para todos os bots com acesso ao computador, sem precisar ativar manualmente bot por bot.
   - Em `pc/server.mjs` (`sandboxFor`), ocultar com `--tmpfs` as pastas de skills pessoais da máquina (`~/.agents/skills`, `~/.gemini/config/skills`, `~/.gemini/skills`, `~/.claude/skills`, `~/.codex/skills`), garantindo que os bots não carreguem skills pessoais de design/outros temas por engano.
   - Em `skillGuidance` (`lib/agent-skills.cjs`), enviar no prompt apenas o índice enxuto de 1 linha por skill com instrução explícita de *progressive disclosure*: nunca ler nem chamar skills em mensagens normais, lendo o `SKILL.md` apenas quando o pedido realmente precisar daquela skill.
6. **Publicar páginas HTML estáticas na VM (opcional / produto)**:
   - Quando o MyBots estiver rodando na VM com Caddy e domínio HTTPS, adicionar `page_publish`, `page_unpublish` e `page_list` para publicar pastas estáticas em `/var/www/paginas/<nome>/` com link público compartilhável.

---

## Ordem recomendada de execução

1. **Passo 1 (Impacto imediato na velocidade e estabilidade do Gemini)**: Parte A (`lib/agy-runner.cjs` — `tools.<nome>.eager=true`, isolamento dos MCPs globais, correção do `SNOOP` em `mcp/`, progresso de `call_mcp_tool`/`search_web`/`read_url_content` e imagens do `generate_image`) + item D.3 (`nameSession` sem bloquear e sem MCP) + item D.4 (`browser_read` enxuto).
2. **Passo 2 (Pesquisa web instantânea e streaming em Claude e Codex)**: Parte B (`WebSearch`/`WebFetch` + `onDelta` no `lib/claude-runner.cjs`) e Parte C (`web_search="live"` + `onDelta` no `lib/codex-runner.cjs`).
3. **Passo 3 (Experiência de uso estilo Claude Code / terminal)**: Itens D.1 (injetar `chefe/voce.md` automaticamente) e D.2 (`user_decide` liberado para todos os bots).
4. **Passo 4 (Documentos e publicação)**: Itens D.5 (`pc/pdf.mjs` + skills de Office/PDF) e D.6 (publicação de páginas no Caddy da VM).


---

## Parte E — Aproximar o contexto e o consumo do terminal (pendente)

Pedido registrado em 16/11/2026, após a investigação dos turnos de 15/11. Objetivo: reduzir o contexto adicional, as chamadas automáticas e a latência sem retirar as capacidades e permissões do bot. O terminal também possui instruções e ferramentas próprias; não prometer que uma saudação vai custar só os tokens da palavra “oi”.

### Evidência medida

| Turno real “oi” no MyBots | Entrada sem cache ou criada no cache | Cache lido | Saída/raciocínio contabilizado | Total no balão | Chamadas ao modelo | Tempo até concluir |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gemini 4 Hydrogen médio | 41.033 | 37.729 | 395 | 79.157 | 2 | 14,1 s |
| Claude Opus médio | 44.250 | 40.025 | 240 | 84.515 | 2 | 8,4 s |
| GPT-6.1-Sol médio | 20.033 | 0 | 18 | 20.051 | 1 | 5,7 s |

O Gemini chamou `shared_index_read`; o Claude chamou `shared_index_read` e `task_list_items` antes de responder; o GPT respondeu sem ferramentas. As instruções do Chefe mandam começar lendo o índice mesmo numa saudação. O total soma entradas de cada chamada, inclusive cache, não mede diretamente dinheiro ou porcentagem da assinatura.

Teste controlado com o mesmo texto de entrada do Claude e supervisor de teste separado: incluir `ToolSearch` reduziu a primeira chamada de 40.034 para 18.135 tokens de entrada (~55%). Numa amostra, o “oi” respondeu em uma chamada (18.159 tokens totais); isso não garante que a escolha de ferramentas/latência seja idêntica em toda execução. Um pedido explícito de `team_status` usou `ToolSearch` e depois a ferramenta com sucesso. Nenhuma alteração desses testes foi aplicada aos runners do repositório.

Referência pelo executor sem instruções/MCP do MyBots, com “oi”: Claude 4.287 tokens, Codex 12.198 tokens. Não equivale a todo terminal pessoal (configuração, ferramentas, cache e histórico podem variar). Chamadas separadas para título nos turnos reais acrescentaram 4.370 tokens no Claude e 12.257 no GPT, fora do balão; conferir também sua inclusão na contabilização global.

### Implementar, em ordem

- [ ] **E.1 — Busca de ferramentas do Claude:** incluir `ToolSearch` nas listas explícitas de ferramentas compatíveis. Hoje sua omissão força o carregamento antecipado dos schemas MCP. Preservar as permissões e provar busca → chamada de leitura e ação permitida, em sessão nova e retomada. No Codex, preservar a descoberta nativa existente. No agy, comparar alternativas suportadas sem perder a chamada direta consertada na v212 nem voltar à procura de schemas no disco.
- [ ] **E.2 — Memória e pendências por relevância:** retirar a obrigação de ler índice/pendências no início de qualquer conversa. Uma saudação pode ser respondida diretamente; pedidos sobre compromissos, equipe ou projetos devem continuar consultando as fontes adequadas. Não criar uma lista rígida de palavras que desligue capacidades do bot.
- [ ] **E.3 — Instruções enxutas:** unificar orientações repetidas entre `mobile/local.js`, `browserAccountGuidance` e os runners. Manter no contexto básico personalidade, permissões e instruções essenciais; carregar detalhes de navegador, equipe, documentos e skills sob demanda. No turno GPT auditado havia 18,2 mil caracteres de orientações do MyBots em uma mensagem de desenvolvedor e 14,5 mil caracteres na entrada montada pelo app. Medir a redução real, sem substituir contexto útil por resumos que mudem o pedido.
- [ ] **E.4 — Títulos baratos e assíncronos:** usar título local para saudações/mensagens simples, sem iniciar outra IA; quando um título por IA fizer sentido, executar sem MCP e fora do caminho de `task.done`, com cancelamento e contabilização do uso. Evitar iniciar sessão fria só para poucas palavras.
- [ ] **E.5 — Uso compreensível:** preservar no histórico os campos de entrada, cache e saída necessários; mostrar separadamente entrada nova/criada em cache, cache reaproveitado e saída/raciocínio, conforme a semântica de cada provedor. Tratar mensagens antigas que só têm `input/output` sem inventar valores. Não converter tokens brutos em porcentagem da assinatura nem contar cache/raciocínio duas vezes.
- [ ] **E.6 — Preservar sessões e cache:** verificar retomada e estabilidade do prefixo de instruções; não reiniciar a sessão para cada mensagem e não usar `/clear` como suposta economia automática. Trocas necessárias de permissões/modelo/conta continuam corretas. Medir sessão nova e aquecida separadamente.
- [ ] **E.7 — Comparação reproduzível:** testar as quatro IAs com mesma versão/modelo/esforço, mensagens, ferramentas e histórico definidos; registrar entrada nova, cache, saída, chamadas, tempo até primeiro texto e tempo total. Comparar CLI sem MyBots, MyBots atual e otimizado, separando custo de títulos e tarefas auxiliares. Repetir amostras; não extrapolar porcentagens de uma saudação para tarefas reais.

### Aceite

Uma saudação simples pode terminar sem ler índice, pendências ou skills e sem chamada extra para título. Pedidos que exigem memória, navegador, documentos, equipe e ferramentas continuam funcionando. `ToolSearch` do Claude permanece utilizável e o MCP do agy continua sem erros de configuração. O consumo mostrado reconcilia com os eventos de cada CLI, e o relatório distingue cache de entrada nova, sessões frias/quentes e chamadas auxiliares. As otimizações devem passar pelos testes e pela entrega normal do repositório antes de serem marcadas como concluídas.

Referências verificadas na investigação: [Claude Code — configuração da busca de ferramentas](https://code.claude.com/docs/en/mcp#configure-tool-search) e [OpenAI — busca de ferramentas](https://developers.openai.com/api/docs/guides/tools-tool-search). Revalidar as opções na versão instalada ao implementar.
