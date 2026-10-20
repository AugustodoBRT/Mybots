# Configurar o POCO para o MyBots

As opções e nomes podem variar com a versão do HyperOS. Não desinstale o MyBots nem limpe seus dados ao atualizar.

## Agora: conversa e preservação

1. Instale a v8 por cima da v7. Abra e confira os mesmos bots e conversas.
2. Entre no modo **Só celular · Termux**. O primeiro carregamento da v8 salva uma cópia datada em `~/.mybots/backup/`, antes de atualizar o histórico. Uma cópia privada anterior à v8 também fica no armazenamento do MyBots.
3. Na lista de bots, toque **Backup e diagnóstico → Salvar backup agora**. Anote o nome exibido. O arquivo inclui bots, configurações, mensagens e identificadores; não inclui as credenciais do Codex.
4. Para testar a restauração sem perder dados novos: crie um bot descartável, salve backup, apague esse bot e restaure a cópia recém-criada. A restauração substitui os bots e conversas pelo estado salvo e faz outra cópia antes. Respostas que estavam pendentes no backup viram erro recuperável, sem executar novamente sozinhas.
5. **Ver diagnóstico do aparelho → Copiar informações** coleta Android, sistema, versão do Termux e do Codex, disponibilidade do Node/SQLite e o resultado visível do catálogo que usa app-server. Não copie credenciais ou arquivos de login.
6. Backups do Termux sobrevivem à remoção do MyBots, mas são perdidos se o Termux for desinstalado ou seus dados forem apagados. Guarde uma cópia privada externa. A retomada de sessão requer os arquivos do Codex no mesmo Termux; o backup das conversas não substitui esses arquivos.

## Preparação para a futura etapa de plantão

- Nas configurações de bateria, procure Termux e MyBots e escolha **Sem restrições**, quando disponível.
- No gerenciador de apps do HyperOS, habilite **Início automático** para ambos se houver essa opção. Mantenha o Termux protegido nos recentes quando o sistema oferecer o cadeado.
- Autorize notificações para o Termux e o MyBots quando forem solicitadas. Para a conversa atual, mantenha o Termux disponível durante a resposta.
- A opção de desenvolvedor relativa às restrições de processos filhos deve ser verificada no aparelho antes da etapa de plantão. Não alteramos configurações do sistema remotamente e não presumimos que o nome do menu seja igual em todas as versões.

Essas configurações não criam o supervisor nem garantem atividade 24 horas. O teste de tela apagada, Doze, temperatura e bateria pertence à etapa 5. O Android pode adiar rede e processamento durante períodos de inatividade; há restrições mesmo quando um app recebe uma isenção parcial. [Documentação oficial de Doze](https://developer.android.com/training/monitoring-device-state/doze-standby).

## Atualização v9 — supervisor

Instale por cima da v8. Ao entrar no modo Só celular, aguarde a preparação: ela pode baixar Node no Termux uma única vez, testar SQLite e executar os testes embarcados. As ferramentas Android do PC continuam guardadas e não precisam ser baixadas novamente.

A partir dessa versão, o núcleo e os dados ficam no Termux. Não é necessário manter a interface MyBots aberta durante uma resposta; o Termux precisa continuar disponível. Consulte [supervisor.md](supervisor.md) para os testes de fechar/reabrir, cancelar, interromper o núcleo e recuperar o histórico. Não desinstale o Termux nem apague `~/.mybots/`.
