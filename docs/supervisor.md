# Supervisor — etapa 1

## Instalação e primeira abertura

Instalar a v9 por cima da v8, mantendo `com.mybots.app` e a assinatura atual. No modo Só celular, o app salva um backup do JSON anterior e pareia com o supervisor. O APK leva um pacote pequeno com os arquivos e a dependência WebSocket; não é preciso copiar scripts para o celular.

O pareamento confere o runtime no próprio Termux. Se Node/SQLite não estiverem disponíveis, tenta preparar `nodejs-lts` pelo gerenciador de pacotes do Termux. Confere `node -v`, `node:sqlite`, versão e ajudas de `codex exec` e `exec resume`. Não compila addons nativos. A receita oficial do Termux consultada usa SQLite compartilhado; a verificação e os testes no aparelho ainda são obrigatórios. [Receita oficial do nodejs-lts](https://github.com/termux/termux-packages/blob/master/packages/nodejs-lts/build.sh), [SQLite do Node](https://nodejs.org/api/sqlite.html).

Antes de abrir o banco do usuário, uma instalação nova executa os testes do supervisor num diretório temporário, com Codex simulado. O resultado fica em `~/.mybots/testes-supervisor.txt`. Falha bloqueia a preparação e preserva o JSON e seu backup. Os testes não fazem chamadas de geração à conta do Codex.

## Arquivos no Termux

- `~/.mybots/mybots.db`: fonte de verdade SQLite, com WAL e migrações por `PRAGMA user_version`.
- `~/.mybots/backup/`: cópias JSON datadas. Os arquivos anteriores não são removidos.
- `~/.mybots/runtime/<hash>/`: pacote instalado pelo APK. A atualização usa outro diretório.
- `~/.mybots/token`: token aleatório de 256 bits, arquivo 600; diretório 700.
- `~/.mybots/endpoint.json`: porta, versão do pacote e identificador da instância; não contém o token.
- `~/.mybots/supervisor.lock`: impede duas instâncias sobre o mesmo banco e verifica PID/início do processo ao recuperar um lock órfão.
- `~/.mybots/ambiente-supervisor.txt`, `testes-supervisor.txt` e `supervisor.log`: diagnóstico sem imprimir credenciais.
- `~/.mybots/codex-wrapper`: mantém o ambiente de login usado para encontrar o Codex do aparelho.

O app guarda porta/token em EncryptedSharedPreferences, com chave no Android Keystore. Esse arquivo é excluído de backup/restauração automática do Android. O token atravessa o retorno do RUN_COMMAND cifrado com a chave pública do app, evitando texto aberto nos relatórios de execução do Termux. Depois de decifrado, existe em memória apenas para autenticar o WebSocket. Não integra cache, prompts, estado público ou atividade.

## Banco e migração

Tabelas: `bots`, `messages`, `codex_sessions`, `tasks`, `task_events`, `memory`, `grants`, `approvals`, `activity`, `connector_state`, `heartbeats`, além de metadados internos de migração.

A importação inicial é transacional, preserva os IDs e é registrada uma única vez. O JSON antigo não é apagado. Uma resposta antiga ainda pendente deve terminar antes da migração pelo app; pendências que existirem no arquivo importado ficam como erro explícito, sem reenvio automático. ID e histórico de sessões Codex existentes são mantidos no mesmo Termux.

O JSON privado do MyBots vira cache. Conversas, criação, exclusão, configurações, backups, restauração e atividade passam a ler/escrever o supervisor. O modo PC anterior continua disponível e conserva sessões próprias; sincronizar não importa sessões de outra instalação do Codex.

## Fila e cancelamento

Uma tarefa por vez executa o Codex; bots diferentes podem aguardar na fila. Estados persistidos: `queued`, `running`, `waiting_approval`, `done`, `failed`, `cancelled`. A etapa atual só cria tarefas de conversa; não cria ferramentas nem aprovações externas.

`chat.send` exige ID de pedido. O mesmo ID com os mesmos dados devolve a mesma tarefa; conteúdo diferente com ID reaproveitado é recusado. O pedido e a mensagem são gravados na mesma transação antes da confirmação ao app.

A política de conversa nesta etapa é **uma tentativa automática por tarefa**. Uma conversa pode ter sido recebida pelo Codex antes de uma queda; por isso, tarefas `running` órfãs são encerradas como `failed`, com motivo e histórico preservados, e não são repetidas silenciosamente. Tarefas ainda `queued` voltam a executar. Processos órfãos são interrompidos apenas quando PID e início conferem com o registro do trabalhador.

Cancelar uma tarefa ativa envia SIGTERM ao grupo real de processos, seguido de SIGKILL após dois segundos se necessário. Só depois da saída do processo a tarefa vira `cancelled`. Cancelar uma tarefa na fila não inicia o Codex. O ID de sessão é salvo assim que chega `thread.started`, inclusive se a resposta for interrompida. A próxima mensagem usa `exec resume` e só envia o texto novo.

## Conexão e protocolo

WebSocket somente em `127.0.0.1`, porta padrão 3219 (configurável por `MYBOTS_PORT`). Primeiro frame autentica o token; nenhuma operação de dados é aceita antes. Token não aparece na URL. Há limite de tamanho, verificação de Origin, timeout de autenticação e ping/pong. [Implementação de referência do ws](https://github.com/websockets/ws).

Pedidos: `{id, method, params}`; respostas: `{id, result}` ou `{id, error}`. Eventos: `{event, data}`. Métodos: `bots.list`, `bot.create`, `bot.update`, `bot.delete`, `bots.merge`, `chat.send`, `chat.history`, `tasks.list`, `task.cancel`, `activity.list`, `approval.respond`. Complementos da interface: `state.get`, `connection.refresh`, `backup.export`, `backup.create`, `backup.list`, `backup.read`, `backup.restore`, `environment.get`.

Eventos atuais: `task.progress`, `task.done`, `activity.new`, `connection.changed`. `approval.request` pertence ao suporte de ferramentas da etapa 2. `approval.respond` é recusado nesta etapa, sem executar ação alguma.

### Conversas rápidas (v56)

- `state.get` não leva mensagens: cada bot e sala vem com `lastMessage` (prévia de até 280 caracteres), `messageCount` e `unread` (até 100), além de `seq`, o número do último evento. Só as tarefas em andamento vão no estado (o histórico continua em `tasks.list`) e as 50 atividades mais recentes. Skills, memórias, permissões e apps da conta vêm por `bot.profile { botId }`, ao abrir o perfil.
- `chat.page { botId | roomId, before?, limit? }` devolve `{ messages, before, more }`: até 40 mensagens (máximo 200), da mais antiga para a mais nova, antes do cursor `before` (rowid). Sem `before`, devolve as últimas e marca a conversa como lida; `chat.read` marca sem ler. `chat.history` e `room.history` deixaram de existir.
- Eventos com conteúdo e número crescente em `data.seq`: `message.added { botId | roomId, message }`, `message.updated { botId, message }`, `bot.updated { botId, bot }`, `task.progress { taskId, botId, step }` (o passo atual; sem `step` é mudança de estado da tarefa) e `chat.reset { botId | roomId }` (restauração, mesclagem ou exclusão reescreveram a conversa). O app aplica esses eventos sem pedir o estado; se o número não for o seguinte (reconexão, conexão atrasada demais), pede `state.get` e recarrega as conversas abertas. Os demais eventos (`activity.new`, `task.done`, `connection.changed`) continuam pedindo o estado, que agora é pequeno.
- Banco: mensagens só são acrescentadas (`appendMessage`, uma inserção) ou alteradas uma a uma (`updateMessage`); `putBot` grava só o perfil. A migração 9 tirou as mensagens das salas do JSON da sala para `room_messages` (sem o limite de 1000). Os passos do bot não regravam nada: só a mensagem de progresso visível é gravada, uma vez. Backups continuam com todas as mensagens.

O app reconecta com espera progressiva (1 a 30 segundos), atualiza o estado ao voltar ao primeiro plano e não reenvia pedidos automaticamente. Se o supervisor morreu, o pareamento pode iniciá-lo novamente. O painel passa a mostrar desconexão enquanto isso.

## Heartbeat e limites

Há um registro SQLite por minuto. Um intervalo maior que 90 segundos gera atividade com o momento do último registro conhecido. Isso permite revelar interrupções; não representa garantia de execução contínua. Nesta etapa o início ocorre pelo app, com tentativa de wake-lock. Runit, Termux:Boot, serviço automático e o teste de oito horas pertencem à etapa 5.

As tabelas de permissões/approvals existem, mas os conectores e o MCP não foram implementados. O executor mantém ferramentas, shell, apps e plugins do modelo desabilitados, como na etapa 0A. Não há rotina de e-mail nem ação externa nesta entrega.

## Testar no POCO

1. Instalar v9 por cima, abrir modo Só celular e aguardar a primeira preparação. Conferir bots e mensagens antigos.
2. Conversar, fechar o MyBots no meio de uma resposta e reabrir: verificar a mesma tarefa e uma única resposta.
3. Abrir Atividade e tarefas; cancelar uma resposta longa e verificar estado Cancelada. Enviar outra mensagem depois.
4. Interromper o Termux/supervisor durante uma tarefa e reabrir o app: tarefa em execução deve aparecer Falhou, com motivo; uma tarefa ainda na fila deve ser executada após reiniciar.
5. Salvar/restaurar um backup com bot descartável e conferir IDs e mensagens. Verificar que Voltar e apagar bot continuam funcionando.

Os testes automatizados podem ser repetidos no Termux com `node --test ~/.mybots/runtime/<hash>/tests/supervisor.test.mjs`. Não é necessário fazer isso manualmente para o teste inicial: o pareamento já os executa. Não compartilhar `~/.mybots/token`, credenciais do Codex ou arquivos da keystore.
