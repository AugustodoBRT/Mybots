# Plano: o resto das melhorias pedidas pelo Chefe

Origem: o documento "Melhorias sugeridas para o MyBots", escrito pelo chefin (bot Chefe) a partir do uso real, em 08/11/2026.
As 5 prioridades dele já saíram na 0.86.0 (v181): tabelas compartilhadas, Chefe editar bots e rotinas com aprovação, resultado
de cada execução de rotina, decisão com opções e custo visível ao Chefe. Este plano é o resto, em fases. Cada fase sai numa versão,
com testes, funcionando no celular e no PC, e marcada aqui quando entregue.

Princípios do Chefe, que valem para tudo: o Chefe propõe e executa o que é pequeno; o que altera outros bots, envia, paga ou apaga passa
pela pessoa; nada de senhas ou chaves em notas ou tabelas compartilhadas; tudo serve para qualquer tipo de bot.

## Fase 1: ferramentas e rotinas (entregue na 0.87.0, v182)

- [x] **Chamadas em fila**: duas ferramentas chamadas ao mesmo tempo esperam a vez em vez de uma ser recusada com "Aguarde a ferramenta atual".
- [x] **Erros claros nas notas**: "Caminho de nota inválido" passa a explicar a regra e dar exemplos válidos.
- [x] **Busca na memória**: `memory_read` lista as chaves (sem texto) e busca por texto (`query`), além da chave exata.
- [x] **Leitura enxuta de páginas**: `browser_read` com `main: true` (só o conteúdo principal, sem menus e rodapé) e `max_chars`.
- [x] **Aviso de falha de rotina**: quando uma rotina termina com erro ou deixa de rodar, a pessoa recebe uma notificação e o Chefe vê no `team_status`.
- [x] **Encadear rotinas**: gatilho "depois de outra rotina" (`{"type":"after","routine":"<id>"}`): roda quando aquela termina bem, em vez de horários combinados.
- [x] **Ficha única da pessoa**: um texto com dados e preferências da pessoa (sem senhas), lido por todos os bots (`profile_read`) e editado pelo Chefe com aprovação (`profile_write`), também editável no app.
- [x] **Índice automático**: `shared_index_read` traz, além do que o Chefe escreveu, uma parte gerada sozinha com projetos, entregas recentes por bot e notas.
- [x] **Papéis sobrepostos**: `team_overlap` mostra ao Chefe os pares de bots com funções parecidas, para unir ou aposentar.
- [x] **Continuidade entre sessões**: já existia (resumo de passagem ao trocar de sessão).

## Fase 2: para a pessoa, no app (entregue na 0.87.0, v182)

- [x] **Painel de pendências**: uma tela com todas as decisões abertas e aprovações de todos os bots, para responder ali.
- [x] **Resumo semanal**: um botão que cria no Chefe a rotina semanal de resumo (o que cada bot fez, o que está pendente, o que precisa de decisão).
- [x] **Modelos de bot**: pontos de partida prontos ao criar um bot (busca, estudo, acompanhamento, finanças), já lendo a ficha da pessoa.

## Fase 3: controles finos (entregue na 0.87.0, v182)

- [x] **Permissão por tabela**: escolher no app quais bots leem e escrevem cada tabela compartilhada.
- [x] **Limite de gasto por bot**: um teto por mês, com aviso antes de estourar.

## Situação

As três fases saíram juntas na 0.87.0 (v182). Falta ver no celular real: o painel "Esperando você", o botão do resumo semanal, os
modelos novos de bot, a ficha em Ajustes e a página "Tabelas e limites". Próximos passos vêm do uso: peça ao Chefe um documento novo
depois de umas semanas.
