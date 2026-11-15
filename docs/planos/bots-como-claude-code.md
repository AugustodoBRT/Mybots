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
- **Terminal: o dono disse que o acesso pode ser igual ao do terminal.** Hoje, no Acesso total e no Livre, o terminal já roda sem pedir nada; só os comandos perigosos (`sudo`, apagar pastas inteiras, `git push`) pedem cartão, numa lista que o dono edita no app. Ficam como estão, a menos que o dono diga que quer tirar esses cartões também.

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

### 4. Skills prontas: o que elas acrescentam ao que já existe (médio, 2 a 3 entregas)

**O que os bots já fazem hoje.** A ferramenta `file_create` do MyBots (igual em todas as IAs) cria PDF, Word (`.docx`), planilha (`.xlsx`, cada tabela vira uma aba), CSV, Markdown, texto ou HTML **a partir de um texto em Markdown** (títulos, negrito, listas, tabelas e gráficos simples de barra, linha e pizza). E `attachment_read` lê texto, imagens e PDF com texto. É uma conversão de uma vez só. Pelo código, **no PC criar PDF hoje não funciona** (`pc/pdf.mjs` responde que não está disponível); só o celular cria, pela tela do app.

**O que as skills acrescentam**, e que `file_create` não faz:
- **Mexer num arquivo que já existe:** o dono manda um `.docx`, `.xlsx`, `.pptx` ou PDF e o bot edita, em vez de só criar um novo.
- **PowerPoint:** não existe hoje.
- **Excel de verdade:** fórmulas que recalculam, formatação, vários gráficos, formatos de número.
- **Word de verdade:** estilos, modelos, índice, comentários e alterações rastreadas.
- **PDF de verdade:** preencher formulário, juntar e dividir, marca d'água, extrair tabelas, ler PDF escaneado (OCR) e criar PDF também no PC.
- **Capricho:** instruções de como fazer bem feito, em vez de um visual genérico.

**Quais skills.** As quatro de documentos são só o começo:
1. **PDF e planilhas** (entrega 1).
2. **Word e PowerPoint** (entrega 2).
3. **Gráficos bonitos, pesquisa com fontes e páginas bonitas** (entrega 3). A pesquisa depende das etapas 1 e 7; o design de páginas serve aos cartões HTML do Canvas e à etapa 5.
4. **As do próprio dono** (vídeo explicativo e anúncios em vídeo): pesadas (navegador com GPU, narração, ffmpeg), então só no PC.

O formato `SKILL.md` é o mesmo nas quatro IAs (o MyBots já entrega skills do Antigravity a todos os bots), então uma skill empacotada vale para todas. Falta decidir onde cada uma roda:
- **PC:** usam o Python do computador.
- **Celular:** o Linux do app precisa de Python e das bibliotecas de documentos. Aumenta o APK (estimativa de 30 a 60 MB), então baixar só quando o primeiro bot usar.
- Religar a descoberta de skills onde está desligada (`--disable-slash-commands` no Claude, `skip_host_skill_discovery` e `skill_mcp_dependency_install` no Codex).

### 5. Publicar páginas com link (médio, 1 a 2 entregas)

**Como funciona.** É do MyBots para todos (nenhuma IA publica páginas). O bot pede para publicar um cartão HTML do Canvas; o dono aprova (por padrão pede aprovação, porque o conteúdo sai do aparelho); o supervisor manda o HTML pelo canal seguro que já liga o aparelho ao relé; a VM guarda como arquivo (`/var/www/p/<código aleatório>/index.html`) e devolve um link. O Caddy, que já serve o web app do iPhone, serve esses arquivos como arquivos estáticos.

**Pesa no relé? Não, porque quem serve é o Caddy, não o relé.** Medido na VM em 15/11/2026: 2 processadores, **954 MB de memória (uns 500 MB livres)**, carga 0,00, 111 dias ligada, 4 conexões abertas, disco com 40 GB livres de 45. O relé (Node) usa uns 60 MB e o Caddy uns 26 MB; o web app inteiro ocupa 4,6 MB. Servir uma página de poucos centenas de KB é quase nada para o Caddy. O recurso apertado é a **memória**, então a publicação grava direto no disco, sem carregar a página na memória do relé, e recusa arquivos grandes.

**O que precisa de cuidado de verdade (não é desempenho):**
- **Segurança:** as páginas ficariam no mesmo endereço do web app do iPhone, que guarda o pareamento no próprio navegador. Uma página de bot com script poderia tentar lê-lo. Por isso cada página sai com o cabeçalho `Content-Security-Policy: sandbox` (origem isolada, sem acesso ao armazenamento do web app), ou num endereço separado.
- **Abuso:** qualquer pessoa com o link poderia abrir à vontade, ou alguém publicar lixo ou golpe no nosso domínio. Limites: só aparelho pareado publica; até ~2 MB por página; poucas páginas por aparelho (ex.: 20) e teto total de disco (ex.: 500 MB); validade automática (ex.: 30 dias); limite de pedidos por minuto no Caddy.
- **Privacidade:** o código do link é aleatório e longo (impossível adivinhar), e o dono vê no app a lista do que está publicado, com um botão "Tirar do ar" que apaga o arquivo na hora.
- **Banda:** uma página que viraliza gasta a banda da VM; o limite gratuito da Oracle é alto, mas não conferi o número atual.

**Alternativas se o dono não quiser usar a VM:** um serviço de hospedagem estática de terceiros (conta e chave à parte) ou servir do próprio PC pelo relé (o PC precisa estar ligado e todo o tráfego passaria pelo relé, o que sim pesaria). A VM com arquivos estáticos é a mais leve e a mais simples.

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
- **Etapa 5:** os limites de publicação (tamanho por página, quantas por aparelho, validade) e se publicar pede aprovação sempre ou só na primeira vez.
- **Terminal:** manter os cartões só dos comandos perigosos (como hoje) ou tirar também.
- **Fora do plano, por enquanto:** navegador e tela próprios das IAs e memória própria da IA.
