# Bots como no terminal

Os bots do MyBots são o Claude Code, o Codex, o Antigravity (`agy`) e o OpenCode rodando de verdade por trás. O objetivo deste plano é fazer cada um deles entregar dentro do MyBots a mesma velocidade, inteligência e ferramentas que entregam quando usados direto no terminal ou no app do Claude Code — mantendo as travas de segurança de cada bot.

---

## Diagnóstico real de como cada IA roda hoje no MyBots

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
   No `agy`, servidores MCP sem `"tools": { "eager": true }` no `mcp_config.json` entram como *lazy-loaded*. O prompt interno do `agy` obriga o Gemini a primeiro chamar `view_file` em `~/.gemini/antigravity-cli/mcp/mybots-tools/<ferramenta>.json` (gastando **8 a 20 segundos num turno extra de LLM**) antes de chamar `call_mcp_tool`. No Claude e no Codex, os schemas já vão direto na primeira chamada.
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

1. **Isolar o `mcp_config.json` do turno e ativar `"tools": { "eager": true }`**:
   - Em `prepareAgyMcp` (`lib/agy-runner.cjs`), gravar temporariamente apenas o servidor `mybots-tools` (ou marcar os demais servidores globais com `disabled: true` durante o turno, com contagem de referência para não corromper quando até 3 turnos `agy` rodam em paralelo) e configurar:
     ```json
     "mybots-tools": {
       "command": "...",
       "args": ["..."],
       "disabled": false,
       "tools": { "eager": true }
     }
     ```
   - Com `"tools": { "eager": true }`, o `agy` registra as ferramentas do MyBots direto como ferramentas nativas (`mcp_mybots-tools_<nome>`), eliminando o turno extra de `view_file(<tool>.json)` e o boot de `npx`/`uvx` externos.
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

1. **Passo 1 (Impacto imediato na velocidade e estabilidade do Gemini)**: Parte A (`lib/agy-runner.cjs` — `tools: { eager: true }`, isolamento dos MCPs globais, correção do `SNOOP` em `mcp/`, progresso de `call_mcp_tool`/`search_web`/`read_url_content` e imagens do `generate_image`) + item D.3 (`nameSession` sem bloquear e sem MCP) + item D.4 (`browser_read` enxuto).
2. **Passo 2 (Pesquisa web instantânea e streaming em Claude e Codex)**: Parte B (`WebSearch`/`WebFetch` + `onDelta` no `lib/claude-runner.cjs`) e Parte C (`web_search="live"` + `onDelta` no `lib/codex-runner.cjs`).
3. **Passo 3 (Experiência de uso estilo Claude Code / terminal)**: Itens D.1 (injetar `chefe/voce.md` automaticamente) e D.2 (`user_decide` liberado para todos os bots).
4. **Passo 4 (Documentos e publicação)**: Itens D.5 (`pc/pdf.mjs` + skills de Office/PDF) e D.6 (publicação de páginas no Caddy da VM).
