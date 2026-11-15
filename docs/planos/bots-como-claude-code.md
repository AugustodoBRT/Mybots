# Bots com o que o Claude Code faz e eles não: plano

Escrito em 14/11/2026. Para usar numa conversa nova: **"leia docs/planos/bots-como-claude-code.md e faça a próxima etapa pendente"**. Faça **uma etapa por entrega**, com as regras de sempre: funciona no celular e no PC, versão sobe só o último número, changelog em linguagem simples, `npm test`, APK, Release, push, web app e instaladores do PC.

## De onde vem a diferença

Os bots já rodam o **mesmo Claude Code** que roda no terminal, mas o supervisor o abre travado (`claudeArguments` em `lib/claude-runner.cjs`):

- `--tools ""`: sem nenhuma ferramenta própria (só as do MyBots). Nos níveis abertos entram só `Bash, Read, Write, Edit, Glob, Grep`.
- `--setting-sources ""`: não lê configurações, memórias nem instruções do projeto.
- `--disable-slash-commands`: nenhuma skill instalada carrega.

Codex, Antigravity e opencode têm limites parecidos, cada um no seu `*-runner`.

## O que fica fora, de propósito

O **terminal livre no PC**. Os bots já têm terminal nos níveis mais abertos, e cada comando passar por cartão de aprovação é o que protege os arquivos da pessoa. Mudar isso é decisão do dono, não parte deste plano.

## Etapas, da mais fácil à mais complicada

Cada etapa vale para o celular e para o PC.

### 1. Pesquisar na internet sem abrir o navegador (fácil, ~1 entrega)

- **Claude:** incluir a pesquisa na web e a leitura de páginas que o próprio Claude Code já tem, em `claudeArguments`.
- **Codex, Antigravity e opencode:** ferramenta nova do MyBots, `web_fetch`, que baixa a página e devolve o texto. Mesmas regras do navegador dos bots: nada de endereços do próprio aparelho (`localDevUrl`, loopback, rede privada).
- **Ganho:** pesquisa mais rápida e barata. O navegador fica para quando precisa clicar ou entrar numa conta.

### 2. Os bots conhecerem as regras e preferências da pessoa (fácil, ~1 entrega)

- Nota fixa na Memória, "Regras para os bots", editável no app.
- O supervisor a coloca nas instruções de todo bot, em toda resposta (como o arquivo de instruções do projeto faz com o Claude Code).
- O Chefe pode sugerir mudanças; só a pessoa aprova.

### 3. Perguntar com opções (fácil a médio, ~1 entrega)

- Ferramenta nova em que o bot pergunta algo com 2 a 4 opções.
- A pessoa toca numa opção na conversa (ou na notificação) e a resposta volta para o bot, que continua de onde parou. Hoje existe só o cartão de aprovar ou recusar (o `user_decide` do Chefe é o ponto de partida).

### 4. Skills prontas: PDF, Word, Excel, PowerPoint e gráficos (médio, 2 entregas)

- Trazer como skills do MyBots, que já chegam a todos os bots.
- **PC:** usam o Python do computador.
- **Celular:** o Linux do app precisa de Python e das bibliotecas de documentos. Aumenta o APK (estimativa de 30 a 60 MB), então baixar só quando o primeiro bot usar.
- **Entrega 1:** PDF e planilhas (os mais pedidos). **Entrega 2:** Word, PowerPoint e gráficos.

### 5. Publicar páginas com link (médio, 1 a 2 entregas)

- O bot transforma um cartão HTML do Canvas numa página com link próprio, servida pela VM do relé (a mesma do web app do iPhone).
- Endereço aleatório e difícil de adivinhar; a pessoa pode tirar o link do ar quando quiser.
- Por padrão, publicar pede aprovação, porque o conteúdo sai do aparelho.

### 6. Esperar sem gastar: tarefas em segundo plano (médio a difícil, 2 entregas)

- O bot começa algo demorado (download, build, esperar um site mudar) e "dorme".
- O supervisor acompanha e acorda o bot com o resultado ou no horário marcado. Aproveita o sistema de rotinas.
- No celular, o serviço que mantém o app vivo com a tela apagada (`KeepAlive`) é o que garante o despertar.

### 7. Ajudantes trabalhando em paralelo (difícil, 2 a 3 entregas)

- **Pelo MyBots:** o Chefe abre bots temporários para partes de uma tarefa; eles trabalham ao mesmo tempo e o Chefe junta tudo no checklist do pedido. Vale para todas as IAs.
- **Opcional:** ligar os ajudantes do próprio Claude Code, só nos bots que a pessoa liberar.
- **Cuidado:** gasta bem mais do limite da conta por pedido. Precisa de limite de quantos ajudantes e de quanto gastam.

## Ordem sugerida

Etapas 1 e 2 juntas na primeira entrega: são as que mais mudam o dia a dia e as mais simples. Depois a 3, e então a 4 em diante.

## Antes de começar: pendência do Windows

Antes de qualquer etapa, o dono pediu para resolver a **janela de console (cmd) que ainda pisca no Windows**. A reprodução é feita na VM `mybots-windows` (VirtualBox); ver o andamento em `docs/progresso.md`.
