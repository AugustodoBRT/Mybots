# Cada IA como no próprio terminal, dentro do app: plano

Escrito em 14/11/2026 e refeito em 15/11/2026, depois de uma correção do dono. Para usar numa conversa nova: **"leia docs/planos/bots-como-claude-code.md e faça a próxima etapa pendente"**. Faça **uma etapa por entrega**, com as regras de sempre: funciona no celular e no PC, versão sobe só o último número, changelog em linguagem simples, `npm test`, APK, Release, push, web app e instaladores do PC.

## O princípio

Cada IA (Claude Code, Codex, Antigravity e opencode) deve rodar dentro do app **como roda no terminal dele**, com as ferramentas que ele mesmo traz, e o MyBots fica por cima só com a camada que é dele: níveis de acesso, cartões de aprovação, limites de gasto, isolamento e o que aparece na conversa. Hoje os quatro rodam travados: o MyBots desliga de propósito quase tudo o que eles têm de fábrica.

A versão anterior deste plano estava errada em um ponto: dizia que Codex e Antigravity precisavam de uma ferramenta nova do MyBots para usar a internet. Não precisam. Conferi nos programas instalados que as ferramentas já existem em cada um; o trabalho é **ligar, deixar passar pela camada do MyBots e mostrar na conversa**.

## Como cada um é travado hoje (e onde)

| IA | Onde fica a trava | O que está desligado |
|---|---|---|
| Claude Code | `claudeArguments` em `lib/claude-runner.cjs` | `--tools ""` (só as ferramentas do MyBots; nos níveis abertos entram `Bash, Read, Write, Edit, Glob, Grep`), `--setting-sources ""` (sem memórias, instruções do projeto nem configurações), `--disable-slash-commands` (sem skills) |
| Codex | `chatArguments` em `lib/codex-runner.cjs` | `-c web_search="disabled"`, `--ignore-user-config --ignore-rules`, e a lista `DISABLED_FEATURES`: `shell_tool, unified_exec, apps, plugins, hooks, browser_use, computer_use, multi_agent, memories, view_image, sleep_tool, goals, shell_snapshot, skill_mcp_dependency_install, remote_plugin` (o terminal volta nos níveis abertos) |
| Antigravity | `agyArguments` em `lib/agy-runner.cjs` | roda em modo `-p` com `--dangerously-skip-permissions`; as ferramentas do MyBots entram por MCP; o MyBots aplica as próprias regras por cima |
| opencode | `configFor` em `lib/opencode-runner.cjs` | `permission: { '*': 'allow', bash: 'deny', edit: 'deny', external_directory: 'deny' }` fora dos níveis abertos |

## O que cada IA já tem de fábrica

Conferido procurando os nomes das ferramentas dentro dos programas (Codex 0.162, Antigravity, opencode e Claude Code instalados neste computador). **Existir não prova que funciona no modo sem tela em que o MyBots os roda**: por isso o primeiro passo de cada etapa é um teste curto, IA por IA.

| Capacidade | Claude Code | Codex | Antigravity | opencode |
|---|---|---|---|---|
| Pesquisar na internet | `WebSearch` (entra na lista `--tools`) | `web_search` (hoje `disabled`) | `search_web` | `websearch` |
| Ler uma página | `WebFetch` | parte do `web_search` (abrir página) | `read_url_content` | `webfetch` |
| Ajudantes em paralelo | `Agent` | `spawn_agent`, `wait_agent` (recurso `multi_agent`, desligado) | `invoke_subagent` (e o plugin `swarm`, já ligado no `config.json`) | `task` |
| Perguntar com opções | `AskUserQuestion` (só no modo interativo) | `request_user_input` (em desenvolvimento no modo `exec`) | `ask_user` | não confirmado |
| Skills | `SKILL.md` | `SKILL.md` | skills embutidas (`builtin/skills`) | `skill` e `SKILL.md` |
| Instruções do dono | `CLAUDE.md` | `AGENTS.md` | não confirmado | `AGENTS.md` |
| Plano / checklist | `TodoWrite` | `update_plan` | `task_boundary` | `todowrite` |
| Esperar e acompanhar | tarefas em segundo plano | `sleep_tool` (desligado), `wait_agent` | `command_status` | — |

Também existem e hoje ficam fora: gerar imagem (Codex `image_generation`, agy `generate_image`), memória própria (Codex `memories`, "brain" do agy), metas (Codex `goals`), navegador e controle de tela próprios (Codex `browser_use`/`computer_use`, agy `browser_subagent`).

## O que continua desligado de propósito

- **Navegador e tela próprios das IAs** (`browser_use`, `computer_use`, `browser_subagent`, `--chrome`): o MyBots tem o navegador de cada bot, com login, aprovações e o botão Assumir. Ligar o das IAs abriria um segundo caminho sem essas regras.
- **Apps e plugins da conta** (`apps`, `plugins`, conectores do claude.ai): Gmail, Agenda e Drive abrem pelo navegador do bot.
- **Memória própria da IA** (`memories`, "brain"): a memória do bot é a da aba Memória do MyBots, que o dono vê e edita.
- **O nível de acesso decide o terminal**: o terminal livre no PC e no celular continua por nível e com cartão. Mudar isso é decisão do dono.

## Etapas, da mais fácil à mais complicada

Cada etapa vale para o celular e para o PC. No celular o opencode não existe (o app instala Claude, Codex e Antigravity), então as linhas dele valem só para o PC.

### 1. Pesquisar na internet sem abrir o navegador (fácil, ~1 entrega)

É **ligar o que cada IA já tem**, não criar ferramenta:

- **Claude Code:** incluir `WebSearch` e `WebFetch` em `--tools`. A permissão passa pela ferramenta de permissão do MyBots (`--permission-prompt-tool`), onde dá para recusar endereços do próprio aparelho.
- **Codex:** trocar `web_search="disabled"` por `"live"` (como o `--search` do terminal). Se o dono preferir menos risco, `"cached"` usa o índice da OpenAI em vez de buscar na hora. O executor já conta o item `web_search` nos eventos; falta mostrá-lo na conversa.
- **Antigravity:** conferir se `search_web` e `read_url_content` já funcionam no modo `-p` do MyBots (podem já estar funcionando) e mostrar os passos na conversa.
- **opencode:** conferir `websearch`/`webfetch` (a permissão `*: allow` já libera) e se a busca precisa de provedor.
- **Cuidado comum:** `read_url_content` do Antigravity e `webfetch` do opencode buscam a partir do próprio aparelho, então podem alcançar endereços da rede local. Decidir a regra (bloquear rede privada e loopback, como o navegador dos bots faz) e testar em cada IA.
- **Ganho:** pesquisa mais rápida e barata; o navegador fica só para clicar e entrar em contas.

### 2. Os bots conhecerem as regras e preferências do dono (fácil, ~1 entrega)

- Nota fixa na Memória, "Regras para os bots", editável no app.
- O MyBots injeta a nota pelo canal de instruções de cada IA, como já faz com a orientação das ferramentas: `--append-system-prompt` (Claude), `developer_instructions` (Codex), início do pedido (Antigravity) e `instructions` na configuração (opencode). Assim funciona igual nos quatro, sem depender de `CLAUDE.md` ou `AGENTS.md` de cada pasta.
- O Chefe pode sugerir mudanças; só o dono aprova.

### 3. Perguntar com opções (fácil a médio, ~1 entrega)

- Cada IA tem a sua ferramenta, mas elas são pensadas para o terminal interativo e provavelmente **não funcionam** no modo sem tela em que o MyBots roda. Esta é a única etapa em que a ferramenta do MyBots continua valendo para todos: uma ferramenta única (partindo do `user_decide` do Chefe), com 2 a 4 opções, que chega pelo MCP em qualquer IA.
- O dono toca numa opção na conversa (ou na notificação) e a resposta volta para o bot, que continua de onde parou.
- Primeiro, testar se alguma das nativas funciona no modo sem tela; se funcionar, usar a nativa nessa IA.

### 4. Skills prontas: PDF, Word, Excel, PowerPoint e gráficos (médio, 2 entregas)

- Todas as quatro IAs leem skills. O MyBots já entrega skills a todos os bots (`lib/agent-skills.cjs`, pastas passadas por `--add-dir` e `skillDirs`). O trabalho é **empacotar as skills de documentos** no formato que cada IA lê e religar a descoberta de skills onde está desligada (`--disable-slash-commands` no Claude, `skip_host_skill_discovery` e `skill_mcp_dependency_install` no Codex).
- **PC:** usam o Python do computador.
- **Celular:** o Linux do app precisa de Python e das bibliotecas de documentos. Aumenta o APK (estimativa de 30 a 60 MB), então baixar só quando o primeiro bot usar.
- **Entrega 1:** PDF e planilhas. **Entrega 2:** Word, PowerPoint e gráficos.

### 5. Publicar páginas com link (médio, 1 a 2 entregas)

- Esta é do MyBots para todos (nenhuma IA publica páginas): o bot transforma um cartão HTML do Canvas numa página com link próprio, servida pela VM do relé (a mesma do web app do iPhone).
- Endereço aleatório e difícil de adivinhar; o dono pode tirar o link do ar quando quiser.
- Por padrão, publicar pede aprovação, porque o conteúdo sai do aparelho.

### 6. Esperar sem gastar: tarefas em segundo plano (médio a difícil, 2 entregas)

- **Dentro de uma resposta:** as IAs já sabem esperar (comando em segundo plano no Claude, `sleep_tool` e `wait_agent` no Codex, `command_status` no Antigravity). O trabalho é ligar isso, ajustar os tempos limites dos executores (`IDLE_MS`, `MAX_MS`) e mostrar o estado "esperando" na conversa.
- **Entre respostas:** nenhuma IA acorda sozinha depois que a resposta termina. Isso é do MyBots: o bot começa algo demorado e "dorme"; o supervisor acompanha e acorda o bot com o resultado ou no horário marcado, aproveitando as rotinas. No celular, o serviço que mantém o app vivo com a tela apagada (`KeepAlive`) garante o despertar.

### 7. Ajudantes trabalhando em paralelo (difícil, 2 a 3 entregas)

- **Pelas próprias IAs:** ligar os ajudantes nativos de cada uma (`Agent` no Claude, `multi_agent` no Codex, `invoke_subagent` no Antigravity, `task` no opencode), só nos bots que o dono liberar.
- **Cuidado:** gasta bem mais do limite da conta por pedido. Os ajudantes precisam entrar na conta de uso e nos limites por bot, e aparecer na conversa; sem isso o dono perde a noção do gasto.
- **Pelo MyBots:** o Chefe abre bots temporários para partes de uma tarefa, até de IAs diferentes, e junta tudo no checklist do pedido. É o que une IAs diferentes; os ajudantes nativos só usam a conta da própria IA.

## Como testar cada etapa

1. **Um teste curto por IA**, antes de mexer em qualquer coisa: o mesmo pedido ("pesquise X", "faça um PDF", "pergunte-me A ou B") em cada IA, no modo em que o MyBots as roda. Anotar o que funciona sem mudança e o que precisa ligar.
2. **No celular e no PC**, e no Windows pela VM (`scripts/windows-vm.sh`).
3. **Cartões e limites:** conferir que o que a IA faz sozinha continua passando pelo nível de acesso do bot, e que o gasto aparece no uso.
4. **Aparece na conversa:** cada passo novo (busca, página lida, ajudante, espera) precisa ter uma linha visível, como as ações do navegador.

## Ordem sugerida

Etapas 1 e 2 juntas na primeira entrega: são as que mais mudam o dia a dia e as mais simples. Depois a 3, e então a 4 em diante.

## Decisões que precisam do dono

- **Etapa 1:** busca do Codex `live` ou `cached`? E a regra para endereços da rede local nas ferramentas que buscam a partir do aparelho.
- **Etapa 7:** quantos ajudantes ao mesmo tempo e qual o teto de gasto por pedido.
- **Fora do plano, por enquanto:** navegador e tela próprios das IAs, memória própria da IA e terminal livre.
